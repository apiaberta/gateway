import { Webhook, WebhookDelivery } from '../db.js'
import { shapeEventPayload } from './filters.js'

/**
 * Create pending delivery rows for every active webhook subscribed to `event`
 * whose filters match. Returns the number of deliveries queued.
 *
 * For aggregate events pass `{ summary, items }` in options so local filters
 * can shrink the payload to matching records (or skip the webhook).
 */
export async function dispatchEvent(event, payload, options = {}) {
  const webhooks = await Webhook.find({ events: event, active: true }).lean()
  if (webhooks.length === 0) return 0

  const deliveries = []
  for (const w of webhooks) {
    const eventFilters = (w.filters && w.filters[event]) || {}
    const shaped = shapeEventPayload(event, payload, eventFilters, options)
    if (shaped == null) continue
    deliveries.push({
      webhookId: w._id,
      event,
      payload: shaped,
      status: 'pending',
      nextRetry: new Date()
    })
  }

  if (deliveries.length === 0) return 0
  await WebhookDelivery.insertMany(deliveries)
  return deliveries.length
}
