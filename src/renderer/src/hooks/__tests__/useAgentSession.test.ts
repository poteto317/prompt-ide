import { renderHook, act, waitFor } from '@testing-library/react'
import { StrictMode, createElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/agentTerminalApi')

import * as agentTerminalApi from '../../lib/agentTerminalApi'
import { useAgentSession } from '../useAgentSession'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'
import { AGENT_START_CANCELED_DETAIL } from '@shared/types'
import type { AgentSessionSnapshot, AgentStartResult } from '@shared/types'

const mockStart = vi.mocked(agentTerminalApi.startAgentSession)
const mockStop = vi.mocked(agentTerminalApi.stopAgentSession)
const mockGetState = vi.mocked(agentTerminalApi.getAgentSession)

let controller: FakeController
let now = 0

beforeEach(() => {
  vi.resetAllMocks()
  controller = makeFakeController()
  now = 0
  mockGetState.mockResolvedValue(null)
  mockStop.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const render = (
  folderPath: string | null = '/work',
  enabled = true
): ReturnType<typeof renderHook<ReturnType<typeof useAgentSession>, unknown>> =>
  renderHook(() => useAgentSession({ folderPath, controller, enabled, now: () => now }))

const renderStrict = (): ReturnType<
  typeof renderHook<ReturnType<typeof useAgentSession>, unknown>
> =>
  renderHook(
    () => useAgentSession({ folderPath: '/work', controller, enabled: true, now: () => now }),
    { wrapper: ({ children }) => createElement(StrictMode, null, children) }
  )

describe('useAgentSession', () => {
  it('初期状態は none。フォルダが無ければ起動を押せない理由を出す', () => {
    expect(render('/work').result.current.status).toBe('none')
    expect(render(null).result.current.startDisabledReason).toBe('フォルダを開いてください')
  })

  it('起動の直前に画面を消し、測った桁数・行数で起動し、running にしてセッションを controller に渡す', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1' })
    const { result } = render()
    await act(async () => {
      await result.current.start()
    })
    expect(controller.prepareForStart).toHaveBeenCalledOnce()
    expect(mockStart).toHaveBeenCalledWith({ folderPath: '/work', cols: 80, rows: 24 })
    expect(result.current.status).toBe('running')
    expect(controller.sessionId).toBe('s1')
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
      { kind: 'error' as const, error: 'command-not-found' as const, shellPathUnavailable: false },
      'claude コマンドが見つかりません。Claude Code をインストールしてください（探した場所: ログインシェルの PATH）'
    ],
    [
      { kind: 'error' as const, error: 'command-not-found' as const, shellPathUnavailable: true },
      'claude コマンドが見つかりません。Claude Code をインストールしてください（探した場所: ログインシェルの PATH）（ログインシェルから PATH を取得できなかったため、既定の場所だけを探しました）'
    ],
    [
      { kind: 'error' as const, error: 'spawn-failed' as const, detail: 'boom' },
      'エージェントを起動できませんでした: boom'
    ]
  ])('起動の失敗 %o の文言を出し none に戻す', async (startResult, message) => {
    mockStart.mockResolvedValueOnce(startResult)
    const { result } = render()
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.error).toBe(message)
    expect(result.current.status).toBe('none')
    expect(controller.sessionId).toBeNull()
  })

  it('起動中・起動済みの 2 回目の start は依頼しない', async () => {
    let resolve: (value: { kind: 'started'; sessionId: string }) => void = () => undefined
    mockStart.mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    const { result } = render()
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.start()
    })
    await act(async () => {
      await result.current.start()
    })
    await act(async () => {
      resolve({ kind: 'started', sessionId: 's1' })
      await first
    })
    await act(async () => {
      await result.current.start()
    })
    expect(mockStart).toHaveBeenCalledOnce()
  })

  it('自分のセッションの終了で exited にし、終了コードを持つ。ほかのセッションの終了は無視する', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1' })
    const { result } = render()
    await act(async () => {
      await result.current.start()
    })
    act(() =>
      controller.emitExit({ sessionId: 'other', exitCode: 1, signal: null, reason: 'exited' })
    )
    expect(result.current.status).toBe('running')
    now = 10_000
    act(() => controller.emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' }))
    expect(result.current.status).toBe('exited')
    expect(result.current.exit).toEqual({ exitCode: 0, reason: 'exited' })
    expect(result.current.error).toBeNull()
    expect(controller.sessionId).toBeNull()
  })

  it('起動の直後(2 秒以内)に終了コード ≠ 0 で終わったら案内を添える', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1' })
    const { result } = render()
    await act(async () => {
      await result.current.start()
    })
    now = 1_999
    act(() => controller.emitExit({ sessionId: 's1', exitCode: 1, signal: null, reason: 'exited' }))
    expect(result.current.error).toBe(
      '起動の直後に終了しました。ターミナルの表示を確かめてください'
    )
  })

  it('stop は現在のセッションを止める。セッションが無ければ何もしない', async () => {
    const { result } = render()
    await act(async () => {
      await result.current.stop()
    })
    expect(mockStop).not.toHaveBeenCalled()
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1' })
    await act(async () => {
      await result.current.start()
    })
    await act(async () => {
      await result.current.stop()
    })
    expect(mockStop).toHaveBeenCalledWith('s1')
  })

  it('stop が失敗したら、終了の失敗の接頭辞に理由を付けて出す', async () => {
    const { result } = render()
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1' })
    await act(async () => {
      await result.current.start()
    })
    mockStop.mockRejectedValueOnce(new Error('ipc down'))
    await act(async () => {
      await result.current.stop()
    })
    expect(result.current.error).toBe('エージェントを終了できませんでした: ipc down')
  })

  it('部品の作り直しの後、main のセッションに合わせる', async () => {
    mockGetState.mockResolvedValueOnce({ sessionId: 's9' })
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe('running'))
    expect(controller.sessionId).toBe('s9')
  })

  it('従来の方式(enabled が false)では main に問い合わせない', () => {
    render('/work', false)
    expect(mockGetState).not.toHaveBeenCalled()
  })

  // ここから: プランの一覧に無い、申し送り(呼び順・already-running・取り消し・StrictMode・再起動・アンマウント)の確認

  it('prepareForStart → fit → startAgentSession → setSession の順で呼ぶ', async () => {
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
      return { kind: 'started', sessionId: 's1' }
    })
    const { result } = render()
    await act(async () => {
      await result.current.start()
    })
    expect(calls).toEqual(['prepare', 'fit', 'start', 'setSession:s1'])
    expect(mockStart).toHaveBeenCalledWith({ folderPath: '/work', cols: 100, rows: 30 })
  })

  it('already-running は何も出さず、既存のセッションに合わせる', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'already-running', sessionId: 's7' })
    const { result } = render()
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.status).toBe('running')
    expect(result.current.sessionId).toBe('s7')
    expect(result.current.error).toBeNull()
    expect(controller.sessionId).toBe('s7')
  })

  it('起動の取り消し(起動の途中の停止)はエラーを出さず none に戻す', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'error',
      error: 'spawn-failed',
      detail: AGENT_START_CANCELED_DETAIL
    })
    const setSession = vi.fn(controller.setSession)
    controller.setSession = setSession
    const { result } = render()
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.error).toBeNull()
    expect(result.current.status).toBe('none')
    expect(setSession).toHaveBeenCalledWith(null)
  })

  it('起動の依頼が例外を投げたら文言を出し none に戻す', async () => {
    mockStart.mockRejectedValueOnce(new Error('ipc down'))
    const setSession = vi.fn(controller.setSession)
    controller.setSession = setSession
    const { result } = render()
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.error).toBe('エージェントを起動できませんでした: ipc down')
    expect(result.current.status).toBe('none')
    // 起動の準備(出力の溜め込み)を controller に終わらせる
    expect(setSession).toHaveBeenCalledWith(null)
  })

  it('終了した後にもう一度起動でき、前の終了と案内を消す', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1' })
    const { result } = render()
    await act(async () => {
      await result.current.start()
    })
    act(() => controller.emitExit({ sessionId: 's1', exitCode: 1, signal: null, reason: 'exited' }))
    expect(result.current.error).not.toBeNull()
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's2' })
    await act(async () => {
      await result.current.start()
    })
    expect(mockStart).toHaveBeenCalledTimes(2)
    expect(controller.prepareForStart).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('running')
    expect(result.current.sessionId).toBe('s2')
    expect(result.current.exit).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('終了の通知が起動の結果より先に届いても exited にする', async () => {
    mockStart.mockImplementationOnce(async () => {
      controller.emitExit({ sessionId: 's1', exitCode: 1, signal: null, reason: 'exited' })
      return { kind: 'started', sessionId: 's1' }
    })
    const { result } = render()
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.status).toBe('exited')
    expect(result.current.exit).toEqual({ exitCode: 1, reason: 'exited' })
    expect(result.current.error).toBe(
      '起動の直後に終了しました。ターミナルの表示を確かめてください'
    )
    expect(controller.sessionId).toBeNull()
  })

  it('起動中に main のセッションの問い合わせが返っても、起動の結果を待つ', async () => {
    let resolveSnapshot: (value: AgentSessionSnapshot) => void = () => undefined
    mockGetState.mockReset()
    mockGetState.mockImplementationOnce(() => new Promise((r) => (resolveSnapshot = r)))
    let resolveStart: (value: AgentStartResult) => void = () => undefined
    mockStart.mockImplementationOnce(() => new Promise((r) => (resolveStart = r)))
    const { result } = render()
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.start()
    })
    await act(async () => {
      resolveSnapshot({ sessionId: 's1' })
    })
    expect(result.current.status).toBe('starting')
    await act(async () => {
      resolveStart({ kind: 'error', error: 'spawn-failed', detail: AGENT_START_CANCELED_DETAIL })
      await first
    })
    expect(result.current.status).toBe('none')
    expect(controller.sessionId).toBeNull()
  })

  it('StrictMode の二重マウントでも終了の購読は 1 つで、アンマウントで解除する', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1' })
    const { result, unmount } = renderStrict()
    await waitFor(() => expect(mockGetState).toHaveBeenCalled())
    expect(controller.exitListeners.size).toBe(1)
    await act(async () => {
      await result.current.start()
    })
    expect(mockStart).toHaveBeenCalledOnce()
    act(() =>
      controller.emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'stopped' })
    )
    expect(result.current.status).toBe('exited')
    unmount()
    expect(controller.exitListeners.size).toBe(0)
  })

  it('StrictMode でも main のセッションに 1 回だけ合わせる', async () => {
    mockGetState.mockResolvedValue({ sessionId: 's9' })
    const setSession = vi.fn(controller.setSession)
    controller.setSession = setSession
    const { result } = renderStrict()
    await waitFor(() => expect(result.current.status).toBe('running'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(setSession).toHaveBeenCalledOnce()
    expect(setSession).toHaveBeenCalledWith('s9')
  })

  it('問い合わせの途中で従来の方式に切り替わったら、main のセッションに合わせない', async () => {
    let resolveSnapshot: (value: AgentSessionSnapshot) => void = () => undefined
    mockGetState.mockReset()
    mockGetState.mockImplementationOnce(() => new Promise((r) => (resolveSnapshot = r)))
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useAgentSession({ folderPath: '/work', controller, enabled, now: () => now }),
      { initialProps: { enabled: true } }
    )
    rerender({ enabled: false })
    await act(async () => {
      resolveSnapshot({ sessionId: 's9' })
    })
    expect(result.current.status).toBe('none')
    expect(controller.sessionId).toBeNull()
  })

  it('アンマウントの後に起動の結果が届いたら、状態は更新せずセッションは controller に渡す', async () => {
    const consoleError = vi.spyOn(console, 'error')
    let resolveStart: (value: AgentStartResult) => void = () => undefined
    mockStart.mockImplementationOnce(() => new Promise((r) => (resolveStart = r)))
    const { result, unmount } = render()
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.start()
    })
    unmount()
    await act(async () => {
      resolveStart({ kind: 'started', sessionId: 's1' })
      await first
    })
    expect(controller.sessionId).toBe('s1')
    expect(consoleError).not.toHaveBeenCalled()
  })
})
