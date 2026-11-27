import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server-core'
import Fastify from 'fastify'
import { Developer, Webhook, WebhookDelivery, EventState } from '../src/db.js'
import { webhookRoutes } from '../src/routes/webhooks.js'
import { dispatchEvent } from '../src/webhooks/dispatch.js'
import {
  pollANPCIncidents,
  pollBASEContracts,
  pollFuelPrices,
  pollForEvents,
  pollIPMAWarnings,
  stableWarningId,
  takeNewItems
} from '../src/webhooks/poll.js'
import { publicEventCatalog, SUPPORTED_EVENTS } from '../src/webhooks/catalog.js'

let mongod
let origFetch

function assertLocalMemoryUri(uri) {
  const parsed = new URL(uri)
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
  assert.ok(local, `tests must use a local MongoDB, got host ${parsed.hostname}`)
  assert.notEqual(uri, process.env.MONGO_URI)
}

before(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri()
  assertLocalMemoryUri(uri)
  await mongoose.connect(uri, { dbName: 'webhook-events-test' })
  await Promise.all([
    Developer.syncIndexes(),
    Webhook.syncIndexes(),
    WebhookDelivery.syncIndexes(),
    EventState.syncIndexes()
  ])
})

after(async () => {
  if (origFetch) globalThis.fetch = origFetch
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

beforeEach(async () => {
  if (origFetch) globalThis.fetch = origFetch
  await Promise.all([
    Developer.deleteMany({}),
    Webhook.deleteMany({}),
    WebhookDelivery.deleteMany({}),
    EventState.deleteMany({})
  ])
})

function mockFetch(handlers) {
  origFetch = origFetch || globalThis.fetch
  globalThis.fetch = async (url) => {
    const href = String(url)
    for (const [needle, body] of Object.entries(handlers)) {
      if (href.includes(needle)) {
        const payload = typeof body === 'function' ? body(href) : body
        return {
          ok: true,
          status: 200,
          json: async () => payload,
          text: async () => JSON.stringify(payload)
        }
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
  }
}

async function seedDeveloper() {
  return Developer.create({
    email: 'dev@example.com',
    passwordHash: 'x',
    apiKey: 'ak_test_webhooks',
    name: 'Test'
  })
}

async function seedWebhook(dev, { events, filters = {}, url = 'https://example.com/hook' } = {}) {
  return Webhook.create({
    developerId: dev._id,
    apiKey: dev.apiKey,
    url,
    events,
    filters,
    secret: 'whsec_test',
    active: true
  })
}

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(webhookRoutes, { prefix: '/v1/webhooks' })
  await app.ready()
  return app
}

test('tests never connect mongoose to MONGO_URI', () => {
  const { host } = mongoose.connection
  assert.ok(host === '127.0.0.1' || host === 'localhost')
  assert.equal(mongoose.connection.name, 'webhook-events-test')
})

test('takeNewItems seeds without returning fresh rows', async () => {
  const first = await takeNewItems('t.ids', [{ id: 'a' }, { id: 'b' }], { idOf: x => x.id })
  assert.equal(first.seeded, true)
  assert.deepEqual(first.fresh, [])

  const second = await takeNewItems('t.ids', [{ id: 'a' }, { id: 'b' }, { id: 'c' }], { idOf: x => x.id })
  assert.equal(second.seeded, false)
  assert.equal(second.fresh.length, 1)
  assert.equal(second.fresh[0].id, 'c')
})

test('IPMA poll is idempotent on first snapshot then dispatches new ids', async () => {
  const dev = await seedDeveloper()
  await seedWebhook(dev, { events: ['ipma.warning.new'] })

  const warnings = [
    { id: 'LSB|Vento|1', level: 'yellow', type: 'Vento', text: 'x', region: 'LSB', startTime: 't0', endTime: 't1' },
    { id: 'LSB|Neve|1', level: 'orange', type: 'Neve', text: 'y', region: 'LSB', startTime: 't0', endTime: 't1' }
  ]
  mockFetch({ '/ipma/warnings': { data: warnings } })

  await pollIPMAWarnings()
  assert.equal(await WebhookDelivery.countDocuments(), 0)

  mockFetch({
    '/ipma/warnings': {
      data: [
        ...warnings,
        { id: 'FAR|Vento|2', level: 'red', type: 'Vento', text: 'z', region: 'FAR', startTime: 't2', endTime: 't3' }
      ]
    }
  })
  await pollIPMAWarnings()
  const deliveries = await WebhookDelivery.find().lean()
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0].event, 'ipma.warning.new')
  assert.equal(deliveries[0].payload.id, stableWarningId({
    region: 'FAR', type: 'Vento', level: 'red', startTime: 't2', endTime: 't3'
  }))
  assert.equal(deliveries[0].status, 'pending')
})

test('IPMA region filter skips non-matching warnings', async () => {
  const dev = await seedDeveloper()
  await seedWebhook(dev, {
    events: ['ipma.warning.new'],
    filters: { 'ipma.warning.new': { region: 'LSB' } }
  })
  await EventState.create({ key: 'ipma.warning.ids', value: ['old'] })

  mockFetch({
    '/ipma/warnings': {
      data: [
        { id: 'new-far', level: 'red', type: 'Vento', region: 'FAR', area: 'FAR' },
        { id: 'new-lsb', level: 'yellow', type: 'Vento', region: 'LSB', area: 'LSB' }
      ]
    }
  })
  await pollIPMAWarnings()
  const deliveries = await WebhookDelivery.find().lean()
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0].payload.region, 'LSB')
})

