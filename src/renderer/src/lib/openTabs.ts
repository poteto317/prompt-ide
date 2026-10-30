import type { OpenFile } from '../types'
import { computeAdjacentItem } from './computeAdjacentItem'
import { isSamePath } from './pathUtils'

// 開いているタブの配列(useFileSystem の openFiles)を扱う純粋な関数。React の状態・ref には触れない

/** path のタブを返す(Windows では大文字小文字だけ違うパスも同じタブ)。path が null・開いていなければ null */
export function findOpenFile(files: readonly OpenFile[], path: string | null): OpenFile | null {
  return path === null ? null : (files.find((f) => isSamePath(f.path, path)) ?? null)
}

/**
 * タブの配列が prev から next に変わり、アクティブなタブ(activePath)が next から消えたときに、次にアクティブにするパス。
 * - 要素数が変わっていない(リネームで自分自身の path が変わった等)なら、消えたように見えた要素の位置に
 *   リネーム後の自分自身等が来ているはずなので、位置で選ぶ(computeAdjacentItem: 右隣を優先)
 * - 要素数が減った(削除。特にディレクトリ削除で配下の複数タブが 1 回で消える)なら、削除された範囲の先頭から prev を
 *   右へ辿り、next にまだあるタブを選ぶ。無ければ左へ辿る。computeAdjacentItem は「1 つの要素が消えた」前提のため、
 *   複数が消えたときに位置で選ぶと、隣の生き残りを飛び越してさらに先のタブを選んでしまう
 * - activePath が prev にも無ければ next の先頭
 * どれも無ければ null
 */
export function pickFallbackActivePath(
  prev: readonly OpenFile[],
  next: readonly OpenFile[],
  activePath: string
): string | null {
  const prevIndex = prev.findIndex((f) => isSamePath(f.path, activePath))
  if (next.length === prev.length) return computeAdjacentItem(next, prevIndex)?.path ?? null
  if (prevIndex === -1) return next[0]?.path ?? null
  for (let i = prevIndex; i < prev.length; i++) {
    const candidate = findOpenFile(next, prev[i].path)
    if (candidate !== null) return candidate.path
  }
  for (let i = prevIndex - 1; i >= 0; i--) {
    const candidate = findOpenFile(next, prev[i].path)
    if (candidate !== null) return candidate.path
  }
  return null
}

/**
 * path のタブだけを disk の内容に置き換えた新しい配列を返す(content と savedContent を同じ値にするので未編集になる)。
 * disk が null(読めなかった・消えた)ならそのタブを除く。他のタブは同じ参照のまま残す
 */
export function replaceTabWithDisk(
  files: readonly OpenFile[],
  path: string,
  disk: string | null
): OpenFile[] {
  return files.flatMap((f) => {
    if (!isSamePath(f.path, path)) return [f]
    return disk === null ? [] : [{ ...f, content: disk, savedContent: disk }]
  })
}
