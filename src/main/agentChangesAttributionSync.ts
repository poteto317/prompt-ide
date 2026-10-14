import type { AgentChangeEntry, AgentChangesAttributionLostReason } from '@shared/types'
import type { BaselineSnapshot, BaselineSnapshotResult } from './agentBaselineSnapshot'
import type { AgentChangesCheckpoint, TrackingAttribution } from './agentChangesAttribution'
import type { AgentChangesRecord } from './agentChangesRecord'
import type { AgentToolActivitySignal, AgentToolPhase } from './agentToolActivity'

// 記録の区別の同期と吸収の手順(設計書「同期」「アプリの戻す操作・取り消しの吸収」「やめる」)。registry が所有者の列の中でだけ呼ぶ
// (列の外から呼ばない)。判定の区切り(takeBaselineSnapshot。写しの元は直前の判定の区切り)を取り、直前の区切りとの差分(tree どうし)を
// 閉じた区間の段階に割り当て、前の区切りを結果の後に消す(L-003・L-004)。区切り・差分の失敗と、手順の予期しない例外の後は区別をやめる(lost。L-002)

/** registry の同期の結果。synced: 区切りを取った、skipped: それ以外(手順 1〜3 で終わった・取り消した・失敗して lost にした) */
export type AttributionSyncResult = 'synced' | 'skipped'

/** 1 回の手順の結果(ログ・並べ直しに使う) */
export type AttributionStepOutcome =
  | { kind: 'skipped' }
  | { kind: 'lost'; phaseBefore: AgentToolPhase }
  | { kind: 'synced'; phaseBefore: AgentToolPhase; requeue: boolean }

/** 手順が使う依存(registry が記録・所有者ごとに作る) */
export interface AttributionSyncContext {
  record: AgentChangesRecord
  /** 今の追跡の合図(呼ぶたびに読み直す。L-040) */
  signal: () => AgentToolActivitySignal
  /** 判定の区切りを取る(写しの元は直前の判定の区切りのインデックス。isCanceled は isStale と同じ) */
  takeSnapshot: (baseIndexPath: string) => Promise<BaselineSnapshotResult>
  collectBetween: (start: BaselineSnapshot, end: BaselineSnapshot) => Promise<AgentChangeEntry[]>
  /** registry の close・世代の変化・記録の置き換え(手順 11。L-037) */
  isStale: () => boolean
  /** 取れたが使わない区切りを消す(close の後は同期で消す。L-435) */
  discardSnapshot: (snapshot: BaselineSnapshot) => Promise<void>
  /** 前の判定の区切りを消す(失敗は投げる。呼び出し側が削除待ちに入れる) */
  removeDir: (dir: string) => Promise<void>
  now: () => number
}

const SKIPPED: AttributionStepOutcome = { kind: 'skipped' }

/**
 * 区別をやめる(設計書「やめる」)。集合と印は残し、判定の区切りは始点と共有でなければ消す(消せなければ削除待ち)。
 * 所有者の列の中でだけ呼ぶ。記録の区別を置き換えてから await する(途中で読まれても lost に見える)
 */
export async function markAttributionLost(
  record: AgentChangesRecord,
  reason: AgentChangesAttributionLostReason,
  { now, removeDir }: { now: () => number; removeDir: (dir: string) => Promise<void> }
): Promise<void> {
  const attribution = record.attribution
  if (attribution.kind !== 'tracking') return
  const {
    checkpoint,
    userPaths,
    agentPaths,
    trackingSince,
    hadUnassignedSince,
    staleCheckpointDirs
  } = attribution
  record.attribution = {
    kind: 'lost',
    reason,
    lostAt: now(),
    userPaths,
    agentPaths,
    trackingSince,
    hadUnassignedSince,
    staleCheckpointDirs
  }
  await removeCheckpointDir(removeDir, checkpoint, staleCheckpointDirs)
}

