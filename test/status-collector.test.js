import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import Fastify from 'fastify'
import { config } from '../src/config.js'
import {
  StatusCheck,
  StatusDaily,
  StatusIncident,
  StatusLock
} from '../src/db.js'
import {
  acquireCollectorLock,
  upsertDaily,
  syncIncident,
  persistCheckResults,
  collectStatusOnce,
  LOCK_TTL_MS
} from '../src/plugins/status-collector.js'
import { statusRoutes } from '../src/routes/status.js'
import { PUBLIC_ROUTES, authenticate } from '../src/plugins/authenticate.js'
import { lisbonDateString } from '../src/services/status-history.js'

let mongod

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
  await mongoose.connect(uri, { dbName: 'status-history-test' })
  await Promise.all([
    StatusCheck.syncIndexes(),
    StatusDaily.syncIndexes(),
    StatusIncident.syncIndexes(),
    StatusLock.syncIndexes()
  ])
})

after(async () => {
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

beforeEach(async () => {
  await Promise.all([
    StatusCheck.deleteMany({}),
    StatusDaily.deleteMany({}),
    StatusIncident.deleteMany({}),
    StatusLock.deleteMany({})
  ])
})

test('tests never connect mongoose to MONGO_URI', () => {
  const { host } = mongoose.connection
  assert.ok(host === '127.0.0.1' || host === 'localhost')
  assert.equal(mongoose.connection.name, 'status-history-test')
})

test('status_checks TTL index is 95 days', () => {
  const ttl = StatusCheck.schema.indexes().find(([, opts]) => opts?.expireAfterSeconds)
  assert.ok(ttl)
  assert.equal(ttl[1].expireAfterSeconds, 95 * 24 * 60 * 60)
})

test('status_daily has a unique service+date index and no TTL', () => {
  const indexes = StatusDaily.schema.indexes()
  const unique = indexes.find(([{ service, date }, opts]) => service === 1 && date === 1 && opts?.unique)
  assert.ok(unique)
  assert.equal(indexes.some(([, opts]) => opts?.expireAfterSeconds != null), false)
})

test('Mongo lock allows only one owner at a time and can be stolen after expiry', async () => {
  const now = new Date('2026-11-06T12:00:00Z')
  assert.equal(await acquireCollectorLock(now, 'worker-a'), true)
  assert.equal(await acquireCollectorLock(now, 'worker-b'), false)
  assert.equal(await acquireCollectorLock(now, 'worker-a'), true)

  const later = new Date(now.getTime() + LOCK_TTL_MS + 1)
  assert.equal(await acquireCollectorLock(later, 'worker-b'), true)
  assert.equal(await acquireCollectorLock(later, 'worker-a'), false)
})

test('upsertDaily aggregates counts and running average latency', async () => {
  const timestamp = new Date('2026-11-06T12:00:00Z')
  const date = lisbonDateString(timestamp)

  await upsertDaily({ service: 'fuel', status: 'up', latencyMs: 10, timestamp })
  await upsertDaily({ service: 'fuel', status: 'degraded', latencyMs: 30, timestamp })
  await upsertDaily({ service: 'fuel', status: 'down', latencyMs: 50, timestamp })

  const row = await StatusDaily.findOne({ service: 'fuel', date }).lean()
  assert.equal(row.checks, 3)
  assert.equal(row.up, 1)
  assert.equal(row.degraded, 1)
  assert.equal(row.down, 1)
  assert.equal(row.avgLatencyMs, 30)
})

test('syncIncident opens on down/degraded and closes when the service is up', async () => {
  const t0 = new Date('2026-11-06T10:00:00Z')
  const t1 = new Date('2026-11-06T10:01:00Z')
  const t2 = new Date('2026-11-06T10:05:00Z')
  const t3 = new Date('2026-11-06T11:00:00Z')

  await syncIncident({ service: 'fuel', status: 'up', timestamp: t0 })
  assert.equal(await StatusIncident.countDocuments(), 0)

  await syncIncident({ service: 'fuel', status: 'down', timestamp: t1 })
  await syncIncident({ service: 'fuel', status: 'down', timestamp: t2 })
  await syncIncident({ service: 'fuel', status: 'degraded', timestamp: t2 })

  const open = await StatusIncident.find({ service: 'fuel' }).lean()
  assert.equal(open.length, 1)
  assert.equal(open[0].status, 'down')
  assert.equal(open[0].resolvedAt, null)

  await syncIncident({ service: 'fuel', status: 'up', timestamp: t3 })
  const closed = await StatusIncident.findOne({ service: 'fuel' }).lean()
  assert.equal(new Date(closed.resolvedAt).toISOString(), t3.toISOString())

  await syncIncident({ service: 'fuel', status: 'degraded', timestamp: t3 })
  assert.equal(await StatusIncident.countDocuments({ service: 'fuel' }), 2)
})

test('persistCheckResults writes raw checks and daily rows', async () => {
  const timestamp = new Date('2026-11-06T12:00:00Z')
  await persistCheckResults([
    { service: 'fuel', status: 'up', latencyMs: 12, timestamp },
    { service: 'ipma', status: 'down', latencyMs: 5000, timestamp }
  ])

  assert.equal(await StatusCheck.countDocuments(), 2)
  assert.equal(await StatusDaily.countDocuments(), 2)
  assert.equal(await StatusIncident.countDocuments({ service: 'ipma', resolvedAt: null }), 1)
  assert.equal(await StatusIncident.countDocuments({ service: 'fuel' }), 0)
})

function startHealthServer(getStatus) {
  const requests = []
  const server = createServer((req, res) => {
    requests.push(req.url)
    const current = getStatus()
    res.writeHead(current.http, { 'content-type': 'application/json' })
    res.end(JSON.stringify(current.body))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        requests,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done, fail) => server.close(err => err ? fail(err) : done()))
      })
    })
  })
}

