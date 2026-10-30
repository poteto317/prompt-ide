import { useCallback, useEffect, useRef, useState } from 'react'
import { SETTINGS_FILE_ERROR_REASON } from '../lib/settingsMessages'

// 選択式の設定(実行方式・エージェント CLI)の読み込みと保存。変更は楽観的に反映して保存し、失敗したら変更の前の値へ戻す。
// useBooleanSetting とは別にしている: あちらは最後に保存できた値へ戻し、後の変更が始まっていれば戻さない(L-406)ので、
// 続けて変更したときの結果が異なる

export interface UseSavedSettingOptions<TValue, TLoaded> {
  /** 保存された値を読む(描画をまたいで同じ参照を渡す) */
  load: () => Promise<TLoaded>
  /** 読み込みの結果から設定の値を取り出す(描画をまたいで同じ参照を渡す) */
  readValue: (loaded: TLoaded) => TValue
  /** 保存する(描画をまたいで同じ参照を渡す) */
  save: (next: TValue) => Promise<void>
  /** 読み込みに失敗したときの値 */
  defaultValue: TValue
  /** 保存の失敗の文言の接頭辞。後ろに固定の理由(SETTINGS_FILE_ERROR_REASON)を付ける */
  saveErrorPrefix: string
  /** 読み込みの失敗の記録の見出し(console.error の第 1 引数の完全な文字列) */
  loadLogLabel: string
  /** 保存の失敗の記録の見出し(console.error の第 1 引数の完全な文字列) */
  saveLogLabel: string
  /** 読み込みが終わったとき。値の反映と同じ描画に載る(描画をまたいで同じ参照を渡す) */
  onLoaded: (loaded: TLoaded) => void
  /** 読み込みに失敗したとき。既定値の反映と同じ描画に載る(描画をまたいで同じ参照を渡す) */
  onLoadFailed: () => void
  /** 保存に成功したとき(描画をまたいで同じ参照を渡す) */
  onSaved: () => void
}

export interface SavedSettingState<TValue> {
  /** 読み込みが終わるまでは null */
  value: TValue | null
  /** 保存の失敗の文言。次の保存で消える */
  saveError: string | null
  /** 選んですぐ保存する。失敗したら変更の前の値に戻し、false を返す */
  change: (next: TValue) => Promise<boolean>
}

export function useSavedSetting<TValue, TLoaded>({
  load,
  readValue,
  save,
  defaultValue,
  saveErrorPrefix,
  loadLogLabel,
  saveLogLabel,
  onLoaded,
  onLoadFailed,
  onSaved
}: UseSavedSettingOptions<TValue, TLoaded>): SavedSettingState<TValue> {
  const [value, setValue] = useState<TValue | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const valueRef = useRef<TValue | null>(null)

  useEffect(() => {
    let cancelled = false
    load()
      .then((loaded) => {
        if (cancelled) return
        const loadedValue = readValue(loaded)
        valueRef.current = loadedValue
        setValue(loadedValue)
        onLoaded(loaded)
      })
      .catch((err) => {
        console.error(loadLogLabel, err)
        if (cancelled) return
        valueRef.current = defaultValue
        setValue(defaultValue)
        onLoadFailed()
      })
    return () => {
      cancelled = true
    }
  }, [load, readValue, defaultValue, loadLogLabel, onLoaded, onLoadFailed])

  const change = useCallback(
    async (next: TValue): Promise<boolean> => {
      const previous = valueRef.current
      valueRef.current = next
      setValue(next)
      setSaveError(null)
      try {
        await save(next)
        onSaved()
        return true
      } catch (err) {
        // 例外の文言は出さない(settings.json のパスや中身の断片を含みうる。L-017)。記録だけして、理由は固定の文言にする
        console.error(saveLogLabel, err)
        valueRef.current = previous
        setValue(previous)
        setSaveError(`${saveErrorPrefix}${SETTINGS_FILE_ERROR_REASON}`)
        return false
      }
    },
    [save, saveErrorPrefix, saveLogLabel, onSaved]
  )

  return { value, saveError, change }
}
