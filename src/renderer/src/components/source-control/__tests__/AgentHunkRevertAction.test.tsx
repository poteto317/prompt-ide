import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import AgentHunkRevertAction, { AgentDiffNotices } from '../AgentHunkRevertAction'
import type { AgentDiffActions } from '../../../types'

function makeActions(overrides: Partial<AgentDiffActions> = {}): AgentDiffActions {
  return {
    canRevertHunk: true,
    disabledReason: null,
    error: null,
    onRevertHunk: vi.fn(),
    ...overrides
  }
}

describe('AgentHunkRevertAction', () => {
  it('押すと patch と hunkHeader を onRevertHunk へ渡す', async () => {
    const actions = makeActions()
    const getPatch = vi.fn(() => 'PATCH')
    render(
      <AgentHunkRevertAction
        agentActions={actions}
        reasonId="r1"
        disabled={false}
        hunkHeader="@@ -1 +1 @@"
        getPatch={getPatch}
      />
    )
    expect(getPatch).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'このハンクを実行前に戻す' }))
    expect(actions.onRevertHunk).toHaveBeenCalledWith('PATCH', '@@ -1 +1 @@')
  })

  it('canRevertHunk が false なら何も出さない', () => {
    const { container } = render(
      <AgentHunkRevertAction
        agentActions={makeActions({ canRevertHunk: false })}
        reasonId="r1"
        disabled={false}
        hunkHeader="h"
        getPatch={() => ''}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('disabledReason があると無効になり、aria-describedby が理由の id を指す', () => {
    render(
      <AgentHunkRevertAction
        agentActions={makeActions({ disabledReason: '理由です' })}
        reasonId="reason-1"
        disabled={false}
        hunkHeader="h"
        getPatch={() => ''}
      />
    )
    const button = screen.getByRole('button', { name: 'このハンクを実行前に戻す' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-describedby', 'reason-1')
  })

  it('理由が無ければ aria-describedby を付けず、disabled prop で無効になる', () => {
    const { rerender } = render(
      <AgentHunkRevertAction
        agentActions={makeActions()}
        reasonId="reason-1"
        disabled={false}
        hunkHeader="h"
        getPatch={() => ''}
      />
    )
    const button = screen.getByRole('button', { name: 'このハンクを実行前に戻す' })
    expect(button).toBeEnabled()
    expect(button).not.toHaveAttribute('aria-describedby')
    rerender(
      <AgentHunkRevertAction
        agentActions={makeActions()}
        reasonId="reason-1"
        disabled
        hunkHeader="h"
        getPatch={() => ''}
      />
    )
    expect(button).toBeDisabled()
  })
})

describe('AgentDiffNotices', () => {
  it('error を role="alert" で出す', () => {
    render(<AgentDiffNotices agentActions={makeActions({ error: '失敗した' })} reasonId="r" />)
    expect(screen.getByRole('alert')).toHaveTextContent('失敗した')
  })

  it('error が null なら alert を出さない', () => {
    render(<AgentDiffNotices agentActions={makeActions()} reasonId="r" />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('理由の段落に reasonId が付き、ボタンの aria-describedby から参照できる', () => {
    render(
      <>
        <AgentDiffNotices
          agentActions={makeActions({ disabledReason: '理由です' })}
          reasonId="rid"
        />
        <AgentHunkRevertAction
          agentActions={makeActions({ disabledReason: '理由です' })}
          reasonId="rid"
          disabled={false}
          hunkHeader="h"
          getPatch={() => ''}
        />
      </>
    )
    const button = screen.getByRole('button', { name: 'このハンクを実行前に戻す' })
    expect(button).toHaveAccessibleDescription('理由です')
    expect(screen.getByText('理由です')).toHaveAttribute('id', 'rid')
  })

  it('canRevertHunk が false のときは理由を出さない', () => {
    render(
      <AgentDiffNotices
        agentActions={makeActions({ canRevertHunk: false, disabledReason: '理由です' })}
        reasonId="rid"
      />
    )
    expect(screen.queryByText('理由です')).toBeNull()
  })
})
