import { invoke } from '@tauri-apps/api/core'
import { spawnOptions } from './spawnEnv'
import type { AgentProviderId, AgentSettings } from './types'

const isWindows = () => typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

const decode = (chunk: unknown): string =>
  typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk as Uint8Array)

export type Child = { kill: () => Promise<void> }
export type TurnState = { cancelled: boolean; child: Child | null }

export type CliCallbacks = {
  onLine: (line: string) => void
  onClose: (code: number | null, stderr: string) => void
  onError: (message: string) => void
}

// Flags only — the prompt is delivered via stdin (a file redirect), because the
// Windows .cmd shim rejects multi-line command-line args.
// Read-only Notarise tools never need approval, so pre-allow them even in ask
// mode (mutating ones — create_cell/create_layer — still prompt).
const NOTARISE_READONLY_TOOLS = [
  'mcp__notarise__search',
  'mcp__notarise__list_cells',
  'mcp__notarise__list_layers',
  'mcp__notarise__get_cell',
  'mcp__notarise__goto_layer',
].join(',')

export const buildFlags = (
  providerId: AgentProviderId,
  settings: AgentSettings,
  resumeSessionId?: string,
  mcpConfigPath?: string,
): string[] => {
  if (providerId === 'claude-code') {
    const flags = ['-p', '--output-format', 'stream-json', '--verbose']
    // Continue the same conversation so context carries across messages.
    if (resumeSessionId) {
      flags.push('--resume', resumeSessionId)
    }
    if (settings.model !== 'default') {
      flags.push('--model', settings.model)
    }
    if (mcpConfigPath) {
      // Quoted: the path may contain spaces (e.g. macOS "Application Support").
      flags.push('--mcp-config', `"${mcpConfigPath}"`)
      flags.push('--allowedTools', NOTARISE_READONLY_TOOLS)
    }
    if (settings.autoApprove) {
      flags.push('--dangerously-skip-permissions')
    } else if (mcpConfigPath) {
      // Ask mode: route remaining permissions through our MCP approval tool,
      // which surfaces them in Notarise for an Allow/Deny.
      flags.push('--permission-prompt-tool', 'mcp__perms__approve')
    }
    return flags
  }

  // Codex uses different model names than Claude's aliases, so we never forward
  // settings.model here (the picker offers Default only for Codex).
  const flags = ['exec', '--json', '--skip-git-repo-check']
  if (settings.autoApprove) {
    flags.push('--full-auto')
  }
  return flags
}

// Spawn the CLI through the platform shell with the prompt redirected from a
// file. The shell resolves `claude`/`codex` on PATH (its .cmd shim) and closes
// stdin at EOF — which the Tauri Child can't do — so the CLI gets its prompt.
export const runCli = async (
  providerId: AgentProviderId,
  flags: string[],
  promptText: string,
  cwd: string | undefined,
  callbacks: CliCallbacks,
  state: TurnState,
): Promise<void> => {
  const { Command } = await import('@tauri-apps/plugin-shell')
  const promptPath = await invoke<string>('agent_write_prompt', { text: promptText })
  if (state.cancelled) {
    return
  }

  const cli = providerId === 'claude-code' ? 'claude' : 'codex'
  const inner = `${cli} ${flags.join(' ')} < "${promptPath}"`
  const options = await spawnOptions(cwd)
  const command = isWindows()
    ? Command.create('cmd', ['/c', inner], options)
    : Command.create('sh', ['-c', inner], options)

  let buffer = ''
  const drain = (final: boolean) => {
    const parts = buffer.split('\n')
    buffer = final ? '' : parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trim()
      if (line) {
        callbacks.onLine(line)
      }
    }
  }

  let stderr = ''
  command.stdout.on('data', (chunk) => {
    if (!state.cancelled) {
      buffer += decode(chunk)
      drain(false)
    }
  })
  command.stderr.on('data', (chunk) => {
    if (!state.cancelled) {
      stderr += decode(chunk)
    }
  })
  command.on('error', (error) => {
    if (!state.cancelled) {
      callbacks.onError(typeof error === 'string' ? error : String(error))
    }
  })
  command.on('close', (payload) => {
    if (state.cancelled) {
      return
    }
    drain(true)
    callbacks.onClose((payload as { code: number | null }).code, stderr)
  })

  const child = (await command.spawn()) as Child
  state.child = child
  // Cancel may have landed while spawn was in flight — kill now, or the process
  // outlives the turn.
  if (state.cancelled) {
    void child.kill().catch(() => undefined)
  }
}
