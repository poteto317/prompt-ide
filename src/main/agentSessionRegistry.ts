import type {
  AgentExitReason,
  AgentInterruptFollowUpResult,
  AgentInterruptResult,
  AgentStartResult
} from '@shared/types'
import { AGENT_MAX_SESSIONS_PER_WINDOW, agentStartCanceled } from '@shared/types'
import type { AgentSession } from './agentSession'

// webContents の id → 枠(renderer のタブ)→ エージェントのセッション(1 ウィンドウに AGENT_MAX_SESSIONS_PER_WINDOW まで)。
// Electron に依存しない。起動の依頼の重複(StrictMode の 2 回目など。確認の結果 10)は枠ごとに 1 つにまとめ、
// 2 回目は既存の sessionId を返す

export type AgentSessionCreation =
  | { kind: 'created'; session: AgentSession }
  | { kind: 'failed'; result: Extract<AgentStartResult, { kind: 'error' }> }

/**
 * registry の起動の結果。registry は pty の sessionId しか知らないため、成功は sessionId だけを返す(claude の会話の ID は
 * starter が足して共有の AgentStartResult にする)。エラーは共有の型と同じ
 */
export type AgentRegistryStartResult =
  | { kind: 'started' | 'already-running'; sessionId: string }
  | Extract<AgentStartResult, { kind: 'error' }>

/** registry の snapshot の要素(pty の sessionId だけ。claude の会話の ID は IPC の受け口が starter から足す) */
export interface AgentRegistrySnapshotEntry {
  slotId: string
  sessionId: string
}
// 1 つの枠(タブ)の状態。session・pending・stopping がいずれも無く、世代を控えている者(holders)もいなくなったら消す
// (renderer はタブを作るたびに新しい slotId を使うため、消さないとタブの開け閉め・リロードのたびに増え続ける)。
// 消すと世代は 0 に戻るが、世代を控えている間(IPC の受け口の hold から、registry.start の終わりまで)は消さないので、
// 停止の前に控えた古い世代と、消した後の 0 が一致して取り消しを見逃すことは無い
interface SlotState {
  // この枠の現在のセッション。起動が取り消されずに終わったときに置き、終了(exited)・停止(stopping へ移す)で外す。
  // 終了の直後は外れる前に isAlive() が false のことがあるため、使う側は isAlive() で確かめる。sessionId での書き込み・
  // 停止の宛先の照合(findBySessionId)、already-running の返却、snapshot、上限の数え方(countActive)に使う
  session?: AgentSession
  // 起動中の依頼。どの世代の依頼かを一緒に持つ(stop の後の新しい依頼を、取り消された古い依頼にまとめないため)
  pending?: { generation: string; run: Promise<AgentRegistryStartResult> }
  // 停止を始めたセッション(session から外したもの)の停止の完了。start はこれを待ってから新しく起動する
  stopping?: Promise<void>
  // 停止中のセッションの id → そのセッションの停止の完了。停止を待つ間に同じ sessionId へ 2 回目の stop が来たら
  // (終了の途中の ×・従来の方式への切り替え)、すぐには解決せずこの完了を待つ。ローカルレビュー第 3 周の指摘 2 で追加
  stoppingSessions: Map<string, Promise<void>>
  // 起動の途中でこの枠の stop が来たかを見分ける世代。stop のたびに進める
  generation: number
  // この枠の世代を控えて、起動の直前に比べようとしている者の数(hold・start)。0 より大きい間は空でも消さない
  holders: number
}

/** 消してよい枠(セッション・起動中の依頼・停止中のセッション・世代を控えている者がいずれも無い) */
const isDisposableSlot = (slot: SlotState): boolean =>
  slot.session === undefined &&
  slot.pending === undefined &&
  slot.stopping === undefined &&
  slot.holders === 0

