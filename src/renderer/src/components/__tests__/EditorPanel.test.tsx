import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { OpenFile } from '../../types'
import EditorPanel from '../EditorPanel'

const mockOpenFile: OpenFile = {
  path: '/project/src/index.ts',
  name: 'index.ts',
  content: 'const x = 1',
  savedContent: 'const x = 1',
  language: 'typescript'
}

const defaultProps = {
  openFile: null as OpenFile | null,
  isDirty: false,
  isSaving: false,
  saveError: null as Error | null,
  onChangeContent: vi.fn(),
  onSave: vi.fn(),
  isExecuting: false,
  result: null as string | null,
  executionError: null as Error | null,
  onClearResult: vi.fn()
}

describe('EditorPanel — openFile なし', () => {
  it('.editor-panel が入れ子にならない（WelcomeView との二重ラッパー防止）', () => {
    const { container } = render(<EditorPanel {...defaultProps} />)
    expect(container.querySelectorAll('.editor-panel')).toHaveLength(1)
  })

  it('"welcome.ts" タブが描画される', () => {
    render(<EditorPanel {...defaultProps} />)
    expect(screen.getByText('welcome.ts')).toBeInTheDocument()
  })

  it('タブに editor-tab--active クラスが付く', () => {
    render(<EditorPanel {...defaultProps} />)
    expect(screen.getByText('welcome.ts')).toHaveClass('editor-tab--active')
  })

  it('Monaco Editor のモックが描画される', () => {
    render(<EditorPanel {...defaultProps} />)
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
  })
})

describe('EditorPanel — openFile あり', () => {
  it('ファイル名がタブに表示される', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })

  it('タブに editor-tab--active クラスが付く', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} />)
    expect(screen.getByText('index.ts')).toHaveClass('editor-tab--active')
  })

  it('"welcome.ts" タブは表示されない', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} />)
    expect(screen.queryByText('welcome.ts')).not.toBeInTheDocument()
  })

  it('Monaco Editor のモックが描画される', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} />)
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
  })

  it('エディタは読み取り専用ではない（編集可能）', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} />)
    expect(screen.getByTestId('monaco-editor')).toHaveAttribute('data-readonly', 'false')
  })

  it('エディタでの入力が onChangeContent を呼ぶ', async () => {
    const user = userEvent.setup()
    const onChangeContent = vi.fn()
    render(
      <EditorPanel {...defaultProps} openFile={mockOpenFile} onChangeContent={onChangeContent} />
    )
    await user.type(screen.getByTestId('monaco-editor-textarea'), 'x')
    expect(onChangeContent).toHaveBeenCalled()
  })

  it('isDirty=true のとき保存ボタンが有効化される', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} isDirty={true} />)
    expect(screen.getByLabelText('保存')).not.toBeDisabled()
  })

  it('isDirty=false のとき保存ボタンが無効化される', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} isDirty={false} />)
    expect(screen.getByLabelText('保存')).toBeDisabled()
  })

  it('保存ボタンクリックで onSave が呼ばれる', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} isDirty={true} onSave={onSave} />)
    await user.click(screen.getByLabelText('保存'))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('isSaving=true のとき、isDirty=true でも保存ボタンが無効化される（多重保存防止）', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} isDirty={true} isSaving={true} />)
    expect(screen.getByLabelText('保存')).toBeDisabled()
  })

  it('未保存インジケータは isDirty=true のときのみ表示される', () => {
    const { rerender } = render(
      <EditorPanel {...defaultProps} openFile={mockOpenFile} isDirty={false} />
    )
    expect(document.querySelector('.editor-tab__dirty-dot')).not.toBeInTheDocument()

    rerender(<EditorPanel {...defaultProps} openFile={mockOpenFile} isDirty={true} />)
    expect(document.querySelector('.editor-tab__dirty-dot')).toBeInTheDocument()
  })

  it('saveError があるときエディタ上部にエラーメッセージが表示される', () => {
    render(
      <EditorPanel
        {...defaultProps}
        openFile={mockOpenFile}
        saveError={new Error('保存に失敗しました')}
      />
    )
    expect(screen.getByText('保存に失敗しました')).toBeInTheDocument()
  })
})

describe('EditorPanel — OutputPanel 連携', () => {
  it('isExecuting=true のとき「実行中...」が表示される', () => {
    render(<EditorPanel {...defaultProps} isExecuting={true} />)
    expect(screen.getByText('実行中...')).toBeInTheDocument()
  })

  it('result があるとき OutputPanel にテキストが表示される', () => {
    render(<EditorPanel {...defaultProps} result="回答テキスト" />)
    expect(screen.getByText('回答テキスト')).toBeInTheDocument()
  })

  it('executionError があるときエラーメッセージが表示される', () => {
    render(<EditorPanel {...defaultProps} executionError={new Error('api error')} />)
    expect(screen.getByText('api error')).toBeInTheDocument()
  })

  it('クリアボタンクリックで onClearResult が呼ばれる', async () => {
    const user = userEvent.setup()
    const onClearResult = vi.fn()
    render(<EditorPanel {...defaultProps} result="テキスト" onClearResult={onClearResult} />)
    await user.click(screen.getByRole('button', { name: '出力をクリア' }))
    expect(onClearResult).toHaveBeenCalledOnce()
  })
})
