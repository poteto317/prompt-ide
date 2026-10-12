import type { AgentChangesBeginTrigger, AgentChangesState } from '@shared/types'
import { AGENT_CHANGES_MAX_RUNS } from '@shared/types'
import type { BaselineSnapshot, BaselineSnapshotResult } from './agentBaselineSnapshot'
import type { AgentChangesRecord, AgentChangesRunStart } from './agentChangesRecord'
import {
  agentChangesRecordTempDirs,
  dropRunsOverLimit,
  latestRecordedIndexPath,
  runStartFromSnapshotResult,
  summarizeAgentChangesRuns
} from './agentChangesRecord'
import { KeyedSerialQueue } from './keyedSerialQueue'

// 所有者(webContents の id)→ 記録(0 か 1 つ。累積の始点と実行の一覧)。Electron に依存しない(設計書「状態の持ち主」「記録の持ち方」)。
// - 世代: 記録の開始の依頼・clear・所有者の文脈の終わりで進める。記録・区切りを取る間に世代が変わったら、取れたものを捨てる(パターン 141)
// - 列: 記録のインデックスを使う操作(一覧・diff・戻す)と区切りの取得は、所有者ごとに 1 本の列に並べる(index.lock の衝突を避け、
//   写しの元を同じ所有者の git が同時に読み書きせず、送った順と実行の番号の順が一致する)。
//   clear は記録をすぐに外し(以後の依頼は記録なしになる)、一時ディレクトリの削除は列の後ろで行う(実行中の操作は最後まで行う)

export interface AgentBaselineRegistryDeps {
  /**
   * 記録を取る(agentBaselineSnapshot.takeBaselineSnapshot)。isCanceled は await のたびに呼ばれる。baseIndexPath は区切りの写しの元。
   * now は記録の時刻の時計(deps.now をそのまま渡す)
   */
  takeSnapshot: (
    folderPath: string,
    options: { isCanceled: () => boolean; now: () => number; baseIndexPath?: string }
  ) => Promise<BaselineSnapshotResult>
  /** 一時ディレクトリを消す(removeBaselineDir) */
  removeDir: (tempDir: string) => Promise<void>
  /** アプリの終了で、待たずに消す(removeBaselineDirSync) */
  removeDirSync: (tempDir: string) => void
  /**
   * 今の時刻。実行の開始の時刻は、区切りを取れた実行(記録の startedAt)も取れなかった実行もこの 1 つの時計で決める
   * (takeSnapshot にも渡す。取れたかどうかで別の時計の時刻が混ざらない)
   */
  now: () => number
}

export class AgentBaselineRegistry {
  private readonly records = new Map<number, AgentChangesRecord>()
  private readonly generations = new Map<number, number>()
  // 累積の始点を取っている途中の依頼(同じ世代・同じフォルダの手動の依頼はこれにまとめる)
  private readonly pending = new Map<
    number,
    { generation: number; folderPath: string; request: Promise<AgentChangesState> }
  >()
  // 所有者ごとの次の runId。記録を捨てても戻さない(古い写しから届いた範囲が、新しい記録の別の実行を指さない。L-037)
  private readonly nextRunIds = new Map<number, number>()
  private readonly queue = new KeyedSerialQueue()
  private closed = false

  constructor(private readonly deps: AgentBaselineRegistryDeps) {}

  generationOf(ownerId: number): number {
    return this.generations.get(ownerId) ?? 0
  }

