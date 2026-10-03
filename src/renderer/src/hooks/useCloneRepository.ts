import { useRef, useState } from 'react'
import * as gitApi from '../lib/gitApi'
import { toError } from '../lib/errorUtils'
import type { CloneRepositoryPanelState } from '../types'
import type { FileOperationLock } from './useFileOperationLock'
import type { ApplyOpenedFolderOptions } from './useFileSystem'

export interface UseCloneRepositoryOptions {
  /** 未保存のタブの内容のスナップショット(useFileSystem.captureDirtySnapshot) */
  captureDirtySnapshot: () => string
  /** 未保存の編集があれば破棄を確認する(useFileSystem.confirmDiscardAnyDirty。「フォルダを変更」と同じ確認) */
  confirmDiscardAnyDirty: () => boolean
  /** clone したフォルダを開く(useFileSystem.applyOpenedFolder) */
  applyOpenedFolder: (path: string, options: ApplyOpenedFolderOptions) => Promise<void>
  /** 他の Git 操作と共有するロック。clone の間は全体ロックを取り、Git 操作(commit・pull・ブランチ操作など)を始めさせない */
  lock: FileOperationLock
  /** 他の Git 操作の実行中か(useAppState が各操作の実行中フラグとロックから合成する)。実行中は clone を始めない */
  isGitOperationRunning: boolean
}

// リポジトリの clone の状態と操作。順序は「実行中・他の操作中なら何もしない → 未保存の確認(取り消しなら何もしない)→
// 実行中にして全体ロック → main へ依頼(main が保存先を OS のダイアログで選ばせて clone)→ 成功ならフォルダを開く →
// ロックと実行中を解く」。実行中フラグは開き終わってから下ろす(読み込み中に「フォルダを変更」や clone を押させない。
// パターン 73・96)。開始時に前回のエラーを消す(パターン 87)。clone が成功するとフォルダが切り替わるため、Git 操作の
// 実行中は始めず(isGitOperationRunning)、clone の間は全体ロックで Git 操作を始めさせない(設計書の排他)
export function useCloneRepository({
  captureDirtySnapshot,
  confirmDiscardAnyDirty,
  applyOpenedFolder,
  lock,
  isGitOperationRunning
}: UseCloneRepositoryOptions): CloneRepositoryPanelState {
  const [isCloning, setIsCloning] = useState(false)
  const isCloningRef = useRef(false)
  const [error, setError] = useState<Error | null>(null)

  const setCloning = (cloning: boolean): void => {
    isCloningRef.current = cloning
    setIsCloning(cloning)
  }

  const cloneRepository = async (url: string, folderName: string): Promise<boolean> => {
    // isGitOperationRunning は描画した時点の値(ロックを含む合成)のため、押した時点のロックも lock.isAnyLocked() で見る
    if (isCloningRef.current || isGitOperationRunning || lock.isAnyLocked()) return false
    // 確認の時点の未保存の内容。clone の実行中に入った編集は、開くときにもう一度確認する(applyOpenedFolder)
    const dirtySnapshotAtConfirm = captureDirtySnapshot()
    if (!confirmDiscardAnyDirty()) return false
    setCloning(true)
    setError(null)
    lock.lockGlobal()
    try {
      const result = await gitApi.cloneRepository(url, folderName)
      if (result.status === 'canceled') return false
      await applyOpenedFolder(result.path, { dirtySnapshotAtConfirm })
      return true
    } catch (err) {
      setError(toError(err))
      return false
    } finally {
      lock.unlockGlobal()
      setCloning(false)
    }
  }

  // 中止は main が子プロセスを止めて保存先を削除し、cloneRepository が canceled で返る。依頼の失敗は表示しない
  // (中止できなかった場合も、clone の結果は cloneRepository の側に届く)
  const cancelClone = (): void => {
    if (!isCloningRef.current) return
    gitApi.cancelCloneRepository().catch(() => undefined)
  }

  const clearError = (): void => setError(null)

  return {
    isCloning,
    // isGitOperationRunning はロックを含む合成のため、clone 自身の全体ロックでも true になる。isBlocked は「他の
    // Git 操作の実行中」だけを表す(clone の実行中は isCloning が表す)
    isBlocked: isGitOperationRunning && !isCloning,
    error,
    cloneRepository,
    cancelClone,
    clearError
  }
}
