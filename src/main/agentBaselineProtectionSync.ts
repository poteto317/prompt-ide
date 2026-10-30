import type { AgentChangesRecord } from './agentChangesRecord'
import { protectionTreeEntries } from './agentChangesRecord'
import type { AgentChangesProtectionGit, ProtectionGitContext } from './agentChangesProtectionRef'
import type { ProtectionRefWrite } from './agentChangesProtectionRules'
import { classifyProtectionReread, protectionRefWriteOf } from './agentChangesProtectionRules'

// 記録の tree を gc から守る ref の同期(設計書「記録の blob を gc から守る」「保護の ref の名前」「残った ref の掃除」)。
// AgentBaselineRegistry から切り出した。記録の持ち主(registry)の状態は host から読み、ref を作れた記録・保護をやめた番号・
// 記録の所有者だけをここで持つ。列への並べ方(いつ同期するか)は registry が決め、ここは「1 回の同期」と「終了時の同期の削除」を行う

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

/** 保護の同期が読む、記録の持ち主(AgentBaselineRegistry)の状態 */
export interface AgentBaselineProtectionHost {
  /** アプリの終了中か(終了中は ref を作らず、作れた ref はその場で同期で消す) */
  isClosed: () => boolean
  /** 所有者の今の記録(無ければ undefined) */
  currentRecordOf: (ownerId: number) => AgentChangesRecord | undefined
  /** すべての所有者の今の記録(掃除で残す番号に使う) */
  currentRecords: () => Iterable<AgentChangesRecord>
}

export class AgentBaselineProtectionSync {
  // ref を作れた記録(今の記録と、捨てて削除を待っている記録)。close と掃除はこの集合だけを見る
  private readonly protectedRecords = new Set<AgentChangesRecord>()
  // 記録の所有者(捨てた記録の削除を、その所有者の列の同期で試し直すため)
  private readonly recordOwners = new WeakMap<AgentChangesRecord, number>()
  // 保護をやめた記録の番号(利用者が消した・書き換えた ref を掃除で消さない)。保護をやめたかの唯一の持ち主で、記録の側には
  // 持たない(記録を捨てた後も掃除で残すため、番号で持つ)
  private readonly abandonedSerials = new Set<number>()

  constructor(
    private readonly deps: AgentBaselineProtectionDeps,
    private readonly host: AgentBaselineProtectionHost
  ) {}

  /** 記録の所有者を覚える(記録を作った時点で呼ぶ) */
  registerOwner(record: AgentChangesRecord, ownerId: number): void {
    this.recordOwners.set(record, ownerId)
  }

  /**
   * 保護の同期(設計書「同期」)。先に、同じ所有者の捨てた記録で ref の削除が残っているもの(一時的な失敗で消せなかった)の削除を
   * 試し直し、その後に record を同期する。試すのは捨てた記録の数だけで、失敗は握る(読み直しの分類は通常の同期と同じ)。
   * record 自身の同期の失敗(cat-file・mktree)は投げる(呼び出し側が握り、次の同期で試し直す)
   */
  async sync(ownerId: number, record: AgentChangesRecord): Promise<void> {
    for (const discarded of this.discardedProtectedRecords(ownerId, record)) {
      await this.syncValue(ownerId, discarded).catch(() => undefined)
    }
    await this.syncValue(ownerId, record)
  }

  /**
   * アプリの終了。ref を作れた記録の ref を同期で消す(1 つが失敗しても残りを試す。L-010)。
   * 消せなかったものは次の記録の掃除で消える
   */
  removeAllSync(): void {
    for (const record of [...this.protectedRecords]) this.removeRefSync(record)
  }

  // ref を作れたまま捨てた所有者の記録(今の記録でも、これから同期する記録でもないもの)。一覧は呼んだ時点で作る
  private discardedProtectedRecords(
    ownerId: number,
    except: AgentChangesRecord
  ): AgentChangesRecord[] {
    const current = this.host.currentRecordOf(ownerId)
    return [...this.protectedRecords].filter(
      (record) =>
        record !== except && record !== current && this.recordOwners.get(record) === ownerId
    )
  }

