import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import RemoteSetupInputDialog from '../RemoteSetupInputDialog'

type Props = ComponentProps<typeof RemoteSetupInputDialog>

const makeProps = (overrides: Partial<Props> = {}): Props => ({
  title: 'ダイアログ',
  description: '説明',
  label: '値',
  initialValue: 'main',
  submitLabel: '実行',
  runningSubmitLabel: '実行中...',
  runningNotice: '実行中です',
  normalize: (value) => value.trim(),
  validate: (value) => (value === '' ? '値を入力してください' : null),
  isRunning: false,
  isBlocked: false,
  error: null,
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
  ...overrides
})

const renderDialog = (
  overrides: Partial<Props> = {}
): Props & { container: HTMLElement; rerenderWith: (next: Partial<Props>) => void } => {
  const props = makeProps(overrides)
  const { container, rerender } = render(<RemoteSetupInputDialog {...props} />)
  const rerenderWith = (next: Partial<Props>): void =>
    rerender(<RemoteSetupInputDialog {...props} {...next} />)
  return { ...props, container, rerenderWith }
}
const input = (): HTMLInputElement => screen.getByRole('textbox', { name: '値' })
const submitButton = (): HTMLElement => screen.getByRole('button', { name: '実行' })

// 初期化・リモートの追加のダイアログの共通部分(タグの作成のダイアログと同じ扱い。パターン 85・86・87)
describe('RemoteSetupInputDialog', () => {
  it('開くと見出し・説明があり、入力欄にフォーカスがあって初期値が全選択されている', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'ダイアログ' })).toHaveAccessibleDescription('説明')
    expect(input()).toHaveFocus()
    expect(input()).toHaveValue('main')
    expect(input().selectionStart).toBe(0)
    expect(input().selectionEnd).toBe(4)
  })

  it('検証エラーは入力欄の説明として表示し、実行ボタンを disabled にする', async () => {
    renderDialog()
    await userEvent.clear(input())
    expect(input()).toHaveAccessibleDescription('値を入力してください')
    expect(input()).toHaveAttribute('aria-invalid', 'true')
    expect(submitButton()).toBeDisabled()
  })

  it('正規化した値で onSubmit を呼ぶ(Enter でも送る)', async () => {
    const props = renderDialog()
    await userEvent.clear(input())
    await userEvent.type(input(), '  feat  {Enter}')
    expect(props.onSubmit).toHaveBeenCalledWith('feat')
  })

  it('他の操作中(isBlocked)は実行ボタンが disabled で、Enter でも送らない', async () => {
    const props = renderDialog({ isBlocked: true })
    expect(submitButton()).toBeDisabled()
    await userEvent.type(input(), '{Enter}')
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  describe('実行中', () => {
    it('ボタンは実行中の文言で disabled、入力とキャンセルも disabled、案内(status)と aria-busy を出す', () => {
      renderDialog({ isRunning: true })
      expect(screen.getByRole('button', { name: '実行中...' })).toBeDisabled()
      expect(input()).toBeDisabled()
      expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled()
      expect(screen.getByRole('status')).toHaveTextContent('実行中です')
      expect(screen.getByRole('dialog', { name: 'ダイアログ' })).toHaveAttribute(
        'aria-busy',
        'true'
      )
    })

    // 失敗の直後(取り直しの間は isRunning が true のままエラーが入る)に、案内と alert を重ねない(パターン 87)
    it('エラーがあれば、実行中でも案内と aria-busy を出さず alert だけ出す', () => {
      renderDialog({ isRunning: true, error: new Error('失敗しました') })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('失敗しました')
      expect(screen.getByRole('dialog', { name: 'ダイアログ' })).not.toHaveAttribute(
        'aria-busy',
        'true'
      )
    })

    // 閉じると、遅れて届いた失敗の行き先が無くなる(パターン 85)
    it('キャンセル・Escape・オーバーレイのクリックで閉じない', async () => {
      const props = renderDialog({ isRunning: true })
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      fireEvent.keyDown(input(), { key: 'Escape', isComposing: false })
      await userEvent.click(props.container.querySelector('.name-input-dialog__overlay')!)
      expect(props.onCancel).not.toHaveBeenCalled()
    })

    it.each([
      ['実行中(isRunning)', { isRunning: true }],
      ['他の操作中(isBlocked)', { isBlocked: true }]
    ] as Array<[string, Partial<Props>]>)(
      '%sは、submit イベントが直接来ても onSubmit を呼ばない',
      (_label, overrides) => {
        const props = renderDialog(overrides)
        fireEvent.submit(screen.getByRole('dialog', { name: 'ダイアログ' }))
        expect(props.onSubmit).not.toHaveBeenCalled()
      }
    )
  })

  it('失敗は role="alert" で表示する', () => {
    renderDialog({ error: new Error('リモート origin は既に設定されています') })
    expect(screen.getByRole('alert')).toHaveTextContent('リモート origin は既に設定されています')
  })

  it('キャンセル・Escape・オーバーレイのクリックで onCancel を呼び、ダイアログの中のクリックでは呼ばない', async () => {
    const props = renderDialog()
    await userEvent.click(screen.getByRole('dialog', { name: 'ダイアログ' }))
    expect(props.onCancel).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(props.container.querySelector('.name-input-dialog__overlay')!)
    expect(props.onCancel).toHaveBeenCalledTimes(3)
  })

  // 長い URL のドラッグ選択など: 入力欄で押してオーバーレイで離すと、Chromium は共通の祖先(オーバーレイ)へ click を
  // 送る。フォームの stopPropagation はこの経路に入らないため、押したのもオーバーレイのときだけ閉じる
  it('入力欄で押してオーバーレイで離しても onCancel を呼ばず、入力が残る', () => {
    const props = renderDialog()
    const overlay = props.container.querySelector('.name-input-dialog__overlay')!
    fireEvent.change(input(), { target: { value: 'https://example.com/long/url.git' } })
    fireEvent.mouseDown(input())
    fireEvent.mouseUp(overlay)
    fireEvent.click(overlay)
    expect(props.onCancel).not.toHaveBeenCalled()
    expect(input()).toHaveValue('https://example.com/long/url.git')
  })

  // 逆向き: オーバーレイで押して入力欄で離しても、click は共通の祖先(オーバーレイ)へ届く。離したのも
  // オーバーレイのときだけ閉じる(jsdom は click の target を決めないため、click はオーバーレイに送る)
  it('オーバーレイで押して入力欄で離しても onCancel を呼ばず、入力が残る', () => {
    const props = renderDialog()
    const overlay = props.container.querySelector('.name-input-dialog__overlay')!
    fireEvent.change(input(), { target: { value: 'https://example.com/long/url.git' } })
    fireEvent.mouseDown(overlay)
    fireEvent.mouseUp(input())
    fireEvent.click(overlay)
    expect(props.onCancel).not.toHaveBeenCalled()
    expect(input()).toHaveValue('https://example.com/long/url.git')
  })

  it('オーバーレイで押して離すと onCancel を呼ぶ', () => {
    const props = renderDialog()
    const overlay = props.container.querySelector('.name-input-dialog__overlay')!
    fireEvent.mouseDown(overlay)
    fireEvent.mouseUp(overlay)
    fireEvent.click(overlay)
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('実行中は、オーバーレイで押して離しても onCancel を呼ばない', () => {
    const props = renderDialog({ isRunning: true })
    const overlay = props.container.querySelector('.name-input-dialog__overlay')!
    fireEvent.mouseDown(overlay)
    fireEvent.mouseUp(overlay)
    fireEvent.click(overlay)
    expect(props.onCancel).not.toHaveBeenCalled()
  })

  it('IME の変換中の Escape では onCancel を呼ばない', () => {
    const props = renderDialog()
    fireEvent.keyDown(input(), { key: 'Escape', isComposing: true })
    expect(props.onCancel).not.toHaveBeenCalled()
    fireEvent.keyDown(input(), { key: 'Escape', isComposing: false })
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  // 実行中は入力欄が disabled になり、ブラウザはフォーカスを body に落とす。失敗して実行中が解けたら、
  // Escape がフォームに届くよう入力欄へ戻す(body かダイアログ内にフォーカスがある場合だけ。パターン 86)。
  // 外のフォーカスを奪わないこと・実行中を経ていない描画で何もしないことは useFocusOnRunningEnd のテストで確かめる。
  // ここは配線(戻す先が入力欄で、ダイアログのフォームを「中」とする)だけ
  describe('実行が終わったときのフォーカス', () => {
    it('isRunning が true→false になったとき、フォーカスが body にあれば入力欄へ戻す', () => {
      const { rerenderWith } = renderDialog({ isRunning: true })
      ;(document.activeElement as HTMLElement | null)?.blur()
      expect(document.body).toHaveFocus()
      rerenderWith({ isRunning: false })
      expect(input()).toHaveFocus()
    })

    // jsdom は disabled になった要素からフォーカスを外さないため、実行中に disabled になったキャンセルに
    // フォーカスが残った状態(ダイアログ内)を作れる
    it('ダイアログ内(実行中に disabled になったキャンセル)にあるフォーカスも入力欄へ戻す', () => {
      const { rerenderWith } = renderDialog()
      act(() => screen.getByRole('button', { name: 'キャンセル' }).focus())
      rerenderWith({ isRunning: true })
      rerenderWith({ isRunning: false })
      expect(input()).toHaveFocus()
    })
  })

  // 背後の画面(コミット欄・ツールバー)へフォーカスを出さない。循環の細部(disabled・tabindex=-1・IME・外から入る)は
  // useDialogFocusTrap のテストで確かめる。ここは配線(aria-modal と、ダイアログのフォームを範囲にすること)
  describe('モーダル', () => {
    const renderWithBackground = (overrides: Partial<Props> = {}): void => {
      render(
        <>
          <textarea aria-label="背後のコミット欄" />
          <RemoteSetupInputDialog {...makeProps(overrides)} />
          <button type="button">背後のツールバー</button>
        </>
      )
    }
    const cancelButton = (): HTMLElement => screen.getByRole('button', { name: 'キャンセル' })

    it('aria-modal="true" のダイアログとして扱う', () => {
      renderDialog()
      expect(screen.getByRole('dialog', { name: 'ダイアログ' })).toHaveAttribute(
        'aria-modal',
        'true'
      )
    })

    it('Tab を押し続けても、入力欄・実行・キャンセルを循環して背後へ出ない', async () => {
      renderWithBackground()
      expect(input()).toHaveFocus()
      await userEvent.tab()
      expect(submitButton()).toHaveFocus()
      await userEvent.tab()
      expect(cancelButton()).toHaveFocus()
      await userEvent.tab()
      expect(input()).toHaveFocus()
    })

    it('Shift+Tab を押し続けても、逆順に循環して背後へ出ない', async () => {
      renderWithBackground()
      await userEvent.tab({ shift: true })
      expect(cancelButton()).toHaveFocus()
      await userEvent.tab({ shift: true })
      expect(submitButton()).toHaveFocus()
      await userEvent.tab({ shift: true })
      expect(input()).toHaveFocus()
    })

    // 実行中は入力欄・実行・キャンセルがすべて disabled になる。Tab でダイアログ自体に留める
    it('実行中に Tab を押しても、背後へ出ずダイアログに留まる', async () => {
      renderWithBackground({ isRunning: true })
      ;(document.activeElement as HTMLElement | null)?.blur()
      await userEvent.tab()
      expect(screen.getByRole('dialog', { name: 'ダイアログ' })).toHaveFocus()
    })
  })
})
