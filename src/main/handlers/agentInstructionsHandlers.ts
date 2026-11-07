// 指示ファイルの作成の受け口(設計書 2026-11-05「IPC agentInstructions:create」)。引数の検証の失敗だけを IPC の例外にし、
// 作成の失敗は理由で返す(画面の文言は renderer が理由から選ぶ。例外の文言にはパスが入るので送らない。L-017)
// 全体の指示ファイルの有無の問い合わせ(getGlobalStatus。例外を投げず状態で返す)と全体の作成(createGlobal。renderer は CLI の種類だけを送る)も
// 受ける(設計書 2026-11-07 global)
import { realpath } from 'node:fs/promises'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { isAgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import { findAgentInstructionFile } from '@shared/agentInstructionFiles'
import type { AgentInstructionFile } from '@shared/agentInstructionFiles'
import type {
  AgentInstructionCreateFailureReason,
  AgentInstructionCreateResult,
  GlobalAgentInstructionCreateResult,
  GlobalAgentInstructionStatus
} from '@shared/types'
import { createAgentInstructionFile } from '../agentInstructionFileCreator'
import { FolderAccessDeniedError } from '../folderAccessManager'
import type { FolderAccessManager } from '../folderAccessManager'
import { isFsError } from '../fsErrors'
import type { GlobalAgentInstructionContext } from '../globalAgentInstructionLocations'
import { getGlobalAgentInstructionStatus } from '../globalAgentInstructionStatus'
import {
  createGlobalAgentInstructionFile,
  toGlobalAgentInstructionCreateFailureReason
} from '../globalAgentInstructionFileCreator'

/** IPC の引数を検証して、比べる根と表の行を返す。不正なら投げる(既定の行に読み替えない。L-044) */
function parseCreateArgs(
  expectedRoot: unknown,
  cliKind: unknown,
  fileId: unknown
): { expectedRoot: string; file: AgentInstructionFile } {
  if (typeof expectedRoot !== 'string' || expectedRoot === '') {
    throw new Error('不正なフォルダの指定です')
  }
  if (!isAgentCliKind(cliKind)) throw new Error('不正なエージェント CLI の種類です')
  const file = findAgentInstructionFile(cliKind, fileId)
  if (file === null) throw new Error('不正な指示ファイルの指定です')
  return { expectedRoot, file }
}

export function toAgentInstructionCreateFailureReason(
  err: unknown
): AgentInstructionCreateFailureReason {
  if (err instanceof FolderAccessDeniedError) return 'outside'
  if (isFsError(err, 'EEXIST') || isFsError(err, 'ENOTDIR')) return 'exists'
  return 'failed'
}

/** renderer が作ろうとしたフォルダ(expectedRoot)が、今の許可フォルダ(realpath 済み)と同じか。realpath の失敗は「違う」 */
async function isSameAsAllowedFolder(
  expectedRoot: string,
  allowedFolder: string
): Promise<boolean> {
  try {
    return (await realpath(expectedRoot)) === allowedFolder
  } catch {
    return false
  }
}

/** 全体の指示ファイルの IPC の引数。renderer は CLI の種類だけを送る(パスは main が決める。L-018・L-019)。不正なら投げる(L-044) */
function parseGlobalCliKind(cliKind: unknown): AgentCliKind {
  if (!isAgentCliKind(cliKind)) throw new Error('不正なエージェント CLI の種類です')
  return cliKind
}

export function registerAgentInstructionsHandlers(
  ipcMain: IpcMain,
  folderAccess: FolderAccessManager,
  globalInstructions: GlobalAgentInstructionContext
): void {
  ipcMain.handle(
    'agentInstructions:create',
    async (
      event: IpcMainInvokeEvent,
      expectedRoot: unknown,
      cliKind: unknown,
      fileId: unknown
    ): Promise<AgentInstructionCreateResult> => {
      const args = parseCreateArgs(expectedRoot, cliKind, fileId)
      const allowedFolder = folderAccess.get(event.sender.id)
      if (allowedFolder === undefined) return { ok: false, reason: 'failed' }
      // フォルダの切り替えの途中(許可は新しいフォルダ、renderer はまだ前のフォルダ)に、切り替え先へ作らない。
      // expectedRoot は比べるためだけに使い、書くパスは許可フォルダと表から決める(L-018・L-019)
      if (!(await isSameAsAllowedFolder(args.expectedRoot, allowedFolder))) {
        return { ok: false, reason: 'folderChanged' }
      }
      try {
        await createAgentInstructionFile(allowedFolder, folderAccess, args.file)
        return { ok: true }
      } catch (err) {
        console.error('[agentInstructions:create] failed:', err)
        return { ok: false, reason: toAgentInstructionCreateFailureReason(err) }
      }
    }
  )

  // 全体の指示ファイルの有無(設計書 2026-11-07 global「有無の問い合わせ」)。問い合わせは例外を投げず状態で返す
  ipcMain.handle(
    'agentInstructions:getGlobalStatus',
    async (_event: IpcMainInvokeEvent, cliKind: unknown): Promise<GlobalAgentInstructionStatus> => {
      const kind = parseGlobalCliKind(cliKind)
      return getGlobalAgentInstructionStatus(
        globalInstructions.locations[kind],
        globalInstructions.homeDir
      )
    }
  )

  // 全体の指示ファイルの作成。書く場所はフォルダに依らないので expectedRoot を受け取らない
  ipcMain.handle(
    'agentInstructions:createGlobal',
    async (
      _event: IpcMainInvokeEvent,
      cliKind: unknown
    ): Promise<GlobalAgentInstructionCreateResult> => {
      const location = globalInstructions.locations[parseGlobalCliKind(cliKind)]
      if (location.kind === 'unavailable') return { ok: false, reason: 'unavailable' }
      try {
        await createGlobalAgentInstructionFile(location, globalInstructions.homeDir)
        return { ok: true }
      } catch (err) {
        console.error('[agentInstructions:createGlobal] failed:', err)
        return { ok: false, reason: toGlobalAgentInstructionCreateFailureReason(err) }
      }
    }
  )
}
