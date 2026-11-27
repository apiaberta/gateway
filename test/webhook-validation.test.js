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

test('POST requires https url and events; municipality names are stored as INE codes', () => {
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
    filters: { 'base.contract.new': { municipality: 'Fundão' } }
  })
  assert.equal(ok.url, 'https://example.com/hook')
  assert.equal(ok.filters['base.contract.new'].municipality, '0504')
  assert.equal(ok.active, true)
})

test('rejects unknown names and ambiguous Lagoa', () => {
  assert.throws(
    () => validateWebhookBody({
      url: 'https://example.com/h',
      events: ['base.contract.new'],
      filters: { 'base.contract.new': { municipality: 'Fundao City' } }
    }),
    /must be a municipality/
  )
  assert.throws(
    () => validateWebhookBody({
      url: 'https://example.com/h',
      events: ['base.contract.new'],
      filters: { 'base.contract.new': { municipality: 'Lagoa' } }
    }),
    /ambiguous/
  )
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
      filters: { 'base.contract.new': { municipality: 'Fundão' } }
    }),
    /not in events/
  )
})

test('enum and number filter values are coerced and validated', () => {
  const ok = validateWebhookBody({
    url: 'https://example.com/h',
    events: ['fuel.prices.updated', 'base.contract.new', 'dre.diploma.new'],
    filters: {
      'fuel.prices.updated': { fuel: 'DIESEL', municipality: 'Fundão' },
      'base.contract.new': { valor_min: '50000', nif_entidade: '505456010', cpv: '45' },
      'dre.diploma.new': { series: '2' }
    }
  })
  assert.equal(ok.filters['fuel.prices.updated'].fuel, 'diesel')
  assert.equal(ok.filters['fuel.prices.updated'].municipality, '0504')
  assert.equal(ok.filters['base.contract.new'].valor_min, 50000)
  assert.equal(ok.filters['base.contract.new'].nif_entidade, '505456010')
  assert.equal(ok.filters['dre.diploma.new'].series, 'II')

  const farmacias = validateWebhookBody({
    url: 'https://example.com/h',
    events: ['farmacias.servico.updated', 'farmacias.farmacia.new'],
    filters: {
      'farmacias.servico.updated': { municipality: 'Fundão', district: 'Castelo Branco' },
      'farmacias.farmacia.new': { municipality: '0504' }
    }
  })
  assert.equal(farmacias.filters['farmacias.servico.updated'].municipality, '0504')
  assert.equal(farmacias.filters['farmacias.servico.updated'].district, '05')
  assert.equal(farmacias.filters['farmacias.farmacia.new'].municipality, '0504')

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
  assert.throws(
    () => validateWebhookBody({
      url: 'https://example.com/h',
      events: ['base.contract.new'],
      filters: { 'base.contract.new': { nif_entidade: '111111111' } }
    }),
    /MOD 11/
  )
})

test('legacy local/concelho keys convert to municipality', () => {
  const ok = validateWebhookBody({
    url: 'https://example.com/h',
    events: ['base.contract.new', 'anpc.incident.new'],
    filters: {
      'base.contract.new': { local: 'Fundão' },
      'anpc.incident.new': { concelho: 'Fundão' }
    }
  })
  assert.equal(ok.filters['base.contract.new'].municipality, '0504')
  assert.equal(ok.filters['base.contract.new'].local, undefined)
  assert.equal(ok.filters['anpc.incident.new'].municipality, '0504')
})

test('PATCH is partial, prunes filters of unsubscribed events, and validates active', () => {
  const current = {
    url: 'https://example.com/old',
    events: ['ipma.warning.new', 'base.contract.new'],
    filters: {
      'ipma.warning.new': { level: 'red' },
      'base.contract.new': { municipality: '0504' }
    },
    active: true
  }

  const patched = validateWebhookBody(
    { events: ['base.contract.new'], active: false },
    { partial: true, current }
  )
  assert.equal(patched.url, 'https://example.com/old')
  assert.deepEqual(patched.events, ['base.contract.new'])
  assert.deepEqual(patched.filters, { 'base.contract.new': { municipality: '0504' } })
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
    assert.ok(['municipality', 'district', 'coordinates', 'none'].includes(event.geo_precision))
    assert.equal(event.payloadKeys, undefined)
    for (const filter of event.filters) {
      assert.equal(typeof filter.key, 'string')
      assert.equal(typeof filter.label_pt, 'string')
      assert.equal(typeof filter.multiple, 'boolean')
      assert.ok(['string', 'enum', 'number', 'radius'].includes(filter.type))
      if (filter.type === 'enum') {
        const hasOptions = Array.isArray(filter.options) && filter.options.length > 0
        const hasSource = typeof filter.options_source === 'string'
        assert.ok(hasOptions || hasSource, `${event.name}.${filter.key} needs options or options_source`)
      }
      if (filter.free_text) assert.equal(filter.free_text, true)
    }
  }

  const names = events.map(e => e.name)
  for (const required of [
    'ipma.warning.new',
    'fuel.prices.updated',
    'anpc.incident.new',
    'anpc.incident.updated',
    'base.contract.new',
    'ev.prices.updated',
    'dre.diploma.new',
    'parlamento.iniciativa.new',
    'nasafirms.fire.new',
    'bdp.rates.updated',
    'ine.indicator.updated',
    'sns.dataset.updated',
    'farmacias.servico.updated',
    'farmacias.farmacia.new',
    'carris.alert.new',
    'gtfs.changes.new',
    'pt2030.summary.updated',
    'prr.catalogue.updated'
  ]) {
    assert.ok(names.includes(required), required)
  }

  const base = events.find(e => e.name === 'base.contract.new')
  assert.deepEqual(base.filters.map(f => f.key).sort(), ['cpv', 'district', 'municipality', 'nif_entidade', 'valor_min'].sort())
  const muni = base.filters.find(f => f.key === 'municipality')
  assert.equal(muni.type, 'enum')
  assert.equal(muni.multiple, true)
  assert.equal(muni.precision, 'municipality')
  assert.equal(muni.options_source, '/v1/geo/municipalities')
  assert.equal(base.filters.find(f => f.key === 'valor_min').match, 'gte')

  const ipma = events.find(e => e.name === 'ipma.warning.new')
  assert.equal(ipma.filters.some(f => f.key === 'area'), false)
  assert.equal(ipma.filters.find(f => f.key === 'municipality').precision, 'distrito')
  assert.ok(ipma.filters.some(f => f.key === 'min_level'))

  const sns = events.find(e => e.name === 'sns.dataset.updated')
  assert.equal(sns.filters.some(f => f.key === 'regiao'), false)

  const farmacias = events.find(e => e.name === 'farmacias.servico.updated')
  assert.deepEqual(farmacias.filters.map(f => f.key).sort(), ['district', 'municipality'])
  assert.equal(farmacias.filters.find(f => f.key === 'municipality').options_source, '/v1/geo/municipalities')
  assert.equal(farmacias.filters.find(f => f.key === 'district').options_source, '/v1/geo/districts')
  assert.equal(farmacias.geo_precision, 'municipality')
  const farmaciaNew = events.find(e => e.name === 'farmacias.farmacia.new')
  assert.ok(farmaciaNew.filters.some(f => f.key === 'municipality'))
  assert.equal(farmaciaNew.filters.find(f => f.key === 'municipality').options_source, '/v1/geo/municipalities')

  const dre = events.find(e => e.name === 'dre.diploma.new')
  assert.equal(dre.filters.find(f => f.key === 'q').free_text, true)
  assert.deepEqual(dre.filters.find(f => f.key === 'series').options.map(o => o.value), ['I', 'II'])
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
