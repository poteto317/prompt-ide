import type {
  AgentChangesRun,
  AgentChangesRunAvailability,
  AgentChangesUnavailableReason
} from '@shared/types'
import type { BaselineSnapshot, BaselineSnapshotResult } from './agentBaselineSnapshot'

// 1 所有者の記録(設計書「記録の持ち方」)。累積の始点と、プロンプトを送るたびに足す実行の一覧(古い順)。
// 実行 N の範囲は「実行 N の開始の区切り → 実行 N+1 の開始の区切り(最後の実行は作業ツリー)」で、終わりの記録は別に持たない
// (隣り合う実行が同じ記録を共有する)。registry が作って書き換え、範囲の解決と handler が読む。renderer には渡さない

/** 実行の開始。baseline: 累積の始点(記録が無い状態から送った実行 1)、snapshot: 区切り、failed: 区切りを取れなかった */
export type AgentChangesRunStart =
  | { kind: 'baseline' }
  | { kind: 'snapshot'; snapshot: BaselineSnapshot }
  | { kind: 'failed'; reason: AgentChangesUnavailableReason; startedAt: number }

export interface AgentChangesRecordRun {
  /** 所有者ごとに単調に増える ID(記録を捨てても戻さない) */
  runId: number
  /** 記録の中の 1 からの番号(表示用) */
  number: number
  start: AgentChangesRunStart
}

export interface AgentChangesRecord {
  /** 累積の始点。一覧・diff・戻すの累積の範囲はこれを使う(古い実行を捨てても変わらない) */
  baseline: BaselineSnapshot
  /** 実行の一覧(古い順) */
  runs: AgentChangesRecordRun[]
  /** 次の実行の番号 */
  nextNumber: number
}

// 未知の開始の種類を、取れた・選べる側へ黙って流さない(型を足したら下の switch がすべて型検査で落ちる)
function unknownRunStart(start: never): never {
  throw new Error(`未知の実行の開始です: ${JSON.stringify(start)}`)
}

/** 実行の開始の記録(baseline は累積の始点)。開始を取れなかった実行は null */
export function runStartSnapshot(
  record: AgentChangesRecord,
  run: AgentChangesRecordRun
): BaselineSnapshot | null {
  switch (run.start.kind) {
    case 'baseline':
      return record.baseline
    case 'snapshot':
      return run.start.snapshot
    case 'failed':
      return null
    default:
      return unknownRunStart(run.start)
  }
}

function runStartedAt(record: AgentChangesRecord, run: AgentChangesRecordRun): number {
  switch (run.start.kind) {
    case 'baseline':
      return record.baseline.startedAt
    case 'snapshot':
      return run.start.snapshot.startedAt
    case 'failed':
      return run.start.startedAt
    default:
      return unknownRunStart(run.start)
  }
}

/** 実行の開始の区切りが取れているか(取れていなければ選べない理由) */
function runStartAvailability(
  run: AgentChangesRecordRun
): Exclude<AgentChangesRunAvailability, { kind: 'end-not-recorded' }> {
  switch (run.start.kind) {
    case 'baseline':
    case 'snapshot':
      return { kind: 'available' }
    case 'failed':
      return { kind: 'start-not-recorded', reason: run.start.reason }
    default:
      return unknownRunStart(run.start)
  }
}

/**
 * 実行を選べるか。開始の区切りが取れていなければその理由を、取れていて終わり(次の実行の開始)の区切りが取れていなければ
 * end-not-recorded を返す(開始の理由を優先する)。最後の実行(next が無い)の終わりは作業ツリーなので、開始だけで決まる。
 * 範囲の解決(resolveAgentChangesScope)の start-not-recorded → end-not-recorded の順と同じ
 */
export function runAvailability(
  run: AgentChangesRecordRun,
  next: AgentChangesRecordRun | undefined
): AgentChangesRunAvailability {
  const start = runStartAvailability(run)
  if (start.kind !== 'available') return start
  if (next !== undefined && runStartAvailability(next).kind !== 'available') {
    return { kind: 'end-not-recorded' }
  }
  return start
}

/** IPC に渡す実行の一覧(古い順)。選べるかは runAvailability で決める */
export function summarizeAgentChangesRuns(record: AgentChangesRecord): AgentChangesRun[] {
  return record.runs.map((run, index) => {
    const next = record.runs[index + 1]
    return {
      runId: run.runId,
      number: run.number,
      startedAt: runStartedAt(record, run),
      endedAt: next === undefined ? null : runStartedAt(record, next),
      availability: runAvailability(run, next)
    }
  })
}

/** 区切りの写しの元: 実行の一覧を新しい方から見て、最初の取れた記録のインデックス(無ければ累積の始点) */
export function latestRecordedIndexPath(record: AgentChangesRecord): string {
  for (let index = record.runs.length - 1; index >= 0; index--) {
    const snapshot = runStartSnapshot(record, record.runs[index])
    if (snapshot !== null) return snapshot.indexPath
  }
  return record.baseline.indexPath
}

/**
 * 実行が持つ一時ディレクトリ(区切りのもの)。開始が累積の始点の実行は始点と同じものなので持たず(始点の側で消す)、
 * 取れなかった実行には消すものが無い(L-004)。記録を捨てるときと保持の上限で外すときが同じ規則で消す
 */
function runOwnedTempDir(run: AgentChangesRecordRun): string | null {
  switch (run.start.kind) {
    case 'snapshot':
      return run.start.snapshot.tempDir
    case 'baseline':
    case 'failed':
      return null
    default:
      return unknownRunStart(run.start)
  }
}

/** 記録を捨てるときに消す一時ディレクトリ(累積の始点と、実行が持つもの) */
export function agentChangesRecordTempDirs(record: AgentChangesRecord): string[] {
  return [
    record.baseline.tempDir,
    ...record.runs.flatMap((run) => {
      const dir = runOwnedTempDir(run)
      return dir === null ? [] : [dir]
    })
  ]
}

/**
 * 区切りの取得の結果から実行の開始を作る(canceled は呼び出し側で扱う)。区切りを取れなくても送信は止めない(記録はおまけ)ため、
 * 取れなかった実行も failed として足し、その実行と 1 つ前の実行を選べなくする。startedAt は区切りを取り始めた時刻
 */
export function runStartFromSnapshotResult(
  result: Exclude<BaselineSnapshotResult, { kind: 'canceled' }>,
  startedAt: number
): AgentChangesRunStart {
  return result.kind === 'recorded'
    ? { kind: 'snapshot', snapshot: result.snapshot }
    : { kind: 'failed', reason: result.state.reason, startedAt }
}

/**
 * 保持の上限(limit 件)を超えた古い実行を記録から外し、消すべき一時ディレクトリを返す。呼ぶのは新しい実行を足した後(L-003)。
 * 消す対象は外した実行が持つ一時ディレクトリだけ(runOwnedTempDir)
 */
export function dropRunsOverLimit(record: AgentChangesRecord, limit: number): string[] {
  const dirs: string[] = []
  while (record.runs.length > limit) {
    const dropped = record.runs.shift()
    const dir = dropped === undefined ? null : runOwnedTempDir(dropped)
    if (dir !== null) dirs.push(dir)
  }
  return dirs
}
