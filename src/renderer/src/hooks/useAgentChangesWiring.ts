import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentChangesScope, GitStatusResult } from '@shared/types'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentChangesReviewAction, AgentDiffActions } from '../types'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentNotificationTab } from '../lib/agentNotificationEvents'
import {
  agentDiffContentRunNumber,
  canRevertAgentHunk,
  findActiveAgentEntry,
  findAgentDiffTabsToClose,
  isAgentChangesScopeUnavailable,
  isCumulativeAgentDiffScope
} from '../lib/agentChangesWiring'
import { recordingStartedAtOf } from '../lib/agentChangesView'
import type { AgentChangesController } from './useAgentChanges'
import { useLatestRef } from './useLatestRef'
import { useAgentChangesAutoRefresh } from './useAgentChangesAutoRefresh'
import type { AgentChangesRecording } from './useAgentChangesRecording'
import { useAgentChangesRevert } from './useAgentChangesRevert'
import type { AgentChangesRevertOptions, AgentChangesRevertState } from './useAgentChangesRevert'
import { useAgentChangesUndo } from './useAgentChangesUndo'
import type { AgentChangesUndoState } from './useAgentChangesUndo'
import { useAgentChangesWriteRunner } from './useAgentChangesWriteRunner'
import { refreshAfterAgentChangesWrite } from './agentChangesWriteSync'
import type { AgentChangesWriteRefreshers } from './agentChangesWriteSync'
import type { AgentLastExit } from './useAgentSessions'
import type { DiffRefreshOptions } from './useDiffOperations'
import type { DiffTabsState } from './useDiffTabs'
import type { FileOperationLock } from './useFileOperationLock'

// エージェントの変更の組み立ての後段(useAppState の中で useDiffOperations・useAgentWorkspace・useExternalFileChanges の
// 後に呼ぶ。effect の順序を変えないため、呼ぶ位置を動かさない)。一覧を取り直す契機(活動の出来事・フォーカスの復帰の自動の
// 取り直しは useAgentChangesAutoRefresh。監視の通知・フォーカスの復帰の静かな git status の後の一覧の静かな取り直しは、
// このファイルの git status の契機)、一覧から消えたパスの diff タブの
// 同期、戻す操作(useAgentChangesRevert)と取り消し(useAgentChangesUndo。実行の共有 useAgentChangesWriteRunner を共有する)、表示用の値(セクション・diff タブの操作・ターミナルの帯)の組み立てを持つ

// 一覧のパスと diff タブのパスの照合(フォルダの行は末尾に / が付く。どちらかが null なら一致しない)
function isSameAgentPath(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
}

export interface AgentChangesFocusRequest {
  isRequested: boolean
  /** セクションがフォーカスを移したら呼ぶ(依頼を下ろす) */
  consume: () => void
}

/** ソース管理パネルのセクション「エージェントの変更」へ渡す状態(Git 管理外かは SourceControlPanel が決める) */
export interface AgentChangesPanelState {
  changes: Pick<
    AgentChangesController,
    | 'view'
    | 'isLoading'
    | 'isBeginning'
    | 'listError'
    | 'notice'
    | 'savedPaths'
    | 'refresh'
    | 'clear'
    | 'scope'
    | 'selectScope'
  > & {
    /** 「いまから記録する」「もう一度試す」。manual で記録を始めてから一覧を取る(useAgentChangesRecording.beginManuallyAndRefresh) */
    begin: () => Promise<void>
  }
  /** セクションの見出しへフォーカスを移す依頼(ターミナルの帯の「変更を確認」) */
  focusRequest: AgentChangesFocusRequest
  revert: AgentChangesRevertState
  /** 直前の戻す操作の取り消し(セクションの帯) */
  undo: AgentChangesUndoState
  /** 開いているフォルダ(保存したパスとの突き合わせに使う) */
  folderPath: string | null
  /** エージェント CLI 方式か。従来の方式では記録がある間だけ出す */
  isAgentMode: boolean
  /** 設定の種類(useAgentWorkspace の appCliKind)。区別の文言の CLI の名前と精度の注記に使う(省略できない。L-060) */
  cliKind: AgentCliKind
  onOpenDiff: (path: string) => void
}

