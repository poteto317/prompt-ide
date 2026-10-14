import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentHookSessions } from '../agentHookSessions'
import type { AgentHookSessionsDeps, PreparedAgentHooks } from '../agentHookSessions'
import { buildAgentHookSettings } from '../agentHookSettings'
import type { ClaudeVersionCheck } from '../agentClaudeVersion'
import type { AgentLaunchPlan } from '../agentCommand'

const TOKEN = 'ab'.repeat(32)
const PLAN: AgentLaunchPlan = { file: '/bin/claude', args: [], env: { PATH: '/p' } }
const BASE = 'http://127.0.0.1:43210'

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
  hooks: { settingsPath: '/tmp/hooks-dir/f.json', token: TOKEN },
  unavailableReason: null
}

describe('createAgentHookSessions: prepare', () => {
  it('版が対応していれば、受け口の開始 → ディレクトリ → 設定のファイルの書き込みの順に行い、トークンはまだ表に足さない', async () => {
    await expect(sessions().prepare(7, PLAN)).resolves.toEqual(WITH_HOOKS)
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
      hooks: null,
      unavailableReason: 'receiver-unavailable'
    })
    for (const [message] of deps.log.mock.calls as [string][]) expect(message).not.toContain(TOKEN)
  })
})

describe('createAgentHookSessions: activate・release', () => {
  it('hooks があれば、追跡に足してから(addSession)トークンを表に足す(addToken。addToken が投げても追跡は pending〈agent〉で残る)', () => {
    sessions().activate(WITH_HOOKS, 'sid-1')
    expect(calls.map((call) => call.split('(')[0])).toEqual(['addSession', 'addToken'])
  })

  it('hooks があれば、トークンを { ownerId, sessionId } として表に足し、追跡に pending で足す', () => {
    sessions().activate(WITH_HOOKS, 'sid-1')
    expect(deps.receiver.addToken).toHaveBeenCalledExactlyOnceWith(TOKEN, {
      ownerId: 7,
      sessionId: 'sid-1'
    })
    expect(deps.tracker.addSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1', { kind: 'pending' })
  })

  it('hooks が無ければ、追跡に unconfirmed(理由)で足すだけ', () => {
    sessions().activate(
      { ownerId: 7, hooks: null, unavailableReason: 'receiver-unavailable' },
      'sid-1'
    )
    expect(deps.receiver.addToken).not.toHaveBeenCalled()
    expect(deps.tracker.addSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1', {
      kind: 'unconfirmed',
      reason: 'receiver-unavailable'
    })
  })

  it('release は hooks があれば表から外してファイルを消し、sessionId があれば追跡から外す', () => {
    sessions().release(WITH_HOOKS, 'sid-1')
    expect(deps.receiver.removeToken).toHaveBeenCalledExactlyOnceWith(TOKEN)
    expect(deps.removeSettingsFile).toHaveBeenCalledExactlyOnceWith('/tmp/hooks-dir/f.json')
    expect(deps.tracker.removeSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1')
  })

  it('release(prepared, null) は追跡に触らない(起動しなかった)', () => {
    sessions().release(WITH_HOOKS, null)
    expect(deps.removeSettingsFile).toHaveBeenCalledOnce()
    expect(deps.tracker.removeSession).not.toHaveBeenCalled()
  })

  it('hooks: null でも sessionId があれば追跡から外す', () => {
    sessions().release(
      { ownerId: 7, hooks: null, unavailableReason: 'claude-version-unsupported' },
      'sid-1'
    )
    expect(deps.receiver.removeToken).not.toHaveBeenCalled()
    expect(deps.removeSettingsFile).not.toHaveBeenCalled()
    expect(deps.tracker.removeSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1')
  })
})
