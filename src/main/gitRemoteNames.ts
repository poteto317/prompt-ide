import type { SimpleGit } from 'simple-git'

// アプリが扱うリモートの名前。追加・初回 push・状態の判定は origin だけを対象にする(設計書: 名前は origin 固定)
export const ORIGIN_REMOTE = 'origin'

// `git remote` の出力に origin の行があるか。remote.origin.url が無くても remote.origin.fetch・prune・pushurl の
// どれかがあれば origin が出て、`git remote add` は already exists で失敗する(実機 git 2.50.1 で確認)。
// この判定は「追加できるか」と一致する。行末の \r は分割で落とす(パターン 27)。getGitStatus の hasOrigin と
// gitRemoteSetupService の追加・初回 push の検証が同じ判定を使う(パターン 88)
export async function hasOriginRemote(git: SimpleGit): Promise<boolean> {
  return (await listRemoteNames(git)).includes(ORIGIN_REMOTE)
}

// `git remote` の出力の名前の一覧(空行を除く)。getGitStatus はこれを 1 回だけ呼び、hasOrigin(origin の行があるか)と
// hasRemote(名前が 1 つでもあるか)を同じ出力から決める。origin 以外の名前のリモートだけを持つリポジトリ
// (git clone -o github など)では hasOrigin が偽・hasRemote が真になる(レビュー 8 周目)
export async function listRemoteNames(git: SimpleGit): Promise<string[]> {
  const output = await git.raw(['remote'])
  return output.split(/\r?\n/).filter((name) => name !== '')
}
