import { config } from '../config.js'
import { getCached, setCached, getTtl } from '../plugins/cache.js'

/**
 * Proxy routes with in-memory caching.
 *
 * GET requests are cached per URL (not per developer) so that identical
 * public queries benefit from the same cache entry.  Authenticated requests
 * still pass X-Developer-* headers so connectors can log usage correctly.
 *
 * Response headers added:
 *   X-Cache: HIT | MISS
 *   X-Cache-Remaining: <seconds until expiry>
 *   Cache-Control: max-age=<seconds>
 */
export async function proxyRoutes(app) {
  for (const service of config.services) {
    if (!service.target) continue

    const prefix = service.prefix          // e.g. '/fuel'
    const target = service.target          // e.g. 'http://localhost:3001'
    const ttl    = getTtl(prefix)

    // Shared handler for this service — used by both the root route
    // and the wildcard route.
    const handler = async (req, reply) => {
      // Cache key: method + full request URL (includes query string)
      const cacheKey = `${req.method}:${req.url}`

      // ── Cache read (GET only) ────────────────────────────────────────────
      if (req.method === 'GET') {
        const cached = getCached(cacheKey)
        if (cached) {
          const remaining = Math.floor((cached.expires - Date.now()) / 1000)
          reply.header('X-Cache', 'HIT')
          reply.header('X-Cache-Remaining', remaining)
          reply.header('Cache-Control', `max-age=${remaining}, stale-while-revalidate=60`)
          return reply.code(cached.status).type(cached.contentType).send(cached.body)
        }
      }

      // ── Build upstream URL ───────────────────────────────────────────────
      // req.url = '/v1/fuel/stations?...' → strip '/v1' → '/fuel/stations?...'
      const connectorPath = req.url.replace(/^\/v1/, '')
      const connectorUrl  = `${target}${connectorPath}`

      // ── Forward headers ──────────────────────────────────────────────────
      const headers = { ...req.headers }
      delete headers['host']
      delete headers['x-api-key']
      delete headers['content-length'] // let fetch recalculate

      if (req.developer) {
        headers['x-developer-id']   = req.developer._id.toString()
        headers['x-developer-tier'] = req.developer.tier
      }

      // ── Upstream fetch ──────────────────────────────────────────────────
      let fetchBody
      if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
        fetchBody = JSON.stringify(req.body)
        headers['content-type'] = 'application/json'
      }

      let upstream
      try {
        upstream = await fetch(connectorUrl, {
          method: req.method,
          headers,
          body: fetchBody
        })
      } catch (err) {
        app.log.error({ err, connectorUrl }, 'Upstream fetch failed')
        return reply.code(502).send({
          error: 'Bad Gateway',
          message: 'Upstream service unavailable',
          service: prefix.replace('/', '')
        })
      }

      const contentType  = upstream.headers.get('content-type') || 'application/json'
      const responseBody = await upstream.text()

      // ── Cache write (successful GET only) ──────────────────────────────
      if (req.method === 'GET' && upstream.ok) {
        setCached(cacheKey, {
          body: responseBody,
          status: upstream.status,
          contentType
        }, ttl)
        reply.header('X-Cache', 'MISS')
        reply.header('X-Cache-Remaining', ttl)
        reply.header('Cache-Control', `max-age=${ttl}, stale-while-revalidate=60`)
      }

      return reply.code(upstream.status).type(contentType).send(responseBody)
    }

    // Register two routes per service:
    // 1. /prefix       — handles /v1/contracts?limit=3  (root, no trailing path)
    // 2. /prefix/*     — handles /v1/contracts/foo?bar  (wildcard for sub-paths)
    app.route({
      method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      url:    prefix,
      handler,
    })

    app.route({
      method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      url:    `${prefix}/*`,
      handler,
    })

    app.log.info(`Proxy: /v1${prefix} + /v1${prefix}/* → ${target} (cache ${ttl}s)`)
  }
}
