<template>
  <div class="calendar-view">
    <!-- Sidebar: calendar list -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">{{ t('Agenda') }}</span>
        <button class="btn-new-event" @click="openNewEvent()">{{ t('+ New') }}</button>
      </div>

      <ul class="calendar-list">
        <li
          v-for="cal in calendars"
          :key="cal.href"
          :class="{ active: activeCalendarHref === cal.href }"
          @click="activeCalendarHref = cal.href"
        >
          <span
            class="cal-dot"
            :style="{ background: cal.color ?? '#0082c9' }"
          />
          {{ cal.displayName }}
        </li>
      </ul>

      <p v-if="error" class="error-msg">{{ error }}</p>
    </aside>

    <!-- Main calendar area -->
    <main class="calendar-main">
      <div v-if="loading && !events.length" class="loading-overlay">
        <div class="spinner" />
      </div>

      <FullCalendar
        ref="fcRef"
        :options="calendarOptions"
      />
    </main>

    <!-- Event dialog -->
    <EventDialog
      v-if="dialogOpen"
      :event="editingEvent"
      :defaultStart="pendingStart ?? undefined"
      :defaultEnd="pendingEnd ?? undefined"
      :defaultAllDay="pendingAllDay ?? undefined"
      :calendars="calendars"
      :activeCalendarHref="activeCalendarHref"
      @save="handleCreate"
      @update="handleUpdate"
      @delete="handleDelete"
      @close="dialogOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import FullCalendar from '@fullcalendar/vue3'
import type { CalendarOptions, EventClickArg, DateSelectArg, DatesSetArg, EventDropArg } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import deLocale from '@fullcalendar/core/locales/de'
import EventDialog from '@/components/EventDialog.vue'
import { useCalendar } from '@/composables/useCalendar'
import { useI18n } from '@/composables/useI18n'
import type { CalendarEvent } from '@/services/caldav'

const { t } = useI18n()

const {
  loading,
  error,
  calendars,
  events,
  activeCalendarHref,
  loadCalendars,
  loadEvents,
  createEvent,
  updateEvent,
  deleteEvent,
} = useCalendar()

// --- dialog state ---
const dialogOpen = ref(false)
const editingEvent = ref<CalendarEvent | null>(null)
const pendingStart = ref<Date | null>(null)
const pendingEnd = ref<Date | null>(null)
const pendingAllDay = ref<boolean | null>(null)

function openNewEvent(start?: Date, end?: Date, allDay?: boolean) {
  editingEvent.value = null
  pendingStart.value = start ?? null
  pendingEnd.value = end ?? null
  pendingAllDay.value = allDay ?? null
  dialogOpen.value = true
}

function openEditEvent(event: CalendarEvent) {
  editingEvent.value = event
  pendingStart.value = null
  pendingEnd.value = null
  dialogOpen.value = true
}

// --- FullCalendar event mapping ---
const fcEvents = computed(() =>
  events.value.map(e => ({
    id: e.uid,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    backgroundColor: e.color ?? activeCalColor(e.calendarHref),
    borderColor: e.color ?? activeCalColor(e.calendarHref),
    extendedProps: { event: e },
  })),
)

function activeCalColor(href: string): string {
  return calendars.value.find(c => href.startsWith(c.href))?.color ?? '#0082c9'
}

// --- initial view via URL path ---
function getInitialView(): string {
  const path = window.location.pathname
  if (path.endsWith('/week')) return 'timeGridWeek'
  if (path.endsWith('/day')) return 'timeGridDay'
  if (path.endsWith('/list')) return 'listWeek'
  return 'dayGridMonth'
}

// detect language for FC locale
function getFcLocale() {
  const lang = document.documentElement.lang || navigator.language || ''
  return lang.toLowerCase().startsWith('de') ? deLocale : 'en'
}

// current range being displayed — re-fetch when it changes
let currentRange = { start: new Date(), end: new Date() }

function onDatesSet(info: DatesSetArg) {
  currentRange = { start: info.start, end: info.end }
  loadEvents(info.start, info.end)
}

const fcRef = ref<InstanceType<typeof FullCalendar> | null>(null)

