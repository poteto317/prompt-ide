import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AgentInstructionCreateButton from '../AgentInstructionCreateButton'

const renderButton = (
  overrides: Partial<{ isBlocked: boolean; isCreating: boolean; onCreate: () => void }> = {}
): void => {
  render(
    <AgentInstructionCreateButton
      path="~/.claude/CLAUDE.md"
      isBlocked={overrides.isBlocked ?? false}
      isCreating={overrides.isCreating ?? false}
      onCreate={overrides.onCreate ?? vi.fn()}
    />
  )
}

describe('AgentInstructionCreateButton', () => {
  it('パスを入れた aria-label と 作成 の文言で出し、押すと onCreate を呼ぶ', async () => {
    const onCreate = vi.fn()
    renderButton({ onCreate })
    const button = screen.getByRole('button', { name: '~/.claude/CLAUDE.md を作成' })
    expect(button).toHaveTextContent('作成')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).not.toBeDisabled()
    expect(button).not.toHaveAttribute('aria-disabled')
    await userEvent.click(button)
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('clone の実行中は disabled にし、押しても onCreate を呼ばない', async () => {
    const onCreate = vi.fn()
    renderButton({ isBlocked: true, onCreate })
    const button = screen.getByRole('button', { name: '~/.claude/CLAUDE.md を作成' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('作成の途中は aria-disabled にして押しても呼ばず、フォーカスはボタンに残る(L-157)', async () => {
    const onCreate = vi.fn()
    renderButton({ isCreating: true, onCreate })
    const button = screen.getByRole('button', { name: '~/.claude/CLAUDE.md を作成' })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(button)
    expect(onCreate).not.toHaveBeenCalled()
    expect(button).toHaveFocus()
  })
})
