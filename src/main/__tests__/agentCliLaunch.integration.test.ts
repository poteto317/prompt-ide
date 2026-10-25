import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
import type { AgentLaunchRequest, AgentSessionExit, AgentStartResult } from '@shared/types'
import { FolderAccessManager } from '../folderAccessManager'
import { AgentSessionRegistry } from '../agentSessionRegistry'
import { createAgentSessionStarter } from '../agentSessionStarter'
import { createAgentSessionRecordStore, toAgentFolderKey } from '../agentSessionRecordStore'
import { createClaudeSessionReservations } from '../claudeSessionReservations'
import { makeFakeRecordIo } from './helpers/fakeAgentSessionRecordIo'
import { makeFakeAgentHookSessions } from './helpers/fakeAgentHookSessions'

// 実物の node-pty と偽の copilot(`#!/usr/bin/env node` のスクリプト)で、選んだ CLI の解決と起動・会話の指定の引数と環境変数の届き方を確かめる(設計書「テスト方針」。
// L-059)。本物の copilot は起動しない。HOME は一時ディレクトリで、利用者の ~/.copilot・~/.gitconfig・~/.claude に書かない。
// process.env は書き換えず、親の環境は resolveAgentLaunch の env に渡す。Windows は対象外。
// テストを動かす node の場所(dirname(process.execPath))には実物の copilot があることがある(nvm)。PATH にはその場所を入れず、
// node へのシンボリックリンクだけを置いた一時ディレクトリを入れ、さらに起動の前に解決された file が偽物であることを確かめる
const spawn: PtySpawn = (file, args, options) => ptySpawn(file, args, options)
const timers = createTestTimers()
// テストが起動したプロセスの印(`pgrep -fl amt-test-` で残りを確かめられる。agentSession.integration.test.ts と同じ形)
const MARKER = `amt-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}-`
const RUN_PLAN_ID = '44444444-4444-4444-8444-444444444444'
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
async function resolveCopilot(
  binDir: string,
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<AgentLaunchPlan> {
  const resolution = await resolveAgentLaunch({
    env: {
      HOME: dir,
      PATH: '/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
      COPILOT_ALLOW_ALL: 'true',
      ...extraEnv
    },
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
 * RUN_PLAN_ID の会話・hooks の設定のファイルなし)を足す
 */
function runPlan(plan: AgentLaunchPlan, cwd: string): Promise<AgentSessionExitInfo> {
  return new Promise((resolve) => {
    const session = startAgentSession({
      id: 'copilot-it',
      spawn,
      file: plan.file,
      args: [
        ...plan.args,
        ...AGENT_CLI_LAUNCH_SPECS[plan.cliKind].buildArgs({ kind: 'new' }, RUN_PLAN_ID, null)
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
  it('新しい起動は --session-id <ID> だけ・作業ディレクトリは許可のフォルダ・COPILOT_ALLOW_ALL なしで起動し、shebang の env node は渡した PATH で解決される', async () => {
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
      args: ['--session-id', RUN_PLAN_ID],
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

describe.skipIf(process.platform === 'win32')(
  'copilot の新しい起動と再開(実物の starter・resolveAgentLaunch・pty と偽の copilot。段階 3a)',
  () => {
    const NEW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    let registry: AgentSessionRegistry

    beforeEach(() => {
      registry = new AgentSessionRegistry()
    })

    afterEach(async () => {
      await registry.stopAll('stopped')
    })

    it('新しい起動は [--session-id, ID]、再開は [--resume=ID](1 つの要素)で届き、COPILOT_DISABLE_RESUME_AUTO_CD=1 が届き、再開できない ID の終了コード 1 が届く', async () => {
      const binDir = join(dir, 'bin-resume')
      const work = join(dir, 'work-resume')
      mkdirSync(work)
      const report = join(dir, 'report-resume.jsonl')
      writeFakeCopilot(binDir, [
        '#!/usr/bin/env node',
        "const fs = require('node:fs')",
        'const args = process.argv.slice(2)',
        `fs.appendFileSync(${JSON.stringify(report)}, JSON.stringify({ args, autoCd: process.env.COPILOT_DISABLE_RESUME_AUTO_CD ?? null }) + '\\n')`,
        // 何も送らずに閉じたセッションの再開(copilot 1.0.87 は終了コード 1。記録の 5f)を模す
        `if (args[0] === '--resume=${NEW_ID}') process.exit(1)`
      ])
      // 利用者の環境の 0 は、起動の表の値(1)で上書きされる
      const plan = await resolveCopilot(binDir, { COPILOT_DISABLE_RESUME_AUTO_CD: '0' })
      const allowedFolder = realpathSync(work)
      const folderAccess = new FolderAccessManager()
      folderAccess.set(1, allowedFolder)
      const claudeRecords = createAgentSessionRecordStore(makeFakeRecordIo())
      const copilotRecords = createAgentSessionRecordStore(makeFakeRecordIo())
      // 終了の後に予約が外れるのを待つため、予約を手元に持つ
      const reservations = createClaudeSessionReservations()
      let sessionCount = 0
      const { start } = createAgentSessionStarter({
        folderAccess,
        registry,
        resolveLaunch: async () => ({ kind: 'ok', plan }),
        spawnPty: spawn,
        stopTree: (pty, exited) => stopProcessTree({ pid: pty.pid, exited }),
        createSessionId: () => `it-${++sessionCount}`,
        records: { claude: claudeRecords, copilot: copilotRecords },
        reservations,
        createClaudeSessionId: () => NEW_ID,
        hooks: makeFakeAgentHookSessions()
      })
      /** 起動して、そのセッションの終了を待つ(起動に失敗したら終了を待たずに投げる) */
      const startAndWaitForExit = async (
        slotId: string,
        launch: AgentLaunchRequest
      ): Promise<{ result: AgentStartResult; exit: AgentSessionExit }> => {
        let resolveExit: (exit: AgentSessionExit) => void = () => undefined
        const exited = new Promise<AgentSessionExit>((resolve) => {
          resolveExit = resolve
        })
        const result = await start(
          1,
          { slotId, folderPath: work, cols: 80, rows: 24, launch },
          { isGone: () => false, onData: () => undefined, onExit: (exit) => resolveExit(exit) }
        )
        if (result.kind === 'error')
          throw new Error(`起動できませんでした: ${JSON.stringify(result)}`)
        return { result, exit: await exited }
      }

      const first = await startAndWaitForExit('slot-1', { kind: 'new' })
      expect(first.result).toEqual({
        kind: 'started',
        sessionId: 'it-1',
        cliKind: 'copilot',
        claudeSessionId: NEW_ID
      })
      expect(first.exit).toMatchObject({ exitCode: 0, reason: 'exited' })
      const folderKey = toAgentFolderKey(allowedFolder, process.platform)
      expect(copilotRecords.last(folderKey)).toBe(NEW_ID)
      expect(claudeRecords.last(folderKey)).toBeNull()
      // 予約は starter が exited の解決の後に外す(sink の終了の知らせより後になりうる)ので、外れるまで待ってから再開する
      await vi.waitFor(() => expect(reservations.has(NEW_ID)).toBe(false))

      const second = await startAndWaitForExit('slot-2', {
        kind: 'resume',
        claudeSessionId: NEW_ID,
        cliKind: 'copilot'
      })
      expect(second.result).toMatchObject({
        kind: 'started',
        cliKind: 'copilot',
        claudeSessionId: NEW_ID
      })
      expect(second.exit).toMatchObject({ exitCode: 1, reason: 'exited' })

      const lines = readFileSync(report, 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as unknown)
      expect(lines).toEqual([
        { args: ['--session-id', NEW_ID], autoCd: '1' },
        { args: [`--resume=${NEW_ID}`], autoCd: '1' }
      ])
    }, 30_000)
  }
)
