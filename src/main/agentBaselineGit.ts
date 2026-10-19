import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import simpleGit, { GitPluginError } from 'simple-git'
import type { SimpleGit, SimpleGitOptions } from 'simple-git'

// 記録のインデックス(利用者の .git/index の写しに作業ツリーを入れたもの)で問い合わせる git を作る(設計書「確認の結果」14)。
// GIT_INDEX_FILE を渡すには simple-git の env() が要るが、env() は環境変数の中身を検査し、simple-git 3.36.0
// (@simple-git/argv-parser)が拒否する変数(EDITOR・GIT_ASKPASS など)が 1 つでもあると GitPluginError を投げる
// (gitService.ts の getLog のコメントと同じ現象。VS Code から起動すると GIT_ASKPASS が引き継がれる)。拒否される変数と、
// 利用者の別のリポジトリを指しうる位置の変数を除いた環境に、記録のインデックスの GIT_INDEX_FILE を足す。
// 記録の git の場所は BaselineGitLocation で受け取る。隠れた git(Git 管理外のフォルダの記録。2026-10-15 の設計書)は GIT_DIR・
// GIT_WORK_TREE を、この環境の組み立ての 1 か所で常に付ける(呼び出しごとに選ばない。L-075)
// 既知の制約: 除く変数に GIT_CONFIG_GLOBAL・GIT_CONFIG_SYSTEM が含まれるため、この git は既定の場所の設定を読む

/** 記録・一覧・戻すの git の 1 回の打ち切り(出力が無いまま経った時間) */
export const AGENT_BASELINE_GIT_TIMEOUT_MS = 10_000

/** simple-git 3.36.0 の env() が拒否する変数(小文字。@simple-git/argv-parser の一覧と同じ 18 個) */
export const SIMPLE_GIT_BLOCKED_ENV_KEYS: readonly string[] = [
  'editor',
  'git_askpass',
  'git_config',
  'git_config_count',
  'git_config_global',
  'git_config_system',
  'git_editor',
  'git_exec_path',
  'git_external_diff',
  'git_pager',
  'git_proxy_command',
  'git_sequence_editor',
  'git_ssh',
  'git_ssh_command',
  'git_template_dir',
  'pager',
  'prefix',
  'ssh_askpass'
]

/**
 * 利用者の別のリポジトリ・別のインデックス・別のオブジェクトの置き場を指しうる変数(小文字。GIT_INDEX_FILE は記録のインデックスで
 * 置き換える)。オブジェクトの置き場の変数が残ると、記録の blob が別の場所へ書かれ、別の場所から読まれる(最終レビュー A の M7)
 */
export const REPO_LOCATION_ENV_KEYS: readonly string[] = [
  'git_dir',
  'git_work_tree',
  'git_index_file',
  'git_object_directory',
  'git_alternate_object_directories',
  'git_common_dir',
  'git_namespace'
]

// GIT_CONFIG_COUNT を外すと読まれなくなる設定の組(GIT_CONFIG_KEY_n・GIT_CONFIG_VALUE_n)。残しても働かないが、外して揃える
const isConfigPairKey = (lower: string): boolean => /^git_config_(key|value)_\d+$/.test(lower)

/**
 * 記録の git の場所。gitDir が null ならリポジトリの方式(利用者の .git の object の DB を使う)。git の層で定義し、記録
 * (agentBaselineSnapshot の BaselineSnapshot)はこの形を満たす(git の起動の層が記録の手順を参照しない。依存は記録 → git の一方向)
 */
export interface BaselineGitLocation {
  /** 作業ツリーの最上位(git の cwd。隠れた git では GIT_WORK_TREE) */
  folderPath: string
  /** 記録のインデックス(GIT_INDEX_FILE) */
  indexPath: string
  /** 隠れた git の場所(GIT_DIR)。null はリポジトリの方式 */
  gitDir: string | null
}

/**
 * source から除く変数(simple-git が拒否する変数・位置の変数・設定の組。大文字小文字を問わない。L-079)を外した環境。
 * 位置の変数は足さない(隠れた git の作成 runIsolatedGit と、buildBaselineGitEnv が使う)。source の既定値は無い
 */
