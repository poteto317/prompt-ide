import { useCallback, useRef, useState } from 'react'
import type { PromptListMode } from '@shared/types'
import { DEFAULT_PROMPT_LIST_MODE } from '@shared/types'
import type { PromptListModePanelState } from '../types'
import * as settingsApi from '../lib/settingsApi'
import { useSavedSetting } from './useSavedSetting'

/** 一覧のモードの保存の失敗の文言の接頭辞。後ろに固定の理由(SETTINGS_FILE_ERROR_REASON)を付ける。
 *  表示モードへの切り替えにも編集モードへ戻すのにも使うので、モードの名前を入れない */
export const PROMPT_LIST_MODE_SAVE_ERROR_PREFIX = 'モードの設定を保存できませんでした: '

const readLoadedMode = (loaded: PromptListMode): PromptListMode => loaded
const noop = (): void => undefined

export function usePromptListMode(): PromptListModePanelState {
  const { value, saveError, change } = useSavedSetting({
    load: settingsApi.getPromptListMode,
    readValue: readLoadedMode,
    save: settingsApi.setPromptListMode,
    defaultValue: DEFAULT_PROMPT_LIST_MODE,
    saveErrorPrefix: PROMPT_LIST_MODE_SAVE_ERROR_PREFIX,
    // 設定ファイルの JSON が壊れていると main は例外を投げる。一覧を出せなくならないよう、既定(編集モード)で続ける
    loadLogLabel: '[usePromptListMode] getPromptListMode failed:',
    saveLogLabel: '[usePromptListMode] setPromptListMode failed:',
    onLoaded: noop,
    onLoadFailed: noop,
    onSaved: noop
  })
  // 保存の途中の操作は無視する。useSavedSetting は失敗したら「呼び出した時点の値」へ戻すので、続けて 2 回押して両方失敗すると
  // 画面のモードと保存されたモードが食い違う。同期の連打でも二重に始めないよう ref で守り、画面用には isSaving を持つ
  const savingRef = useRef(false)
  const [isSaving, setIsSaving] = useState(false)
  // change は保存の失敗を false で返し、拒否しない(失敗は saveError に出る)。トグルは完了を待たないので結果は捨てる。
  // 解除は成功でも失敗でも行う。change は今は拒否しないが、将来投げる実装に変わっても解除が残らないよう finally にしている(防御)
  const onChange = useCallback(
    (mode: PromptListMode): void => {
      if (savingRef.current) return
      savingRef.current = true
      setIsSaving(true)
      const run = async (): Promise<void> => {
        try {
          await change(mode)
        } finally {
          savingRef.current = false
          setIsSaving(false)
        }
      }
      void run()
    },
    [change]
  )
  return { mode: value, saveError, isSaving, onChange }
}
