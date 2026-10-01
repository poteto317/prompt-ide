import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRaw = vi.hoisted(() => vi.fn())
const mockSimpleGit = vi.hoisted(() => vi.fn(() => ({ raw: mockRaw })))
const mockFs = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
  stat: vi.fn(),
  lstat: vi.fn(),
  access: vi.fn()
}))

vi.mock('simple-git', () => ({ default: mockSimpleGit }))
vi.mock('fs/promises', () => ({ ...mockFs, default: mockFs }))

import {
  abortMerge,
  completeMerge,
  getConflictFile,
  getConflictMarkerSize,
  parseConflictMarkerSizeAttr,
  keepConflictFile,
  markConflictResolved,
  removeConflictFile,
  resolveConflictBlocks,
  resolveConflictWholeFile
} from '../gitConflictService'
import { digestConflictBlocks, parseConflictFile } from '../gitConflictParser'

const UNRESOLVED_MESSAGE = 'コンフリクト中のファイルではありません'

// ls-files -u -z の 1 エントリ(stage: 1=共通祖先 2=自分 3=相手)
const entry = (path: string, stage: number): string =>
  `100644 0123456789abcdef0123456789abcdef01234567 ${stage}\t${path}\0`

type GitState = {
  unmerged?: string // ls-files -u -z の出力
  mergeHead?: string // rev-parse -q --verify MERGE_HEAD の出力
  markerSizeAttr?: string // check-attr の conflict-marker-size の値(既定 unspecified)
}
let state: GitState

const regularFile = { isFile: () => true, isSymbolicLink: () => false }
const symlink = { isFile: () => false, isSymbolicLink: () => true }
const directory = { isFile: () => false, isSymbolicLink: () => false }
// UTF-8 として不正なバイト列(Shift_JIS の「あ」= 0x82 0xA0)を含む
const sjis = (...l: string[]): Buffer =>
  Buffer.concat(l.map((x) => Buffer.concat([Buffer.from([0x82, 0xa0]), Buffer.from(x + '\n')])))

const gitCalls = (): string[][] => mockRaw.mock.calls.map((c) => c[0] as string[])
// 作業ツリー・index・履歴を変える git の呼び出し
const mutations = (): string[][] =>
  gitCalls().filter((a) => ['add', 'rm', 'checkout', 'commit', 'merge'].includes(a[0]))

const content = [
  'a',
  '<<<<<<< HEAD',
  'mine1',
  '=======',
  'theirs1',
  '>>>>>>> feat',
  'b',
  '<<<<<<< HEAD',
  'mine2',
  '=======',
  'theirs2',
  '>>>>>>> feat',
  ''
].join('\n')

const digestsOf = (text: string): string[] => {
  const p = parseConflictFile(text)
  if (!p) throw new Error('解析できません')
  return digestConflictBlocks(p.segments)
}

beforeEach(() => {
  vi.clearAllMocks()
  state = { unmerged: entry('f.txt', 2) + entry('f.txt', 3), mergeHead: 'abc123\n' }
  mockRaw.mockImplementation(async (args: string[]) => {
    if (args[0] === 'ls-files' && args.includes('-u')) return state.unmerged ?? ''
    if (args[0] === 'rev-parse') return state.mergeHead ?? ''
    if (args[0] === 'check-attr') {
      const path = args[args.length - 1]
      return `${path}\0conflict-marker-size\0${state.markerSizeAttr ?? 'unspecified'}\0`
    }
    return ''
  })
  mockFs.readFile.mockResolvedValue(Buffer.from(content))
  mockFs.writeFile.mockResolvedValue(undefined)
  mockFs.rename.mockResolvedValue(undefined)
  mockFs.unlink.mockResolvedValue(undefined)
  mockFs.stat.mockResolvedValue({ mode: 0o100644 })
  mockFs.lstat.mockResolvedValue(regularFile)
  mockFs.access.mockResolvedValue(undefined)
})

