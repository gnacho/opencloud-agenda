import { describe, it, expect } from 'vitest'
import ICAL from 'ical.js'
import { userTimeZone, zoneOffsetMs, wallClockStamp, localCompact, buildVTimeZone } from './timezone'

const HOUR_MS = 60 * 60 * 1000

function icsFor(zone: string, localStamp: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    ...buildVTimeZone(zone),
    'BEGIN:VEVENT',
    'UID:tz-roundtrip',
    'DTSTAMP:20260101T000000Z',
    `DTSTART;TZID=${zone}:${localStamp}`,
    `DTEND;TZID=${zone}:${localStamp}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n') + '\r\n'
}

// Same path the app uses: parse the resource, then read the start date back.
function startInstant(ics: string): number {
  const comp = new ICAL.Component(ICAL.parse(ics))
  const ev = new ICAL.Event(comp.getAllSubcomponents('vevent')[0])
  return ev.startDate.toJSDate().getTime()
}

// Local wall clock -> ICS -> ical.js must return the original instant. If the
// VTIMEZONE has a wrong offset or a wrong rule, the months around a DST switch
// come back shifted by an hour.
function roundTrip(zone: string, at: number): number {
  return startInstant(icsFor(zone, wallClockStamp(at + zoneOffsetMs(zone, at))))
}

describe('userTimeZone', () => {
  it('returns a zone the formatter accepts', () => {
    const zone = userTimeZone()
    expect(typeof zone).toBe('string')
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0)).not.toThrow()
  })
})

describe('zoneOffsetMs', () => {
  it('knows the two Berlin offsets', () => {
    expect(zoneOffsetMs('Europe/Berlin', Date.UTC(2026, 0, 15))).toBe(HOUR_MS)
    expect(zoneOffsetMs('Europe/Berlin', Date.UTC(2026, 6, 15))).toBe(2 * HOUR_MS)
  })

  it('handles a zone with no DST and one with a 30-minute shift', () => {
    expect(zoneOffsetMs('Asia/Kolkata', Date.UTC(2026, 0, 15))).toBe(330 * 60 * 1000)
    // Lord Howe moves by 30 minutes.
    expect(zoneOffsetMs('Australia/Lord_Howe', Date.UTC(2026, 6, 15)))
      .toBe((10 * 60 + 30) * 60 * 1000)
  })
})

describe('localCompact', () => {
  it('writes the wall clock of the zone, not UTC', () => {
    // 2026-01-15T12:00Z is 13:00 in Berlin (UTC+1).
    expect(localCompact('Europe/Berlin', Date.UTC(2026, 0, 15, 12))).toBe('20260115T130000')
  })
})

describe('buildVTimeZone', () => {
  it('wraps the zone and its offsets', () => {
    const lines = buildVTimeZone('Europe/Berlin', new Date(Date.UTC(2026, 3, 9)))
    expect(lines[0]).toBe('BEGIN:VTIMEZONE')
    expect(lines).toContain('TZID:Europe/Berlin')
    expect(lines).toContain('BEGIN:DAYLIGHT')
    expect(lines).toContain('BEGIN:STANDARD')
    expect(lines[lines.length - 1]).toBe('END:VTIMEZONE')
    expect(lines.filter(l => l.startsWith('TZOFFSETTO:')).length).toBeGreaterThan(0)
  })

  it('emits a yearly rule for a zone with a stable pattern', () => {
    const lines = buildVTimeZone('Europe/Berlin', new Date(Date.UTC(2026, 3, 9)))
    // Last Sunday of March and October, so the definition does not expire.
    expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU')
    expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU')
  })

  it('emits a single STANDARD for a zone without DST', () => {
    const lines = buildVTimeZone('Asia/Kolkata', new Date(Date.UTC(2026, 3, 9)))
    expect(lines.filter(l => l.startsWith('BEGIN:'))).toEqual(['BEGIN:VTIMEZONE', 'BEGIN:STANDARD'])
    expect(lines).toContain('TZOFFSETTO:+0530')
    expect(lines.some(l => l.startsWith('RRULE:'))).toBe(false)
  })

  it('returns nothing for an unusable zone', () => {
    expect(buildVTimeZone('')).toEqual([])
  })
})

// The expensive one, and the one that actually proves the definition is right.
describe('VTIMEZONE round-trip through ical.js', () => {
  const zones = [
    'Europe/Berlin',
    'Europe/Madrid',
    'America/New_York',
    'Asia/Kolkata',
    'Australia/Lord_Howe',
    'Pacific/Chatham',
    'Africa/Casablanca',
  ]

  for (const zone of zones) {
    it(`${zone}: every month of the window survives the round-trip`, () => {
      const year = new Date().getUTCFullYear()
      const failures: string[] = []
      for (let y = year - 1; y <= year + 2; y++) {
        for (let m = 0; m < 12; m++) {
          // Midday UTC, well away from the switches themselves.
          const at = Date.UTC(y, m, 15, 12)
          const back = roundTrip(zone, at)
          if (back !== at) {
            failures.push(`${new Date(at).toISOString()} -> ${new Date(back).toISOString()}`)
          }
        }
      }
      expect(failures).toEqual([])
    })
  }

  // The regression the fix is about: same wall clock, different offsets.
  it('keeps 10:00 local on both sides of the October switch', () => {
    const before = startInstant(icsFor('Europe/Berlin', '20261020T100000'))
    const after = startInstant(icsFor('Europe/Berlin', '20261027T100000'))
    expect(new Date(before).toISOString()).toBe('2026-10-20T08:00:00.000Z') // UTC+2
    expect(new Date(after).toISOString()).toBe('2026-10-27T09:00:00.000Z')  // UTC+1
    // Both are 10:00 in the zone, which is the invariant.
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    expect(fmt.format(new Date(before))).toBe('10:00')
    expect(fmt.format(new Date(after))).toBe('10:00')
  })
})
