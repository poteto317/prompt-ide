import { describe, it, expect } from 'vitest'
import { parseGitLogOutput, parseGitLogRefs } from '../gitLogFormatter'

const HASH_1 = 'a'.repeat(40)
const HASH_2 = 'b'.repeat(40)
const HASH_3 = 'c'.repeat(40)
const DATE_1 = '2026-09-03T10:00:00+09:00'
const DATE_2 = '2026-09-02T10:00:00+09:00'

// %H%x1f%P%x1f%D%x1f%B%x1f%aI%x1f%an%x1e の 1 レコード
function record(fields: {
  hash?: string
  parents?: string
  decoration?: string
  body: string
  date?: string
  author?: string
}): string {
  const { hash = HASH_1, parents = '', decoration = '', body } = fields
  const { date = DATE_1, author = 'Alice' } = fields
  return [hash, parents, decoration, body, date, author].join('\x1f') + '\x1e'
}

describe('parseGitLogOutput', () => {
  it('git log --pretty=format 出力(%H%x1f%P%x1f%D%x1f%B%x1f%aI%x1f%an%x1e)をレコード配列にパースする', () => {
    const output =
      record({
        parents: HASH_2,
        decoration: 'HEAD -> refs/heads/main',
        body: 'feat: 新機能'
      }) + record({ hash: HASH_2, body: 'fix: バグ修正', date: DATE_2, author: 'Bob' })
    expect(parseGitLogOutput(output)).toEqual([
      {
        hash: HASH_1,
        parents: [HASH_2],
        refs: [{ kind: 'current', name: 'main' }],
        isHead: true,
        message: 'feat: 新機能',
        date: DATE_1,
        authorName: 'Alice'
      },
      {
        hash: HASH_2,
        parents: [],
        refs: [],
        isHead: false,
        message: 'fix: バグ修正',
        date: DATE_2,
        authorName: 'Bob'
      }
    ])
  })

  it('ルートコミットの parents は空配列(空文字の要素を持たない)', () => {
    expect(parseGitLogOutput(record({ body: 'root' }))[0].parents).toEqual([])
  })

  it('マージコミットの親を、並びを保って全部返す', () => {
    const output = record({ parents: `${HASH_2} ${HASH_3}`, body: 'merge' })
    expect(parseGitLogOutput(output)[0].parents).toEqual([HASH_2, HASH_3])
  })

  it('SHA-256 のリポジトリの 64 桁のハッシュも受け付ける', () => {
    const hash = 'd'.repeat(64)
    expect(parseGitLogOutput(record({ hash, body: 'sha256' }))[0].hash).toBe(hash)
  })

  it('%B で取得した複数行のコミット本文を、内部の改行を保ったまま message として返す', () => {
    const output = record({ body: 'feat: 新機能\n\n詳細な説明文\n2行目' })
    expect(parseGitLogOutput(output)[0].message).toBe('feat: 新機能\n\n詳細な説明文\n2行目')
  })

  it('空のメッセージのコミットを読み飛ばさず、message を空文字で返す', () => {
    const [entry] = parseGitLogOutput(record({ body: '' }))
    expect(entry).toMatchObject({ hash: HASH_1, message: '', date: DATE_1 })
  })

  it('実際の git log 出力どおり、レコード間に挟まる改行(\\x1e の直後の \\n)を除去しつつ、著者名末尾の意図的な空白は保つ', () => {
    // 実機の `git log --pretty=format:'...%x1e'` は、レコード区切り(\x1e)の
    // 直後に \n が入る(次のレコードの前に付く改行で、\x1e 自体は改行を含まない)。
    // この \n を取り除くために record 全体へ .trim() を使うと、`git config
    // user.name "Alice "` のような末尾に意図的な空白を持つ著者名(git 上は
    // 有効な設定)まで一緒に削られてしまう。先頭の改行だけを取り除く必要がある
    const output =
      record({ body: 'feat: 新機能', author: 'Alice ' }) +
      '\n' +
      record({ hash: HASH_2, body: 'fix: バグ修正', author: 'Bob' })
    const result = parseGitLogOutput(output)
    expect(result[0].authorName).toBe('Alice ')
    expect(result[1].hash).toBe(HASH_2)
  })

  it('空文字列の場合、空配列を返す', () => {
    expect(parseGitLogOutput('')).toEqual([])
  })

  it('メッセージ本文に U+001F(フィールド区切り)が含まれても、日時・著者がずれない', () => {
    // 区切り文字がメッセージに混ざるとフィールド数が 6 を超える。
    // 単純な分割代入だと message が区切り位置で切り詰められ、date にメッセージの
    // 続き、authorName に日時が入る。結果として日付欄が消え、著者名も誤った値に
    // なり、その状態で amend すると切り詰められたメッセージがプリフィルされる。
    // 余剰フィールドはメッセージ本文の一部として復元する
    const output = record({ parents: HASH_2, decoration: 'tag: refs/tags/v1', body: 'A\x1fB' })
    expect(parseGitLogOutput(output)).toEqual([
      {
        hash: HASH_1,
        parents: [HASH_2],
        refs: [{ kind: 'tag', name: 'v1' }],
        isHead: false,
        message: 'A\x1fB',
        date: DATE_1,
        authorName: 'Alice'
      }
    ])
  })

  it('フィールド数がたまたま足りた壊れたレコードは、date が日時形式でないことを手がかりに読み飛ばす', () => {
    // %B(メッセージ本文)に U+001E が1箇所・U+001F が複数箇所含まれると、
    // \x1e 分割後の断片が \x1f 分割で偶然 6 フィールドになり、
    // フィールド数のチェックをすり抜けてしまう。
    // 本来のメッセージが "x\x1fy\x1fz\x1ew" である場合、\x1e 分割で
    // [HASH, 親, 装飾, "x", "y", "z"] という 6 フィールドの断片が生まれる。
    // date(%aI は常に ISO 8601 形式)が日時として解釈できないことを手がかりに、
    // このような壊れた断片を読み飛ばす
    const output = record({ body: 'x\x1fy\x1fz\x1ew' })
    expect(parseGitLogOutput(output)).toEqual([])
  })

  it('本文の \\x1e より後ろの断片が 6 フィールド以上でも、hash の形式の検査で読み飛ばす', () => {
    // 本文が "x\x1ep\x1fq\x1fr\x1fs" だと、\x1e より後ろの断片は
    // ["p", "q", "r", "s", DATE, AUTHOR] になり、末尾の日時は正しい形式のまま残る。
    // date の検査だけでは「p」をハッシュとするコミットが履歴に紛れ込む
    const output = record({ body: 'x\x1ep\x1fq\x1fr\x1fs' })
    expect(parseGitLogOutput(output)).toEqual([])
  })

  it('フィールドが足りない不正なレコードは、例外を投げずに読み飛ばす', () => {
    // コミットメッセージ本文に U+001E(レコード区切り)が含まれると、そこで
    // レコード境界が割れてフィールド数の足りない断片が生まれる。そのまま
    // rawMessage.trim() を呼ぶと TypeError になり、getLog 全体が throw して
    // 履歴パネルが「Cannot read properties of undefined」で表示不能になる
    // (HistorySection の entry.message.split('\n') も同様に落ちる)
    const output =
      record({ body: 'message1' }) +
      'broken-record-without-fields\x1e' +
      `${HASH_3}\x1f\x1fDATE\x1e` +
      record({ hash: HASH_2, body: 'message2' })
    expect(parseGitLogOutput(output).map((entry) => entry.hash)).toEqual([HASH_1, HASH_2])
  })
})

