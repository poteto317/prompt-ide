import type { SimpleGit } from 'simple-git'

const HEADS_NAMESPACE = 'refs/heads/'

// HEAD が指すブランチの完全な ref 名(refs/heads/<name>)。ブランチ上にいなければ null。
// simple-git の branchLocal() の summary.detached は使わない: `git branch -v` の先頭行が `(HEAD detached at X)` /
// `(HEAD detached from X)` の形のときしか detached と認識せず、rebase 中の `(no branch, rebasing main)` や
// bisect 中の `(no branch, bisect started on main)` は current: "(no"・detached: false と解析されるため、
// rebase を edit で止めている間などに検証をすり抜けてしまう(実機で確認)。
// symbolic-ref -q HEAD はブランチ上なら `refs/heads/<name>` を返し、ブランチ上にいなければ
// (detached・rebase 中・bisect 中)終了コード 1・stderr 空で終わる。simple-git は reject せず空文字で resolve する。
// コミットの無いリポジトリでも refs/heads/<name> を返す。gitService の isOnBranch(マージ)・getBranches(疑似項目の印)と
// gitRemoteSetupService の pushSetUpstream が同じ判定を使う(パターン 55)
export async function getCurrentBranchRef(git: SimpleGit): Promise<string | null> {
  const ref = (await git.raw(['symbolic-ref', '-q', 'HEAD'])).trim()
  // HEAD が refs/heads/ 以外(refs/remotes/origin/main など)を指す状態は `git symbolic-ref HEAD <ref>` で作れる。
  // 旧実装の isOnBranch(空でなければブランチ上)では、その状態でマージするとリモート追跡 ref を更新していた。
  // ここではブランチ上にいないと扱い、マージも初回 push も拒否する(ガードが厳しくなる方向の変化)
  return ref.startsWith(HEADS_NAMESPACE) ? ref : null
}
