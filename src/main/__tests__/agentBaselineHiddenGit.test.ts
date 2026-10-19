import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  AGENT_BASELINE_DEFAULT_EXCLUDES,
  HIDDEN_GIT_FILESYSTEM_DEFAULTS,
  createHiddenGit,
  hiddenGitConfig,
  hiddenGitConfigCommands,
  hiddenGitDirOf,
  hiddenGitEmptyIndexPath,
  hiddenGitExcludeContent,
  hiddenGitInitCommand,
  hiddenGitLocalConfigNamesCommand,
  hiddenGitSetupCommandConfig,
  parseConfigNames
} from '../agentBaselineHiddenGit'

// 記録に含めない既定の一覧(設計書「記録に含めないもの(既定の一覧)」)。実装の一覧とは別にリテラルで持ち、実装から 1 個消えたら落ちるようにする
const EXPECTED_DEFAULT_EXCLUDES = [
  'node_modules/',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.next/',
  'dist/',
  'build/',
  'target/',
  '.DS_Store',
  'Thumbs.db'
]

describe('隠れた git の既定の一覧と設定', () => {
  it('既定の一覧は設計書の 10 個(この順)', () => {
    expect([...AGENT_BASELINE_DEFAULT_EXCLUDES]).toEqual(EXPECTED_DEFAULT_EXCLUDES)
  })

  it('フォルダは末尾の / でフォルダだけに当て、先頭に / を付けない(どの深さでも当てる)。.git/ と .env は書かない', () => {
    for (const pattern of AGENT_BASELINE_DEFAULT_EXCLUDES)
      expect(pattern.startsWith('/')).toBe(false)
    expect(AGENT_BASELINE_DEFAULT_EXCLUDES).not.toContain('.git/')
    expect(AGENT_BASELINE_DEFAULT_EXCLUDES.some((pattern) => pattern.includes('.env'))).toBe(false)
  })

  it('隠れた git の設定は hook・fsmonitor・gc・maintenance・改行コード・変更の検出の stat の比較の 10 個(この順)', () => {
    expect(hiddenGitConfig('/t/git')).toEqual([
      ['core.fsmonitor', 'false'],
      ['gc.auto', '0'],
      ['maintenance.auto', 'false'],
      ['core.hooksPath', '/t/git/no-hooks'],
      ['core.autocrlf', 'false'],
      ['core.safecrlf', 'false'],
      ['core.ignoreStat', 'false'],
      ['core.checkStat', 'default'],
      ['core.trustctime', 'true'],
      ['diff.autoRefreshIndex', 'true']
    ])
  })

  it('ファイルシステムの性質の鍵の既定値は core.symlinks=true・core.ignorecase=false・core.precomposeunicode=false(git の既定値)', () => {
    expect(HIDDEN_GIT_FILESYSTEM_DEFAULTS).toEqual([
      ['core.symlinks', 'true'],
      ['core.ignorecase', 'false'],
      ['core.precomposeunicode', 'false']
    ])
  })

  it('info/exclude の中身は、注釈の行の後に既定の一覧を 1 行ずつ', () => {
    expect(hiddenGitExcludeContent()).toBe(
      `# prompt-ide が書いた既定の一覧（記録に含めないもの）\n${EXPECTED_DEFAULT_EXCLUDES.join('\n')}\n`
    )
  })
})

describe('記録の一時ディレクトリの中の場所(作らない)', () => {
  it('隠れた git の場所は記録の一時ディレクトリの git', () => {
    expect(hiddenGitDirOf('/t')).toBe('/t/git')
  })

  it('未追跡の事前の検査の空の index は、記録の一時ディレクトリの empty-index', () => {
    expect(hiddenGitEmptyIndexPath('/t')).toBe('/t/empty-index')
  })
})