export function buildIsolatedGitEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    const lower = key.toLowerCase().trim()
    if (
      SIMPLE_GIT_BLOCKED_ENV_KEYS.includes(lower) ||
      REPO_LOCATION_ENV_KEYS.includes(lower) ||
      isConfigPairKey(lower)
    ) {
      continue
    }
    env[key] = value
  }
  return env
}

/**
 * 記録の git の環境: buildIsolatedGitEnv の後に GIT_INDEX_FILE を記録のインデックスにし、隠れた git(gitDir が文字列)なら
 * GIT_DIR・GIT_WORK_TREE(開いたフォルダ)も置く。親の位置の変数を除いた後に置くため、別のリポジトリを指さない(L-075)
 */
export function buildBaselineGitEnv(
  source: NodeJS.ProcessEnv,
  location: BaselineGitLocation
): Record<string, string> {
  const env = buildIsolatedGitEnv(source)
  env.GIT_INDEX_FILE = location.indexPath
  if (location.gitDir !== null) {
    env.GIT_DIR = location.gitDir
    env.GIT_WORK_TREE = location.folderPath
  }
  return env
}

/**
 * 隠れた git の hook の場所(作らない。gitDir の中の存在しない絶対パス)。隠れた git の config(agentBaselineHiddenGit)と、
 * 隠れた git の命令に -c で付ける値(hiddenGitCommandConfig)が同じ値を使う
 */
export function hiddenGitNoHooksPath(gitDir: string): string {
  return join(gitDir, 'no-hooks')
}

/**
 * 記録の場所ごとに git の命令へ -c で常に付ける設定。隠れた git(gitDir が文字列)は core.hooksPath を存在しないパスにし、
 * core.fsmonitor=false にする。親の環境の GIT_CONFIG_PARAMETERS(git -c の受け渡し。simple-git の env() も buildIsolatedGitEnv も
 * 除かない)は隠れた git の config より後に読まれ、利用者の hook・fsmonitor の命令を動かしうるため、-c でそれより後に読ませる
 * (-c は親の GIT_CONFIG_PARAMETERS の後ろに足される)。リポジトリの方式(gitDir が null)は何も足さない(今の挙動のまま)
 */
export function hiddenGitCommandConfig(location: Pick<BaselineGitLocation, 'gitDir'>): string[] {
  if (location.gitDir === null) return []
  return [`core.hooksPath=${hiddenGitNoHooksPath(location.gitDir)}`, 'core.fsmonitor=false']
}

/**
 * 記録の git で作業ツリーと比べる diff(一覧の `--name-status`・1 ファイルの patch・戻すの分類の `--name-only`)に、命令行で常に
 * 付ける引数(両方の方式。ローカルレビュー第 13 周の指摘 1)。記録のインデックスはフォルダの下の入れ子のリポジトリを gitlink として
 * 持ち、作業ツリーとの diff は gitlink ごとに入れ子のリポジトリの中で `git status` を起動する。その子の git は入れ子の .git/config を
 * 読むため、そこの filter.<名前>.clean が動き(-c の core.hooksPath・core.fsmonitor は子へ引き継がれるが filter は止まらない)、
 * 入れ子の .git/index も書き直す。=dirty は中の状態を調べず、gitlink の HEAD の違い(コミットの差)だけを M として出す(=all は
 * HEAD の違いも隠すため使わない)。-c の diff.ignoreSubmodules はフォルダの .gitmodules の submodule.<名前>.ignore(攻撃者が
 * 置ける)に打ち消されるため、命令行の引数で渡す(実測。git 2.50.1)。ソース管理パネル(gitService)には付けない
 */
export const RECORD_WORKTREE_DIFF_ARGS: readonly string[] = ['--ignore-submodules=dirty']

export interface BaselineGitOptions {
  /** 出力が無いまま経ったら git を止める時間(simple-git の timeout.block)。テストで短くする */
  timeoutMs?: number
  /** `git -c` で渡す設定(diff の core.quotePath=false など) */
  config?: string[]
  /** 元にする環境変数。テストで差し替える */
  env?: NodeJS.ProcessEnv
}

