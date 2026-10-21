// API キーの読み書きの型付きの失敗と、読み込みの失敗の理由の種類への分類。IPC では例外の型が renderer に届かず、
// 例外の文言には settings.json のパスや中身の断片が入りうる(L-017)ため、settings:hasApiKey は理由の種類だけを返す。
// ここの文言は、従来の方式の実行(claude:runPromptStream)の失敗としてそのまま画面に出る。設定の画面の読み込みの失敗の
// 文言は renderer の settingsMessages(API_KEY_LOAD_ERROR_MESSAGES)が種類ごとに持つ

import type { ApiKeyLoadFailureReason } from '@shared/apiKeyStatus'
import { SettingsFileError } from './settingsFileStore'

/** システムのキーストア(キーチェーンなど)が使えない(safeStorage.isEncryptionAvailable() が false) */
export class KeystoreUnavailableError extends Error {
  constructor() {
    super('システムのキーストアが利用できません。API キーを安全に保存できません。')
    this.name = 'KeystoreUnavailableError'
  }
}

/** 保存済みのキーを復号できない。投げる前にキーを消してあるため、次の読み込みではキーが無い状態になる */
export class ApiKeyDecryptError extends Error {
  constructor() {
    super('保存済みの API キーを復号できませんでした。API キーを再設定してください。')
    this.name = 'ApiKeyDecryptError'
  }
}

/**
 * API キーの読み込みの失敗を理由の種類に変える。型は instanceof で見分ける(文言では見分けない)。
 * settings.json の読み書きの失敗(キーを消すときの書き込み・旧形式のキーの暗号化し直しの書き込みを含む)は
 * SettingsFileError として settings-file-error になる。分類できない失敗(Error でない値など)は unknown にし、
 * 元の例外を console.error に記録する(main の記録で、renderer へは送らない)
 */
export function toApiKeyLoadFailureReason(err: unknown): ApiKeyLoadFailureReason {
  if (err instanceof KeystoreUnavailableError) return 'keystore-unavailable'
  if (err instanceof ApiKeyDecryptError) return 'decrypt-failed'
  // 元の例外は settingsFileStore が記録済み
  if (err instanceof SettingsFileError) return 'settings-file-error'
  console.error('[apiKeyErrors] unclassified API key load failure:', err)
  return 'unknown'
}
