# Webhooks

Outbound notifications from the API Aberta gateway. The developer portal and any HTTPS endpoint can subscribe with JWT or `X-API-Key`.

## How events are produced

The gateway does **not** receive POSTs from connectors and does not use Mongo change streams. A worker (`src/plugins/webhook-worker.js` + `src/webhooks/poll.js`):

1. Every **5 minutes**, GETs the public connector routes (same paths the gateway already proxies, without `/v1`). A Mongo lease (`webhook-poll`, 5 min) plus an in-process guard prevent overlapping polls.
2. Diffs the response against `EventState` in the gateway MongoDB (`ids` already seen, or a SHA-256 of a snapshot).
3. On the **first** observation of a key, stores the snapshot and **does not** dispatch — a process start must not replay everything that is currently true.
4. For genuinely new ids / changed hashes, creates `WebhookDelivery` rows (`pending`) for each matching active webhook. The envelope `timestamp` is stored on the row and reused on retries.
5. Every **1 minute**, delivers pending rows under a 60 s lease. Each row is claimed atomically (`pending` → `sending`) before POST. HTTPS POST, HMAC-SHA256, up to 3 attempts (30s / 120s backoff). Redirects (3xx) are **not** followed and count as failure.

Dev and tests never use the production database: unit tests spin up `mongodb-memory-server-core`.

## HTTP API

| Method | Path | Auth | Body |
| --- | --- | --- | --- |
| GET | `/v1/webhooks/events` | public | — |
| POST | `/v1/webhooks` | JWT or `X-API-Key` | `{ url, events, filters? }` |
| GET | `/v1/webhooks` | JWT or `X-API-Key` | — |
| GET | `/v1/webhooks/:id` | JWT or `X-API-Key` | — |
| PATCH | `/v1/webhooks/:id` | JWT or `X-API-Key` | `{ url?, events?, filters?, active? }` |
| DELETE | `/v1/webhooks/:id` | JWT or `X-API-Key` | deactivates |
| POST | `/v1/webhooks/:id/test` | JWT or `X-API-Key` | test ping |
| GET | `/v1/webhooks/:id/deliveries` | JWT or `X-API-Key` | last 20 attempts |

`url` must be `https://`. Max 10 active webhooks per account. The signing secret (`whsec_…`) is returned **once** on POST.

`GET /v1/webhooks` and `GET /v1/webhooks/:id` include `filters` and `active`.

`GET /v1/webhooks/events` is cached for 1 hour (`Cache-Control: public, max-age=3600` + `ETag`). Each event has `geo_precision` (`municipality` | `district` | `coordinates` | `none`). Each filter has `type`, `multiple`, and when relevant `precision`, `free_text`, `options` or `options_source`. Large geo lists are not inlined: `options_source` is `/v1/geo/municipalities` or `/v1/geo/districts`. The payload also has `refs.municipalities` and `refs.districts` for comboboxes.

### Filters

Stored on the webhook as `{ [eventName]: { [filterKey]: value | value[] } }`. An event with no entry (or an empty object) receives everything.

Keys are **AND**. Several values for the same key are **OR**. Enums match **exactly** on the canonical code (no substring). Input still accepts a name, slug or code; the gateway **always stores the code**.

```json
{
  "url": "https://example.com/hooks/apiaberta",
  "events": ["base.contract.new", "fuel.prices.updated", "ipma.warning.new"],
  "filters": {
    "base.contract.new": { "municipality": "0504", "valor_min": 50000 },
    "fuel.prices.updated": { "municipality": "0504", "fuel": ["diesel", "gasoline_95"] },
    "ipma.warning.new": { "municipality": "0504", "min_level": "yellow" }
  }
}
```

`0504` is Fundão. `"Fundão"` and `"fundao"` are accepted on POST/PATCH and stored as `"0504"`. Ambiguous names (`Lagoa`, `Calheta` without a district) return 400 with suggestions.

Legacy keys `local` and `concelho` are accepted for 90 days and converted to `municipality`. Convert stored rows with:

