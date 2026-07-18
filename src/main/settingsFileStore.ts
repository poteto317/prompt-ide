import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { isEnoentError } from './fsErrors'

export interface SettingsFile {
  encryptedApiKey?: string
  apiKey?: string
  modelId?: string
  maxTokens?: number
}

const getSettingsPath = (): string => join(app.getPath('userData'), 'settings.json')

export async function readSettingsFile(): Promise<SettingsFile> {
  try {
    const content = await readFile(getSettingsPath(), 'utf-8')
    return JSON.parse(content) as SettingsFile
  } catch (err) {
    if (isEnoentError(err)) return {}
    throw err
  }
}

// Merge write: settings.json は複数の関心事(APIキー・モデル設定など)のフィールドを
// 共有するため、既存内容を読み込んでから部分更新する(undefined を指定したキーは削除される)
export async function writeSettingsFile(partial: Partial<SettingsFile>): Promise<void> {
  const current = await readSettingsFile()
  const next = { ...current, ...partial }
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(getSettingsPath(), JSON.stringify(next, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  })
  await chmod(getSettingsPath(), 0o600)
}
