import { useState } from 'react'
import type { Task } from '../types'

interface SelectedTaskState {
  selectedTask: Task | null
  selectedId: string | null
  setSelectedId: (id: string | null) => void
}

export function useSelectedTask(tasks: Task[]): SelectedTaskState {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 選択 ID が無効（削除済みなど）の場合は先頭タスクにフォールバックする
  const selectedTask = tasks.find((t) => t.id === selectedId) ?? tasks[0] ?? null

  return { selectedTask, selectedId: selectedTask?.id ?? null, setSelectedId }
}
