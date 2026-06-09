import { useCallback, useEffect, useRef } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Circle, Plus } from 'lucide-react'

const EDGE_FADE_PX = 72

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
  scrollTarget: { layer: number; requestId: number } | null
  dragState: LayerDragState | null
  releaseState: LayerReleaseState | null
  topCreateLayer: number
  bottomCreateLayer: number
  getLayerTitle: (layer: number) => string
  onCreateLayer: (layer: number) => void
  onSelectLayer: (layer: number) => void
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, layer: number) => void
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

export function LayerRail({
  layers,
  activeLayer,
  scrollTarget,
  dragState,
  releaseState,
  topCreateLayer,
  bottomCreateLayer,
  getLayerTitle,
  onCreateLayer,
  onSelectLayer,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: LayerRailProps) {
  const navRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const layerButtonRefs = useRef(new Map<number, HTMLButtonElement>())
  const handledScrollRequestRef = useRef<number | null>(null)
  const scrollStateFrameRef = useRef<number | null>(null)

  const updateRailScrollState = useCallback(() => {
    const scrollElement = scrollRef.current

    if (!scrollElement) {
      return
    }

    const maxScrollTop = scrollElement.scrollHeight - scrollElement.clientHeight
    const nextScrollEdges = {
      isAtTop: scrollElement.scrollTop <= 1,
      isAtBottom: maxScrollTop <= 1 || scrollElement.scrollTop >= maxScrollTop - 1,
    }
    const scrollRect = scrollElement.getBoundingClientRect()
    const topFade = nextScrollEdges.isAtTop ? 0 : EDGE_FADE_PX
    const bottomFade = nextScrollEdges.isAtBottom ? 0 : EDGE_FADE_PX

    layers.forEach((layer) => {
      const layerButton = layerButtonRefs.current.get(layer)

      if (!layerButton) {
        return
      }

      const layerRect = layerButton.getBoundingClientRect()

      if (dragState?.isDragging && dragState.layer === layer) {
        layerButton.style.opacity = ''
        return
      }

      const layerCenter = (layerRect.top + layerRect.bottom) / 2 - scrollRect.top
      let opacity = 1

      if (topFade > 0 && layerCenter < topFade) {
        opacity = Math.min(opacity, Math.max(0, layerCenter / topFade))
      }

      if (bottomFade > 0 && layerCenter > scrollRect.height - bottomFade) {
        opacity = Math.min(opacity, Math.max(0, (scrollRect.height - layerCenter) / bottomFade))
      }

      const nextOpacity = Math.round(opacity * 1000) / 1000
      layerButton.style.opacity = nextOpacity < 0.999 ? String(nextOpacity) : ''
    })
  }, [dragState?.isDragging, dragState?.layer, layers])

  const scheduleRailScrollStateUpdate = useCallback(() => {
    if (scrollStateFrameRef.current !== null) {
      return
    }

    scrollStateFrameRef.current = window.requestAnimationFrame(() => {
      scrollStateFrameRef.current = null
      updateRailScrollState()
    })
  }, [updateRailScrollState])

  useEffect(() => {
    if (dragState?.isDragging || !scrollTarget) {
      return
    }

    if (handledScrollRequestRef.current === scrollTarget.requestId) {
      return
    }

    const target = layerButtonRefs.current.get(scrollTarget.layer)

    if (!target) {
      return
    }

    handledScrollRequestRef.current = scrollTarget.requestId
    target.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })
    scheduleRailScrollStateUpdate()
  }, [dragState?.isDragging, scrollTarget, scheduleRailScrollStateUpdate])

  useEffect(() => {
    scheduleRailScrollStateUpdate()
  }, [layers, scheduleRailScrollStateUpdate])

  useEffect(() => {
    const scrollElement = scrollRef.current

    if (!scrollElement || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      scheduleRailScrollStateUpdate()
    })
    observer.observe(scrollElement)

    return () => {
      observer.disconnect()
    }
  }, [scheduleRailScrollStateUpdate])

  useEffect(() => {
    return () => {
      if (scrollStateFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollStateFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const nav = navRef.current

    if (!nav) {
      return
    }

    const handleWheel = (event: WheelEvent) => {
      const scrollElement = scrollRef.current

      if (!scrollElement) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const rawWheelDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
      const deltaScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scrollElement.clientHeight : 1

      scrollElement.scrollBy({
        top: rawWheelDelta * deltaScale,
        behavior: 'smooth',
      })
    }

    nav.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      nav.removeEventListener('wheel', handleWheel)
    }
  }, [])

  const createLayerButton = (layer: number, position: 'top' | 'bottom') => {
    if (layers.includes(layer)) {
      return null
    }

    const title = getLayerTitle(layer)

    return (
      <button
        key={`create-${position}`}
        className={`layer-dot layer-create-dot is-${position}`}
        type="button"
        title={`Create ${title}`}
        aria-label={`Create ${title}`}
        onClick={() => onCreateLayer(layer)}
      >
        <Circle size={13} strokeWidth={2} />
        <Plus size={13} strokeWidth={2.6} />
      </button>
    )
  }

  return (
    <nav
      ref={navRef}
      className={`layer-rail ${releaseState?.phase === 'hold' ? 'is-layer-committing' : ''}`}
      aria-label="Layers"
    >
      {createLayerButton(topCreateLayer, 'top')}
      <div ref={scrollRef} className="layer-rail-scroll" onScroll={scheduleRailScrollStateUpdate}>
        <div className="layer-rail-list">
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

            const layerTransform = dragState?.isDragging && (isDraggingLayer || layerOffset !== 0)
              ? `translate(${isDraggingLayer ? 18 : 0}px, ${layerOffset}px)`
              : isReleasingLayer ? 'translateX(18px)' : null
            const layerStyle = {
              ...(layerTransform ? { transform: layerTransform } : {}),
            } as CSSProperties
            const title = getLayerTitle(layer)

            return (
              <button
                key={layer}
                ref={(node) => {
                  if (node) {
                    layerButtonRefs.current.set(layer, node)
                    return
                  }

                  layerButtonRefs.current.delete(layer)
                }}
                className={[
                  'layer-dot',
                  layer === activeLayer ? 'is-active' : '',
                  isDraggingLayer ? 'is-dragging' : '',
                  isReleasingLayer ? 'is-releasing' : '',
                ].filter(Boolean).join(' ')}
                type="button"
                title={title}
                aria-label={`Go to ${title}`}
                data-layer={layer}
                style={layerStyle}
                onKeyDown={(event) => {
                  if (event.repeat) {
                    return
                  }
                  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                    event.preventDefault()
                    onSelectLayer(layer)
                  }
                }}
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
        </div>
      </div>
      {createLayerButton(bottomCreateLayer, 'bottom')}
    </nav>
  )
}
