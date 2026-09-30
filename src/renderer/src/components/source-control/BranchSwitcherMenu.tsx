import { useEffect, useRef, useState } from 'react'
import type { GitBranch } from '@shared/types'
import BranchMenuItem from './BranchMenuItem'

interface Props {
  branches: GitBranch[]
  onSelect: (branchName: string) => void
  /** restoreFocus: 呼び出し元(BranchSwitcher.tsx)がトリガーボタンへフォーカスを
   *  戻すべきか。Escape(キーボード操作の一環)は true、外側クリック(ユーザーが
   *  別の要素へ自然にフォーカスを移そうとした操作)は false */
  onClose: (restoreFocus: boolean) => void
  /** 「＋ 新しいブランチを作成…」が押された。入力ダイアログの表示は呼び出し元が行う */
  onCreateRequest: () => void
  /** 削除ボタン、または radio 上の Delete キー。確認ダイアログは呼び出し元(フック)が出す */
  onDelete: (branchName: string) => void
  /** マージボタン、または radio 上の M キー。確認ダイアログは呼び出し元(フック)が出す */
  onMerge: (branchName: string) => void
}

export default function BranchSwitcherMenu({
  branches,
  onSelect,
  onClose,
  onCreateRequest,
  onDelete,
  onMerge
}: Props): React.JSX.Element {
  // name → ボタン要素の参照。HistoryPanel.tsx の itemRefs と同じ理由
  // (DOM文字列セレクタでの検索を避けるため)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const createButtonRef = useRef<HTMLButtonElement>(null)
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
    const handleClose = (): void => onClose(false)
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose(true)
    }
    document.addEventListener('click', handleClose)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('click', handleClose)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  // PRレビュー指摘: ExplorerContextMenu(右クリック起点、キーボードトリガー無し)
  // とは異なり、このメニューはキーボードで開けるボタン(BranchSwitcher の
  // トリガー)から開く。開いた直後にフォーカスがメニュー内へ移らないと、
  // 実装済みの矢印キーナビゲーションがキーボードのみでは実質使えない
  // (もう一段 Tab を要求してしまう)
  useEffect(() => {
    // 選択可能なブランチが無い(現在ブランチだけ)場合は、唯一の操作である作成ボタンへ
    if (tabbableName !== null) itemRefs.current.get(tabbableName)?.focus()
    else createButtonRef.current?.focus()
    // マウント時の一度きりの副作用(tabbableName は選択のたびに変わるが、
    // その変化のたびに再フォーカスすると矢印キー操作中のフォーカスを奪ってしまう)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    <div className="source-control-panel__branch-menu">
      <button
        ref={createButtonRef}
        type="button"
        className="source-control-panel__branch-menu-item source-control-panel__branch-menu-create"
        onClick={onCreateRequest}
      >
        ＋ 新しいブランチを作成…
      </button>
      <div role="radiogroup" aria-label="ブランチ" onKeyDown={handleListKeyDown}>
        {branches.map((branch) => (
          <BranchMenuItem
            key={branch.name}
            branch={branch}
            isTabbable={branch.name === tabbableName}
            registerRef={registerItemRef}
            onFocus={setFocusedName}
            onSelect={onSelect}
            onDelete={onDelete}
            onMerge={onMerge}
          />
        ))}
      </div>
    </div>
  )
}
