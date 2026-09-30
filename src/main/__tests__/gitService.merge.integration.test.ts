import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { mergeBranch } from '../gitService'
import {
  commitAll,
  initRepo,
  isCaseInsensitiveFs,
  runGit,
  runGitWithEnv,
  stubIsolatedGitEnv
} from './helpers/realGitRepo'

// gitService.test.ts は simple-git をモックするため、「実際の git がマージ・中止で working tree と
// MERGE_HEAD をどう変えるか」は検証できない。データを失わないことに関わる判定だけ、実 git で固定する
describe('mergeBranch(実 git)', () => {
  let repo: string

  const write = (path: string, content: string): void => {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), content)
  }
  const read = (path: string): string => readFileSync(join(repo, path), 'utf8')
  const head = (): string => runGit(repo, 'rev-parse', 'HEAD').trim()
  const status = (): string => runGit(repo, 'status', '--porcelain')
  const hasMergeHead = (): boolean => {
    try {
      runGit(repo, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')
      return true
    } catch {
      return false
    }
  }
  const commit = (files: Record<string, string>, message: string): void => {
    Object.entries(files).forEach(([path, content]) => write(path, content))
    commitAll(repo, message)
  }
  // main と feature が分岐した状態を作る。conflict なら両方が a.txt を変更する
  const setupDiverged = (conflict: boolean): void => {
    commit({ 'a.txt': 'base' }, 'base')
    runGit(repo, 'checkout', '-q', '-b', 'feature')
    commit(conflict ? { 'a.txt': 'feature' } : { 'f.txt': 'feature' }, 'feature')
    runGit(repo, 'checkout', '-q', 'main')
    commit(conflict ? { 'a.txt': 'main' } : { 'm.txt': 'main' }, 'main')
  }

  beforeEach(() => {
    stubIsolatedGitEnv()
    repo = mkdtempSync(join(tmpdir(), 'merge-integration-'))
    initRepo(repo)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(repo, { recursive: true, force: true })
  })

  it('早送りできるときは早送りする(マージコミットを作らない)', async () => {
    commit({ 'a.txt': 'base' }, 'base')
    runGit(repo, 'checkout', '-q', '-b', 'feature')
    commit({ 'f.txt': 'feature' }, 'feature')
    const featureHead = head()
    runGit(repo, 'checkout', '-q', 'main')
    await mergeBranch(repo, 'feature')
    expect(head()).toBe(featureHead)
    expect(read('f.txt')).toBe('feature')
  })

  it('分岐していればマージコミットを作り、両方の変更が入る', async () => {
    setupDiverged(false)
    await mergeBranch(repo, 'feature')
    // マージコミットは親が 2 つ(rev-list --parents の行が「自分 + 親 2 つ」の 3 フィールド)
    expect(runGit(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ')).toHaveLength(
      3
    )
    expect(read('f.txt')).toBe('feature')
    expect(read('m.txt')).toBe('main')
    expect(status()).toBe('')
  })

  it('すでに最新なら何も変えずに成功する', async () => {
    setupDiverged(false)
    await mergeBranch(repo, 'feature')
    const merged = head()
    await mergeBranch(repo, 'feature')
    expect(head()).toBe(merged)
  })

  it('コンフリクトしたら中止して、working tree・index・MERGE_HEAD が元に戻る', async () => {
    setupDiverged(true)
    const before = head()
    await expect(mergeBranch(repo, 'feature')).rejects.toThrow(
      'コンフリクトしたため中止しました: a.txt'
    )
    expect(hasMergeHead()).toBe(false)
    expect(head()).toBe(before)
    expect(read('a.txt')).toBe('main')
    expect(status()).toBe('')
  })

  it('追跡済みファイルに未コミットの変更があれば拒否し、変更を残す', async () => {
    setupDiverged(false)
    const before = head()
    write('m.txt', 'local edit')
    await expect(mergeBranch(repo, 'feature')).rejects.toThrow(
      '未コミットの変更があるためマージできません。先にコミットしてください'
    )
    expect(head()).toBe(before)
    expect(read('m.txt')).toBe('local edit')
    expect(existsSync(join(repo, 'f.txt'))).toBe(false)
  })

  it('ステージ済みの変更があっても拒否し、変更を残す', async () => {
    setupDiverged(false)
    write('m.txt', 'staged edit')
    runGit(repo, 'add', 'm.txt')
    await expect(mergeBranch(repo, 'feature')).rejects.toThrow(
      '未コミットの変更があるためマージできません'
    )
    expect(read('m.txt')).toBe('staged edit')
  })

  it('未追跡ファイルだけがあるならマージを始められ、未追跡ファイルは残る', async () => {
    setupDiverged(false)
    write('untracked.txt', 'keep')
    await mergeBranch(repo, 'feature')
    expect(read('untracked.txt')).toBe('keep')
    expect(read('f.txt')).toBe('feature')
  })

  // 上書きされる未追跡ファイルは git が拒否する(MERGE_HEAD は残らない)。git の英語の
  // エラー文はロケールで変わるため、文言ではなく「中止せずにファイルが残ること」で固定する
  it('マージで上書きされる未追跡ファイルは git が拒否し、ファイルが残る', async () => {
    commit({ 'a.txt': 'base' }, 'base')
    runGit(repo, 'checkout', '-q', '-b', 'feature')
    commit({ 'u.txt': 'from feature' }, 'feature')
    runGit(repo, 'checkout', '-q', 'main')
    commit({ 'm.txt': 'main' }, 'main')
    write('u.txt', 'local untracked')
    await expect(mergeBranch(repo, 'feature')).rejects.toThrow()
    expect(hasMergeHead()).toBe(false)
    expect(read('u.txt')).toBe('local untracked')
  })

  it('マージ中は拒否する', async () => {
    setupDiverged(true)
    expect(() => runGit(repo, 'merge', '--no-edit', 'feature')).toThrow()
    expect(hasMergeHead()).toBe(true)
    await expect(mergeBranch(repo, 'feature')).rejects.toThrow('マージ中のため実行できません')
    expect(hasMergeHead()).toBe(true)
  })

  it('detached HEAD では拒否する', async () => {
    setupDiverged(false)
    runGit(repo, 'checkout', '-q', '--detach')
    await expect(mergeBranch(repo, 'feature')).rejects.toThrow(
      'ブランチをチェックアウトしてからマージしてください'
    )
  })

  // simple-git の branchLocal() は `(HEAD detached at X)` の形しか detached と認識せず、
  // rebase・bisect 中の `(no branch, …)` は detached: false になる。ブランチ上にいるかは
  // symbolic-ref で判定するため、これらの途中状態でもマージを拒否すること
  // (Windows ではシェルスクリプトを実行できないため対象外)
  it.skipIf(process.platform === 'win32')(
    '対話的 rebase を edit で止めている間は拒否し、HEAD も working tree も変わらない',
    async () => {
      commit({ 'a.txt': 'base' }, 'base')
      runGit(repo, 'checkout', '-q', '-b', 'feature')
      commit({ 'f.txt': 'feature' }, 'feature')
      runGit(repo, 'checkout', '-q', 'main')
      commit({ 'm1.txt': 'm1' }, 'main1')
      commit({ 'm2.txt': 'm2' }, 'main2')
      // pick を edit に書き換えるだけのシーケンスエディタ(BSD sed と GNU sed の両方で動く形)
      const editor = join(repo, '..', `seq-editor-${Date.now()}.sh`)
      writeFileSync(
        editor,
        '#!/bin/sh\nsed \'s/^pick/edit/\' "$1" > "$1.tmp" && mv "$1.tmp" "$1"\n'
      )
      chmodSync(editor, 0o755)
      try {
        runGitWithEnv(repo, { GIT_SEQUENCE_EDITOR: editor }, 'rebase', '-i', 'HEAD~2')
      } finally {
        rmSync(editor, { force: true })
      }
      expect(existsSync(join(repo, '.git', 'rebase-merge'))).toBe(true)
      const before = head()
      const statusBefore = status()
      await expect(mergeBranch(repo, 'feature')).rejects.toThrow(
        'ブランチをチェックアウトしてからマージしてください'
      )
      expect(head()).toBe(before)
      expect(status()).toBe(statusBefore)
      expect(existsSync(join(repo, 'f.txt'))).toBe(false)
    }
  )

  it.skipIf(process.platform === 'win32')('bisect の途中(detached)も拒否する', async () => {
    commit({ 'a.txt': 'base' }, 'base')
    const good = head()
    runGit(repo, 'checkout', '-q', '-b', 'feature')
    commit({ 'f.txt': 'feature' }, 'feature')
    runGit(repo, 'checkout', '-q', 'main')
    commit({ 'a.txt': 'c2' }, 'c2')
    commit({ 'a.txt': 'c3' }, 'c3')
    commit({ 'a.txt': 'c4' }, 'c4')
    runGit(repo, 'bisect', 'start')
    runGit(repo, 'bisect', 'bad')
    runGit(repo, 'bisect', 'good', good)
    // 出力の文言に頼らず、bisect が始まっていて HEAD がブランチを指していないことを確かめる
    expect(existsSync(join(repo, '.git', 'BISECT_LOG'))).toBe(true)
    // symbolic-ref -q は HEAD がブランチを指していないと、出力なしで終了コード 1 になる
    expect(() => runGit(repo, 'symbolic-ref', '-q', 'HEAD')).toThrow()
    const before = head()
    await expect(mergeBranch(repo, 'feature')).rejects.toThrow(
      'ブランチをチェックアウトしてからマージしてください'
    )
    expect(head()).toBe(before)
    expect(existsSync(join(repo, 'f.txt'))).toBe(false)
  })

  it('存在しないブランチと現在のブランチ自身は拒否する', async () => {
    setupDiverged(false)
    await expect(mergeBranch(repo, 'nope')).rejects.toThrow('存在しないブランチです: nope')
    await expect(mergeBranch(repo, 'main')).rejects.toThrow(
      '現在のブランチ自身はマージできません: main'
    )
  })

  // フックの失敗ではコンフリクトが無いのに MERGE_HEAD が残る。中止して元に戻ること
  // (Windows ではシェルスクリプトのフックを作れないため対象外)
  it.skipIf(process.platform === 'win32')(
    'pre-merge-commit フックが失敗したら中止して元に戻る',
    async () => {
      setupDiverged(false)
      const before = head()
      const hookPath = join(repo, '.git', 'hooks', 'pre-merge-commit')
      mkdirSync(join(repo, '.git', 'hooks'), { recursive: true })
      writeFileSync(hookPath, '#!/bin/sh\necho hook failed >&2\nexit 1\n')
      chmodSync(hookPath, 0o755)
      await expect(mergeBranch(repo, 'feature')).rejects.toThrow(
        'マージを完了できなかったため中止しました'
      )
      expect(hasMergeHead()).toBe(false)
      expect(head()).toBe(before)
      expect(status()).toBe('')
      expect(existsSync(join(repo, 'f.txt'))).toBe(false)
    }
  )

  // 同名のタグがあると git はタグを優先し、警告だけで終了コード 0 のまま別のコミットへ
  // 早送りする。選んでいないコミットをマージして成功扱いにしないこと
  it('ブランチと同名のタグが別のコミットを指すなら拒否し、HEAD を変えない', async () => {
    commit({ 'a.txt': 'base' }, 'base')
    runGit(repo, 'checkout', '-q', '-b', 'feature')
    commit({ 'f.txt': 'feature' }, 'feature')
    commit({ 'g.txt': 'tagged' }, 'tagged')
    runGit(repo, 'tag', 'feature')
    runGit(repo, 'reset', '-q', '--hard', 'HEAD~1')
    runGit(repo, 'checkout', '-q', 'main')
    const before = head()
    await expect(mergeBranch(repo, 'feature')).rejects.toThrow(
      '同名のタグ等があり、ブランチを特定できないためマージできません: feature'
    )
    expect(head()).toBe(before)
    expect(existsSync(join(repo, 'g.txt'))).toBe(false)
  })

  it('ブランチと同名のタグが同じコミットを指すなら通る', async () => {
    commit({ 'a.txt': 'base' }, 'base')
    runGit(repo, 'checkout', '-q', '-b', 'feature')
    commit({ 'f.txt': 'feature' }, 'feature')
    runGit(repo, 'tag', 'feature')
    runGit(repo, 'checkout', '-q', 'main')
    await mergeBranch(repo, 'feature')
    expect(read('f.txt')).toBe('feature')
  })

  // 大文字小文字を区別しない FS で `feat`(packed-refs)と `Feat`(loose ref のファイル)が共存すると、
  // rev-parse は両方とも loose の `Feat` のファイルへ解決する。ブランチの先端を rev-parse で
  // 比べていた頃は検証を素通りし、選んでいない `Feat` のコミットがマージされた。
  // 区別する FS では両者を共存できないため、FS の性質を実測して skip する
  it.skipIf(!isCaseInsensitiveFs())(
    '大文字小文字だけ違うブランチが共存しても、選んでいない Feat のコミットをマージしない',
    async () => {
      commit({ 'a.txt': 'base' }, 'base')
      runGit(repo, 'checkout', '-q', '-b', 'feat')
      commit({ 'f.txt': 'feat' }, 'feat')
      runGit(repo, 'checkout', '-q', 'main')
      runGit(repo, 'pack-refs', '--all')
      runGit(repo, 'checkout', '-q', '-b', 'Feat')
      commit({ 'big.txt': 'Feat' }, 'Feat')
      runGit(repo, 'checkout', '-q', 'main')
      const before = head()
      // 実機(macOS・git 2.50)では `feat^{commit}` が Feat の SHA に解決される一方、
      // for-each-ref は feat の正しい SHA を返すため、食い違いで拒否される。
      // 拒否されること、および HEAD と working tree が変わらない(Feat のファイルが入らない)
      // ことを固定する
      await expect(mergeBranch(repo, 'feat')).rejects.toThrow(
        '同名のタグ等があり、ブランチを特定できないためマージできません: feat'
      )
      expect(existsSync(join(repo, 'big.txt'))).toBe(false)
      expect(head()).toBe(before)
    }
  )

  // branch.<name>.mergeoptions は CLI 引数より先に適用される。--squash / --no-commit が
  // 設定されていても、mergeBranch は「コミットする・squash しない」を引数で固定する
  describe('branch.<現在のブランチ>.mergeoptions の影響', () => {
    it('--squash でも分岐・コンフリクトなら中止して元に戻る(MERGE_HEAD が作られない squash をすり抜けない)', async () => {
      setupDiverged(true)
      runGit(repo, 'config', 'branch.main.mergeoptions', '--squash')
      const before = head()
      await expect(mergeBranch(repo, 'feature')).rejects.toThrow(
        'コンフリクトしたため中止しました: a.txt'
      )
      expect(head()).toBe(before)
      expect(status()).toBe('')
      expect(hasMergeHead()).toBe(false)
      expect(read('a.txt')).toBe('main')
    })

    it('--squash でも分岐していればマージコミットを作る(変更がステージされるだけにならない)', async () => {
      setupDiverged(false)
      runGit(repo, 'config', 'branch.main.mergeoptions', '--squash')
      await mergeBranch(repo, 'feature')
      expect(
        runGit(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ')
      ).toHaveLength(3)
      expect(read('f.txt')).toBe('feature')
      expect(read('m.txt')).toBe('main')
      expect(status()).toBe('')
    })

    it('--squash でも早送りできるときは早送りする(HEAD が feature の先端に進む)', async () => {
      commit({ 'a.txt': 'base' }, 'base')
      runGit(repo, 'checkout', '-q', '-b', 'feature')
      commit({ 'f.txt': 'feature' }, 'feature')
      const featureHead = head()
      runGit(repo, 'checkout', '-q', 'main')
      runGit(repo, 'config', 'branch.main.mergeoptions', '--squash')
      await mergeBranch(repo, 'feature')
      expect(head()).toBe(featureHead)
      expect(status()).toBe('')
    })

    it('--no-commit でも分岐していればマージコミットを作る(毎回未完了で止まらない)', async () => {
      setupDiverged(false)
      runGit(repo, 'config', 'branch.main.mergeoptions', '--no-commit')
      await mergeBranch(repo, 'feature')
      expect(
        runGit(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ')
      ).toHaveLength(3)
      expect(hasMergeHead()).toBe(false)
      expect(status()).toBe('')
    })
  })

  // 引数で固定しない ff の方針はユーザーの設定に従う。--ff は付けないので merge.ff=only が
  // 有効なまま(固定しても ff の拒否が変わらないことの確認。修正前も通る)
  it('merge.ff=only の設定では分岐時に拒否され、何も変わらない(--commit --no-squash の固定で ff の方針は変わらない)', async () => {
    setupDiverged(false)
    runGit(repo, 'config', 'merge.ff', 'only')
    const before = head()
    await expect(mergeBranch(repo, 'feature')).rejects.toThrow()
    expect(head()).toBe(before)
    expect(status()).toBe('')
    expect(hasMergeHead()).toBe(false)
  })
})
