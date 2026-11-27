import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compactText, normalizeText } from './normalize.js'

const SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'geo-ref.snapshot.json')

const IPMA_DISTRICT_AREA = {
  '01': ['AVR'],
  '02': ['BJA'],
  '03': ['BRG'],
  '04': ['BGC'],
  '05': ['CBO'],
  '06': ['CBR'],
  '07': ['EVR'],
  '08': ['FAR'],
  '09': ['GDA'],
  '10': ['LRA'],
  '11': ['LSB'],
  '12': ['PTG'],
  '13': ['PTO'],
  '14': ['STM'],
  '15': ['STB'],
  '16': ['VCT'],
  '17': ['VRL'],
  '18': ['VIS'],
  RAM: ['MCN', 'MCS', 'MPS'],
  RAA: ['ACE', 'AOC', 'AOR']
}

const DISTRICT_ALIASES = {
  acores: 'RAA',
  'regiao autonoma dos acores': 'RAA',
  raa: 'RAA',
  madeira: 'RAM',
  'regiao autonoma da madeira': 'RAM',
  ram: 'RAM',
  'ilha da madeira': 'RAM',
  'ilha de porto santo': 'RAM',
  'ilha de santa maria': 'RAA',
  'ilha de sao miguel': 'RAA',
  'ilha terceira': 'RAA',
  'ilha da graciosa': 'RAA',
  'ilha de sao jorge': 'RAA',
  'ilha do pico': 'RAA',
  'ilha do faial': 'RAA',
  'ilha das flores': 'RAA',
  'ilha do corvo': 'RAA'
}

const MUNICIPALITY_ALIASES = {
  'fig. castelo rodrigo': '0904',
  'fig castelo rodrigo': '0904',
  'figueira castelo rodrigo': '0904',
  'lagoa (acores)': '4201',
  'lagoa acores': '4201',
  'lagoa (sao miguel)': '4201',
  'lagoa (faro)': '0806',
  'lagoa (algarve)': '0806',
  'calheta (madeira)': '3101',
  'calheta madeira': '3101',
  'calheta (acores)': '4501',
  'calheta acores': '4501',
  'calheta de sao jorge': '4501'
}

const HOMONYMS = {
  lagoa: ['0806', '4201'],
  calheta: ['3101', '4501']
}

const GPS_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const GEO_REFRESH_MS = 24 * 60 * 60 * 1000

const gpsCache = new Map()
let loaded = null
let loadedAt = 0

function padIne(value) {
  return String(value ?? '').padStart(4, '0')
}

function districtCodeFromIne(codigoine) {
  const code = padIne(codigoine)
  const prefix = code.slice(0, 2)
  if (prefix === '31' || prefix === '32') return 'RAM'
  if (prefix >= '41' && prefix <= '49') return 'RAA'
  return prefix
}

function readSnapshot() {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
}

function indexRef(snapshot) {
  const municipalities = snapshot.municipalities.map(m => ({
    ...m,
    code: padIne(m.code),
    district_code: m.district_code || districtCodeFromIne(m.code)
  }))
  const districts = snapshot.districts.map(d => ({
    code: String(d.code),
    name: d.name
  }))
  return {
    municipalities,
    districts,
    byCode: new Map(municipalities.map(m => [m.code, m])),
    bySlug: new Map(municipalities.map(m => [m.slug, m])),
    byCompactName: groupBy(municipalities, m => compactText(m.name)),
    byNormName: groupBy(municipalities, m => normalizeText(m.name)),
    districtByCode: new Map(districts.map(d => [d.code, d])),
    districtByNorm: new Map(districts.map(d => [normalizeText(d.name), d]))
  }
}

function groupBy(list, keyOf) {
  const map = new Map()
  for (const item of list) {
    const key = keyOf(item)
    if (!key) continue
    const arr = map.get(key) || []
    arr.push(item)
    map.set(key, arr)
  }
  return map
}

