import type { RefObject } from 'react'
import { ListTodo, Package, PackageOpen, Trash2 } from 'lucide-react'

type CanvasOverlayButtonsProps = {
  trashRef: RefObject<HTMLButtonElement | null>
  isTrashOpen: boolean
  isTrashHot: boolean
  deletedCount: number
  onToggleTrash: () => void
  isTodoOpen: boolean
  uncheckedTodoCount: number
  onToggleTodo: () => void
  compassAngle: number
  onMoveToOrigin: () => void
  onDeleteLayer: () => void
  deleteLayerLabel: string
}

export function CanvasOverlayButtons({
  trashRef,
  isTrashOpen,
  isTrashHot,
  deletedCount,
  onToggleTrash,
  isTodoOpen,
  uncheckedTodoCount,
  onToggleTodo,
  compassAngle,
  onMoveToOrigin,
  onDeleteLayer,
  deleteLayerLabel,
}: CanvasOverlayButtonsProps) {
  return (
    <>
      <button
        ref={trashRef}
        className={`trash-bucket ${isTrashOpen ? 'is-open' : ''} ${isTrashHot ? 'is-hot' : ''}`}
        type="button"
        onClick={onToggleTrash}
        title="Storage"
        aria-label="Storage"
        aria-pressed={isTrashOpen}
      >
        {isTrashHot ? <PackageOpen size={25} aria-hidden="true" /> : <Package size={25} aria-hidden="true" />}
        {deletedCount > 0 && <span className="trash-count">{deletedCount}</span>}
      </button>

      <button
        className={`todo-bucket ${isTodoOpen ? 'is-open' : ''}`}
        type="button"
        onClick={onToggleTodo}
        title="Todos"
        aria-label="Todos"
        aria-pressed={isTodoOpen}
      >
        <ListTodo size={25} aria-hidden="true" />
        {uncheckedTodoCount > 0 && <span className="trash-count">{uncheckedTodoCount}</span>}
      </button>

      <button
        className="origin-compass"
        type="button"
        onClick={onMoveToOrigin}
        title="Go to origin"
        aria-label="Go to origin"
      >
        <span className="compass-ring">
          {Array.from({ length: 8 }, (_, index) => (
            <span
              key={index}
              className="compass-tick"
              style={{ transform: `translate(-50%, -50%) rotate(${index * 45}deg) translateY(-17px)` }}
            />
          ))}
          <span
            className="compass-needle"
            style={{ transform: `translate(-50%, -50%) rotate(${compassAngle}deg)` }}
          >
            <span className="needle-red" />
            <span className="needle-tail" />
          </span>
        </span>
      </button>

      <button
        className="layer-delete-button"
        type="button"
        onClick={onDeleteLayer}
        title="Delete layer"
        aria-label={deleteLayerLabel}
      >
        <Trash2 size={24} aria-hidden="true" />
      </button>
    </>
  )
}
