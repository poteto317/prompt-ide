export interface FilePathParts {
  /** 最後の要素。末尾が / のフォルダは / 付きのまま返す */
  name: string
  /** 親のフォルダのパス。直下なら空文字 */
  dir: string
}

// ソース管理の行で、ファイル名と薄い色のフォルダを分けて出すために使う。パスの区切りは git の出力のとおり / だけを見る。
// git status は未追跡のフォルダを末尾の / 付きで返すため、末尾の / を除いて区切りを探す(名前が空にならないように)
export function splitFilePath(path: string): FilePathParts {
  const end = path.endsWith('/') ? path.length - 1 : path.length
  const lastSlash = path.lastIndexOf('/', end - 1)
  if (lastSlash === -1) return { name: path, dir: '' }
  return { name: path.slice(lastSlash + 1), dir: path.slice(0, lastSlash) }
}
