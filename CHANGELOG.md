# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2026-04-09

### Added
- iCal subscriptions — add external `.ics` calendars as read-only feeds via the sidebar
- CORS proxy at `/ics-proxy/` (Node.js container in the OpenCloud Docker stack) so browser-blocked `.ics` URLs can be fetched; protected by Traefik ForwardAuth (OpenCloud login required)

### Fixed
- Dark mode for Cancel button and input fields in the Subscription dialog

## [1.2.0] - 2026-04-09

### Fixed
- UNTIL-based recurrence end now uses `T235959Z` instead of `T000000Z` — timed events on the last day were incorrectly excluded from their own series
- Monthly recurrence rules with negative weekday offsets (e.g. `BYDAY=-1MO`) are now preserved when editing a series instead of being recalculated from the start date
- Forgejo CI: use `pnpm build` (which includes `vue-tsc --noEmit`) instead of `pnpm vite build`, so the type check is not silently skipped

### Added
- Forgejo Actions release workflow: pushing a `v*` tag automatically builds and publishes a `agenda-<version>.zip` as a release asset
- Unit tests: 52 tests across `rrule.ts` and `caldav.ts` (parseRrule, buildRrule, getNthWeekday, escapeXml, escapeIcs, buildIcs, parseEvents)
- `vitest.config.ts` with `happy-dom` environment for component-free unit tests
- Time-pinned test fixtures (`vi.useFakeTimers`) so recurring event tests do not break after 2028

## [1.1.0] - 2026-04-08

### Added
- ↻ indicator on recurring events in all calendar views
- Reload button in sidebar (↻) with spinner animation while loading
- Dual delete buttons for recurring events: delete single occurrence (EXDATE) or entire series

### Fixed
- Recurring events created in Thunderbird were shown as simple events — RRULE is now added to all expanded occurrences
- Recurring event dialog was read-only — all fields are now editable for series editing
- Weekday labels invisible in dark mode — fixed `color: inherit` instead of hardcoded fallback
- 412 Precondition Failed when deleting a series after first deleting an occurrence — ETags are cleared on remaining occurrences after EXDATE modification
- Follow-up occurrences not visible after creating a new recurring event — calendar now reloads after create if an RRULE is present

## [1.0.0] - 2026-04-06

### Added
- Initial release
- Month, week, day and list views (FullCalendar)
- Create, edit and delete events with drag & drop and resize
- Recurring events with full RRULE support (daily, weekly, monthly, yearly; end by count or date)
- Multiple calendars with custom colors, show/hide toggle
- CalDAV backend via OpenCloud-bundled Radicale
- Bilingual UI (English / German)
- Dark mode support
- In-app help page (bilingual modal)
