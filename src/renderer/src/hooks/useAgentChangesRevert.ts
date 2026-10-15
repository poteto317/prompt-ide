import type {
  AgentChangeEntry,
  AgentChangesScope,
  AgentRevertAllResult,
  AgentRevertResult
} from '@shared/types'
import type { AgentChangesRunningOperation, Announcement } from '../types'
import * as agentChangesApi from '../lib/agentChangesApi'
import {
  agentRevertAllDisabledReason,
  agentRevertDisabledReason
} from '../lib/agentChangesAvailability'
import {
  buildAgentRevertAllConfirmMessage,
  buildAgentRevertFileConfirmMessage,
  buildAgentRevertHunkConfirmMessage,
  formatAgentChangesHunkRevertedNotice,
  formatAgentChangesRevertedNotice,
  formatAgentRevertPartialWarning
} from '../lib/agentChangesMessages'
import { agentChangeAbsolutePath, isEntrySavedInApp, isSavedInApp } from '../lib/agentChangesPaths'
import { agentRevertAllTargets } from '../lib/agentChangesRevertTargets'
import { getListedAgentChanges } from '../lib/agentChangesScope'
import { recordingStartedAtOf } from '../lib/agentChangesView'
import { AGENT_CHANGES_NOTICE_DURATION_MS } from './useAgentChanges'
import type { AgentChangesController } from './useAgentChanges'
import type { AgentChangesWriteHooks, AgentChangesWriteRunner } from './useAgentChangesWriteRunner'
import type { FileOperationLock } from './useFileOperationLock'
import { useOnChange } from './useOnChange'
import { useTransientNotice } from './useTransientNotice'
import { undoSummaryWriteHooks } from './agentChangesWriteSync'

// エージェントの変更を戻す(ファイル・ハンク・すべて)。既存の取り消し(useDiscardFileChanges・useDiscardHunk・
// useDiscardAllChanges)と同じく「押せるか → 確認 → ロック → 実行 → 成功したときだけタブとツリーを同期」の順で行う
// (パターン 20・52)。実行中の印・失敗の表示・全体ロック・記録の世代は、取り消しと共有する実行の共有(runner)が持つ。
// すべて戻すの対象は、利用者の変更・利用者の変更を含む行を除いたもの(agentRevertAllTargets。main の照合と同じ定義。L-036)

export interface AgentChangesRevertOptions {
  folderPath: string | null
  changes: Pick<
    AgentChangesController,
    'view' | 'isLoading' | 'listError' | 'savedPaths' | 'scope' | 'announce' | 'applyUndoSummary'
  >
  /** 他の Git 操作と共有するロック(isAnyLocked なら押せない。実行中の lockGlobal は runner が取る) */
  fileLock: FileOperationLock
  /** エージェントのセッションが動いているか(確認の文言に足す) */
  agentRunning: boolean
  hasDirtyTabAtOrInside: (absolutePath: string) => boolean
  reloadOpenFile: (absolutePath: string) => Promise<void>
  closeTabsAtOrInside: (absolutePath: string) => void
  confirmDiscardAnyDirty: () => boolean
  reloadOpenFiles: () => Promise<void>
  /**
   * 書き換えの後の取り直し(ツリー・git status・一覧・diff タブ)。成功・失敗のどちらでも呼ぶ(状態が変わりうる)。タブの読み直しは
   * 呼び出し側が成功したときだけ行う。useAgentChangesWiring が取り消しと共通の 1 つを渡す
   */
  refreshAfterWrite: () => Promise<void>
  onConfirm?: (message: string) => boolean
  /** 戻す操作と取り消しで共有する実行(useAgentChangesWriteRunner) */
  runner: AgentChangesWriteRunner
}

export interface AgentChangesRevertState {
  /** 戻す操作・取り消しの実行中の印 */
  runningOperation: AgentChangesRunningOperation | null
  /**
   * 直前の戻す操作・取り消しの失敗・partial の警告(取り消しと共有する runner の失敗の表示を写したもの)。
   * フォルダの切り替え・記録の終了・新しい記録で消える
   */
  error: string | null
  /** error の対象のパス(ファイル・ハンクを戻したときの一覧のパス。「すべて戻す」・取り消しは null)。diff タブは自分のパスの失敗だけを出す */
  errorPath: string | null
  /** error がハンクを戻した失敗か。ハンクの失敗は diff タブ側の常設の aria-live(hunkNotice)で読み上げるため、
   *  セクションは見た目だけに出す(role="alert" にすると、ソース管理パネルが見えているときに二重に読まれる) */
  isErrorAnnouncedInDiff: boolean
  /** ハンクを戻した結果(成功・失敗)の読み上げ。diff タブ側の常設の aria-live に入れる(セクションが見えていなくても届く) */
  hunkNotice: Announcement | null
  /** ファイル・ハンクを戻すボタンを押せない理由(押せるなら null) */
  revertDisabledReason: string | null
  /** 「すべて戻す」を押せない理由 */
  revertAllDisabledReason: string | null
  /** すべて戻すから除く行(利用者の変更・利用者の変更を含む)の件数。累積の一覧が無い・打ち切った一覧(すべて戻すは使えず、残りの行の
   *  author も分からない)・実行の範囲の一覧なら 0(セクションの除く旨の 1 行に使う) */
  revertAllExcludedCount: number
  revertFile: (entry: AgentChangeEntry) => Promise<void>
  /** scope は diff の内容を取った範囲。累積でなければ何もしない */
  revertHunk: (
    path: string,
    patch: string,
    hunkHeader: string,
    scope: AgentChangesScope
  ) => Promise<void>
  revertAll: () => Promise<void>
}

