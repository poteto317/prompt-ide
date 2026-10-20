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
  /** 説明の後ろに添える注記(選んだ CLI で使えない旨など)。説明と同じくチェックボックスから参照する。無ければ出さない */
  extraNote?: string | null
}

// 設定パネルの、チェックボックス 1 つでオン・オフする節(useBooleanSetting の値を出す)。押すとすぐ保存する。
// チェックボックスの名前は見えているラベルそのもの(L-156)。節の名前はグループの名前に結び付け、Tab でチェックボックスへ
// 移ったときにも読まれるようにする(ExecutionModeSection と同じ形)
export default function BooleanSettingSection({
  title,
  optionLabel,
  note,
  extraNote = null,
  enabled,
  saveError,
  onChange
}: Props): React.JSX.Element {
  const labelId = useId()
  const noteId = useId()
  const extraNoteId = useId()
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
            // 注記もチェックボックスの説明に含める(Tab で移ったときに、選んだ CLI では効かない旨も読まれるように)
            aria-describedby={extraNote !== null ? `${noteId} ${extraNoteId}` : noteId}
            onChange={(event) => onChange(event.target.checked)}
          />
          {optionLabel}
        </label>
      </div>
      <p className="settings-panel__note" id={noteId}>
        {note}
      </p>
      {extraNote !== null && (
        <p className="settings-panel__note" id={extraNoteId}>
          {extraNote}
        </p>
      )}
      {enabled === null && <p className="settings-panel__status">読み込み中...</p>}
      {saveError !== null && (
        <p className="settings-panel__error" role="alert">
          {saveError}
        </p>
      )}
    </div>
  )
}
