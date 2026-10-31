import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRaw = vi.hoisted(() => vi.fn())
const mockSimpleGit = vi.hoisted(() => vi.fn(() => ({ raw: mockRaw })))

vi.mock('simple-git', () => ({
  default: mockSimpleGit
}))

import { getStashes, stashPush, stashPop, stashDrop } from '../gitStashService'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getStashes', () => {
  it('git stash list を NUL 区切りの書式で呼び、解析した stash を返す', async () => {
    const sha = 'a'.repeat(40)
    mockRaw.mockResolvedValue(`${sha}\0On main: msg\0${'2026-10-01T10:00:00+09:00'}\0`)
    await expect(getStashes('/project')).resolves.toEqual([
      { sha, message: 'msg', branch: 'main', createdAt: '2026-10-01T10:00:00+09:00' }
    ])
    expect(mockRaw).toHaveBeenCalledWith(['stash', 'list', '-z', '--format=%H%x00%gs%x00%cI'])
  })

  it('stash が無ければ空配列', async () => {
    mockRaw.mockResolvedValue('')
    await expect(getStashes('/project')).resolves.toEqual([])
  })
})

describe('stashPush', () => {
  // 検証用の問い合わせを種類で振り分ける。出力の前提(空文字の意味など)は一時ディレクトリの
  // 実 git で確認済み: rev-parse --verify -q は ref が無いと空文字で resolve する
  const setupRaw = (
    o: { head?: string; unmerged?: string; status?: string; inProgress?: string } = {}
  ): void => {
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') {
        // 途中の操作(MERGE_HEAD / CHERRY_PICK_HEAD / REVERT_HEAD)の問い合わせは inProgress の ref だけ存在する
        if (args[args.length - 1] === 'HEAD') return o.head ?? 'abc123\n'
        return args[args.length - 1] === o.inProgress ? 'def456\n' : ''
      }
      if (args[0] === 'ls-files') return o.unmerged ?? ''
      if (args[0] === 'status') return o.status ?? ' M a.txt\0'
      if (args[0] === 'stash') return ''
      throw new Error(`unexpected raw: ${args.join(' ')}`)
    })
  }
  const rawCalls = (): string[][] => mockRaw.mock.calls.map((call) => call[0] as string[])
  const stashWasCalled = (): boolean => rawCalls().some((a) => a[0] === 'stash')

  it('メッセージに NUL を含むと、git を一切呼ばずに拒否する', async () => {
    setupRaw()
    await expect(stashPush('/project', 'a\0b')).rejects.toThrow(
      'メッセージに使用できない文字が含まれています'
    )
    expect(mockRaw).not.toHaveBeenCalled()
  })

  // 検証の詳細(順序・拒否文言)は gitStashGuards.test.ts で固定している。ここでは「拒否されたら push しない」だけ
  it('検証(guards)で拒否されたら、stash push を呼ばない', async () => {
    setupRaw({ head: '' })
    await expect(stashPush('/project', '')).rejects.toThrow('コミットが無いため stash できません')
    expect(stashWasCalled()).toBe(false)
  })

  // simple-git は引数列の中の --upload-pack=... や -c ... を値であってもオプションとして
  // 検出して拒否する。-m <値> の 2 引数だとそのようなメッセージで失敗するため、1 引数にする
  it('メッセージ有りは stash push -u --message=<message> を呼ぶ', async () => {
    setupRaw()
    await stashPush('/project', 'my message')
    expect(rawCalls()).toContainEqual(['stash', 'push', '-u', '--message=my message'])
  })

  it('メッセージが空(または空白だけ)なら --message を付けない', async () => {
    setupRaw()
    await stashPush('/project', '')
    await stashPush('/project', '   ')
    const pushes = rawCalls().filter((a) => a[0] === 'stash')
    expect(pushes).toEqual([
      ['stash', 'push', '-u'],
      ['stash', 'push', '-u']
    ])
  })

  it('- で始まるメッセージも 1 つの引数として渡す', async () => {
    setupRaw()
    await stashPush('/project', '--foo bar')
    expect(rawCalls()).toContainEqual(['stash', 'push', '-u', '--message=--foo bar'])
  })

  it('git が失敗したら(コミッター情報が無い等)そのエラーをそのまま投げる', async () => {
    const gitError = new Error('fatal: empty ident name')
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') return args[args.length - 1] === 'HEAD' ? 'abc\n' : ''
      if (args[0] === 'ls-files') return ''
      if (args[0] === 'status') return ' M a\0'
      throw gitError
    })
    await expect(stashPush('/project', 'm')).rejects.toBe(gitError)
  })
})

