import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_CLONE_STDERR_BYTES, runGitCloneProcess } from '../gitCloneProcess'
import {
  createTestTimers,
  waitForFile,
  waitUntilDead,
  writeFakeExecutable
} from './helpers/processProbe'

// 実際の子プロセス(PATH の先頭に置いた偽の git = sh のスクリプト)で、打ち切り・中止の後に子孫まで止まることを
// 確かめる(モックでは孤児が残るかを確かめられない。パターン 41・84)。プロセスグループは POSIX だけ
const isWindows = process.platform === 'win32'
// 偽のスクリプトの起動の遅れ(負荷時に 1 秒超)と waitForFile の上限(10 秒)を吸収できる、テストの時間切れ
const SLOW_TEST_TIMEOUT_MS = 15_000

let work: string
let binDir: string
// テストの待ち(delay)のタイマー。テストが途中で失敗しても残さない(CLAUDE.md のテスト規約)
const timers = createTestTimers()
const { delay } = timers

// 偽の git を置く。中身は sh のスクリプト(`$1` 以降は git の引数)。warm-up の起動は writeFakeExecutable が行う
function writeFakeGit(body: string): void {
  // 先頭で自分の pid(= プロセスグループの先頭)を記録し、afterEach でグループごと止める(pid の記録前に失敗しても孤児を残さない)
  writeFakeExecutable(join(binDir, 'git'), body, { recordPidTo: join(work, 'git.pids') })
}

// 後始末: テストが失敗しても、偽の git が起動した sleep を残さない
const startedPids: number[] = []
const cleanups: Array<() => void> = []

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'clone-process-')))
  binDir = join(work, 'bin')
  mkdirSync(binDir)
  vi.stubEnv('PATH', `${binDir}:${process.env.PATH ?? ''}`)
})

afterEach(() => {
  timers.clearAll()
  vi.restoreAllMocks()
  for (const fn of cleanups.splice(0)) fn()
  const gitPidsFile = join(work, 'git.pids')
  const gitPids = existsSync(gitPidsFile)
    ? readFileSync(gitPidsFile, 'utf8')
        .split('\n')
        .filter((l) => l !== '')
        .map(Number)
    : []
  for (const pid of [...startedPids.splice(0), ...gitPids]) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, 'SIGKILL')
      } catch {
        // 既に終わっている
      }
    }
  }
  vi.unstubAllEnvs()
  removeTempPathSync(work)
})

