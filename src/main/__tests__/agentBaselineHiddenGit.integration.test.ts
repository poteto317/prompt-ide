import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { createHiddenGit, hiddenGitExcludeContent } from '../agentBaselineHiddenGit'
import { isGitTimeoutError } from '../gitStepErrors'
import { runGit, writeRepoFile } from './helpers/realGitRepo'
import { createAgentNonGitFolder, disposeAgentBaselineRepo } from './helpers/agentBaselineFixtures'

// 隠れた git の作成(設計書「隠れた git の作成」)が作るもの(中身・設定・info/exclude・失敗と打ち切り)を実 git で試す。
// 利用者の大域の設定は、隔離した HOME の .gitconfig に書いて試す(記録の git は GIT_CONFIG_GLOBAL を外して HOME の設定を読む。
// テストの runGit は GIT_CONFIG_GLOBAL=/dev/null のため --global は効かない)。記録の一連の操作が利用者の大域の hook・fsmonitor・
// object の形式の影響を受けないことは agentBaselineHiddenGitIsolation.integration.test.ts で、隠れた git の記録が info/exclude の
// 既定の一覧とフォルダの .gitignore に従うことは agentBaselineSnapshot.integration.test.ts の Git 管理外のフォルダの節で試す

describe('createHiddenGit(実 git)', () => {
  let home: string
  let tempDir: string
  let folder: string

  // Git 管理外のフォルダと隔離した HOME。tempDir は記録の一時ディレクトリ(takeBaselineSnapshot の mkdtemp と同じ役割)として
  // createHiddenGit に直接渡す
  beforeEach(() => {
    ;({ repo: folder, home, tempRoot: tempDir } = createAgentNonGitFolder('hidden-git-create-'))
    writeRepoFile(folder, 'a.txt', 'one\ntwo\n')
  })

  afterEach(() => disposeAgentBaselineRepo({ repo: folder, home, tempRoot: tempDir }))

  const writeGlobalConfig = (body: string): void => writeFileSync(join(home, '.gitconfig'), body)
  const configOf = (gitDir: string, key: string): string =>
    runGit(tempDir, 'config', '--file', join(gitDir, 'config'), '--get', key).trim()

  it('cwd の git に bare リポジトリを作り、HEAD・config・objects・refs と info だけを作り(hooks・description を作らない)、cwd には git のほかに何も作らない(確認の結果 1)', async () => {
    const gitDir = await createHiddenGit(tempDir)
    expect(gitDir).toBe(join(tempDir, 'git'))
    expect(readdirSync(gitDir).sort()).toEqual(['HEAD', 'config', 'info', 'objects', 'refs'])
    expect(readdirSync(tempDir)).toEqual(['git'])
    expect(configOf(gitDir, 'core.bare')).toBe('true')
  })

  it('利用者の大域の init.templateDir に hook があっても写さない(--template=)', async () => {
    const template = join(home, 'template')
    mkdirSync(join(template, 'hooks'), { recursive: true })
    writeFileSync(join(template, 'hooks', 'post-index-change'), '#!/bin/sh\n', { mode: 0o755 })
    writeGlobalConfig(`[init]\n\ttemplateDir = ${template}\n`)
    const gitDir = await createHiddenGit(tempDir)
    expect(existsSync(join(gitDir, 'hooks'))).toBe(false)
  })

  it('設定に core.fsmonitor=false・gc.auto=0・maintenance.auto=false・core.hooksPath=<gitDir>/no-hooks(作らない)・core.autocrlf=false・core.safecrlf=false・core.ignoreStat=false・core.checkStat=default・core.trustctime=true・diff.autoRefreshIndex=true を書く', async () => {
    const gitDir = await createHiddenGit(tempDir)
    expect(configOf(gitDir, 'core.fsmonitor')).toBe('false')
    expect(configOf(gitDir, 'gc.auto')).toBe('0')
    expect(configOf(gitDir, 'maintenance.auto')).toBe('false')
    expect(configOf(gitDir, 'core.hooksPath')).toBe(join(gitDir, 'no-hooks'))
    expect(configOf(gitDir, 'core.autocrlf')).toBe('false')
    expect(configOf(gitDir, 'core.safecrlf')).toBe('false')
    expect(configOf(gitDir, 'core.ignoreStat')).toBe('false')
    expect(configOf(gitDir, 'core.checkStat')).toBe('default')
    expect(configOf(gitDir, 'core.trustctime')).toBe('true')
    expect(configOf(gitDir, 'diff.autoRefreshIndex')).toBe('true')
    expect(existsSync(join(gitDir, 'no-hooks'))).toBe(false)
  })

  // ファイルシステムの性質の鍵(設計書の決めたこと「ファイルシステムの性質」)。比べる値は、大域の設定なしの init が同じ一時ディレクトリの
  // ボリュームで調べた値(書かれなければ git の既定値)。実行する環境のボリュームの性質によらず成り立つ
  describe('ファイルシステムの性質の鍵(core.symlinks・core.ignorecase・core.precomposeunicode)', () => {
    const probedOrDefault = (key: string, fallback: string): string => {
      const probe = join(tempDir, 'probe.git')
      runGit(tempDir, 'init', '-q', '--bare', '--template=', probe)
      try {
        return configOf(probe, key) || fallback
      } catch {
        return fallback
      } finally {
        rmSync(probe, { recursive: true, force: true })
      }
    }

    it('大域に設定が無ければ、init が調べた値(書かれなければ既定値)を使う', async () => {
      const expected = {
        symlinks: probedOrDefault('core.symlinks', 'true'),
        ignorecase: probedOrDefault('core.ignorecase', 'false'),
        precompose: probedOrDefault('core.precomposeunicode', 'false')
      }
      const gitDir = await createHiddenGit(tempDir)
      expect(configOf(gitDir, 'core.symlinks')).toBe(expected.symlinks)
      expect(configOf(gitDir, 'core.ignorecase')).toBe(expected.ignorecase)
      expect(configOf(gitDir, 'core.precomposeunicode')).toBe(expected.precompose)
    })

    // 大域に値がある鍵は、init が書かなければ大域の値が効いていた(ローカルレビュー第 6 周の指摘 3)
    it('大域の core.symlinks=false・core.ignorecase=true・core.precomposeunicode=true があっても、隠れた git には init が調べた値か既定値を書く(precomposeunicode は init が調べないため既定値の false)', async () => {
      const expected = {
        symlinks: probedOrDefault('core.symlinks', 'true'),
        ignorecase: probedOrDefault('core.ignorecase', 'false')
      }
      writeGlobalConfig(
        '[core]\n\tsymlinks = false\n\tignorecase = true\n\tprecomposeunicode = true\n'
      )
      const gitDir = await createHiddenGit(tempDir)
      expect(configOf(gitDir, 'core.symlinks')).toBe(expected.symlinks)
      expect(configOf(gitDir, 'core.ignorecase')).toBe(expected.ignorecase)
      expect(configOf(gitDir, 'core.precomposeunicode')).toBe('false')
    })
  })

  it('info/exclude に既定の一覧を 0600 で書き、info は 0700', async () => {
    const gitDir = await createHiddenGit(tempDir)
    const exclude = join(gitDir, 'info', 'exclude')
    expect(readFileSync(exclude, 'utf8')).toBe(hiddenGitExcludeContent())
    expect(statSync(exclude).mode & 0o777).toBe(0o600)
    expect(statSync(join(gitDir, 'info')).mode & 0o777).toBe(0o700)
  })

  it('作れなければ例外(呼び出し側が一時ディレクトリごと消して git-failed にする)', async () => {
    await expect(createHiddenGit(join(tempDir, 'missing'))).rejects.toThrow()
  })

  it('init が打ち切りの時間を超えたら、打ち切りの例外にする(呼び出し側が timeout にする)', async () => {
    const bin = join(home, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nexec sleep 5\n', { mode: 0o755 })
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
    const error = await createHiddenGit(tempDir, { timeoutMs: 300 }).catch((e: unknown) => e)
    expect(isGitTimeoutError(error)).toBe(true)
  })
})
