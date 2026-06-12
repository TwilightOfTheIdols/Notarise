import { useState } from 'react'
import { ArrowLeft, Check, Copy, Download, ExternalLink, Loader2 } from 'lucide-react'
import { useAgentStore } from '../useAgentStore'
import { modelsForProvider } from '../agent/types'
import type { AgentModelId, AgentProviderId } from '../agent/types'

type ProviderMeta = {
  label: string
  blurb: string
  install: string
  account: string
  // Claude prints a code to paste; Codex self-completes via a localhost callback.
  loginKind: 'paste-code' | 'auto'
  docs: string
}

const PROVIDERS: Record<AgentProviderId, ProviderMeta> = {
  'claude-code': {
    label: 'Claude Code',
    blurb: "Anthropic's coding agent. Uses your Claude Pro or Max subscription — no API key.",
    install: 'npm install -g @anthropic-ai/claude-code',
    account: 'Claude (Anthropic) account',
    loginKind: 'paste-code',
    docs: 'https://claude.com/product/claude-code',
  },
  codex: {
    label: 'Codex',
    blurb: "OpenAI's coding agent. Uses your ChatGPT Plus, Pro, or Business plan.",
    install: 'npm install -g @openai/codex',
    account: 'ChatGPT account',
    loginKind: 'auto',
    docs: 'https://developers.openai.com/codex',
  },
}

