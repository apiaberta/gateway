import { createHmac } from 'crypto'
import { nanoid } from 'nanoid'
import jwt from 'jsonwebtoken'
import { Developer, Webhook, WebhookDelivery } from '../db.js'
import { config } from '../config.js'

// Supported events
export const SUPPORTED_EVENTS = [
  'ipma.warning.new',
  'fuel.prices.updated',
  'anpc.incident.new'
]

// Resolve developer from JWT Bearer or API key
async function resolveDeveloper(req, reply) {
  const authHeader = req.headers['authorization']
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), config.jwtSecret)
      const dev = await Developer.findById(payload.id)
      if (!dev || !dev.active) return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid token' })
      return dev
    } catch {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid token' })
    }
  }
  const apiKey = req.headers['x-api-key']
  if (apiKey) {
    const dev = await Developer.findOne({ apiKey, active: true })
    if (!dev) return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid API key' })
    return dev
  }
  return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required (Bearer token or X-API-Key)' })
}

export async function webhookRoutes(app) {

  // POST /v1/webhooks — create subscription
  app.post('/', {
    schema: {
      description: 'Register a webhook endpoint to receive real-time event notifications',
      tags: ['Webhooks'],
      body: {
        type: 'object',
        required: ['url', 'events'],
        properties: {
          url:    { type: 'string', format: 'uri', description: 'HTTPS URL to receive webhook POSTs' },
          events: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', enum: SUPPORTED_EVENTS },
            description: `Events to subscribe to: ${SUPPORTED_EVENTS.join(', ')}`
          }
        }
      }
    }
  }, async (req, reply) => {
    const dev = await resolveDeveloper(req, reply)
    if (reply.sent) return

    const { url, events } = req.body

    // Validate URL is HTTPS
    if (!url.startsWith('https://')) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Webhook URL must use HTTPS' })
    }

    // Limit per developer: max 10 active webhooks
    const count = await Webhook.countDocuments({ apiKey: dev.apiKey, active: true })
    if (count >= 10) {
      return reply.code(429).send({ error: 'Limit Exceeded', message: 'Maximum 10 active webhooks per account' })
    }

    const secret = `whsec_${nanoid(32)}`
    const webhook = await Webhook.create({
      developerId: dev._id,
      apiKey: dev.apiKey,
      url,
      events,
      secret
    })

    reply.code(201)
    return {
      id:        webhook._id,
      url:       webhook.url,
      events:    webhook.events,
      secret,    // Only returned once at creation
      active:    webhook.active,
      createdAt: webhook.createdAt,
      note: 'Store the secret securely — it will not be shown again. Use it to verify webhook signatures.'
    }
  })

  // GET /v1/webhooks — list my subscriptions
  app.get('/', {
    schema: {
      description: 'List your webhook subscriptions',
      tags: ['Webhooks']
    }
  }, async (req, reply) => {
    const dev = await resolveDeveloper(req, reply)
    if (reply.sent) return

    const webhooks = await Webhook.find({ apiKey: dev.apiKey }).sort({ createdAt: -1 }).lean()
    return {
      count: webhooks.length,
      supported_events: SUPPORTED_EVENTS,
      data: webhooks.map(w => ({
        id:        w._id,
        url:       w.url,
        events:    w.events,
        active:    w.active,
        createdAt: w.createdAt
      }))
    }
  })

  // GET /v1/webhooks/:id — get one webhook
  app.get('/:id', {
    schema: {
      description: 'Get a specific webhook subscription',
      tags: ['Webhooks'],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    }
  }, async (req, reply) => {
    const dev = await resolveDeveloper(req, reply)
    if (reply.sent) return

    const webhook = await Webhook.findOne({ _id: req.params.id, apiKey: dev.apiKey }).lean()
    if (!webhook) return reply.code(404).send({ error: 'Not Found', message: 'Webhook not found' })

    return {
      id:        webhook._id,
      url:       webhook.url,
      events:    webhook.events,
      active:    webhook.active,
      createdAt: webhook.createdAt
    }
  })

  // DELETE /v1/webhooks/:id — deactivate webhook
  app.delete('/:id', {
    schema: {
      description: 'Delete (deactivate) a webhook subscription',
      tags: ['Webhooks'],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    }
  }, async (req, reply) => {
    const dev = await resolveDeveloper(req, reply)
    if (reply.sent) return

    const webhook = await Webhook.findOneAndUpdate(
      { _id: req.params.id, apiKey: dev.apiKey },
      { active: false },
      { new: true }
    )
    if (!webhook) return reply.code(404).send({ error: 'Not Found', message: 'Webhook not found' })

    return { message: 'Webhook deactivated', id: webhook._id }
  })

  // GET /v1/webhooks/:id/deliveries — last deliveries for a webhook
  app.get('/:id/deliveries', {
    schema: {
      description: 'Get recent webhook delivery attempts',
      tags: ['Webhooks'],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    }
  }, async (req, reply) => {
    const dev = await resolveDeveloper(req, reply)
    if (reply.sent) return

    const webhook = await Webhook.findOne({ _id: req.params.id, apiKey: dev.apiKey }).lean()
    if (!webhook) return reply.code(404).send({ error: 'Not Found', message: 'Webhook not found' })

    const deliveries = await WebhookDelivery.find({ webhookId: req.params.id })
      .sort({ createdAt: -1 }).limit(20).lean()

    return {
      webhookId: webhook._id,
      count: deliveries.length,
      data: deliveries.map(d => ({
        id:           d._id,
        event:        d.event,
        status:       d.status,
        attempts:     d.attempts,
        responseCode: d.responseCode,
        lastAttempt:  d.lastAttempt,
        createdAt:    d.createdAt
      }))
    }
  })

  // GET /v1/webhooks/events — list supported events
  app.get('/events', {
    schema: {
      description: 'List supported webhook events',
      tags: ['Webhooks']
    }
  }, async () => ({
    events: [
      {
        name: 'ipma.warning.new',
        description: 'Fired when IPMA issues a new meteorological warning',
        payload_fields: ['id', 'level', 'type', 'text', 'region', 'startTime', 'endTime']
      },
      {
        name: 'fuel.prices.updated',
        description: 'Fired when DGEG publishes new fuel price data',
        payload_fields: ['date', 'diesel_avg', 'gasoline95_avg', 'lpg_avg', 'records']
      },
      {
        name: 'anpc.incident.new',
        description: 'Fired when a new civil protection incident is reported',
        payload_fields: ['id', 'type', 'location', 'district', 'status', 'reported_at']
      }
    ]
  }))
}
