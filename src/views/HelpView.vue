<template>
  <div class="help-view">
    <div class="help-content">
      <h1>{{ de ? 'Hilfe – Termine' : 'Help – Agenda' }}</h1>

      <section>
        <h2>{{ de ? 'Termine erstellen' : 'Creating events' }}</h2>
        <ul>
          <li v-if="de">Klick auf einen Tag → Neuer Termin für diesen Tag (ganztägig)</li>
          <li v-else>Click on a day → new all-day event for that day</li>
          <li v-if="de">Klick &amp; Ziehen über mehrere Tage → Mehrtägiger Termin</li>
          <li v-else>Click &amp; drag across days → multi-day event</li>
          <li v-if="de">In der Wochen-/Tagesansicht: Klick auf eine Uhrzeit → Termin mit Startzeit</li>
          <li v-else>In week/day view: click a time slot → timed event at that hour</li>
          <li v-if="de">„+ Neu"-Button oben links → Termin ohne Vorgabe erstellen</li>
          <li v-else>"+ New" button top left → create event without preselection</li>
        </ul>
      </section>

      <section>
        <h2>{{ de ? 'Termine bearbeiten' : 'Editing events' }}</h2>
        <ul>
          <li v-if="de">Klick auf einen Termin → Dialog zum Bearbeiten oder Löschen</li>
          <li v-else>Click an event → dialog to edit or delete</li>
          <li v-if="de">Termin ziehen → verschiebt den Termin (Datum/Uhrzeit)</li>
          <li v-else>Drag an event → move it to a new date/time</li>
          <li v-if="de">Mehrtägige Termine haben an beiden Enden einen weißen Anfasser zum Vergrößern/Verkleinern</li>
          <li v-else>Multi-day events have white handles at both edges to extend or shorten them</li>
          <li v-if="de">In der Wochen-/Tagesansicht: unterer Rand eines Termins ziehen → Dauer ändern</li>
          <li v-else>In week/day view: drag the bottom edge of a timed event → change duration</li>
        </ul>
      </section>

      <section>
        <h2>{{ de ? 'Kalender verwalten' : 'Managing calendars' }}</h2>
        <ul>
          <li v-if="de">Haken in der Sidebar → Kalender ein-/ausblenden</li>
          <li v-else>Checkbox in the sidebar → show/hide a calendar</li>
          <li v-if="de">Klick auf einen Kalendernamen → wählt ihn als Standard für neue Termine</li>
          <li v-else>Click a calendar name → sets it as default for new events</li>
          <li v-if="de">„+"-Button neben „Kalender" → neuen Kalender anlegen (Name + Farbe)</li>
          <li v-else>"+" button next to "Calendars" → create a new calendar (name + color)</li>
        </ul>
      </section>

      <section>
        <h2>{{ de ? 'Ansichten' : 'Views' }}</h2>
        <ul>
          <li v-if="de"><strong>Monat</strong> – Übersicht des gesamten Monats</li>
          <li v-else><strong>Month</strong> – overview of the full month</li>
          <li v-if="de"><strong>Woche</strong> – Stundengenaue Wochenansicht mit Zeitraster</li>
          <li v-else><strong>Week</strong> – hourly week view with time grid</li>
          <li v-if="de"><strong>Tag</strong> – Detailansicht eines einzelnen Tages</li>
          <li v-else><strong>Day</strong> – detailed view of a single day</li>
          <li v-if="de"><strong>Liste</strong> – Alle kommenden Termine als Liste</li>
          <li v-else><strong>List</strong> – all upcoming events as a list</li>
        </ul>
      </section>

      <section>
        <h2>{{ de ? 'Hinweise' : 'Notes' }}</h2>
        <ul>
          <li v-if="de">Wiederkehrende Termine werden lokal expandiert (±2 Jahre). Beim Verschieben oder Ändern wird die <em>gesamte Serie</em> aktualisiert.</li>
          <li v-else>Recurring events are expanded locally (±2 years). Moving or editing updates the <em>entire series</em>.</li>
          <li v-if="de">Ganztägige Termine: das Enddatum im Dialog ist <em>inklusive</em> — „Ende: 21.04" heißt der Termin läuft bis einschließlich 21.04.</li>
          <li v-else>All-day events: the end date in the dialog is <em>inclusive</em> — "End: Apr 21" means the event runs through Apr 21.</li>
          <li v-if="de">Daten werden direkt im CalDAV-Server (Radicale) gespeichert und sind sofort in anderen Clients (Thunderbird, Smartphone) sichtbar.</li>
          <li v-else>Data is stored directly on the CalDAV server (Radicale) and immediately visible in other clients (Thunderbird, phone).</li>
        </ul>
      </section>

      <div class="version">Agenda v{{ version }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
const de = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('de')
const version = '1.0.0'
</script>

<style scoped>
.help-view {
  height: 100%;
  overflow-y: auto;
  padding: 2rem;
  background: var(--oc-color-background-default);
  color: var(--oc-color-text-default);
}

.help-content {
  max-width: 680px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

h1 {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
  color: var(--oc-color-text-default);
}

h2 {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 0.5rem 0;
  color: var(--oc-color-swatch-brand-default, #0082c9);
}

section {
  display: flex;
  flex-direction: column;
}

ul {
  margin: 0;
  padding-left: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

li {
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--oc-color-text-default);
}

.version {
  font-size: 0.75rem;
  color: var(--oc-color-text-muted);
  margin-top: 1rem;
  text-align: right;
}
</style>
