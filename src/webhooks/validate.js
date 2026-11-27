import { EVENT_BY_NAME, SUPPORTED_EVENTS, findFilterSpec } from './catalog.js'
import {
  getMunicipality,
  resolveDistrict,
  resolveMunicipality,
  suggestionMessage
} from './geo-ref.js'
import { isValidNif } from './nif.js'
import { normalizeText } from './normalize.js'

export class WebhookValidationError extends Error {
  constructor(message, details = []) {
    super(message)
    this.name = 'WebhookValidationError'
    this.statusCode = 400
    this.details = details
  }
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export function assertHttpsUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new WebhookValidationError('Webhook URL must use HTTPS')
  }
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') {
      throw new WebhookValidationError('Webhook URL must use HTTPS')
    }
  } catch (err) {
    if (err instanceof WebhookValidationError) throw err
    throw new WebhookValidationError('Webhook URL is not a valid URI')
  }
}

export function assertEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new WebhookValidationError('events must be a non-empty array')
  }
  const unknown = [...new Set(events)].filter(e => !SUPPORTED_EVENTS.includes(e))
  if (unknown.length) {
    throw new WebhookValidationError(`Unsupported events: ${unknown.join(', ')}`, unknown)
  }
  return [...new Set(events)]
}

function canonicalKey(eventName, key) {
  const spec = findFilterSpec(eventName, key)
  return spec ? spec.key : key
}

export function assertFilters(filters, events, { dropUnknown = false } = {}) {
  if (filters == null) return {}
  if (!isPlainObject(filters)) {
    throw new WebhookValidationError('filters must be an object keyed by event name')
  }

  const subscribed = new Set(events)
  const cleaned = {}

  for (const [eventName, eventFilters] of Object.entries(filters)) {
    if (!SUPPORTED_EVENTS.includes(eventName)) {
      throw new WebhookValidationError(`Unknown event in filters: ${eventName}`)
    }
    if (!subscribed.has(eventName)) {
      throw new WebhookValidationError(`filters include ${eventName} which is not in events`)
    }
    if (eventFilters == null) continue
    if (!isPlainObject(eventFilters)) {
      throw new WebhookValidationError(`filters.${eventName} must be an object`)
    }

    const def = EVENT_BY_NAME[eventName]
    const allowed = Object.fromEntries((def.filters || []).map(f => [f.key, f]))
    const next = {}

    for (const [rawKey, value] of Object.entries(eventFilters)) {
      if (value == null || value === '') continue
      const key = canonicalKey(eventName, rawKey)
      const spec = allowed[key]
      if (!spec) {
        if (dropUnknown) continue
        throw new WebhookValidationError(`Unknown filter "${rawKey}" for ${eventName}`)
      }
      let coerced
      try {
        coerced = coerceFilterValue(spec, value, eventName)
      } catch (err) {
        if (dropUnknown && err instanceof WebhookValidationError) continue
        throw err
      }
      if (coerced == null || coerced === '' || (Array.isArray(coerced) && coerced.length === 0)) continue
      if (next[spec.key] != null) {
        next[spec.key] = mergeFilterValues(next[spec.key], coerced)
      } else {
        next[spec.key] = coerced
      }
    }
    cleaned[eventName] = next
  }

  return cleaned
}

function mergeFilterValues(a, b) {
  const list = [...(Array.isArray(a) ? a : [a]), ...(Array.isArray(b) ? b : [b])]
  return [...new Set(list.map(String))]
}

function optionAliases(option) {
  const aliases = [option.value, option.label_pt, ...(option.aliases || [])]
  return aliases.filter(Boolean).map(v => normalizeText(v))
}

function coerceFilterValue(spec, value, eventName) {
  const path = `filters.${eventName}.${spec.key}`

  if (spec.type === 'radius' || spec.match === 'radius') {
    return coerceRadius(value, path)
  }

  if (spec.type === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) {
      throw new WebhookValidationError(`${path} must be a number`)
    }
    return n
  }

  const values = Array.isArray(value) ? value : [value]
  const coerced = values.map(v => coerceScalar(spec, v, path))
  const unique = [...new Set(coerced.map(v => (typeof v === 'string' ? v : String(v))))]
  if (unique.length === 1 && !Array.isArray(value)) return unique[0]
  return unique
}

