import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  escapeXml, escapeIcs, buildIcs, parseEvents, newEventHref,
  safeColor, safeRrule, resolveHref, newExpansionBudget, CalDavClient,
} from './caldav'

describe('escapeXml', () => {
  it('escapes ampersand', () => expect(escapeXml('a & b')).toBe('a &amp; b'))
  it('escapes less-than', () => expect(escapeXml('a < b')).toBe('a &lt; b'))
  it('escapes greater-than', () => expect(escapeXml('a > b')).toBe('a &gt; b'))
  it('escapes double quote', () => expect(escapeXml('"hi"')).toBe('&quot;hi&quot;'))
  it('escapes single quote', () => expect(escapeXml("it's")).toBe('it&apos;s'))
  it('passes through plain text unchanged', () => expect(escapeXml('hello world')).toBe('hello world'))
  it('handles all special chars at once', () =>
    expect(escapeXml('<a href="x&y">it\'s</a>')).toBe('&lt;a href=&quot;x&amp;y&quot;&gt;it&apos;s&lt;/a&gt;'))
})

describe('newEventHref', () => {
  const cal = 'https://cloud.example/remote.php/dav/calendars/u1/personal/'

  it('appends the name as a single .ics segment', () =>
    expect(newEventHref(cal, 'abc')).toBe(`${cal}abc.ics`))
  it('works without a trailing slash on the collection', () =>
    expect(newEventHref(cal.replace(/\/$/, ''), 'abc')).toBe(`${cal}abc.ics`))

  // Regression: the UID of a moved event comes from untrusted ICS data. Used
  // raw, '../' or '?' in it redirected the PUT outside the target calendar.
  it.each(['../../../files/u1/x', 'a/b', 'x?y=1', 'x#frag', '..'])(
    'keeps %s inside the collection',
    (name) => {
      const url = new URL(newEventHref(cal, name))
      expect(url.href.startsWith(cal)).toBe(true)
      expect(url.search).toBe('')
      expect(url.hash).toBe('')
      expect(url.pathname.slice(new URL(cal).pathname.length)).not.toContain('/')
    },
  )
})

describe('escapeIcs', () => {
  it('escapes backslash', () => expect(escapeIcs('a\\b')).toBe('a\\\\b'))
  it('escapes semicolon', () => expect(escapeIcs('a;b')).toBe('a\\;b'))
  it('escapes comma', () => expect(escapeIcs('a,b')).toBe('a\\,b'))
  it('escapes LF newline', () => expect(escapeIcs('a\nb')).toBe('a\\nb'))
  it('escapes CRLF newline', () => expect(escapeIcs('a\r\nb')).toBe('a\\nb'))
  it('escapes a bare CR as one newline', () => expect(escapeIcs('a\rb')).toBe('a\\nb'))
  it('does not double up CRLF into two newlines', () => expect(escapeIcs('a\r\n\r\nb')).toBe('a\\n\\nb'))
  it('passes through plain text unchanged', () => expect(escapeIcs('hello world')).toBe('hello world'))
})

// Helper: split ICS into lines and return a Set for order-independent checks
function icsLines(ics: string): string[] {
  return ics.split('\r\n').filter(Boolean)
}