const calendarOptions = computed<CalendarOptions>(() => ({
  plugins: [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin],
  initialView: getInitialView(),
  locale: getFcLocale(),
  headerToolbar: {
    left: 'prev,next today',
    center: 'title',
    right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
  },
  views: {
    listWeek: { buttonText: t('list') },
  },
  selectable: true,
  editable: true,
  eventResizableFromStart: true,
  events: fcEvents.value,
  select(info: DateSelectArg) {
    // FC end is exclusive for all-day selections → shift back one day for the dialog
    const end = info.allDay
      ? new Date(info.end.getTime() - 24 * 60 * 60 * 1000)
      : info.end
    openNewEvent(info.start, end, info.allDay)
  },
  eventClick(info: EventClickArg) {
    const ev = info.event.extendedProps.event as CalendarEvent
    openEditEvent(ev)
  },
  async eventDrop(info: EventDropArg) {
    const ev = info.event.extendedProps.event as CalendarEvent
    const updated: CalendarEvent = {
      ...ev,
      start: info.event.start!,
      end: info.event.end ?? new Date(info.event.start!.getTime() + 3600 * 1000),
      allDay: info.event.allDay,
    }
    try {
      await updateEvent(updated)
    } catch (e: unknown) {
      info.revert()
      alert(e instanceof Error ? e.message : String(e))
    }
  },
  async eventResize(info: EventResizeDoneArg) {
    const ev = info.event.extendedProps.event as CalendarEvent
    const updated: CalendarEvent = {
      ...ev,
      start: info.event.start!,
      end: info.event.end!,
      allDay: info.event.allDay,
    }
    try {
      await updateEvent(updated)
    } catch (e: unknown) {
      info.revert()
      alert(e instanceof Error ? e.message : String(e))
    }
  },
  datesSet: onDatesSet,
  height: '100%',
  firstDay: 1, // Monday
  nowIndicator: true,
  eventTimeFormat: {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  },
}))