/** 記録の場所(記録のインデックス・隠れた git)で問い合わせる git。cwd は作業ツリーの最上位(location.folderPath) */
export function createBaselineGit(
  location: BaselineGitLocation,
  {
    timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS,
    config = [],
    env = process.env
  }: BaselineGitOptions = {}
): SimpleGit {
  // 一覧・diff・戻す操作の git も記録のインデックスを(stat 情報の更新で)書き直すことがある。利用者の core.splitIndex=true が
  // 効くと、共有部分の sharedindex.<sha> が利用者の .git に作られるため、常に split 形式を使わない(最終レビュー A の I1)
  const locationConfig = hiddenGitCommandConfig(location)
  return simpleGit(location.folderPath, {
    timeout: { block: timeoutMs },
    config: ['core.splitIndex=false', ...config, ...locationConfig],
    // simple-git は -c の core.hooksPath・core.fsmonitor を既定で拒むため、隠れた git の値(main が作った固定の値)だけ許す
    ...(locationConfig.length > 0
      ? { unsafe: { allowUnsafeHooksPath: true, allowUnsafeFsMonitor: true } }
      : {})
  }).env(buildBaselineGitEnv(env, location))
}

/** 利用者の index で問い合わせる git(記録の HEAD・最上位の確認・コンフリクトの判定)。打ち切りだけを付ける */
export function createRepoGit(
  folderPath: string,
  { timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS }: Pick<BaselineGitOptions, 'timeoutMs'> = {}
): SimpleGit {
  return simpleGit(folderPath, { timeout: { block: timeoutMs } })
}

/**
 * 方式の判定(agentBaselineMode の resolveBaselineMode)と、記録の add -A の読めないパスの検出(runBaselineGitDetectingUnreadablePath)
 * の git の環境: source の写しの LC_ALL を C にし、LANGUAGE を外す
 * (大文字小文字を問わない)。simple-git の checkIsRepo は「リポジトリでない」を git の英語(とドイツ語)の文言で見分け、翻訳された
 * git(LC_ALL=fr_FR.UTF-8 など)では Git 管理外のフォルダで reject するため、メッセージを英語にする。git の gettext は LANGUAGE を
 * LC_ALL より優先する(LC_ALL が C のときは見ない)ため両方扱う。ほかの変数(位置の変数・設定)は除かない(今の判定のまま)
 */
export function buildModeGitEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    const upper = key.toUpperCase().trim()
    if (upper === 'LC_ALL' || upper === 'LANGUAGE') continue
    env[key] = value
  }
  env.LC_ALL = 'C'
  return env
}

// simple-git は env() で渡した環境を検査し、拒否する変数(GIT_ASKPASS・GIT_CONFIG_GLOBAL など)や GIT_CONFIG_KEY_n の設定があると
// 投げる。方式の判定の git は env() を使う前(createRepoGit)と同じく親の環境をそのまま引き継ぐため、環境の検査だけを外す。
// 命令は rev-parse(checkIsRepo を含む)に固定で、-c も付けない。型で全部の分類を並べさせる(版を上げて分類が増えたら型が落ちる)
const INHERITED_ENV_ALLOWANCES: Required<
  Omit<NonNullable<SimpleGitOptions['unsafe']>, 'allowUnsafeCustomBinary'>
> = {
  allowUnsafeAlias: true,
  allowUnsafeAskPass: true,
  allowUnsafeConfigPaths: true,
  allowUnsafeConfigEnvCount: true,
  allowUnsafeCredentialHelper: true,
  allowUnsafeEditor: true,
  allowUnsafeMergeDriver: true,
  allowUnsafePager: true,
  allowUnsafeProtocolOverride: true,
  allowUnsafePack: true,
  allowUnsafeSshCommand: true,
  allowUnsafeGitProxy: true,
  allowUnsafeHooksPath: true,
  allowUnsafeDiffExternal: true,
  allowUnsafeDiffTextConv: true,
  allowUnsafeFilter: true,
  allowUnsafeFsMonitor: true,
  allowUnsafeGpgProgram: true,
  allowUnsafeTemplateDir: true
}

