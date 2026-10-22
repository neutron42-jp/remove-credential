/**
 * Pure redaction rules for the `remove-credential` Host plugin.
 *
 * The plugin never opens a file itself: the `read` and `grep` tools have already
 * produced a canonical value, and these functions turn that value into a
 * value-free copy. Two rules apply:
 *
 * - a dotenv file loses every value, keeping only key names;
 * - every file loses `sk-`-shaped API keys wherever they appear.
 *
 * The model, the session log, and the persisted presentation metadata therefore
 * never carry a secret.
 *
 * @module remove-credential/redact
 */

/** A dotenv assignment line: indentation, optional `export`, key, `=`, value. */
const ASSIGNMENT = /^(\s*)(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=/

/**
 * Text written where a dotenv value used to be. A visible marker is better than
 * an empty value: an empty `KEY=` reads as a real, blank assignment and invites
 * the model to "repair" it.
 */
export const MARKER = 'deleted by plugin: remove-credential'

/** Replacement for an `sk-…` API key found in any file. */
export const TOKEN_MARKER = 'sk-removed-by-plugin'

/** Dotenv files the plugin redacts: `.env`, `.env.local`, `production.env`. */
const ENV_NAME = /^(?:\.env|\.env\..*|[^/\\]+\.env)$/i

/**
 * `sk-` API keys in arbitrary text.
 *
 * The match is deliberately bounded:
 *
 * - a word character immediately before `sk-` disqualifies it, so `task-runner`
 *   and ordinary prose never match;
 * - only characters a real key contains are consumed, so quotes, commas,
 *   parentheses, and the rest of the line survive untouched;
 * - at least ten characters must follow the prefix, so `sk-` alone, `sk-learn`,
 *   and other short words are left alone.
 *
 * Only the `sk-` family is recognized for now (OpenAI, Anthropic, DeepSeek,
 * OpenRouter, Stripe). Other providers use other prefixes; add a rule when one
 * is needed.
 */
const TOKEN_RULES = [
  { pattern: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{10,}/g, replacement: TOKEN_MARKER },
  { pattern: /(?<![A-Za-z0-9_-])sk_(?:live|test)_[A-Za-z0-9]{10,}/g, replacement: TOKEN_MARKER },
]

/**
 * Whether a path names a dotenv file. The check uses only the basename, so
 * relative and absolute paths behave the same and no filesystem access happens.
 * @param path - a model-supplied or tool-reported path.
 * @returns true when the basename is `.env`, `.env.<suffix>`, or `<name>.env`.
 */
export function isSecretPath(path) {
  if (typeof path !== 'string' || path.length === 0) return false
  const base = path.split(/[\\/]/).at(-1) ?? ''
  return ENV_NAME.test(base)
}

/**
 * Replace one dotenv line with a marked, value-free line. An assignment keeps its
 * indentation and key and gains the marker as its value (`API_KEY=deleted by
 * plugin: remove-credential`); comments, bare keys, and continuation lines of a
 * multi-line value become a comment carrying the same marker, because their text
 * is content too. Blank lines stay blank.
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
 * Replace `sk-` API keys in arbitrary text. Everything around a key — quotes,
 * commas, trailing comments, the rest of the line — is preserved. Safe to run
 * twice: the marker is itself `sk-`-shaped and maps to the same string.
 * @param text - any text the model is about to receive.
 * @returns the same text with recognized keys replaced.
 */
export function redactTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return text
  let result = text
  for (const { pattern, replacement } of TOKEN_RULES) result = result.replace(pattern, replacement)
  return result
}

/**
 * Redact a `read` tool value while preserving its exact schema shape, so the
 * registry can re-render content and re-project metadata from it.
 * @param value - the canonical `read` value: `{ path, offset, lines, totalLines }`.
 * @param secretPath - whether the file is a dotenv file, which loses every value.
 * @returns a redacted copy, or undefined when the value is not a read window or
 *   changed nothing.
 */
export function redactReadValue(value, secretPath = false) {
  if (!isRecord(value) || !Array.isArray(value.lines)) return undefined
  let changed = false
  const lines = value.lines.map((line) => {
    if (!isRecord(line) || typeof line.number !== 'number' || typeof line.text !== 'string') return line
    const text = secretPath ? redactEnvLine(line.text) : redactTokens(line.text)
    if (text !== line.text) changed = true
    return { number: line.number, text }
  })
  return changed ? { ...value, lines } : undefined
}

/**
 * Redact the matches of a `grep` value: dotenv files lose every value, other
 * files lose `sk-` keys.
 * @param value - the canonical `grep` value: `{ matches: [{ path, lineNumber, line }] }`.
 * @returns a redacted copy, or undefined when nothing needed redaction.
 */
export function redactGrepValue(value) {
  if (!isRecord(value) || !Array.isArray(value.matches)) return undefined
  let changed = false
  const matches = value.matches.map((match) => {
    if (!isRecord(match) || typeof match.path !== 'string') return match
    const source = typeof match.line === 'string' ? match.line : ''
    const line = isSecretPath(match.path) ? redactEnvLine(source) : redactTokens(source)
    if (line !== match.line) changed = true
    return { ...match, line }
  })
  return changed ? { matches } : undefined
}

/**
 * Decide the replacement for one settled tool call.
 *
 * Returning a decision that carries `value` (and never `content`) makes the
 * registry re-render the model-facing text and re-project the persisted
 * presentation metadata from the redacted value, which also keeps a cached
 * programmatic caller (PTC) from receiving the original secret.
 *
 * @param exec - the settled tool execution: name and parsed arguments.
 * @param result - the normalized dispatch result; errors pass through untouched.
 * @param decision - the decision returned by the inner post-execute listeners.
 * @returns an `accept` decision with the redacted value, or undefined to keep the
 *   original decision unchanged.
 */
export function redactToolResult(exec, result, decision) {
  if (decision.kind !== 'accept' || result.isError) return undefined
  const name = exec.name
  const value = result.value

  let redacted
  if (name === 'read') {
    const args = exec.arguments
    if (!isRecord(args) || typeof args.file_path !== 'string') return undefined
    redacted = redactReadValue(value, isSecretPath(args.file_path))
  } else if (name === 'grep') {
    redacted = redactGrepValue(value)
  } else {
    return undefined
  }
  if (redacted === undefined) return undefined

  const contexts = decision.additionalContexts
  return {
    kind: 'accept',
    value: redacted,
    ...(contexts === undefined ? {} : { additionalContexts: contexts }),
  }
}

/**
 * Narrow a JSON value to a plain object record.
 * @param value - any value crossing the tool boundary.
 * @returns true for a non-array, non-null object.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
