import type {
  AgentChangesBeginTrigger,
  AgentChangesState,
  AgentChangesUndoOperation,
  AgentChangesUndoResult,
  AgentRevertResult
} from '@shared/types'
import { AGENT_CHANGES_MAX_RUNS } from '@shared/types'
import type { BaselineSnapshot, BaselineSnapshotResult } from './agentBaselineSnapshot'
import type { AgentChangesRecord, AgentChangesRunStart } from './agentChangesRecord'
import type { AgentChangesProtectionGit, ProtectionGitContext } from './agentChangesProtectionRef'
import type { ProtectionRefWrite } from './agentChangesProtectionRules'
import {
  classifyProtectionReread,
  protectionRefName,
  protectionRefWriteOf
} from './agentChangesProtectionRules'
import {
  agentChangesRecordTempDirs,
  createAgentChangesRecord,
  dropRunsOverLimit,
  latestRecordedIndexPath,
  protectionTreeEntries,
  runStartFromSnapshotResult,
  summarizeAgentChangesRuns
} from './agentChangesRecord'
import type {
  AgentChangesUndo,
  AgentChangesUndoCapture,
  AgentChangesUndoExecution
} from './agentChangesUndoModel'
import {
  AGENT_UNDO_STALE_MESSAGE,
  summarizeAgentChangesUndo,
  toAgentChangesUndoResult,
  toAgentRevertUndoOutcome
} from './agentChangesUndoModel'
import { KeyedSerialQueue } from './keyedSerialQueue'

// 所有者(webContents の id)→ 記録(0 か 1 つ。累積の始点・実行の一覧・保護の ref の状態・取り消しの控え)。Electron に依存しない
// (設計書「状態の持ち主」「記録の持ち方」)。
// - 世代: 記録の開始の依頼・clear・所有者の文脈の終わりで進める。記録・区切りを取る間に世代が変わったら、取れたものを捨てる(パターン 141)
// - 列: 記録のインデックスを使う操作(一覧・diff・戻す)・取り消しと区切りの取得は、所有者ごとに 1 本の列に並べる(index.lock の衝突を避け、
//   写しの元を同じ所有者の git が同時に読み書きせず、送った順と実行の番号の順が一致する)。
//   clear は記録をすぐに外し(以後の依頼は記録なしになる)、一時ディレクトリの削除は列の後ろで行う(実行中の操作は最後まで行う)
// - 保護: 記録の形が変わるたびに、所有者の列の後ろに「保護の同期」を並べる(設計書「記録の blob を gc から守る」)。begin・addRun は同期を待たない
// - 取り消しの控え: 戻す操作の結果で控えを残すか捨てるかを決め、undoId を振る(commitRevertUndo)。取り消しは控えの書き戻しを
//   注入された executeUndo に任せ、結果で控えを捨てるかだけを決める(undoLastRevert。ファイルの読み書きを持たない)

/** 記録の tree を gc から守る ref の依存(設計書「保護の ref の名前」「残った ref の掃除」) */
export interface AgentBaselineProtectionDeps {
  /** main の起動ごとの ID(<pid>-<乱数 8 桁の 16 進>) */
  instanceId: string
  /** hook の無いディレクトリ(core.hooksPath に渡す) */
  noHooksDir: string
  git: AgentChangesProtectionGit
  /** その pid のプロセスがこのマシンにあるか(掃除で使う) */
  isProcessAlive: (pid: number) => boolean
}

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
  /** 記録の tree を守る ref(記録中だけ。clear・close で消す) */
  protection: AgentBaselineProtectionDeps
  /**
   * 控えで作業ツリーを書き戻す(本番は agentChangesUndo の executeAgentChangesUndo に moveToTrash を渡したもの)。registry は
   * ファイルの読み書きを持たず、結果で控えを残すか捨てるかだけを決める
   */
  executeUndo: (folderPath: string, undo: AgentChangesUndo) => Promise<AgentChangesUndoExecution>
}

