import { createHmac } from 'crypto'
import { WebhookDelivery } from '../db.js'

export const RETRY_DELAYS = [30_000, 120_000]
export const DELIVERY_TIMEOUT_MS = 10_000
export const MAX_ATTEMPTS = 3

export function unixSeconds(timestamp) {
  const ms = timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp)
  if (!Number.isFinite(ms)) return Math.floor(Date.now() / 1000)
  return Math.floor(ms / 1000)
}

export function envelopeTimestamp(delivery) {
  if (delivery?.timestamp) {
    const d = delivery.timestamp instanceof Date
      ? delivery.timestamp
      : new Date(delivery.timestamp)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

export function buildEnvelope({ event, timestamp, data, test }) {
  const body = { event, timestamp, data }
  if (test) body.test = true
  return body
}

export function signBody(secret, body) {
  return createHmac('sha256', secret).update(body).digest('hex')
}

/**
 * v1: HMAC-SHA256 of the raw JSON body (legacy X-ApiAberta-Signature).
 * v2: HMAC-SHA256 of `${unix}.${body}` (X-ApiAberta-Signature-V2: t=<unix>,v1=<hex>).
 */
export function signaturesFor(secret, body, unix) {
  const v1 = signBody(secret, body)
  const v2 = signBody(secret, `${unix}.${body}`)
  return {
    v1: `sha256=${v1}`,
    v2: `t=${unix},v1=${v2}`,
    hexV1: v1,
    hexV2: v2
  }
}

export function deliveryHeaders({ event, deliveryId, signatures, unix }) {
  return {
    'Content-Type': 'application/json',
    'X-ApiAberta-Event': event,
    'X-ApiAberta-Delivery': String(deliveryId),
    'X-ApiAberta-Timestamp': String(unix),
    'X-ApiAberta-Signature': signatures.v1,
    'X-ApiAberta-Signature-V2': signatures.v2,
    'User-Agent': 'ApiAberta-Webhooks/1.0'
  }
}

function isRedirect(status) {
  return status >= 300 && status < 400
}

export async function postWebhook({ url, event, deliveryId, secret, envelope }) {
  const timestamp = envelope.timestamp
  const unix = unixSeconds(timestamp)
  const body = JSON.stringify(envelope)
  const signatures = signaturesFor(secret, body, unix)
  const headers = deliveryHeaders({ event, deliveryId, signatures, unix })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
      redirect: 'manual'
    })
    const text = await res.text().catch(() => '')
    if (isRedirect(res.status)) {
      return {
        ok: false,
        status: res.status,
        body: `HTTP ${res.status} redirect is not allowed (redirect: manual)`,
        headers,
        envelope,
        bodyRaw: body
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      body: text.slice(0, 500),
      headers,
      envelope,
      bodyRaw: body
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: err.message,
      headers,
      envelope,
      bodyRaw: body
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function claimDelivery(id, now = new Date()) {
  return WebhookDelivery.findOneAndUpdate(
    {
      _id: id,
      $or: [
        { status: 'pending' },
        { status: 'sending', lastAttempt: { $lte: new Date(now.getTime() - 60_000) } }
      ]
    },
    { $set: { status: 'sending', lastAttempt: now } },
    { new: true }
  )
}