test('BASE poll maps local and NIF and applies municipality / gte filters', async () => {
  const dev = await seedDeveloper()
  await seedWebhook(dev, {
    events: ['base.contract.new'],
    filters: { 'base.contract.new': { municipality: '0504', valor_min: 10000 } }
  })
  await EventState.create({ key: 'base.contract.ids', value: ['1'] })

  mockFetch({
    '/base/contracts': {
      data: [
        { id: '2', description: 'Estrada', contractingEntity: '505690173 - Município do Fundão', awarded: '123456789 - X', value: 25000, date: '2026-11-26', type: 'Ajuste Direto', local: 'Portugal, Castelo Branco, Fundão' },
        { id: '3', description: 'Lisboa', contractingEntity: '500000000 - CML', awarded: '1', value: 90000, date: '2026-11-26', type: 'Ajuste Direto', local: 'Portugal, Lisboa, Lisboa' },
        { id: '4', description: 'Pequeno', contractingEntity: '505690173 - Município do Fundão', awarded: '1', value: 50, date: '2026-11-26', type: 'Ajuste Direto', local: 'Fundão' }
      ]
    }
  })
  await pollBASEContracts()
  const deliveries = await WebhookDelivery.find().lean()
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0].payload.id, '2')
  assert.equal(deliveries[0].payload.nif_entidade, '505690173')
  assert.deepEqual(deliveries[0].payload.municipality_codes, ['0504'])
  assert.match(deliveries[0].payload.local, /Fundão/)
})

test('ANPC poll flattens concelho from location.address', async () => {
  const dev = await seedDeveloper()
  await seedWebhook(dev, {
    events: ['anpc.incident.new'],
    filters: { 'anpc.incident.new': { municipality: '0206' } }
  })
  await EventState.create({ key: 'anpc.incident.snapshot', value: {} })
  mockFetch({
    '/anpc/incidents': {
      data: [{
        id: '20261676440',
        type: 'Prevenção a Queimadas',
        status: 'Em Curso',
        datetime: '2026-11-26T13:48:00.000Z',
        location: { district: 'Beja', address: 'Beja, Castro Verde, Entradas' }
      }]
    }
  })
  await pollANPCIncidents()
  const deliveries = await WebhookDelivery.find().lean()
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0].payload.concelho, 'Castro Verde')
  assert.equal(deliveries[0].payload.municipality_code, '0206')
  assert.equal(deliveries[0].payload.district, 'Beja')
})

test('fuel poll seeds the date then dispatches stations for local filters', async () => {
  const dev = await seedDeveloper()
  await seedWebhook(dev, {
    events: ['fuel.prices.updated'],
    filters: { 'fuel.prices.updated': { municipality: '0504', fuel: 'diesel' } }
  })

  const prices = {
    data: [
      { fuel_slug: 'diesel', avg_price_eur: 1.6, station_count: 2, date: '2026-11-25' }
    ]
  }
  mockFetch({
    '/fuel/prices': prices,
    '/fuel/stations': { meta: { page: 1, pages: 1 }, data: [] }
  })
  await pollFuelPrices()
  assert.equal(await WebhookDelivery.countDocuments(), 0)
  assert.equal(await EventState.findOne({ key: 'fuel.prices.date' }).then(s => s.value), '2026-11-25')

  mockFetch({
    '/fuel/prices': {
      data: [{ fuel_slug: 'diesel', avg_price_eur: 1.61, station_count: 2, date: '2026-11-26' }]
    },
    '/fuel/stations': {
      meta: { page: 1, pages: 1 },
      data: [
        { station_id: 11, name: 'A', municipality: 'Fundão', district: 'Castelo Branco', brand: 'GALP', fuel_name: 'Gasóleo simples', price_eur: 1.5 },
        { station_id: 12, name: 'B', municipality: 'Lisboa', district: 'Lisboa', brand: 'BP', fuel_name: 'Gasóleo simples', price_eur: 1.7 }
      ]
    }
  })
  await pollFuelPrices()
  const deliveries = await WebhookDelivery.find().lean()
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0].payload.records, 1)
  assert.equal(deliveries[0].payload.stations.length, 1)
  assert.equal(deliveries[0].payload.stations[0].station_id, 11)
  assert.equal(deliveries[0].payload.diesel_avg, undefined)
})

