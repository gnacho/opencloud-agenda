// Time-zone support for writing events with a TZID instead of a bare UTC
// instant.
//
// Why this exists: a recurring series serialised as DTSTART in UTC is anchored
// to an absolute instant, so the RRULE (expanded in UTC) drifts by an hour at
// every DST change. "Every Tuesday at 10:00" quietly becomes 09:00. Writing
// DTSTART;TZID=<zone> fixes that, and RFC 5545 asks for a matching VTIMEZONE
// component next to it; a client that cannot resolve the zone falls back to
// floating time (the device zone), which is exactly the drift we are removing.
//
// The VTIMEZONE is derived from Intl at runtime rather than shipped as a table:
// no new dependency, and it follows the tzdata of the browser. When the zone
// follows a stable pattern (last Sunday of March, second Sunday of March, ...)
// a single yearly RRULE is emitted, so the definition does not expire.

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000

/** Years of transitions written when a zone has no stable yearly pattern. */
const YEARS_BACK = 2
const YEARS_FORWARD = 3

export interface ZoneTransition {
  /** Instant of the change, in epoch milliseconds. */
  atUtc: number
  fromOffsetMs: number
  toOffsetMs: number
}

// Mirrors are cheap to keep: the same zone is asked for on every save.
const transitionCache = new Map<string, ZoneTransition[]>()

/** IANA zone of the device, or UTC when it cannot be determined. */
export function userTimeZone(): string {
  let zone: string | undefined
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
  if (!zone) return 'UTC'
  // An unknown zone would make every formatter throw later on.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0)
    return zone
  } catch {
    return 'UTC'
  }
}

/** Offset of `zone` at the given instant, in milliseconds (positive east). */
export function zoneOffsetMs(zone: string, at: number): number {
  const whole = Math.floor(at / 1000) * 1000
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(whole))
  const f: Record<string, string> = {}
  for (const part of parts) f[part.type] = part.value
  const asUtc = Date.UTC(
    Number(f.year), Number(f.month) - 1, Number(f.day),
    Number(f.hour), Number(f.minute), Number(f.second),
  )
  return asUtc - whole
}

/** Wall-clock stamp (YYYYMMDDTHHMMSS) for an already shifted epoch value. */
export function wallClockStamp(shiftedMs: number): string {
  const d = new Date(shiftedMs)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

/** Wall-clock local time in `zone` at `at`, as a compact iCalendar stamp. */
export function localCompact(zone: string, at: number): string {
  return wallClockStamp(at + zoneOffsetMs(zone, at))
}

function formatOffset(ms: number): string {
  const sign = ms < 0 ? '-' : '+'
  const total = Math.abs(Math.round(ms / MINUTE_MS))
  return `${sign}${String(Math.floor(total / 60)).padStart(2, '0')}${String(total % 60).padStart(2, '0')}`
}

// First instant of the month where the offset differs from the one at the start
// of that month, to the minute. Sampled monthly: every tzdata change happens on
// a minute boundary, and no zone changes offset twice in a month.
function transitionInMonth(zone: string, monthStart: number, nextMonthStart: number): ZoneTransition | null {
  const fromOffsetMs = zoneOffsetMs(zone, monthStart)
  if (zoneOffsetMs(zone, nextMonthStart) === fromOffsetMs) return null

  let lo = monthStart
  let hi = nextMonthStart
  while (hi - lo > MINUTE_MS) {
    const mid = Math.floor((lo + (hi - lo) / 2) / MINUTE_MS) * MINUTE_MS
    if (mid <= lo) break
    if (zoneOffsetMs(zone, mid) === fromOffsetMs) lo = mid
    else hi = mid
  }
  return { atUtc: hi, fromOffsetMs, toOffsetMs: zoneOffsetMs(zone, hi) }
}

export function zoneTransitions(zone: string, fromYear: number, toYear: number): ZoneTransition[] {
  const key = `${zone}|${fromYear}|${toYear}`
  const cached = transitionCache.get(key)
  if (cached) return cached

  const out: ZoneTransition[] = []
  let cursor = Date.UTC(fromYear, 0, 1)
  const end = Date.UTC(toYear + 1, 0, 1)
  while (cursor < end) {
    const next = new Date(cursor)
    next.setUTCMonth(next.getUTCMonth() + 1)
    const nextStart = Math.min(next.getTime(), end)
    const t = transitionInMonth(zone, cursor, nextStart)
    if (t) out.push(t)
    cursor = nextStart
  }
  transitionCache.set(key, out)
  return out
}

interface ZoneRule {
  byMonth: number
  byDay: string
  fromOffsetMs: number
  toOffsetMs: number
  /** DTSTART of the component, as a local compact stamp. */
  dtstart: string
  isDaylight: boolean
}

// n-th weekday of the month from the start (1SU) or from the end (-1SU).
function byDayCandidates(atUtc: number, offsetMs: number): string[] {
  const local = new Date(atUtc + offsetMs)
  const day = local.getUTCDate()
  const daysInMonth = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate()
  const weekday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][local.getUTCDay()]
  const fromStart = Math.ceil(day / 7)
  const fromEnd = -Math.ceil((daysInMonth - day + 1) / 7)
  return [...new Set([`${fromStart}${weekday}`, `${fromEnd}${weekday}`])]
}

