import { config } from '../config.js'
import { getCached, setCached, getTtl } from '../plugins/cache.js'

/**
 * Connectors expose their own prefix (e.g. /carris/vehicles) and /health,
 * not /v1/.... Strip the gateway /v1 prefix before forwarding.
 */
export function buildConnectorUrl(target, requestUrl) {
  const connectorPath = rewritePublicPath(requestUrl).replace(/^\/v1/, '')
  return `${target}${connectorPath}`
}

/**
 * Public aliases advertised by older llms.txt / SDK samples.
 * /v1/ipma/forecast → /v1/ipma/forecasts (does not rewrite /forecasts).
 */
export function rewritePublicPath(requestUrl) {
  return requestUrl.replace(
    /^(\/v1)?\/ipma\/forecast(?=\/|\?|$)/,
    (_, prefix) => `${prefix || ''}/ipma/forecasts`
  )
}

/**
 * Cloudflare (or other HTML) 5xx pages should not leak to API clients.
 */
export function isOpaqueUpstreamError(status, body, contentType = '') {
  if (status < 500) return false
  const text = String(body || '')
  const type = String(contentType || '')
  if (type.includes('text/html')) return true
  return (
    text.includes('developers.cloudflare.com') ||
    text.includes('cf-error') ||
    text.includes('Error 502: Bad gateway') ||
    text.includes('<html')
  )
}

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
      // Cache key: method + rewritten public URL (aliases share the same entry)
      const publicUrl = rewritePublicPath(req.url)
      const cacheKey = `${req.method}:${publicUrl}`

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
      const connectorUrl = buildConnectorUrl(target, publicUrl)

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

      if (isOpaqueUpstreamError(upstream.status, responseBody, contentType)) {
        app.log.error({ connectorUrl, status: upstream.status }, 'Opaque upstream error')
        return reply.code(502).send({
          error: 'Bad Gateway',
          message: 'Upstream service unavailable',
          service: prefix.replace('/', '')
        })
      }

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
