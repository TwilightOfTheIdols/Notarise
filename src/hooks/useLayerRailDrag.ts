import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CLICK_DRIFT } from '../constants'
import { getOrderedLayerMap } from '../lib/geometry'
import type { LayerDragState, LayerReleaseState } from '../LayerRail'

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

type UseLayerRailDragDeps = {
  visibleLayerDots: number[]
  layerRenderPosition: number
  jumpToLayer: (layer: number, options?: { scrollRail?: boolean }) => void
  reorderLayers: (orderedLayers: number[]) => void
  setVisualLayerValue: (layer: number | null) => void
}

export function useLayerRailDrag({
  visibleLayerDots,
  layerRenderPosition,
  jumpToLayer,
  reorderLayers,
  setVisualLayerValue,
}: UseLayerRailDragDeps) {
  const layerReleaseFrameRef = useRef<number | null>(null)
  const [layerDrag, setLayerDrag] = useState<LayerDragState | null>(null)
  const [layerRelease, setLayerRelease] = useState<LayerReleaseState | null>(null)

  useEffect(() => {
    return () => {
      if (layerReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(layerReleaseFrameRef.current)
      }
    }
  }, [])

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
      jumpToLayer(layerDrag.layer)
      return
    }

    if (visualOrder.join('|') !== layerDrag.sourceOrder.join('|')) {
      const reorderedLayer = getOrderedLayerMap(visualOrder).get(layerDrag.layer) ?? layerDrag.layer
      setLayerRelease({ layer: reorderedLayer, phase: 'hold' })
      reorderLayers(visualOrder)
      setVisualLayerValue(null)
      layerReleaseFrameRef.current = window.requestAnimationFrame(() => {
        setLayerRelease({ layer: reorderedLayer, phase: 'settle' })
        layerReleaseFrameRef.current = window.requestAnimationFrame(() => {
          setLayerRelease(null)
          layerReleaseFrameRef.current = null
        })
      })
    }
  }

  return {
    layerDrag,
    layerRelease,
    layerPreviewMap,
    visualLayerRenderPosition,
    startLayerDrag,
    moveLayerDrag,
    finishLayerDrag,
  }
}
