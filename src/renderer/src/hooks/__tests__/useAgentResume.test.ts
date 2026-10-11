import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  agentResumeEntryFolderMismatch,
  agentResumeEntryInUse,
  agentResumeLastInUse
} from '../../lib/agentSessionMessages'

const mockUseAgentLastSession = vi.hoisted(() =>
  vi.fn<(options: unknown) => AgentLastSessionLookup>(() => ({ kind: 'none' }))
)
vi.mock('../useAgentLastSession', () => ({ useAgentLastSession: mockUseAgentLastSession }))

import { useAgentResume } from '../useAgentResume'
import type { AgentResumeState, UseAgentResumeOptions } from '../useAgentResume'

const ID = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-9222-222222222222'
const FOLDER = '/work/project'

const agentEntry = (claudeSessionId = ID): HistoryEntry => ({
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
  agent: { claudeSessionId, tabLabel: 'claude 1', folderPath: FOLDER }
})

const legacyEntry: HistoryEntry = { ...agentEntry(), status: 'success', agent: null }

function renderResume(overrides: Partial<UseAgentResumeOptions> = {}): {
  options: UseAgentResumeOptions
} & RenderHookResult<AgentResumeState, unknown> {
  const options: UseAgentResumeOptions = {
    folderPath: FOLDER,
    mode: 'agent-cli',
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
        makeAgentSessionTabView({ slotId: 'a', status: 'running', claudeSessionId: ID }),
        makeAgentSessionTabView({ slotId: 'b', status: 'none' })
      ]
      renderResume({ mode: 'legacy', sessions: makeAgentSessionsState({ tabs }) })
      expect(mockUseAgentLastSession).toHaveBeenLastCalledWith({
        folderPath: FOLDER,
        enabled: false,
        refreshKey: '0'
      })
    })

    it('実行中のタブの ID の並びが変わっても(終了・タブを閉じた)、起動の確定の回数が同じなら取り直しの契機を変えない(main の記録は起動の確定でしか変わらない)', () => {
      const options: UseAgentResumeOptions = {
        folderPath: FOLDER,
        mode: 'agent-cli',
        sessions: makeAgentSessionsState({
          tabs: [makeAgentSessionTabView({ slotId: 'a', status: 'running', claudeSessionId: ID })],
          startConfirmedCount: 1
        }),
        activateTab: vi.fn()
      }
      const { rerender } = renderHook(() => useAgentResume(options))
      const before = mockUseAgentLastSession.mock.lastCall?.[0] as { refreshKey: string }
      options.sessions = makeAgentSessionsState({
        tabs: [makeAgentSessionTabView({ slotId: 'a', status: 'exited', claudeSessionId: null })],
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
      mockUseAgentLastSession.mockReturnValue({ kind: 'found', claudeSessionId: ID })
      const sessions = makeAgentSessionsState()
      const { result } = renderResume({ sessions })
      expect(result.current.resumeLast.disabledReason).toBeNull()
      act(() => result.current.resumeLast.onResume('slot-1'))
      expect(sessions.start).toHaveBeenCalledWith('slot-1', { kind: 'resume', claudeSessionId: ID })
    })

    it('起動の理由(sessions.startDisabledReason)を優先し、無ければ同じ ID のタブの名前を理由にする', () => {
      mockUseAgentLastSession.mockReturnValue({ kind: 'found', claudeSessionId: ID })
      const tabs = [
        makeAgentSessionTabView({
          slotId: 'a',
          label: 'claude 2',
          status: 'running',
          claudeSessionId: ID
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
          claudeSessionId: OTHER
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
      expect(sessions.resumeInNewTab).toHaveBeenCalledWith(ID)
      expect(activateTab).toHaveBeenCalledWith('slot-new')
    })

    it('タブを足せなかった(null)ときは移らない', () => {
      const activateTab = vi.fn()
      const { result } = renderResume({ activateTab })
      act(() => result.current.onResumeEntry(agentEntry()))
      expect(activateTab).not.toHaveBeenCalled()
    })
  })
})
