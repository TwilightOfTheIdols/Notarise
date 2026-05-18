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
    const store = await load(TAURI_STORE_FILE, { autoSave: false, defaults: {} })
    const document = await store.get<NotariseDocument>(DOCUMENT_KEY)

    if (document) {
      return document
    }

    const legacyStore = await load(LEGACY_TAURI_STORE_FILE, { autoSave: false, defaults: {} })
    return (await legacyStore.get<NotariseDocument>(LEGACY_DOCUMENT_KEY)) ?? null
  }

  const raw = window.localStorage.getItem(DOCUMENT_KEY)
  const legacyRaw = window.localStorage.getItem(LEGACY_DOCUMENT_KEY)
  return raw
    ? (JSON.parse(raw) as NotariseDocument)
    : legacyRaw ? (JSON.parse(legacyRaw) as NotariseDocument) : null
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
