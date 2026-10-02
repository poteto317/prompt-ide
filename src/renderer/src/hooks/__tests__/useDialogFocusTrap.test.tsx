import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { useDialogFocusTrap } from '../useDialogFocusTrap'

// 実際の DOM のフォーカスを見るため、renderHook ではなく小さな部品で使う
function Harness({
  isOpen = true,
  isRunning = false,
  submitDisabled = false,
  empty = false
}: {
  isOpen?: boolean
  isRunning?: boolean
  submitDisabled?: boolean
  empty?: boolean
}): React.JSX.Element {
  const containerRef = useRef<HTMLFormElement>(null)
  useDialogFocusTrap(containerRef, isOpen)
  return (
    <>
      <button type="button">前の外</button>
      <form ref={containerRef} aria-label="ダイアログ">
        {!empty && (
          <>
            <input aria-label="入力欄" disabled={isRunning} />
            <button type="button" disabled>
              無効
            </button>
            <button type="button" tabIndex={-1}>
              Tab では移らない
            </button>
            <button type="button" disabled={isRunning}>
              キャンセル
            </button>
            <button type="submit" disabled={isRunning || submitDisabled}>
              実行
            </button>
          </>
        )}
      </form>
      <button type="button">後の外</button>
    </>
  )
}

const field = (): HTMLElement => screen.getByRole('textbox', { name: '入力欄' })
const cancel = (): HTMLElement => screen.getByRole('button', { name: 'キャンセル' })
const submit = (): HTMLElement => screen.getByRole('button', { name: '実行' })
const outsideBefore = (): HTMLElement => screen.getByRole('button', { name: '前の外' })
const outsideAfter = (): HTMLElement => screen.getByRole('button', { name: '後の外' })

// モーダルのダイアログの中で Tab を循環させる(背後の画面へフォーカスを出さない)
describe('useDialogFocusTrap', () => {
  it('Tab で中の操作対象を順に移り、最後から先頭へ戻る(disabled と tabindex=-1 は飛ばす)', async () => {
    render(<Harness />)
    act(() => field().focus())
    await userEvent.tab()
    expect(cancel()).toHaveFocus()
    await userEvent.tab()
    expect(submit()).toHaveFocus()
    await userEvent.tab()
    expect(field()).toHaveFocus()
  })

  it('Shift+Tab で逆順に移り、先頭から末尾へ戻る', async () => {
    render(<Harness />)
    act(() => field().focus())
    await userEvent.tab({ shift: true })
    expect(submit()).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(cancel()).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(field()).toHaveFocus()
  })

  it('フォーカスが外にあるとき、Tab は先頭へ、Shift+Tab は末尾へ入れる', async () => {
    render(<Harness />)
    act(() => outsideAfter().focus())
    await userEvent.tab()
    expect(field()).toHaveFocus()
    act(() => outsideBefore().focus())
    await userEvent.tab({ shift: true })
    expect(submit()).toHaveFocus()
  })

  it('フォーカスが body のとき(実行中に disabled で落ちたとき)も中へ入れる', async () => {
    render(<Harness />)
    expect(document.body).toHaveFocus()
    await userEvent.tab()
    expect(field()).toHaveFocus()
  })

  // 実行中に disabled になって操作対象が減っても、毎回列挙し直すため外へ出ない(パターン 86)
  it('操作対象が後から減っても、残りの中で循環する', async () => {
    const { rerender } = render(<Harness />)
    act(() => cancel().focus())
    rerender(<Harness submitDisabled />)
    await userEvent.tab()
    expect(field()).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(cancel()).toHaveFocus()
  })

  it('操作対象が 0 件なら、ダイアログ自体へフォーカスを置く', async () => {
    render(<Harness isRunning />)
    const dialog = screen.getByRole('form', { name: 'ダイアログ' })
    await userEvent.tab()
    expect(dialog).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(dialog).toHaveFocus()
  })

  it('中身が空でも、ダイアログ自体へフォーカスを置く', async () => {
    render(<Harness empty />)
    await userEvent.tab()
    expect(screen.getByRole('form', { name: 'ダイアログ' })).toHaveFocus()
  })

  // 変換候補の操作に Tab を使う IME があるため、変換中は奪わない
  it('IME の変換中(isComposing)の Tab は preventDefault しない', () => {
    render(<Harness />)
    act(() => submit().focus())
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
      isComposing: true
    })
    act(() => {
      submit().dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(false)
    expect(submit()).toHaveFocus()
  })

  it('Tab 以外のキーは preventDefault しない', () => {
    render(<Harness />)
    act(() => field().focus())
    expect(fireEvent.keyDown(field(), { key: 'a' })).toBe(true)
  })

  it('isOpen が false なら何もしない', async () => {
    render(<Harness isOpen={false} />)
    act(() => submit().focus())
    await userEvent.tab()
    expect(outsideAfter()).toHaveFocus()
  })

  it('アンマウントで document のリスナーを外す', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const addSpy = vi.spyOn(document, 'addEventListener')
    const { unmount } = render(<Harness />)
    const added = addSpy.mock.calls.find(
      ([type, , options]) => type === 'keydown' && options === true
    )
    expect(added).toBeDefined()
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('keydown', added?.[1], true)
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
