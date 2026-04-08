# opencloud-agenda

A CalDAV calendar web application for [OpenCloud](https://opencloud.eu) 6.x, built as a native web extension using the OpenCloud Extension SDK.

## Features

- **Month, week, day and list views** powered by [FullCalendar](https://fullcalendar.io/)
- **Create, edit and delete events** via a clean dialog — including drag & drop and resize
- **Recurring events** — create and edit series with full RRULE support (daily, weekly, monthly by day or Nth weekday, yearly; end by count or date); recurring events are marked with ↻
- **CalDAV sync** — compatible with Thunderbird, DAVx⁵ and other CalDAV clients; Thunderbird-created recurring events are correctly expanded and editable
- **Calendar management** — create calendars with custom colors, rename by double-click, show/hide per calendar
- **Move events between calendars** — change the calendar in the edit dialog
- **Manual refresh** — ↻ button in the sidebar reloads all data from the server on demand
- **Bilingual UI** — English and German, based on the browser/OpenCloud language setting
- **Dark mode support** — follows the OpenCloud theme
- **Secure token management** — app tokens are cached in `localStorage` (24 h TTL), deduplicated across tabs, and refreshed automatically on expiry

## Requirements

- OpenCloud 6.x with Radicale enabled (CalDAV at `/caldav/`)
- Node.js 18+ and [pnpm](https://pnpm.io/)

## Installation

### 1. Clone the repository

```bash
git clone https://forgejo.linux-nerds.org/frank/opencloud-agenda.git
cd opencloud-agenda
pnpm install
```

### 2. Build

```bash
pnpm build
```

The compiled output is written to `dist/`.

### 3. Deploy to OpenCloud

Copy the contents of `dist/` to your OpenCloud web assets directory:

```
<opencloud-data>/web/assets/apps/agenda/
```

Then register the app in your OpenCloud `config.json` by adding an entry to `external_apps`:

```json
{
  "id": "agenda",
  "path": "/apps/agenda/js/remoteEntry-<hash>.mjs",
  "themeId": "default"
}
```

Restart OpenCloud to pick up the new app registration.

## Development

```bash
pnpm dev
```

Refer to the [OpenCloud web-app-skeleton](https://github.com/opencloud-eu/web-app-skeleton) for local development setup with Docker.

## Technical stack

| Library | Purpose |
|---|---|
| [Vue 3](https://vuejs.org/) | UI framework |
| [FullCalendar 6](https://fullcalendar.io/) | Calendar rendering |
| [ical.js](https://github.com/kewisch/ical.js/) | iCalendar parsing & RRULE expansion |
| [@opencloud-eu/web-pkg](https://github.com/opencloud-eu/web) | OpenCloud Extension SDK |
| [@module-federation/vite](https://github.com/module-federation/vite) | Module Federation build |
| [Vite 8](https://vite.dev/) | Build tool |

## Architecture notes

- Authentication uses the OpenCloud app token endpoint (`POST /auth-app/tokens`) with the OIDC Bearer token, then Basic Auth for CalDAV requests — identical to the contacts app pattern.
- App tokens are stored in `localStorage` keyed by user UUID (24 h TTL). Concurrent tab requests are deduplicated via a module-level in-flight promise map. A 401 response triggers an automatic token refresh.
- The Radicale CalDAV path uses the **user UUID** (not the username), as set by the OpenCloud proxy via `X-Remote-User`.
- FullCalendar icon fonts are replaced with Unicode characters to comply with the OpenCloud Content Security Policy (`font-src 'self'` — no `data:` URIs allowed).
- Recurring events are expanded client-side by ical.js (±2 years). Editing a recurring event uses GET → patch → PUT to preserve the RRULE and all other ICS properties.
- All ICS text values are RFC 5545-escaped; CalDAV XML payloads use proper XML entity escaping.

## License

This project is licensed under the **GNU General Public License v3.0**.  
See [LICENSE](LICENSE) for the full license text.
