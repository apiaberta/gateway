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
      name:   'Weather (IPMA)',
      prefix: '/ipma',
      target: process.env.IPMA_SERVICE_URL || 'http://localhost:3002'
    },
    {
      name:   'Public Contracts (BASE)',
      prefix: '/base',
      target: process.env.BASE_SERVICE_URL || 'http://localhost:3003'
    },
    {
      name:   'EV Charging Prices',
      prefix: '/ev',
      target: process.env.EV_SERVICE_URL || 'http://localhost:3004'
    },
    {
      name:   'Portugal Statistics (INE/Eurostat)',
      prefix: '/ine',
      target: process.env.INE_SERVICE_URL || 'http://localhost:3005'
    },
    {
      name:   'Civil Protection (ANPC)',
      prefix: '/anpc',
      target: process.env.ANPC_SERVICE_URL || 'http://localhost:3006'
    },
    {
      name:   'Banco de Portugal (BdP)',
      prefix: '/bdp',
      target: process.env.BDP_SERVICE_URL || 'http://localhost:3007'
    },
    {
      name:   'Public Contracts alias (BASE)',
      prefix: '/contracts',
      target: process.env.BASE_SERVICE_URL || 'http://localhost:3003'
    },
    {
      name:   'Geographic Data (geoapi.pt)',
      prefix: '/geo',
      target: process.env.GEO_SERVICE_URL || 'http://localhost:3009'
    },
    {
      name:   'NIF Validator',
      prefix: '/nif',
      target: process.env.NIF_SERVICE_URL || 'http://localhost:3013'
    },
    {
      name:   'PRR / PT2030',
      prefix: '/prr',
      target: process.env.PRR_SERVICE_URL || 'http://localhost:3014'
    },
    {
      name:   'Portugal 2030',
      prefix: '/pt2030',
      target: process.env.PRR_SERVICE_URL || 'http://localhost:3014'
    },
    {
      name:   'DRE Legislation',
      prefix: '/dre',
      target: process.env.DRE_SERVICE_URL || 'http://localhost:3015'
    },
    {
      name:   'NASA FIRMS Fire Hotspots',
      prefix: '/nasafirms',
      target: process.env.NASAFIRMS_SERVICE_URL || 'http://localhost:3012'
    },
  ]
}
