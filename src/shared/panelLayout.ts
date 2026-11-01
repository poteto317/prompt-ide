// サイドバーの幅(px)とターミナルのパネルの高さ(エディタの領域に対する %)。main の保存と renderer の表示で同じ範囲を使う
export interface PanelLayout {
  sidebarWidth: number
  terminalHeightPercent: number
}

export const SIDEBAR_WIDTH_MIN = 220
export const SIDEBAR_WIDTH_MAX = 600
export const TERMINAL_HEIGHT_PERCENT_MIN = 15
export const TERMINAL_HEIGHT_PERCENT_MAX = 85

export const DEFAULT_PANEL_LAYOUT: PanelLayout = { sidebarWidth: 240, terminalHeightPercent: 45 }

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const isInRange = (value: unknown, min: number, max: number): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

export function isPanelLayout(value: unknown): value is PanelLayout {
  if (typeof value !== 'object' || value === null) return false
  const { sidebarWidth, terminalHeightPercent } = value as Record<string, unknown>
  return (
    isInRange(sidebarWidth, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX) &&
    isInRange(terminalHeightPercent, TERMINAL_HEIGHT_PERCENT_MIN, TERMINAL_HEIGHT_PERCENT_MAX)
  )
}
