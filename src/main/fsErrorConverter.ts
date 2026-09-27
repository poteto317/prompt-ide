import { isFsError, isMissingPathError } from './fsErrors'

// handlers 層(fileSystemHandlers 等)と gitService(サービス層)の両方から使うため、
// handlers 配下ではなく main 直下に置く(サービス層 → handlers 層への依存は
// レイヤー逆転になるため。fsErrors.ts と同じ理由)。

/**
 * 読み取り/書き込み/削除系ハンドラ用の変換。「対象が無い」ことを表す fs エラー
 * (ENOENT/ENOTDIR。fsErrors.ts の isMissingPathError と同じ判定基準)は呼び出し側が
 * 指定したメッセージへ、それ以外の fs エラー(EACCES/EPERM/EBUSY 等)は汎用の
 * 日本語メッセージへ変換する。fs エラーでないもの(アクセス拒否等の自前 Error)は
 * そのまま返す。
 */
export function convertFsAccessError(
  err: unknown,
  notFoundMessage: string,
  contextPath: string
): unknown {
  if (isMissingPathError(err)) return new Error(notFoundMessage)
  if (isFsError(err)) return new Error(`ファイル操作に失敗しました(${err.code}): ${contextPath}`)
  return err
}

/** 作成/リネーム系ハンドラ用の変換。EEXIST(名前衝突)も日本語メッセージへ変換する */
export function convertFsError(err: unknown, name: string, contextPath: string): unknown {
  if (isFsError(err, 'EEXIST')) return new Error(`既に存在します: ${name}`)
  return convertFsAccessError(err, `対象が見つかりません: ${contextPath}`, contextPath)
}
