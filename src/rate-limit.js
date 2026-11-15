import { getClientIp } from './client-ip.js'

// Unauthenticated credential endpoints. @fastify/rate-limit 10.x uses
// allowList (not skip) to exempt requests from the global limiter.
export const AUTH_RATE_LIMIT_EXEMPT_PATHS = [
  '/v1/auth/login',
  '/v1/auth/register',
  '/v1/auth/forgot-password',
  '/v1/auth/reset-password'
]

export function isAuthRateLimitExempt(url = '') {
  const path = String(url).split('?')[0]
  return AUTH_RATE_LIMIT_EXEMPT_PATHS.some(
    (route) => path === route || path.startsWith(`${route}/`)
  )
}

export function rateLimitKey(req) {
  const apiKey = req?.headers?.['x-api-key']
  if (typeof apiKey === 'string' && apiKey) return apiKey
  if (Array.isArray(apiKey) && apiKey[0]) return apiKey[0]
  return getClientIp(req)
}

export const rateLimitConfig = {
  global: true,
  max: (req) => req.headers['x-api-key'] ? 300 : 30,
  timeWindow: '1 minute',
  keyGenerator: rateLimitKey,
  allowList: (req) => isAuthRateLimitExempt(req.url),
  errorResponseBuilder: () => ({
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Upgrade your plan at apiaberta.pt',
    statusCode: 429
  })
}
