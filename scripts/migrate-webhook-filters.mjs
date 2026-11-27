#!/usr/bin/env node
/**
 * Convert stored webhook filters to canonical enum codes (municipality INE,
 * district 01–18/RAA/RAM, DRE I/II, drop sns.regiao / ipma.area).
 *
 * Default is --dry-run (no writes). Idempotent: running twice is a no-op.
 *
 *   npm run migrate:webhook-filters
 *   npm run migrate:webhook-filters -- --apply
 *
 * Do not run --apply against production from a developer laptop.
 */

import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'
import { Webhook } from '../src/db.js'
import { SUPPORTED_EVENTS } from '../src/webhooks/catalog.js'
import { assertFilters } from '../src/webhooks/validate.js'

export function migrateFilters(filters) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    return { filters: {}, changed: false }
  }
  const events = Object.keys(filters).filter(name => SUPPORTED_EVENTS.includes(name))
  const next = assertFilters(
    Object.fromEntries(events.map(name => [name, filters[name]])),
    events,
    { dropUnknown: true }
  )
  return {
    filters: next,
    changed: JSON.stringify(next) !== JSON.stringify(filters)
  }
}

function parseArgs(argv) {
  return {
    dryRun: !argv.includes('--apply'),
    allowRemote: argv.includes('--allow-remote'),
    mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/apiaberta-gateway'
  }
}

function assertSafeUri(uri, { allowRemote }) {
  const parsed = new URL(uri)
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
  if (!local && !allowRemote) {
    throw new Error(`Refusing remote MongoDB host ${parsed.hostname}. Pass --allow-remote only for an approved ops run.`)
  }
}

export async function migrateWebhookDocuments({ dryRun = true, log = console } = {}) {
  const webhooks = await Webhook.find({}).lean()
  let scanned = 0
  let changed = 0
  const samples = []

  for (const doc of webhooks) {
    scanned++
    const result = migrateFilters(doc.filters)
    if (!result.changed) continue
    changed++
    samples.push({ id: String(doc._id), from: doc.filters, to: result.filters })
    if (!dryRun) {
      await Webhook.updateOne({ _id: doc._id }, { $set: { filters: result.filters, updatedAt: new Date() } })
    }
  }

  log.info?.({ scanned, changed, dryRun }, 'webhook filter migration')
  return { scanned, changed, dryRun, samples }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  assertSafeUri(opts.mongoUri, opts)
  await mongoose.connect(opts.mongoUri)
  try {
    const result = await migrateWebhookDocuments({ dryRun: opts.dryRun })
    console.log(JSON.stringify({
      dryRun: result.dryRun,
      scanned: result.scanned,
      changed: result.changed,
      samples: result.samples.slice(0, 20)
    }, null, 2))
    if (opts.dryRun) {
      console.log('Dry run only — re-run with --apply to write.')
    }
  } finally {
    await mongoose.disconnect()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
