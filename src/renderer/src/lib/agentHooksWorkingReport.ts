import type { AgentActivity } from './agentActivity'

// 作業中の知らせ・作業の終わりの知らせを送るかの規則(設計書「作業中の知らせ」「hooks が届かなくなったことの検知」)。
// タブごとの前回の控えと今の活動から、送る知らせと次の控えを決める純粋な関数。送るのは useAgentHooksWorkingReport

/** タブごとの控え: 前回の活動と、working を見てから idle をまだ見ていないか */
export interface WorkingReportTabState {
  activity: AgentActivity
  awaitingIdle: boolean
}

/** 送る知らせ(working: 作業中、ended: 作業の終わり、null: 送らない) */
export type WorkingReportKind = 'working' | 'ended' | null

/**
 * working 以外から working に変わったら作業中、working を見た後に idle になったら作業の終わり。permission・confirm
 * (利用者の操作待ちで、ターンは終わっていない)・unknown(判定の途中)では作業の終わりにせず、working を見た控えを残す。
 * before が undefined なら、新しいタブ(前回の活動も控えも無い)
 */
export function nextWorkingReport(
  before: WorkingReportTabState | undefined,
  activity: AgentActivity
): { state: WorkingReportTabState; report: WorkingReportKind } {
  const awaitingIdle = before?.awaitingIdle ?? false
  if (activity === 'working') {
    return {
      state: { activity, awaitingIdle: true },
      report: before?.activity === 'working' ? null : 'working'
    }
  }
  if (activity === 'idle' && awaitingIdle) {
    return { state: { activity, awaitingIdle: false }, report: 'ended' }
  }
  return { state: { activity, awaitingIdle }, report: null }
}