/**
 * 同期・吸収の手順が予期しない例外を投げた後の後始末(失敗を「変化なし」にしない。L-002)。記録が今の記録のままで区別していれば
 * 区別をやめて lost を返し、古くなった・区別していないなら何もせず skipped を返す。投げない(やめる途中の失敗も握る)
 */
export async function loseAfterUnexpectedError(
  ctx: AttributionSyncContext
): Promise<AttributionStepOutcome> {
  const attribution = ctx.record.attribution
  if (ctx.isStale() || attribution.kind !== 'tracking') return SKIPPED
  const phaseBefore = attribution.phase
  await markAttributionLost(ctx.record, 'checkpoint-failed', ctx).catch(() => undefined)
  return { kind: 'lost', phaseBefore }
}

/**
 * 判定の区切りの一時ディレクトリを消す(始点と共有なら消さない。L-004)。消せなければ削除待ちに入れる(L-428)。
 * 本番の removeBaselineDir・removeBaselineDirSync は失敗を握るため削除待ちに入る経路は本番では起きないが、依存の差し替えに備えた
 * 既存の作り(registry の removeDirs の .catch)に合わせた守り(テストは失敗する偽物で通す)
 */
async function removeCheckpointDir(
  removeDir: (dir: string) => Promise<void>,
  checkpoint: AgentChangesCheckpoint,
  staleCheckpointDirs: string[]
): Promise<void> {
  if (checkpoint.sharedWithBaseline) return
  try {
    await removeDir(checkpoint.snapshot.tempDir)
  } catch {
    staleCheckpointDirs.push(checkpoint.snapshot.tempDir)
  }
}

/**
 * 判定の区切りを取る(手順 5)。取り消し・世代の変化・記録の置き換えは canceled(取れたものは消してある)。
 * 取れなかったら区別をやめて lost
 */
async function takeCheckpoint(
  ctx: AttributionSyncContext,
  base: AgentChangesCheckpoint
): Promise<BaselineSnapshot | 'canceled' | 'lost'> {
  const result = await ctx.takeSnapshot(base.snapshot.indexPath)
  if (result.kind === 'canceled') return 'canceled'
  if (ctx.isStale()) {
    if (result.kind === 'recorded') await ctx.discardSnapshot(result.snapshot)
    return 'canceled'
  }
  if (result.kind === 'recorded') return result.snapshot
  await markAttributionLost(ctx.record, 'checkpoint-failed', ctx)
  return 'lost'
}

/**
 * 閉じた区間(前の区切り start → 新しい区切り end)の差分のパス(手順 7)。取り消し・世代の変化・記録の置き換えは canceled、
 * 差分の失敗は区別をやめて lost(空の集合として扱わない。L-002)。どちらも取れた区切り end は消してある
 */
async function collectPeriodPaths(
  ctx: AttributionSyncContext,
  start: BaselineSnapshot,
  end: BaselineSnapshot
): Promise<string[] | 'canceled' | 'lost'> {
  let paths: string[] | null
  try {
    paths = (await ctx.collectBetween(start, end)).map((entry) => entry.path)
  } catch {
    paths = null
  }
  if (ctx.isStale()) {
    await ctx.discardSnapshot(end)
    return 'canceled'
  }
  if (paths === null) {
    await ctx.discardSnapshot(end)
    await markAttributionLost(ctx.record, 'checkpoint-failed', ctx)
    return 'lost'
  }
  return paths
}

/** 閉じた区間の差分を割り当てる(手順 7)。印があれば割り当てず、区別を始めていれば hadUnassignedSince を立てる(L-152) */
function assignClosedPeriod(
  attribution: TrackingAttribution,
  paths: string[],
  phase: AgentToolPhase,
  unassignable: boolean
): void {
  if (unassignable) {
    if (attribution.trackingSince !== null) attribution.hadUnassignedSince = true
    return
  }
  if (phase === 'idle') for (const path of paths) attribution.userPaths.add(path)
  else if (phase === 'agent') for (const path of paths) attribution.agentPaths.add(path)
}

