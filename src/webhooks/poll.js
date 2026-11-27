import { createHash } from 'crypto'
import { EventState, Webhook } from '../db.js'
import { config } from '../config.js'
import { FUEL_SLUGS } from './catalog.js'
import { dispatchEvent } from './dispatch.js'
import {
  districtName,
  getMunicipality,
  locateMunicipality,
  municipalityName,
  parseBaseLocal,
  resolveDistrict,
  resolveMunicipality
} from './geo-ref.js'

const FETCH_TIMEOUT_MS = 8_000

export function serviceTarget(prefix) {
  return config.services.find(s => s.prefix === prefix)?.target || null
}

export async function fetchJson(url, { timeout = FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
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

export async function connectorGet(prefix, pathAndQuery) {
  const target = serviceTarget(prefix)
  if (!target) return null
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`
  return fetchJson(`${target}${path}`)
}

export function listItems(payload) {
  if (payload == null) return []
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.data)) return payload.data
  if (Array.isArray(payload.items)) return payload.items
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return Object.values(payload.data).filter(v => v && typeof v === 'object')
  }
  return []
}

export async function getState(key) {
  const s = await EventState.findOne({ key }).lean()
  return s ? s.value : null
}

export async function setState(key, value) {
  await EventState.findOneAndUpdate(
    { key },
    { value, updatedAt: new Date() },
    { upsert: true, new: true }
  )
}

export function fingerprint(value) {
  const json = JSON.stringify(value)
  return createHash('sha256').update(json).digest('hex')
}

export function extractNifs(...values) {
  const found = new Set()
  for (const value of values) {
    if (value == null) continue
    const text = Array.isArray(value) ? value.join(' ') : String(value)
    for (const match of text.match(/\b\d{9}\b/g) || []) found.add(match)
  }
  return [...found]
}

export function anpcConcelho(inc) {
  if (inc.concelho) return inc.concelho
  if (inc.municipality) return inc.municipality
  if (inc.location?.municipality) return inc.location.municipality
  if (inc.location?.concelho) return inc.location.concelho
  const address = inc.location?.address || (typeof inc.location === 'string' ? inc.location : '')
  if (address) {
    const parts = String(address).split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length >= 2) return parts[1]
  }
  return null
}

export function anpcDistrict(inc) {
  return inc.district || inc.location?.district || null
}

export function nasafirmsId(h) {
  if (h.id || h.hotspot_id) return String(h.id || h.hotspot_id)
  const lat = h.latitude ?? h.lat
  const lon = h.longitude ?? h.lon ?? h.lng
  const date = h.acq_date || h.date || ''
  const time = h.acq_time || h.time || ''
  const sat = h.satellite || h.instrument || h.source || ''
  if (lat == null || lon == null) return null
  return `${lat}|${lon}|${date}|${time}|${sat}`
}

export function canonicalDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
  return d.toISOString().slice(0, 10)
}

export function stableWarningId(w) {
  const area = w.region || w.area || ''
  const type = w.type || ''
  const level = w.level || ''
  return `${area}|${type}|${level}|${canonicalDate(w.startTime)}|${canonicalDate(w.endTime)}`
}

function asValues(value) {
  if (value == null || value === '') return []
  return Array.isArray(value) ? value : [value]
}

function unique(list) {
  return [...new Set(list.filter(v => v != null && v !== ''))]
}

export function connectorGeoName(codeOrName, kind) {
  if (codeOrName == null || codeOrName === '') return null
  if (kind === 'municipality') {
    const byCode = getMunicipality(codeOrName)
    if (byCode) return byCode.name
    const resolved = resolveMunicipality(codeOrName)
    return resolved.code ? municipalityName(resolved.code) : String(codeOrName)
  }
  const district = resolveDistrict(codeOrName)
  return district.code ? districtName(district.code) : String(codeOrName)
}

export function enrichMunicipality(name, district) {
  const resolved = resolveMunicipality(name, { district })
  const muni = resolved.code ? getMunicipality(resolved.code) : null
  const dist = resolveDistrict(district)
  return {
    municipality_code: muni?.code || resolved.code || null,
    district_code: dist.code || muni?.district_code || null
  }
}

export function formatAnpcIncident(inc) {
  const concelho = anpcConcelho(inc)
  const district = anpcDistrict(inc)
  const geo = enrichMunicipality(concelho, district)
  return {
    id: String(inc.id),
    type: inc.type,
    type_code: inc.type_code ? String(inc.type_code) : null,
    natureza: inc.natureza || inc.type,
    location: inc.location?.address || inc.location,
    district,
    district_code: geo.district_code,
    concelho,
    municipality_code: geo.municipality_code,
    freguesia: inc.location?.freguesia || inc.freguesia || null,
    status: inc.status,
    active: inc.active,
    reported_at: inc.reported_at || inc.datetime || inc.date
  }
}

export function formatBaseContract(c) {
  const nifs = extractNifs(c.nif_entidade, c.contractingEntity, c.awarded, c.nifs, c.contractingNifs, c.awardedNifs)
  const cpv = c.cpv || (Array.isArray(c.cpvs) ? c.cpvs.map(x => x.code || x).join(' ') : null)
  const geo = parseBaseLocal(c.local)
  return {
    id: String(c.id),
    description: c.description,
    contractingEntity: c.contractingEntity,
    awarded: c.awarded,
    value: c.value,
    date: c.date,
    type: c.type,
    local: c.local,
    municipality_codes: geo.municipality_codes,
    district_codes: geo.district_codes,
    nif_entidade: nifs[0] || null,
    nifs,
    cpv,
    synced_at: c.synced_at || null
  }
}

export function dreEmitterMunicipality(emitter) {
  const text = String(emitter || '').trim()
  const match = text.match(/^(Munic[íi]pio|C[âa]mara Municipal)\s+d[eoa]s?\s+(.+)$/i)
  if (!match) return null
  const resolved = resolveMunicipality(match[2])
  return resolved.code || null
}

export async function enrichCoordinates(payload, lat, lon) {
  const code = await locateMunicipality(lat, lon)
  const muni = code ? getMunicipality(code) : null
  return {
    ...payload,
    municipality_code: code,
    district_code: muni?.district_code || null
  }
}

export const BASE_PAGE_SIZE = 100
export const BASE_SAFETY_CAP = 5000
export const ANPC_PAGE_SIZE = 100

function pageCount(json) {
  return json?.pages || json?.meta?.pages || 1
}

async function fetchPaged(prefix, path, { limit = 100, maxPages = 50, extra = {} } = {}) {
  const items = []
  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({ ...extra, limit: String(limit), page: String(page) })
    const json = await connectorGet(prefix, `${path}?${qs}`)
    const batch = listItems(json)
    items.push(...batch)
    if (batch.length === 0 || page >= pageCount(json)) break
  }
  return items
}

/**
 * First observation of a key only stores ids/hash — never dispatches —
 * so a process restart does not replay the current snapshot.
 */
export async function takeNewItems(stateKey, items, { idOf, cap = 500 } = {}) {
  const withIds = items
    .map(item => ({ item, id: idOf(item) }))
    .filter(x => x.id != null && x.id !== '')
    .map(x => ({ ...x, id: String(x.id) }))

  const prev = await getState(stateKey)
  if (prev == null) {
    await setState(stateKey, withIds.map(x => x.id).slice(-cap))
    return { seeded: true, fresh: [], commit: async () => {} }
  }

  const known = new Set((Array.isArray(prev) ? prev : []).map(String))
  const fresh = withIds.filter(x => !known.has(x.id)).map(x => x.item)
  const commit = async () => {
    if (!fresh.length) return
    const merged = [...known, ...fresh.map(i => String(idOf(i)))]
    await setState(stateKey, merged.slice(-cap))
  }
  return { seeded: false, fresh, commit }
}

async function dispatchNewItems(event, items, { stateKey, idOf, toPayload, cap, log, msg }) {
  const { fresh, commit } = await takeNewItems(stateKey, items, { idOf, cap })
  for (const item of fresh) {
    const payload = await toPayload(item)
    await dispatchEvent(event, payload)
    log?.info({ id: idOf(item) }, msg)
  }
  await commit()
  return fresh.length
}

async function dispatchIfFingerprintChanged(event, value, { stateKey, toPayload, log, msg }) {
  if (value == null) return 0
  const fp = fingerprint(value)
  const prev = await getState(stateKey)
  if (prev == null) {
    await setState(stateKey, fp)
    return 0
  }
  if (prev === fp) return 0
  const n = await dispatchEvent(event, toPayload(value))
  await setState(stateKey, fp)
  log?.info({ event }, msg)
  return n
}

// ─── Fuel ─────────────────────────────────────────────────────────────────────

function fuelSummaryPayload(records, date) {
  const bySlug = Object.fromEntries(records.map(r => [r.fuel_slug, r]))
  const avg = slug => bySlug[slug]?.avg_price_eur ?? null
  return {
    date,
    diesel_avg: avg('diesel'),
    gasoline95_avg: avg('gasoline_95'),
    lpg_avg: avg('gpl_auto'),
    records: records.reduce((n, r) => n + (r.station_count || 0), records.length),
    fuels: records
  }
}

async function fetchFuelStations(params) {
  const items = []
  const qsBase = { limit: '100', ...params }
  for (let page = 1; page <= 10; page++) {
    const qs = new URLSearchParams({ ...qsBase, page: String(page) })
    const json = await connectorGet('/fuel', `/fuel/stations?${qs}`)
    const batch = listItems(json)
    items.push(...batch)
    const pages = json?.meta?.pages || 1
    if (page >= pages || batch.length === 0) break
  }
  return items
}

function enrichFuelStation(s, fuel, date) {
  const geo = enrichMunicipality(s.municipality, s.district)
  return {
    ...s,
    fuel: s.fuel_slug || fuel,
    fuel_slug: s.fuel_slug || fuel,
    date,
    municipality_code: geo.municipality_code,
    district_code: geo.district_code
  }
}

async function stationsForFuelWebhooks(webhooks, date) {
  const needed = webhooks
    .map(w => (w.filters && w.filters['fuel.prices.updated']) || {})
    .filter(f => f.district || f.municipality || f.brand || f.fuel)

  if (needed.length === 0) return []

  const seen = new Set()
  const items = []

  for (const f of needed) {
    const fuels = asValues(f.fuel)
    const fuelList = fuels.length ? fuels : FUEL_SLUGS
    const districts = asValues(f.district)
    const municipalities = asValues(f.municipality)
    const brands = asValues(f.brand)
    const districtList = districts.length ? districts : [null]
    const municipalityList = municipalities.length ? municipalities : [null]
    const brandList = brands.length ? brands : [null]

    for (const fuel of fuelList) {
      for (const district of districtList) {
        for (const municipality of municipalityList) {
          for (const brand of brandList) {
            const key = JSON.stringify({ fuel, district, municipality, brand })
            if (seen.has(key)) continue
            seen.add(key)
            const params = { fuel }
            if (district) params.district = connectorGeoName(district, 'district')
            if (municipality) params.municipality = connectorGeoName(municipality, 'municipality')
            if (brand) params.brand = brand
            const batch = await fetchFuelStations(params)
            for (const s of batch) items.push(enrichFuelStation(s, fuel, date))
          }
        }
      }
    }
  }
  return items
}

export async function pollFuelPrices(log) {
  const json = await connectorGet('/fuel', '/fuel/prices')
  if (!json) return
  const records = listItems(json)
  const date = json.date || records[0]?.date
  if (!date) return

  const lastDate = await getState('fuel.prices.date')
  if (lastDate == null) {
    await setState('fuel.prices.date', date)
    return
  }
  if (lastDate === date) return

  const summary = fuelSummaryPayload(records, date)
  const webhooks = await Webhook.find({ events: 'fuel.prices.updated', active: true }).lean()
  const items = await stationsForFuelWebhooks(webhooks, date)

  await dispatchEvent('fuel.prices.updated', summary, { summary, items })
  await setState('fuel.prices.date', date)
  log?.info({ date, stations: items.length }, 'Fuel prices update event dispatched')
}

// ─── IPMA ─────────────────────────────────────────────────────────────────────

export async function pollIPMAWarnings(log) {
  const json = await connectorGet('/ipma', '/ipma/warnings')
  if (!json) return
  await dispatchNewItems('ipma.warning.new', listItems(json), {
    stateKey: 'ipma.warning.ids',
    cap: 400,
    idOf: stableWarningId,
    toPayload: w => ({
      id: stableWarningId(w),
      source_id: w.id || null,
      level: w.level,
      type: w.type,
      text: w.text,
      region: w.region,
      area: w.area || w.region,
      startTime: w.startTime,
      endTime: w.endTime
    }),
    log,
    msg: 'New IPMA warning event dispatched'
  })
}

export async function pollIPMASeismic(log) {
  const json = await connectorGet('/ipma', '/ipma/seismic?limit=30')
  const latest = await connectorGet('/ipma', '/ipma/seismic/latest')
  const items = [
    ...listItems(json),
    ...listItems(latest)
  ]
  await dispatchNewItems('ipma.seismic.new', items, {
    stateKey: 'ipma.seismic.ids',
    cap: 500,
    idOf: e => e.id,
    toPayload: async e => enrichCoordinates({
      id: e.id,
      time: e.time,
      lat: e.lat,
      lon: e.lon,
      depth_km: e.depth_km,
      magnitude: e.magnitude,
      mag_type: e.mag_type,
      region: e.region,
      obs_region: e.obs_region,
      sensed: e.sensed
    }, e.lat, e.lon),
    log,
    msg: 'New IPMA seismic event dispatched'
  })
}

// ─── ANPC ─────────────────────────────────────────────────────────────────────

async function subscribedAnpcDistricts() {
  const webhooks = await Webhook.find({
    events: { $in: ['anpc.incident.new', 'anpc.incident.updated'] },
    active: true
  }).lean()
  const names = []
  for (const w of webhooks) {
    for (const event of ['anpc.incident.new', 'anpc.incident.updated']) {
      for (const code of asValues(w.filters?.[event]?.district)) {
        names.push(connectorGeoName(code, 'district'))
      }
    }
  }
  return unique(names)
}

export async function fetchAnpcIncidents() {
  const byId = new Map()
  const add = items => {
    for (const item of items) {
      if (item?.id != null) byId.set(String(item.id), item)
    }
  }

  const active = await connectorGet('/anpc', `/anpc/incidents/active?limit=${ANPC_PAGE_SIZE}`)
  add(listItems(active))
  add(await fetchPaged('/anpc', '/anpc/incidents', {
    limit: ANPC_PAGE_SIZE,
    maxPages: 10,
    extra: { active: 'true' }
  }))

  for (const district of await subscribedAnpcDistricts()) {
    add(await fetchPaged('/anpc', '/anpc/incidents', {
      limit: ANPC_PAGE_SIZE,
      maxPages: 5,
      extra: { district, active: 'true' }
    }))
  }
  return [...byId.values()]
}

function incidentFingerprint(p) {
  return { status: p.status || null, active: Boolean(p.active) }
}

function incidentChanged(prev, next) {
  if (!prev) return false
  return prev.status !== next.status || Boolean(prev.active) !== Boolean(next.active)
}

export async function pollANPCIncidents(log) {
  const items = await fetchAnpcIncidents()
  const payloads = items.map(formatAnpcIncident)
  const snapshot = Object.fromEntries(payloads.map(p => [p.id, incidentFingerprint(p)]))
  const prevDoc = await EventState.findOne({ key: 'anpc.incident.snapshot' }).lean()
  if (!prevDoc) {
    await setState('anpc.incident.snapshot', snapshot)
    return
  }
  const prev = prevDoc.value && typeof prevDoc.value === 'object' && !Array.isArray(prevDoc.value)
    ? prevDoc.value
    : {}

  const prevIds = new Set(Object.keys(prev))
  const currentIds = new Set(payloads.map(p => p.id))

  for (const payload of payloads) {
    if (!prevIds.has(payload.id)) {
      await dispatchEvent('anpc.incident.new', payload)
      log?.info({ id: payload.id }, 'New ANPC incident event dispatched')
      continue
    }
    if (incidentChanged(prev[payload.id], incidentFingerprint(payload))) {
      const changed = []
      if (prev[payload.id].status !== payload.status) changed.push('status')
      if (Boolean(prev[payload.id].active) !== Boolean(payload.active)) changed.push('active')
      await dispatchEvent('anpc.incident.updated', { ...payload, changed })
      log?.info({ id: payload.id }, 'ANPC incident update dispatched')
    }
  }

  for (const [id, before] of Object.entries(prev)) {
    if (!before.active || currentIds.has(id)) continue
    await dispatchEvent('anpc.incident.updated', {
      id,
      status: before.status,
      active: false,
      changed: ['active']
    })
    log?.info({ id }, 'ANPC incident ended')
  }

  const next = { ...snapshot }
  for (const [id, before] of Object.entries(prev)) {
    if (before.active && !currentIds.has(id)) next[id] = { status: before.status, active: false }
  }
  await setState('anpc.incident.snapshot', next)
}

export async function pollANPCWarnings(log) {
  const json = await connectorGet('/anpc', '/anpc/warnings?limit=20')
  if (!json) return
  await dispatchNewItems('anpc.warning.new', listItems(json), {
    stateKey: 'anpc.warning.ids',
    cap: 300,
    idOf: w => w.id,
    toPayload: w => ({
      id: String(w.id),
      text: w.text,
      label: w.label,
      source: w.source
    }),
    log,
    msg: 'New ANPC warning event dispatched'
  })
}

// ─── BASE ─────────────────────────────────────────────────────────────────────

async function subscribedBaseMunicipalities() {
  const webhooks = await Webhook.find({ events: 'base.contract.new', active: true }).lean()
  const names = []
  for (const w of webhooks) {
    for (const code of asValues(w.filters?.['base.contract.new']?.municipality)) {
      names.push(connectorGeoName(code, 'municipality'))
    }
  }
  return unique(names)
}

function contractSyncedAt(c) {
  return c.synced_at || c.date || null
}

export async function fetchBaseContracts({ afterSyncedAt } = {}) {
  const byId = new Map()
  const add = items => {
    for (const item of items) {
      if (item?.id != null) byId.set(String(item.id), item)
    }
  }

  const maxPages = Math.ceil(BASE_SAFETY_CAP / BASE_PAGE_SIZE)
  let usedCursor = false

  if (afterSyncedAt) {
    const qs = new URLSearchParams({
      synced_after: afterSyncedAt,
      sort: 'synced_at',
      limit: String(BASE_PAGE_SIZE),
      page: '1'
    })
    const json = await connectorGet('/base', `/base/contracts?${qs}`)
    const batch = listItems(json)
    const honouring = batch.length > 0 && batch.every(c => {
      const ts = contractSyncedAt(c)
      return ts && String(ts) >= String(afterSyncedAt)
    })
    if (honouring) {
      usedCursor = true
      add(batch)
      for (let page = 2; page <= maxPages && byId.size < BASE_SAFETY_CAP; page++) {
        const next = await connectorGet('/base', `/base/contracts?${new URLSearchParams({
          synced_after: afterSyncedAt,
          sort: 'synced_at',
          limit: String(BASE_PAGE_SIZE),
          page: String(page)
        })}`)
        const rows = listItems(next)
        if (rows.length === 0) break
        add(rows)
        if (page >= pageCount(next)) break
      }
    }
  }

  if (!usedCursor) {
    for (let page = 1; page <= maxPages && byId.size < BASE_SAFETY_CAP; page++) {
      const json = await connectorGet('/base', `/base/contracts?${new URLSearchParams({
        limit: String(BASE_PAGE_SIZE),
        page: String(page)
      })}`)
      const batch = listItems(json)
      if (batch.length === 0) break
      add(batch)
      if (page >= pageCount(json)) break
    }
  }

  for (const local of await subscribedBaseMunicipalities()) {
    add(await fetchPaged('/base', '/base/contracts', {
      limit: BASE_PAGE_SIZE,
      maxPages: 10,
      extra: { local }
    }))
  }

  return [...byId.values()].slice(0, BASE_SAFETY_CAP)
}

export async function pollBASEContracts(log) {
  const cursor = await getState('base.contract.cursor')
  const afterSyncedAt = cursor?.syncedAfter || null
  const items = await fetchBaseContracts({ afterSyncedAt })
  if (items.length === 0) return

  await dispatchNewItems('base.contract.new', items, {
    stateKey: 'base.contract.ids',
    cap: BASE_SAFETY_CAP,
    idOf: c => c.id,
    toPayload: formatBaseContract,
    log,
    msg: 'New BASE contract event dispatched'
  })

  const maxSynced = items
    .map(contractSyncedAt)
    .filter(Boolean)
    .sort()
    .at(-1)
  if (maxSynced) {
    await setState('base.contract.cursor', { syncedAfter: maxSynced })
  }
}

// ─── EV ───────────────────────────────────────────────────────────────────────

export async function pollEVPrices(log) {
  let json = await connectorGet('/ev', '/ev/omie/current')
  let period = json?.data?.period || json?.period || json?.date || json?.meta?.date
  let price = json?.data?.price_eur_mwh ?? json?.price_eur_mwh ?? json?.data?.price ?? null

  if (period == null || price == null) {
    const today = await connectorGet('/ev', '/ev/omie/today')
    const slots = listItems(today)
    const withPrice = slots.find(s => (s.price_eur_mwh ?? s.price) != null)
    if (withPrice) {
      period = withPrice.period || withPrice.datetime || today?.meta?.date
      price = withPrice.price_eur_mwh ?? withPrice.price
      json = today
    }
  }

  if (!period) return

  const lastPeriod = await getState('ev.omie.period')
  if (lastPeriod == null) {
    await setState('ev.omie.period', String(period))
    return
  }
  if (String(lastPeriod) === String(period)) return

  await dispatchEvent('ev.prices.updated', {
    period,
    price_eur_mwh: price,
    price_eur_kwh: price != null ? (Number(price) / 1000).toFixed(5) : null,
    source: 'OMIE'
  })
  await setState('ev.omie.period', String(period))
  log?.info({ period, price }, 'EV prices update event dispatched')
}

export async function pollEVTariffs(log) {
  const json = await connectorGet('/ev', '/ev/tariffs')
  if (!json) return
  const tariffs = listItems(json).map(t => ({
    ceme: t.ceme,
    tariff_type: t.tariff_type,
    current_price_eur_kwh: t.current_price_eur_kwh,
    price_vazio_eur_kwh: t.price_vazio_eur_kwh,
    price_normal_eur_kwh: t.price_normal_eur_kwh,
    updated_at: t.updated_at
  }))
  const fp = fingerprint(tariffs)
  const prev = await getState('ev.tariffs.hash')
  if (prev == null) {
    await setState('ev.tariffs.hash', fp)
    return
  }
  if (prev === fp) return

  const summary = {
    updated_at: tariffs[0]?.updated_at || new Date().toISOString(),
    records: tariffs.length,
    tariffs
  }
  await dispatchEvent('ev.tariffs.updated', summary, { summary, items: tariffs })
  await setState('ev.tariffs.hash', fp)
  log?.info({ records: tariffs.length }, 'EV tariffs update event dispatched')
}

// ─── INE ──────────────────────────────────────────────────────────────────────

export async function pollINEIndicators(log) {
  const json = await connectorGet('/ine', '/ine/latest')
  if (!json) return
  const rows = listItems(json)
  const snapshot = Object.fromEntries(
    rows
      .filter(r => r.indicator)
      .map(r => [r.indicator, `${r.year}:${r.value}`])
  )
  const prev = await getState('ine.indicators.snapshot')
  if (prev == null) {
    await setState('ine.indicators.snapshot', snapshot)
    return
  }

  for (const row of rows) {
    if (!row.indicator) continue
    const key = `${row.year}:${row.value}`
    if (prev[row.indicator] === key) continue
    await dispatchEvent('ine.indicator.updated', {
      indicator: row.indicator,
      label: row.label,
      unit: row.unit,
      year: row.year,
      value: row.value
    })
    log?.info({ indicator: row.indicator, year: row.year }, 'INE indicator update dispatched')
  }
  await setState('ine.indicators.snapshot', snapshot)
}

// ─── BdP ──────────────────────────────────────────────────────────────────────

export async function pollBDPRates(log) {
  const json = await connectorGet('/bdp', '/bdp/rates')
  if (!json) return
  const rates = listItems(json)
  const fp = fingerprint(rates.map(r => ({ key: r.key, value: r.value, ref_date: r.ref_date })))
  const prev = await getState('bdp.rates.hash')
  if (prev == null) {
    await setState('bdp.rates.hash', fp)
    return
  }
  if (prev === fp) return

  const summary = {
    synced_at: json.synced_at || rates[0]?.synced_at,
    records: rates.length,
    rates
  }
  await dispatchEvent('bdp.rates.updated', summary, { summary, items: rates })
  await setState('bdp.rates.hash', fp)
  log?.info({ records: rates.length }, 'BdP rates update event dispatched')
}

// ─── DRE ──────────────────────────────────────────────────────────────────────

function dreId(d) {
  return d.id || d.diploma_id || d.url || d.dre_id || (d.number && d.date ? `${d.series || '1'}|${d.number}|${d.date}` : null)
}

export async function pollDREDiplomas(log) {
  const latest = await connectorGet('/dre', '/dre/latest')
  const legislation = await connectorGet('/dre', '/dre/legislation?limit=20')
  const items = [...listItems(latest), ...listItems(legislation)]
    .filter(d => dreId(d))
  if (items.length === 0) return

  await dispatchNewItems('dre.diploma.new', items, {
    stateKey: 'dre.diploma.ids',
    cap: 400,
    idOf: dreId,
    toPayload: d => {
      const emitter = d.emitter || d.emitente || d.entidade || null
      const summary = d.summary || d.sumario || d.text || null
      return {
        id: String(dreId(d)),
        title: d.title || d.titulo || summary,
        summary,
        emitter,
        emitter_municipality: dreEmitterMunicipality(emitter),
        series: d.series != null ? String(d.series) : 'I',
        number: d.number || d.numero,
        date: d.date || d.data,
        type: d.type || d.tipo,
        url: d.url
      }
    },
    log,
    msg: 'New DRE diploma event dispatched'
  })
}

// ─── NASA FIRMS ───────────────────────────────────────────────────────────────

export async function pollNasaFirms(log) {
  let json = await connectorGet('/nasafirms', '/nasafirms/hotspots?days=1&limit=100')
  let items = listItems(json)
  if (items.length === 0) {
    json = await connectorGet('/nasafirms', '/nasafirms/hotspots?days=2&limit=100')
    items = listItems(json)
  }
  await dispatchNewItems('nasafirms.fire.new', items, {
    stateKey: 'nasafirms.fire.ids',
    cap: 1000,
    idOf: nasafirmsId,
    toPayload: async h => {
      const latitude = h.latitude ?? h.lat
      const longitude = h.longitude ?? h.lon ?? h.lng
      return enrichCoordinates({
        id: nasafirmsId(h),
        latitude,
        longitude,
        acq_date: h.acq_date || h.date,
        acq_time: h.acq_time,
        satellite: h.satellite,
        instrument: h.instrument,
        confidence: h.confidence,
        frp: h.frp,
        source: h.source || h.instrument || h.satellite
      }, latitude, longitude)
    },
    log,
    msg: 'New NASA FIRMS hotspot dispatched'
  })
}

// ─── Carris / GTFS ────────────────────────────────────────────────────────────

export async function pollCarrisAlerts(log) {
  const json = await connectorGet('/carris', '/carris/alerts')
  if (!json) return
  await dispatchNewItems('carris.alert.new', listItems(json), {
    stateKey: 'carris.alert.ids',
    cap: 400,
    idOf: a => a.alert_id || a.id,
    toPayload: a => ({
      alert_id: a.alert_id || a.id,
      cause: a.cause,
      effect: a.effect,
      header_pt: a.header_pt,
      description_pt: a.description_pt,
      lines: a.lines,
      line: Array.isArray(a.lines) ? a.lines[0] : a.line,
      active_from: a.active_from,
      active_to: a.active_to,
      active: a.active
    }),
    log,
    msg: 'New Carris alert dispatched'
  })
}

export async function pollGTFSChanges(log) {
  const json = await connectorGet('/gtfs', '/gtfs/changes?limit=20')
  if (!json) return
  await dispatchNewItems('gtfs.changes.new', listItems(json), {
    stateKey: 'gtfs.changes.ids',
    cap: 300,
    idOf: c => c.id || `${c.feed_id}|${c.version_hash}|${c.detected_at}`,
    toPayload: c => ({
      feed_id: c.feed_id,
      version_hash: c.version_hash,
      detected_at: c.detected_at,
      summary: c.summary
    }),
    log,
    msg: 'New GTFS changes dispatched'
  })
}

// ─── Parlamento ───────────────────────────────────────────────────────────────

export async function pollParlamentoIniciativas(log) {
  const json = await connectorGet('/parlamento', '/parlamento/iniciativas?limit=20')
  if (!json) return
  await dispatchNewItems('parlamento.iniciativa.new', listItems(json), {
    stateKey: 'parlamento.iniciativa.ids',
    cap: 500,
    idOf: i => i.ini_id || i.id,
    toPayload: i => ({
      ini_id: i.ini_id || i.id,
      titulo: i.titulo,
      tipo: i.tipo,
      tipo_desc: i.tipo_desc,
      estado: i.estado,
      leg: i.leg,
      data_entrada: i.data_entrada,
      autores_gp: i.autores_gp,
      gp: Array.isArray(i.autores_gp) ? i.autores_gp.join(' ') : i.autores_gp,
      numero: i.numero
    }),
    log,
    msg: 'New parliamentary initiative dispatched'
  })
}

export async function pollParlamentoVotacoes(log) {
  const json = await connectorGet('/parlamento', '/parlamento/votacoes?limit=20')
  if (!json) return
  await dispatchNewItems('parlamento.votacao.new', listItems(json), {
    stateKey: 'parlamento.votacao.ids',
    cap: 500,
    idOf: v => v.vot_id || v.id,
    toPayload: v => ({
      vot_id: v.vot_id || v.id,
      data: v.data,
      resultado: v.resultado,
      fase: v.fase,
      ini_id: v.ini_id,
      ini_titulo: v.ini_titulo,
      a_favor: v.a_favor,
      contra: v.contra,
      abstencao: v.abstencao,
      gp: [...(v.a_favor || []), ...(v.contra || []), ...(v.abstencao || [])].join(' ')
    }),
    log,
    msg: 'New parliamentary vote dispatched'
  })
}

// ─── SNS ──────────────────────────────────────────────────────────────────────

export async function pollSNSDatasets(log) {
  const json = await connectorGet('/sns', '/sns/datasets')
  if (!json) return
  const rows = listItems(json)
  const snapshot = Object.fromEntries(
    rows
      .filter(r => r.key)
      .map(r => [r.key, r.last_changed || `${r.period_to}:${r.records}`])
  )
  const prev = await getState('sns.datasets.snapshot')
  if (prev == null) {
    await setState('sns.datasets.snapshot', snapshot)
    return
  }

  for (const row of rows) {
    if (!row.key) continue
    const token = snapshot[row.key]
    if (prev[row.key] === token) continue
    await dispatchEvent('sns.dataset.updated', {
      key: row.key,
      dataset: row.key,
      title: row.title,
      period_from: row.period_from,
      period_to: row.period_to,
      records: row.records,
      last_changed: row.last_changed,
      source_url: row.source_url
    })
    log?.info({ dataset: row.key }, 'SNS dataset update dispatched')
  }
  await setState('sns.datasets.snapshot', snapshot)
}

// ─── PRR / PT2030 ─────────────────────────────────────────────────────────────

export async function pollPRRCatalogue(log) {
  const summary = await connectorGet('/prr', '/prr/summary')
  const projects = await connectorGet('/prr', '/prr/projects?limit=100')
  if (!summary && !projects) return

  const investments = listItems(projects)
  const components = summary?.components || []
  const payload = {
    plan: summary?.plan,
    execution_period: summary?.execution_period,
    total_components: summary?.total_components ?? components.length,
    total_investments: summary?.total_investments ?? investments.length,
    components,
    investments
  }
  const fp = fingerprint(payload)
  const prev = await getState('prr.catalogue.hash')
  if (prev == null) {
    await setState('prr.catalogue.hash', fp)
    return
  }
  if (prev === fp) return

  const items = [
    ...components.map(c => ({ ...c, component: c.id })),
    ...investments.map(i => ({ ...i, component: i.parent_id || i.id }))
  ]
  await dispatchEvent('prr.catalogue.updated', payload, { summary: payload, items })
  await setState('prr.catalogue.hash', fp)
  log?.info({ components: components.length, investments: investments.length }, 'PRR catalogue update dispatched')
}

export async function pollPT2030Summary(log) {
  const json = await connectorGet('/pt2030', '/pt2030/summary')
  if (!json) return
  await dispatchIfFingerprintChanged('pt2030.summary.updated', json, {
    stateKey: 'pt2030.summary.hash',
    toPayload: v => ({
      plan: v.plan,
      execution_period: v.execution_period,
      total_budget: v.total_budget,
      source: v.source,
      description: v.description
    }),
    log,
    msg: 'PT2030 summary update dispatched'
  })
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

const POLLERS = [
  pollIPMAWarnings,
  pollIPMASeismic,
  pollFuelPrices,
  pollANPCIncidents,
  pollANPCWarnings,
  pollBASEContracts,
  pollEVPrices,
  pollEVTariffs,
  pollINEIndicators,
  pollBDPRates,
  pollDREDiplomas,
  pollNasaFirms,
  pollCarrisAlerts,
  pollGTFSChanges,
  pollParlamentoIniciativas,
  pollParlamentoVotacoes,
  pollSNSDatasets,
  pollPRRCatalogue,
  pollPT2030Summary
]

export async function pollForEvents(log) {
  await Promise.allSettled(POLLERS.map(fn => fn(log)))
}

export const POLLER_COUNT = POLLERS.length
