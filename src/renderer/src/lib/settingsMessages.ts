// 設定の読み書きの失敗の文言。main の設定ファイル(settings.json)の読み書きの例外には、パスや中身の断片(JSON.parse の
// SyntaxError に入る、API キーの暗号文を含みうる)が入るため、例外の文言は画面に出さず、理由は固定の文言にする(L-017)。
// 例外は console.error に記録する。各設定の保存の失敗は「<設定名> を保存できませんでした: <理由>」の形にする

/** 設定の保存の失敗の理由(固定)。実行方式・エージェントの通知・送信前の確認・使うエージェント CLI・モデルで共有する */
export const SETTINGS_FILE_ERROR_REASON = '設定ファイルを読み書きできませんでした'

/** API キーの読み書きの失敗の理由(固定)。設定ファイルに加え、システムのキーストアの失敗もありうる */
export const API_KEY_STORE_ERROR_REASON = 'システムのキーストアまたは設定ファイルを使えませんでした'

/** モデルの設定の保存の失敗の文言 */
export const MODEL_SETTINGS_SAVE_ERROR_MESSAGE = `モデルの設定を保存できませんでした: ${SETTINGS_FILE_ERROR_REASON}`

/** API キーの保存の失敗の文言 */
export const API_KEY_SAVE_ERROR_MESSAGE = `API キーを保存できませんでした: ${API_KEY_STORE_ERROR_REASON}`

/** API キーの読み込みの失敗の文言。保存済みのキーを復号できなかったときは main がキーを消すため、再起動すると再設定できる */
export const API_KEY_LOAD_ERROR_MESSAGE = `API キーを読み込めませんでした: ${API_KEY_STORE_ERROR_REASON}。保存済みのキーを復号できなかったときはキーを消してあるため、アプリを再起動すると再設定できます`
