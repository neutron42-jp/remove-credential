/**
 * Host half of the `remove-credential` bundle.
 *
 * The plugin adds no service and opens no file. It listens to the
 * `tools/post-execute` waterfall, and when a settled `read` or `grep` call
 * touched a dotenv file it answers with a `value` replacement: key names only,
 * every value removed. Replacing the value (instead of only the rendered
 * content) makes the registry re-render the model-facing text and re-project the
 * persisted metadata from the redacted copy, so a programmatic caller cannot
 * retrieve the original either.
 *
 * @module remove-credential
 */
import { redactToolResult } from './lib/redact.js'

/** Placement used when the built-in `read` guidance is not registered. */
const FALLBACK_ORDER = 1101

/**
 * Prompt text that explains the redaction. Without it a model can mistake an
 * empty value for the file's real content and try to "repair" the file.
 */
const SECTION = {
  name: 'REMOVE_CREDENTIAL',
  text: `### Credential files

\`read\` and \`grep\` show dotenv files (\`.env\`, \`.env.*\`, \`*.env\`) with every value replaced by the marker \`deleted by plugin: remove-credential\`: an assignment appears as \`KEY=deleted by plugin: remove-credential\`, and comments or continuation lines appear as \`# deleted by plugin: remove-credential\`. The real values remain on disk. Do not guess or reconstruct them, and do not rewrite such a file to fill in what looks missing.`,
}

/**
 * Register the result transform and the prompt explanation.
 * @param ctx - the plugin context; the listener lives as long as the plugin.
 */
export function apply(ctx) {
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    return redactToolResult(exec, result, decision) ?? decision
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
