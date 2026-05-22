import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { FileTreeNode } from '../../../types'
import DirectoryItem from '../DirectoryItem'

const dirNode: FileTreeNode = {
  name: 'src',
  path: '/p/src',
  type: 'directory',
  children: [
    { name: 'index.ts', path: '/p/src/index.ts', type: 'file' },
    { name: 'App.tsx', path: '/p/src/App.tsx', type: 'file' },
  ],
}

const emptyDirNode: FileTreeNode = {
  name: 'empty',
  path: '/p/empty',
  type: 'directory',
  children: [],
}

describe('DirectoryItem', () => {
  it('ディレクトリ名が表示される', () => {
    render(<DirectoryItem node={dirNode} openFilePath={null} onSelectFile={vi.fn()} depth={0} />)
    expect(screen.getByText('src')).toBeInTheDocument()
  })

  it('初期状態で子ノードが展開されている', () => {
    render(<DirectoryItem node={dirNode} openFilePath={null} onSelectFile={vi.fn()} depth={0} />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
    expect(screen.getByText('App.tsx')).toBeInTheDocument()
  })

  it('クリックで子ノードが折りたたまれる', async () => {
    render(<DirectoryItem node={dirNode} openFilePath={null} onSelectFile={vi.fn()} depth={0} />)
    await userEvent.click(screen.getByText('src'))
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument()
    expect(screen.queryByText('App.tsx')).not.toBeInTheDocument()
  })

  it('折りたたみ後に再クリックで展開される', async () => {
    render(<DirectoryItem node={dirNode} openFilePath={null} onSelectFile={vi.fn()} depth={0} />)
    await userEvent.click(screen.getByText('src'))
    await userEvent.click(screen.getByText('src'))
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })

  it('展開時に aria-expanded が true になる', () => {
    const { container } = render(
      <DirectoryItem node={dirNode} openFilePath={null} onSelectFile={vi.fn()} depth={0} />
    )
    const dirItem = container.querySelector('[aria-expanded]')
    expect(dirItem).toHaveAttribute('aria-expanded', 'true')
  })

  it('折りたたみ時に aria-expanded が false になる', async () => {
    const { container } = render(
      <DirectoryItem node={dirNode} openFilePath={null} onSelectFile={vi.fn()} depth={0} />
    )
    await userEvent.click(screen.getByText('src'))
    const dirItem = container.querySelector('[aria-expanded]')
    expect(dirItem).toHaveAttribute('aria-expanded', 'false')
  })

  it('children が空でもクラッシュしない', () => {
    render(<DirectoryItem node={emptyDirNode} openFilePath={null} onSelectFile={vi.fn()} depth={0} />)
    expect(screen.getByText('empty')).toBeInTheDocument()
  })
})
