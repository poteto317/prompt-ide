import { PREVIEW_MAX } from '../config/promptConfig'

const segmenter = new Intl.Segmenter()

export function truncatePreview(content: string): string {
  const graphemes = [...segmenter.segment(content)].map((s) => s.segment)
  return graphemes.length > PREVIEW_MAX ? graphemes.slice(0, PREVIEW_MAX).join('') + '…' : content
}
