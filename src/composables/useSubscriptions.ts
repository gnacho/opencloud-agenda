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

export function useSubscriptions(userId: () => string, accessToken: () => string) {
  const subscriptions = ref<IcsSubscription[]>([])
  const subscriptionEvents = ref<CalendarEvent[]>([])
  const subscriptionErrors = ref<Record<string, string>>({})

  function load() {
    const uid = userId()
    if (!uid) return
    subscriptions.value = loadFromStorage(uid)
  }

  function persist() {
    saveToStorage(userId(), subscriptions.value)
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
    try {
      const res = await fetch(proxyUrl(sub.url), {
        headers: accessToken() ? { Authorization: `Bearer ${accessToken()}` } : {},
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const icsText = await res.text()
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

  // Reload when userId changes
  watch(userId, (uid) => {
    if (uid) {
      load()
      fetchAll()
    } else {
      subscriptions.value = []
      subscriptionEvents.value = []
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
