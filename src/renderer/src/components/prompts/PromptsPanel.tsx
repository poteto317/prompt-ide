'use client'
import { useMemo, useCallback, useId } from 'react'
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
import type {
  AgentReferencesPanelState,
  AgentSendFeedback,
  PromptListModePanelState,
  PromptToolId,
  Prompt
} from '../../types'
import PromptItem from './PromptItem'
import AddPromptForm from './AddPromptForm'
import PromptsToolbar from './PromptsToolbar'
import ExecutionToolSelector from './ExecutionToolSelector'
import PromptsTagFilter from './PromptsTagFilter'
import AgentReferenceChips from './AgentReferenceChips'
import PromptListModeToggle from './PromptListModeToggle'
import AgentSendFeedbackMessages from '../agent/AgentSendFeedbackMessages'
import { usePromptFilter } from '../../hooks/usePromptFilter'
import { useAllTags } from '../../hooks/useAllTags'
import { useSelectedTool } from '../../hooks/useSelectedTool'
import { sortByPinned, crossesPinBoundary } from '../../lib/promptUtils'

interface Props {
  prompts: Prompt[]
  onAdd: (title: string, content: string) => void
  onDelete: (id: string) => void
  onRun: (content: string, toolId: PromptToolId, prompt: Prompt) => void
  onEdit: (id: string, title: string, content: string, tags: string[]) => void
  onReorder: (activeId: string, overId: string) => void
  onTogglePin: (id: string) => void
  onExport: () => void
  onImport: () => void
  isRunDisabled?: boolean
  isActive?: boolean
  /** 実行ボタンを押せない理由。上部に 1 か所だけ表示し、無効のボタンの aria-describedby から参照する(パターン 126) */
  runDisabledReason?: string | null
  /** エージェント CLI 方式の送信の失敗と成功の通知の見える文字(読み上げは Sidebar の常設の領域)。従来の方式と、プロンプトのパネルが隠れているときは null(文字を置かない) */
  agentSend?: AgentSendFeedback | null
  /** 実行ツールの選択を出すか(エージェント CLI 方式では出さない。C3) */
  showToolSelector?: boolean
  /** 実行ボタンの aria-label。省略時は従来の「プロンプトを実行」 */
  runAriaLabel?: string
  /** 参照の行(エージェント CLI 方式でフォルダを開いているときだけ。それ以外は null で行を出さない)。省略できない(L-060) */
  agentReferences: AgentReferencesPanelState | null
  /** 一覧の編集モード / 表示モード(先頭のトグルの行と、`編集`・`削除` の出し分け)。省略できない(L-060) */
  promptListMode: PromptListModePanelState
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
  isActive,
  runDisabledReason = null,
  agentSend = null,
  showToolSelector = true,
  runAriaLabel,
  agentReferences,
  promptListMode
}: Props): React.JSX.Element {
  const runReasonId = useId()
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

  // 表示モードと読み込み中(null)では `編集`・`削除` を出さない(読み込み中に出すと、保存が表示モードのとき一瞬だけ削除を押せてしまう)
  const canEdit = promptListMode.mode === 'edit'

  const handleRunWithTool = useCallback(
    (content: string, prompt: Prompt) => onRun(content, selectedTool, prompt),
    [onRun, selectedTool]
  )

  function handleDragEnd({ active, over }: DragEndEvent): void {
    if (!over || active.id === over.id) return
    const activePrompt = displayed.find((p) => p.id === String(active.id))
    const overPrompt = displayed.find((p) => p.id === String(over.id))
    // displayed に存在しない ID（フィルタ変化等でリストから消えた要素）はスキップする
    if (!activePrompt || !overPrompt) return
    // ピン済み/非ピン済みの境界をまたぐドラッグは sortByPinned で元の表示順に戻るため
    // サイレント no-op にならないようにスキップする
    if (crossesPinBoundary(activePrompt, overPrompt)) return
    onReorder(String(active.id), String(over.id))
  }

  return (
    <div className="prompts-panel">
      {/* 一覧の編集モード / 表示モード。0 件・検索中でも常に出す(隠すとモードを戻せなくなる。L-475) */}
      <PromptListModeToggle state={promptListMode} />
      <PromptsToolbar
        onImport={onImport}
        onExport={onExport}
        isExportDisabled={prompts.length === 0}
      />
      {showToolSelector && (
        <ExecutionToolSelector selectedTool={selectedTool} onSelectTool={selectTool} />
      )}
      {runDisabledReason !== null && (
        <p id={runReasonId} className="prompts-panel__run-reason">
          {runDisabledReason}
        </p>
      )}
      {agentSend !== null && <AgentSendFeedbackMessages feedback={agentSend} />}
      {/* プロンプトの一覧の上(検索欄の前)に、実行のときに本文へ足す参照のチップを出す */}
      {agentReferences !== null && <AgentReferenceChips state={agentReferences} />}
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
          <p className="prompts-panel__no-results">条件に一致するプロンプトはありません</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={displayed.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              {displayed.map((prompt) => (
                <PromptItem
                  key={prompt.id}
                  prompt={prompt}
                  isSortable={isSortable}
                  canEdit={canEdit}
                  onDelete={onDelete}
                  onRun={handleRunWithTool}
                  onEdit={onEdit}
                  onTogglePin={onTogglePin}
                  isRunDisabled={isRunDisabled}
                  runDisabledReasonId={
                    isRunDisabled && runDisabledReason !== null ? runReasonId : undefined
                  }
                  runAriaLabel={runAriaLabel}
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
