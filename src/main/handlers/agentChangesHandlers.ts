import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AgentChangesListResult, AgentChangesState, DiscardAllResult } from '@shared/types'
import type { AgentBaselineRegistry } from '../agentBaselineRegistry'
import type { AgentChangesRecord } from '../agentChangesRecord'
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
  parseAgentRevertAllEntries,
  parseRevertScope
} from './agentChangesPayloadParser'
import { resolveAndAssertStatusRelativePath } from './gitPathResolver'

// エージェントの変更の IPC の受け口(設計書「IPC」「セキュリティ」)。renderer から受け取るのはパス・パッチ・確認の一覧・
// 記録の開始の種類・範囲(列挙と runId)だけで、記録のインデックスの場所・tree・フォルダ・git の引数は main が決める。
// 記録は送信元の webContents の id で引く(所有者の分離)

export const AGENT_CHANGES_NOT_MAIN_FRAME = 'メインフレーム以外からの依頼は受け付けません'
export const AGENT_CHANGES_NO_RECORD_MESSAGE = 'エージェントの変更の記録がありません'
// 範囲ごとの一覧・diff の文言は agentChangesScopedQuery に置き、受け口の利用者のためにここからも出す
export { AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE } from '../agentChangesScopedQuery'

export interface AgentChangesHandlerDeps {
  registry: Pick<AgentBaselineRegistry, 'begin' | 'getState' | 'withRecord' | 'clear'>
  folderAccess: FolderAccessManager
  /** OS のゴミ箱へ移す(trash.ts の moveToTrash) */
  trash: (absolutePath: string) => Promise<void>
}

export function registerAgentChangesHandlers(
  ipcMain: IpcMain,
  { registry, folderAccess, trash }: AgentChangesHandlerDeps
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
    task: (record: AgentChangesRecord, relativePath: string, args: A) => Promise<T>
  ): Promise<T> => {
    const { ownerId, folder } = ownerOf(event)
    const args = parseArgs()
    if (folder === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
    const relativePath = await relativePathOf(folder, path)
    return withRecordOrThrow(ownerId, folder, (record) => task(record, relativePath, args))
  }

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
        listAgentChangesInScope(record, parsedScope)
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
    async (event, path: unknown, scope: unknown): Promise<void> => {
      await withRecordAtPath(
        event,
        path,
        () => parseRevertScope(scope),
        (record, relativePath) =>
          revertAgentChange({ snapshot: record.baseline, trash }, relativePath)
      )
    }
  )

  ipcMain.handle(
    'agentChanges:revertHunk',
    async (event, path: unknown, patch: unknown, scope: unknown): Promise<void> => {
      await withRecordAtPath(
        event,
        path,
        () => {
          const parsedPatch = parseAgentChangePatch(patch)
          parseRevertScope(scope)
          return parsedPatch
        },
        (record, relativePath, parsedPatch) =>
          revertAgentChangeHunk({ snapshot: record.baseline, trash }, relativePath, parsedPatch)
      )
    }
  )

  ipcMain.handle(
    'agentChanges:revertAll',
    async (event, expected: unknown, scope: unknown): Promise<DiscardAllResult> => {
      const { ownerId, folder } = ownerOf(event)
      const entries = parseAgentRevertAllEntries(expected)
      parseRevertScope(scope)
      return withRecordOrThrow(ownerId, folder, (record) =>
        revertAllAgentChanges({ snapshot: record.baseline, trash }, entries)
      )
    }
  )

  ipcMain.handle('agentChanges:clear', async (event): Promise<void> => {
    const { ownerId } = ownerOf(event)
    await registry.clear(ownerId)
  })
}
