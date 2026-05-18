import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { Circle, Grip, Maximize2, Package, PackageOpen, ScrollText, Settings, Trash2, Type } from 'lucide-react'
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
  captureDocumentFontSegments,
  captureSelectedRowFontSegments,
  clampIndex,
  getMaxGrowStepIndex,
  getMinShrinkStepIndex,
  getNearestFontStepIndex,
  getWeightedSegmentFontSize,
  handleListDeletionKey,
  preserveFontSizeAfterEnter,
  startImageResizeCorrection,
} from './editorBehaviors'
import type { FontSizeSegment } from './editorBehaviors'
import { createEditorExtensions } from './editorConfig'
import { createImageDocumentContent, getImageFilesFromClipboard, isEmptyDocumentContent, readFileAsDataUrl } from './contentUtils'
import { DeletedTextPanel, StorageDragPreview } from './StoragePanel'
import { TextSizeWheelPicker } from './TextSizeWheel'
import { GlobalSearch } from './GlobalSearch'
import { SettingsPanel } from './SettingsPanel'
import { useDocumentPersistence } from './useDocumentPersistence'
import { createDocumentSnapshot, useDocumentStore, screenToWorld } from './store'
import type { CellModel, DocumentSettings, NotariseDocument, SearchAnimationPreset, StoredCellModel } from './store'

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

type ConfirmationRequest = {
  title: string
  message?: string
  confirmLabel: string
  onConfirm: () => void
}

type LayerDragState = {
  layer: number
  pointerId: number
  isDragging: boolean
  startY: number
  currentY: number
  rowHeight: number
  sourceOrder: number[]
  visualOrder: number[]
}

