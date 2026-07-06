import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { Editor } from '@tiptap/react'
import {
  CELL_CONTROL_INSET,
  CLICK_DRIFT,
  FONT_SIZE_STEPS,
  LONG_PRESS_MS,
  MIN_BOX_HEIGHT,
  MIN_BOX_WIDTH,
  SCALE_CONTROL_HEIGHT,
  SCALE_CONTROL_WIDTH,
  SIZE_PICKER_HEIGHT_PADDING,
  SIZE_PICKER_STEP_PX,
} from '../constants'
import {
  applyScaledFontSegments,
  captureDocumentFontSegments,
  captureSelectedRowFontSegments,
  getMaxGrowStepIndex,
  getMinShrinkStepIndex,
  getNearestFontStepIndex,
  getWeightedSegmentFontSize,
} from '../editorBehaviors'
import { getFontStepIndexForOffset, getFontStepOffsetForIndex } from '../lib/fontStep'
import { screenToWorld } from '../store'
import type { CellModel, StoredCellModel, Viewport } from '../store'
import type { DragMode, PressState, TextSizeDialState } from '../app/types'
import type { FontSizeSegment } from '../editorBehaviors'

type StorageDragPreview = { boxId: string; x: number; y: number } | null

type UseCanvasPointerDeps = {
  boxes: CellModel[]
  selectedBoxId: string | null
  viewport: Viewport
  activeLayer: number
  panBy: (dx: number, dy: number) => void
  updateBox: (id: string, patch: Partial<CellModel>) => void
  deleteBox: (id: string) => void
  restoreBox: (id: string, point: { x: number; y: number }, layer: number) => void
  createBox: (point: { x: number; y: number }) => string
  selectBox: (id: string | null) => void
  setLayer: (layer: number) => void
  stepLayer: (direction: number) => void
  zoomAt: (client: { x: number; y: number }, deltaY: number) => void
  clampNavigableLayer: (layer: number) => number
  workspaceRef: RefObject<HTMLDivElement | null>
  trashRef: RefObject<HTMLButtonElement | null>
  storagePanelRef: RefObject<HTMLElement | null>
  editorShellRef: RefObject<HTMLDivElement | null>
  lastCanvasPointRef: RefObject<{ x: number; y: number } | null>
  isTrashOpen: boolean
  setIsTrashOpen: (open: boolean) => void
  setStorageDragPreview: (preview: StorageDragPreview) => void
  getEditor: (boxId: string) => Editor | undefined
  deselectCurrentBox: () => void
  selectBoxWithEmptyCleanup: (id: string | null) => void
  setIsCanvasMoving: (moving: boolean) => void
  settleCanvasMovement: (delay?: number) => void
  cancelMovementSettle: () => void
  showTextSizeDial: (dial: Omit<TextSizeDialState, 'isExiting'>) => void
  showFontSizeRowLabels: (boxId: string, editor: Editor, segments: FontSizeSegment[], scale: number) => void
  scheduleTextSizeUiHide: (delay?: number) => void
}

export function useCanvasPointer(deps: UseCanvasPointerDeps) {
  const {
    boxes,
    selectedBoxId,
    viewport,
    activeLayer,
    panBy,
    updateBox,
    deleteBox,
    restoreBox,
    createBox,
    selectBox,
    setLayer,
    stepLayer,
    zoomAt,
    clampNavigableLayer,
    workspaceRef,
    trashRef,
    storagePanelRef,
    editorShellRef,
    lastCanvasPointRef,
    isTrashOpen,
    setIsTrashOpen,
    setStorageDragPreview,
    getEditor,
    deselectCurrentBox,
    selectBoxWithEmptyCleanup,
    setIsCanvasMoving,
    settleCanvasMovement,
    cancelMovementSettle,
    showTextSizeDial,
    showFontSizeRowLabels,
    scheduleTextSizeUiHide,
  } = deps

  const dragRef = useRef<DragMode>(null)
  const pressRef = useRef<PressState>(null)
  const textSizeWheelRotationRef = useRef(0)
  const textSizeWheelDeltaRef = useRef(0)
  const [isPanning, setIsPanning] = useState(false)
  const [isTrashHot, setIsTrashHot] = useState(false)
  const [draggedBoxId, setDraggedBoxId] = useState<string | null>(null)

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

  const startCanvasPan = (pointerId: number, clientX: number, clientY: number) => {
    const workspace = workspaceRef.current
    workspace?.setPointerCapture(pointerId)
    cancelMovementSettle()
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

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (dragRef.current) {
        moveActiveDrag(event.clientX, event.clientY)
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      // The workspace's own pointerup (which consumes the press for
      // click-to-create) runs first during bubbling; if the pointer was
      // released outside the workspace it never fires, and a stale press
      // would long-press-pan with no button held. Clear it here.
      const press = pressRef.current
      if (press && event.pointerId === press.pointerId) {
        window.clearTimeout(press.timer)
        pressRef.current = null
      }

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
    const editor = getEditor(selectedBoxId)

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
    const target = event.target instanceof Element ? event.target : null

    if (target?.closest('.layer-rail')) {
      return
    }

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

  useEffect(() => {
    return () => {
      textSizeWheelDeltaRef.current = 0
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

  return {
    dragRef,
    isPanning,
    isTrashHot,
    draggedBoxId,
    startCanvasPanFromPointer,
    startBoxDrag,
    startResize,
    startScale,
    startStorageDrag,
    handleWorkspacePointerDown,
    handleWorkspacePointerMove,
    handleWorkspacePointerUp,
  }
}
