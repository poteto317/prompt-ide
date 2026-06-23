import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Prompt } from '../../types'
import { sortByPinned } from '../../lib/promptUtils'

const mockLoad = vi.hoisted(() => vi.fn())
const mockSave = vi.hoisted(() => vi.fn())
const mockApiExport = vi.hoisted(() => vi.fn())
const mockApiImport = vi.hoisted(() => vi.fn())

vi.mock('../usePromptsPersistence', () => ({
  usePromptsPersistence: () => ({ load: mockLoad, save: mockSave }),
}))

vi.mock('../../lib/promptsApi', () => ({
  exportPrompts: mockApiExport,
  importPrompts: mockApiImport,
}))

import { usePrompts } from '../usePrompts'

beforeEach(() => {
  vi.clearAllMocks()
  mockLoad.mockResolvedValue([])
  mockSave.mockImplementation(() => {})
  mockApiExport.mockResolvedValue(true)
  mockApiImport.mockResolvedValue(null)
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

describe('クリーンアップ（アンマウント）', () => {
  it('アンマウント後にロードが完了しても promptsLoaded は false のまま', async () => {
    let resolveLoad!: (value: Prompt[]) => void
    mockLoad.mockReturnValueOnce(
      new Promise<Prompt[]>((resolve) => {
        resolveLoad = resolve
      })
    )
    const { result, unmount } = renderHook(() => usePrompts())

    unmount()
    await act(async () => resolveLoad([{ id: 'p1', title: 'T', content: 'C', createdAt: 1 }]))

    expect(result.current.promptsLoaded).toBe(false)
    expect(result.current.prompts).toHaveLength(0)
  })

  it('ロード前に addPrompt しアンマウントした場合、ロード完了後も save が呼ばれない', async () => {
    let resolveLoad!: (value: Prompt[]) => void
    mockLoad.mockReturnValueOnce(
      new Promise<Prompt[]>((resolve) => {
        resolveLoad = resolve
      })
    )
    const { result, unmount } = renderHook(() => usePrompts())

    // ロード完了前に addPrompt（pending op を積む）
    act(() => result.current.addPrompt('新規', 'コンテンツ'))
    // アンマウント
    unmount()

    // ロードが完了しても cancelled = true なので save は呼ばれない
    await act(async () => resolveLoad([]))
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

describe('updatePrompt', () => {
  it('指定 ID のプロンプトの title と content が更新される', async () => {
    const stored: Prompt[] = [
      { id: 'p1', title: '旧タイトル', content: '旧コンテンツ', createdAt: 1 },
    ]
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(1))
    act(() => result.current.updatePrompt('p1', '新タイトル', '新コンテンツ'))
    expect(result.current.prompts[0].title).toBe('新タイトル')
    expect(result.current.prompts[0].content).toBe('新コンテンツ')
  })

  it('updatePrompt 後に save が呼ばれる', async () => {
    const stored: Prompt[] = [{ id: 'p1', title: 'T', content: 'C', createdAt: 1 }]
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(1))
    act(() => result.current.updatePrompt('p1', '新T', '新C'))
    expect(mockSave).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'p1', title: '新T', content: '新C' }),
      ])
    )
  })

  it('他のプロンプトは変化しない', async () => {
    const stored: Prompt[] = [
      { id: 'p1', title: 'T1', content: 'C1', createdAt: 1 },
      { id: 'p2', title: 'T2', content: 'C2', createdAt: 2 },
    ]
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(2))
    act(() => result.current.updatePrompt('p1', '新T1', '新C1'))
    expect(result.current.prompts[1].title).toBe('T2')
    expect(result.current.prompts[1].content).toBe('C2')
  })

  it('存在しない ID を指定しても他のプロンプトは変化しない', async () => {
    const stored: Prompt[] = [{ id: 'p1', title: 'T', content: 'C', createdAt: 1 }]
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(1))
    act(() => result.current.updatePrompt('non-existent', '新T', '新C'))
    expect(result.current.prompts[0].title).toBe('T')
    expect(result.current.prompts[0].content).toBe('C')
  })

  it('ロード完了前に updatePrompt しても createdAt は保持される', async () => {
    let resolveLoad!: (value: Prompt[]) => void
    mockLoad.mockReturnValueOnce(
      new Promise<Prompt[]>((resolve) => {
        resolveLoad = resolve
      })
    )
    const { result } = renderHook(() => usePrompts())

    act(() => result.current.updatePrompt('p1', '新T', '新C'))

    const stored: Prompt[] = [{ id: 'p1', title: 'T', content: 'C', createdAt: 999 }]
    await act(async () => resolveLoad(stored))
    expect(result.current.prompts[0].createdAt).toBe(999)
    expect(result.current.prompts[0].title).toBe('新T')
    expect(result.current.prompts[0].content).toBe('新C')
  })
})

