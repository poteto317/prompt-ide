import { getCloneFolderNameViolation } from '@shared/cloneFolderName'
import type { CloneFolderNameViolation } from '@shared/cloneFolderName'

// clone のダイアログのフォルダ名の検証(UX 用。セキュリティ境界は main 側)。判定は main と共有の @shared/cloneFolderName、
// 文言はここの表で持つ(main の gitCloneService の CLONE_FOLDER_NAME_MESSAGES と同じ文言。層ごとに表を持つ。パターン 88)。
// URL の検証はリモートの追加と同じ validateRemoteUrl(remoteUrlValidation)を使う
const CLONE_FOLDER_NAME_VIOLATION_MESSAGES: Record<CloneFolderNameViolation, string> = {
  empty: 'フォルダ名を入力してください',
  invalid: 'フォルダ名に使えない文字が含まれています'
}

export function validateCloneFolderName(name: string): string | null {
  const violation = getCloneFolderNameViolation(name)
  return violation === null ? null : CLONE_FOLDER_NAME_VIOLATION_MESSAGES[violation]
}
