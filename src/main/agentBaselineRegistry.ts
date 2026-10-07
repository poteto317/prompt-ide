import type { AgentChangesState } from '@shared/types'
import type { BaselineSnapshot, BaselineSnapshotResult } from './agentBaselineSnapshot'
import { KeyedSerialQueue } from './keyedSerialQueue'

// 所有者(webContents の id)→ 記録(0 か 1 つ)。Electron に依存しない(設計書「状態の持ち主」)。
// - 世代: 記録の開始の依頼・clear・所有者の文脈の終わりで進める。記録を取る間に世代が変わったら、取れた記録を捨てる(パターン 141)
// - 列: 記録のインデックスを使う操作(一覧・diff・戻す)は所有者ごとに 1 本の列に並べる(index.lock の衝突を避ける)。
//   clear は記録をすぐに外し(以後の依頼は記録なしになる)、一時ディレクトリの削除は列の後ろで行う(実行中の操作は最後まで行う)

export interface AgentBaselineRegistryDeps {
  /** 記録を取る(agentBaselineSnapshot.takeBaselineSnapshot)。isCanceled は await のたびに呼ばれる */
  takeSnapshot: (
    folderPath: string,
    options: { isCanceled: () => boolean }
  ) => Promise<BaselineSnapshotResult>
  /** 一時ディレクトリを消す(removeBaselineDir) */
  removeDir: (tempDir: string) => Promise<void>
  /** アプリの終了で、待たずに消す(removeBaselineDirSync) */
  removeDirSync: (tempDir: string) => void
}

export class AgentBaselineRegistry {
  private readonly records = new Map<number, BaselineSnapshot>()
  private readonly generations = new Map<number, number>()
  // 記録を取っている途中の依頼(同じ世代・同じフォルダの依頼はこれにまとめる。二重の「実行」・「いまから記録する」)
  private readonly pending = new Map<
    number,
    { generation: number; folderPath: string; run: Promise<AgentChangesState> }
  >()
  private readonly queue = new KeyedSerialQueue()
  private closed = false

  constructor(private readonly deps: AgentBaselineRegistryDeps) {}

  generationOf(ownerId: number): number {
    return this.generations.get(ownerId) ?? 0
  }

  /**
   * 記録を始める。記録があれば何もせずに recording を返す(累積。設計書「複数回の実行」)。
   * 記録を取る間に clear・所有者の文脈の終わり・アプリの終了が来たら、取れた記録を捨てて none を返す
   */
  async begin(ownerId: number, folderPath: string): Promise<AgentChangesState> {
    if (this.closed) return { kind: 'none' }
    const existing = this.currentRecord(ownerId, folderPath)
    if (existing !== null) return { kind: 'recording', startedAt: existing.startedAt }
    const inFlight = this.pending.get(ownerId)
    if (
      inFlight !== undefined &&
      inFlight.generation === this.generationOf(ownerId) &&
      inFlight.folderPath === folderPath
    ) {
      return inFlight.run
    }
    // 取得中の依頼が別のフォルダなら、世代を進めて古い取得を取り消す(先の記録が後の記録を上書きしない)
    if (inFlight !== undefined && inFlight.folderPath !== folderPath) {
      this.generations.set(ownerId, this.generationOf(ownerId) + 1)
    }
    const generation = this.generationOf(ownerId)
    const isCanceled = (): boolean => this.closed || this.generationOf(ownerId) !== generation
    const run = (async (): Promise<AgentChangesState> => {
      const result = await this.deps.takeSnapshot(folderPath, { isCanceled })
      if (result.kind === 'canceled') return { kind: 'none' }
      if (result.kind === 'unavailable') return result.state
      if (isCanceled()) {
        // アプリの終了中は待てないので同期で消す
        if (this.closed) this.deps.removeDirSync(result.snapshot.tempDir)
        else await this.deps.removeDir(result.snapshot.tempDir)
        return { kind: 'none' }
      }
      const previous = this.records.get(ownerId)
      if (previous !== undefined) await this.deps.removeDir(previous.tempDir)
      this.records.set(ownerId, result.snapshot)
      return { kind: 'recording', startedAt: result.snapshot.startedAt }
    })()
    const entry = { generation, folderPath, run }
    this.pending.set(ownerId, entry)
    try {
      return await run
    } finally {
      if (this.pending.get(ownerId) === entry) this.pending.delete(ownerId)
    }
  }

  /** いまの状態(一覧を作らない)。記録のフォルダがいまの許可のフォルダと違えば、記録を捨てて none */
  getState(ownerId: number, folderPath: string): AgentChangesState {
    const record = this.currentRecord(ownerId, folderPath)
    return record === null ? { kind: 'none' } : { kind: 'recording', startedAt: record.startedAt }
  }

  /**
   * 記録を使う操作を所有者の列に並べて行う。列の順番が来た時点で記録が無い(clear 済み・フォルダが違う)なら
   * task を呼ばずに null を返す。フォルダが違っても記録は捨てない: folderPath は依頼の入り口で取ったもので、列で待つ間に
   * フォルダが切り替わり新しい記録が作られていることがある(PR #47 レビュー A-2。古い依頼が新しい記録を捨てていた)
   */
  withRecord<T>(
    ownerId: number,
    folderPath: string,
    task: (snapshot: BaselineSnapshot) => Promise<T>
  ): Promise<T | null> {
    return this.queue.enqueue(ownerId, async () => {
      const record = this.matchingRecord(ownerId, folderPath)
      return record === null ? null : task(record)
    })
  }

  /** 記録を捨てる(確認を終える・所有者の文脈の終わり)。記録を取る途中の依頼も取り消す */
  async clear(ownerId: number): Promise<void> {
    this.generations.set(ownerId, this.generationOf(ownerId) + 1)
    const record = this.records.get(ownerId)
    if (record === undefined) return
    this.records.delete(ownerId)
    await this.queue.enqueue(ownerId, () => this.deps.removeDir(record.tempDir))
  }

  /** アプリの終了。以後の記録を取らず、すべての一時ディレクトリを待たずに消す */
  close(): void {
    this.closed = true
    for (const record of this.records.values()) this.deps.removeDirSync(record.tempDir)
    this.records.clear()
  }

  // 記録があり、そのフォルダが folderPath と同じなら返す(照合だけ。記録は捨てない)
  private matchingRecord(ownerId: number, folderPath: string): BaselineSnapshot | null {
    const record = this.records.get(ownerId)
    return record !== undefined && record.folderPath === folderPath ? record : null
  }

  // matchingRecord に加え、フォルダが違えば記録を捨てる(フォルダの切り替えの通知より先に依頼が来た場合)。
  // begin・getState は呼ばれた時点のいまの許可のフォルダと同期で比べるため、記録の方が古いと言える。withRecord では使わない
  private currentRecord(ownerId: number, folderPath: string): BaselineSnapshot | null {
    const record = this.matchingRecord(ownerId, folderPath)
    if (record === null && this.records.has(ownerId)) void this.clear(ownerId)
    return record
  }
}
