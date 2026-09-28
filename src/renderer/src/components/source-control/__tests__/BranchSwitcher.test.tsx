import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { GitBranch } from '@shared/types'
import BranchSwitcher from '../BranchSwitcher'

const branches: GitBranch[] = [
  { name: 'main', current: true },
  { name: 'feature/x', current: false }
]

const baseProps = {
  currentBranch: 'main' as string | null,
  branches,
  isCheckingOut: false,
  isBlocked: false,
  onCheckoutBranch: vi.fn().mockResolvedValue(undefined)
}

describe('BranchSwitcher', () => {
  it('現在のブランチ名がトリガーボタンに表示される', () => {
    render(<BranchSwitcher {...baseProps} />)
    expect(screen.getByRole('button', { name: 'ブランチを切り替え' })).toHaveTextContent('main')
  })

  it('branch が null のとき "(no branch)" が表示される', () => {
    render(<BranchSwitcher {...baseProps} currentBranch={null} />)
    expect(screen.getByRole('button', { name: 'ブランチを切り替え' })).toHaveTextContent(
      '(no branch)'
    )
  })

  it('初期状態ではブランチ一覧は表示されていない', () => {
    render(<BranchSwitcher {...baseProps} />)
    expect(screen.queryByRole('radiogroup', { name: 'ブランチ' })).not.toBeInTheDocument()
  })

  it('トリガーボタンをクリックするとブランチ一覧が表示される', async () => {
    render(<BranchSwitcher {...baseProps} />)
    await userEvent.click(screen.getByRole('button', { name: 'ブランチを切り替え' }))
    expect(screen.getByRole('radiogroup', { name: 'ブランチ' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /feature\/x/ })).toBeInTheDocument()
  })

  it('現在以外のブランチを選択すると onCheckoutBranch が呼ばれ、一覧が閉じる', async () => {
    const onCheckoutBranch = vi.fn().mockResolvedValue(undefined)
    render(<BranchSwitcher {...baseProps} onCheckoutBranch={onCheckoutBranch} />)
    await userEvent.click(screen.getByRole('button', { name: 'ブランチを切り替え' }))
    await userEvent.click(screen.getByRole('radio', { name: /feature\/x/ }))
    expect(onCheckoutBranch).toHaveBeenCalledWith('feature/x')
    expect(screen.queryByRole('radiogroup', { name: 'ブランチ' })).not.toBeInTheDocument()
  })

  it('isCheckingOut が true のときトリガーボタンが disabled になり、表示テキストが「切り替え中...」になる', () => {
    render(<BranchSwitcher {...baseProps} isCheckingOut={true} />)
    const button = screen.getByRole('button', { name: 'ブランチ切り替え中' })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('切り替え中...')
  })

  it('isCheckingOut が true のとき aria-label も「ブランチ切り替え中」に変わる(旧ラベルではヒットしない)', () => {
    render(<BranchSwitcher {...baseProps} isCheckingOut={true} />)
    expect(screen.queryByRole('button', { name: 'ブランチを切り替え' })).not.toBeInTheDocument()
  })

  it('isCheckingOut が true のときトリガーボタンをクリックしてもポップオーバーは開かない', async () => {
    render(<BranchSwitcher {...baseProps} isCheckingOut={true} />)
    await userEvent.click(screen.getByRole('button', { name: 'ブランチ切り替え中' }))
    expect(screen.queryByRole('radiogroup', { name: 'ブランチ' })).not.toBeInTheDocument()
  })

  // コードレビュー指摘: push/pull ボタン(SourceControlToolbar)は他操作中に
  // disabled になり押せないが、トリガーボタンは isCheckingOut のみで判定して
  // いたため、他操作(pull/commit/ハンク操作等)中にクリックしても
  // useRunExclusiveGitOperation の isBusy() でサイレントに no-op になり、
  // ユーザーには「押したのに何も起きない」としか見えなかった
  it('isBlocked が true のときトリガーボタンが disabled になり、aria-label が理由を示す', () => {
    render(<BranchSwitcher {...baseProps} isBlocked={true} />)
    const button = screen.getByRole('button', {
      name: '他の操作が完了するまでブランチを切り替えられません'
    })
    expect(button).toBeDisabled()
    // 表示テキスト自体は現在のブランチ名のまま(切り替え中ではないため)
    expect(button).toHaveTextContent('main')
  })

  it('isBlocked が true のときトリガーボタンをクリックしてもポップオーバーは開かない', async () => {
    render(<BranchSwitcher {...baseProps} isBlocked={true} />)
    await userEvent.click(
      screen.getByRole('button', { name: '他の操作が完了するまでブランチを切り替えられません' })
    )
    expect(screen.queryByRole('radiogroup', { name: 'ブランチ' })).not.toBeInTheDocument()
  })

  it('isBlocked が false かつ isCheckingOut が false のときは通常どおり操作できる', () => {
    render(<BranchSwitcher {...baseProps} isBlocked={false} />)
    expect(screen.getByRole('button', { name: 'ブランチを切り替え' })).not.toBeDisabled()
  })

  // PRレビュー指摘: トリガーボタンはキーボードで開けるが、閉じたときに
  // フォーカスがトリガーへ戻らずメニューの各ボタンごと消えて body に落ちて
  // いたため、キーボードユーザーが操作の起点を見失っていた
  describe('閉じたときのフォーカス復帰', () => {
    it('現在以外のブランチを選択して閉じると、トリガーボタンへフォーカスが戻る', async () => {
      render(<BranchSwitcher {...baseProps} />)
      await userEvent.click(screen.getByRole('button', { name: 'ブランチを切り替え' }))
      await userEvent.click(screen.getByRole('radio', { name: /feature\/x/ }))
      expect(screen.getByRole('button', { name: 'ブランチを切り替え' })).toHaveFocus()
    })

    it('Escape キーで閉じると、トリガーボタンへフォーカスが戻る', async () => {
      render(<BranchSwitcher {...baseProps} />)
      await userEvent.click(screen.getByRole('button', { name: 'ブランチを切り替え' }))
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.getByRole('button', { name: 'ブランチを切り替え' })).toHaveFocus()
    })

    it('外側クリックで閉じた場合は、クリック先の要素からトリガーボタンへフォーカスを奪わない', async () => {
      render(
        <div>
          <button type="button">外側の別ボタン</button>
          <BranchSwitcher {...baseProps} />
        </div>
      )
      await userEvent.click(screen.getByRole('button', { name: 'ブランチを切り替え' }))
      const outsideButton = screen.getByRole('button', { name: '外側の別ボタン' })
      outsideButton.focus()
      fireEvent.click(outsideButton)
      expect(outsideButton).toHaveFocus()
      expect(screen.getByRole('button', { name: 'ブランチを切り替え' })).not.toHaveFocus()
    })
  })
})
