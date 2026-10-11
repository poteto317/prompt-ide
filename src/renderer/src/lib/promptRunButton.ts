// 要素が描画されて見えているか。隠れたパネル(display: none)の中のボタンへ focus() を呼んでも移らず、フォーカスが body に落ちる
// ため、戻り先から外す。checkVisibility が無い環境(jsdom)では見えているとみなす
function isShown(element: HTMLElement): boolean {
  return typeof element.checkVisibility !== 'function' || element.checkVisibility()
}

// プロンプトの一覧の「実行」ボタン(PromptItemView の data-prompt-run)を探す。送信前の確認をキャンセルで閉じたとき・確認からの
// 送信が失敗したときのフォーカスの戻り先に使う。見つからない・押せない(disabled)・見えていない(一覧のパネルが隠れている)なら null
function findPromptRunButton(promptId: string): HTMLElement | null {
  const run = Array.from(document.querySelectorAll<HTMLElement>('[data-prompt-run]')).find(
    (element) => element.dataset.promptRun === promptId
  )
  return run !== undefined && !run.matches(':disabled') && isShown(run) ? run : null
}

// 送信前の確認をキャンセルで閉じたとき・確認からの送信が失敗したときのフォーカスの戻り先。開いた時点の要素(一覧の実行・履歴の
// 詳細の再実行 など)が DOM に残っていて押せて見えていればそこ、無ければ(変数のフォームの実行から開いた場合、フォームは閉じて
// いる)同じプロンプトの一覧の「実行」。どちらも無ければ null
export function findSendConfirmReturnTarget(
  opener: Element | null,
  promptId: string | null
): HTMLElement | null {
  if (
    opener instanceof HTMLElement &&
    opener !== document.body &&
    opener.isConnected &&
    !opener.matches(':disabled') &&
    isShown(opener)
  ) {
    return opener
  }
  return promptId === null ? null : findPromptRunButton(promptId)
}
