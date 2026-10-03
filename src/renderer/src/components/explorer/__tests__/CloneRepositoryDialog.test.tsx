import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import CloneRepositoryDialog, {
  CLONE_BLOCKED_NOTICE,
  CLONE_OPENING_NOTICE,
  CLONE_RUNNING_NOTICE
} from '../CloneRepositoryDialog'

type Props = React.ComponentProps<typeof CloneRepositoryDialog>

function renderDialog(overrides: Partial<Props> = {}): {
  props: Props
  rerender: (next: Partial<Props>) => void
} {
  const props: Props = {
    isCloning: false,
    isBlocked: false,
    error: null,
    onSubmit: vi.fn(),
    onCancelClone: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  }
  const { rerender } = render(<CloneRepositoryDialog {...props} />)
  return {
    props,
    rerender: (next) => rerender(<CloneRepositoryDialog {...props} {...next} />)
  }
}

const urlInput = (): HTMLElement => screen.getByRole('textbox', { name: 'URL' })
const folderInput = (): HTMLElement => screen.getByRole('textbox', { name: 'フォルダ名' })
const submitButton = (): HTMLElement => screen.getByRole('button', { name: '保存先を選んで clone' })

describe('CloneRepositoryDialog', () => {
  it('モーダルとして開き、URL の入力欄にフォーカスがあり、空の入力は検証の文言を出して実行できない', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'リポジトリを clone' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription(
      '保存先の親フォルダを選ぶと、その中にフォルダを作って取得し、そのフォルダを開きます'
    )
    expect(urlInput()).toHaveFocus()
    expect(urlInput()).toHaveAccessibleDescription('URL を入力してください')
    expect(folderInput()).toHaveAccessibleDescription('フォルダ名を入力してください')
    expect(submitButton()).toBeDisabled()
  })

  it('URL を入力すると、末尾のリポジトリ名をフォルダ名の既定値にする', async () => {
    renderDialog()
    await userEvent.type(urlInput(), 'https://github.com/a/my-repo.git')
    expect(folderInput()).toHaveValue('my-repo')
    expect(urlInput()).toHaveAttribute('aria-invalid', 'false')
    expect(submitButton()).toBeEnabled()
  })

  it('フォルダ名を編集した後は、URL を変えても上書きしない', async () => {
    renderDialog()
    await userEvent.type(urlInput(), 'https://github.com/a/b.git')
    await userEvent.clear(folderInput())
    await userEvent.type(folderInput(), 'mine')
    await userEvent.clear(urlInput())
    await userEvent.type(urlInput(), 'https://github.com/a/other.git')
    expect(folderInput()).toHaveValue('mine')
  })

  it('URL とフォルダ名の規則違反を入力欄に結び付けて出し、実行できない', async () => {
    renderDialog()
    await userEvent.type(urlInput(), 'ext::sh')
    expect(urlInput()).toHaveAttribute('aria-invalid', 'true')
    expect(urlInput()).toHaveAccessibleDescription(
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    )
    await userEvent.type(folderInput(), 'a/b')
    expect(folderInput()).toHaveAccessibleDescription('フォルダ名に使えない文字が含まれています')
    expect(submitButton()).toBeDisabled()
  })

  it('実行すると、前後の空白を除いた URL とフォルダ名を渡す(Enter でも実行する)', async () => {
    const { props } = renderDialog()
    await userEvent.type(urlInput(), '  https://github.com/a/b.git  ')
    await userEvent.click(submitButton())
    expect(props.onSubmit).toHaveBeenCalledWith('https://github.com/a/b.git', 'b')
    await userEvent.type(folderInput(), '{Enter}')
    expect(props.onSubmit).toHaveBeenCalledTimes(2)
  })

  it('他の Git 操作の実行中は実行できず、理由を案内する', async () => {
    renderDialog({ isBlocked: true })
    await userEvent.type(urlInput(), 'https://github.com/a/b.git')
    expect(submitButton()).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(CLONE_BLOCKED_NOTICE)
  })

  describe('実行中', () => {
    it('入力と実行を止め、案内を出し、`キャンセル` だけは押せて clone を中止する', async () => {
      const { props } = renderDialog({ isCloning: true })
      expect(urlInput()).toBeDisabled()
      expect(folderInput()).toBeDisabled()
      expect(screen.getByRole('button', { name: 'clone 中…' })).toBeDisabled()
      expect(screen.getByRole('status')).toHaveTextContent(CLONE_RUNNING_NOTICE)
      expect(CLONE_RUNNING_NOTICE).toContain('60 秒')
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
      await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      expect(props.onCancelClone).toHaveBeenCalledOnce()
      expect(props.onClose).not.toHaveBeenCalled()
    })

    it('Escape・オーバーレイのクリックでは閉じない', async () => {
      const { props } = renderDialog({ isCloning: true })
      const dialog = screen.getByRole('dialog')
      fireEvent.keyDown(dialog, { key: 'Escape' })
      const overlay = dialog.parentElement as HTMLElement
      fireEvent.mouseDown(overlay)
      fireEvent.mouseUp(overlay)
      fireEvent.click(overlay)
      expect(props.onClose).not.toHaveBeenCalled()
      expect(props.onCancelClone).not.toHaveBeenCalled()
    })

    it('失敗が届いたら(実行中のままでも)案内と aria-busy を出さず、エラーを alert で出す', () => {
      renderDialog({ isCloning: true, error: new Error('リポジトリを clone できませんでした: x') })
      expect(screen.queryByText(CLONE_RUNNING_NOTICE)).not.toBeInTheDocument()
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'false')
      expect(screen.getByRole('alert')).toHaveTextContent('リポジトリを clone できませんでした: x')
    })

    it('Tab は押せる `キャンセル` に留まる', async () => {
      renderDialog({ isCloning: true })
      await userEvent.tab()
      expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus()
      await userEvent.tab()
      expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus()
    })
  })

  describe('閉じる経路(実行中でないとき)', () => {
    it('`キャンセル`・Escape・オーバーレイで押して離したときに閉じる', async () => {
      const { props } = renderDialog()
      await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      const overlay = screen.getByRole('dialog').parentElement as HTMLElement
      fireEvent.mouseDown(overlay)
      fireEvent.mouseUp(overlay)
      fireEvent.click(overlay)
      expect(props.onClose).toHaveBeenCalledTimes(3)
      expect(props.onCancelClone).not.toHaveBeenCalled()
    })

    it('入力欄で押してオーバーレイで離しても閉じない', () => {
      const { props } = renderDialog()
      const overlay = screen.getByRole('dialog').parentElement as HTMLElement
      fireEvent.mouseDown(urlInput())
      fireEvent.mouseUp(overlay)
      fireEvent.click(overlay)
      expect(props.onClose).not.toHaveBeenCalled()
    })

    it('IME の変換を取り消す Escape では閉じない', () => {
      const { props } = renderDialog()
      fireEvent.keyDown(urlInput(), { key: 'Escape', isComposing: true })
      expect(props.onClose).not.toHaveBeenCalled()
    })

    it('説明の文字をクリックした後も Escape で閉じる', async () => {
      const { props } = renderDialog()
      await userEvent.click(
        screen.getByText(
          '保存先の親フォルダを選ぶと、その中にフォルダを作って取得し、そのフォルダを開きます'
        )
      )
      expect(screen.getByRole('dialog')).toHaveFocus()
      await userEvent.keyboard('{Escape}')
      expect(props.onClose).toHaveBeenCalledOnce()
    })

    it('Tab / Shift+Tab はダイアログの中で循環する', async () => {
      renderDialog()
      await userEvent.type(urlInput(), 'https://github.com/a/b.git')
      await userEvent.tab()
      expect(folderInput()).toHaveFocus()
      await userEvent.tab()
      expect(submitButton()).toHaveFocus()
      await userEvent.tab()
      expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus()
      await userEvent.tab()
      expect(urlInput()).toHaveFocus()
      await userEvent.tab({ shift: true })
      expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus()
    })
  })

  describe('フォーカス', () => {
    it('実行が始まったら `キャンセル` へ、失敗・中止で解けたら URL の入力欄へ移す', async () => {
      const { rerender } = renderDialog()
      await userEvent.type(urlInput(), 'https://github.com/a/b.git')
      await userEvent.click(submitButton())
      rerender({ isCloning: true })
      expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus()
      rerender({ isCloning: false })
      expect(urlInput()).toHaveFocus()
      // 入力は保持する
      expect(urlInput()).toHaveValue('https://github.com/a/b.git')
      expect(folderInput()).toHaveValue('b')
    })

    it('実行中にダイアログの外へ移したフォーカスは奪わない', () => {
      const outside = document.createElement('button')
      document.body.appendChild(outside)
      const { rerender } = renderDialog({ isCloning: true })
      outside.focus()
      rerender({ isCloning: false })
      expect(outside).toHaveFocus()
      outside.remove()
    })
  })

  // clone が終わってフォルダを読み込んでいる間(isOpening)は、main に中止する clone が無い。中止の案内を出さず、
  // `キャンセル` も押せなくする
  describe('フォルダを開いている間(isOpening)', () => {
    it('案内を「フォルダを開いています…」に切り替え、キャンセルを押せなくする', () => {
      const { props } = renderDialog({ isCloning: true, isOpening: true })
      expect(screen.getByRole('status')).toHaveTextContent(CLONE_OPENING_NOTICE)
      expect(screen.queryByText(CLONE_RUNNING_NOTICE)).not.toBeInTheDocument()
      const cancel = screen.getByRole('button', { name: 'キャンセル' })
      expect(cancel).toBeDisabled()
      fireEvent.click(cancel)
      expect(props.onCancelClone).not.toHaveBeenCalled()
      expect(props.onClose).not.toHaveBeenCalled()
    })

    it('clone の実行中(isOpening でない)は、従来どおり中止の案内を出し、キャンセルで中止を依頼する', async () => {
      const { props } = renderDialog({ isCloning: true, isOpening: false })
      expect(screen.getByRole('status')).toHaveTextContent(CLONE_RUNNING_NOTICE)
      const cancel = screen.getByRole('button', { name: 'キャンセル' })
      expect(cancel).toBeEnabled()
      await userEvent.click(cancel)
      expect(props.onCancelClone).toHaveBeenCalledOnce()
    })

    // `キャンセル` が disabled になると、ブラウザはそこにあったフォーカスを body に落とす(パターン 86)。ダイアログの外へ
    // 出さないよう、フォーム(tabIndex=-1)へ移す(パターン 97)
    it('開き始めたとき、キャンセルにあったフォーカスをダイアログ(フォーム)へ移す', () => {
      const { rerender } = renderDialog({ isCloning: false })
      rerender({ isCloning: true })
      expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus()
      rerender({ isCloning: true, isOpening: true })
      expect(screen.getByRole('dialog')).toHaveFocus()
    })

    it('開き始めたとき、ダイアログの外へ移したフォーカスは奪わない', () => {
      const outside = document.createElement('button')
      document.body.appendChild(outside)
      try {
        const { rerender } = renderDialog({ isCloning: true })
        outside.focus()
        rerender({ isCloning: true, isOpening: true })
        expect(outside).toHaveFocus()
      } finally {
        outside.remove()
      }
    })
  })
})
