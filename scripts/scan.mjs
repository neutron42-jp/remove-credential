#!/usr/bin/env node
/**
 * False-positive audit: walk a directory, report which credential rules fire and
 * where. Only rule names, counts and paths are printed — never a matched value.
 *
 * Usage:
 *   node scripts/scan.mjs ~/dev
 *   node scripts/scan.mjs /path/to/node_modules 20000
 */
import { readFile, readdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { TOKEN_RULES } from '../lib/redact.js'

const root = process.argv[2]
const limit = Number(process.argv[3] ?? 20000)
const MAX_BYTES = 200_000
const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf',
  '.wasm', '.node', '.so', '.zip', '.tgz', '.gz', '.mp4', '.pdf', '.class', '.jar', '.exe', '.dll',
])

if (root === undefined) {
  console.error('usage: node scripts/scan.mjs <directory> [maxFiles]')
  process.exit(1)
}

const hits = new Map()
let scanned = 0

async function walk(dir) {
  if (scanned >= limit) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (scanned >= limit) return
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(path)
      continue
    }
    if (!entry.isFile()) continue
    if (basename(path).startsWith('.env') || path.endsWith('.pem') || path.endsWith('.key')) continue
    if (SKIP_EXT.has(extname(path))) continue
    let text
    try {
      const buffer = await readFile(path)
      if (buffer.length > MAX_BYTES) continue
      text = buffer.toString('utf8')
    } catch {
      continue
    }
    scanned += 1
    for (const rule of TOKEN_RULES) {
      const count = (text.match(new RegExp(rule.pattern.source, 'g')) ?? []).length
      if (count === 0) continue
      const entry = hits.get(rule.name) ?? { count: 0, files: [] }
      entry.count += count
      if (entry.files.length < 5) entry.files.push(path)
      hits.set(rule.name, entry)
    }
  }
}

const started = Date.now()
await walk(root)
console.log(`scanned ${scanned} files under ${root} in ${Date.now() - started} ms`)
if (hits.size === 0) console.log('no rule fired')
for (const [name, entry] of [...hits].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`${name}: ${entry.count} match(es)`)
  for (const file of entry.files) console.log(`  ${file}`)
}
