interface Props {
  gitLoading: boolean
  onRefresh: () => void
  isPushing: boolean
  isPulling: boolean
  isFetching: boolean
  /** push/pull は同時実行不可、pull はハンク操作/commit 中も不可、という業務
   *  ルールの判定結果。ルールの中身は useGitRemoteOperations 側の責務であり、
   *  ここでは受け取った値をそのまま disabled に反映するだけにする */
  isPushBlocked: boolean
  isPullBlocked: boolean
  /** リポジトリが無いため push/pull/fetch がそもそも実行不可能な状態か。
   *  「更新」ボタンと違い non-repo 時は disabled にする(誤操作防止)。この
   *  判定自体も useGitRemoteOperations 側の責務であり、Toolbar は gitStatus
   *  自体を知らずに受け取った値をそのまま反映するだけにする */
  isRemoteOperationDisabled: boolean
  onPush: () => Promise<void>
  onPull: () => Promise<void>
  onFetch: () => Promise<void>
}

export default function SourceControlToolbar({
  gitLoading,
  onRefresh,
  isPushing,
  isPulling,
  isFetching,
  isPushBlocked,
  isPullBlocked,
  isRemoteOperationDisabled,
  onPush,
  onPull,
  onFetch
}: Props): React.JSX.Element {
  return (
    <div className="source-control-panel__toolbar">
      <button
        type="button"
        className="source-control-panel__refresh-btn"
        onClick={onRefresh}
        disabled={gitLoading}
        aria-label="更新"
      >
        更新
      </button>
      <button
        type="button"
        className="source-control-panel__fetch-btn"
        onClick={onFetch}
        disabled={isRemoteOperationDisabled || isFetching}
        aria-label={isFetching ? 'フェッチ中' : 'フェッチ'}
      >
        {isFetching ? 'フェッチ中...' : 'フェッチ'}
      </button>
      <button
        type="button"
        className="source-control-panel__pull-btn"
        onClick={onPull}
        disabled={isRemoteOperationDisabled || isPulling || isPullBlocked}
        aria-label={isPulling ? 'プル中' : 'プル'}
      >
        {isPulling ? 'プル中...' : 'プル'}
      </button>
      <button
        type="button"
        className="source-control-panel__push-btn"
        onClick={onPush}
        disabled={isRemoteOperationDisabled || isPushing || isPushBlocked}
        aria-label={isPushing ? 'プッシュ中' : 'プッシュ'}
      >
        {isPushing ? 'プッシュ中...' : 'プッシュ'}
      </button>
    </div>
  )
}
