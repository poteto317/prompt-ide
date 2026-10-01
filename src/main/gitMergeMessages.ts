// マージ失敗時に表示する未解決ファイルの上限。超えた分は「ほか N 件」にまとめる
export const MAX_LISTED_CONFLICT_FILES = 5

// 未解決ファイルを ', ' 区切りで並べる。上限を超えた分は「ほか N 件」にまとめる。
// git の呼び出し(I/O)とは無関係な、純粋な文言の組み立ての責務のため gitService.ts から分離している。
export function formatConflictFiles(files: string[]): string {
  const shown = files.slice(0, MAX_LISTED_CONFLICT_FILES).join(', ')
  const rest = files.length - MAX_LISTED_CONFLICT_FILES
  return rest > 0 ? `${shown} ほか ${rest} 件` : shown
}

// 中止したマージのエラー文言を組み立てる。対象は未解決ファイルが無いのに MERGE_HEAD が残った
// マージ(pre-merge-commit フックの失敗等)で、git のエラー文 detail を添える。detail が空なら添えない
// (未解決ファイルがあるコンフリクトは中止しないため、buildMergeConflictMessage を使う)
export function buildMergeAbortMessage(detail: string): string {
  return detail === ''
    ? 'マージを完了できなかったため中止しました'
    : `マージを完了できなかったため中止しました: ${detail}`
}

// コンフリクトしたまま止めたマージのエラー文言。マージは中止せず途中の状態を残すため、
// 解決するか中止するかをユーザーに促す
export function buildMergeConflictMessage(conflicted: string[]): string {
  return `コンフリクトしました（${formatConflictFiles(conflicted)}）。解決するか、マージを中止してください`
}
