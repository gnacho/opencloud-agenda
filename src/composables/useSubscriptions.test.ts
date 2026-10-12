import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'

// Drain the microtask queue fully (async watcher → load() → fetch() → assign)
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
import { useSubscriptions, mergeSubscriptions } from './useSubscriptions'

vi.mock('@/services/caldav', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/caldav')>(),
  parseEvents: () => [],
}))

// ── localStorage stub ─────────────────────────────────────────────────────────

const localStorageData: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => localStorageData[k] ?? null,
  setItem: (k: string, v: string) => { localStorageData[k] = v },
  removeItem: (k: string) => { delete localStorageData[k] },
})

beforeEach(() => {
  Object.keys(localStorageData).forEach(k => delete localStorageData[k])
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ── helpers ───────────────────────────────────────────────────────────────────

function makeSubs(uid: string, token: string) {
  const userId = ref(uid)
  const accessToken = ref(token)
  const result = useSubscriptions(() => userId.value, () => accessToken.value)
  return { userId, accessToken, ...result }
}

// ── Token-timing tests ────────────────────────────────────────────────────────

describe('useSubscriptions — accessToken timing', () => {
  it('loads from server when token arrives after userId', async () => {
    const serverSubs = [{ id: 'srv1', url: 'http://a.ics', name: 'A', color: '#f00', enabled: true }]
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('subscriptions.json')) {
        return { ok: true, json: async () => serverSubs } as Response
      }
      return { ok: false } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const { accessToken, subscriptions } = makeSubs('user-1', '')

    // userId set, no token yet — falls back to localStorage (empty)
    await flush()
    expect(subscriptions.value).toEqual([])

    // Token arrives later — should trigger reload from server
    accessToken.value = 'tok-abc'
    await flush()

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('subscriptions.json'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok-abc' }) }),
    )
    expect(subscriptions.value).toEqual(serverSubs)
  })

  it('does not issue a second server load when token was already present at mount', async () => {
    const serverSubs = [{ id: 'srv2', url: 'http://b.ics', name: 'B', color: '#0f0', enabled: true }]
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => serverSubs }) as Response)
    vi.stubGlobal('fetch', fetchMock)

    makeSubs('user-2', 'tok-present')

    await nextTick()
    await nextTick()

    const serverCalls = (fetchMock.mock.calls as unknown[][]).filter((args) =>
      String(args[0]).includes('subscriptions.json'),
    )
    // Exactly one GET (initial load) — no second load because token was already there
    expect(serverCalls).toHaveLength(1)
  })

  it('pushes local changes to server instead of overwriting when token arrives late', async () => {
    const serverSubs = [{ id: 'srv-old', url: 'http://old.ics', name: 'Old', color: '#888', enabled: true }]
    const localSub  = { id: 'local-1', url: 'http://new.ics', name: 'New', color: '#0f0', enabled: true }
    const putBodies: string[] = []

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { putBodies.push(init.body as string); return { ok: true } as Response }
      if (String(url).includes('subscriptions.json')) return { ok: true, json: async () => serverSubs } as Response
      return { ok: false } as Response
    }))

    const { accessToken, subscriptions, addSubscription } = makeSubs('user-late', '')

    await flush()
    // No token — loaded from localStorage (empty); user adds a subscription offline
    addSubscription(localSub.url, localSub.name, localSub.color)
    await flush()
    expect(subscriptions.value).toHaveLength(1)
    expect(subscriptions.value[0].url).toBe(localSub.url)

    // Token arrives — must NOT overwrite local changes with older server data
    accessToken.value = 'tok-late'
    await flush()

    // Merged, not replaced: the offline addition survives AND the entry that
    // already existed on the server (e.g. added on another device) is kept.
    // Before the merge landed, pushing local state wiped srv-old off the server.
    const urls = subscriptions.value.map(s => s.url)
    expect(urls).toContain(localSub.url)
    expect(urls).toContain('http://old.ics')

    // One PUT, carrying both
    expect(putBodies).toHaveLength(1)
    const saved = JSON.parse(putBodies[0]) as { url: string }[]
    expect(saved.map(s => s.url)).toEqual(expect.arrayContaining([localSub.url, 'http://old.ics']))
  })

  it('keeps locallyModified when the late-token push fails, so next reload retries', async () => {
    const serverSubs = [{ id: 'srv-old', url: 'http://old.ics', name: 'Old', color: '#888', enabled: true }]
    const localSub  = { id: 'local-2', url: 'http://new2.ics', name: 'New2', color: '#0f0', enabled: true }

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return { ok: false, status: 500 } as Response
      if (String(url).includes('subscriptions.json')) return { ok: true, json: async () => serverSubs } as Response
      return { ok: false } as Response
    }))

    const { accessToken, subscriptions, addSubscription } = makeSubs('user-fail', '')

    await flush()
    addSubscription(localSub.url, localSub.name, localSub.color)
    await flush()

    // Token arrives — push attempt fails (PUT returns 500)
    accessToken.value = 'tok-fail'
    await flush()

    // Local sub must still be in memory (not overwritten by old server copy);
    // the server entry is merged in rather than discarded.
    const urlsAfterFail = subscriptions.value.map(s => s.url)
    expect(urlsAfterFail).toContain(localSub.url)
    expect(urlsAfterFail).toContain('http://old.ics')
  })

  it('does not clear locallyModified when a stale online write resolves after a newer offline edit', async () => {
    // Scenario: user starts offline (no token), makes an edit, gets a token
    // (online write starts), loses token, makes another edit, old write resolves,
    // then gets token again — final load must push local state, not accept server copy.
    const serverSubs = [{ id: 'srv-stale', url: 'http://stale.ics', name: 'Stale', color: '#888', enabled: true }]

    let resolveOnlinePut!: (v: Response) => void
    let putCount = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putCount++
        return new Promise<Response>(r => { resolveOnlinePut = r })
      }
      if (String(url).includes('subscriptions.json')) return { ok: true, json: async () => serverSubs } as Response
      return { ok: false } as Response
    }))

    const { accessToken, subscriptions, addSubscription } = makeSubs('user-interleave', '')

    await flush()
    expect(subscriptions.value).toEqual([])  // started offline, localStorage empty

    // Offline edit #1
    addSubscription('http://sub-a.ics', 'Sub-A', '#f00')
    await flush()

    // Token arrives → debounce fires → PUT #1 in-flight
    accessToken.value = 'tok-1'
    await flush()
    vi.runAllTimers()
    await flush()
    expect(putCount).toBe(1)

    // Token lost → offline edit #2 → modifyVersion increments
    accessToken.value = ''
    addSubscription('http://sub-b.ics', 'Sub-B', '#00f')
    await flush()

    // PUT #1 resolves ok — capturedVersion mismatch must prevent clearing locallyModified
    resolveOnlinePut({ ok: true } as Response)
    await flush()

    // Token comes back → load() must push local state, not accept stale server copy
    accessToken.value = 'tok-2'
    await flush()

    // Both offline subs must be present; stale server sub must not have replaced them
    const urls = subscriptions.value.map(s => s.url)
    expect(urls).toContain('http://sub-a.ics')
    expect(urls).toContain('http://sub-b.ics')
    // The server entry is merged in, not discarded — what matters is that it did
    // not *replace* the two offline additions.
    expect(urls).toContain('http://stale.ics')
  })
})

