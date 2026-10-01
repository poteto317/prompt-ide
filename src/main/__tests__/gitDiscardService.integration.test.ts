import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
  renameSync,
  symlinkSync,
  chmodSync,
  statSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { discardAllChanges, discardFileChanges, discardHunk } from '../gitDiscardService'
import { getGitStatus } from '../gitService'
import { isUnstagedFile } from '../../renderer/src/lib/gitUtils'
import {
  commitAll,
  initRepo,
  isCaseInsensitiveFs,
  readRepoFile,
  runGit,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'

// 3 つの describe で共有する一時リポジトリ(テストごとに作って片付ける)
let repo: string
const write = (path: string, content: string): void => writeRepoFile(repo, path, content)
const read = (path: string): string => readRepoFile(repo, path)

beforeEach(() => {
  stubIsolatedGitEnv()
  repo = mkdtempSync(join(tmpdir(), 'discard-integration-'))
  initRepo(repo)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(repo, { recursive: true, force: true })
})

// gitDiscardService.test.ts は simple-git をモックするため、「実際の git がこの pathspec で何を出力し、
// restore が何を消すか」は検証できない(大文字小文字だけ違う未追跡ファイルの見落としは
// モックのテストをすり抜けた)。取り消しの安全性に関わる判定だけ、実 git で固定する。
// 大文字小文字を区別するファイルシステムでも区別しないものでも、同じ結果になることを期待する
describe('discardFileChanges(実 git)', () => {
  // 実行する git は helpers の runGit(グローバル設定・リポジトリ位置の環境変数から切り離し済み)
  const commitFiles = (files: Record<string, string>): void => {
    Object.entries(files).forEach(([path, content]) => write(path, content))
    commitAll(repo, 'init')
  }
  // index / status の表記(macOS は NFC に揃い、Linux はディスク上の表記のまま)
  const indexPaths = (...args: string[]): string[] =>
    runGit(repo, 'ls-files', '-z', ...args)
      .split('\0')
      .filter((entry) => entry !== '')

  it('変更した追跡済みファイルを HEAD の内容へ戻す', async () => {
    commitFiles({ 'src/a.ts': 'original' })
    write('src/a.ts', 'changed')
    await discardFileChanges(repo, 'src/a.ts', vi.fn())
    expect(readFileSync(join(repo, 'src/a.ts'), 'utf8')).toBe('original')
  })

  it('親ディレクトリ内の無関係な未追跡ファイルは残して restore する', async () => {
    commitFiles({ 'd/e.txt': 'original' })
    write('d/e.txt', 'changed')
    write('d/new.txt', 'keep')
    await discardFileChanges(repo, 'd/e.txt', vi.fn())
    expect(readFileSync(join(repo, 'd/e.txt'), 'utf8')).toBe('original')
    expect(readFileSync(join(repo, 'd/new.txt'), 'utf8')).toBe('keep')
  })

  it('親ディレクトリ内の ignored のディレクトリ(node_modules 等)は残して restore する', async () => {
    commitFiles({ 'd/e.txt': 'original' })
    write('.git/info/exclude', 'node_modules\n')
    write('d/e.txt', 'changed')
    write('d/node_modules/pkg/index.js', 'keep')
    await discardFileChanges(repo, 'd/e.txt', vi.fn())
    expect(readFileSync(join(repo, 'd/e.txt'), 'utf8')).toBe('original')
    expect(readFileSync(join(repo, 'd/node_modules/pkg/index.js'), 'utf8')).toBe('keep')
  })

  it.each([
    ['親が未追跡のファイル', 'foo/a.ts', 'foo', 'foo'],
    ['配下に未追跡のファイル', 'bar', 'bar/x', 'bar/x'],
    ['大文字小文字だけ違う親', 'Foo/a.ts', 'foo', 'foo'],
    ['大文字小文字だけ違う配下', 'Bar', 'bar/x', 'bar/x'],
    ['大文字小文字だけ違う親(未追跡側が大文字)', 'foo/a.ts', 'FOO', 'FOO']
  ])(
    '%s と重なる場合は拒否し、未追跡のファイルを消さない',
    async (_label, tracked, untracked, precious) => {
      commitFiles({ [tracked]: 'tracked' })
      rmSync(join(repo, tracked.split('/')[0]), { recursive: true, force: true })
      write(untracked, 'PRECIOUS')
      await expect(discardFileChanges(repo, tracked, vi.fn())).rejects.toThrow(
        `未追跡のファイルと重なるため取り消せません: ${tracked}`
      )
      expect(existsSync(join(repo, precious))).toBe(true)
      expect(readFileSync(join(repo, precious), 'utf8')).toBe('PRECIOUS')
    }
  )

  // ネストした git リポジトリは --others に出ないが、restore は .git ごと消す(レビュー指摘)
  it.each([
    ['コミットあり', true],
    ['コミットなし', false]
  ])(
    '削除した追跡済みファイルの位置にネストした git リポジトリ(%s)があれば拒否し、.git を消さない',
    async (_label, withCommit) => {
      commitFiles({ bar: 'tracked' })
      rmSync(join(repo, 'bar'))
      const nested = join(repo, 'bar')
      mkdirSync(nested)
      runGit(nested, 'init', '-q')
      write('bar/x', 'PRECIOUS')
      if (withCommit) {
        // ネスト側は initRepo していないため commitAll では identity が無い。この 1 箇所だけ
        // コミッター情報を -c で渡す(グローバル設定は切り離し済みで他から補われない)
        runGit(nested, 'add', 'x')
        runGit(
          nested,
          '-c',
          'user.email=test@example.com',
          '-c',
          'user.name=test',
          'commit',
          '-qm',
          'nested'
        )
      }
      await expect(discardFileChanges(repo, 'bar', vi.fn())).rejects.toThrow(
        '未追跡のファイルと重なるため取り消せません: bar'
      )
      expect(existsSync(join(nested, '.git'))).toBe(true)
      expect(readFileSync(join(nested, 'x'), 'utf8')).toBe('PRECIOUS')
    }
  )

  it('ignored のファイルと重なる場合も拒否する', async () => {
    commitFiles({ 'foo/a.ts': 'tracked' })
    rmSync(join(repo, 'foo'), { recursive: true, force: true })
    write('.git/info/exclude', 'foo\n')
    write('foo', 'PRECIOUS')
    await expect(discardFileChanges(repo, 'foo/a.ts', vi.fn())).rejects.toThrow(
      '未追跡のファイルと重なるため取り消せません: foo/a.ts'
    )
    expect(readFileSync(join(repo, 'foo'), 'utf8')).toBe('PRECIOUS')
  })

  // 追跡済みに完全一致しないパスを「未追跡」とみなすと、表記が index とずれたパスで追跡済みの
  // 変更ファイルがゴミ箱へ移る(PR レビュー指摘)。未追跡は ls-files --others で肯定的に確かめる
  describe('パスの表記が index とずれている場合', () => {
    const nfc = 'プロンプト'.normalize('NFC')
    const nfd = nfc.normalize('NFD')

    it('NFD のディレクトリ内の追跡済みファイルは、index の表記なら restore し、別の表記なら拒否する', async () => {
      commitFiles({ [`${nfd}/a.md`]: 'original' })
      write(`${nfd}/a.md`, 'changed')
      const [indexPath] = indexPaths()
      const otherPath = indexPath === `${nfc}/a.md` ? `${nfd}/a.md` : `${nfc}/a.md`
      const trash = vi.fn()
      await expect(discardFileChanges(repo, otherPath, trash)).rejects.toThrow(
        `状態を判定できないため取り消せません: ${otherPath}`
      )
      expect(trash).not.toHaveBeenCalled()
      expect(readFileSync(join(repo, `${nfd}/a.md`), 'utf8')).toBe('changed')
      await discardFileChanges(repo, indexPath, trash)
      expect(readFileSync(join(repo, `${nfd}/a.md`), 'utf8')).toBe('original')
    })

    it('NFD のディレクトリ内の未追跡ファイルは、status の表記でゴミ箱へ移す', async () => {
      commitFiles({ 'a.ts': 'x' })
      write(`${nfd}/new.md`, 'new')
      const [untrackedPath] = indexPaths('--others')
      const trash = vi.fn().mockResolvedValue(undefined)
      await discardFileChanges(repo, untrackedPath, trash)
      expect(trash).toHaveBeenCalledWith(join(repo, untrackedPath))
    })

    // 大文字小文字を区別する FS では 'Src' と 'src' が別物になり、この配置自体が作れない
    const caseInsensitive = isCaseInsensitiveFs()

    it.skipIf(!caseInsensitive)(
      '大文字小文字だけ違うディレクトリ名に変えた追跡済みファイルは、index の表記でだけ restore する',
      async () => {
        commitFiles({ 'Src/a.ts': 'original' })
        renameSync(join(repo, 'Src'), join(repo, 'tmp'))
        renameSync(join(repo, 'tmp'), join(repo, 'src'))
        write('src/a.ts', 'changed')
        const trash = vi.fn()
        await expect(discardFileChanges(repo, 'src/a.ts', trash)).rejects.toThrow(
          '状態を判定できないため取り消せません: src/a.ts'
        )
        expect(trash).not.toHaveBeenCalled()
        expect(readFileSync(join(repo, 'src/a.ts'), 'utf8')).toBe('changed')
        await discardFileChanges(repo, 'Src/a.ts', trash)
        expect(readFileSync(join(repo, 'src/a.ts'), 'utf8')).toBe('original')
      }
    )

    // Windows ではシンボリックリンクの作成に権限が要るため対象外
    it.skipIf(process.platform === 'win32')(
      'シンボリックリンクの祖先を経由したパスは拒否し、リンク先の実体に触れない',
      async () => {
        commitFiles({ 'd/t.txt': 'original' })
        write('d/t.txt', 'changed')
        symlinkSync('d', join(repo, 'linkd'))
        const trash = vi.fn()
        await expect(discardFileChanges(repo, 'linkd/t.txt', trash)).rejects.toThrow(
          '状態を判定できないため取り消せません: linkd/t.txt'
        )
        expect(trash).not.toHaveBeenCalled()
        expect(readFileSync(join(repo, 'd/t.txt'), 'utf8')).toBe('changed')
      }
    )
  })

  // git status はネストした未追跡のリポジトリを 'sub/' で返す(IPC 側で末尾の / は落ちる)
  it('ネストした未追跡のリポジトリはゴミ箱へ移す関数に渡す', async () => {
    commitFiles({ 'a.ts': 'x' })
    mkdirSync(join(repo, 'sub'))
    runGit(join(repo, 'sub'), 'init', '-q')
    write('sub/x', 'x')
    const trash = vi.fn().mockResolvedValue(undefined)
    await discardFileChanges(repo, 'sub', trash)
    expect(trash).toHaveBeenCalledWith(join(repo, 'sub'))
  })

  it('未追跡のファイルは restore せずゴミ箱へ移す関数に渡す', async () => {
    commitFiles({ 'a.ts': 'x' })
    write('new.txt', 'new')
    const trash = vi.fn().mockResolvedValue(undefined)
    await discardFileChanges(repo, 'new.txt', trash)
    expect(trash).toHaveBeenCalledWith(join(repo, 'new.txt'))
  })
})

// renderer の buildHunkPatch と同じ形: git diff の出力から、ヘッダー + 指定したハンクだけを組み立てる
describe('discardHunk(実 git)', () => {
  const lines = (n: number): string[] => Array.from({ length: n }, (_, i) => `line${i + 1}`)
  const hunkPatch = (filePath: string, hunkIndex: number, ...extraArgs: string[]): string => {
    const diff = runGit(repo, 'diff', ...extraArgs, '--', filePath).split('\n')
    const starts = diff.flatMap((line, i) => (line.startsWith('@@ ') ? [i] : []))
    const header = diff.slice(0, starts[0])
    const body = diff.slice(starts[hunkIndex], starts[hunkIndex + 1] ?? diff.length)
    return [...header, ...body].join('\n').replace(/\n*$/, '\n')
  }
  // 5 行目と 35 行目を変更した 2 ハンクのファイルを作る
  const setupTwoHunks = (): { original: string[]; changed: string[] } => {
    const original = lines(40)
    write('f.txt', original.join('\n') + '\n')
    commitAll(repo, 'init')
    const changed = [...original]
    changed[4] = 'CHANGED5'
    changed[34] = 'CHANGED35'
    write('f.txt', changed.join('\n') + '\n')
    return { original, changed }
  }

  it('2 番目のハンクだけ取り消すと、1 番目の変更は残り、2 番目は戻る', async () => {
    const { original, changed } = setupTwoHunks()
    await discardHunk(repo, 'f.txt', hunkPatch('f.txt', 1))
    const expected = [...changed]
    expected[34] = original[34]
    expect(read('f.txt')).toBe(expected.join('\n') + '\n')
  })

  it('ステージ済みの別の変更は残り、index は変わらない', async () => {
    const original = lines(40)
    write('f.txt', original.join('\n') + '\n')
    write('g.txt', 'g\n')
    commitAll(repo, 'init')
    write('g.txt', 'g-staged\n')
    runGit(repo, 'add', 'g.txt')
    const changed = [...original]
    changed[4] = 'CHANGED5'
    changed[34] = 'CHANGED35'
    write('f.txt', changed.join('\n') + '\n')
    const cachedBefore = runGit(repo, 'diff', '--cached')
    await discardHunk(repo, 'f.txt', hunkPatch('f.txt', 1))
    expect(runGit(repo, 'diff', '--cached')).toBe(cachedBefore)
    expect(read('g.txt')).toBe('g-staged\n')
  })

  it('diff 取得後にファイルがさらに変更されていると失敗し、ファイルの内容は変わらない', async () => {
    setupTwoHunks()
    const patch = hunkPatch('f.txt', 1)
    const modified = read('f.txt').replace('CHANGED35', 'EDITED35')
    write('f.txt', modified)
    await expect(discardHunk(repo, 'f.txt', patch)).rejects.toThrow(
      'ハンクを取り消せませんでした。ファイルが変更された可能性があります。diff を開き直してください'
    )
    expect(read('f.txt')).toBe(modified)
  })

  it('作業ツリーで削除されたファイルのハンクで、ファイルが復元される', async () => {
    write('f.txt', 'a\nb\n')
    commitAll(repo, 'init')
    rmSync(join(repo, 'f.txt'))
    await discardHunk(repo, 'f.txt', hunkPatch('f.txt', 0))
    expect(read('f.txt')).toBe('a\nb\n')
  })

  it('core.autocrlf=true の CRLF ファイルで、改行コードを保ったまま戻る', async () => {
    runGit(repo, 'config', 'core.autocrlf', 'true')
    const original = lines(40)
    write('f.txt', original.join('\r\n') + '\r\n')
    commitAll(repo, 'init')
    const changed = [...original]
    changed[4] = 'CHANGED5'
    changed[34] = 'CHANGED35'
    write('f.txt', changed.join('\r\n') + '\r\n')
    await discardHunk(repo, 'f.txt', hunkPatch('f.txt', 1))
    const expected = [...changed]
    expected[34] = original[34]
    expect(read('f.txt')).toBe(expected.join('\r\n') + '\r\n')
  })

  it('chmod +x を伴う変更(old mode / new mode つきの diff)でも、内容が戻りモードは残る', async () => {
    write('f.txt', 'x\ny\nz\n')
    commitAll(repo, 'init')
    write('f.txt', 'x\nQ\nz\n')
    chmodSync(join(repo, 'f.txt'), 0o755)
    const patch = hunkPatch('f.txt', 0)
    expect(patch).toContain('old mode 100644')
    await discardHunk(repo, 'f.txt', patch)
    expect(read('f.txt')).toBe('x\ny\nz\n')
    expect(statSync(join(repo, 'f.txt')).mode & 0o111).toBe(0o111)
  })

  it('未追跡のファイルは拒否され、ファイルは変わらない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('new.txt', 'x\ny\n')
    const patch = [
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,2 @@',
      '+x',
      '+y',
      ''
    ].join('\n')
    await expect(discardHunk(repo, 'new.txt', patch)).rejects.toThrow(
      'ゴミ箱へ移す対象のため、ハンクでは取り消せません: new.txt'
    )
    expect(read('new.txt')).toBe('x\ny\n')
  })

  it('intent-to-add のファイルは拒否され、ファイルは変わらない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('new.txt', 'x\ny\n')
    runGit(repo, 'add', '-N', 'new.txt')
    const patch = hunkPatch('new.txt', 0)
    await expect(discardHunk(repo, 'new.txt', patch)).rejects.toThrow(
      'ゴミ箱へ移す対象のため、ハンクでは取り消せません: new.txt'
    )
    expect(read('new.txt')).toBe('x\ny\n')
  })

  it('コンフリクト中のファイルは拒否され、ファイルは変わらない', async () => {
    write('c.txt', 'base\n')
    commitAll(repo, 'init')
    runGit(repo, 'checkout', '-q', '-b', 'other')
    write('c.txt', 'other\n')
    commitAll(repo, 'other')
    runGit(repo, 'checkout', '-q', 'main')
    write('c.txt', 'main\n')
    commitAll(repo, 'main')
    try {
      runGit(repo, 'merge', 'other')
    } catch {
      // コンフリクトで非ゼロ終了する
    }
    const conflicted = read('c.txt')
    const patch = [
      'diff --git a/c.txt b/c.txt',
      '--- a/c.txt',
      '+++ b/c.txt',
      '@@ -1 +1 @@',
      '-main',
      '+other',
      ''
    ].join('\n')
    await expect(discardHunk(repo, 'c.txt', patch)).rejects.toThrow(
      'コンフリクト中のファイルは取り消せません: c.txt'
    )
    expect(read('c.txt')).toBe(conflicted)
  })

  it('別のファイルを対象にしたパッチは拒否され、どちらのファイルも変わらない', async () => {
    write('f.txt', 'f\n')
    write('g.txt', 'g\n')
    commitAll(repo, 'init')
    write('f.txt', 'f-changed\n')
    write('g.txt', 'g-changed\n')
    await expect(discardHunk(repo, 'f.txt', hunkPatch('g.txt', 0))).rejects.toThrow(
      'パッチの対象がファイルと一致しません'
    )
    expect(read('f.txt')).toBe('f-changed\n')
    expect(read('g.txt')).toBe('g-changed\n')
  })

  it('リネームのパッチ(旧パスのファイルも書き換える)は拒否され、どちらのファイルも変わらない', async () => {
    write('old.txt', 'a\nb\nc\nd\n')
    commitAll(repo, 'init')
    runGit(repo, 'mv', 'old.txt', 'new.txt')
    write('new.txt', 'a\nb\nc\nd\ne\n')
    runGit(repo, 'add', '-A')
    const patch = runGit(repo, 'diff', '--cached', '-M', 'HEAD')
    expect(patch).toContain('rename from old.txt')
    await expect(discardHunk(repo, 'new.txt', patch)).rejects.toThrow(
      'パッチの対象がファイルと一致しません'
    )
    expect(read('new.txt')).toBe('a\nb\nc\nd\ne\n')
    expect(existsSync(join(repo, 'old.txt'))).toBe(false)
  })

  // numstat は順方向の新パスしか返さないが、--reverse では old / new が入れ替わり別のファイルを
  // 書き換えられた(レビューで実機再現)。構造の許可リストで拒否し、どのファイルも変えない
  describe('悪意のあるパッチ', () => {
    const setupChangedF = (): string => {
      write('f.txt', 'x\ny\nz\n')
      write('other.txt', 'other\n')
      commitAll(repo, 'init')
      write('f.txt', 'x\nPWNED\nz\n')
      return 'x\nPWNED\nz\n'
    }
    const expectUntouched = (fContent: string): void => {
      expect(read('f.txt')).toBe(fContent)
      expect(read('other.txt')).toBe('other\n')
      expect(existsSync(join(repo, 'evil.sh'))).toBe(false)
    }
    const BODY = ['@@ -1,3 +1,3 @@', ' x', '-y', '+PWNED', ' z', ''].join('\n')

    it('rename old / rename new の旧形式で、別のファイルを経由して書き換えるパッチ', async () => {
      const fContent = setupChangedF()
      const patch = [
        'diff --git a/evil.sh b/f.txt',
        'similarity index 50%',
        'rename old evil.sh',
        'rename new f.txt',
        '--- a/evil.sh',
        '+++ b/f.txt',
        BODY
      ].join('\n')
      await expect(discardHunk(repo, 'f.txt', patch)).rejects.toThrow(
        'パッチの対象がファイルと一致しません'
      )
      expectUntouched(fContent)
    })

    it('rename 行が無く、a と b のパスだけが違うパッチ(逆適用で既存の other.txt を上書きする)', async () => {
      const fContent = setupChangedF()
      const patch = ['diff --git a/other.txt b/f.txt', '--- a/other.txt', '+++ b/f.txt', BODY].join(
        '\n'
      )
      await expect(discardHunk(repo, 'f.txt', patch)).rejects.toThrow(
        'パッチの対象がファイルと一致しません'
      )
      expectUntouched(fContent)
    })

    it('削除の復元で、index 行のモードに 120000 を指定してシンボリックリンクとして復元させるパッチ', async () => {
      write('f.txt', 'a\n')
      commitAll(repo, 'init')
      rmSync(join(repo, 'f.txt'))
      const patch = [
        'diff --git a/f.txt b/f.txt',
        'deleted file mode 100644',
        'index 1234567..0000000 120000',
        '--- a/f.txt',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-../../../../../../Users',
        '\\ No newline at end of file',
        ''
      ].join('\n')
      await expect(discardHunk(repo, 'f.txt', patch)).rejects.toThrow(
        'パッチの対象がファイルと一致しません'
      )
      expect(existsSync(join(repo, 'f.txt'))).toBe(false)
      expect(runGit(repo, 'status', '--porcelain')).toBe(' D f.txt\n')
    })

    it('新規作成のパッチ(--- /dev/null)は逆適用でファイルが消えるため拒否する', async () => {
      const fContent = setupChangedF()
      const patch = [
        'diff --git a/f.txt b/f.txt',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/f.txt',
        '@@ -0,0 +1,3 @@',
        '+x',
        '+PWNED',
        '+z',
        ''
      ].join('\n')
      await expect(discardHunk(repo, 'f.txt', patch)).rejects.toThrow(
        'パッチの対象がファイルと一致しません'
      )
      expectUntouched(fContent)
    })

    it('ハンクの後ろに別ファイルのヘッダーを紛れ込ませたパッチ', async () => {
      const fContent = setupChangedF()
      const patch = [
        'diff --git a/f.txt b/f.txt',
        '--- a/f.txt',
        '+++ b/f.txt',
        BODY + '--- a/other.txt',
        '+++ b/other.txt',
        '@@ -1 +1 @@',
        '-other',
        '+changed',
        ''
      ].join('\n')
      await expect(discardHunk(repo, 'f.txt', patch)).rejects.toThrow(
        'パッチの対象がファイルと一致しません'
      )
      expectUntouched(fContent)
    })
  })

  it('日本語・空白を含むパスのハンクも取り消せる(引用符つきのヘッダーを許可する)', async () => {
    write('日本語 dir/ファイル.txt', 'a\nb\nc\n')
    commitAll(repo, 'init')
    write('日本語 dir/ファイル.txt', 'a\nB\nc\n')
    await discardHunk(repo, '日本語 dir/ファイル.txt', hunkPatch('日本語 dir/ファイル.txt', 0))
    expect(read('日本語 dir/ファイル.txt')).toBe('a\nb\nc\n')
  })
})

