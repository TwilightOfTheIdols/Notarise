import type { Theme } from './store'

export type TemperatureColors = {
  canvas: string
  cell: string
  text: string
  trim: string
}

const TEMPERATURE_ENDPOINTS: Record<Theme, {
  neutral: TemperatureColors
  warm: TemperatureColors
}> = {
  light: {
    neutral: { canvas: '#ffffff', cell: '#ffffff', text: '#000000', trim: '#000000' },
    warm: { canvas: '#fff0ce', cell: '#fff4da', text: '#000000', trim: '#000000' },
  },
  dark: {
    neutral: { canvas: '#000000', cell: '#000000', text: '#ffffff', trim: '#ffffff' },
    warm: { canvas: '#100c06', cell: '#19140c', text: '#f6e6c8', trim: '#e7d0a8' },
  },
}

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value))
}

export const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized, 16)

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

const rgbToHex = ({ r, g, b }: { r: number; g: number; b: number }) => {
  return `#${[r, g, b]
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`
}

const mixHex = (from: string, to: string, amount: number) => {
  const start = hexToRgb(from)
  const end = hexToRgb(to)

  return rgbToHex({
    r: start.r + (end.r - start.r) * amount,
    g: start.g + (end.g - start.g) * amount,
    b: start.b + (end.b - start.b) * amount,
  })
}

export const getTemperatureColors = (theme: Theme, temperature: number): TemperatureColors => {
  const amount = clamp(temperature, 0, 100) / 100
  const endpoints = TEMPERATURE_ENDPOINTS[theme]

  return {
    canvas: mixHex(endpoints.neutral.canvas, endpoints.warm.canvas, amount),
    cell: mixHex(endpoints.neutral.cell, endpoints.warm.cell, amount),
    text: mixHex(endpoints.neutral.text, endpoints.warm.text, amount),
    trim: mixHex(endpoints.neutral.trim, endpoints.warm.trim, amount),
  }
}

export const rgbTriplet = (hex: string) => {
  const { r, g, b } = hexToRgb(hex)
  return `${r} ${g} ${b}`
}
