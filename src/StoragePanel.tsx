import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { useEffect } from 'react'
import type { RefObject } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Grip, ListTodo, Maximize2, Trash2, Type, X } from 'lucide-react'
import { EMPTY_DOCUMENT_CONTENT } from './constants'
import { extractTextPreview } from './contentUtils'
import { createEditorExtensions } from './editorConfig'
import type { CellModel, StoredCellModel } from './store'

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

type CanvasCellDragPreviewProps = {
  cell: CellModel | null
  x: number
  y: number
  zoom: number
}

export function CanvasCellDragPreview({ cell, x, y, zoom }: CanvasCellDragPreviewProps) {
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

  const controlScale = (1 + zoom) / (2 * zoom)

  return (
    <div
      className="canvas-drag-preview"
      style={{
        left: x,
        top: y,
        width: cell.width * zoom,
        minHeight: cell.height * zoom,
      }}
    >
      <div
        className="canvas-drag-preview-frame"
        style={{
          width: cell.width,
          minHeight: cell.height,
          transform: `scale(${zoom})`,
        }}
      >
        <article
          className="text-box is-selected is-active-layer"
          style={{
            left: 0,
            top: 0,
            width: cell.width,
            minHeight: cell.height,
            opacity: 1,
            background: 'transparent',
            fontSize: cell.fontSize,
            borderWidth: 1 / zoom,
            '--cell-border-width': `${1 / zoom}px`,
            '--control-scale': controlScale,
            '--drag-dot-radius': `${1.25 / zoom}px`,
          } as CSSProperties}
        >
          <button className="dragbar" type="button" aria-label="Drag cell" tabIndex={-1}>
            <Grip size={14} aria-hidden="true" />
          </button>
          <button className="cell-delete-handle" type="button" aria-label="Delete cell" tabIndex={-1}>
            <Trash2 size={13} aria-hidden="true" />
          </button>
          <button className="scale-handle" type="button" aria-label="Scale text" tabIndex={-1}>
            <Type size={14} strokeWidth={2.4} aria-hidden="true" />
          </button>
          <button className="todo-handle" type="button" aria-label="Insert todo" tabIndex={-1}>
            <ListTodo size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <EditorContent editor={editor} />
          <button className="resize-handle" type="button" aria-label="Resize cell" tabIndex={-1}>
            <Maximize2 size={13} aria-hidden="true" />
          </button>
        </article>
      </div>
    </div>
  )
}

type DeletedTextPanelProps = {
  deletedBoxes: StoredCellModel[]
  isOpen: boolean
  isDropTarget: boolean
  panelRef: RefObject<HTMLElement | null>
  onClose: () => void
  onStartDrag: (event: ReactPointerEvent<HTMLElement>, cell: StoredCellModel) => void
  onPermanentDelete: (id: string) => void
}

export function DeletedTextPanel({
  deletedBoxes,
  isOpen,
  isDropTarget,
  panelRef,
  onClose,
  onStartDrag,
  onPermanentDelete,
}: DeletedTextPanelProps) {
  return (
    <aside
      ref={panelRef}
      className={`deleted-panel ${isOpen ? 'is-open' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
      aria-label="Storage"
      aria-hidden={!isOpen}
    >
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
