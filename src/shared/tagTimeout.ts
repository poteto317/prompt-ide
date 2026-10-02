// タグの作成で git を打ち切るまでの時間(stdout / stderr に何も出ない時間。simple-git の timeout プラグインの block)。
// main(gitTagService の createTag)が打ち切りに使い、renderer(CreateTagDialog)が作成中の案内「最大 N 分」に使う。
// 両者で別々の値を持つと、片方だけ変えてもテストが落ちず案内と実際の時間が食い違うため、ここで共有する
// (PR #41 の 3 周目のレビュー)。
// 署名付きの注釈付きタグでは、git tag がパスフレーズの入力(gpg の pinentry・ssh-keygen)を待っていつまでも
// 終わらないことがある(実機 git 2.50.1 で確認)。作成中のダイアログはキャンセルできないため、打ち切らないと
// アプリを再起動するまで戻れない。GUI の pinentry でパスフレーズを入力するのに足りる長さとして 120 秒にする。
// 署名しない作成・検証の git 呼び出しは一瞬で終わるため、同じ値でも影響しない。
// 案内は分で表すため、60 秒の倍数にする(単体テストで固定)
export const TAG_CREATE_TIMEOUT_MS = 120_000

// 作成中の案内に出す分数
export const TAG_CREATE_TIMEOUT_MINUTES = TAG_CREATE_TIMEOUT_MS / 60_000
