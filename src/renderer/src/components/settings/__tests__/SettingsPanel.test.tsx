import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import SettingsPanel from '../SettingsPanel'

const defaultProps = {
  hasKey: false,
  apiKeyLoaded: true,
  onSave: vi.fn(),
}

describe('SettingsPanel', () => {
  it('API キー入力フィールドが表示される', () => {
    render(<SettingsPanel {...defaultProps} />)
    expect(screen.getByLabelText('API キー')).toBeInTheDocument()
  })

  it('apiKeyLoaded=false のとき input が disabled になる', () => {
    render(<SettingsPanel {...defaultProps} apiKeyLoaded={false} />)
    expect(screen.getByLabelText('API キー')).toBeDisabled()
  })

  it('apiKeyLoaded=false のとき保存ボタンが disabled になる', () => {
    render(<SettingsPanel {...defaultProps} apiKeyLoaded={false} />)
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('入力が空のとき保存ボタンが disabled になる', () => {
    render(<SettingsPanel {...defaultProps} />)
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('キーを入力して保存ボタンをクリックすると onSave が呼ばれる', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPanel {...defaultProps} onSave={onSave} />)
    await user.type(screen.getByLabelText('API キー'), 'sk-ant-test')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledWith('sk-ant-test')
  })

  it('保存後に「保存しました」メッセージが表示される', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPanel {...defaultProps} onSave={onSave} />)
    await user.type(screen.getByLabelText('API キー'), 'sk-ant-test')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByText('保存しました')).toBeInTheDocument()
  })

  it('onSave が reject したときエラーメッセージが表示される', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('キーストアが利用できません'))
    render(<SettingsPanel {...defaultProps} onSave={onSave} />)
    await user.type(screen.getByLabelText('API キー'), 'sk-ant-test')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByText('キーストアが利用できません')).toBeInTheDocument()
    expect(screen.queryByText('保存しました')).not.toBeInTheDocument()
  })

  it('hasKey=true のとき「設定済み」インジケーターが表示される', () => {
    render(<SettingsPanel {...defaultProps} hasKey={true} />)
    expect(screen.getByText(/設定済み/)).toBeInTheDocument()
  })

  it('hasKey=false のとき「設定済み」インジケーターが表示されない', () => {
    render(<SettingsPanel {...defaultProps} hasKey={false} />)
    expect(screen.queryByText(/設定済み/)).not.toBeInTheDocument()
  })

  it('hasKey=true のとき placeholder が変わる', () => {
    render(<SettingsPanel {...defaultProps} hasKey={true} />)
    const input = screen.getByLabelText('API キー') as HTMLInputElement
    expect(input.placeholder).toBe('新しいキーを入力...')
  })

  it('hasKey=false のとき placeholder が sk-ant-... になる', () => {
    render(<SettingsPanel {...defaultProps} hasKey={false} />)
    const input = screen.getByLabelText('API キー') as HTMLInputElement
    expect(input.placeholder).toBe('sk-ant-...')
  })
})
