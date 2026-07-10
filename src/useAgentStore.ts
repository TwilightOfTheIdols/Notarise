import { create } from 'zustand'
import { mockProvider } from './agent/mockProvider'
import { mockProviderLink } from './agent/mockProviderLink'
import { cliProvider } from './agent/cliProvider'
import { cliProviderLink } from './agent/cliProviderLink'
import { isTauri } from './agent/tauriEnv'
import { buildAgentContext } from './agent/context'
import type {
  AgentMessage,
  AgentProvider,
  AgentProviderId,
  AgentSession,
  AgentSettings,
  LoginSession,
  PermissionDecision,
  ProviderCheck,
  ProviderLink,
} from './agent/types'

const nextId = () => crypto.randomUUID?.() ?? `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`

// Resolver for the active permission prompt, kept out of React state (it's a
// function). Keyed by session id; only one pending ask per session.
const permissionResolvers = new Map<string, (decision: PermissionDecision) => void>()

// Active turn handle per session, so we can cancel an in-flight run.
const turnHandles = new Map<string, { cancel: () => void }>()

// The in-flight sign-in (paste-code stdin lives here, out of React state).
let loginSession: LoginSession | null = null

const DEFAULT_SETTINGS: AgentSettings = {
  providerId: 'claude-code',
  autoApprove: false,
  mode: 'scoped',
  model: 'default',
  projectDir: null,
}

// Real CLI-backed implementations in the desktop shell; mocks in the browser
// (so `:5173` stays fully usable). Same interfaces either way.
const provider: AgentProvider = isTauri() ? cliProvider : mockProvider
const providerLink: ProviderLink = isTauri() ? cliProviderLink : mockProviderLink

// Persist the linked provider + settings so onboarding doesn't reappear.
const LINK_KEY = 'notarise.agent.link'

type Persisted = {
  linkedProviderId: AgentProviderId | null
  settings: AgentSettings
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isProviderId = (value: unknown): value is AgentProviderId =>
  value === 'claude-code' || value === 'codex'

const loadPersisted = (): Partial<Persisted> => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LINK_KEY) ?? '{}')
    if (!isRecord(parsed)) {
      return {}
    }

    const rawSettings = isRecord(parsed.settings) ? parsed.settings : {}
    const providerId = isProviderId(rawSettings.providerId)
      ? rawSettings.providerId
      : DEFAULT_SETTINGS.providerId
    const requestedMode = rawSettings.mode === 'full' || rawSettings.mode === 'scoped'
      ? rawSettings.mode
      : DEFAULT_SETTINGS.mode
    const codexAskFallback = providerId === 'codex' && requestedMode === 'full' && rawSettings.autoApprove === false
    const mode = codexAskFallback ? 'scoped' : requestedMode
    const model = rawSettings.model === 'opus' || rawSettings.model === 'sonnet' || rawSettings.model === 'haiku'
      ? rawSettings.model
      : 'default'

    return {
      linkedProviderId: parsed.linkedProviderId === null || isProviderId(parsed.linkedProviderId)
        ? parsed.linkedProviderId
        : null,
      settings: {
        providerId,
        mode,
        model: providerId === 'codex' ? 'default' : model,
        autoApprove: codexAskFallback
          ? true
          : typeof rawSettings.autoApprove === 'boolean'
          ? rawSettings.autoApprove
          : DEFAULT_SETTINGS.autoApprove,
        projectDir: typeof rawSettings.projectDir === 'string' || rawSettings.projectDir === null
          ? rawSettings.projectDir
          : DEFAULT_SETTINGS.projectDir,
      },
    }
  } catch {
    return {}
  }
}

const savePersisted = (data: Persisted) => {
  try {
    window.localStorage.setItem(LINK_KEY, JSON.stringify(data))
  } catch {
    // ignore storage failures
  }
}

const saved = loadPersisted()

type ProviderBusy = { kind: 'check' | 'install'; id: AgentProviderId } | null

type LoginPhase = 'starting' | 'awaiting-code' | 'exchanging' | 'error'
type LoginUiState = {
  providerId: AgentProviderId
  phase: LoginPhase
  url: string | null
  error: string | null
}

