import { execFileSync } from 'child_process'
import { vi } from 'vitest'
import { devNull, tmpdir } from 'os'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'

// 開発者のグローバル・システムの git 設定(commit.gpgsign、core.hooksPath 等)に左右されない
// よう、テスト側で実行する git と、対象の関数(simple-git が子プロセスとして起動する git)の
// 両方から切り離す。後者は vi.stubEnv(key, value) で process.env に反映して渡す
// (パターン41)。
// GIT_DEFAULT_REF_FORMAT は ref の保存形式に依存するテスト(大文字小文字のブランチ名など)を
// 環境で揺らさないため files に固定する(git 2.45 未満はこの環境変数を無視する)
export const isolatedGitEnv = {
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_DEFAULT_REF_FORMAT: 'files',
  // git の出力の文言をロケールに依存させないため(翻訳を持つ git で LANG/LC_ALL が引き継がれると
  // 英語の出力を前提にした検証が落ちる)
  LC_ALL: 'C'
}

// フックの中から実行されたテストが、親リポジトリを操作しないよう外すリポジトリ位置の環境変数
const REPO_LOCATION_ENV_KEYS = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE'] as const

// 開発者の環境で設定されていると、git の振る舞いを変えて隔離(isolatedGitEnv の GIT_CONFIG_GLOBAL など)をすり抜ける
// 環境変数。GIT_SSH_COMMAND は core.sshCommand より優先される(偽の ssh の代わりに本物の ssh が起動する)。
// GIT_CONFIG_COUNT は設定ファイルより優先される設定を足す(GIT_CONFIG_KEY_n・VALUE_n は COUNT が無ければ読まれない
// ため、COUNT だけを外せばよい)。GIT_ALLOW_PROTOCOL は許可するプロトコルを絞る(file:// などの clone が拒否される)。
// GIT_CONFIG_PARAMETERS(`git -c` が子へ渡す設定)は、clone のテストへの影響は確認されていないが、同じく設定ファイルより
// 優先される設定を足すため、隔離の目的で外す
const GIT_BEHAVIOR_ENV_KEYS = [
  'GIT_SSH_COMMAND',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_ALLOW_PROTOCOL'
] as const

export function runGit(cwd: string, ...args: string[]): string {
  return runGitWithEnv(cwd, {}, ...args)
}

// 追加の環境変数(GIT_SEQUENCE_EDITOR 等)を渡して実行する。isolatedGitEnv は維持する
export function runGitWithEnv(
  cwd: string,
  extraEnv: Record<string, string>,
  ...args: string[]
): string {
  const env: NodeJS.ProcessEnv = { ...process.env, ...isolatedGitEnv, ...extraEnv }
  REPO_LOCATION_ENV_KEYS.forEach((key) => delete env[key])
  GIT_BEHAVIOR_ENV_KEYS.forEach((key) => delete env[key])
  return execFileSync('git', args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'ignore']
  }).toString()
}

// main ブランチで初期化し、マージコミットを作れるようリポジトリ内にコミッター情報を設定する
export function initRepo(cwd: string): void {
  runGit(cwd, 'init', '-q', '-b', 'main')
  runGit(cwd, 'config', 'user.email', 'test@example.com')
  runGit(cwd, 'config', 'user.name', 'test')
  runGit(cwd, 'config', 'commit.gpgsign', 'false')
}

export function commitAll(cwd: string, message: string): void {
  runGit(cwd, 'add', '-A')
  runGit(cwd, 'commit', '-qm', message)
}

// 対象の関数(simple-git が子プロセスとして起動する git)へ渡る process.env を切り離す。
// isolatedGitEnv の反映に加え、リポジトリ位置の環境変数と、git の振る舞いを変える環境変数を外す。beforeEach で呼び、
// afterEach で vi.unstubAllEnvs() を呼んで復元する
export function stubIsolatedGitEnv(): void {
  Object.entries(isolatedGitEnv).forEach(([key, value]) => vi.stubEnv(key, value))
  REPO_LOCATION_ENV_KEYS.forEach((key) => vi.stubEnv(key, undefined))
  GIT_BEHAVIOR_ENV_KEYS.forEach((key) => vi.stubEnv(key, undefined))
}

// 対象の関数(simple-git が起動する git)が、dir より上のリポジトリ(TMPDIR がリポジトリの中にある環境など)を
// 拾わないよう、GIT_CEILING_DIRECTORIES を dir にする。git は dir の配下から上へリポジトリを探すとき、dir とそれより
// 上には上がらない(dir の配下は従来どおり探す)。git は物理パスで比較するため、symlink を解決して渡す(macOS の
// tmpdir() は /var → /private/var の symlink の配下)。stubIsolatedGitEnv と同じく afterEach の
// vi.unstubAllEnvs() で復元する
export function stubGitCeiling(dir: string): void {
  vi.stubEnv('GIT_CEILING_DIRECTORIES', realpathSync(dir))
}

// ファイルシステムが大文字小文字を区別しないかを実測する(macOS・Windows の既定は区別しない)。
// 区別する FS では 'a' と 'A' が別物になり、大文字小文字だけ違う配置を作るテストが成り立たない
export function isCaseInsensitiveFs(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'case-probe-'))
  try {
    writeFileSync(join(probe, 'a'), '')
    return existsSync(join(probe, 'A'))
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

// リポジトリ内の相対パスへ書く(親ディレクトリは作る)/ 読む
export function writeRepoFile(repo: string, path: string, content: string): void {
  mkdirSync(join(repo, path, '..'), { recursive: true })
  writeFileSync(join(repo, path), content)
}

export function readRepoFile(repo: string, path: string): string {
  return readFileSync(join(repo, path), 'utf8')
}

// フック・偽の署名プログラムなどが pidFile の先頭に書いた PID のプロセスを止める(テストの後始末)。
// simple-git のタイムアウトは git 本体だけを止め、git が起動した子(exec した sleep など)は孤児として
// 残るため。waitMs の間は pidFile が書かれるのを待つ(git が打ち切られた直後に子が書く場合がある)。
// 書かれなければ子は起動していないとみなす。既に終わっていたプロセス(ESRCH)は無視する
export async function killRecordedProcess(pidFile: string, waitMs = 0): Promise<void> {
  const deadline = Date.now() + waitMs
  let content = existsSync(pidFile) ? readFileSync(pidFile, 'utf8').trim() : ''
  while (content === '' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    content = existsSync(pidFile) ? readFileSync(pidFile, 'utf8').trim() : ''
  }
  if (content === '') return
  const pid = Number(content.split(/\s+/)[0])
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}
