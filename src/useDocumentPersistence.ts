import { useEffect } from 'react'
import { loadDocument, saveDocument } from './documentStorage'
import { createDocumentSnapshot, useDocumentStore } from './store'

export function useDocumentPersistence() {
  const hydrateDocument = useDocumentStore((state) => state.hydrateDocument)

  useEffect(() => {
    let cancelled = false
    let saveTimer: number | null = null
    let unsubscribe: (() => void) | null = null

    loadDocument()
      .then((document) => {
        if (cancelled) {
          return
        }

        if (document) {
          hydrateDocument(document)
        }

        unsubscribe = useDocumentStore.subscribe((state) => {
          if (saveTimer !== null) {
            window.clearTimeout(saveTimer)
          }

          saveTimer = window.setTimeout(() => {
            void saveDocument(createDocumentSnapshot(state))
          }, 350)
        })
      })
      .catch((error) => {
        console.error('Unable to load document storage', error)
      })

    return () => {
      cancelled = true
      unsubscribe?.()

      if (saveTimer !== null) {
        window.clearTimeout(saveTimer)
      }
    }
  }, [hydrateDocument])
}
