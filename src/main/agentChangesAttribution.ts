import type {
  AgentChangeAuthor,
  AgentChangeEntry,
  AgentChangesAttributionLostReason,
  AgentChangesAttributionSummary
} from '@shared/types'
import type { BaselineSnapshot } from './agentBaselineSnapshot'
import type { AgentToolActivitySignal, AgentToolPhase } from './agentToolActivity'

// 記録の利用者の変更との区別の型と純粋な関数(設計書「利用者の変更の判定」)。記録ごとに、最後の判定の区切り(checkpoint)・
// 今の区間の段階(phase)・割り当てられない印・利用者とエージェントが変えたパスの集合(git の表記)を持つ。区切りの取得・差分・
// 割り当ての手順は agentChangesAttributionSync.ts(registry が所有者の列の中で呼ぶ)。ここはファイル・git を読まない

/** 最後の判定の区切りと、それが累積の始点(record.baseline)と同じものか(同じなら消さない。L-004) */
export interface AgentChangesCheckpoint {
  snapshot: BaselineSnapshot
  sharedWithBaseline: boolean
}

/** tracking・lost に共通で、区別をやめた後も残すもの(集合・区別を始めた時刻と割り当てなかった印・区切りの削除待ち) */
export interface AttributionMarks {
  /** 利用者が変えたパス(リポジトリ相対。git の表記) */
  userPaths: Set<string>
  /** エージェントが変えたパス */
  agentPaths: Set<string>
  /** 最初に割り当てる区間(idle・agent で印の無い区間)が始まった時刻(まだなら null) */
  trackingSince: number | null
  /** trackingSince の後に、paused の区間か割り当てられない区間があったか */
  hadUnassignedSince: boolean
  /** 消せなかった前の判定の区切りの一時ディレクトリ(clear・close で消す。L-428) */
  staleCheckpointDirs: string[]
}

export interface TrackingAttribution extends AttributionMarks {
  kind: 'tracking'
  /** 今の区間(最後の区切りから今まで)の段階 */
  phase: AgentToolPhase
  /** 今の区間を割り当てられない印 */
  periodUnassignable: boolean
  /** PreToolUse の待ちの打ち切り(失敗を含む)があり、まだ同期の手順 9 で片付けていない印(立てるのは markToolStartTimedOut だけ) */
  timedOutPending: boolean
  checkpoint: AgentChangesCheckpoint
}

export interface LostAttribution extends AttributionMarks {
  kind: 'lost'
  reason: AgentChangesAttributionLostReason
  lostAt: number
}

export type AgentChangesAttribution = TrackingAttribution | LostAttribution

export interface InitialAttributionInput {
  /** 累積の始点(最初の判定の区切りにする) */
  baseline: BaselineSnapshot
  /** 始点を取り始める直前のツールの開始の通し番号 */
  seqBefore: number
  /** 記録を作る時点の通し番号 */
  seqAfter: number
  /** 始点を取り始める直前の合図 */
  signalBefore: AgentToolActivitySignal
  /** 記録を作る時点の合図 */
  signalAfter: AgentToolActivitySignal
}

const emptyMarks = (): AttributionMarks => ({
  userPaths: new Set(),
  agentPaths: new Set(),
  trackingSince: null,
  hadUnassignedSince: false,
  staleCheckpointDirs: []
})

/**
 * 記録の区別の初期値(設計書「記録に持つもの」)。syncNow が真なら、registry は記録を置いた後に同期を 1 回並べる。
 * 始点を取っている間の区間(始点から最初の同期まで)は、ツールが動いた・動いていた・合図の unassignable が立っていたら割り当てない
 */
export function initialAttribution({
  baseline,
  seqBefore,
  seqAfter,
  signalBefore,
  signalAfter
}: InitialAttributionInput): { attribution: AgentChangesAttribution; syncNow: boolean } {
  if (signalAfter.lost !== null) {
    // 追跡の理由(AgentHooksLostReason)は記録の理由に含まれる(型で確かめる。L-439)
    const reason: AgentChangesAttributionLostReason = signalAfter.lost
    return {
      attribution: { kind: 'lost', reason, lostAt: baseline.startedAt, ...emptyMarks() },
      syncNow: false
    }
  }
  const toolOrAgent =
    seqAfter !== seqBefore || signalBefore.phase === 'agent' || signalAfter.phase === 'agent'
  const signalMark = signalBefore.unassignable || signalAfter.unassignable
  const periodUnassignable = toolOrAgent || signalMark
  // 合図だけが理由なら、合図が下りたときの同期に任せる。取っている間に下りた場合は、その通知の時点で記録が無かったため並べる
  const syncNow = toolOrAgent || (signalBefore.unassignable && !signalAfter.unassignable)
  return {
    attribution: {
      kind: 'tracking',
      phase: signalAfter.phase,
      periodUnassignable,
      timedOutPending: false,
      checkpoint: { snapshot: baseline, sharedWithBaseline: true },
      ...emptyMarks(),
      trackingSince:
        !periodUnassignable && signalAfter.phase !== 'paused' ? baseline.startedAt : null
    },
    syncNow
  }
}

