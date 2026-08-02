import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { buildIcs, type CalendarEvent } from '@/services/caldav'

const listCalendars = vi.fn()
const fetchEvents = vi.fn()

vi.mock('@/services/caldav', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/caldav')>()
  return {
    ...actual,
    CalDavClient: class {
      listCalendars = listCalendars
      fetchEvents = fetchEvents
    },
  }
})

vi.mock('./useAuth', () => ({
  useAuth: () => ({
    userId: ref('u1'),
    userPathId: ref('p1'),
    serverUrl: ref('https://example.org'),
    accessToken: ref('tok'),
    getAppToken: async () => 'apptoken',
    clearAppToken: () => {},
  }),
}))

const { useCalendar } = await import('./useCalendar')

const MUTTER = { href: '/cal/mutter/', displayName: 'Mutter', color: '#e67e22' }
const PERSONAL = { href: '/cal/personal/', displayName: 'Personal', color: '#0082c9' }

function makeEvent(href: string): CalendarEvent {
  return {
    uid: 'x1',
    title: 'Hinfahrt',
    start: new Date(2026, 7, 14, 8, 0),
    end: new Date(2026, 7, 14, 9, 0),
    allDay: false,
    calendarHref: href,
  }
}

beforeEach(() => {
  listCalendars.mockReset()
  fetchEvents.mockReset()
})

describe('loadEvents — calendar colour must not touch the event', () => {
  // Regression: the calendar colour used to be copied onto every loaded event.
  // CalendarEvent.color is written out as a COLOR property by buildIcs, so the
  // colour ended up inside the stored .ics — and an event moved from an orange
  // calendar to a blue one stayed orange for good.
  it('leaves event.color untouched when loading from a coloured calendar', async () => {
    listCalendars.mockResolvedValue([MUTTER])
    fetchEvents.mockResolvedValue([makeEvent('/cal/mutter/x1.ics')])

    const { loadCalendars, loadEvents, events } = useCalendar()
    await loadCalendars()
    await loadEvents(new Date(2026, 7, 1), new Date(2026, 7, 31))

    expect(events.value).toHaveLength(1)
    expect(events.value[0].color ?? undefined).toBeUndefined()
  })

  it('does not write a COLOR property when such an event is saved', async () => {
    listCalendars.mockResolvedValue([MUTTER])
    fetchEvents.mockResolvedValue([makeEvent('/cal/mutter/x1.ics')])

    const { loadCalendars, loadEvents, events } = useCalendar()
    await loadCalendars()
    await loadEvents(new Date(2026, 7, 1), new Date(2026, 7, 31))

    // Moving the event is a plain PUT of the same object to the new calendar
    const moved = { ...events.value[0], calendarHref: '/cal/personal/x1.ics' }
    expect(buildIcs(moved)).not.toContain('COLOR:')
  })

  it('still preserves a COLOR set by another client', async () => {
    listCalendars.mockResolvedValue([PERSONAL])
    fetchEvents.mockResolvedValue([{ ...makeEvent('/cal/personal/x1.ics'), color: '#ff00ff' }])

    const { loadCalendars, loadEvents, events } = useCalendar()
    await loadCalendars()
    await loadEvents(new Date(2026, 7, 1), new Date(2026, 7, 31))

    expect(events.value[0].color).toBe('#ff00ff')
    expect(buildIcs(events.value[0])).toContain('COLOR:#ff00ff')
  })
})
