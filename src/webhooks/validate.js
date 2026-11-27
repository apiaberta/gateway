import { EVENT_BY_NAME, SUPPORTED_EVENTS } from './catalog.js'

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

export function assertFilters(filters, events) {
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

    for (const [key, value] of Object.entries(eventFilters)) {
      if (value == null || value === '') continue
      const spec = allowed[key]
      if (!spec) {
        throw new WebhookValidationError(`Unknown filter "${key}" for ${eventName}`)
      }
      next[key] = coerceFilterValue(spec, value, eventName)
    }
    cleaned[eventName] = next
  }

  return cleaned
}

function coerceFilterValue(spec, value, eventName) {
  if (spec.type === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) {
      throw new WebhookValidationError(`filters.${eventName}.${spec.key} must be a number`)
    }
    return n
  }

  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new WebhookValidationError(`filters.${eventName}.${spec.key} must be a scalar`)
  }

  const asString = String(value)

  if (spec.type === 'enum' && spec.options?.length) {
    const allowed = spec.options.map(o => o.value)
    const ok = allowed.some(v => v.toLowerCase() === asString.toLowerCase())
    if (!ok) {
      throw new WebhookValidationError(
        `filters.${eventName}.${spec.key} must be one of: ${allowed.join(', ')}`
      )
    }
    const canonical = allowed.find(v => v.toLowerCase() === asString.toLowerCase())
    return canonical
  }

  return asString
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
    // Drop filters for events no longer subscribed
    filters = Object.fromEntries(
      Object.entries(filters).filter(([name]) => events.includes(name))
    )
    filters = assertFilters(filters, events)
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
