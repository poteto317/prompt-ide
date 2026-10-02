import { useRef, useState } from 'react'
import type { CreateTagRequest, GitStatusResult } from '@shared/types'
import * as gitApi from '../lib/gitApi'
import { isGitOperationDisabled } from '../lib/gitUtils'
import type { GitTagPanelState } from '../types'
import { useFileOperationLock } from './useFileOperationLock'
import type { FileOperationLock } from './useFileOperationLock'
import { useRunExclusiveGitOperation } from './useRunExclusiveGitOperation'

// タグの作成。useGitStashOperations と同じ作り: 作成どうしは実行中フラグ(ref)で排他にし、
// 他の Git 操作がロックを持っている間(lock.isAnyLocked())とリポジトリが無い間は実行しない。
// checkout・マージ・commit の途中は HEAD が動くため、付ける先が定まるまで待つ(ブランチの削除と同じ判断)。
// 作成は ref を 1 つ増やすだけで作業ツリー・index・HEAD を変えず、push / pull / ブランチ操作と読み書きする
// 対象が重ならないため、lockGlobal は取らない(取ると作成中に push 等が無意味に待たされる)。
// lockGlobal を取らないため、main が HEAD を確認してから git tag を実行するまでの数 ms の間に
// checkout が割り込むと、タグが移動後の HEAD に付く理論上の窓がある。設計書の判断として許容する
// (作成は ref を 1 つ増やすだけで、データは失われず、タグは後から削除できる)。
// 再取得は成功・失敗のどちらでも行い(他のプロセスが作ったタグも反映する)、実行中フラグは再取得の後で
// 解除する(useRunExclusiveGitOperation。パターン 73)。再取得の失敗は作成の成否を変えない(パターン 52)
export function useGitTagOperations(
  gitStatus: GitStatusResult | null,
  refreshHistory: () => Promise<void>,
  fileLock?: FileOperationLock
): GitTagPanelState {
  const [isCreating, setIsCreating] = useState(false)
  const isRunningRef = useRef(false)
  const [error, setError] = useState<Error | null>(null)
  const localFileLock = useFileOperationLock()
  const lock = fileLock ?? localFileLock
  const isDisabled = isGitOperationDisabled(gitStatus)

  // 履歴の再取得(useGitHistory.refresh)がログ・ブランチ・タグをまとめて取り直す。
  // 作業ツリーは変わらないため、ステータスの再取得は不要
  const runOperation = useRunExclusiveGitOperation(refreshHistory, setError)

  const createTag = (request: CreateTagRequest): Promise<boolean> =>
    runOperation({
      isBusy: () => isRunningRef.current || lock.isAnyLocked() || isDisabled,
      setBusy: (busy) => {
        isRunningRef.current = busy
        setIsCreating(busy)
      },
      // 再試行の作成中に前回のエラー(role="alert")を残さない。残すと作成中の案内(role="status")と同時に出て、
      // 同じ文言で再び失敗したときに alert の DOM が変わらず読み上げられない(PR #41 の 3 周目のレビュー)。
      // 開始時に null にしておけば、再び失敗したときに alert が作り直される。onStart は isBusy で実行しない場合には
      // 呼ばれないため、ロック中などで何も起きないときは表示中のエラーを消さない。
      // useRunExclusiveGitOperation の共通の挙動(execute の後にだけ setError する)は他の操作に波及するため変えない
      onStart: () => setError(null),
      execute: () => gitApi.createTag(request)
    })

  const clearError = (): void => setError(null)

  return { isCreating, error, createTag, clearError }
}
