import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Fastify from 'fastify'
import { config } from '../src/config.js'
import { PUBLIC_ROUTES, authenticate } from '../src/plugins/authenticate.js'
import { CACHE_TTLS, getTtl } from '../src/plugins/cache.js'
import { buildConnectorUrl, proxyRoutes } from '../src/routes/proxy.js'
import { serviceHealthUrl, checkService } from '../src/routes/status.js'

const execFileAsync = promisify(execFile)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const NEW_SERVICES = [
  {
    prefix: '/carris',
    name: 'Carris Metropolitana (realtime)',
    env: 'CARRIS_SERVICE_URL',
    defaultTarget: 'http://localhost:3017',
    publicRoute: '/v1/carris',
    ttl: 20,
    samplePath: '/carris/vehicles'
  },
  {
    prefix: '/gtfs',
    name: 'Transport schedules (GTFS)',
    env: 'GTFS_SERVICE_URL',
    defaultTarget: 'http://localhost:3018',
    publicRoute: '/v1/gtfs',
    ttl: 300,
    samplePath: '/gtfs/feeds'
  },
  {
    prefix: '/parlamento',
    name: 'Parlamento (Assembleia da República)',
    env: 'PARLAMENTO_SERVICE_URL',
    defaultTarget: 'http://localhost:3019',
    publicRoute: '/v1/parlamento',
    ttl: 1800,
    samplePath: '/parlamento/deputados'
  },
  {
    prefix: '/sns',
    name: 'SNS Transparência',
    env: 'SNS_SERVICE_URL',
    defaultTarget: 'http://localhost:3020',
    publicRoute: '/v1/sns',
    ttl: 3600,
    samplePath: '/sns/datasets'
  }
]

const EXISTING_PREFIXES = [
  '/fuel', '/ipma', '/base', '/ev', '/ine', '/anpc', '/bdp',
  '/contracts', '/geo', '/nif', '/prr', '/pt2030', '/dre', '/nasafirms'
]

function serviceByPrefix(prefix) {
  return config.services.find(s => s.prefix === prefix)
}

function startMockConnector() {
  const requests = []
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url })
    if (req.url === '/health' || req.url?.startsWith('/health?')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', version: 'test' }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ path: req.url }))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        server,
        requests,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done, fail) => server.close(err => err ? fail(err) : done()))
      })
    })
  })
}

async function evalConfig(env, expr) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['-e', `import { config } from './src/config.js'; process.stdout.write(JSON.stringify(${expr}))`],
    { cwd: root, env: { ...process.env, ...env } }
  )
  return JSON.parse(stdout)
}

test('existing service prefixes are left in place', () => {
  for (const prefix of EXISTING_PREFIXES) {
    assert.ok(serviceByPrefix(prefix), `missing existing service ${prefix}`)
  }
})

test('registers four new services with default localhost ports', () => {
  for (const spec of NEW_SERVICES) {
    const svc = serviceByPrefix(spec.prefix)
    assert.ok(svc, `missing service ${spec.prefix}`)
    assert.equal(svc.name, spec.name)
    assert.equal(svc.target, spec.defaultTarget)
  }
})

test('gateway has 18 services after adding the four connectors (14 + 4)', () => {
  assert.equal(config.services.length, EXISTING_PREFIXES.length + NEW_SERVICES.length)
})

test('BDP default port is 3008', () => {
  const bdp = serviceByPrefix('/bdp')
  assert.ok(bdp)
  assert.equal(bdp.target, 'http://localhost:3008')
})

test('service URLs are overridable via env', async () => {
  for (const spec of NEW_SERVICES) {
    const override = `http://example.test:${spec.defaultTarget.slice(-4)}`
    const target = await evalConfig(
      { [spec.env]: override },
      `config.services.find(s => s.prefix === '${spec.prefix}').target`
    )
    assert.equal(target, override)
  }

  const bdp = await evalConfig(
    { BDP_SERVICE_URL: 'http://example.test:3008' },
    `config.services.find(s => s.prefix === '/bdp').target`
  )
  assert.equal(bdp, 'http://example.test:3008')
})

test('new prefixes are public (no API key required)', async () => {
  for (const spec of NEW_SERVICES) {
    assert.ok(PUBLIC_ROUTES.includes(spec.publicRoute), spec.publicRoute)

    const req = { url: `${spec.publicRoute}${spec.samplePath.slice(spec.prefix.length)}`, headers: {} }
    const reply = {
      code() { throw new Error(`auth should skip ${req.url}`) },
      send() { throw new Error(`auth should skip ${req.url}`) },
      header() { return this }
    }
    await authenticate(req, reply)
  }
})

