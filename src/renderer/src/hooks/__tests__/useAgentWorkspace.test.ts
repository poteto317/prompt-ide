import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import type { RenderHookResult } from '@testing-library/react'
import type { PromptExecutionMode } from '@shared/types'
import {
  makeAgentSessionsState,
  makeAgentSessionTabView
} from '../../__tests__/makeAgentSessionsState'

const mockUseExecutionMode = vi.hoisted(() =>
  vi.fn(() => ({
    mode: 'legacy' as PromptExecutionMode | null,
    saveError: null as string | null,
    changeMode: vi.fn<(mode: PromptExecutionMode) => Promise<boolean>>(async () => true)
  }))
)
const mockUseAgentSessions = vi.hoisted(() => vi.fn())
const mockUseAgentPromptSender = vi.hoisted(() => vi.fn())
const mockUseAgentActivity = vi.hoisted(() => vi.fn())
vi.mock('../useExecutionMode', () => ({ useExecutionMode: mockUseExecutionMode }))
vi.mock('../useAgentSessions', () => ({ useAgentSessions: mockUseAgentSessions }))
vi.mock('../useAgentPromptSender', () => ({ useAgentPromptSender: mockUseAgentPromptSender }))
vi.mock('../useAgentActivity', () => ({ useAgentActivity: mockUseAgentActivity }))
vi.mock('../../lib/xtermFactory', async () => {
  const { makeFakeAgentSessionTabs } = await import('../../__tests__/makeFakeAgentSessionTabs')
  const tabs = makeFakeAgentSessionTabs()
  return { getAgentSessionTabs: () => tabs }
})

import { useAgentWorkspace } from '../useAgentWorkspace'
import type { AgentWorkspaceState, UseAgentWorkspaceOptions } from '../useAgentWorkspace'
import type { AgentPromptSenderState } from '../useAgentPromptSender'
import type { AgentSessionTabView } from '../useAgentSessions'
import { getAgentSessionTabs } from '../../lib/xtermFactory'
import { RUN_DISABLED_CLOSING, RUN_DISABLED_SENDING } from '../../lib/agentSendMessages'
import { AGENT_START_DISABLED_SWITCHING_MODE } from '../../lib/agentSessionMessages'

const defaultUseExecutionMode = mockUseExecutionMode.getMockImplementation()!

const makeSender = (overrides: Partial<AgentPromptSenderState> = {}): AgentPromptSenderState => ({
  isSending: false,
  error: null,
  notice: null,
  sendingSlotId: null,
  send: vi.fn<AgentPromptSenderState['send']>(async () => undefined),
  ...overrides
})

// 選択中のタブ(タブ 1)は未起動で、選択していないタブ 2 だけが status の状態
const otherTabIs = (
  status: AgentSessionTabView['status'],
  overrides: Parameters<typeof makeAgentSessionsState>[0] = {}
): ReturnType<typeof makeAgentSessionsState> => {
  const tab1 = makeAgentSessionTabView()
  const tab2 = makeAgentSessionTabView({ slotId: 'slot-2', label: 'claude 2', status })
  return makeAgentSessionsState({ tabs: [tab1, tab2], selected: tab1, ...overrides })
}

const MODE_CHANGE_CONFIRM =
  '従来の方式に切り替えると、実行中のエージェントを終了します。続けますか？'
const LOCKED_WHILE_EXECUTING = '従来の方式で実行している間は、実行方式を切り替えられません'

// window.confirm を差し替えるのは「既定は window.confirm」を確かめるテストだけ。ほかは onConfirm に偽物を渡す
let windowConfirmSpy: MockInstance<typeof window.confirm> | null = null
let consoleErrorSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  vi.clearAllMocks()
  mockUseExecutionMode.mockImplementation(defaultUseExecutionMode)
  mockUseAgentSessions.mockReturnValue(makeAgentSessionsState())
  mockUseAgentPromptSender.mockReturnValue(makeSender())
  mockUseAgentActivity.mockReturnValue(new Map())
  windowConfirmSpy = null
  consoleErrorSpy = null
})

afterEach(() => {
  windowConfirmSpy?.mockRestore()
  consoleErrorSpy?.mockRestore()
})