// ── Write-ordering / debounce tests ───────────────────────────────────────────

describe('useSubscriptions — persist debounce', () => {
  it('coalesces rapid writes: server receives only the final snapshot', async () => {
    const putBodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') putBodies.push(init.body as string)
      return { ok: true, json: async () => [] } as Response
    }))

    const { addSubscription } = makeSubs('user-3', 'tok-xyz')

    await nextTick()
    await nextTick()

    // Two rapid adds before debounce fires
    addSubscription('http://c.ics', 'C', '#00f')
    addSubscription('http://d.ics', 'D', '#ff0')

    // No PUT yet — debounce window not elapsed
    expect(putBodies).toHaveLength(0)

    vi.runAllTimers()
    await nextTick()

    // Exactly one PUT containing both subscriptions
    expect(putBodies).toHaveLength(1)
    const saved = JSON.parse(putBodies[0]) as { url: string }[]
    expect(saved.map(s => s.url)).toEqual(['http://c.ics', 'http://d.ics'])
  })

  it('writes latest state when add is immediately followed by remove', async () => {
    const putBodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') putBodies.push(init.body as string)
      return { ok: true, json: async () => [] } as Response
    }))

    const { addSubscription, removeSubscription, subscriptions } = makeSubs('user-4', 'tok-abc')

    await nextTick()
    await nextTick()

    addSubscription('http://e.ics', 'E', '#abc')
    await nextTick()
    const addedId = subscriptions.value[0]?.id
    removeSubscription(addedId)
    await nextTick()

    vi.runAllTimers()
    await nextTick()

    // One PUT, result is empty (add + remove cancelled out)
    expect(putBodies).toHaveLength(1)
    expect(JSON.parse(putBodies[0])).toEqual([])
  })

  it('does not write user A data to user B when account switches before debounce fires', async () => {
    const writes: { uid: string; body: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') writes.push({ uid: String(url), body: init.body as string })
      return { ok: true, json: async () => [] } as Response
    }))

    const userId = ref('user-A')
    const accessToken = ref('tok')
    const { addSubscription } = useSubscriptions(() => userId.value, () => accessToken.value)

    await flush()

    // User A adds a subscription — debounce timer starts but has not fired yet
    addSubscription('http://a.ics', 'A-feed', '#f00')
    expect(writes).toHaveLength(0)

    // Account switches to user B before 300 ms
    userId.value = 'user-B'

    // Debounce fires — must write to user-A's path, not user-B's
    vi.runAllTimers()
    await flush()

    expect(writes).toHaveLength(1)
    expect(writes[0].uid).toContain('user-A')
    expect(writes[0].uid).not.toContain('user-B')
  })
})

