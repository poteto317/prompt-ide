import { normalizeInitialBranchName } from '@shared/branchName'
import { validateBranchName } from './branchNameValidation'

// リポジトリの初期化のダイアログの検証(UX 用。セキュリティ境界は main 側)。
// 規則と順序は main と共有の @shared/branchName を使う(ブランチ名の文言は branchNameValidation の表を使う。
// パターン 88)。値は main の入口と同じ正規化を通してから検証する(パターン 83)。
// リモートの URL の検証は remoteUrlValidation(リモートの追加と clone で共通)

// 規則違反の文言はブランチの作成ダイアログ(branchNameValidation)の表を使う(同じ層に同じ表を 2 つ持たない。
// パターン 88)。既存のブランチの一覧を空で渡すため、重複・階層の衝突の判定は働かず、規則違反の文言だけが返る。
// git の規則(HEAD・`..`・末尾の .lock 等)は main の check-ref-format に委ねる
export function validateInitialBranchName(name: string): string | null {
  return validateBranchName(normalizeInitialBranchName(name), [])
}
