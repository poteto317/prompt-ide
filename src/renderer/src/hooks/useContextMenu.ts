import { useState, useCallback } from 'react'
import type { FileTreeNode } from '../types'

export interface ContextMenuState {
  x: number
  y: number
  /** null はツリーの空白領域(= ルートフォルダ直下)を対象とした右クリックを表す */
  node: FileTreeNode | null
}

interface UseContextMenuResult {
  menu: ContextMenuState | null
  openMenu: (e: React.MouseEvent, node: FileTreeNode | null) => void
  closeMenu: () => void
}

export function useContextMenu(): UseContextMenuResult {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  const openMenu = useCallback((e: React.MouseEvent, node: FileTreeNode | null): void => {
    e.preventDefault()
    // 項目上の右クリックがツリー空白領域(ルート扱い)のハンドラまで伝播しないよう止める
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const closeMenu = useCallback((): void => {
    setMenu(null)
  }, [])

  return { menu, openMenu, closeMenu }
}
