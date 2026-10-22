import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MARKER,
  isSecretPath,
  redactEnvLine,
  redactGrepValue,
  redactReadValue,
  redactToolResult,
} from '../lib/redact.js'
import { apply } from '../index.js'

/** A context that records listeners instead of mounting a Cordis runtime. */
function fakeContext() {
  const listeners = new Map()
  return {
    listeners,
    on(event, handler) {
      listeners.set(event, handler)
      return () => {}
    },
    inject() {},
  }
}

function readExec(filePath) {
  return { name: 'read', arguments: { file_path: filePath } }
}

function readResult(lines) {
  return {
    isError: false,
    value: { path: '/app/.env', offset: 1, lines, totalLines: lines.length },
  }
}

test('isSecretPath matches dotenv names only', () => {
  for (const path of ['.env', 'app/.env', '/srv/app/.env.local', '.env.production', 'prod.env', 'A\\.ENV']) {
    assert.equal(isSecretPath(path), true, path)
  }
  for (const path of ['env', '.envrc', 'environment.ts', 'config.env.example.bak', 'README.md', '']) {
    assert.equal(isSecretPath(path), false, path)
  }
})

test('redactEnvLine keeps the key and replaces every value with the marker', () => {
  assert.equal(redactEnvLine('API_KEY=sk-live-123'), `API_KEY=${MARKER}`)
  assert.equal(redactEnvLine('  export DB_URL="postgres://user:pw@host/db"'), `  DB_URL=${MARKER}`)
  assert.equal(redactEnvLine('EMPTY='), `EMPTY=${MARKER}`)
  assert.equal(redactEnvLine('KEY_WITH_DASH = value'), `KEY_WITH_DASH=${MARKER}`)
  assert.equal(redactEnvLine('# a comment that may hold a secret'), `# ${MARKER}`)
  assert.equal(redactEnvLine(''), '')
  assert.equal(redactEnvLine('   '), '')
  assert.equal(redactEnvLine('BARE_VALUE_WITHOUT_KEY'), `# ${MARKER}`)
})

test('redactReadValue preserves the read-window shape', () => {
  const value = readResult([
    { number: 1, text: 'API_KEY=secret' },
    { number: 2, text: '# note' },
    { number: 3, text: 'DEBUG=true' },
  ]).value
  const redacted = redactReadValue(value)
  assert.deepEqual(redacted, {
    path: '/app/.env',
    offset: 1,
    lines: [
      { number: 1, text: `API_KEY=${MARKER}` },
      { number: 2, text: `# ${MARKER}` },
      { number: 3, text: `DEBUG=${MARKER}` },
    ],
    totalLines: 3,
  })
  assert.equal(value.lines[0].text, 'API_KEY=secret', 'the source value must not be mutated')
})

test('redactReadValue reports no change when there is nothing to redact', () => {
  assert.equal(redactReadValue({ path: '/app/.env', offset: 1, lines: [], totalLines: 0 }), undefined)
  assert.equal(redactReadValue({ kind: 'other' }), undefined)
})

test('redactGrepValue redacts only dotenv matches', () => {
  const value = {
    matches: [
      { path: '.env', lineNumber: 1, line: 'TOKEN=abc' },
      { path: 'src/config.ts', lineNumber: 9, line: 'export const token = 1' },
      { path: 'deploy/.env.production', lineNumber: 2, line: 'TOKEN=xyz' },
    ],
  }
  const redacted = redactGrepValue(value)
  assert.deepEqual(redacted, {
    matches: [
      { path: '.env', lineNumber: 1, line: `TOKEN=${MARKER}` },
      { path: 'src/config.ts', lineNumber: 9, line: 'export const token = 1' },
      { path: 'deploy/.env.production', lineNumber: 2, line: `TOKEN=${MARKER}` },
    ],
  })
  assert.equal(value.matches[0].line, 'TOKEN=abc', 'the source value must not be mutated')
})

test('redactToolResult replaces the value of a dotenv read', () => {
  const decision = redactToolResult(
    readExec('/app/.env'),
    readResult([{ number: 1, text: 'API_KEY=secret' }]),
    { kind: 'accept' },
  )
  assert.equal(decision.kind, 'accept')
  assert.deepEqual(decision.value.lines, [{ number: 1, text: `API_KEY=${MARKER}` }])
  assert.equal('content' in decision, false, 'value and content cannot both be replaced')
})

test('redactToolResult leaves unrelated calls alone', () => {
  const keep = { kind: 'accept' }
  assert.equal(redactToolResult(readExec('README.md'), readResult([{ number: 1, text: 'API_KEY=x' }]), keep), undefined)
  assert.equal(
    redactToolResult(readExec('/app/.env'), { isError: true, error: new Error('boom') }, keep),
    undefined,
  )
  assert.equal(
    redactToolResult(readExec('/app/.env'), readResult([{ number: 1, text: 'API_KEY=x' }]), {
      kind: 'block',
      feedback: [],
    }),
    undefined,
  )
})

test('redactToolResult keeps additional contexts from the inner decision', () => {
  const extra = [{ role: 'user', content: [] }]
  const decision = redactToolResult(
    readExec('/app/.env'),
    readResult([{ number: 1, text: 'API_KEY=secret' }]),
    { kind: 'accept', additionalContexts: extra },
  )
  assert.equal(decision.additionalContexts, extra)
})

test('the plugin redacts through the tools/post-execute listener', async () => {
  const ctx = fakeContext()
  apply(ctx)
  const handler = ctx.listeners.get('tools/post-execute')
  assert.equal(typeof handler, 'function')

  const exec = readExec('/app/.env')
  const result = readResult([{ number: 1, text: 'DATABASE_URL=postgres://secret' }])
  const decision = await handler(exec, result, async () => ({ kind: 'accept' }))

  assert.deepEqual(decision.value.lines, [{ number: 1, text: `DATABASE_URL=${MARKER}` }])
})

test('the plugin passes unrelated results through unchanged', async () => {
  const ctx = fakeContext()
  apply(ctx)
  const handler = ctx.listeners.get('tools/post-execute')
  const inner = { kind: 'accept', content: [{ type: 'text', text: 'ok' }] }

  assert.equal(await handler(readExec('src/app.ts'), readResult([]), async () => inner), inner)
})
