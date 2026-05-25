import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Prompt } from '@shared/types'

const promptsPath = (): string => join(app.getPath('userData'), 'prompts.json')

export async function loadPrompts(): Promise<Prompt[]> {
  try {
    const raw = await readFile(promptsPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export async function savePrompts(prompts: Prompt[]): Promise<void> {
  const dir = app.getPath('userData')
  await mkdir(dir, { recursive: true })
  await writeFile(promptsPath(), JSON.stringify(prompts), 'utf-8')
}
