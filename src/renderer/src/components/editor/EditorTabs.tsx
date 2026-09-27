import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import EditorTab from './EditorTab'
import EditorSaveControl from './EditorSaveControl'
import type { TabItem } from '../../hooks/useCombinedEditorTabs'

interface Props {
  tabs: TabItem[]
  activePath: string | null
  /** 保存ボタンの対象となる実ファイルのパス(アクティブな実ファイル)。
   *  activePath とは別に受け取るのは、diff タブがアクティブなときも
   *  保存対象の実ファイルは変わらないため。activePath から引くと、
   *  diff タブの isDirty(常に false)を見てしまい、diff タブを開いている間は
   *  未保存ファイルを保存できなくなる(Monaco もアンマウントされ Ctrl/Cmd+S も効かない) */
  saveTargetPath: string | null
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
  saveTargetPath,
  isSaving,
  saveError,
  onActivateTab,
  onCloseTab,
  onReorderTabs,
  onSave,
  closable = true
}: Props): React.JSX.Element {
  // ポインタのみ対応。EditorTab は listeners を dnd-kit の並び替えと同じ要素に
  // 直接スプレッドしているため、KeyboardSensor を足すと dnd-kit 自身の
  // onKeyDown(KeyboardSensor の起動に必要)が EditorTab の onKeyDown(Enter/Space
  // でのタブ切り替え)に後勝ちで上書きされ、キーボードでの並び替えは実際には
  // 起動できないまま「設定されているように見える」状態になる。キーボードでの
  // タブ切り替え(Enter/Space)自体は EditorTab 側の onKeyDown でこの設定と無関係に
  // 動くため、並び替えの起動元を PointerSensor のみに絞ってこの状態を解消する
  // (キーボードでの並び替えは別途の対応が必要な既知の UX ギャップとして残る)。
  // activationConstraint によって、わずかなポインタ移動だけではドラッグが
  // 開始しないようにする。無指定だと mousedown 直後の微小な移動でドラッグ扱いに
  // なり、クリックでのタブ切り替え・閉じるボタンのクリックと干渉し得るため
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  // 保存ボタンは「アクティブな実ファイル」を対象にする。activePath は diff タブが
  // アクティブならその擬似パスになるため、そこから引くと isDirty が常に false になる
  const saveTargetTab = tabs.find((t) => t.path === saveTargetPath) ?? null
  const isDirty = saveTargetTab?.isDirty ?? false

  // 並び替えの実体(useFileSystem の reorderTabs)は実ファイルタブだけの配列を
  // 操作するため、diff タブを含む結合タブバー上のインデックスをそのまま渡すと
  // 範囲外になり、無言で破棄されてしまう。並び替え可能なタブだけを取り出した
  // インデックス空間へここで明示的に変換する
  const reorderableTabs = tabs.filter((t) => t.isReorderable)

  function handleDragEnd({ active, over }: DragEndEvent): void {
    if (!over || active.id === over.id) return
    const fromIndex = reorderableTabs.findIndex((t) => t.path === active.id)
    const toIndex = reorderableTabs.findIndex((t) => t.path === over.id)
    // 並び替え対象外のタブ(diff タブ)が絡むドラッグはここで捨てる。
    // SortableContext の items からも外しているため通常は到達しないが、
    // 呼び出し先へ範囲外インデックスを渡さない最後の防波堤として残す
    if (fromIndex === -1 || toIndex === -1) return
    onReorderTabs(fromIndex, toIndex)
  }

  return (
    <div className="editor-tabs">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={reorderableTabs.map((t) => t.path)}
          strategy={horizontalListSortingStrategy}
        >
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
                isReorderable={tab.isReorderable}
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
