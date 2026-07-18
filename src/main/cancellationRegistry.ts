// 実行中のプロンプト実行(API / CLI)の requestId とキャンセル処理を対応付けるレジストリ。
// 登録側は実行完了時(成功・失敗を問わず)に必ず unregister して残留を防ぐこと。
const registry = new Map<string, () => void>()

export function registerCancellation(requestId: string, cancel: () => void): void {
  registry.set(requestId, cancel)
}

export function unregisterCancellation(requestId: string): void {
  registry.delete(requestId)
}

/** 該当する実行が存在すればキャンセルを実行し true を返す。既に完了済みなら false */
export function cancelRequest(requestId: string): boolean {
  const cancel = registry.get(requestId)
  if (!cancel) return false
  cancel()
  return true
}
