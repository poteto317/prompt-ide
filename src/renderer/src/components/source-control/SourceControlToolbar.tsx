import { sidebarTitles } from '../../config/sidebarTitles'
import ActionMenu from './ActionMenu'

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
      <h2 className="source-control-panel__title">{sidebarTitles['source-control']}</h2>
      <button
        type="button"
        className="source-control-panel__refresh-btn"
        onClick={onRefresh}
        disabled={gitLoading}
        aria-label="更新"
        title="更新"
      >
        <span aria-hidden="true">↻</span>
      </button>
      <ActionMenu
        buttonLabel="その他の操作"
        buttonContent={<span aria-hidden="true">…</span>}
        buttonClassName="source-control-panel__more-btn"
        // 初回 push の成功の後のフォーカスの移し先(useRemoteSetupFocus が探す)
        focusTarget="push"
        items={[
          {
            id: 'pull',
            label: isPulling ? 'プル中...' : 'プル',
            ariaLabel: isPulling ? 'プル中' : 'プル',
            disabled: isRemoteOperationDisabled || isPulling || isPullBlocked,
            onSelect: onPull
          },
          {
            id: 'push',
            label: isPushing ? 'プッシュ中...' : 'プッシュ',
            ariaLabel: isPushing ? 'プッシュ中' : 'プッシュ',
            disabled: isRemoteOperationDisabled || isPushing || isPushBlocked,
            onSelect: onPush
          },
          {
            id: 'fetch',
            label: isFetching ? 'フェッチ中...' : 'フェッチ',
            ariaLabel: isFetching ? 'フェッチ中' : 'フェッチ',
            disabled: isRemoteOperationDisabled || isFetching,
            onSelect: onFetch
          }
        ]}
      />
    </div>
  )
}
