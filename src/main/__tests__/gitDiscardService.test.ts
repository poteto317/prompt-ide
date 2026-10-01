import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DiscardTargetKind } from '../gitDiscardClassifier'

const mockRaw = vi.hoisted(() => vi.fn())
const mockSimpleGit = vi.hoisted(() => vi.fn(() => ({ raw: mockRaw })))

vi.mock('simple-git', () => ({
  default: mockSimpleGit
}))

vi.mock('../gitApply')

// 分類は gitDiscardClassifier.test.ts で検証する。ここでは kind を直接返し、
// kind ごとの実行・拒否だけを見る(assertDiscardable などは実物を使う)
vi.mock('../gitDiscardClassifier', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../gitDiscardClassifier')>()),
  classifyDiscardTarget: vi.fn()
}))

import { discardAllChanges, discardFileChanges, discardHunk } from '../gitDiscardService'
import { discardHunkPatch, listPatchPaths } from '../gitApply'
import { classifyDiscardTarget } from '../gitDiscardClassifier'

const mockClassify = vi.mocked(classifyDiscardTarget)

beforeEach(() => {
  vi.clearAllMocks()
  mockRaw.mockResolvedValue('')
})

// 作業ツリー・index を書き換える git の呼び出し(restore / rm)だけを取り出す
const mutations = (): string[][] =>
  mockRaw.mock.calls
    .map((c) => c[0] as string[])
    .filter((args) => args[0] === 'restore' || args[0] === 'rm')

describe('discardFileChanges', () => {
  const classifyAs = (kind: DiscardTargetKind): void => {
    mockClassify.mockResolvedValue(kind)
  }
  it('分類をファイルパスで問い合わせる(pathspec の組み立ては classifier の責務)', async () => {
    classifyAs('tracked')
    await discardFileChanges('/project', 'a[1].txt', vi.fn())
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockClassify).toHaveBeenCalledWith(expect.objectContaining({ raw: mockRaw }), 'a[1].txt')
  })

  it('追跡済みなら restore --worktree をリテラル pathspec で呼び、ゴミ箱へは移動しない', async () => {
    classifyAs('tracked')
    const trash = vi.fn()
    await discardFileChanges('/project', 'src/a.ts', trash)
    expect(mutations()).toEqual([['restore', '--worktree', '--', ':(literal)src/a.ts']])
    expect(trash).not.toHaveBeenCalled()
  })

  it('未追跡なら絶対パスでゴミ箱へ移動し、restore は呼ばない', async () => {
    classifyAs('untracked')
    const trash = vi.fn().mockResolvedValue(undefined)
    await discardFileChanges('/project', 'new/file.txt', trash)
    expect(trash).toHaveBeenCalledWith('/project/new/file.txt')
    expect(mutations()).toEqual([])
  })

  it('ゴミ箱への移動に失敗したら日本語エラーにする', async () => {
    classifyAs('untracked')
    const trash = vi.fn().mockRejectedValue(new Error('trash unavailable'))
    await expect(discardFileChanges('/project', 'new.txt', trash)).rejects.toThrow(
      'ゴミ箱へ移動できませんでした: new.txt'
    )
  })

  it('restore が失敗したら git のエラーをそのまま伝播する', async () => {
    classifyAs('tracked')
    mockRaw.mockRejectedValue(new Error('restore failed'))
    await expect(discardFileChanges('/project', 'a.ts', vi.fn())).rejects.toThrow('restore failed')
  })

  describe('intent-to-add のファイル', () => {
    it('rm --cached の後でゴミ箱へ移し、restore は呼ばない', async () => {
      classifyAs('intent-to-add')
      // 呼び出し順を記録する
      const order: string[] = []
      mockRaw.mockImplementation(async (args: string[]) => {
        order.push(args[0])
        return ''
      })
      const trash = vi.fn(async () => {
        order.push('trash')
      })
      await discardFileChanges('/project', 'dir/x.txt', trash)
      expect(mutations()).toEqual([['rm', '--cached', '-q', '--', ':(literal)dir/x.txt']])
      expect(trash).toHaveBeenCalledWith('/project/dir/x.txt')
      // ゴミ箱への移動に失敗しても、index に宙ぶらりんのエントリを残さず
      // 通常の未追跡ファイルに戻っているよう、rm --cached を先に行う
      expect(order).toEqual(['rm', 'trash'])
    })

    it('rm --cached が失敗したらゴミ箱へは移さず、エラーを伝播する', async () => {
      classifyAs('intent-to-add')
      mockRaw.mockRejectedValue(new Error('rm failed'))
      const trash = vi.fn()
      await expect(discardFileChanges('/project', 'x.txt', trash)).rejects.toThrow('rm failed')
      expect(trash).not.toHaveBeenCalled()
    })

    it('ゴミ箱への移動に失敗したら未追跡と同じ日本語エラーにする', async () => {
      classifyAs('intent-to-add')
      const trash = vi.fn().mockRejectedValue(new Error('trash unavailable'))
      await expect(discardFileChanges('/project', 'x.txt', trash)).rejects.toThrow(
        'ゴミ箱へ移動できませんでした: x.txt'
      )
    })
  })

  // 拒否の文言は gitDiscardClassifier.test.ts の assertDiscardable で検証する。ここでは
  // 拒否の kind なら何も実行しないことだけ確認する
  it.each(['conflicted', 'unknown', 'overlaps-untracked'] as const)(
    '%s なら拒否し、restore もゴミ箱も実行しない',
    async (kind) => {
      classifyAs(kind)
      const trash = vi.fn()
      await expect(discardFileChanges('/project', 'c.txt', trash)).rejects.toThrow(`: c.txt`)
      expect(mutations()).toEqual([])
      expect(trash).not.toHaveBeenCalled()
    }
  )
})

