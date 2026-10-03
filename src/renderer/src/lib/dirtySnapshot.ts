import type { OpenFile } from '../types'

export type DirtySnapshotSource = Pick<OpenFile, 'path' | 'content' | 'savedContent'>

// 未保存のタブの状態を、比較できる文字列にする(useFileSystem の captureDirtySnapshot)。未保存のタブだけを
// [path, 内容] の組にして path の順に並べるため、タブの並べ替えでは値が変わらず、未保存の内容・タブの追加・
// 保存・閉じるで値が変わる。未保存のタブが無ければ '[]'
export function toDirtySnapshot(openFiles: readonly DirtySnapshotSource[]): string {
  return JSON.stringify(
    openFiles
      .filter((f) => f.content !== f.savedContent)
      .map((f) => [f.path, f.content])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  )
}
