'use client'
import type { Task } from '../../types'

interface Props {
  tasks: Task[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export default function TaskSelector({ tasks, selectedId, onSelect }: Props) {
  return (
    <div className="progress-panel__selector">
      <select
        className="progress-panel__select"
        aria-label="タスクを選択"
        value={selectedId ?? tasks[0]?.id ?? ''}
        onChange={(e) => onSelect(e.target.value)}
      >
        {tasks.map((task) => (
          <option key={task.id} value={task.id}>
            {task.title}
          </option>
        ))}
      </select>
    </div>
  )
}