describe('stashPop / stashDrop', () => {
  const sha = 'a'.repeat(40)
  const other = 'b'.repeat(40)
  const listOutput = (...shas: string[]): string =>
    shas.map((s) => `${s}\0On main: m-${s[0]}\0${'2026-10-01T10:00:00+09:00'}\0`).join('')

  // 呼び出しを種類で振り分ける。stash list は呼ばれるたびに lists の先頭から順に返す
  // (1 回目: 検証、2 回目: pop 後の drop の位置の引き直し)。apply の成否・巻き戻しは opts で切り替える
  const setupRaw = (opts: {
    lists?: string[]
    status?: string
    applyError?: Error
    conflicted?: string
    dropOutput?: string
    lsFiles?: string
    diffError?: Error
    resetError?: Error
    cleanError?: Error
    dropError?: Error
  }): void => {
    const lists = [...(opts.lists ?? [listOutput(sha), listOutput(sha)])]
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'stash' && args[1] === 'list') return lists.shift() ?? ''
      if (args[0] === 'status') return opts.status ?? ''
      if (args[0] === 'rev-parse') return ''
      if (args[0] === 'stash' && args[1] === 'apply') {
        if (opts.applyError !== undefined) throw opts.applyError
        return ''
      }
      if (args[0] === 'ls-files') return opts.lsFiles ?? 'H a.txt\0S b.txt\0'
      if (args[0] === 'diff') {
        if (opts.diffError !== undefined) throw opts.diffError
        return opts.conflicted ?? ''
      }
      if (args[0] === 'reset') {
        if (opts.resetError !== undefined) throw opts.resetError
        return ''
      }
      if (args[0] === 'clean') {
        if (opts.cleanError !== undefined) throw opts.cleanError
        return ''
      }
      if (args[0] === 'stash' && args[1] === 'drop') {
        if (opts.dropError !== undefined) throw opts.dropError
        return opts.dropOutput ?? `Dropped ${args[2]} (${sha})`
      }
      if (args[0] === 'stash' && args[1] === 'store') return ''
      throw new Error(`unexpected raw: ${args.join(' ')}`)
    })
  }
  const rawCalls = (): string[][] => mockRaw.mock.calls.map((call) => call[0] as string[])
  const called = (pred: (a: string[]) => boolean): boolean => rawCalls().some(pred)

  describe('stashPop', () => {
    it.each(['', 'xyz', 'A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), '--all'])(
      'SHA の形式が不正(%s)なら、git を呼ばずに拒否する',
      async (bad) => {
        setupRaw({})
        await expect(stashPop('/project', bad)).rejects.toThrow(
          'stash が見つかりません（すでに削除された可能性があります）'
        )
        expect(mockRaw).not.toHaveBeenCalled()
      }
    )

    // git はすでに捨てた stash の SHA でも stash apply で復元できてしまう(実機で確認)ため、
    // 現在の一覧にあることを許可リスト方式で確認する
    it('一覧に無い SHA(すでに削除された stash)は、apply を呼ばずに拒否する', async () => {
      setupRaw({ lists: [listOutput(other)] })
      await expect(stashPop('/project', sha)).rejects.toThrow(
        'stash が見つかりません（すでに削除された可能性があります）'
      )
      expect(called((a) => a[1] === 'apply')).toBe(false)
    })

    // 検証の詳細(status の引数・assume-unchanged)は gitStashGuards.test.ts で固定している
    it('検証(guards)で拒否されたら、apply を呼ばない', async () => {
      setupRaw({ status: '?? u.txt\0' })
      await expect(stashPop('/project', sha)).rejects.toThrow('作業中の変更があるため戻せません')
      expect(called((a) => a[1] === 'apply')).toBe(false)
    })

    it('検証の順序は 形式 → 一覧に存在 → ツリーがきれい', async () => {
      setupRaw({ lists: [listOutput(other)], status: 'x\0' })
      await expect(stashPop('/project', sha)).rejects.toThrow('stash が見つかりません')
      expect(called((a) => a[0] === 'status')).toBe(false)
    })

    it('成功したら apply --index <sha> のあと、一覧での位置を引き直して drop する', async () => {
      setupRaw({ lists: [listOutput(other, sha), listOutput(other, sha)] })
      await expect(stashPop('/project', sha)).resolves.toEqual({ status: 'restored' })
      expect(rawCalls()).toContainEqual(['stash', 'apply', '--index', sha])
      expect(rawCalls()).toContainEqual(['stash', 'drop', 'stash@{1}'])
      expect(called((a) => a[0] === 'reset' || a[0] === 'clean')).toBe(false)
    })

    it('apply が失敗したら、未解決ファイルを取得してから reset --hard と clean -fd で戻し、stash は drop しない', async () => {
      setupRaw({ applyError: new Error('CONFLICT'), conflicted: 'a.txt\0b.txt\0' })
      await expect(stashPop('/project', sha)).rejects.toThrow(
        'stash の変更を作業ツリーへ戻せなかったため、戻す前の状態にしました。stash は残っています（コンフリクト: a.txt, b.txt）'
      )
      const calls = rawCalls()
      const diffIndex = calls.findIndex((a) => a[0] === 'diff')
      const resetIndex = calls.findIndex((a) => a[0] === 'reset')
      const cleanIndex = calls.findIndex((a) => a[0] === 'clean')
      expect(calls[diffIndex]).toEqual(['diff', '--name-only', '-z', '--diff-filter=U'])
      expect(calls[resetIndex]).toEqual(['reset', '--hard', '--no-recurse-submodules'])
      expect(calls[cleanIndex]).toEqual(['clean', '-fd'])
      // 巻き戻すと未解決の状態が消えて取れなくなるため、必ず巻き戻しより前に取得する
      expect(diffIndex).toBeLessThan(resetIndex)
      expect(resetIndex).toBeLessThan(cleanIndex)
      expect(called((a) => a[1] === 'drop')).toBe(false)
    })

    it('コンフリクトが無い失敗(同名のファイルがある等)でも巻き戻して定型文のエラーにする', async () => {
      setupRaw({ applyError: new Error('already exists'), conflicted: '' })
      await expect(stashPop('/project', sha)).rejects.toThrow(
        '（同名のファイルがあるなど、git が復元を完了できませんでした）'
      )
      expect(called((a) => a[0] === 'reset')).toBe(true)
    })

    const dropFailureMessage =
      'stash の変更は作業ツリーへ戻しましたが、この stash を一覧から削除できませんでした。不要なら「捨てる」で削除してください'

    // 作業ツリーは変わっているため throw ではなく結果で返す(renderer が再読込できるように)
    it.each([
      [
        'SHA 不一致(別の stash を消したため store で戻した)',
        {
          dropOutput: `Dropped stash@{0} (${other})`,
          lists: [listOutput(sha), listOutput(sha, other)]
        }
      ],
      ['別プロセスが先に drop して一覧に無い', { lists: [listOutput(sha), listOutput(other)] }],
      ['git の drop が失敗した', { dropError: new Error('fatal: x') }]
    ] as [string, Parameters<typeof setupRaw>[0]][])(
      'apply が成功したあとの drop が失敗(%s)したら、throw せず dropFailed を返す',
      async (_name, opts) => {
        setupRaw({ ...opts })
        await expect(stashPop('/project', sha)).resolves.toEqual({
          status: 'dropFailed',
          message: dropFailureMessage
        })
        expect(called((a) => a[1] === 'apply')).toBe(true)
      }
    )

    it('未解決ファイルの取得(diff)が失敗しても、reset と clean を試みて定型文のエラーにする', async () => {
      setupRaw({ applyError: new Error('CONFLICT'), diffError: new Error('diff failed') })
      await expect(stashPop('/project', sha)).rejects.toThrow(
        '（同名のファイルがあるなど、git が復元を完了できませんでした）'
      )
      expect(called((a) => a[0] === 'reset')).toBe(true)
      expect(called((a) => a[0] === 'clean')).toBe(true)
    })

    const rollbackFailure =
      'stash の変更を作業ツリーへ戻せず、戻す前の状態への復旧にも失敗しました。作業ツリーに途中の変更が残っている可能性があります。stash は残っています'

    // 巻き戻しの失敗は作業ツリーが変わり得るため、throw ではなく結果で返す(renderer が再読込できるように)
    it('reset が失敗しても clean を試み、rollbackFailed を返す', async () => {
      setupRaw({ applyError: new Error('CONFLICT'), resetError: new Error('reset failed') })
      await expect(stashPop('/project', sha)).resolves.toEqual({
        status: 'rollbackFailed',
        message: rollbackFailure
      })
      expect(called((a) => a[0] === 'clean')).toBe(true)
      expect(called((a) => a[1] === 'drop')).toBe(false)
    })

    it('clean が失敗したら、rollbackFailed を返す', async () => {
      setupRaw({ applyError: new Error('CONFLICT'), cleanError: new Error('clean failed') })
      await expect(stashPop('/project', sha)).resolves.toEqual({
        status: 'rollbackFailed',
        message: rollbackFailure
      })
    })

    it('未解決ファイルの取得(diff)が失敗しても、巻き戻しが成功すれば apply のエラーを cause に残す', async () => {
      const applyError = new Error('CONFLICT')
      setupRaw({ applyError, diffError: new Error('diff failed') })
      const error = await stashPop('/project', sha).catch((e: unknown) => e)
      expect((error as Error).cause).toBe(applyError)
    })

    it('apply の失敗は、cause に残す', async () => {
      const applyError = new Error('CONFLICT')
      setupRaw({ applyError })
      const error = await stashPop('/project', sha).catch((e: unknown) => e)
      expect((error as Error).cause).toBe(applyError)
    })
  })

  describe('stashDrop', () => {
    it.each(['', 'xyz', 'A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), '--all'])(
      'SHA の形式が不正(%s)なら、pop と同じ文言で git を呼ばずに拒否する',
      async (bad) => {
        setupRaw({})
        await expect(stashDrop('/project', bad)).rejects.toThrow(
          'stash が見つかりません（すでに削除された可能性があります）'
        )
        expect(mockRaw).not.toHaveBeenCalled()
      }
    )

    it('一覧に無い SHA は、pop と同じ文言で drop を呼ばずに拒否する', async () => {
      setupRaw({ lists: [listOutput(other)] })
      await expect(stashDrop('/project', sha)).rejects.toThrow(
        'stash が見つかりません（すでに削除された可能性があります）'
      )
      expect(called((a) => a[1] === 'drop')).toBe(false)
    })

    it('一覧での位置から stash@{n} を決めて drop する(番号ではなく SHA で識別する)', async () => {
      setupRaw({ lists: [listOutput(other, sha)] })
      await stashDrop('/project', sha)
      expect(rawCalls()).toContainEqual(['stash', 'drop', 'stash@{1}'])
    })

    // 検索と削除の間に stash が増減すると、同じ番号が別の stash を指す。git の出力の
    // `Dropped stash@{n} (<sha>)` で削除した stash を確認し、違えば元に戻す
    it('出力の SHA が要求と違えば、誤って消した stash を stash store で戻してエラーにする', async () => {
      setupRaw({
        lists: [listOutput(sha, other)],
        dropOutput: `Dropped stash@{0} (${other})`
      })
      await expect(stashDrop('/project', sha)).rejects.toThrow(
        'stash の状態が変わったため削除を取り消しました。もう一度操作してください'
      )
      expect(called((a) => a[1] === 'store' && a[a.length - 1] === other)).toBe(true)
      expect(rawCalls()).toContainEqual(['stash', 'store', '--message=m-b', other])
    })

    it('出力から SHA を確認できなければ(書式が想定外)、そのまま成功として扱う', async () => {
      setupRaw({ lists: [listOutput(sha)], dropOutput: 'unexpected' })
      await expect(stashDrop('/project', sha)).resolves.toBeUndefined()
      expect(called((a) => a[1] === 'store')).toBe(false)
    })
  })
})
