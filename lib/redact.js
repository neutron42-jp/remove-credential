/**
 * Pure redaction rules for the `remove-credential` Host plugin.
 *
 * The plugin never opens a `.env` file itself: the `read` and `grep` tools have
 * already produced a canonical value, and these functions turn that value into a
 * keys-only copy. Every value is replaced, so the model, the session log, and the
 * persisted presentation metadata never carry a secret.
 *
 * @module remove-credential/redact
 */

/** A dotenv assignment line: indentation, optional `export`, key, `=`, value. */
const ASSIGNMENT = /^(\s*)(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=/

/**
 * Text written where a value used to be. A visible marker is better than an
 * empty value: an empty `KEY=` reads as a real, blank assignment and invites the
 * model to "repair" it.
 */
export const MARKER = 'deleted by plugin: remove-credential'

/** Dotenv files the plugin redacts: `.env`, `.env.local`, `production.env`. */
const ENV_NAME = /^(?:\.env|\.env\..*|[^/\\]+\.env)$/i

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
 * Redact a `read` tool value while preserving its exact schema shape, so the
 * registry can re-render content and re-project metadata from it.
 * @param value - the canonical `read` value: `{ path, offset, lines, totalLines }`.
 * @returns a redacted copy, or undefined when the value is not a read window or
 *   changed nothing.
 */
export function redactReadValue(value) {
  if (!isRecord(value) || !Array.isArray(value.lines)) return undefined
  let changed = false
  const lines = value.lines.map((line) => {
    if (!isRecord(line) || typeof line.number !== 'number' || typeof line.text !== 'string') return line
    const text = redactEnvLine(line.text)
    if (text !== line.text) changed = true
    return { number: line.number, text }
  })
  return changed ? { ...value, lines } : undefined
}

/**
 * Redact the `.env` matches of a `grep` value, keeping the other files intact.
 * @param value - the canonical `grep` value: `{ matches: [{ path, lineNumber, line }] }`.
 * @returns a redacted copy, or undefined when nothing came from a dotenv file.
 */
export function redactGrepValue(value) {
  if (!isRecord(value) || !Array.isArray(value.matches)) return undefined
  let changed = false
  const matches = value.matches.map((match) => {
    if (!isRecord(match) || !isSecretPath(match.path)) return match
    const line = typeof match.line === 'string' ? redactEnvLine(match.line) : ''
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
    if (!isRecord(exec.arguments) || !isSecretPath(exec.arguments.file_path)) return undefined
    redacted = redactReadValue(value)
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
