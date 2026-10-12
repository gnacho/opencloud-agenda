// ICS proxy for opencloud-agenda — fetches iCal feeds server-side so the
// browser is not blocked by CORS. Runs as its own container next to OpenCloud;
// see README.md ("Optional: iCal Subscriptions") for the Traefik wiring and
// deploy/server/SETUP.md for how deploys update it.
//
// Zero dependencies on purpose: the container mounts this directory read-only
// and runs `node server.js`, nothing is installed.
import http from 'http'
import https from 'https'
import dns from 'dns'
import net from 'net'
import { pathToFileURL } from 'url'

const PORT = Number(process.env.PORT) || 3000
const PATH_PREFIX = '/ics-proxy/'
const OC_USER_URL = process.env.OC_USER_URL || 'http://opencloud:9200/ocs/v2.php/cloud/user'
const MAX_BYTES = 10 * 1024 * 1024   // refuse feeds larger than 10 MB
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 10000

// ── SSRF guard ────────────────────────────────────────────────────────────────

// net.BlockList parses addresses into binary form before matching, so every
// spelling of the same address is caught: ::ffff:7f00:1 and ::ffff:127.0.0.1,
// 0:0:0:0:0:0:0:1 and ::1. A hand-written regex over the string misses those.
const blocked = new net.BlockList()
for (const [addr, prefix] of [
  ['0.0.0.0', 8],        // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],    // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],   // link-local + cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // documentation
  ['203.0.113.0', 24],   // documentation
  ['224.0.0.0', 3],      // multicast + reserved + broadcast
]) blocked.addSubnet(addr, prefix, 'ipv4')
for (const [addr, prefix] of [
  ['::', 128],           // unspecified
  ['::1', 128],          // loopback
  // No ::ffff:0:0/96 rule here: BlockList also matches plain IPv4 addresses
  // against the v6 rules in mapped form, so that entry would block all of
  // IPv4. Mapped addresses are handled explicitly in isPrivateAddress().
  ['64:ff9b::', 96],     // NAT64 — the embedded v4 may be private
  ['2001::', 32],        // Teredo — tunnels to an arbitrary v4 host
  ['2002::', 16],        // 6to4 — can wrap a private v4
  ['fc00::', 7],         // unique-local
  ['fe80::', 10],        // link-local
  ['fec0::', 10],        // site-local (deprecated, still routed by some stacks)
  ['ff00::', 8],         // multicast
]) blocked.addSubnet(addr, prefix, 'ipv6')

export function isPrivateAddress(ip) {
  const family = net.isIP(ip)
  if (family === 4) return blocked.check(ip, 'ipv4')
  if (family === 6) {
    if (blocked.check(ip, 'ipv6')) return true
    // An IPv4-mapped address reaches the v4 host, so it must pass the v4 rules
    // too. SocketAddress canonicalises the spelling to ::ffff:a.b.c.d first.
    const canonical = new net.SocketAddress({ address: ip, family: 'ipv6' }).address
    const mapped = canonical.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    return mapped ? blocked.check(mapped[1], 'ipv4') : false
  }
  return true                                             // unparseable → refuse
}

// Checked at socket-connect time, not beforehand. A separate "resolve, check,
// then fetch" sequence resolves the name twice, and a DNS server with TTL 0 can
// answer a public address to the check and an internal one to the connection
// (DNS rebinding). Hooking the lookup the socket itself performs closes that gap:
// whatever address passes here is the address the socket connects to.
//
// All answers are inspected, not just the first — a host returning one public
// and one internal address must not slip through on the ordering.
//
// `lookup` and `isPrivate` are parameters only so the tests can run against a
// local server without touching real DNS; production always uses the defaults.
export function makeGuardedLookup({ lookup = dns.lookup, isPrivate = isPrivateAddress } = {}) {
  return function guardedLookup(hostname, options, callback) {
    lookup(hostname, { ...options, all: true }, (err, addrs) => {
      if (err) return callback(err)
      if (!addrs.length) return callback(new Error('hostname does not resolve'))
      if (addrs.some(a => isPrivate(a.address))) {
        return callback(new Error('target resolves to a private address'))
      }
      if (options.all) return callback(null, addrs)
      callback(null, addrs[0].address, addrs[0].family)
    })
  }
}

