import { createHash } from 'crypto'
import { nanoid } from 'nanoid'
import jwt from 'jsonwebtoken'
import { Developer, Webhook, WebhookDelivery } from '../db.js'
import { config } from '../config.js'
import {
  LOOKUP_ONLY_SERVICES,
  SUPPORTED_EVENTS,
  publicEventCatalog,
  serializeWebhook
} from '../webhooks/catalog.js'
import { buildEnvelope, postWebhook } from '../webhooks/deliver.js'
import { publicGeoRefs } from '../webhooks/geo-ref.js'
import { WebhookValidationError, validateWebhookBody } from '../webhooks/validate.js'

export { SUPPORTED_EVENTS }

function newSigningSecret() {
  return `whsec_${nanoid(32)}`
}

const SECRET_CREATE_NOTE = 'Store the secret securely — it will not be shown again. Use it to verify webhook signatures.'
const SECRET_ROTATE_NOTE = 'Store the secret securely — it will not be shown again. The previous secret is invalid immediately. Use it to verify webhook signatures.'

const FILTERS_SCHEMA = {
  type: 'object',
  additionalProperties: {
    type: 'object',
    additionalProperties: true
  },
  description: 'Per-event filters, e.g. { "base.contract.new": { "municipality": "0504" } }. Arrays are OR; keys are AND. An event with no filters receives everything.'
}

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

function sendValidationError(reply, err) {
  if (err instanceof WebhookValidationError) {
    return reply.code(400).send({
      error: 'Bad Request',
      message: err.message,
      details: err.details.length ? err.details : undefined
    })
  }
  throw err
}

async function deliverWebhook({ webhook, event, payload, isTest = false }) {
  const timestamp = new Date()
  const delivery = await WebhookDelivery.create({
    webhookId: webhook._id,
    event,
    payload,
    timestamp,
    status: 'sending',
    attempts: 1,
    lastAttempt: timestamp
  })

  const envelope = buildEnvelope({
    event,
    timestamp: timestamp.toISOString(),
    data: payload,
    test: isTest
  })

  const result = await postWebhook({
    url: webhook.url,
    event,
    deliveryId: delivery._id,
    secret: webhook.secret,
    envelope
  })

  const status = result.ok ? 'delivered' : 'failed'
  await WebhookDelivery.updateOne({ _id: delivery._id }, {
    status,
    responseCode: result.status,
    responseBody: result.ok ? result.body : (result.body || 'Error')
  })

  return {
    deliveryId: delivery._id,
    status,
    responseCode: result.status || null,
    error: result.ok ? null : result.body
  }
}

async function ensureActiveLimit(apiKey, extraActive) {
  if (!extraActive) return
  const count = await Webhook.countDocuments({ apiKey, active: true })
  if (count >= 10) {
    const err = new WebhookValidationError('Maximum 10 active webhooks per account')
    err.statusCode = 429
    throw err
  }
}