```bash
npm run migrate:webhook-filters          # dry-run (default)
npm run migrate:webhook-filters -- --apply
```

Do **not** run `--apply` against production from a laptop. Ops should use `--apply` (and `--allow-remote` only on an approved run).

`gte` / `lte` compare numbers. `prefix` (CPV) matches the leading digits of the code. `min_level` is green < yellow < orange < red. `radius` is `{ "lat": 40.14, "lon": -7.50, "km": 25 }`.

Aggregated events (`fuel.prices.updated`, `bdp.rates.updated`, `ev.tariffs.updated`, `prr.catalogue.updated`): when a record-level / local filter is set, the payload is **only** the matching records. If none match, that webhook is not called.

Remaining **free-text** filters are labelled `free_text: true` in the catalogue (`dre.diploma.new.q`, `anpc.warning.new.text`, `carris.alert.new.q`). They can miss.

### Delivery envelope

```http
POST /hooks/apiaberta
Content-Type: application/json
X-ApiAberta-Event: base.contract.new
X-ApiAberta-Delivery: <Mongo delivery _id>
X-ApiAberta-Timestamp: <unix seconds>
X-ApiAberta-Signature: sha256=<hex of raw body>
X-ApiAberta-Signature-V2: t=<unix>,v1=<hex of unix + "." + body>
User-Agent: ApiAberta-Webhooks/1.0
```

```json
{
  "event": "base.contract.new",
  "timestamp": "2026-11-27T08:00:00.000Z",
  "data": {
    "id": "16006168",
    "local": "Portugal, Lisboa, Amadora",
    "municipality_codes": ["1115"],
    "district_codes": ["11"],
    "value": 625000.25
  }
}
```

Test deliveries (`POST /v1/webhooks/:id/test`) use the **same** envelope, plus `"test": true`. `X-ApiAberta-Delivery` is the `_id` returned as `deliveryId`. Redirects are not followed.

`timestamp` in the JSON body is ISO-8601 and is **fixed per delivery** (retries reuse it). `X-ApiAberta-Timestamp` is the same instant as unix seconds.

### Signature verification

Keep verifying **v1** during the transition; prefer **v2** (it covers the timestamp).

```js
import { createHmac, timingSafeEqual } from 'crypto'

function hexHmac(secret, value) {
  return createHmac('sha256', secret).update(value).digest('hex')
}

function check(a, b) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function verifyApiAbertaSignature({ headers, rawBody, secret }) {
  const unix = String(headers['x-apiaberta-timestamp'] || '')
  const v2 = String(headers['x-apiaberta-signature-v2'] || '')
  const match = v2.match(/^t=(\d+),v1=([0-9a-f]+)$/i)
  if (match && match[1] === unix) {
    const expected = hexHmac(secret, `${unix}.${rawBody}`)
    if (check(expected, match[2].toLowerCase())) return 'v2'
  }

  const v1 = String(headers['x-apiaberta-signature'] || '').replace(/^sha256=/, '')
  const expectedV1 = hexHmac(secret, rawBody)
  if (v1 && check(expectedV1, v1.toLowerCase())) return 'v1'
  return null
}
```

Reject the delivery if neither version matches. Optionally also reject if `|now - unix|` is greater than 5 minutes.

## Event catalogue

`GET /v1/webhooks/events` is the source of truth. Summary:

