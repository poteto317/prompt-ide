// エージェント CLI(claude)のセッションの IPC の型と上限。main・preload・renderer が共有する

/** 桁数・行数の範囲(main の入力検証と renderer の fit の結果の丸めで使う) */
export const AGENT_TERMINAL_MIN_COLS = 2
export const AGENT_TERMINAL_MAX_COLS = 500
export const AGENT_TERMINAL_MIN_ROWS = 1
export const AGENT_TERMINAL_MAX_ROWS = 300
/** 1 回の書き込みの上限(UTF-16 の単位)。貼り付けの本文の上限(20 万文字)と囲みを収める */
export const AGENT_WRITE_MAX_LENGTH = 1_000_000

/**
 * 1 ウィンドウで同時に動かせるセッションの数(main の起動の拒否と renderer のタブの数の上限)。
 * main は止めている(まだ止まりきっていない)セッションも数え、その分は止まりきるまで新しい起動を待たせる
 */
export const AGENT_MAX_SESSIONS_PER_WINDOW = 4
/** renderer が発行するタブ(枠)の id の長さの上限 */
export const AGENT_SLOT_ID_MAX_LENGTH = 64
/** renderer が発行するタブ(枠)の id の形式(英数字とハイフンの 1〜AGENT_SLOT_ID_MAX_LENGTH 文字) */
export const AGENT_SLOT_ID_PATTERN = new RegExp(`^[A-Za-z0-9-]{1,${AGENT_SLOT_ID_MAX_LENGTH}}$`)

/** claude の会話の ID の形式(小文字の UUID v4 の厳密な形式)。main は新しい ID を crypto.randomUUID() で作り、再開の依頼の ID も
 *  この形式で検証する(`-` 始まりの値が claude のオプションとして解釈される経路を断つ。L-034) */
export const CLAUDE_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** claude の会話の ID の形式に当たる文字列か */
export function isClaudeSessionId(value: unknown): value is string {
  return typeof value === 'string' && CLAUDE_SESSION_ID_PATTERN.test(value)
}

/** 起動の途中で停止された(フォルダの切り替え・実行方式の切り替え・リロード)ときの spawn-failed の detail。renderer はエラーとして出さない */
export const AGENT_START_CANCELED_DETAIL = '起動の途中で停止されました'

export type AgentTerminalErrorKind =
  | 'no-folder'
  | 'folder-mismatch'
  | 'folder-missing'
  | 'command-not-found'
  | 'spawn-failed'
  | 'too-many-sessions'
  /** 再開の ID が許可のフォルダの起動の記録に無い(main が振った ID でない・ほかのフォルダの ID・古くなって記録から落ちた) */
  | 'unknown-session'
  /** 同じ ID の claude がほかのタブかウィンドウで起動中・実行中・止まりきる前 */
  | 'session-in-use'

/** 起動の指定。renderer は列挙型だけを渡し、コマンドと引数の並び(--session-id / --resume)は main が決める(L-019) */
export type AgentLaunchRequest = { kind: 'new' } | { kind: 'resume'; claudeSessionId: string }

export interface AgentStartRequest {
  /** renderer が発行するタブ(枠)の id。1 つの枠に 1 つのセッション */
  slotId: string
  /** renderer が表示しているフォルダ。main は許可のフォルダと一致するかだけを確かめる(作業ディレクトリには使わない) */
  folderPath: string
  cols: number
  rows: number
  /** 新しく起動するか、起動の記録にある claude のセッションを再開するか(省略できない。既定の new に流さない。L-044) */
  launch: AgentLaunchRequest
}

export type AgentStartResult =
  | {
      kind: 'started' | 'already-running'
      sessionId: string
      /** そのセッションの claude の会話の ID。already-running は動いているセッションの ID(依頼の launch は使わない) */
      claudeSessionId: string
    }
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
  /** そのセッションの claude の会話の ID(作り直しの後の合わせ込みで、タブの claudeSessionId を合わせる) */
  claudeSessionId: string
}

/** このフォルダで最後に起動が確定した claude のセッション(「前回の続きから」の再開の相手) */
export interface AgentLastSession {
  claudeSessionId: string
}

/** 中断(agentTerminal:interrupt)の結果。main は固定の 1 バイトを書けたかだけを返す(作業が止まったかは claude の画面の判定で分かる) */
export type AgentInterruptResult =
  | { kind: 'sent' }
  | { kind: 'no-session' }
  | { kind: 'write-failed' }
