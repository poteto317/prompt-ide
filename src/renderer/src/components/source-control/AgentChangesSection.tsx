'use client'
import { useCallback, useId, useState } from 'react'
import type { AgentChangesPanelState } from '../../hooks/useAgentChangesWiring'
import { useAgentChangesSectionFocus } from '../../hooks/useAgentChangesSectionFocus'
import {
  canRetryAgentChanges,
  isAgentChangesSectionVisible
} from '../../lib/agentChangesAvailability'
import {
  AGENT_CHANGES_EMPTY,
  AGENT_CHANGES_HEAD_CHANGED,
  AGENT_CHANGES_LOADING,
  AGENT_CHANGES_NONE_HINT,
  AGENT_CHANGES_UNAVAILABLE_MESSAGES,
  buildAgentChangesHeading,
  describeAgentChangesUnavailable,
  formatAgentChangesMore
} from '../../lib/agentChangesMessages'
import { toAnnouncementText } from '../../lib/announcementText'
import { isEntrySavedInApp } from '../../lib/agentChangesPaths'
import AgentChangesFileItem from './AgentChangesFileItem'

/** セクションの props。Git 管理外かは SourceControlPanel が決め、それ以外は useAgentChangesWiring が組み立てる */
export type AgentChangesSectionProps = AgentChangesPanelState & {
  /** Git 管理外のフォルダか(記録を始める前から理由を出す) */
  isNotRepository: boolean
}

