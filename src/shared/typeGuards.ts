// 外部入力(保存ファイル・IPC の payload・hooks の本文など)を unknown から絞り込むための共通の型ガード。
// `value as Record<string, unknown>` や `(LIST as readonly string[]).includes(value)` のような、検証の結果を型に
// 伝えられないキャストを各所で書かないために置く。main・preload・renderer のどこからでも使える(依存なし)

/**
 * null でないオブジェクト(配列も含む)か。プロパティを読む前の絞り込みに使う。
 * 配列を弾きたいときは isPlainObject を使う
 */
export function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** null でも配列でもないオブジェクトか(プロトタイプは問わない) */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isObjectLike(value) && !Array.isArray(value)
}

/**
 * value が候補の一覧(`as const` の配列など)のどれかと一致するか。一致すれば候補の要素の型に絞り込む。
 * 比べ方は Array.prototype.includes と同じ(SameValueZero)
 */
export function isOneOf<const T extends readonly unknown[]>(
  candidates: T,
  value: unknown
): value is T[number] {
  // 要素の型を unknown へ広げるだけの代入(キャストではない)。T のままでは includes の引数が要素の型に縛られる
  const list: readonly unknown[] = candidates
  return list.includes(value)
}