describe('discardHunk', () => {
  const PATCH = [
    'diff --git a/f.txt b/f.txt',
    'index 1111111..2222222 100644',
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1 +1 @@',
    '-a',
    '+b',
    ''
  ].join('\n')

  beforeEach(() => {
    mockClassify.mockResolvedValue('tracked')
    vi.mocked(listPatchPaths).mockResolvedValue(['f.txt'])
    vi.mocked(discardHunkPatch).mockResolvedValue(undefined)
  })

  it('追跡済みで、パッチの対象がそのファイルだけなら、逆適用する', async () => {
    await discardHunk('/project', 'f.txt', PATCH)
    expect(listPatchPaths).toHaveBeenCalledWith('/project', PATCH, { reverse: false })
    expect(listPatchPaths).toHaveBeenCalledWith('/project', PATCH, { reverse: true })
    expect(discardHunkPatch).toHaveBeenCalledWith('/project', 'f.txt', PATCH)
  })

  // 拒否の文言(conflicted / unknown / overlaps-untracked)は gitDiscardClassifier.test.ts の
  // assertDiscardable で検証する。ここでは拒否の kind なら次へ進まないことだけ確認する
  it('拒否の kind(conflicted)なら、パッチの対象の列挙も逆適用も行わない', async () => {
    mockClassify.mockResolvedValue('conflicted')
    await expect(discardHunk('/project', 'f.txt', PATCH)).rejects.toThrow(
      'コンフリクト中のファイルは取り消せません: f.txt'
    )
    expect(listPatchPaths).not.toHaveBeenCalled()
    expect(discardHunkPatch).not.toHaveBeenCalled()
  })

  it.each(['untracked', 'intent-to-add'] as const)(
    '%s はゴミ箱へ移す対象のため拒否する',
    async (kind) => {
      mockClassify.mockResolvedValue(kind)
      await expect(discardHunk('/project', 'f.txt', PATCH)).rejects.toThrow(
        'ゴミ箱へ移す対象のため、ハンクでは取り消せません: f.txt'
      )
      expect(listPatchPaths).not.toHaveBeenCalled()
      expect(discardHunkPatch).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['別のファイル', ['other.txt']],
    ['複数のファイル', ['f.txt', 'g.txt']],
    ['対象なし', []]
  ])('パッチの対象が %s のときは拒否する', async (_name, targets) => {
    vi.mocked(listPatchPaths).mockResolvedValue(targets)
    await expect(discardHunk('/project', 'f.txt', PATCH)).rejects.toThrow(
      'パッチの対象がファイルと一致しません'
    )
    expect(discardHunkPatch).not.toHaveBeenCalled()
  })

  it('パッチを解釈できない(listPatchPaths が失敗する)ときも同じエラーに変換する', async () => {
    vi.mocked(listPatchPaths).mockRejectedValue(new Error('git apply failed'))
    await expect(discardHunk('/project', 'f.txt', PATCH)).rejects.toThrow(
      'パッチの対象がファイルと一致しません'
    )
    expect(discardHunkPatch).not.toHaveBeenCalled()
  })

  it('モード変更の行は取り除いてから numstat と逆適用に渡す', async () => {
    const withMode = PATCH.replace('index', 'old mode 100644\nnew mode 100755\nindex')
    const stripped = PATCH
    await discardHunk('/project', 'f.txt', withMode)
    expect(listPatchPaths).toHaveBeenCalledWith('/project', stripped, { reverse: false })
    expect(listPatchPaths).toHaveBeenCalledWith('/project', stripped, { reverse: true })
    expect(discardHunkPatch).toHaveBeenCalledWith('/project', 'f.txt', stripped)
  })

  // 構造の検証は gitHunkPatch.test.ts で網羅している。ここでは検証に落ちたら次へ進まないことだけ確認する
  it('パッチの構造が許可リストに合わなければ、numstat も逆適用も行わない', async () => {
    const renamed = PATCH.replace('index', 'rename from old.txt\nindex')
    await expect(discardHunk('/project', 'f.txt', renamed)).rejects.toThrow(
      'パッチの対象がファイルと一致しません'
    )
    expect(listPatchPaths).not.toHaveBeenCalled()
    expect(discardHunkPatch).not.toHaveBeenCalled()
  })

  // --numstat は順方向の新パスしか見ないため、逆適用の適用先が別のファイルになる
  // パッチ(a/b 不一致)を見逃す。逆方向でも確かめる
  it('逆方向の numstat が別のパスを返すときは拒否する', async () => {
    vi.mocked(listPatchPaths).mockImplementation(async (_folder, _patch, options) =>
      options?.reverse === true ? ['other.txt'] : ['f.txt']
    )
    await expect(discardHunk('/project', 'f.txt', PATCH)).rejects.toThrow(
      'パッチの対象がファイルと一致しません'
    )
    expect(discardHunkPatch).not.toHaveBeenCalled()
  })

  it('順方向の numstat が別のパスを返すときも拒否する', async () => {
    vi.mocked(listPatchPaths).mockImplementation(async (_folder, _patch, options) =>
      options?.reverse === true ? ['f.txt'] : ['other.txt']
    )
    await expect(discardHunk('/project', 'f.txt', PATCH)).rejects.toThrow(
      'パッチの対象がファイルと一致しません'
    )
    expect(discardHunkPatch).not.toHaveBeenCalled()
  })

  it('逆適用に失敗したら、diff を開き直す案内のエラーにし、cause に元のエラーを残す', async () => {
    const cause = new Error('patch does not apply')
    vi.mocked(discardHunkPatch).mockRejectedValue(cause)
    const error = await discardHunk('/project', 'f.txt', PATCH).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(
      'ハンクを取り消せませんでした。ファイルが変更された可能性があります。diff を開き直してください'
    )
    expect((error as Error).cause).toBe(cause)
  })
})

