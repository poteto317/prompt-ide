import { useRef, useState } from 'react'
import type { GitBranch } from '@shared/types'
import BranchSwitcherMenu from './BranchSwitcherMenu'

interface Props {
  currentBranch: string | null
  branches: GitBranch[]
  isCheckingOut: boolean
  /** push/pull ボタン(SourceControlToolbar)の isPushBlocked 等と同じ理由で、
   *  他操作中(stage/unstage・ハンク操作・commit・pull・checkout 自身の
   *  多重実行)によりクリックしても no-op になる状態かを親から受け取る。
   *  isCheckingOut と違い表示テキストは変えない(「切り替え中」ではなく
   *  「他操作の完了待ち」のため) */
  isBlocked: boolean
  onCheckoutBranch: (branchName: string) => Promise<void>
}

export default function BranchSwitcher({
  currentBranch,
  branches,
  isCheckingOut,
  isBlocked,
  onCheckoutBranch
}: Props): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const isDisabled = isCheckingOut || isBlocked
  const triggerRef = useRef<HTMLButtonElement>(null)

  const handleSelect = (branchName: string): void => {
    // トリガーボタン自体は isDisabled で disabled になるため、実行中に
    // 誤って別ブランチへ多重に切り替えを試みることはできない。結果は
    // パネル上部のエラーバナー(branchOperationError)で確認する、
    // push/pull ボタンと同じ「クリック→即座に実行開始」という一貫した挙動
    setIsOpen(false)
    // 選択はキーボード操作(Enter/Space)でも起こりうるため、トリガーへ
    // フォーカスを戻す(PRレビュー指摘)
    triggerRef.current?.focus()
    void onCheckoutBranch(branchName)
  }

  // restoreFocus: BranchSwitcherMenu.tsx 参照。Escape(true)はトリガーへ戻し、
  // 外側クリック(false)はユーザーが自然に移そうとしたフォーカス先を尊重して
  // 奪わない
  const handleMenuClose = (restoreFocus: boolean): void => {
    setIsOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const ariaLabel = isCheckingOut
    ? 'ブランチ切り替え中'
    : isBlocked
      ? '他の操作が完了するまでブランチを切り替えられません'
      : 'ブランチを切り替え'

  return (
    <div className="source-control-panel__branch-switcher">
      <button
        ref={triggerRef}
        type="button"
        className="source-control-panel__branch-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={isDisabled}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        {isCheckingOut ? '切り替え中...' : (currentBranch ?? '(no branch)')}
      </button>
      {isOpen && (
        <BranchSwitcherMenu branches={branches} onSelect={handleSelect} onClose={handleMenuClose} />
      )}
    </div>
  )
}
