import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { FileTreeNode } from '../../../types'
import ExplorerPanel from '../ExplorerPanel'

const mockTree: FileTreeNode[] = [
  {
    name: 'src',
    path: '/p/src',
    type: 'directory',
    children: [{ name: 'index.ts', path: '/p/src/index.ts', type: 'file' }]
  },
  { name: 'package.json', path: '/p/package.json', type: 'file' }
]

const defaultProps = {
  folderPath: null as string | null,
  fileTree: [] as FileTreeNode[],
  openFilePath: null as string | null,
  onOpenFolder: vi.fn(),
  onSelectFile: vi.fn(),
  error: null as Error | null,
  onCreateFile: vi.fn(),
  onCreateDirectory: vi.fn(),
  onRenameEntry: vi.fn(),
  onDeleteEntry: vi.fn()
}

const openedProps = { ...defaultProps, folderPath: '/p', fileTree: mockTree }

describe('ExplorerPanel', () => {
  it('folderPath が null のとき「フォルダを開く」ボタンが表示される', () => {
    render(<ExplorerPanel {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'フォルダを開く' })).toBeInTheDocument()
  })

  it('「フォルダを開く」ボタンクリックで onOpenFolder が呼ばれる', async () => {
    const onOpenFolder = vi.fn()
    render(<ExplorerPanel {...defaultProps} onOpenFolder={onOpenFolder} />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    expect(onOpenFolder).toHaveBeenCalledOnce()
  })

  it('folderPath が指定されているとき file-tree が描画される', () => {
    render(<ExplorerPanel {...openedProps} />)
    expect(screen.getByRole('tree')).toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
    expect(screen.getByText('package.json')).toBeInTheDocument()
  })

  it('folderPath が指定されているとき「フォルダを開く」ボタンは表示されない', () => {
    render(<ExplorerPanel {...openedProps} />)
    expect(screen.queryByRole('button', { name: 'フォルダを開く' })).not.toBeInTheDocument()
  })

  it('folderPath が指定されているとき「フォルダを変更」ボタンが表示される', () => {
    render(<ExplorerPanel {...openedProps} />)
    expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
  })

  it('「フォルダを変更」ボタンクリックで onOpenFolder が呼ばれる', async () => {
    const onOpenFolder = vi.fn()
    render(<ExplorerPanel {...openedProps} onOpenFolder={onOpenFolder} />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを変更' }))
    expect(onOpenFolder).toHaveBeenCalledOnce()
  })

  it('error が渡されたとき error.message が表示される', () => {
    render(<ExplorerPanel {...defaultProps} error={new Error('permission denied')} />)
    expect(screen.getByText('permission denied')).toBeInTheDocument()
  })

  it('role="tree" に aria-label="ファイルツリー" が付与されている', () => {
    render(<ExplorerPanel {...openedProps} />)
    expect(screen.getByRole('tree', { name: 'ファイルツリー' })).toBeInTheDocument()
  })

  it('error が null のとき error メッセージは表示されない', () => {
    const { container } = render(<ExplorerPanel {...defaultProps} />)
    expect(container.querySelector('.explorer-panel__error')).toBeNull()
  })

  describe('コンテキストメニュー', () => {
    it('ファイルを右クリックするとリネーム・削除メニューが表示される', () => {
      render(<ExplorerPanel {...openedProps} />)
      fireEvent.contextMenu(screen.getByText('package.json'))
      expect(screen.getByRole('menu', { name: 'ファイル操作' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'リネーム' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: '削除' })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: '新規ファイル' })).not.toBeInTheDocument()
    })

    it('ディレクトリを右クリックすると新規作成・リネーム・削除メニューが表示される', () => {
      render(<ExplorerPanel {...openedProps} />)
      fireEvent.contextMenu(screen.getByText('src'))
      expect(screen.getByRole('menuitem', { name: '新規ファイル' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: '新規フォルダ' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'リネーム' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: '削除' })).toBeInTheDocument()
    })

    it('ツリー空白領域を右クリックすると新規作成メニューのみ表示される', () => {
      render(<ExplorerPanel {...openedProps} />)
      fireEvent.contextMenu(screen.getByRole('tree'))
      expect(screen.getByRole('menuitem', { name: '新規ファイル' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: '新規フォルダ' })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'リネーム' })).not.toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: '削除' })).not.toBeInTheDocument()
    })

    it('Escape キーでメニューが閉じる', () => {
      render(<ExplorerPanel {...openedProps} />)
      fireEvent.contextMenu(screen.getByText('package.json'))
      expect(screen.getByRole('menu')).toBeInTheDocument()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('メニュー外のクリックでメニューが閉じる', () => {
      render(<ExplorerPanel {...openedProps} />)
      fireEvent.contextMenu(screen.getByText('package.json'))
      expect(screen.getByRole('menu')).toBeInTheDocument()
      fireEvent.click(document.body)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('「削除」をクリックすると対象ノードで onDeleteEntry が呼ばれる', async () => {
      const onDeleteEntry = vi.fn()
      render(<ExplorerPanel {...openedProps} onDeleteEntry={onDeleteEntry} />)
      fireEvent.contextMenu(screen.getByText('package.json'))
      await userEvent.click(screen.getByRole('menuitem', { name: '削除' }))
      expect(onDeleteEntry).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/p/package.json' })
      )
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  describe('新規作成・リネームのダイアログ', () => {
    it('「新規ファイル」→ 名前入力 → OK で onCreateFile が親パス付きで呼ばれる', async () => {
      const onCreateFile = vi.fn()
      render(<ExplorerPanel {...openedProps} onCreateFile={onCreateFile} />)
      fireEvent.contextMenu(screen.getByText('src'))
      await userEvent.click(screen.getByRole('menuitem', { name: '新規ファイル' }))

      const dialog = screen.getByRole('dialog', { name: '新規ファイル' })
      expect(dialog).toBeInTheDocument()
      await userEvent.type(screen.getByLabelText('名前'), 'new.ts')
      await userEvent.click(screen.getByRole('button', { name: 'OK' }))

      expect(onCreateFile).toHaveBeenCalledWith('/p/src', 'new.ts')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('ツリー空白領域からの「新規フォルダ」はルートを親として onCreateDirectory を呼ぶ', async () => {
      const onCreateDirectory = vi.fn()
      render(<ExplorerPanel {...openedProps} onCreateDirectory={onCreateDirectory} />)
      fireEvent.contextMenu(screen.getByRole('tree'))
      await userEvent.click(screen.getByRole('menuitem', { name: '新規フォルダ' }))
      await userEvent.type(screen.getByLabelText('名前'), 'newdir')
      await userEvent.click(screen.getByRole('button', { name: 'OK' }))
      expect(onCreateDirectory).toHaveBeenCalledWith('/p', 'newdir')
    })

    it('「リネーム」ダイアログは現在の名前が初期値になり onRenameEntry を呼ぶ', async () => {
      const onRenameEntry = vi.fn()
      render(<ExplorerPanel {...openedProps} onRenameEntry={onRenameEntry} />)
      fireEvent.contextMenu(screen.getByText('package.json'))
      await userEvent.click(screen.getByRole('menuitem', { name: 'リネーム' }))

      const input = screen.getByLabelText('名前') as HTMLInputElement
      expect(input.value).toBe('package.json')
      await userEvent.clear(input)
      await userEvent.type(input, 'renamed.json')
      await userEvent.click(screen.getByRole('button', { name: 'OK' }))

      expect(onRenameEntry).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/p/package.json' }),
        'renamed.json'
      )
    })

    it('キャンセルボタンでダイアログが閉じ何も呼ばれない', async () => {
      const onCreateFile = vi.fn()
      render(<ExplorerPanel {...openedProps} onCreateFile={onCreateFile} />)
      fireEvent.contextMenu(screen.getByText('src'))
      await userEvent.click(screen.getByRole('menuitem', { name: '新規ファイル' }))
      await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      expect(onCreateFile).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