test('unfiltered fuel webhook keeps national averages when date changes', async () => {
  const dev = await seedDeveloper()
  await seedWebhook(dev, { events: ['fuel.prices.updated'] })
  await EventState.create({ key: 'fuel.prices.date', value: '2026-11-25' })

  mockFetch({
    '/fuel/prices': {
      data: [
        { fuel_slug: 'diesel', avg_price_eur: 1.61, station_count: 10, date: '2026-11-26' },
        { fuel_slug: 'gasoline_95', avg_price_eur: 1.9, station_count: 10, date: '2026-11-26' }
      ]
    }
  })
  await pollFuelPrices()
  const deliveries = await WebhookDelivery.find().lean()
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0].payload.diesel_avg, 1.61)
  assert.equal(deliveries[0].payload.gasoline95_avg, 1.9)
  assert.equal(deliveries[0].payload.stations, undefined)
})

test('dispatchEvent does not queue deliveries for inactive webhooks', async () => {
  const dev = await seedDeveloper()
  await Webhook.create({
    developerId: dev._id,
    apiKey: dev.apiKey,
    url: 'https://example.com/hook',
    events: ['ine.indicator.updated'],
    secret: 'whsec_test',
    active: false
  })
  await dispatchEvent('ine.indicator.updated', { indicator: 'gdp', year: 2025, value: 1 })
  assert.equal(await WebhookDelivery.countDocuments(), 0)
})

test('pollForEvents with all connectors failing does not throw', async () => {
  mockFetch({})
  await pollForEvents()
})

test('POST /v1/webhooks stores filters; GET lists them; PATCH updates', async () => {
  const dev = await seedDeveloper()
  const app = await buildApp()
  const headers = { 'x-api-key': dev.apiKey, 'content-type': 'application/json' }

  const created = await app.inject({
    method: 'POST',
    url: '/v1/webhooks',
    headers,
    payload: {
      url: 'https://example.com/hook',
      events: ['base.contract.new', 'fuel.prices.updated'],
      filters: {
        'base.contract.new': { local: 'Fundão' },
        'fuel.prices.updated': { municipality: 'Fundão', fuel: 'diesel' }
      }
    }
  })
  assert.equal(created.statusCode, 201, created.body)
  const body = created.json()
  assert.equal(body.filters['base.contract.new'].municipality, '0504')
  assert.equal(body.filters['fuel.prices.updated'].municipality, '0504')
  assert.equal(body.active, true)
  assert.match(body.secret, /^whsec_/)

  const listed = await app.inject({ method: 'GET', url: '/v1/webhooks', headers })
  assert.equal(listed.statusCode, 200)
  const list = listed.json()
  assert.equal(list.data[0].filters['fuel.prices.updated'].fuel, 'diesel')
  assert.equal(list.data[0].secret, undefined)

  const patched = await app.inject({
    method: 'PATCH',
    url: `/v1/webhooks/${body.id}`,
    headers,
    payload: {
      events: ['base.contract.new'],
      filters: { 'base.contract.new': { local: 'Lisboa', valor_min: 1000 } },
      active: true
    }
  })
  assert.equal(patched.statusCode, 200, patched.body)
  const updated = patched.json()
  assert.deepEqual(updated.events, ['base.contract.new'])
  assert.equal(updated.filters['base.contract.new'].municipality, '1106')
  assert.equal(updated.filters['base.contract.new'].valor_min, 1000)
  assert.equal(updated.filters['fuel.prices.updated'], undefined)
  assert.equal(updated.active, true)

  const httpUrl = await app.inject({
    method: 'POST',
    url: '/v1/webhooks',
    headers,
    payload: { url: 'http://example.com/hook', events: ['ipma.warning.new'] }
  })
  assert.equal(httpUrl.statusCode, 400)

  const badFilter = await app.inject({
    method: 'PATCH',
    url: `/v1/webhooks/${body.id}`,
    headers,
    payload: { filters: { 'base.contract.new': { country: 'PT' } } }
  })
  assert.equal(badFilter.statusCode, 400)

  const events = await app.inject({ method: 'GET', url: '/v1/webhooks/events' })
  assert.equal(events.statusCode, 200)
  const catalog = events.json()
  assert.ok(catalog.events.length === publicEventCatalog().length)
  assert.ok(catalog.events[0].label_pt)
  assert.ok(catalog.events[0].filters)
  assert.ok(catalog.lookup_only.some(s => s.service === '/v1/nif'))
  assert.ok(SUPPORTED_EVENTS.includes('parlamento.iniciativa.new'))
  assert.ok(catalog.refs?.municipalities?.length >= 308)
  assert.ok(catalog.events.find(e => e.name === 'base.contract.new').filters.find(f => f.key === 'municipality').options_source)

  await app.close()
})

