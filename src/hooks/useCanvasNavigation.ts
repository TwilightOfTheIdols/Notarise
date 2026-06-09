import { useEffect, useRef, useState } from 'react'
import type { CellModel, DocumentSettings, Viewport } from '../store'
import { CSS_EASE, getSearchJumpDuration } from '../lib/easing'

const DOT_MATRIX_FADE_MS = 260
const SEARCH_SETTLE_MS = 520

type UseCanvasNavigationDeps = {
  viewport: Viewport
  setViewport: (viewport: Viewport) => void
  workspaceSize: { width: number; height: number }
  settings: DocumentSettings
  activeLayer: number
  setLayer: (layer: number) => void
  setLayerAndSelect: (layer: number, id: string) => void
  selectBoxWithEmptyCleanup: (id: string | null) => void
  deselectCurrentBox: () => void
  requestLayerRailScroll: (layer: number) => void
}

export function useCanvasNavigation({
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
}: UseCanvasNavigationDeps) {
  const movementTimerRef = useRef<number | null>(null)
  const originAnimationRef = useRef<number | null>(null)
  const searchJumpAnimationRef = useRef<number | null>(null)
  const searchBrightnessReleaseRef = useRef<number | null>(null)
  const searchBrightnessReleaseTimerRef = useRef<number | null>(null)
  const visualLayerRef = useRef<number | null>(null)
  const [visualLayer, setVisualLayer] = useState<number | null>(null)
  const [isCanvasMoving, setIsCanvasMoving] = useState(false)
  const [isSearchJumping, setIsSearchJumping] = useState(false)
  const [searchBrightnessPulse, setSearchBrightnessPulse] = useState(0)
  const [searchFocusLayer, setSearchFocusLayer] = useState<number | null>(null)

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
    }
  }, [])

  const setVisualLayerValue = (layer: number | null) => {
    visualLayerRef.current = layer
    setVisualLayer(layer)
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

  const cancelMovementSettle = () => {
    if (movementTimerRef.current !== null) {
      window.clearTimeout(movementTimerRef.current)
    }
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
    setVisualLayerValue(null)
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
    const startLayer = visualLayerRef.current ?? visualLayer ?? activeLayer
    const layerDistance = Math.abs(cell.layer - startLayer)
    const duration = getSearchJumpDuration(startViewport, targetViewport, layerDistance, settings)
    const startTime = performance.now()

    selectBoxWithEmptyCleanup(cell.id)
    requestLayerRailScroll(cell.layer)

    if (duration === 0) {
      setVisualLayerValue(cell.layer)
      resetSearchBrightness()
      setLayerAndSelect(cell.layer, cell.id)
      setViewport(targetViewport)
      window.requestAnimationFrame(() => setVisualLayerValue(null))
      settleCanvasMovement(120)

      window.setTimeout(() => {
        document.querySelector<HTMLElement>(`[data-box-id="${cell.id}"] .ProseMirror`)?.focus()
      }, 0)
      return
    }

    setVisualLayerValue(startLayer)
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
      setVisualLayerValue(nextLayer)
      setSearchBrightnessPulse(brightnessPulse)

      if (progress < 1) {
        searchJumpAnimationRef.current = window.requestAnimationFrame(animate)
        return
      }

      searchJumpAnimationRef.current = null
      setVisualLayerValue(cell.layer)
      setSearchBrightnessPulse(layerDistance > 0 ? 1 : 0)
      setSearchFocusLayer(layerDistance > 0 ? cell.layer : null)
      setLayerAndSelect(cell.layer, cell.id)
      setViewport(targetViewport)
      window.requestAnimationFrame(() => {
        setVisualLayerValue(null)
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

  const jumpToLayer = (layer: number, options: { scrollRail?: boolean } = {}) => {
    if (originAnimationRef.current !== null) {
      window.cancelAnimationFrame(originAnimationRef.current)
      originAnimationRef.current = null
    }
    if (searchJumpAnimationRef.current !== null) {
      window.cancelAnimationFrame(searchJumpAnimationRef.current)
      searchJumpAnimationRef.current = null
    }

    deselectCurrentBox()
    setIsSearchJumping(false)
    resetSearchBrightness()
    if (options.scrollRail) {
      requestLayerRailScroll(layer)
    }

    const startLayer = visualLayerRef.current ?? visualLayer ?? activeLayer
    const layerDistance = Math.abs(layer - startLayer)
    const duration = getSearchJumpDuration(viewport, viewport, layerDistance, settings)

    if (layerDistance === 0 || duration === 0) {
      setVisualLayerValue(layer)
      resetSearchBrightness()
      setLayer(layer)
      window.requestAnimationFrame(() => setVisualLayerValue(null))
      settleCanvasMovement(120)
      return
    }

    const startTime = performance.now()

    setVisualLayerValue(startLayer)
    stopSearchBrightnessRelease()
    setSearchBrightnessPulse(0)
    setSearchFocusLayer(layer)
    setIsSearchJumping(true)
    setIsCanvasMoving(true)

    const animate = (time: number) => {
      const progress = Math.min(1, (time - startTime) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)

      setVisualLayerValue(startLayer + (layer - startLayer) * eased)
      setSearchBrightnessPulse(eased)

      if (progress < 1) {
        searchJumpAnimationRef.current = window.requestAnimationFrame(animate)
        return
      }

      searchJumpAnimationRef.current = null
      setVisualLayerValue(layer)
      setSearchBrightnessPulse(1)
      setSearchFocusLayer(layer)
      setLayer(layer)
      window.requestAnimationFrame(() => {
        setVisualLayerValue(null)
        window.requestAnimationFrame(() => {
          setIsSearchJumping(false)
        })
      })
      releaseSearchBrightness(SEARCH_SETTLE_MS, 1)
      settleCanvasMovement(SEARCH_SETTLE_MS)
    }

    searchJumpAnimationRef.current = window.requestAnimationFrame(animate)
  }

  return {
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
  }
}