describe('未解決の確認(共通)', () => {
  const notUnmerged = (): void => {
    state.unmerged = ''
  }
  const cases: [string, () => Promise<unknown>][] = [
    ['getConflictFile', () => getConflictFile('/p', 'f.txt')],
    [
      'resolveConflictBlocks',
      () => resolveConflictBlocks('/p', 'f.txt', digestsOf(content), { 0: 'ours' })
    ],
    ['resolveConflictWholeFile', () => resolveConflictWholeFile('/p', 'f.txt', 'ours')],
    ['keepConflictFile', () => keepConflictFile('/p', 'f.txt')],
    ['removeConflictFile', () => removeConflictFile('/p', 'f.txt')],
    ['markConflictResolved', () => markConflictResolved('/p', 'f.txt')]
  ]
  it.each(cases)('%s は未解決でないファイルを拒否し、後続の処理を呼ばない', async (_n, run) => {
    notUnmerged()
    await expect(run()).rejects.toThrow(UNRESOLVED_MESSAGE)
    expect(mutations()).toEqual([])
    expect(mockFs.readFile).not.toHaveBeenCalled()
    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(mockFs.rename).not.toHaveBeenCalled()
  })

  it('別のパスだけが未解決のときも拒否する(完全一致)', async () => {
    state.unmerged = entry('f.txt.bak', 2) + entry('sub/f.txt', 3)
    await expect(markConflictResolved('/p', 'f.txt')).rejects.toThrow(UNRESOLVED_MESSAGE)
  })

  it('ls-files -u を literal pathspec で問い合わせる', async () => {
    await expect(getConflictFile('/p', 'a[1].txt')).rejects.toThrow(UNRESOLVED_MESSAGE)
    expect(gitCalls()[0]).toEqual(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
    expect(gitCalls()[1]).toEqual(['ls-files', '-u', '-z', '--', ':(literal)a[1].txt'])
    expect(mockSimpleGit).toHaveBeenCalledWith('/p')
  })

  // CLI の rebase / cherry-pick 中(MERGE_HEAD が無い)は ours/theirs の意味が違うため拒否する
  it.each(cases)('%s は MERGE_HEAD が無ければ拒否し、後続の処理を呼ばない', async (_n, run) => {
    state.mergeHead = ''
    await expect(run()).rejects.toThrow('マージ中ではないため、コンフリクトを解決できません')
    expect(mutations()).toEqual([])
    expect(gitCalls().some((a) => a[0] === 'ls-files')).toBe(false)
    expect(mockFs.readFile).not.toHaveBeenCalled()
    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(mockFs.rename).not.toHaveBeenCalled()
  })
})

describe('getConflictFile', () => {
  it('ブロックを解析し、ダイジェストと改行コードを返す', async () => {
    const r = await getConflictFile('/p', 'f.txt')
    expect(r.status).toBe('parsed')
    if (r.status !== 'parsed') return
    expect(r.digests).toEqual(digestsOf(content))
    expect(r.digests).toHaveLength(2)
    expect(r.eol).toBe('\n')
    expect(mockFs.readFile).toHaveBeenCalledWith('/p/f.txt')
  })

  const both = { ours: true, theirs: true }

  it('ステージ 2・3 の有無を stages に詰める(両方ある)', async () => {
    const r = await getConflictFile('/p', 'f.txt')
    expect(r.status === 'parsed' && r.stages).toEqual(both)
  })

  it.each([
    ['自分だけ(相手が削除)', entry('f.txt', 1) + entry('f.txt', 2), { ours: true, theirs: false }],
    ['相手だけ(自分が削除)', entry('f.txt', 1) + entry('f.txt', 3), { ours: false, theirs: true }],
    ['祖先だけ(両方が削除)', entry('f.txt', 1), { ours: false, theirs: false }]
  ])('stages: %s', async (_n, unmerged, expected) => {
    state.unmerged = unmerged
    const r = await getConflictFile('/p', 'f.txt')
    expect(r.status === 'parsed' && r.stages).toEqual(expected)
  })

  it('NUL を含むバイナリは unparsable(reason: binary)', async () => {
    mockFs.readFile.mockResolvedValue(Buffer.from([0x41, 0x00, 0x42]))
    expect(await getConflictFile('/p', 'f.txt')).toEqual({
      status: 'unparsable',
      reason: 'binary',
      stages: both
    })
  })

  it('UTF-8 として不正なバイト列は unparsable(reason: markers。書き戻しで壊さない)', async () => {
    mockFs.readFile.mockResolvedValue(Buffer.from([0xff, 0xfe, 0x41]))
    expect(await getConflictFile('/p', 'f.txt')).toEqual({
      status: 'unparsable',
      reason: 'markers',
      stages: both
    })
  })

  it.each([
    ['シンボリックリンク', symlink],
    ['ディレクトリ', directory]
  ])(
    '通常ファイルでない(%s)ときは、中身を読まずに unparsable(reason: not-regular)',
    async (_n, stats) => {
      mockFs.lstat.mockResolvedValue(stats)
      expect(await getConflictFile('/p', 'f.txt')).toEqual({
        status: 'unparsable',
        reason: 'not-regular',
        stages: both
      })
      expect(mockFs.readFile).not.toHaveBeenCalled()
    }
  )

  it('マーカーが壊れていれば unparsable(reason: markers)', async () => {
    mockFs.readFile.mockResolvedValue(Buffer.from('<<<<<<< HEAD\nx\n'))
    expect(await getConflictFile('/p', 'f.txt')).toEqual({
      status: 'unparsable',
      reason: 'markers',
      stages: both
    })
  })

  it('作業ツリーにファイルが無い(readFile が ENOENT)ときは unparsable(reason: missing)', async () => {
    mockFs.readFile.mockRejectedValue(Object.assign(new Error('x'), { code: 'ENOENT' }))
    expect(await getConflictFile('/p', 'f.txt')).toEqual({
      status: 'unparsable',
      reason: 'missing',
      stages: both
    })
  })

  it('作業ツリーにファイルが無い(lstat が ENOENT)ときも reason: missing(DD)', async () => {
    state.unmerged = entry('f.txt', 1)
    mockFs.lstat.mockRejectedValue(Object.assign(new Error('x'), { code: 'ENOENT' }))
    expect(await getConflictFile('/p', 'f.txt')).toEqual({
      status: 'unparsable',
      reason: 'missing',
      stages: { ours: false, theirs: false }
    })
  })
})

describe('resolveConflictBlocks', () => {
  it('選んだブロックだけ解決し、一時ファイルへ書いてから rename する', async () => {
    state.unmerged = entry('dir/f.txt', 2) + entry('dir/f.txt', 3)
    await resolveConflictBlocks('/p', 'dir/f.txt', digestsOf(content), { 0: 'ours' })
    expect(mockFs.writeFile).toHaveBeenCalledTimes(1)
    const [tmp, text] = mockFs.writeFile.mock.calls[0]
    expect(tmp).toMatch(/^\/p\/dir\/f\.txt\.conflict-\d+-\d+\.tmp$/)
    expect(text).toBe(
      ['a', 'mine1', 'b', '<<<<<<< HEAD', 'mine2', '=======', 'theirs2', '>>>>>>> feat', ''].join(
        '\n'
      )
    )
    expect(mockFs.rename).toHaveBeenCalledWith(tmp, '/p/dir/f.txt')
    expect(mockFs.writeFile.mock.invocationCallOrder[0]).toBeLessThan(
      mockFs.rename.mock.invocationCallOrder[0]
    )
    expect(mockFs.unlink).not.toHaveBeenCalled()
  })

  it('CRLF のファイルは CRLF のまま書く', async () => {
    const crlf = content.replace(/\n/g, '\r\n')
    mockFs.readFile.mockResolvedValue(Buffer.from(crlf))
    await resolveConflictBlocks('/p', 'f.txt', digestsOf(crlf), { 0: 'theirs', 1: 'both' })
    expect(mockFs.writeFile.mock.calls[0][1]).toBe(
      ['a', 'theirs1', 'b', 'mine2', 'theirs2', ''].join('\r\n')
    )
  })

  it('既存ファイルの権限を保つ', async () => {
    mockFs.stat.mockResolvedValue({ mode: 0o100755 })
    await resolveConflictBlocks('/p', 'f.txt', digestsOf(content), { 0: 'ours' })
    expect(mockFs.writeFile.mock.calls[0][2]).toEqual({ mode: 0o755 })
  })

  it('ダイジェストが一致しなければ何も書かない', async () => {
    const stale = digestsOf(content.replace('mine1', 'changed'))
    await expect(resolveConflictBlocks('/p', 'f.txt', stale, { 0: 'ours' })).rejects.toThrow(
      'ファイルが変更されたため中止しました。開き直してください'
    )
    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(mockFs.rename).not.toHaveBeenCalled()
  })

  it('ブロック数が違っても(配列として不一致)何も書かない', async () => {
    const [first] = digestsOf(content)
    await expect(resolveConflictBlocks('/p', 'f.txt', [first], { 0: 'ours' })).rejects.toThrow(
      'ファイルが変更されたため中止しました'
    )
    expect(mockFs.writeFile).not.toHaveBeenCalled()
  })

  it('期待のダイジェストの方が多くても(接頭辞が一致しても)何も書かない', async () => {
    await expect(
      resolveConflictBlocks('/p', 'f.txt', [...digestsOf(content), 'extra'], { 0: 'ours' })
    ).rejects.toThrow('ファイルが変更されたため中止しました')
    expect(mockFs.writeFile).not.toHaveBeenCalled()
  })

  it('解析できないファイルは、エディタでの編集を案内して拒否する', async () => {
    mockFs.readFile.mockResolvedValue(Buffer.from('<<<<<<< HEAD\nx\n'))
    await expect(resolveConflictBlocks('/p', 'f.txt', [], {})).rejects.toThrow(
      'コンフリクトのマーカーを解析できません。エディタで直接編集してください'
    )
    expect(mockFs.writeFile).not.toHaveBeenCalled()
  })

  // 番号の範囲検査は parser(applyConflictChoices)が担い、その日本語のメッセージで拒否する
  it.each([
    ['小数', { 0.5: 'ours' }],
    ['負数', { '-1': 'ours' }],
    ['範囲外', { 2: 'ours' }],
    ['数値でないキー', { abc: 'ours' }],
    ['空のキー', { '': 'ours' }],
    ['先頭ゼロのキー', { '01': 'ours' }]
  ])('choices の番号が不正(%s)なら parser の範囲外エラーで、何も書かない', async (_n, choices) => {
    await expect(
      resolveConflictBlocks(
        '/p',
        'f.txt',
        digestsOf(content),
        choices as unknown as Record<number, 'ours'>
      )
    ).rejects.toThrow('ブロックの番号が範囲外です')
    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(mockFs.rename).not.toHaveBeenCalled()
  })

  it.each([
    ['列挙外の値', { 0: 'base' }],
    ['値が文字列でない', { 0: 1 }]
  ])('choices の値が不正(%s)なら Invalid choices で、何も書かない', async (_n, choices) => {
    await expect(
      resolveConflictBlocks(
        '/p',
        'f.txt',
        digestsOf(content),
        choices as unknown as Record<number, 'ours'>
      )
    ).rejects.toThrow('Invalid choices')
    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(mockFs.rename).not.toHaveBeenCalled()
  })

  it('rename に失敗したら一時ファイルの削除を試み、元の例外を投げる', async () => {
    const boom = new Error('rename failed')
    mockFs.rename.mockRejectedValue(boom)
    await expect(
      resolveConflictBlocks('/p', 'f.txt', digestsOf(content), { 0: 'ours' })
    ).rejects.toBe(boom)
    expect(mockFs.unlink).toHaveBeenCalledWith(mockFs.writeFile.mock.calls[0][0])
  })

  it('一時ファイルの削除にも失敗しても、元の例外を投げる', async () => {
    const boom = new Error('write failed')
    mockFs.writeFile.mockRejectedValue(boom)
    mockFs.unlink.mockRejectedValue(new Error('unlink failed'))
    await expect(
      resolveConflictBlocks('/p', 'f.txt', digestsOf(content), { 0: 'ours' })
    ).rejects.toBe(boom)
  })

  it.each([
    ['シンボリックリンク', symlink],
    ['ディレクトリ', directory]
  ])('通常ファイルでない(%s)ときは拒否し、何も読み書きしない', async (_n, stats) => {
    mockFs.lstat.mockResolvedValue(stats)
    await expect(
      resolveConflictBlocks('/p', 'f.txt', digestsOf(content), { 0: 'ours' })
    ).rejects.toThrow('コンフリクトのマーカーを解析できません。エディタで直接編集してください')
    expect(mockFs.readFile).not.toHaveBeenCalled()
    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(mockFs.rename).not.toHaveBeenCalled()
  })

  it('git の index は変えない(解決済みにするのは別の操作)', async () => {
    await resolveConflictBlocks('/p', 'f.txt', digestsOf(content), { 0: 'ours' })
    expect(mutations()).toEqual([])
  })
})

describe('resolveConflictWholeFile', () => {
  it('ours はステージ 2 があれば checkout --ours をリテラル pathspec で呼ぶ', async () => {
    state.unmerged = entry('a[1].txt', 2) + entry('a[1].txt', 3)
    await resolveConflictWholeFile('/p', 'a[1].txt', 'ours')
    expect(mutations()).toEqual([['checkout', '--ours', '--', ':(literal)a[1].txt']])
  })

  it('theirs はステージ 3 があれば checkout --theirs を呼ぶ', async () => {
    await resolveConflictWholeFile('/p', 'f.txt', 'theirs')
    expect(mutations()).toEqual([['checkout', '--theirs', '--', ':(literal)f.txt']])
  })

  it('自分側が無い(ステージ 2 なし)ときの ours を拒否する', async () => {
    state.unmerged = entry('f.txt', 1) + entry('f.txt', 3)
    await expect(resolveConflictWholeFile('/p', 'f.txt', 'ours')).rejects.toThrow(
      'この側にはファイルがありません。「ファイルを残す」か「削除する」を選んでください'
    )
    expect(mutations()).toEqual([])
  })

  it('相手側が無い(ステージ 3 なし)ときの theirs を拒否する', async () => {
    state.unmerged = entry('f.txt', 1) + entry('f.txt', 2)
    await expect(resolveConflictWholeFile('/p', 'f.txt', 'theirs')).rejects.toThrow(
      'この側にはファイルがありません'
    )
    expect(mutations()).toEqual([])
  })

  it('他のパスのステージは数えない', async () => {
    state.unmerged = entry('f.txt', 1) + entry('f.txt', 3) + entry('f.txt.bak', 2)
    await expect(resolveConflictWholeFile('/p', 'f.txt', 'ours')).rejects.toThrow(
      'この側にはファイルがありません'
    )
  })
})

describe('keepConflictFile / removeConflictFile', () => {
  it('keep: 作業ツリーにファイルがあれば git add だけ呼ぶ', async () => {
    state.unmerged = entry('a[1].txt', 1) + entry('a[1].txt', 3)
    await keepConflictFile('/p', 'a[1].txt')
    expect(mutations()).toEqual([['add', '--', ':(literal)a[1].txt']])
  })

  it('keep: 作業ツリーに無ければ、存在するステージ(相手)の版を checkout してから add する', async () => {
    state.unmerged = entry('f.txt', 1) + entry('f.txt', 3)
    mockFs.access.mockRejectedValue(Object.assign(new Error('x'), { code: 'ENOENT' }))
    await keepConflictFile('/p', 'f.txt')
    expect(mutations()).toEqual([
      ['checkout', '--theirs', '--', ':(literal)f.txt'],
      ['add', '--', ':(literal)f.txt']
    ])
  })

  it('keep: 作業ツリーに無く自分だけが残っていれば --ours を使う', async () => {
    state.unmerged = entry('f.txt', 1) + entry('f.txt', 2)
    mockFs.access.mockRejectedValue(Object.assign(new Error('x'), { code: 'ENOENT' }))
    await keepConflictFile('/p', 'f.txt')
    expect(mutations()[0]).toEqual(['checkout', '--ours', '--', ':(literal)f.txt'])
  })

  it('keep: 自分と相手の両方がある(UU)ときは拒否し、何も呼ばない', async () => {
    state.unmerged = entry('f.txt', 1) + entry('f.txt', 2) + entry('f.txt', 3)
    await expect(keepConflictFile('/p', 'f.txt')).rejects.toThrow(
      '「ファイルを残す」はこのファイルでは使えません。ブロックを選ぶか、自分/相手をすべて採用してください'
    )
    expect(mutations()).toEqual([])
  })

  it('keep: AA(ステージ 1 が無く 2 と 3 がある)も拒否する', async () => {
    state.unmerged = entry('f.txt', 2) + entry('f.txt', 3)
    await expect(keepConflictFile('/p', 'f.txt')).rejects.toThrow('使えません')
    expect(mutations()).toEqual([])
  })

  it('remove: git rm -- をリテラル pathspec で呼ぶ', async () => {
    await removeConflictFile('/p', 'f.txt')
    expect(mutations()).toEqual([['rm', '--', ':(literal)f.txt']])
  })
})

describe('markConflictResolved', () => {
  it('マーカーが無ければ git add する', async () => {
    mockFs.readFile.mockResolvedValue(Buffer.from('a\nb\n'))
    await markConflictResolved('/p', 'f.txt')
    expect(mutations()).toEqual([['add', '--', ':(literal)f.txt']])
  })

  it.each([['<<<<<<< HEAD'], ['<<<<<<<'], ['>>>>>>> feat'], ['>>>>>>>']])(
    '行頭の "%s" が残っていれば git add しない',
    async (marker) => {
      mockFs.readFile.mockResolvedValue(Buffer.from(`a\n${marker}\nb\n`))
      await expect(markConflictResolved('/p', 'f.txt')).rejects.toThrow(
        'コンフリクトのマーカーが残っています'
      )
      expect(mutations()).toEqual([])
    }
  )

  it('=======(7 文字)の単独行だけが残っていても、本文(Markdown の見出し下線など)として通す', async () => {
    mockFs.readFile.mockResolvedValue(Buffer.from('Title\n=======\n\nbody\n'))
    await markConflictResolved('/p', 'f.txt')
    expect(mutations()).toEqual([['add', '--', ':(literal)f.txt']])
  })

  it('CRLF のファイルでもマーカーを検出する', async () => {
    mockFs.readFile.mockResolvedValue(Buffer.from('a\r\n>>>>>>> x\r\nb\r\n'))
    await expect(markConflictResolved('/p', 'f.txt')).rejects.toThrow('マーカーが残っています')
  })

  it.each([['  ======='], ['========'], ['<<<<<<<< x'], ['>>>>>>>> x'], ['======'], ['<<<<<< x']])(
    '本文の "%s" はマーカーとみなさない',
    async (line) => {
      mockFs.readFile.mockResolvedValue(Buffer.from(`a\n${line}\nb\n`))
      await markConflictResolved('/p', 'f.txt')
      expect(mutations()).toEqual([['add', '--', ':(literal)f.txt']])
    }
  )

  it.each([['||||||| base'], ['|||||||']])(
    'diff3 の "%s" が残っていれば git add しない',
    async (marker) => {
      mockFs.readFile.mockResolvedValue(Buffer.from(`a\n${marker}\nb\n`))
      await expect(markConflictResolved('/p', 'f.txt')).rejects.toThrow('マーカーが残っています')
      expect(mutations()).toEqual([])
    }
  )

  it('UTF-8 として不正なファイル(Shift_JIS)でも、残ったマーカーを検出する', async () => {
    mockFs.readFile.mockResolvedValue(
      Buffer.concat([sjis('x'), Buffer.from('<<<<<<< HEAD\n'), sjis('y')])
    )
    await expect(markConflictResolved('/p', 'f.txt')).rejects.toThrow(
      'コンフリクトのマーカーが残っています'
    )
    expect(mutations()).toEqual([])
  })

  it('UTF-8 として不正なファイルでマーカーが無ければ git add する', async () => {
    mockFs.readFile.mockResolvedValue(sjis('x', 'y'))
    await markConflictResolved('/p', 'f.txt')
    expect(mutations()).toEqual([['add', '--', ':(literal)f.txt']])
  })

  it('シンボリックリンクは読まずに git add する(リンクの解決は正当な操作)', async () => {
    state.unmerged = entry('link', 2) + entry('link', 3)
    mockFs.lstat.mockResolvedValue(symlink)
    await markConflictResolved('/p', 'link')
    expect(mockFs.readFile).not.toHaveBeenCalled()
    expect(mutations()).toEqual([['add', '--', ':(literal)link']])
  })

  const MISSING_MESSAGE =
    'ファイルが存在しないため解決済みにできません。「削除する」を使うか、ファイルを復元してください'

  it('作業ツリーにファイルが無い(lstat が ENOENT)ときは拒否し、git add しない(add は削除として解決してしまう)', async () => {
    mockFs.lstat.mockRejectedValue(Object.assign(new Error('x'), { code: 'ENOENT' }))
    await expect(markConflictResolved('/p', 'f.txt')).rejects.toThrow(MISSING_MESSAGE)
    expect(mutations()).toEqual([])
  })

  it('lstat の後に消えた(readFile が ENOENT)ときも拒否し、git add しない', async () => {
    mockFs.readFile.mockRejectedValue(Object.assign(new Error('x'), { code: 'ENOENT' }))
    await expect(markConflictResolved('/p', 'f.txt')).rejects.toThrow(MISSING_MESSAGE)
    expect(mutations()).toEqual([])
  })

  it('バイナリはマーカー検査を飛ばして git add する', async () => {
    mockFs.readFile.mockResolvedValue(Buffer.from('\0<<<<<<< x\n=======\n'))
    await markConflictResolved('/p', 'f.txt')
    expect(mutations()).toEqual([['add', '--', ':(literal)f.txt']])
  })
})

describe('completeMerge', () => {
  it('MERGE_HEAD が無ければ拒否し、未解決の確認も commit もしない', async () => {
    state.mergeHead = ''
    await expect(completeMerge('/p')).rejects.toThrow('マージ中ではありません')
    expect(gitCalls().some((a) => a[0] === 'ls-files')).toBe(false)
    expect(mutations()).toEqual([])
  })

  it('MERGE_HEAD の確認が reject されたら、実際の原因をそのまま投げる(「マージ中ではありません」にしない)', async () => {
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') throw new Error('git が失敗')
      return ''
    })
    await expect(completeMerge('/p')).rejects.toThrow('git が失敗')
    expect(mutations()).toEqual([])
  })

  it('未解決が残っていれば拒否し、commit しない', async () => {
    await expect(completeMerge('/p')).rejects.toThrow('未解決のファイルがあるため完了できません')
    expect(gitCalls()[0]).toEqual(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
    expect(gitCalls()[1]).toEqual(['ls-files', '-u', '-z'])
    expect(mutations()).toEqual([])
  })

  it('未解決が無ければ git commit --no-edit を呼ぶ', async () => {
    state.unmerged = ''
    await completeMerge('/p')
    expect(mutations()).toEqual([['commit', '--no-edit']])
  })
})

