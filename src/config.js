export const config = {
  port: parseInt(process.env.PORT || '3000'),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/apiaberta-gateway',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',

  // Rate limits per tier (requests per minute)
  tiers: {
    free:  { rpm: 60,   rpd: 1000  },
    pro:   { rpm: 600,  rpd: 10000 },
    admin: { rpm: 6000, rpd: 100000 }
  },

  // Internal service registry
  // Each entry: { prefix, target }
  services: [
    {
      name:   'Fuel Prices (DGEG)',
      prefix: '/fuel',
      target: process.env.FUEL_SERVICE_URL || 'http://localhost:3001'
    },
    {
      prefix: '/contracts',
      target: process.env.CONTRACTS_SERVICE_URL || 'http://localhost:3002'
    },
    {
      prefix: '/statistics',
      target: process.env.STATISTICS_SERVICE_URL || 'http://localhost:3003'
    },
    {
      prefix: '/legislation',
      target: process.env.LEGISLATION_SERVICE_URL || 'http://localhost:3004'
    }
  ]
}
