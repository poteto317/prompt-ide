import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HistoryEntry } from '../../types'

const mockLoad = vi.hoisted(() => vi.fn())
const mockSave = vi.hoisted(() => vi.fn())

vi.mock('../useHistoryPersistence', () => ({
  useHistoryPersistence: () => ({ load: mockLoad, save: mockSave })
}))

import { useHistory } from '../useHistory'

const makeEntry = (id: string): Omit<HistoryEntry, 'id'> => ({
  promptId: 'p1',
  promptTitle: `タイトル${id}`,
  promptContent: 'プロンプト内容',
  fileContent: null,
  toolId: 'api',
  status: 'success',
  resultText: '結果',
  errorMessage: null,
  executedAt: 1000,
  agent: null
})

beforeEach(() => {
  vi.clearAllMocks()
  mockLoad.mockResolvedValue([])
  mockSave.mockImplementation(() => {})
})

async function mountLoaded(): Promise<
  ReturnType<typeof renderHook<ReturnType<typeof useHistory>, unknown>>
> {
  const hook = renderHook(() => useHistory())
  await waitFor(() => expect(hook.result.current.historyLoaded).toBe(true))
  return hook
}

describe('初期ロード', () => {
  it('マウント時に load が呼ばれる', async () => {
    renderHook(() => useHistory())
    await waitFor(() => expect(mockLoad).toHaveBeenCalledOnce())
  })

  it('load の結果が history に反映される', async () => {
    const stored: HistoryEntry[] = [{ id: 'h1', ...makeEntry('1') }]
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => useHistory())
    await waitFor(() => expect(result.current.history).toEqual(stored))
  })
})

describe('addHistoryEntry', () => {
  it('先頭に追加され save される', async () => {
    const { result } = await mountLoaded()
    act(() => result.current.addHistoryEntry(makeEntry('new')))
    expect(result.current.history).toHaveLength(1)
    expect(result.current.history[0].promptTitle).toBe('タイトルnew')
    expect(mockSave).toHaveBeenCalled()
  })

  it('新しいエントリが先頭に来る（新しい順）', async () => {
    const { result } = await mountLoaded()
    act(() => result.current.addHistoryEntry(makeEntry('first')))
    act(() => result.current.addHistoryEntry(makeEntry('second')))
    expect(result.current.history.map((e) => e.promptTitle)).toEqual([
      'タイトルsecond',
      'タイトルfirst'
    ])
  })

  it('200件を超えると古いものから削除される（上限キャップ）', async () => {
    const { result } = await mountLoaded()
    act(() => {
      for (let i = 0; i < 201; i++) {
        result.current.addHistoryEntry(makeEntry(String(i)))
      }
    })
    expect(result.current.history).toHaveLength(200)
    // 最初に追加した '0' が上限超過で削除されていること
    expect(result.current.history.some((e) => e.promptTitle === 'タイトル0')).toBe(false)
    // 直近に追加した '200' は残っていること
    expect(result.current.history[0].promptTitle).toBe('タイトル200')
  })

  it('ロード完了前に追加しても、ロード完了後に id が変わらない（バッファリングされた transform の再実行で別 id が採番されない）', async () => {
    let resolveLoad: (value: HistoryEntry[]) => void
    mockLoad.mockReturnValue(
      new Promise<HistoryEntry[]>((resolve) => {
        resolveLoad = resolve
      })
    )

    const { result } = renderHook(() => useHistory())
    expect(result.current.historyLoaded).toBe(false)

    act(() => result.current.addHistoryEntry(makeEntry('pending')))
    const idBeforeLoad = result.current.history[0]?.id
    expect(idBeforeLoad).toBeDefined()

    act(() => resolveLoad([]))
    await waitFor(() => expect(result.current.historyLoaded).toBe(true))

    expect(result.current.history).toHaveLength(1)
    expect(result.current.history[0].id).toBe(idBeforeLoad)
  })
})

describe('deleteHistoryEntry', () => {
  it('指定した履歴が削除される', async () => {
    const { result } = await mountLoaded()
    act(() => result.current.addHistoryEntry(makeEntry('a')))
    const id = result.current.history[0].id
    act(() => result.current.deleteHistoryEntry(id))
    expect(result.current.history).toHaveLength(0)
  })

  it('存在しないIDを削除しても同一参照を返し save を呼ばない（no-op）', async () => {
    const { result } = await mountLoaded()
    act(() => result.current.addHistoryEntry(makeEntry('a')))
    mockSave.mockClear()
    const before = result.current.history
    act(() => result.current.deleteHistoryEntry('存在しないid'))
    expect(result.current.history).toBe(before)
    expect(mockSave).not.toHaveBeenCalled()
  })
})

describe('clearHistory', () => {
  it('全ての履歴が削除される', async () => {
    const { result } = await mountLoaded()
    act(() => result.current.addHistoryEntry(makeEntry('a')))
    act(() => result.current.addHistoryEntry(makeEntry('b')))
    act(() => result.current.clearHistory())
    expect(result.current.history).toHaveLength(0)
  })

  it('既に空の場合は同一参照を返し save を呼ばない（no-op）', async () => {
    const { result } = await mountLoaded()
    mockSave.mockClear()
    const before = result.current.history
    act(() => result.current.clearHistory())
    expect(result.current.history).toBe(before)
    expect(mockSave).not.toHaveBeenCalled()
  })
})
