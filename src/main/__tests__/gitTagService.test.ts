import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CreateTagRequest } from '@shared/types'

// simple-git の GitError(git プロセスが失敗した)と、それ以外の失敗(spawn の失敗等)を区別するためのモック
const MockGitError = vi.hoisted(() => class MockGitError extends Error {})
// simple-git のプラグイン(timeout プラグイン等)が投げるエラー。実物と同じく plugin プロパティを持つ
const MockGitPluginError = vi.hoisted(
  () =>
    class MockGitPluginError extends MockGitError {
      plugin?: string
      constructor(_task?: unknown, plugin?: string, message?: string) {
        super(message)
        this.plugin = plugin
      }
    }
)
const mockRaw = vi.hoisted(() => vi.fn())
const mockSimpleGit = vi.hoisted(() => vi.fn(() => ({ raw: mockRaw })))

vi.mock('simple-git', () => ({
  default: mockSimpleGit,
  GitError: MockGitError,
  GitPluginError: MockGitPluginError
}))

import { COMMITTER_UNKNOWN_MESSAGE, TAG_CREATE_TIMEOUT_MS, createTag } from '../gitTagService'

const HEAD_SHA = `${'a'.repeat(40)}\n`
const TAG_SHA = `${'b'.repeat(40)}\n`

type RawOptions = {
  tags?: string[]
  branches?: string[]
  /** for-each-ref の行末(Windows の git で \r\n になる場合の確認用) */
  eol?: string
  /** check-ref-format --normalize の出力。省略時は入力の ref をそのまま返す(成功) */
  normalized?: string
  checkRefFormatRejects?: boolean
  head?: string
  ident?: 'ok' | 'git-error' | 'spawn-error'
  tagError?: Error
  createdTag?: string
  tagsListRejects?: boolean
  branchesListRejects?: boolean
  createdTagRejects?: boolean
}

// 問い合わせを種類で振り分ける。出力の前提は一時ディレクトリの実 git 2.50.1 で確認済み:
// - check-ref-format --normalize は成功時に正規化した ref を出力し、失敗時は終了コード 1・stderr 空
//   (simple-git は reject せず空文字で resolve する)
// - rev-parse -q --verify は ref が無いと空文字で resolve する
// - var GIT_COMMITTER_IDENT はコミッター情報が無いと終了コード 128・stderr ありで reject する
const setupRaw = (o: RawOptions = {}): void => {
  const eol = o.eol ?? '\n'
  mockRaw.mockImplementation(async (args: string[]) => {
    const last = args[args.length - 1]
    if (args[0] === 'check-ref-format') {
      if (o.checkRefFormatRejects === true) throw new MockGitError('fatal')
      return o.normalized ?? `${last}\n`
    }
    if (args[0] === 'for-each-ref' && last === 'refs/tags/') {
      if (o.tagsListRejects === true) throw new MockGitError('fatal: bad object refs/tags/x\n')
      return (o.tags ?? []).map((tag) => `refs/tags/${tag}${eol}`).join('')
    }
    if (args[0] === 'for-each-ref' && last === 'refs/heads/') {
      if (o.branchesListRejects === true) throw new MockGitError('fatal: bad object refs/heads/x\n')
      return (o.branches ?? ['main']).map((branch) => `refs/heads/${branch}${eol}`).join('')
    }
    if (args[0] === 'rev-parse' && last === 'HEAD^{commit}') return o.head ?? HEAD_SHA
    if (args[0] === 'rev-parse' && last.startsWith('refs/tags/')) {
      if (o.createdTagRejects === true) throw new MockGitError('fatal: unable to read refs\n')
      return o.createdTag ?? TAG_SHA
    }
    if (args[0] === 'var') {
      if (o.ident === 'git-error') {
        throw new MockGitError('fatal: unable to auto-detect email address')
      }
      if (o.ident === 'spawn-error') throw new Error('spawn git ENOENT')
      return 'test <test@example.com> 1790000000 +0900\n'
    }
    if (args[0] === 'tag') {
      if (o.tagError !== undefined) throw o.tagError
      return ''
    }
    throw new Error(`unexpected raw: ${args.join(' ')}`)
  })
}