/**
 * 方式の判定(checkIsRepo・rev-parse --show-toplevel・rev-parse --git-dir)の git。createRepoGit と同じく利用者の環境
 * (process.env)で問い合わせ、写しの環境だけを buildModeGitEnv で英語のメッセージにする(process.env は書き換えない)。
 * 記録・一覧などのほかの git(リポジトリの方式の記録の createRepoGit を含む)は変えない。unsafe をすべて許しているため、
 * 戻り値の型を方式の判定が使う checkIsRepo・raw に絞る(ほかの命令に流用しない)
 */
export function createModeGit(
  folderPath: string,
  { timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS }: Pick<BaselineGitOptions, 'timeoutMs'> = {}
): Pick<SimpleGit, 'checkIsRepo' | 'raw'> {
  return simpleGit(folderPath, {
    timeout: { block: timeoutMs },
    unsafe: INHERITED_ENV_ALLOWANCES
  }).env(buildModeGitEnv(process.env))
}

/**
 * 戻す操作のコンフリクトの判定と blob の有無を問い合わせる git。リポジトリの方式は利用者の index(createRepoGit)、隠れた git は
 * 記録の git(記録のインデックスはコンフリクトのエントリを持たず、blob は隠れた git の DB にしかない)
 */
export function createRecordRepoGit(
  location: BaselineGitLocation,
  options: BaselineGitOptions = {}
): SimpleGit {
  return location.gitDir === null
    ? createRepoGit(location.folderPath, options)
    : createBaselineGit(location, options)
}

/**
 * 記録の HEAD・一覧の HEAD の比較に使う HEAD。リポジトリの方式は利用者の HEAD(コミットが無ければ null。打ち切りなどの失敗は投げる)、
 * 隠れた git は git を呼ばずに null(Git 管理外には HEAD が無く、記録中に git init・コミットしても隠れた git の記録とは関係が無い)。
 * 選択肢は打ち切りだけ(createRepoGit と同じ。利用者の git の環境のまま問い合わせ、記録の環境変数・-c は付けない)
 */
export async function readRecordHead(
  location: BaselineGitLocation,
  options: Pick<BaselineGitOptions, 'timeoutMs'> = {}
): Promise<string | null> {
  if (location.gitDir !== null) return null
  const output = await createRepoGit(location.folderPath, options).raw([
    'rev-parse',
    '--verify',
    '-q',
    'HEAD'
  ])
  return output.trim() || null
}

// 失敗の文言に添える stderr の上限(バイト)。冒頭の数行で足りる
const MAX_INPUT_GIT_STDERR_BYTES = 64 * 1024

interface SpawnGitWithInputHooks {
  /** stderr の文字列を受け取る(上限で切らずにすべて) */
  onStderr?: (text: string) => void
  /**
   * true なら出力(stdout・stderr)を受け取るたびに打ち切りのタイマーをやり直す(simple-git の timeout.block と同じ規則)。
   * 既定の false は起動からの経過した時間で打ち切る
   */
  resetTimeoutOnOutput?: boolean
}

