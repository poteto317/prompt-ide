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
