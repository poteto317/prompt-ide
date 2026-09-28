import { useRef, useState } from 'react'
import type { GitBranch } from '@shared/types'
import type { BranchOperationKind } from '../../types'
import BranchSwitcherMenu from './BranchSwitcherMenu'
import CreateBranchDialog from './CreateBranchDialog'
import { getBranchTriggerLabel } from '../../lib/branchTriggerLabel'

interface Props {
  currentBranch: string | null
  branches: GitBranch[]
  pendingBranchOperation: BranchOperationKind | null
  /** push/pull ボタン(SourceControlToolbar)の isPushBlocked 等と同じ理由で、
   *  他操作中(stage/unstage・ハンク操作・commit・pull・checkout 自身の
   *  多重実行)によりクリックしても no-op になる状態かを親から受け取る。
   *  pendingBranchOperation と違い表示テキストは変えない(「切り替え中」ではなく
   *  「他操作の完了待ち」のため) */
  isBlocked: boolean
  onCheckoutBranch: (branchName: string) => Promise<void>
  onCreateBranch: (branchName: string) => Promise<boolean>
  onDeleteBranch: (branchName: string) => Promise<boolean>
}

export default function BranchSwitcher({
  currentBranch,
  branches,
  pendingBranchOperation,
  isBlocked,
  onCheckoutBranch,
  onCreateBranch,
  onDeleteBranch
}: Props): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const isDisabled = pendingBranchOperation !== null || isBlocked
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

  // メニューを閉じてから入力ダイアログを開く。作成ボタンのクリックは document の
  // 外側クリック判定にもバブルして onClose(false) が重ねて呼ばれるが、setIsOpen(false)
  // の重複なので害は無い
  const handleCreateRequest = (): void => {
    setIsOpen(false)
    setIsCreateDialogOpen(true)
  }

  // ダイアログを閉じたら(OK・キャンセル・Escape・オーバーレイクリックのいずれも)
  // トリガーへフォーカスを戻す(パターン22)。OK の場合は、トリガーが実行中に
  // disabled になる前にフォーカスを戻すため、onCreateBranch より先に呼ぶ
  const closeCreateDialog = (): void => {
    setIsCreateDialogOpen(false)
    triggerRef.current?.focus()
  }

  const handleCreateSubmit = (branchName: string): void => {
    closeCreateDialog()
    void onCreateBranch(branchName)
  }

  // 確認ダイアログはフック側(useGitBranchOperations.deleteBranch)が出す。
  // メニューは先に閉じてトリガーへフォーカスを戻しておく
  const handleDelete = (branchName: string): void => {
    setIsOpen(false)
    triggerRef.current?.focus()
    void onDeleteBranch(branchName)
  }

  const label = getBranchTriggerLabel({ pendingBranchOperation, isBlocked, currentBranch })

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
        aria-label={label.ariaLabel}
      >
        {label.text}
      </button>
      {isOpen && (
        <BranchSwitcherMenu
          branches={branches}
          onSelect={handleSelect}
          onClose={handleMenuClose}
          onCreateRequest={handleCreateRequest}
          onDelete={handleDelete}
        />
      )}
      {isCreateDialogOpen && (
        <CreateBranchDialog
          branches={branches}
          onSubmit={handleCreateSubmit}
          onCancel={closeCreateDialog}
        />
      )}
    </div>
  )
}
