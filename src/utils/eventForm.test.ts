import { describe, it, expect } from 'vitest'
import {
  parseFormDates,
  validateFormDates,
  isValidDate,
  INVALID_DATE_MESSAGE,
  END_BEFORE_START_MESSAGE,
} from './eventForm'

const timed = (start: string, end: string) => ({
  allDay: false,
  startDate: '',
  endDate: '',
  startDateTime: start,
  endDateTime: end,
})

const allDay = (start: string, end: string) => ({
  allDay: true,
  startDate: start,
  endDate: end,
  startDateTime: '',
  endDateTime: '',
})

// vitest.config.ts pins TZ=Europe/Berlin, so "local day" has a real DST change.

describe('parseFormDates', () => {
  it('reads timed fields as local dates', () => {
    const { start, end } = parseFormDates(timed('2026-10-20T10:00', '2026-10-20T11:30'))
    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(9)
    expect(start.getDate()).toBe(20)
    expect(start.getHours()).toBe(10)
    expect(end.getHours()).toBe(11)
    expect(end.getMinutes()).toBe(30)
  })

  it('adds one day to the inclusive all-day end so DTEND stays exclusive', () => {
    const { start, end } = parseFormDates(allDay('2026-10-20', '2026-10-20'))
    expect(start.getDate()).toBe(20)
    expect(end.getDate()).toBe(21)
    expect(end.getHours()).toBe(0)
  })

  it('keeps whole calendar days across the spring-forward day (23 h long)', () => {
    // 2026-03-29 is the DST switch in Europe/Berlin: the local day is 23 h.
    const { start, end } = parseFormDates(allDay('2026-03-29', '2026-03-29'))
    expect(start.getDate()).toBe(29)
    expect(end.getDate()).toBe(30)
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000)
  })

  it('produces an Invalid Date when a field is empty, which is what used to reach the ICS', () => {
    const { start, end } = parseFormDates(timed('', ''))
    expect(isValidDate(start)).toBe(false)
    expect(isValidDate(end)).toBe(false)
  })
})

describe('validateFormDates', () => {
  it('accepts a valid timed pair', () => {
    const { start, end } = parseFormDates(timed('2026-10-20T10:00', '2026-10-20T11:00'))
    expect(validateFormDates(start, end)).toBeNull()
  })

  it('rejects an empty timed pair instead of letting it through', () => {
    const { start, end } = parseFormDates(timed('', ''))
    expect(validateFormDates(start, end)).toBe(INVALID_DATE_MESSAGE)
  })

  it('rejects an empty all-day pair', () => {
    const { start, end } = parseFormDates(allDay('', ''))
    expect(validateFormDates(start, end)).toBe(INVALID_DATE_MESSAGE)
  })

  it('rejects a half-filled pair', () => {
    const { start, end } = parseFormDates(timed('2026-10-20T10:00', ''))
    expect(validateFormDates(start, end)).toBe(INVALID_DATE_MESSAGE)
  })

  it('rejects an unparsable value instead of relying on the comparison', () => {
    const { start, end } = parseFormDates(timed('not-a-date', '2026-10-20T11:00'))
    expect(validateFormDates(start, end)).toBe(INVALID_DATE_MESSAGE)
  })

  it('still rejects an end before the start', () => {
    const { start, end } = parseFormDates(timed('2026-10-20T12:00', '2026-10-20T11:00'))
    expect(validateFormDates(start, end)).toBe(END_BEFORE_START_MESSAGE)
  })

  it('allows an end equal to the start, as before', () => {
    const { start, end } = parseFormDates(timed('2026-10-20T10:00', '2026-10-20T10:00'))
    expect(validateFormDates(start, end)).toBeNull()
  })
})
