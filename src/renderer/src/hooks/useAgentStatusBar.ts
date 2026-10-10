import { useMemo } from 'react'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentActivitySummaryItem, SummaryTab } from '../lib/agentActivitySummary'
import {
  needsAgentAttention,
  pickWaitingTab,
  summarizeAgentActivities
} from '../lib/agentActivitySummary'

// ステータスバーのエージェントのまとめ(設計書「表示」のステータスバー)。まとめの組み立てと、押したときに移るタブの選択を受け持つ。
// 数え方・選ぶタブの優先・文言は agentActivitySummary に、タブへ移る(パネルを開く・選ぶ・フォーカス)処理は useAgentTabActivation に任せる

// ステータスバーのエージェントのまとめ(useAgentWorkspace が組み立て、App → StatusBar へ渡す)。エージェント CLI 方式でなければ null。
// lib のまとめの型を含むため、共通の型(types.ts。lib などに依存しない)ではなく組み立てる hook に置く
export interface AgentStatusBarState {
  /** running のタブの活動のまとめ(空なら出さない) */
  items: AgentActivitySummaryItem[]
  /** 許可待ち・確認待ちがある(強調の色) */
  needsAttention: boolean
  /** パネルを開き、利用者を待っているタブ(許可待ち・確認待ち・入力待ち)を選んでターミナルへフォーカスを移す */
  onActivate: () => void
}

export interface UseAgentStatusBarOptions {
  /** エージェント CLI 方式か(でなければ null を返す) */
  enabled: boolean
  tabs: readonly SummaryTab[]
  /** 選択中のタブの slotId(押したときに同じ活動なら選択中のタブを選ぶ) */
  selectedSlotId: string
  activities: ReadonlyMap<string, AgentActivity>
  /** パネルを開く(最大化は変えない)。当たるタブが無いときに使う */
  openPanel: () => void
  /** パネルを開き、タブを選び、描画の後にそのターミナルへフォーカスを移す(useAgentTabActivation) */
  activateTab: (slotId: string) => void
}

export function useAgentStatusBar({
  enabled,
  tabs,
  selectedSlotId,
  activities,
  openPanel,
  activateTab
}: UseAgentStatusBarOptions): AgentStatusBarState | null {
  return useMemo((): AgentStatusBarState | null => {
    if (!enabled) return null
    const items = summarizeAgentActivities(tabs, activities)
    return {
      items,
      needsAttention: needsAgentAttention(items),
      // 利用者を待っているタブへ移る。当たるタブが無ければパネルを開くだけ
      onActivate: () => {
        const slotId = pickWaitingTab(tabs, activities, selectedSlotId)
        if (slotId === null) {
          openPanel()
          return
        }
        activateTab(slotId)
      }
    }
  }, [enabled, tabs, activities, selectedSlotId, openPanel, activateTab])
}
