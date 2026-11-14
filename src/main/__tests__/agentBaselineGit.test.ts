import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from 'vitest'
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import {
  AGENT_BASELINE_GIT_TIMEOUT_MS,
  REPO_LOCATION_ENV_KEYS,
  SIMPLE_GIT_BLOCKED_ENV_KEYS,
  buildBaselineGitEnv,
  buildIsolatedGitEnv,
  buildEnglishMessagesGitEnv,
  buildModeGitEnv,
  createBaselineGit,
  createModeGit,
  createRecordRepoGit,
  readRecordHead,
  runBaselineGitWithInput
} from '../agentBaselineGit'
import type { BaselineGitLocation } from '../agentBaselineGit'
import { isGitTimeoutError } from '../gitStepErrors'
import {
  TRANSLATED_GIT_LOCALE,
  commitAll,
  findTranslatedGitBinDir,
  runGit,
  writeRepoFile
} from './helpers/realGitRepo'
import {
  createAgentBaselineRepo,
  createAgentNonGitFolder,
  disposeAgentBaselineRepo,
  repoLocation
} from './helpers/agentBaselineFixtures'

// simple-git 3.36.0(@simple-git/argv-parser)が env() で拒否する変数。実装の一覧(SIMPLE_GIT_BLOCKED_ENV_KEYS)とは
// 別にリテラルで持ち、実装から 1 個消えたら落ちるようにする。版を上げて一覧が変わったら、実際に拒否されるかのテストと一緒に見直す
const EXPECTED_BLOCKED_ENV_KEYS = [
  'EDITOR',
  'GIT_ASKPASS',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_EDITOR',
  'GIT_EXEC_PATH',
  'GIT_EXTERNAL_DIFF',
  'GIT_PAGER',
  'GIT_PROXY_COMMAND',
  'GIT_SEQUENCE_EDITOR',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_TEMPLATE_DIR',
  'PAGER',
  'PREFIX',
  'SSH_ASKPASS'
] as const

// 記録用の git から外す、利用者の別のリポジトリ・別の場所を指しうる変数(simple-git が拒否するものとは別)。
// 実装の一覧(REPO_LOCATION_ENV_KEYS)とは別にリテラルで持つ(最終レビュー A の M7)
const EXPECTED_REPO_LOCATION_ENV_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE'
] as const

