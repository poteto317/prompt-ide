import { describe, it, expect } from 'vitest'
import { assertValidEntryName } from '../../handlers/entryNameValidator'

describe('assertValidEntryName', () => {
  it('通常のファイル名は許可される', () => {
    expect(() => assertValidEntryName('index.ts')).not.toThrow()
  })

  it('..foo のようなドット始まりの名前は許可される', () => {
    expect(() => assertValidEntryName('..foo')).not.toThrow()
  })

  it('.gitignore のようなドットファイルは許可される', () => {
    expect(() => assertValidEntryName('.gitignore')).not.toThrow()
  })

  it('文字列でないとき例外をスロー', () => {
    expect(() => assertValidEntryName(123)).toThrow('名前は文字列である必要があります')
  })

  it('null のとき例外をスロー', () => {
    expect(() => assertValidEntryName(null)).toThrow('名前は文字列である必要があります')
  })

  it('undefined のとき例外をスロー', () => {
    expect(() => assertValidEntryName(undefined)).toThrow('名前は文字列である必要があります')
  })

  it.each(['', '   ', '.', '..', 'a/b', 'a\\b', ' spaced ', '/etc/passwd'])(
    '無効な名前 %j は拒否される',
    (name) => {
      expect(() => assertValidEntryName(name)).toThrow('無効な名前です')
    }
  )

  it('エラーメッセージに元の名前を含む', () => {
    expect(() => assertValidEntryName('a/b')).toThrow('無効な名前です: a/b')
  })
})
