// 全体の指示ファイルの有無の問い合わせ(設計書 2026-11-07 global「有無の問い合わせ」)。「無い」は、ファイルが ENOENT で、
// 作成で書く先(設定のフォルダ、無ければその親)がホームの中にあるときだけ(L-002)。例外は投げず、途中の失敗は failed にする
import { lstat, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { GlobalAgentInstructionStatus } from '@shared/types'
import { isFsError } from './fsErrors'
import {
  GlobalAgentInstructionAccessDeniedError,
  assertResolvedWithinHome
} from './globalAgentInstructionAccess'
import type { GlobalAgentInstructionLocation } from './globalAgentInstructionLocations'

type DirectoryCheck = 'inside' | 'outside' | 'missing' | 'failed'

/** フォルダを realpath してホームの中か。realpath の ENOENT は lstat で「本当に無い」と「ぶら下がったリンク」を分ける */
async function checkDirectory(homeDir: string, path: string): Promise<DirectoryCheck> {
  try {
    await assertResolvedWithinHome(homeDir, path)
    return 'inside'
  } catch (err) {
    if (err instanceof GlobalAgentInstructionAccessDeniedError) return 'outside'
    if (!isFsError(err, 'ENOENT')) return 'failed'
  }
  try {
    await lstat(path)
    // エントリはあるのに realpath できない(ぶら下がったリンク)。mkdir は EEXIST になり、作成は失敗し続ける
    return 'failed'
  } catch (err) {
    return isFsError(err, 'ENOENT') ? 'missing' : 'failed'
  }
}

async function statusOfMissingFile(
  homeDir: string,
  dirPath: string,
  displayPath: string
): Promise<GlobalAgentInstructionStatus> {
  let check = await checkDirectory(homeDir, dirPath)
  // 設定のフォルダが無いときは、作成で 1 段作る先の親を確かめる(ホームそのものなら親は見ない)
  if (check === 'missing' && dirPath !== homeDir) {
    const parent = await checkDirectory(homeDir, dirname(dirPath))
    check = parent === 'missing' ? 'failed' : parent
  }
  if (check === 'inside') return { kind: 'missing', displayPath }
  if (check === 'outside') return { kind: 'linkOutsideHome', displayPath }
  return { kind: 'failed', displayPath }
}

export async function getGlobalAgentInstructionStatus(
  location: GlobalAgentInstructionLocation,
  homeDir: string
): Promise<GlobalAgentInstructionStatus> {
  if (location.kind === 'unavailable') return { kind: 'unavailable', reason: location.reason }
  const { filePath, dirPath, displayPath } = location
  try {
    try {
      await lstat(filePath)
    } catch (err) {
      if (isFsError(err, 'ENOENT')) return await statusOfMissingFile(homeDir, dirPath, displayPath)
      throw err
    }
    let resolved: string
    try {
      resolved = await assertResolvedWithinHome(homeDir, filePath)
    } catch (err) {
      if (err instanceof GlobalAgentInstructionAccessDeniedError) {
        return { kind: 'linkOutsideHome', displayPath }
      }
      throw err
    }
    if (!(await stat(resolved)).isFile()) return { kind: 'failed', displayPath }
    return { kind: 'exists', filePath, displayPath }
  } catch (err) {
    console.error('[globalAgentInstructionStatus] failed:', err)
    return { kind: 'failed', displayPath }
  }
}
