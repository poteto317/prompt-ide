import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const getSettingsPath = (): string => join(app.getPath('userData'), 'settings.json')

export async function getApiKey(): Promise<string> {
  try {
    const content = await readFile(getSettingsPath(), 'utf-8')
    return (JSON.parse(content) as { apiKey?: string }).apiKey ?? ''
  } catch {
    return ''
  }
}

export async function setApiKey(apiKey: string): Promise<void> {
  const dir = app.getPath('userData')
  await mkdir(dir, { recursive: true })
  await writeFile(getSettingsPath(), JSON.stringify({ apiKey }, null, 2), 'utf-8')
}
