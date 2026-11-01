import {
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  TERMINAL_HEIGHT_PERCENT_MAX,
  TERMINAL_HEIGHT_PERCENT_MIN,
  clampNumber
} from '@shared/panelLayout'

// 今の画面で実際に取れるパネルの大きさの範囲。CSS の .sidebar の max-width と .agent-terminal-panel--open の min-height と
// 同じ値を使う(CSS で止まっている間に値だけが動かないように、操作と aria の値をこの範囲に揃える)

export interface PanelSizeLimits {
  min: number
  max: number
}

/** エディタの領域の最小 352px とアクティビティバーの 48px */
const SIDEBAR_RESERVED_WIDTH = 400
const TERMINAL_MIN_HEIGHT = 160

export function sidebarWidthLimits(windowWidth: number): PanelSizeLimits {
  return {
    min: SIDEBAR_WIDTH_MIN,
    max: clampNumber(windowWidth - SIDEBAR_RESERVED_WIDTH, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX)
  }
}

export function terminalHeightLimits(editorAreaHeight: number): PanelSizeLimits {
  const percent =
    editorAreaHeight > 0 ? Math.ceil((TERMINAL_MIN_HEIGHT / editorAreaHeight) * 100) : 0
  return {
    min: clampNumber(percent, TERMINAL_HEIGHT_PERCENT_MIN, TERMINAL_HEIGHT_PERCENT_MAX),
    max: TERMINAL_HEIGHT_PERCENT_MAX
  }
}
