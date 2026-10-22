import { renderHook, act, waitFor } from '@testing-library/react'
import { StrictMode, createElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/agentTerminalApi')

import * as agentTerminalApi from '../../lib/agentTerminalApi'
import { useAgentSessions } from '../useAgentSessions'
import type {
  AgentInterruptFollowUpOutcome,
  AgentInterruptOutcome,
  AgentSessionsState,
  UseAgentSessionsOptions
} from '../useAgentSessions'
import type { AgentSessionTabs } from '../../lib/agentSessionTabs'
import { makeFakeAgentSessionTabs } from '../../__tests__/makeFakeAgentSessionTabs'
import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'
import {
  AGENT_ADD_TAB_DISABLED_LIMIT,
  AGENT_TOO_MANY_SESSIONS,
  agentCloseTabConfirm
} from '../../lib/agentSessionMessages'
import type { AgentCliKind } from '@shared/agentCliKinds'
import { AGENT_MAX_SESSIONS_PER_WINDOW, AGENT_START_CANCELED_DETAIL } from '@shared/types'
import type {
  AgentInterruptFollowUpResult,
  AgentInterruptResult,
  AgentLaunchRequest,
  AgentSessionExit,
  AgentSessionSnapshotEntry,
  AgentStartResult
} from '@shared/types'

const CSID = '11111111-1111-4111-8111-111111111111'
const CSID2 = '22222222-2222-4222-9222-222222222222'
const NEW: AgentLaunchRequest = { kind: 'new' }
const resumeOf = (claudeSessionId: string): AgentLaunchRequest => ({
  kind: 'resume',
  claudeSessionId
})

const mockStart = vi.mocked(agentTerminalApi.startAgentSession)
const mockStop = vi.mocked(agentTerminalApi.stopAgentSession)
const mockGetState = vi.mocked(agentTerminalApi.getAgentSessions)
const mockOnExit = vi.mocked(agentTerminalApi.onAgentExit)
const mockInterrupt = vi.mocked(agentTerminalApi.interruptAgentSession)

// 終了の購読は hook が agentTerminalApi.onAgentExit を直接張る。購読者を控え、テストから終了を流す
let exitListeners: Set<(exit: AgentSessionExit) => void>
const emitExit = (exit: AgentSessionExit): void =>
  exitListeners.forEach((listener) => listener(exit))

let tabs: AgentSessionTabs
let now = 0
// 描画ごとに新しい関数を渡さない(本番の既定の Date.now と同じく参照を安定させ、終了の購読を張り直さない)
const currentNow = (): number => now

const controllerOf = (slotId: string): FakeController =>
  tabs.getSnapshot().tabs.find((tab) => tab.slotId === slotId)!.controller as FakeController
const tabOf = (state: AgentSessionsState, slotId: string): AgentSessionsState['tabs'][number] =>
  state.tabs.find((tab) => tab.slotId === slotId)!

beforeEach(() => {
  vi.resetAllMocks()
  exitListeners = new Set()
  mockOnExit.mockImplementation((listener) => {
    exitListeners.add(listener)
    return () => {
      exitListeners.delete(listener)
    }
  })
  // タブの置き場は本物に偽の controller を入れる。slotId は slot-1, slot-2, ...
  tabs = makeFakeAgentSessionTabs()
  now = 0
  mockGetState.mockResolvedValue([])
  mockStop.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

type Rendered = ReturnType<typeof renderHook<AgentSessionsState, unknown>>

const render = (options: Partial<UseAgentSessionsOptions> = {}): Rendered =>
  renderHook(() =>
    useAgentSessions({
      folderPath: '/work',
      tabs,
      enabled: true,
      now: currentNow,
      appCliKind: 'claude',
      ...options
    })
  )

const renderStrict = (): Rendered =>
  renderHook(
    () =>
      useAgentSessions({
        folderPath: '/work',
        tabs,
        enabled: true,
        now: currentNow,
        appCliKind: 'claude'
      }),
    {
      wrapper: ({ children }) => createElement(StrictMode, null, children)
    }
  )

// タブ 1 つの場合: 選択中のタブ(slot-1)を起動する
const startSelected = async (result: Rendered['result']): Promise<void> => {
  await act(async () => {
    await result.current.start(result.current.selected.slotId, NEW)
  })
}

// タブ 2 つを s-1・s-2 で動かす
const runTwoTabs = async (result: Rendered['result']): Promise<void> => {
  mockStart
    .mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's-1',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    .mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's-2',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
  await startSelected(result)
  await act(async () => {
    await result.current.addTab()
  })
}

describe('useAgentSessions — タブ 1 つの場合', () => {
  it('初期状態はタブ 1 つ(claude 1・none)を選択している', () => {
    const { result } = render()
    expect(result.current.tabs.map((tab) => [tab.slotId, tab.label, tab.status])).toEqual([
      ['slot-1', 'claude 1', 'none']
    ])
    expect(result.current.selected.slotId).toBe('slot-1')
    expect(result.current.selected.controller).toBe(controllerOf('slot-1'))
  })

  it('フォルダがあれば起動・追加を押せない理由は無く、無ければ理由を出す', () => {
    const { result } = render()
    expect(result.current.startDisabledReason).toBeNull()
    expect(result.current.addDisabledReason).toBeNull()
    const noFolder = render({ folderPath: null }).result.current
    expect(noFolder.startDisabledReason).toBe('フォルダを開いてください')
    expect(noFolder.addDisabledReason).toBe('フォルダを開いてください')
  })

  it('起動の直前に画面を消し、測った桁数・行数で起動し、running にしてセッションを controller に渡す', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    const { result } = render()
    await startSelected(result)
    expect(controllerOf('slot-1').prepareForStart).toHaveBeenCalledOnce()
    expect(mockStart).toHaveBeenCalledWith({
      slotId: 'slot-1',
      folderPath: '/work',
      cols: 80,
      rows: 24,
      launch: NEW
    })
    expect(result.current.selected.status).toBe('running')
    expect(controllerOf('slot-1').sessionId).toBe('s1')
  })

  it.each([
    [{ kind: 'error' as const, error: 'no-folder' as const }, 'フォルダを開いてください'],
    [
      { kind: 'error' as const, error: 'folder-mismatch' as const },
      '開いているフォルダが切り替わりました。もう一度「起動」を押してください'
    ],
    [
      { kind: 'error' as const, error: 'folder-missing' as const, detail: '/work' },
      '開いているフォルダが見つかりません: /work'
    ],
    [
      {
        kind: 'error' as const,
        error: 'command-not-found' as const,
        cliKind: 'claude' as const,
        shellPathUnavailable: false
      },
      'claude コマンドが見つかりません。Claude Code をインストールしてください（探した場所: ログインシェルの PATH）'
    ],
    [
      { kind: 'error' as const, error: 'spawn-failed' as const, detail: 'boom' },
      'エージェントを起動できませんでした: boom'
    ],
    [{ kind: 'error' as const, error: 'too-many-sessions' as const }, AGENT_TOO_MANY_SESSIONS]
  ])('起動の失敗 %o の文言をそのタブに出し none に戻す', async (startResult, message) => {
    mockStart.mockResolvedValueOnce(startResult)
    const { result } = render()
    await startSelected(result)
    expect(result.current.selected.error).toBe(message)
    expect(result.current.selected.status).toBe('none')
    expect(controllerOf('slot-1').sessionId).toBeNull()
  })

  it('起動中・起動済みの 2 回目の start は依頼しない', async () => {
    let resolve: (value: AgentStartResult) => void = () => undefined
    mockStart.mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    const { result } = render()
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.start('slot-1', NEW)
    })
    expect(result.current.selected.status).toBe('starting')
    await act(async () => {
      await result.current.start('slot-1', NEW)
    })
    await act(async () => {
      resolve({ kind: 'started', sessionId: 's1', cliKind: 'claude', claudeSessionId: CSID })
      await first
    })
    await act(async () => {
      await result.current.start('slot-1', NEW)
    })
    expect(mockStart).toHaveBeenCalledOnce()
  })

  it('フォルダが無ければ start は依頼しない', async () => {
    const { result } = render({ folderPath: null })
    await startSelected(result)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('自分のセッションの終了で exited にし、終了コードを持つ。ほかのセッションの終了は無視する', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    const { result } = render()
    await startSelected(result)
    act(() => emitExit({ sessionId: 'other', exitCode: 1, signal: null, reason: 'exited' }))
    expect(result.current.selected.status).toBe('running')
    now = 10_000
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' }))
    expect(result.current.selected.status).toBe('exited')
    expect(result.current.selected.exit).toEqual({ exitCode: 0, reason: 'exited' })
    expect(result.current.selected.error).toBeNull()
    expect(controllerOf('slot-1').sessionId).toBeNull()
  })

  it('起動の直後(2 秒以内)に終了コード ≠ 0 で終わったら案内を添える', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    const { result } = render()
    await startSelected(result)
    now = 1_999
    act(() => emitExit({ sessionId: 's1', exitCode: 1, signal: null, reason: 'exited' }))
    expect(result.current.selected.error).toBe(
      '起動の直後に終了しました。ターミナルの表示を確かめてください'
    )
  })

  it('stop はそのタブのセッションを止めて true。セッションが無ければ何もせず true', async () => {
    const { result } = render()
    let stopped: boolean | undefined
    await act(async () => {
      stopped = await result.current.stop('slot-1')
    })
    expect(stopped).toBe(true)
    expect(mockStop).not.toHaveBeenCalled()
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    await startSelected(result)
    await act(async () => {
      stopped = await result.current.stop('slot-1')
    })
    expect(stopped).toBe(true)
    expect(mockStop).toHaveBeenCalledWith('s1')
  })

  it('stop が失敗したら false を返し、終了の失敗の接頭辞に理由を付けてそのタブに出す', async () => {
    const { result } = render()
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    await startSelected(result)
    mockStop.mockRejectedValueOnce(new Error('ipc down'))
    let stopped: boolean | undefined
    await act(async () => {
      stopped = await result.current.stop('slot-1')
    })
    expect(stopped).toBe(false)
    expect(result.current.selected.error).toBe('エージェントを終了できませんでした: ipc down')
  })

  it('部品の作り直しの後、main のセッションに合わせる', async () => {
    mockGetState.mockResolvedValueOnce([
      { slotId: 'slot-1', sessionId: 's9', cliKind: 'claude', claudeSessionId: CSID }
    ])
    const { result } = render()
    await waitFor(() => expect(result.current.selected.status).toBe('running'))
    expect(controllerOf('slot-1').sessionId).toBe('s9')
  })

  it('従来の方式(enabled が false)では main に問い合わせない', () => {
    render({ enabled: false })
    expect(mockGetState).not.toHaveBeenCalled()
  })

  it('prepareForStart → fit → startAgentSession → setSession の順で呼ぶ', async () => {
    const controller = controllerOf('slot-1')
    const calls: string[] = []
    controller.prepareForStart.mockImplementationOnce(() => calls.push('prepare'))
    controller.fit.mockImplementationOnce(() => {
      calls.push('fit')
      return { cols: 100, rows: 30 }
    })
    const setSession = controller.setSession
    controller.setSession = (id) => {
      calls.push(`setSession:${id}`)
      setSession(id)
    }
    mockStart.mockImplementationOnce(async () => {
      calls.push('start')
      return { kind: 'started', sessionId: 's1', cliKind: 'claude', claudeSessionId: CSID }
    })
    const { result } = render()
    await startSelected(result)
    expect(calls).toEqual(['prepare', 'fit', 'start', 'setSession:s1'])
    expect(mockStart).toHaveBeenCalledWith({
      slotId: 'slot-1',
      folderPath: '/work',
      cols: 100,
      rows: 30,
      launch: NEW
    })
  })

  it('already-running は何も出さず、既存のセッションに合わせる', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'already-running',
      sessionId: 's7',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    const { result } = render()
    await startSelected(result)
    expect(result.current.selected.status).toBe('running')
    expect(result.current.selected.error).toBeNull()
    expect(controllerOf('slot-1').sessionId).toBe('s7')
  })

  it('起動の取り消し(起動の途中の停止)はエラーを出さず none に戻す', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'error',
      error: 'spawn-failed',
      detail: AGENT_START_CANCELED_DETAIL
    })
    const controller = controllerOf('slot-1')
    const setSession = vi.fn(controller.setSession)
    controller.setSession = setSession
    const { result } = render()
    await startSelected(result)
    expect(result.current.selected.error).toBeNull()
    expect(result.current.selected.status).toBe('none')
    expect(setSession).toHaveBeenCalledWith(null)
  })

  it('起動の依頼が例外を投げたら文言を出し none に戻す', async () => {
    mockStart.mockRejectedValueOnce(new Error('ipc down'))
    const controller = controllerOf('slot-1')
    const setSession = vi.fn(controller.setSession)
    controller.setSession = setSession
    const { result } = render()
    await startSelected(result)
    expect(result.current.selected.error).toBe('エージェントを起動できませんでした: ipc down')
    expect(result.current.selected.status).toBe('none')
    // 起動の準備(出力の溜め込み)を controller に終わらせる
    expect(setSession).toHaveBeenCalledWith(null)
  })

  it('終了した後にもう一度起動でき、前の終了と案内を消す', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    const { result } = render()
    await startSelected(result)
    act(() => emitExit({ sessionId: 's1', exitCode: 1, signal: null, reason: 'exited' }))
    expect(result.current.selected.error).not.toBeNull()
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's2',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    await startSelected(result)
    expect(mockStart).toHaveBeenCalledTimes(2)
    expect(controllerOf('slot-1').prepareForStart).toHaveBeenCalledTimes(2)
    expect(result.current.selected.status).toBe('running')
    expect(controllerOf('slot-1').sessionId).toBe('s2')
    expect(result.current.selected.exit).toBeNull()
    expect(result.current.selected.error).toBeNull()
  })

  it('終了の通知が起動の結果より先に届いても exited にする', async () => {
    mockStart.mockImplementationOnce(async () => {
      emitExit({ sessionId: 's1', exitCode: 1, signal: null, reason: 'exited' })
      return { kind: 'started', sessionId: 's1', cliKind: 'claude', claudeSessionId: CSID }
    })
    const { result } = render()
    await startSelected(result)
    expect(result.current.selected.status).toBe('exited')
    expect(result.current.selected.exit).toEqual({ exitCode: 1, reason: 'exited' })
    expect(result.current.selected.error).toBe(
      '起動の直後に終了しました。ターミナルの表示を確かめてください'
    )
    expect(controllerOf('slot-1').sessionId).toBeNull()
  })

  it('起動の結果(started・already-running)を受けるたびに startConfirmedCount を増やし、起動の結果より先に終了が届いても増やす。失敗では増やさない', async () => {
    const { result } = render()
    expect(result.current.startConfirmedCount).toBe(0)
    mockStart.mockImplementationOnce(async () => {
      emitExit({ sessionId: 's1', exitCode: 1, signal: null, reason: 'exited' })
      return { kind: 'started', sessionId: 's1', cliKind: 'claude', claudeSessionId: CSID }
    })
    await startSelected(result)
    expect(result.current.selected.status).toBe('exited')
    expect(result.current.startConfirmedCount).toBe(1)
    mockStart.mockResolvedValueOnce({
      kind: 'already-running',
      sessionId: 's2',
      cliKind: 'claude',
      claudeSessionId: CSID2
    })
    await startSelected(result)
    expect(result.current.startConfirmedCount).toBe(2)
    act(() => emitExit({ sessionId: 's2', exitCode: 0, signal: null, reason: 'exited' }))
    mockStart.mockResolvedValueOnce({ kind: 'error', error: 'spawn-failed', detail: 'x' })
    await startSelected(result)
    mockStart.mockRejectedValueOnce(new Error('ipc down'))
    await startSelected(result)
    expect(result.current.startConfirmedCount).toBe(2)
  })

  it('起動中に main のセッションの問い合わせが返っても、起動の結果を待つ', async () => {
    let resolveSnapshot: (value: AgentSessionSnapshotEntry[]) => void = () => undefined
    mockGetState.mockReset()
    mockGetState.mockImplementationOnce(() => new Promise((r) => (resolveSnapshot = r)))
    let resolveStart: (value: AgentStartResult) => void = () => undefined
    mockStart.mockImplementationOnce(() => new Promise((r) => (resolveStart = r)))
    const { result } = render()
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.start('slot-1', NEW)
    })
    await act(async () => {
      resolveSnapshot([
        { slotId: 'slot-1', sessionId: 's1', cliKind: 'claude', claudeSessionId: CSID }
      ])
    })
    expect(result.current.selected.status).toBe('starting')
    await act(async () => {
      resolveStart({ kind: 'error', error: 'spawn-failed', detail: AGENT_START_CANCELED_DETAIL })
      await first
    })
    expect(result.current.selected.status).toBe('none')
    expect(controllerOf('slot-1').sessionId).toBeNull()
  })

  it('StrictMode の二重マウントでも終了の購読は 1 つで、アンマウントで解除する', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    const { result, unmount } = renderStrict()
    await waitFor(() => expect(mockGetState).toHaveBeenCalled())
    expect(exitListeners.size).toBe(1)
    await startSelected(result)
    expect(mockStart).toHaveBeenCalledOnce()
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'stopped' }))
    expect(result.current.selected.status).toBe('exited')
    unmount()
    expect(exitListeners.size).toBe(0)
  })

  it('StrictMode でも main のセッションに 1 回だけ合わせる', async () => {
    mockGetState.mockResolvedValue([
      { slotId: 'slot-1', sessionId: 's9', cliKind: 'claude', claudeSessionId: CSID }
    ])
    const controller = controllerOf('slot-1')
    const setSession = vi.fn(controller.setSession)
    controller.setSession = setSession
    const { result } = renderStrict()
    await waitFor(() => expect(result.current.selected.status).toBe('running'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(setSession).toHaveBeenCalledOnce()
    expect(setSession).toHaveBeenCalledWith('s9')
  })

  it('問い合わせの途中で従来の方式に切り替わったら、main のセッションに合わせない', async () => {
    let resolveSnapshot: (value: AgentSessionSnapshotEntry[]) => void = () => undefined
    mockGetState.mockReset()
    mockGetState.mockImplementationOnce(() => new Promise((r) => (resolveSnapshot = r)))
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useAgentSessions({
          folderPath: '/work',
          tabs,
          enabled,
          now: currentNow,
          appCliKind: 'claude'
        }),
      { initialProps: { enabled: true } }
    )
    rerender({ enabled: false })
    await act(async () => {
      resolveSnapshot([
        { slotId: 'slot-1', sessionId: 's9', cliKind: 'claude', claudeSessionId: CSID }
      ])
    })
    expect(result.current.selected.status).toBe('none')
    expect(controllerOf('slot-1').sessionId).toBeNull()
  })

  it('アンマウントの後に起動の結果が届いたら、状態は更新せずセッションは controller に渡す', async () => {
    const consoleError = vi.spyOn(console, 'error')
    let resolveStart: (value: AgentStartResult) => void = () => undefined
    mockStart.mockImplementationOnce(() => new Promise((r) => (resolveStart = r)))
    const { result, unmount } = render()
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.start('slot-1', NEW)
    })
    unmount()
    await act(async () => {
      resolveStart({ kind: 'started', sessionId: 's1', cliKind: 'claude', claudeSessionId: CSID })
      await first
    })
    expect(controllerOf('slot-1').sessionId).toBe('s1')
    expect(consoleError).not.toHaveBeenCalled()
  })
})