  /**
   * 記録を始める(設計書「依頼の流れ」)。manual: 記録があれば何もせずに recording を返し、取得中の始点があれば合流し、無ければ始点を取る。
   * send: 記録が無ければ始点を取って実行 1(開始は始点)を足し、記録があれば列の中で区切りを取って実行を足す。始点の取得中の send は
   * 合流せず、始点を取り終えてから区切りを取る(送信ごとに 1 つの実行)。記録・区切りを取る間に clear・所有者の文脈の終わり・
   * アプリの終了が来たら、取れたものを捨てて none を返す
   */
  async begin(
    ownerId: number,
    folderPath: string,
    trigger: AgentChangesBeginTrigger
  ): Promise<AgentChangesState> {
    if (this.closed) return { kind: 'none' }
    const existing = this.currentRecord(ownerId, folderPath)
    if (existing !== null) {
      return trigger === 'send' ? this.addRun(ownerId, folderPath) : this.recordingState(existing)
    }
    const inFlight = this.pending.get(ownerId)
    if (
      inFlight !== undefined &&
      inFlight.generation === this.generationOf(ownerId) &&
      inFlight.folderPath === folderPath
    ) {
      if (trigger === 'manual') return inFlight.request
      const state = await inFlight.request
      return state.kind === 'recording' ? this.addRun(ownerId, folderPath) : state
    }
    // 取得中の依頼が別のフォルダなら、世代を進めて古い取得を取り消す(先の記録が後の記録を上書きしない)
    if (inFlight !== undefined && inFlight.folderPath !== folderPath) {
      this.generations.set(ownerId, this.generationOf(ownerId) + 1)
    }
    const generation = this.generationOf(ownerId)
    const isCanceled = (): boolean => this.closed || this.generationOf(ownerId) !== generation
    // 始点の取得の依頼(実行〈AgentChangesRecordRun〉とは別のもの)
    const request = (async (): Promise<AgentChangesState> => {
      const result = await this.deps.takeSnapshot(folderPath, { isCanceled, now: this.deps.now })
      if (result.kind === 'canceled') return { kind: 'none' }
      if (result.kind === 'unavailable') return result.state
      if (isCanceled()) {
        await this.discardSnapshot(result.snapshot)
        return { kind: 'none' }
      }
      const previous = this.records.get(ownerId)
      if (previous !== undefined) await this.removeDirs(agentChangesRecordTempDirs(previous))
      // 始点を取り終えたときに実行 1 を足すかは、始点の取得を始めた依頼の trigger で決める(pending には持たせない)
      const record: AgentChangesRecord = { baseline: result.snapshot, runs: [], nextNumber: 1 }
      if (trigger === 'send') this.appendRun(ownerId, record, { kind: 'baseline' })
      this.records.set(ownerId, record)
      return this.recordingState(record)
    })()
    const entry = { generation, folderPath, request }
    this.pending.set(ownerId, entry)
    try {
      return await request
    } finally {
      if (this.pending.get(ownerId) === entry) this.pending.delete(ownerId)
    }
  }

  /** いまの状態(一覧を作らない)。記録のフォルダがいまの許可のフォルダと違えば、記録を捨てて none */
  getState(ownerId: number, folderPath: string): AgentChangesState {
    const record = this.currentRecord(ownerId, folderPath)
    return record === null ? { kind: 'none' } : this.recordingState(record)
  }

  /**
   * 記録を使う操作を所有者の列に並べて行う。列の順番が来た時点で記録が無い(clear 済み・フォルダが違う)なら
   * task を呼ばずに null を返す。フォルダが違っても記録は捨てない: folderPath は依頼の入り口で取ったもので、列で待つ間に
   * フォルダが切り替わり新しい記録が作られていることがある(PR #47 レビュー A-2。古い依頼が新しい記録を捨てていた)
   */
  withRecord<T>(
    ownerId: number,
    folderPath: string,
    task: (record: AgentChangesRecord) => Promise<T>
  ): Promise<T | null> {
    return this.queue.enqueue(ownerId, async () => {
      const record = this.matchingRecord(ownerId, folderPath)
      return record === null ? null : task(record)
    })
  }

  /** 記録を捨てる(確認を終える・所有者の文脈の終わり)。記録・区切りを取る途中の依頼も取り消す */
  async clear(ownerId: number): Promise<void> {
    this.generations.set(ownerId, this.generationOf(ownerId) + 1)
    const record = this.records.get(ownerId)
    if (record === undefined) return
    this.records.delete(ownerId)
    await this.queue.enqueue(ownerId, () => this.removeDirs(agentChangesRecordTempDirs(record)))
  }

