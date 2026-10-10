import { describe, it, expect } from 'vitest'
import {
  assertPlainObject,
  assertRequestId,
  IPC_PATH_MAX_LENGTH,
  isIntegerInRange
} from '../../handlers/payloadValidators'

describe('assertPlainObject', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['数値', 123],
    ['文字列', 'text'],
    ['配列', [1, 2]]
  ])('%s のとき「引数はオブジェクトである必要があります」を投げる', (_label, value) => {
    expect(() => assertPlainObject(value)).toThrow('引数はオブジェクトである必要があります')
  })

  it('プレーンオブジェクトのとき何も投げない', () => {
    expect(() => assertPlainObject({ requestId: 'r-1' })).not.toThrow()
  })

  it('空オブジェクトも許可する(個別フィールドの検証は呼び出し側の責務)', () => {
    expect(() => assertPlainObject({})).not.toThrow()
  })
})

describe('assertRequestId', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['数値', 123],
    ['空文字列', ''],
    ['空白のみ', '   ']
  ])('%s のとき「requestId は空でない文字列である必要があります」を投げる', (_label, value) => {
    expect(() => assertRequestId(value)).toThrow('requestId は空でない文字列である必要があります')
  })

  it('空でない文字列のとき何も投げない', () => {
    expect(() => assertRequestId('req-uuid-1')).not.toThrow()
  })
})

describe('IPC_PATH_MAX_LENGTH', () => {
  it('Windows の長いパスの上限(32,767)に合わせる', () => {
    expect(IPC_PATH_MAX_LENGTH).toBe(32_767)
  })
})

describe('isIntegerInRange', () => {
  it.each([
    [0, true],
    [4, true],
    [2, true],
    [-1, false],
    [5, false],
    [1.5, false],
    ['1', false],
    [Number.NaN, false],
    [null, false]
  ])('%s は 0〜4 の整数か: %s', (value, expected) => {
    expect(isIntegerInRange(value, 0, 4)).toBe(expected)
  })
})
