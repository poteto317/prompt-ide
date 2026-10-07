import { describe, it, expect } from 'vitest'
import {
  AGENT_CHANGE_STATUSES,
  isAgentChangeStatus,
  toAgentChangeRelativePath
} from '../types/agentChanges'
import { AGENT_CHANGES_LIST_LIMIT, isAgentChangeStatus as fromIndex } from '../types'

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