describe.skipIf(isWindows)('runGitCloneProcess', () => {
  it('引数・作業ディレクトリ・GIT_TERMINAL_PROMPT=0 で git を起動し、終了コードと標準エラーを返す', async () => {
    writeFakeGit(
      'echo "args=$*" >&2\necho "cwd=$(pwd -P)" >&2\necho "prompt=$GIT_TERMINAL_PROMPT" >&2\nexit 3'
    )
    const result = await runGitCloneProcess({
      args: ['clone', '--progress', '--', 'u', 'd'],
      cwd: work,
      signal: new AbortController().signal,
      idleTimeoutMs: 5000
    })
    expect(result.kind).toBe('exited')
    if (result.kind !== 'exited') return
    expect(result.code).toBe(3)
    expect(result.stderr).toContain('args=clone --progress -- u d')
    expect(result.stderr).toContain(`cwd=${work}`)
    expect(result.stderr).toContain('prompt=0')
  })

  it(
    '出力が途絶えたら子孫ごと止めて timed-out で解決する',
    async () => {
      const pidFile = join(work, 'sleep.pid')
      writeFakeGit(`sleep 30 &\necho $! > '${pidFile}'\nwait`)
      const started = Date.now()
      const result = await runGitCloneProcess({
        args: ['clone'],
        cwd: work,
        signal: new AbortController().signal,
        // 打ち切りのタイマーは spawn の時点から数える。偽の git が pid を書く前に打ち切らないよう 3 秒(macOS は新しい
        // 実行ファイルの初回の起動を検査して遅れ、vitest を同時に走らせる負荷では 1 秒を超えることがある)
        idleTimeoutMs: 3000
      })
      const sleepPid = Number(await waitForFile(pidFile, timers))
      startedPids.push(sleepPid)
      expect(result).toEqual({ kind: 'timed-out' })
      // sleep 30 の終わりを待たずに打ち切る(打ち切り 3 秒 + 止める猶予より十分に短い)
      expect(Date.now() - started).toBeLessThan(10_000)
      // git(偽の sh)が起動した sleep まで止まっている(simple-git の timeout では孤児として残った)
      expect(await waitUntilDead(sleepPid, timers)).toBe(true)
    },
    SLOW_TEST_TIMEOUT_MS
  )

  it(
    '標準エラーへの出力が続く間は打ち切らない',
    async () => {
      // 0.3 秒ごとに 12 回(合計 3.6 秒)。打ち切りの 2.5 秒より長く続くが、間隔は 2.5 秒より短い。打ち切りは spawn の
      // 時点から数えるため、負荷で偽の git の起動が 1 秒以上遅れても最初の出力までに打ち切らない長さにする
      writeFakeGit(
        'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo "Receiving objects: $i" >&2; sleep 0.3; done\nexit 0'
      )
      const result = await runGitCloneProcess({
        args: ['clone'],
        cwd: work,
        signal: new AbortController().signal,
        idleTimeoutMs: 2500
      })
      expect(result).toMatchObject({ kind: 'exited', code: 0 })
    },
    SLOW_TEST_TIMEOUT_MS
  )

  it(
    '標準出力への出力も打ち切りまでの時間を延ばす',
    async () => {
      // 標準エラーの場合と同じく、打ち切りの 2.5 秒より長く(3.6 秒)、間隔は短く出し続ける
      writeFakeGit(
        'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo "line $i"; sleep 0.3; done\nexit 0'
      )
      const result = await runGitCloneProcess({
        args: ['clone'],
        cwd: work,
        signal: new AbortController().signal,
        idleTimeoutMs: 2500
      })
      expect(result).toMatchObject({ kind: 'exited', code: 0 })
    },
    SLOW_TEST_TIMEOUT_MS
  )

  it(
    '中止すると子孫ごと止めて aborted で解決する',
    async () => {
      const pidFile = join(work, 'sleep.pid')
      writeFakeGit(`sleep 30 &\necho $! > '${pidFile}'\nwait`)
      const controller = new AbortController()
      const running = runGitCloneProcess({
        args: ['clone'],
        cwd: work,
        signal: controller.signal,
        idleTimeoutMs: 10_000
      })
      const sleepPid = Number(await waitForFile(pidFile, timers))
      startedPids.push(sleepPid)
      controller.abort()
      expect(await running).toEqual({ kind: 'aborted' })
      expect(await waitUntilDead(sleepPid, timers)).toBe(true)
    },
    SLOW_TEST_TIMEOUT_MS
  )

  it('既に中止されていれば git を起動しない', async () => {
    const marker = join(work, 'started')
    writeFakeGit(`touch '${marker}'`)
    const controller = new AbortController()
    controller.abort()
    const result = await runGitCloneProcess({
      args: ['clone'],
      cwd: work,
      signal: controller.signal,
      idleTimeoutMs: 1000
    })
    expect(result).toEqual({ kind: 'aborted' })
    await delay(200)
    expect(existsSync(marker)).toBe(false)
  })

  it(
    'SIGTERM を無視するプロセスも、猶予の後の SIGKILL で止める',
    async () => {
      const pidFile = join(work, 'self.pid')
      writeFakeGit(`trap '' TERM INT\necho $$ > '${pidFile}'\nexec sleep 30`)
      const controller = new AbortController()
      const running = runGitCloneProcess({
        args: ['clone'],
        cwd: work,
        signal: controller.signal,
        idleTimeoutMs: 10_000,
        killGraceMs: 200
      })
      const shPid = Number(await waitForFile(pidFile, timers))
      startedPids.push(shPid)
      const started = Date.now()
      controller.abort()
      expect(await running).toEqual({ kind: 'aborted' })
      expect(Date.now() - started).toBeGreaterThanOrEqual(150)
      expect(await waitUntilDead(shPid, timers)).toBe(true)
    },
    SLOW_TEST_TIMEOUT_MS
  )

  it('標準エラーは末尾を残す(進捗で上限を超えても、最後の fatal を失わない)', async () => {
    // 1 行 1000 バイトの進捗を 200 行(約 200KB)出してから fatal を出す
    writeFakeGit(
      `i=0\nwhile [ $i -lt 200 ]; do printf '%01000d\\r' 0 >&2; i=$((i+1)); done\necho 'fatal: tail-marker' >&2\nexit 128`
    )
    const result = await runGitCloneProcess({
      args: ['clone'],
      cwd: work,
      signal: new AbortController().signal,
      idleTimeoutMs: 5000
    })
    expect(result.kind).toBe('exited')
    if (result.kind !== 'exited') return
    expect(result.code).toBe(128)
    expect(result.stderr.trimEnd().endsWith('fatal: tail-marker')).toBe(true)
    expect(Buffer.byteLength(result.stderr)).toBeLessThan(200_000)
    expect(Buffer.byteLength(result.stderr)).toBeGreaterThanOrEqual(MAX_CLONE_STDERR_BYTES)
  })

  it('git を起動できなければ spawn-failed で解決する', async () => {
    vi.stubEnv('PATH', join(work, 'empty'))
    const result = await runGitCloneProcess({
      args: ['clone'],
      cwd: work,
      signal: new AbortController().signal,
      idleTimeoutMs: 1000
    })
    expect(result.kind).toBe('spawn-failed')
  })

  // spawn は ENOENT・EACCES など以外の errno(cwd がファイルの ENOTDIR など)を同期で投げる。保存先を作った後に親が
  // ファイルへ差し替わる競合で起きる。reject せず spawn-failed で解決する(呼び出し側が日本語の文言に包めるように)
  it('spawn が同期で投げても(cwd がファイル)、reject せずに spawn-failed で解決する', async () => {
    writeFakeGit('exit 0')
    const fileAsCwd = join(work, 'not-a-dir')
    writeFileSync(fileAsCwd, 'file')
    const result = await runGitCloneProcess({
      args: ['clone'],
      cwd: fileAsCwd,
      signal: new AbortController().signal,
      idleTimeoutMs: 1000
    })
    expect(result.kind).toBe('spawn-failed')
    expect(result.kind === 'spawn-failed' && (result.error as NodeJS.ErrnoException).code).toBe(
      'ENOTDIR'
    )
  })

  describe('process.kill が EPERM を投げても(macOS はゾンビだけのグループへの kill で EPERM を返す)', () => {
    // グループ宛て(負の pid)の kill だけ EPERM を投げ、それ以外(テストの後始末・pid の確認)は本物を呼ぶ
    function spyGroupKillEperm(): { signals: () => string[]; uncaught: Error[] } {
      // リスナー・タイマーから投げられた例外は uncaughtException になる(テストの失敗として数えられるよう拾って検証する)
      const uncaught: Error[] = []
      const onUncaught = (err: Error): void => {
        uncaught.push(err)
      }
      process.on('uncaughtException', onUncaught)
      cleanups.push(() => process.off('uncaughtException', onUncaught))
      const original = process.kill.bind(process)
      const signals: string[] = []
      vi.spyOn(process, 'kill').mockImplementation((pid: number, sig?: string | number) => {
        if (pid < 0) {
          signals.push(String(sig))
          throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
        }
        return original(pid, sig)
      })
      return { signals: () => signals, uncaught }
    }

    it(
      '中止: 例外を出さず aborted で解決する',
      async () => {
        writeFakeGit('exec sleep 1')
        const spy = spyGroupKillEperm()
        const controller = new AbortController()
        const running = runGitCloneProcess({
          args: ['clone'],
          cwd: work,
          signal: controller.signal,
          idleTimeoutMs: 10_000
        })
        await waitForFile(join(work, 'git.pids'), timers)
        controller.abort()
        expect(await running).toEqual({ kind: 'aborted' })
        await delay(50)
        expect(spy.uncaught).toEqual([])
        expect(spy.signals()).toContain('SIGTERM')
      },
      SLOW_TEST_TIMEOUT_MS
    )

    it('無出力の打ち切り: 例外を出さず timed-out で解決する', async () => {
      writeFakeGit('exec sleep 2')
      const spy = spyGroupKillEperm()
      const result = await runGitCloneProcess({
        args: ['clone'],
        cwd: work,
        signal: new AbortController().signal,
        idleTimeoutMs: 1500
      })
      expect(result).toEqual({ kind: 'timed-out' })
      await delay(50)
      expect(spy.uncaught).toEqual([])
      expect(spy.signals()).toContain('SIGTERM')
    })

    it(
      '猶予後の SIGKILL: 例外を出さず解決する',
      async () => {
        writeFakeGit('exec sleep 1')
        const spy = spyGroupKillEperm()
        const controller = new AbortController()
        const running = runGitCloneProcess({
          args: ['clone'],
          cwd: work,
          signal: controller.signal,
          idleTimeoutMs: 10_000,
          killGraceMs: 100
        })
        await waitForFile(join(work, 'git.pids'), timers)
        controller.abort()
        expect(await running).toEqual({ kind: 'aborted' })
        await delay(50)
        expect(spy.uncaught).toEqual([])
        expect(spy.signals()).toEqual(['SIGTERM', 'SIGKILL'])
      },
      SLOW_TEST_TIMEOUT_MS
    )
  })

  it(
    '終了した後は、猶予のタイマーで SIGKILL を送らない(pid の再利用で無関係なプロセスを殺さない)',
    async () => {
      writeFakeGit('exec sleep 30')
      const original = process.kill.bind(process)
      const signals: string[] = []
      vi.spyOn(process, 'kill').mockImplementation((pid: number, sig?: string | number) => {
        if (pid < 0) signals.push(String(sig))
        return original(pid, sig)
      })
      const controller = new AbortController()
      const running = runGitCloneProcess({
        args: ['clone'],
        cwd: work,
        signal: controller.signal,
        idleTimeoutMs: 10_000,
        killGraceMs: 400
      })
      await waitForFile(join(work, 'git.pids'), timers)
      controller.abort()
      expect(await running).toEqual({ kind: 'aborted' })
      await delay(700)
      expect(signals).toEqual(['SIGTERM'])
    },
    SLOW_TEST_TIMEOUT_MS
  )
})
