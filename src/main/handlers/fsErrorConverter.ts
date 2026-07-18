import { isFsError } from '../fsErrors'

/**
 * 読み取り/書き込み/削除系ハンドラ用の変換。ENOENT は呼び出し側が指定した
 * メッセージへ、それ以外の fs エラー(EACCES/EPERM/EBUSY 等)は汎用の日本語
 * メッセージへ変換する。fs エラーでないもの(アクセス拒否等の自前 Error)は
 * そのまま返す。
 */
export function convertFsAccessError(
  err: unknown,
  notFoundMessage: string,
  contextPath: string
): unknown {
  if (isFsError(err, 'ENOENT')) return new Error(notFoundMessage)
  if (isFsError(err)) return new Error(`ファイル操作に失敗しました(${err.code}): ${contextPath}`)
  return err
}

/** 作成/リネーム系ハンドラ用の変換。EEXIST(名前衝突)も日本語メッセージへ変換する */
export function convertFsError(err: unknown, name: string, contextPath: string): unknown {
  if (isFsError(err, 'EEXIST')) return new Error(`既に存在します: ${name}`)
  return convertFsAccessError(err, `対象が見つかりません: ${contextPath}`, contextPath)
}
