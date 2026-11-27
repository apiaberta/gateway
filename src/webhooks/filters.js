import { findFilterSpec, getEventDef } from './catalog.js'
import { ipmaAreasForMunicipality, resolveDistrict, resolveMunicipality } from './geo-ref.js'
import { normalizeText } from './normalize.js'

export { normalizeText }

const LEVEL_RANK = { green: 0, yellow: 1, orange: 2, red: 3 }

export function getPath(obj, path) {
  if (obj == null) return undefined
  if (!path.includes('.')) return obj[path]
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj)
}

function asList(value) {
  if (value == null || value === '') return []
  if (Array.isArray(value)) return value.flatMap(asList)
  return [value]
}

export function payloadValues(payload, keys) {
  const out = []
  for (const key of keys) {
    out.push(...asList(getPath(payload, key)))
  }
  return out
}

function numericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function digitsPrefix(value) {
  const m = String(value ?? '').match(/\d+/)
  return m ? m[0] : ''
}

export function valuesMatch(match, expected, actuals) {
  if (match === 'radius') {
    return false
  }

  if (actuals.length === 0) return false

  if (match === 'gte' || match === 'lte') {
    const want = numericValue(expected)
    if (want == null) return false
    return actuals.some(v => {
      const n = numericValue(v)
      if (n == null) return false
      return match === 'gte' ? n >= want : n <= want
    })
  }

  if (match === 'min_level') {
    const want = LEVEL_RANK[normalizeText(expected)]
    if (want == null) return false
    return actuals.some(v => {
      const have = LEVEL_RANK[normalizeText(v)]
      return have != null && have >= want
    })
  }

  if (match === 'ipma_area') {
    const areas = new Set(
      asList(expected).flatMap(code => ipmaAreasForMunicipality(code).map(a => normalizeText(a)))
    )
    if (areas.size === 0) return false
    return actuals.some(v => areas.has(normalizeText(v)))
  }

  if (match === 'prefix') {
    const want = String(expected).replace(/\D/g, '')
    if (!want) return false
    return actuals.some(v => digitsPrefix(v).startsWith(want))
  }

  const want = normalizeText(expected)
  if (!want) return false

  return actuals.some(v => {
    const have = normalizeText(v)
    if (!have) return false
    if (match === 'equals') return have === want
    if (match === 'contains_ci') return have.includes(want)
    return have === want
  })
}

function expectedList(expected) {
  return asList(expected).filter(v => v != null && v !== '')
}

/**
 * True when every provided filter key matches the payload (AND).
 * Values of the same key are OR-ed. Unknown keys fail closed.
 */
export function payloadMatchesFilters(eventName, payload, filters = {}) {
  const entries = Object.entries(filters || {}).filter(([, v]) => v != null && v !== '')
  if (entries.length === 0) return true

  const def = getEventDef(eventName)
  if (!def) return false

  for (const [key, expected] of entries) {
    const spec = findFilterSpec(eventName, key)
    if (!spec) return false
    if (!filterMatchesSpec(spec, payload, expected)) return false
  }
  return true
}

function filterMatchesSpec(spec, payload, expected) {
  if (spec.match === 'radius' || spec.type === 'radius') {
    return withinRadiusPayload(payload, expected)
  }

  const actuals = payloadValues(payload, spec.payloadKeys || [spec.key])
  const wanted = expectedList(expected).map(value => canonicalizeExpected(spec, value))
  if (wanted.length === 0) return true
  return wanted.some(value => valuesMatch(spec.match, value, actuals))
}

function canonicalizeExpected(spec, value) {
  if (spec.resolve === 'municipality' && typeof value === 'string' && !/^\d{4}$/.test(value)) {
    return resolveMunicipality(value).code || value
  }
  if (spec.resolve === 'district' && typeof value === 'string') {
    return resolveDistrict(value).code || value
  }
  return value
}

