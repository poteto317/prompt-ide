import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { FileTreeNode } from '../../../types'
import FileItem from '../FileItem'

const fileNode: FileTreeNode = {
  name: 'index.ts',
  path: '/p/src/index.ts',
  type: 'file',
}

describe('FileItem', () => {
  it('ファイル名が表示される', () => {
    render(<FileItem node={fileNode} openFilePath={null} onSelectFile={vi.fn()} depth={0} />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })

  it('クリックで onSelectFile がノードを引数に呼ばれる', async () => {
    const onSelectFile = vi.fn()
    render(<FileItem node={fileNode} openFilePath={null} onSelectFile={onSelectFile} depth={0} />)
    await userEvent.click(screen.getByText('index.ts'))
    expect(onSelectFile).toHaveBeenCalledOnce()
    expect(onSelectFile).toHaveBeenCalledWith(fileNode)
  })

  it('openFilePath と一致するとき file-tree__item--active クラスが付く', () => {
    render(
      <FileItem node={fileNode} openFilePath="/p/src/index.ts" onSelectFile={vi.fn()} depth={0} />
    )
    expect(screen.getByRole('treeitem')).toHaveClass('file-tree__item--active')
  })

  it('openFilePath と一致しないとき file-tree__item--active クラスが付かない', () => {
    render(
      <FileItem node={fileNode} openFilePath="/p/other.ts" onSelectFile={vi.fn()} depth={0} />
    )
    expect(screen.getByRole('treeitem')).not.toHaveClass('file-tree__item--active')
  })

  it('openFilePath 一致時に aria-selected が true になる', () => {
    render(
      <FileItem node={fileNode} openFilePath="/p/src/index.ts" onSelectFile={vi.fn()} depth={0} />
    )
    expect(screen.getByRole('treeitem')).toHaveAttribute('aria-selected', 'true')
  })

  it('openFilePath 不一致時に aria-selected が false になる', () => {
    render(
      <FileItem node={fileNode} openFilePath={null} onSelectFile={vi.fn()} depth={0} />
    )
    expect(screen.getByRole('treeitem')).toHaveAttribute('aria-selected', 'false')
  })

  it('depth=2 のとき padding-left が depth=0 より大きい', () => {
    const { rerender, container } = render(
      <FileItem node={fileNode} openFilePath={null} onSelectFile={vi.fn()} depth={0} />
    )
    const styleDepth0 = (container.firstChild as HTMLElement).style.paddingLeft

    rerender(<FileItem node={fileNode} openFilePath={null} onSelectFile={vi.fn()} depth={2} />)
    const styleDepth2 = (container.firstChild as HTMLElement).style.paddingLeft

    expect(parseInt(styleDepth2)).toBeGreaterThan(parseInt(styleDepth0))
  })
})
