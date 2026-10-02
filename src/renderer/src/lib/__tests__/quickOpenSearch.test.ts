import { describe, it, expect } from 'vitest'
import { flattenFileTree, searchFiles, DEFAULT_RESULT_LIMIT } from '../quickOpenSearch'
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

  it('Windows でルートの表記が違っても相対ディレクトリにする', () => {
    // 大文字小文字の違いでルート外と判定すると、相対ディレクトリ欄に
    // ドライブからの絶対パスが出てしまい、パス検索の対象も変わる
    const winFiles: FileNode[] = [
      { name: 'a.ts', path: 'c:\\project\\src\\hooks\\a.ts', type: 'file' }
    ]
    const results = searchFiles('a', winFiles, 'C:\\Project')
    expect(results[0].directory).toBe('src/hooks')
  })

  it('UNC のルートで大文字小文字が違っても相対ディレクトリにする', () => {
    // 正規化後の '//Server/Share' は UNC と判定できないため、比較は正規化前の
    // 値で行う必要がある。判定を誤ると directory に絶対パスが出る
    const uncFiles: FileNode[] = [
      { name: 'a.ts', path: '\\\\Server\\Share\\src\\a.ts', type: 'file' }
    ]
    const results = searchFiles('a', uncFiles, '\\\\server\\share')
    expect(results[0].directory).toBe('src')
  })

  it('POSIX のルートでは UNC のパスをルート相対にしない', () => {
    // ルート特例が種別の判定を迂回すると、UNC が '/server/share/...' という
    // 実在しない表示になる
    const uncFiles: FileNode[] = [
      { name: 'file.ts', path: '\\\\server\\share\\file.ts', type: 'file' }
    ]
    const results = searchFiles('file', uncFiles, '/')
    expect(results[0].directory).toBe('//server/share')
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

  it('スコア同点の並びが実行環境のロケールに依存しない', () => {
    // localeCompare は既定ロケール依存で 'a' < 'Z' と判定する環境がある。
    // 表示順を環境間で再現可能にするため、コードポイント順で決める
    const sameNameFiles = [file('x.ts', '/project/a/x.ts'), file('x.ts', '/project/Z/x.ts')]
    expect(searchFiles('x.ts', sameNameFiles, ROOT).map((r) => r.directory)).toEqual(['Z', 'a'])
  })

  it('BMP 外の文字を含むパスもコードポイント順で並べる', () => {
    // '<' は UTF-16 コードユニット順のため、サロゲートペアで順序が逆転する
    const emoji = '\u{10000}' // U+10000: コードポイントは U+E000 より大きい
    const bmp = '\uE000'
    const sameNameFiles = [
      file('x.ts', `/project/${emoji}/x.ts`),
      file('x.ts', `/project/${bmp}/x.ts`)
    ]
    expect(searchFiles('x.ts', sameNameFiles, ROOT).map((r) => r.directory)).toEqual([bmp, emoji])
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

  it('limit を省略すると既定の上限件数までに切り詰める', () => {
    const many = Array.from({ length: DEFAULT_RESULT_LIMIT + 10 }, (_, i) =>
      file(`a${i}.ts`, `/project/a${i}.ts`)
    )
    expect(searchFiles('a', many, ROOT)).toHaveLength(DEFAULT_RESULT_LIMIT)
    expect(searchFiles('', many, ROOT)).toHaveLength(DEFAULT_RESULT_LIMIT)
  })

  it('前後に空白のあるクエリでも絞り込める', () => {
    expect(searchFiles('  app  ', files, ROOT).map((r) => r.node.name)).toEqual(['App.tsx'])
  })

  it('空白のみのクエリは空クエリとして扱う', () => {
    expect(searchFiles('   ', files, ROOT)).toHaveLength(4)
  })

  it('rootPath が null のときフルパスからディレクトリを求める', () => {
    const results = searchFiles('app', files, null)
    expect(results[0].directory).toBe('/project/src')
  })

  it('rootPath 配下にないファイルはフルパスのまま扱う', () => {
    const outside = [file('other.ts', '/elsewhere/other.ts')]
    expect(searchFiles('other', outside, ROOT)[0].directory).toBe('/elsewhere')
  })

  it('末尾に区切りのある rootPath でも相対ディレクトリを正しく求める', () => {
    expect(searchFiles('app', files, '/project/')[0].directory).toBe('src')
  })

  it('nameIndices は node.name 上の位置を指す', () => {
    const hit = searchFiles('app', files, ROOT)[0]
    const matched = hit.nameIndices.map((i) => hit.node.name[i]).join('')
    expect(matched.toLowerCase()).toBe('app')
  })

  it('directoryIndices は directory 上の位置を指す', () => {
    const hit = searchFiles('hooks', files, ROOT).find((r) => r.node.name === 'useFileSystem.ts')
    const matched = hit?.directoryIndices.map((i) => hit.directory[i]).join('')
    expect(matched).toBe('hooks')
  })

  it('rootPath がルート(/)でもルートからの相対ディレクトリを返す', () => {
    // 末尾区切りを落とすと空文字になるため、素朴に実装するとフルパスのままになる
    const rootFiles = [file('App.tsx', '/project/src/App.tsx')]
    expect(searchFiles('app', rootFiles, '/')[0].directory).toBe('project/src')
  })

  it('クエリが長くてもファイル名一致をパス一致より必ず上位に並べる', () => {
    // スコアへの固定加点で優先度を表すと、クエリが長いほどスコア差が広がり、
    // 加点を超えた時点でパスだけ一致した候補がファイル名一致を追い越す。
    // 下記は 90 文字のクエリでスコア差が 1000 を超える構成
    const query = Array.from({ length: 90 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('')
    const spreadName = `${query.split('').join('00000')}.ts`
    const boundaryPath = query.split('').join('/')
    const candidates = [
      // パス側は各文字が区切り直後(単語境界)で高スコア。ファイル名には一致しない
      file('zzz.ts', `/project/${boundaryPath}/zzz.ts`),
      // ファイル名側は読み飛ばしが多く低スコア
      file(spreadName, `/project/x/${spreadName}`)
    ]
    const results = searchFiles(query, candidates, ROOT)
    expect(results[0].node.name).toBe(spreadName)
    expect(results[0].matchedName).toBe(true)
  })

  it('ファイル名一致かどうかを matchedName で示す', () => {
    const nameHit = searchFiles('app', files, ROOT)[0]
    expect(nameHit.matchedName).toBe(true)
    const pathHit = searchFiles('hooks', files, ROOT).find(
      (r) => r.node.name === 'useFileSystem.ts'
    )
    expect(pathHit?.matchedName).toBe(false)
  })

  it('クエリの区切り文字が \\ でもパス検索にヒットする', () => {
    // 照合対象の相対パスは / に正規化されているため、クエリ側も揃えないと
    // Windows で src\\hooks のように入力したときに 0 件になる
    const hit = searchFiles('hooks\\use', files, ROOT).find(
      (r) => r.node.name === 'useFileSystem.ts'
    )
    expect(hit).toBeDefined()
    expect(hit?.directoryIndices).toEqual([4, 5, 6, 7, 8])
    expect(hit?.nameIndices).toEqual([0, 1, 2])
  })

  it('Windows 形式のパス区切りでも相対ディレクトリを正しく求める', () => {
    const windowsFiles = [file('App.tsx', 'C:\\project\\src\\App.tsx')]
    const results = searchFiles('app', windowsFiles, 'C:\\project')
    expect(results[0].directory).toBe('src')
  })
})

describe('compareByCodePoint（サロゲートペアを含むパスのソート安定性）', () => {
  // compareByCodePoint は UTF-16 '<' に頼らず codePointAt で比較する。
  // BMP 外の文字（例: 絵文字 U+1F600 = サロゲートペア 2 コードユニット）を
  // 含むパスが混在しても、スコア・名前長が同じならパス順でソートが安定することを確認する。
  it('サロゲートペアを含むファイルパスでもスコア同点ならコードポイント昇順に並ぶ', () => {
    const emoji1 = file('😀file.ts', '/project/😀file.ts')
    const emoji2 = file('😁file.ts', '/project/😁file.ts')
    // 😀 = U+1F600, 😁 = U+1F601; コードポイント昇順で 😀 < 😁
    const files = [emoji2, emoji1]
    const results = searchFiles('file', files, '/project')
    // 両方マッチし、名前長も同じ場合、パスのコードポイント昇順で 😀 が先
    expect(results[0].node.name).toBe('😀file.ts')
    expect(results[1].node.name).toBe('😁file.ts')
  })

  it('サロゲートペアを含むパスが一方のみの場合、短い方（BMP外）が後に来ない', () => {
    // 'a' (U+0061) < '😀' (U+1F600)
    const plain = file('afile.ts', '/project/afile.ts')
    const emoji = file('😀file.ts', '/project/😀file.ts')
    const files = [emoji, plain]
    const results = searchFiles('file', files, '/project')
    expect(results[0].node.name).toBe('afile.ts')
    expect(results[1].node.name).toBe('😀file.ts')
  })

  it('一方がもう一方のプレフィックスであるパスの場合、短いパスが先に並ぶ（L41 対応）', () => {
    // '/project/sub/file.ts' (短) vs '/project/sub/file.ts.bak' (長)
    const shortFile = file('test', '/project/sub/test')
    const longFile = file('test', '/project/sub/test_long')
    // 長い方を先に配列に入れて検索
    const results1 = searchFiles('test', [longFile, shortFile], '/project')
    expect(results1[0].node.path).toBe('/project/sub/test')
    expect(results1[1].node.path).toBe('/project/sub/test_long')

    // 逆に短い方を先に入れても安定する
    const results2 = searchFiles('test', [shortFile, longFile], '/project')
    expect(results2[0].node.path).toBe('/project/sub/test')
    expect(results2[1].node.path).toBe('/project/sub/test_long')
  })

  it('同一パスの項目が複数ある場合、比較結果が 0 になり安定して並ぶ（L40 対応）', () => {
    const file1 = file('dup.ts', '/project/dup.ts')
    const file2 = file('dup.ts', '/project/dup.ts')
    const results = searchFiles('dup', [file1, file2], '/project')
    expect(results).toHaveLength(2)
    expect(results[0].node.path).toBe('/project/dup.ts')
    expect(results[1].node.path).toBe('/project/dup.ts')
  })
})
