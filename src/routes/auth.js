import { nanoid } from 'nanoid'
import { Developer } from '../db.js'

export async function authRoutes(app) {

  // POST /v1/auth/register
  // Body: { email, name? }
  // Returns: { apiKey, tier, message }
  app.post('/register', {
    schema: {
      description: 'Register a new developer account and receive an API key',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
          name:  { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            apiKey:   { type: 'string' },
            tier:     { type: 'string' },
            message:  { type: 'string' }
          }
        }
      }
    }
  }, async (req, reply) => {
    const { email, name } = req.body

    // Return existing key if developer already registered
    const existing = await Developer.findOne({ email })
    if (existing) {
      return {
        apiKey: existing.apiKey,
        tier: existing.tier,
        message: 'Welcome back! Here is your existing API key.'
      }
    }

    const apiKey = `ak_${nanoid(32)}`
    await Developer.create({ email, name, apiKey })

    reply.code(201)
    return {
      apiKey,
      tier: 'free',
      message: 'Account created. Keep your API key safe - it will not be shown again.'
    }
  })

  // GET /v1/auth/me  (requires X-API-Key)
  app.get('/me', {
    schema: {
      description: 'Get current developer account info and usage',
      tags: ['Auth'],
      security: [{ apiKey: [] }]
    }
  }, async (req, reply) => {
    if (!req.developer) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
    return {
      email: req.developer.email,
      name:  req.developer.name,
      tier:  req.developer.tier,
      apiKey: req.developer.apiKey,
      createdAt: req.developer.createdAt
    }
  })
}
