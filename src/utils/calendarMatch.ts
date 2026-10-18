/**
 * Canonical collection href: PROPFIND answers carry the trailing slash, but a
 * href built by hand may not. Matching event hrefs against the canonical form
 * avoids the prefix collision where one calendar href is a prefix of another
 * (collections "cal" and "calendar"): an event under "calendar/" would
 * otherwise match the "cal" collection first.
 */
export function canonicalCalendarHref(href: string): string {
  return href.endsWith('/') ? href : href + '/'
}

export function findCalendarByHref<T extends { href: string }>(
  calendars: T[],
  eventHref: string
): T | undefined {
  return calendars.find((c) => eventHref.startsWith(canonicalCalendarHref(c.href)))
}
