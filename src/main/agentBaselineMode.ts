import { realpath } from 'node:fs/promises'
import type { SimpleGit } from 'simple-git'
import type { AgentChangesUnavailableReason } from '@shared/types'
import { assertBaselineGitDir } from './agentBaselineCoverage'
import type { BaselineGitLocation } from './agentBaselineGit'
import { isInsideGitDirectory } from './gitRepoDetection'
import { stripTrailingNewline } from './gitPathParsing'

// 記録の方式の決め方(設計書 2026-10-15「方式の決め方」)。フォルダと区切りの写しの元から、利用者の .git で記録するか・隠れた git で
// 記録するか・記録できないかを決める。記録の手順(agentBaselineSnapshot)から外し、方式の判定だけを偽の git で検査できるようにする。
// 依存は記録の手順 → 方式の判定の一方向(ここは記録の手順の型を参照せず、区切りの写しの元は gitDir だけを受け取る)

/**
 * 記録の方式。repository: 利用者の .git(今の手順)、hidden-new: 隠れた git を作る(Git 管理外のフォルダの累積の始点)、
 * hidden: 記録の隠れた git(その区切り)、unavailable: 記録できない
 */
export type BaselineMode =
  | { kind: 'repository' }
  | { kind: 'hidden-new' }
  | { kind: 'hidden'; gitDir: string }
  | {
      kind: 'unavailable'
      reason: Extract<
        AgentChangesUnavailableReason,
        'not-repository' | 'not-toplevel' | 'inside-git-dir'
      >
    }

// git rev-parse --show-toplevel などのパスの表記を揃える(macOS の /var → /private/var など)
const canonical = async (path: string): Promise<string> => realpath(path).catch(() => path)

/**
 * 方式を決める。base は区切りの写しの元(累積の始点は undefined。方式の判定は gitDir だけを見る)。base の gitDir が文字列(隠れた git の記録の区切り)ならフォルダを調べ直さず隠れた git にする(記録中に git init
 * されても変えない。L-041)。共有の隠れた git がリンクでないディレクトリでなければ例外(git-failed。新しく作らない。L-002・L-437)。
 * それ以外はリポジトリか・最上位かを確かめ、リポジトリの方式の区切りで Git 管理外になっていたら not-repository(隠れた git に
 * 切り替えない)。累積の始点で Git 管理外なら、.git の中・bare リポジトリでなければ隠れた git を作る。checkpoint は await のたびに呼ぶ
 */
export async function resolveBaselineMode(
  folderPath: string,
  repoGit: Pick<SimpleGit, 'checkIsRepo' | 'raw'>,
  base: Pick<BaselineGitLocation, 'gitDir'> | undefined,
  checkpoint: () => void
): Promise<BaselineMode> {
  if (base !== undefined && base.gitDir !== null) {
    await assertBaselineGitDir({ gitDir: base.gitDir })
    checkpoint()
    return { kind: 'hidden', gitDir: base.gitDir }
  }
  const isRepo = await repoGit.checkIsRepo()
  checkpoint()
  if (isRepo) {
    const toplevel = stripTrailingNewline(await repoGit.raw(['rev-parse', '--show-toplevel']))
    checkpoint()
    return (await canonical(toplevel)) === (await canonical(folderPath))
      ? { kind: 'repository' }
      : { kind: 'unavailable', reason: 'not-toplevel' }
  }
  if (base !== undefined) return { kind: 'unavailable', reason: 'not-repository' }
  const insideGitDir = await isInsideGitDirectory(repoGit)
  checkpoint()
  return insideGitDir ? { kind: 'unavailable', reason: 'inside-git-dir' } : { kind: 'hidden-new' }
}
