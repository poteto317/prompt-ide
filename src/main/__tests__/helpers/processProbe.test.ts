import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  WARMUP_ARG,
  createTestTimers,
  isAlive,
  waitForFile,
  waitUntilDead,
  writeFakeExecutable
} from './processProbe'

const isWindows = process.platform === 'win32'

// テストの待ちのタイマーと、起動したプロセス・作った作業フォルダは、テストが失敗しても残さない(CLAUDE.md のテスト規約)
const timers = createTestTimers()
const startedPids: number[] = []
const workDirs: string[] = []

function makeWork(): string {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'process-probe-')))
  workDirs.push(work)
  return work
}

afterEach(() => {
  timers.clearAll()
  for (const pid of startedPids.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // 既に終わっている
    }
  }
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('createTestTimers', () => {
  it('delay は指定の時間の後に解決する', async () => {
    const start = Date.now()
    await timers.delay(30)
    expect(Date.now() - start).toBeGreaterThanOrEqual(25)
  })

  it('clearAll は保留中の delay のタイマーを解除する(解決しない)', async () => {
    const own = createTestTimers()
    let resolved = false
    void own.delay(10).then(() => {
      resolved = true
    })
    own.clearAll()
    await timers.delay(60)
    expect(resolved).toBe(false)
  })

  it('clearAll の後も、新しい delay は使える', async () => {
    const own = createTestTimers()
    void own.delay(10)
    own.clearAll()
    await expect(own.delay(10)).resolves.toBeUndefined()
  })
})

describe.skipIf(isWindows)('isAlive', () => {
  it('自分の pid は true', () => {
    expect(isAlive(process.pid)).toBe(true)
  })

  it('終わって回収されたプロセスの pid は false', () => {
    const { pid } = spawnSync('true')
    expect(pid).toBeGreaterThan(0)
    expect(isAlive(pid)).toBe(false)
  })
})

describe.skipIf(isWindows)('waitUntilDead', () => {
  it('すぐ終わるプロセスなら、終わった時点で(上限を待たずに) true', async () => {
    const child = spawn('sleep', ['0.1'], { stdio: 'ignore' })
    startedPids.push(child.pid!)
    const start = Date.now()
    expect(await waitUntilDead(child.pid!, timers, 3000)).toBe(true)
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it('時間内に終わらなければ false(指定の時間で打ち切る)', async () => {
    const child = spawn('sleep', ['30'], { stdio: 'ignore' })
    startedPids.push(child.pid!)
    const start = Date.now()
    expect(await waitUntilDead(child.pid!, timers, 150)).toBe(false)
    expect(Date.now() - start).toBeLessThan(2000)
    expect(isAlive(child.pid!)).toBe(true)
  })
})

describe('waitForFile', () => {
  it('後から書かれたファイルの中身を、前後の空白を除いて返す', async () => {
    const path = join(makeWork(), 'pid')
    void timers.delay(50).then(() => writeFileSync(path, ' 123\n'))
    await expect(waitForFile(path, timers)).resolves.toBe('123')
  })

  it('空のファイルは書かれたとみなさず、中身が書かれるまで待つ', async () => {
    const path = join(makeWork(), 'pid')
    writeFileSync(path, '')
    void timers.delay(50).then(() => writeFileSync(path, '456\n'))
    await expect(waitForFile(path, timers)).resolves.toBe('456')
  })

  it('時間内に書かれなければ、パスを添えて投げる', async () => {
    const path = join(makeWork(), 'never')
    await expect(waitForFile(path, timers, 100)).rejects.toThrow(`${path} が書かれませんでした`)
  })
})

describe.skipIf(isWindows)('writeFakeExecutable', () => {
  it('実行できるスクリプトを書き、warm-up の起動では本文を実行しない', () => {
    const work = makeWork()
    const marker = join(work, 'ran')
    const path = join(work, 'fake')
    writeFakeExecutable(path, `touch '${marker}'`)
    expect(existsSync(marker)).toBe(false)
    execFileSync(path, ['clone'])
    expect(existsSync(marker)).toBe(true)
  })

  it('exitImmediatelyOn の引数で起動されたときは、本文を実行せずに終える', () => {
    const work = makeWork()
    const marker = join(work, 'ran')
    const path = join(work, 'fake-ssh')
    writeFakeExecutable(path, `touch '${marker}'`, { exitImmediatelyOn: ['-G'] })
    execFileSync(path, ['-G', 'host'])
    expect(existsSync(marker)).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(
      `#!/bin/sh\ncase "$1" in -G|${WARMUP_ARG}) exit 0;; esac\ntouch '${marker}'\n`
    )
  })

  it('recordPidTo を渡すと、本文の前に自分の pid を追記する(warm-up では記録しない)', () => {
    const work = makeWork()
    const pids = join(work, 'git.pids')
    const path = join(work, 'git')
    writeFakeExecutable(path, 'exit 0', { recordPidTo: pids })
    expect(existsSync(pids)).toBe(false)
    execFileSync(path, ['clone'])
    execFileSync(path, ['clone'])
    expect(readFileSync(pids, 'utf8').trim().split('\n')).toHaveLength(2)
    expect(readFileSync(path, 'utf8')).toBe(
      `#!/bin/sh\ncase "$1" in ${WARMUP_ARG}) exit 0;; esac\necho $$ >> '${pids}'\nexit 0\n`
    )
  })
})
