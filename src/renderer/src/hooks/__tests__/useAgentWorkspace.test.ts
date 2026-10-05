import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import type { RenderHookResult } from '@testing-library/react'
import type { PromptExecutionMode } from '@shared/types'
import { makeAgentSessionState } from '../../__tests__/makeAgentSessionState'

const mockUseExecutionMode = vi.hoisted(() =>
  vi.fn(() => ({
    mode: 'legacy' as PromptExecutionMode | null,
    saveError: null as string | null,
    changeMode: vi.fn<(mode: PromptExecutionMode) => Promise<boolean>>(async () => true)
  }))
)
const mockUseAgentSession = vi.hoisted(() => vi.fn())
const mockUseAgentPromptSender = vi.hoisted(() => vi.fn())
vi.mock('../useExecutionMode', () => ({ useExecutionMode: mockUseExecutionMode }))
vi.mock('../useAgentSession', () => ({ useAgentSession: mockUseAgentSession }))
vi.mock('../useAgentPromptSender', () => ({ useAgentPromptSender: mockUseAgentPromptSender }))
vi.mock('../../lib/xtermFactory', async () => {
  const { makeFakeController } = await import('../../__tests__/makeFakeAgentTerminal')
  const controller = makeFakeController()
  return { getAgentTerminalController: () => controller }
})

import { useAgentWorkspace } from '../useAgentWorkspace'
import type { AgentWorkspaceState, UseAgentWorkspaceOptions } from '../useAgentWorkspace'
import type { AgentPromptSenderState } from '../useAgentPromptSender'
import { getAgentTerminalController } from '../../lib/xtermFactory'
import { RUN_DISABLED_SENDING } from '../../lib/agentSendMessages'

const defaultUseExecutionMode = mockUseExecutionMode.getMockImplementation()!

const makeSender = (overrides: Partial<AgentPromptSenderState> = {}): AgentPromptSenderState => ({
  isSending: false,
  error: null,
  notice: null,
  send: vi.fn<AgentPromptSenderState['send']>(async () => undefined),
  ...overrides
})

const MODE_CHANGE_CONFIRM =
  '従来の方式に切り替えると、実行中のエージェントを終了します。続けますか？'
const LOCKED_WHILE_EXECUTING = '従来の方式で実行している間は、実行方式を切り替えられません'

