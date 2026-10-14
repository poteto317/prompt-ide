// claude の hooks の受け取りの取り決め(設計書「受け口」「設定のファイル」「渡す hooks」)。設定・受け口・解釈が同じ定数を使う。
// どれも main が決め、renderer からは受け取らない(L-019)

/** アプリが渡す 9 つのイベント(SessionStart は http の hook を使えないため渡さない。PostToolBatch は段階 B から渡す) */
export type AgentHookEventName =
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PostToolBatch'
  | 'SubagentStop'
  | 'Stop'
  | 'StopFailure'
  | 'SessionEnd'

/** 設定の JSON に書く順 */
export const AGENT_HOOK_EVENT_NAMES: readonly AgentHookEventName[] = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'SubagentStop',
  'Stop',
  'StopFailure',
  'SessionEnd'
]

/** イベントごとの URL のパスの最後の段(パスは agentHookPathOf・agentHookEventOfPath を通して使う) */
const AGENT_HOOK_EVENT_PATH_SEGMENTS: Readonly<Record<AgentHookEventName, string>> = {
  UserPromptSubmit: 'user-prompt-submit',
  PreToolUse: 'pre-tool-use',
  PostToolUse: 'post-tool-use',
  PostToolUseFailure: 'post-tool-use-failure',
  PostToolBatch: 'post-tool-batch',
  SubagentStop: 'subagent-stop',
  Stop: 'stop',
  StopFailure: 'stop-failure',
  SessionEnd: 'session-end'
}

const AGENT_HOOK_PATH_PREFIX = '/prompt-ide/agent-hooks/v1/'

export function agentHookPathOf(event: AgentHookEventName): string {
  return AGENT_HOOK_PATH_PREFIX + AGENT_HOOK_EVENT_PATH_SEGMENTS[event]
}

/** 要求のパス(クエリを含む req.url)が 9 つのどれかに完全一致すればそのイベント。違えば null */
export function agentHookEventOfPath(path: string): AgentHookEventName | null {
  return AGENT_HOOK_EVENT_NAMES.find((event) => agentHookPathOf(event) === path) ?? null
}

/** 区間を数えるツール(ファイルを書くツールとシェル)。読むだけのツールは渡さない */
export const AGENT_HOOK_TOOL_NAMES: readonly string[] = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'PowerShell'
]

/** 英字と | だけなので、claude は正規表現ではなく名前の完全一致の並びとして扱う(確認の結果 4) */
export const AGENT_HOOK_TOOL_MATCHER = AGENT_HOOK_TOOL_NAMES.join('|')

/** matcher を付けるイベント(ツールのイベント) */
export const AGENT_HOOK_TOOL_EVENTS: readonly AgentHookEventName[] = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure'
]

/** PreToolUse の hook の timeout(秒)。受け口の待ちの上限(5 秒)より長くし、claude 側で先に打ち切らない */
export const AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS = 10
/** ほかのイベントの hook の timeout(秒) */
export const AGENT_HOOK_TIMEOUT_SECONDS = 5
