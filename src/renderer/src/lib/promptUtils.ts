import type { Prompt } from '../types'
import { PREVIEW_MAX } from '../config/promptConfig'

const segmenter = new Intl.Segmenter()

/**
 * ピン留めされたプロンプトを先頭へ寄せる（安定ソート）。
 * 各グループ（ピン済み / 未ピン）内の相対順序は入力のまま維持する。
 */
export function sortByPinned(prompts: Prompt[]): Prompt[] {
  const pinned: Prompt[] = []
  const unpinned: Prompt[] = []
  for (const p of prompts) {
    if (p.pinned) pinned.push(p)
    else unpinned.push(p)
  }
  return [...pinned, ...unpinned]
}

/**
 * ピン済み/未ピン済みの境界をまたぐ並び替えかどうかを判定する。
 * 境界をまたぐ並び替えは表示順（sortByPinned）と永続化順が食い違うため、
 * データ層・UI層のどちらでもこの関数でスキップ判定を統一する。
 */
export function crossesPinBoundary(a: Prompt, b: Prompt): boolean {
  return !!a.pinned !== !!b.pinned
}

export function truncatePreview(content: string): string {
  const graphemes: string[] = []
  for (const { segment } of segmenter.segment(content)) {
    graphemes.push(segment)
    if (graphemes.length > PREVIEW_MAX) {
      // PREVIEW_MAX を超えた時点で打ち切り、それ以降は走査しない
      return graphemes.slice(0, PREVIEW_MAX).join('') + '…'
    }
  }
  return content
}
