'use client'

import { useRef } from 'react'
import type { GitBranch } from '@shared/types'
import { BranchIcon } from './icons'
import BranchQuickPick from './source-control/BranchQuickPick'
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
  error: Error | null
  onCheckoutBranch: (branchName: string) => Promise<void>
}

interface Props {
  state: StatusBarBranchState
}

export default function StatusBarBranch({ state }: Props): React.JSX.Element {
  const { currentBranch, branches, pendingBranchOperation, isBlocked, error, onCheckoutBranch } =
    state
  const triggerRef = useRef<HTMLButtonElement>(null)
  const isDisabled = pendingBranchOperation !== null || isBlocked
  const dialog = useDialogFocusReturn({ isRunning: isDisabled, openerRef: triggerRef })
  const label = getBranchTriggerLabel({ pendingBranchOperation, isBlocked, currentBranch })

  const handleSelect = (branchName: string): void => {
    dialog.close()
    void onCheckoutBranch(branchName)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="status-bar__item status-bar__branch"
        disabled={isDisabled}
        aria-haspopup="dialog"
        aria-expanded={dialog.isOpen}
        aria-label={label.ariaLabel}
        title={label.text}
        onClick={dialog.open}
        // 未保存の確認の既定のボタンを Enter で押したまま切り替えが終わり、ここへ戻ったときなどに、リピートで開き直さない(Space は keyup で押すので対象外)
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.repeat) e.preventDefault()
        }}
      >
        <BranchIcon />
        <span className="status-bar__branch-name">{label.text}</span>
      </button>
      {error !== null && (
        <span
          className="status-bar__item status-bar__branch-error"
          role="alert"
          title={error.message}
        >
          {error.message}
        </span>
      )}
      {dialog.isOpen && (
        <BranchQuickPick
          branches={branches}
          currentBranch={currentBranch}
          isDisabled={isDisabled}
          onSelect={handleSelect}
          onClose={dialog.close}
        />
      )}
    </>
  )
}
