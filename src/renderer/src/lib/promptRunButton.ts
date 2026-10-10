// プロンプトの一覧の「実行」ボタン(PromptItemView の data-prompt-run)を探す。送信前の確認をキャンセルで閉じたとき・確認からの
// 送信が失敗したときのフォーカスの戻り先に使う。見つからない・押せない(disabled)なら null
export function findPromptRunButton(promptId: string): HTMLElement | null {
  const run = Array.from(document.querySelectorAll<HTMLElement>('[data-prompt-run]')).find(
    (element) => element.dataset.promptRun === promptId
  )
  return run !== undefined && !run.matches(':disabled') ? run : null
}
