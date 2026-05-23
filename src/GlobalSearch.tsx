import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { getContentSummary } from './contentUtils'
import type { CellModel } from './store'

type SearchResult = {
  cell: CellModel
  layerTitle: string
  preview: string
  matchedText: boolean
}

type SearchIndexEntry = SearchResult & {
  searchableText: string
}

type LayerSearchResult = {
  layer: number
  title: string
  searchableLayer: string
}

type GlobalSearchProps = {
  cells: CellModel[]
  getLayerTitle: (layer: number) => string
  onActivate: () => void
  onResultSelect: (cell: CellModel) => void
  onLayerSelect: (layer: number) => void
}

export function GlobalSearch({ cells, getLayerTitle, onActivate, onResultSelect, onLayerSelect }: GlobalSearchProps) {
  const searchRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [isResultsOpen, setIsResultsOpen] = useState(false)
  const normalizedQuery = query.trim().toLocaleLowerCase()

  const searchIndex = useMemo<SearchIndexEntry[]>(() => {
    return cells
      .map((cell) => {
        const layerTitle = getLayerTitle(cell.layer)
        const summary = getContentSummary(cell.content)

        return {
          cell,
          layerTitle,
          preview: summary.preview,
          matchedText: false,
          searchableText: summary.text.toLocaleLowerCase(),
        }
      })
  }, [cells, getLayerTitle])

  const layerIndex = useMemo<LayerSearchResult[]>(() => {
    const layers = [...new Set(cells.map((cell) => cell.layer))]

    return layers
      .map((layer) => {
        const title = getLayerTitle(layer)

        return {
          layer,
          title,
          searchableLayer: title.toLocaleLowerCase(),
        }
      })
      .sort((a, b) => b.layer - a.layer)
  }, [cells, getLayerTitle])

  const results = useMemo<SearchResult[]>(() => {
    if (!normalizedQuery) {
      return []
    }

    return searchIndex
      .map((result) => ({
        ...result,
        matchedText: result.searchableText.includes(normalizedQuery),
      }))
      .filter((result) => result.matchedText)
      .sort((a, b) => {
        if (a.cell.layer !== b.cell.layer) {
          return b.cell.layer - a.cell.layer
        }

        return 0
      })
  }, [normalizedQuery, searchIndex])

  const layerResults = useMemo<LayerSearchResult[]>(() => {
    if (!normalizedQuery) {
      return []
    }

    return layerIndex.filter((result) => result.searchableLayer.includes(normalizedQuery))
  }, [layerIndex, normalizedQuery])

  const isOpen = query.length > 0 && isResultsOpen
  const hasResults = layerResults.length > 0 || results.length > 0

  const renderResult = ({ cell, layerTitle, preview }: SearchResult) => (
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
        <span className="global-search-layer-title">{layerTitle}</span>
      </span>
      <span className="global-search-preview">{preview || 'Empty cell'}</span>
    </button>
  )

  const renderLayerResult = ({ layer, title }: LayerSearchResult) => (
    <button
      key={layer}
      className="global-search-result global-search-layer-result"
      type="button"
      onClick={() => {
        onLayerSelect(layer)
        setQuery('')
        inputRef.current?.blur()
      }}
    >
      <span className="global-search-layer">
        <b>{layer}</b>
        <span className="global-search-layer-title">{title}</span>
      </span>
    </button>
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      const isEditableTarget = target?.closest('input, textarea, [contenteditable="true"]')

      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'f') {
        event.preventDefault()
        onActivate()
        setIsResultsOpen(true)
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
        setIsResultsOpen(true)
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

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null

      if (!target || searchRef.current?.contains(target)) {
        return
      }

      setIsResultsOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown, { capture: true })

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
    }
  }, [])

  return (
    <section ref={searchRef} className={`global-search ${isOpen ? 'is-open' : ''}`} aria-label="Global cell search">
      {isOpen && (
        <div className="global-search-results">
          {!hasResults ? (
            <p className="global-search-empty">No matching cells or layers</p>
          ) : (
            <>
              {layerResults.length > 0 && (
                <section className="global-search-section" aria-label="Layer matches">
                  <h3>Layers</h3>
                  {layerResults.map(renderLayerResult)}
                </section>
              )}
              {results.length > 0 && (
                <section className="global-search-section" aria-label="Cell matches">
                  <h3>Cells</h3>
                  {results.map(renderResult)}
                </section>
              )}
            </>
          )}
        </div>
      )}

      <label
        className="global-search-input"
        onPointerDownCapture={() => {
          onActivate()
          setIsResultsOpen(true)
        }}
      >
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          placeholder="Search cells"
          aria-label="Search cells"
          onChange={(event) => {
            setQuery(event.target.value)
            setIsResultsOpen(true)
          }}
          onFocus={() => {
            if (query) {
              setIsResultsOpen(true)
            }
          }}
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
              setIsResultsOpen(false)
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