// ── Logout / user-switch cleanup tests ───────────────────────────────────────

describe('useSubscriptions — logout cleanup', () => {
  it('clears subscriptionErrors when userId becomes empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as Response))

    const userId = ref('user-X')
    const accessToken = ref('tok')
    const { subscriptionErrors } = useSubscriptions(() => userId.value, () => accessToken.value)

    await flush()

    // Inject an error directly (simulates a failed fetchOne)
    subscriptionErrors.value = { 'sub-1': 'HTTP 404' }

    // Log out
    userId.value = ''
    await flush()

    expect(subscriptionErrors.value).toEqual({})
  })

  // Feed URLs can be capability URLs (Google/Outlook private feeds); the cache
  // must not outlive the login on a shared machine.
  it('removes the localStorage cache when userId becomes empty', async () => {
    const serverSubs = [{ id: 's', url: 'https://example.org/private-token.ics', name: 'S', color: '#f00', enabled: true }]
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('subscriptions.json')
        ? { ok: true, json: async () => serverSubs, headers: { get: () => null } } as unknown as Response
        : { ok: false } as Response))

    const { userId } = makeSubs('user-cache', 'tok')
    await flush()
    expect(localStorageData['agenda_subscriptions_user-cache']).toBeDefined()

    userId.value = ''
    await flush()
    expect(localStorageData['agenda_subscriptions_user-cache']).toBeUndefined()
  })

  it('removes the cache when the access token goes away while the user is still set', async () => {
    const serverSubs = [{ id: 's', url: 'https://example.org/x.ics', name: 'S', color: '#f00', enabled: true }]
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('subscriptions.json')
        ? { ok: true, json: async () => serverSubs, headers: { get: () => null } } as unknown as Response
        : { ok: false } as Response))

    const { accessToken, subscriptions } = makeSubs('user-tok', 'tok')
    await flush()
    expect(localStorageData['agenda_subscriptions_user-tok']).toBeDefined()

    // OpenCloud Web clears the token first on logout; the user store may lag
    accessToken.value = ''
    await flush()
    expect(localStorageData['agenda_subscriptions_user-tok']).toBeUndefined()
    // in-memory list untouched — a returning token simply reloads from the server
    expect(subscriptions.value).toEqual(serverSubs)
  })

  it('pushes unsynced changes with the still-valid bearer on logout, then drops the cache', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return { ok: true, headers: { get: () => '"e2"' } } as unknown as Response
      if (String(url).includes('subscriptions.json')) {
        return { ok: true, json: async () => [], headers: { get: () => '"e1"' } } as unknown as Response
      }
      return { ok: false } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const { accessToken, addSubscription } = makeSubs('user-flush', 'tok')
    await flush()
    // Debounced write still pending when the token disappears
    addSubscription('https://example.org/private-secret.ics', 'X', '#f00')
    expect(localStorageData['agenda_subscriptions_user-flush_unsynced']).toBe('1')

    accessToken.value = ''
    await flush()

    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(put).toBeDefined()
    expect(put![1]).toMatchObject({
      keepalive: true,
      headers: expect.objectContaining({ Authorization: 'Bearer tok', 'If-Match': '"e1"' }),
    })
    expect(JSON.parse(put![1]!.body as string).map((s: { url: string }) => s.url))
      .toEqual(['https://example.org/private-secret.ics'])
    expect(localStorageData['agenda_subscriptions_user-flush']).toBeUndefined()
    expect(localStorageData['agenda_subscriptions_user-flush_unsynced']).toBeUndefined()

    // The debounced write must not fire on top of the flush
    vi.advanceTimersByTime(1000)
    await flush()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1)
  })

  it('without any bearer, keeps an unsynced cache — nothing else could carry the change', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as Response))

    // No token: the add below stays local and marks the cache unsynced
    const { userId, addSubscription } = makeSubs('user-dirty', '')
    await flush()
    addSubscription('https://example.org/x.ics', 'X', '#f00')
    expect(localStorageData['agenda_subscriptions_user-dirty_unsynced']).toBe('1')

    userId.value = ''
    await flush()
    expect(localStorageData['agenda_subscriptions_user-dirty']).toBeDefined()
  })

  it('discards load() result that resolves after logout', async () => {
    let resolveLoad!: (v: Response) => void
    const slowFetch = vi.fn(() => new Promise<Response>(r => { resolveLoad = r }))
    vi.stubGlobal('fetch', slowFetch)

    const userId = ref('user-Y')
    const accessToken = ref('tok')
    const { subscriptions } = useSubscriptions(() => userId.value, () => accessToken.value)

    await flush()
    // load() is in flight — resolveLoad not called yet

    // Log out: clears state and increments session
    userId.value = ''
    await flush()
    expect(subscriptions.value).toEqual([])

    // Now the slow server response arrives — should be ignored
    resolveLoad({ ok: true, json: async () => [{ id: 'stale', url: 'http://x.ics', name: 'X', color: '#f00', enabled: true }] } as Response)
    await flush()

    // State must remain cleared, not repopulated with the old user's data
    expect(subscriptions.value).toEqual([])
  })

  it('discards fetchOne() events/errors that resolve after user switch', async () => {
    let resolveFeed!: (v: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('ics-proxy')) {
        return new Promise<Response>(r => { resolveFeed = r })
      }
      return Promise.resolve({ ok: false } as Response)
    }))

    const userId = ref('user-Z')
    const accessToken = ref('tok')
    const { subscriptions, subscriptionEvents, subscriptionErrors, fetchAll } = useSubscriptions(
      () => userId.value, () => accessToken.value,
    )
    await flush()

    // Seed a subscription and kick off a feed fetch — it hangs
    subscriptions.value = [{ id: 'sub-z', url: 'http://z.ics', name: 'Z', color: '#00f', enabled: true }]
    fetchAll()

    // Switch user before the feed response arrives
    userId.value = 'user-Z2'
    await flush()

    // Feed response for user-Z arrives now — must be discarded
    resolveFeed({ ok: true, text: async () => '' } as unknown as Response)
    await flush()

    expect(subscriptionEvents.value).toEqual([])
    expect(subscriptionErrors.value).toEqual({})
  })

  it('clears events and errors immediately when switching from user A to user B', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as Response))

    const userId = ref('user-A')
    const accessToken = ref('tok')
    const { subscriptions, subscriptionEvents, subscriptionErrors } = useSubscriptions(
      () => userId.value, () => accessToken.value,
    )
    await flush()

    // Pre-seed state as if user A had loaded subscriptions, events and an error
    subscriptions.value = [{ id: 'sub-a', url: 'http://a.ics', name: 'A', color: '#f00', enabled: true }]
    subscriptionEvents.value = [{ uid: 'sub_a_1' } as never]
    subscriptionErrors.value = { 'sub-a': 'HTTP 503' }

    // Switch directly to user B (not a logout — both are non-empty)
    userId.value = 'user-B'
    await nextTick()

    // All three must be cleared synchronously, before any fetch completes
    expect(subscriptions.value).toEqual([])
    expect(subscriptionEvents.value).toEqual([])
    expect(subscriptionErrors.value).toEqual({})
  })
})

