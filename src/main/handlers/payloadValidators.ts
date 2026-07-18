// IPC ペイロードの共通バリデーション。各ペイロードパーサー
// (claudePayloadParser / cliPayloadParser / settingsPayloadParser /
// promptCancelHandlers)で同一のガードとエラーメッセージを重複させないための共有層。

export function assertPlainObject(
  payload: unknown
): asserts payload is Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('引数はオブジェクトである必要があります')
  }
}

export function assertRequestId(requestId: unknown): asserts requestId is string {
  if (typeof requestId !== 'string' || requestId.trim().length === 0) {
    throw new Error('requestId は空でない文字列である必要があります')
  }
}
