import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, symlinkSync, writeFileSync } from 'node:fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn as ptySpawn } from 'node-pty'
import { monotonicNow, startAgentSession } from '../agentSession'
import { AGENT_CLI_INTERRUPT_SPECS } from '../agentCliInterruptSpecs'
import type { AgentCliInterruptSpec } from '../agentCliInterruptSpecs'
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
  removeTempPathSync(dir)
})

function start(
  script: string,
  stopTreeGraceMs = 3000,
  interruptSpec: AgentCliInterruptSpec = AGENT_CLI_INTERRUPT_SPECS.claude
): AgentSession {
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
    stopTree: (pty, exited) => stopProcessTree({ pid: pty.pid, exited, graceMs: stopTreeGraceMs }),
    interruptSpec,
    now: monotonicNow
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

  it('interrupt は固定の 1 バイト(\\x1b)だけを子の標準入力へ届ける(raw モードの子が受け取ったバイトを 16 進で書き出す)', async () => {
    const out = join(dir, 'received-hex')
    const ready = join(dir, 'ready')
    const script = join(dir, 'raw-hex.js')
    writeFileSync(
      script,
      [
        "const fs = require('node:fs')",
        'process.stdin.setRawMode(true)',
        `process.stdin.on('data', (chunk) => fs.appendFileSync(${JSON.stringify(out)}, chunk.toString('hex')))`,
        // raw への切り替えの後に印を書く(raw になった後の入力は tty に溜まり、失われない)
        `fs.writeFileSync(${JSON.stringify(ready)}, 'ready')`
      ].join('\n')
    )
    const session = start(`exec '${process.execPath}' '${script}'`)
    await waitForFile(ready, timers)
    expect(session.interrupt()).toEqual({ kind: 'sent', followUp: null })
    expect(await waitForFile(out, timers)).toBe('1b')
    // 続けて余分なバイト(改行・Ctrl+C など)が届かないことを、少し待ってから確かめる
    await timers.delay(300)
    expect(readFileSync(out, 'utf8')).toBe('1b')
  }, 15_000)

  it('copilot の送り方では、interrupt と 100ms 後の interruptFollowUp で、子に 1b を 2 回、別々の読み取りで届ける(2 回の間は親の側で 80ms 以上空ける)', async () => {
    const out = join(dir, 'received-hex-lines')
    const ready = join(dir, 'ready')
    const script = join(dir, 'raw-hex-lines.js')
    writeFileSync(
      script,
      [
        "const fs = require('node:fs')",
        'process.stdin.setRawMode(true)',
        // 読み取りごとに、受け取ったバイト(16 進)を 1 行に書く。2 つの Esc が 1 回の読み取りに詰められると 1 行(1b1b)になる
        `process.stdin.on('data', (chunk) => fs.appendFileSync(${JSON.stringify(out)}, chunk.toString('hex') + '\\n'))`,
        `fs.writeFileSync(${JSON.stringify(ready)}, 'ready')`
      ].join('\n')
    )
    const session = start(
      `exec '${process.execPath}' '${script}'`,
      3000,
      AGENT_CLI_INTERRUPT_SPECS.copilot
    )
    const readLines = (): string[] =>
      existsSync(out)
        ? readFileSync(out, 'utf8')
            .split('\n')
            .filter((line) => line !== '')
        : []
    const waitForLines = async (count: number): Promise<void> => {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline && readLines().length < count) await timers.delay(5)
    }
    await waitForFile(ready, timers)
    // 2 回の間隔は、子がいつ動くかに左右されない親の側(interrupt と interruptFollowUp を呼ぶ直前の時刻)で測る
    const firstAt = performance.now()
    expect(session.interrupt()).toEqual({ kind: 'sent', followUp: { afterMs: 100 } })
    // 1 回目を子が読み取ったのを見てから 2 回目を頼む。こうすると 2 回の Esc が 1 回の読み取りに入る(['1b1b'])ことは無く、
    // 「1b が合わせて 2 つ届いた」に緩めずに済む(緩めると、main が 1 回目で 2 バイトをまとめて書く誤りを見逃すため、
    // 「別々の読み取りで 1 回ずつ」を確かめる形のまま残す)。ただし限界があり、子の 1 回目の読み取りが期限の 400ms より
    // 遅れると、2 回目は expired で落ちる(下の失敗の文言の経過時間で見分けられる)
    await waitForLines(1)
    expect(readLines(), '子が 1 回目を読み取っていない').toHaveLength(1)
    // renderer と同じく afterMs(100ms)まで待って頼む。Node の setTimeout はループのキャッシュした時刻で数えるため、
    // performance.now() で測った経過が 100ms を少し切ることがあるが、main の受け付けの下限(minIntervalMs: 50)との間に余裕がある
    const waitedMs = performance.now() - firstAt
    if (waitedMs < 100) await timers.delay(100 - waitedMs)
    const followUpAt = performance.now()
    // 落ちたときに、期限(400ms)を過ぎた expired か早すぎた not-pending かを経過時間で見分けられるようにする
    const elapsedMs = followUpAt - firstAt
    expect(
      session.interruptFollowUp(),
      `interrupt の直前から interruptFollowUp の直前まで ${elapsedMs.toFixed(1)}ms`
    ).toBe('sent')
    expect(elapsedMs).toBeGreaterThanOrEqual(80)
    await waitForLines(2)
    // 続けて余分なバイトが届かないことを、少し待ってから確かめる
    await timers.delay(300)
    expect(readLines()).toEqual(['1b', '1b'])
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
