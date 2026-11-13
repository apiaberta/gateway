import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PUBLIC_ROUTES, isPublicRoute } from '../src/plugins/authenticate.js'

test('every PUBLIC_ROUTES entry is public, with and without a query string', () => {
  for (const route of PUBLIC_ROUTES) {
    assert.equal(isPublicRoute(route), true, route)
    assert.equal(isPublicRoute(`${route}?x=1`), true, `${route}?x=1`)
  }
})

test('paths below a public route are public', () => {
  assert.equal(isPublicRoute('/v1/carris/stops/123/arrivals?limit=5'), true)
  assert.equal(isPublicRoute('/v1/fuel/prices'), true)
  assert.equal(isPublicRoute('/v1/status/history?days=90'), true)
  assert.equal(isPublicRoute('/docs/static/index.html'), true)
  assert.equal(isPublicRoute('/docs/json'), true)
})

test('a path that only shares a string prefix is not public', () => {
  assert.equal(isPublicRoute('/v1/fuelanything'), false)
  assert.equal(isPublicRoute('/v1/fuel-admin/users'), false)
  assert.equal(isPublicRoute('/v1/ipma2/forecasts'), false)
  assert.equal(isPublicRoute('/v1/auth/menu'), false)
  assert.equal(isPublicRoute('/healthz'), false)
})

test('routes that need a key stay non-public', () => {
  assert.equal(isPublicRoute('/v1/admin/developers'), false)
  assert.equal(isPublicRoute('/v1/auth/api-key'), false)
  assert.equal(isPublicRoute('/v1/webhooks'), false)
})
