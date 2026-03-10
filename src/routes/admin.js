import { Developer, UsageLog } from '../db.js'
import { cacheStats } from '../plugins/cache.js'

export async function adminRoutes(app) {

  // Middleware: admin only
  app.addHook('onRequest', async (req, reply) => {
    if (!req.developer || req.developer.tier !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Admin access required' })
    }
  })

  // GET /v1/admin/developers - list all developers
  app.get('/developers', async (req, reply) => {
    const developers = await Developer.find({}, '-apiKey').sort({ createdAt: -1 })
    return { count: developers.length, developers }
  })

  // PATCH /v1/admin/developers/:id/tier - upgrade/downgrade tier
  app.patch('/developers/:id/tier', async (req, reply) => {
    const { tier } = req.body
    if (!['free', 'pro', 'admin'].includes(tier)) {
      return reply.code(400).send({ error: 'Invalid tier' })
    }
    const dev = await Developer.findByIdAndUpdate(
      req.params.id,
      { tier },
      { new: true }
    )
    return { success: true, developer: dev }
  })

  // DELETE /v1/admin/developers/:id - deactivate account
  app.delete('/developers/:id', async (req, reply) => {
    await Developer.findByIdAndUpdate(req.params.id, { active: false })
    return { success: true }
  })

  // GET /v1/admin/cache — cache stats
  app.get('/cache', async () => {
    return { cache: cacheStats() }
  })

  // GET /v1/admin/usage - usage stats
  app.get('/usage', async (req, reply) => {
    const { from, to } = req.query
    const query = {}
    if (from || to) {
      query.timestamp = {}
      if (from) query.timestamp.$gte = new Date(from)
      if (to)   query.timestamp.$lte = new Date(to)
    }

    const [total, byEndpoint, byKey] = await Promise.all([
      UsageLog.countDocuments(query),
      UsageLog.aggregate([
        { $match: query },
        { $group: { _id: '$endpoint', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 }
      ]),
      UsageLog.aggregate([
        { $match: query },
        { $group: { _id: '$apiKey', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
    ])

    return { total, byEndpoint, byKey }
  })

  // Aliases /users → /developers (compatibilidade dev portal)
  app.get('/users', async (req, reply) => {
    const developers = await Developer.find({}, '-passwordHash').sort({ createdAt: -1 })
    return { count: developers.length, developers }
  })

  app.patch('/users/:id', async (req, reply) => {
    const { tier, active } = req.body
    const update = {}
    if (tier !== undefined) {
      if (!['free', 'pro', 'admin'].includes(tier))
        return reply.code(400).send({ error: 'Invalid tier' })
      update.tier = tier
    }
    if (active !== undefined) update.active = active
    const dev = await Developer.findByIdAndUpdate(req.params.id, update, { new: true })
    if (!dev) return reply.code(404).send({ error: 'Not found' })
    return { success: true, developer: dev }
  })

}