function withinRadiusPayload(payload, radius) {
  if (!radius || typeof radius !== 'object' || Array.isArray(radius)) return false
  const lat = payload.lat ?? payload.latitude ?? payload.location?.lat
  const lon = payload.lon ?? payload.lng ?? payload.longitude ?? payload.location?.lng
  const km = Number(radius.km)
  const rLat = Number(radius.lat)
  const rLon = Number(radius.lon ?? radius.lng)
  if (![lat, lon, km, rLat, rLon].every(n => Number.isFinite(Number(n)))) return false
  return haversine(Number(lat), Number(lon), rLat, rLon) <= km
}

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180
  const r = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function hasAnyFilterKey(filters, keys) {
  if (!filters) return false
  return keys.some(k => {
    const v = filters[k]
    if (v == null || v === '') return false
    if (Array.isArray(v) && v.length === 0) return false
    return true
  })
}

function compact(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
}

function recordListKey(eventName) {
  if (eventName.startsWith('fuel.')) return 'stations'
  if (eventName === 'ev.tariffs.updated') return 'tariffs'
  if (eventName.startsWith('bdp.')) return 'rates'
  if (eventName.startsWith('prr.')) return 'investments'
  return 'items'
}

export function shapeAggregatePayload(eventName, { summary, items }, filters = {}) {
  const def = getEventDef(eventName)
  const localKeys = def?.localFilterKeys || []
  const hasFilters = Object.entries(filters || {}).some(([, v]) => v != null && v !== '')
  if (!hasFilters) return compact(summary)

  if (hasAnyFilterKey(filters, localKeys)) {
    const list = Array.isArray(items) ? items : []
    const matched = list.filter(item => payloadMatchesFilters(eventName, item, filters))
    if (matched.length === 0) return null
    const key = recordListKey(eventName)
    const base = eventName.startsWith('fuel.')
      ? { date: summary?.date }
      : summary
    return compact({
      ...base,
      records: matched.length,
      [key]: matched
    })
  }

  const nested = filterNestedSummary(eventName, summary, filters)
  if (nested) return compact(nested)
  if (payloadMatchesFilters(eventName, summary, filters)) return compact(summary)

  const list = Array.isArray(items)
    ? items.filter(item => payloadMatchesFilters(eventName, item, filters))
    : []
  if (list.length === 0) return null
  return compact({ ...summary, records: list.length, [recordListKey(eventName)]: list })
}

function filterNestedSummary(eventName, summary, filters) {
  if (!summary || typeof summary !== 'object') return null
  const arrays = ['fuels', 'rates', 'tariffs', 'components', 'investments']
  for (const key of arrays) {
    if (!Array.isArray(summary[key])) continue
    const matched = summary[key].filter(item =>
      payloadMatchesFilters(eventName, item, filters)
      || payloadMatchesFilters(eventName, { ...summary, ...item }, filters)
    )
    if (matched.length === 0) continue
    return { ...summary, records: matched.length, [key]: matched }
  }
  return null
}

/**
 * Default IPMA matching: skip green warnings unless the webhook asked for them.
 */
export function effectiveFilters(eventName, filters = {}) {
  const next = { ...(filters || {}) }
  if (eventName !== 'ipma.warning.new') return next
  const hasLevel = expectedList(next.level).length > 0
  const hasMin = next.min_level != null && next.min_level !== ''
  if (!hasLevel && !hasMin) next.min_level = 'yellow'
  return next
}

/**
 * Shape a single-item (or snapshot) payload for one webhook.
 * Returns null when the webhook's filters do not match.
 */
export function shapeEventPayload(eventName, payload, filters = {}, options = {}) {
  const def = getEventDef(eventName)
  const effective = effectiveFilters(eventName, filters)
  if (!def) return payloadMatchesFilters(eventName, payload, effective) ? payload : null

  if (def.kind === 'aggregate' && (options.items || payload?._items)) {
    const items = options.items || payload._items
    const summary = options.summary || stripInternal(payload)
    return shapeAggregatePayload(eventName, { summary, items }, effective)
  }

  if (!payloadMatchesFilters(eventName, payload, effective)) return null
  return stripInternal(payload)
}

function stripInternal(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const { _items, ...rest } = payload
  return rest
}
