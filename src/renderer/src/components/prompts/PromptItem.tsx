'use client'
import type { Prompt } from '../../types'

const PREVIEW_MAX = 50

interface Props {
  prompt: Prompt
  onDelete: (id: string) => void
}

export default function PromptItem({ prompt, onDelete }: Props) {
  const preview =
    prompt.content.length > PREVIEW_MAX
      ? prompt.content.slice(0, PREVIEW_MAX) + '…'
      : prompt.content

  return (
    <div className="prompt-item">
      <div className="prompt-item__title">{prompt.title}</div>
      <div className="prompt-item__preview">{preview}</div>
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
