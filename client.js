/**
 * Browser half of `remove-credential`: the configuration page on the plugin's
 * row in the Plugins page.
 *
 * The Judge fields are declared `.volatile()` on the Host, so the settings form
 * exists and the row page supplies it as `form` = `{ state, mutate }` over the
 * entry's config snapshot.
 *
 * The mode is a two-choice control ("Regex only" / "Regex + decision model")
 * because the switch it drives is a choice of detector, not an extra feature.
 */
window.__ModuleLoader__.load({
  id: 'remove-credential',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Copy for the two supported locales; the Host dictionary is not involved. */
    const TEXT = {
      en: {
        mode: 'Detection',
        regex: 'Regex only',
        judge: 'Regex + decision model',
        modeHint:
          'Regex always finds the candidates. With the decision model on, a match may be left unmasked only when the model is confident it is a hash or an identifier. Every failure keeps it masked.',
        endpoint: 'System One endpoint',
        endpointHint: 'd1 or Jev: http://host:port/v1/systemone',
        timeout: 'Timeout per candidate (ms)',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved.',
        refused: 'The Host refused the change.',
        unavailable: 'Settings are not available for this entry yet.',
      },
      ja: {
        mode: '検出方法',
        regex: '正規表現のみ',
        judge: '正規表現＋判定モデル',
        modeHint:
          '候補は常に正規表現が見つけます。判定モデルをオンにすると、ハッシュや識別子だと確信できた一致だけ伏せ字を解除します。失敗時は必ず伏せたままです。',
        endpoint: 'System One エンドポイント',
        endpointHint: 'd1 または Jev: http://host:port/v1/systemone',
        timeout: '1 候補あたりのタイムアウト（ms）',
        save: '保存',
        saving: '保存中…',
        saved: '保存しました。',
        refused: 'Host が変更を拒否しました。',
        unavailable: 'この項目の設定はまだ利用できません。',
      },
    }

    const style = {
      card: { display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 4 },
      block: { display: 'flex', flexDirection: 'column', gap: 8 },
      label: { fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
      hint: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', margin: 0 },
      group: {
        display: 'inline-flex',
        alignSelf: 'flex-start',
        padding: 2,
        gap: 2,
        borderRadius: 'var(--dsw-radius-lg)',
        background: 'var(--dsw-alias-bg-layer-3)',
        border: '.5px solid var(--dsw-alias-border-l4)',
      },
      segment: {
        height: 30,
        padding: '0 14px',
        border: 'none',
        borderRadius: 'var(--dsw-radius-md)',
        font: 'inherit',
        fontSize: 13,
        cursor: 'pointer',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
      },
      segmentActive: {
        background: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-label-primary-foreground)',
        fontWeight: 500,
      },
      input: {
        height: 34,
        maxWidth: 420,
        borderRadius: 'var(--dsw-radius-md)',
        border: '.5px solid var(--dsw-alias-border-l4)',
        background: 'var(--dsw-alias-bg-layer-3)',
        color: 'var(--dsw-alias-label-primary)',
        padding: '0 10px',
        font: 'inherit',
        fontSize: 13,
      },
      footer: { display: 'flex', alignItems: 'center', gap: 12 },
      save: {
        height: 32,
        padding: '0 14px',
        borderRadius: 'var(--dsw-radius-md)',
        border: 'none',
        background: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-label-primary-foreground)',
        font: 'inherit',
        fontSize: 13,
        cursor: 'pointer',
      },
    }

    /** Pick the copy for the active locale. */
    function copyFor(ctx) {
      let locale = 'en'
      try {
        locale = ctx.locale.getSnapshot().active
      } catch {
        // A deployment without the locale service falls back to English.
      }
      return TEXT[locale] ?? TEXT.en
    }

    /** Two-choice control; each button carries its own `aria-checked` state. */
    function ModeControl({ t, judge, disabled, onChange }) {
      const options = [
        { value: false, label: t.regex },
        { value: true, label: t.judge },
      ]
      return h(
        'div',
        { role: 'radiogroup', 'aria-label': t.mode, style: style.group },
        options.map((option) =>
          h(
            'button',
            {
              key: String(option.value),
              type: 'button',
              role: 'radio',
              'aria-checked': judge === option.value,
              disabled,
              style: judge === option.value ? { ...style.segment, ...style.segmentActive } : style.segment,
              onClick: () => onChange(option.value),
            },
            option.label,
          ),
        ),
      )
    }

    /** Render the row's configuration page. */
    function ConfigPage(props) {
      const { form, view, ctx } = props
      if (view === 'summary') return null
      if (form === undefined) {
        return h('p', { style: style.hint }, 'Settings are not available for this entry yet.')
      }

      const host = form.state.value ?? {}
      const hostJudge = host.judge ?? {}
      const [enabled, setEnabled] = React.useState(hostJudge.enabled === true)
      const [endpoint, setEndpoint] = React.useState(hostJudge.endpoint ?? 'http://127.0.0.1:8081/v1/systemone')
      const [timeoutMs, setTimeoutMs] = React.useState(String(hostJudge.timeoutMs ?? 3000))
      const [status, setStatus] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      const t = copyFor(ctx)
      const readOnly = form.state.writable === false

      // Adopt Host values that arrived after this page mounted; the revision
      // changes only when the Host document moved.
      const revision = form.state.revision
      const [seenRevision, setSeenRevision] = React.useState(revision)
      if (revision !== seenRevision) {
        setSeenRevision(revision)
        setEnabled(hostJudge.enabled === true)
        setEndpoint(hostJudge.endpoint ?? 'http://127.0.0.1:8081/v1/systemone')
        setTimeoutMs(String(hostJudge.timeoutMs ?? 3000))
      }

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
            revision,
          )
          setStatus(ok ? t.saved : t.refused)
        } catch (error) {
          setStatus(String(error?.message ?? error))
        } finally {
          setBusy(false)
        }
      }

      const disabled = busy || readOnly

      return h(
        'div',
        { style: style.card },
        h(
          'div',
          { style: style.block },
          h('span', { style: style.label }, t.mode),
          h(ModeControl, { t, judge: enabled, disabled, onChange: setEnabled }),
          h('p', { style: style.hint }, t.modeHint),
        ),
        h(
          'div',
          { style: style.block },
          h('label', { style: style.label, htmlFor: 'remove-credential-endpoint' }, t.endpoint),
          h('input', {
            id: 'remove-credential-endpoint',
            type: 'text',
            style: style.input,
            value: endpoint,
            disabled,
            onChange: (event) => setEndpoint(event.target.value),
          }),
          h('p', { style: style.hint }, t.endpointHint),
        ),
        h(
          'div',
          { style: style.block },
          h('label', { style: style.label, htmlFor: 'remove-credential-timeout' }, t.timeout),
          h('input', {
            id: 'remove-credential-timeout',
            type: 'number',
            style: { ...style.input, maxWidth: 160 },
            value: timeoutMs,
            disabled,
            onChange: (event) => setTimeoutMs(event.target.value),
          }),
        ),
        h(
          'div',
          { style: style.footer },
          h('button', { type: 'button', style: style.save, disabled, onClick: save }, busy ? t.saving : t.save),
          status === '' ? null : h('span', { style: style.hint, role: 'status' }, status),
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
            (props) => h(ConfigPage, { ...props, ctx }),
          ),
        )
      },
    }
  },
})
