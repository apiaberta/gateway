import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WebhookValidationError,
  assertFilters,
  validateWebhookBody
} from '../src/webhooks/validate.js'
import {
  LOOKUP_ONLY_SERVICES,
  SUPPORTED_EVENTS,
  WEBHOOK_EVENTS,
  publicEventCatalog
} from '../src/webhooks/catalog.js'
import { config } from '../src/config.js'

test('POST requires https url and events', () => {
  assert.throws(
    () => validateWebhookBody({ url: 'http://example.com/hook', events: ['ipma.warning.new'] }),
    WebhookValidationError
  )
  assert.throws(
    () => validateWebhookBody({ url: 'https://example.com/hook' }),
    WebhookValidationError
  )
  const ok = validateWebhookBody({
    url: 'https://example.com/hook',
    events: ['base.contract.new'],
    filters: { 'base.contract.new': { local: 'Fundão' } }
  })
  assert.equal(ok.url, 'https://example.com/hook')
  assert.equal(ok.filters['base.contract.new'].local, 'Fundão')
  assert.equal(ok.active, true)
})

test('rejects unknown events and unknown filter keys', () => {
  assert.throws(
    () => validateWebhookBody({ url: 'https://example.com/h', events: ['not.an.event'] }),
    /Unsupported events/
  )
  assert.throws(
    () => validateWebhookBody({
      url: 'https://example.com/h',
      events: ['fuel.prices.updated'],
      filters: { 'fuel.prices.updated': { country: 'PT' } }
    }),
    /Unknown filter/
  )
  assert.throws(
    () => validateWebhookBody({
      url: 'https://example.com/h',
      events: ['fuel.prices.updated'],
      filters: { 'base.contract.new': { local: 'Fundão' } }
    }),
    /not in events/
  )
})

test('enum and number filter values are coerced and validated', () => {
  const ok = validateWebhookBody({
    url: 'https://example.com/h',
    events: ['fuel.prices.updated', 'base.contract.new'],
    filters: {
      'fuel.prices.updated': { fuel: 'DIESEL', municipality: 'Fundão' },
      'base.contract.new': { valor_min: '50000' }
    }
  })
  assert.equal(ok.filters['fuel.prices.updated'].fuel, 'diesel')
  assert.equal(ok.filters['base.contract.new'].valor_min, 50000)

  assert.throws(
    () => validateWebhookBody({
      url: 'https://example.com/h',
      events: ['fuel.prices.updated'],
      filters: { 'fuel.prices.updated': { fuel: 'agua' } }
    }),
    /must be one of/
  )
  assert.throws(
    () => assertFilters({ 'base.contract.new': { valor_min: 'nope' } }, ['base.contract.new']),
    /must be a number/
  )
})

test('PATCH is partial, prunes filters of unsubscribed events, and validates active', () => {
  const current = {
    url: 'https://example.com/old',
    events: ['ipma.warning.new', 'base.contract.new'],
    filters: {
      'ipma.warning.new': { level: 'red' },
      'base.contract.new': { local: 'Fundão' }
    },
    active: true
  }

  const patched = validateWebhookBody(
    { events: ['base.contract.new'], active: false },
    { partial: true, current }
  )
  assert.equal(patched.url, 'https://example.com/old')
  assert.deepEqual(patched.events, ['base.contract.new'])
  assert.deepEqual(patched.filters, { 'base.contract.new': { local: 'Fundão' } })
  assert.equal(patched.active, false)

  assert.throws(
    () => validateWebhookBody({}, { partial: true, current }),
    /must include/
  )
  assert.throws(
    () => validateWebhookBody({ active: 'yes' }, { partial: true, current }),
    /active must be a boolean/
  )
})

test('GET /events catalogue has service, PT labels and typed filters', () => {
  const events = publicEventCatalog()
  assert.ok(events.length >= 5)
  for (const event of events) {
    assert.equal(typeof event.name, 'string')
    assert.equal(typeof event.description, 'string')
    assert.match(event.service, /^\/v1\//)
    assert.equal(typeof event.label_pt, 'string')
    assert.equal(typeof event.description_pt, 'string')
    assert.ok(Array.isArray(event.payload_fields))
    assert.ok(Array.isArray(event.filters))
    assert.equal(event.payloadKeys, undefined)
    for (const filter of event.filters) {
      assert.equal(typeof filter.key, 'string')
      assert.equal(typeof filter.label_pt, 'string')
      assert.ok(['string', 'enum', 'number'].includes(filter.type))
      assert.ok(['equals', 'contains_ci', 'gte', 'lte'].includes(filter.match))
      if (filter.type === 'enum') {
        assert.ok(Array.isArray(filter.options) && filter.options.length > 0)
        assert.equal(typeof filter.options[0].value, 'string')
        assert.equal(typeof filter.options[0].label_pt, 'string')
      }
    }
  }

  const names = events.map(e => e.name)
  for (const required of [
    'ipma.warning.new',
    'fuel.prices.updated',
    'anpc.incident.new',
    'base.contract.new',
    'ev.prices.updated',
    'dre.diploma.new',
    'parlamento.iniciativa.new',
    'nasafirms.fire.new',
    'bdp.rates.updated',
    'ine.indicator.updated',
    'sns.dataset.updated',
    'carris.alert.new',
    'gtfs.changes.new',
    'pt2030.summary.updated',
    'prr.catalogue.updated'
  ]) {
    assert.ok(names.includes(required), required)
  }

  const base = events.find(e => e.name === 'base.contract.new')
  assert.deepEqual(base.filters.map(f => f.key).sort(), ['cpv', 'local', 'nif_entidade', 'valor_min'].sort())
  assert.equal(base.filters.find(f => f.key === 'local').match, 'contains_ci')
  assert.equal(base.filters.find(f => f.key === 'valor_min').match, 'gte')
})

test('every /v1/status service is covered by an event or documented as lookup-only', () => {
  const covered = new Set(WEBHOOK_EVENTS.map(e => e.service))
  const lookup = new Set(LOOKUP_ONLY_SERVICES.map(s => s.service))
  for (const svc of config.services) {
    const prefix = `/v1${svc.prefix}`
    assert.ok(
      covered.has(prefix) || lookup.has(prefix),
      `${prefix} has neither events nor lookup-only documentation`
    )
  }
  assert.ok(LOOKUP_ONLY_SERVICES.some(s => s.service === '/v1/nif'))
  assert.ok(LOOKUP_ONLY_SERVICES.some(s => s.service === '/v1/geo'))
  assert.ok(LOOKUP_ONLY_SERVICES.some(s => s.service === '/v1/contracts'))
  assert.equal(SUPPORTED_EVENTS.includes('contracts.contract.new'), false)
})