/** 戻す操作の結果の控え(handler が commitRevertUndo に渡す) */
export interface AgentRevertUndoCommit {
  operation: AgentChangesUndoOperation
  capture: AgentChangesUndoCapture
  /** 作業ツリーに適用した件数 */
  applied: number
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
  // 所有者ごとの次の undoId。記録を捨てても戻さない(L-037)
  private readonly nextUndoIds = new Map<number, number>()
  private readonly queue = new KeyedSerialQueue()
  // インスタンスの中で記録を取るたびに増える番号(保護の ref の名前)
  private nextRecordSerial = 1
  // ref を作れた記録(今の記録と、捨てて削除を待っている記録)。close と掃除はこの集合だけを見る
  private readonly protectedRecords = new Set<AgentChangesRecord>()
  // 保護をやめた記録の番号(利用者が消した・書き換えた ref を掃除で消さない)。保護をやめたかの唯一の持ち主で、記録の側には
  // 持たない(記録を捨てた後も掃除で残すため、番号で持つ)
  private readonly abandonedSerials = new Set<number>()
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
      const recordSerial = this.nextRecordSerial++
      const record = createAgentChangesRecord(
        result.snapshot,
        recordSerial,
        protectionRefName(this.deps.protection.instanceId, recordSerial)
      )
      if (trigger === 'send') this.appendRun(ownerId, record, { kind: 'baseline' })
      this.records.set(ownerId, record)
      // 保護の同期(待たない)。前の記録の削除を、新しい記録の作成より先に並べる
      if (previous !== undefined) this.enqueueProtectionSync(ownerId, previous)
      this.enqueueProtectionSync(ownerId, record)
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
    // 捨てた記録の ref を消してから一時ディレクトリを消す(同じ列の中で直列。実行中の操作は最後まで行う)
    await this.queue.enqueue(ownerId, async () => {
      await this.syncProtection(ownerId, record).catch(() => undefined)
      await this.removeDirs(agentChangesRecordTempDirs(record))
    })
  }

  /**
   * 戻す操作の控えを記録へ移す(設計書「戻す操作の流れの変更」)。withRecord のタスクの中で呼ぶ。次の順に見る。
   * 作業ツリーを 1 件も変えなかった(すべて戻すで確認の一覧も今の一覧も空)なら、新しい控えを消し、前の控えを残してその要約を返す
   * (何も変えなかった依頼で前の取り消しの機会を消さない)。
   * registry が終了中・記録が今の記録でない(戻す操作の途中に clear・begin の置き換え)なら、新しい控えを付けずに消し、
   * 控えの成否を discarded・要約を null にする(付けなかった控えを「取り消せます」と伝えない)。
   * それ以外は、取れた控えは undoId を振って記録に持ち、その後に前の控えを消す。取れなかったなら控えを null にして前の控えを消す
   * (新しい操作が取り消せないのに、古い操作を「直前」として出し続けない)。前の控えを捨てるのは新しい結果が決まった後(L-003)。
   * 返すのは renderer に返す控えの成否と、戻した後の記録の控えの要約
   */
  async commitRevertUndo(
    ownerId: number,
    record: AgentChangesRecord,
    { operation, capture, applied }: AgentRevertUndoCommit
  ): Promise<AgentRevertResult> {
    const undo = toAgentRevertUndoOutcome(capture)
    if (applied === 0) {
      if (capture.kind === 'saved') await this.removeUndoDir(capture.dir)
      return { undo, undoSummary: summarizeAgentChangesUndo(record.undo) }
    }
    if (this.closed || this.records.get(ownerId) !== record) {
      if (capture.kind === 'saved') await this.removeUndoDir(capture.dir)
      return { undo: { kind: 'discarded' }, undoSummary: null }
    }
    const previous = record.undo
    if (capture.kind === 'saved') {
      const undoId = this.nextUndoIds.get(ownerId) ?? 1
      this.nextUndoIds.set(ownerId, undoId + 1)
      record.undo = { undoId, operation, dir: capture.dir, items: capture.items }
    } else {
      record.undo = null
    }
    if (previous !== null) await this.removeUndoDir(previous.dir)
    return { undo, undoSummary: summarizeAgentChangesUndo(record.undo) }
  }

  /**
   * 直前の戻す操作を取り消す(設計書「取り消しの流れ」)。記録の列の中で、今の控えの undoId と照合する(違えば何も変えずに例外。
   * L-035)。作業ツリーを変えずに止まり、結果が控えを残すとした(全件の照合で読み込みの失敗だけ・書き換えを始めて 0 件のまま
   * 書く直前に読み込めない・書き換えに失敗した)なら控えを残し、それ以外(照合の不一致・控えのファイルが無い・書く直前の照合が
   * 合わない・1 件以上書き換えた)は控えを捨てる。記録が無ければ null
   */
  undoLastRevert(
    ownerId: number,
    folderPath: string,
    undoId: number
  ): Promise<AgentChangesUndoResult | null> {
    return this.withRecord(ownerId, folderPath, async (record) => {
      const undo = record.undo
      if (undo === null || undo.undoId !== undoId) throw new Error(AGENT_UNDO_STALE_MESSAGE)
      const execution = await this.deps.executeUndo(record.baseline.folderPath, undo)
      // 作業ツリーを変えずに止まり、結果が控えを残すとしたなら、もう一度取り消せるよう控えを残す
      if ((execution.kind === 'rejected' || execution.kind === 'failed') && execution.keepUndo) {
        throw new Error(execution.message)
      }
      if (record.undo === undo) record.undo = null
      await this.removeUndoDir(undo.dir)
      if (execution.kind === 'rejected' || execution.kind === 'failed') {
        throw new Error(execution.message)
      }
      return toAgentChangesUndoResult(execution)
    })
  }

  /**
   * アプリの終了。以後の記録を取らず、作れた保護の ref とすべての一時ディレクトリを待たずに消す(1 つが投げても残りを試す。L-010)
   */
  close(): void {
    this.closed = true
    // ref を作れた記録の ref を同期で消す(1 つが失敗しても残りを試す。L-010)。消せなかったものは次の記録の掃除で消える
    for (const record of [...this.protectedRecords]) this.removeProtectionRefSync(record)
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
      // 記録の形が変わった(実行を足した・外した)ので保護を同期する(待たない。送信の前の待ちに含めない)
      this.enqueueProtectionSync(ownerId, record)
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

  // 保護の同期を所有者の列の後ろに並べる(待たない)。失敗は握り、次の同期で試し直す
  private enqueueProtectionSync(ownerId: number, record: AgentChangesRecord): void {
    void this.queue
      .enqueue(ownerId, () => this.syncProtection(ownerId, record))
      .catch(() => undefined)
  }

  private protectionContextOf(record: AgentChangesRecord): ProtectionGitContext {
    return {
      folderPath: record.baseline.folderPath,
      indexPath: record.baseline.indexPath,
      noHooksDir: this.deps.protection.noHooksDir
    }
  }

  /**
   * 保護の同期(設計書「同期」)。列の番が来た時点の記録から ref のあるべき値を求め、前に書けた値(record.protection.value)と
   * 違えば作る・更新する・消す。終了中・保護をやめた記録・あるべき値を作れない(項目の tree が 1 つも無い)なら何もしない。
   * cat-file・mktree の失敗は投げる(呼び出し側が握り、次の同期で試し直す)。ref の書き込みの失敗は読み直しで分類する
   */
  private async syncProtection(ownerId: number, record: AgentChangesRecord): Promise<void> {
    const state = record.protection
    if (this.closed || this.isProtectionAbandoned(record)) return
    const ctx = this.protectionContextOf(record)
    const desired = await this.desiredProtectionValue(ownerId, record, ctx)
    if (desired === null || this.closed || this.isProtectionAbandoned(record)) return
    const write = protectionRefWriteOf(state.value, desired.value)
    if (write.kind === 'none') return
    try {
      await this.writeProtectionRef(record, ctx, write)
    } catch {
      await this.reconcileProtection(record, desired.value)
      return
    }
    this.applyProtectionValue(record, desired.value)
  }

  /**
   * ref のあるべき値。今の記録なら、項目のうち object の DB にあるものだけで作った tree(1 つも無ければ null: 何もしない)。
   * 捨てた記録なら値は null(消す)
   */
  private async desiredProtectionValue(
    ownerId: number,
    record: AgentChangesRecord,
    ctx: ProtectionGitContext
  ): Promise<{ value: string | null } | null> {
    if (this.records.get(ownerId) !== record) return { value: null }
    const { git } = this.deps.protection
    const entries = await git.filterExistingTrees(ctx, protectionTreeEntries(record))
    if (entries.length === 0) return null
    return { value: await git.makeTree(ctx, entries) }
  }

  // ref への書き込みを 1 つ行う(初めて作る前に残った ref を掃除する)。失敗は投げる
  private async writeProtectionRef(
    record: AgentChangesRecord,
    ctx: ProtectionGitContext,
    write: Exclude<ProtectionRefWrite, { kind: 'none' }>
  ): Promise<void> {
    const { git } = this.deps.protection
    const { refName } = record.protection
    switch (write.kind) {
      case 'create':
        await this.sweepOnce(record, ctx)
        await git.create(ctx, refName, write.value)
        return
      case 'update':
        await git.update(ctx, refName, write.value, write.expected)
        return
      case 'remove':
        await git.remove(ctx, refName, write.expected)
        return
    }
  }

  // 記録の ref を初めて作る前に 1 回だけ、残った ref を掃除する(失敗は握る)
  private async sweepOnce(record: AgentChangesRecord, ctx: ProtectionGitContext): Promise<void> {
    if (record.protection.swept) return
    record.protection.swept = true
    await this.deps.protection.git
      .sweep(ctx, {
        instanceId: this.deps.protection.instanceId,
        keepSerials: () => this.keptSerials(),
        isProcessAlive: this.deps.protection.isProcessAlive
      })
      .catch(() => undefined)
  }

  // 書き込みの失敗の後に ref の今の値を読み直して分類する。読み直し自体の失敗は何も変えない(空を「無い」と読まない。L-002)
  private async reconcileProtection(
    record: AgentChangesRecord,
    desired: string | null
  ): Promise<void> {
    const state = record.protection
    let current: string | null
    try {
      current = await this.deps.protection.git.read(this.protectionContextOf(record), state.refName)
    } catch {
      return
    }
    switch (classifyProtectionReread(current, desired, state.value)) {
      case 'applied':
        this.applyProtectionValue(record, desired)
        return
      case 'retry':
        // 前に書いた値のまま(作るときは「無い」まま)なら次の同期で試し直す
        return
      case 'abandoned':
        break
    }
    // 利用者が消した・書き換えた。以後は作り直さず、消さない(掃除でも残す)
    this.abandonedSerials.add(record.recordSerial)
    this.protectedRecords.delete(record)
  }

  // 書けた値を記録に反映する。作れた・更新できた時点で終了中なら、新しい値でその場で同期で消す(close の後に残さない)
  private applyProtectionValue(record: AgentChangesRecord, value: string | null): void {
    record.protection.value = value
    if (value === null) {
      this.protectedRecords.delete(record)
      return
    }
    this.protectedRecords.add(record)
    if (this.closed) this.removeProtectionRefSync(record)
  }

  // アプリの終了の同期の削除。消せたら value を null にして集合から外す
  private removeProtectionRefSync(record: AgentChangesRecord): void {
    const { refName, value } = record.protection
    if (value === null) return
    try {
      if (this.deps.protection.git.removeSync(this.protectionContextOf(record), refName, value)) {
        record.protection.value = null
        this.protectedRecords.delete(record)
      }
    } catch {
      // 消せなかった ref は、次にそのリポジトリで記録を取るときの掃除で消える
    }
  }

  // 保護をやめた記録か(利用者が ref を消した・書き換えた。以後は作り直さず消さない)
  private isProtectionAbandoned(record: AgentChangesRecord): boolean {
    return this.abandonedSerials.has(record.recordSerial)
  }

  // 掃除で残す番号: すべての所有者の今の記録・ref を作れた記録(削除待ちを含む)・保護をやめた番号
  private keptSerials(): ReadonlySet<number> {
    return new Set([
      ...[...this.records.values()].map((record) => record.recordSerial),
      ...[...this.protectedRecords].map((record) => record.recordSerial),
      ...this.abandonedSerials
    ])
  }

  private recordingState(record: AgentChangesRecord): AgentChangesState {
    return {
      kind: 'recording',
      startedAt: record.baseline.startedAt,
      runs: summarizeAgentChangesRuns(record),
      undo: summarizeAgentChangesUndo(record.undo)
    }
  }

  // 取り消された記録・区切りの一時ディレクトリを消す(アプリの終了中は待てないので同期で消す)
  private async discardSnapshot(snapshot: BaselineSnapshot): Promise<void> {
    if (this.closed) this.deps.removeDirSync(snapshot.tempDir)
    else await this.deps.removeDir(snapshot.tempDir)
  }

  // 控えの一時ディレクトリを消す(アプリの終了中は待てないので同期で消す)。消せなくても戻す・取り消しの結果は変えない
  private async removeUndoDir(dir: string): Promise<void> {
    if (!this.closed) {
      await this.deps.removeDir(dir).catch(() => undefined)
      return
    }
    try {
      this.deps.removeDirSync(dir)
    } catch {
      // 消せなかったものは OS の一時ディレクトリの掃除に任せる
    }
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
