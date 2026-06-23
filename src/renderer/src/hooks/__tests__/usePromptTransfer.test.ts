import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Prompt } from '../../types'
import type { Transform } from '../useBufferedPersistence'

const mockApiExport = vi.hoisted(() => vi.fn())
const mockApiImport = vi.hoisted(() => vi.fn())

vi.mock('../../lib/promptsApi', () => ({
  exportPrompts: mockApiExport,
  importPrompts: mockApiImport,
}))

import { usePromptTransfer } from '../usePromptTransfer'

const p1: Prompt = { id: 'p1', title: 'A', content: 'a', createdAt: 1 }
const p2: Prompt = { id: 'p2', title: 'B', content: 'b', createdAt: 2, pinned: true }

beforeEach(() => {
  vi.clearAllMocks()
  mockApiExport.mockResolvedValue(true)
  mockApiImport.mockResolvedValue(null)
})

describe('exportPrompts', () => {
  it('現在の prompts で API を呼び、結果（true）を返す', async () => {
    const apply = vi.fn()
    const { result } = renderHook(() => usePromptTransfer([p1, p2], apply))

    let returned: boolean | undefined
    await act(async () => {
      returned = await result.current.exportPrompts()
    })
    expect(mockApiExport).toHaveBeenCalledWith([p1, p2])
    expect(returned).toBe(true)
  })

  it('参照が prompts 変更後も安定している', () => {
    const apply = vi.fn()
    const { result, rerender } = renderHook(
      ({ prompts }: { prompts: Prompt[] }) => usePromptTransfer(prompts, apply),
      { initialProps: { prompts: [p1] } }
    )
    const firstRef = result.current.exportPrompts
    rerender({ prompts: [p1, p2] })
    expect(result.current.exportPrompts).toBe(firstRef)
  })

  it('prompts 変更後は最新の配列で API を呼ぶ（promptsRef 更新）', async () => {
    const apply = vi.fn()
    const { result, rerender } = renderHook(
      ({ prompts }: { prompts: Prompt[] }) => usePromptTransfer(prompts, apply),
      { initialProps: { prompts: [p1] } }
    )
    rerender({ prompts: [p1, p2] })
    await act(async () => {
      await result.current.exportPrompts()
    })
    expect(mockApiExport).toHaveBeenCalledWith([p1, p2])
  })
})

describe('importPrompts', () => {
  it('取り込んだ各要素を id 再生成して apply で末尾追加し、件数を返す', async () => {
    const imported: Prompt[] = [
      { id: 'imp1', title: '取込1', content: 'X', createdAt: 100 },
      { id: 'imp2', title: '取込2', content: 'Y', createdAt: 200, pinned: true },
    ]
    mockApiImport.mockResolvedValue(imported)
    const apply = vi.fn()
    const { result } = renderHook(() => usePromptTransfer([p1], apply))

    let count: number | undefined
    await act(async () => {
      count = await result.current.importPrompts()
    })

    expect(count).toBe(2)
    expect(apply).toHaveBeenCalledOnce()
    // apply に渡された transform を既存配列へ適用して末尾追加を検証
    const transform = apply.mock.calls[0][0] as Transform<Prompt>
    const next = transform([p1])
    expect(next).toHaveLength(3)
    expect(next[0]).toBe(p1)
    expect(next[1].title).toBe('取込1')
    expect(next[2].title).toBe('取込2')
    // id は再生成され、createdAt/pinned は保持
    expect(next[1].id).not.toBe('imp1')
    expect(next[2].id).not.toBe('imp2')
    expect(next[2].createdAt).toBe(200)
    expect(next[2].pinned).toBe(true)
  })

  it('キャンセル（null）のとき apply を呼ばず 0 を返す', async () => {
    mockApiImport.mockResolvedValue(null)
    const apply = vi.fn()
    const { result } = renderHook(() => usePromptTransfer([p1], apply))

    let count: number | undefined
    await act(async () => {
      count = await result.current.importPrompts()
    })
    expect(count).toBe(0)
    expect(apply).not.toHaveBeenCalled()
  })

  it('空配列のとき apply を呼ばず 0 を返す', async () => {
    mockApiImport.mockResolvedValue([])
    const apply = vi.fn()
    const { result } = renderHook(() => usePromptTransfer([p1], apply))

    let count: number | undefined
    await act(async () => {
      count = await result.current.importPrompts()
    })
    expect(count).toBe(0)
    expect(apply).not.toHaveBeenCalled()
  })

  it('参照が apply 不変なら安定している', () => {
    const apply = vi.fn()
    const { result, rerender } = renderHook(
      ({ prompts }: { prompts: Prompt[] }) => usePromptTransfer(prompts, apply),
      { initialProps: { prompts: [p1] } }
    )
    const firstRef = result.current.importPrompts
    rerender({ prompts: [p1, p2] })
    expect(result.current.importPrompts).toBe(firstRef)
  })
})
