import { useEffect, useRef } from 'react'
import { reportAgentSessionWorking, reportAgentSessionWorkingEnded } from '../lib/agentTerminalApi'
import { nextWorkingReport } from '../lib/agentHooksWorkingReport'
import type { WorkingReportTabState } from '../lib/agentHooksWorkingReport'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentTerminalController } from '../lib/agentTerminalController'

// 作業中の知らせと作業の終わりの知らせ(設計書「作業中の知らせ」「hooks が届かなくなったことの検知」)。タブの活動(画面の読み取りの判定)が
// working 以外から working に変わったとき(作業中)と、working を見た後に idle になったとき(作業の終わり)だけ、そのタブの pty の
// sessionId を main へ送る。送るかの規則は lib/agentHooksWorkingReport.ts(nextWorkingReport)で、ここはタブごとの控えを持って送るだけ。
// 表示用の値の並びで送り続けない(タブごとの出来事だけを送る。L-417)

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
  // タブごとの控え。消えたタブの控えは次の描画で捨てる
  const previousRef = useRef(new Map<string, WorkingReportTabState>())

  useEffect(() => {
    const previous = previousRef.current
    const next = new Map<string, WorkingReportTabState>()
    for (const tab of tabs) {
      const activity = activities.get(tab.slotId) ?? 'unknown'
      const { state, report } = nextWorkingReport(previous.get(tab.slotId), activity)
      if (report !== null) {
        const sessionId = tab.controller.getSessionId()
        if (sessionId !== null) {
          if (report === 'working') reportAgentSessionWorking(sessionId)
          else reportAgentSessionWorkingEnded(sessionId)
        }
      }
      next.set(tab.slotId, state)
    }
    previousRef.current = next
  }, [tabs, activities])
}
