// Runs with `node --test deploy/ics-proxy/` — no network, no real DNS. The
// upstream "feed" is a local server; the proxy under test is pointed at it
// through an injected lookup so the real address guard can still be exercised
// against hostnames (which is where the rebinding fix lives).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createProxyServer, isPrivateAddress, makeGuardedLookup } from './server.js'

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

// Resolves every name to the local feed server — the "public internet" of this
// test suite. Pass-through for the check: the proxy still runs the real guard.
const fakeLookup = (ip) => (hostname, options, cb) => {
  if (hostname === 'nxdomain.test') return cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))
  cb(null, [{ address: ip, family: 4 }])
}

describe('isPrivateAddress', () => {
  for (const ip of [
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', '0:0:0:0:0:0:0:1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::FFFF:7f00:1', '::ffff:c0a8:1', '::ffff:10.0.0.1',
    '64:ff9b::7f00:1', '2001:0:1::1', '2002:7f00:1::1', 'fc00::1', 'fd12::1', 'fe80::1', 'fec0::1', 'ff02::1',
    'not-an-ip',
  ]) test(`blocks ${ip}`, () => assert.equal(isPrivateAddress(ip), true))

  for (const ip of [
    '8.8.8.8', '142.251.20.102', '100.128.0.1', '172.32.0.1', '192.169.0.1',
    '2a00:1450:4001:c25::8a', '2001:4860::8888', '::ffff:8.8.8.8', '::ffff:0808:0808',
  ]) test(`allows ${ip}`, () => assert.equal(isPrivateAddress(ip), false))
})

describe('guardedLookup', () => {
  const resolveTo = (addrs) => (h, o, cb) => cb(null, addrs)
  const run = (lookup, options = {}) => new Promise((resolve) =>
    makeGuardedLookup({ lookup })('host.test', options, (err, ...rest) => resolve({ err, rest })))

  test('passes a public answer through', async () => {
    const { err, rest } = await run(resolveTo([{ address: '8.8.8.8', family: 4 }]))
    assert.equal(err, null)
    assert.deepEqual(rest, ['8.8.8.8', 4])
  })
  test('returns the full list when the socket asks for all addresses', async () => {
    const addrs = [{ address: '8.8.8.8', family: 4 }, { address: '2001:4860::8888', family: 6 }]
    const { err, rest } = await run(resolveTo(addrs), { all: true })
    assert.equal(err, null)
    assert.deepEqual(rest, [addrs])
  })
  test('rejects when any answer is private, not just the first', async () => {
    const { err } = await run(resolveTo([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]))
    assert.match(err.message, /private address/)
  })
  test('rejects an empty answer', async () => {
    const { err } = await run(resolveTo([]))
    assert.match(err.message, /does not resolve/)
  })
  test('propagates resolver errors', async () => {
    const { err } = await run((h, o, cb) => cb(new Error('ENOTFOUND')))
    assert.equal(err.message, 'ENOTFOUND')
  })
})

