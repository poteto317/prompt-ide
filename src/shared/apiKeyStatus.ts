// API キーの状態(settings:hasApiKey の戻り値)。IPC では main の例外の型が renderer に届かず、例外の文言には
// settings.json のパスや中身の断片が入りうる(L-017)。そこで main は読み込みの失敗を理由の種類に変えて返し、
// renderer は種類ごとに固定の文言を出す

/**
 * API キーの読み込みの失敗の理由の種類
 * - keystore-unavailable: システムのキーストア(キーチェーンなど)が使えない
 * - decrypt-failed: 保存済みのキーを復号できない(main がキーを消してあるため、再起動すると再設定できる)
 * - settings-file-error: settings.json を読めない・壊れている
 * - unknown: 上のどれにも分類できない失敗(main が console.error に記録する)
 */
export type ApiKeyLoadFailureReason =
  | 'keystore-unavailable'
  | 'decrypt-failed'
  | 'settings-file-error'
  | 'unknown'

/** API キーの状態。成功ならキーがあるかどうか、失敗なら理由の種類だけを持つ(例外の文言は持たない) */
export type ApiKeyStatus =
  | { ok: true; hasKey: boolean }
  | { ok: false; reason: ApiKeyLoadFailureReason }
