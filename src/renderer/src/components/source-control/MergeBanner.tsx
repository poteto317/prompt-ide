import type { MergeStatePanelState } from '../../types'
import { buildMergeBannerText } from '../../lib/mergeStateMessage'

interface Props {
  mergeState: MergeStatePanelState
  /** 他の操作中(ステージ・ハンク操作・commit・pull・ブランチ操作・退避・解決ビューの操作)で、
   *  押しても no-op になる状態。完了・中止を disabled にする */
  isBlocked: boolean
}

// マージ中のバナー(件数・「マージを完了」「マージを中止」・エラー)。マージ中でなければ何も出さない。
// 操作の実行・排他・確認は呼び出し元(useAppState / useMergeState)の責務。
// 実行中は押したボタンだけ実行中の表示にし、どちらも disabled にする(StashSection と同じ作り)
export default function MergeBanner({ mergeState, isBlocked }: Props): React.JSX.Element | null {
  if (!mergeState.inProgress) return null
  const isCompleting = mergeState.pendingOperation === 'complete'
  const isAborting = mergeState.pendingOperation === 'abort'
  const isRunning = mergeState.pendingOperation !== null || isBlocked

  return (
    <section className="merge-banner">
      <p className="merge-banner__message" role="status">
        {buildMergeBannerText(mergeState.unresolvedCount)}
      </p>
      <div className="merge-banner__actions">
        <button
          type="button"
          className="merge-banner__button"
          aria-label={isCompleting ? '完了中' : 'マージを完了'}
          disabled={!mergeState.canComplete || isRunning}
          onClick={() => void mergeState.onComplete()}
        >
          {isCompleting ? '完了中...' : 'マージを完了'}
        </button>
        <button
          type="button"
          className="merge-banner__button merge-banner__button--danger"
          aria-label={isAborting ? '中止中' : 'マージを中止'}
          disabled={isRunning}
          onClick={() => void mergeState.onAbort()}
        >
          {isAborting ? '中止中...' : 'マージを中止'}
        </button>
      </div>
      {mergeState.error !== null && (
        <p className="merge-banner__error" role="alert">
          {mergeState.error.message}
        </p>
      )}
    </section>
  )
}
