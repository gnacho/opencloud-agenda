# Changelog

All notable changes to this project will be documented in this file.

## [2.1.0] - 2026-05-01

### Added
- **Event overflow in month view** — cells cap at the available height and show a "+N more" link; clicking opens a popover with all events for that day
- **Subscription URL normalization** — the subscription dialog now accepts `webcal://` links (converted to `https://`) and Google Calendar "Add to Calendar" URLs (`?cid=…`); the correct ICS URL is extracted automatically

### Fixed
- Dark mode: the "+N more" day popover now has a proper dark background and readable text
- Subscriptions: `fetchOne()` now discards results if the subscription was deleted or disabled while the feed was loading (stale-write guard)
- Recurring events: drag/drop and resize now immediately reflect the new times on all occurrences in the local state instead of waiting for a full reload
- `patchRecurringEvent()`: passing `fields.rrule = undefined` no longer removes the RRULE; only an explicit empty string triggers removal
- `src/manifest.json` version was out of sync with `package.json` — both now consistently track the release version

### Documentation
- iCal subscriptions marked as experimental in feature list
- New "Optional: iCal Subscriptions (Experimental)" section with full setup guide for the Node.js proxy Docker service

## [2.0.0] - 2026-04-11

### Changed
- **Breaking:** App folder renamed from `agenda/` to `opencloud-agenda/` — update your server path accordingly (`apps/opencloud-agenda/`)
- All hardcoded app identity strings centralized in `src/constants.ts` — renaming the app now requires only a single change

## [1.4.1] - 2026-04-11

### Changed
- README: added zip-based installation as recommended option (with curl, chown, and restart steps)
- README: fixed app registration docs — manifest.json is sufficient, no config.json edits needed
- README: added Radicale backup warning
- README: added screenshot

## [1.4.0] - 2026-04-10

### Fixed
- Subscriptions: token arriving after userId now triggers a server reload instead of staying on the localStorage fallback
- Subscriptions: concurrent writes are debounced (300 ms) so rapid changes no longer risk an older snapshot overwriting a newer one on the server
- Subscriptions: offline edits made while no token is available are pushed to the server when the token arrives, instead of being overwritten by an older server copy
- Subscriptions: the locally-modified flag is now version-guarded — a stale in-flight write that resolves after a newer offline edit can no longer clear the flag and cause the next reload to accept stale server data
- Subscriptions: all state (subscriptions, events, errors) is cleared immediately on direct user-to-user switch, not just on logout
- Subscriptions: in-flight `load()` and `fetchOne()` results from a previous session are discarded after logout or user switch (session counter)
- Subscriptions: `locallyModified` is only cleared after a confirmed server write (`ok: true`); a failed push leaves the flag set so the next reload retries

### Added
- 12 unit tests for `useSubscriptions` covering auth-timing, debounce ordering, cross-account write safety, session invalidation, offline-edit preservation, and write-failure retry
- `vitest.config.ts` now resolves the `@/` alias so composable tests can import from `@/services/`

## [1.3.0] - 2026-04-09

### Added
- iCal subscriptions — add external `.ics` calendars as read-only feeds via the sidebar
- CORS proxy at `/ics-proxy/` (Node.js container in the OpenCloud Docker stack) so browser-blocked `.ics` URLs can be fetched; authenticated via OpenCloud Bearer token

### Fixed
- Dark mode for Cancel button and input fields in the Subscription dialog
- Proxy authentication now uses the OpenCloud Bearer token instead of Traefik ForwardAuth (which broke when switching between apps)

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
