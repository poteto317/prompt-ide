// IPC ペイロードの共通バリデーション。各ペイロードパーサー
// (claudePayloadParser / cliPayloadParser / settingsPayloadParser /
// promptCancelHandlers)で同一のガードとエラーメッセージを重複させないための共有層。

export function assertPlainObject(payload: unknown): asserts payload is Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('引数はオブジェクトである必要があります')
  }
}

export function assertRequestId(requestId: unknown): asserts requestId is string {
  if (typeof requestId !== 'string' || requestId.trim().length === 0) {
    throw new Error('requestId は空でない文字列である必要があります')
  }
}

/**
 * IPC で受け取るパスの長さの上限(UTF-16 の単位)。realpath などに巨大な文字列を渡さないための粗い事前の上限。
 * Windows の長いパスの上限(32,767)に合わせ、macOS・Linux の PATH_MAX(1,024・4,096)より十分に大きい
 */
export const IPC_PATH_MAX_LENGTH = 32_767
