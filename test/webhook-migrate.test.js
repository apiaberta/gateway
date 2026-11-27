import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server-core'
import { Developer, Webhook } from '../src/db.js'
import { migrateFilters, migrateWebhookDocuments } from '../scripts/migrate-webhook-filters.mjs'

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
  await mongoose.connect(uri, { dbName: 'webhook-migrate-test' })
  await Promise.all([Developer.syncIndexes(), Webhook.syncIndexes()])
})

after(async () => {
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

beforeEach(async () => {
  await Promise.all([Developer.deleteMany({}), Webhook.deleteMany({})])
})

test('migrateFilters converts geo names, DRE series and drops dead keys', () => {
  const { filters, changed } = migrateFilters({
    'base.contract.new': { local: 'Fundão', valor_min: 10 },
    'dre.diploma.new': { series: '2' },
    'ipma.warning.new': { area: 'LSB', region: 'LSB' },
    'sns.dataset.updated': { dataset: 'urgencias', regiao: 'Centro' }
  })
  assert.equal(changed, true)
  assert.equal(filters['base.contract.new'].municipality, '0504')
  assert.equal(filters['base.contract.new'].local, undefined)
  assert.equal(filters['dre.diploma.new'].series, 'II')
  assert.equal(filters['ipma.warning.new'].area, undefined)
  assert.equal(filters['ipma.warning.new'].region, 'LSB')
  assert.equal(filters['sns.dataset.updated'].regiao, undefined)
  assert.equal(filters['sns.dataset.updated'].dataset, 'urgencias')
})

test('migrateFilters is idempotent on already-canonical filters', () => {
  const once = migrateFilters({ 'base.contract.new': { municipality: '0504' } })
  const twice = migrateFilters(once.filters)
  assert.equal(twice.changed, false)
  assert.equal(twice.filters['base.contract.new'].municipality, '0504')
})

test('dry-run does not write webhook documents', async () => {
  const dev = await Developer.create({
    email: 'dev@example.com',
    passwordHash: 'x',
    apiKey: 'ak_migrate',
    name: 'Test'
  })
  const webhook = await Webhook.create({
    developerId: dev._id,
    apiKey: dev.apiKey,
    url: 'https://example.com/hook',
    events: ['base.contract.new'],
    filters: { 'base.contract.new': { local: 'Fundão' } },
    secret: 'whsec_test'
  })

  const dry = await migrateWebhookDocuments({ dryRun: true })
  assert.equal(dry.changed, 1)
  const afterDry = await Webhook.findById(webhook._id).lean()
  assert.equal(afterDry.filters['base.contract.new'].local, 'Fundão')

  const applied = await migrateWebhookDocuments({ dryRun: false })
  assert.equal(applied.changed, 1)
  const after = await Webhook.findById(webhook._id).lean()
  assert.equal(after.filters['base.contract.new'].municipality, '0504')
  assert.equal(after.filters['base.contract.new'].local, undefined)

  const again = await migrateWebhookDocuments({ dryRun: false })
  assert.equal(again.changed, 0)
})
