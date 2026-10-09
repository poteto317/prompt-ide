import type { AgentActivity } from './agentActivity'
import type { AgentSessionStatus } from './agentSessionTabState'
import { describeAgentActivity } from './agentSessionMessages'

// ステータスバーの、全タブの活動のまとめ(設計書「表示」のステータスバー)。数え方・押したときに選ぶタブ・文言の純粋な関数

export interface AgentActivitySummaryItem {
  activity: AgentActivity
  count: number
}

/** まとめ・選ぶタブの入力のタブ(useAgentStatusBar もこの形で受け取る) */
export interface SummaryTab {
  slotId: string
  status: AgentSessionStatus
  /** 閉じる途中(確認の後で停止を待っている間。status は running のまま)。まとめに数えず、押したときにも選ばない */
  isClosing: boolean
}

/** まとめでの順位(小さいほど先。操作が必要なものを先に)。活動ごとに持たせ、活動の種類を増やしたときに順位の
 * 足し忘れを型エラーにする(足し忘れると、その活動のタブがまとめから黙って抜ける) */
const SUMMARY_RANK: Record<AgentActivity, number> = {
  permission: 0,
  confirm: 1,
  working: 2,
  idle: 3,
  unknown: 4
}
/** まとめの並び(SUMMARY_RANK の順) */
const SUMMARY_ORDER: readonly AgentActivity[] = (Object.keys(SUMMARY_RANK) as AgentActivity[]).sort(
  (a, b) => SUMMARY_RANK[a] - SUMMARY_RANK[b]
)
/** 利用者を待っている活動(押したときに選ぶ。作業中・不明のタブは選ばない) */
const WAITING: ReadonlySet<AgentActivity> = new Set(['permission', 'confirm', 'idle'])
/** 押したときに選ぶタブの優先。並び順はまとめの並び(SUMMARY_ORDER)に従う(まとめで先に出る活動と、押したときに
 * 選ばれるタブを食い違わせないため、並び順を 2 か所に書かない) */
const WAITING_ORDER: readonly AgentActivity[] = SUMMARY_ORDER.filter((activity) =>
  WAITING.has(activity)
)
/** 強調する活動(利用者の操作が必要) */
const NEEDS_ATTENTION: ReadonlySet<AgentActivity> = new Set(['permission', 'confirm'])

/** running で、閉じる途中でないタブの活動(未判定は unknown)。閉じる途中のタブは間もなく消えるので除く */
function runningActivities(
  tabs: readonly SummaryTab[],
  activities: ReadonlyMap<string, AgentActivity>
): { slotId: string; activity: AgentActivity }[] {
  return tabs
    .filter((tab) => tab.status === 'running' && !tab.isClosing)
    .map((tab) => ({ slotId: tab.slotId, activity: activities.get(tab.slotId) ?? 'unknown' }))
}

/** running(閉じる途中を除く)のタブの活動を数え、まとめの並び(SUMMARY_ORDER)の順に、0 件を除いて並べる。running のタブが無ければ空 */
export function summarizeAgentActivities(
  tabs: readonly SummaryTab[],
  activities: ReadonlyMap<string, AgentActivity>
): AgentActivitySummaryItem[] {
  const running = runningActivities(tabs, activities)
  return SUMMARY_ORDER.map((activity) => ({
    activity,
    count: running.filter((tab) => tab.activity === activity).length
  })).filter((item) => item.count > 0)
}

/** 押したときに選ぶタブ(WAITING_ORDER の順で最初に当たる running で閉じる途中でないタブ。同じ活動なら選択中のタブ、選択中のタブが
 * 当たらなければタブの並びの先頭)。無ければ null。選択中を先にするのは、同時に起きやすい入力待ちなどで、押すたびに
 * 見ていたタブから外れないため。選択中のタブは省略させない(渡し忘れると常に並びの先頭へ移るため) */
export function pickWaitingTab(
  tabs: readonly SummaryTab[],
  activities: ReadonlyMap<string, AgentActivity>,
  selectedSlotId: string | null
): string | null {
  const running = runningActivities(tabs, activities)
  for (const activity of WAITING_ORDER) {
    const matches = running.filter((tab) => tab.activity === activity)
    if (matches.length === 0) continue
    return (matches.find((tab) => tab.slotId === selectedSlotId) ?? matches[0]).slotId
  }
  return null
}

/** 操作が必要な活動(許可待ち・確認待ち)が 1 つでもあるか(強調の色) */
export function needsAgentAttention(items: readonly AgentActivitySummaryItem[]): boolean {
  return items.some((item) => NEEDS_ATTENTION.has(item.activity))
}

const partsOf = (items: readonly AgentActivitySummaryItem[]): string[] =>
  items.map((item) => `${describeAgentActivity(item.activity)} ${item.count}`)

/** 表示の文言。例「エージェント: 許可待ち 1 · 作業中 2」 */
export function formatAgentActivitySummary(items: readonly AgentActivitySummaryItem[]): string {
  return `エージェント: ${partsOf(items).join(' · ')}`
}

/** ボタンの aria-label。見える文字(formatAgentActivitySummary)をそのまま含める(WCAG 2.5.3。音声操作が見える文字で当たるように)。
 * 例「エージェント: 許可待ち 1 · 作業中 2（押すとターミナルを開きます）」 */
export function describeAgentActivitySummary(items: readonly AgentActivitySummaryItem[]): string {
  return `${formatAgentActivitySummary(items)}（押すとターミナルを開きます）`
}
