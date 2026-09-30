// マージの確認文言。コンフリクトはアプリ内に解決手段が無いため自動で中止する旨を伝える
// (lib/branchDeletion.ts と同じ位置づけの純粋関数)
export function buildMergeConfirmMessage(branchName: string, currentBranch: string): string {
  return `${branchName} を ${currentBranch} にマージしますか？\n\nコンフリクトした場合は自動で中止して元に戻します。`
}
