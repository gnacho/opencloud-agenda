import { describe, expect, it } from 'vitest'
import { buildIcs, parseEvents } from './caldav'
import type { CalendarEvent } from './caldav'
import { buildVTimeZone } from '@/utils/timezone'

const href = '/caldav/u/cal/'

function ics(...lines: string[]): string {
  return lines.join('\r\n')
}

/** Model fields that must survive a parse -> build -> parse round-trip. */
function modelFields(e: CalendarEvent) {
  return {
    title: e.title,
    description: e.description,
    location: e.location,
    allDay: e.allDay,
    start: e.start.toISOString(),
    end: e.end.toISOString(),
    rrule: e.rrule
  }
}

function roundTrip(events: CalendarEvent[]): CalendarEvent[] {
  return events.flatMap((e) => parseEvents(buildIcs(e), href))
}

function wallHours(dates: Date[], zone: string): string[] {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
  return dates.map((d) => fmt.format(d))
}

const BERLIN_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19810329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19961027T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE'
]

// Real-world shapes: the invariant is "what the app reads and writes back
// comes back equal", so each entry mirrors a concrete client export.
const SINGLE_EVENT_CORPUS: { name: string; ics: string }[] = [
  {
    name: 'Thunderbird single event in UTC',
    ics: ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN',
      'BEGIN:VEVENT',
      'UID:tb-001',
      'DTSTAMP:20260102T030405Z',
      'DTSTART:20260406T090000Z',
      'DTEND:20260406T100000Z',
      'SUMMARY:Review',
      'DESCRIPTION:Line one\\nLine two',
      'LOCATION:Room A',
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'SEQUENCE:0',
      'END:VEVENT',
      'END:VCALENDAR'
    )
  },
  {
    name: 'DAVx5-style event with TZID and VTIMEZONE',
    ics: ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:+//IDN bitfire.at//DAVx5/4.3//EN',
      ...BERLIN_VTIMEZONE,
      'BEGIN:VEVENT',
      'UID:davx5-001',
      'DTSTAMP:20260102T030405Z',
      'DTSTART;TZID=Europe/Berlin:20260406T090000',
      'DTEND;TZID=Europe/Berlin:20260406T100000',
      'SUMMARY:Dentist',
      'END:VEVENT',
      'END:VCALENDAR'
    )
  },
  {
    name: 'Google-style event with extra properties',
    ics: ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
      ...BERLIN_VTIMEZONE,
      'BEGIN:VEVENT',
      'UID:google-001',
      'DTSTAMP:20260102T030405Z',
      'DTSTART;TZID=Europe/Berlin:20260407T140000',
      'DTEND;TZID=Europe/Berlin:20260407T150000',
      'SUMMARY:1:1 with Anna',
      'DESCRIPTION:Agenda: sprint review',
      'LOCATION:Meet / Room 4',
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'CREATED:20260101T120000Z',
      'LAST-MODIFIED:20260101T120000Z',
      'SEQUENCE:1',
      'END:VEVENT',
      'END:VCALENDAR'
    )
  },
  {
    name: 'all-day event with exclusive DTEND',
    ics: ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      'BEGIN:VEVENT',
      'UID:allday-001',
      'DTSTAMP:20260102T030405Z',
      'DTSTART;VALUE=DATE:20260406',
      'DTEND;VALUE=DATE:20260408',
      'SUMMARY:Conference',
      'END:VEVENT',
      'END:VCALENDAR'
    )
  },
  {
    name: 'floating-time event',
    ics: ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      'BEGIN:VEVENT',
      'UID:floating-001',
      'DTSTAMP:20260102T030405Z',
      'DTSTART:20260406T090000',
      'DTEND:20260406T100000',
      'SUMMARY:Floating',
      'END:VEVENT',
      'END:VCALENDAR'
    )
  }
]

