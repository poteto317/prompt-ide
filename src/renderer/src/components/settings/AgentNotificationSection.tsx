'use client'
import type { AgentNotificationPanelState } from '../../types'
import BooleanSettingSection from './BooleanSettingSection'

// 設定パネルの「エージェントの通知」(設計書「設定」)。表示と状態の出し分けは BooleanSettingSection が持ち、ここは文言だけ。
// 選んだ CLI が画面を判定しない(copilot)ときは、通知を出さない旨の注記を添える(設計書 2026-10-20「入口ごとの表」)
export default function AgentNotificationSection({
  unsupportedNote,
  ...props
}: AgentNotificationPanelState): React.JSX.Element {
  return (
    <BooleanSettingSection
      title="エージェントの通知"
      optionLabel="ウィンドウが背面のとき、許可待ち・確認待ち・作業の完了を通知する"
      note="Dock のバッジ（macOS）・タスクバーの点滅（Windows・Linux）も、この設定でまとめてオン・オフします。通知が出ないときは、OS の通知の設定も確かめてください"
      extraNote={unsupportedNote}
      {...props}
    />
  )
}
