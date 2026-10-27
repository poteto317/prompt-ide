import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentHookSessions } from '../agentHookSessions'
import type { AgentHookSessionsDeps, PreparedAgentHooks } from '../agentHookSessions'
import { buildAgentHookSettings } from '../agentHookSettings'
import { buildCopilotHookConfig } from '../agentCopilotHookConfig'
import type { ClaudeVersionCheck } from '../agentClaudeVersion'
import type { AgentLaunchPlan } from '../agentCommand'

const TOKEN = 'ab'.repeat(32)
const CLAUDE_SESSION_ID = '11111111-1111-4111-8111-111111111111'
const PLAN: AgentLaunchPlan = {
  cliKind: 'claude',
  file: '/bin/claude',
  args: [],
  env: { PATH: '/p' }
}
const BASE = 'http://127.0.0.1:43210'
const SLOT = { number: 1, dir: '/u/agent-hooks-copilot/slot-1' }
const COPILOT_PLAN: AgentLaunchPlan = {
  cliKind: 'copilot',
  file: '/bin/copilot',
  args: [],
  env: { PATH: '/p' }
}

let calls: string[]
let deps: {
  receiver: {
    ensureListening: ReturnType<typeof vi.fn>
    addToken: ReturnType<typeof vi.fn>
    removeToken: ReturnType<typeof vi.fn>
  }
  settingsDir: { ensure: ReturnType<typeof vi.fn> }
  tracker: { addSession: ReturnType<typeof vi.fn>; removeSession: ReturnType<typeof vi.fn> }
  versions: { readClaudeVersion: ReturnType<typeof vi.fn> }
  writeSettingsFile: ReturnType<typeof vi.fn>
  removeSettingsFile: ReturnType<typeof vi.fn>
  copilotPlugins: {
    acquire: ReturnType<typeof vi.fn>
    release: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
  }
  log: ReturnType<typeof vi.fn>
}

const recorder = <T>(label: string, impl: () => T): ReturnType<typeof vi.fn> =>
  vi.fn((...args: unknown[]) => {
    calls.push(`${label}(${args.map((arg) => JSON.stringify(arg)).join(',')})`)
    return impl()
  })

beforeEach(() => {
  calls = []
  deps = {
    receiver: {
      ensureListening: recorder('ensureListening', async () => ({ baseUrl: BASE })),
      addToken: recorder('addToken', () => undefined),
      removeToken: recorder('removeToken', () => undefined)
    },
    settingsDir: { ensure: recorder('ensure', async () => '/tmp/hooks-dir') },
    tracker: {
      addSession: recorder('addSession', () => undefined),
      removeSession: recorder('removeSession', () => undefined)
    },
    versions: {
      readClaudeVersion: recorder(
        'readClaudeVersion',
        async (): Promise<ClaudeVersionCheck> => ({ kind: 'supported', version: '2.1.291' })
      )
    },
    writeSettingsFile: recorder('writeSettingsFile', async () => '/tmp/hooks-dir/f.json'),
    removeSettingsFile: recorder('removeSettingsFile', async () => undefined),
    copilotPlugins: {
      acquire: recorder('acquire', () => SLOT),
      release: recorder('release', () => undefined),
      write: recorder('write', async () => undefined)
    },
    log: vi.fn()
  }
})

const sessions = (): ReturnType<typeof createAgentHookSessions> =>
  createAgentHookSessions({
    ...(deps as unknown as AgentHookSessionsDeps),
    createToken: () => TOKEN
  })

const WITH_HOOKS: PreparedAgentHooks = {
  ownerId: 7,
  cliKind: 'claude',
  hooks: { configPath: '/tmp/hooks-dir/f.json', token: TOKEN, discard: () => undefined },
  unavailableReason: null
}

