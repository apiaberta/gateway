/**
 * Webhook Worker
 * 
 * Two responsibilities:
 * 1. Every 1 minute: process pending deliveries (send HTTP POST to registered URLs)
 * 2. Every 5 minutes: poll connectors for state changes and fire events
 */

import { createHmac } from 'crypto'
import { Webhook, WebhookDelivery, EventState } from '../db.js'
import { config } from '../config.js'

// Retry backoff in ms: attempt 1 → 30s, attempt 2 → 120s, attempt 3 → give up
const RETRY_DELAYS = [30_000, 120_000]

// ─── Dispatch: create delivery records for a new event ────────────────────────

export async function dispatchEvent(event, payload) {
  const webhooks = await Webhook.find({ events: event, active: true }).lean()
  if (webhooks.length === 0) return

  const deliveries = webhooks.map(w => ({
    webhookId: w._id,
    event,
    payload,
    status: 'pending',
    nextRetry: new Date()
  }))

  await WebhookDelivery.insertMany(deliveries)
}

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

// ─── Poll connectors for changes ──────────────────────────────────────────────

async function getState(key) {
  const s = await EventState.findOne({ key }).lean()
  return s?.value ?? null
}

async function setState(key, value) {
  await EventState.findOneAndUpdate(
    { key },
    { value, updatedAt: new Date() },
    { upsert: true, new: true }
  )
}

async function pollIPMAWarnings(log) {
  try {
    const res = await fetch(`${config.services.find(s => s.prefix === '/ipma')?.target || 'http://localhost:3002'}/ipma/warnings`)
    if (!res.ok) return
    const data = await res.json()
    const warnings = data.data || []

    const knownIds = new Set(await getState('ipma.warning.ids') || [])
    const newWarnings = warnings.filter(w => !knownIds.has(w.id))

    if (newWarnings.length > 0) {
      for (const w of newWarnings) {
        await dispatchEvent('ipma.warning.new', {
          id:        w.id,
          level:     w.level,
          type:      w.type,
          text:      w.text,
          region:    w.region,
          startTime: w.startTime,
          endTime:   w.endTime
        })
        log?.info({ warningId: w.id, level: w.level }, 'New IPMA warning event dispatched')
      }

      const allIds = [...knownIds, ...newWarnings.map(w => w.id)]
      // Keep only the most recent 200 IDs to avoid unbounded growth
      await setState('ipma.warning.ids', allIds.slice(-200))
    }
  } catch (err) {
    log?.error({ err }, 'Failed to poll IPMA warnings')
  }
}

async function pollFuelPrices(log) {
  try {
    const res = await fetch(`${config.services.find(s => s.prefix === '/fuel')?.target || 'http://localhost:3001'}/fuel/latest`)
    if (!res.ok) return
    const data = await res.json()

    // Use the date field as a version signal
    const date = data.date || data.data?.[0]?.date
    if (!date) return

    const lastDate = await getState('fuel.prices.date')
    if (lastDate !== date) {
      // Compute averages from data array
      const records = data.data || []
      const dieselPrices    = records.map(r => r.diesel).filter(Boolean)
      const gasPrices       = records.map(r => r.gasoline95 || r.gasoline).filter(Boolean)
      const lpgPrices       = records.map(r => r.lpg).filter(Boolean)

      const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3) : null

      await dispatchEvent('fuel.prices.updated', {
        date,
        diesel_avg:      avg(dieselPrices),
        gasoline95_avg:  avg(gasPrices),
        lpg_avg:         avg(lpgPrices),
        records:         records.length
      })
      await setState('fuel.prices.date', date)
      log?.info({ date }, 'Fuel prices update event dispatched')
    }
  } catch (err) {
    log?.error({ err }, 'Failed to poll fuel prices')
  }
}

async function pollANPCIncidents(log) {
  try {
    const res = await fetch(`${config.services.find(s => s.prefix === '/anpc')?.target || 'http://localhost:3006'}/anpc/incidents?limit=20`)
    if (!res.ok) return
    const data = await res.json()
    const incidents = data.data || []

    const knownIds = new Set(await getState('anpc.incident.ids') || [])
    const newIncidents = incidents.filter(i => i.id && !knownIds.has(String(i.id)))

    if (newIncidents.length > 0) {
      for (const inc of newIncidents) {
        await dispatchEvent('anpc.incident.new', {
          id:          String(inc.id),
          type:        inc.type,
          location:    inc.location,
          district:    inc.district,
          status:      inc.status,
          reported_at: inc.reported_at || inc.date
        })
        log?.info({ incidentId: inc.id, type: inc.type }, 'New ANPC incident event dispatched')
      }

      const allIds = [...knownIds, ...newIncidents.map(i => String(i.id))]
      await setState('anpc.incident.ids', allIds.slice(-500))
    }
  } catch (err) {
    log?.error({ err }, 'Failed to poll ANPC incidents')
  }
}

async function pollBASEContracts(log) {
  try {
    const res = await fetch(`${config.services.find(s => s.prefix === '/base')?.target || 'http://localhost:3003'}/contracts?limit=10`)
    if (!res.ok) return
    const data = await res.json()
    const contracts = data.data || []

    const knownIds = new Set(await getState('base.contract.ids') || [])
    const newContracts = contracts.filter(c => c.id && !knownIds.has(String(c.id)))

    if (newContracts.length > 0) {
      for (const c of newContracts) {
        await dispatchEvent('base.contract.new', {
          id:                String(c.id),
          description:       c.description,
          contractingEntity: c.contractingEntity,
          awarded:           c.awarded,
          value:             c.value,
          date:              c.date,
          type:              c.type
        })
        log?.info({ contractId: c.id, value: c.value }, 'New BASE contract event dispatched')
      }

      const allIds = [...knownIds, ...newContracts.map(c => String(c.id))]
      // Keep only the most recent 1000 IDs
      await setState('base.contract.ids', allIds.slice(-1000))
    }
  } catch (err) {
    log?.error({ err }, 'Failed to poll BASE contracts')
  }
}

async function pollEVPrices(log) {
  try {
    const res = await fetch(`${config.services.find(s => s.prefix === '/ev')?.target || 'http://localhost:3004'}/ev/omie/current`)
    if (!res.ok) return
    const data = await res.json()

    // Use the date or period as change signal
    const period = data.data?.period || data.period || data.date
    if (!period) return

    const lastPeriod = await getState('ev.omie.period')
    if (lastPeriod !== period) {
      const price = data.data?.price_eur_mwh ?? data.price_eur_mwh ?? null
      await dispatchEvent('ev.prices.updated', {
        period,
        price_eur_mwh: price,
        price_eur_kwh: price ? (price / 1000).toFixed(5) : null,
        source: 'OMIE'
      })
      await setState('ev.omie.period', period)
      log?.info({ period, price }, 'EV prices update event dispatched')
    }
  } catch (err) {
    log?.error({ err }, 'Failed to poll EV prices')
  }
}

export async function pollForEvents(log) {
  await Promise.allSettled([
    pollIPMAWarnings(log),
    pollFuelPrices(log),
    pollANPCIncidents(log),
    pollBASEContracts(log),
    pollEVPrices(log)
  ])
}
