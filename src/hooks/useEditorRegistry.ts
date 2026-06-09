import { useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/react'

export function useEditorRegistry() {
  const editorsRef = useRef<Map<string, Editor>>(new Map())

  const registerEditor = useCallback((boxId: string, editor: Editor) => {
    editorsRef.current.set(boxId, editor)
  }, [])

  const unregisterEditor = useCallback((boxId: string) => {
    editorsRef.current.delete(boxId)
  }, [])

  const getEditor = useCallback((boxId: string) => {
    return editorsRef.current.get(boxId)
  }, [])

  const hasHighlightedText = useCallback((boxId: string | null) => {
    if (!boxId) {
      return false
    }

    const editor = editorsRef.current.get(boxId)
    return Boolean(editor && !editor.state.selection.empty)
  }, [])

  const focusCellEditor = useCallback((boxId: string) => {
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-box-id="${boxId}"] .ProseMirror`)?.focus()
    }, 0)
  }, [])

  return { registerEditor, unregisterEditor, getEditor, hasHighlightedText, focusCellEditor }
}
