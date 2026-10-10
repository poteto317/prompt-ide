'use client'
import { useId } from 'react'
import type { BooleanSettingPanelState } from '../../types'

interface Props extends BooleanSettingPanelState {
  /** 節の名前(グループの名前になる) */
  title: string
  /** チェックボックスの見えているラベル(そのまま名前になる) */
  optionLabel: string
  /** チェックボックスの説明 */
  note: string
}

// 設定パネルの、チェックボックス 1 つでオン・オフする節(useBooleanSetting の値を出す)。押すとすぐ保存する。
// チェックボックスの名前は見えているラベルそのもの(L-156)。節の名前はグループの名前に結び付け、Tab でチェックボックスへ
// 移ったときにも読まれるようにする(ExecutionModeSection と同じ形)
export default function BooleanSettingSection({
  title,
  optionLabel,
  note,
  enabled,
  saveError,
  onChange
}: Props): React.JSX.Element {
  const labelId = useId()
  const noteId = useId()
  return (
    <div className="settings-panel__section">
      <p className="settings-panel__label" id={labelId}>
        {title}
      </p>
      <div role="group" aria-labelledby={labelId}>
        <label className="boolean-setting-section__option">
          <input
            type="checkbox"
            checked={enabled === true}
            // 読み込み前に押すと、後から届く読み込みで上書きされるため押せなくする
            disabled={enabled === null}
            aria-describedby={noteId}
            onChange={(event) => onChange(event.target.checked)}
          />
          {optionLabel}
        </label>
      </div>
      <p className="settings-panel__note" id={noteId}>
        {note}
      </p>
      {enabled === null && <p className="settings-panel__status">読み込み中...</p>}
      {saveError !== null && (
        <p className="settings-panel__error" role="alert">
          {saveError}
        </p>
      )}
    </div>
  )
}