// spawn で git を起動し、標準入力に input を渡して stdout を返す(runBaselineGitWithInput・runIsolatedGit・
// runBaselineGitDetectingUnreadablePath の共通部分)。打ち切りは timeoutMs で SIGKILL し(resetTimeoutOnOutput なら出力の
// 無いまま経った時間、既定は起動からの経過した時間)、simple-git の打ち切りと同じ判定(isGitTimeoutError)になる GitPluginError にする
function spawnGitWithInput(
  cwd: string,
  env: Record<string, string>,
  args: readonly string[],
  input: string,
  timeoutMs: number,
  config: readonly string[],
  { onStderr, resetTimeoutOnOutput = false }: SpawnGitWithInputHooks = {}
): Promise<string> {
  const configArgs = ['core.splitIndex=false', ...config].flatMap((entry) => ['-c', entry])
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (finish: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      finish()
    }
    const proc = spawn('git', [...configArgs, ...args], {
      cwd,
      env,
      // simple-git の経路と同じ。Windows で console のウィンドウを開かない
      windowsHide: true
    })
    const onTimeout = (): void => {
      proc.kill('SIGKILL')
      settle(() => reject(new GitPluginError(undefined, 'timeout', 'block timeout reached')))
    }
    let timer = setTimeout(onTimeout, timeoutMs)
    const restartTimerOnOutput = (): void => {
      if (!resetTimeoutOnOutput || settled) return
      clearTimeout(timer)
      timer = setTimeout(onTimeout, timeoutMs)
    }
    let stdout = ''
    const stdoutDecoder = new StringDecoder('utf-8')
    proc.stdout.on('data', (chunk: Buffer) => {
      restartTimerOnOutput()
      stdout += stdoutDecoder.write(chunk)
    })
    let stderr = ''
    let stderrBytes = 0
    const stderrDecoder = new StringDecoder('utf-8')
    // onStderr には上限で切らずにすべてを渡す(失敗の文言に添える stderr だけを上限で切る)
    const onStderrDecoder = new StringDecoder('utf-8')
    proc.stderr.on('data', (chunk: Buffer) => {
      restartTimerOnOutput()
      onStderr?.(onStderrDecoder.write(chunk))
      if (stderrBytes >= MAX_INPUT_GIT_STDERR_BYTES) return
      stderrBytes += chunk.length
      stderr += stderrDecoder.write(chunk)
    })
    proc.on('error', (error) => settle(() => reject(error)))
    // 起動の失敗の後の書き込みは EPIPE を stdin の 'error' として出す。ハンドラが無いと main プロセスが落ちる
    proc.stdin.on('error', (error) => settle(() => reject(error)))
    proc.on('close', (code) => {
      settle(() => {
        onStderr?.(onStderrDecoder.end())
        if (code === 0) resolve(stdout + stdoutDecoder.end())
        else reject(new Error(`git ${args[0] ?? ''} が失敗しました(${code}): ${stderr.trim()}`))
      })
    })
    proc.stdin.end(input)
  })
}

/**
 * 記録の場所 location で、標準入力に input を渡して git を実行する(simple-git は標準入力を渡せない)。
 * 環境・設定は createBaselineGit と同じ(buildBaselineGitEnv・core.splitIndex=false・windowsHide)。stdout を返す。
 * 打ち切りは timeoutMs の経過で止め、simple-git の打ち切りと同じ判定(isGitTimeoutError)になる GitPluginError にする。
 * 出力の小さい短い操作(update-index --stdin・mktree・cat-file --batch-check・for-each-ref・ls-tree・update-ref --stdin。
 * for-each-ref・ls-tree は入力を空にし、終了コード 0 以外で reject する経路として使う)に使う。
 * 出力は小さいため、出力の有無に関わらず経過した時間で打ち切る(すぐ SIGKILL する)。作業ツリーを書き換える命令には使わない
 * (隠れた git の記録のハンクの逆適用は、baselineGitSpawnEnvironment の環境で gitApply の打ち切りの規則で動かす)
 */
export function runBaselineGitWithInput(
  location: BaselineGitLocation,
  args: readonly string[],
  input: string,
  {
    timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS,
    config = [],
    env = process.env
  }: BaselineGitOptions = {}
): Promise<string> {
  return spawnGitWithInput(
    location.folderPath,
    buildBaselineGitEnv(env, location),
    args,
    input,
    timeoutMs,
    [...config, ...hiddenGitCommandConfig(location)]
  )
}

// 開けなかったフォルダの git の警告(英語の文言。git の dir.c の read_directory_recursive が opendir の失敗で出す)。
// git 2.50.1 は ENOENT のときも同じ警告を出す(実測。記録の途中でフォルダが消えたとき。ローカルレビュー第 34 周の指摘 1)
const UNREADABLE_DIRECTORY_WARNING_PREFIX = "warning: could not open directory '"

// 警告の末尾の strerror の文言のうち、読めないフォルダとしないもの。記録の途中でフォルダが消えた(ENOENT)・フォルダでなく
// なった(ENOTDIR)だけで、消えたものは記録の時点に無いため正しく記録から外れる。ほかの errno(EACCES など)は今までどおり
// 読めないフォルダとする(安全側)。英語の文言を前提にできるのは、runBaselineGitDetectingUnreadablePath が LC_ALL=C の
// 環境(buildModeGitEnv)で git を動かし、strerror の文言も英語に固定されるため
const VANISHED_DIRECTORY_ERROR_SUFFIXES: readonly string[] = [
  ': No such file or directory',
  ': Not a directory'
]

