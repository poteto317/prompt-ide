/** working tree を書き換える操作(checkout・merge 等)を、エディタのタブと同期して実行する。
 *  未保存編集の破棄を確認し(拒否されたら何もしない)、操作が成功したときだけ全タブを再読込する。
 *  操作が失敗(false)のときに再読込すると、失敗したにもかかわらず無関係な未保存編集が
 *  ディスク内容でサイレントに上書きされてしまうため、成功時のみ再読込する。
 *  例外は握りつぶさず、そのまま呼び出し元へ伝播する */
export async function runEditorSyncedOperation({
  confirmDiscardAnyDirty,
  reloadOpenFiles,
  operation
}: {
  confirmDiscardAnyDirty: () => boolean
  reloadOpenFiles: () => Promise<void>
  operation: () => Promise<boolean>
}): Promise<void> {
  if (!confirmDiscardAnyDirty()) return
  const succeeded = await operation()
  if (succeeded) await reloadOpenFiles()
}
