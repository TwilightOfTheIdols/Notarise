import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Editor } from '@tiptap/react'
import { ListTodo, Package, PackageOpen, ScrollText, Settings, Trash2 } from 'lucide-react'
import {
  CELL_CONTROL_INSET,
  CLICK_DRIFT,
  DOT_SPACING,
  FONT_SIZE_STEPS,
  LONG_PRESS_MS,
  MIN_BOX_HEIGHT,
  MIN_BOX_WIDTH,
  SCALE_CONTROL_HEIGHT,
  SCALE_CONTROL_WIDTH,
  SIZE_PICKER_HEIGHT_PADDING,
  SIZE_PICKER_STEP_PX,
} from './constants'
import {
  applyScaledFontSegments,
  clampFontSize,
  captureDocumentFontSegments,
  captureSelectedRowFontSegments,
  clampIndex,
  getMaxGrowStepIndex,
  getMinShrinkStepIndex,
  getNearestFontStepIndex,
  getWeightedSegmentFontSize,
} from './editorBehaviors'
import type { FontSizeSegment } from './editorBehaviors'
import { createImageDocumentContent, getImageFilesFromClipboard, isEmptyDocumentContent, readFileAsDataUrl } from './contentUtils'
import { CanvasCellDragPreview, DeletedTextPanel, StorageDragPreview } from './StoragePanel'
import { TextSizeWheelPicker } from './TextSizeWheel'
import { GlobalSearch } from './GlobalSearch'
import { SettingsPanel } from './SettingsPanel'
import { CanvasTextBox } from './CanvasTextBox'
import { ConfirmationDialog } from './ConfirmationDialog'
import type { ConfirmationRequest } from './ConfirmationDialog'
import { LayerRail } from './LayerRail'
import type { LayerDragState, LayerReleaseState } from './LayerRail'
import { TodoPanel } from './TodoPanel'
import { getUncheckedTodoCount, setTodoChecked } from './todoUtils'
import type { TodoItem } from './todoUtils'
import { getDefaultLayerTitle } from './layerTitleUtils'
import { useDocumentPersistence } from './useDocumentPersistence'
import { createDocumentSnapshot, useDocumentStore, screenToWorld } from './store'
import type { CellModel, DocumentSettings, NotariseDocument, SearchAnimationPreset, StoredCellModel } from './store'
import { getTemperatureColors, rgbTriplet } from './palettes'

type DragMode =
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

type PressState = {
  pointerId: number
  startX: number
  startY: number
  timer: number
} | null

type FontSizeRowLabel = {
  id: string
  boxId: string
  x: number
  y: number
  size: number
}

type DeletedLayerUndo = {
  type: 'layer'
  layer: number
  title: string | undefined
  boxes: CellModel[]
}

type DeletedCellUndo = {
  type: 'cell'
  cell: CellModel
}

type DeleteUndoAction = DeletedCellUndo | DeletedLayerUndo

type TextSizeDialState = {
  boxId: string
  x: number
  y: number
  height: number
  rotation: number
  isExiting?: boolean
}

const SEARCH_ANIMATION_DURATIONS: Record<SearchAnimationPreset, { min: number; max: number }> = {
  normal: { min: 400, max: 1800 },
  instant: { min: 0, max: 0 },
}

const TEXT_SIZE_UI_FADE_MS = 160
const CONFIRMATION_UI_FADE_MS = 220
const DOT_MATRIX_FADE_MS = 260
const SEARCH_SETTLE_MS = 520
const CSS_EASE = (() => {
  const x1 = 0.25
  const y1 = 0.1
  const x2 = 0.25
  const y2 = 1
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by

  const sampleX = (time: number) => ((ax * time + bx) * time + cx) * time
  const sampleY = (time: number) => ((ay * time + by) * time + cy) * time
  const sampleDerivativeX = (time: number) => (3 * ax * time + 2 * bx) * time + cx

  return (progress: number) => {
    let time = progress

    for (let index = 0; index < 5; index += 1) {
      const x = sampleX(time) - progress
      const derivative = sampleDerivativeX(time)

      if (Math.abs(x) < 0.0001 || Math.abs(derivative) < 0.0001) {
        break
      }

      time -= x / derivative
    }

    return sampleY(Math.min(1, Math.max(0, time)))
  }
})()

const getSearchJumpDuration = (
  startViewport: { x: number; y: number },
  targetViewport: { x: number; y: number },
  layerDistance: number,
  settings: DocumentSettings,
) => {
  const durationBounds = SEARCH_ANIMATION_DURATIONS[settings.searchAnimationPreset]

  if (durationBounds.max === 0) {
    return 0
  }

  const panDistance = Math.hypot(targetViewport.x - startViewport.x, targetViewport.y - startViewport.y)
  const weightedDistance = panDistance / 900 + layerDistance / 4
  const normalizedDistance = Math.log1p(weightedDistance) / Math.log1p(8)
  const clampedDistance = Math.min(1, Math.max(0, normalizedDistance))

  return durationBounds.min + clampedDistance * (durationBounds.max - durationBounds.min)
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const parseNotariseDocument = (text: string): NotariseDocument => {
  const parsed: unknown = JSON.parse(text)

  if (!isRecord(parsed)) {
    throw new Error('This does not look like a valid Notarise document.')
  }

  if (parsed.version === 1 && Array.isArray(parsed.boxes)) {
    return parsed as NotariseDocument
  }

  if (
    parsed.version === 2 &&
    parsed.kind === 'notarise.virtual-file-bundle' &&
    isRecord(parsed.files)
  ) {
    return parsed as NotariseDocument
  }

  throw new Error('This does not look like a valid Notarise document.')
}

const withUpdatedAt = (document: NotariseDocument): NotariseDocument => {
  return {
    ...document,
    updatedAt: Date.now(),
  }
}

const readTextFile = (file: File) => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Could not read this file.'))
    })
    reader.addEventListener('error', () => reject(new Error('Could not read this file.')))
    reader.readAsText(file)
  })
}

const getOrderedLayerMap = (orderedLayers: number[]) => {
  const uniqueLayers = [...new Set(orderedLayers)]

  if (uniqueLayers.length === 0) {
    return new Map<number, number>()
  }

  const topLayer = Math.max(...uniqueLayers)
  return new Map(uniqueLayers.map((layer, index) => [layer, topLayer - index]))
}

const snapToDevicePixel = (value: number) => {
  const ratio = window.devicePixelRatio || 1
  return Math.round(value * ratio) / ratio
}

