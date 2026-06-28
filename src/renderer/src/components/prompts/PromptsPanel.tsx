'use client'
import { useMemo, useCallback } from 'react'
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
import type { CLIToolId, Prompt } from '../../types'
import PromptItem from './PromptItem'
import AddPromptForm from './AddPromptForm'
import PromptsToolbar from './PromptsToolbar'
import CLIToolSelector from './CLIToolSelector'
import PromptsTagFilter from './PromptsTagFilter'
import { usePromptFilter } from '../../hooks/usePromptFilter'
import { useAllTags } from '../../hooks/useAllTags'
import { useSelectedTool } from '../../hooks/useSelectedTool'
import { sortByPinned } from '../../lib/promptUtils'

interface Props {
  prompts: Prompt[]
  onAdd: (title: string, content: string) => void
  onDelete: (id: string) => void
  onRun: (content: string, toolId: CLIToolId) => void
  onEdit: (id: string, title: string, content: string, tags: string[]) => void
  onReorder: (activeId: string, overId: string) => void
  onTogglePin: (id: string) => void
  onExport: () => void
  onImport: () => void
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
  onTogglePin,
  onExport,
  onImport,
  isRunDisabled = false,
  isActive
}: Props) {
  const { selectedTool, selectTool } = useSelectedTool()
  const { filteredPrompts, query, setQuery, selectedTags, toggleTag, isFiltered } = usePromptFilter(
    prompts,
    { isActive }
  )

  // フィルタ結果にピン留め順を適用（ピン済みを上部へ固定）
  const displayed = useMemo(() => sortByPinned(filteredPrompts), [filteredPrompts])

  const allTags = useAllTags(prompts)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // テキスト検索中またはタグ絞り込み中は並び替えを無効化
  const isSortable = !isFiltered

  const handleRunWithTool = useCallback(
    (content: string) => onRun(content, selectedTool),
    [onRun, selectedTool]
  )

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const activePrompt = displayed.find((p) => p.id === String(active.id))
    const overPrompt = displayed.find((p) => p.id === String(over.id))
    // displayed に存在しない ID（フィルタ変化等でリストから消えた要素）はスキップする
    if (!activePrompt || !overPrompt) return
    // ピン済み/非ピン済みの境界をまたぐドラッグは sortByPinned で元の表示順に戻るため
    // サイレント no-op にならないようにスキップする
    if (!!activePrompt.pinned !== !!overPrompt.pinned) return
    onReorder(String(active.id), String(over.id))
  }

  return (
    <div className="prompts-panel">
      <PromptsToolbar
        onImport={onImport}
        onExport={onExport}
        isExportDisabled={prompts.length === 0}
      />
      <CLIToolSelector selectedTool={selectedTool} onSelectTool={selectTool} />
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
      <PromptsTagFilter tags={allTags} selectedTags={selectedTags} onToggle={toggleTag} />
      <div className="prompts-panel__list">
        {prompts.length === 0 ? (
          <p className="prompts-panel__empty">プロンプトがありません</p>
        ) : filteredPrompts.length === 0 ? (
          <p className="prompts-panel__no-results">
            条件に一致するプロンプトはありません
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={displayed.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              {displayed.map((prompt) => (
                <PromptItem
                  key={prompt.id}
                  prompt={prompt}
                  isSortable={isSortable}
                  onDelete={onDelete}
                  onRun={handleRunWithTool}
                  onEdit={onEdit}
                  onTogglePin={onTogglePin}
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
