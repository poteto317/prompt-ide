// 設定の読み書きの失敗の文言。main の設定ファイル(settings.json)の読み書きの例外には、パスや中身の断片(JSON.parse の
// SyntaxError に入る、API キーの暗号文を含みうる)が入るため、例外の文言は画面に出さず、理由は固定の文言にする(L-017)。
// 例外は console.error に記録する。各設定の保存の失敗は「<設定名> を保存できませんでした: <理由>」の形にする

import type { ApiKeyLoadFailureReason } from '@shared/apiKeyStatus'
import {
  SETTINGS_FILE_CLOSE_HINT,
  SETTINGS_FILE_ERROR_REASON,
  SETTINGS_FILE_LOCATION,
  SETTINGS_FILE_RETRY_HINT
} from '@shared/settingsFileMessages'

// 設定の保存の失敗の理由(固定)。main と共有するため @shared/settingsFileMessages に置き、ここから各フックへ渡す
export { SETTINGS_FILE_ERROR_REASON }

/** システムのキーストアの呼び方(利用者に分かるよう、macOS のキーチェーンを例に挙げる) */
const KEYSTORE_NAME = 'システムのキーストア（キーチェーンなど）'

/** API キーの失敗のときに確かめる先(キーストアと settings.json)。後ろに「を確かめて…」を続ける */
const API_KEY_STORE_CHECK_TARGET = `${KEYSTORE_NAME}が使えるか、${SETTINGS_FILE_LOCATION} が壊れていないか`

/** API キーの読み書きの失敗の理由(固定)。設定ファイルに加え、システムのキーストアの失敗もありうる */
export const API_KEY_STORE_ERROR_REASON = 'システムのキーストアまたは設定ファイルを使えませんでした'

/** モデルの設定の保存の失敗の文言 */
export const MODEL_SETTINGS_SAVE_ERROR_MESSAGE = `モデルの設定を保存できませんでした: ${SETTINGS_FILE_ERROR_REASON}`

/**
 * API キーの保存の失敗の文言。ほかの設定の保存と同じく、ほかのアプリが settings.json を開いているときの再試行と、
 * 続くときに確かめる先(キーストアと settings.json)を案内する
 */
export const API_KEY_SAVE_ERROR_MESSAGE = `API キーを保存できませんでした: ${API_KEY_STORE_ERROR_REASON}。${SETTINGS_FILE_RETRY_HINT}。続くときは、${API_KEY_STORE_CHECK_TARGET}を確かめてください`

/** API キーの読み込みの失敗の文言の頭 */
const API_KEY_LOAD_ERROR_PREFIX = 'API キーを読み込めませんでした'

/**
 * 確かめる先を確かめてから再起動する案内。API キーの読み込みは起動時に 1 回だけで、失敗すると入力欄と保存が無効のまま
 * 再読み込みの手段が無いため、原因を直したあとはアプリの再起動が要る
 */
const checkThenRestart = (target: string): string =>
  `${target}を確かめてから、アプリを再起動してください`

/**
 * API キーの読み込みの失敗の文言(main が返す理由の種類ごと)。例外の文言は main から届かない(L-017)。
 * どの種類も、試し直す手段が無いため、原因を直してからアプリを再起動することを案内する(保存向けの「もう一度試す」は使わない)。
 * - 復号できない: main がキーを消してあるため、再起動するだけで再設定できる
 * - キーストアが使えない: キーストアを確かめてから再起動する
 * - settings.json を読めない・壊れている: ほかのアプリで開いていれば閉じ、壊れていないかを確かめてから再起動する
 * - 分類できない(IPC そのものの失敗も含む): どれか分からないため、キーストアと settings.json の両方を確かめてから再起動する
 */
export const API_KEY_LOAD_ERROR_MESSAGES: Record<ApiKeyLoadFailureReason, string> = {
  'decrypt-failed': `${API_KEY_LOAD_ERROR_PREFIX}: 保存済みのキーを復号できませんでした。キーを消してあるため、アプリを再起動すると再設定できます`,
  'keystore-unavailable': `${API_KEY_LOAD_ERROR_PREFIX}: システムのキーストアを使えませんでした。${checkThenRestart(`${KEYSTORE_NAME}が使えるか`)}`,
  'settings-file-error': `${API_KEY_LOAD_ERROR_PREFIX}: 設定ファイルを読み込めませんでした。${checkThenRestart(`${SETTINGS_FILE_CLOSE_HINT}、${SETTINGS_FILE_LOCATION} が壊れていないか`)}`,
  unknown: `${API_KEY_LOAD_ERROR_PREFIX}: ${API_KEY_STORE_ERROR_REASON}。${checkThenRestart(API_KEY_STORE_CHECK_TARGET)}`
}