export function loadGeoRefSync() {
  if (loaded) return loaded
  loaded = indexRef(readSnapshot())
  loadedAt = Date.now()
  return loaded
}

export function getMunicipalities() {
  return loadGeoRefSync().municipalities
}

export function getDistricts() {
  return loadGeoRefSync().districts
}

export function getMunicipality(code) {
  if (code == null) return null
  return loadGeoRefSync().byCode.get(padIne(code)) || null
}

export function ipmaAreaFor(districtCode) {
  if (districtCode == null) return []
  const key = String(districtCode).toUpperCase()
  return IPMA_DISTRICT_AREA[key] ? [...IPMA_DISTRICT_AREA[key]] : []
}

export function ipmaAreasForMunicipality(code) {
  const muni = getMunicipality(code)
  if (!muni) return []
  return ipmaAreaFor(muni.district_code)
}

function unique(list) {
  return [...new Set(list.filter(Boolean))]
}

function withDistrict(candidates, districtHint) {
  if (!districtHint || candidates.length <= 1) return candidates
  const district = resolveDistrict(districtHint)
  if (!district.code) return candidates
  const filtered = candidates.filter(m => m.district_code === district.code)
  return filtered.length ? filtered : candidates
}

/**
 * Resolve a municipality from name, slug, INE code or alias.
 * Ambiguous names (Lagoa, Calheta) need a district hint or a qualifier.
 *
 * @returns {{ code: string } | { error: 'ambiguous', candidates: object[] } | { error: 'unknown' }}
 */
export function resolveMunicipality(text, { district } = {}) {
  const raw = String(text ?? '').trim()
  if (!raw) return { error: 'unknown' }

  const ref = loadGeoRefSync()
  if (/^\d{3,4}$/.test(raw)) {
    const muni = ref.byCode.get(padIne(raw))
    return muni ? { code: muni.code } : { error: 'unknown' }
  }

  const norm = normalizeText(raw)
  const compact = compactText(raw)

  const aliasCode = MUNICIPALITY_ALIASES[norm]
  if (aliasCode) return { code: aliasCode }

  const homonym = HOMONYMS[norm] || HOMONYMS[compact]
  if (homonym && !district) {
    return {
      error: 'ambiguous',
      candidates: homonym.map(code => ref.byCode.get(code)).filter(Boolean)
    }
  }
  if (homonym && district) {
    const picked = withDistrict(homonym.map(code => ref.byCode.get(code)).filter(Boolean), district)
    if (picked.length === 1) return { code: picked[0].code }
    if (picked.length > 1) return { error: 'ambiguous', candidates: picked }
  }

  const slugHit = ref.bySlug.get(raw) || ref.bySlug.get(norm)
  if (slugHit) return { code: slugHit.code }

  let candidates = [
    ...(ref.byNormName.get(norm) || []),
    ...(ref.byCompactName.get(compact) || [])
  ]
  candidates = unique(candidates.map(m => m.code)).map(code => ref.byCode.get(code))
  candidates = withDistrict(candidates, district)

  if (candidates.length === 1) return { code: candidates[0].code }
  if (candidates.length > 1) return { error: 'ambiguous', candidates }
  return { error: 'unknown' }
}

export function resolveDistrict(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return { error: 'unknown' }
  const ref = loadGeoRefSync()
  const upper = raw.toUpperCase()
  if (ref.districtByCode.has(upper)) return { code: upper }
  if (/^\d{1,2}$/.test(raw)) {
    const code = raw.padStart(2, '0')
    if (ref.districtByCode.has(code)) return { code }
  }
  const alias = DISTRICT_ALIASES[normalizeText(raw)]
  if (alias) return { code: alias }
  const byName = ref.districtByNorm.get(normalizeText(raw))
  if (byName) return { code: byName.code }
  return { error: 'unknown' }
}

