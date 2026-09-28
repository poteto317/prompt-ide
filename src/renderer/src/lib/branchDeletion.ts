import type { DeleteBranchResult } from '@shared/types'

export function buildDeleteConfirmMessage(branchName: string): string {
  return `ブランチ ${branchName} を削除しますか？`
}

export function buildForceDeleteConfirmMessage(branchName: string): string {
  return `ブランチ ${branchName} にはマージされていないコミットがあります。強制削除するとこれらのコミットは失われます。削除しますか？`
}

interface DeleteBranchConfirmingForceOptions {
  branchName: string
  deleteBranch: (branchName: string, force: boolean) => Promise<DeleteBranchResult>
  confirm: (message: string) => boolean
}

// 安全削除 → 未マージなら強制削除の確認 → 承諾されたら強制削除、という手順だけを担う。
// 1回目の削除確認・排他制御・エラー state への反映は呼び出し元(useGitBranchOperations)の
// 責務で、ここではエラーを握りつぶさずに伝播する。
// 戻り値は「ブランチが実際に削除されたか」。強制削除の確認でキャンセルされた場合は
// 正常終了して false を返す(キャンセルはエラーではないため)
export async function deleteBranchConfirmingForce({
  branchName,
  deleteBranch,
  confirm
}: DeleteBranchConfirmingForceOptions): Promise<boolean> {
  const result = await deleteBranch(branchName, false)
  if (result.deleted) return true
  if (!confirm(buildForceDeleteConfirmMessage(branchName))) return false
  const forced = await deleteBranch(branchName, true)
  return forced.deleted
}
