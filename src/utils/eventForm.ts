// Pure conversion and validation of the event dialog date fields.
//
// Extracted from EventDialog.vue so the rules can be tested without mounting
// the component: the empty-input case used to slip through because the dialog
// only compared the two dates, and an Invalid Date compares false against
// everything.

export interface FormDateFields {
  allDay: boolean
  /** YYYY-MM-DD (all-day) */
  startDate: string
  /** YYYY-MM-DD, inclusive as shown in the dialog (all-day) */
  endDate: string
  /** YYYY-MM-DDTHH:mm (timed) */
  startDateTime: string
  /** YYYY-MM-DDTHH:mm (timed) */
  endDateTime: string
}

export interface ParsedFormDates {
  start: Date
  end: Date
}

// English source strings are the i18n keys, so returning the message lets the
// component translate it.
export const INVALID_DATE_MESSAGE = 'Please enter a valid date and time.'
export const END_BEFORE_START_MESSAGE = 'End must be after start.'

export function isValidDate(d: Date): boolean {
  return !Number.isNaN(d.getTime())
}

// Dialog fields → the Date pair the ICS builder expects.
//
// For all-day events DTEND is exclusive (RFC 5545 §3.8.2.2): the dialog shows
// the last day covered, so one day is added back here. The shift is done in
// calendar days, not by adding 24 h in milliseconds, because a local day is
// only 23 h long on the spring-forward date.
export function parseFormDates(form: FormDateFields): ParsedFormDates {
  if (form.allDay) {
    const start = new Date(`${form.startDate}T00:00:00`)
    const end = new Date(`${form.endDate}T00:00:00`)
    end.setDate(end.getDate() + 1)
    return { start, end }
  }
  return {
    start: new Date(form.startDateTime),
    end: new Date(form.endDateTime),
  }
}

// Returns an i18n key when the pair cannot be saved, or null when it is usable.
export function validateFormDates(start: Date, end: Date): string | null {
  if (!isValidDate(start) || !isValidDate(end)) return INVALID_DATE_MESSAGE
  if (end < start) return END_BEFORE_START_MESSAGE
  return null
}
