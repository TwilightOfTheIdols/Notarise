import { create } from 'zustand'
import type { JSONContent } from '@tiptap/react'
import { getContentText, isEmptyDocumentContent } from './contentUtils'
import { getDefaultLayerTitle } from './layerTitleUtils'

export type Theme = 'light' | 'dark'
export type SearchAnimationPreset = 'normal' | 'instant'

export type DocumentSettings = {
  searchAnimationPreset: SearchAnimationPreset
  colorTemperature: number
  layerPanDepth: number
  backgroundLayerBrightness: number
  backgroundLayerBlur: number
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

export type NotariseDocumentV1 = {
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

export type NotariseVirtualFile = {
  mediaType: 'application/json' | 'text/markdown' | 'text/plain'
  content: unknown
}

export type NotariseDocumentV2 = {
  version: 2
  kind: 'notarise.virtual-file-bundle'
  manifestPath: 'manifest.json'
  files: Record<string, NotariseVirtualFile>
  updatedAt: number
}

export type NotariseDocument = NotariseDocumentV1 | NotariseDocumentV2

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
  removeLayer: (layer: number) => void
  restoreLayer: (layer: number, boxes: CellModel[], title: string | undefined) => void
  selectBox: (id: string | null) => void
  setViewport: (viewport: Viewport) => void
  panBy: (dx: number, dy: number) => void
  zoomAt: (client: { x: number; y: number }, deltaY: number) => void
  stepLayer: (direction: number) => void
  setLayer: (layer: number) => void
  setLayerAndSelect: (layer: number, id: string) => void
  reorderLayers: (orderedLayers: number[]) => void
  setLayerTitle: (layer: number, title: string) => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  updateSettings: (settings: Partial<DocumentSettings>) => void
  resetSettings: () => void
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
  colorTemperature: 0,
  layerPanDepth: 2.5,
  backgroundLayerBrightness: 80,
  backgroundLayerBlur: 4,
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

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const getJsonFileContent = <T,>(document: NotariseDocumentV2, path: string): T | null => {
  const file = document.files[path]

  if (!file || file.mediaType !== 'application/json') {
    return null
  }

  return file.content as T
}

const slugify = (value: string) => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'untitled'
}

const layerPathSegment = (layer: number, title: string) => {
  const prefix = layer < 0
    ? `neg-${String(Math.abs(layer)).padStart(4, '0')}`
    : String(layer).padStart(4, '0')

  return `${prefix}-${slugify(title || `layer-${layer}`)}`
}

const getLayerTitleForSnapshot = (layerTitles: Record<number, string>, layer: number) => {
  return layerTitles[layer]?.trim() || `Layer ${layer}`
}

const collectImageCount = (value: unknown): number => {
  if (!isRecord(value)) {
    return 0
  }

  const selfCount = value.type === 'image' ? 1 : 0
  const children = Array.isArray(value.content) ? value.content : []
  return selfCount + children.reduce((count, child) => count + collectImageCount(child), 0)
}

const getTaskItemLabelText = (node: Record<string, unknown>) => {
  if (!Array.isArray(node.content)) {
    return ''
  }

  const firstParagraph = node.content.find((child) => isRecord(child) && child.type === 'paragraph')

  return firstParagraph ? getContentText(firstParagraph) : ''
}

type TodoIndexEntry = {
  cellId: string
  layer: number
  checked: boolean
  text: string
  path: number[]
}

const collectTodoIndexEntries = (
  node: unknown,
  cell: CellModel,
  todos: TodoIndexEntry[],
  path: number[],
) => {
  if (!isRecord(node)) {
    return
  }

  if (node.type === 'taskItem') {
    todos.push({
      cellId: cell.id,
      layer: cell.layer,
      checked: isRecord(node.attrs) && node.attrs.checked === true,
      text: getTaskItemLabelText(node) || 'Untitled todo',
      path,
    })
  }

  if (!Array.isArray(node.content)) {
    return
  }

  node.content.forEach((child, index) => {
    collectTodoIndexEntries(child, cell, todos, [...path, index])
  })
}

const textNode = (text: string): JSONContent => ({
  type: 'text',
  text,
})

const taskLinePattern = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/

const createParagraphNode = (line: string): JSONContent => ({
  type: 'paragraph',
  content: line ? [textNode(line)] : undefined,
})

const createTaskItemNode = (line: string): JSONContent | null => {
  const match = line.match(taskLinePattern)

  if (!match) {
    return null
  }

  const text = match[2] ?? ''

  return {
    type: 'taskItem',
    attrs: {
      checked: match[1].toLowerCase() === 'x',
    },
    content: [
      createParagraphNode(text),
    ],
  }
}

const plainTextToContent = (plainText: string): JSONContent => {
  const lines = plainText.replace(/\r\n/g, '\n').split('\n')
  const content: JSONContent[] = []
  let pendingTasks: JSONContent[] = []

  const flushTasks = () => {
    if (pendingTasks.length === 0) {
      return
    }

    content.push({
      type: 'taskList',
      content: pendingTasks,
    })
    pendingTasks = []
  }

  ;(lines.length > 0 ? lines : ['']).forEach((line) => {
    const taskItem = createTaskItemNode(line)

    if (taskItem) {
      pendingTasks.push(taskItem)
      return
    }

    flushTasks()
    content.push(createParagraphNode(line))
  })

  flushTasks()

  return {
    type: 'doc',
    content,
  }
}

const collectInlineMarkdown = (node: unknown): string => {
  if (!isRecord(node)) {
    return ''
  }

  if (typeof node.text === 'string') {
    return node.text
  }

  if (node.type === 'image') {
    return '![image](embedded-image)'
  }

  if (!Array.isArray(node.content)) {
    return ''
  }

  return node.content.map(collectInlineMarkdown).join('')
}

const collectTaskItemLabelMarkdown = (node: Record<string, unknown>) => {
  if (!Array.isArray(node.content)) {
    return ''
  }

  const firstParagraph = node.content.find((child) => isRecord(child) && child.type === 'paragraph')

  return firstParagraph ? collectInlineMarkdown(firstParagraph) : ''
}

const contentToMarkdownBlocks = (node: unknown, depth = 0): string[] => {
  if (!isRecord(node)) {
    return []
  }

  if (node.type === 'paragraph') {
    return [collectInlineMarkdown(node)]
  }

  if (node.type === 'heading') {
    const level = isRecord(node.attrs) && typeof node.attrs.level === 'number' ? node.attrs.level : 2
    return [`${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${collectInlineMarkdown(node)}`]
  }

  if (node.type === 'bulletList' && Array.isArray(node.content)) {
    return node.content.map((child) => `${'  '.repeat(depth)}- ${collectInlineMarkdown(child)}`)
  }

  if (node.type === 'orderedList' && Array.isArray(node.content)) {
    return node.content.map((child, index) => `${'  '.repeat(depth)}${index + 1}. ${collectInlineMarkdown(child)}`)
  }

  if (node.type === 'taskList' && Array.isArray(node.content)) {
    return node.content.flatMap((child) => {
      const checked = isRecord(child) && isRecord(child.attrs) && child.attrs.checked === true
      const label = isRecord(child) ? collectTaskItemLabelMarkdown(child) : ''
      const nestedBlocks = isRecord(child) && Array.isArray(child.content)
        ? child.content
            .filter((nestedChild) => isRecord(nestedChild) && nestedChild.type === 'taskList')
            .flatMap((nestedChild) => contentToMarkdownBlocks(nestedChild, depth + 1))
        : []

      return [
        `${'  '.repeat(depth)}- [${checked ? 'x' : ' '}] ${label}`,
        ...nestedBlocks,
      ]
    })
  }

  if (node.type === 'image') {
    return ['![image](embedded-image)']
  }

  if (!Array.isArray(node.content)) {
    return []
  }

  return node.content.flatMap((child) => contentToMarkdownBlocks(child, depth))
}

const contentToMarkdown = (content: JSONContent) => {
  return contentToMarkdownBlocks(content).join('\n\n').trim()
}

type BundleCellFile = {
  id: string
  layer: number
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  zOrder: number
  deletedAt?: number
  plainText: string
  markdown: string
  content: JSONContent
}

const createCellFile = (cell: CellModel | StoredCellModel, zOrder: number): BundleCellFile => ({
  id: cell.id,
  layer: cell.layer,
  x: cell.x,
  y: cell.y,
  width: cell.width,
  height: cell.height,
  fontSize: cell.fontSize,
  zOrder,
  deletedAt: 'deletedAt' in cell ? cell.deletedAt : undefined,
  plainText: getContentText(cell.content),
  markdown: contentToMarkdown(cell.content),
  content: cell.content,
})

const cellFromBundleFile = (file: BundleCellFile): CellModel => {
  const contentText = getContentText(file.content)
  const content = typeof file.plainText === 'string' && file.plainText !== contentText
    ? plainTextToContent(file.plainText)
    : file.content

  return {
    id: file.id,
    layer: Number(file.layer),
    x: Math.round(Number(file.x) || 0),
    y: Math.round(Number(file.y) || 0),
    width: Math.max(1, Math.round(Number(file.width) || DEFAULT_PAGE_WIDTH)),
    height: Math.max(1, Math.round(Number(file.height) || DEFAULT_BOX_HEIGHT)),
    fontSize: Math.max(1, Math.round(Number(file.fontSize) || DEFAULT_FONT_SIZE)),
    content,
  }
}

const createLegacySnapshot = (state: DocumentState): NotariseDocumentV1 => ({
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

const createVirtualFileBundle = (legacy: NotariseDocumentV1): NotariseDocumentV2 => {
  const files: Record<string, NotariseVirtualFile> = {}
  const layerSet = new Set<number>()
  const cellIndex: Array<Record<string, unknown>> = []
  const searchIndex: Array<Record<string, unknown>> = []
  const todos: TodoIndexEntry[] = []
  const updatedAt = Date.now()

  legacy.boxes.forEach((cell) => layerSet.add(cell.layer))
  legacy.storage.forEach((cell) => layerSet.add(cell.layer))
  Object.entries(legacy.layerTitles).forEach(([layer, title]) => {
    if (title.trim()) {
      layerSet.add(Number(layer))
    }
  })

  const layerPaths = new Map<number, string>()
  ;[...layerSet].sort((a, b) => b - a).forEach((layer) => {
    const title = getLayerTitleForSnapshot(legacy.layerTitles, layer)
    const layerPath = `layers/${layerPathSegment(layer, title)}`
    layerPaths.set(layer, layerPath)

    files[`${layerPath}/layer.json`] = {
      mediaType: 'application/json',
      content: {
        layer,
        title,
        active: layer === legacy.activeLayer,
      },
    }
  })

  legacy.boxes.forEach((cell, index) => {
    const title = getLayerTitleForSnapshot(legacy.layerTitles, cell.layer)
    const layerPath = layerPaths.get(cell.layer) ?? `layers/${layerPathSegment(cell.layer, title)}`
    const cellPath = `${layerPath}/cells/${cell.id}`
    const cellFile = createCellFile(cell, index)
    const text = cellFile.plainText
    const markdown = cellFile.markdown
    const cellTodos: TodoIndexEntry[] = []
    collectTodoIndexEntries(cell.content, cell, cellTodos, [])
    todos.push(...cellTodos)

    files[`${cellPath}.json`] = {
      mediaType: 'application/json',
      content: cellFile,
    }
    files[`${cellPath}.md`] = {
      mediaType: 'text/markdown',
      content: [
        `# Cell ${cell.id}`,
        '',
        `Layer: ${cell.layer} (${title})`,
        `Position: ${cell.x}, ${cell.y}`,
        `Size: ${cell.width} x ${cell.height}`,
        '',
        markdown || text || '',
      ].join('\n'),
    }

    const indexEntry = {
      id: cell.id,
      layer: cell.layer,
      layerTitle: title,
      jsonPath: `${cellPath}.json`,
      markdownPath: `${cellPath}.md`,
      x: cell.x,
      y: cell.y,
      width: cell.width,
      height: cell.height,
      fontSize: cell.fontSize,
      textLength: text.length,
      preview: text.slice(0, 180),
      imageCount: collectImageCount(cell.content),
      todoCount: cellTodos.length,
      uncheckedTodoCount: cellTodos.filter((todo) => !todo.checked).length,
    }

    cellIndex.push(indexEntry)
    searchIndex.push({
      id: cell.id,
      layer: cell.layer,
      layerTitle: title,
      text,
      markdownPath: `${cellPath}.md`,
      jsonPath: `${cellPath}.json`,
    })
  })

  legacy.storage.forEach((cell, index) => {
    const cellPath = `storage/cells/${cell.id}`
    const cellFile = createCellFile(cell, index)

    files[`${cellPath}.json`] = {
      mediaType: 'application/json',
      content: cellFile,
    }
    files[`${cellPath}.md`] = {
      mediaType: 'text/markdown',
      content: cellFile.markdown || cellFile.plainText || '',
    }
  })

  const layerIndex = [...layerPaths.entries()].map(([layer, path]) => ({
    layer,
    title: getLayerTitleForSnapshot(legacy.layerTitles, layer),
    path,
    cellCount: legacy.boxes.filter((cell) => cell.layer === layer).length,
  }))

  files['manifest.json'] = {
    mediaType: 'application/json',
    content: {
      app: 'Notarise',
      format: 'virtual-file-bundle',
      formatVersion: 2,
      updatedAt,
      activeLayer: legacy.activeLayer,
      viewport: legacy.viewport,
      theme: legacy.theme,
      settings: legacy.settings,
      layerIndexPath: 'indexes/layers.json',
      cellIndexPath: 'indexes/cells.json',
      searchIndexPath: 'indexes/search.json',
      todoIndexPath: 'indexes/todos.json',
      appDocumentPath: 'app/document.json',
      llmGuidePath: 'LLM_README.md',
      robotsPath: 'ROBOTS.txt',
    },
  }
  files['app/document.json'] = {
    mediaType: 'application/json',
    content: legacy,
  }
  files['indexes/layers.json'] = {
    mediaType: 'application/json',
    content: layerIndex,
  }
  files['indexes/cells.json'] = {
    mediaType: 'application/json',
    content: cellIndex,
  }
  files['indexes/search.json'] = {
    mediaType: 'application/json',
    content: searchIndex,
  }
  files['indexes/todos.json'] = {
    mediaType: 'application/json',
    content: todos,
  }
  files['LLM_README.md'] = {
    mediaType: 'text/markdown',
    content: [
      '# Notarise LLM guide',
      '',
      'This .notarise file is a single JSON file that behaves like a virtual file bundle.',
      '',
      '- Start with `manifest.json` and `indexes/search.json` for cheap discovery.',
      '- Read individual cells through their `markdownPath` or `jsonPath` from `indexes/cells.json`.',
      '- To write a cell cheaply, edit that cell JSON file\'s `plainText` field. On import, Notarise will rebuild the cell content from `plainText` if it differs from the rich `content` text.',
      '- TODOs in `plainText` can be written as `- [ ] unchecked item` or `- [x] checked item`; Notarise imports those lines as real TODO boxes.',
      '- To add a cell, create a new `layers/.../cells/<id>.json` file with the same fields as existing cell JSON files. Updating `indexes/cells.json` helps search, but Notarise also discovers cell JSON files under layer folders during import.',
      '- To rename a layer, edit that layer folder\'s `layer.json` title.',
      '- For exact rich formatting, edit the cell JSON file\'s `content` field using Tiptap JSON.',
      '- Layer folders are organizational. Cell identity is always the stable `id` field.',
    ].join('\n'),
  }
  files['ROBOTS.txt'] = {
    mediaType: 'text/plain',
    content: [
      'User-agent: *',
      'Application: Notarise',
      'Format: notarise.virtual-file-bundle v2',
      '',
      'Purpose:',
      'This document stores a spatial layered canvas made of editable cells. Agents should prefer scoped reads and writes instead of loading or rewriting the whole document.',
      '',
      'Discovery:',
      '- Read manifest.json first.',
      '- Use indexes/search.json for text search.',
      '- Use indexes/cells.json to locate individual cell JSON and markdown paths.',
      '- Use indexes/todos.json to inspect TODO text and checked state.',
      '',
      'Safe write contract:',
      '- Prefer editing a target cell JSON file under layers/.../cells/<cell-id>.json.',
      '- For simple text edits, update plainText. Notarise will rebuild the rich cell content from plainText when it changes.',
      '- Preserve the id field. Cell identity is the id, not the file path.',
      '- To create TODO boxes from plainText, use lines like "- [ ] item" or "- [x] item".',
      '- To preserve exact rich formatting, edit content using Tiptap JSON instead of plainText.',
      '- To add a cell, create a new layer cell JSON file with id, layer, x, y, width, height, fontSize, zOrder, plainText, markdown, and content fields.',
      '- To rename a layer, edit layers/.../layer.json title.',
      '',
      'Avoid:',
      '- Do not rewrite app/document.json unless intentionally replacing the full app snapshot.',
      '- Do not rely on layer folder names as stable identifiers.',
      '- Do not remove indexes unless rebuilding them.',
    ].join('\n'),
  }

  return {
    version: 2,
    kind: 'notarise.virtual-file-bundle',
    manifestPath: 'manifest.json',
    files,
    updatedAt,
  }
}

const getDocumentFromBundle = (document: NotariseDocumentV2): NotariseDocumentV1 => {
  const fallback = getJsonFileContent<NotariseDocumentV1>(document, 'app/document.json')

  if (!fallback) {
    throw new Error('This Notarise bundle is missing app/document.json.')
  }

  const cellIndex = getJsonFileContent<Array<{ jsonPath?: unknown }>>(document, 'indexes/cells.json') ?? []
  const indexedCellPaths = cellIndex
    .map((entry) => entry.jsonPath)
    .filter((path): path is string => typeof path === 'string')
  const discoveredCellPaths = Object.keys(document.files)
    .filter((path) => path.startsWith('layers/') && path.includes('/cells/') && path.endsWith('.json'))
  const cellPaths = [...new Set([...indexedCellPaths, ...discoveredCellPaths])]
  const boxes = cellPaths
    .flatMap((path) => {
      const cellFile = getJsonFileContent<BundleCellFile>(document, path)
      return cellFile ? [{ cell: cellFromBundleFile(cellFile), zOrder: Number(cellFile.zOrder) || 0 }] : []
    })
    .sort((a, b) => a.zOrder - b.zOrder)
    .map(({ cell }) => cell)
  const storage = Object.entries(document.files)
    .filter(([path, file]) => path.startsWith('storage/cells/') && path.endsWith('.json') && file.mediaType === 'application/json')
    .flatMap(([, file]) => {
      const cellFile = file.content as BundleCellFile
      const cell = cellFromBundleFile(cellFile)
      return [{
        ...cell,
        deletedAt: Number(cellFile.deletedAt) || Date.now(),
      }]
    })
  const layerTitles = Object.entries(document.files)
    .filter(([path, file]) => path.startsWith('layers/') && path.endsWith('/layer.json') && file.mediaType === 'application/json')
    .reduce<Record<number, string>>((titles, [, file]) => {
      const layerFile = file.content

      if (!isRecord(layerFile) || typeof layerFile.layer !== 'number' || typeof layerFile.title !== 'string') {
        return titles
      }

      return {
        ...titles,
        [layerFile.layer]: layerFile.title,
      }
    }, fallback.layerTitles)

  return {
    ...fallback,
    boxes: boxes.length > 0 ? boxes : fallback.boxes,
    storage,
    layerTitles,
  }
}

const getRenderableDocument = (document: NotariseDocument): NotariseDocumentV1 => {
  return document.version === 2 ? getDocumentFromBundle(document) : document
}

type LegacySettings = Partial<DocumentSettings> & {
  paletteId?: unknown
}

const normalizeSettings = (settings: LegacySettings = {}): DocumentSettings => {
  const searchAnimationPreset = settings.searchAnimationPreset === 'instant'
    ? settings.searchAnimationPreset
    : DEFAULT_SETTINGS.searchAnimationPreset
  const legacyTemperature = settings.paletteId === 'cream' ? 100 : DEFAULT_SETTINGS.colorTemperature

  return {
    searchAnimationPreset,
    colorTemperature: clamp(
      Number.isFinite(settings.colorTemperature) ? Number(settings.colorTemperature) : legacyTemperature,
      0,
      100,
    ),
    layerPanDepth: clamp(
      Number.isFinite(settings.layerPanDepth) ? Number(settings.layerPanDepth) : DEFAULT_SETTINGS.layerPanDepth,
      0,
      5,
    ),
    backgroundLayerBrightness: clamp(
      Number.isFinite(settings.backgroundLayerBrightness)
        ? Number(settings.backgroundLayerBrightness)
        : DEFAULT_SETTINGS.backgroundLayerBrightness,
      0,
      100,
    ),
    backgroundLayerBlur: clamp(
      Number.isFinite(settings.backgroundLayerBlur)
        ? Number(settings.backgroundLayerBlur)
        : DEFAULT_SETTINGS.backgroundLayerBlur,
      0,
      10,
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

const getContentLayers = (state: Pick<DocumentState, 'boxes' | 'layerTitles'>, boxes = state.boxes) => {
  const layers = new Set<number>()

  boxes.forEach((box) => layers.add(box.layer))
  Object.entries(state.layerTitles).forEach(([layer, title]) => {
    if (title.trim()) {
      layers.add(Number(layer))
    }
  })

  return [...layers]
}

const getLayerBounds = (state: Pick<DocumentState, 'boxes' | 'layerTitles' | 'activeLayer'>, boxes = state.boxes) => {
  const layers = getContentLayers(state, boxes)

  if (layers.length === 0) {
    return {
      bottom: state.activeLayer,
      top: state.activeLayer,
    }
  }

  return {
    bottom: Math.min(...layers),
    top: Math.max(...layers),
  }
}

const clampNavigableLayer = (
  layer: number,
  state: Pick<DocumentState, 'boxes' | 'layerTitles' | 'activeLayer'>,
  boxes = state.boxes,
) => {
  const bounds = getLayerBounds(state, boxes)
  return clamp(layer, bounds.bottom - 1, bounds.top + 1)
}

export const createDocumentSnapshot = (state: DocumentState): NotariseDocument => {
  return createVirtualFileBundle(createLegacySnapshot(state))
}

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
    const layer = get().activeLayer
    const box: CellModel = {
      id,
      layer,
      x: Math.round(point.x - DEFAULT_TEXT_INSET_X),
      y: Math.round(point.y - DEFAULT_TEXT_INSET_Y),
      width: DEFAULT_PAGE_WIDTH,
      height: DEFAULT_BOX_HEIGHT,
      fontSize: DEFAULT_FONT_SIZE,
      content,
    }

    set((state) => ({
      boxes: [...removeEmptySelectedCell(state), box],
      layerTitles: state.layerTitles[layer]?.trim()
        ? state.layerTitles
        : {
            ...state.layerTitles,
            [layer]: getDefaultLayerTitle(),
          },
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
      layerTitles: state.layerTitles[box.layer]?.trim()
        ? state.layerTitles
        : {
            ...state.layerTitles,
            [box.layer]: getDefaultLayerTitle(),
          },
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
        layerTitles: state.layerTitles[layer]?.trim()
          ? state.layerTitles
          : {
              ...state.layerTitles,
              [layer]: getDefaultLayerTitle(),
            },
        selectedBoxId: box.id,
      }
    })
  },
  permanentlyDeleteBox: (id) => {
    set((state) => ({
      deletedBoxes: state.deletedBoxes.filter((box) => box.id !== id),
    }))
  },
  removeLayer: (layer) => {
    set((state) => {
      const boxes = removeEmptySelectedCell(state)
      const nextBoxes = boxes.filter((box) => box.layer !== layer)
      const nextLayerTitles = { ...state.layerTitles }
      delete nextLayerTitles[layer]
      const remainingLayers = getContentLayers({
        boxes: nextBoxes,
        layerTitles: nextLayerTitles,
      }, nextBoxes)
      const lowerLayer = remainingLayers.filter((candidate) => candidate < layer).sort((a, b) => b - a)[0]
      const upperLayer = remainingLayers.filter((candidate) => candidate > layer).sort((a, b) => a - b)[0]

      return {
        boxes: nextBoxes,
        layerTitles: nextLayerTitles,
        activeLayer: lowerLayer ?? upperLayer ?? layer,
        selectedBoxId: null,
      }
    })
  },
  restoreLayer: (layer, restoredBoxes, title) => {
    set((state) => ({
      boxes: [
        ...removeEmptySelectedCell(state).filter((box) => box.layer !== layer),
        ...restoredBoxes,
      ],
      layerTitles: title?.trim()
        ? {
            ...state.layerTitles,
            [layer]: title,
          }
        : state.layerTitles,
      activeLayer: layer,
      selectedBoxId: null,
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
    set((state) => {
      const boxes = removeEmptySelectedCell(state)

      return {
        boxes,
        activeLayer: clampNavigableLayer(state.activeLayer + direction, state, boxes),
        selectedBoxId: null,
      }
    })
  },
  setLayer: (layer) => {
    set((state) => {
      const boxes = removeEmptySelectedCell(state)

      return {
        boxes,
        activeLayer: clampNavigableLayer(layer, state, boxes),
        selectedBoxId: null,
      }
    })
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
  reorderLayers: (orderedLayers) => {
    set((state) => {
      const uniqueLayers = [...new Set(orderedLayers)]

      if (uniqueLayers.length < 2) {
        return state
      }

      const topLayer = Math.max(...uniqueLayers)
      const layerSlots = uniqueLayers.map((_, index) => topLayer - index)
      const layerMap = new Map(uniqueLayers.map((layer, index) => [layer, layerSlots[index]]))
      const nextLayerTitles: Record<number, string> = {}

      Object.entries(state.layerTitles).forEach(([layerKey, title]) => {
        const layer = Number(layerKey)
        nextLayerTitles[layerMap.get(layer) ?? layer] = title
      })

      return {
        boxes: state.boxes.map((box) => ({
          ...box,
          layer: layerMap.get(box.layer) ?? box.layer,
        })),
        deletedBoxes: state.deletedBoxes.map((box) => ({
          ...box,
          layer: layerMap.get(box.layer) ?? box.layer,
        })),
        layerTitles: nextLayerTitles,
        activeLayer: layerMap.get(state.activeLayer) ?? state.activeLayer,
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
  resetSettings: () => {
    set({ settings: DEFAULT_SETTINGS })
  },
  hydrateDocument: (document) => {
    const renderableDocument = getRenderableDocument(document)
    const boxes = renderableDocument.boxes ?? []
    const layerTitles = renderableDocument.layerTitles ?? {}
    const activeLayer = clampNavigableLayer(renderableDocument.activeLayer ?? 1, {
      boxes,
      layerTitles,
      activeLayer: renderableDocument.activeLayer ?? 1,
    })

    set({
      boxes,
      deletedBoxes: renderableDocument.storage ?? [],
      layerTitles,
      activeLayer,
      viewport: renderableDocument.viewport ?? { x: 120, y: 96, zoom: 1 },
      theme: renderableDocument.theme ?? 'light',
      settings: normalizeSettings(renderableDocument.settings),
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
