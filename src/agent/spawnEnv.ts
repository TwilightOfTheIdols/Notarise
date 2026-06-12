import { invoke } from '@tauri-apps/api/core'

const isWindows = () => typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

let cachedPath: string | null = null

// Env to pass to every CLI spawn. On macOS/Linux a Finder-launched app has a
// stripped PATH, so we override it with an augmented one (computed in Rust) so
// `claude`/`codex`/`npm` — and the `node` the permission bridge needs — resolve.
// Windows GUI apps inherit the full PATH, so this is a no-op there.
export const spawnEnv = async (): Promise<Record<string, string> | undefined> => {
  if (isWindows()) {
    return undefined
  }
  if (cachedPath === null) {
    try {
      cachedPath = await invoke<string>('agent_path_env')
    } catch {
      cachedPath = ''
    }
  }
  return cachedPath ? { PATH: cachedPath } : undefined
}

// Merge cwd + env into a Tauri shell options object (or undefined if neither).
export const spawnOptions = async (
  cwd?: string,
): Promise<{ cwd?: string; env?: Record<string, string> } | undefined> => {
  const env = await spawnEnv()
  const options: { cwd?: string; env?: Record<string, string> } = {}
  if (cwd) {
    options.cwd = cwd
  }
  if (env) {
    options.env = env
  }
  return options.cwd || options.env ? options : undefined
}