describe('reorderPrompts', () => {
  const stored: Prompt[] = [
    { id: 'p1', title: 'A', content: 'a', createdAt: 1 },
    { id: 'p2', title: 'B', content: 'b', createdAt: 2 },
    { id: 'p3', title: 'C', content: 'c', createdAt: 3 }
  ]

  it('active を over の位置へ移動する（arrayMove：間の要素はシフト）', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(3))
    act(() => result.current.reorderPrompts('p1', 'p3'))
    // p1 を p3 の位置へ移動。間の p2 は前へシフトする（swap なら ['p3','p2','p1'] になる）
    expect(result.current.prompts.map((p) => p.id)).toEqual(['p2', 'p3', 'p1'])
  })

  it('単純な swap ではなく move であることを4要素で確認する', async () => {
    const four: Prompt[] = [
      { id: 'p1', title: 'A', content: 'a', createdAt: 1 },
      { id: 'p2', title: 'B', content: 'b', createdAt: 2 },
      { id: 'p3', title: 'C', content: 'c', createdAt: 3 },
      { id: 'p4', title: 'D', content: 'd', createdAt: 4 }
    ]
    mockLoad.mockResolvedValue(four)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(4))
    act(() => result.current.reorderPrompts('p1', 'p3'))
    // move: p1 を index2 へ → ['p2','p3','p1','p4']（swap なら ['p3','p2','p1','p4']）
    expect(result.current.prompts.map((p) => p.id)).toEqual(['p2', 'p3', 'p1', 'p4'])
  })

  it('後方から前方への move も間の要素をシフトする', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(3))
    act(() => result.current.reorderPrompts('p3', 'p1'))
    // p3 を先頭へ移動。p1,p2 は後ろへシフト（swap なら ['p3','p2','p1']）
    expect(result.current.prompts.map((p) => p.id)).toEqual(['p3', 'p1', 'p2'])
  })

  it('存在しない activeId を渡すと配列が変わらない', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(3))
    act(() => result.current.reorderPrompts('non-existent', 'p2'))
    expect(result.current.prompts.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('存在しない activeId を渡すと save が呼ばれない', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(3))
    vi.clearAllMocks()
    act(() => result.current.reorderPrompts('non-existent', 'p2'))
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('存在しない overId を渡すと save が呼ばれない', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(3))
    vi.clearAllMocks()
    act(() => result.current.reorderPrompts('p1', 'non-existent'))
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('同一 ID を渡すと配列が変わらない', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(3))
    act(() => result.current.reorderPrompts('p2', 'p2'))
    expect(result.current.prompts.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('同一 ID を渡すと save が呼ばれない', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(3))
    vi.clearAllMocks()
    act(() => result.current.reorderPrompts('p2', 'p2'))
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('reorderPrompts 後に save が呼ばれる', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(3))
    vi.clearAllMocks()
    act(() => result.current.reorderPrompts('p1', 'p3'))
    expect(mockSave).toHaveBeenCalledOnce()
    expect(mockSave).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'p1' })])
    )
  })

  it('reorderPrompts の参照が prompts 変更後も安定している（依存配列に prompts を含まない）', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(3))
    const firstRef = result.current.reorderPrompts
    // prompts を変化させる操作を実行
    act(() => result.current.addPrompt('新規', '内容'))
    await waitFor(() => expect(result.current.prompts).toHaveLength(4))
    expect(result.current.reorderPrompts).toBe(firstRef)
  })

  it('直前の add で増えた要素も含めて最新の配列を基準に並び替える（stale closure 回避）', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(3))
    // add 直後（再レンダー前提）に reorder しても最新配列を基準に動作する
    act(() => {
      result.current.addPrompt('新規', '内容') // 末尾に追加 → [p1,p2,p3,new]
    })
    await waitFor(() => expect(result.current.prompts).toHaveLength(4))
    const newId = result.current.prompts[3].id
    act(() => result.current.reorderPrompts(newId, 'p1'))
    // new が先頭へ移動する
    expect(result.current.prompts.map((p) => p.id)).toEqual([newId, 'p1', 'p2', 'p3'])
  })
})

