import { computed, watch } from 'vue'
import { useAuthStore, useUserStore, useConfigStore } from '@opencloud-eu/web-pkg'
import { TOKEN_LABEL, TOKEN_STORAGE_PREFIX } from '@/constants'

// The app token is a reusable Basic credential, so it is kept in sessionStorage
// (per tab, gone when the tab closes) rather than localStorage, and revoked on
// the server when the user logs out or changes.
const EXPIRY = '24h'
const STORAGE_PREFIX = TOKEN_STORAGE_PREFIX

interface StoredToken {
  token: string
  expiresAt: number // Unix ms
}

function storageKey(userPathId: string): string {
  return `${STORAGE_PREFIX}${userPathId}`
}

function tokenKeys(storage: Storage): string[] {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key)
  }
  return keys
}

function readToken(key: string): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const stored = JSON.parse(raw)
    // Validate the shape: a corrupted or hand-edited entry must not reach the
    // request path (token used in URLs, expiresAt compared against Date.now).
    if (typeof stored?.token !== 'string' || typeof stored?.expiresAt !== 'number') return null
    return stored as StoredToken
  } catch {
    return null
  }
}

// Versions up to 2.9.0 kept the token in localStorage, where it outlived the
// login session. Drop those copies; they expire on the server within 24 h.
function purgeLegacyTokens() {
  try {
    for (const key of tokenKeys(localStorage)) localStorage.removeItem(key)
  } catch {
    // storage unavailable — nothing to purge
  }
}

function loadStoredToken(userPathId: string): string | null {
  const stored = readToken(storageKey(userPathId))
  if (!stored) return null
  if (Date.now() >= stored.expiresAt) {
    removeToken(storageKey(userPathId))
    return null
  }
  return stored.token
}

function saveToken(userPathId: string, token: string) {
  const stored: StoredToken = {
    token,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 h
  }
  try {
    sessionStorage.setItem(storageKey(userPathId), JSON.stringify(stored))
  } catch {
    // storage unavailable — the token is simply requested again next time
  }
}

function removeToken(key: string) {
  try { sessionStorage.removeItem(key) } catch { /* ignore */ }
}

// Best effort: keepalive lets the request finish while the page navigates
// away to the identity provider's logout endpoint.
function revokeToken(token: string, bearer: string) {
  if (!bearer) return
  fetch(`/auth-app/tokens?token=${encodeURIComponent(token)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${bearer}` },
    keepalive: true,
  }).catch(() => { /* the token still expires on its own */ })
}

function revokeAndRemove(key: string, bearer: string) {
  const stored = readToken(key)
  removeToken(key)
  if (stored && Date.now() < stored.expiresAt) revokeToken(stored.token, bearer)
}

let logoutWatchRegistered = false

// Called once from the app setup, so it also covers a logout that happens
// while another OpenCloud app is open. On logout OpenCloud Web clears the
// access token in the auth store; the last known bearer token is still valid
// on the server at that moment and is used to revoke the app token.
export function registerTokenRevocationOnLogout() {
  if (logoutWatchRegistered) return
  logoutWatchRegistered = true
  purgeLegacyTokens()

  const authStore = useAuthStore()
  let lastBearer = authStore.accessToken || ''
  watch(
    () => authStore.accessToken,
    (token) => {
      if (token) {
        lastBearer = token
        return
      }
      try {
        for (const key of tokenKeys(sessionStorage)) revokeAndRemove(key, lastBearer)
      } catch {
        // storage unavailable
      }
      lastBearer = ''
    },
  )
}

// In-flight token requests keyed by userPathId — prevents concurrent POSTs
// for the same user while allowing independent requests for different users.
const tokenRequestsInFlight = new Map<string, Promise<string>>()

export function useAuth() {
  const authStore = useAuthStore()
  const userStore = useUserStore()
  const configStore = useConfigStore()

  const user = computed(() => userStore.user)
  // username for Basic auth (human-readable)
  const userId = computed(
    () => user.value?.onPremisesSamAccountName || user.value?.id || '',
  )
  // UUID used by Radicale as the collection path
  const userPathId = computed(() => user.value?.id || userId.value)
  const serverUrl = computed(() => configStore.serverUrl)
  const accessToken = computed(() => authStore.accessToken)

  async function getAppToken(): Promise<string> {
    const id = userPathId.value
    const cached = loadStoredToken(id)
    if (cached) return cached

    const inflight = tokenRequestsInFlight.get(id)
    if (inflight) return inflight

    const promise = (async () => {
      // Only delete expired agenda tokens — avoids revoking valid tokens
      // from other tabs or devices running the same app concurrently.
      try {
        const listRes = await fetch('/auth-app/tokens', {
          headers: { Authorization: `Bearer ${accessToken.value}` },
        })
        if (listRes.ok) {
          const tokens: { token: string; label: string; expiration_date: string }[] = await listRes.json()
          const now = new Date()
          await Promise.all(
            tokens
              .filter(t => t.label === TOKEN_LABEL && new Date(t.expiration_date) <= now)
              .map(t => fetch(`/auth-app/tokens?token=${encodeURIComponent(t.token)}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${accessToken.value}` },
              }))
          )
        }
      } catch {
        // Cleanup failure is non-fatal — proceed to create a new token.
      }

      const res = await fetch(`/auth-app/tokens?expiry=${EXPIRY}&label=${TOKEN_LABEL}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken.value}` },
      })

      if (!res.ok) throw new Error(`Failed to create app token: ${res.status} ${res.statusText}`)

      const data = await res.json()
      const token: string = data.token
      if (!token) throw new Error('No app token in response')

      saveToken(id, token)
      return token
    })().finally(() => { tokenRequestsInFlight.delete(id) })

    tokenRequestsInFlight.set(id, promise)
    return promise
  }

  // Drops the cached token and revokes it on the server (user change, or a
  // 401 where the token is already gone and the DELETE is harmless).
  function clearAppToken(pathId: string = userPathId.value) {
    revokeAndRemove(storageKey(pathId), accessToken.value || '')
  }

  return { user, userId, userPathId, serverUrl, accessToken, getAppToken, clearAppToken }
}
