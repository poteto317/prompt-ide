import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createAgentToolActivity } from '../agentToolActivity'
import type { AgentToolActivity } from '../agentToolActivity'
import { createAgentHookReceiver } from '../agentHookReceiver'
import type { AgentHookReceiver } from '../agentHookReceiver'
import {
  createAgentHookSettingsDir,
  removeAgentHookSettingsFile,
  writeAgentHookSettingsFile
} from '../agentHookSettings'
import type { AgentHookSettingsDir, AgentHookSettingsJson } from '../agentHookSettings'
import { createAgentHookSessions } from '../agentHookSessions'
import type { AgentHookSessions } from '../agentHookSessions'
import {
  COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME,
  createCopilotHookPluginSlots
} from '../agentCopilotHookPlugin'
import type { CopilotHookConfigJson } from '../agentCopilotHookConfig'
import type { CopilotHookPluginSlots } from '../agentCopilotHookPlugin'
import type { CopilotHookEventName } from '../agentHookProtocol'
import { sendHookRequest } from './helpers/agentHookHttp'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import type { HookResponse } from './helpers/agentHookHttp'

// 受け口・追跡・agentHookSessions を実物で組み立て、claude・copilot が送る形の要求を送る(claude・copilot は起動しない)。
// URL とトークンは prepare が書いた設定のファイル(claude)・hooks.json(copilot)から読む(設定の URL と受け口のパスが食い違わないことも
// 確かめる)

let tracker: AgentToolActivity
let receiver: AgentHookReceiver
let settingsDir: AgentHookSettingsDir
let sessions: AgentHookSessions
let userDataDir: string | null = null
let copilotPlugins: CopilotHookPluginSlots
let trackerWarn: ReturnType<typeof vi.fn<(message: string) => void>>

beforeEach(() => {
  trackerWarn = vi.fn<(message: string) => void>()
  tracker = createAgentToolActivity({ onPhaseChange: vi.fn(), devLog: null, warn: trackerWarn })
  receiver = createAgentHookReceiver({
    deliver: (ownerId, sessionId, event) => tracker.deliver(ownerId, sessionId, event),
    onToolStart: async () => undefined,
    onToolStartTimedOut: () => undefined,
    log: vi.fn()
  })
  settingsDir = createAgentHookSettingsDir()
  const dataDir = mkdtempSync(join(tmpdir(), 'prompt-ide-hooks-it-'))
  userDataDir = dataDir
  copilotPlugins = createCopilotHookPluginSlots({
    rootDir: join(dataDir, COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME)
  })
  sessions = createAgentHookSessions({
    receiver,
    settingsDir,
    tracker,
    versions: { readClaudeVersion: async () => ({ kind: 'supported', version: '2.1.291' }) },
    writeSettingsFile: writeAgentHookSettingsFile,
    removeSettingsFile: removeAgentHookSettingsFile,
    copilotPlugins,
    log: vi.fn()
  })
})

afterEach(() => {
  receiver.close()
  tracker.close()
  settingsDir.removeSync()
  copilotPlugins.removeTokenFilesSync()
  // mkdtempSync で作った一時ディレクトリだけを、一時ディレクトリの中であることを確かめてから消す(作る前に失敗したら何もしない)
  if (userDataDir !== null) removeTempPathSync(userDataDir)
  userDataDir = null
})

