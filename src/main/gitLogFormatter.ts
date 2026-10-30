import type { GitLogEntry, GitLogRef } from '@shared/types'

// %aI(strict ISO 8601)の形式。日時として解釈できるかどうかを、壊れたレコードの
// 検出に使う(下記コメント参照)。年は4桁固定ではなく可変長(紀元前・5桁超の年は
// git がそのまま出力する)ため、桁数を絞り込みすぎない
const ISO_8601_DATE_PATTERN = /^-?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/

// %H の形式(SHA-1 は 40 桁、SHA-256 は 64 桁)。本文に区切り文字が混ざって割れた断片を見分ける
const COMMIT_HASH_PATTERN = /^[0-9a-f]{40,64}$/

// %H・%P・%D・%B・%aI・%an の 6 欄
const MIN_FIELD_COUNT = 6

const HEAD_DECORATION = 'HEAD'
const CURRENT_BRANCH_PREFIX = 'HEAD -> refs/heads/'
const LOCAL_BRANCH_PREFIX = 'refs/heads/'
const REMOTE_PREFIX = 'refs/remotes/'
const TAG_PREFIX = 'tag: refs/tags/'
const REMOTE_HEAD_SUFFIX = '/HEAD'

function parseGitLogRef(decoration: string): GitLogRef | null {
  if (decoration.startsWith(CURRENT_BRANCH_PREFIX)) {
    return { kind: 'current', name: decoration.slice(CURRENT_BRANCH_PREFIX.length) }
  }
  if (decoration.startsWith(LOCAL_BRANCH_PREFIX)) {
    return { kind: 'branch', name: decoration.slice(LOCAL_BRANCH_PREFIX.length) }
  }
  if (decoration.startsWith(TAG_PREFIX)) {
    return { kind: 'tag', name: decoration.slice(TAG_PREFIX.length) }
  }
  if (decoration.startsWith(REMOTE_PREFIX) && !decoration.endsWith(REMOTE_HEAD_SUFFIX)) {
    return { kind: 'remote', name: decoration.slice(REMOTE_PREFIX.length) }
  }
  return null
}

// --decorate=full の %D(例: `HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1`)を解釈する。
// ref 名に空白は入らないため `, ` で分けられる。単独の HEAD は detached の印で、ref には入れない。
// 短い形式の名前だと origin/main とローカルの origin/main を区別できないため、完全な ref 名から種類を決める
export function parseGitLogRefs(decoration: string): { refs: GitLogRef[]; isHead: boolean } {
  const items = decoration.split(', ')
  const refs = items.map(parseGitLogRef).filter((ref): ref is GitLogRef => ref !== null)
  const isHead = items.some(
    (item) => item === HEAD_DECORATION || item.startsWith(CURRENT_BRANCH_PREFIX)
  )
  return { refs, isHead }
}

// git log --pretty=format:'%H%x1f%P%x1f%D%x1f%B%x1f%aI%x1f%an%x1e' の出力をレコード配列にパースする。
// git raw の呼び出し(I/O)とは無関係な、純粋なテキスト解析の責務のため gitService.ts から分離している。
export function parseGitLogOutput(output: string): GitLogEntry[] {
  return (
    output
      .split('\x1e')
      // \x1e(レコード区切り)の直後には次のレコードの前に付く \n が入る
      // (実機で確認済み)。この先頭の改行だけを取り除く。record 全体に .trim() を
      // 使うと、末尾のフィールド(authorName)が意図的な末尾空白を持つ場合
      // (`git config user.name "Alice "` は git 上有効)まで削られてしまう
      .map((record) => record.replace(/^\s+/, ''))
      .filter((record) => record.length > 0)
      .map((record) => record.split('\x1f'))
      // コミットメッセージ本文に U+001E(レコード区切り)や U+001F(フィールド区切り)が
      // 含まれると境界が割れ、フィールド数の足りない断片が生まれる。そのまま
      // rawMessage.trim() を呼ぶと TypeError になり、getLog 全体が throw して
      // 履歴パネルが「Cannot read properties of undefined」で表示不能になる
      // (HistorySection の entry.message.split('\n') も同様に落ちる)。
      // 壊れた 1 レコードのために履歴全体を失わせず、その断片だけ読み飛ばす
      .filter((fields) => fields.length >= MIN_FIELD_COUNT)
      // フィールドが「多い」場合も同様に本文へ区切り文字が混ざったケース。
      // 単純な分割代入だと message が区切り位置で切り詰められ、date にメッセージの
      // 続き、authorName に日時が入ってしまい、日付欄が消えて著者名も誤表示になる。
      // hash・parents・decoration は先頭 3 つ、date/authorName は末尾 2 つと位置が決まっているので、
      // 余剰フィールドは本文の一部として結合し直す
      .map((fields) => {
        const [hash, parents, decoration] = fields
        const date = fields[fields.length - 2]
        const authorName = fields[fields.length - 1]
        const rawMessage = fields.slice(3, -2).join('\x1f')
        return {
          hash,
          // ルートコミットの %P は空文字。split だけだと [''] になる
          parents: parents.split(' ').filter((parent) => parent.length > 0),
          ...parseGitLogRefs(decoration),
          // %B は本文末尾に改行を含むことがあるため、複数行本文の内部の改行は保ちつつ
          // 前後の余分な空白/改行だけを取り除く
          message: rawMessage.trim(),
          date,
          authorName
        }
      })
      // U+001E が本文中に1箇所だけ含まれるケースは、上のフィールド数のフィルタを
      // すり抜けることがある。\x1e 分割でレコードが2つに割れ、断片が
      // たまたま \x1f 区切りで 6 フィールド以上になると、本来は不正な断片なのに
      // 「正常な1レコード」として通ってしまう。前半の断片は date に本文の断片が入るため、
      // 日時として解釈できないことを手がかりに検出できる(%aI は常に strict ISO 8601
      // 形式を返すため)。後半の断片は末尾の日時が正しいまま残るので、先頭が %H の
      // 形式でないことを手がかりに検出する
      .filter(
        (entry) => ISO_8601_DATE_PATTERN.test(entry.date) && COMMIT_HASH_PATTERN.test(entry.hash)
      )
  )
}