describe('buildIcs', () => {
  const baseEvent = {
    uid: 'test-uid-123',
    title: 'Team Meeting',
    start: new Date('2026-04-06T09:00:00Z'),
    end: new Date('2026-04-06T10:00:00Z'),
    allDay: false,
  }

  it('wraps in VCALENDAR and VEVENT', () => {
    const lines = icsLines(buildIcs(baseEvent)!)
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('BEGIN:VEVENT')
    expect(lines).toContain('END:VEVENT')
    expect(lines.at(-1)).toBe('END:VCALENDAR')
  })

  it('includes correct UID', () => {
    const lines = icsLines(buildIcs(baseEvent)!)
    expect(lines).toContain('UID:test-uid-123')
  })

  it('writes timed events in the device zone with a matching VTIMEZONE', () => {
    const lines = icsLines(buildIcs(baseEvent)!)
    // TZ is pinned to Europe/Berlin in vitest.config.ts, so 09:00Z is 11:00 local.
    expect(lines).toContain('DTSTART;TZID=Europe/Berlin:20260406T110000')
    expect(lines).toContain('DTEND;TZID=Europe/Berlin:20260406T120000')
    expect(lines).toContain('BEGIN:VTIMEZONE')
    expect(lines).toContain('TZID:Europe/Berlin')
    expect(lines).toContain('END:VTIMEZONE')
    // The definition has to come before the event that refers to it.
    expect(lines.indexOf('BEGIN:VTIMEZONE')).toBeLessThan(lines.indexOf('BEGIN:VEVENT'))
  })

  it('does not add a VTIMEZONE to an all-day event', () => {
    const ev = { ...baseEvent, allDay: true }
    const lines = icsLines(buildIcs(ev)!)
    expect(lines.some(l => l.startsWith('BEGIN:VTIMEZONE'))).toBe(false)
  })

  it('uses DATE format for all-day event', () => {
    const ev = { ...baseEvent, allDay: true, start: new Date('2026-04-06T00:00:00'), end: new Date('2026-04-07T00:00:00') }
    const lines = icsLines(buildIcs(ev)!)
    expect(lines).toContain('DTSTART;VALUE=DATE:20260406')
    expect(lines).toContain('DTEND;VALUE=DATE:20260407')
  })

  it('escapes special chars in SUMMARY', () => {
    const ev = { ...baseEvent, title: 'A;B,C\\D' }
    const lines = icsLines(buildIcs(ev)!)
    expect(lines).toContain('SUMMARY:A\\;B\\,C\\\\D')
  })

  it('includes RRULE when present', () => {
    const ev = { ...baseEvent, rrule: 'FREQ=WEEKLY;BYDAY=MO' }
    const lines = icsLines(buildIcs(ev)!)
    expect(lines).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO')
  })

  it('includes DESCRIPTION and LOCATION when present', () => {
    const ev = { ...baseEvent, description: 'Agenda: items', location: 'Room 1' }
    const lines = icsLines(buildIcs(ev)!)
    expect(lines).toContain('DESCRIPTION:Agenda: items')
    expect(lines).toContain('LOCATION:Room 1')
  })

  it('omits DESCRIPTION and LOCATION when absent', () => {
    const lines = icsLines(buildIcs(baseEvent)!)
    expect(lines.some(l => l.startsWith('DESCRIPTION:'))).toBe(false)
    expect(lines.some(l => l.startsWith('LOCATION:'))).toBe(false)
  })

  it('uses seriesUid as UID when set', () => {
    const ev = { ...baseEvent, uid: 'occurrence-uid', seriesUid: 'master-uid' }
    const lines = icsLines(buildIcs(ev)!)
    expect(lines).toContain('UID:master-uid')
  })
})

