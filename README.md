# API Aberta - Gateway

The public entry point for all API Aberta services. Handles authentication, rate limiting, routing and usage tracking.

## Architecture

```
Client Request
    │
    ▼
[Gateway :3000]
    │  - Validates X-API-Key
    │  - Applies rate limits per tier
    │  - Logs usage to MongoDB
    │  - Strips API key before forwarding
    │
    ├──→ /v1/fuel/*        → fuel-service :3001
    ├──→ /v1/contracts/*   → contracts-service :3002
    ├──→ /v1/statistics/*  → statistics-service :3003
    └──→ /v1/legislation/* → legislation-service :3004
```

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

Interactive docs available at `http://localhost:3000/docs`

## API Key tiers

| Tier  | Requests/min | Requests/day |
|-------|-------------|-------------|
| Free  | 60          | 1,000       |
| Pro   | 600         | 10,000      |
| Admin | 6,000       | 100,000     |

## Endpoints

### Public (no API key required)
- `GET /health` - service health check
- `GET /docs` - interactive Swagger documentation
- `POST /v1/auth/register` - register and get an API key

### Authenticated
- `GET /v1/auth/me` - current account info
- `GET /v1/fuel/*` - fuel price data
- `GET /v1/contracts/*` - public procurement data
- `GET /v1/statistics/*` - national statistics
- `GET /v1/legislation/*` - official gazette

### Admin only
- `GET /v1/admin/developers` - list all developers
- `PATCH /v1/admin/developers/:id/tier` - change tier
- `DELETE /v1/admin/developers/:id` - deactivate account
- `GET /v1/admin/usage` - usage statistics

## Environment variables

See `.env.example` for all configuration options.

## Adding a new service

1. Deploy the service (see [service-template](https://github.com/apiaberta/service-template))
2. Add the service URL to `.env`:
   ```
   MY_SERVICE_URL=http://my-service:3005
   ```
3. Register the route in `src/config.js`:
   ```js
   { prefix: '/my-service', target: process.env.MY_SERVICE_URL }
   ```
4. Restart the gateway
