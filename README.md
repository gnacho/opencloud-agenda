# opencloud-agenda

A CalDAV calendar web application for [OpenCloud](https://opencloud.eu) 6.x, built as a native web extension using the OpenCloud Extension SDK.

[![AI Assisted](https://img.shields.io/badge/AI%20assisted-Claude%20Code-orange?logo=anthropic)](https://claude.ai) [![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

> [!IMPORTANT]
> This project is an independent, community-built tool and is not affiliated with, endorsed by, or associated with the [OpenCloud project](https://opencloud.eu) in any way.

## Features

- **Month, week, day and list views** powered by [FullCalendar](https://fullcalendar.io/)
- **Create, edit and delete events** via a clean dialog — including drag & drop and resize
- **Recurring events** — create and edit series with full RRULE support (daily, weekly, monthly by day or Nth weekday, yearly; end by count or date); recurring events are marked with ↻
- **CalDAV sync** — compatible with Thunderbird, DAVx⁵ and other CalDAV clients; Thunderbird-created recurring events are correctly expanded and editable
- **Calendar management** — create calendars with custom colors, rename by double-click, show/hide per calendar
- **Move events between calendars** — change the calendar in the edit dialog
- **iCal subscriptions** *(experimental, requires additional server setup — see below)* — add external `.ics` calendars (public holidays, team calendars) as read-only feeds. Accepts plain `.ics` URLs, `webcal://` links, and Google Calendar "Add to Calendar" links (`?cid=…`)
- **Event overflow** — month view caps events per cell and shows a "+N more" link; clicking opens a popover with all events for that day
- **Manual refresh** — ↻ button in the sidebar reloads all data and subscriptions from the server on demand
- **Bilingual UI** — English and German, based on the browser/OpenCloud language setting
- **Dark mode support** — follows the OpenCloud theme
- **Secure token management** — app tokens are cached in `localStorage` (24 h TTL), deduplicated across tabs, and refreshed automatically on expiry

![Agenda App](docs/screenshot.png)

> [!WARNING]
> **Back up your Radicale data before installing or upgrading.**  
> This app reads and writes calendar data directly via CalDAV. While it has been tested carefully, no software is free of bugs. A backup of your Radicale data directory ensures you can recover your calendars if anything goes wrong.

## Requirements

- OpenCloud 6.x with Radicale enabled (CalDAV at `/caldav/`)

## Installation

### Option A: Download the release zip (recommended)

1. Download and unzip the latest release (replace `v1.4.0` with the current version):

```bash
cd <opencloud-data>/web/assets/apps/
curl -L -O https://forgejo.linux-nerds.org/frank/opencloud-agenda/releases/download/v2.0.0/agenda-v2.0.0.zip
unzip agenda-v2.0.0.zip
rm agenda-v2.0.0.zip
```

This creates an `agenda/` folder containing the app files.

3. Fix ownership if you unzipped as root (replace `dockeruser` with your OpenCloud service user):

```bash
chown -R dockeruser:dockeruser <opencloud-data>/web/assets/apps/opencloud-agenda
```

4. Restart OpenCloud:

```bash
docker compose restart opencloud
```

The app registers itself automatically via the included `manifest.json` — no changes to OpenCloud config files required.

### Option B: Build from source

Requirements: Node.js 18+ and [pnpm](https://pnpm.io/)

```bash
git clone https://forgejo.linux-nerds.org/frank/opencloud-agenda.git
cd opencloud-agenda
pnpm install
pnpm build
```

Copy the contents of `dist/` to:

```
<opencloud-data>/web/assets/apps/opencloud-agenda/
```

Then restart OpenCloud.

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
- ICS subscriptions are fetched server-side via a small Node.js proxy (`/ics-proxy/`) to avoid browser CORS restrictions. The proxy validates the user's Bearer token against OpenCloud before forwarding the request.

## Optional: iCal Subscriptions (Experimental)

> [!NOTE]
> This feature requires a small server-side proxy service. The base app works without it — subscriptions are simply not available unless the proxy is set up.

External `.ics` feeds cannot be fetched directly from the browser due to CORS restrictions. A lightweight Node.js proxy service handles this server-side.

### 1. Create the proxy script

Create a directory `ics-proxy/` next to your `docker-compose.yml` with two files:

**`ics-proxy/package.json`**
```json
{
  "name": "ics-proxy",
  "version": "1.0.0",
  "type": "module",
  "main": "server.js"
}
```

**`ics-proxy/server.js`**
```js
import http from 'http'

const PORT = 3000
const PATH_PREFIX = '/ics-proxy/'
const OC_USER_URL = 'http://opencloud:9200/ocs/v2.php/cloud/user'

async function isAuthenticated(authHeader) {
  if (!authHeader) return false
  return new Promise((resolve) => {
    const req = http.get(OC_USER_URL, {
      headers: { Authorization: authHeader, 'OCS-APIRequest': 'true' }
    }, (res) => resolve(res.statusCode === 200))
    req.on('error', () => resolve(false))
    req.setTimeout(3000, () => { req.destroy(); resolve(false) })
  })
}

http.createServer(async (req, res) => {
  if (!req.url.startsWith(PATH_PREFIX)) {
    res.writeHead(404); res.end('Not found'); return
  }
  if (!await isAuthenticated(req.headers['authorization'])) {
    res.writeHead(401, { 'WWW-Authenticate': 'Bearer' })
    res.end('Unauthorized')
    return
  }
  const targetUrl = decodeURIComponent(req.url.slice(PATH_PREFIX.length))
  let parsed
  try { parsed = new URL(targetUrl) } catch {
    res.writeHead(400); res.end('Invalid URL'); return
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    res.writeHead(400); res.end('Only http/https allowed'); return
  }
  try {
    const upstream = await fetch(targetUrl, {
      headers: { 'User-Agent': 'opencloud-agenda-ics-proxy/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })
    const body = await upstream.arrayBuffer()
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'text/calendar; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Cache-Control': 'max-age=3600',
    })
    res.end(Buffer.from(body))
  } catch (err) {
    res.writeHead(502); res.end('Upstream error: ' + err.message)
  }
}).listen(PORT, () => console.log('ICS proxy listening on port ' + PORT))
```

### 2. Add the service to docker-compose.yml

```yaml
services:
  # ... your existing services ...

  ics-proxy:
    image: node:20-alpine
    restart: always
    working_dir: /app
    command: node server.js
    volumes:
      - ./ics-proxy:/app
    networks:
      - opencloud-net
```

### 3. Add the route to proxy.yaml

Add the following entry to the `routes:` list in `config/opencloud/proxy.yaml`:

```yaml
- endpoint: /ics-proxy/
  backend: http://ics-proxy:3000
  unprotected: true
```

### 4. Apply the changes

```bash
docker compose up -d ics-proxy
docker compose restart opencloud
```

The proxy validates every request against OpenCloud's user endpoint before forwarding, so only authenticated users can fetch external calendars.

## License

This project is licensed under the **GNU General Public License v3.0**.  
See [LICENSE](LICENSE) for the full license text.
