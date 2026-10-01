import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getStashes, stashDrop, stashPop, stashPush } from '../gitStashService'
import { commitAll, initRepo, runGit, stubIsolatedGitEnv } from './helpers/realGitRepo'

// gitStashService.test.ts は simple-git をモックするため、「実際の git が退避で何を残し何を消すか」は
// 検証できない。データを失わないことに関わる判定だけ、実 git で固定する
describe('gitStashService(実 git)', () => {
  let repo: string

  const write = (path: string, content: string): void => {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), content)
  }
  const read = (path: string): string => readFileSync(join(repo, path), 'utf8')
  const status = (): string => runGit(repo, 'status', '--porcelain')
  const commit = (files: Record<string, string>, message = 'c'): void => {
    Object.entries(files).forEach(([path, content]) => write(path, content))
    commitAll(repo, message)
  }

  beforeEach(() => {
    stubIsolatedGitEnv()
    repo = mkdtempSync(join(tmpdir(), 'stash-integration-'))
    initRepo(repo)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(repo, { recursive: true, force: true })
  })

  it('追跡済み・ステージ済み・未追跡を退避して作業ツリーを HEAD に戻し、ignored は残す', async () => {
    commit({ 'a.txt': 'base', 'b.txt': 'b', '.gitignore': '*.log\n' })
    write('a.txt', 'modified')
    write('b.txt', 'staged')
    runGit(repo, 'add', 'b.txt')
    write('untracked.txt', 'new')
    write('d/x.txt', 'dir')
    write('ignored.log', 'ig')
    await stashPush(repo, 'my message')
    expect(status()).toBe('')
    expect(read('a.txt')).toBe('base')
    expect(existsSync(join(repo, 'untracked.txt'))).toBe(false)
    expect(existsSync(join(repo, 'd'))).toBe(false)
    expect(read('ignored.log')).toBe('ig')
    const stashes = await getStashes(repo)
    expect(stashes).toHaveLength(1)
    expect(stashes[0]).toMatchObject({ message: 'my message', branch: 'main' })
    expect(stashes[0].sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('メッセージ無しの退避は最後のコミットの件名が表示メッセージになる', async () => {
    commit({ 'a.txt': 'base' }, 'last commit subject')
    write('a.txt', 'm')
    await stashPush(repo, '')
    const [entry] = await getStashes(repo)
    expect(entry).toMatchObject({ message: 'last commit subject', branch: 'main' })
  })

  it('一覧は新しい順', async () => {
    commit({ 'a.txt': 'base' })
    write('a.txt', '1')
    await stashPush(repo, 'first')
    write('a.txt', '2')
    await stashPush(repo, 'second')
    expect((await getStashes(repo)).map((e) => e.message)).toEqual(['second', 'first'])
  })

  it('- で始まるメッセージもメッセージとして扱われる', async () => {
    commit({ 'a.txt': 'base' })
    write('a.txt', 'm')
    await stashPush(repo, '--foo bar')
    expect((await getStashes(repo))[0].message).toBe('--foo bar')
  })

  it('退避が無ければ一覧は空', async () => {
    commit({ 'a.txt': 'base' })
    await expect(getStashes(repo)).resolves.toEqual([])
  })

  // git は変更が無くても終了コード 0 で成功扱いにするため、アプリ側の事前確認で拒否する
  it('変更が無ければ拒否し、退避を作らない', async () => {
    commit({ 'a.txt': 'base' })
    await expect(stashPush(repo, '')).rejects.toThrow('退避する変更がありません')
    expect(await getStashes(repo)).toEqual([])
  })

  it('ignored の変更だけなら変更なしとして拒否する', async () => {
    commit({ 'a.txt': 'base', '.gitignore': '*.log\n' })
    write('x.log', 'ig')
    await expect(stashPush(repo, '')).rejects.toThrow('退避する変更がありません')
  })

  it('空白だけのメッセージは -m を付けず、最後のコミットの件名が表示メッセージになる', async () => {
    commit({ 'a.txt': 'base' }, 'last commit subject')
    write('a.txt', 'm')
    await stashPush(repo, '   ')
    expect((await getStashes(repo))[0]).toMatchObject({ message: 'last commit subject' })
  })

  it('コミットが無いリポジトリでは拒否する', async () => {
    write('a.txt', 'new')
    await expect(stashPush(repo, '')).rejects.toThrow('コミットが無いため退避できません')
  })

  it('コンフリクト中は拒否し、ファイルを変えない', async () => {
    commit({ 'a.txt': 'base' })
    runGit(repo, 'checkout', '-q', '-b', 'feature')
    commit({ 'a.txt': 'feature' })
    runGit(repo, 'checkout', '-q', 'main')
    commit({ 'a.txt': 'main' })
    expect(() => runGit(repo, 'merge', '--no-edit', 'feature')).toThrow()
    await expect(stashPush(repo, '')).rejects.toThrow('コンフリクト中のため退避できません')
    expect(status()).toContain('UU a.txt')
  })

  it('detached HEAD でも退避でき、ブランチは (no branch) になる', async () => {
    commit({ 'a.txt': 'base' })
    runGit(repo, 'checkout', '-q', '--detach')
    write('a.txt', 'm')
    await stashPush(repo, 'detached')
    expect((await getStashes(repo))[0]).toMatchObject({
      branch: '(no branch)',
      message: 'detached'
    })
  })

  it('未追跡ファイルだけの変更も退避され、作業ツリーから消える', async () => {
    commit({ 'a.txt': 'base' })
    write('only-untracked.txt', 'new')
    write('d/y.txt', 'dir')
    await stashPush(repo, 'untracked only')
    expect(existsSync(join(repo, 'only-untracked.txt'))).toBe(false)
    expect(existsSync(join(repo, 'd'))).toBe(false)
    expect(await getStashes(repo)).toHaveLength(1)
  })

  // simple-git は引数列の --upload-pack=... や -c ... を値でもオプションとして拒否するため、
  // メッセージは --message=<値> の 1 引数で渡している
  it.each([
    '--upload-pack=x',
    '--template=x',
    '--receive-pack=x',
    '-c core.pager=x',
    '-ccore.sshCommand=x'
  ])(
    'simple-git が危険なオプションと誤検出する形のメッセージ(%s)でも退避でき、そのまま残る',
    async (message) => {
      commit({ 'a.txt': 'base' })
      write('a.txt', 'm')
      await stashPush(repo, message)
      expect((await getStashes(repo))[0].message).toBe(message)
    }
  )

  // 解決済みでコンフリクトの無い途中の操作は ls-files -u に現れない。退避すると
  // MERGE_HEAD / CHERRY_PICK_HEAD が消えて「途中」の状態が失われるため拒否する
  it('merge --no-commit の途中(コンフリクト無し・解決済み)は拒否し、状態を変えない', async () => {
    commit({ 'a.txt': 'base' })
    runGit(repo, 'checkout', '-q', '-b', 'feature')
    commit({ 'f.txt': 'feature' })
    runGit(repo, 'checkout', '-q', 'main')
    commit({ 'm.txt': 'main' })
    runGit(repo, 'merge', '--no-commit', '--no-ff', 'feature')
    const before = status()
    expect(before).toContain('A  f.txt')
    await expect(stashPush(repo, '')).rejects.toThrow(
      'マージ・cherry-pick・revert の途中のため退避できません'
    )
    expect(() => runGit(repo, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).not.toThrow()
    expect(status()).toBe(before)
    expect(await getStashes(repo)).toEqual([])
  })

  it('cherry-pick のコンフリクトを解決して add した後も拒否し、状態を変えない', async () => {
    commit({ 'a.txt': 'base' })
    runGit(repo, 'checkout', '-q', '-b', 'feature')
    commit({ 'a.txt': 'feature' }, 'feature')
    const featureHead = runGit(repo, 'rev-parse', 'HEAD').trim()
    runGit(repo, 'checkout', '-q', 'main')
    commit({ 'a.txt': 'main' })
    expect(() => runGit(repo, 'cherry-pick', featureHead)).toThrow()
    write('a.txt', 'resolved')
    runGit(repo, 'add', 'a.txt')
    expect(runGit(repo, 'ls-files', '-u')).toBe('')
    await expect(stashPush(repo, '')).rejects.toThrow(
      'マージ・cherry-pick・revert の途中のため退避できません'
    )
    expect(() => runGit(repo, 'rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD')).not.toThrow()
    expect(read('a.txt')).toBe('resolved')
    expect(await getStashes(repo)).toEqual([])
  })

  // サブモジュールの変更は退避の対象外(git stash は No local changes to save を終了コード 0 で
  // 返す)。サブモジュールの追加は file プロトコルの許可(-c protocol.file.allow=always)が必要
  describe('サブモジュール', () => {
    let subSource: string

    const setupSubmodule = (): void => {
      subSource = mkdtempSync(join(tmpdir(), 'stash-submodule-src-'))
      initRepo(subSource)
      writeFileSync(join(subSource, 's.txt'), 'sub')
      commitAll(subSource, 'sub')
      commit({ 'a.txt': 'base' })
      runGit(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', subSource, 'sub')
      commitAll(repo, 'add submodule')
    }

    afterEach(() => {
      rmSync(subSource, { recursive: true, force: true })
    })

    it('サブモジュールの中だけの変更は変更なしとして拒否する', async () => {
      setupSubmodule()
      writeFileSync(join(repo, 'sub', 's.txt'), 'changed')
      expect(status()).toContain('sub')
      await expect(stashPush(repo, '')).rejects.toThrow('退避する変更がありません')
      expect(await getStashes(repo)).toEqual([])
    })

    it('サブモジュールに新しいコミットがあるだけでも拒否する', async () => {
      setupSubmodule()
      writeFileSync(join(repo, 'sub', 's2.txt'), 'new')
      runGit(join(repo, 'sub'), 'config', 'user.email', 't@example.com')
      runGit(join(repo, 'sub'), 'config', 'user.name', 't')
      runGit(join(repo, 'sub'), 'config', 'commit.gpgsign', 'false')
      runGit(join(repo, 'sub'), 'add', 's2.txt')
      runGit(join(repo, 'sub'), 'commit', '-qm', 'sub2')
      expect(status()).toContain('sub')
      await expect(stashPush(repo, '')).rejects.toThrow('退避する変更がありません')
    })

    it('外のファイルも変更していれば退避でき、サブモジュールの変更は含まれない', async () => {
      setupSubmodule()
      writeFileSync(join(repo, 'sub', 's.txt'), 'changed')
      write('a.txt', 'm')
      await stashPush(repo, 'with sub')
      expect(read('a.txt')).toBe('base')
      expect(readFileSync(join(repo, 'sub', 's.txt'), 'utf8')).toBe('changed')
      expect(await getStashes(repo)).toHaveLength(1)
    })
  })

  const firstSha = async (): Promise<string> => (await getStashes(repo))[0].sha

  it('退避を戻すと、ステージ済み・未ステージ・新規のステージ・未追跡が退避前と同じに戻り、一覧から消える', async () => {
    commit({ 'a.txt': 'base', 'b.txt': 'b' })
    write('b.txt', 'staged')
    runGit(repo, 'add', 'b.txt')
    write('a.txt', 'unstaged')
    write('n.txt', 'newstaged')
    runGit(repo, 'add', 'n.txt')
    write('u.txt', 'untracked')
    const before = status()
    await stashPush(repo, 'm')
    await expect(stashPop(repo, await firstSha())).resolves.toEqual({ status: 'restored' })
    expect(status()).toBe(before)
    expect(read('u.txt')).toBe('untracked')
    expect(await getStashes(repo)).toEqual([])
  })

  it('作業ツリーがきれいでなければ(未追跡ファイルだけでも)拒否し、退避も作業ツリーも変えない', async () => {
    commit({ 'a.txt': 'base' })
    write('a.txt', 'm')
    await stashPush(repo, 'm')
    write('other.txt', 'in progress')
    await expect(stashPop(repo, await firstSha())).rejects.toThrow(
      '作業中の変更があるため戻せません'
    )
    expect(read('other.txt')).toBe('in progress')
    expect(await getStashes(repo)).toHaveLength(1)
  })

  // 失敗しても作業ツリーを復元前の状態へ戻し、退避は残す(本命のケース)
  it('コンフリクトしたら元に戻し、退避は残る', async () => {
    commit({ 'a.txt': 'base' })
    write('a.txt', 'stashed')
    write('u2.txt', 'untracked in stash')
    await stashPush(repo, 'conflict')
    commit({ 'a.txt': 'head-change' }, 'head change')
    const sha = await firstSha()
    await expect(stashPop(repo, sha)).rejects.toThrow(
      '退避を戻せなかったため元に戻しました。退避は残っています（コンフリクト: a.txt）'
    )
    expect(status()).toBe('')
    expect(read('a.txt')).toBe('head-change')
    expect(existsSync(join(repo, 'u2.txt'))).toBe(false)
    expect((await getStashes(repo)).map((e) => e.sha)).toEqual([sha])
  })

  // 退避に含まれる未追跡ファイルと同じパスに ignored のファイルがあっても、git は黙って上書きせず失敗する。
  // 失敗時は巻き戻し、ignored のファイルはそのまま残る
  it('同名の ignored ファイルとの衝突では、上書きせず失敗して巻き戻し、退避は残る', async () => {
    commit({ 'a.txt': 'base' })
    write('build.log', 'STASHED')
    write('a.txt', 'mod')
    await stashPush(repo, 'e')
    commit({ '.gitignore': '*.log\n' }, 'ignore')
    write('build.log', 'PRECIOUS-IGNORED')
    await expect(stashPop(repo, await firstSha())).rejects.toThrow(
      '（同名のファイルがあるなど、git が復元を完了できませんでした）'
    )
    expect(read('build.log')).toBe('PRECIOUS-IGNORED')
    expect(status()).toBe('')
    expect(await getStashes(repo)).toHaveLength(1)
  })

  it('すでに捨てた退避の SHA は拒否する(git は復元できてしまう)', async () => {
    commit({ 'a.txt': 'base' })
    write('a.txt', 'm')
    await stashPush(repo, 'm')
    const sha = await firstSha()
    await stashDrop(repo, sha)
    await expect(stashPop(repo, sha)).rejects.toThrow('退避が見つかりません')
    expect(status()).toBe('')
  })

  it('形式が不正な SHA は拒否する', async () => {
    commit({ 'a.txt': 'base' })
    await expect(stashPop(repo, '--all')).rejects.toThrow('退避が見つかりません')
  })

  it('drop は SHA で識別する: 先に別の退避を捨てて番号がずれても、指定した退避だけが消える', async () => {
    commit({ 'a.txt': 'base' })
    write('a.txt', '1')
    await stashPush(repo, 'first')
    write('a.txt', '2')
    await stashPush(repo, 'second')
    write('a.txt', '3')
    await stashPush(repo, 'third')
    const [third, second, first] = await getStashes(repo)
    await stashDrop(repo, third.sha)
    // second は stash@{1} から stash@{0} へ番号がずれている
    await stashDrop(repo, second.sha)
    expect((await getStashes(repo)).map((e) => e.sha)).toEqual([first.sha])
  })

  it('pop は退避の番号がずれていても、指定した SHA の退避を戻して消す', async () => {
    commit({ 'a.txt': 'base' })
    write('a.txt', 'first-change')
    await stashPush(repo, 'first')
    write('a.txt', 'second-change')
    await stashPush(repo, 'second')
    const [second, first] = await getStashes(repo)
    await stashPop(repo, first.sha)
    expect(read('a.txt')).toBe('first-change')
    expect((await getStashes(repo)).map((e) => e.sha)).toEqual([second.sha])
  })

  // サブモジュールの変更は退避の対象外。復元の「きれいか」の判定も同じ基準でないと、
  // 退避は「変更なし」・復元は「作業中の変更あり」の行き止まりになる
  it('サブモジュールの中だけが変更されている状態でも、退避を戻せる', async () => {
    const subSource = mkdtempSync(join(tmpdir(), 'stash-pop-submodule-src-'))
    try {
      initRepo(subSource)
      writeFileSync(join(subSource, 's.txt'), 'sub')
      commitAll(subSource, 'sub')
      commit({ 'a.txt': 'base' })
      runGit(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', subSource, 'sub')
      commitAll(repo, 'add submodule')
      write('a.txt', 'stashed')
      await stashPush(repo, 'm')
      writeFileSync(join(repo, 'sub', 's.txt'), 'changed')
      expect(status()).toContain('sub')
      await stashPop(repo, await firstSha())
      expect(read('a.txt')).toBe('stashed')
      expect(read('sub/s.txt')).toBe('changed')
      expect(await getStashes(repo)).toEqual([])
    } finally {
      rmSync(subSource, { recursive: true, force: true })
    }
  })

  // assume-unchanged のファイルの変更は status に出ないが、失敗時の reset --hard が消す(実機で確認)
  it('assume-unchanged を付けたファイルを編集した状態では拒否し、そのファイルも退避も作業ツリーも変えない', async () => {
    commit({ 'a.txt': 'base', 'c.txt': 'c-base' })
    write('a.txt', 'stashed')
    await stashPush(repo, 'm')
    runGit(repo, 'update-index', '--assume-unchanged', 'c.txt')
    write('c.txt', 'PRECIOUS')
    expect(status()).toBe('')
    await expect(stashPop(repo, await firstSha())).rejects.toThrow(
      'assume-unchanged を付けたファイルがあるため戻せません'
    )
    expect(read('c.txt')).toBe('PRECIOUS')
    expect(read('a.txt')).toBe('base')
    expect(await getStashes(repo)).toHaveLength(1)
  })

  // skip-worktree の変更は reset --hard で消えない(実機で確認)ため、拒否せず復元できる
  it('skip-worktree を付けたファイルを編集していても復元でき、そのファイルの変更は残る', async () => {
    commit({ 'a.txt': 'base', 'c.txt': 'c-base' })
    write('a.txt', 'stashed')
    await stashPush(repo, 'm')
    runGit(repo, 'update-index', '--skip-worktree', 'c.txt')
    write('c.txt', 'KEEP')
    await stashPop(repo, await firstSha())
    expect(read('a.txt')).toBe('stashed')
    expect(read('c.txt')).toBe('KEEP')
    expect(await getStashes(repo)).toEqual([])
  })

  // コンフリクトを ours で解決して add したマージの途中は、status も ls-files -u も空だが MERGE_HEAD が残る。
  // 戻すに失敗すると巻き戻しの reset --hard が MERGE_HEAD を消して、解決途中のマージが失われるため拒否する
  it('ours で解決したマージの途中(MERGE_HEAD あり・status 空)は復元を拒否し、MERGE_HEAD と退避が残る', async () => {
    commit({ 'a.txt': 'base', 'f.txt': 'base' })
    write('a.txt', 'stashed')
    await stashPush(repo, 'm')
    runGit(repo, 'checkout', '-q', '-b', 'feature')
    commit({ 'f.txt': 'feature' }, 'feature')
    runGit(repo, 'checkout', '-q', 'main')
    commit({ 'f.txt': 'main' }, 'main')
    expect(() => runGit(repo, 'merge', '--no-edit', 'feature')).toThrow()
    runGit(repo, 'checkout', '--ours', 'f.txt')
    runGit(repo, 'add', 'f.txt')
    expect(status()).toBe('')
    expect(runGit(repo, 'ls-files', '-u')).toBe('')
    await expect(stashPop(repo, await firstSha())).rejects.toThrow(
      'マージ・cherry-pick・revert の途中のため戻せません'
    )
    expect(() => runGit(repo, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).not.toThrow()
    expect(await getStashes(repo)).toHaveLength(1)
  })

  // 事前の status は --ignore-submodules=all でサブモジュール内の変更を見ない。ユーザー設定の
  // submodule.recurse=true があると、巻き戻しの reset --hard がサブモジュールの中まで戻して変更を消す
  it('submodule.recurse=true でも、復元の失敗の巻き戻しでサブモジュール内のローカル変更が消えない', async () => {
    const subSource = mkdtempSync(join(tmpdir(), 'stash-pop-recurse-src-'))
    try {
      initRepo(subSource)
      writeFileSync(join(subSource, 's.txt'), 'sub')
      commitAll(subSource, 'sub')
      commit({ 'a.txt': 'base' })
      runGit(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', subSource, 'sub')
      commitAll(repo, 'add submodule')
      runGit(repo, 'config', 'submodule.recurse', 'true')
      write('a.txt', 'stashed')
      await stashPush(repo, 'conflict')
      commit({ 'a.txt': 'head-change' }, 'head change')
      writeFileSync(join(repo, 'sub', 's.txt'), 'LOCAL')
      await expect(stashPop(repo, await firstSha())).rejects.toThrow('退避を戻せなかったため')
      expect(read('a.txt')).toBe('head-change')
      expect(read('sub/s.txt')).toBe('LOCAL')
      expect(await getStashes(repo)).toHaveLength(1)
    } finally {
      rmSync(subSource, { recursive: true, force: true })
    }
  })
})
