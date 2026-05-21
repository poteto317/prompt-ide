import { PREVIEW_MAX } from '../config/promptConfig'

export function truncatePreview(content: string): string {
  return content.length > PREVIEW_MAX ? content.slice(0, PREVIEW_MAX) + '…' : content
}
