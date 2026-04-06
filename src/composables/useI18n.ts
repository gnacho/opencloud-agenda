/**
 * Simple DE/EN translation composable.
 * Reads the language from the HTML element set by OpenCloud.
 * English strings are the keys; German strings are the values.
 */

const translations: Record<string, string> = {
  // CalendarView
  'Agenda': 'Termine',
  '+ New': '+ Neu',
  'Loading…': 'Laden…',
  // FullCalendar header buttons (passed as buttonText)
  'month': 'Monat',
  'week': 'Woche',
  'day': 'Tag',
  'list': 'Liste',
  'today': 'Heute',
  // EventDialog
  'New Event': 'Neuer Termin',
  'Edit Event': 'Termin bearbeiten',
  'Title': 'Titel',
  'Event title': 'Titel des Termins',
  'All day': 'Ganztägig',
  'Start': 'Beginn',
  'End': 'Ende',
  'Location': 'Ort',
  'Description': 'Beschreibung',
  'Calendar': 'Kalender',
  'Delete': 'Löschen',
  'Cancel': 'Abbrechen',
  'Save': 'Speichern',
  // CalendarDialog
  'New Calendar': 'Neuer Kalender',
  'Calendar Name': 'Kalendername',
  'Calendar name': 'Kalendername',
  'Color': 'Farbe',
  'Create': 'Erstellen',
  'Calendars': 'Kalender',
  'Calendar already exists.': 'Kalender existiert bereits.',
  // Validation errors
  'Title is required.': 'Titel ist erforderlich.',
  'End must be after start.': 'Ende muss nach dem Beginn liegen.',
  'Please select a calendar.': 'Bitte einen Kalender auswählen.',
}

function isGerman(): boolean {
  const lang = document.documentElement.lang || navigator.language || ''
  return lang.toLowerCase().startsWith('de')
}

export function useI18n() {
  function t(key: string): string {
    if (isGerman() && translations[key]) return translations[key]
    return key
  }

  return { t }
}
