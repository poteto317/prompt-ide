import { resolve, dirname, basename, join } from 'path'
import { realpath } from 'node:fs/promises'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  getGitStatus,
  stageFile,
  unstageFile,
  commit,
  getDiff,
  getLog,
  getBranches,
  getTags,
  amendCommit,
  isStagedRenameDiff
} from '../gitService'
import { stageHunk, unstageHunk } from '../gitApply'
import type { FolderAccessManager } from '../folderAccessManager'
import { toGitRelativePath } from '../pathNormalize'
import { getAllowedFolder, assertFileWithinFolder } from './fileAccessGuard'
import { isMissingPathError } from '../fsErrors'

// git:stage/git:unstage/git:getDiff/git:stageHunk/git:unstageHunk はいずれも
// 「絶対パスへ解決→境界チェック」を行う。手順を変更する際に1箇所直し忘れる
// ことがないよう共通化する。
//
// 既知の制約: allowedFolder(ユーザーが「フォルダを開く」で選んだディレクトリ)が
// リポジトリルートである前提を置いている。git status --porcelain が返すパスは
// 常にリポジトリルート相対のため、リポジトリのサブディレクトリを開くと
// resolve(allowedFolder, filePath) が実在しないパスを組み立て、diff は空、
// stage/unstage/ハンク操作は対象を見つけられなくなる。これは git:stage/git:unstage
// の頃から続く既存の制約で、解消するには git rev-parse --show-toplevel を基準に
// するか getGitStatus が返すパスを allowedFolder 相対へ変換する必要があり、
// gitService 全体のパス基準を変える変更になる
async function resolveAndAssertPath(
  folderAccess: FolderAccessManager,
  allowedFolder: string,
  filePath: string
): Promise<string> {
  const resolvedPath = resolve(allowedFolder, filePath)
  await assertFileWithinFolder(folderAccess, allowedFolder, resolvedPath)
  return resolvedPath
}

// getDiff/stageHunk/unstageHunk は simple-git/git apply へリポジトリルートからの
// 相対パスで渡す必要がある(絶対パスのままだと未追跡ファイルの判定が一致しなかったり、
// 失敗時のエラーメッセージに OS絶対パスが露出したりする)。境界チェック済みの
// 絶対パスをさらに相対パスへ変換してから返す。
// fileSystemHandlers.ts の fs:addToGitignore も同じ「絶対パスへ解決→境界チェック→
// 相対パス化」を必要とするため export する。同じロジックを別実装で持つと、
// 実際に過去(コミット 3faee7e)、Windows での相対パス変換の同じ不具合を
// 両ファイルで個別に修正する必要が生じたため、1箇所にまとめる
export async function resolveAndAssertRelativePath(
  folderAccess: FolderAccessManager,
  allowedFolder: string,
  filePath: string
): Promise<string> {
  const resolvedPath = await resolveAndAssertPath(folderAccess, allowedFolder, filePath)
  // allowedFolder は dialog:openFolder が realpath 済みの値を保持している一方、
  // renderer が持つ node.path は未解決のまま(readDirRecursive が生の folderPath を
  // join するため)。両者をそのまま relative() に掛けると、シンボリックリンクを
  // 経由するパス(macOS の /tmp → /private/tmp 等)で "../../../tmp/..." のように
  // 許可フォルダの外を指す文字列になり、.gitignore には「何も無視しない壊れた行」が
  // 書かれる。境界チェック自体は内部で realpath するため通ってしまい、
  // エラーも出ないまま壊れた結果だけが残る。基準を realpath 側へ揃える。
  // 削除済みファイル(realpath が ENOENT)は assertFileWithinFolder の ENOENT
  // フォールバックが許容する正常な経路なので、解決前のパスで続行する
  // 解決するのは親ディレクトリまでにとどめ、最終コンポーネントはそのまま残す。
  // realpath を丸ごと掛けると対象自体がシンボリックリンクだった場合にリンク先の
  // 実体名へ化けてしまうが、git はリンクをリンク自体として追跡する
  // (git status は "?? link.txt" を返す)。化けたままだと .gitignore に無関係な
  // 実ファイル名が書かれ、diff タブにはリンク先の内容が表示され、ハンク操作は
  // リンク先の index エントリを書き換えてしまう
  const canonicalPath = await resolveCanonicalPath(resolvedPath)
  return toGitRelativePath(allowedFolder, canonicalPath)
}

// 直近の親(dirname)だけを realpath してダメなら未解決のままフォールバックする
// 実装だと、祖先ディレクトリごと削除されている場合(dirname 自体が存在しない)に
// 対応できない。fileAccessGuard.assertFileWithinFolder と同様、実在する祖先が
// 見つかるまで遡る。実在する祖先を realpath した結果へ、削除された中間
// ディレクトリ名をそのまま結合し直すことで、allowedFolder(realpath 済み)との
// 表記の基準を揃える。揃えないと、symlink 境界(macOS の /tmp → /private/tmp 等)
// をまたぐ祖先で toGitRelativePath の relative() 計算が壊れ、
// "../../../tmp/..." のような許可フォルダ外を指す相対パスになる
// (実機で再現確認済み)。ENOENT だけでなく ENOTDIR も遡りの対象にする。祖先パスの
// コンポーネントがディレクトリではなくファイルに置き換わっていた場合
// (git checkout でディレクトリだった箇所が同名ファイルになった等)、realpath は
// ENOTDIR を投げる。ENOENT だけを見ていると、このケースが遡りをすり抜けて
// 即座に throw され、未変換のエラーがそのままユーザーへ伝播してしまう
async function resolveCanonicalPath(resolvedPath: string): Promise<string> {
  let candidate = dirname(resolvedPath)
  let tail = basename(resolvedPath)
  for (;;) {
    try {
      const canonicalParent = await realpath(candidate)
      return join(canonicalParent, tail)
    } catch (err) {
      if (!isMissingPathError(err)) throw err
      const parent = dirname(candidate)
      // ファイルシステムルートまで遡っても実体が見つからない場合は諦めて
      // 未解決のまま返す。境界チェック自体は assertFileWithinFolder が
      // 別途行っているため、ここでの解決失敗は致命的ではない
      if (parent === candidate) return resolvedPath
      tail = join(basename(candidate), tail)
      candidate = parent
    }
  }
}

