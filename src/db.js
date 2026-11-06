import mongoose from 'mongoose'
import { config } from './config.js'

export async function connectDB() {
  await mongoose.connect(config.mongoUri)
  console.log('Connected to MongoDB')
}

// Developer account
const developerSchema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, lowercase: true },
  name:         { type: String },
  passwordHash: { type: String, required: true },
  apiKey:       { type: String, required: true, unique: true, index: true },
  tier:         { type: String, enum: ['free', 'pro', 'admin'], default: 'free' },
  active:       { type: Boolean, default: true },
  createdAt:    { type: Date, default: Date.now },
  deletionRequestedAt: { type: Date, default: null },
  deletionScheduledFor: { type: Date, default: null }
})

// Usage log
const usageSchema = new mongoose.Schema({
  apiKey:     { type: String, required: true, index: true },
  endpoint:   { type: String, required: true },
  method:     { type: String },
  statusCode: { type: Number },
  latencyMs:  { type: Number },
  ip:         { type: String },
  timestamp:  { type: Date, default: Date.now, index: true }
})

// Webhook subscription
const webhookSchema = new mongoose.Schema({
  developerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Developer', required: true },
  apiKey:      { type: String, required: true, index: true },
  url:         { type: String, required: true },
  events:      [{ type: String }],
  secret:      { type: String, required: true },
  active:      { type: Boolean, default: true },
  createdAt:   { type: Date, default: Date.now }
})

// Webhook delivery log
const webhookDeliverySchema = new mongoose.Schema({
  webhookId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Webhook', required: true, index: true },
  event:       { type: String, required: true },
  payload:     { type: mongoose.Schema.Types.Mixed },
  status:      { type: String, enum: ['pending', 'delivered', 'failed'], default: 'pending', index: true },
  attempts:    { type: Number, default: 0 },
  lastAttempt: { type: Date },
  nextRetry:   { type: Date, default: Date.now, index: true },
  responseCode: { type: Number },
  responseBody: { type: String },
  createdAt:   { type: Date, default: Date.now, index: true }
})

// Event state tracker (detects changes across polling cycles)
const eventStateSchema = new mongoose.Schema({
  key:       { type: String, required: true, unique: true },
  value:     { type: mongoose.Schema.Types.Mixed },
  updatedAt: { type: Date, default: Date.now }
})

export const Developer    = mongoose.model('Developer', developerSchema)
export const UsageLog     = mongoose.model('UsageLog', usageSchema)
export const Webhook      = mongoose.model('Webhook', webhookSchema)
export const WebhookDelivery = mongoose.model('WebhookDelivery', webhookDeliverySchema)
export const EventState   = mongoose.model('EventState', eventStateSchema)

// Password reset token
const passwordResetSchema = new mongoose.Schema({
  email:     { type: String, required: true, lowercase: true, index: true },
  token:     { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  used:      { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
})

// Auto-delete expired tokens after 1 hour
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const PasswordReset = mongoose.model('PasswordReset', passwordResetSchema)

// Failed login attempts (brute-force protection)
// Tracks IP + email for each failed attempt; auto-expires after 15 min
const failedLoginSchema = new mongoose.Schema({
  ip:        { type: String, required: true, index: true },
  email:     { type: String, required: true },
  createdAt: { type: Date, default: Date.now, index: true }
})
failedLoginSchema.index({ createdAt: 1 }, { expireAfterSeconds: 0 }) // TTL index: auto-delete after expiry

// Registration attempts (anti-spam)
// Tracks IP for each successful registration; auto-expires after 5 min
const registrationAttemptSchema = new mongoose.Schema({
  ip:        { type: String, required: true, index: true },
  email:     { type: String, required: true },
  createdAt: { type: Date, default: Date.now, index: true }
})
registrationAttemptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 0 }) // TTL index: auto-delete after 5 min

export const FailedLogin        = mongoose.model('FailedLogin', failedLoginSchema)
export const RegistrationAttempt = mongoose.model('RegistrationAttempt', registrationAttemptSchema)

// ─── Status history (uptime page) ─────────────────────────────────────────────
// Raw samples live 95 days; daily aggregates and incidents are kept indefinitely.

const STATUS_VALUES = ['up', 'degraded', 'down']

const statusCheckSchema = new mongoose.Schema({
  service:   { type: String, required: true, index: true },
  status:    { type: String, enum: STATUS_VALUES, required: true },
  latencyMs: { type: Number, required: true },
  timestamp: { type: Date, required: true }
}, { collection: 'status_checks' })

statusCheckSchema.index({ timestamp: 1 }, { expireAfterSeconds: 95 * 24 * 60 * 60 })
statusCheckSchema.index({ service: 1, timestamp: -1 })

const statusDailySchema = new mongoose.Schema({
  service:      { type: String, required: true },
  date:         { type: String, required: true }, // YYYY-MM-DD in Europe/Lisbon
  checks:       { type: Number, default: 0 },
  up:           { type: Number, default: 0 },
  degraded:     { type: Number, default: 0 },
  down:         { type: Number, default: 0 },
  avgLatencyMs: { type: Number, default: 0 }
}, { collection: 'status_daily' })

statusDailySchema.index({ service: 1, date: 1 }, { unique: true })
statusDailySchema.index({ date: 1 })

const statusIncidentSchema = new mongoose.Schema({
  service:    { type: String, required: true, index: true },
  status:     { type: String, enum: ['degraded', 'down'], required: true },
  startedAt:  { type: Date, required: true, index: true },
  resolvedAt: { type: Date, default: null, index: true }
}, { collection: 'status_incidents' })

statusIncidentSchema.index({ service: 1, resolvedAt: 1 })

const statusLockSchema = new mongoose.Schema({
  _id:         { type: String },
  owner:       { type: String, required: true },
  lockedUntil: { type: Date, required: true }
}, { collection: 'status_locks' })

export const StatusCheck    = mongoose.model('StatusCheck', statusCheckSchema)
export const StatusDaily    = mongoose.model('StatusDaily', statusDailySchema)
export const StatusIncident = mongoose.model('StatusIncident', statusIncidentSchema)
export const StatusLock     = mongoose.model('StatusLock', statusLockSchema)
