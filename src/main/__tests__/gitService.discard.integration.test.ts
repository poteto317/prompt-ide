import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
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

  it('未追跡のファイルは restore せずゴミ箱へ移す関数に渡す', async () => {
    commitFiles({ 'a.ts': 'x' })
    write('new.txt', 'new')
    const trash = vi.fn().mockResolvedValue(undefined)
    await discardFileChanges(repo, 'new.txt', trash)
    expect(trash).toHaveBeenCalledWith(join(repo, 'new.txt'))
  })
})
