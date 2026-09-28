import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { GitBranch } from '@shared/types'
import BranchSwitcherMenu from '../BranchSwitcherMenu'

const branches: GitBranch[] = [
  { name: 'main', current: true },
  { name: 'feature/x', current: false }
]

describe('BranchSwitcherMenu', () => {
  it('role="radiogroup" のコンテナに各ブランチが role="radio" として表示される', () => {
    render(<BranchSwitcherMenu branches={branches} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('radiogroup', { name: 'ブランチ' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /main/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /feature\/x/ })).toBeInTheDocument()
  })

  it('現在のブランチだけ aria-checked が true になる', () => {
    render(<BranchSwitcherMenu branches={branches} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /main/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /feature\/x/ })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('現在のブランチのボタンは disabled になっている', () => {
    render(<BranchSwitcherMenu branches={branches} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /main/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /feature\/x/ })).not.toBeDisabled()
  })

  it('現在以外のブランチをクリックすると onSelect がそのブランチ名で呼ばれる', async () => {
    const onSelect = vi.fn()
    render(<BranchSwitcherMenu branches={branches} onSelect={onSelect} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('radio', { name: /feature\/x/ }))
    expect(onSelect).toHaveBeenCalledWith('feature/x')
  })

  it('現在のブランチをクリックしても onSelect は呼ばれない(disabled のため)', async () => {
    const onSelect = vi.fn()
    render(<BranchSwitcherMenu branches={branches} onSelect={onSelect} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('radio', { name: /main/ }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('外側(document)をクリックすると onClose が呼ばれる', () => {
    const onClose = vi.fn()
    render(<BranchSwitcherMenu branches={branches} onSelect={vi.fn()} onClose={onClose} />)
    fireEvent.click(document.body)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape キーを押すと onClose が呼ばれる', () => {
    const onClose = vi.fn()
    render(<BranchSwitcherMenu branches={branches} onSelect={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('アンマウント時に document のリスナーを解除する', () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <BranchSwitcherMenu branches={branches} onSelect={vi.fn()} onClose={onClose} />
    )
    unmount()
    fireEvent.click(document.body)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  // コードレビュー指摘: 同じ role="radiogroup"/role="radio" パターンを使う
  // HistoryPanel.tsx は ArrowUp/ArrowDown での roving focus を実装しているが、
  // BranchSwitcherMenu には無く、矢印キーが反応しない一貫性の欠如だった。
  // 現在ブランチのボタンは disabled(フォーカス不可)のため、移動対象からは除く
  describe('矢印キーでのフォーカス移動', () => {
    const threeBranches: GitBranch[] = [
      { name: 'main', current: true },
      { name: 'feature/x', current: false },
      { name: 'feature/y', current: false }
    ]

    it('何もフォーカスされていない状態で ArrowDown を押すと先頭の選択可能なブランチへフォーカスする', () => {
      render(<BranchSwitcherMenu branches={threeBranches} onSelect={vi.fn()} onClose={vi.fn()} />)
      fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' })
      expect(screen.getByRole('radio', { name: /feature\/x/ })).toHaveFocus()
    })

    it('何もフォーカスされていない状態で ArrowUp を押すと末尾の選択可能なブランチへフォーカスする', () => {
      render(<BranchSwitcherMenu branches={threeBranches} onSelect={vi.fn()} onClose={vi.fn()} />)
      fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowUp' })
      expect(screen.getByRole('radio', { name: /feature\/y/ })).toHaveFocus()
    })

    it('ArrowDown で次のブランチへフォーカスが移動する', () => {
      render(<BranchSwitcherMenu branches={threeBranches} onSelect={vi.fn()} onClose={vi.fn()} />)
      screen.getByRole('radio', { name: /feature\/x/ }).focus()
      fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' })
      expect(screen.getByRole('radio', { name: /feature\/y/ })).toHaveFocus()
    })

    it('末尾で ArrowDown を押すと先頭(current を除く)へ循環する', () => {
      render(<BranchSwitcherMenu branches={threeBranches} onSelect={vi.fn()} onClose={vi.fn()} />)
      screen.getByRole('radio', { name: /feature\/y/ }).focus()
      fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' })
      expect(screen.getByRole('radio', { name: /feature\/x/ })).toHaveFocus()
    })

    it('先頭で ArrowUp を押すと末尾(current を除く)へ循環する', () => {
      render(<BranchSwitcherMenu branches={threeBranches} onSelect={vi.fn()} onClose={vi.fn()} />)
      screen.getByRole('radio', { name: /feature\/x/ }).focus()
      fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowUp' })
      expect(screen.getByRole('radio', { name: /feature\/y/ })).toHaveFocus()
    })

    it('選択可能なブランチが無い(current のみ)場合、矢印キーを押してもエラーにならない', () => {
      render(
        <BranchSwitcherMenu
          branches={[{ name: 'main', current: true }]}
          onSelect={vi.fn()}
          onClose={vi.fn()}
        />
      )
      expect(() =>
        fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' })
      ).not.toThrow()
    })
  })

  // コードレビュー指摘(2周目): HistoryItem.tsx は tabIndex={isSelected ? 0 : -1}
  // で roving tabindex(グループ内の Tab 停止点を1つだけにする、ARIA APG の
  // radiogroup パターン)を実装しているが、BranchSwitcherMenu の各ボタンには
  // tabIndex の指定が無く、非 disabled な button のデフォルト(tabIndex=0)の
  // ままだったため、選択可能なブランチの数だけ Tab 停止点が生まれてしまっていた
  describe('roving tabindex(Tab の停止点を1つに絞る)', () => {
    const threeBranches: GitBranch[] = [
      { name: 'main', current: true },
      { name: 'feature/x', current: false },
      { name: 'feature/y', current: false }
    ]

    it('初期状態では先頭の選択可能なブランチだけ tabIndex=0 で、他は -1', () => {
      render(<BranchSwitcherMenu branches={threeBranches} onSelect={vi.fn()} onClose={vi.fn()} />)
      expect(screen.getByRole('radio', { name: /feature\/x/ })).toHaveAttribute('tabIndex', '0')
      expect(screen.getByRole('radio', { name: /feature\/y/ })).toHaveAttribute('tabIndex', '-1')
    })

    it('矢印キーでフォーカスが移動すると、移動先だけ tabIndex=0 になる', () => {
      render(<BranchSwitcherMenu branches={threeBranches} onSelect={vi.fn()} onClose={vi.fn()} />)
      screen.getByRole('radio', { name: /feature\/x/ }).focus()
      fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' })
      expect(screen.getByRole('radio', { name: /feature\/y/ })).toHaveAttribute('tabIndex', '0')
      expect(screen.getByRole('radio', { name: /feature\/x/ })).toHaveAttribute('tabIndex', '-1')
    })
  })
})
