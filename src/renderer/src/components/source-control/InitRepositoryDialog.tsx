import { normalizeInitialBranchName } from '@shared/branchName'
import { validateInitialBranchName } from '../../lib/remoteSetupValidation'
import RemoteSetupInputDialog from './RemoteSetupInputDialog'

interface Props {
  isRunning: boolean
  isBlocked: boolean
  error: Error | null
  /** 検証を通過した最初のブランチ名(前後の空白を除き NFC) */
  onSubmit: (branch: string) => void
  onCancel: () => void
}

// リポジトリの初期化のダイアログ。共通のダイアログに、最初のブランチ名の正規化・検証と文言を渡すだけにする
// (CreateBranchDialog が NameInputDialog を包むのと同じ形)。既定値は main(init.defaultBranch は読まない。利用者の決定)
export default function InitRepositoryDialog({
  isRunning,
  isBlocked,
  error,
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  return (
    <RemoteSetupInputDialog
      title="リポジトリを初期化"
      description="このフォルダに空の Git リポジトリを作成します"
      label="ブランチ名"
      initialValue="main"
      submitLabel="初期化"
      runningSubmitLabel="初期化中..."
      runningNotice="初期化中です"
      normalize={normalizeInitialBranchName}
      validate={validateInitialBranchName}
      isRunning={isRunning}
      isBlocked={isBlocked}
      error={error}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  )
}
