# API Aberta — Gateway

Central API gateway for the API Aberta platform. Handles authentication, rate limiting, and routes requests to microservices.

## Features

- JWT authentication
- API key management (free/pro/admin tiers)
- Rate limiting per real client IP (anonymous) or API key
- Health checks & status endpoint
- 90-day uptime history (status page)
- Service discovery & routing
- Outbound webhooks (connector polling + per-event filters)

## Endpoints

### Public Routes (no auth required)

- `POST /v1/auth/register` — Create account
- `POST /v1/auth/login` — Login
- `POST /v1/auth/forgot-password` — Request password reset email
- `POST /v1/auth/reset-password` — Reset password with email token
- `POST /v1/auth/refresh` — Refresh token
- `DELETE /v1/auth/account` — Delete account
- `GET /v1/status` — Live system status
- `GET /v1/status/history?days=90` — Daily uptime (max 365 days, Europe/Lisbon)
- `GET /v1/status/incidents?days=90` — Degraded/down incidents in the window
- `GET /v1/webhooks/events` — Supported webhook events, filters and lookup-only services

### Protected Routes

- `GET /v1/auth/profile` — User profile
- `GET /v1/auth/me` — User details
- `POST /v1/auth/api-key` — Generate API key
- `POST /v1/auth/api-key/refresh` — Rotate API key
- `DELETE /v1/auth/api-key` — Delete API key
- All `/v1/*` service routes (fuel, ipma, base, ev, ine, anpc, bdp, geo, nif, prr, dre, nasafirms, carris, gtfs, parlamento, sns)
- Webhooks (JWT or `X-API-Key`): `POST/GET /v1/webhooks`, `GET/PATCH/DELETE /v1/webhooks/:id`, `POST /v1/webhooks/:id/test`, `GET /v1/webhooks/:id/deliveries`

## Rate limiting

The global limiter (`@fastify/rate-limit`) is 30 requests/minute for anonymous clients and 300/minute when `X-API-Key` is present.

Anonymous keys use `CF-Connecting-IP` (Cloudflare overwrites this header) and fall back to Fastify `req.ip`. `trustProxy` is limited to loopback (`127.0.0.1` / `::1`) so a client-supplied `X-Forwarded-For` is not trusted on a direct connection.

These credential routes are exempt from the global limiter (`allowList` in `@fastify/rate-limit` 10.x — `skip` is not a valid option). Login and register keep their own anti-spam / brute-force checks in `src/routes/auth.js`:

- `POST /v1/auth/login`
- `POST /v1/auth/register`
- `POST /v1/auth/forgot-password`
- `POST /v1/auth/reset-password`

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your settings
npm start
```

## Environment Variables

See `.env.example`.

## Services

The gateway routes to these microservices:
- **/v1/fuel** → DGEG fuel prices
- **/v1/ipma** → IPMA weather data (includes seismic endpoints)
- **/v1/base** → Public contracts (BASE)
- **/v1/ev** → EV charging prices
- **/v1/ine** → Statistics (INE/Eurostat)
- **/v1/anpc** → Civil protection alerts
- **/v1/bdp** → Banco de Portugal data
- **/v1/geo** → Geographic data (geoapi.pt)
- **/v1/nif** → NIF validator
- **/v1/prr** → PRR / PT2030
- **/v1/dre** → DRE legislation
- **/v1/nasafirms** → NASA FIRMS fire hotspots
- **/v1/carris** → Carris Metropolitana (realtime)
- **/v1/gtfs** → Transport schedules (GTFS)
- **/v1/parlamento** → Parlamento (Assembleia da República)
- **/v1/sns** → SNS Transparência

## Status history

A background job (every 60s) reuses the same health check as `GET /v1/status` and stores results in the gateway MongoDB (`MONGO_URI`, database `apiaberta-gateway`):

- `status_checks` — raw samples (TTL 95 days)
- `status_daily` — per-service daily aggregates (`date` is `YYYY-MM-DD` in `Europe/Lisbon`; no TTL)
- `status_incidents` — opened when a service becomes `down`/`degraded`, closed when it returns to `up`

Only one process runs the collector (Mongo lock), so PM2 cluster mode does not double-sample. `GET /v1/status` is unchanged: it still probes services live and does not read or write history.

Uptime is `(up + 0.5 × degraded) / checks`. History and incident endpoints are public, CORS-enabled like `/v1/status`, and sent with `Cache-Control: public, max-age=30`.

OpenAPI for these routes is published at `/docs`.

## Webhooks

The gateway polls connector HTTP endpoints every 5 minutes, diffs against `EventState` (seen ids / hashes) and queues HMAC-signed POSTs to subscribed URLs. Connectors do not push events into the gateway. The first observation of each state key is stored without dispatch, so a restart does not replay the current snapshot.

`GET /v1/nif` and `GET /v1/geo` are lookup-only (no events). `/v1/contracts` is an alias of `/v1/base` — subscribe to `base.contract.new`.

Per-event filters live on the webhook document (`filters: { [eventName]: { [key]: value | value[] } }`). Location is an INE enum (name/slug/code in, code stored). Same-key values are OR; keys are AND. Aggregated events such as `fuel.prices.updated` send national averages unless a local filter is set, in which case only matching stations are delivered (or the event is skipped).

See [docs/webhooks.md](docs/webhooks.md) for the event catalogue, payload headers and filter contract.

## License

MIT
