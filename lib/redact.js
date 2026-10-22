/**
 * Redaction rules for the `remove-credential` Host plugin.
 *
 * Two layers cooperate:
 *
 * - a prefix scanner finds credential-shaped tokens (`sk-…`, `ghp_…`, `AKIA…`,
 *   PEM blocks) and is the only thing that ever decides *what* to redact;
 * - an optional judge (a local Jev/d1 decision model, see `judge.js`) may veto a
 *   single match when it is confident the match is a hash or an identifier
 *   instead of a credential.
 *
 * The judge can never add a match, and every failure path keeps the scanner's
 * verdict, so a broken endpoint degrades to today's behavior rather than
 * leaking.
 *
 * @module remove-credential/redact
 */

/** A dotenv assignment line: indentation, optional `export`, key, `=`, value. */
const ASSIGNMENT = /^(\s*)(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=/

/** Text written where a dotenv value used to be. */
export const MARKER = 'deleted by plugin: remove-credential'

/** Text written for every line of a PEM private-key block. */
export const PRIVATE_KEY_MARKER = 'private-key-removed-by-plugin'

/** Dotenv files the plugin redacts: `.env`, `.env.local`, `production.env`. */
const ENV_NAME = /^(?:\.env|\.env\..*|[^/\\]+\.env)$/i

/** `-----BEGIN … PRIVATE KEY-----` (including the PGP `BLOCK` form). */
const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/

/** `-----END … PRIVATE KEY-----`. */
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/

/** Complete PEM block, used when redacting a free-form string. */
const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g

/**
 * Recognizable credentials, in matching order. Group 1 is the literal prefix
 * that survives in the marker. See the README for the boundary rules.
 */
export const TOKEN_RULES = [
  { name: 'OpenCode API key', pattern: /(?<![A-Za-z0-9_])(oc_sk_)[A-Za-z0-9_-]{10,}/g },
  { name: 'sk API key', pattern: /(?<![A-Za-z0-9_])(sk[_-])(?!removed-by-plugin)[A-Za-z0-9_-]{10,}/g },
  { name: 'GitHub token', pattern: /(?<![A-Za-z0-9])(gh[pousr]_)[A-Za-z0-9]{20,}/g },
  { name: 'GitHub fine-grained token', pattern: /(?<![A-Za-z0-9])(github_pat_)[A-Za-z0-9_]{20,}/g },
  { name: 'GitLab token', pattern: /(?<![A-Za-z0-9])(gl(?:pat|rt)-)[A-Za-z0-9_-]{20,}/g },
  { name: 'Groq API key', pattern: /(?<![A-Za-z0-9])(gsk_)[A-Za-z0-9]{40,}/g },
  { name: 'xAI API key', pattern: /(?<![A-Za-z0-9])(xai-)[A-Za-z0-9]{20,}/g },
  { name: 'Perplexity API key', pattern: /(?<![A-Za-z0-9])(pplx-)[A-Za-z0-9]{40,}/g },
  { name: 'Hugging Face token', pattern: /(?<![A-Za-z0-9])(hf_)[A-Za-z0-9]{30,}/g },
  { name: 'npm token', pattern: /(?<![A-Za-z0-9])(npm_)[a-z0-9]{30,}/g },
  { name: 'AWS access key', pattern: /(?<![A-Za-z0-9])(AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}(?![A-Za-z0-9])/g },
]

/**
 * Whether a path names a dotenv file.
 * @param path - a model-supplied or tool-reported path.
 * @returns true when the basename is `.env`, `.env.<suffix>`, or `<name>.env`.
 */
export function isSecretPath(path) {
  if (typeof path !== 'string' || path.length === 0) return false
  const base = path.split(/[\\/]/).at(-1) ?? ''
  return ENV_NAME.test(base)
}

/**
 * Replace one dotenv line with a marked, value-free line.
 * @param text - one raw `.env` line.
 * @returns the redacted line, never containing the original value.
 */
export function redactEnvLine(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return ''
  const match = ASSIGNMENT.exec(text)
  if (match === null) return `# ${MARKER}`
  return `${match[1]}${match[2]}=${MARKER}`
}

/**
 * Locate every credential token in a string.
 * @param text - any text.
 * @returns non-overlapping matches in source order.
 */
export function findMatches(text) {
  const found = []
  for (const rule of TOKEN_RULES) {
    for (const match of text.matchAll(new RegExp(rule.pattern.source, 'g'))) {
      found.push({
        start: match.index,
        end: match.index + match[0].length,
        token: match[0],
        prefix: match[1],
        name: rule.name,
      })
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept = []
  let lastEnd = -1
  for (const match of found) {
    if (match.start < lastEnd) continue
    kept.push(match)
    lastEnd = match.end
  }
  return kept
}

/**
 * Replace credential tokens, optionally skipping ones the judge cleared.
 * @param text - any text.
 * @param verdicts - one entry per {@link findMatches} result; `false` keeps the
 *   original token.
 * @returns the redacted text.
 */
export function redactTokens(text, verdicts) {
  if (typeof text !== 'string' || text.length === 0) return text
  const matches = findMatches(text)
  if (matches.length === 0) return text
  let out = ''
  let cursor = 0
  matches.forEach((match, index) => {
    if (verdicts !== undefined && verdicts[index] === false) return
    out += text.slice(cursor, match.start) + `${match.prefix}removed-by-plugin`
    cursor = match.end
  })
  return out + text.slice(cursor)
}

/**
 * Replace complete PEM blocks and stray boundary lines.
 * @param text - any text.
 * @returns the text with every key block collapsed to the marker.
 */
function stripPrivateKeyBlocks(text) {
  const withoutBlock = text.replace(PRIVATE_KEY_BLOCK, PRIVATE_KEY_MARKER)
  const withoutHeader = withoutBlock.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g, PRIVATE_KEY_MARKER)
  return withoutHeader.replace(/-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g, PRIVATE_KEY_MARKER)
}

/**
 * Return the line containing a character offset.
 * @param text - the source text.
 * @param index - an offset inside it.
 * @returns the surrounding line.
 */
function lineAt(text, index) {
  const start = text.lastIndexOf('\n', index - 1) + 1
  const end = text.indexOf('\n', index)
  return text.slice(start, end === -1 ? text.length : end)
}

/**
 * Redact arbitrary text synchronously (no judge).
 * @param text - any text.
 * @param verdicts - optional per-match verdicts, see {@link redactTokens}.
 * @returns the redacted text.
 */
export function redactText(text, verdicts) {
  if (typeof text !== 'string' || text.length === 0) return text
  return redactTokens(stripPrivateKeyBlocks(text), verdicts)
}

/**
 * Redact arbitrary text, asking the judge about every token first.
 * @param text - any text.
 * @param judge - async `(candidates) => boolean[]`; true means mask.
 * @returns the redacted text.
 */
export async function redactTextAsync(text, judge) {
  if (typeof text !== 'string' || text.length === 0) return text
  const stripped = stripPrivateKeyBlocks(text)
  const matches = findMatches(stripped)
  if (matches.length === 0) return stripped
  let verdicts
  try {
    verdicts = await judge(matches.map((match) => ({ line: lineAt(stripped, match.start), token: match.token })))
  } catch {
    verdicts = undefined
  }
  return redactTokens(stripped, verdicts)
}

/** Names that point at a dotenv file inside a tool call. */
const ENV_MENTION = /(?:^|[^\w.-])\.env(?:\.[\w-]+)?(?![\w-])|[/\\][\w.-]+\.env(?:\.[\w-]+)?(?![\w-])/

/**
 * Whether any string argument of a tool call names a dotenv file.
 * @param value - parsed tool arguments.
 * @param depth - recursion bound.
 * @returns true when the call reads or writes a dotenv path.
 */
export function mentionsEnvFile(value, depth = 0) {
  if (depth > 8) return false
  if (typeof value === 'string') return ENV_MENTION.test(value)
  if (Array.isArray(value)) return value.some((item) => mentionsEnvFile(item, depth + 1))
  if (isRecord(value)) return Object.values(value).some((item) => mentionsEnvFile(item, depth + 1))
  return false
}

/**
 * Whether a result body actually reads like a dotenv file.
 * @param text - one result block.
 * @returns true when at least one assignment exists and assignments are the
 *   majority of non-empty lines.
 */
function looksLikeEnvContent(text) {
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length === 0) return false
  const assignments = lines.filter((line) => ASSIGNMENT.test(line)).length
  return assignments > 0 && assignments / lines.length >= 0.5
}

/**
 * Redact a whole result as dotenv content.
 * @param text - text that came from a dotenv file.
 * @returns the redacted text.
 */
function redactEnvContent(text) {
  return text.split('\n').map(redactEnvLine).join('\n')
}

/**
 * Redact a `read` value synchronously.
 * @param value - the canonical `read` value.
 * @param secretPath - whether the file is a dotenv file.
 * @returns a redacted copy, or undefined when nothing changed.
 */
export function redactReadValue(value, secretPath = false) {
  if (!isRecord(value) || !Array.isArray(value.lines)) return undefined
  let changed = false
  let inBlock = false
  const lines = value.lines.map((line) => {
    if (!isRecord(line) || typeof line.number !== 'number' || typeof line.text !== 'string') return line
    const raw = line.text
    let text
    if (secretPath) {
      text = redactEnvLine(raw)
    } else if (inBlock) {
      text = PRIVATE_KEY_MARKER
      if (PRIVATE_KEY_END.test(raw)) inBlock = false
    } else if (PRIVATE_KEY_BEGIN.test(raw)) {
      text = PRIVATE_KEY_MARKER
      inBlock = true
    } else {
      text = redactText(raw)
    }
    if (text !== raw) changed = true
    return { number: line.number, text }
  })
  return changed ? { ...value, lines } : undefined
}

/**
 * Redact a `read` value, asking the judge about every token.
 * @param value - the canonical `read` value.
 * @param secretPath - whether the file is a dotenv file.
 * @param judge - async `(candidates) => boolean[]`; true means mask.
 * @returns a redacted copy, or undefined when nothing changed.
 */
export async function redactReadValueAsync(value, secretPath, judge) {
  if (!isRecord(value) || !Array.isArray(value.lines)) return undefined
  let changed = false
  let inBlock = false
  const lines = []
  for (const line of value.lines) {
    if (!isRecord(line) || typeof line.number !== 'number' || typeof line.text !== 'string') {
      lines.push(line)
      continue
    }
    const raw = line.text
    let text
    if (secretPath) {
      text = redactEnvLine(raw)
    } else if (inBlock) {
      text = PRIVATE_KEY_MARKER
      if (PRIVATE_KEY_END.test(raw)) inBlock = false
    } else if (PRIVATE_KEY_BEGIN.test(raw)) {
      text = PRIVATE_KEY_MARKER
      inBlock = true
    } else {
      text = await redactTextAsync(raw, judge)
    }
    if (text !== raw) changed = true
    lines.push({ number: line.number, text })
  }
  return changed ? { ...value, lines } : undefined
}

/**
 * Redact the matches of a `grep` value synchronously.
 * @param value - the canonical `grep` value.
 * @returns a redacted copy, or undefined when nothing changed.
 */
export function redactGrepValue(value) {
  if (!isRecord(value) || !Array.isArray(value.matches)) return undefined
  let changed = false
  const matches = value.matches.map((match) => {
    if (!isRecord(match) || typeof match.path !== 'string') return match
    const source = typeof match.line === 'string' ? match.line : ''
    const line = isSecretPath(match.path) ? redactEnvLine(source) : redactText(source)
    if (line !== match.line) changed = true
    return { ...match, line }
  })
  return changed ? { matches } : undefined
}

/**
 * Redact the matches of a `grep` value, asking the judge about every token.
 * @param value - the canonical `grep` value.
 * @param judge - async `(candidates) => boolean[]`; true means mask.
 * @returns a redacted copy, or undefined when nothing changed.
 */
export async function redactGrepValueAsync(value, judge) {
  if (!isRecord(value) || !Array.isArray(value.matches)) return undefined
  let changed = false
  const matches = []
  for (const match of value.matches) {
    if (!isRecord(match) || typeof match.path !== 'string') {
      matches.push(match)
      continue
    }
    const source = typeof match.line === 'string' ? match.line : ''
    const line = isSecretPath(match.path) ? redactEnvLine(source) : await redactTextAsync(source, judge)
    if (line !== match.line) changed = true
    matches.push({ ...match, line })
  }
  return changed ? { matches } : undefined
}

/**
 * Redact every text block of a tool result synchronously.
 * @param content - the result's content blocks.
 * @param envMode - whether the call names a dotenv file.
 * @returns replacement blocks, or undefined when nothing changed.
 */
function redactContent(content, envMode) {
  if (!Array.isArray(content)) return undefined
  let changed = false
  const blocks = content.map((block) => {
    if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') return block
    const text = envMode && looksLikeEnvContent(block.text) ? redactEnvContent(block.text) : redactText(block.text)
    if (text === block.text) return block
    changed = true
    return { ...block, text }
  })
  return changed ? blocks : undefined
}

/**
 * Redact every text block of a tool result, asking the judge about every token.
 * @param content - the result's content blocks.
 * @param envMode - whether the call names a dotenv file.
 * @param judge - async `(candidates) => boolean[]`; true means mask.
 * @returns replacement blocks, or undefined when nothing changed.
 */
async function redactContentAsync(content, envMode, judge) {
  if (!Array.isArray(content)) return undefined
  let changed = false
  const blocks = []
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') {
      blocks.push(block)
      continue
    }
    const text =
      envMode && looksLikeEnvContent(block.text)
        ? redactEnvContent(block.text)
        : await redactTextAsync(block.text, judge)
    if (text !== block.text) changed = true
    blocks.push({ ...block, text })
  }
  return changed ? blocks : undefined
}

