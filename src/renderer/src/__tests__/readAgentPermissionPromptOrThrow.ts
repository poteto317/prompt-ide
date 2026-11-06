import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentPermissionPrompt } from '../lib/agentPermissionPrompt'
import { AGENT_PERMISSION_PROMPT_READERS } from '../lib/agentPermissionPromptReaders'
import type { ViewportLine } from '../lib/agentViewport'

// 記録の許可の画面を、本物の種類ごとの読み取り(AGENT_PERMISSION_PROMPT_READERS)で読んだ値を作る(押せるかの判定と答えの hook の
// テストで、描画の読み取りの値を 1 か所の書き方で用意する)。読み取れない画面はテストの前提の誤りなので投げる

export function readAgentPermissionPromptOrThrow(
  kind: AgentCliKind,
  lines: readonly ViewportLine[]
): AgentPermissionPrompt {
  const prompt = AGENT_PERMISSION_PROMPT_READERS[kind](lines)
  if (prompt === null) throw new Error('許可の確認を読み取れない画面です')
  return prompt
}
