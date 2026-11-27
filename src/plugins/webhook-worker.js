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

import { Webhook, WebhookDelivery } from '../db.js'
import {
  MAX_ATTEMPTS,
  RETRY_DELAYS,
  buildEnvelope,
  claimDelivery,
  envelopeTimestamp,
  postWebhook
} from '../webhooks/deliver.js'
import {
  DELIVERY_LOCK_ID,
  DELIVERY_LOCK_TTL_MS,
  POLL_LOCK_ID,
  POLL_LOCK_TTL_MS,
  acquireJobLock,
  releaseJobLock
} from '../webhooks/lock.js'
import { pollForEvents as pollConnectors } from '../webhooks/poll.js'

export { dispatchEvent } from '../webhooks/dispatch.js'
export { pollForEvents } from '../webhooks/poll.js'

export async function deliverOne(delivery, webhook, { test = false } = {}) {
  const timestamp = envelopeTimestamp(delivery)
  const envelope = buildEnvelope({
    event: delivery.event,
    timestamp,
    data: delivery.payload,
    test
  })
  return postWebhook({
    url: webhook.url,
    event: delivery.event,
    deliveryId: delivery._id,
    secret: webhook.secret,
    envelope
  })
}

export async function processPendingDeliveries(log) {
  const locked = await acquireJobLock(DELIVERY_LOCK_ID, DELIVERY_LOCK_TTL_MS)
  if (!locked) return 0
  try {
    const now = new Date()
    const staleBefore = new Date(now.getTime() - DELIVERY_LOCK_TTL_MS)
    const pending = await WebhookDelivery.find({
      $or: [
        { status: 'pending', nextRetry: { $lte: now } },
        { status: 'sending', lastAttempt: { $lte: staleBefore } }
      ]
    }).limit(50).lean()

    let processed = 0
    for (const delivery of pending) {
      const claimed = await claimDelivery(delivery._id, now)
      if (!claimed) continue
      processed++

      const webhook = await Webhook.findOne({ _id: claimed.webhookId, active: true }).lean()
      if (!webhook) {
        await WebhookDelivery.updateOne({ _id: claimed._id }, { status: 'failed', lastAttempt: now })
        continue
      }

      const result = await deliverOne(claimed, webhook, { test: false })
      const attempts = (claimed.attempts || 0) + 1

      if (result.ok) {
        await WebhookDelivery.updateOne({ _id: claimed._id }, {
          status: 'delivered',
          attempts,
          lastAttempt: now,
          responseCode: result.status,
          responseBody: result.body
        })
        log?.info({ webhookId: webhook._id, event: claimed.event }, 'Webhook delivered')
      } else if (attempts >= MAX_ATTEMPTS) {
        await WebhookDelivery.updateOne({ _id: claimed._id }, {
          status: 'failed',
          attempts,
          lastAttempt: now,
          responseCode: result.status,
          responseBody: result.body
        })
        log?.warn({ webhookId: webhook._id, event: claimed.event, attempts }, 'Webhook delivery failed permanently')
      } else {
        const delay = RETRY_DELAYS[attempts - 1] || 120_000
        await WebhookDelivery.updateOne({ _id: claimed._id }, {
          status: 'pending',
          attempts,
          lastAttempt: now,
          nextRetry: new Date(now.getTime() + delay),
          responseCode: result.status,
          responseBody: result.body
        })
        log?.info({ webhookId: webhook._id, event: claimed.event, attempts, nextIn: delay }, 'Webhook delivery will retry')
      }
    }
    return processed
  } finally {
    await releaseJobLock(DELIVERY_LOCK_ID)
  }
}

export async function pollForEventsLocked(log) {
  const locked = await acquireJobLock(POLL_LOCK_ID, POLL_LOCK_TTL_MS)
  if (!locked) return
  try {
    await pollConnectors(log)
  } finally {
    await releaseJobLock(POLL_LOCK_ID)
  }
}
