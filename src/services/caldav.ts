import ICAL from 'ical.js'
import { PRODID } from '@/constants'
import { buildVTimeZone, localCompact, userTimeZone } from '@/utils/timezone'

export interface CalendarEvent {
  uid: string
  seriesUid?: string // original UID of a recurring series (uid is synthetic for occurrences)
  title: string
  start: Date
  end: Date
  allDay: boolean
  description?: string
  location?: string
  color?: string
  calendarHref: string // full URL of the .ics resource
  etag?: string
  rrule?: string
}

export interface Calendar {
  href: string
  displayName: string
  color?: string
  ctag?: string
}

// ---------- helpers ----------

// Escape XML special characters in element text content.
export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// Escape iCalendar TEXT values per RFC 5545 §3.3.11. A bare CR counts as a
// line break too — some parsers split on it, and a value read from a foreign
// feed can carry one without the LF.
export function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')
}

// Colours come from server data (calendar-color, ICS COLOR, subscriptions.json)
// and end up in style bindings. Only hex values and plain colour names pass —
// anything else (url(...), var(...), expressions) falls back to the default.
export function safeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) || /^[a-z]{3,30}$/i.test(v) ? v : undefined
}

// Re-serialise an RRULE through ical.js so only well-formed rule parts are
// written back; a rule that does not parse (or still carries a line break) is dropped.
export function safeRrule(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const recur = ICAL.Recur.fromString(value)
    if (!recur.freq) return undefined // ical.js turns unparsable input into FREQ=null
    const rule = recur.toString()
    return /[\r\n]/.test(rule) ? undefined : rule
  } catch {
    return undefined
  }
}

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

function getTagText(el: Element, localName: string): string {
  const found = el.getElementsByTagNameNS('*', localName)[0]
    ?? el.querySelector(localName)
  return found?.textContent?.trim() ?? ''
}

