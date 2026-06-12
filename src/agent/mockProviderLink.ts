import type { AgentProviderId, LoginHandlers, ProviderCheck, ProviderLink } from './types'

// Stand-in for real CLI detection/auth (which will shell out via Tauri). It
// pretends the CLI is installed but signed out until startLogin runs, so the
// onboarding flow is fully exercisable before the sidecar exists.

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

const signedIn = new Set<AgentProviderId>()

const PLAN_LABEL: Record<AgentProviderId, string> = {
  'claude-code': 'Claude Pro',
  codex: 'ChatGPT Plus',
}

export const mockProviderLink: ProviderLink = {
  async checkStatus(id): Promise<ProviderCheck> {
    await delay(500)
    const authenticated = signedIn.has(id)
    return {
      installed: true,
      authenticated,
      detail: authenticated ? PLAN_LABEL[id] : undefined,
    }
  },
  async install(_id, onLog) {
    onLog?.('Installing (mock)…')
    await delay(1200)
    return { installed: true, authenticated: false }
  },
  async startLogin(id, handlers: LoginHandlers) {
    // Simulate the paste-code flow: surface a fake URL, then mark signed in once
    // any code is submitted.
    await delay(400)
    handlers.onUrl('https://claude.com/cai/oauth/authorize?mock=1')
    handlers.onAwaitingCode()
    return {
      async submitCode() {
        await delay(600)
        signedIn.add(id)
        handlers.onDone(true)
      },
      async cancel() {
        handlers.onDone(false)
      },
    }
  },
}
