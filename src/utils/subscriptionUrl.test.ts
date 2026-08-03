import { describe, it, expect } from 'vitest'
import { toWebcalUrl } from './subscriptionUrl'

describe('toWebcalUrl', () => {
  it('swaps https for webcal', () => {
    expect(toWebcalUrl('https://example.org/cal.ics')).toBe('webcal://example.org/cal.ics')
  })

  it('swaps plain http too', () => {
    expect(toWebcalUrl('http://example.org/cal.ics')).toBe('webcal://example.org/cal.ics')
  })

  it('leaves the rest of the URL untouched, including percent-encoding', () => {
    // The Google feed URLs carry a %40 for the @ in the calendar id — mangling
    // it would produce a link that 404s on the other device.
    expect(toWebcalUrl('https://www.google.com/calendar/ical/abc%40group.calendar.google.com/public/basic.ics'))
      .toBe('webcal://www.google.com/calendar/ical/abc%40group.calendar.google.com/public/basic.ics')
  })

  it('only replaces the scheme, not a later occurrence', () => {
    expect(toWebcalUrl('https://example.org/r?u=https://other.test/x.ics'))
      .toBe('webcal://example.org/r?u=https://other.test/x.ics')
  })

  it('passes through a URL that is already webcal', () => {
    expect(toWebcalUrl('webcal://example.org/cal.ics')).toBe('webcal://example.org/cal.ics')
  })

  it('ignores schemes it does not know', () => {
    expect(toWebcalUrl('ftp://example.org/cal.ics')).toBe('ftp://example.org/cal.ics')
  })
})
