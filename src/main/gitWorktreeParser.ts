const BRANCH_LINE_PREFIX = 'branch refs/heads/'

// git worktree list --porcelain の出力から、いずれかの worktree(メインの作業ディレクトリ
// 自身を含む)でチェックアウト中のローカルブランチ名を集める。porcelain 形式はロケールに
// 依存しない。detached の worktree は `branch` 行を持たないため含まれない。
// Windows の git は CRLF で出力することがあるため、行末の空白(\r)を取り除いてから判定する
export function parseWorktreeBranches(output: string): Set<string> {
  return new Set(
    output
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith(BRANCH_LINE_PREFIX))
      .map((line) => line.slice(BRANCH_LINE_PREFIX.length))
  )
}
