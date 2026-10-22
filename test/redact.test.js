import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MARKER,
  PRIVATE_KEY_MARKER,
  isSecretPath,
  redactEnvLine,
  redactGrepValue,
  mentionsEnvFile,
  redactReadValue,
  redactToolResult,
  redactTokens,
} from '../lib/redact.js'
import { apply } from '../index.js'

/** A context that records listeners instead of mounting a Cordis runtime. */
function fakeContext() {
  const listeners = new Map()
  const scoped = {
    systemPrompt: {
      getSectionOrder: () => 1100,
      section: () => () => {},
    },
  }
  return {
    listeners,
    on(event, handler) {
      listeners.set(event, handler)
      return () => {}
    },
    inject(_deps, callback) {
      callback(scoped)
    },
  }
}

function readExec(filePath) {
  return { name: 'read', arguments: { file_path: filePath } }
}

function readResult(lines, path = '/app/.env') {
  return {
    isError: false,
    value: { path, offset: 1, lines, totalLines: lines.length },
  }
}

test('isSecretPath matches dotenv names only', async () => {
  for (const path of ['.env', 'app/.env', '/srv/app/.env.local', '.env.production', 'prod.env', 'A\\.ENV']) {
    assert.equal(isSecretPath(path), true, path)
  }
  for (const path of ['env', '.envrc', 'environment.ts', 'config.env.example.bak', 'README.md', '']) {
    assert.equal(isSecretPath(path), false, path)
  }
})

test('redactEnvLine keeps the key and replaces every value with the marker', async () => {
  assert.equal(redactEnvLine('API_KEY=sk-live-123'), `API_KEY=${MARKER}`)
  assert.equal(redactEnvLine('  export DB_URL="postgres://user:pw@host/db"'), `  DB_URL=${MARKER}`)
  assert.equal(redactEnvLine('EMPTY='), `EMPTY=${MARKER}`)
  assert.equal(redactEnvLine('KEY_WITH_DASH = value'), `KEY_WITH_DASH=${MARKER}`)
  assert.equal(redactEnvLine('# a comment that may hold a secret'), `# ${MARKER}`)
  assert.equal(redactEnvLine(''), '')
  assert.equal(redactEnvLine('   '), '')
  assert.equal(redactEnvLine('BARE_VALUE_WITHOUT_KEY'), `# ${MARKER}`)
})

test('redactTokens replaces only the key and keeps everything around it', async () => {
  assert.equal(
    redactTokens('const key = "sk-test-1234567890abcdef"; // keep me'),
    'const key = "sk-removed-by-plugin"; // keep me',
  )
  assert.equal(
    redactTokens('Authorization: Bearer sk-proj-abcdefghijklmnop'),
    'Authorization: Bearer sk-removed-by-plugin',
  )
  assert.equal(redactTokens('STRIPE=sk_live_0123456789abcdef'), 'STRIPE=sk_removed-by-plugin')
  assert.equal(redactTokens('OPENCODE_KEY=oc_sk_0123456789abcdef'), 'OPENCODE_KEY=oc_sk_removed-by-plugin')
  assert.equal(
    redactTokens('a sk-test-1234567890abcdef and sk-test-fedcba0987654321 b'),
    'a sk-removed-by-plugin and sk-removed-by-plugin b',
  )
})

test('redactTokens covers the provider prefixes, keeping each prefix', async () => {
  const cases = [
    ['ghp_0123456789abcdefghijABCDEFGHIJ012345', 'ghp_removed-by-plugin'],
    ['github_pat_0123456789abcdefghijABCDEFGHIJ', 'github_pat_removed-by-plugin'],
    ['glpat-0123456789abcdefghij', 'glpat-removed-by-plugin'],
    ['gsk_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG', 'gsk_removed-by-plugin'],
    ['xai-0123456789abcdefghijklmnopqrst', 'xai-removed-by-plugin'],
    ['pplx-0123456789abcdefghijABCDEFGHIJ0123456789abcdef', 'pplx-removed-by-plugin'],
    ['hf_0123456789abcdefghijklmnopqrstuvwx', 'hf_removed-by-plugin'],
    ['npm_0123456789abcdefghijklmnopqrstuvwx', 'npm_removed-by-plugin'],
    ['AKIAIOSFODNN7EXAMPLE', 'AKIAremoved-by-plugin'],
    ['ASIAIOSFODNN7EXAMPLE', 'ASIAremoved-by-plugin'],
  ]
  for (const [input, expected] of cases) assert.equal(redactTokens(input), expected, input)
  assert.equal(redactTokens('key=AKIAIOSFODNN7EXAMPLE;'), 'key=AKIAremoved-by-plugin;')
})

