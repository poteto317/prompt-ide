import type { ConflictFile } from '@shared/types'

export interface ConflictActions {
  /** 「自分をすべて採用」「相手をすべて採用」 */
  wholeFile: boolean
  /** 「ファイルを残す」 */
  keep: boolean
  /** 「削除する」 */
  remove: boolean
  /** 「解決済みにする」 */
  markResolved: boolean
}

// ステージ 2・3 の両方があれば内容の競合(ファイルを採用する側を選ぶ)。片方だけなら
// 追加/削除型で、採用する側のファイルが無いため「残す」か「削除する」を選ぶ。
// 両側とも無い(DD)ときは残す対象が無く、「ファイルを残す」は必ず失敗するので「削除する」だけ。
// 「解決済みにする」(git add)は、作業ツリーにファイルがあれば出す(missing 以外。無いまま add すると
// 削除として解決してしまう)。parsed(ブロックを選び終えた・追加/削除型)とマーカーを解析できないテキストは
// 手編集の後に、バイナリ・リンク(binary / not-regular)は「すべて採用」の後に押す。「すべて採用」の
// checkout --ours/--theirs はステージ 1/2/3 を残すため、add しないと未解決のまま残る
// (main の markConflictResolved はバイナリ・リンクのマーカー検査を飛ばして add する)。
// サブモジュール(reason: submodule)はボタンを 1 つも出さない(main がすべて拒否する。checkout --ours/--theirs は
// 何も変えず、続けて add すると自分側のコミットが黙って記録されるため、ターミナルでの解決を案内する)。
// ボタンの出し分けと、解析不能のときの案内文言(ConflictResolver)が同じ規則から決まるようにここへ集約する
export function getConflictActions(file: ConflictFile): ConflictActions {
  if (file.status === 'unparsable' && file.reason === 'submodule') {
    return { wholeFile: false, keep: false, remove: false, markResolved: false }
  }
  const bothSides = file.stages.ours && file.stages.theirs
  return {
    wholeFile: bothSides,
    keep: !bothSides && (file.stages.ours || file.stages.theirs),
    remove: !bothSides,
    markResolved: file.status === 'parsed' || file.reason !== 'missing'
  }
}