describe('buildBaselineGitEnv', () => {
  it('simple-git が拒否する変数と位置の変数を外し、GIT_INDEX_FILE を記録のインデックスにする', () => {
    const env = buildBaselineGitEnv(
      {
        PATH: '/usr/bin',
        HOME: '/home/me',
        LANG: 'ja_JP.UTF-8',
        GIT_CONFIG_NOSYSTEM: '1',
        EDITOR: 'vim',
        GIT_ASKPASS: '/askpass',
        SSH_ASKPASS: '/askpass',
        PAGER: 'less',
        GIT_PAGER: 'less',
        GIT_SSH_COMMAND: 'ssh -i key',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.pager',
        GIT_CONFIG_VALUE_0: 'cat',
        GIT_DIR: '/elsewhere/.git',
        GIT_WORK_TREE: '/elsewhere',
        GIT_INDEX_FILE: '/elsewhere/.git/index',
        UNDEFINED_VALUE: undefined
      },
      repoLocation('/repo', '/tmp/baseline/index')
    )
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/me',
      LANG: 'ja_JP.UTF-8',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_INDEX_FILE: '/tmp/baseline/index'
    })
  })

  it('大文字小文字の違う変数名も外す(simple-git は小文字にして比べる)', () => {
    expect(
      buildBaselineGitEnv({ Editor: 'vim', git_askpass: '/a' }, repoLocation('/repo', '/i'))
    ).toEqual({
      GIT_INDEX_FILE: '/i'
    })
  })

  it('実装の一覧は simple-git が拒否する変数(テストのリテラル)と過不足なく一致する', () => {
    expect([...SIMPLE_GIT_BLOCKED_ENV_KEYS].sort()).toEqual(
      EXPECTED_BLOCKED_ENV_KEYS.map((key) => key.toLowerCase()).sort()
    )
  })

  it('実装の位置の変数の一覧は、テストのリテラルと過不足なく一致する', () => {
    expect([...REPO_LOCATION_ENV_KEYS].sort()).toEqual(
      EXPECTED_REPO_LOCATION_ENV_KEYS.map((key) => key.toLowerCase()).sort()
    )
  })

  it.each(EXPECTED_REPO_LOCATION_ENV_KEYS)(
    '位置の変数 %s を外す(GIT_INDEX_FILE は記録のインデックスで置き換える)',
    (key) => {
      expect(
        buildBaselineGitEnv({ PATH: '/usr/bin', [key]: '/elsewhere' }, repoLocation('/repo', '/i'))
      ).toEqual({
        PATH: '/usr/bin',
        GIT_INDEX_FILE: '/i'
      })
    }
  )

  it.each(EXPECTED_BLOCKED_ENV_KEYS)('%s を外す', (key) => {
    expect(buildBaselineGitEnv({ [key]: 'x' }, repoLocation('/repo', '/i'))).toEqual({
      GIT_INDEX_FILE: '/i'
    })
  })

  it('隠れた git(gitDir が文字列)なら、親の位置の変数(別の綴りを含む)を外した後に GIT_DIR・GIT_WORK_TREE・GIT_INDEX_FILE を置く(L-075・L-079)', () => {
    expect(
      buildBaselineGitEnv(
        {
          PATH: '/usr/bin',
          GIT_DIR: '/elsewhere/.git',
          git_dir: '/other/.git',
          GIT_WORK_TREE: '/elsewhere',
          GIT_OBJECT_DIRECTORY: '/elsewhere/.git/objects',
          GIT_INDEX_FILE: '/elsewhere/.git/index'
        },
        { folderPath: '/folder', indexPath: '/tmp/b/index', gitDir: '/tmp/b/git' }
      )
    ).toEqual({
      PATH: '/usr/bin',
      GIT_INDEX_FILE: '/tmp/b/index',
      GIT_DIR: '/tmp/b/git',
      GIT_WORK_TREE: '/folder'
    })
  })

  it('gitDir が null なら GIT_DIR・GIT_WORK_TREE を置かない(リポジトリの方式は今と同じ)', () => {
    expect(
      buildBaselineGitEnv(
        { PATH: '/usr/bin', GIT_DIR: '/elsewhere/.git' },
        repoLocation('/repo', '/tmp/b/index')
      )
    ).toEqual({ PATH: '/usr/bin', GIT_INDEX_FILE: '/tmp/b/index' })
  })
})

describe('buildIsolatedGitEnv', () => {
  it('拒否される変数・位置の変数・設定の組を外し、位置の変数を足さない(隠れた git の作成で使う)', () => {
    expect(
      buildIsolatedGitEnv({
        PATH: '/usr/bin',
        HOME: '/home/me',
        EDITOR: 'vim',
        GIT_DIR: '/elsewhere/.git',
        git_work_tree: '/elsewhere',
        GIT_INDEX_FILE: '/elsewhere/.git/index',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.pager',
        GIT_CONFIG_VALUE_0: 'cat',
        UNDEFINED_VALUE: undefined
      })
    ).toEqual({ PATH: '/usr/bin', HOME: '/home/me' })
  })
})

