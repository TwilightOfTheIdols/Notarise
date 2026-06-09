import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { FontSizeRowLabel, TextSizeDialState } from '../app/types'
import type { FontSizeSegment } from '../editorBehaviors'
import { clampFontSize } from '../editorBehaviors'
import { getCurrentEditorRowFontSize } from '../lib/fontStep'

const TEXT_SIZE_UI_FADE_MS = 160

export function useTextSizeDial() {
  const [textSizeDial, setTextSizeDial] = useState<TextSizeDialState | null>(null)
  const [fontSizeRowLabels, setFontSizeRowLabels] = useState<FontSizeRowLabel[]>([])
  const textSizeWheelTimerRef = useRef<number | null>(null)
  const textSizeWheelExitTimerRef = useRef<number | null>(null)
  const fontSizeLabelFrameRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (textSizeWheelTimerRef.current !== null) {
        window.clearTimeout(textSizeWheelTimerRef.current)
      }
      if (textSizeWheelExitTimerRef.current !== null) {
        window.clearTimeout(textSizeWheelExitTimerRef.current)
      }
      if (fontSizeLabelFrameRef.current !== null) {
        window.cancelAnimationFrame(fontSizeLabelFrameRef.current)
      }
    }
  }, [])

  const showTextSizeDial = useCallback((dial: Omit<TextSizeDialState, 'isExiting'>) => {
    if (textSizeWheelTimerRef.current !== null) {
      window.clearTimeout(textSizeWheelTimerRef.current)
      textSizeWheelTimerRef.current = null
    }
    if (textSizeWheelExitTimerRef.current !== null) {
      window.clearTimeout(textSizeWheelExitTimerRef.current)
      textSizeWheelExitTimerRef.current = null
    }

    setTextSizeDial({ ...dial, isExiting: false })
  }, [])

  const scheduleTextSizeUiHide = useCallback((delay = 520) => {
    if (textSizeWheelTimerRef.current !== null) {
      window.clearTimeout(textSizeWheelTimerRef.current)
    }
    if (textSizeWheelExitTimerRef.current !== null) {
      window.clearTimeout(textSizeWheelExitTimerRef.current)
      textSizeWheelExitTimerRef.current = null
    }

    textSizeWheelTimerRef.current = window.setTimeout(() => {
      setTextSizeDial((dial) => dial ? { ...dial, isExiting: true } : dial)
      textSizeWheelTimerRef.current = null

      textSizeWheelExitTimerRef.current = window.setTimeout(() => {
        setTextSizeDial(null)
        setFontSizeRowLabels([])
        textSizeWheelExitTimerRef.current = null
      }, TEXT_SIZE_UI_FADE_MS)
    }, delay)
  }, [])

  const showFontSizeRowLabels = useCallback((
    boxId: string,
    editor: Editor,
    segments: FontSizeSegment[],
    scale: number,
  ) => {
    if (fontSizeLabelFrameRef.current !== null) {
      window.cancelAnimationFrame(fontSizeLabelFrameRef.current)
    }

    fontSizeLabelFrameRef.current = window.requestAnimationFrame(() => {
      const rowGroups = new Map<number, {
        from: number
        sizeTotal: number
        length: number
      }>()

      segments.forEach((segment) => {
        const length = Math.max(1, segment.to - segment.from)
        const existing = rowGroups.get(segment.rowPos)

        if (existing) {
          existing.sizeTotal += segment.size * length
          existing.length += length
          return
        }

        rowGroups.set(segment.rowPos, {
          from: segment.rowFrom,
          sizeTotal: segment.size * length,
          length,
        })
      })

      const labels = [...rowGroups.entries()].flatMap(([rowPos, row]) => {
        try {
          const coords = editor.view.coordsAtPos(Math.min(row.from, editor.state.doc.content.size))
          const editorBox = editor.view.dom.getBoundingClientRect()
          const baseSize = row.length > 0 ? row.sizeTotal / row.length : 0
          const predictedSize = clampFontSize(baseSize * scale)
          const size = getCurrentEditorRowFontSize(editor, rowPos, predictedSize)

          return [{
            id: `${boxId}:${rowPos}`,
            boxId,
            x: editorBox.left - 10,
            y: (coords.top + coords.bottom) / 2,
            size,
          }]
        } catch {
          return []
        }
      })

      setFontSizeRowLabels(labels)
      fontSizeLabelFrameRef.current = null
    })
  }, [])

  const resetTextSizeDial = useCallback(() => {
    setTextSizeDial(null)
    setFontSizeRowLabels([])
  }, [])

  return {
    textSizeDial,
    fontSizeRowLabels,
    showTextSizeDial,
    scheduleTextSizeUiHide,
    showFontSizeRowLabels,
    resetTextSizeDial,
  }
}
