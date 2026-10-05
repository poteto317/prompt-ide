// 既定のブラウザで開いてよい URL の規則(http・https だけ)。main の新しいウィンドウ・リンクの IPC と、renderer のターミナルの
// リンクが共有する(同じ規則を層ごとに書かない。パターン 88)
export function isExternalHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
