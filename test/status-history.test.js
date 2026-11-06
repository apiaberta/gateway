import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import {
  parseDaysParam,
  lisbonDateString,
  enumerateDates,
  lisbonDayStart,
  serviceIdFromPrefix,
  serviceIdFromConfig,
  computeUptime,
  emptyDay,
  dailyToDay,
  buildHistoryPayload,
  incidentDurationMin,
  formatIncident,
  incidentOverlapsWindow,
  DEFAULT_HISTORY_DAYS,
  MAX_HISTORY_DAYS,
  CHECK_TTL_DAYS
} from '../src/services/status-history.js'
import { classifyHealth, checkService, serviceHealthUrl } from '../src/routes/status.js'

test('TTL for raw checks is 95 days', () => {
  assert.equal(CHECK_TTL_DAYS, 95)
})

test('parseDaysParam defaults to 90, clamps to 1..365', () => {
  assert.equal(parseDaysParam(undefined), DEFAULT_HISTORY_DAYS)
  assert.equal(parseDaysParam('90'), 90)
  assert.equal(parseDaysParam(''), DEFAULT_HISTORY_DAYS)
  assert.equal(parseDaysParam('nope'), DEFAULT_HISTORY_DAYS)
  assert.equal(parseDaysParam('0'), 1)
  assert.equal(parseDaysParam('-5'), 1)
  assert.equal(parseDaysParam('365'), 365)
  assert.equal(parseDaysParam('400'), MAX_HISTORY_DAYS)
  assert.equal(parseDaysParam(400), MAX_HISTORY_DAYS)
})

test('lisbonDateString uses Europe/Lisbon calendar dates', () => {
  assert.equal(lisbonDateString(new Date('2026-01-15T12:00:00Z')), '2026-01-15')
  // WEST (UTC+1): 23:30 UTC on 14 Jul is already 00:30 on 15 Jul in Lisbon
  assert.equal(lisbonDateString(new Date('2026-07-14T23:30:00Z')), '2026-07-15')
  assert.equal(lisbonDateString(new Date('2026-07-14T22:30:00Z')), '2026-07-14')
})

test('enumerateDates fills every calendar day ending today in Lisbon', () => {
  const dates = enumerateDates(5, new Date('2026-11-06T15:00:00Z'))
  assert.deepEqual(dates, [
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
    '2026-11-06'
  ])
  assert.equal(enumerateDates(90, new Date('2026-11-06T12:00:00Z')).length, 90)
})

test('lisbonDayStart lands on that Lisbon calendar date', () => {
  const winter = lisbonDayStart('2026-01-15')
  assert.equal(lisbonDateString(winter), '2026-01-15')
  const summer = lisbonDayStart('2026-07-15')
  assert.equal(lisbonDateString(summer), '2026-07-15')
})

test('service ids strip leading slashes and /v1', () => {
  assert.equal(serviceIdFromPrefix('/fuel'), 'fuel')
  assert.equal(serviceIdFromPrefix('/v1/fuel'), 'fuel')
  assert.equal(serviceIdFromConfig({ prefix: '/parlamento' }), 'parlamento')
})

test('uptime = (up + 0.5 * degraded) / checks', () => {
  assert.equal(computeUptime(100, 0, 100), 1)
  assert.equal(computeUptime(90, 10, 100), 0.95)
  assert.equal(computeUptime(0, 10, 10), 0.5)
  assert.equal(computeUptime(0, 0, 10), 0)
  assert.equal(computeUptime(0, 0, 0), null)
})

test('dailyToDay is null-uptime when a day has no checks', () => {
  assert.deepEqual(dailyToDay('2026-11-01', null), emptyDay('2026-11-01'))
  assert.deepEqual(dailyToDay('2026-11-01', { checks: 0, up: 0, degraded: 0, down: 0 }), emptyDay('2026-11-01'))
  assert.deepEqual(dailyToDay('2026-11-01', {
    checks: 10, up: 8, degraded: 2, down: 0, avgLatencyMs: 42
  }), {
    date: '2026-11-01',
    uptime: 0.9,
    checks: 10,
    down: 0,
    degraded: 2,
    avgLatencyMs: 42
  })
})