// ── Feed content validation ───────────────────────────────────────────────────

describe('useSubscriptions — feed content validation', () => {
  // Seeds one enabled subscription and runs fetchOne() against the given feed response.
  async function fetchFeed(body: string, contentType: string) {
    const onError = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('ics-proxy')) {
        return {
          ok: true,
          status: 200,
          headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
          text: async () => body,
        } as unknown as Response
      }
      return { ok: false } as Response
    }))

    const userId = ref('user-V')
    const accessToken = ref('tok')
    const subs = useSubscriptions(() => userId.value, () => accessToken.value, onError)
    await flush()

    subs.subscriptions.value = [{ id: 'sub-v', url: 'http://v.ics', name: 'V', color: '#0f0', enabled: true }]
    await subs.fetchAll()
    await flush()

    return { ...subs, onError }
  }

  it('reports an error when the proxy route falls through to the OpenCloud SPA', async () => {
    // Exactly what an unconfigured /ics-proxy/ route returns: HTTP 200 + index.html
    const { subscriptionErrors, onError } = await fetchFeed(
      '<!DOCTYPE html><html lang="en"><head><base href="/"/>', 'text/html; charset=utf-8',
    )

    expect(subscriptionErrors.value['sub-v']).toMatch(/ICS-Proxy nicht erreichbar/)
    expect(onError).toHaveBeenCalledWith('V', expect.stringMatching(/ICS-Proxy/), 'http://v.ics')
  })

  it('reports an error for a 200 response that is not iCalendar', async () => {
    const { subscriptionErrors } = await fetchFeed('not a calendar at all', 'text/plain')

    expect(subscriptionErrors.value['sub-v']).toMatch(/BEGIN:VCALENDAR fehlt/)
  })

  it('accepts a valid feed and records no error', async () => {
    const { subscriptionErrors, onError } = await fetchFeed(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', 'text/calendar; charset=utf-8',
    )

    expect(subscriptionErrors.value).toEqual({})
    expect(onError).not.toHaveBeenCalled()
  })

  it('accepts a feed prefixed with a UTF-8 BOM', async () => {
    const { subscriptionErrors } = await fetchFeed(
      '﻿BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', 'text/calendar',
    )

    expect(subscriptionErrors.value).toEqual({})
  })
})

