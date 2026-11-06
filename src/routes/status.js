import { config } from '../config.js'
import { StatusDaily, StatusIncident } from '../db.js'
import {
  parseDaysParam,
  enumerateDates,
  lisbonDayStart,
  buildHistoryPayload,
  formatIncident,
  incidentOverlapsWindow
} from '../services/status-history.js'

const GATEWAY_START = Date.now()
const SHORT_CACHE = 'public, max-age=30'

export async function statusRoutes(app) {

  // GET /v1/status — live health of all registered services (PUBLIC)
  // Independent of the collector: never reads or writes status history.
  app.get('/status', {
    schema: {
      description: 'Health status of all API Aberta services',
      tags: ['Status']
    },
    config: { public: true }
  }, async () => {
    const checks = await Promise.all(
      config.services.map(svc => checkService(svc))
    )

    const allHealthy = checks.every(c => c.status === 'up')

    return {
      status:   allHealthy ? 'ok' : 'degraded',
      gateway:  {
        status:   'up',
        uptime_s: Math.floor((Date.now() - GATEWAY_START) / 1000),
        version:  config.version
      },
      services: checks,
      checked_at: new Date().toISOString()
    }
  })

  // GET /v1/status/history — 90-day (default) uptime bars from daily aggregates
  app.get('/status/history', {
    schema: {
      description: 'Historical uptime for all registered services (Europe/Lisbon calendar days)',
      tags: ['Status'],
      querystring: {
        type: 'object',
        properties: {
          days: {
            type: 'integer',
            default: 90,
            description: 'Number of calendar days to include, ending today in Europe/Lisbon (1–365; values outside that range are clamped)'
          }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            generatedAt: { type: 'string', format: 'date-time' },
            days: { type: 'integer' },
            overall: {
              type: 'object',
              properties: {
                uptime: { type: 'number', nullable: true }
              }
            },
            services: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  uptime: { type: 'number', nullable: true },
                  days: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        date: { type: 'string' },
                        uptime: { type: 'number', nullable: true },
                        checks: { type: 'integer' },
                        down: { type: 'integer' },
                        degraded: { type: 'integer' },
                        avgLatencyMs: { type: 'number', nullable: true }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    config: { public: true }
  }, async (req, reply) => {
    reply.header('Cache-Control', SHORT_CACHE)
    const days = parseDaysParam(req.query.days)
    const generatedAt = new Date()
    const dates = enumerateDates(days, generatedAt)
    const rows = await StatusDaily.find({
      date: { $gte: dates[0], $lte: dates[dates.length - 1] }
    }).lean()

    return buildHistoryPayload({
      services: config.services,
      dailyRows: rows,
      days,
      generatedAt
    })
  })

  // GET /v1/status/incidents — recent degraded/down incidents
  app.get('/status/incidents', {
    schema: {
      description: 'Recent service incidents (degraded/down) overlapping the requested window',
      tags: ['Status'],
      querystring: {
        type: 'object',
        properties: {
          days: {
            type: 'integer',
            default: 90,
            description: 'Look-back window in days (1–365; values outside that range are clamped)'
          }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            incidents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  service: { type: 'string' },
                  status: { type: 'string', enum: ['degraded', 'down'] },
                  startedAt: { type: 'string', format: 'date-time' },
                  resolvedAt: { type: 'string', format: 'date-time', nullable: true },
                  durationMin: { type: 'integer' }
                }
              }
            }
          }
        }
      }
    },
    config: { public: true }
  }, async (req, reply) => {
    reply.header('Cache-Control', SHORT_CACHE)
    const days = parseDaysParam(req.query.days)
    const now = new Date()
    const cutoff = lisbonDayStart(enumerateDates(days, now)[0])
    const docs = await StatusIncident.find({
      startedAt: { $lte: now },
      $or: [
        { resolvedAt: null },
        { resolvedAt: { $gte: cutoff } }
      ]
    }).sort({ startedAt: -1 }).lean()

    return {
      incidents: docs
        .filter(doc => incidentOverlapsWindow(doc, cutoff, now))
        .map(doc => formatIncident(doc, now))
    }
  })
}

export function serviceHealthUrl(target) {
  return `${target}/health`
}

export function classifyHealth(res, body = {}) {
  const reported = String(body?.status || '').toLowerCase()
  if (!res.ok) {
    return res.status >= 500 ? 'down' : 'degraded'
  }
  if (reported === 'degraded' || reported === 'warn') return 'degraded'
  if (reported === 'down' || reported === 'error' || reported === 'fail') return 'down'
  return 'up'
}

export async function checkService({ prefix, target, name }) {
  const label = name || prefix.replace('/', '')
  const start = Date.now()

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(serviceHealthUrl(target), {
      signal: controller.signal
    })
    clearTimeout(timeout)

    const latency = Date.now() - start
    const body = await res.json().catch(() => ({}))

    return {
      name:       label,
      prefix:     `/v1${prefix}`,
      status:     classifyHealth(res, body),
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
