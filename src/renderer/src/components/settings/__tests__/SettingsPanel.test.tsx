import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import SettingsPanel from '../SettingsPanel'

const defaultProps = {
  apiKey: '',
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
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByText('保存しました')).toBeInTheDocument()
  })

  it('既存の apiKey が input に表示される', () => {
    render(<SettingsPanel {...defaultProps} apiKey="sk-ant-existing" />)
    const input = screen.getByLabelText('API キー') as HTMLInputElement
    expect(input.value).toBe('sk-ant-existing')
  })

  it('apiKeyLoaded が false → true になると inputValue が apiKey に同期される', () => {
    const { rerender } = render(
      <SettingsPanel apiKey="" apiKeyLoaded={false} onSave={vi.fn()} />
    )
    const input = screen.getByLabelText('API キー') as HTMLInputElement
    expect(input.value).toBe('')

    rerender(<SettingsPanel apiKey="sk-ant-loaded" apiKeyLoaded={true} onSave={vi.fn()} />)
    expect(input.value).toBe('sk-ant-loaded')
  })
})