describe('useAgentSessions — 複数のタブ', () => {
  it('2 つのタブでそれぞれ起動すると、依頼にそれぞれの slotId が入り、状態は独立している', async () => {
    const { result } = render()
    await runTwoTabs(result)
    expect(mockStart.mock.calls.map(([request]) => request.slotId)).toEqual(['slot-1', 'slot-2'])
    expect(tabOf(result.current, 'slot-1').status).toBe('running')
    expect(tabOf(result.current, 'slot-2').status).toBe('running')
    expect(controllerOf('slot-1').sessionId).toBe('s-1')
    expect(controllerOf('slot-2').sessionId).toBe('s-2')
    expect(result.current.tabs.map((tab) => tab.label)).toEqual(['claude 1', 'claude 2'])
  })

  it('タブ 2 のセッションの終了はタブ 2 だけを exited にし、lastExit をその終了にする', async () => {
    const { result } = render()
    await runTwoTabs(result)
    expect(result.current.lastExit).toBeNull()
    now = 10_000
    act(() => emitExit({ sessionId: 's-2', exitCode: 3, signal: null, reason: 'exited' }))
    expect(tabOf(result.current, 'slot-2')).toMatchObject({
      status: 'exited',
      exit: { exitCode: 3, reason: 'exited' }
    })
    expect(tabOf(result.current, 'slot-1').status).toBe('running')
    expect(result.current.lastExit).toEqual({ sessionId: 's-2', exitCode: 3, reason: 'exited' })
  })

  it('起動の直後の終了の判定はタブごとの起動時刻で行う(早く起動したタブは案内を出さず、遅いタブは出す)', async () => {
    const { result } = render()
    mockStart
      .mockResolvedValueOnce({
        kind: 'started',
        sessionId: 's-1',
        cliKind: 'claude',
        claudeSessionId: CSID
      })
      .mockResolvedValueOnce({
        kind: 'started',
        sessionId: 's-2',
        cliKind: 'claude',
        claudeSessionId: CSID
      })
    now = 10_000
    await startSelected(result)
    now = 15_000
    await act(async () => {
      await result.current.addTab()
    })
    now = 15_500
    // slot-1 は 5.5 秒前の起動なので直後ではない
    act(() => emitExit({ sessionId: 's-1', exitCode: 1, signal: null, reason: 'exited' }))
    expect(tabOf(result.current, 'slot-1').error).toBeNull()
    // slot-2 は 0.5 秒前の起動なので直後
    act(() => emitExit({ sessionId: 's-2', exitCode: 1, signal: null, reason: 'exited' }))
    expect(tabOf(result.current, 'slot-2').error).toBe(
      '起動の直後に終了しました。ターミナルの表示を確かめてください'
    )
  })

  it('lastExit は終了のたびに新しいオブジェクトになる', async () => {
    const { result } = render()
    act(() => emitExit({ sessionId: 'x', exitCode: 0, signal: null, reason: 'stopped' }))
    const first = result.current.lastExit
    act(() => emitExit({ sessionId: 'x', exitCode: 0, signal: null, reason: 'stopped' }))
    expect(result.current.lastExit).toEqual(first)
    expect(result.current.lastExit).not.toBe(first)
  })

  it('addTab はタブを作って選択し、そのタブで起動の依頼を出す', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's-2',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    const { result } = render()
    await act(async () => {
      await result.current.addTab()
    })
    expect(result.current.tabs.map((tab) => tab.slotId)).toEqual(['slot-1', 'slot-2'])
    expect(result.current.selected.slotId).toBe('slot-2')
    expect(result.current.selected.status).toBe('running')
    expect(mockStart).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ slotId: 'slot-2' }))
  })

  it('フォルダが無いと addTab は何もしない', async () => {
    const { result } = render({ folderPath: null })
    await act(async () => {
      await result.current.addTab()
    })
    expect(result.current.tabs).toHaveLength(1)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('上限なら addDisabledReason を出し、addTab は何もしない', async () => {
    mockStart.mockResolvedValue({ kind: 'error', error: 'no-folder' })
    const { result } = render()
    for (let i = 1; i < AGENT_MAX_SESSIONS_PER_WINDOW; i++) {
      await act(async () => {
        await result.current.addTab()
      })
    }
    expect(result.current.tabs).toHaveLength(AGENT_MAX_SESSIONS_PER_WINDOW)
    expect(result.current.addDisabledReason).toBe(AGENT_ADD_TAB_DISABLED_LIMIT)
    mockStart.mockClear()
    await act(async () => {
      await result.current.addTab()
    })
    expect(result.current.tabs).toHaveLength(AGENT_MAX_SESSIONS_PER_WINDOW)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('selectTab で選択中のタブを変える', async () => {
    const { result } = render()
    await runTwoTabs(result)
    act(() => result.current.selectTab('slot-1'))
    expect(result.current.selected.slotId).toBe('slot-1')
    expect(result.current.selected.controller).toBe(controllerOf('slot-1'))
  })

  it('isAnyActive: 起動中も動いている状態に含める', async () => {
    let resolveStart: (value: AgentStartResult) => void = () => undefined
    mockStart.mockImplementationOnce(() => new Promise((r) => (resolveStart = r)))
    const { result } = render()
    expect(result.current.isAnyActive).toBe(false)
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.start('slot-1', NEW)
    })
    expect(result.current.isAnyActive).toBe(true)
    await act(async () => {
      resolveStart({ kind: 'started', sessionId: 's-1', cliKind: 'claude', claudeSessionId: CSID })
      await first
    })
    expect(result.current.isAnyActive).toBe(true)
  })

  it('isAnyStarting: 起動中のタブがある間だけ true(動いている状態は含めない)', async () => {
    let resolveStart: (value: AgentStartResult) => void = () => undefined
    mockStart.mockImplementationOnce(() => new Promise((r) => (resolveStart = r)))
    const { result } = render()
    expect(result.current.isAnyStarting).toBe(false)
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.start('slot-1', NEW)
    })
    expect(result.current.isAnyStarting).toBe(true)
    await act(async () => {
      resolveStart({ kind: 'started', sessionId: 's-1', cliKind: 'claude', claudeSessionId: CSID })
      await first
    })
    expect(result.current.isAnyStarting).toBe(false)
  })

  describe('closeTab', () => {
    it.each(['none', 'exited'] as const)('動いていない(%s)タブは確認なしで消す', async (status) => {
      const onConfirm = vi.fn(() => false)
      const { result } = render({ onConfirm })
      await runTwoTabs(result)
      if (status === 'exited') {
        act(() => emitExit({ sessionId: 's-2', exitCode: 0, signal: null, reason: 'exited' }))
      } else {
        // none のタブ: 3 つ目を作って起動に失敗させる
        mockStart.mockResolvedValueOnce({ kind: 'error', error: 'no-folder' })
        await act(async () => {
          await result.current.addTab()
        })
      }
      const target = status === 'exited' ? 'slot-2' : 'slot-3'
      expect(tabOf(result.current, target).status).toBe(status)
      let closed: boolean | undefined
      await act(async () => {
        closed = await result.current.closeTab(target)
      })
      expect(closed).toBe(true)
      expect(onConfirm).not.toHaveBeenCalled()
      expect(result.current.tabs.map((tab) => tab.slotId)).not.toContain(target)
    })

    it('動いているタブは確認し、取りやめたら止めず消さない', async () => {
      const onConfirm = vi.fn(() => false)
      const { result } = render({ onConfirm })
      await runTwoTabs(result)
      let closed: boolean | undefined
      await act(async () => {
        closed = await result.current.closeTab('slot-2')
      })
      expect(closed).toBe(false)
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(agentCloseTabConfirm('claude 2'))
      expect(mockStop).not.toHaveBeenCalled()
      expect(result.current.tabs).toHaveLength(2)
    })

    it('確認で OK なら停止を待ってから消す(controller も dispose される)', async () => {
      const order: string[] = []
      const { result } = render({ onConfirm: () => true })
      await runTwoTabs(result)
      const controller2 = controllerOf('slot-2')
      controller2.dispose.mockImplementation(() => void order.push('dispose'))
      mockStop.mockImplementationOnce(async () => {
        await Promise.resolve()
        order.push('stopped')
      })
      await act(async () => {
        await result.current.closeTab('slot-2')
      })
      expect(mockStop).toHaveBeenCalledExactlyOnceWith('s-2')
      expect(order).toEqual(['stopped', 'dispose'])
      expect(result.current.tabs.map((tab) => tab.slotId)).toEqual(['slot-1'])
      expect(result.current.selected.slotId).toBe('slot-1')
    })

    it('停止が失敗したらタブを残し、そのタブに終了の失敗を出す', async () => {
      const { result } = render({ onConfirm: () => true })
      await runTwoTabs(result)
      mockStop.mockRejectedValueOnce(new Error('ipc down'))
      let closed: boolean | undefined
      await act(async () => {
        closed = await result.current.closeTab('slot-2')
      })
      expect(closed).toBe(false)
      expect(result.current.tabs).toHaveLength(2)
      expect(tabOf(result.current, 'slot-2').error).toBe(
        'エージェントを終了できませんでした: ipc down'
      )
    })

    it('最後の 1 つは消さない(確認も停止もしない)', async () => {
      const onConfirm = vi.fn(() => true)
      mockStart.mockResolvedValueOnce({
        kind: 'started',
        sessionId: 's-1',
        cliKind: 'claude',
        claudeSessionId: CSID
      })
      const { result } = render({ onConfirm })
      await startSelected(result)
      let closed: boolean | undefined
      await act(async () => {
        closed = await result.current.closeTab('slot-1')
      })
      expect(closed).toBe(false)
      expect(onConfirm).not.toHaveBeenCalled()
      expect(mockStop).not.toHaveBeenCalled()
      expect(result.current.tabs).toHaveLength(1)
    })

    it('起動中のタブは、起動の結果(sessionId)を待ってから止めて消す', async () => {
      const onConfirm = vi.fn(() => true)
      mockStart.mockResolvedValueOnce({
        kind: 'started',
        sessionId: 's-1',
        cliKind: 'claude',
        claudeSessionId: CSID
      })
      const { result } = render({ onConfirm })
      await startSelected(result)
      let resolveStart: (value: AgentStartResult) => void = () => undefined
      mockStart.mockImplementationOnce(() => new Promise((r) => (resolveStart = r)))
      let adding: Promise<void> = Promise.resolve()
      act(() => {
        adding = result.current.addTab()
      })
      expect(tabOf(result.current, 'slot-2').status).toBe('starting')
      let closing: Promise<boolean> = Promise.resolve(false)
      act(() => {
        closing = result.current.closeTab('slot-2')
      })
      // 起動中も動いているタブとして確かめる。sessionId が決まるまでは止めない
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(agentCloseTabConfirm('claude 2'))
      await act(async () => {
        await Promise.resolve()
      })
      expect(mockStop).not.toHaveBeenCalled()
      expect(result.current.tabs).toHaveLength(2)
      let closed: boolean | undefined
      await act(async () => {
        resolveStart({
          kind: 'started',
          sessionId: 's-2',
          cliKind: 'claude',
          claudeSessionId: CSID
        })
        await adding
        closed = await closing
      })
      expect(closed).toBe(true)
      expect(mockStop).toHaveBeenCalledExactlyOnceWith('s-2')
      expect(result.current.tabs.map((tab) => tab.slotId)).toEqual(['slot-1'])
    })

    it('起動中のタブの起動が取り消しになったら、止めずに消す', async () => {
      const onConfirm = vi.fn(() => true)
      mockStart.mockResolvedValueOnce({
        kind: 'started',
        sessionId: 's-1',
        cliKind: 'claude',
        claudeSessionId: CSID
      })
      const { result } = render({ onConfirm })
      await startSelected(result)
      let resolveStart: (value: AgentStartResult) => void = () => undefined
      mockStart.mockImplementationOnce(() => new Promise((r) => (resolveStart = r)))
      let adding: Promise<void> = Promise.resolve()
      act(() => {
        adding = result.current.addTab()
      })
      let closing: Promise<boolean> = Promise.resolve(false)
      act(() => {
        closing = result.current.closeTab('slot-2')
      })
      let closed: boolean | undefined
      await act(async () => {
        resolveStart({ kind: 'error', error: 'spawn-failed', detail: AGENT_START_CANCELED_DETAIL })
        await adding
        closed = await closing
      })
      expect(closed).toBe(true)
      expect(mockStop).not.toHaveBeenCalled()
      expect(result.current.tabs.map((tab) => tab.slotId)).toEqual(['slot-1'])
    })

    it('閉じている途中にもう一度閉じても、確認・停止を重ねない', async () => {
      const onConfirm = vi.fn(() => true)
      const { result } = render({ onConfirm })
      await runTwoTabs(result)
      let finishStop: () => void = () => undefined
      mockStop.mockImplementationOnce(() => new Promise<void>((r) => (finishStop = r)))
      let first: Promise<boolean> = Promise.resolve(false)
      act(() => {
        first = result.current.closeTab('slot-2')
      })
      let second: boolean | undefined
      await act(async () => {
        second = await result.current.closeTab('slot-2')
      })
      expect(second).toBe(false)
      await act(async () => {
        finishStop()
        await first
      })
      expect(onConfirm).toHaveBeenCalledOnce()
      expect(mockStop).toHaveBeenCalledOnce()
      expect(result.current.tabs).toHaveLength(1)
    })

    it('2 つのタブを続けて閉じ、後から最後の 1 つになったタブは消さず、状態とセッションを残す', async () => {
      const { result } = render({ onConfirm: () => true })
      await runTwoTabs(result)
      let finishStop1: () => void = () => undefined
      mockStop.mockImplementation((id) =>
        id === 's-1' ? new Promise<void>((r) => (finishStop1 = r)) : Promise.resolve()
      )
      let closing1: Promise<boolean> = Promise.resolve(false)
      act(() => {
        closing1 = result.current.closeTab('slot-1')
      })
      let closed2: boolean | undefined
      await act(async () => {
        closed2 = await result.current.closeTab('slot-2')
      })
      expect(closed2).toBe(true)
      let closed1: boolean | undefined
      await act(async () => {
        finishStop1()
        closed1 = await closing1
      })
      expect(closed1).toBe(false)
      expect(result.current.tabs.map((tab) => tab.slotId)).toEqual(['slot-1'])
      // 状態を消していないので、止めたセッションの終了がこのタブに届く
      expect(tabOf(result.current, 'slot-1').status).toBe('running')
      expect(controllerOf('slot-1').sessionId).toBe('s-1')
      act(() => emitExit({ sessionId: 's-1', exitCode: 0, signal: null, reason: 'stopped' }))
      expect(tabOf(result.current, 'slot-1').status).toBe('exited')
      expect(controllerOf('slot-1').sessionId).toBeNull()
    })

    it('閉じる途中のタブでは起動しない(main に持ち主のいないセッションを残さない)', async () => {
      const { result } = render({ onConfirm: () => true })
      await runTwoTabs(result)
      let finishStop: () => void = () => undefined
      mockStop.mockImplementationOnce(() => new Promise<void>((r) => (finishStop = r)))
      let closing: Promise<boolean> = Promise.resolve(false)
      act(() => {
        closing = result.current.closeTab('slot-2')
      })
      // 停止を待つ間に終了が先に届き、exited になる(起動を押せる見た目になる)
      act(() => emitExit({ sessionId: 's-2', exitCode: 0, signal: null, reason: 'stopped' }))
      expect(tabOf(result.current, 'slot-2').status).toBe('exited')
      mockStart.mockClear()
      await act(async () => {
        await result.current.start('slot-2', NEW)
      })
      expect(mockStart).not.toHaveBeenCalled()
      await act(async () => {
        finishStop()
        await closing
      })
      expect(result.current.tabs.map((tab) => tab.slotId)).toEqual(['slot-1'])
    })

    it('確認の後、停止を待つ間は isClosing で、消えたら一覧から無くなる', async () => {
      const { result } = render({ onConfirm: () => true })
      await runTwoTabs(result)
      expect(tabOf(result.current, 'slot-2').isClosing).toBe(false)
      let finishStop: () => void = () => undefined
      mockStop.mockImplementationOnce(() => new Promise<void>((r) => (finishStop = r)))
      let closing: Promise<boolean> = Promise.resolve(false)
      act(() => {
        closing = result.current.closeTab('slot-2')
      })
      expect(tabOf(result.current, 'slot-2').isClosing).toBe(true)
      expect(tabOf(result.current, 'slot-1').isClosing).toBe(false)
      await act(async () => {
        finishStop()
        await closing
      })
      expect(result.current.tabs.map((tab) => tab.slotId)).toEqual(['slot-1'])
    })

    it('確認で取りやめたら isClosing にしない。停止に失敗したら isClosing を戻す', async () => {
      let answer = false
      const { result } = render({ onConfirm: () => answer })
      await runTwoTabs(result)
      await act(async () => {
        await result.current.closeTab('slot-2')
      })
      expect(tabOf(result.current, 'slot-2').isClosing).toBe(false)
      answer = true
      mockStop.mockRejectedValueOnce(new Error('ipc down'))
      await act(async () => {
        await result.current.closeTab('slot-2')
      })
      expect(tabOf(result.current, 'slot-2').isClosing).toBe(false)
    })

    it('終了の途中の closeTab は、停止の完了を待ってからタブを消す(main は停止中のセッションへの 2 回目の stop を、その停止の完了まで待たせる)', async () => {
      const { result } = render({ onConfirm: () => true })
      await runTwoTabs(result)
      // main の stop を真似る: 同じ sessionId の停止中に届いた 2 回目の stop は、1 回目と同じ完了を待つ
      let releaseStop: () => void = () => undefined
      const stopping = new Promise<void>((resolve) => {
        releaseStop = resolve
      })
      mockStop.mockImplementation(async (id) => {
        if (id === 's-2') await stopping
      })
      let stopPending: Promise<boolean> = Promise.resolve(true)
      let closePending: Promise<boolean> = Promise.resolve(false)
      let closed: boolean | undefined
      await act(async () => {
        stopPending = result.current.stop('slot-2')
        await Promise.resolve()
      })
      await act(async () => {
        closePending = result.current.closeTab('slot-2')
        void closePending.then((value) => {
          closed = value
        })
        await Promise.resolve()
      })
      expect(mockStop).toHaveBeenCalledTimes(2)
      expect(closed).toBeUndefined()
      expect(result.current.tabs.map((tab) => tab.slotId)).toContain('slot-2')
      expect(controllerOf('slot-2').dispose).not.toHaveBeenCalled()
      await act(async () => {
        releaseStop()
        await stopPending
        await closePending
      })
      expect(closed).toBe(true)
      expect(result.current.tabs.map((tab) => tab.slotId)).toEqual(['slot-1'])
    })

    it('消したタブの状態を作り直さない(閉じた後に届いた停止の失敗を、同じ slotId のタブが戻っても引き継がない)', async () => {
      const { result } = render({ onConfirm: () => true })
      await runTwoTabs(result)
      // 1 回目の停止(終了)は後から失敗し、2 回目(×)はすぐ終わる
      let failStop: (error: Error) => void = () => undefined
      const firstStop = new Promise<void>((_resolve, reject) => {
        failStop = reject
      })
      mockStop.mockImplementationOnce(() => firstStop).mockResolvedValueOnce(undefined)
      let stopPending: Promise<boolean> = Promise.resolve(true)
      await act(async () => {
        stopPending = result.current.stop('slot-2')
        await Promise.resolve()
      })
      await act(async () => {
        await result.current.closeTab('slot-2')
      })
      expect(result.current.tabs.map((tab) => tab.slotId)).toEqual(['slot-1'])
      await act(async () => {
        failStop(new Error('ipc down'))
        await stopPending
      })
      // 同じ slotId のタブが置き場に戻っても(マウント時の同期など)、消したタブの状態は残っていない
      act(() => {
        tabs.ensure('slot-2')
      })
      expect(tabOf(result.current, 'slot-2').error).toBeNull()
    })

    it('閉じたタブのセッションの終了が遅れて届いても、どのタブの状態も変えない(lastExit は変える)', async () => {
      const { result } = render({ onConfirm: () => true })
      await runTwoTabs(result)
      await act(async () => {
        await result.current.closeTab('slot-2')
      })
      const before = result.current.tabs
      act(() => emitExit({ sessionId: 's-2', exitCode: 0, signal: null, reason: 'stopped' }))
      expect(result.current.tabs).toEqual(before)
      expect(tabOf(result.current, 'slot-1').status).toBe('running')
      expect(result.current.lastExit).toEqual({ sessionId: 's-2', exitCode: 0, reason: 'stopped' })
    })
  })

  describe('stopAll', () => {
    it('動いているすべてのタブを止め、すべて成功で true', async () => {
      const { result } = render()
      await runTwoTabs(result)
      let stopped: boolean | undefined
      await act(async () => {
        stopped = await result.current.stopAll()
      })
      expect(stopped).toBe(true)
      expect(mockStop.mock.calls.map(([id]) => id).sort()).toEqual(['s-1', 's-2'])
    })

    it('1 つでも失敗したら false', async () => {
      const { result } = render()
      await runTwoTabs(result)
      mockStop.mockImplementation(async (id) => {
        if (id === 's-1') throw new Error('ipc down')
      })
      let stopped: boolean | undefined
      await act(async () => {
        stopped = await result.current.stopAll()
      })
      expect(stopped).toBe(false)
      expect(mockStop).toHaveBeenCalledTimes(2)
      expect(tabOf(result.current, 'slot-1').error).toBe(
        'エージェントを終了できませんでした: ipc down'
      )
    })

    it('停止に失敗したタブがあれば、そのタブを選択してエラーが見えるようにする', async () => {
      const { result } = render()
      await runTwoTabs(result)
      act(() => result.current.selectTab('slot-2'))
      expect(result.current.selected.slotId).toBe('slot-2')
      mockStop.mockImplementation(async (id) => {
        if (id === 's-1') throw new Error('ipc down')
      })
      await act(async () => {
        await result.current.stopAll()
      })
      expect(result.current.selected.slotId).toBe('slot-1')
    })

    it.each([
      [
        '起動し終えた',
        {
          kind: 'started',
          sessionId: 's-2',
          cliKind: 'claude',
          claudeSessionId: CSID
        } as AgentStartResult
      ],
      ['起動中の', null]
    ])(
      '止めている間に%sタブがあれば、false(実行方式を切り替えない)',
      async (_label, startResult) => {
        const { result } = render()
        mockStart
          .mockResolvedValueOnce({
            kind: 'started',
            sessionId: 's-1',
            cliKind: 'claude',
            claudeSessionId: CSID
          })
          .mockResolvedValueOnce({ kind: 'error', error: 'no-folder' })
        await startSelected(result)
        await act(async () => {
          await result.current.addTab()
        })
        expect(tabOf(result.current, 'slot-2').status).toBe('none')
        let finishStop: () => void = () => undefined
        mockStop.mockImplementationOnce(() => new Promise<void>((r) => (finishStop = r)))
        let stopping: Promise<boolean> = Promise.resolve(true)
        act(() => {
          stopping = result.current.stopAll()
        })
        // 停止を待つ間に、止める対象に入っていなかったタブ 2 を起動する
        if (startResult === null)
          mockStart.mockImplementationOnce(() => new Promise(() => undefined))
        else mockStart.mockResolvedValueOnce(startResult)
        await act(async () => {
          void result.current.start('slot-2', NEW)
          await Promise.resolve()
        })
        let stopped: boolean | undefined
        await act(async () => {
          finishStop()
          stopped = await stopping
        })
        expect(stopped).toBe(false)
      }
    )

    it('動いているタブが無ければ何もせず true', async () => {
      const { result } = render()
      let stopped: boolean | undefined
      await act(async () => {
        stopped = await result.current.stopAll()
      })
      expect(stopped).toBe(true)
      expect(mockStop).not.toHaveBeenCalled()
    })
  })

  describe('起動を受け付けない間(startBlockedReason)', () => {
    it('起動・追加を押せない理由にし、start・addTab は依頼しない', async () => {
      const { result } = render({ startBlockedReason: '実行方式を切り替えています' })
      expect(result.current.startDisabledReason).toBe('実行方式を切り替えています')
      expect(result.current.addDisabledReason).toBe('実行方式を切り替えています')
      await startSelected(result)
      await act(async () => {
        await result.current.addTab()
      })
      expect(mockStart).not.toHaveBeenCalled()
      expect(result.current.tabs).toHaveLength(1)
    })

    it('フォルダが無いときは、フォルダ無しの理由を優先する', () => {
      const { result } = render({
        folderPath: null,
        startBlockedReason: '実行方式を切り替えています'
      })
      expect(result.current.startDisabledReason).toBe('フォルダを開いてください')
    })
  })

  describe('マウント時の同期', () => {
    it('一覧の slotId のタブに合わせ、置き場に無い slotId はタブを作って合わせる', async () => {
      mockGetState.mockResolvedValueOnce([
        { slotId: 'slot-1', sessionId: 's-1', cliKind: 'claude', claudeSessionId: CSID },
        { slotId: 'restored', sessionId: 's-9', cliKind: 'claude', claudeSessionId: CSID }
      ])
      const { result } = render()
      await waitFor(() => expect(result.current.tabs).toHaveLength(2))
      expect(tabOf(result.current, 'slot-1').status).toBe('running')
      expect(controllerOf('slot-1').sessionId).toBe('s-1')
      expect(tabOf(result.current, 'restored')).toMatchObject({
        status: 'running',
        label: 'claude 2',
        number: 2
      })
      expect(controllerOf('restored').sessionId).toBe('s-9')
      // 選択は変えない
      expect(result.current.selected.slotId).toBe('slot-1')
    })

    it('一覧が空なら、どのタブにも合わせない', async () => {
      const { result } = render()
      // getAgentSessions の解決を待ってから否定を確かめる(waitFor は即成立するため使わない)
      await act(async () => {
        await Promise.resolve()
      })
      expect(mockGetState).toHaveBeenCalledOnce()
      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.selected.status).toBe('none')
      expect(controllerOf('slot-1').sessionId).toBeNull()
    })

    it('復元したタブのセッションの終了も、そのタブへ振り分ける', async () => {
      mockGetState.mockResolvedValueOnce([
        { slotId: 'restored', sessionId: 's-9', cliKind: 'claude', claudeSessionId: CSID }
      ])
      const { result } = render()
      await waitFor(() => expect(result.current.tabs).toHaveLength(2))
      await waitFor(() => expect(tabOf(result.current, 'restored').status).toBe('running'))
      act(() => emitExit({ sessionId: 's-9', exitCode: 0, signal: null, reason: 'exited' }))
      expect(tabOf(result.current, 'restored').status).toBe('exited')
      expect(tabOf(result.current, 'slot-1').status).toBe('none')
    })
  })
})

