import { memo, useEffect, useMemo } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { Grip, ListTodo, Maximize2, Trash2, Type } from 'lucide-react'
import { createEditorExtensions } from './editorConfig'
import {
  handleListDeletionKey,
  normalizeTaskItemFontSizes,
  preserveFontSizeAfterEnter,
  startImageResizeCorrection,
} from './editorBehaviors'
import { useDocumentStore } from './store'
import type { CellModel, Theme } from './store'

const LAYER_FOCUS_BLEND_DISTANCE = 0.35

const mix = (from: number, to: number, amount: number) => {
  return from + (to - from) * amount
}

export type CanvasTextBoxProps = {
  box: CellModel
  isSelected: boolean
  activeLayer: number
  frontLayer: number
  displayLayer: number
  visualLayer: number
  theme: Theme
  viewportZoom: number
  viewportCenterWorldX: number
  viewportCenterWorldY: number
  layerPanDepth: number
  backgroundLayerBrightness: number
  backgroundLayerBlur: number
  searchFocusLayer: number | null
  searchBrightnessPulse: number
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

export const CanvasTextBox = memo(function CanvasTextBox({
  box,
  isSelected,
  activeLayer,
  frontLayer,
  displayLayer,
  visualLayer,
  theme,
  viewportZoom,
  viewportCenterWorldX,
  viewportCenterWorldY,
  layerPanDepth,
  backgroundLayerBrightness,
  backgroundLayerBlur,
  searchFocusLayer,
  searchBrightnessPulse,
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
  const updateBox = useDocumentStore((state) => state.updateBox)
  const signedLayerDistance = displayLayer - visualLayer
  const layerDistance = Math.abs(signedLayerDistance)
  const isLayerActive = box.layer === activeLayer
  const isFrontLayer = displayLayer === frontLayer
  const editorExtensions = useMemo(() => createEditorExtensions({ imageResize: true }), [])
  const contentKey = useMemo(() => JSON.stringify(box.content), [box.content])
  const editor = useEditor({
    extensions: editorExtensions,
    content: box.content,
    editable: isLayerActive,
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
        if (handleListDeletionKey(view, event, box.fontSize ?? 12)) {
          return true
        }

        if (event.key === 'Enter') {
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
    editor?.setEditable(isLayerActive)
  }, [editor, isLayerActive])

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
      startImageResizeCorrection(event, editor, viewportZoom)
    }

    editor.view.dom.addEventListener('mousedown', handleMouseDown, { capture: true })

    return () => {
      editor.view.dom.removeEventListener('mousedown', handleMouseDown, { capture: true })
    }
  }, [editor, viewportZoom])

  useEffect(() => {
    if (!editor) {
      return
    }

    onEditorReady(box.id, editor)

    return () => {
      onEditorDestroy(box.id)
    }
  }, [box.id, editor, onEditorDestroy, onEditorReady])

  const focusBlend = Math.max(0, Math.min(1, 1 - layerDistance / LAYER_FOCUS_BLEND_DISTANCE))
  const backgroundBlend = 1 - focusBlend
  const backgroundBlur = Math.min(24, layerDistance * backgroundLayerBlur)
  const isCrossLayerSearch = searchFocusLayer !== null
  const effectiveBackgroundVisibility = isCrossLayerSearch
    ? backgroundLayerBrightness + (100 - backgroundLayerBrightness) * searchBrightnessPulse
    : backgroundLayerBrightness
  const backgroundVisibilityAmount = effectiveBackgroundVisibility / 100
  const baseDepthOpacity = Math.max(0, 0.48 - layerDistance * 0.16)
  const backgroundOpacity = baseDepthOpacity * backgroundVisibilityAmount
  const depthOpacity = mix(backgroundOpacity, 1, focusBlend)
  const backgroundBrightness = theme === 'light'
    ? 1
    : Math.max(0.62, 0.88 - Math.max(0, layerDistance - 1) * 0.08)
  const depthBrightness = mix(backgroundBrightness, 1, focusBlend)
  const depthBlur = backgroundBlur * backgroundBlend
  const backgroundScale = Math.min(Math.max(1 + signedLayerDistance * 0.1, 0.45), 1.75)
  const depthScale = mix(backgroundScale, 1, focusBlend)
  const depthPanRatio = signedLayerDistance * (layerPanDepth / 100)
  const depthPanX = -viewportCenterWorldX * depthPanRatio * backgroundBlend
  const depthPanY = -viewportCenterWorldY * depthPanRatio * backgroundBlend
  const depthTransformOrigin = `${-box.x}px ${-box.y}px`
  const controlScale = (1 + viewportZoom) / (2 * viewportZoom)
  const depthFilter = layerDistance === 0 ? undefined : `blur(${depthBlur}px) brightness(${depthBrightness})`
  const depthTransform = layerDistance === 0
    ? undefined
    : `matrix(${depthScale}, 0, 0, ${depthScale}, ${depthPanX}, ${depthPanY})`
  const layerZIndex = isFrontLayer
    ? 3000 + displayLayer
    : 1000 + displayLayer
  const insertTodo = () => {
    editor?.chain().focus().insertContent({
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
    <article
      className={`text-box ${isSelected ? 'is-selected' : ''} ${isLayerActive ? 'is-active-layer' : ''} ${isDragging ? 'is-dragging' : ''}`}
      data-box-id={box.id}
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        minHeight: box.height,
        opacity: isDragging ? 0 : depthOpacity,
        filter: depthFilter,
        transform: depthTransform,
        transformOrigin: depthTransformOrigin,
        background: 'transparent',
        pointerEvents: isLayerActive ? 'auto' : 'none',
        zIndex: layerZIndex,
        fontSize: box.fontSize ?? 12,
        borderWidth: 1 / viewportZoom,
        '--control-scale': controlScale,
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
    </article>
  )
})
