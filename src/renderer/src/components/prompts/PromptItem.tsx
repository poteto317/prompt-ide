'use client'
import type { Prompt } from '../../types'
import { truncatePreview } from '../../lib/promptUtils'

interface Props {
  prompt: Prompt
  onDelete: (id: string) => void
}

export default function PromptItem({ prompt, onDelete }: Props) {
  return (
    <div className="prompt-item">
      <div className="prompt-item__title">{prompt.title}</div>
      <div className="prompt-item__preview">{truncatePreview(prompt.content)}</div>
      <button
        type="button"
        className="prompt-item__delete"
        aria-label="プロンプトを削除"
        onClick={() => onDelete(prompt.id)}
      >
        削除
      </button>
    </div>
  )
}
