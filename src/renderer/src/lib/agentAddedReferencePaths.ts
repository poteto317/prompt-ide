import { isSamePath } from './pathUtils'

// エクスプローラから足したファイルの一覧(絶対パス。足した順)の操作(設計書「エクスプローラ」)。状態は持たない純粋な関数だけを置き、
// 一覧の状態は useAgentReferences が持つ。同じファイルかは区切り・(Windows の)大文字小文字の違いを吸収して判定する(isSamePath)

/** 同じパスがすでに一覧にあるか */
export const hasAddedPath = (paths: readonly string[], absolutePath: string): boolean =>
  paths.some((added) => isSamePath(added, absolutePath))

/** 一覧の末尾へ加える。同じパスがすでにあれば元の一覧(同じ参照)のまま */
export const appendAddedPath = (
  prev: readonly string[],
  absolutePath: string
): readonly string[] => (hasAddedPath(prev, absolutePath) ? prev : [...prev, absolutePath])

/** チップの × で 1 つ外す。外す path はチップに渡した値そのもの(一覧の要素)なので、表記の吸収をせず一致で比べる */
export const removeAddedPath = (prev: readonly string[], path: string): readonly string[] =>
  prev.filter((added) => added !== path)

/** 送れた写しに入れたものだけを外す(後から足したものは残す。L-407) */
export const removeSentPaths = (
  prev: readonly string[],
  sentPaths: readonly string[]
): readonly string[] => prev.filter((path) => !hasAddedPath(sentPaths, path))
