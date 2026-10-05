import type { AgentExitReason } from '@shared/types'

// 1 つのエージェントのセッション(pty の子の claude)。pty の生成は注入する(単体テストは偽物、結合テストは実物の node-pty)

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

export interface AgentSessionParams {
  id: string
  pty: PtyLike
  callbacks: AgentSessionCallbacks
  stopTree: StopTree
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

  constructor({ id, pty, callbacks, stopTree }: AgentSessionParams) {
    this.id = id
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
  stopTree
}: StartAgentSessionParams): AgentSession {
  const pty = spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env })
  return new AgentSession({ id, pty, callbacks, stopTree })
}