// 接頭辞の無い perror の行「<作業ツリーからの相対パス>: <権限の不足の strerror>」の末尾(EACCES・EPERM)。読める(r)が実行(x)
// できないフォルダの中の追跡済みのファイルは lstat が EACCES で失敗し、git は「d/f: Permission denied」(diff-lib の
// run_diff_files の perror。ENOENT・ENOTDIR は perror の前に除かれる)だけを出して飛ばし、exit 0 で古い内容のまま記録する
// (git 2.50.1・2.53.0 で実測。ローカルレビュー第 35 周の指摘 1)
const PERMISSION_ERROR_SUFFIXES: readonly string[] = [
  ': Permission denied',
  ': Operation not permitted'
]

// git 自身の文言の接頭辞。これの付いた行は perror の形としない。フォルダの外の大域の除外・属性のファイル(~/.config/git/ignore
// など)が読めないときの「warning: unable to access '<絶対パス>': Permission denied」(exit 0)で、どのフォルダでも記録が
// 失敗していた(ローカルレビュー第 36 周の指摘 1)。フォルダの中の読めない .gitignore・.gitattributes の同じ警告も見ない
// (add -A が記録するものは続く「error: open(...)」で exit 128 になる。ignore されて記録しないものは exit 0 だが、その中の規則が
// 効かないだけで飛ばすパスは無い。git 2.50.1 で実測)。入れ子のリポジトリの警告「warning: adding embedded git repository: <パス>」
// (advice.addEmbeddedRepo=false でも出る)も、パスの名前が権限の文言で終わっても当たらない
const GIT_MESSAGE_PREFIXES: readonly string[] = ['warning: ', 'error: ', 'fatal: ', 'hint: ']

// 絶対パス(/ で始まる、Windows のドライブ C:\・C:/ と UNC の \\ で始まる)。作業ツリーの中のパスは相対パスで出るため、
// 絶対パスの perror は作業ツリーの中の読めないパスとしない
const isAbsolutePathLine = (line: string): boolean =>
  line.startsWith('/') || line.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(line)

