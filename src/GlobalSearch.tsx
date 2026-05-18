import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { extractTextPreview, getContentText } from './contentUtils'
import type { CellModel } from './store'

type SearchResult = {
  cell: CellModel
  layerTitle: string
  preview: string
  matchedLayer: boolean
}

type GlobalSearchProps = {
  cells: CellModel[]
  getLayerTitle: (layer: number) => string
  onActivate: () => void
  onResultSelect: (cell: CellModel) => void
}

export function GlobalSearch({ cells, getLayerTitle, onActivate, onResultSelect }: GlobalSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()

  const results = useMemo<SearchResult[]>(() => {
    if (!normalizedQuery) {
      return []
    }

    return cells
      .map((cell) => {
        const layerTitle = getLayerTitle(cell.layer)
        const searchableText = getContentText(cell.content).toLocaleLowerCase()
        const searchableLayer = layerTitle.toLocaleLowerCase()
        const matchedText = searchableText.includes(normalizedQuery)
        const matchedLayer = searchableLayer.includes(normalizedQuery)

        return {
          cell,
          layerTitle,
          preview: extractTextPreview(cell.content),
          matchedLayer,
          matchedText,
        }
      })
      .filter((result) => result.matchedText || result.matchedLayer)
      .sort((a, b) => {
        if (a.matchedLayer !== b.matchedLayer) {
          return a.matchedLayer ? -1 : 1
        }

        if (a.cell.layer !== b.cell.layer) {
          return b.cell.layer - a.cell.layer
        }

        return 0
      })
  }, [cells, getLayerTitle, normalizedQuery])

  const isOpen = query.length > 0

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      const isEditableTarget = target?.closest('input, textarea, [contenteditable="true"]')

      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'f') {
        event.preventDefault()
        onActivate()
        inputRef.current?.focus()
        inputRef.current?.select()
        return
      }

      if (event.key === 'Escape' && document.activeElement === inputRef.current) {
        event.preventDefault()
        setQuery('')
        inputRef.current?.blur()
        return
      }

      if (
        !isEditableTarget &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key.length === 1 &&
        /^[\w\s]$/u.test(event.key)
      ) {
        event.preventDefault()
        onActivate()
        setQuery(event.key)
        window.requestAnimationFrame(() => {
          inputRef.current?.focus()
          inputRef.current?.setSelectionRange(1, 1)
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [onActivate])

  return (
    <section className={`global-search ${isOpen ? 'is-open' : ''}`} aria-label="Global cell search">
      {isOpen && (
        <div className="global-search-results">
          {results.length === 0 ? (
            <p className="global-search-empty">No matching cells or layers</p>
          ) : (
            results.map(({ cell, layerTitle, preview, matchedLayer }) => (
              <button
                key={cell.id}
                className="global-search-result"
                type="button"
                onClick={() => {
                  onResultSelect(cell)
                  setQuery('')
                  inputRef.current?.blur()
                }}
              >
                <span className="global-search-layer">
                  <b>{cell.layer}</b>
                  {layerTitle}
                  {matchedLayer && <small>Layer</small>}
                </span>
                <span className="global-search-preview">{preview || 'Empty cell'}</span>
              </button>
            ))
          )}
        </div>
      )}

      <label
        className="global-search-input"
        onPointerDownCapture={() => onActivate()}
      >
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          placeholder="Search cells"
          aria-label="Search cells"
          onChange={(event) => setQuery(event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
        />
        {query && (
          <button
            type="button"
            title="Clear search"
            aria-label="Clear search"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </label>
    </section>
  )
}
