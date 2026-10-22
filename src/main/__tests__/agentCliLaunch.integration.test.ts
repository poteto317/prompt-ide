import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn as ptySpawn } from 'node-pty'
import { isExecutableRegularFile, resolveAgentLaunch } from '../agentCommand'
import type { AgentLaunchPlan } from '../agentCommand'
import { AGENT_CLI_LAUNCH_SPECS } from '../agentCliLaunchSpecs'
import { monotonicNow, startAgentSession } from '../agentSession'
import { AGENT_CLI_INTERRUPT_SPECS } from '../agentCliInterruptSpecs'
import type { AgentSession, AgentSessionExitInfo, PtySpawn } from '../agentSession'
import { stopProcessTree } from '../agentProcessTree'
import { createTestTimers, waitForFile } from './helpers/processProbe'

// 実物の node-pty と偽の copilot(`#!/usr/bin/env node` のスクリプト)で、選んだ CLI の解決と起動を確かめる(設計書「テスト方針」。
// L-059)。本物の copilot は起動しない。HOME は一時ディレクトリで、利用者の ~/.copilot・~/.gitconfig・~/.claude に書かない。
// process.env は書き換えず、親の環境は resolveAgentLaunch の env に渡す。Windows は対象外。
// テストを動かす node の場所(dirname(process.execPath))には実物の copilot があることがある(nvm)。PATH にはその場所を入れず、
// node へのシンボリックリンクだけを置いた一時ディレクトリを入れ、さらに起動の前に解決された file が偽物であることを確かめる
const spawn: PtySpawn = (file, args, options) => ptySpawn(file, args, options)
const timers = createTestTimers()
// テストが起動したプロセスの印(`pgrep -fl amt-test-` で残りを確かめられる。agentSession.integration.test.ts と同じ形)
const MARKER = `amt-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}-`
let dir: string
let nodeDir: string
const started: AgentSession[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), MARKER))
  // node だけを置いた PATH の場所(shebang の env node をここで解決する。実物の copilot を PATH に入れない)
  nodeDir = join(dir, 'node-only')
  mkdirSync(nodeDir)
  symlinkSync(process.execPath, join(nodeDir, 'node'))
})

afterEach(async () => {
  for (const session of started.splice(0)) await session.stop('stopped')
  timers.clearAll()
  rmSync(dir, { recursive: true, force: true })
})

/** binDir の下に copilot という名の実行ファイルを書く(warm-up はしない。本文を引数なしで 1 回だけ動かすため) */
function writeFakeCopilot(binDir: string, lines: readonly string[]): void {
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, 'copilot'), `${lines.join('\n')}\n`, { mode: 0o755 })
}

/**
 * main と同じ解決で copilot の計画を作る。ログインシェルの PATH の代わりに、偽の copilot の場所と、node だけを置いた場所を返す。
 * 解決された file が偽物でなければ、起動せずに投げる(実物の copilot を起動しない)
 */
async function resolveCopilot(binDir: string): Promise<AgentLaunchPlan> {
  const resolution = await resolveAgentLaunch({
    env: { HOME: dir, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', COPILOT_ALLOW_ALL: 'true' },
    platform: process.platform,
    cliKind: 'copilot',
    readLoginShellPath: async () => `${binDir}:${nodeDir}`,
    isExecutable: isExecutableRegularFile
  })
  if (resolution.kind !== 'ok')
    throw new Error(`copilot が見つかりません: ${JSON.stringify(resolution)}`)
  const fake = join(binDir, 'copilot')
  if (resolution.plan.file !== fake)
    throw new Error(`偽の copilot ではないため起動しません: ${resolution.plan.file}(期待: ${fake})`)
  return resolution.plan
}

/**
 * 計画のとおりに pty で起動し、終了を待つ。引数は starter と同じく、計画の引数の後ろに起動の表の buildArgs(新しく起動する・
 * 会話の ID と hooks の設定のファイルなし)を足す
 */
function runPlan(plan: AgentLaunchPlan, cwd: string): Promise<AgentSessionExitInfo> {
  return new Promise((resolve) => {
    const session = startAgentSession({
      id: 'copilot-it',
      spawn,
      file: plan.file,
      args: [
        ...plan.args,
        ...AGENT_CLI_LAUNCH_SPECS[plan.cliKind].buildArgs({ kind: 'new' }, null, null)
      ],
      env: plan.env,
      cwd,
      cols: 80,
      rows: 24,
      callbacks: { onData: () => undefined, onExit: (exit) => resolve(exit) },
      stopTree: (pty, exited) => stopProcessTree({ pid: pty.pid, exited }),
      interruptSpec: AGENT_CLI_INTERRUPT_SPECS[plan.cliKind],
      now: monotonicNow
    })
    started.push(session)
  })
}

describe.skipIf(process.platform === 'win32')('copilot の起動(実物の pty と偽の copilot)', () => {
  it('引数なし・作業ディレクトリは許可のフォルダ・COPILOT_ALLOW_ALL なしで起動し、shebang の env node は渡した PATH で解決される', async () => {
    const binDir = join(dir, 'bin')
    const work = join(dir, 'work')
    mkdirSync(work)
    const report = join(dir, 'report.json')
    writeFakeCopilot(binDir, [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      `fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), allowAll: process.env.COPILOT_ALLOW_ALL ?? null }))`
    ])
    const plan = await resolveCopilot(binDir)
    expect(plan).toMatchObject({ cliKind: 'copilot', file: join(binDir, 'copilot'), args: [] })
    const exit = await runPlan(plan, work)
    // 報告が書かれた = スクリプトが動いた = env node が pty の PATH(copilot を見つけたのと同じ値)で解決された
    expect(JSON.parse(await waitForFile(report, timers))).toEqual({
      args: [],
      cwd: realpathSync(work),
      allowAll: null
    })
    expect(exit.exitCode).toBe(0)
  }, 20_000)

  // 既定の探索先(/usr/local/bin・/opt/homebrew/bin)に node がある環境でも確かめられるよう、存在しない解釈系の名前にする(設計書「テスト方針」)
  it('shebang の解釈系が pty の PATH で見つからないと、起動の直後に 0 以外で終わる(本文は動かない)', async () => {
    const binDir = join(dir, 'bin-missing')
    const report = join(dir, 'report-missing.json')
    writeFakeCopilot(binDir, [
      '#!/usr/bin/env prompt-ide-missing-node',
      `require('node:fs').writeFileSync(${JSON.stringify(report)}, 'ran')`
    ])
    const plan = await resolveCopilot(binDir)
    const exit = await runPlan(plan, dir)
    expect(exit.exitCode).not.toBe(0)
    expect(existsSync(report)).toBe(false)
  }, 20_000)
})
