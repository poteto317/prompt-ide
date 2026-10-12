import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { AgentChangesController } from '../useAgentChanges'

// 記録の写しそのものは useAgentChanges.test.ts で確かめる。ここでは前段の合成(begin → 一覧の取り直し・trigger・参照の安定)だけを見る
const mockUseAgentChanges = vi.hoisted(() =>
  vi.fn<(folderPath: string | null) => AgentChangesController>()
)
vi.mock('../useAgentChanges', () => ({ useAgentChanges: mockUseAgentChanges }))

import { useAgentChangesRecording } from '../useAgentChangesRecording'
import type { AgentChangesRecording } from '../useAgentChangesRecording'
import { makeAgentChangesController } from '../../__tests__/makeAgentChangesState'

beforeEach(() => {
  vi.clearAllMocks()
})

const variants = [
  ['beginForSendAndRefresh', 'send'],
  ['beginManuallyAndRefresh', 'manual']
] as const satisfies readonly (readonly [keyof Omit<AgentChangesRecording, 'changes'>, string])[]

describe('useAgentChangesRecording', () => {
  it('開いているフォルダを useAgentChanges に渡し、その戻り値を changes として返す', () => {
    const controller = makeAgentChangesController()
    mockUseAgentChanges.mockReturnValue(controller)
    const { result } = renderHook(() => useAgentChangesRecording('/repo'))
    expect(mockUseAgentChanges).toHaveBeenCalledWith('/repo')
    expect(result.current.changes).toBe(controller)
  })

  it.each(variants)(
    '%s は %s で記録を始め終えてから、件数を読み上げずに一覧を取り直す',
    async (name, trigger) => {
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
        done = result.current[name]()
      })
      expect(calls).toEqual(['begin'])
      expect(controller.begin).toHaveBeenCalledExactlyOnceWith(trigger)
      await act(async () => {
        resolveBegin()
        await done
      })
      expect(calls).toEqual(['begin', 'refresh'])
      expect(controller.refresh).toHaveBeenCalledExactlyOnceWith()
    }
  )

  it.each(variants)('%s は一覧の取り直しの終わりを待たない', async (name) => {
    const controller = makeAgentChangesController({
      refresh: vi.fn(() => new Promise<void>(() => undefined))
    })
    mockUseAgentChanges.mockReturnValue(controller)
    const { result } = renderHook(() => useAgentChangesRecording('/repo'))
    let settled = false
    await act(async () => {
      await result.current[name]()
      settled = true
    })
    expect(settled).toBe(true)
    expect(controller.refresh).toHaveBeenCalledOnce()
  })

  // 送信の関数(useAgentPromptSender.send)とセクションのボタンの依存になるため、描画のたびに作り直さない
  it.each(variants)('%s の参照は、begin・refresh が同じなら描画をまたいで変わらない', (name) => {
    const begin = vi.fn(async () => undefined)
    const refresh = vi.fn(async () => undefined)
    mockUseAgentChanges.mockImplementation(() => makeAgentChangesController({ begin, refresh }))
    const { result, rerender } = renderHook(() => useAgentChangesRecording('/repo'))
    const first = result.current[name]
    rerender()
    expect(result.current[name]).toBe(first)
  })

  // 依存(begin・refresh)を外すと、作り直した後も古い写しの begin・refresh を呼び続ける
  it.each(variants)('%s は、begin・refresh が変われば新しいものを呼ぶ', async (name, trigger) => {
    const previous = makeAgentChangesController()
    mockUseAgentChanges.mockReturnValue(previous)
    const { result, rerender } = renderHook(() => useAgentChangesRecording('/repo'))
    const first = result.current[name]
    const next = makeAgentChangesController()
    mockUseAgentChanges.mockReturnValue(next)
    rerender()
    expect(result.current[name]).not.toBe(first)
    await act(async () => {
      await result.current[name]()
    })
    expect(next.begin).toHaveBeenCalledExactlyOnceWith(trigger)
    expect(next.refresh).toHaveBeenCalledOnce()
    expect(previous.begin).not.toHaveBeenCalled()
    expect(previous.refresh).not.toHaveBeenCalled()
  })
})
