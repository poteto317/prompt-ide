import { useEffect, useRef } from 'react'
import { reportAgentSessionWorking } from '../lib/agentTerminalApi'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentTerminalController } from '../lib/agentTerminalController'

// 作業中の知らせ(設計書「作業中の知らせ」)。タブの活動(画面の読み取りの判定)が working 以外から working に変わったときだけ、
// そのタブの pty の sessionId を main へ送る。main は、hooks の知らせがまだ届いていないセッションでこれを受けたら 15 秒の
// タイマーを張り、知らせが届かなければ hooks が効いていないと判断する。表示用の値の並びで送り続けない(出来事だけを送る)

export interface AgentHooksWorkingReportTab {
  slotId: string
  /** タブの表示(AgentSessionTabView)は sessionId を持たないため、controller から取る */
  controller: Pick<AgentTerminalController, 'getSessionId'>
}

export interface UseAgentHooksWorkingReportOptions {
  tabs: readonly AgentHooksWorkingReportTab[]
  /** slotId → 活動(useAgentActivity の結果) */
  activities: ReadonlyMap<string, AgentActivity>
}

export function useAgentHooksWorkingReport({
  tabs,
  activities
}: UseAgentHooksWorkingReportOptions): void {
  // タブごとの前回の活動。消えたタブの控えは次の描画で捨てる
  const previousRef = useRef(new Map<string, AgentActivity>())

  useEffect(() => {
    const previous = previousRef.current
    const next = new Map<string, AgentActivity>()
    for (const tab of tabs) {
      const activity = activities.get(tab.slotId) ?? 'unknown'
      if (activity === 'working' && previous.get(tab.slotId) !== 'working') {
        const sessionId = tab.controller.getSessionId()
        if (sessionId !== null) reportAgentSessionWorking(sessionId)
      }
      next.set(tab.slotId, activity)
    }
    previousRef.current = next
  }, [tabs, activities])
}