describe('parseEvents', () => {
  const href = 'https://cal.example.com/events/test.ics'

  // Pin Date.now() so the ±2-year expansion window always covers our 2026 fixtures.
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-04-09T00:00:00Z') }))
  afterEach(() => vi.useRealTimers())

  function makeIcs(veventBody: string): string {
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      'BEGIN:VEVENT',
      veventBody.trim(),
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n'
  }

  it('returns [] for invalid ICS', () => {
    expect(parseEvents('not ics data', href)).toEqual([])
  })

  it('parses a simple timed event', () => {
    const ics = makeIcs(`
UID:simple-001
SUMMARY:Simple Event
DTSTART:20260406T090000Z
DTEND:20260406T100000Z
DTSTAMP:20260101T000000Z
    `)
    const events = parseEvents(ics, href, 'etag-abc')
    expect(events).toHaveLength(1)
    expect(events[0].uid).toBe('simple-001')
    expect(events[0].title).toBe('Simple Event')
    expect(events[0].allDay).toBe(false)
    expect(events[0].start).toEqual(new Date('2026-04-06T09:00:00Z'))
    expect(events[0].end).toEqual(new Date('2026-04-06T10:00:00Z'))
    expect(events[0].calendarHref).toBe(href)
    expect(events[0].etag).toBe('etag-abc')
    expect(events[0].seriesUid).toBeUndefined()
  })

  it('parses an all-day event', () => {
    const ics = makeIcs(`
UID:allday-001
SUMMARY:All Day
DTSTART;VALUE=DATE:20260410
DTEND;VALUE=DATE:20260411
DTSTAMP:20260101T000000Z
    `)
    const events = parseEvents(ics, href)
    expect(events).toHaveLength(1)
    expect(events[0].allDay).toBe(true)
  })

  it('parses description and location', () => {
    const ics = makeIcs(`
UID:detail-001
SUMMARY:With Details
DTSTART:20260406T090000Z
DTEND:20260406T100000Z
DTSTAMP:20260101T000000Z
DESCRIPTION:Meeting notes
LOCATION:Conference Room
    `)
    const events = parseEvents(ics, href)
    expect(events[0].description).toBe('Meeting notes')
    expect(events[0].location).toBe('Conference Room')
  })

  it('expands a recurring event into multiple occurrences', () => {
    const ics = makeIcs(`
UID:recur-001
SUMMARY:Weekly Standup
DTSTART:20260406T090000Z
DTEND:20260406T090000Z
DTSTAMP:20260101T000000Z
RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO
    `)
    const events = parseEvents(ics, href)
    // Should expand to 3 occurrences (within 2-year window around now)
    expect(events.length).toBe(3)
    expect(events[0].seriesUid).toBe('recur-001')
    expect(events[0].uid).toContain('recur-001_')
    expect(events[0].rrule).toBe('FREQ=WEEKLY;COUNT=3;BYDAY=MO')
  })

  it('each recurring occurrence has a distinct synthetic uid', () => {
    const ics = makeIcs(`
UID:recur-002
SUMMARY:Daily
DTSTART:20260406T090000Z
DTEND:20260406T100000Z
DTSTAMP:20260101T000000Z
RRULE:FREQ=DAILY;COUNT=4
    `)
    const events = parseEvents(ics, href)
    const uids = events.map(e => e.uid)
    expect(new Set(uids).size).toBe(uids.length) // all unique
    expect(uids.every(u => u.startsWith('recur-002_'))).toBe(true)
  })

  // The regression the TZID change is about: a series written by this app has
  // to keep its wall-clock time when the offset changes.
  it('keeps a recurring series at the same local time across the DST change', () => {
    const ics = buildIcs({
      uid: 'series-dst',
      title: 'Weekly',
      // 10:00 local (TZ is Europe/Berlin), four Tuesdays from 20 October 2026.
      start: new Date('2026-10-20T10:00:00'),
      end: new Date('2026-10-20T11:00:00'),
      allDay: false,
      rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=4',
    })!
    expect(ics).toContain('DTSTART;TZID=Europe/Berlin:20261020T100000')

    const events = parseEvents(ics, href)
    expect(events).toHaveLength(4)

    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
    expect(events.map(e => fmt.format(e.start))).toEqual(['10:00', '10:00', '10:00', '10:00'])
    // The two sides of the switch really are different offsets, so the test
    // would catch a definition that simply froze one of them.
    expect(new Set(events.map(e => e.start.toISOString().slice(11, 16))).size).toBe(2)
  })

  it('returns (no title) when SUMMARY is missing', () => {
    const ics = makeIcs(`
UID:notitle-001
DTSTART:20260406T090000Z
DTEND:20260406T100000Z
DTSTAMP:20260101T000000Z
    `)
    const events = parseEvents(ics, href)
    expect(events[0].title).toBe('(no title)')
  })

  // A client that edits one occurrence of a series (Thunderbird, DAVx5, iOS)
  // writes a second VEVENT with RECURRENCE-ID. It must be applied by the series
  // iterator, not rendered as an extra event, and the occurrence must take the
  // fields of the edited copy.
  describe('RECURRENCE-ID overrides', () => {
    const seriesWithOverride = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      'BEGIN:VEVENT',
      'UID:override-001',
      'SUMMARY:Weekly Standup',
      'DESCRIPTION:Series notes',
      'LOCATION:Room A',
      'DTSTART:20260406T090000Z',
      'DTEND:20260406T093000Z',
      'DTSTAMP:20260101T000000Z',
      'RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:override-001',
      'SUMMARY:Standup (moved)',
      'DESCRIPTION:Moved notes',
      'LOCATION:Room B',
      'RECURRENCE-ID:20260420T090000Z',
      'DTSTART:20260420T130000Z',
      'DTEND:20260420T133000Z',
      'DTSTAMP:20260101T000000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n'

    it('renders the edited occurrence once, not twice', () => {
      const events = parseEvents(seriesWithOverride, href)
      expect(events).toHaveLength(4)
      const onEditedDay = events.filter(e => e.start.toISOString().startsWith('2026-04-20'))
      expect(onEditedDay).toHaveLength(1)
      expect(onEditedDay[0].start.toISOString()).toBe('2026-04-20T13:00:00.000Z')
    })

    it('takes title, description and location from the override', () => {
      const events = parseEvents(seriesWithOverride, href)
      const edited = events.find(e => e.start.toISOString() === '2026-04-20T13:00:00.000Z')
      expect(edited?.title).toBe('Standup (moved)')
      expect(edited?.description).toBe('Moved notes')
      expect(edited?.location).toBe('Room B')
    })

    it('keeps the master fields on the untouched occurrences', () => {
      const events = parseEvents(seriesWithOverride, href)
      const untouched = events.filter(e => e.start.toISOString() !== '2026-04-20T13:00:00.000Z')
      expect(untouched).toHaveLength(3)
      expect(untouched.every(e => e.title === 'Weekly Standup')).toBe(true)
      expect(untouched.every(e => e.location === 'Room A')).toBe(true)
      expect(untouched.every(e => e.seriesUid === 'override-001')).toBe(true)
    })
  })
})

