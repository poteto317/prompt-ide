import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { AgentChangesController } from '../useAgentChanges'

// 記録の写しそのものは useAgentChanges.test.ts で確かめる。ここでは前段の合成(begin → 一覧の取り直し・参照の安定)だけを見る
const mockUseAgentChanges = vi.hoisted(() =>
  vi.fn<(folderPath: string | null) => AgentChangesController>()
)
vi.mock('../useAgentChanges', () => ({ useAgentChanges: mockUseAgentChanges }))

import { useAgentChangesRecording } from '../useAgentChangesRecording'
import { makeAgentChangesController } from '../../__tests__/makeAgentChangesState'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useAgentChangesRecording', () => {
  it('開いているフォルダを useAgentChanges に渡し、その戻り値を changes として返す', () => {
    const controller = makeAgentChangesController()
    mockUseAgentChanges.mockReturnValue(controller)
    const { result } = renderHook(() => useAgentChangesRecording('/repo'))
    expect(mockUseAgentChanges).toHaveBeenCalledWith('/repo')
    expect(result.current.changes).toBe(controller)
  })

  it('beginAndRefresh は記録を始め終えてから一覧を取り直す', async () => {
    const calls: string[] = []
    let resolveBegin: () => void = () => undefined
    const controller = makeAgentChangesController({
      begin: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            calls.push('begin')
            resolveBegin = resolve
          })
      ),
      refresh: vi.fn(async () => {
        calls.push('refresh')
      })
    })
    mockUseAgentChanges.mockReturnValue(controller)
    const { result } = renderHook(() => useAgentChangesRecording('/repo'))
    let done: Promise<void> = Promise.resolve()
    act(() => {
      done = result.current.beginAndRefresh()
    })
    expect(calls).toEqual(['begin'])
    expect(controller.refresh).not.toHaveBeenCalled()
    await act(async () => {
      resolveBegin()
      await done
    })
    expect(calls).toEqual(['begin', 'refresh'])
    // 一覧の取り直しは件数を読み上げない(引数なし)
    expect(controller.refresh).toHaveBeenCalledExactlyOnceWith()
  })

  it('beginAndRefresh は一覧の取り直しの終わりを待たない', async () => {
    const controller = makeAgentChangesController({
      refresh: vi.fn(() => new Promise<void>(() => undefined))
    })
    mockUseAgentChanges.mockReturnValue(controller)
    const { result } = renderHook(() => useAgentChangesRecording('/repo'))
    let settled = false
    await act(async () => {
      await result.current.beginAndRefresh().then(() => {
        settled = true
      })
    })
    expect(settled).toBe(true)
    expect(controller.refresh).toHaveBeenCalledOnce()
  })

  // 送信の関数(useAgentPromptSender.send)の依存になるため、描画のたびに作り直さない
  it('beginAndRefresh の参照は、begin・refresh が同じなら描画をまたいで変わらない', () => {
    const begin = vi.fn(async () => undefined)
    const refresh = vi.fn(async () => undefined)
    // 描画ごとに別のオブジェクト(中の begin・refresh だけが同じ)を返す
    mockUseAgentChanges.mockImplementation(() => makeAgentChangesController({ begin, refresh }))
    const { result, rerender } = renderHook(() => useAgentChangesRecording('/repo'))
    const first = result.current.beginAndRefresh
    rerender()
    expect(result.current.beginAndRefresh).toBe(first)
  })

  it('begin・refresh が変われば、新しいものを呼ぶ', async () => {
    mockUseAgentChanges.mockReturnValue(makeAgentChangesController())
    const { result, rerender } = renderHook(() => useAgentChangesRecording('/repo'))
    const first = result.current.beginAndRefresh
    const next = makeAgentChangesController()
    mockUseAgentChanges.mockReturnValue(next)
    rerender()
    expect(result.current.beginAndRefresh).not.toBe(first)
    await act(async () => {
      await result.current.beginAndRefresh()
    })
    expect(next.begin).toHaveBeenCalledOnce()
    expect(next.refresh).toHaveBeenCalledOnce()
  })
})
