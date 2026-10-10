'use client'
import { useId } from 'react'

interface Props {
  /** 読み込み中は null(押せない) */
  enabled: boolean | null
  saveError: string | null
  onChange: (enabled: boolean) => void
}

// 設定パネルの「エージェントの通知」(設計書「設定」)。押すとすぐ保存する。チェックボックスの名前は見えているラベルそのもの(L-156)。
// 節の名前はグループの名前に結び付け、Tab でチェックボックスへ移ったときにも読まれるようにする(ExecutionModeSection と同じ形)
export default function AgentNotificationSection({
  enabled,
  saveError,
  onChange
}: Props): React.JSX.Element {
  const labelId = useId()
  const noteId = useId()
  return (
    <div className="settings-panel__section">
      <p className="settings-panel__label" id={labelId}>
        エージェントの通知
      </p>
      <div role="group" aria-labelledby={labelId}>
        <label className="agent-notification-section__option">
          <input
            type="checkbox"
            checked={enabled === true}
            // 読み込み前に押すと、後から届く読み込みで上書きされるため押せなくする
            disabled={enabled === null}
            aria-describedby={noteId}
            onChange={(event) => onChange(event.target.checked)}
          />
          ウィンドウが背面のとき、許可待ち・確認待ち・作業の完了を通知する
        </label>
      </div>
      <p className="settings-panel__note" id={noteId}>
        {
          'Dock のバッジ（macOS）・タスクバーの点滅（Windows・Linux）も、この設定でまとめてオン・オフします。通知が出ないときは、OS の通知の設定も確かめてください'
        }
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
