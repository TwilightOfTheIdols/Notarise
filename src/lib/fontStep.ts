import type { Editor } from '@tiptap/react'
import { FONT_SIZE_STEPS } from '../constants'
import { clampFontSize, clampIndex, getNearestFontStepIndex } from '../editorBehaviors'

export const getFontStepIndexForOffset = (referenceSize: number, offset: number) => {
  if (offset === 0) {
    return getNearestFontStepIndex(referenceSize)
  }

  if (offset > 0) {
    const largerStepIndex = FONT_SIZE_STEPS.findIndex((size) => size > referenceSize)
    return largerStepIndex === -1
      ? FONT_SIZE_STEPS.length - 1
      : clampIndex(largerStepIndex + offset - 1, FONT_SIZE_STEPS)
  }

  const smallerStepIndex = FONT_SIZE_STEPS.findLastIndex((size) => size < referenceSize)
  return smallerStepIndex === -1
    ? 0
    : clampIndex(smallerStepIndex + offset + 1, FONT_SIZE_STEPS)
}

export const getFontStepOffsetForIndex = (referenceSize: number, stepIndex: number) => {
  const stepSize = FONT_SIZE_STEPS[stepIndex]

  if (stepSize > referenceSize) {
    return FONT_SIZE_STEPS.filter((size) => size > referenceSize && size <= stepSize).length
  }

  if (stepSize < referenceSize) {
    return -FONT_SIZE_STEPS.filter((size) => size < referenceSize && size >= stepSize).length
  }

  return 0
}

export const getCurrentEditorRowFontSize = (editor: Editor, rowPos: number, fallbackSize: number) => {
  const rowNode = editor.state.doc.nodeAt(rowPos)
  const rowSize = Number(rowNode?.attrs.fontSize)

  return Number.isFinite(rowSize) && rowSize > 0
    ? clampFontSize(rowSize)
    : clampFontSize(fallbackSize)
}
