/**
 * sanitize.js - MongoDB injection protection
 *
 * Strips keys that start with '$' from request body, query, and params.
 * Fastify schema validation already coerces inputs to the right types,
 * but this is an extra defense-in-depth layer.
 */

function stripDollarKeys(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj
  const clean = {}
  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith('$')) continue
    clean[key] = typeof val === 'object' ? stripDollarKeys(val) : val
  }
  return clean
}

export async function sanitizePlugin(app) {
  app.addHook('preValidation', async (req, _reply) => {
    if (req.body   && typeof req.body   === 'object') req.body   = stripDollarKeys(req.body)
    if (req.query  && typeof req.query  === 'object') req.query  = stripDollarKeys(req.query)
    if (req.params && typeof req.params === 'object') req.params = stripDollarKeys(req.params)
  })
}