function coerceRadius(value, path) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { /* keep */ }
  }
  if (!isPlainObject(value)) {
    throw new WebhookValidationError(`${path} must be { lat, lon, km }`)
  }
  const lat = Number(value.lat)
  const lon = Number(value.lon ?? value.lng)
  const km = Number(value.km)
  if (![lat, lon, km].every(Number.isFinite) || km <= 0) {
    throw new WebhookValidationError(`${path} must be { lat, lon, km } with km > 0`)
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new WebhookValidationError(`${path} has out-of-range coordinates`)
  }
  return { lat, lon, km }
}

function coerceScalar(spec, value, path) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new WebhookValidationError(`${path} must be a scalar`)
  }
  const asString = String(value).trim()

  if (spec.resolve === 'municipality') {
    return coerceMunicipality(asString, path)
  }
  if (spec.resolve === 'district') {
    return coerceDistrict(asString, path)
  }
  if (spec.resolve === 'nif' || spec.key === 'nif_entidade') {
    if (!isValidNif(asString)) {
      throw new WebhookValidationError(`${path} must be a 9-digit NIF with a valid MOD 11 checksum`)
    }
    return asString
  }
  if (spec.pattern) {
    const re = new RegExp(spec.pattern)
    if (!re.test(asString)) {
      throw new WebhookValidationError(`${path} must match ${spec.pattern}`)
    }
    return asString
  }

  if (spec.type === 'enum' && spec.options?.length) {
    const allowed = spec.options
    const hit = allowed.find(o => optionAliases(o).includes(normalizeText(asString)))
    if (!hit) {
      throw new WebhookValidationError(
        `${path} must be one of: ${allowed.map(o => o.value).join(', ')}`
      )
    }
    return hit.value
  }

  return asString
}

function coerceMunicipality(asString, path) {
  const result = resolveMunicipality(asString)
  if (result.code) return result.code
  if (result.error === 'ambiguous') {
    throw new WebhookValidationError(suggestionMessage(path, result), result.candidates.map(c => c.code))
  }
  const sample = ['0504 (Fundão)', '1106 (Lisboa)']
  throw new WebhookValidationError(
    `${path} must be a municipality code, slug or name, e.g. ${sample.join(', ')}`
  )
}

function coerceDistrict(asString, path) {
  const result = resolveDistrict(asString)
  if (result.code) return result.code
  throw new WebhookValidationError(
    `${path} must be a district code (01–18, RAA, RAM) or name`
  )
}

/**
 * Validate POST (all required) or PATCH (partial) webhook bodies.
 */
export function validateWebhookBody(body = {}, { partial = false, current } = {}) {
  if (!isPlainObject(body)) {
    throw new WebhookValidationError('Request body must be an object')
  }

  const provided = {
    url: Object.prototype.hasOwnProperty.call(body, 'url'),
    events: Object.prototype.hasOwnProperty.call(body, 'events'),
    filters: Object.prototype.hasOwnProperty.call(body, 'filters'),
    active: Object.prototype.hasOwnProperty.call(body, 'active')
  }

  if (!partial) {
    if (!provided.url || !provided.events) {
      throw new WebhookValidationError('url and events are required')
    }
  } else if (!provided.url && !provided.events && !provided.filters && !provided.active) {
    throw new WebhookValidationError('PATCH body must include url, events, filters or active')
  }

  const url = provided.url ? body.url : current?.url
  if (provided.url || !partial) assertHttpsUrl(url)

  const events = provided.events
    ? assertEvents(body.events)
    : [...(current?.events || [])]

  if (partial && provided.events) {
    assertEvents(body.events)
  }

  let filters = current?.filters && isPlainObject(current.filters) ? { ...current.filters } : {}
  if (provided.filters) {
    filters = assertFilters(body.filters, events)
  } else {
    filters = Object.fromEntries(
      Object.entries(filters).filter(([name]) => events.includes(name))
    )
    filters = assertFilters(filters, events, { dropUnknown: true })
  }

  let active = current?.active ?? true
  if (provided.active) {
    if (typeof body.active !== 'boolean') {
      throw new WebhookValidationError('active must be a boolean')
    }
    active = body.active
  }

  return { url, events, filters, active }
}

export { getMunicipality }
