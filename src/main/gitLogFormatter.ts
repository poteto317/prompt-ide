import type { GitLogEntry } from '@shared/types'

// %aI(strict ISO 8601)の形式。日時として解釈できるかどうかを、壊れたレコードの
// 検出に使う(下記コメント参照)。年は4桁固定ではなく可変長(紀元前・5桁超の年は
// git がそのまま出力する)ため、桁数を絞り込みすぎない
const ISO_8601_DATE_PATTERN = /^-?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/

// git log --pretty=format:'%H%x1f%B%x1f%aI%x1f%an%x1e' の出力をレコード配列にパースする。
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
      .filter((fields) => fields.length >= 4)
      // フィールドが「多い」場合も同様に本文へ区切り文字が混ざったケース。
      // 単純な分割代入だと message が区切り位置で切り詰められ、date にメッセージの
      // 続き、authorName に日時が入ってしまい、日付欄が消えて著者名も誤表示になる。
      // hash は先頭・date/authorName は末尾 2 つと位置が決まっているので、
      // 余剰フィールドは本文の一部として結合し直す
      .map((fields) => {
        const hash = fields[0]
        const date = fields[fields.length - 2]
        const authorName = fields[fields.length - 1]
        const rawMessage = fields.slice(1, -2).join('\x1f')
        return {
          hash,
          // %B は本文末尾に改行を含むことがあるため、複数行本文の内部の改行は保ちつつ
          // 前後の余分な空白/改行だけを取り除く
          message: rawMessage.trim(),
          date,
          authorName
        }
      })
      // U+001E が本文中に1箇所だけ含まれるケースは、上の「フィールド数 >= 4」
      // フィルタをすり抜けることがある。\x1e 分割でレコードが2つに割れ、
      // 前半の断片("hash\x1fA\x1fB\x1fC")がたまたま \x1f 区切りで4フィールドに
      // なると、本来は不正な断片なのに「正常な1レコード」として通ってしまう
      // (date に本文の断片が入るため、日時として解釈できないことを手がかりに
      // 検出できる。%aI は常に strict ISO 8601 形式を返すため)
      .filter((entry) => ISO_8601_DATE_PATTERN.test(entry.date))
  )
}
