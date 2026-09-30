// マージ失敗時に表示する未解決ファイルの上限。超えた分は「ほか N 件」にまとめる
export const MAX_LISTED_CONFLICT_FILES = 5

// 未解決ファイルを ', ' 区切りで並べる。上限を超えた分は「ほか N 件」にまとめる。
// git の呼び出し(I/O)とは無関係な、純粋な文言の組み立ての責務のため gitService.ts から分離している。
export function formatConflictFiles(files: string[]): string {
  const shown = files.slice(0, MAX_LISTED_CONFLICT_FILES).join(', ')
  const rest = files.length - MAX_LISTED_CONFLICT_FILES
  return rest > 0 ? `${shown} ほか ${rest} 件` : shown
}

// 中止したマージのエラー文言を組み立てる。未解決ファイルがあればそれを示し(detail は無視)、
// 無ければ(pre-merge-commit フックの失敗等)git のエラー文 detail を添える。detail が空なら添えない
export function buildMergeAbortMessage(conflicted: string[], detail: string): string {
  if (conflicted.length > 0) {
    return `コンフリクトしたため中止しました: ${formatConflictFiles(conflicted)}`
  }
  return detail === ''
    ? 'マージを完了できなかったため中止しました'
    : `マージを完了できなかったため中止しました: ${detail}`
}
