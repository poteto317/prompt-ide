import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import simpleGit, { GitPluginError } from 'simple-git'
import type { SimpleGit } from 'simple-git'

// 記録のインデックス(利用者の .git/index の写しに作業ツリーを入れたもの)で問い合わせる git を作る(設計書「確認の結果」14)。
// GIT_INDEX_FILE を渡すには simple-git の env() が要るが、env() は環境変数の中身を検査し、simple-git 3.36.0
// (@simple-git/argv-parser)が拒否する変数(EDITOR・GIT_ASKPASS など)が 1 つでもあると GitPluginError を投げる
// (gitService.ts の getLog のコメントと同じ現象。VS Code から起動すると GIT_ASKPASS が引き継がれる)。拒否される変数と、
// 利用者の別のリポジトリを指しうる位置の変数を除いた環境に、記録のインデックスの GIT_INDEX_FILE を足す。
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

/** source から除く変数を外し、GIT_INDEX_FILE を indexPath にした環境(source の既定値は無い。createBaselineGit は env の既定の process.env を渡す) */
export function buildBaselineGitEnv(
  source: NodeJS.ProcessEnv,
  indexPath: string
): Record<string, string> {
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
  env.GIT_INDEX_FILE = indexPath
  return env
}

export interface BaselineGitOptions {
  /** 出力が無いまま経ったら git を止める時間(simple-git の timeout.block)。テストで短くする */
  timeoutMs?: number
  /** `git -c` で渡す設定(diff の core.quotePath=false など) */
  config?: string[]
  /** 元にする環境変数。テストで差し替える */
  env?: NodeJS.ProcessEnv
}

/** 記録のインデックス indexPath で問い合わせる git。作業ツリーは folderPath(リポジトリの最上位) */
export function createBaselineGit(
  folderPath: string,
  indexPath: string,
  {
    timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS,
    config = [],
    env = process.env
  }: BaselineGitOptions = {}
): SimpleGit {
  // 一覧・diff・戻す操作の git も記録のインデックスを(stat 情報の更新で)書き直すことがある。利用者の core.splitIndex=true が
  // 効くと、共有部分の sharedindex.<sha> が利用者の .git に作られるため、常に split 形式を使わない(最終レビュー A の I1)
  return simpleGit(folderPath, {
    timeout: { block: timeoutMs },
    config: ['core.splitIndex=false', ...config]
  }).env(buildBaselineGitEnv(env, indexPath))
}

/** 利用者の index で問い合わせる git(記録の HEAD・最上位の確認・コンフリクトの判定)。打ち切りだけを付ける */
export function createRepoGit(
  folderPath: string,
  { timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS }: Pick<BaselineGitOptions, 'timeoutMs'> = {}
): SimpleGit {
  return simpleGit(folderPath, { timeout: { block: timeoutMs } })
}

// 失敗の文言に添える stderr の上限(バイト)。冒頭の数行で足りる
const MAX_INPUT_GIT_STDERR_BYTES = 64 * 1024

/**
 * 記録のインデックス indexPath で、標準入力に input を渡して git を実行する(simple-git は標準入力を渡せない)。
 * 環境・設定は createBaselineGit と同じ(buildBaselineGitEnv・core.splitIndex=false・windowsHide)。stdout を返す。
 * 打ち切りは timeoutMs の経過で止め、simple-git の打ち切りと同じ判定(isGitTimeoutError)になる GitPluginError にする。
 * 使うのは出力の無い短い操作(update-index --stdin)だけのため、出力の有無に関わらず経過した時間で打ち切る
 */
export function runBaselineGitWithInput(
  folderPath: string,
  indexPath: string,
  args: readonly string[],
  input: string,
  {
    timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS,
    config = [],
    env = process.env
  }: BaselineGitOptions = {}
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
      cwd: folderPath,
      env: buildBaselineGitEnv(env, indexPath),
      // simple-git の経路と同じ。Windows で console のウィンドウを開かない
      windowsHide: true
    })
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      settle(() => reject(new GitPluginError(undefined, 'timeout', 'block timeout reached')))
    }, timeoutMs)
    let stdout = ''
    const stdoutDecoder = new StringDecoder('utf-8')
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += stdoutDecoder.write(chunk)
    })
    let stderr = ''
    let stderrBytes = 0
    const stderrDecoder = new StringDecoder('utf-8')
    proc.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= MAX_INPUT_GIT_STDERR_BYTES) return
      stderrBytes += chunk.length
      stderr += stderrDecoder.write(chunk)
    })
    proc.on('error', (error) => settle(() => reject(error)))
    // 起動の失敗の後の書き込みは EPIPE を stdin の 'error' として出す。ハンドラが無いと main プロセスが落ちる
    proc.stdin.on('error', (error) => settle(() => reject(error)))
    proc.on('close', (code) => {
      settle(() => {
        if (code === 0) resolve(stdout + stdoutDecoder.end())
        else reject(new Error(`git ${args[0] ?? ''} が失敗しました(${code}): ${stderr.trim()}`))
      })
    })
    proc.stdin.end(input)
  })
}