// 方式の判定の git の環境(指摘: 翻訳された git では simple-git の checkIsRepo が「リポジトリでない」を見分けられない)
describe('buildModeGitEnv', () => {
  it('写しに LC_ALL=C を置き、LANGUAGE を外す。ほかの変数(位置の変数・simple-git が拒否する変数も)は今のまま残し、元を書き換えない', () => {
    const source: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      LANG: 'fr_FR.UTF-8',
      LC_ALL: 'fr_FR.UTF-8',
      LC_MESSAGES: 'fr_FR.UTF-8',
      LANGUAGE: 'fr',
      GIT_DIR: '/elsewhere/.git',
      GIT_ASKPASS: '/askpass',
      GIT_CONFIG_GLOBAL: '/dev/null',
      UNDEFINED_VALUE: undefined
    }
    const before = { ...source }
    expect(buildModeGitEnv(source)).toEqual({
      PATH: '/usr/bin',
      LANG: 'fr_FR.UTF-8',
      LC_ALL: 'C',
      LC_MESSAGES: 'fr_FR.UTF-8',
      GIT_DIR: '/elsewhere/.git',
      GIT_ASKPASS: '/askpass',
      GIT_CONFIG_GLOBAL: '/dev/null'
    })
    expect(source).toEqual(before)
  })

  it('大文字小文字の違う LC_ALL・LANGUAGE(Windows の環境変数)も外してから LC_ALL=C を置く', () => {
    expect(buildModeGitEnv({ Lc_All: 'fr_FR.UTF-8', language: 'fr', PATH: '/usr/bin' })).toEqual({
      PATH: '/usr/bin',
      LC_ALL: 'C'
    })
  })
})

// 記録の add -A の読めないパスの検出の git の環境(PR #59 レビュー第 1 周の指摘 1)。メッセージ(LC_MESSAGES)だけを C にし、
// ほかのロケールのカテゴリは利用者のままにする(clean filter が見るロケールを一覧の git diff と揃える)
describe('buildEnglishMessagesGitEnv', () => {
  it('LC_ALL があれば外して ほかのカテゴリ(POSIX の 5 つと glibc の 6 つ)にその値を入れ、LANGUAGE を外して LC_MESSAGES=C を置く。元を書き換えない', () => {
    const source: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      LANG: 'fr_FR.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      LC_CTYPE: 'ja_JP.UTF-8',
      LC_MESSAGES: 'fr_FR.UTF-8',
      LANGUAGE: 'fr',
      GIT_DIR: '/elsewhere/.git',
      UNDEFINED_VALUE: undefined
    }
    const before = { ...source }
    expect(buildEnglishMessagesGitEnv(source)).toEqual({
      PATH: '/usr/bin',
      LANG: 'fr_FR.UTF-8',
      LC_CTYPE: 'en_US.UTF-8',
      LC_COLLATE: 'en_US.UTF-8',
      LC_NUMERIC: 'en_US.UTF-8',
      LC_TIME: 'en_US.UTF-8',
      LC_MONETARY: 'en_US.UTF-8',
      LC_PAPER: 'en_US.UTF-8',
      LC_NAME: 'en_US.UTF-8',
      LC_ADDRESS: 'en_US.UTF-8',
      LC_TELEPHONE: 'en_US.UTF-8',
      LC_MEASUREMENT: 'en_US.UTF-8',
      LC_IDENTIFICATION: 'en_US.UTF-8',
      LC_MESSAGES: 'C',
      GIT_DIR: '/elsewhere/.git'
    })
    expect(source).toEqual(before)
  })

  it('LC_ALL が無ければ、ほかのロケールの変数(LANG・LC_CTYPE など)は今のまま残し、LC_MESSAGES=C だけを置く', () => {
    expect(
      buildEnglishMessagesGitEnv({
        PATH: '/usr/bin',
        LANG: 'fr_FR.UTF-8',
        LC_CTYPE: 'ja_JP.UTF-8',
        LC_MESSAGES: 'fr_FR.UTF-8'
      })
    ).toEqual({
      PATH: '/usr/bin',
      LANG: 'fr_FR.UTF-8',
      LC_CTYPE: 'ja_JP.UTF-8',
      LC_MESSAGES: 'C'
    })
  })

  it('空の LC_ALL は無いものとして外す(libc は空の LC_ALL を見ない)', () => {
    expect(buildEnglishMessagesGitEnv({ LC_ALL: '', LANG: 'fr_FR.UTF-8' })).toEqual({
      LANG: 'fr_FR.UTF-8',
      LC_MESSAGES: 'C'
    })
  })

  it('大文字小文字の違う LC_ALL・LANGUAGE・LC_MESSAGES・カテゴリ(Windows の環境変数)も外してから置く', () => {
    expect(
      buildEnglishMessagesGitEnv({
        Lc_All: 'en_US.UTF-8',
        language: 'fr',
        lc_messages: 'fr_FR.UTF-8',
        Lc_Ctype: 'ja_JP.UTF-8',
        PATH: '/usr/bin'
      })
    ).toEqual({
      PATH: '/usr/bin',
      LC_CTYPE: 'en_US.UTF-8',
      LC_COLLATE: 'en_US.UTF-8',
      LC_NUMERIC: 'en_US.UTF-8',
      LC_TIME: 'en_US.UTF-8',
      LC_MONETARY: 'en_US.UTF-8',
      LC_PAPER: 'en_US.UTF-8',
      LC_NAME: 'en_US.UTF-8',
      LC_ADDRESS: 'en_US.UTF-8',
      LC_TELEPHONE: 'en_US.UTF-8',
      LC_MEASUREMENT: 'en_US.UTF-8',
      LC_IDENTIFICATION: 'en_US.UTF-8',
      LC_MESSAGES: 'C'
    })
  })

  it('LC_ALL と大文字小文字の違う変数が両方あれば、LC_ALL の値を使う', () => {
    expect(buildEnglishMessagesGitEnv({ lc_all: 'ja_JP.UTF-8', LC_ALL: 'en_US.UTF-8' })).toEqual({
      LC_CTYPE: 'en_US.UTF-8',
      LC_COLLATE: 'en_US.UTF-8',
      LC_NUMERIC: 'en_US.UTF-8',
      LC_TIME: 'en_US.UTF-8',
      LC_MONETARY: 'en_US.UTF-8',
      LC_PAPER: 'en_US.UTF-8',
      LC_NAME: 'en_US.UTF-8',
      LC_ADDRESS: 'en_US.UTF-8',
      LC_TELEPHONE: 'en_US.UTF-8',
      LC_MEASUREMENT: 'en_US.UTF-8',
      LC_IDENTIFICATION: 'en_US.UTF-8',
      LC_MESSAGES: 'C'
    })
  })
})

