'use client'
import type { Prompt } from '../../types'
import PromptItem from './PromptItem'
import AddPromptForm from './AddPromptForm'

interface Props {
  prompts: Prompt[]
  onAdd: (title: string, content: string) => void
  onDelete: (id: string) => void
  onRun: (content: string) => void
  isRunDisabled?: boolean
}

export default function PromptsPanel({ prompts, onAdd, onDelete, onRun, isRunDisabled = false }: Props) {
  return (
    <div className="prompts-panel">
      <div className="prompts-panel__list">
        {prompts.length === 0 ? (
          <p className="prompts-panel__empty">プロンプトがありません</p>
        ) : (
          prompts.map((prompt) => (
            <PromptItem
              key={prompt.id}
              prompt={prompt}
              onDelete={onDelete}
              onRun={onRun}
              isRunDisabled={isRunDisabled}
            />
          ))
        )}
      </div>
      <AddPromptForm onAdd={onAdd} />
    </div>
  )
}
