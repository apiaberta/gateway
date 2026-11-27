# Webhooks

Outbound notifications from the API Aberta gateway. The developer portal and any HTTPS endpoint can subscribe with JWT or `X-API-Key`.

## How events are produced

The gateway does **not** receive POSTs from connectors and does not use Mongo change streams. A worker (`src/plugins/webhook-worker.js` + `src/webhooks/poll.js`):

1. Every **5 minutes**, GETs the public connector routes (same paths the gateway already proxies, without `/v1`).
2. Diffs the response against `EventState` in the gateway MongoDB (`ids` already seen, or a SHA-256 of a snapshot).
3. On the **first** observation of a key, stores the snapshot and **does not** dispatch — a process start must not replay everything that is currently true.
4. For genuinely new ids / changed hashes, creates `WebhookDelivery` rows (`pending`) for each matching active webhook.
5. Every **1 minute**, delivers pending rows: HTTPS POST, HMAC-SHA256, up to 3 attempts (30s / 120s backoff).

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

### Filters

Stored on the webhook as `{ [eventName]: { [filterKey]: value } }`. An event with no entry (or an empty object) receives everything.

```json
{
  "url": "https://example.com/hooks/apiaberta",
  "events": ["base.contract.new", "fuel.prices.updated"],
  "filters": {
    "base.contract.new": { "local": "Fundão", "valor_min": 50000 },
    "fuel.prices.updated": { "municipality": "Fundão", "fuel": "diesel" }
  }
}
```

`equals` and `contains_ci` ignore case and accents (`Fundão` = `fundao`). `gte` / `lte` compare numbers. All keys for one event are AND-ed.

Aggregated events (`fuel.prices.updated`, `bdp.rates.updated`, `ev.tariffs.updated`, `prr.catalogue.updated`): when a record-level / local filter is set, the payload is **only** the matching records. If none match, that webhook is not called.

### Delivery envelope

```http
POST /hooks/apiaberta
Content-Type: application/json
X-ApiAberta-Event: base.contract.new
X-ApiAberta-Signature: sha256=<hex>
X-ApiAberta-Delivery: <id>
User-Agent: ApiAberta-Webhooks/1.0
```

```json
{
  "event": "base.contract.new",
  "timestamp": "2026-11-27T08:00:00.000Z",
  "data": { "id": "16006168", "local": "Portugal, Lisboa, Amadora", "value": 625000.25 }
}
```

Verify `X-ApiAberta-Signature` over the raw body with HMAC-SHA256 and the webhook secret.

## Event catalogue

`GET /v1/webhooks/events` is the source of truth (`name`, `description`, `payload_fields`, `service`, `label_pt`, `description_pt`, `filters[]`). Summary:

| Event | Service | When | Main filters |
| --- | --- | --- | --- |
| `fuel.prices.updated` | `/v1/fuel` | DGEG daily snapshot date changes. National averages, or stations if `district` / `municipality` / `brand` is set. | district, municipality, fuel (enum), brand |
| `ipma.warning.new` | `/v1/ipma` | New meteorological warning id | region (enum), area, level (yellow/orange/red/green), type |
| `ipma.seismic.new` | `/v1/ipma` | New earthquake id | region, min_magnitude (gte) |
| `anpc.incident.new` | `/v1/anpc` | New occurrence | district, concelho, natureza, type |
| `anpc.warning.new` | `/v1/anpc` | New road / civil-protection warning | text |
| `base.contract.new` | `/v1/base` | New BASE contract (`/v1/contracts` is the same data) | local (contains_ci), nif_entidade (equals), cpv (contains_ci), valor_min (gte) |
| `ev.prices.updated` | `/v1/ev` | OMIE period changes | min_price_eur_mwh (gte) |
| `ev.tariffs.updated` | `/v1/ev` | CEME tariff catalogue hash changes | ceme |
| `ine.indicator.updated` | `/v1/ine` | Indicator year/value changes | indicator (enum) |
| `bdp.rates.updated` | `/v1/bdp` | BdP/BCE rate snapshot changes | key (enum) |
| `dre.diploma.new` | `/v1/dre` | New diploma id from `/dre/legislation` or `/dre/latest` | series, type, q |
| `nasafirms.fire.new` | `/v1/nasafirms` | New FIRMS hotspot | source, min_frp (gte) |
| `carris.alert.new` | `/v1/carris` | New Carris Metropolitana alert | line, effect, q |
| `gtfs.changes.new` | `/v1/gtfs` | New GTFS ingest diff (not realtime service alerts) | feed_id |
| `parlamento.iniciativa.new` | `/v1/parlamento` | New initiative | tipo, gp, estado |
| `parlamento.votacao.new` | `/v1/parlamento` | New vote | resultado, gp |
| `sns.dataset.updated` | `/v1/sns` | Dataset `last_changed` / period changes | dataset, regiao |
| `prr.catalogue.updated` | `/v1/prr` | PRR component/investment catalogue hash changes | component |
| `pt2030.summary.updated` | `/v1/pt2030` | PT2030 summary payload changes | — |

### Lookup-only (no events)

| Service | Why |
| --- | --- |
| `/v1/nif` | On-demand NIF checksum and VIES lookup. No feed of new records. |
| `/v1/geo` | Static administrative geography. |
| `/v1/contracts` | Alias of `/v1/base`. Use `base.contract.new`. |

## Connector limitations

These events are implemented in the gateway against the current connector HTTP APIs. Some upstream payloads are thin; improving them requires connector-repo changes (not done here):

- **connector-dre** — `GET /dre/latest` and `GET /dre/legislation` currently return a message instead of a diploma list (`screenservice` access). `dre.diploma.new` will start firing once those routes return `{ data: [{ id, … }] }`.
- **connector-prr / pt2030** — public API is a static component catalogue and a PT2030 blurb, not individual projects or payments. `prr.catalogue.updated` / `pt2030.summary.updated` fire only if that JSON changes. New-project and payment events need list endpoints with stable ids.
- **connector-base** — list items often omit `cpv`. The `cpv` filter only matches when the field is present (or after a future list enrichment).
- **connector-ev** — `GET /ev/omie/current` can be empty overnight; the poller falls back to `/ev/omie/today`.
- **connector-nasafirms** — winter windows can be empty; the first non-empty snapshot is seeded without dispatch.