describe('discardAllChanges', () => {
  type State = DiscardTargetKind

  // status の出力は raw のモックで、パスごとの分類は classifyDiscardTarget のモックで再現する
  // (分類そのものは gitDiscardClassifier.test.ts で検証する)
  const setup = (statusOutput: string, states: Record<string, State>): void => {
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status') return statusOutput
      if (args[0] === 'rm' || args[0] === 'restore') return ''
      throw new Error(`unexpected raw: ${args.join(' ')}`)
    })
    mockClassify.mockImplementation(async (_git, filePath) => states[filePath] ?? 'tracked')
  }
  // 確認時に見せた一覧(renderer が simple-git の status から作る path + 2 文字のステータス)
  const entry = (status: string, path: string): { path: string; status: string } => ({
    path,
    status
  })
  const MISMATCH = '変更の状態が変わったため取り消しを中止しました。もう一度操作してください'

  it('status を porcelain -z --untracked-files=all で問い合わせる', async () => {
    setup('', {})
    await discardAllChanges('/project', [], vi.fn())
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockRaw).toHaveBeenCalledWith(['status', '--porcelain', '-z', '--untracked-files=all'])
  })

  it('件数が違えば中止し、分類の問い合わせも取り消しもしない', async () => {
    setup(' M a.txt\0 M b.txt\0', { 'a.txt': 'tracked', 'b.txt': 'tracked' })
    const trash = vi.fn()
    await expect(
      discardAllChanges(
        '/project',
        [entry(' M', 'a.txt'), entry(' M', 'b.txt'), entry(' M', 'c.txt')],
        trash
      )
    ).rejects.toThrow(MISMATCH)
    expect(mockRaw).toHaveBeenCalledTimes(1)
    expect(mockClassify).not.toHaveBeenCalled()
    expect(mutations()).toEqual([])
    expect(trash).not.toHaveBeenCalled()
  })

  // 件数だけの照合では、確認後に中身が入れ替わっても通ってしまい、確認していないファイルの編集が消えた
  it('件数が同じでもパスが入れ替わっていれば中止し、何も変えない', async () => {
    setup('A  scratch.txt\0 M a.txt\0', { 'a.txt': 'tracked' })
    const trash = vi.fn()
    await expect(
      discardAllChanges('/project', [entry('??', 'scratch.txt')], trash)
    ).rejects.toThrow(MISMATCH)
    expect(mockClassify).not.toHaveBeenCalled()
    expect(mutations()).toEqual([])
    expect(trash).not.toHaveBeenCalled()
  })

  it('同じパスでもステータスが変わっていれば中止し、何も変えない', async () => {
    setup('AM x.txt\0', { 'x.txt': 'tracked' })
    const trash = vi.fn()
    await expect(discardAllChanges('/project', [entry('??', 'x.txt')], trash)).rejects.toThrow(
      MISMATCH
    )
    expect(mockClassify).not.toHaveBeenCalled()
    expect(mutations()).toEqual([])
  })

  it('一覧の順序が違っても(パスでソートして)照合が通る', async () => {
    setup(' M b.txt\0?? a.txt\0', { 'b.txt': 'tracked', 'a.txt': 'untracked' })
    const trash = vi.fn().mockResolvedValue(undefined)
    await expect(
      discardAllChanges('/project', [entry(' M', 'b.txt'), entry('??', 'a.txt')], trash)
    ).resolves.toEqual({ status: 'done' })
    await expect(
      discardAllChanges('/project', [entry('??', 'a.txt'), entry(' M', 'b.txt')], trash)
    ).resolves.toEqual({ status: 'done' })
  })

  // renderer の path は simple-git の表記(ネストしたリポジトリは末尾 '/'、末尾空白は trim 済み)。
  // 実行に使うパスは従来どおり('/' を削った値)
  it('renderer 表記の sub/ と trim 済みの末尾空白パスで照合が通り、実行は生のパスで行う', async () => {
    setup('?? sub/\0?? trailsp \0', { sub: 'untracked', 'trailsp ': 'untracked' })
    const trash = vi.fn().mockResolvedValue(undefined)
    await expect(
      discardAllChanges('/project', [entry('??', 'sub/'), entry('??', 'trailsp')], trash)
    ).resolves.toEqual({ status: 'done' })
    expect(trash.mock.calls.map((c) => c[0])).toEqual(['/project/sub', '/project/trailsp '])
  })

  it('1 件が conflicted なら、他の追跡済みも含めて何も取り消さない', async () => {
    setup(' M a.txt\0UU c.txt\0?? n.txt\0', {
      'a.txt': 'tracked',
      'c.txt': 'conflicted',
      'n.txt': 'untracked'
    })
    const trash = vi.fn()
    await expect(
      discardAllChanges(
        '/project',
        [entry(' M', 'a.txt'), entry('UU', 'c.txt'), entry('??', 'n.txt')],
        trash
      )
    ).rejects.toThrow('取り消せないファイルがあるため、何も取り消しませんでした（c.txt）')
    expect(mutations()).toEqual([])
    expect(trash).not.toHaveBeenCalled()
  })

  it('conflicted / unknown / overlaps-untracked をすべて列挙する', async () => {
    setup(' M a.txt\0UU c.txt\0?? u.txt\0 D o.txt\0', {
      'a.txt': 'tracked',
      'c.txt': 'conflicted',
      'u.txt': 'unknown',
      'o.txt': 'overlaps-untracked'
    })
    await expect(
      discardAllChanges(
        '/project',
        [entry(' M', 'a.txt'), entry('UU', 'c.txt'), entry('??', 'u.txt'), entry(' D', 'o.txt')],
        vi.fn()
      )
    ).rejects.toThrow('（c.txt、u.txt、o.txt）')
  })

  it('列挙は最大 5 件で、超えた分は「ほか n 件」にする', async () => {
    const names = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']
    setup(
      names.map((n) => `UU ${n}\0`).join(''),
      Object.fromEntries(names.map((n) => [n, 'conflicted' as const]))
    )
    await expect(
      discardAllChanges(
        '/project',
        names.map((n) => entry('UU', n)),
        vi.fn()
      )
    ).rejects.toThrow('何も取り消しませんでした（p1、p2、p3、p4、p5、ほか 2 件）')
  })

  it('ちょうど 5 件なら「ほか」を付けない', async () => {
    const names = ['p1', 'p2', 'p3', 'p4', 'p5']
    setup(
      names.map((n) => `UU ${n}\0`).join(''),
      Object.fromEntries(names.map((n) => [n, 'conflicted' as const]))
    )
    await expect(
      discardAllChanges(
        '/project',
        names.map((n) => entry('UU', n)),
        vi.fn()
      )
    ).rejects.toThrow('何も取り消しませんでした（p1、p2、p3、p4、p5）')
  })

  it('追跡済みは restore、未追跡と intent-to-add はゴミ箱へ(intent-to-add は先に rm --cached)', async () => {
    setup(' M a.txt\0 M b.txt\0?? n.txt\0 A i.txt\0', {
      'a.txt': 'tracked',
      'b.txt': 'tracked',
      'n.txt': 'untracked',
      'i.txt': 'intent-to-add'
    })
    const trash = vi.fn().mockResolvedValue(undefined)
    await expect(
      discardAllChanges(
        '/project',
        [entry(' M', 'a.txt'), entry(' M', 'b.txt'), entry('??', 'n.txt'), entry(' A', 'i.txt')],
        trash
      )
    ).resolves.toEqual({ status: 'done' })
    expect(mutations()).toEqual([
      ['restore', '--worktree', '--', ':(literal)a.txt'],
      ['restore', '--worktree', '--', ':(literal)b.txt'],
      ['rm', '--cached', '-q', '--', ':(literal)i.txt']
    ])
    expect(trash.mock.calls.map((c) => c[0])).toEqual(['/project/n.txt', '/project/i.txt'])
  })

  it('ゴミ箱への移動が 2 件目で失敗したら、済んだ件数つきで中断し 3 件目は実行しない', async () => {
    setup('?? a.txt\0?? b.txt\0?? c.txt\0', {
      'a.txt': 'untracked',
      'b.txt': 'untracked',
      'c.txt': 'untracked'
    })
    const trash = vi.fn().mockImplementation(async (path: string) => {
      if (path.endsWith('b.txt')) throw new Error('denied')
    })
    const result = await discardAllChanges(
      '/project',
      [entry('??', 'a.txt'), entry('??', 'b.txt'), entry('??', 'c.txt')],
      trash
    )
    expect(result).toEqual({
      status: 'partial',
      message:
        '一括の取り消しが途中で失敗しました（1 / 3 件を取り消し済み）: ゴミ箱へ移動できませんでした: b.txt'
    })
    expect(trash).toHaveBeenCalledTimes(2)
  })

  it('1 件目で失敗(済み 0 件)したら、作業ツリーは変わっていないので結果ではなく throw する', async () => {
    setup('?? a.txt\0?? b.txt\0', { 'a.txt': 'untracked', 'b.txt': 'untracked' })
    const trash = vi.fn().mockRejectedValue(new Error('denied'))
    await expect(
      discardAllChanges('/project', [entry('??', 'a.txt'), entry('??', 'b.txt')], trash)
    ).rejects.toThrow(
      '一括の取り消しが途中で失敗しました（0 / 2 件を取り消し済み）: ゴミ箱へ移動できませんでした: a.txt'
    )
    expect(trash).toHaveBeenCalledTimes(1)
  })

  it('対象が 0 件で一覧も空なら、何もせず成功する', async () => {
    setup('M  staged.txt\0', {})
    const trash = vi.fn()
    await expect(discardAllChanges('/project', [], trash)).resolves.toEqual({ status: 'done' })
    expect(mutations()).toEqual([])
    expect(trash).not.toHaveBeenCalled()
  })
})