// --- handlers ---
async function handleCreate(
  partial: Omit<CalendarEvent, 'uid' | 'calendarHref' | 'etag'> & { calendarHref: string },
) {
  dialogOpen.value = false
  try {
    await createEvent(partial, partial.calendarHref)
  } catch (e: unknown) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

async function handleUpdate(event: CalendarEvent) {
  dialogOpen.value = false
  try {
    await updateEvent(event)
  } catch (e: unknown) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

async function handleDelete(event: CalendarEvent) {
  dialogOpen.value = false
  try {
    await deleteEvent(event)
  } catch (e: unknown) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

// --- init ---
onMounted(async () => {
  await loadCalendars()
})

// reload events when calendars change
watch(calendars, () => {
  if (calendars.value.length) {
    loadEvents(currentRange.start, currentRange.end)
  }
})
</script>

<style scoped>
.calendar-view {
  display: flex;
  height: 100%;
  overflow: hidden;
}

/* ---- Sidebar ---- */
.sidebar {
  width: 220px;
  min-width: 180px;
  border-right: 1px solid var(--oc-color-border);
  display: flex;
  flex-direction: column;
  padding: 1rem 0.75rem;
  gap: 0.5rem;
  background: var(--oc-color-background-highlight);
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.sidebar-title {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--oc-color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.btn-new-event {
  padding: 0.25rem 0.6rem;
  border-radius: 4px;
  border: none;
  background: var(--oc-color-swatch-brand-default);
  color: #fff;
  cursor: pointer;
  font-size: 0.85rem;
}

.calendar-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.calendar-list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  color: var(--oc-color-text-default);
}

.calendar-list li:hover,
.calendar-list li.active {
  background: var(--oc-color-background-default);
}

.cal-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ---- Main area ---- */
.calendar-main {
  flex: 1;
  min-width: 0;
  padding: 0.75rem;
  overflow: hidden;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  pointer-events: none;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--oc-color-border, #d0d0d0);
  border-top-color: var(--oc-color-swatch-brand-default, #0082c9);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-msg {
  color: var(--oc-color-swatch-danger-default);
  font-size: 0.8rem;
}

/* ---- FullCalendar dark mode overrides ---- */
:deep(.fc) {
  --fc-border-color: #d0d0d0;
  --fc-page-bg-color: var(--oc-color-background-default);
  --fc-neutral-bg-color: var(--oc-color-background-highlight);
  --fc-neutral-text-color: var(--oc-color-text-muted);
  --fc-today-bg-color: color-mix(in srgb, var(--oc-color-swatch-brand-default) 10%, transparent);
  --fc-button-bg-color: var(--oc-color-background-highlight);
  --fc-button-border-color: #d0d0d0;
  --fc-button-hover-bg-color: var(--oc-color-background-default);
  --fc-button-hover-border-color: #b0b0b0;
  --fc-button-active-bg-color: var(--oc-color-swatch-brand-default);
  --fc-button-active-border-color: var(--oc-color-swatch-brand-default);
  --fc-button-text-color: var(--oc-color-text-default);
  --fc-list-event-hover-bg-color: var(--oc-color-background-highlight);
  color: var(--oc-color-text-default);
}

@media (prefers-color-scheme: dark) {
  :deep(.fc) {
    --fc-border-color: #3a3a3a;
    --fc-button-border-color: #3a3a3a;
    --fc-button-hover-border-color: #555;
  }
}

:deep(.fc .fc-button-primary:not(:disabled).fc-button-active),
:deep(.fc .fc-button-primary:not(:disabled):active) {
  color: #fff;
}

:deep(.fc .fc-col-header-cell-cushion),
:deep(.fc .fc-daygrid-day-number),
:deep(.fc .fc-list-day-cushion),
:deep(.fc a) {
  color: var(--oc-color-text-default);
}

:deep(.fc .fc-toolbar-title) {
  color: var(--oc-color-text-default);
  font-size: 1.1rem;
}

:deep(.fc .fc-list-empty) {
  background: var(--oc-color-background-default);
  color: var(--oc-color-text-muted);
}

/* Day cell backgrounds — light mode */
:deep(.fc-daygrid-day) {
  background: #f9f9f9;
}
:deep(.fc-daygrid-day:hover) {
  background: #f0f0f0;
}
:deep(.fc-day-other) {
  background: #f3f3f3;
  opacity: 0.6;
}
:deep(.fc-day-today.fc-daygrid-day) {
  background: rgba(0, 130, 201, 0.1) !important;
}

/* Day cell backgrounds — dark mode */
@media (prefers-color-scheme: dark) {
  :deep(.fc-daygrid-day) {
    background: #2a2a2a;
  }
  :deep(.fc-daygrid-day:hover) {
    background: #333333;
  }
  :deep(.fc-day-other) {
    background: #222222;
    opacity: 0.7;
  }
  :deep(.fc-day-today.fc-daygrid-day) {
    background: rgba(0, 130, 201, 0.18) !important;
  }
}

/* Resize handles — make them visible especially in dark mode */

/* timeGrid (week/day): bar at bottom of timed events */
:deep(.fc-timegrid-event .fc-event-resizer-end::after) {
  content: '';
  display: block;
  width: 24px;
  height: 4px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 2px;
  margin: 0 auto;
  margin-top: 2px;
}

/* dayGrid (month): vertical bars at left and right edges of multi-day events.
   FC already sets position:absolute on these — do NOT override it. */
:deep(.fc-daygrid-event .fc-event-resizer-start),
:deep(.fc-daygrid-event .fc-event-resizer-end) {
  width: 14px;
  cursor: ew-resize;
}
/* Show the bar only on real events, not on the drag mirror clone */
:deep(.fc-daygrid-event:not(.fc-event-mirror) .fc-event-resizer-start::after),
:deep(.fc-daygrid-event:not(.fc-event-mirror) .fc-event-resizer-end::after) {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 4px;
  height: 14px;
  background: rgba(255, 255, 255, 0.65);
  border-radius: 2px;
  pointer-events: none;
}

/* Replace icon font (blocked by CSP font-src) with unicode characters */
:deep(.fc-icon) {
  font-family: inherit !important;
  font-size: 1rem !important;
}
:deep(.fc-icon-chevron-left::before)  { content: '‹' !important; }
:deep(.fc-icon-chevron-right::before) { content: '›' !important; }
:deep(.fc-icon-chevrons-left::before)  { content: '«' !important; }
:deep(.fc-icon-chevrons-right::before) { content: '»' !important; }
:deep(.fc-icon-minus::before) { content: '−' !important; }
:deep(.fc-icon-plus::before)  { content: '+' !important; }
:deep(.fc-icon-x::before)     { content: '×' !important; }
</style>
