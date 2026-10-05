// シェルの操作の IPC の窓口(エージェントのセッションに限らず使う)

/** http・https の URL を既定のブラウザで開く(main でもスキームを確かめる)。開けなければ false */
export function openExternalLink(url: string): Promise<boolean> {
  return window.api.openExternalLink(url)
}
