import assert from 'node:assert/strict'
import test from 'node:test'
import { askDecision, buildPayload, pickEndpoint } from '../lib/systemone.js'

const ENDPOINTS = [
  { name: 'd1', url: 'http://127.0.0.1:8081/v1/systemone' },
  { name: 'jev', url: 'http://127.0.0.1:8788/v1/systemone' },
]

/** A fetch double that records calls and returns one canned response. */
function fakeFetch(body, init = {}) {
  const calls = []
  const impl = async (url, options) => {
    calls.push({ url, options })
    if (init.reject === true) throw Object.assign(new Error('boom'), { name: 'TypeError' })
    return {
      ok: init.status === undefined || init.status < 400,
      status: init.status ?? 200,
      json: async () => body,
      text: async () => init.bodyText ?? '',
    }
  }
  impl.calls = calls
  return impl
}

test('a yes/no question becomes a noul question', () => {
  assert.deepEqual(buildPayload({ situation: 'a', question: 'b' }), {
    state: 'a',
    questions: { q: { type: 'noul', instructions: 'b' } },
  })
})

test('options become a choice question with indexed criteria', () => {
  assert.deepEqual(buildPayload({ situation: 's', question: 'q', options: ['x', 'y'] }), {
    state: 's',
    questions: { q: { type: 'choice', instructions: 'q', criteria: { '0': 'x', '1': 'y' } } },
  })
})

test('pickEndpoint resolves by name only', () => {
  assert.equal(pickEndpoint(ENDPOINTS, 'jev').url, 'http://127.0.0.1:8788/v1/systemone')
  assert.equal(pickEndpoint(ENDPOINTS, 'nope'), undefined)
  assert.equal(pickEndpoint(undefined, 'd1'), undefined)
})

test('a noul answer is normalized and the request is correct', async () => {
  const fetchImpl = fakeFetch({ model: 'd1-3b', answers: { q: { noul: 0.87 } } })
  const result = await askDecision({
    endpoints: ENDPOINTS,
    endpointName: 'd1',
    fetchImpl,
    situation: '名前: さくら',
    question: 'スパムか',
  })
  assert.deepEqual(result, { endpoint: 'd1', model: 'd1-3b', kind: 'noul', probability: 0.87 })
  assert.equal(fetchImpl.calls[0].url, 'http://127.0.0.1:8081/v1/systemone')
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), {
    state: '名前: さくら',
    questions: { q: { type: 'noul', instructions: 'スパムか' } },
  })
})

test('a choice answer maps indices back to option text', async () => {
  const fetchImpl = fakeFetch({
    model: 'd1-3b',
    answers: { q: { choice: '1', probabilities: { '0': 0.2, '1': 0.62, '2': 0.18 }, confidence: 0.42 } },
  })
  const result = await askDecision({
    endpoints: ENDPOINTS,
    endpointName: 'd1',
    fetchImpl,
    situation: 's',
    question: 'which team?',
    options: ['access', 'billing', 'other'],
  })
  assert.deepEqual(result, {
    endpoint: 'd1',
    model: 'd1-3b',
    kind: 'choice',
    choice: 'billing',
    probabilities: [
      { option: 'access', probability: 0.2 },
      { option: 'billing', probability: 0.62 },
      { option: 'other', probability: 0.18 },
    ],
    confidence: 0.42,
  })
})

test('an unknown endpoint fails before any request', async () => {
  const fetchImpl = fakeFetch({})
  await assert.rejects(
    askDecision({ endpoints: ENDPOINTS, endpointName: 'nope', fetchImpl, situation: 's', question: 'q' }),
    /unknown decision endpoint "nope"/u,
  )
  assert.equal(fetchImpl.calls.length, 0)
})

test('an unreachable endpoint reports the name and url', async () => {
  await assert.rejects(
    askDecision({
      endpoints: ENDPOINTS,
      endpointName: 'd1',
      fetchImpl: fakeFetch(undefined, { reject: true }),
      situation: 's',
      question: 'q',
    }),
    /cannot reach decision endpoint "d1" at http:\/\/127\.0\.0\.1:8081/u,
  )
})

test('a non-ok response reports status and body', async () => {
  await assert.rejects(
    askDecision({
      endpoints: ENDPOINTS,
      endpointName: 'd1',
      fetchImpl: fakeFetch(undefined, { status: 422, bodyText: 'bad question' }),
      situation: 's',
      question: 'q',
    }),
    /returned 422: bad question/u,
  )
})

test('a missing answer is an error', async () => {
  await assert.rejects(
    askDecision({
      endpoints: ENDPOINTS,
      endpointName: 'd1',
      fetchImpl: fakeFetch({ answers: {} }),
      situation: 's',
      question: 'q',
    }),
    /returned no answer/u,
  )
})

test('an unrecognized answer shape is an error', async () => {
  await assert.rejects(
    askDecision({
      endpoints: ENDPOINTS,
      endpointName: 'd1',
      fetchImpl: fakeFetch({ answers: { q: { weird: 1 } } }),
      situation: 's',
      question: 'q',
    }),
    /unrecognized answer shape/u,
  )
})
