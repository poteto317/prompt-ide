import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  renameSync,
  symlinkSync
} from 'fs'
import { devNull, tmpdir } from 'os'
import { join } from 'path'
import { discardFileChanges } from '../gitService'

// gitService.test.ts は simple-git をモックするため、「実際の git がこの pathspec で何を出力し、
// restore が何を消すか」は検証できない(大文字小文字だけ違う未追跡ファイルの見落としは
// モックのテストをすり抜けた)。取り消しの安全性に関わる判定だけ、実 git で固定する。
// 大文字小文字を区別するファイルシステムでも区別しないものでも、同じ結果になることを期待する
describe('discardFileChanges(実 git)', () => {
  let repo: string

  // 開発者のグローバル・システムの git 設定(commit.gpgsign、core.hooksPath 等)に左右されないよう、
  // テスト側で実行する git と discardFileChanges(simple-git が子プロセスとして起動する git)の
  // 両方から切り離す
  const isolatedEnv = { GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' }
  const git = (cwd: string, ...args: string[]): void => {
    execFileSync('git', args, { cwd, stdio: 'ignore', env: { ...process.env, ...isolatedEnv } })
  }
  const write = (path: string, content: string): void => {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), content)
  }
  const commitFiles = (files: Record<string, string>): void => {
    Object.entries(files).forEach(([path, content]) => write(path, content))
    git(repo, 'add', '.')
    commit(repo)
  }
  const gitOutput = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, env: { ...process.env, ...isolatedEnv } }).toString()
  // index / status の表記(macOS は NFC に揃い、Linux はディスク上の表記のまま)
  const indexPaths = (...args: string[]): string[] =>
    gitOutput('ls-files', '-z', ...args)
      .split('\0')
      .filter((entry) => entry !== '')
  const commit = (cwd: string): void => {
    git(cwd, '-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-qm', 'init')
  }

  beforeEach(() => {
    Object.entries(isolatedEnv).forEach(([key, value]) => vi.stubEnv(key, value))
    repo = mkdtempSync(join(tmpdir(), 'discard-integration-'))
    git(repo, 'init', '-q')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(repo, { recursive: true, force: true })
  })

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
      git(nested, 'init', '-q')
      write('bar/x', 'PRECIOUS')
      if (withCommit) {
        git(nested, 'add', 'x')
        commit(nested)
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
    const caseInsensitive = ((): boolean => {
      const probe = mkdtempSync(join(tmpdir(), 'case-probe-'))
      try {
        writeFileSync(join(probe, 'a'), '')
        return existsSync(join(probe, 'A'))
      } finally {
        rmSync(probe, { recursive: true, force: true })
      }
    })()

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
    git(join(repo, 'sub'), 'init', '-q')
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
