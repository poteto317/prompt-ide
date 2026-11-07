// 全体の指示ファイルの作成(設計書 2026-11-07 global「作成」)。途中の失敗は投げ、受け口が理由に変える。
// フォルダを作る前に親を確かめ、確かめた親の直下にだけ作る(字面の dirPath には作らない。L-018)。
// 作ったフォルダは、後の失敗でも消さない(L-004)
import { mkdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { GlobalAgentInstructionCreateFailureReason } from '@shared/types'
import { createFileContent } from './fileSystem'
import { isFsError } from './fsErrors'
import {
  GlobalAgentInstructionAccessDeniedError,
  assertResolvedWithinHome
} from './globalAgentInstructionAccess'
import type { ResolvedGlobalAgentInstructionLocation } from './globalAgentInstructionLocations'

export async function createGlobalAgentInstructionFile(
  location: ResolvedGlobalAgentInstructionLocation,
  homeDir: string
): Promise<void> {
  const { dirPath, file } = location
  let dirToCheck = dirPath
  if (dirPath !== homeDir) {
    // 2. 親を確かめる(~/link がホームの外へのリンクなら、ここで拒否して何も作らない)。親が無ければ realpath の失敗を投げる
    const resolvedParent = await assertResolvedWithinHome(homeDir, dirname(dirPath))
    dirToCheck = join(resolvedParent, basename(dirPath))
    // 3. 確かめた親の直下に 1 段だけ作る。既にあれば(リンクを含む)4 で確かめる
    try {
      await mkdir(dirToCheck, { mode: 0o700 })
    } catch (err) {
      if (!isFsError(err, 'EEXIST')) throw err
    }
  }
  // 4. フォルダ自体を確かめる(ホームそのもののときは dirPath を確かめる)
  const resolvedDir = await assertResolvedWithinHome(homeDir, dirToCheck)
  if (!(await stat(resolvedDir)).isDirectory()) {
    throw Object.assign(new Error('ENOTDIR: not a directory'), { code: 'ENOTDIR' })
  }
  // 5. 排他的に作る。既にあれば EEXIST、ぶら下がったリンクも辿らない
  await createFileContent(join(resolvedDir, file.fileName), file.template)
}

export function toGlobalAgentInstructionCreateFailureReason(
  err: unknown
): Exclude<GlobalAgentInstructionCreateFailureReason, 'unavailable'> {
  if (err instanceof GlobalAgentInstructionAccessDeniedError) return 'outside'
  if (isFsError(err, 'EEXIST') || isFsError(err, 'ENOTDIR')) return 'exists'
  return 'failed'
}
