import { useEffect } from 'react'
import { loadDocument, saveDocument } from './documentStorage'
import { createDocumentSnapshot, useDocumentStore } from './store'

const SAVE_DEBOUNCE_MS = 350

// Store writes are asynchronous. Serialize them across hook lifetimes so an
// older, slower write can never finish after a newer one and restore stale data.
let saveChain: Promise<void> = Promise.resolve()

const queueDocumentSave = () => {
  const snapshot = createDocumentSnapshot(useDocumentStore.getState())
  saveChain = saveChain
    .then(() => saveDocument(snapshot))
    .catch((error) => {
      console.error('Unable to save document storage', error)
    })
}

export function useDocumentPersistence() {
  const hydrateDocument = useDocumentStore((state) => state.hydrateDocument)

  useEffect(() => {
    let cancelled = false
    let saveTimer: number | null = null
    let unsubscribe: (() => void) | null = null
    // Set when an edit lands, cleared when it reaches storage — so flush()
    // never writes unless there is genuinely something unsaved (important
    // under StrictMode's dev double-mount, where the store is still empty).
    let dirty = false

    const flush = () => {
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer)
        saveTimer = null
      }
      if (dirty) {
        dirty = false
        queueDocumentSave()
      }
    }

    const subscribe = () => {
      unsubscribe = useDocumentStore.subscribe(() => {
        dirty = true
        if (saveTimer !== null) {
          window.clearTimeout(saveTimer)
        }
        saveTimer = window.setTimeout(() => {
          saveTimer = null
          dirty = false
          queueDocumentSave()
        }, SAVE_DEBOUNCE_MS)
      })
    }

    loadDocument()
      .then((document) => {
        if (cancelled) {
          return
        }

        if (document) {
          hydrateDocument(document)
        }
      })
      .catch((error) => {
        console.error('Unable to load document storage', error)
      })
      .finally(() => {
        // Subscribe even if the load failed — otherwise every edit made for
        // the rest of the session is silently unpersisted.
        if (!cancelled) {
          subscribe()
        }
      })

    // The debounce loses the last edit if the window closes inside the wait.
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)

    return () => {
      cancelled = true
      unsubscribe?.()
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [hydrateDocument])
}
