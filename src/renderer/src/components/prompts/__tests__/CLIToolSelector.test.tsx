import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import CLIToolSelector from '../CLIToolSelector'

const defaultProps = {
  selectedTool: 'claude' as const,
  onSelectTool: vi.fn(),
}

describe('CLIToolSelector', () => {
  it('実行ツールを選択のセレクトボックスが表示される', () => {
    render(<CLIToolSelector {...defaultProps} />)
    expect(screen.getByRole('combobox', { name: '実行ツールを選択' })).toBeInTheDocument()
  })

  it('全ツールがオプションとして表示される', () => {
    render(<CLIToolSelector {...defaultProps} />)
    expect(screen.getByRole('option', { name: 'Claude CLI' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'GitHub Copilot' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Claude API' })).toBeInTheDocument()
  })

  it('selectedTool が claude のとき Claude CLI が選択状態になる', () => {
    render(<CLIToolSelector {...defaultProps} selectedTool="claude" />)
    expect(screen.getByRole('combobox', { name: '実行ツールを選択' })).toHaveValue('claude')
  })

  it('selectedTool が copilot のとき GitHub Copilot が選択状態になる', () => {
    render(<CLIToolSelector {...defaultProps} selectedTool="copilot" />)
    expect(screen.getByRole('combobox', { name: '実行ツールを選択' })).toHaveValue('copilot')
  })

  it('selectedTool が api のとき Claude API が選択状態になる', () => {
    render(<CLIToolSelector {...defaultProps} selectedTool="api" />)
    expect(screen.getByRole('combobox', { name: '実行ツールを選択' })).toHaveValue('api')
  })

  it('セレクトボックスを変更すると onSelectTool が呼ばれる', async () => {
    const onSelectTool = vi.fn()
    render(<CLIToolSelector {...defaultProps} onSelectTool={onSelectTool} />)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '実行ツールを選択' }),
      'copilot'
    )
    expect(onSelectTool).toHaveBeenCalledWith('copilot')
  })

})
