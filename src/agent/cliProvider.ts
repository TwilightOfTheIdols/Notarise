import { invoke } from '@tauri-apps/api/core'
import type { AgentProvider, AgentTurnHandlers, AgentTurnInput, PermissionDecision } from './types'
import { buildPrompt } from './prompt'
import { buildFlags, runCli } from './cliRun'
import type { TurnState } from './cliRun'
import { collectWorkspace, materializeWorkspace } from './agentWorkspace'
import type { AgentCellFile } from './agentWorkspace'

type PermReq = { id: string; tool: string; input: unknown }

// Friendly one-line summary of what a tool wants to do.
const summarizeInput = (tool: string, input: unknown): string => {
  const obj = (input ?? {}) as Record<string, unknown>
  const path = obj.file_path ?? obj.path ?? obj.notebook_path
  if (typeof path === 'string') {
    return path
  }
  if (typeof obj.command === 'string') {
    return obj.command
  }
  try {
    const json = JSON.stringify(obj)
    return json.length > 200 ? `${json.slice(0, 200)}…` : json
  } catch {
    return tool
  }
}

// While an ask-mode turn runs, relay each pending approval request from the
// bridge into Notarise's permission UI, then write the decision back.
const startPermissionPoller = (handlers: AgentTurnHandlers, state: TurnState): (() => void) => {
  const handled = new Set<string>()
  let stopped = false
  const tick = async () => {
    if (stopped || state.cancelled) {
      return
    }
    let pending: PermReq[] = []
    try {
      pending = await invoke<PermReq[]>('agent_perms_pending')
    } catch {
      pending = []
    }
    for (const req of pending) {
      if (handled.has(req.id)) {
        continue
      }
      handled.add(req.id)
      void handlers
        .onPermissionRequest({
          tool: req.tool,
          title: `Allow ${req.tool}?`,
          detail: summarizeInput(req.tool, req.input),
        })
        .then((decision: PermissionDecision) =>
          invoke('agent_perms_resolve', {
            id: req.id,
            allow: decision === 'allow',
            message: decision === 'allow' ? null : 'Denied in Notarise',
          }),
        )
        .catch(() => undefined)
    }
  }
  const timer = window.setInterval(() => void tick(), 300)
  return () => {
    stopped = true
    window.clearInterval(timer)
  }
}

// Turn a tool name + input into a friendly "currently doing X" status.
const toolActivityLabel = (name: string, input: unknown): string => {
  const obj = (input ?? {}) as Record<string, unknown>
  const file = obj.file_path ?? obj.path ?? obj.notebook_path
  const base = (value: unknown) =>
    typeof value === 'string' ? value.split(/[\\/]/).pop() || value : undefined
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return base(file) ? `Editing ${base(file)}` : 'Editing'
    case 'Write':
      return base(file) ? `Writing ${base(file)}` : 'Writing'
    case 'Read':
      return base(file) ? `Reading ${base(file)}` : 'Reading'
    case 'Bash':
    case 'PowerShell':
      return 'Running a command'
    case 'Glob':
    case 'Grep':
      return 'Searching files'
    case 'WebFetch':
    case 'WebSearch':
      return 'Searching the web'
    case 'Task':
      return 'Working'
    default:
      return name
  }
}

// Claude Code's --output-format stream-json emits one JSON object per line.
const handleClaudeLine = (line: string, handlers: AgentTurnHandlers) => {
  let event: Record<string, unknown>
  try {
    event = JSON.parse(line) as Record<string, unknown>
  } catch {
    return
  }

  if (event.type === 'assistant') {
    const message = event.message as { content?: Array<Record<string, unknown>> } | undefined
    for (const block of message?.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') {
        handlers.onAssistantDelta(block.text)
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        handlers.onActivity(toolActivityLabel(block.name, block.input))
      }
    }
  } else if (event.type === 'result' && event.is_error === true) {
    const errors = Array.isArray(event.errors)
      ? event.errors.filter((e): e is string => typeof e === 'string').join('; ')
      : ''
    const message =
      (typeof event.result === 'string' && event.result) || errors || 'Agent reported an error'
    handlers.onError(message)
  }
}

// Codex --json events (shapes vary across versions, so this stays defensive).
const handleCodexLine = (line: string, handlers: AgentTurnHandlers) => {
  let event: Record<string, unknown>
  try {
    event = JSON.parse(line) as Record<string, unknown>
  } catch {
    return
  }

  const item = event.item as Record<string, unknown> | undefined
  if (event.type === 'item.completed' && item) {
    const kind = (item.item_type ?? item.type) as string | undefined
    if (kind === 'agent_message' && typeof item.text === 'string') {
      handlers.onAssistantDelta(item.text)
    } else if (typeof item.command === 'string') {
      handlers.onActivity('Running a command')
    }
    return
  }

  const msg = event.msg as Record<string, unknown> | undefined
  if (msg && msg.type === 'agent_message' && typeof msg.message === 'string') {
    handlers.onAssistantDelta(msg.message)
    return
  }

  if (typeof event.text === 'string') {
    handlers.onAssistantDelta(event.text)
  }
}

// Per Notarise-session continuity: the CLI session id to --resume, and (for
// scoped mode) a stable workspace dir reused across turns so conversation and
// file edits both persist.
type SessionRuntime = {
  cliSessionId?: string
  // cwd the cliSessionId was created in. Claude stores conversations per
  // directory, so a --resume only works in that same cwd.
  sessionCwd?: string
  workspaceDir?: string
  workspaceFiles?: AgentCellFile[]
}
const runtimes = new Map<string, SessionRuntime>()