// window.confirm を差し替えるのは「既定は window.confirm」を確かめるテストだけ。ほかは onConfirm に偽物を渡す
let windowConfirmSpy: MockInstance<typeof window.confirm> | null = null
let consoleErrorSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  vi.clearAllMocks()
  mockUseExecutionMode.mockImplementation(defaultUseExecutionMode)
  mockUseAgentSession.mockReturnValue(makeAgentSessionState())
  mockUseAgentPromptSender.mockReturnValue(makeSender())
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
    it('useAgentSession に開いているフォルダ・文書ごとの controller・エージェント CLI 方式かを渡す', () => {
      setMode('agent-cli')
      renderHook(() => useAgentWorkspace({ folderPath: '/p', isExecuting: false }))
      expect(mockUseAgentSession).toHaveBeenLastCalledWith({
        folderPath: '/p',
        controller: getAgentTerminalController(),
        enabled: true
      })
    })

    it('従来の方式では useAgentSession を無効にする', () => {
      renderHook(() => useAgentWorkspace({ folderPath: null, isExecuting: false }))
      expect(mockUseAgentSession).toHaveBeenLastCalledWith(
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

    it('ターミナルのパネルに controller・セッション・レイアウトを渡す', () => {
      const session = makeAgentSessionState({ status: 'running' })
      mockUseAgentSession.mockReturnValue(session)
      const { result } = renderHook(() =>
        useAgentWorkspace({ folderPath: null, isExecuting: false })
      )
      expect(result.current.agentTerminal.controller).toBe(getAgentTerminalController())
      expect(result.current.agentTerminal.session).toBe(session)
      expect(typeof result.current.agentTerminal.layout.open).toBe('function')
    })

    it('実行ボタンの状態はセッションの状態と従来の方式の実行中から組み立てる', () => {
      setMode('agent-cli')
      mockUseAgentSession.mockReturnValue(makeAgentSessionState({ status: 'running' }))
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
        mockUseAgentSession.mockReturnValue(makeAgentSessionState({ status }))
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
    it('controller と、送信の後にパネルを開く onSettled を渡し、sendToAgent は sender の send そのもの', () => {
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      const { result } = renderWorkspace()
      expect(mockUseAgentPromptSender).toHaveBeenLastCalledWith({
        controller: getAgentTerminalController(),
        onSettled: result.current.agentTerminal.layout.open
      })
      expect(result.current.sendToAgent).toBe(sender.send)
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
      mockUseAgentSession.mockReturnValue(makeAgentSessionState({ status: 'running' }))
      mockUseAgentPromptSender.mockReturnValue(makeSender({ isSending: true }))
      const { result } = renderWorkspace()
      expect(result.current.promptRun.isRunDisabled).toBe(true)
      expect(result.current.promptRun.runDisabledReason).toBe(RUN_DISABLED_SENDING)
    })

    it('送信の失敗と成功の通知を promptRun.agentSend に渡す', () => {
      setMode('agent-cli')
      mockUseAgentSession.mockReturnValue(makeAgentSessionState({ status: 'running' }))
      const notice = { id: 1, text: '送信しました' }
      mockUseAgentPromptSender.mockReturnValue(makeSender({ error: 'e', notice }))
      const { result } = renderWorkspace()
      expect(result.current.promptRun.agentSend).toEqual({ error: 'e', notice })
    })
  })

  describe('confirmStopAgent', () => {
    it.each(['none', 'exited'] as const)('セッションが %s なら確認せずに true', (status) => {
      mockUseAgentSession.mockReturnValue(makeAgentSessionState({ status }))
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
    ] as const)('セッションが %s なら確認の答え(%s)を返す', (status, answer) => {
      mockUseAgentSession.mockReturnValue(makeAgentSessionState({ status }))
      const onConfirm = vi.fn(() => answer)
      const { result } = renderWorkspace({ onConfirm })
      expect(result.current.confirmStopAgent('msg')).toBe(answer)
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith('msg')
    })

    it('onConfirm を省略したら window.confirm で確かめる', () => {
      mockUseAgentSession.mockReturnValue(makeAgentSessionState({ status: 'running' }))
      windowConfirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const { result } = renderWorkspace()
      expect(result.current.confirmStopAgent('msg')).toBe(false)
      expect(windowConfirmSpy).toHaveBeenCalledExactlyOnceWith('msg')
    })
  })

  describe('実行方式の切り替え(executionModePanel.onSelect)', () => {
    it('動いているセッションがあれば確認し、OK なら停止を待ってから保存する', async () => {
      const changeMode = setMode('agent-cli')
      const order: string[] = []
      const session = makeAgentSessionState({
        status: 'running',
        stop: vi.fn(async () => {
          // 停止の完了(プロセスの終了の待ち)は非同期
          await Promise.resolve()
          order.push('stopped')
        })
      })
      changeMode.mockImplementation(async () => {
        order.push('save')
        return true
      })
      mockUseAgentSession.mockReturnValue(session)
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      await select(result, 'legacy')
      await waitFor(() => expect(changeMode).toHaveBeenCalledWith('legacy'))
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(MODE_CHANGE_CONFIRM)
      expect(order).toEqual(['stopped', 'save'])
    })

    it('onConfirm を省略したら、従来の方式への切り替えの確認も window.confirm で行う', async () => {
      const changeMode = setMode('agent-cli')
      const session = makeAgentSessionState({ status: 'running' })
      mockUseAgentSession.mockReturnValue(session)
      windowConfirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const { result } = renderWorkspace()
      await select(result, 'legacy')
      expect(windowConfirmSpy).toHaveBeenCalledExactlyOnceWith(MODE_CHANGE_CONFIRM)
      expect(session.stop).not.toHaveBeenCalled()
      expect(changeMode).not.toHaveBeenCalled()
    })

    it('確認でキャンセルしたら止めず、保存もせず、ロックを戻す', async () => {
      const changeMode = setMode('agent-cli')
      const session = makeAgentSessionState({ status: 'running' })
      mockUseAgentSession.mockReturnValue(session)
      const onConfirm = vi.fn(() => false)
      const { result } = renderWorkspace({ onConfirm })
      await select(result, 'legacy')
      await waitFor(() => expect(result.current.executionModePanel.isLocked).toBe(false))
      expect(onConfirm).toHaveBeenCalledOnce()
      expect(session.stop).not.toHaveBeenCalled()
      expect(changeMode).not.toHaveBeenCalled()
    })

    it('セッションが動いていなければ確認せずに保存する', async () => {
      const changeMode = setMode('agent-cli')
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      await select(result, 'legacy')
      await waitFor(() => expect(changeMode).toHaveBeenCalledWith('legacy'))
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('エージェント CLI 方式への切り替えは確認しない', async () => {
      const changeMode = setMode('legacy')
      mockUseAgentSession.mockReturnValue(makeAgentSessionState({ status: 'running' }))
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
      mockUseAgentSession.mockReturnValue(makeAgentSessionState({ status: 'starting' }))
      // 確認で OK を返しても切り替えない(起動中の判定で止まることを確かめる)
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      expect(result.current.executionModePanel.isLocked).toBe(true)
      expect(result.current.executionModePanel.lockedReason).toBeNull()
      await select(result, 'legacy')
      expect(onConfirm).not.toHaveBeenCalled()
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
      const session = makeAgentSessionState({
        status: 'running',
        stop: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              finishStop = resolve
            })
        )
      })
      mockUseAgentSession.mockReturnValue(session)
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
      expect(session.stop).toHaveBeenCalledOnce()
      expect(changeMode).not.toHaveBeenCalled()
      await act(async () => {
        finishStop()
      })
      await waitFor(() => expect(result.current.executionModePanel.isLocked).toBe(false))
      expect(changeMode).toHaveBeenCalledOnce()
    })

    // changeMode は失敗を false で返し、stop は reject しない(Task 19)ので本来は投げない。投げても選択肢を押せないまま
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
})
