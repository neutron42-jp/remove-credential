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
export function apply(ctx, config) {
  const judgeConfig = config?.judge
  const judge = judgeConfig?.enabled === true ? createJudge(judgeConfig) : undefined

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    return (await redactToolResult(exec, result, decision, judge)) ?? decision
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