  /**
   * 1 つの記録の保護の同期。列の番が来た時点の記録から ref のあるべき値を求め、前に書けた値(record.protection.value)と
   * 違えば作る・更新する・消す。終了中・保護をやめた記録・あるべき値を作れない(項目の tree が 1 つも無い)なら何もしない。
   * cat-file・mktree の失敗は投げる(呼び出し側が握り、次の同期で試し直す)。ref の書き込みの失敗は読み直しで分類する。
   * 隠れた git の記録(gitDir が文字列)は ref を作らず何もしない(設計書「保護の ref」。protectedRecords に入らないため、close・
   * 捨てた記録の削除の試し直しの対象にもならない)
   */
  private async syncValue(ownerId: number, record: AgentChangesRecord): Promise<void> {
    // 隠れた git の記録は保護の ref を作らない(隠れた git の命令は自動の gc を起こさず、gc.auto=0 も書いてある。ref を通すと、
    // 前の記録の一時ディレクトリを消した後に並ぶ ref の削除が消えた場所に対して失敗し続ける。L-403・L-428)
    if (record.baseline.gitDir !== null) return
    const state = record.protection
    if (this.host.isClosed() || this.isAbandoned(record)) return
    const ctx = this.contextOf(record)
    const desired = await this.desiredValue(ownerId, record, ctx)
    if (desired === null || this.host.isClosed() || this.isAbandoned(record)) return
    const write = protectionRefWriteOf(state.value, desired.value)
    if (write.kind === 'none') return
    try {
      await this.writeRef(record, ctx, write)
    } catch {
      await this.reconcile(record, desired.value)
      return
    }
    this.applyValue(record, desired.value)
  }

  private contextOf(record: AgentChangesRecord): ProtectionGitContext {
    return {
      folderPath: record.baseline.folderPath,
      indexPath: record.baseline.indexPath,
      noHooksDir: this.deps.noHooksDir
    }
  }

  /**
   * ref のあるべき値。今の記録なら、項目のうち object の DB にあるものだけで作った tree(1 つも無ければ null: 何もしない)。
   * 捨てた記録なら値は null(消す)
   */
  private async desiredValue(
    ownerId: number,
    record: AgentChangesRecord,
    ctx: ProtectionGitContext
  ): Promise<{ value: string | null } | null> {
    if (this.host.currentRecordOf(ownerId) !== record) return { value: null }
    const { git } = this.deps
    const entries = await git.filterExistingTrees(ctx, protectionTreeEntries(record))
    if (entries.length === 0) return null
    return { value: await git.makeTree(ctx, entries) }
  }

  // ref への書き込みを 1 つ行う(初めて作る前に残った ref を掃除する)。失敗は投げる
  private async writeRef(
    record: AgentChangesRecord,
    ctx: ProtectionGitContext,
    write: Exclude<ProtectionRefWrite, { kind: 'none' }>
  ): Promise<void> {
    const { git } = this.deps
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
    await this.deps.git
      .sweep(ctx, {
        instanceId: this.deps.instanceId,
        keepSerials: () => this.keptSerials(),
        isProcessAlive: this.deps.isProcessAlive
      })
      .catch(() => undefined)
  }

  // 書き込みの失敗の後に ref の今の値を読み直して分類する。読み直し自体の失敗は何も変えない(空を「無い」と読まない。L-002)
  private async reconcile(record: AgentChangesRecord, desired: string | null): Promise<void> {
    const state = record.protection
    let current: string | null
    try {
      current = await this.deps.git.read(this.contextOf(record), state.refName)
    } catch {
      return
    }
    switch (classifyProtectionReread(current, desired, state.value)) {
      case 'applied':
        this.applyValue(record, desired)
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
  private applyValue(record: AgentChangesRecord, value: string | null): void {
    record.protection.value = value
    if (value === null) {
      this.protectedRecords.delete(record)
      return
    }
    this.protectedRecords.add(record)
    if (this.host.isClosed()) this.removeRefSync(record)
  }

  // アプリの終了の同期の削除。消せたら value を null にして集合から外す
  private removeRefSync(record: AgentChangesRecord): void {
    const { refName, value } = record.protection
    if (value === null) return
    try {
      if (this.deps.git.removeSync(this.contextOf(record), refName, value)) {
        record.protection.value = null
        this.protectedRecords.delete(record)
      }
    } catch {
      // 消せなかった ref は、次にそのリポジトリで記録を取るときの掃除で消える
    }
  }

  // 保護をやめた記録か(利用者が ref を消した・書き換えた。以後は作り直さず消さない)
  private isAbandoned(record: AgentChangesRecord): boolean {
    return this.abandonedSerials.has(record.recordSerial)
  }

  // 掃除で残す番号: すべての所有者の今の記録・ref を作れた記録(削除待ちを含む)・保護をやめた番号
  private keptSerials(): ReadonlySet<number> {
    return new Set([
      ...[...this.host.currentRecords()].map((record) => record.recordSerial),
      ...[...this.protectedRecords].map((record) => record.recordSerial),
      ...this.abandonedSerials
    ])
  }
}
