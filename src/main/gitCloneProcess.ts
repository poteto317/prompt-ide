import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

// git clone の子プロセスの実行・打ち切り・中止だけを担う(検証・保存先の作成と削除・文言は gitCloneService)。
// simple-git を使わない理由(実機 git 2.50.1・simple-git 3.36.0 で確認。設計書の確認事項 3):
// - simple-git の abort・timeout プラグインは git 本体に SIGINT を送るだけで、git が起動した git-remote-http・ssh
//   (core.sshCommand の偽の ssh で確認)は孤児として残る。SIGINT を無視するプロセス(git の代わりの sh)では
//   Promise が解決しない(パターン 10・84)
// - `-c protocol.ext.allow=never` を blockUnsafeOperationsPlugin が拒否する(allowUnsafeProtocolOverride が要る)
// そのため spawn を直接使い、POSIX では新しいプロセスグループ(detached。setsid で制御端末も外れる)で起動して、
// 打ち切り・中止ではグループごと SIGTERM → 猶予の後に SIGKILL を送る(cliService の killWithEscalation と同じ考え方)。
// 制御端末を外すのは、端末から起動したアプリ(npm run dev)で ssh の未知のホスト鍵の確認(yes/no)が端末に出て
// 待ち続けるのを防ぐため(detached では `Host key verification failed.` で即座に失敗する。実機で確認)。
// Windows はプロセスグループが無いため taskkill /T /F で子孫ごと止める(実機で未確認。既知の制約)

// 標準エラーの蓄積の上限。--progress の進捗行は巨大なリポジトリで数 MB になりうる。失敗の文言(fatal: …)は末尾に
// 出るため、先頭を捨てて末尾を残す(gitApply.ts の上限と同じ 64KB)
export const MAX_CLONE_STDERR_BYTES = 64 * 1024

// SIGTERM の後、SIGKILL へ切り替えるまでの猶予(cliService.ts・gitApply.ts と同じ 5 秒)
export const CLONE_KILL_GRACE_MS = 5_000

export interface GitCloneProcessOptions {
  /** git に渡す引数(`git` の後ろ全体) */
  args: string[]
  /** 作業ディレクトリ(保存先の親フォルダ) */
  cwd: string
  /** 中止の要求。中止したら子孫ごと止めて { kind: 'aborted' } で解決する */
  signal: AbortSignal
  /** stdout / stderr に何も出ない時間がこれを超えたら、子孫ごと止めて { kind: 'timed-out' } で解決する */
  idleTimeoutMs: number
  /** SIGTERM から SIGKILL までの猶予。テストで実時間を待たないための引数(パターン 84) */
  killGraceMs?: number
}

export interface TailBuffer {
  /** チャンクを末尾に足し、末尾の maxBytes 以上を残して先頭のチャンクを捨てる */
  push(chunk: Buffer): void
  /** 残っているチャンクを連結して UTF-8 で復号する */
  toString(): string
}

// 出力の末尾を残すバッファ。捨てるのはチャンク単位で、末尾の maxBytes 以上を残す(先頭のチャンクを捨てると maxBytes を
// 下回るなら捨てない。最後のチャンクは常に残す)。連結してから復号するため、チャンクの境界で分かれた文字は両方が
// 残っていれば壊れない。捨てたチャンクに文字の前半があれば、残った先頭は置換文字になる(失敗の文言は末尾に出るため許容する)
export function createTailBuffer(maxBytes: number): TailBuffer {
  const chunks: Buffer[] = []
  let totalBytes = 0
  return {
    push(chunk) {
      chunks.push(chunk)
      totalBytes += chunk.length
      while (chunks.length > 1 && totalBytes - chunks[0].length >= maxBytes) {
        totalBytes -= chunks[0].length
        chunks.shift()
      }
    },
    toString() {
      return Buffer.concat(chunks).toString('utf8')
    }
  }
}

export type GitCloneProcessResult =
  | { kind: 'exited'; code: number | null; stderr: string }
  | { kind: 'aborted' }
  | { kind: 'timed-out' }
  | { kind: 'spawn-failed'; error: Error }

