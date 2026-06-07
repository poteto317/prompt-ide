import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useAddTaskForm } from '../useAddTaskForm'

describe('useAddTaskForm', () => {
  describe('初期状態', () => {
    it('title が空文字で初期化される', () => {
      const { result } = renderHook(() => useAddTaskForm(vi.fn()))
      expect(result.current.title).toBe('')
    })

    it('空文字のとき isDisabled が true', () => {
      const { result } = renderHook(() => useAddTaskForm(vi.fn()))
      expect(result.current.isDisabled).toBe(true)
    })
  })

  describe('title 入力', () => {
    it('setTitle で title が更新される', () => {
      const { result } = renderHook(() => useAddTaskForm(vi.fn()))
      act(() => result.current.setTitle('新タスク'))
      expect(result.current.title).toBe('新タスク')
    })

    it('文字が入力されると isDisabled が false になる', () => {
      const { result } = renderHook(() => useAddTaskForm(vi.fn()))
      act(() => result.current.setTitle('a'))
      expect(result.current.isDisabled).toBe(false)
    })

    it('空白のみの入力は isDisabled が true のまま', () => {
      const { result } = renderHook(() => useAddTaskForm(vi.fn()))
      act(() => result.current.setTitle('   '))
      expect(result.current.isDisabled).toBe(true)
    })
  })

  describe('handleSubmit', () => {
    function makeEvent() {
      return { preventDefault: vi.fn() } as unknown as React.FormEvent
    }

    it('title の trim 値で onAdd が呼ばれる', () => {
      const onAdd = vi.fn()
      const { result } = renderHook(() => useAddTaskForm(onAdd))
      act(() => result.current.setTitle('  タスク  '))
      act(() => result.current.handleSubmit(makeEvent()))
      expect(onAdd).toHaveBeenCalledWith('タスク')
    })

    it('submit 後に title がリセットされる', () => {
      const { result } = renderHook(() => useAddTaskForm(vi.fn()))
      act(() => result.current.setTitle('タスク'))
      act(() => result.current.handleSubmit(makeEvent()))
      expect(result.current.title).toBe('')
    })

    it('空の title では onAdd が呼ばれない', () => {
      const onAdd = vi.fn()
      const { result } = renderHook(() => useAddTaskForm(onAdd))
      act(() => result.current.handleSubmit(makeEvent()))
      expect(onAdd).not.toHaveBeenCalled()
    })

    it('空白のみの title では onAdd が呼ばれない', () => {
      const onAdd = vi.fn()
      const { result } = renderHook(() => useAddTaskForm(onAdd))
      act(() => result.current.setTitle('   '))
      act(() => result.current.handleSubmit(makeEvent()))
      expect(onAdd).not.toHaveBeenCalled()
    })

    it('preventDefault が呼ばれる', () => {
      const { result } = renderHook(() => useAddTaskForm(vi.fn()))
      const event = makeEvent()
      act(() => result.current.setTitle('タスク'))
      act(() => result.current.handleSubmit(event))
      expect(event.preventDefault).toHaveBeenCalled()
    })
  })
})
