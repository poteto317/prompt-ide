import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { FileTreeNode } from '../../../types'
import ExplorerPanel from '../ExplorerPanel'

const mockTree: FileTreeNode[] = [
  { name: 'src', path: '/p/src', type: 'directory', children: [
    { name: 'index.ts', path: '/p/src/index.ts', type: 'file' },
  ]},
  { name: 'package.json', path: '/p/package.json', type: 'file' },
]

describe('ExplorerPanel', () => {
  it('folderPath が null のとき「フォルダを開く」ボタンが表示される', () => {
    render(
      <ExplorerPanel
        folderPath={null}
        fileTree={[]}
        openFilePath={null}
        onOpenFolder={vi.fn()}
        onSelectFile={vi.fn()}
        error={null}
      />
    )
    expect(screen.getByRole('button', { name: 'フォルダを開く' })).toBeInTheDocument()
  })

  it('「フォルダを開く」ボタンクリックで onOpenFolder が呼ばれる', async () => {
    const onOpenFolder = vi.fn()
    render(
      <ExplorerPanel
        folderPath={null}
        fileTree={[]}
        openFilePath={null}
        onOpenFolder={onOpenFolder}
        onSelectFile={vi.fn()}
        error={null}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    expect(onOpenFolder).toHaveBeenCalledOnce()
  })

  it('folderPath が指定されているとき file-tree が描画される', () => {
    render(
      <ExplorerPanel
        folderPath="/p"
        fileTree={mockTree}
        openFilePath={null}
        onOpenFolder={vi.fn()}
        onSelectFile={vi.fn()}
        error={null}
      />
    )
    expect(screen.getByRole('tree')).toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
    expect(screen.getByText('package.json')).toBeInTheDocument()
  })

  it('folderPath が指定されているとき「フォルダを開く」ボタンは表示されない', () => {
    render(
      <ExplorerPanel
        folderPath="/p"
        fileTree={mockTree}
        openFilePath={null}
        onOpenFolder={vi.fn()}
        onSelectFile={vi.fn()}
        error={null}
      />
    )
    expect(screen.queryByRole('button', { name: 'フォルダを開く' })).not.toBeInTheDocument()
  })

  it('folderPath が指定されているとき「フォルダを変更」ボタンが表示される', () => {
    render(
      <ExplorerPanel
        folderPath="/p"
        fileTree={mockTree}
        openFilePath={null}
        onOpenFolder={vi.fn()}
        onSelectFile={vi.fn()}
        error={null}
      />
    )
    expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
  })

  it('「フォルダを変更」ボタンクリックで onOpenFolder が呼ばれる', async () => {
    const onOpenFolder = vi.fn()
    render(
      <ExplorerPanel
        folderPath="/p"
        fileTree={mockTree}
        openFilePath={null}
        onOpenFolder={onOpenFolder}
        onSelectFile={vi.fn()}
        error={null}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを変更' }))
    expect(onOpenFolder).toHaveBeenCalledOnce()
  })

  it('error が渡されたとき error.message が表示される', () => {
    render(
      <ExplorerPanel
        folderPath={null}
        fileTree={[]}
        openFilePath={null}
        onOpenFolder={vi.fn()}
        onSelectFile={vi.fn()}
        error={new Error('permission denied')}
      />
    )
    expect(screen.getByText('permission denied')).toBeInTheDocument()
  })

  it('error が null のとき error メッセージは表示されない', () => {
    const { container } = render(
      <ExplorerPanel
        folderPath={null}
        fileTree={[]}
        openFilePath={null}
        onOpenFolder={vi.fn()}
        onSelectFile={vi.fn()}
        error={null}
      />
    )
    expect(container.querySelector('.explorer-panel__error')).toBeNull()
  })
})