export function useAgentChangesRevert({
  folderPath,
  changes,
  fileLock,
  agentRunning,
  hasDirtyTabAtOrInside,
  reloadOpenFile,
  closeTabsAtOrInside,
  confirmDiscardAnyDirty,
  reloadOpenFiles,
  refreshAfterWrite,
  runner,
  onConfirm = confirm
}: AgentChangesRevertOptions): AgentChangesRevertState {
  const {
    notice: hunkNotice,
    announce: announceHunk,
    clear: clearHunkNotice
  } = useTransientNotice(AGENT_CHANGES_NOTICE_DURATION_MS)
  // ハンクの結果の読み上げは、その記録・そのフォルダについてのもの(失敗の表示は runner が同じ契機で消す)
  useOnChange(folderPath, clearHunkNotice)
  useOnChange(recordingStartedAtOf(changes.view), clearHunkNotice)
  const list = getListedAgentChanges(changes.view)
  // 写しの記録(区別の要約と開始の時刻を確認に渡す)
  const recording = changes.view.kind === 'recording' ? changes.view : null
  // すべて戻すの対象と除く件数(確認の一覧と main の照合が同じ定義を使う。L-036)
  const { targets, excludedCount, shownExcludedCount, hasOnlyUserChanges } =
    agentRevertAllTargets(list)
  const availability = {
    isLoading: changes.isLoading,
    isGitBusy: fileLock.isAnyLocked(),
    runningOperation: runner.runningOperation,
    hasListError: changes.listError !== null,
    // 選んでいる範囲か、表示中の一覧の範囲が実行なら戻せない(実行ごとの表示は見るだけ。L-061)
    isRunScope: changes.scope.kind !== 'all' || (list !== null && list.scope.kind !== 'all')
  }
  const revertDisabledReason = agentRevertDisabledReason(availability)
  const revertAllDisabledReason = agentRevertAllDisabledReason({
    ...availability,
    truncated: list?.truncated ?? false,
    // main へ渡す expected からは除かない(完全一致の照合のため)。押せなくして、必ず失敗する確認を出さない
    hasNotRecorded: list?.entries.some((entry) => entry.notRecorded) ?? false,
    hasOnlyUserChanges
  })

  const absoluteOf = (path: string): string | null => agentChangeAbsolutePath(folderPath, path)

  const canStart = (): boolean => !runner.isRunning() && revertDisabledReason === null

  // 依頼の時点の写しの記録の開始の時刻(結果を写しへ反映するときに照合する)
  const startedAtNow = (): number | null => recordingStartedAtOf(changes.view)
  // 結果の控えの要約を、実行中の印を下ろす前に写しへ反映する。例外では帯を隠す(L-039)
  const undoSummaryHooks = <T extends AgentRevertResult>(
    startedAt: number
  ): AgentChangesWriteHooks<T> => undoSummaryWriteHooks<T>(changes.applyUndoSummary, startedAt)

  const revertFile = async (entry: AgentChangeEntry): Promise<void> => {
    const absolutePath = absoluteOf(entry.path)
    // 処理の側の守り: 表示中の一覧が累積でなければ、確認を出さずに何もしない(L-058)
    if (absolutePath === null || list === null || list.scope.kind !== 'all') return
    if (!canStart() || entry.notRecorded) return
    const startedAt = startedAtNow()
    if (startedAt === null) return
    const message = buildAgentRevertFileConfirmMessage({
      path: entry.path,
      status: entry.status,
      isDirectory: entry.isDirectory,
      author: entry.author,
      savedInApp: isSavedInApp(changes.savedPaths, absolutePath),
      hasUnsavedEdits: hasDirtyTabAtOrInside(absolutePath),
      agentRunning
    })
    if (!onConfirm(message)) return
    // 結果が届く前にフォルダ・記録が変わったら読み上げない(新しいセクションには帯が無く、「取り消せます」が誤りになる)
    const generation = runner.captureGeneration()
    const outcome = await runner.run(
      'file',
      entry.path,
      () => agentChangesApi.revertAgentChange(entry.path, list.scope),
      undoSummaryHooks<AgentRevertResult>(startedAt)
    )
    if (outcome.ok) {
      // 追加はゴミ箱へ移したのでタブを閉じ、それ以外は記録の時点の内容を読み直す
      if (entry.status === 'A') closeTabsAtOrInside(absolutePath)
      else await reloadOpenFile(absolutePath)
      if (runner.isCurrentGeneration(generation)) {
        changes.announce(formatAgentChangesRevertedNotice(1, outcome.result.undo))
      }
    }
    await refreshAfterWrite()
  }

  // diffScope は diff の内容を取った範囲。累積でなければ、実行の開始の時点との差分のパッチになるため戻さない(L-058)
  const revertHunk = async (
    path: string,
    patch: string,
    hunkHeader: string,
    diffScope: AgentChangesScope
  ): Promise<void> => {
    const absolutePath = absoluteOf(path)
    if (absolutePath === null || diffScope.kind !== 'all' || !canStart()) return
    const startedAt = startedAtNow()
    if (startedAt === null) return
    const message = buildAgentRevertHunkConfirmMessage({
      path,
      hunkHeader,
      savedInApp: isSavedInApp(changes.savedPaths, absolutePath),
      hasUnsavedEdits: hasDirtyTabAtOrInside(absolutePath),
      agentRunning
    })
    if (!onConfirm(message)) return
    // 結果は diff タブ側の aria-live で読み上げる(PR #47 の 2 回目のレビューで二重の読み上げを修正)
    const generation = runner.captureGeneration()
    const outcome = await runner.run(
      'hunk',
      path,
      () => agentChangesApi.revertAgentChangeHunk(path, patch, diffScope),
      { ...undoSummaryHooks<AgentRevertResult>(startedAt), onFailure: announceHunk }
    )
    if (outcome.ok) {
      await reloadOpenFile(absolutePath)
      if (runner.isCurrentGeneration(generation)) {
        announceHunk(formatAgentChangesHunkRevertedNotice(outcome.result.undo))
      }
    }
    await refreshAfterWrite()
  }

  const revertAll = async (): Promise<void> => {
    if (list === null || list.scope.kind !== 'all' || targets.length === 0) return
    if (runner.isRunning() || revertAllDisabledReason !== null || recording === null) return
    const startedAt = startedAtNow()
    if (startedAt === null) return
    // 確認の件数・ゴミ箱の件数・フォルダの有無・保存の有無は対象だけで求める(除いた行の保存は確認で言わない)
    const message = buildAgentRevertAllConfirmMessage({
      count: targets.length,
      trashCount: targets.filter((entry) => entry.status === 'A').length,
      hasDirectory: targets.some((entry) => entry.isDirectory),
      // セクションの行の印と同じ判定(フォルダの行は配下の保存を含む)
      savedInApp: targets.some((entry) =>
        isEntrySavedInApp(folderPath, changes.savedPaths, entry.path)
      ),
      agentRunning,
      attribution: recording.attribution,
      startedAt: recording.startedAt,
      excludedCount
    })
    if (!onConfirm(message)) return
    // 未保存の編集の破棄は、既存の「すべて取り消す」と同じく別の確認で承諾させる
    if (!confirmDiscardAnyDirty()) return
    // 確認で見せた対象(パスと状態の文字)を main へ渡す。main は同じ定義で除いた実行時の一覧と完全一致で照合し、違えば中止する
    const expected = targets.map(({ path, status }) => ({ path, status }))
    const generation = runner.captureGeneration()
    const outcome = await runner.run(
      'all',
      null,
      () => agentChangesApi.revertAllAgentChanges(expected, list.scope),
      undoSummaryHooks<AgentRevertAllResult>(startedAt)
    )
    if (outcome.ok) {
      const { result } = outcome
      // partial も作業ツリーが変わっているので読み直す(パターン 52)。警告は読み直しの後に出す
      await reloadOpenFiles()
      if (result.status === 'partial') {
        runner.showWarning(
          formatAgentRevertPartialWarning(result.message, result.revertedCount, result.undo),
          'all',
          generation
        )
      } else if (result.revertedCount > 0 && runner.isCurrentGeneration(generation)) {
        // 1 件も戻さなかった(main が前の控えを残した)なら読み上げない。undo はこの依頼の控えの成否で、帯の控え
        // (undoSummary は前の、まだ有効な控え)については何も言えないため、「取り消せません」と誤って伝えない。
        // 結果が届く前にフォルダ・記録が変わったときも読み上げない(ファイルを戻すと同じ)
        changes.announce(formatAgentChangesRevertedNotice(expected.length, result.undo))
      }
    }
    await refreshAfterWrite()
  }

  return {
    runningOperation: runner.runningOperation,
    error: runner.error?.message ?? null,
    errorPath: runner.error?.path ?? null,
    isErrorAnnouncedInDiff: runner.error?.source === 'hunk',
    hunkNotice,
    revertDisabledReason,
    revertAllDisabledReason,
    revertAllExcludedCount: shownExcludedCount,
    revertFile,
    revertHunk,
    revertAll
  }
}
