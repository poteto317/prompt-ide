import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ModelSettingsSection from '../ModelSettingsSection'

const defaultProps = {
  initialSettings: { modelId: 'claude-haiku-4-5' as const, maxTokens: 4096 },
  isSaving: false,
  saved: false,
  saveError: null as string | null,
  onSave: vi.fn().mockResolvedValue(undefined)
}

describe('ModelSettingsSection', () => {
  it('モデル選択と max_tokens 入力が表示される', () => {
    render(<ModelSettingsSection {...defaultProps} />)
    expect(screen.getByLabelText('モデル')).toBeInTheDocument()
    expect(screen.getByLabelText('max_tokens')).toBeInTheDocument()
  })

  it('max_tokens ラベルの括弧は全角で統一されている(半角・全角混在の表記ゆれ防止)', () => {
    render(<ModelSettingsSection {...defaultProps} />)
    expect(screen.getByText('max_tokens（1〜64000）')).toBeInTheDocument()
  })

  it('initialSettings の値が反映される', () => {
    render(
      <ModelSettingsSection
        {...defaultProps}
        initialSettings={{ modelId: 'claude-opus-4-8', maxTokens: 8000 }}
      />
    )
    expect(screen.getByLabelText('モデル')).toHaveValue('claude-opus-4-8')
    expect(screen.getByLabelText('max_tokens')).toHaveValue(8000)
  })

  it('保存ボタンをクリックすると現在の入力値で onSave が呼ばれる', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ModelSettingsSection {...defaultProps} onSave={onSave} />)
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledWith({ modelId: 'claude-haiku-4-5', maxTokens: 4096 })
  })

  it('saved が true のとき「保存しました」が表示される', () => {
    render(<ModelSettingsSection {...defaultProps} saved={true} />)
    expect(screen.getByText('保存しました')).toBeInTheDocument()
  })

  it('saveError があるときエラーメッセージが表示される', () => {
    render(<ModelSettingsSection {...defaultProps} saveError="保存に失敗しました" />)
    expect(screen.getByText('保存に失敗しました')).toBeInTheDocument()
  })

  it('isSaving のとき入力と保存ボタンが disabled になる', () => {
    render(<ModelSettingsSection {...defaultProps} isSaving={true} />)
    expect(screen.getByLabelText('モデル')).toBeDisabled()
    expect(screen.getByLabelText('max_tokens')).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('モデルを変更すると select の値が更新される', async () => {
    const user = userEvent.setup()
    render(<ModelSettingsSection {...defaultProps} />)
    await user.selectOptions(screen.getByLabelText('モデル'), 'claude-opus-4-8')
    expect(screen.getByLabelText('モデル')).toHaveValue('claude-opus-4-8')
  })

  it('max_tokens が上限を超える値のとき保存ボタンが disabled になる', async () => {
    const user = userEvent.setup()
    render(<ModelSettingsSection {...defaultProps} />)
    const input = screen.getByLabelText('max_tokens')
    await user.clear(input)
    await user.type(input, '999999')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })
})
