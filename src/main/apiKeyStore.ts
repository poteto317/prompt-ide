import { safeStorage } from 'electron'
import { readSettingsFile, writeSettingsFile } from './settingsFileStore'

function assertEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('システムのキーストアが利用できません。API キーを安全に保存できません。')
  }
}

export async function getApiKey(): Promise<string> {
  assertEncryptionAvailable()
  const data = await readSettingsFile()

  if (data.encryptedApiKey) {
    try {
      const buf = Buffer.from(data.encryptedApiKey, 'base64')
      return safeStorage.decryptString(buf)
    } catch {
      // OS キーチェーンの変更や別マシンからのコピーで復号不能になったキーは
      // 削除して再入力を促す状態に収束させる
      await writeSettingsFile({ encryptedApiKey: undefined })
      throw new Error('保存済みの API キーを復号できませんでした。API キーを再設定してください。')
    }
  }

  // Legacy plain-text migration: trim, validate, re-save encrypted then return
  if (data.apiKey) {
    const trimmed = data.apiKey.trim()
    if (trimmed.length === 0) return ''
    await setApiKey(trimmed)
    return trimmed
  }

  return ''
}

export async function setApiKey(apiKey: string): Promise<void> {
  assertEncryptionAvailable()
  const encrypted = safeStorage.encryptString(apiKey)
  const encryptedApiKey = encrypted.toString('base64')
  // apiKey: undefined で平文フィールドを確実に除去する(マイグレーション時の残留防止)
  await writeSettingsFile({ encryptedApiKey, apiKey: undefined })
}