| Event | Service | When | Main filters |
| --- | --- | --- | --- |
| `fuel.prices.updated` | `/v1/fuel` | DGEG daily snapshot date changes. National averages, or stations if `district` / `municipality` / `brand` is set. Without `fuel`, **all** connector fuel types are fetched. | district, municipality (INE), fuel, brand (enums) |
| `ipma.warning.new` | `/v1/ipma` | New warning, stable id = area + type + level + canonical dates. Greens are **not** sent unless `level`/`min_level` asks for them. `municipality` maps to the district IPMA area (`0504` → `CBO`, `precision: "distrito"`). | region, municipality, level, min_level, type |
| `ipma.seismic.new` | `/v1/ipma` | New earthquake id. Concelho from lat/lon. | region, municipality, radius `{lat,lon,km}`, min_magnitude |
| `anpc.incident.new` | `/v1/anpc` | New occurrence (active list is paginated past 20). | district, municipality, natureza (`type_code`) |
| `anpc.incident.updated` | `/v1/anpc` | Status change or incident end. | same as `.new` |
| `anpc.warning.new` | `/v1/anpc` | New road / civil-protection warning | text (`free_text`) |
| `base.contract.new` | `/v1/base` | New BASE contract. Poller pages by `synced_at` / id (cap 5000) and also queries subscribed municipalities. | municipality, district, nif_entidade (MOD 11), cpv (prefix), valor_min |
| `ev.prices.updated` | `/v1/ev` | OMIE period changes | min_price_eur_mwh |
| `ev.tariffs.updated` | `/v1/ev` | CEME tariff catalogue hash changes | ceme (enum) |
| `ine.indicator.updated` | `/v1/ine` | Indicator year/value changes | indicator |
| `bdp.rates.updated` | `/v1/bdp` | BdP/BCE rate snapshot changes | key |
| `dre.diploma.new` | `/v1/dre` | New diploma id. Payload includes `summary` and `emitter`. Series is `I` / `II` (input still accepts `1` / `2`). | series, type, q (`free_text`), emitter_municipality (heuristic) |
| `nasafirms.fire.new` | `/v1/nasafirms` | New FIRMS hotspot. Concelho from coordinates (geoapi.pt reverse geocode, cached; centroid fallback). | source, municipality, radius, min_frp |
| `carris.alert.new` | `/v1/carris` | New Carris Metropolitana alert | line (`^\d{4}$`), effect, q (`free_text`) |
| `gtfs.changes.new` | `/v1/gtfs` | New GTFS ingest diff | feed_id |
| `parlamento.iniciativa.new` | `/v1/parlamento` | New initiative | tipo, gp, estado (enums) |
| `parlamento.votacao.new` | `/v1/parlamento` | New vote | resultado, gp |
| `sns.dataset.updated` | `/v1/sns` | Dataset `last_changed` / period changes | dataset (`regiao` removed — it never matched) |
| `prr.catalogue.updated` | `/v1/prr` | PRR catalogue hash changes | component |
| `pt2030.summary.updated` | `/v1/pt2030` | PT2030 summary payload changes | — |

### Lookup-only (no events)

| Service | Why |
| --- | --- |
| `/v1/nif` | On-demand NIF checksum and VIES lookup. No feed of new records. |
| `/v1/geo` | Static administrative geography. Source of INE codes for webhook filters. |
| `/v1/contracts` | Alias of `/v1/base`. Use `base.contract.new`. |

## Connector limitations

These events are implemented in the gateway against the current connector HTTP APIs. Some upstream payloads are thin; improving them requires connector-repo changes (not done here):

- **connector-dre** — `GET /dre/latest` and `GET /dre/legislation` currently return a message instead of a diploma list (`screenservice` access) in some environments. `dre.diploma.new` will start firing once those routes return `{ data: [{ id, … }] }`.
- **connector-prr / pt2030** — public API is a static component catalogue and a PT2030 blurb, not individual projects or payments. `prr.catalogue.updated` / `pt2030.summary.updated` fire only if that JSON changes.
- **connector-base** — `synced_after` is not honoured today; the gateway paginates `limit=100` up to 5000 rows and also queries `?local=` for subscribed municipalities. A connector cursor on `synced_at` would be the durable fix.
- **connector-ev** — `GET /ev/omie/current` can be empty overnight; the poller falls back to `/ev/omie/today`.
- **connector-nasafirms** — winter windows can be empty; the first non-empty snapshot is seeded without dispatch. Concelho is resolved in the gateway (geoapi.pt `/gps/{lat},{lon}`, same source as `/v1/geo`).