test('BASE poller pages past 20 and dispatches every new contract', async () => {
  const dev = await seedDeveloper()
  await seedWebhook(dev, { events: ['base.contract.new'] })
  await EventState.create({ key: 'base.contract.ids', value: ['old'] })

  const contracts = Array.from({ length: 1047 }, (_, i) => ({
    id: String(2000 + i),
    description: `c${i}`,
    contractingEntity: '505456010 - X',
    awarded: '123456789 - Y',
    value: 10,
    date: '2026-11-26',
    type: 'Ajuste Direto',
    local: 'Portugal, Castelo Branco, Fundão',
    synced_at: '2026-11-27T03:00:00.000Z'
  }))

  let maxLimit = 0
  let pagesSeen = new Set()
  mockFetch({
    '/base/contracts': href => {
      const url = new URL(href, 'http://gateway.test')
      const limit = Number(url.searchParams.get('limit') || 20)
      const page = Number(url.searchParams.get('page') || 1)
      maxLimit = Math.max(maxLimit, limit)
      pagesSeen.add(page)
      const start = (page - 1) * limit
      return {
        total: contracts.length,
        page,
        limit,
        pages: Math.ceil(contracts.length / limit),
        data: contracts.slice(start, start + limit)
      }
    }
  })

  await pollBASEContracts()
  const deliveries = await WebhookDelivery.find().lean()
  assert.ok(maxLimit >= 100, `expected pagination limit >= 100, got ${maxLimit}`)
  assert.ok(pagesSeen.size > 1, 'expected more than one page')
  assert.equal(deliveries.length, 1047)
})

test('IPMA re-issue with a new start/end does not duplicate a stable warning', async () => {
  const dev = await seedDeveloper()
  await seedWebhook(dev, { events: ['ipma.warning.new'] })
  const warning = {
    id: 'CBO|Vento|2026-11-26T19:47:00|2026-11-29T19:00:00',
    level: 'yellow',
    type: 'Vento',
    region: 'CBO',
    startTime: '2026-11-26T19:47:00.000Z',
    endTime: '2026-11-29T19:00:00.000Z'
  }
  mockFetch({ '/ipma/warnings': { data: [warning] } })
  await pollIPMAWarnings()
  assert.equal(await WebhookDelivery.countDocuments(), 0)

  mockFetch({
    '/ipma/warnings': {
      data: [{
        ...warning,
        id: 'CBO|Vento|2026-11-26T20:12:00|2026-11-29T19:00:00',
        startTime: '2026-11-26T20:12:00.000Z'
      }]
    }
  })
  await pollIPMAWarnings()
  assert.equal(await WebhookDelivery.countDocuments(), 0)
})

test('ANPC status change dispatches incident.updated', async () => {
  const dev = await seedDeveloper()
  await seedWebhook(dev, { events: ['anpc.incident.new', 'anpc.incident.updated'] })
  await EventState.create({
    key: 'anpc.incident.snapshot',
    value: { '20261676440': { status: 'Em Curso', active: true } }
  })
  mockFetch({
    '/anpc/incidents': {
      data: [{
        id: '20261676440',
        type: 'Prevenção a Queimadas',
        type_code: '4335',
        status: 'Em Resolução',
        active: true,
        location: { district: 'Beja', address: 'Beja, Castro Verde, Entradas' }
      }]
    }
  })
  await pollANPCIncidents()
  const deliveries = await WebhookDelivery.find().lean()
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0].event, 'anpc.incident.updated')
  assert.deepEqual(deliveries[0].payload.changed, ['status'])
})

