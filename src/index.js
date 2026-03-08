import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { connectDB } from './db.js'
import { authRoutes } from './routes/auth.js'
import { proxyRoutes } from './routes/proxy.js'
import { adminRoutes } from './routes/admin.js'
import { statusRoutes } from './routes/status.js'
import { authenticate } from './plugins/authenticate.js'
import { sanitizePlugin } from './plugins/sanitize.js'
import { config } from './config.js'

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty' }
      : undefined
  }
})

// Security headers
await app.register(helmet, {
  contentSecurityPolicy: false // allow Swagger UI to load
})

// CORS
await app.register(cors, { origin: true })

// Rate limiting — 30 req/min for unauthenticated IPs, 300 for API key holders
await app.register(rateLimit, {
  global: true,
  max: (req) => req.headers['x-api-key'] ? 300 : 30,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.headers['x-api-key'] || req.ip,
  errorResponseBuilder: () => ({
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Upgrade your plan at apiaberta.pt',
    statusCode: 429
  })
})

// MongoDB injection protection
await app.register(sanitizePlugin)

await app.register(swagger, {
  openapi: {
    info: {
      title: 'API Aberta',
      description: 'Unified REST API for Portuguese public data',
      version: '1.0.0'
    },
    components: {
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' }
      }
    },
    security: [{ apiKey: [] }]
  }
})

await app.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: { deepLinking: true }
})

// Public routes (no auth required)
await app.register(authRoutes, { prefix: '/v1/auth' })
await app.register(statusRoutes, { prefix: '/v1' })

// Healthcheck (public)
app.get('/health', async () => ({ status: 'ok', version: '0.2.0' }))

// Protected routes (API key required)
app.addHook('onRequest', authenticate)

await app.register(proxyRoutes, { prefix: '/v1' })
await app.register(adminRoutes, { prefix: '/v1/admin' })

// Connect DB and start
await connectDB()
await app.listen({ port: config.port, host: '0.0.0.0' })
