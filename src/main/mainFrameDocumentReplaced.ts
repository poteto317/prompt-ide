import type { WebContents } from 'electron'

/** net::ERR_ABORTED。遷移が取り消され、今の文書が残る */
const ERR_ABORTED = -3

/**
 * メインフレームの文書が実際に入れ替わったときに listener を呼ぶ。契機は 2 つ:
 * - did-navigate: リロード・許可した遷移が確定した(新しい文書の preload より先に届く)
 * - did-fail-load(メインフレーム・ERR_ABORTED 以外): 読み込みに失敗し、エラーの画面に入れ替わった
 *
 * did-start-navigation は使わない。Electron 39 では will-navigate より先に届き、will-navigate で止めた遷移(ファイルの
 * ドロップなど)でも届くため、ページが残ったまま止めてしまう。止めた遷移では did-navigate も did-fail-load も届かない
 */
export function onMainFrameDocumentReplaced(webContents: WebContents, listener: () => void): void {
  webContents.on('did-navigate', () => listener())
  webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== ERR_ABORTED) listener()
  })
}
