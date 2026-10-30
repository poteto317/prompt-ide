import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ExplorerContextMenu from '../ExplorerContextMenu'

const defaultProps = {
  x: 100,
  y: 200,
  items: [
    { id: 'createFile', label: '新規ファイル', onSelect: vi.fn() },
    { id: 'delete', label: '削除', onSelect: vi.fn() }
  ],
  onClose: vi.fn()
}

describe('ExplorerContextMenu', () => {
  it('items がメニュー項目として表示される', () => {
    render(<ExplorerContextMenu {...defaultProps} />)
    expect(screen.getByRole('menu', { name: 'ファイル操作' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '新規ファイル' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '削除' })).toBeInTheDocument()
  })

  it('指定した座標に表示される', () => {
    render(<ExplorerContextMenu {...defaultProps} />)
    const menu = screen.getByRole('menu')
    expect(menu).toHaveStyle({ left: '100px', top: '200px' })
  })

  it('項目クリックで onClose → onSelect の順に呼ばれる', async () => {
    const calls: string[] = []
    const onClose = vi.fn(() => calls.push('close'))
    const onSelect = vi.fn(() => calls.push('select'))
    render(
      <ExplorerContextMenu
        {...defaultProps}
        items={[{ id: 'createFile', label: '新規ファイル', onSelect }]}
        onClose={onClose}
      />
    )
    await userEvent.click(screen.getByRole('menuitem', { name: '新規ファイル' }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(calls[0]).toBe('close')
  })

  it('メニュー外クリックで onClose が呼ばれる', () => {
    const onClose = vi.fn()
    render(<ExplorerContextMenu {...defaultProps} onClose={onClose} />)
    fireEvent.click(document.body)
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape キーで onClose が呼ばれる', () => {
    const onClose = vi.fn()
    render(<ExplorerContextMenu {...defaultProps} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape 以外のキーでは onClose を呼ばない', () => {
    const onClose = vi.fn()
    render(<ExplorerContextMenu {...defaultProps} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('別の場所での右クリックで onClose が呼ばれる', () => {
    const onClose = vi.fn()
    render(<ExplorerContextMenu {...defaultProps} onClose={onClose} />)
    fireEvent.contextMenu(document.body)
    expect(onClose).toHaveBeenCalled()
  })

  it('アンマウント時に document のリスナーが解除される', () => {
    const onClose = vi.fn()
    const { unmount } = render(<ExplorerContextMenu {...defaultProps} onClose={onClose} />)
    unmount()
    fireEvent.click(document.body)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
