import { describe, it, expect } from 'vitest'
import {
  AGENT_ADD_TAB_DISABLED_LIMIT,
  AGENT_TOO_MANY_SESSIONS,
  agentCloseTabConfirm,
  describeAgentTabStatus,
  formatAgentTabLabel,
  AGENT_START_ERROR_PREFIX,
  AGENT_STOP_ERROR_PREFIX,
  describeAgentStartError,
  describeAgentStatus
} from '../agentSessionMessages'

describe('describeAgentStatus', () => {
  it.each([
    ['none', null, '未起動'],
    ['starting', null, '起動中'],
    ['running', null, '実行中'],
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

describe('too-many-sessions の文言', () => {
  it('同時に動かせる数を出す', () => {
    expect(describeAgentStartError({ kind: 'error', error: 'too-many-sessions' })).toBe(
      '同時に動かせるエージェントは 4 つまでです'
    )
  })
})

describe('+ を押せない理由の文言', () => {
  it('動いている数ではなくタブの数の上限で、閉じれば追加できることを伝える', () => {
    expect(AGENT_ADD_TAB_DISABLED_LIMIT).toBe(
      'タブは 4 つまでです（使わないタブを閉じると追加できます）'
    )
  })

  it('main が拒否したとき用の文言とは別', () => {
    expect(AGENT_ADD_TAB_DISABLED_LIMIT).not.toBe(AGENT_TOO_MANY_SESSIONS)
  })
})

describe('タブの文言', () => {
  it.each([
    ['none', '未起動'],
    ['starting', '起動中'],
    ['running', '実行中'],
    ['exited', '終了']
  ] as const)('%s → %s', (status, expected) => {
    expect(describeAgentTabStatus(status)).toBe(expected)
  })

  it('ラベルと閉じる確認', () => {
    expect(formatAgentTabLabel(2)).toBe('claude 2')
    expect(agentCloseTabConfirm('claude 2')).toBe(
      'claude 2 のエージェントを終了してタブを閉じますか？'
    )
  })
})