/** 生きているセッションか起動中の依頼(取り消し済みを含む)を持つ(hasAny に数える。上限の数え方は countActive) */
const isActiveSlot = (slot: SlotState): boolean =>
  slot.session?.isAlive() === true || slot.pending !== undefined

interface OwnerState {
  // 所有者全体の停止(stopOwner)のたびに進める世代。枠の世代と合わせて generationOf になる
  generation: number
  slots: Map<string, SlotState>
}

export class AgentSessionRegistry {
  private readonly owners = new Map<number, OwnerState>()
  // アプリの終了を始めた(close)後は新しく起動しない。終了を待つ間の起動は止める手順を通らずに main が終わるため
  private closed = false

  /**
   * 枠の停止の世代(`${所有者の世代}/${枠の世代}`。その枠の stop・所有者全体の stopOwner のたびに変わる)。
   * IPC の受け口は最初の await の前にこれを控え、起動の直前に比べて、その間に届いた停止
   * (リロード・破棄・フォルダの切り替え・その枠の終了)で起動を取り消す。状態が無ければ作らずに 0 として数える
   */
  generationOf(ownerId: number, slotId: string): string {
    const owner = this.owners.get(ownerId)
    return `${owner?.generation ?? 0}/${owner?.slots.get(slotId)?.generation ?? 0}`
  }

  /**
   * 枠のセッションを起動する。生きているセッション・同じ世代の起動中の依頼があれば、新しく起動せず既存の sessionId を返す。
   * 停止中のセッション・取り消された(古い世代の)起動中の依頼があれば、その完了を待ってから新しく起動する。
   * 所有者の生きている・起動中・止めているセッションが上限に達していたら、止めているセッションがあればどれか 1 つが
   * 止まりきるのを待って数え直し、無ければ too-many-sessions を返して create を呼ばない
   */
  async start(
    ownerId: number,
    slotId: string,
    create: () => Promise<AgentSessionCreation>
  ): Promise<AgentRegistryStartResult> {
    // この依頼の世代。待っている間に新しい stop(ウィンドウの破棄・再度のリロード)が来たら(isSuperseded)、起動せずに取り消す。
    // 世代を比べ終わるまで枠を消さない(停止の完了を待つ間に枠が空になって消え、世代が 0 に戻ると比べられなくなる)
    const requested = this.generationOf(ownerId, slotId)
    const release = this.hold(ownerId, slotId)
    try {
      return await this.startHeld(ownerId, slotId, requested, create)
    } finally {
      release()
    }
  }