export function formatMunicipalitySuggestion(muni) {
  const district = muni.district ? `, ${muni.district}` : ''
  return `${muni.code} (${muni.name}${district})`
}

export function suggestionMessage(key, result, limit = 8) {
  if (result.error === 'ambiguous') {
    const options = result.candidates.map(formatMunicipalitySuggestion).slice(0, limit)
    return `${key} is ambiguous; must be one of: ${options.join(', ')}`
  }
  const sample = getMunicipalities().slice(0, limit).map(formatMunicipalitySuggestion)
  return `${key} must be a municipality code, slug or name, e.g. ${sample.join(', ')}`
}

/**
 * Parse BASE `local` (one or more "Portugal, distrito, concelho" lines).
 */
export function parseBaseLocal(local) {
  const municipality_codes = []
  const district_codes = []
  const text = String(local ?? '')
  for (const line of text.split(/\n+/)) {
    const parts = line.split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length === 0) continue
    const geo = parts[0].toLowerCase() === 'portugal' ? parts.slice(1) : parts
    if (geo.length === 0) continue
    if (geo.length === 1) {
      const district = resolveDistrict(geo[0])
      if (district.code) district_codes.push(district.code)
      else {
        const muni = resolveMunicipality(geo[0])
        if (muni.code) {
          municipality_codes.push(muni.code)
          const row = getMunicipality(muni.code)
          if (row?.district_code) district_codes.push(row.district_code)
        }
      }
      continue
    }
    const districtName = geo[geo.length - 2]
    const concelhoName = geo[geo.length - 1]
    const muni = resolveMunicipality(concelhoName, { district: districtName })
    if (muni.code) {
      municipality_codes.push(muni.code)
      const row = getMunicipality(muni.code)
      if (row?.district_code) district_codes.push(row.district_code)
    }
    const district = resolveDistrict(districtName)
    if (district.code) district_codes.push(district.code)
  }
  return {
    municipality_codes: unique(municipality_codes),
    district_codes: unique(district_codes)
  }
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = deg => (Number(deg) * Math.PI) / 180
  const r = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Ray-casting point-in-polygon. Ring is [[lng, lat], ...]. */
export function pointInPolygon(lng, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][0])
    const yi = Number(ring[i][1])
    const xj = Number(ring[j][0])
    const yj = Number(ring[j][1])
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

export function pointInGeoJSON(lng, lat, geometry) {
  if (!geometry) return false
  if (geometry.type === 'Polygon') {
    const [outer, ...holes] = geometry.coordinates || []
    if (!pointInPolygon(lng, lat, outer)) return false
    return holes.every(hole => !pointInPolygon(lng, lat, hole))
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || []).some(polygon => {
      const [outer, ...holes] = polygon
      return pointInPolygon(lng, lat, outer) && holes.every(hole => !pointInPolygon(lng, lat, hole))
    })
  }
  return false
}

function estimatedRadiusKm(muni) {
  const areaHa = Number(muni.area_ha)
  if (!Number.isFinite(areaHa) || areaHa <= 0) return 35
  const radiusM = Math.sqrt((areaHa * 10_000) / Math.PI)
  return Math.max(15, (radiusM / 1000) * 1.6)
}

export function nearestMunicipality(lat, lon) {
  const la = Number(lat)
  const lo = Number(lon)
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null
  let best = null
  let bestKm = Infinity
  for (const muni of getMunicipalities()) {
    if (muni.lat == null || muni.lng == null) continue
    const km = haversineKm(la, lo, muni.lat, muni.lng)
    if (km < bestKm) {
      bestKm = km
      best = muni
    }
  }
  if (!best || bestKm > estimatedRadiusKm(best)) return null
  return best.code
}

function gpsCacheKey(lat, lon) {
  return `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`
}

