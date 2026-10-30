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
  AGENT_CHANGES_RUN_EMPTY,
  AGENT_CHANGES_RUN_HEAD_CHANGED,
  describeAgentChangesUnavailable,
  formatAgentChangesMore
} from '../../lib/agentChangesMessages'
import { toAnnouncementText } from '../../lib/announcementText'
import { isEntrySavedInApp } from '../../lib/agentChangesPaths'
import { getListedAgentChanges } from '../../lib/agentChangesScope'
import {
  agentChangesReasonTargets,
  buildAgentChangesSectionHeading,
  describeAgentChangesListUnavailable,
  describeAgentChangesSectionAttribution,
  describeAgentChangesSectionExcluded,
  describeAgentChangesStorage
} from '../../lib/agentChangesSectionText'
import type { AgentChangesReasonTarget } from '../../lib/agentChangesSectionText'
import AgentChangesFileItem from './AgentChangesFileItem'
import AgentChangesScopeSelect from './AgentChangesScopeSelect'
import AgentChangesUndoBand from './AgentChangesUndoBand'

/** 「いまから記録する」「もう一度試す」の記録開始ボタン(記録中は押せず、文言が変わる) */
function BeginRecordingButton({
  isBeginning,
  label,
  onBegin
}: {
  isBeginning: boolean
  label: string
  onBegin: () => void
}): React.JSX.Element {
  return (
    <div className="agent-changes__actions">
      <button
        type="button"
        className="agent-changes__button"
        disabled={isBeginning}
        onClick={onBegin}
      >
        {isBeginning ? '記録しています…' : label}
      </button>
    </div>
  )
}

/** セクションの props。Git 管理外かは SourceControlPanel が決め、それ以外は useAgentChangesWiring が組み立てる */
export type AgentChangesSectionProps = AgentChangesPanelState & {
  /** Git 管理外のフォルダか(記録の前に、記録をアプリの一時領域に置く旨の 1 行を出す) */
  isNotRepository: boolean
}

