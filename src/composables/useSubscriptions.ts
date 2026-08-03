import { ref, watch } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { parseEvents, type CalendarEvent } from '@/services/caldav'
import { SUBSCRIPTIONS_STORAGE_PREFIX, SUBSCRIPTIONS_WEBDAV_DIR } from '@/constants'

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

// ── localStorage (cache / offline fallback) ───────────────────────────────────

function loadFromStorage(userId: string): IcsSubscription[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + userId)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveToStorage(userId: string, subs: IcsSubscription[]) {
  localStorage.setItem(STORAGE_KEY_PREFIX + userId, JSON.stringify(subs))
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

async function loadFromServer(userId: string, accessToken: string): Promise<IcsSubscription[] | null> {
  try {
    const res = await fetch(webdavUrl(userId), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    return await res.json() as IcsSubscription[]
  } catch {
    return null
  }
}

async function saveToServer(userId: string, accessToken: string, subs: IcsSubscription[]): Promise<boolean> {
  try {
    const url = webdavUrl(userId)
    let res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(subs),
    })
    if (res.status === 409) {
      // Parent directory missing — create it first.
      await fetch(webdavDirUrl(userId), {
        method: 'MKCOL',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      res = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(subs),
      })
    }
    return res.ok
  } catch {
    // Server save failure is non-fatal — localStorage cache remains valid.
    return false
  }
}

// ── composable ────────────────────────────────────────────────────────────────

export function useSubscriptions(
  userId: () => string,
  accessToken: () => string,
  onError?: (name: string, message: string, url: string) => void,
  onSyncError?: (message: string) => void,
) {
  const subscriptions = ref<IcsSubscription[]>([])
  const subscriptionEvents = ref<CalendarEvent[]>([])
  const subscriptionErrors = ref<Record<string, string>>({})

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
  // Incremented every time locallyModified is set to true. A write callback
  // captures the version at launch and may only clear the flag when it matches,
  // preventing a stale in-flight write from wiping a newer offline edit.
  let modifyVersion = 0

  async function load() {
    const uid = userId()
    const token = accessToken()
    if (!uid) return

    const mySession = session
    // Captured before the await: a change made while the GET is in flight has
    // already scheduled its own write, so this load must not push as well.
    const unsyncedAtStart = locallyModified || hasUnsynced(uid)
    // Try server first; fall back to local cache.
    const serverSubs = token ? await loadFromServer(uid, token) : null
    if (mySession !== session) return  // user switched or logged out while we waited
    if (serverSubs !== null) {
      // Re-read after the await too: a subscription added mid-flight must not be
      // dropped by the replace branch below.
      if (locallyModified || hasUnsynced(uid)) {
        // Local state holds changes the server never confirmed. Merge instead of
        // replacing. On a fresh page load the in-memory ref is still empty, so
        // the local side comes from the cache.
        const local = subscriptions.value.length ? subscriptions.value : loadFromStorage(uid)
        const merged = mergeSubscriptions(local, serverSubs)
        const capturedVersion = modifyVersion
        subscriptions.value = merged
        saveToStorage(uid, merged)
        if (!unsyncedAtStart) return  // mid-flight change — its own write is pending
        const ok = await saveToServer(uid, token, merged)
        if (mySession !== session) return
        if (ok && modifyVersion === capturedVersion) {
          locallyModified = false
          clearUnsynced(uid)
        }
      } else {
        subscriptions.value = serverSubs
        // Keep local cache in sync.
        saveToStorage(uid, serverSubs)
        locallyModified = false
      }
    } else {
      subscriptions.value = loadFromStorage(uid)
    }
  }

  let writeTimer: ReturnType<typeof setTimeout> | null = null

  function persist() {
    const uid = userId()
    saveToStorage(uid, subscriptions.value)
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
    writeTimer = setTimeout(() => {
      writeTimer = null
      const currentToken = accessToken()
      if (snapshotUid && currentToken) {
        saveToServer(snapshotUid, currentToken, snapshotSubs).then(ok => {
          if (ok) {
            if (modifyVersion === capturedVersion) {
              locallyModified = false
              clearUnsynced(snapshotUid)
            }
          } else {
            // Previously silent: no flag, no retry, no message — the change
            // existed only in this tab until the next load quietly dropped it.
            modifyVersion++
            locallyModified = true
            onSyncError?.('Abonnement konnte nicht auf dem Server gespeichert werden – lokal gesichert, erneuter Versuch beim nächsten Laden')
          }
        })
      }
    }, 300)
  }

  function addSubscription(url: string, name: string, color: string) {
    subscriptions.value = [...subscriptions.value, { id: uuidv4(), url, name, color, enabled: true }]
    persist()
    fetchAll()
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

  async function fetchOne(sub: IcsSubscription) {
    const mySession = session
    try {
      const res = await fetch(proxyUrl(sub.url), {
        headers: accessToken() ? { Authorization: `Bearer ${accessToken()}` } : {},
      })
      if (!res.ok) {
        const reasons: Record<number, string> = {
          400: 'Ungültige Anfrage',
          401: 'Zugriff verweigert (Anmeldung erforderlich)',
          403: 'Zugriff verweigert',
          404: 'Kalender nicht gefunden',
          410: 'Kalender wurde permanent entfernt',
          429: 'Zu viele Anfragen – bitte später versuchen',
          500: 'Server-Fehler',
          503: 'Dienst nicht verfügbar',
        }
        const reason = reasons[res.status] ?? `Unbekannter Fehler`
        throw new Error(`HTTP ${res.status} – ${reason}`)
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
            ? 'HTML statt iCal erhalten – ICS-Proxy nicht erreichbar oder nicht konfiguriert'
            : 'Keine gültige iCal-Datei (BEGIN:VCALENDAR fehlt)',
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
      if (mySession !== session) return  // discard errors from a previous session
      const msg = e instanceof Error ? e.message : String(e)
      subscriptionErrors.value = { ...subscriptionErrors.value, [sub.id]: msg }
      onError?.(sub.name, msg, sub.url)
    }
  }

  async function fetchAll() {
    const enabled = subscriptions.value.filter(s => s.enabled)
    await Promise.all(enabled.map(fetchOne))
  }

  // Reload when userId changes OR when accessToken first becomes available.
  // If userId arrives before accessToken, the initial load() falls back to
  // localStorage; this watcher retries from the server once the token is ready.
  watch([userId, accessToken], async ([uid, token], old) => {
    const [oldUid, oldToken] = old ?? [undefined, undefined]
    if (!uid) {
      session++  // invalidate all in-flight requests for the previous user
      locallyModified = false
      modifyVersion++
      subscriptions.value = []
      subscriptionEvents.value = []
      subscriptionErrors.value = {}
      return
    }
    if (uid !== oldUid || (token && !oldToken)) {
      session++  // invalidate requests from the previous user/session
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
    addSubscription,
    removeSubscription,
    toggleSubscription,
    fetchAll,
  }
}
