import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadFileBuffer = vi.hoisted(() => vi.fn())
const mockWriteFileContent = vi.hoisted(() => vi.fn())

vi.mock('../fileSystem', () => ({
  readFileBuffer: mockReadFileBuffer,
  writeFileContent: mockWriteFileContent
}))

import { addToGitignore, _getPendingWritesSizeForTest } from '../gitignoreService'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('addToGitignore', () => {
  it('.gitignore が存在しない場合、新規作成して相対パスを書き込む', async () => {
    mockReadFileBuffer.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await addToGitignore('/project', 'dist/')
    expect(mockWriteFileContent).toHaveBeenCalledWith('/project/.gitignore', '/dist/\n')
  })

  it('.gitignore が既存で末尾に改行がある場合、そのまま追記する', async () => {
    mockReadFileBuffer.mockResolvedValue(Buffer.from('node_modules/\n', 'utf-8'))
    await addToGitignore('/project', 'dist/')
    expect(mockWriteFileContent).toHaveBeenCalledWith(
      '/project/.gitignore',
      'node_modules/\n/dist/\n'
    )
  })

  it('.gitignore が既存で末尾に改行が無い場合、改行を補ってから追記する', async () => {
    mockReadFileBuffer.mockResolvedValue(Buffer.from('node_modules/', 'utf-8'))
    await addToGitignore('/project', 'dist/')
    expect(mockWriteFileContent).toHaveBeenCalledWith(
      '/project/.gitignore',
      'node_modules/\n/dist/\n'
    )
  })

  it('.gitignore が CRLF(\\r\\n)改行の場合、追記する行も CRLF にする(改行コードの混在を防ぐ)', async () => {
    // 重複判定(existingLines)は行末の \r を取り除いて比較しているため CRLF でも
    // 正しく動くが、実際の追記は常に \n 決め打ちだった。Windows で作成された
    // CRLF の .gitignore に追記すると、既存行は \r\n のまま新規行だけ \n で
    // 終わるファイルになってしまう
    mockReadFileBuffer.mockResolvedValue(Buffer.from('node_modules/\r\n', 'utf-8'))
    await addToGitignore('/project', 'dist/')
    expect(mockWriteFileContent).toHaveBeenCalledWith(
      '/project/.gitignore',
      'node_modules/\r\n/dist/\r\n'
    )
  })

  it('混在改行(CRLFの行を含むが末尾は LF)の .gitignore に追記する場合、不要な空行を挿入しない', async () => {
    // lineEnding の判定は「ファイル内のどこかに \r\n があるか」(includes)だが、
    // needsNewline の判定を同じ lineEnding(\r\n)への endsWith にすると、
    // 末尾が素の \n で終わっている(既に改行済みの)ファイルまで
    // 「改行が無い」と誤判定し、不要な空行を挿入してしまう。
    // \r\n も \n で終わるため、判定には常に \n の endsWith を使えばよい
    mockReadFileBuffer.mockResolvedValue(Buffer.from('foo\r\nbar\n', 'utf-8'))
    await addToGitignore('/project', 'dist/')
    expect(mockWriteFileContent).toHaveBeenCalledWith(
      '/project/.gitignore',
      'foo\r\nbar\n/dist/\r\n'
    )
  })

  it('同じ行が既に存在する場合、書き込みを行わない', async () => {
    mockReadFileBuffer.mockResolvedValue(Buffer.from('node_modules/\n/dist/\n', 'utf-8'))
    await addToGitignore('/project', 'dist/')
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('末尾に空白を含むファイル名(エスケープ後は末尾が "\\ " になる)が既に .gitignore にある場合、重複追記しない', async () => {
    // 重複チェックは既存行を .trim() してから比較していたため、末尾が
    // "\ "(バックスラッシュ+スペース)のエスケープ済みパターンだと、trim が
    // バックスラッシュの後ろのスペースを削り取ってしまい、今回計算した
    // (trim していない)パターンと一致しなくなり、既に書き込み済みの行を
    // 重複して追記してしまっていた
    mockReadFileBuffer.mockResolvedValue(Buffer.from('notes 1.txt\\ \n', 'utf-8'))
    await addToGitignore('/project', 'notes 1.txt ')
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('パターンの先頭に "/" を付け、選択したファイルだけを無視する(同名ファイルを全階層で巻き込まない)', async () => {
    // git はスラッシュを含まないパターンを全階層でマッチさせるため、
    // "notes.txt" と書くと sub/notes.txt や sub/deep/notes.txt まで無視される。
    // ユーザーが選んだのは 1 ファイルなので、VS Code と同じく先頭に "/" を付けて
    // リポジトリルートからのパスとしてアンカーする(実際に git で再現確認済み)
    mockReadFileBuffer.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await addToGitignore('/project', 'notes.txt')
    expect(mockWriteFileContent).toHaveBeenCalledWith('/project/.gitignore', '/notes.txt\n')
  })

  it('アンカー無しの同じパターンが既に書かれている場合、重複追記しない(手書きの .gitignore との共存)', async () => {
    // 手書きの .gitignore にはアンカー無しの形("dist/")で書かれていることが多い。
    // アンカー付きの "/dist/" と文字列一致しないからと追記すると、意味的に同じ行が
    // 2 行並んでしまう
    mockReadFileBuffer.mockResolvedValue(Buffer.from('node_modules/\n/dist/\n', 'utf-8'))
    await addToGitignore('/project', 'dist/')
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('エスケープ前の生のパターンが既に書かれている場合も、重複追記しない(手書きの .gitignore との共存)', async () => {
    // glob 特殊文字([]等)を含むファイル名を手書きでエスケープせずに
    // .gitignore へ追記しているケースは実際にありうる。重複チェックが
    // escapeGitignorePattern 後の形(pattern/escaped)としか比較しないと、
    // この生の行を「既に無視されている」と認識できず、同じファイルに対する
    // 重複した(意味は同じだが文字列としては別の)行を追記してしまう
    mockReadFileBuffer.mockResolvedValue(Buffer.from('component[Test].tsx\n', 'utf-8'))
    await addToGitignore('/project', 'component[Test].tsx')
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('"!" で始まるファイル名は、既存の無関係な否定パターン行と文字列が一致しても重複と見なさず追記する', async () => {
    // 生の relativePath("!important.txt")をそのまま重複チェックに使うと、
    // 既存の .gitignore にある「!important.txt」という行(本来は
    // "important.txt という別のパターンへの否定(un-ignore)」という
    // 全く別の意味を持つ)と文字列が一致してしまい、「既に無視されている」と
    // 誤判定して書き込みをスキップしてしまう。実際にはエスケープ後の
    // "\!important.txt" は一度も書き込まれておらず、ファイルは無視されない
    mockReadFileBuffer.mockResolvedValue(Buffer.from('!important.txt\n', 'utf-8'))
    await addToGitignore('/project', '!important.txt')
    expect(mockWriteFileContent).toHaveBeenCalledWith(
      '/project/.gitignore',
      '!important.txt\n/\\!important.txt\n'
    )
  })

  it('"#" で始まるファイル名は、既存の無関係なコメント行と文字列が一致しても重複と見なさず追記する', async () => {
    mockReadFileBuffer.mockResolvedValue(Buffer.from('#name\n', 'utf-8'))
    await addToGitignore('/project', '#name')
    expect(mockWriteFileContent).toHaveBeenCalledWith('/project/.gitignore', '#name\n/\\#name\n')
  })

  it('エスケープ前の生のパターンにアンカーが付いている場合も、重複追記しない', async () => {
    mockReadFileBuffer.mockResolvedValue(Buffer.from('/component[Test].tsx\n', 'utf-8'))
    await addToGitignore('/project', 'component[Test].tsx')
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('改行を含むパスは、余分な行を注入してしまうため追加を拒否する', async () => {
    // POSIX では改行もファイル名に使える。エスケープせずに書くと .gitignore に
    // 2 行として書かれ、2 行目はアンカーが無いためリポジトリ全階層の同名ファイルを
    // 無視してしまう(書いた本人には理由が分からないまま無関係なファイルが消える)。
    // git 自身もそのようなパスを .gitignore で無視できないため、拒否が妥当
    mockReadFileBuffer.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await expect(addToGitignore('/project', 'a\nb.txt')).rejects.toThrow()
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('ENOENT/ENOTDIR 以外のエラーは伝播する', async () => {
    mockReadFileBuffer.mockRejectedValue(new Error('permission denied'))
    await expect(addToGitignore('/project', 'dist/')).rejects.toThrow('permission denied')
  })

  it('.gitignore の読み込みが ENOTDIR で失敗した場合も、.gitignore が無いものとして新規作成する', async () => {
    // fsErrors.ts の isMissingPathError は「対象が無い」ことを表す fs エラーを
    // ENOENT だけでなく ENOTDIR(祖先パスのコンポーネントがディレクトリでは
    // なくファイルに置き換わっていた場合)も含めると定義しており、
    // fileAccessGuard.ts や gitHandlers.ts の resolveCanonicalPath は既に
    // この基準に揃えている。ここだけ isEnoentError(ENOENT のみ)のままだと、
    // 同じレース条件で未変換の ENOTDIR がそのままユーザーへ伝播してしまう
    mockReadFileBuffer.mockRejectedValue(Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' }))
    await addToGitignore('/project', 'dist/')
    expect(mockWriteFileContent).toHaveBeenCalledWith('/project/.gitignore', '/dist/\n')
  })

  it('既存の .gitignore が UTF-8 として読み取れない場合、内容を文字化けさせたまま書き戻さずエラーにする', async () => {
    // fs.readFile(path, 'utf-8') は不正なバイト列があってもエラーを投げず、
    // 静かに U+FFFD(置換文字)へ変換してしまう(Node.js の仕様)。この文字列を
    // そのまま書き戻すと、Shift_JIS 等 UTF-8 以外で書かれた .gitignore の
    // 既存内容(日本語コメント等)が読み込んだ瞬間に永続的に文字化けする。
    // gitDiffFormatter.ts の decodeUtf8OrNull(fatal decode)と同じ方式で
    // 検証し、デコードできない場合は書き込まずエラーにする
    const shiftJisBytes = Buffer.from([0x82, 0xa0, 0x0a]) // "あ" の Shift_JIS 表現(不正な UTF-8)
    mockReadFileBuffer.mockResolvedValue(shiftJisBytes)
    await expect(addToGitignore('/project', 'dist/')).rejects.toThrow()
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('ファイル名に "[" "]" を含む場合、gitignore の文字クラス構文と誤認されないようエスケープする', async () => {
    // エスケープしないと "component[Test].tsx" は「component + T/e/s/t のいずれか
    // 1文字 + .tsx」という bracket expression として解釈され、意図したファイルが
    // 無視されなかったり、無関係な似た名前のファイルまで無視されたりする
    mockReadFileBuffer.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await addToGitignore('/project', 'component[Test].tsx')
    expect(mockWriteFileContent).toHaveBeenCalledWith(
      '/project/.gitignore',
      '/component\\[Test\\].tsx\n'
    )
  })

  it('ファイル名に "*" "?" を含む場合、ワイルドカードと誤認されないようエスケープする', async () => {
    mockReadFileBuffer.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await addToGitignore('/project', 'a*b?c.txt')
    expect(mockWriteFileContent).toHaveBeenCalledWith('/project/.gitignore', '/a\\*b\\?c.txt\n')
  })

  it('"#" で始まるファイル名は、コメント行と誤認されないよう先頭をエスケープする', async () => {
    mockReadFileBuffer.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await addToGitignore('/project', '#readme.txt')
    expect(mockWriteFileContent).toHaveBeenCalledWith('/project/.gitignore', '/\\#readme.txt\n')
  })

  it('"!" で始まるファイル名は、否定パターンと誤認されないよう先頭をエスケープする', async () => {
    mockReadFileBuffer.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await addToGitignore('/project', '!important.txt')
    expect(mockWriteFileContent).toHaveBeenCalledWith('/project/.gitignore', '/\\!important.txt\n')
  })

  it('末尾に空白を含むファイル名は、gitignore パーサーに無視されないよう末尾の空白をエスケープする', async () => {
    // git の .gitignore パーサーは、バックスラッシュでエスケープされていない
    // 行末の空白を無視(トリム)する。エスケープしないと、末尾に空白を含む
    // ファイル名(POSIX では有効)が書き込んだ通りにはマッチしなくなる。
    // 途中の空白(ここでは "notes" と "1.txt" の間)はトリム対象外なので
    // そのまま、末尾の空白だけをエスケープする
    mockReadFileBuffer.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await addToGitignore('/project', 'notes 1.txt ')
    expect(mockWriteFileContent).toHaveBeenCalledWith('/project/.gitignore', '/notes 1.txt\\ \n')
  })

  it('末尾の連続する空白は、それぞれエスケープする', async () => {
    mockReadFileBuffer.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await addToGitignore('/project', 'trailing  ')
    expect(mockWriteFileContent).toHaveBeenCalledWith('/project/.gitignore', '/trailing\\ \\ \n')
  })

  it('同じフォルダへの並行呼び出しは直列化され、互いの追記を消さない', async () => {
    // read-then-write の間に排他制御が無いと、2つの呼び出しがほぼ同時に来た場合
    // 両方が同じ(古い)内容を読み込み、後勝ちの書き込みが先の追記を消してしまう
    let fileContent = ''
    let resolveFirstRead: (value: Buffer) => void = () => {}
    const firstReadPromise = new Promise<Buffer>((resolve) => {
      resolveFirstRead = resolve
    })
    let readCallCount = 0
    mockReadFileBuffer.mockImplementation(() => {
      readCallCount += 1
      return readCallCount === 1
        ? firstReadPromise
        : Promise.resolve(Buffer.from(fileContent, 'utf-8'))
    })
    mockWriteFileContent.mockImplementation(async (_path: string, content: string) => {
      fileContent = content
    })

    const call1 = addToGitignore('/project', 'dist/')
    const call2 = addToGitignore('/project', 'node_modules/')
    resolveFirstRead(Buffer.from('', 'utf-8'))
    await Promise.all([call1, call2])

    expect(fileContent).toContain('dist/')
    expect(fileContent).toContain('node_modules/')
  })

  it('書き込み完了後、直列化キュー(pendingWrites)から対応するエントリを削除する(メモリリーク防止)', async () => {
    // 完了したフォルダのエントリを削除しないと、長時間稼働のセッションで
    // 多数の異なるフォルダを開いて .gitignore に追加するたびにエントリが
    // 無限に増え続け、プロセスの寿命が尽きるまで解放されないメモリリークになる
    mockReadFileBuffer.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await addToGitignore('/project-a', 'dist/')
    await addToGitignore('/project-b', 'dist/')
    expect(_getPendingWritesSizeForTest()).toBe(0)
  })

  it('書き込みが失敗した場合も、直列化キューから対応するエントリを削除する', async () => {
    mockReadFileBuffer.mockRejectedValue(new Error('permission denied'))
    await expect(addToGitignore('/project', 'dist/')).rejects.toThrow('permission denied')
    expect(_getPendingWritesSizeForTest()).toBe(0)
  })
})
