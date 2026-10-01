// 退避を捨てると、含まれる変更・未追跡ファイルは git の通常の手段では取り戻せないため確認する
export function buildStashDropConfirmMessage(message: string): string {
  const target = message === '' ? 'この退避' : `${message} `
  return `${target}を捨てますか？この操作は元に戻せません。`
}