const rawCalls = (): string[][] => mockRaw.mock.calls.map((call) => call[0] as string[])
const calledCommands = (): string[] => rawCalls().map((args) => args[0])
const lightweight = (name: string, message = ''): CreateTagRequest => ({
  name,
  kind: 'lightweight',
  message
})
const annotated = (name: string, message: string): CreateTagRequest => ({
  name,
  kind: 'annotated',
  message
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createTag の実行', () => {
  // tag.gpgSign=true のとき、--no-sign が無いと軽量タグが「署名付きの注釈付きタグ」に変わり、
  // エディタを起動して待つ(実機で確認。パターン 45)
  it('軽量タグは tag --no-sign -- <name> HEAD を呼ぶ(付ける先を HEAD と明示する)', async () => {
    setupRaw()
    await createTag('/project', lightweight('v1.0.0'))
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      timeout: { block: TAG_CREATE_TIMEOUT_MS }
    })
    expect(rawCalls()).toContainEqual(['tag', '--no-sign', '--', 'v1.0.0', 'HEAD'])
  })

  it('軽量タグはメッセージを渡さず、コミッター情報も確認しない', async () => {
    setupRaw({ ident: 'git-error' })
    await createTag('/project', lightweight('v1', 'ignored'))
    expect(rawCalls().find((args) => args[0] === 'tag')).toEqual([
      'tag',
      '--no-sign',
      '--',
      'v1',
      'HEAD'
    ])
    expect(calledCommands()).not.toContain('var')
  })

  // -a(--annotate)を明示すると tag.forceSignAnnotated=true より優先され、署名なしのタグになる
  // (実機 git 2.50.1 で確認)。--message だけで注釈付きになるため -a は付けない(パターン 45)
  it('注釈付きタグは tag --cleanup=whitespace --message=<message> -- <name> HEAD を呼ぶ', async () => {
    setupRaw()
    await createTag('/project', annotated('v1', 'リリース'))
    expect(rawCalls()).toContainEqual([
      'tag',
      '--cleanup=whitespace',
      '--message=リリース',
      '--',
      'v1',
      'HEAD'
    ])
  })

  // -m <値> の 2 引数だと、simple-git が `--upload-pack=...` 等の値をオプションとして拒否する
  // (パターン 49)。--message=<値> の 1 引数なら '-' 始まりも値として渡る(パターン 21)
  it.each(['-x', '--upload-pack=evil', '-c core.pager=evil', '#1 release\n\n本文'])(
    'メッセージ %j は --message=<message> の 1 引数で渡す',
    async (message) => {
      setupRaw()
      await createTag('/project', annotated('v1', message))
      expect(rawCalls()).toContainEqual([
        'tag',
        '--cleanup=whitespace',
        `--message=${message}`,
        '--',
        'v1',
        'HEAD'
      ])
    }
  )

  it('名前 → 衝突 → HEAD → コミッター情報 → 作成 → 作成の確認の順に git を呼ぶ', async () => {
    setupRaw()
    await createTag('/project', annotated('v1', 'm'))
    expect(rawCalls()).toEqual([
      ['check-ref-format', '--normalize', 'refs/tags/v1'],
      ['for-each-ref', '--format=%(refname)', 'refs/tags/'],
      ['for-each-ref', '--format=%(refname)', 'refs/heads/'],
      ['rev-parse', '-q', '--verify', 'HEAD^{commit}'],
      ['var', 'GIT_COMMITTER_IDENT'],
      ['tag', '--cleanup=whitespace', '--message=m', '--', 'v1', 'HEAD'],
      ['rev-parse', '-q', '--verify', 'refs/tags/v1']
    ])
  })
})