  /** アプリの終了。以後の記録を取らず、すべての一時ディレクトリを待たずに消す(1 つが投げても残りを試す。L-010) */
  close(): void {
    this.closed = true
    for (const record of this.records.values()) {
      for (const dir of agentChangesRecordTempDirs(record)) {
        try {
          this.deps.removeDirSync(dir)
        } catch {
          // 消せなかったものは OS の一時ディレクトリの掃除に任せ、残りを試す
        }
      }
    }
    this.records.clear()
  }

  // 区切りを取り、実行を足す(列の中で行う)。列の番が来た時点で記録が無い・フォルダが違う・世代が変わったなら何もせず none
  private addRun(ownerId: number, folderPath: string): Promise<AgentChangesState> {
    const generation = this.generationOf(ownerId)
    const isCanceled = (): boolean => this.closed || this.generationOf(ownerId) !== generation
    return this.queue.enqueue(ownerId, async (): Promise<AgentChangesState> => {
      const record = this.matchingRecord(ownerId, folderPath)
      if (record === null || isCanceled()) return { kind: 'none' }
      const startedAt = this.deps.now()
      const result = await this.deps.takeSnapshot(folderPath, {
        isCanceled,
        now: this.deps.now,
        baseIndexPath: latestRecordedIndexPath(record)
      })
      if (result.kind === 'canceled') return { kind: 'none' }
      if (isCanceled()) {
        if (result.kind === 'recorded') await this.discardSnapshot(result.snapshot)
        return { kind: 'none' }
      }
      this.appendRun(ownerId, record, runStartFromSnapshotResult(result, startedAt))
      // 保持の上限(外した実行の区切りの一時ディレクトリだけを消す)
      await this.removeDirs(dropRunsOverLimit(record, AGENT_CHANGES_MAX_RUNS))
      return this.recordingState(record)
    })
  }

  private appendRun(
    ownerId: number,
    record: AgentChangesRecord,
    start: AgentChangesRunStart
  ): void {
    const runId = this.nextRunIds.get(ownerId) ?? 1
    this.nextRunIds.set(ownerId, runId + 1)
    record.runs.push({ runId, number: record.nextNumber, start })
    record.nextNumber += 1
  }

  private recordingState(record: AgentChangesRecord): AgentChangesState {
    return {
      kind: 'recording',
      startedAt: record.baseline.startedAt,
      runs: summarizeAgentChangesRuns(record)
    }
  }

  // 取り消された記録・区切りの一時ディレクトリを消す(アプリの終了中は待てないので同期で消す)
  private async discardSnapshot(snapshot: BaselineSnapshot): Promise<void> {
    if (this.closed) this.deps.removeDirSync(snapshot.tempDir)
    else await this.deps.removeDir(snapshot.tempDir)
  }

  // 1 つの削除が失敗しても残りを試す(removeBaselineDir は失敗を握るが、依存の差し替えにも備える。L-010)
  private async removeDirs(dirs: string[]): Promise<void> {
    for (const dir of dirs) await this.deps.removeDir(dir).catch(() => undefined)
  }

  // 記録があり、そのフォルダが folderPath と同じなら返す(照合だけ。記録は捨てない)
  private matchingRecord(ownerId: number, folderPath: string): AgentChangesRecord | null {
    const record = this.records.get(ownerId)
    return record !== undefined && record.baseline.folderPath === folderPath ? record : null
  }

  // matchingRecord に加え、フォルダが違えば記録を捨てる(フォルダの切り替えの通知より先に依頼が来た場合)。
  // begin・getState は呼ばれた時点のいまの許可のフォルダと同期で比べるため、記録の方が古いと言える。withRecord では使わない
  private currentRecord(ownerId: number, folderPath: string): AgentChangesRecord | null {
    const record = this.matchingRecord(ownerId, folderPath)
    if (record === null && this.records.has(ownerId)) void this.clear(ownerId)
    return record
  }
}