describe('parseGitLogRefs', () => {
  it('装飾が空なら ref なし・HEAD でない', () => {
    expect(parseGitLogRefs('')).toEqual({ refs: [], isHead: false })
  })

  it('HEAD -> refs/heads/x は現在のブランチ', () => {
    expect(parseGitLogRefs('HEAD -> refs/heads/feature/x')).toEqual({
      refs: [{ kind: 'current', name: 'feature/x' }],
      isHead: true
    })
  })

  it('単独の HEAD は detached の印で、ref には入らない', () => {
    expect(parseGitLogRefs('HEAD, refs/heads/main')).toEqual({
      refs: [{ kind: 'branch', name: 'main' }],
      isHead: true
    })
  })

  it('ローカルのブランチ・リモート・タグを種類ごとに短い名前にし、順を保つ', () => {
    const decoration =
      'HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1, refs/heads/foo/bar'
    expect(parseGitLogRefs(decoration)).toEqual({
      refs: [
        { kind: 'current', name: 'main' },
        { kind: 'remote', name: 'origin/main' },
        { kind: 'tag', name: 'v1' },
        { kind: 'branch', name: 'foo/bar' }
      ],
      isHead: true
    })
  })

  it('リモートの */HEAD は出さない', () => {
    expect(parseGitLogRefs('refs/remotes/origin/HEAD, refs/remotes/origin/main')).toEqual({
      refs: [{ kind: 'remote', name: 'origin/main' }],
      isHead: false
    })
  })

  it('ローカルのブランチ名が HEAD で終わっていても除かない', () => {
    expect(parseGitLogRefs('refs/heads/foo/HEAD').refs).toEqual([
      { kind: 'branch', name: 'foo/HEAD' }
    ])
  })

  it('どの種類にも当てはまらない装飾(浅い clone の grafted など)は無視する', () => {
    expect(parseGitLogRefs('grafted, refs/notes/commits, refs/stash')).toEqual({
      refs: [],
      isHead: false
    })
  })
})
