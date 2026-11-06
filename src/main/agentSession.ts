import { performance } from 'node:perf_hooks'
import type { AgentPermissionOptionNumber } from '@shared/agentPermissionAnswer'
import type { AgentExitReason } from '@shared/types'
import type { AgentCliInterruptSpec } from './agentCliInterruptSpecs'
import { judgeAgentCliInterruptFollowUpTiming } from './agentCliInterruptSpecs'

// 1 つのエージェントのセッション(pty の子の CLI(claude・copilot))。pty の生成は注入する(単体テストは偽物、結合テストは実物の node-pty)

/** CLI の作業の中断(ターミナルで Esc を押すのと同じ)。回数は種類ごとの表(agentCliInterruptSpecs.ts)。renderer の値を混ぜない固定の 1 バイト */
export const AGENT_INTERRUPT_SEQUENCE = '\x1b'

/**
 * 許可の確認の選択肢の番号キー(ターミナルで数字を 1 回押すのと同じ。設計書 2026-11-06「main」)。renderer の値は表を引く鍵にだけ使い、
 * 書くのは表の固定の 1 バイト(L-019)。矢印と Enter は送らない(L-594)
 */
export const AGENT_PERMISSION_ANSWER_KEYS: Record<AgentPermissionOptionNumber, string> = {
  1: '1',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9'
}

export interface PtyDisposable {
  dispose(): void
}

/** node-pty の IPty のうち、このモジュールが使う部分 */
export interface PtyLike {
  readonly pid: number
  onData(listener: (data: string) => void): PtyDisposable
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): PtyDisposable
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

export interface PtySpawnOptions {
  name: string
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
}

export type PtySpawn = (file: string, args: string[], options: PtySpawnOptions) => PtyLike

export interface AgentSessionExitInfo {
  exitCode: number | null
  signal: number | null
  reason: AgentExitReason
}

export interface AgentSessionCallbacks {
  onData(data: string): void
  onExit(exit: AgentSessionExitInfo): void
}

/** 子孫を含めて止める(agentProcessTree.stopProcessTree を pid と終了の Promise で呼ぶ形) */
export type StopTree = (pty: PtyLike, exited: Promise<void>) => Promise<void>

/** 中断の 1 回目の結果。sent の followUp は 2 回目を頼むまでに待つ時間(2 回目の無い種類は null) */
export type AgentSessionInterruptResult =
  | { kind: 'sent'; followUp: { afterMs: number } | null }
  | { kind: 'not-alive' }
  | { kind: 'write-failed' }

/** 中断の 2 回目の結果 */
export type AgentSessionInterruptFollowUpResult =
  | 'sent'
  | 'not-pending'
  | 'expired'
  | 'not-alive'
  | 'write-failed'

/** 許可の確認への答えの結果 */
export type AgentSessionPermissionAnswerResult = 'sent' | 'not-alive' | 'write-failed'

/** 単調増加の時刻(performance.now)。AgentSessionParams.now の本番の値(参照が安定した関数) */
export const monotonicNow = (): number => performance.now()

export interface AgentSessionParams {
  id: string
  pty: PtyLike
  callbacks: AgentSessionCallbacks
  stopTree: StopTree
  /** この起動の CLI の中断の送り方(starter が起動の計画の種類で AGENT_CLI_INTERRUPT_SPECS から引く。L-018)。省略できない(L-060) */
  interruptSpec: AgentCliInterruptSpec
  /** 単調増加の時刻(ms)。本番は monotonicNow、テストは偽の時計 */
  now: () => number
}

export class AgentSession {
  readonly id: string
  /** 子の終了で解決する */
  readonly exited: Promise<void>
  private readonly pty: PtyLike
  private readonly stopTree: StopTree
  private alive = true
  private stopReason: AgentExitReason | null = null
  private stopping: Promise<void> | null = null
  private readonly subscriptions: PtyDisposable[]
  private readonly callbacks: AgentSessionCallbacks
  private readonly markExited: () => void
  private readonly interruptSpec: AgentCliInterruptSpec
  private readonly now: () => number
  /** 1 回目の中断を書いた時刻。2 回目を受け付けている間だけ値を持つ(1 回で使い切る。停止・終了で消す) */
  private followUpSince: number | null = null

  constructor({ id, pty, callbacks, stopTree, interruptSpec, now }: AgentSessionParams) {
    this.id = id
    this.interruptSpec = interruptSpec
    this.now = now
    this.pty = pty
    this.stopTree = stopTree
    this.callbacks = callbacks
    let markExited: () => void = () => undefined
    this.exited = new Promise((resolve) => {
      markExited = resolve
    })
    this.markExited = markExited
    this.subscriptions = [
      pty.onData((data) => {
        if (this.alive) callbacks.onData(data)
      }),
      pty.onExit(({ exitCode, signal }) => {
        this.finish(
          Number.isInteger(exitCode) ? exitCode : null,
          signal === undefined || signal === 0 ? null : signal
        )
      })
    ]
  }

  /**
   * 終了したとみなし、購読を解除して 1 回だけ通知する。通知が例外を投げても exited は必ず解決する
   * (解決しないと stop が settle の上限まで待ち、registry の登録も消えない)
   */
  private finish(exitCode: number | null, signal: number | null): void {
    if (!this.alive) return
    this.alive = false
    this.followUpSince = null
    for (const subscription of this.subscriptions) subscription.dispose()
    try {
      this.callbacks.onExit({ exitCode, signal, reason: this.stopReason ?? 'exited' })
    } finally {
      this.markExited()
    }
  }

  get pid(): number {
    return this.pty.pid
  }

  isAlive(): boolean {
    return this.alive
  }

