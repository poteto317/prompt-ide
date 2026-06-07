'use client'
import type { Task } from '../../types'
import { progressSummary } from '../../lib/stageDisplay'

interface Props {
  task: Task
  onDelete: (id: string) => void
}

export default function TaskHeader({ task, onDelete }: Props) {
  const doneCount = task.stages.filter((s) => s.status === 'done').length

  return (
    <div className="progress-panel__task-header">
      <span className="progress-panel__task-title">{task.title}</span>
      <span className="progress-panel__task-progress" aria-label="進捗">
        進捗 {progressSummary(doneCount, task.stages.length)}
      </span>
      <button
        type="button"
        className="progress-panel__delete"
        aria-label="タスクを削除"
        onClick={() => onDelete(task.id)}
      >
        削除
      </button>
    </div>
  )
}