describe('名前の検証', () => {
  it.each(['', 'HEAD', 'head', '@'])('%j は git を一切呼ばずに拒否する', async (name) => {
    setupRaw()
    await expect(createTag('/project', lightweight(name))).rejects.toMatchObject({
      message: `タグ名として使用できない名前です: ${name}`
    })
    expect(mockRaw).not.toHaveBeenCalled()
  })

  // check-ref-format 自体にもオプションとして解釈されるため、git に渡す前に弾く(パターン 21)
  it.each(['-x', '--force', '-'])("'-' で始まる %s は git を一切呼ばずに拒否する", async (name) => {
    setupRaw()
    await expect(createTag('/project', lightweight(name))).rejects.toMatchObject({
      message: `\`-\` で始まるタグ名は使用できません: ${name}`
    })
    expect(mockRaw).not.toHaveBeenCalled()
  })

  // check-ref-format の失敗は終了コード 1・stderr 空で、simple-git は空文字で resolve する
  it('check-ref-format の出力が空(規則違反)なら拒否し、一覧を取りに行かない', async () => {
    setupRaw({ normalized: '' })
    await expect(createTag('/project', lightweight('a..b'))).rejects.toMatchObject({
      message: 'タグ名として使用できない名前です: a..b'
    })
    expect(calledCommands()).toEqual(['check-ref-format'])
  })

  it('check-ref-format が reject しても拒否する(判定できないときは拒否側。パターン 74)', async () => {
    setupRaw({ checkRefFormatRejects: true })
    await expect(createTag('/project', lightweight('v1'))).rejects.toMatchObject({
      message: 'タグ名として使用できない名前です: v1'
    })
    expect(calledCommands()).toEqual(['check-ref-format'])
  })

  // 'a//b' は --normalize で refs/tags/a/b に正規化され成功扱いになる。入力と違う名前は通さない(パターン 25)
  it('正規化で別の名前になる入力は拒否する', async () => {
    setupRaw({ normalized: 'refs/tags/a/b\n' })
    await expect(createTag('/project', lightweight('a//b'))).rejects.toMatchObject({
      message: 'タグ名として使用できない名前です: a//b'
    })
    expect(calledCommands()).not.toContain('tag')
  })
})

// 'é' の NFC(1 文字)と NFD(e + 結合文字)。check-ref-format --normalize は NFD をそのまま返すため、
// 入口で NFC にそろえないと NFC の既存タグとの照合をすり抜ける(実機 git 2.50.1 で確認)
const NFC_E = '\u00e9'
const NFD_E = 'e\u0301'

describe('名前の正規化(前後の空白を除き NFC にそろえる)', () => {
  it('NFD の名前は NFC にそろえて検証・作成・作成の確認を行う', async () => {
    setupRaw()
    await createTag('/project', lightweight(`v1-${NFD_E}`))
    const name = `v1-${NFC_E}`
    expect(rawCalls()).toEqual([
      ['check-ref-format', '--normalize', `refs/tags/${name}`],
      ['for-each-ref', '--format=%(refname)', 'refs/tags/'],
      ['for-each-ref', '--format=%(refname)', 'refs/heads/'],
      ['rev-parse', '-q', '--verify', 'HEAD^{commit}'],
      ['tag', '--no-sign', '--', name, 'HEAD'],
      ['rev-parse', '-q', '--verify', `refs/tags/${name}`]
    ])
  })

  it('注釈付きタグでも NFC の名前を git に渡す', async () => {
    setupRaw()
    await createTag('/project', annotated(NFD_E, 'm'))
    expect(rawCalls()).toContainEqual([
      'tag',
      '--cleanup=whitespace',
      '--message=m',
      '--',
      NFC_E,
      'HEAD'
    ])
  })

  it('前後の空白を除いた名前で作成する', async () => {
    setupRaw()
    await createTag('/project', lightweight(`  ${NFD_E}\t`))
    expect(rawCalls()).toContainEqual(['tag', '--no-sign', '--', NFC_E, 'HEAD'])
  })

  it('NFD の要求は NFC の既存タグとの重複として、NFC の名前で拒否する', async () => {
    setupRaw({ tags: [NFC_E] })
    await expect(createTag('/project', lightweight(NFD_E))).rejects.toMatchObject({
      message: `同じ名前のタグが既に存在します: ${NFC_E}`
    })
    expect(calledCommands()).not.toContain('tag')
  })

  it('NFC の要求は NFD の既存タグとの重複として拒否する', async () => {
    setupRaw({ tags: [NFD_E] })
    await expect(createTag('/project', lightweight(NFC_E))).rejects.toMatchObject({
      message: `同じ名前のタグが既に存在します: ${NFC_E}`
    })
    expect(calledCommands()).not.toContain('tag')
  })

  it('NFD のブランチと同名の NFC の要求は拒否する', async () => {
    setupRaw({ branches: ['main', NFD_E] })
    await expect(createTag('/project', lightweight(NFC_E))).rejects.toMatchObject({
      message: `同じ名前のブランチが存在するため、タグを作成できません: ${NFC_E}`
    })
    expect(calledCommands()).not.toContain('tag')
  })

  // 空白だけの名前は trim で空になり、規則違反(空)として git を呼ばずに拒否する
  it('空白だけの名前は git を一切呼ばずに拒否する', async () => {
    setupRaw()
    await expect(createTag('/project', lightweight('   '))).rejects.toMatchObject({
      message: 'タグ名として使用できない名前です: '
    })
    expect(mockRaw).not.toHaveBeenCalled()
  })
})

