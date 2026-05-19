import { Download, Moon, RotateCcw, Sun, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { DocumentSettings, SearchAnimationPreset, Theme } from './store'

const SEARCH_ANIMATION_PRESETS: Array<{
  id: SearchAnimationPreset
  label: string
}> = [
  { id: 'normal', label: 'Normal' },
  { id: 'instant', label: 'Instant' },
]

type SettingsPanelProps = {
  isOpen: boolean
  theme: Theme
  settings: DocumentSettings
  onClose: () => void
  onThemeChange: (theme: Theme) => void
  onSettingsChange: (settings: Partial<DocumentSettings>) => void
  onResetSettings: () => void
  onExportDocument: () => void
  onImportDocument: (file: File) => Promise<void>
}

export function SettingsPanel({
  isOpen,
  theme,
  settings,
  onClose,
  onThemeChange,
  onSettingsChange,
  onResetSettings,
  onExportDocument,
  onImportDocument,
}: SettingsPanelProps) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const backgroundTransparency = 100 - settings.backgroundLayerBrightness

  const handleImportFile = async (file: File | undefined) => {
    if (!file) {
      return
    }

    setImportError(null)

    try {
      await onImportDocument(file)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not import this file.')
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = ''
      }
    }
  }

  return (
    <aside className={`settings-panel ${isOpen ? 'is-open' : ''}`} aria-label="Settings" aria-hidden={!isOpen}>
      <div className="settings-panel-header">
        <h2>Settings</h2>
        <button className="icon-button" type="button" onClick={onClose} title="Close settings" aria-label="Close settings">
          <X size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="settings-list">
        <section className="settings-group">
          <h3>Appearance</h3>
          <div className="theme-toggle" role="group" aria-label="Theme">
            <button
              type="button"
              className={theme === 'light' ? 'is-active' : undefined}
              onClick={() => onThemeChange('light')}
            >
              <Sun size={15} aria-hidden="true" />
              <span>Light</span>
            </button>
            <button
              type="button"
              className={theme === 'dark' ? 'is-active' : undefined}
              onClick={() => onThemeChange('dark')}
            >
              <Moon size={15} aria-hidden="true" />
              <span>Dark</span>
            </button>
          </div>
          <label className="settings-field">
            <span>Color temperature</span>
            <div className="settings-slider-row">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={settings.colorTemperature}
                onChange={(event) => onSettingsChange({ colorTemperature: Number(event.target.value) })}
              />
              <output>{Math.round(settings.colorTemperature)}%</output>
            </div>
          </label>
        </section>

        <section className="settings-group">
          <h3>Search animation</h3>
          <label className="settings-field">
            <span>Speed</span>
            <select
              value={settings.searchAnimationPreset}
              onChange={(event) => onSettingsChange({ searchAnimationPreset: event.target.value as SearchAnimationPreset })}
            >
              {SEARCH_ANIMATION_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.label}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="settings-group">
          <h3>Layers</h3>
          <label className="settings-field">
            <span>Pan depth</span>
            <div className="settings-slider-row">
              <input
                type="range"
                min="0"
                max="5"
                step="0.25"
                value={settings.layerPanDepth}
                onChange={(event) => onSettingsChange({ layerPanDepth: Number(event.target.value) })}
              />
              <output>{settings.layerPanDepth.toFixed(2)}%</output>
            </div>
          </label>
          <label className="settings-field">
            <span>Background transparency</span>
            <div className="settings-slider-row">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={backgroundTransparency}
                onChange={(event) => onSettingsChange({ backgroundLayerBrightness: 100 - Number(event.target.value) })}
              />
              <output>{Math.round(backgroundTransparency)}%</output>
            </div>
          </label>
          <label className="settings-field">
            <span>Background blur</span>
            <div className="settings-slider-row">
              <input
                type="range"
                min="0"
                max="10"
                step="0.5"
                value={settings.backgroundLayerBlur}
                onChange={(event) => onSettingsChange({ backgroundLayerBlur: Number(event.target.value) })}
              />
              <output>{settings.backgroundLayerBlur.toFixed(1)}px</output>
            </div>
          </label>
        </section>

        <section className="settings-group">
          <h3>Document</h3>
          <div className="settings-action-row">
            <button type="button" onClick={onExportDocument}>
              <Download size={15} aria-hidden="true" />
              <span>Export</span>
            </button>
            <button type="button" onClick={() => importInputRef.current?.click()}>
              <Upload size={15} aria-hidden="true" />
              <span>Import</span>
            </button>
          </div>
          <input
            ref={importInputRef}
            className="settings-file-input"
            type="file"
            accept=".notarise,application/json"
            onChange={(event) => void handleImportFile(event.target.files?.[0])}
          />
          {importError && <p className="settings-error">{importError}</p>}
        </section>

        <section className="settings-group settings-defaults-group">
          <h3>Defaults</h3>
          <button className="settings-reset-button" type="button" onClick={onResetSettings}>
            <RotateCcw size={15} aria-hidden="true" />
            <span>Reset settings to defaults</span>
          </button>
        </section>
      </div>
    </aside>
  )
}
