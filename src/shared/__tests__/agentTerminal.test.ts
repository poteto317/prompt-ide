import { describe, it, expect } from 'vitest'
import {
  AGENT_EXIT_REASONS,
  AGENT_START_CANCELED_DETAIL,
  agentStartCanceled,
  isAgentExitReason,
  isAgentStartCanceled
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
    ['起動の成功', { kind: 'started', sessionId: 's' }, false],
    ['起動済み', { kind: 'already-running', sessionId: 's' }, false]
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
