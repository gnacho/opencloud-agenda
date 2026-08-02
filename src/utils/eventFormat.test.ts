import { describe, it, expect } from 'vitest'
import { sameDay, addDays, formatEventRange } from './eventFormat'

const DE = 'de-DE'

// The DST cases are meaningless in UTC, where every local day is exactly 24 h.
it('runs in Europe/Berlin — the DST cases below depend on it', () => {
  expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-120)  // CEST
  expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-60)   // CET
})

describe('addDays', () => {
  it('shifts by whole calendar days', () => {
    expect(addDays(new Date(2026, 7, 2), 1).getDate()).toBe(3)
    expect(addDays(new Date(2026, 7, 2), -1).getDate()).toBe(1)
  })

  it('crosses month and year boundaries', () => {
    expect(addDays(new Date(2026, 7, 31), 1).getMonth()).toBe(8)
    expect(addDays(new Date(2026, 0, 1), -1).getFullYear()).toBe(2025)
  })

  it('lands on the right date across the spring-forward change', () => {
    // 29 Mar 2026: Europe/Berlin loses an hour, so that local day is only 23 h
    const d = addDays(new Date(2026, 2, 30), -1)
    expect([d.getDate(), d.getMonth()]).toEqual([29, 2])
  })

  it('lands on the right date across the fall-back change', () => {
    // 25 Oct 2026: that local day is 25 h long
    const d = addDays(new Date(2026, 9, 26), -1)
    expect([d.getDate(), d.getMonth()]).toEqual([25, 9])
  })

  it('does not mutate its argument', () => {
    const orig = new Date(2026, 7, 2)
    addDays(orig, 5)
    expect(orig.getDate()).toBe(2)
  })
})

describe('sameDay', () => {
  it('treats two times on the same calendar day as equal', () => {
    expect(sameDay(new Date(2026, 7, 2, 0, 0), new Date(2026, 7, 2, 23, 59))).toBe(true)
  })

  it('distinguishes adjacent days', () => {
    expect(sameDay(new Date(2026, 7, 2, 23, 59), new Date(2026, 7, 3, 0, 1))).toBe(false)
  })

  it('does not collapse the same day-of-month in different months or years', () => {
    expect(sameDay(new Date(2026, 7, 2), new Date(2026, 8, 2))).toBe(false)
    expect(sameDay(new Date(2026, 7, 2), new Date(2025, 7, 2))).toBe(false)
  })
})

describe('formatEventRange — timed events', () => {
  it('shows one date with a start–end time when both ends fall on the same day', () => {
    const out = formatEventRange(
      { start: new Date(2026, 7, 2, 15, 30), end: new Date(2026, 7, 2, 17, 30), allDay: false }, DE,
    )
    expect(out).toBe('So., 2. Aug. 2026, 15:30 – 17:30')
  })

  it('repeats the date when the event crosses midnight', () => {
    const out = formatEventRange(
      { start: new Date(2026, 7, 2, 22, 0), end: new Date(2026, 7, 3, 1, 0), allDay: false }, DE,
    )
    expect(out).toBe('So., 2. Aug. 2026, 22:00 – Mo., 3. Aug. 2026, 01:00')
  })
})

describe('formatEventRange — all-day events', () => {
  it('shows a single date for a one-day event (DTEND is the next day)', () => {
    // iCal: DTSTART;VALUE=DATE:20260802  DTEND;VALUE=DATE:20260803
    const out = formatEventRange(
      { start: new Date(2026, 7, 2), end: new Date(2026, 7, 3), allDay: true }, DE,
    )
    expect(out).toBe('So., 2. Aug. 2026')
  })

  it('shows the inclusive last day for a multi-day event', () => {
    // DTEND 20260805 means the event covers 2. – 4. August
    const out = formatEventRange(
      { start: new Date(2026, 7, 2), end: new Date(2026, 7, 5), allDay: true }, DE,
    )
    expect(out).toBe('So., 2. Aug. 2026 – Di., 4. Aug. 2026')
  })

  it('handles a range crossing a month boundary', () => {
    const out = formatEventRange(
      { start: new Date(2026, 6, 30), end: new Date(2026, 7, 2), allDay: true }, DE,
    )
    expect(out).toBe('Do., 30. Juli 2026 – Sa., 1. Aug. 2026')
  })

  it('keeps the last day correct across the fall-back change', () => {
    const out = formatEventRange(
      { start: new Date(2026, 9, 24), end: new Date(2026, 9, 26), allDay: true }, DE,
    )
    expect(out).toBe('Sa., 24. Okt. 2026 – So., 25. Okt. 2026')
  })

  it('keeps the last day correct across the spring-forward change', () => {
    // Regression: with a naive -24h this reported 28 March, cutting a day off
    const out = formatEventRange(
      { start: new Date(2026, 2, 28), end: new Date(2026, 2, 30), allDay: true }, DE,
    )
    expect(out).toBe('Sa., 28. März 2026 – So., 29. März 2026')
  })
})
