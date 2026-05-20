import type { JSONContent } from '@tiptap/react'
import type { CellModel } from './store'

export type TodoItem = {
  id: string
  text: string
  cell: CellModel
  path: number[]
}

export type TodoCellGroup = {
  cell: CellModel
  title: string
  todos: TodoItem[]
}

export type TodoLayerGroup = {
  layer: number
  title: string
  cells: TodoCellGroup[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const collectNodeText = (node: unknown): string => {
  if (!isRecord(node)) {
    return ''
  }

  if (typeof node.text === 'string') {
    return node.text
  }

  if (!Array.isArray(node.content)) {
    return ''
  }

  return node.content.map(collectNodeText).join(' ')
}

const getFirstTextBlock = (content: JSONContent): string => {
  const stack = [...(content.content ?? [])]

  while (stack.length > 0) {
    const node = stack.shift()

    if (!node) {
      continue
    }

    const text = collectNodeText(node).replace(/\s+/g, ' ').trim()

    if (text) {
      return text
    }

    if (Array.isArray(node.content)) {
      stack.unshift(...node.content)
    }
  }

  return 'Untitled cell'
}

const collectTodos = (
  node: unknown,
  cell: CellModel,
  todos: TodoItem[],
  path: number[],
  includeChecked: boolean,
) => {
  if (!isRecord(node)) {
    return
  }

  if (node.type === 'taskItem' && isRecord(node.attrs) && (includeChecked || node.attrs.checked !== true)) {
    const text = collectNodeText(node).replace(/\s+/g, ' ').trim()

    todos.push({
      id: `${cell.id}:${path.join('.')}`,
      text: text || 'Untitled todo',
      cell,
      path,
    })
  }

  if (!Array.isArray(node.content)) {
    return
  }

  node.content.forEach((child, index) => {
    collectTodos(child, cell, todos, [...path, index], includeChecked)
  })
}

const getNodeAtPath = (content: JSONContent, path: number[]): JSONContent | null => {
  return path.reduce<JSONContent | null>((node, childIndex) => {
    if (!node || !Array.isArray(node.content) || childIndex < 0 || childIndex >= node.content.length) {
      return null
    }

    return node.content[childIndex]
  }, content)
}

export const getUncheckedTodoCount = (cells: CellModel[]) => {
  return cells.reduce((count, cell) => {
    const todos: TodoItem[] = []
    collectTodos(cell.content, cell, todos, [], false)
    return count + todos.length
  }, 0)
}

export const getTodoLayerGroups = (
  cells: CellModel[],
  getLayerTitle: (layer: number) => string,
  includeChecked = false,
): TodoLayerGroup[] => {
  const layerGroups = new Map<number, TodoLayerGroup>()

  cells.forEach((cell) => {
    const todos: TodoItem[] = []
    collectTodos(cell.content, cell, todos, [], includeChecked)

    if (todos.length === 0) {
      return
    }

    const layerGroup = layerGroups.get(cell.layer) ?? {
      layer: cell.layer,
      title: getLayerTitle(cell.layer),
      cells: [],
    }

    layerGroup.cells.push({
      cell,
      title: getFirstTextBlock(cell.content),
      todos,
    })
    layerGroups.set(cell.layer, layerGroup)
  })

  return [...layerGroups.values()].sort((a, b) => b.layer - a.layer)
}

export const getTodoChecked = (content: JSONContent, path: number[]): boolean | null => {
  const node = getNodeAtPath(content, path)

  if (!node || node.type !== 'taskItem' || !isRecord(node.attrs)) {
    return null
  }

  return node.attrs.checked === true
}

export const setTodoChecked = (content: JSONContent, path: number[], checked: boolean): JSONContent => {
  const updateNode = (node: JSONContent, depth: number): JSONContent => {
    if (depth === path.length) {
      return {
        ...node,
        attrs: {
          ...(node.attrs ?? {}),
          checked,
        },
      }
    }

    const childIndex = path[depth]

    if (!Array.isArray(node.content) || childIndex < 0 || childIndex >= node.content.length) {
      return node
    }

    return {
      ...node,
      content: node.content.map((child, index) => (
        index === childIndex ? updateNode(child, depth + 1) : child
      )),
    }
  }

  return updateNode(content, 0)
}
