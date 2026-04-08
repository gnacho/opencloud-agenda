import { describe, it, expect } from 'vitest'
import { parseRrule, buildRrule, getNthWeekday } from './rrule'

describe('parseRrule', () => {
  it('parses DAILY', () => {
    const r = parseRrule('FREQ=DAILY')
    expect(r.freq).toBe('DAILY')
    expect(r.endType).toBe('NEVER')
  })

  it('parses WEEKLY with weekdays', () => {
    const r = parseRrule('FREQ=WEEKLY;BYDAY=MO,WE,FR')
    expect(r.freq).toBe('WEEKLY')
    expect(r.days).toEqual(['MO', 'WE', 'FR'])
  })

  it('parses MONTHLY by day-of-month', () => {
    const r = parseRrule('FREQ=MONTHLY')
    expect(r.freq).toBe('MONTHLY')
    expect(r.monthlyType).toBe('DAYOFMONTH')
  })

  it('parses MONTHLY by Nth weekday (1TU = 1st Tuesday)', () => {
    const r = parseRrule('FREQ=MONTHLY;BYDAY=1TU')
    expect(r.freq).toBe('MONTHLY')
    expect(r.monthlyType).toBe('NTHWEEKDAY')
    expect(r.monthlyByday).toBe('1TU')
    expect(r.days).toEqual([]) // not treated as plain BYDAY
  })

  it('parses MONTHLY by last weekday (-1MO)', () => {
    const r = parseRrule('FREQ=MONTHLY;BYDAY=-1MO')
    expect(r.monthlyType).toBe('NTHWEEKDAY')
    expect(r.monthlyByday).toBe('-1MO')
  })

  it('parses YEARLY', () => {
    const r = parseRrule('FREQ=YEARLY')
    expect(r.freq).toBe('YEARLY')
  })

  it('parses COUNT end condition', () => {
    const r = parseRrule('FREQ=DAILY;COUNT=5')
    expect(r.endType).toBe('COUNT')
    expect(r.count).toBe(5)
  })

  it('parses UNTIL end condition', () => {
    const r = parseRrule('FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231')
    expect(r.endType).toBe('UNTIL')
    expect(r.until).toBe('2026-12-31')
  })
})

describe('buildRrule', () => {
  const monday = new Date('2026-04-06T09:00:00Z') // Monday

  it('returns undefined for NONE', () => {
    expect(buildRrule({ freq: 'NONE', days: [], monthlyType: 'DAYOFMONTH', endType: 'NEVER', count: 10, until: '', startDate: monday })).toBeUndefined()
  })

  it('builds DAILY, never ending', () => {
    const r = buildRrule({ freq: 'DAILY', days: [], monthlyType: 'DAYOFMONTH', endType: 'NEVER', count: 10, until: '', startDate: monday })
    expect(r).toBe('FREQ=DAILY')
  })

  it('builds WEEKLY with explicit days', () => {
    const r = buildRrule({ freq: 'WEEKLY', days: ['MO', 'WE'], monthlyType: 'DAYOFMONTH', endType: 'NEVER', count: 10, until: '', startDate: monday })
    expect(r).toBe('FREQ=WEEKLY;BYDAY=MO,WE')
  })

  it('builds WEEKLY defaulting to start-date weekday when no days selected', () => {
    const r = buildRrule({ freq: 'WEEKLY', days: [], monthlyType: 'DAYOFMONTH', endType: 'NEVER', count: 10, until: '', startDate: monday })
    expect(r).toBe('FREQ=WEEKLY;BYDAY=MO')
  })

  it('builds MONTHLY by day-of-month', () => {
    const r = buildRrule({ freq: 'MONTHLY', days: [], monthlyType: 'DAYOFMONTH', endType: 'NEVER', count: 10, until: '', startDate: monday })
    expect(r).toBe('FREQ=MONTHLY')
  })

  it('builds MONTHLY by Nth weekday (1st Monday)', () => {
    const r = buildRrule({ freq: 'MONTHLY', days: [], monthlyType: 'NTHWEEKDAY', endType: 'NEVER', count: 10, until: '', startDate: monday })
    expect(r).toBe('FREQ=MONTHLY;BYDAY=1MO')
  })

  it('builds YEARLY', () => {
    const r = buildRrule({ freq: 'YEARLY', days: [], monthlyType: 'DAYOFMONTH', endType: 'NEVER', count: 10, until: '', startDate: monday })
    expect(r).toBe('FREQ=YEARLY')
  })

  it('appends COUNT', () => {
    const r = buildRrule({ freq: 'DAILY', days: [], monthlyType: 'DAYOFMONTH', endType: 'COUNT', count: 7, until: '', startDate: monday })
    expect(r).toBe('FREQ=DAILY;COUNT=7')
  })

  it('appends UNTIL', () => {
    const r = buildRrule({ freq: 'WEEKLY', days: ['TU'], monthlyType: 'DAYOFMONTH', endType: 'UNTIL', count: 10, until: '2026-12-31', startDate: monday })
    expect(r).toBe('FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231T000000Z')
  })

  it('roundtrips: parse → build gives equivalent rule', () => {
    const original = 'FREQ=WEEKLY;BYDAY=MO,FR;COUNT=10'
    const parsed = parseRrule(original)
    const rebuilt = buildRrule({ ...parsed, startDate: monday })
    expect(rebuilt).toBe(original)
  })
})

describe('getNthWeekday', () => {
  it('returns 1MO for first Monday of month', () => {
    expect(getNthWeekday(new Date('2026-04-06T00:00:00'))).toBe('1MO')
  })

  it('returns 2TU for second Tuesday of month', () => {
    expect(getNthWeekday(new Date('2026-04-14T00:00:00'))).toBe('2TU')
  })

  it('returns 1TU for April 7 2026 (1st Tuesday)', () => {
    expect(getNthWeekday(new Date('2026-04-07T00:00:00'))).toBe('1TU')
  })
})
