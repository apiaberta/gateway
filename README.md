# API Aberta — Gateway

Ponto de entrada público de todos os serviços da API Aberta. Gere autenticação, rate limiting, routing e logging de uso.

## Arquitectura

```
api.apiaberta.pt (nginx :443)
         │
         ▼
  Gateway :4000 (PM2)
         │
         ├──→ /v1/fuel/*        → connector-fuel :3001   ✅ Live
         ├──→ /v1/contracts/*   → connector-base :3002   🔲 Planned
         ├──→ /v1/statistics/*  → connector-ine :3003    🔲 Planned
         └──→ /v1/legislation/* → connector-dre :3004    🔲 Planned
```

**VPS:** 167.99.216.205  
**Stack:** Node.js 22 + Fastify 5 + MongoDB 7 + PM2 + nginx

## Quick Start (dev)

```bash
npm install
cp .env.example .env
npm run dev
# → http://localhost:3000/docs
```

## Deploy (produção)

```bash
# No VPS
cd /root/.openclaw/workspace/gateway
pm2 start ecosystem.config.cjs
pm2 save

# Logs
pm2 logs apiaberta-gateway

# Restart
pm2 restart apiaberta-gateway
```

O `ecosystem.config.cjs` define `PORT=4000`. O nginx faz reverse proxy de `api.apiaberta.pt` para `localhost:4000`.

## Tiers de API Key

| Tier  | Req/min | Req/dia |
|-------|---------|---------|
| Free  | 60      | 1.000   |
| Pro   | 600     | 10.000  |
| Admin | 6.000   | 100.000 |

## Endpoints

### Públicos (sem API key)
```
GET  /health               → healthcheck
GET  /docs                 → Swagger UI
POST /v1/auth/register     → registar e obter API key
```

### Autenticados (`X-API-Key: <key>`)
```
GET  /v1/auth/me           → info da conta
GET  /v1/fuel/*            → dados de combustíveis (DGEG)
```

### Admin only
```
GET    /v1/admin/developers         → listar todos os developers
PATCH  /v1/admin/developers/:id/tier → alterar tier
DELETE /v1/admin/developers/:id     → desactivar conta
GET    /v1/admin/usage              → estatísticas de uso
```

## Variáveis de ambiente

| Variável | Descrição | Default |
|----------|-----------|---------|
| `PORT` | Porta HTTP | `3000` (prod: `4000` via PM2) |
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017/apiaberta-gateway` |
| `JWT_SECRET` | Segredo JWT | — (obrigatório em prod) |
| `FUEL_SERVICE_URL` | URL interna do connector-fuel | `http://localhost:3001` |

## Adicionar um novo conector

1. Fazer deploy do conector (ver [service-guidelines](https://github.com/apiaberta/apiaberta/blob/main/docs/service-guidelines.md))
2. Adicionar URL ao `.env`:
   ```
   MY_SERVICE_URL=http://localhost:3005
   ```
3. Registar a rota em `src/config.js`:
   ```js
   { name: 'My Service', prefix: '/my-service', target: process.env.MY_SERVICE_URL }
   ```
4. `pm2 restart apiaberta-gateway`
