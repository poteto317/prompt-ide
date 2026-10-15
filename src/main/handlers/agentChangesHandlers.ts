import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type {
  AgentChangesListResult,
  AgentChangesState,
  AgentChangesUndoOperation,
  AgentChangesUndoResult,
  AgentRevertAllResult,
  AgentRevertResult
} from '@shared/types'
import type { AgentBaselineRegistry } from '../agentBaselineRegistry'
import type { AgentChangesRecord } from '../agentChangesRecord'
import type { AgentRevertContext, AgentRevertOutcome } from '../agentChangesRevert'
import type { AgentChangesUndoCaptureOptions } from '../agentChangesUndo'
import { getAgentChangeDiffInScope, listAgentChangesInScope } from '../agentChangesScopedQuery'
import {
  revertAgentChange,
  revertAgentChangeHunk,
  revertAllAgentChanges
} from '../agentChangesRevert'
import type { FolderAccessManager } from '../folderAccessManager'
import { isMainFrameSender } from './ipcSenderGuard'
import {
  parseAgentChangePatch,
  parseAgentChangePath,
  parseAgentChangesBeginTrigger,
  parseAgentChangesScope,
  parseAgentChangesUndoId,
  parseAgentRevertAllEntries,
  parseRevertScope
} from './agentChangesPayloadParser'
import { resolveAndAssertStatusRelativePath } from './gitPathResolver'

// エージェントの変更の IPC の受け口(設計書「IPC」「セキュリティ」)。renderer から受け取るのはパス・パッチ・確認の一覧・
// 記録の開始の種類・範囲(列挙と runId)だけで、記録のインデックスの場所・tree・フォルダ・git の引数は main が決める。
// 取り消しで受け取るのは undoId だけで、取り消すパス・控えの置き場所は main の記録が決める(renderer には控えの要約だけを返す)。
// 記録は送信元の webContents の id で引く(所有者の分離)。
// 戻す 3 つは registry の withAttributionAbsorbed で包み、アプリの操作を利用者の変更に数えない(設計書「アプリの戻す操作・取り消しの吸収」)。
// 控えの記録(commitRevert)は吸収の外。
// 累積の一覧とすべて戻すの実行時の一覧の行の author は registry の attributeEntries で付ける(すべて戻すは吸収の中で呼ぶ)

export const AGENT_CHANGES_NOT_MAIN_FRAME = 'メインフレーム以外からの依頼は受け付けません'
export const AGENT_CHANGES_NO_RECORD_MESSAGE = 'エージェントの変更の記録がありません'
// 範囲ごとの一覧・diff の文言は agentChangesScopedQuery に置き、受け口の利用者のためにここからも出す
export { AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE } from '../agentChangesScopedQuery'

export interface AgentChangesHandlerDeps {
  registry: Pick<
    AgentBaselineRegistry,
    | 'begin'
    | 'getState'
    | 'withRecord'
    | 'clear'
    | 'commitRevertUndo'
    | 'undoLastRevert'
    | 'withAttributionAbsorbed'
    | 'attributeEntries'
  >
  folderAccess: FolderAccessManager
  /** OS のゴミ箱へ移す(trash.ts の moveToTrash) */
  trash: (absolutePath: string) => Promise<void>
  /** 戻す操作の取り消しの控えの置き場所と上限(本番は os.tmpdir() と AGENT_CHANGES_UNDO_MAX_BYTES) */
  undoCapture: AgentChangesUndoCaptureOptions
}