type Rendered = RenderHookResult<AgentWorkspaceState, unknown>

const renderWorkspace = (options: Partial<UseAgentWorkspaceOptions> = {}): Rendered =>
  renderHook(() => useAgentWorkspace({ folderPath: null, isExecuting: false, ...options }))

// 実行方式の項目の「選ぶ」(Promise を返さない)。切り替えの手順は非同期なので、終わりは waitFor で待つ
const select = async (result: Rendered['result'], mode: PromptExecutionMode): Promise<void> => {
  await act(async () => {
    result.current.executionModePanel.onSelect(mode)
  })
}

const setMode = (
  mode: PromptExecutionMode | null,
  changeMode = vi.fn<(mode: PromptExecutionMode) => Promise<boolean>>(async () => true)
): typeof changeMode => {
  mockUseExecutionMode.mockReturnValue({ mode, saveError: null, changeMode })
  return changeMode
}

describe('useAgentWorkspace', () => {
  describe('組み立て', () => {
    it('useAgentSessions に開いているフォルダ・文書ごとのタブの置き場・エージェント CLI 方式か・確認を渡す', () => {
      setMode('agent-cli')
      const onConfirm = vi.fn(() => true)
      renderHook(() => useAgentWorkspace({ folderPath: '/p', isExecuting: false, onConfirm }))
      expect(mockUseAgentSessions).toHaveBeenLastCalledWith({
        folderPath: '/p',
        tabs: getAgentSessionTabs(),
        enabled: true,
        startBlockedReason: null,
        onConfirm
      })
    })

    it('従来の方式では useAgentSessions を無効にする', () => {
      renderHook(() => useAgentWorkspace({ folderPath: null, isExecuting: false }))
      expect(mockUseAgentSessions).toHaveBeenLastCalledWith(
        expect.objectContaining({ folderPath: null, enabled: false })
      )
    })

    it.each([
      [null, 'none'],
      ['legacy', 'output'],
      ['agent-cli', 'agent-terminal']
    ] as const)('実行方式 %s では下部のパネルが %s', (mode, panel) => {
      setMode(mode)
      const { result } = renderHook(() =>
        useAgentWorkspace({ folderPath: null, isExecuting: false })
      )
      expect(result.current.bottomPanel).toBe(panel)
      expect(result.current.executionModePanel.mode).toBe(mode)
    })

    it('ターミナルのパネルにセッション・レイアウト・送信中のタブを渡す', () => {
      const sessions = makeAgentSessionsState({ selected: { status: 'running' } })
      mockUseAgentSessions.mockReturnValue(sessions)
      mockUseAgentPromptSender.mockReturnValue(makeSender({ sendingSlotId: 'slot-1' }))
      const { result } = renderHook(() =>
        useAgentWorkspace({ folderPath: null, isExecuting: false })
      )
      expect(result.current.agentTerminal.sessions).toBe(sessions)
      expect(result.current.agentTerminal.sendingSlotId).toBe('slot-1')
      expect(typeof result.current.agentTerminal.layout.open).toBe('function')
    })

    it('タブごとの活動(useAgentActivity の結果)を agentTerminal.activities に渡す', () => {
      const tab1 = makeAgentSessionTabView({ status: 'running' })
      const tab2 = makeAgentSessionTabView({ slotId: 'slot-2', label: 'claude 2', status: 'none' })
      const sessions = makeAgentSessionsState({ tabs: [tab1, tab2], selected: tab1 })
      mockUseAgentSessions.mockReturnValue(sessions)
      const activities = new Map([['slot-1', 'permission' as const]])
      mockUseAgentActivity.mockReturnValue(activities)
      const { result } = renderHook(() =>
        useAgentWorkspace({ folderPath: null, isExecuting: false })
      )
      expect(result.current.agentTerminal.activities).toBe(activities)
      // タブの一覧(useAgentSessions が状態の変わったときだけ作り直す)を写し直さずにそのまま渡す
      expect(mockUseAgentActivity.mock.lastCall?.[0].tabs).toBe(sessions.tabs)
    })

    it('実行ボタンの状態は選択中のタブで決まる(タブ 1 が running でも、選択中のタブ 2 が未起動なら押せない)', () => {
      setMode('agent-cli')
      const tab1 = makeAgentSessionTabView({ status: 'running' })
      const tab2 = makeAgentSessionTabView({ slotId: 'slot-2', label: 'claude 2' })
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ tabs: [tab1, tab2], selected: tab2 })
      )
      const { result } = renderWorkspace()
      expect(result.current.promptRun.isRunDisabled).toBe(true)
    })

    it('実行ボタンの状態はセッションの状態と従来の方式の実行中から組み立てる', () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const { result } = renderHook(() =>
        useAgentWorkspace({ folderPath: null, isExecuting: false })
      )
      expect(result.current.promptRun.isRunDisabled).toBe(false)
      expect(result.current.promptRun.showToolSelector).toBe(false)
    })

    it.each([
      ['none', true],
      ['starting', true],
      ['running', false],
      ['exited', true]
    ] as const)(
      'エージェント CLI 方式では、セッションの状態(%s)を実行ボタンの状態に渡す(押せないか: %s)',
      (status, disabled) => {
        setMode('agent-cli')
        mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ selected: { status } }))
        const { result } = renderWorkspace()
        expect(result.current.promptRun.isRunDisabled).toBe(disabled)
      }
    )

    it.each([true, false])(
      '従来の方式では、実行中(%s)を実行ボタン・再実行の状態に渡す',
      (isExecuting) => {
        setMode('legacy')
        const { result } = renderWorkspace({ isExecuting })
        expect(result.current.promptRun.isRunDisabled).toBe(isExecuting)
        expect(result.current.promptRun.isRerunDisabled).toBe(isExecuting)
      }
    )

    it('保存の失敗をそのまま返す', () => {
      mockUseExecutionMode.mockReturnValue({
        mode: 'legacy',
        saveError: '保存できませんでした',
        changeMode: vi.fn(async () => true)
      })
      const { result } = renderHook(() =>
        useAgentWorkspace({ folderPath: null, isExecuting: false })
      )
      expect(result.current.executionModePanel.saveError).toBe('保存できませんでした')
    })
  })

  describe('エージェントへの送信', () => {
    it('送信の後にパネルを開く onSettled を渡す', () => {
      const { result } = renderWorkspace()
      expect(mockUseAgentPromptSender).toHaveBeenLastCalledWith({
        onSettled: result.current.agentTerminal.layout.open,
        beforeSend: undefined
      })
    })

    it('sendToAgent は押した時点の選択中のタブを送り先にする。送信中にタブを切り替えても送り先は変わらない', async () => {
      let finishSend: () => void = () => undefined
      const sender = makeSender({
        send: vi.fn<AgentPromptSenderState['send']>(
          () => new Promise((resolve) => (finishSend = () => resolve(undefined)))
        )
      })
      mockUseAgentPromptSender.mockReturnValue(sender)
      const tab1 = makeAgentSessionTabView({ status: 'running' })
      const tab2 = makeAgentSessionTabView({
        slotId: 'slot-2',
        label: 'claude 2',
        status: 'running'
      })
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ tabs: [tab1, tab2], selected: tab2 })
      )
      const { result, rerender } = renderWorkspace()
      let sending: Promise<unknown> = Promise.resolve()
      act(() => {
        sending = result.current.sendToAgent('hello')
      })
      // 送信中にタブ 1 へ切り替える
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ tabs: [tab1, tab2], selected: tab1 })
      )
      rerender()
      await act(async () => {
        finishSend()
        await sending
      })
      expect(sender.send).toHaveBeenCalledExactlyOnceWith('hello', {
        slotId: 'slot-2',
        controller: tab2.controller
      })
    })

    // 省略可能な引数のため、渡し忘れを型で検知できない(パターン 155)
    it('sendToAgent は、選択中のタブと sender の send が変わらなければ描画をまたいで同じ参照', () => {
      const { result, rerender } = renderWorkspace()
      const first = result.current.sendToAgent
      rerender()
      expect(result.current.sendToAgent).toBe(first)
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { slotId: 'slot-2', label: 'claude 2' } })
      )
      rerender()
      expect(result.current.sendToAgent).not.toBe(first)
    })

    it('送信の前の準備(beforeAgentSend)を sender の beforeSend へそのまま渡す', () => {
      const beforeAgentSend = vi.fn(async () => undefined)
      renderWorkspace({ beforeAgentSend })
      expect(mockUseAgentPromptSender.mock.lastCall![0]).toMatchObject({
        beforeSend: beforeAgentSend
      })
    })

    it('送信の後(onSettled)にターミナルのパネルが開く', () => {
      const { result } = renderWorkspace()
      const { onSettled } = mockUseAgentPromptSender.mock.lastCall![0] as {
        onSettled: () => void
      }
      act(() => result.current.agentTerminal.layout.toggleOpen())
      expect(result.current.agentTerminal.layout.isOpen).toBe(false)
      act(() => onSettled())
      expect(result.current.agentTerminal.layout.isOpen).toBe(true)
    })

    it('送信中は実行ボタンを押せず、理由は送信中', () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      mockUseAgentPromptSender.mockReturnValue(makeSender({ isSending: true }))
      const { result } = renderWorkspace()
      expect(result.current.promptRun.isRunDisabled).toBe(true)
      expect(result.current.promptRun.runDisabledReason).toBe(RUN_DISABLED_SENDING)
    })

    it('選択中のタブが閉じる途中なら、running でも実行ボタンを押せず、理由は閉じる途中', () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running', isClosing: true } })
      )
      const { result } = renderWorkspace()
      expect(result.current.promptRun.isRunDisabled).toBe(true)
      expect(result.current.promptRun.runDisabledReason).toBe(RUN_DISABLED_CLOSING)
    })

    it('送信の失敗と成功の通知を promptRun.agentSend に渡す', () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const notice = { id: 1, text: '送信しました' }
      mockUseAgentPromptSender.mockReturnValue(makeSender({ error: 'e', notice }))
      const { result } = renderWorkspace()
      expect(result.current.promptRun.agentSend).toEqual({ error: 'e', notice })
    })
  })

  describe('confirmStopAgent', () => {
    it.each(['none', 'exited'] as const)('どのタブも %s なら確認せずに true', (status) => {
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ selected: { status } }))
      const onConfirm = vi.fn(() => false)
      const { result } = renderWorkspace({ onConfirm })
      expect(result.current.confirmStopAgent('msg')).toBe(true)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it.each([
      ['running', true],
      ['running', false],
      ['starting', true],
      ['starting', false]
    ] as const)('選択中のタブが %s なら確認の答え(%s)を返す', (status, answer) => {
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ selected: { status } }))
      const onConfirm = vi.fn(() => answer)
      const { result } = renderWorkspace({ onConfirm })
      expect(result.current.confirmStopAgent('msg')).toBe(answer)
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith('msg')
    })

    it('onConfirm を省略したら window.confirm で確かめる', () => {
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      windowConfirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const { result } = renderWorkspace()
      expect(result.current.confirmStopAgent('msg')).toBe(false)
      expect(windowConfirmSpy).toHaveBeenCalledExactlyOnceWith('msg')
    })

    it.each(['running', 'starting'] as const)('選択していないタブが %s でも確認する', (status) => {
      mockUseAgentSessions.mockReturnValue(otherTabIs(status))
      const onConfirm = vi.fn(() => false)
      const { result } = renderWorkspace({ onConfirm })
      expect(result.current.confirmStopAgent('msg')).toBe(false)
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith('msg')
    })
  })

  describe('実行方式の切り替え(executionModePanel.onSelect)', () => {
    it('動いているセッションがあれば確認し、OK なら停止を待ってから保存する', async () => {
      const changeMode = setMode('agent-cli')
      const order: string[] = []
      const session = makeAgentSessionsState({
        selected: { status: 'running' },
        stopAll: vi.fn(async () => {
          // 停止の完了(プロセスの終了の待ち)は非同期
          await Promise.resolve()
          order.push('stopped')
          return true
        })
      })
      changeMode.mockImplementation(async () => {
        order.push('save')
        return true
      })
      mockUseAgentSessions.mockReturnValue(session)
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      await select(result, 'legacy')
      await waitFor(() => expect(changeMode).toHaveBeenCalledWith('legacy'))
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(MODE_CHANGE_CONFIRM)
      expect(order).toEqual(['stopped', 'save'])
    })

    it('onConfirm を省略したら、従来の方式への切り替えの確認も window.confirm で行う', async () => {
      const changeMode = setMode('agent-cli')
      const session = makeAgentSessionsState({ selected: { status: 'running' } })
      mockUseAgentSessions.mockReturnValue(session)
      windowConfirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const { result } = renderWorkspace()
      await select(result, 'legacy')
      expect(windowConfirmSpy).toHaveBeenCalledExactlyOnceWith(MODE_CHANGE_CONFIRM)
      expect(session.stopAll).not.toHaveBeenCalled()
      expect(changeMode).not.toHaveBeenCalled()
    })

    it('どれかのタブの停止に失敗したら保存せず(方式を変えず)、ロックを戻す', async () => {
      const changeMode = setMode('agent-cli')
      const sessions = makeAgentSessionsState({
        selected: { status: 'running' },
        stopAll: vi.fn(async () => false)
      })
      mockUseAgentSessions.mockReturnValue(sessions)
      const { result } = renderWorkspace({ onConfirm: () => true })
      await select(result, 'legacy')
      await waitFor(() => expect(result.current.executionModePanel.isLocked).toBe(false))
      expect(sessions.stopAll).toHaveBeenCalledOnce()
      expect(changeMode).not.toHaveBeenCalled()
    })

    it('確認でキャンセルしたら止めず、保存もせず、ロックを戻す', async () => {
      const changeMode = setMode('agent-cli')
      const session = makeAgentSessionsState({ selected: { status: 'running' } })
      mockUseAgentSessions.mockReturnValue(session)
      const onConfirm = vi.fn(() => false)
      const { result } = renderWorkspace({ onConfirm })
      await select(result, 'legacy')
      await waitFor(() => expect(result.current.executionModePanel.isLocked).toBe(false))
      expect(onConfirm).toHaveBeenCalledOnce()
      expect(session.stopAll).not.toHaveBeenCalled()
      expect(changeMode).not.toHaveBeenCalled()
    })

    it('どのタブも動いていなければ確認せずに保存する', async () => {
      const changeMode = setMode('agent-cli')
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      await select(result, 'legacy')
      await waitFor(() => expect(changeMode).toHaveBeenCalledWith('legacy'))
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('エージェント CLI 方式への切り替えは確認しない', async () => {
      const changeMode = setMode('legacy')
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      await select(result, 'agent-cli')
      await waitFor(() => expect(changeMode).toHaveBeenCalledWith('agent-cli'))
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('今と同じ方式を選んでも何もしない', async () => {
      const changeMode = setMode('legacy')
      const { result } = renderWorkspace()
      await select(result, 'legacy')
      expect(changeMode).not.toHaveBeenCalled()
      expect(result.current.executionModePanel.isLocked).toBe(false)
    })

    it('従来の方式の実行中は切り替えず、選択肢も押せず理由を出す', async () => {
      const changeMode = setMode('legacy')
      const { result } = renderWorkspace({ isExecuting: true })
      expect(result.current.executionModePanel.isLocked).toBe(true)
      expect(result.current.executionModePanel.lockedReason).toBe(LOCKED_WHILE_EXECUTING)
      await select(result, 'agent-cli')
      expect(changeMode).not.toHaveBeenCalled()
    })

    it('起動中は切り替えず、選択肢も押せない(理由は出さない)', async () => {
      const changeMode = setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'starting' } })
      )
      // 確認で OK を返しても切り替えない(起動中の判定で止まることを確かめる)
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      expect(result.current.executionModePanel.isLocked).toBe(true)
      expect(result.current.executionModePanel.lockedReason).toBeNull()
      await select(result, 'legacy')
      expect(onConfirm).not.toHaveBeenCalled()
      expect(changeMode).not.toHaveBeenCalled()
    })

    it('選択していないタブだけが動いていても確認し、すべてのタブの停止を待ってから保存する', async () => {
      const changeMode = setMode('agent-cli')
      const sessions = otherTabIs('running')
      mockUseAgentSessions.mockReturnValue(sessions)
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      await select(result, 'legacy')
      await waitFor(() => expect(changeMode).toHaveBeenCalledWith('legacy'))
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(MODE_CHANGE_CONFIRM)
      expect(sessions.stopAll).toHaveBeenCalledOnce()
    })

    it('選択していないタブが起動中でも、切り替えず選択肢を押せない', async () => {
      const changeMode = setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(otherTabIs('starting'))
      const { result } = renderWorkspace({ onConfirm: () => true })
      expect(result.current.executionModePanel.isLocked).toBe(true)
      await select(result, 'legacy')
      expect(changeMode).not.toHaveBeenCalled()
    })

    it('読み込み中は選択肢を押せない', () => {
      setMode(null)
      const { result } = renderWorkspace()
      expect(result.current.executionModePanel.isLocked).toBe(true)
    })

    it('停止を待つ間は選択肢を押せず、同じ描画の中でもう一度選んでも確認・停止・保存を重ねない', async () => {
      const changeMode = setMode('agent-cli')
      let finishStop: () => void = () => undefined
      const session = makeAgentSessionsState({
        selected: { status: 'running' },
        stopAll: vi.fn(
          () =>
            new Promise<boolean>((resolve) => {
              finishStop = () => resolve(true)
            })
        )
      })
      mockUseAgentSessions.mockReturnValue(session)
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      // 同じ描画の関数で 2 回呼ぶ(ref による再入防止)
      const { onSelect } = result.current.executionModePanel
      act(() => {
        onSelect('legacy')
        onSelect('legacy')
      })
      expect(result.current.executionModePanel.isLocked).toBe(true)
      // 次の描画の関数でもう一度選んでも重ねない
      await select(result, 'legacy')
      expect(onConfirm).toHaveBeenCalledOnce()
      expect(session.stopAll).toHaveBeenCalledOnce()
      expect(changeMode).not.toHaveBeenCalled()
      await act(async () => {
        finishStop()
      })
      await waitFor(() => expect(result.current.executionModePanel.isLocked).toBe(false))
      expect(changeMode).toHaveBeenCalledOnce()
    })

    it('停止を待つ間は、起動・+ を受け付けない理由を useAgentSessions に渡し、終わったら戻す', async () => {
      setMode('agent-cli')
      let finishStop: () => void = () => undefined
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({
          selected: { status: 'running' },
          stopAll: vi.fn(
            () =>
              new Promise<boolean>((resolve) => {
                finishStop = () => resolve(true)
              })
          )
        })
      )
      const { result } = renderWorkspace({ onConfirm: () => true })
      expect(mockUseAgentSessions).toHaveBeenLastCalledWith(
        expect.objectContaining({ startBlockedReason: null })
      )
      await select(result, 'legacy')
      expect(mockUseAgentSessions).toHaveBeenLastCalledWith(
        expect.objectContaining({ startBlockedReason: AGENT_START_DISABLED_SWITCHING_MODE })
      )
      await act(async () => {
        finishStop()
      })
      await waitFor(() =>
        expect(mockUseAgentSessions).toHaveBeenLastCalledWith(
          expect.objectContaining({ startBlockedReason: null })
        )
      )
    })

    // changeMode は失敗を false で返し、stopAll は reject しないので本来は投げない。投げても選択肢を押せないまま
    // 残さず、Promise は捨てる側(onSelect)で記録して握る
    it('保存が投げてもロックを戻し、例外は記録して呼び出し元へ投げない', async () => {
      const changeMode = setMode('legacy')
      const boom = new Error('boom')
      changeMode.mockRejectedValueOnce(boom)
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { result } = renderWorkspace()
      await select(result, 'agent-cli')
      await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(String), boom))
      expect(result.current.executionModePanel.isLocked).toBe(false)
      // 再入防止の ref も戻っている(もう一度選べる)
      await select(result, 'agent-cli')
      await waitFor(() => expect(changeMode).toHaveBeenCalledTimes(2))
    })
  })

  describe('ステータスバーのまとめ(statusBarAgent)', () => {
    // useAgentStatusBar への配線(方式・活動・タブの選択・パネルの開き)だけを確かめる。数え方・強調の判定・当たるタブが無いとき・
    // フォーカスの回数などの細かい振る舞いは useAgentStatusBar.test と agentActivitySummary.test で確かめる(ここで重ねて確かめない)
    // タブ 1(選択中・作業中)・タブ 2(入力待ち)・タブ 3(許可待ち)。selectTab で選択中のタブが変わる(本物と同じく次の描画から)
    const setupThreeTabs = (): AgentSessionTabView[] => {
      const tabs = [1, 2, 3].map((n) =>
        makeAgentSessionTabView({ slotId: `slot-${n}`, label: `claude ${n}`, status: 'running' })
      )
      const sessionsFor = (slotId: string): ReturnType<typeof makeAgentSessionsState> =>
        makeAgentSessionsState({ tabs, selected: { slotId }, selectTab })
      const selectTab = vi.fn((slotId: string) => {
        mockUseAgentSessions.mockReturnValue(sessionsFor(slotId))
      })
      mockUseAgentSessions.mockReturnValue(sessionsFor('slot-1'))
      mockUseAgentActivity.mockReturnValue(
        new Map([
          ['slot-1', 'working'],
          ['slot-2', 'idle'],
          ['slot-3', 'permission']
        ])
      )
      return tabs
    }

    it('従来の方式・読み込み中では null', () => {
      setMode('legacy')
      setupThreeTabs()
      expect(renderWorkspace().result.current.statusBarAgent).toBeNull()
      setMode(null)
      expect(renderWorkspace().result.current.statusBarAgent).toBeNull()
    })

    it('エージェント CLI 方式では、running のタブの活動のまとめと強調の要否を返す', () => {
      setMode('agent-cli')
      setupThreeTabs()
      const agent = renderWorkspace().result.current.statusBarAgent!
      expect(agent.items).toEqual([
        { activity: 'permission', count: 1 },
        { activity: 'working', count: 1 },
        { activity: 'idle', count: 1 }
      ])
      expect(agent.needsAttention).toBe(true)
    })

    it('押すとパネルを開き(最大化は変えない)、許可待ちのタブを選択し、描画の後にそのタブのターミナルへフォーカスを移す', () => {
      setMode('agent-cli')
      const tabs = setupThreeTabs()
      // result.current は renderHook の effect で更新されるため、フォーカスの時点の描画の値は描画の中で控える
      let rendered: AgentWorkspaceState | null = null
      const { result } = renderHook(() => {
        rendered = useAgentWorkspace({ folderPath: null, isExecuting: false })
        return rendered
      })
      act(() => result.current.agentTerminal.layout.toggleOpen())
      expect(result.current.agentTerminal.layout.isOpen).toBe(false)
      // フォーカスの時点で、パネルが開いて選択が移った描画が終わっていること
      const seenAtFocus: { selected: string; isOpen: boolean }[] = []
      vi.mocked(tabs[2].controller.focus).mockImplementation(() => {
        const latest = rendered!
        seenAtFocus.push({
          selected: latest.agentTerminal.sessions.selected.slotId,
          isOpen: latest.agentTerminal.layout.isOpen
        })
      })
      act(() => result.current.statusBarAgent!.onActivate())
      expect(result.current.agentTerminal.layout.isOpen).toBe(true)
      expect(result.current.agentTerminal.layout.isMaximized).toBe(false)
      expect(result.current.agentTerminal.sessions.selectTab).toHaveBeenCalledWith('slot-3')
      expect(seenAtFocus).toEqual([{ selected: 'slot-3', isOpen: true }])
      expect(tabs[0].controller.focus).not.toHaveBeenCalled()
      expect(tabs[1].controller.focus).not.toHaveBeenCalled()
    })

    it('最大化していれば最大化のまま開く', () => {
      setMode('agent-cli')
      setupThreeTabs()
      const { result } = renderWorkspace()
      act(() => result.current.agentTerminal.layout.toggleMaximized())
      act(() => result.current.statusBarAgent!.onActivate())
      expect(result.current.agentTerminal.layout.isOpen).toBe(true)
      expect(result.current.agentTerminal.layout.isMaximized).toBe(true)
    })
  })
})
