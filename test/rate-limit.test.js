import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { getClientIp, TRUST_PROXY } from '../src/client-ip.js'
import {
  AUTH_RATE_LIMIT_EXEMPT_PATHS,
  isAuthRateLimitExempt,
  rateLimitConfig,
  rateLimitKey
} from '../src/rate-limit.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function buildApp() {
  const app = Fastify({ logger: false, trustProxy: TRUST_PROXY })
  await app.register(rateLimit, rateLimitConfig)
  app.get('/v1/status', async () => ({ ok: true }))
  app.get('/v1/auth/me', async () => ({ me: true }))
  app.post('/v1/auth/login', async () => ({ login: true }))
  app.post('/v1/auth/register', async () => ({ register: true }))
  app.post('/v1/auth/forgot-password', async () => ({ forgot: true }))
  app.post('/v1/auth/reset-password', async () => ({ reset: true }))
  return app
}

async function injectStatus(app, { ip, cf, xff, apiKey } = {}) {
  const headers = {}
  if (cf) headers['cf-connecting-ip'] = cf
  if (xff) headers['x-forwarded-for'] = xff
  if (apiKey) headers['x-api-key'] = apiKey
  return app.inject({
    method: 'GET',
    url: '/v1/status',
    remoteAddress: ip || '127.0.0.1',
    headers
  })
}

test('getClientIp prefers CF-Connecting-IP over req.ip and X-Forwarded-For', () => {
  assert.equal(getClientIp({
    ip: '10.0.0.1',
    headers: {
      'cf-connecting-ip': '198.51.100.20',
      'x-forwarded-for': '203.0.113.9, 10.0.0.1'
    }
  }), '198.51.100.20')
})

test('getClientIp trims CF-Connecting-IP and ignores a forged X-Forwarded-For', () => {
  assert.equal(getClientIp({
    ip: '127.0.0.1',
    headers: {
      'cf-connecting-ip': '  198.51.100.21  ',
      'x-forwarded-for': '8.8.8.8'
    }
  }), '198.51.100.21')
})

test('getClientIp falls back to req.ip and does not parse X-Forwarded-For itself', () => {
  assert.equal(getClientIp({
    ip: '203.0.113.50',
    headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.50' }
  }), '203.0.113.50')
  assert.equal(getClientIp({ ip: '127.0.0.1', headers: {} }), '127.0.0.1')
  assert.equal(getClientIp({ headers: {} }), '')
})

test('rateLimitKey uses the API key when present, otherwise the client IP', () => {
  assert.equal(rateLimitKey({
    ip: '10.0.0.1',
    headers: { 'x-api-key': 'ak_test', 'cf-connecting-ip': '198.51.100.20' }
  }), 'ak_test')
  assert.equal(rateLimitKey({
    ip: '10.0.0.1',
    headers: { 'cf-connecting-ip': '198.51.100.20' }
  }), '198.51.100.20')
})

test('auth credential routes are exempt; other /v1/auth paths are not', () => {
  for (const path of AUTH_RATE_LIMIT_EXEMPT_PATHS) {
    assert.equal(isAuthRateLimitExempt(path), true)
    assert.equal(isAuthRateLimitExempt(`${path}?next=/app`), true)
  }
  assert.equal(isAuthRateLimitExempt('/v1/auth/login-extra'), false)
  assert.equal(isAuthRateLimitExempt('/v1/auth/me'), false)
  assert.equal(isAuthRateLimitExempt('/v1/status'), false)
})

test('rateLimitConfig uses allowList, not the invalid skip option', () => {
  assert.equal(typeof rateLimitConfig.allowList, 'function')
  assert.equal(rateLimitConfig.skip, undefined)
  assert.equal(rateLimitConfig.allowList({ url: '/v1/auth/register' }), true)
  assert.equal(rateLimitConfig.allowList({ url: '/v1/status' }), false)
})

test('index.js wires trustProxy and the shared rateLimitConfig', () => {
  const indexSrc = readFileSync(join(root, 'src/index.js'), 'utf8')
  assert.ok(indexSrc.includes('trustProxy: TRUST_PROXY'))
  assert.ok(indexSrc.includes('rateLimitConfig'))
  assert.equal(indexSrc.includes('skip:'), false)
})

test('auth anti-spam uses getClientIp instead of X-Forwarded-For', () => {
  const authSrc = readFileSync(join(root, 'src/routes/auth.js'), 'utf8')
  assert.ok(authSrc.includes('getClientIp(req)'))
  assert.equal(authSrc.includes('x-forwarded-for'), false)
})

