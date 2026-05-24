'use client'
import type { Prompt } from '../../types'
import { truncatePreview } from '../../lib/promptUtils'

interface Props {
  prompt: Prompt
  onDelete: (id: string) => void
  onRun: (content: string) => void
  isRunDisabled?: boolean
}

export default function PromptItem({ prompt, onDelete, onRun, isRunDisabled = false }: Props) {
  return (
    <div className="prompt-item">
      <div className="prompt-item__title">{prompt.title}</div>
      <div className="prompt-item__preview">{truncatePreview(prompt.content)}</div>
      <div className="prompt-item__actions">
        <button
          type="button"
          className="prompt-item__run"
          aria-label="プロンプトを実行"
          disabled={isRunDisabled}
          onClick={() => onRun(prompt.content)}
        >
          実行
        </button>
        <button
          type="button"
          className="prompt-item__delete"
          aria-label="プロンプトを削除"
          onClick={() => onDelete(prompt.id)}
        >
          削除
        </button>
      </div>
    </div>
  )
}