describe('togglePromptPin', () => {
  const stored: Prompt[] = [
    { id: 'p1', title: 'A', content: 'a', createdAt: 1 },
    { id: 'p2', title: 'B', content: 'b', createdAt: 2, pinned: false }
  ]

  it('未ピン（pinned 無し）のプロンプトをピン留めする', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(2))
    act(() => result.current.togglePromptPin('p1'))
    expect(result.current.prompts[0].pinned).toBe(true)
  })

  it('ピン留め済みのプロンプトを解除する', async () => {
    mockLoad.mockResolvedValue([{ id: 'p1', title: 'A', content: 'a', createdAt: 1, pinned: true }])
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(1))
    act(() => result.current.togglePromptPin('p1'))
    expect(result.current.prompts[0].pinned).toBe(false)
  })

  it('対象以外のプロンプトは変化しない', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(2))
    act(() => result.current.togglePromptPin('p1'))
    expect(result.current.prompts[1].pinned).toBe(false)
  })

  it('togglePromptPin 後に save が呼ばれる', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(2))
    vi.clearAllMocks()
    act(() => result.current.togglePromptPin('p1'))
    expect(mockSave).toHaveBeenCalledOnce()
    expect(mockSave).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'p1', pinned: true })])
    )
  })

  it('ロード後に存在しないIDを渡すと save が呼ばれない（no-op）', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(2))
    vi.clearAllMocks()
    act(() => result.current.togglePromptPin('non-existent'))
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('ロード後に存在しないIDを渡しても prompts の参照が維持される（no-op）', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(2))
    const before = result.current.prompts
    act(() => result.current.togglePromptPin('non-existent'))
    expect(result.current.prompts).toBe(before)
  })

  it('参照が prompts 変更後も安定している（依存配列に prompts を含まない）', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(2))
    const firstRef = result.current.togglePromptPin
    act(() => result.current.addPrompt('新規', '内容'))
    await waitFor(() => expect(result.current.prompts).toHaveLength(3))
    expect(result.current.togglePromptPin).toBe(firstRef)
  })

  it('ロード完了前のトグルがロード後にマージされて保持される', async () => {
    let resolveLoad!: (value: Prompt[]) => void
    mockLoad.mockReturnValueOnce(
      new Promise<Prompt[]>((resolve) => {
        resolveLoad = resolve
      })
    )
    const { result } = renderHook(() => usePrompts())
    act(() => result.current.togglePromptPin('p1')) // ロード前
    await act(async () => resolveLoad(stored))
    await waitFor(() => expect(result.current.promptsLoaded).toBe(true))
    expect(result.current.prompts.find((p) => p.id === 'p1')?.pinned).toBe(true)
  })
})

describe('transfer 機能の配線（usePromptTransfer 統合）', () => {
  // 詳細は usePromptTransfer.test.ts で網羅済み。public API 配線と save 到達のみ確認。
  it('exportPrompts が現在の prompts で API を呼ぶ', async () => {
    const stored: Prompt[] = [{ id: 'p1', title: 'T', content: 'C', createdAt: 1 }]
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toEqual(stored))

    await act(async () => {
      await result.current.exportPrompts()
    })
    expect(mockApiExport).toHaveBeenCalledWith(stored)
  })

  it('importPrompts が取り込み分を末尾に追加し save まで通す', async () => {
    mockApiImport.mockResolvedValue([{ id: 'imp1', title: '取込', content: 'X', createdAt: 100 }])
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.promptsLoaded).toBe(true))
    vi.clearAllMocks()

    let count: number | undefined
    await act(async () => {
      count = await result.current.importPrompts()
    })
    expect(count).toBe(1)
    expect(result.current.prompts).toHaveLength(1)
    expect(result.current.prompts[0].id).not.toBe('imp1')
    expect(mockSave).toHaveBeenCalledOnce()
  })
})

describe('reorderPrompts × ピン留めの合成挙動', () => {
  // 永続化配列は reorderPrompts（arrayMove）で更新され、表示は sortByPinned 適用後になる。
  // この2層（永続化順 / 表示順）の合成が直感どおりになることを保証する回帰テスト。
  const stored: Prompt[] = [
    { id: 'p1', title: 'A', content: 'a', createdAt: 1 }, // 未ピン
    { id: 'p2', title: 'B', content: 'b', createdAt: 2, pinned: true }, // ピン
    { id: 'p3', title: 'C', content: 'c', createdAt: 3 } // 未ピン
  ]

  it('未ピン項目同士の並べ替えはピン項目を上部に保ったまま反映される', async () => {
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(3))

    // 初期表示順は [B(ピン), A, C]
    expect(sortByPinned(result.current.prompts).map((p) => p.id)).toEqual(['p2', 'p1', 'p3'])

    // 表示上、未ピンの C を A の上へドラッグ（reorder は id ベース）
    act(() => result.current.reorderPrompts('p3', 'p1'))

    // 表示順は [B(ピン), C, A]（ピンは上部のまま、未ピンの相対順だけ入れ替わる）
    expect(sortByPinned(result.current.prompts).map((p) => p.id)).toEqual(['p2', 'p3', 'p1'])
  })

  it('ピン項目同士の並べ替えは上部グループ内で反映される', async () => {
    mockLoad.mockResolvedValue([
      { id: 'p1', title: 'A', content: 'a', createdAt: 1, pinned: true },
      { id: 'p2', title: 'B', content: 'b', createdAt: 2, pinned: true },
      { id: 'p3', title: 'C', content: 'c', createdAt: 3 }
    ])
    const { result } = renderHook(() => usePrompts())
    await waitFor(() => expect(result.current.prompts).toHaveLength(3))

    act(() => result.current.reorderPrompts('p2', 'p1'))

    // ピン2件の順が入れ替わり、未ピンは末尾のまま
    expect(sortByPinned(result.current.prompts).map((p) => p.id)).toEqual(['p2', 'p1', 'p3'])
  })
})