  /** キー入力・貼り付けを送る。終了した後は何もしない */
  write(data: string): void {
    if (!this.alive) return
    try {
      this.pty.write(data)
    } catch {
      // 終了の直前の書き込みの失敗(EIO など)は、終了の通知で扱う
    }
  }

  /**
   * 作業の中断の 1 回目(Esc を 1 回)を書く。既存の write は打鍵の経路のため書き込みの例外を握って何も返さないが、中断は結果を返す
   * (L-001)。停止の途中(stop の後、終了の前)は止めている pty に送らない。2 回目の要る種類(copilot)なら、書いた時刻を控えて
   * 2 回目の依頼を受け付け、待つ時間を返す(前の控えは上書き)。pty.write は同期で返り、CLI の反応は待たない(L-052)
   */
  interrupt(): AgentSessionInterruptResult {
    if (!this.alive || this.stopping !== null) return { kind: 'not-alive' }
    // 書けなかった 1 回目の後に、前の控えで 2 回目を書かない
    this.followUpSince = null
    if (!this.writeInterruptSequence()) return { kind: 'write-failed' }
    const followUp = this.interruptSpec.followUp
    if (followUp === null) return { kind: 'sent', followUp: null }
    this.followUpSince = this.now()
    return { kind: 'sent', followUp: { afterMs: followUp.afterMs } }
  }

  /**
   * 作業の中断の 2 回目(renderer が画面を確かめ直してから頼む)。控えは 1 回で使い切る(先に読み出して null に戻す)。控えが無い
   * (2 回目の無い種類・使い切った・同じセッションへの 2 回目の依頼)か、1 回目から minIntervalMs 未満(2 回を 1 つの読み取りに詰めて
   * 送らないための守り。renderer が待つ afterMs より小さく、タイマーの早い発火を断らない)なら not-pending、deadlineMs を過ぎたら expired(CLI の 2 回の窓を外れるので書かない)。
   * 経過の判定は表の側の judgeAgentCliInterruptFollowUpTiming。回数・間隔・期限は main の表だけが決める(L-019)
   */
  interruptFollowUp(): AgentSessionInterruptFollowUpResult {
    const since = this.followUpSince
    this.followUpSince = null
    if (!this.alive || this.stopping !== null) return 'not-alive'
    const followUp = this.interruptSpec.followUp
    if (since === null || followUp === null) return 'not-pending'
    const timing = judgeAgentCliInterruptFollowUpTiming(followUp, this.now() - since)
    if (timing === 'too-early') return 'not-pending'
    if (timing === 'expired') return 'expired'
    return this.writeInterruptSequence() ? 'sent' : 'write-failed'
  }

  /** 中断の固定の 1 バイトを書く(1 回目・2 回目で共通)。書けたら true、pty.write の例外は握って false */
  private writeInterruptSequence(): boolean {
    try {
      this.pty.write(AGENT_INTERRUPT_SEQUENCE)
      return true
    } catch {
      return false
    }
  }

  /**
   * 許可の確認に答える(選択肢の番号キーを 1 回)。終了の後・停止の途中(stop の後、終了の前)は書かない。pty.write の例外は握って
   * write-failed(受け口から投げない)。CLI の反応は待たない(pty.write は同期で返る。L-052)。main は画面を読まないので、送る番号が
   * Yes・No の選択肢かは renderer の読み取りで確かめる
   */
  answerPermission(optionNumber: AgentPermissionOptionNumber): AgentSessionPermissionAnswerResult {
    if (!this.alive || this.stopping !== null) return 'not-alive'
    try {
      this.pty.write(AGENT_PERMISSION_ANSWER_KEYS[optionNumber])
      return 'sent'
    } catch {
      return 'write-failed'
    }
  }

  resize(cols: number, rows: number): void {
    if (!this.alive) return
    try {
      this.pty.resize(cols, rows)
    } catch {
      // 終了の直前のリサイズの失敗は無視する
    }
  }

  /** 子孫を含めて止め、終了を待って解決する。二重に呼ばれても 1 回だけ動き、最初の理由を使う */
  stop(reason: AgentExitReason): Promise<void> {
    this.followUpSince = null
    if (this.stopping !== null) return this.stopping
    if (!this.alive) return Promise.resolve()
    this.stopReason = reason
    this.stopping = (async () => {
      try {
        await this.stopTree(this.pty, this.exited)
      } finally {
        // pty の終了の通知が来ないまま停止が解決した(SIGKILL の後の settle の上限を過ぎた)ときも、終了したとみなす。
        // 生きている扱いのまま残すと、以後の start が already-running を返し続ける
        try {
          this.finish(null, null)
        } catch {
          // 通知の失敗は停止を妨げない(exited は finish が解決している)
        }
      }
    })()
    return this.stopping
  }
}

export interface StartAgentSessionParams {
  id: string
  spawn: PtySpawn
  file: string
  args: string[]
  env: Record<string, string>
  cwd: string
  cols: number
  rows: number
  callbacks: AgentSessionCallbacks
  stopTree: StopTree
  /** この起動の CLI の中断の送り方(starter が起動の計画の種類で AGENT_CLI_INTERRUPT_SPECS から引く。L-018)。省略できない(L-060) */
  interruptSpec: AgentCliInterruptSpec
  /** 単調増加の時刻(ms)。本番は monotonicNow、テストは偽の時計 */
  now: () => number
}

/** pty で起動する。spawn の例外はそのまま投げる(呼び出し側が spawn-failed にする) */
export function startAgentSession({
  id,
  spawn,
  file,
  args,
  env,
  cwd,
  cols,
  rows,
  callbacks,
  stopTree,
  interruptSpec,
  now
}: StartAgentSessionParams): AgentSession {
  const pty = spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env })
  return new AgentSession({ id, pty, callbacks, stopTree, interruptSpec, now })
}
