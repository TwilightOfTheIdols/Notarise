import { useEffect, useRef } from 'react'
import type { CellModel } from '../store'
import type { DeleteUndoAction } from '../app/types'

export const cloneCellForUndo = (box: CellModel): CellModel => ({
  ...box,
  content: typeof structuredClone === 'function'
    ? structuredClone(box.content)
    : JSON.parse(JSON.stringify(box.content)),
})

type UseDeletionUndoDeps = {
  restoreRemovedBox: (box: CellModel) => void
  restoreLayer: (layer: number, boxes: CellModel[], title: string | undefined) => void
  focusCellEditor: (boxId: string) => void
}

export function useDeletionUndo({ restoreRemovedBox, restoreLayer, focusCellEditor }: UseDeletionUndoDeps) {
  const deletedUndoStackRef = useRef<DeleteUndoAction[]>([])

  useEffect(() => {
    const handleUndoDeletedCell = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLocaleLowerCase() !== 'z' ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const target = event.target instanceof HTMLElement ? event.target : null

      if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
        return
      }

      const action = deletedUndoStackRef.current.pop()

      if (!action) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (action.type === 'cell') {
        restoreRemovedBox(cloneCellForUndo(action.cell))
        focusCellEditor(action.cell.id)
        return
      }

      restoreLayer(
        action.layer,
        action.boxes.map(cloneCellForUndo),
        action.title,
      )
    }

    window.addEventListener('keydown', handleUndoDeletedCell, { capture: true })

    return () => {
      window.removeEventListener('keydown', handleUndoDeletedCell, { capture: true })
    }
  }, [focusCellEditor, restoreLayer, restoreRemovedBox])

  const pushUndo = (action: DeleteUndoAction) => {
    deletedUndoStackRef.current.push(action)
  }

  const clearUndo = () => {
    deletedUndoStackRef.current = []
  }

  return { cloneCellForUndo, pushUndo, clearUndo }
}
