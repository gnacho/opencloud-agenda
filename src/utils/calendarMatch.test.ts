import { describe, expect, it } from 'vitest'
import { canonicalCalendarHref, findCalendarByHref } from './calendarMatch'

describe('findCalendarByHref', () => {
  const calendars = [
    { href: '/caldav/u/cal', color: '#111' },
    { href: '/caldav/u/calendar', color: '#222' }
  ]

  it('matches the owning calendar even when another href is a prefix of it', () => {
    expect(findCalendarByHref(calendars, '/caldav/u/cal/ev.ics')?.href).toBe('/caldav/u/cal')
    expect(findCalendarByHref(calendars, '/caldav/u/calendar/ev.ics')?.href).toBe(
      '/caldav/u/calendar'
    )
  })

  it('accepts collection hrefs with or without a trailing slash', () => {
    expect(
      findCalendarByHref([{ href: '/caldav/u/cal/' }], '/caldav/u/cal/ev.ics')?.href
    ).toBe('/caldav/u/cal/')
  })

  it('returns undefined when no calendar owns the href', () => {
    expect(findCalendarByHref(calendars, '/caldav/u/other/ev.ics')).toBeUndefined()
  })
})

describe('canonicalCalendarHref', () => {
  it('appends the trailing slash when missing', () => {
    expect(canonicalCalendarHref('/caldav/u/cal')).toBe('/caldav/u/cal/')
    expect(canonicalCalendarHref('/caldav/u/cal/')).toBe('/caldav/u/cal/')
  })
})
