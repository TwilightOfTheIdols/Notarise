type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown
}

// True inside the Tauri desktop shell, false in a plain browser (e.g. `:5173`).
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as TauriWindow)
}
