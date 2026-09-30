import { render, screen, fireEvent } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { GitBranch } from '@shared/types'
import BranchSwitcherMenu from '../BranchSwitcherMenu'

const branches: GitBranch[] = [
  { name: 'main', current: true },
  { name: 'feature/x', current: false }
]

// 矢印キー・roving tabindex・初期フォーカスの検証用(選択可能なブランチが複数ある)
const threeBranches: GitBranch[] = [
  { name: 'main', current: true },
  { name: 'feature/x', current: false },
  { name: 'feature/y', current: false }
]

type MenuProps = React.ComponentProps<typeof BranchSwitcherMenu>

// 各テストは検証に関わる Props だけを overrides で渡す(Props が増えても、関係の無い
// テストを書き換えずに済むようにする)。コールバックはテストごとに新しいモックを作る
const renderMenu = (overrides: Partial<MenuProps> = {}): RenderResult =>
  render(
    <BranchSwitcherMenu
      branches={branches}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      onCreateRequest={vi.fn()}
      onDelete={vi.fn()}
      onMerge={vi.fn()}
      {...overrides}
    />
  )

describe('BranchSwitcherMenu', () => {
  it('role="radiogroup" のコンテナに各ブランチが role="radio" として表示される', () => {
    renderMenu()
    expect(screen.getByRole('radiogroup', { name: 'ブランチ' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /main/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /feature\/x/ })).toBeInTheDocument()
  })

  it('現在のブランチだけ aria-checked が true になる', () => {
    renderMenu()
    expect(screen.getByRole('radio', { name: /main/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /feature\/x/ })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('現在のブランチのボタンは disabled になっている', () => {
    renderMenu()
    expect(screen.getByRole('radio', { name: /main/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /feature\/x/ })).not.toBeDisabled()
  })

  it('現在以外のブランチをクリックすると onSelect がそのブランチ名で呼ばれる', async () => {
    const onSelect = vi.fn()
    renderMenu({ onSelect })
    await userEvent.click(screen.getByRole('radio', { name: /feature\/x/ }))
    expect(onSelect).toHaveBeenCalledWith('feature/x')
  })

  it('現在のブランチをクリックしても onSelect は呼ばれない(disabled のため)', async () => {
    const onSelect = vi.fn()
    renderMenu({ onSelect })
    await userEvent.click(screen.getByRole('radio', { name: /main/ }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('外側(document)をクリックすると onClose が呼ばれる', () => {
    const onClose = vi.fn()
    renderMenu({ onClose })
    fireEvent.click(document.body)
    expect(onClose).toHaveBeenCalledOnce()
  })

  // PRレビュー指摘: 外側クリックはユーザーが別の要素へ自然にフォーカスを
  // 移そうとした操作である可能性が高いため、呼び出し元(BranchSwitcher.tsx)が
  // トリガーボタンへフォーカスを奪い返さないよう、Escapeキーとは区別して
  // false(フォーカス復帰不要)を渡す
  it('外側(document)をクリックすると onClose が false(フォーカス復帰不要)で呼ばれる', () => {
    const onClose = vi.fn()
    renderMenu({ onClose })
    fireEvent.click(document.body)
    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('Escape キーを押すと onClose が呼ばれる', () => {
    const onClose = vi.fn()
    renderMenu({ onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  // PRレビュー指摘: Escapeキーで閉じた場合はキーボード操作の一環なので、
  // トリガーボタンへフォーカスを戻す必要がある(true を渡す)
  it('Escape キーを押すと onClose が true(フォーカス復帰要)で呼ばれる', () => {
    const onClose = vi.fn()
    renderMenu({ onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('アンマウント時に document のリスナーを解除する', () => {
    const onClose = vi.fn()
    const { unmount } = renderMenu({ onClose })
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
    it('何もフォーカスされていない状態で ArrowDown を押すと先頭の選択可能なブランチへフォーカスする', () => {
      renderMenu({ branches: threeBranches })
      // マウント時の自動フォーカス(後続のPRレビュー対応で追加)をリセットし、
      // このテストが検証したい「未フォーカス状態からのフォールバック」を作る
      ;(document.activeElement as HTMLElement | null)?.blur()
      fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' })
      expect(screen.getByRole('radio', { name: /feature\/x/ })).toHaveFocus()
    })

    it('何もフォーカスされていない状態で ArrowUp を押すと末尾の選択可能なブランチへフォーカスする', () => {
      renderMenu({ branches: threeBranches })
      ;(document.activeElement as HTMLElement | null)?.blur()
      fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowUp' })
      expect(screen.getByRole('radio', { name: /feature\/y/ })).toHaveFocus()
    })

    it('ArrowDown で次のブランチへフォーカスが移動する', () => {
      renderMenu({ branches: threeBranches })
      screen.getByRole('radio', { name: /feature\/x/ }).focus()
      fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' })
      expect(screen.getByRole('radio', { name: /feature\/y/ })).toHaveFocus()
    })

    it('末尾で ArrowDown を押すと先頭(current を除く)へ循環する', () => {
      renderMenu({ branches: threeBranches })
      screen.getByRole('radio', { name: /feature\/y/ }).focus()
      fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' })
      expect(screen.getByRole('radio', { name: /feature\/x/ })).toHaveFocus()
    })

    it('先頭で ArrowUp を押すと末尾(current を除く)へ循環する', () => {
      renderMenu({ branches: threeBranches })
      screen.getByRole('radio', { name: /feature\/x/ }).focus()
      fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowUp' })
      expect(screen.getByRole('radio', { name: /feature\/y/ })).toHaveFocus()
    })

    it('選択可能なブランチが無い(current のみ)場合、矢印キーを押してもエラーにならない', () => {
      renderMenu({ branches: [{ name: 'main', current: true }] })
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
    it('初期状態では先頭の選択可能なブランチだけ tabIndex=0 で、他は -1', () => {
      renderMenu({ branches: threeBranches })
      expect(screen.getByRole('radio', { name: /feature\/x/ })).toHaveAttribute('tabIndex', '0')
      expect(screen.getByRole('radio', { name: /feature\/y/ })).toHaveAttribute('tabIndex', '-1')
    })

    it('矢印キーでフォーカスが移動すると、移動先だけ tabIndex=0 になる', () => {
      renderMenu({ branches: threeBranches })
      screen.getByRole('radio', { name: /feature\/x/ }).focus()
      fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' })
      expect(screen.getByRole('radio', { name: /feature\/y/ })).toHaveAttribute('tabIndex', '0')
      expect(screen.getByRole('radio', { name: /feature\/x/ })).toHaveAttribute('tabIndex', '-1')
    })
  })

  // PRレビュー指摘: BranchSwitcher のトリガーボタンはキーボードで開ける button
  // だが、開いた直後はフォーカスがトリガー側に残ったままで、実装済みの矢印キー
  // ナビゲーションがキーボードのみでは実質使えなかった(もう一段 Tab が必要)。
  // ExplorerContextMenu(右クリック起点、キーボードトリガー無し)とはフォーカス
  // 管理の要求が異なるため、新規に対応する
  describe('マウント時の初期フォーカス', () => {
    it('マウントすると先頭の選択可能なブランチへ自動的にフォーカスする', () => {
      renderMenu({ branches: threeBranches })
      expect(screen.getByRole('radio', { name: /feature\/x/ })).toHaveFocus()
    })

    // 選択可能なブランチが無い(現在ブランチだけ)ときは、唯一の操作である作成ボタンへ
    it('選択可能なブランチが無いとき、初期フォーカスは作成ボタン', () => {
      renderMenu({ branches: [{ name: 'main', current: true }] })
      expect(screen.getByRole('button', { name: '＋ 新しいブランチを作成…' })).toHaveFocus()
    })
  })
})

describe('BranchSwitcherMenu の作成・削除', () => {
  it('作成ボタンを押すと onCreateRequest が呼ばれる', async () => {
    const onCreateRequest = vi.fn()
    renderMenu({ onCreateRequest })
    await userEvent.click(screen.getByRole('button', { name: '＋ 新しいブランチを作成…' }))
    expect(onCreateRequest).toHaveBeenCalledOnce()
  })

  // 1行分の表示・操作(削除ボタンの有無・tabIndex・Delete キー・aria-keyshortcuts)は
  // BranchMenuItem.test.tsx で検証する。ここでは Menu が各行へ onDelete を配線していることだけを見る
  it('行の削除ボタンから onDelete がブランチ名で呼ばれる(BranchMenuItem への配線)', async () => {
    const onDelete = vi.fn()
    const onSelect = vi.fn()
    renderMenu({ onSelect, onDelete })
    await userEvent.click(screen.getByRole('button', { name: 'ブランチ feature/x を削除' }))
    expect(onDelete).toHaveBeenCalledWith('feature/x')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('行のマージボタンから onMerge がブランチ名で呼ばれる(BranchMenuItem への配線)', async () => {
    const onMerge = vi.fn()
    renderMenu({ onMerge })
    await userEvent.click(
      screen.getByRole('button', { name: 'ブランチ feature/x を現在のブランチにマージ' })
    )
    expect(onMerge).toHaveBeenCalledWith('feature/x')
  })
})
