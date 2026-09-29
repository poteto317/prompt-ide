import type { GitFileStatus } from '@shared/types'
import { isIntentToAddFile, isUnstagedFile, isUntrackedFile } from './gitUtils'
import { joinPath } from './pathUtils'

// 変更の取り消しで、ファイルを index の内容へ戻すのではなく OS のゴミ箱へ移すか。
// 履歴に内容が無いもの(未追跡・intent-to-add)が対象。main 側
// (gitService.ts の discardFileChanges)の分類と揃える(片方だけ変えると、確認文言や
// タブの扱いと実際の操作が食い違う)
export function movesToTrashOnDiscard(f: GitFileStatus): boolean {
  return isUntrackedFile(f) || isIntentToAddFile(f)
}

export interface DiscardTarget {
  /** 開いているフォルダ基準の絶対パス(タブ・ツリーとの突き合わせに使う) */
  absolutePath: string
  /** true ならゴミ箱へ移す(確認文言とタブの扱いが変わる) */
  movesToTrash: boolean
}

interface ResolveDiscardTargetOptions {
  folderPath: string | null
  files: GitFileStatus[]
  /** リポジトリ相対パス(git status の表記) */
  path: string
}

// 取り消しの対象を、画面側で必要な情報(絶対パスと扱いの種類)へ解決する。
// 同じパスが 'D '(ステージ済みの削除)と '??' の 2 件で現れることがある
// (git rm --cached の直後など)。取り消しボタンは「変更」セクション(未ステージ)の
// 行にしか無いため、未ステージのエントリだけから探す。一覧に無い場合(status の
// 再取得とのずれ)は追跡済みとして扱う。main 側が実際の状態で判定し直すため、
// ここでのずれは確認文言とタブの扱いにだけ影響する
export function resolveDiscardTarget({
  folderPath,
  files,
  path
}: ResolveDiscardTargetOptions): DiscardTarget | null {
  if (folderPath === null) return null
  const file = files.find((f) => f.path === path && isUnstagedFile(f))
  return {
    absolutePath: joinPath(folderPath, path),
    movesToTrash: file !== undefined && movesToTrashOnDiscard(file)
  }
}
