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
import { parseBaseLocal } from '../src/webhooks/geo-ref.js'
import { extractNifs } from '../src/webhooks/poll.js'

test('normalizeText is case- and accent-insensitive', () => {
  assert.equal(normalizeText('Fundão'), 'fundao')
  assert.equal(normalizeText('  FUNDÃO  '), 'fundao')
  assert.equal(normalizeText('São João'), 'sao joao')
  assert.equal(normalizeText('Évora'), 'evora')
})

test('municipality enum matches INE codes from BASE local lines', () => {
  const geo = parseBaseLocal('Portugal, Castelo Branco, Fundão')
  const payload = { local: 'Portugal, Castelo Branco, Fundão', municipality_codes: geo.municipality_codes, value: 12000 }
  assert.deepEqual(geo.municipality_codes, ['0504'])
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { municipality: '0504' }), true)
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { municipality: 'Fundão' }), true)
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { municipality: '1106' }), false)
})

test('multi-line BASE local yields several municipality_codes', () => {
  const geo = parseBaseLocal('Portugal, Lisboa, Lisboa\nPortugal, Castelo Branco, Fundão')
  assert.deepEqual(geo.municipality_codes.sort(), ['0504', '1106'])
  const payload = { municipality_codes: geo.municipality_codes, value: 1 }
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { municipality: ['0504'] }), true)
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { municipality: ['0904'] }), false)
})

test('equals matches NIF regardless of surrounding label', () => {
  const payload = {
    contractingEntity: '505456010 - Município da Amadora',
    nif_entidade: '505456010',
    nifs: ['505456010'],
    value: 10
  }
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { nif_entidade: '505456010' }), true)
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { nif_entidade: '123456789' }), false)
})

test('gte matches contract value', () => {
  const payload = { municipality_codes: ['0504'], value: 50000, nif_entidade: '505456010', nifs: ['505456010'] }
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { valor_min: 50000 }), true)
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { valor_min: 50001 }), false)
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { valor_min: '1000' }), true)
})

test('AND of several filters; CPV is a prefix on the code', () => {
  const payload = {
    municipality_codes: ['0504'],
    nif_entidade: '505456010',
    nifs: ['505456010'],
    cpv: '45233120-2 - Obras de estradas',
    value: 80000
  }
  assert.equal(payloadMatchesFilters('base.contract.new', payload, {
    municipality: '0504',
    nif_entidade: '505456010',
    cpv: '45',
    valor_min: 50000
  }), true)
  assert.equal(payloadMatchesFilters('base.contract.new', payload, {
    municipality: '0504',
    valor_min: 90000
  }), false)
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { cpv: '45233120' }), true)
  assert.equal(payloadMatchesFilters('base.contract.new', payload, { cpv: '90' }), false)
})

test('empty filters match everything', () => {
  assert.equal(payloadMatchesFilters('ipma.warning.new', { id: '1', level: 'red' }, {}), true)
  assert.equal(payloadMatchesFilters('ipma.warning.new', { id: '1', level: 'red' }), true)
})

test('IPMA level arrays are OR; min_level excludes lower ranks', () => {
  const warning = { id: 'LSB|Vento|1', level: 'orange', type: 'Vento', region: 'LSB', area: 'LSB' }
  assert.equal(payloadMatchesFilters('ipma.warning.new', warning, { level: ['yellow', 'orange', 'red'] }), true)
  assert.equal(payloadMatchesFilters('ipma.warning.new', warning, { level: ['yellow', 'orange', 'red'] })
    && payloadMatchesFilters('ipma.warning.new', { ...warning, level: 'green' }, { level: ['yellow', 'orange', 'red'] }), false)
  assert.equal(payloadMatchesFilters('ipma.warning.new', warning, { min_level: 'yellow' }), true)
  assert.equal(payloadMatchesFilters('ipma.warning.new', warning, { min_level: 'red' }), false)
  assert.equal(payloadMatchesFilters('ipma.warning.new', { ...warning, region: 'CBO' }, { municipality: '0504' }), true)
})

