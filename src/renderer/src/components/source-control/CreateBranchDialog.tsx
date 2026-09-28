import type { GitBranch } from '@shared/types'
import NameInputDialog from '../explorer/NameInputDialog'
import { validateBranchName } from '../../lib/branchNameValidation'

interface Props {
  /** 重複判定に使う既存のローカルブランチ一覧 */
  branches: GitBranch[]
  /** 検証を通過した(trim 済みの)ブランチ名 */
  onSubmit: (branchName: string) => void
  /** キャンセル・Escape・オーバーレイクリックのいずれでも呼ばれる */
  onCancel: () => void
}

// 新しいブランチ名の入力ダイアログ。名前入力 UI は NameInputDialog を流用し、ここでは
// ブランチ名用の検証(validateBranchName)を差し込むことだけを担う。開閉状態やフォーカスの
// 戻し先は呼び出し元(BranchSwitcher)の責務
export default function CreateBranchDialog({
  branches,
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  const existingNames = branches.map((b) => b.name)
  return (
    <NameInputDialog
      title="新しいブランチ名"
      validate={(name) => validateBranchName(name, existingNames)}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  )
}
