import type { AgentProviderId } from './types'

const isWindows = () => typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

// Resolve the executable name. npm-global installs on Windows are `.cmd` shims,
// which Rust's process spawner won't find without the extension. The capability
// allows both names.
export const cliProgram = (id: AgentProviderId): string => {
  const base = id === 'claude-code' ? 'claude' : 'codex'
  return isWindows() ? `${base}.cmd` : base
}

export const npmProgram = (): string => (isWindows() ? 'npm.cmd' : 'npm')

export const cliPackage = (id: AgentProviderId): string =>
  id === 'claude-code' ? '@anthropic-ai/claude-code' : '@openai/codex'

