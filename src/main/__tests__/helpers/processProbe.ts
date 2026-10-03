import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// 実際の子プロセス(偽の git・偽の ssh = sh のスクリプト)を使うテストの補助。打ち切り・中止の後に子孫まで止まったかを
// 確かめるため、プロセスの生死・pid の書かれたファイルを待つ(モックでは孤児が残るかを確かめられない。パターン 41・84)。
// realGitRepo.ts の killRecordedProcess と同じ関心(テストが起動したプロセスの確認と後始末)

export interface TestTimers {
  /** ms の後に解決する。タイマーは clearAll で解除できる */
  delay(ms: number): Promise<void>
  /** 保留中の delay のタイマーを全て解除する(afterEach で呼ぶ。解除した delay は解決しない) */
  clearAll(): void
}

// テストの待ち(delay)のタイマー。テストが途中で失敗しても残さないよう、ID を控えて afterEach で解除する
// (CLAUDE.md のテスト規約)
export function createTestTimers(): TestTimers {
  const pending = new Set<ReturnType<typeof setTimeout>>()
  return {
    delay(ms) {
      return new Promise((resolve) => {
        const id = setTimeout(() => {
          pending.delete(id)
          resolve()
        }, ms)
        pending.add(id)
      })
    },
    clearAll() {
      for (const id of pending) clearTimeout(id)
      pending.clear()
    }
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// 止めたプロセスが消えるまで待つ(親が先に止まると launchd・init が回収するまで一瞬ゾンビとして残る)
export async function waitUntilDead(
  pid: number,
  timers: Pick<TestTimers, 'delay'>,
  timeoutMs = 3000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await timers.delay(20)
  }
  return !isAlive(pid)
}

// 中身が書かれるまで待ち、前後の空白を除いて返す(空のファイルは書かれていないとみなす)。上限は打ち切りの時間
// (最長 3 秒)と止める猶予より十分に長くする。負荷がかかると(vitest の同時実行など)、macOS が新しく作った
// 偽のスクリプトの初回の起動を検査して、動き出すまでに 1 秒を超えることがある
export async function waitForFile(
  path: string,
  timers: Pick<TestTimers, 'delay'>,
  timeoutMs = 10_000
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf8').trim()
      if (content !== '') return content
    }
    await timers.delay(20)
  }
  throw new Error(`${path} が書かれませんでした`)
}

// 偽のスクリプトの warm-up の起動に渡す引数(この引数で起動されたら本文を実行せずに終える)
export const WARMUP_ARG = '--test-warmup'

export interface FakeExecutableOptions {
  /** 第 1 引数がこれらのとき、本文を実行せずに終える(偽の ssh: git が種類を調べるために `-G` 付きで起動する) */
  exitImmediatelyOn?: string[]
  /** 本文の前に自分の pid(= プロセスグループの先頭)をこのファイルへ追記する(afterEach でグループごと止めるため) */
  recordPidTo?: string
}

// 偽の実行ファイル(sh のスクリプト)を書き、作った直後に一度だけ warm-up で起動しておく(本文も pid の記録も実行
// しない)。macOS は新しく作った実行ファイルの初回の起動を検査し、負荷がかかると(vitest の同時実行など)数秒かかる
// ことがある。打ち切りのタイマーは spawn の時点から数えるため、検査をテストの計測の外へ出す
export function writeFakeExecutable(
  path: string,
  body: string,
  { exitImmediatelyOn = [], recordPidTo }: FakeExecutableOptions = {}
): void {
  const exitArgs = [...exitImmediatelyOn, WARMUP_ARG].join('|')
  const recordPid = recordPidTo === undefined ? '' : `echo $$ >> '${recordPidTo}'\n`
  writeFileSync(path, `#!/bin/sh\ncase "$1" in ${exitArgs}) exit 0;; esac\n${recordPid}${body}\n`, {
    mode: 0o755
  })
  execFileSync(path, [WARMUP_ARG])
}