describe('createModeGit(実 git)', () => {
  let repo: string
  let home: string
  let tempRoot: string
  afterEach(() => disposeAgentBaselineRepo({ repo, home, tempRoot }))

  it('親の環境に simple-git が env() で拒否する変数(VS Code の GIT_ASKPASS など)があっても、今と同じく判定できる', async () => {
    ;({ repo, home, tempRoot } = createAgentBaselineRepo('mode-git-repo-'))
    vi.stubEnv('GIT_ASKPASS', join(home, 'askpass'))
    vi.stubEnv('EDITOR', 'vim')
    await expect(createModeGit(repo).checkIsRepo()).resolves.toBe(true)
  })

  const translatedGitBinDir = findTranslatedGitBinDir()
  it.skipIf(translatedGitBinDir === null)(
    '翻訳を持つ git と翻訳されたロケール(LC_ALL・LANGUAGE)でも、Git 管理外のフォルダの checkIsRepo は false で解決する',
    async () => {
      ;({ repo, home, tempRoot } = createAgentNonGitFolder('mode-git-plain-'))
      vi.stubEnv('PATH', `${translatedGitBinDir}:${process.env.PATH ?? ''}`)
      vi.stubEnv('LC_ALL', TRANSLATED_GIT_LOCALE)
      vi.stubEnv('LANGUAGE', 'fr')
      await expect(createModeGit(repo).checkIsRepo()).resolves.toBe(false)
      // 利用者の環境変数(process.env)は書き換えない
      expect(process.env.LC_ALL).toBe(TRANSLATED_GIT_LOCALE)
      expect(process.env.LANGUAGE).toBe('fr')
    }
  )
})

