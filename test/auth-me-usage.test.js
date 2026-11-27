import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server-core'
import Fastify from 'fastify'
import { nanoid } from 'nanoid'
import { config } from '../src/config.js'
import { Developer, UsageLog } from '../src/db.js'
import { authRoutes } from '../src/routes/auth.js'

let mongod
let app

function assertLocalMemoryUri(uri) {
  const parsed = new URL(uri)
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
  assert.ok(local, `tests must use a local MongoDB, got host ${parsed.hostname}`)
  assert.notEqual(uri, process.env.MONGO_URI)
}

function signToken(dev) {
  return jwt.sign(
    { id: dev._id.toString(), email: dev.email, tier: dev.tier },
    config.jwtSecret,
    { expiresIn: '30d' }
  )
}

async function seedDeveloper(overrides = {}) {
  return Developer.create({
    name: 'Ada Lovelace',
    email: `ada-${nanoid(8)}@example.com`,
    passwordHash: 'hashed',
    apiKey: `ak_${nanoid(16)}`,
    tier: 'free',
    active: true,
    ...overrides
  })
}

async function seedUsage(apiKey) {
  const now = new Date()
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
  await UsageLog.create([
    { apiKey, endpoint: '/v1/fuel/prices', method: 'GET', timestamp: now },
    { apiKey, endpoint: '/v1/fuel/prices', method: 'GET', timestamp: now },
    { apiKey, endpoint: '/v1/ipma/forecast', method: 'GET', timestamp: now },
    { apiKey, endpoint: '/v1/anpc/incidents', method: 'GET', timestamp: old },
    { apiKey: 'ak_someone_else', endpoint: '/v1/fuel/prices', method: 'GET', timestamp: now }
  ])
}

function expectedUsage() {
  return {
    total_requests: 4,
    last_30_days: 3,
    top_endpoints: [
      { endpoint: '/v1/fuel/prices', requests: 2 },
      { endpoint: '/v1/ipma/forecast', requests: 1 }
    ]
  }
}

before(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri()
  assertLocalMemoryUri(uri)
  await mongoose.connect(uri, { dbName: 'auth-me-usage-test' })
  await Promise.all([Developer.syncIndexes(), UsageLog.syncIndexes()])

  app = Fastify({ logger: false })
  await app.register(authRoutes, { prefix: '/v1/auth' })
  await app.ready()
})

after(async () => {
  if (app) await app.close()
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

beforeEach(async () => {
  await Promise.all([
    Developer.deleteMany({}),
    UsageLog.deleteMany({})
  ])
})

test('tests never connect mongoose to MONGO_URI', () => {
  const { host } = mongoose.connection
  assert.ok(host === '127.0.0.1' || host === 'localhost')
  assert.equal(mongoose.connection.name, 'auth-me-usage-test')
})

for (const path of ['/v1/auth/me', '/v1/auth/usage']) {
  test(`${path} with a valid JWT returns 200`, async () => {
    const dev = await seedDeveloper()
    if (path.endsWith('/usage')) await seedUsage(dev.apiKey)

    const res = await app.inject({
      method: 'GET',
      url: path,
      headers: { authorization: `Bearer ${signToken(dev)}` }
    })

    assert.equal(res.statusCode, 200)
    const body = res.json()
    if (path.endsWith('/me')) {
      assert.equal(body.name, dev.name)
      assert.equal(body.email, dev.email)
      assert.equal(body.tier, dev.tier)
      assert.equal(body.apiKey, dev.apiKey)
      assert.ok(body.createdAt)
    } else {
      assert.deepEqual(body, expectedUsage())
    }
  })

  test(`${path} with a malformed JWT returns 401 Invalid or expired token`, async () => {
    await seedDeveloper()
    const res = await app.inject({
      method: 'GET',
      url: path,
      headers: { authorization: 'Bearer not-a-jwt' }
    })
    assert.equal(res.statusCode, 401)
    assert.deepEqual(res.json(), { error: 'Unauthorized', message: 'Invalid or expired token' })
  })

  test(`${path} with a JWT signed with the wrong secret returns 401 Invalid or expired token`, async () => {
    const dev = await seedDeveloper()
    const token = jwt.sign({ id: dev._id.toString(), email: dev.email, tier: dev.tier }, 'wrong-secret')
    const res = await app.inject({
      method: 'GET',
      url: path,
      headers: { authorization: `Bearer ${token}` }
    })
    assert.equal(res.statusCode, 401)
    assert.deepEqual(res.json(), { error: 'Unauthorized', message: 'Invalid or expired token' })
  })

  test(`${path} with an expired JWT returns 401 Invalid or expired token`, async () => {
    const dev = await seedDeveloper()
    const token = jwt.sign(
      { id: dev._id.toString(), email: dev.email, tier: dev.tier, exp: Math.floor(Date.now() / 1000) - 60 },
      config.jwtSecret
    )
    const res = await app.inject({
      method: 'GET',
      url: path,
      headers: { authorization: `Bearer ${token}` }
    })
    assert.equal(res.statusCode, 401)
    assert.deepEqual(res.json(), { error: 'Unauthorized', message: 'Invalid or expired token' })
  })

  test(`${path} with a valid API key returns 200`, async () => {
    const dev = await seedDeveloper()
    if (path.endsWith('/usage')) await seedUsage(dev.apiKey)

    const res = await app.inject({
      method: 'GET',
      url: path,
      headers: { 'x-api-key': dev.apiKey }
    })

    assert.equal(res.statusCode, 200)
    const body = res.json()
    if (path.endsWith('/me')) {
      assert.equal(body.name, dev.name)
      assert.equal(body.email, dev.email)
      assert.equal(body.tier, dev.tier)
      assert.equal(body.apiKey, dev.apiKey)
      assert.ok(body.createdAt)
    } else {
      assert.deepEqual(body, expectedUsage())
    }
  })

  test(`${path} with an invalid API key returns 401 Invalid API key`, async () => {
    await seedDeveloper()
    const res = await app.inject({
      method: 'GET',
      url: path,
      headers: { 'x-api-key': 'ak_does_not_exist' }
    })
    assert.equal(res.statusCode, 401)
    assert.deepEqual(res.json(), { error: 'Unauthorized', message: 'Invalid API key' })
  })

  test(`${path} without credentials returns 401 Missing credentials`, async () => {
    const res = await app.inject({ method: 'GET', url: path })
    assert.equal(res.statusCode, 401)
    assert.deepEqual(res.json(), { error: 'Unauthorized', message: 'Missing credentials' })
  })
}

test('GET /v1/auth/usage with JWT queries UsageLog by the developer apiKey', async () => {
  const dev = await seedDeveloper()
  await seedUsage(dev.apiKey)

  const viaJwt = await app.inject({
    method: 'GET',
    url: '/v1/auth/usage',
    headers: { authorization: `Bearer ${signToken(dev)}` }
  })
  const viaKey = await app.inject({
    method: 'GET',
    url: '/v1/auth/usage',
    headers: { 'x-api-key': dev.apiKey }
  })

  assert.equal(viaJwt.statusCode, 200)
  assert.equal(viaKey.statusCode, 200)
  assert.deepEqual(viaJwt.json(), viaKey.json())
  assert.deepEqual(viaJwt.json(), expectedUsage())
})