test('anonymous limit is 30/min per CF-Connecting-IP', async () => {
  const app = await buildApp()
  try {
    for (let i = 0; i < 30; i++) {
      const res = await injectStatus(app, { cf: '198.51.100.1' })
      assert.equal(res.statusCode, 200, `request ${i + 1}`)
      assert.equal(res.headers['x-ratelimit-limit'], '30')
    }
    const blocked = await injectStatus(app, { cf: '198.51.100.1' })
    assert.equal(blocked.statusCode, 429)
    const body = JSON.parse(blocked.body)
    assert.equal(body.error, 'Too Many Requests')
    assert.equal(body.message, 'Rate limit exceeded. Upgrade your plan at apiaberta.pt')
  } finally {
    await app.close()
  }
})

test('different CF-Connecting-IP values do not share the anonymous bucket', async () => {
  const app = await buildApp()
  try {
    for (let i = 0; i < 30; i++) {
      const res = await injectStatus(app, { cf: '198.51.100.2' })
      assert.equal(res.statusCode, 200)
    }
    const other = await injectStatus(app, { cf: '198.51.100.3' })
    assert.equal(other.statusCode, 200)
    assert.equal(other.headers['x-ratelimit-remaining'], '29')
    const firstBlocked = await injectStatus(app, { cf: '198.51.100.2' })
    assert.equal(firstBlocked.statusCode, 429)
  } finally {
    await app.close()
  }
})

test('auth credential routes stay available after the anonymous limit is hit', async () => {
  const app = await buildApp()
  try {
    const cf = '198.51.100.4'
    for (let i = 0; i < 30; i++) {
      assert.equal((await injectStatus(app, { cf })).statusCode, 200)
    }
    assert.equal((await injectStatus(app, { cf })).statusCode, 429)

    for (const url of AUTH_RATE_LIMIT_EXEMPT_PATHS) {
      const res = await app.inject({
        method: 'POST',
        url,
        remoteAddress: '127.0.0.1',
        headers: { 'cf-connecting-ip': cf }
      })
      assert.equal(res.statusCode, 200, url)
    }

    const me = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      remoteAddress: '127.0.0.1',
      headers: { 'cf-connecting-ip': cf }
    })
    assert.equal(me.statusCode, 429)
  } finally {
    await app.close()
  }
})

test('spoofed X-Forwarded-For does not change the key when CF-Connecting-IP is set', async () => {
  const app = await buildApp()
  try {
    const cf = '198.51.100.5'
    for (let i = 0; i < 15; i++) {
      const res = await injectStatus(app, { cf, xff: '203.0.113.10' })
      assert.equal(res.statusCode, 200)
    }
    const sameClient = await injectStatus(app, { cf, xff: '192.0.2.1' })
    assert.equal(sameClient.statusCode, 200)
    assert.equal(sameClient.headers['x-ratelimit-remaining'], '14')
  } finally {
    await app.close()
  }
})

test('without CF-Connecting-IP, untrusted peers cannot share a bucket via X-Forwarded-For', async () => {
  const app = await buildApp()
  try {
    for (let i = 0; i < 30; i++) {
      const res = await injectStatus(app, {
        ip: '203.0.113.20',
        xff: '1.1.1.1'
      })
      assert.equal(res.statusCode, 200)
    }
    const spoofed = await injectStatus(app, {
      ip: '203.0.113.21',
      xff: '1.1.1.1'
    })
    assert.equal(spoofed.statusCode, 200)
    const originalBlocked = await injectStatus(app, {
      ip: '203.0.113.20',
      xff: '1.1.1.1'
    })
    assert.equal(originalBlocked.statusCode, 429)
  } finally {
    await app.close()
  }
})

test('from a trusted local proxy, req.ip fallback uses the forwarded client', async () => {
  const app = await buildApp()
  try {
    for (let i = 0; i < 30; i++) {
      const res = await injectStatus(app, {
        ip: '127.0.0.1',
        xff: '198.51.100.8'
      })
      assert.equal(res.statusCode, 200)
    }
    const sameForwarded = await injectStatus(app, {
      ip: '127.0.0.1',
      xff: '198.51.100.8'
    })
    assert.equal(sameForwarded.statusCode, 429)
    const otherForwarded = await injectStatus(app, {
      ip: '127.0.0.1',
      xff: '198.51.100.9'
    })
    assert.equal(otherForwarded.statusCode, 200)
  } finally {
    await app.close()
  }
})

test('API keys get the 300/min bucket and are not stuck on the anonymous 30', async () => {
  const app = await buildApp()
  try {
    for (let i = 0; i < 31; i++) {
      const res = await injectStatus(app, { cf: '198.51.100.6', apiKey: 'ak_test' })
      assert.equal(res.statusCode, 200, `request ${i + 1}`)
      assert.equal(res.headers['x-ratelimit-limit'], '300')
    }
  } finally {
    await app.close()
  }
})
