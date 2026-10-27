import { describe, expect, it } from 'vitest'
import { buildCopilotHookConfig } from '../agentCopilotHookConfig'

// copilot に渡す hooks の設定の JSON の形(設計書 2026-10-26「渡す hooks」)。フォルダへの書き込みは agentCopilotHookPlugin.test.ts

const TOKEN = 'ab'.repeat(32)
const BASE = 'http://127.0.0.1:43210'

describe('buildCopilotHookConfig(設定の JSON)', () => {
  it('7 つのイベントを copilot の平らな形で書き、ツールのイベントだけに matcher、PreToolUse だけ timeoutSec 10', () => {
    const hook = (segment: string, timeoutSec: number): Record<string, unknown> => ({
      type: 'http',
      url: `${BASE}/prompt-ide/agent-hooks/copilot/v1/${segment}`,
      headers: { Authorization: `Bearer ${TOKEN}` },
      timeoutSec
    })
    const matcher =
      'Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|bash|powershell|apply_patch|create|edit'
    expect(buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN })).toEqual({
      version: 1,
      hooks: {
        UserPromptSubmit: [hook('user-prompt-submit', 5)],
        PreToolUse: [{ ...hook('pre-tool-use', 10), matcher }],
        PostToolUse: [{ ...hook('post-tool-use', 5), matcher }],
        PostToolUseFailure: [{ ...hook('post-tool-use-failure', 5), matcher }],
        SubagentStop: [hook('subagent-stop', 5)],
        Stop: [hook('stop', 5)],
        SessionEnd: [hook('session-end', 5)]
      }
    })
  })

  it('camelCase のイベント・onFailure・allowedEnvVars・env を書かず、URL に環境変数を使わない', () => {
    const text = JSON.stringify(buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    for (const word of [
      'preToolUse',
      'onFailure',
      'allowedEnvVars',
      '"env"',
      '$',
      'permissionDecision'
    ]) {
      expect(text).not.toContain(word)
    }
  })
})
