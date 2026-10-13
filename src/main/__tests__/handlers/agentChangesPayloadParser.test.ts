import { describe, it, expect } from 'vitest'
import {
  AGENT_CHANGES_PATCH_MAX_LENGTH,
  AGENT_CHANGES_REVERT_SCOPE_MESSAGE,
  parseAgentChangePatch,
  parseAgentChangePath,
  parseAgentChangesBeginTrigger,
  parseAgentChangesScope,
  parseAgentChangesUndoId,
  parseAgentRevertAllEntries,
  parseRevertScope
} from '../../handlers/agentChangesPayloadParser'
import { IPC_PATH_MAX_LENGTH } from '../../handlers/payloadValidators'

describe('parseAgentChangePath', () => {
  it('空でない文字列を返す', () => {
    expect(parseAgentChangePath('src/a.ts')).toBe('src/a.ts')
  })
  it.each<[string, unknown]>([
    ['空文字列', ''],
    ['数', 1],
    ['null', null],
    ['配列', ['a']],
    ['オブジェクト', { path: 'a' }]
  ])('%s なら投げる', (_label, value) => {
    expect(() => parseAgentChangePath(value)).toThrow('path は空でない文字列である必要があります')
  })
  it('上限ちょうどは通し、超えたら投げる', () => {
    const path = 'a'.repeat(IPC_PATH_MAX_LENGTH)
    expect(parseAgentChangePath(path)).toBe(path)
    expect(() => parseAgentChangePath(path + 'a')).toThrow()
  })
})

describe('parseAgentChangePatch', () => {
  it('文字列(空を含む)を返す', () => {
    expect(parseAgentChangePatch('')).toBe('')
    expect(parseAgentChangePatch('diff --git a/x b/x\n')).toBe('diff --git a/x b/x\n')
  })
  it('文字列でなければ投げる', () => {
    expect(() => parseAgentChangePatch(undefined)).toThrow('patch は文字列である必要があります')
  })
  it('上限ちょうどは通し、超えたら投げる', () => {
    const patch = 'x'.repeat(AGENT_CHANGES_PATCH_MAX_LENGTH)
    expect(parseAgentChangePatch(patch)).toBe(patch)
    expect(() => parseAgentChangePatch(patch + 'x')).toThrow()
  })
})

describe('parseAgentRevertAllEntries', () => {
  it('{ path, status } に詰め直して返す(余分なキーは落とす)', () => {
    expect(
      parseAgentRevertAllEntries([
        { path: 'a.txt', status: 'M', extra: 1 },
        { path: 'dir/', status: 'A' }
      ])
    ).toEqual([
      { path: 'a.txt', status: 'M' },
      { path: 'dir/', status: 'A' }
    ])
  })
  it('空の配列は通す', () => {
    expect(parseAgentRevertAllEntries([])).toEqual([])
  })
  it.each<[string, unknown]>([
    ['配列でない', { path: 'a', status: 'M' }],
    ['要素が null', [null]],
    ['要素が配列', [['a', 'M']]],
    ['path が空', [{ path: '', status: 'M' }]],
    ['path が文字列でない', [{ path: 1, status: 'M' }]],
    ['status が不正', [{ path: 'a', status: '??' }]],
    ['status が無い', [{ path: 'a' }]]
  ])('%s なら投げる', (_label, value) => {
    expect(() => parseAgentRevertAllEntries(value)).toThrow('確認の一覧が不正です')
  })
  it('500 件は通し、501 件は投げる', () => {
    const entries = Array.from({ length: 500 }, (_, i) => ({ path: `${i}`, status: 'A' }))
    expect(parseAgentRevertAllEntries(entries)).toHaveLength(500)
    expect(() => parseAgentRevertAllEntries([...entries, { path: 'x', status: 'A' }])).toThrow()
  })
})

describe('parseAgentChangesBeginTrigger', () => {
  it.each(['send', 'manual'] as const)('%s を返す', (value) => {
    expect(parseAgentChangesBeginTrigger(value)).toBe(value)
  })
  it.each<[string, unknown]>([
    ['省略(undefined)', undefined],
    ['未知の値', 'auto'],
    ['大文字', 'SEND'],
    ['数', 1],
    ['null', null]
  ])('%s なら投げる(既定に流さない。L-044)', (_label, value) => {
    expect(() => parseAgentChangesBeginTrigger(value)).toThrow(
      'trigger は send か manual である必要があります'
    )
  })
})

describe('parseAgentChangesScope', () => {
  it('累積と実行を返す', () => {
    expect(parseAgentChangesScope({ kind: 'all' })).toEqual({ kind: 'all' })
    expect(parseAgentChangesScope({ kind: 'run', runId: 3 })).toEqual({ kind: 'run', runId: 3 })
    expect(parseAgentChangesScope({ kind: 'run', runId: Number.MAX_SAFE_INTEGER })).toEqual({
      kind: 'run',
      runId: Number.MAX_SAFE_INTEGER
    })
  })
  it.each<[string, unknown]>([
    ['省略(undefined)', undefined],
    ['null', null],
    ['文字列', 'all'],
    ['配列', [{ kind: 'all' }]],
    ['プロトタイプの無いオブジェクト', Object.assign(Object.create(null), { kind: 'all' })],
    ['未知の kind', { kind: 'latest' }],
    ['kind が無い', { runId: 1 }],
    ['all に余分なキー', { kind: 'all', runId: 1 }],
    ['run に余分なキー', { kind: 'run', runId: 1, path: 'x' }],
    ['run に runId が無い', { kind: 'run' }],
    ['runId が 0', { kind: 'run', runId: 0 }],
    ['runId が負', { kind: 'run', runId: -1 }],
    ['runId が小数', { kind: 'run', runId: 1.5 }],
    ['runId が文字列', { kind: 'run', runId: '1' }],
    ['runId が NaN', { kind: 'run', runId: Number.NaN }],
    ['runId が安全でない整数', { kind: 'run', runId: Number.MAX_SAFE_INTEGER + 1 }]
  ])('%s なら投げる', (_label, value) => {
    expect(() => parseAgentChangesScope(value)).toThrow('範囲(scope)が不正です')
  })
})

describe('parseRevertScope', () => {
  it('累積だけを受け付ける', () => {
    expect(parseRevertScope({ kind: 'all' })).toEqual({ kind: 'all' })
  })
  it('実行の範囲は戻せない旨で投げる', () => {
    expect(() => parseRevertScope({ kind: 'run', runId: 1 })).toThrow(
      AGENT_CHANGES_REVERT_SCOPE_MESSAGE
    )
  })
  it('形が不正なら範囲の検証の文言で投げる', () => {
    expect(() => parseRevertScope(undefined)).toThrow('範囲(scope)が不正です')
  })
})

describe('parseAgentChangesUndoId', () => {
  it('1 以上の安全な整数をそのまま返す', () => {
    expect(parseAgentChangesUndoId(1)).toBe(1)
    expect(parseAgentChangesUndoId(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
  })
  it.each([undefined, null, 0, -1, 1.5, '1', Number.NaN, 2 ** 53, Infinity])(
    '%s は例外(省略を既定に流さない。L-044)',
    (value) => {
      expect(() => parseAgentChangesUndoId(value)).toThrow(
        'undoId は 1 以上の整数である必要があります'
      )
    }
  )
})
