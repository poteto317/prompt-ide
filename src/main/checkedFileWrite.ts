import type { ExternalChangeKind, WriteFileCheckedResult } from '@shared/types'
import type { FolderAccessManager } from './folderAccessManager'
import { createFileContent, readFileContent, writeFileContent } from './fileSystem'
import { isFsError, isMissingPathError } from './fsErrors'
import { assertFileWithinFolder } from './fileWithinFolder'

// 照合付きの保存(設計書「保存の直前の照合」)。許可の確認・照合・書き込み方式の選択を持ち、IPC の受け口
// (fs:writeFileChecked。型の検証とエラーの変換)は handlers/externalChangeHandlers.ts

export interface CheckedFileWriteIo {
  readFile: (path: string) => Promise<string>
  /** 通常の書き込み(既存のファイルを上書きする) */
  writeFile: (path: string, content: string) => Promise<void>
  /** 排他的作成(wx。既に有れば EEXIST) */
  createFile: (path: string, content: string) => Promise<void>
}

const defaultIo: CheckedFileWriteIo = {
  readFile: readFileContent,
  writeFile: writeFileContent,
  createFile: createFileContent
}

// 保存の直前の照合(設計書「保存の直前の照合」)。ディスクの内容が、renderer のタブが最後にディスクと一致した内容
// (savedContent)と同じかを比べる。読み方は fs:readFile と同じ UTF-8。照合と書き込みの間の隙は残る(既知の制約。パターン 1)

type DiskCheckResult = { kind: 'unchanged' } | { kind: 'conflict'; reason: ExternalChangeKind }

export async function checkDiskUnchanged(
  path: string,
  baseContent: string,
  readFile: (path: string) => Promise<string>
): Promise<DiskCheckResult> {
  let disk: string
  try {
    disk = await readFile(path)
  } catch (err) {
    if (isMissingPathError(err)) return { kind: 'conflict', reason: 'deleted' }
    throw err
  }
  return disk === baseContent ? { kind: 'unchanged' } : { kind: 'conflict', reason: 'modified' }
}

export interface CheckedFileWriteRequest {
  folderAccess: FolderAccessManager
  allowedFolder: string
  filePath: string
  content: string
  /** タブが最後にディスクと一致した内容(savedContent)。null は照合せずに書く(上書きの確認で OK の後) */
  baseContent: string | null
}

export async function writeFileChecked(
  { folderAccess, allowedFolder, filePath, content, baseContent }: CheckedFileWriteRequest,
  io: CheckedFileWriteIo = defaultIo
): Promise<WriteFileCheckedResult> {
  // 対象を realpath で解決できたか。できなかった(削除された・ぶら下がったシンボリックリンク)ときは、許可の確認を
  // 親フォルダへ倒し(削除されたファイルを作り直せるよう)、書き込みは排他的作成にする(リンクを辿ってフォルダの外へ
  // 作らない。照合と書き込みの間にファイルが復活した場合も上書きせず modified として返す)
  let resolved = true
  try {
    await folderAccess.assertWithinFolder(allowedFolder, filePath)
  } catch (err) {
    if (!isMissingPathError(err)) throw err
    resolved = false
    await assertFileWithinFolder(folderAccess, allowedFolder, filePath)
  }
  if (baseContent !== null) {
    const check = await checkDiskUnchanged(filePath, baseContent, io.readFile)
    if (check.kind === 'conflict') return check
  }
  if (resolved) {
    await io.writeFile(filePath, content)
    return { kind: 'written' }
  }
  try {
    await io.createFile(filePath, content)
  } catch (err) {
    if (isFsError(err, 'EEXIST')) return { kind: 'conflict', reason: 'modified' }
    throw err
  }
  return { kind: 'written' }
}