// pid のプロセスグループ(POSIX)または子孫(Windows)を止める。既に終わっていれば(ESRCH)何もしない
function killProcessTree(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
    killer.on('error', () => undefined)
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    // ESRCH(既に終わっている)だけでなく、macOS ではグループに未回収のゾンビしか残っていないとき EPERM になる。
    // 呼び出し元はタイマー・AbortSignal のリスナーで、ここで投げると main プロセスの uncaughtException になる。
    // child.kill() と同じく失敗しても投げない(止めるべきものは既に止まっているか、close で解決する)
  }
}

// git clone を実行し、終了・打ち切り・中止・起動失敗のどれかで解決する(reject しない)。解決するのは子プロセスの
// 標準出力・標準エラーが閉じた後(close)。打ち切り・中止ではグループの全員が止まってから解決するため、呼び出し側は
// 解決の後に保存先を安全に削除できる。環境変数は親(main プロセス)を引き継ぎ、GIT_TERMINAL_PROMPT=0 だけを足す
// (git 自身の認証の入力を端末で待たない。GIT_ASKPASS・core.askPass・credential helper などの利用者の設定は
// 上書きしない。パターン 81)
export function runGitCloneProcess({
  args,
  cwd,
  signal,
  idleTimeoutMs,
  killGraceMs = CLONE_KILL_GRACE_MS
}: GitCloneProcessOptions): Promise<GitCloneProcessResult> {
  if (signal.aborted) return Promise.resolve({ kind: 'aborted' })
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn('git', args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (error) {
      // spawn は ENOENT・EACCES・EAGAIN・EMFILE・ENFILE 以外の errno(cwd がファイルの ENOTDIR など)を同期で投げる。
      // executor の中で投げると reject になり「reject しない」契約を破るため、起動失敗として解決する
      resolve({
        kind: 'spawn-failed',
        error: error instanceof Error ? error : new Error(String(error))
      })
      return
    }
    let settled = false
    let closed = false
    let stopReason: 'aborted' | 'timed-out' | null = null
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let escalationTimer: ReturnType<typeof setTimeout> | null = null
    // 末尾の MAX_CLONE_STDERR_BYTES 以上を残して、先頭のチャンクを捨てる
    const stderrTail = createTailBuffer(MAX_CLONE_STDERR_BYTES)

    const clearIdleTimer = (): void => {
      if (idleTimer !== null) clearTimeout(idleTimer)
      idleTimer = null
    }
    const settle = (result: GitCloneProcessResult): void => {
      if (settled) return
      settled = true
      clearIdleTimer()
      signal.removeEventListener('abort', onAbort)
      resolve(result)
    }
    // 止める理由を記録し、グループごと SIGTERM → 猶予の後もまだ閉じていなければ SIGKILL。解決は close を待つ
    const stop = (reason: 'aborted' | 'timed-out'): void => {
      if (stopReason !== null || closed || child.pid === undefined) return
      stopReason = reason
      clearIdleTimer()
      killProcessTree(child.pid, 'SIGTERM')
      const pid = child.pid
      escalationTimer = setTimeout(() => {
        killProcessTree(pid, 'SIGKILL') // close で解除するため、ここへ来るのは未終了のときだけ
      }, killGraceMs)
      // このタイマーだけでアプリの終了を引き延ばさない(パターン 10)
      escalationTimer.unref()
    }
    const resetIdleTimer = (): void => {
      if (stopReason !== null) return
      clearIdleTimer()
      idleTimer = setTimeout(() => stop('timed-out'), idleTimeoutMs)
    }
    function onAbort(): void {
      stop('aborted')
    }

    signal.addEventListener('abort', onAbort)
    resetIdleTimer()
    // stdout は使わないが、読まないとパイプが満杯になって git の書き込みが止まる。出力は無出力の判定にだけ使う
    child.stdout?.on('data', resetIdleTimer)
    child.stderr?.on('data', (chunk: Buffer) => {
      resetIdleTimer()
      stderrTail.push(chunk)
    })
    // git が PATH に無い(ENOENT)など、起動できなかった
    child.on('error', (error) => settle({ kind: 'spawn-failed', error }))
    child.on('close', (code) => {
      closed = true
      // 終了した後に SIGKILL を送らない(pid が再利用されても無関係なプロセスを殺さない)
      if (escalationTimer !== null) clearTimeout(escalationTimer)
      escalationTimer = null
      if (stopReason !== null) {
        settle({ kind: stopReason })
        return
      }
      settle({ kind: 'exited', code, stderr: stderrTail.toString() })
    })
  })
}
