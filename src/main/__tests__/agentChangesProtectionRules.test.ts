import { describe, it, expect, vi } from 'vitest'
import {
  classifyProtectionReread,
  createProtectionInstanceId,
  isObjectId,
  isSweepCandidate,
  parseProtectionRefName,
  protectionRefName,
  protectionRefWriteOf
} from '../agentChangesProtectionRules'
import type { ProtectionRefListing } from '../agentChangesProtectionRules'

// 保護の ref の規則(git を実行せずに検査する)

const T1 = 'a'.repeat(40)
const T2 = 'b'.repeat(40)

describe('ref の名前', () => {
  it('instanceId は <pid>-<16 進>、名前は接頭辞/instanceId/番号', () => {
    expect(createProtectionInstanceId(123, '0a1b2c3d')).toBe('123-0a1b2c3d')
    expect(protectionRefName('123-0a1b2c3d', 4)).toBe(
      'refs/prompt-ide/agent-changes/123-0a1b2c3d/4'
    )
  })

  it('自分の形の名前だけを解釈する', () => {
    expect(parseProtectionRefName('refs/prompt-ide/agent-changes/123-0a1b2c3d/4')).toEqual({
      pid: 123,
      instanceId: '123-0a1b2c3d',
      recordSerial: 4
    })
  })

  it.each([
    'refs/prompt-ide/agent-changes/foo/1',
    'refs/prompt-ide/agent-changes/123-0A1B2C3D/1',
    'refs/prompt-ide/agent-changes/123-0a1b2c3/1',
    'refs/prompt-ide/agent-changes/123-0a1b2c3d/01',
    'refs/prompt-ide/agent-changes/123-0a1b2c3d/0',
    'refs/prompt-ide/agent-changes/0123-0a1b2c3d/1',
    'refs/prompt-ide/agent-changes/123-0a1b2c3d/1/x',
    'refs/heads/main'
  ])('形の違う名前 %s は null', (name) => {
    expect(parseProtectionRefName(name)).toBeNull()
  })
})

describe('isObjectId', () => {
  it.each([
    ['SHA-1 の 40 桁', 'a'.repeat(40), true],
    ['SHA-256 の 64 桁', '0123456789abcdef'.repeat(4), true],
    ['大文字', 'A'.repeat(40), false],
    ['桁の数が違う', 'a'.repeat(41), false],
    ['16 進でない', 'g'.repeat(40), false],
    ['空', '', false]
  ] as const)('%s → %s', (_label, value, expected) => {
    expect(isObjectId(value)).toBe(expected)
  })
})

describe('isSweepCandidate', () => {
  const own = '100-0a1b2c3d'
  const other = '200-deadbeef'
  const listing = (refName: string, value = T1, objectType = 'tree'): ProtectionRefListing => ({
    refName,
    value,
    objectType
  })
  const alive = (): boolean => true
  const dead = (): boolean => false

  it('自分のインスタンスは残す番号に無いものだけ', () => {
    const keep = new Set([1])
    expect(isSweepCandidate(listing(protectionRefName(own, 1)), own, keep, dead)).toBe(false)
    expect(isSweepCandidate(listing(protectionRefName(own, 2)), own, keep, alive)).toBe(true)
  })

  it('別のインスタンスはその pid のプロセスが無いものだけ(pid を渡して確かめる)', () => {
    const isAlive = vi.fn((pid: number) => pid !== 200)
    expect(isSweepCandidate(listing(protectionRefName(other, 1)), own, new Set(), isAlive)).toBe(
      true
    )
    expect(isAlive).toHaveBeenCalledWith(200)
    expect(isSweepCandidate(listing(protectionRefName(other, 1)), own, new Set(), alive)).toBe(
      false
    )
  })

  it('形の違う名前・tree でない種類・object の ID の形でない値は候補にしない', () => {
    expect(isSweepCandidate(listing('refs/heads/main'), own, new Set(), dead)).toBe(false)
    expect(
      isSweepCandidate(listing(protectionRefName(other, 1), T1, 'commit'), own, new Set(), dead)
    ).toBe(false)
    expect(
      isSweepCandidate(listing(protectionRefName(other, 1), 'xyz'), own, new Set(), dead)
    ).toBe(false)
  })
})

describe('protectionRefWriteOf', () => {
  it.each([
    [null, null, { kind: 'none' }],
    [T1, T1, { kind: 'none' }],
    [null, T1, { kind: 'create', value: T1 }],
    [T1, null, { kind: 'remove', expected: T1 }],
    [T1, T2, { kind: 'update', value: T2, expected: T1 }]
  ] as const)('前に書いた値 %s・あるべき値 %s → %j', (written, desired, expected) => {
    expect(protectionRefWriteOf(written, desired)).toEqual(expected)
  })
})

describe('classifyProtectionReread', () => {
  it.each([
    // 書けていた(作る・更新・消す)
    [T2, T2, null, 'applied'],
    [T2, T2, T1, 'applied'],
    [null, null, T1, 'applied'],
    // 前に書いた値のまま(作るときは「無い」まま)
    [T1, T2, T1, 'retry'],
    [null, T2, null, 'retry'],
    // 利用者が消した・書き換えた
    [null, T2, T1, 'abandoned'],
    ['c'.repeat(40), T2, T1, 'abandoned']
  ] as const)(
    '今の値 %s・あるべき値 %s・前に書いた値 %s → %s',
    (current, desired, written, expected) => {
      expect(classifyProtectionReread(current, desired, written)).toBe(expected)
    }
  )
})
