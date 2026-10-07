import { describe, it, expect } from 'vitest'
import {
  AGENT_CHANGES_PATCH_MAX_LENGTH,
  parseAgentChangePatch,
  parseAgentChangePath,
  parseAgentRevertAllEntries
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
