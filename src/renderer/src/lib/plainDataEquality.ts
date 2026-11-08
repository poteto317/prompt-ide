import { isObjectLike } from '@shared/typeGuards'

// IPC で届いた素のデータ(オブジェクト・配列・数・文字列・真偽・null)の構造の比べ(React・IPC に依らない)。
// 静かな取り直しで、中身が同じなら置き換えない(参照を保つ)ための共通の比べで、エージェントの変更の写し(agentChangesView)・
// git status(gitStatusEquality)・ファイルツリー(fileTreeEquality)が使う。値が undefined のキーは、キーが無いのと同じに扱う
// (main は値があるときだけ入れる欄がある)。配列は並びの順のまま比べる

export function isSamePlainData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!isObjectLike(a) || !isObjectLike(b)) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aRecord = a
  const bRecord = b
  const aKeys = Object.keys(aRecord).filter((key) => aRecord[key] !== undefined)
  const bKeys = Object.keys(bRecord).filter((key) => bRecord[key] !== undefined)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => isSamePlainData(aRecord[key], bRecord[key]))
}
