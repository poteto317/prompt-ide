import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSensor, PointerSensor } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import EditorTabs from '../EditorTabs'

// DndContext/SortableContext に渡された値をテストから検査するための捕捉先。
// vi.mock はファイル先頭へ巻き上げられるため vi.hoisted で先に定義する
const captured = vi.hoisted(() => ({
  onDragEnd: null as ((event: DragEndEvent) => void) | null,
  sortableItems: null as string[] | null
}))

// dnd-kit の実装（PointerSensor によるポインタ検知等）は jsdom 上でクリックの伝播を阻害するため、
// PromptsPanel.test.tsx と同じ方針で DndContext/SortableContext/useSortable をモックする
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd
  }: {
    children: React.ReactNode
    onDragEnd: (event: DragEndEvent) => void
  }) => {
    captured.onDragEnd = onDragEnd
    return <>{children}</>
  },
  PointerSensor: class {},
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => [])
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children, items }: { children: React.ReactNode; items: string[] }) => {
    captured.sortableItems = items
    return <>{children}</>
  },
  horizontalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false
  })
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } }
}))

beforeEach(() => {
  captured.onDragEnd = null
  captured.sortableItems = null
})

function renderTabs(
  propsOverride: Partial<React.ComponentProps<typeof EditorTabs>> = {}
): ReturnType<typeof render> {
  const props: React.ComponentProps<typeof EditorTabs> = {
    tabs: [
      { path: '/project/a.ts', name: 'a.ts', isDirty: false, isReorderable: true },
      { path: '/project/b.ts', name: 'b.ts', isDirty: true, isReorderable: true }
    ],
    activePath: '/project/a.ts',
    saveTargetPath: '/project/a.ts',
    isSaving: false,
    saveError: null,
    onActivateTab: vi.fn(),
    onCloseTab: vi.fn(),
    onReorderTabs: vi.fn(),
    onSave: vi.fn(),
    ...propsOverride
  }
  return render(<EditorTabs {...props} />)
}

