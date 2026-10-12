import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import AgentHunkRevertAction, {
  AgentDiffAnnouncer,
  AgentDiffNotices
} from '../AgentHunkRevertAction'
import { makeAgentDiffActions } from '../../../__tests__/makeAgentChangesState'

describe('AgentHunkRevertAction', () => {
  it('押すと patch と hunkHeader を onRevertHunk へ渡す', async () => {
    const actions = makeAgentDiffActions()
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
        agentActions={makeAgentDiffActions({ canRevertHunk: false })}
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
        agentActions={makeAgentDiffActions({ disabledReason: '理由です' })}
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
        agentActions={makeAgentDiffActions()}
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
        agentActions={makeAgentDiffActions()}
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
  // 読み上げは AgentDiffAnnouncer(ハンク)とセクションの alert(ファイル)が行う。diff の作り直しで消える要素に alert を置かない
  it('error を見た目だけに出す(role="alert" にしない)', () => {
    render(
      <AgentDiffNotices agentActions={makeAgentDiffActions({ error: '失敗した' })} reasonId="r" />
    )
    expect(screen.getByText('失敗した')).toHaveClass('diff-view__error')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('error が null なら何も出さない', () => {
    const { container } = render(
      <AgentDiffNotices agentActions={makeAgentDiffActions()} reasonId="r" />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('理由の段落に reasonId が付き、ボタンの aria-describedby から参照できる', () => {
    render(
      <>
        <AgentDiffNotices
          agentActions={makeAgentDiffActions({ disabledReason: '理由です' })}
          reasonId="rid"
        />
        <AgentHunkRevertAction
          agentActions={makeAgentDiffActions({ disabledReason: '理由です' })}
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
        agentActions={makeAgentDiffActions({ canRevertHunk: false, disabledReason: '理由です' })}
        reasonId="rid"
      />
    )
    expect(screen.queryByText('理由です')).toBeNull()
  })
})

describe('AgentDiffAnnouncer', () => {
  it('通知が無い間も空の aria-live の要素を置き、通知の文言を同じ要素に入れる(パターン 87)', () => {
    const { container, rerender } = render(<AgentDiffAnnouncer notice={null} />)
    const live = container.querySelector('[aria-live="polite"]')
    expect(live).not.toBeNull()
    expect(live).toHaveAttribute('aria-atomic', 'true')
    expect(live).toHaveTextContent('')
    rerender(<AgentDiffAnnouncer notice={{ text: '戻しました', id: 1 }} />)
    expect(container.querySelector('[aria-live="polite"]')).toBe(live)
    expect(live?.textContent).toBe('戻しました')
    // 同じ文言が続いても読み上げ直されるよう、id ごとに文字列を変える
    rerender(<AgentDiffAnnouncer notice={{ text: '戻しました', id: 2 }} />)
    expect(live?.textContent).toBe('戻しました\u200b')
  })
})
