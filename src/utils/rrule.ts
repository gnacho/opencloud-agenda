export type RepeatFreq = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
export type RepeatEnd = 'NEVER' | 'COUNT' | 'UNTIL'
export type MonthlyType = 'DAYOFMONTH' | 'NTHWEEKDAY'

export const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

export interface ParsedRrule {
  freq: RepeatFreq
  interval: number // 1 = every occurrence, 2 = every 2nd, …
  days: string[]
  monthlyType: MonthlyType
  monthlyByday: string
  endType: RepeatEnd
  count: number
  until: string // YYYY-MM-DD or ''
}

export function getNthWeekday(date: Date): string {
  const day = DAY_NAMES[date.getDay()]
  const n = Math.ceil(date.getDate() / 7) // 1–4
  return `${n}${day}`
}

export function parseRrule(rrule: string): ParsedRrule {
  const freq = (rrule.match(/FREQ=(\w+)/)?.[1] ?? 'NONE') as RepeatFreq
  const interval = rrule.match(/INTERVAL=(\d+)/)?.[1]
  const bydayRaw = rrule.match(/BYDAY=([^;]+)/)?.[1] ?? ''
  const isNthWeekday = freq === 'MONTHLY' && /^-?\d+[A-Z]{2}$/.test(bydayRaw)
  const days = !isNthWeekday && bydayRaw ? bydayRaw.split(',') : []
  const count = rrule.match(/COUNT=(\d+)/)?.[1]
  const until = rrule.match(/UNTIL=(\d{8})/)?.[1]
  return {
    freq,
    interval: interval ? Math.max(1, parseInt(interval)) : 1,
    days,
    monthlyType: isNthWeekday ? 'NTHWEEKDAY' : 'DAYOFMONTH',
    monthlyByday: isNthWeekday ? bydayRaw : '',
    endType: count ? 'COUNT' : until ? 'UNTIL' : 'NEVER',
    count: count ? parseInt(count) : 10,
    until: until ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}` : '',
  }
}

export interface BuildRruleParams {
  freq: RepeatFreq
  interval?: number // omitted or 1 = every occurrence
  days: string[]
  monthlyType: MonthlyType
  monthlyByday: string // preserved BYDAY for NTHWEEKDAY (e.g. '-1MO', '2TU'); '' means derive from startDate
  endType: RepeatEnd
  count: number
  until: string // YYYY-MM-DD or ''
  startDate: Date
  allDay?: boolean
}

export function buildRrule(params: BuildRruleParams): string | undefined {
  if (params.freq === 'NONE') return undefined
  let rule = `FREQ=${params.freq}`
  if ((params.interval ?? 1) > 1) {
    rule += `;INTERVAL=${Math.floor(params.interval!)}`
  }
  if (params.freq === 'WEEKLY') {
    const days = params.days.length ? params.days : [DAY_NAMES[params.startDate.getDay()]]
    rule += `;BYDAY=${days.join(',')}`
  }
  if (params.freq === 'MONTHLY' && params.monthlyType === 'NTHWEEKDAY') {
    rule += `;BYDAY=${params.monthlyByday || getNthWeekday(params.startDate)}`
  }
  if (params.endType === 'COUNT' && params.count > 0) {
    rule += `;COUNT=${params.count}`
  } else if (params.endType === 'UNTIL' && params.until) {
    rule += `;UNTIL=${buildUntil(params.until, params.allDay ?? false)}`
  }
  return rule
}

/**
 * RFC 5545 requires UNTIL to have the same value type as DTSTART: a DATE for
 * all-day events, a UTC timestamp for timed ones.
 *
 * Timed: end the series at local midnight of the day after the selected date,
 * minus one second, converted to UTC. Writing T235959Z instead used to end the
 * series after local midnight for positive offsets, so a daily 01:00 series
 * "until 20 October" also showed 21 October. The Date constructor is used with
 * wall-time components on purpose: adding milliseconds would drift one hour
 * across a DST transition.
 */
function buildUntil(until: string, allDay: boolean): string {
  const day = until.replace(/-/g, '')
  if (allDay) return day
  const [y, m, d] = until.split('-').map(Number)
  const end = new Date(y, m - 1, d + 1, 0, 0, 0)
  end.setTime(end.getTime() - 1000)
  return end.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}
