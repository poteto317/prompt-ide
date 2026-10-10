import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentTerminalController } from '../lib/agentTerminalController'

// エージェントのタブへ移る(通知の設計書「タブへ移る」)。パネルを開き、タブを選び、描画の後にそのタブのターミナルへフォーカスを
// 移す。ステータスバーのまとめ(useAgentStatusBar)と、OS の通知を押したとき(useAgentNotifications)が同じ関数を使う

export interface UseAgentTabActivationOptions {
  /** 選択中のタブ(フォーカスを移す前に、選択が依頼のタブのままかを slotId で見て controller へ移す) */
  selected: { slotId: string; controller: Pick<AgentTerminalController, 'focus'> }
  selectTab: (slotId: string) => void
  /** パネルを開く(最大化は変えない) */
  openPanel: () => void
}

export function useAgentTabActivation({
  selected,
  selectTab,
  openPanel
}: UseAgentTabActivationOptions): (slotId: string) => void {
  // フォーカスを移すタブ。選択とパネルの開きが描画され、そのタブの xterm が取り付けられてから(子の effect の後)移す。
  // 依頼のたびに数を進めて描画させ(パネルが開いていて選択も変わらないときも)、effect は 1 回だけ移す
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

  return useCallback(
    (slotId: string): void => {
      openPanel()
      selectTab(slotId)
      focusRequestRef.current = slotId
      setFocusRequestCount((count) => count + 1)
    },
    [openPanel, selectTab]
  )
}
