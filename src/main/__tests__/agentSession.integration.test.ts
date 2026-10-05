import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn as ptySpawn } from 'node-pty'
import { startAgentSession } from '../agentSession'
import type { AgentSession, PtySpawn } from '../agentSession'
import { isSignalablePid, stopProcessTree } from '../agentProcessTree'
import { buildAgentPasteBytes, AGENT_CLEAR_INPUT_CHUNK } from '@shared/agentPasteText'
import {
  createTestTimers,
  isAlive,
  waitForFile,
  waitUntilDead,
  writeFakeExecutable
} from './helpers/processProbe'

// 実物の node-pty と偽のエージェント(sh のスクリプト)で、起動・書き込み・子孫の停止を確かめる。
// macOS・Linux の開発者のローカルで走らせる(Windows は対象外。パターン 41・46)
const spawn: PtySpawn = (file, args, options) => ptySpawn(file, args, options)
const timers = createTestTimers()
// テストが起動したプロセスの印。作業ディレクトリ・偽のエージェント・sleep(dir の中のシンボリックリンク)のパスに入り、
// `pgrep -fl amt-test-` で残りを確かめられる
const MARKER = `amt-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}-`
let dir: string
const started: AgentSession[] = []
const recordedPids: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), MARKER))
  symlinkSync('/bin/sleep', join(dir, 'sleep'))
})

afterEach(async () => {
  for (const session of started.splice(0)) await session.stop('stopped')
  // 失敗したテストが残した偽のエージェントの子孫を止める
  for (const file of recordedPids.splice(0)) {
    if (!existsSync(file)) continue
    for (const pid of readFileSync(file, 'utf8')
      .split('\n')
      .map(Number)
      // 自分のテストが記録した、送ってよい pid だけ(0・-1・自分・親には送らない)
      .filter(isSignalablePid)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // 既に止まっている
      }
    }
  }
  timers.clearAll()
  rmSync(dir, { recursive: true, force: true })
})

function start(script: string, stopTreeGraceMs = 3000): AgentSession {
  const file = join(dir, 'fake-agent')
  writeFakeExecutable(file, script)
  const session = startAgentSession({
    id: 'it',
    spawn,
    file,
    args: [],
    env: { PATH: '/usr/bin:/bin', HOME: dir, LANG: 'en_US.UTF-8' },
    cwd: dir,
    cols: 80,
    rows: 24,
    callbacks: { onData: () => undefined, onExit: () => undefined },
    stopTree: (pty, exited) => stopProcessTree({ pid: pty.pid, exited, graceMs: stopTreeGraceMs })
  })
  started.push(session)
  return session
}

describe.skipIf(process.platform === 'win32')('AgentSession(実物の pty)', () => {
  it('作業ディレクトリで起動し、貼り付けのバイト列と Enter がそのまま届く', async () => {
    const out = join(dir, 'received')
    const session = start(
      `stty raw -echo\nprintf '\\033[?2004h'\npwd > '${dir}/pwd'\nexec cat > '${out}'`
    )
    // 印(pwd)は raw への切り替えの後に書かれる。raw になった後の入力は tty に溜まり、cat の起動が遅れても失われない
    await waitForFile(join(dir, 'pwd'), timers)
    session.write(AGENT_CLEAR_INPUT_CHUNK)
    session.write(buildAgentPasteBytes('line1\nline2') + '\r')
    const expected = AGENT_CLEAR_INPUT_CHUNK + '\x1b[200~line1\nline2\x1b[201~\r'
    const deadline = Date.now() + 5000
    while (
      Date.now() < deadline &&
      (!existsSync(out) || readFileSync(out, 'latin1') !== expected)
    ) {
      await timers.delay(20)
    }
    expect(readFileSync(out, 'latin1')).toBe(expected)
    expect(readFileSync(join(dir, 'pwd'), 'utf8').trim()).toContain(MARKER)
  }, 15_000)

  it('別のセッションへ抜けた孫(setsid)も、停止の後に残らない', async () => {
    const pids = join(dir, 'pids')
    recordedPids.push(pids)
    const session = start(
      `echo $$ >> '${pids}'\nperl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' '${dir}/sleep' 60 &\necho $! >> '${pids}'\necho ready > '${dir}/ready'\nwait`
    )
    await waitForFile(join(dir, 'ready'), timers)
    const [agentPid, grandchildPid] = readFileSync(pids, 'utf8').trim().split('\n').map(Number)
    expect(isAlive(grandchildPid)).toBe(true)
    await session.stop('stopped')
    expect(await waitUntilDead(agentPid, timers)).toBe(true)
    expect(await waitUntilDead(grandchildPid, timers)).toBe(true)
  }, 15_000)

  it('SIGTERM を無視するエージェントと子も、猶予の後に止まる', async () => {
    const pids = join(dir, 'pids')
    recordedPids.push(pids)
    const session = start(
      `trap '' TERM\necho $$ >> '${pids}'\n'${dir}/sleep' 60 &\necho $! >> '${pids}'\necho ready > '${dir}/ready'\nwait`,
      300
    )
    await waitForFile(join(dir, 'ready'), timers)
    const [agentPid, childPid] = readFileSync(pids, 'utf8').trim().split('\n').map(Number)
    await session.stop('stopped')
    expect(await waitUntilDead(agentPid, timers)).toBe(true)
    expect(await waitUntilDead(childPid, timers)).toBe(true)
    expect(session.isAlive()).toBe(false)
  }, 15_000)
})
