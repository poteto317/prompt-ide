import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useBufferedPersistence } from '../useBufferedPersistence'

interface Item {
  id: string
}

const mockLoad = vi.fn()
const mockSave = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockLoad.mockResolvedValue([])
  mockSave.mockImplementation(() => {})
})

function mount() {
  return renderHook(() => useBufferedPersistence<Item>({ load: mockLoad, save: mockSave }))
}

async function mountLoaded() {
  const hook = mount()
  await waitFor(() => expect(hook.result.current.loaded).toBe(true))
  return hook
}

describe('初期ロード', () => {
  it('マウント時に load が呼ばれる', async () => {
    mount()
    await waitFor(() => expect(mockLoad).toHaveBeenCalledOnce())
  })

  it('load の結果が items に反映される', async () => {
    const stored: Item[] = [{ id: 'a' }]
    mockLoad.mockResolvedValue(stored)
    const { result } = mount()
    await waitFor(() => expect(result.current.items).toEqual(stored))
    expect(result.current.loaded).toBe(true)
  })

  it('ロード時にミューテーションが無ければ save は呼ばれない', async () => {
    await mountLoaded()
    expect(mockSave).not.toHaveBeenCalled()
  })
})

describe('ロード後の apply', () => {
  it('transform が適用され save される', async () => {
    const { result } = await mountLoaded()
    act(() => result.current.apply((items) => [...items, { id: 'x' }]))
    expect(result.current.items).toEqual([{ id: 'x' }])
    expect(mockSave).toHaveBeenCalledWith([{ id: 'x' }])
  })

  it('連続した apply が直前の結果に対して適用される', async () => {
    const { result } = await mountLoaded()
    act(() => result.current.apply((items) => [...items, { id: 'a' }]))
    act(() => result.current.apply((items) => [...items, { id: 'b' }]))
    expect(result.current.items).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(mockSave).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }])
  })
})

describe('ロード前ミューテーションのバッファリング', () => {
  it('ロード前の apply は即時反映されるが save はされない', async () => {
    let resolveLoad!: (items: Item[]) => void
    mockLoad.mockReturnValue(new Promise<Item[]>((resolve) => (resolveLoad = resolve)))

    const { result } = mount()
    act(() => result.current.apply((items) => [...items, { id: 'pending' }]))
    expect(result.current.loaded).toBe(false)
    expect(result.current.items).toEqual([{ id: 'pending' }])
    expect(mockSave).not.toHaveBeenCalled()

    await act(async () => {
      resolveLoad([{ id: 'stored' }])
    })

    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.items).toEqual([{ id: 'stored' }, { id: 'pending' }])
    expect(mockSave).toHaveBeenCalledWith([{ id: 'stored' }, { id: 'pending' }])
  })

  it('複数のバッファされた transform がロード後に順次適用される', async () => {
    let resolveLoad!: (items: Item[]) => void
    mockLoad.mockReturnValue(new Promise<Item[]>((resolve) => (resolveLoad = resolve)))

    const { result } = mount()
    act(() => result.current.apply((items) => [...items, { id: 'a' }]))
    act(() => result.current.apply((items) => [...items, { id: 'b' }]))
    act(() => result.current.apply((items) => items.filter((i) => i.id !== 'a')))

    await act(async () => {
      resolveLoad([{ id: 'stored' }])
    })

    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.items).toEqual([{ id: 'stored' }, { id: 'b' }])
  })

  it('ロード前にミューテーションが無ければロード後も save されない', async () => {
    let resolveLoad!: (items: Item[]) => void
    mockLoad.mockReturnValue(new Promise<Item[]>((resolve) => (resolveLoad = resolve)))

    const { result } = mount()
    await act(async () => {
      resolveLoad([{ id: 'stored' }])
    })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(mockSave).not.toHaveBeenCalled()
  })
})

describe('load 失敗', () => {
  it('load が reject しても loaded が true になる', async () => {
    mockLoad.mockRejectedValue(new Error('network error'))
    const { result } = mount()
    await waitFor(() => expect(result.current.loaded).toBe(true))
  })

  it('load が reject したとき items は空のまま', async () => {
    mockLoad.mockRejectedValue(new Error('network error'))
    const { result } = mount()
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.items).toEqual([])
  })

  it('load 失敗後もロード前のミューテーションが items に反映されている', async () => {
    let rejectLoad!: (err: Error) => void
    mockLoad.mockReturnValue(
      new Promise<Item[]>((_, reject) => (rejectLoad = reject))
    )
    const { result } = mount()
    act(() => result.current.apply((items) => [...items, { id: 'pending' }]))

    await act(async () => {
      rejectLoad(new Error('network error'))
    })

    await waitFor(() => expect(result.current.loaded).toBe(true))
    // バッファ中のミューテーションはそのまま items に残る
    expect(result.current.items).toEqual([{ id: 'pending' }])
  })

  it('load 失敗時にロード前ミューテーションがあれば save される（データロス防止）', async () => {
    let rejectLoad!: (err: Error) => void
    mockLoad.mockReturnValue(
      new Promise<Item[]>((_, reject) => (rejectLoad = reject))
    )
    const { result } = mount()
    act(() => result.current.apply((items) => [...items, { id: 'pending' }]))
    expect(mockSave).not.toHaveBeenCalled()

    await act(async () => {
      rejectLoad(new Error('network error'))
    })

    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(mockSave).toHaveBeenCalledWith([{ id: 'pending' }])
  })

  it('load 失敗時にロード前ミューテーションがなければ save されない', async () => {
    mockLoad.mockRejectedValue(new Error('network error'))
    const { result } = mount()
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('load 失敗後にアンマウントされても状態更新しない', async () => {
    let rejectLoad!: (err: Error) => void
    mockLoad.mockReturnValue(
      new Promise<Item[]>((_, reject) => (rejectLoad = reject))
    )
    const { result, unmount } = mount()
    unmount()
    await act(async () => {
      rejectLoad(new Error('network error'))
    })
    expect(result.current.loaded).toBe(false)
  })
})

describe('アンマウント', () => {
  it('ロード解決前にアンマウントされても状態更新しない', async () => {
    let resolveLoad!: (items: Item[]) => void
    mockLoad.mockReturnValue(new Promise<Item[]>((resolve) => (resolveLoad = resolve)))

    const { result, unmount } = mount()
    unmount()
    await act(async () => {
      resolveLoad([{ id: 'stored' }])
    })
    expect(result.current.loaded).toBe(false)
  })
})
