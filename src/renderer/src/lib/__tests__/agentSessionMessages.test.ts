import { describe, it, expect } from 'vitest'
import {
  AGENT_START_ERROR_PREFIX,
  AGENT_STOP_ERROR_PREFIX,
  describeAgentStartError,
  describeAgentStatus
} from '../agentSessionMessages'

describe('describeAgentStatus', () => {
  it.each([
    ['none', null, '未起動'],
    ['starting', null, '起動中'],
    ['running', null, '起動中'],
    ['exited', { exitCode: 0, reason: 'exited' }, '終了しました（終了コード 0）'],
    ['exited', { exitCode: null, reason: 'stopped' }, '終了しました'],
    ['exited', null, '終了しました']
  ] as const)('%s・%o → %s', (status, exit, expected) => {
    expect(describeAgentStatus(status, exit)).toBe(expected)
  })
})

describe('起動・終了の失敗の接頭辞', () => {
  it('起動の失敗の接頭辞', () => {
    expect(AGENT_START_ERROR_PREFIX).toBe('エージェントを起動できませんでした: ')
  })

  it('終了の失敗の接頭辞', () => {
    expect(AGENT_STOP_ERROR_PREFIX).toBe('エージェントを終了できませんでした: ')
  })

  it('spawn-failed の文言は起動の失敗の接頭辞に detail を付ける', () => {
    expect(describeAgentStartError({ kind: 'error', error: 'spawn-failed', detail: 'boom' })).toBe(
      `${AGENT_START_ERROR_PREFIX}boom`
    )
  })
})
