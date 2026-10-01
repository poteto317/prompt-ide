import { execFileSync } from 'child_process'
import { vi } from 'vitest'
import { devNull, tmpdir } from 'os'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
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
// isolatedGitEnv の反映に加え、リポジトリ位置の環境変数を外す。beforeEach で呼び、
// afterEach で vi.unstubAllEnvs() を呼んで復元する
export function stubIsolatedGitEnv(): void {
  Object.entries(isolatedGitEnv).forEach(([key, value]) => vi.stubEnv(key, value))
  REPO_LOCATION_ENV_KEYS.forEach((key) => vi.stubEnv(key, undefined))
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