/** 設定のファイルのイベントの URL へ、claude と同じ形(Bearer・application/json)で POST する */
function poster(
  settings: AgentHookSettingsJson
): (event: keyof AgentHookSettingsJson['hooks'], body: unknown) => Promise<HookResponse> {
  return (event, body) => {
    const hook = settings.hooks[event][0].hooks[0]
    const url = new URL(hook.url)
    return sendHookRequest(Number(url.port), {
      path: url.pathname,
      headers: { Authorization: hook.headers.Authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }
}

describe('hooks の受け取りと区間の追跡(結合)', () => {
  it('pending(agent) → UserPromptSubmit で idle → PreToolUse で agent → PostToolUse の後も agent → PostToolBatch の 2 秒後に idle。release の後は 401', async () => {
    const prepared = await sessions.prepare(1, {
      cliKind: 'claude',
      file: '/bin/claude',
      args: [],
      env: {}
    })
    if (prepared.hooks === null) throw new Error('hooks を用意できなかった')
    const settings = JSON.parse(
      readFileSync(prepared.hooks.configPath, 'utf8')
    ) as AgentHookSettingsJson
    const post = poster(settings)
    sessions.activate(prepared, 'sid-1', '11111111-1111-4111-8111-111111111111')
    expect(tracker.activityOf(1).phase).toBe('agent')

    expect(
      (
        await post('UserPromptSubmit', {
          hook_event_name: 'UserPromptSubmit',
          session_id: 'c1',
          prompt: 'hi'
        })
      ).status
    ).toBe(200)
    expect(tracker.activityOf(1).phase).toBe('idle')

    await post('PreToolUse', {
      hook_event_name: 'PreToolUse',
      session_id: 'c1',
      tool_name: 'Edit',
      tool_use_id: 'toolu_1',
      tool_input: { file_path: '/x/a.txt' }
    })
    expect(tracker.activityOf(1).phase).toBe('agent')

    await post('PostToolUse', {
      hook_event_name: 'PostToolUse',
      session_id: 'c1',
      tool_name: 'Edit',
      tool_use_id: 'toolu_1'
    })
    expect(tracker.activityOf(1).phase).toBe('agent')
    // PostToolUse では閉じない(PostToolBatch を待つ)
    await new Promise((resolve) => setTimeout(resolve, 2_100))
    expect(tracker.activityOf(1).phase).toBe('agent')
    expect(
      (await post('PostToolBatch', { hook_event_name: 'PostToolBatch', session_id: 'c1' })).status
    ).toBe(200)
    expect(tracker.activityOf(1).phase).toBe('agent')
    await vi.waitFor(() => expect(tracker.activityOf(1).phase).toBe('idle'), {
      timeout: 4_000,
      interval: 100
    })

    sessions.release(prepared, 'sid-1')
    await vi.waitFor(() => expect(existsSync(prepared.hooks?.configPath ?? '')).toBe(false))
    expect((await post('Stop', { hook_event_name: 'Stop' })).status).toBe(401)
    expect(tracker.activityOf(1).phase).toBe('paused')
  }, 10_000)

  it('設定のディレクトリが外から消されても、次の prepare は作り直して hooks ありで起動できる', async () => {
    const first = await sessions.prepare(1, {
      cliKind: 'claude',
      file: '/bin/claude',
      args: [],
      env: {}
    })
    sessions.release(first, 'sid-1')
    // 設定のパスが無いときに dirname('') =「.」を消さないよう、先に絞り、一時ディレクトリの中であることを確かめてから消す
    const settingsPath = first.hooks?.configPath
    if (!settingsPath) throw new Error('hooks の設定のパスがありません')
    removeTempPathSync(dirname(settingsPath))

    const second = await sessions.prepare(1, {
      cliKind: 'claude',
      file: '/bin/claude',
      args: [],
      env: {}
    })
    expect(second.hooks).not.toBeNull()
    expect(existsSync(second.hooks?.configPath ?? '')).toBe(true)
    expect(dirname(second.hooks?.configPath ?? '')).not.toBe(dirname(first.hooks?.configPath ?? ''))
    sessions.release(second, 'sid-2')
  })

  it('activate したセッションの作業中の知らせは「セッションが見つかりません」にならない(hooks なしの起動も追跡に足す)', async () => {
    const withHooks = await sessions.prepare(1, {
      cliKind: 'claude',
      file: '/bin/claude',
      args: [],
      env: {}
    })
    sessions.activate(withHooks, 'sid-1', '11111111-1111-4111-8111-111111111111')
    sessions.activate(
      { ownerId: 1, cliKind: 'claude', hooks: null, unavailableReason: 'receiver-unavailable' },
      'sid-2',
      null
    )
    tracker.reportWorking(1, 'sid-1')
    tracker.reportWorking(1, 'sid-2')
    expect(trackerWarn).not.toHaveBeenCalledWith(
      '[agent-hooks] 作業中の知らせのセッションが見つかりません'
    )
    // 対照: 追跡に無いセッションは warn になる
    tracker.reportWorking(1, 'sid-unknown')
    expect(trackerWarn).toHaveBeenCalledWith(
      '[agent-hooks] 作業中の知らせのセッションが見つかりません'
    )
  })
})

describe('copilot の hooks の受け取りと区間の追跡(結合。段階 3b)', () => {
  const MAIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const SUB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const NEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const COPILOT_PLAN = { cliKind: 'copilot' as const, file: '/bin/copilot', args: [], env: {} }

  /** hooks.json のイベントの URL へ、copilot の PascalCase の形(Bearer・application/json。記録の本文の形)で POST する */
  function copilotPoster(
    config: CopilotHookConfigJson
  ): (
    event: CopilotHookEventName,
    body: Record<string, unknown>,
    authorization?: string
  ) => Promise<HookResponse> {
    return (event, body, authorization) => {
      const hook = config.hooks[event][0]
      const url = new URL(hook.url)
      return sendHookRequest(Number(url.port), {
        path: url.pathname,
        headers: {
          Authorization: authorization ?? hook.headers.Authorization,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ hook_event_name: event, ...body })
      })
    }
  }

  const waitForIdle = async (): Promise<void> => {
    await vi.waitFor(() => expect(tracker.activityOf(1).phase).toBe('idle'), {
      timeout: 4_000,
      interval: 100
    })
  }

  it('prepare が書いた hooks.json の URL・トークンで、区間の開閉・サブエージェント・/clear の採り直しが追跡に届く。不正なトークンは 200 で追跡を変えない。release で枠が返る', async () => {
    const prepared = await sessions.prepare(1, COPILOT_PLAN)
    if (prepared.hooks === null) throw new Error('hooks を用意できなかった')
    expect(prepared.hooks.configPath).toBe(
      join(userDataDir ?? '', COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME, 'slot-1')
    )
    const config = JSON.parse(
      readFileSync(join(prepared.hooks.configPath, 'hooks', 'hooks.json'), 'utf8')
    ) as CopilotHookConfigJson
    const post = copilotPoster(config)
    sessions.activate(prepared, 'sid-1', MAIN)
    expect(tracker.activityOf(1).phase).toBe('agent')

    // 不正なトークンは 200 で、追跡は pending(agent)のまま
    expect(
      (await post('UserPromptSubmit', { session_id: MAIN }, `Bearer ${'0'.repeat(64)}`)).status
    ).toBe(200)
    expect(tracker.activityOf(1).phase).toBe('agent')

    // 主のプロンプトで確かめ、主のツールの区間が開いて閉じる
    expect((await post('UserPromptSubmit', { session_id: MAIN, prompt: 'hi' })).status).toBe(200)
    expect(tracker.activityOf(1).phase).toBe('idle')
    await post('PreToolUse', {
      session_id: MAIN,
      tool_name: 'Edit',
      tool_input: { path: '/x/a.txt' }
    })
    expect(tracker.activityOf(1).phase).toBe('agent')
    await post('PostToolUse', { session_id: MAIN, tool_name: 'Edit' })
    await waitForIdle()

    // サブエージェント: 中の Stop でそのグループを閉じる(主の Stop を待たない)
    await post('PreToolUse', { session_id: SUB, tool_name: 'Write' })
    expect(tracker.activityOf(1).phase).toBe('agent')
    await post('Stop', { session_id: SUB })
    await waitForIdle()

    // /clear: 主の SessionEnd → 新しい ID のプロンプトで採り直し → その ID の Stop で主の区間を閉じる
    await post('SessionEnd', { session_id: MAIN, reason: 'clear' })
    await post('UserPromptSubmit', { session_id: NEW })
    await post('PreToolUse', { session_id: NEW, tool_name: 'Bash' })
    expect(tracker.activityOf(1).phase).toBe('agent')
    await post('Stop', { session_id: NEW })
    await waitForIdle()
    // 採り直した ID が主であることを、採り直していなければ閉じない知らせで確かめる(上の Stop は、採り直していなくても
    // サブエージェントの終わりとして同じ区間を閉じるので区別できない)。主の SessionEnd はすべての区間を閉じ、
    // 採り直していなければ別の会話の SessionEnd(other-session-end)になって区間が残る
    await post('PreToolUse', { session_id: NEW, tool_name: 'Edit' })
    expect(tracker.activityOf(1).phase).toBe('agent')
    await post('SessionEnd', { session_id: NEW, reason: 'clear' })
    await waitForIdle()

    sessions.release(prepared, 'sid-1')
    expect((await post('Stop', { session_id: NEW })).status).toBe(200)
    expect(tracker.activityOf(1).phase).toBe('paused')
    // 枠は返り、次の prepare は同じ slot-1 を使う(hooks.json は新しいトークンで書き直される)
    const next = await sessions.prepare(1, COPILOT_PLAN)
    expect(next.hooks?.configPath).toBe(prepared.hooks.configPath)
    expect(next.hooks?.token).not.toBe(prepared.hooks.token)
    sessions.release(next, null)
  }, 20_000)

  it('同時に準備した起動は別の枠を使い、release されるまで枠を貸し直さない(同じ枠への書き込みを重ねない。Task 4 の持ち越し)', async () => {
    const [first, second] = await Promise.all([
      sessions.prepare(1, COPILOT_PLAN),
      sessions.prepare(2, COPILOT_PLAN)
    ])
    const firstDir = first.hooks?.configPath
    const secondDir = second.hooks?.configPath
    if (!firstDir || !secondDir) throw new Error('hooks を用意できなかった')
    expect(new Set([firstDir, secondDir]).size).toBe(2)
    // 2 つの起動が動いている間(release の前)の次の準備は、どちらの枠も使わない
    const third = await sessions.prepare(3, COPILOT_PLAN)
    const thirdDir = third.hooks?.configPath
    if (!thirdDir) throw new Error('hooks を用意できなかった')
    expect([firstDir, secondDir]).not.toContain(thirdDir)
    // 1 つ目の起動が終わる(release)と、その枠を次の準備に貸す
    sessions.release(first, 'sid-1')
    const fourth = await sessions.prepare(4, COPILOT_PLAN)
    expect(fourth.hooks?.configPath).toBe(firstDir)
    for (const prepared of [second, third, fourth]) sessions.release(prepared, null)
  })
})
