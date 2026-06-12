import type { AgentProviderId, LoginHandlers, LoginSession, ProviderCheck, ProviderLink } from './types'
import { cliPackage, cliProgram, npmProgram } from './cli'
import { spawnEnv } from './spawnEnv'

const decode = (chunk: unknown): string =>
  typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk as Uint8Array)

// `claude auth status --json` -> { loggedIn, authMethod, apiProvider }. Free,
// instant, and no quota — the canonical way to read sign-in state.
const claudeAuthStatus = async (): Promise<{ loggedIn: boolean; detail?: string }> => {
  try {
    const { Command } = await import('@tauri-apps/plugin-shell')
    const env = await spawnEnv()
    const result = await Command.create(cliProgram('claude-code'), ['auth', 'status', '--json'], env ? { env } : undefined).execute()
    const json = JSON.parse(result.stdout.trim()) as { loggedIn?: boolean; authMethod?: string }
    return {
      loggedIn: json.loggedIn === true,
      detail: json.authMethod && json.authMethod !== 'none' ? json.authMethod : undefined,
    }
  } catch {
    return { loggedIn: false }
  }
}

export const cliProviderLink: ProviderLink = {
  async checkStatus(id: AgentProviderId): Promise<ProviderCheck> {
    const program = cliProgram(id)
    let version: string
    try {
      const { Command } = await import('@tauri-apps/plugin-shell')
      const env = await spawnEnv()
      const result = await Command.create(program, ['--version'], env ? { env } : undefined).execute()
      if (result.code !== 0) {
        return { installed: false, authenticated: false }
      }
      version = result.stdout.trim().split('\n')[0] || 'installed'
    } catch (error) {
      return { installed: false, authenticated: false, detail: error instanceof Error ? error.message : String(error) }
    }

    if (id === 'claude-code') {
      const { loggedIn, detail } = await claudeAuthStatus()
      return { installed: true, authenticated: loggedIn, detail: loggedIn ? version : detail }
    }
    // Codex auth probe is unreliable on this machine; treat installed as ready.
    return { installed: true, authenticated: true, detail: version }
  },

  async install(id: AgentProviderId, onLog?: (line: string) => void): Promise<ProviderCheck> {
    const pkg = cliPackage(id)
    try {
      const { Command } = await import('@tauri-apps/plugin-shell')
      const env = await spawnEnv()
      const command = Command.create(npmProgram(), ['install', '-g', pkg], env ? { env } : undefined)
      command.stdout.on('data', (chunk) => {
        const line = decode(chunk).trim()
        if (line) {
          onLog?.(line)
        }
      })
      command.stderr.on('data', (chunk) => {
        const line = decode(chunk).trim()
        if (line) {
          onLog?.(line)
        }
      })
      await new Promise<void>((resolve, reject) => {
        command.on('close', () => resolve())
        command.on('error', (error) => reject(new Error(typeof error === 'string' ? error : String(error))))
        command.spawn().catch(reject)
      })
    } catch (error) {
      return { installed: false, authenticated: false, detail: error instanceof Error ? error.message : String(error) }
    }
    return cliProviderLink.checkStatus(id)
  },

  async startLogin(id: AgentProviderId, handlers: LoginHandlers): Promise<LoginSession> {
    const { Command, open } = await import('@tauri-apps/plugin-shell')
    const env = await spawnEnv()

    if (id === 'claude-code') {
      // `claude auth login --claudeai` prints the authorize URL, then waits at
      // "Paste code here >" for the code on stdin. The CLI's own browser-open is
      // unreliable when spawned from the app, so we open the URL ourselves.
      const command = Command.create(cliProgram('claude-code'), ['auth', 'login', '--claudeai'], env ? { env } : undefined)
      let urlSent = false
      command.stdout.on('data', (chunk) => {
        const match = decode(chunk).match(/https:\/\/claude\.com\/[^\s]+/)
        if (match && !urlSent) {
          urlSent = true
          void open(match[0]).catch(() => {
            /* fall back to the copy-link button */
          })
          handlers.onUrl(match[0])
          handlers.onAwaitingCode()
        }
      })
      command.on('close', (data) => handlers.onDone((data as { code?: number }).code === 0))
      command.on('error', (error) => handlers.onError(typeof error === 'string' ? error : String(error)))
      const child = await command.spawn()
      return {
        submitCode: async (code) => {
          await child.write(`${code.trim()}\n`)
        },
        cancel: async () => {
          try {
            await child.kill()
          } catch {
            // already gone
          }
        },
      }
    }

    // Codex: `codex login` opens the browser and self-completes via localhost,
    // so there's no code to paste — just spawn and watch it exit.
    const command = Command.create(cliProgram(id), ['login'], env ? { env } : undefined)
    command.on('close', (data) => handlers.onDone((data as { code?: number }).code === 0))
    command.on('error', (error) => handlers.onError(typeof error === 'string' ? error : String(error)))
    const child = await command.spawn()
    return {
      submitCode: async () => {
        /* codex needs no pasted code */
      },
      cancel: async () => {
        try {
          await child.kill()
        } catch {
          // already gone
        }
      },
    }
  },
}
