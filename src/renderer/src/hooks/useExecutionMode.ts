import { useCallback, useEffect, useRef, useState } from 'react'
import type { PromptExecutionMode } from '@shared/types'
import { DEFAULT_PROMPT_EXECUTION_MODE } from '@shared/types'
import * as settingsApi from '../lib/settingsApi'
import { SETTINGS_FILE_ERROR_REASON } from '../lib/settingsMessages'

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

export function useExecutionMode(): ExecutionModeState {
  const [mode, setMode] = useState<PromptExecutionMode | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const modeRef = useRef<PromptExecutionMode | null>(null)

  useEffect(() => {
    let cancelled = false
    // 設定ファイルの JSON が壊れていると main は例外を投げる。画面が起動できなくならないよう、既定の方式で続ける
    settingsApi
      .getPromptExecutionMode()
      .then((loaded) => {
        if (cancelled) return
        modeRef.current = loaded
        setMode(loaded)
      })
      .catch((err) => {
        console.error('[useExecutionMode] getPromptExecutionMode failed:', err)
        if (cancelled) return
        modeRef.current = DEFAULT_PROMPT_EXECUTION_MODE
        setMode(DEFAULT_PROMPT_EXECUTION_MODE)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const changeMode = useCallback(async (next: PromptExecutionMode): Promise<boolean> => {
    const previous = modeRef.current
    modeRef.current = next
    setMode(next)
    setSaveError(null)
    try {
      await settingsApi.setPromptExecutionMode(next)
      return true
    } catch (err) {
      // 例外の文言は出さない(settings.json のパスや中身の断片を含みうる。L-017)。記録だけして、理由は固定の文言にする
      console.error('[useExecutionMode] setPromptExecutionMode failed:', err)
      modeRef.current = previous
      setMode(previous)
      setSaveError(`${EXECUTION_MODE_SAVE_ERROR_PREFIX}${SETTINGS_FILE_ERROR_REASON}`)
      return false
    }
  }, [])

  return { mode, saveError, changeMode }
}
