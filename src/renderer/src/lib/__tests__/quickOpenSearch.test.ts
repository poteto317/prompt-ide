import { describe, it, expect } from 'vitest'
import { flattenFileTree, searchFiles } from '../quickOpenSearch'
import type { FileTreeNode, FileNode } from '../../types'

const file = (name: string, path: string): FileNode => ({ name, path, type: 'file' })
const dir = (name: string, path: string, children?: FileTreeNode[]): FileTreeNode => ({
  name,
  path,
  type: 'directory',
  children
})

const ROOT = '/project'

const tree: FileTreeNode[] = [
  dir('src', '/project/src', [
    dir('hooks', '/project/src/hooks', [
      file('useFileSystem.ts', '/project/src/hooks/useFileSystem.ts'),
      file('useSettings.ts', '/project/src/hooks/useSettings.ts')
    ]),
    dir('empty', '/project/src/empty'),
    file('App.tsx', '/project/src/App.tsx')
  ]),
  file('README.md', '/project/README.md')
]

describe('flattenFileTree', () => {
  it('ディレクトリを除外しファイルのみを返す', () => {
    expect(flattenFileTree(tree).map((node) => node.name)).toEqual([
      'useFileSystem.ts',
      'useSettings.ts',
      'App.tsx',
      'README.md'
    ])
  })

  it('children を持たないディレクトリがあっても壊れない', () => {
    expect(flattenFileTree([dir('empty', '/project/empty')])).toEqual([])
  })

  it('空のツリーに対して空配列を返す', () => {
    expect(flattenFileTree([])).toEqual([])
  })
})

describe('searchFiles', () => {
  const files = flattenFileTree(tree)

  it('クエリが空のとき全ファイルをハイライトなしで返す', () => {
    const results = searchFiles('', files, ROOT)
    expect(results).toHaveLength(4)
    expect(results[0].nameIndices).toEqual([])
    expect(results[0].directoryIndices).toEqual([])
  })

  it('クエリが空のとき limit 件までに切り詰める', () => {
    expect(searchFiles('', files, ROOT, 2)).toHaveLength(2)
  })

  it('ファイル名にマッチしたとき nameIndices を返す', () => {
    const results = searchFiles('usfs', files, ROOT)
    expect(results[0].node.name).toBe('useFileSystem.ts')
    expect(results[0].nameIndices).toEqual([0, 1, 3, 7])
    expect(results[0].directoryIndices).toEqual([])
  })

  it('ルートからの相対ディレクトリを directory として返す', () => {
    const results = searchFiles('usfs', files, ROOT)
    expect(results[0].directory).toBe('src/hooks')
  })

  it('ルート直下のファイルの directory は空文字列になる', () => {
    const results = searchFiles('readme', files, ROOT)
    expect(results[0].directory).toBe('')
  })

  it('ファイル名にマッチしないがパスにマッチするとき directoryIndices を返す', () => {
    const results = searchFiles('hooks', files, ROOT)
    expect(results.map((r) => r.node.name)).toContain('useFileSystem.ts')
    const hit = results.find((r) => r.node.name === 'useFileSystem.ts')
    expect(hit?.directoryIndices).toEqual([4, 5, 6, 7, 8])
    expect(hit?.nameIndices).toEqual([])
  })

  it('ディレクトリ区切りを含むクエリで名前部分とディレクトリ部分の両方をハイライトする', () => {
    const hit = searchFiles('hooks/use', files, ROOT).find(
      (r) => r.node.name === 'useFileSystem.ts'
    )
    expect(hit?.directoryIndices).toEqual([4, 5, 6, 7, 8])
    expect(hit?.nameIndices).toEqual([0, 1, 2])
  })

  it('ファイル名一致をパス一致より上位に並べる', () => {
    // 'src' はファイル名 'useFileSystem.ts' には無いがパスには含まれる。
    // 一方 'useSettings.ts' は名前自体に s/r/... を含まないため、ここでは
    // 名前一致する 'App.tsx' 系ではなく明示的な組み合わせで検証する。
    const results = searchFiles('set', files, ROOT)
    expect(results[0].node.name).toBe('useSettings.ts')
  })

  it('マッチしないファイルを除外する', () => {
    expect(searchFiles('zzzz', files, ROOT)).toEqual([])
  })

  it('マッチ結果を limit 件までに切り詰める', () => {
    expect(searchFiles('s', files, ROOT, 1)).toHaveLength(1)
  })

  it('スコア同点のときファイル名が短い候補を上位に並べる', () => {
    // 同じ位置がマッチする場合、クエリがより多くを占めるファイル名のほうが目的に近い。
    // (例: coverage の生成物 useFileSystem.ts.html より本体の useFileSystem.ts)
    const candidates = [
      file('useFileSystem.ts.html', '/project/coverage/useFileSystem.ts.html'),
      file('useFileSystem.ts', '/project/src/useFileSystem.ts')
    ]
    expect(searchFiles('usfs', candidates, ROOT)[0].node.name).toBe('useFileSystem.ts')
  })

  it('スコア同点のとき相対パス昇順で安定した順序を返す', () => {
    const sameNameFiles = [
      file('a.ts', '/project/z/a.ts'),
      file('a.ts', '/project/a/a.ts'),
      file('a.ts', '/project/m/a.ts')
    ]
    expect(searchFiles('a.ts', sameNameFiles, ROOT).map((r) => r.directory)).toEqual([
      'a',
      'm',
      'z'
    ])
  })

  it('Windows 形式のパス区切りでも相対ディレクトリを正しく求める', () => {
    const windowsFiles = [file('App.tsx', 'C:\\project\\src\\App.tsx')]
    const results = searchFiles('app', windowsFiles, 'C:\\project')
    expect(results[0].directory).toBe('src')
  })
})
