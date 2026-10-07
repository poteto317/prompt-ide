import { useRef, useState } from 'react'
import type { AgentChangeEntry } from '@shared/types'
import type { Announcement } from '../types'
import * as agentChangesApi from '../lib/agentChangesApi'
import {
  agentRevertAllDisabledReason,
  agentRevertDisabledReason
} from '../lib/agentChangesAvailability'
import {
  buildAgentRevertAllConfirmMessage,
  buildAgentRevertFileConfirmMessage,
  buildAgentRevertHunkConfirmMessage,
  formatAgentChangesRevertedNotice,
  AGENT_CHANGES_HUNK_REVERTED_NOTICE
} from '../lib/agentChangesMessages'
import { toError } from '../lib/errorUtils'
import { agentChangeAbsolutePath, isEntrySavedInApp, isSavedInApp } from '../lib/agentChangesPaths'
import { AGENT_CHANGES_NOTICE_DURATION_MS } from './useAgentChanges'
import type { AgentChangesController } from './useAgentChanges'
import type { FileOperationLock } from './useFileOperationLock'
import { useOnChange } from './useOnChange'
import { useTransientNotice } from './useTransientNotice'

// エージェントの変更を戻す(ファイル・ハンク・すべて)。既存の取り消し(useDiscardFileChanges・useDiscardHunk・
// useDiscardAllChanges)と同じく「押せるか → 確認 → ロック → 実行 → 成功したときだけタブとツリーを同期」の順で行う
// (パターン 20・52)。作業ツリーを書き換えるため、他の Git 操作と同じロックの全体ロックを取る(パターン 111)

export interface AgentChangesRevertOptions {
  folderPath: string | null
  changes: Pick<
    AgentChangesController,
    'view' | 'isLoading' | 'listError' | 'savedPaths' | 'refresh' | 'announce'
  >
  /** 他の Git 操作と共有するロック(実行中は lockGlobal を取る。isAnyLocked なら押せない) */
  fileLock: FileOperationLock
  /** エージェントのセッションが動いているか(確認の文言に足す) */
  agentRunning: boolean
  hasDirtyTabAtOrInside: (absolutePath: string) => boolean
  reloadOpenFile: (absolutePath: string) => Promise<void>
  closeTabsAtOrInside: (absolutePath: string) => void
  confirmDiscardAnyDirty: () => boolean
  reloadOpenFiles: () => Promise<void>
  refreshTree: () => Promise<unknown>
  refreshGitStatus: () => Promise<void>
  /** 開いている diff タブを取り直す(useDiffOperations.refreshDiff) */
  refreshDiff: () => void
  onConfirm?: (message: string) => boolean
}

