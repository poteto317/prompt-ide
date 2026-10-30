import type { PromptExecutionMode } from '@shared/types'
import { DEFAULT_PROMPT_EXECUTION_MODE } from '@shared/types'
import * as settingsApi from '../lib/settingsApi'
import { useSavedSetting } from './useSavedSetting'

/** 実行方式の保存の失敗の文言の接頭辞。後ろに固定の理由(SETTINGS_FILE_ERROR_REASON)を付ける */
export const EXECUTION_MODE_SAVE_ERROR_PREFIX = '実行方式を保存できませんでした: '

export interface ExecutionModeState {
  /** 読み込みが終わるまでは null(実行ボタンを押せない) */
  mode: PromptExecutionMode | null
  /** 保存の失敗の文言。次の保存で消える */
  saveError: string | null
  /** 選んですぐ保存する。失敗したら保存前の値に戻し、false を返す */
  changeMode: (next: PromptExecutionMode) => Promise<boolean>
}

const readLoadedMode = (loaded: PromptExecutionMode): PromptExecutionMode => loaded
const noop = (): void => undefined

export function useExecutionMode(): ExecutionModeState {
  const { value, saveError, change } = useSavedSetting({
    load: settingsApi.getPromptExecutionMode,
    readValue: readLoadedMode,
    save: settingsApi.setPromptExecutionMode,
    defaultValue: DEFAULT_PROMPT_EXECUTION_MODE,
    saveErrorPrefix: EXECUTION_MODE_SAVE_ERROR_PREFIX,
    // 設定ファイルの JSON が壊れていると main は例外を投げる。画面が起動できなくならないよう、既定の方式で続ける
    loadLogLabel: '[useExecutionMode] getPromptExecutionMode failed:',
    saveLogLabel: '[useExecutionMode] setPromptExecutionMode failed:',
    onLoaded: noop,
    onLoadFailed: noop,
    onSaved: noop
  })
  return { mode: value, saveError, changeMode: change }
}