// 実 git の準備と後始末(afterEach)の要らない型のテストは、上の節の外に置く
describe('createModeGit の型', () => {
  it('unsafe をすべて許しているため、戻り値の型は方式の判定が使う checkIsRepo・raw だけを持つ', () => {
    expectTypeOf<keyof ReturnType<typeof createModeGit>>().toEqualTypeOf<'checkIsRepo' | 'raw'>()
  })
})

// 実 git で、記録のインデックスで問い合わせられること・利用者の index に触れないことを確かめる
describe('createBaselineGit(実 git)', () => {
  let repo: string
  let home: string
  let indexDir: string

  beforeEach(() => {
    // indexDir は記録のインデックスを置く一時ディレクトリ(tempRoot と同じ役割)
    ;({ repo, home, tempRoot: indexDir } = createAgentBaselineRepo('baseline-git-'))
    writeRepoFile(repo, 'a.txt', 'a\n')
    commitAll(repo, 'init')
  })

  afterEach(() => disposeAgentBaselineRepo({ repo, home, tempRoot: indexDir }))

  it('EDITOR・GIT_ASKPASS・GIT_DIR がある環境でも例外にならず、記録のインデックスで問い合わせる', async () => {
    const index = join(indexDir, 'index')
    copyFileSync(join(repo, '.git/index'), index)
    writeRepoFile(repo, 'new.txt', 'n\n')
    const headBefore = runGit(repo, 'rev-parse', 'HEAD')
    const refsBefore = runGit(repo, 'for-each-ref')
    const stashBefore = runGit(repo, 'stash', 'list')
    const statusBefore = runGit(repo, 'status', '--porcelain')
    // git status は index の stat 情報を書き直しうるため、index のバイト列は git の状態を取った後に取る
    const userIndexBefore = readFileSync(join(repo, '.git/index'))
    const mtimeBefore = statSync(join(repo, '.git/index')).mtimeMs
    const git = createBaselineGit(repoLocation(repo, index), {
      env: {
        ...process.env,
        EDITOR: 'vim',
        GIT_ASKPASS: '/nonexistent/askpass',
        GIT_DIR: join(home, 'not-a-repo')
      }
    })
    await git.raw(['add', '-A'])
    const listed = await git.raw(['ls-files', '-z'])
    expect(listed.split('\0').filter((p) => p !== '')).toEqual(['a.txt', 'new.txt'])
    // 利用者の index には new.txt が無く、書き換わってもいない
    expect(readFileSync(join(repo, '.git/index'))).toEqual(userIndexBefore)
    expect(statSync(join(repo, '.git/index')).mtimeMs).toBe(mtimeBefore)
    // 利用者の HEAD・ref・stash・状態も変わらない
    expect(runGit(repo, 'rev-parse', 'HEAD')).toBe(headBefore)
    expect(runGit(repo, 'for-each-ref')).toBe(refsBefore)
    expect(runGit(repo, 'stash', 'list')).toBe(stashBefore)
    expect(runGit(repo, 'status', '--porcelain')).toBe(statusBefore)
  })

  // 前提の固定: simple-git の env() に GIT_ASKPASS を含めると拒否される(除かないと使えない理由)
  it('前提: 変数を除かずに env() へ渡すと simple-git が拒否する', async () => {
    // v4 は allowEnvironment 未許可でも拒否するが、unsafe 分類の拒否を固定するため許可してから確認する
    const git = simpleGit(repo, { allowEnvironment: ['GIT_ASKPASS'] }).env({
      PATH: process.env.PATH,
      GIT_ASKPASS: '/nonexistent/askpass'
    })
    await expect(git.raw(['ls-files'])).rejects.toThrow(
      'Use of "GIT_ASKPASS" is not permitted without enabling allowUnsafeAskPass'
    )
  })

  // 前提の固定: 一覧の各変数は、除かずに env() へ渡すと simple-git が実際に拒否する
  it.each(EXPECTED_BLOCKED_ENV_KEYS)(
    '前提: %s を env() へ渡すと simple-git が拒否する',
    async (key) => {
      const git = simpleGit(repo, { allowEnvironment: [key] }).env({
        PATH: process.env.PATH,
        [key]: '/nonexistent/value'
      })
      await expect(git.raw(['ls-files'])).rejects.toThrow(`Use of "${key}" is not permitted`)
    }
  )

  // 各変数が process.env にあっても、createBaselineGit は外して問い合わせられる(GIT_CONFIG_GLOBAL・GIT_CONFIG_SYSTEM が
  // 子へ渡らないという既知の制約もここで固定する)
  it.each(EXPECTED_BLOCKED_ENV_KEYS)('%s が process.env にあっても例外にならない', async (key) => {
    vi.stubEnv(key, '/nonexistent/value')
    const index = join(indexDir, 'index')
    copyFileSync(join(repo, '.git/index'), index)
    const listed = await createBaselineGit(repoLocation(repo, index)).raw(['ls-files', '-z'])
    expect(listed.split('\0').filter((p) => p !== '')).toEqual(['a.txt'])
  })

  // 既知の制約の固定: GIT_CONFIG_GLOBAL は渡らず、HOME の .gitconfig を読む(テストは stubGitHome で隔離する)
  it('GIT_CONFIG_GLOBAL は子へ渡らず、HOME の設定(core.excludesFile)を読む', async () => {
    const excludes = join(home, 'excludes')
    writeFileSync(excludes, 'ignored-by-home.txt\n')
    writeFileSync(join(home, '.gitconfig'), `[core]\n\texcludesFile = ${excludes}\n`)
    writeRepoFile(repo, 'ignored-by-home.txt', 'x\n')
    const index = join(indexDir, 'index')
    const git = createBaselineGit(repoLocation(repo, index))
    const others = await git.raw(['ls-files', '-z', '--others', '--exclude-standard'])
    expect(others.split('\0')).not.toContain('ignored-by-home.txt')
  })
})

