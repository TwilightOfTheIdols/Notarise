import { create } from 'zustand'
import type { JSONContent } from '@tiptap/react'
import { isEmptyDocumentContent } from './contentUtils'

export type Theme = 'light' | 'dark'
export type SearchAnimationPreset = 'normal' | 'instant'

export type DocumentSettings = {
  searchAnimationPreset: SearchAnimationPreset
  cellOpacity: number
}

export type Viewport = {
  x: number
  y: number
  zoom: number
}

export type CellModel = {
  id: string
  layer: number
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  content: JSONContent
}

export type StoredCellModel = CellModel & {
  deletedAt: number
}

export type NotariseDocument = {
  version: 1
  boxes: CellModel[]
  storage: StoredCellModel[]
  layerTitles: Record<number, string>
  activeLayer: number
  viewport: Viewport
  theme: Theme
  settings?: Partial<DocumentSettings>
  updatedAt: number
}

export type DocumentState = {
  boxes: CellModel[]
  deletedBoxes: StoredCellModel[]
  layerTitles: Record<number, string>
  selectedBoxId: string | null
  activeLayer: number
  viewport: Viewport
  theme: Theme
  settings: DocumentSettings
  createBox: (point: { x: number; y: number }) => string
  createBoxWithContent: (point: { x: number; y: number }, content: JSONContent) => string
  duplicateBox: (id: string) => string | null
  updateBox: (id: string, patch: Partial<CellModel>) => void
  deleteBox: (id: string) => void
  removeBox: (id: string) => void
  restoreRemovedBox: (box: CellModel) => void
  restoreBox: (id: string, point: { x: number; y: number }, layer: number) => void
  permanentlyDeleteBox: (id: string) => void
  selectBox: (id: string | null) => void
  setViewport: (viewport: Viewport) => void
  panBy: (dx: number, dy: number) => void
  zoomAt: (client: { x: number; y: number }, deltaY: number) => void
  stepLayer: (direction: number) => void
  setLayer: (layer: number) => void
  setLayerAndSelect: (layer: number, id: string) => void
  setLayerTitle: (layer: number, title: string) => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  updateSettings: (settings: Partial<DocumentSettings>) => void
  hydrateDocument: (document: NotariseDocument) => void
}

const DEFAULT_PAGE_WIDTH = 720
const DEFAULT_BOX_HEIGHT = 190
const DEFAULT_FONT_SIZE = 16
const DEFAULT_TEXT_INSET_X = 44
const DEFAULT_TEXT_INSET_Y = 38
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const ZOOM_STEP = 0.1
const DEFAULT_SETTINGS: DocumentSettings = {
  searchAnimationPreset: 'normal',
  cellOpacity: 0,
}

const blankContent: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
    },
  ],
}

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value))
}