async function fetchGps(lat, lon, fetcher) {
  if (typeof fetcher === 'function') return fetcher(lat, lon)
  const url = `https://json.geoapi.pt/gps/${lat},${lon}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'ApiAberta-Webhooks/1.0' }
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolve a lat/lon to an INE municipality code.
 * Prefers geoapi.pt reverse geocoding (same source as /v1/geo); falls back to
 * the nearest centroid in the snapshot (area-bounded). Optional GeoJSON rings
 * are tested with point-in-polygon when provided.
 */
export async function locateMunicipality(lat, lon, { gpsFetcher, polygons } = {}) {
  const la = Number(lat)
  const lo = Number(lon)
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null

  if (Array.isArray(polygons)) {
    for (const row of polygons) {
      if (row?.geometry && pointInGeoJSON(lo, la, row.geometry)) return row.code
    }
  }

  const key = gpsCacheKey(la, lo)
  const cached = gpsCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.code

  const gps = await fetchGps(la, lo, gpsFetcher)
  let code = null
  if (gps?.concelho) {
    const resolved = resolveMunicipality(gps.concelho, { district: gps.distrito })
    if (resolved.code) code = resolved.code
  }
  if (!code) code = nearestMunicipality(la, lo)

  gpsCache.set(key, { code, expires: Date.now() + GPS_CACHE_TTL_MS })
  return code
}

export function coordsOf(payload) {
  const lat = payload?.lat ?? payload?.latitude ?? payload?.location?.lat
  const lon = payload?.lon ?? payload?.lng ?? payload?.longitude ?? payload?.location?.lng
  if (lat == null || lon == null) return null
  const la = Number(lat)
  const lo = Number(lon)
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null
  return { lat: la, lon: lo }
}

export function withinRadius(payload, radius) {
  if (!radius || typeof radius !== 'object') return false
  const point = coordsOf(payload)
  const lat = Number(radius.lat)
  const lon = Number(radius.lon ?? radius.lng)
  const km = Number(radius.km)
  if (!point || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(km)) return false
  return haversineKm(point.lat, point.lon, lat, lon) <= km
}

export function municipalityName(code) {
  return getMunicipality(code)?.name || null
}

export function districtName(code) {
  if (code == null) return null
  return loadGeoRefSync().districtByCode.get(String(code).toUpperCase())?.name
    || loadGeoRefSync().districtByCode.get(String(code))?.name
    || null
}

export function publicGeoRefs() {
  return {
    municipalities: getMunicipalities().map(m => ({
      code: m.code,
      name: m.name,
      district_code: m.district_code,
      district: m.district
    })),
    districts: getDistricts()
  }
}

export async function refreshGeoRefFromConnector(fetcher) {
  if (Date.now() - loadedAt < GEO_REFRESH_MS && loaded) return loaded
  if (typeof fetcher !== 'function') return loadGeoRefSync()
  try {
    const json = await fetcher('/geo', '/geo/municipalities?limit=400')
    const rows = Array.isArray(json?.data) ? json.data : []
    if (rows.length < 300) return loadGeoRefSync()
    const snapshot = readSnapshot()
    const mapped = rows.map(m => {
      const code = padIne(m.codigoine || m.code)
      const district_code = districtCodeFromIne(code)
      const known = snapshot.districts.find(d => d.code === district_code)
      return {
        code,
        name: m.name,
        slug: m.slug,
        district_code,
        district: known?.name === 'Região Autónoma dos Açores'
          ? 'Açores'
          : known?.name === 'Região Autónoma da Madeira'
            ? 'Madeira'
            : (m.district || known?.name || null),
        lat: m.coords?.lat ?? m.lat ?? null,
        lng: m.coords?.lng ?? m.lng ?? null,
        area_ha: m.area_ha ?? null
      }
    })
    loaded = indexRef({ municipalities: mapped, districts: snapshot.districts })
    loadedAt = Date.now()
    return loaded
  } catch {
    return loadGeoRefSync()
  }
}

loadGeoRefSync()