// 標準入力でパスを渡す git(update-index --stdin)。simple-git は標準入力を渡せないため spawn で起動する(ローカルレビュー第 2 周の指摘 1)
describe('runBaselineGitWithInput(実 git)', () => {
  let repo: string
  let home: string
  let indexDir: string

  beforeEach(() => {
    ;({ repo, home, tempRoot: indexDir } = createAgentBaselineRepo('baseline-git-input-'))
    writeRepoFile(repo, 'a.txt', 'a\n')
    writeRepoFile(repo, 'b*.txt', 'b\n')
    writeRepoFile(repo, 'line\nbreak.txt', 'c\n')
    commitAll(repo, 'init')
  })

  afterEach(() => disposeAgentBaselineRepo({ repo, home, tempRoot: indexDir }))

  const listed = async (index: string): Promise<string[]> =>
    (await createBaselineGit(repoLocation(repo, index)).raw(['ls-files', '-z']))
      .split('\0')
      .filter((p) => p !== '')

  it('記録のインデックスから、NUL 区切りの標準入力のパスをパスそのものとして外し、利用者の index を変えない(GIT_DIR などは渡さない)', async () => {
    const index = join(indexDir, 'index')
    copyFileSync(join(repo, '.git/index'), index)
    const userIndexBefore = readFileSync(join(repo, '.git/index'))
    await runBaselineGitWithInput(
      repoLocation(repo, index),
      ['update-index', '-z', '--force-remove', '--stdin'],
      'b*.txt\0line\nbreak.txt\0',
      { env: { ...process.env, GIT_DIR: '/nonexistent/.git', GIT_ASKPASS: '/nonexistent' } }
    )
    expect(await listed(index)).toEqual(['a.txt'])
    expect(readFileSync(join(repo, '.git/index'))).toEqual(userIndexBefore)
  })

  it('git が失敗したら stderr を添えて例外にする', async () => {
    const index = join(indexDir, 'index')
    copyFileSync(join(repo, '.git/index'), index)
    await expect(
      runBaselineGitWithInput(repoLocation(repo, index), ['update-index', '--no-such-option'], '')
    ).rejects.toThrow(/no-such-option/)
  })

  it('打ち切りの時間を超えたら、simple-git の打ち切りと同じ判定(isGitTimeoutError)になる例外にする', async () => {
    const bin = join(home, 'slow-bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nexec sleep 5\n', { mode: 0o755 })
    const error = await runBaselineGitWithInput(
      repoLocation(repo, join(indexDir, 'index')),
      ['status'],
      '',
      {
        timeoutMs: 100,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }
      }
    ).then(
      () => null,
      (e: unknown) => e
    )
    expect(isGitTimeoutError(error)).toBe(true)
  })

  it('git を起動できなければ例外にする', async () => {
    await expect(
      runBaselineGitWithInput(repoLocation(repo, join(indexDir, 'index')), ['status'], '', {
        env: { ...process.env, PATH: join(home, 'nonexistent-bin') }
      })
    ).rejects.toThrow()
  })
})