test('redactTokens leaves look-alike text alone', async () => {
  assert.equal(redactTokens('task-runner-1234567890'), 'task-runner-1234567890')
  assert.equal(redactTokens('disk-0123456789'), 'disk-0123456789')
  assert.equal(redactTokens('risk-0123456789'), 'risk-0123456789')
  assert.equal(redactTokens('sk-learn'), 'sk-learn')
  assert.equal(redactTokens('sk-'), 'sk-')
  assert.equal(redactTokens('XAKIAIOSFODNN7EXAMPLE'), 'XAKIAIOSFODNN7EXAMPLE')
  assert.equal(redactTokens('AKIAIOSFODNN7EXAMPL'), 'AKIAIOSFODNN7EXAMPL')
  assert.equal(redactTokens('AKIAIOSFODNN7EXAMPLEZ'), 'AKIAIOSFODNN7EXAMPLEZ')
  assert.equal(redactTokens('sk-removed-by-plugin'), 'sk-removed-by-plugin')
  assert.equal(redactTokens('sk_removed-by-plugin'), 'sk_removed-by-plugin')
  assert.equal(redactTokens('no keys here'), 'no keys here')
})

test('redactTokens is idempotent', async () => {
  const once = redactTokens('key: sk-test-1234567890abcdef ghp_0123456789abcdefghijABCDEFGHIJ012345')
  assert.equal(redactTokens(once), once)
})

