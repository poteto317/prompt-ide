'use client'

interface Props {
  tags: string[]
  selectedTags: string[]
  onToggle: (tag: string) => void
}

export default function PromptsTagFilter({ tags, selectedTags, onToggle }: Props) {
  if (tags.length === 0) return null
  return (
    <div className="prompts-panel__tag-filter" role="group" aria-label="タグで絞り込み">
      {tags.map((tag) => {
        const isActive = selectedTags.includes(tag)
        return (
          <button
            key={tag}
            type="button"
            className={`prompts-panel__tag-chip${isActive ? ' prompts-panel__tag-chip--active' : ''}`}
            aria-pressed={isActive}
            onClick={() => onToggle(tag)}
          >
            {tag}
          </button>
        )
      })}
    </div>
  )
}
