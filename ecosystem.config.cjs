module.exports = {
  apps: [{
    name: 'apiaberta-gateway',
    script: 'src/index.js',
    cwd: '/data/apiaberta/gateway',
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 4000,
      MONGO_URI: 'mongodb://localhost:27017/apiaberta-gateway'
    }
  }]
}