export interface AgentChangesRevertState {
  isReverting: boolean
  /** 直前の戻す操作の失敗・partial の警告。フォルダの切り替え・記録の終了・新しい記録で消える */
  error: string | null
  /** error の対象のパス(ファイル・ハンクを戻したときの一覧のパス。「すべて戻す」は null)。diff タブは自分のパスの失敗だけを出す */
  errorPath: string | null
  /** ハンクを戻した結果(成功・失敗)の読み上げ。diff タブ側の常設の aria-live に入れる(セクションが見えていなくても届く) */
  hunkNotice: Announcement | null
  /** ファイル・ハンクを戻すボタンを押せない理由(押せるなら null) */
  revertDisabledReason: string | null
  /** 「すべて戻す」を押せない理由 */
  revertAllDisabledReason: string | null
  revertFile: (entry: AgentChangeEntry) => Promise<void>
  revertHunk: (path: string, patch: string, hunkHeader: string) => Promise<void>
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
  refreshTree,
  refreshGitStatus,
  refreshDiff,
  onConfirm = confirm
}: AgentChangesRevertOptions): AgentChangesRevertState {
  const [isReverting, setIsReverting] = useState(false)
  const [error, setError] = useState<{ message: string; path: string | null } | null>(null)
  const {
    notice: hunkNotice,
    announce: announceHunk,
    clear: clearHunkNotice
  } = useTransientNotice(AGENT_CHANGES_NOTICE_DURATION_MS)
  // 失敗の文言は、その記録・そのフォルダについてのもの。フォルダの切り替え・記録の終了(none)・新しい記録(startedAt の変化)で
  // 消す(useAgentChanges の listError と同じく、前の記録の失敗を新しい記録で role="alert" に出さない)。
  // 実行中に変わった場合に、終わった後で古い失敗を出さないよう、範囲の番号を進めて照合する
  const scopeRef = useRef(0)
  const resetForScopeChange = (): void => {
    scopeRef.current += 1
    setError(null)
    clearHunkNotice()
  }
  useOnChange(folderPath, resetForScopeChange)
  useOnChange(
    changes.view.kind === 'recording' ? changes.view.startedAt : null,
    resetForScopeChange
  )
  // 同じ描画の中の 2 回目の依頼を止める(state は次の描画まで変わらない)
  const revertingRef = useRef(false)
  const list = changes.view.kind === 'recording' ? changes.view.list : null
  const availability = {
    isLoading: changes.isLoading,
    isGitBusy: fileLock.isAnyLocked(),
    isReverting,
    hasListError: changes.listError !== null
  }
  const revertDisabledReason = agentRevertDisabledReason(availability)
  const revertAllDisabledReason = agentRevertAllDisabledReason({
    ...availability,
    truncated: list?.truncated ?? false,
    // main へ渡す expected からは除かない(完全一致の照合のため)。押せなくして、必ず失敗する確認を出さない
    hasNotRecorded: list?.entries.some((entry) => entry.notRecorded) ?? false
  })

  const absoluteOf = (path: string): string | null => agentChangeAbsolutePath(folderPath, path)

  // 実行(ロックと後片付け)。成功したら true。失敗の文言は error に出す(path は diff タブの出し分けに使う)。
  // 実行中にフォルダ・記録が変わっていたら、失敗は出さない(onFailure も呼ばない)
  const run = async (
    path: string | null,
    execute: () => Promise<void>,
    onFailure?: (message: string) => void
  ): Promise<boolean> => {
    const scope = scopeRef.current
    revertingRef.current = true
    setIsReverting(true)
    setError(null)
    fileLock.lockGlobal()
    try {
      await execute()
      return true
    } catch (err) {
      if (scope === scopeRef.current) {
        const message = toError(err).message
        setError({ message, path })
        onFailure?.(message)
      }
      return false
    } finally {
      fileLock.unlockGlobal()
      revertingRef.current = false
      setIsReverting(false)
    }
  }

  // 成功・失敗のどちらでも一覧と git status を取り直す(状態が変わりうる)。タブの読み直しは呼び出し側が成功したときだけ行う
  const refreshAfter = async (): Promise<void> => {
    await refreshTree().catch(() => undefined)
    await refreshGitStatus().catch(() => undefined)
    await changes.refresh()
    refreshDiff()
  }

  const canStart = (): boolean => !revertingRef.current && revertDisabledReason === null

  const revertFile = async (entry: AgentChangeEntry): Promise<void> => {
    const absolutePath = absoluteOf(entry.path)
    if (absolutePath === null || !canStart() || entry.notRecorded) return
    const message = buildAgentRevertFileConfirmMessage({
      path: entry.path,
      status: entry.status,
      isDirectory: entry.isDirectory,
      savedInApp: isSavedInApp(changes.savedPaths, absolutePath),
      hasUnsavedEdits: hasDirtyTabAtOrInside(absolutePath),
      agentRunning
    })
    if (!onConfirm(message)) return
    const succeeded = await run(entry.path, () => agentChangesApi.revertAgentChange(entry.path))
    if (succeeded) {
      // 追加はゴミ箱へ移したのでタブを閉じ、それ以外は記録の時点の内容を読み直す
      if (entry.status === 'A') closeTabsAtOrInside(absolutePath)
      else await reloadOpenFile(absolutePath)
      changes.announce(formatAgentChangesRevertedNotice(1))
    }
    await refreshAfter()
  }

  const revertHunk = async (path: string, patch: string, hunkHeader: string): Promise<void> => {
    const absolutePath = absoluteOf(path)
    if (absolutePath === null || !canStart()) return
    const message = buildAgentRevertHunkConfirmMessage({
      path,
      hunkHeader,
      savedInApp: isSavedInApp(changes.savedPaths, absolutePath),
      hasUnsavedEdits: hasDirtyTabAtOrInside(absolutePath),
      agentRunning
    })
    if (!onConfirm(message)) return
    // 結果は diff タブ側の aria-live で読み上げる(成功すると diff が作り直されて押したボタンが消え、最後のハンクならタブも
    // 閉じる。セクションの読み上げはソース管理パネルが見えていないと届かない)。失敗は error にも出す
    const scope = scopeRef.current
    const succeeded = await run(
      path,
      () => agentChangesApi.revertAgentChangeHunk(path, patch),
      announceHunk
    )
    if (succeeded) {
      await reloadOpenFile(absolutePath)
      if (scope === scopeRef.current) announceHunk(AGENT_CHANGES_HUNK_REVERTED_NOTICE)
    }
    await refreshAfter()
  }

  const revertAll = async (): Promise<void> => {
    if (list === null || list.entries.length === 0) return
    if (revertingRef.current || revertAllDisabledReason !== null) return
    const message = buildAgentRevertAllConfirmMessage({
      count: list.entries.length,
      trashCount: list.entries.filter((entry) => entry.status === 'A').length,
      // セクションの行の印と同じ判定(フォルダの行は配下の保存を含む)
      savedInApp: list.entries.some((entry) =>
        isEntrySavedInApp(folderPath, changes.savedPaths, entry.path)
      ),
      agentRunning
    })
    if (!onConfirm(message)) return
    // 未保存の編集の破棄は、既存の「すべて取り消す」と同じく別の確認で承諾させる
    if (!confirmDiscardAnyDirty()) return
    // 確認で見せた一覧(パスと状態の文字)を main へ渡す。実行時の一覧と完全一致しなければ main が中止する
    const expected = list.entries.map(({ path, status }) => ({ path, status }))
    let warning: string | null = null
    const scope = scopeRef.current
    const succeeded = await run(null, async () => {
      const result = await agentChangesApi.revertAllAgentChanges(expected)
      if (result.status === 'partial') warning = result.message
    })
    if (succeeded) {
      // partial も作業ツリーが変わっているので読み直す(パターン 52)。警告は読み直しの後に出す
      await reloadOpenFiles()
      if (warning !== null) {
        if (scope === scopeRef.current) setError({ message: warning, path: null })
      } else changes.announce(formatAgentChangesRevertedNotice(expected.length))
    }
    await refreshAfter()
  }

  return {
    isReverting,
    error: error?.message ?? null,
    errorPath: error?.path ?? null,
    hunkNotice,
    revertDisabledReason,
    revertAllDisabledReason,
    revertFile,
    revertHunk,
    revertAll
  }
}
