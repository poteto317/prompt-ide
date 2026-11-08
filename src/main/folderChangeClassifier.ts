import { APP_REFS_NAMESPACE } from './agentChangesProtectionRules'
import { isWithinTreeDepth, shouldSkipDir } from './traversalPolicy'

// 開いているフォルダの recursive の監視の通知(fs.watch の filename。根からの相対パス)を分ける(設計書 2026-11-08「変化の分類」)。
// tree: ツリーと git status の両方を取り直す。git: git status だけ(ツリーに出ない深さ・.git の中の確定した書き込み)。ignore: 何もしない。
// 名前の比べ方は大文字小文字を区別する(ツリーの shouldSkipDir と同じ。.git は git が小文字で作る。L-009)。
// イベントの種類(rename・change)は当てにならないので見ない

export type FolderChangeKind = 'tree' | 'git' | 'ignore'

const GIT_DIR = '.git'
/** .git の直下で、git status の結果に関わる名前(index・ブランチ・マージ中か・refs の書き方の 1 つ) */
const GIT_STATUS_FILES = new Set(['index', 'HEAD', 'MERGE_HEAD', 'packed-refs'])
const LOCK_SUFFIX = '.lock'

function splitRelativePath(relativePath: string, platform: NodeJS.Platform): string[] {
  const separator = platform === 'win32' ? /[\\/]/ : /\//
  return relativePath.split(separator).filter((segment) => segment !== '')
}

// .git の中(rest は .git を除いた要素。1 つ以上)。確定した書き込みは .lock の無い名前で届く
function classifyGitDirChange(rest: readonly string[]): FolderChangeKind {
  if (rest[rest.length - 1].endsWith(LOCK_SUFFIX)) return 'ignore'
  if (rest.length === 1 && GIT_STATUS_FILES.has(rest[0])) return 'git'
  if (rest[0] === 'refs') return rest[1] === APP_REFS_NAMESPACE ? 'ignore' : 'git'
  return 'ignore'
}

/** relativePath は fs.watch の filename(根からの相対パス)。null・空文字は分からないので 'tree' */
export function classifyFolderChange(
  relativePath: string | null,
  platform: NodeJS.Platform
): FolderChangeKind {
  if (relativePath === null || relativePath === '') return 'tree'
  const segments = splitRelativePath(relativePath, platform)
  if (segments.length === 0) return 'tree'
  if (segments[0] === GIT_DIR) {
    // .git そのもの: リポジトリかどうかが変わる(.git ファイルはツリーにも出る)
    if (segments.length === 1) return 'tree'
    return classifyGitDirChange(segments.slice(1))
  }
  // 途中に飛ばすディレクトリがあれば、ツリーに出ず git status も取り直さない(ビルドの出力・パッケージの導入の大量の通知)
  if (segments.slice(0, -1).some(shouldSkipDir)) return 'ignore'
  // ツリーに出る深さ(readDirRecursive と同じ isWithinTreeDepth)より深い変化も、git status は変えうる
  return isWithinTreeDepth(segments.length) ? 'tree' : 'git'
}
