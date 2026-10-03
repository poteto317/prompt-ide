// push / pull / fetch / 初回 push で git を打ち切るまでの時間(stdout / stderr に何も出ない時間。simple-git の
// timeout プラグインの block)。main(gitRemoteTimeout の simpleGitWithRemoteTimeout)が打ち切りに使い、
// renderer(RemoteSetupBanner)が初回 push 中の案内「応答が N 秒途絶えると打ち切ります」に使う。
// 両者で別々の値を持つと、片方だけ変えても案内と実際の時間が食い違うため、ここで共有する(パターン 88)。
// 案内は秒で表すため、1000 の倍数にする(単体テストで固定)
export const GIT_REMOTE_TIMEOUT_MS = 30_000

// 初回 push 中の案内に出す秒数
export const GIT_REMOTE_TIMEOUT_SECONDS = GIT_REMOTE_TIMEOUT_MS / 1000

// clone で git を打ち切るまでの、出力(stdout / stderr)が途絶えた時間。main(gitCloneService の cloneRepository)が
// 打ち切りに使い、renderer(CloneRepositoryDialog)が実行中の案内「応答が N 秒途絶えると打ち切ります」に使う(パターン 88)。
// 合計時間の上限は設けない(巨大なリポジトリでも、進捗が出ている間は続ける)。git は標準エラーが端末でないと進捗を
// 出さないため、main は `--progress` を明示する(実機 git 2.50.1 で確認)。案内は秒で表すため、1000 の倍数にする
export const GIT_CLONE_IDLE_TIMEOUT_MS = 60_000

// clone 中の案内に出す秒数
export const GIT_CLONE_IDLE_TIMEOUT_SECONDS = GIT_CLONE_IDLE_TIMEOUT_MS / 1000
