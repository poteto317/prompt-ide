import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'

interface SettingsFile {
  encryptedApiKey?: string
  apiKey?: string
}

const getSettingsPath = (): string => join(app.getPath('userData'), 'settings.json')

export async function getApiKey(): Promise<string> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('システムのキーストアが利用できません。APIキーを安全に保存できません。')
  }
  try {
    const content = await readFile(getSettingsPath(), 'utf-8')
    const data = JSON.parse(content) as SettingsFile

    if (data.encryptedApiKey) {
      const buf = Buffer.from(data.encryptedApiKey, 'base64')
      return safeStorage.decryptString(buf)
    }

    // Legacy plain-text migration: trim, validate, re-save encrypted then return
    if (data.apiKey) {
      const trimmed = data.apiKey.trim()
      if (trimmed.length === 0) return ''
      await setApiKey(trimmed)
      return trimmed
    }

    return ''
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}

export async function setApiKey(apiKey: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('システムのキーストアが利用できません。APIキーを安全に保存できません。')
  }
  const dir = app.getPath('userData')
  await mkdir(dir, { recursive: true })
  const encrypted = safeStorage.encryptString(apiKey)
  const encryptedApiKey = encrypted.toString('base64')
  await writeFile(
    getSettingsPath(),
    JSON.stringify({ encryptedApiKey }, null, 2),
    { encoding: 'utf-8', mode: 0o600 }
  )
  await chmod(getSettingsPath(), 0o600)
}