describe('useAgentSessions — claude のセッション ID', () => {
  it('start は起動の指定(launch)をそのまま main へ渡す', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    const { result } = render()
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID))
    })
    expect(mockStart).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ slotId: 'slot-1', launch: resumeOf(CSID) })
    )
  })

  it('new は結果が届いてから、resume は起動中から、タブに claudeSessionId を持つ', async () => {
    let resolveStart: (value: AgentStartResult) => void = () => undefined
    mockStart.mockImplementationOnce(() => new Promise((r) => (resolveStart = r)))
    const { result } = render()
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.start('slot-1', NEW)
    })
    expect(result.current.selected).toMatchObject({ status: 'starting', claudeSessionId: null })
    await act(async () => {
      resolveStart({ kind: 'started', sessionId: 's1', cliKind: 'claude', claudeSessionId: CSID })
      await first
    })
    expect(result.current.selected).toMatchObject({ status: 'running', claudeSessionId: CSID })
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' }))
    mockStart.mockImplementationOnce(() => new Promise((r) => (resolveStart = r)))
    act(() => {
      first = result.current.start('slot-1', resumeOf(CSID))
    })
    expect(result.current.selected).toMatchObject({ status: 'starting', claudeSessionId: CSID })
    await act(async () => {
      resolveStart({ kind: 'started', sessionId: 's2', cliKind: 'claude', claudeSessionId: CSID })
      await first
    })
    expect(result.current.selected.claudeSessionId).toBe(CSID)
  })

  it('resume に already-running が返り、ID が依頼と違えば結果の ID で上書きする(そのタブで動いているのは結果のセッション)', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'already-running',
      sessionId: 's7',
      cliKind: 'claude',
      claudeSessionId: CSID2
    })
    const { result } = render()
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID))
    })
    expect(result.current.selected).toMatchObject({ status: 'running', claudeSessionId: CSID2 })
  })

  it.each([
    ['終了', 'exit'],
    ['起動の失敗', 'error'],
    ['起動の取り消し', 'canceled'],
    ['起動の依頼の例外', 'throw']
  ])('%s で claudeSessionId を null に戻す', async (_label, kind) => {
    if (kind === 'exit')
      mockStart.mockResolvedValueOnce({
        kind: 'started',
        sessionId: 's1',
        cliKind: 'claude',
        claudeSessionId: CSID
      })
    else if (kind === 'error')
      mockStart.mockResolvedValueOnce({ kind: 'error', error: 'unknown-session' })
    else if (kind === 'canceled')
      mockStart.mockResolvedValueOnce({
        kind: 'error',
        error: 'spawn-failed',
        detail: AGENT_START_CANCELED_DETAIL
      })
    else mockStart.mockRejectedValueOnce(new Error('ipc down'))
    const { result } = render()
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID))
    })
    if (kind === 'exit')
      act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' }))
    expect(result.current.selected.claudeSessionId).toBeNull()
  })

  it('unknown-session・session-in-use は、そのタブのエラーとして文言を出す', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'error', error: 'session-in-use' })
    const { result } = render()
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID))
    })
    expect(result.current.selected).toMatchObject({
      status: 'none',
      error: 'このセッションはほかのタブかウィンドウで動いています'
    })
  })

  it('ほかのタブで同じ ID が起動中・実行中なら、resume は何もしない(処理の側の守り。L-058)', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    const { result } = render()
    await act(async () => {
      await result.current.start('slot-1', NEW)
    })
    let slot2 = ''
    act(() => {
      slot2 = tabs.add()!.slotId
    })
    mockStart.mockClear()
    await act(async () => {
      await result.current.start(slot2, resumeOf(CSID))
    })
    expect(mockStart).not.toHaveBeenCalled()
    expect(tabOf(result.current, slot2).status).toBe('none')
  })

  it('resumeInNewTab はタブを足して選択し、そのタブで resume を始めて slotId を返す(完了は待たない)', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    const { result } = render()
    let slotId: string | null = null
    act(() => {
      slotId = result.current.resumeInNewTab(CSID)
    })
    expect(slotId).toBe('slot-2')
    expect(result.current.selected.slotId).toBe('slot-2')
    expect(mockStart).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ slotId: 'slot-2', launch: resumeOf(CSID) })
    )
    await waitFor(() =>
      expect(tabOf(result.current, 'slot-2')).toMatchObject({
        status: 'running',
        claudeSessionId: CSID
      })
    )
  })

  it.each([
    ['タブが上限', { folderPath: '/work' }, true],
    ['起動を受け付けない間', { startBlockedReason: '実行方式を切り替えています' }, false],
    ['フォルダが無い', { folderPath: null }, false]
  ])('resumeInNewTab は %s なら何もせず null を返す', (_label, options, fill) => {
    const { result } = render(options)
    if (fill) {
      act(() => {
        while (tabs.add() !== null) {
          // 上限まで足す
        }
      })
    }
    const before = tabs.getSnapshot().tabs.length
    let slotId: string | null = 'x'
    act(() => {
      slotId = result.current.resumeInNewTab(CSID)
    })
    expect(slotId).toBeNull()
    expect(tabs.getSnapshot().tabs).toHaveLength(before)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('resumeInNewTab は同じ ID のタブが起動中・実行中なら何もせず null を返す', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    const { result } = render()
    await act(async () => {
      await result.current.start('slot-1', NEW)
    })
    let slotId: string | null = 'x'
    act(() => {
      slotId = result.current.resumeInNewTab(CSID)
    })
    expect(slotId).toBeNull()
    expect(tabs.getSnapshot().tabs).toHaveLength(1)
  })

  it('作り直しの後の合わせ込みで、タブの claudeSessionId も合わせる', async () => {
    mockGetState.mockResolvedValueOnce([
      { slotId: 'slot-1', sessionId: 's-1', cliKind: 'claude', claudeSessionId: CSID2 }
    ])
    const { result } = render()
    await waitFor(() =>
      expect(result.current.selected).toMatchObject({ status: 'running', claudeSessionId: CSID2 })
    )
  })
})

