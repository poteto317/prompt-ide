import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initRepo, runGit, runGitWithEnv, stubIsolatedGitEnv } from './realGitRepo'

// 開発者の環境変数が git の振る舞いを変えると、テストの隔離(GIT_CONFIG_GLOBAL など)をすり抜ける。
// GIT_SSH_COMMAND は core.sshCommand より、GIT_CONFIG_COUNT(と KEY_n・VALUE_n)は設定ファイルより優先され、
// GIT_ALLOW_PROTOCOL は file:// などのプロトコルを拒否させる
const BEHAVIOR_ENV: [string, Record<string, string>][] = [
  ['GIT_SSH_COMMAND', { GIT_SSH_COMMAND: '/usr/bin/true' }],
  [
    'GIT_CONFIG_COUNT',
    { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'test.probe', GIT_CONFIG_VALUE_0: 'x' }
  ],
  ['GIT_CONFIG_PARAMETERS', { GIT_CONFIG_PARAMETERS: "'test.probe'='x'" }],
  ['GIT_ALLOW_PROTOCOL', { GIT_ALLOW_PROTOCOL: 'ext' }]
]

const workDirs: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('stubIsolatedGitEnv', () => {
  it.each(BEHAVIOR_ENV)('%s を process.env から外す', (key, vars) => {
    Object.entries(vars).forEach(([name, value]) => vi.stubEnv(name, value))
    stubIsolatedGitEnv()
    expect(process.env[key]).toBeUndefined()
  })
})

describe('runGitWithEnv', () => {
  // 子プロセス(git が起動する alias のシェル)が受け取った環境変数を出力させて確かめる。alias はリポジトリの設定に
  // 書く(`git -c` で渡すと git 自身が GIT_CONFIG_PARAMETERS を設定してしまうため)
  it.each(BEHAVIOR_ENV)('%s を子プロセスの環境に渡さない', (key, vars) => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'real-git-repo-')))
    workDirs.push(repo)
    initRepo(repo)
    runGit(repo, 'config', 'alias.envdump', '!env')
    Object.entries(vars).forEach(([name, value]) => vi.stubEnv(name, value))
    const output = runGitWithEnv(repo, {}, 'envdump')
    expect(output.split('\n').some((line) => line.startsWith(`${key}=`))).toBe(false)
  })
})
