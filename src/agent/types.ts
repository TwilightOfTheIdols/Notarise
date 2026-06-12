// The contract between Notarise's UI and an agent backend. A mock implements it
// today; a Claude Agent SDK / Codex sidecar implements the same interface later.

export type AgentProviderId = 'claude-code' | 'codex'

export type AgentMode = 'scoped' | 'full'

export type AgentModelId = 'default' | 'opus' | 'sonnet' | 'haiku'

export type AgentSettings = {
  providerId: AgentProviderId
  autoApprove: boolean
  mode: AgentMode
  model: AgentModelId
  // Real project folder the agent works in under "Full access" mode.
  projectDir: string | null
}

// Claude Code has no list-models command; --model takes stable aliases that
// auto-track the latest model, so this list doesn't go stale.
const CLAUDE_MODELS: { id: AgentModelId; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'opus', label: 'Opus (most capable)' },
  { id: 'sonnet', label: 'Sonnet (balanced)' },
  { id: 'haiku', label: 'Haiku (fastest)' },
]

// Codex uses different model names; until that path is verified, offer Default
// only (so it never gets fed a Claude alias).
const CODEX_MODELS: { id: AgentModelId; label: string }[] = [{ id: 'default', label: 'Default' }]

export const modelsForProvider = (id: AgentProviderId): { id: AgentModelId; label: string }[] =>
  id === 'claude-code' ? CLAUDE_MODELS : CODEX_MODELS

export type AgentRole = 'user' | 'assistant' | 'system'

export type AgentMessage = {
  id: string
  role: AgentRole
  text: string
  streaming?: boolean
}

// A tool approval the agent is asking for. The agent loop is paused until the
// user (or auto-approve) resolves it.
export type PermissionDecision = 'allow' | 'deny'

export type PermissionAsk = {
  tool: string
  title: string
  detail: string
}

export type PermissionRequest = PermissionAsk & {
  id: string
}

export type AgentSessionStatus = 'idle' | 'running'

export type AgentSession = {
  id: string
  title: string
  providerId: AgentProviderId
  createdAt: number
  status: AgentSessionStatus
  messages: AgentMessage[]
  pendingPermission: PermissionRequest | null
  // What the agent is doing right now (tool in progress), shown as a live status
  // line; null when idle.
  activity?: string | null
}

// Notarise state auto-attached to each turn (the user doesn't type this).
export type AgentTodo = {
  text: string
  checked: boolean
}

export type AgentCellContext = {
  id: string
  layer: number
  layerTitle: string
  text: string
  todos: AgentTodo[]
}

export type AgentContext = {
  cell: AgentCellContext | null
  activeLayer: number
  activeLayerTitle: string
}

export type AgentTurnHandlers = {
  onAssistantDelta: (text: string) => void
  // Resolves when the user (or auto-approve) decides. The provider awaits it.
  onPermissionRequest: (ask: PermissionAsk) => Promise<PermissionDecision>
  // The agent started/finished a tool; label describes it (null = back to idle).
  onActivity: (label: string | null) => void
  onDone: () => void
  onError: (message: string) => void
}

export type AgentTurnInput = {
  sessionId: string
  text: string
  settings: AgentSettings
  context: AgentContext
  // Prior messages in this Notarise session, used to seed context when a
  // scope/folder switch forces a fresh CLI conversation (claude can't --resume
  // across directories).
  history?: { role: AgentRole; text: string }[]
}

export type AgentProvider = {
  id: AgentProviderId
  label: string
  // Returns a handle so the UI can cancel an in-flight turn.
  sendTurn: (input: AgentTurnInput, handlers: AgentTurnHandlers) => { cancel: () => void }
}

// Onboarding: detecting and authenticating the user's installed CLI.
export type ProviderCheck = {
  installed: boolean
  authenticated: boolean
  detail?: string // plan/version when authenticated, or an error hint
}

// An in-progress, in-app sign-in. The provider streams the authorize URL and,
// for paste-code flows (Claude), waits for the code the user copies from the
// browser. No terminal involved.
export type LoginHandlers = {
  // The authorize URL to open / show. Fires once.
  onUrl: (url: string) => void
  // The CLI is now waiting for the pasted code (paste-code flow only).
  onAwaitingCode: () => void
  // The login process exited; ok === true means signed in.
  onDone: (ok: boolean) => void
  onError: (message: string) => void
}

export type LoginSession = {
  // Write the code the user pasted from the browser into the CLI's stdin.
  submitCode: (code: string) => Promise<void>
  // Kill the login process (user backed out).
  cancel: () => Promise<void>
}

export type ProviderLink = {
  // Detect whether the CLI is installed and logged in (real impl shells out via Tauri).
  checkStatus: (id: AgentProviderId) => Promise<ProviderCheck>
  // Install the CLI (real impl runs `npm install -g <pkg>`), then re-checks.
  install: (id: AgentProviderId, onLog?: (line: string) => void) => Promise<ProviderCheck>
  // Drive the CLI's sign-in entirely in-app: spawn it, surface its URL, and feed
  // back the pasted code via the returned session's stdin.
  startLogin: (id: AgentProviderId, handlers: LoginHandlers) => Promise<LoginSession>
}
