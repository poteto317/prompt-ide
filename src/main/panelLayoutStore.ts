import type { PanelLayout } from '@shared/panelLayout'
import { DEFAULT_PANEL_LAYOUT, isPanelLayout } from '@shared/panelLayout'
import { readSettingsFile, writeSettingsFile } from './settingsFileStore'

// サイドバーの幅とターミナルの高さの読み書き(userData/settings.json の panelLayout。ほかの設定と同じファイルにマージで書く)

/** 保存の拒否の文言(値を入れない。L-017) */
const PANEL_LAYOUT_INVALID_ERROR = 'パネルの大きさが不正です'

/** 保存された大きさ。無い・不正なら既定 */
export async function getPanelLayout(): Promise<PanelLayout> {
  const data = await readSettingsFile()
  if (!isPanelLayout(data.panelLayout)) return { ...DEFAULT_PANEL_LAYOUT }
  const { sidebarWidth, terminalHeightPercent } = data.panelLayout
  return { sidebarWidth, terminalHeightPercent }
}

/** 検証してから保存する。不正な値は書かずに投げる */
export async function setPanelLayout(layout: unknown): Promise<void> {
  if (!isPanelLayout(layout)) throw new Error(PANEL_LAYOUT_INVALID_ERROR)
  // 検証した 2 項目だけを保存する(余分なキーを書かない。L-018)
  const { sidebarWidth, terminalHeightPercent } = layout
  await writeSettingsFile({ panelLayout: { sidebarWidth, terminalHeightPercent } })
}
