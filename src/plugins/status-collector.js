/**
 * Status collector — samples each registered service with the same health
 * check as GET /v1/status, then persists raw checks, daily aggregates and
 * simple incidents. Guarded by a Mongo lock so only one PM2/cluster instance
 * runs the job.
 */

import os from 'node:os'
import { config } from '../config.js'
import { checkService } from '../routes/status.js'
import {
  StatusCheck,
  StatusDaily,
  StatusIncident,
  StatusLock
} from '../db.js'
import {
  lisbonDateString,
  serviceIdFromConfig
} from '../services/status-history.js'

export const COLLECT_INTERVAL_MS = 60_000
export const LOCK_ID = 'status-collector'
export const LOCK_TTL_MS = 90_000
export const INSTANCE_ID = `${os.hostname()}:${process.pid}`

let inFlight = false
let timer = null
let startupTimer = null

export async function acquireCollectorLock(now = new Date(), owner = INSTANCE_ID) {
  const lockedUntil = new Date(now.getTime() + LOCK_TTL_MS)
  try {
    const existing = await StatusLock.findById(LOCK_ID).lean()
    if (!existing) {
      await StatusLock.create({ _id: LOCK_ID, owner, lockedUntil })
      return true
    }
    if (existing.lockedUntil > now && existing.owner !== owner) {
      return false
    }
    const updated = await StatusLock.findOneAndUpdate(
      {
        _id: LOCK_ID,
        $or: [
          { owner },
          { lockedUntil: { $lte: now } }
        ]
      },
      { $set: { owner, lockedUntil } },
      { new: true }
    )
    return Boolean(updated)
  } catch (err) {
    if (err?.code === 11000) return false
    throw err
  }
}

export async function upsertDaily({ service, status, latencyMs, timestamp }) {
  const date = lisbonDateString(timestamp)
  const upInc = status === 'up' ? 1 : 0
  const degradedInc = status === 'degraded' ? 1 : 0
  const downInc = status === 'down' ? 1 : 0

  await StatusDaily.updateOne(
    { service, date },
    [
      {
        $set: {
          service,
          date,
          checks: { $add: [{ $ifNull: ['$checks', 0] }, 1] },
          up: { $add: [{ $ifNull: ['$up', 0] }, upInc] },
          degraded: { $add: [{ $ifNull: ['$degraded', 0] }, degradedInc] },
          down: { $add: [{ $ifNull: ['$down', 0] }, downInc] },
          avgLatencyMs: {
            $divide: [
              {
                $add: [
                  {
                    $multiply: [
                      { $ifNull: ['$avgLatencyMs', 0] },
                      { $ifNull: ['$checks', 0] }
                    ]
                  },
                  latencyMs
                ]
              },
              { $add: [{ $ifNull: ['$checks', 0] }, 1] }
            ]
          }
        }
      }
    ],
    { upsert: true }
  )
}

export async function syncIncident({ service, status, timestamp }) {
  const open = await StatusIncident.findOne({ service, resolvedAt: null }).sort({ startedAt: -1 })

  if (status === 'up') {
    if (open) {
      open.resolvedAt = timestamp
      await open.save()
    }
    return
  }

  if (!open) {
    await StatusIncident.create({
      service,
      status,
      startedAt: timestamp,
      resolvedAt: null
    })
  }
}

export async function persistCheckResults(results) {
  if (results.length === 0) return
  await StatusCheck.insertMany(results)
  for (const row of results) {
    await upsertDaily(row)
    await syncIncident(row)
  }
}

export async function collectStatusOnce(log, { now = new Date(), owner = INSTANCE_ID } = {}) {
  if (inFlight) return { skipped: true, reason: 'in-flight' }
  inFlight = true
  try {
    const locked = await acquireCollectorLock(now, owner)
    if (!locked) return { skipped: true, reason: 'lock' }

    const results = await Promise.all(
      config.services.map(async (svc) => {
        const result = await checkService(svc)
        return {
          service: serviceIdFromConfig(svc),
          status: result.status,
          latencyMs: result.latency_ms,
          timestamp: now
        }
      })
    )

    await persistCheckResults(results)
    return { skipped: false, count: results.length }
  } catch (err) {
    log?.error?.({ err }, 'status collector error')
    return { skipped: true, reason: 'error', error: err }
  } finally {
    inFlight = false
  }
}

export function startStatusCollector(log) {
  const tick = () => {
    collectStatusOnce(log).catch(err => {
      log?.error?.({ err }, 'status collector tick error')
    })
  }

  timer = setInterval(tick, COLLECT_INTERVAL_MS)
  // First sample shortly after boot so listen()/health are not delayed.
  startupTimer = setTimeout(tick, 5_000)
  log?.info?.('Status collector started (every 60s)')
  return { timer, startupTimer }
}

export function stopStatusCollector() {
  if (timer) clearInterval(timer)
  if (startupTimer) clearTimeout(startupTimer)
  timer = null
  startupTimer = null
  inFlight = false
}
