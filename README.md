# opencloud-agenda

A CalDAV calendar web application for [OpenCloud](https://opencloud.eu) 8.x, built as a native web extension using the OpenCloud Extension SDK.

[![AI Assisted](https://img.shields.io/badge/AI%20assisted-Claude%20Code-orange?logo=anthropic)](https://claude.ai) [![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

> [!IMPORTANT]
> This project is an independent, community-built tool and is not affiliated with, endorsed by, or associated with the [OpenCloud project](https://opencloud.eu) in any way.

## Features

- **Month, week, day and list views** powered by [FullCalendar](https://fullcalendar.io/)
- **Create, edit and delete events** via a clean dialog — including drag & drop and resize
- **Recurring events** — create and edit series with full RRULE support (daily, weekly, monthly by day or Nth weekday, yearly; end by count or date); recurring events are marked with ↻
- **CalDAV sync** — compatible with Thunderbird, DAVx⁵ and other CalDAV clients; Thunderbird-created recurring events are correctly expanded and editable
- **Calendar management** — create calendars with custom colors, rename by double-click, show/hide per calendar. Any colour works: event text switches to black on light colours, and near-white chips get an outline
- **Move events between calendars** — change the calendar in the edit dialog
- **iCal subscriptions** *(experimental, requires additional server setup — see below)* — add external `.ics` calendars (public holidays, team calendars) as read-only feeds. Accepts plain `.ics` URLs, `webcal://` links, and Google Calendar "Add to Calendar" links (`?cid=…`)
- **Event overflow** — month view caps events per cell and shows a "+N more" link; clicking opens a popover with all events for that day
- **Manual refresh** — ↻ button in the sidebar reloads all data and subscriptions from the server on demand
- **Visible loading** — a thin progress bar runs along the top of the calendar while anything is still on its way, and each subscription shows a small ring while its feed is being fetched
- **Bilingual UI** — English and German, based on the browser/OpenCloud language setting
- **Dark mode support** — follows the OpenCloud theme
- **Secure token management** — app tokens are cached per tab in `sessionStorage` (24 h TTL), refreshed automatically on expiry, and revoked on the server at logout

![Agenda App](docs/screenshot.png)

> [!WARNING]
> **Back up your Radicale data before installing or upgrading.**  
> This app reads and writes calendar data directly via CalDAV. While it has been tested carefully, no software is free of bugs. A backup of your Radicale data directory ensures you can recover your calendars if anything goes wrong.

## Requirements

- OpenCloud 8.x with Radicale enabled (CalDAV at `/caldav/`)

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

Requirements: Node.js 22+ and [pnpm](https://pnpm.io/) 11 (the exact version is pinned via `packageManager` in `package.json`; with Corepack enabled it is picked up automatically)

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
- App tokens are stored in `sessionStorage` keyed by user UUID (24 h TTL), so they never outlive the browser tab. Concurrent requests within a tab are deduplicated via a module-level in-flight promise map. A 401 response triggers an automatic token refresh. When OpenCloud Web clears the login session (logout), the app revokes its token via `DELETE /auth-app/tokens`; the same happens when the user changes.
- The Radicale CalDAV path uses the **user UUID** (not the username), as set by the OpenCloud proxy via `X-Remote-User`.
- FullCalendar icon fonts are replaced with Unicode characters to comply with the OpenCloud Content Security Policy (`font-src 'self'` — no `data:` URIs allowed).
- Recurring events are expanded client-side by ical.js (±2 years). Editing a recurring event uses GET → patch → PUT to preserve the RRULE and all other ICS properties.
- All ICS text values are RFC 5545-escaped; CalDAV XML payloads use proper XML entity escaping.
- ICS subscriptions are fetched server-side via a small Node.js proxy (`/ics-proxy/`) to avoid browser CORS restrictions. The proxy validates the user's Bearer token against OpenCloud and refuses targets on private, loopback, link-local or tunnelling (NAT64, Teredo, 6to4) addresses. The check runs inside the socket's own DNS lookup — not as a separate resolve beforehand — so a rebinding DNS server cannot answer differently to the check and the connection.
- Subscription responses are checked for a `BEGIN:VCALENDAR` prelude. A misrouted `/ics-proxy/` path answers HTTP 200 with the OpenCloud web SPA's `index.html`, which would otherwise parse to an empty event list and present a broken subscription as an empty but healthy one.

## Theming — read this before touching any colour

> [!IMPORTANT]
> **Never use `@media (prefers-color-scheme: …)` in this app, and never invent `--oc-color-*` variables.** Both were in here for a long time and made the light theme unusable. The details below explain why, so the mistake is not repeated.

OpenCloud publishes a Material-3 style set of **role tokens**:

```
--oc-role-surface            --oc-role-on-surface
--oc-role-surface-container  --oc-role-on-surface-variant
--oc-role-primary            --oc-role-on-primary
--oc-role-error              --oc-role-on-error
--oc-role-outline            --oc-role-outline-variant
…45 in total
```

Their values live in `/themes/opencloud/theme.json` under `clients.web.themes[].designTokens.roles`, one entry per theme, and OpenCloud **rewrites the custom properties in place** when the user switches theme.

Three consequences, each of which cost a bug:

1. **There is no theme class and no media query to hook into.** `.is-dark-mode` exists in OpenCloud's stylesheet but belongs to a single floating-action-button widget — it is not a global switch. Consuming the role tokens is the only way to follow the theme.
2. **`prefers-color-scheme` follows the operating system, not OpenCloud.** The two agree only by coincidence. OS dark plus OpenCloud light produced a white sidebar around a dark calendar grid.
3. **`--oc-color-*` does not exist.** Those names silently fall back to whatever literal is written after the comma, so the app looks fine in one theme and is quietly hardcoded in the other.

Pair every surface with its matching `on-` token — in the dark theme `primary` is a light blue (`#5cd5fb`) and white text on it is unreadable, which is exactly what `--oc-role-on-primary` (`#003543`) is for.

**Elevation steps** used here, chosen so the dark theme keeps a visible separation:

| Element | Token | light | dark |
|---|---|---|---|
| Dialog, page | `surface` | `#ffffff` | `#191c1d` |
| Inputs, secondary buttons | `surface-container-high` | `#f2f4f5` | `#272a2c` |
| Hover | `surface-container-highest` | `#eceef0` | `#323537` |

**FullCalendar** is themed through its own `--fc-*` variables, fed from the role tokens in `CalendarView.vue`. Watch for FullCalendar rules that need `!important` to override — the today marker used to carry a hardcoded brand blue that beat the variable.

**The today marker** is the day number itself: a filled pill in `primary` with `--oc-role-on-primary` digits, set in `CalendarView.vue` on `.fc-day-today .fc-daygrid-day-number`. The cell keeps a 14 % wash of `primary` as a secondary cue, and that 14 % is a ceiling, not a starting point — event chips sit on that cell and lose their contrast as the tint grows. A marker that is hard to see is fixed on the date, not by darkening the cell. Both values live next to each other; keep `--fc-today-bg-color` in step with the `.fc-day-today.fc-daygrid-day` rule, or the week and day views drift away from the month.

**Native controls** (date pickers, selects, scrollbars) obey the CSS `color-scheme` property, which takes a keyword, not a colour. `light dark` hands the choice back to the OS. `CalendarView.vue` therefore derives it from the resolved surface colour via `schemeForBackground()` and re-applies it with a `MutationObserver`, because OpenCloud signals a theme change only by rewriting the properties.

**Deliberately not themed:** the QR tile stays white (a dark tile swallows the quiet zone and phone cameras stop reading the code), modal scrims stay translucent black, and event resize grips stay translucent white because they sit on user-chosen calendar colours.

**Checking a change:** contrast is verifiable without a browser. Resolve every `background`/`color` pair in `dist/assets/*.css` against both palettes from `theme.json` and compute the WCAG ratio; the current build has 34 such pairs, all at or above AA 4.5:1. That catches unreadable combinations, but not spacing or aesthetics — click through both themes as well.

## Optional: iCal Subscriptions (Experimental)

> [!NOTE]
> This feature requires a small server-side proxy service. The base app works without it — subscriptions are simply not available unless the proxy is set up.

External `.ics` feeds cannot be fetched directly from the browser due to CORS restrictions. A lightweight Node.js proxy service handles this server-side.

> [!IMPORTANT]
> The proxy fetches URLs supplied by users from **inside** your Docker network, where service names like `opencloud:9200` and the cloud provider's metadata endpoint (`169.254.169.254`) are reachable. The `server.js` below therefore resolves every target hostname and refuses private, loopback, link-local and CGNAT addresses, re-checking after each redirect. Do not simplify that guard away — without it any authenticated user can read your internal services through the proxy.

The proxy lives in its own directory and its own Compose project, deliberately **outside** your OpenCloud compose directory, so that rebuilding or updating OpenCloud cannot remove it.

### Where subscriptions are stored, and what that means for other devices

Subscriptions are **not** CalDAV calendars. They are a list of feed URLs, kept as a single JSON file in your OpenCloud file storage:

```
/remote.php/dav/files/<userId>/.agenda/subscriptions.json
```

`localStorage` holds a copy as an offline cache. The events themselves are never stored — they are fetched from the remote feed each time the app loads.

This has one consequence worth knowing up front:

| Where | Subscriptions visible? |
|---|---|
| Agenda in any browser, any device, same account | **Yes** — the list is read from the server on every load |
| Thunderbird, DAVx⁵, phone calendar apps | **No** — those speak CalDAV to Radicale, where the subscriptions do not exist |

Radicale stores events; it does not fetch remote feeds. Putting subscriptions there would mean polling the source and writing the events into a Radicale collection, which needs a service that runs whether or not a browser is open — outside what a web app can do.

So to see the same feed elsewhere, subscribe to the `.ics` URL directly on that device. The sharing dialog exists to make that painless.

### Sharing a subscription: `webcal://` or `https://`

**Click a subscription's name** in the sidebar. The dialog shows a QR code, the feed URL and a copy button — plus a switch between two schemes.

**The switch is not a convenience. Neither scheme works everywhere:**

| Target | Needs | Why |
|---|---|---|
| Android — ICSx⁵, DAVx⁵ | `webcal://` | An `https://` QR is just a web link. The phone opens a browser and shows raw iCalendar text; nothing offers to subscribe |
| Thunderbird | `https://` | Rejects `webcal://` in the "New calendar → On the network" dialog |
| iOS | `webcal://` | Safari hands the scheme to Calendar, which prompts to subscribe |

Same feed, both spellings — only the scheme differs:

```
webcal://calendar.google.com/calendar/ical/<id>%40group.calendar.google.com/public/basic.ics
https://calendar.google.com/calendar/ical/<id>%40group.calendar.google.com/public/basic.ics
```

`webcal://` is the default because that is what the QR is for. Switch to `https://` when the target is a desktop client.

Two details the app handles for you:

- **Stored URLs always use `http(s)`** — that is what `fetch()` needs. The scheme is swapped only for what leaves the app.
- **Google feed URLs are rewritten to `calendar.google.com`.** Google hands them out under `www.google.com`, which answers `302` with an empty body. Clients that do not follow redirects would subscribe and then show nothing.

> [!TIP]
> If an Android subscription stays empty, read the status in ICSx⁵ first. **"Not synced yet"** means Android never ran the sync — check battery optimisation for ICSx⁵, then Settings → Accounts → "Auto-sync data". An actual error message means the URL is the problem. The two look identical in the calendar app and lead to completely different searches.

### 1. Put the files on the server

The proxy lives in [`deploy/ics-proxy/`](deploy/ics-proxy/) — `server.js` (the whole proxy, no dependencies), `package.json` and a `compose.yaml` template. Copy them to the user that runs your OpenCloud Compose project (`dockeruser` in the setups this repo was written for):

```bash
# on the server
mkdir -p ~/ics-proxy/app

# from the workstation, in this repository
scp deploy/ics-proxy/compose.yaml                           dockeruser@cloud.example.org:ics-proxy/
scp deploy/ics-proxy/server.js deploy/ics-proxy/package.json dockeruser@cloud.example.org:ics-proxy/app/
```

### 2. Adjust the Compose project

In `~/ics-proxy/compose.yaml`, set `Host(...)` to your domain and the two network names to match your setup (`docker network ls`). Three labels are load-bearing:

- **`priority: 100`** — outranks the catch-all OpenCloud router on the same host, which would otherwise swallow `/ics-proxy/` and answer with the web SPA's `index.html`.
- **`traefik.docker.network`** — the container sits in two networks; without this Traefik may pick the wrong one.
- **`PathPrefix`** — keeps the proxy on the same origin as the app, which is what `useSubscriptions.ts` expects (it calls `/ics-proxy/` relatively).

The container runs `node:20-alpine` as an unprivileged user, read-only, with all capabilities dropped and a memory and PID limit; the Traefik middleware rate-limits it to 30 requests per minute per client.

### 3. Start it

```bash
cd ~/ics-proxy && docker compose up -d && docker compose logs ics-proxy
```

Verify from outside — an unauthenticated request must be refused by the proxy itself, not answered with HTML:

```bash
curl -si https://cloud.example.org/ics-proxy/ | head -3
# HTTP/2 401
# www-authenticate: Bearer
```

If you get `HTTP/2 200` and an HTML body instead, the route is not reaching the container and the request is falling through to OpenCloud.

### 4. Keeping it up to date

Once `agenda-proxy-install` is on the server (step 3 of [`deploy/server/SETUP.md`](deploy/server/SETUP.md)), every deploy — the *Deploy Dev* workflow as well as `deploy.sh` — also ships `server.js` and `package.json` to the server. The server-side script syntax-checks the upload in the proxy's own image, swaps the files in, restarts the container and rolls back if the new version does not answer. `compose.yaml` is never touched by a deploy; it is yours.

The proxy has its own test suite (`pnpm test:proxy`, run in CI) covering the address guard, the lookup hook and the fetch path — all against a local server, no network needed.

### Security notes

- Every request is authenticated against OpenCloud before anything is fetched, so the proxy is not an open relay for the internet at large. A token that OpenCloud accepted is remembered for 60 s (as a hash, never the token itself), so a page with eight subscriptions costs one OCS call rather than eight; rejections are never cached. That is also how long a revoked token keeps working here — set `AUTH_CACHE_MS=0` in the container's environment to re-check every request, or a smaller value.
- Upstream failures are reported to the client only in the proxy's own words ("feed not reachable", "too many redirects", …). Node's error text — which would include the resolved address and port — goes to the container log instead, prefixed by the feed's host and a short hash, never the URL: Google and Outlook private feeds carry their secret in the path, and logs are not a secret store.
- The remaining exposure is to **authenticated users** of your instance: they choose the URL that gets fetched. The SSRF guard is what contains that. Treat the proxy's trust level as "any account on your OpenCloud can reach these targets".
- The private-address check runs inside the DNS lookup the socket itself performs (`lookup` option of `http.request`), so the address that passes the check is the address that gets connected to. A nameserver that answers differently on each query (DNS rebinding) therefore gains nothing. Literal IPs in the URL skip the resolver and are checked directly; every redirect hop goes through the same path.
- Addresses are matched with `net.BlockList` on their parsed form, not on the string, so alternative spellings (`::ffff:7f00:1`, `0:0:0:0:0:0:0:1`, decimal IPv4) cannot slip past, and NAT64, Teredo and 6to4 prefixes — which can wrap a private IPv4 — are refused along with the usual private, loopback and link-local ranges.

## License

This project is licensed under the **GNU General Public License v3.0**.  
See [LICENSE](LICENSE) for the full license text.
