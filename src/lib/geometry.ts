export const getOrderedLayerMap = (orderedLayers: number[]) => {
  const uniqueLayers = [...new Set(orderedLayers)]

  if (uniqueLayers.length === 0) {
    return new Map<number, number>()
  }

  const topLayer = Math.max(...uniqueLayers)
  return new Map(uniqueLayers.map((layer, index) => [layer, topLayer - index]))
}

export const snapToDevicePixel = (value: number) => {
  const ratio = window.devicePixelRatio || 1
  return Math.round(value * ratio) / ratio
}
