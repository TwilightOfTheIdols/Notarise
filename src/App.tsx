import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { DOT_SPACING } from './constants'
import { Toolbar } from './components/Toolbar'
import { Bot } from 'lucide-react'
import { CanvasOverlayButtons } from './components/CanvasOverlayButtons'
import { AgentPanel } from './components/AgentPanel'
import { useAgentStore } from './useAgentStore'
import { FontSizeRowLabels } from './components/FontSizeRowLabels'
import { isEmptyDocumentContent } from './contentUtils'
import { CanvasCellDragPreview, DeletedTextPanel, StorageDragPreview } from './StoragePanel'
import { TextSizeWheelPicker } from './TextSizeWheel'
import { GlobalSearch } from './GlobalSearch'
import { SettingsPanel } from './SettingsPanel'
import { CanvasLayer } from './CanvasLayer'
import { ConfirmationDialog } from './ConfirmationDialog'
import type { ConfirmationRequest } from './ConfirmationDialog'
import { LayerRail } from './LayerRail'
import { TodoPanel } from './TodoPanel'
import { getUncheckedTodoCount, setTodoChecked } from './todoUtils'
import type { TodoItem } from './todoUtils'
import { getDefaultLayerTitle } from './layerTitleUtils'
import { useDocumentPersistence } from './useDocumentPersistence'
import { useDocumentStore } from './store'
import type { CellModel } from './store'
import type { VisibleLayerGroup } from './app/types'
import { snapToDevicePixel } from './lib/geometry'
import { useStableEvent } from './hooks/useStableEvent'
import { useThemeVariables } from './hooks/useThemeVariables'
import { useWorkspaceSize } from './hooks/useWorkspaceSize'
import { useEditorRegistry } from './hooks/useEditorRegistry'
import { useTextSizeDial } from './hooks/useTextSizeDial'
import { cloneCellForUndo, useDeletionUndo } from './hooks/useDeletionUndo'
import { useDocumentTransfer } from './hooks/useDocumentTransfer'
import { useClipboardActions } from './hooks/useClipboardActions'
import { useCanvasNavigation } from './hooks/useCanvasNavigation'
import { useLayerRailDrag } from './hooks/useLayerRailDrag'
import { useCanvasPointer } from './hooks/useCanvasPointer'

