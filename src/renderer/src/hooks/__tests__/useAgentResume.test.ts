import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { RenderHookResult } from '@testing-library/react'
import type { HistoryEntry } from '../../types'
import type { AgentLastSessionLookup } from '../../lib/agentResumeAvailability'
import {
  makeAgentSessionsState,
  makeAgentSessionTabView
} from '../../__tests__/makeAgentSessionsState'
import {
  AGENT_RESUME_ENTRY_LEGACY_MODE,
  AGENT_RESUME_LAST_NO_RECORD,
  agentResumeEntryCliMismatch,
  agentResumeEntryUnknownCli,
  agentResumeEntryFolderMismatch,
  agentResumeEntryInUse,
  agentResumeEntryUnsupportedReason,
  agentResumeLastInUse,
  agentResumeLastUnsupportedReason
} from '../../lib/agentSessionMessages'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

// 設定の種類が再開に対応していないときの理由を確かめるため、能力の表を差し替える(段階 3a で copilot も再開に対応した)
const capabilityOverrides = vi.hoisted(
  (): AgentCliCapabilityOverrides => ({
    unsupportedKinds: new Set<AgentCliKind>(),
    promptSendUnsupportedKinds: new Set<AgentCliKind>(),
    sessionResumeUnsupportedKinds: new Set<AgentCliKind>(),
    changeAttributionUnsupportedKinds: new Set<AgentCliKind>()
  })
)
vi.mock('@shared/agentCliKinds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/agentCliKinds')>()
  const { overrideAgentCliCapabilities } =
    await import('../../__tests__/agentCliCapabilityOverrides')
  return {
    ...actual,
    agentCliCapabilities: overrideAgentCliCapabilities(
      actual.agentCliCapabilities,
      capabilityOverrides
    )
  }
})

const mockUseAgentLastSession = vi.hoisted(() =>
  vi.fn<(options: unknown) => AgentLastSessionLookup>(() => ({ kind: 'none' }))
)
vi.mock('../useAgentLastSession', () => ({ useAgentLastSession: mockUseAgentLastSession }))

import { useAgentResume } from '../useAgentResume'
import type { AgentResumeState, UseAgentResumeOptions } from '../useAgentResume'

const ID = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-9222-222222222222'
const FOLDER = '/work/project'

const agentEntry = (cliSessionId = ID): HistoryEntry => ({
  id: 'h1',
  promptId: 'p1',
  promptTitle: 'タイトル',
  promptContent: '全文',
  fileContent: null,
  toolId: 'claude',
  status: 'sent',
  resultText: null,
  errorMessage: null,
  executedAt: 1,
  agent: {
    claudeSessionId: cliSessionId,
    cliKind: 'claude',
    tabLabel: 'claude 1',
    folderPath: FOLDER
  }
})

const legacyEntry: HistoryEntry = { ...agentEntry(), status: 'success', agent: null }

/** 送り先の種類を cliKind にしたエージェントのエントリ */
const agentEntryOf = (cliKind: string, cliSessionId = ID): HistoryEntry => {
  const entry = agentEntry(cliSessionId)
  return { ...entry, agent: entry.agent === null ? null : { ...entry.agent, cliKind } }
}

function renderResume(overrides: Partial<UseAgentResumeOptions> = {}): {
  options: UseAgentResumeOptions
} & RenderHookResult<AgentResumeState, unknown> {
  const options: UseAgentResumeOptions = {
    folderPath: FOLDER,
    mode: 'agent-cli',
    appCliKind: 'claude',
    sessions: makeAgentSessionsState(),
    activateTab: vi.fn(),
    ...overrides
  }
  return { options, ...renderHook(() => useAgentResume(options)) }
}

