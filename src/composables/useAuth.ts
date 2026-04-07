import { computed } from 'vue'
import { useAuthStore, useUserStore, useConfigStore } from '@opencloud-eu/web-pkg'

// Token is stored in localStorage keyed by user UUID so it persists across
// tabs and page reloads and is not recreated unnecessarily.
const EXPIRY = '24h'
const STORAGE_PREFIX = 'oc-agenda-token:'

interface StoredToken {
  token: string
  expiresAt: number // Unix ms
}

function storageKey(userPathId: string): string {
  return `${STORAGE_PREFIX}${userPathId}`
}

// One-time migration: remove any old tokens left in localStorage.
;(function migrateLocalStorage() {
  const toRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(STORAGE_PREFIX)) toRemove.push(key)
  }
  toRemove.forEach(k => localStorage.removeItem(k))
})()

function loadStoredToken(userPathId: string): string | null {
  try {
    const raw = localStorage.getItem(storageKey(userPathId))
    if (!raw) return null
    const stored: StoredToken = JSON.parse(raw)
    if (Date.now() >= stored.expiresAt) {
      localStorage.removeItem(storageKey(userPathId))
      return null
    }
    return stored.token
  } catch {
    return null
  }
}

function saveToken(userPathId: string, token: string) {
  const stored: StoredToken = {
    token,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 h
  }
  localStorage.setItem(storageKey(userPathId), JSON.stringify(stored))
}

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

    const res = await fetch(`/auth-app/tokens?expiry=${EXPIRY}&label=agenda`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken.value}` },
    })

    if (!res.ok) throw new Error(`Failed to create app token: ${res.status} ${res.statusText}`)

    const data = await res.json()
    const token: string = data.token
    if (!token) throw new Error('No app token in response')

    saveToken(id, token)
    return token
  }

  function clearAppToken() {
    localStorage.removeItem(storageKey(userPathId.value))
  }

  return { user, userId, userPathId, serverUrl, accessToken, getAppToken, clearAppToken }
}
