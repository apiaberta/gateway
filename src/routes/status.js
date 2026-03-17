import { config } from '../config.js'

const GATEWAY_START = Date.now()

export async function statusRoutes(app) {

  // GET /v1/status — health of all registered services (PUBLIC)
  app.get('/status', {
    schema: {
      description: 'Health status of all API Aberta services',
      tags: ['Status']
    },
    config: { public: true }
  }, async (req, reply) => {
    const checks = await Promise.all(
      config.services.map(svc => checkService(svc))
    )

    const allHealthy = checks.every(c => c.status === 'up')

    return {
      status:   allHealthy ? 'ok' : 'degraded',
      gateway:  {
        status:   'up',
        uptime_s: Math.floor((Date.now() - GATEWAY_START) / 1000),
        version:  '0.3.2'
      },
      services: checks,
      checked_at: new Date().toISOString()
    }
  })
}

async function checkService({ prefix, target, name }) {
  const label = name || prefix.replace('/', '')
  const start = Date.now()

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(`${target}/health`, {
      signal: controller.signal
    })
    clearTimeout(timeout)

    const latency = Date.now() - start
    const body = await res.json().catch(() => ({}))

    return {
      name:       label,
      prefix:     `/v1${prefix}`,
      status:     res.ok ? 'up' : 'down',
      latency_ms: latency,
      version:    body.version || null,
      checked_at: new Date().toISOString()
    }
  } catch (err) {
    return {
      name:       label,
      prefix:     `/v1${prefix}`,
      status:     'down',
      latency_ms: Date.now() - start,
      error:      err.name === 'AbortError' ? 'timeout' : 'unreachable',
      checked_at: new Date().toISOString()
    }
  }
}
