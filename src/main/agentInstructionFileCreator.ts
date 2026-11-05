// 指示ファイルの作成(設計書 2026-11-05「作成の手順」)。途中の失敗は投げ、受け口が理由に変える
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentInstructionFile } from '@shared/agentInstructionFiles'
import { createFileContent } from './fileSystem'
import { isFsError } from './fsErrors'
import type { FolderAccessManager } from './folderAccessManager'

/**
 * 許可フォルダ(realpath 済み)の下に、表の行の雛形でファイルを作る。既にあるものは決して上書きしない(flag 'wx')。
 * 1 で作ったフォルダは、3 が失敗しても消さない(空のフォルダが残るだけ。消す後始末は、作った後に入った他人の物を消しうる。L-004)
 */
export async function createAgentInstructionFile(
  allowedFolder: string,
  folderAccess: Pick<FolderAccessManager, 'assertParentWithinFolder'>,
  file: AgentInstructionFile
): Promise<void> {
  const [first, second] = file.segments
  let parent = allowedFolder
  let fileName = first
  if (second !== undefined) {
    // 1. 親のフォルダ(.claude・.github)を作る。既にあれば(リンクを含む)そのまま 2 の検証に任せる
    parent = join(allowedFolder, first)
    fileName = second
    try {
      await mkdir(parent)
    } catch (err) {
      if (!isFsError(err, 'EEXIST')) throw err
    }
  }
  // 2. 親を realpath して許可フォルダの中か確かめる(.claude が外へのリンクならここで拒否。L-016)
  const resolvedParent = await folderAccess.assertParentWithinFolder(allowedFolder, parent)
  // 親が通常のファイル(.claude という名前のファイル)なら、ここで ENOTDIR を付けて拒否する。
  // 書き込みの失敗の OS のコードに頼らない(Windows は ENOTDIR でなく ENOENT になり、受け口が exists にできない)
  if (!(await stat(resolvedParent)).isDirectory()) {
    throw Object.assign(new Error(`ENOTDIR: not a directory, '${resolvedParent}'`), {
      code: 'ENOTDIR'
    })
  }
  // 3. 排他的に作る。既にあれば EEXIST、ぶら下がったリンクも辿らない
  await createFileContent(join(resolvedParent, fileName), file.template)
}
