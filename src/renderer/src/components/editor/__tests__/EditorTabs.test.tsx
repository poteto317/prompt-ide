import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import EditorTabs from '../EditorTabs'

describe('EditorTabs', () => {
  it('fileName prop がタブに表示される', () => {
    render(<EditorTabs fileName="index.ts" />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })

  it('editor-tab--active クラスがタブに付く', () => {
    render(<EditorTabs fileName="index.ts" />)
    expect(screen.getByText('index.ts')).toHaveClass('editor-tab--active')
  })

  it('editor-tabs ラッパーが存在する', () => {
    const { container } = render(<EditorTabs fileName="index.ts" />)
    expect(container.firstChild).toHaveClass('editor-tabs')
  })

  it('異なる fileName を渡すと表示が変わる', () => {
    const { rerender } = render(<EditorTabs fileName="App.tsx" />)
    expect(screen.getByText('App.tsx')).toBeInTheDocument()

    rerender(<EditorTabs fileName="main.py" />)
    expect(screen.getByText('main.py')).toBeInTheDocument()
    expect(screen.queryByText('App.tsx')).not.toBeInTheDocument()
  })
})
