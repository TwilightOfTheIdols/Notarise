import type { Editor } from '@tiptap/react'
import type { FontSizeSegment } from '../editorBehaviors'
import type { CellModel } from '../store'

export type DragMode =
  | null
  | {
      type: 'canvas'
      pointerId: number
      lastX: number
      lastY: number
    }
  | {
      type: 'box'
      pointerId: number
      boxId: string
      startX: number
      startY: number
      boxX: number
      boxY: number
    }
  | {
      type: 'resize'
      pointerId: number
      boxId: string
      startX: number
      startY: number
      width: number
      height: number
    }
  | {
      type: 'scale'
      pointerId: number
      boxId: string
      startX: number
      startY: number
      fontSize: number
      referenceSize: number
      startStepIndex: number
      controlX: number
      controlY: number
      controlHeight: number
      textSegments: FontSizeSegment[]
      editor: Editor | null
      scaleBoxDefault: boolean
    }
  | {
      type: 'storage'
      pointerId: number
      boxId: string
    }

export type PressState = {
  pointerId: number
  startX: number
  startY: number
  timer: number
} | null

export type FontSizeRowLabel = {
  id: string
  boxId: string
  x: number
  y: number
  size: number
}

export type DeletedLayerUndo = {
  type: 'layer'
  layer: number
  title: string | undefined
  boxes: CellModel[]
}

export type DeletedCellUndo = {
  type: 'cell'
  cell: CellModel
}

export type DeleteUndoAction = DeletedCellUndo | DeletedLayerUndo

export type TextSizeDialState = {
  boxId: string
  x: number
  y: number
  height: number
  rotation: number
  isExiting?: boolean
}

export type VisibleLayerGroup = {
  layer: number
  displayLayer: number
  boxes: CellModel[]
}
