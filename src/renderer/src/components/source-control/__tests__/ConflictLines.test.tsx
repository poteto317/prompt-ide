import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ConflictLines from '../ConflictLines'

describe('ConflictLines', () => {
  it('行ごとに diff-view__line の要素を 1 つ描画する(行数が一致する)', () => {
    const { container } = render(<ConflictLines lines={['a', 'b', 'c']} />)
    const rows = container.querySelectorAll('.diff-view__line')
    expect(rows).toHaveLength(3)
    expect([...rows].map((row) => row.textContent)).toEqual(['a', 'b', 'c'])
  })

  it('空行は空白 1 文字で描画する(中身の無い要素は高さ 0 で消えるため)', () => {
    const { container } = render(<ConflictLines lines={['a', '', '']} />)
    const rows = container.querySelectorAll('.diff-view__line')
    expect(rows).toHaveLength(3)
    expect(rows[1].textContent).toBe(' ')
    expect(rows[2].textContent).toBe(' ')
  })

  it('className を各行に追加する', () => {
    const { container } = render(
      <ConflictLines lines={['a', 'b']} className="diff-view__line--context" />
    )
    const rows = container.querySelectorAll('.diff-view__line.diff-view__line--context')
    expect(rows).toHaveLength(2)
  })

  it('行が無ければ何も描画しない', () => {
    const { container } = render(<ConflictLines lines={[]} />)
    expect(container.querySelectorAll('.diff-view__line')).toHaveLength(0)
  })
})
