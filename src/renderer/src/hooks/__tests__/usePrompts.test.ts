import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Prompt } from '../../types'

const mockLoad = vi.hoisted(() => vi.fn())
const mockSave = vi.hoisted(() => vi.fn())

vi.mock('../usePromptsPersistence', () => ({
  usePromptsPersistence: () => ({ load: mockLoad, save: mockSave }),
}))

import { usePrompts } from '../usePrompts'

beforeEach(() => {
  vi.clearAllMocks()
  mockLoad.mockResolvedValue([])
  mockSave.mockImplementation(() => {})
})

describe('初期ロード', () => {
  it('マウント時に load が呼ばれる', async () => {
    renderHook(() => usePrompts())
    await waitFor(() => expect(mockLoad).toHaveBeenCalledOnce())
  })

  it('load の結果が prompts に反映される', async () => {
    const stored: Prompt[] = [{ id: 'p1', title: 'T', content: 'C', createdAt: 1 }]
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toEqual(stored))
  })

  it('ロード完了後に promptsLoaded が true になる', async () => {
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.promptsLoaded).toBe(true))
  })

  it('初期状態で prompts が空配列', async () => {
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.promptsLoaded).toBe(true))
    expect(result.current.prompts).toEqual([])
  })
})

describe('addPrompt', () => {
  it('プロンプトが追加される', async () => {
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.promptsLoaded).toBe(true))
    act(() => result.current.addPrompt('タイトル', 'コンテンツ'))
    expect(result.current.prompts).toHaveLength(1)
    expect(result.current.prompts[0].title).toBe('タイトル')
    expect(result.current.prompts[0].content).toBe('コンテンツ')
  })

  it('各プロンプトに一意の id が付与される', async () => {
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.promptsLoaded).toBe(true))
    act(() => {
      result.current.addPrompt('タイトル1', 'コンテンツ1')
      result.current.addPrompt('タイトル2', 'コンテンツ2')
    })
    const [p1, p2] = result.current.prompts
    expect(p1.id).not.toBe(p2.id)
  })

  it('addPrompt で createdAt が設定される', async () => {
    const before = Date.now()
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.promptsLoaded).toBe(true))
    act(() => result.current.addPrompt('タイトル', 'コンテンツ'))
    const after = Date.now()
    expect(result.current.prompts[0].createdAt).toBeGreaterThanOrEqual(before)
    expect(result.current.prompts[0].createdAt).toBeLessThanOrEqual(after)
  })

  it('addPrompt 後に save が呼ばれる', async () => {
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.promptsLoaded).toBe(true))
    act(() => result.current.addPrompt('タイトル', 'コンテンツ'))
    expect(mockSave).toHaveBeenCalledWith(result.current.prompts)
  })

  it('複数回 addPrompt すると save がその都度呼ばれる', async () => {
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.promptsLoaded).toBe(true))
    act(() => {
      result.current.addPrompt('タイトル1', 'コンテンツ1')
      result.current.addPrompt('タイトル2', 'コンテンツ2')
    })
    expect(mockSave).toHaveBeenCalledTimes(2)
  })
})

