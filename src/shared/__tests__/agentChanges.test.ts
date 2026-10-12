import { describe, it, expect } from 'vitest'
import {
  AGENT_CHANGE_STATUSES,
  isAgentChangeStatus,
  toAgentChangeRelativePath
} from '../types/agentChanges'
import {
  AGENT_CHANGES_LIST_LIMIT,
  AGENT_CHANGES_MAX_RUNS,
  isAgentChangeStatus as fromIndex,
  isSameAgentChangesScope
} from '../types'
import type { AgentChangesScope } from '../types/agentChanges'

describe('isAgentChangeStatus', () => {
  it.each(AGENT_CHANGE_STATUSES)('%s は状態の文字', (status) => {
    expect(isAgentChangeStatus(status)).toBe(true)
  })

  it.each<[string, unknown]>([
    ['未追跡の印', '??'],
    ['小文字', 'm'],
    ['2 文字', 'MM'],
    ['リネーム(一覧はリネームを検出しない)', 'R'],
    ['空文字列', ''],
    ['数', 1],
    ['null', null],
    ['undefined', undefined]
  ])('%s は状態の文字ではない', (_label, value) => {
    expect(isAgentChangeStatus(value)).toBe(false)
  })
})

describe('共有の上限と再公開', () => {
  it('types.ts から値と判定を使える', () => {
    expect(AGENT_CHANGES_LIST_LIMIT).toBe(500)
    expect(AGENT_CHANGES_MAX_RUNS).toBe(10)
    expect(fromIndex('A')).toBe(true)
  })
})

describe('toAgentChangeRelativePath', () => {
  it.each<[string, string]>([
    ['dir/', 'dir'],
    ['a/b//', 'a/b'],
    ['file', 'file'],
    ['a/b.txt', 'a/b.txt']
  ])('%s → %s', (entryPath, expected) => {
    expect(toAgentChangeRelativePath(entryPath)).toBe(expected)
  })
})

describe('isSameAgentChangesScope', () => {
  it.each<[string, AgentChangesScope, AgentChangesScope, boolean]>([
    ['累積どうし', { kind: 'all' }, { kind: 'all' }, true],
    ['同じ実行', { kind: 'run', runId: 2 }, { kind: 'run', runId: 2 }, true],
    ['違う実行', { kind: 'run', runId: 2 }, { kind: 'run', runId: 3 }, false],
    ['累積と実行', { kind: 'all' }, { kind: 'run', runId: 1 }, false],
    ['実行と累積', { kind: 'run', runId: 1 }, { kind: 'all' }, false]
  ])('%s: %s', (_label, a, b, expected) => {
    expect(isSameAgentChangesScope(a, b)).toBe(expected)
  })
})
