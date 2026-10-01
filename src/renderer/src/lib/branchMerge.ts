// マージの確認文言。コンフリクトしたらマージ中の状態で止まり、解決するか中止できる旨を伝える
// (lib/branchDeletion.ts と同じ位置づけの純粋関数)
export function buildMergeConfirmMessage(branchName: string, currentBranch: string): string {
  return `${branchName} を ${currentBranch} にマージしますか？\n\nコンフリクトした場合はマージ中の状態で止まります。解決するか、マージを中止できます。`
}