describe('衝突の検証', () => {
  it('同じ名前のタグがあれば拒否し、HEAD の確認にも進まない', async () => {
    setupRaw({ tags: ['v1'] })
    await expect(createTag('/project', lightweight('v1'))).rejects.toMatchObject({
      message: '同じ名前のタグが既に存在します: v1'
    })
    expect(calledCommands()).not.toContain('rev-parse')
    expect(calledCommands()).not.toContain('tag')
  })

  it.each([
    ['v1/x', ['v1'], 'v1'],
    ['v1', ['v1/x'], 'v1/x']
  ])('%s は既存のタグ %j と階層が衝突するので拒否する', async (name, tags, existing) => {
    setupRaw({ tags })
    await expect(createTag('/project', lightweight(name))).rejects.toMatchObject({
      message: `既存のタグ ${existing} と名前が衝突します: ${name}`
    })
    expect(calledCommands()).not.toContain('tag')
  })

  // 大文字小文字を区別しない FS では、packed-refs の 'v1' があると 'V1' が作れてしまい、既存のタグの
  // 解決を奪う。loose なら git の英語のエラーになる(実機 git 2.50.1 で確認)。FS に依存させず一律に弾く
  it.each([
    ['V1', ['v1'], 'v1'],
    ['v1', ['V1'], 'V1'],
    ['V1/x', ['v1'], 'v1'],
    ['v1', ['V1/x'], 'V1/x']
  ])(
    '%s は大文字小文字だけが違う既存のタグ %j と衝突するので拒否する',
    async (name, tags, existing) => {
      setupRaw({ tags })
      await expect(createTag('/project', lightweight(name))).rejects.toMatchObject({
        message: `既存のタグ ${existing} と名前が衝突します: ${name}`
      })
      expect(calledCommands()).not.toContain('tag')
    }
  )

  it('前方一致するだけの既存のタグとは衝突しない', async () => {
    setupRaw({ tags: ['v1'] })
    await createTag('/project', lightweight('v10'))
    expect(calledCommands()).toContain('tag')
  })

  // Windows の git で行末が \r\n でも、既存のタグを取りこぼさない(パターン 27)
  it('for-each-ref の行末が \\r\\n でも同名のタグを検出する', async () => {
    setupRaw({ tags: ['v1'], eol: '\r\n' })
    await expect(createTag('/project', lightweight('v1'))).rejects.toMatchObject({
      message: '同じ名前のタグが既に存在します: v1'
    })
  })

  it.each(['feat', 'FEAT'])(
    'ブランチ feat があるとき %s は拒否する(大文字小文字を無視。パターン 43)',
    async (name) => {
      setupRaw({ branches: ['main', 'feat'] })
      await expect(createTag('/project', lightweight(name))).rejects.toMatchObject({
        message: `同じ名前のブランチが存在するため、タグを作成できません: ${name}`
      })
      expect(calledCommands()).not.toContain('rev-parse')
      expect(calledCommands()).not.toContain('tag')
    }
  )

  it('名前が前方一致するだけのブランチがあっても作成する', async () => {
    setupRaw({ branches: ['main', 'feature'] })
    await createTag('/project', lightweight('feat'))
    expect(calledCommands()).toContain('tag')
  })
})

