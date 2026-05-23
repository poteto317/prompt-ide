import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

interface SettingsFile {
  encryptedApiKey?: string
  apiKey?: string
}

const getSettingsPath = (): string => join(app.getPath('userData'), 'settings.json')

export async function getApiKey(): Promise<string> {
  try {
    const content = await readFile(getSettingsPath(), 'utf-8')
    const data = JSON.parse(content) as SettingsFile

    if (data.encryptedApiKey) {
      const buf = Buffer.from(data.encryptedApiKey, 'base64')
      return safeStorage.decryptString(buf)
    }

    // Legacy plain-text migration: re-save encrypted then return
    if (data.apiKey) {
      await setApiKey(data.apiKey)
      return data.apiKey
    }

    return ''
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}

export async function setApiKey(apiKey: string): Promise<void> {
  const dir = app.getPath('userData')
  await mkdir(dir, { recursive: true })
  const encrypted = safeStorage.encryptString(apiKey)
  const encryptedApiKey = encrypted.toString('base64')
  await writeFile(
    getSettingsPath(),
    JSON.stringify({ encryptedApiKey }, null, 2),
    { encoding: 'utf-8', mode: 0o600 }
  )
}