describe('useAgentSessions — 中断(interrupt)', () => {
  // 結果を後から渡す interruptAgentSession の偽物の値
  function deferredResult(): {
    promise: Promise<AgentInterruptResult>
    resolve: (value: AgentInterruptResult) => void
  } {
    let resolve: (value: AgentInterruptResult) => void = () => undefined
    const promise = new Promise<AgentInterruptResult>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  const interruptNow = async (
    result: Rendered['result'],
    slotId = 'slot-1'
  ): Promise<AgentInterruptOutcome | undefined> => {
    let outcome: AgentInterruptOutcome | undefined
    await act(async () => {
      outcome = await result.current.interrupt(slotId)
    })
    return outcome
  }

  const startS1 = async (result: Rendered['result']): Promise<void> => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    await startSelected(result)
  }

  it('セッションが無ければ IPC を呼ばず skipped', async () => {
    const { result } = render()
    expect(await interruptNow(result)).toEqual({ kind: 'skipped' })
    expect(mockInterrupt).not.toHaveBeenCalled()
  })

  it('そのタブの sessionId だけを渡し、sent を返す', async () => {
    const { result } = render()
    await startS1(result)
    mockInterrupt.mockResolvedValueOnce({ kind: 'sent', followUp: null })
    expect(await interruptNow(result)).toEqual({ kind: 'sent', followUp: null })
    expect(mockInterrupt).toHaveBeenCalledExactlyOnceWith('s1')
    expect(result.current.selected.error).toBeNull()
  })

  it.each<[AgentInterruptResult, string]>([
    [{ kind: 'no-session' }, '中断を送れませんでした: claude が終了したか、起動し直しました'],
    [{ kind: 'write-failed' }, '中断を送れませんでした: ターミナルへの書き込みに失敗しました']
  ])('%o はそのタブの error に出して、そのまま返す', async (ipcResult, message) => {
    const { result } = render()
    await startS1(result)
    mockInterrupt.mockResolvedValueOnce(ipcResult)
    expect(await interruptNow(result)).toEqual(ipcResult)
    expect(result.current.selected.error).toBe(message)
  })

  it('invoke の拒否は、接頭辞に例外の message を付けて error に出し、error を返す', async () => {
    const { result } = render()
    await startS1(result)
    mockInterrupt.mockRejectedValueOnce(new Error('ipc down'))
    expect(await interruptNow(result)).toEqual({ kind: 'error', message: 'ipc down' })
    expect(result.current.selected.error).toBe('中断を送れませんでした: ipc down')
  })

  it('window.api の呼び出しが同期で投げても、拒否と同じに扱う(L-055)', async () => {
    const { result } = render()
    await startS1(result)
    mockInterrupt.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(await interruptNow(result)).toEqual({ kind: 'error', message: 'boom' })
    expect(result.current.selected.error).toBe('中断を送れませんでした: boom')
  })

  it('結果を待つ間に終了して起動し直したら stale で、新しいセッションのタブに何も出さない(L-037)', async () => {
    const { result } = render()
    await startS1(result)
    const pending = deferredResult()
    mockInterrupt.mockReturnValueOnce(pending.promise)
    let outcome: Promise<AgentInterruptOutcome> | undefined
    act(() => {
      outcome = result.current.interrupt('slot-1')
    })
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' }))
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's2',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    await startSelected(result)
    let settled: AgentInterruptOutcome | undefined
    await act(async () => {
      pending.resolve({ kind: 'no-session' })
      settled = await outcome
    })
    expect(settled).toEqual({ kind: 'stale' })
    expect(result.current.selected.status).toBe('running')
    expect(result.current.selected.error).toBeNull()
  })

  it('結果を待つ間に終了して起動し直した後で IPC が拒否しても stale で、新しいセッションのタブに何も出さない(L-037)', async () => {
    const { result } = render()
    await startS1(result)
    let rejectPending: (err: Error) => void = () => undefined
    mockInterrupt.mockReturnValueOnce(
      new Promise<AgentInterruptResult>((_resolve, reject) => {
        rejectPending = reject
      })
    )
    let outcome: Promise<AgentInterruptOutcome> | undefined
    act(() => {
      outcome = result.current.interrupt('slot-1')
    })
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' }))
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's2',
      cliKind: 'claude',
      claudeSessionId: CSID
    })
    await startSelected(result)
    let settled: AgentInterruptOutcome | undefined
    await act(async () => {
      rejectPending(new Error('late'))
      settled = await outcome
    })
    expect(settled).toEqual({ kind: 'stale' })
    expect(result.current.selected.status).toBe('running')
    expect(result.current.selected.error).toBeNull()
  })

  it('結果を待つ間にタブを閉じたら stale で、どのタブにも何も出さない', async () => {
    const { result } = render({ onConfirm: () => true })
    await runTwoTabs(result)
    const pending = deferredResult()
    mockInterrupt.mockReturnValueOnce(pending.promise)
    let outcome: Promise<AgentInterruptOutcome> | undefined
    act(() => {
      outcome = result.current.interrupt('slot-2')
    })
    await act(async () => {
      await result.current.closeTab('slot-2')
    })
    let settled: AgentInterruptOutcome | undefined
    await act(async () => {
      pending.resolve({ kind: 'write-failed' })
      settled = await outcome
    })
    expect(settled).toEqual({ kind: 'stale' })
    expect(result.current.tabs.map((tab) => [tab.slotId, tab.error])).toEqual([['slot-1', null]])
  })

  it('結果は押したタブの error に出す(結果が届いた時点で別のタブを選んでいても)', async () => {
    const { result } = render()
    await runTwoTabs(result)
    expect(result.current.selected.slotId).toBe('slot-2')
    mockInterrupt.mockResolvedValueOnce({ kind: 'write-failed' })
    await interruptNow(result, 'slot-1')
    expect(mockInterrupt).toHaveBeenCalledExactlyOnceWith('s-1')
    expect(tabOf(result.current, 'slot-1').error).toBe(
      '中断を送れませんでした: ターミナルへの書き込みに失敗しました'
    )
    expect(result.current.selected.error).toBeNull()
  })

  it('送れたら、そのタブの中断の失敗の文言だけを消し、終了の失敗の文言は消さない', async () => {
    const { result } = render()
    await startS1(result)
    mockInterrupt.mockResolvedValueOnce({ kind: 'write-failed' })
    await interruptNow(result)
    mockInterrupt.mockResolvedValueOnce({ kind: 'sent', followUp: null })
    await interruptNow(result)
    expect(result.current.selected.error).toBeNull()
    mockStop.mockRejectedValueOnce(new Error('x'))
    await act(async () => {
      await result.current.stop('slot-1')
    })
    expect(result.current.selected.error).toBe('エージェントを終了できませんでした: x')
    mockInterrupt.mockResolvedValueOnce({ kind: 'sent', followUp: null })
    await interruptNow(result)
    expect(result.current.selected.error).toBe('エージェントを終了できませんでした: x')
  })

  it('main の sent の followUp に、送ったセッションの sessionId を添えて返す', async () => {
    const { result } = render()
    await startS1(result)
    mockInterrupt.mockResolvedValueOnce({ kind: 'sent', followUp: { afterMs: 100 } })
    expect(await interruptNow(result)).toEqual({
      kind: 'sent',
      followUp: { afterMs: 100, sessionId: 's1' }
    })
  })

  it('copilot のタブの no-session の文言は copilot の名前', async () => {
    const { result } = render()
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    await startSelected(result)
    mockInterrupt.mockResolvedValueOnce({ kind: 'no-session' })
    await interruptNow(result)
    expect(result.current.selected.error).toBe(
      '中断を送れませんでした: copilot が終了したか、起動し直しました'
    )
  })
})

