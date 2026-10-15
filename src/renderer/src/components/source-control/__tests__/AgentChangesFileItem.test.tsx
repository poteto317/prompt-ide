import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { AgentChangeEntry } from '@shared/types'
import AgentChangesFileItem from '../AgentChangesFileItem'
import { makeAgentChangeEntry } from '../../../__tests__/makeAgentChangesState'

// 「エージェントの変更」の 1 行の印(利用者の変更との区別。設計書「renderer(段階 B)」)。行の並び・戻すボタンの配線は AgentChangesSection.test

function renderItem(entry: AgentChangeEntry, savedInApp = false): HTMLElement {
  render(
    <ul>
      <AgentChangesFileItem
        entry={entry}
        savedInApp={savedInApp}
        disabledReason={null}
        disabledReasonId="reason"
        onOpenDiff={vi.fn()}
        onRevert={vi.fn()}
      />
    </ul>
  )
  return screen.getByRole('listitem')
}

describe('AgentChangesFileItem の利用者の変更の印', () => {
  it.each([
    ['user', '利用者の変更'],
    ['mixed', '利用者の変更を含む']
  ] as const)('author が %s なら「%s」の印を出す', (author, mark) => {
    const row = renderItem(makeAgentChangeEntry('a.txt', { author }))
    expect(within(row).getByText(mark)).toHaveClass('agent-changes__mark')
  })

  it.each(['agent', null] as const)('author が %s なら印を出さない', (author) => {
    const row = renderItem(makeAgentChangeEntry('a.txt', { author }))
    expect(within(row).queryByText(/利用者の変更/)).toBeNull()
  })

  it('「あなたの保存を含む」の印と両方出し、利用者の変更の印を前に置く', () => {
    const row = renderItem(makeAgentChangeEntry('a.txt', { author: 'user' }), true)
    expect(
      within(row)
        .getAllByText(/^(利用者の変更|あなたの保存を含む)$/)
        .map((mark) => mark.textContent)
    ).toEqual(['利用者の変更', 'あなたの保存を含む'])
  })
})
