import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveJwtSecret } from '../src/config.js'

test('uses JWT_SECRET when it is set', () => {
  assert.equal(resolveJwtSecret({ JWT_SECRET: 'a'.repeat(48) }), 'a'.repeat(48))
  assert.equal(resolveJwtSecret({ JWT_SECRET: 'a'.repeat(48), NODE_ENV: 'production' }), 'a'.repeat(48))
})

test('falls back to the dev secret outside production', () => {
  assert.equal(resolveJwtSecret({}), 'change-me-in-production')
  assert.equal(resolveJwtSecret({ NODE_ENV: 'development' }), 'change-me-in-production')
  assert.equal(resolveJwtSecret({ NODE_ENV: 'test' }), 'change-me-in-production')
})

test('refuses to start in production without a secret', () => {
  assert.throws(() => resolveJwtSecret({ NODE_ENV: 'production' }), /JWT_SECRET/)
  assert.throws(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: '' }), /JWT_SECRET/)
})

test('refuses the dev value and the .env.example placeholder in production', () => {
  assert.throws(
    () => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'change-me-in-production' }),
    /JWT_SECRET/
  )
  assert.throws(
    () => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'change-me-in-production-to-a-long-random-string' }),
    /JWT_SECRET/
  )
})