// Legacy regex helper (still used for PROPFIND calendar listing)
function xmlText(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<[^>]*:?${tag}[^>]*>([\\s\\S]*?)<\\/[^>]*:?${tag}>`, 'i'))
  return m ? m[1].trim() : ''
}


export function buildIcs(event: Omit<CalendarEvent, 'calendarHref' | 'etag'>): string {
  // DTSTAMP always UTC datetime; date-only format for all-day DTSTART/DTEND
  const fmtUtc = (d: Date) => d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const fmtDate = (d: Date) => {
    // Use local date parts to avoid timezone-shift (YYYY-MM-DD → YYYYMMDD)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}${m}${day}`
  }

  // Timed events are written in the device zone together with a VTIMEZONE.
  // A UTC DTSTART anchors a recurring series to an absolute instant, so the
  // RRULE (expanded in UTC) drifts by an hour at every DST change: "every
  // Tuesday at 10:00" quietly becomes 09:00. UTC itself is kept in the plain
  // Z form, which is unambiguous and has no DST to lose.
  const zone = event.allDay ? '' : userTimeZone()
  const usesZone = zone !== '' && zone !== 'UTC'

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
  ]
  if (usesZone) lines.push(...buildVTimeZone(zone))
  lines.push(
    'BEGIN:VEVENT',
    // UID is a TEXT value (RFC 5545 §3.8.4.7). Escaping keeps a UID read from
    // foreign ICS data — which may contain a line break — from adding properties.
    `UID:${escapeIcs(event.seriesUid ?? event.uid)}`,
    `DTSTAMP:${fmtUtc(new Date())}`,
    event.allDay
      ? `DTSTART;VALUE=DATE:${fmtDate(event.start)}`
      : usesZone
        ? `DTSTART;TZID=${zone}:${localCompact(zone, event.start.getTime())}`
        : `DTSTART:${fmtUtc(event.start)}`,
    event.allDay
      ? `DTEND;VALUE=DATE:${fmtDate(event.end)}`
      : usesZone
        ? `DTEND;TZID=${zone}:${localCompact(zone, event.end.getTime())}`
        : `DTEND:${fmtUtc(event.end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
  )
  if (event.description) lines.push(`DESCRIPTION:${escapeIcs(event.description)}`)
  if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`)
  const color = safeColor(event.color)
  if (color) lines.push(`COLOR:${color}`)
  const rrule = safeRrule(event.rrule)
  if (rrule) lines.push(`RRULE:${rrule}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

// Expansion window for recurring events (years back and forward from now)
const EXPAND_YEARS = 2

// Limits for recurrence expansion. One ical.js iterator step costs roughly
// 5–10 µs, so the per-event cap alone still let a feed with many
// FREQ=MINUTELY events from 1900 freeze the tab for minutes. The budget is
// shared across everything parsed for one feed or one calendar fetch.
const MAX_STEPS_PER_EVENT = 50_000
const MAX_OCCURRENCES_PER_EVENT = 500

export interface ExpansionBudget {
  steps: number   // recurrence iterator steps left
  results: number // events/occurrences left to return
}

export function newExpansionBudget(): ExpansionBudget {
  return { steps: 100_000, results: 20_000 }
}

export function parseEvents(
  icsText: string,
  calendarHref: string,
  etag?: string,
  budget: ExpansionBudget = newExpansionBudget(),
): CalendarEvent[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let jcal: any
  try {
    jcal = ICAL.parse(icsText)
  } catch {
    return []
  }

  const comp = new ICAL.Component(jcal)
  const vevents = comp.getAllSubcomponents('vevent')
  const results: CalendarEvent[] = []

  for (const vevent of vevents) {
    if (budget.results <= 0) break
    try {
      // A VEVENT carrying RECURRENCE-ID is an exception of a series, not an
      // event of its own: the series iterator applies it (ical.js relates the
      // exceptions of a component automatically). Rendering it here as well
      // would show the same occurrence twice, once with the master's fields.
      if (vevent.getFirstPropertyValue('recurrence-id')) continue
      const ev = new ICAL.Event(vevent)
      const color = safeColor(vevent.getFirstPropertyValue('color'))

      if (ev.isRecurring()) {
        const now = Date.now()
        const rangeStart = ICAL.Time.fromJSDate(
          new Date(now - EXPAND_YEARS * 365 * 24 * 3600 * 1000),
          true,
        )
        const rangeEnd = ICAL.Time.fromJSDate(
          new Date(now + EXPAND_YEARS * 365 * 24 * 3600 * 1000),
          true,
        )
        const rruleStr = vevent.getFirstProperty('rrule')?.getFirstValue()?.toString() ?? undefined
        const iterator = ev.iterator()
        let next: ICAL.Time | null
        let inRange = 0
        let total = 0
        while (total < MAX_STEPS_PER_EVENT && budget.steps > 0 && (next = iterator.next())) {
          total++
          budget.steps--
          if (next.compare(rangeEnd) > 0) break
          if (next.compare(rangeStart) < 0) continue
          if (inRange++ >= MAX_OCCURRENCES_PER_EVENT || budget.results <= 0) break
          budget.results--
          const occurrence = ev.getOccurrenceDetails(next)
          const allDay = occurrence.startDate.isDate
          // An edited occurrence keeps its own SUMMARY, DESCRIPTION and
          // LOCATION, so read them from the occurrence details rather than
          // from the series master.
          const item = occurrence.item ?? ev
          results.push({
            uid: `${ev.uid}_${next.toUnixTime()}`,
            seriesUid: ev.uid,
            title: item.summary || '(no title)',
            start: occurrence.startDate.toJSDate(),
            end: occurrence.endDate.toJSDate(),
            allDay,
            description: item.description || undefined,
            location: item.location || undefined,
            color: safeColor(item.component.getFirstPropertyValue('color')) ?? color,
            rrule: rruleStr,
            calendarHref,
            etag,
          })
        }
      } else {
        const dtstart = ev.startDate
        const dtend = ev.endDate
        const allDay = dtstart.isDate
        budget.results--
        results.push({
          uid: ev.uid,
          title: ev.summary || '(no title)',
          start: dtstart.toJSDate(),
          end: dtend.toJSDate(),
          allDay,
          description: ev.description || undefined,
          location: ev.location || undefined,
          color,
          rrule: vevent.getFirstProperty('rrule')?.getFirstValue()?.toString(),
          calendarHref,
          etag,
        })
      }
    } catch {
      // skip malformed events
    }
  }

  return results
}

// ---------- CalDAV client ----------

// URL of a new event resource inside a calendar collection. The name is
// percent-encoded so it always stays a single path segment of the collection.
export function newEventHref(calendarHref: string, name: string): string {
  return `${calendarHref.replace(/\/$/, '')}/${encodeURIComponent(name)}.ics`
}

// Resolve an href from a multistatus response against `base` and accept it
// only if it lies inside `scope` (same origin, path below the scope path).
// A server or intermediary must not be able to point later requests — which
// carry the Basic app token — at another host or an unrelated path.
export function resolveHref(href: string, base: string, scope: string): string | null {
  let url: URL
  try {
    url = new URL(href, base)
  } catch {
    return null
  }
  const scopeUrl = new URL(scope)
  if (url.origin !== scopeUrl.origin) return null
  if (!url.pathname.startsWith(scopeUrl.pathname)) return null
  // the URL parser has already collapsed dot segments; reject encoded ones it leaves alone
  if (/%2e%2e|%2f/i.test(url.pathname)) return null
  url.hash = ''
  return url.href
}

export class CalDavClient {
  private baseUrl: string
  private origin: string
  private authHeader: string

  constructor(serverUrl: string, pathId: string, authUsername: string, appToken: string) {
    this.baseUrl = `${serverUrl.replace(/\/$/, '')}/caldav/${encodeURIComponent(pathId)}/`
    this.origin = new URL(this.baseUrl).origin
    this.authHeader = `Basic ${btoa(`${authUsername}:${appToken}`)}`
  }

  private async request(
    method: string,
    url: string,
    body?: string,
    extraHeaders: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      ...extraHeaders,
    }
    if (body && !headers['Content-Type']) headers['Content-Type'] = 'text/calendar; charset=utf-8'

    // Last line of defence: the app token never leaves the OpenCloud origin.
    if (new URL(url, this.baseUrl).origin !== this.origin) {
      throw new Error(`CalDAV ${method} refused: ${url} is outside ${this.origin}`)
    }

    const res = await fetch(url, { method, headers, body, signal })
    if (!res.ok && res.status !== 207) {
      throw new Error(`CalDAV ${method} ${url} → ${res.status} ${res.statusText}`)
    }
    return res
  }

  // PROPFIND: discover calendars
  async listCalendars(signal?: AbortSignal): Promise<Calendar[]> {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:oc="http://owncloud.org/ns">
  <prop>
    <resourcetype/>
    <displayname/>
    <cs:getctag/>
    <oc:calendar-color/>
    <c:supported-calendar-component-set/>
  </prop>
</propfind>`

    const res = await this.request('PROPFIND', this.baseUrl, body, {
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '1',
    }, signal)

    const xml = await res.text()
    const calendars: Calendar[] = []

    // parse <response> blocks
    const responseBlocks = xml.match(/<[^>]*:?response[^>]*>[\s\S]*?<\/[^>]*:?response>/gi) || []
    for (const block of responseBlocks) {
      const rawHref = xmlText(block, 'href')
      const href = rawHref && resolveHref(rawHref, this.baseUrl, this.baseUrl)
      if (!href || href === this.baseUrl) continue

      // only include proper CalDAV calendar collections (resourcetype contains "calendar")
      if (!block.match(/<[^>]*:?calendar\s*\/>/i)) continue

      const displayName = xmlText(block, 'displayname') || new URL(href).pathname.split('/').filter(Boolean).pop() || 'Calendar'
      const color = safeColor(xmlText(block, 'calendar-color'))
      const ctag = xmlText(block, 'getctag') || undefined

      calendars.push({ href, displayName, color, ctag })
    }

    return calendars
  }

  // REPORT: fetch all events (no server-side time filter — more reliable with Radicale)
  async fetchEvents(calendarHref: string, _from: Date, _to: Date, signal?: AbortSignal): Promise<CalendarEvent[]> {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<calendar-query xmlns="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:">
  <d:prop>
    <d:getetag/>
    <calendar-data/>
  </d:prop>
  <filter>
    <comp-filter name="VCALENDAR">
      <comp-filter name="VEVENT"/>
    </comp-filter>
  </filter>
</calendar-query>`

    const res = await this.request('REPORT', calendarHref, body, {
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '1',
    }, signal)

    const xml = await res.text()
    const doc = parseXml(xml)
    const responses = Array.from(doc.getElementsByTagNameNS('DAV:', 'response'))
    const events: CalendarEvent[] = []
    const budget = newExpansionBudget()
    const scope = calendarHref.endsWith('/') ? calendarHref : `${calendarHref}/`

    for (const response of responses) {
      const rawHref = getTagText(response, 'href')
      const href = rawHref && resolveHref(rawHref, calendarHref, scope)
      if (!href || !href.endsWith('.ics')) continue

      const etag = getTagText(response, 'getetag').replace(/"/g, '')
      const icsData = getTagText(response, 'calendar-data')
      if (!icsData) continue

      const parsed = parseEvents(icsData, href, etag, budget)
      events.push(...parsed)
    }

    return events
  }

  // PUT: create or update an event; returns the new etag from the server.
  // No If-Match on PUT — Radicale ETag formats can differ between REPORT and PUT,
  // causing spurious 412s. If-Match is still used on DELETE where it matters most.
  async saveEvent(event: CalendarEvent): Promise<string | undefined> {
    const ics = buildIcs(event)
    const res = await this.request('PUT', event.calendarHref, ics)
    return res.headers.get('ETag')?.replace(/"/g, '') ?? undefined
  }

  // MKCALENDAR: create a new calendar collection
  async createCalendar(name: string, color: string): Promise<Calendar> {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'calendar'
    const href = `${this.baseUrl}${slug}/`
    const body = `<?xml version="1.0" encoding="utf-8"?>
<mkcalendar xmlns="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:set>
    <d:prop>
      <d:displayname>${escapeXml(name.trim())}</d:displayname>
      <oc:calendar-color>${escapeXml(color)}</oc:calendar-color>
    </d:prop>
  </d:set>
</mkcalendar>`
    await this.request('MKCALENDAR', href, body, { 'Content-Type': 'application/xml; charset=utf-8' })
    return { href, displayName: name.trim(), color }
  }

  // GET + patch fields + PUT back — preserves properties we don't explicitly overwrite.
  // Used when editing a recurring event series.
  async patchRecurringEvent(
    href: string,
    fields: {
      title: string
      description?: string
      location?: string
      start?: Date
      end?: Date
      allDay?: boolean
      rrule?: string
    },
  ): Promise<string | undefined> {
    const getRes = await this.request('GET', href)
    const icsText = await getRes.text()

    let jcal: unknown
    try {
      jcal = ICAL.parse(icsText)
    } catch {
      throw new Error('Failed to parse existing calendar data')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comp = new ICAL.Component(jcal as any)
    const vevent = comp.getFirstSubcomponent('vevent')
    if (!vevent) throw new Error('No VEVENT found in calendar data')

    vevent.updatePropertyWithValue('summary', fields.title)
    vevent.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true))

    if (fields.description) {
      vevent.updatePropertyWithValue('description', fields.description)
    } else {
      vevent.removeProperty('description')
    }
    if (fields.location) {
      vevent.updatePropertyWithValue('location', fields.location)
    } else {
      vevent.removeProperty('location')
    }

    if (fields.start !== undefined && fields.end !== undefined) {
      if (fields.allDay) {
        const fmtDate = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        vevent.updatePropertyWithValue('dtstart', ICAL.Time.fromDateString(fmtDate(fields.start)))
        vevent.updatePropertyWithValue('dtend', ICAL.Time.fromDateString(fmtDate(fields.end)))
      } else {
        vevent.updatePropertyWithValue('dtstart', ICAL.Time.fromJSDate(fields.start, true))
        vevent.updatePropertyWithValue('dtend', ICAL.Time.fromJSDate(fields.end, true))
      }
    }

    if (fields.rrule) {
      vevent.updatePropertyWithValue('rrule', ICAL.Recur.fromString(fields.rrule))
    } else if (fields.rrule === '') {
      vevent.removeProperty('rrule')
    }
    // fields.rrule === undefined → leave RRULE unchanged

    const modifiedIcs = comp.toString()
    const putRes = await this.request('PUT', href, modifiedIcs)
    return putRes.headers.get('ETag')?.replace(/"/g, '') ?? undefined
  }

  // PROPPATCH: rename a calendar collection
  async renameCalendar(href: string, newName: string): Promise<void> {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propertyupdate xmlns:d="DAV:">
  <d:set>
    <d:prop>
      <d:displayname>${escapeXml(newName.trim())}</d:displayname>
    </d:prop>
  </d:set>
</d:propertyupdate>`
    await this.request('PROPPATCH', href, body, { 'Content-Type': 'application/xml; charset=utf-8' })
  }

  // Build URL for a new event in a given calendar
  newEventHref(calendarHref: string, uid: string): string {
    return newEventHref(calendarHref, uid)
  }

  // DELETE: remove an event (or entire recurring series)
  async deleteEvent(event: CalendarEvent): Promise<void> {
    const headers: Record<string, string> = {}
    if (event.etag) headers['If-Match'] = `"${event.etag}"`
    await this.request('DELETE', event.calendarHref, undefined, headers)
  }

  // Add EXDATE to master ICS to exclude a single occurrence without touching the rest of the series.
  async deleteOccurrence(href: string, occurrenceStart: Date, allDay: boolean): Promise<void> {
    const getRes = await this.request('GET', href)
    const icsText = await getRes.text()

    let jcal: unknown
    try {
      jcal = ICAL.parse(icsText)
    } catch {
      throw new Error('Failed to parse existing calendar data')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comp = new ICAL.Component(jcal as any)
    const vevent = comp.getFirstSubcomponent('vevent')
    if (!vevent) throw new Error('No VEVENT found in calendar data')

    let exdate: ICAL.Time
    if (allDay) {
      const y = occurrenceStart.getFullYear()
      const m = String(occurrenceStart.getMonth() + 1).padStart(2, '0')
      const d = String(occurrenceStart.getDate()).padStart(2, '0')
      exdate = ICAL.Time.fromDateString(`${y}-${m}-${d}`)
    } else {
      exdate = ICAL.Time.fromJSDate(occurrenceStart, true)
    }

    vevent.addPropertyWithValue('exdate', exdate)

    const modifiedIcs = comp.toString()
    await this.request('PUT', href, modifiedIcs)
  }
}
