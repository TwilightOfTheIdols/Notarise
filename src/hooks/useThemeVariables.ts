import { useEffect } from 'react'
import type { Theme } from '../store'
import { getTemperatureColors, rgbTriplet } from '../palettes'

export function useThemeVariables(theme: Theme, colorTemperature: number) {
  useEffect(() => {
    const root = document.documentElement
    const colors = getTemperatureColors(theme, colorTemperature)
    const textRgb = rgbTriplet(colors.text)
    const trimRgb = rgbTriplet(colors.trim)

    root.dataset.theme = theme
    root.style.setProperty('--canvas-bg', colors.canvas)
    root.style.setProperty('--canvas-bg-rgb', rgbTriplet(colors.canvas))
    root.style.setProperty('--text', colors.text)
    root.style.setProperty('--text-rgb', textRgb)
    root.style.setProperty('--cell-bg', colors.cell)
    root.style.setProperty('--cell-bg-rgb', rgbTriplet(colors.cell))
    root.style.setProperty('--trim', colors.trim)
    root.style.setProperty('--trim-rgb', trimRgb)
    root.style.setProperty('--muted', `rgb(${textRgb} / ${theme === 'dark' ? 0.62 : 0.58})`)
    root.style.setProperty('--faint', `rgb(${textRgb} / ${theme === 'dark' ? 0.14 : 0.12})`)
    root.style.setProperty('--hairline', `rgb(${trimRgb} / ${theme === 'dark' ? 0.16 : 0.12})`)
    root.style.setProperty('--active-line', `rgb(${trimRgb} / ${theme === 'dark' ? 0.42 : 0.34})`)
    root.style.setProperty('--control-bg', `rgb(${trimRgb} / ${theme === 'dark' ? 0.12 : 0.075})`)
    root.style.setProperty('--control-hover', `rgb(${trimRgb} / ${theme === 'dark' ? 0.2 : 0.13})`)
    root.style.setProperty('--dot-color', `rgb(${trimRgb} / ${theme === 'dark' ? 0.44 : 0.36})`)
  }, [colorTemperature, theme])
}
