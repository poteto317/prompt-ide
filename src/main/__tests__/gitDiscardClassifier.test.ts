import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SimpleGit } from 'simple-git'
import { assertDiscardable, classifyDiscardTarget } from '../gitDiscardClassifier'

const mockRaw = vi.fn()
const git = { raw: mockRaw } as unknown as SimpleGit

beforeEach(() => {
  vi.clearAllMocks()
})

describe('classifyDiscardTarget', () => {
  // raw() の呼び出しを種類で振り分ける(このファイルだけに置く)。出力は -z(NUL 区切り)の形式。
  // ls-files -u は「mode sha stage<TAB>path」、それ以外はパスそのものが NUL 区切りで並ぶ
  // (実機 git 2.50.1 で確認)
  const setupRaw = (outputs: {
    unmerged?: string
    tracked?: string
    intentToAdd?: string
    others?: string
    untracked?: string
  }): void => {
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'ls-files' && args.includes('-u')) return outputs.unmerged ?? ''
      if (args[0] === 'ls-files' && args.includes('-k')) return outputs.others ?? ''
      if (args[0] === 'ls-files' && args.includes('--others')) return outputs.untracked ?? ''
      if (args[0] === 'ls-files') return outputs.tracked ?? ''
      if (args[0] === 'diff') return outputs.intentToAdd ?? ''
      throw new Error(`unexpected raw: ${args.join(' ')}`)
    })
  }
  const classify = (filePath: string): ReturnType<typeof classifyDiscardTarget> =>
    classifyDiscardTarget(git, filePath)
  const queriedKinds = (): string[] =>
    mockRaw.mock.calls.map((call) => {
      const args = call[0] as string[]
      if (args[0] === 'diff') return 'diff'
      if (args.includes('-u')) return 'unmerged'
      if (args.includes('-k')) return 'overlaps'
      if (args.includes('--others')) return 'others'
      return 'tracked'
    })

  // 状態の判定は先に決まったものから順に行い、不要な git の問い合わせをしない
  it('コンフリクト中と判定したら、それ以降の問い合わせをしない', async () => {
    setupRaw({ unmerged: '100644 abc 1\tc.txt\0' })
    await expect(classify('c.txt')).resolves.toBe('conflicted')
    expect(mockRaw).toHaveBeenCalledTimes(1)
  })

  it('未追跡と判定したら、intent-to-add の問い合わせをしない', async () => {
    setupRaw({ tracked: '', untracked: 'new.txt\0' })
    await expect(classify('new.txt')).resolves.toBe('untracked')
    expect(mockRaw).not.toHaveBeenCalledWith(expect.arrayContaining(['diff']))
  })

  // intent-to-add は追跡済みの一種として ls-files に出る。重なりの問い合わせより先に判定する
  it('問い合わせの順序は unmerged → tracked → diff(intent-to-add) → overlaps', async () => {
    setupRaw({ tracked: 'a.ts\0' })
    await expect(classify('a.ts')).resolves.toBe('tracked')
    expect(queriedKinds()).toEqual(['unmerged', 'tracked', 'diff', 'overlaps'])
  })

  it('intent-to-add と判定したら、重なりの問い合わせをしない', async () => {
    setupRaw({ tracked: 'x.txt\0', intentToAdd: 'x.txt\0', others: 'x.txt/\0' })
    await expect(classify('x.txt')).resolves.toBe('intent-to-add')
    expect(queriedKinds()).toEqual(['unmerged', 'tracked', 'diff'])
  })

  it('追跡済み(未追跡と重ならない)なら tracked', async () => {
    setupRaw({ tracked: 'src/a.ts\0' })
    await expect(classify('src/a.ts')).resolves.toBe('tracked')
  })

  // git は `--` の後ろでも [ ] * ? をグロブとして解釈するため、リテラル化しないと
  // 'a[1].txt' の取り消しで無関係な 'a1.txt' の変更まで消えてしまう
  it('filePath から作ったリテラル pathspec を unmerged / tracked / diff の問い合わせに使う', async () => {
    setupRaw({ tracked: 'a[1].txt\0' })
    await classify('a[1].txt')
    expect(mockRaw).toHaveBeenCalledWith(['ls-files', '-u', '-z', '--', ':(literal)a[1].txt'])
    expect(mockRaw).toHaveBeenCalledWith(['ls-files', '-z', '--', ':(literal)a[1].txt'])
    expect(mockRaw).toHaveBeenCalledWith([
      'diff',
      '--name-only',
      '-z',
      '--diff-filter=A',
      '--',
      ':(literal)a[1].txt'
    ])
  })

  // pathspec はディレクトリの前方一致として働くため、追跡済みの 'foo/a.ts' を消して同名の
  // ファイル 'foo' を作ると、ls-files -- foo は 'foo/a.ts' を返す(実機で確認)。出力の有無で
  // 判定すると未追跡の 'foo' を追跡済みと誤判定し、restore が 'foo' を 'foo/a.ts' で
  // 置き換えて、履歴に無い内容がゴミ箱も経由せずに消える(レビュー指摘)
  it('配下の追跡済みファイルしか出力されない場合は未追跡', async () => {
    setupRaw({ tracked: 'foo/a.ts\0', untracked: 'foo\0' })
    await expect(classify('foo')).resolves.toBe('untracked')
  })

  // git restore は 'is unmerged' で失敗するが、その英語エラーを見せる前に日本語で拒否する
  it('コンフリクト中(ls-files -u に一致するパスがある)なら conflicted', async () => {
    setupRaw({
      unmerged: '100644 abc 1\tc.txt\x00100644 def 2\tc.txt\x00',
      tracked: 'c.txt\0c.txt\0'
    })
    await expect(classify('c.txt')).resolves.toBe('conflicted')
  })

  // 配下のファイルのコンフリクトは、このパス自身のコンフリクトではない
  it('配下のファイルだけがコンフリクト中なら、このパスはコンフリクト扱いしない', async () => {
    setupRaw({ unmerged: '100644 abc 1\tfoo/c.txt\0', tracked: '', untracked: 'foo/\0' })
    await expect(classify('foo')).resolves.toBe('untracked')
  })

  // 追跡済みに完全一致しないことは「未追跡」の根拠にならない。IPC から渡るパスの表記が
  // index とずれていると(NFD の日本語ディレクトリ名や大文字小文字だけ違うディレクトリ名)、
  // 追跡済みの変更ファイルが「変更の取り消し」の確認のままゴミ箱へ移っていた(PR レビュー指摘)。
  // ls-files --others で未追跡であることを肯定的に確かめたときだけ untracked にする
  describe('未追跡であることの確認', () => {
    it('ls-files --others を icase・--directory で問い合わせる(-k は付けない)', async () => {
      setupRaw({ tracked: '', untracked: 'new.txt\0' })
      await classify('new.txt')
      expect(mockRaw).toHaveBeenCalledWith([
        'ls-files',
        '-z',
        '--others',
        '--directory',
        '--',
        ':(literal,icase)new.txt'
      ])
    })

    // git status は未追跡ディレクトリを 'newdir/' で返し、IPC 側で末尾の / が落ちる
    it('未追跡ディレクトリ(出力が path/)も untracked', async () => {
      setupRaw({ tracked: '', untracked: 'newdir/\0' })
      await expect(classify('newdir')).resolves.toBe('untracked')
    })

    it.each([
      ['追跡済みにも未追跡にも一致しない', ''],
      // 大文字小文字を区別しない FS で 'Src' を 'src' に変えた場合など。icase で問い合わせるため
      // 出力は index 側の表記になり、渡されたパスとは一致しない
      ['大文字小文字だけ違うエントリしか無い', 'Src/a.ts\0'],
      ['配下のエントリしか無い', 'src/a.ts/x\0']
    ])('%s場合は unknown', async (_label, untracked) => {
      setupRaw({ tracked: '', untracked })
      await expect(classify('src/a.ts')).resolves.toBe('unknown')
    })
  })

  // 追跡済みのファイル 'foo' を消して同名のディレクトリ 'foo/' を作ると、status は ' D foo' と
  // '?? foo/x' になる。' D foo' を restore すると、未追跡(や ignored)の 'foo/x' がゴミ箱も
  // 経由せず確認なしで消える(実機で確認、レビュー指摘)。重なる未追跡ファイルがあれば overlaps-untracked
  describe('restore の対象と未追跡ファイルが重なる場合', () => {
    it('ls-files --others -k に出力があれば overlaps-untracked', async () => {
      setupRaw({ tracked: 'foo\0', others: 'foo/x\0' })
      await expect(classify('foo')).resolves.toBe('overlaps-untracked')
      expect(mockRaw).toHaveBeenCalledWith([
        'ls-files',
        '-z',
        '--others',
        '-k',
        '--directory',
        '--',
        ':(literal,icase)foo'
      ])
    })

    // 親(祖先)のパスが未追跡のファイルに置き換わっている場合も同じく restore で消える。
    // 追跡済みの 'foo/a.ts' を消して同名のファイル 'foo' を作ると ' D foo/a.ts' と '?? foo' になり、
    // 'foo/a.ts' を restore すると 'foo' が中身ごと消えてディレクトリになる(実機で確認、レビュー指摘)
    it('親のパスが未追跡のファイルなら overlaps-untracked(親も pathspec に含めて 1 回で問い合わせる)', async () => {
      setupRaw({ tracked: 'foo/a.ts\0', others: 'foo\0' })
      await expect(classify('foo/a.ts')).resolves.toBe('overlaps-untracked')
      expect(mockRaw).toHaveBeenCalledWith([
        'ls-files',
        '-z',
        '--others',
        '-k',
        '--directory',
        '--',
        ':(literal,icase)foo/a.ts',
        ':(literal,icase)foo'
      ])
    })

    it('2 階層以上上の親が未追跡のファイルでも overlaps-untracked', async () => {
      setupRaw({ tracked: 'a/b/c.txt\0', others: 'a\0' })
      await expect(classify('a/b/c.txt')).resolves.toBe('overlaps-untracked')
      expect(mockRaw).toHaveBeenCalledWith([
        'ls-files',
        '-z',
        '--others',
        '-k',
        '--directory',
        '--',
        ':(literal,icase)a/b/c.txt',
        ':(literal,icase)a',
        ':(literal,icase)a/b'
      ])
    })

    // 親が通常のディレクトリなら、pathspec の親は配下の無関係な未追跡ファイルにも一致する。
    // 親そのもの・対象自身と配下以外の出力で拒否してはならない
    it('親ディレクトリ内の無関係な未追跡ファイルだけなら tracked', async () => {
      setupRaw({ tracked: 'd/e.txt\0', others: 'd/new.txt\0dd/x\0' })
      await expect(classify('d/e.txt')).resolves.toBe('tracked')
    })

    // 大文字小文字を区別しないファイルシステム(macOS・Windows の既定)では、restore が
    // 大文字小文字だけ違う既存のエントリも置き換える。' D Foo/a.ts' と '?? foo' で 'Foo/a.ts' を
    // restore すると 'foo' が消え、' D Bar' と '?? bar/' で 'Bar' を restore すると 'bar/x' が消える
    // (実機で確認、レビュー指摘)。icase で問い合わせ、出力も大文字小文字を無視して比べる
    it.each([
      ['親', 'Foo/a.ts', 'foo\0'],
      ['配下', 'Bar', 'bar/x\0'],
      ['対象自身', 'Baz.txt', 'baz.txt\0'],
      ['親(出力側が大文字)', 'foo/a.ts', 'FOO\0'],
      ['配下(出力側が大文字)', 'bar', 'BAR/x\0']
    ])('大文字小文字だけ違う未追跡の%sも重なりとみなす', async (_label, target, others) => {
      setupRaw({ tracked: `${target}\0`, others })
      await expect(classify(target)).resolves.toBe('overlaps-untracked')
    })

    it('大文字小文字だけ違う親ディレクトリ内の無関係な未追跡ファイルだけなら tracked', async () => {
      setupRaw({ tracked: 'D/e.txt\0', others: 'd/new.txt\0' })
      await expect(classify('D/e.txt')).resolves.toBe('tracked')
    })

    // 削除した追跡済みファイルの位置にネストした git リポジトリがあると、--others には出ない
    // (' T bar' / ' D bar' だけになる)が、restore はそれを .git ごと消す(実機で確認、レビュー指摘)。
    // -k(checkout のために消す必要があるもの)を併用すると 'bar/' として出る。
    // 問い合わせに -k を含めること自体は上の引数の検証と実 git の統合テストで固定する
    it('ネストした git リポジトリ(-k の出力 bar/)と重なる場合も overlaps-untracked', async () => {
      setupRaw({ tracked: 'bar\0', others: 'bar/\0' })
      await expect(classify('bar')).resolves.toBe('overlaps-untracked')
    })

    // ignored のファイルも restore で消えるため、--exclude-standard は付けない
    it('ignored のファイルも対象に含める(--exclude-standard を付けない)', async () => {
      setupRaw({ tracked: 'foo\0', others: '' })
      await classify('foo')
      expect(mockRaw).not.toHaveBeenCalledWith(expect.arrayContaining(['--exclude-standard']))
    })
  })

  // intent-to-add(git add -N、status は ' A')は ls-files に出るが、restore --worktree は
  // ファイルを空にするだけで ' A' のまま残る(履歴が無いので内容が失われる)。
  // 未追跡と同じくゴミ箱へ移す(最終レビューで追加)
  describe('intent-to-add のファイル', () => {
    it('diff --diff-filter=A に完全一致するパスがあれば intent-to-add', async () => {
      setupRaw({ tracked: 'dir/x.txt\0', intentToAdd: 'dir/x.txt\0' })
      await expect(classify('dir/x.txt')).resolves.toBe('intent-to-add')
      expect(mockRaw).toHaveBeenCalledWith([
        'diff',
        '--name-only',
        '-z',
        '--diff-filter=A',
        '--',
        ':(literal)dir/x.txt'
      ])
    })

    // エージェントの変更を戻す(記録の git)は --ignore-submodules=dirty を渡す(入れ子のリポジトリの中の命令を動かさない。
    // ローカルレビュー第 13 周の指摘 1)。渡さないソース管理の取り消しは上のとおり今の引数のまま
    it('diffArgs を渡すと intent-to-add の判定の diff の先頭(diff の直後)に足す', async () => {
      setupRaw({ tracked: 'a.ts\0' })
      await expect(classifyDiscardTarget(git, 'a.ts', ['--ignore-submodules=dirty'])).resolves.toBe(
        'tracked'
      )
      expect(mockRaw).toHaveBeenCalledWith([
        'diff',
        '--ignore-submodules=dirty',
        '--name-only',
        '-z',
        '--diff-filter=A',
        '--',
        ':(literal)a.ts'
      ])
    })

    it('通常の追跡済み(diff --diff-filter=A が空)なら tracked', async () => {
      setupRaw({ tracked: 'a.ts\0', intentToAdd: '' })
      await expect(classify('a.ts')).resolves.toBe('tracked')
    })

    // 配下の intent-to-add は、このパス自身の intent-to-add ではない
    it('配下のファイルだけが diff --diff-filter=A に出る場合は intent-to-add 扱いしない', async () => {
      setupRaw({ tracked: 'foo\0', intentToAdd: 'foo/new.txt\0' })
      await expect(classify('foo')).resolves.toBe('tracked')
    })
  })
})

describe('assertDiscardable', () => {
  it.each([
    ['conflicted', 'コンフリクト中のファイルは取り消せません: f.txt'],
    ['unknown', '状態を判定できないため取り消せません: f.txt'],
    ['overlaps-untracked', '未追跡のファイルと重なるため取り消せません: f.txt']
  ] as const)('%s は日本語のエラーで拒否する', (kind, message) => {
    expect(() => assertDiscardable(kind, 'f.txt')).toThrow(message)
  })

  it.each(['tracked', 'untracked', 'intent-to-add'] as const)('%s は通す', (kind) => {
    expect(() => assertDiscardable(kind, 'f.txt')).not.toThrow()
  })
})
