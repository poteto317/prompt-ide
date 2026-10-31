import { formatConflictFiles } from './gitMergeMessages'

const RESTORE_FAILURE_BASE =
  'stash の変更を作業ツリーへ戻せなかったため、戻す前の状態にしました。stash は残っています'

// 復元(git stash apply)に失敗して作業ツリーを元に戻したときのエラー文言を組み立てる。
// git のエラー文は status の出力のような長い文章で、そのまま見せても原因が分からないため使わない。
// コンフリクトがあればそのファイル名を、無ければ(同名の ignored ファイルがある、パスが
// 追跡済みのファイルに変わっている等)その旨の定型文を添える。git の呼び出し(I/O)とは無関係な
// 文言の組み立てのため gitService.ts から分離している(gitMergeMessages.ts と同じ位置づけ)
export function buildStashRestoreFailureMessage(conflicted: string[]): string {
  if (conflicted.length > 0) {
    return `${RESTORE_FAILURE_BASE}（コンフリクト: ${formatConflictFiles(conflicted)}）`
  }
  return `${RESTORE_FAILURE_BASE}（同名のファイルがあるなど、git が復元を完了できませんでした）`
}
