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
  createdAt:    { type: Date, default: Date.now }
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