test('shapeEventPayload skips green IPMA warnings by default', () => {
  const green = { id: '1', level: 'green', region: 'LSB', area: 'LSB', type: 'Vento' }
  const yellow = { id: '2', level: 'yellow', region: 'LSB', area: 'LSB', type: 'Vento' }
  assert.equal(shapeEventPayload('ipma.warning.new', green, {}), null)
  assert.equal(shapeEventPayload('ipma.warning.new', yellow, {}).id, '2')
  assert.equal(shapeEventPayload('ipma.warning.new', green, { level: 'green' }).id, '1')
})

test('ANPC district and municipality match INE codes', () => {
  const inc = {
    id: '1',
    type: 'Prevenção a Queimadas',
    type_code: '4335',
    natureza: 'Prevenção a Queimadas',
    district: 'Castelo Branco',
    district_code: '05',
    concelho: 'Fundão',
    municipality_code: '0504'
  }
  assert.equal(payloadMatchesFilters('anpc.incident.new', inc, { district: '05', municipality: '0504' }), true)
  assert.equal(payloadMatchesFilters('anpc.incident.new', inc, { natureza: '4335' }), true)
  assert.equal(payloadMatchesFilters('anpc.incident.new', inc, { natureza: '3103' }), false)
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
    { station_id: 1, municipality: 'Fundão', municipality_code: '0504', district: 'Castelo Branco', district_code: '05', brand: 'GALP', fuel_slug: 'diesel', price_eur: 1.55 },
    { station_id: 2, municipality: 'Lisboa', municipality_code: '1106', district: 'Lisboa', district_code: '11', brand: 'BP', fuel_slug: 'diesel', price_eur: 1.7 },
    { station_id: 3, municipality: 'Fundão', municipality_code: '0504', district: 'Castelo Branco', district_code: '05', brand: 'BP', fuel_slug: 'gasoline_95', price_eur: 1.8 }
  ]

  const shaped = shapeAggregatePayload('fuel.prices.updated', { summary, items }, { municipality: '0504' })
  assert.ok(shaped)
  assert.equal(shaped.records, 2)
  assert.equal(shaped.stations.length, 2)
  assert.deepEqual(shaped.stations.map(s => s.station_id).sort(), [1, 3])
})

test('fuel aggregate with local filters does not fire when nothing matches', () => {
  const summary = { date: '2026-11-26', diesel_avg: 1.6, records: 1 }
  const items = [
    { station_id: 2, municipality: 'Lisboa', municipality_code: '1106', district: 'Lisboa', district_code: '11', brand: 'BP', fuel_slug: 'diesel' }
  ]
  assert.equal(shapeAggregatePayload('fuel.prices.updated', { summary, items }, { municipality: '0504' }), null)
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
  assert.equal(hasAnyFilterKey({ municipality: '0504' }, ['municipality']), true)
})

test('extractNifs pulls 9-digit NIF from BASE labels', () => {
  assert.deepEqual(
    extractNifs('505456010 - Município da Amadora', '504041762 - ChoiceCar, S.A'),
    ['505456010', '504041762']
  )
})

test('DRE series I/II and radius filter', () => {
  assert.equal(payloadMatchesFilters('dre.diploma.new', { series: 'II', title: 'x' }, { series: 'II' }), true)
  assert.equal(payloadMatchesFilters('dre.diploma.new', { series: 'II', title: 'x' }, { series: 'I' }), false)

  const quake = { id: '1', lat: 40.14, lon: -7.50, magnitude: 3 }
  assert.equal(payloadMatchesFilters('ipma.seismic.new', quake, { radius: { lat: 40.14, lon: -7.50, km: 10 } }), true)
  assert.equal(payloadMatchesFilters('ipma.seismic.new', quake, { radius: { lat: 38.7, lon: -9.1, km: 10 } }), false)
})
