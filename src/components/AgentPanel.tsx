import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, FileText, Plus, Send, ShieldCheck, X } from 'lucide-react'
import { useAgentStore } from '../useAgentStore'
import { AgentOnboarding } from './AgentOnboarding'
import { buildAgentContext, summarizeContext } from '../agent/context'
import { pickProjectDir } from '../agent/dialog'
import { isTauri } from '../agent/tauriEnv'
import { useDocumentStore } from '../store'
import { modelsForProvider } from '../agent/types'
import type { AgentModelId, AgentProviderId } from '../agent/types'

const SUPPORTED = isTauri()

const PROVIDER_LABEL: Record<AgentProviderId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
}

const MODE_HINT: Record<'notarise' | 'ask' | 'full', string> = {
  notarise: 'Sandboxed to a copy of your document. Never asks.',
  ask: 'Works in your project. Asks before each edit.',
  full: 'Works in your project. No permission prompts.',
}

export function AgentPanel() {
  const isOpen = useAgentStore((state) => state.isOpen)
  const sessions = useAgentStore((state) => state.sessions)
  const activeSessionId = useAgentStore((state) => state.activeSessionId)
  const settings = useAgentStore((state) => state.settings)
  const linkedProviderId = useAgentStore((state) => state.linkedProviderId)
  const setOpen = useAgentStore((state) => state.setOpen)
  const createSession = useAgentStore((state) => state.createSession)
  const selectSession = useAgentStore((state) => state.selectSession)
  const sendMessage = useAgentStore((state) => state.sendMessage)
  const resolvePermission = useAgentStore((state) => state.resolvePermission)
  const updateSettings = useAgentStore((state) => state.updateSettings)
  const unlinkProvider = useAgentStore((state) => state.unlinkProvider)

  const [draft, setDraft] = useState('')

  // Subscribe to the doc-store slices that feed context so the chip stays live.
  const selectedBoxId = useDocumentStore((state) => state.selectedBoxId)
  const boxes = useDocumentStore((state) => state.boxes)
  const docActiveLayer = useDocumentStore((state) => state.activeLayer)
  const layerTitles = useDocumentStore((state) => state.layerTitles)
  const contextSummary = useMemo(
    () => summarizeContext(buildAgentContext()),
    [selectedBoxId, boxes, docActiveLayer, layerTitles],
  )

  const permMode: 'notarise' | 'ask' | 'full' =
    settings.mode === 'scoped' ? 'notarise' : settings.autoApprove ? 'full' : 'ask'

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null
  const pending = activeSession?.pendingPermission ?? null
  const isRunning = activeSession?.status === 'running'

  // Keep the thread pinned to the newest content as the agent streams a reply.
  const threadRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = threadRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [activeSession?.messages, pending])

  const submit = () => {
    const text = draft.trim()
    if (!text) {
      return
    }
    sendMessage(text)
    setDraft('')
  }

  return (
    <aside className={`agent-panel ${isOpen ? 'is-open' : ''}`} aria-hidden={!isOpen}>
      <header className="agent-panel-header">
        <div className="agent-panel-title">Assistant</div>
        {SUPPORTED && linkedProviderId && (
          <div className="agent-panel-tabs">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={`agent-tab ${session.id === activeSessionId ? 'is-active' : ''}`}
                onClick={() => selectSession(session.id)}
              >
                {session.title}
              </button>
            ))}
            <button type="button" className="agent-tab-new" title="New session" aria-label="New session" onClick={createSession}>
              <Plus size={14} aria-hidden="true" />
            </button>
          </div>
        )}
        <button type="button" className="agent-panel-close" title="Close" aria-label="Close" onClick={() => setOpen(false)}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {!SUPPORTED ? (
        <div className="agent-onboarding">
          <h2>Desktop only</h2>
          <p className="agent-onboarding-lead">
            The assistant runs your installed Claude Code / Codex CLI on your machine — something a web browser
            can&apos;t do. Open Notarise in the desktop app to link a provider and use it.
          </p>
        </div>
      ) : !linkedProviderId ? (
        <AgentOnboarding />
      ) : (
        <>
          <div className="agent-linked-bar">
            <span>
              Linked: <strong>{PROVIDER_LABEL[linkedProviderId]}</strong>
            </span>
            <button type="button" className="agent-linktext" onClick={unlinkProvider}>
              Switch
            </button>
          </div>

          <div className="agent-settings agent-settings-modes">
            <div className="agent-mode agent-mode-3">
              <button
                type="button"
                className={permMode === 'notarise' ? 'is-active' : ''}
                onClick={() => updateSettings({ mode: 'scoped', autoApprove: true })}
              >
                Notarise only
              </button>
              <button
                type="button"
                className={permMode === 'ask' ? 'is-active' : ''}
                onClick={() => updateSettings({ mode: 'full', autoApprove: false })}
              >
                Ask each edit
              </button>
              <button
                type="button"
                className={permMode === 'full' ? 'is-active' : ''}
                onClick={() => updateSettings({ mode: 'full', autoApprove: true })}
              >
                Full access
              </button>
            </div>
            <p className="agent-mode-hint">{MODE_HINT[permMode]}</p>
          </div>

          {modelsForProvider(settings.providerId).length > 1 && (
            <label className="agent-field agent-field-row">
              <span>Model</span>
              <select
                value={settings.model}
                onChange={(event) => updateSettings({ model: event.target.value as AgentModelId })}
              >
                {modelsForProvider(settings.providerId).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {settings.mode === 'full' && (
            <div className="agent-project">
              <span className="agent-project-path" title={settings.projectDir ?? undefined}>
                {settings.projectDir ?? 'No project folder linked'}
              </span>
              <div className="agent-project-actions">
                {settings.projectDir && (
                  <button type="button" className="agent-linktext" onClick={() => updateSettings({ projectDir: null })}>
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  className="agent-secondary"
                  onClick={async () => {
                    const dir = await pickProjectDir()
                    if (dir) {
                      updateSettings({ projectDir: dir })
                    }
                  }}
                >
                  {settings.projectDir ? 'Change' : 'Link folder'}
                </button>
              </div>
            </div>
          )}

          <div className="agent-thread" ref={threadRef}>
            {!activeSession || activeSession.messages.length === 0 ? (
              <p className="agent-empty">Ask the agent to work on the current cell, its TODOs, or the linked project.</p>
            ) : (
              activeSession.messages.map((message) => (
                <div key={message.id} className={`agent-message is-${message.role}`}>
                  {message.text}
                  {message.streaming && (
                    <span className="agent-caret" aria-hidden="true">
                      ⸙
                    </span>
                  )}
                </div>
              ))
            )}

            {pending && (
              <div className="agent-permission">
                <div className="agent-permission-head">
                  <ShieldCheck size={15} aria-hidden="true" />
                  <span>{pending.title}</span>
                </div>
                <code className="agent-permission-detail">{pending.detail}</code>
                <div className="agent-permission-actions">
                  <button type="button" className="agent-deny" onClick={() => resolvePermission('deny')}>
                    <X size={14} aria-hidden="true" /> Deny
                  </button>
                  <button type="button" className="agent-allow" onClick={() => resolvePermission('allow')}>
                    <Check size={14} aria-hidden="true" /> Allow
                  </button>
                </div>
              </div>
            )}
          </div>

          {isRunning && !pending && (
            <div className="agent-activity">
              <span className="agent-activity-glyph" aria-hidden="true">
                ✍︎
              </span>
              <span className="agent-activity-text">{`${activeSession?.activity ?? 'Thinking'}…`}</span>
            </div>
          )}

          <div className="agent-context" title="Attached automatically to each message">
            <FileText size={13} aria-hidden="true" />
            <span>{contextSummary}</span>
          </div>

          <form
            className="agent-composer"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <textarea
              value={draft}
              placeholder="Message the agent…"
              rows={2}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  submit()
                }
              }}
            />
            <button type="submit" className="agent-send" title="Send" aria-label="Send" disabled={isRunning || !draft.trim()}>
              <Send size={16} aria-hidden="true" />
            </button>
          </form>
        </>
      )}
    </aside>
  )
}