describe('ロード完了前のミューテーション競合', () => {
  it('ロード完了前に addPrompt しても既存の永続化データが失われない（マージ）', async () => {
    const stored: Prompt[] = [{ id: 'existing', title: '既存', content: 'C', createdAt: 1 }]
    let resolveLoad!: (value: Prompt[]) => void
    mockLoad.mockReturnValueOnce(
      new Promise<Prompt[]>((resolve) => {
        resolveLoad = resolve
      })
    )
    const { result } = renderHook(() => usePrompts())

    act(() => result.current.addPrompt('新規', 'コンテンツ'))
    expect(result.current.prompts).toHaveLength(1)

    await act(async () => resolveLoad(stored))
    expect(result.current.promptsLoaded).toBe(true)
    // 既存データと新規追加がマージされて両方残る
    expect(result.current.prompts).toHaveLength(2)
    expect(result.current.prompts.some((p) => p.id === 'existing')).toBe(true)
    expect(result.current.prompts.some((p) => p.title === '新規')).toBe(true)
  })

  it('ロード完了前に deletePrompt した場合、ロード後にマージして削除が反映される', async () => {
    let resolveLoad!: (value: Prompt[]) => void
    mockLoad.mockReturnValueOnce(
      new Promise<Prompt[]>((resolve) => {
        resolveLoad = resolve
      })
    )
    const { result } = renderHook(() => usePrompts())

    act(() => result.current.deletePrompt('p1'))

    const stored: Prompt[] = [
      { id: 'p1', title: 'T1', content: 'C1', createdAt: 1 },
      { id: 'p2', title: 'T2', content: 'C2', createdAt: 2 },
    ]
    await act(async () => resolveLoad(stored))
    expect(result.current.promptsLoaded).toBe(true)
    // p1 が削除され p2 のみ残る
    expect(result.current.prompts).toHaveLength(1)
    expect(result.current.prompts[0].id).toBe('p2')
  })

  it('ロード完了前にミューテーションがなければロードデータがそのまま反映される', async () => {
    const stored: Prompt[] = [{ id: 'p1', title: 'T', content: 'C', createdAt: 1 }]
    let resolveLoad!: (value: Prompt[]) => void
    mockLoad.mockReturnValueOnce(
      new Promise<Prompt[]>((resolve) => {
        resolveLoad = resolve
      })
    )
    const { result } = renderHook(() => usePrompts())

    await act(async () => resolveLoad(stored))
    expect(result.current.promptsLoaded).toBe(true)
    expect(result.current.prompts).toEqual(stored)
  })

  it('ロード完了前の addPrompt はマージ後に save が呼ばれる', async () => {
    let resolveLoad!: (value: Prompt[]) => void
    mockLoad.mockReturnValueOnce(
      new Promise<Prompt[]>((resolve) => {
        resolveLoad = resolve
      })
    )
    const { result } = renderHook(() => usePrompts())

    act(() => result.current.addPrompt('新規', 'コンテンツ'))
    expect(mockSave).not.toHaveBeenCalled()

    const stored: Prompt[] = [{ id: 'existing', title: '既存', content: 'C', createdAt: 1 }]
    await act(async () => resolveLoad(stored))

    expect(mockSave).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'existing' }),
        expect.objectContaining({ title: '新規' }),
      ])
    )
  })

  it('ロード完了前にミューテーションがない場合は save を呼ばない', async () => {
    const stored: Prompt[] = [{ id: 'p1', title: 'T', content: 'C', createdAt: 1 }]
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.promptsLoaded).toBe(true))
    expect(mockSave).not.toHaveBeenCalled()
  })
})

describe('deletePrompt', () => {
  it('指定 ID のプロンプトが削除される', async () => {
    const stored: Prompt[] = [
      { id: 'p1', title: 'タイトル1', content: 'コンテンツ1', createdAt: 1 },
      { id: 'p2', title: 'タイトル2', content: 'コンテンツ2', createdAt: 2 },
    ]
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(2))
    act(() => result.current.deletePrompt('p1'))
    expect(result.current.prompts).toHaveLength(1)
    expect(result.current.prompts[0].id).toBe('p2')
  })

  it('deletePrompt 後に save が呼ばれる', async () => {
    const stored: Prompt[] = [{ id: 'p1', title: 'T', content: 'C', createdAt: 1 }]
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(1))
    act(() => result.current.deletePrompt('p1'))
    expect(mockSave).toHaveBeenCalledWith([])
  })

  it('存在しない ID を指定しても他のプロンプトは変化しない', async () => {
    const stored: Prompt[] = [{ id: 'p1', title: 'T', content: 'C', createdAt: 1 }]
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(1))
    act(() => result.current.deletePrompt('non-existent'))
    expect(result.current.prompts).toHaveLength(1)
  })
})
