import { realpath, stat } from 'node:fs/promises'
import type {
  AgentSessionData,
  AgentSessionExit,
  AgentStartRequest,
  AgentStartResult
} from '@shared/types'
import { agentStartCanceled } from '@shared/types'
import type { FolderAccessManager } from './folderAccessManager'
import type { AgentSessionCreation, AgentSessionRegistry } from './agentSessionRegistry'
import { startAgentSession } from './agentSession'
import type { PtySpawn, StopTree } from './agentSession'
import type { AgentLaunchResolution } from './agentCommand'

// エージェントのセッションの起動の規則と pty の配線(設計書「IPC」「停止の契機」)。Electron に依存しない。
// IPC の受け口(送信元・ペイロードの検証、送信先の webContents への送信)は handlers/agentTerminalHandlers.ts。
// 起動のコマンド・作業ディレクトリ・環境変数は main で決め、依頼の folderPath は許可のフォルダとの一致の確認にだけ使う

/** 起動したセッションの出力の送り先(所有者の webContents。破棄済みかを確かめられる) */
export interface AgentSessionSink {
  /** 送り先が無くなった(破棄済み)か。起動の直前に確かめ直す */
  isGone(): boolean
  onData(payload: AgentSessionData): void
  onExit(payload: AgentSessionExit): void
}

export interface AgentSessionStarterDeps {
  folderAccess: Pick<FolderAccessManager, 'get'>
  registry: Pick<AgentSessionRegistry, 'generationOf' | 'hold' | 'start'>
  /** 起動のコマンドと環境変数を決める(agentCommand.resolveAgentLaunch に実物の依存を渡したもの) */
  resolveLaunch: () => Promise<AgentLaunchResolution>
  spawnPty: PtySpawn
  stopTree: StopTree
  createSessionId: () => string
  /** 依頼のフォルダの正規化(既定は realpath。失敗したらそのまま) */
  canonicalize?: (path: string) => Promise<string>
  /** 作業ディレクトリがディレクトリとして存在するか(既定は stat) */
  isDirectory?: (path: string) => Promise<boolean>
}

export type AgentSessionStarter = (
  ownerId: number,
  request: AgentStartRequest,
  sink: AgentSessionSink
) => Promise<AgentStartResult>

async function canonicalOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

async function isDirectoryOnDisk(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export function createAgentSessionStarter({
  folderAccess,
  registry,
  resolveLaunch,
  spawnPty,
  stopTree,
  createSessionId,
  canonicalize = canonicalOrSelf,
  isDirectory = isDirectoryOnDisk
}: AgentSessionStarterDeps): AgentSessionStarter {
  return async (ownerId, request, sink) => {
    // 枠の停止の世代は最初の await より前に控える(await の間に届いた停止を、起動の直前に見分けるため)。比べ終わるまで
    // 枠を消さないよう hold する(await の間に枠が空になって消えると、世代が 0 に戻って控えた世代と比べられなくなる)
    const requestedGeneration = registry.generationOf(ownerId, request.slotId)
    const release = registry.hold(ownerId, request.slotId)
    try {
      return await startHeld(ownerId, request, sink, requestedGeneration)
    } finally {
      release()
    }
  }

  async function startHeld(
    ownerId: number,
    request: AgentStartRequest,
    sink: AgentSessionSink,
    requestedGeneration: string
  ): Promise<AgentStartResult> {
    const allowedFolder = folderAccess.get(ownerId)
    if (allowedFolder === undefined) return { kind: 'error', error: 'no-folder' }
    if ((await canonicalize(request.folderPath)) !== allowedFolder) {
      return { kind: 'error', error: 'folder-mismatch' }
    }
    return registry.start(ownerId, request.slotId, async (): Promise<AgentSessionCreation> => {
      // 作業ディレクトリは renderer の文字列ではなく許可のフォルダ(main の値)
      if (!(await isDirectory(allowedFolder))) {
        return {
          kind: 'failed',
          result: { kind: 'error', error: 'folder-missing', detail: allowedFolder }
        }
      }
      // node-pty は存在しないコマンドでも例外を投げず終了コード 1 になるため、起動の前に探す(確認の結果 4)
      const launch = await resolveLaunch()
      if (launch.kind === 'not-found') {
        return {
          kind: 'failed',
          result: {
            kind: 'error',
            error: 'command-not-found',
            shellPathUnavailable: launch.shellPathUnavailable
          }
        }
      }
      // registry.start の前の await(realpath)の間に届いた停止(リロード・破棄・フォルダの切り替え)は、registry.start が
      // 控える世代に含まれてしまい registry では取り消せない。入口で控えた世代・破棄・許可のフォルダを起動の直前に
      // 確かめ直し、所有者のいない・リロード前の・切り替え前のフォルダのセッションを作らない
      if (
        registry.generationOf(ownerId, request.slotId) !== requestedGeneration ||
        sink.isGone() ||
        folderAccess.get(ownerId) !== allowedFolder
      ) {
        return { kind: 'failed', result: agentStartCanceled() }
      }
      const sessionId = createSessionId()
      try {
        const session = startAgentSession({
          id: sessionId,
          spawn: spawnPty,
          file: launch.plan.file,
          args: launch.plan.args,
          env: launch.plan.env,
          cwd: allowedFolder,
          cols: request.cols,
          rows: request.rows,
          stopTree,
          callbacks: {
            onData: (data) => sink.onData({ sessionId, data }),
            onExit: (exit) => sink.onExit({ sessionId, ...exit })
          }
        })
        return { kind: 'created', session }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        return { kind: 'failed', result: { kind: 'error', error: 'spawn-failed', detail } }
      }
    })
  }
}
