import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import StatusBar from '../StatusBar'

describe('StatusBar', () => {
  it('ブランチ名 "main" が表示される', () => {
    render(<StatusBar />)
    expect(screen.getByText('main')).toBeInTheDocument()
  })

  it('"TypeScript" が表示される', () => {
    render(<StatusBar />)
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
  })

  it('"Ln 1, Col 1" が表示される', () => {
    render(<StatusBar />)
    expect(screen.getByText('Ln 1, Col 1')).toBeInTheDocument()
  })

  it('"UTF-8" が表示される', () => {
    render(<StatusBar />)
    expect(screen.getByText('UTF-8')).toBeInTheDocument()
  })

  it('ボタンなどのインタラクティブ要素が存在しない（表示専用）', () => {
    render(<StatusBar />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
