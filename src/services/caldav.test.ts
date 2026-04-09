import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { escapeXml, escapeIcs, buildIcs, parseEvents } from './caldav'

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

describe('escapeIcs', () => {
  it('escapes backslash', () => expect(escapeIcs('a\\b')).toBe('a\\\\b'))
  it('escapes semicolon', () => expect(escapeIcs('a;b')).toBe('a\\;b'))
  it('escapes comma', () => expect(escapeIcs('a,b')).toBe('a\\,b'))
  it('escapes LF newline', () => expect(escapeIcs('a\nb')).toBe('a\\nb'))
  it('escapes CRLF newline', () => expect(escapeIcs('a\r\nb')).toBe('a\\nb'))
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

  it('includes UTC DTSTART and DTEND for timed event', () => {
    const lines = icsLines(buildIcs(baseEvent)!)
    expect(lines).toContain('DTSTART:20260406T090000Z')
    expect(lines).toContain('DTEND:20260406T100000Z')
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
})
