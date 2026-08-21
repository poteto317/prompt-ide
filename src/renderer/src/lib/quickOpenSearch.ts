import type { FileTreeNode, FileNode } from '../types'
import { fuzzyMatch } from './fuzzyMatch'
import {
  isPathAtOrInside,
  normalizePathSeparators,
  stripTrailingSeparators,
  toForwardSlashes
} from './pathUtils'

export type QuickOpenResult = {
  node: FileNode
  /** ルートフォルダからの相対ディレクトリ。ルート直下のファイルは空文字列 */
  directory: string
  score: number
  /** ファイル名にマッチしたか。false ならパス全体でのマッチ */
  matchedName: boolean
  /** node.name 上のハイライト位置 */
  nameIndices: number[]
  /** directory 上のハイライト位置 */
  directoryIndices: number[]
}

/** 一覧に表示する最大件数。増やすほど描画コストが上がるため既定値で打ち切る */
export const DEFAULT_RESULT_LIMIT = 50

/**
 * コードポイント順で比較する。'<' は UTF-16 コードユニット順のため、
 * サロゲートペア(BMP 外の文字)を含むと本来の順序と逆になる
 */
const compareByCodePoint = (a: string, b: string): number => {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const codeA = a.codePointAt(i) as number
    const codeB = b.codePointAt(j) as number
    if (codeA !== codeB) return codeA < codeB ? -1 : 1
    i += codeA > 0xffff ? 2 : 1
    j += codeB > 0xffff ? 2 : 1
  }
  if (i >= a.length && j >= b.length) return 0
  return i >= a.length ? -1 : 1
}

/** ファイルツリーを深さ優先で走査し、ファイルノードだけを表示順のまま平坦化する */
export const flattenFileTree = (nodes: FileTreeNode[]): FileNode[] => {
  const files: FileNode[] = []
  const walk = (currentNodes: FileTreeNode[]): void => {
    for (const node of currentNodes) {
      if (node.type === 'file') {
        files.push(node as FileNode)
        continue
      }
      // main 側の readDirRecursive は深さ上限を超えると children を返さないため、
      // children が undefined でも走査を続けられるようにする
      if (node.children !== undefined) walk(node.children)
    }
  }
  walk(nodes)
  return files
}

/** rootPath 配下のパスを '/' 区切りの相対パスに正規化する */
const toRelativePath = (fullPath: string, rootPath: string | null): string => {
  // ファイルパスの区切り正規化は Windows のパスにだけ効かせる。POSIX の '\\' は
  // ファイル名の一部になり得るため、変換すると別ファイルを同じ扱いにしてしまう
  const normalizedPath = normalizePathSeparators(fullPath)
  if (rootPath === null) return normalizedPath
  const normalizedRoot = stripTrailingSeparators(normalizePathSeparators(rootPath))
  // rootPath が POSIX のルート('/')だと末尾区切りの除去で空文字になる。
  // その場合はフルパスを返さず、先頭の区切りだけ落としてルート相対にする
  if (normalizedRoot.length === 0) return normalizedPath.replace(/^\//, '')
  // 前方一致を生の文字列で見ると、Windows で表記だけ違うルート(例: 'C:\\Project' と
  // 'c:\\project')が別物と判定され、相対ディレクトリに絶対パスが出てしまう
  if (!isPathAtOrInside(normalizedPath, normalizedRoot)) return normalizedPath
  // 表記が違っても長さは同じなので、正規化前の文字列から同じ位置で切り出せる
  return normalizedPath.length <= normalizedRoot.length
    ? ''
    : normalizedPath.slice(normalizedRoot.length + 1)
}

const directoryOf = (relativePath: string): string => {
  const lastSeparator = relativePath.lastIndexOf('/')
  return lastSeparator === -1 ? '' : relativePath.slice(0, lastSeparator)
}

type MatchParts = {
  score: number
  matchedName: boolean
  nameIndices: number[]
  directoryIndices: number[]
}

/**
 * まずファイル名だけで照合し、外れたときにフルの相対パスで照合する。
 * パス側でマッチしたインデックスは、ディレクトリ部とファイル名部に振り分けて返す
 * (区切り文字そのものに乗ったインデックスはどちらにも属さないため捨てる)。
 */
const matchFile = (query: string, name: string, relativePath: string): MatchParts | null => {
  const nameMatch = fuzzyMatch(query, name)
  if (nameMatch !== null) {
    return {
      score: nameMatch.score,
      matchedName: true,
      nameIndices: nameMatch.indices,
      directoryIndices: []
    }
  }

  const pathMatch = fuzzyMatch(query, relativePath)
  if (pathMatch === null) return null

  const nameOffset = relativePath.length - name.length
  const nameIndices: number[] = []
  const directoryIndices: number[] = []
  for (const index of pathMatch.indices) {
    if (index >= nameOffset) {
      nameIndices.push(index - nameOffset)
    } else if (relativePath[index] !== '/') {
      directoryIndices.push(index)
    }
  }
  return { score: pathMatch.score, matchedName: false, nameIndices, directoryIndices }
}

/**
 * ファイル一覧をあいまい検索し、スコア降順に並べて limit 件まで返す。
 * クエリが空のときは絞り込まず、先頭 limit 件をハイライトなしで返す。
 */
export const searchFiles = (
  query: string,
  files: FileNode[],
  rootPath: string | null,
  limit: number = DEFAULT_RESULT_LIMIT
): QuickOpenResult[] => {
  // 照合対象の相対パスは '/' に正規化済みのため、クエリ側も揃える。
  // 揃えないと Windows で 'src\\hooks' のように入力したときに一致しない
  const trimmedQuery = toForwardSlashes(query.trim())

  if (trimmedQuery.length === 0) {
    return files.slice(0, limit).map((node) => ({
      node,
      directory: directoryOf(toRelativePath(node.path, rootPath)),
      score: 0,
      matchedName: false,
      nameIndices: [],
      directoryIndices: []
    }))
  }

  const results: QuickOpenResult[] = []
  for (const node of files) {
    const relativePath = toRelativePath(node.path, rootPath)
    const match = matchFile(trimmedQuery, node.name, relativePath)
    if (match === null) continue
    results.push({
      node,
      directory: directoryOf(relativePath),
      score: match.score,
      matchedName: match.matchedName,
      nameIndices: match.nameIndices,
      directoryIndices: match.directoryIndices
    })
  }

  // VS Code と同様に「パスの途中に紛れ込んだ一致」より「ファイル名の一致」を優先する。
  // スコアへの固定加点ではなく比較キーの順序で表すのは、スコアがクエリ長に比例して
  // 伸びるため、どんな固定値でも十分に長いクエリでは追い越されてしまうため。
  // 同スコアならファイル名の短い順(クエリが占める割合が高いほど目的に近い)、
  // それも同じならパス昇順に固定して、入力のたびに並びが揺れないようにする。
  // 比較に localeCompare を使うと既定ロケール依存('a' < 'Z' になる環境がある)に
  // なるため、環境をまたいで再現するようコードポイント順で決める
  results.sort((a, b) => {
    if (a.matchedName !== b.matchedName) return a.matchedName ? -1 : 1
    if (b.score !== a.score) return b.score - a.score
    if (a.node.name.length !== b.node.name.length) return a.node.name.length - b.node.name.length
    return compareByCodePoint(a.node.path, b.node.path)
  })
  return results.slice(0, limit)
}
