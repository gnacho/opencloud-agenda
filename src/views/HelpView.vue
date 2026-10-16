<template>
  <div class="help-overlay" @click.self="$emit('close')">
  <div class="help-view">
    <button class="close-btn" @click="$emit('close')">×</button>
    <div class="help-content">
      <h1>{{ t('Help - Agenda') }}</h1>

      <section>
        <h2>{{ t('Creating events') }}</h2>
        <ul>
          <li>{{ t('Click on a day → new all-day event for that day') }}</li>
          <li>{{ t('Click & drag across days → multi-day event') }}</li>
          <li>{{ t('In week/day view: click a time slot → timed event at that hour') }}</li>
          <li>{{ t('Button "+ New" top left → create event without preselection') }}</li>
          <li>{{ t('Use "Repeat" in the dialog to set a recurrence rule (daily, weekly, monthly, yearly)') }}</li>
        </ul>
      </section>

      <section>
        <h2>{{ t('Editing events') }}</h2>
        <ul>
          <li>{{ t('Click an event → dialog to edit or delete') }}</li>
          <li>{{ t('Drag an event → move it to a new date/time') }}</li>
          <li>{{ t('Multi-day events have white handles at both edges to extend or shorten them') }}</li>
          <li>{{ t('In week/day view: drag the bottom edge of a timed event → change duration') }}</li>
          <li>{{ t('Change the calendar in the dropdown → moves the event to a different calendar') }}</li>
        </ul>
      </section>

      <section>
        <h2>{{ t('Recurring events') }}</h2>
        <ul>
          <li>{{ t('Recurring events are marked with ↻ in the calendar') }}</li>
          <li>{{ t('Repeat options: daily · weekly (choose weekdays) · monthly (on day X or the Nth weekday) · yearly') }}</li>
          <li>{{ t('Use "Every N …" to set an interval, e.g. every 2 weeks (biweekly)') }}</li>
          <li>{{ t('Series end: never · after N occurrences · until a date') }}</li>
          <li>{{ t('Editing or moving a recurring event always updates the entire series') }}</li>
          <li>{{ t('Events from Thunderbird or other CalDAV clients are correctly shown as a series and can be edited here') }}</li>
        </ul>
      </section>

      <section>
        <h2>{{ t('Managing calendars') }}</h2>
        <ul>
          <li>{{ t('Checkbox in the sidebar → show/hide a calendar') }}</li>
          <li>{{ t('Click a calendar name → sets it as default for new events') }}</li>
          <li>{{ t('Double-click a calendar name → rename it') }}</li>
          <li>{{ t('Button "+" next to "Calendars" → create a new calendar (name + color)') }}</li>
          <li>{{ t('↻ button in the sidebar → manually refresh data from the server (e.g. after syncing with Thunderbird)') }}</li>
        </ul>
      </section>

      <section>
        <h2>{{ t('Views') }}</h2>
        <ul>
          <li><strong>{{ t('Month') }}</strong> - {{ t('overview of the full month') }}</li>
          <li><strong>{{ t('Week') }}</strong> - {{ t('hourly week view with time grid') }}</li>
          <li><strong>{{ t('Day') }}</strong> - {{ t('detailed view of a single day') }}</li>
          <li><strong>{{ t('List') }}</strong> - {{ t('all upcoming events as a list') }}</li>
        </ul>
      </section>

      <section>
        <h2>{{ t('Subscriptions (external calendars)') }}</h2>
        <ul>
          <li>{{ t('Button "+" next to "Subscriptions" → add an external iCal URL (.ics) as a read-only calendar') }}</li>
          <li>{{ t('Choose name, URL and color freely (e.g. public holidays, team calendars)') }}</li>
          <li>{{ t('Checkbox → show/hide subscription; × on hover → remove subscription') }}</li>
          <li>{{ t('Subscribed events are read-only - no dialog on click, no drag and drop') }}</li>
          <li>{{ t('↻ button reloads all subscriptions') }}</li>
        </ul>
      </section>

      <section>
        <h2>{{ t('Notes') }}</h2>
        <ul>
          <li>{{ t('All-day events: the end date in the dialog is inclusive - "End: Apr 21" means the event runs through Apr 21.') }}</li>
          <li>{{ t('Data is stored directly on the CalDAV server (Radicale) and immediately visible in other clients (Thunderbird, phone).') }}</li>
          <li>{{ t('Moving recurring events between calendars is not supported.') }}</li>
        </ul>
      </section>

      <footer class="help-footer">
        © 2026 <a href="https://www.linux-nerds.org" target="_blank" rel="noopener">linux-nerds.org</a> · {{ t('Agenda') }} v{{ version }}
      </footer>
    </div>
  </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '@/composables/useI18n'

defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()

declare const __APP_VERSION__: string
const version = __APP_VERSION__
</script>

<style scoped>
.help-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.help-view {
  position: relative;
  width: 680px;
  max-width: 95vw;
  max-height: 85vh;
  overflow-y: auto;
  padding: 2rem;
  border-radius: 8px;
  background: var(--oc-role-surface, #fff);
  color: var(--oc-role-on-surface, #1a1a1a);
  box-shadow: 0 4px 32px rgba(0, 0, 0, 0.35);
}

.close-btn {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  background: none;
  border: none;
  font-size: 1.4rem;
  cursor: pointer;
  color: var(--oc-role-on-surface-variant, #888);
  line-height: 1;
  padding: 0.2rem 0.4rem;
}

.close-btn:hover { color: var(--oc-role-on-surface, #1a1a1a); }

.help-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

h1 {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
  color: var(--oc-role-on-surface);
}

h2 {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 0.5rem 0;
  color: var(--oc-role-primary, #0082c9);
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
  color: var(--oc-role-on-surface);
}

.help-footer {
  font-size: 0.75rem;
  color: var(--oc-role-on-surface-variant, #888);
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--oc-role-outline-variant, #ddd);
  text-align: center;
}

.help-footer a {
  color: var(--oc-role-primary, #0082c9);
  text-decoration: none;
}

.help-footer a:hover { text-decoration: underline; }
</style>
