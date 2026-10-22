/**
 * Ask a local Jev/d1 System One endpoint whether a regex match is really a
 * credential.
 *
 * The question is a four-way `choice`, which measured far better than a yes/no
 * `noul` on the same samples (19/20 vs 16/20): the model gets to put a hash or an
 * identifier in its own bucket instead of answering "no" to a fuzzy question.
 *
 * The verdict is deliberately asymmetric. A false "credential" costs one redacted
 * hash; a false "not a credential" leaks a key, so unmasking requires the model
 * to be confident on both counts:
 *
 *   P(credential) < 0.05  and  max(P(hash), P(identifier), P(other)) >= 0.8
 *
 * Anything else, including every network or protocol failure, keeps the token
 * masked.
 *
 * @module remove-credential/judge
 */

/** Instructions sent with every candidate. */
const INSTRUCTIONS = 'この行に含まれる文字列の種類はどれか'

/** Option keys are fixed; only the wording reaches the model. */
const CRITERIA = {
  0: '本物の資格情報（APIキー、パスワード、秘密鍵）',
  1: 'ハッシュ値やチェックサム',
  2: 'プログラムの識別子・変数名・関数名',
  3: 'ダミー・例示・URL・その他',
}

/** Confidence required before a match is left unmasked. */
const MAX_CREDENTIAL_PROBABILITY = 0.05
const MIN_OTHER_PROBABILITY = 0.8

/**
 * Build a judge bound to one endpoint.
 * @param config - `{ endpoint, timeoutMs }`.
 * @param fetchImpl - injectable fetch for tests.
 * @returns async `(candidates: { line, token }[]) => boolean[]`; true means mask.
 */
export function createJudge(config, fetchImpl = fetch) {
  const endpoint = config.endpoint
  const timeoutMs = config.timeoutMs ?? 3000

  return async function judge(candidates) {
    const results = await Promise.allSettled(
      candidates.map((candidate) => askOnce(endpoint, candidate, timeoutMs, fetchImpl)),
    )
    return results.map((result) => (result.status === 'fulfilled' ? result.value : true))
  }
}

/**
 * Ask about one candidate, returning whether it must stay masked.
 * @param endpoint - System One URL.
 * @param candidate - `{ line, token }`; the line supplies context.
 * @param timeoutMs - per-request budget.
 * @param fetchImpl - fetch implementation.
 * @returns true when the token should be masked.
 */
async function askOnce(endpoint, candidate, timeoutMs, fetchImpl) {
  const state = clip(candidate.line, candidate.token)
  if (state === undefined) return true

  let response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state, questions: { q: { type: 'choice', instructions: INSTRUCTIONS, criteria: CRITERIA } } }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return true
  }
  if (!response.ok) return true

  const data = await response.json().catch(() => undefined)
  const answer = data?.answers?.q
  const probabilities = answer?.probabilities
  if (probabilities === undefined || typeof probabilities !== 'object') return true

  const credential = number(probabilities['0'])
  const other = Math.max(number(probabilities['1']), number(probabilities['2']), number(probabilities['3']))
  if (credential < MAX_CREDENTIAL_PROBABILITY && other >= MIN_OTHER_PROBABILITY) return false
  return true
}

/**
 * Keep the state short and focused on the match: a whole minified line would
 * blow the model's context and hide the token.
 * @param line - the line containing the match.
 * @param token - the matched token.
 * @returns a clipped line, or undefined when the token cannot be located.
 */
function clip(line, token) {
  if (typeof line !== 'string') return undefined
  const at = line.indexOf(token)
  if (at === -1) return line.slice(0, 600)
  const start = Math.max(0, at - 300)
  const end = Math.min(line.length, at + token.length + 300)
  return line.slice(start, end)
}

/** Coerce a probability entry, defaulting to "unknown" (0). */
function number(value) {
  return typeof value === 'number' ? value : 0
}
