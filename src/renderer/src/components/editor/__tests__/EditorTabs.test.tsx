import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { useSensor, PointerSensor } from '@dnd-kit/core'
import EditorTabs from '../EditorTabs'

// dnd-kit の実装（PointerSensor によるポインタ検知等）は jsdom 上でクリックの伝播を阻害するため、
// PromptsPanel.test.tsx と同じ方針で DndContext/SortableContext/useSortable をモックする
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PointerSensor: class {},
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => [])
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

function renderTabs(propsOverride: Partial<React.ComponentProps<typeof EditorTabs>> = {}) {
  const props: React.ComponentProps<typeof EditorTabs> = {
    tabs: [
      { path: '/project/a.ts', name: 'a.ts', isDirty: false },
      { path: '/project/b.ts', name: 'b.ts', isDirty: true }
    ],
    activePath: '/project/a.ts',
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
      tabs: [{ path: '/project/a.ts', name: 'a.ts', isDirty: true }],
      activePath: '/project/a.ts'
    })
    expect(screen.getByLabelText('保存')).toBeEnabled()
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
