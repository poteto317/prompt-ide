'use client'
import type { Prompt } from '../../types'
import PromptItem from './PromptItem'
import AddPromptForm from './AddPromptForm'

interface Props {
  prompts: Prompt[]
  onAdd: (title: string, content: string) => void
  onDelete: (id: string) => void
}

export default function PromptsPanel({ prompts, onAdd, onDelete }: Props) {
  return (
    <div className="prompts-panel">
      <div className="prompts-panel__list">
        {prompts.length === 0 ? (
          <p className="prompts-panel__empty">プロンプトがありません</p>
        ) : (
          prompts.map((prompt) => (
            <PromptItem key={prompt.id} prompt={prompt} onDelete={onDelete} />
          ))
        )}
      </div>
      <AddPromptForm onAdd={onAdd} />
    </div>
  )
}
