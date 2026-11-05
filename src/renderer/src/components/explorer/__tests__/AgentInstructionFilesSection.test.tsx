import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  AGENT_INSTRUCTION_FILES,
  agentInstructionRelativePath
} from '@shared/agentInstructionFiles'
import AgentInstructionFilesSection from '../AgentInstructionFilesSection'
import { makeAgentInstructionsPanelState } from '../../../__tests__/makeAgentInstructionsPanelState'
import type { AgentInstructionFileRow } from '../../../types'

const claudeRows = (existing: string[]): AgentInstructionFileRow[] =>
  AGENT_INSTRUCTION_FILES.claude.map((file) => {
    const relativePath = agentInstructionRelativePath(file)
    return {
      file,
      relativePath,
      node: existing.includes(relativePath)
        ? {
            name: file.segments[file.segments.length - 1],
            path: `/p/${relativePath}`,
            type: 'file'
          }
        : null
    }
  })

describe('AgentInstructionFilesSection', () => {
  it('見出しに CLI の表示名を出す', () => {
    render(
      <AgentInstructionFilesSection state={makeAgentInstructionsPanelState()} isBlocked={false} />
    )
    expect(
      screen.getByRole('region', { name: 'エージェントの指示ファイル(Claude Code)' })
    ).toBeInTheDocument()
  })

  it('copilot → 見出しは GitHub Copilot CLI', () => {
    const rows = AGENT_INSTRUCTION_FILES.copilot.map((file) => ({
      file,
      relativePath: agentInstructionRelativePath(file),
      node: null
    }))
    render(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ cliKind: 'copilot', rows })}
        isBlocked={false}
      />
    )
    expect(
      screen.getByRole('region', { name: 'エージェントの指示ファイル(GitHub Copilot CLI)' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AGENTS.md を作成' })).toBeInTheDocument()
  })

  it('ある行は 開く、無い行は 作成。行にパスと説明を出す', () => {
    render(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ rows: claudeRows(['CLAUDE.md']) })}
        isBlocked={false}
      />
    )
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText('CLAUDE.md')).toBeInTheDocument()
    expect(within(items[0]).getByText('共有の指示')).toBeInTheDocument()
    expect(within(items[0]).getByRole('button', { name: 'CLAUDE.md を開く' })).toHaveTextContent(
      '開く'
    )
    expect(
      within(items[1]).getByRole('button', { name: '.claude/CLAUDE.md を作成' })
    ).toHaveTextContent('作成')
  })

  it('開く・作成 → state の open・create をその行で呼ぶ', async () => {
    const state = makeAgentInstructionsPanelState({ rows: claudeRows(['CLAUDE.md']) })
    render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'CLAUDE.md を開く' }))
    expect(state.open).toHaveBeenCalledWith(state.rows[0])
    await userEvent.click(screen.getByRole('button', { name: 'CLAUDE.local.md を作成' }))
    expect(state.create).toHaveBeenCalledWith(state.rows[2])
  })

  it('clone 中 → すべてのボタンが disabled', () => {
    render(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ rows: claudeRows(['CLAUDE.md']) })}
        isBlocked
      />
    )
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('作成中 → disabled ではなく aria-disabled="true"。押しても open・create を呼ばない', async () => {
    const state = makeAgentInstructionsPanelState({
      rows: claudeRows(['CLAUDE.md']),
      isCreating: true
    })
    render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toBeDisabled()
      expect(button).toHaveAttribute('aria-disabled', 'true')
    }
    await userEvent.click(screen.getByRole('button', { name: 'CLAUDE.md を開く' }))
    await userEvent.click(screen.getByRole('button', { name: 'CLAUDE.local.md を作成' }))
    expect(state.open).not.toHaveBeenCalled()
    expect(state.create).not.toHaveBeenCalled()
  })

  it('作成中でなければ aria-disabled を付けない', () => {
    render(
      <AgentInstructionFilesSection state={makeAgentInstructionsPanelState()} isBlocked={false} />
    )
    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAttribute('aria-disabled')
    }
  })

  it('押した 作成 が作成中に変わっても、フォーカスは押したボタンに残る(body に落ちない)', async () => {
    const rows = claudeRows([])
    const { rerender } = render(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ rows })}
        isBlocked={false}
      />
    )
    const button = screen.getByRole('button', { name: 'CLAUDE.md を作成' })
    button.focus()
    expect(document.activeElement).toBe(button)
    rerender(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ rows, isCreating: true })}
        isBlocked={false}
      />
    )
    expect(screen.getByRole('button', { name: 'CLAUDE.md を作成' })).toBe(button)
    expect(document.activeElement).toBe(button)
  })

  it('文言 → role=alert で出す。無ければ alert は無い', () => {
    const { rerender } = render(
      <AgentInstructionFilesSection state={makeAgentInstructionsPanelState()} isBlocked={false} />
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    rerender(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ message: 'フォルダの外には作成できません' })}
        isBlocked={false}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('フォルダの外には作成できません')
  })
})
