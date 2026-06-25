import { useState } from 'react'
import type { Prompt } from '../types'
import { useTagInput } from './useTagInput'

interface PromptEditFormState {
  title: string
  content: string
  tags: string[]
  tagInput: string
  isSaveDisabled: boolean
  handleTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleContentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  handleTagInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleTagInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleRemoveTag: (tag: string) => void
  handleSave: () => void
}

/** プロンプト編集フォームの状態管理フック。初期値を対象 `prompt` から取る。 */
export function usePromptEditForm(
  prompt: Prompt,
  onSubmit: (title: string, content: string, tags: string[]) => void
): PromptEditFormState {
  const [title, setTitle] = useState(prompt.title)
  const [content, setContent] = useState(prompt.content)
  const { tags, tagInput, handleTagInputChange, handleTagInputKeyDown, handleRemoveTag } =
    useTagInput(prompt.tags ?? [])

  const isSaveDisabled = title.trim() === '' || content.trim() === ''

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setTitle(e.target.value)
  }

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setContent(e.target.value)
  }

  const handleSave = (): void => {
    if (isSaveDisabled) return
    onSubmit(title.trim(), content.trim(), tags)
  }

  return {
    title,
    content,
    tags,
    tagInput,
    isSaveDisabled,
    handleTitleChange,
    handleContentChange,
    handleTagInputChange,
    handleTagInputKeyDown,
    handleRemoveTag,
    handleSave,
  }
}
