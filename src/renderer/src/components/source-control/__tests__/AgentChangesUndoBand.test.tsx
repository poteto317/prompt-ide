import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AgentChangesUndoBand from '../AgentChangesUndoBand'
import { makeAgentChangesUndoSummary } from '../../../__tests__/makeAgentChangesState'

const renderBand = (disabledReason: string | null = null): { onUndo: ReturnType<typeof vi.fn> } => {
  const onUndo = vi.fn()
  render(
    <AgentChangesUndoBand
      summary={makeAgentChangesUndoSummary()}
      disabledReason={disabledReason}
      reasonId="undo-reason"
      onUndo={onUndo}
    />
  )
  return { onUndo }
}

describe('AgentChangesUndoBand', () => {
  it('対象の文言と、対象を含む名前のボタンを出す(読み上げの領域は持たない)', () => {
    const { container } = render(
      <AgentChangesUndoBand
        summary={makeAgentChangesUndoSummary({ operation: 'hunk' })}
        disabledReason={null}
        reasonId="r"
        onUndo={vi.fn()}
      />
    )
    expect(screen.getByText('直前に戻した操作: a.txt のハンク')).toBeInTheDocument()
    const button = screen.getByRole('button', {
      name: '戻した操作を取り消す（直前: a.txt のハンク）'
    })
    expect(button).toHaveTextContent('戻した操作を取り消す')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).not.toHaveAttribute('aria-describedby')
    expect(container.querySelector('[role="alert"], [aria-live]')).toBeNull()
  })

  it('帯の文字は末尾が省略されうるため、全文をツールチップ(title)にも出す', () => {
    renderBand()
    const text = screen.getByText('直前に戻した操作: a.txt')
    expect(text).toHaveAttribute('title', '直前に戻した操作: a.txt')
  })

  it('アクセシブルネームは見えている文字列を切れ目なく先頭に含む(WCAG 2.5.3)', () => {
    renderBand()
    const button = screen.getByRole('button')
    const visible = button.textContent ?? ''
    expect(visible).toBe('戻した操作を取り消す')
    expect(button.getAttribute('aria-label')?.startsWith(visible)).toBe(true)
  })

  it('押せないときは帯の中に理由を見える文字で出し、aria-describedby で結ぶ(L-057)', () => {
    renderBand('取り消しの実行中です')
    const button = screen.getByRole('button', { name: '戻した操作を取り消す（直前: a.txt）' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-describedby', 'undo-reason')
    expect(document.getElementById('undo-reason')).toHaveTextContent('取り消しの実行中です')
  })

  it('押すと onUndo を呼ぶ。ダブルクリックの 2 回目(detail > 1)は無視する(L-408)', async () => {
    const { onUndo } = renderBand()
    await userEvent.click(screen.getByRole('button'))
    expect(onUndo).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button'), { detail: 2 })
    expect(onUndo).toHaveBeenCalledOnce()
  })

  it.each([
    ['Enter', true, false],
    [' ', true, false],
    ['Enter', false, true],
    ['a', true, true]
  ] as const)(
    'keydown %j repeat=%s は既定の動作を %s(止めるのはキーリピートの Enter・Space だけ)',
    (key, repeat, notPrevented) => {
      renderBand()
      expect(fireEvent.keyDown(screen.getByRole('button'), { key, repeat })).toBe(notPrevented)
    }
  )
})