/**
 * Decide the replacement for one settled tool call.
 *
 * @param exec - the settled tool execution.
 * @param result - the normalized dispatch result; errors pass through untouched.
 * @param decision - the decision returned by the inner post-execute listeners.
 * @param judge - optional async `(candidates) => boolean[]`; true means mask.
 * @returns an `accept` decision with redacted content or value, or undefined.
 */
export async function redactToolResult(exec, result, decision, judge) {
  if (decision.kind !== 'accept' || result.isError) return undefined

  let replacement
  if (exec.name === 'read') {
    const args = exec.arguments
    if (!isRecord(args) || typeof args.file_path !== 'string') return undefined
    const secret = isSecretPath(args.file_path)
    const value =
      judge === undefined ? redactReadValue(result.value, secret) : await redactReadValueAsync(result.value, secret, judge)
    if (value !== undefined) replacement = { kind: 'accept', value }
  } else if (exec.name === 'grep') {
    const value = judge === undefined ? redactGrepValue(result.value) : await redactGrepValueAsync(result.value, judge)
    if (value !== undefined) replacement = { kind: 'accept', value }
  } else {
    const envMode = mentionsEnvFile(exec.arguments)
    const content =
      judge === undefined ? redactContent(result.content, envMode) : await redactContentAsync(result.content, envMode, judge)
    if (content !== undefined) replacement = { kind: 'accept', content }
  }
  if (replacement === undefined) return undefined

  const contexts = decision.additionalContexts
  return contexts === undefined ? replacement : { ...replacement, additionalContexts: contexts }
}

/**
 * Narrow a JSON value to a plain object record.
 * @param value - any value crossing the tool boundary.
 * @returns true for a non-array, non-null object.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
