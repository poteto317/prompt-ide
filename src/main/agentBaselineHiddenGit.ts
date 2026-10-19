import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hiddenGitNoHooksPath, runIsolatedGit } from './agentBaselineGit'
import type { BaselineGitOptions } from './agentBaselineGit'

// Git 管理外のフォルダの記録の隠れた git(設計書 2026-10-15「隠れた git の作成」)。記録の一時ディレクトリ(mkdtemp。0700)の中に
// 記録専用の bare リポジトリを作り、利用者のフォルダには何も書かない。bare にしておけば、GIT_WORK_TREE を渡し忘れた命令は
// 作業ツリーに触れずに失敗する(確認の結果 9)。設定の値・除外の一覧は main の定数だけ(L-034)。ファイルシステムの性質
// (core.ignorecase・core.symlinks・core.filemode・core.precomposeunicode)は git init が一時ディレクトリで調べて書いた値をそのまま使い、
// init が書かなかった鍵(既定と同じ値・大域に値があって調べなかった)は git の既定値を書く(利用者の大域の値を効かせない。
// HIDDEN_GIT_FILESYSTEM_DEFAULTS。ローカルレビュー第 6 周の指摘 3)

/**
 * 記録に含めない既定の一覧(隠れた git の info/exclude)。依存の置き場・生成物・OS が作るファイル。フォルダは末尾の / でフォルダだけに
 * 当て、先頭に / を付けない(どの深さでも当てる)。.env などの秘密のファイルは除かない(エージェントが変えたら一覧に出し、戻せるようにする)。
 * フォルダの .gitignore の !dist/ などで打ち消せる(確認の結果 11)
 */
