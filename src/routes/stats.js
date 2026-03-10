import { Developer, UsageLog } from '../db.js'
import { config } from '../config.js'

export async function statsRoutes(app) {

  // GET /v1/stats — public platform metrics
  app.get('/stats', {
    schema: {
      description: 'Public platform statistics for API Aberta',
      tags: ['Stats'],
      response: {
        200: {
          type: 'object',
          properties: {
            api_calls_total:      { type: 'number' },
            api_calls_today:      { type: 'number' },
            developers_registered:{ type: 'number' },
            connectors_active:    { type: 'number' },
            updated_at:           { type: 'string' }
          }
        }
      }
    }
  }, async (req, reply) => {
    const now = new Date()
    const startOfDay = new Date(now)
    startOfDay.setUTCHours(0, 0, 0, 0)

    const [api_calls_total, api_calls_today, developers_registered] = await Promise.all([
      UsageLog.countDocuments(),
      UsageLog.countDocuments({ timestamp: { $gte: startOfDay } }),
      Developer.countDocuments({ active: true })
    ])

    const connectors_active = config.services.length

    return {
      api_calls_total,
      api_calls_today,
      developers_registered,
      connectors_active,
      updated_at: now.toISOString()
    }
  })
}