describe('discardAllChanges(実 git)', () => {
  // trash はスタブ。渡された絶対パスを記録する
  let trashed: string[]
  const trash = async (absolutePath: string): Promise<void> => {
    trashed.push(absolutePath)
  }

  beforeEach(() => {
    trashed = []
  })

  // 確認ダイアログを出した時点の一覧。renderer(useDiscardAllChanges)と同じく simple-git の status の
  // 「変更」セクション(isUnstagedFile)から path + (index + workingDir) を作る
  const shown = async (): Promise<{ path: string; status: string }[]> =>
    (await getGitStatus(repo)).files
      .filter(isUnstagedFile)
      .map((f) => ({ path: f.path, status: f.index + f.workingDir }))
  const MISMATCH = '変更の状態が変わったため取り消しを中止しました。もう一度操作してください'

  it('追跡済み・未追跡・intent-to-add の混在を取り消し、ステージ済みの別ファイルは残す', async () => {
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    write('s.txt', 's\n')
    commitAll(repo, 'init')
    write('a.txt', 'a-changed\n')
    write('b.txt', 'b-changed\n')
    write('s.txt', 's-staged\n')
    runGit(repo, 'add', 's.txt')
    write('new.txt', 'new\n')
    write('ita.txt', 'ita\n')
    runGit(repo, 'add', '-N', 'ita.txt')

    await expect(discardAllChanges(repo, await shown(), trash)).resolves.toEqual({ status: 'done' })

    expect(read('a.txt')).toBe('a\n')
    expect(read('b.txt')).toBe('b\n')
    expect(trashed.sort()).toEqual([join(repo, 'ita.txt'), join(repo, 'new.txt')])
    expect(runGit(repo, 'diff', '--cached', '--name-only').trim()).toBe('s.txt')
    expect(read('s.txt')).toBe('s-staged\n')
    expect(runGit(repo, 'ls-files', '--', 'ita.txt')).toBe('')
  })

  it('ゴミ箱への移動が 2 件目で失敗したら、1 件目は取り消されたまま partial を返す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('a.txt', 'a-changed\n')
    write('b-new.txt', 'b\n')
    const failingTrash = async (absolutePath: string): Promise<void> => {
      throw new Error(`denied: ${absolutePath}`)
    }

    const result = await discardAllChanges(repo, await shown(), failingTrash)

    // 追跡済みの a.txt が先に取り消され(パス順)、未追跡の b-new.txt のゴミ箱移動で止まる
    expect(result).toEqual({
      status: 'partial',
      message: expect.stringContaining(
        '一括の取り消しが途中で失敗しました（1 / 2 件を取り消し済み）'
      )
    })
    expect(read('a.txt')).toBe('a\n')
    expect(existsSync(join(repo, 'b-new.txt'))).toBe(true)
  })

  it('ステージ済みと作業ツリーの両方に変更があるファイルは、作業ツリーの分だけ戻す', async () => {
    write('m.txt', 'base\n')
    commitAll(repo, 'init')
    write('m.txt', 'staged\n')
    runGit(repo, 'add', 'm.txt')
    const cachedBefore = runGit(repo, 'diff', '--cached')
    write('m.txt', 'staged\nworking\n')

    await discardAllChanges(repo, await shown(), trash)

    expect(read('m.txt')).toBe('staged\n')
    expect(runGit(repo, 'diff', '--cached')).toBe(cachedBefore)
  })

  it('件数が実際と違えば拒否し、何も変わらない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('a.txt', 'a-changed\n')
    const confirmed = await shown()
    write('new.txt', 'new\n')
    await expect(discardAllChanges(repo, confirmed, trash)).rejects.toThrow(MISMATCH)
    expect(read('a.txt')).toBe('a-changed\n')
    expect(trashed).toEqual([])
  })

  // 再現: 確認時は未追跡の scratch.txt 1 件 → 間に git add scratch.txt と a.txt の編集 → 件数は 1 件のまま。
  // 件数だけの照合では通り、a.txt の編集が restore で復元できない形で消えていた(このPRで修正)
  it('件数が同じでも中身が入れ替わっていれば拒否し、確認していない編集を消さない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('scratch.txt', 'scratch\n')
    const confirmed = await shown()
    expect(confirmed).toEqual([{ path: 'scratch.txt', status: '??' }])

    runGit(repo, 'add', 'scratch.txt')
    write('a.txt', 'a\nwork\n')

    await expect(discardAllChanges(repo, confirmed, trash)).rejects.toThrow(MISMATCH)
    expect(read('a.txt')).toBe('a\nwork\n')
    expect(runGit(repo, 'diff', '--cached', '--name-only').trim()).toBe('scratch.txt')
    expect(trashed).toEqual([])
  })

  it('同じパスでステータスだけが変わっていれば拒否し、内容を消さない(?? → AM)', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('x.txt', 'x\n')
    const confirmed = await shown()

    runGit(repo, 'add', 'x.txt')
    write('x.txt', 'x\nmore\n')

    await expect(discardAllChanges(repo, confirmed, trash)).rejects.toThrow(MISMATCH)
    expect(read('x.txt')).toBe('x\nmore\n')
    expect(trashed).toEqual([])
  })

  it('一覧の順序が違っても照合が通る', async () => {
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    commitAll(repo, 'init')
    write('a.txt', 'a2\n')
    write('b.txt', 'b2\n')
    const confirmed = (await shown()).reverse()
    await expect(discardAllChanges(repo, confirmed, trash)).resolves.toEqual({ status: 'done' })
    expect(read('a.txt')).toBe('a\n')
    expect(read('b.txt')).toBe('b\n')
  })

  // expected は renderer と同じ作り(simple-git の status)。表記のずれは常に「中止」になるため、
  // 実 git の出力で通ることを固定する
  // simple-git は行の末尾の空白だけを削る(先頭の空白は残る)。main の照合キーを両端 trim にすると、
  // 先頭が空白のパスは renderer と一致せず、一括取り消しが毎回中止された(このPRで修正)
  it.each([
    ['半角空白で始まる未追跡パス', ' lead.txt'],
    ['全角空白で始まる未追跡パス', '\u3000zen.txt'],
    ['先頭と末尾の両方が空白の未追跡パス', ' both '],
    ['末尾が空白の未追跡パス', 'trail ']
  ])('%s でも照合が通り、取り消しが実行される', async (_label, name) => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write(name, 'x\n')
    const confirmed = await shown()
    expect(confirmed).toHaveLength(1)
    expect(confirmed[0].status).toBe('??')
    await expect(discardAllChanges(repo, confirmed, trash)).resolves.toEqual({ status: 'done' })
    expect(trashed).toEqual([join(repo, name)])
  })

  it('先頭が空白でステージ済み + 作業ツリー変更(AM)のパスでも照合が通る', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write(' lead.txt', 'x\n')
    runGit(repo, 'add', ' lead.txt')
    write(' lead.txt', 'x\nmore\n')
    const confirmed = await shown()
    expect(confirmed).toEqual([{ path: ' lead.txt', status: 'AM' }])
    await expect(discardAllChanges(repo, confirmed, trash)).resolves.toEqual({ status: 'done' })
    expect(read(' lead.txt')).toBe('x\n')
  })

  it('ネストした git リポジトリ(sub/)と、末尾空白・日本語・空白入りのパスで照合が通る', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    mkdirSync(join(repo, 'sub'))
    runGit(join(repo, 'sub'), 'init', '-q')
    write('sub/f.txt', 'f\n')
    write('trailsp ', 'trail\n')
    write('日本語 dir/ファイル.txt', 'j\n')

    const confirmed = await shown()
    expect(confirmed.map((e) => e.path)).toContain('sub/')
    expect(confirmed.map((e) => e.path)).toContain('trailsp')

    await expect(discardAllChanges(repo, confirmed, trash)).resolves.toEqual({ status: 'done' })
    expect(trashed.sort()).toEqual(
      [join(repo, 'sub'), join(repo, 'trailsp '), join(repo, '日本語 dir/ファイル.txt')].sort()
    )
  })

  it('intent-to-add のリネーム(` R`)でも照合が通る', async () => {
    write('old.txt', 'one\ntwo\nthree\nfour\n')
    commitAll(repo, 'init')
    renameSync(join(repo, 'old.txt'), join(repo, 'new.txt'))
    runGit(repo, 'add', '-N', 'new.txt')
    const confirmed = await shown()
    expect(confirmed.map((e) => e.status)).toContain(' R')
    await expect(discardAllChanges(repo, confirmed, trash)).resolves.toEqual({ status: 'done' })
    expect(trashed).toEqual([join(repo, 'new.txt')])
  })

  it('ステージ済みリネーム + 変更(`RM`)でも照合が通る', async () => {
    write('old1.txt', 'one\ntwo\nthree\nfour\n')
    write('old2.txt', 'uno\ndos\ntres\ncuatro\n')
    commitAll(repo, 'init')
    runGit(repo, 'mv', 'old2.txt', 'new2.txt')
    write('new2.txt', 'uno\ndos\ntres\ncuatro\nmas\n')
    const confirmed = await shown()
    expect(confirmed.map((e) => e.status)).toContain('RM')
    await expect(discardAllChanges(repo, confirmed, trash)).resolves.toEqual({ status: 'done' })
    expect(read('new2.txt')).toBe('uno\ndos\ntres\ncuatro\n')
  })

  it('status.renames=false でも照合が通る', async () => {
    write('old.txt', 'one\ntwo\nthree\nfour\n')
    commitAll(repo, 'init')
    runGit(repo, 'config', 'status.renames', 'false')
    runGit(repo, 'mv', 'old.txt', 'new.txt')
    write('new.txt', 'one\ntwo\nthree\nfour\nfive\n')
    await expect(discardAllChanges(repo, await shown(), trash)).resolves.toEqual({
      status: 'done'
    })
    expect(read('new.txt')).toBe('one\ntwo\nthree\nfour\n')
  })

  it('コンフリクトのファイルが 1 件あれば、他の追跡済みの変更も含めて何も変わらない', async () => {
    write('c.txt', 'base\n')
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    runGit(repo, 'checkout', '-q', '-b', 'other')
    write('c.txt', 'other\n')
    commitAll(repo, 'other')
    runGit(repo, 'checkout', '-q', 'main')
    write('c.txt', 'main\n')
    commitAll(repo, 'main')
    try {
      runGit(repo, 'merge', 'other')
    } catch {
      // コンフリクトで非ゼロ終了する
    }
    write('a.txt', 'a-changed\n')
    write('new.txt', 'new\n')
    const conflicted = read('c.txt')

    await expect(discardAllChanges(repo, await shown(), trash)).rejects.toThrow(
      '取り消せないファイルがあるため、何も取り消しませんでした（c.txt）'
    )
    expect(read('a.txt')).toBe('a-changed\n')
    expect(read('c.txt')).toBe(conflicted)
    expect(trashed).toEqual([])
  })

  it('ステージ済みのリネームと、日本語・空白を含むパスの混在も件数が一致して取り消せる', async () => {
    write('old.txt', 'one\ntwo\nthree\n')
    write('日本語 dir/ファイル.txt', 'x\n')
    commitAll(repo, 'init')
    runGit(repo, 'mv', 'old.txt', 'renamed.txt')
    write('日本語 dir/ファイル.txt', 'x-changed\n')

    await discardAllChanges(repo, await shown(), trash)

    expect(read('日本語 dir/ファイル.txt')).toBe('x\n')
    expect(existsSync(join(repo, 'renamed.txt'))).toBe(true)
  })

  it('変更が 0 件で一覧も空なら何も起きない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    await expect(discardAllChanges(repo, [], trash)).resolves.toEqual({ status: 'done' })
    expect(read('a.txt')).toBe('a\n')
    expect(trashed).toEqual([])
  })
})
