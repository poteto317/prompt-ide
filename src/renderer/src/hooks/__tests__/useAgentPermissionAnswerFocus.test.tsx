import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, it, expect } from 'vitest'
import { useAgentPermissionAnswerFocus } from '../useAgentPermissionAnswerFocus'

// 実際の DOM のフォーカスを見るため、renderHook ではなく小さな部品で使う
function Harness({ visible }: { visible: boolean }): React.JSX.Element {
  const allowRef = useRef<HTMLButtonElement>(null)
  const denyRef = useRef<HTMLButtonElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const onFocus = useAgentPermissionAnswerFocus(visible, { allowRef, denyRef, toggleRef })
  return (
    <>
      <section onFocus={onFocus} aria-label="パネル">
        <button ref={toggleRef} type="button">
          開閉
        </button>
        {visible && (
          <>
            <button ref={allowRef} type="button">
              許可
            </button>
            <button ref={denyRef} type="button">
              拒否
            </button>
          </>
        )}
        <button type="button">中断</button>
        <button type="button">終了</button>
      </section>
      <input aria-label="外の入力欄" />
    </>
  )
}

const button = (name: string): HTMLElement => screen.getByRole('button', { name })

describe('useAgentPermissionAnswerFocus', () => {
  it.each(['許可', '拒否'])(
    '%s にフォーカスがあるまま消えたら、body に落ちたフォーカスを開閉のボタンへ移す(中断・終了へは移さない)',
    (name) => {
      const { rerender } = render(<Harness visible />)
      act(() => button(name).focus())
      rerender(<Harness visible={false} />)
      expect(button('開閉')).toHaveFocus()
      expect(button('中断')).not.toHaveFocus()
      expect(button('終了')).not.toHaveFocus()
    }
  )

  it('blur・focusout が出た後に消えても移す(onBlur で控えを消さない)', () => {
    const { rerender } = render(<Harness visible />)
    const allow = button('許可')
    act(() => allow.focus())
    act(() => {
      allow.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }))
      allow.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
      window.dispatchEvent(new FocusEvent('blur'))
    })
    rerender(<Harness visible={false} />)
    expect(button('開閉')).toHaveFocus()
  })

  it('パネルの外へフォーカスを移していれば奪わない', () => {
    const { rerender } = render(<Harness visible />)
    act(() => button('許可').focus())
    act(() => screen.getByRole('textbox', { name: '外の入力欄' }).focus())
    rerender(<Harness visible={false} />)
    expect(screen.getByRole('textbox', { name: '外の入力欄' })).toHaveFocus()
  })

  it('パネルの中で最後にフォーカスを受けたのが 許可・拒否 でなければ移さない', () => {
    const { rerender } = render(<Harness visible />)
    act(() => button('許可').focus())
    act(() => button('中断').focus())
    act(() => (document.activeElement as HTMLElement).blur())
    rerender(<Harness visible={false} />)
    expect(document.activeElement).toBe(document.body)
  })

  it('移した先の onFocus で控えが消えるので、もう一度出て消えても移さない', () => {
    const { rerender } = render(<Harness visible />)
    act(() => button('許可').focus())
    rerender(<Harness visible={false} />)
    expect(button('開閉')).toHaveFocus()
    act(() => (document.activeElement as HTMLElement).blur())
    rerender(<Harness visible />)
    rerender(<Harness visible={false} />)
    expect(document.activeElement).toBe(document.body)
  })

  // 控えの戻し(移さなかった回は控えを残さない)はこのテストで固定する
  it('控えを残さない: パネルの外にあって移さなかった回の後、もう一度出て消えても、フォーカスを受けていなければ移さない', () => {
    const { rerender } = render(<Harness visible />)
    act(() => button('許可').focus())
    // パネルの外へ移した(外の入力欄では onFocus が出ず、控えは 許可 のまま)ので、消えても移さない
    const outside = screen.getByRole('textbox', { name: '外の入力欄' })
    act(() => outside.focus())
    rerender(<Harness visible={false} />)
    expect(outside).toHaveFocus()
    act(() => outside.blur())
    rerender(<Harness visible />)
    rerender(<Harness visible={false} />)
    expect(document.activeElement).toBe(document.body)
  })
})
