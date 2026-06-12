import { useDocumentStore } from '../store'
import { getContentText } from '../contentUtils'
import { getTodoChecked, getTodoLayerGroups } from '../todoUtils'
import type { AgentContext } from './types'

// Snapshot the current Notarise state so it can ride along with each agent turn.
export const buildAgentContext = (): AgentContext => {
  const { boxes, selectedBoxId, layerTitles, activeLayer } = useDocumentStore.getState()
  const layerTitleFor = (layer: number) => layerTitles[layer]?.trim() || `Layer ${layer}`

  const cell = selectedBoxId ? boxes.find((box) => box.id === selectedBoxId) ?? null : null

  if (!cell) {
    return {
      cell: null,
      activeLayer,
      activeLayerTitle: layerTitleFor(activeLayer),
    }
  }

  const groups = getTodoLayerGroups([cell], layerTitleFor, true)
  const todoItems = groups[0]?.cells[0]?.todos ?? []

  return {
    cell: {
      id: cell.id,
      layer: cell.layer,
      layerTitle: layerTitleFor(cell.layer),
      text: getContentText(cell.content),
      todos: todoItems.map((todo) => ({
        text: todo.text,
        checked: getTodoChecked(cell.content, todo.path) === true,
      })),
    },
    activeLayer,
    activeLayerTitle: layerTitleFor(activeLayer),
  }
}

export const summarizeContext = (context: AgentContext): string => {
  if (context.cell) {
    if (context.cell.todos.length > 0) {
      const open = context.cell.todos.filter((todo) => !todo.checked).length
      return `Selected cell · ${context.cell.layerTitle} · ${open}/${context.cell.todos.length} TODOs open`
    }
    return `Selected cell · ${context.cell.layerTitle}`
  }
  return `${context.activeLayerTitle} · no cell selected`
}
