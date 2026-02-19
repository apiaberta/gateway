import mongoose from 'mongoose'
import { config } from './config.js'

export async function connectDB() {
  await mongoose.connect(config.mongoUri)
  console.log('Connected to MongoDB')
}

// Developer account
const developerSchema = new mongoose.Schema({
  email:     { type: String, required: true, unique: true, lowercase: true },
  name:      { type: String },
  apiKey:    { type: String, required: true, unique: true, index: true },
  tier:      { type: String, enum: ['free', 'pro', 'admin'], default: 'free' },
  active:    { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
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

export const Developer = mongoose.model('Developer', developerSchema)
export const UsageLog  = mongoose.model('UsageLog', usageSchema)
