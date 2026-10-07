import { useCallback, useEffect, useState } from 'react'
import type { GitStatusResult } from '@shared/types'
import type { AgentChangesReviewAction, AgentDiffActions } from '../types'
import {
  canRevertAgentHunk,
  findActiveAgentEntry,
  findAgentDiffTabsToClose
} from '../lib/agentChangesWiring'
import type { AgentChangesController } from './useAgentChanges'
import type { AgentChangesRecording } from './useAgentChangesRecording'
import { useAgentChangesRevert } from './useAgentChangesRevert'
import type { AgentChangesRevertOptions, AgentChangesRevertState } from './useAgentChangesRevert'
import type { AgentSessionExitView } from './useAgentSession'
import type { DiffTabsState } from './useDiffTabs'
import type { FileOperationLock } from './useFileOperationLock'
import { useOnChange } from './useOnChange'

// エージェントの変更の組み立ての後段(useAppState の中で useDiffOperations・useAgentWorkspace・useExternalFileChanges の
// 後に呼ぶ。effect の順序を変えないため、呼ぶ位置を動かさない)。一覧を取り直す契機、一覧から消えたパスの diff タブの
// 同期、戻す操作(useAgentChangesRevert)、表示用の値(セクション・diff タブの操作・ターミナルの帯)の組み立てを持つ

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
    | 'begin'
    | 'refresh'
    | 'clear'
  >
  /** セクションの見出しへフォーカスを移す依頼(ターミナルの帯の「変更を確認」) */
  focusRequest: AgentChangesFocusRequest
  revert: AgentChangesRevertState
  /** 開いているフォルダ(保存したパスとの突き合わせに使う) */
  folderPath: string | null
  /** エージェント CLI 方式か。従来の方式では記録がある間だけ出す */
  isAgentMode: boolean
  onOpenDiff: (path: string) => void
}

export interface AgentChangesWiringOptions {
  folderPath: string | null
  recording: AgentChangesRecording
  gitStatus: GitStatusResult | null
  refreshGitStatus: () => Promise<void>
  /** エージェントのセッションの終了(一覧を取り直す契機) */
  agentSessionExit: AgentSessionExitView | null
  /** エージェントのセッションが動いているか(戻すの確認の文言に足す) */
  agentRunning: boolean
  /** エージェント CLI 方式か(従来の方式ではセクションは記録がある間だけ出る) */
  isAgentMode: boolean
  diffTabs: Pick<DiffTabsState, 'diffTabs' | 'activeDiffTab' | 'openDiffTab' | 'closeDiffTab'>
  /** 開いている diff タブを取り直す(useDiffOperations.refreshDiff) */
  refreshDiff: () => void
  fileLock: FileOperationLock
  fileSystem: Pick<
    AgentChangesRevertOptions,
    | 'hasDirtyTabAtOrInside'
    | 'reloadOpenFile'
    | 'closeTabsAtOrInside'
    | 'confirmDiscardAnyDirty'
    | 'reloadOpenFiles'
    | 'refreshTree'
  >
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
  agentSessionExit,
  agentRunning,
  isAgentMode,
  diffTabs,
  refreshDiff,
  fileLock,
  fileSystem,
  showSourceControl
}: AgentChangesWiringOptions): AgentChangesWiring {
  const { changes, beginAndRefresh } = recording
  // セクションの見出しへフォーカスを移す依頼(UI の一時的な状態のため、記録の写しの useAgentChanges には持たせない)。
  // 「変更を確認」で立て、セクションが見出しへ移したら下ろす
  const [isFocusRequested, setIsFocusRequested] = useState(false)
  const requestFocus = useCallback(() => setIsFocusRequested(true), [])
  const consumeFocusRequest = useCallback(() => setIsFocusRequested(false), [])
  const { refresh: refreshAgentChanges } = changes
  // 一覧を取り直す契機(設計書「いつ完了とするか」): git status の取り直し(Git の操作・保存・ソース管理の
  // 更新のボタンの後)と、エージェントのセッションの終了。記録が無ければ refresh は何もしない
  useEffect(() => {
    if (gitStatus !== null) void refreshAgentChanges()
  }, [gitStatus, refreshAgentChanges])
  useEffect(() => {
    if (agentSessionExit !== null) void refreshAgentChanges()
  }, [agentSessionExit, refreshAgentChanges])
  // 一覧から消えたパスの diff タブを閉じる(記録が無くなったらすべて)。開いているなら取り直す
  // (git status の記号が変わらない編集・戻した後も、一覧の取り直しで diff を新しくする)。
  // 初回のマウントは変化ではないため呼ばない(useOnChange)
  const view = changes.view
  useOnChange(view, () => {
    const tabsToClose = findAgentDiffTabsToClose(diffTabs.diffTabs, view)
    if (tabsToClose === null) return
    for (const tab of tabsToClose) diffTabs.closeDiffTab(tab)
    if (diffTabs.activeDiffTab?.kind === 'agent') refreshDiff()
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
    refreshTree: fileSystem.refreshTree,
    refreshGitStatus,
    refreshDiff
  })
  const activeAgentPath =
    diffTabs.activeDiffTab?.kind === 'agent' ? diffTabs.activeDiffTab.path : null
  const agentDiffActions: AgentDiffActions = {
    canRevertHunk: canRevertAgentHunk(findActiveAgentEntry(view, diffTabs.activeDiffTab)),
    // 戻す操作・一覧の取得・他の Git 操作の間は押せない(理由は useAgentChangesRevert が組み立てる)
    disabledReason: revert.revertDisabledReason,
    // 失敗はそのパスの diff タブにだけ出す(b.txt の失敗を a.txt のタブに出さない。「すべて戻す」の失敗はセクションだけ)
    error: isSameAgentPath(revert.errorPath, activeAgentPath) ? revert.error : null,
    // ハンクを戻した結果の読み上げは、タブを問わず渡す(最後のハンクを戻すとタブが閉じる。EditorPanel が常設の要素に入れる)
    notice: revert.hunkNotice,
    onRevertHunk: (patch, hunkHeader) => {
      if (activeAgentPath !== null) void revert.revertHunk(activeAgentPath, patch, hunkHeader)
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
      begin: beginAndRefresh,
      // セクションの「更新」は、ソース管理の更新と同じく git status も取り直す(設計書「いつ完了とするか」(2))
      refresh: (options) => {
        void refreshGitStatus()
        return changes.refresh(options)
      }
    },
    focusRequest: { isRequested: isFocusRequested, consume: consumeFocusRequest },
    revert,
    folderPath,
    isAgentMode,
    onOpenDiff: (path) => diffTabs.openDiffTab({ path, kind: 'agent' })
  }
  return { agentChangesPanel, agentDiffActions, agentChangesReview }
}