  private async startHeld(
    ownerId: number,
    slotId: string,
    requested: string,
    create: () => Promise<AgentSessionCreation>
  ): Promise<AgentRegistryStartResult> {
    const isSuperseded = (): boolean => this.generationOf(ownerId, slotId) !== requested
    for (;;) {
      // 終了を始めた後(停止・取り消された起動の完了を待っている間を含む)は起動せずに取り消す
      if (this.closed) return agentStartCanceled()
      const slot = this.owners.get(ownerId)?.slots.get(slotId)
      const existing = slot?.session
      if (existing?.isAlive()) return { kind: 'already-running', sessionId: existing.id }
      const stopping = slot?.stopping
      if (stopping !== undefined) {
        // 止まりかけの古いセッションを already-running で返さない(フォルダの切り替え・リロードの直後)
        await stopping.catch(() => undefined)
        if (isSuperseded()) return agentStartCanceled()
        continue
      }
      const inFlight = slot?.pending
      if (inFlight === undefined) break
      if (inFlight.generation === this.generationOf(ownerId, slotId)) {
        const result = await inFlight.run
        return result.kind === 'started'
          ? { kind: 'already-running', sessionId: result.sessionId }
          : result
      }
      // 取り消された起動の結果(起動の途中で停止されました)は受け取らず、後始末の完了を待って新しく起動する
      await inFlight.run.catch(() => undefined)
      if (isSuperseded()) return agentStartCanceled()
    }
    // ループを抜けてから pending を置くまで await を挟まない(同時に届いた別の枠の依頼が、同じ空きを数えないため)
    const owner = this.ownerOf(ownerId)
    if (this.countActive(ownerId, owner) >= AGENT_MAX_SESSIONS_PER_WINDOW) {
      // 止めているセッションが上限をふさいでいるなら、どれか 1 つが止まりきるのを待って(失敗も待ち終える)数え直す。
      // 止めているセッションが無ければ断る。PR #48 のレビュー指摘(上限を止めている pty も含めた数にする)で追加
      const stoppings = [...owner.slots.values()].flatMap((s) => [...s.stoppingSessions.values()])
      if (stoppings.length === 0) return { kind: 'error', error: 'too-many-sessions' }
      await Promise.race(stoppings.map((stop) => stop.catch(() => undefined)))
      if (isSuperseded()) return agentStartCanceled()
      // 待った後は、終了の始まり・同じ枠の新しいセッション・停止を確かめるところから数え直す
      return this.startHeld(ownerId, slotId, requested, create)
    }
    const slot = this.slotOf(owner, slotId)
    const run = (async (): Promise<AgentRegistryStartResult> => {
      const creation = await create()
      if (creation.kind === 'failed') return creation.result
      const { session } = creation
      // 起動の途中でリロード・破棄・フォルダの切り替え・その枠の終了が来ていたら、所有者のいないセッションを残さない
      if (isSuperseded()) {
        await session.stop('stopped')
        return agentStartCanceled()
      }
      slot.session = session
      void session.exited.then(() => {
        if (slot.session !== session) return
        slot.session = undefined
        this.disposeIfEmpty(owner, slotId, slot)
      })
      return { kind: 'started', sessionId: session.id }
    })()
    const entry = { generation: requested, run }
    slot.pending = entry
    try {
      return await run
    } finally {
      if (slot.pending === entry) slot.pending = undefined
    }
  }

  /** sessionId が所有者のいずれかの枠の現在のセッションと一致するときだけ書き込む(古い画面からの書き込みを捨てる) */
  write(ownerId: number, sessionId: string, data: string): void {
    this.findBySessionId(ownerId, sessionId)?.session?.write(data)
  }

  /**
   * sessionId が所有者のいずれかの枠の現在のセッションと一致するときだけ中断を送る(write と同じ照合)。停止中のセッション
   * (stoppingSessions に移ったもの)・別のウィンドウのセッション・起動し直す前の古い sessionId は一致せず no-session(L-037)。
   * 一致しても、終了した直後(exited の解決の後に枠から外すため、その前)でセッションが not-alive を返したときは no-session に写す
   * (停止は stopSlot が枠から外してから始めるため、停止の途中のセッションは照合で一致しない)
   */
  interrupt(ownerId: number, sessionId: string): AgentInterruptResult {
    const session = this.findBySessionId(ownerId, sessionId)?.session
    if (session === undefined) return { kind: 'no-session' }
    const result = session.interrupt()
    if (result.kind === 'sent') return { kind: 'sent', followUp: result.followUp }
    return result.kind === 'not-alive' ? { kind: 'no-session' } : { kind: 'write-failed' }
  }

  /**
   * 中断の 2 回目。照合は write・interrupt と同じ(所有者の枠の現在のセッションとの一致。停止中・別のウィンドウ・起動し直す前の
   * 古い sessionId は no-session。L-037)。セッションの not-alive は no-session に写し、ほかの結果はそのまま返す
   */
  interruptFollowUp(ownerId: number, sessionId: string): AgentInterruptFollowUpResult {
    const session = this.findBySessionId(ownerId, sessionId)?.session
    if (session === undefined) return { kind: 'no-session' }
    const result = session.interruptFollowUp()
    return { kind: result === 'not-alive' ? 'no-session' : result }
  }

  resize(ownerId: number, sessionId: string, cols: number, rows: number): void {
    this.findBySessionId(ownerId, sessionId)?.session?.resize(cols, rows)
  }

