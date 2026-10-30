import { render, screen } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import EditorTab from '../EditorTab'

vi.mock('@dnd-kit/sortable', () => ({
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

// useSortable はモックされているため、DndContext/SortableContext は不要
function renderTab(props: Partial<React.ComponentProps<typeof EditorTab>> = {}): RenderResult {
  const defaultProps: React.ComponentProps<typeof EditorTab> = {
    path: '/project/index.ts',
    fileName: 'index.ts',
    isDirty: false,
    isActive: false,
    onActivate: vi.fn(),
    onClose: vi.fn(),
    ...props
  }
  return render(<EditorTab {...defaultProps} />)
}

describe('EditorTab', () => {
  it('role="tab" と aria-selected でアクティブ状態を表す', () => {
    renderTab({ isActive: true })
    expect(screen.getByRole('tab', { name: /index\.ts/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('非アクティブなタブは aria-selected が false', () => {
    renderTab({ isActive: false })
    expect(screen.getByRole('tab', { name: /index\.ts/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('タブをクリックすると onActivate が呼ばれる', async () => {
    const onActivate = vi.fn()
    renderTab({ onActivate })
    await userEvent.click(screen.getByRole('tab', { name: /index\.ts/ }))
    expect(onActivate).toHaveBeenCalledOnce()
  })

  it('未保存の変更があるとき、ダーティインジケータを表示する', () => {
    renderTab({ isDirty: true })
    expect(screen.getByLabelText('未保存の変更があります')).toBeInTheDocument()
  })

  it('閉じるボタンをクリックすると onClose が呼ばれ、onActivate は呼ばれない', async () => {
    const onClose = vi.fn()
    const onActivate = vi.fn()
    renderTab({ onClose, onActivate })
    await userEvent.click(screen.getByLabelText('タブを閉じる'))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('closable=false のとき、閉じるボタンを表示しない(押しても何も起きないボタンを見せない)', () => {
    renderTab({ closable: false })
    expect(screen.queryByLabelText('タブを閉じる')).not.toBeInTheDocument()
  })

  it('closable を省略すると閉じるボタンを表示する(既定 true)', () => {
    renderTab()
    expect(screen.getByLabelText('タブを閉じる')).toBeInTheDocument()
  })

  describe('キーボード操作', () => {
    it('Enterキーでタブにフォーカス後、Enterキーで onActivate が呼ばれる', async () => {
      const onActivate = vi.fn()
      renderTab({ onActivate })
      const tabElement = screen.getByRole('tab', { name: /index\.ts/ })
      await userEvent.click(tabElement)
      await userEvent.keyboard('{Enter}')
      expect(onActivate).toHaveBeenCalledTimes(2) // click + Enter
    })

    it('Spaceキーでタブにフォーカス後、Spaceキーで onActivate が呼ばれる', async () => {
      const onActivate = vi.fn()
      renderTab({ onActivate })
      const tabElement = screen.getByRole('tab', { name: /index\.ts/ })
      await userEvent.click(tabElement)
      await userEvent.keyboard(' ')
      expect(onActivate).toHaveBeenCalledTimes(2) // click + Space
    })

    it('他のキー（例: a）ではタブ選択が変わらない', async () => {
      const onActivate = vi.fn()
      renderTab({ onActivate })
      const tabElement = screen.getByRole('tab', { name: /index\.ts/ })
      await userEvent.click(tabElement)
      await userEvent.keyboard('a')
      expect(onActivate).toHaveBeenCalledOnce() // click only
    })

    it('Spaceキー時に preventDefault が呼ばれてページスクロール防止される', async () => {
      const onActivate = vi.fn()
      renderTab({ onActivate })
      const tabElement = screen.getByRole('tab', { name: /index\.ts/ })
      tabElement.focus()
      const preventDefaultSpy = vi.spyOn(KeyboardEvent.prototype, 'preventDefault')
      await userEvent.keyboard(' ')
      // Space キーで preventDefault が呼ばれることを検証
      // （ページスクロール防止のために実装内で呼び出されていることを確認）
      expect(preventDefaultSpy).toHaveBeenCalled()
      expect(onActivate).toHaveBeenCalled()
    })
  })
})