const getFontStepIndexForOffset = (referenceSize: number, offset: number) => {
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

const getFontStepOffsetForIndex = (referenceSize: number, stepIndex: number) => {
  const stepSize = FONT_SIZE_STEPS[stepIndex]

  if (stepSize > referenceSize) {
    return FONT_SIZE_STEPS.filter((size) => size > referenceSize && size <= stepSize).length
  }

  if (stepSize < referenceSize) {
    return -FONT_SIZE_STEPS.filter((size) => size < referenceSize && size >= stepSize).length
  }

  return 0
}

const getCurrentEditorRowFontSize = (editor: Editor, rowPos: number, fallbackSize: number) => {
  const rowNode = editor.state.doc.nodeAt(rowPos)
  const rowSize = Number(rowNode?.attrs.fontSize)

  return Number.isFinite(rowSize) && rowSize > 0
    ? clampFontSize(rowSize)
    : clampFontSize(fallbackSize)
}

export function App() {
  const boxes = useDocumentStore((state) => state.boxes)
  const deletedBoxes = useDocumentStore((state) => state.deletedBoxes)
  const layerTitles = useDocumentStore((state) => state.layerTitles)
  const selectedBoxId = useDocumentStore((state) => state.selectedBoxId)
  const viewport = useDocumentStore((state) => state.viewport)
  const activeLayer = useDocumentStore((state) => state.activeLayer)
  const theme = useDocumentStore((state) => state.theme)
  const settings = useDocumentStore((state) => state.settings)
  const createBox = useDocumentStore((state) => state.createBox)
  const createBoxWithContent = useDocumentStore((state) => state.createBoxWithContent)
  const duplicateBox = useDocumentStore((state) => state.duplicateBox)
  const selectBox = useDocumentStore((state) => state.selectBox)
  const setViewport = useDocumentStore((state) => state.setViewport)
  const panBy = useDocumentStore((state) => state.panBy)
  const zoomAt = useDocumentStore((state) => state.zoomAt)
  const stepLayer = useDocumentStore((state) => state.stepLayer)
  const setLayer = useDocumentStore((state) => state.setLayer)
  const setLayerAndSelect = useDocumentStore((state) => state.setLayerAndSelect)
  const reorderLayers = useDocumentStore((state) => state.reorderLayers)
  const setLayerTitle = useDocumentStore((state) => state.setLayerTitle)
  const setTheme = useDocumentStore((state) => state.setTheme)
  const updateSettings = useDocumentStore((state) => state.updateSettings)
  const resetSettings = useDocumentStore((state) => state.resetSettings)
  const updateBox = useDocumentStore((state) => state.updateBox)
  const deleteBox = useDocumentStore((state) => state.deleteBox)
  const removeBox = useDocumentStore((state) => state.removeBox)
  const restoreRemovedBox = useDocumentStore((state) => state.restoreRemovedBox)
  const restoreBox = useDocumentStore((state) => state.restoreBox)
  const permanentlyDeleteBox = useDocumentStore((state) => state.permanentlyDeleteBox)
  const removeLayer = useDocumentStore((state) => state.removeLayer)
  const restoreLayer = useDocumentStore((state) => state.restoreLayer)
  const hydrateDocument = useDocumentStore((state) => state.hydrateDocument)

  const editorShellRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const trashRef = useRef<HTMLButtonElement>(null)
  const storagePanelRef = useRef<HTMLElement>(null)
  const editorsRef = useRef<Map<string, Editor>>(new Map())
  const copiedCellIdRef = useRef<string | null>(null)
  const deletedUndoStackRef = useRef<DeleteUndoAction[]>([])
  const lastCanvasPointRef = useRef<{ x: number; y: number } | null>(null)
  const dragRef = useRef<DragMode>(null)
  const pressRef = useRef<PressState>(null)
  const movementTimerRef = useRef<number | null>(null)
  const originAnimationRef = useRef<number | null>(null)
  const searchJumpAnimationRef = useRef<number | null>(null)
  const searchBrightnessReleaseRef = useRef<number | null>(null)
  const searchBrightnessReleaseTimerRef = useRef<number | null>(null)
  const textSizeWheelTimerRef = useRef<number | null>(null)
  const textSizeWheelExitTimerRef = useRef<number | null>(null)
  const textSizeWheelRotationRef = useRef(0)
  const textSizeWheelDeltaRef = useRef(0)
  const fontSizeLabelFrameRef = useRef<number | null>(null)
  const layerReleaseFrameRef = useRef<number | null>(null)
  const compassAngleRef = useRef(0)
  const [isPanning, setIsPanning] = useState(false)
  const [isCanvasMoving, setIsCanvasMoving] = useState(false)
  const [isSearchJumping, setIsSearchJumping] = useState(false)
  const [isTrashOpen, setIsTrashOpen] = useState(false)
  const [isTodoOpen, setIsTodoOpen] = useState(false)
  const [isTrashHot, setIsTrashHot] = useState(false)
  const [draggedBoxId, setDraggedBoxId] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [visualLayer, setVisualLayer] = useState<number | null>(null)
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 })
  const [textSizeDial, setTextSizeDial] = useState<TextSizeDialState | null>(null)
  const [storageDragPreview, setStorageDragPreview] = useState<{
    boxId: string
    x: number
    y: number
  } | null>(null)
  const [confirmationRequest, setConfirmationRequest] = useState<ConfirmationRequest | null>(null)
  const [layerDrag, setLayerDrag] = useState<LayerDragState | null>(null)
  const [layerRelease, setLayerRelease] = useState<LayerReleaseState | null>(null)
  const [fontSizeRowLabels, setFontSizeRowLabels] = useState<FontSizeRowLabel[]>([])
  const [searchBrightnessPulse, setSearchBrightnessPulse] = useState(0)
  const [searchFocusLayer, setSearchFocusLayer] = useState<number | null>(null)

  useDocumentPersistence()

  useEffect(() => {
    const root = document.documentElement
    const colors = getTemperatureColors(theme, settings.colorTemperature)
    const textRgb = rgbTriplet(colors.text)
    const trimRgb = rgbTriplet(colors.trim)

    root.dataset.theme = theme
    root.style.setProperty('--canvas-bg', colors.canvas)
    root.style.setProperty('--canvas-bg-rgb', rgbTriplet(colors.canvas))
    root.style.setProperty('--text', colors.text)
    root.style.setProperty('--text-rgb', textRgb)
    root.style.setProperty('--cell-bg', colors.cell)
    root.style.setProperty('--cell-bg-rgb', rgbTriplet(colors.cell))
    root.style.setProperty('--trim', colors.trim)
    root.style.setProperty('--trim-rgb', trimRgb)
    root.style.setProperty('--muted', `rgb(${textRgb} / ${theme === 'dark' ? 0.62 : 0.58})`)
    root.style.setProperty('--faint', `rgb(${textRgb} / ${theme === 'dark' ? 0.14 : 0.12})`)
    root.style.setProperty('--hairline', `rgb(${trimRgb} / ${theme === 'dark' ? 0.16 : 0.12})`)
    root.style.setProperty('--active-line', `rgb(${trimRgb} / ${theme === 'dark' ? 0.42 : 0.34})`)
    root.style.setProperty('--control-bg', `rgb(${trimRgb} / ${theme === 'dark' ? 0.12 : 0.075})`)
    root.style.setProperty('--control-hover', `rgb(${trimRgb} / ${theme === 'dark' ? 0.2 : 0.13})`)
    root.style.setProperty('--dot-color', `rgb(${trimRgb} / ${theme === 'dark' ? 0.44 : 0.36})`)
  }, [settings.colorTemperature, theme])

  useEffect(() => {
    if (!confirmationRequest) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConfirmationRequest(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [confirmationRequest])

  useEffect(() => {
    return () => {
      if (movementTimerRef.current !== null) {
        window.clearTimeout(movementTimerRef.current)
      }
      if (originAnimationRef.current !== null) {
        window.cancelAnimationFrame(originAnimationRef.current)
      }
      if (searchJumpAnimationRef.current !== null) {
        window.cancelAnimationFrame(searchJumpAnimationRef.current)
      }
      if (searchBrightnessReleaseRef.current !== null) {
        window.cancelAnimationFrame(searchBrightnessReleaseRef.current)
      }
      if (searchBrightnessReleaseTimerRef.current !== null) {
        window.clearTimeout(searchBrightnessReleaseTimerRef.current)
      }
      if (textSizeWheelTimerRef.current !== null) {
        window.clearTimeout(textSizeWheelTimerRef.current)
      }
      if (textSizeWheelExitTimerRef.current !== null) {
        window.clearTimeout(textSizeWheelExitTimerRef.current)
      }
      textSizeWheelDeltaRef.current = 0
      if (fontSizeLabelFrameRef.current !== null) {
        window.cancelAnimationFrame(fontSizeLabelFrameRef.current)
      }
      if (layerReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(layerReleaseFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const workspace = workspaceRef.current

    if (!workspace) {
      return
    }

    const updateWorkspaceSize = () => {
      const rect = workspace.getBoundingClientRect()
      setWorkspaceSize({
        width: rect.width,
        height: rect.height,
      })
    }

    updateWorkspaceSize()

    const observer = new ResizeObserver(updateWorkspaceSize)
    observer.observe(workspace)

    return () => {
      observer.disconnect()
    }
  }, [])

  const visibleLayerDots = useMemo(() => {
    const layerSet = new Set(boxes.map((box) => box.layer))
    Object.keys(layerTitles).forEach((layer) => {
      if (layerTitles[Number(layer)]?.trim()) {
        layerSet.add(Number(layer))
      }
    })
    layerSet.add(activeLayer)
    return [...layerSet].sort((a, b) => b - a)
  }, [activeLayer, boxes, layerTitles])
  const uncheckedTodoCount = useMemo(() => getUncheckedTodoCount(boxes), [boxes])

  const layerBounds = useMemo(() => {
    const layerSet = new Set(boxes.map((box) => box.layer))
    Object.entries(layerTitles).forEach(([layer, title]) => {
      if (title.trim()) {
        layerSet.add(Number(layer))
      }
    })
    const layers = [...layerSet]

    if (layers.length === 0) {
      return { bottom: activeLayer, top: activeLayer }
    }

    return {
      bottom: Math.min(...layers),
      top: Math.max(...layers),
    }
  }, [activeLayer, boxes, layerTitles])

  const clampNavigableLayer = (layer: number) => {
    return Math.min(Math.max(layer, layerBounds.bottom - 1), layerBounds.top + 1)
  }

  const layerRenderPosition = visualLayer ?? activeLayer
  const visibleActiveLayer = Math.round(layerRenderPosition)
  const frontLayer = visualLayer === null ? activeLayer : visibleActiveLayer

  const getLayerTitle = useCallback((layer: number) => {
    const title = layerTitles[layer]?.trim()

    if (title) {
      return title
    }

    return boxes.some((box) => box.layer === layer) ? `Layer ${layer}` : getDefaultLayerTitle()
  }, [boxes, layerTitles])

  const getLayerDragTargetIndex = (drag: LayerDragState, clientY: number) => {
    const rowStep = Math.max(1, drag.rowHeight + 6)
    const draggedCenterY = drag.sourceIndex * rowStep + (clientY - drag.startY) + drag.rowHeight / 2
    const targetIndex = Math.floor(draggedCenterY / rowStep)

    return Math.min(Math.max(targetIndex, 0), drag.sourceOrder.length - 1)
  }

  const getLayerDragOrder = (drag: LayerDragState, targetIndex = drag.targetIndex) => {
    const nextOrder = drag.sourceOrder.filter((layer) => layer !== drag.layer)
    nextOrder.splice(targetIndex, 0, drag.layer)

    return nextOrder
  }

  const layerPreviewMap = layerDrag?.isDragging
    ? getOrderedLayerMap(getLayerDragOrder(layerDrag))
    : null
  const visualLayerRenderPosition = layerPreviewMap?.get(layerRenderPosition) ?? layerRenderPosition

  const startLayerDrag = (event: ReactPointerEvent<HTMLButtonElement>, layer: number) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (layerReleaseFrameRef.current !== null) {
      window.cancelAnimationFrame(layerReleaseFrameRef.current)
      layerReleaseFrameRef.current = null
    }
    setLayerRelease(null)
    const rowHeight = event.currentTarget.getBoundingClientRect().height
    const sourceIndex = visibleLayerDots.indexOf(layer)

    if (sourceIndex === -1) {
      return
    }

    setLayerDrag({
      layer,
      pointerId: event.pointerId,
      isDragging: false,
      startY: event.clientY,
      currentY: event.clientY,
      rowHeight,
      sourceIndex,
      targetIndex: sourceIndex,
      sourceOrder: visibleLayerDots,
    })
  }

  const moveLayerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    setLayerDrag((drag) => {
      if (!drag || event.pointerId !== drag.pointerId) {
        return drag
      }

      const isDragging = drag.isDragging || Math.abs(event.clientY - drag.startY) >= CLICK_DRIFT
      const targetIndex = isDragging ? getLayerDragTargetIndex(drag, event.clientY) : drag.sourceIndex

      return {
        ...drag,
        isDragging,
        currentY: event.clientY,
        targetIndex,
      }
    })
  }

  const finishLayerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!layerDrag || event.pointerId !== layerDrag.pointerId) {
      return
    }

    const targetIndex = layerDrag.isDragging ? getLayerDragTargetIndex(layerDrag, event.clientY) : layerDrag.sourceIndex
    const visualOrder = layerDrag.isDragging ? getLayerDragOrder(layerDrag, targetIndex) : layerDrag.sourceOrder
    const shouldSelectLayer = !layerDrag.isDragging
    setLayerDrag(null)

    if (shouldSelectLayer) {
      setVisualLayer(null)
      setLayer(layerDrag.layer)
      return
    }

    if (visualOrder.join('|') !== layerDrag.sourceOrder.join('|')) {
      const reorderedLayer = getOrderedLayerMap(visualOrder).get(layerDrag.layer) ?? layerDrag.layer
      setLayerRelease({ layer: reorderedLayer, phase: 'hold' })
      reorderLayers(visualOrder)
      setVisualLayer(null)
      layerReleaseFrameRef.current = window.requestAnimationFrame(() => {
        setLayerRelease({ layer: reorderedLayer, phase: 'settle' })
        layerReleaseFrameRef.current = window.requestAnimationFrame(() => {
          setLayerRelease(null)
          layerReleaseFrameRef.current = null
        })
      })
    }
  }

  const isPointInRect = (rect: DOMRect | undefined, clientX: number, clientY: number) => {
    if (!rect) {
      return false
    }

    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }

  const isPointInTrash = (clientX: number, clientY: number) => {
    return isPointInRect(trashRef.current?.getBoundingClientRect(), clientX, clientY)
  }

  const isPointInStorageDropTarget = (clientX: number, clientY: number) => {
    return (
      isPointInTrash(clientX, clientY) ||
      (isTrashOpen && isPointInRect(storagePanelRef.current?.getBoundingClientRect(), clientX, clientY))
    )
  }

  const isPointInStorageSurface = (clientX: number, clientY: number) => {
    if (isTrashOpen && isPointInRect(storagePanelRef.current?.getBoundingClientRect(), clientX, clientY)) {
      return true
    }

    const element = document.elementFromPoint(clientX, clientY)
    return Boolean(element?.closest('.deleted-panel, .trash-bucket'))
  }

  const getWorkspacePoint = (clientX: number, clientY: number) => {
    const workspaceBox = workspaceRef.current?.getBoundingClientRect()

    if (!workspaceBox) {
      return { x: clientX, y: clientY }
    }

    return {
      x: clientX - workspaceBox.left,
      y: clientY - workspaceBox.top,
    }
  }

  const rememberCanvasPoint = (clientX: number, clientY: number) => {
    lastCanvasPointRef.current = screenToWorld(getWorkspacePoint(clientX, clientY), viewport)
  }

  const registerEditor = useCallback((boxId: string, editor: Editor) => {
    editorsRef.current.set(boxId, editor)
  }, [])

  const unregisterEditor = useCallback((boxId: string) => {
    editorsRef.current.delete(boxId)
  }, [])

  const hasHighlightedTextInSelectedCell = () => {
    if (!selectedBoxId) {
      return false
    }

    const editor = editorsRef.current.get(selectedBoxId)
    return Boolean(editor && !editor.state.selection.empty)
  }

  const focusCellEditor = (boxId: string) => {
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-box-id="${boxId}"] .ProseMirror`)?.focus()
    }, 0)
  }

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

  const showTextSizeDial = (dial: Omit<TextSizeDialState, 'isExiting'>) => {
    if (textSizeWheelTimerRef.current !== null) {
      window.clearTimeout(textSizeWheelTimerRef.current)
      textSizeWheelTimerRef.current = null
    }
    if (textSizeWheelExitTimerRef.current !== null) {
      window.clearTimeout(textSizeWheelExitTimerRef.current)
      textSizeWheelExitTimerRef.current = null
    }

    setTextSizeDial({ ...dial, isExiting: false })
  }

  const scheduleTextSizeUiHide = (delay = 520) => {
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
  }

  const showFontSizeRowLabels = (
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
  }

  const cloneCellForUndo = (box: CellModel): CellModel => ({
    ...box,
    content: typeof structuredClone === 'function'
      ? structuredClone(box.content)
      : JSON.parse(JSON.stringify(box.content)),
  })

  const deselectCurrentBox = () => {
    if (!selectedBoxId) {
      return
    }

    const selectedBox = boxes.find((box) => box.id === selectedBoxId)
    const selectedEditor = editorsRef.current.get(selectedBoxId)

    if (selectedBox && isEmptyDocumentContent(selectedBox.content)) {
      removeBox(selectedBox.id)
      return
    }

    if (selectedEditor) {
      selectedEditor
        .chain()
        .setTextSelection(selectedEditor.state.selection.to)
        .blur()
        .run()
    }

    selectBox(null)
  }

  const selectBoxWithEmptyCleanup = (id: string | null) => {
    if (!id) {
      deselectCurrentBox()
      return
    }

    if (selectedBoxId && selectedBoxId !== id) {
      const selectedBox = boxes.find((box) => box.id === selectedBoxId)

      if (selectedBox && isEmptyDocumentContent(selectedBox.content)) {
        removeBox(selectedBox.id)
      }
    }

    selectBox(id)
  }

  useEffect(() => {
    const handleUndoDeletedCell = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLocaleLowerCase() !== 'z' ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const target = event.target instanceof HTMLElement ? event.target : null

      if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
        return
      }

      const action = deletedUndoStackRef.current.pop()

      if (!action) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (action.type === 'cell') {
        restoreRemovedBox(cloneCellForUndo(action.cell))
        focusCellEditor(action.cell.id)
        return
      }

      restoreLayer(
        action.layer,
        action.boxes.map(cloneCellForUndo),
        action.title,
      )
    }

    window.addEventListener('keydown', handleUndoDeletedCell, { capture: true })

    return () => {
      window.removeEventListener('keydown', handleUndoDeletedCell, { capture: true })
    }
  })

  const startCanvasPan = (pointerId: number, clientX: number, clientY: number) => {
    const workspace = workspaceRef.current
    workspace?.setPointerCapture(pointerId)
    if (movementTimerRef.current !== null) {
      window.clearTimeout(movementTimerRef.current)
    }
    dragRef.current = {
      type: 'canvas',
      pointerId,
      lastX: clientX,
      lastY: clientY,
    }
    setIsCanvasMoving(true)
    setIsPanning(true)
  }

  const startCanvasPanFromPointer = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    rememberCanvasPoint(event.clientX, event.clientY)
    deselectCurrentBox()
    startCanvasPan(event.pointerId, event.clientX, event.clientY)
  }

  const moveActiveDrag = (clientX: number, clientY: number) => {
    const drag = dragRef.current

    if (drag?.type === 'canvas') {
      panBy(clientX - drag.lastX, clientY - drag.lastY)
      dragRef.current = {
        ...drag,
        lastX: clientX,
        lastY: clientY,
      }
      return
    }

    if (drag?.type === 'box') {
      const dx = (clientX - drag.startX) / viewport.zoom
      const dy = (clientY - drag.startY) / viewport.zoom
      const moved = Math.hypot(clientX - drag.startX, clientY - drag.startY)

      setIsTrashHot(isPointInStorageDropTarget(clientX, clientY))

      if (moved <= CLICK_DRIFT && draggedBoxId !== drag.boxId) {
        return
      }

      if (moved > CLICK_DRIFT && draggedBoxId !== drag.boxId) {
        setDraggedBoxId(drag.boxId)
      }

      updateBox(drag.boxId, {
        x: Math.round(drag.boxX + dx),
        y: Math.round(drag.boxY + dy),
      })
      return
    }

    if (drag?.type === 'storage') {
      setStorageDragPreview({
        boxId: drag.boxId,
        x: clientX,
        y: clientY,
      })
      return
    }

    if (drag?.type === 'resize') {
      const dx = (clientX - drag.startX) / viewport.zoom
      const dy = (clientY - drag.startY) / viewport.zoom
      updateBox(drag.boxId, {
        width: Math.round(Math.max(MIN_BOX_WIDTH, drag.width + dx)),
        height: Math.round(Math.max(MIN_BOX_HEIGHT, drag.height + dy)),
      })
      return
    }

    if (drag?.type === 'scale') {
      const dx = clientX - drag.startX
      const stepOffset = Math.round(dx / SIZE_PICKER_STEP_PX)
      const rawStepIndex = getFontStepIndexForOffset(drag.referenceSize, stepOffset)
      const minShrinkStepIndex = getMinShrinkStepIndex(drag.referenceSize, drag.textSegments)
      const maxGrowStepIndex = getMaxGrowStepIndex(drag.referenceSize, drag.textSegments)
      const stepIndex = Math.min(Math.max(rawStepIndex, minShrinkStepIndex), maxGrowStepIndex)
      const fontSize = FONT_SIZE_STEPS[stepIndex]
      const clampedStepOffset = getFontStepOffsetForIndex(drag.referenceSize, stepIndex)
      const movedSteps = clampedStepOffset !== 0
      const scale = movedSteps ? fontSize / drag.referenceSize : 1
      const minShrinkDx = getFontStepOffsetForIndex(drag.referenceSize, minShrinkStepIndex) * SIZE_PICKER_STEP_PX
      const maxGrowDx = getFontStepOffsetForIndex(drag.referenceSize, maxGrowStepIndex) * SIZE_PICKER_STEP_PX
      const visualDx = Math.min(Math.max(dx, minShrinkDx), maxGrowDx)

      showTextSizeDial({
        boxId: drag.boxId,
        x: drag.controlX,
        y: drag.controlY,
        height: drag.controlHeight + SIZE_PICKER_HEIGHT_PADDING,
        rotation: visualDx * 0.8,
      })

      if (drag.editor && drag.textSegments.length > 0) {
        if (movedSteps) {
          applyScaledFontSegments(drag.editor, drag.textSegments, scale)
        }
        showFontSizeRowLabels(drag.boxId, drag.editor, drag.textSegments, scale)
      }

      if (movedSteps && (drag.scaleBoxDefault || drag.textSegments.length === 0)) {
        updateBox(drag.boxId, { fontSize })
      }
      return
    }
  }

  const finishActiveDrag = (clientX: number, clientY: number) => {
    const drag = dragRef.current

    if (!drag) {
      return false
    }

    const deletedBoxId = drag.type === 'box' && isPointInStorageDropTarget(clientX, clientY) ? drag.boxId : null
    const restoredBoxId = drag.type === 'storage' ? drag.boxId : null
    dragRef.current = null
    setDraggedBoxId(null)
    setIsPanning(false)
    setIsTrashHot(false)
    scheduleTextSizeUiHide(0)
    setStorageDragPreview(null)

    if (drag.type === 'canvas' || drag.type === 'box') {
      settleCanvasMovement()
    }

    if (deletedBoxId) {
      deleteBox(deletedBoxId)
    }

    if (restoredBoxId && workspaceRef.current && !isPointInStorageSurface(clientX, clientY)) {
      const workspacePoint = getWorkspacePoint(clientX, clientY)
      const worldPoint = screenToWorld(workspacePoint, viewport)
      restoreBox(restoredBoxId, worldPoint, activeLayer)
      setIsTrashOpen(false)
    }

    return true
  }

  const settleCanvasMovement = (delay = 360) => {
    if (movementTimerRef.current !== null) {
      window.clearTimeout(movementTimerRef.current)
    }

    movementTimerRef.current = window.setTimeout(() => {
      setIsCanvasMoving(false)
      movementTimerRef.current = null
    }, delay)
  }

  const stopSearchBrightnessRelease = () => {
    if (searchBrightnessReleaseTimerRef.current !== null) {
      window.clearTimeout(searchBrightnessReleaseTimerRef.current)
      searchBrightnessReleaseTimerRef.current = null
    }
    if (searchBrightnessReleaseRef.current !== null) {
      window.cancelAnimationFrame(searchBrightnessReleaseRef.current)
      searchBrightnessReleaseRef.current = null
    }
  }

  const resetSearchBrightness = () => {
    stopSearchBrightnessRelease()
    setSearchBrightnessPulse(0)
    setSearchFocusLayer(null)
  }

  const releaseSearchBrightness = (delay = 0, startPulse = searchBrightnessPulse) => {
    stopSearchBrightnessRelease()

    const startRelease = () => {
      searchBrightnessReleaseTimerRef.current = null
      const startTime = performance.now()

      const animate = (time: number) => {
        const progress = Math.min(1, (time - startTime) / DOT_MATRIX_FADE_MS)
        const eased = CSS_EASE(progress)

        setSearchBrightnessPulse(startPulse * (1 - eased))

        if (progress < 1) {
          searchBrightnessReleaseRef.current = window.requestAnimationFrame(animate)
          return
        }

        searchBrightnessReleaseRef.current = null
        setSearchBrightnessPulse(0)
        setSearchFocusLayer(null)
      }

      searchBrightnessReleaseRef.current = window.requestAnimationFrame(animate)
    }

    if (delay > 0) {
      searchBrightnessReleaseTimerRef.current = window.setTimeout(startRelease, delay)
      return
    }

    startRelease()
  }

  const moveToOrigin = () => {
    if (originAnimationRef.current !== null) {
      window.cancelAnimationFrame(originAnimationRef.current)
    }
    if (searchJumpAnimationRef.current !== null) {
      window.cancelAnimationFrame(searchJumpAnimationRef.current)
      searchJumpAnimationRef.current = null
    }
    setVisualLayer(null)
    resetSearchBrightness()
    setIsSearchJumping(false)

    const start = viewport
    const target = {
      x: workspaceSize.width / 2,
      y: workspaceSize.height / 2,
      zoom: viewport.zoom,
    }
    const duration = 620
    const startTime = performance.now()

    setIsCanvasMoving(true)

    const animate = (time: number) => {
      const progress = Math.min(1, (time - startTime) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)

      setViewport({
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        zoom: start.zoom,
      })

      if (progress < 1) {
        originAnimationRef.current = window.requestAnimationFrame(animate)
        return
      }

      originAnimationRef.current = null
      settleCanvasMovement()
    }

    originAnimationRef.current = window.requestAnimationFrame(animate)
  }

  const jumpToCell = (cell: CellModel) => {
    if (originAnimationRef.current !== null) {
      window.cancelAnimationFrame(originAnimationRef.current)
      originAnimationRef.current = null
    }
    if (searchJumpAnimationRef.current !== null) {
      window.cancelAnimationFrame(searchJumpAnimationRef.current)
      searchJumpAnimationRef.current = null
    }
    setIsSearchJumping(false)
    resetSearchBrightness()

    const width = workspaceSize.width || window.innerWidth
    const height = workspaceSize.height || window.innerHeight
    const zoom = viewport.zoom
    const startViewport = viewport
    const targetViewport = {
      x: width / 2 - (cell.x + cell.width / 2) * zoom,
      y: height / 2 - (cell.y + cell.height / 2) * zoom,
      zoom,
    }
    const startLayer = activeLayer
    const layerDistance = Math.abs(cell.layer - startLayer)
    const duration = getSearchJumpDuration(startViewport, targetViewport, layerDistance, settings)
    const startTime = performance.now()

    selectBoxWithEmptyCleanup(cell.id)

    if (duration === 0) {
      setVisualLayer(cell.layer)
      resetSearchBrightness()
      setLayerAndSelect(cell.layer, cell.id)
      setViewport(targetViewport)
      window.requestAnimationFrame(() => setVisualLayer(null))
      settleCanvasMovement(120)

      window.setTimeout(() => {
        document.querySelector<HTMLElement>(`[data-box-id="${cell.id}"] .ProseMirror`)?.focus()
      }, 0)
      return
    }

    setVisualLayer(startLayer)
    stopSearchBrightnessRelease()
    setSearchBrightnessPulse(0)
    setSearchFocusLayer(layerDistance > 0 ? cell.layer : null)
    setIsSearchJumping(true)
    setIsCanvasMoving(true)

    const animate = (time: number) => {
      const progress = Math.min(1, (time - startTime) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      const nextLayer = startLayer + (cell.layer - startLayer) * eased
      const brightnessPulse = layerDistance > 0 ? eased : 0

      setViewport({
        x: startViewport.x + (targetViewport.x - startViewport.x) * eased,
        y: startViewport.y + (targetViewport.y - startViewport.y) * eased,
        zoom,
      })
      setVisualLayer(nextLayer)
      setSearchBrightnessPulse(brightnessPulse)

      if (progress < 1) {
        searchJumpAnimationRef.current = window.requestAnimationFrame(animate)
        return
      }

      searchJumpAnimationRef.current = null
      setVisualLayer(cell.layer)
      setSearchBrightnessPulse(layerDistance > 0 ? 1 : 0)
      setSearchFocusLayer(layerDistance > 0 ? cell.layer : null)
      setLayerAndSelect(cell.layer, cell.id)
      setViewport(targetViewport)
      window.requestAnimationFrame(() => {
        setVisualLayer(null)
        window.requestAnimationFrame(() => {
          setIsSearchJumping(false)
        })
      })
      releaseSearchBrightness(SEARCH_SETTLE_MS, layerDistance > 0 ? 1 : 0)
      settleCanvasMovement(SEARCH_SETTLE_MS)

      window.setTimeout(() => {
        document.querySelector<HTMLElement>(`[data-box-id="${cell.id}"] .ProseMirror`)?.focus()
      }, 0)
    }

    searchJumpAnimationRef.current = window.requestAnimationFrame(animate)
  }

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (dragRef.current) {
        moveActiveDrag(event.clientX, event.clientY)
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      finishActiveDrag(event.clientX, event.clientY)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  })

  useEffect(() => {
    const cellClipboardType = 'application/x-notarise-cell'

    const shouldUseCellClipboard = (event: ClipboardEvent) => {
      if (!selectedBoxId || hasHighlightedTextInSelectedCell()) {
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
        const editor = editorsRef.current.get(selectedBoxId)

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

  const handleWorkspacePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    rememberCanvasPoint(event.clientX, event.clientY)
    const target = event.target as HTMLElement
    if (target.closest('.text-box')) {
      return
    }

    if (event.button === 1) {
      event.preventDefault()
      deselectCurrentBox()
      startCanvasPan(event.pointerId, event.clientX, event.clientY)
      return
    }

    if (event.button !== 0) {
      return
    }

    const timer = window.setTimeout(() => {
      if (!pressRef.current) {
        return
      }
      startCanvasPan(event.pointerId, event.clientX, event.clientY)
      pressRef.current = null
    }, LONG_PRESS_MS)

    pressRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer,
    }
  }

  const startStorageDrag = (event: ReactPointerEvent<HTMLElement>, box: StoredCellModel) => {
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      type: 'storage',
      pointerId: event.pointerId,
      boxId: box.id,
    }
    setStorageDragPreview({
      boxId: box.id,
      x: event.clientX,
      y: event.clientY,
    })
    setIsCanvasMoving(true)
  }

  const handleWorkspacePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    rememberCanvasPoint(event.clientX, event.clientY)

    if (dragRef.current) {
      return
    }

    const press = pressRef.current
    if (!press) {
      return
    }

    const moved = Math.hypot(event.clientX - press.startX, event.clientY - press.startY)
    if (moved > CLICK_DRIFT) {
      window.clearTimeout(press.timer)
      startCanvasPan(press.pointerId, press.startX, press.startY)
      pressRef.current = null
    }
  }

  const handleWorkspacePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (finishActiveDrag(event.clientX, event.clientY)) {
      return
    }

    const press = pressRef.current
    if (press) {
      window.clearTimeout(press.timer)
      const drift = Math.hypot(event.clientX - press.startX, event.clientY - press.startY)
      pressRef.current = null

      if (drift <= CLICK_DRIFT) {
        if (selectedBoxId) {
          deselectCurrentBox()
          return
        }

        const workspacePoint = getWorkspacePoint(event.clientX, event.clientY)
        const worldPoint = screenToWorld(workspacePoint, viewport)
        const id = createBox(worldPoint)
        window.setTimeout(() => {
          document.querySelector<HTMLElement>(`[data-box-id="${id}"] .ProseMirror`)?.focus()
        }, 0)
      }
    }
  }

  const getScaleControlPoint = (box: CellModel) => {
    const scaleHandle = document.querySelector<HTMLElement>(`[data-box-id="${box.id}"] .scale-handle`)

    if (scaleHandle) {
      const controlBox = scaleHandle.getBoundingClientRect()

      return {
        x: controlBox.left + controlBox.width / 2,
        y: controlBox.top + controlBox.height / 2,
        height: controlBox.height,
      }
    }

    const workspaceBox = workspaceRef.current?.getBoundingClientRect()

    if (!workspaceBox) {
      return {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        height: SCALE_CONTROL_HEIGHT,
      }
    }

    const controlScale = (1 + viewport.zoom) / (2 * viewport.zoom)
    const controlCenterOffsetX = (CELL_CONTROL_INSET + SCALE_CONTROL_WIDTH / 2) * controlScale
    const controlCenterOffsetY = (CELL_CONTROL_INSET + SCALE_CONTROL_HEIGHT / 2) * controlScale

    return {
      x: workspaceBox.left + viewport.x + (box.x + box.width - controlCenterOffsetX) * viewport.zoom,
      y: workspaceBox.top + viewport.y + (box.y + controlCenterOffsetY) * viewport.zoom,
      height: SCALE_CONTROL_HEIGHT * controlScale * viewport.zoom,
    }
  }

  const applyTextSizeWheel = (direction: number) => {
    if (!selectedBoxId) {
      return false
    }

    const box = boxes.find((candidate) => candidate.id === selectedBoxId)
    const editor = editorsRef.current.get(selectedBoxId)

    if (!box || !editor) {
      return false
    }

    const fallbackSize = box.fontSize ?? 12
    const selectedSegments = captureSelectedRowFontSegments(editor, fallbackSize)
    const isSelectionResize = selectedSegments.length > 0
    const textSegments = isSelectionResize
      ? selectedSegments
      : captureDocumentFontSegments(editor, fallbackSize)
    const referenceSize = textSegments.length > 0
      ? getWeightedSegmentFontSize(textSegments, fallbackSize)
      : fallbackSize
    const currentIndex = getNearestFontStepIndex(referenceSize)
    const minShrinkStepIndex = getMinShrinkStepIndex(referenceSize, textSegments)
    const maxGrowStepIndex = getMaxGrowStepIndex(referenceSize, textSegments)
    const nextIndex = Math.min(
      Math.max(currentIndex + direction, minShrinkStepIndex),
      maxGrowStepIndex,
    )
    const movedSteps = nextIndex - currentIndex
    let labelScale = 1

    if (movedSteps !== 0) {
      const fontSize = FONT_SIZE_STEPS[nextIndex]
      const scale = fontSize / referenceSize
      labelScale = scale

      if (textSegments.length > 0) {
        applyScaledFontSegments(editor, textSegments, scale)
      }

      if (!isSelectionResize || textSegments.length === 0) {
        updateBox(box.id, { fontSize })
      }
    }

    const controlPoint = getScaleControlPoint(box)
    textSizeWheelRotationRef.current += movedSteps * 28
    showTextSizeDial({
      boxId: box.id,
      x: controlPoint.x,
      y: controlPoint.y,
      height: controlPoint.height + SIZE_PICKER_HEIGHT_PADDING,
      rotation: textSizeWheelRotationRef.current,
    })

    if (textSegments.length > 0) {
      showFontSizeRowLabels(box.id, editor, textSegments, labelScale)
    }

    scheduleTextSizeUiHide()

    return true
  }

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsCanvasMoving(true)
    settleCanvasMovement(900)

    if (event.ctrlKey || event.metaKey) {
      textSizeWheelDeltaRef.current = 0
      const direction = event.deltaY > 0 ? -1 : 1
      const nextLayer = clampNavigableLayer(activeLayer + direction)
      const drag = dragRef.current

      if (drag?.type === 'box') {
        updateBox(drag.boxId, { layer: nextLayer })
        setLayer(nextLayer)
        selectBox(drag.boxId)
        return
      }

      stepLayer(direction)
      return
    }

    if (event.shiftKey) {
      const threshold = 42
      const wheelDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
      textSizeWheelDeltaRef.current += wheelDelta

      if (Math.abs(textSizeWheelDeltaRef.current) < threshold) {
        return
      }

      const direction = textSizeWheelDeltaRef.current < 0 ? 1 : -1
      const didResize = applyTextSizeWheel(direction)
      textSizeWheelDeltaRef.current = didResize
        ? textSizeWheelDeltaRef.current % threshold
        : 0
      return
    }

    textSizeWheelDeltaRef.current = 0
    zoomAt(getWorkspacePoint(event.clientX, event.clientY), event.deltaY)
  }

  useEffect(() => {
    const editorShell = editorShellRef.current

    if (!editorShell) {
      return
    }

    editorShell.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      editorShell.removeEventListener('wheel', handleWheel)
    }
  })

  useEffect(() => {
    const preventBrowserZoom = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
      }
    }

    window.addEventListener('wheel', preventBrowserZoom, { passive: false, capture: true })

    return () => {
      window.removeEventListener('wheel', preventBrowserZoom, { capture: true })
    }
  }, [])

  const startBoxDrag = (event: ReactPointerEvent<HTMLButtonElement>, box: CellModel) => {
    if (event.button === 1) {
      startCanvasPanFromPointer(event)
      return
    }

    event.preventDefault()
    event.stopPropagation()
    selectBoxWithEmptyCleanup(box.id)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      type: 'box',
      pointerId: event.pointerId,
      boxId: box.id,
      startX: event.clientX,
      startY: event.clientY,
      boxX: box.x,
      boxY: box.y,
    }
    setIsCanvasMoving(true)
    setIsTrashHot(isPointInStorageDropTarget(event.clientX, event.clientY))
  }

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>, box: CellModel) => {
    if (event.button === 1) {
      startCanvasPanFromPointer(event)
      return
    }

    event.preventDefault()
    event.stopPropagation()
    selectBoxWithEmptyCleanup(box.id)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      type: 'resize',
      pointerId: event.pointerId,
      boxId: box.id,
      startX: event.clientX,
      startY: event.clientY,
      width: box.width,
      height: box.height,
    }
  }

  const deleteCellWithConfirmation = (box: CellModel) => {
    setConfirmationRequest({
      title: 'Delete cell?',
      confirmLabel: 'Delete',
      onConfirm: () => {
        deletedUndoStackRef.current.push({
          type: 'cell',
          cell: cloneCellForUndo(box),
        })
        removeBox(box.id)
      },
    })
  }

  const deleteActiveLayerWithConfirmation = () => {
    const layerBoxes = boxes
      .filter((box) => box.layer === activeLayer)
      .map(cloneCellForUndo)
    const layerTitle = layerTitles[activeLayer]

    if (layerBoxes.length === 0 && !layerTitle?.trim()) {
      setLayer(activeLayer > layerBounds.bottom ? activeLayer - 1 : activeLayer + 1)
      return
    }

    setConfirmationRequest({
      title: 'Delete layer?',
      confirmLabel: 'Delete',
      onConfirm: () => {
        deletedUndoStackRef.current.push({
          type: 'layer',
          layer: activeLayer,
          title: layerTitle,
          boxes: layerBoxes,
        })
        setVisualLayer(null)
        removeLayer(activeLayer)
      },
    })
  }

  const permanentlyDeleteCellWithConfirmation = (id: string) => {
    setConfirmationRequest({
      title: 'Permanently delete cell?',
      message: 'This removes the cell from Storage and cannot be undone.',
      confirmLabel: 'Delete forever',
      onConfirm: () => permanentlyDeleteBox(id),
    })
  }

  const exportDocument = () => {
    const document = createDocumentSnapshot(useDocumentStore.getState())
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

    link.href = url
    link.download = `notarise-${stamp}.notarise`
    link.click()
    URL.revokeObjectURL(url)
  }

  const importDocument = async (file: File) => {
    const document = parseNotariseDocument(await readTextFile(file))

    setConfirmationRequest({
      title: 'Import document?',
      message: 'This replaces the current canvas with the selected file.',
      confirmLabel: 'Import',
      onConfirm: () => {
        deletedUndoStackRef.current = []
        setTextSizeDial(null)
        setFontSizeRowLabels([])
        setStorageDragPreview(null)
        setVisualLayer(null)
        hydrateDocument(withUpdatedAt(document))
      },
    })
  }

  const confirmRequestedAction = () => {
    if (!confirmationRequest) {
      return
    }

    const action = confirmationRequest.onConfirm
    setConfirmationRequest(null)
    action()
  }

  const startScale = (event: ReactPointerEvent<HTMLButtonElement>, box: CellModel, editor: Editor | null) => {
    if (event.button === 1) {
      startCanvasPanFromPointer(event)
      return
    }

    event.preventDefault()
    event.stopPropagation()
    selectBoxWithEmptyCleanup(box.id)
    event.currentTarget.setPointerCapture(event.pointerId)
    const selectedSegments = editor ? captureSelectedRowFontSegments(editor, box.fontSize ?? 12) : []
    const textSegments = selectedSegments.length > 0
      ? selectedSegments
      : editor ? captureDocumentFontSegments(editor, box.fontSize ?? 12) : []
    const referenceSize = selectedSegments.length > 0
      ? getWeightedSegmentFontSize(selectedSegments, box.fontSize ?? 12)
      : box.fontSize ?? 12
    const controlBox = event.currentTarget.getBoundingClientRect()
    const controlX = controlBox.left + controlBox.width / 2
    const controlY = controlBox.top + controlBox.height / 2
    const controlHeight = controlBox.height

    dragRef.current = {
      type: 'scale',
      pointerId: event.pointerId,
      boxId: box.id,
      startX: event.clientX,
      startY: event.clientY,
      fontSize: box.fontSize ?? 12,
      referenceSize,
      startStepIndex: getNearestFontStepIndex(referenceSize),
      controlX,
      controlY,
      controlHeight,
      textSegments,
      editor,
      scaleBoxDefault: selectedSegments.length === 0,
    }
    showTextSizeDial({
      boxId: box.id,
      x: controlX,
      y: controlY,
      height: controlHeight + SIZE_PICKER_HEIGHT_PADDING,
      rotation: 0,
    })
    if (editor && textSegments.length > 0) {
      showFontSizeRowLabels(box.id, editor, textSegments, 1)
    }
  }

  const setTodoCheckedFromPanel = (todo: TodoItem, checked: boolean) => {
    const currentCell = useDocumentStore.getState().boxes.find((box) => box.id === todo.cell.id)

    if (!currentCell) {
      return
    }

    updateBox(currentCell.id, {
      content: setTodoChecked(currentCell.content, todo.path, checked),
    })
  }

  const dotSpacing = DOT_SPACING * viewport.zoom
  const activeDragType = dragRef.current?.type
  const shouldSnapCanvas = !isPanning && !isSearchJumping && activeDragType !== 'canvas'
  const surfaceX = shouldSnapCanvas ? snapToDevicePixel(viewport.x) : viewport.x
  const surfaceY = shouldSnapCanvas ? snapToDevicePixel(viewport.y) : viewport.y
  const workspaceCenterX = (workspaceSize.width || window.innerWidth) / 2
  const workspaceCenterY = (workspaceSize.height || window.innerHeight) / 2
  const viewportCenterWorldX = (workspaceCenterX - surfaceX) / viewport.zoom
  const viewportCenterWorldY = (workspaceCenterY - surfaceY) / viewport.zoom
  const draggedBox = draggedBoxId ? boxes.find((box) => box.id === draggedBoxId) ?? null : null
  const workspaceRect = workspaceRef.current?.getBoundingClientRect()
  const draggedBoxScreenPoint = draggedBox && workspaceRect
    ? {
        x: workspaceRect.left + surfaceX + draggedBox.x * viewport.zoom,
        y: workspaceRect.top + surfaceY + draggedBox.y * viewport.zoom,
      }
    : null
  const rawCompassAngle = Math.atan2(
    viewport.x - workspaceSize.width / 2,
    -(viewport.y - workspaceSize.height / 2),
  ) * (180 / Math.PI)
  const compassDelta = ((((rawCompassAngle - compassAngleRef.current) % 360) + 540) % 360) - 180
  compassAngleRef.current += compassDelta
  const compassAngle = compassAngleRef.current

  return (
    <main className={`app ${isPanning ? 'is-panning' : ''} ${isCanvasMoving ? 'is-canvas-moving' : ''} ${isSearchJumping ? 'is-search-jumping' : ''} ${selectedBoxId ? 'has-selected-cell' : ''} ${draggedBoxId ? 'is-cell-dragging' : ''}`}>
      <header className="toolbar" aria-label="Document controls">
        <div className="brand">
          <ScrollText size={18} aria-hidden="true" />
          <span>Notarise</span>
        </div>
        <div className="layer-title-cluster">
          <span className="layer-number-prefix">{activeLayer}</span>
          <label className="layer-title-field">
            <input
              value={layerTitles[activeLayer] ?? ''}
              placeholder={getLayerTitle(activeLayer)}
              aria-label="Layer title"
              onChange={(event) => setLayerTitle(activeLayer, event.target.value)}
            />
          </label>
          <span className="zoom-readout">{Math.round(viewport.zoom * 100)}%</span>
        </div>
        <button
          className={`icon-button ${isSettingsOpen ? 'is-active' : ''}`}
          type="button"
          onClick={() => setIsSettingsOpen((open) => !open)}
          title="Settings"
          aria-label="Settings"
          aria-pressed={isSettingsOpen}
        >
          <Settings size={18} aria-hidden="true" />
        </button>
      </header>

      <div ref={editorShellRef} className="editor-shell">
        <button
          ref={trashRef}
          className={`trash-bucket ${isTrashOpen ? 'is-open' : ''} ${isTrashHot ? 'is-hot' : ''}`}
          type="button"
          onClick={() => setIsTrashOpen((open) => !open)}
          title="Storage"
          aria-label="Storage"
          aria-pressed={isTrashOpen}
        >
          {isTrashHot ? <PackageOpen size={25} aria-hidden="true" /> : <Package size={25} aria-hidden="true" />}
          {deletedBoxes.length > 0 && <span className="trash-count">{deletedBoxes.length}</span>}
        </button>

        <button
          className={`todo-bucket ${isTodoOpen ? 'is-open' : ''}`}
          type="button"
          onClick={() => setIsTodoOpen((open) => !open)}
          title="Todos"
          aria-label="Todos"
          aria-pressed={isTodoOpen}
        >
          <ListTodo size={25} aria-hidden="true" />
          {uncheckedTodoCount > 0 && <span className="trash-count">{uncheckedTodoCount}</span>}
        </button>

        <button
          className="origin-compass"
          type="button"
          onClick={moveToOrigin}
          title="Go to origin"
          aria-label="Go to origin"
        >
          <span className="compass-ring">
            {Array.from({ length: 8 }, (_, index) => (
              <span
                key={index}
                className="compass-tick"
                style={{ transform: `translate(-50%, -50%) rotate(${index * 45}deg) translateY(-17px)` }}
              />
            ))}
            <span
              className="compass-needle"
              style={{ transform: `translate(-50%, -50%) rotate(${compassAngle}deg)` }}
            >
              <span className="needle-red" />
              <span className="needle-tail" />
            </span>
          </span>
        </button>

        <button
          className="layer-delete-button"
          type="button"
          onClick={deleteActiveLayerWithConfirmation}
          title="Delete layer"
          aria-label={`Delete ${getLayerTitle(activeLayer)}`}
        >
          <Trash2 size={24} aria-hidden="true" />
        </button>

        <LayerRail
          layers={visibleLayerDots}
          activeLayer={visibleActiveLayer}
          dragState={layerDrag}
          releaseState={layerRelease}
          topCreateLayer={layerBounds.top + 1}
          bottomCreateLayer={layerBounds.bottom - 1}
          getLayerTitle={getLayerTitle}
          onCreateLayer={(layer) => {
            setVisualLayer(null)
            setLayer(layer)
          }}
          onPointerDown={startLayerDrag}
          onPointerMove={moveLayerDrag}
          onPointerUp={finishLayerDrag}
        />

        <section
          ref={workspaceRef}
          className="workspace"
          onPointerDown={handleWorkspacePointerDown}
          onPointerMove={handleWorkspacePointerMove}
          onPointerUp={handleWorkspacePointerUp}
          onPointerCancel={handleWorkspacePointerUp}
          aria-label="Open canvas document"
        >
          <div
            className="dot-matrix"
            aria-hidden="true"
            style={{
              backgroundPosition: `${viewport.x}px ${viewport.y}px`,
              backgroundSize: `${dotSpacing}px ${dotSpacing}px`,
            }}
          />
          <div
            className="surface-grid"
            style={{
              transform: `translate(${surfaceX}px, ${surfaceY}px) scale(${viewport.zoom})`,
            }}
          >
            <div className="page-guide" aria-hidden="true" />
            {boxes.map((box) => (
              <CanvasTextBox
                key={box.id}
                box={box}
                isSelected={selectedBoxId === box.id}
                activeLayer={activeLayer}
                frontLayer={frontLayer}
                displayLayer={layerPreviewMap?.get(box.layer) ?? box.layer}
                visualLayer={visualLayerRenderPosition}
                theme={theme}
                viewportZoom={viewport.zoom}
                viewportCenterWorldX={viewportCenterWorldX}
                viewportCenterWorldY={viewportCenterWorldY}
                layerPanDepth={settings.layerPanDepth}
                backgroundLayerBrightness={settings.backgroundLayerBrightness}
                backgroundLayerBlur={settings.backgroundLayerBlur}
                searchFocusLayer={searchFocusLayer}
                searchBrightnessPulse={searchBrightnessPulse}
                isDragging={draggedBoxId === box.id}
                onSelect={selectBoxWithEmptyCleanup}
                onStartDrag={startBoxDrag}
                onDelete={deleteCellWithConfirmation}
                onStartResize={startResize}
                onStartScale={startScale}
                onStartPan={startCanvasPanFromPointer}
                isScalingText={textSizeDial?.boxId === box.id}
                onEditorReady={registerEditor}
                onEditorDestroy={unregisterEditor}
              />
            ))}
          </div>
        </section>
      </div>

      <GlobalSearch
        cells={boxes}
        getLayerTitle={getLayerTitle}
        onActivate={deselectCurrentBox}
        onResultSelect={jumpToCell}
      />

      <SettingsPanel
        isOpen={isSettingsOpen}
        theme={theme}
        settings={settings}
        onClose={() => setIsSettingsOpen(false)}
        onThemeChange={setTheme}
        onSettingsChange={updateSettings}
        onResetSettings={resetSettings}
        onExportDocument={exportDocument}
        onImportDocument={importDocument}
      />

      <DeletedTextPanel
        deletedBoxes={deletedBoxes}
        isOpen={isTrashOpen}
        isDropTarget={isTrashHot}
        panelRef={storagePanelRef}
        onClose={() => setIsTrashOpen(false)}
        onStartDrag={startStorageDrag}
        onPermanentDelete={permanentlyDeleteCellWithConfirmation}
      />

      <TodoPanel
        cells={boxes}
        isOpen={isTodoOpen}
        getLayerTitle={getLayerTitle}
        onClose={() => setIsTodoOpen(false)}
        onTodoSelect={(cell) => {
          jumpToCell(cell)
          setIsTodoOpen(false)
        }}
        onTodoCheckChange={setTodoCheckedFromPanel}
      />

      {storageDragPreview && (
        <StorageDragPreview
          cell={deletedBoxes.find((box) => box.id === storageDragPreview.boxId) ?? null}
          x={storageDragPreview.x}
          y={storageDragPreview.y}
          zoom={viewport.zoom}
        />
      )}

      {draggedBox && draggedBoxScreenPoint && (
        <CanvasCellDragPreview
          cell={draggedBox}
          x={draggedBoxScreenPoint.x}
          y={draggedBoxScreenPoint.y}
          zoom={viewport.zoom}
        />
      )}

      {textSizeDial && (
        <TextSizeWheelPicker
          x={textSizeDial.x}
          y={textSizeDial.y}
          height={textSizeDial.height}
          rotation={textSizeDial.rotation}
          isExiting={textSizeDial.isExiting}
        />
      )}

      {textSizeDial && fontSizeRowLabels.length > 0 && (
        <div
          className={`font-size-row-labels ${textSizeDial.isExiting ? 'is-exiting' : ''}`}
          aria-hidden="true"
        >
          {fontSizeRowLabels.map((label) => (
            <span
              key={label.id}
              className="font-size-row-label"
              style={{
                left: label.x,
                top: label.y,
              }}
            >
              {label.size}
            </span>
          ))}
        </div>
      )}

      <ConfirmationDialog
        request={confirmationRequest}
        onCancel={() => setConfirmationRequest(null)}
        onConfirm={confirmRequestedAction}
        fadeMs={CONFIRMATION_UI_FADE_MS}
      />
    </main>
  )
}

