import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditorSaveControl from '../EditorSaveControl'

const defaultProps = {
  isDirty: false,
  isSaving: false,
  saveError: null as Error | null,
  onSave: vi.fn()
}

describe('EditorSaveControl', () => {
  it('isDirty=true のとき保存ボタンが有効化される', () => {
    render(<EditorSaveControl {...defaultProps} isDirty={true} />)
    expect(screen.getByLabelText('保存')).not.toBeDisabled()
  })

  it('isDirty=false のとき保存ボタンが無効化される', () => {
    render(<EditorSaveControl {...defaultProps} isDirty={false} />)
    expect(screen.getByLabelText('保存')).toBeDisabled()
  })

  it('isSaving=true のとき、isDirty=true でも保存ボタンが無効化される（多重保存防止）', () => {
    render(<EditorSaveControl {...defaultProps} isDirty={true} isSaving={true} />)
    expect(screen.getByLabelText('保存')).toBeDisabled()
  })

  it('isDirty=false かつ isSaving=true でも保存ボタンは無効化されたままである', () => {
    render(<EditorSaveControl {...defaultProps} isDirty={false} isSaving={true} />)
    expect(screen.getByLabelText('保存')).toBeDisabled()
  })

  it('保存ボタンクリックで onSave が呼ばれる', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<EditorSaveControl {...defaultProps} isDirty={true} onSave={onSave} />)
    await user.click(screen.getByLabelText('保存'))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('saveError があるときエラーメッセージが表示される', () => {
    render(<EditorSaveControl {...defaultProps} saveError={new Error('保存に失敗しました')} />)
    expect(screen.getByText('保存に失敗しました')).toBeInTheDocument()
  })

  it('saveError があるときエラーメッセージに role="alert" が付き、スクリーンリーダーにアナウンスされる', () => {
    render(<EditorSaveControl {...defaultProps} saveError={new Error('保存に失敗しました')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('保存に失敗しました')
  })

  it('saveError が null のときエラーメッセージは表示されない', () => {
    render(<EditorSaveControl {...defaultProps} saveError={null} />)
    expect(document.querySelector('.editor-tabs__error')).not.toBeInTheDocument()
  })
})
