import type { IpcMain } from 'electron'
import { toExternalHref } from '../navigationPolicy'

/**
 * http・https の URL を既定のブラウザで開く。OS へ渡すのは判定を通った正規化済みの href(判定した文字列と開く文字列を
 * ずらさない)。開いたら true、開かない・開けなかった(既定のブラウザが無いなどで reject した)ら false。reject はしない
 */
export async function openExternalLink(
  openExternal: (url: string) => Promise<void>,
  url: unknown
): Promise<boolean> {
  if (typeof url !== 'string') return false
  const href = toExternalHref(url)
  if (href === null) return false
  try {
    await openExternal(href)
    return true
  } catch {
    return false
  }
}

// ターミナルのリンク(OSC 8)を既定のブラウザで開く。http・https だけを開き、ほかは開かずに false を返す
export function registerShellHandlers(
  ipcMain: IpcMain,
  openExternal: (url: string) => Promise<void>
): void {
  ipcMain.handle(
    'shell:openExternalLink',
    (_event, url: unknown): Promise<boolean> => openExternalLink(openExternal, url)
  )
}
