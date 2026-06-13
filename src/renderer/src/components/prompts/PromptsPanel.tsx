'use client'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import type { Prompt } from '../../types'
import PromptItem from './PromptItem'
import AddPromptForm from './AddPromptForm'
import { usePromptFilter } from '../../hooks/usePromptFilter'

interface Props {
  prompts: Prompt[]
  onAdd: (title: string, content: string) => void
  onDelete: (id: string) => void
  onRun: (content: string) => void
  onEdit: (id: string, title: string, content: string) => void
  onReorder: (activeId: string, overId: string) => void
  isRunDisabled?: boolean
  isActive?: boolean
}

export default function PromptsPanel({
  prompts,
  onAdd,
  onDelete,
  onRun,
  onEdit,
  onReorder,
  isRunDisabled = false,
  isActive
}: Props) {
  const { filteredPrompts, query, setQuery } = usePromptFilter(prompts, { isActive })

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const isSortable = query.trim() === ''

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (over && active.id !== over.id) {
      onReorder(String(active.id), String(over.id))
    }
  }

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
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={filteredPrompts.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              {filteredPrompts.map((prompt) => (
                <PromptItem
                  key={prompt.id}
                  prompt={prompt}
                  isSortable={isSortable}
                  onDelete={onDelete}
                  onRun={onRun}
                  onEdit={onEdit}
                  isRunDisabled={isRunDisabled}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
      <AddPromptForm onAdd={onAdd} />
    </div>
  )
}