describe('隠れた git を作る命令の並び(実行は createHiddenGit)', () => {
  const settings = [
    { args: ['config', 'core.fsmonitor', 'false'], extraEnv: { GIT_DIR: '/t/git' } },
    { args: ['config', 'gc.auto', '0'], extraEnv: { GIT_DIR: '/t/git' } },
    { args: ['config', 'maintenance.auto', 'false'], extraEnv: { GIT_DIR: '/t/git' } },
    { args: ['config', 'core.hooksPath', '/t/git/no-hooks'], extraEnv: { GIT_DIR: '/t/git' } },
    { args: ['config', 'core.autocrlf', 'false'], extraEnv: { GIT_DIR: '/t/git' } },
    { args: ['config', 'core.safecrlf', 'false'], extraEnv: { GIT_DIR: '/t/git' } },
    { args: ['config', 'core.ignoreStat', 'false'], extraEnv: { GIT_DIR: '/t/git' } },
    { args: ['config', 'core.checkStat', 'default'], extraEnv: { GIT_DIR: '/t/git' } },
    { args: ['config', 'core.trustctime', 'true'], extraEnv: { GIT_DIR: '/t/git' } },
    { args: ['config', 'diff.autoRefreshIndex', 'true'], extraEnv: { GIT_DIR: '/t/git' } }
  ]
  const symlinks = { args: ['config', 'core.symlinks', 'true'], extraEnv: { GIT_DIR: '/t/git' } }
  const ignorecase = {
    args: ['config', 'core.ignorecase', 'false'],
    extraEnv: { GIT_DIR: '/t/git' }
  }
  const precompose = {
    args: ['config', 'core.precomposeunicode', 'false'],
    extraEnv: { GIT_DIR: '/t/git' }
  }

  it('init は --bare・--template=・相対の名前(作る場所のパスを引数で渡さない。L-034)', () => {
    const init = hiddenGitInitCommand()
    expect(init).toEqual({ args: ['init', '--bare', '-q', '--template=', 'git'] })
    for (const arg of init.args) expect(arg.includes('/')).toBe(false)
  })

  it('init の後に、GIT_DIR を隠れた git にしてローカルの設定の鍵の名前だけを NUL 区切りで読む', () => {
    expect(hiddenGitLocalConfigNamesCommand('/t/git')).toEqual({
      args: ['config', '--local', '--name-only', '--list', '-z'],
      extraEnv: { GIT_DIR: '/t/git' }
    })
  })

  it('鍵の名前の出力は NUL で区切り、空を除いて小文字にする', () => {
    expect(parseConfigNames('core.bare\0core.ignoreCase\0')).toEqual([
      'core.bare',
      'core.ignorecase'
    ])
    expect(parseConfigNames('')).toEqual([])
  })

  // 大文字小文字を区別するボリューム・リンクを作れる環境(Linux の /tmp など)では init がファイルシステムの性質の鍵を書かない
  it('init がファイルシステムの性質の鍵を書かなかったら、3 つの既定値 → 隠れた git の設定の順に書く', () => {
    expect(
      hiddenGitConfigCommands('/t/git', [
        'core.repositoryformatversion',
        'core.filemode',
        'core.bare'
      ])
    ).toEqual([symlinks, ignorecase, precompose, ...settings])
  })

  // macOS の一時ディレクトリ(大文字小文字を区別しない)で、大域に core.precomposeunicode がある場合
  it('init が書いた鍵(core.ignorecase=true など)は上書きせず、書かなかった鍵だけ既定値を書く', () => {
    expect(
      hiddenGitConfigCommands('/t/git', ['core.filemode', 'core.bare', 'core.ignorecase'])
    ).toEqual([symlinks, precompose, ...settings])
  })

  it('init が 3 つとも書いたら(リンクを作れない・大文字小文字を区別しない・precomposeunicode を調べた)、隠れた git の設定だけを書く', () => {
    expect(
      hiddenGitConfigCommands('/t/git', [
        'core.symlinks',
        'core.ignorecase',
        'core.precomposeunicode'
      ])
    ).toEqual(settings)
  })

  it('作る命令に -c で付けるのは core.hooksPath=<gitDir>/no-hooks だけ(大域の hook を init から動かさない)', () => {
    expect(hiddenGitSetupCommandConfig('/t/git')).toEqual(['core.hooksPath=/t/git/no-hooks'])
  })
})

describe('createHiddenGit の選択肢の型', () => {
  it('打ち切りと元の環境だけを受け取り、config は受け取らない(-c は固定値だけを付ける)', () => {
    type Options = NonNullable<Parameters<typeof createHiddenGit>[1]>
    expectTypeOf<keyof Options>().toEqualTypeOf<'timeoutMs' | 'env'>()
  })
})
