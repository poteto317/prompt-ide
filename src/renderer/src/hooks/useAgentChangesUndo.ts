import type { AgentChangesUndoSummary } from '@shared/types'
import * as agentChangesApi from '../lib/agentChangesApi'
import { agentUndoDisabledReason } from '../lib/agentChangesAvailability'
import {
  buildAgentUndoConfirmMessage,
  formatAgentChangesUndoneNotice
} from '../lib/agentChangesMessages'
import { agentUndoDirtyCheckPaths, planAgentUndoTabSync } from '../lib/agentChangesUndoTabs'
import { undoSummaryWriteHooks } from './agentChangesWriteSync'
import type { AgentChangesController } from './useAgentChanges'
import type { AgentChangesWriteRunner } from './useAgentChangesWriteRunner'
import type { FileOperationLock } from './useFileOperationLock'

// 直前の戻す操作の取り消し(設計書「取り消しの hook」)。帯に出す控えは写し(main の値)から読み、renderer で別の状態を持たない
// (L-040)。押せるか → 確認 → 実行の共有で依頼(結果の undoSummary を実行中の印を下ろす前に写しへ反映。L-039)→ 成功・partial なら
// 書き戻した・作り直したパスのタブを読み直し、ゴミ箱へ移したパスのタブを閉じる(main の結果で決める。L-001・L-008)
// → 成功・失敗のどちらでも取り直す

export interface AgentChangesUndoOptions {
  folderPath: string | null
  changes: Pick<AgentChangesController, 'view' | 'announce' | 'applyUndoSummary'>
  /** 戻す操作と共有する実行(useAgentChangesWriteRunner) */
  runner: AgentChangesWriteRunner
  /** 他の Git 操作と共有するロック(isAnyLocked なら押せない。実行中の lockGlobal は runner が取る) */
  fileLock: FileOperationLock
  /** エージェントのセッションが動いているか(確認の文言に足す) */
  agentRunning: boolean
  hasDirtyTabAtOrInside: (absolutePath: string) => boolean
  reloadOpenFile: (absolutePath: string) => Promise<void>
  closeTabsAtOrInside: (absolutePath: string) => void
  /** 書き換えの後の取り直し(ツリー・git status・一覧・diff タブ。useAgentChangesWiring が戻す操作と共通の 1 つを渡す) */
  refreshAfterWrite: () => Promise<void>
  onConfirm?: (message: string) => boolean
}

// 帯に出す控えの要約は写し(useAgentChanges の view.undo)が唯一の持ち主で、ここでは返さない(セクションは写しから帯を出し、
// undoLastRevert は同じ描画の写しの undoId を送る)
export interface AgentChangesUndoState {
  /** 取り消しのボタンを押せない理由(押せるなら null) */
  undoDisabledReason: string | null
  undoLastRevert: () => Promise<void>
}

export function useAgentChangesUndo({
  folderPath,
  changes,
  runner,
  fileLock,
  agentRunning,
  hasDirtyTabAtOrInside,
  reloadOpenFile,
  closeTabsAtOrInside,
  refreshAfterWrite,
  onConfirm = confirm
}: AgentChangesUndoOptions): AgentChangesUndoState {
  const view = changes.view
  const summary: AgentChangesUndoSummary | null = view.kind === 'recording' ? view.undo : null
  const undoDisabledReason = agentUndoDisabledReason({
    runningOperation: runner.runningOperation,
    isGitBusy: fileLock.isAnyLocked()
  })

  const undoLastRevert = async (): Promise<void> => {
    // ボタンの disabled に加えた処理の側の守り(L-058)
    if (view.kind !== 'recording' || summary === null) return
    if (runner.isRunning() || undoDisabledReason !== null) return
    const startedAt = view.startedAt
    const hasUnsavedEdits = agentUndoDirtyCheckPaths(folderPath, summary).some((path) =>
      hasDirtyTabAtOrInside(path)
    )
    if (!onConfirm(buildAgentUndoConfirmMessage({ summary, hasUnsavedEdits, agentRunning }))) return
    const generation = runner.captureGeneration()
    // 帯に出した控えの undoId を渡す(main が今の控えと照合する。L-035)
    const outcome = await runner.run(
      'undo',
      null,
      () => agentChangesApi.undoAgentChangesRevert(summary.undoId),
      undoSummaryWriteHooks(changes.applyUndoSummary, startedAt)
    )
    if (outcome.ok) {
      const { result } = outcome
      // タブの同期は記録の世代を見ない: 作業ツリーは依頼の時点のフォルダで書き換わっており、世代が変わっても(記録の終了・
      // 新しい記録では同じフォルダのタブが開いたまま)読み直さなければ古い内容が残る。パスは依頼の時点のフォルダから作る
      const { reloadPaths, closePaths } = planAgentUndoTabSync(folderPath, result)
      for (const absolutePath of reloadPaths) await reloadOpenFile(absolutePath)
      for (const absolutePath of closePaths) closeTabsAtOrInside(absolutePath)
      // partial は読み直しの後に警告を出す(パターン 52)
      if (result.status === 'partial') runner.showWarning(result.message, 'undo', generation)
      // 読み上げは、その記録・そのフォルダについてのもの(世代が変われば、新しいセクションで読み上げない)
      else if (runner.isCurrentGeneration(generation)) {
        changes.announce(
          formatAgentChangesUndoneNotice(result.restoredPaths.length + result.trashedPaths.length)
        )
      }
    }
    // 成功・失敗のどちらでも取り直す。タブの同期は上で結果から行う
    await refreshAfterWrite()
  }

  return { undoDisabledReason, undoLastRevert }
}
