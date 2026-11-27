import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getMunicipality,
  haversineKm,
  ipmaAreaFor,
  locateMunicipality,
  nearestMunicipality,
  parseBaseLocal,
  pointInPolygon,
  resolveMunicipality
} from '../src/webhooks/geo-ref.js'

test('resolveMunicipality accepts name, slug and INE code', () => {
  assert.equal(resolveMunicipality('Fundão').code, '0504')
  assert.equal(resolveMunicipality('fundao').code, '0504')
  assert.equal(resolveMunicipality('0504').code, '0504')
  assert.equal(resolveMunicipality('Fig. Castelo Rodrigo').code, '0904')
  assert.equal(resolveMunicipality('Idanha-a-nova').code, '0505')
  assert.equal(resolveMunicipality('Idanha-a-Nova').code, '0505')
})

test('Lagoa without a district is ambiguous', () => {
  const result = resolveMunicipality('Lagoa')
  assert.equal(result.error, 'ambiguous')
  assert.deepEqual(result.candidates.map(c => c.code).sort(), ['0806', '4201'])
  assert.equal(resolveMunicipality('Lagoa (açores)').code, '4201')
  assert.equal(resolveMunicipality('Lagoa', { district: 'Faro' }).code, '0806')
})

test('Fundão maps to IPMA area CBO (district precision)', () => {
  const muni = getMunicipality('0504')
  assert.equal(muni.district_code, '05')
  assert.deepEqual(ipmaAreaFor('05'), ['CBO'])
  assert.deepEqual(ipmaAreaFor('RAA'), ['ACE', 'AOC', 'AOR'])
  assert.deepEqual(ipmaAreaFor('RAM'), ['MCN', 'MCS', 'MPS'])
})

test('point-in-polygon classifies a point inside a square', () => {
  const square = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]
  assert.equal(pointInPolygon(5, 5, square), true)
  assert.equal(pointInPolygon(20, 20, square), false)
})

test('nearestMunicipality falls back to centroid for Fundão coords', () => {
  const code = nearestMunicipality(40.104, -7.473)
  assert.equal(code, '0504')
})

test('locateMunicipality uses GPS concelho when provided', async () => {
  const code = await locateMunicipality(40.132, -7.501, {
    gpsFetcher: async () => ({ concelho: 'Fundão', distrito: 'Castelo Branco' })
  })
  assert.equal(code, '0504')
})

test('haversine of a point with itself is 0', () => {
  assert.equal(haversineKm(40, -7, 40, -7), 0)
})

test('parseBaseLocal district-only lines contribute district_codes', () => {
  const geo = parseBaseLocal('Portugal, Porto')
  assert.deepEqual(geo.district_codes, ['13'])
  assert.deepEqual(geo.municipality_codes, [])
})
