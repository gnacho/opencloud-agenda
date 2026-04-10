import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'

// Drain the microtask queue fully (async watcher → load() → fetch() → assign)
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
import { useSubscriptions } from './useSubscriptions'

vi.mock('@/services/caldav', () => ({
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

    expect(subscriptions.value).toHaveLength(1)
    expect(subscriptions.value[0].url).toBe(localSub.url)

    // Local state must have been pushed to server (one PUT with the new sub)
    expect(putBodies).toHaveLength(1)
    const saved = JSON.parse(putBodies[0]) as { url: string }[]
    expect(saved[0].url).toBe(localSub.url)
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

    // Local sub must still be in memory (not overwritten by old server copy)
    expect(subscriptions.value).toHaveLength(1)
    expect(subscriptions.value[0].url).toBe(localSub.url)
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
    expect(urls).not.toContain('http://stale.ics')
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
