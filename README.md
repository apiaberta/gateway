# API Aberta — Gateway

Central API gateway for the API Aberta platform. Handles authentication, rate limiting, and routes requests to microservices.

## Features

- JWT authentication
- API key management (free/pro/admin tiers)
- Rate limiting per tier
- Health checks & status endpoint
- Service discovery & routing

## Endpoints

### Public Routes (no auth required)

- `POST /v1/auth/register` — Create account
- `POST /v1/auth/login` — Login
- `POST /v1/auth/refresh` — Refresh token
- `DELETE /v1/auth/account` — Delete account
- `GET /v1/status` — System status

### Protected Routes

- `GET /v1/auth/profile` — User profile
- `GET /v1/auth/me` — User details
- `POST /v1/auth/api-key` — Generate API key
- `POST /v1/auth/api-key/refresh` — Rotate API key
- `DELETE /v1/auth/api-key` — Delete API key
- All `/v1/*` service routes (fuel, ipma, base, ev, ine, anpc, bdp, geo)

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
- **/v1/ipma** → IPMA weather data
- **/v1/base** → Public contracts (BASE)
- **/v1/ev** → EV charging prices
- **/v1/ine** → Statistics (INE/Eurostat)
- **/v1/anpc** → Civil protection alerts
- **/v1/bdp** → Banco de Portugal data
- **/v1/geo** → Geographic data (geoapi.pt)

## License

MIT
