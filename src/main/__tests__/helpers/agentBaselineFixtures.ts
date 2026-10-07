import { vi } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { takeBaselineSnapshot } from '../../agentBaselineSnapshot'
import type { BaselineSnapshot, BaselineSnapshotResult } from '../../agentBaselineSnapshot'
import { initRepo, runGit, stubGitHome, stubIsolatedGitEnv } from './realGitRepo'

// エージェントの変更の記録(agentBaselineSnapshot)を実 git で試すテストの準備と偽物を 1 か所から作る。
// 「記録のインデックスの git を開発者の設定から切り離す方法」や「記録を取る関数の呼び方」が変わったときに、
// 各テストのファイルを同じように直さずに済むようにする(SRP L3-01・L3-02)。
// realGitRepo.ts は記録に依存しない汎用の道具なので、記録に関わるものはこちらに置く

export interface AgentBaselineRepo {
  /** realpath 済みのリポジトリ(initRepo 済み)。記録・一覧は realpath のフォルダを前提にする */
  repo: string
  /** stubGitHome で HOME・XDG_CONFIG_HOME にした一時ディレクトリ */
  home: string
  /** 記録のインデックスを置く一時ディレクトリ(takeBaselineSnapshot の tempRoot) */
  tempRoot: string
}

// stubIsolatedGitEnv・一時ディレクトリ 3 つ・stubGitHome・initRepo。beforeEach で呼ぶ。
// 記録のインデックスで問い合わせる git は simple-git の env() の制限で GIT_CONFIG_GLOBAL を受け取れないため、
// stubIsolatedGitEnv に加えて stubGitHome で開発者の ~/.gitconfig から切り離す(両方が要る)。
// home・tempRoot には realpath をかけない(従来の各テストの準備のとおり)
export function createAgentBaselineRepo(prefix: string): AgentBaselineRepo {
  stubIsolatedGitEnv()
  const repo = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  const home = mkdtempSync(join(tmpdir(), `${prefix}home-`))
  const tempRoot = mkdtempSync(join(tmpdir(), `${prefix}temp-`))
  stubGitHome(home)
  initRepo(repo)
  return { repo, home, tempRoot }
}

// vi.unstubAllEnvs と 3 つのディレクトリの削除。afterEach で呼ぶ
export function disposeAgentBaselineRepo(dirs: AgentBaselineRepo): void {
  vi.unstubAllEnvs()
  for (const dir of [dirs.repo, dirs.home, dirs.tempRoot]) {
    rmSync(dir, { recursive: true, force: true })
  }
}

// 記録の結果から snapshot を取り出す。recorded でなければ例外(準備の失敗をテストの失敗として見せる)
export function recordedSnapshot(result: BaselineSnapshotResult): BaselineSnapshot {
  if (result.kind !== 'recorded') throw new Error(`記録できなかった: ${JSON.stringify(result)}`)
  return result.snapshot
}

// 記録を取る。recorded でなければ例外
export async function recordBaseline(repo: string, tempRoot: string): Promise<BaselineSnapshot> {
  return recordedSnapshot(await takeBaselineSnapshot(repo, { tempRoot }))
}

// 利用者の状態(index の更新時刻〈ナノ秒〉と内容・stash・ref・HEAD)。記録や戻す操作の前後で比べる
export function userRepoState(repo: string): unknown {
  return {
    indexMtimeNs: statSync(join(repo, '.git/index'), { bigint: true }).mtimeNs,
    index: readFileSync(join(repo, '.git/index')).toString('base64'),
    stash: runGit(repo, 'stash', 'list'),
    refs: runGit(repo, 'for-each-ref'),
    head: runGit(repo, 'rev-parse', 'HEAD')
  }
}

export interface FakeTrash {
  trash: (absolutePath: string) => Promise<void>
  /** trash に渡されたパス(渡された順) */
  trashed: string[]
}

// ゴミ箱の偽物: 移したパスを控え、実際に作業ツリーから取り除く
export function createFakeTrash(): FakeTrash {
  const trashed: string[] = []
  return {
    trashed,
    trash: async (absolutePath) => {
      trashed.push(absolutePath)
      rmSync(absolutePath, { recursive: true, force: true })
    }
  }
}

// 既定値で埋めた BaselineSnapshot。フィールドが増えても、そのフィールドに関係のないテストの偽物を直さずに済むようにする。
// indexPath は既定で `${tempDir}/index`(tempDir を上書きしたときも追従する)
export function makeBaselineSnapshot(overrides: Partial<BaselineSnapshot> = {}): BaselineSnapshot {
  const tempDir = overrides.tempDir ?? '/tmp/baseline'
  return {
    folderPath: '/repo',
    tempDir,
    indexPath: `${tempDir}/index`,
    startedAt: 0,
    head: null,
    excluded: [],
    skippedRepos: [],
    ...overrides
  }
}
