import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildIcs, type Calendar, type CalendarEvent } from '@/services/caldav'

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

vi.mock('./useAuth', async () => {
  const { ref } = await import('vue')
  // One entry per useAuth() call, so a test can flip the refs of the instance
  // it created without disturbing watchers leaked by earlier instances.
  const instances: Array<{
    userId: ReturnType<typeof ref>
    accessToken: ReturnType<typeof ref>
    clearAppToken: ReturnType<typeof vi.fn>
  }> = []
  return {
    useAuth: () => {
      const userId = ref('u1')
      const accessToken = ref('tok')
      const entry = { userId, accessToken, clearAppToken: vi.fn() }
      instances.push(entry)
      return {
        userId,
        userPathId: ref('p1'),
        serverUrl: ref('https://example.org'),
        accessToken,
        getAppToken: async () => 'apptoken',
        clearAppToken: entry.clearAppToken,
      }
    },
    __instances: instances,
  }
})

const { useCalendar } = await import('./useCalendar')
// The mock factory adds this side channel; the real module does not have it.
const { __instances } = (await import('./useAuth')) as unknown as {
  __instances: Array<{
    userId: { value: string }
    accessToken: { value: string }
    clearAppToken: ReturnType<typeof vi.fn>
  }>
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

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

// Regression for issue #5: no session or generation guard, so stale responses
// could win. A clock-based epoch also tied when two loads started in the same
// millisecond, and a discarded load cleared the shared loading flag.
describe('stale-response guards (issue #5)', () => {
  it('discards a slow older loadEvents when a newer one already wrote', async () => {
    listCalendars.mockResolvedValue([MUTTER])
    const slow = deferred<CalendarEvent[]>()
    fetchEvents.mockImplementationOnce(() => slow.promise)
    fetchEvents.mockResolvedValueOnce([makeEvent('/cal/mutter/b.ics')])

    const { loadCalendars, loadEvents, events, loading, error } = useCalendar()
    await loadCalendars()

    void loadEvents(new Date(2026, 7, 1), new Date(2026, 7, 2)) // older, slow
    await loadEvents(new Date(2026, 7, 1), new Date(2026, 7, 3)) // newer, fast
    expect(events.value[0].calendarHref).toBe('/cal/mutter/b.ics')

    slow.resolve([makeEvent('/cal/mutter/a.ics')])
    await flush()

    expect(events.value[0].calendarHref).toBe('/cal/mutter/b.ics')
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('does not let a discarded older load clear the loading flag', async () => {
    listCalendars.mockResolvedValue([MUTTER])
    const slow1 = deferred<CalendarEvent[]>()
    const slow2 = deferred<CalendarEvent[]>()
    fetchEvents.mockImplementationOnce(() => slow1.promise)
    fetchEvents.mockImplementationOnce(() => slow2.promise)

    const { loadCalendars, loadEvents, events, loading } = useCalendar()
    await loadCalendars()

    const p1 = loadEvents(new Date(2026, 7, 1), new Date(2026, 7, 2))
    void loadEvents(new Date(2026, 7, 1), new Date(2026, 7, 3))
    await flush()

    slow1.resolve([makeEvent('/cal/mutter/a.ics')])
    await p1
    await flush()

    // The current load (#2) is still running: the discarded #1 must not have
    // cleared the flag, and its data must not be visible.
    expect(loading.value).toBe(true)
    expect(events.value).toHaveLength(0)

    slow2.resolve([makeEvent('/cal/mutter/b.ics')])
    await flush()

    expect(loading.value).toBe(false)
    expect(events.value[0].calendarHref).toBe('/cal/mutter/b.ics')
  })

  it('aborts the in-flight fetchEvents of a superseded load', async () => {
    listCalendars.mockResolvedValue([MUTTER])
    const signals: AbortSignal[] = []
    fetchEvents.mockImplementation((_href: string, _f: Date, _t: Date, signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<CalendarEvent[]>(() => {}) // never settles
    })

    const { loadCalendars, loadEvents } = useCalendar()
    await loadCalendars()

    void loadEvents(new Date(2026, 7, 1), new Date(2026, 7, 2))
    await flush()
    void loadEvents(new Date(2026, 7, 1), new Date(2026, 7, 3))
    await flush()

    expect(signals).toHaveLength(2)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
  })

  it('discards an in-flight loadCalendars when the user switches', async () => {
    const first = deferred<Calendar[]>()
    // call 1: the mount watcher's load; call 2: the explicit load under test
    listCalendars.mockResolvedValueOnce([])
    listCalendars.mockImplementationOnce(() => first.promise)
    listCalendars.mockResolvedValue([PERSONAL])

    const { loadCalendars, calendars } = useCalendar()
    void loadCalendars() // call 2 — hangs on the deferred reply
    await flush()
    expect(calendars.value).toEqual([])

    // Simulate a user switch: the watcher must bump the session, clear state
    // and load for the new user; the old in-flight reply must be discarded.
    const refs = __instances[__instances.length - 1]
    refs.userId.value = 'u2'
    await flush()

    first.resolve([MUTTER])
    await flush()
    await flush()

    expect(calendars.value).toEqual([PERSONAL])
  })

  it('does not refresh the client (revoke the token) for a superseded 401', async () => {
    const slow401 = deferred<never>()
    listCalendars.mockResolvedValueOnce([])
    listCalendars.mockImplementationOnce(() => slow401.promise)
    listCalendars.mockResolvedValue([PERSONAL])

    const { loadCalendars, calendars } = useCalendar()
    void loadCalendars() // call 2 — hangs on the deferred 401
    await flush()

    const refs = __instances[__instances.length - 1]
    refs.userId.value = 'u2'
    await flush()

    // The 401 lands after the switch: refreshing now would revoke the token
    // the new user's load is already using.
    slow401.reject(new Error('CalDAV PROPFIND /caldav/ → 401 Unauthorized'))
    await flush()
    await flush()

    expect(calendars.value).toEqual([PERSONAL])
    const zeroArgCalls = refs.clearAppToken.mock.calls.filter((c: unknown[]) => c.length === 0)
    expect(zeroArgCalls).toHaveLength(0)
  })
})
