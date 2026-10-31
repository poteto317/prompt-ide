// 送信前の確認で渡す引数を本文へ付ける。`/review` と `123` から `/review 123` を作る。引数が空なら本文を変えない
export function appendAgentPromptArgument(text: string, argument: string): string {
  const value = argument.trim()
  if (value === '') return text
  const body = text.trimEnd()
  return body === '' ? value : `${body} ${value}`
}
