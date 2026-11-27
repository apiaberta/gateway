import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hasAnyFilterKey,
  normalizeText,
  payloadMatchesFilters,
  shapeAggregatePayload,
  shapeEventPayload,
  valuesMatch
} from '../src/webhooks/filters.js'
import { extractNifs } from '../src/webhooks/poll.js'

test('normalizeText is case- and accent-insensitive', () => {
  assert.equal(normalizeText('Fundão'), 'fundao')
  assert.equal(normalizeText('  FUNDÃO  '), 'fundao')
  assert.equal(normalizeText('São João'), 'sao joao')
  assert.equal(normalizeText('Évora'), 'evora')
})

test('contains_ci matches Fundão against fundao in local', () => {
  const payload = { local: 'Portugal, Castelo Branco, Fundão', value: 12000 }
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { local: 'fundao' }), true)
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { local: 'Fundão' }), true)
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { local: 'Lisboa' }), false)
})

test('equals matches NIF regardless of surrounding label', () => {
  const payload = {
    contractingEntity: '505690173 - Município do Fundão',
    nif_entidade: '505690173',
    nifs: ['505690173'],
    value: 10
  }
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { nif_entidade: '505690173' }), true)
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { nif_entidade: '123456789' }), false)
})

test('gte matches contract value', () => {
  const payload = { local: 'Fundão', value: 50000, nif_entidade: '111111111', nifs: ['111111111'] }
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { valor_min: 50000 }), true)
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { valor_min: 50001 }), false)
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { valor_min: '1000' }), true)
})

test('AND of several filters', () => {
  const payload = {
    local: 'Portugal, Castelo Branco, Fundão',
    nif_entidade: '505690173',
    nifs: ['505690173'],
    cpv: '45233120-2 - Obras de estradas',
    value: 80000
  }
  assert.equal(payloadMatchesFilters('base.contract.new', payload, {
    local: 'Fundao',
    nif_entidade: '505690173',
    cpv: '45233120',
    valor_min: 50000
  }), true)
  assert.equal(payloadMatchesFilters('base.contract.new', payload, {
    local: 'Fundao',
    valor_min: 90000
  }), false)
})

test('empty filters match everything', () => {
  assert.equal(payloadMatchesFilters('ipma.warning.new', { id: '1', level: 'red' }, {}), true)
  assert.equal(payloadMatchesFilters('ipma.warning.new', { id: '1', level: 'red' }), true)
})

test('IPMA level and region filters', () => {
  const warning = { id: 'LSB|Vento|1', level: 'orange', type: 'Vento', region: 'LSB', area: 'LSB' }
  assert.equal(payloadMatchesFilters('ipma.warning.new', warning, { level: 'orange', region: 'LSB' }), true)
  assert.equal(payloadMatchesFilters('ipma.warning.new', warning, { level: 'red' }), false)
  assert.equal(payloadMatchesFilters('ipma.warning.new', warning, { area: 'lsb' }), true)
})

test('ANPC district, concelho and natureza', () => {
  const inc = {
    id: '1',
    type: 'Prevenção a Queimadas',
    natureza: 'Prevenção a Queimadas',
    district: 'Castelo Branco',
    concelho: 'Fundão'
  }
  assert.equal(payloadMatchesFilters('anpc.incident.new', inc, { district: 'castelo branco', concelho: 'fundao' }), true)
  assert.equal(payloadMatchesFilters('anpc.incident.new', inc, { natureza: 'queimadas' }), true)
  assert.equal(payloadMatchesFilters('anpc.incident.new', inc, { type: 'Incêndio' }), false)
})

test('gte/lte numeric matching helpers', () => {
  assert.equal(valuesMatch('gte', 3, [2.8]), false)
  assert.equal(valuesMatch('gte', 3, [3]), true)
  assert.equal(valuesMatch('lte', 10, ['9.5']), true)
})

test('fuel aggregate with municipality sends only matching stations', () => {
  const summary = {
    date: '2026-11-26',
    diesel_avg: 1.6,
    gasoline95_avg: 1.7,
    lpg_avg: 0.9,
    records: 3
  }
  const items = [
    { station_id: 1, municipality: 'Fundão', district: 'Castelo Branco', brand: 'GALP', fuel_slug: 'diesel', price_eur: 1.55 },
    { station_id: 2, municipality: 'Lisboa', district: 'Lisboa', brand: 'BP', fuel_slug: 'diesel', price_eur: 1.7 },
    { station_id: 3, municipality: 'Fundão', district: 'Castelo Branco', brand: 'BP', fuel_slug: 'gasoline_95', price_eur: 1.8 }
  ]

  const shaped = shapeAggregatePayload('fuel.prices.updated', { summary, items }, { municipality: 'Fundao' })
  assert.ok(shaped)
  assert.equal(shaped.records, 2)
  assert.equal(shaped.stations.length, 2)
  assert.deepEqual(shaped.stations.map(s => s.station_id).sort(), [1, 3])
})

test('fuel aggregate with local filters does not fire when nothing matches', () => {
  const summary = { date: '2026-11-26', diesel_avg: 1.6, records: 1 }
  const items = [
    { station_id: 2, municipality: 'Lisboa', district: 'Lisboa', brand: 'BP', fuel_slug: 'diesel' }
  ]
  assert.equal(shapeAggregatePayload('fuel.prices.updated', { summary, items }, { municipality: 'Fundão' }), null)
})

test('fuel without filters keeps national averages', () => {
  const summary = { date: '2026-11-26', diesel_avg: '1.600', records: 10, fuels: [{ fuel_slug: 'diesel' }] }
  const shaped = shapeAggregatePayload('fuel.prices.updated', { summary, items: [] }, {})
  assert.equal(shaped.diesel_avg, '1.600')
  assert.equal(shaped.stations, undefined)
})

test('fuel filter without location keeps matching national fuel rows', () => {
  const summary = {
    date: '2026-11-26',
    diesel_avg: 1.6,
    fuels: [
      { fuel_slug: 'diesel', avg_price_eur: 1.6 },
      { fuel_slug: 'gasoline_95', avg_price_eur: 1.8 }
    ]
  }
  const shaped = shapeAggregatePayload('fuel.prices.updated', { summary, items: [] }, { fuel: 'diesel' })
  assert.ok(shaped)
  assert.equal(shaped.fuels.length, 1)
  assert.equal(shaped.fuels[0].fuel_slug, 'diesel')
})

test('shapeEventPayload skips webhooks whose filters miss', () => {
  assert.equal(shapeEventPayload('ipma.warning.new', { id: '1', level: 'green', region: 'LSB', area: 'LSB', type: 'Vento' }, { level: 'red' }), null)
  const kept = shapeEventPayload('ipma.warning.new', { id: '1', level: 'red', region: 'LSB', area: 'LSB', type: 'Vento' }, { level: 'red' })
  assert.equal(kept.id, '1')
})

test('hasAnyFilterKey ignores empty strings', () => {
  assert.equal(hasAnyFilterKey({ municipality: '' }, ['municipality']), false)
  assert.equal(hasAnyFilterKey({ municipality: 'Fundão' }, ['municipality']), true)
})

test('extractNifs pulls 9-digit NIF from BASE labels', () => {
  assert.deepEqual(
    extractNifs('505456010 - Município da Amadora', '504041762 - ChoiceCar, S.A'),
    ['505456010', '504041762']
  )
})
