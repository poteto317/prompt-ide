import { useEffect } from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  onSelect: () => void
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export default function ExplorerContextMenu({ x, y, items, onClose }: Props): React.JSX.Element {
  // メニュー外のクリック・別の場所での右クリック・Escape で閉じる
  useEffect(() => {
    const handleClose = (): void => onClose()
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('click', handleClose)
    document.addEventListener('contextmenu', handleClose)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', handleClose)
    return () => {
      document.removeEventListener('click', handleClose)
      document.removeEventListener('contextmenu', handleClose)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', handleClose)
    }
  }, [onClose])

  return (
    <ul
      role="menu"
      aria-label="ファイル操作"
      className="explorer-context-menu"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <li key={item.id} role="none">
          <button
            type="button"
            role="menuitem"
            className="explorer-context-menu__item"
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
