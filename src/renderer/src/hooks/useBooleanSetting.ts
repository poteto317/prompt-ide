import { useCallback, useEffect, useRef, useState } from 'react'
import { SETTINGS_FILE_ERROR_REASON } from '../lib/settingsMessages'

// 設定画面の真偽値の設定(エージェントの通知・送信前の確認)の読み込みと保存。useExecutionMode と同じ形で、変更は楽観的に反映して
// 保存し、失敗したら最後に保存できた値へ戻す。続けて変えたときは、後の変更の結果に任せる(L-406)

export interface BooleanSettingState {
  /** 読み込みが終わるまでは null */
  enabled: boolean | null
  /** 保存の失敗の文言。次の保存で消える */
  saveError: string | null
  /** すぐ保存する。失敗したら最後に保存できた値に戻し、false を返す */
  changeEnabled: (next: boolean) => Promise<boolean>
}

export interface UseBooleanSettingOptions {
  /** 保存された値を読む(settingsApi の関数。描画をまたいで同じ参照を渡す) */
  load: () => Promise<boolean>
  /** 保存する(settingsApi の関数。描画をまたいで同じ参照を渡す) */
  save: (enabled: boolean) => Promise<void>
  /** 読み込みに失敗したときの値 */
  defaultValue: boolean
  /** 保存の失敗の文言の接頭辞。後ろに固定の理由(SETTINGS_FILE_ERROR_REASON)を付ける */
  saveErrorPrefix: string
  /** 読み込み・保存の失敗を記録するときの見出し(`[useFoo]` の形。後ろに `load failed:`・`save failed:` を付ける) */
  logLabel: string
}

export function useBooleanSetting({
  load,
  save,
  defaultValue,
  saveErrorPrefix,
  logLabel
}: UseBooleanSettingOptions): BooleanSettingState {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  // 最後に保存できた(または読み込んだ)値。失敗したときはここへ戻す
  const savedRef = useRef<boolean | null>(null)
  // 変更の通し番号。後から別の変更が始まっていたら、失敗しても戻さずその結果に任せる
  const changeSeqRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    // 設定ファイルの JSON が壊れていると main は例外を投げる。画面が起動できなくならないよう、既定で続ける
    load()
      .then((loaded) => {
        if (cancelled) return
        savedRef.current = loaded
        setEnabled(loaded)
      })
      .catch((err) => {
        console.error(`${logLabel} load failed:`, err)
        if (cancelled) return
        savedRef.current = defaultValue
        setEnabled(defaultValue)
      })
    return () => {
      cancelled = true
    }
  }, [load, defaultValue, logLabel])

  const changeEnabled = useCallback(
    async (next: boolean): Promise<boolean> => {
      const seq = ++changeSeqRef.current
      setEnabled(next)
      setSaveError(null)
      try {
        await save(next)
        savedRef.current = next
        return true
      } catch (err) {
        // 例外の文言は出さない(settings.json のパスや中身の断片を含みうる。L-017)。記録だけして、理由は固定の文言にする
        console.error(`${logLabel} save failed:`, err)
        // 後から別の変更が始まっていれば、値も失敗の文言もその結果に任せる
        if (seq === changeSeqRef.current) {
          setEnabled(savedRef.current)
          setSaveError(`${saveErrorPrefix}${SETTINGS_FILE_ERROR_REASON}`)
        }
        return false
      }
    },
    [save, saveErrorPrefix, logLabel]
  )

  return { enabled, saveError, changeEnabled }
}
