import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AgentChangesListResult, AgentChangesState, DiscardAllResult } from '@shared/types'
import type { AgentBaselineRegistry } from '../agentBaselineRegistry'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import { getAgentChangeDiff } from '../agentChangeDiff'
import { listAgentChanges } from '../agentChangesQuery'
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
  parseAgentRevertAllEntries
} from './agentChangesPayloadParser'
import { resolveAndAssertStatusRelativePath } from './gitPathResolver'

// エージェントの変更の IPC の受け口(設計書「IPC」「セキュリティ」)。renderer から受け取るのはパス・パッチ・確認の一覧だけで、
// 記録のインデックスの場所・フォルダ・git の引数は main が決める。記録は送信元の webContents の id で引く(所有者の分離)

export const AGENT_CHANGES_NOT_MAIN_FRAME = 'メインフレーム以外からの依頼は受け付けません'
export const AGENT_CHANGES_NO_RECORD_MESSAGE = 'エージェントの変更の記録がありません'

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
    task: (snapshot: BaselineSnapshot) => Promise<T>
  ): Promise<T> => {
    if (folder === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
    const result = await registry.withRecord(ownerId, folder, task)
    if (result === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
    return result
  }
  // パスを受ける操作(getDiff・revertFile・revertHunk)の共通の前処理。送信元の確認 → 引数の検証(parseArgs) →
  // フォルダが無ければ例外 → パスの検証 → 記録の列、の順。検証の失敗は記録の列に入る前に拒否する。
  // parseArgs を送信元の確認の後・フォルダの確認の前に呼ぶのは、revertHunk のパッチの検証の順序を保つため
  // (メインフレーム以外からの依頼には、壊れたパッチでも常に AGENT_CHANGES_NOT_MAIN_FRAME を返す)
  const withRecordAtPath = async <A, T>(
    event: IpcMainInvokeEvent,
    path: unknown,
    parseArgs: () => A,
    task: (snapshot: BaselineSnapshot, relativePath: string, args: A) => Promise<T>
  ): Promise<T> => {
    const { ownerId, folder } = ownerOf(event)
    const args = parseArgs()
    if (folder === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
    const relativePath = await relativePathOf(folder, path)
    return withRecordOrThrow(ownerId, folder, (snapshot) => task(snapshot, relativePath, args))
  }
  const noArgs = (): undefined => undefined

  ipcMain.handle('agentChanges:begin', async (event): Promise<AgentChangesState> => {
    const { ownerId, folder } = ownerOf(event)
    if (folder === null) return { kind: 'none' }
    return registry.begin(ownerId, folder)
  })

  ipcMain.handle('agentChanges:getState', (event): AgentChangesState => {
    const { ownerId, folder } = ownerOf(event)
    return folder === null ? { kind: 'none' } : registry.getState(ownerId, folder)
  })

  ipcMain.handle('agentChanges:list', async (event): Promise<AgentChangesListResult> => {
    const { ownerId, folder } = ownerOf(event)
    if (folder === null) return { kind: 'none' }
    const result = await registry.withRecord(ownerId, folder, async (snapshot) => ({
      kind: 'recording' as const,
      startedAt: snapshot.startedAt,
      ...(await listAgentChanges(snapshot))
    }))
    return result ?? { kind: 'none' }
  })

  ipcMain.handle(
    'agentChanges:getDiff',
    (event, path: unknown): Promise<string> =>
      withRecordAtPath(event, path, noArgs, (snapshot, relativePath) =>
        getAgentChangeDiff(snapshot, relativePath)
      )
  )

  ipcMain.handle('agentChanges:revertFile', async (event, path: unknown): Promise<void> => {
    await withRecordAtPath(event, path, noArgs, (snapshot, relativePath) =>
      revertAgentChange({ snapshot, trash }, relativePath)
    )
  })

  ipcMain.handle(
    'agentChanges:revertHunk',
    async (event, path: unknown, patch: unknown): Promise<void> => {
      await withRecordAtPath(
        event,
        path,
        () => parseAgentChangePatch(patch),
        (snapshot, relativePath, parsedPatch) =>
          revertAgentChangeHunk({ snapshot, trash }, relativePath, parsedPatch)
      )
    }
  )

  ipcMain.handle(
    'agentChanges:revertAll',
    async (event, expected: unknown): Promise<DiscardAllResult> => {
      const { ownerId, folder } = ownerOf(event)
      const entries = parseAgentRevertAllEntries(expected)
      return withRecordOrThrow(ownerId, folder, (snapshot) =>
        revertAllAgentChanges({ snapshot, trash }, entries)
      )
    }
  )

  ipcMain.handle('agentChanges:clear', async (event): Promise<void> => {
    const { ownerId } = ownerOf(event)
    await registry.clear(ownerId)
  })
}
