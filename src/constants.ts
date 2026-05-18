import type { JSONContent } from '@tiptap/react'

export const LONG_PRESS_MS = 210
export const CLICK_DRIFT = 5
export const MIN_BOX_WIDTH = 220
export const MIN_BOX_HEIGHT = 90
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 72
export const DOT_SPACING = 44
export const FONT_SIZE_STEPS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72]
export const SIZE_PICKER_STEP_PX = 34
export const CELL_CONTROL_INSET = 8
export const SCALE_CONTROL_WIDTH = 28
export const SCALE_CONTROL_HEIGHT = 24
export const SIZE_PICKER_HEIGHT_PADDING = 6
export const EMPTY_DOCUMENT_CONTENT: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
    },
  ],
}
