import { ScrollText, Settings } from 'lucide-react'

type ToolbarProps = {
  activeLayer: number
  layerTitleValue: string
  layerTitlePlaceholder: string
  zoomPercent: number
  isSettingsOpen: boolean
  onLayerTitleChange: (value: string) => void
  onToggleSettings: () => void
}

export function Toolbar({
  activeLayer,
  layerTitleValue,
  layerTitlePlaceholder,
  zoomPercent,
  isSettingsOpen,
  onLayerTitleChange,
  onToggleSettings,
}: ToolbarProps) {
  return (
    <header className="toolbar" aria-label="Document controls">
      <div className="brand">
        <ScrollText size={18} aria-hidden="true" />
        <span>Notarise</span>
      </div>
      <div className="layer-title-cluster">
        <span className="layer-number-prefix">{activeLayer}</span>
        <label className="layer-title-field">
          <input
            value={layerTitleValue}
            placeholder={layerTitlePlaceholder}
            aria-label="Layer title"
            onChange={(event) => onLayerTitleChange(event.target.value)}
          />
        </label>
        <span className="zoom-readout">{zoomPercent}%</span>
      </div>
      <button
        className={`icon-button ${isSettingsOpen ? 'is-active' : ''}`}
        type="button"
        onClick={onToggleSettings}
        title="Settings"
        aria-label="Settings"
        aria-pressed={isSettingsOpen}
      >
        <Settings size={18} aria-hidden="true" />
      </button>
    </header>
  )
}
