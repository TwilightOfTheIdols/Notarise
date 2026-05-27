import { memo, useEffect, useMemo } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { Grip, ListTodo, Maximize2, Trash2, Type } from 'lucide-react'
import { createEditorExtensions } from './editorConfig'
import {
  handleListDeletionKey,
  handleTaskNestingKey,
  preserveLeadingTabsAfterEnter,
  normalizeTaskItemFontSizes,
  preserveFontSizeAfterEnter,
  startImageResizeCorrection,
} from './editorBehaviors'
import { StaticTextContent } from './StaticTextContent'
import { useDocumentStore } from './store'
import type { CellModel } from './store'
import { toggleTodoRows } from './todoToggle'

export type CanvasTextBoxProps = {
  box: CellModel
  isSelected: boolean
  isActiveLayer: boolean
  shouldRenderEditor: boolean
  isDragging: boolean
  onSelect: (id: string | null) => void
  onStartDrag: (event: ReactPointerEvent<HTMLButtonElement>, box: CellModel) => void
  onDelete: (box: CellModel) => void
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>, box: CellModel) => void
  onStartScale: (event: ReactPointerEvent<HTMLButtonElement>, box: CellModel, editor: Editor | null) => void
  onStartPan: (event: ReactPointerEvent<HTMLElement>) => void
  isScalingText: boolean
  onEditorReady: (boxId: string, editor: Editor) => void
  onEditorDestroy: (boxId: string) => void
}

type ActiveTextBoxEditorProps = Pick<
  CanvasTextBoxProps,
  | 'box'
  | 'onStartDrag'
  | 'onDelete'
  | 'onStartResize'
  | 'onStartScale'
  | 'isScalingText'
  | 'onEditorReady'
  | 'onEditorDestroy'
>

function ActiveTextBoxEditor({
  box,
  onStartDrag,
  onDelete,
  onStartResize,
  onStartScale,
  isScalingText,
  onEditorReady,
  onEditorDestroy,
}: ActiveTextBoxEditorProps) {
  const updateBox = useDocumentStore((state) => state.updateBox)
  const editorExtensions = useMemo(() => createEditorExtensions({ imageResize: true }), [])
  const contentKey = useMemo(() => JSON.stringify(box.content), [box.content])
  const editor = useEditor({
    extensions: editorExtensions,
    content: box.content,
    editable: true,
    editorProps: {
      attributes: {
        class: 'text-editor',
      },
      handleDOMEvents: {
        keydown: (view, event) => {
          return handleListDeletionKey(view, event, box.fontSize ?? 12)
        },
      },
      handleKeyDown: (view, event) => {
        if (editor && handleTaskNestingKey(editor, event)) {
          return true
        }

        if (handleListDeletionKey(view, event, box.fontSize ?? 12)) {
          return true
        }

        if (event.key === 'Enter') {
          preserveLeadingTabsAfterEnter(view)
          preserveFontSizeAfterEnter(view, box.fontSize ?? 12)
          return false
        }

        if (event.key === ' ') {
          preserveFontSizeAfterEnter(view, box.fontSize ?? 12)
          return false
        }

        if (event.key !== 'Tab') {
          return false
        }

        event.preventDefault()
        view.dispatch(view.state.tr.insertText('\t'))
        return true
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      updateBox(box.id, {
        content: activeEditor.getJSON(),
      })
    },
    immediatelyRender: false,
  })

  useEffect(() => {
    if (!editor) {
      return
    }

    if (JSON.stringify(editor.getJSON()) !== contentKey) {
      editor.commands.setContent(box.content, { emitUpdate: false })
    }

    normalizeTaskItemFontSizes(editor, box.fontSize ?? 12)
  }, [box.content, box.fontSize, contentKey, editor])

  useEffect(() => {
    if (!editor) {
      return
    }

    const handleMouseDown = (event: MouseEvent) => {
      startImageResizeCorrection(event, editor, useDocumentStore.getState().viewport.zoom)
    }

    editor.view.dom.addEventListener('mousedown', handleMouseDown, { capture: true })

    return () => {
      editor.view.dom.removeEventListener('mousedown', handleMouseDown, { capture: true })
    }
  }, [editor])

  useEffect(() => {
    if (!editor) {
      return
    }

    onEditorReady(box.id, editor)

    return () => {
      onEditorDestroy(box.id)
    }
  }, [box.id, editor, onEditorDestroy, onEditorReady])

  const insertTodo = () => {
    if (!editor) {
      return
    }

    if (toggleTodoRows(editor)) {
      return
    }

    editor.chain().focus().insertContent({
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: {
            checked: false,
          },
          content: [
            {
              type: 'paragraph',
            },
          ],
        },
      ],
    }).run()
  }

  return (
    <>
      <button
        className="dragbar"
        type="button"
        title="Drag text box"
        aria-label="Drag text box"
        onPointerDown={(event) => onStartDrag(event, box)}
      >
        <Grip size={14} aria-hidden="true" />
      </button>
      <button
        className="cell-delete-handle"
        type="button"
        title="Delete cell"
        aria-label="Delete cell"
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onDelete(box)
        }}
      >
        <Trash2 size={13} aria-hidden="true" />
      </button>
      <button
        className={`scale-handle ${isScalingText ? 'is-scaling' : ''}`}
        type="button"
        title="Scale text"
        aria-label="Scale text"
        onPointerDown={(event) => onStartScale(event, box, editor)}
      >
        <Type size={14} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <button
        className="todo-handle"
        type="button"
        title="Insert todo"
        aria-label="Insert todo"
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          insertTodo()
        }}
      >
        <ListTodo size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <EditorContent editor={editor} />
      <button
        className="resize-handle"
        type="button"
        title="Resize text box"
        aria-label="Resize text box"
        onPointerDown={(event) => onStartResize(event, box)}
      >
        <Maximize2 size={13} aria-hidden="true" />
      </button>
    </>
  )
}

export const CanvasTextBox = memo(function CanvasTextBox({
  box,
  isSelected,
  isActiveLayer,
  shouldRenderEditor,
  isDragging,
  onSelect,
  onStartDrag,
  onDelete,
  onStartResize,
  onStartScale,
  onStartPan,
  isScalingText,
  onEditorReady,
  onEditorDestroy,
}: CanvasTextBoxProps) {
  return (
    <article
      className={`text-box ${isSelected ? 'is-selected' : ''} ${isActiveLayer ? 'is-active-layer' : ''} ${isDragging ? 'is-dragging' : ''}`}
      data-box-id={box.id}
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        minHeight: box.height,
        background: 'transparent',
        opacity: isDragging ? 0 : undefined,
        pointerEvents: isActiveLayer ? 'auto' : 'none',
        fontSize: box.fontSize ?? 12,
      } as CSSProperties}
      onPointerDown={(event) => {
        if (event.button === 1) {
          onStartPan(event)
          return
        }

        event.stopPropagation()
        onSelect(box.id)
      }}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
    >
      {shouldRenderEditor ? (
        <ActiveTextBoxEditor
          box={box}
          onStartDrag={onStartDrag}
          onDelete={onDelete}
          onStartResize={onStartResize}
          onStartScale={onStartScale}
          isScalingText={isScalingText}
          onEditorReady={onEditorReady}
          onEditorDestroy={onEditorDestroy}
        />
      ) : (
        <StaticTextContent content={box.content} />
      )}
    </article>
  )
})