// One RRULE per (from, to) pair when the pattern repeats identically every year.
// Without this the definition would expire a few years out and the drift would
// come back.
function buildRules(zone: string, transitions: ZoneTransition[]): ZoneRule[] {
  const groups = new Map<string, ZoneTransition[]>()
  for (const t of transitions) {
    const key = `${t.fromOffsetMs}>${t.toOffsetMs}`
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }

  const rules: ZoneRule[] = []
  for (const group of groups.values()) {
    const shape = group.map((t) => {
      const local = new Date(t.atUtc + t.fromOffsetMs)
      return {
        month: local.getUTCMonth() + 1,
        time: local.toISOString().slice(11, 19).replace(/:/g, ''),
        byDays: byDayCandidates(t.atUtc, t.fromOffsetMs),
      }
    })
    const [first] = shape
    // A yearly rule needs the same month, time and weekday slot every year.
    const stable = group.length >= 2 && shape.every((s) =>
      s.month === first.month && s.time === first.time && s.byDays.some((d) => first.byDays.includes(d)))
    const sharedByDay = stable
      ? first.byDays.find((d) => shape.every((s) => s.byDays.includes(d)))
      : undefined

    if (stable && sharedByDay) {
      rules.push({
        byMonth: first.month,
        byDay: sharedByDay,
        fromOffsetMs: group[0].fromOffsetMs,
        toOffsetMs: group[0].toOffsetMs,
        dtstart: wallClockStamp(group[0].atUtc + group[0].fromOffsetMs),
        isDaylight: group[0].toOffsetMs > group[0].fromOffsetMs,
      })
    } else {
      // Irregular zone: spell out the transitions we know about.
      for (const t of group) {
        rules.push({
          byMonth: -1,
          byDay: '',
          fromOffsetMs: t.fromOffsetMs,
          toOffsetMs: t.toOffsetMs,
          dtstart: wallClockStamp(t.atUtc + t.fromOffsetMs),
          isDaylight: t.toOffsetMs > t.fromOffsetMs,
        })
      }
    }
  }
  return rules
}

/** VTIMEZONE component lines for `zone`, or [] when it cannot be built. */
export function buildVTimeZone(zone: string, now: Date = new Date()): string[] {
  if (!zone) return []
  let transitions: ZoneTransition[]
  let offset: number
  try {
    offset = zoneOffsetMs(zone, now.getTime())
    transitions = zoneTransitions(zone, now.getUTCFullYear() - YEARS_BACK, now.getUTCFullYear() + YEARS_FORWARD)
  } catch {
    return []
  }

  const lines: string[] = ['BEGIN:VTIMEZONE', `TZID:${zone}`]

  if (transitions.length === 0) {
    // No DST in the window: a single STANDARD keeps the zone self-contained.
    lines.push(
      'BEGIN:STANDARD',
      `TZOFFSETFROM:${formatOffset(offset)}`,
      `TZOFFSETTO:${formatOffset(offset)}`,
      'DTSTART:19700101T000000',
      'END:STANDARD',
    )
  } else {
    for (const rule of buildRules(zone, transitions)) {
      lines.push(
        `BEGIN:${rule.isDaylight ? 'DAYLIGHT' : 'STANDARD'}`,
        `TZOFFSETFROM:${formatOffset(rule.fromOffsetMs)}`,
        `TZOFFSETTO:${formatOffset(rule.toOffsetMs)}`,
        `DTSTART:${rule.dtstart}`,
      )
      if (rule.byMonth > 0) {
        lines.push(`RRULE:FREQ=YEARLY;BYMONTH=${rule.byMonth};BYDAY=${rule.byDay}`)
      }
      lines.push(`END:${rule.isDaylight ? 'DAYLIGHT' : 'STANDARD'}`)
    }
  }

  lines.push('END:VTIMEZONE')
  return lines
}
