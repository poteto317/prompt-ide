import { useState } from 'react'
import type { Prompt } from '../types'

interface PromptEditFormState {
  title: string
  content: string
  isSaveDisabled: boolean
  handleTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleContentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  handleSave: () => void
}

/**
 * プロンプト編集フォームの状態管理フック。初期値を対象 `prompt` から取る点が
 * `usePromptForm`（新規追加用）との差分。検証作法（trim・空チェック）は揃える。
 */
export function usePromptEditForm(
  prompt: Prompt,
  onSubmit: (title: string, content: string) => void
): PromptEditFormState {
  const [title, setTitle] = useState(prompt.title)
  const [content, setContent] = useState(prompt.content)

  const isSaveDisabled = title.trim() === '' || content.trim() === ''

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setTitle(e.target.value)
  }

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setContent(e.target.value)
  }

  const handleSave = (): void => {
    if (isSaveDisabled) return
    onSubmit(title.trim(), content.trim())
  }

  return { title, content, isSaveDisabled, handleTitleChange, handleContentChange, handleSave }
}
