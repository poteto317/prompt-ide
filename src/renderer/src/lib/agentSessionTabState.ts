import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentExitReason, AgentLaunchRequest, AgentSessionExit } from '@shared/types'
import { AGENT_MAX_SESSIONS_PER_WINDOW } from '@shared/types'
import {
  AGENT_ADD_TAB_DISABLED_LIMIT,
  AGENT_START_DISABLED_NO_FOLDER
} from './agentSessionMessages'

// エージェントのセッションのタブごとの状態の値と、その判定(React に依存しない)。状態を持つのは useAgentSessions で、
// パネル(動いているか)・文言と送信の可否(状態の型)・テストの偽物(集計)も同じ判定を読む

/** セッションの状態(useAgentSessions がタブごとに持ち、帯・タブの文言の入力にもなる) */
export type AgentSessionStatus = 'none' | 'starting' | 'running' | 'exited'

export interface AgentSessionExitView {
  exitCode: number | null
  reason: AgentExitReason
}

/** タブごとの起動・停止・終了の状態(slotId をキーにして持つ)。pty の sessionId は持たない(useAgentSessions の ref と controller が持つ) */
export interface AgentTabSessionFields {
  status: AgentSessionStatus
  exit: AgentSessionExitView | null
  error: string | null
  /** 起動の結果(started・already-running)・状態の取得の CLI の種類。起動を始めると null に戻し、終了しても消さない(終了したタブの
   *  名前と画面の中身が合うように)。null の間は設定の種類で名前と能力を引く(useAgentSessions の AgentSessionTabView.cliKind) */
  cliKind: AgentCliKind | null
  /** 起動中(resume は依頼した ID、new は結果が届いてから)・実行中のセッションの会話の ID。終了・起動の失敗・取り消しで
   *  null に戻す(送信の時点の送り先の控えと、同じ ID が動いているかの判定に使う。終了した後の ID はどこにも使わない) */
  cliSessionId: string | null
}

export const INITIAL_AGENT_TAB_SESSION_FIELDS: AgentTabSessionFields = {
  status: 'none',
  exit: null,
  error: null,
  cliKind: null,
  cliSessionId: null
}

/** タブの状態。まだ状態の無いタブは初期値 */
export const agentTabSessionFieldsOf = (
  states: ReadonlyMap<string, AgentTabSessionFields>,
  slotId: string
): AgentTabSessionFields => states.get(slotId) ?? INITIAL_AGENT_TAB_SESSION_FIELDS

/** starting か running(動いている) */
export const isActiveAgentSessionStatus = (status: AgentSessionStatus): boolean =>
  status === 'starting' || status === 'running'

/**
 * 送信(実行・履歴の再実行)の能力の判定に使う CLI の種類。動いている(starting・running)タブはタブの種類(起動の結果の種類)、
 * それ以外(未起動・終了した)は次に起動する設定の種類。終了したタブの種類は前の起動の結果のまま残る(名前を画面に合わせる)が、
 * そのタブで 起動 を押すと設定の種類で起動するため、押せない理由を次の起動に合わせる(設計書 2026-10-20「入口ごとの表」)。
 * タブの名前は結果の種類のまま(AgentSessionTabView.label)
 */
export const agentCapabilityCliKindOf = (
  tab: { status: AgentSessionStatus; cliKind: AgentCliKind },
  appCliKind: AgentCliKind
): AgentCliKind => (isActiveAgentSessionStatus(tab.status) ? tab.cliKind : appCliKind)

/** starting か running のタブがある(useAgentSessions の isAnyActive。偽物も同じ判定で求める) */
export const isAnyAgentSessionActive = (tabs: readonly { status: AgentSessionStatus }[]): boolean =>
  tabs.some((tab) => isActiveAgentSessionStatus(tab.status))

/** starting のタブがある(useAgentSessions の isAnyStarting。偽物も同じ判定で求める) */
export const isAnyAgentSessionStarting = (
  tabs: readonly { status: AgentSessionStatus }[]
): boolean => tabs.some((tab) => tab.status === 'starting')

/** cliSessionId のセッションが起動中・実行中のタブ(前回の続きから・このセッションで再開 の押せない理由)。無ければ undefined */
export function findActiveAgentTabByCliSessionId<
  T extends { status: AgentSessionStatus; cliSessionId: string | null }
>(tabs: readonly T[], cliSessionId: string): T | undefined {
  return tabs.find(
    (tab) => tab.cliSessionId === cliSessionId && isActiveAgentSessionStatus(tab.status)
  )
}

/** 起動の直後とみなす時間(node-pty は起動の失敗を終了コード 1 で返すため。確認の結果 4) */
export const AGENT_EXITED_SOON_MS = 2_000

/** 起動の直後にエージェント自身が 0 以外で終わったか(node-pty は起動の失敗を終了コード 1 で返すため。止めた終了は含めない)。
 *  起動の時刻が無ければ 0 から数える */
export const isAgentExitedSoon = (
  event: Pick<AgentSessionExit, 'exitCode' | 'reason'>,
  startedAt: number | undefined,
  now: number
): boolean =>
  event.reason === 'exited' && event.exitCode !== 0 && now - (startedAt ?? 0) < AGENT_EXITED_SOON_MS

/**
 * 再開の失敗か(設計書 2026-10-23「再開の失敗の見分け方と伝え方」)。再開(resume)で起動したタブが、画面の活動を一度も見ないまま
 * (起動の後に活動が unknown 以外にならなかった)、エージェント自身の終了(exited)で 0 以外(null を含む)で終わったときだけ真。
 * 時間では見ない(初回の起動は遅いことがある)。文言を出すかは種類ごとの表(AGENT_RESUME_FAILURE_NOTES)で決める
 */
export function isAgentResumeFailure({
  launchKind,
  exit,
  sawScreenActivity
}: {
  launchKind: AgentLaunchRequest['kind']
  exit: Pick<AgentSessionExit, 'exitCode' | 'reason'>
  sawScreenActivity: boolean
}): boolean {
  return (
    launchKind === 'resume' && exit.reason === 'exited' && exit.exitCode !== 0 && !sawScreenActivity
  )
}

/** 起動を押せない理由(フォルダ無し、または起動を受け付けない間の理由。フォルダ無しを優先する)。押せるなら null */
export const agentStartDisabledReason = (
  folderPath: string | null,
  blockedReason: string | null = null
): string | null => (folderPath === null ? AGENT_START_DISABLED_NO_FOLDER : blockedReason)

/** + を押せない理由。+ はタブを作って起動するため、起動を押せない理由をそのまま含め、加えて上限を見る。押せるなら null */
export const agentAddTabDisabledReason = (
  folderPath: string | null,
  tabCount: number,
  blockedReason: string | null = null
): string | null =>
  agentStartDisabledReason(folderPath, blockedReason) ??
  (tabCount >= AGENT_MAX_SESSIONS_PER_WINDOW ? AGENT_ADD_TAB_DISABLED_LIMIT : null)

/** 生きているセッションの id(タブ → id)から、sessionId を持つタブを逆引きする(終了の振り分け) */
export function findAgentSlotBySessionId(
  sessionIdBySlot: ReadonlyMap<string, string>,
  sessionId: string
): string | undefined {
  for (const [slotId, id] of sessionIdBySlot) {
    if (id === sessionId) return slotId
  }
  return undefined
}
