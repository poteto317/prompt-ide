import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
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
import { sendHookRequest } from './helpers/agentHookHttp'
import type { HookResponse } from './helpers/agentHookHttp'

// 受け口・追跡・agentHookSessions を実物で組み立て、claude が送る形の要求を送る(claude は起動しない)。
// URL とトークンは prepare が書いた設定のファイルから読む(設定の URL と受け口のパスが食い違わないことも確かめる)

let tracker: AgentToolActivity
let receiver: AgentHookReceiver
let settingsDir: AgentHookSettingsDir
let sessions: AgentHookSessions
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
  sessions = createAgentHookSessions({
    receiver,
    settingsDir,
    tracker,
    versions: { readClaudeVersion: async () => ({ kind: 'supported', version: '2.1.291' }) },
    writeSettingsFile: writeAgentHookSettingsFile,
    removeSettingsFile: removeAgentHookSettingsFile,
    log: vi.fn()
  })
})

afterEach(() => {
  receiver.close()
  tracker.close()
  settingsDir.removeSync()
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
    const prepared = await sessions.prepare(1, { file: '/bin/claude', args: [], env: {} })
    if (prepared.hooks === null) throw new Error('hooks を用意できなかった')
    const settings = JSON.parse(
      readFileSync(prepared.hooks.settingsPath, 'utf8')
    ) as AgentHookSettingsJson
    const post = poster(settings)
    sessions.activate(prepared, 'sid-1')
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
    await vi.waitFor(() => expect(existsSync(prepared.hooks?.settingsPath ?? '')).toBe(false))
    expect((await post('Stop', { hook_event_name: 'Stop' })).status).toBe(401)
    expect(tracker.activityOf(1).phase).toBe('paused')
  }, 10_000)

  it('設定のディレクトリが外から消されても、次の prepare は作り直して hooks ありで起動できる', async () => {
    const first = await sessions.prepare(1, { file: '/bin/claude', args: [], env: {} })
    sessions.release(first, 'sid-1')
    rmSync(dirname(first.hooks?.settingsPath ?? ''), { recursive: true, force: true })

    const second = await sessions.prepare(1, { file: '/bin/claude', args: [], env: {} })
    expect(second.hooks).not.toBeNull()
    expect(existsSync(second.hooks?.settingsPath ?? '')).toBe(true)
    expect(dirname(second.hooks?.settingsPath ?? '')).not.toBe(
      dirname(first.hooks?.settingsPath ?? '')
    )
    sessions.release(second, 'sid-2')
  })

  it('activate したセッションの作業中の知らせは「セッションが見つかりません」にならない(hooks なしの起動も追跡に足す)', async () => {
    const withHooks = await sessions.prepare(1, { file: '/bin/claude', args: [], env: {} })
    sessions.activate(withHooks, 'sid-1')
    sessions.activate(
      { ownerId: 1, hooks: null, unavailableReason: 'receiver-unavailable' },
      'sid-2'
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
