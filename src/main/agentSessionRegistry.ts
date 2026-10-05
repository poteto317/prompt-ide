import type { AgentExitReason, AgentSessionSnapshot, AgentStartResult } from '@shared/types'
import { agentStartCanceled } from '@shared/types'
import type { AgentSession } from './agentSession'

// webContents の id → エージェントのセッション(1 ウィンドウに 1 つ)。Electron に依存しない。
// 起動の依頼の重複(StrictMode の 2 回目など。確認の結果 10)は 1 つにまとめ、2 回目は既存の sessionId を返す

export type AgentSessionCreation =
  | { kind: 'created'; session: AgentSession }
  | { kind: 'failed'; result: Extract<AgentStartResult, { kind: 'error' }> }

export class AgentSessionRegistry {
  private readonly sessions = new Map<number, AgentSession>()
  // 起動中の依頼。どの世代の依頼かを一緒に持つ(stop の後の新しい依頼を、取り消された古い依頼にまとめないため)
  private readonly pending = new Map<
    number,
    { generation: number; run: Promise<AgentStartResult> }
  >()
  // 停止を始めたセッション(sessions から外したもの)の停止の完了。start はこれを待ってから新しく起動する
  private readonly stopping = new Map<number, Promise<void>>()
  // 起動の途中で stop が来たかを見分ける世代。stop のたびに進める
  private readonly generations = new Map<number, number>()
  // アプリの終了を始めた(close)後は新しく起動しない。終了を待つ間の起動は止める手順を通らずに main が終わるため
  private closed = false

  /**
   * 所有者の停止の世代(stop のたびに進む)。IPC の受け口は最初の await の前にこれを控え、起動の直前に比べて、
   * その間に届いた停止(リロード・破棄・フォルダの切り替え)で起動を取り消す
   */
  generationOf(ownerId: number): number {
    return this.generations.get(ownerId) ?? 0
  }

  /**
   * 起動する。生きているセッション・同じ世代の起動中の依頼があれば、新しく起動せず既存の sessionId を返す。
   * 停止中のセッション・取り消された(古い世代の)起動中の依頼があれば、その完了を待ってから新しく起動する
   */
  async start(
    ownerId: number,
    create: () => Promise<AgentSessionCreation>
  ): Promise<AgentStartResult> {
    // この依頼の世代。待っている間に新しい stop(ウィンドウの破棄・再度のリロード)が来たら、起動せずに取り消す
    const requested = this.generationOf(ownerId)
    for (;;) {
      // 終了を始めた後(停止・取り消された起動の完了を待っている間を含む)は起動せずに取り消す
      if (this.closed) return agentStartCanceled()
      const existing = this.sessions.get(ownerId)
      if (existing?.isAlive()) return { kind: 'already-running', sessionId: existing.id }
      const stopping = this.stopping.get(ownerId)
      if (stopping !== undefined) {
        // 止まりかけの古いセッションを already-running で返さない(フォルダの切り替え・リロードの直後)
        await stopping.catch(() => undefined)
        if (this.generationOf(ownerId) !== requested) return agentStartCanceled()
        continue
      }
      const inFlight = this.pending.get(ownerId)
      if (inFlight === undefined) break
      if (inFlight.generation === this.generationOf(ownerId)) {
        const result = await inFlight.run
        return result.kind === 'started'
          ? { kind: 'already-running', sessionId: result.sessionId }
          : result
      }
      // 取り消された起動の結果(起動の途中で停止されました)は受け取らず、後始末の完了を待って新しく起動する
      await inFlight.run.catch(() => undefined)
      if (this.generationOf(ownerId) !== requested) return agentStartCanceled()
    }
    const generation = requested
    const run = (async (): Promise<AgentStartResult> => {
      const creation = await create()
      if (creation.kind === 'failed') return creation.result
      const { session } = creation
      // 起動の途中でリロード・破棄・フォルダの切り替えが来ていたら、所有者のいないセッションを残さない
      if (generation !== this.generationOf(ownerId)) {
        await session.stop('stopped')
        return agentStartCanceled()
      }
      this.sessions.set(ownerId, session)
      void session.exited.then(() => {
        if (this.sessions.get(ownerId) === session) this.sessions.delete(ownerId)
      })
      return { kind: 'started', sessionId: session.id }
    })()
    const entry = { generation, run }
    this.pending.set(ownerId, entry)
    try {
      return await run
    } finally {
      if (this.pending.get(ownerId) === entry) this.pending.delete(ownerId)
    }
  }

  /** sessionId が所有者の現在のセッションと一致するときだけ書き込む(古い画面からの書き込みを捨てる) */
  write(ownerId: number, sessionId: string, data: string): void {
    const session = this.sessions.get(ownerId)
    if (session?.id === sessionId) session.write(data)
  }

  resize(ownerId: number, sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(ownerId)
    if (session?.id === sessionId) session.resize(cols, rows)
  }

  /** 所有者のセッションを止める(sessionId を渡したら一致するときだけ)。起動中の依頼も無効にする */
  async stop(ownerId: number, reason: AgentExitReason, sessionId?: string): Promise<void> {
    const session = this.sessions.get(ownerId)
    if (sessionId !== undefined && session?.id !== sessionId) return
    this.generations.set(ownerId, this.generationOf(ownerId) + 1)
    const pending = this.pending.get(ownerId)
    if (session !== undefined) {
      // 停止中として分けて持つ(停止の完了までに届いた start は、この完了を待ってから新しく起動する)
      this.sessions.delete(ownerId)
      this.trackStopping(ownerId, session.stop(reason))
    }
    const stopping = this.stopping.get(ownerId)
    if (stopping !== undefined) await stopping
    // 起動中の依頼は、完了の時点で世代の違いを見て自分で止まる。その完了まで待つ
    if (pending !== undefined) await pending.run.catch(() => undefined)
  }

  private trackStopping(ownerId: number, stop: Promise<void>): void {
    const previous = this.stopping.get(ownerId)
    const all = previous === undefined ? stop : Promise.all([previous, stop]).then(() => undefined)
    this.stopping.set(ownerId, all)
    const settle = (): void => {
      if (this.stopping.get(ownerId) === all) this.stopping.delete(ownerId)
    }
    void all.then(settle, settle)
  }

  /** 以後の start を取り消しにする(アプリの終了を始めたとき。元には戻さない) */
  close(): void {
    this.closed = true
  }

  /** すべてのセッションを止める(アプリの終了) */
  async stopAll(reason: AgentExitReason): Promise<void> {
    const owners = new Set([
      ...this.sessions.keys(),
      ...this.pending.keys(),
      ...this.stopping.keys()
    ])
    await Promise.all([...owners].map((ownerId) => this.stop(ownerId, reason)))
  }

  snapshot(ownerId: number): AgentSessionSnapshot {
    const session = this.sessions.get(ownerId)
    return session?.isAlive() ? { sessionId: session.id } : null
  }

  /** 生きているセッション・起動中の依頼・停止中のセッションがあるか */
  hasAny(): boolean {
    return (
      [...this.sessions.values()].some((session) => session.isAlive()) ||
      this.pending.size > 0 ||
      this.stopping.size > 0
    )
  }
}
