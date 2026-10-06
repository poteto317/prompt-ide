import type { ExternalFileChangeEvent, WriteFileCheckedResult } from '@shared/types'
import type { FileTreeNode } from '../types'

export function openFolder(): Promise<string | null> {
  return window.api.openFolder()
}

export function readDirectory(path: string): Promise<FileTreeNode[]> {
  return window.api.readDirectory(path)
}

export function readFileContent(path: string): Promise<string> {
  return window.api.readFile(path)
}

/**
 * 照合を通さない書き込み(fs:writeFile)。ディスクの内容との照合をしないため、保存には使わない(保存は writeFileContentChecked。
 * IPC は fs:writeFileChecked)。PR #46 の時点で本番のコードからの呼び出しは無い(テストの橋 routeCheckedWrites のみ。削除は別 PR)
 */
export function writeFileContent(path: string, content: string): Promise<void> {
  return window.api.writeFile(path, content)
}

export function createFile(parentPath: string, name: string): Promise<void> {
  return window.api.createFile(parentPath, name)
}

export function createDirectory(parentPath: string, name: string): Promise<void> {
  return window.api.createDirectory(parentPath, name)
}

export function renameEntry(path: string, newName: string): Promise<void> {
  return window.api.renameEntry(path, newName)
}

export function deleteEntry(path: string): Promise<void> {
  return window.api.deleteEntry(path)
}

export function addToGitignore(targetPath: string): Promise<void> {
  return window.api.addToGitignore(targetPath)
}

/** 保存の直前にディスクの内容を照合して書き込む。baseContent が null なら照合せずに書く(上書きの確認の後) */
export function writeFileContentChecked(
  path: string,
  content: string,
  baseContent: string | null
): Promise<WriteFileCheckedResult> {
  return window.api.writeFileChecked(path, content, baseContent)
}

export function setWatchedFiles(paths: string[]): Promise<void> {
  return window.api.setWatchedFiles(paths)
}

export function onExternalFileChange(
  listener: (event: ExternalFileChangeEvent) => void
): () => void {
  return window.api.onExternalFileChange(listener)
}
