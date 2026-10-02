import { describe, it, expect } from 'vitest'
import { validateTagMessage, validateTagName } from '../tagValidation'

describe('validateTagName', () => {
  it.each([
    ['', '名前を入力してください'],
    ['-x', '`-` で始まる名前は使用できません'],
    ['HEAD', 'この名前は使用できません'],
    ['head', 'この名前は使用できません'],
    ['@', 'この名前は使用できません']
  ])('規則に違反する %j は「%s」', (name, expected) => {
    expect(validateTagName(name, [], ['main'])).toBe(expected)
  })

  it('既存のタグと同名なら拒否する', () => {
    expect(validateTagName('v1', ['v1'], ['main'])).toBe('同じ名前のタグが既に存在します')
  })

  it('既存のタグと階層が衝突する名前は拒否する(両方の向き)', () => {
    expect(validateTagName('v1/x', ['v1'], [])).toBe('既存のタグ v1 と名前が衝突します')
    expect(validateTagName('v1', ['v1/x'], [])).toBe('既存のタグ v1/x と名前が衝突します')
  })

  // main と同じく大文字小文字を無視する(getTagNameCollision。「設計書との差分」5)
  it('大文字小文字だけが違う既存のタグ・階層の衝突も拒否する', () => {
    expect(validateTagName('V1', ['v1'], [])).toBe('既存のタグ v1 と名前が衝突します')
    expect(validateTagName('V1/x', ['v1'], [])).toBe('既存のタグ v1 と名前が衝突します')
    expect(validateTagName('V10', ['v1'], [])).toBeNull()
  })

  // タグの衝突とブランチ同名の両方に当たる名前は、タグとの衝突の文言を優先する
  it('タグ衝突とブランチ同名の両方に当たるときは、タグとの衝突を先に報告する', () => {
    expect(validateTagName('V1', ['v1'], ['v1'])).toBe('既存のタグ v1 と名前が衝突します')
  })

  it.each(['main', 'Main', 'MAIN'])(
    'ブランチ main と同名(大文字小文字を無視)の %s は拒否する',
    (name) => {
      expect(validateTagName(name, [], ['main'])).toBe(
        '同じ名前のブランチが存在するため、タグを作成できません'
      )
    }
  )

  // 規則違反(@shared/tagName)は重複より先に判定する
  it('規則違反の名前は、既存のタグと一致していても規則違反の文言を返す', () => {
    expect(validateTagName('@', ['@'], [])).toBe('この名前は使用できません')
  })

  // それ以外の形式(`..` 等)は main 側の check-ref-format に委ねる
  it('それ以外は null(通過)', () => {
    expect(validateTagName('v1.0.0', ['v1'], ['main'])).toBeNull()
    expect(validateTagName('a..b', [], [])).toBeNull()
    expect(validateTagName('mainline', [], ['main'])).toBeNull()
  })
})

// 'é' の NFC(1 文字)と NFD(e + 結合文字)
const NFC_E = '\u00e9'
const NFD_E = 'e\u0301'

// main と同じ normalizeTagName(前後の空白を除き NFC)を通してから検証する
describe('validateTagName の名前の正規化', () => {
  it('NFD の入力は NFC の既存タグと同名として拒否する', () => {
    expect(validateTagName(NFD_E, [NFC_E], [])).toBe('同じ名前のタグが既に存在します')
  })

  it('NFC の入力は NFD の既存タグと同名として拒否する', () => {
    expect(validateTagName(NFC_E, [NFD_E], [])).toBe('同じ名前のタグが既に存在します')
  })

  it('NFD の入力は NFC のブランチと同名として拒否する', () => {
    expect(validateTagName(NFD_E, [], [NFC_E])).toBe(
      '同じ名前のブランチが存在するため、タグを作成できません'
    )
  })

  it('前後の空白を除いてから検証する', () => {
    expect(validateTagName('   ', [], [])).toBe('名前を入力してください')
    expect(validateTagName('  -x', [], [])).toBe('`-` で始まる名前は使用できません')
    expect(validateTagName(` ${NFD_E} `, [NFC_E], [])).toBe('同じ名前のタグが既に存在します')
  })

  it('衝突が無ければ NFD の入力も通す', () => {
    expect(validateTagName(NFD_E, ['v1'], ['main'])).toBeNull()
  })
})

describe('validateTagMessage', () => {
  it('軽量タグはメッセージを見ない', () => {
    expect(validateTagMessage('lightweight', '')).toBeNull()
    expect(validateTagMessage('lightweight', 'a\0b')).toBeNull()
  })

  it.each(['', '   ', '\n\t'])(
    '注釈付きで空白だけ(%j)は「メッセージを入力してください」',
    (message) => {
      expect(validateTagMessage('annotated', message)).toBe('メッセージを入力してください')
    }
  )

  it('注釈付きで NUL を含むと拒否する', () => {
    expect(validateTagMessage('annotated', 'a\0b')).toBe(
      'メッセージに使用できない文字が含まれています'
    )
  })

  it('注釈付きで本文があれば null', () => {
    expect(validateTagMessage('annotated', '-x リリース')).toBeNull()
  })
})
