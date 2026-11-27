import os from 'node:os'
import { StatusLock } from '../db.js'

export const INSTANCE_ID = `${os.hostname()}:${process.pid}`

export const DELIVERY_LOCK_ID = 'webhook-deliveries'
export const POLL_LOCK_ID = 'webhook-poll'
export const DELIVERY_LOCK_TTL_MS = 60_000
export const POLL_LOCK_TTL_MS = 5 * 60_000

const inProcess = new Map()

export async function acquireJobLock(lockId, ttlMs, now = new Date(), owner = INSTANCE_ID) {
  if (inProcess.get(lockId)) return false
  const lockedUntil = new Date(now.getTime() + ttlMs)
  try {
    const existing = await StatusLock.findById(lockId).lean()
    if (!existing) {
      await StatusLock.create({ _id: lockId, owner, lockedUntil })
      inProcess.set(lockId, true)
      return true
    }
    if (existing.lockedUntil > now && existing.owner !== owner) {
      return false
    }
    const updated = await StatusLock.findOneAndUpdate(
      {
        _id: lockId,
        $or: [
          { owner },
          { lockedUntil: { $lte: now } }
        ]
      },
      { $set: { owner, lockedUntil } },
      { new: true }
    )
    if (!updated) return false
    inProcess.set(lockId, true)
    return true
  } catch (err) {
    if (err?.code === 11000) return false
    throw err
  }
}

export async function releaseJobLock(lockId, owner = INSTANCE_ID) {
  inProcess.delete(lockId)
  await StatusLock.deleteOne({ _id: lockId, owner }).catch(() => {})
}

export function hasInProcessLock(lockId) {
  return Boolean(inProcess.get(lockId))
}

export function clearInProcessLocks() {
  inProcess.clear()
}