describe('HEAD と注釈付きの検証', () => {
  it('HEAD がコミットを指さなければ拒否し、コミッター情報の確認にも進まない', async () => {
    setupRaw({ head: '' })
    await expect(createTag('/project', annotated('v1', 'm'))).rejects.toMatchObject({
      message: 'コミットが無いため、タグを作成できません'
    })
    expect(calledCommands()).not.toContain('var')
    expect(calledCommands()).not.toContain('tag')
  })

  it.each(['', '   ', ' \n\t '])(
    '注釈付きでメッセージが空白だけ(%j)なら拒否し、コミッター情報を確認しない',
    async (message) => {
      setupRaw()
      await expect(createTag('/project', annotated('v1', message))).rejects.toMatchObject({
        message: '注釈付きタグにはメッセージが必要です'
      })
      expect(calledCommands()).not.toContain('var')
      expect(calledCommands()).not.toContain('tag')
    }
  )

  // spawn の引数に NUL を含められない
  it('注釈付きでメッセージに NUL を含むと拒否する', async () => {
    setupRaw()
    await expect(createTag('/project', annotated('v1', 'a\0b'))).rejects.toMatchObject({
      message: 'メッセージに使用できない文字が含まれています'
    })
    expect(calledCommands()).not.toContain('var')
    expect(calledCommands()).not.toContain('tag')
  })

  it('コミッター情報が解決できなければ(GitError)日本語で拒否し、作成しない', async () => {
    setupRaw({ ident: 'git-error' })
    await expect(createTag('/project', annotated('v1', 'm'))).rejects.toMatchObject({
      message: COMMITTER_UNKNOWN_MESSAGE
    })
    expect(calledCommands()).not.toContain('tag')
  })

  // GitError 以外(git が起動できない等)は「コミッター情報が無い」と誤認させず、そのまま投げる(パターン 74)
  it('git var が GitError 以外で失敗したら、その例外をそのまま投げる', async () => {
    setupRaw({ ident: 'spawn-error' })
    await expect(createTag('/project', annotated('v1', 'm'))).rejects.toMatchObject({
      message: 'spawn git ENOENT'
    })
    expect(calledCommands()).not.toContain('tag')
  })
})

describe('作成の失敗', () => {
  it('git tag が失敗したら git のメッセージを添えて投げる', async () => {
    setupRaw({ tagError: new MockGitError("fatal: tag 'v1' already exists\n") })
    await expect(createTag('/project', lightweight('v1'))).rejects.toMatchObject({
      message: "タグを作成できませんでした: fatal: tag 'v1' already exists"
    })
  })

  // 一覧が取れないと衝突を判定できない。英語の GitError をそのまま見せず、作成もしない(パターン 74)
  it.each([
    ['タグ', { tagsListRejects: true }, 'fatal: bad object refs/tags/x'],
    ['ブランチ', { branchesListRejects: true }, 'fatal: bad object refs/heads/x']
  ])(
    '%sの一覧の取得が reject したら日本語の失敗にし、作成しない',
    async (_kind, options, detail) => {
      setupRaw(options)
      await expect(createTag('/project', lightweight('v1'))).rejects.toMatchObject({
        message: `タグを作成できませんでした: ${detail}`
      })
      expect(calledCommands()).not.toContain('tag')
    }
  )

  // 作成後の確認が reject したら、成功扱いにせず日本語の失敗にする(パターン 69・74)
  it('作成後の確認(rev-parse)が reject したら日本語の失敗にする', async () => {
    setupRaw({ createdTagRejects: true })
    await expect(createTag('/project', lightweight('v1'))).rejects.toMatchObject({
      message: 'タグを作成できませんでした: fatal: unable to read refs'
    })
  })

  // 終了コード 0 でもタグができたとは限らない(パターン 69)
  it('git tag が成功してもタグが無ければ失敗にする', async () => {
    setupRaw({ createdTag: '' })
    await expect(createTag('/project', lightweight('v1'))).rejects.toMatchObject({
      message: 'タグを作成できませんでした'
    })
  })

  // 署名のパスフレーズの入力待ち(pinentry・ssh-keygen)では git tag がいつまでも終わらない(実機 git 2.50.1 で
  // 確認)。simple-git の timeout プラグインで打ち切る。timeout は引数で差し替えられる(統合テスト用)
  it('simple-git に timeout(既定は TAG_CREATE_TIMEOUT_MS、引数で差し替え可)を渡す', async () => {
    setupRaw()
    await createTag('/project', lightweight('v1'), 1500)
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', { timeout: { block: 1500 } })
    expect(TAG_CREATE_TIMEOUT_MS).toBe(120_000)
  })

  it('git tag がタイムアウト(GitPluginError, plugin: timeout)したら日本語の文言にする', async () => {
    setupRaw({
      tagError: new MockGitPluginError(undefined, 'timeout', 'block timeout reached')
    })
    await expect(createTag('/project', annotated('v1', 'm'))).rejects.toMatchObject({
      message: 'タグの作成が時間内に終わりませんでした（署名のパスフレーズの入力待ちなど）: v1'
    })
  })

  it('timeout 以外のプラグインのエラーは従来どおり git のメッセージを添えて投げる', async () => {
    setupRaw({
      tagError: new MockGitPluginError(undefined, 'spawn.after', 'some other plugin error')
    })
    await expect(createTag('/project', annotated('v1', 'm'))).rejects.toMatchObject({
      message: 'タグを作成できませんでした: some other plugin error'
    })
  })
})
