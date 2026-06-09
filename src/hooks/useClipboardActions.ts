import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { Editor, JSONContent } from '@tiptap/react'
import { createImageDocumentContent, getImageFilesFromClipboard, readFileAsDataUrl } from '../contentUtils'
import { screenToWorld } from '../store'
import type { Viewport } from '../store'

type UseClipboardActionsDeps = {
  selectedBoxId: string | null
  viewport: Viewport
  workspaceSize: { width: number; height: number }
  lastCanvasPointRef: RefObject<{ x: number; y: number } | null>
  hasHighlightedText: (boxId: string | null) => boolean
  getEditor: (boxId: string) => Editor | undefined
  focusCellEditor: (boxId: string) => void
  duplicateBox: (id: string) => string | null
  createBoxWithContent: (point: { x: number; y: number }, content: JSONContent) => string
}

export function useClipboardActions({
  selectedBoxId,
  viewport,
  workspaceSize,
  lastCanvasPointRef,
  hasHighlightedText,
  getEditor,
  focusCellEditor,
  duplicateBox,
  createBoxWithContent,
}: UseClipboardActionsDeps) {
  const copiedCellIdRef = useRef<string | null>(null)

  const insertImagesIntoEditor = async (editor: Editor, files: File[]) => {
    const dataUrls = await Promise.all(files.map(readFileAsDataUrl))

    editor.chain().focus().insertContent(
      dataUrls.map((src) => ({
        type: 'image',
        attrs: { src },
      })),
    ).run()
  }

  const createImageBoxAtCursor = async (files: File[]) => {
    const dataUrls = await Promise.all(files.map(readFileAsDataUrl))
    const point = lastCanvasPointRef.current ?? screenToWorld({
      x: workspaceSize.width / 2,
      y: workspaceSize.height / 2,
    }, viewport)
    const id = createBoxWithContent(point, createImageDocumentContent(dataUrls))
    focusCellEditor(id)
  }

  useEffect(() => {
    const cellClipboardType = 'application/x-notarise-cell'

    const shouldUseCellClipboard = (event: ClipboardEvent) => {
      if (!selectedBoxId || hasHighlightedText(selectedBoxId)) {
        return false
      }

      const target = event.target instanceof HTMLElement ? event.target : null
      return !target?.closest('input, textarea, select')
    }

    const duplicateCopiedCell = (sourceId: string) => {
      const duplicateId = duplicateBox(sourceId)

      if (!duplicateId) {
        return
      }

      copiedCellIdRef.current = duplicateId
      focusCellEditor(duplicateId)
    }

    const handleCopy = (event: ClipboardEvent) => {
      if (!shouldUseCellClipboard(event)) {
        return
      }

      event.preventDefault()
      const copiedCellId = selectedBoxId

      if (!copiedCellId) {
        return
      }

      copiedCellIdRef.current = copiedCellId
      event.clipboardData?.setData(cellClipboardType, copiedCellId)
      event.clipboardData?.setData('text/plain', '')
    }

    const handlePaste = (event: ClipboardEvent) => {
      const files = getImageFilesFromClipboard(event)

      if (files.length === 0) {
        return
      }

      event.preventDefault()

      if (selectedBoxId) {
        const editor = getEditor(selectedBoxId)

        if (editor) {
          void insertImagesIntoEditor(editor, files)
          return
        }
      }

      void createImageBoxAtCursor(files)
    }

    const handleCellPaste = (event: ClipboardEvent) => {
      const copiedCellId = event.clipboardData?.getData(cellClipboardType)

      if (!copiedCellId || !shouldUseCellClipboard(event)) {
        return false
      }

      event.preventDefault()
      duplicateCopiedCell(copiedCellIdRef.current ?? copiedCellId)
      return true
    }

    const handleClipboardPaste = (event: ClipboardEvent) => {
      if (handleCellPaste(event)) {
        return
      }

      handlePaste(event)
    }

    window.addEventListener('copy', handleCopy)
    window.addEventListener('paste', handleClipboardPaste)

    return () => {
      window.removeEventListener('copy', handleCopy)
      window.removeEventListener('paste', handleClipboardPaste)
    }
  })
}
