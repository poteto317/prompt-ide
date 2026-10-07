import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useAgentChangesSectionFocus } from '../useAgentChangesSectionFocus'

interface HarnessProps {
  isVisible?: boolean
  isFocusRequested?: boolean
  consumeFocusRequest?: () => void
  openSection?: () => void
  /** 押したボタンの状態(押せる・押せない・消えた) */
  action?: 'enabled' | 'disabled' | 'none'
  /** セクションの中のもう 1 つの押せるボタン */
  hasOther?: boolean
}

const noop = (): void => undefined

// AgentChangesSection と同じく、表示しない間も hook は呼び、見出し・セクションだけを描画しない
function Harness({
  isVisible = true,
  isFocusRequested = false,
  consumeFocusRequest = noop,
  openSection = noop,
  action = 'enabled',
  hasOther = false
}: HarnessProps): React.JSX.Element {
  const { headingRef, sectionRef, reserveFocusRestore } = useAgentChangesSectionFocus({
    isVisible,
    isFocusRequested,
    consumeFocusRequest,
    openSection
  })
  return (
    <div>
      <button type="button">外</button>
      {isVisible && (
        <section ref={sectionRef}>
          <button ref={headingRef} type="button">
            見出し
          </button>
          {action !== 'none' && (
            <button type="button" disabled={action === 'disabled'} onClick={reserveFocusRestore}>
              押す
            </button>
          )}
          {hasOther && <button type="button">ほか</button>}
        </section>
      )}
    </div>
  )
}

const heading = (): HTMLElement => screen.getByRole('button', { name: '見出し' })
const action = (): HTMLElement => screen.getByRole('button', { name: '押す' })
const outside = (): HTMLElement => screen.getByRole('button', { name: '外' })

/** ボタンにフォーカスを置いて押す(実機のクリックと同じく、押したボタンにフォーカスがある) */
function press(element: HTMLElement): void {
  element.focus()
  fireEvent.click(element)
}

describe('useAgentChangesSectionFocus: フォーカスの依頼', () => {
  it('依頼があれば折りたたみを開いて見出しへ移し、依頼を下ろす', () => {
    const consume = vi.fn()
    const openSection = vi.fn()
    render(<Harness isFocusRequested consumeFocusRequest={consume} openSection={openSection} />)
    expect(heading()).toHaveFocus()
    expect(openSection).toHaveBeenCalledOnce()
    expect(consume).toHaveBeenCalledOnce()
  })

  it('表示しない間は移さず、依頼も下ろさない。表示されたら受け取る', () => {
    const consume = vi.fn()
    const openSection = vi.fn()
    const { rerender } = render(
      <Harness
        isVisible={false}
        isFocusRequested
        consumeFocusRequest={consume}
        openSection={openSection}
      />
    )
    expect(consume).not.toHaveBeenCalled()
    expect(openSection).not.toHaveBeenCalled()
    expect(document.body).toHaveFocus()
    rerender(<Harness isFocusRequested consumeFocusRequest={consume} openSection={openSection} />)
    expect(heading()).toHaveFocus()
    expect(consume).toHaveBeenCalledOnce()
    expect(openSection).toHaveBeenCalledOnce()
  })

  it('依頼が無ければ移さず、開きもしない', () => {
    const consume = vi.fn()
    const openSection = vi.fn()
    render(<Harness consumeFocusRequest={consume} openSection={openSection} />)
    expect(heading()).not.toHaveFocus()
    expect(consume).not.toHaveBeenCalled()
    expect(openSection).not.toHaveBeenCalled()
  })

  it('依頼が続いていても、依存が変わらない描画では繰り返さない', () => {
    const consume = vi.fn()
    const openSection = vi.fn()
    const { rerender } = render(
      <Harness isFocusRequested consumeFocusRequest={consume} openSection={openSection} />
    )
    rerender(
      <Harness isFocusRequested consumeFocusRequest={consume} openSection={openSection} hasOther />
    )
    expect(consume).toHaveBeenCalledOnce()
    expect(openSection).toHaveBeenCalledOnce()
  })
})

describe('useAgentChangesSectionFocus: 押した後の復帰', () => {
  it('予約の後に、押したボタンが押せなくなったら見出しへ戻す', () => {
    const { rerender } = render(<Harness />)
    press(action())
    rerender(<Harness action="disabled" />)
    expect(heading()).toHaveFocus()
  })

  it('予約の後に、押したボタンが消えたら見出しへ戻す', () => {
    const { rerender } = render(<Harness />)
    press(action())
    rerender(<Harness action="none" />)
    expect(heading()).toHaveFocus()
  })

  it('予約していなければ、ボタンが押せなくなっても・消えても移さない', () => {
    const { rerender } = render(<Harness />)
    action().focus()
    rerender(<Harness action="disabled" />)
    expect(heading()).not.toHaveFocus()
    rerender(<Harness action="none" />)
    expect(heading()).not.toHaveFocus()
    expect(document.body).toHaveFocus()
  })

  it('セクションの中の押せる要素にあるうちは予約を残し、後で押せなくなったら戻す', () => {
    const { rerender } = render(<Harness />)
    press(action())
    // 同じボタンが押せるままの描画(例: 取得中の表示だけが変わる)
    rerender(<Harness hasOther />)
    expect(action()).toHaveFocus()
    rerender(<Harness action="disabled" hasOther />)
    expect(heading()).toHaveFocus()
  })

  it('利用者がセクションの外へ移したフォーカスは奪わず、予約を捨てる', () => {
    const { rerender } = render(<Harness />)
    press(action())
    outside().focus()
    rerender(<Harness action="disabled" />)
    expect(outside()).toHaveFocus()
    // 予約は捨てたので、後でフォーカスが body に落ちても戻さない
    outside().blur()
    rerender(<Harness action="none" />)
    expect(document.body).toHaveFocus()
  })

  it('見出しが消えたら予約を捨てる(従来の方式で確認を終えてセクションごと消えた)', () => {
    const { rerender } = render(<Harness />)
    press(action())
    rerender(<Harness isVisible={false} />)
    expect(document.body).toHaveFocus()
    // 再び現れても、捨てた予約で見出しへ移さない
    rerender(<Harness />)
    expect(heading()).not.toHaveFocus()
    expect(document.body).toHaveFocus()
  })

  it('戻した後は予約を捨てる(次に押せなくなっても、利用者が移した body のフォーカスを動かさない)', () => {
    const { rerender } = render(<Harness />)
    press(action())
    rerender(<Harness action="none" />)
    expect(heading()).toHaveFocus()
    heading().blur()
    rerender(<Harness action="enabled" />)
    rerender(<Harness action="none" />)
    expect(document.body).toHaveFocus()
  })
})