type AgentState = {
  sessions: AgentSession[]
  activeSessionId: string | null
  settings: AgentSettings
  isOpen: boolean
  // Onboarding / provider link
  linkedProviderId: AgentProviderId | null
  checks: Partial<Record<AgentProviderId, ProviderCheck>>
  providerBusy: ProviderBusy
  installLog: string
  login: LoginUiState | null
  setOpen: (open: boolean) => void
  checkProvider: (id: AgentProviderId) => Promise<void>
  installProvider: (id: AgentProviderId) => Promise<void>
  beginLogin: (id: AgentProviderId) => Promise<void>
  submitLoginCode: (code: string) => Promise<void>
  cancelLogin: () => void
  linkProvider: (id: AgentProviderId) => void
  unlinkProvider: () => void
  createSession: () => string
  selectSession: (id: string) => void
  sendMessage: (text: string) => void
  cancelTurn: () => void
  resolvePermission: (decision: PermissionDecision) => void
  updateSettings: (patch: Partial<AgentSettings>) => void
}

export const useAgentStore = create<AgentState>((set, get) => {
  const persist = () => {
    savePersisted({ linkedProviderId: get().linkedProviderId, settings: get().settings })
  }

  const patchSession = (id: string, patch: Partial<AgentSession>) => {
    set((state) => ({
      sessions: state.sessions.map((session) => (session.id === id ? { ...session, ...patch } : session)),
    }))
  }

  const appendMessage = (id: string, message: AgentMessage) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, messages: [...session.messages, message] } : session,
      ),
    }))
  }

  const appendToMessage = (sessionId: string, messageId: string, text: string) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              messages: session.messages.map((message) =>
                message.id === messageId ? { ...message, text: message.text + text } : message,
              ),
            }
          : session,
      ),
    }))
  }

  const finishMessage = (sessionId: string, messageId: string) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              status: 'idle',
              activity: null,
              messages: session.messages.map((message) =>
                message.id === messageId ? { ...message, streaming: false } : message,
              ),
            }
          : session,
      ),
    }))
  }

  const ensureSession = (): string => {
    const existing = get().activeSessionId
    if (existing) {
      return existing
    }
    return get().createSession()
  }

  return {
    sessions: [],
    activeSessionId: null,
    settings: { ...DEFAULT_SETTINGS, ...saved.settings },
    isOpen: false,
    linkedProviderId: saved.linkedProviderId ?? null,
    checks: {},
    providerBusy: null,
    installLog: '',
    login: null,

    setOpen: (open) => set({ isOpen: open }),

    checkProvider: async (id) => {
      set({ providerBusy: { kind: 'check', id } })
      try {
        const result = await providerLink.checkStatus(id)
        set((state) => ({ checks: { ...state.checks, [id]: result } }))
      } finally {
        set({ providerBusy: null })
      }
    },

    installProvider: async (id) => {
      set({ providerBusy: { kind: 'install', id }, installLog: '' })
      try {
        const result = await providerLink.install(id, (line) => set({ installLog: line }))
        set((state) => ({ checks: { ...state.checks, [id]: result } }))
      } catch (error) {
        set({ installLog: error instanceof Error ? error.message : String(error) })
      } finally {
        set({ providerBusy: null })
      }
    },

    beginLogin: async (id) => {
      set({ login: { providerId: id, phase: 'starting', url: null, error: null } })
      // After the login process exits, trust the real auth status (not the exit
      // code) to decide success.
      const finish = async () => {
        loginSession = null
        const result = await providerLink.checkStatus(id)
        set((state) => ({ checks: { ...state.checks, [id]: result } }))
        set((state) => {
          if (!state.login) {
            return {}
          }
          return result.authenticated
            ? { login: null }
            : {
                login: {
                  ...state.login,
                  phase: 'error' as LoginPhase,
                  error: state.login.error ?? 'Sign-in didn’t complete. Check the code and try again.',
                },
              }
        })
      }
      try {
        loginSession = await providerLink.startLogin(id, {
          onUrl: (url) => set((state) => (state.login ? { login: { ...state.login, url } } : {})),
          onAwaitingCode: () =>
            set((state) =>
              state.login && state.login.phase === 'starting'
                ? { login: { ...state.login, phase: 'awaiting-code' } }
                : {},
            ),
          onDone: () => {
            void finish()
          },
          onError: (message) =>
            set((state) => (state.login ? { login: { ...state.login, phase: 'error', error: message } } : {})),
        })
      } catch (error) {
        set({
          login: {
            providerId: id,
            phase: 'error',
            url: null,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      }
    },

    submitLoginCode: async (code) => {
      const session = loginSession
      if (!session) {
        return
      }
      set((state) => (state.login ? { login: { ...state.login, phase: 'exchanging', error: null } } : {}))
      try {
        await session.submitCode(code)
      } catch (error) {
        set((state) =>
          state.login
            ? { login: { ...state.login, phase: 'error', error: error instanceof Error ? error.message : String(error) } }
            : {},
        )
      }
    },

    cancelLogin: () => {
      void loginSession?.cancel()
      loginSession = null
      set({ login: null })
    },

    linkProvider: (id) => {
      set((state) => ({
        linkedProviderId: id,
        settings: {
          ...state.settings,
          providerId: id,
          model: id === 'codex' ? 'default' : state.settings.model,
          // Codex exec has no interactive stdin in this integration, so it
          // cannot service Notarise's per-edit approval UI.
          ...(id === 'codex' && state.settings.mode === 'full' && !state.settings.autoApprove
            ? { mode: 'scoped' as const, autoApprove: true }
            : {}),
        },
      }))
      persist()
    },

    unlinkProvider: () => {
      turnHandles.forEach((handle) => handle.cancel())
      turnHandles.clear()
      permissionResolvers.forEach((resolve) => resolve('deny'))
      permissionResolvers.clear()
      set((state) => ({
        linkedProviderId: null,
        sessions: state.sessions.map((session) => ({
          ...session,
          status: 'idle',
          pendingPermission: null,
          activity: null,
          messages: session.messages.map((message) =>
            message.streaming ? { ...message, streaming: false } : message,
          ),
        })),
      }))
      persist()
    },

    createSession: () => {
      const id = nextId()
      const session: AgentSession = {
        id,
        title: `Session ${get().sessions.length + 1}`,
        providerId: get().settings.providerId,
        createdAt: Date.now(),
        status: 'idle',
        messages: [],
        pendingPermission: null,
      }
      set((state) => ({
        sessions: [...state.sessions, session],
        activeSessionId: id,
      }))
      return id
    },

    selectSession: (id) => set({ activeSessionId: id }),

    sendMessage: (text) => {
      const trimmed = text.trim()
      if (!trimmed) {
        return
      }

      const currentSession = get().sessions.find((session) => session.id === get().activeSessionId)
      if (currentSession?.status === 'running') {
        return
      }

      const sessionId = ensureSession()

      // Snapshot the conversation so far (before this turn) to seed context if a
      // scope/folder switch forced a fresh CLI conversation.
      const priorMessages = get().sessions.find((session) => session.id === sessionId)?.messages ?? []
      const history = priorMessages
        .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.text.trim())
        .map((message) => ({ role: message.role, text: message.text }))

      appendMessage(sessionId, { id: nextId(), role: 'user', text: trimmed })

      const assistantId = nextId()
      appendMessage(sessionId, { id: assistantId, role: 'assistant', text: '', streaming: true })
      patchSession(sessionId, { status: 'running', activity: null })
      let settled = false

      const handle = provider.sendTurn(
        { sessionId, text: trimmed, settings: get().settings, context: buildAgentContext(), history },
        {
          onAssistantDelta: (chunk) => appendToMessage(sessionId, assistantId, chunk),
          onActivity: (label) => patchSession(sessionId, { activity: label }),
          onPermissionRequest: (ask) => {
            if (get().settings.autoApprove) {
              return Promise.resolve('allow')
            }
            return new Promise<PermissionDecision>((resolve) => {
              permissionResolvers.set(sessionId, resolve)
              patchSession(sessionId, { pendingPermission: { ...ask, id: nextId() } })
            })
          },
          onDone: () => {
            if (settled) {
              return
            }
            settled = true
            turnHandles.delete(sessionId)
            finishMessage(sessionId, assistantId)
          },
          onError: (message) => {
            if (settled) {
              return
            }
            settled = true
            turnHandles.delete(sessionId)
            appendToMessage(sessionId, assistantId, `\n[error: ${message}]`)
            finishMessage(sessionId, assistantId)
          },
        },
      )
      turnHandles.set(sessionId, handle)
    },

    cancelTurn: () => {
      const sessionId = get().activeSessionId
      if (!sessionId) {
        return
      }
      turnHandles.get(sessionId)?.cancel()
      turnHandles.delete(sessionId)
      permissionResolvers.get(sessionId)?.('deny')
      permissionResolvers.delete(sessionId)
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                status: 'idle',
                pendingPermission: null,
                activity: null,
                messages: session.messages.map((message) =>
                  message.streaming ? { ...message, streaming: false } : message,
                ),
              }
            : session,
        ),
      }))
    },

    resolvePermission: (decision) => {
      const sessionId = get().activeSessionId
      if (!sessionId) {
        return
      }
      const resolve = permissionResolvers.get(sessionId)
      permissionResolvers.delete(sessionId)
      patchSession(sessionId, { pendingPermission: null })
      resolve?.(decision)
    },

    updateSettings: (patch) => {
      set((state) => ({ settings: { ...state.settings, ...patch } }))
      persist()
    },
  }
})