  /**
   * sessionId の枠のセッションだけを止める(ほかの枠は止めない)。その枠の起動中の依頼も無効にする。
   * sessionId が停止中のセッションなら、新しく止めずにその停止の完了を待つ(止まりきる前に止め終えたものとして扱わない)。
   * 一致するセッションが無ければ何もしない
   */
  async stop(ownerId: number, reason: AgentExitReason, sessionId: string): Promise<void> {
    const owner = this.owners.get(ownerId)
    if (owner === undefined) return
    const found = this.findEntryBySessionId(owner, sessionId)
    if (found === undefined) {
      const stopping = this.findStoppingBySessionId(owner, sessionId)
      if (stopping !== undefined) await stopping
      return
    }
    const [slotId, slot] = found
    slot.generation += 1
    await this.stopSlot(owner, slotId, slot, reason)
  }

  /** 所有者のすべての枠のセッションを止め、起動中の依頼も無効にする(フォルダの切り替え・リロード・ウィンドウの破棄) */
  async stopOwner(ownerId: number, reason: AgentExitReason): Promise<void> {
    const owner = this.ownerOf(ownerId)
    owner.generation += 1
    await Promise.all(
      [...owner.slots].map(([slotId, slot]) => this.stopSlot(owner, slotId, slot, reason))
    )
  }

  private async stopSlot(
    owner: OwnerState,
    slotId: string,
    slot: SlotState,
    reason: AgentExitReason
  ): Promise<void> {
    const { session, pending } = slot
    if (session !== undefined) {
      // 停止中として分けて持つ(停止の完了までに届いた start は、この完了を待ってから新しく起動する)
      slot.session = undefined
      const stop = session.stop(reason)
      // 完了(失敗を含む)まで、2 回目の stop が sessionId で待てるように控える
      slot.stoppingSessions.set(session.id, stop)
      const forget = (): void => {
        if (slot.stoppingSessions.get(session.id) === stop) slot.stoppingSessions.delete(session.id)
      }
      void stop.then(forget, forget)
      this.trackStopping(owner, slotId, slot, stop)
    }
    const stopping = slot.stopping
    if (stopping !== undefined) await stopping
    // 起動中の依頼は、完了の時点で世代の違いを見て自分で止まる。その完了まで待つ
    if (pending !== undefined) await pending.run.catch(() => undefined)
  }

  private trackStopping(
    owner: OwnerState,
    slotId: string,
    slot: SlotState,
    stop: Promise<void>
  ): void {
    const previous = slot.stopping
    const all = previous === undefined ? stop : Promise.all([previous, stop]).then(() => undefined)
    slot.stopping = all
    const settle = (): void => {
      if (slot.stopping !== all) return
      slot.stopping = undefined
      this.disposeIfEmpty(owner, slotId, slot)
    }
    void all.then(settle, settle)
  }

  /** 以後の start を取り消しにする(アプリの終了を始めたとき。元には戻さない) */
  close(): void {
    this.closed = true
  }

  /** すべてのセッションを止める(アプリの終了) */
  async stopAll(reason: AgentExitReason): Promise<void> {
    await Promise.all([...this.owners.keys()].map((ownerId) => this.stopOwner(ownerId, reason)))
  }

  /** 生きているセッションを持つ枠を、枠を作った順に返す */
  snapshot(ownerId: number): AgentRegistrySnapshotEntry[] {
    const owner = this.owners.get(ownerId)
    if (owner === undefined) return []
    const entries: AgentRegistrySnapshotEntry[] = []
    for (const [slotId, slot] of owner.slots) {
      if (slot.session?.isAlive()) entries.push({ slotId, sessionId: slot.session.id })
    }
    return entries
  }

