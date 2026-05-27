import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { getTodoChecked, getTodoLayerGroups } from './todoUtils'
import type { TodoItem, TodoLayerGroup } from './todoUtils'
import type { CellModel } from './store'

type TodoPanelProps = {
  cells: CellModel[]
  isOpen: boolean
  getLayerTitle: (layer: number) => string
  onClose: () => void
  onTodoSelect: (cell: CellModel) => void
  onTodoCheckChange: (todo: TodoItem, checked: boolean) => void
}

export function TodoPanel({ cells, isOpen, getLayerTitle, onClose, onTodoSelect, onTodoCheckChange }: TodoPanelProps) {
  const [showChecked, setShowChecked] = useState(false)
  const liveGroups = useMemo(
    () => getTodoLayerGroups(cells, getLayerTitle, showChecked),
    [cells, getLayerTitle, showChecked],
  )
  const liveCellById = useMemo(() => new Map(cells.map((cell) => [cell.id, cell])), [cells])
  const [snapshotGroups, setSnapshotGroups] = useState<TodoLayerGroup[]>([])
  const [todoCheckedState, setTodoCheckedState] = useState<Record<string, boolean>>({})
  const wasOpenRef = useRef(false)
  const previousShowCheckedRef = useRef(showChecked)
  const groups = isOpen ? snapshotGroups : liveGroups
  const todoCount = groups.reduce(
    (total, group) => total + group.cells.reduce((cellTotal, cell) => cellTotal + cell.todos.length, 0),
    0,
  )

  useEffect(() => {
    const viewChanged = previousShowCheckedRef.current !== showChecked

    if (isOpen && (!wasOpenRef.current || viewChanged)) {
      setSnapshotGroups(liveGroups)
      setTodoCheckedState({})
    }

    wasOpenRef.current = isOpen
    previousShowCheckedRef.current = showChecked
  }, [isOpen, liveGroups, showChecked])

  const getVisibleTodoChecked = (todo: TodoItem) => {
    const liveCell = liveCellById.get(todo.cell.id)
    const liveChecked = liveCell ? getTodoChecked(liveCell.content, todo.path) : null

    return liveChecked ?? todoCheckedState[todo.id] ?? false
  }

  return (
    <aside className={`todo-panel ${isOpen ? 'is-open' : ''}`} aria-label="Open todos" aria-hidden={!isOpen}>
      <div className="todo-panel-header">
        <div className="todo-panel-title">
          <h2>TODOs</h2>
          <p>{todoCount} {showChecked ? 'shown' : 'unchecked'}</p>
          <label className="todo-show-checked-toggle">
            <input
              type="checkbox"
              checked={showChecked}
              onChange={(event) => setShowChecked(event.target.checked)}
            />
            <span aria-hidden="true" />
            Show checked
          </label>
        </div>
        <button className="icon-button" type="button" onClick={onClose} title="Close todos" aria-label="Close todos">
          <X size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="todo-list">
        {groups.length === 0 ? (
          <p className="todo-empty">{showChecked ? 'Todos will appear here.' : 'Unchecked todos will appear here.'}</p>
        ) : (
          groups.map((group) => (
            <section key={group.layer} className="todo-layer-group">
              <h3>{group.title}</h3>
              {group.cells.map((cellGroup) => (
                <article key={cellGroup.cell.id} className="todo-cell-group">
                  <button
                    className="todo-cell-title"
                    type="button"
                    onClick={() => onTodoSelect(cellGroup.cell)}
                  >
                    {cellGroup.title}
                  </button>
                  <ul>
                    {cellGroup.todos.map((todo) => {
                      const checked = getVisibleTodoChecked(todo)

                      return (
                        <li key={todo.id} className={checked ? 'is-checked' : undefined}>
                          <button
                            type="button"
                            style={{ paddingLeft: 8 + todo.depth * 18 }}
                            onClick={() => {
                              const nextChecked = !checked

                              setTodoCheckedState((state) => ({
                                ...state,
                                [todo.id]: nextChecked,
                              }))
                              onTodoCheckChange(todo, nextChecked)
                            }}
                          >
                            <span aria-hidden="true" />
                            <p>{todo.text}</p>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </article>
              ))}
            </section>
          ))
        )}
      </div>
    </aside>
  )
}
