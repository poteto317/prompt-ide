import { act, renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { startBlockedReasonOf, useAgentWorkspaceSwitching } from '../useAgentWorkspaceSwitching'
import {
  AGENT_START_DISABLED_SWITCHING_CLI_KIND,
  AGENT_START_DISABLED_SWITCHING_MODE
} from '../../lib/agentSessionMessages'

/** 解決を外から決められる Promise(切り替えの手順の途中を作る) */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (err: Error) => void } {
  let resolve!: () => void
  let reject!: (err: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('startBlockedReasonOf', () => {
  it('切り替えの種類ごとの起動を受け付けない理由を返し、途中でなければ null', () => {
    expect(startBlockedReasonOf('mode')).toBe(AGENT_START_DISABLED_SWITCHING_MODE)
    expect(startBlockedReasonOf('cli-kind')).toBe(AGENT_START_DISABLED_SWITCHING_CLI_KIND)
    expect(startBlockedReasonOf(null)).toBeNull()
  })
})

describe('useAgentWorkspaceSwitching', () => {
  it('初めは途中でなく、起動を受け付ける', () => {
    const { result } = renderHook(() => useAgentWorkspaceSwitching())
    expect(result.current.switching).toBeNull()
    expect(result.current.startBlockedReason).toBeNull()
  })

  it.each([
    ['mode', AGENT_START_DISABLED_SWITCHING_MODE],
    ['cli-kind', AGENT_START_DISABLED_SWITCHING_CLI_KIND]
  ] as const)('%s の手順の間は途中の印と理由を出し、終わると外す', async (kind, reason) => {
    const { result } = renderHook(() => useAgentWorkspaceSwitching())
    const task = deferred()
    let running!: Promise<void>
    act(() => {
      running = result.current.runSwitching(kind, () => task.promise)
    })
    expect(result.current.switching).toBe(kind)
    expect(result.current.startBlockedReason).toBe(reason)
    await act(async () => {
      task.resolve()
      await running
    })
    expect(result.current.switching).toBeNull()
    expect(result.current.startBlockedReason).toBeNull()
  })

  it('途中の間は、同じ描画の中の 2 回目も、もう一方の切り替えも手順を呼ばない', async () => {
    const { result } = renderHook(() => useAgentWorkspaceSwitching())
    const first = deferred()
    const second = vi.fn(async () => undefined)
    const third = vi.fn(async () => undefined)
    let running!: Promise<void>
    await act(async () => {
      const { runSwitching } = result.current
      running = runSwitching('mode', () => first.promise)
      // 同じ描画の値(state はまだ null)のまま呼んでも ref で止まる
      await runSwitching('mode', second)
      await runSwitching('cli-kind', third)
    })
    expect(second).not.toHaveBeenCalled()
    expect(third).not.toHaveBeenCalled()
    expect(result.current.switching).toBe('mode')
    await act(async () => {
      first.resolve()
      await running
    })
    // 終わった後は次の切り替えを始められる
    await act(async () => {
      await result.current.runSwitching('cli-kind', third)
    })
    expect(third).toHaveBeenCalledOnce()
    expect(result.current.switching).toBeNull()
  })

  it('手順が投げても印を外し、例外は呼び出し側へ返す', async () => {
    const { result } = renderHook(() => useAgentWorkspaceSwitching())
    const task = deferred()
    let running!: Promise<void>
    act(() => {
      running = result.current.runSwitching('cli-kind', () => task.promise)
    })
    const failure = new Error('保存に失敗')
    await act(async () => {
      task.reject(failure)
      await expect(running).rejects.toBe(failure)
    })
    expect(result.current.switching).toBeNull()
    const next = vi.fn(async () => undefined)
    await act(async () => {
      await result.current.runSwitching('mode', next)
    })
    expect(next).toHaveBeenCalledOnce()
  })
})
