// push / pull / fetch / 初回 push で git を打ち切るまでの時間(stdout / stderr に何も出ない時間。simple-git の
// timeout プラグインの block)。main(gitRemoteTimeout の simpleGitWithRemoteTimeout)が打ち切りに使い、
// renderer(RemoteSetupBanner)が初回 push 中の案内「応答が N 秒途絶えると打ち切ります」に使う。
// 両者で別々の値を持つと、片方だけ変えても案内と実際の時間が食い違うため、ここで共有する(パターン 88)。
// 案内は秒で表すため、1000 の倍数にする(単体テストで固定)
export const GIT_REMOTE_TIMEOUT_MS = 30_000

// 初回 push 中の案内に出す秒数
export const GIT_REMOTE_TIMEOUT_SECONDS = GIT_REMOTE_TIMEOUT_MS / 1000
