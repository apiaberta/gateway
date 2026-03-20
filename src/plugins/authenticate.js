import jwt from 'jsonwebtoken'
import { Developer, UsageLog } from '../db.js'
import { config } from '../config.js'

// Routes that don't require an API key
const PUBLIC_ROUTES = [
  '/health',
  '/docs',
  '/v1/auth/register',
  '/v1/auth/login',
  '/v1/auth/forgot-password',
  '/v1/auth/reset-password',
  '/v1/auth/usage',
  '/v1/auth/me',
  '/v1/auth/rotate-key',
  '/v1/auth/profile',
  '/v1/auth/account',
  '/v1/status',
  '/v1/fuel',
  '/v1/ipma',
  '/v1/base',
  '/v1/ev',
  '/v1/ine',
  '/v1/anpc',
  '/v1/bdp',
  '/v1/webhooks/events',
  '/v1/contracts',
  '/v1/stats',
  '/v1/geo'
]

export async function authenticate(req, reply) {
  // Skip auth for public routes
  if (PUBLIC_ROUTES.some(r => req.url.startsWith(r))) return

  // Try Bearer JWT first (used by the dev portal frontend)
  const authHeader = req.headers['authorization']
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), config.jwtSecret)
      const developer = await Developer.findById(payload.id)
      if (!developer || !developer.active) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' })
      }
      req.developer = developer
      const limits = config.tiers[developer.tier]
      reply.header('X-RateLimit-Tier', developer.tier)
      reply.header('X-RateLimit-Limit', limits.rpm)
      return
    } catch {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' })
    }
  }

  // Fall back to API key
  const apiKey = req.headers['x-api-key']

  if (!apiKey) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Missing X-API-Key header. Get your free key at apiaberta.pt'
    })
  }

  const developer = await Developer.findOne({ apiKey, active: true })

  if (!developer) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid or inactive API key'
    })
  }

  req.developer = developer

  const limits = config.tiers[developer.tier]
  reply.header('X-RateLimit-Tier', developer.tier)
  reply.header('X-RateLimit-Limit', limits.rpm)

  setImmediate(async () => {
    try {
      await UsageLog.create({
        apiKey,
        endpoint: req.url,
        method: req.method,
        ip: req.ip
      })
    } catch { /* non-critical */ }
  })
}
