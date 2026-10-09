import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import type { AgentActivitySummaryItem, SummaryTab } from '../lib/agentActivitySummary'
import {
  needsAgentAttention,
  pickWaitingTab,
  summarizeAgentActivities
} from '../lib/agentActivitySummary'

// ステータスバーのエージェントのまとめ(設計書「表示」のステータスバー)。まとめの組み立てと、押したときのタブの選択・
// 描画の後のフォーカスの移動を受け持つ。数え方・選ぶタブの優先・文言は agentActivitySummary に任せる

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
  /** 選択中のタブ(押したときに同じ活動なら選択中のタブを選ぶ。フォーカスを移す前に選択が変わっていないかを slotId で見て、
   * controller へ移す) */
  selected: { slotId: string; controller: Pick<AgentTerminalController, 'focus'> }
  selectTab: (slotId: string) => void
  activities: ReadonlyMap<string, AgentActivity>
  /** パネルを開く(最大化は変えない) */
  openPanel: () => void
}

export function useAgentStatusBar({
  enabled,
  tabs,
  selected,
  selectTab,
  activities,
  openPanel
}: UseAgentStatusBarOptions): AgentStatusBarState | null {
  // 押したときにフォーカスを移すタブ。選択とパネルの開きが描画され、そのタブの xterm が取り付けられてから
  // (子の effect の後)移す。依頼のたびに数を進めて描画させ(パネルが開いていて選択も変わらないときも)、effect は 1 回だけ移す
  const focusRequestRef = useRef<string | null>(null)
  const [focusRequestCount, setFocusRequestCount] = useState(0)
  const selectedSlotId = selected.slotId
  const selectedController = selected.controller
  useEffect(() => {
    const slotId = focusRequestRef.current
    if (slotId === null) return
    focusRequestRef.current = null
    // 描画までの間にタブが閉じられた・選択が変わったなら移さない
    if (selectedSlotId !== slotId) return
    selectedController.focus()
  }, [focusRequestCount, selectedSlotId, selectedController])

  return useMemo((): AgentStatusBarState | null => {
    if (!enabled) return null
    const items = summarizeAgentActivities(tabs, activities)
    return {
      items,
      needsAttention: needsAgentAttention(items),
      // パネルを開き、利用者を待っているタブを選んで、描画の後にそのターミナルへフォーカスを移す
      onActivate: () => {
        openPanel()
        const slotId = pickWaitingTab(tabs, activities, selectedSlotId)
        if (slotId === null) return
        selectTab(slotId)
        focusRequestRef.current = slotId
        setFocusRequestCount((count) => count + 1)
      }
    }
  }, [enabled, tabs, activities, selectedSlotId, openPanel, selectTab])
}
