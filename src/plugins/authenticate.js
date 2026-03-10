import { Developer, UsageLog } from '../db.js'
import { config } from '../config.js'

// Routes that don't require an API key
const PUBLIC_ROUTES = [
  '/health',
  '/docs',
  '/v1/auth/register',
  '/v1/auth/login',
  '/v1/auth/forgot-password',
  '/v1/auth/usage',
  '/v1/auth/me',
  '/v1/status',
  '/v1/fuel',
  '/v1/ipma',
  '/v1/base',
  '/v1/ev',
  '/v1/ine',
  '/v1/anpc',
  '/v1/bdp'
]

export async function authenticate(req, reply) {
  // Skip auth for public routes
  if (PUBLIC_ROUTES.some(r => req.url.startsWith(r))) return

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

  // Attach developer to request
  req.developer = developer

  // Apply tier-specific rate limit override
  const limits = config.tiers[developer.tier]
  reply.header('X-RateLimit-Tier', developer.tier)
  reply.header('X-RateLimit-Limit', limits.rpm)

  // Log usage asynchronously (don't block the request)
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