describe('AGENT_BASELINE_GIT_TIMEOUT_MS', () => {
  it('git の 1 回の打ち切りは 10 秒', () => {
    expect(AGENT_BASELINE_GIT_TIMEOUT_MS).toBe(10_000)
  })
})

// 記録の HEAD と、戻す操作のコンフリクトの判定・blob の有無を問い合わせる git の切り替え(設計書「記録の git の場所と環境」)
describe('readRecordHead・createRecordRepoGit(実 git)', () => {
  let repo: string
  let home: string
  let indexDir: string

  beforeEach(() => {
    ;({ repo, home, tempRoot: indexDir } = createAgentBaselineRepo('record-repo-git-'))
    writeRepoFile(repo, 'a.txt', 'a\n')
    commitAll(repo, 'init')
  })

  afterEach(() => disposeAgentBaselineRepo({ repo, home, tempRoot: indexDir }))

  // 隠れた git の場所(中身は空の bare リポジトリ。記録のインデックスは作らない = 空の index)
  const hiddenLocation = (): BaselineGitLocation => {
    const gitDir = join(indexDir, 'git')
    runGit(indexDir, 'init', '-q', '--bare', '--template=', gitDir)
    return { folderPath: repo, indexPath: join(indexDir, 'index'), gitDir }
  }

  it('リポジトリの方式の HEAD は利用者の HEAD', async () => {
    await expect(readRecordHead(repoLocation(repo, join(indexDir, 'index')))).resolves.toBe(
      runGit(repo, 'rev-parse', 'HEAD').trim()
    )
  })

  it('隠れた git の HEAD は git を呼ばずに null(git が無くても解決する)', async () => {
    const location = hiddenLocation()
    vi.stubEnv('PATH', join(home, 'no-bin'))
    await expect(readRecordHead(location)).resolves.toBeNull()
  })

  it('リポジトリの方式の createRecordRepoGit は利用者の index で問い合わせる', async () => {
    const listed = await createRecordRepoGit(repoLocation(repo, join(indexDir, 'index'))).raw([
      'ls-files',
      '-z'
    ])
    expect(listed.split('\0').filter((p) => p !== '')).toEqual(['a.txt'])
  })

  it('隠れた git の createRecordRepoGit は記録のインデックス(ここでは無い = 空)で問い合わせる', async () => {
    await expect(createRecordRepoGit(hiddenLocation()).raw(['ls-files', '-z'])).resolves.toBe('')
  })
})

describe('readRecordHead の選択肢の型', () => {
  it('打ち切りだけを受け取る(createRepoGit と同じ。記録の環境変数・-c は付けない)', () => {
    type Options = NonNullable<Parameters<typeof readRecordHead>[1]>
    expectTypeOf<keyof Options>().toEqualTypeOf<'timeoutMs'>()
  })
})