export function AgentOnboarding() {
  const checks = useAgentStore((state) => state.checks)
  const providerBusy = useAgentStore((state) => state.providerBusy)
  const installLog = useAgentStore((state) => state.installLog)
  const settings = useAgentStore((state) => state.settings)
  const login = useAgentStore((state) => state.login)
  const updateSettings = useAgentStore((state) => state.updateSettings)
  const checkProvider = useAgentStore((state) => state.checkProvider)
  const installProvider = useAgentStore((state) => state.installProvider)
  const beginLogin = useAgentStore((state) => state.beginLogin)
  const submitLoginCode = useAgentStore((state) => state.submitLoginCode)
  const cancelLogin = useAgentStore((state) => state.cancelLogin)
  const linkProvider = useAgentStore((state) => state.linkProvider)

  const [selected, setSelected] = useState<AgentProviderId | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [code, setCode] = useState('')

  const select = (id: AgentProviderId) => {
    setSelected(id)
    if (!checks[id] && providerBusy?.id !== id) {
      void checkProvider(id)
    }
  }

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
    setCopied(text)
    window.setTimeout(() => setCopied((current) => (current === text ? null : current)), 1400)
  }

  if (!selected) {
    return (
      <div className="agent-onboarding">
        <h2>Link a coding agent</h2>
        <p className="agent-onboarding-lead">
          Notarise drives the agent you already have installed and signed in, so it runs on your own
          subscription. Pick one to connect.
        </p>
        <div className="agent-provider-cards">
          {(Object.keys(PROVIDERS) as AgentProviderId[]).map((id) => (
            <button key={id} type="button" className="agent-provider-card" onClick={() => select(id)}>
              <span className="agent-provider-name">{PROVIDERS[id].label}</span>
              <span className="agent-provider-blurb">{PROVIDERS[id].blurb}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const meta = PROVIDERS[selected]
  const check = checks[selected]
  const busyHere = providerBusy?.id === selected ? providerBusy.kind : null
  const loginHere = login?.providerId === selected ? login : null

  const back = () => {
    if (loginHere) {
      cancelLogin()
    }
    setSelected(null)
  }

  return (
    <div className="agent-onboarding">
      <button type="button" className="agent-onboarding-back" onClick={back}>
        <ArrowLeft size={14} aria-hidden="true" /> Back
      </button>
      <h2>{meta.label}</h2>

      {busyHere === 'check' && (
        <p className="agent-onboarding-status">
          <Loader2 size={15} className="agent-spin" aria-hidden="true" /> Checking for {meta.label}…
        </p>
      )}

      {check && !check.installed && (
        <div className="agent-step">
          <p>{meta.label} isn&apos;t on your PATH. I can install it for you:</p>
          <div className="agent-step-actions">
            <button
              type="button"
              className="agent-primary"
              disabled={busyHere === 'install'}
              onClick={() => void installProvider(selected)}
            >
              {busyHere === 'install' ? (
                <>
                  <Loader2 size={14} className="agent-spin" aria-hidden="true" /> Installing…
                </>
              ) : (
                <>
                  <Download size={14} aria-hidden="true" /> Install {meta.label}
                </>
              )}
            </button>
            <button type="button" className="agent-secondary" onClick={() => void checkProvider(selected)}>
              Re-check
            </button>
          </div>
          {busyHere === 'install' && (
            <p className="agent-hint">
              Running <code>{meta.install}</code> — this can take a minute.
            </p>
          )}
          {installLog && <p className="agent-log">{installLog}</p>}
          <details className="agent-manual">
            <summary>Install manually instead</summary>
            <div className="agent-cmd">
              <code>{meta.install}</code>
              <button type="button" onClick={() => copy(meta.install)} title="Copy" aria-label="Copy install command">
                {copied === meta.install ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              </button>
            </div>
            <a className="agent-link-out" href={meta.docs} target="_blank" rel="noreferrer">
              Install guide <ExternalLink size={12} aria-hidden="true" />
            </a>
          </details>
        </div>
      )}

      {check && check.installed && !check.authenticated && (
        <div className="agent-step">
          {!loginHere ? (
            <>
              <p>
                {meta.label} is installed. Sign in to your {meta.account} — a browser window will open, right from
                here.
              </p>
              <div className="agent-step-actions">
                <button type="button" className="agent-primary" onClick={() => void beginLogin(selected)}>
                  Sign in
                </button>
              </div>
            </>
          ) : loginHere.phase === 'starting' ? (
            <>
              <p className="agent-onboarding-status">
                <Loader2 size={15} className="agent-spin" aria-hidden="true" /> Opening your browser…
              </p>
              {meta.loginKind === 'auto' && (
                <div className="agent-step-actions">
                  <button type="button" className="agent-secondary" onClick={() => void checkProvider(selected)}>
                    I&apos;ve signed in
                  </button>
                  <button type="button" className="agent-linktext" onClick={cancelLogin}>
                    Cancel
                  </button>
                </div>
              )}
            </>
          ) : loginHere.phase === 'exchanging' ? (
            <p className="agent-onboarding-status">
              <Loader2 size={15} className="agent-spin" aria-hidden="true" /> Signing you in…
            </p>
          ) : (
            <>
              <p>
                Your browser opened Anthropic&apos;s sign-in page. Click <strong>Authorize</strong>, then paste the
                code it gives you below.
              </p>
              {loginHere.url && (
                <div className="agent-cmd">
                  <span className="agent-url-label">Page didn&apos;t open?</span>
                  <button type="button" onClick={() => copy(loginHere.url as string)} title="Copy sign-in link">
                    {copied === loginHere.url ? (
                      <>
                        <Check size={14} aria-hidden="true" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={14} aria-hidden="true" /> Copy link
                      </>
                    )}
                  </button>
                </div>
              )}
              <form
                className="agent-code-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (code.trim()) {
                    void submitLoginCode(code)
                    setCode('')
                  }
                }}
              >
                <input
                  type="text"
                  className="agent-code-input"
                  placeholder="Paste the code from the browser"
                  value={code}
                  autoFocus
                  onChange={(event) => setCode(event.target.value)}
                />
                <button type="submit" className="agent-primary" disabled={!code.trim()}>
                  Finish sign-in
                </button>
              </form>
              {loginHere.phase === 'error' && loginHere.error && <p className="agent-error">{loginHere.error}</p>}
              <button type="button" className="agent-linktext" onClick={cancelLogin}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {check && check.installed && check.authenticated && (
        <div className="agent-step">
          <p className="agent-onboarding-status agent-ok">
            <Check size={15} aria-hidden="true" /> Signed in{check.detail ? ` · ${check.detail}` : ''}
          </p>
          {modelsForProvider(selected).length > 1 && (
            <label className="agent-field">
              <span>Model</span>
              <select
                value={settings.model}
                onChange={(event) => updateSettings({ model: event.target.value as AgentModelId })}
              >
                {modelsForProvider(selected).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="agent-step-actions">
            <button type="button" className="agent-primary" onClick={() => linkProvider(selected)}>
              Link {meta.label}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
