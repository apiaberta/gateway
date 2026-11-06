/**
 * Pure helpers for status history aggregation and response shaping.
 * No MongoDB access — routes and the collector own persistence.
 */

export const LISBON_TZ = 'Europe/Lisbon'
export const DEFAULT_HISTORY_DAYS = 90
export const MAX_HISTORY_DAYS = 365
export const CHECK_TTL_DAYS = 95
export const CHECK_TTL_SECONDS = CHECK_TTL_DAYS * 24 * 60 * 60

export function parseDaysParam(value, fallback = DEFAULT_HISTORY_DAYS) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_HISTORY_DAYS, Math.max(1, n))
}

export function lisbonDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LISBON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

/**
 * Consecutive YYYY-MM-DD calendar dates in Europe/Lisbon, ending today.
 */
export function enumerateDates(days, now = new Date()) {
  const end = lisbonDateString(now)
  const [y, m, d] = end.split('-').map(Number)
  const dates = []
  for (let i = days - 1; i >= 0; i--) {
    dates.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10))
  }
  return dates
}

/**
 * UTC instant of 00:00 in Europe/Lisbon for a YYYY-MM-DD calendar date.
 * Lisbon is UTC+0 in winter and UTC+1 in summer; we probe both offsets.
 */
export function lisbonDayStart(yyyyMmDd) {
  const winter = new Date(`${yyyyMmDd}T00:00:00.000Z`)
  const summer = new Date(`${yyyyMmDd}T00:00:00.000+01:00`)
  for (const candidate of [winter, summer]) {
    if (lisbonDateString(candidate) === yyyyMmDd) return candidate
  }
  return winter
}

export function serviceIdFromPrefix(prefix) {
  return String(prefix || '').replace(/^\/v1/, '').replace(/^\//, '')
}

export function serviceIdFromConfig(svc) {
  return serviceIdFromPrefix(svc.prefix)
}

/** Uptime = (up + 0.5 * degraded) / checks, or null when there are no checks. */
export function computeUptime(up, degraded, checks) {
  if (!checks) return null
  return (up + 0.5 * degraded) / checks
}

export function emptyDay(date) {
  return {
    date,
    uptime: null,
    checks: 0,
    down: 0,
    degraded: 0,
    avgLatencyMs: null
  }
}

export function dailyToDay(date, row) {
  if (!row || !row.checks) return emptyDay(date)
  return {
    date,
    uptime: computeUptime(row.up || 0, row.degraded || 0, row.checks),
    checks: row.checks,
    down: row.down || 0,
    degraded: row.degraded || 0,
    avgLatencyMs: row.avgLatencyMs
  }
}

export function buildHistoryPayload({ services, dailyRows, days, generatedAt }) {
  const dates = enumerateDates(days, generatedAt)
  const byService = new Map()
  for (const row of dailyRows) {
    if (!byService.has(row.service)) byService.set(row.service, new Map())
    byService.get(row.service).set(row.date, row)
  }

  let allUp = 0
  let allDegraded = 0
  let allChecks = 0

  const result = services.map(svc => {
    const id = serviceIdFromConfig(svc)
    const rows = byService.get(id) || new Map()
    let up = 0
    let degraded = 0
    let checks = 0
    const dayList = dates.map(date => {
      const row = rows.get(date)
      if (row) {
        up += row.up || 0
        degraded += row.degraded || 0
        checks += row.checks || 0
      }
      return dailyToDay(date, row)
    })
    allUp += up
    allDegraded += degraded
    allChecks += checks
    return {
      id,
      name: svc.name,
      uptime: computeUptime(up, degraded, checks),
      days: dayList
    }
  })

  return {
    generatedAt: generatedAt.toISOString(),
    days,
    overall: { uptime: computeUptime(allUp, allDegraded, allChecks) },
    services: result
  }
}

export function incidentDurationMin(incident, now = new Date()) {
  const start = new Date(incident.startedAt).getTime()
  const end = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : now.getTime()
  return Math.max(0, Math.round((end - start) / 60000))
}

export function formatIncident(incident, now = new Date()) {
  return {
    service: incident.service,
    status: incident.status,
    startedAt: new Date(incident.startedAt).toISOString(),
    resolvedAt: incident.resolvedAt ? new Date(incident.resolvedAt).toISOString() : null,
    durationMin: incidentDurationMin(incident, now)
  }
}

export function incidentOverlapsWindow(incident, cutoff, now = new Date()) {
  const started = new Date(incident.startedAt)
  if (started > now) return false
  const resolved = incident.resolvedAt ? new Date(incident.resolvedAt) : null
  if (resolved && resolved < cutoff) return false
  return true
}
