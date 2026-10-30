import { toError } from '../lib/errorUtils'

export interface ExclusiveGitOperationOptions {
  /** 開始条件。true を返す間は execute を呼ばずに no-op で返す */
  isBusy: () => boolean
  /** 実行中フラグ(ref と state の両方)の更新。開始時に true、終了時に false で呼ばれる */
  setBusy: (busy: boolean) => void
  /** 実行開始直後(execute の前)に呼ぶ副作用。ロック取得等 */
  onStart?: () => void
  /** 実行終了時(refresh 完了後)に呼ぶ副作用。ロック解放等 */
  onEnd?: () => void
  execute: () => Promise<void>
  /** 結果が古くなった(実行中にフォルダが切り替わった等)か。true なら成功も失敗もエラー state へ反映しない */
  isResultStale?: () => boolean
}

// fetch/pull/push/checkoutBranch はいずれも「開始条件を満たすか判定 → busy 化
// (必要なら副作用も) → 実行 → 成功/失敗を対応するエラー state へ反映 →
// refresh(失敗は無視) → busy 解除(副作用の後始末も)」という同じ手順を辿る。
// 異なるのは開始条件・busy フラグの実体・ロックの要否だけなので、手順そのものは
// 1箇所にまとめ、各操作は「何を」「どの条件で」実行するかだけを渡す
// (useGitOperations.ts の runStageOperation/runCommitOperation と同じ考え方)。
// 元は useGitRemoteOperations.ts 内の非公開ヘルパーだったが、
// useGitBranchOperations.ts も全く同じ手順を必要とする3つ目の消費者になった
// ため、この汎用ファイルへ切り出した(振る舞いは変更していない)
// 戻り値は「実際に execute が実行され、成功したか」。isBusy による no-op と
// execute 失敗はどちらも例外を投げず(呼び出し元の branchOperationError 等に
// エラーが反映されるだけ)正常終了するため、戻り値を見ずに「実行された前提」の
// 後続処理(useAppState.ts の checkoutBranch ラッパーが成功時だけ
// reloadOpenFiles を呼ぶ、等)を組み立てると、失敗/no-op の場合にもその後続
// 処理が走ってしまう(コードレビュー指摘: checkout 失敗時に無関係な未保存編集が
// reloadOpenFiles でサイレントに破棄される事故につながった)
export function useRunExclusiveGitOperation(
  refresh: () => Promise<void>,
  setError: (err: Error | null) => void
): (options: ExclusiveGitOperationOptions) => Promise<boolean> {
  return async ({ isBusy, setBusy, onStart, onEnd, execute, isResultStale }) => {
    if (isBusy()) return false
    setBusy(true)
    onStart?.()
    let succeeded = false
    try {
      await execute()
      if (!isResultStale?.()) setError(null)
      succeeded = true
    } catch (err) {
      if (!isResultStale?.()) setError(toError(err))
    } finally {
      // 操作自体(execute)が成功していた場合、refresh 自体の失敗理由で
      // エラー state を上書きしない(useGitOperations.ts の
      // runStageOperation/runCommitOperation と同じ理由)
      try {
        await refresh()
      } catch {
        // 握りつぶす(呼び出し元が別途エラー状態を持っていればそちらで扱う)
      } finally {
        setBusy(false)
        onEnd?.()
      }
    }
    return succeeded
  }
}
