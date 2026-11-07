import { dirname } from 'path'
import type { FolderAccessManager } from './folderAccessManager'
import { isMissingPathError } from './fsErrors'

// ファイルが許可のフォルダの中にあるかの境界の規則(IPC のイベントに依らない)。handlers/fileAccessGuard.ts が
// 再エクスポートし、fileAccessScope.ts(main 直下。許可フォルダの規則の側)はここから直接使う

// 削除済みファイル（もうディスク上に存在しない）に対する stage/unstage を許可するため、
// assertWithinFolder が ENOENT/ENOTDIR で失敗した場合のみ親ディレクトリの境界チェックに
// フォールバックする。ENOTDIR は、祖先パスのコンポーネントがディレクトリではなく
// ファイルに置き換わっていた場合(git checkout でディレクトリだった箇所が同名
// ファイルになった等)に realpath が投げる。ENOENT だけを見ていると、このケースが
// フォールバックをすり抜け、未変換の ENOTDIR がそのままユーザーへ伝播してしまう。
// 親ディレクトリごと削除されている(ネストしたディレクトリが丸ごと消えた)場合は
// assertParentWithinFolder も同様に失敗するため、実体が見つかる祖先に達するまで
// さらに上へ遡る。assertWithinFolder は resolvedPath に対して最初の1回だけ呼び、以降は
// assertParentWithinFolder のみで遡る(既に存在しないと分かっている中間ディレクトリに
// 対して同じ realpath を assertWithinFolder 経由でも重ねて発行する無駄を避けるため)
export async function assertFileWithinFolder(
  folderAccess: FolderAccessManager,
  allowedFolder: string,
  resolvedPath: string
): Promise<void> {
  try {
    await folderAccess.assertWithinFolder(allowedFolder, resolvedPath)
    return
  } catch (err) {
    if (!isMissingPathError(err)) throw err
  }
  let candidate = resolvedPath
  for (;;) {
    const parentPath = dirname(candidate)
    try {
      await folderAccess.assertParentWithinFolder(allowedFolder, parentPath)
      return
    } catch (err) {
      if (!isMissingPathError(err)) throw err
      // ファイルシステムルートまで遡っても実体が見つからない場合は伝播する
      // (dirname はルートで自分自身を返すため、これ以上遡ると無限ループになる)
      if (parentPath === candidate) throw err
      candidate = parentPath
    }
  }
}