describe('EditorTabs', () => {
  it('role="tablist" のもとで、開いている全タブを表示する', () => {
    renderTabs()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^a\.ts/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /^b\.ts/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('タブをクリックすると onActivateTab がそのタブの path で呼ばれる', async () => {
    const onActivateTab = vi.fn()
    renderTabs({ onActivateTab })
    await userEvent.click(screen.getByRole('tab', { name: /^b\.ts/ }))
    expect(onActivateTab).toHaveBeenCalledWith('/project/b.ts')
  })

  it('タブの閉じるボタンをクリックすると onCloseTab がそのタブの path で呼ばれる', async () => {
    const onCloseTab = vi.fn()
    renderTabs({ onCloseTab })
    const tabA = screen.getByRole('tab', { name: /^a\.ts/ })
    await userEvent.click(within(tabA).getByLabelText('タブを閉じる'))
    expect(onCloseTab).toHaveBeenCalledWith('/project/a.ts')
  })

  it('アクティブタブの isDirty に基づいて保存ボタンの活性状態が決まる', () => {
    renderTabs({
      tabs: [{ path: '/project/a.ts', name: 'a.ts', isDirty: true, isReorderable: true }],
      activePath: '/project/a.ts',
      saveTargetPath: '/project/a.ts'
    })
    expect(screen.getByLabelText('保存')).toBeEnabled()
  })

  it('diff タブがアクティブでも、保存対象の実ファイルが未保存なら保存ボタンは有効', () => {
    // 保存ボタンの活性状態を activePath(diff タブがアクティブなら diff タブの
    // 擬似パス)から引くと、diff タブの isDirty は常に false のため必ず無効になる。
    // 同時に EditorPanel が Monaco をアンマウントするため Ctrl/Cmd+S も消え、
    // diff タブを開いている間は未保存ファイルを保存する手段が全く無くなる。
    // 保存対象はアクティブな実ファイル(activeFilePath)であって、
    // タブバー上でどのタブが選択されているかとは独立している
    renderTabs({
      tabs: [
        { path: '/project/a.ts', name: 'a.ts', isDirty: true, isReorderable: true },
        {
          path: 'diff-tab-key',
          name: 'a.ts (未ステージ差分)',
          isDirty: false,
          isReorderable: false
        }
      ],
      activePath: 'diff-tab-key',
      saveTargetPath: '/project/a.ts'
    })
    expect(screen.getByLabelText('保存')).toBeEnabled()
  })

  it('保存対象の実ファイルが無い(saveTargetPath が null)ときは保存ボタンを無効にする', () => {
    renderTabs({
      tabs: [
        {
          path: 'diff-tab-key',
          name: 'a.ts (未ステージ差分)',
          isDirty: false,
          isReorderable: false
        }
      ],
      activePath: 'diff-tab-key',
      saveTargetPath: null
    })
    expect(screen.getByLabelText('保存')).toBeDisabled()
  })

  it('保存エラーがあれば表示する', () => {
    renderTabs({ saveError: new Error('保存に失敗しました') })
    expect(screen.getByRole('alert')).toHaveTextContent('保存に失敗しました')
  })

  it('closable=false のとき、どのタブにも閉じるボタンを表示しない(WelcomeView のプレースホルダタブ用)', () => {
    renderTabs({ closable: false })
    expect(screen.queryByLabelText('タブを閉じる')).not.toBeInTheDocument()
  })

  it('closable を省略すると各タブに閉じるボタンを表示する(既定 true)', () => {
    renderTabs()
    expect(screen.getAllByLabelText('タブを閉じる')).toHaveLength(2)
  })

  const tabsWithDiff = [
    { path: '/project/a.ts', name: 'a.ts', isDirty: false, isReorderable: true },
    { path: '/project/b.ts', name: 'b.ts', isDirty: false, isReorderable: true },
    { path: 'diff-tab-key', name: 'a.ts (未ステージ差分)', isDirty: false, isReorderable: false }
  ]

  it('isReorderable=false のタブ(diff タブ)は並び替え対象(SortableContext の items)に含めない', () => {
    // 含めてしまうと diff タブにもドラッグハンドルが付き、ユーザーはドラッグできる
    // のに onReorderTabs 側で無言の no-op になる(タブが元位置へ戻るだけで
    // 何のフィードバックも無い)
    renderTabs({ tabs: tabsWithDiff })
    expect(captured.sortableItems).toEqual(['/project/a.ts', '/project/b.ts'])
  })

  it('並び替え可能なタブ同士のドラッグは、並び替え可能なタブだけのインデックスで onReorderTabs を呼ぶ', () => {
    // onReorderTabs の実装(useFileSystem の reorderTabs)は実ファイルタブだけの
    // 配列を操作するため、diff タブを含む結合タブバー上のインデックスをそのまま
    // 渡すと範囲外になり、無言で破棄されてしまう
    const onReorderTabs = vi.fn()
    renderTabs({ tabs: tabsWithDiff, onReorderTabs })
    captured.onDragEnd?.({
      active: { id: '/project/b.ts' },
      over: { id: '/project/a.ts' }
    } as DragEndEvent)
    expect(onReorderTabs).toHaveBeenCalledWith(1, 0)
  })

  it('並び替え不可のタブ(diff タブ)がドロップ先になった場合、onReorderTabs を呼ばない', () => {
    // 呼んでしまうと、結合タブバー上のインデックス(diff タブの位置)が
    // 実ファイル配列の範囲外として無言で破棄される
    const onReorderTabs = vi.fn()
    renderTabs({ tabs: tabsWithDiff, onReorderTabs })
    captured.onDragEnd?.({
      active: { id: '/project/a.ts' },
      over: { id: 'diff-tab-key' }
    } as DragEndEvent)
    expect(onReorderTabs).not.toHaveBeenCalled()
  })

  it('並び替えの起動元は PointerSensor のみで、微小な移動ではドラッグを開始しない', () => {
    // KeyboardSensor を足すと、その onKeyDown(dnd-kit のドラッグ起動用)が
    // EditorTab 自身の onKeyDown(Enter/Space でのタブ切り替え)を後勝ちで
    // 上書きしてしまい、「設定されているのに実際には起動できない」状態になる。
    // PointerSensor のみを使うことで、この壊れた設定自体を無くす
    // このファイル内の他のテストでも同じモックを描画するため、呼び出し回数は
    // 累積する。「このレンダーで増えた1回」だけを見て、内容を確認する
    const callsBefore = vi.mocked(useSensor).mock.calls.length
    renderTabs()
    const calls = vi.mocked(useSensor).mock.calls
    expect(calls.length).toBe(callsBefore + 1)
    expect(calls[calls.length - 1]).toEqual([
      PointerSensor,
      { activationConstraint: { distance: 4 } }
    ])
  })
})