const CONFIRMATION_UI_FADE_MS = 220
const CELL_CULL_MARGIN_SCREEN = 900
const MAX_RENDER_LAYER_DISTANCE = 3.1

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
  const lastCanvasPointRef = useRef<{ x: number; y: number } | null>(null)
  const compassAngleRef = useRef(0)
  const visibleLayerGroupsRef = useRef<VisibleLayerGroup[]>([])
  const [isTrashOpen, setIsTrashOpen] = useState(false)
  const [isTodoOpen, setIsTodoOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [storageDragPreview, setStorageDragPreview] = useState<{
    boxId: string
    x: number
    y: number
  } | null>(null)
  const [confirmationRequest, setConfirmationRequest] = useState<ConfirmationRequest | null>(null)
  const [layerRailScrollTarget, setLayerRailScrollTarget] = useState<{ layer: number; requestId: number } | null>(null)

  useDocumentPersistence()

  const workspaceSize = useWorkspaceSize(workspaceRef)
  const { registerEditor, unregisterEditor, getEditor, hasHighlightedText, focusCellEditor } = useEditorRegistry()
  const {
    textSizeDial,
    fontSizeRowLabels,
    showTextSizeDial,
    scheduleTextSizeUiHide,
    showFontSizeRowLabels,
    resetTextSizeDial,
  } = useTextSizeDial()
  const { pushUndo, clearUndo } = useDeletionUndo({ restoreRemovedBox, restoreLayer, focusCellEditor })

  useClipboardActions({
    selectedBoxId,
    viewport,
    workspaceSize,
    lastCanvasPointRef,
    hasHighlightedText,
    getEditor,
    focusCellEditor,
    duplicateBox,
    createBoxWithContent,
  })

  useThemeVariables(theme, settings.colorTemperature)

  const isAgentOpen = useAgentStore((state) => state.isOpen)
  const setAgentOpen = useAgentStore((state) => state.setOpen)

  const requestLayerRailScroll = (layer: number) => {
    setLayerRailScrollTarget((target) => ({
      layer,
      requestId: (target?.requestId ?? 0) + 1,
    }))
  }

  const deselectCurrentBox = () => {
    if (!selectedBoxId) {
      return
    }

    const selectedBox = boxes.find((box) => box.id === selectedBoxId)
    const selectedEditor = getEditor(selectedBoxId)

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

  const {
    visualLayer,
    setVisualLayerValue,
    isCanvasMoving,
    setIsCanvasMoving,
    isSearchJumping,
    searchBrightnessPulse,
    searchFocusLayer,
    settleCanvasMovement,
    cancelMovementSettle,
    moveToOrigin,
    jumpToCell,
    jumpToLayer,
  } = useCanvasNavigation({
    viewport,
    setViewport,
    workspaceSize,
    settings,
    activeLayer,
    setLayer,
    setLayerAndSelect,
    selectBoxWithEmptyCleanup,
    deselectCurrentBox,
    requestLayerRailScroll,
  })

  const { exportDocument, importDocument } = useDocumentTransfer({
    hydrateDocument,
    setConfirmationRequest,
    onBeforeImport: () => {
      clearUndo()
      resetTextSizeDial()
      setStorageDragPreview(null)
      setVisualLayerValue(null)
    },
  })

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

  const createLayerFromRail = (layer: number) => {
    requestLayerRailScroll(layer)
    jumpToLayer(layer)
  }

  const {
    layerDrag,
    layerRelease,
    layerPreviewMap,
    visualLayerRenderPosition,
    startLayerDrag,
    moveLayerDrag,
    finishLayerDrag,
  } = useLayerRailDrag({
    visibleLayerDots,
    layerRenderPosition,
    jumpToLayer,
    reorderLayers,
    setVisualLayerValue,
  })

  const {
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
  } = useCanvasPointer({
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
  })

  const deleteCellWithConfirmation = (box: CellModel) => {
    setConfirmationRequest({
      title: 'Delete cell?',
      confirmLabel: 'Delete',
      onConfirm: () => {
        pushUndo({
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
        pushUndo({
          type: 'layer',
          layer: activeLayer,
          title: layerTitle,
          boxes: layerBoxes,
        })
        setVisualLayerValue(null)
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

  const confirmRequestedAction = () => {
    if (!confirmationRequest) {
      return
    }

    const action = confirmationRequest.onConfirm
    setConfirmationRequest(null)
    action()
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
  const visibleBoxes = useMemo(() => {
    const workspaceWidth = workspaceSize.width || window.innerWidth
    const workspaceHeight = workspaceSize.height || window.innerHeight
    const margin = CELL_CULL_MARGIN_SCREEN / viewport.zoom
    const left = -surfaceX / viewport.zoom - margin
    const top = -surfaceY / viewport.zoom - margin
    const right = (workspaceWidth - surfaceX) / viewport.zoom + margin
    const bottom = (workspaceHeight - surfaceY) / viewport.zoom + margin

    return boxes.filter((box) => {
      if (box.id === selectedBoxId || box.id === draggedBoxId) {
        return true
      }

      const displayLayer = layerPreviewMap?.get(box.layer) ?? box.layer
      const layerDistance = Math.abs(displayLayer - visualLayerRenderPosition)

      if (layerDistance > MAX_RENDER_LAYER_DISTANCE) {
        return false
      }

      const boxRight = box.x + box.width
      const boxBottom = box.y + box.height

      return boxRight >= left && box.x <= right && boxBottom >= top && box.y <= bottom
    })
  }, [
    boxes,
    draggedBoxId,
    layerPreviewMap,
    selectedBoxId,
    surfaceX,
    surfaceY,
    viewport.zoom,
    visualLayerRenderPosition,
    workspaceSize.height,
    workspaceSize.width,
  ])
  const visibleLayerGroups = useMemo(() => {
    const groups = new Map<number, VisibleLayerGroup>()

    visibleBoxes.forEach((box) => {
      const displayLayer = layerPreviewMap?.get(box.layer) ?? box.layer
      const group = groups.get(box.layer)

      if (group) {
        group.boxes.push(box)
        return
      }

      groups.set(box.layer, {
        layer: box.layer,
        displayLayer,
        boxes: [box],
      })
    })

    const previousGroups = visibleLayerGroupsRef.current
    const previousByLayer = new Map(previousGroups.map((group) => [group.layer, group]))
    const nextGroups = [...groups.values()]
      .sort((a, b) => a.displayLayer - b.displayLayer)
      .map((group) => {
        const previousGroup = previousByLayer.get(group.layer)
        const hasSameBoxes = previousGroup?.boxes.length === group.boxes.length &&
          previousGroup.boxes.every((box, index) => box === group.boxes[index])

        return previousGroup && previousGroup.displayLayer === group.displayLayer && hasSameBoxes
          ? previousGroup
          : group
      })

    visibleLayerGroupsRef.current = nextGroups

    return nextGroups
  }, [layerPreviewMap, visibleBoxes])
  const controlScale = (1 + viewport.zoom) / (2 * viewport.zoom)
  const surfaceStyle = {
    transform: `translate(${surfaceX}px, ${surfaceY}px) scale(${viewport.zoom})`,
    '--cell-border-width': `${1 / viewport.zoom}px`,
    '--control-scale': controlScale,
    '--drag-dot-radius': `${1.25 / viewport.zoom}px`,
  } as CSSProperties
  const stableSelectBox = useStableEvent(selectBoxWithEmptyCleanup)
  const stableStartBoxDrag = useStableEvent(startBoxDrag)
  const stableDeleteCell = useStableEvent(deleteCellWithConfirmation)
  const stableStartResize = useStableEvent(startResize)
  const stableStartScale = useStableEvent(startScale)
  const stableStartCanvasPan = useStableEvent(startCanvasPanFromPointer)
  const stableRegisterEditor = useStableEvent(registerEditor)
  const stableUnregisterEditor = useStableEvent(unregisterEditor)
  const rawCompassAngle = Math.atan2(
    viewport.x - workspaceSize.width / 2,
    -(viewport.y - workspaceSize.height / 2),
  ) * (180 / Math.PI)
  const compassDelta = ((((rawCompassAngle - compassAngleRef.current) % 360) + 540) % 360) - 180
  compassAngleRef.current += compassDelta
  const compassAngle = compassAngleRef.current

  return (
    <main className={`app ${isPanning ? 'is-panning' : ''} ${isCanvasMoving ? 'is-canvas-moving' : ''} ${isSearchJumping ? 'is-search-jumping' : ''} ${selectedBoxId ? 'has-selected-cell' : ''} ${draggedBoxId ? 'is-cell-dragging' : ''}`}>
      <Toolbar
        activeLayer={activeLayer}
        layerTitleValue={layerTitles[activeLayer] ?? ''}
        layerTitlePlaceholder={getLayerTitle(activeLayer)}
        zoomPercent={Math.round(viewport.zoom * 100)}
        isSettingsOpen={isSettingsOpen}
        onLayerTitleChange={(value) => setLayerTitle(activeLayer, value)}
        onToggleSettings={() => setIsSettingsOpen((open) => !open)}
      />

      <div ref={editorShellRef} className="editor-shell">
        <CanvasOverlayButtons
          trashRef={trashRef}
          isTrashOpen={isTrashOpen}
          isTrashHot={isTrashHot}
          deletedCount={deletedBoxes.length}
          onToggleTrash={() => setIsTrashOpen((open) => !open)}
          isTodoOpen={isTodoOpen}
          uncheckedTodoCount={uncheckedTodoCount}
          onToggleTodo={() => setIsTodoOpen((open) => !open)}
          compassAngle={compassAngle}
          onMoveToOrigin={moveToOrigin}
          onDeleteLayer={deleteActiveLayerWithConfirmation}
          deleteLayerLabel={`Delete ${getLayerTitle(activeLayer)}`}
        />

        <button
          className={`agent-bucket ${isAgentOpen ? 'is-open' : ''}`}
          type="button"
          onClick={() => setAgentOpen(!isAgentOpen)}
          title="Assistant"
          aria-label="Assistant"
          aria-pressed={isAgentOpen}
        >
          <Bot size={25} aria-hidden="true" />
        </button>

        <LayerRail
          layers={visibleLayerDots}
          activeLayer={visibleActiveLayer}
          scrollTarget={layerRailScrollTarget}
          dragState={layerDrag}
          releaseState={layerRelease}
          topCreateLayer={layerBounds.top + 1}
          bottomCreateLayer={layerBounds.bottom - 1}
          getLayerTitle={getLayerTitle}
          onCreateLayer={(layer) => {
            createLayerFromRail(layer)
          }}
          onSelectLayer={(layer) => jumpToLayer(layer)}
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
            style={surfaceStyle}
          >
            <div className="page-guide" aria-hidden="true" />
            {visibleLayerGroups.map((group) => (
              <CanvasLayer
                key={group.layer}
                boxes={group.boxes}
                layer={group.layer}
                displayLayer={group.displayLayer}
                activeLayer={activeLayer}
                frontLayer={frontLayer}
                visualLayer={visualLayerRenderPosition}
                theme={theme}
                selectedBoxId={selectedBoxId}
                draggedBoxId={draggedBoxId}
                scalingBoxId={textSizeDial?.boxId ?? null}
                viewportCenterWorldX={viewportCenterWorldX}
                viewportCenterWorldY={viewportCenterWorldY}
                layerPanDepth={settings.layerPanDepth}
                backgroundLayerBrightness={settings.backgroundLayerBrightness}
                backgroundLayerBlur={settings.backgroundLayerBlur}
                searchFocusLayer={searchFocusLayer}
                searchBrightnessPulse={searchBrightnessPulse}
                onSelect={stableSelectBox}
                onStartDrag={stableStartBoxDrag}
                onDelete={stableDeleteCell}
                onStartResize={stableStartResize}
                onStartScale={stableStartScale}
                onStartPan={stableStartCanvasPan}
                onEditorReady={stableRegisterEditor}
                onEditorDestroy={stableUnregisterEditor}
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
        onLayerSelect={(layer) => jumpToLayer(layer, { scrollRail: true })}
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

      <AgentPanel />

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
        <FontSizeRowLabels isExiting={Boolean(textSizeDial.isExiting)} labels={fontSizeRowLabels} />
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

