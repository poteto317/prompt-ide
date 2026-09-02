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
  horizontalListSortingStrategy
} from '@dnd-kit/sortable'
import EditorTab from './EditorTab'
import EditorSaveControl from './EditorSaveControl'

interface Tab {
  path: string
  name: string
  isDirty: boolean
}

interface Props {
  tabs: Tab[]
  activePath: string | null
  isSaving: boolean
  saveError: Error | null
  onActivateTab: (path: string) => void
  onCloseTab: (path: string) => void
  onReorderTabs: (fromIndex: number, toIndex: number) => void
  onSave: () => void
  /** 全タブに共通で閉じるボタンを表示するか。既定は true。WelcomeView の
   * プレースホルダタブ(常に1件だけ)を表示する場合のみ false を渡す */
  closable?: boolean
}

export default function EditorTabs({
  tabs,
  activePath,
  isSaving,
  saveError,
  onActivateTab,
  onCloseTab,
  onReorderTabs,
  onSave,
  closable = true
}: Props): React.JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const activeTab = tabs.find((t) => t.path === activePath) ?? null
  const isDirty = activeTab?.isDirty ?? false

  function handleDragEnd({ active, over }: DragEndEvent): void {
    if (!over || active.id === over.id) return
    const fromIndex = tabs.findIndex((t) => t.path === active.id)
    const toIndex = tabs.findIndex((t) => t.path === over.id)
    if (fromIndex === -1 || toIndex === -1) return
    onReorderTabs(fromIndex, toIndex)
  }

  return (
    <div className="editor-tabs">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tabs.map((t) => t.path)} strategy={horizontalListSortingStrategy}>
          <div className="editor-tabs__list" role="tablist">
            {tabs.map((tab) => (
              <EditorTab
                key={tab.path}
                path={tab.path}
                fileName={tab.name}
                isDirty={tab.isDirty}
                isActive={tab.path === activePath}
                onActivate={() => onActivateTab(tab.path)}
                onClose={() => onCloseTab(tab.path)}
                closable={closable}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <EditorSaveControl
        isDirty={isDirty}
        isSaving={isSaving}
        saveError={saveError}
        onSave={onSave}
      />
    </div>
  )
}
