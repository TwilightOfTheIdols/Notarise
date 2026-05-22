import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Circle, Plus } from 'lucide-react'

export type LayerDragState = {
  layer: number
  pointerId: number
  isDragging: boolean
  startY: number
  currentY: number
  rowHeight: number
  sourceIndex: number
  targetIndex: number
  sourceOrder: number[]
}

export type LayerReleaseState = {
  layer: number
  phase: 'hold' | 'settle'
}

type LayerRailProps = {
  layers: number[]
  activeLayer: number
  dragState: LayerDragState | null
  releaseState: LayerReleaseState | null
  topCreateLayer: number
  bottomCreateLayer: number
  getLayerTitle: (layer: number) => string
  onCreateLayer: (layer: number) => void
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, layer: number) => void
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

export function LayerRail({
  layers,
  activeLayer,
  dragState,
  releaseState,
  topCreateLayer,
  bottomCreateLayer,
  getLayerTitle,
  onCreateLayer,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: LayerRailProps) {
  const createLayerButton = (layer: number, position: 'top' | 'bottom') => {
    if (layers.includes(layer)) {
      return null
    }

    const title = getLayerTitle(layer)

    return (
      <button
        key={`create-${position}-${layer}`}
        className="layer-dot layer-create-dot"
        type="button"
        title={`Create ${title}`}
        aria-label={`Create ${title}`}
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onCreateLayer(layer)
        }}
      >
        <Circle size={13} strokeWidth={2} />
        <Plus size={13} strokeWidth={2.6} />
      </button>
    )
  }

  return (
    <nav
      className={`layer-rail ${releaseState?.phase === 'hold' ? 'is-layer-committing' : ''}`}
      aria-label="Layers"
    >
      {createLayerButton(topCreateLayer, 'top')}
      {layers.map((layer) => {
        const isDraggingLayer = dragState?.isDragging && dragState.layer === layer
        const isReleasingLayer = releaseState?.layer === layer
        const sourceIndex = dragState?.sourceOrder.indexOf(layer) ?? -1
        const rowStep = dragState ? Math.max(1, dragState.rowHeight + 6) : 0
        let layerOffset = 0

        if (dragState?.isDragging) {
          if (isDraggingLayer) {
            layerOffset = dragState.currentY - dragState.startY
          } else if (
            dragState.targetIndex > dragState.sourceIndex &&
            sourceIndex > dragState.sourceIndex &&
            sourceIndex <= dragState.targetIndex
          ) {
            layerOffset = -rowStep
          } else if (
            dragState.targetIndex < dragState.sourceIndex &&
            sourceIndex >= dragState.targetIndex &&
            sourceIndex < dragState.sourceIndex
          ) {
            layerOffset = rowStep
          }
        }

        const layerStyle = dragState?.isDragging && (isDraggingLayer || layerOffset !== 0)
          ? { transform: `translate(${isDraggingLayer ? 18 : 0}px, ${layerOffset}px)` } as CSSProperties
          : isReleasingLayer ? { transform: 'translateX(18px)' } : undefined
        const title = getLayerTitle(layer)

        return (
          <button
            key={layer}
            className={[
              'layer-dot',
              layer === activeLayer ? 'is-active' : '',
              isDraggingLayer ? 'is-dragging' : '',
              isReleasingLayer ? 'is-releasing' : '',
            ].filter(Boolean).join(' ')}
            type="button"
            title={title}
            aria-label={`Go to ${title}`}
            style={layerStyle}
            onPointerDown={(event) => onPointerDown(event, layer)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <Circle size={13} strokeWidth={layer === activeLayer ? 4 : 2} />
            <span>{title}</span>
          </button>
        )
      })}
      {createLayerButton(bottomCreateLayer, 'bottom')}
    </nav>
  )
}
