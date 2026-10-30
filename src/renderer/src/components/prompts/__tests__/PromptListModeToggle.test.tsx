import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { makePromptListModePanelState } from '../../../__tests__/makePromptListModePanelState'
import PromptListModeToggle from '../PromptListModeToggle'

const toggle = (): HTMLElement => screen.getByRole('button', { name: '編集モード' })

describe('PromptListModeToggle', () => {
  it('編集モードでは文言が「編集モード: オン」で aria-pressed=true(文言は現在の状態。L-511)', () => {
    render(<PromptListModeToggle state={makePromptListModePanelState({ mode: 'edit' })} />)
    expect(toggle()).toHaveTextContent('編集モード: オン')
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(toggle()).toBeEnabled()
    expect(toggle()).toHaveAttribute('type', 'button')
  })

  it('表示モードでは文言が「編集モード: オフ」で aria-pressed=false(ラベルは固定。L-154・L-497)', () => {
    render(<PromptListModeToggle state={makePromptListModePanelState({ mode: 'view' })} />)
    expect(toggle()).toHaveTextContent('編集モード: オフ')
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(toggle()).toHaveAttribute('aria-label', '編集モード')
  })

  it('読み込み中(mode が null)は押せず、文言は「編集モード: オフ」で aria-pressed=false', async () => {
    const onChange = vi.fn()
    render(<PromptListModeToggle state={makePromptListModePanelState({ mode: null, onChange })} />)
    expect(toggle()).toBeDisabled()
    expect(toggle()).toHaveTextContent('編集モード: オフ')
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('編集モードで押すと onChange に表示モードを渡す', async () => {
    const onChange = vi.fn()
    render(
      <PromptListModeToggle state={makePromptListModePanelState({ mode: 'edit', onChange })} />
    )
    await userEvent.click(toggle())
    expect(onChange).toHaveBeenCalledExactlyOnceWith('view')
  })

  it('表示モードで押すと onChange に編集モードを渡す', async () => {
    const onChange = vi.fn()
    render(
      <PromptListModeToggle state={makePromptListModePanelState({ mode: 'view', onChange })} />
    )
    await userEvent.click(toggle())
    expect(onChange).toHaveBeenCalledExactlyOnceWith('edit')
  })

  it('保存の途中は aria-disabled=true で、押しても onChange を呼ばず、disabled にしない(フォーカスを残す。L-157)', async () => {
    const onChange = vi.fn()
    render(
      <PromptListModeToggle
        state={makePromptListModePanelState({ mode: 'view', isSaving: true, onChange })}
      />
    )
    expect(toggle()).toHaveAttribute('aria-disabled', 'true')
    expect(toggle()).not.toHaveAttribute('disabled')
    // 楽観的に切り替わった後のモードのまま表示する
    expect(toggle()).toHaveTextContent('編集モード: オフ')
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle())
    expect(onChange).not.toHaveBeenCalled()
  })

  // Enter・Space の押しっぱなしで keydown のリピートごとに click が合成されると、保存が終わった直後のリピートが
  // 新しい操作として通り、モードが往復して編集フォームの破棄が繰り返される。リピートの keydown は押さない(実行ボタンと同じ)
  it.each(['Enter', ' '])(
    'トグルへのキーリピートの %j の keydown は既定の動作(押す)を止める。最初の keydown は止めない',
    (key) => {
      render(<PromptListModeToggle state={makePromptListModePanelState({ mode: 'edit' })} />)
      expect(fireEvent.keyDown(toggle(), { key, repeat: true })).toBe(false)
      expect(fireEvent.keyDown(toggle(), { key })).toBe(true)
      expect(fireEvent.keyDown(toggle(), { key: 'a', repeat: true })).toBe(true)
    }
  )

  it('保存の途中でなければ aria-disabled を付けない', () => {
    render(<PromptListModeToggle state={makePromptListModePanelState({ isSaving: false })} />)
    expect(toggle()).not.toHaveAttribute('aria-disabled')
  })

  it('保存の途中でも読み込み中(mode が null)は disabled のまま', () => {
    render(
      <PromptListModeToggle state={makePromptListModePanelState({ mode: null, isSaving: true })} />
    )
    expect(toggle()).toBeDisabled()
  })

  it('保存の失敗の文言を aria-live の段落に出す', () => {
    const { container } = render(
      <PromptListModeToggle
        state={makePromptListModePanelState({
          saveError: 'モードの設定を保存できませんでした: 理由'
        })}
      />
    )
    const message = container.querySelector('.prompts-panel__mode-error')
    expect(message).toHaveAttribute('aria-live', 'polite')
    expect(message).toHaveTextContent('モードの設定を保存できませんでした: 理由')
    // 既存のテストが前提にする「画面の status は送信やマージの通知だけ」を崩さない
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('失敗が無くても aria-live の段落は空で置いておき、文言が出ても同じ要素を使う(常設。L-153)', () => {
    const { container, rerender } = render(
      <PromptListModeToggle state={makePromptListModePanelState({ saveError: null })} />
    )
    const status = container.querySelector('.prompts-panel__mode-error')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toBeEmptyDOMElement()
    rerender(
      <PromptListModeToggle
        state={makePromptListModePanelState({
          saveError: 'モードの設定を保存できませんでした: 理由'
        })}
      />
    )
    expect(container.querySelector('.prompts-panel__mode-error')).toBe(status)
    expect(status).toHaveTextContent('モードの設定を保存できませんでした: 理由')
  })
})