// ソース管理パネルのセクション「エージェントの変更」(設計書「A の詳細」)。見出しのボタンで折りたためる(状態は保存しない)。
// 結果の通知は常設の aria-live の要素に入れる(パターン 87・151)。フォーカスの制御は useAgentChangesSectionFocus に置く
export default function AgentChangesSection({
  changes,
  focusRequest,
  revert,
  undo,
  folderPath,
  isNotRepository,
  isAgentMode,
  cliKind,
  onOpenDiff
}: AgentChangesSectionProps): React.JSX.Element | null {
  const headingId = useId()
  const bodyId = useId()
  const reasonId = useId()
  const undoReasonId = useId()
  const excludedNoteId = useId()
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
  const beginRecording = (): void => {
    reserveFocusRestore()
    void changes.begin()
  }

  // 読み上げの要素はセクションの直前に常設する(Fragment の 1 番目の子に固定)。表示しないときも残し、表示の切り替えで
  // 作り直さない(文言ごと挿入し直したライブリージョンは読み上げられない。従来の方式で確認を終えた通知のため。パターン 151)
  const live = (
    <p className="agent-changes__live" aria-live="polite" aria-atomic="true">
      {toAnnouncementText(changes.notice)}
    </p>
  )
  if (!isVisible) return <>{live}</>

  const isNoneShown = view.kind === 'none'
  // 記録の置き場の注記(本文の先頭に 1 行。記録中は記録が隠れた git のとき、記録の前は Git 管理外のフォルダのとき)。読み上げない
  const storageNote = describeAgentChangesStorage(view, isNotRepository)
  const recording = view.kind === 'recording' ? view : null
  const list = getListedAgentChanges(view)
  // 見出しは選んでいる実行(範囲が実行で、写しの実行の一覧にあるとき)の番号と期間、または累積の始点を添える
  const heading = buildAgentChangesSectionHeading(view, changes.scope)
  // 表示中の一覧が実行の範囲か(空の文言・HEAD の帯・あなたの保存を含むの印を出し分ける)
  const isRunList = list !== null && list.scope.kind === 'run'
  // 範囲の一覧が取れない(写しが古い)理由
  const listUnavailableText = describeAgentChangesListUnavailable(view)
  const hasEntries = list !== null && list.entries.length > 0
  // 押せない理由は 1 か所に出す。「すべて戻す」の理由は「ファイル単位の理由(実行の範囲を含む)」「打ち切り」「記録していないファイルを含む」
  // (notRecorded)「利用者の変更だけで対象が無い」のいずれか。行の戻すボタンがこの要素を参照できるのは、agentRevertAllDisabledReason が
  // ファイル単位の理由を先に評価する(行が押せないときは必ず同じ文言になる)という評価の順序に依存している
  const shownReason = hasEntries ? revert.revertAllDisabledReason : null
  // 区別の状態の 1 行(累積の範囲で、表示中の一覧が実行の範囲でないときだけ。出さないなら null)。読み上げない(aria-live にしない)
  const attributionNote = describeAgentChangesSectionAttribution(view, changes.scope, cliKind)
  // すべて戻すから除く行の旨(行があり、累積の一覧で、除く件数が 1 以上のとき)。すべて戻すの aria-describedby で結ぶ(L-413)
  const excludedNote = describeAgentChangesSectionExcluded(view, revert.revertAllExcludedCount)
  // すべて戻すが結ぶ要素(押せない理由と除く旨のうちあるもの。どちらも無ければ付けない)
  const revertAllDescribedBy =
    [
      revert.revertAllDisabledReason !== null ? reasonId : null,
      excludedNote !== null ? excludedNoteId : null
    ]
      .filter((id): id is string => id !== null)
      .join(' ') || undefined
  // 戻す操作・取り消しの実行中(範囲の選択・確認を終えるを押せなくする)
  const isWriting = revert.runningOperation !== null
  // 範囲の選択・確認を終えるが結ぶ理由の要素と、帯が先に消えたときにセクションに取り消しの理由を出すか
  const reasonTargets = agentChangesReasonTargets({
    isWriting,
    hasListReason: shownReason !== null,
    hasUndoBand: recording !== null && recording.undo !== null
  })
  const reasonIdOf = (target: AgentChangesReasonTarget): string | null =>
    target === 'list' ? reasonId : target === 'undo' ? undoReasonId : null

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
          {storageNote !== null && <p className="agent-changes__note">{storageNote}</p>}
          {isNoneShown && (
            <>
              <p className="agent-changes__note">{AGENT_CHANGES_NONE_HINT}</p>
              <BeginRecordingButton
                isBeginning={changes.isBeginning}
                label="いまから記録する"
                onBegin={beginRecording}
              />
            </>
          )}
          {view.kind === 'unavailable' && (
            <>
              <p className="agent-changes__note">{describeAgentChangesUnavailable(view.state)}</p>
              {canRetryAgentChanges(view.state.reason) && (
                <BeginRecordingButton
                  isBeginning={changes.isBeginning}
                  label="もう一度試す"
                  onBegin={beginRecording}
                />
              )}
            </>
          )}
          {recording !== null && (
            <>
              {recording.runs.length > 0 && (
                <AgentChangesScopeSelect
                  startedAt={recording.startedAt}
                  runs={recording.runs}
                  scope={changes.scope}
                  disabled={isWriting}
                  disabledReasonId={reasonIdOf(reasonTargets.scopeSelect)}
                  onSelect={(next) => {
                    // 戻す操作の実行中は範囲を変えない(戻した結果の同期と取り直しが混ざる。L-039・L-058)
                    if (!isWriting) changes.selectScope(next)
                  }}
                />
              )}
              {attributionNote !== null && <p className="agent-changes__note">{attributionNote}</p>}
              {recording.undo !== null && (
                <AgentChangesUndoBand
                  summary={recording.undo}
                  disabledReason={undo.undoDisabledReason}
                  reasonId={undoReasonId}
                  onUndo={() => {
                    // 押すと帯が消える(取り消しの結果で写しの undo が null になる)。見出しへ戻す予約をする
                    reserveFocusRestore()
                    void undo.undoLastRevert()
                  }}
                />
              )}
              {reasonTargets.showSectionUndoReason && (
                <p id={undoReasonId} className="agent-changes__note">
                  {undo.undoDisabledReason}
                </p>
              )}
              {changes.listError !== null && (
                <p className="agent-changes__error" role="alert">
                  {changes.listError}
                </p>
              )}
              {revert.error !== null && (
                // ハンクの失敗は diff タブ側の常設の aria-live が読み上げるため、ここは見た目だけ(二重に読ませない)
                <p
                  className="agent-changes__error"
                  role={revert.isErrorAnnouncedInDiff ? undefined : 'alert'}
                >
                  {revert.error}
                </p>
              )}
              {list?.headChanged === true && (
                <p className="agent-changes__note">
                  {isRunList ? AGENT_CHANGES_RUN_HEAD_CHANGED : AGENT_CHANGES_HEAD_CHANGED}
                </p>
              )}
              {listUnavailableText !== null && (
                <p className="agent-changes__note">{listUnavailableText}</p>
              )}
              {shownReason !== null && (
                <p id={reasonId} className="agent-changes__note">
                  {shownReason}
                </p>
              )}
              {list !== null && list.entries.length === 0 && (
                <p className="agent-changes__note">
                  {isRunList ? AGENT_CHANGES_RUN_EMPTY : AGENT_CHANGES_EMPTY}
                </p>
              )}
              {hasEntries && (
                <ul className="source-control-panel__file-list">
                  {list.entries.map((entry) => (
                    <AgentChangesFileItem
                      key={entry.path}
                      entry={entry}
                      savedInApp={
                        !isRunList && isEntrySavedInApp(folderPath, changes.savedPaths, entry.path)
                      }
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
              {excludedNote !== null && (
                <p id={excludedNoteId} className="agent-changes__note">
                  {excludedNote}
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
                    aria-describedby={revertAllDescribedBy}
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
                  disabled={isWriting}
                  aria-describedby={reasonIdOf(reasonTargets.clear) ?? undefined}
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
