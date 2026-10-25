import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCliCapabilities, AgentCliKind } from '@shared/agentCliKinds'

// 能力の表の sessionResume が偽の種類の流れ(再開の拒否・会話の ID を持たない起動)を確かめるため、能力の表を差し替える(段階 3a で
// copilot も再開に対応し、今の表には該当する種類が無い。設計書 2026-10-23「実装の分割」の 3)。差し替えはこのファイルの中だけ
const capabilityOverrides = vi.hoisted(() => ({
  sessionResumeUnsupportedKinds: new Set<AgentCliKind>()
}))
vi.mock('@shared/agentCliKinds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/agentCliKinds')>()
  return {
    ...actual,
    agentCliCapabilities: (kind: AgentCliKind): AgentCliCapabilities => {
      const capabilities = { ...actual.agentCliCapabilities(kind) }
      if (capabilityOverrides.sessionResumeUnsupportedKinds.has(kind)) {
        capabilities.sessionResume = false
      }
      return capabilities
    }
  }
})

import type { AgentStartRequest } from '@shared/types'
import { FolderAccessManager } from '../folderAccessManager'
import { AgentSessionRegistry } from '../agentSessionRegistry'
import { createAgentSessionStarter } from '../agentSessionStarter'
import type { AgentSessionSink, AgentSessionStarterService } from '../agentSessionStarter'
import { createAgentSessionRecordStore } from '../agentSessionRecordStore'
import type { AgentSessionRecordStore } from '../agentSessionRecordStore'
import { createClaudeSessionReservations } from '../claudeSessionReservations'
import type { ClaudeSessionReservations } from '../claudeSessionReservations'
import { AGENT_CLI_LAUNCH_SPECS } from '../agentCliLaunchSpecs'
import type { PtySpawn, StopTree } from '../agentSession'
import type { AgentLaunchResolution } from '../agentCommand'
import { makeFakePty } from './helpers/fakePty'
import type { FakePty } from './helpers/fakePty'
import { makeFakeRecordIo } from './helpers/fakeAgentSessionRecordIo'
import { makeFakeAgentHookSessions } from './helpers/fakeAgentHookSessions'
import type { FakeAgentHookSessions } from './helpers/fakeAgentHookSessions'

const ID = '11111111-1111-4111-8111-111111111111'
const NEW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REQUEST: AgentStartRequest = {
  slotId: 'slot-1',
  folderPath: '/work',
  cols: 90,
  rows: 20,
  launch: { kind: 'new' }
}
const COPILOT_LAUNCH: AgentLaunchResolution = {
  kind: 'ok',
  plan: { cliKind: 'copilot', file: '/bin/copilot', args: [], env: { PATH: '/p' } }
}

let folderAccess: FolderAccessManager
let registry: AgentSessionRegistry
let spawnPty: ReturnType<typeof vi.fn<PtySpawn>>
let claudeRecords: AgentSessionRecordStore
let copilotRecords: AgentSessionRecordStore
let reservations: ClaudeSessionReservations
let hooks: FakeAgentHookSessions
let createClaudeSessionId: ReturnType<typeof vi.fn<() => string>>
const stopTree = vi.fn<StopTree>(async (target, exited) => {
  ;(target as FakePty).emitExit(0, 15)
  await exited
})

const makeSink = (): AgentSessionSink => ({
  isGone: () => false,
  onData: () => undefined,
  onExit: () => undefined
})

function makeService(): AgentSessionStarterService {
  return createAgentSessionStarter({
    folderAccess,
    registry,
    resolveLaunch: async () => COPILOT_LAUNCH,
    spawnPty,
    stopTree,
    createSessionId: () => 'sid-1',
    records: { claude: claudeRecords, copilot: copilotRecords },
    reservations,
    createClaudeSessionId,
    platform: 'linux',
    canonicalize: async (folderPath) => folderPath,
    isDirectory: async () => true,
    hooks
  })
}

beforeEach(async () => {
  capabilityOverrides.sessionResumeUnsupportedKinds.add('copilot')
  folderAccess = new FolderAccessManager()
  folderAccess.set(1, '/work')
  registry = new AgentSessionRegistry()
  spawnPty = vi.fn<PtySpawn>().mockReturnValue(makeFakePty(4242))
  claudeRecords = createAgentSessionRecordStore(makeFakeRecordIo())
  copilotRecords = createAgentSessionRecordStore(makeFakeRecordIo())
  await claudeRecords.whenLoaded()
  await copilotRecords.whenLoaded()
  reservations = createClaudeSessionReservations()
  hooks = makeFakeAgentHookSessions()
  createClaudeSessionId = vi.fn<() => string>(() => NEW_ID)
})

afterEach(() => {
  capabilityOverrides.sessionResumeUnsupportedKinds.clear()
  vi.restoreAllMocks()
})

describe('createAgentSessionStarter(再開に対応しない種類。能力の表を差し替えた copilot)', () => {
  it('resume の依頼は resume-unsupported で断り、hooks.prepare・記録の読み込み・spawn をしない(起動しない。L-041)', async () => {
    copilotRecords.record('/work', ID)
    const whenLoadedSpy = vi.spyOn(copilotRecords, 'whenLoaded')
    await expect(
      makeService().start(
        1,
        { ...REQUEST, launch: { kind: 'resume', claudeSessionId: ID, cliKind: 'copilot' } },
        makeSink()
      )
    ).resolves.toEqual({ kind: 'error', error: 'resume-unsupported' })
    expect(hooks.prepare).not.toHaveBeenCalled()
    expect(whenLoadedSpy).not.toHaveBeenCalled()
    expect(spawnPty).not.toHaveBeenCalled()
    expect(registry.snapshot(1)).toEqual([])
  })

  it('new は会話の ID を振らず・予約せず・記録せず、起動の表に null を渡し、結果と sessionInfoOf の ID は null', async () => {
    // 今の copilot の起動の表は ID が無いと投げるので、ID を持たない種類の起動の表の形(引数なし)に差し替える
    const buildArgs = vi.spyOn(AGENT_CLI_LAUNCH_SPECS.copilot, 'buildArgs').mockReturnValue([])
    const reserveSpy = vi.spyOn(reservations, 'tryReserve')
    const recordSpy = vi.spyOn(copilotRecords, 'record')
    const { start, sessionInfoOf } = makeService()
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    expect(buildArgs).toHaveBeenCalledExactlyOnceWith({ kind: 'new' }, null, null)
    expect(spawnPty).toHaveBeenCalledWith('/bin/copilot', [], expect.any(Object))
    expect(createClaudeSessionId).not.toHaveBeenCalled()
    expect(reserveSpy).not.toHaveBeenCalled()
    expect(recordSpy).not.toHaveBeenCalled()
    expect(copilotRecords.last('/work')).toBeNull()
    expect(claudeRecords.last('/work')).toBeNull()
    expect(sessionInfoOf('sid-1')).toEqual({ cliKind: 'copilot', claudeSessionId: null })
  })
})
