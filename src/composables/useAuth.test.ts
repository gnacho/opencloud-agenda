import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive, nextTick } from 'vue'

const authStore = reactive({ accessToken: 'bearer-1' })
const userStore = reactive({ user: { id: 'p1', onPremisesSamAccountName: 'alice' } as { id: string; onPremisesSamAccountName: string } | null })

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => authStore,
  useUserStore: () => userStore,
  useConfigStore: () => ({ serverUrl: 'https://cloud.example' }),
}))

// Node's own Web Storage globals are not usable under vitest — stub both.
function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, String(v)) },
    removeItem: (k: string) => { data.delete(k) },
    clear: () => data.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('sessionStorage', memoryStorage())

const { useAuth, registerTokenRevocationOnLogout } = await import('./useAuth')

const KEY = 'oc-agenda-token:p1'
const fetchMock = vi.fn()

function deleteCalls() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ token: 'app-1' }))
    if (!init?.method) return new Response('[]')
    return new Response(null, { status: 204 })
  })
  vi.stubGlobal('fetch', fetchMock)
  authStore.accessToken = 'bearer-1'
})

describe('app token storage', () => {
  it('keeps a new token in sessionStorage, not localStorage', async () => {
    const { getAppToken } = useAuth()
    expect(await getAppToken()).toBe('app-1')
    expect(sessionStorage.getItem(KEY)).toContain('app-1')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('reuses the cached token without asking the server again', async () => {
    const { getAppToken } = useAuth()
    await getAppToken()
    fetchMock.mockClear()
    expect(await getAppToken()).toBe('app-1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clearAppToken drops the cached token and revokes it on the server', async () => {
    const { getAppToken, clearAppToken } = useAuth()
    await getAppToken()
    clearAppToken()
    expect(sessionStorage.getItem(KEY)).toBeNull()
    const [[url, init]] = deleteCalls()
    expect(url).toBe('/auth-app/tokens?token=app-1')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer bearer-1')
  })
})

describe('registerTokenRevocationOnLogout', () => {
  it('purges legacy localStorage tokens and revokes the session token on logout', async () => {
    localStorage.setItem('oc-agenda-token:old', JSON.stringify({ token: 'legacy', expiresAt: Date.now() + 1000 }))
    localStorage.setItem('agenda_subscriptions_p1', '[]')
    registerTokenRevocationOnLogout()
    expect(localStorage.getItem('oc-agenda-token:old')).toBeNull()
    expect(localStorage.getItem('agenda_subscriptions_p1')).toBe('[]')

    await useAuth().getAppToken()
    fetchMock.mockClear()

    // OpenCloud Web clears the access token in the auth store on logout.
    authStore.accessToken = ''
    await nextTick()

    expect(sessionStorage.getItem(KEY)).toBeNull()
    const [[url, init]] = deleteCalls()
    expect(url).toBe('/auth-app/tokens?token=app-1')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer bearer-1')
    expect(init.keepalive).toBe(true)
  })
})