test('redactReadValue preserves the read-window shape', async () => {
  const value = readResult([
    { number: 1, text: 'API_KEY=secret' },
    { number: 2, text: '# note' },
    { number: 3, text: 'DEBUG=true' },
  ]).value
  const redacted = redactReadValue(value, true)
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

test('redactReadValue removes keys from ordinary files', async () => {
  const value = readResult(
    [
      { number: 8, text: 'const key = "sk-test-1234567890abcdef" // keep' },
      { number: 9, text: 'const aws = "AKIAIOSFODNN7EXAMPLE"' },
      { number: 10, text: 'const other = 1' },
    ],
    '/app/src/config.ts',
  ).value
  assert.deepEqual(redactReadValue(value), {
    path: '/app/src/config.ts',
    offset: 1,
    lines: [
      { number: 8, text: 'const key = "sk-removed-by-plugin" // keep' },
      { number: 9, text: 'const aws = "AKIAremoved-by-plugin"' },
      { number: 10, text: 'const other = 1' },
    ],
    totalLines: 3,
  })
})

test('redactReadValue collapses a whole private-key block', async () => {
  const value = readResult(
    [
      { number: 1, text: 'before' },
      { number: 2, text: '-----BEGIN OPENSSH PRIVATE KEY-----' },
      { number: 3, text: 'b3BlbnNzaC1rZXktdjEAAAAA' },
      { number: 4, text: '-----END OPENSSH PRIVATE KEY-----' },
      { number: 5, text: 'after' },
    ],
    '/app/key.pem',
  ).value
  const redacted = redactReadValue(value)
  assert.deepEqual(
    redacted.lines.map((line) => line.text),
    ['before', PRIVATE_KEY_MARKER, PRIVATE_KEY_MARKER, PRIVATE_KEY_MARKER, 'after'],
  )
})

test('redactReadValue reports no change when there is nothing to redact', async () => {
  assert.equal(redactReadValue({ path: '/app/.env', offset: 1, lines: [], totalLines: 0 }, true), undefined)
  assert.equal(redactReadValue({ kind: 'other' }), undefined)
  assert.equal(
    redactReadValue(readResult([{ number: 1, text: 'const plain = 1' }], '/app/src/a.ts').value),
    undefined,
  )
})

test('redactGrepValue uses the right rule per file', async () => {
  const value = {
    matches: [
      { path: '.env', lineNumber: 1, line: 'TOKEN=sk-test-1234567890abcdef' },
      { path: 'src/config.ts', lineNumber: 9, line: 'const key = "sk-test-1234567890abcdef"' },
      { path: 'src/plain.ts', lineNumber: 2, line: 'const n = 1' },
    ],
  }
  const redacted = redactGrepValue(value)
  assert.deepEqual(redacted, {
    matches: [
      { path: '.env', lineNumber: 1, line: `TOKEN=${MARKER}` },
      { path: 'src/config.ts', lineNumber: 9, line: 'const key = "sk-removed-by-plugin"' },
      { path: 'src/plain.ts', lineNumber: 2, line: 'const n = 1' },
    ],
  })
  assert.equal(value.matches[0].line, 'TOKEN=sk-test-1234567890abcdef', 'the source value must not be mutated')
})

test('redactToolResult replaces the value of a dotenv read', async () => {
  const decision = await redactToolResult(
    readExec('/app/.env'),
    readResult([{ number: 1, text: 'API_KEY=secret' }]),
    { kind: 'accept' },
  )
  assert.equal(decision.kind, 'accept')
  assert.deepEqual(decision.value.lines, [{ number: 1, text: `API_KEY=${MARKER}` }])
  assert.equal('content' in decision, false, 'value and content cannot both be replaced')
})

test('redactToolResult replaces keys in an ordinary file read', async () => {
  const decision = await redactToolResult(
    readExec('/app/src/config.ts'),
    readResult([{ number: 3, text: 'key = "sk-test-1234567890abcdef"' }], '/app/src/config.ts'),
    { kind: 'accept' },
  )
  assert.deepEqual(decision.value.lines, [{ number: 3, text: 'key = "sk-removed-by-plugin"' }])
})

test('redactToolResult leaves unrelated calls alone', async () => {
  const keep = { kind: 'accept' }
  assert.equal(
    await redactToolResult(readExec('README.md'), readResult([{ number: 1, text: 'API_KEY=x' }]), keep),
    undefined,
  )
  assert.equal(
    await redactToolResult(readExec('/app/.env'), { isError: true, error: new Error('boom') }, keep),
    undefined,
  )
  assert.equal(
    await redactToolResult(readExec('/app/.env'), readResult([{ number: 1, text: 'API_KEY=x' }]), {
      kind: 'block',
      feedback: [],
    }),
    undefined,
  )
})

test('redactToolResult keeps additional contexts from the inner decision', async () => {
  const extra = [{ role: 'user', content: [] }]
  const decision = await redactToolResult(
    readExec('/app/.env'),
    readResult([{ number: 1, text: 'API_KEY=secret' }]),
    { kind: 'accept', additionalContexts: extra },
  )
  assert.equal(decision.additionalContexts, extra)
})

test('every other tool result is masked at the content level', async () => {
  const decision = await redactToolResult(
    { name: 'bash', arguments: { command: 'env' } },
    {
      isError: false,
      value: { stdout: 'OPENAI_API_KEY=sk-test-1234567890abcdef', stderr: '' },
      content: [{ type: 'text', text: 'OPENAI_API_KEY=sk-test-1234567890abcdef' }],
    },
    { kind: 'accept' },
  )
  assert.deepEqual(decision.content, [{ type: 'text', text: 'OPENAI_API_KEY=sk-removed-by-plugin' }])
  assert.equal('value' in decision, false, 'content replacement keeps the canonical value untouched')
})

test('content masking leaves non-text blocks alone', async () => {
  const image = { type: 'image', attachment: { attachmentId: 'x' } }
  const decision = await redactToolResult(
    { name: 'web_fetch', arguments: { url: 'https://example.com' } },
    {
      isError: false,
      value: {},
      content: [image, { type: 'text', text: 'ghp_0123456789abcdefghijABCDEFGHIJ012345' }],
    },
    { kind: 'accept' },
  )
  assert.equal(decision.content[0], image)
  assert.equal(decision.content[1].text, 'ghp_removed-by-plugin')
})

test('a PEM block inside a tool result collapses', async () => {
  const text = 'run\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----\ndone'
  const decision = await redactToolResult(
    { name: 'bash', arguments: { command: 'cat key' } },
    { isError: false, value: {}, content: [{ type: 'text', text }] },
    { kind: 'accept' },
  )
  assert.equal(decision.content[0].text, `run\n${PRIVATE_KEY_MARKER}\ndone`)
})

test('a tool call that names a dotenv file masks every value', async () => {
  const decision = await redactToolResult(
    { name: 'bash', arguments: { command: 'cat /srv/app/.env' } },
    {
      isError: false,
      value: { stdout: 'API_KEY=secret\n# note\nDEBUG=true\n' },
      content: [{ type: 'text', text: 'API_KEY=secret\n# note\nDEBUG=true\n' }],
    },
    { kind: 'accept' },
  )
  assert.equal(decision.content[0].text, `API_KEY=${MARKER}\n# ${MARKER}\nDEBUG=${MARKER}\n`)
})

test('process.env does not count as a dotenv reference', async () => {
  assert.equal(mentionsEnvFile({ command: 'node -e "console.log(process.env)"' }), false)
  assert.equal(mentionsEnvFile({ command: 'echo .envrc' }), false)
  assert.equal(mentionsEnvFile({ command: 'cat .env' }), true)
  assert.equal(mentionsEnvFile({ command: 'docker compose --env-file .env config' }), true)
  assert.equal(mentionsEnvFile({ command: 'cat config/prod.env' }), true)
  assert.equal(mentionsEnvFile({ nested: [{ content: 'source .env.local' }] }), true)

  const decision = await redactToolResult(
    { name: 'bash', arguments: { command: 'node -e "console.log(process.env)"' } },
    { isError: false, value: {}, content: [{ type: 'text', text: 'HOME=/home/user' }] },
    { kind: 'accept' },
  )
  assert.equal(decision, undefined)
})

test('a command that only mentions a dotenv path keeps unrelated output', async () => {
  const decision = await redactToolResult(
    { name: 'bash', arguments: { command: 'python3 edit.py README.md  # mentions cat .env' } },
    {
      isError: false,
      value: {},
      content: [{ type: 'text', text: 'tests 29\npass 29\nfail 0\n' }],
    },
    { kind: 'accept' },
  )
  assert.equal(decision, undefined)
})

test('a clean result is left untouched', async () => {
  const inner = { kind: 'accept', content: [{ type: 'text', text: 'ok' }] }
  assert.equal(
    await redactToolResult(
      { name: 'bash', arguments: {} },
      { isError: false, value: {}, content: [{ type: 'text', text: 'ok' }] },
      inner,
    ),
    undefined,
  )
})

test('the judge can clear a match it is confident is not a credential', async () => {
  const seen = []
  const decision = await redactToolResult(
    { name: 'read', arguments: { file_path: '/app/notes.md' } },
    readResult([{ number: 1, text: 'sha256=sk_HDVL0123456789abcdef' }], '/app/notes.md'),
    { kind: 'accept' },
    async (candidates) => {
      seen.push(...candidates)
      return [false]
    },
  )
  assert.equal(decision, undefined)
  assert.deepEqual(seen, [{ line: 'sha256=sk_HDVL0123456789abcdef', token: 'sk_HDVL0123456789abcdef' }])
})

test('the judge keeps a match it calls a credential', async () => {
  const decision = await redactToolResult(
    { name: 'read', arguments: { file_path: '/app/notes.md' } },
    readResult([{ number: 1, text: 'key=sk-0123456789abcdef' }], '/app/notes.md'),
    { kind: 'accept' },
    async () => [true],
  )
  assert.equal(decision.value.lines[0].text, 'key=sk-removed-by-plugin')
})

test('a throwing judge leaves every match masked', async () => {
  const decision = await redactToolResult(
    { name: 'bash', arguments: { command: 'cat x' } },
    { isError: false, value: {}, content: [{ type: 'text', text: 'X=sk-0123456789abcdef' }] },
    { kind: 'accept' },
    async () => {
      throw new Error('boom')
    },
  )
  assert.equal(decision.content[0].text, 'X=sk-removed-by-plugin')
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

  assert.equal(
    await handler(readExec('src/app.ts'), readResult([{ number: 1, text: 'const n = 1' }]), async () => inner),
    inner,
  )
})