// ソース管理パネルのセクション「エージェントの変更」(設計書「A の詳細」)。見出しのボタンで折りたためる(状態は保存しない)。
// 結果の通知は常設の aria-live の要素に入れる(パターン 87・151)。フォーカスの制御は useAgentChangesSectionFocus に置く
export default function AgentChangesSection({
  changes,
  focusRequest,
  revert,
  folderPath,
  isNotRepository,
  isAgentMode,
  onOpenDiff
}: AgentChangesSectionProps): React.JSX.Element | null {
  const headingId = useId()
  const bodyId = useId()
  const reasonId = useId()
  const [isOpen, setIsOpen] = useState(true)
  const openSection = useCallback((): void => setIsOpen(true), [])
  const { view } = changes
  const isVisible = isAgentChangesSectionVisible(isAgentMode, view.kind)
  // フォーカスの制御(依頼による見出しへの移動・押したボタンが押せなくなった後の復帰)。早期 return より前で呼ぶ
  const { headingRef, sectionRef, reserveFocusRestore } = useAgentChangesSectionFocus({
    isVisible,
    isFocusRequested: focusRequest.isRequested,
    consumeFocusRequest: focusRequest.consume,
    openSection
  })

  // 読み上げの要素はセクションの直前に常設する(Fragment の 1 番目の子に固定)。表示しないときも残し、表示の切り替えで
  // 作り直さない(文言ごと挿入し直したライブリージョンは読み上げられない。従来の方式で確認を終えた通知のため。パターン 151)
  const live = (
    <p className="agent-changes__live" aria-live="polite" aria-atomic="true">
      {toAnnouncementText(changes.notice)}
    </p>
  )
  if (!isVisible) return <>{live}</>

  // 管理外で記録できなかった後にリポジトリを初期化したら、次の「実行」を待たずに記録なしと同じ表示に戻す
  const isNoneShown =
    view.kind === 'none' ||
    (view.kind === 'unavailable' && view.state.reason === 'not-repository' && !isNotRepository)
  const recording = view.kind === 'recording' ? view : null
  const list = recording?.list ?? null
  const heading = buildAgentChangesHeading(
    recording === null
      ? null
      : { startedAt: recording.startedAt, totalCount: list?.totalCount ?? null }
  )
  const hasEntries = list !== null && list.entries.length > 0
  // 押せない理由は 1 か所に出す。「すべて戻す」の理由は「ファイル単位の理由」「打ち切り」「記録していないファイルを含む」
  // (notRecorded)のいずれか。行の戻すボタンがこの要素を参照できるのは、agentRevertAllDisabledReason がファイル単位の
  // 理由を先に評価する(行が押せないときは必ず同じ文言になる)という評価の順序に依存している
  const shownReason = hasEntries ? revert.revertAllDisabledReason : null

  return (
    <>
      {live}
      <section
        ref={sectionRef}
        className="source-control-panel__section agent-changes"
        aria-labelledby={headingId}
      >
        <div className="agent-changes__header">
          <h3 className="source-control-panel__section-title agent-changes__title">
            <button
              ref={headingRef}
              id={headingId}
              type="button"
              className="agent-changes__toggle"
              aria-expanded={isOpen}
              aria-controls={bodyId}
              onClick={() => setIsOpen((open) => !open)}
            >
              <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span> {heading}
            </button>
          </h3>
          {recording !== null && changes.isLoading && (
            <span className="agent-changes__loading">{AGENT_CHANGES_LOADING}</span>
          )}
        </div>
        <div id={bodyId} className="agent-changes__body" hidden={!isOpen}>
          {isNoneShown &&
            (isNotRepository ? (
              <p className="agent-changes__note">
                {AGENT_CHANGES_UNAVAILABLE_MESSAGES['not-repository']}
              </p>
            ) : (
              <>
                <p className="agent-changes__note">{AGENT_CHANGES_NONE_HINT}</p>
                <div className="agent-changes__actions">
                  <button
                    type="button"
                    className="agent-changes__button"
                    disabled={changes.isBeginning}
                    onClick={() => {
                      reserveFocusRestore()
                      void changes.begin()
                    }}
                  >
                    {changes.isBeginning ? '記録しています…' : 'いまから記録する'}
                  </button>
                </div>
              </>
            ))}
          {view.kind === 'unavailable' && !isNoneShown && (
            <>
              <p className="agent-changes__note">{describeAgentChangesUnavailable(view.state)}</p>
              {canRetryAgentChanges(view.state.reason) && (
                <div className="agent-changes__actions">
                  <button
                    type="button"
                    className="agent-changes__button"
                    disabled={changes.isBeginning}
                    onClick={() => {
                      reserveFocusRestore()
                      void changes.begin()
                    }}
                  >
                    {changes.isBeginning ? '記録しています…' : 'もう一度試す'}
                  </button>
                </div>
              )}
            </>
          )}
          {recording !== null && (
            <>
              {changes.listError !== null && (
                <p className="agent-changes__error" role="alert">
                  {changes.listError}
                </p>
              )}
              {revert.error !== null && (
                <p className="agent-changes__error" role="alert">
                  {revert.error}
                </p>
              )}
              {list?.headChanged === true && (
                <p className="agent-changes__note">{AGENT_CHANGES_HEAD_CHANGED}</p>
              )}
              {shownReason !== null && (
                <p id={reasonId} className="agent-changes__note">
                  {shownReason}
                </p>
              )}
              {list !== null && list.entries.length === 0 && (
                <p className="agent-changes__note">{AGENT_CHANGES_EMPTY}</p>
              )}
              {hasEntries && (
                <ul className="source-control-panel__file-list">
                  {list.entries.map((entry) => (
                    <AgentChangesFileItem
                      key={entry.path}
                      entry={entry}
                      savedInApp={isEntrySavedInApp(folderPath, changes.savedPaths, entry.path)}
                      disabledReason={revert.revertDisabledReason}
                      disabledReasonId={reasonId}
                      onOpenDiff={onOpenDiff}
                      onRevert={(target) => {
                        reserveFocusRestore()
                        void revert.revertFile(target)
                      }}
                    />
                  ))}
                </ul>
              )}
              {list !== null && list.totalCount > list.entries.length && (
                <p className="agent-changes__note">
                  {formatAgentChangesMore(list.totalCount - list.entries.length)}
                </p>
              )}
              <div className="agent-changes__actions">
                <button
                  type="button"
                  className="agent-changes__button"
                  onClick={() => void changes.refresh({ announce: true })}
                >
                  更新
                </button>
                {hasEntries && (
                  <button
                    type="button"
                    className="agent-changes__button agent-changes__button--danger"
                    disabled={revert.revertAllDisabledReason !== null}
                    aria-describedby={
                      revert.revertAllDisabledReason !== null ? reasonId : undefined
                    }
                    onClick={() => {
                      reserveFocusRestore()
                      void revert.revertAll()
                    }}
                  >
                    すべて戻す
                  </button>
                )}
                <button
                  type="button"
                  className="agent-changes__button"
                  disabled={revert.isReverting}
                  aria-describedby={
                    revert.isReverting && shownReason !== null ? reasonId : undefined
                  }
                  onClick={() => {
                    reserveFocusRestore()
                    void changes.clear()
                  }}
                >
                  確認を終える
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  )
}
