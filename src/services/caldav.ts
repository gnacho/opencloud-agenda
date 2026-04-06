import ICAL from 'ical.js'

export interface CalendarEvent {
  uid: string
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


function buildIcs(event: Omit<CalendarEvent, 'calendarHref' | 'etag'>): string {
  const fmt = (d: Date) =>
    event.allDay
      ? d.toISOString().slice(0, 10).replace(/-/g, '')
      : d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//opencloud-agenda//EN',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    event.allDay ? `DTSTART;VALUE=DATE:${fmt(event.start)}` : `DTSTART:${fmt(event.start)}`,
    event.allDay ? `DTEND;VALUE=DATE:${fmt(event.end)}` : `DTEND:${fmt(event.end)}`,
    `SUMMARY:${event.title}`,
  ]
  if (event.description) lines.push(`DESCRIPTION:${event.description.replace(/\n/g, '\\n')}`)
  if (event.location) lines.push(`LOCATION:${event.location}`)
  if (event.color) lines.push(`COLOR:${event.color}`)
  if (event.rrule) lines.push(`RRULE:${event.rrule}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}

// Expansion window for recurring events (years back and forward from now)
const EXPAND_YEARS = 2

function parseEvents(icsText: string, calendarHref: string, etag?: string): CalendarEvent[] {
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
    try {
      const ev = new ICAL.Event(vevent)
      const color = vevent.getFirstPropertyValue('color') as string | undefined

      if (ev.isRecurring()) {
        const now = Date.now()
        const rangeStart = ICAL.Time.fromJSDate(
          new Date(now - EXPAND_YEARS * 365 * 24 * 3600 * 1000),
          false,
        )
        const rangeEnd = ICAL.Time.fromJSDate(
          new Date(now + EXPAND_YEARS * 365 * 24 * 3600 * 1000),
          false,
        )
        const iterator = ev.iterator()
        let next: ICAL.Time | null
        let count = 0
        while ((next = iterator.next()) && count < 500) {
          if (next.compare(rangeEnd) > 0) break
          if (next.compare(rangeStart) < 0) continue
          const occurrence = ev.getOccurrenceDetails(next)
          const allDay = occurrence.startDate.isDate
          results.push({
            uid: `${ev.uid}_${next.toUnixTime()}`,
            title: ev.summary || '(no title)',
            start: occurrence.startDate.toJSDate(),
            end: occurrence.endDate.toJSDate(),
            allDay,
            description: ev.description || undefined,
            location: ev.location || undefined,
            color,
            calendarHref,
            etag,
          })
          count++
        }
      } else {
        const dtstart = ev.startDate
        const dtend = ev.endDate
        const allDay = dtstart.isDate
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

export class CalDavClient {
  private baseUrl: string
  private authHeader: string

  constructor(serverUrl: string, pathId: string, authUsername: string, appToken: string) {
    this.baseUrl = `${serverUrl.replace(/\/$/, '')}/caldav/${encodeURIComponent(pathId)}/`
    this.authHeader = `Basic ${btoa(`${authUsername}:${appToken}`)}`
  }

  private async request(
    method: string,
    url: string,
    body?: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      ...extraHeaders,
    }
    if (body) headers['Content-Type'] = 'text/calendar; charset=utf-8'

    const res = await fetch(url, { method, headers, body })
    if (!res.ok && res.status !== 207) {
      throw new Error(`CalDAV ${method} ${url} → ${res.status} ${res.statusText}`)
    }
    return res
  }

  // PROPFIND: discover calendars
  async listCalendars(): Promise<Calendar[]> {
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
    })

    const xml = await res.text()
    const calendars: Calendar[] = []

    // parse <response> blocks
    const responseBlocks = xml.match(/<[^>]*:?response[^>]*>[\s\S]*?<\/[^>]*:?response>/gi) || []
    for (const block of responseBlocks) {
      const href = xmlText(block, 'href')
      if (!href || href === new URL(this.baseUrl).pathname) continue

      // only include proper CalDAV calendar collections (resourcetype contains "calendar")
      if (!block.match(/<[^>]*:?calendar\s*\/>/i)) continue

      const displayName = xmlText(block, 'displayname') || href.split('/').filter(Boolean).pop() || 'Calendar'
      const color = xmlText(block, 'calendar-color') || undefined
      const ctag = xmlText(block, 'getctag') || undefined

      const fullHref = href.startsWith('http') ? href : `${new URL(this.baseUrl).origin}${href}`
      calendars.push({ href: fullHref, displayName, color, ctag })
    }

    return calendars
  }

  // REPORT: fetch all events (no server-side time filter — more reliable with Radicale)
  async fetchEvents(calendarHref: string, _from: Date, _to: Date): Promise<CalendarEvent[]> {
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
    })

    const xml = await res.text()
    const doc = parseXml(xml)
    const responses = Array.from(doc.getElementsByTagNameNS('DAV:', 'response'))
    const events: CalendarEvent[] = []

    for (const response of responses) {
      const href = getTagText(response, 'href')
      if (!href || !href.endsWith('.ics')) continue

      const etag = getTagText(response, 'getetag').replace(/"/g, '')
      const icsData = getTagText(response, 'calendar-data')
      if (!icsData) continue

      const fullHref = href.startsWith('http') ? href : `${new URL(calendarHref).origin}${href}`
      const parsed = parseEvents(icsData, fullHref, etag)
      events.push(...parsed)
    }

    return events
  }

  // PUT: create or update an event
  async saveEvent(event: CalendarEvent): Promise<void> {
    const ics = buildIcs(event)
    const headers: Record<string, string> = {}
    if (event.etag) headers['If-Match'] = `"${event.etag}"`

    await this.request('PUT', event.calendarHref, ics, headers)
  }

  // Build URL for a new event in a given calendar
  newEventHref(calendarHref: string, uid: string): string {
    return `${calendarHref.replace(/\/$/, '')}/${uid}.ics`
  }

  // DELETE: remove an event
  async deleteEvent(event: CalendarEvent): Promise<void> {
    const headers: Record<string, string> = {}
    if (event.etag) headers['If-Match'] = `"${event.etag}"`
    await this.request('DELETE', event.calendarHref, undefined, headers)
  }
}
