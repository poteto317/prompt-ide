// 一覧・ボタンの aria-label に出す退避の名前。メッセージが空の退避(最後のコミットの件名が
// 空など)でも、何の行か分かるようにする
export function getStashDisplayName(message: string): string {
  return message === '' ? '(メッセージなし)' : message
}
