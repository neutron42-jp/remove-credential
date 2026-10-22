/**
 * Client for the Jev System One HTTP interface (`POST /v1/systemone`).
 *
 * Both `openjev-serve` (Jev-compatible, FastAPI) and the d1 llama.cpp fork
 * (`server-decision.cpp`) implement the same request and response shape:
 *
 *   { "state": "...", "questions": { "q": { "type": "noul" | "choice", ... } } }
 *   { "model": "...", "answers": { "q": { "noul": 0.87 } },
 *     "usage": { "input_tokens": 0, "output_tokens": 0 } }
 *
 * @module dsh-decision/systemone
 */

/** The one question id this plugin sends. */
const QUESTION_ID = 'q'

/**
 * Build the request body for one question.
 * @param input.situation - all the context the model needs.
 * @param input.question - the decision to make.
 * @param input.options - candidate answers; omitted or empty means yes/no.
 * @returns the `/v1/systemone` request body.
 */
export function buildPayload({ situation, question, options }) {
  if (Array.isArray(options) && options.length > 0) {
    const criteria = {}
    options.forEach((text, index) => {
      criteria[String(index)] = text
    })
    return {
      state: situation,
      questions: { [QUESTION_ID]: { type: 'choice', instructions: question, criteria } },
    }
  }
  return {
    state: situation,
    questions: { [QUESTION_ID]: { type: 'noul', instructions: question } },
  }
}

/**
 * Resolve the configured endpoint by name.
 * @param endpoints - configured `{ name, url }` rows.
 * @param name - requested name.
 * @returns the endpoint, or undefined when it is not configured.
 */
export function pickEndpoint(endpoints, name) {
  const list = Array.isArray(endpoints) ? endpoints : []
  return list.find((endpoint) => endpoint?.name === name)
}

/**
 * Ask one question and normalize the endpoint's answer.
 * @param input.endpoints - configured endpoints.
 * @param input.endpointName - endpoint to use.
 * @param input.timeoutMs - request budget.
 * @param input.fetchImpl - injectable fetch for tests.
 * @param input.signal - caller cancellation.
 * @param input.situation - all the context the model needs.
 * @param input.question - the decision to make.
 * @param input.options - candidate answers; omitted means yes/no.
 * @returns the normalized answer.
 * @throws when the endpoint is unknown, unreachable, not ok, or answers nothing.
 */
export async function askDecision(input) {
  const {
    endpoints,
    endpointName,
    timeoutMs = 30_000,
    fetchImpl = fetch,
    signal,
    situation,
    question,
    options,
  } = input

  const target = pickEndpoint(endpoints, endpointName)
  if (target === undefined) {
    const names = (Array.isArray(endpoints) ? endpoints : []).map((endpoint) => endpoint?.name).filter(Boolean)
    throw new Error(
      `unknown decision endpoint "${endpointName ?? ''}"; configured: ${names.length > 0 ? names.join(', ') : 'none'}`,
    )
  }

  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])

  let response
  try {
    response = await fetchImpl(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildPayload({ situation, question, options })),
      signal: combined,
    })
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new Error(`decision endpoint "${target.name}" timed out after ${timeoutMs} ms`)
    }
    throw new Error(`cannot reach decision endpoint "${target.name}" at ${target.url}: ${error?.message ?? error}`)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `decision endpoint "${target.name}" returned ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
    )
  }

  const data = await response.json().catch(() => undefined)
  const answer = data?.answers?.[QUESTION_ID]
  if (answer === undefined || answer === null || typeof answer !== 'object') {
    throw new Error(`decision endpoint "${target.name}" returned no answer`)
  }
  return normalize(target, data, answer, options)
}

/**
 * Turn the endpoint's answer into the tool's canonical value.
 * @param target - the endpoint that answered.
 * @param data - the full response body.
 * @param answer - the answer for {@link QUESTION_ID}.
 * @param options - the candidate answers, when a choice was asked.
 * @returns the normalized answer.
 */
function normalize(target, data, answer, options) {
  const base = {
    endpoint: target.name,
    ...(typeof data?.model === 'string' ? { model: data.model } : {}),
  }

  if (typeof answer.noul === 'number') {
    return { ...base, kind: 'noul', probability: answer.noul }
  }

  if (typeof answer.choice === 'string' && Array.isArray(options) && options.length > 0) {
    const probabilities = options.map((text, index) => {
      const value = answer.probabilities?.[String(index)]
      return { option: text, probability: typeof value === 'number' ? value : 0 }
    })
    const chosen = Number(answer.choice)
    const choice = Number.isInteger(chosen) && options[chosen] !== undefined ? options[chosen] : answer.choice
    return {
      ...base,
      kind: 'choice',
      choice,
      probabilities,
      ...(typeof answer.confidence === 'number' ? { confidence: answer.confidence } : {}),
    }
  }

  throw new Error(`decision endpoint "${target.name}" returned an unrecognized answer shape`)
}
