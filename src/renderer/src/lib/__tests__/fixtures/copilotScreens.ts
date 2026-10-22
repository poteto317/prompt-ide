import { toRecordedScreen } from './agentScreens'
import type { RawScreen, RecordedScreen } from './agentScreens'
import data from './copilotScreens.json'

// copilot の画面の記録(copilotScreens.json。GitHub Copilot CLI 1.0.87 で記録した 48 画面)を、行の配列にする。形式は
// agentScreens.ts と同じで、行の配列にするのも agentScreens.ts の toRecordedScreen(lines は 行番号 → [文字列, dim の範囲, 反転の範囲]。範囲は [開始, 終わり) のセルの位置)。
// 記録の手順・個人情報の置き換え・copilot の版を上げたときの記録し直しは、同じディレクトリの README.md

export type CopilotScreenName = keyof typeof data.screens

export function copilotScreen(name: CopilotScreenName): RecordedScreen {
  return toRecordedScreen(data.screens[name] as unknown as RawScreen)
}
