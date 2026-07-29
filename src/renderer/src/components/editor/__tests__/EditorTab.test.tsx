import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditorTab from '../EditorTab'

const defaultProps = {
  fileName: 'index.ts',
  isDirty: false,
  onClose: vi.fn()
}

describe('EditorTab', () => {
  it('fileName prop がタブに表示される', () => {
    render(<EditorTab {...defaultProps} />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })

  it('editor-tab--active クラスがタブに付く', () => {
    render(<EditorTab {...defaultProps} />)
    expect(screen.getByText('index.ts')).toHaveClass('editor-tab--active')
  })

  it('異なる fileName を渡すと表示が変わる', () => {
    const { rerender } = render(<EditorTab {...defaultProps} fileName="App.tsx" />)
    expect(screen.getByText('App.tsx')).toBeInTheDocument()

    rerender(<EditorTab {...defaultProps} fileName="main.py" />)
    expect(screen.getByText('main.py')).toBeInTheDocument()
    expect(screen.queryByText('App.tsx')).not.toBeInTheDocument()
  })

  it('isDirty=true のとき未保存インジケータが表示される', () => {
    render(<EditorTab {...defaultProps} isDirty={true} />)
    expect(document.querySelector('.editor-tab__dirty-dot')).toBeInTheDocument()
  })

  it('isDirty=false のとき未保存インジケータは表示されない', () => {
    render(<EditorTab {...defaultProps} isDirty={false} />)
    expect(document.querySelector('.editor-tab__dirty-dot')).not.toBeInTheDocument()
  })

  it('未保存インジケータは role="img" と aria-label でスクリーンリーダーに状態が伝わる', () => {
    render(<EditorTab {...defaultProps} isDirty={true} />)
    expect(screen.getByRole('img', { name: '未保存の変更があります' })).toBeInTheDocument()
  })

  it('閉じるボタンが aria-label 付きで表示される', () => {
    render(<EditorTab {...defaultProps} />)
    expect(screen.getByLabelText('タブを閉じる')).toBeInTheDocument()
  })

  it('閉じるボタンクリックで onClose が呼ばれる', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<EditorTab {...defaultProps} onClose={onClose} />)
    await user.click(screen.getByLabelText('タブを閉じる'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('閉じるボタンを複数回クリックすると onClose もその回数だけ呼ばれる', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<EditorTab {...defaultProps} onClose={onClose} />)
    const closeButton = screen.getByLabelText('タブを閉じる')
    await user.click(closeButton)
    await user.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('onClose が未指定のとき閉じるボタンは表示されない（例: WelcomeView のプレースホルダータブ）', () => {
    render(<EditorTab fileName={defaultProps.fileName} isDirty={defaultProps.isDirty} />)
    expect(screen.queryByLabelText('タブを閉じる')).not.toBeInTheDocument()
  })
})