describe('safeColor', () => {
  it.each(['#abc', '#abcd', '#0082c9', '#0082C9FF', 'red', 'RebeccaPurple'])('accepts %s', (c) =>
    expect(safeColor(c)).toBe(c))
  it('trims whitespace', () => expect(safeColor('  #fff \n')).toBe('#fff'))

  // Regression: colours from calendar-color, ICS COLOR and subscriptions.json
  // went straight into `background:`, where url(...) makes the browser fetch it.
  it.each([
    'url(https://tracker.example/p.gif)',
    'red url(https://tracker.example/p.gif)',
    'var(--x)',
    'rgb(0 0 0)',
    '#12345',
    '#ggg',
    '',
  ])('rejects %s', (c) => expect(safeColor(c)).toBeUndefined())
  it.each([null, undefined, 42, {}])('rejects non-string %s', (c) => expect(safeColor(c)).toBeUndefined())
})

describe('safeRrule', () => {
  it('keeps a valid rule', () =>
    expect(safeRrule('FREQ=MONTHLY;UNTIL=20271231T000000Z')).toBe('FREQ=MONTHLY;UNTIL=20271231T000000Z'))
  it('returns undefined for empty input', () => expect(safeRrule(undefined)).toBeUndefined())
  it('drops a rule without a valid FREQ', () => expect(safeRrule('garbage')).toBeUndefined())
  it('drops a rule with an injected line break', () =>
    expect(safeRrule('FREQ=DAILY\r\nATTACH:http://x')).toBeUndefined())
})

describe('buildIcs — values from foreign ICS data', () => {
  const ev = {
    uid: 'u1',
    title: 'T',
    start: new Date('2026-04-06T09:00:00Z'),
    end: new Date('2026-04-06T10:00:00Z'),
    allDay: false,
  }
  const lines = (ics: string) => ics.split('\r\n').filter(Boolean)

  // Regression: UID, COLOR and RRULE were written raw. A UID parsed from a
  // crafted ICS (TEXT, so \n decodes to a real line break) added properties
  // or whole components when the event was saved again.
  it('escapes a line break in the UID instead of starting a new property', () => {
    const out = lines(buildIcs({ ...ev, uid: 'x\nATTACH:http://evil.example/a' }))
    expect(out).toContain('UID:x\\nATTACH:http://evil.example/a')
    expect(out.some(l => l.startsWith('ATTACH'))).toBe(false)
  })

  it('cannot close the VEVENT through the UID', () => {
    const out = lines(buildIcs({ ...ev, seriesUid: 'x\nEND:VEVENT\nBEGIN:VEVENT' }))
    expect(out.filter(l => l === 'BEGIN:VEVENT')).toHaveLength(1)
  })

  it('drops a COLOR that is not a plain colour', () => {
    const out = lines(buildIcs({ ...ev, color: 'red\nATTACH:x' }))
    expect(out.some(l => l.startsWith('COLOR') || l.startsWith('ATTACH'))).toBe(false)
  })

  it('writes a valid COLOR', () => expect(lines(buildIcs({ ...ev, color: '#e67e22' }))).toContain('COLOR:#e67e22'))

  it('drops an RRULE carrying a line break', () => {
    const out = lines(buildIcs({ ...ev, rrule: 'FREQ=DAILY\r\nATTACH:x' }))
    // Only the VEVENT is relevant here: a VTIMEZONE has RRULEs of its own.
    const vevent = out.slice(out.indexOf('BEGIN:VEVENT'), out.indexOf('END:VEVENT'))
    expect(vevent.some(l => l.startsWith('RRULE'))).toBe(false)
    expect(out.some(l => l.startsWith('ATTACH'))).toBe(false)
  })
})