const nextId = () => {
  return crypto.randomUUID?.() ?? `box-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const cloneContent = (content: JSONContent): JSONContent => {
  return typeof structuredClone === 'function'
    ? structuredClone(content)
    : JSON.parse(JSON.stringify(content)) as JSONContent
}

const normalizeSettings = (settings: Partial<DocumentSettings> = {}): DocumentSettings => {
  const searchAnimationPreset = settings.searchAnimationPreset === 'instant'
    ? settings.searchAnimationPreset
    : DEFAULT_SETTINGS.searchAnimationPreset

  return {
    searchAnimationPreset,
    cellOpacity: clamp(
      Number.isFinite(settings.cellOpacity) ? Number(settings.cellOpacity) : DEFAULT_SETTINGS.cellOpacity,
      0,
      100,
    ),
  }
}

const removeEmptySelectedCell = (state: DocumentState) => {
  if (!state.selectedBoxId) {
    return state.boxes
  }

  const selectedBox = state.boxes.find((box) => box.id === state.selectedBoxId)

  if (!selectedBox || !isEmptyDocumentContent(selectedBox.content)) {
    return state.boxes
  }

  return state.boxes.filter((box) => box.id !== state.selectedBoxId)
}

export const createDocumentSnapshot = (state: DocumentState): NotariseDocument => ({
  version: 1,
  boxes: state.boxes,
  storage: state.deletedBoxes,
  layerTitles: state.layerTitles,
  activeLayer: state.activeLayer,
  viewport: state.viewport,
  theme: state.theme,
  settings: state.settings,
  updatedAt: Date.now(),
})

export const useDocumentStore = create<DocumentState>((set, get) => ({
  boxes: [],
  deletedBoxes: [],
  layerTitles: {},
  selectedBoxId: null,
  activeLayer: 1,
  viewport: {
    x: 120,
    y: 96,
    zoom: 1,
  },
  theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  settings: DEFAULT_SETTINGS,
  createBox: (point) => {
    return get().createBoxWithContent(point, blankContent)
  },
  createBoxWithContent: (point, content) => {
    const id = nextId()
    const box: CellModel = {
      id,
      layer: get().activeLayer,
      x: Math.round(point.x - DEFAULT_TEXT_INSET_X),
      y: Math.round(point.y - DEFAULT_TEXT_INSET_Y),
      width: DEFAULT_PAGE_WIDTH,
      height: DEFAULT_BOX_HEIGHT,
      fontSize: DEFAULT_FONT_SIZE,
      content,
    }

    set((state) => ({
      boxes: [...removeEmptySelectedCell(state), box],
      selectedBoxId: id,
    }))

    return id
  },
  duplicateBox: (id) => {
    const sourceBox = get().boxes.find((box) => box.id === id)

    if (!sourceBox) {
      return null
    }

    const duplicateId = nextId()
    const duplicateBox: CellModel = {
      ...sourceBox,
      id: duplicateId,
      x: sourceBox.x + 32,
      y: sourceBox.y + 32,
      content: cloneContent(sourceBox.content),
    }

    set((state) => ({
      boxes: [
        ...state.boxes.filter((box) => box.id !== duplicateId),
        duplicateBox,
      ],
      selectedBoxId: duplicateId,
    }))

    return duplicateId
  },
  updateBox: (id, patch) => {
    set((state) => ({
      boxes: state.boxes.map((box) => (box.id === id ? { ...box, ...patch } : box)),
    }))
  },
  deleteBox: (id) => {
    set((state) => {
      const box = state.boxes.find((candidate) => candidate.id === id)

      if (!box) {
        return state
      }

      return {
        boxes: state.boxes.filter((candidate) => candidate.id !== id),
        deletedBoxes: [
          {
            ...box,
            deletedAt: Date.now(),
          },
          ...state.deletedBoxes,
        ],
        selectedBoxId: state.selectedBoxId === id ? null : state.selectedBoxId,
      }
    })
  },
  removeBox: (id) => {
    set((state) => ({
      boxes: state.boxes.filter((box) => box.id !== id),
      selectedBoxId: state.selectedBoxId === id ? null : state.selectedBoxId,
    }))
  },
  restoreRemovedBox: (box) => {
    set((state) => ({
      boxes: [
        ...removeEmptySelectedCell(state).filter((candidate) => candidate.id !== box.id),
        box,
      ],
      activeLayer: box.layer,
      selectedBoxId: box.id,
    }))
  },
  restoreBox: (id, point, layer) => {
    set((state) => {
      const box = state.deletedBoxes.find((candidate) => candidate.id === id)

      if (!box) {
        return state
      }

      const { deletedAt: _deletedAt, ...restoredBox } = box

      const boxes = removeEmptySelectedCell(state)

      return {
        boxes: [
          ...boxes,
          {
            ...restoredBox,
            layer,
            x: Math.round(point.x),
            y: Math.round(point.y),
          },
        ],
        deletedBoxes: state.deletedBoxes.filter((candidate) => candidate.id !== id),
        selectedBoxId: box.id,
      }
    })
  },
  permanentlyDeleteBox: (id) => {
    set((state) => ({
      deletedBoxes: state.deletedBoxes.filter((box) => box.id !== id),
    }))
  },
  selectBox: (id) => {
    set((state) => {
      const boxes = state.selectedBoxId === id ? state.boxes : removeEmptySelectedCell(state)

      if (!id) {
        return {
          boxes,
          selectedBoxId: null,
        }
      }

      const selectedBox = boxes.find((box) => box.id === id)

      if (!selectedBox) {
        return {
          boxes,
          selectedBoxId: id,
        }
      }

      return {
        boxes: [
          ...boxes.filter((box) => box.id !== id),
          selectedBox,
        ],
        selectedBoxId: id,
      }
    })
  },
  setViewport: (viewport) => {
    set({
      viewport: {
        ...viewport,
        zoom: clamp(viewport.zoom, MIN_ZOOM, MAX_ZOOM),
      },
    })
  },
  panBy: (dx, dy) => {
    set((state) => ({
      viewport: {
        ...state.viewport,
        x: state.viewport.x + dx,
        y: state.viewport.y + dy,
      },
    }))
  },
  zoomAt: (client, deltaY) => {
    set((state) => {
      const oldZoom = state.viewport.zoom
      const direction = deltaY > 0 ? -1 : 1
      const currentStep = Math.round(oldZoom / ZOOM_STEP)
      const zoom = clamp((currentStep + direction) * ZOOM_STEP, MIN_ZOOM, MAX_ZOOM)
      const worldX = (client.x - state.viewport.x) / oldZoom
      const worldY = (client.y - state.viewport.y) / oldZoom

      return {
        viewport: {
          x: client.x - worldX * zoom,
          y: client.y - worldY * zoom,
          zoom,
        },
      }
    })
  },
  stepLayer: (direction) => {
    set((state) => ({
      boxes: removeEmptySelectedCell(state),
      activeLayer: state.activeLayer + direction,
      selectedBoxId: null,
    }))
  },
  setLayer: (layer) => {
    set((state) => ({
      boxes: removeEmptySelectedCell(state),
      activeLayer: layer,
      selectedBoxId: null,
    }))
  },
  setLayerAndSelect: (layer, id) => {
    set((state) => {
      const boxes = state.selectedBoxId === id ? state.boxes : removeEmptySelectedCell(state)
      const selectedBox = boxes.find((box) => box.id === id)

      return {
        boxes: selectedBox ? [...boxes.filter((box) => box.id !== id), selectedBox] : boxes,
        activeLayer: layer,
        selectedBoxId: id,
      }
    })
  },
  setLayerTitle: (layer, title) => {
    set((state) => ({
      layerTitles: {
        ...state.layerTitles,
        [layer]: title,
      },
    }))
  },
  setTheme: (theme) => {
    set({ theme })
  },
  toggleTheme: () => {
    set((state) => ({
      theme: state.theme === 'light' ? 'dark' : 'light',
    }))
  },
  updateSettings: (settings) => {
    set((state) => ({
      settings: normalizeSettings({
        ...state.settings,
        ...settings,
      }),
    }))
  },
  hydrateDocument: (document) => {
    set({
      boxes: document.boxes ?? [],
      deletedBoxes: document.storage ?? [],
      layerTitles: document.layerTitles ?? {},
      activeLayer: document.activeLayer ?? 1,
      viewport: document.viewport ?? { x: 120, y: 96, zoom: 1 },
      theme: document.theme ?? 'light',
      settings: normalizeSettings(document.settings),
      selectedBoxId: null,
    })
  },
}))

export const screenToWorld = (
  client: { x: number; y: number },
  viewport: Viewport,
) => ({
  x: (client.x - viewport.x) / viewport.zoom,
  y: (client.y - viewport.y) / viewport.zoom,
})