describe('iCalendar round-trip over a real-world corpus', () => {
  for (const { name, ics: raw } of SINGLE_EVENT_CORPUS) {
    it(`parse(build(parse(x))) equals parse(x): ${name}`, () => {
      const parsed = parseEvents(raw, href)
      expect(parsed).toHaveLength(1)
      const again = roundTrip(parsed)
      expect(again.map(modelFields)).toEqual(parsed.map(modelFields))
    })
  }

  it('round-trips a TZID series with its wall-clock time and occurrences', () => {
    const raw = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      ...BERLIN_VTIMEZONE,
      'BEGIN:VEVENT',
      'UID:series-001',
      'DTSTAMP:20260102T030405Z',
      'DTSTART;TZID=Europe/Berlin:20261020T100000',
      'DTEND;TZID=Europe/Berlin:20261020T110000',
      'SUMMARY:Weekly',
      'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=4',
      'END:VEVENT',
      'END:VCALENDAR'
    )
    const parsed = parseEvents(raw, href)
    expect(parsed.length).toBeGreaterThan(0)

    // Rebuild from the first occurrence: the RRULE is kept, so the series
    // expands again from the same instant and every occurrence must match.
    const again = roundTrip([parsed[0]])
    expect(again.length).toBeGreaterThan(0)
    const n = Math.min(parsed.length, again.length, 4)
    for (let i = 0; i < n; i++) {
      expect(again[i].start.getTime()).toBe(parsed[i].start.getTime())
      expect(again[i].end.getTime()).toBe(parsed[i].end.getTime())
    }
    expect(again[0].rrule).toBe(parsed[0].rrule)
    expect(again[0].title).toBe(parsed[0].title)
    expect(wallHours(again.map((e) => e.start), 'Europe/Berlin')).toEqual(
      wallHours(parsed.slice(0, again.length).map((e) => e.start), 'Europe/Berlin')
    )
  })

  it('applies a RECURRENCE-ID override once, with the override fields', () => {
    const raw = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      'BEGIN:VEVENT',
      'UID:override-001',
      'DTSTAMP:20260102T030405Z',
      'DTSTART:20260406T090000Z',
      'DTEND:20260406T100000Z',
      'SUMMARY:Standup',
      'RRULE:FREQ=WEEKLY;COUNT=2',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:override-001',
      'RECURRENCE-ID:20260413T090000Z',
      'DTSTAMP:20260102T030405Z',
      'DTSTART:20260413T110000Z',
      'DTEND:20260413T120000Z',
      'SUMMARY:Standup (moved)',
      'END:VEVENT',
      'END:VCALENDAR'
    )
    const parsed = parseEvents(raw, href)
    const moved = parsed.filter((e) => e.title === 'Standup (moved)')
    expect(moved).toHaveLength(1)
    expect(moved[0].start.toISOString()).toBe('2026-04-13T11:00:00.000Z')
    // The overridden slot must not also appear with the master fields.
    expect(parsed.filter((e) => e.start.toISOString() === '2026-04-13T09:00:00.000Z')).toHaveLength(0)
  })

  it('documents that EXDATE is not part of the app model yet', () => {
    const raw = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      'BEGIN:VEVENT',
      'UID:exdate-001',
      'DTSTAMP:20260102T030405Z',
      'DTSTART:20260406T090000Z',
      'DTEND:20260406T100000Z',
      'SUMMARY:Series',
      'RRULE:FREQ=WEEKLY;COUNT=2',
      'EXDATE:20260413T090000Z',
      'END:VEVENT',
      'END:VCALENDAR'
    )
    const parsed = parseEvents(raw, href)
    expect(parsed.map((e) => e.start.toISOString())).toEqual(['2026-04-06T09:00:00.000Z'])

    // Known limitation: rebuilding drops EXDATE (the app model has no field
    // for it), so the excluded occurrence reappears after a round-trip. This
    // assertion pins the behaviour until EXDATE support lands.
    const again = roundTrip([parsed[0]])
    expect(again.length).toBe(2)
  })
})

describe('DST wall-clock invariance across zones', () => {
  const cases = [
    {
      zone: 'Europe/Berlin',
      start: '20260324T100000',
      end: '20260324T110000',
      count: 6, // 24 Mar is before the 29 Mar switch; 6 Tuesdays cross it
      offsetsDiffer: true
    },
    {
      zone: 'Asia/Kolkata',
      start: '20260324T100000',
      end: '20260324T110000',
      count: 6, // no DST: the offset stays +05:30 the whole time
      offsetsDiffer: false
    },
    {
      zone: 'Australia/Lord_Howe',
      start: '20260324T100000',
      end: '20260324T110000',
      count: 3, // DST ends first Sunday of April: a 30-minute shift
      offsetsDiffer: true
    }
  ]

  for (const { zone, start, end, count, offsetsDiffer } of cases) {
    it(`keeps a weekly series at 10:00 local across the ${zone} switch`, () => {
      const raw = ics(
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//roundtrip-test//EN',
        ...buildVTimeZone(zone),
        'BEGIN:VEVENT',
        'UID:dst-series',
        'DTSTAMP:20260101T000000Z',
        `DTSTART;TZID=${zone}:${start}`,
        `DTEND;TZID=${zone}:${end}`,
        'SUMMARY:DST series',
        `RRULE:FREQ=WEEKLY;COUNT=${count}`,
        'END:VEVENT',
        'END:VCALENDAR'
      )
      const events = parseEvents(raw, href)
      expect(events).toHaveLength(count)
      expect(wallHours(events.map((e) => e.start), zone)).toEqual(Array(count).fill('10:00'))

      const utcTimes = new Set(events.map((e) => e.start.toISOString().slice(11, 16)))
      expect(utcTimes.size > 1).toBe(offsetsDiffer)
    })
  }
})
