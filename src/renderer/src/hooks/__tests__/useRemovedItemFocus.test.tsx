import { useState } from 'react'
import { render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { useRemovedItemFocus } from '../useRemovedItemFocus'

const SELECTOR = '[data-remove]'

// 外すと一覧から消える(次の描画で items が変わる)最小の一覧
function List({ initial }: { initial: string[] }): React.JSX.Element {
  const [items, setItems] = useState(initial)
  const { containerRef, markRemoved } = useRemovedItemFocus<HTMLDivElement>(items, SELECTOR)
  return (
    <div ref={containerRef} tabIndex={-1} data-testid="container">
      <button type="button">ほかのボタン</button>
      {items.map((item, index) => (
        <button
          key={item}
          type="button"
          data-remove=""
          onClick={() => {
            markRemoved(index)
            setItems((prev) => prev.filter((x) => x !== item))
          }}
        >
          {`${item} を外す`}
        </button>
      ))}
    </div>
  )
}

describe('useRemovedItemFocus', () => {
  it('外した位置の次の外すボタンへフォーカスを移す', async () => {
    const user = userEvent.setup()
    render(<List initial={['a', 'b', 'c']} />)
    await user.click(screen.getByRole('button', { name: 'b を外す' }))
    expect(screen.getByRole('button', { name: 'c を外す' })).toHaveFocus()
  })

  it('末尾を外したら、1 つ前の外すボタンへ移す', async () => {
    const user = userEvent.setup()
    render(<List initial={['a', 'b']} />)
    await user.click(screen.getByRole('button', { name: 'b を外す' }))
    expect(screen.getByRole('button', { name: 'a を外す' })).toHaveFocus()
  })

  it('外すボタンが無くなったら、範囲そのものへ移す(selector に合わないボタンには移さない)', async () => {
    const user = userEvent.setup()
    render(<List initial={['a']} />)
    await user.click(screen.getByRole('button', { name: 'a を外す' }))
    expect(screen.getByTestId('container')).toHaveFocus()
  })

  it('外していないときは、items が変わってもフォーカスを動かさない', () => {
    const container = document.createElement('div')
    container.tabIndex = -1
    const other = document.createElement('button')
    container.append(other)
    document.body.append(container)
    const { result, rerender } = renderHook(
      ({ items }: { items: string[] }) => useRemovedItemFocus<HTMLDivElement>(items, SELECTOR),
      { initialProps: { items: ['a'] } }
    )
    result.current.containerRef.current = container
    other.focus()
    rerender({ items: ['a', 'b'] })
    expect(other).toHaveFocus()
    container.remove()
  })
})
