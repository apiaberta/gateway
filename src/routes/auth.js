import { nanoid } from 'nanoid'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { Developer } from '../db.js'
import { config } from '../config.js'

const SALT_ROUNDS = 10

function signToken(dev) {
  return jwt.sign(
    { id: dev._id.toString(), email: dev.email, tier: dev.tier },
    config.jwtSecret,
    { expiresIn: '30d' }
  )
}

export async function authRoutes(app) {

  // POST /v1/auth/register
  app.post('/register', {
    schema: {
      description: 'Create a developer account',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name:     { type: 'string', minLength: 2 },
          email:    { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 }
        }
      }
    }
  }, async (req, reply) => {
    const { name, email, password } = req.body

    const existing = await Developer.findOne({ email })
    if (existing) {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'An account with this email already exists. Please log in.'
      })
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)
    const apiKey = `ak_${nanoid(32)}`
    const dev = await Developer.create({ name, email, passwordHash, apiKey })

    reply.code(201)
    return {
      token:  signToken(dev),
      apiKey,
      name:   dev.name,
      email:  dev.email,
      tier:   dev.tier,
      message: 'Account created. Keep your API key safe.'
    }
  })

  // POST /v1/auth/login
  app.post('/login', {
    schema: {
      description: 'Log in to your developer account',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string', format: 'email' },
          password: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { email, password } = req.body

    const dev = await Developer.findOne({ email, active: true })
    if (!dev) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid email or password' })
    }

    const valid = await bcrypt.compare(password, dev.passwordHash)
    if (!valid) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid email or password' })
    }

    return {
      token:  signToken(dev),
      apiKey: dev.apiKey,
      name:   dev.name,
      email:  dev.email,
      tier:   dev.tier
    }
  })

  // GET /v1/auth/me  (requires JWT or API key)
  app.get('/me', {
    schema: {
      description: 'Get current account info',
      tags: ['Auth'],
      security: [{ apiKey: [] }]
    }
  }, async (req, reply) => {
    // Try JWT first
    const authHeader = req.headers['authorization']
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(authHeader.slice(7), config.jwtSecret)
        const dev = await Developer.findById(payload.id)
        if (!dev) return reply.code(404).send({ error: 'Not Found' })
        return { name: dev.name, email: dev.email, tier: dev.tier, apiKey: dev.apiKey, createdAt: dev.createdAt }
      } catch {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid token' })
      }
    }

    if (!req.developer) return reply.code(401).send({ error: 'Unauthorized' })
    const dev = req.developer
    return { name: dev.name, email: dev.email, tier: dev.tier, apiKey: dev.apiKey, createdAt: dev.createdAt }
  })

  // POST /v1/auth/forgot-password (placeholder)
  app.post('/forgot-password', {
    schema: {
      description: 'Request a password reset link',
      tags: ['Auth'],
      body: { type: 'object', required: ['email'], properties: { email: { type: 'string' } } }
    }
  }, async (req, reply) => {
    // Always return success to avoid email enumeration
    return { message: 'If an account exists for this email, a reset link has been sent.' }
  })
}