test('collectStatusOnce reuses checkService and does not double-run without the lock', async () => {
  const original = config.services.slice()
  let health = { http: 200, body: { status: 'ok', version: '1' } }
  const mock = await startHealthServer(() => health)

  config.services.length = 0
  config.services.push({ name: 'Fuel Prices (DGEG)', prefix: '/fuel', target: mock.url })

  try {
    const first = await collectStatusOnce(null, {
      now: new Date('2026-11-06T12:00:00Z'),
      owner: 'collector-test'
    })
    assert.equal(first.skipped, false)
    assert.equal(first.count, 1)
    assert.equal(mock.requests[0], '/health')
    assert.equal(await StatusCheck.countDocuments({ service: 'fuel', status: 'up' }), 1)

    const blocked = await collectStatusOnce(null, {
      now: new Date('2026-11-06T12:00:00Z'),
      owner: 'other-instance'
    })
    assert.deepEqual(blocked, { skipped: true, reason: 'lock' })
    assert.equal(await StatusCheck.countDocuments(), 1)

    health = { http: 503, body: { status: 'error' } }
    const down = await collectStatusOnce(null, {
      now: new Date('2026-11-06T12:01:00Z'),
      owner: 'collector-test'
    })
    assert.equal(down.skipped, false)
    assert.equal(await StatusCheck.countDocuments({ status: 'down' }), 1)
    assert.equal(await StatusIncident.countDocuments({ service: 'fuel', status: 'down', resolvedAt: null }), 1)
  } finally {
    config.services.length = 0
    config.services.push(...original)
    await mock.close()
  }
})

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(statusRoutes, { prefix: '/v1' })
  await app.ready()
  return app
}

