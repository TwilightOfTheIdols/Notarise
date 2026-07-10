import { cellTextFromContent, contentFromCellText, useDocumentStore } from '../store'
import { getDefaultLayerTitle } from '../layerTitleUtils'

export type ActionReq = { id: string; tool: string; args: unknown }
type ActionResult = { ok: true; result: unknown } | { ok: false; error: string }

const clip = (line: string): string => {
  const trimmed = line.trim()
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed
}

const firstLine = (text: string): string => clip(text.split('\n').find((l) => l.trim()) ?? '')

// The line that actually matched (falling back to the first) so search results
// show the relevant text, not just the cell's title line.
const matchingLine = (text: string, query: string): string => {
  const lines = text.split('\n')
  return clip(lines.find((l) => l.toLowerCase().includes(query)) ?? lines.find((l) => l.trim()) ?? '')
}

// Layers that exist = those with cells or a non-empty title (mirrors the rail).
const layerList = () => {
  const { boxes, layerTitles, activeLayer } = useDocumentStore.getState()
  const layers = new Set<number>()
  boxes.forEach((box) => layers.add(box.layer))
  Object.entries(layerTitles).forEach(([layer, title]) => {
    if (title.trim()) {
      layers.add(Number(layer))
    }
  })
  return [...layers]
    .sort((a, b) => a - b)
    .map((layer) => ({
      layer,
      title: layerTitles[layer]?.trim() || `Layer ${layer}`,
      cells: boxes.filter((box) => box.layer === layer).length,
      active: layer === activeLayer,
    }))
}

// Execute one Notarise MCP tool call against the live document store.
export const runNotariseAction = (tool: string, rawArgs: unknown): ActionResult => {
  const args = rawArgs && typeof rawArgs === 'object'
    ? rawArgs as Record<string, unknown>
    : {}
  const store = useDocumentStore.getState()
  try {
    switch (tool) {
      case 'search': {
        const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
        if (!query) {
          return { ok: false, error: 'query is required' }
        }
        const matches = store.boxes
          .map((box) => ({ box, text: cellTextFromContent(box.content) }))
          .filter(({ text }) => text.toLowerCase().includes(query))
          .slice(0, 50)
          .map(({ box, text }) => ({ id: box.id, layer: box.layer, snippet: matchingLine(text, query) }))
        return { ok: true, result: { count: matches.length, matches } }
      }
      case 'list_layers':
        return { ok: true, result: { layers: layerList() } }
      case 'list_cells': {
        const rawLayer = args.layer != null ? Number(args.layer) : null
        if (rawLayer !== null && !Number.isFinite(rawLayer)) {
          return { ok: false, error: 'layer must be a number' }
        }
        const layer = rawLayer === null ? null : Math.trunc(rawLayer)
        const cells = store.boxes
          .filter((box) => layer == null || box.layer === layer)
          .map((box) => ({ id: box.id, layer: box.layer, title: firstLine(cellTextFromContent(box.content)) }))
        return { ok: true, result: { count: cells.length, cells } }
      }
      case 'get_cell': {
        const id = String(args.id ?? '')
        const box = store.boxes.find((candidate) => candidate.id === id)
        if (!box) {
          return { ok: false, error: `No cell with id ${id}` }
        }
        return {
          ok: true,
          result: { id: box.id, layer: box.layer, x: box.x, y: box.y, text: cellTextFromContent(box.content) },
        }
      }
      case 'update_cell': {
        const id = String(args.id ?? '')
        const box = store.boxes.find((candidate) => candidate.id === id)
        if (!box) {
          return { ok: false, error: `No cell with id ${id}` }
        }
        if (typeof args.text !== 'string') {
          return { ok: false, error: 'text is required' }
        }
        store.updateBox(id, { content: contentFromCellText(args.text) })
        return { ok: true, result: { id, layer: box.layer } }
      }
      case 'create_layer': {
        const existing = layerList().map((entry) => entry.layer)
        const above = args.position !== 'below'
        const newLayer = existing.length
          ? above
            ? Math.max(...existing) + 1
            : Math.min(...existing) - 1
          : store.activeLayer
        if (Math.abs(newLayer) > 100_000) {
          return { ok: false, error: 'layer limit reached' }
        }
        const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : getDefaultLayerTitle()
        store.setLayerTitle(newLayer, title)
        store.setLayer(newLayer)
        return { ok: true, result: { layer: newLayer, title } }
      }
      case 'create_cell': {
        if (typeof args.text !== 'string') {
          return { ok: false, error: 'text is required' }
        }
        const requestedLayer = args.layer == null ? null : Number(args.layer)
        if (requestedLayer !== null && (!Number.isFinite(requestedLayer) || Math.abs(requestedLayer) > 100_000)) {
          return { ok: false, error: 'layer must be a number between -100000 and 100000' }
        }
        const targetLayer = requestedLayer === null ? null : Math.trunc(requestedLayer)
        if (targetLayer !== null && targetLayer !== store.activeLayer) {
          if (!layerList().some((entry) => entry.layer === targetLayer)) {
            store.setLayerTitle(targetLayer, getDefaultLayerTitle())
          }
          store.setLayer(targetLayer)
        }
        const layer = useDocumentStore.getState().activeLayer
        const count = useDocumentStore.getState().boxes.filter((box) => box.layer === layer).length
        const x = typeof args.x === 'number' && Number.isFinite(args.x) ? args.x : 160
        const y = typeof args.y === 'number' && Number.isFinite(args.y) ? args.y : 140 + count * 60
        const id = store.createBoxWithContent({ x, y }, contentFromCellText(args.text))
        return { ok: true, result: { id, layer: useDocumentStore.getState().activeLayer } }
      }
      case 'goto_layer': {
        const layer = Math.trunc(Number(args.layer))
        if (!Number.isFinite(layer) || Math.abs(layer) > 100_000) {
          return { ok: false, error: 'layer must be a number between -100000 and 100000' }
        }
        store.setLayer(layer)
        return { ok: true, result: { activeLayer: useDocumentStore.getState().activeLayer } }
      }
      default:
        return { ok: false, error: `Unknown tool: ${tool}` }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
