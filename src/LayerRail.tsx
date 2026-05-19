import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Circle } from 'lucide-react'

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
  getLayerTitle: (layer: number) => string
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, layer: number) => void
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

export function LayerRail({
  layers,
  activeLayer,
  dragState,
  releaseState,
  getLayerTitle,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: LayerRailProps) {
  return (
    <nav
      className={`layer-rail ${releaseState?.phase === 'hold' ? 'is-layer-committing' : ''}`}
      aria-label="Layers"
    >
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
    </nav>
  )
}
