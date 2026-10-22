import { describe, it, expect } from 'vitest'
import { isAgentActivityWaitingForUser } from '../agentActivity'
import type { AgentActivity } from '../agentActivity'

// 活動の型と、利用者の操作を待っている活動の表(CLI に依らない)。画面からの判定のテストは claudeScreenActivity.test.ts・
// copilotScreenActivity.test.ts

describe('isAgentActivityWaitingForUser', () => {
  it('許可待ち・確認待ちだけが利用者の操作を待っている(ステータスバーの強調・通知・バッジが同じ集まりを使う)', () => {
    const activities: AgentActivity[] = ['working', 'idle', 'permission', 'confirm', 'unknown']
    expect(activities.filter(isAgentActivityWaitingForUser)).toEqual(['permission', 'confirm'])
  })
})
