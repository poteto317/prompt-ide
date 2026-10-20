import { describe, it, expect } from 'vitest'
import {
  AGENT_EXIT_REASONS,
  CLAUDE_SESSION_ID_PATTERN,
  AGENT_START_CANCELED_DETAIL,
  agentStartCanceled,
  isAgentExitReason,
  isAgentStartCanceled,
  isClaudeSessionId
} from '../types/agentTerminal'
import type { AgentStartResult } from '../types/agentTerminal'

describe('agentStartCanceled / isAgentStartCanceled', () => {
  it('取り消しは spawn-failed と取り消しの detail で表す', () => {
    expect(agentStartCanceled()).toEqual({
      kind: 'error',
      error: 'spawn-failed',
      detail: AGENT_START_CANCELED_DETAIL
    })
  })

  it('呼ぶたびに別のオブジェクトを返す(共有の値を書き換えられない)', () => {
    expect(agentStartCanceled()).not.toBe(agentStartCanceled())
  })

  it.each<[string, AgentStartResult, boolean]>([
    [
      '取り消し',
      { kind: 'error', error: 'spawn-failed', detail: AGENT_START_CANCELED_DETAIL },
      true
    ],
    ['他の spawn-failed', { kind: 'error', error: 'spawn-failed', detail: 'spawn ENOENT' }, false],
    ['detail の無い spawn-failed', { kind: 'error', error: 'spawn-failed' }, false],
    [
      '別の種別で同じ detail',
      { kind: 'error', error: 'folder-missing', detail: AGENT_START_CANCELED_DETAIL },
      false
    ],
    [
      '起動の成功',
      {
        kind: 'started',
        sessionId: 's',
        cliKind: 'claude',
        claudeSessionId: '11111111-1111-4111-8111-111111111111'
      },
      false
    ],
    [
      '起動済み',
      {
        kind: 'already-running',
        sessionId: 's',
        cliKind: 'claude',
        claudeSessionId: '11111111-1111-4111-8111-111111111111'
      },
      false
    ]
  ])('%s → %s', (_name, result, expected) => {
    expect(isAgentStartCanceled(result)).toBe(expected)
  })
})

describe('AGENT_EXIT_REASONS / isAgentExitReason', () => {
  it('終了理由は exited・stopped・folder-changed の 3 つ', () => {
    expect(AGENT_EXIT_REASONS).toEqual(['exited', 'stopped', 'folder-changed'])
  })

  it.each([
    ['exited', true],
    ['stopped', true],
    ['folder-changed', true],
    ['', false],
    ['Exited', false],
    ['unknown', false],
    [null, false],
    [undefined, false],
    [1, false]
  ])('%s → %s', (value, expected) => {
    expect(isAgentExitReason(value)).toBe(expected)
  })
})

describe('isClaudeSessionId', () => {
  it.each([
    '11111111-1111-4111-8111-111111111111',
    'abcdef01-2345-4678-9abc-def012345678',
    '00000000-0000-4000-b000-000000000000'
  ])('小文字の UUID v4 は通す: %s', (value) => {
    expect(isClaudeSessionId(value)).toBe(true)
    expect(CLAUDE_SESSION_ID_PATTERN.test(value)).toBe(true)
  })

  it.each([
    ['大文字', 'ABCDEF01-2345-4678-9ABC-DEF012345678'],
    ['v4 以外(版の桁が 1)', '11111111-1111-1111-8111-111111111111'],
    ['異形(variant の桁が c)', '11111111-1111-4111-c111-111111111111'],
    ['- 始まり(オプションとして解釈される)', '--dangerously-skip-permissions'],
    ['- 始まりの UUID の形', '-1111111-1111-4111-8111-111111111111'],
    ['前後の空白', ' 11111111-1111-4111-8111-111111111111'],
    ['末尾の改行', '11111111-1111-4111-8111-111111111111\n'],
    ['空', ''],
    ['文字列以外', 1],
    ['null', null]
  ])('%s は通さない', (_label, value) => {
    expect(isClaudeSessionId(value)).toBe(false)
  })
})
