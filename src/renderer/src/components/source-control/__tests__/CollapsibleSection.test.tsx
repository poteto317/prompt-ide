import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import CollapsibleSection from '../CollapsibleSection'

const toggle = (name = '変更'): HTMLElement => screen.getByRole('button', { name })

function DraftInput(): React.JSX.Element {
  const [value, setValue] = useState('')
  return <input aria-label="下書き" value={value} onChange={(e) => setValue(e.target.value)} />
}

describe('CollapsibleSection', () => {
  // リピートのたびに開閉が反転すると、手を離した時点の状態が予測できない
  it('Enter のキーリピートでは開閉しない', () => {
    render(<CollapsibleSection title="変更">中身</CollapsibleSection>)
    expect(fireEvent.keyDown(toggle(), { key: 'Enter', repeat: true })).toBe(false)
    expect(fireEvent.keyDown(toggle(), { key: 'Enter' })).toBe(true)
    expect(fireEvent.keyDown(toggle(), { key: ' ', repeat: true })).toBe(true)
  })

  it('見出しは h3 の中のボタンで、title の文字をアクセシブルネームにする', () => {
    render(<CollapsibleSection title="変更">中身</CollapsibleSection>)
    const heading = screen.getByRole('heading', { level: 3, name: '変更' })
    expect(within(heading).getByRole('button', { name: '変更' })).toBe(toggle())
  })

  it('既定は開いた状態で、aria-controls が本体を指す', () => {
    render(<CollapsibleSection title="変更">中身</CollapsibleSection>)
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    const body = document.getElementById(toggle().getAttribute('aria-controls') as string)
    expect(body).toContainElement(screen.getByText('中身'))
    expect(body).not.toHaveAttribute('hidden')
  })

  it('開閉の印は読み上げず、開閉に合わせて変わる', async () => {
    render(<CollapsibleSection title="変更">中身</CollapsibleSection>)
    const mark = toggle().querySelector('[aria-hidden="true"]') as HTMLElement
    expect(mark).toHaveAttribute('data-direction', 'down')
    await userEvent.click(toggle())
    expect(toggle().querySelector('[aria-hidden="true"]')).toHaveAttribute(
      'data-direction',
      'right'
    )
  })

  it('閉じると本体は hidden になり、もう一度押すと開く', async () => {
    render(<CollapsibleSection title="変更">中身</CollapsibleSection>)
    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('中身')).not.toBeVisible()
    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('中身')).toBeVisible()
  })

  it('閉じても中身はアンマウントせず、入力中の状態が残る', async () => {
    render(
      <CollapsibleSection title="変更">
        <DraftInput />
      </CollapsibleSection>
    )
    const input = screen.getByRole('textbox', { name: '下書き' })
    await userEvent.type(input, 'abc')
    await userEvent.click(toggle())
    await userEvent.click(toggle())
    expect(screen.getByRole('textbox', { name: '下書き' })).toBe(input)
    expect(input).toHaveValue('abc')
  })

  it('件数が 1 以上ならバッジを出す(見出しの名前に含め、開閉のボタンの名前には含めない)', () => {
    render(
      <CollapsibleSection title="変更" count={3}>
        中身
      </CollapsibleSection>
    )
    expect(screen.getByRole('heading', { name: '変更 3' })).toBeInTheDocument()
    expect(toggle()).not.toHaveTextContent('3')
  })

  it.each([
    ['0 件', 0],
    ['件数なし', undefined]
  ])('%s のときはバッジを出さない', (_label, count) => {
    const { container } = render(
      <CollapsibleSection title="変更" count={count}>
        中身
      </CollapsibleSection>
    )
    expect(container.querySelector('.collapsible-section__count')).toBeNull()
  })

  it('操作のボタンは開閉のボタンの外に置き、閉じても押せる', async () => {
    render(
      <CollapsibleSection title="変更" actions={<button type="button">操作</button>}>
        中身
      </CollapsibleSection>
    )
    const action = screen.getByRole('button', { name: '操作' })
    expect(toggle()).not.toContainElement(action)
    expect(screen.getByRole('heading', { name: '変更' })).not.toContainElement(action)
    await userEvent.click(toggle())
    expect(action).toBeVisible()
  })

  it('操作を押しても開閉しない', async () => {
    render(
      <CollapsibleSection title="変更" actions={<button type="button">操作</button>}>
        中身
      </CollapsibleSection>
    )
    await userEvent.click(screen.getByRole('button', { name: '操作' }))
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  })

  it('操作が無いときは枠を出さない', () => {
    const { container } = render(<CollapsibleSection title="変更">中身</CollapsibleSection>)
    expect(container.querySelector('.collapsible-section__actions')).toBeNull()
  })

  it('alwaysVisible の中身は本体の外に置き、閉じても見える', async () => {
    render(
      <CollapsibleSection title="変更" alwaysVisible={<p role="alert">失敗しました</p>}>
        中身
      </CollapsibleSection>
    )
    const alert = screen.getByRole('alert')
    const body = document.getElementById(toggle().getAttribute('aria-controls') as string)
    expect(body).not.toContainElement(alert)
    await userEvent.click(toggle())
    expect(alert).toBeVisible()
  })

  it('セクションは見出しのボタンの文字で名付ける', () => {
    render(<CollapsibleSection title="変更">中身</CollapsibleSection>)
    expect(screen.getByRole('region', { name: '変更' })).toContainElement(toggle())
  })
})