describe('useAgentResume', () => {
  beforeEach(() => {
    mockUseAgentLastSession.mockReset()
    mockUseAgentLastSession.mockReturnValue({ kind: 'none' })
  })

  describe('前回の続きから', () => {
    it('起動の確定の回数だけを取り直しの契機にし、エージェント CLI 方式のときだけ取りに行く', () => {
      const tabs = [
        makeAgentSessionTabView({ slotId: 'a', status: 'running', cliSessionId: ID }),
        makeAgentSessionTabView({ slotId: 'b', status: 'none' })
      ]
      renderResume({ mode: 'legacy', sessions: makeAgentSessionsState({ tabs }) })
      expect(mockUseAgentLastSession).toHaveBeenLastCalledWith({
        folderPath: FOLDER,
        cliKind: 'claude',
        enabled: false,
        refreshKey: '0'
      })
    })

    it('実行中のタブの ID の並びが変わっても(終了・タブを閉じた)、起動の確定の回数が同じなら取り直しの契機を変えない(main の記録は起動の確定でしか変わらない)', () => {
      const options: UseAgentResumeOptions = {
        folderPath: FOLDER,
        mode: 'agent-cli',
        appCliKind: 'claude',
        sessions: makeAgentSessionsState({
          tabs: [makeAgentSessionTabView({ slotId: 'a', status: 'running', cliSessionId: ID })],
          startConfirmedCount: 1
        }),
        activateTab: vi.fn()
      }
      const { rerender } = renderHook(() => useAgentResume(options))
      const before = mockUseAgentLastSession.mock.lastCall?.[0] as { refreshKey: string }
      options.sessions = makeAgentSessionsState({
        tabs: [makeAgentSessionTabView({ slotId: 'a', status: 'exited', cliSessionId: null })],
        startConfirmedCount: 1
      })
      rerender()
      const after = mockUseAgentLastSession.mock.lastCall?.[0] as { refreshKey: string }
      expect(after.refreshKey).toBe(before.refreshKey)
    })

    it('起動の確定の回数が増えたら、取り直しの契機を変える(起動の結果より先に終了が届き、実行中の ID が一度も現れないときも)', () => {
      const tabs = [makeAgentSessionTabView({ slotId: 'a', status: 'exited' })]
      const options: UseAgentResumeOptions = {
        folderPath: FOLDER,
        mode: 'agent-cli',
        appCliKind: 'claude',
        sessions: makeAgentSessionsState({ tabs, startConfirmedCount: 0 }),
        activateTab: vi.fn()
      }
      const { rerender } = renderHook(() => useAgentResume(options))
      const before = mockUseAgentLastSession.mock.lastCall?.[0] as { refreshKey: string }
      options.sessions = makeAgentSessionsState({ tabs, startConfirmedCount: 1 })
      rerender()
      const after = mockUseAgentLastSession.mock.lastCall?.[0] as { refreshKey: string }
      expect(after.refreshKey).not.toBe(before.refreshKey)
    })

    it('記録が無ければ押せない理由を出し、押しても起動しない', () => {
      const sessions = makeAgentSessionsState()
      const { result } = renderResume({ sessions })
      expect(result.current.resumeLast.disabledReason).toBe(AGENT_RESUME_LAST_NO_RECORD)
      act(() => result.current.resumeLast.onResume('slot-1'))
      expect(sessions.start).not.toHaveBeenCalled()
    })

    it('前回が見つかれば押せて、押すとそのタブで前回の ID を再開する', () => {
      mockUseAgentLastSession.mockReturnValue({
        kind: 'found',
        cliKind: 'claude',
        cliSessionId: ID
      })
      const sessions = makeAgentSessionsState()
      const { result } = renderResume({ sessions })
      expect(result.current.resumeLast.disabledReason).toBeNull()
      act(() => result.current.resumeLast.onResume('slot-1'))
      expect(sessions.start).toHaveBeenCalledWith('slot-1', {
        kind: 'resume',
        cliSessionId: ID,
        cliKind: 'claude'
      })
    })

    it('起動の理由(sessions.startDisabledReason)を優先し、無ければ同じ ID のタブの名前を理由にする', () => {
      mockUseAgentLastSession.mockReturnValue({
        kind: 'found',
        cliKind: 'claude',
        cliSessionId: ID
      })
      const tabs = [
        makeAgentSessionTabView({
          slotId: 'a',
          label: 'claude 2',
          status: 'running',
          cliSessionId: ID
        })
      ]
      const blocked = renderResume({
        sessions: makeAgentSessionsState({
          tabs,
          startDisabledReason: '実行方式を切り替えています'
        })
      })
      expect(blocked.result.current.resumeLast.disabledReason).toBe('実行方式を切り替えています')
      const inUse = renderResume({ sessions: makeAgentSessionsState({ tabs }) })
      expect(inUse.result.current.resumeLast.disabledReason).toBe(agentResumeLastInUse('claude 2'))
    })

    it('resumeLast.onResume は描画をまたいで同じ参照', () => {
      const { result, rerender } = renderResume()
      const first = result.current.resumeLast.onResume
      rerender()
      expect(result.current.resumeLast.onResume).toBe(first)
    })

    it('useAgentLastSession に設定の種類を渡し、押すと「前回」の種類を再開の依頼に載せる', () => {
      // 依頼の種類が「前回」と設定のどちらから来たかを見分けるため、両者を変える(useAgentLastSession は依頼と違う種類の
      // 結果を記録なしにするので実際には起きない組み合わせ。ここでは useAgentLastSession を差し替えている)
      mockUseAgentLastSession.mockReturnValue({
        kind: 'found',
        cliKind: 'claude',
        cliSessionId: ID
      })
      const sessions = makeAgentSessionsState()
      const { result } = renderResume({ appCliKind: 'copilot', sessions })
      expect(mockUseAgentLastSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ cliKind: 'copilot' })
      )
      act(() => result.current.resumeLast.onResume('slot-1'))
      expect(sessions.start).toHaveBeenCalledWith('slot-1', {
        kind: 'resume',
        cliSessionId: ID,
        cliKind: 'claude'
      })
    })

    it('設定が copilot なら、copilot の前回を取りに行き、押すと copilot の種類で再開する', () => {
      mockUseAgentLastSession.mockReturnValue({
        kind: 'found',
        cliKind: 'copilot',
        cliSessionId: ID
      })
      const sessions = makeAgentSessionsState()
      const { result } = renderResume({ appCliKind: 'copilot', sessions })
      expect(mockUseAgentLastSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ cliKind: 'copilot' })
      )
      expect(result.current.resumeLast.disabledReason).toBeNull()
      act(() => result.current.resumeLast.onResume('slot-1'))
      expect(sessions.start).toHaveBeenCalledWith('slot-1', {
        kind: 'resume',
        cliSessionId: ID,
        cliKind: 'copilot'
      })
    })
  })

  describe('このセッションで再開', () => {
    it('履歴の再開の操作は onResumeEntry で、前回の続きからの resumeLast.onResume と名前で区別する', () => {
      const { result } = renderResume()
      expect(Object.keys(result.current).sort()).toEqual([
        'onResumeEntry',
        'resumeActionOf',
        'resumeLast'
      ])
    })

    it('従来のエントリはボタンを出さない(null)、押しても何もしない', () => {
      const sessions = makeAgentSessionsState()
      const { result } = renderResume({ sessions })
      expect(result.current.resumeActionOf(legacyEntry)).toBeNull()
      act(() => result.current.onResumeEntry(legacyEntry))
      expect(sessions.resumeInNewTab).not.toHaveBeenCalled()
    })

    it('押せない理由があれば disabled で理由を返し、押しても新しいタブを足さない', () => {
      const sessions = makeAgentSessionsState()
      const { result } = renderResume({ mode: 'legacy', sessions })
      expect(result.current.resumeActionOf(agentEntry())).toEqual({
        disabled: true,
        reason: AGENT_RESUME_ENTRY_LEGACY_MODE
      })
      act(() => result.current.onResumeEntry(agentEntry()))
      expect(sessions.resumeInNewTab).not.toHaveBeenCalled()
    })

    it('記録したフォルダと違うフォルダを開いていれば、そのフォルダを理由にして押しても新しいタブを足さない', () => {
      const sessions = makeAgentSessionsState()
      const { result } = renderResume({ folderPath: '/other', sessions })
      expect(result.current.resumeActionOf(agentEntry())).toEqual({
        disabled: true,
        reason: agentResumeEntryFolderMismatch(FOLDER)
      })
      act(() => result.current.onResumeEntry(agentEntry()))
      expect(sessions.resumeInNewTab).not.toHaveBeenCalled()
    })

    it('タブが上限(sessions.addDisabledReason)なら、その理由を返す', () => {
      const { result } = renderResume({
        sessions: makeAgentSessionsState({ addDisabledReason: 'タブは 4 つまでです' })
      })
      expect(result.current.resumeActionOf(agentEntry())).toEqual({
        disabled: true,
        reason: 'タブは 4 つまでです'
      })
    })

    it('同じ ID のタブが動いていれば、そのタブの名前を理由にする', () => {
      const tabs = [
        makeAgentSessionTabView({
          slotId: 'a',
          label: 'claude 3',
          status: 'running',
          cliSessionId: OTHER
        })
      ]
      const { result } = renderResume({ sessions: makeAgentSessionsState({ tabs }) })
      expect(result.current.resumeActionOf(agentEntry(OTHER))).toEqual({
        disabled: true,
        reason: agentResumeEntryInUse('claude 3')
      })
    })

    it('押せるときは新しいタブで再開し、足したタブへ移る', () => {
      const sessions = makeAgentSessionsState({
        resumeInNewTab: vi.fn(() => 'slot-new')
      })
      const activateTab = vi.fn()
      const { result } = renderResume({ sessions, activateTab })
      expect(result.current.resumeActionOf(agentEntry())).toEqual({
        disabled: false,
        reason: null
      })
      act(() => result.current.onResumeEntry(agentEntry()))
      expect(sessions.resumeInNewTab).toHaveBeenCalledWith(ID, 'claude')
      expect(activateTab).toHaveBeenCalledWith('slot-new')
    })

    it('タブを足せなかった(null)ときは移らない', () => {
      const activateTab = vi.fn()
      const { result } = renderResume({ activateTab })
      act(() => result.current.onResumeEntry(agentEntry()))
      expect(activateTab).not.toHaveBeenCalled()
    })

    it('知らない種類のエントリは、押されても新しいタブを足さない(この版で起動できる種類が無い)', () => {
      const sessions = makeAgentSessionsState({ resumeInNewTab: vi.fn(() => 'slot-new') })
      const { result, options } = renderResume({ sessions })
      act(() => result.current.onResumeEntry(agentEntryOf('gemini')))
      expect(sessions.resumeInNewTab).not.toHaveBeenCalled()
      expect(options.activateTab).not.toHaveBeenCalled()
    })

    it('設定と同じ種類(copilot)のエントリは押せて、押すとエントリの種類で新しいタブを足す', () => {
      const sessions = makeAgentSessionsState({ resumeInNewTab: vi.fn(() => 'slot-new') })
      const { result, options } = renderResume({ appCliKind: 'copilot', sessions })
      expect(result.current.resumeActionOf(agentEntryOf('copilot'))).toEqual({
        disabled: false,
        reason: null
      })
      act(() => result.current.onResumeEntry(agentEntryOf('copilot')))
      expect(sessions.resumeInNewTab).toHaveBeenCalledExactlyOnceWith(ID, 'copilot')
      expect(options.activateTab).toHaveBeenCalledWith('slot-new')
    })

    it('設定と違う種類のエントリは、切り替えれば再開できる理由を出し、押しても新しいタブを足さない', () => {
      const sessions = makeAgentSessionsState({ resumeInNewTab: vi.fn(() => 'slot-new') })
      const { result } = renderResume({ appCliKind: 'copilot', sessions })
      expect(result.current.resumeActionOf(agentEntryOf('claude'))).toEqual({
        disabled: true,
        reason: agentResumeEntryCliMismatch('claude', 'copilot')
      })
      act(() => result.current.onResumeEntry(agentEntryOf('claude')))
      expect(sessions.resumeInNewTab).not.toHaveBeenCalled()
    })

    it('知らない種類のエントリは、その種類の名前の理由を出す', () => {
      const { result } = renderResume()
      expect(result.current.resumeActionOf(agentEntryOf('gemini'))).toEqual({
        disabled: true,
        reason: agentResumeEntryUnknownCli('gemini')
      })
    })
  })

  describe('設定の種類が再開に対応していない(能力の表を差し替えた copilot)', () => {
    beforeEach(() => {
      capabilityOverrides.sessionResumeUnsupportedKinds.add('copilot')
    })
    afterEach(() => {
      capabilityOverrides.sessionResumeUnsupportedKinds.clear()
    })

    it('前回の続きからは理由を出し、前回が見つかっていても押しても起動しない', () => {
      mockUseAgentLastSession.mockReturnValue({
        kind: 'found',
        cliKind: 'claude',
        cliSessionId: ID
      })
      const sessions = makeAgentSessionsState()
      const { result } = renderResume({ appCliKind: 'copilot', sessions })
      expect(result.current.resumeLast.disabledReason).toBe(
        agentResumeLastUnsupportedReason('copilot')
      )
      act(() => result.current.resumeLast.onResume('slot-1'))
      expect(sessions.start).not.toHaveBeenCalled()
    })

    it('このセッションで再開は理由を出し、押しても新しいタブを足さない', () => {
      const sessions = makeAgentSessionsState()
      const { result, options } = renderResume({ appCliKind: 'copilot', sessions })
      expect(result.current.resumeActionOf(agentEntry())).toEqual({
        disabled: true,
        reason: agentResumeEntryUnsupportedReason('copilot')
      })
      act(() => result.current.onResumeEntry(agentEntry()))
      expect(sessions.resumeInNewTab).not.toHaveBeenCalled()
      expect(options.activateTab).not.toHaveBeenCalled()
    })
  })
})
