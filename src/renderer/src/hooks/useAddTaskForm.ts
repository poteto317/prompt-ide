import { useState } from 'react'

interface AddTaskFormState {
  title: string
  setTitle: (value: string) => void
  isDisabled: boolean
  handleSubmit: (e: React.FormEvent) => void
}

export function useAddTaskForm(onAdd: (title: string) => void): AddTaskFormState {
  const [title, setTitle] = useState('')
  const isDisabled = title.trim() === ''

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (isDisabled) return
    onAdd(title.trim())
    setTitle('')
  }

  return { title, setTitle, isDisabled, handleSubmit }
}
