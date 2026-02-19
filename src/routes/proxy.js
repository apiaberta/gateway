import httpProxy from '@fastify/http-proxy'
import { config } from '../config.js'

export async function proxyRoutes(app) {
  for (const service of config.services) {
    // Only register if the service URL is configured
    if (!service.target) continue

    await app.register(httpProxy, {
      upstream: service.target,
      prefix: service.prefix,
      rewritePrefix: service.prefix,
      // Forward developer info to downstream services
      preHandler: async (req) => {
        if (req.developer) {
          req.headers['x-developer-id']   = req.developer._id.toString()
          req.headers['x-developer-tier'] = req.developer.tier
          // Remove the API key before forwarding
          delete req.headers['x-api-key']
        }
      },
      // Update usage log with response status
      onResponse: async (req, reply, res) => {
        reply.send(res)
      }
    })

    app.log.info(`Proxy registered: /v1${service.prefix} -> ${service.target}`)
  }
}