test('PUBLIC_ROUTES matching is prefix-based (startsWith)', async () => {
  const req = { url: '/v1/carris/stops/123/arrivals?limit=5', headers: {} }
  const reply = {
    code() { throw new Error('auth should skip nested carris path') },
    send() {},
    header() { return this }
  }
  await authenticate(req, reply)
})

test('unlisted /v1 routes still require an API key', async () => {
  const reply = {
    status: null,
    body: null,
    code(status) { this.status = status; return this },
    send(body) { this.body = body; return this },
    header() { return this }
  }
  await authenticate({ url: '/v1/admin/keys', headers: {} }, reply)
  assert.equal(reply.status, 401)
  assert.equal(reply.body.error, 'Unauthorized')
})

test('cache TTLs for new services; /ipma stays at 120s', () => {
  assert.equal(CACHE_TTLS['/ipma'], 120)
  for (const spec of NEW_SERVICES) {
    assert.equal(CACHE_TTLS[spec.prefix], spec.ttl)
    assert.equal(getTtl(spec.prefix), spec.ttl)
  }
})

test('proxy strips /v1 and keeps the connector prefix and query string', () => {
  assert.equal(
    buildConnectorUrl('http://localhost:3017', '/v1/carris/vehicles'),
    'http://localhost:3017/carris/vehicles'
  )
  assert.equal(
    buildConnectorUrl('http://localhost:3020', '/v1/sns/datasets?limit=10'),
    'http://localhost:3020/sns/datasets?limit=10'
  )
  assert.equal(
    buildConnectorUrl('http://localhost:3018', '/v1/gtfs/stops?near=38.7,-9.1'),
    'http://localhost:3018/gtfs/stops?near=38.7,-9.1'
  )
  assert.equal(
    buildConnectorUrl('http://localhost:3019', '/v1/parlamento'),
    'http://localhost:3019/parlamento'
  )
  // same rewrite as existing connectors (fuel, etc.)
  assert.equal(
    buildConnectorUrl('http://localhost:3001', '/v1/fuel/stations?district=Lisboa'),
    'http://localhost:3001/fuel/stations?district=Lisboa'
  )
})

test('status checks hit {target}/health, not /v1/health', () => {
  assert.equal(serviceHealthUrl('http://localhost:3017'), 'http://localhost:3017/health')
  assert.equal(serviceHealthUrl('http://localhost:3020'), 'http://localhost:3020/health')
})

test('proxy forwards gateway paths to connector paths without /v1', async () => {
  const mock = await startMockConnector()
  const originals = NEW_SERVICES.map(spec => {
    const svc = serviceByPrefix(spec.prefix)
    const previous = svc.target
    svc.target = mock.url
    return { svc, previous }
  })

  const app = Fastify({ logger: false })
  try {
    await app.register(proxyRoutes, { prefix: '/v1' })

    for (const spec of NEW_SERVICES) {
      mock.requests.length = 0
      const res = await app.inject({ method: 'GET', url: `/v1${spec.samplePath}` })
      assert.equal(res.statusCode, 200, spec.samplePath)
      assert.equal(mock.requests.length, 1)
      assert.equal(mock.requests[0].url, spec.samplePath)
      assert.deepEqual(JSON.parse(res.body), { path: spec.samplePath })
    }
  } finally {
    await app.close()
    for (const { svc, previous } of originals) svc.target = previous
    await mock.close()
  }
})

test('status checkService reports /v1 prefix and probes /health', async () => {
  const mock = await startMockConnector()
  try {
    const result = await checkService({
      name: 'Carris Metropolitana (realtime)',
      prefix: '/carris',
      target: mock.url
    })
    assert.equal(result.status, 'up')
    assert.equal(result.prefix, '/v1/carris')
    assert.equal(result.name, 'Carris Metropolitana (realtime)')
    assert.equal(result.version, 'test')
    assert.equal(mock.requests.length, 1)
    assert.equal(mock.requests[0].url, '/health')
  } finally {
    await mock.close()
  }
})

test('.env.example documents the new and previously missing service URLs', () => {
  const envExample = readFileSync(join(root, '.env.example'), 'utf8')
  const expected = [
    'NIF_SERVICE_URL=http://localhost:3013',
    'PRR_SERVICE_URL=http://localhost:3014',
    'DRE_SERVICE_URL=http://localhost:3015',
    'NASAFIRMS_SERVICE_URL=http://localhost:3012',
    'CARRIS_SERVICE_URL=http://localhost:3017',
    'GTFS_SERVICE_URL=http://localhost:3018',
    'PARLAMENTO_SERVICE_URL=http://localhost:3019',
    'SNS_SERVICE_URL=http://localhost:3020',
    'BDP_SERVICE_URL=http://localhost:3008'
  ]
  for (const line of expected) {
    assert.ok(envExample.includes(line), line)
  }
})
