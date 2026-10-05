import type { PromptExecutionMode } from '@shared/types'
import { DEFAULT_PROMPT_EXECUTION_MODE, isPromptExecutionMode } from '@shared/types'
import { readSettingsFile, writeSettingsFile } from './settingsFileStore'

// プロンプトの実行方式の読み書き(userData/settings.json の promptExecutionMode。API キー・モデルと同じファイルにマージで書く)

/** 保存された実行方式。無い・不正なら既定(agent-cli) */
export async function getPromptExecutionMode(): Promise<PromptExecutionMode> {
  const data = await readSettingsFile()
  return isPromptExecutionMode(data.promptExecutionMode)
    ? data.promptExecutionMode
    : DEFAULT_PROMPT_EXECUTION_MODE
}

/** 検証してから保存する。不正な値は投げる */
export async function setPromptExecutionMode(mode: unknown): Promise<void> {
  if (!isPromptExecutionMode(mode)) {
    throw new Error(`実行方式が不正です: ${String(mode)}`)
  }
  await writeSettingsFile({ promptExecutionMode: mode })
}
