'use client'
import { useAddTaskForm } from '../../hooks/useAddTaskForm'

interface Props {
  onAdd: (title: string) => void
}

export default function AddTaskForm({ onAdd }: Props) {
  const { title, setTitle, isDisabled, handleSubmit } = useAddTaskForm(onAdd)

  return (
    <form className="add-task-form" onSubmit={handleSubmit}>
      <input
        className="add-task-form__input"
        type="text"
        placeholder="タスク名"
        aria-label="タスク名"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button type="submit" className="add-task-form__button" disabled={isDisabled}>
        タスクを追加
      </button>
    </form>
  )
}
