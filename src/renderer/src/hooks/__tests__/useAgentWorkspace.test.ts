import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import type { RenderHookResult } from '@testing-library/react'
import type { AgentCliKindSetting, PromptExecutionMode } from '@shared/types'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'
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
const mockUseAgentHooksWorkingReport = vi.hoisted(() => vi.fn())
vi.mock('../useAgentHooksWorkingReport', () => ({
  useAgentHooksWorkingReport: mockUseAgentHooksWorkingReport
}))
const mockUseAgentNotificationSetting = vi.hoisted(() => vi.fn())
vi.mock('../useAgentNotificationSetting', () => ({
  useAgentNotificationSetting: mockUseAgentNotificationSetting
}))
const mockUseAgentSendConfirmSetting = vi.hoisted(() => vi.fn())
// 送信前の確認の設定の既定(読み込み中の扱いがこれに従うことを確かめるテストだけが変える)
const sharedDefaults = vi.hoisted(() => ({ sendConfirmEnabled: true }))
vi.mock('@shared/types', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/types')>()),
  get DEFAULT_AGENT_SEND_CONFIRM_ENABLED() {
    return sharedDefaults.sendConfirmEnabled
  }
}))
vi.mock('../useAgentSendConfirmSetting', () => ({
  useAgentSendConfirmSetting: mockUseAgentSendConfirmSetting
}))
const mockUseAgentCliKind = vi.hoisted(() => vi.fn())
vi.mock('../useAgentCliKind', () => ({ useAgentCliKind: mockUseAgentCliKind }))
vi.mock('../useExecutionMode', () => ({ useExecutionMode: mockUseExecutionMode }))
vi.mock('../useAgentSessions', () => ({ useAgentSessions: mockUseAgentSessions }))
vi.mock('../useAgentPromptSender', () => ({ useAgentPromptSender: mockUseAgentPromptSender }))
vi.mock('../useAgentActivity', () => ({ useAgentActivity: mockUseAgentActivity }))
const mockUseAgentNotifications = vi.hoisted(() => vi.fn<(options: unknown) => string>(() => ''))
vi.mock('../useAgentNotifications', () => ({ useAgentNotifications: mockUseAgentNotifications }))
const mockUseAgentLastSession = vi.hoisted(() =>
  vi.fn<(options: unknown) => AgentLastSessionLookup>(() => ({ kind: 'none' }))
)
vi.mock('../useAgentLastSession', () => ({ useAgentLastSession: mockUseAgentLastSession }))
// 通知の注記が通知の節へ届く配線を確かめるため、能力の表の screenActivity・interrupt を種類ごとに偽にできるようにする
// (今の表ではどの種類も画面を判定し、注記は出ない)。送信に対応しない種類の入口の守りを確かめるため、promptSend も偽にできる
// (段階 2b で copilot も送信に対応した)
const capabilityOverrides = vi.hoisted(
  (): AgentCliCapabilityOverrides => ({
    unsupportedKinds: new Set<AgentCliKind>(),
    promptSendUnsupportedKinds: new Set<AgentCliKind>()
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
vi.mock('../../lib/xtermFactory', async () => {
  const { makeFakeAgentSessionTabs } = await import('../../__tests__/makeFakeAgentSessionTabs')
  const tabs = makeFakeAgentSessionTabs()
  return { getAgentSessionTabs: () => tabs }
})

import { useAgentWorkspace } from '../useAgentWorkspace'
import type { AgentWorkspaceState, UseAgentWorkspaceOptions } from '../useAgentWorkspace'
import type { AgentPromptSenderState } from '../useAgentPromptSender'
import type { AgentPromptSendResult } from '../../lib/agentPromptSend'
import type { AgentSessionTabView } from '../useAgentSessions'
import type { AgentSessionsState } from '../useAgentSessions'
import type { HistoryEntry } from '../../types'
import type { AgentActivity } from '../../lib/agentActivity'
import type { AgentLastSessionLookup } from '../../lib/agentResumeAvailability'
import { getAgentSessionTabs } from '../../lib/xtermFactory'
import {
  AGENT_SENT_NOTICE,
  RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE,
  RERUN_DISABLED_AGENT_MODE,
  RUN_DISABLED_CLOSING,
  RUN_DISABLED_INTERRUPTING,
  RUN_DISABLED_NO_SESSION,
  RUN_DISABLED_SENDING,
  agentPromptSendUnsupportedReason,
  agentSendBlockedByActivityReason
} from '../../lib/agentSendMessages'
import {
  AGENT_START_DISABLED_SWITCHING_CLI_KIND,
  AGENT_START_DISABLED_SWITCHING_MODE,
  agentResumeEntryUnsupportedReason,
  agentResumeLastUnsupportedReason
} from '../../lib/agentSessionMessages'
import { AGENT_CLI_KIND_LOCKED_WHILE_STARTING } from '../../lib/agentCliMessages'
import {
  AGENT_INTERRUPT_DISABLED_COOLDOWN,
  AGENT_INTERRUPT_DISABLED_SEND_CONFIRM,
  AGENT_INTERRUPT_DISABLED_SENDING,
  agentInterruptBlockedByActivityReason,
  agentInterruptSentNotice
} from '../../lib/agentInterruptMessages'
import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'
import { agentScreen } from '../../lib/__tests__/fixtures/agentScreens'
import { copilotScreen } from '../../lib/__tests__/fixtures/copilotScreens'
import { copilotInputScreen } from '../../lib/__tests__/fixtures/copilotInputScreens'
import { buildAgentPasteBytes } from '@shared/agentPasteText'
import type { UseAgentNotificationsOptions } from '../useAgentNotifications'
import { AGENT_INTERRUPT_COOLDOWN_MS } from '../../lib/agentInterrupt'

const defaultUseExecutionMode = mockUseExecutionMode.getMockImplementation()!

const makeSender = (overrides: Partial<AgentPromptSenderState> = {}): AgentPromptSenderState => ({
  isSending: false,
  error: null,
  notice: null,
  sendingSlotId: null,
  send: vi.fn<AgentPromptSenderState['send']>(async () => undefined),
  clearResult: vi.fn<AgentPromptSenderState['clearResult']>(),
  ...overrides
})

// 送信前の確認の設定(既定は本物と同じくオン)
const setSendConfirmEnabled = (
  enabled: boolean | null,
  changeEnabled = vi.fn<(next: boolean) => Promise<boolean>>(async () => true),
  saveError: string | null = null
): typeof changeEnabled => {
  mockUseAgentSendConfirmSetting.mockReturnValue({ enabled, saveError, changeEnabled })
  return changeEnabled
}

// 使う CLI の設定(既定は claude を読み込み済み)
const setCliKind = (
  kind: AgentCliKind | null,
  changeKind = vi.fn<(next: AgentCliKind) => Promise<boolean>>(async () => true),
  overrides: { fallback?: AgentCliKindSetting['fallback']; saveError?: string | null } = {}
): typeof changeKind => {
  mockUseAgentCliKind.mockReturnValue({
    kind,
    fallback: overrides.fallback ?? null,
    saveError: overrides.saveError ?? null,
    changeKind
  })
  return changeKind
}

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
  setCliKind('claude')
  mockUseAgentSessions.mockReturnValue(makeAgentSessionsState())
  mockUseAgentPromptSender.mockReturnValue(makeSender())
  mockUseAgentActivity.mockReturnValue(new Map())
  mockUseAgentNotifications.mockReturnValue('')
  mockUseAgentLastSession.mockReturnValue({ kind: 'none' })
  mockUseAgentNotificationSetting.mockReturnValue({
    enabled: true,
    saveError: null,
    changeEnabled: vi.fn<(next: boolean) => Promise<boolean>>(async () => true)
  })
  setSendConfirmEnabled(true)
  sharedDefaults.sendConfirmEnabled = true
  windowConfirmSpy = null
  consoleErrorSpy = null
})

afterEach(() => {
  windowConfirmSpy?.mockRestore()
  consoleErrorSpy?.mockRestore()
  capabilityOverrides.unsupportedKinds.clear()
  capabilityOverrides.promptSendUnsupportedKinds.clear()
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
  describe('通知の設定(agentNotificationPanel)', () => {
    it('設定の値と保存の失敗を渡し、変更を changeEnabled へ渡す', () => {
      const changeEnabled = vi.fn<(next: boolean) => Promise<boolean>>(async () => true)
      mockUseAgentNotificationSetting.mockReturnValue({
        enabled: false,
        saveError: '通知の設定を保存できませんでした: x',
        changeEnabled
      })
      const { result } = renderWorkspace()
      expect(result.current.agentNotificationPanel.enabled).toBe(false)
      expect(result.current.agentNotificationPanel.saveError).toBe(
        '通知の設定を保存できませんでした: x'
      )
      act(() => result.current.agentNotificationPanel.onChange(true))
      expect(changeEnabled).toHaveBeenCalledWith(true)
    })
  })

  describe('送信前の確認の設定(agentSendConfirmPanel)', () => {
    it('設定の値と保存の失敗を渡し、変更を changeEnabled へ渡す', () => {
      const changeEnabled = setSendConfirmEnabled(
        false,
        undefined,
        '送信前の確認の設定を保存できませんでした: x'
      )
      const { result } = renderWorkspace()
      expect(result.current.agentSendConfirmPanel.enabled).toBe(false)
      expect(result.current.agentSendConfirmPanel.saveError).toBe(
        '送信前の確認の設定を保存できませんでした: x'
      )
      act(() => result.current.agentSendConfirmPanel.onChange(true))
      expect(changeEnabled).toHaveBeenCalledWith(true)
    })
  })

  describe('組み立て', () => {
    it('useAgentSessions に開いているフォルダ・文書ごとのタブの置き場・エージェント CLI 方式か・設定の種類・確認を渡す', () => {
      setMode('agent-cli')
      const onConfirm = vi.fn(() => true)
      renderHook(() => useAgentWorkspace({ folderPath: '/p', isExecuting: false, onConfirm }))
      expect(mockUseAgentSessions).toHaveBeenLastCalledWith({
        folderPath: '/p',
        tabs: getAgentSessionTabs(),
        enabled: true,
        startBlockedReason: null,
        appCliKind: 'claude',
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
      expect(result.current.agentTerminal.appCliKind).toBe('claude')
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

    it('作業中の知らせの hook に、タブの一覧と useAgentActivity の結果をそのまま渡す', () => {
      const tab1 = makeAgentSessionTabView({ status: 'running' })
      const sessions = makeAgentSessionsState({ tabs: [tab1], selected: tab1 })
      mockUseAgentSessions.mockReturnValue(sessions)
      const activities = new Map([['slot-1', 'working' as const]])
      mockUseAgentActivity.mockReturnValue(activities)
      renderHook(() => useAgentWorkspace({ folderPath: null, isExecuting: false }))
      expect(mockUseAgentHooksWorkingReport.mock.lastCall?.[0].tabs).toBe(sessions.tabs)
      expect(mockUseAgentHooksWorkingReport.mock.lastCall?.[0].activities).toBe(activities)
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

    it.each([true, false])('従来の方式では、実行中(%s)を実行ボタンの状態に渡す', (isExecuting) => {
      setMode('legacy')
      const { result } = renderWorkspace({ isExecuting })
      expect(result.current.promptRun.isRunDisabled).toBe(isExecuting)
    })

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
        beforeSend: undefined,
        isInterrupting: expect.any(Function)
      })
    })

    it('sendToAgent は押した時点の選択中のタブを送り先にする。送信中にタブを切り替えても送り先は変わらない', async () => {
      setSendConfirmEnabled(false)
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
        sending = result.current.sendToAgent('hello', { promptId: null, unsavedPaths: [] })
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
        controller: tab2.controller,
        describeSession: expect.any(Function),
        cliKind: 'claude'
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

  describe('送信の入口の CLI の種類(選択中のタブの cliKind)', () => {
    // 送信に対応しない種類の入口の守り(段階 1)と、能力の判定に使う種類の選び方(agentCapabilityCliKindOf)を、能力の表で
    // copilot の送信を偽にして確かめる(段階 2b で copilot も送信に対応した)
    beforeEach(() => {
      capabilityOverrides.promptSendUnsupportedKinds.add('copilot')
    })

    const COPILOT = agentPromptSendUnsupportedReason('copilot')
    const copilotRunning = (): ReturnType<typeof makeAgentSessionsState> =>
      makeAgentSessionsState({ selected: { status: 'running', cliKind: 'copilot' } })

    it('選択中のタブが copilot なら実行を押せず、理由を出す', () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(copilotRunning())
      const { result } = renderWorkspace()
      expect(result.current.promptRun).toMatchObject({
        isRunDisabled: true,
        runDisabledReason: COPILOT
      })
    })

    it('履歴の再実行(エージェントのエントリ)も選択中のタブの種類で止める', () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(copilotRunning())
      const entry: HistoryEntry = {
        id: 'h2',
        promptId: 'p1',
        promptTitle: '要約',
        promptContent: '本文',
        fileContent: null,
        toolId: 'claude',
        status: 'sent',
        resultText: null,
        errorMessage: null,
        executedAt: 1000,
        agent: {
          claudeSessionId: '11111111-1111-4111-8111-111111111111',
          tabLabel: 'claude 1',
          folderPath: '/p'
        }
      }
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.getHistoryActions(entry).rerun).toEqual({
        disabled: true,
        reason: COPILOT
      })
    })

    it('確認なしで送るとき、送り先に選択中のタブの cliKind を載せる(send の先頭の守りに届く)', async () => {
      setMode('agent-cli')
      setSendConfirmEnabled(false)
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      mockUseAgentSessions.mockReturnValue(copilotRunning())
      const { result } = renderWorkspace()
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
      })
      expect(sender.send).toHaveBeenCalledExactlyOnceWith(
        'hello',
        expect.objectContaining({ cliKind: 'copilot' })
      )
    })

    it('送信前の確認の送れない理由は、確認を開いた時点の送り先の種類で求める', async () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(copilotRunning())
      const { result } = renderWorkspace()
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
      })
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(COPILOT)
    })

    // 終了したタブの種類は前の起動の結果のまま残る(名前を画面に合わせる)が、起動を押すと設定の種類で起動する。能力の判定は
    // 動いているタブだけタブの種類、それ以外は次に起動する設定の種類で行う(agentCapabilityCliKindOf)
    const agentEntry: HistoryEntry = {
      id: 'h3',
      promptId: 'p1',
      promptTitle: '要約',
      promptContent: '本文',
      fileContent: null,
      toolId: 'claude',
      status: 'sent',
      resultText: null,
      errorMessage: null,
      executedAt: 1000,
      agent: {
        claudeSessionId: '11111111-1111-4111-8111-111111111111',
        tabLabel: 'claude 1',
        folderPath: '/p'
      }
    }

    it('(a) copilot で終了したタブで設定が claude なら、実行・再実行は copilot の理由ではなく未起動の理由を出す(名前は copilot のまま)', () => {
      setMode('agent-cli')
      setCliKind('claude')
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'exited', cliKind: 'copilot' } })
      )
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.promptRun).toMatchObject({
        isRunDisabled: true,
        runDisabledReason: RUN_DISABLED_NO_SESSION
      })
      expect(result.current.getHistoryActions(agentEntry).rerun).toEqual({
        disabled: true,
        reason: RUN_DISABLED_NO_SESSION
      })
      expect(result.current.agentTerminal.sessions.selected.label).toBe('copilot 1')
    })

    it('(b) claude で終了したタブで設定が copilot なら、実行・再実行は未起動の理由ではなく copilot の理由を出す', () => {
      setMode('agent-cli')
      setCliKind('copilot')
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'exited', cliKind: 'claude' } })
      )
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.promptRun).toMatchObject({
        isRunDisabled: true,
        runDisabledReason: COPILOT
      })
      expect(result.current.getHistoryActions(agentEntry).rerun).toEqual({
        disabled: true,
        reason: COPILOT
      })
    })

    it('動いているタブは、設定の種類が違ってもタブの種類(起動の結果)で判定する', () => {
      setMode('agent-cli')
      setCliKind('copilot')
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running', cliKind: 'claude' } })
      )
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.promptRun).toMatchObject({
        isRunDisabled: false,
        runDisabledReason: null
      })
      expect(result.current.getHistoryActions(agentEntry).rerun).toEqual({
        disabled: false,
        reason: null
      })
    })
  })

  describe('送信の押せる条件の活動と中断の流れ(copilot は入力待ちで中断の流れの外だけ。L-058)', () => {
    const agentEntry: HistoryEntry = {
      id: 'h-activity',
      promptId: 'p1',
      promptTitle: '要約',
      promptContent: '本文',
      fileContent: null,
      toolId: 'claude',
      status: 'sent',
      resultText: null,
      errorMessage: null,
      executedAt: 1000,
      agent: {
        claudeSessionId: '11111111-1111-4111-8111-111111111111',
        tabLabel: 'claude 1',
        folderPath: '/p'
      }
    }
    const WORKING = agentSendBlockedByActivityReason('working', 'copilot')
    const runningTabOf = (cliKind: AgentCliKind): ReturnType<typeof makeAgentSessionsState> =>
      makeAgentSessionsState({ selected: { status: 'running', cliKind } })
    const activityOf = (activity: AgentActivity): ReadonlyMap<string, AgentActivity> =>
      new Map([['slot-1', activity]])

    afterEach(() => {
      vi.useRealTimers()
    })

    it('選択中の copilot のタブが作業中なら、実行・再実行・送信前の確認の理由が活動の理由になる', async () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(runningTabOf('copilot'))
      mockUseAgentActivity.mockReturnValue(activityOf('working'))
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.promptRun).toMatchObject({
        isRunDisabled: true,
        runDisabledReason: WORKING
      })
      expect(result.current.getHistoryActions(agentEntry).rerun).toEqual({
        disabled: true,
        reason: WORKING
      })
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
      })
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(WORKING)
      expect(result.current.agentSendConfirmDialog.pending?.cliKind).toBe('copilot')
    })

    it('選択中の copilot のタブが入力待ちなら、実行・再実行を押せる', () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(runningTabOf('copilot'))
      mockUseAgentActivity.mockReturnValue(activityOf('idle'))
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.promptRun).toMatchObject({
        isRunDisabled: false,
        runDisabledReason: null
      })
      expect(result.current.getHistoryActions(agentEntry).rerun).toEqual({
        disabled: false,
        reason: null
      })
    })

    it('活動が未記録のタブは unknown として扱う(中断の判定と同じ写像)', () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(runningTabOf('copilot'))
      mockUseAgentActivity.mockReturnValue(new Map())
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.promptRun.runDisabledReason).toBe(
        agentSendBlockedByActivityReason('unknown', 'copilot')
      )
    })

    it('claude のタブは作業中でも実行・再実行を押せる(今のまま)', () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(runningTabOf('claude'))
      mockUseAgentActivity.mockReturnValue(activityOf('working'))
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.promptRun).toMatchObject({
        isRunDisabled: false,
        runDisabledReason: null
      })
      expect(result.current.getHistoryActions(agentEntry).rerun).toEqual({
        disabled: false,
        reason: null
      })
    })

    it('中断を押した直後は、実行・再実行・送信前の確認の理由が RUN_DISABLED_INTERRUPTING で、1,000ms の待ちが明けると活動の理由に戻る', async () => {
      // 1,000ms の待ちを実時間で待たないよう、偽のタイマーで進める(このテストは waitFor を使わない)
      vi.useFakeTimers()
      setMode('agent-cli')
      const sessions = runningTabOf('copilot')
      const controller = sessions.selected.controller as FakeController
      controller.screen = copilotScreen('working3000').lines
      mockUseAgentSessions.mockReturnValue(sessions)
      mockUseAgentActivity.mockReturnValue(activityOf('working'))
      const { result } = renderWorkspace({ folderPath: '/p' })
      await act(async () => {
        result.current.agentTerminal.interrupt.onInterrupt()
      })
      expect(sessions.interrupt).toHaveBeenCalledExactlyOnceWith('slot-1')
      expect(result.current.promptRun.runDisabledReason).toBe(RUN_DISABLED_INTERRUPTING)
      expect(result.current.getHistoryActions(agentEntry).rerun.reason).toBe(
        RUN_DISABLED_INTERRUPTING
      )
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
      })
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(
        RUN_DISABLED_INTERRUPTING
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AGENT_INTERRUPT_COOLDOWN_MS - 1)
      })
      expect(result.current.promptRun.runDisabledReason).toBe(RUN_DISABLED_INTERRUPTING)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(result.current.promptRun.runDisabledReason).toBe(WORKING)
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(WORKING)
    })

    it('パネル(agentTerminal.interrupt)には中断の UI の値だけを渡す(送信の判定の値は渡さない)', () => {
      setMode('agent-cli')
      const { result } = renderWorkspace()
      expect(Object.keys(result.current.agentTerminal.interrupt).sort()).toEqual([
        'disabledReason',
        'notice',
        'onInterrupt',
        'visible'
      ])
    })
  })

  describe('送信前の確認', () => {
    // 選択中のタブ 2 が running(送り先)。タブ 1 も running
    const twoRunningTabs = (
      tab2Overrides: Partial<AgentSessionTabView> = {}
    ): { tab1: AgentSessionTabView; tab2: AgentSessionTabView } => ({
      tab1: makeAgentSessionTabView({ status: 'running' }),
      tab2: makeAgentSessionTabView({
        slotId: 'slot-2',
        number: 2,
        label: 'claude 2',
        status: 'running',
        ...tab2Overrides
      })
    })

    const setTabs = (
      tabs: AgentSessionTabView[],
      selectedSlotId: string,
      selectTab = vi.fn<(slotId: string) => void>()
    ): void => {
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ tabs, selected: { slotId: selectedSlotId }, selectTab })
      )
    }

    const openConfirm = async (result: Rendered['result']): Promise<void> => {
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
      })
    }

    it('設定がオンなら送らずに確認を開き、押した時点の選択中のタブを送り先として控える', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      const { tab1, tab2 } = twoRunningTabs()
      setTabs([tab1, tab2], 'slot-2')
      const { result } = renderWorkspace()
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      await openConfirm(result)
      expect(sender.send).not.toHaveBeenCalled()
      expect(result.current.agentSendConfirmDialog.pending).toEqual({
        text: 'hello',
        slotId: 'slot-2',
        label: 'claude 2',
        cliKind: 'claude',
        promptId: 'p1',
        unsavedPaths: []
      })
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBeNull()
    })

    it('確認を開いた時点で、前の送信の結果(失敗の文言・成功の通知)を消す', async () => {
      setMode('agent-cli')
      const sender = makeSender({ error: '前の失敗' })
      mockUseAgentPromptSender.mockReturnValue(sender)
      const { tab1, tab2 } = twoRunningTabs()
      setTabs([tab1, tab2], 'slot-2')
      const { result } = renderWorkspace()
      expect(sender.clearResult).not.toHaveBeenCalled()
      await openConfirm(result)
      expect(sender.clearResult).toHaveBeenCalledOnce()
      expect(sender.send).not.toHaveBeenCalled()
    })

    it('設定の読み込み中(null)も確認を開く(既定がオンのため)', async () => {
      setMode('agent-cli')
      setSendConfirmEnabled(null)
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const { result } = renderWorkspace()
      await openConfirm(result)
      expect(sender.send).not.toHaveBeenCalled()
      expect(result.current.agentSendConfirmDialog.pending).not.toBeNull()
    })

    it('読み込み中の扱いは設定の既定に従う(既定がオフなら確認を開かずすぐ送る)', async () => {
      setMode('agent-cli')
      setSendConfirmEnabled(null)
      sharedDefaults.sendConfirmEnabled = false
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const { result } = renderWorkspace()
      await openConfirm(result)
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      expect(sender.send).toHaveBeenCalledOnce()
    })

    it('設定がオフ(読み込み後)なら確認を開かず、押した時点の選択中のタブへすぐ送る', async () => {
      setMode('agent-cli')
      setSendConfirmEnabled(false)
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      const { tab1, tab2 } = twoRunningTabs()
      setTabs([tab1, tab2], 'slot-2')
      const { result } = renderWorkspace()
      await openConfirm(result)
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      expect(sender.send).toHaveBeenCalledExactlyOnceWith('hello', {
        slotId: 'slot-2',
        controller: tab2.controller,
        describeSession: expect.any(Function),
        cliKind: 'claude'
      })
    })

    it('確認の送信で、控えた送り先へ送って閉じ、送れたら(sent)パネルを開いてそのタブのターミナルへフォーカスを移す', async () => {
      setMode('agent-cli')
      let resolveSend: (outcome: AgentPromptSendResult | undefined) => void = () => undefined
      const sender = makeSender({
        send: vi.fn<AgentPromptSenderState['send']>(
          () => new Promise((resolve) => (resolveSend = resolve))
        )
      })
      mockUseAgentPromptSender.mockReturnValue(sender)
      const { tab1, tab2 } = twoRunningTabs()
      const selectTab = vi.fn<(slotId: string) => void>()
      setTabs([tab1, tab2], 'slot-2', selectTab)
      const { result } = renderWorkspace()
      act(() => result.current.agentTerminal.layout.toggleOpen())
      await openConfirm(result)
      act(() => result.current.agentSendConfirmDialog.onConfirm())
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      expect(sender.send).toHaveBeenCalledExactlyOnceWith('hello', {
        slotId: 'slot-2',
        controller: tab2.controller,
        describeSession: expect.any(Function),
        cliKind: 'claude'
      })
      // 送信が終わるまではターミナルへフォーカスを移さない(送信の前の準備の間のキー入力が claude へ直接届かないように)
      expect(tab2.controller.focus).not.toHaveBeenCalled()
      await act(async () => {
        resolveSend({ kind: 'sent', clearedDraft: false, sentTo: null, cliKind: 'claude' })
      })
      expect(result.current.agentTerminal.layout.isOpen).toBe(true)
      expect(selectTab).toHaveBeenCalledWith('slot-2')
      expect(tab2.controller.focus).toHaveBeenCalledTimes(1)
      expect(tab1.controller.focus).not.toHaveBeenCalled()
    })

    describe('送信中に利用者が別の場所へ移したフォーカスは奪わない', () => {
      const elements: HTMLElement[] = []
      afterEach(() => {
        for (const element of elements) element.remove()
        elements.length = 0
      })
      const addButton = (promptId?: string): HTMLButtonElement => {
        const button = document.createElement('button')
        if (promptId !== undefined) button.dataset.promptRun = promptId
        document.body.append(button)
        elements.push(button)
        return button
      }
      const deferredSender = (
        overrides: Partial<AgentPromptSenderState> = {}
      ): {
        sender: AgentPromptSenderState
        resolve: (outcome: AgentPromptSendResult | undefined) => void
      } => {
        let resolveSend: (outcome: AgentPromptSendResult | undefined) => void = () => undefined
        const sender = makeSender({
          ...overrides,
          send: vi.fn<AgentPromptSenderState['send']>(
            () => new Promise((resolve) => (resolveSend = resolve))
          )
        })
        return { sender, resolve: (outcome) => resolveSend(outcome) }
      }

      it('送れた(sent)ときも、送信中に別の場所へフォーカスが移っていれば、タブの選択を変えずターミナルへも移さない', async () => {
        setMode('agent-cli')
        const { sender, resolve } = deferredSender()
        mockUseAgentPromptSender.mockReturnValue(sender)
        const { tab1, tab2 } = twoRunningTabs()
        const selectTab = vi.fn<(slotId: string) => void>()
        setTabs([tab1, tab2], 'slot-1', selectTab)
        const { result } = renderWorkspace()
        await openConfirm(result)
        act(() => result.current.agentSendConfirmDialog.onConfirm())
        const other = addButton()
        other.focus()
        await act(async () => {
          resolve({ kind: 'sent', clearedDraft: false, sentTo: null, cliKind: 'claude' })
        })
        expect(selectTab).not.toHaveBeenCalled()
        expect(tab1.controller.focus).not.toHaveBeenCalled()
        expect(other).toHaveFocus()
      })

      it('失敗した(failed)ときも、送信中に別の場所へフォーカスが移っていれば、実行ボタンへ移さない', async () => {
        setMode('agent-cli')
        const { sender, resolve } = deferredSender()
        mockUseAgentPromptSender.mockReturnValue(sender)
        const { tab1, tab2 } = twoRunningTabs()
        setTabs([tab1, tab2], 'slot-2')
        const runButton = addButton('p1')
        const { result } = renderWorkspace()
        await openConfirm(result)
        act(() => result.current.agentSendConfirmDialog.onConfirm())
        const other = addButton()
        other.focus()
        await act(async () => {
          resolve({ kind: 'failed', reason: 'input-not-found' })
        })
        expect(runButton).not.toHaveFocus()
        expect(other).toHaveFocus()
      })

      it('失敗の結果が出た後、送信中が解ける描画までに別の場所へ移されたら、実行ボタンへ移さない', async () => {
        setMode('agent-cli')
        const { sender, resolve } = deferredSender({ isSending: true, sendingSlotId: 'slot-2' })
        mockUseAgentPromptSender.mockReturnValue(sender)
        const { tab1, tab2 } = twoRunningTabs()
        setTabs([tab1, tab2], 'slot-2')
        const runButton = addButton('p1')
        runButton.disabled = true
        const { result, rerender } = renderWorkspace()
        await openConfirm(result)
        act(() => result.current.agentSendConfirmDialog.onConfirm())
        await act(async () => {
          resolve({ kind: 'failed', reason: 'input-not-found' })
        })
        const other = addButton()
        other.focus()
        runButton.disabled = false
        mockUseAgentPromptSender.mockReturnValue({
          ...sender,
          isSending: false,
          sendingSlotId: null
        })
        rerender()
        expect(runButton).not.toHaveFocus()
        expect(other).toHaveFocus()
      })
    })

    describe('送信が失敗したときのフォーカス', () => {
      let runButton: HTMLButtonElement | null = null
      afterEach(() => {
        runButton?.remove()
        runButton = null
      })
      // 一覧の実行ボタン(data-prompt-run)。送信中は disabled
      const addRunButton = (promptId: string, disabled = false): HTMLButtonElement => {
        const button = document.createElement('button')
        button.dataset.promptRun = promptId
        button.disabled = disabled
        document.body.append(button)
        runButton = button
        return button
      }

      it.each([
        ['failed', { kind: 'failed', reason: 'input-not-found' } as AgentPromptSendResult],
        ['undefined(例外・送信中)', undefined]
      ])(
        '結果が %s なら、ターミナルへ移さず同じプロンプトの実行ボタンへ戻す',
        async (_label, outcome) => {
          setMode('agent-cli')
          const sender = makeSender({
            send: vi.fn<AgentPromptSenderState['send']>(async () => outcome)
          })
          mockUseAgentPromptSender.mockReturnValue(sender)
          const { tab1, tab2 } = twoRunningTabs()
          const selectTab = vi.fn<(slotId: string) => void>()
          setTabs([tab1, tab2], 'slot-2', selectTab)
          const button = addRunButton('p1')
          const { result } = renderWorkspace()
          await openConfirm(result)
          await act(async () => {
            result.current.agentSendConfirmDialog.onConfirm()
          })
          expect(tab2.controller.focus).not.toHaveBeenCalled()
          expect(selectTab).not.toHaveBeenCalled()
          expect(button).toHaveFocus()
        }
      )

      // copilot の送り先が失敗の時点で作業中・許可待ちに変わった・中断の流れの間 など、送信中が解けても実行ボタンが押せないまま
      // のときは移さない(設計書 2026-10-22「気をつける知見」の L-157・L-408)
      it('送信中でなくても同じプロンプトの実行ボタンが押せない(disabled)なら、そこへ移さない', async () => {
        setMode('agent-cli')
        mockUseAgentPromptSender.mockReturnValue(
          makeSender({
            send: vi.fn<AgentPromptSenderState['send']>(async () => ({
              kind: 'failed',
              reason: 'screen-working'
            }))
          })
        )
        const { tab1, tab2 } = twoRunningTabs()
        setTabs([tab1, tab2], 'slot-2')
        const button = addRunButton('p1', true)
        // jsdom は disabled の要素へ focus() してもフォーカスを移さないため、移そうとしたこと自体を見る
        const focus = vi.spyOn(button, 'focus')
        const { result } = renderWorkspace()
        await openConfirm(result)
        await act(async () => {
          result.current.agentSendConfirmDialog.onConfirm()
        })
        expect(focus).not.toHaveBeenCalled()
        expect(document.activeElement).toBe(document.body)
      })

      describe('確認を開いた時点の要素(履歴の詳細の 再実行 など)', () => {
        let opener: HTMLButtonElement | null = null
        afterEach(() => {
          opener?.remove()
          opener = null
        })
        // 確認を開いた元(履歴の詳細の 再実行)。送信中は disabled
        const addOpener = (disabled = false): HTMLButtonElement => {
          const button = document.createElement('button')
          document.body.append(button)
          button.focus()
          button.disabled = disabled
          opener = button
          return button
        }
        const renderFailing = (isSending: boolean): ReturnType<typeof renderWorkspace> => {
          setMode('agent-cli')
          mockUseAgentPromptSender.mockReturnValue(
            makeSender({
              isSending,
              sendingSlotId: isSending ? 'slot-2' : null,
              send: vi.fn<AgentPromptSenderState['send']>(async () => ({
                kind: 'failed',
                reason: 'input-not-found'
              }))
            })
          )
          const { tab1, tab2 } = twoRunningTabs()
          setTabs([tab1, tab2], 'slot-2')
          return renderWorkspace()
        }

        it('失敗したら、一覧の実行ではなく確認を開いた時点の要素へ戻す(一覧が隠れていても戻り先が残る)', async () => {
          const button = addRunButton('p1')
          const origin = addOpener()
          const { result } = renderFailing(false)
          await openConfirm(result)
          // 確認のダイアログへ移ったフォーカスは、閉じると body へ落ちる
          origin.blur()
          await act(async () => {
            result.current.agentSendConfirmDialog.onConfirm()
          })
          expect(origin).toHaveFocus()
          expect(button).not.toHaveFocus()
        })

        it('開いた時点の要素も送信中は disabled なので、送信中が解けた描画の後に戻す', async () => {
          addRunButton('p1', true)
          const origin = addOpener()
          const { result, rerender } = renderFailing(true)
          await openConfirm(result)
          origin.blur()
          origin.disabled = true
          await act(async () => {
            result.current.agentSendConfirmDialog.onConfirm()
          })
          expect(origin).not.toHaveFocus()
          origin.disabled = false
          mockUseAgentPromptSender.mockReturnValue(
            makeSender({ isSending: false, sendingSlotId: null })
          )
          rerender()
          expect(origin).toHaveFocus()
        })

        it('開いた時点の要素が見えていなければ(checkVisibility が false)、同じプロンプトの一覧の実行へ戻す', async () => {
          const button = addRunButton('p1')
          const origin = addOpener()
          const { result } = renderFailing(false)
          await openConfirm(result)
          origin.blur()
          Object.defineProperty(origin, 'checkVisibility', { value: () => false })
          await act(async () => {
            result.current.agentSendConfirmDialog.onConfirm()
          })
          expect(origin).not.toHaveFocus()
          expect(button).toHaveFocus()
        })

        it('一覧の実行が見えていなければ(隠れたパネルの中)、そこへも移さない', async () => {
          const button = addRunButton('p1')
          Object.defineProperty(button, 'checkVisibility', { value: () => false })
          const { result } = renderFailing(false)
          await openConfirm(result)
          await act(async () => {
            result.current.agentSendConfirmDialog.onConfirm()
          })
          expect(button).not.toHaveFocus()
        })
      })

      it('送信中(実行ボタンが disabled)の描画では移さず、送信中が解けた描画の後に移す', async () => {
        setMode('agent-cli')
        const sender = makeSender({
          isSending: true,
          sendingSlotId: 'slot-2',
          send: vi.fn<AgentPromptSenderState['send']>(async () => ({
            kind: 'failed',
            reason: 'input-not-found'
          }))
        })
        mockUseAgentPromptSender.mockReturnValue(sender)
        const { tab1, tab2 } = twoRunningTabs()
        setTabs([tab1, tab2], 'slot-2')
        const button = addRunButton('p1', true)
        const { result, rerender } = renderWorkspace()
        await openConfirm(result)
        await act(async () => {
          result.current.agentSendConfirmDialog.onConfirm()
        })
        expect(button).not.toHaveFocus()
        button.disabled = false
        mockUseAgentPromptSender.mockReturnValue({
          ...sender,
          isSending: false,
          sendingSlotId: null
        })
        rerender()
        expect(button).toHaveFocus()
      })
    })

    it('設定がオフなら、すぐ送って送れた(sent)ときだけ onSent を呼ぶ', async () => {
      setMode('agent-cli')
      setSendConfirmEnabled(false)
      const sender = makeSender({
        send: vi.fn<AgentPromptSenderState['send']>(async () => ({
          kind: 'sent',
          clearedDraft: false,
          sentTo: null,
          cliKind: 'claude'
        }))
      })
      mockUseAgentPromptSender.mockReturnValue(sender)
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const onSent = vi.fn()
      const { result } = renderWorkspace()
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [], onSent })
      })
      expect(onSent).toHaveBeenCalledExactlyOnceWith(null, 'claude')
    })

    it('設定がオフで送信が失敗したら onSent を呼ばない', async () => {
      setMode('agent-cli')
      setSendConfirmEnabled(false)
      mockUseAgentPromptSender.mockReturnValue(
        makeSender({
          send: vi.fn<AgentPromptSenderState['send']>(async () => ({
            kind: 'failed',
            reason: 'input-not-found'
          }))
        })
      )
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const onSent = vi.fn()
      const { result } = renderWorkspace()
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [], onSent })
      })
      expect(onSent).not.toHaveBeenCalled()
    })

    it('確認を開いたら、未保存の一覧を確認の状態に持たせ、確認から送れたときだけ onSent を呼ぶ', async () => {
      setMode('agent-cli')
      mockUseAgentPromptSender.mockReturnValue(
        makeSender({
          send: vi.fn<AgentPromptSenderState['send']>(async () => ({
            kind: 'sent',
            clearedDraft: false,
            sentTo: null,
            cliKind: 'claude'
          }))
        })
      )
      const { tab1, tab2 } = twoRunningTabs()
      setTabs([tab1, tab2], 'slot-2')
      const onSent = vi.fn()
      const { result } = renderWorkspace()
      await act(async () => {
        await result.current.sendToAgent('hello', {
          promptId: 'p1',
          unsavedPaths: ['src/a.ts'],
          onSent
        })
      })
      expect(result.current.agentSendConfirmDialog.pending?.unsavedPaths).toEqual(['src/a.ts'])
      expect(onSent).not.toHaveBeenCalled()
      act(() => result.current.agentSendConfirmDialog.onConfirm())
      await waitFor(() => expect(onSent).toHaveBeenCalledOnce())
    })

    it('確認をキャンセルしたら onSent を呼ばない', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const onSent = vi.fn()
      const { result } = renderWorkspace()
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [], onSent })
      })
      act(() => result.current.agentSendConfirmDialog.onCancel())
      expect(sender.send).not.toHaveBeenCalled()
      expect(onSent).not.toHaveBeenCalled()
    })

    it('確認のキャンセルで閉じ、送らない', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const { result } = renderWorkspace()
      await openConfirm(result)
      act(() => result.current.agentSendConfirmDialog.onCancel())
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      expect(sender.send).not.toHaveBeenCalled()
    })

    it('確認を開いている間の 2 回目の送信の依頼は無視する', async () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const { result } = renderWorkspace()
      await openConfirm(result)
      await act(async () => {
        await result.current.sendToAgent('second', { promptId: 'p2', unsavedPaths: [] })
      })
      expect(result.current.agentSendConfirmDialog.pending?.text).toBe('hello')
    })

    it('開いている間に従来の方式へ切り替わったら閉じる(送らない。L-405)', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const { result, rerender } = renderWorkspace()
      await openConfirm(result)
      setMode('legacy')
      rerender()
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      expect(sender.send).not.toHaveBeenCalled()
    })

    it('開いている間にフォルダが変わったら閉じる(送らない。L-405)', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const { result, rerender } = renderHook(
        ({ folderPath }: { folderPath: string | null }) =>
          useAgentWorkspace({ folderPath, isExecuting: false }),
        { initialProps: { folderPath: '/a' as string | null } }
      )
      await openConfirm(result)
      rerender({ folderPath: '/b' })
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      expect(sender.send).not.toHaveBeenCalled()
    })

    it('開いている間に送り先のタブが閉じたら閉じる(送らない。L-405)', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      const { tab1, tab2 } = twoRunningTabs()
      setTabs([tab1, tab2], 'slot-2')
      const { result, rerender } = renderWorkspace()
      await openConfirm(result)
      setTabs([tab1], 'slot-1')
      rerender()
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      expect(sender.send).not.toHaveBeenCalled()
    })

    it('開いている間にほかのタブが閉じても閉じない', async () => {
      setMode('agent-cli')
      const { tab1, tab2 } = twoRunningTabs()
      setTabs([tab1, tab2], 'slot-2')
      const { result, rerender } = renderWorkspace()
      await openConfirm(result)
      setTabs([tab2], 'slot-2')
      rerender()
      expect(result.current.agentSendConfirmDialog.pending?.slotId).toBe('slot-2')
    })

    it.each([
      ['セッションが終わった(タブは残る)', { status: 'exited' as const }, RUN_DISABLED_NO_SESSION],
      ['閉じる途中', { isClosing: true }, RUN_DISABLED_CLOSING]
    ])(
      '開いている間に送り先の状態が変わっても(%s)、閉じずに理由を出す',
      async (_label, tab2Overrides, reason) => {
        setMode('agent-cli')
        const { tab1, tab2 } = twoRunningTabs()
        setTabs([tab1, tab2], 'slot-2')
        const { result, rerender } = renderWorkspace()
        await openConfirm(result)
        const changed = twoRunningTabs(tab2Overrides)
        setTabs([tab1, changed.tab2], 'slot-2')
        rerender()
        expect(result.current.agentSendConfirmDialog.pending?.slotId).toBe('slot-2')
        expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(reason)
      }
    )

    it('送信中(全体で 1 つ)なら理由を出す', async () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const { result, rerender } = renderWorkspace()
      await openConfirm(result)
      mockUseAgentPromptSender.mockReturnValue(
        makeSender({ isSending: true, sendingSlotId: 'slot-9' })
      )
      rerender()
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(RUN_DISABLED_SENDING)
    })

    it('理由は控えた送り先のタブの状態から求める(開いた後に未起動のタブを選んでも理由は出ない)', async () => {
      setMode('agent-cli')
      const tab1 = makeAgentSessionTabView({ status: 'none' })
      const { tab2 } = twoRunningTabs()
      setTabs([tab1, tab2], 'slot-2')
      const { result, rerender } = renderWorkspace()
      await openConfirm(result)
      setTabs([tab1, tab2], 'slot-1')
      rerender()
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBeNull()
      expect(result.current.agentSendConfirmDialog.pending?.label).toBe('claude 2')
    })

    // 送り先(控えたタブ 2)と選択中のタブ(1)の活動・中断の流れを変え、確認の理由が控えた送り先で決まることを固定する(L-037)
    const twoCopilotTabs = (): { tab1: AgentSessionTabView; tab2: AgentSessionTabView } => {
      const { tab1, tab2 } = twoRunningTabs({ cliKind: 'copilot', label: 'copilot 2' })
      return { tab1: { ...tab1, cliKind: 'copilot', label: 'copilot 1' }, tab2 }
    }
    const tab2WorkingTab1Idle = (): ReadonlyMap<string, AgentActivity> =>
      new Map<string, AgentActivity>([
        ['slot-1', 'idle'],
        ['slot-2', 'working']
      ])

    it('理由の活動は控えた送り先のタブの活動(開いた後に入力待ちのタブを選んでも、作業中の理由のまま)', async () => {
      setMode('agent-cli')
      const { tab1, tab2 } = twoCopilotTabs()
      setTabs([tab1, tab2], 'slot-2')
      mockUseAgentActivity.mockReturnValue(tab2WorkingTab1Idle())
      const { result, rerender } = renderWorkspace()
      await openConfirm(result)
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(
        agentSendBlockedByActivityReason('working', 'copilot')
      )
      setTabs([tab1, tab2], 'slot-1')
      rerender()
      expect(result.current.agentSendConfirmDialog.pending?.slotId).toBe('slot-2')
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(
        agentSendBlockedByActivityReason('working', 'copilot')
      )
    })

    it('理由の中断の流れは控えた送り先のタブのもの(中断を押したタブへ確認を開き、別のタブを選んでも RUN_DISABLED_INTERRUPTING のまま)', async () => {
      setMode('agent-cli')
      const { tab1, tab2 } = twoCopilotTabs()
      ;(tab2.controller as FakeController).screen = copilotScreen('working3000').lines
      setTabs([tab1, tab2], 'slot-2')
      mockUseAgentActivity.mockReturnValue(tab2WorkingTab1Idle())
      const { result, rerender } = renderWorkspace()
      await act(async () => {
        result.current.agentTerminal.interrupt.onInterrupt()
      })
      await openConfirm(result)
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(
        RUN_DISABLED_INTERRUPTING
      )
      setTabs([tab1, tab2], 'slot-1')
      rerender()
      expect(result.current.agentSendConfirmDialog.pending?.slotId).toBe('slot-2')
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(
        RUN_DISABLED_INTERRUPTING
      )
    })

    it('開いている間に設定をオフにしても閉じない(次の実行から確認しない)', async () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const { result, rerender } = renderWorkspace()
      await openConfirm(result)
      setSendConfirmEnabled(false)
      rerender()
      expect(result.current.agentSendConfirmDialog.pending).not.toBeNull()
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
      await waitFor(() => expect(result.current.executionModePanel.isSwitching).toBe(false))
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
      await waitFor(() => expect(result.current.executionModePanel.isSwitching).toBe(false))
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
      // 押した結果の切り替えの途中は isSwitching(部品は aria-disabled にしてフォーカスを保つ。L-157)で、isLocked(disabled)にはしない
      expect(result.current.executionModePanel.isSwitching).toBe(true)
      expect(result.current.executionModePanel.isLocked).toBe(false)
      // 次の描画の関数でもう一度選んでも重ねない
      await select(result, 'legacy')
      expect(onConfirm).toHaveBeenCalledOnce()
      expect(session.stopAll).toHaveBeenCalledOnce()
      expect(changeMode).not.toHaveBeenCalled()
      await act(async () => {
        finishStop()
      })
      await waitFor(() => expect(result.current.executionModePanel.isSwitching).toBe(false))
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

    it('停止を待つ間は、実行方式・使う CLI の両方の節の選べない理由に切り替えの途中の文言を出し、終わったら戻す', async () => {
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
      await select(result, 'legacy')
      // 途中は選択肢が aria-disabled になるので、押せない理由を両方の節に出す(読み上げで理由が分かるように)
      expect(result.current.executionModePanel.lockedReason).toBe(
        AGENT_START_DISABLED_SWITCHING_MODE
      )
      expect(result.current.agentCliKindPanel.lockedReason).toBe(
        AGENT_START_DISABLED_SWITCHING_MODE
      )
      await act(async () => {
        finishStop()
      })
      await waitFor(() => expect(result.current.executionModePanel.isSwitching).toBe(false))
      expect(result.current.executionModePanel.lockedReason).toBeNull()
      expect(result.current.agentCliKindPanel.lockedReason).toBeNull()
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
      expect(result.current.executionModePanel.isSwitching).toBe(false)
      // 再入防止の ref も戻っている(もう一度選べる)
      await select(result, 'agent-cli')
      await waitFor(() => expect(changeMode).toHaveBeenCalledTimes(2))
    })
  })

  describe('使うエージェント CLI(agentCliKindPanel)', () => {
    const CLI_CHANGE_CONFIRM =
      '使う CLI を切り替えると、動いているエージェントをすべて終了します。切り替えますか？'
    const selectCli = async (result: Rendered['result'], kind: AgentCliKind): Promise<void> => {
      await act(async () => {
        result.current.agentCliKindPanel.onSelect(kind)
      })
    }

    it('設定の値・既定に戻した理由・保存の失敗を渡し、選べる', () => {
      setCliKind('copilot', undefined, { fallback: 'invalid-value', saveError: 'x' })
      const { result } = renderWorkspace()
      expect(result.current.agentCliKindPanel).toMatchObject({
        kind: 'copilot',
        fallback: 'invalid-value',
        saveError: 'x',
        isLocked: false,
        isSwitching: false,
        lockedReason: null
      })
    })

    it('設定の種類を useAgentSessions(appCliKind)・ターミナルのパネル・通知の注記に渡す', () => {
      setMode('agent-cli')
      setCliKind('copilot')
      const { result } = renderWorkspace()
      expect(mockUseAgentSessions).toHaveBeenLastCalledWith(
        expect.objectContaining({ appCliKind: 'copilot' })
      )
      expect(result.current.agentTerminal.appCliKind).toBe('copilot')
      // copilot も画面を判定するので、通知の注記は出ない(段階 2a)
      expect(result.current.agentNotificationPanel.unsupportedNote).toBeNull()
    })

    it('画面の判定が無い種類(能力の表を差し替えた copilot)を選んでいると、通知の注記を通知の節に渡す', () => {
      capabilityOverrides.unsupportedKinds.add('copilot')
      setMode('agent-cli')
      setCliKind('copilot')
      const { result } = renderWorkspace()
      expect(result.current.agentNotificationPanel.unsupportedNote).toBe(
        'copilot では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）'
      )
    })

    it('読み込み中(null)は選べず、useAgentSessions には既定の claude を渡す', () => {
      setCliKind(null)
      const { result } = renderWorkspace()
      expect(result.current.agentCliKindPanel.isLocked).toBe(true)
      expect(mockUseAgentSessions).toHaveBeenLastCalledWith(
        expect.objectContaining({ appCliKind: 'claude' })
      )
      expect(result.current.agentNotificationPanel.unsupportedNote).toBeNull()
    })

    it('起動中のタブがあれば選べず、理由を出す', () => {
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'starting' } })
      )
      const { result } = renderWorkspace()
      expect(result.current.agentCliKindPanel).toMatchObject({
        isLocked: true,
        isSwitching: false,
        lockedReason: AGENT_CLI_KIND_LOCKED_WHILE_STARTING
      })
    })

    it('動いているタブがあれば確認し、OK なら停止を待ってから保存する', async () => {
      const order: string[] = []
      const changeKind = setCliKind(
        'claude',
        vi.fn(async () => {
          order.push('save')
          return true
        })
      )
      const sessions = makeAgentSessionsState({
        selected: { status: 'running' },
        stopAll: vi.fn(async () => {
          await Promise.resolve()
          order.push('stopped')
          return true
        })
      })
      mockUseAgentSessions.mockReturnValue(sessions)
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      await selectCli(result, 'copilot')
      await waitFor(() => expect(changeKind).toHaveBeenCalledWith('copilot'))
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(CLI_CHANGE_CONFIRM)
      expect(order).toEqual(['stopped', 'save'])
    })

    it('確認でキャンセルしたら止めず、保存もしない', async () => {
      const changeKind = setCliKind('claude')
      const sessions = makeAgentSessionsState({ selected: { status: 'running' } })
      mockUseAgentSessions.mockReturnValue(sessions)
      const { result } = renderWorkspace({ onConfirm: () => false })
      await selectCli(result, 'copilot')
      await waitFor(() => expect(result.current.agentCliKindPanel.isSwitching).toBe(false))
      expect(sessions.stopAll).not.toHaveBeenCalled()
      expect(changeKind).not.toHaveBeenCalled()
    })

    it('止められなかったタブがあれば保存しない', async () => {
      const changeKind = setCliKind('claude')
      const sessions = makeAgentSessionsState({
        selected: { status: 'running' },
        stopAll: vi.fn(async () => false)
      })
      mockUseAgentSessions.mockReturnValue(sessions)
      const { result } = renderWorkspace({ onConfirm: () => true })
      await selectCli(result, 'copilot')
      await waitFor(() => expect(result.current.agentCliKindPanel.isSwitching).toBe(false))
      expect(sessions.stopAll).toHaveBeenCalledOnce()
      expect(changeKind).not.toHaveBeenCalled()
    })

    it('動いているタブが無ければ確認せずに保存する(従来の方式の間も選べる)', async () => {
      setMode('legacy')
      const changeKind = setCliKind('claude')
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      await selectCli(result, 'copilot')
      await waitFor(() => expect(changeKind).toHaveBeenCalledWith('copilot'))
      expect(onConfirm).not.toHaveBeenCalled()
    })

    // changeKind は失敗を false で返し、stopAll は reject しないので本来は投げない。投げても選択肢を押せないまま
    // 残さず、Promise は捨てる側(onSelect)で記録して握る
    it('保存が投げてもロックを戻し、例外は記録して呼び出し元へ投げない', async () => {
      const changeKind = setCliKind('claude')
      const boom = new Error('boom')
      changeKind.mockRejectedValueOnce(boom)
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { result } = renderWorkspace()
      await selectCli(result, 'copilot')
      await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(String), boom))
      expect(result.current.agentCliKindPanel.isSwitching).toBe(false)
      // 再入防止の ref も戻っている(もう一度選べる)
      await selectCli(result, 'copilot')
      await waitFor(() => expect(changeKind).toHaveBeenCalledTimes(2))
    })

    // 押した処理の側でも止める(L-058)
    it('今と同じ種類を選んでも何もしない', async () => {
      const changeKind = setCliKind('claude')
      const { result } = renderWorkspace()
      await selectCli(result, 'claude')
      expect(changeKind).not.toHaveBeenCalled()
    })

    // 注記の「選び直すと保存します」のとおりに、選ばれている claude を押しても保存して不正な値を消す。種類は変わらないので
    // 動いているタブがあっても確認・停止はしない(動いているタブも同じ claude)
    it('保存されていた値が不正(invalid-value)な間は、今と同じ種類を選んでも確認・停止なしで保存する', async () => {
      const changeKind = setCliKind('claude', undefined, { fallback: 'invalid-value' })
      const sessions = makeAgentSessionsState({ selected: { status: 'running' } })
      mockUseAgentSessions.mockReturnValue(sessions)
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      await selectCli(result, 'claude')
      await waitFor(() => expect(changeKind).toHaveBeenCalledExactlyOnceWith('claude'))
      expect(onConfirm).not.toHaveBeenCalled()
      expect(sessions.stopAll).not.toHaveBeenCalled()
    })

    it('設定ファイルを読めなかった(read-failed)間は、今と同じ種類を選んでも何もしない', async () => {
      const changeKind = setCliKind('claude', undefined, { fallback: 'read-failed' })
      const { result } = renderWorkspace()
      await selectCli(result, 'claude')
      expect(changeKind).not.toHaveBeenCalled()
    })

    it('不正な値の間でも、別の種類を選ぶときは今までどおり確認して止めてから保存する', async () => {
      const changeKind = setCliKind('claude', undefined, { fallback: 'invalid-value' })
      const sessions = makeAgentSessionsState({ selected: { status: 'running' } })
      mockUseAgentSessions.mockReturnValue(sessions)
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      await selectCli(result, 'copilot')
      await waitFor(() => expect(changeKind).toHaveBeenCalledExactlyOnceWith('copilot'))
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(CLI_CHANGE_CONFIRM)
      expect(sessions.stopAll).toHaveBeenCalledOnce()
    })

    it('読み込み中(null)に選んでも何もしない', async () => {
      const changeKind = setCliKind(null)
      const { result } = renderWorkspace()
      await selectCli(result, 'copilot')
      expect(changeKind).not.toHaveBeenCalled()
    })

    it('起動中に選んでも何もしない', async () => {
      const changeKind = setCliKind('claude')
      const sessions = makeAgentSessionsState({ selected: { status: 'starting' } })
      mockUseAgentSessions.mockReturnValue(sessions)
      // 確認で OK を返しても止めない・保存しない(起動中の判定で止まることを確かめる)
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      await selectCli(result, 'copilot')
      expect(onConfirm).not.toHaveBeenCalled()
      expect(sessions.stopAll).not.toHaveBeenCalled()
      expect(changeKind).not.toHaveBeenCalled()
    })

    it('切り替えの途中は起動の理由を出し、実行方式も使う CLI も選べない。終わったら戻す', async () => {
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
      await selectCli(result, 'copilot')
      expect(mockUseAgentSessions).toHaveBeenLastCalledWith(
        expect.objectContaining({ startBlockedReason: AGENT_START_DISABLED_SWITCHING_CLI_KIND })
      )
      // 押した結果の切り替えの途中は isSwitching(部品は aria-disabled にしてフォーカスを保つ。L-157)で、isLocked(disabled)にはしない
      expect(result.current.executionModePanel.isSwitching).toBe(true)
      expect(result.current.agentCliKindPanel.isSwitching).toBe(true)
      expect(result.current.executionModePanel.isLocked).toBe(false)
      expect(result.current.agentCliKindPanel.isLocked).toBe(false)
      await act(async () => {
        finishStop()
      })
      await waitFor(() => expect(result.current.agentCliKindPanel.isSwitching).toBe(false))
      expect(result.current.executionModePanel.isSwitching).toBe(false)
      expect(mockUseAgentSessions).toHaveBeenLastCalledWith(
        expect.objectContaining({ startBlockedReason: null })
      )
    })

    it('使う CLI の切り替えで停止を待つ間は、両方の節の選べない理由に切り替えの途中の文言を出し、終わったら戻す', async () => {
      setMode('agent-cli')
      setCliKind('claude')
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
      await selectCli(result, 'copilot')
      // 途中は選択肢が aria-disabled になるので、押せない理由を両方の節に出す(読み上げで理由が分かるように)
      expect(result.current.agentCliKindPanel.lockedReason).toBe(
        AGENT_START_DISABLED_SWITCHING_CLI_KIND
      )
      expect(result.current.executionModePanel.lockedReason).toBe(
        AGENT_START_DISABLED_SWITCHING_CLI_KIND
      )
      await act(async () => {
        finishStop()
      })
      await waitFor(() => expect(result.current.agentCliKindPanel.isSwitching).toBe(false))
      expect(result.current.agentCliKindPanel.lockedReason).toBeNull()
      expect(result.current.executionModePanel.lockedReason).toBeNull()
    })

    it('実行方式の切り替えの途中は、使う CLI を選べず、選んでも何もしない(確認・停止・保存を重ねない)', async () => {
      const changeMode = setMode('agent-cli')
      const changeKind = setCliKind('claude')
      const sessions = makeAgentSessionsState({
        selected: { status: 'running' },
        stopAll: vi.fn(() => new Promise<boolean>(() => undefined))
      })
      mockUseAgentSessions.mockReturnValue(sessions)
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      await select(result, 'legacy')
      expect(result.current.agentCliKindPanel.isSwitching).toBe(true)
      expect(result.current.agentCliKindPanel.isLocked).toBe(false)
      await selectCli(result, 'copilot')
      // 共有の途中の印(useAgentWorkspaceSwitching の runSwitching)で止まる。止まらなければ 2 回目の確認と停止が起きる
      expect(onConfirm).toHaveBeenCalledOnce()
      expect(sessions.stopAll).toHaveBeenCalledOnce()
      expect(changeMode).not.toHaveBeenCalled()
      expect(changeKind).not.toHaveBeenCalled()
    })

    it('使う CLI の切り替えで停止を待つ間は、もう一度 CLI を選んでも実行方式を選んでも、確認・停止・保存を重ねない', async () => {
      const changeMode = setMode('agent-cli')
      const changeKind = setCliKind('claude')
      let finishStop: () => void = () => undefined
      const sessions = makeAgentSessionsState({
        selected: { status: 'running' },
        stopAll: vi.fn(
          () =>
            new Promise<boolean>((resolve) => {
              finishStop = () => resolve(true)
            })
        )
      })
      mockUseAgentSessions.mockReturnValue(sessions)
      const onConfirm = vi.fn(() => true)
      const { result } = renderWorkspace({ onConfirm })
      await selectCli(result, 'copilot')
      expect(onConfirm).toHaveBeenCalledOnce()
      expect(sessions.stopAll).toHaveBeenCalledOnce()
      // 停止を待つ間に、もう一度 CLI を選ぶ・実行方式を選ぶ(共有の途中の印(useAgentWorkspaceSwitching の runSwitching)で止まる)
      await selectCli(result, 'copilot')
      await select(result, 'legacy')
      expect(onConfirm).toHaveBeenCalledOnce()
      expect(sessions.stopAll).toHaveBeenCalledOnce()
      expect(changeKind).not.toHaveBeenCalled()
      expect(changeMode).not.toHaveBeenCalled()
      await act(async () => {
        finishStop()
      })
      await waitFor(() => expect(result.current.agentCliKindPanel.isSwitching).toBe(false))
      expect(changeKind).toHaveBeenCalledExactlyOnceWith('copilot')
      expect(changeMode).not.toHaveBeenCalled()
    })
  })

  describe('通知(useAgentNotifications)', () => {
    it('タブ・活動・通知の設定を渡し、読み上げの文言を返す', () => {
      const sessions = otherTabIs('running')
      mockUseAgentSessions.mockReturnValue(sessions)
      const activities = new Map([['slot-2', 'permission']])
      mockUseAgentActivity.mockReturnValue(activities)
      mockUseAgentNotificationSetting.mockReturnValue({
        enabled: false,
        saveError: null,
        changeEnabled: vi.fn(async () => true)
      })
      mockUseAgentNotifications.mockReturnValue('claude 2 が許可待ちになりました')
      const { result } = renderWorkspace()
      const options = mockUseAgentNotifications.mock.calls.at(-1)![0] as {
        tabs: unknown
        activities: unknown
        enabled: unknown
      }
      expect(options.tabs).toBe(sessions.tabs)
      expect(options.activities).toBe(activities)
      expect(options.enabled).toBe(false)
      expect(result.current.agentAnnouncement).toBe('claude 2 が許可待ちになりました')
    })

    it.each([
      ['agent-cli', true],
      ['legacy', false],
      [null, false]
    ] as const)('実行方式が %s なら isAgentMode に %s を渡す', (mode, expected) => {
      setMode(mode)
      renderWorkspace()
      const options = mockUseAgentNotifications.mock.calls.at(-1)![0] as { isAgentMode: unknown }
      expect(options.isAgentMode).toBe(expected)
    })

    it('通知を押したときの activateTab は、パネルを開いてタブを選び、描画の後にそのターミナルへフォーカスを移す', () => {
      setMode('agent-cli')
      const tabs = [1, 2].map((n) =>
        makeAgentSessionTabView({
          slotId: `slot-${n}`,
          label: `claude ${n}`,
          number: n,
          status: 'running'
        })
      )
      const selectTab = vi.fn((slotId: string) => {
        mockUseAgentSessions.mockReturnValue(
          makeAgentSessionsState({ tabs, selected: { slotId }, selectTab })
        )
      })
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ tabs, selected: { slotId: 'slot-1' }, selectTab })
      )
      const { result } = renderWorkspace()
      act(() => result.current.agentTerminal.layout.toggleOpen())
      const { activateTab } = mockUseAgentNotifications.mock.calls.at(-1)![0] as {
        activateTab: (slotId: string) => void
      }
      act(() => activateTab('slot-2'))
      expect(result.current.agentTerminal.layout.isOpen).toBe(true)
      expect(selectTab).toHaveBeenCalledWith('slot-2')
      expect(tabs[1].controller.focus).toHaveBeenCalledTimes(1)
      expect(tabs[0].controller.focus).not.toHaveBeenCalled()
    })

    // 確認はモーダルで背後を覆うため、開いたままターミナルへフォーカスを移すと、閉じるつもりの Esc が claude へ届く
    it('通知を押したとき、送信前の確認が開いていれば送らずに閉じてからタブへ移る', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      const tabs = [1, 2].map((n) =>
        makeAgentSessionTabView({
          slotId: `slot-${n}`,
          label: `claude ${n}`,
          number: n,
          status: 'running'
        })
      )
      const selectTab = vi.fn<(slotId: string) => void>()
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ tabs, selected: { slotId: 'slot-1' }, selectTab })
      )
      const { result } = renderWorkspace()
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
      })
      expect(result.current.agentSendConfirmDialog.pending).not.toBeNull()
      const { activateTab } = mockUseAgentNotifications.mock.calls.at(-1)![0] as {
        activateTab: (slotId: string) => void
      }
      act(() => activateTab('slot-2'))
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      expect(sender.send).not.toHaveBeenCalled()
      expect(selectTab).toHaveBeenCalledWith('slot-2')
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

    it('同じ優先の活動のタブが複数あれば、選択中のタブへ移る(選択中のタブを useAgentStatusBar へ渡す)', () => {
      setMode('agent-cli')
      const tabs = [1, 2].map((n) =>
        makeAgentSessionTabView({ slotId: `slot-${n}`, label: `claude ${n}`, status: 'running' })
      )
      const selectTab = vi.fn()
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ tabs, selected: { slotId: 'slot-2' }, selectTab })
      )
      mockUseAgentActivity.mockReturnValue(
        new Map([
          ['slot-1', 'permission'],
          ['slot-2', 'permission']
        ])
      )
      const { result } = renderWorkspace()
      act(() => result.current.statusBarAgent!.onActivate())
      expect(selectTab).toHaveBeenCalledExactlyOnceWith('slot-2')
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

  describe('前回の続きから(agentTerminal.resumeLast)', () => {
    const ID = '11111111-1111-4111-8111-111111111111'

    it('useAgentLastSession に開いているフォルダ・エージェント CLI 方式か・起動の確定の回数だけの取り直しの契機を渡す(動いているタブの ID は含めない)', () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({
          tabs: [
            makeAgentSessionTabView({ status: 'running', claudeSessionId: ID }),
            makeAgentSessionTabView({
              slotId: 'slot-2',
              label: 'claude 2',
              status: 'starting',
              claudeSessionId: 'x'
            })
          ],
          startConfirmedCount: 3
        })
      )
      renderWorkspace({ folderPath: '/p' })
      expect(mockUseAgentLastSession).toHaveBeenLastCalledWith({
        folderPath: '/p',
        enabled: true,
        refreshKey: '3'
      })
    })

    // 押せない理由の規則は agentResumeAvailability.test、組み立て(起動の理由の優先・押した時点の守り)は useAgentResume.test。
    // ここでは useAgentResume の結果を agentTerminal.resumeLast へ渡す配線だけを確かめる
    it('useAgentResume の理由を agentTerminal.resumeLast.disabledReason に渡す', () => {
      setMode('agent-cli')
      mockUseAgentLastSession.mockReturnValue({ kind: 'none' })
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.agentTerminal.resumeLast.disabledReason).toBe(
        'このフォルダで前回起動したセッションの記録がありません'
      )
    })

    it('押せるときは、そのタブで前回の ID を resume で起動する', () => {
      setMode('agent-cli')
      mockUseAgentLastSession.mockReturnValue({ kind: 'found', claudeSessionId: ID })
      const sessions = makeAgentSessionsState()
      mockUseAgentSessions.mockReturnValue(sessions)
      const { result } = renderWorkspace({ folderPath: '/p' })
      act(() => result.current.agentTerminal.resumeLast.onResume('slot-1'))
      expect(sessions.start).toHaveBeenCalledExactlyOnceWith('slot-1', {
        kind: 'resume',
        claudeSessionId: ID
      })
    })
  })

  describe('送り先の控え(describeSession)', () => {
    const ID = '11111111-1111-4111-8111-111111111111'

    it('送り先の describeSession は、呼んだ時点のタブの claude の会話の ID・名前・開いているフォルダを返す', async () => {
      setMode('agent-cli')
      setSendConfirmEnabled(false)
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      const tab = makeAgentSessionTabView({ status: 'running', claudeSessionId: ID })
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ tabs: [tab], selected: tab }))
      const { result, rerender } = renderWorkspace({ folderPath: '/p' })
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
      })
      const describeSession = vi.mocked(sender.send).mock.calls[0][1].describeSession
      expect(describeSession()).toEqual({
        claudeSessionId: ID,
        tabLabel: 'claude 1',
        folderPath: '/p'
      })
      // タブが起動し直した後に呼ぶと、その時点の ID を返す(控えるのは sender が送信の手順を始める時点)
      const restarted = { ...tab, claudeSessionId: '22222222-2222-4222-9222-222222222222' }
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ tabs: [restarted], selected: restarted })
      )
      rerender()
      expect(describeSession()?.claudeSessionId).toBe('22222222-2222-4222-9222-222222222222')
    })

    it('タブに claude の会話の ID が無い・タブが閉じられたら null', async () => {
      setMode('agent-cli')
      setSendConfirmEnabled(false)
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      const tab = makeAgentSessionTabView({ status: 'running', claudeSessionId: null })
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ tabs: [tab], selected: tab }))
      const { result, rerender } = renderWorkspace({ folderPath: '/p' })
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
      })
      const describeSession = vi.mocked(sender.send).mock.calls[0][1].describeSession
      expect(describeSession()).toBeNull()
      const other = makeAgentSessionTabView({
        slotId: 'slot-9',
        status: 'running',
        claudeSessionId: ID
      })
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ tabs: [other], selected: other })
      )
      rerender()
      expect(describeSession()).toBeNull()
    })

    it('確認を経由した送信でも、送り先に describeSession を付ける', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      const tab = makeAgentSessionTabView({ status: 'running', claudeSessionId: ID })
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ tabs: [tab], selected: tab }))
      const { result } = renderWorkspace({ folderPath: '/p' })
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
      })
      act(() => result.current.agentSendConfirmDialog.onConfirm())
      await waitFor(() => expect(sender.send).toHaveBeenCalledOnce())
      expect(vi.mocked(sender.send).mock.calls[0][1].describeSession()).toEqual({
        claudeSessionId: ID,
        tabLabel: 'claude 1',
        folderPath: '/p'
      })
    })
  })

  describe('履歴のエントリごとの操作(getHistoryActions・onResume)', () => {
    // 再開の押せない理由の規則と押した時点の守り(L-058)は useAgentResume.test・agentResumeAvailability.test。ここは再実行の
    // 条件(選択中のタブ)と、再開の結果の合成・足したタブへ移る配線を確かめる
    const ID = '11111111-1111-4111-8111-111111111111'
    const legacyEntry: HistoryEntry = {
      id: 'h1',
      promptId: 'p1',
      promptTitle: '要約',
      promptContent: '本文',
      fileContent: null,
      toolId: 'claude',
      status: 'success',
      resultText: '結果',
      errorMessage: null,
      executedAt: 1000,
      agent: null
    }
    const agentEntry: HistoryEntry = {
      ...legacyEntry,
      id: 'h2',
      status: 'sent',
      resultText: null,
      agent: { claudeSessionId: ID, tabLabel: 'claude 1', folderPath: '/p' }
    }

    it('従来のエントリは、再実行は今のまま・このセッションで再開は出さない(null)', () => {
      setMode('agent-cli')
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.getHistoryActions(legacyEntry)).toEqual({
        rerun: { disabled: true, reason: RERUN_DISABLED_AGENT_MODE },
        resume: null
      })
    })

    it.each([true, false])(
      '従来の方式では、実行中(%s)を従来のエントリの再実行の押せる状態に渡す',
      (isExecuting) => {
        setMode('legacy')
        const { result } = renderWorkspace({ folderPath: '/p', isExecuting })
        expect(result.current.getHistoryActions(legacyEntry).rerun).toEqual({
          disabled: isExecuting,
          reason: null
        })
      }
    )

    it('従来の方式では、エージェントのエントリの再実行・再開とも押せない理由を出す', () => {
      setMode('legacy')
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.getHistoryActions(agentEntry)).toEqual({
        rerun: { disabled: true, reason: RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE },
        resume: {
          disabled: true,
          reason: 'エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）'
        }
      })
    })

    it('エージェント CLI 方式では、再実行は選択中のタブの状態で、再開はフォルダ・動いているタブ・タブの上限で決まる', () => {
      setMode('agent-cli')
      const running = makeAgentSessionTabView({ status: 'running', claudeSessionId: ID })
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ tabs: [running], selected: running })
      )
      const { result, rerender } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.getHistoryActions(agentEntry)).toEqual({
        rerun: { disabled: false, reason: null },
        resume: { disabled: true, reason: 'このセッションは claude 1 で動いています' }
      })
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({
          addDisabledReason: 'タブは 4 つまでです（使わないタブを閉じると追加できます）'
        })
      )
      rerender()
      expect(result.current.getHistoryActions(agentEntry).resume).toEqual({
        disabled: true,
        reason: 'タブは 4 つまでです（使わないタブを閉じると追加できます）'
      })
      expect(result.current.getHistoryActions(agentEntry).rerun).toEqual({
        disabled: true,
        reason: RUN_DISABLED_NO_SESSION
      })
    })

    it('送信中は、エージェントのエントリの再実行を押せない(一覧の 実行 と同じ理由)', () => {
      setMode('agent-cli')
      mockUseAgentPromptSender.mockReturnValue(
        makeSender({ isSending: true, sendingSlotId: 'slot-1' })
      )
      const running = makeAgentSessionTabView({ status: 'running', claudeSessionId: ID })
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ tabs: [running], selected: running })
      )
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.getHistoryActions(agentEntry).rerun).toEqual({
        disabled: true,
        reason: RUN_DISABLED_SENDING
      })
    })

    it('onResume は新しいタブで再開し、パネルを開いてそのタブを選ぶ(+ と同じ。L-048)', () => {
      setMode('agent-cli')
      const selectTab = vi.fn<(slotId: string) => void>()
      const sessions = makeAgentSessionsState({
        selectTab,
        resumeInNewTab: vi.fn<AgentSessionsState['resumeInNewTab']>(() => 'slot-2')
      })
      mockUseAgentSessions.mockReturnValue(sessions)
      const { result } = renderWorkspace({ folderPath: '/p' })
      // useAgentTerminalPanel の初期は開いている(isOpen: true)。閉じてから、onResume で開き直すことを確かめる
      expect(result.current.agentTerminal.layout.isOpen).toBe(true)
      act(() => result.current.agentTerminal.layout.toggleOpen())
      expect(result.current.agentTerminal.layout.isOpen).toBe(false)
      act(() => result.current.onResume(agentEntry))
      expect(sessions.resumeInNewTab).toHaveBeenCalledExactlyOnceWith(ID)
      expect(selectTab).toHaveBeenCalledWith('slot-2')
      expect(result.current.agentTerminal.layout.isOpen).toBe(true)
    })
  })

  describe('中断の配線(agentTerminal.interrupt。本物の useAgentSessions・useAgentInterrupt。L-060)', () => {
    const CLAUDE_ID = '11111111-1111-4111-8111-111111111111'
    let startSpy: MockInstance<typeof window.api.startAgentSession> | null = null
    let interruptSpy: MockInstance<typeof window.api.interruptAgentSession> | null = null
    let slotId: string
    // 共有の偽のタブの画面を書き換えるので、終わったら戻す
    let screenController: FakeController | null = null
    let originalScreen: FakeController['screen'] | null = null

    beforeEach(async () => {
      const actual =
        await vi.importActual<typeof import('../useAgentSessions')>('../useAgentSessions')
      mockUseAgentSessions.mockImplementation(actual.useAgentSessions)
      setMode('agent-cli')
      startSpy = vi.spyOn(window.api, 'startAgentSession').mockResolvedValue({
        kind: 'started',
        sessionId: 'sid-wire',
        cliKind: 'claude',
        claudeSessionId: CLAUDE_ID
      })
      interruptSpy = vi
        .spyOn(window.api, 'interruptAgentSession')
        .mockResolvedValue({ kind: 'sent', followUp: null })
      // 文書ごとのタブの置き場(テストでは偽の controller の置き場)の選択中のタブを作業中の画面にする
      const snapshot = getAgentSessionTabs().getSnapshot()
      slotId = snapshot.selectedSlotId
      const controller = snapshot.tabs.find((tab) => tab.slotId === slotId)
        ?.controller as FakeController
      screenController = controller
      originalScreen = controller.screen
      controller.screen = agentScreen('working').lines
      mockUseAgentActivity.mockReturnValue(new Map([[slotId, 'working']]))
    })

    afterEach(() => {
      if (screenController !== null && originalScreen !== null) {
        screenController.screen = originalScreen
      }
      screenController = null
      originalScreen = null
      startSpy?.mockRestore()
      interruptSpy?.mockRestore()
    })

    const renderStarted = async (): Promise<Rendered> => {
      const rendered = renderWorkspace({ folderPath: '/p' })
      await act(async () => {
        await rendered.result.current.agentTerminal.sessions.start(slotId, { kind: 'new' })
      })
      return rendered
    }

    it('作業中の選択中のタブで onInterrupt を呼ぶと、window.api.interruptAgentSession をそのタブの sessionId で呼び、読み上げる', async () => {
      const { result } = await renderStarted()
      expect(result.current.agentTerminal.interrupt.visible).toBe(true)
      expect(result.current.agentTerminal.interrupt.disabledReason).toBeNull()
      await act(async () => {
        result.current.agentTerminal.interrupt.onInterrupt()
      })
      expect(interruptSpy).toHaveBeenCalledExactlyOnceWith('sid-wire')
      const label = result.current.agentTerminal.sessions.selected.label
      expect(result.current.agentTerminal.interrupt.notice?.text).toBe(
        agentInterruptSentNotice(label, 'claude')
      )
    })

    it('送信中は理由を出し、押しても呼ばない', async () => {
      const { result, rerender } = await renderStarted()
      mockUseAgentPromptSender.mockReturnValue(
        makeSender({ isSending: true, sendingSlotId: slotId })
      )
      // 送信中の値で描き直す
      rerender()
      expect(result.current.agentTerminal.interrupt.disabledReason).toBe(
        AGENT_INTERRUPT_DISABLED_SENDING
      )
      await act(async () => {
        result.current.agentTerminal.interrupt.onInterrupt()
      })
      expect(interruptSpy).not.toHaveBeenCalled()
    })

    it('送信前の確認の表示中は理由を出し、押しても呼ばない', async () => {
      const { result } = await renderStarted()
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
      })
      expect(result.current.agentSendConfirmDialog.pending).not.toBeNull()
      expect(result.current.agentTerminal.interrupt.disabledReason).toBe(
        AGENT_INTERRUPT_DISABLED_SEND_CONFIRM
      )
      await act(async () => {
        result.current.agentTerminal.interrupt.onInterrupt()
      })
      expect(interruptSpy).not.toHaveBeenCalled()
    })
  })

  describe('使う CLI の配線(本物の useAgentSessions。L-060)', () => {
    const CLAUDE_ID = '11111111-1111-4111-8111-111111111111'
    let startSpy: MockInstance<typeof window.api.startAgentSession> | null = null
    let slotId: string
    const agentEntry: HistoryEntry = {
      id: 'h-wire',
      promptId: 'p1',
      promptTitle: '要約',
      promptContent: '本文',
      fileContent: null,
      toolId: 'claude',
      status: 'sent',
      resultText: null,
      errorMessage: null,
      executedAt: 1000,
      agent: { claudeSessionId: CLAUDE_ID, tabLabel: 'claude 1', folderPath: '/p' }
    }

    beforeEach(async () => {
      const actual =
        await vi.importActual<typeof import('../useAgentSessions')>('../useAgentSessions')
      mockUseAgentSessions.mockImplementation(actual.useAgentSessions)
      setMode('agent-cli')
      slotId = getAgentSessionTabs().getSnapshot().selectedSlotId
    })

    afterEach(() => {
      startSpy?.mockRestore()
      startSpy = null
    })

    const startWith = async (result: Rendered['result'], cliKind: AgentCliKind): Promise<void> => {
      startSpy = vi.spyOn(window.api, 'startAgentSession').mockResolvedValue({
        kind: 'started',
        sessionId: 'sid-cli',
        cliKind,
        claudeSessionId: cliKind === 'claude' ? CLAUDE_ID : null
      })
      await act(async () => {
        await result.current.agentTerminal.sessions.start(slotId, { kind: 'new' })
      })
    }

    it('設定が copilot なら、未起動のタブの名前は copilot で、起動すると実行と中断は活動の理由で押せず、前回の続きから・このセッションで再開は copilot の理由で押せない', async () => {
      setCliKind('copilot')
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.agentTerminal.sessions.selected.label).toBe('copilot 1')
      await startWith(result, 'copilot')
      expect(result.current.promptRun).toMatchObject({
        isRunDisabled: true,
        runDisabledReason: agentSendBlockedByActivityReason('unknown', 'copilot')
      })
      // 段階 2a で copilot も中断の能力を持つ。活動が未判定(unknown)なので活動の理由で押せない
      expect(result.current.agentTerminal.interrupt.disabledReason).toBe(
        agentInterruptBlockedByActivityReason('unknown', 'copilot')
      )
      expect(result.current.agentTerminal.resumeLast.disabledReason).toBe(
        agentResumeLastUnsupportedReason('copilot')
      )
      expect(result.current.getHistoryActions(agentEntry).resume?.reason).toBe(
        agentResumeEntryUnsupportedReason('copilot')
      )
    })

    it('起動の結果が copilot なら、設定が claude のままでも(別のウィンドウで変えた場合)そのタブの実行は copilot の活動で決まる', async () => {
      setCliKind('claude')
      const { result } = renderWorkspace({ folderPath: '/p' })
      await startWith(result, 'copilot')
      expect(result.current.agentTerminal.sessions.selected).toMatchObject({
        cliKind: 'copilot',
        label: 'copilot 1'
      })
      expect(result.current.promptRun.runDisabledReason).toBe(
        agentSendBlockedByActivityReason('unknown', 'copilot')
      )
      // 再開の入口は設定の種類(claude)で決まる
      expect(result.current.agentTerminal.resumeLast.disabledReason).not.toBe(
        agentResumeLastUnsupportedReason('copilot')
      )
    })

    it('設定も起動の結果も claude なら、今までどおり実行を押せる', async () => {
      setCliKind('claude')
      const { result } = renderWorkspace({ folderPath: '/p' })
      await startWith(result, 'claude')
      expect(result.current.promptRun).toMatchObject({
        isRunDisabled: false,
        runDisabledReason: null
      })
    })
  })

  describe('copilot の配線(本物の useAgentSessions・useAgentActivity・useAgentInterrupt・useAgentNotifications。L-060)', () => {
    let startSpy: MockInstance<typeof window.api.startAgentSession> | null = null
    let interruptSpy: MockInstance<typeof window.api.interruptAgentSession> | null = null
    let followUpSpy: MockInstance<typeof window.api.interruptAgentSessionFollowUp> | null = null
    let showSpy: MockInstance<typeof window.api.showAgentNotification> | null = null
    let stopSpy: MockInstance<typeof window.api.stopAgentSession> | null = null
    let slotId: string
    // 共有の偽のタブの画面を書き換えるので、終わったら戻す
    let controller: FakeController | null = null
    let originalScreen: FakeController['screen'] | null = null
    let originalWrite: FakeController['writeToSession'] | null = null

    beforeEach(async () => {
      const sessions =
        await vi.importActual<typeof import('../useAgentSessions')>('../useAgentSessions')
      const activity =
        await vi.importActual<typeof import('../useAgentActivity')>('../useAgentActivity')
      const notifications = await vi.importActual<typeof import('../useAgentNotifications')>(
        '../useAgentNotifications'
      )
      mockUseAgentSessions.mockImplementation(sessions.useAgentSessions)
      mockUseAgentActivity.mockImplementation(activity.useAgentActivity)
      mockUseAgentNotifications.mockImplementation((options) =>
        notifications.useAgentNotifications(options as UseAgentNotificationsOptions)
      )
      setMode('agent-cli')
      setCliKind('copilot')
      startSpy = vi.spyOn(window.api, 'startAgentSession').mockResolvedValue({
        kind: 'started',
        sessionId: 'sid-copilot',
        cliKind: 'copilot',
        claudeSessionId: null
      })
      interruptSpy = vi
        .spyOn(window.api, 'interruptAgentSession')
        .mockResolvedValue({ kind: 'sent', followUp: { afterMs: 100 } })
      followUpSpy = vi
        .spyOn(window.api, 'interruptAgentSessionFollowUp')
        .mockResolvedValue({ kind: 'sent' })
      showSpy = vi.spyOn(window.api, 'showAgentNotification').mockResolvedValue(undefined)
      const snapshot = getAgentSessionTabs().getSnapshot()
      slotId = snapshot.selectedSlotId
      controller = snapshot.tabs.find((tab) => tab.slotId === slotId)?.controller as FakeController
      originalScreen = controller.screen
      originalWrite = controller.writeToSession
      controller.screen = copilotScreen('working3000').lines
    })

    afterEach(() => {
      if (controller !== null && originalScreen !== null) controller.screen = originalScreen
      if (controller !== null && originalWrite !== null) controller.writeToSession = originalWrite
      controller = null
      originalScreen = null
      originalWrite = null
      startSpy?.mockRestore()
      interruptSpy?.mockRestore()
      followUpSpy?.mockRestore()
      showSpy?.mockRestore()
      stopSpy?.mockRestore()
      stopSpy = null
      // テストで足したタブが残っていたら消し、選択を元のタブへ戻す(タブの置き場は共有)
      const tabsStore = getAgentSessionTabs()
      for (const tab of tabsStore.getSnapshot().tabs) {
        if (tab.slotId !== slotId) tabsStore.remove(tab.slotId)
      }
      tabsStore.select(slotId)
    })

    it('作業中の画面で帯が作業中になり、中断で 1 回目と 2 回目を同じ sessionId で頼み、入力待ちに変わると copilot の名前で通知を頼む', async () => {
      const rendered = renderWorkspace({ folderPath: '/p' })
      const { result } = rendered
      await act(async () => {
        await result.current.agentTerminal.sessions.start(slotId, { kind: 'new' })
      })
      act(() => controller?.emitOutputWritten())
      await waitFor(() =>
        expect(result.current.agentTerminal.activities.get(slotId)).toBe('working')
      )
      const { label, number } = result.current.agentTerminal.sessions.selected
      expect(label).toBe(`copilot ${number}`)
      await act(async () => {
        result.current.agentTerminal.interrupt.onInterrupt()
      })
      expect(interruptSpy).toHaveBeenCalledExactlyOnceWith('sid-copilot')
      await waitFor(() => expect(followUpSpy).toHaveBeenCalledExactlyOnceWith('sid-copilot'))
      await waitFor(() =>
        expect(result.current.agentTerminal.interrupt.notice?.text).toBe(
          agentInterruptSentNotice(label, 'copilot')
        )
      )
      if (controller !== null) controller.screen = copilotScreen('interrupted').lines
      act(() => controller?.emitOutputWritten())
      await waitFor(() => expect(result.current.agentTerminal.activities.get(slotId)).toBe('idle'))
      await waitFor(() =>
        expect(showSpy).toHaveBeenCalledWith({
          slotId,
          tabNumber: number,
          kind: 'done',
          cliKind: 'copilot'
        })
      )
    })

    it('連打しても 1 回目は 1 回だけ main に届き、2 回目の流れが終わった時点から 1,000ms は押し直しても届かない(L-408)', async () => {
      // 2 回目の流れを長めにし、押した時点から 1,000ms を過ぎても、流れの終わりから 1,000ms 以内の時点を作る
      interruptSpy?.mockResolvedValue({ kind: 'sent', followUp: { afterMs: 600 } })
      const { result } = renderWorkspace({ folderPath: '/p' })
      await act(async () => {
        await result.current.agentTerminal.sessions.start(slotId, { kind: 'new' })
      })
      act(() => controller?.emitOutputWritten())
      await waitFor(() =>
        expect(result.current.agentTerminal.activities.get(slotId)).toBe('working')
      )
      const pressedAt = Date.now()
      // 同じタブを続けて押す(1 回目の結果・2 回目を待つ間は同期の再入の防止で何もしない)
      for (let i = 0; i < 3; i += 1) {
        await act(async () => {
          result.current.agentTerminal.interrupt.onInterrupt()
        })
      }
      expect(interruptSpy).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(followUpSpy).toHaveBeenCalledTimes(1))
      await waitFor(() =>
        expect(result.current.agentTerminal.interrupt.notice?.text).toBe(
          agentInterruptSentNotice(result.current.agentTerminal.sessions.selected.label, 'copilot')
        )
      )
      // 押した時点から 1,000ms を過ぎる(待ちを押した時点から数えていたら、ここで押せてしまう)
      const rest = pressedAt + AGENT_INTERRUPT_COOLDOWN_MS + 100 - Date.now()
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, rest)))
      })
      await act(async () => {
        result.current.agentTerminal.interrupt.onInterrupt()
      })
      expect(interruptSpy).toHaveBeenCalledTimes(1)
      expect(result.current.agentTerminal.interrupt.notice?.text).toBe(
        AGENT_INTERRUPT_DISABLED_COOLDOWN
      )
    })
    it('2 回目を待つ間に送った先のタブを閉じたら、その画面を読まず 2 回目も頼まず、読み上げない(isTabOpen の配線)', async () => {
      interruptSpy?.mockResolvedValue({ kind: 'sent', followUp: { afterMs: 300 } })
      stopSpy = vi.spyOn(window.api, 'stopAgentSession').mockResolvedValue(undefined)
      startSpy?.mockResolvedValueOnce({
        kind: 'started',
        sessionId: 'sid-copilot-2',
        cliKind: 'copilot',
        claudeSessionId: null
      })
      const onConfirm = vi.fn(() => true)
      // 閉じられるように 2 つ目のタブを足し(足したタブが選択される)、そのタブで中断する
      const tabsStore = getAgentSessionTabs()
      tabsStore.add()
      const target = tabsStore.getSnapshot().tabs.at(-1)
      const targetSlotId = target?.slotId ?? ''
      const targetController = target?.controller as FakeController
      expect(targetSlotId).not.toBe(slotId)
      targetController.screen = copilotScreen('working3000').lines
      const readScreenSpy = vi.spyOn(targetController, 'readScreen')
      const { result } = renderWorkspace({ folderPath: '/p', onConfirm })
      expect(result.current.agentTerminal.sessions.selected.slotId).toBe(targetSlotId)
      await act(async () => {
        await result.current.agentTerminal.sessions.start(targetSlotId, { kind: 'new' })
      })
      act(() => targetController.emitOutputWritten())
      await waitFor(() =>
        expect(result.current.agentTerminal.activities.get(targetSlotId)).toBe('working')
      )
      await act(async () => {
        result.current.agentTerminal.interrupt.onInterrupt()
      })
      expect(interruptSpy).toHaveBeenCalledExactlyOnceWith('sid-copilot-2')
      // 1 回目の結果が返った後、afterMs の前に閉じる(確認は true・停止はすぐ解決)
      readScreenSpy.mockClear()
      const closedAt = Date.now()
      await act(async () => {
        expect(await result.current.agentTerminal.sessions.closeTab(targetSlotId)).toBe(true)
      })
      expect(Date.now() - closedAt).toBeLessThan(300)
      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(stopSpy).toHaveBeenCalledExactlyOnceWith('sid-copilot-2')
      expect(result.current.agentTerminal.sessions.tabs.map((tab) => tab.slotId)).not.toContain(
        targetSlotId
      )
      // afterMs を過ぎるまで待つ
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 450))
      })
      expect(followUpSpy).not.toHaveBeenCalled()
      expect(readScreenSpy).not.toHaveBeenCalled()
      expect(result.current.agentTerminal.interrupt.notice).toBeNull()
    })
    it('2 回目を待つ間に別のタブを選んでも、送った先のタブが開いていて作業中なら、送った先の sessionId で 2 回目を頼む(isTabOpen の配線)', async () => {
      interruptSpy?.mockResolvedValue({ kind: 'sent', followUp: { afterMs: 300 } })
      startSpy?.mockResolvedValueOnce({
        kind: 'started',
        sessionId: 'sid-copilot-2',
        cliKind: 'copilot',
        claudeSessionId: null
      })
      // 2 つ目のタブを足し(足したタブが選択される)、そのタブで中断する
      const tabsStore = getAgentSessionTabs()
      tabsStore.add()
      const target = tabsStore.getSnapshot().tabs.at(-1)
      const targetSlotId = target?.slotId ?? ''
      const targetController = target?.controller as FakeController
      expect(targetSlotId).not.toBe(slotId)
      targetController.screen = copilotScreen('working3000').lines
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.agentTerminal.sessions.selected.slotId).toBe(targetSlotId)
      await act(async () => {
        await result.current.agentTerminal.sessions.start(targetSlotId, { kind: 'new' })
      })
      act(() => targetController.emitOutputWritten())
      await waitFor(() =>
        expect(result.current.agentTerminal.activities.get(targetSlotId)).toBe('working')
      )
      await act(async () => {
        result.current.agentTerminal.interrupt.onInterrupt()
      })
      expect(interruptSpy).toHaveBeenCalledExactlyOnceWith('sid-copilot-2')
      // 1 回目の結果が返った後、afterMs の前に元のタブを選ぶ(送った先のタブは開いたまま)
      act(() => tabsStore.select(slotId))
      expect(result.current.agentTerminal.sessions.selected.slotId).toBe(slotId)
      expect(followUpSpy).not.toHaveBeenCalled()
      await waitFor(() => expect(followUpSpy).toHaveBeenCalledExactlyOnceWith('sid-copilot-2'))
    })

    // 送信の配線: 本物の sender(useAgentPromptSender)を使う。偽の controller の画面は、貼り付けで記録の echo の画面(atref2Paste)、
    // \r で送った後の画面(aeInstantEnd)に変える
    const COPILOT_TEXT = '本文\n\n- @file.txt'
    const installRealSender = async (): Promise<void> => {
      const sender =
        await vi.importActual<typeof import('../useAgentPromptSender')>('../useAgentPromptSender')
      mockUseAgentPromptSender.mockImplementation(sender.useAgentPromptSender)
    }
    const echoOnWrite = (target: FakeController): void => {
      const write = target.writeToSession
      target.writeToSession = (data) => {
        write(data)
        if (data.startsWith('\x1b[200~')) target.screen = copilotInputScreen('atref2Paste').lines
        if (data === '\r') target.screen = copilotInputScreen('aeInstantEnd').lines
      }
    }
    const startIdle = async (result: Rendered['result']): Promise<void> => {
      if (controller !== null) controller.screen = copilotInputScreen('empty').lines
      await act(async () => {
        await result.current.agentTerminal.sessions.start(slotId, { kind: 'new' })
      })
      act(() => controller?.emitOutputWritten())
      await waitFor(() => expect(result.current.agentTerminal.activities.get(slotId)).toBe('idle'))
    }

    it('入力待ちの copilot のタブへ、実行(送信前の確認はオフ)で貼り付けと \\r を書き、送れたことを確かめて通知し、onSent に copilot を渡す', async () => {
      await installRealSender()
      setSendConfirmEnabled(false)
      const { result } = renderWorkspace({ folderPath: '/p' })
      await startIdle(result)
      expect(result.current.promptRun).toMatchObject({
        isRunDisabled: false,
        runDisabledReason: null
      })
      if (controller === null) throw new Error('controller がありません')
      echoOnWrite(controller)
      const writesBefore = controller.writes.length
      const onSent = vi.fn()
      await act(async () => {
        await result.current.sendToAgent(COPILOT_TEXT, { promptId: 'p1', unsavedPaths: [], onSent })
      })
      expect(controller.writes.slice(writesBefore)).toEqual([
        buildAgentPasteBytes(`${COPILOT_TEXT} `),
        '\r'
      ])
      expect(result.current.promptRun.agentSend?.notice?.text).toBe(AGENT_SENT_NOTICE)
      expect(onSent).toHaveBeenCalledExactlyOnceWith(null, 'copilot')
    })

    it('画面が作業中になると実行の理由が copilot の作業中の理由になり、確認を開いた後に作業中になると確認の理由も同じになる', async () => {
      const { result } = renderWorkspace({ folderPath: '/p' })
      await startIdle(result)
      await act(async () => {
        await result.current.sendToAgent(COPILOT_TEXT, { promptId: 'p1', unsavedPaths: [] })
      })
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBeNull()
      if (controller !== null) controller.screen = copilotScreen('working3000').lines
      act(() => controller?.emitOutputWritten())
      const working = agentSendBlockedByActivityReason('working', 'copilot')
      await waitFor(() =>
        expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(working)
      )
      expect(result.current.promptRun.runDisabledReason).toBe(working)
    })

    it('中断を押した直後に実行すると、sender が押した時点の中断の流れで interrupting として断り、何も書かない(isInterrupting の配線)', async () => {
      await installRealSender()
      setSendConfirmEnabled(false)
      const { result } = renderWorkspace({ folderPath: '/p' })
      await act(async () => {
        await result.current.agentTerminal.sessions.start(slotId, { kind: 'new' })
      })
      act(() => controller?.emitOutputWritten())
      await waitFor(() =>
        expect(result.current.agentTerminal.activities.get(slotId)).toBe('working')
      )
      await act(async () => {
        result.current.agentTerminal.interrupt.onInterrupt()
      })
      expect(interruptSpy).toHaveBeenCalledExactlyOnceWith('sid-copilot')
      expect(result.current.promptRun.runDisabledReason).toBe(RUN_DISABLED_INTERRUPTING)
      if (controller === null) throw new Error('controller がありません')
      const writesBefore = controller.writes.length
      let outcome: AgentPromptSendResult | undefined
      await act(async () => {
        outcome = await result.current.sendToAgent(COPILOT_TEXT, {
          promptId: 'p1',
          unsavedPaths: []
        })
      })
      expect(outcome).toEqual({ kind: 'failed', reason: 'interrupting' })
      expect(result.current.promptRun.agentSend?.error).toBe(RUN_DISABLED_INTERRUPTING)
      expect(controller.writes.slice(writesBefore)).toEqual([])
      // 2 回目の流れを終わらせてから抜ける(タイマーを残さない)
      await waitFor(() => expect(followUpSpy).toHaveBeenCalledExactlyOnceWith('sid-copilot'))
    })

    it('中断を押した同じ act の中で(再描画を挟まずに)実行しても、sender が押した時点の ref で interrupting として断る(描画の state でなく ref を見る)', async () => {
      await installRealSender()
      setSendConfirmEnabled(false)
      const { result } = renderWorkspace({ folderPath: '/p' })
      await act(async () => {
        await result.current.agentTerminal.sessions.start(slotId, { kind: 'new' })
      })
      act(() => controller?.emitOutputWritten())
      await waitFor(() =>
        expect(result.current.agentTerminal.activities.get(slotId)).toBe('working')
      )
      if (controller === null) throw new Error('controller がありません')
      const writesBefore = controller.writes.length
      // 押す前の描画の値を控え、再描画の後の値を使わない(描画の上では作業中の理由のままで、中断の流れの理由ではない)
      const { onInterrupt } = result.current.agentTerminal.interrupt
      const { sendToAgent } = result.current
      expect(result.current.promptRun.runDisabledReason).toBe(
        agentSendBlockedByActivityReason('working', 'copilot')
      )
      let outcome: AgentPromptSendResult | undefined
      await act(async () => {
        onInterrupt()
        outcome = await sendToAgent(COPILOT_TEXT, { promptId: 'p1', unsavedPaths: [] })
      })
      expect(interruptSpy).toHaveBeenCalledExactlyOnceWith('sid-copilot')
      expect(outcome).toEqual({ kind: 'failed', reason: 'interrupting' })
      expect(result.current.promptRun.agentSend?.error).toBe(RUN_DISABLED_INTERRUPTING)
      expect(controller.writes.slice(writesBefore)).toEqual([])
      // 2 回目の流れを終わらせてから抜ける(タイマーを残さない)
      await waitFor(() => expect(followUpSpy).toHaveBeenCalledExactlyOnceWith('sid-copilot'))
      // sender へ渡す関数は参照が安定(ref から引く)ので、中断の流れの間の再描画をまたいでも送信の関数は同じ参照
      // (usePromptRunner の useCallback の依存を壊さない)
      expect(result.current.sendToAgent).toBe(sendToAgent)
    })
  })
})
