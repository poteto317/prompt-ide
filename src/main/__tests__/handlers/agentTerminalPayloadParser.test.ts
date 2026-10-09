import { describe, it, expect } from 'vitest'
import {
  parseAgentResize,
  parseAgentSessionId,
  parseAgentStartRequest,
  parseAgentWrite
} from '../../handlers/agentTerminalPayloadParser'
import { IPC_PATH_MAX_LENGTH } from '../../handlers/payloadValidators'
import { AGENT_SLOT_ID_MAX_LENGTH } from '@shared/types'

describe('parseAgentStartRequest', () => {
  it('slotId・folderPath・cols・rows を返す', () => {
    expect(
      parseAgentStartRequest({ slotId: 'slot-1', folderPath: '/p', cols: 80, rows: 24 })
    ).toEqual({
      slotId: 'slot-1',
      folderPath: '/p',
      cols: 80,
      rows: 24
    })
  })
  it.each([
    ['オブジェクトでない', null],
    ['slotId が空', { slotId: '', folderPath: '/p', cols: 80, rows: 24 }],
    ['slotId が文字列でない', { slotId: 1, folderPath: '/p', cols: 80, rows: 24 }],
    ['slotId に使えない文字がある', { slotId: 'a/b', folderPath: '/p', cols: 80, rows: 24 }],
    [
      'slotId が上限より 1 文字長い',
      { slotId: 'a'.repeat(AGENT_SLOT_ID_MAX_LENGTH + 1), folderPath: '/p', cols: 80, rows: 24 }
    ],
    ['folderPath が空', { slotId: 'slot-1', folderPath: '', cols: 80, rows: 24 }],
    ['folderPath が文字列でない', { slotId: 'slot-1', folderPath: 1, cols: 80, rows: 24 }],
    ['cols が下限未満', { slotId: 'slot-1', folderPath: '/p', cols: 1, rows: 24 }],
    ['cols が上限超え', { slotId: 'slot-1', folderPath: '/p', cols: 501, rows: 24 }],
    ['cols が整数でない', { slotId: 'slot-1', folderPath: '/p', cols: 80.5, rows: 24 }],
    ['rows が下限未満', { slotId: 'slot-1', folderPath: '/p', cols: 80, rows: 0 }],
    ['rows が上限超え', { slotId: 'slot-1', folderPath: '/p', cols: 80, rows: 301 }],
    ['rows が文字列', { slotId: 'slot-1', folderPath: '/p', cols: 80, rows: '24' }]
  ])('%s なら投げる', (_label, payload) => {
    expect(() => parseAgentStartRequest(payload)).toThrow()
  })
  it('folderPath の長さが上限を超えたら投げる(realpath に巨大な文字列を渡さない)', () => {
    const path = '/' + 'a'.repeat(IPC_PATH_MAX_LENGTH - 1)
    expect(() =>
      parseAgentStartRequest({ slotId: 'slot-1', folderPath: path, cols: 80, rows: 24 })
    ).not.toThrow()
    expect(() =>
      parseAgentStartRequest({ slotId: 'slot-1', folderPath: path + 'a', cols: 80, rows: 24 })
    ).toThrow()
  })
  it('配列は投げる', () => {
    expect(() => parseAgentStartRequest([])).toThrow()
  })
  it('境界の値(2・500・1・300)は通す', () => {
    expect(() =>
      parseAgentStartRequest({ slotId: 'slot-1', folderPath: '/p', cols: 2, rows: 1 })
    ).not.toThrow()
    expect(() =>
      parseAgentStartRequest({ slotId: 'slot-1', folderPath: '/p', cols: 500, rows: 300 })
    ).not.toThrow()
  })
})

describe('parseAgentWrite', () => {
  it('文字列の sessionId と 1,000,000 文字以下の data を通す', () => {
    expect(parseAgentWrite('s', 'a'.repeat(1_000_000))).toEqual({
      sessionId: 's',
      data: 'a'.repeat(1_000_000)
    })
  })
  it.each([
    ['sessionId が空', '', 'x'],
    ['sessionId が文字列でない', 1, 'x'],
    ['data が文字列でない', 's', 1],
    ['data が上限超え', 's', 'a'.repeat(1_000_001)],
    ['data が String オブジェクト', 's', new String('x')]
  ])('%s なら null', (_label, sessionId, data) => {
    expect(parseAgentWrite(sessionId, data)).toBeNull()
  })
})

describe('parseAgentResize', () => {
  it('範囲内の整数を通す', () => {
    expect(parseAgentResize('s', 100, 30)).toEqual({ sessionId: 's', cols: 100, rows: 30 })
  })
  it.each([
    ['cols が範囲外', 's', 600, 30],
    ['rows が範囲外', 's', 100, 0],
    ['整数でない', 's', 100.1, 30],
    ['sessionId が無い', undefined, 100, 30],
    ['cols が下限未満', 's', 1, 30],
    ['rows が上限超え', 's', 100, 301],
    ['cols が文字列', 's', '100', 30],
    ['cols が NaN', 's', Number.NaN, 30]
  ])('%s なら null', (_label, sessionId, cols, rows) => {
    expect(parseAgentResize(sessionId, cols, rows)).toBeNull()
  })
})

describe('parseAgentSessionId', () => {
  it('空でない文字列を返し、それ以外は投げる', () => {
    expect(parseAgentSessionId('s')).toBe('s')
    expect(() => parseAgentSessionId('')).toThrow()
    expect(() => parseAgentSessionId(undefined)).toThrow()
    expect(() => parseAgentSessionId(1)).toThrow()
  })
})
