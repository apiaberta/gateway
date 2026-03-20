import { nanoid } from 'nanoid'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { Developer, UsageLog, PasswordReset } from '../db.js'
import { config } from '../config.js'
import { sendPasswordResetEmail } from '../services/email.service.js'

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

    // Cancel pending deletion if user logs in
    if (dev.deletionRequestedAt) {
      dev.deletionRequestedAt = null
      dev.deletionScheduledFor = null
      await dev.save()
    }
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
    const apiKey = req.headers['x-api-key']
    if (!apiKey) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'API key required' })
    }

    const dev = await Developer.findOne({ apiKey, active: true })
    if (!dev) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid API key' })
    }

    return {
      name:      dev.name,
      email:     dev.email,
      tier:      dev.tier,
      apiKey:    dev.apiKey,
      createdAt: dev.createdAt
    }
  })

  // GET /v1/auth/usage — developer's own usage stats
  app.get('/usage', {
    schema: {
      description: 'Your API usage stats for the last 30 days',
      tags: ['Auth'],
      security: [{ apiKey: [] }]
    }
  }, async (req, reply) => {
    const apiKey = req.headers['x-api-key']
    if (!apiKey) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'API key required' })
    }

    const dev = await Developer.findOne({ apiKey, active: true })
    if (!dev) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid API key' })
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    
    const [total, last30d, byEndpoint] = await Promise.all([
      UsageLog.countDocuments({ apiKey }),
      UsageLog.countDocuments({ apiKey, timestamp: { $gte: thirtyDaysAgo } }),
      UsageLog.aggregate([
        { $match: { apiKey, timestamp: { $gte: thirtyDaysAgo } } },
        { $group: { _id: '$endpoint', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
    ])

    return {
      total_requests: total,
      last_30_days:   last30d,
      top_endpoints:  byEndpoint.map(e => ({ endpoint: e._id, requests: e.count }))
    }
  })

  // POST /v1/auth/rotate-key — generate a new API key (requires JWT)
  app.post('/rotate-key', {
    schema: {
      description: 'Rotate your API key. The old key is immediately invalidated.',
      tags: ['Auth'],
      security: [{ bearerAuth: [] }]
    }
  }, async (req, reply) => {
    const authHeader = req.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Bearer token required' })
    }

    let dev
    try {
      const payload = jwt.verify(authHeader.slice(7), config.jwtSecret)
      dev = await Developer.findById(payload.id)
      if (!dev || !dev.active) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or inactive account' })
      }
    } catch {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' })
    }

    const newKey = `ak_${nanoid(32)}`
    dev.apiKey = newKey
    await dev.save()

    return {
      apiKey:  newKey,
      message: 'API key rotated successfully. Update your applications immediately.'
    }
  })

  // PATCH /v1/auth/profile — update name and/or password (requires JWT)
  app.patch('/profile', {
    schema: {
      description: 'Update your profile name and/or password',
      tags: ['Auth'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          name:            { type: 'string', minLength: 2, maxLength: 100 },
          currentPassword: { type: 'string' },
          newPassword:     { type: 'string', minLength: 8 }
        }
      }
    }
  }, async (req, reply) => {
    const authHeader = req.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Bearer token required' })
    }

    let dev
    try {
      const payload = jwt.verify(authHeader.slice(7), config.jwtSecret)
      dev = await Developer.findById(payload.id)
      if (!dev || !dev.active) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or inactive account' })
      }
    } catch {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' })
    }

    const { name, currentPassword, newPassword } = req.body || {}

    if (name) {
      dev.name = name.trim()
    }

    if (newPassword) {
      if (!currentPassword) {
        return reply.code(400).send({ error: 'Bad Request', message: 'currentPassword is required to change your password' })
      }
      const valid = await bcrypt.compare(currentPassword, dev.passwordHash)
      if (!valid) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Current password is incorrect' })
      }
      dev.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS)
    }

    await dev.save()

    return {
      name:    dev.name,
      email:   dev.email,
      tier:    dev.tier,
      message: 'Profile updated successfully'
    }
  })

  // POST /v1/auth/forgot-password — request password reset email
  app.post('/forgot-password', {
    schema: {
      description: 'Request a password reset link',
      tags: ['Auth'],
      body: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } }
    }
  }, async (req, reply) => {
    const { email } = req.body
    
    // Always return success to avoid email enumeration
    const successResponse = { message: 'If an account exists for this email, a reset link has been sent.' }

    try {
      const dev = await Developer.findOne({ email: email.toLowerCase(), active: true })
      if (!dev) {
        return successResponse
      }

      // Invalidate any existing tokens for this email
      await PasswordReset.updateMany({ email: dev.email, used: false }, { used: true })

      // Generate new token
      const token = nanoid(64)
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

      await PasswordReset.create({
        email: dev.email,
        token,
        expiresAt
      })

      // Send email (async, don't wait)
      sendPasswordResetEmail(dev.email, token).catch(err => {
        console.error('Failed to send password reset email:', err)
      })

    } catch (err) {
      console.error('Forgot password error:', err)
    }

    return successResponse
  })

  // POST /v1/auth/reset-password — reset password with token
  app.post('/reset-password', {
    schema: {
      description: 'Reset password using token from email',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['token', 'newPassword'],
        properties: {
          token:       { type: 'string', minLength: 32 },
          newPassword: { type: 'string', minLength: 8 }
        }
      }
    }
  }, async (req, reply) => {
    const { token, newPassword } = req.body

    const reset = await PasswordReset.findOne({ 
      token, 
      used: false, 
      expiresAt: { $gt: new Date() } 
    })

    if (!reset) {
      return reply.code(400).send({ 
        error: 'Bad Request', 
        message: 'Invalid or expired reset token. Please request a new one.' 
      })
    }

    const dev = await Developer.findOne({ email: reset.email, active: true })
    if (!dev) {
      return reply.code(400).send({ 
        error: 'Bad Request', 
        message: 'Account not found or inactive.' 
      })
    }

    // Update password
    dev.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS)
    await dev.save()

    // Mark token as used
    reset.used = true
    await reset.save()

    return { 
      message: 'Password reset successfully. You can now log in with your new password.' 
    }
  })
}

  // DELETE /v1/auth/account — marca conta para eliminação em 30 dias
  app.delete('/account', {
    schema: {
      description: 'Request account deletion (30-day grace period)',
      tags: ['Auth'],
      security: [{ bearerAuth: [] }]
    }
  }, async (req, reply) => {
    const authHeader = req.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Bearer token required' })
    }

    let dev
    try {
      const payload = jwt.verify(authHeader.slice(7), config.jwtSecret)
      dev = await Developer.findById(payload.id)
      if (!dev || !dev.active) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or inactive account' })
      }
    } catch {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' })
    }

    const now = new Date()
    const deletionDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    
    dev.deletionRequestedAt = now
    dev.deletionScheduledFor = deletionDate
    await dev.save()

    return {
      message: 'Conta marcada para eliminação. Tens 30 dias para cancelar fazendo login.',
      deletionScheduledFor: deletionDate.toISOString()
    }
  })
