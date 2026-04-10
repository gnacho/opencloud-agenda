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
})
