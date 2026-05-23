import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { FileTreeNode } from '../../../types'
import FileTreeItem from '../FileTreeItem'

const fileNode: FileTreeNode = { name: 'index.ts', path: '/p/src/index.ts', type: 'file' }
const dirNode: FileTreeNode = {
  name: 'src',
  path: '/p/src',
  type: 'directory',
  children: [
    { name: 'index.ts', path: '/p/src/index.ts', type: 'file' },
    { name: 'App.tsx', path: '/p/src/App.tsx', type: 'file' },
  ],
}

describe('FileTreeItem — ファイル', () => {
  it('ファイル名が表示される', () => {
    render(<FileTreeItem node={fileNode} openFilePath={null} onSelectFile={vi.fn()} depth={0} />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })

  it('クリックで onSelectFile がノードを引数に呼ばれる', async () => {
    const onSelectFile = vi.fn()
    render(<FileTreeItem node={fileNode} openFilePath={null} onSelectFile={onSelectFile} depth={0} />)
    await userEvent.click(screen.getByText('index.ts'))
    expect(onSelectFile).toHaveBeenCalledOnce()
    expect(onSelectFile).toHaveBeenCalledWith(fileNode)
  })

  it('openFilePath と一致するとき file-tree__item--active クラスが付く', () => {
    render(
      <FileTreeItem
        node={fileNode}
        openFilePath="/p/src/index.ts"
        onSelectFile={vi.fn()}
        depth={0}
      />
    )
    expect(screen.getByRole('treeitem')).toHaveClass('file-tree__item--active')
  })

  it('openFilePath と一致しないとき file-tree__item--active クラスが付かない', () => {
    render(
      <FileTreeItem node={fileNode} openFilePath="/p/other.ts" onSelectFile={vi.fn()} depth={0} />
    )
    expect(screen.getByRole('treeitem')).not.toHaveClass('file-tree__item--active')
  })
})

describe('FileTreeItem — ディレクトリ', () => {
  it('ディレクトリ名が表示される', () => {
    render(<FileTreeItem node={dirNode} openFilePath={null} onSelectFile={vi.fn()} depth={0} />)
    expect(screen.getByText('src')).toBeInTheDocument()
  })

  it('初期状態で子ノードが展開されている', () => {
    render(<FileTreeItem node={dirNode} openFilePath={null} onSelectFile={vi.fn()} depth={0} />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
    expect(screen.getByText('App.tsx')).toBeInTheDocument()
  })

  it('ディレクトリクリックで子ノードが折りたたまれる', async () => {
    render(<FileTreeItem node={dirNode} openFilePath={null} onSelectFile={vi.fn()} depth={0} />)
    await userEvent.click(screen.getByText('src'))
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument()
    expect(screen.queryByText('App.tsx')).not.toBeInTheDocument()
  })

  it('折りたたみ後に再クリックで展開される', async () => {
    render(<FileTreeItem node={dirNode} openFilePath={null} onSelectFile={vi.fn()} depth={0} />)
    await userEvent.click(screen.getByText('src'))
    await userEvent.click(screen.getByText('src'))
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })
})
