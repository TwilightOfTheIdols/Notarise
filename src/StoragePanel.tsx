import type { PointerEvent as ReactPointerEvent } from 'react'
import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Trash2, X } from 'lucide-react'
import { EMPTY_DOCUMENT_CONTENT } from './constants'
import { extractTextPreview } from './contentUtils'
import { createEditorExtensions } from './editorConfig'
import type { StoredCellModel } from './store'

type StorageDragPreviewProps = {
  cell: StoredCellModel | null
  x: number
  y: number
  zoom: number
}

export function StorageDragPreview({ cell, x, y, zoom }: StorageDragPreviewProps) {
  const editor = useEditor({
    extensions: createEditorExtensions({ imageResize: false }),
    content: cell?.content ?? EMPTY_DOCUMENT_CONTENT,
    editable: false,
    editorProps: {
      attributes: {
        class: 'text-editor',
      },
    },
    immediatelyRender: false,
  })

  useEffect(() => {
    if (!editor || !cell) {
      return
    }

    editor.commands.setContent(cell.content)
  }, [cell, editor])

  if (!cell) {
    return null
  }

  return (
    <div
      className="storage-drag-preview"
      style={{
        left: x,
        top: y,
        width: cell.width * zoom,
        minHeight: cell.height * zoom,
      }}
    >
      <div
        className="storage-drag-preview-content"
        style={{
          width: cell.width,
          minHeight: cell.height,
          fontSize: cell.fontSize,
          transform: `scale(${zoom})`,
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

type DeletedTextPanelProps = {
  deletedBoxes: StoredCellModel[]
  isOpen: boolean
  onClose: () => void
  onStartDrag: (event: ReactPointerEvent<HTMLElement>, cell: StoredCellModel) => void
  onPermanentDelete: (id: string) => void
}

export function DeletedTextPanel({
  deletedBoxes,
  isOpen,
  onClose,
  onStartDrag,
  onPermanentDelete,
}: DeletedTextPanelProps) {
  return (
    <aside className={`deleted-panel ${isOpen ? 'is-open' : ''}`} aria-label="Storage" aria-hidden={!isOpen}>
      <div className="deleted-panel-header">
        <div>
          <h2>Storage</h2>
          <p>{deletedBoxes.length} {deletedBoxes.length === 1 ? 'cell' : 'cells'}</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} title="Close storage" aria-label="Close storage">
          <X size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="deleted-list">
        {deletedBoxes.length === 0 ? (
          <p className="deleted-empty">Stored cells will appear here.</p>
        ) : (
          deletedBoxes.map((cell) => (
            <DeletedTextItem
              key={`${cell.id}-${cell.deletedAt}`}
              cell={cell}
              onStartDrag={onStartDrag}
              onPermanentDelete={onPermanentDelete}
            />
          ))
        )}
      </div>
    </aside>
  )
}

type DeletedTextItemProps = {
  cell: StoredCellModel
  onStartDrag: (event: ReactPointerEvent<HTMLElement>, cell: StoredCellModel) => void
  onPermanentDelete: (id: string) => void
}

function DeletedTextItem({ cell, onStartDrag, onPermanentDelete }: DeletedTextItemProps) {
  const preview = extractTextPreview(cell.content)
  const deletedTime = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(cell.deletedAt)

  return (
    <article
      className="deleted-item"
      onPointerDown={(event) => onStartDrag(event, cell)}
    >
      <div className="deleted-item-text">
        <p>{preview || 'Empty cell'}</p>
        <span>Layer {cell.layer} / {deletedTime}</span>
      </div>
      <button
        className="permanent-delete-button"
        type="button"
        title="Permanently delete"
        aria-label="Permanently delete"
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={() => onPermanentDelete(cell.id)}
      >
        <Trash2 size={15} aria-hidden="true" />
      </button>
    </article>
  )
}
