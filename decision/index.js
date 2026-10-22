/**
 * Host half of the `decision` bundle.
 *
 * Registers one model-facing tool that asks a local Jev-compatible System One
 * endpoint (`openjev-serve`, or the d1 llama.cpp fork) for a single typed
 * decision. Endpoints live in the plugin config, so the Settings screen owns
 * them; no service is provided and no network call happens until the model asks
 * a question.
 *
 * @module dsh-decision
 */
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { askDecision } from './lib/systemone.js'

export const name = 'decision'

export const inject = ['tools']

export const Config = z.object({
  endpoints: z
    .array(
      z.object({
        name: z.string().required(),
        url: z.string().required(),
      }),
    )
    .default([
      { name: 'd1', url: 'http://127.0.0.1:8081/v1/systemone' },
      { name: 'jev', url: 'http://127.0.0.1:8788/v1/systemone' },
    ]),
  defaultEndpoint: z.string().default('d1'),
  timeoutMs: z.natural().default(30_000),
})

/** Render one normalized answer as the model-facing result. */
function render(_args, value) {
  const head = `${value.endpoint}${value.model ? ` (${value.model})` : ''}`
  if (value.kind === 'noul') {
    return [{ type: 'text', text: `${head}\nP(yes) = ${Number(value.probability).toFixed(3)}` }]
  }
  const ranked = [...value.probabilities].sort((a, b) => b.probability - a.probability)
  const lines = ranked.map((entry) => `  ${entry.option}: ${Number(entry.probability).toFixed(3)}`)
  const confidence = value.confidence === undefined ? '' : ` (confidence ${Number(value.confidence).toFixed(2)})`
  return [{ type: 'text', text: `${head}\nchoice: ${value.choice}${confidence}\n${lines.join('\n')}` }]
}

/**
 * Register the decision tool.
 * @param ctx - the plugin context.
 * @param config - validated plugin config with the endpoint list.
 */
export function apply(ctx, config) {
  const endpoints = Array.isArray(config?.endpoints) ? config.endpoints : []
  const defaultEndpoint = config?.defaultEndpoint ?? endpoints[0]?.name
  const timeoutMs = config?.timeoutMs ?? 30_000

  ctx.tools.register(
    defineTool({
      name: 'decide',
      description:
        'Ask a local Jev/d1 decision model one typed question about a situation. Without options it answers P(yes); with options it answers the chosen option and every option probability. Use it for small routing, triage, or yes/no calls instead of asking a chat model.',
      parameters: {
        situation: {
          type: 'string',
          required: true,
          description: 'Everything the decision needs, one fact per line.',
        },
        question: { type: 'string', required: true, description: 'The decision to make.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Candidate answers. Omit for a yes/no question.',
        },
        endpoint: {
          type: 'string',
          description: `Configured endpoint name. Defaults to "${defaultEndpoint}".`,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            endpoint: { type: 'string', required: true },
            model: { type: 'string' },
            kind: { type: 'string', required: true, enum: ['noul', 'choice'] },
            probability: { type: 'number' },
            choice: { type: 'string' },
            confidence: { type: 'number' },
            probabilities: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  option: { type: 'string', required: true },
                  probability: { type: 'number', required: true },
                },
              },
            },
          },
        },
        render,
      },
      async execute(args, exec) {
        return askDecision({
          endpoints,
          endpointName: args.endpoint ?? defaultEndpoint,
          timeoutMs,
          signal: exec.signal,
          situation: args.situation,
          question: args.question,
          options: args.options,
        })
      },
    }),
  )
}
