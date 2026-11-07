import { describe, expect, it, vi } from 'vitest'
import ICAL from 'ical.js'
import { buildIcs, mergeIcs, type CalendarEvent } from './caldav'

// The device zone decides how a timed event is written. Pin it so the
// assertions do not depend on the machine running the suite.
vi.mock('@/utils/timezone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/timezone')>()
  return { ...actual, userTimeZone: () => 'Europe/Berlin' }
})

function ics(...lines: string[]): string {
  return lines.join('\r\n') + '\r\n'
}

const STORED = ics(
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//KashCal//EN',
  'BEGIN:VEVENT',
  'UID:evt-1',
  'DTSTAMP:20260101T000000Z',
  'DTSTART;TZID=Europe/Berlin:20260324T100000',
  'DTEND;TZID=Europe/Berlin:20260324T110000',
  'SUMMARY:Old title',
  'DESCRIPTION:Set on the phone',
  'LOCATION:Office',
  'STATUS:CONFIRMED',
  'SEQUENCE:3',
  'CREATED:20251201T090000Z',
  'LAST-MODIFIED:20251202T090000Z',
  'CATEGORIES:Work',
  'X-CUSTOM-FLAG:yes',
  'ORGANIZER;CN=Ana:mailto:ana@example.org',
  'ATTENDEE;CN=Luis;PARTSTAT=ACCEPTED:mailto:luis@example.org',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT15M',
  'DESCRIPTION:Recordatorio',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
)

const BERLIN_VTIMEZONE = ics(
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
)

function baseEvent(overrides: Partial<CalendarEvent> = {}): Omit<CalendarEvent, 'calendarHref' | 'etag'> {
  return {
    uid: 'evt-1',
    title: 'New title',
    // 10:00 in Berlin on 24 Mar 2026, before the DST switch.
    start: new Date(Date.UTC(2026, 2, 24, 9, 0)),
    end: new Date(Date.UTC(2026, 2, 24, 10, 0)),
    allDay: false,
    ...overrides,
  }
}

function parse(icsText: string) {
  const comp = new ICAL.Component(ICAL.parse(icsText))
  return { comp, vevent: comp.getFirstSubcomponent('vevent')! }
}

describe('mergeIcs', () => {
  it('keeps alarms, attendees and every foreign property when the title changes', () => {
    const merged = mergeIcs(STORED, baseEvent())

    expect(merged).toContain('BEGIN:VALARM')
    expect(merged).toContain('TRIGGER:-PT15M')
    expect(merged).toContain('ATTENDEE;CN=Luis;PARTSTAT=ACCEPTED:mailto:luis@example.org')
    expect(merged).toContain('ORGANIZER;CN=Ana:mailto:ana@example.org')
    expect(merged).toContain('STATUS:CONFIRMED')
    expect(merged).toContain('SEQUENCE:3')
    expect(merged).toContain('CATEGORIES:Work')
    expect(merged).toContain('X-CUSTOM-FLAG:yes')
    expect(merged).toContain('CREATED:20251201T090000Z')

    const { vevent } = parse(merged)
    expect(vevent.getFirstPropertyValue('summary')).toBe('New title')
    expect(vevent.getFirstPropertyValue('last-modified')).not.toBe('20251202T090000Z')
  })

  it('removes only the optional properties the model cleared', () => {
    const merged = mergeIcs(STORED, baseEvent({ description: undefined, location: undefined }))
    const { vevent } = parse(merged)

    expect(vevent.getFirstProperty('description')).toBeNull()
    expect(vevent.getFirstProperty('location')).toBeNull()
    // The alarm keeps its own DESCRIPTION.
    const alarm = vevent.getFirstSubcomponent('valarm')!
    expect(String(alarm.getFirstPropertyValue('description'))).toBe('Recordatorio')
    expect(vevent.getFirstProperty('status')).toBeDefined()
  })

  it('writes a timed event in the device zone and adds the missing VTIMEZONE', () => {
    const merged = mergeIcs(STORED, baseEvent())

    expect(merged).toMatch(/DTSTART;TZID=Europe\/Berlin:20260324T100000/)
    expect(merged).toMatch(/DTEND;TZID=Europe\/Berlin:20260324T110000/)
    const zones = parse(merged).comp.getAllSubcomponents('vtimezone')
    expect(zones.map((z) => z.getFirstPropertyValue('tzid'))).toEqual(['Europe/Berlin'])
  })

  it('does not duplicate a VTIMEZONE the object already carries', () => {
    const stored = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//KashCal//EN',
      ...BERLIN_VTIMEZONE.trimEnd().split('\r\n'),
      'BEGIN:VEVENT',
      'UID:evt-1',
      'DTSTAMP:20260101T000000Z',
      'DTSTART;TZID=Europe/Berlin:20260324T100000',
      'DTEND;TZID=Europe/Berlin:20260324T110000',
      'SUMMARY:Old title',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT15M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    )
    const zones = parse(mergeIcs(stored, baseEvent())).comp.getAllSubcomponents('vtimezone')
    expect(zones).toHaveLength(1)
  })

  it('switches to an all-day date without keeping a TZID', () => {
    const merged = mergeIcs(STORED, baseEvent({ allDay: true, start: new Date(2026, 2, 24), end: new Date(2026, 2, 25) }))
    const { vevent } = parse(merged)

    expect(merged).toContain('DTSTART;VALUE=DATE:20260324')
    expect(merged).toContain('DTEND;VALUE=DATE:20260325')
    expect(vevent.getFirstProperty('dtstart')!.getParameter('tzid')).toBeUndefined()
    expect(merged).toContain('BEGIN:VALARM')
  })

  it('edits the master and leaves a RECURRENCE-ID override untouched', () => {
    const stored = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//KashCal//EN',
      'BEGIN:VEVENT',
      'UID:series-1',
      'DTSTAMP:20260101T000000Z',
      'DTSTART;TZID=Europe/Berlin:20260324T100000',
      'DTEND;TZID=Europe/Berlin:20260324T110000',
      'SUMMARY:Master',
      'RRULE:FREQ=WEEKLY;COUNT=4',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT5M',
      'END:VALARM',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:series-1',
      'RECURRENCE-ID;TZID=Europe/Berlin:20260331T100000',
      'DTSTAMP:20260101T000000Z',
      'DTSTART;TZID=Europe/Berlin:20260331T120000',
      'DTEND;TZID=Europe/Berlin:20260331T130000',
      'SUMMARY:Moved occurrence',
      'END:VEVENT',
      'END:VCALENDAR',
    )
    const merged = mergeIcs(stored, {
      ...baseEvent({ uid: 'series-1', title: 'Renamed series', rrule: 'FREQ=WEEKLY;COUNT=4' }),
    })
    const comp = new ICAL.Component(ICAL.parse(merged))
    const vevents = comp.getAllSubcomponents('vevent')

    expect(vevents).toHaveLength(2)
    expect(vevents[0].getFirstPropertyValue('summary')).toBe('Renamed series')
    expect(vevents[0].getFirstSubcomponent('valarm')).toBeTruthy()
    expect(vevents[1].getFirstPropertyValue('summary')).toBe('Moved occurrence')
    expect(String(vevents[1].getFirstPropertyValue('recurrence-id'))).toContain('2026-03-31')
  })

  it('falls back to a fresh object when the stored body cannot be parsed', () => {
    const event = baseEvent()
    expect(mergeIcs('not an icalendar body', event)).toBe(buildIcs(event))
  })
})