const workspacePreamble = (input: AgentTurnInput): string => {
  const selected = input.context.cell ? `cells/${input.context.cell.id}.md` : null
  return (
    'Your working directory is a copy of the user\'s Notarise document. Each cell is a file at ' +
    'cells/<id>.md — edit those files to change cells. ' +
    (selected ? `The selected cell is ${selected}. ` : '') +
    'See AGENTS.md for the contract.'
  )
}

// When a scope/folder switch forces a fresh CLI conversation, replay the prior
// messages as context so the agent still "remembers" what was said.
const buildRecap = (history: NonNullable<AgentTurnInput['history']>): string => {
  const lines = history.slice(-20).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
  let text = lines.join('\n\n')
  if (text.length > 8000) {
    text = `…${text.slice(-8000)}`
  }
  return `Earlier in this conversation (you are continuing it, context only):\n\n${text}`
}

const repoPreamble = (input: AgentTurnInput): string => {
  const note = input.context.cell
    ? 'The user has selected a Notarise cell whose notes/TODOs are below — use them to guide your work.'
    : 'The Notarise context below describes what the user is focused on.'
  return `Your working directory is the user's project. Make the requested changes directly in the project files. ${note}`
}

const run = async (input: AgentTurnInput, handlers: AgentTurnHandlers, state: TurnState) => {
  const providerId = input.settings.providerId
  const isClaude = providerId === 'claude-code'

  const runtime = runtimes.get(input.sessionId) ?? {}
  runtimes.set(input.sessionId, runtime)

  // Full access + a linked project → run in the real repo. Otherwise run in a
  // throwaway copy of the document (scoped), reused across turns in this session
  // so edits and the --resume conversation both stay put.
  const useRepo = input.settings.mode === 'full' && Boolean(input.settings.projectDir)
  let cwd: string | undefined
  let workspaceFiles: AgentCellFile[] | null = null
  if (useRepo) {
    cwd = input.settings.projectDir as string
  } else if (runtime.workspaceDir && runtime.workspaceFiles) {
    cwd = runtime.workspaceDir
    workspaceFiles = runtime.workspaceFiles
  } else {
    const workspace = await materializeWorkspace()
    if (state.cancelled) {
      return
    }
    cwd = workspace.path
    workspaceFiles = workspace.files
    runtime.workspaceDir = workspace.path
    runtime.workspaceFiles = workspace.files
  }

  // Ask mode (Claude only for now): stand up the approval bridge and poll it.
  const askMode = isClaude && !input.settings.autoApprove
  let permissionConfigPath: string | undefined
  let stopPoller: (() => void) | null = null
  if (askMode) {
    try {
      const setup = await invoke<{ config_path: string }>('agent_perms_setup')
      permissionConfigPath = setup.config_path
      stopPoller = startPermissionPoller(handlers, state)
    } catch {
      // bridge setup failed; fall through running without interactive prompts
    }
  }

  // A resume id is only valid in the cwd it was created in. If the user switched
  // scope/project, drop it and start a fresh conversation here.
  if (runtime.sessionCwd !== cwd) {
    runtime.cliSessionId = undefined
    runtime.sessionCwd = cwd
  }

  // Fresh CLI conversation (first turn here, or just switched cwd) but we have
  // prior Notarise messages → seed them so context survives the switch.
  const needsRecap = isClaude && !runtime.cliSessionId && (input.history?.length ?? 0) > 0

  const preamble = useRepo ? repoPreamble(input) : workspacePreamble(input)
  const promptText = needsRecap
    ? `${preamble}\n\n${buildRecap(input.history!)}\n\n${buildPrompt(input)}`
    : `${preamble}\n\n${buildPrompt(input)}`
  const flags = buildFlags(providerId, input.settings, isClaude ? runtime.cliSessionId : undefined, permissionConfigPath)
  const handleLine = isClaude ? handleClaudeLine : handleCodexLine

  const finalize = async () => {
    stopPoller?.()
    if (!state.cancelled && workspaceFiles) {
      try {
        const changed = await collectWorkspace(cwd as string, workspaceFiles)
        if (changed > 0) {
          handlers.onAssistantDelta(`\n\n_Applied ${changed} cell edit(s) back to the document._`)
        }
      } catch {
        // collection is best-effort; don't fail the turn over it
      }
    }
    handlers.onDone()
  }

  await runCli(providerId, flags, promptText, cwd, {
    onLine: (line) => {
      // Capture the CLI session id (present on init/result events) so the next
      // turn in this Notarise session resumes the same conversation.
      if (isClaude) {
        try {
          const event = JSON.parse(line) as { session_id?: unknown }
          if (typeof event.session_id === 'string') {
            runtime.cliSessionId = event.session_id
          }
        } catch {
          // non-JSON line; ignore
        }
      }
      handleLine(line, handlers)
    },
    onError: (message) => {
      stopPoller?.()
      handlers.onError(message)
    },
    onClose: (code) => {
      if (code !== null && code !== 0) {
        stopPoller?.()
        handlers.onError(`The agent exited with code ${code}. Make sure it's installed and signed in.`)
        return
      }
      void finalize()
    },
  }, state)
}

export const cliProvider: AgentProvider = {
  id: 'claude-code',
  label: 'CLI agent',
  sendTurn(input, handlers) {
    const state: TurnState = { cancelled: false, child: null }
    run(input, handlers, state).catch((error) => {
      handlers.onError(error instanceof Error ? error.message : String(error))
    })
    return {
      cancel: () => {
        state.cancelled = true
        state.child?.kill().catch(() => undefined)
      },
    }
  },
}
