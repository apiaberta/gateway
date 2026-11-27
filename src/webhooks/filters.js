import { getEventDef } from './catalog.js'

/** Case- and accent-insensitive string form ("Fundão" → "fundao"). */
export function normalizeText(value) {
  if (value == null) return ''
  return String(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

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

export function valuesMatch(match, expected, actuals) {
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

/**
 * True when every provided filter key matches the payload (AND).
 * Unknown keys (not in the event catalogue) fail closed.
 * An event with no filters always matches.
 */
export function payloadMatchesFilters(eventName, payload, filters = {}) {
  const entries = Object.entries(filters || {}).filter(([, v]) => v != null && v !== '')
  if (entries.length === 0) return true

  const def = getEventDef(eventName)
  if (!def) return false

  for (const [key, expected] of entries) {
    const spec = def.filters.find(f => f.key === key)
    if (!spec) return false
    const actuals = payloadValues(payload, spec.payloadKeys || [key])
    if (!valuesMatch(spec.match, expected, actuals)) return false
  }
  return true
}

export function hasAnyFilterKey(filters, keys) {
  if (!filters) return false
  return keys.some(k => filters[k] != null && filters[k] !== '')
}

/**
 * For aggregate events: when local/record filters are set, keep only matching
 * records. Returns null when nothing matches (do not deliver).
 *
 * `items` is the list of records. `summary` is the unfiltered payload (national
 * averages, full rate table, …).
 */
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
 * Shape a single-item (or snapshot) payload for one webhook.
 * Returns null when the webhook's filters do not match.
 */
export function shapeEventPayload(eventName, payload, filters = {}, options = {}) {
  const def = getEventDef(eventName)
  if (!def) return payloadMatchesFilters(eventName, payload, filters) ? payload : null

  if (def.kind === 'aggregate' && (options.items || payload?._items)) {
    const items = options.items || payload._items
    const summary = options.summary || stripInternal(payload)
    return shapeAggregatePayload(eventName, { summary, items }, filters)
  }

  if (!payloadMatchesFilters(eventName, payload, filters)) return null
  return stripInternal(payload)
}

function stripInternal(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const { _items, ...rest } = payload
  return rest
}
