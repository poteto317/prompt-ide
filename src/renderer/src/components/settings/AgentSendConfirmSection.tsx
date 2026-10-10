'use client'
import type { AgentSendConfirmPanelState } from '../../types'
import BooleanSettingSection from './BooleanSettingSection'

// 設定パネルの「送信前の確認」(設計書「設定」)。表示と状態の出し分けは BooleanSettingSection が持ち、ここは文言だけ
export default function AgentSendConfirmSection(
  props: AgentSendConfirmPanelState
): React.JSX.Element {
  return (
    <BooleanSettingSection
      title="送信前の確認"
      optionLabel="エージェントへ送る前に、送る内容を確認する"
      note="変数を差し込んだ後の全文と送り先のタブを確かめてから送ります"
      {...props}
    />
  )
}