test('buildHistoryPayload fills every date and computes overall uptime', () => {
  const generatedAt = new Date('2026-11-06T12:00:00Z')
  const payload = buildHistoryPayload({
    services: [
      { prefix: '/fuel', name: 'Fuel Prices (DGEG)' },
      { prefix: '/ipma', name: 'Weather (IPMA)' }
    ],
    dailyRows: [
      { service: 'fuel', date: '2026-11-06', checks: 10, up: 9, degraded: 0, down: 1, avgLatencyMs: 20 },
      { service: 'fuel', date: '2026-11-05', checks: 10, up: 10, degraded: 0, down: 0, avgLatencyMs: 15 },
      { service: 'ipma', date: '2026-11-06', checks: 4, up: 2, degraded: 2, down: 0, avgLatencyMs: 80 }
    ],
    days: 4,
    generatedAt
  })

  assert.equal(payload.days, 4)
  assert.equal(payload.generatedAt, generatedAt.toISOString())
  assert.equal(payload.services.length, 2)
  assert.deepEqual(payload.services.map(s => s.id), ['fuel', 'ipma'])
  assert.deepEqual(payload.services[0].days.map(d => d.date), [
    '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'
  ])

  const fuelEmpty = payload.services[0].days.filter(d => d.uptime === null)
  assert.deepEqual(fuelEmpty.map(d => d.date), ['2026-11-03', '2026-11-04'])
  assert.equal(payload.services[0].uptime, (19 + 0) / 20)
  assert.equal(payload.services[1].uptime, (2 + 0.5 * 2) / 4)

  const ipmaDays = payload.services[1].days
  assert.equal(ipmaDays.filter(d => d.uptime === null).length, 3)
  assert.equal(ipmaDays.find(d => d.date === '2026-11-06').degraded, 2)

  // overall: fuel 19/20 up + ipma 2 up 2 degraded / 4  → (21 + 1) / 24
  assert.equal(payload.overall.uptime, (21 + 0.5 * 2) / 24)
})

test('buildHistoryPayload returns null overall uptime when there is no data', () => {
  const payload = buildHistoryPayload({
    services: [{ prefix: '/fuel', name: 'Fuel' }],
    dailyRows: [],
    days: 3,
    generatedAt: new Date('2026-11-06T12:00:00Z')
  })
  assert.equal(payload.overall.uptime, null)
  assert.equal(payload.services[0].uptime, null)
  assert.equal(payload.services[0].days.length, 3)
  assert.ok(payload.services[0].days.every(d => d.uptime === null && d.checks === 0))
})

test('formatIncident includes durationMin and null resolvedAt while open', () => {
  const startedAt = new Date('2026-11-06T10:00:00Z')
  const now = new Date('2026-11-06T11:30:00Z')
  const open = formatIncident({
    service: 'fuel',
    status: 'down',
    startedAt,
    resolvedAt: null
  }, now)
  assert.deepEqual(open, {
    service: 'fuel',
    status: 'down',
    startedAt: startedAt.toISOString(),
    resolvedAt: null,
    durationMin: 90
  })

  const closed = formatIncident({
    service: 'ipma',
    status: 'degraded',
    startedAt,
    resolvedAt: new Date('2026-11-06T10:12:00Z')
  }, now)
  assert.equal(closed.resolvedAt, '2026-11-06T10:12:00.000Z')
  assert.equal(closed.durationMin, 12)
  assert.equal(incidentDurationMin({ startedAt, resolvedAt: null }, now), 90)
})

test('incidentOverlapsWindow includes open and in-range incidents', () => {
  const cutoff = new Date('2026-10-01T00:00:00Z')
  const now = new Date('2026-11-06T00:00:00Z')
  assert.equal(incidentOverlapsWindow({
    startedAt: '2026-09-01T00:00:00Z',
    resolvedAt: '2026-09-02T00:00:00Z'
  }, cutoff, now), false)
  assert.equal(incidentOverlapsWindow({
    startedAt: '2026-09-01T00:00:00Z',
    resolvedAt: null
  }, cutoff, now), true)
  assert.equal(incidentOverlapsWindow({
    startedAt: '2026-10-15T00:00:00Z',
    resolvedAt: '2026-10-16T00:00:00Z'
  }, cutoff, now), true)
})

test('classifyHealth maps HTTP and body status to up/degraded/down', () => {
  assert.equal(classifyHealth({ ok: true, status: 200 }, { status: 'ok' }), 'up')
  assert.equal(classifyHealth({ ok: true, status: 200 }, { status: 'degraded' }), 'degraded')
  assert.equal(classifyHealth({ ok: true, status: 200 }, { status: 'down' }), 'down')
  assert.equal(classifyHealth({ ok: false, status: 503 }, {}), 'down')
  assert.equal(classifyHealth({ ok: false, status: 429 }, {}), 'degraded')
})

function startHealthServer(handler) {
  const server = createServer(handler)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done, fail) => server.close(err => err ? fail(err) : done()))
      })
    })
  })
}

test('checkService reports degraded when the health body says so', async () => {
  const mock = await startHealthServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'degraded', version: 'test' }))
  })
  try {
    const result = await checkService({ name: 'Fuel', prefix: '/fuel', target: mock.url })
    assert.equal(result.status, 'degraded')
    assert.equal(result.prefix, '/v1/fuel')
    assert.equal(serviceHealthUrl(mock.url), `${mock.url}/health`)
  } finally {
    await mock.close()
  }
})

test('checkService reports down when the health endpoint is unreachable', async () => {
  const result = await checkService({
    name: 'Missing',
    prefix: '/missing',
    target: 'http://127.0.0.1:1'
  })
  assert.equal(result.status, 'down')
  assert.equal(result.error, 'unreachable')
})
