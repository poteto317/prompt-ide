import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditorTabs from '../EditorTabs'

const defaultProps = {
  fileName: 'index.ts',
  isDirty: false,
  isSaving: false,
  saveError: null as Error | null,
  onSave: vi.fn(),
  onClose: vi.fn()
}

describe('EditorTabs', () => {
  it('editor-tabs ラッパーが存在する', () => {
    const { container } = render(<EditorTabs {...defaultProps} />)
    expect(container.firstChild).toHaveClass('editor-tabs')
  })

  it('EditorTab（ファイル名）と EditorSaveControl（保存ボタン）の両方が描画される', () => {
    render(<EditorTabs {...defaultProps} />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
    expect(screen.getByLabelText('保存')).toBeInTheDocument()
  })

  it('onClose は EditorTab の閉じるボタンに配線される', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<EditorTabs {...defaultProps} onClose={onClose} />)
    await user.click(screen.getByLabelText('タブを閉じる'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('onSave は EditorSaveControl の保存ボタンに配線される', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<EditorTabs {...defaultProps} isDirty={true} onSave={onSave} />)
    await user.click(screen.getByLabelText('保存'))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('saveError は EditorSaveControl 側に配線される', () => {
    render(<EditorTabs {...defaultProps} saveError={new Error('保存に失敗しました')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('保存に失敗しました')
  })

  it('isDirty は EditorTab（未保存インジケータ）と EditorSaveControl（保存ボタン活性）の両方に配線される', () => {
    render(<EditorTabs {...defaultProps} isDirty={true} />)
    expect(document.querySelector('.editor-tab__dirty-dot')).toBeInTheDocument()
    expect(screen.getByLabelText('保存')).not.toBeDisabled()
  })

  it('onClose が未指定のとき閉じるボタンは表示されない（例: WelcomeView のプレースホルダータブ）', () => {
    render(
      <EditorTabs
        fileName={defaultProps.fileName}
        isDirty={defaultProps.isDirty}
        isSaving={defaultProps.isSaving}
        saveError={defaultProps.saveError}
        onSave={defaultProps.onSave}
      />
    )
    expect(screen.queryByLabelText('タブを閉じる')).not.toBeInTheDocument()
  })
})
