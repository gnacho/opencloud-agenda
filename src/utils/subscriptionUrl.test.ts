import { describe, it, expect } from 'vitest'
import { toWebcalUrl, canonicalFeedUrl } from './subscriptionUrl'

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

describe('canonicalFeedUrl', () => {
  const WWW = 'https://www.google.com/calendar/ical/bf5j7og8oagrbhk1l3tt4ql3vk%40group.calendar.google.com/public/basic.ics'
  const CANON = 'https://calendar.google.com/calendar/ical/bf5j7og8oagrbhk1l3tt4ql3vk%40group.calendar.google.com/public/basic.ics'

  it('points a www.google.com feed straight at calendar.google.com', () => {
    // www.google.com answers 302 with no body; a client that does not follow
    // redirects subscribes successfully and then shows an empty calendar.
    expect(canonicalFeedUrl(WWW)).toBe(CANON)
  })

  it('keeps the percent-encoded calendar id intact', () => {
    expect(canonicalFeedUrl(WWW)).toContain('%40group.calendar.google.com')
  })

  it('rewrites the http variant and keeps the scheme', () => {
    expect(canonicalFeedUrl('http://www.google.com/calendar/ical/x/public/basic.ics'))
      .toBe('http://calendar.google.com/calendar/ical/x/public/basic.ics')
  })

  it('leaves an already canonical URL alone', () => {
    expect(canonicalFeedUrl(CANON)).toBe(CANON)
  })

  it('does not touch other google paths', () => {
    expect(canonicalFeedUrl('https://www.google.com/search?q=x'))
      .toBe('https://www.google.com/search?q=x')
  })

  it('does not touch other hosts', () => {
    expect(canonicalFeedUrl('https://ics.tools/Feiertage/nordrhein-westfalen.ics'))
      .toBe('https://ics.tools/Feiertage/nordrhein-westfalen.ics')
  })
})
