import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { GitBranch } from '@shared/types'
import type { BranchOperationKind } from '../../../types'
import BranchSwitcher from '../BranchSwitcher'

const branches: GitBranch[] = [
  { name: 'main', current: true },
  { name: 'feature/x', current: false }
]

const baseProps = {
  currentBranch: 'main' as string | null,
  branches,
  pendingBranchOperation: null as BranchOperationKind | null,
  isBlocked: false,
  onCheckoutBranch: vi.fn().mockResolvedValue(undefined),
  onCreateBranch: vi.fn().mockResolvedValue(true),
  onDeleteBranch: vi.fn().mockResolvedValue(true),
  onMergeBranch: vi.fn().mockResolvedValue(undefined)
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

  it('pendingBranchOperation が checkout のときトリガーボタンが disabled になり、表示テキストが「切り替え中...」になる', () => {
    render(<BranchSwitcher {...baseProps} pendingBranchOperation="checkout" />)
    const button = screen.getByRole('button', { name: 'ブランチ切り替え中' })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('切り替え中...')
  })

  it('pendingBranchOperation が checkout のとき aria-label も「ブランチ切り替え中」に変わる(旧ラベルではヒットしない)', () => {
    render(<BranchSwitcher {...baseProps} pendingBranchOperation="checkout" />)
    expect(screen.queryByRole('button', { name: 'ブランチを切り替え' })).not.toBeInTheDocument()
  })

  it('pendingBranchOperation が checkout のときトリガーボタンをクリックしてもポップオーバーは開かない', async () => {
    render(<BranchSwitcher {...baseProps} pendingBranchOperation="checkout" />)
    await userEvent.click(screen.getByRole('button', { name: 'ブランチ切り替え中' }))
    expect(screen.queryByRole('radiogroup', { name: 'ブランチ' })).not.toBeInTheDocument()
  })

  it.each([
    ['create', '作成中...', 'ブランチ作成中'],
    ['delete', '削除中...', 'ブランチ削除中']
  ] as const)(
    'pendingBranchOperation が %s のとき表示テキストと aria-label が同期し、disabled になる',
    (kind, text, aria) => {
      render(<BranchSwitcher {...baseProps} pendingBranchOperation={kind} />)
      const trigger = screen.getByRole('button', { name: aria })
      expect(trigger).toHaveTextContent(text)
      expect(trigger).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'ブランチを切り替え' })).not.toBeInTheDocument()
    }
  )

  // コードレビュー指摘: push/pull ボタン(SourceControlToolbar)は他操作中に
  // disabled になり押せないが、トリガーボタンは pendingBranchOperation のみで判定して
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

  it('isBlocked が false かつ pendingBranchOperation が null のときは通常どおり操作できる', () => {
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

  it('作成ボタンでメニューが閉じ、入力ダイアログが開く', async () => {
    render(<BranchSwitcher {...baseProps} />)
    await userEvent.click(screen.getByRole('button', { name: 'ブランチを切り替え' }))
    await userEvent.click(screen.getByRole('button', { name: '＋ 新しいブランチを作成…' }))
    expect(screen.queryByRole('radiogroup', { name: 'ブランチ' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '新しいブランチ名' })).toBeInTheDocument()
  })

  it('入力して OK を押すと onCreateBranch が呼ばれ、ダイアログが閉じてトリガーへフォーカスが戻る', async () => {
    const onCreateBranch = vi.fn().mockResolvedValue(true)
    render(<BranchSwitcher {...baseProps} onCreateBranch={onCreateBranch} />)
    const trigger = screen.getByRole('button', { name: 'ブランチを切り替え' })
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: '＋ 新しいブランチを作成…' }))
    await userEvent.type(screen.getByRole('textbox', { name: '名前' }), 'feature/new')
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onCreateBranch).toHaveBeenCalledWith('feature/new')
    expect(screen.queryByRole('dialog', { name: '新しいブランチ名' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('既存のブランチ名はダイアログ内でエラーになり、onCreateBranch は呼ばれない', async () => {
    const onCreateBranch = vi.fn().mockResolvedValue(true)
    render(<BranchSwitcher {...baseProps} onCreateBranch={onCreateBranch} />)
    await userEvent.click(screen.getByRole('button', { name: 'ブランチを切り替え' }))
    await userEvent.click(screen.getByRole('button', { name: '＋ 新しいブランチを作成…' }))
    await userEvent.type(screen.getByRole('textbox', { name: '名前' }), 'feature/x')
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.getByRole('alert')).toHaveTextContent('同じ名前のブランチが既に存在します')
    expect(onCreateBranch).not.toHaveBeenCalled()
  })

  it.each([
    [
      'キャンセルボタン',
      async () => userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    ],
    ['Escape キー', async () => userEvent.keyboard('{Escape}')]
  ])('%s でダイアログを閉じるとトリガーへフォーカスが戻る', async (_label, close) => {
    const onCreateBranch = vi.fn().mockResolvedValue(true)
    render(<BranchSwitcher {...baseProps} onCreateBranch={onCreateBranch} />)
    const trigger = screen.getByRole('button', { name: 'ブランチを切り替え' })
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: '＋ 新しいブランチを作成…' }))
    await close()
    expect(screen.queryByRole('dialog', { name: '新しいブランチ名' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(onCreateBranch).not.toHaveBeenCalled()
  })

  it('選択でメニューが閉じ、トリガーへフォーカスが戻り、onCheckoutBranch が呼ばれる', async () => {
    const onCheckoutBranch = vi.fn().mockResolvedValue(undefined)
    render(<BranchSwitcher {...baseProps} onCheckoutBranch={onCheckoutBranch} />)
    const trigger = screen.getByRole('button', { name: 'ブランチを切り替え' })
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('radio', { name: /feature\/x/ }))
    expect(onCheckoutBranch).toHaveBeenCalledWith('feature/x')
    expect(screen.queryByRole('radiogroup', { name: 'ブランチ' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('削除ボタンでメニューが閉じ、トリガーへフォーカスが戻り、onDeleteBranch が呼ばれる', async () => {
    const onDeleteBranch = vi.fn().mockResolvedValue(true)
    render(<BranchSwitcher {...baseProps} onDeleteBranch={onDeleteBranch} />)
    const trigger = screen.getByRole('button', { name: 'ブランチを切り替え' })
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'ブランチ feature/x を削除' }))
    expect(onDeleteBranch).toHaveBeenCalledWith('feature/x')
    expect(screen.queryByRole('radiogroup', { name: 'ブランチ' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('マージボタンでメニューが閉じ、トリガーへフォーカスが戻り、onMergeBranch が呼ばれる', async () => {
    const onMergeBranch = vi.fn().mockResolvedValue(undefined)
    render(<BranchSwitcher {...baseProps} onMergeBranch={onMergeBranch} />)
    const trigger = screen.getByRole('button', { name: 'ブランチを切り替え' })
    await userEvent.click(trigger)
    await userEvent.click(
      screen.getByRole('button', { name: 'ブランチ feature/x を現在のブランチにマージ' })
    )
    expect(onMergeBranch).toHaveBeenCalledWith('feature/x')
    expect(screen.queryByRole('radiogroup', { name: 'ブランチ' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('マージ実行中はトリガーが「マージ中...」になり、aria-label が「ブランチのマージ中」になる', () => {
    render(<BranchSwitcher {...baseProps} pendingBranchOperation="merge" />)
    const trigger = screen.getByRole('button', { name: 'ブランチのマージ中' })
    expect(trigger).toHaveTextContent('マージ中...')
    expect(trigger).toBeDisabled()
  })
})
