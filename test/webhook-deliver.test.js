import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server-core'
import Fastify from 'fastify'
import { Developer, StatusLock, Webhook, WebhookDelivery } from '../src/db.js'
import { webhookRoutes } from '../src/routes/webhooks.js'
import {
  buildEnvelope,
  claimDelivery,
  signaturesFor,
  unixSeconds
} from '../src/webhooks/deliver.js'
import { clearInProcessLocks } from '../src/webhooks/lock.js'
import { processPendingDeliveries } from '../src/plugins/webhook-worker.js'
import { dispatchEvent } from '../src/webhooks/dispatch.js'

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
  await mongoose.connect(uri, { dbName: 'webhook-deliver-test' })
  await Promise.all([
    Developer.syncIndexes(),
    Webhook.syncIndexes(),
    WebhookDelivery.syncIndexes(),
    StatusLock.syncIndexes()
  ])
})

after(async () => {
  if (origFetch) globalThis.fetch = origFetch
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

beforeEach(async () => {
  if (origFetch) globalThis.fetch = origFetch
  origFetch = origFetch || globalThis.fetch
  clearInProcessLocks()
  await Promise.all([
    Developer.deleteMany({}),
    Webhook.deleteMany({}),
    WebhookDelivery.deleteMany({}),
    StatusLock.deleteMany({})
  ])
})

async function seed() {
  const dev = await Developer.create({
    email: 'dev@example.com',
    passwordHash: 'x',
    apiKey: 'ak_test_deliver',
    name: 'Test'
  })
  const webhook = await Webhook.create({
    developerId: dev._id,
    apiKey: dev.apiKey,
    url: 'https://example.com/hook',
    events: ['ipma.warning.new'],
    secret: 'whsec_test',
    active: true
  })
  return { dev, webhook }
}

test('tests never connect mongoose to MONGO_URI', () => {
  const { host } = mongoose.connection
  assert.ok(host === '127.0.0.1' || host === 'localhost')
  assert.equal(mongoose.connection.name, 'webhook-deliver-test')
})

test('test delivery uses the Mongo _id as X-ApiAberta-Delivery and the real envelope', async () => {
  const { dev } = await seed()
  const captured = []
  origFetch = origFetch || globalThis.fetch
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), init })
    return { ok: true, status: 200, text: async () => 'ok' }
  }

  const app = Fastify({ logger: false })
  await app.register(webhookRoutes, { prefix: '/v1/webhooks' })
  await app.ready()

  const created = await app.inject({
    method: 'POST',
    url: '/v1/webhooks',
    headers: { 'x-api-key': dev.apiKey, 'content-type': 'application/json' },
    payload: { url: 'https://example.com/hook', events: ['ipma.warning.new'] }
  })
  const webhook = created.json()

  const res = await app.inject({
    method: 'POST',
    url: `/v1/webhooks/${webhook.id}/test`,
    headers: { 'x-api-key': dev.apiKey }
  })
  assert.equal(res.statusCode, 200, res.body)
  const body = res.json()
  assert.equal(captured.length, 1)
  const headers = captured[0].init.headers
  assert.equal(headers['X-ApiAberta-Delivery'], String(body.deliveryId))
  const sent = JSON.parse(captured[0].init.body)
  assert.equal(sent.event, 'test.ping')
  assert.equal(sent.test, true)
  assert.equal(typeof sent.timestamp, 'string')
  assert.ok(sent.data)
  assert.equal(sent.id, undefined)
  assert.ok(headers['X-ApiAberta-Signature'])
  assert.ok(headers['X-ApiAberta-Signature-V2'])
  assert.ok(headers['X-ApiAberta-Timestamp'])
  await app.close()
})

test('worker does not follow redirects and keeps the envelope timestamp on retry', async () => {
  const { webhook } = await seed()
  const timestamp = new Date('2026-11-27T08:00:00.000Z')
  const delivery = await WebhookDelivery.create({
    webhookId: webhook._id,
    event: 'ipma.warning.new',
    payload: { id: '1', level: 'red', region: 'LSB', type: 'Vento' },
    timestamp,
    status: 'pending',
    nextRetry: new Date('2020-01-01')
  })

  const captured = []
  origFetch = origFetch || globalThis.fetch
  globalThis.fetch = async (url, init) => {
    captured.push(init)
    return { ok: false, status: 302, text: async () => 'redirect' }
  }

  await processPendingDeliveries()
  assert.equal(captured.length, 1)
  assert.equal(captured[0].redirect, 'manual')
  const sent = JSON.parse(captured[0].body)
  assert.equal(sent.timestamp, timestamp.toISOString())
  assert.equal(sent.test, undefined)
  assert.equal(sent.event, 'ipma.warning.new')

  const stored = await WebhookDelivery.findById(delivery._id).lean()
  assert.equal(stored.status, 'pending')
  assert.equal(stored.attempts, 1)
  assert.match(stored.responseBody, /redirect/)
})

