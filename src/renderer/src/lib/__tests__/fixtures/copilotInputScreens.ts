import type { ViewportLine } from '../../agentViewport'
import { makeLine, toRecordedScreen } from './agentScreens'
import type { RawScreen, RecordedScreen } from './agentScreens'
import data from './copilotInputScreens.json'

// copilot の入力欄の記録(copilotInputScreens.json。GitHub Copilot CLI 1.0.87 の段階 2b の追加の記録から選んだ 45 画面と 6 つの列)を、
// 行の配列にする。画面の形式は copilotScreens.json と同じ(lines は 行番号 → [文字列, dim の範囲, 反転の範囲])で、行の配列にするのも
// agentScreens.ts の toRecordedScreen。列(sequences)は書き込みからの時刻と画面の末尾の行の文字列(属性なし)。
// 記録の手順・個人情報の置き換え・copilot の版を上げたときの記録し直しは、同じディレクトリの README.md

export type CopilotInputScreenName = keyof typeof data.screens
export type CopilotInputSequenceName = keyof typeof data.sequences

/** 列の 1 つの画面(書き込みからの時刻と、その時点の画面の末尾の行) */
export interface CopilotInputFrame {
  /** 書き込み(Enter・Esc・Ctrl+C)からの ms */
  dt: number
  lines: ViewportLine[]
}

export function copilotInputScreen(name: CopilotInputScreenName): RecordedScreen {
  return toRecordedScreen(data.screens[name] as unknown as RawScreen)
}

/** 文字列の行から、属性の無い画面の行を作る(列の画面と、テストの手書きの画面に使う) */
export function screenFromTexts(texts: readonly string[]): ViewportLine[] {
  return texts.map((text) => makeLine(text))
}

export function copilotInputSequence(name: CopilotInputSequenceName): CopilotInputFrame[] {
  return data.sequences[name].frames.map((frame) => ({
    dt: frame.dt,
    lines: screenFromTexts(frame.lines)
  }))
}
