import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { ConflictSegment } from '@shared/types'
import ConflictBlock from '../ConflictBlock'

type ConflictBlockSegment = Extract<ConflictSegment, { kind: 'conflict' }>

const makeSegment = (overrides: Partial<ConflictBlockSegment> = {}): ConflictBlockSegment => ({
  kind: 'conflict',
  ours: ['自分の行1', '自分の行2'],
  theirs: ['相手の行1'],
  oursLabel: 'HEAD',
  theirsLabel: 'feature/x',
  ...overrides
})

describe('ConflictBlock', () => {
  it('ブロック番号(1 始まり)と、両側のラベルを見出しに出す', () => {
    render(<ConflictBlock index={1} segment={makeSegment()} disabled={false} onChoose={vi.fn()} />)
    expect(screen.getByText('ブロック 2')).toBeInTheDocument()
    expect(screen.getByText('自分（HEAD）')).toBeInTheDocument()
    expect(screen.getByText('相手（feature/x）')).toBeInTheDocument()
  })

  it('自分側・相手側の内容を行ごとに表示する', () => {
    render(<ConflictBlock index={0} segment={makeSegment()} disabled={false} onChoose={vi.fn()} />)
    expect(screen.getByText('自分の行1')).toBeInTheDocument()
    expect(screen.getByText('自分の行2')).toBeInTheDocument()
    expect(screen.getByText('相手の行1')).toBeInTheDocument()
  })

  it('base があれば表示し、無ければ表示しない', () => {
    const { rerender } = render(
      <ConflictBlock index={0} segment={makeSegment()} disabled={false} onChoose={vi.fn()} />
    )
    expect(screen.queryByText(/^共通の祖先/)).not.toBeInTheDocument()
    rerender(
      <ConflictBlock
        index={0}
        segment={makeSegment({ base: ['祖先の行'], baseLabel: 'abc123' })}
        disabled={false}
        onChoose={vi.fn()}
      />
    )
    expect(screen.getByText('共通の祖先（abc123）')).toBeInTheDocument()
    expect(screen.getByText('祖先の行')).toBeInTheDocument()
  })

  it('片側が空のときは「（空）」を出す', () => {
    render(
      <ConflictBlock
        index={0}
        segment={makeSegment({ theirs: [] })}
        disabled={false}
        onChoose={vi.fn()}
      />
    )
    expect(screen.getByText('（空）')).toBeInTheDocument()
  })

  it('3 つのボタンを aria-label で取得でき、クリックで onChoose に選択が渡る', async () => {
    const onChoose = vi.fn()
    render(<ConflictBlock index={0} segment={makeSegment()} disabled={false} onChoose={onChoose} />)
    await userEvent.click(screen.getByRole('button', { name: 'ブロック 1 を自分の内容にする' }))
    await userEvent.click(screen.getByRole('button', { name: 'ブロック 1 を相手の内容にする' }))
    await userEvent.click(screen.getByRole('button', { name: 'ブロック 1 を両方にする' }))
    expect(onChoose.mock.calls).toEqual([['ours'], ['theirs'], ['both']])
  })

  it('ボタンの表示文言は「自分を採用」「相手を採用」「両方」', () => {
    render(<ConflictBlock index={0} segment={makeSegment()} disabled={false} onChoose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'ブロック 1 を自分の内容にする' })).toHaveTextContent(
      '自分を採用'
    )
    expect(screen.getByRole('button', { name: 'ブロック 1 を相手の内容にする' })).toHaveTextContent(
      '相手を採用'
    )
    expect(screen.getByRole('button', { name: 'ブロック 1 を両方にする' })).toHaveTextContent(
      '両方'
    )
  })

  it('空行も 1 行として描画する(行数が一致し、高さ 0 で消えない)', () => {
    const { container } = render(
      <ConflictBlock
        index={0}
        segment={makeSegment({ ours: ['a', '', 'b'], theirs: ['a', 'b'] })}
        disabled={false}
        onChoose={vi.fn()}
      />
    )
    const sides = container.querySelectorAll('.conflict-block__side')
    expect(sides[0].querySelectorAll('.diff-view__line')).toHaveLength(3)
    expect(sides[1].querySelectorAll('.diff-view__line')).toHaveLength(2)
    expect(sides[0].querySelectorAll('.diff-view__line')[1].textContent).toBe(' ')
  })

  it('disabled のときは 3 つのボタンが押せず、onChoose も呼ばれない', async () => {
    const onChoose = vi.fn()
    render(<ConflictBlock index={0} segment={makeSegment()} disabled onChoose={onChoose} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    for (const button of buttons) {
      expect(button).toBeDisabled()
      await userEvent.click(button)
    }
    expect(onChoose).not.toHaveBeenCalled()
  })
})
