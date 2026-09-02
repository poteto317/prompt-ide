import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import EditorTabs from '../EditorTabs'

// dnd-kit の実装（PointerSensor によるポインタ検知等）は jsdom 上でクリックの伝播を阻害するため、
// PromptsPanel.test.tsx と同じ方針で DndContext/SortableContext/useSortable をモックする
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PointerSensor: class {},
  KeyboardSensor: class {},
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => [])
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: {},
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
})