describe('proxy end to end', () => {
  let feed, auth, feedPort, authPort
  let strict, strictPort      // real address guard, names resolve to the local feed
  let lenient, lenientPort    // guard disabled, to exercise the fetch path itself

  before(async () => {
    feed = http.createServer((req, res) => {
      switch (req.url) {
        case '/feed.ics':
          res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(ICS); break
        case '/redirect':
          res.writeHead(302, { Location: '/feed.ics' }); res.end(); break
        case '/loop':
          res.writeHead(302, { Location: '/loop' }); res.end(); break
        case '/to-private':
          res.writeHead(302, { Location: `http://127.0.0.1:${feedPort}/feed.ics` }); res.end(); break
        case '/big-declared':
          res.writeHead(200, { 'Content-Length': String(11 * 1024 * 1024) }); res.write('x'); res.end(); break
        case '/big-streamed': {
          res.writeHead(200)
          const chunk = Buffer.alloc(1024 * 1024, 'x')
          for (let i = 0; i < 11; i++) res.write(chunk)
          res.end(); break
        }
        case '/missing':
          res.writeHead(404); res.end('nope'); break
        default:
          res.writeHead(500); res.end()
      }
    })
    feedPort = await listen(feed)

    auth = http.createServer((req, res) => {
      const ok = req.headers.authorization === 'Bearer good' && req.headers['ocs-apirequest'] === 'true'
      res.writeHead(ok ? 200 : 401); res.end()
    })
    authPort = await listen(auth)

    const ocUserUrl = `http://127.0.0.1:${authPort}/user`
    strict = createProxyServer({ ocUserUrl, lookup: fakeLookup('127.0.0.1') })
    strictPort = await listen(strict)
    lenient = createProxyServer({ ocUserUrl, lookup: fakeLookup('127.0.0.1'), isPrivate: () => false })
    lenientPort = await listen(lenient)
  })

  after(() => { for (const s of [feed, auth, strict, lenient]) s.close() })

  const via = (port, target, init = {}) => fetch(
    `http://127.0.0.1:${port}/ics-proxy/${encodeURIComponent(target)}`,
    { headers: { Authorization: 'Bearer good' }, ...init },
  )
  const feedUrl = (path) => `http://feed.test:${feedPort}${path}`

  describe('auth and request shape', () => {
    test('no token → 401 with a Bearer challenge', async () => {
      const r = await fetch(`http://127.0.0.1:${strictPort}/ics-proxy/${encodeURIComponent(feedUrl('/feed.ics'))}`)
      assert.equal(r.status, 401)
      assert.equal(r.headers.get('www-authenticate'), 'Bearer')
    })
    test('token OpenCloud rejects → 401', async () => {
      const r = await via(strictPort, feedUrl('/feed.ics'), { headers: { Authorization: 'Bearer bad' } })
      assert.equal(r.status, 401)
    })
    test('POST → 405', async () => {
      const r = await via(strictPort, feedUrl('/feed.ics'), { method: 'POST' })
      assert.equal(r.status, 405)
    })
    test('path outside the prefix → 404', async () => {
      const r = await fetch(`http://127.0.0.1:${strictPort}/other`, { headers: { Authorization: 'Bearer good' } })
      assert.equal(r.status, 404)
    })
    test('malformed percent-encoding → 400, process survives', async () => {
      const r = await fetch(`http://127.0.0.1:${strictPort}/ics-proxy/%ZZ`, { headers: { Authorization: 'Bearer good' } })
      assert.equal(r.status, 400)
      assert.equal((await via(strictPort, 'not a url')).status, 400)
    })
  })

  describe('SSRF guard', () => {
    for (const target of [
      'http://127.0.0.1:1/', 'http://[::1]:1/', 'http://[::ffff:7f00:1]:1/', 'http://[64:ff9b::7f00:1]:1/',
      'http://169.254.169.254/latest/meta-data/', 'http://2130706433/', 'http://10.0.0.1/',
    ]) test(`literal ${target} is refused before connecting`, async () => {
      const r = await via(strictPort, target)
      assert.equal(r.status, 502)
      assert.match(await r.text(), /private address/)
    })

    test('a hostname is checked inside the socket lookup', async () => {
      // feed.test resolves (via the injected lookup) to 127.0.0.1 — the guard
      // must catch it there, i.e. at connect time, not through a pre-check.
      const r = await via(strictPort, feedUrl('/feed.ics'))
      assert.equal(r.status, 502)
      assert.match(await r.text(), /private address/)
    })
    test('an unresolvable hostname → 502', async () => {
      const r = await via(strictPort, `http://nxdomain.test/x.ics`)
      assert.equal(r.status, 502)
    })
    test('non-http schemes are refused', async () => {
      for (const t of ['ftp://feed.test/x.ics', 'file:///etc/passwd', 'gopher://feed.test/']) {
        const r = await via(strictPort, t)
        assert.equal(r.status, 502)
        assert.match(await r.text(), /only http\/https/)
      }
    })
    test('a redirect to a private literal is refused on the hop', async () => {
      // First hop allowed (guard off for the lenient instance's lookup path is
      // not involved: the redirect target is a literal, which requestOnce checks
      // with the real isPrivateAddress on the strict instance).
      const r = await via(strictPort, feedUrl('/to-private'))
      assert.equal(r.status, 502)
    })
  })

  describe('fetch path (guard disabled)', () => {
    test('serves the feed with hardened headers, upstream Content-Type discarded', async () => {
      const r = await via(lenientPort, feedUrl('/feed.ics'))
      assert.equal(r.status, 200)
      assert.equal(await r.text(), ICS)
      assert.equal(r.headers.get('content-type'), 'text/calendar; charset=utf-8')
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
      assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; sandbox")
      assert.match(r.headers.get('content-disposition'), /attachment/)
    })
    test('follows a redirect', async () => {
      const r = await via(lenientPort, feedUrl('/redirect'))
      assert.equal(r.status, 200)
      assert.equal(await r.text(), ICS)
    })
    test('gives up on a redirect loop', async () => {
      const r = await via(lenientPort, feedUrl('/loop'))
      assert.equal(r.status, 502)
      assert.match(await r.text(), /too many redirects/)
    })
    test('HEAD answers without a body', async () => {
      const r = await via(lenientPort, feedUrl('/feed.ics'), { method: 'HEAD' })
      assert.equal(r.status, 200)
      assert.equal(await r.text(), '')
    })
    test('passes an upstream error status through', async () => {
      const r = await via(lenientPort, feedUrl('/missing'))
      assert.equal(r.status, 404)
    })
    test('refuses a feed that declares itself too large', async () => {
      const r = await via(lenientPort, feedUrl('/big-declared'))
      assert.equal(r.status, 502)
      assert.match(await r.text(), /too large/)
    })
    test('aborts a feed that streams past the cap', async () => {
      const r = await via(lenientPort, feedUrl('/big-streamed'))
      assert.equal(r.status, 502)
      assert.match(await r.text(), /too large/)
    })
  })
})
