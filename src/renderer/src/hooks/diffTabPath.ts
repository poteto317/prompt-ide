import type { DiffTabKey } from './useDiffTabs'

// EditorPanel のタブバーは実ファイルタブと diff タブを 1 本の文字列キー空間で
// 扱うため、DiffTabKey <-> 文字列パスの相互変換をここに切り出す。
// useDiffTabs（状態管理）とは責務が異なる純粋関数なので分離している。

// ':' はPOSIXで正当なファイル名文字のため、実ファイルパスが偶然
// "diff:staged:"/"diff:unstaged:" から始まる可能性を否定できない
// (この誤認が実際に「diffタブを復帰できない」バグを一度引き起こしている)。
// NUL文字(U+0000)はどのOS・ファイルシステムでもパスに使用できないため、
// マーカー/セパレータに使うことで実ファイルパスとの衝突を原理的に排除する
const SEPARATOR = '\u0000'
const MARKER = `${SEPARATOR}diff${SEPARATOR}`

export function encodeDiffTabPath(key: DiffTabKey): string {
  return `${MARKER}${key.staged ? 'staged' : 'unstaged'}${SEPARATOR}${key.path}`
}

export function isDiffTabPath(path: string): boolean {
  return path.startsWith(MARKER)
}

export function decodeDiffTabPath(encodedPath: string): DiffTabKey {
  const rest = encodedPath.slice(MARKER.length)
  const separatorIndex = rest.indexOf(SEPARATOR)
  const staged = rest.slice(0, separatorIndex) === 'staged'
  const path = rest.slice(separatorIndex + 1)
  return { path, staged }
}
