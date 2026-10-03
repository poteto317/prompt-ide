import { normalizeRemoteUrl } from '@shared/remoteUrl'
import { validateRemoteUrl } from '../../lib/remoteUrlValidation'
import RemoteSetupInputDialog from './RemoteSetupInputDialog'

interface Props {
  isRunning: boolean
  isBlocked: boolean
  error: Error | null
  /** 検証を通過した URL(前後の空白だけを除いたもの) */
  onSubmit: (url: string) => void
  onCancel: () => void
}

// リモート origin の追加のダイアログ。共通のダイアログに、URL の正規化・検証と文言を渡すだけにする。
// 名前は origin 固定で、この時点では接続しない
export default function AddRemoteDialog({
  isRunning,
  isBlocked,
  error,
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  return (
    <RemoteSetupInputDialog
      title="リモートを追加"
      description="リモート origin を追加します（この時点では接続しません）"
      label="URL"
      initialValue=""
      submitLabel="追加"
      runningSubmitLabel="追加中..."
      runningNotice="追加中です"
      normalize={normalizeRemoteUrl}
      validate={validateRemoteUrl}
      isRunning={isRunning}
      isBlocked={isBlocked}
      error={error}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  )
}