export const AGENT_BASELINE_DEFAULT_EXCLUDES: readonly string[] = [
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

const HIDDEN_GIT_DIR_NAME = 'git'
const EMPTY_INDEX_NAME = 'empty-index'
const EXCLUDE_HEADER = '# prompt-ide が書いた既定の一覧（記録に含めないもの）'

/**
 * 隠れた git の設定(利用者の大域の設定より優先される)。fsmonitor の daemon を起動させない・自動の gc と maintenance を起こさない・
 * index を書くたびに動く post-index-change などの hook を利用者の大域の core.hooksPath から動かさない(gitDir の中の存在しない絶対パス)・
 * 利用者の大域・システムの core.autocrlf で改行コードを変換しない(隠れた git は利用者のリポジトリではないため、記録と戻す〈git restore・
 * ハンクの git apply〉はバイトのまま扱う。Git for Windows の既定はシステムの設定に core.autocrlf=true)・core.safecrlf=true で記録の
 * git add を失敗させない・変更の検出(一覧の diff --name-status)の stat の比較を利用者の大域の設定で緩めない(core.ignoreStat=true は
 * 記録のエントリを assume-unchanged にして変更・削除を出さなくし、core.checkStat=minimal と core.trustctime=false は大きさと mtime を
 * 保った書き換えを見逃し、diff.autoRefreshIndex=false は stat だけ変わったファイルを M で出す。git の既定の挙動に固定する)。
 * 改行と stat の設定は命令の -c(hiddenGitCommandConfig)には足さない(-c は利用者の命令を動かしうる設定を親の GIT_CONFIG_PARAMETERS から守るためのもの)
 */
export function hiddenGitConfig(gitDir: string): readonly (readonly [string, string])[] {
  return [
    ['core.fsmonitor', 'false'],
    ['gc.auto', '0'],
    ['maintenance.auto', 'false'],
    ['core.hooksPath', hiddenGitNoHooksPath(gitDir)],
    ['core.autocrlf', 'false'],
    ['core.safecrlf', 'false'],
    ['core.ignoreStat', 'false'],
    ['core.checkStat', 'default'],
    ['core.trustctime', 'true'],
    ['diff.autoRefreshIndex', 'true']
  ]
}

/**
 * ファイルシステムの性質の鍵と git の既定値。git 2.50.1 の init は core.symlinks をリンクを作れないときだけ(false)、core.ignorecase を
 * 大文字小文字を区別しないときだけ(true)書き、core.precomposeunicode は大域に値があれば調べずに書かない。書かれなかった鍵には利用者の
 * 大域の値が効くため(大域の core.symlinks=false で戻したリンクが普通のファイルになる・core.ignorecase=true で大文字小文字だけが違う
 * ファイルを記録できない)、init の後に、隠れた git のローカルの設定に無い鍵だけこの値を書く(init が調べて書いた値は上書きしない)
 */
export const HIDDEN_GIT_FILESYSTEM_DEFAULTS: readonly (readonly [string, string])[] = [
  ['core.symlinks', 'true'],
  ['core.ignorecase', 'false'],
  ['core.precomposeunicode', 'false']
]

/** info/exclude の中身(先頭に注釈の行、続けて既定の一覧を 1 行ずつ) */
export function hiddenGitExcludeContent(): string {
  return [EXCLUDE_HEADER, ...AGENT_BASELINE_DEFAULT_EXCLUDES].map((line) => `${line}\n`).join('')
}

/**
 * 未追跡の事前の検査に渡す空の index(作らない)。存在しないファイルを GIT_INDEX_FILE に渡すと、フォルダの ignore されていない
 * ファイルがすべて未追跡として出る(確認の結果 2。意図した「無い」。L-002)
 */
export function hiddenGitEmptyIndexPath(tempDir: string): string {
  return join(tempDir, EMPTY_INDEX_NAME)
}

/** 記録の一時ディレクトリ tempDir の中の隠れた git の場所(<tempDir>/git。作らない) */
export function hiddenGitDirOf(tempDir: string): string {
  return join(tempDir, HIDDEN_GIT_DIR_NAME)
}

/** 隠れた git を作る 1 つの git の命令(cwd は記録の一時ディレクトリ。extraEnv は main が作った値だけ) */
export interface HiddenGitSetupCommand {
  args: readonly string[]
  extraEnv?: Record<string, string>
}

/**
 * 隠れた git を作る init。cwd は記録の一時ディレクトリで、作る場所を相対の名前で渡し、パスを git の引数にしない(L-034)。
 * --template= で利用者の init.templateDir の hook などを写さない(確認の結果 1)
 */
export function hiddenGitInitCommand(): HiddenGitSetupCommand {
  return { args: ['init', '--bare', '-q', '--template=', HIDDEN_GIT_DIR_NAME] }
}

/** init の後に、隠れた git のローカルの設定の鍵の名前を NUL 区切りで読む命令(--local は大域・システム・-c の設定を含めない) */
export function hiddenGitLocalConfigNamesCommand(gitDir: string): HiddenGitSetupCommand {
  return {
    args: ['config', '--local', '--name-only', '--list', '-z'],
    extraEnv: { GIT_DIR: gitDir }
  }
}

/** hiddenGitLocalConfigNamesCommand の出力を鍵の名前(小文字)の一覧にする */
export function parseConfigNames(output: string): string[] {
  return output
    .split('\0')
    .filter((name) => name !== '')
    .map((name) => name.toLowerCase())
}

/**
 * init の後に書く設定の命令の並び。initWrittenNames(init が書いた鍵の名前。hiddenGitLocalConfigNamesCommand の出力)に無い
 * ファイルシステムの性質の鍵の既定値(HIDDEN_GIT_FILESYSTEM_DEFAULTS)→ 隠れた git の設定(hiddenGitConfig)の順。
 * どれも GIT_DIR を隠れた git にして書く(実行は createHiddenGit)
 */
export function hiddenGitConfigCommands(
  gitDir: string,
  initWrittenNames: readonly string[]
): readonly HiddenGitSetupCommand[] {
  const written = new Set(initWrittenNames.map((name) => name.toLowerCase()))
  const filesystemDefaults = HIDDEN_GIT_FILESYSTEM_DEFAULTS.filter(
    ([key]) => !written.has(key.toLowerCase())
  )
  return [...filesystemDefaults, ...hiddenGitConfig(gitDir)].map(([key, value]) => ({
    args: ['config', key, value],
    extraEnv: { GIT_DIR: gitDir }
  }))
}

/**
 * 隠れた git を作る命令(init・config)に -c で付ける設定。設定を書き終えるまでの init・config にも core.hooksPath=<gitDir>/no-hooks を
 * 渡す。git 2.50.1 の init は HEAD を作るときに利用者の大域の core.hooksPath の reference-transaction の hook を 2 回動かす
 * (実測。隠れた git の設定はまだ無い)
 */
export function hiddenGitSetupCommandConfig(gitDir: string): string[] {
  return [`core.hooksPath=${hiddenGitNoHooksPath(gitDir)}`]
}

/**
 * 記録の一時ディレクトリ tempDir の中に隠れた git を作り、gitDir(<tempDir>/git)を返す。init → ローカルの設定の鍵の名前を読む →
 * 設定(hiddenGitConfigCommands。init が書かなかったファイルシステムの性質の鍵の既定値と hiddenGitConfig)→ info/exclude の順。
 * どこかで失敗したら例外(呼び出し側が一時ディレクトリごと消して git-failed。打ち切りは timeout)。
 * 選択肢は打ち切りと元の環境だけ(-c は hiddenGitSetupCommandConfig の固定値だけを付け、呼び出し側の config は受け取らない)
 */
export async function createHiddenGit(
  tempDir: string,
  gitOptions: Pick<BaselineGitOptions, 'timeoutMs' | 'env'> = {}
): Promise<string> {
  const { timeoutMs, env } = gitOptions
  const gitDir = hiddenGitDirOf(tempDir)
  const config = hiddenGitSetupCommandConfig(gitDir)
  const run = ({ args, extraEnv }: HiddenGitSetupCommand): Promise<string> =>
    runIsolatedGit(tempDir, args, { timeoutMs, config, env, extraEnv })
  await run(hiddenGitInitCommand())
  const initWrittenNames = parseConfigNames(await run(hiddenGitLocalConfigNamesCommand(gitDir)))
  for (const command of hiddenGitConfigCommands(gitDir, initWrittenNames)) await run(command)
  await mkdir(join(gitDir, 'info'), { mode: 0o700 })
  await writeFile(join(gitDir, 'info', 'exclude'), hiddenGitExcludeContent(), {
    flag: 'wx',
    mode: 0o600
  })
  return gitDir
}