// ── auth ──────────────────────────────────────────────────────────────────────

function isAuthenticated(ocUserUrl, authHeader) {
  if (!authHeader) return Promise.resolve(false)
  return new Promise((resolve) => {
    const req = http.get(ocUserUrl, {
      headers: { Authorization: authHeader, 'OCS-APIRequest': 'true' }
    }, (res) => { res.resume(); resolve(res.statusCode === 200) })
    req.on('error', () => resolve(false))
    req.setTimeout(3000, () => { req.destroy(); resolve(false) })
  })
}

// ── upstream fetch ────────────────────────────────────────────────────────────

// Plain http/https instead of fetch(): only the low-level request exposes the
// `lookup` option that guardedLookup needs. A literal IP in the URL never hits
// the resolver, so it is checked directly.
function requestOnce(url, { guardedLookup, isPrivate }) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('only http/https allowed')
  const literal = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(literal) && isPrivate(literal)) throw new Error('target resolves to a private address')

  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http
    const req = mod.request(url, {
      method: 'GET',
      headers: { 'User-Agent': 'opencloud-agenda-ics-proxy/2.1', 'Accept': 'text/calendar, text/plain;q=0.5' },
      lookup: guardedLookup,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }, resolve)
    req.on('error', reject)
    req.end()
  })
}

// Redirects are followed by hand so every hop goes through requestOnce() and
// its guards. Automatic following would let a public URL bounce straight to
// an internal one.
async function fetchFeed(startUrl, guards) {
  let url = new URL(startUrl)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await requestOnce(url, guards)
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      url = new URL(res.headers.location, url)
      res.resume()                                        // discard the redirect body
      continue
    }
    return res
  }
  throw new Error('too many redirects')
}

// Streams the body so an oversized feed is aborted instead of buffered whole.
async function readCapped(res) {
  const declared = Number(res.headers['content-length'])
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    res.destroy()
    throw new Error('calendar too large')
  }
  const chunks = []
  let total = 0
  for await (const chunk of res) {
    total += chunk.length
    if (total > MAX_BYTES) {
      res.destroy()
      throw new Error('calendar too large')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

// ── server ────────────────────────────────────────────────────────────────────

export function createProxyServer({ ocUserUrl = OC_USER_URL, lookup, isPrivate = isPrivateAddress } = {}) {
  const guards = { guardedLookup: makeGuardedLookup({ lookup, isPrivate }), isPrivate }

  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Allow': 'GET, HEAD' }); res.end('Method not allowed'); return
      }
      if (!req.url.startsWith(PATH_PREFIX)) {
        res.writeHead(404); res.end('Not found'); return
      }
      if (!await isAuthenticated(ocUserUrl, req.headers['authorization'])) {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer' })
        res.end('Unauthorized')
        return
      }

      // decodeURIComponent throws URIError on malformed input such as "%ZZ" —
      // uncaught this takes the whole process down.
      let targetUrl
      try {
        targetUrl = decodeURIComponent(req.url.slice(PATH_PREFIX.length))
      } catch {
        res.writeHead(400); res.end('Invalid URL encoding'); return
      }
      try {
        new URL(targetUrl)
      } catch {
        res.writeHead(400); res.end('Invalid URL'); return
      }

      let upstream, body
      try {
        upstream = await fetchFeed(targetUrl, guards)
        body = await readCapped(upstream)
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Upstream error: ' + err.message)
        return
      }

      // The upstream Content-Type is deliberately discarded. Echoing it would let
      // any user serve HTML from your OpenCloud origin through this path.
      res.writeHead(upstream.statusCode, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': 'attachment; filename="calendar.ics"',
        'Cache-Control': 'private, max-age=3600',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    } catch (err) {
      if (!res.headersSent) { res.writeHead(500); res.end('Internal error') }
      console.error('unhandled:', err?.message)
    }
  })
}

// Listen only when started as `node server.js`, not when the tests import it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createProxyServer()
  server.listen(PORT, () => console.log('ICS proxy listening on port ' + server.address().port))
}
