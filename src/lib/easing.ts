import type { DocumentSettings, SearchAnimationPreset } from '../store'

const SEARCH_ANIMATION_DURATIONS: Record<SearchAnimationPreset, { min: number; max: number }> = {
  normal: { min: 400, max: 1800 },
  instant: { min: 0, max: 0 },
}

export const CSS_EASE = (() => {
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

export const getSearchJumpDuration = (
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
