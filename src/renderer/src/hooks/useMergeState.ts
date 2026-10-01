import { useRef, useState } from 'react'
import type { GitStatusResult } from '@shared/types'
import * as gitApi from '../lib/gitApi'
import { runEditorSyncedOperation } from '../lib/editorSyncedOperation'
import { isConflictedFile, isGitOperationDisabled } from '../lib/gitUtils'
import { MERGE_ABORT_CONFIRM_MESSAGE } from '../lib/mergeStateMessage'
import type { MergeStatePanelState } from '../types'
import type { FileOperationLock } from './useFileOperationLock'
import { useRunExclusiveGitOperation } from './useRunExclusiveGitOperation'

export interface MergeStateOptions {
  gitStatus: GitStatusResult | null
  refreshGitStatus: () => Promise<void>
  /** useGitHistory.refresh。マージコミットの作成・中止でログとブランチ一覧が変わる */
  refreshHistory: () => Promise<void>
  /** ブランチ操作・退避などと共有するロック(作業ツリーを書き換えるため lockGlobal を取る) */
  fileLock: FileOperationLock
  /** useFileSystem.confirmDiscardAnyDirty。未保存編集の破棄確認 */
  confirmDiscardAnyDirty: () => boolean
  /** useFileSystem.reloadOpenFiles。開いているタブをディスクから読み直す */
  reloadOpenFiles: () => Promise<void>
  /** useFileSystem.refreshTree。中止でファイルの有無が変わり得る */
  refreshTree: () => Promise<unknown>
  /** 中止の確認ダイアログ。テストで差し替えるために注入できるようにする */
  onConfirm?: (message: string) => boolean
}

// マージ中(MERGE_HEAD あり)の「マージを完了」「マージを中止」。useDiscardAllChanges と同じ作りで、
// 自分の busy ref + 他の Git 操作のロック + リポジトリの有無で排他にし、作業ツリーを書き換えるため
// lockGlobal を取る。順序は「busy 判定 → (中止のみ)中止の確認 → 未保存編集の破棄確認 → ロック →
// 実行 → 成功時だけタブとツリーを再読込」。確認の拒否ではロックを取らない。
// 失敗時に再読込すると、変わっていないファイルの未保存編集が失われるため成功時だけ再読込する(パターン20)。
// 完了はディスクの内容を変えないが、reloadOpenFiles は未保存編集を上書きするため、
// 中止と同じく事前に破棄を確認する
export function useMergeState({
  gitStatus,
  refreshGitStatus,
  refreshHistory,
  fileLock,
  confirmDiscardAnyDirty,
  reloadOpenFiles,
  refreshTree,
  onConfirm = confirm
}: MergeStateOptions): MergeStatePanelState {
  const [pendingOperation, setPendingOperation] = useState<'complete' | 'abort' | null>(null)
  const isRunningRef = useRef(false)
  const [error, setError] = useState<Error | null>(null)

  const inProgress = gitStatus?.mergeInProgress ?? false
  const unresolvedCount = gitStatus?.files.filter(isConflictedFile).length ?? 0
  const canComplete = inProgress && unresolvedCount === 0

  // マージコミット/中止ではステータスとログが変わる。互いに独立した IPC のため並行して再取得する
  const runOperation = useRunExclusiveGitOperation(
    () => Promise.all([refreshGitStatus(), refreshHistory()]).then(() => undefined),
    setError
  )
  const isBusy = (): boolean =>
    isRunningRef.current || fileLock.isAnyLocked() || isGitOperationDisabled(gitStatus)

  const run = (kind: 'complete' | 'abort', execute: () => Promise<void>): Promise<void> =>
    runEditorSyncedOperation({
      confirmDiscardAnyDirty,
      reloadOpenFiles,
      operation: async () => {
        const succeeded = await runOperation({
          isBusy,
          setBusy: (busy) => {
            isRunningRef.current = busy
            setPendingOperation(busy ? kind : null)
          },
          onStart: fileLock.lockGlobal,
          onEnd: fileLock.unlockGlobal,
          execute
        })
        // ツリーの読み直しの失敗はツリー側が自身のエラー表示へ報告するため、タブの再読込を止めない
        if (succeeded) await refreshTree().catch(() => undefined)
        return succeeded
      }
    })

  const onAbort = async (): Promise<void> => {
    if (!inProgress || isBusy()) return
    if (!onConfirm(MERGE_ABORT_CONFIRM_MESSAGE)) return
    await run('abort', () => gitApi.abortMerge())
  }

  const onComplete = async (): Promise<void> => {
    if (!canComplete || isBusy()) return
    await run('complete', () => gitApi.completeMerge())
  }

  return { inProgress, unresolvedCount, pendingOperation, error, canComplete, onComplete, onAbort }
}