const SEARCH_ANIMATION_DURATIONS: Record<SearchAnimationPreset, { min: number; max: number }> = {
  normal: { min: 400, max: 1800 },
  instant: { min: 0, max: 0 },
}

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

  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.boxes)) {
    throw new Error('This does not look like a valid Notarise document.')
  }

  return parsed as NotariseDocument
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
  const updateBox = useDocumentStore((state) => state.updateBox)
  const deleteBox = useDocumentStore((state) => state.deleteBox)
  const removeBox = useDocumentStore((state) => state.removeBox)
  const restoreRemovedBox = useDocumentStore((state) => state.restoreRemovedBox)
  const restoreBox = useDocumentStore((state) => state.restoreBox)
  const permanentlyDeleteBox = useDocumentStore((state) => state.permanentlyDeleteBox)
  const hydrateDocument = useDocumentStore((state) => state.hydrateDocument)

  const editorShellRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const trashRef = useRef<HTMLButtonElement>(null)
  const editorsRef = useRef<Map<string, Editor>>(new Map())
  const copiedCellIdRef = useRef<string | null>(null)
  const deletedCellUndoStackRef = useRef<CellModel[]>([])
  const lastCanvasPointRef = useRef<{ x: number; y: number } | null>(null)
  const dragRef = useRef<DragMode>(null)
  const pressRef = useRef<PressState>(null)
  const movementTimerRef = useRef<number | null>(null)
  const originAnimationRef = useRef<number | null>(null)
  const searchJumpAnimationRef = useRef<number | null>(null)
  const textSizeWheelTimerRef = useRef<number | null>(null)
  const textSizeWheelRotationRef = useRef(0)
  const [isPanning, setIsPanning] = useState(false)
  const [isCanvasMoving, setIsCanvasMoving] = useState(false)
  const [isSearchJumping, setIsSearchJumping] = useState(false)
  const [isTrashOpen, setIsTrashOpen] = useState(false)
  const [isTrashHot, setIsTrashHot] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [visualLayer, setVisualLayer] = useState<number | null>(null)
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 })
  const [textSizeDial, setTextSizeDial] = useState<{
    boxId: string
    x: number
    y: number
    height: number
    rotation: number
  } | null>(null)
  const [storageDragPreview, setStorageDragPreview] = useState<{
    boxId: string
    x: number
    y: number
  } | null>(null)
  const [confirmationRequest, setConfirmationRequest] = useState<ConfirmationRequest | null>(null)
  const [layerDrag, setLayerDrag] = useState<LayerDragState | null>(null)

  useDocumentPersistence()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

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
      if (textSizeWheelTimerRef.current !== null) {
        window.clearTimeout(textSizeWheelTimerRef.current)
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
      layerSet.add(Number(layer))
    })
    layerSet.add(activeLayer)
    return [...layerSet].sort((a, b) => b - a)
  }, [activeLayer, boxes, layerTitles])

  const layerRenderPosition = visualLayer ?? activeLayer
  const visibleActiveLayer = Math.round(layerRenderPosition)

  const getLayerTitle = (layer: number) => {
    return layerTitles[layer]?.trim() || `Layer ${layer}`
  }

  const getLayerDragOrder = (drag: LayerDragState, clientY: number) => {
    const draggedIndex = drag.sourceOrder.indexOf(drag.layer)

    if (draggedIndex === -1) {
      return drag.sourceOrder
    }

    const rowStep = Math.max(1, drag.rowHeight + 6)
    const offsetRows = Math.round((clientY - drag.startY) / rowStep)
    const targetIndex = Math.min(Math.max(draggedIndex + offsetRows, 0), drag.sourceOrder.length - 1)
    const nextOrder = drag.sourceOrder.filter((layer) => layer !== drag.layer)
    nextOrder.splice(targetIndex, 0, drag.layer)

    return nextOrder
  }

  const startLayerDrag = (event: ReactPointerEvent<HTMLButtonElement>, layer: number) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rowHeight = event.currentTarget.getBoundingClientRect().height
    setLayerDrag({
      layer,
      pointerId: event.pointerId,
      isDragging: false,
      startY: event.clientY,
      currentY: event.clientY,
      rowHeight,
      sourceOrder: visibleLayerDots,
      visualOrder: visibleLayerDots,
    })
  }

  const moveLayerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    setLayerDrag((drag) => {
      if (!drag || event.pointerId !== drag.pointerId) {
        return drag
      }

      const isDragging = drag.isDragging || Math.abs(event.clientY - drag.startY) >= CLICK_DRIFT
      const visualOrder = isDragging ? getLayerDragOrder(drag, event.clientY) : drag.sourceOrder

      return {
        ...drag,
        isDragging,
        currentY: event.clientY,
        visualOrder,
      }
    })
  }

  const finishLayerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!layerDrag || event.pointerId !== layerDrag.pointerId) {
      return
    }

    const visualOrder = layerDrag.isDragging ? getLayerDragOrder(layerDrag, event.clientY) : layerDrag.sourceOrder
    const shouldSelectLayer = !layerDrag.isDragging
    setLayerDrag(null)

    if (shouldSelectLayer) {
      setVisualLayer(null)
      setLayer(layerDrag.layer)
      return
    }

    if (visualOrder.join('|') !== layerDrag.sourceOrder.join('|')) {
      reorderLayers(visualOrder)
      setVisualLayer(null)
    }
  }

  const isPointInTrash = (clientX: number, clientY: number) => {
    const trashBox = trashRef.current?.getBoundingClientRect()

    if (!trashBox) {
      return false
    }

    return (
      clientX >= trashBox.left &&
      clientX <= trashBox.right &&
      clientY >= trashBox.top &&
      clientY <= trashBox.bottom
    )
  }

  const isPointInStorageSurface = (clientX: number, clientY: number) => {
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

      const cell = deletedCellUndoStackRef.current.pop()

      if (!cell) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      restoreRemovedBox(cloneCellForUndo(cell))
      focusCellEditor(cell.id)
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
      setIsTrashHot(isPointInTrash(clientX, clientY))
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
      const rawStepIndex = clampIndex(drag.startStepIndex + stepOffset, FONT_SIZE_STEPS)
      const minShrinkStepIndex = getMinShrinkStepIndex(drag.referenceSize, drag.textSegments)
      const maxGrowStepIndex = getMaxGrowStepIndex(drag.referenceSize, drag.textSegments)
      const stepIndex = Math.min(Math.max(rawStepIndex, minShrinkStepIndex), maxGrowStepIndex)
      const fontSize = FONT_SIZE_STEPS[stepIndex]
      const scale = fontSize / drag.referenceSize
      const minShrinkDx = (minShrinkStepIndex - drag.startStepIndex) * SIZE_PICKER_STEP_PX
      const maxGrowDx = (maxGrowStepIndex - drag.startStepIndex) * SIZE_PICKER_STEP_PX
      const visualDx = Math.min(Math.max(dx, minShrinkDx), maxGrowDx)

      setTextSizeDial({
        boxId: drag.boxId,
        x: drag.controlX,
        y: drag.controlY,
        height: drag.controlHeight + SIZE_PICKER_HEIGHT_PADDING,
        rotation: visualDx * 0.8,
      })

      if (drag.editor && drag.textSegments.length > 0) {
        applyScaledFontSegments(drag.editor, drag.textSegments, scale)
      }

      if (drag.scaleBoxDefault || drag.textSegments.length === 0) {
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

    const deletedBoxId = drag.type === 'box' && isPointInTrash(clientX, clientY) ? drag.boxId : null
    const restoredBoxId = drag.type === 'storage' ? drag.boxId : null
    dragRef.current = null
    setIsPanning(false)
    setIsTrashHot(false)
    setTextSizeDial(null)
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

  const moveToOrigin = () => {
    if (originAnimationRef.current !== null) {
      window.cancelAnimationFrame(originAnimationRef.current)
    }
    if (searchJumpAnimationRef.current !== null) {
      window.cancelAnimationFrame(searchJumpAnimationRef.current)
      searchJumpAnimationRef.current = null
    }
    setVisualLayer(null)
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
    setIsSearchJumping(true)
    setIsCanvasMoving(true)

    const animate = (time: number) => {
      const progress = Math.min(1, (time - startTime) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      const nextLayer = startLayer + (cell.layer - startLayer) * eased

      setViewport({
        x: startViewport.x + (targetViewport.x - startViewport.x) * eased,
        y: startViewport.y + (targetViewport.y - startViewport.y) * eased,
        zoom,
      })
      setVisualLayer(nextLayer)

      if (progress < 1) {
        searchJumpAnimationRef.current = window.requestAnimationFrame(animate)
        return
      }

      searchJumpAnimationRef.current = null
      setVisualLayer(cell.layer)
      setLayerAndSelect(cell.layer, cell.id)
      setViewport(targetViewport)
      window.requestAnimationFrame(() => {
        setVisualLayer(null)
        window.requestAnimationFrame(() => setIsSearchJumping(false))
      })
      settleCanvasMovement(520)

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

    if (movedSteps !== 0) {
      const fontSize = FONT_SIZE_STEPS[nextIndex]
      const scale = fontSize / referenceSize

      if (textSegments.length > 0) {
        applyScaledFontSegments(editor, textSegments, scale)
      }

      if (!isSelectionResize || textSegments.length === 0) {
        updateBox(box.id, { fontSize })
      }
    }

    const controlPoint = getScaleControlPoint(box)
    textSizeWheelRotationRef.current += movedSteps * 28
    setTextSizeDial({
      boxId: box.id,
      x: controlPoint.x,
      y: controlPoint.y,
      height: controlPoint.height + SIZE_PICKER_HEIGHT_PADDING,
      rotation: textSizeWheelRotationRef.current,
    })

    if (textSizeWheelTimerRef.current !== null) {
      window.clearTimeout(textSizeWheelTimerRef.current)
    }

    textSizeWheelTimerRef.current = window.setTimeout(() => {
      setTextSizeDial(null)
      textSizeWheelTimerRef.current = null
    }, 520)

    return true
  }

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsCanvasMoving(true)
    settleCanvasMovement(900)

    if (event.ctrlKey || event.metaKey) {
      const direction = event.deltaY > 0 ? -1 : 1
      const nextLayer = activeLayer + direction
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
      applyTextSizeWheel(event.deltaY > 0 ? -1 : 1)
      return
    }

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
    setIsTrashHot(isPointInTrash(event.clientX, event.clientY))
  }

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>, box: CellModel) => {
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
        deletedCellUndoStackRef.current.push(cloneCellForUndo(box))
        removeBox(box.id)
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
        deletedCellUndoStackRef.current = []
        setTextSizeDial(null)
        setStorageDragPreview(null)
        setVisualLayer(null)
        hydrateDocument({
          ...document,
          updatedAt: Date.now(),
        })
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
    setTextSizeDial({
      boxId: box.id,
      x: controlX,
      y: controlY,
      height: controlHeight + SIZE_PICKER_HEIGHT_PADDING,
      rotation: 0,
    })
  }

  const dotSpacing = DOT_SPACING * viewport.zoom
  const compassAngle = Math.atan2(
    viewport.x - workspaceSize.width / 2,
    -(viewport.y - workspaceSize.height / 2),
  ) * (180 / Math.PI)

  return (
    <main className={`app ${isPanning ? 'is-panning' : ''} ${isCanvasMoving ? 'is-canvas-moving' : ''} ${isSearchJumping ? 'is-search-jumping' : ''}`}>
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
              placeholder={`Layer ${activeLayer}`}
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

        <nav className="layer-rail" aria-label="Layers">
          {visibleLayerDots.map((layer) => {
            const isDraggingLayer = layerDrag?.isDragging && layerDrag.layer === layer
            const sourceIndex = layerDrag?.sourceOrder.indexOf(layer) ?? -1
            const visualIndex = layerDrag?.visualOrder.indexOf(layer) ?? -1
            const rowStep = layerDrag ? Math.max(1, layerDrag.rowHeight + 6) : 0
            const layerOffset = layerDrag?.isDragging
              ? isDraggingLayer
                ? layerDrag.currentY - layerDrag.startY
                : sourceIndex >= 0 && visualIndex >= 0 ? (visualIndex - sourceIndex) * rowStep : 0
              : 0
            const layerStyle = layerDrag?.isDragging && (isDraggingLayer || layerOffset !== 0)
              ? { transform: `translate(${isDraggingLayer ? 18 : 0}px, ${layerOffset}px)` } as CSSProperties
              : undefined

            return (
            <button
              key={layer}
              className={[
                'layer-dot',
                layer === visibleActiveLayer ? 'is-active' : '',
                isDraggingLayer ? 'is-dragging' : '',
              ].filter(Boolean).join(' ')}
              type="button"
              title={getLayerTitle(layer)}
              aria-label={`Go to ${getLayerTitle(layer)}`}
              style={layerStyle}
              onPointerDown={(event) => startLayerDrag(event, layer)}
              onPointerMove={moveLayerDrag}
              onPointerUp={finishLayerDrag}
              onPointerCancel={finishLayerDrag}
            >
              <Circle size={13} strokeWidth={layer === visibleActiveLayer ? 4 : 2} />
              <span>{getLayerTitle(layer)}</span>
            </button>
            )
          })}
        </nav>

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
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            }}
          >
            <div className="page-guide" aria-hidden="true" />
            {boxes.map((box) => (
              <CanvasTextBox
                key={box.id}
                box={box}
                isSelected={selectedBoxId === box.id}
                activeLayer={activeLayer}
                visualLayer={layerRenderPosition}
                viewportZoom={viewport.zoom}
                cellOpacity={settings.cellOpacity}
                onSelect={selectBoxWithEmptyCleanup}
                onStartDrag={startBoxDrag}
                onDelete={deleteCellWithConfirmation}
                onStartResize={startResize}
                onStartScale={startScale}
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
        onExportDocument={exportDocument}
        onImportDocument={importDocument}
      />

      <DeletedTextPanel
        deletedBoxes={deletedBoxes}
        isOpen={isTrashOpen}
        onClose={() => setIsTrashOpen(false)}
        onStartDrag={startStorageDrag}
        onPermanentDelete={permanentlyDeleteCellWithConfirmation}
      />

      {storageDragPreview && (
        <StorageDragPreview
          cell={deletedBoxes.find((box) => box.id === storageDragPreview.boxId) ?? null}
          x={storageDragPreview.x}
          y={storageDragPreview.y}
          zoom={viewport.zoom}
        />
      )}

      {textSizeDial && (
        <TextSizeWheelPicker
          x={textSizeDial.x}
          y={textSizeDial.y}
          height={textSizeDial.height}
          rotation={textSizeDial.rotation}
        />
      )}

      <ConfirmationDialog
        request={confirmationRequest}
        onCancel={() => setConfirmationRequest(null)}
        onConfirm={confirmRequestedAction}
      />
    </main>
  )
}

type ConfirmationDialogProps = {
  request: ConfirmationRequest | null
  onCancel: () => void
  onConfirm: () => void
}

function ConfirmationDialog({ request, onCancel, onConfirm }: ConfirmationDialogProps) {
  if (!request) {
    return null
  }

  return (
    <div className="confirmation-backdrop" role="presentation" onPointerDown={onCancel}>
      <section
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        aria-describedby={request.message ? 'confirmation-message' : undefined}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div>
          <h2 id="confirmation-title">{request.title}</h2>
          {request.message && <p id="confirmation-message">{request.message}</p>}
        </div>
        <div className="confirmation-actions">
          <button className="confirmation-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="confirmation-button is-danger" type="button" onClick={onConfirm}>
            {request.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

type CanvasTextBoxProps = {
  box: CellModel
  isSelected: boolean
  activeLayer: number
  visualLayer: number
  viewportZoom: number
  cellOpacity: number
  onSelect: (id: string | null) => void
  onStartDrag: (event: ReactPointerEvent<HTMLButtonElement>, box: CellModel) => void
  onDelete: (box: CellModel) => void
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>, box: CellModel) => void
  onStartScale: (event: ReactPointerEvent<HTMLButtonElement>, box: CellModel, editor: Editor | null) => void
  isScalingText: boolean
  onEditorReady: (boxId: string, editor: Editor) => void
  onEditorDestroy: (boxId: string) => void
}

function CanvasTextBox({
  box,
  isSelected,
  activeLayer,
  visualLayer,
  viewportZoom,
  cellOpacity,
  onSelect,
  onStartDrag,
  onDelete,
  onStartResize,
  onStartScale,
  isScalingText,
  onEditorReady,
  onEditorDestroy,
}: CanvasTextBoxProps) {
  const updateBox = useDocumentStore((state) => state.updateBox)
  const layerDistance = Math.abs(box.layer - visualLayer)
  const isLayerActive = box.layer === activeLayer
  const editor = useEditor({
    extensions: createEditorExtensions({ imageResize: true }),
    content: box.content,
    editable: isLayerActive,
    editorProps: {
      attributes: {
        class: 'text-editor',
      },
      handleDOMEvents: {
        keydown: (view, event) => {
          return handleListDeletionKey(view, event, box.fontSize ?? 12)
        },
      },
      handleKeyDown: (view, event) => {
        if (handleListDeletionKey(view, event, box.fontSize ?? 12)) {
          return true
        }

        if (event.key === 'Enter') {
          preserveFontSizeAfterEnter(view, box.fontSize ?? 12)
          return false
        }

        if (event.key === ' ') {
          preserveFontSizeAfterEnter(view, box.fontSize ?? 12)
          return false
        }

        if (event.key !== 'Tab') {
          return false
        }

        event.preventDefault()
        view.dispatch(view.state.tr.insertText('\t'))
        return true
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      updateBox(box.id, {
        content: activeEditor.getJSON(),
      })
    },
    immediatelyRender: false,
  })

  useEffect(() => {
    editor?.setEditable(isLayerActive)
  }, [editor, isLayerActive])

  useEffect(() => {
    if (!editor) {
      return
    }

    const handleMouseDown = (event: MouseEvent) => {
      startImageResizeCorrection(event, editor, viewportZoom)
    }

    editor.view.dom.addEventListener('mousedown', handleMouseDown, { capture: true })

    return () => {
      editor.view.dom.removeEventListener('mousedown', handleMouseDown, { capture: true })
    }
  }, [editor, viewportZoom])

  useEffect(() => {
    if (!editor) {
      return
    }

    onEditorReady(box.id, editor)

    return () => {
      onEditorDestroy(box.id)
    }
  }, [box.id, editor, onEditorDestroy, onEditorReady])

  const depthOpacity = layerDistance === 0 ? 1 : Math.max(0, 0.48 - layerDistance * 0.16)
  const depthBlur = layerDistance === 0 ? 0 : Math.min(10, layerDistance * 4)
  const depthBrightness = layerDistance === 0 ? 1 : Math.max(0.62, 0.88 - layerDistance * 0.08)
  const depthShift = (visualLayer - box.layer) * 20
  const controlScale = (1 + viewportZoom) / (2 * viewportZoom)

  return (
    <article
      className={`text-box ${isSelected ? 'is-selected' : ''} ${isLayerActive ? 'is-active-layer' : ''}`}
      data-box-id={box.id}
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        minHeight: box.height,
        opacity: depthOpacity,
        filter: `blur(${depthBlur}px) brightness(${depthBrightness})`,
        transform: `translateY(${depthShift}px) scale(${1 - Math.min(layerDistance * 0.018, 0.08)})`,
        background: cellOpacity > 0 ? `rgb(var(--canvas-bg-rgb) / ${cellOpacity / 100})` : 'transparent',
        pointerEvents: isLayerActive ? 'auto' : 'none',
        zIndex: 1000 - layerDistance,
        fontSize: box.fontSize ?? 12,
        borderWidth: 1 / viewportZoom,
        '--control-scale': controlScale,
      } as CSSProperties}
      onPointerDown={(event) => {
        event.stopPropagation()
        onSelect(box.id)
      }}
    >
      <button
        className="dragbar"
        type="button"
        title="Drag text box"
        aria-label="Drag text box"
        onPointerDown={(event) => onStartDrag(event, box)}
      >
        <Grip size={14} aria-hidden="true" />
      </button>
      <button
        className="cell-delete-handle"
        type="button"
        title="Delete cell"
        aria-label="Delete cell"
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onDelete(box)
        }}
      >
        <Trash2 size={13} aria-hidden="true" />
      </button>
      <button
        className={`scale-handle ${isScalingText ? 'is-scaling' : ''}`}
        type="button"
        title="Scale text"
        aria-label="Scale text"
        onPointerDown={(event) => onStartScale(event, box, editor)}
      >
        <Type size={14} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <EditorContent editor={editor} />
      <button
        className="resize-handle"
        type="button"
        title="Resize text box"
        aria-label="Resize text box"
        onPointerDown={(event) => onStartResize(event, box)}
      >
        <Maximize2 size={13} aria-hidden="true" />
      </button>
    </article>
  )
}
