'use client'
import type { Prompt } from '../../types'
import PromptItem from './PromptItem'
import AddPromptForm from './AddPromptForm'
import { usePromptFilter } from '../../hooks/usePromptFilter'

interface Props {
  prompts: Prompt[]
  onAdd: (title: string, content: string) => void
  onDelete: (id: string) => void
  onRun: (content: string) => void
  isRunDisabled?: boolean
}

export default function PromptsPanel({ prompts, onAdd, onDelete, onRun, isRunDisabled = false }: Props) {
  const { filteredPrompts, query, setQuery } = usePromptFilter(prompts)

  return (
    <div className="prompts-panel">
      <div className="prompts-panel__search">
        <input
          className="prompts-panel__search-input"
          type="search"
          placeholder="検索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="プロンプトを検索"
        />
      </div>
      <div className="prompts-panel__list">
        {prompts.length === 0 ? (
          <p className="prompts-panel__empty">プロンプトがありません</p>
        ) : filteredPrompts.length === 0 ? (
          <p className="prompts-panel__no-results">
            &ldquo;{query.trim()}&rdquo; に一致するプロンプトはありません
          </p>
        ) : (
          filteredPrompts.map((prompt) => (
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
