import type { FileTreeNode } from '../types'
import { isSamePlainData } from './plainDataEquality'

// 静かな読み直しで、内容が同じツリーを置き換えない(ツリーと指示ファイルの節を描き直さない)ための比べ(設計書 2026-11-08)。
// ツリーは IPC で届いた素のデータなので、各ノードの全部の欄と children を構造で比べる(isSamePlainData。欄を足しても比べ忘れない)。
// main が sortFileTree で並べるので、並びの順のまま比べる。children が無い(undefined)と空の配列は違う

export function isSameFileTree(a: readonly FileTreeNode[], b: readonly FileTreeNode[]): boolean {
  return isSamePlainData(a, b)
}
