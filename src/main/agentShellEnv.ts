import { spawn as nodeSpawn } from 'node:child_process'
import type { ChildProcess, SpawnOptions } from 'node:child_process'

// ログインシェルから PATH を取り出す(設計書「PATH の継承」C)。GUI から起動したアプリの PATH は launchd の最小のもので、
// ~/.local/bin や nvm の配下を含まない。zsh では -l だけでは ~/.zshrc が読まれないため -i も付ける(確認の結果 3)。
// 端末なし(標準入力は ignore)・新しいプロセスグループで起動し、打ち切りではグループごと止める(パターン 84・107)

export const LOGIN_SHELL_PATH_TIMEOUT_MS = 5_000
export const PATH_MARKER_START = '__PROMPT_IDE_PATH_START__'
export const PATH_MARKER_END = '__PROMPT_IDE_PATH_END__'
// 標準出力を溜める上限(シェルの初期化が大量に出力しても main のメモリを使い切らない)
const MAX_OUTPUT_LENGTH = 1_000_000

export type ShellSpawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess

/** 起動するシェル。SHELL、無ければ利用者の既定のシェル、それも無ければ /bin/sh */
export function resolveLoginShell(
  env: NodeJS.ProcessEnv,
  userShell: string | null | undefined
): string {
  if (env.SHELL) return env.SHELL
  if (userShell) return userShell
  return '/bin/sh'
}

/** 出力の中の印の間を取り出す。印が無い・中身が空(空白だけ)なら null */
export function extractMarkedPath(output: string): string | null {
  const start = output.indexOf(PATH_MARKER_START)
  if (start < 0) return null
  const from = start + PATH_MARKER_START.length
  const end = output.indexOf(PATH_MARKER_END, from)
  if (end < 0) return null
  const value = output.slice(from, end).trim()
  return value === '' ? null : value
}

export interface ReadLoginShellPathOptions {
  spawn?: ShellSpawn
  env?: NodeJS.ProcessEnv
  userShell?: string | null
  timeoutMs?: number
  platform?: NodeJS.Platform
  /** プロセスグループへのシグナル(テストで差し替える) */
  kill?: (pid: number, signal: NodeJS.Signals) => void
}

/** ログインシェルの PATH。取得できなければ null(Windows では常に null) */
export function readLoginShellPath({
  spawn = nodeSpawn,
  env = process.env,
  userShell = null,
  timeoutMs = LOGIN_SHELL_PATH_TIMEOUT_MS,
  platform = process.platform,
  kill = process.kill.bind(process)
}: ReadLoginShellPathOptions = {}): Promise<string | null> {
  if (platform === 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    let output = ''
    let child: ChildProcess
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    // グループごと止める。既に終わっている・ゾンビだけのとき(ESRCH・EPERM)の例外は握る(パターン 107)
    const killGroup = (): void => {
      if (child?.pid === undefined) return
      try {
        kill(-child.pid, 'SIGKILL')
      } catch {
        // 止めるべきものは既に止まっている
      }
    }
    const timer = setTimeout(() => {
      killGroup()
      finish(null)
    }, timeoutMs)
    timer.unref()
    try {
      child = spawn(
        resolveLoginShell(env, userShell),
        ['-l', '-i', '-c', `printf "%s%s%s" "${PATH_MARKER_START}" "$PATH" "${PATH_MARKER_END}"`],
        { stdio: ['ignore', 'pipe', 'ignore'], detached: true, env }
      )
    } catch {
      finish(null)
      return
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (output.length < MAX_OUTPUT_LENGTH) output += chunk
      // 終わりの印が出たら close を待たずに確定する。rc がバックグラウンドプロセスを残すと stdout が閉じず、
      // close が来ないため。残った子孫はグループごと止める
      const marked = extractMarkedPath(output)
      if (marked !== null) {
        killGroup()
        finish(marked)
      }
    })
    child.on('error', () => finish(null))
    child.on('close', () => finish(extractMarkedPath(output)))
  })
}
