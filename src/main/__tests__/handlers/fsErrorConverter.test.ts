import { describe, it, expect } from 'vitest'
import { convertFsError, convertFsAccessError } from '../../handlers/fsErrorConverter'

// isFsError / isEnoentError の型ガード自体のテストは src/main/__tests__/fsErrors.test.ts にある

function makeErrnoError(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code })
}

describe('convertFsError', () => {
  it('EEXIST のとき「既に存在します」に変換する', () => {
    const result = convertFsError(makeErrnoError('EEXIST'), 'new.ts', '/project/src')
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe('既に存在します: new.ts')
  })

  it('ENOENT のとき「対象が見つかりません」に変換する', () => {
    const result = convertFsError(makeErrnoError('ENOENT'), 'new.ts', '/project/gone')
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe('対象が見つかりません: /project/gone')
  })

  it('その他の fs エラーコードは汎用の日本語メッセージに変換する', () => {
    const result = convertFsError(makeErrnoError('EACCES', 'permission denied'), 'new.ts', '/project/src')
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe('ファイル操作に失敗しました(EACCES): /project/src')
  })

  it('fs エラーでない Error はそのまま返す(アクセス拒否等の自前エラーを壊さない)', () => {
    const original = new Error('Access denied: /outside')
    expect(convertFsError(original, 'new.ts', '/project/src')).toBe(original)
  })

  it('Error でない値もそのまま返す', () => {
    const original = 'not an error'
    expect(convertFsError(original, 'new.ts', '/project/src')).toBe(original)
  })
})

describe('convertFsAccessError', () => {
  it('ENOENT のとき指定した notFoundMessage に変換する', () => {
    const result = convertFsAccessError(
      makeErrnoError('ENOENT'),
      'ファイルが見つかりません: /project/a.ts',
      '/project/a.ts'
    )
    expect((result as Error).message).toBe('ファイルが見つかりません: /project/a.ts')
  })

  it('ENOENT 以外の fs エラーは汎用の日本語メッセージに変換する', () => {
    const result = convertFsAccessError(makeErrnoError('EPERM'), '見つかりません', '/project/a.ts')
    expect((result as Error).message).toBe('ファイル操作に失敗しました(EPERM): /project/a.ts')
  })

  it('fs エラーでない Error はそのまま返す', () => {
    const original = new Error('No folder open')
    expect(convertFsAccessError(original, '見つかりません', '/project/a.ts')).toBe(original)
  })
})