describe('createAgentHookSessions: prepare', () => {
  it('版が対応していれば、受け口の開始 → ディレクトリ → 設定のファイルの書き込みの順に行い、トークンはまだ表に足さない', async () => {
    await expect(sessions().prepare(7, PLAN)).resolves.toEqual({
      ownerId: 7,
      cliKind: 'claude',
      hooks: { configPath: '/tmp/hooks-dir/f.json', token: TOKEN, discard: expect.any(Function) },
      unavailableReason: null
    })
    expect(deps.versions.readClaudeVersion).toHaveBeenCalledWith(PLAN)
    expect(calls.map((call) => call.split('(')[0])).toEqual([
      'readClaudeVersion',
      'ensureListening',
      'ensure',
      'writeSettingsFile'
    ])
    expect(deps.writeSettingsFile).toHaveBeenCalledWith(
      '/tmp/hooks-dir',
      buildAgentHookSettings({ baseUrl: BASE, token: TOKEN })
    )
    expect(deps.receiver.addToken).not.toHaveBeenCalled()
    expect(deps.tracker.addSession).not.toHaveBeenCalled()
  })

  it.each<[string, ClaudeVersionCheck | Error]>([
    ['古い版', { kind: 'unsupported', version: '2.1.100' }],
    ['分からない版', { kind: 'unknown', reason: 'timeout', detail: 'x' }],
    ['確認の例外', new Error('boom')]
  ])(
    '%s なら受け口・ディレクトリ・書き込みのどれも呼ばずに hooks: null(claude-version-unsupported)',
    async (_label, check) => {
      deps.versions.readClaudeVersion.mockImplementation(async () => {
        if (check instanceof Error) throw check
        return check
      })
      await expect(sessions().prepare(7, PLAN)).resolves.toEqual({
        ownerId: 7,
        cliKind: 'claude',
        hooks: null,
        unavailableReason: 'claude-version-unsupported'
      })
      expect(deps.receiver.ensureListening).not.toHaveBeenCalled()
      expect(deps.settingsDir.ensure).not.toHaveBeenCalled()
      expect(deps.writeSettingsFile).not.toHaveBeenCalled()
    }
  )

  it.each<[string, () => void]>([
    [
      '受け口の開始',
      () => deps.receiver.ensureListening.mockRejectedValueOnce(new Error('EADDRINUSE'))
    ],
    ['ディレクトリ', () => deps.settingsDir.ensure.mockRejectedValueOnce(new Error('EACCES'))],
    [
      '設定のファイルの書き込み',
      () => deps.writeSettingsFile.mockRejectedValueOnce(new Error('ENOSPC'))
    ]
  ])('%s の失敗は hooks: null(receiver-unavailable)。例外にしない', async (_label, fail) => {
    fail()
    await expect(sessions().prepare(7, PLAN)).resolves.toEqual({
      ownerId: 7,
      cliKind: 'claude',
      hooks: null,
      unavailableReason: 'receiver-unavailable'
    })
    for (const [message] of deps.log.mock.calls as [string][]) expect(message).not.toContain(TOKEN)
  })
})

