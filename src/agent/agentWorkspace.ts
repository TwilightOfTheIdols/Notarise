import { invoke } from '@tauri-apps/api/core'
import { cellTextFromContent, contentFromCellText, useDocumentStore } from '../store'

export type AgentCellFile = { id: string; text: string }

// Write the current document's text cells into a throwaway workspace the agent
// can read and edit. Returns the workspace path (used as the agent's cwd) and a
// snapshot of what we wrote (to diff against on the way back).
export const materializeWorkspace = async (): Promise<{ path: string; files: AgentCellFile[] }> => {
  const boxes = useDocumentStore.getState().boxes
  const files: AgentCellFile[] = boxes.map((box) => ({
    id: box.id,
    text: cellTextFromContent(box.content),
  }))
  const path = await invoke<string>('agent_materialize', { cells: files })
  return { path, files }
}

// Read the workspace back and merge any changed cell files into the live
// document. Returns the number of cells updated. (New/deleted files are left for
// a later slice.)
export const collectWorkspace = async (path: string, original: AgentCellFile[]): Promise<number> => {
  const collected = await invoke<AgentCellFile[]>('agent_collect', { path })
  const originalById = new Map(original.map((file) => [file.id, file.text]))
  const { boxes, updateBox } = useDocumentStore.getState()
  const liveIds = new Set(boxes.map((box) => box.id))

  let changed = 0
  for (const file of collected) {
    if (!liveIds.has(file.id)) {
      continue
    }
    const before = originalById.get(file.id)
    if (before !== undefined && file.text.trim() === before.trim()) {
      continue
    }
    updateBox(file.id, { content: contentFromCellText(file.text) })
    changed += 1
  }
  return changed
}