describe('abortMerge', () => {
  it('MERGE_HEAD が無ければ拒否し、merge --abort を呼ばない', async () => {
    state.mergeHead = ''
    await expect(abortMerge('/p')).rejects.toThrow('マージ中ではありません')
    expect(mutations()).toEqual([])
  })

  it('MERGE_HEAD があれば git merge --abort を呼ぶ', async () => {
    await abortMerge('/p')
    expect(mutations()).toEqual([['merge', '--abort']])
  })
})

describe('サブモジュール(gitlink, mode 160000)のコンフリクト', () => {
  const SUBMODULE_MESSAGE = 'サブモジュールのコンフリクトはターミナルで解決してください'
  // ls-files -u -z の gitlink のエントリ
  const gitlink = (path: string, stage: number): string =>
    `160000 0123456789abcdef0123456789abcdef01234567 ${stage}\t${path}\0`

  beforeEach(() => {
    mockFs.lstat.mockResolvedValue(directory)
  })

  it.each([
    ['UU', [1, 2, 3], { ours: true, theirs: true }],
    ['DU(自分が削除)', [1, 3], { ours: false, theirs: true }],
    ['UD(相手が削除)', [1, 2], { ours: true, theirs: false }]
  ])(
    '%s: getConflictFile は作業ツリーを調べずに reason: submodule を返す',
    async (_n, stageList, stages) => {
      state.unmerged = stageList.map((s) => gitlink('sub', s)).join('')
      expect(await getConflictFile('/p', 'sub')).toEqual({
        status: 'unparsable',
        reason: 'submodule',
        stages
      })
      expect(mockFs.lstat).not.toHaveBeenCalled()
      expect(mockFs.readFile).not.toHaveBeenCalled()
    }
  )

  it('片側だけが gitlink(サブモジュールとファイルの衝突)でも submodule として扱う', async () => {
    state.unmerged = entry('sub', 2) + gitlink('sub', 3)
    expect(await getConflictFile('/p', 'sub')).toMatchObject({ reason: 'submodule' })
  })

  it('別のパスの gitlink は判定に使わない(完全一致)', async () => {
    mockFs.lstat.mockResolvedValue(regularFile)
    state.unmerged = entry('f.txt', 2) + entry('f.txt', 3) + gitlink('f.txt.sub', 2)
    expect(await getConflictFile('/p', 'f.txt')).toMatchObject({ status: 'parsed' })
  })

  const ops: [string, () => Promise<unknown>][] = [
    ['resolveConflictWholeFile(ours)', () => resolveConflictWholeFile('/p', 'sub', 'ours')],
    ['resolveConflictWholeFile(theirs)', () => resolveConflictWholeFile('/p', 'sub', 'theirs')],
    ['keepConflictFile', () => keepConflictFile('/p', 'sub')],
    ['removeConflictFile', () => removeConflictFile('/p', 'sub')],
    ['markConflictResolved', () => markConflictResolved('/p', 'sub')],
    ['resolveConflictBlocks', () => resolveConflictBlocks('/p', 'sub', [], {})]
  ]
  it.each(ops)('%s は UU の gitlink を拒否し、git を書き換えない', async (_n, run) => {
    state.unmerged = gitlink('sub', 1) + gitlink('sub', 2) + gitlink('sub', 3)
    await expect(run()).rejects.toThrow(SUBMODULE_MESSAGE)
    expect(mutations()).toEqual([])
    expect(mockFs.writeFile).not.toHaveBeenCalled()
  })

  it.each(ops)('%s は片側だけの gitlink(DU)も拒否する', async (_n, run) => {
    state.unmerged = gitlink('sub', 1) + gitlink('sub', 3)
    await expect(run()).rejects.toThrow(SUBMODULE_MESSAGE)
    expect(mutations()).toEqual([])
  })
})