export function registerGitHandlers(ipcMain: IpcMain, folderAccess: FolderAccessManager): void {
  ipcMain.handle('git:getStatus', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    return getGitStatus(allowedFolder)
  })

  ipcMain.handle('git:stage', async (event: IpcMainInvokeEvent, filePath: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    // 絶対パスのまま stageFile(git add)に渡すと、失敗時の GitError に pathspec
    // として OS 絶対パス(ユーザー名やディレクトリ構造を含む)がそのまま乗り、
    // レンダラーへ伝播してしまう。git:getDiff/stageHunk/unstageHunk と同じ
    // 理由で相対パス化する
    const relativePath = await resolveAndAssertRelativePath(folderAccess, allowedFolder, filePath)
    await stageFile(allowedFolder, relativePath)
  })

  ipcMain.handle(
    'git:unstage',
    async (event: IpcMainInvokeEvent, filePath: string, renamedFrom?: string) => {
      const allowedFolder = getAllowedFolder(folderAccess, event)
      const relativePath = await resolveAndAssertRelativePath(folderAccess, allowedFolder, filePath)
      // 新パスだけを reset すると、旧パスの削除だけが index に残ったまま
      // (D old.txt / ?? new.txt)になり、アンステージのつもりが壊れた状態を
      // 作ってしまう(実機で再現確認済み)。旧パスも境界チェック・相対パス化
      // した上で unstageFile へ渡し、リネーム全体を正しく取り消す
      const relativeRenamedFrom =
        renamedFrom === undefined
          ? undefined
          : await resolveAndAssertRelativePath(folderAccess, allowedFolder, renamedFrom)
      await unstageFile(allowedFolder, relativePath, relativeRenamedFrom)
    }
  )

  ipcMain.handle(
    'git:getDiff',
    async (
      event: IpcMainInvokeEvent,
      filePath: string,
      staged: boolean,
      isUntracked: boolean,
      renamedFrom?: string
    ) => {
      const allowedFolder = getAllowedFolder(folderAccess, event)
      // gitService.getDiff は isStagedRenameDiff(staged, renamedFrom) が true の
      // ときだけ renamedFrom を実際に使う。renderer(useDiffOperations.ts)は
      // staged の値に関わらず gitStatusFiles の from を常に渡すため、staged: false
      // でも律儀に境界チェックすると、gitService 側では使われもしない値の
      // チェック失敗によって、本来成功するはずの未ステージ diff の取得ごと
      // 失敗しうる。旧パスの境界チェック自体は必要(renderer 由来の値をそのまま
      // pathspec へ渡すと、許可フォルダ外を指す文字列で diff を取られる余地が
      // 残るため)だが、実際に使われる場合に限る。gitService.ts 側の判定と
      // 同じ条件を独立に書くと、片方だけ見直されたときに認識がずれるため、
      // 同じ関数を共有する。
      // filePath/renamedFrom の境界チェックは互いに依存しない独立した非同期処理
      // (realpath ベースの fs アクセス)のため、直列に await せず並行して開始する
      const [relativePath, relativeRenamedFrom] = await Promise.all([
        resolveAndAssertRelativePath(folderAccess, allowedFolder, filePath),
        isStagedRenameDiff(staged, renamedFrom)
          ? resolveAndAssertRelativePath(folderAccess, allowedFolder, renamedFrom)
          : Promise.resolve(undefined)
      ])
      return getDiff(allowedFolder, relativePath, staged, isUntracked, relativeRenamedFrom)
    }
  )

  ipcMain.handle(
    'git:stageHunk',
    async (event: IpcMainInvokeEvent, filePath: string, patch: string) => {
      const allowedFolder = getAllowedFolder(folderAccess, event)
      const relativePath = await resolveAndAssertRelativePath(folderAccess, allowedFolder, filePath)
      await stageHunk(allowedFolder, relativePath, patch)
    }
  )

  ipcMain.handle(
    'git:unstageHunk',
    async (event: IpcMainInvokeEvent, filePath: string, patch: string) => {
      const allowedFolder = getAllowedFolder(folderAccess, event)
      const relativePath = await resolveAndAssertRelativePath(folderAccess, allowedFolder, filePath)
      await unstageHunk(allowedFolder, relativePath, patch)
    }
  )

  ipcMain.handle('git:commit', async (event: IpcMainInvokeEvent, message: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    await commit(allowedFolder, message)
  })

  ipcMain.handle('git:getLog', async (event: IpcMainInvokeEvent, limit: number, skip: number) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    return getLog(allowedFolder, limit, skip)
  })

  ipcMain.handle('git:getBranches', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    return getBranches(allowedFolder)
  })

  ipcMain.handle('git:getTags', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    return getTags(allowedFolder)
  })

  ipcMain.handle('git:amendCommit', async (event: IpcMainInvokeEvent, message: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    await amendCommit(allowedFolder, message)
  })
}
