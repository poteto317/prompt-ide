// 設定の読み書きの失敗の文言。main の設定ファイル(settings.json)の読み書きの例外には、パスや中身の断片(JSON.parse の
// SyntaxError に入る、API キーの暗号文を含みうる)が入るため、例外の文言は画面に出さず、理由は固定の文言にする(L-017)。
// 例外は console.error に記録する。各設定の保存の失敗は「<設定名> を保存できませんでした: <理由>」の形にする

/** settings.json の場所の手がかり。パスは出さない(macOS と Windows で場所が違い、利用者名も入るため) */
const SETTINGS_FILE_LOCATION = 'アプリのデータフォルダの settings.json'

/** settings.json をほかのアプリが開いているとき(Windows の rename の EPERM・EBUSY)の次の行動 */
const SETTINGS_FILE_RETRY_HINT =
  'ほかのアプリで settings.json を開いていれば閉じてから、もう一度試してください'

/** API キーの失敗が続くときに確かめる先(キーストアと settings.json) */
const API_KEY_STORE_CHECK_HINT = `システムのキーストア（キーチェーンなど）が使えるか、${SETTINGS_FILE_LOCATION} が壊れていないかを確かめてください`

/**
 * 設定の保存の失敗の理由(固定)。実行方式・エージェントの通知・送信前の確認・使うエージェント CLI・モデルで共有する。
 * 利用者が自分で直せる原因(ほかのアプリが settings.json を開いている〈Windows の rename の EPERM・EBUSY〉・
 * settings.json が壊れている〈保存は先に読み込むため、どの設定の保存も失敗し続ける〉)を案内する。パスと例外の中身は出さない
 */
export const SETTINGS_FILE_ERROR_REASON = `設定ファイルを読み書きできませんでした。${SETTINGS_FILE_RETRY_HINT}。続くときは${SETTINGS_FILE_LOCATION} が壊れていないか確かめてください`

/** API キーの読み書きの失敗の理由(固定)。設定ファイルに加え、システムのキーストアの失敗もありうる */
export const API_KEY_STORE_ERROR_REASON = 'システムのキーストアまたは設定ファイルを使えませんでした'

/** モデルの設定の保存の失敗の文言 */
export const MODEL_SETTINGS_SAVE_ERROR_MESSAGE = `モデルの設定を保存できませんでした: ${SETTINGS_FILE_ERROR_REASON}`

/**
 * API キーの保存の失敗の文言。ほかの設定の保存と同じく、ほかのアプリが settings.json を開いているときの再試行と、
 * 続くときに確かめる先(キーストアと settings.json)を案内する
 */
export const API_KEY_SAVE_ERROR_MESSAGE = `API キーを保存できませんでした: ${API_KEY_STORE_ERROR_REASON}。${SETTINGS_FILE_RETRY_HINT}。続くときは、${API_KEY_STORE_CHECK_HINT}`

/**
 * API キーの読み込みの失敗の文言。保存済みのキーを復号できなかったときは main がキーを消すため、再起動すると再設定できる。
 * キーストアが使えないときと settings.json が壊れているときは再起動しても続くため、確かめる先も案内する
 */
export const API_KEY_LOAD_ERROR_MESSAGE = `API キーを読み込めませんでした: ${API_KEY_STORE_ERROR_REASON}。保存済みのキーを復号できなかったときはキーを消してあるため、アプリを再起動すると再設定できます。再起動しても続くときは、${API_KEY_STORE_CHECK_HINT}`
