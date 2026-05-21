import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { usePrompts } from '../usePrompts'

describe('usePrompts', () => {
  it('初期状態で prompts が空配列', () => {
    const { result } = renderHook(() => usePrompts())
    expect(result.current.prompts).toEqual([])
  })

  it('addPrompt でプロンプトが追加される', () => {
    const { result } = renderHook(() => usePrompts())
    act(() => {
      result.current.addPrompt('テストタイトル', 'テストコンテンツ')
    })
    expect(result.current.prompts).toHaveLength(1)
    expect(result.current.prompts[0].title).toBe('テストタイトル')
    expect(result.current.prompts[0].content).toBe('テストコンテンツ')
  })

  it('addPrompt で複数追加できる', () => {
    const { result } = renderHook(() => usePrompts())
    act(() => {
      result.current.addPrompt('タイトル1', 'コンテンツ1')
      result.current.addPrompt('タイトル2', 'コンテンツ2')
    })
    expect(result.current.prompts).toHaveLength(2)
  })

  it('addPrompt で各プロンプトに一意の id が付与される', () => {
    const { result } = renderHook(() => usePrompts())
    act(() => {
      result.current.addPrompt('タイトル1', 'コンテンツ1')
      result.current.addPrompt('タイトル2', 'コンテンツ2')
    })
    const [p1, p2] = result.current.prompts
    expect(p1.id).toBeTruthy()
    expect(p2.id).toBeTruthy()
    expect(p1.id).not.toBe(p2.id)
  })

  it('addPrompt で createdAt が設定される', () => {
    const before = Date.now()
    const { result } = renderHook(() => usePrompts())
    act(() => {
      result.current.addPrompt('タイトル', 'コンテンツ')
    })
    const after = Date.now()
    expect(result.current.prompts[0].createdAt).toBeGreaterThanOrEqual(before)
    expect(result.current.prompts[0].createdAt).toBeLessThanOrEqual(after)
  })

  it('deletePrompt で指定 ID のプロンプトが削除される', () => {
    const { result } = renderHook(() => usePrompts())
    act(() => {
      result.current.addPrompt('タイトル1', 'コンテンツ1')
      result.current.addPrompt('タイトル2', 'コンテンツ2')
    })
    const idToDelete = result.current.prompts[0].id
    act(() => {
      result.current.deletePrompt(idToDelete)
    })
    expect(result.current.prompts).toHaveLength(1)
    expect(result.current.prompts[0].title).toBe('タイトル2')
  })

  it('deletePrompt で存在しない ID を指定しても他のプロンプトは変化しない', () => {
    const { result } = renderHook(() => usePrompts())
    act(() => {
      result.current.addPrompt('タイトル', 'コンテンツ')
    })
    act(() => {
      result.current.deletePrompt('non-existent-id')
    })
    expect(result.current.prompts).toHaveLength(1)
  })
})
