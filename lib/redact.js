/**
 * Pure redaction rules for the `remove-credential` Host plugin.
 *
 * The plugin never opens a file itself: the `read` and `grep` tools have already
 * produced a canonical value, and these functions turn that value into a
 * value-free copy. Three rules apply:
 *
 * - a dotenv file loses every value, keeping only key names;
 * - every file loses recognized API keys and private-key blocks;
 * - tool arguments carrying such a credential are refused by the guard in
 *   `index.js`, which reuses {@link findToken}.
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

/** Text written for every line of a PEM private-key block. */
export const PRIVATE_KEY_MARKER = 'private-key-removed-by-plugin'

/** Dotenv files the plugin redacts: `.env`, `.env.local`, `production.env`. */
const ENV_NAME = /^(?:\.env|\.env\..*|[^/\\]+\.env)$/i

/** `-----BEGIN … PRIVATE KEY-----`, any key type. */
const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/

/** `-----END … PRIVATE KEY-----`, any key type. */
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/

/**
 * Recognizable credentials, in matching order.
 *
 * Every pattern follows the same shape:
 *
 * - `(?<![A-Za-z0-9])` before the prefix, so `task-runner` and `XAKIA…` never
 *   match inside a longer word;
 * - group 1 is the literal prefix that survives in the marker;
 * - only characters the real format uses are consumed, so quotes, commas and the
 *   rest of the line are untouched;
 * - a fixed-length format ends with a trailing guard, so `AKIA` plus seventeen
 *   characters is not half-matched.
 *
 * `sk` covers OpenAI, Anthropic, DeepSeek, OpenRouter, Stripe, Moonshot and
 * OpenCode (`oc_sk_…` matches from `sk_` on). The rest are the widely used
 * families from gitleaks' catalog (MIT), narrowed to prefix-only detections so a
 * short mention of a service name never triggers a substitution.
 *
 * `probe` is a non-global copy: `RegExp.prototype.test` on a global pattern is
 * stateful and would skip matches.
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
].map((rule) => ({ ...rule, probe: new RegExp(rule.pattern.source) }))

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
 * Replace recognized credentials in arbitrary text. Everything around a key —
 * quotes, commas, trailing comments, the rest of the line — is preserved, and the
 * prefix survives (`ghp_…` becomes `ghp_removed-by-plugin`). Safe to run twice:
 * the replacement is excluded from matching.
 * @param text - any text the model is about to receive.
 * @returns the same text with recognized credentials replaced.
 */
export function redactTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return text
  let result = text
  for (const { pattern } of TOKEN_RULES) result = result.replace(pattern, '$1removed-by-plugin')
  return result
}

/**
 * Redact arbitrary text: a complete PEM block collapses to one marker, a stray
 * boundary line is replaced, and recognized keys become their markers.
 * @param text - any text that is about to enter the model's context.
 * @returns the redacted text.
 */
export function redactText(text) {
  if (typeof text !== 'string' || text.length === 0) return text
  const withoutBlock = text.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g,
    PRIVATE_KEY_MARKER,
  )
  const withoutHeader = withoutBlock.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g, PRIVATE_KEY_MARKER)
  const withoutFooter = withoutHeader.replace(/-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g, PRIVATE_KEY_MARKER)
  return redactTokens(withoutFooter)
}

/**
 * Names that point at a dotenv file inside a tool call: `.env`, `.env.local`,
 * `config/prod.env`. `process.env` deliberately does not match (the character
 * before the dot is part of a word).
 */
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
 * Whether a result body actually reads like a dotenv file. A command that merely
 * mentions `.env` (a README edit, a test run) must not have its unrelated output
 * wiped, so the content has to look the part.
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
 * Redact a whole result as dotenv content: every value is replaced, comments and
 * other lines collapse to the marker, exactly like a `read` of the file.
 * @param text - text that came from a dotenv file.
 * @returns the redacted text.
 */
function redactEnvContent(text) {
  return text.split('\n').map(redactEnvLine).join('\n')
}

/**
 * Redact one line of ordinary file content.
 * @param text - one line of file content.
 * @returns the redacted line.
 */
function redactLine(text) {
  return redactText(text)
}

/**
 * Redact a `read` tool value while preserving its exact schema shape, so the
 * registry can re-render content and re-project metadata from it.
 *
 * A PEM block that starts inside the window collapses to one marker per line; a
 * window that starts in the middle of a block cannot be recognized, which is why
 * `grep`-style partial reads of key material remain a known gap.
 *
 * @param value - the canonical `read` value: `{ path, offset, lines, totalLines }`.
 * @param secretPath - whether the file is a dotenv file, which loses every value.
 * @returns a redacted copy, or undefined when the value is not a read window or
 *   changed nothing.
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
      text = redactTokens(raw)
    }
    if (text !== raw) changed = true
    return { number: line.number, text }
  })
  return changed ? { ...value, lines } : undefined
}

/**
 * Redact the matches of a `grep` value: dotenv files lose every value, other
 * files lose recognized credentials.
 * @param value - the canonical `grep` value: `{ matches: [{ path, lineNumber, line }] }`.
 * @returns a redacted copy, or undefined when nothing needed redaction.
 */
export function redactGrepValue(value) {
  if (!isRecord(value) || !Array.isArray(value.matches)) return undefined
  let changed = false
  const matches = value.matches.map((match) => {
    if (!isRecord(match) || typeof match.path !== 'string') return match
    const source = typeof match.line === 'string' ? match.line : ''
    const line = isSecretPath(match.path) ? redactEnvLine(source) : redactLine(source)
    if (line !== match.line) changed = true
    return { ...match, line }
  })
  return changed ? { matches } : undefined
}

/**
 * Redact every text block of a tool result, leaving images and other blocks
 * untouched.
 * @param content - the result's content blocks.
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
 * Decide the replacement for one settled tool call.
 *
 * `read` and `grep` carry a structured value, so they are re-rendered from a
 * redacted value (which also cleans the persisted presentation metadata and any
 * programmatic caller). Every other tool — `bash`, `web_fetch`, MCP, subagents —
 * is masked at the content level, which is what the model and the session log
 * receive.
 *
 * @param exec - the settled tool execution: name and parsed arguments.
 * @param result - the normalized dispatch result; errors pass through untouched.
 * @param decision - the decision returned by the inner post-execute listeners.
 * @returns an `accept` decision with redacted content or value, or undefined to
 *   keep the original decision unchanged.
 */
export function redactToolResult(exec, result, decision) {
  if (decision.kind !== 'accept' || result.isError) return undefined

  let replacement
  if (exec.name === 'read') {
    const args = exec.arguments
    if (!isRecord(args) || typeof args.file_path !== 'string') return undefined
    const value = redactReadValue(result.value, isSecretPath(args.file_path))
    if (value !== undefined) replacement = { kind: 'accept', value }
  } else if (exec.name === 'grep') {
    const value = redactGrepValue(result.value)
    if (value !== undefined) replacement = { kind: 'accept', value }
  } else {
    const content = redactContent(result.content, mentionsEnvFile(exec.arguments))
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