  /** 生きているセッション・起動中の依頼・停止中のセッションがあるか */
  hasAny(): boolean {
    for (const owner of this.owners.values()) {
      for (const slot of owner.slots.values()) {
        if (isActiveSlot(slot) || slot.stopping !== undefined) return true
      }
    }
    return false
  }

  /** 所有者の枠の数(テスト用) */
  slotCountOf(ownerId: number): number {
    return this.owners.get(ownerId)?.slots.size ?? 0
  }

  /**
   * 枠の世代を控えて、起動の直前に比べる間は枠を消さない(IPC の受け口が、最初の await の前に generationOf と一緒に呼ぶ)。
   * 返す関数で手放す(2 回目以降は何もしない)。手放したときに枠が空なら消す
   */
  hold(ownerId: number, slotId: string): () => void {
    const owner = this.ownerOf(ownerId)
    const slot = this.slotOf(owner, slotId)
    slot.holders += 1
    let released = false
    return () => {
      if (released) return
      released = true
      slot.holders -= 1
      this.disposeIfEmpty(owner, slotId, slot)
    }
  }

  /** 空になった枠を消す(作り直された同じ slotId の別の枠は消さない) */
  private disposeIfEmpty(owner: OwnerState, slotId: string, slot: SlotState): void {
    if (owner.slots.get(slotId) === slot && isDisposableSlot(slot)) owner.slots.delete(slotId)
  }

  private ownerOf(ownerId: number): OwnerState {
    let owner = this.owners.get(ownerId)
    if (owner === undefined) {
      owner = { generation: 0, slots: new Map() }
      this.owners.set(ownerId, owner)
    }
    return owner
  }

  private slotOf(owner: OwnerState, slotId: string): SlotState {
    let slot = owner.slots.get(slotId)
    if (slot === undefined) {
      slot = { generation: 0, holders: 0, stoppingSessions: new Map() }
      owner.slots.set(slotId, slot)
    }
    return slot
  }

  private findBySessionId(ownerId: number, sessionId: string): SlotState | undefined {
    const owner = this.owners.get(ownerId)
    return owner === undefined ? undefined : this.findEntryBySessionId(owner, sessionId)?.[1]
  }

  private findEntryBySessionId(
    owner: OwnerState,
    sessionId: string
  ): [string, SlotState] | undefined {
    for (const entry of owner.slots) {
      if (entry[1].session?.id === sessionId) return entry
    }
    return undefined
  }

  /** 所有者のいずれかの枠で停止中の、sessionId のセッションの停止の完了 */
  private findStoppingBySessionId(owner: OwnerState, sessionId: string): Promise<void> | undefined {
    for (const slot of owner.slots.values()) {
      const stopping = slot.stoppingSessions.get(sessionId)
      if (stopping !== undefined) return stopping
    }
    return undefined
  }

  /**
   * 上限に数えるセッションの数。生きているセッション、現在の世代の起動中の依頼、止めている(停止を始めて、まだ止まりきって
   * いない)セッションを数える。止めているセッションも pty とプロセスが残っているため数える(数えないと、止める → 別の枠で
   * 起動 を繰り返して、止まりきるまでの数秒に上限を超える数が並ぶ。PR #48 のレビュー指摘で変更)。
   * 取り消し済み(古い世代)の起動中の依頼は数えない。セッションにならない(starter が起動の直前に世代を比べて取り消し、
   * 作られても isSuperseded ですぐ止める)ため、数えなくても上限は破れない。数えると、リロードの直後に
   * ログインシェルの PATH の取得(最大 5 秒)が終わるまで空きをふさぐ。ローカルレビュー第 6 周の指摘 1 で変更
   */
  private countActive(ownerId: number, owner: OwnerState): number {
    let count = 0
    for (const [slotId, slot] of owner.slots) {
      const alive = slot.session?.isAlive() === true
      const current =
        slot.pending !== undefined && slot.pending.generation === this.generationOf(ownerId, slotId)
      if (alive || current) count += 1
      count += slot.stoppingSessions.size
    }
    return count
  }
}
