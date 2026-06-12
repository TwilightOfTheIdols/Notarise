// Native folder picker for choosing the agent's project directory (Full access).
export const pickProjectDir = async (): Promise<string | null> => {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const result = await open({ directory: true, multiple: false, title: 'Choose a project folder' })
    return typeof result === 'string' ? result : null
  } catch {
    return null
  }
}
