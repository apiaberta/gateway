/**
 * Webhook Worker
 *
 * Two responsibilities:
 * 1. Every 1 minute: process pending deliveries (send HTTP POST to registered URLs)
 * 2. Every 5 minutes: poll connectors for state changes and fire events
 *
 * Events are generated in the gateway by polling connector HTTP endpoints and
 * diffing against EventState (seen ids / hashes). Connectors do not POST into
 * the gateway. The first observation of a key is stored without dispatch so a
 * restart does not replay the current snapshot.
 */

import { createHmac } from 'crypto'
import { Webhook, WebhookDelivery } from '../db.js'

export { dispatchEvent } from '../webhooks/dispatch.js'
export { pollForEvents } from '../webhooks/poll.js'

// Retry backoff in ms: attempt 1 → 30s, attempt 2 → 120s, attempt 3 → give up
const RETRY_DELAYS = [30_000, 120_000]

// ─── Deliver a single webhook ─────────────────────────────────────────────────

async function deliver(delivery, webhook) {
  const body = JSON.stringify({
    event:     delivery.event,
    timestamp: new Date().toISOString(),
    data:      delivery.payload
  })

  const sig = createHmac('sha256', webhook.secret)
    .update(body)
    .digest('hex')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ApiAberta-Event': delivery.event,
        'X-ApiAberta-Signature': `sha256=${sig}`,
        'X-ApiAberta-Delivery': delivery._id.toString(),
        'User-Agent': 'ApiAberta-Webhooks/1.0'
      },
      body,
      signal: controller.signal
    })
    clearTimeout(timeout)
    return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 500) }
  } catch (err) {
    clearTimeout(timeout)
    return { ok: false, status: 0, body: err.message }
  }
}

// ─── Process pending deliveries ───────────────────────────────────────────────

export async function processPendingDeliveries(log) {
  const now = new Date()
  const pending = await WebhookDelivery.find({
    status: 'pending',
    nextRetry: { $lte: now }
  }).limit(50).lean()

  for (const delivery of pending) {
    const webhook = await Webhook.findOne({ _id: delivery.webhookId, active: true }).lean()
    if (!webhook) {
      await WebhookDelivery.updateOne({ _id: delivery._id }, { status: 'failed' })
      continue
    }

    const result = await deliver(delivery, webhook)
    const attempts = delivery.attempts + 1

    if (result.ok) {
      await WebhookDelivery.updateOne({ _id: delivery._id }, {
        status:       'delivered',
        attempts,
        lastAttempt:  now,
        responseCode: result.status,
        responseBody: result.body
      })
      log?.info({ webhookId: webhook._id, event: delivery.event }, 'Webhook delivered')
    } else if (attempts >= 3) {
      await WebhookDelivery.updateOne({ _id: delivery._id }, {
        status:       'failed',
        attempts,
        lastAttempt:  now,
        responseCode: result.status,
        responseBody: result.body
      })
      log?.warn({ webhookId: webhook._id, event: delivery.event, attempts }, 'Webhook delivery failed permanently')
    } else {
      const delay = RETRY_DELAYS[attempts - 1] || 120_000
      await WebhookDelivery.updateOne({ _id: delivery._id }, {
        attempts,
        lastAttempt:  now,
        nextRetry:    new Date(now.getTime() + delay),
        responseCode: result.status,
        responseBody: result.body
      })
      log?.info({ webhookId: webhook._id, event: delivery.event, attempts, nextIn: delay }, 'Webhook delivery will retry')
    }
  }
}