test('signature v2 is HMAC of unix.timestamp + body', () => {
  const envelope = buildEnvelope({
    event: 'test.ping',
    timestamp: '2026-11-27T08:00:00.000Z',
    data: { ok: true },
    test: true
  })
  const body = JSON.stringify(envelope)
  const unix = unixSeconds(envelope.timestamp)
  const sig = signaturesFor('whsec_test', body, unix)
  assert.match(sig.v1, /^sha256=[0-9a-f]{64}$/)
  assert.equal(sig.v2, `t=${unix},v1=${sig.hexV2}`)
})

test('claimDelivery is atomic so only one worker sends', async () => {
  const { webhook } = await seed()
  const delivery = await WebhookDelivery.create({
    webhookId: webhook._id,
    event: 'ipma.warning.new',
    payload: { id: '1' },
    status: 'pending',
    nextRetry: new Date('2020-01-01')
  })
  const a = await claimDelivery(delivery._id)
  const b = await claimDelivery(delivery._id)
  assert.ok(a)
  assert.equal(b, null)
})

test('dispatchEvent stores a stable timestamp used by the worker', async () => {
  const { webhook } = await seed()
  await dispatchEvent('ipma.warning.new', { id: 'x', level: 'red', region: 'LSB', type: 'Vento' })
  const row = await WebhookDelivery.findOne({ webhookId: webhook._id }).lean()
  assert.ok(row.timestamp)
  assert.equal(row.status, 'pending')
})

test('deliveries after rotate-secret are signed with the new secret only', async () => {
  const { dev, webhook: leftover } = await seed()
  await leftover.deleteOne()
  const app = Fastify({ logger: false })
  await app.register(webhookRoutes, { prefix: '/v1/webhooks' })
  await app.ready()
  const headers = { 'x-api-key': dev.apiKey, 'content-type': 'application/json' }

  const created = await app.inject({
    method: 'POST',
    url: '/v1/webhooks',
    headers,
    payload: { url: 'https://example.com/hook', events: ['ipma.warning.new'] }
  })
  assert.equal(created.statusCode, 201, created.body)
  const originalSecret = created.json().secret
  const webhookId = created.json().id

  const rotated = await app.inject({
    method: 'POST',
    url: `/v1/webhooks/${webhookId}/rotate-secret`,
    headers
  })
  assert.equal(rotated.statusCode, 200, rotated.body)
  const newSecret = rotated.json().secret
  assert.notEqual(newSecret, originalSecret)

  const captured = []
  origFetch = origFetch || globalThis.fetch
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), init })
    return { ok: true, status: 200, text: async () => 'ok' }
  }

  const ping = await app.inject({
    method: 'POST',
    url: `/v1/webhooks/${webhookId}/test`,
    headers
  })
  assert.equal(ping.statusCode, 200, ping.body)
  assert.equal(captured.length, 1)
  const pingBody = captured[0].init.body
  const pingUnix = captured[0].init.headers['X-ApiAberta-Timestamp']
  const pingNew = signaturesFor(newSecret, pingBody, pingUnix)
  const pingOld = signaturesFor(originalSecret, pingBody, pingUnix)
  assert.equal(captured[0].init.headers['X-ApiAberta-Signature'], pingNew.v1)
  assert.equal(captured[0].init.headers['X-ApiAberta-Signature-V2'], pingNew.v2)
  assert.notEqual(captured[0].init.headers['X-ApiAberta-Signature'], pingOld.v1)

  captured.length = 0
  await dispatchEvent('ipma.warning.new', { id: 'x', level: 'red', region: 'LSB', type: 'Vento' })
  await processPendingDeliveries()
  assert.equal(captured.length, 1)
  const workerBody = captured[0].init.body
  const workerUnix = captured[0].init.headers['X-ApiAberta-Timestamp']
  const workerNew = signaturesFor(newSecret, workerBody, workerUnix)
  const workerOld = signaturesFor(originalSecret, workerBody, workerUnix)
  assert.equal(captured[0].init.headers['X-ApiAberta-Signature'], workerNew.v1)
  assert.equal(captured[0].init.headers['X-ApiAberta-Signature-V2'], workerNew.v2)
  assert.notEqual(captured[0].init.headers['X-ApiAberta-Signature'], workerOld.v1)

  await app.close()
})
