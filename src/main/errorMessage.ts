// 投げられた値(unknown)から、ログ・利用者向けの文言に添える説明を取り出す。
// Error ならその message、それ以外(文字列・数値など、Error 以外を throw した場合)は String() で文字列にする

/** 投げられた値の説明。Error なら message、それ以外は String(value) */
export function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
