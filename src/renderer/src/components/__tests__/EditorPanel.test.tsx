import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { OpenFile } from '../../types'
import EditorPanel from '../EditorPanel'

const mockOpenFile: OpenFile = {
  path: '/project/src/index.ts',
  name: 'index.ts',
  content: 'const x = 1',
  language: 'typescript',
}

const defaultProps = {
  openFile: null as OpenFile | null,
  isExecuting: false,
  result: null as string | null,
  executionError: null as Error | null,
  onClearResult: vi.fn(),
}

describe('EditorPanel — openFile なし', () => {
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

  it('エディタは readOnly: true で描画される（ファイルビューア）', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} />)
    expect(screen.getByTestId('monaco-editor')).toHaveAttribute('data-readonly', 'true')
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
