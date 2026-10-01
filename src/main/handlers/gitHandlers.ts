import { resolve, dirname, basename, join, isAbsolute } from 'path'
import { realpath } from 'node:fs/promises'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { DiscardAllEntry } from '@shared/types'
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
  isStagedRenameDiff,
  push,
  pull,
  fetchRemote,
  checkoutBranch,
  createBranch,
  deleteBranch,
  mergeBranch
} from '../gitService'
import { discardFileChanges, discardHunk, discardAllChanges } from '../gitDiscardService'
import { getStashes, stashPush, stashPop, stashDrop } from '../gitStashService'
import { stageHunk, unstageHunk } from '../gitApply'
import { moveToTrash } from '../trash'
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

// git:discardChanges 用。境界チェックは resolveAndAssertPath と同じく行うが、相対パスは
// realpath で作り直さず、renderer が渡した git status のパス(index の表記)のまま返す。
// 親を realpath するとディスク上の表記(macOS の NFD の日本語ディレクトリ名、大文字小文字を
// 区別しない FS で大文字小文字だけ違うディレクトリ名)に化け、index と一致しなくなる。
// stage 等は表記がずれても何もしないかエラーで止まるだけだが、discard は「追跡済みに一致
// しない」ことから未追跡と誤判定し、追跡済みの変更ファイルをゴミ箱へ移していた(PR レビュー
// 指摘、実機で再現)。シンボリックリンクを経由したパスは、discardFileChanges が未追跡を
// ls-files --others で肯定的に確かめるため、判定不能として拒否される。
// 境界チェックを通っても相対パスが許可フォルダの外を指す場合は、git へ渡さずに拒否する
async function resolveAndAssertStatusRelativePath(
  folderAccess: FolderAccessManager,
  allowedFolder: string,
  filePath: string
): Promise<string> {
  const resolvedPath = await resolveAndAssertPath(folderAccess, allowedFolder, filePath)
  const relativePath = toGitRelativePath(allowedFolder, resolvedPath)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    isAbsolute(relativePath)
  ) {
    throw new Error('Access denied')
  }
  return relativePath
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

// IPC 境界は任意の値を受け付けるため、service 層(startsWith 等)が TypeError で落ちる
// 前に引数の型を検証する。値の中身(実在するブランチか等)の検証は service 層が行う
function assertBranchNameArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid branch name')
}

// force は厳密に boolean だけを受け付ける('true' 等の truthy な値で強制削除されないため)
function assertForceFlagArg(value: unknown): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid force flag')
}

function assertStashMessageArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid stash message')
}

// 値の形式(40 桁の 16 進数)と、現在の一覧にあるかの検証は service 層が行う
function assertStashIdArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid stash id')
}

// パッチの中身(対象ファイルが 1 件だけか等)の検証は service 層が行う
function assertPatchArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid patch')
}

// 実行時の status との一致は service 層が確かめる。ここでは {path: string, status: 2 文字の文字列} の
// 配列であることだけを検証する
function assertDiscardEntriesArg(value: unknown): asserts value is DiscardAllEntry[] {
  const valid =
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.path === 'string' &&
        typeof entry.status === 'string' &&
        entry.status.length === 2
    )
  if (!valid) throw new Error('Invalid entries')
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

  ipcMain.handle('git:discardChanges', async (event: IpcMainInvokeEvent, filePath: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    // git:stage と同じ理由(失敗時のエラーに OS 絶対パスを乗せない)で相対パス化する。
    // ただし表記は index に合わせたまま渡す(resolveAndAssertStatusRelativePath 参照)
    const relativePath = await resolveAndAssertStatusRelativePath(
      folderAccess,
      allowedFolder,
      filePath
    )
    await discardFileChanges(allowedFolder, relativePath, moveToTrash)
  })

  ipcMain.handle(
    'git:discardHunk',
    async (event: IpcMainInvokeEvent, filePath: string, patch: unknown) => {
      const allowedFolder = getAllowedFolder(folderAccess, event)
      assertPatchArg(patch)
      // git:discardChanges と同じく、index の表記のまま相対パス化する
      const relativePath = await resolveAndAssertStatusRelativePath(
        folderAccess,
        allowedFolder,
        filePath
      )
      await discardHunk(allowedFolder, relativePath, patch)
    }
  )

  ipcMain.handle('git:discardAll', async (event: IpcMainInvokeEvent, expected: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    assertDiscardEntriesArg(expected)
    return discardAllChanges(allowedFolder, expected, moveToTrash)
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

  ipcMain.handle('git:push', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    await push(allowedFolder)
  })

  ipcMain.handle('git:pull', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    await pull(allowedFolder)
  })

  ipcMain.handle('git:fetch', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    await fetchRemote(allowedFolder)
  })

  ipcMain.handle('git:checkoutBranch', async (event: IpcMainInvokeEvent, branchName: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    await checkoutBranch(allowedFolder, branchName)
  })

  ipcMain.handle('git:createBranch', async (event: IpcMainInvokeEvent, branchName: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    assertBranchNameArg(branchName)
    await createBranch(allowedFolder, branchName)
  })

  ipcMain.handle(
    'git:deleteBranch',
    async (event: IpcMainInvokeEvent, branchName: unknown, force: unknown) => {
      const allowedFolder = getAllowedFolder(folderAccess, event)
      assertBranchNameArg(branchName)
      assertForceFlagArg(force)
      return deleteBranch(allowedFolder, branchName, force)
    }
  )

  ipcMain.handle('git:mergeBranch', async (event: IpcMainInvokeEvent, branchName: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    assertBranchNameArg(branchName)
    await mergeBranch(allowedFolder, branchName)
  })

  ipcMain.handle('git:getStashes', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    return getStashes(allowedFolder)
  })

  ipcMain.handle('git:stashPush', async (event: IpcMainInvokeEvent, message: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    assertStashMessageArg(message)
    await stashPush(allowedFolder, message)
  })

  ipcMain.handle('git:stashPop', async (event: IpcMainInvokeEvent, sha: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    assertStashIdArg(sha)
    return stashPop(allowedFolder, sha)
  })

  ipcMain.handle('git:stashDrop', async (event: IpcMainInvokeEvent, sha: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    assertStashIdArg(sha)
    await stashDrop(allowedFolder, sha)
  })
}
