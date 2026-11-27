import jwt from 'jsonwebtoken'
import { Developer } from './db.js'
import { config } from './config.js'

/**
 * Resolve an active developer from Bearer JWT or X-API-Key.
 * JWT is tried first when Authorization: Bearer is present.
 *
 * @returns {{ developer: object } | { error: string }}
 */
export async function resolveDeveloper(req) {
  const authHeader = req.headers['authorization']
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), config.jwtSecret)
      const developer = await Developer.findById(payload.id)
      if (!developer || !developer.active) {
        return { error: 'Invalid or expired token' }
      }
      return { developer }
    } catch {
      return { error: 'Invalid or expired token' }
    }
  }

  const apiKey = req.headers['x-api-key']
  if (apiKey) {
    const developer = await Developer.findOne({ apiKey, active: true })
    if (!developer) {
      return { error: 'Invalid API key' }
    }
    return { developer }
  }

  return { error: 'Missing credentials' }
}
