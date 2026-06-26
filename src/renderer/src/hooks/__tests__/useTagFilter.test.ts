import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useTagFilter } from '../useTagFilter'

describe('useTagFilter', () => {
  describe('初期状態', () => {
    it('selectedTags の初期値は空配列', () => {
      const { result } = renderHook(() => useTagFilter())
      expect(result.current.selectedTags).toEqual([])
    })
  })

  describe('toggleTag', () => {
    it('タグを追加できる', () => {
      const { result } = renderHook(() => useTagFilter())
      act(() => result.current.toggleTag('React'))
      expect(result.current.selectedTags).toEqual(['React'])
    })

    it('同じタグを再度呼ぶと削除される', () => {
      const { result } = renderHook(() => useTagFilter())
      act(() => result.current.toggleTag('React'))
      act(() => result.current.toggleTag('React'))
      expect(result.current.selectedTags).toEqual([])
    })

    it('複数タグを追加できる', () => {
      const { result } = renderHook(() => useTagFilter())
      act(() => result.current.toggleTag('React'))
      act(() => result.current.toggleTag('TypeScript'))
      expect(result.current.selectedTags).toEqual(['React', 'TypeScript'])
    })

    it('複数選択中に一方だけ解除できる', () => {
      const { result } = renderHook(() => useTagFilter())
      act(() => result.current.toggleTag('React'))
      act(() => result.current.toggleTag('TypeScript'))
      act(() => result.current.toggleTag('React'))
      expect(result.current.selectedTags).toEqual(['TypeScript'])
    })
  })

  describe('resetTags', () => {
    it('選択中タグを全てクリアする', () => {
      const { result } = renderHook(() => useTagFilter())
      act(() => result.current.toggleTag('React'))
      act(() => result.current.toggleTag('TypeScript'))
      act(() => result.current.resetTags())
      expect(result.current.selectedTags).toEqual([])
    })

    it('既に空のとき呼んでも空のまま', () => {
      const { result } = renderHook(() => useTagFilter())
      act(() => result.current.resetTags())
      expect(result.current.selectedTags).toEqual([])
    })

    it('リセット後に再度 toggleTag できる', () => {
      const { result } = renderHook(() => useTagFilter())
      act(() => result.current.toggleTag('React'))
      act(() => result.current.resetTags())
      act(() => result.current.toggleTag('Vue'))
      expect(result.current.selectedTags).toEqual(['Vue'])
    })
  })

  describe('参照安定性', () => {
    it('toggleTag の参照は再レンダーをまたいで同一', () => {
      const { result, rerender } = renderHook(() => useTagFilter())
      const first = result.current.toggleTag
      rerender()
      expect(result.current.toggleTag).toBe(first)
    })

    it('resetTags の参照は再レンダーをまたいで同一', () => {
      const { result, rerender } = renderHook(() => useTagFilter())
      const first = result.current.resetTags
      rerender()
      expect(result.current.resetTags).toBe(first)
    })
  })
})