describe('useAgentSessions — 中断の 2 回目(interruptFollowUp)', () => {
  const mockFollowUp = vi.mocked(agentTerminalApi.interruptAgentSessionFollowUp)

  const startCopilotS1 = async (result: Rendered['result']): Promise<void> => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    await startSelected(result)
  }

  const followUpNow = async (
    result: Rendered['result'],
    slotId = 'slot-1',
    sessionId = 's1'
  ): Promise<AgentInterruptFollowUpOutcome | undefined> => {
    let outcome: AgentInterruptFollowUpOutcome | undefined
    await act(async () => {
      outcome = await result.current.interruptFollowUp(slotId, sessionId)
    })
    return outcome
  }

  it('そのタブの今のセッションの sessionId だけを渡して sent を返し、中断の失敗の文言を消す', async () => {
    const { result } = render()
    await startCopilotS1(result)
    mockFollowUp.mockResolvedValueOnce({ kind: 'expired' })
    await followUpNow(result)
    mockFollowUp.mockResolvedValueOnce({ kind: 'sent' })
    expect(await followUpNow(result)).toEqual({ kind: 'sent' })
    expect(mockFollowUp).toHaveBeenLastCalledWith('s1')
    expect(result.current.selected.error).toBeNull()
  })

  it('渡した sessionId がそのタブの今のセッションと違えば、IPC を呼ばず stale(L-037)', async () => {
    const { result } = render()
    await startCopilotS1(result)
    expect(await followUpNow(result, 'slot-1', 's-old')).toEqual({ kind: 'stale' })
    expect(mockFollowUp).not.toHaveBeenCalled()
  })

  it('閉じる途中のタブは、IPC を呼ばず stale', async () => {
    const { result } = render({ onConfirm: () => true })
    await runTwoTabs(result)
    let releaseStop: () => void = () => undefined
    mockStop.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseStop = resolve
      })
    )
    let closing: Promise<boolean> | undefined
    act(() => {
      closing = result.current.closeTab('slot-2')
    })
    expect(await followUpNow(result, 'slot-2', 's-2')).toEqual({ kind: 'stale' })
    expect(mockFollowUp).not.toHaveBeenCalled()
    await act(async () => {
      releaseStop()
      await closing
    })
  })

  it('結果を待つ間に終了して起動し直したら stale で、新しいセッションのタブに何も出さない', async () => {
    const { result } = render()
    await startCopilotS1(result)
    let resolvePending: (value: AgentInterruptFollowUpResult) => void = () => undefined
    mockFollowUp.mockReturnValueOnce(
      new Promise<AgentInterruptFollowUpResult>((resolve) => {
        resolvePending = resolve
      })
    )
    let outcome: Promise<AgentInterruptFollowUpOutcome> | undefined
    act(() => {
      outcome = result.current.interruptFollowUp('slot-1', 's1')
    })
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' }))
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's2',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    await startSelected(result)
    let settled: AgentInterruptFollowUpOutcome | undefined
    await act(async () => {
      resolvePending({ kind: 'no-session' })
      settled = await outcome
    })
    expect(settled).toEqual({ kind: 'stale' })
    expect(result.current.selected.error).toBeNull()
  })

  it('結果を待つ間にそのタブが閉じる途中になったら(停止を待つ間。sessionId は同じ)、stale でそのタブに何も出さない', async () => {
    const { result } = render({ onConfirm: () => true })
    await runTwoTabs(result)
    let resolvePending: (value: AgentInterruptFollowUpResult) => void = () => undefined
    mockFollowUp.mockReturnValueOnce(
      new Promise<AgentInterruptFollowUpResult>((resolve) => {
        resolvePending = resolve
      })
    )
    let outcome: Promise<AgentInterruptFollowUpOutcome> | undefined
    act(() => {
      outcome = result.current.interruptFollowUp('slot-2', 's-2')
    })
    let releaseStop: () => void = () => undefined
    mockStop.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseStop = resolve
      })
    )
    let closing: Promise<boolean> | undefined
    act(() => {
      closing = result.current.closeTab('slot-2')
    })
    let settled: AgentInterruptFollowUpOutcome | undefined
    await act(async () => {
      resolvePending({ kind: 'write-failed' })
      settled = await outcome
    })
    expect(settled).toEqual({ kind: 'stale' })
    expect(tabOf(result.current, 'slot-2').error).toBeNull()
    await act(async () => {
      releaseStop()
      await closing
    })
  })

  it.each<[AgentInterruptFollowUpResult, string]>([
    [
      { kind: 'not-pending' },
      '中断を送れませんでした: 2 回目の Esc を送れる状態ではありませんでした（まだ作業中なら、もう一度押してください）'
    ],
    [
      { kind: 'expired' },
      '中断を送れませんでした: 2 回目の Esc が間に合いませんでした（まだ作業中なら、もう一度押してください）'
    ],
    [{ kind: 'no-session' }, '中断を送れませんでした: copilot が終了したか、起動し直しました'],
    [{ kind: 'write-failed' }, '中断を送れませんでした: ターミナルへの書き込みに失敗しました']
  ])('%o はそのタブの error に出して、そのまま返す', async (ipcResult, message) => {
    const { result } = render()
    await startCopilotS1(result)
    mockFollowUp.mockResolvedValueOnce(ipcResult)
    expect(await followUpNow(result)).toEqual(ipcResult)
    expect(result.current.selected.error).toBe(message)
  })

  it('invoke の拒否は、接頭辞に例外の message を付けて error に出し、error を返す', async () => {
    const { result } = render()
    await startCopilotS1(result)
    mockFollowUp.mockRejectedValueOnce(new Error('ipc down'))
    expect(await followUpNow(result)).toEqual({ kind: 'error', message: 'ipc down' })
    expect(result.current.selected.error).toBe('中断を送れませんでした: ipc down')
  })

  it('window.api の呼び出しが同期で投げても、拒否と同じに扱う(L-055)', async () => {
    const { result } = render()
    await startCopilotS1(result)
    mockFollowUp.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(await followUpNow(result)).toEqual({ kind: 'error', message: 'boom' })
    expect(result.current.selected.error).toBe('中断を送れませんでした: boom')
  })
})

