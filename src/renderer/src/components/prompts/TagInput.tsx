'use client'

interface Props {
  tags: string[]
  tagInput: string
  onTagInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onTagInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onRemoveTag: (tag: string) => void
}

export default function TagInput({
  tags,
  tagInput,
  onTagInputChange,
  onTagInputKeyDown,
  onRemoveTag,
}: Props) {
  return (
    <div className="prompt-edit-form__tags" aria-label="タグ">
      {tags.map((tag) => (
        <span key={tag} className="prompt-edit-form__tag">
          {tag}
          <button
            type="button"
            className="prompt-edit-form__tag-remove"
            aria-label={`タグ「${tag}」を削除`}
            onClick={() => onRemoveTag(tag)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        className="prompt-edit-form__tag-input"
        value={tagInput}
        onChange={onTagInputChange}
        onKeyDown={onTagInputKeyDown}
        placeholder="タグを追加..."
        aria-label="新しいタグを入力（Enter で確定）"
      />
    </div>
  )
}
