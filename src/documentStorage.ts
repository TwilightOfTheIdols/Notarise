import type { NotariseDocument } from './store'

const DOCUMENT_KEY = 'notarise.document'
const LEGACY_DOCUMENT_KEY = 'openpage.document'
const TAURI_STORE_FILE = 'notarise-document.json'
const LEGACY_TAURI_STORE_FILE = 'openpage-document.json'

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown
}

const isTauriRuntime = () => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as TauriWindow)
}

export async function loadDocument(): Promise<NotariseDocument | null> {
  if (isTauriRuntime()) {
    const { load } = await import('@tauri-apps/plugin-store')
    try {
      const store = await load(TAURI_STORE_FILE, { autoSave: false, defaults: {} })
      const document = await store.get<NotariseDocument>(DOCUMENT_KEY)
      if (document) {
        return document
      }
    } catch (error) {
      console.error('Unable to read primary document store; trying legacy storage', error)
    }

    try {
      const legacyStore = await load(LEGACY_TAURI_STORE_FILE, { autoSave: false, defaults: {} })
      return (await legacyStore.get<NotariseDocument>(LEGACY_DOCUMENT_KEY)) ?? null
    } catch (error) {
      console.error('Unable to read legacy document store', error)
      return null
    }
  }

  return (
    parseStoredDocument(window.localStorage.getItem(DOCUMENT_KEY)) ??
    parseStoredDocument(window.localStorage.getItem(LEGACY_DOCUMENT_KEY))
  )
}

// A corrupt primary blob shouldn't throw past the legacy fallback (or abort
// the load entirely) — log it and move on.
function parseStoredDocument(raw: string | null): NotariseDocument | null {
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as NotariseDocument
  } catch (error) {
    console.error('Ignoring corrupt stored document', error)
    return null
  }
}

export async function saveDocument(document: NotariseDocument): Promise<void> {
  if (isTauriRuntime()) {
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load(TAURI_STORE_FILE, { autoSave: false, defaults: {} })
    await store.set(DOCUMENT_KEY, document)
    await store.save()
    return
  }

  window.localStorage.setItem(DOCUMENT_KEY, JSON.stringify(document))
}
