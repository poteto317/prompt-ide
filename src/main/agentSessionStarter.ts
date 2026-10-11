import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import type {
  AgentLastSession,
  AgentSessionData,
  AgentSessionExit,
  AgentStartRequest,
  AgentStartResult
} from '@shared/types'
import { agentStartCanceled } from '@shared/types'
import type { FolderAccessManager } from './folderAccessManager'
import type {
  AgentRegistryStartResult,
  AgentSessionCreation,
  AgentSessionRegistry
} from './agentSessionRegistry'
import { startAgentSession } from './agentSession'
import type { AgentSession, PtySpawn, StopTree } from './agentSession'
import { buildAgentLaunchArgs } from './agentCommand'
import type { AgentLaunchResolution } from './agentCommand'
import { toAgentFolderKey } from './agentSessionRecordStore'
import type { AgentSessionRecordStore } from './agentSessionRecordStore'
import type { ClaudeSessionReservations } from './claudeSessionReservations'
import { selectClaudeSessionId } from './claudeSessionIdSelection'

// エージェントのセッションの起動の規則と pty の配線(設計書「IPC」「停止の契機」、セッションの再開の設計書「起動の流れ」)。
// Electron に依存しない。IPC の受け口(送信元・ペイロードの検証、送信先の webContents への送信)は handlers/agentTerminalHandlers.ts。
// 起動のコマンド・作業ディレクトリ・環境変数・claude のセッションの指定は main で決め、依頼の folderPath は許可のフォルダとの
// 一致の確認にだけ使う。ここは起動の手順(照合・取り消しの確認・ID の選択・予約・spawn を await を挟まずに行う順序)と、起動の記録への
// 書き込みの契機を持つ。各段の規則は別のモジュールにある: 起動に使う claude の会話の ID の選択(新規は振る・再開は記録と照合)は
// claudeSessionIdSelection.ts、引数(--session-id / --resume)は agentCommand.buildAgentLaunchArgs、同じ ID の二重の起動の拒否は
// claudeSessionReservations.ts、記録の規則は agentSessionRecordStore.ts

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
  /** pty のセッションの id */
  createSessionId: () => string
  /** フォルダごとの claude のセッションの起動の記録(再開の照合・起動が確定したときの記録・「前回」) */
  records: Pick<AgentSessionRecordStore, 'whenLoaded' | 'has' | 'last' | 'record'>
  /** 全ウィンドウで共有する claude のセッション ID の予約 */
  reservations: Pick<ClaudeSessionReservations, 'tryReserve'>
  /** 新しい claude のセッション ID(既定は crypto.randomUUID) */
  createClaudeSessionId?: () => string
  /** 記録のフォルダのキーの作り方を決める(既定は process.platform) */
  platform?: NodeJS.Platform
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

export interface AgentSessionStarterService {
  start: AgentSessionStarter
  /**
   * pty の sessionId → claude の会話の ID。作ったセッションの exited の解決で消す(消す購読はセッションを registry へ返す前に
   * 付けるため、registry が枠からセッションを外すより先に消える)。無ければ undefined
   */
  claudeSessionIdOf(sessionId: string): string | undefined
  /**
   * 「前回」の取得(agentTerminal:getLastSession)。folderPath を正規化して許可のフォルダと一致するときだけ、記録の先頭を返す。
   * 一致しない・記録が無ければ null
   */
  lastSessionOf(ownerId: number, folderPath: string): Promise<AgentLastSession | null>
}