// .gitattributes の conflict-marker-size=N のファイルでは、git は N 文字のマーカーを書く
describe('マーカーの長さ(conflict-marker-size)', () => {
  // git(2.50)の ll-merge は値を 10 進の int として厳密に読み(strtol_i)、正でなければ既定の 7。
  // set / unset / 値の後ろのごみ / int の範囲外は警告を出して 7(実 git で確認)
  it.each([
    ['unspecified', 7],
    ['set', 7],
    ['unset', 7],
    ['abc', 7],
    ['0', 7],
    ['-5', 7],
    ['', 7],
    ['10abc', 7],
    ['2147483648', 7],
    ['10', 10],
    ['3', 3],
    ['1', 1],
    ['010', 10],
    ['+10', 10],
    ['2147483647', 2147483647]
  ])('属性の値 "%s" は %i 文字', (value, size) => {
    expect(parseConflictMarkerSizeAttr(`f.txt\0conflict-marker-size\0${value}\0`)).toBe(size)
  })

  it('check-attr の出力が空・壊れていれば 7 文字', () => {
    expect(parseConflictMarkerSizeAttr('')).toBe(7)
    expect(parseConflictMarkerSizeAttr(['f.txt', 'other', '10', ''].join('\0'))).toBe(7)
  })

  it('check-attr を -z と -- の後ろのパスで呼ぶ(ハイフン始まりのパスもオプションにしない)', async () => {
    state.markerSizeAttr = '10'
    const git = { raw: mockRaw } as unknown as Parameters<typeof getConflictMarkerSize>[0]
    await expect(getConflictMarkerSize(git, '-x.md')).resolves.toBe(10)
    expect(gitCalls()).toContainEqual(['check-attr', '-z', 'conflict-marker-size', '--', '-x.md'])
  })

  it('check-attr が失敗したら 7 文字', async () => {
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'check-attr') throw new Error('fatal')
      return ''
    })
    const git = { raw: mockRaw } as unknown as Parameters<typeof getConflictMarkerSize>[0]
    await expect(getConflictMarkerSize(git, 'f.txt')).resolves.toBe(7)
  })

  const content10 = [
    'a',
    '<<<<<<<<<< HEAD',
    'mine',
    '==========',
    'theirs',
    '>>>>>>>>>> feat',
    ''
  ].join('\n')

  it('getConflictFile は属性のサイズでブロックを解析する', async () => {
    state.markerSizeAttr = '10'
    mockFs.readFile.mockResolvedValue(Buffer.from(content10))
    const r = await getConflictFile('/p', 'f.txt')
    expect(r.status === 'parsed' && r.segments).toEqual([
      { kind: 'text', lines: ['a'] },
      {
        kind: 'conflict',
        ours: ['mine'],
        theirs: ['theirs'],
        oursLabel: 'HEAD',
        theirsLabel: 'feat'
      }
    ])
  })

  it('resolveConflictBlocks は属性のサイズで解析し、未選択のブロックを同じ長さで書き戻す', async () => {
    state.markerSizeAttr = '10'
    const two = content10 + content10
    mockFs.readFile.mockResolvedValue(Buffer.from(two))
    const p = parseConflictFile(two, 10)
    if (!p) throw new Error('解析できません')
    await resolveConflictBlocks('/p', 'f.txt', digestConflictBlocks(p.segments), { 0: 'ours' })
    expect(mockFs.writeFile.mock.calls[0][1]).toBe(['a', 'mine', content10].join('\n'))
  })

  it('markConflictResolved は属性のサイズのマーカーが残っていれば git add しない', async () => {
    state.markerSizeAttr = '10'
    mockFs.readFile.mockResolvedValue(Buffer.from('a\n>>>>>>>>>> feat\n'))
    await expect(markConflictResolved('/p', 'f.txt')).rejects.toThrow('マーカーが残っています')
    expect(mutations()).toEqual([])
  })

  it('markConflictResolved はサイズ 10 のとき 7 文字の行を本文として通す', async () => {
    state.markerSizeAttr = '10'
    mockFs.readFile.mockResolvedValue(Buffer.from('a\n<<<<<<< x\n'))
    await markConflictResolved('/p', 'f.txt')
    expect(mutations()).toEqual([['add', '--', ':(literal)f.txt']])
  })
})
