import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import type { OpenFile } from '../../types'
import EditorPanel from '../EditorPanel'

const mockOpenFile: OpenFile = {
  path: '/project/src/index.ts',
  name: 'index.ts',
  content: 'const x = 1',
  language: 'typescript',
}

describe('EditorPanel — openFile なし', () => {
  it('"welcome.ts" タブが描画される', () => {
    render(<EditorPanel openFile={null} />)
    expect(screen.getByText('welcome.ts')).toBeInTheDocument()
  })

  it('タブに editor-tab--active クラスが付く', () => {
    render(<EditorPanel openFile={null} />)
    expect(screen.getByText('welcome.ts')).toHaveClass('editor-tab--active')
  })

  it('Monaco Editor のモックが描画される', () => {
    render(<EditorPanel openFile={null} />)
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
  })
})

describe('EditorPanel — openFile あり', () => {
  it('ファイル名がタブに表示される', () => {
    render(<EditorPanel openFile={mockOpenFile} />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })

  it('タブに editor-tab--active クラスが付く', () => {
    render(<EditorPanel openFile={mockOpenFile} />)
    expect(screen.getByText('index.ts')).toHaveClass('editor-tab--active')
  })

  it('"welcome.ts" タブは表示されない', () => {
    render(<EditorPanel openFile={mockOpenFile} />)
    expect(screen.queryByText('welcome.ts')).not.toBeInTheDocument()
  })

  it('Monaco Editor のモックが描画される', () => {
    render(<EditorPanel openFile={mockOpenFile} />)
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
  })
})
