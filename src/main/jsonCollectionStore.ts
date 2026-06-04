import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { WriteQueue } from './writeQueue'

interface JsonCollectionStore<T> {
  load: () => Promise<T[]>
  save: (items: T[]) => Promise<void>
}

interface JsonCollectionStoreConfig<T> {
  fileName: string
  isValid: (item: unknown) => item is T
  sanitize: (item: T) => T
}

/**
 * userData 配下の JSON 配列ファイルを読み書きする汎用ストアを生成する。
 * - load: ファイルが無ければ空配列、配列でなければ空配列、各要素を検証・サニタイズ
 * - save: 書き込みキューで直列化し、ディレクトリ作成後に書き込む
 */
export function createJsonCollectionStore<T>({
  fileName,
  isValid,
  sanitize
}: JsonCollectionStoreConfig<T>): JsonCollectionStore<T> {
  const filePath = (): string => join(app.getPath('userData'), fileName)

  const load = async (): Promise<T[]> => {
    try {
      const raw = await readFile(filePath(), 'utf-8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isValid).map(sanitize)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  const queue = new WriteQueue()

  const save = (items: T[]): Promise<void> =>
    queue.enqueue(async () => {
      const dir = app.getPath('userData')
      await mkdir(dir, { recursive: true })
      await writeFile(filePath(), JSON.stringify(items), 'utf-8')
    })

  return { load, save }
}
