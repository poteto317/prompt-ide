// マージ中バナーの文言と、マージの中止の確認文言。表示側(バナー)と確認(useMergeState)で共有する

/** マージ中バナーの文言。未解決が 0 件ならマージを完了できることを伝える */
export function buildMergeBannerText(unresolvedCount: number): string {
  if (unresolvedCount > 0) return `マージ中（未解決 ${unresolvedCount} 件）`
  return 'マージ中（すべて解決済み。マージを完了できます）'
}

/** マージの中止の確認文言(解決済みの内容も破棄されることを伝える) */
export const MERGE_ABORT_CONFIRM_MESSAGE =
  'マージを中止して、マージ前の状態に戻しますか？ 解決済みの内容も含め、マージ中の変更は破棄されます。'
