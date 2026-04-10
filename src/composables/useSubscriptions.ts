import { ref, watch } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { parseEvents, type CalendarEvent } from '@/services/caldav'

export interface IcsSubscription {
  id: string
  url: string
  name: string
  color: string
  enabled: boolean
}

const STORAGE_KEY_PREFIX = 'agenda_subscriptions_'
const WEBDAV_DIR = '.agenda'
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

async function saveToServer(userId: string, accessToken: string, subs: IcsSubscription[]): Promise<void> {
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
  } catch {
    // Server save failure is non-fatal — localStorage cache remains valid.
  }
}

// ── composable ────────────────────────────────────────────────────────────────

export function useSubscriptions(userId: () => string, accessToken: () => string) {
  const subscriptions = ref<IcsSubscription[]>([])
  const subscriptionEvents = ref<CalendarEvent[]>([])
  const subscriptionErrors = ref<Record<string, string>>({})

  // Incremented on every logout or user-switch. Each async operation captures
  // the value at start and bails silently if it has changed by the time it
  // tries to write, preventing stale results from a previous session from
  // leaking into the current one.
  let session = 0

  async function load() {
    const uid = userId()
    const token = accessToken()
    if (!uid) return

    const mySession = session
    // Try server first; fall back to local cache.
    const serverSubs = token ? await loadFromServer(uid, token) : null
    if (mySession !== session) return  // user switched or logged out while we waited
    if (serverSubs !== null) {
      subscriptions.value = serverSubs
      // Keep local cache in sync.
      saveToStorage(uid, serverSubs)
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
    writeTimer = setTimeout(() => {
      writeTimer = null
      const currentToken = accessToken()
      if (snapshotUid && currentToken) saveToServer(snapshotUid, currentToken, snapshotSubs)
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const icsText = await res.text()
      if (mySession !== session) return  // user switched or logged out while fetching
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
      subscriptionErrors.value = {
        ...subscriptionErrors.value,
        [sub.id]: e instanceof Error ? e.message : String(e),
      }
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
      subscriptions.value = []
      subscriptionEvents.value = []
      subscriptionErrors.value = {}
      return
    }
    if (uid !== oldUid || (token && !oldToken)) {
      session++  // invalidate requests from the previous user/session
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
