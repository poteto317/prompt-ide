import type { ViewportCell, ViewportLine } from '../../agentViewport'
import data from './agentScreens.json'

// claude の画面の記録(agentScreens.json。既存の 28 画面は claude 2.1.288、中断を記録した 4 画面（streamingQueued は中断の前）は claude 2.1.291)を、行の配列にする。lines は 行番号 → [文字列, dim の範囲, 反転の範囲]
// (範囲は [開始, 終わり) のセルの位置)。記録の手順・個人情報の置き換え・claude の版を上げたときの記録し直しは、
// 同じディレクトリの README.md

/** 記録の 1 行(文字列・dim の範囲・反転の範囲)。copilot の記録(copilotScreens.ts)も同じ形式 */
type RawLine = [string, number[][]?, number[][]?]
/** 記録の 1 画面(空行は lines に無い) */
export interface RawScreen {
  cols: number
  rows: number
  lines: Record<string, RawLine>
}

export type AgentScreenName = keyof typeof data.screens

const inRanges = (ranges: number[][] | undefined, index: number): boolean =>
  (ranges ?? []).some(([start, end]) => index >= start && index < end)

/** 文字列と範囲から行を作る(テストの手書きの画面にも使う) */
export function makeLine(text: string, dim?: number[][], inverse?: number[][]): ViewportLine {
  return [...text].map(
    (char, index): ViewportCell => ({
      char,
      dim: inRanges(dim, index),
      inverse: inRanges(inverse, index)
    })
  )
}

/** 記録の画面(行は画面の高さの分、空行は []) */
export interface RecordedScreen {
  cols: number
  rows: number
  lines: ViewportLine[]
}

/** 記録の 1 画面を行の配列にする(claude・copilot の記録で共通) */
export function toRecordedScreen(screen: RawScreen): RecordedScreen {
  const lines: ViewportLine[] = []
  for (let y = 0; y < screen.rows; y++) {
    const raw = screen.lines[String(y)]
    lines.push(raw === undefined ? [] : makeLine(raw[0], raw[1], raw[2]))
  }
  return { cols: screen.cols, rows: screen.rows, lines }
}

export function agentScreen(name: AgentScreenName): RecordedScreen {
  return toRecordedScreen(data.screens[name] as unknown as RawScreen)
}
