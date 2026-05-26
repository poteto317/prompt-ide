import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import MarkdownRenderer from '../MarkdownRenderer'

describe('MarkdownRenderer', () => {
  it('**bold** が <strong> としてレンダリングされる', () => {
    render(<MarkdownRenderer content="**太字テキスト**" />)
    expect(screen.getByRole('strong')).toBeInTheDocument()
    expect(screen.getByText('太字テキスト')).toBeInTheDocument()
  })

  it('# heading が <h1> としてレンダリングされる', () => {
    render(<MarkdownRenderer content="# 見出し1" />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByText('見出し1')).toBeInTheDocument()
  })

  it('## heading が <h2> としてレンダリングされる', () => {
    render(<MarkdownRenderer content="## 見出し2" />)
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
    expect(screen.getByText('見出し2')).toBeInTheDocument()
  })

  it('インラインコードが <code> としてレンダリングされる', () => {
    render(<MarkdownRenderer content="`myFunction()`" />)
    const code = screen.getByText('myFunction()')
    expect(code.tagName.toLowerCase()).toBe('code')
  })

  it('コードブロックが <pre><code> としてレンダリングされる', () => {
    render(<MarkdownRenderer content={'```\nconst x = 1\n```'} />)
    const pre = screen.getByText('const x = 1').closest('pre')
    expect(pre).toBeInTheDocument()
  })

  it('- リスト項目が <ul><li> としてレンダリングされる', () => {
    render(<MarkdownRenderer content={'- アイテム1\n- アイテム2'} />)
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('GFM テーブルが <table> としてレンダリングされる', () => {
    const table = '| A | B |\n|---|---|\n| 1 | 2 |'
    render(<MarkdownRenderer content={table} />)
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('リンクが <a> としてレンダリングされる', () => {
    render(<MarkdownRenderer content="[リンク](https://example.com)" />)
    const link = screen.getByRole('link', { name: 'リンク' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', 'https://example.com')
  })

  it('markdown-renderer クラスのコンテナが描画される', () => {
    const { container } = render(<MarkdownRenderer content="テキスト" />)
    expect(container.querySelector('.markdown-renderer')).toBeInTheDocument()
  })

  it('番号付きリストが <ol><li> としてレンダリングされる', () => {
    render(<MarkdownRenderer content={'1. 項目A\n2. 項目B'} />)
    const list = screen.getByRole('list')
    expect(list.tagName.toLowerCase()).toBe('ol')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('打ち消し線（GFM）が <del> としてレンダリングされる', () => {
    const { container } = render(<MarkdownRenderer content="~~打ち消しテキスト~~" />)
    expect(container.querySelector('del')).toBeInTheDocument()
    expect(screen.getByText('打ち消しテキスト')).toBeInTheDocument()
  })

  it('通常リンクに target="_blank" と rel="noopener noreferrer" が付与される', () => {
    render(<MarkdownRenderer content="[リンク](https://example.com)" />)
    const link = screen.getByRole('link', { name: 'リンク' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('javascript: スキームの href が無害化される', () => {
    const { container } = render(<MarkdownRenderer content="[XSS](javascript:alert(1))" />)
    const link = container.querySelector('a')
    expect(link).toBeInTheDocument()
    expect(link?.getAttribute('href')).not.toContain('javascript:')
  })

  it('大文字混じりの JAVASCRIPT: スキームも無害化される', () => {
    const { container } = render(<MarkdownRenderer content="[XSS](JAVASCRIPT:alert(1))" />)
    const link = container.querySelector('a')
    expect(link).toBeInTheDocument()
    expect(link?.getAttribute('href')).not.toContain('javascript:')
    expect(link?.getAttribute('href')).not.toContain('JAVASCRIPT:')
  })
})