// stderr の 1 行が、exit 0 のまま作業ツリーの中の読めないパスを飛ばした行か(CRLF の \r は除く)。既知の 2 つの形だけを見る。
// 1. 開けなかったフォルダの警告(行の頭の文言と、末尾の errno の文言。ENOENT・ENOTDIR は除く)
// 2. 接頭辞の無い perror の形の、作業ツリーからの相対パスの権限の不足の行
const isUnreadablePathLine = (line: string): boolean => {
  const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
  if (trimmed.startsWith(UNREADABLE_DIRECTORY_WARNING_PREFIX)) {
    return !VANISHED_DIRECTORY_ERROR_SUFFIXES.some((suffix) => trimmed.endsWith(suffix))
  }
  if (GIT_MESSAGE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return false
  if (isAbsolutePathLine(trimmed)) return false
  return PERMISSION_ERROR_SUFFIXES.some((suffix) => trimmed.endsWith(suffix))
}

/**
 * 記録の場所 location で git を実行し、stdout と、stderr に読めないパスを表す行が出たかを返す。git は読めないフォルダを
 * 警告(could not open directory)だけ出して飛ばし、読める(r)が実行(x)できないフォルダの中の追跡済みのファイルを
 * 「<パス>: Permission denied」だけ出して飛ばし、どちらも exit 0 で終わる(ls-files --others・add -A)ため、終了コードでは
 * 見分けられない(ローカルレビュー第 33 周の指摘 1・第 35 周の指摘 1)。文言は翻訳されるため、環境を buildModeGitEnv で英語の
 * メッセージ(LC_ALL=C・LANGUAGE を外す)にしてから buildBaselineGitEnv で組み立てる(ほかは runBaselineGitWithInput と同じ)。
 * stderr は close までのすべてを行ごとに見る(上限で切らない。CRLF の警告などが多くても見落とさない)。末尾が ENOENT・ENOTDIR の
 * 文言の警告(途中で消えたフォルダ)は読めないパスとしない(ローカルレビュー第 34 周の指摘 1)。打ち切りは simple-git の
 * timeout.block と同じく、出力(stdout・stderr)を受け取るたびにやり直す(core.autocrlf=true では add -A が LF のファイルごとに
 * 警告を出し続けるため、起動からの経過した時間では大きな記録が打ち切られうる。ローカルレビュー第 34 周の指摘 2)
 */
export async function runBaselineGitDetectingUnreadablePath(
  location: BaselineGitLocation,
  args: readonly string[],
  {
    timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS,
    config = [],
    env = process.env
  }: BaselineGitOptions = {}
): Promise<{ stdout: string; unreadablePath: boolean }> {
  let unreadablePath = false
  let partialLine = ''
  const stdout = await spawnGitWithInput(
    location.folderPath,
    buildBaselineGitEnv(buildModeGitEnv(env), location),
    args,
    '',
    timeoutMs,
    [...config, ...hiddenGitCommandConfig(location)],
    {
      onStderr: (text) => {
        const lines = (partialLine + text).split('\n')
        partialLine = lines.pop() ?? ''
        if (lines.some(isUnreadablePathLine)) unreadablePath = true
      },
      resetTimeoutOnOutput: true
    }
  )
  if (isUnreadablePathLine(partialLine)) unreadablePath = true
  return { stdout, unreadablePath }
}

/**
 * 記録の場所 location で git を spawn するときの環境(runBaselineGitWithInput と同じ env と -c)。gitApply の runGitApply に渡し、
 * 隠れた git の記録のハンクの逆適用を、リポジトリの方式と同じ打ち切り(30 秒で SIGTERM、5 秒の猶予の後に SIGKILL)で動かす
 * (git apply は古いファイルを消してから新しいファイルを作るため、すぐ SIGKILL するとファイルが無いまま残りうる。ローカルレビュー
 * 第 9 周の指摘 1)。GIT_DIR・GIT_WORK_TREE・-c の守りは runBaselineGitWithInput と同じ
 */
export function baselineGitSpawnEnvironment(
  location: BaselineGitLocation,
  { config = [], env = process.env }: Pick<BaselineGitOptions, 'config' | 'env'> = {}
): { env: Record<string, string>; config: string[] } {
  return {
    env: buildBaselineGitEnv(env, location),
    config: ['core.splitIndex=false', ...config, ...hiddenGitCommandConfig(location)]
  }
}

/**
 * 位置の変数を足さない環境(buildIsolatedGitEnv に extraEnv を足したもの)で git を実行する。隠れた git の作成(init・config)に使う
 * (init の --template= は simple-git が allowUnsafeTemplateDir なしに拒否するため spawn で渡す)。打ち切り・失敗の扱いは
 * runBaselineGitWithInput と同じ。extraEnv は main が作った値だけを渡す(GIT_DIR に隠れた git など)
 */
export function runIsolatedGit(
  cwd: string,
  args: readonly string[],
  {
    timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS,
    config = [],
    env = process.env,
    extraEnv = {}
  }: BaselineGitOptions & { extraEnv?: Record<string, string> } = {}
): Promise<string> {
  return spawnGitWithInput(
    cwd,
    { ...buildIsolatedGitEnv(env), ...extraEnv },
    args,
    '',
    timeoutMs,
    config
  )
}

/**
 * runBaselineGitWithInput の同期の版(アプリの終了〈before-quit〉の保護の ref の削除。待たずに終わる処理にする。L-010)。
 * 終了コード 0 なら true。打ち切り(timeoutMs)・起動の失敗・0 以外の終了・spawnSync の例外は false(後始末を止めない)
 */
export function runBaselineGitWithInputSync(
  location: BaselineGitLocation,
  args: readonly string[],
  input: string,
  {
    timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS,
    config = [],
    env = process.env
  }: BaselineGitOptions = {}
): boolean {
  const configArgs = [
    'core.splitIndex=false',
    ...config,
    ...hiddenGitCommandConfig(location)
  ].flatMap((entry) => ['-c', entry])
  try {
    const result = spawnSync('git', [...configArgs, ...args], {
      cwd: location.folderPath,
      env: buildBaselineGitEnv(env, location),
      input,
      timeout: timeoutMs,
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'ignore']
    })
    return result.error === undefined && result.status === 0
  } catch {
    return false
  }
}
