import { sep as nodeSep, relative } from 'node:path'

/**
 * OS 固有の区切り文字で表現された相対パスを、フォワードスラッシュ区切りへ正規化する。
 *
 * `path.relative()` は Windows では `\` 区切りの文字列を返すが、simple-git の
 * `status().files[].path` や `.gitignore` のパターンは常に `/` 区切りを前提とする。
 * 区切り文字を揃えないと、Windows 上では相対パスの比較・マッチングが常に不一致になる
 * (未追跡ファイルの疑似diffが生成されない、.gitignore のパターンが効かない、等)。
 *
 * `separator` はテスト用に注入できるようにしている(POSIX 環境で実行される単体テストからも
 * Windows 風の入力を決定的に検証できるようにするため)。省略時は実行環境の `path.sep` を使う。
 */
export function toPosixRelativePath(relativePath: string, separator: string = nodeSep): string {
  return relativePath.split(separator).join('/')
}

/**
 * folderPath 配下の絶対パスを、simple-git や .gitignore が前提とする
 * フォワードスラッシュ区切りの相対パスに変換する。
 */
export function toGitRelativePath(folderPath: string, absolutePath: string): string {
  return toPosixRelativePath(relative(folderPath, absolutePath))
}
