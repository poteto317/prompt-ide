import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useTagInput } from '../useTagInput'

function inputEvent(value: string): React.ChangeEvent<HTMLInputElement> {
  return { target: { value } } as React.ChangeEvent<HTMLInputElement>
}

function keyDownEvent(key: string): React.KeyboardEvent<HTMLInputElement> {
  return { key, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLInputElement>
}

describe('useTagInput', () => {
  describe('初期値', () => {
    it('initialTags が渡された場合、tags の初期値になる', () => {
      const { result } = renderHook(() => useTagInput(['React', 'TypeScript']))
      expect(result.current.tags).toEqual(['React', 'TypeScript'])
    })

    it('initialTags が省略されると tags は空配列', () => {
      const { result } = renderHook(() => useTagInput())
      expect(result.current.tags).toEqual([])
    })

    it('tagInput の初期値は空文字', () => {
      const { result } = renderHook(() => useTagInput())
      expect(result.current.tagInput).toBe('')
    })
  })

  describe('handleTagInputChange', () => {
    it('tagInput が更新される', () => {
      const { result } = renderHook(() => useTagInput())
      act(() => result.current.handleTagInputChange(inputEvent('Vue')))
      expect(result.current.tagInput).toBe('Vue')
    })
  })

  describe('handleTagInputKeyDown', () => {
    it('Enter でタグが追加される', () => {
      const { result } = renderHook(() => useTagInput())
      act(() => result.current.handleTagInputChange(inputEvent('Vue')))
      act(() => result.current.handleTagInputKeyDown(keyDownEvent('Enter')))
      expect(result.current.tags).toEqual(['Vue'])
    })

    it('Enter 後に tagInput がクリアされる', () => {
      const { result } = renderHook(() => useTagInput())
      act(() => result.current.handleTagInputChange(inputEvent('Vue')))
      act(() => result.current.handleTagInputKeyDown(keyDownEvent('Enter')))
      expect(result.current.tagInput).toBe('')
    })

    it('空文字はタグに追加されない', () => {
      const { result } = renderHook(() => useTagInput())
      act(() => result.current.handleTagInputChange(inputEvent('   ')))
      act(() => result.current.handleTagInputKeyDown(keyDownEvent('Enter')))
      expect(result.current.tags).toEqual([])
    })

    it('空文字 Enter でも tagInput はクリアされる', () => {
      const { result } = renderHook(() => useTagInput())
      act(() => result.current.handleTagInputChange(inputEvent('   ')))
      act(() => result.current.handleTagInputKeyDown(keyDownEvent('Enter')))
      expect(result.current.tagInput).toBe('')
    })

    it('重複タグは追加されない', () => {
      const { result } = renderHook(() => useTagInput(['React']))
      act(() => result.current.handleTagInputChange(inputEvent('React')))
      act(() => result.current.handleTagInputKeyDown(keyDownEvent('Enter')))
      expect(result.current.tags).toEqual(['React'])
    })

    it('Enter 以外のキーではタグが追加されない', () => {
      const { result } = renderHook(() => useTagInput())
      act(() => result.current.handleTagInputChange(inputEvent('Vue')))
      act(() => result.current.handleTagInputKeyDown(keyDownEvent('Space')))
      expect(result.current.tags).toEqual([])
      expect(result.current.tagInput).toBe('Vue')
    })

    it('複数タグを連続追加できる', () => {
      const { result } = renderHook(() => useTagInput())
      act(() => result.current.handleTagInputChange(inputEvent('React')))
      act(() => result.current.handleTagInputKeyDown(keyDownEvent('Enter')))
      act(() => result.current.handleTagInputChange(inputEvent('TypeScript')))
      act(() => result.current.handleTagInputKeyDown(keyDownEvent('Enter')))
      expect(result.current.tags).toEqual(['React', 'TypeScript'])
    })
  })

  describe('handleRemoveTag', () => {
    it('指定タグが削除される', () => {
      const { result } = renderHook(() => useTagInput(['React', 'TypeScript']))
      act(() => result.current.handleRemoveTag('React'))
      expect(result.current.tags).toEqual(['TypeScript'])
    })

    it('存在しないタグを削除しても変わらない', () => {
      const { result } = renderHook(() => useTagInput(['React']))
      act(() => result.current.handleRemoveTag('Vue'))
      expect(result.current.tags).toEqual(['React'])
    })

    it('全タグを削除すると空になる', () => {
      const { result } = renderHook(() => useTagInput(['React']))
      act(() => result.current.handleRemoveTag('React'))
      expect(result.current.tags).toEqual([])
    })
  })
})