export interface AgentChangesWiringOptions {
  folderPath: string | null
  recording: AgentChangesRecording
  gitStatus: GitStatusResult | null
  refreshGitStatus: () => Promise<void>
  /** 今の gitStatus を静かな取得が置いたか(useGitStatus.wasGitStatusSetQuietly)。真なら一覧も静かに取り直す */
  wasGitStatusSetQuietly: () => boolean
  /** いずれかのタブのセッションの最後の終了(一覧を取り直す契機。終了のたびに新しいオブジェクト) */
  agentSessionExit: AgentLastExit | null
  /** どれかのタブのセッションが動いているか(起動中を含む。戻すの確認の文言に足す) */
  agentRunning: boolean
  /** エージェントのタブ(useAgentSessions の tabs。自動の取り直しの活動の出来事に使う) */
  agentTabs: readonly AgentNotificationTab[]
  /** タブごとの活動(useAgentWorkspace の agentTerminal.activities) */
  agentActivities: ReadonlyMap<string, AgentActivity>
  /** エージェント CLI 方式か(従来の方式ではセクションは記録がある間だけ出る) */
  isAgentMode: boolean
  /** 設定の種類(useAgentWorkspace の appCliKind)。区別の文言の CLI の名前と精度の注記に使う(省略できない。L-060) */
  cliKind: AgentCliKind
  diffTabs: Pick<DiffTabsState, 'diffTabs' | 'activeDiffTab' | 'openDiffTab' | 'closeDiffTab'>
  /** 開いている diff タブを取り直す(useDiffOperations.refreshDiff。quiet なら前の内容を出したまま取り直す) */
  refreshDiff: (options?: DiffRefreshOptions) => void
  /** 表示中の agent の diff の内容を取った範囲(useDiffOperations.agentDiffScope)。累積のときだけハンクを戻せる */
  agentDiffScope: AgentChangesScope | null
  fileLock: FileOperationLock
  fileSystem: Pick<
    AgentChangesRevertOptions,
    | 'hasDirtyTabAtOrInside'
    | 'reloadOpenFile'
    | 'closeTabsAtOrInside'
    | 'confirmDiscardAnyDirty'
    | 'reloadOpenFiles'
  > &
    Pick<AgentChangesWriteRefreshers, 'refreshTree'>
  /** ソース管理パネルを開く(閉じない) */
  showSourceControl: () => void
}

export interface AgentChangesWiring {
  /** ソース管理パネルのセクション「エージェントの変更」 */
  agentChangesPanel: AgentChangesPanelState
  /** エージェントの変更の diff タブのハンクの操作 */
  agentDiffActions: AgentDiffActions
  /** ターミナルの帯の「変更を確認」 */
  agentChangesReview: AgentChangesReviewAction
}