// ── Unsynced-marker durability ────────────────────────────────────────────────

describe('useSubscriptions — surviving a failed server write', () => {
  // The real incident: a subscription was added while the server happened to be
  // restarting. The PUT failed, nothing recorded that fact, and the next page
  // load replaced the local list with the older server copy — wiping the entry
  // from localStorage too. It was unrecoverable and completely silent.
  it('keeps a subscription whose write failed, across a reload', async () => {
    const serverSubs = [{ id: 'srv-1', url: 'http://old.ics', name: 'Old', color: '#888', enabled: true }]
    let putFails = true
    const putBodies: string[] = []

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putBodies.push(init.body as string)
        return { ok: !putFails, status: putFails ? 503 : 200 } as Response
      }
      if (String(url).includes('subscriptions.json')) return { ok: true, json: async () => serverSubs } as Response
      return { ok: false } as Response
    }))

    // Session 1 — user adds the feed, the write fails
    const s1 = makeSubs('user-reload', 'tok')
    await flush()
    s1.addSubscription('http://fortuna.ics', 'Fortuna', '#986a44')
    await flush()
    vi.runAllTimers()
    await flush()
    expect(putBodies).toHaveLength(1)

    // Session 2 — fresh composable, as after reloading the page. The server
    // still returns the old list; the addition must not be dropped.
    putFails = false
    const s2 = makeSubs('user-reload', 'tok')
    await flush()

    const urls = s2.subscriptions.value.map(x => x.url)
    expect(urls).toContain('http://fortuna.ics')
    expect(urls).toContain('http://old.ics')

    // …and it gets pushed up rather than only living locally
    const lastPut = JSON.parse(putBodies[putBodies.length - 1]) as { url: string }[]
    expect(lastPut.map(x => x.url)).toContain('http://fortuna.ics')
  })

  it('reports a failed write instead of swallowing it', async () => {
    const onSyncError = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return { ok: false, status: 500 } as Response
      if (String(url).includes('subscriptions.json')) return { ok: true, json: async () => [] } as Response
      return { ok: false } as Response
    }))

    const userId = ref('user-msg')
    const accessToken = ref('tok')
    const { addSubscription } = useSubscriptions(
      () => userId.value, () => accessToken.value, undefined, onSyncError,
    )
    await flush()
    addSubscription('http://x.ics', 'X', '#fff')
    await flush()
    vi.runAllTimers()
    await flush()

    expect(onSyncError).toHaveBeenCalledWith(expect.stringMatching(/nicht auf dem Server gespeichert/))
  })

  it('does not resurrect an entry deleted elsewhere once the write was confirmed', async () => {
    // Guards the merge: after a successful write the marker is cleared, so a
    // later load takes the server copy verbatim rather than re-adding old items.
    let serverSubs = [{ id: 'a', url: 'http://a.ics', name: 'A', color: '#111', enabled: true }]
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return { ok: true } as Response
      if (String(url).includes('subscriptions.json')) return { ok: true, json: async () => serverSubs } as Response
      return { ok: false } as Response
    }))

    const s1 = makeSubs('user-del', 'tok')
    await flush()
    s1.addSubscription('http://b.ics', 'B', '#222')
    await flush()
    vi.runAllTimers()
    await flush()

    // Another device removes both entries
    serverSubs = []
    const s2 = makeSubs('user-del', 'tok')
    await flush()

    expect(s2.subscriptions.value).toEqual([])
  })
})