describe('parseEvents — expansion budget', () => {
  const href = 'https://cal.example.com/events/feed.ics'

  function feed(count: number, rrule: string, dtstart = '19000101T000000Z'): string {
    const ev = (i: number) =>
      `BEGIN:VEVENT\r\nUID:e${i}\r\nDTSTART:${dtstart}\r\nDTEND:${dtstart}\r\nRRULE:${rrule}\r\nSUMMARY:x\r\nEND:VEVENT`
    return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${Array.from({ length: count }, (_, i) => ev(i)).join('\r\n')}\r\nEND:VCALENDAR\r\n`
  }

  // Regression: the step limit applied per event only, so a feed full of
  // FREQ=MINUTELY events starting in 1900 froze the tab for minutes.
  it('stops expanding once the shared step budget is spent', () => {
    const budget = newExpansionBudget()
    const started = performance.now()
    parseEvents(feed(50, 'FREQ=MINUTELY'), href, undefined, budget)
    expect(budget.steps).toBe(0)
    expect(performance.now() - started).toBeLessThan(5000)
  })

  it('shares the budget between calls', () => {
    const budget = { steps: 10, results: 100 }
    parseEvents(feed(1, 'FREQ=MINUTELY'), href, undefined, budget)
    expect(budget.steps).toBe(0)
    expect(parseEvents(feed(1, 'FREQ=DAILY', '20260101T090000Z'), href, undefined, budget)).toEqual([])
  })

  it('caps the number of returned events', () => {
    const budget = { steps: 100_000, results: 3 }
    const events = parseEvents(feed(1, 'FREQ=DAILY;COUNT=10', '20260101T090000Z'), href, undefined, budget)
    expect(events).toHaveLength(3)
    expect(budget.results).toBe(0)
  })

  it('ignores an ICS COLOR that is not a plain colour', () => {
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:c\r\nDTSTART:20260101T090000Z\r\n' +
      'DTEND:20260101T100000Z\r\nCOLOR:url(https://tracker.example/p.gif)\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
    expect(parseEvents(ics, href)[0].color).toBeUndefined()
  })
})

describe('resolveHref', () => {
  const scope = 'https://cloud.example/caldav/u1/personal/'

  it('resolves a server-relative href', () =>
    expect(resolveHref('/caldav/u1/personal/a.ics', scope, scope)).toBe(`${scope}a.ics`))
  it('accepts an absolute href on the same origin', () =>
    expect(resolveHref(`${scope}a.ics`, scope, scope)).toBe(`${scope}a.ics`))

  // Regression: absolute hrefs from PROPFIND/REPORT were used as-is, so a
  // response could direct requests carrying the app token to any host.
  it.each([
    'https://evil.example/caldav/u1/personal/a.ics',
    '//evil.example/a.ics',
    '/caldav/u1/personal-other/a.ics',
    '/caldav/u1/personal/../../u2/work/a.ics',
    '/caldav/u1/personal/%2e%2e/%2e%2e/u2/a.ics',
    '/caldav/u1/personal/x%2F..%2Fy.ics',
    '/remote.php/dav/files/u1/x.ics',
  ])('rejects %s', (href) => expect(resolveHref(href, scope, scope)).toBeNull())
})

describe('CalDavClient — origin guard', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const client = () => new CalDavClient('https://cloud.example', 'u1', 'alice', 'apptoken')

  it('refuses to send the app token to another origin', async () => {
    await expect(client().deleteEvent({
      uid: 'x', title: 'x', start: new Date(), end: new Date(), allDay: false,
      calendarHref: 'https://evil.example/x.ics',
    })).rejects.toThrow(/refused/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // fetchEvents (REPORT) is not exercised here: happy-dom's DOMParser does not
  // resolve namespaced elements, so getElementsByTagNameNS('DAV:', …) finds
  // nothing. Its href check is the same resolveHref call tested above.

  it('drops calendars outside the user collection and unsafe colours', async () => {
    const cal = (href: string, color: string) =>
      `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype>` +
      `<d:displayname>Cal</d:displayname><oc:calendar-color>${color}</oc:calendar-color></d:prop></d:propstat></d:response>`
    fetchMock.mockResolvedValue(new Response(
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:oc="http://owncloud.org/ns">` +
      cal('/caldav/u1/personal/', 'url(https://tracker.example/p.gif)') +
      cal('https://evil.example/caldav/u1/work/', '#fff') +
      `</d:multistatus>`,
      { status: 207 },
    ))
    const calendars = await client().listCalendars()
    expect(calendars).toEqual([
      { href: 'https://cloud.example/caldav/u1/personal/', displayName: 'Cal', color: undefined, ctag: undefined },
    ])
  })
})
