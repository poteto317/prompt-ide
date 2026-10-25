import { describe, it, expect } from 'vitest'
import {
  parseAgentCliKind,
  parseAgentFolderPath,
  parseAgentLaunchRequest,
  parseAgentResize,
  parseAgentSessionId,
  parseAgentStartRequest,
  parseAgentWrite
} from '../../handlers/agentTerminalPayloadParser'
import { IPC_PATH_MAX_LENGTH } from '../../handlers/payloadValidators'
import { AGENT_SLOT_ID_MAX_LENGTH } from '@shared/types'

const NEW = { kind: 'new' } as const
const ID = '11111111-1111-4111-8111-111111111111'

describe('parseAgentStartRequest', () => {
  it('slotId・folderPath・cols・rows・launch を返す', () => {
    expect(
      parseAgentStartRequest({
        slotId: 'slot-1',
        folderPath: '/p',
        cols: 80,
        rows: 24,
        launch: NEW
      })
    ).toEqual({
      slotId: 'slot-1',
      folderPath: '/p',
      cols: 80,
      rows: 24,
      launch: { kind: 'new' }
    })
  })
  it.each([
    ['オブジェクトでない', null],
    ['slotId が空', { slotId: '', folderPath: '/p', cols: 80, rows: 24, launch: NEW }],
    ['slotId が文字列でない', { slotId: 1, folderPath: '/p', cols: 80, rows: 24, launch: NEW }],
    [
      'slotId に使えない文字がある',
      { slotId: 'a/b', folderPath: '/p', cols: 80, rows: 24, launch: NEW }
    ],
    [
      'slotId が上限より 1 文字長い',
      {
        slotId: 'a'.repeat(AGENT_SLOT_ID_MAX_LENGTH + 1),
        folderPath: '/p',
        cols: 80,
        rows: 24,
        launch: NEW
      }
    ],
    ['folderPath が空', { slotId: 'slot-1', folderPath: '', cols: 80, rows: 24, launch: NEW }],
    [
      'folderPath が文字列でない',
      { slotId: 'slot-1', folderPath: 1, cols: 80, rows: 24, launch: NEW }
    ],
    ['cols が下限未満', { slotId: 'slot-1', folderPath: '/p', cols: 1, rows: 24, launch: NEW }],
    ['cols が上限超え', { slotId: 'slot-1', folderPath: '/p', cols: 501, rows: 24, launch: NEW }],
    [
      'cols が整数でない',
      { slotId: 'slot-1', folderPath: '/p', cols: 80.5, rows: 24, launch: NEW }
    ],
    ['rows が下限未満', { slotId: 'slot-1', folderPath: '/p', cols: 80, rows: 0, launch: NEW }],
    ['rows が上限超え', { slotId: 'slot-1', folderPath: '/p', cols: 80, rows: 301, launch: NEW }],
    ['rows が文字列', { slotId: 'slot-1', folderPath: '/p', cols: 80, rows: '24', launch: NEW }]
  ])('%s なら投げる', (_label, payload) => {
    expect(() => parseAgentStartRequest(payload)).toThrow()
  })
  it('folderPath の長さが上限を超えたら投げる(realpath に巨大な文字列を渡さない)', () => {
    const path = '/' + 'a'.repeat(IPC_PATH_MAX_LENGTH - 1)
    expect(() =>
      parseAgentStartRequest({
        slotId: 'slot-1',
        folderPath: path,
        cols: 80,
        rows: 24,
        launch: NEW
      })
    ).not.toThrow()
    expect(() =>
      parseAgentStartRequest({
        slotId: 'slot-1',
        folderPath: path + 'a',
        cols: 80,
        rows: 24,
        launch: NEW
      })
    ).toThrow()
  })
  it('配列は投げる', () => {
    expect(() => parseAgentStartRequest([])).toThrow()
  })
  it('境界の値(2・500・1・300)は通す', () => {
    expect(() =>
      parseAgentStartRequest({ slotId: 'slot-1', folderPath: '/p', cols: 2, rows: 1, launch: NEW })
    ).not.toThrow()
    expect(() =>
      parseAgentStartRequest({
        slotId: 'slot-1',
        folderPath: '/p',
        cols: 500,
        rows: 300,
        launch: NEW
      })
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

describe('parseAgentLaunchRequest', () => {
  it('new と、小文字の UUID v4 の resume を返す(余分なものを持たない新しいオブジェクト)', () => {
    expect(parseAgentLaunchRequest({ kind: 'new' })).toEqual({ kind: 'new' })
    expect(
      parseAgentLaunchRequest({ kind: 'resume', claudeSessionId: ID, cliKind: 'claude' })
    ).toEqual({
      kind: 'resume',
      claudeSessionId: ID,
      cliKind: 'claude'
    })
    expect(
      parseAgentLaunchRequest({ kind: 'resume', claudeSessionId: ID, cliKind: 'copilot' })
    ).toEqual({ kind: 'resume', claudeSessionId: ID, cliKind: 'copilot' })
  })

  it.each([
    ['無い(undefined)', undefined],
    ['null', null],
    ['文字列', 'new'],
    ['配列', [{ kind: 'new' }]],
    ['kind が無い', {}],
    ['未知の kind', { kind: 'continue' }],
    ['new に余分なキー', { kind: 'new', claudeSessionId: ID }],
    ['resume に余分なキー', { kind: 'resume', claudeSessionId: ID, cliKind: 'claude', fork: true }],
    ['resume の ID が無い', { kind: 'resume', cliKind: 'claude' }],
    ['resume の ID が文字列でない', { kind: 'resume', claudeSessionId: 1, cliKind: 'claude' }],
    // ID は数字だけで大文字にしても変わらないため、英字を含む ID で確かめる
    [
      'resume の ID が大文字',
      {
        kind: 'resume',
        claudeSessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase(),
        cliKind: 'claude'
      }
    ],
    [
      'resume の ID が v4 以外',
      { kind: 'resume', claudeSessionId: '11111111-1111-1111-8111-111111111111', cliKind: 'claude' }
    ],
    [
      'resume の ID が - 始まり',
      { kind: 'resume', claudeSessionId: '--dangerously-skip-permissions', cliKind: 'claude' }
    ],
    ['resume の cliKind が無い', { kind: 'resume', claudeSessionId: ID }],
    ['resume の cliKind が知らない値', { kind: 'resume', claudeSessionId: ID, cliKind: 'gemini' }],
    ['resume の cliKind が大文字', { kind: 'resume', claudeSessionId: ID, cliKind: 'Claude' }],
    ['resume の cliKind が文字列でない', { kind: 'resume', claudeSessionId: ID, cliKind: 1 }]
  ])('%s なら投げる(既定の new に流さない。L-034・L-044)', (_label, value) => {
    expect(() => parseAgentLaunchRequest(value)).toThrow()
  })
})

describe('parseAgentStartRequest: launch', () => {
  it('検証を通った launch を返す', () => {
    expect(
      parseAgentStartRequest({
        slotId: 'slot-1',
        folderPath: '/p',
        cols: 80,
        rows: 24,
        launch: { kind: 'resume', claudeSessionId: ID, cliKind: 'claude' }
      }).launch
    ).toEqual({ kind: 'resume', claudeSessionId: ID, cliKind: 'claude' })
  })

  it('launch が無い・不正なら投げる', () => {
    expect(() =>
      parseAgentStartRequest({ slotId: 'slot-1', folderPath: '/p', cols: 80, rows: 24 })
    ).toThrow()
    expect(() =>
      parseAgentStartRequest({
        slotId: 'slot-1',
        folderPath: '/p',
        cols: 80,
        rows: 24,
        launch: { kind: 'resume', claudeSessionId: 'x', cliKind: 'claude' }
      })
    ).toThrow()
  })
})

describe('parseAgentFolderPath', () => {
  it('空でない文字列を返し、空・文字列以外・上限を超える長さは投げる', () => {
    expect(parseAgentFolderPath('/p')).toBe('/p')
    expect(() => parseAgentFolderPath('')).toThrow()
    expect(() => parseAgentFolderPath(1)).toThrow()
    expect(() => parseAgentFolderPath('/' + 'a'.repeat(IPC_PATH_MAX_LENGTH))).toThrow()
  })
})

describe('parseAgentCliKind', () => {
  it('claude・copilot はその値を返す', () => {
    expect(parseAgentCliKind('claude')).toBe('claude')
    expect(parseAgentCliKind('copilot')).toBe('copilot')
  })

  it.each<[string, unknown]>([
    ['無い', undefined],
    ['null', null],
    ['知らない値', 'gemini'],
    ['大文字', 'Copilot'],
    ['文字列でない', 1]
  ])('%s なら投げる(既定の claude に流さない。L-044)', (_label, value) => {
    expect(() => parseAgentCliKind(value)).toThrow()
  })
})
