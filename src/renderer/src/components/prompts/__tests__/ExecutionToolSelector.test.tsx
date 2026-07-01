import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ExecutionToolSelector from '../ExecutionToolSelector'

const defaultProps = {
  selectedTool: 'claude' as const,
  onSelectTool: vi.fn(),
}

describe('ExecutionToolSelector', () => {
  it('実行ツールを選択のセレクトボックスが表示される', () => {
    render(<ExecutionToolSelector {...defaultProps} />)
    expect(screen.getByRole('combobox', { name: '実行ツールを選択' })).toBeInTheDocument()
  })

  it('全ツールがオプションとして表示される', () => {
    render(<ExecutionToolSelector {...defaultProps} />)
    expect(screen.getByRole('option', { name: 'Claude CLI' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'GitHub Copilot' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Claude API' })).toBeInTheDocument()
  })

  it('selectedTool が claude のとき Claude CLI が選択状態になる', () => {
    render(<ExecutionToolSelector {...defaultProps} selectedTool="claude" />)
    expect(screen.getByRole('combobox', { name: '実行ツールを選択' })).toHaveValue('claude')
  })

  it('selectedTool が copilot のとき GitHub Copilot が選択状態になる', () => {
    render(<ExecutionToolSelector {...defaultProps} selectedTool="copilot" />)
    expect(screen.getByRole('combobox', { name: '実行ツールを選択' })).toHaveValue('copilot')
  })

  it('selectedTool が api のとき Claude API が選択状態になる', () => {
    render(<ExecutionToolSelector {...defaultProps} selectedTool="api" />)
    expect(screen.getByRole('combobox', { name: '実行ツールを選択' })).toHaveValue('api')
  })

  it('セレクトボックスを変更すると onSelectTool が呼ばれる', async () => {
    const onSelectTool = vi.fn()
    render(<ExecutionToolSelector {...defaultProps} onSelectTool={onSelectTool} />)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '実行ツールを選択' }),
      'copilot'
    )
    expect(onSelectTool).toHaveBeenCalledWith('copilot')
  })

  it('EXECUTION_TOOLS に存在しない値を onChange で受け取っても onSelectTool は呼ばれない', () => {
    const onSelectTool = vi.fn()
    render(<ExecutionToolSelector {...defaultProps} onSelectTool={onSelectTool} />)
    const select = screen.getByRole('combobox', { name: '実行ツールを選択' })
    // DOM 上で value を直接改ざんして無効値を送り込む
    Object.defineProperty(select, 'value', { value: 'invalid-tool', writable: true })
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(onSelectTool).not.toHaveBeenCalled()
  })
})