test('GET /v1/status/history returns the documented shape with filled dates', async () => {
  const generatedDay = lisbonDateString(new Date())
  await StatusDaily.create({
    service: 'fuel',
    date: generatedDay,
    checks: 10,
    up: 8,
    degraded: 2,
    down: 0,
    avgLatencyMs: 25
  })

  const app = await buildApp()
  try {
    const res = await app.inject({ method: 'GET', url: '/v1/status/history?days=5' })
    assert.equal(res.statusCode, 200)
    assert.match(res.headers['cache-control'], /max-age=30/)
    assert.match(res.headers['cache-control'], /public/)

    const body = res.json()
    assert.equal(body.days, 5)
    assert.ok(body.generatedAt)
    assert.equal(typeof body.overall.uptime, 'number')
    assert.equal(body.services.length, config.services.length)

    const fuel = body.services.find(s => s.id === 'fuel')
    assert.ok(fuel)
    assert.equal(fuel.name, 'Fuel Prices (DGEG)')
    assert.equal(fuel.days.length, 5)
    assert.deepEqual(fuel.days.map(d => d.date).at(-1), generatedDay)
    const today = fuel.days.at(-1)
    assert.equal(today.uptime, 0.9)
    assert.equal(today.checks, 10)
    assert.equal(today.degraded, 2)
    assert.equal(today.avgLatencyMs, 25)
    assert.ok(fuel.days.slice(0, 4).every(d => d.uptime === null && d.checks === 0))

    const other = body.services.find(s => s.id === 'ipma')
    assert.ok(other.days.every(d => d.uptime === null))
  } finally {
    await app.close()
  }
})

test('GET /v1/status/history clamps days at 365', async () => {
  const app = await buildApp()
  try {
    const res = await app.inject({ method: 'GET', url: '/v1/status/history?days=900' })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.days, 365)
    assert.equal(body.services[0].days.length, 365)
    assert.equal(body.overall.uptime, null)
  } finally {
    await app.close()
  }
})

test('GET /v1/status/incidents returns durationMin and open incidents', async () => {
  const startedAt = new Date(Date.now() - 30 * 60 * 1000)
  await StatusIncident.create({
    service: 'fuel',
    status: 'down',
    startedAt,
    resolvedAt: null
  })
  await StatusIncident.create({
    service: 'ipma',
    status: 'degraded',
    startedAt: new Date('2020-01-01T00:00:00Z'),
    resolvedAt: new Date('2020-01-01T01:00:00Z')
  })

  const app = await buildApp()
  try {
    const res = await app.inject({ method: 'GET', url: '/v1/status/incidents?days=90' })
    assert.equal(res.statusCode, 200)
    assert.match(res.headers['cache-control'], /max-age=30/)
    const body = res.json()
    assert.equal(body.incidents.length, 1)
    assert.equal(body.incidents[0].service, 'fuel')
    assert.equal(body.incidents[0].status, 'down')
    assert.equal(body.incidents[0].resolvedAt, null)
    assert.ok(body.incidents[0].durationMin >= 29)
    assert.ok(body.incidents[0].startedAt)
  } finally {
    await app.close()
  }
})

test('GET /v1/status does not write history documents', async () => {
  const original = config.services.slice()
  const mock = await startHealthServer(() => ({ http: 200, body: { status: 'ok' } }))
  config.services.length = 0
  config.services.push({ name: 'Fuel Prices (DGEG)', prefix: '/fuel', target: mock.url })

  const app = await buildApp()
  try {
    const res = await app.inject({ method: 'GET', url: '/v1/status' })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.status, 'ok')
    assert.equal(body.services[0].status, 'up')
    assert.equal(await StatusCheck.countDocuments(), 0)
    assert.equal(await StatusDaily.countDocuments(), 0)
    assert.equal(await StatusIncident.countDocuments(), 0)
  } finally {
    await app.close()
    config.services.length = 0
    config.services.push(...original)
    await mock.close()
  }
})

test('history and incidents paths are public', async () => {
  assert.ok(PUBLIC_ROUTES.some(r => '/v1/status/history'.startsWith(r)))
  assert.ok(PUBLIC_ROUTES.some(r => '/v1/status/incidents'.startsWith(r)))

  for (const url of ['/v1/status/history?days=90', '/v1/status/incidents']) {
    const reply = {
      code() { throw new Error(`auth should skip ${url}`) },
      send() { throw new Error(`auth should skip ${url}`) },
      header() { return this }
    }
    await authenticate({ url, headers: {} }, reply)
  }
})