describe('mergeSubscriptions', () => {
  const sub = (id: string, name: string) => ({ id, url: `http://${id}.ics`, name, color: '#000', enabled: true })

  it('keeps entries that exist on only one side', () => {
    const merged = mergeSubscriptions([sub('local', 'L')], [sub('server', 'S')])
    expect(merged.map(s => s.id)).toEqual(['server', 'local'])
  })

  it('lets the local version win for the same id', () => {
    const merged = mergeSubscriptions(
      [{ ...sub('x', 'renamed'), enabled: false }],
      [sub('x', 'original')],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].name).toBe('renamed')
    expect(merged[0].enabled).toBe(false)
  })

  it('handles empty sides', () => {
    expect(mergeSubscriptions([], [sub('s', 'S')]).map(s => s.id)).toEqual(['s'])
    expect(mergeSubscriptions([sub('l', 'L')], []).map(s => s.id)).toEqual(['l'])
    expect(mergeSubscriptions([], [])).toEqual([])
  })
})

// ── Concurrent writes from a second tab ───────────────────────────────────────

// A fake WebDAV file that honours If-Match, so the conflict path is exercised
// for real rather than asserted against a hand-rolled 412.
function fakeWebdav(initial: { id: string; url: string; name: string; color: string; enabled: boolean }[]) {
  const state = { list: initial, etag: 'v1', version: 1, puts: [] as (string | undefined)[] }
  const headers = () => ({ get: (h: string) => (h.toLowerCase() === 'etag' ? state.etag : null) })
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const ifMatch = (init.headers as Record<string, string>)?.['If-Match']
      state.puts.push(ifMatch)
      if (ifMatch && ifMatch !== state.etag) {
        return { ok: false, status: 412, headers: headers() } as unknown as Response
      }
      state.list = JSON.parse(init.body as string)
      state.version++
      state.etag = `v${state.version}`
      return { ok: true, status: 200, headers: headers() } as unknown as Response
    }
    if (String(url).includes('subscriptions.json')) {
      return { ok: true, headers: headers(), json: async () => state.list } as unknown as Response
    }
    return { ok: false } as Response
  })
  return { state, fetchMock }
}

