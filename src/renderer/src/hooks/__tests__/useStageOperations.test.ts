import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Task } from '../../types'
import { useStageOperations } from '../useStageOperations'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'テストタスク',
    createdAt: 1000,
    updatedAt: 1000,
    currentStageId: 'plan',
    stages: [
      { id: 'plan', status: 'in_progress', events: [] },
      { id: 'implement', status: 'not_started', events: [] },
      { id: 'refactor', status: 'not_started', events: [] },
      { id: 'localReview', status: 'not_started', events: [] },
      { id: 'commit', status: 'not_started', events: [] },
      { id: 'prCreate', status: 'not_started', events: [] },
      { id: 'prReview', status: 'not_started', events: [] },
      { id: 'prMerge', status: 'not_started', events: [] }
    ],
    ...overrides
  }
}

describe('useStageOperations', () => {
  let task: Task
  let updateTask: ReturnType<typeof vi.fn>

  beforeEach(() => {
    task = makeTask()
    updateTask = vi.fn((taskId: string, fn: (t: Task) => Task) => {
      task = fn(task)
    })
  })

  describe('recordEvent', () => {
    it('対象ステージにイベントが追加される', () => {
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.recordEvent('t1', 'plan', 'メモ'))
      const stage = task.stages.find((s) => s.id === 'plan')
      expect(stage?.events).toHaveLength(1)
      expect(stage?.events[0].note).toBe('メモ')
    })

    it('未着手のステージは in_progress に変わる', () => {
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.recordEvent('t1', 'implement'))
      const stage = task.stages.find((s) => s.id === 'implement')
      expect(stage?.status).toBe('in_progress')
    })

    it('done のステージはステータスが変わらない', () => {
      task = makeTask({
        stages: task.stages.map((s) => (s.id === 'plan' ? { ...s, status: 'done' as const } : s))
      })
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.recordEvent('t1', 'plan'))
      const stage = task.stages.find((s) => s.id === 'plan')
      expect(stage?.status).toBe('done')
    })

    it('updateTask が呼ばれる', () => {
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.recordEvent('t1', 'plan'))
      expect(updateTask).toHaveBeenCalledOnce()
    })
  })

  describe('completeStage', () => {
    it('対象ステージが done になる', () => {
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.completeStage('t1', 'plan'))
      const stage = task.stages.find((s) => s.id === 'plan')
      expect(stage?.status).toBe('done')
    })

    it('note あり: イベントが 1 件追加される', () => {
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.completeStage('t1', 'plan', '完了メモ'))
      const stage = task.stages.find((s) => s.id === 'plan')
      expect(stage?.events).toHaveLength(1)
      expect(stage?.events[0].note).toBe('完了メモ')
    })

    it('note なし: events は変化しない', () => {
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.completeStage('t1', 'plan'))
      const stage = task.stages.find((s) => s.id === 'plan')
      expect(stage?.events).toHaveLength(0)
    })

    it('空白のみの note はイベントを追加しない', () => {
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.completeStage('t1', 'plan', '   '))
      const stage = task.stages.find((s) => s.id === 'plan')
      expect(stage?.events).toHaveLength(0)
    })

    it('前後に空白を含む note は trim された値で保存される', () => {
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.completeStage('t1', 'plan', '  完了メモ  '))
      const stage = task.stages.find((s) => s.id === 'plan')
      expect(stage?.events).toHaveLength(1)
      expect(stage?.events[0].note).toBe('完了メモ')
    })
  })

  describe('reopenStage', () => {
    it('対象ステージが in_progress（履歴あり）に戻る', () => {
      task = makeTask({
        stages: task.stages.map((s) =>
          s.id === 'commit' ? { ...s, status: 'done' as const, events: [{ id: 'e1', occurredAt: 1 }] } : s
        )
      })
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.reopenStage('t1', 'commit'))
      const stage = task.stages.find((s) => s.id === 'commit')
      expect(stage?.status).toBe('in_progress')
    })

    it('対象ステージが not_started（履歴なし）に戻る', () => {
      task = makeTask({
        stages: task.stages.map((s) =>
          s.id === 'implement' ? { ...s, status: 'done' as const } : s
        )
      })
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.reopenStage('t1', 'implement'))
      const stage = task.stages.find((s) => s.id === 'implement')
      expect(stage?.status).toBe('not_started')
    })

    it('currentStageId が対象ステージに更新される', () => {
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.reopenStage('t1', 'plan'))
      expect(task.currentStageId).toBe('plan')
    })

    it('後続の done ステージが in_progress に落ちる', () => {
      task = makeTask({
        stages: task.stages.map((s) =>
          s.id === 'commit' ? { ...s, status: 'done' as const } : s
        )
      })
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.reopenStage('t1', 'refactor'))
      const commit = task.stages.find((s) => s.id === 'commit')
      expect(commit?.status).toBe('in_progress')
    })
  })

  describe('skipStage', () => {
    it('対象ステージが skipped になる', () => {
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.skipStage('t1', 'refactor'))
      const stage = task.stages.find((s) => s.id === 'refactor')
      expect(stage?.status).toBe('skipped')
    })

    it('他のステージには影響しない', () => {
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.skipStage('t1', 'refactor'))
      const plan = task.stages.find((s) => s.id === 'plan')
      expect(plan?.status).toBe('in_progress')
    })
  })

  describe('advanceStage', () => {
    it('現在ステージが done になり次のステージへ進む', () => {
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.advanceStage('t1'))
      expect(task.currentStageId).toBe('implement')
      const plan = task.stages.find((s) => s.id === 'plan')
      expect(plan?.status).toBe('done')
    })

    it('次のステージが in_progress になる', () => {
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.advanceStage('t1'))
      const implement = task.stages.find((s) => s.id === 'implement')
      expect(implement?.status).toBe('in_progress')
    })

    it('最終ステージでは currentStageId が変わらない', () => {
      task = makeTask({
        currentStageId: 'prMerge',
        stages: task.stages.map((s) =>
          s.id === 'prMerge' ? { ...s, status: 'in_progress' as const } : s
        )
      })
      const { result } = renderHook(() => useStageOperations(updateTask))
      act(() => result.current.advanceStage('t1'))
      expect(task.currentStageId).toBe('prMerge')
      const prMerge = task.stages.find((s) => s.id === 'prMerge')
      expect(prMerge?.status).toBe('done')
    })
  })
})
