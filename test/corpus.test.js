/**
 * Detection audit: every recognized family must be caught, and ordinary text
 * must survive untouched. All samples are invented; none is a real credential.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { PRIVATE_KEY_MARKER, redactText, redactTokens } from '../lib/redact.js'

/** [sample, expected marker] — the marker keeps the literal prefix. */
const POSITIVE = [
  ['sk-1234567890abcdef', 'sk-removed-by-plugin'],
  ['sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ', 'sk-removed-by-plugin'],
  ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTU', 'sk-removed-by-plugin'],
  ['sk_live_0123456789abcdef', 'sk_removed-by-plugin'],
  ['oc_sk_0123456789abcdef', 'oc_sk_removed-by-plugin'],
  ['sk-or-v1-0123456789abcdef0123456789abcdef', 'sk-removed-by-plugin'],
  ['ghp_0123456789abcdefghijABCDEFGHIJ012345', 'ghp_removed-by-plugin'],
  ['gho_0123456789abcdefghijABCDEFGHIJ012345', 'gho_removed-by-plugin'],
  ['ghu_0123456789abcdefghijABCDEFGHIJ012345', 'ghu_removed-by-plugin'],
  ['ghs_0123456789abcdefghijABCDEFGHIJ012345', 'ghs_removed-by-plugin'],
  ['ghr_0123456789abcdefghijABCDEFGHIJ012345', 'ghr_removed-by-plugin'],
  ['github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz', 'github_pat_removed-by-plugin'],
  ['glpat-0123456789abcdefghij', 'glpat-removed-by-plugin'],
  ['glrt-0123456789abcdefghij', 'glrt-removed-by-plugin'],
  ['gsk_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG', 'gsk_removed-by-plugin'],
  ['xai-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJ', 'xai-removed-by-plugin'],
  ['pplx-0123456789abcdefghijABCDEFGHIJ0123456789abcdef', 'pplx-removed-by-plugin'],
  ['hf_0123456789abcdefghijklmnopqrstuvwx', 'hf_removed-by-plugin'],
  ['npm_0123456789abcdefghijklmnopqrstuvwx', 'npm_removed-by-plugin'],
  ['AKIAIOSFODNN7EXAMPLE', 'AKIAremoved-by-plugin'],
  ['ASIAIOSFODNN7EXAMPLE', 'ASIAremoved-by-plugin'],
  ['AKIA0123456789ABCDEF', 'AKIAremoved-by-plugin'],
  ['ABIAIOSFODNN7EXAMPLE', 'ABIAremoved-by-plugin'],
  ['ACCAIOSFODNN7EXAMPLE', 'ACCAremoved-by-plugin'],
]

/** Text that must never change. */
const NEGATIVE = [
  'task-runner-1234567890',
  'sodium_crypto_sign_ed25519_sk_to_curve25519',
  'disk_total_space',
  'disk-0123456789',
  'risk-management-plan',
  'sk-learn',
  'sk-',
  'sk_',
  'sk-removed-by-plugin',
  'sk_removed-by-plugin',
  'ghp_removed-by-plugin',
  'ghp_short',
  'xai-model',
  'xai-1234567890',
  'pplx-short',
  'gsk_short',
  'hf_model',
  'npm_config_registry',
  'AKIA',
  'AKIAIOSFODNN7EXAMPL',
  'XAKIAIOSFODNN7EXAMPLE',
  'AKIAIOSFODNN7EXAMPLEZ',
  'myAKIAIOSFODNN7EXAMPLE',
  'const AKIA = 1',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  '9fceb02d0ae598e95dc970b74767f19372d61af8',
  'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'a3f5c9e1b7d24680fedcba9876543210',
  'https://example.com/api/v1/users?page=2',
  'BEGIN PRIVATE KEY',
  '-----BEGIN PUBLIC KEY-----',
  '差分は 3 行、token という単語はそのまま',
  '',
]

test('every recognized family is redacted with its prefix kept', () => {
  for (const [sample, expected] of POSITIVE) {
    assert.equal(redactTokens(sample), expected, sample)
  }
})

test('every private-key block form is recognized', () => {
  for (const header of [
    '-----BEGIN PRIVATE KEY-----',
    '-----BEGIN RSA PRIVATE KEY-----',
    '-----BEGIN EC PRIVATE KEY-----',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    '-----BEGIN ENCRYPTED PRIVATE KEY-----',
    '-----BEGIN PGP PRIVATE KEY BLOCK-----',
  ]) {
    assert.equal(redactText(header), PRIVATE_KEY_MARKER, header)
    assert.equal(redactText(header.replace('BEGIN', 'END')), PRIVATE_KEY_MARKER, header)
  }
  assert.equal(redactText('-----BEGIN PUBLIC KEY-----'), '-----BEGIN PUBLIC KEY-----')
  assert.equal(redactText('-----BEGIN CERTIFICATE-----'), '-----BEGIN CERTIFICATE-----')
})

test('ordinary text is never touched', () => {
  for (const sample of NEGATIVE) {
    assert.equal(redactTokens(sample), sample, sample)
  }
})

test('only the key is replaced; surroundings are byte-identical', () => {
  for (const [sample, marker] of POSITIVE) {
    const before = `pre("${sample}")`
    const after = `pre("${marker}")`
    assert.equal(redactTokens(before), after, sample)
  }
})

test('redaction is idempotent for every family', () => {
  for (const [sample] of POSITIVE) {
    const once = redactTokens(sample)
    assert.equal(redactTokens(once), once, sample)
  }
})

/** Deterministic PRNG so a failure is reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('fuzz: redaction never doubles a marker', () => {
  const rand = mulberry32(20261022)
  const parts = [
    'sk-', 'sk_', 'oc_sk_', 'ghp_', 'github_pat_', 'glpat-', 'gsk_', 'xai-', 'pplx-', 'hf_', 'npm_',
    'AKIA', 'ASIA', '0123456789', 'abcdefghij', 'ABCDEFGHIJ', '-', '_', '.', '/', 'task-runner',
    'AKIAIOSFODNN7EXAMPLE', 'sk-removed-by-plugin', 'const x = ', '"', ' ', '\n',
  ]
  const pick = () => parts[Math.floor(rand() * parts.length)]
  for (let i = 0; i < 4000; i += 1) {
    const text = Array.from({ length: 1 + Math.floor(rand() * 5) }, pick).join('')
    const once = redactTokens(text)
    assert.equal(once.includes('removed-by-pluginremoved-by-plugin'), false, `doubled marker: ${JSON.stringify(text)}`)
  }
})
