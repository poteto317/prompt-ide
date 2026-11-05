// 指示ファイルの作成の手順(設計書 2026-11-05「ファイルツリーの操作」)。既存の作成(createFile)と同じロックを通し、成否を結果で返す。
// 共有の error(エクスプローラーの上部)には書かない。失敗の文言は節だけに出す
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentInstructionFile } from '@shared/agentInstructionFiles'
import type {
  AgentInstructionCreateResult,
  AgentInstructionCreateShownFailureReason
} from '@shared/types'
import type { FileTreeNode } from '../types'
import * as agentInstructionsApi from '../lib/agentInstructionsApi'
import { isSamePath, joinPath } from '../lib/pathUtils'
import { SAVE_ABORTED_BY_CREATE } from './useFileEditing'
import type { FileOperationLockOptions, FileOperationResult } from './useFileEditing'

export type AgentInstructionCreateOutcome =
  /** tree は読み直して反映したツリー。読み直せなかった・反映しなかったら null */
  | { status: 'created'; tree: FileTreeNode[] | null }
  | { status: 'failed'; reason: AgentInstructionCreateShownFailureReason }
  /** フォルダが無い・操作の途中でフォルダが切り替わった(main の folderChanged を含む) */
  | { status: 'skipped' }

export interface AgentInstructionFileCreationDeps {
  getFolderPath: () => string | null
  lockPathForFileOperation: (
    targetPath: string,
    options?: FileOperationLockOptions
  ) => Promise<(result?: FileOperationResult) => void>
  /** 反映したツリー、反映しなかったら null。読み込みの失敗は投げる(useFileTreeOperations の reloadTree) */
  reloadTree: () => Promise<FileTreeNode[] | null>
}

export async function runAgentInstructionFileCreation(
  deps: AgentInstructionFileCreationDeps,
  cliKind: AgentCliKind,
  file: AgentInstructionFile
): Promise<AgentInstructionCreateOutcome> {
  const folderAtStart = deps.getFolderPath()
  if (folderAtStart === null) return { status: 'skipped' }
  const isSameFolderNow = (): boolean => {
    const now = deps.getFolderPath()
    return now !== null && isSamePath(now, folderAtStart)
  }
  const targetPath = file.segments.reduce<string>(
    (parent, name) => joinPath(parent, name),
    folderAtStart
  )
  // ロックの対象は根(.claude はまだ無いことがある)。削除してバッファだけ残した同じパスのファイルを、古いバッファで上書きしない(L-061)
  const release = await deps.lockPathForFileOperation(folderAtStart, {
    invalidatesPaths: [targetPath],
    abortMessage: SAVE_ABORTED_BY_CREATE
  })
  // ロックを待つ間にフォルダが切り替わったら、IPC を呼ばない(main の許可は既に切り替え先を指していることがある)
  if (!isSameFolderNow()) {
    release({ succeeded: false })
    return { status: 'skipped' }
  }
  let result: AgentInstructionCreateResult
  try {
    result = await agentInstructionsApi.createAgentInstructionFile(folderAtStart, cliKind, file.id)
  } catch (err) {
    release({ succeeded: false })
    console.error('[createAgentInstructionFile] failed:', err)
    return isSameFolderNow() ? { status: 'failed', reason: 'failed' } : { status: 'skipped' }
  }
  release({ succeeded: result.ok })
  if (!isSameFolderNow()) return { status: 'skipped' }
  if (!result.ok) {
    // main の許可フォルダが作ろうとしたフォルダと違った(切り替えの途中)。作っていないので文言は出さない
    if (result.reason === 'folderChanged') return { status: 'skipped' }
    // exists・outside・failed は、アプリの外で作られた(ツリーが古い)ことが多い。読み直して、行を 開く にして確かめられるようにする。
    // 読み込みの失敗の表示は reportTreeLoad が済ませているので握りつぶす。IPC の例外では読み直さない(main の状態が分からず、失敗の文言だけで足りる)
    try {
      await deps.reloadTree()
    } catch {
      // 失敗の理由を返すのが先
    }
    if (!isSameFolderNow()) return { status: 'skipped' }
    return { status: 'failed', reason: result.reason }
  }
  let tree: FileTreeNode[] | null
  try {
    tree = await deps.reloadTree()
  } catch {
    // 読み直しの失敗の表示は reportTreeLoad が済ませている。作成の成功を失敗と取り違えない(L-001)
    tree = null
  }
  // 読み直しの途中でフォルダが切り替わったら、切り替え先の節に「開けませんでした」を出さない
  if (!isSameFolderNow()) return { status: 'skipped' }
  return { status: 'created', tree }
}