describe('createAgentHookSessions: activate・release', () => {
  it('copilot の prepared なら、トークンの持ち主に起動に使った会話の ID を主の ID(known)として持たせる(L-018)', () => {
    sessions().activate({ ...WITH_HOOKS, cliKind: 'copilot' }, 'sid-1', CLAUDE_SESSION_ID)
    expect(deps.receiver.addToken).toHaveBeenCalledExactlyOnceWith(TOKEN, {
      ownerId: 7,
      sessionId: 'sid-1',
      cli: { kind: 'copilot', main: { kind: 'known', id: CLAUDE_SESSION_ID } }
    })
  })

  it('copilot で会話の ID が無ければ(起こらない想定)、主の ID を待つ状態(awaiting)で持たせる', () => {
    sessions().activate({ ...WITH_HOOKS, cliKind: 'copilot' }, 'sid-1', null)
    expect(deps.receiver.addToken).toHaveBeenCalledExactlyOnceWith(TOKEN, {
      ownerId: 7,
      sessionId: 'sid-1',
      cli: { kind: 'copilot', main: { kind: 'awaiting' } }
    })
  })

  it('hooks があれば、追跡に足してから(addSession)トークンを表に足す(addToken。addToken が投げても追跡は pending〈agent〉で残る)', () => {
    sessions().activate(WITH_HOOKS, 'sid-1', CLAUDE_SESSION_ID)
    expect(calls.map((call) => call.split('(')[0])).toEqual(['addSession', 'addToken'])
  })

  it('hooks があれば、トークンを { ownerId, sessionId, cli }(claude の cli は種類だけ)として表に足し、追跡に pending で足す', () => {
    sessions().activate(WITH_HOOKS, 'sid-1', CLAUDE_SESSION_ID)
    expect(deps.receiver.addToken).toHaveBeenCalledExactlyOnceWith(TOKEN, {
      ownerId: 7,
      sessionId: 'sid-1',
      cli: { kind: 'claude' }
    })
    expect(deps.tracker.addSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1', { kind: 'pending' })
  })

  it('hooks が無ければ、追跡に unconfirmed(理由)で足すだけ', () => {
    sessions().activate(
      { ownerId: 7, cliKind: 'claude', hooks: null, unavailableReason: 'receiver-unavailable' },
      'sid-1',
      CLAUDE_SESSION_ID
    )
    expect(deps.receiver.addToken).not.toHaveBeenCalled()
    expect(deps.tracker.addSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1', {
      kind: 'unconfirmed',
      reason: 'receiver-unavailable'
    })
  })

  it('release は hooks があればトークンを表から外して後始末(claude は設定のファイルを消す)をし、sessionId があれば追跡から外す', async () => {
    const prepared = await sessions().prepare(7, PLAN)
    sessions().release(prepared, 'sid-1')
    expect(deps.receiver.removeToken).toHaveBeenCalledExactlyOnceWith(TOKEN)
    expect(deps.removeSettingsFile).toHaveBeenCalledExactlyOnceWith('/tmp/hooks-dir/f.json')
    expect(deps.tracker.removeSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1')
  })

  it('release(prepared, null) は追跡に触らない(起動しなかった)', async () => {
    const prepared = await sessions().prepare(7, PLAN)
    sessions().release(prepared, null)
    expect(deps.removeSettingsFile).toHaveBeenCalledOnce()
    expect(deps.tracker.removeSession).not.toHaveBeenCalled()
  })

  it('トークンの除去が投げても後始末(discard)と追跡からの除去を試し、ログに出す(L-001・L-053)', () => {
    deps.receiver.removeToken.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const discard = vi.fn()
    sessions().release(
      { ...WITH_HOOKS, hooks: { configPath: '/x', token: TOKEN, discard } },
      'sid-1'
    )
    expect(discard).toHaveBeenCalledOnce()
    expect(deps.tracker.removeSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1')
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] hooks のトークンを外せませんでした: boom')
  })

  it('hooks: null でも sessionId があれば追跡から外す', () => {
    sessions().release(
      {
        ownerId: 7,
        cliKind: 'claude',
        hooks: null,
        unavailableReason: 'claude-version-unsupported'
      },
      'sid-1'
    )
    expect(deps.receiver.removeToken).not.toHaveBeenCalled()
    expect(deps.removeSettingsFile).not.toHaveBeenCalled()
    expect(deps.tracker.removeSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1')
  })

  it('cli-unsupported の prepared を activate すると、追跡に unconfirmed(cli-unsupported)で足すだけ', () => {
    sessions().activate(
      { ownerId: 7, cliKind: 'claude', hooks: null, unavailableReason: 'cli-unsupported' },
      'sid-1',
      CLAUDE_SESSION_ID
    )
    expect(deps.tracker.addSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1', {
      kind: 'unconfirmed',
      reason: 'cli-unsupported'
    })
    expect(deps.receiver.addToken).not.toHaveBeenCalled()
  })
})

describe('createAgentHookSessions: prepare・release(copilot。段階 3b)', () => {
  it('版を確かめず(L-052)、受け口 → 枠 → 書き直しの順に行い、プラグインのフォルダのパスとトークンを返す(トークンはまだ表に足さない)', async () => {
    await expect(sessions().prepare(7, COPILOT_PLAN)).resolves.toEqual({
      ownerId: 7,
      cliKind: 'copilot',
      hooks: { configPath: SLOT.dir, token: TOKEN, discard: expect.any(Function) },
      unavailableReason: null
    })
    expect(calls.map((call) => call.split('(')[0])).toEqual(['ensureListening', 'acquire', 'write'])
    expect(deps.copilotPlugins.write).toHaveBeenCalledExactlyOnceWith(
      SLOT,
      buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN })
    )
    expect(deps.versions.readClaudeVersion).not.toHaveBeenCalled()
    expect(deps.settingsDir.ensure).not.toHaveBeenCalled()
    expect(deps.writeSettingsFile).not.toHaveBeenCalled()
    expect(deps.receiver.addToken).not.toHaveBeenCalled()
  })

  it('受け口の失敗は枠を取らずに receiver-unavailable(例外にしない)', async () => {
    deps.receiver.ensureListening.mockRejectedValueOnce(new Error('EADDRINUSE'))
    await expect(sessions().prepare(7, COPILOT_PLAN)).resolves.toEqual({
      ownerId: 7,
      cliKind: 'copilot',
      hooks: null,
      unavailableReason: 'receiver-unavailable'
    })
    expect(deps.copilotPlugins.acquire).not.toHaveBeenCalled()
  })

  it('枠が空いていなければ書き直さずに receiver-unavailable', async () => {
    deps.copilotPlugins.acquire.mockReturnValueOnce(null)
    await expect(sessions().prepare(7, COPILOT_PLAN)).resolves.toMatchObject({
      hooks: null,
      unavailableReason: 'receiver-unavailable'
    })
    expect(deps.copilotPlugins.write).not.toHaveBeenCalled()
    expect(deps.log).toHaveBeenCalledWith(
      '[agent-hooks] copilot の hooks のフォルダの枠が空いていません'
    )
  })

  it('書き直しの失敗は枠を返して receiver-unavailable。ログにトークンを入れない', async () => {
    deps.copilotPlugins.write.mockRejectedValueOnce(new Error('EACCES: /Users/u/x'))
    await expect(sessions().prepare(7, COPILOT_PLAN)).resolves.toMatchObject({
      hooks: null,
      unavailableReason: 'receiver-unavailable'
    })
    expect(deps.copilotPlugins.release).toHaveBeenCalledExactlyOnceWith(SLOT)
    // ログに出したことを先に確かめる(log が呼ばれないと、下のトークンの確かめが何も確かめずに通るため)
    expect(deps.log).toHaveBeenCalledWith(
      '[agent-hooks] copilot の hooks のフォルダを用意できませんでした: EACCES: /Users/u/x'
    )
    for (const [message] of deps.log.mock.calls as [string][]) expect(message).not.toContain(TOKEN)
  })

  it('書き直しが終わるまで prepare は解決せず、解決した後も release されるまで枠を返さない(同じ枠への書き込みを重ねない。Task 4 の持ち越し)', async () => {
    let finishWrite: () => void = () => undefined
    deps.copilotPlugins.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve
        })
    )
    let settled = false
    const pending = sessions()
      .prepare(7, COPILOT_PLAN)
      .then((prepared) => {
        settled = true
        return prepared
      })
    await vi.waitFor(() => expect(deps.copilotPlugins.write).toHaveBeenCalledOnce())
    // 書き直しの途中: prepare はまだ解決せず(starter は spawn に進まない)、枠も返さない
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(deps.copilotPlugins.release).not.toHaveBeenCalled()
    finishWrite()
    const prepared = await pending
    // 書き直しの後(pty が動いている間): release が呼ばれるまで枠を持ち続ける
    expect(deps.copilotPlugins.release).not.toHaveBeenCalled()
    sessions().release(prepared, 'sid-1')
    expect(deps.copilotPlugins.release).toHaveBeenCalledExactlyOnceWith(SLOT)
  })

  it('release は枠を返し(hooks.json は消さない)、トークンを外し、追跡から外す', async () => {
    const prepared = await sessions().prepare(7, COPILOT_PLAN)
    sessions().release(prepared, 'sid-1')
    expect(deps.copilotPlugins.release).toHaveBeenCalledExactlyOnceWith(SLOT)
    expect(deps.receiver.removeToken).toHaveBeenCalledExactlyOnceWith(TOKEN)
    expect(deps.removeSettingsFile).not.toHaveBeenCalled()
    expect(deps.tracker.removeSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1')
  })

  it('起動しなかったとき(release(prepared, null))も枠を返す(取り消し・ID の選択の拒否・spawn の失敗。L-061)', async () => {
    const prepared = await sessions().prepare(7, COPILOT_PLAN)
    sessions().release(prepared, null)
    expect(deps.copilotPlugins.release).toHaveBeenCalledExactlyOnceWith(SLOT)
    expect(deps.tracker.removeSession).not.toHaveBeenCalled()
  })
})
