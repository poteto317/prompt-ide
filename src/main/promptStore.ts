import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isValidPrompt, sanitizePrompt } from './promptUtils'
import type { Prompt } from '@shared/types'

const promptsPath = (): string => join(app.getPath('userData'), 'prompts.json')

export async function loadPrompts(): Promise<Prompt[]> {
  try {
    const raw = await readFile(promptsPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidPrompt).map(sanitizePrompt)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

// 並行 writeFile 競合を防ぐ書き込みキュー
let writeQueue: Promise<void> = Promise.resolve()

export async function savePrompts(prompts: Prompt[]): Promise<void> {
  const p = writeQueue.then(async () => {
    const dir = app.getPath('userData')
    await mkdir(dir, { recursive: true })
    await writeFile(promptsPath(), JSON.stringify(prompts), 'utf-8')
  })
  writeQueue = p.catch(() => {})
  return p
}
