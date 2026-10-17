import { ref, watch } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { parseEvents, safeColor, type CalendarEvent } from '@/services/caldav'
import { SUBSCRIPTIONS_STORAGE_PREFIX, SUBSCRIPTIONS_WEBDAV_DIR } from '@/constants'
import { useI18n } from '@/composables/useI18n'

export interface IcsSubscription {
  id: string
  url: string
  name: string
  color: string
  enabled: boolean
}

const STORAGE_KEY_PREFIX = SUBSCRIPTIONS_STORAGE_PREFIX
const WEBDAV_DIR = SUBSCRIPTIONS_WEBDAV_DIR
const WEBDAV_FILE = 'subscriptions.json'

const DEFAULT_COLOR = '#e67e22'

// subscriptions.json lives in the user's WebDAV space and can be edited by
// any client, so its entries are checked before use. The colour in particular
// ends up in a style binding and must not carry url(...) or similar.
export function sanitizeSubscriptions(raw: unknown): IcsSubscription[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((s) => {
    if (!s || typeof s !== 'object') return []
    const { id, url, name, color, enabled } = s as Record<string, unknown>
    if (typeof id !== 'string' || typeof url !== 'string' || typeof name !== 'string') return []
    return [{ id, url, name, color: safeColor(color) ?? DEFAULT_COLOR, enabled: enabled !== false }]
  })
}

// ── localStorage (cache / offline fallback) ───────────────────────────────────

function loadFromStorage(userId: string): IcsSubscription[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + userId)
    return raw ? sanitizeSubscriptions(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

/** Returns false when the write fails (quota exceeded, private mode): the
 *  in-memory list keeps working and the server copy is unaffected, but the
 *  offline cache is not kept. The caller surfaces that to the user. */
function saveToStorage(userId: string, subs: IcsSubscription[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + userId, JSON.stringify(subs))
    return true
  } catch {
    return false
  }
}

// Feed URLs are often capability URLs — Google's and Outlook's private feeds
// carry their secret in the path — and localStorage outlives the login, so
// the cache must not. See flushAndForget() for the unsynced case.
function forgetCache(userId: string) {
  if (!userId) return
  try { localStorage.removeItem(STORAGE_KEY_PREFIX + userId) } catch { /* ignore */ }
}

// ── unsynced marker ───────────────────────────────────────────────────────────
// Records that the local list holds changes the server has not confirmed. It
// lives in localStorage rather than in a closure variable so it survives a page
// reload — without that, a write that failed (server restarting, token expired,
// tab closed within the debounce window) left no trace at all, and the next
// load happily replaced the local list with the older server copy.

function dirtyKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}_unsynced`
}

function markUnsynced(userId: string) {
  if (!userId) return
  try { localStorage.setItem(dirtyKey(userId), '1') } catch { /* quota — nothing we can do */ }
}

function clearUnsynced(userId: string) {
  if (!userId) return
  try { localStorage.removeItem(dirtyKey(userId)) } catch { /* ignore */ }
}

function hasUnsynced(userId: string): boolean {
  try { return localStorage.getItem(dirtyKey(userId)) === '1' } catch { return false }
}

// Union by id, local winning on conflict. A subscription present only locally is
// one whose write never reached the server; keeping it is the only way it
// survives. The trade-off is that a deletion that was never synced reappears —
// deliberate, because a resurrected entry can be deleted again in one click,
// whereas a lost feed URL is gone for good.
export function mergeSubscriptions(
  local: IcsSubscription[],
  server: IcsSubscription[],
): IcsSubscription[] {
  const byId = new Map(server.map(s => [s.id, s]))
  for (const s of local) byId.set(s.id, s)
  return [...byId.values()]
}

// ── WebDAV Storage ────────────────────────────────────────────────────────────

function webdavUrl(userId: string): string {
  return `/remote.php/dav/files/${encodeURIComponent(userId)}/${WEBDAV_DIR}/${WEBDAV_FILE}`
}

function webdavDirUrl(userId: string): string {
  return `/remote.php/dav/files/${encodeURIComponent(userId)}/${WEBDAV_DIR}/`
}

export interface ServerState {
  subs: IcsSubscription[]
  etag: string | null
}

async function loadFromServer(userId: string, accessToken: string): Promise<ServerState | null> {
  try {
    const res = await fetch(webdavUrl(userId), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    // The ETag is what makes the conditional write below possible. A server that
    // does not send one simply gets unconditional writes, exactly as before.
    const etag = res.headers?.get?.('etag') ?? null
    return { subs: sanitizeSubscriptions(await res.json()), etag }
  } catch {
    return null
  }
}

export interface WriteResult {
  ok: boolean
  etag: string | null
  /** The file changed since we last read it — our write was refused, not applied. */
  conflict: boolean
}

// The whole list is replaced on every write, so without a precondition a client
// holding a stale copy silently discards whatever another client added in the
// meantime. `If-Match` turns that into a 412 the caller can resolve by merging.
async function saveToServer(
  userId: string,
  accessToken: string,
  subs: IcsSubscription[],
  etag: string | null,
  // keepalive lets the request finish while the page navigates away (logout)
  { keepalive = false }: { keepalive?: boolean } = {},
): Promise<WriteResult> {
  const url = webdavUrl(userId)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
  if (etag) headers['If-Match'] = etag

  try {
    let res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(subs), keepalive })
    if (res.status === 409) {
      // Parent directory missing — create it first.
      await fetch(webdavDirUrl(userId), {
        method: 'MKCOL',
        headers: { Authorization: `Bearer ${accessToken}` },
        keepalive,
      })
      res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(subs), keepalive })
    }
    if (res.status === 412) return { ok: false, etag: null, conflict: true }
    return {
      ok: res.ok,
      etag: res.ok ? (res.headers?.get?.('etag') ?? null) : null,
      conflict: false,
    }
  } catch {
    // Server save failure is non-fatal — localStorage cache remains valid.
    return { ok: false, etag: null, conflict: false }
  }
}

// ── composable ────────────────────────────────────────────────────────────────

export function useSubscriptions(
  userId: () => string,
  accessToken: () => string,
  onError?: (name: string, message: string, url: string) => void,
  onSyncError?: (message: string) => void,
) {
  const { t } = useI18n()
  const subscriptions = ref<IcsSubscription[]>([])
  const subscriptionEvents = ref<CalendarEvent[]>([])
  const subscriptionErrors = ref<Record<string, string>>({})
  // IDs of subscriptions whose feed is being fetched right now. Feeds come
  // through the proxy from third-party servers and can take seconds; without
  // this the sidebar gave no sign that anything was happening.
  const fetchingSubscriptions = ref<ReadonlySet<string>>(new Set())

  function setFetching(id: string, on: boolean) {
    const next = new Set(fetchingSubscriptions.value)
    if (on) next.add(id); else next.delete(id)
    fetchingSubscriptions.value = next
  }

  // Incremented on every logout or user-switch. Each async operation captures
  // the value at start and bails silently if it has changed by the time it
  // tries to write, preventing stale results from a previous session from
  // leaking into the current one.
  let session = 0

  // Set when persist() writes to localStorage only (no token available yet).
  // Tells load() that local state is newer than whatever the server holds, so
  // a late-arriving token should push local data to the server rather than
  // overwrite it with an older server copy.
  let locallyModified = false
  // ETag of the copy this tab last saw. Sent as If-Match so a write cannot
  // silently clobber changes another tab or device made in the meantime.
  let serverEtag: string | null = null
  const MAX_CONFLICT_RETRIES = 3
  // Incremented every time locallyModified is set to true. A write callback
  // captures the version at launch and may only clear the flag when it matches,
  // preventing a stale in-flight write from wiping a newer offline edit.
  let modifyVersion = 0

  // Writes the list, resolving a concurrent modification instead of overwriting
  // it. Returns the list that actually reached the server — after a conflict
  // that is the merge of ours and theirs, not what the caller passed in.
  async function pushToServer(
    uid: string,
    token: string,
    subs: IcsSubscription[],
  ): Promise<{ ok: boolean; list: IcsSubscription[] }> {
    let payload = subs
    for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
      const res = await saveToServer(uid, token, payload, serverEtag)
      if (res.ok) {
        serverEtag = res.etag
        return { ok: true, list: payload }
      }
      if (!res.conflict) return { ok: false, list: payload }
      // Someone else wrote since we last read. Take their version and layer
      // ours on top rather than discarding either side.
      const fresh = await loadFromServer(uid, token)
      if (fresh === null) return { ok: false, list: payload }
      serverEtag = fresh.etag
      payload = mergeSubscriptions(payload, fresh.subs)
    }
    return { ok: false, list: payload }
  }

  async function load() {
    const uid = userId()
    const token = accessToken()
    if (!uid) return

    const mySession = session
    // Captured before the await: a change made while the GET is in flight has
    // already scheduled its own write, so this load must not push as well.
    const unsyncedAtStart = locallyModified || hasUnsynced(uid)
    // Try server first; fall back to local cache.
    const server = token ? await loadFromServer(uid, token) : null
    if (mySession !== session) return  // user switched or logged out while we waited
    if (server !== null) {
      serverEtag = server.etag
      // Re-read after the await too: a subscription added mid-flight must not be
      // dropped by the replace branch below.
      if (locallyModified || hasUnsynced(uid)) {
        // Local state holds changes the server never confirmed. Merge instead of
        // replacing. On a fresh page load the in-memory ref is still empty, so
        // the local side comes from the cache.
        const local = subscriptions.value.length ? subscriptions.value : loadFromStorage(uid)
        const merged = mergeSubscriptions(local, server.subs)
        const capturedVersion = modifyVersion
        subscriptions.value = merged
        persistToStorage(uid, merged)
        if (!unsyncedAtStart) return  // mid-flight change — its own write is pending
        const { ok, list } = await pushToServer(uid, token, merged)
        if (mySession !== session) return
        if (ok && modifyVersion === capturedVersion) {
          locallyModified = false
          clearUnsynced(uid)
          if (list !== merged) {
            subscriptions.value = list
            persistToStorage(uid, list)
          }
        }
      } else {
        subscriptions.value = server.subs
        // Keep local cache in sync.
        persistToStorage(uid, server.subs)
        locallyModified = false
      }
    } else {
      subscriptions.value = loadFromStorage(uid)
    }
  }

  let writeTimer: ReturnType<typeof setTimeout> | null = null

  // Storage wrapper: a failed localStorage write used to throw out of load()
  // and skip the feed fetches entirely, leaving the list rendered but never
  // persisted and never fetched (issue #6).
  function persistToStorage(uid: string, subs: IcsSubscription[]) {
    if (!saveToStorage(uid, subs)) {
      onSyncError?.(t('Subscriptions could not be stored in this browser - they will not survive a page reload'))
    }
  }

  function persist() {
    const uid = userId()
    persistToStorage(uid, subscriptions.value)
    // Debounce server writes: rapid successive changes cancel the previous
    // pending write so only the latest snapshot reaches the server.
    if (writeTimer !== null) clearTimeout(writeTimer)
    // Snapshot both uid and data at schedule time so a user switch before the
    // timer fires cannot redirect the write to a different account.
    const snapshotUid = userId()
    const snapshotSubs = [...subscriptions.value]
    const token = accessToken()
    if (!token) {
      // No token yet — mark as locally modified so a late token arrival
      // pushes this state to the server instead of pulling an older copy.
      modifyVersion++
      locallyModified = true
      markUnsynced(snapshotUid)
      return
    }
    const capturedVersion = modifyVersion
    // Marked before the write, cleared only once the server confirms. If the tab
    // is closed inside the debounce window, or the write fails, the marker
    // outlives this page and the next load merges rather than overwrites.
    markUnsynced(snapshotUid)
    const mySession = session
    writeTimer = setTimeout(() => {
      writeTimer = null
      const currentToken = accessToken()
      if (snapshotUid && currentToken) {
        pushToServer(snapshotUid, currentToken, snapshotSubs).then(({ ok, list }) => {
          if (ok) {
            if (modifyVersion === capturedVersion) {
              locallyModified = false
              clearUnsynced(snapshotUid)
              if (list !== snapshotSubs && mySession === session) {
                // A concurrent change was merged in — adopt the reconciled list
                // so the UI shows what the server now holds.
                subscriptions.value = list
                persistToStorage(snapshotUid, list)
              }
            }
          } else {
            // Previously silent: no flag, no retry, no message — the change
            // existed only in this tab until the next load quietly dropped it.
            modifyVersion++
            locallyModified = true
            onSyncError?.(t('Subscription could not be saved on the server - kept locally, retried on the next load'))
          }
        })
      }
    }, 300)
  }

  function addSubscription(url: string, name: string, color: string) {
    const sub = { id: uuidv4(), url, name, color, enabled: true }
    subscriptions.value = [...subscriptions.value, sub]
    persist()
    // Fetch only the new feed: fetchAll() used to re-download every feed and
    // overlap with the watcher's own fetchAll, downloading the same feed twice.
    fetchOne(sub)
  }

  function removeSubscription(id: string) {
    subscriptions.value = subscriptions.value.filter(s => s.id !== id)
    subscriptionEvents.value = subscriptionEvents.value.filter(e => !e.uid.startsWith(`sub_${id}_`))
    const errs = { ...subscriptionErrors.value }
    delete errs[id]
    subscriptionErrors.value = errs
    persist()
  }

  function toggleSubscription(id: string) {
    subscriptions.value = subscriptions.value.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s)
    persist()
    if (subscriptions.value.find(s => s.id === id)?.enabled) {
      fetchOne(subscriptions.value.find(s => s.id === id)!)
    } else {
      subscriptionEvents.value = subscriptionEvents.value.filter(e => !e.uid.startsWith(`sub_${id}_`))
    }
  }

  function proxyUrl(url: string): string {
    return `/ics-proxy/${encodeURIComponent(url)}`
  }

  // One controller per in-flight feed fetch: a newer fetch for the same feed
  // (or a user switch) aborts the previous one, so two responses for the same
  // feed can no longer race with "last one wins".
  const feedControllers = new Map<string, AbortController>()

  async function fetchOne(sub: IcsSubscription) {
    const mySession = session
    feedControllers.get(sub.id)?.abort()
    const ctrl = new AbortController()
    feedControllers.set(sub.id, ctrl)
    setFetching(sub.id, true)
    try {
      const res = await fetch(proxyUrl(sub.url), {
        headers: accessToken() ? { Authorization: `Bearer ${accessToken()}` } : {},
        signal: ctrl.signal,
      })
      if (!res.ok) {
        const reasons: Record<number, string> = {
          400: t('Invalid request'),
          401: t('Access denied (sign-in required)'),
          403: t('Access denied'),
          404: t('Calendar not found'),
          410: t('Calendar was permanently removed'),
          429: t('Too many requests - try again later'),
          500: t('Server error'),
          502: t('Calendar feed unreachable or rejected by the proxy'),
          503: t('Service unavailable'),
        }
        const reason = reasons[res.status] ?? t('Unknown error')
        throw new Error(`HTTP ${res.status} - ${reason}`)
      }
      const icsText = await res.text()
      if (mySession !== session) return  // user switched or logged out while fetching
      const current = subscriptions.value.find(s => s.id === sub.id)
      if (!current || !current.enabled) return  // subscription was deleted or disabled while fetching
      // A misconfigured /ics-proxy/ route falls through to the OpenCloud SPA, which
      // answers 200 with index.html. Without this check parseEvents() would swallow
      // the HTML into an empty event list and the subscription would look healthy.
      if (!/^\s*BEGIN:VCALENDAR/i.test(icsText)) {
        const contentType = res.headers?.get?.('content-type') ?? ''
        throw new Error(
          contentType.includes('html')
            ? t('Received HTML instead of iCal - ICS proxy unreachable or not configured')
            : t('Not a valid iCal file (BEGIN:VCALENDAR missing)'),
        )
      }
      // parseEvents uses a placeholder href since subscriptions have no CalDAV href
      const parsed = parseEvents(icsText, sub.url)
      // prefix all UIDs to avoid collisions with CalDAV events
      const prefixed = parsed.map(e => ({
        ...e,
        uid: `sub_${sub.id}_${e.uid}`,
        seriesUid: e.seriesUid ? `sub_${sub.id}_${e.seriesUid}` : undefined,
        color: sub.color,
        calendarHref: '',
      }))
      // replace events for this subscription
      subscriptionEvents.value = [
        ...subscriptionEvents.value.filter(e => !e.uid.startsWith(`sub_${sub.id}_`)),
        ...prefixed,
      ]
      const errs = { ...subscriptionErrors.value }
      delete errs[sub.id]
      subscriptionErrors.value = errs
    } catch (e) {
      // Aborted (superseded by a newer fetch for this feed) or from a previous
      // session: the result is obsolete, not an error the user should see.
      if (mySession !== session || ctrl.signal.aborted) return
      const msg = e instanceof Error ? e.message : String(e)
      subscriptionErrors.value = { ...subscriptionErrors.value, [sub.id]: msg }
      onError?.(sub.name, msg, sub.url)
    } finally {
      // Only the fetch that is still current may clear the flag; a superseded
      // one would hide the spinner of its replacement.
      if (feedControllers.get(sub.id) === ctrl) {
        feedControllers.delete(sub.id)
        setFetching(sub.id, false)
      }
    }
  }

  async function fetchAll() {
    const enabled = subscriptions.value.filter(s => s.enabled)
    await Promise.all(enabled.map(fetchOne))
  }

  // Logout. Changes the server never confirmed get one last write with the
  // bearer that is still valid at this moment — OpenCloud Web clears it from
  // the store before the identity provider's logout endpoint sees it, which is
  // also what useAuth relies on to revoke the app token. keepalive lets the
  // request outlive the page. Then the cache goes, confirmed or not.
  //
  // Earlier versions kept an unsynced cache across logout so the next login
  // could merge it. That protected against "the write failed before and fails
  // again now" — which costs re-adding a feed — at the price of leaving feed
  // URLs, secrets included, in the browser profile of a shared machine. Only
  // without any bearer at all is the cache still kept; there is nothing else
  // that could carry the change.
  function flushAndForget(uid: string, bearer: string) {
    if (!uid) return
    if (writeTimer !== null) { clearTimeout(writeTimer); writeTimer = null }
    if (hasUnsynced(uid)) {
      if (!bearer) return
      const list = subscriptions.value.length ? subscriptions.value : loadFromStorage(uid)
      void saveToServer(uid, bearer, list, serverEtag, { keepalive: true })
      clearUnsynced(uid)
    }
    forgetCache(uid)
  }

  // Reload when userId changes OR when accessToken first becomes available.
  // If userId arrives before accessToken, the initial load() falls back to
  // localStorage; this watcher retries from the server once the token is ready.
  watch([userId, accessToken], async ([uid, token], old) => {
    const [oldUid, oldToken] = old ?? [undefined, undefined]
    if (!uid) {
      session++  // invalidate all in-flight requests for the previous user
      for (const c of feedControllers.values()) c.abort()
      feedControllers.clear()
      locallyModified = false
      modifyVersion++
      subscriptions.value = []
      subscriptionEvents.value = []
      subscriptionErrors.value = {}
      fetchingSubscriptions.value = new Set()
      if (oldUid) flushAndForget(oldUid, oldToken || '')
      return
    }
    // Token gone while the user store still holds the user: the usual order
    // on logout. The in-memory list stays — load() refetches on return.
    if (!token && oldToken) flushAndForget(uid, oldToken)
    if (uid !== oldUid || (token && !oldToken)) {
      session++  // invalidate requests from the previous user/session
      for (const c of feedControllers.values()) c.abort()
      feedControllers.clear()
      if (uid !== oldUid) {
        // Clear all state immediately so user A's data is never visible
        // while user B's content is loading.
        locallyModified = false
        modifyVersion++
        subscriptions.value = []
        subscriptionEvents.value = []
        subscriptionErrors.value = {}
      }
      // load() decides on its own whether to merge or replace, based on the
      // persisted unsynced marker — no need to tell it that a token just arrived.
      await load()
      fetchAll()
    }
  }, { immediate: true })

  return {
    subscriptions,
    subscriptionEvents,
    subscriptionErrors,
    fetchingSubscriptions,
    addSubscription,
    removeSubscription,
    toggleSubscription,
    fetchAll,
  }
}
