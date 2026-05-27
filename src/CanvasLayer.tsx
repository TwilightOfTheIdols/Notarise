import { memo, useMemo } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { Editor } from '@tiptap/react'
import { CanvasTextBox } from './CanvasTextBox'
import type { CellModel, Theme } from './store'

const LAYER_FOCUS_BLEND_DISTANCE = 0.35

const mix = (from: number, to: number, amount: number) => {
  return from + (to - from) * amount
}

type CanvasLayerProps = {
  boxes: CellModel[]
  layer: number
  displayLayer: number
  visualLayer: number
  activeLayer: number
  frontLayer: number
  theme: Theme
  selectedBoxId: string | null
  draggedBoxId: string | null
  scalingBoxId: string | null
  viewportCenterWorldX: number
  viewportCenterWorldY: number
  layerPanDepth: number
  backgroundLayerBrightness: number
  backgroundLayerBlur: number
  searchFocusLayer: number | null
  searchBrightnessPulse: number
  onSelect: (id: string | null) => void
  onStartDrag: (event: ReactPointerEvent<HTMLButtonElement>, box: CellModel) => void
  onDelete: (box: CellModel) => void
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>, box: CellModel) => void
  onStartScale: (event: ReactPointerEvent<HTMLButtonElement>, box: CellModel, editor: Editor | null) => void
  onStartPan: (event: ReactPointerEvent<HTMLElement>) => void
  onEditorReady: (boxId: string, editor: Editor) => void
  onEditorDestroy: (boxId: string) => void
}

export const CanvasLayer = memo(function CanvasLayer({
  boxes,
  layer,
  displayLayer,
  visualLayer,
  activeLayer,
  frontLayer,
  theme,
  selectedBoxId,
  draggedBoxId,
  scalingBoxId,
  viewportCenterWorldX,
  viewportCenterWorldY,
  layerPanDepth,
  backgroundLayerBrightness,
  backgroundLayerBlur,
  searchFocusLayer,
  searchBrightnessPulse,
  onSelect,
  onStartDrag,
  onDelete,
  onStartResize,
  onStartScale,
  onStartPan,
  onEditorReady,
  onEditorDestroy,
}: CanvasLayerProps) {
  const signedLayerDistance = displayLayer - visualLayer
  const layerDistance = Math.abs(signedLayerDistance)
  const isActiveLayer = layer === activeLayer
  const isFrontLayer = displayLayer === frontLayer
  const layerStyle = useMemo(() => {
    const focusBlend = Math.max(0, Math.min(1, 1 - layerDistance / LAYER_FOCUS_BLEND_DISTANCE))
    const backgroundBlend = 1 - focusBlend
    const backgroundBlur = Math.min(24, layerDistance * backgroundLayerBlur)
    const effectiveBackgroundVisibility = searchFocusLayer !== null
      ? backgroundLayerBrightness + (100 - backgroundLayerBrightness) * searchBrightnessPulse
      : backgroundLayerBrightness
    const backgroundVisibilityAmount = effectiveBackgroundVisibility / 100
    const baseDepthOpacity = Math.max(0, 0.48 - layerDistance * 0.16)
    const backgroundOpacity = baseDepthOpacity * backgroundVisibilityAmount
    const depthOpacity = mix(backgroundOpacity, 1, focusBlend)
    const backgroundBrightness = theme === 'light'
      ? 1
      : Math.max(0.62, 0.88 - Math.max(0, layerDistance - 1) * 0.08)
    const depthBrightness = mix(backgroundBrightness, 1, focusBlend)
    const depthBlur = backgroundBlur * backgroundBlend
    const backgroundScale = Math.min(Math.max(1 + signedLayerDistance * 0.1, 0.45), 1.75)
    const depthScale = mix(backgroundScale, 1, focusBlend)
    const depthPanRatio = signedLayerDistance * (layerPanDepth / 100)
    const depthPanX = -viewportCenterWorldX * depthPanRatio * backgroundBlend
    const depthPanY = -viewportCenterWorldY * depthPanRatio * backgroundBlend

    return {
      opacity: depthOpacity,
      filter: layerDistance === 0 ? undefined : `blur(${depthBlur}px) brightness(${depthBrightness})`,
      transform: layerDistance === 0
        ? undefined
        : `matrix(${depthScale}, 0, 0, ${depthScale}, ${depthPanX}, ${depthPanY})`,
      zIndex: isFrontLayer ? 3000 + displayLayer : 1000 + displayLayer,
      pointerEvents: isActiveLayer ? 'auto' : 'none',
    } as CSSProperties
  }, [
    backgroundLayerBlur,
    backgroundLayerBrightness,
    displayLayer,
    isActiveLayer,
    isFrontLayer,
    layerDistance,
    layerPanDepth,
    searchBrightnessPulse,
    searchFocusLayer,
    signedLayerDistance,
    theme,
    viewportCenterWorldX,
    viewportCenterWorldY,
  ])

  const shouldRenderEditor = isActiveLayer || layer === searchFocusLayer
  const cellElements = useMemo(() => boxes.map((box) => (
    <CanvasTextBox
      key={box.id}
      box={box}
      isSelected={selectedBoxId === box.id}
      isActiveLayer={isActiveLayer}
      shouldRenderEditor={shouldRenderEditor}
      isDragging={draggedBoxId === box.id}
      onSelect={onSelect}
      onStartDrag={onStartDrag}
      onDelete={onDelete}
      onStartResize={onStartResize}
      onStartScale={onStartScale}
      onStartPan={onStartPan}
      isScalingText={scalingBoxId === box.id}
      onEditorReady={onEditorReady}
      onEditorDestroy={onEditorDestroy}
    />
  )), [
    boxes,
    draggedBoxId,
    isActiveLayer,
    onDelete,
    onEditorDestroy,
    onEditorReady,
    onSelect,
    onStartDrag,
    onStartPan,
    onStartResize,
    onStartScale,
    scalingBoxId,
    selectedBoxId,
    shouldRenderEditor,
  ])

  return (
    <div
      className={`canvas-layer ${isActiveLayer ? 'is-active-layer' : ''}`}
      data-layer={layer}
      style={layerStyle}
    >
      {cellElements}
    </div>
  )
})