export function registerAgentChangesHandlers(
  ipcMain: IpcMain,
  { registry, folderAccess, trash, undoCapture }: AgentChangesHandlerDeps
): void {
  // 送信元の確認と、許可のフォルダ(無ければ null)
  const ownerOf = (event: IpcMainInvokeEvent): { ownerId: number; folder: string | null } => {
    if (!isMainFrameSender(event)) throw new Error(AGENT_CHANGES_NOT_MAIN_FRAME)
    return { ownerId: event.sender.id, folder: folderAccess.get(event.sender.id) ?? null }
  }
  // パスの検証(許可のフォルダの中・index の表記のまま。git:discardChanges と同じ規則)
  const relativePathOf = async (folder: string, path: unknown): Promise<string> =>
    resolveAndAssertStatusRelativePath(folderAccess, folder, parseAgentChangePath(path))
  // 記録を使う操作。フォルダが無い・記録が無いなら例外
  const withRecordOrThrow = async <T>(
    ownerId: number,
    folder: string | null,
    task: (record: AgentChangesRecord) => Promise<T>
  ): Promise<T> => {
    if (folder === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
    const result = await registry.withRecord(ownerId, folder, task)
    if (result === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
    return result
  }
  // パスを受ける操作(getDiff・revertFile・revertHunk)の共通の前処理。送信元の確認 → 引数の検証(parseArgs。パッチ・範囲) →
  // フォルダが無ければ例外 → パスの検証 → 記録の列、の順。検証の失敗は記録の列に入る前に拒否する。
  // parseArgs を送信元の確認の後・フォルダの確認の前に呼ぶのは、revertHunk のパッチの検証の順序を保つため
  // (メインフレーム以外からの依頼には、壊れたパッチでも常に AGENT_CHANGES_NOT_MAIN_FRAME を返す)
  const withRecordAtPath = async <A, T>(
    event: IpcMainInvokeEvent,
    path: unknown,
    parseArgs: () => A,
    task: (record: AgentChangesRecord, relativePath: string, args: A, ownerId: number) => Promise<T>
  ): Promise<T> => {
    const { ownerId, folder } = ownerOf(event)
    const args = parseArgs()
    if (folder === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
    const relativePath = await relativePathOf(folder, path)
    return withRecordOrThrow(ownerId, folder, (record) => task(record, relativePath, args, ownerId))
  }
  // 戻す関数の文脈。attributeEntries はすべて戻すの対象の絞り込みに使う(行の ↶・ハンクは使わない)。戻す関数は吸収の task の中で
  // 呼ぶため、author は吸収の (1) の区切り(S1)からの今の区間で付く(L-449)。そのとき限りの印(unassignedNow)は要約を返さない
  // 戻す操作では使わない(窓の一覧の後に押しても先に並んだ同期が閉じた区間を割り当て、食い違う行は照合で中止される〈安全側〉。
  // 吸収の (1) が段階の違いで印を立てるのは、戻す操作が列で待つ間に段階が変わったときで、今の区間は記録の印で割り当てない)
  const revertContextOf = (ownerId: number, record: AgentChangesRecord): AgentRevertContext => ({
    snapshot: record.baseline,
    trash,
    undoCapture,
    attributeEntries: async (entries) =>
      (await registry.attributeEntries(ownerId, record, entries)).entries
  })
  // 戻した結果の控えを記録へ移し、renderer に返す控えの成否と要約を registry から受け取る(記録の列の中で、戻す関数が resolve したときだけ
  // 呼ぶ。控えの一時ディレクトリ・項目は renderer に返さない。L-019)。控えを残すか捨てるか(適用が 0 件なら前の控えを残す、記録が
  // 置き換わったなら付けずに消して discarded にするなど)は registry が決める
  const commitRevert = (
    ownerId: number,
    record: AgentChangesRecord,
    operation: AgentChangesUndoOperation,
    outcome: AgentRevertOutcome
  ): Promise<AgentRevertResult> =>
    registry.commitRevertUndo(ownerId, record, {
      operation,
      capture: outcome.capture,
      applied: outcome.applied
    })

  ipcMain.handle(
    'agentChanges:begin',
    async (event, trigger: unknown): Promise<AgentChangesState> => {
      const { ownerId, folder } = ownerOf(event)
      const parsedTrigger = parseAgentChangesBeginTrigger(trigger)
      if (folder === null) return { kind: 'none' }
      return registry.begin(ownerId, folder, parsedTrigger)
    }
  )

  ipcMain.handle('agentChanges:getState', (event): AgentChangesState => {
    const { ownerId, folder } = ownerOf(event)
    return folder === null ? { kind: 'none' } : registry.getState(ownerId, folder)
  })

  ipcMain.handle(
    'agentChanges:list',
    async (event, scope: unknown): Promise<AgentChangesListResult> => {
      const { ownerId, folder } = ownerOf(event)
      const parsedScope = parseAgentChangesScope(scope)
      if (folder === null) return { kind: 'none' }
      const result = await registry.withRecord(ownerId, folder, (record) =>
        listAgentChangesInScope(record, parsedScope, (entries) =>
          registry.attributeEntries(ownerId, record, entries)
        )
      )
      return result ?? { kind: 'none' }
    }
  )

  ipcMain.handle(
    'agentChanges:getDiff',
    (event, path: unknown, scope: unknown): Promise<string> =>
      withRecordAtPath(
        event,
        path,
        () => parseAgentChangesScope(scope),
        (record, relativePath, parsedScope) =>
          getAgentChangeDiffInScope(record, parsedScope, relativePath)
      )
  )

  // 戻す系は累積の範囲だけを受け付け、実行の範囲は記録の列に入る前に拒む(L-058)。戻す先は累積の始点
  ipcMain.handle(
    'agentChanges:revertFile',
    (event, path: unknown, scope: unknown): Promise<AgentRevertResult> =>
      withRecordAtPath(
        event,
        path,
        () => parseRevertScope(scope),
        async (record, relativePath, _scope, ownerId) =>
          commitRevert(
            ownerId,
            record,
            'file',
            await registry.withAttributionAbsorbed(
              ownerId,
              record,
              () => revertAgentChange(revertContextOf(ownerId, record), relativePath),
              (outcome) => outcome.applied > 0
            )
          )
      )
  )

  ipcMain.handle(
    'agentChanges:revertHunk',
    (event, path: unknown, patch: unknown, scope: unknown): Promise<AgentRevertResult> =>
      withRecordAtPath(
        event,
        path,
        () => {
          const parsedPatch = parseAgentChangePatch(patch)
          parseRevertScope(scope)
          return parsedPatch
        },
        async (record, relativePath, parsedPatch, ownerId) =>
          commitRevert(
            ownerId,
            record,
            'hunk',
            await registry.withAttributionAbsorbed(
              ownerId,
              record,
              () =>
                revertAgentChangeHunk(revertContextOf(ownerId, record), relativePath, parsedPatch),
              (outcome) => outcome.applied > 0
            )
          )
      )
  )

  ipcMain.handle(
    'agentChanges:revertAll',
    async (event, expected: unknown, scope: unknown): Promise<AgentRevertAllResult> => {
      const { ownerId, folder } = ownerOf(event)
      const entries = parseAgentRevertAllEntries(expected)
      parseRevertScope(scope)
      return withRecordOrThrow(ownerId, folder, async (record) => {
        const { applied, capture, ...result } = await registry.withAttributionAbsorbed(
          ownerId,
          record,
          () => revertAllAgentChanges(revertContextOf(ownerId, record), entries),
          (outcome) => outcome.applied > 0
        )
        const committed = await commitRevert(ownerId, record, 'all', { applied, capture })
        return { ...result, revertedCount: applied, ...committed }
      })
    }
  )

  // 直前の戻す操作の取り消し。受け取るのは undoId だけで、取り消すパス・控えは main の記録が決める(L-019)。
  // 検証の失敗は記録の列に入る前に拒否する
  ipcMain.handle(
    'agentChanges:undoRevert',
    async (event, undoId: unknown): Promise<AgentChangesUndoResult> => {
      const { ownerId, folder } = ownerOf(event)
      const parsedUndoId = parseAgentChangesUndoId(undoId)
      if (folder === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
      const result = await registry.undoLastRevert(ownerId, folder, parsedUndoId)
      if (result === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
      return result
    }
  )

  ipcMain.handle('agentChanges:clear', async (event): Promise<void> => {
    const { ownerId } = ownerOf(event)
    await registry.clear(ownerId)
  })
}
