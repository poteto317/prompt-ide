import { useEffect, useRef, useState } from 'react'
import type { GitBranch } from '@shared/types'

interface Props {
  branches: GitBranch[]
  onSelect: (branchName: string) => void
  onClose: () => void
}

export default function BranchSwitcherMenu({
  branches,
  onSelect,
  onClose
}: Props): React.JSX.Element {
  // name → ボタン要素の参照。HistoryPanel.tsx の itemRefs と同じ理由
  // (DOM文字列セレクタでの検索を避けるため)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const selectable = branches.filter((b) => !b.current)
  // roving tabindex(HistoryItem.tsx の tabIndex={isSelected ? 0 : -1} と同じ
  // ARIA APG の radiogroup パターン)。フォーカスされたことのあるブランチを
  // Tab の唯一の停止点にする。current ブランチは disabled でフォーカス不可のため、
  // 何もフォーカスされていない初期状態は先頭の選択可能なブランチを基準にする
  // (HistoryPanel は selectedEntry を基準にするが、ここでは「選択」ではなく
  // 「フォーカス位置」自体が唯一の基準になる)
  const [focusedName, setFocusedName] = useState<string | null>(null)
  const tabbableName = focusedName ?? selectable[0]?.name ?? null

  const registerItemRef = (name: string, el: HTMLButtonElement | null): void => {
    if (el) itemRefs.current.set(name, el)
    else itemRefs.current.delete(name)
  }

  // メニュー外のクリック・Escape で閉じる(ExplorerContextMenu.tsx と同じパターン)
  useEffect(() => {
    const handleClose = (): void => onClose()
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('click', handleClose)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('click', handleClose)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  // HistoryPanel.tsx の radiogroup と同じ roving focus パターン(矢印キーで前後の
  // 項目へフォーカスを移動する)。現在ブランチのボタンは disabled(フォーカス
  // 不可)のため、移動対象からは除く
  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    if (selectable.length === 0) return
    const currentIndex = selectable.findIndex(
      (b) => itemRefs.current.get(b.name) === document.activeElement
    )
    const nextIndex =
      currentIndex === -1
        ? e.key === 'ArrowDown'
          ? 0
          : selectable.length - 1
        : (currentIndex + (e.key === 'ArrowDown' ? 1 : -1) + selectable.length) % selectable.length
    itemRefs.current.get(selectable[nextIndex].name)?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label="ブランチ"
      className="source-control-panel__branch-menu"
      onKeyDown={handleListKeyDown}
    >
      {branches.map((branch) => (
        <button
          key={branch.name}
          ref={(el) => registerItemRef(branch.name, el)}
          type="button"
          role="radio"
          aria-checked={branch.current}
          className="source-control-panel__branch-menu-item"
          disabled={branch.current}
          tabIndex={branch.name === tabbableName ? 0 : -1}
          onFocus={() => setFocusedName(branch.name)}
          onClick={() => onSelect(branch.name)}
        >
          {branch.current ? '✓ ' : ''}
          {branch.name}
        </button>
      ))}
    </div>
  )
}
