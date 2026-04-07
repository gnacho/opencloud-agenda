import { ref, watch } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { CalDavClient, type Calendar, type CalendarEvent } from '@/services/caldav'
import { useAuth } from './useAuth'

export function useCalendar() {
  const { userId, userPathId, serverUrl, accessToken, getAppToken, clearAppToken } = useAuth()

  const loading = ref(false)
  const error = ref<string | null>(null)
  const calendars = ref<Calendar[]>([])
  const events = ref<CalendarEvent[]>([])
  const activeCalendarHref = ref<string | null>(null)
  const hiddenCalendars = ref<Set<string>>(new Set())

  function toggleCalendar(href: string) {
    const next = new Set(hiddenCalendars.value)
    if (next.has(href)) next.delete(href)
    else next.add(href)
    hiddenCalendars.value = next
  }

  let client: CalDavClient | null = null
  let lastLoadedUserId = ''

  // current view range (set by CalendarView whenever the FC view changes)
  const viewStart = ref<Date>(new Date())
  const viewEnd = ref<Date>(new Date())

  async function getClient(): Promise<CalDavClient> {
    if (client && lastLoadedUserId === userId.value) return client

    // Only clear token if the user actually changed (not on initial load)
    if (lastLoadedUserId && lastLoadedUserId !== userId.value) {
      clearAppToken()
    }
    const token = await getAppToken()
    client = new CalDavClient(serverUrl.value, userPathId.value, userId.value, token)
    lastLoadedUserId = userId.value
    return client
  }

  async function loadCalendars() {
    loading.value = true
    error.value = null
    try {
      const c = await getClient()
      calendars.value = await c.listCalendars()
      if (calendars.value.length && !activeCalendarHref.value) {
        activeCalendarHref.value = calendars.value[0].href
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  async function loadEvents(from: Date, to: Date) {
    if (!calendars.value.length) return
    loading.value = true
    error.value = null
    const epoch = Date.now()
    try {
      const c = await getClient()
      const all: CalendarEvent[] = []
      for (const cal of calendars.value) {
        const evs = await c.fetchEvents(cal.href, from, to)
        // attach calendar color for display
        const color = cal.color
        all.push(...evs.map(e => ({ ...e, color: e.color ?? color })))
      }
      // epoch-guard: discard if a newer load finished first
      if (epoch < lastEpoch) return
      lastEpoch = epoch
      events.value = all
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  let lastEpoch = 0

  async function saveEvent(event: CalendarEvent): Promise<CalendarEvent> {
    const c = await getClient()
    const newEtag = await c.saveEvent(event)
    return { ...event, etag: newEtag ?? event.etag }
  }

  async function createEvent(
    partial: Omit<CalendarEvent, 'uid' | 'calendarHref' | 'etag'>,
    calendarHref?: string,
  ): Promise<CalendarEvent> {
    const c = await getClient()
    const uid = uuidv4()
    const href = calendarHref ?? activeCalendarHref.value ?? calendars.value[0]?.href
    if (!href) throw new Error('No calendar available')
    const eventHref = c.newEventHref(href, uid)
    const event: CalendarEvent = { ...partial, uid, calendarHref: eventHref }
    const saved = await saveEvent(event)
    // optimistic update
    events.value = [...events.value, saved]
    return saved
  }

  async function updateEvent(event: CalendarEvent): Promise<void> {
    const saved = await saveEvent(event)
    events.value = events.value.map(e => (e.uid === event.uid ? saved : e))
  }

  async function createCalendar(name: string, color: string): Promise<void> {
    const c = await getClient()
    const cal = await c.createCalendar(name, color)
    calendars.value = [...calendars.value, cal]
  }

  async function deleteEvent(event: CalendarEvent): Promise<void> {
    const c = await getClient()
    await c.deleteEvent(event)
    events.value = events.value.filter(e => e.uid !== event.uid)
  }

  // Re-load when user or token changes
  watch([userId, accessToken], async ([newUser], [oldUser]) => {
    if (newUser !== oldUser) {
      client = null
      calendars.value = []
      events.value = []
      activeCalendarHref.value = null
    }
    if (newUser) {
      await loadCalendars()
    }
  })

  return {
    loading,
    error,
    calendars,
    events,
    activeCalendarHref,
    hiddenCalendars,
    toggleCalendar,
    viewStart,
    viewEnd,
    loadCalendars,
    loadEvents,
    createCalendar,
    createEvent,
    updateEvent,
    deleteEvent,
  }
}
