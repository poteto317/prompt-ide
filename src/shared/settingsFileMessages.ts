// 設定ファイル(settings.json)の読み書きの失敗の固定の文言。main(settingsFileStore が読み込みの失敗を SettingsFileError で
// 投げ直すときの文言)と renderer(各設定の保存の失敗の理由)で共有する(片方だけ変えて文言が食い違わないように。パターン 88)。
// settings.json の読み書きの例外には、パスや中身の断片(JSON.parse の SyntaxError に入る、API キーの暗号文を含みうる)が
// 入るため、例外の文言は画面に出さず、理由は固定の文言にする(L-017)

/** settings.json の場所の手がかり。パスは出さない(macOS と Windows で場所が違い、利用者名も入るため) */
export const SETTINGS_FILE_LOCATION = 'アプリのデータフォルダの settings.json'

/** settings.json をほかのアプリが開いているとき(Windows の rename の EPERM・EBUSY)の次の行動 */
export const SETTINGS_FILE_RETRY_HINT =
  'ほかのアプリで settings.json を開いていれば閉じてから、もう一度試してください'

/**
 * 設定ファイルの読み書きの失敗の理由(固定)。main は settings.json を読めない・壊れているときにこの文言で投げ、
 * renderer は実行方式・エージェントの通知・送信前の確認・使うエージェント CLI・モデルの保存の失敗の理由に使う。
 * 利用者が自分で直せる原因(ほかのアプリが settings.json を開いている〈Windows の rename の EPERM・EBUSY〉・
 * settings.json が壊れている〈保存は先に読み込むため、どの設定の保存も失敗し続ける〉)を案内する。パスと例外の中身は出さない
 */
export const SETTINGS_FILE_ERROR_REASON = `設定ファイルを読み書きできませんでした。${SETTINGS_FILE_RETRY_HINT}。続くときは${SETTINGS_FILE_LOCATION} が壊れていないか確かめてください`
