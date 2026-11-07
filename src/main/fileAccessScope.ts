// 読む・保存する・監視するの入口(fs:readFile・fs:writeFile・fs:writeFileChecked・fs:setWatchedFiles)の規則の振り分け
// (設計書 2026-11-07 global「入口の振り分け」)。拒否の判定を入口ごとに写さず、ここだけで決める(L-061)。
// 全体の指示ファイル(main が作ったパスと完全一致)はホームの中かで確かめ、それ以外は今の許可フォルダの規則のまま
import { dirname } from 'node:path'
import type { FolderAccessManager } from './folderAccessManager'
import { assertFileWithinFolder } from './fileWithinFolder'
import { convertFsAccessError } from './fsErrorConverter'
import { isMissingPathError } from './fsErrors'
import {
  GlobalAgentInstructionAccessDeniedError,
  assertResolvedWithinHome,
  matchGlobalAgentInstructionPath
} from './globalAgentInstructionAccess'
import type { GlobalAgentInstructionContext } from './globalAgentInstructionLocations'

export interface FileAccessScope {
  /** realpath して、許す範囲の中にある既存のファイルか。違えば・解決できなければ投げる */
  assertExisting(path: string): Promise<void>
  /** realpath できなかったファイル(削除された・ぶら下がったリンク)を wx で作り直してよいか。親で確かめる */
  assertRecreatable(path: string): Promise<void>
  /** 入口の失敗を renderer へ返す例外に変える(全体の指示ファイルはパスを含まない固定の文言。L-017) */
  toRendererError(err: unknown, operation: 'read' | 'write'): unknown
}

export interface FileAccessScopeDeps {
  folderAccess: FolderAccessManager
  globalInstructions: GlobalAgentInstructionContext
}

export const GLOBAL_INSTRUCTION_ACCESS_MESSAGES = {
  denied: '全体の指示ファイルはホームフォルダの外を指しているため、開けません',
  deniedWrite: '全体の指示ファイルはホームフォルダの外を指しているため、保存できません',
  missing: '全体の指示ファイルが見つかりません',
  read: '全体の指示ファイルを読み込めませんでした',
  write: '全体の指示ファイルを保存できませんでした'
} as const

export function resolveFileAccessScope(
  { folderAccess, globalInstructions }: FileAccessScopeDeps,
  ownerId: number,
  filePath: string
): FileAccessScope {
  const { locations, homeDir } = globalInstructions
  // 作った時点のフォルダを控え、2 つの検査で同じ値を使う(間の切り替えで別のフォルダで確かめない)
  const allowedFolder = folderAccess.get(ownerId)
  if (matchGlobalAgentInstructionPath(locations, filePath) !== null) {
    const assertSameAsMatched = (path: string): void => {
      if (path !== filePath) throw new GlobalAgentInstructionAccessDeniedError()
    }
    // 全体の規則で断られても、許可フォルダの規則で通れば許す。~/.claude がホームの外へのリンクで、利用者が ~/.claude そのものを
    // 開いた場合、変更前は許可フォルダの中として読み書きできたため(今の規則より広げない)。どちらも通らなければ全体の拒否を投げる
    const orWithinFolder = async (
      checkGlobal: () => Promise<unknown>,
      checkFolder: (folder: string) => Promise<unknown>
    ): Promise<void> => {
      try {
        await checkGlobal()
      } catch (err) {
        if (
          !(err instanceof GlobalAgentInstructionAccessDeniedError) ||
          allowedFolder === undefined
        ) {
          throw err
        }
        try {
          await checkFolder(allowedFolder)
        } catch {
          throw err
        }
      }
    }
    return {
      // 渡されたパスが作ったときに照合したパスと違えば、ホームの中でも断る(多重の防御。L-018)
      assertExisting: async (path) => {
        assertSameAsMatched(path)
        await orWithinFolder(
          () => assertResolvedWithinHome(homeDir, path),
          async (folder) => folderAccess.assertWithinFolder(folder, path)
        )
      },
      // 親が無ければ(~/.claude が消えた)realpath の失敗を投げる。フォルダは作らない(作るのは節の 作成 だけ)
      assertRecreatable: async (path) => {
        assertSameAsMatched(path)
        await orWithinFolder(
          () => assertResolvedWithinHome(homeDir, dirname(path)),
          (folder) => assertFileWithinFolder(folderAccess, folder, path)
        )
      },
      toRendererError: (err, operation) => {
        console.error('[fileAccessScope] global instruction file access failed:', err)
        if (err instanceof GlobalAgentInstructionAccessDeniedError) {
          return new Error(
            operation === 'write'
              ? GLOBAL_INSTRUCTION_ACCESS_MESSAGES.deniedWrite
              : GLOBAL_INSTRUCTION_ACCESS_MESSAGES.denied
          )
        }
        if (isMissingPathError(err)) return new Error(GLOBAL_INSTRUCTION_ACCESS_MESSAGES.missing)
        return new Error(GLOBAL_INSTRUCTION_ACCESS_MESSAGES[operation])
      }
    }
  }
  const requireFolder = (): string => {
    if (allowedFolder === undefined) throw new Error('No folder open')
    return allowedFolder
  }
  return {
    assertExisting: async (path) => folderAccess.assertWithinFolder(requireFolder(), path),
    assertRecreatable: async (path) => assertFileWithinFolder(folderAccess, requireFolder(), path),
    toRendererError: (err) =>
      convertFsAccessError(err, `ファイルが見つかりません: ${filePath}`, filePath)
  }
}
