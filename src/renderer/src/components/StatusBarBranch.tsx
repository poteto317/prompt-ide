'use client'

import { useRef, useState } from 'react'
import type { GitBranch } from '@shared/types'
import { BranchIcon } from './icons'
import StatusBarSyncButton from './StatusBarSyncButton'
import BranchQuickPick from './source-control/BranchQuickPick'
import CreateBranchDialog from './source-control/CreateBranchDialog'
import { useDialogFocusReturn } from '../hooks/useDialogFocusReturn'
import { getBranchTriggerLabel } from '../lib/branchTriggerLabel'
import type { BranchOperationKind } from '../types'

export interface StatusBarBranchState {
  /** detached のときは null */
  currentBranch: string | null
  branches: GitBranch[]
  pendingBranchOperation: BranchOperationKind | null
  /** 他の操作中(GitRepoView の isBlockedByOtherOperation と同じ判定) */
  isBlocked: boolean
  /** ブランチ操作の失敗 */
  error: Error | null
  /** プル・プッシュ・同期の失敗。別のパネルを開いていても分かるようにここにも出す */
  remoteError: Error | null
  ahead: number
  behind: number
  isSyncing: boolean
  isSyncBlocked: boolean
  onCheckoutBranch: (branchName: string) => Promise<void>
  onSync: () => Promise<void>
  onCreateBranch: (branchName: string) => Promise<boolean>
  onDeleteBranch: (branchName: string) => Promise<boolean>
  onMergeBranch: (branchName: string) => Promise<void>
}

interface Props {
  state: StatusBarBranchState
}

function StatusBarError({ error }: { error: Error }): React.JSX.Element {
  return (
    <span className="status-bar__item status-bar__branch-error" role="alert" title={error.message}>
      {error.message}
    </span>
  )
}

export default function StatusBarBranch({ state }: Props): React.JSX.Element {
  const {
    currentBranch,
    branches,
    pendingBranchOperation,
    isBlocked,
    error,
    remoteError,
    ahead,
    behind,
    isSyncing,
    isSyncBlocked,
    onCheckoutBranch,
    onSync,
    onCreateBranch,
    onDeleteBranch,
    onMergeBranch
  } = state
  const triggerRef = useRef<HTMLButtonElement>(null)
  const isDisabled = pendingBranchOperation !== null || isBlocked
  const picker = useDialogFocusReturn({ isRunning: isDisabled, openerRef: triggerRef })
  const createDialog = useDialogFocusReturn({ isRunning: isDisabled, openerRef: triggerRef })
  const label = getBranchTriggerLabel({ pendingBranchOperation, isBlocked, currentBranch })
  const [createInitialName, setCreateInitialName] = useState('')

  // 閉じてから操作を呼ぶ。戻す予約は実行中が解けるまで待つ(useDialogFocusReturn)。確認はフック側が出す
  const closePickerThen =
    (operation: (branchName: string) => Promise<unknown>) =>
    (branchName: string): void => {
      picker.close()
      void operation(branchName)
    }

  // 一覧からダイアログへ移るので、ボタンへは戻さない。ダイアログを閉じたときに戻す
  const handleCreateRequest = (initialName: string): void => {
    setCreateInitialName(initialName)
    picker.closeWithoutReturn()
    createDialog.open()
  }

  const handleCreateSubmit = (branchName: string): void => {
    createDialog.close()
    void onCreateBranch(branchName)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="status-bar__item status-bar__branch"
        disabled={isDisabled}
        aria-haspopup="dialog"
        aria-expanded={picker.isOpen}
        aria-label={label.ariaLabel}
        title={label.text}
        onClick={picker.open}
        // 未保存の確認の既定のボタンを Enter で押したまま切り替えが終わり、ここへ戻ったときなどに、リピートで開き直さない(Space は keyup で押すので対象外)
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.repeat) e.preventDefault()
        }}
      >
        <BranchIcon />
        <span className="status-bar__branch-name">{label.text}</span>
      </button>
      <StatusBarSyncButton
        ahead={ahead}
        behind={behind}
        isSyncing={isSyncing}
        isSyncBlocked={isSyncBlocked}
        onSync={onSync}
        fallbackFocusRef={triggerRef}
      />
      {error !== null && <StatusBarError error={error} />}
      {remoteError !== null && <StatusBarError error={remoteError} />}
      {picker.isOpen && (
        <BranchQuickPick
          branches={branches}
          currentBranch={currentBranch}
          isDisabled={isDisabled}
          onSelect={closePickerThen(onCheckoutBranch)}
          onCreateRequest={handleCreateRequest}
          onMerge={closePickerThen(onMergeBranch)}
          onDelete={closePickerThen(onDeleteBranch)}
          onClose={picker.close}
        />
      )}
      {createDialog.isOpen && (
        <CreateBranchDialog
          branches={branches}
          initialValue={createInitialName}
          isBlocked={isDisabled}
          onSubmit={handleCreateSubmit}
          onCancel={createDialog.close}
        />
      )}
    </>
  )
}
