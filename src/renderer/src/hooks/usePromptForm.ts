import { useState } from 'react'

interface PromptFormState {
  title: string
  content: string
  isDisabled: boolean
  handleTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleContentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void
}

export function usePromptForm(onAdd: (title: string, content: string) => void): PromptFormState {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  const isDisabled = title.trim() === '' || content.trim() === ''

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setTitle(e.target.value)
  }

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setContent(e.target.value)
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    if (isDisabled) return
    onAdd(title.trim(), content.trim())
    setTitle('')
    setContent('')
  }

  return { title, content, isDisabled, handleTitleChange, handleContentChange, handleSubmit }
}
