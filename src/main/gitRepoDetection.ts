import type { SimpleGit } from 'simple-git'
import { isGitTimeoutError } from './gitStepErrors'

// リポジトリの判定のうち、リポジトリの初期化(gitRemoteSetupService)とエージェントの変更の記録の方式の判定(agentBaselineMode)が共有するもの

/**
 * bare リポジトリと .git ディレクトリ(とその中)では、checkIsRepo(--is-inside-work-tree)は `false` を出力して偽になるが、
 * rev-parse --git-dir はそこで成功する(`.` や絶対パスを出力する)ため、成功なら Git のデータのフォルダと判定する。checkIsRepo が偽で
 * resolve した直後に呼び、reject はリポジトリの外(管理外・壊れた .git ファイル・HEAD の無い .git は、どれも
 * `fatal: not a git repository` で終了コード 128。実機で確認)と扱う。文言では分岐しない(パターン 18)。
 * 打ち切りだけは区別して投げる(打ち切りは「リポジトリの外」の根拠にならない)
 */
export async function isInsideGitDirectory(git: Pick<SimpleGit, 'raw'>): Promise<boolean> {
  try {
    await git.raw(['rev-parse', '--git-dir'])
    return true
  } catch (err) {
    if (isGitTimeoutError(err)) throw err
    return false
  }
}
