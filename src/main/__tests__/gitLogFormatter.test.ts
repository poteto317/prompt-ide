import { describe, it, expect } from 'vitest'
import { parseGitLogOutput } from '../gitLogFormatter'

describe('parseGitLogOutput', () => {
  it('git log --pretty=format 出力(%H%x1f%B%x1f%aI%x1f%an%x1e)をレコード配列にパースする', () => {
    const output =
      'abc123\x1ffeat: 新機能\x1f2026-09-03T10:00:00+09:00\x1fAlice\x1e' +
      'def456\x1ffix: バグ修正\x1f2026-09-02T10:00:00+09:00\x1fBob\x1e'
    expect(parseGitLogOutput(output)).toEqual([
      {
        hash: 'abc123',
        message: 'feat: 新機能',
        date: '2026-09-03T10:00:00+09:00',
        authorName: 'Alice'
      },
      {
        hash: 'def456',
        message: 'fix: バグ修正',
        date: '2026-09-02T10:00:00+09:00',
        authorName: 'Bob'
      }
    ])
  })

  it('%B で取得した複数行のコミット本文を、内部の改行を保ったまま message として返す', () => {
    const output =
      'abc123\x1ffeat: 新機能\n\n詳細な説明文\n2行目\x1f2026-09-03T10:00:00+09:00\x1fAlice\x1e'
    expect(parseGitLogOutput(output)).toEqual([
      {
        hash: 'abc123',
        message: 'feat: 新機能\n\n詳細な説明文\n2行目',
        date: '2026-09-03T10:00:00+09:00',
        authorName: 'Alice'
      }
    ])
  })

  it('実際の git log 出力どおり、レコード間に挟まる改行(\\x1e の直後の \\n)を除去しつつ、著者名末尾の意図的な空白は保つ', () => {
    // 実機の `git log --pretty=format:'...%x1e'` は、レコード区切り(\x1e)の
    // 直後に \n が入る(次のレコードの前に付く改行で、\x1e 自体は改行を含まない)。
    // この \n を取り除くために record 全体へ .trim() を使うと、`git config
    // user.name "Alice "` のような末尾に意図的な空白を持つ著者名(git 上は
    // 有効な設定)まで一緒に削られてしまう。先頭の改行だけを取り除く必要がある
    const output =
      'abc123\x1ffeat: 新機能\x1f2026-09-03T10:00:00+09:00\x1fAlice \x1e' +
      '\ndef456\x1ffix: バグ修正\x1f2026-09-02T10:00:00+09:00\x1fBob\x1e'
    const result = parseGitLogOutput(output)
    expect(result[0].authorName).toBe('Alice ')
    expect(result[1].hash).toBe('def456')
  })

  it('空文字列の場合、空配列を返す', () => {
    expect(parseGitLogOutput('')).toEqual([])
  })

  it('メッセージ本文に U+001F(フィールド区切り)が含まれても、日時・著者がずれない', () => {
    // 区切り文字がメッセージに混ざると fields.length > 4 になる。
    // 単純な分割代入だと message が区切り位置で切り詰められ、date にメッセージの
    // 続き、authorName に日時が入る。結果として日付欄が消え、著者名も誤った値に
    // なり、その状態で amend すると切り詰められたメッセージがプリフィルされる。
    // 余剰フィールドはメッセージ本文の一部として復元する
    const output = 'hash1\x1ffeat: A\x1fB\x1f2026-01-01T00:00:00Z\x1fauthor1\x1e'
    expect(parseGitLogOutput(output)).toEqual([
      {
        hash: 'hash1',
        message: 'feat: A\x1fB',
        date: '2026-01-01T00:00:00Z',
        authorName: 'author1'
      }
    ])
  })

  it('フィールド数がたまたま4になった壊れたレコードは、date が日時形式でないことを手がかりに読み飛ばす', () => {
    // %B(メッセージ本文)に U+001E が1箇所・U+001F が複数箇所含まれると、
    // \x1e 分割後の断片が \x1f 分割で偶然 4 フィールドになり、
    // 「フィールド数 >= 4」だけのチェックをすり抜けてしまう。
    // 例: 本来 "HASH1" のメッセージが "x\x1fy\x1fz\x1ew" である場合、
    // \x1e 分割で "HASH1\x1fx\x1fy\x1fz" という断片が生まれ、\x1f 分割すると
    // ["HASH1","x","y","z"] の 4 フィールドになってしまう。
    // date(%aI は常に ISO 8601 形式)が日時として解釈できないことを手がかりに、
    // このような壊れた断片を読み飛ばす
    // \x1e がメッセージ内に1つ・末尾に1つの計2つあるため、\x1e 分割で
    // レコードが2つに割れる: ["HASH1\x1fx\x1fy\x1fz", "w\x1fDATE1\x1fAUTHOR1"]。
    // 前者が \x1f 分割で ["HASH1","x","y","z"] という 4 フィールドになり、
    // 「フィールド数 >= 4」だけのチェックをすり抜けてしまう
    const output = 'HASH1\x1fx\x1fy\x1fz\x1ew\x1fDATE1\x1fAUTHOR1\x1e'
    const result = parseGitLogOutput(output)
    expect(result).toEqual([])
  })

  it('フィールドが足りない不正なレコードは、例外を投げずに読み飛ばす', () => {
    // コミットメッセージ本文に U+001E(レコード区切り)が含まれると、そこで
    // レコード境界が割れてフィールド数の足りない断片が生まれる。そのまま
    // rawMessage.trim() を呼ぶと TypeError になり、getLog 全体が throw して
    // 履歴パネルが「Cannot read properties of undefined」で表示不能になる
    // (HistorySection の entry.message.split('\n') も同様に落ちる)
    const output =
      'hash1\x1fmessage1\x1f2026-01-01T00:00:00Z\x1fauthor1\x1e' +
      'broken-record-without-fields\x1e' +
      'hash2\x1fmessage2\x1f2026-01-02T00:00:00Z\x1fauthor2\x1e'
    const result = parseGitLogOutput(output)
    expect(result).toEqual([
      { hash: 'hash1', message: 'message1', date: '2026-01-01T00:00:00Z', authorName: 'author1' },
      { hash: 'hash2', message: 'message2', date: '2026-01-02T00:00:00Z', authorName: 'author2' }
    ])
  })
})