/** 新しい区間の始まり(手順 9 の後半)。割り当てる区間なら区別を始め、割り当てない区間なら hadUnassignedSince を立てる */
function openPeriod(attribution: TrackingAttribution, now: number): void {
  const assignable = !attribution.periodUnassignable && attribution.phase !== 'paused'
  if (assignable) {
    if (attribution.trackingSince === null) attribution.trackingSince = now
  } else if (attribution.trackingSince !== null) {
    attribution.hadUnassignedSince = true
  }
}

/** 手順 9 で始める新しい区間の段階と印(純粋な規則) */
export interface NextPeriodStart {
  phase: AgentToolPhase
  periodUnassignable: boolean
  /** 打ち切られたツールが区切りの後も書いた可能性があるため、同期をもう 1 回並べる(打ち切り 1 回につき高々 1 回) */
  requeue: boolean
}

/**
 * 手順 9 の規則。新しい区間の段階は手順 8 の合図の値。同期の開始の前・手順 8 までに打ち切りがあり(timedOut)、手順 8 の段階が
 * agent でなければ並べ直し、その区間にも印を立てる。手順 2・8 の合図の unassignable も印にする(L-103・L-434)
 */
export function nextPeriodStart({
  timedOut,
  signalAtStart,
  signalNow
}: {
  timedOut: boolean
  signalAtStart: AgentToolActivitySignal
  signalNow: AgentToolActivitySignal
}): NextPeriodStart {
  const requeue = timedOut && signalNow.phase !== 'agent'
  return {
    phase: signalNow.phase,
    periodUnassignable: requeue || signalNow.unassignable || signalAtStart.unassignable,
    requeue
  }
}

/** 前の判定の区切りを消す(手順 10。結果の後。L-003) */
const removeCheckpoint = (
  ctx: AttributionSyncContext,
  previous: AgentChangesCheckpoint,
  attribution: TrackingAttribution
): Promise<void> => removeCheckpointDir(ctx.removeDir, previous, attribution.staleCheckpointDirs)

/**
 * 同期の 1 回(設計書「同期」の手順 2〜11。手順 1〈記録が無い・close〉は registry が見る)。段階は呼ばれた時点の追跡の値で読み、
 * 新しい段階は区切りを取り終えて差分を割り当てた時点(手順 8)の値で決める(L-040)
 */
export async function syncAttributionStep(
  ctx: AttributionSyncContext
): Promise<AttributionStepOutcome> {
  const { record } = ctx
  const attribution = record.attribution
  if (attribution.kind !== 'tracking') return SKIPPED
  const phaseBefore = attribution.phase
  // 2. 区別をやめる合図。無ければ、合図の unassignable で今の区間に印を立てる
  const signalAtStart = ctx.signal()
  if (signalAtStart.lost !== null) {
    await markAttributionLost(record, signalAtStart.lost, ctx)
    return { kind: 'lost', phaseBefore }
  }
  if (signalAtStart.unassignable) attribution.periodUnassignable = true
  // 3. 段階が同じで印も無ければ何もしない(git を呼ばない)
  if (signalAtStart.phase === attribution.phase && !attribution.periodUnassignable) return SKIPPED
  // 4. 印を控えて下ろす(この後の打ち切りは markToolStartTimedOut がまた立てる)
  const unassignableBefore = attribution.periodUnassignable
  const timeoutBefore = attribution.timedOutPending
  attribution.periodUnassignable = false
  attribution.timedOutPending = false
  // 5. 区切り S
  const previous = attribution.checkpoint
  const next = await takeCheckpoint(ctx, previous)
  if (next === 'canceled') return SKIPPED
  if (next === 'lost') return { kind: 'lost', phaseBefore }
  // 6. 区切りを取り終えるまでに列の外で立った印(打ち切りの markToolStartTimedOut・合図の unassignable の notifyAttributionSignal)
  const markedDuringSnapshot = attribution.periodUnassignable
  // 7. 閉じた区間(前の区切り → S)の差分を割り当てる
  const paths = await collectPeriodPaths(ctx, previous.snapshot, next)
  if (paths === 'canceled') return SKIPPED
  if (paths === 'lost') return { kind: 'lost', phaseBefore }
  assignClosedPeriod(attribution, paths, phaseBefore, unassignableBefore || markedDuringSnapshot)
  // 8. この時点のあるべき段階(区切りを取っている間に始まった・終わったツールを反映する)
  const signalNow = ctx.signal()
  // 9. 同期の開始の前と手順 8 までの打ち切りを片付け、新しい区間を始める(L-103・L-434)
  const timedOut = timeoutBefore || attribution.timedOutPending
  attribution.timedOutPending = false
  attribution.checkpoint = { snapshot: next, sharedWithBaseline: false }
  const { phase, periodUnassignable, requeue } = nextPeriodStart({
    timedOut,
    signalAtStart,
    signalNow
  })
  attribution.phase = phase
  attribution.periodUnassignable = periodUnassignable
  openPeriod(attribution, ctx.now())
  // 10. 前の区切りを消す(結果の後。L-003)
  await removeCheckpoint(ctx, previous, attribution)
  return { kind: 'synced', phaseBefore, requeue }
}

