// claude・copilot の hooks の受け取りの取り決め(設計書「受け口」「設定のファイル」「渡す hooks」、段階 3b の設計書「渡す hooks」)。設定・受け口・解釈が同じ定数を使う。
// どれも main が決め、renderer からは受け取らない(L-019)

/**
 * claude に渡す 9 つのイベント(SessionStart は http の hook を使えないため渡さない。PostToolBatch は段階 B から渡す)。
 * copilot の 7 つ(CopilotHookEventName)はこの型の部分集合で表す
 */
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

/** claude の設定の JSON に書く順 */
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

/** 要求のパス(クエリを含む req.url)が claude の 9 つのどれかに完全一致すればそのイベント。違えば null */
export function agentHookEventOfPath(path: string): AgentHookEventName | null {
  return AGENT_HOOK_EVENT_NAMES.find((event) => agentHookPathOf(event) === path) ?? null
}

/** copilot に渡す 7 つのイベント(PascalCase。claude の 9 つから、copilot に当たるものが無い PostToolBatch・StopFailure を除いたもの) */
export type CopilotHookEventName = Exclude<AgentHookEventName, 'PostToolBatch' | 'StopFailure'>

/** copilot の hooks の設定に書く順 */
export const COPILOT_HOOK_EVENT_NAMES: readonly CopilotHookEventName[] = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStop',
  'Stop',
  'SessionEnd'
]

/** copilot 向けのパスの前の部分。最後の段は claude と同じ表を使い、claude のパスと重ならない */
const COPILOT_HOOK_PATH_PREFIX = '/prompt-ide/agent-hooks/copilot/v1/'

export function copilotHookPathOf(event: CopilotHookEventName): string {
  return COPILOT_HOOK_PATH_PREFIX + AGENT_HOOK_EVENT_PATH_SEGMENTS[event]
}

/**
 * 要求のパスが copilot の経路(前の部分)で始まるか。7 つに一致しないパスも copilot の経路の不明なパスとして扱う
 * (copilot は preToolUse の 4xx・5xx をツールの拒否にするため、受け口は copilot の経路には常に 200 を返す)
 */
export function isCopilotHookPath(path: string): boolean {
  return path.startsWith(COPILOT_HOOK_PATH_PREFIX)
}

/** 受け口の経路(CLI の種類とイベント)。経路の種類とトークンの持ち主の種類が違えば、受け口はトークンの照合の失敗にする */
export type AgentHookRoute =
  | { cliKind: 'claude'; event: AgentHookEventName }
  | { cliKind: 'copilot'; event: CopilotHookEventName }

/** 要求のパス(クエリを含む req.url)が claude の 9 つ・copilot の 7 つのどれかに完全一致すればその経路。違えば null */
export function agentHookRouteOfPath(path: string): AgentHookRoute | null {
  const claudeEvent = agentHookEventOfPath(path)
  if (claudeEvent !== null) return { cliKind: 'claude', event: claudeEvent }
  const copilotEvent = COPILOT_HOOK_EVENT_NAMES.find((event) => copilotHookPathOf(event) === path)
  return copilotEvent === undefined ? null : { cliKind: 'copilot', event: copilotEvent }
}

/** claude で区間を数えるツール(ファイルを書くツールとシェル)。読むだけのツールは渡さない */
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

/**
 * copilot で区間を数えるツール。PascalCase の入力では Edit・Write・Bash に寄せられるが(1.0.62 から)、copilot の名前
 * (apply_patch・create・edit・bash、記録していない Windows の powershell)も並べる(並べた名前が増えるだけで害は無い)。
 * 読むだけのツール(view・rg・glob)とサブエージェントの呼び出し(task)は数えない(claude で Read・Agent を数えないのと同じ)
 */
export const COPILOT_HOOK_TOOL_NAMES: readonly string[] = [
  ...AGENT_HOOK_TOOL_NAMES,
  'bash',
  'powershell',
  'apply_patch',
  'create',
  'edit'
]

/** copilot の matcher(記録の 80 で確かめた、名前を | で並べた形) */
export const COPILOT_HOOK_TOOL_MATCHER = COPILOT_HOOK_TOOL_NAMES.join('|')

/** matcher を付けるイベント(ツールのイベント)。claude の設定と copilot の設定の両方が使う */
export const AGENT_HOOK_TOOL_EVENTS: readonly AgentHookEventName[] = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure'
]

/** PreToolUse の hook の timeout(秒)。受け口の待ちの上限(5 秒)より長くし、CLI(claude・copilot)の側で先に打ち切らない */
export const AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS = 10
/** ほかのイベントの hook の timeout(秒) */
export const AGENT_HOOK_TIMEOUT_SECONDS = 5

/** イベントごとの hook の timeout(秒)。claude の設定(timeout)と copilot の設定(timeoutSec)の両方がここから引く */
export function agentHookTimeoutSecondsOf(event: AgentHookEventName): number {
  return event === 'PreToolUse'
    ? AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS
    : AGENT_HOOK_TIMEOUT_SECONDS
}
