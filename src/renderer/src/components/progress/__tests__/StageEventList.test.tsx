import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import StageEventList from '../StageEventList'
import type { Stage } from '../../../types'

function stage(events: Stage['events']): Stage {
  return { id: 'refactor', status: 'in_progress', events }
}

describe('StageEventList', () => {
  it('履歴が無ければ「履歴はありません」を表示', () => {
    render(<StageEventList stage={stage([])} />)
    expect(screen.getByText('履歴はありません')).toBeInTheDocument()
  })

  it('履歴がある場合はリストを表示する', () => {
    render(<StageEventList stage={stage([{ id: 'e1', occurredAt: 1000 }])} />)
    expect(screen.queryByText('履歴はありません')).not.toBeInTheDocument()
    expect(screen.getByRole('list')).toBeInTheDocument()
  })

  it('note を表示する', () => {
    render(<StageEventList stage={stage([{ id: 'e1', occurredAt: 1000, note: '分割した' }])} />)
    expect(screen.getByText('分割した')).toBeInTheDocument()
  })

  it('meta を整形して表示する', () => {
    render(
      <StageEventList
        stage={stage([{ id: 'e1', occurredAt: 1000, meta: { commit: 'abc', pr: '7' } }])}
      />
    )
    expect(screen.getByText('commit: abc / pr: 7')).toBeInTheDocument()
  })

  it('meta が空オブジェクトのときは meta 要素を描画しない', () => {
    const { container } = render(
      <StageEventList stage={stage([{ id: 'e1', occurredAt: 1000, meta: {} }])} />
    )
    expect(container.querySelector('.stage-history__meta')).toBeNull()
  })

  it('複数イベントを全て表示する', () => {
    render(
      <StageEventList
        stage={stage([
          { id: 'e1', occurredAt: 1000, note: 'one' },
          { id: 'e2', occurredAt: 2000, note: 'two' }
        ])}
      />
    )
    expect(screen.getByText('one')).toBeInTheDocument()
    expect(screen.getByText('two')).toBeInTheDocument()
  })
})
