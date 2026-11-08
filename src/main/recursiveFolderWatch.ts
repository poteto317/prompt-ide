import type { FolderWatch, WatchFolder } from './folderChangeWatcher'

// 開いているフォルダの監視の、この環境での張り方(設計書 2026-11-08 の 2 章)。node:fs の watch を FolderChangeWatcher の
// WatchFolder に合わせる。監視の寿命・通知の分類と合流は FolderChangeWatcher が受け持ち、ここは環境ごとの方針だけを持つ

/** node:fs の watch のうち、ここで使う形(recursive・persistent: false) */
export type RecursiveFsWatch = (
  folder: string,
  options: { recursive: true; persistent: false },
  listener: (eventType: string, filename: string | Buffer | null) => void
) => FolderWatch

/**
 * この環境での監視の張り方。Linux は監視しない(全部の子孫に個別の監視を張り、除外を指定できないため。設計書 2 章)。
 * persistent: false で、監視が main プロセスの終了を妨げない
 */
export function createRecursiveFolderWatch(
  platform: NodeJS.Platform,
  fsWatch: RecursiveFsWatch
): WatchFolder | null {
  if (platform === 'linux') return null
  return (folder, listener) => fsWatch(folder, { recursive: true, persistent: false }, listener)
}