export async function webhookRoutes(app) {
  // POST /:id/rotate-secret and /:id/test have no body; clients often still send
  // Content-Type: application/json. Treat an empty JSON body as {}.
  const jsonParser = app.getDefaultJsonParser('error', 'error')
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (body == null || body.length === 0) {
      done(null, {})
      return
    }
    jsonParser(req, body, done)
  })

  // GET /v1/webhooks/events — list supported events (static path before /:id)
  app.get('/events', {
    schema: {
      description: 'List supported webhook events, filters and lookup-only services',
      tags: ['Webhooks']
    }
  }, async (req, reply) => {
    const payload = {
      events: publicEventCatalog(),
      lookup_only: LOOKUP_ONLY_SERVICES,
      refs: publicGeoRefs()
    }
    const etag = `"${createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16)}"`
    reply.header('Cache-Control', 'public, max-age=3600')
    reply.header('ETag', etag)
    if (req.headers['if-none-match'] === etag) {
      return reply.code(304).send()
    }
    return payload
  })

  // POST /v1/webhooks — create subscription
  app.post('/', {
    schema: {
      description: 'Register a webhook endpoint to receive real-time event notifications. The signing secret is returned only in this response (top-level `secret`).',
      tags: ['Webhooks'],
      body: {
        type: 'object',
        required: ['url', 'events'],
        properties: {
          url: {
            type: 'string',
            format: 'uri',
            description: 'HTTPS URL to receive webhook POSTs'
          },
          events: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', enum: SUPPORTED_EVENTS },
            description: 'Events to subscribe to'
          },
          filters: FILTERS_SCHEMA
        }
      },
      response: {
        201: {
          type: 'object',
          required: ['id', 'url', 'events', 'filters', 'active', 'secret', 'note'],
          properties: {
            id: { type: 'string' },
            url: { type: 'string' },
            events: { type: 'array', items: { type: 'string' } },
            filters: { type: 'object', additionalProperties: true },
            active: { type: 'boolean' },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
            secret: { type: 'string', description: 'Signing secret (`whsec_…`). Returned only here and on rotate-secret.' },
            note: { type: 'string' }
          }
        }
      }
    }
  }, async (req, reply) => {
    const dev = await resolveDeveloper(req, reply)
    if (reply.sent) return

    let parsed
    try {
      parsed = validateWebhookBody(req.body, { partial: false })
      await ensureActiveLimit(dev.apiKey, true)
    } catch (err) {
      if (err instanceof WebhookValidationError && err.statusCode === 429) {
        return reply.code(429).send({ error: 'Limit Exceeded', message: err.message })
      }
      return sendValidationError(reply, err)
    }

    const secret = newSigningSecret()
    const webhook = await Webhook.create({
      developerId: dev._id,
      apiKey: dev.apiKey,
      url: parsed.url,
      events: parsed.events,
      filters: parsed.filters,
      secret,
      updatedAt: new Date()
    })

    reply.code(201)
    return {
      ...serializeWebhook(webhook),
      secret,
      note: SECRET_CREATE_NOTE
    }
  })

  // PATCH /v1/webhooks/:id — update url, events, filters, active
  app.patch('/:id', {
    schema: {
      description: 'Update a webhook subscription (url, events, filters, active)',
      tags: ['Webhooks'],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri' },
          events: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', enum: SUPPORTED_EVENTS }
          },
          filters: FILTERS_SCHEMA,
          active: { type: 'boolean' }
        }
      }
    }
  }, async (req, reply) => {
    const dev = await resolveDeveloper(req, reply)
    if (reply.sent) return

    const webhook = await Webhook.findOne({ _id: req.params.id, apiKey: dev.apiKey })
    if (!webhook) return reply.code(404).send({ error: 'Not Found', message: 'Webhook not found' })

    let parsed
    try {
      parsed = validateWebhookBody(req.body, { partial: true, current: webhook.toObject() })
      if (parsed.active && !webhook.active) {
        await ensureActiveLimit(dev.apiKey, true)
      }
    } catch (err) {
      if (err instanceof WebhookValidationError && err.statusCode === 429) {
        return reply.code(429).send({ error: 'Limit Exceeded', message: err.message })
      }
      return sendValidationError(reply, err)
    }

    webhook.url = parsed.url
    webhook.events = parsed.events
    webhook.filters = parsed.filters
    webhook.active = parsed.active
    webhook.updatedAt = new Date()
    await webhook.save()

    return serializeWebhook(webhook)
  })

  // POST /v1/webhooks/:id/rotate-secret — replace signing secret immediately
  app.post('/:id/rotate-secret', {
    schema: {
      description: 'Rotate the webhook signing secret. The previous secret is invalid immediately. The new secret is returned only in this response (top-level `secret`).',
      tags: ['Webhooks'],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: {
        200: {
          type: 'object',
          required: ['id', 'secret', 'note'],
          properties: {
            id: { type: 'string' },
            secret: { type: 'string', description: 'New signing secret (`whsec_…`). Returned only here.' },
            note: { type: 'string' }
          }
        }
      }
    }
  }, async (req, reply) => {
    const dev = await resolveDeveloper(req, reply)
    if (reply.sent) return

    const webhook = await Webhook.findOne({ _id: req.params.id, apiKey: dev.apiKey })
    if (!webhook) return reply.code(404).send({ error: 'Not Found', message: 'Webhook not found' })

    const secret = newSigningSecret()
    webhook.secret = secret
    webhook.updatedAt = new Date()
    await webhook.save()

    return {
      id: String(webhook._id),
      secret,
      note: SECRET_ROTATE_NOTE
    }
  })

  // POST /v1/webhooks/:id/test — send a test delivery
  app.post('/:id/test', {
    schema: {
      description: 'Send a test webhook delivery to verify your endpoint is working',
      tags: ['Webhooks'],
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: {
        200: {
          type: 'object',
          properties: {
            deliveryId:   { type: 'string' },
            webhookId:    { type: 'string' },
            url:          { type: 'string' },
            status:       { type: 'string', enum: ['delivered', 'failed'] },
            responseCode: { type: 'number', nullable: true },
            error:        { type: 'string', nullable: true },
            sentAt:       { type: 'string' }
          }
        }
      }
    }
  }, async (req, reply) => {
    const dev = await resolveDeveloper(req, reply)
    if (reply.sent) return

    const webhook = await Webhook.findOne({ _id: req.params.id, apiKey: dev.apiKey }).lean()
    if (!webhook) return reply.code(404).send({ error: 'Not Found', message: 'Webhook not found' })

    if (!webhook.active) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Cannot test an inactive webhook' })
    }

    const result = await deliverWebhook({
      webhook,
      event: 'test.ping',
      payload: {
        message: 'This is a test delivery from API Aberta. Your webhook endpoint is working!',
        webhook_id: webhook._id,
        webhook_url: webhook.url
      },
      isTest: true
    })

    return {
      deliveryId:   result.deliveryId,
      webhookId:    webhook._id,
      url:          webhook.url,
      status:       result.status,
      responseCode: result.responseCode,
      error:        result.error,
      sentAt:       new Date().toISOString()
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
      data: webhooks.map(serializeWebhook)
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

    return serializeWebhook(webhook)
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
      { active: false, updatedAt: new Date() },
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
}
