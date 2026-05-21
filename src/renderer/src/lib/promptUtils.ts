import { PREVIEW_MAX } from '../config/promptConfig'

const segmenter = new Intl.Segmenter()

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
