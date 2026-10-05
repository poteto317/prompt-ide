import { execFile, spawn } from 'node:child_process'

// エージェントのセッションの子孫のプロセスの停止(設計書「終了・後始末」)。claude は Bash のツールの子を別のセッションで
// 動かすため(確認の結果 9)、プロセスグループへのシグナルだけでは届かない子がいる。停止の前に子孫を控え、グループへ SIGTERM →
// 猶予の後も終わらなければグループへ SIGKILL。最後に、控えた子孫のうち生き残っているものに SIGKILL を送る

/** SIGTERM から SIGKILL へ切り替えるまでの猶予 */
export const AGENT_KILL_GRACE_MS = 3_000
/** SIGKILL の後に終了を待つ上限(pty の onExit が来ない場合でも stop を解決させる) */
export const AGENT_KILL_SETTLE_MS = 1_000
/** ps の打ち切り(返らない ps で停止が永久に解決しないことを防ぐ。打ち切ったら子孫を控えずに停止を続ける) */
export const AGENT_PS_TIMEOUT_MS = 2_000

export interface ProcessEntry {
  pid: number
  ppid: number
}

/** `ps -A -o pid=,ppid=` の出力を解析する。解析できない行は捨てる */
export function parsePsPidPpid(output: string): ProcessEntry[] {
  const entries: ProcessEntry[] = []
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (match === null) continue
    entries.push({ pid: Number(match[1]), ppid: Number(match[2]) })
  }
  return entries
}

/** rootPid の子孫(rootPid 自身は含めない)。幅優先で、親子の循環があっても止まる */
export function collectDescendants(rootPid: number, table: readonly ProcessEntry[]): number[] {
  const children = new Map<number, number[]>()
  for (const { pid, ppid } of table) {
    const list = children.get(ppid) ?? []
    list.push(pid)
    children.set(ppid, list)
  }
  const result: number[] = []
  const seen = new Set<number>([rootPid])
  const queue = [rootPid]
  while (queue.length > 0) {
    const current = queue.shift() as number
    for (const child of children.get(current) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      result.push(child)
      queue.push(child)
    }
  }
  return result
}

/** ps でプロセスの一覧を取る。失敗したら空(子孫を控えられなくても停止は続ける) */
export function listProcesses(): Promise<ProcessEntry[]> {
  return new Promise((resolve) => {
    // GUI から起動した Electron の PATH に依存しないよう絶対パスで起動する(Windows では呼ばれない)
    execFile(
      '/bin/ps',
      ['-A', '-o', 'pid=,ppid='],
      { maxBuffer: 16 * 1024 * 1024, timeout: AGENT_PS_TIMEOUT_MS },
      (err, stdout) => {
        resolve(err ? [] : parsePsPidPpid(String(stdout)))
      }
    )
  })
}

/**
 * シグナルを送ってよい pid か。0(自分のグループ)・1(kill(-1) で同じユーザーの全プロセス)・負数・整数でない値・
 * 自分(Electron の main)と親には送らない。停止はプロセスを殺す唯一の関門なので、誤りの代償が大きい
 */
export function isSignalablePid(pid: number): boolean {
  return Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid && pid !== process.ppid
}

export type KillFn = (pid: number, signal: NodeJS.Signals | 0) => void

/** シグナルを送る。既に終わっている(ESRCH)・ゾンビだけのグループ(EPERM)などの例外はすべて握る(パターン 107) */
export function safeKill(kill: KillFn, pid: number, signal: NodeJS.Signals): void {
  try {
    kill(pid, signal)
  } catch {
    // 止めるべきものは既に止まっている
  }
}

/** プロセスが生きているか(シグナル 0)。回収前のゾンビも生きているとみなす */
export function isProcessAlive(kill: KillFn, pid: number): boolean {
  try {
    kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export interface StopProcessTreeOptions {
  /** pty の子(claude)の pid。新しいセッションのリーダーなので pgid = pid */
  pid: number
  /** 子の終了(pty の onExit)で解決する */
  exited: Promise<void>
  graceMs?: number
  settleMs?: number
  platform?: NodeJS.Platform
  listProcesses?: () => Promise<ProcessEntry[]>
  kill?: KillFn
  /** Windows で pty の kill() を呼ぶ */
  killPty?: () => void
  /** Windows で taskkill /pid <pid> /T /F を起動する */
  spawnTaskkill?: (pid: number) => void
}

/** promise が ms 以内に決着(解決・reject)すれば true、過ぎれば false。どちらでもタイマーを残さない */
function settlesWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    timer.unref()
    const settle = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    // reject も終了とみなす(unhandled rejection にせず、停止を続ける)
    void promise.then(settle, settle)
  })
}

const defaultSpawnTaskkill = (pid: number): void => {
  const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true
  })
  killer.on('error', () => undefined)
}

/**
 * 子孫を含めて止める。子の終了(exited)を待って解決する(最大で猶予 + settleMs)。
 * pid が送ってよい値でなければ(isSignalablePid)、何もせずにすぐ解決する
 */
export async function stopProcessTree({
  pid,
  exited,
  graceMs = AGENT_KILL_GRACE_MS,
  settleMs = AGENT_KILL_SETTLE_MS,
  platform = process.platform,
  listProcesses: list = listProcesses,
  kill = process.kill.bind(process) as KillFn,
  killPty = () => undefined,
  spawnTaskkill = defaultSpawnTaskkill
}: StopProcessTreeOptions): Promise<void> {
  if (!isSignalablePid(pid)) return
  if (platform === 'win32') {
    // Windows はプロセスグループが無い。pty の kill() に任せたうえで、子孫ごと taskkill(実機で未確認)。
    // kill() が例外を投げても taskkill は必ず起動する(子孫を残さない)
    try {
      killPty()
    } catch {
      // taskkill で止める
    }
    spawnTaskkill(pid)
    await settlesWithin(exited, graceMs + settleMs)
    return
  }
  const descendants = collectDescendants(pid, await list())
  safeKill(kill, -pid, 'SIGTERM')
  const exitedInGrace = await settlesWithin(exited, graceMs)
  if (!exitedInGrace) safeKill(kill, -pid, 'SIGKILL')
  // 控えた子孫のうち、別のセッションで生き残っているもの(claude が片付けなかった子・SIGKILL で孤児になった子)を止める
  for (const child of descendants) {
    if (isSignalablePid(child) && isProcessAlive(kill, child)) safeKill(kill, child, 'SIGKILL')
  }
  if (!exitedInGrace) await settlesWithin(exited, settleMs)
}
