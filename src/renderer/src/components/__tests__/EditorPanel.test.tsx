import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import EditorPanel from '../EditorPanel'

describe('EditorPanel', () => {
  it('"welcome.ts" タブが描画される', () => {
    render(<EditorPanel />)
    expect(screen.getByText('welcome.ts')).toBeInTheDocument()
  })

  it('タブに editor-tab--active クラスが付く', () => {
    render(<EditorPanel />)
    expect(screen.getByText('welcome.ts')).toHaveClass('editor-tab--active')
  })

  it('Monaco Editor のモックが描画される', () => {
    render(<EditorPanel />)
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
  })
})
