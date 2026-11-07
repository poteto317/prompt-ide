import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AgentInstructionGlobalList from '../AgentInstructionGlobalList'
import type { AgentGlobalInstructionRow } from '../../../types'
import { AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED } from '../../../lib/agentInstructionMessages'

const DESCRIPTION = '個人の指示(全部のプロジェクトに効きます)'
const existsRow: AgentGlobalInstructionRow = {
  kind: 'exists',
  displayPath: '~/.claude/CLAUDE.md',
  description: DESCRIPTION,
  node: { type: 'file', name: '~/.claude/CLAUDE.md', path: '/h/.claude/CLAUDE.md' }
}
const missingRow: AgentGlobalInstructionRow = {
  kind: 'missing',
  displayPath: '~/.claude/CLAUDE.md',
  description: DESCRIPTION
}

const renderList = (
  row: AgentGlobalInstructionRow,
  overrides: Partial<{
    isBlocked: boolean
    isCreating: boolean
    onOpen: () => void
    onCreate: () => void
  }> = {}
): void => {
  render(
    <AgentInstructionGlobalList
      cliKind="claude"
      row={row}
      isBlocked={overrides.isBlocked ?? false}
      isCreating={overrides.isCreating ?? false}
      onOpen={overrides.onOpen ?? vi.fn()}
      onCreate={overrides.onCreate ?? vi.fn()}
    />
  )
}

describe('AgentInstructionGlobalList', () => {
  it('小見出し 全体(すべてのプロジェクト) を出す', () => {
    renderList(missingRow)
    expect(
      screen.getByRole('heading', { level: 4, name: '全体(すべてのプロジェクト)' })
    ).toBeInTheDocument()
  })

  it('exists → ~/… のパスと説明と 開く', async () => {
    const onOpen = vi.fn()
    renderList(existsRow, { onOpen })
    expect(screen.getByText('~/.claude/CLAUDE.md')).toBeInTheDocument()
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument()
    expect(screen.queryByText('/h/.claude/CLAUDE.md')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '~/.claude/CLAUDE.md を開く' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('missing → 作成', async () => {
    const onCreate = vi.fn()
    renderList(missingRow, { onCreate })
    await userEvent.click(screen.getByRole('button', { name: '~/.claude/CLAUDE.md を作成' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('loading → 確かめています… でボタンが無い', () => {
    renderList({ kind: 'loading' })
    expect(screen.getByText('確かめています…')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('blocked → 文言だけで、ボタンが無く、role="alert" でもない', () => {
    renderList({
      kind: 'blocked',
      displayPath: '~/.claude/CLAUDE.md',
      message: AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED
    })
    expect(screen.getByText('~/.claude/CLAUDE.md')).toBeInTheDocument()
    expect(screen.getByText(AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('blocked でパスが無い → 文言だけを出す', () => {
    renderList({
      kind: 'blocked',
      displayPath: null,
      message: AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED
    })
    expect(screen.getByRole('listitem')).toHaveTextContent(AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED)
    expect(screen.queryByText(/~\//)).not.toBeInTheDocument()
  })

  it('clone 中 → 作成 が disabled', () => {
    renderList(missingRow, { isBlocked: true })
    expect(screen.getByRole('button', { name: '~/.claude/CLAUDE.md を作成' })).toBeDisabled()
  })

  it('clone 中 → 開く も disabled', () => {
    renderList(existsRow, { isBlocked: true })
    expect(screen.getByRole('button', { name: '~/.claude/CLAUDE.md を開く' })).toBeDisabled()
  })

  it('作成の途中 → aria-disabled で、押しても呼ばず、フォーカスが残る', async () => {
    const onCreate = vi.fn()
    renderList(missingRow, { isCreating: true, onCreate })
    const button = screen.getByRole('button', { name: '~/.claude/CLAUDE.md を作成' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(button)
    expect(onCreate).not.toHaveBeenCalled()
    expect(button).toHaveFocus()
  })

  it('作成の途中 → 開く も aria-disabled で、押しても呼ばない', async () => {
    const onOpen = vi.fn()
    renderList(existsRow, { isCreating: true, onOpen })
    const button = screen.getByRole('button', { name: '~/.claude/CLAUDE.md を開く' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(button)
    expect(onOpen).not.toHaveBeenCalled()
  })
})
