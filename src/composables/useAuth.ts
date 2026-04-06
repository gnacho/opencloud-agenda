import { computed } from 'vue'
import { useAuthStore, useUserStore, useConfigStore } from '@opencloud-eu/web-pkg'

const APP_TOKEN_KEY = 'oc-calendar-app-token'

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
    const cached = sessionStorage.getItem(APP_TOKEN_KEY)
    if (cached) return cached

    const res = await fetch('/auth-app/tokens?expiry=72h&label=calendar-app', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken.value}`,
      },
    })

    if (!res.ok) throw new Error(`Failed to create app token: ${res.status} ${res.statusText}`)

    const data = await res.json()
    const token: string = data.token
    if (!token) throw new Error('No app token in response')

    sessionStorage.setItem(APP_TOKEN_KEY, token)
    return token
  }

  function clearAppToken() {
    sessionStorage.removeItem(APP_TOKEN_KEY)
  }

  return { user, userId, userPathId, serverUrl, accessToken, getAppToken, clearAppToken }
}
