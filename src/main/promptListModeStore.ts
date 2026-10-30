import type { PromptListMode } from '@shared/types'
import { DEFAULT_PROMPT_LIST_MODE, isPromptListMode } from '@shared/types'
import { readSettingsFile, writeSettingsFile } from './settingsFileStore'

// プロンプト一覧の編集モード / 表示モードの読み書き(userData/settings.json の promptListMode。executionModeStore と同じ形で、
// ほかの設定と同じファイルにマージで書く)

/** 保存の拒否の文言(値を入れない。L-017) */
const PROMPT_LIST_MODE_INVALID_ERROR = 'プロンプト一覧のモードが不正です'

/** 保存されたモード。無い・不正なら既定(edit) */
export async function getPromptListMode(): Promise<PromptListMode> {
  const data = await readSettingsFile()
  return isPromptListMode(data.promptListMode) ? data.promptListMode : DEFAULT_PROMPT_LIST_MODE
}

/** 検証してから保存する。不正な値は書かずに投げる */
export async function setPromptListMode(mode: unknown): Promise<void> {
  if (!isPromptListMode(mode)) throw new Error(PROMPT_LIST_MODE_INVALID_ERROR)
  await writeSettingsFile({ promptListMode: mode })
}
