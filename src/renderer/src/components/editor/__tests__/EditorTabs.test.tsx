import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditorTabs from '../EditorTabs'

const defaultProps = {
  fileName: 'index.ts',
  isDirty: false,
  isSaving: false,
  error: null as Error | null,
  onSave: vi.fn()
}

describe('EditorTabs', () => {
  it('fileName prop がタブに表示される', () => {
    render(<EditorTabs {...defaultProps} />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })

  it('editor-tab--active クラスがタブに付く', () => {
    render(<EditorTabs {...defaultProps} />)
    expect(screen.getByText('index.ts')).toHaveClass('editor-tab--active')
  })

  it('editor-tabs ラッパーが存在する', () => {
    const { container } = render(<EditorTabs {...defaultProps} />)
    expect(container.firstChild).toHaveClass('editor-tabs')
  })

  it('異なる fileName を渡すと表示が変わる', () => {
    const { rerender } = render(<EditorTabs {...defaultProps} fileName="App.tsx" />)
    expect(screen.getByText('App.tsx')).toBeInTheDocument()

    rerender(<EditorTabs {...defaultProps} fileName="main.py" />)
    expect(screen.getByText('main.py')).toBeInTheDocument()
    expect(screen.queryByText('App.tsx')).not.toBeInTheDocument()
  })

  it('isDirty=true のとき未保存インジケータが表示される', () => {
    render(<EditorTabs {...defaultProps} isDirty={true} />)
    expect(document.querySelector('.editor-tab__dirty-dot')).toBeInTheDocument()
  })

  it('isDirty=false のとき未保存インジケータは表示されない', () => {
    render(<EditorTabs {...defaultProps} isDirty={false} />)
    expect(document.querySelector('.editor-tab__dirty-dot')).not.toBeInTheDocument()
  })

  it('isDirty=true のとき保存ボタンが有効化される', () => {
    render(<EditorTabs {...defaultProps} isDirty={true} />)
    expect(screen.getByLabelText('保存')).not.toBeDisabled()
  })

  it('isDirty=false のとき保存ボタンが無効化される', () => {
    render(<EditorTabs {...defaultProps} isDirty={false} />)
    expect(screen.getByLabelText('保存')).toBeDisabled()
  })

  it('isSaving=true のとき、isDirty=true でも保存ボタンが無効化される（多重保存防止）', () => {
    render(<EditorTabs {...defaultProps} isDirty={true} isSaving={true} />)
    expect(screen.getByLabelText('保存')).toBeDisabled()
  })

  it('保存ボタンクリックで onSave が呼ばれる', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<EditorTabs {...defaultProps} isDirty={true} onSave={onSave} />)
    await user.click(screen.getByLabelText('保存'))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('error があるときエラーメッセージが表示される', () => {
    render(<EditorTabs {...defaultProps} error={new Error('保存に失敗しました')} />)
    expect(screen.getByText('保存に失敗しました')).toBeInTheDocument()
  })

  it('error が null のときエラーメッセージは表示されない', () => {
    render(<EditorTabs {...defaultProps} error={null} />)
    expect(document.querySelector('.editor-tabs__error')).not.toBeInTheDocument()
  })
})
