import { readFile, writeFile } from 'node:fs/promises'
import { openJsonDialog, saveJsonDialog } from './dialogService'
import { buildExport, parseImport } from './promptTransfer'
import type { Prompt } from '@shared/types'

/** 保存ダイアログでパスを選ばせ JSON ファイルへ書き出す。保存したら true、キャンセル時は false。 */
export async function exportPromptsToFile(prompts: Prompt[]): Promise<boolean> {
  const filePath = await saveJsonDialog('prompts.json')
  if (filePath === null) return false
  await writeFile(filePath, JSON.stringify(buildExport(prompts), null, 2), 'utf-8')
  return true
}

/** 読み込みダイアログでファイルを選ばせ、パース結果を返す。キャンセル時は null。 */
export async function importPromptsFromFile(): Promise<Prompt[] | null> {
  const filePath = await openJsonDialog()
  if (filePath === null) return null
  const raw = await readFile(filePath, 'utf-8')
  return parseImport(raw)
}