/**
 * 行のパスと集合のパスの照合: 完全一致、または片方が '/' で終わるフォルダの表記でもう片方がその下(前方一致は '/' の境目でだけ。
 * L-007・L-068)。どちらも git の出力のパス(同じ記録のインデックスの系統)で、hook のパス・OS のパスと比べない(L-009・L-018)
 */
export function matches(entryPath: string, path: string): boolean {
  if (entryPath === path) return true
  if (entryPath.endsWith('/') && path.startsWith(entryPath)) return true
  return path.endsWith('/') && entryPath.startsWith(path)
}

/** 今の区間(最後の判定の区切り → 作業ツリー)を比べて割り当てるか(tracking で印が無いときだけ) */
export function needsCurrentPeriod(attribution: AgentChangesAttribution): boolean {
  return attribution.kind === 'tracking' && !attribution.periodUnassignable
}

/** 区別している記録か(tracking なら区別を始めた後、lost なら印が残っている) */
const isDistinguishing = (attribution: AgentChangesAttribution): boolean =>
  attribution.kind === 'tracking'
    ? attribution.trackingSince !== null
    : attribution.userPaths.size + attribution.agentPaths.size > 0

/**
 * 一覧の行の author(設計書「行の author」2〜5)。currentPaths は今の区間のパス(needsCurrentPeriod が偽・比べなかった・失敗したら null)。
 * 区別していない記録はすべて null。notRecorded の行は null。利用者の集合に一致してエージェントに無い → user、両方 → mixed、それ以外 → agent
 */
export function authorsOf(
  entries: readonly AgentChangeEntry[],
  attribution: AgentChangesAttribution,
  currentPaths: readonly string[] | null
): (AgentChangeAuthor | null)[] {
  if (!isDistinguishing(attribution)) return entries.map(() => null)
  const user = [...attribution.userPaths]
  const agent = [...attribution.agentPaths]
  if (needsCurrentPeriod(attribution) && currentPaths !== null && attribution.kind === 'tracking') {
    if (attribution.phase === 'idle') user.push(...currentPaths)
    else if (attribution.phase === 'agent') agent.push(...currentPaths)
  }
  return entries.map((entry) => {
    if (entry.notRecorded) return null
    if (!user.some((path) => matches(entry.path, path))) return 'agent'
    return agent.some((path) => matches(entry.path, path)) ? 'mixed' : 'user'
  })
}

/** IPC に載せる要約(B-2 で使う) */
export function summarizeAttribution(
  attribution: AgentChangesAttribution
): AgentChangesAttributionSummary {
  if (attribution.kind === 'tracking') {
    return {
      kind: 'tracking',
      since: attribution.trackingSince,
      hadUnassignedSince: attribution.hadUnassignedSince
    }
  }
  return {
    kind: 'lost',
    reason: attribution.reason,
    lostAt: attribution.lostAt,
    hadMarks: attribution.userPaths.size + attribution.agentPaths.size > 0,
    since: attribution.trackingSince,
    hadUnassignedSince: attribution.hadUnassignedSince
  }
}

/** 記録を捨てるときに消す判定の区切りの一時ディレクトリ(始点と共有のものは始点の側で消す。L-004) */
export function attributionTempDirs(attribution: AgentChangesAttribution): string[] {
  const own =
    attribution.kind === 'tracking' && !attribution.checkpoint.sharedWithBaseline
      ? [attribution.checkpoint.snapshot.tempDir]
      : []
  return [...own, ...attribution.staleCheckpointDirs]
}

export type AttributionLogEvent = '開始' | '同期' | '吸収' | 'lost'

/** 開発版のログの 1 行(パス・内容は出さない。L-017) */
export function attributionLogLine(
  ownerId: number,
  event: AttributionLogEvent,
  phaseBefore: AgentToolPhase | null,
  attribution: AgentChangesAttribution
): string {
  const after = attribution.kind === 'tracking' ? attribution.phase : '-'
  const unassignable =
    attribution.kind === 'tracking' && attribution.periodUnassignable ? 'あり' : 'なし'
  const reason = attribution.kind === 'lost' ? attribution.reason : '-'
  return (
    `[agent-attribution] owner=${ownerId} event=${event} phase=${phaseBefore ?? '-'}→${after} ` +
    `user=${attribution.userPaths.size} agent=${attribution.agentPaths.size} ` +
    `unassignable=${unassignable} reason=${reason}`
  )
}
