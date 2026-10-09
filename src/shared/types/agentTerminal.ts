// エージェント CLI(claude)のセッションの IPC の型と上限。main・preload・renderer が共有する

/** 桁数・行数の範囲(main の入力検証と renderer の fit の結果の丸めで使う) */
export const AGENT_TERMINAL_MIN_COLS = 2
export const AGENT_TERMINAL_MAX_COLS = 500
export const AGENT_TERMINAL_MIN_ROWS = 1
export const AGENT_TERMINAL_MAX_ROWS = 300
/** 1 回の書き込みの上限(UTF-16 の単位)。貼り付けの本文の上限(20 万文字)と囲みを収める */
export const AGENT_WRITE_MAX_LENGTH = 1_000_000

/** 1 ウィンドウで同時に動かせるセッションの数(main の起動の拒否と renderer のタブの数の上限) */
export const AGENT_MAX_SESSIONS_PER_WINDOW = 4
/** renderer が発行するタブ(枠)の id の長さの上限 */
export const AGENT_SLOT_ID_MAX_LENGTH = 64
/** renderer が発行するタブ(枠)の id の形式(英数字とハイフンの 1〜AGENT_SLOT_ID_MAX_LENGTH 文字) */
export const AGENT_SLOT_ID_PATTERN = new RegExp(`^[A-Za-z0-9-]{1,${AGENT_SLOT_ID_MAX_LENGTH}}$`)

/** 起動の途中で停止された(フォルダの切り替え・実行方式の切り替え・リロード)ときの spawn-failed の detail。renderer はエラーとして出さない */
export const AGENT_START_CANCELED_DETAIL = '起動の途中で停止されました'

export type AgentTerminalErrorKind =
  | 'no-folder'
  | 'folder-mismatch'
  | 'folder-missing'
  | 'command-not-found'
  | 'spawn-failed'
  | 'too-many-sessions'

export interface AgentStartRequest {
  /** renderer が発行するタブ(枠)の id。1 つの枠に 1 つのセッション */
  slotId: string
  /** renderer が表示しているフォルダ。main は許可のフォルダと一致するかだけを確かめる(作業ディレクトリには使わない) */
  folderPath: string
  cols: number
  rows: number
}

export type AgentStartResult =
  | { kind: 'started' | 'already-running'; sessionId: string }
  | {
      kind: 'error'
      error: AgentTerminalErrorKind
      /** folder-missing はフォルダのパス、spawn-failed は例外の文言 */
      detail?: string
      /** command-not-found のとき、ログインシェルから PATH を取得できず既定の場所だけを探したか */
      shellPathUnavailable?: boolean
    }

/** 起動の取り消しの結果(spawn-failed + AGENT_START_CANCELED_DETAIL)。呼ぶたびに新しいオブジェクトを返す */
export function agentStartCanceled(): Extract<AgentStartResult, { kind: 'error' }> {
  return { kind: 'error', error: 'spawn-failed', detail: AGENT_START_CANCELED_DETAIL }
}

/** 起動の結果が取り消し(agentStartCanceled)か */
export function isAgentStartCanceled(result: AgentStartResult): boolean {
  return (
    result.kind === 'error' &&
    result.error === 'spawn-failed' &&
    result.detail === AGENT_START_CANCELED_DETAIL
  )
}

/** exited: エージェント自身の終了。stopped: 終了ボタン・タブを閉じる・実行方式の切り替え・リロード・ウィンドウの破棄。folder-changed: フォルダの切り替え */
export const AGENT_EXIT_REASONS = ['exited', 'stopped', 'folder-changed'] as const
export type AgentExitReason = (typeof AGENT_EXIT_REASONS)[number]

export function isAgentExitReason(value: unknown): value is AgentExitReason {
  return typeof value === 'string' && (AGENT_EXIT_REASONS as readonly string[]).includes(value)
}

export interface AgentSessionData {
  sessionId: string
  data: string
}

export interface AgentSessionExit {
  sessionId: string
  /** node-pty の終了コード。不明なら null */
  exitCode: number | null
  /** 終了させたシグナルの番号。無ければ null */
  signal: number | null
  reason: AgentExitReason
}

/** 生きているセッションと、それを持つ枠(getAgentSessions の戻り値の要素) */
export interface AgentSessionSnapshotEntry {
  slotId: string
  sessionId: string
}
