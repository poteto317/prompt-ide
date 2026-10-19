import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, it, expect } from 'vitest'
import { useAgentInterruptFocus } from '../useAgentInterruptFocus'

// 実際の DOM のフォーカスを見るため、renderHook ではなく小さな部品で使う
function Harness({
  visible,
  primaryDisabled = false
}: {
  visible: boolean
  primaryDisabled?: boolean
}): React.JSX.Element {
  const interruptRef = useRef<HTMLButtonElement>(null)
  const primaryButtonRef = useRef<HTMLButtonElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const onFocus = useAgentInterruptFocus(visible, { interruptRef, primaryButtonRef, toggleRef })
  return (
    <>
      <section onFocus={onFocus} aria-label="パネル">
        <button ref={toggleRef} type="button">
          開閉
        </button>
        {visible && (
          <button ref={interruptRef} type="button">
            中断
          </button>
        )}
        <button ref={primaryButtonRef} type="button" disabled={primaryDisabled}>
          主ボタン
        </button>
      </section>
      <input aria-label="外の入力欄" />
    </>
  )
}

const button = (name: string): HTMLElement => screen.getByRole('button', { name })

describe('useAgentInterruptFocus', () => {
  it('中断 にフォーカスがあるまま消えたら、body に落ちたフォーカスを主ボタンへ移す', () => {
    const { rerender } = render(<Harness visible />)
    act(() => button('中断').focus())
    rerender(<Harness visible={false} />)
    expect(button('主ボタン')).toHaveFocus()
  })

  it.each([
    ['ウィンドウが非アクティブになって', true],
    ['外れる直前に(Chromium が要素を外すときの blur)', false]
  ] as const)(
    '%s 中断 に blur・focusout が出た後に消えても、主ボタンへ移す(onBlur で控えを消さない)',
    (_name, windowBlur) => {
      const { rerender } = render(<Harness visible />)
      const interrupt = button('中断')
      act(() => interrupt.focus())
      // jsdom はウィンドウの非アクティブ化や要素の取り外しで blur を出さないため、Chromium の振る舞いを手で出す
      act(() => {
        interrupt.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }))
        interrupt.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
        if (windowBlur) window.dispatchEvent(new FocusEvent('blur'))
      })
      rerender(<Harness visible={false} />)
      expect(button('主ボタン')).toHaveFocus()
    }
  )

  it('主ボタンが disabled なら、開閉のボタンへ移す', () => {
    const { rerender } = render(<Harness visible />)
    act(() => button('中断').focus())
    rerender(<Harness visible={false} primaryDisabled />)
    expect(button('開閉')).toHaveFocus()
  })

  it('パネルの中で最後にフォーカスを受けたのが 中断 でなければ移さない', () => {
    const { rerender } = render(<Harness visible />)
    act(() => button('中断').focus())
    act(() => button('開閉').focus())
    act(() => (document.activeElement as HTMLElement).blur())
    rerender(<Harness visible={false} />)
    expect(document.body).toHaveFocus()
  })

  it('利用者がパネルの外へ移したフォーカスは奪わない', () => {
    const { rerender } = render(<Harness visible />)
    act(() => button('中断').focus())
    const outside = screen.getByRole('textbox', { name: '外の入力欄' })
    act(() => outside.focus())
    rerender(<Harness visible={false} />)
    expect(outside).toHaveFocus()
  })

  it('移さなかった回の控えは次の回に残さない', () => {
    const { rerender } = render(<Harness visible />)
    act(() => button('中断').focus())
    const outside = screen.getByRole('textbox', { name: '外の入力欄' })
    act(() => outside.focus())
    rerender(<Harness visible={false} />)
    rerender(<Harness visible />)
    act(() => outside.blur())
    rerender(<Harness visible={false} />)
    expect(document.body).toHaveFocus()
  })

  it('消えていない間(出たまま・出たとき)は何もしない', () => {
    const { rerender } = render(<Harness visible={false} />)
    rerender(<Harness visible />)
    expect(document.body).toHaveFocus()
  })
})
