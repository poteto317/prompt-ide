// IPC で受け取ったパスを「許可フォルダ基準の絶対パスへ解決→境界チェック→git 向けの相対パス化」する部品。
// git:* の受け口(gitHandlers)・fs:addToGitignore(fileSystemHandlers)・agentChanges:*(agentChangesHandlers)が
// 共有する。受け口のファイルどうしで部品を借りないよう、どの受け口にも属さない場所に置く
import { resolve, dirname, basename, join, isAbsolute } from 'path'
import { realpath } from 'node:fs/promises'
import type { FolderAccessManager } from '../folderAccessManager'
import { toGitRelativePath } from '../pathNormalize'
import { assertFileWithinFolder } from './fileAccessGuard'
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
// 境界チェックを通っても相対パスが許可フォルダの外を指す場合は、git へ渡さずに拒否する。
// エージェントの変更の IPC(agentChangesHandlers.ts)も同じ規則を使う
export async function resolveAndAssertStatusRelativePath(
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
