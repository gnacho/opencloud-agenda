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
  // Repeat / recurrence
  'Repeat': 'Wiederholen',
  'None': 'Keine',
  'Daily': 'Täglich',
  'Weekly': 'Wöchentlich',
  'Monthly': 'Monatlich',
  'Yearly': 'Jährlich',
  'On day': 'Am Tag',
  'On the': 'Am',
  'Never': 'Nie',
  'After': 'Nach',
  'Until': 'Bis',
  'times': 'Mal',
  'Recurring event': 'Wiederkehrender Termin',
  'until': 'bis',
  'Edits apply to the full series.': 'Änderungen gelten für die gesamte Serie.',
  'Refresh': 'Aktualisieren',
  // Ordinals and day abbreviations for recurrence labels
  '1st': '1.', '2nd': '2.', '3rd': '3.', '4th': '4.', 'Last': 'Letzter',
  'Mo': 'Mo', 'Tu': 'Di', 'We': 'Mi', 'Th': 'Do', 'Fr': 'Fr', 'Sa': 'Sa', 'Su': 'So',
  'Mon': 'Mo', 'Tue': 'Di', 'Wed': 'Mi', 'Thu': 'Do', 'Fri': 'Fr', 'Sat': 'Sa', 'Sun': 'So',
  // Validation errors
  'Title is required.': 'Titel ist erforderlich.',
  'End must be after start.': 'Ende muss nach dem Beginn liegen.',
  'Please select a calendar.': 'Bitte einen Kalender auswählen.',
  'Moving recurring events between calendars is not supported.': 'Serien-Termine können nicht zwischen Kalendern verschoben werden.',
  'Delete occurrence': 'Diesen Termin löschen',
  'Delete series': 'Serie löschen',
  // Subscriptions
  'Subscriptions': 'Abonnements',
  'Add Subscription': 'Abonnement hinzufügen',
  'iCal URL (.ics)': 'iCal-URL (.ics)',
  'e.g. Public Holidays': 'z. B. Feiertage',
  'Add': 'Hinzufügen',
  'Please enter a valid URL.': 'Bitte eine gültige URL eingeben.',
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