export function useAgentChangesWiring({
  folderPath,
  recording,
  gitStatus,
  refreshGitStatus,
  wasGitStatusSetQuietly,
  agentSessionExit,
  agentRunning,
  agentTabs,
  agentActivities,
  isAgentMode,
  cliKind,
  diffTabs,
  refreshDiff,
  agentDiffScope,
  fileLock,
  fileSystem,
  showSourceControl
}: AgentChangesWiringOptions): AgentChangesWiring {
  const { changes, beginManuallyAndRefresh } = recording
  // セクションの見出しへフォーカスを移す依頼(UI の一時的な状態のため、記録の写しの useAgentChanges には持たせない)。
  // 「変更を確認」で立て、セクションが見出しへ移したら下ろす
  const [isFocusRequested, setIsFocusRequested] = useState(false)
  const requestFocus = useCallback(() => setIsFocusRequested(true), [])
  const consumeFocusRequest = useCallback(() => setIsFocusRequested(false), [])
  const { refresh: refreshAgentChanges } = changes
  // 一覧を取り直す契機(設計書「いつ完了とするか」): git status の取り直し(Git の操作・保存・ソース管理の
  // 更新のボタンの後・監視の通知とフォーカスの復帰の静かな取り直し〈静かに取る〉)と、エージェントのセッションの終了。
  // 記録が無ければ refresh は何もしない。静かな取り直しが置いた status なら、一覧も静かに取る(isLoading を立てない。設計書 2026-11-08)
  const wasGitStatusSetQuietlyRef = useLatestRef(wasGitStatusSetQuietly)
  useEffect(() => {
    if (gitStatus === null) return
    if (wasGitStatusSetQuietlyRef.current()) void refreshAgentChanges({ quiet: true })
    else void refreshAgentChanges()
  }, [gitStatus, refreshAgentChanges, wasGitStatusSetQuietlyRef])
  useEffect(() => {
    if (agentSessionExit !== null) void refreshAgentChanges()
  }, [agentSessionExit, refreshAgentChanges])
  // 一覧から消えたパスの diff タブを閉じる(記録が無くなったらすべて)。開いているなら取り直す
  // (git status の記号が変わらない編集・戻した後も、一覧の取り直しで diff を新しくする)。
  // 初回のマウントは変化ではないため呼ばない(前の値を ref に持つ。useOnChange と同じ作り)
  // 静かな取り直し(自動の取り直し)の完了(quietRefreshCount が進む)でも、一覧が同じ(写しの参照が同じ)まま、開いている agent の
  // diff を静かに取り直す(行の状態が M のまま続きを書いた変更を出す。前の内容を出したまま取り、同じなら置き換えない)。
  // 一覧の写しと完了の回数は同じ描画で変わるため、1 つの effect で見て、静かな完了を含む変化なら静かに 1 回だけ取り直す
  const view = changes.view
  const quietRefreshCount = changes.quietRefreshCount
  const previousListRef = useRef({ view, quietRefreshCount })
  useEffect(() => {
    const previous = previousListRef.current
    if (previous.view === view && previous.quietRefreshCount === quietRefreshCount) return
    previousListRef.current = { view, quietRefreshCount }
    const tabsToClose = findAgentDiffTabsToClose(diffTabs.diffTabs, view)
    // 範囲の一覧が取れない(scope-unavailable)ときは、消えたかが分からないため閉じないが、開いている diff は取り直す
    // (前の範囲の内容を出し続けない。取り直すと diff タブにも取れない理由が出る)
    if (tabsToClose === null && !isAgentChangesScopeUnavailable(view)) return
    // 閉じるのは一覧が変わったときだけ(静かな完了だけなら、閉じるタブは前の変化で閉じてある)
    if (tabsToClose !== null && previous.view !== view) {
      for (const tab of tabsToClose) diffTabs.closeDiffTab(tab)
    }
    if (diffTabs.activeDiffTab?.kind !== 'agent') return
    if (previous.quietRefreshCount !== quietRefreshCount) refreshDiff({ quiet: true })
    else refreshDiff()
    // diffTabs・refreshDiff は描画ごとに新しい値のことがあるため、依存に入れない(useOnChange と同じ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, quietRefreshCount])
  // 一覧の自動の取り直し(設計書「自動の取り直し」)。活動の出来事(通知と同じ advanceAgentNotifications の events)とフォーカスの復帰を合流して、
  // 記録がある間だけ一覧を取り直す(読み上げない・git status は取り直さない)。上の既存の契機はこれを通さない
  useAgentChangesAutoRefresh({
    isRecording: view.kind === 'recording',
    folderPath,
    refresh: refreshAgentChanges,
    tabs: agentTabs,
    activities: agentActivities
  })
  // 戻す操作と取り消しで共有する実行(同じ実行中の印・失敗の表示・全体ロック)
  const runner = useAgentChangesWriteRunner({
    folderPath,
    recordStartedAt: recordingStartedAtOf(view),
    fileLock
  })
  // 書き換える操作(戻す・取り消し)の後の取り直し。順序は refreshAfterAgentChangesWrite が持ち、取り直す対象はここで 1 回だけ決めて
  // 両方の hook に同じものを渡す
  const refreshAfterWrite = (): Promise<void> =>
    refreshAfterAgentChangesWrite({
      refreshTree: fileSystem.refreshTree,
      refreshGitStatus,
      refreshChanges: refreshAgentChanges,
      refreshDiff
    })
  const revert = useAgentChangesRevert({
    folderPath,
    changes,
    fileLock,
    agentRunning,
    // fileSystem は useFileSystem の戻り値そのものを受けることがあるため、展開せずに必要なものだけを渡す
    hasDirtyTabAtOrInside: fileSystem.hasDirtyTabAtOrInside,
    reloadOpenFile: fileSystem.reloadOpenFile,
    closeTabsAtOrInside: fileSystem.closeTabsAtOrInside,
    confirmDiscardAnyDirty: fileSystem.confirmDiscardAnyDirty,
    reloadOpenFiles: fileSystem.reloadOpenFiles,
    refreshAfterWrite,
    runner,
    cliKind
  })
  // 直前の戻す操作の取り消し(戻す操作と同じ runner で、同じ実行中の印・失敗の表示・全体ロックを共有する)
  const undo = useAgentChangesUndo({
    folderPath,
    changes,
    runner,
    fileLock,
    agentRunning,
    hasDirtyTabAtOrInside: fileSystem.hasDirtyTabAtOrInside,
    reloadOpenFile: fileSystem.reloadOpenFile,
    closeTabsAtOrInside: fileSystem.closeTabsAtOrInside,
    refreshAfterWrite
  })
  const activeAgentPath =
    diffTabs.activeDiffTab?.kind === 'agent' ? diffTabs.activeDiffTab.path : null
  const agentDiffActions: AgentDiffActions = {
    // 内容の範囲が累積のときだけ(実行の範囲の diff から作ったパッチは、逆適用すると戻す先が実行の開始の時点になる)
    canRevertHunk:
      isCumulativeAgentDiffScope(agentDiffScope) &&
      canRevertAgentHunk(findActiveAgentEntry(view, diffTabs.activeDiffTab)),
    // 内容を取った範囲が実行なら、写しの実行の番号(diff タブのラベルの「実行 N」)
    contentRunNumber: agentDiffContentRunNumber(view, agentDiffScope),
    // 戻す操作・一覧の取得・他の Git 操作の間は押せない(理由は useAgentChangesRevert が組み立てる)
    disabledReason: revert.revertDisabledReason,
    // 失敗はそのパスの diff タブにだけ出す(b.txt の失敗を a.txt のタブに出さない。「すべて戻す」の失敗はセクションだけ)
    error: isSameAgentPath(revert.errorPath, activeAgentPath) ? revert.error : null,
    // ハンクを戻した結果の読み上げは、タブを問わず渡す(最後のハンクを戻すとタブが閉じる。EditorPanel が常設の要素に入れる)
    notice: revert.hunkNotice,
    // canRevertHunk と同じ条件(内容の範囲が累積のときだけ)で処理の側でも止める(L-058)
    onRevertHunk: (patch, hunkHeader) => {
      if (activeAgentPath !== null && isCumulativeAgentDiffScope(agentDiffScope)) {
        void revert.revertHunk(activeAgentPath, patch, hunkHeader, agentDiffScope)
      }
    }
  }
  // ターミナルの帯の「変更を確認」: ソース管理パネルを開き(閉じない)、git status と一覧を取り直し、セクションへフォーカスを移す。
  // フォーカスはその場で移さず依頼する(帯は最大化を戻すのと同じ tick で呼ぶ。セクションがマウントされた後に見出しへ移す)
  const agentChangesReview: AgentChangesReviewAction = {
    isRecording: view.kind === 'recording',
    onReview: () => {
      showSourceControl()
      requestFocus()
      void refreshGitStatus()
      void changes.refresh({ announce: true })
    }
  }
  const agentChangesPanel: AgentChangesPanelState = {
    changes: {
      ...changes,
      begin: beginManuallyAndRefresh,
      // セクションの「更新」は、ソース管理の更新と同じく git status も取り直す(設計書「いつ完了とするか」(2))
      refresh: (options) => {
        void refreshGitStatus()
        return changes.refresh(options)
      }
    },
    focusRequest: { isRequested: isFocusRequested, consume: consumeFocusRequest },
    revert,
    undo,
    folderPath,
    isAgentMode,
    cliKind,
    onOpenDiff: (path) => diffTabs.openDiffTab({ path, kind: 'agent' })
  }
  return { agentChangesPanel, agentDiffActions, agentChangesReview }
}
