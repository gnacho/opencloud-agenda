# opencloud-agenda

A CalDAV calendar web application for [OpenCloud](https://opencloud.eu) 6.x, built as a native web extension using the OpenCloud Extension SDK.

## Features

- **Month, week, day and list views** powered by [FullCalendar](https://fullcalendar.io/)
- **Create, edit and delete events** via a clean dialog
- **Recurring events** — full RRULE expansion via ical.js
- **Bilingual UI** — English and German, based on the browser/OpenCloud language setting
- **Dark mode support** — follows the OpenCloud theme
- **CalDAV backend** — connects to the Radicale CalDAV server bundled with OpenCloud

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
- The Radicale CalDAV path uses the **user UUID** (not the username), as set by the OpenCloud proxy via `X-Remote-User`.
- FullCalendar icon fonts are replaced with Unicode characters to comply with the OpenCloud Content Security Policy (`font-src 'self'` — no `data:` URIs allowed).
- Recurring events are expanded client-side by ical.js (up to 2 years ahead).

## License

This project is licensed under the **GNU General Public License v3.0**.  
See [LICENSE](LICENSE) for the full license text.