/** 依頼のフォルダと許可のフォルダの照合の結果(起動と「前回」の取得で同じ規則を使う) */
type AllowedFolderMatch =
  | { kind: 'matched'; allowedFolder: string }
  | { kind: 'no-folder' }
  | { kind: 'mismatch' }

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
  records,
  reservations,
  createClaudeSessionId = randomUUID,
  platform = process.platform,
  canonicalize = canonicalOrSelf,
  isDirectory = isDirectoryOnDisk
}: AgentSessionStarterDeps): AgentSessionStarterService {
  // pty の sessionId → claude の会話の ID(already-running・作り直しの後の合わせ込みで返す)
  const claudeSessionIdBySessionId = new Map<string, string>()

  /**
   * 依頼のフォルダ(renderer の文字列)を正規化して許可のフォルダと比べる。許可のフォルダが無ければ正規化せずに返す。
   * 起動(start)と「前回」の取得(lastSessionOf)で同じ照合の規則を使うため 1 か所に置く
   */
  async function matchAllowedFolder(
    ownerId: number,
    folderPath: string
  ): Promise<AllowedFolderMatch> {
    const allowedFolder = folderAccess.get(ownerId)
    if (allowedFolder === undefined) return { kind: 'no-folder' }
    if ((await canonicalize(folderPath)) !== allowedFolder) return { kind: 'mismatch' }
    return { kind: 'matched', allowedFolder }
  }

  const start: AgentSessionStarter = async (ownerId, request, sink) => {
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
    const match = await matchAllowedFolder(ownerId, request.folderPath)
    if (match.kind === 'no-folder') return { kind: 'error', error: 'no-folder' }
    if (match.kind === 'mismatch') return { kind: 'error', error: 'folder-mismatch' }
    const { allowedFolder } = match
    const folderKey = toAgentFolderKey(allowedFolder, platform)
    // この依頼の create で作ったセッションの claude の会話の ID(registry が started を返したときに記録して返す)
    const created: { claudeSessionId: string | null } = { claudeSessionId: null }
    const result = await registry.start(
      ownerId,
      request.slotId,
      async (): Promise<AgentSessionCreation> => {
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
        // 再開の照合は下の同期の区間で行うため、記録の読み込みの完了をここで待つ(読み込みが間に合わない経路を作らない)
        await records.whenLoaded()
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
        // ここから spawn までは await を挟まない(記録の照合・予約の判定と予約の間に、別の起動が割り込まないように)
        const selection = selectClaudeSessionId(
          request.launch,
          folderKey,
          records,
          createClaudeSessionId
        )
        if (selection.kind === 'rejected') return { kind: 'failed', result: selection.result }
        const { claudeSessionId } = selection
        // 予約の後で投げて予約が残らないよう、ID は予約の前に振る
        const sessionId = createSessionId()
        // 新しい ID も予約する(UUID の衝突は起きない前提だが、外す経路を 1 つにそろえるため)
        const releaseReservation = reservations.tryReserve(claudeSessionId)
        if (releaseReservation === null) {
          return { kind: 'failed', result: { kind: 'error', error: 'session-in-use' } }
        }
        let session: AgentSession
        try {
          session = startAgentSession({
            id: sessionId,
            spawn: spawnPty,
            file: launch.plan.file,
            // 検証を通った ID をそのまま引数にする(L-018)
            args: [...launch.plan.args, ...buildAgentLaunchArgs(request.launch, claudeSessionId)],
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
        } catch (err) {
          releaseReservation()
          const detail = err instanceof Error ? err.message : String(err)
          return { kind: 'failed', result: { kind: 'error', error: 'spawn-failed', detail } }
        }
        // 予約と Map は exited の解決で外す。registry が取り消した起動の停止の完了・終了・止める操作の完了は、どれも exited の
        // 解決になる(AgentSession.stop は止まりきると exited を解決する)。止める操作の間(stoppingSessions)は予約が残る。
        // registry へ返す前に購読するので、registry が枠からセッションを外すより先に Map から消える
        claudeSessionIdBySessionId.set(sessionId, claudeSessionId)
        void session.exited.then(() => {
          claudeSessionIdBySessionId.delete(sessionId)
          releaseReservation()
        })
        created.claudeSessionId = claudeSessionId
        return { kind: 'created', session }
      }
    )
    return finishStart(result, folderKey, created.claudeSessionId)
  }

  /** registry の結果に claude の会話の ID を足す。起動が確定した(started)ときだけ記録する */
  function finishStart(
    result: AgentRegistryStartResult,
    folderKey: string,
    createdClaudeSessionId: string | null
  ): AgentStartResult {
    // registry の結果の種類を足したときに already-running として返さないよう、kind ごとに分けて未知の kind は投げる(L-044)
    switch (result.kind) {
      case 'error':
        return result
      case 'started':
        return recordStarted(result.sessionId, folderKey, createdClaudeSessionId)
      case 'already-running':
        return alreadyRunning(result.sessionId)
      default: {
        const unknownResult: never = result
        throw new Error(`未知の起動の結果です: ${JSON.stringify(unknownResult)}`)
      }
    }
  }

  /** started を共有の結果にして記録する。registry の started は、この依頼の create が作り、取り消さずに枠に置いたセッションだけ */
  function recordStarted(
    sessionId: string,
    folderKey: string,
    createdClaudeSessionId: string | null
  ): AgentStartResult {
    if (createdClaudeSessionId === null) {
      throw new Error('起動したセッションの claude のセッション ID がありません')
    }
    // 起動は成功しているため、記録の失敗はログだけにする(次の 前回の続きから が古い記録を使うことがある。L-001)
    try {
      records.record(folderKey, createdClaudeSessionId)
    } catch (err) {
      console.error('[agentSessionStarter] 起動の記録に失敗しました:', err)
    }
    return { kind: 'started', sessionId, claudeSessionId: createdClaudeSessionId }
  }

  /** already-running(StrictMode の二重の依頼など)は、動いているセッションの ID を返す(依頼の launch は使わない) */
  function alreadyRunning(sessionId: string): AgentStartResult {
    const claudeSessionId = claudeSessionIdBySessionId.get(sessionId)
    if (claudeSessionId === undefined) {
      console.error(
        '[agentSessionStarter] 動いているセッションの claude のセッション ID が見つかりません:',
        sessionId
      )
      throw new Error('動いているセッションの claude のセッション ID が見つかりません')
    }
    return { kind: 'already-running', sessionId, claudeSessionId }
  }

  async function lastSessionOf(
    ownerId: number,
    folderPath: string
  ): Promise<AgentLastSession | null> {
    const match = await matchAllowedFolder(ownerId, folderPath)
    if (match.kind !== 'matched') return null
    const { allowedFolder } = match
    await records.whenLoaded()
    // await の間にフォルダが切り替わっていたら、切り替え前のフォルダの記録を返さない
    if (folderAccess.get(ownerId) !== allowedFolder) return null
    const claudeSessionId = records.last(toAgentFolderKey(allowedFolder, platform))
    return claudeSessionId === null ? null : { claudeSessionId }
  }

  return {
    start,
    claudeSessionIdOf: (sessionId) => claudeSessionIdBySessionId.get(sessionId),
    lastSessionOf
  }
}
