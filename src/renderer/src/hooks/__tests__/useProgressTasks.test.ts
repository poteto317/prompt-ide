import { renderHook, act, waitFor } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Task } from '../../types'

const mockLoad = vi.hoisted(() => vi.fn())
const mockSave = vi.hoisted(() => vi.fn())

vi.mock('../useProgressTasksPersistence', () => ({
  useProgressTasksPersistence: () => ({ load: mockLoad, save: mockSave })
}))

import { useProgressTasks } from '../useProgressTasks'

beforeEach(() => {
  vi.clearAllMocks()
  mockLoad.mockResolvedValue([])
  mockSave.mockImplementation(() => {})
})

async function mountLoaded(): Promise<
  RenderHookResult<ReturnType<typeof useProgressTasks>, unknown>
> {
  const hook = renderHook(() => useProgressTasks())
  await waitFor(() => expect(hook.result.current.tasksLoaded).toBe(true))
  return hook
}

describe('初期ロード', () => {
  it('マウント時に load が呼ばれる', async () => {
    renderHook(() => useProgressTasks())
    await waitFor(() => expect(mockLoad).toHaveBeenCalledOnce())
  })

  it('load の結果が tasks に反映される', async () => {
    const stored: Task[] = [
      { id: 't1', title: 'T', createdAt: 1, updatedAt: 1, currentStageId: 'plan', stages: [] }
    ]
    mockLoad.mockResolvedValue(stored)
    const { result } = renderHook(() => useProgressTasks())
    await waitFor(() => expect(result.current.tasks).toEqual(stored))
  })
})

describe('addTask', () => {
  it('タスクが追加され save される', async () => {
    const { result } = await mountLoaded()
    act(() => result.current.addTask('新タスク'))
    expect(result.current.tasks).toHaveLength(1)
    expect(result.current.tasks[0].title).toBe('新タスク')
    expect(mockSave).toHaveBeenCalled()
  })
})

describe('deleteTask', () => {
  it('指定したタスクが削除される', async () => {
    const { result } = await mountLoaded()
    act(() => result.current.addTask('a'))
    const id = result.current.tasks[0].id
    act(() => result.current.deleteTask(id))
    expect(result.current.tasks).toHaveLength(0)
  })
})

describe('ステージ操作の統合（useStageOperations との連携）', () => {
  it('advanceStage で currentStageId が進む', async () => {
    const { result } = await mountLoaded()
    act(() => result.current.addTask('a'))
    const id = result.current.tasks[0].id
    act(() => result.current.advanceStage(id))
    expect(result.current.tasks[0].currentStageId).toBe('implement')
  })

  it('ステージ操作は指定したタスクだけを変え、ほかのタスクは同じ参照のまま残す', async () => {
    const { result } = await mountLoaded()
    act(() => result.current.addTask('a'))
    act(() => result.current.addTask('b'))
    const [a, b] = result.current.tasks
    act(() => result.current.advanceStage(b.id))
    expect(result.current.tasks[0]).toBe(a)
    expect(result.current.tasks[1].currentStageId).toBe('implement')
  })

  it('存在しない ID へのステージ操作では、どのタスクも変わらない', async () => {
    const { result } = await mountLoaded()
    act(() => result.current.addTask('a'))
    const before = result.current.tasks[0]
    act(() => result.current.advanceStage('no-such-task'))
    expect(result.current.tasks).toEqual([before])
    expect(result.current.tasks[0]).toBe(before)
  })
})

describe('deleteTask(境界値)', () => {
  it('存在しない ID を消しても、ほかのタスクは残る', async () => {
    const { result } = await mountLoaded()
    act(() => result.current.addTask('a'))
    act(() => result.current.deleteTask('no-such-task'))
    expect(result.current.tasks.map((t) => t.title)).toEqual(['a'])
  })
})

describe('ロード前ミューテーションのマージ', () => {
  it('ロード完了前の addTask がロード後にマージされる', async () => {
    let resolveLoad!: (tasks: Task[]) => void
    mockLoad.mockReturnValue(new Promise<Task[]>((resolve) => (resolveLoad = resolve)))

    const { result } = renderHook(() => useProgressTasks())
    act(() => result.current.addTask('pending'))
    expect(result.current.tasksLoaded).toBe(false)
    expect(result.current.tasks).toHaveLength(1)

    const stored: Task[] = [
      { id: 't1', title: '既存', createdAt: 1, updatedAt: 1, currentStageId: 'plan', stages: [] }
    ]
    await act(async () => {
      resolveLoad(stored)
    })

    await waitFor(() => expect(result.current.tasksLoaded).toBe(true))
    expect(result.current.tasks.map((t) => t.title)).toEqual(['既存', 'pending'])
    expect(mockSave).toHaveBeenCalled()
  })
})
