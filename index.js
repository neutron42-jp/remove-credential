/**
 * Host half of the `remove-credential` bundle.
 *
 * The plugin adds no service and opens no file. It masks every tool result
 * before the model or the session log sees it:
 *
 * - `read` and `grep` are answered with a `value` replacement. Replacing the
 *   value (instead of only the rendered content) makes the registry re-render
 *   the model-facing text and re-project the persisted metadata from the redacted
 *   copy, so a programmatic caller cannot retrieve the original either.
 * - Every other tool (`bash`, `web_fetch`, MCP, subagents) has its text blocks
 *   rewritten in place, which is exactly what the model and the log receive.
 *
 * @module remove-credential
 */
import z from '@deepseek-ai/schemastery'
import { createJudge } from './lib/judge.js'
import { redactToolResult } from './lib/redact.js'

/**
 * Plugin config. The judge is off by default: regex-only behavior is
 * deterministic and needs no local server.
 */
export const Config = z.object({
  judge: z
    .object({
      enabled: z.boolean().default(false).volatile(),
      endpoint: z.string().default('http://127.0.0.1:8081/v1/systemone').volatile(),
      timeoutMs: z.natural().default(3000).volatile(),
    })
    .default({
      enabled: false,
      endpoint: 'http://127.0.0.1:8081/v1/systemone',
      timeoutMs: 3000,
    }),
})

/** Placement used when the built-in `read` guidance is not registered. */
const FALLBACK_ORDER = 1101

/**
 * Prompt text that explains the redaction. Without it a model can mistake an
 * empty value for the file's real content and try to "repair" the file.
 */
const SECTION = {
  name: 'REMOVE_CREDENTIAL',
  text: `### Credential redaction

Dotenv files (\`.env\`, \`.env.*\`, \`*.env\`) are shown with every value replaced by \`deleted by plugin: remove-credential\`. In every file, API keys (\`sk-…\`, \`ghp_…\`, \`AKIA…\`, \`hf_…\`) and PEM private-key blocks are replaced by a marker ending in \`removed-by-plugin\`. Every tool result is filtered this way before it reaches you. The real values remain on disk: do not guess or reconstruct them, and never pass a credential through a tool call.`,
}

/**
 * Register the result transform, the input guard, and the prompt explanation.
 * @param ctx - the plugin context; everything lives as long as the plugin.
 */
/** Default endpoint when the config leaves it unset. */
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:8081/v1/systemone'

/**
 * Read one config field. Loader exposes a `.volatile()` field as a live
 * reference with `get()`; a plain value is returned as-is so the same code works
 * for a config resolved without the settings layer.
 * @param judge - the `judge` section.
 * @param field - field name.
 * @param fallback - value used when the field is absent.
 * @returns the current value.
 */
function readField(judge, field, fallback) {
  const ref = judge?.[field]
  if (ref === undefined || ref === null) return fallback
  return typeof ref.get === 'function' ? ref.get() : ref
}

/**
 * Resolve the judge settings from the live config.
 * @param config - the plugin config; its `judge.enabled` may be a volatile reference.
 * @returns the judge settings, or undefined when the judge is off.
 */
export function resolveJudgeConfig(config) {
  const judge = config?.judge
  if (readField(judge, 'enabled', false) !== true) return undefined
  return {
    endpoint: readField(judge, 'endpoint', DEFAULT_ENDPOINT),
    timeoutMs: readField(judge, 'timeoutMs', 3000),
  }
}

export function apply(ctx, config) {
  // The judge fields are volatile, so Loader hands them over as live references:
  // a Settings save updates the reference instead of restarting the plugin.
  // Reading them per call keeps the saved values live.
  const currentJudge = () => {
    const judgeConfig = resolveJudgeConfig(config)
    return judgeConfig === undefined ? undefined : createJudge(judgeConfig)
  }

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    return (await redactToolResult(exec, result, decision, currentJudge())) ?? decision
  })

  // The prompt section is optional: a deployment without the system-prompt
  // service still gets the redaction and only misses the explanation.
  ctx.inject(['systemPrompt'], (scoped) => {
    const readOrder = scoped.systemPrompt.getSectionOrder('TOOL_READ')
    scoped.systemPrompt.section({
      ...SECTION,
      order: Number.isFinite(readOrder) ? readOrder + 1 : FALLBACK_ORDER,
    })
  })
}
