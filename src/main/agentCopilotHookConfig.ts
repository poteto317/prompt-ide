import {
  AGENT_HOOK_TOOL_EVENTS,
  COPILOT_HOOK_EVENT_NAMES,
  COPILOT_HOOK_TOOL_MATCHER,
  agentHookTimeoutSecondsOf,
  copilotHookPathOf
} from './agentHookProtocol'
import type { CopilotHookEventName } from './agentHookProtocol'

// copilot に渡す hooks の設定の JSON の中身(設計書 2026-10-26「渡す hooks」。純粋な関数)。copilot の hooks の形に合わせて変える部分で、
// どこに・どう書くか(枠のフォルダ・権限・原子的な書き直し)は agentCopilotHookPlugin.ts

/** copilot の平らな形の http の hook(onFailure・allowedEnvVars・env は書かない) */
export interface CopilotHttpHook {
  type: 'http'
  url: string
  headers: { Authorization: string }
  timeoutSec: number
  matcher?: string
}

export interface CopilotHookConfigJson {
  version: 1
  hooks: Record<CopilotHookEventName, CopilotHttpHook[]>
}

/**
 * hooks の設定の JSON(純粋な関数)。PascalCase のイベント名を copilot の平らな形で書く(camelCase と両方書くと同じ出来事が 2 回届く)。
 * PreToolUse の timeoutSec は受け口の待ちの上限(5 秒)の 2 倍(copilot の打ち切りはツールの許可になるので、先に打ち切らせない)。
 * 書く値は main の値(受け口のポート・トークン)だけ。URL・ヘッダーに環境変数を使わない
 */
export function buildCopilotHookConfig({
  baseUrl,
  token
}: {
  baseUrl: string
  token: string
}): CopilotHookConfigJson {
  const entries = COPILOT_HOOK_EVENT_NAMES.map(
    (event): [CopilotHookEventName, CopilotHttpHook[]] => {
      const hook: CopilotHttpHook = {
        type: 'http',
        url: baseUrl + copilotHookPathOf(event),
        headers: { Authorization: `Bearer ${token}` },
        timeoutSec: agentHookTimeoutSecondsOf(event)
      }
      return [
        event,
        [
          AGENT_HOOK_TOOL_EVENTS.includes(event)
            ? { ...hook, matcher: COPILOT_HOOK_TOOL_MATCHER }
            : hook
        ]
      ]
    }
  )
  return {
    version: 1,
    hooks: Object.fromEntries(entries) as Record<CopilotHookEventName, CopilotHttpHook[]>
  }
}
