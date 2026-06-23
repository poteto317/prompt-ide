import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import PromptsToolbar from '../PromptsToolbar'

const defaultProps = {
  onImport: vi.fn(),
  onExport: vi.fn(),
  isExportDisabled: false,
}

describe('PromptsToolbar', () => {
  it('インポート・エクスポートボタンが表示される', () => {
    render(<PromptsToolbar {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'プロンプトをインポート' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'プロンプトをエクスポート' })).toBeInTheDocument()
  })

  it('インポートボタンクリックで onImport が呼ばれる', async () => {
    const onImport = vi.fn()
    render(<PromptsToolbar {...defaultProps} onImport={onImport} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトをインポート' }))
    expect(onImport).toHaveBeenCalledOnce()
  })

  it('エクスポートボタンクリックで onExport が呼ばれる', async () => {
    const onExport = vi.fn()
    render(<PromptsToolbar {...defaultProps} onExport={onExport} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトをエクスポート' }))
    expect(onExport).toHaveBeenCalledOnce()
  })

  it('isExportDisabled=true のときエクスポートボタンが disabled になる', () => {
    render(<PromptsToolbar {...defaultProps} isExportDisabled={true} />)
    expect(screen.getByRole('button', { name: 'プロンプトをエクスポート' })).toBeDisabled()
  })

  it('isExportDisabled=true でもインポートボタンは有効', () => {
    render(<PromptsToolbar {...defaultProps} isExportDisabled={true} />)
    expect(screen.getByRole('button', { name: 'プロンプトをインポート' })).toBeEnabled()
  })
})