/**
 * 吸収の (1)(設計書「アプリの戻す操作・取り消しの吸収」)。区切り S1 を取り、前の区切りからの差分を今の段階に割り当てる
 * (印があれば割り当てない)。印は下ろさない(吸収の前に立った打ち切りの印も、差分を求めている最中の印も残す)。
 * timedOutPending も下ろさない(続く同期が手順 4・9 で片付ける)。段階は変えない
 */
export async function absorbBeforeTask(
  ctx: AttributionSyncContext
): Promise<AttributionStepOutcome> {
  const { record } = ctx
  const attribution = record.attribution
  if (attribution.kind !== 'tracking') return SKIPPED
  const phase = attribution.phase
  const previous = attribution.checkpoint
  const next = await takeCheckpoint(ctx, previous)
  if (next === 'canceled') return SKIPPED
  if (next === 'lost') return { kind: 'lost', phaseBefore: phase }
  const paths = await collectPeriodPaths(ctx, previous.snapshot, next)
  if (paths === 'canceled') return SKIPPED
  if (paths === 'lost') return { kind: 'lost', phaseBefore: phase }
  assignClosedPeriod(attribution, paths, phase, attribution.periodUnassignable)
  if (ctx.signal().unassignable) attribution.periodUnassignable = true
  attribution.checkpoint = { snapshot: next, sharedWithBaseline: false }
  openPeriod(attribution, ctx.now())
  await removeCheckpoint(ctx, previous, attribution)
  return { kind: 'synced', phaseBefore: phase, requeue: false }
}

/**
 * 吸収の (3)。区切り S2 を取り直して判定の区切りを置き換え(S1 を消す)、その差分(アプリの操作)はどちらの集合にも入れない。
 * 印は合図の unassignable を足すだけで上書きしない((1) の後に列の外で立った印を残す)
 */
export async function absorbAfterTask(
  ctx: AttributionSyncContext
): Promise<AttributionStepOutcome> {
  const { record } = ctx
  const attribution = record.attribution
  if (attribution.kind !== 'tracking' || ctx.isStale()) return SKIPPED
  const phase = attribution.phase
  const previous = attribution.checkpoint
  const next = await takeCheckpoint(ctx, previous)
  if (next === 'canceled') return SKIPPED
  if (next === 'lost') return { kind: 'lost', phaseBefore: phase }
  if (ctx.signal().unassignable) attribution.periodUnassignable = true
  attribution.checkpoint = { snapshot: next, sharedWithBaseline: false }
  await removeCheckpoint(ctx, previous, attribution)
  return { kind: 'synced', phaseBefore: phase, requeue: false }
}
