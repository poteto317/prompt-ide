'use client'
import { usePrompts } from '../../hooks/usePrompts'
import PromptItem from './PromptItem'
import AddPromptForm from './AddPromptForm'

export default function PromptsPanel() {
  const { prompts, addPrompt, deletePrompt } = usePrompts()

  return (
    <div className="prompts-panel">
      <div className="prompts-panel__list">
        {prompts.length === 0 ? (
          <p className="prompts-panel__empty">プロンプトがありません</p>
        ) : (
          prompts.map((prompt) => (
            <PromptItem key={prompt.id} prompt={prompt} onDelete={deletePrompt} />
          ))
        )}
      </div>
      <AddPromptForm onAdd={addPrompt} />
    </div>
  )
}
