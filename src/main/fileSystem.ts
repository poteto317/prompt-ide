import { join } from 'path'
import { readdir, readFile, writeFile, mkdir, rename, rm, stat, lstat } from 'node:fs/promises'
import { shouldSkipDir, MAX_DEPTH, sortFileTree } from './traversalPolicy'
import { isEnoentError } from './fsErrors'
import type { FileTreeNode } from '@shared/types'

export type { FileTreeNode }

export function readFileContent(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8')
}

// エンコーディングを指定せず生のバイト列を読む。バイナリファイル判定など、
// utf-8 として解釈する前に内容を検査したい呼び出し元向け
export function readFileBuffer(filePath: string): Promise<Buffer> {
  return readFile(filePath)
}

export function writeFileContent(filePath: string, content: string): Promise<void> {
  return writeFile(filePath, content, 'utf-8')
}

// 未追跡ファイルの疑似diff生成(gitDiffFormatter.ts の buildUntrackedDiff)で
// 実行ビットを保つために使う。git 自身(ce_mode_from_stat)は所有者の実行ビット
// (S_IXUSR, 0o100)のみを見て実行可能ファイルかどうかを判定し、グループ/その他の
// 実行ビットは無視する。owner/group/other のいずれかで判定すると、共有
// ディレクトリでグループ実行ビットだけが立っているようなファイルを、実際の
// git add とは異なる mode(100755)で index に記録してしまう。
// Windows(NTFS)には POSIX 相当の実行ビットが無く、Node/libuv はこれを
// 意味のある形で報告できない(多くの環境で全ファイルの mode に実行ビットが
// 立って見える)。誤って 100755 と判定すると、新規作成した通常のテキスト
// ファイルまで stage 時に誤った実行ビットが index に記録されてしまうため、
// Windows では常に false を返す
export async function isExecutableFile(filePath: string): Promise<boolean> {
  if (process.platform === 'win32') return false
  const stats = await stat(filePath)
  return (stats.mode & 0o100) !== 0
}

// シンボリックリンクかどうかを stat ではなく lstat で判定する。stat はリンクを
// 辿った先の実体の情報を返すため、シンボリックリンク自体の判定には使えない
export async function isSymbolicLink(filePath: string): Promise<boolean> {
  const stats = await lstat(filePath)
  return stats.isSymbolicLink()
}

// 未追跡ファイルの疑似diff生成(gitService.ts の getDiff)で、readFileBuffer に
// よる読み込み前にサイズ上限をチェックするために使う
export async function getFileSize(filePath: string): Promise<number> {
  const stats = await stat(filePath)
  return stats.size
}

export async function createFile(filePath: string): Promise<void> {
  // flag 'wx' により既存ファイルを上書きせず EEXIST で失敗する
  await writeFile(filePath, '', { flag: 'wx' })
}

export async function createDirectory(dirPath: string): Promise<void> {
  // recursive なし: 親が存在しなければ ENOENT、既存なら EEXIST で失敗する
  await mkdir(dirPath)
}

export async function renameEntry(oldPath: string, newPath: string): Promise<void> {
  // POSIX の rename は既存ファイルを黙って上書きするため、事前に存在チェックして
  // EEXIST に変換する(チェックと rename の間の TOCTOU はローカル単一ユーザーの
  // デスクトップアプリでは許容範囲とする)。
  // ただし大文字小文字を区別しないFS(macOS APFS既定/Windows)では、大文字小文字のみ
  // 変更するリネーム(readme.md → README.md)で newPath の存在チェックが oldPath 自身に
  // ヒットする。同一エンティティ(dev+ino一致)は「別ファイルへの上書き」ではないため許可する。
  let exists = false
  try {
    const newStat = await stat(newPath)
    const oldStat = await stat(oldPath)
    exists = !(newStat.dev === oldStat.dev && newStat.ino === oldStat.ino)
  } catch (err) {
    // ENOENT(newPath または oldPath が存在しない)以外は握り潰さず伝播する。
    // EACCES 等で存在確認自体ができない場合まで「存在しない」と誤判定すると、
    // POSIX の rename が既存ファイルを黙って上書きしてしまう
    if (!isEnoentError(err)) throw err
  }
  if (exists) {
    const err: NodeJS.ErrnoException = new Error(
      `EEXIST: file already exists, rename '${oldPath}' -> '${newPath}'`
    )
    err.code = 'EEXIST'
    throw err
  }
  await rename(oldPath, newPath)
}

export async function deleteEntry(targetPath: string): Promise<void> {
  await rm(targetPath, { recursive: true })
}

export async function readDirRecursive(dirPath: string, depth = 0): Promise<FileTreeNode[]> {
  if (depth > MAX_DEPTH) return []
  const entries = await readdir(dirPath, { withFileTypes: true })
  const nodes = await Promise.all(
    entries
      .filter((e) => !(e.isDirectory() && shouldSkipDir(e.name)))
      .map(async (e): Promise<FileTreeNode> => {
        const fullPath = join(dirPath, e.name)
        if (e.isDirectory()) {
          return {
            name: e.name,
            path: fullPath,
            type: 'directory',
            children: await readDirRecursive(fullPath, depth + 1)
          }
        }
        return { name: e.name, path: fullPath, type: 'file' }
      })
  )
  return sortFileTree(nodes)
}