describe('useAgentSessions: CLI の種類(タブの cliKind と名前)', () => {
  const renderKind = (
    appCliKind: AgentCliKind,
    options: Partial<UseAgentSessionsOptions> = {}
  ): ReturnType<typeof renderHook<AgentSessionsState, { appCliKind: AgentCliKind }>> =>
    renderHook(
      (props: { appCliKind: AgentCliKind }) =>
        useAgentSessions({
          folderPath: '/work',
          tabs,
          enabled: true,
          now: currentNow,
          ...options,
          appCliKind: props.appCliKind
        }),
      { initialProps: { appCliKind } }
    )

  it('未起動のタブは設定の種類で名前と種類を出し、設定が変わればついていく', () => {
    const { result, rerender } = renderKind('claude')
    expect(result.current.selected).toMatchObject({ cliKind: 'claude', label: 'claude 1' })
    rerender({ appCliKind: 'copilot' })
    expect(result.current.selected).toMatchObject({ cliKind: 'copilot', label: 'copilot 1' })
  })

  it('起動の結果の種類をタブに入れ、設定が変わっても起動の結果の種類のまま', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    const { result, rerender } = renderKind('claude')
    await startSelected(result)
    expect(result.current.selected).toMatchObject({
      status: 'running',
      cliKind: 'copilot',
      label: 'copilot 1',
      claudeSessionId: null
    })
    rerender({ appCliKind: 'claude' })
    expect(result.current.selected.cliKind).toBe('copilot')
  })

  it('中断の失敗の文言の名前も、設定が変わった後まで起動の結果の種類のまま(タブの名前と同じ規則)', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    const { result, rerender } = renderKind('copilot')
    await startSelected(result)
    rerender({ appCliKind: 'claude' })
    mockInterrupt.mockResolvedValueOnce({ kind: 'no-session' })
    await act(async () => {
      await result.current.interrupt('slot-1')
    })
    expect(result.current.selected).toMatchObject({
      label: 'copilot 1',
      error: '中断を送れませんでした: copilot が終了したか、起動し直しました'
    })
  })

  it('終了しても種類は残る(終了したタブの名前と画面の中身が合う)', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    const { result, rerender } = renderKind('copilot')
    await startSelected(result)
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'stopped' }))
    rerender({ appCliKind: 'claude' })
    expect(result.current.selected).toMatchObject({
      status: 'exited',
      cliKind: 'copilot',
      label: 'copilot 1'
    })
  })

  it('起動を始めると種類を null に戻して設定の種類で出し、結果で入れ直す', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    const { result, rerender } = renderKind('copilot')
    await startSelected(result)
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'stopped' }))
    rerender({ appCliKind: 'claude' })
    let resolveStart: (value: AgentStartResult) => void = () => undefined
    mockStart.mockImplementationOnce(() => new Promise((resolve) => (resolveStart = resolve)))
    let starting: Promise<void> = Promise.resolve()
    act(() => {
      starting = result.current.start('slot-1', NEW)
    })
    expect(result.current.selected).toMatchObject({
      status: 'starting',
      cliKind: 'claude',
      label: 'claude 1'
    })
    await act(async () => {
      resolveStart({ kind: 'started', sessionId: 's2', cliKind: 'claude', claudeSessionId: CSID })
      await starting
    })
    expect(result.current.selected).toMatchObject({ status: 'running', cliKind: 'claude' })
  })

  it('起動の失敗では種類を入れない(設定の種類で出す)', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'error', error: 'spawn-failed', detail: 'x' })
    const { result, rerender } = renderKind('copilot')
    await startSelected(result)
    expect(result.current.selected).toMatchObject({ status: 'none', cliKind: 'copilot' })
    rerender({ appCliKind: 'claude' })
    expect(result.current.selected.cliKind).toBe('claude')
  })

  it('作り直しの後の状態の取得で種類を入れる', async () => {
    mockGetState.mockResolvedValue([
      { slotId: 'slot-1', sessionId: 's9', cliKind: 'copilot', claudeSessionId: null }
    ])
    const { result } = renderKind('claude')
    await waitFor(() =>
      expect(result.current.selected).toMatchObject({
        status: 'running',
        cliKind: 'copilot',
        label: 'copilot 1'
      })
    )
  })

  it('閉じる前の確認は、そのタブの種類の名前で出す', async () => {
    const onConfirm = vi.fn(() => false)
    mockStart
      .mockResolvedValueOnce({
        kind: 'started',
        sessionId: 's-1',
        cliKind: 'copilot',
        claudeSessionId: null
      })
      .mockResolvedValueOnce({
        kind: 'started',
        sessionId: 's-2',
        cliKind: 'claude',
        claudeSessionId: CSID
      })
    const { result } = renderKind('claude', { onConfirm })
    await startSelected(result)
    await act(async () => {
      await result.current.addTab()
    })
    await act(async () => {
      await result.current.closeTab('slot-1')
    })
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(agentCloseTabConfirm('copilot 1'))
  })

  it('起動中のタブを閉じる前の確認は、その時点の設定の種類の名前で出す(closeTab は設定の変化で作り直さない)', async () => {
    const onConfirm = vi.fn(() => false)
    let resolveStart: (value: AgentStartResult) => void = () => undefined
    mockStart
      .mockResolvedValueOnce({
        kind: 'started',
        sessionId: 's-1',
        cliKind: 'claude',
        claudeSessionId: CSID
      })
      .mockImplementationOnce(() => new Promise((r) => (resolveStart = r)))
    const { result, rerender } = renderKind('claude', { onConfirm })
    await startSelected(result)
    let adding: Promise<void> = Promise.resolve()
    act(() => {
      adding = result.current.addTab()
    })
    expect(tabOf(result.current, 'slot-2').status).toBe('starting')
    const closeTab = result.current.closeTab
    rerender({ appCliKind: 'copilot' })
    expect(result.current.closeTab).toBe(closeTab)
    await act(async () => {
      await result.current.closeTab('slot-2')
    })
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(agentCloseTabConfirm('copilot 2'))
    await act(async () => {
      resolveStart({ kind: 'started', sessionId: 's-2', cliKind: 'copilot', claudeSessionId: null })
      await adding
    })
  })
})
