import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import type { Task } from '../../types'
import { useSelectedTask } from '../useSelectedTask'

function makeTask(id: string, title = 'タスク'): Task {
  return {
    id,
    title,
    createdAt: 1000,
    updatedAt: 1000,
    currentStageId: 'plan',
    stages: []
  }
}

describe('useSelectedTask', () => {
  describe('初期選択', () => {
    it('タスクがあれば先頭タスクを初期選択する', () => {
      const tasks = [makeTask('t1', 'A'), makeTask('t2', 'B')]
      const { result } = renderHook(() => useSelectedTask(tasks))
      expect(result.current.selectedTask?.id).toBe('t1')
    })

    it('タスクが空のとき selectedTask は null', () => {
      const { result } = renderHook(() => useSelectedTask([]))
      expect(result.current.selectedTask).toBeNull()
    })

    it('タスクが空のとき selectedId は null', () => {
      const { result } = renderHook(() => useSelectedTask([]))
      expect(result.current.selectedId).toBeNull()
    })
  })

  describe('setSelectedId', () => {
    it('setSelectedId で選択タスクを変更できる', () => {
      const tasks = [makeTask('t1'), makeTask('t2')]
      const { result } = renderHook(() => useSelectedTask(tasks))
      act(() => result.current.setSelectedId('t2'))
      expect(result.current.selectedTask?.id).toBe('t2')
    })

    it('存在する ID を選択すると selectedId が更新される', () => {
      const tasks = [makeTask('t1'), makeTask('t2')]
      const { result } = renderHook(() => useSelectedTask(tasks))
      act(() => result.current.setSelectedId('t2'))
      expect(result.current.selectedId).toBe('t2')
    })
  })

  describe('フォールバック', () => {
    it('存在しない ID を選択すると先頭タスクにフォールバックする', () => {
      const tasks = [makeTask('t1'), makeTask('t2')]
      const { result } = renderHook(() => useSelectedTask(tasks))
      act(() => result.current.setSelectedId('deleted-id'))
      expect(result.current.selectedTask?.id).toBe('t1')
    })

    it('null を選択すると先頭タスクにフォールバックする', () => {
      const tasks = [makeTask('t1'), makeTask('t2')]
      const { result } = renderHook(() => useSelectedTask(tasks))
      act(() => result.current.setSelectedId('t2'))
      act(() => result.current.setSelectedId(null))
      expect(result.current.selectedTask?.id).toBe('t1')
    })

    it('タスクが1件のとき selectedTask はそのタスク', () => {
      const tasks = [makeTask('only')]
      const { result } = renderHook(() => useSelectedTask(tasks))
      expect(result.current.selectedTask?.id).toBe('only')
    })
  })
})