const sub = (id: string, name: string) => ({ id, url: `http://${id}.ics`, name, color: '#000', enabled: true })

describe('useSubscriptions — concurrent writes', () => {
  it('sends If-Match once an ETag is known', async () => {
    const { state, fetchMock } = fakeWebdav([sub('a', 'A')])
    vi.stubGlobal('fetch', fetchMock)

    const { toggleSubscription, subscriptions } = makeSubs('user-etag', 'tok')
    await flush()
    toggleSubscription(subscriptions.value[0].id)
    await flush()
    vi.runAllTimers()
    await flush()

    expect(state.puts).toEqual(['v1'])
  })

  it('omits If-Match when the server sends no ETag', async () => {
    // Backwards compatible: on a server without ETags nothing changes.
    const puts: (string | undefined)[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push((init.headers as Record<string, string>)?.['If-Match'])
        return { ok: true } as Response
      }
      if (String(url).includes('subscriptions.json')) {
        return { ok: true, json: async () => [sub('a', 'A')] } as Response
      }
      return { ok: false } as Response
    }))

    const { toggleSubscription, subscriptions } = makeSubs('user-noetag', 'tok')
    await flush()
    toggleSubscription(subscriptions.value[0].id)
    await flush()
    vi.runAllTimers()
    await flush()

    expect(puts).toEqual([undefined])
  })

  it('keeps what another tab added instead of overwriting it', async () => {
    // The scenario that used to lose data: this tab has held a stale list since
    // page load, another tab adds a feed, then this tab toggles something.
    const { state, fetchMock } = fakeWebdav([sub('a', 'A'), sub('b', 'B')])
    vi.stubGlobal('fetch', fetchMock)

    const { toggleSubscription, subscriptions } = makeSubs('user-2tabs', 'tok')
    await flush()
    expect(subscriptions.value).toHaveLength(2)

    // Another tab appends a feed and bumps the ETag
    state.list = [...state.list, sub('fortuna', 'Fortuna')]
    state.version++
    state.etag = `v${state.version}`

    // This tab toggles — its write carries the outdated ETag
    toggleSubscription(subscriptions.value[0].id)
    await flush()
    vi.runAllTimers()
    await flush()
    await flush()

    // Refused once, retried after merging
    expect(state.puts).toHaveLength(2)
    expect(state.puts[0]).toBe('v1')

    const ids = state.list.map(x => x.id)
    expect(ids).toContain('fortuna')          // the other tab's addition survived
    expect(state.list.find(x => x.id === 'a')!.enabled).toBe(false)  // our toggle applied

    // The UI adopts the reconciled list rather than showing a stale one
    expect(subscriptions.value.map(x => x.id)).toContain('fortuna')
  })

  it('gives up after repeated conflicts and keeps the unsynced marker', async () => {
    const onSyncError = vi.fn()
    // A server that never accepts our write: the ETag moves on every read.
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return { ok: false, status: 412 } as Response
      if (String(url).includes('subscriptions.json')) {
        n++
        return {
          ok: true,
          headers: { get: () => `v${n}` },
          json: async () => [sub('a', 'A')],
        } as unknown as Response
      }
      return { ok: false } as Response
    }))

    const userId = ref('user-conflict')
    const accessToken = ref('tok')
    const { toggleSubscription, subscriptions } = useSubscriptions(
      () => userId.value, () => accessToken.value, undefined, onSyncError,
    )
    await flush()
    toggleSubscription(subscriptions.value[0].id)
    await flush()
    vi.runAllTimers()
    await flush()
    await flush()

    expect(onSyncError).toHaveBeenCalled()
    expect(localStorageData['agenda_subscriptions_user-conflict_unsynced']).toBe('1')
  })
})
