/**
 * In-memory response cache for the API Aberta gateway.
 *
 * TTL per service prefix (seconds):
 *   /fuel   → 600   (prices update once a day at 07:30)
 *   /ipma   → 120   (weather/alerts change frequently)
 *   /base   → 1800  (public contracts update slowly)
 *   /ev     → 600   (EV tariffs update infrequently)
 *   /ine    → 3600  (statistics are mostly static)
 *   /anpc   → 60    (civil protection incidents are real-time)
 */

export const CACHE_TTLS = {
  '/fuel': 600,
  '/ipma': 120,
  '/base': 1800,
  '/ev':   600,
  '/ine':  3600,
  '/anpc': 60,
}

const DEFAULT_TTL = 300 // 5 min fallback

// key → { body: string, status: number, contentType: string, expires: number }
const store = new Map()

export function getCached(key) {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    store.delete(key)
    return null
  }
  return entry
}

export function setCached(key, data, ttlSeconds) {
  store.set(key, {
    ...data,
    expires: Date.now() + ttlSeconds * 1000
  })
}

export function getTtl(servicePrefix) {
  return CACHE_TTLS[servicePrefix] ?? DEFAULT_TTL
}

export function cacheStats() {
  const now = Date.now()
  let alive = 0
  for (const entry of store.values()) {
    if (now <= entry.expires) alive++
  }
  return { total: store.size, alive }
}

// Purge expired entries every 2 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (now > entry.expires) store.delete(key)
  }
}, 120_000)
