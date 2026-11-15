/**
 * Client IP behind Cloudflare + a local reverse proxy (cloudflared / nginx).
 *
 * Prefer CF-Connecting-IP: Cloudflare overwrites that header, so a visitor
 * cannot spoof it on traffic that actually went through Cloudflare.
 * Do not read X-Forwarded-For here — the leftmost hop is client-controlled.
 * req.ip is the fallback once Fastify trustProxy is limited to local proxies.
 */

export const TRUST_PROXY = ['127.0.0.1', '::1', '::ffff:127.0.0.1']

function firstHeaderValue(value) {
  if (Array.isArray(value)) value = value[0]
  if (typeof value !== 'string') return ''
  return value.trim()
}

export function getClientIp(req) {
  const cfConnectingIp = firstHeaderValue(req?.headers?.['cf-connecting-ip'])
  if (cfConnectingIp) return cfConnectingIp
  return req?.ip || ''
}
