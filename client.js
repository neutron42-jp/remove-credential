/**
 * Browser half of `remove-credential`: the configuration page on the plugin's
 * row in the Plugins page.
 *
 * The Judge fields are declared `.volatile()` on the Host, so the settings form
 * exists and the page renders it through the `form` prop the row page supplies:
 * `{ state, mutate }` over the entry's config snapshot.
 */
window.__ModuleLoader__.load({
  id: 'remove-credential',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const row = { padding: '12px 0', display: 'flex', flexDirection: 'column', gap: 8 }
    const label = { fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }
    const hint = { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', margin: 0 }
    const input = {
      height: 34,
      borderRadius: 'var(--dsw-radius-md)',
      border: '.5px solid var(--dsw-alias-border-l4)',
      background: 'var(--dsw-alias-bg-layer-3)',
      color: 'var(--dsw-alias-label-primary)',
      padding: '0 10px',
      font: 'inherit',
      fontSize: 13,
    }
    const button = {
      height: 32,
      padding: '0 14px',
      borderRadius: 'var(--dsw-radius-md)',
      border: 'none',
      background: 'var(--dsw-alias-brand-primary)',
      color: 'var(--dsw-alias-label-primary-foreground)',
      font: 'inherit',
      fontSize: 13,
      cursor: 'pointer',
    }

    function ConfigPage(props) {
      const { form, view } = props
      if (view === 'summary') return null
      if (form === undefined) {
        return h('p', { style: hint }, 'Settings are not available for this entry yet.')
      }

      const value = form.state.value ?? {}
      const judge = value.judge ?? {}
      const [enabled, setEnabled] = React.useState(judge.enabled === true)
      const [endpoint, setEndpoint] = React.useState(judge.endpoint ?? 'http://127.0.0.1:8081/v1/systemone')
      const [timeoutMs, setTimeoutMs] = React.useState(String(judge.timeoutMs ?? 3000))
      const [status, setStatus] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      const save = async () => {
        setBusy(true)
        setStatus('')
        try {
          const ok = await form.mutate(
            [
              { op: 'set', path: ['judge', 'enabled'], value: enabled },
              { op: 'set', path: ['judge', 'endpoint'], value: endpoint.trim() },
              { op: 'set', path: ['judge', 'timeoutMs'], value: Math.max(0, Number(timeoutMs) || 0) },
            ],
            form.state.revision,
          )
          setStatus(ok ? 'Saved.' : 'The Host refused the change.')
        } catch (error) {
          setStatus(String(error?.message ?? error))
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', { style: row },
          h('label', { style: { ...label, display: 'flex', alignItems: 'center', gap: 10 } },
            h('input', {
              type: 'checkbox',
              checked: enabled,
              disabled: busy,
              onChange: (event) => setEnabled(event.target.checked),
            }),
            'Ask a local decision model before keeping a match masked',
          ),
          h('p', { style: hint },
            'Regex finds the candidates. The model may only clear a match it is confident is a hash or an identifier; every failure keeps it masked.',
          ),
        ),
        h('div', { style: row },
          h('label', { style: label, htmlFor: 'remove-credential-endpoint' }, 'System One endpoint'),
          h('input', {
            id: 'remove-credential-endpoint',
            type: 'text',
            style: input,
            value: endpoint,
            disabled: busy,
            onChange: (event) => setEndpoint(event.target.value),
          }),
        ),
        h('div', { style: row },
          h('label', { style: label, htmlFor: 'remove-credential-timeout' }, 'Timeout per candidate (ms)'),
          h('input', {
            id: 'remove-credential-timeout',
            type: 'number',
            style: { ...input, width: 160 },
            value: timeoutMs,
            disabled: busy,
            onChange: (event) => setTimeoutMs(event.target.value),
          }),
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, paddingTop: 8 } },
          h('button', { type: 'button', style: button, disabled: busy, onClick: save }, busy ? 'Saving…' : 'Save'),
          status === '' ? null : h('span', { style: hint }, status),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register(
            {
              name: 'plugins.row.config',
              key: 'remove-credential#remove-credential',
              id: 'remove-credential-config',
              label: () => 'Remove Credential',
            },
            ConfigPage,
          ),
        )
      },
    }
  },
})
