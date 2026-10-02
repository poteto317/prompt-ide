# リモートの管理（init・origin の追加・初回 push） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Git 管理外のフォルダを開いたとき、アプリの中だけで「リポジトリを初期化 → リモート origin を追加 → 初回 push で upstream を設定」まで進められるようにする。入力（最初のブランチ名・URL）は git の英語のエラーを見せる前に日本語で拒否し、URL は任意のコマンドを実行しうる形式（`ext::` など）を許可リストで止める。

**Architecture:** 規則は shared に置き、main と renderer が同じ判定を使う（`@shared/branchName` の `normalizeInitialBranchName`、新しい `@shared/remoteUrl` の `getRemoteUrlRuleViolation`、`@shared/remoteTimeout` の `GIT_REMOTE_TIMEOUT_MS`）。main は新しい `src/main/gitRemoteSetupService.ts` に `initRepository` / `addOrigin` / `pushSetUpstream` をまとめ（`gitService.ts` には足さない。パターン 55）、`gitService.ts` の非公開の部品（ブランチ名の検証の前半・`isOnBranch`・リモートのタイムアウト）を小さなモジュールへ切り出して両方が使う（git の失敗の変換は `gitStepErrors.ts` に置き、タグの作成も使う）。`getGitStatus` は `hasOrigin` / `upstream` / `detached` を返す。IPC `git:init` / `git:addOrigin` / `git:pushSetUpstream` → preload → `gitApi` → `useGitRemoteSetup`（初期化・追加）と `useGitRemoteOperations.pushSetUpstream`（初回 push）。UI は Git 管理外の表示（`NotRepositoryView`）の `リポジトリを初期化`、`GitRepoView` の `MergeBanner` の直後の `RemoteSetupBanner`、共通の入力ダイアログ `RemoteSetupInputDialog` とその薄い包み（`InitRepositoryDialog` / `AddRemoteDialog`）。状態と操作は `RemoteSetupPanelState` 1 つにまとめ、`remoteSetup` という 1 つの props で App → Sidebar → SourceControlPanel へ渡し、SourceControlPanel が GitRepoView と NotRepositoryView に渡す（タグの作成・マージ状態の配線に揃える）。

**Tech Stack:** Electron / React 19 / TypeScript / simple-git 3.36.0 / git 2.50.1 / Vitest 4 + Testing Library

**Spec:** [docs/superpowers/specs/2026-10-03-remote-management-design.md](../specs/2026-10-03-remote-management-design.md)

## 設計書との差分（実機 git 2.50.1・simple-git 3.36.0 で確認。実装はこちらに従う）

一時ディレクトリ（`mktemp -d`、`GIT_CONFIG_GLOBAL=/dev/null` `GIT_CONFIG_NOSYSTEM=1` `LC_ALL=C`）と、simple-git 経由の呼び出しで確認した。

各項目は、設計書へ反映済み（実装の完了後、単一責任のレビューの指摘で反映した。現在は設計書が正）。ここには実装時にこうなった経緯の記録として残す。設計書の範囲外の項目（タスクの分割・ROADMAP）は、その旨を先頭に書いた。

1. （設計書へ反映済み）**壊れた `.git` ファイル（存在しない gitdir を指す）では、`checkIsRepo()` は reject せず `false` で resolve する**（当初の設計書は「`checkIsRepo` が reject したとき（`dubious ownership` や、壊れた `.git` ファイルなど）」）。simple-git は `not a git repository` のエラーを「リポジトリではない」に読み替える。さらに、このフォルダでは `git check-ref-format --branch main` も `fatal: not a git repository: /nonexistent`（終了コード 128）で失敗する（`--branch` は `@{-1}` の解決のためにリポジトリを探す）。そのままでは名前の検証の失敗として `ブランチ名として使用できない名前です: main` と誤って表示される（統合テストで発見）。そこで `initRepository` は、git の規則の検証に失敗したとき（アプリ独自の規則は通っている場合だけ）、名前と関係の無い `check-ref-format --branch main` で git がこのフォルダで動くかを確かめ、動かなければ `リポジトリを初期化できませんでした: <detail>`（設計書の文言）にする。`checkIsRepo` が reject するのは `dubious ownership` などそれ以外の失敗だけ。`HEAD` の無い空の `.git`（失敗した init の残骸）も `false` で、正しい名前で初期化し直せることを確認した（設計書どおり）。
2. （設計書の範囲外: プランのタスクの分割）**`GitStatusResult` の型の追加は Task 2（`getGitStatus` と既存のフィクスチャの更新）で行う**（依頼のタスク分割は Task 1）。必須のフィールドを足すと、`GitStatusResult` を作る 45 か所（テストのフィクスチャ・モック）が typecheck で落ちるため、型とフィクスチャの更新を同じタスクにする。
3. （設計書へ反映済み）**`useGitRemoteOperations` の `refreshHistory` は、末尾（4 番目）の省略可能な引数にする**（当初の設計書は「`refreshHistory` を引数に足す」）。既存の呼び出し（テストの 33 か所と `useGitBranchOperations.test.ts` の 2 か所）は `(gitStatus, refreshGitStatus[, fileLock])` のため、3 番目に必須で挟むと全てを書き換えることになる。省略時は初回 push の後もステータスだけを取り直す。`useAppState` は必ず渡す（Task 8 のテストで固定）。`pushSetUpstream` は `Promise<boolean>`（実行され成功したか）を返す。成功の後のフォーカスの移動に使う。
4. （設計書へ反映済み）**成功の後のフォーカスの要求（`requestFocus`）は、フックではなく、成功を受け取った部品が出す**（当初の設計書は `remoteSetup.focusRequest` で受け渡す案だった。単一責任のレビューで設計書も更新済み）。フックの中で要求を立てると、ダイアログがまだ開いている描画で要求が処理され、フォーカスが body でないために捨てられる。部品が「ダイアログを閉じる」と「要求」を同じ描画に入れ、`SourceControlPanel` の `useRemoteSetupFocus` が描画の後（`useEffect`）に `data-remote-setup-focus="<target>"` の要素へ移す（移す先が無い・disabled・フォーカスが body でないときは何もしない。要求は 1 回だけ扱う）。（単一責任のレビューで変更）要求の state は Git 操作のフック（`useGitRemoteSetup`）・`RemoteSetupPanelState` から外し、`useRemoteSetupFocus(rootRef)` が持って `{ requestFocus }` を返す。`SourceControlPanel` が `NotRepositoryView` の `requestFocus` と `GitRepoView` の `requestRemoteSetupFocus`（→ `RemoteSetupBanner` の `requestFocus`）へ渡す。要求する側も移す先もすべて `SourceControlPanel` の配下にあり、app 全体の状態にする必要が無いため。
5. （設計書へ反映済み）**ダイアログの開閉の状態の置き場所**: `InitRepositoryDialog` は新しい `NotRepositoryView.tsx`（Git 管理外の表示）が持つ。`isRepo` が真になると `NotRepositoryView` ごと外れるので、開いたままの状態が別のフォルダへ持ち越されない。代わりに、ダイアログを開いている間に別のプロセスが先に `git init` した場合は、失敗（`このフォルダは既に…`）がダイアログごと消え、パネルはリポジトリの表示に変わる（結果としてリポジトリはある）。`AddRemoteDialog` は `RemoteSetupBanner` の最上位が持ち、バナーの種類が変わってもダイアログを出し続ける（別のプロセスが先に origin を追加した場合も `リモート origin は既に設定されています` を見せる）。フォルダの切り替えでは `GitRepoView` ごと外れて状態が消える。
6. （設計書へ反映済み）**設計書で未規定だった文言を確定する**（Global Constraints）: ダイアログの見出し・ボタン（`初期化` / `初期化中...`、`追加` / `追加中...`）、初期化ダイアログ内の検証の文言（ブランチの作成ダイアログと同じ `名前を入力してください` など）、初回 push のボタンの実行中の `aria-label`（`push 中`）。
7. （設計書へ反映済み）**URL の規則を 2 点だけ厳しくする**: (a) `https://` など 4 つのスキームで、`://` の後の部分（authority）が `-` で始まるものも拒否する（`ssh://-l@host/a` の user 部分。当初の設計書はホスト名だけ）。(b) 制御文字に C1（U+0080〜U+009F）も含める（Task 1 のレビューの持ち越しで、不可視の書式文字 `\p{Cf}` も含めた）。どちらも許可リストを狭める側の変更。
8. （設計書へ反映済み）**`RemoteSetupPanelState` には、`useGitRemoteOperations` から `isSettingUpstream` / `isPushing` / `isPushBlocked` / `remoteOperationError` / `pushSetUpstream` も入れる**（`useAppState` で合成する）。バナーのボタンの disabled（push 中・pull 中・ロック中）と、案内を「実行中かつエラーなし」のときだけ出す判定（パターン 87）に使う。
9. （設計書へ反映済み）**`pushSetUpstream` の事前検証の git 呼び出しも、30 秒の打ち切り付きの simple-git で行い**、reject は `初回 push に失敗しました: <detail>`、打ち切りは既存の `操作がタイムアウトしました。…` にする（英語の GitError をそのまま見せない。パターン 74）。upstream が既にあるかの判定は `git for-each-ref --format=%(upstream:short) refs/heads/<b>` で行い、出力（例 `origin/main`）をそのまま文言の「短い名前」に使う（当初の設計書の `%(upstream)` は完全な ref 名になるため）。
10. （設計書へ反映済み）**init・追加の 30 秒は main の定数 `REMOTE_SETUP_LOCAL_TIMEOUT_MS`（`gitRemoteSetupService.ts`）にし、第 3 引数で差し替えられる形にする**（パターン 84。テストで実時間を待たない）。`addOrigin` の第 4 引数 `windowsPaths` の既定は `process.platform === 'win32'`。IPC ハンドラは renderer からの余分な引数をこれらに渡さない（`(allowedFolder, value)` だけで呼ぶことを Task 5 のテストで固定する）。
11. （設計書へ反映済み）**`hasOrigin` の判定（`git remote` に `origin` の行があるか）は `src/main/gitRemoteNames.ts`（新規）の `hasOriginRemote` にまとめ、`getGitStatus` と `gitRemoteSetupService` が使う**（パターン 88）。
12. （設計書へ反映済み）**`initRepository` の作成の確認は `getCurrentBranchRef`（`symbolic-ref -q HEAD`）で行う**（当初の設計書は `git symbolic-ref HEAD`）。切り出した部品を使うだけで、確認の内容（`refs/heads/<name>` と一致）は同じ。`getCurrentBranchRef` は `refs/heads/` で始まらない値も `null` にする（HEAD がブランチ以外の ref を指す状態は `git symbolic-ref HEAD refs/remotes/origin/main` などで作れる。旧実装の `isOnBranch` は空でなければブランチ上と扱い、その状態でマージするとリモート追跡 ref を更新していた。新実装はブランチ上にいないと扱って拒否する。ガードが厳しくなる方向の変化）。
13. （設計書へ反映済み）**統合テストは `GIT_CEILING_DIRECTORIES` に一時ディレクトリ（またはその親）を入れる**（ヘルパ `stubGitCeiling`。symlink を解決して渡す）。開発者の `TMPDIR` がリポジトリの中にあっても、`checkIsRepo` が親を拾ってテストが揺れないようにする（パターン 46）。simple-git の blockUnsafeOperationsPlugin はこの環境変数を止めないことを確認した。
14. （設計書の範囲外: 設計書の「ドキュメント」どおり。ROADMAP に追記済み）**ROADMAP**: プラン作成の時点では、このブランチの `ROADMAP.md` は実装済み・見送り項目は更新済みだったが、設計書の「ドキュメント」が求める既知の制約 2 件（「upstream の無いブランチでのツールバーの push は英語のエラーのまま」「初回 push が non-fast-forward で拒否されたときはアプリから pull できない」）が無かった。Task 9 では ROADMAP を変更しない方針だった（確認のみの指示のため）。その後、2 件とも `ROADMAP.md` の「改善・技術的負債」に未実装の項目として追記済み（「upstream の無いブランチでツールバーの「プッシュ」を押すと…」「初回 push がリモートの同名ブランチとの non-fast-forward で拒否されると…」）。
15. （設計書へ反映済み）**`initRepository` の「既にリポジトリか」は、`checkIsRepo()` に加えて `git rev-parse --git-dir` の成功でも判定する**（Task 4 のレビューで追加）。bare リポジトリと `.git` ディレクトリ（とその中のフォルダ）では、`--is-inside-work-tree` は `false` を出力して `checkIsRepo()` が偽になり、そのまま `git init` すると成功して中に `.git` が作られる（`git init --bare b` の後の `b/.git`、`r/.git/.git`。実機で確認）。`rev-parse --git-dir` はそこで成功し（`.` や絶対パス）、管理外のフォルダ・壊れた `.git` ファイル・`HEAD` の無い `.git`（失敗した init の残骸）では `fatal: not a git repository`（終了コード 128）で失敗する（実機で確認）。`checkIsRepo()` が偽で resolve した直後に呼ぶので、reject は「リポジトリの外」と扱い（文言では分岐しない。パターン 18）、打ち切りだけは区別して `リポジトリの初期化が時間内に終わりませんでした` にする。拒否の文言は既存の `このフォルダは既に Git リポジトリ（または親フォルダのリポジトリ）の中にあります`。差分 1・12 の扱い（壊れた `.git` ファイルは初期化の失敗、失敗した init の残骸は初期化し直せる、作成の確認は `getCurrentBranchRef`）は変わらない。`getGitStatus` は変えない（既知の制約。設計書）。
16. （設計書へ反映済み）**`pushSetUpstream` は、push の前に `git config --get branch.<b>.remote` / `branch.<b>.merge` も確かめ、どちらかがあれば上書きせずに拒否する**（Task 4 のレビューで追加）。`%(upstream:short)` は、削除済みの remote や fetch の refspec の無い remote を指す upstream を空にするため、`-u` が既存の設定を黙って `origin` / `refs/heads/<b>` に上書きしていた（`branch.main.remote=ghost`・`branch.main.merge=refs/heads/feature` で再現）。文言は `upstream の設定が既にあるため、初回 push できません（設定先のリモートが無いか、fetch の設定が無いため表示されていません）`。ブランチ名の `.`・`/`・`"`・`#`・日本語はキーのサブセクションにそのまま入り、大文字・小文字は区別される（実機で確認）。
17. （設計書へ反映済み）**フォルダが存在しない（開いた後に削除・移動された）とき、3 関数は `フォルダが見つかりません: <path>` で失敗する**（Task 4 のレビューで追加）。`simpleGit()` は生成の時点で英語の `GitConstructError`（`Cannot use simple-git on a directory that does not exist`）を同期的に投げる（パターン 74）。`gitService.ts` の既存の関数は同じ作りのまま変えない。
18. （設計書へ反映済み）**初期化・初回 push の後の取り直し（ステータスと履歴）は `Promise.allSettled` で両方の完了を待つ**（Task 6 のレビューで追加。パターン 73）。`Promise.all` では、履歴の取り直しが先に reject した時点で共有ランナー（`useRunExclusiveGitOperation`）の実行中フラグが下り、ステータスの取り直し前の表示（Git 管理外・upstream 未設定）のまま、もう一度押せた。`refreshGitStatus` の reject も呼び出し側へ伝えない: 共有ランナーは取り直しの失敗を握りつぶし（`useGitTagOperations` の履歴の再取得、`useGitRemoteOperations` の push 後の `refreshGitStatus` と同じ）、`Promise.all` のときも操作の結果（戻り値・エラー）は変わっていなかったため、挙動は変えずに「取り直しの失敗で成功を失敗にしない」（パターン 52）をテストで固定する。

19. （設計書へ反映済み）**コードレビューの指摘 4 件**（実装の完了後。実機 git 2.50.1 で確認）: (a) `remote add` が `.git/config.lock` の残り（クラッシュ後・`addOrigin` の同時実行）で失敗すると、git は `fatal: could not set 'remote.origin.url' to '<url>'` と URL を資格情報ごと出していた。`addOrigin` の失敗の詳細は `redactCredentials`（`gitStepErrors.ts`。`://` の後の userinfo と、語の先頭の `user@`（scp 形式・ホスト名として出た `user:pass@host`）を `***@` に伏せる）を通してから添える。`toStepError` の第 4 引数 `redact`（既定は恒等）で渡し、タグ・push などの他の呼び出し元は変えない。https の push の失敗は git が資格情報を伏せる（`unable to access 'https://127.0.0.1:1/a/b.git/'`）。(b) `git://` は userinfo を許可しない（git は `user:pass@host` 全体をホスト名として扱い、`unable to look up alice:s3cret@127.0.0.1:19418` と資格情報を出す。`git://alice@host` も同じ）。(c) オーバーレイは、押したのも離したのもオーバーレイ自体のときだけ閉じる（`useOverlayDismiss`。入力欄で押してオーバーレイで離すと Chromium は共通の祖先へ click を送るため、閉じて入力が消えていた）。`CreateTagDialog` も同じ。(d) 初期化の成功の後は `dialog.close()`（戻す予約あり）で閉じる。通常はリポジトリの表示に切り替わって `NotRepositoryView` ごと外れ予約は捨てられるが、ステータスの取り直しが失敗して Git 管理外のままなら、フォーカスを body に落とさず「リポジトリを初期化」へ戻す。
20. （設計書へ反映済み）**コードレビュー 2 周目の指摘 3 件**（実機 git 2.50.1 で確認）: (a) `pushSetUpstream` の失敗の詳細も `redactCredentials` を通す。`ssh://u:pw@github.com/x/y.git` と scp 形式の `tok123@github.com:x/y.git` では、ssh 自身が `u:pw@github.com: Permission denied (publickey).` と接続先を資格情報ごと出し、git はそのまま流していた（https・http は git が取り除く）。統合テストは `core.sshCommand` の偽の ssh（接続先を ssh と同じ形で出して終了コード 255）で、ネットワークに出ずに確かめる。既存の push / pull / fetch（`toRemoteOperationError`）も同じく伏せないが、既存の機能の問題として変えない（設計書の「既知の制約」）。(b) `useOverlayDismiss` は `mouseup` の target も記録し、押したのも離したのもオーバーレイ自体のときだけ閉じる。オーバーレイで押してダイアログの中で離しても、click の target は共通の祖先（オーバーレイ）になり（Electron の `sendInputEvent` で確認）、閉じて入力が消えていた。記録は click ごとに捨てる。(c) URL の検証（`invalid-char`）で引用符（`'` `"` `` ` ``）を拒否する。`redactCredentials` は引用符を区切りに使うため、`could not set 'remote.origin.url' to 'https://u:p'ss@h/r'` は `https://u:p'***@h/r'` になり、パスワードの一部が残っていた。文言・判定の順序は変えない。
21. （設計書へ反映済み）**コードレビュー 3 周目の指摘 2 件**（実機 git 2.50.1 で確認）: (a) パスワードに `@` を含む `ssh://u:p@ss@127.0.0.1/r` は検証を通り（ホスト名は最後の `@` の後）、初回 push で ssh が `u:p@ss@127.0.0.1: Permission denied (publickey).` と出すと、`redactCredentials` の scp 形式のパターン（語の先頭から最初の `@` まで）が `***@ss@127.0.0.1: …` にしてパスワードの一部（`ss`）を残していた（レビュアーが実機の sshd で再現）。防御を 2 層にする（パターン 59）: `isNetworkUrl` で authority の `@` を 1 個までに制限し（違反は `unsupported`。判定の順序・文言は変えない。パスワードの `@` は `%40` と書く。path の `@` は数えない）、`SCP_USERINFO_PATTERN` を語の中の最後の `@` まで伏せる貪欲な形（`/(^|[\s'"`])[^\s/'"`]+@(?=[^@\s/'"`])/g`）にする。マスクの側が必須: git は `%40`を`@`に戻して ssh に渡すため、検証を通る`ssh://u:p%40ss@h/r`でも ssh は`u:p@ss@h: Permission denied (publickey).`と出す（実機 git 2.50.1 と偽の ssh で確認）。テストは shared の許可・拒否の例と、gitStepErrors の性質テスト（検証を通る userinfo 付きの URL を組み合わせで作り、ssh・git の典型的な失敗の文言 5 種に埋め込んで（ssh の文言には`%40` を戻した形）、資格情報が残らないこと）。(b) 引用符を含むパス（`/repos/O'Brien/b.git`）の拒否の文言が `URL に空白・改行・制御文字は使用できません`で、入力に空白も制御文字も無いため理由が伝わらなかった。文言を `` URL に空白・改行・制御文字・引用符（' "`）は使用できません ``にする（main の`REMOTE_URL_RULE_MESSAGES` と renderer の表の両方。表を各側で持つ作りは変えない。パターン 88）。拒否そのものは既知の制約のまま。
22. （設計書へ反映済み）**コードレビュー 4 周目の指摘 2 件**（実機 git 2.50.1 で確認）: (a) git は `ssh://` の userinfo の `%XX` を `%40` に限らずすべて元の文字に戻してから ssh に渡していた（`core.sshCommand` の偽の ssh で引数を記録して確認: `ssh://u:p%20ss@h/r` → `[u:p ss@h]`、`%27` → `[u:p'ss@h]`、`%0A` → 改行入り、`%2F` → `[u:p]` と path `/ss@h/r` に分かれる。`%252F` は `[u:p%2Fss@h]`）。`git ls-remote 'ssh://alice:s3cr%2Fet@nohost.invalid/r'` は実 ssh で `ssh: Could not resolve hostname alice:s3cr: …` と出し、`@` が無いため `redactCredentials` も伏せず、資格情報の前半がそのまま出ていた。この URL は検証を通っていた。`isNetworkUrl` で、ssh:// の authority の userinfo（最後の `@` より前）を `decodeURIComponent` した結果に `hasInvalidChar`（空白・制御文字・引用符）または `/` `\` があれば `unsupported` にする（`isSafeSshUserinfo`。判定の順序・文言は変えない）。不正なエンコード（`%`・`%G1`・不完全な UTF-8 の `%C3`）は例外になるため拒否する。`%40` `%3A` `%25` と二重エンコード（`%252F`）は通す。`@` の個数は従来どおり decode 前の文字列で数える。userinfo でない場所（path・query・host）の `%2F` は対象にしない。https/http は対象にしない: curl が userinfo を decode して扱い、git は失敗の文言から資格情報を除く（`unable to access 'https://nohost.invalid/r/'`・`repository 'http://127.0.0.1:…/r/' not found`。`%2F` `%20` `%27` `%22` `%5C` で確認）。`%0A` だけは `warning: url contains a newline in its password component: http://alice:s3%20c%27r%0Aet@…` とエンコードされたままの URL を出すが、区切り文字（空白・引用符・`/`）を含まない形のため `redactCredentials` の `://…@` のパターンが伏せる。scp 形式は `%XX` を decode しない（`al%2Fice@h:r` は ssh へ `al%2Fice@h` のまま渡る）。(b) `SCP_USERINFO_PATTERN` は `@` を含むブランチ名や、scp 形式で path に `@` がある URL を伏せすぎる（`' ! [rejected] me@fix -> me@fix'` → `' ! [rejected] ***@fix -> ***@fix'`、`'git@host:a@b.git'` → `'***@b.git'`）。秘密は漏れない方向の誤差のためコードは変えず、設計書の既知の制約に記す。
23. （設計書へ反映済み）**コードレビュー 5 周目の指摘 1 件**（実機 git 2.50.1 と偽の ssh で確認）: パスワードに生の `/` を含む URL（AWS CodeCommit の HTTPS 用パスワードのように `/` を含む資格情報は現実にある）が許可リストを通り、初回 push の失敗の文言にパスワードの前半が出ていた。`isNetworkUrl` は authority を最初の `/` で切るため、`https://user:pa/ss@nohost.invalid/r` の authority は `user:pa` になり、`@` が無いのでホスト名の検査も ssh の userinfo の検査（差分 22）も素通りしていた（`ssh://` `git://` も同じ。3 つとも `getRemoteUrlRuleViolation` が `null`）。git は https では `fatal: unable to access 'https://user:pa/ss@nohost.invalid/r/': URL rejected: Port number was not a decimal number between 0 and 65535`（userinfo を取り除かない）、ssh では ssh の引数が `user:pa` と path `/ss@nohost.invalid/r` に分かれて `ssh: Could not resolve hostname user:pa: …`、git:// では `unable to look up user:pa (port 9418)` と出し、`/` が区切りになるため `redactCredentials` も伏せない。`isNetworkUrl` で authority の `@` より後（`host[:port]`）の構造を `HOST_PORT_PATTERN`（`/^(?:\[[0-9A-Fa-f:.]+\]|[^:[\]]+)(?::[0-9]*)?$/`）で確かめる: host は `[IPv6]`（括弧の中は 16 進数・`:`・`.` だけ）か、`:` と角括弧を含まない名前（reg-name・IPv4。IDN の全角は従来どおり通す）、port は数字だけ（空も可）。`user:pa` は `:` の後が数字でないため `unsupported` になる（判定の順序・文言は変えない）。空の port（`host:`）は git が既定のポートとして扱う（https・ssh・git:// とも実機で確認）ため許可する。port の範囲（`:0`・`:99999`）は確かめない: git は範囲外で `URL rejected: Port number…` と失敗するだけで資格情報を出さない（実機で確認）。従来の `authority !== ''` と `host !== ''` は `HOST_PORT_PATTERN` の host の 1 文字以上に含まれる。マスクの側（`redactCredentials`）は変えない: `://` から最後の `@` まで `/` を越えて伏せる貪欲な形を試したが、`fatal: repository 'https://host/a@b/' not found` が `https://***@b/` になってホストを消す（過剰なマスク）ため、検証で防ぐ層に任せる（理由を `URL_USERINFO_PATTERN` のコメントに記す）。性質の確認（scratchpad）: https・http・ssh・git:// の userinfo に `/` `:` `?` `#` と `%2F` `%3A` `%3F` `%23` を 1〜2 個含む 864 通り（port なし・`:22`・`:`）を作り、検証を通った 462 通りを実 git の push（偽の ssh・存在しないホスト）で失敗させ、文言を `redactCredentials` に通すと秘密は 1 件も残らない（伏せる前に秘密を含んでいたのは 126 件）。拒否された 402 通りのうち生の `/` を含み `%2F` を含まない https・http・ssh の 126 通りは、伏せた後も 126 件すべてに秘密が残る（拒否が必須）。パスワードに `/` を含む利用者は、https では `%2F` と書く（git が失敗の文言から除く）。ssh:// では `%2F` も拒否する（差分 22）ため、資格情報を URL に含めず ssh の設定・鍵を使う（設計書の既知の制約）。
24. （設計書へ反映済み）**資格情報の扱いを、個別の穴塞ぎから「パスワード入りの URL を構造的に拒否する」方式に切り替えた（利用者の決定）**。経緯: コードレビューの 6 周で毎回、userinfo（`user:pass@`）の区切り方の解釈違いで資格情報が漏れる穴が見つかった（remote add の失敗の文言・`ssh://` の `user:pw@`・`@` を含むパスワード・`%XX` の decode・`git://` の userinfo・引用符・userinfo の生の `/`（6 周目: パスワードが数字か空で始まる `https://alice:1234/s3cret@h/r`・`https://alice:/s3cret@h/r` は authority が `alice:1234`・`alice:` になり、port が数字（空）のため差分 23 の `HOST_PORT_PATTERN` を通る。`:` の無いトークンだけの `https://ghp_tok/en@h/r` も通る）・userinfo の `?` `#`（`https://h#sec@h2/r`））。個別に塞ぐ方式は終わりが見えないため、利用者に選択肢を示し（AskUserQuestion）、「パスワード入りの URL を拒否する」が選ばれた。判断: (1) http・https・git:// は authority に `@` があれば拒否する（user だけ・トークンだけも秘密になりうる。認証は credential helper に任せる）。(2) `ssh://` の userinfo はパスワード無しのユーザー名（`[A-Za-z0-9._~+-]+`、先頭は `-` でない）だけ。`:`・`%`・空は拒否する。(3) authority は最初の `/` `?` `#` までとし、`/` 以外で終わる形を拒否する。(4) path・query・fragment の `@` と `%40` はすべてのスキームで拒否する（authority の取り方の解釈違いを根絶する。正当な URL の path の `@` は稀なため既知の制約にする）。指示では「authority に `@` が無いときの path の `@`」だったが、ssh の user ありの path の `@` も同じく拒否する形に揃えた（スキーム・userinfo の有無で規則を分けない）。(5) authority の `%XX` は host も含めて拒否する（実装中に実機で確認: git は `ssh://` と `git://` の URL 全体を decode してから host と path を分けるため、`ssh://alice%3Apw%40h/r` は ssh に `alice:pw@h` が渡り、`ssh://git@h%2Fx/r` は host が `h` になる。従来の規則は host の `%` を見ておらず、前者を通していた）。(6) scp 形式の user は ssh と同じ文字種に絞り、path の `@` も拒否する（性質テストで検出: `Ua1@Ub2:Pa3@h.example:a/b.git` は user `Ua1@Ub2`・パスワード `Pa3` のつもりでも git は host を `Ub2` と解釈し、`could not set 'remote.origin.url' to '…'` の文言に `Pa3` が残る）。構造: 解析は `parseNetworkUrl(url): { scheme, userinfo, host, port, pathAndAfter } | null` の 1 か所にまとめ、`isAllowedNetworkUrl` はそこから派生する（判定の分散が穴の温床だった。パターン 88）。`isSafeSshUserinfo`・`PATH_SEPARATOR_PATTERN` は不要になり削除した。判定の順序・違反の種類・文言は変えない。マスク（`redactCredentials`）は変えない（防御の 2 層。端末で追加した origin への初回 push の文言と、検証の取りこぼしに備える。前提を `gitStepErrors.ts` のコメントに記す）。性質テスト（scratchpad）: http・https・ssh・git:// × user（無し・空・素の名前・19 種の区切り `/ ? # @ : %40 %2F %3A %25 %20 %3F %23 . - + ~ _ !` を挟んだ 2 断片）× パスワード（無し・空・素・区切りを挟んだ 2 断片・数字で始まる 2 断片）× host（名前・IPv4・`[::1]`・`:22`・`:`・`-x`）× path（`@`・`%40`・`?`・`#` を含む 8 通り）と scp 形式で 168,087 件を作り、検証を通った 117 件（ssh の素のユーザー名 70・userinfo 無しの各スキーム 40・scp の素の user 7）を `Permission denied (publickey)`・`Could not resolve hostname`・`unable to access`・`could not set 'remote.origin.url'`・`unable to look up` の文言（URL そのまま・git が decode した形・最初の `/` で切った接続先）に埋め込んで `redactCredentials` に通すと、パスワード・トークン・user の断片は 0 件（ssh のユーザー名を除く）。scp の path の `@` を拒否する前は、scp のパスワード入りの 120 件が通り 924 件の文言に断片が残っていた。テストの更新: 以前「許可」だった `https://alice:ghp_TOKEN@github.com/a/b.git`・`http://alice@example.com/a.git`・`ssh://alice:pw@host/a.git`・`https://u:p%40ss@h/`・`ssh://u:p%40ss@host/a.git`・`ssh://u:p%3Ass@h/r`・`ssh://u:p%25ss@h/r`・`ssh://u:p%252Fss@h/r`・`ssh://u:p%C3%A9ss@h/r`・`ssh://h/a@b`・`https://h/a@b@c`・`ssh://h%2Fx/r`・`https://alice:s3cr%2Fet@h/r`・`http://u:p%20ss@h/r`・`https://user:pw@host:443/r`・`ssh://u:p@h/r` は拒否に直した（`%XX` の decode を前提にした許可は意味を失った）。統合の「config.lock が残っていて失敗しても…」は、検証を通る `tok123@github.com:a/b.git` で scp の user が伏せられることを確かめる形にした。gitStepErrors の組み合わせのテストは「検証はパスワード入りの URL をすべて拒否し、ssh:// のユーザー名だけを通す」に直した。
25. （設計書へ反映済み）**コードレビュー 7 周目の指摘 2 件（Minor）**: (a) `unsupported` の文言が許可する形の一覧だけで、資格情報入りの URL（`https://user:pw@host/…`・Azure DevOps の `https://org@dev.azure.com/…`）を貼った利用者に拒否の理由も credential helper のことも伝わらなかった。違反の種類（`unsupported`）と判定の順序は変えず、main（`REMOTE_URL_RULE_MESSAGES`）と renderer（`REMOTE_URL_RULE_VIOLATION_MESSAGES`）の表の文言を一字一句同じ `使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）` にした（既存の一覧の後ろに続ける。各側で表を持つのはパターン 88 のまま）。main の addOrigin の単体（7 件）・renderer の `validateRemoteUrl`（8 件）・`AddRemoteDialog` の表示（1 件）の期待文言を更新した（統合は `REMOTE_URL_RULE_MESSAGES.unsupported` を参照するため変更なし）。(b) Azure DevOps の「Clone」が出す `https://org@dev.azure.com/org/proj/_git/repo` は userinfo が `org` と解析され `unsupported` で拒否されること、`org@` を外した `https://dev.azure.com/org/proj/_git/repo` は通ること（認証は credential helper）が設計書に無かった。設計書の既知の制約に書き足し、shared の remoteUrl.test.ts に実在のホスティングサービスの URL の代表（Azure の 2 形と ssh、GitHub・GitLab・Bitbucket・CodeCommit の https、`ssh://git@host` 形、scp 形式。Bitbucket の `user@` 入りの https は拒否）の許可/拒否をまとめた `it.each`（12 件）を足した（判定は変えない）。テスト仕様書に RMT-045 を足した
26. （設計書へ反映済み）**コードレビュー 8 周目の指摘 1 件（Minor・既存の利用者に事実と違う表示が出る退行）**: `origin` 以外の名前のリモートだけを持つリポジトリ（`git clone -o github <bare> c`）では、`getGitStatus` が `hasOrigin: false`・`upstream: 'github/main'` を返し、`getRemoteSetupState` が `'no-origin'` を返して、閉じられない `リモートが未設定です` が出続けていた（実 git で再現）。ツールバーの既存の push / pull は普通に動く状態で、`リモートを追加` を押すと 2 つ目のリモートとして origin が足される。判断: (i) バナーの側で「`upstream` が設定済みならリモートがある」とみなす小さい代替は、同じリポジトリで `git switch -c feat` した新しいブランチ（`upstream=null`・`hasOrigin=false`）で誤判定が残る（実 git で確認）。(ii) そのため `GitStatusResult` に `hasRemote: boolean`（`git remote` の出力に行が 1 つでもあるか）を足した。`git remote` は従来どおり 1 回だけ呼び、新しい `listRemoteNames(git): Promise<string[]>`（`gitRemoteNames.ts`。行ごとに分け、`\r` と空行を落とす）の結果から `hasOrigin`（`origin` を含むか）と `hasRemote`（空でないか）を決める。`hasOriginRemote` も `listRemoteNames` で判定する（`addOrigin`・`pushSetUpstream` の事前検証の意味は変えない）。`getRemoteSetupState` は `!hasRemote` で `no-origin`、`hasRemote` かつ `!hasOrigin` では何も出さない（初回 push は origin 固定で `リモート origin が未設定のため…` と拒否されるため、`upstream` の無いブランチでも `no-upstream` を出さない）。フィクスチャ: `GitStatusResult` を作っている既存のテスト 22 ファイル・53 か所の `hasOrigin: <値>` の隣に同じ値の `hasRemote` を足した（`RemoteSetupFlow.test.tsx` を含む。typecheck が漏れを示す）。テスト: main の単体（`listRemoteNames` 6 件・`getGitStatus` の `hasOrigin`/`hasRemote` 4 件）と統合（リモート無し・origin だけ・origin と別名・`git clone -o github` とその上の新しいブランチ）、`remoteSetupState` の全組み合わせ（リモートの有無 3 × ブランチの位置 3 × `upstream` の有無 2 = 18 件）と origin 以外だけの 2 行、`SourceControlPanel` の結合（origin 以外だけなら `upstream` の有無によらずバナーを出さない 2 件）。変異は Task 2 の 7・8 と Task 6 の 2 の下の 2 項目を参照。

設計書の仮定のうち、次は実機で確認でき、そのまま採用する。

- `git init --initial-branch=<name>` は `HEAD`・`-x`・`@`・`refs/heads/foo` を通し（`refs/heads/HEAD` などができる）、`a..b`・`main.lock`・`@{-1}` は `fatal: invalid initial branch name` で失敗して `HEAD` の無い `.git`（config・description・hooks・info・refs）を残す。既存のリポジトリでは `Reinitialized existing Git repository` で終了コード 0、`--initial-branch` は無視される。
- `git check-ref-format --branch` はリポジトリの外でも動き、`HEAD`・`-x`・`a..b`・`@{-1}`・`main.lock`・`main/`・`' main'` を GitError（reject）で拒否し、`@`・`refs/heads/foo`・`feat/x`・`日本語` を通す。NFD の名前は NFD のまま出力し、`git init --initial-branch=<NFD>` は `refs/heads/<NFD>` を作る（入口で NFC にそろえる理由。パターン 83）。
- simple-git の `raw(['remote', 'add', '--', 'origin', <url>])` は `ext::sh -c x`・`fd::3`・`--upload-pack=x`・`-x` をそのまま追加する（simple-git は止めない）。`remote add` は通信せず、到達できない URL でも 60ms 前後で終わる。改行を含む URL も追加される。
- simple-git の progress プラグインは `raw(['push', ...])` の末尾に `--progress` を足す。`push --set-upstream origin -- main` は `src refspec --progress does not match any` で失敗し、`refs/heads/<b>:refs/heads/<b>` なら成功する。同名のタグがあると `push -u origin main` は `src refspec main matches more than one` で失敗し、完全な refspec なら成功する。`-x` のブランチも完全な refspec で送れる。
- 完全な refspec の初回 push は `push.default=nothing`・`remote.origin.push=refs/heads/dev:refs/heads/elsewhere` があっても、そのブランチを同じ名前で送り、`branch.<b>.remote=origin`・`branch.<b>.merge=refs/heads/<b>` を設定する。non-fast-forward では `! [rejected] main -> main (fetch first)` で失敗し、`branch.<b>.remote` は設定されない。コミットが無いと `src refspec refs/heads/main does not match any`。
- `remote.origin.fetch` の無い origin（`remote.origin.url` だけ）へ初回 push すると、`branch.<b>.remote` / `merge` は設定されるが、`status.tracking` と `for-each-ref %(upstream)` は空のまま。
- simple-git の `status()`: upstream 設定済みは `tracking: 'origin/main'`、リモートの ref が消えた gone も `origin/main`、ローカルのブランチが upstream なら `main`、detached HEAD とリベースで止めている間は `current: 'HEAD'`・`tracking: null`・`detached: true`、コミットの無いリポジトリは `current: 'main'`・`tracking: null`・`detached: false`。
- `git remote` は `remote.origin.prune` だけでも `origin` を出し、`git remote add origin <url>` は `error: remote origin already exists.` で失敗する。グローバル設定の `remote.origin.url` も `git remote` に出る。
- `git config --get <key>` は、キーが無いと終了コード 1・stderr 空で、simple-git は空文字で resolve する。`rev-parse -q --verify HEAD` はコミットが無いと空文字、`symbolic-ref -q HEAD` は detached・リベース中に空文字、コミットの無いリポジトリでは `refs/heads/main`。
- simple-git の `timeout: { block: N }` は、pre-push フックの `sleep 3` を 300ms で打ち切り、`GitPluginError`（`plugin === 'timeout'`）で reject した。`branch.<b>.remote` は設定されず、リモートの ref もできなかった。
- `git rebase --exec false HEAD~1` で、リベースで止めた状態（`.git/rebase-merge` あり・`symbolic-ref -q HEAD` が終了コード 1）を、エディタを使わずに作れる（統合テストで使う）。

## Global Constraints

- 返答・コメント・エラーメッセージ・テスト名は日本語。型だけの import は `import type`。`git commit` / `git push` は、ユーザーの明示的な指示があるまで行わない（SDD 中はコミットしない運用。各タスクのコミット手順は飛ばす）。`git add -A` は使わない。
- 実機（Electron）の確認手順はプランに書かない。実機テスト仕様書 `docs/manual-test-spec.md` に新しい領域（接頭辞 `RMT`）を追記する（最終タスク）。
- `env()` を simple-git に使わない（`gitService.ts` の `getLog` のコメント。blockUnsafeOperationsPlugin の地雷）。git のエラーメッセージ文字列で分岐しない（パターン 18）。
- テストは TDD。実装後の検知力の確認は、`mktemp -d` の新しいディレクトリへ実装ファイルを `cp` で退避 → 変異 → 該当のテストが落ちることを確認 → 復元 → `cmp` で一致を確認、の手順で行う（`git stash` は使わない。パターン 57・78）。`act(...).then(...)` 形式でテストを書かない（`await act(async () => { ... })`）。テストで `setTimeout` / `setInterval` を使う場合は ID を保持して `afterEach` で消す（このプランのテストは使わない）。
- CLAUDE.md の規約: 新しいボタンには `aria-label` を付ける。リストの `key` に表示文言を使わない。選択状態を表す UI は作らない（radiogroup は不要）。暗色固定のテーマに合わせる（`main.css` の既存の色）。
- 型・チャネル（完全一致）:
  - `src/shared/types/git.ts` の `GitStatusResult` に `hasOrigin: boolean`、`upstream: string | null`、`detached: boolean`（リポジトリでないときは `false` / `null` / `false`）
  - IPC チャネル: `git:init`（引数はブランチ名の文字列 1 つ、戻り値 `Promise<void>`）、`git:addOrigin`（引数は URL の文字列 1 つ、戻り値 `Promise<void>`）、`git:pushSetUpstream`（引数なし、戻り値 `Promise<void>`）
  - preload / `gitApi`: `initRepository(branch: string): Promise<void>`、`addOrigin(url: string): Promise<void>`、`pushSetUpstream(): Promise<void>`
  - IPC の型検証の文言: `git:init` は既存の `assertBranchNameArg`（`Invalid branch name`）、`git:addOrigin` は `assertRemoteUrlArg`（`Invalid remote url`）
  - `src/shared/branchName.ts`: `normalizeInitialBranchName(name): string`（`trim()` の直後に `normalize('NFC')`）
  - `src/shared/remoteUrl.ts`: `normalizeRemoteUrl(url): string`（`trim()` だけ）、`getRemoteUrlRuleViolation(url, { windowsPaths }): RemoteUrlRuleViolation | null`、`type RemoteUrlRuleViolation = 'empty' | 'too-long' | 'invalid-char' | 'leading-dash' | 'unsupported'`、`MAX_REMOTE_URL_LENGTH = 2048`
  - `src/shared/remoteTimeout.ts`: `GIT_REMOTE_TIMEOUT_MS = 30_000`、`GIT_REMOTE_TIMEOUT_SECONDS = GIT_REMOTE_TIMEOUT_MS / 1000`
  - `src/main/gitRemoteSetupService.ts`: `initRepository(folderPath, branch, timeoutMs = REMOTE_SETUP_LOCAL_TIMEOUT_MS): Promise<void>`、`addOrigin(folderPath, url, timeoutMs = REMOTE_SETUP_LOCAL_TIMEOUT_MS, windowsPaths = process.platform === 'win32'): Promise<void>`、`pushSetUpstream(folderPath, timeoutMs = GIT_REMOTE_TIMEOUT_MS): Promise<void>`、`REMOTE_SETUP_LOCAL_TIMEOUT_MS = 30_000`
  - `src/renderer/src/types.ts`: `RemoteSetupPanelState`（Task 6）
  - `src/renderer/src/lib/remoteSetupState.ts`: `RemoteSetupFocusTarget = 'add-remote' | 'set-upstream' | 'push'`（Task 6。単一責任のレビューで `types.ts` から移した）
  - `src/renderer/src/lib/remoteSetupState.ts`: `getRemoteSetupState(gitStatus): 'no-origin' | 'no-upstream' | null`（型名 `RemoteSetupKind`）
- 状態ごとの表示（設計書の表。一字一句）:

| 状態                                                                                                        | パネルの表示                                                                           | ボタン                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `isRepo=false`                                                                                              | 従来どおり `Git リポジトリではありません`。その下に `リポジトリを初期化` ボタン        | 初期化中だけ disabled                                                                                                                  |
| `isRepo=true`、`hasOrigin=false`                                                                            | パネル上部に状態バナー `リモートが未設定です`                                          | `リモートを追加`。追加中・他の操作中（`isBlocked`）は disabled                                                                         |
| `hasOrigin=true`、`detached=true`（detached HEAD・リベース中・bisect 中）                                   | バナーは出さない（初回 push はブランチの上でしかできない）                             | なし                                                                                                                                   |
| `hasOrigin=true`、ブランチの上、`upstream=null`                                                             | バナー `upstream が未設定です（<branch>）`                                             | `初回 push（upstream を設定）`。push 中・pull 中・他の操作中は disabled                                                                |
| 上と同じだが、コミットが無い（init の直後）                                                                 | 同じバナーを出す                                                                       | ボタンは押せる。押すと main が `コミットが無いため、初回 push できません。先にコミットしてください` で拒否する（タグの作成と同じ扱い） |
| `upstream` が設定済み（リモートの ref が消えた `gone`・ローカルのブランチを upstream にしているものを含む） | バナーは出さない                                                                       | なし                                                                                                                                   |
| マージ中（`mergeInProgress`）                                                                               | マージのバナーを先に、その下にリモートのバナーを出す（どちらも条件を満たせば両方出す） | 上の各行と同じ。初回 push・origin の追加は、マージ中でも作業ツリー・index を変えないので許可する                                       |

- main の検証の順序（前の検証に失敗したら後の git 呼び出しには進まない。この順で固定する。simple-git の生成でフォルダが存在しなければ、git を呼ばずに `フォルダが見つかりません: <path>`。差分 17）:
  - `initRepository`: 0. `normalizeInitialBranchName` → 1. アプリ独自の規則（`getBranchNameRuleViolation`。git を呼ばない）→ 2. `git check-ref-format --branch <name>` の出力（trim）が入力と一致（reject も拒否。拒否のときは `check-ref-format --branch main` で git がこのフォルダで動くかを確かめ、動かなければ初期化の失敗にする。差分 1）→ 3. `checkIsRepo()` が偽、かつ `rev-parse --git-dir` が reject（bare リポジトリ・`.git` ディレクトリの中を拒否する。打ち切りは時間切れ。差分 15）→ 4. `git init --initial-branch=<name>`（1 引数）→ 5. `symbolic-ref -q HEAD` が `refs/heads/<name>`
  - `addOrigin`: 0. `normalizeRemoteUrl` → 1. `getRemoteUrlRuleViolation`（empty → too-long → invalid-char → leading-dash → unsupported。git を呼ばない）→ 2. `checkIsRepo()` が真 → 3. `git remote` に `origin` が無い → 4. `git remote add -- origin <url>` → 5. `git config --get remote.origin.url`（trim）が入力と一致
  - `pushSetUpstream`: 1. `checkIsRepo()` が真 → 2. `git remote` に `origin` がある → 3. `symbolic-ref -q HEAD` が `refs/heads/<b>` → 4. `rev-parse -q --verify HEAD` が空でない → 5. `for-each-ref --format=%(upstream:short) refs/heads/<b>` が空、かつ `config --get branch.<b>.remote` / `branch.<b>.merge` が空（差分 16）→ 6. `push --set-upstream origin refs/heads/<b>:refs/heads/<b>`（`--` を使わない）→ 7. `config --get branch.<b>.remote` が `origin` かつ `config --get branch.<b>.merge` が `refs/heads/<b>`
- refspec の形（完全一致）: `['push', '--set-upstream', 'origin', 'refs/heads/<b>:refs/heads/<b>']`。init は `['init', '--initial-branch=<name>']`、追加は `['remote', 'add', '--', 'origin', '<url>']`
- タイムアウト: push / pull / fetch / 初回 push は `GIT_REMOTE_TIMEOUT_MS`（30 秒。simple-git の `timeout: { block }` と no-op の `progress`）。init・追加は `REMOTE_SETUP_LOCAL_TIMEOUT_MS`（30 秒。`timeout: { block }` だけ）。
- URL の許可リスト（設計書。一字一句）:
  1. 空 → `URL を入力してください`
  2. 2048 文字を超える → `URL が長すぎます（2048 文字まで）`
  3. 空白（全角の空白を含む `\s`）・改行・タブ・NUL などの制御文字・不可視の書式文字（Unicode の Cf）・引用符（差分 20）を含む → ``URL に空白・改行・制御文字・引用符（' " `）は使用できません``（差分 21）
  4. `-` で始まる → `` `-` で始まる URL は使用できません ``
  5. 許可リストのどれにも当たらない → `使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）`
     - `https://` `http://` `ssh://` `git://`: スキームは小文字で完全一致。構造は `parseNetworkUrl` の 1 か所で解析する（差分 24）。authority は `/` か末尾で終わる（`?` `#` で終わる形を拒否）。authority の `@` より後は `host[:port]` の形（host は `[IPv6]` か `:` `@` `%` と角括弧を含まない名前で、`-` で始まらない。port は数字だけで空も可。差分 23・24）。userinfo は `ssh://` のパスワード無しのユーザー名（`[A-Za-z0-9._~+-]+`、先頭は `-` でない）だけを許可し、`http://` `https://` `git://` は `@` があれば拒否する。path・query・fragment の `@` と `%40` は拒否する（差分 24。差分 19・21・22 の個別の規則を置き換えた）
     - `file://`: 直後が `/`（絶対パス）
     - scp 形式: `<user>@<host>:<path>`。`user` と `host` は `/` `:` `@` を含まず、`host` は `-` で始まらない。`path` は空でない。`[::1]` のような角括弧のホストは許可しない
     - 絶対パス: `/` で始まる。`windowsPaths` が真のときだけ、`C:\` `C:/` の形も許可する
     - 上記以外はすべて拒否する。エラーの文言には URL を含めない
- main のエラー文言（完全一致）:
  - 3 関数の共通: `フォルダが見つかりません: <path>`（差分 17）
  - init: `` `-` で始まるブランチ名は使用できません: <name> `` / `ブランチ名として使用できない名前です: <name>` / `このフォルダは既に Git リポジトリ（または親フォルダのリポジトリ）の中にあります` / `リポジトリを初期化できませんでした: <detail>`（detail が空なら `リポジトリを初期化できませんでした`）/ `リポジトリの初期化が時間内に終わりませんでした`
  - 追加: 上の URL の 5 つ / `Git リポジトリではありません` / `リモート origin は既に設定されています` / `リモートを追加できませんでした: <detail>`（detail が空なら `リモートを追加できませんでした`）/ `リモートの追加が時間内に終わりませんでした`
  - 初回 push: `Git リポジトリではありません` / `リモート origin が未設定のため、初回 push できません` / `ブランチ上にいないため（detached HEAD・リベース中など）、初回 push できません` / `コミットが無いため、初回 push できません。先にコミットしてください` / `upstream は既に設定されています: <upstream の短い名前>` / `upstream の設定が既にあるため、初回 push できません（設定先のリモートが無いか、fetch の設定が無いため表示されていません）` / `初回 push に失敗しました: <detail>`（detail が空なら `初回 push に失敗しました`）/ `操作がタイムアウトしました。認証情報が未設定か、ネットワークに問題がある可能性があります` / `push は完了しましたが、upstream を設定できませんでした`
- UI 文言と ARIA（完全一致）:
  - Git 管理外: `Git リポジトリではありません`、ボタン `リポジトリを初期化`（`aria-label="リポジトリを初期化"`。初期化中だけ disabled）
  - 初期化ダイアログ: `role="dialog"`、見出し `リポジトリを初期化`（`aria-labelledby`）、説明 `このフォルダに空の Git リポジトリを作成します`（`aria-describedby`）、可視のラベル `ブランチ名`（既定値 `main`。開いたときに全選択）、ボタン `初期化`（実行中 `初期化中...`）/ `キャンセル`、実行中の案内 `初期化中です`（`role="status"`）。検証の文言 `名前を入力してください` / `` `-` で始まる名前は使用できません `` / `この名前は使用できません`
  - 追加ダイアログ: 見出し `リモートを追加`、説明 `リモート origin を追加します（この時点では接続しません）`、ラベル `URL`（既定値は空）、ボタン `追加`（実行中 `追加中...`）/ `キャンセル`、実行中の案内 `追加中です`。検証の文言は main の URL の 5 つと同じ
  - バナー: `section`、文言は `role="status"`。`リモートが未設定です` + ボタン `リモートを追加`（`aria-label="リモートを追加"`）。`upstream が未設定です（<branch>）` + ボタン `初回 push（upstream を設定）`（実行中は表示 `push 中...`・`aria-label="push 中"`）。初回 push 中の案内 `初回 push 中です。応答が 30 秒途絶えると打ち切ります`（`role="status"`。「30」は `GIT_REMOTE_TIMEOUT_SECONDS` から組み立てる。`isSettingUpstream && remoteOperationError === null` のときだけ）
  - ダイアログ共通（タグの作成に揃える）: 実行中は入力欄・実行ボタン・`キャンセル` を disabled、Escape・オーバーレイのクリックでは閉じない（閉じる経路は `requestCancel` に集める。パターン 85）。`form` の `aria-busy` と実行中の案内は `isRunning && error === null` のときだけ（パターン 87）。失敗は `role="alert"`。検証エラーは入力欄の `aria-describedby` と `aria-invalid`。Escape は `isComposing` のときは無視する。実行中が解けたとき、フォーカスが body かダイアログ内なら入力欄へ戻す（パターン 86）
  - フォーカス: キャンセル・Escape・オーバーレイで閉じたら開いたボタンへ戻す（描画の後。body のときだけ）。成功の後は、初期化 → `リモートを追加`、追加 → `初回 push（upstream を設定）`、初回 push → ツールバーの `プッシュ`（描画の後。フォーカスが body のときだけ。移す先が無ければ何もしない）。初回 push が失敗して実行中が解けたら、フォーカスが body ならバナーの `初回 push（upstream を設定）` へ戻す（Task 7 のレビューで追加）
  - タップ領域: 新しいボタン（`リポジトリを初期化`・バナーのボタン）は 32px 以上（共通のボタンの規則に入れる）
- 排他（設計書の表）: 初期化は自身・`lock.isAnyLocked()` の間 no-op。origin の追加は自身・`lock.isAnyLocked()`・リポジトリが無い間 no-op。初回 push は push と実行中フラグ（`isPushingRef`）を共有し、push と同じ条件（自身・push・pull・`lock.isAnyLocked()`・リポジトリが無い）で no-op。どれも `lockGlobal` は取らない。再取得は成功・失敗のどちらでも行い、実行中フラグはその後で解除する（`useRunExclusiveGitOperation`。パターン 73）。再取得の失敗で操作の成功を失敗にしない（パターン 52）。再試行の開始時（`onStart`）に前回のエラーを消す（パターン 87）。
- 再取得の範囲: 初期化はステータスと履歴、追加はステータスだけ、初回 push はステータスと履歴。ファイルツリー・エディタのタブは取り直さない（作業ツリーは変わらない）。

## File Structure

| ファイル                                                                                                                       | 責務                                                                           | 変更   |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------ |
| `src/shared/branchName.ts`                                                                                                     | `normalizeInitialBranchName`                                                   | Modify |
| `src/shared/remoteUrl.ts`                                                                                                      | URL の正規化と許可リスト（main と renderer で共有）                            | Create |
| `src/shared/remoteTimeout.ts`                                                                                                  | `GIT_REMOTE_TIMEOUT_MS` / `GIT_REMOTE_TIMEOUT_SECONDS`                         | Create |
| `src/shared/types/git.ts`                                                                                                      | `GitStatusResult` の `hasOrigin` / `upstream` / `detached`                     | Modify |
| `src/main/gitRemoteNames.ts`                                                                                                   | `ORIGIN_REMOTE`・`hasOriginRemote`                                             | Create |
| `src/main/gitBranchNameGuard.ts`                                                                                               | `assertValidNewBranchName`（ブランチの作成と初期化）                           | Create |
| `src/main/gitHeadState.ts`                                                                                                     | `getCurrentBranchRef`（`isOnBranch` と初回 push）                              | Create |
| `src/main/gitStepErrors.ts`                                                                                                    | `isGitTimeoutError`・`errorDetail`・`failure`・`toStepError`・`runGitStep`     | Create |
| `src/main/gitRemoteTimeout.ts`                                                                                                 | `simpleGitWithRemoteTimeout`・`toRemoteOperationError`                         | Create |
| `src/main/gitService.ts`                                                                                                       | `getGitStatus` の拡張、切り出した部品の利用                                    | Modify |
| `src/main/gitTagService.ts`                                                                                                    | 打ち切りの判定・失敗の文言の組み立てを `gitStepErrors` に置き換える            | Modify |
| `src/main/gitRemoteSetupService.ts`                                                                                            | `initRepository`・`addOrigin`・`pushSetUpstream` と文言                        | Create |
| `src/main/__tests__/helpers/realGitRepo.ts`                                                                                    | `stubGitCeiling`（統合テストが親のリポジトリを拾わない）                       | Modify |
| `src/main/handlers/gitHandlers.ts`                                                                                             | IPC `git:init` / `git:addOrigin` / `git:pushSetUpstream`、`assertRemoteUrlArg` | Modify |
| `src/preload/api.ts` / `src/preload/index.d.ts`                                                                                | `initRepository` / `addOrigin` / `pushSetUpstream`                             | Modify |
| `src/renderer/src/lib/gitApi.ts`                                                                                               | 同上                                                                           | Modify |
| `src/renderer/src/types.ts`                                                                                                    | `RemoteSetupPanelState`                                                        | Modify |
| `src/renderer/src/lib/remoteSetupState.ts`                                                                                     | バナーの表示条件・文言・初回 push 中の案内・`RemoteSetupFocusTarget`           | Create |
| `src/renderer/src/lib/remoteSetupValidation.ts`                                                                                | ダイアログ用の検証と文言                                                       | Create |
| `src/renderer/src/hooks/useGitRemoteSetup.ts`                                                                                  | 初期化・追加の実行・排他・再取得・エラー                                       | Create |
| `src/renderer/src/hooks/useGitRemoteOperations.ts`                                                                             | `pushSetUpstream` / `isSettingUpstream`                                        | Modify |
| `src/renderer/src/hooks/useRemoteSetupFocus.ts`                                                                                | 成功の後のフォーカスの要求の state と移動（描画の後）                          | Create |
| `src/renderer/src/hooks/useDialogFocusReturn.ts`                                                                               | ダイアログの開閉と、閉じた後に開いたボタンへ戻すフォーカス（3 か所で共通）     | Create |
| `src/renderer/src/hooks/useFocusOnRunningEnd.ts`                                                                               | 実行中が解けたときに body に落ちたフォーカスを戻す（3 か所で共通）             | Create |
| `src/renderer/src/components/source-control/RemoteSetupInputDialog.tsx`                                                        | 1 項目の入力・実行中の案内・エラー・閉じる経路・フォーカス                     | Create |
| `src/renderer/src/components/source-control/InitRepositoryDialog.tsx` / `AddRemoteDialog.tsx`                                  | 共通ダイアログに検証と文言を渡す薄い部品                                       | Create |
| `src/renderer/src/components/source-control/NotRepositoryView.tsx`                                                             | Git 管理外の表示・初期化ボタン・ダイアログの開閉                               | Create |
| `src/renderer/src/components/source-control/RemoteSetupBanner.tsx`                                                             | 状態バナー・追加ダイアログの開閉・初回 push                                    | Create |
| `src/renderer/src/assets/main.css`                                                                                             | バナー・ボタン・ダイアログの見た目                                             | Modify |
| `SourceControlToolbar.tsx` / `GitRepoView.tsx` / `SourceControlPanel.tsx` / `Sidebar.tsx` / `App.tsx` / `hooks/useAppState.ts` | `remoteSetup` の配線・フォーカスの移動先                                       | Modify |
| `src/renderer/src/__tests__/makeRemoteSetupPanelState.ts`                                                                      | テスト用の型付きモック                                                         | Create |
| 既存のテスト 21 ファイル（`GitStatusResult` のフィクスチャ）                                                                   | `hasOrigin` / `upstream` / `detached` の追加                                   | Modify |
| `docs/manual-test-spec.md`                                                                                                     | 領域 `RMT`                                                                     | Modify |

---

### Task 1: shared の規則（最初のブランチ名の正規化・URL の許可リスト・リモートのタイムアウト）

**Files:**

- Modify: `src/shared/branchName.ts`, `src/shared/__tests__/branchName.test.ts`
- Create: `src/shared/remoteUrl.ts`, `src/shared/__tests__/remoteUrl.test.ts`, `src/shared/remoteTimeout.ts`, `src/shared/__tests__/remoteTimeout.test.ts`

**Interfaces:**

- Consumes: なし
- Produces: `normalizeInitialBranchName`（`@shared/branchName`）、`normalizeRemoteUrl` / `getRemoteUrlRuleViolation` / `RemoteUrlRuleViolation` / `RemoteUrlRuleOptions` / `MAX_REMOTE_URL_LENGTH`（`@shared/remoteUrl`）、`GIT_REMOTE_TIMEOUT_MS` / `GIT_REMOTE_TIMEOUT_SECONDS`（`@shared/remoteTimeout`）
- 注: `GitStatusResult` の型の追加は Task 2 で行う（差分 2）

- [ ] **Step 1: 失敗するテストを書く**

`src/shared/__tests__/branchName.test.ts` の import を次に変え、ファイル末尾に追加:

```ts
import {
  findConflictingBranchName,
  getBranchNameRuleViolation,
  normalizeInitialBranchName
} from '../branchName'
```

```ts
// リポジトリの初期化の最初のブランチ名。main(initRepository の入口)と renderer(初期化ダイアログ)が
// 同じ正規化を使う(パターン 83)。macOS の git は NFD の名前をそのまま refs/heads/<NFD> にする(実機で確認)
describe('normalizeInitialBranchName', () => {
  it('前後の空白・改行を除く', () => {
    expect(normalizeInitialBranchName('  main \n')).toBe('main')
  })

  it('NFD を NFC にそろえる', () => {
    expect(normalizeInitialBranchName('cafe\u0301')).toBe('caf\u00e9')
  })

  // 途中の空白は git の規則(check-ref-format)で main が拒否する。ここでは変えない
  it('途中の空白は残す', () => {
    expect(normalizeInitialBranchName('a b')).toBe('a b')
  })
})
```

`src/shared/__tests__/remoteUrl.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  MAX_REMOTE_URL_LENGTH,
  getRemoteUrlRuleViolation,
  normalizeRemoteUrl,
  parseNetworkUrl
} from '../remoteUrl'

const posix = { windowsPaths: false }
const windows = { windowsPaths: true }

// main(gitRemoteSetupService の addOrigin)と renderer(AddRemoteDialog)が同じ判定・同じ順序を使う(パターン 88)。
// 許可リスト方式(パターン 21・59)。simple-git は ext:: も --upload-pack=... も止めない(実機で確認)ため、
// この判定が唯一の防御になる
describe('getRemoteUrlRuleViolation', () => {
  it.each([
    'https://github.com/a/b.git',
    'http://example.com/a.git',
    'https://host',
    'https://host/r.git',
    'https://host:8443/r',
    'https://[::1]/r',
    'ssh://git@host:22/a.git',
    'ssh://host/a.git',
    'ssh://host/r',
    'ssh://git@host/r',
    'ssh://git@host:22/r',
    // ssh:// の userinfo はパスワードの無いユーザー名だけ(`[A-Za-z0-9._~+-]+`)
    'ssh://first.last+tag@host/r',
    'ssh://ec2-user@host/r',
    'ssh://git@[::1]:22/r',
    'git://host/a',
    'git://host/r',
    'git://host:9418/r',
    'git://127.0.0.1:19418/a',
    // path の %XX(@ 以外)と query はそのまま許可する
    'ssh://git@h/a%2Fb',
    'ssh://h/a%2Fb?x=%2F',
    'https://h/r?x=1#frag',
    'file:///abs/bare.git',
    'file:///abs/x',
    'git@github.com:a/b.git',
    'user@host:path/to/repo.git',
    'ec2-user@host:path',
    'first.last@h:p',
    '/abs/bare.git',
    '/abs/x',
    '/abs/日本語/bare.git',
    // 制御文字(DEL)の直前の ~ は許可する
    'https://h/~user/a.git'
  ])('%s は許可する', (url) => {
    expect(getRemoteUrlRuleViolation(url, posix)).toBeNull()
    expect(getRemoteUrlRuleViolation(url, windows)).toBeNull()
  })

  // macOS で `C:/x` は git に scp 形式として解釈されるため、Windows のときだけ許可する
  it.each(['C:\\repos\\bare.git', 'C:/repos/bare.git', 'd:/x'])(
    'Windows のドライブの形 %s は windowsPaths のときだけ許可する',
    (url) => {
      expect(getRemoteUrlRuleViolation(url, windows)).toBeNull()
      expect(getRemoteUrlRuleViolation(url, posix)).toBe('unsupported')
    }
  )

  it('空文字は empty', () => {
    expect(getRemoteUrlRuleViolation('', posix)).toBe('empty')
  })

  it('最大長は 2048 文字で、ちょうどなら許可し、超えると too-long', () => {
    expect(MAX_REMOTE_URL_LENGTH).toBe(2048)
    const prefix = 'https://h/'
    const atLimit = prefix + 'a'.repeat(MAX_REMOTE_URL_LENGTH - prefix.length)
    expect(atLimit).toHaveLength(2048)
    expect(getRemoteUrlRuleViolation(atLimit, posix)).toBeNull()
    expect(getRemoteUrlRuleViolation(`${atLimit}a`, posix)).toBe('too-long')
  })

  // git の remote add は改行を含む URL をそのまま受け付け、config に複数行の値として書く(実機で確認)
  it.each([
    ['途中の空白', 'https://h/a b'],
    ['改行', '/a\n/b'],
    ['CR', '/a\r/b'],
    ['タブ', '/a\tb'],
    ['NUL', '/a\u0000b'],
    ['DEL', '/a\u007fb'],
    ['C1 制御文字', '/a\u0085b'],
    // 制御文字の範囲の境界値(C0 の先頭・末尾、C1 の先頭・末尾)
    ['U+0001', '/a\u0001b'],
    ['U+001F', '/a\u001fb'],
    ['U+0080', '/a\u0080b'],
    ['U+009F', '/a\u009fb'],
    ['全角の空白', '/a\u3000b'],
    // 不可視の書式文字(Unicode の Cf)。画面に見えず、確認した URL と書かれる URL が食い違う
    ['ゼロ幅スペース U+200B', 'https://h/a\u200bb'],
    ['右から左のマーク U+200F', 'https://h/a\u200fb'],
    ['双方向の上書き U+202E', 'https://h/a\u202eb'],
    ['双方向の分離 U+2066', 'https://h/a\u2066b'],
    ['双方向の分離の終わり U+2069', 'https://h/a\u2069b'],
    ['途中の BOM U+FEFF', '/a\ufeffb'],
    ['ソフトハイフン U+00AD', '/a\u00adb'],
    ['ext:: とコマンド', 'ext::sh -c touch% /tmp/x'],
    // 引用符。git は失敗の文言で URL を `'...'` で囲んで出すことがあり(remote add の `could not set
    // 'remote.origin.url' to '<url>'`)、URL の中の引用符は資格情報を伏せる処理(redactCredentials)の区切りと
    // 区別できない(パスワードの一部が残る)。git は引用符を含む URL を受け付けるが、アプリでは追加させない
    ["パスワードの '", "https://u:p'ss@h/r"],
    ['パスワードの "', 'https://u:p"ss@h/r'],
    ['パスワードの `', 'https://u:p`ss@h/r'],
    ["パスの '", "https://github.com/a/it's.git"],
    ["絶対パスの '", "/repos/O'Brien/b.git"],
    ['scp 形式の "', 'git@host:a"b.git']
  ])('%s を含むと invalid-char', (_label, url) => {
    expect(getRemoteUrlRuleViolation(url, posix)).toBe('invalid-char')
  })

  it.each(['-x', '--upload-pack=x', '-oProxyCommand=x'])('%s は leading-dash', (url) => {
    expect(getRemoteUrlRuleViolation(url, posix)).toBe('leading-dash')
  })

  it.each([
    ['ext:: の helper', 'ext::sh'],
    ['fd::', 'fd::3'],
    ['<名前>::<address>', 'foo::bar'],
    ['大文字のスキーム', 'HTTPS://github.com/a/b.git'],
    ['未知のスキーム', 'unknown://x'],
    ['ホストが - で始まる', 'ssh://-oProxyCommand=x/a'],
    ['user の後のホストが - で始まる', 'ssh://git@-oProxyCommand=x/a'],
    ['user が - で始まる', 'ssh://-l@host/a'],
    // ホストは最後の `@` の後(最初の `@` の後で切ると `b@-x` になり、- 始まりを見逃す)
    ['@ が 2 つあり最後の @ の後が - で始まる', 'ssh://a@b@-x/r'],
    ['ホストが空', 'https:///a'],
    ['user の後のホストが空', 'https://user@/a'],
    ['file:// の後がホスト', 'file://host/a'],
    ['相対パス(../)', '../bare.git'],
    ['相対パス(./)', './bare.git'],
    ['user@ の無い host:path', 'host:path'],
    ['scp のホストが - で始まる', 'git@-x:a'],
    ['scp の角括弧のホスト', '[::1]:a'],
    ['scp の角括弧のホスト(user あり)', 'git@[::1]:a'],
    ['scp の角括弧のホスト(コロンなし)', 'git@[host]:a'],
    ['scp の path が空', 'git@host:'],
    ['scp の user が空', '@host:a'],
    // git:// には認証が無く、git は `user:pass@host` 全体をホスト名として扱い、失敗の文言に資格情報を出す
    // (`unable to look up alice:s3cret@127.0.0.1:19418`。実機 git 2.50.1 で確認)。user だけでも同じ
    ['git:// の user:pass', 'git://alice:s3cret@127.0.0.1:19418/b.git'],
    ['git:// の user', 'git://alice@host/a'],
    ['git:// の空の user', 'git://@host/a'],
    // authority の `@` は 1 個まで。`ssh://u:p@ss@h/r` は ssh が `u:p@ss@h: Permission denied` と出し、
    // 資格情報を伏せる処理と区別しにくい(3 周目のレビュー。パスワードの `@` は `%40` と書く)
    ['ssh の authority に @ が 2 個', 'ssh://u:p@ss@h/r'],
    ['https の authority に @ が 2 個', 'https://u:p@ss@h/r'],
    ['http の authority に @ が 3 個', 'http://a@b@c@h/r'],
    ['パスの無い URL の authority に @ が 2 個', 'https://u:p@ss@h']
  ])('%s(%s)は unsupported', (_label, url) => {
    expect(getRemoteUrlRuleViolation(url, posix)).toBe('unsupported')
    expect(getRemoteUrlRuleViolation(url, windows)).toBe('unsupported')
  })

  // 資格情報の扱い(利用者の決定): パスワード入りの URL は構造的に拒否し、認証は credential helper に任せる。
  // 6 周のレビューで、userinfo(`user:pass@`)の区切り方の解釈違いで漏れる穴が毎回見つかった(remote add の失敗の
  // 文言・ssh:// の user:pw@・`@` を含むパスワード・`%XX` の decode・git:// の userinfo・引用符・userinfo の生の `/`・
  // userinfo の `?` `#`)。許可する形を最小に定義する。拒否の文言は既存の unsupported のまま
  describe('資格情報を含みうる URL(パスワード入りの URL を拒否する)', () => {
    it.each([
      // http・https・git:// は authority に `@` があれば拒否する(user だけでもトークンだけでも秘密になりうる)
      ['https の user', 'https://user@h/r'],
      ['https の user:pw', 'https://user:pw@h/r'],
      ['https のトークンだけ', 'https://ghp_tok@h/r'],
      ['https の user:token', 'https://alice:ghp_TOKEN@github.com/a/b.git'],
      ['https のパスの無い user:pw', 'https://user:pw@host'],
      ['https の %40 を含むパスワード', 'https://u:p%40ss@h/'],
      ['https の %2F を含むパスワード', 'https://alice:s3cr%2Fet@h/r'],
      ['https の user:pw と port', 'https://user:pw@host:443/r'],
      ['http の user', 'http://u@h'],
      ['http の user(パスあり)', 'http://alice@example.com/a.git'],
      ['http の %20 を含むパスワード', 'http://u:p%20ss@h/r'],
      ['git:// の user', 'git://u@h'],
      // ssh:// は userinfo に `:`(パスワードの区切り)があれば拒否する
      ['ssh の user:pw', 'ssh://u:pw@h/r'],
      ['ssh の user:pw(パスあり)', 'ssh://alice:pw@host/a.git'],
      ['ssh の空のパスワード', 'ssh://u:@h/r'],
      ['ssh の %40 を含むパスワード', 'ssh://u:p%40ss@h/r'],
      // ssh:// の userinfo の `%XX` は拒否する(git は URL 全体の `%XX` を元の文字に戻してから ssh に渡す)
      ['ssh の user の %40', 'ssh://u%40x@h/r'],
      ['ssh の user の %2F', 'ssh://al%2Fice@h/r'],
      // 以前は decode した結果で判定し、%40 %3A %25・二重エンコードを許可していた。`%` を含む userinfo はすべて拒否する
      ['ssh の %3A を含むパスワード', 'ssh://u:p%3Ass@h/r'],
      ['ssh の %25 を含むパスワード', 'ssh://u:p%25ss@h/r'],
      ['ssh の二重エンコード', 'ssh://u:p%252Fss@h/r'],
      ['ssh の UTF-8 のエンコード', 'ssh://u:p%C3%A9ss@h/r'],
      ['ssh の %2F を含むパスワード', 'ssh://alice:s3cr%2Fet@nohost.invalid/r'],
      ['ssh の %5C を含むパスワード', 'ssh://u:p%5Css@h/r'],
      ['ssh の %0A を含むパスワード', 'ssh://u:p%0Ass@h/r'],
      ['ssh の %27 を含むパスワード', 'ssh://u:p%27ss@h/r'],
      ['ssh の不正なエンコード', 'ssh://u:p%G1ss@h/r'],
      ['ssh の空の user', 'ssh://@h/r'],
      ['ssh の user の記号', 'ssh://u!x@h/r'],
      // userinfo に生の `/` を含む形。authority を最初の `/` で切ると `alice:1234`(`@` 無し)になり、port が数字の
      // ため host:port に見える(5・6 周目のレビュー)。path の `@` を拒否して塞ぐ
      ['https のパスワードが数字で始まる生の /', 'https://alice:1234/s3cret@h/r'],
      ['https の空のパスワードの後の生の /', 'https://alice:/s3cret@h/r'],
      ['https のトークンの生の /', 'https://ghp_tok/en@h/r'],
      ['ssh のパスワードが数字で始まる生の /', 'ssh://alice:1234/s3cret@h/r'],
      ['ssh の空のパスワードの後の生の /', 'ssh://alice:/s3cret@h/r'],
      ['ssh のトークンの生の /', 'ssh://ghp_tok/en@h/r'],
      ['git:// のパスワードが数字で始まる生の /', 'git://alice:1234/s3cret@h/r'],
      ['git:// の空のパスワードの後の生の /', 'git://alice:/s3cret@h/r'],
      ['git:// のトークンの生の /', 'git://ghp_tok/en@h/r'],
      ['http のパスワードが数字で始まる生の /', 'http://alice:1234/s3cret@h/r'],
      // authority は最初の `/` `?` `#` まで。`/` 以外で終わる authority は拒否する(境界のずらしを根絶する)
      ['https の authority の後の #', 'https://h#sec@h2/r'],
      ['https の authority の後の ?', 'https://h?x@h2/r'],
      ['ssh の authority の後の #', 'ssh://h#x@y/r'],
      ['ssh の authority の後の ?', 'ssh://h?x@y/r'],
      ['https の authority の後の #(@ 無し)', 'https://h#frag'],
      // path の `@`(既知の制約。`%40` も git が `@` に戻すため同じく拒否する)
      ['https の path の @', 'https://host/a@b'],
      ['https の path の @ が 2 個', 'https://h/a@b@c'],
      ['ssh の path の @', 'ssh://h/a@b'],
      ['ssh の user ありの path の @', 'ssh://git@host/a@b'],
      ['ssh の path の %40', 'ssh://h/a%40b'],
      ['https の path の小文字の %40', 'https://h/a%40b'],
      ['query の @', 'https://h/r?x=a@b'],
      ['fragment の @', 'https://h/r#a@b'],
      // authority の `%XX` は拒否する。git は ssh:// と git:// の URL 全体を decode してから host と path を分ける
      // (`ssh://alice%3Apw%40h/r` は ssh に `alice:pw@h` が渡り、`ssh://git@h%2Fx/r` は host が `h` になる。
      // 実機 git 2.50.1 と偽の ssh で確認)
      ['ssh の host の %3A %40', 'ssh://alice%3Apw%40h/r'],
      ['ssh の host の %2F', 'ssh://h%2Fx/r'],
      ['ssh の user ありの host の %2F', 'ssh://git@h%2Fx/r'],
      ['git:// の host の %40', 'git://alice%3Apw%40h/r'],
      ['https の host の %40', 'https://alice%3Apw%40h/r'],
      // scp 形式の user は `[A-Za-z0-9._~+-]+` だけ
      ['scp の user の記号', 'u!x@h:p'],
      ['scp の user の %', 'u%40x@h:p'],
      // scp 形式の path の `@`。`Ua1@Ub2:Pa3@h:r`(user `Ua1@Ub2`・パスワード `Pa3` のつもり)は git が host を `Ub2`、
      // path を `Pa3@h:r` と解釈し、パスワードが URL ごと失敗の文言に残る(性質テストで検出)。ネットワークの URL と同じく拒否する
      ['scp の path の @', 'git@host:a@b'],
      ['scp の user:pw のつもりの @', 'Ua1@Ub2:Pa3@h.example:a/b.git'],
      ['scp の user:pw', 'alice:pw@host:a.git']
    ])('%s(%s)は unsupported', (_label, url) => {
      expect(getRemoteUrlRuleViolation(url, posix)).toBe('unsupported')
      expect(getRemoteUrlRuleViolation(url, windows)).toBe('unsupported')
    })
  })

  // 実在のホスティングサービスが「Clone」で出す URL の代表(7 周目のレビュー)。Azure DevOps の https は userinfo に
  // 組織名(`org@`)が入るため拒否し、`org@` を外した形は許可する(認証は credential helper。設計書の既知の制約)
  describe('実在のホスティングサービスの URL', () => {
    it.each([
      [
        'Azure DevOps の Clone の https(org@ 入り)',
        'https://org@dev.azure.com/org/proj/_git/repo',
        'unsupported'
      ],
      ['Azure DevOps の https(org@ を外した形)', 'https://dev.azure.com/org/proj/_git/repo', null],
      ['Azure DevOps の ssh(scp 形式)', 'git@ssh.dev.azure.com:v3/org/proj/repo', null],
      ['GitHub の https', 'https://github.com/owner/repo.git', null],
      ['GitHub の ssh(scp 形式)', 'git@github.com:owner/repo.git', null],
      ['GitHub の ssh://', 'ssh://git@github.com/owner/repo.git', null],
      ['GitLab の https', 'https://gitlab.com/group/subgroup/repo.git', null],
      ['GitLab の ssh(scp 形式)', 'git@gitlab.com:group/subgroup/repo.git', null],
      ['Bitbucket の https', 'https://bitbucket.org/workspace/repo.git', null],
      [
        'Bitbucket の Clone の https(user@ 入り)',
        'https://alice@bitbucket.org/workspace/repo.git',
        'unsupported'
      ],
      ['CodeCommit の https', 'https://git-codecommit.us-east-1.amazonaws.com/v1/repos/repo', null],
      ['CodeCommit の ssh://', 'ssh://git-codecommit.us-east-1.amazonaws.com/v1/repos/repo', null]
    ])('%s: %s → %s', (_label, url, expected) => {
      expect(getRemoteUrlRuleViolation(url, posix)).toBe(expected)
      expect(getRemoteUrlRuleViolation(url, windows)).toBe(expected)
    })
  })

  // authority の構造(`[userinfo@]host[:port]`。host は reg-name・IPv4・`[IPv6]`、port は数字だけ)
  describe('authority の構造(host と port)', () => {
    it.each([
      ['https の userinfo に生の /', 'https://user:pa/ss@nohost.invalid/r'],
      ['ssh の userinfo に生の /', 'ssh://user:pa/ss@nohost.invalid/r'],
      ['git:// の userinfo に生の /', 'git://user:pa/ss@nohost.invalid/r'],
      ['http の userinfo に生の /', 'http://u:p/ss@h/r'],
      ['ポートが数字でない', 'https://host:abc/r'],
      ['ポートが数字と文字の混在', 'https://host:22x/r'],
      ['userinfo の後のポートが数字でない', 'ssh://git@host:pw/r'],
      ['ポートの区切りが 2 つ', 'https://host:1:2/r'],
      ['IPv6 の閉じ括弧の後が : でない', 'https://[::1]x/r'],
      ['IPv6 の閉じ括弧が無い', 'https://[::1/r'],
      ['IPv6 の括弧の中が 16 進数でない', 'ssh://[-oProxyCommand=x]/r'],
      ['IPv6 の後のポートが数字でない', 'ssh://git@[::1]:pw/r'],
      ['括弧が host の途中', 'https://h[::1]/r']
    ])('%s(%s)は unsupported', (_label, url) => {
      expect(getRemoteUrlRuleViolation(url, posix)).toBe('unsupported')
      expect(getRemoteUrlRuleViolation(url, windows)).toBe('unsupported')
    })

    // port の範囲(0・65535 超)は確かめない。git は範囲外のポートで失敗するだけで、資格情報を出さない
    // (`URL rejected: Port number was not a decimal number between 0 and 65535`。実機で確認)。空の port(`host:`)は
    // git が既定のポートとして扱う(https・ssh・git:// とも、実機で確認)ため許可する
    it.each([
      'https://host:8443/x',
      'ssh://git@host:22/a',
      'ssh://git@[::1]:22/r',
      'https://[::1]/r',
      'https://[2001:db8::1]:443/r',
      'https://host/',
      'git://host:9418/x',
      'https://my-host.example-1.com/r',
      'https://192.168.0.1:8080/r',
      'https://ｇｉｔ.例え.jp/r',
      'https://host:/r',
      'git://host:/r',
      'https://host:99999/r',
      'https://host:0/r'
    ])('%s は許可する', (url) => {
      expect(getRemoteUrlRuleViolation(url, posix)).toBeNull()
      expect(getRemoteUrlRuleViolation(url, windows)).toBeNull()
    })
  })

  describe('判定の順序(empty → too-long → invalid-char → leading-dash → unsupported)', () => {
    it('長すぎて空白も含むなら too-long', () => {
      expect(getRemoteUrlRuleViolation(`${'a'.repeat(MAX_REMOTE_URL_LENGTH)} `, posix)).toBe(
        'too-long'
      )
    })

    it('- で始まり空白も含むなら invalid-char', () => {
      expect(getRemoteUrlRuleViolation('-x y', posix)).toBe('invalid-char')
    })

    it('- で始まり引用符も含むなら invalid-char', () => {
      expect(getRemoteUrlRuleViolation("-x'", posix)).toBe('invalid-char')
    })

    it('- で始まる未知の形式は leading-dash', () => {
      expect(getRemoteUrlRuleViolation('-ext::sh', posix)).toBe('leading-dash')
    })
  })
})

// authority の解析は parseNetworkUrl の 1 か所。判定(getRemoteUrlRuleViolation)はここから派生する(パターン 88)
describe('parseNetworkUrl', () => {
  it.each([
    [
      'ssh://git@host:22/a.git',
      { scheme: 'ssh', userinfo: 'git', host: 'host', port: '22', pathAndAfter: '/a.git' }
    ],
    [
      'https://host',
      { scheme: 'https', userinfo: null, host: 'host', port: null, pathAndAfter: '' }
    ],
    [
      'https://[::1]:/r?x#y',
      { scheme: 'https', userinfo: null, host: '[::1]', port: '', pathAndAfter: '/r?x#y' }
    ],
    // authority は最初の `/` で終わる(userinfo に生の `/` があると、`alice:1234` が host:port になる)
    [
      'https://alice:1234/s3cret@h/r',
      { scheme: 'https', userinfo: null, host: 'alice', port: '1234', pathAndAfter: '/s3cret@h/r' }
    ],
    // authority は最初の `#` `?` でも終わる(curl・RFC 3986 と同じ)
    [
      'https://h#sec@h2/r',
      { scheme: 'https', userinfo: null, host: 'h', port: null, pathAndAfter: '#sec@h2/r' }
    ],
    ['git://u:p@h/r', { scheme: 'git', userinfo: 'u:p', host: 'h', port: null, pathAndAfter: '/r' }]
  ])('%s を分解する', (url, parts) => {
    expect(parseNetworkUrl(url)).toEqual(parts)
  })

  it.each([
    ['ネットワークのスキームでない', 'file:///a'],
    ['大文字のスキーム', 'HTTPS://h/r'],
    ['scp 形式', 'git@h:a'],
    ['authority の @ が 2 個', 'ssh://a@b@h/r'],
    ['host の %', 'ssh://h%2Fx/r'],
    ['host が空', 'https:///a'],
    ['port が数字でない', 'https://h:x/r']
  ])('%s(%s)は null', (_label, url) => {
    expect(parseNetworkUrl(url)).toBeNull()
  })
})

describe('normalizeRemoteUrl', () => {
  it('前後の空白・改行だけを除く', () => {
    expect(normalizeRemoteUrl('  https://h/a \n')).toBe('https://h/a')
  })

  // URL の中の文字を変えると、サーバー側で別のパスになるため NFC にはそろえない
  it('NFD は NFD のまま返す', () => {
    expect(normalizeRemoteUrl('/r/e\u0301')).toBe('/r/e\u0301')
  })
})
```

`src/shared/__tests__/remoteTimeout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { GIT_REMOTE_TIMEOUT_MS, GIT_REMOTE_TIMEOUT_SECONDS } from '../remoteTimeout'

// main の打ち切り(push / pull / fetch / 初回 push)と renderer の初回 push 中の案内(「応答が N 秒途絶えると
// 打ち切ります」)が同じ値を使う(パターン 88)。値を変えるときは manual-test-spec の RMT の項目も直す
describe('GIT_REMOTE_TIMEOUT_MS', () => {
  it('30 秒', () => {
    expect(GIT_REMOTE_TIMEOUT_MS).toBe(30_000)
  })

  // 案内は秒で表すため、1000 の倍数でない値を入れると「30.5 秒」のような文言になる
  it('1000 の倍数で、GIT_REMOTE_TIMEOUT_SECONDS はその秒数', () => {
    expect(GIT_REMOTE_TIMEOUT_MS % 1000).toBe(0)
    expect(GIT_REMOTE_TIMEOUT_SECONDS).toBe(GIT_REMOTE_TIMEOUT_MS / 1000)
    expect(Number.isInteger(GIT_REMOTE_TIMEOUT_SECONDS)).toBe(true)
  })
})
```

```bash
npx vitest run src/shared
```

Expected: FAIL（`normalizeInitialBranchName` が無い、`../remoteUrl` / `../remoteTimeout` が無い）

- [ ] **Step 2: 実装する**

`src/shared/branchName.ts` の末尾に追加:

```ts
// リポジトリの初期化(git init --initial-branch)に渡す最初のブランチ名の正規化。前後の空白を除き、
// Unicode の NFC にそろえる。main(gitRemoteSetupService の initRepository)の入口と、renderer の
// 初期化ダイアログ(検証と送信値)が同じ関数を使う(パターン 83・88)。macOS の git は NFD の名前を
// そのまま refs/heads/<NFD> にする(実機 git 2.50.1 で確認)ため、入口でそろえる
export function normalizeInitialBranchName(name: string): string {
  return name.trim().normalize('NFC')
}
```

`src/shared/remoteUrl.ts`:

```ts
// リモート(origin)の URL の規則。main(gitRemoteSetupService の addOrigin)と renderer(AddRemoteDialog の
// 検証)が同じ判定・同じ順序を使う(パターン 88)。違反の種類だけを返し、文言は各側の表で持つ。
// 許可リスト方式(パターン 21・59): git が受け付ける URL のうち、アプリが追加してよい形だけを通す。
// ext::<command>(任意のコマンドを実行する)・fd::<n>・<名前>::<address>・未知のスキームの <名前>://
// (git-remote-<名前> が起動する)は、利用者の protocol.allow の設定しだいで push 時に実行される
// (実機 git 2.50.1 で確認)。simple-git も止めないため、ここが唯一の防御になる

export const MAX_REMOTE_URL_LENGTH = 2048

export type RemoteUrlRuleViolation =
  | 'empty'
  | 'too-long'
  | 'invalid-char'
  | 'leading-dash'
  | 'unsupported'

export type RemoteUrlRuleOptions = {
  /** Windows のドライブの形(`C:\` `C:/`)を絶対パスとして許可するか。main は process.platform === 'win32'、
   *  renderer は platform を知らないため寛容側の true を渡す(最終判断は main) */
  windowsPaths: boolean
}

// 前後の空白だけを除く。NFC にはそろえない(URL の中の文字を変えると、サーバー側で別のパスになる)
export function normalizeRemoteUrl(url: string): string {
  return url.trim()
}

const NETWORK_SCHEMES = ['https', 'http', 'ssh', 'git'] as const

// 空白(\s。全角の空白・改行・タブを含む)と制御文字(C0・DEL・C1)と不可視の書式文字(Unicode の Cf: ゼロ幅の
// U+200B〜200F・双方向の制御 U+202A〜202E / U+2066〜2069・U+FEFF など)。git の remote add は改行を含む URL を
// そのまま受け付け、config に複数行の値として書く(実機で確認)。書式文字は画面に見えず、確認した URL と
// 実際に書かれる URL が食い違う(双方向の制御は表示の順序も入れ替える)ため拒否する
const INVISIBLE_PATTERN = /[\s\p{Cf}]/u

// 引用符(' " `)。git は失敗の文言で URL を引用符で囲んで出すことがある(remote add の
// `could not set 'remote.origin.url' to '<url>'`。実機 git 2.50.1 で確認)。URL の中の引用符は、資格情報を伏せる
// 処理(main の redactCredentials)の区切りと区別できず、`https://u:p'ss@h/r` は `https://u:p'***@h/r'` になって
// パスワードの一部が残る。git 自体は引用符を含む URL を受け付けるが、GitHub・GitLab などのリポジトリ名に引用符は
// 使えず、現実に要るのはローカルの絶対パス(`/repos/O'Brien/b.git` など)くらいのため、安全側に倒して拒否する
const QUOTE_PATTERN = /['"`]/

function hasInvalidChar(url: string): boolean {
  if (QUOTE_PATTERN.test(url)) return true
  for (const ch of url) {
    const code = ch.codePointAt(0) ?? 0
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || INVISIBLE_PATTERN.test(ch)) return true
  }
  return false
}

// 資格情報の扱い(利用者の決定): パスワード入りの URL は構造的に拒否し、認証は credential helper に任せる。
// 6 周のレビューで、userinfo(`user:pass@`)の区切り方の解釈違いで資格情報が漏れる穴が毎回見つかった(remote add の
// 失敗の文言・ssh:// の user:pw@・`@` を含むパスワード・`%XX` の decode・git:// の userinfo・引用符・userinfo の生の `/`・
// userinfo の `?` `#`)。個別に塞ぐのをやめ、許可する形を最小に定義する。authority の解析は parseNetworkUrl の 1 か所に
// まとめ、判定はそこから派生させる(判定の分散が穴の温床だった。パターン 88)

// authority の終わり。RFC 3986 と curl は最初の `/` `?` `#` で終わるとみなし、git(ssh:// と git://)は最初の `/` で
// 切る。許可する URL では両者が一致するよう、authority が `/` 以外で終わる形(`https://h#sec@h2/r`)を拒否する
const AUTHORITY_END_PATTERN = /[/?#]/

// authority の `@` より後(`host[:port]`)。host は `[IPv6]`(括弧の中は 16 進数・`:`・`.` だけ)か、`:` `@` `%` と
// 角括弧を含まない名前(reg-name・IPv4。IDN の全角も既存どおり通す)。port は数字だけ(空も可)。
// `%` を許可しない理由: git は ssh:// と git:// の URL 全体の `%XX` を元の文字に戻してから host と path を分ける
// (`ssh://alice%3Apw%40h/r` は ssh に `alice:pw@h` が渡り、`ssh://git@h%2Fx/r` は host が `h` になる。実機 git 2.50.1
// と偽の ssh で確認)。port の範囲(0・65535 超)は確かめない(git は失敗するだけで資格情報を出さない。実機で確認)。
// 空の port(`host:`)は git が既定のポートとして扱う(実機で確認)ため許可する
const HOST_PORT_PATTERN = /^(\[[0-9A-Fa-f:.]+\]|[^:@%[\]]+)(?::([0-9]*))?$/

export type NetworkScheme = (typeof NETWORK_SCHEMES)[number]

export type NetworkUrlParts = {
  scheme: NetworkScheme
  /** authority の最初の `@` より前。`@` が無ければ null */
  userinfo: string | null
  host: string
  /** `:` の後の数字(空文字もありうる)。`:` が無ければ null */
  port: string | null
  /** authority の後ろ(最初の `/` `?` `#` から末尾まで)。無ければ空文字 */
  pathAndAfter: string
}

// `<scheme>://<authority><pathAndAfter>` の構造を取り出す。スキームは小文字で完全一致。authority は最初の `/` `?` `#`
// まで、userinfo は authority の最初の `@` まで(2 個目以降の `@` は host に残り、HOST_PORT_PATTERN が拒否する)。
// host:port の形が崩れていれば null。許可するかどうかは isAllowedNetworkUrl が決める
export function parseNetworkUrl(url: string): NetworkUrlParts | null {
  const scheme = NETWORK_SCHEMES.find((name) => url.startsWith(`${name}://`))
  if (scheme === undefined) return null
  const rest = url.slice(`${scheme}://`.length)
  const end = rest.search(AUTHORITY_END_PATTERN)
  const authority = end === -1 ? rest : rest.slice(0, end)
  const pathAndAfter = end === -1 ? '' : rest.slice(end)
  const at = authority.indexOf('@')
  const userinfo = at === -1 ? null : authority.slice(0, at)
  const match = HOST_PORT_PATTERN.exec(authority.slice(at + 1))
  if (match === null) return null
  return { scheme, userinfo, host: match[1], port: match[2] ?? null, pathAndAfter }
}

// ssh:// の userinfo と scp 形式の user に許可する文字(パスワード無しのユーザー名だけ)。`:`(パスワードの区切り)・
// `%`(git が decode する)・`@` `/` `?` `#` と引用符・空白を含まない。`git`・`ec2-user`・`first.last+tag` は通る。
// 先頭の `-` は許可しない(ssh に -l... などのオプションとして渡るのを防ぐ。パターン 21)
const USER_NAME_PATTERN = /^[A-Za-z0-9._~+][A-Za-z0-9._~+-]*$/

// path(と query・fragment)の `@`。authority に `@` が無い URL で path に `@` があると、利用者が意図した userinfo
// の区切りと食い違う(`https://alice:1234/s3cret@h/r` は authority が `alice:1234` になり、port が数字のため host:port
// に見える。5・6 周目のレビュー)。git は ssh:// と git:// の `%40` も `@` に戻すため、`%40` も同じく扱う。正当な
// URL の path の `@` は稀なため、すべてのスキームで拒否する(既知の制約)
const PATH_AT_PATTERN = /@|%40/i

// ネットワークの URL として許可するか。
// - authority は `/` か末尾で終わる(`?` `#` で終わる形を拒否する)
// - path・query・fragment に `@`(`%40`)を含まない
// - host は `-` で始まらない(ssh に -oProxyCommand=... として渡るのを防ぐ。パターン 21)
// - userinfo は ssh:// のパスワード無しのユーザー名だけ。http・https・git:// は `@` があれば拒否する(user だけでも
//   トークンだけでも秘密になりうる。git:// は userinfo を解釈せず、host として失敗の文言に出す。実機で確認)
function isAllowedNetworkUrl(url: string): boolean {
  const parts = parseNetworkUrl(url)
  if (parts === null) return false
  const { scheme, userinfo, host, pathAndAfter } = parts
  if (pathAndAfter !== '' && !pathAndAfter.startsWith('/')) return false
  if (PATH_AT_PATTERN.test(pathAndAfter)) return false
  if (host.startsWith('-')) return false
  if (userinfo === null) return true
  return scheme === 'ssh' && USER_NAME_PATTERN.test(userinfo)
}

// file:// の直後が `/`(絶対パス)。file://host/... は許可しない
function isFileUrl(url: string): boolean {
  return url.startsWith('file:///')
}

// scp 形式 `<user>@<host>:<path>`。user は USER_NAME_PATTERN(パスワード無しのユーザー名だけ。`/ : @` を含まない)。
// host は `/` `:` `@` を含まず、`-` で始まらず、角括弧([::1] のような IPv6 の書き方)を含まない。path は空でない。
// user@ の無い `host:path`(ssh の設定の別名)は許可しない(利用者の決定)。scp 形式は git が `%XX` を decode しない
// (実機で確認)。path の `@` はネットワークの URL と同じく拒否する(`Ua1@Ub2:Pa3@h:r` は user `Ua1@Ub2`・パスワード `Pa3`
// のつもりでも、git は host を `Ub2`、path を `Pa3@h:r` と解釈し、パスワードが URL ごと失敗の文言に残る。性質テストで検出)
const SCP_PATTERN = /^([^/:@]+)@([^/:@[\]]+):([^@]+)$/

function isScpLike(url: string): boolean {
  const match = SCP_PATTERN.exec(url)
  return match !== null && USER_NAME_PATTERN.test(match[1]) && !match[2].startsWith('-')
}

const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/

// 絶対パス。相対パス(../bare.git)は開いているフォルダからの相対で解決され、フォルダが変わると別の場所を
// 指すため許可しない。Windows のドライブの形は windowsPaths のときだけ(macOS で `C:/x` は scp 形式になる)
function isAbsolutePath(url: string, windowsPaths: boolean): boolean {
  return url.startsWith('/') || (windowsPaths && WINDOWS_DRIVE_PATTERN.test(url))
}

// url は normalizeRemoteUrl 済みであること。判定の順序(empty → too-long → invalid-char → leading-dash →
// unsupported)は main と renderer で共有する(片方だけ変えると、ダイアログは通るのに main で拒否される)
export function getRemoteUrlRuleViolation(
  url: string,
  options: RemoteUrlRuleOptions
): RemoteUrlRuleViolation | null {
  if (url.length === 0) return 'empty'
  if (url.length > MAX_REMOTE_URL_LENGTH) return 'too-long'
  if (hasInvalidChar(url)) return 'invalid-char'
  if (url.startsWith('-')) return 'leading-dash'
  const allowed =
    isAllowedNetworkUrl(url) ||
    isFileUrl(url) ||
    isScpLike(url) ||
    isAbsolutePath(url, options.windowsPaths)
  return allowed ? null : 'unsupported'
}
```

`src/shared/remoteTimeout.ts`:

```ts
// push / pull / fetch / 初回 push で git を打ち切るまでの時間(stdout / stderr に何も出ない時間。simple-git の
// timeout プラグインの block)。main(gitRemoteTimeout の simpleGitWithRemoteTimeout)が打ち切りに使い、
// renderer(RemoteSetupBanner)が初回 push 中の案内「応答が N 秒途絶えると打ち切ります」に使う。
// 両者で別々の値を持つと、片方だけ変えても案内と実際の時間が食い違うため、ここで共有する(パターン 88)。
// 案内は秒で表すため、1000 の倍数にする(単体テストで固定)
export const GIT_REMOTE_TIMEOUT_MS = 30_000

// 初回 push 中の案内に出す秒数
export const GIT_REMOTE_TIMEOUT_SECONDS = GIT_REMOTE_TIMEOUT_MS / 1000
```

```bash
npx vitest run src/shared
```

Expected: PASS

- [ ] **Step 3: ミューテーション**

手順は Global Constraints のとおり（`mktemp -d` へ `cp` → 変異 → 落ちる → 復元 → `cmp`）。次の変異で、それぞれ該当のテストが落ちること（落ちない変異があればテストを足す）。

1. `normalizeInitialBranchName` の `.normalize('NFC')` を外す → NFD のテスト
2. `hasInvalidChar` の `(code >= 0x7f && code <= 0x9f)` を外す → DEL・C1 のテスト。`/\s/u.test(ch)` を外す → 空白・全角の空白・ext:: とコマンドのテスト。`INVISIBLE_PATTERN` の `\p{Cf}` を外す → 不可視の書式文字のテスト(U+FEFF は JS の `\s` にも含まれるため落ちない)。境界値を 1 つずらす(`0x1f`→`0x1e`、`0x7f`〜の先頭を `0x81`、`0x9f`→`0x9e`、`code !== 1` を足す)→ U+001F・U+0080・U+009F・U+0001 のテスト
3. （差分 24 で更新）`USER_NAME_PATTERN` の先頭の文字クラスに `-` を足す → `ssh://-l@host/a`。`if (host.startsWith('-')) return false` を外す → `ssh://-oProxyCommand=x/a`・`ssh://git@-oProxyCommand=x/a`（2 件）
4. `isFileUrl` を `url.startsWith('file://')` にする → `file://host/a`
5. `SCP_PATTERN` のホストの `[\]` を外す（`([^/:@]+)`）→ `git@[host]:a`（`git@[::1]:a` はホストの `:` で弾かれるため、角括弧の判定はこのケースで固定する）
6. `!match[2].startsWith('-')` を外す → `git@-x:a`
7. `windowsPaths &&` を外す → Windows のドライブの形の posix 側
8. 判定の順序を入れ替える（`leading-dash` を `invalid-char` より前）→ 順序のテスト（`-x y`）。`too-long` を `invalid-char` の後 → 順序のテスト
9. `url.length > MAX_REMOTE_URL_LENGTH` を `>=` にする → 最大長のテスト
10. `GIT_REMOTE_TIMEOUT_MS` を `30_500` にする → remoteTimeout のテスト
    11〜16. （差分 24 で置き換え）`isNetworkUrl`・`isSafeSshUserinfo`・`PATH_SEPARATOR_PATTERN` は `parseNetworkUrl` と `isAllowedNetworkUrl` に置き換えたため、変異は 17 に移した
11. （差分 24）shared の remoteUrl.test.ts で確かめた変異（mktemp -d のバックアップ → 変異 → 失敗の確認 → 復元 → cmp）:
    - `isAllowedNetworkUrl` の末尾 `return scheme === 'ssh' && USER_NAME_PATTERN.test(userinfo)` を `return true` にする（userinfo を許可）→ shared の 24 件。main の addOrigin（3 件）・renderer の `validateRemoteUrl`（3 件）・統合の addOrigin の拒否（4 件）・gitStepErrors の組み合わせのテスト（1 件）も落ちる
    - `PATH_AT_PATTERN` の判定を外す → 18 件（userinfo の生の `/` の 10 件・path・query・fragment の `@` など）
    - `pathAndAfter` が `/` で始まることの判定を外す → `https://h#frag`（1 件。`@` を含む `?` `#` の形は path の `@` の判定でも落ちる）
    - `HOST_PORT_PATTERN` の host の `%` の除外を外す → authority の `%XX` の 5 件と `parseNetworkUrl` の「host の %」（6 件）
    - `USER_NAME_PATTERN` に `:` `%` を足す → ssh の `user:pw`・空のパスワード・`%40` など 7 件
    - `USER_NAME_PATTERN` の先頭の文字クラスに `-` を足す → `ssh://-l@host/a`（1 件）
    - `SCP_PATTERN` の path の `[^@]+` を `.+` に戻す → scp の path の `@` の 2 件。`isScpLike` の `USER_NAME_PATTERN.test(match[1])` を外す → scp の user の記号・`%` の 2 件
    - `PATH_AT_PATTERN` を `/@/`（`%40` を見ない）にする → path の `%40` の 2 件
    - `if (host.startsWith('-')) return false` を外す → 2 件
    - `parseNetworkUrl` の `indexOf('@')` を `lastIndexOf('@')` にする → `parseNetworkUrl` の「authority の @ が 2 個」（1 件。判定の側は userinfo の文字種でも落ちる）
12. （差分 25）shared の remoteUrl.test.ts の「実在のホスティングサービスの URL」で確かめた変異:
    - `isAllowedNetworkUrl` の末尾を `return USER_NAME_PATTERN.test(userinfo)`（https の user だけの userinfo を許可）にする → Azure DevOps の `org@` 入りと Bitbucket の `alice@` 入りの 2 件
    - `if (userinfo === null) return true` を `return !host.includes('azure')` にする → Azure DevOps の `org@` を外した形の 1 件

- [ ] **Step 4: 検証**

```bash
npx vitest run src/shared
npm run typecheck
npx eslint src/shared/branchName.ts src/shared/remoteUrl.ts src/shared/remoteTimeout.ts src/shared/__tests__/branchName.test.ts src/shared/__tests__/remoteUrl.test.ts src/shared/__tests__/remoteTimeout.test.ts
npx prettier --check src/shared/branchName.ts src/shared/remoteUrl.ts src/shared/remoteTimeout.ts src/shared/__tests__/branchName.test.ts src/shared/__tests__/remoteUrl.test.ts src/shared/__tests__/remoteTimeout.test.ts
```

Expected: すべて成功

- [ ] **Step 5: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 2: `GitStatusResult` の拡張と `getGitStatus`（`hasOrigin` / `upstream` / `detached`）

**Files:**

- Modify: `src/shared/types/git.ts`, `src/main/gitService.ts`, `src/main/__tests__/gitService.test.ts`
- Create: `src/main/gitRemoteNames.ts`, `src/main/__tests__/gitRemoteNames.test.ts`, `src/main/__tests__/gitService.status.integration.test.ts`
- Modify: `src/main/__tests__/helpers/realGitRepo.ts`（`stubGitCeiling` を足す）
- Modify（フィクスチャ。Step 3 のスクリプトで機械的に更新）: `GitStatusResult` を作っている既存のテスト 21 ファイル（`src/main/__tests__/gitService.test.ts`、`src/main/__tests__/handlers/gitHandlers.test.ts`、`src/renderer/src/__tests__/setup.ts`、`src/renderer/src/components/__tests__/{App.amend,App.commit,App.diffTab,App.gitignore,Sidebar}.test.tsx`、`src/renderer/src/components/source-control/__tests__/{HistorySection,SourceControlPanel}.test.tsx`、`src/renderer/src/hooks/__tests__/{useAppState,useConflictFile,useDiscardAllChanges,useGitBranchOperations,useGitRemoteOperations,useGitStashOperations,useGitStatus,useGitTagOperations,useMergeState}.test.ts`、`src/renderer/src/lib/__tests__/{gitApi,gitUtils}.test.ts`）

**Interfaces:**

- Consumes: 統合テストのヘルパ（`src/main/__tests__/helpers/realGitRepo.ts` の `initRepo` / `commitAll` / `runGit` / `stubIsolatedGitEnv` / `writeRepoFile`）
- Produces: `stubGitCeiling(dir: string): void`（`realGitRepo.ts`。Task 4 の統合テストも使う）、`GitStatusResult` の `hasOrigin: boolean` / `hasRemote: boolean`（差分 26）/ `upstream: string | null` / `detached: boolean`、`ORIGIN_REMOTE` / `hasOriginRemote(git: SimpleGit): Promise<boolean>`（`src/main/gitRemoteNames.ts`。Task 4 が使う）/ `listRemoteNames(git: SimpleGit): Promise<string[]>`（`getGitStatus` が使う。差分 26）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/helpers/realGitRepo.ts` の `stubIsolatedGitEnv` の後に追加する（`fs` の import に `realpathSync` を足す。統合テストの `GIT_CEILING_DIRECTORIES` の stub をここに一本化する。パターン 55）:

```ts
// 対象の関数(simple-git が起動する git)が、dir より上のリポジトリ(TMPDIR がリポジトリの中にある環境など)を
// 拾わないよう、GIT_CEILING_DIRECTORIES を dir にする。git は dir の配下から上へリポジトリを探すとき、dir とそれより
// 上には上がらない(dir の配下は従来どおり探す)。git は物理パスで比較するため、symlink を解決して渡す(macOS の
// tmpdir() は /var → /private/var の symlink の配下)。stubIsolatedGitEnv と同じく afterEach の
// vi.unstubAllEnvs() で復元する
export function stubGitCeiling(dir: string): void {
  vi.stubEnv('GIT_CEILING_DIRECTORIES', realpathSync(dir))
}
```

`src/main/__tests__/gitRemoteNames.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SimpleGit } from 'simple-git'
import { ORIGIN_REMOTE, hasOriginRemote, listRemoteNames } from '../gitRemoteNames'

const mockRaw = vi.fn()
const git = { raw: mockRaw } as unknown as SimpleGit

beforeEach(() => {
  mockRaw.mockReset()
})

// getGitStatus の hasOrigin と、gitRemoteSetupService の追加・初回 push の検証が同じ判定を使う(パターン 88)
describe('hasOriginRemote', () => {
  it('アプリが扱うリモートの名前は origin', () => {
    expect(ORIGIN_REMOTE).toBe('origin')
  })

  it('git remote を引数どおりに呼び、origin の行があれば true', async () => {
    mockRaw.mockResolvedValue('upstream\norigin\n')
    await expect(hasOriginRemote(git)).resolves.toBe(true)
    expect(mockRaw).toHaveBeenCalledWith(['remote'])
  })

  // Windows の git は行末が \r\n になる(パターン 27)
  it('行末が \\r\\n でも true', async () => {
    mockRaw.mockResolvedValue('origin\r\n')
    await expect(hasOriginRemote(git)).resolves.toBe(true)
  })

  it.each([
    ['空', ''],
    ['origin 以外だけ', 'upstream\n'],
    ['前方一致・部分一致の別名', 'origin2\nmy-origin\n']
  ])('%s なら false', async (_label, output) => {
    mockRaw.mockResolvedValue(output)
    await expect(hasOriginRemote(git)).resolves.toBe(false)
  })

  it('git remote の失敗はそのまま投げる', async () => {
    mockRaw.mockRejectedValue(new Error('fatal: bad config'))
    await expect(hasOriginRemote(git)).rejects.toThrow('fatal: bad config')
  })
})

// getGitStatus が git remote を 1 回だけ呼び、hasOrigin と hasRemote をこの一覧から決める
describe('listRemoteNames', () => {
  it('git remote を引数どおりに呼び、行ごとの名前を返す', async () => {
    mockRaw.mockResolvedValue('github\norigin\n')
    await expect(listRemoteNames(git)).resolves.toEqual(['github', 'origin'])
    expect(mockRaw).toHaveBeenCalledWith(['remote'])
  })

  // Windows の git は行末が \r\n になる(パターン 27)
  it('行末が \\r\\n でも名前だけを返す', async () => {
    mockRaw.mockResolvedValue('github\r\norigin\r\n')
    await expect(listRemoteNames(git)).resolves.toEqual(['github', 'origin'])
  })

  it.each([
    ['空', ''],
    ['改行だけ', '\n'],
    ['\\r\\n だけ', '\r\n']
  ])('%s なら空の配列', async (_label, output) => {
    mockRaw.mockResolvedValue(output)
    await expect(listRemoteNames(git)).resolves.toEqual([])
  })

  it('git remote の失敗はそのまま投げる', async () => {
    mockRaw.mockRejectedValue(new Error('fatal: bad config'))
    await expect(listRemoteNames(git)).rejects.toThrow('fatal: bad config')
  })
})
```

`src/main/__tests__/gitService.test.ts` の `describe('getGitStatus', ...)` の中（`branch が null のとき` のテストの後）に追加:

```ts
describe('hasOrigin・hasRemote・upstream・detached', () => {
  // git remote と MERGE_HEAD の問い合わせを振り分ける(MERGE_HEAD は無い)
  const rawWithRemotes =
    (remotes: string) =>
    (args: string[]): Promise<string> =>
      Promise.resolve(args[0] === 'remote' ? remotes : '')

  it('git remote に origin の行があれば hasOrigin: true', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue(baseStatusResult)
    mockRaw.mockImplementation(rawWithRemotes('upstream\norigin\n'))
    const result = await getGitStatus('/project')
    expect(result.hasOrigin).toBe(true)
    expect(mockRaw).toHaveBeenCalledWith(['remote'])
  })

  it('origin が無ければ hasOrigin: false', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue(baseStatusResult)
    mockRaw.mockImplementation(rawWithRemotes('upstream\n'))
    const result = await getGitStatus('/project')
    expect(result.hasOrigin).toBe(false)
  })

  // hasRemote はリモートが 1 つでもあるか。origin 以外の名前のリモートだけ(git clone -o github など)でも真。
  // git remote は 1 回だけ呼び、hasOrigin と同じ出力から決める
  it.each([
    ['origin と別名', true, true, 'upstream\norigin\n'],
    ['origin 以外の名前だけ', false, true, 'github\n'],
    ['origin 以外の名前だけ(\\r\\n)', false, true, 'github\r\n'],
    ['リモートが無い', false, false, '']
  ])(
    'git remote が %s → hasOrigin: %s・hasRemote: %s',
    async (_label, hasOrigin, hasRemote, remotes) => {
      mockCheckIsRepo.mockResolvedValue(true)
      mockStatus.mockResolvedValue(baseStatusResult)
      mockRaw.mockImplementation(rawWithRemotes(remotes))
      const result = await getGitStatus('/project')
      expect(result).toMatchObject({ hasOrigin, hasRemote })
      expect(mockRaw.mock.calls.filter(([args]) => args[0] === 'remote')).toHaveLength(1)
    }
  )

  // gone(リモートの ref が消えた)でも simple-git は tracking に origin/<b> を返す(実機で確認)
  it.each([
    ['設定済み', 'origin/main', 'origin/main'],
    ['ローカルのブランチ', 'main', 'main'],
    ['未設定', null, null]
  ])('upstream は status.tracking(%s)', async (_label, tracking, expected) => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue({ ...baseStatusResult, tracking })
    const result = await getGitStatus('/project')
    expect(result.upstream).toBe(expected)
  })

  it('detached は status.detached', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue({ ...baseStatusResult, current: 'HEAD', detached: true })
    const result = await getGitStatus('/project')
    expect(result.detached).toBe(true)
    expect(result.upstream).toBeNull()
  })

  it('git remote の失敗は getGitStatus の失敗にする', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue(baseStatusResult)
    mockRaw.mockImplementation((args: string[]) =>
      args[0] === 'remote' ? Promise.reject(new Error('fatal: bad config')) : Promise.resolve('')
    )
    await expect(getGitStatus('/project')).rejects.toThrow('fatal: bad config')
  })
})
```

`src/main/__tests__/gitService.status.integration.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getGitStatus } from '../gitService'
import {
  commitAll,
  initRepo,
  runGit,
  stubGitCeiling,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'

// gitService.test.ts は simple-git をモックするため、status.tracking / status.detached が実際の git の状態で
// どうなるか(gone・ローカルの upstream・リベース中)は検証できない。ここで実 git で固定する
describe('getGitStatus の hasOrigin・hasRemote・upstream・detached(実 git)', () => {
  let root: string
  let repo: string
  let bare: string

  beforeEach(() => {
    stubIsolatedGitEnv()
    root = mkdtempSync(join(tmpdir(), 'status-remote-'))
    repo = join(root, 'repo')
    bare = join(root, 'remote.git')
    mkdirSync(repo)
    initRepo(repo)
    writeRepoFile(repo, 'a.txt', '1\n')
    commitAll(repo, 'first')
    runGit(root, 'init', '-q', '--bare', bare)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  it('origin が無ければ hasOrigin: false・upstream: null・detached: false', async () => {
    const status = await getGitStatus(repo)
    expect(status).toMatchObject({
      hasOrigin: false,
      hasRemote: false,
      upstream: null,
      detached: false
    })
  })

  it('origin を追加すると hasOrigin: true(upstream はまだ null)', async () => {
    runGit(repo, 'remote', 'add', 'origin', bare)
    const status = await getGitStatus(repo)
    expect(status).toMatchObject({
      hasOrigin: true,
      hasRemote: true,
      upstream: null,
      detached: false
    })
  })

  // remote.origin.url が無くても git remote は origin を出し、git remote add は already exists になる(実機で確認)
  it('remote.origin.fetch だけでも hasOrigin: true', async () => {
    runGit(repo, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*')
    expect((await getGitStatus(repo)).hasOrigin).toBe(true)
  })

  it('push -u の後は upstream: origin/main', async () => {
    runGit(repo, 'remote', 'add', 'origin', bare)
    runGit(repo, 'push', '-q', '-u', 'origin', 'main')
    expect((await getGitStatus(repo)).upstream).toBe('origin/main')
  })

  it('リモートの ref が消えた(gone)後も upstream は origin/main(設定済みとして扱う)', async () => {
    runGit(repo, 'remote', 'add', 'origin', bare)
    runGit(repo, 'push', '-q', '-u', 'origin', 'main')
    runGit(bare, 'update-ref', '-d', 'refs/heads/main')
    runGit(repo, 'fetch', '-q', '--prune', 'origin')
    expect((await getGitStatus(repo)).upstream).toBe('origin/main')
  })

  it('ローカルのブランチを upstream にすると、upstream はその名前', async () => {
    runGit(repo, 'branch', '--track', 'sub', 'main')
    runGit(repo, 'checkout', '-q', 'sub')
    expect((await getGitStatus(repo)).upstream).toBe('main')
  })

  it('detached HEAD では detached: true・upstream: null', async () => {
    runGit(repo, 'remote', 'add', 'origin', bare)
    runGit(repo, 'push', '-q', '-u', 'origin', 'main')
    runGit(repo, 'checkout', '-q', '--detach')
    const status = await getGitStatus(repo)
    expect(status).toMatchObject({ detached: true, upstream: null, hasOrigin: true })
  })

  it('リベースで止めている間も detached: true', async () => {
    writeRepoFile(repo, 'a.txt', '2\n')
    commitAll(repo, 'second')
    // --exec false で 1 つ目のコミットの後に止める(エディタを使わずに「リベース中」を作る)
    try {
      runGit(repo, 'rebase', '--exec', 'false', 'HEAD~1')
    } catch {
      // 意図した停止(終了コード 1)
    }
    expect((await getGitStatus(repo)).detached).toBe(true)
  })

  it('コミットの無いリポジトリでも branch は main・detached: false・upstream: null', async () => {
    const empty = join(root, 'empty')
    mkdirSync(empty)
    initRepo(empty)
    const status = await getGitStatus(empty)
    expect(status).toMatchObject({ branch: 'main', detached: false, upstream: null })
  })

  it('リポジトリでなければ false / null / false', async () => {
    const plain = join(root, 'plain')
    mkdirSync(plain)
    // tmpdir がリポジトリの中にある環境でも、親のリポジトリを拾わない
    stubGitCeiling(root)
    const status = await getGitStatus(plain)
    expect(status).toEqual({
      isRepo: false,
      branch: null,
      ahead: 0,
      behind: 0,
      files: [],
      mergeInProgress: false,
      hasOrigin: false,
      hasRemote: false,
      upstream: null,
      detached: false
    })
  })

  // バナー『リモートが未設定です』はリモートが 1 つも無いときだけ出す。origin 以外の名前のリモートだけを
  // 持つリポジトリ(git clone -o github など)では、既存の push / pull が通信できる(レビュー 8 周目)
  describe('hasRemote(リモートが 1 つでもあるか)', () => {
    it('リモートが 1 つも無いと hasOrigin・hasRemote とも false', async () => {
      expect(await getGitStatus(repo)).toMatchObject({ hasOrigin: false, hasRemote: false })
    })

    it('origin だけなら両方 true', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      expect(await getGitStatus(repo)).toMatchObject({ hasOrigin: true, hasRemote: true })
    })

    it('origin と別名の 2 つなら両方 true', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      runGit(repo, 'remote', 'add', 'github', bare)
      expect(await getGitStatus(repo)).toMatchObject({ hasOrigin: true, hasRemote: true })
    })

    it('git clone -o github したリポジトリでは hasRemote: true・hasOrigin: false・upstream: github/main', async () => {
      runGit(repo, 'push', '-q', bare, 'main')
      const clone = join(root, 'clone')
      runGit(root, 'clone', '-q', '-o', 'github', '-b', 'main', bare, clone)
      expect(await getGitStatus(clone)).toMatchObject({
        hasOrigin: false,
        hasRemote: true,
        upstream: 'github/main'
      })
      // 新しいブランチ(upstream が無い)でも hasRemote は true のまま
      runGit(clone, 'switch', '-q', '-c', 'feat')
      expect(await getGitStatus(clone)).toMatchObject({
        hasOrigin: false,
        hasRemote: true,
        upstream: null
      })
    })
  })
})
```

```bash
npx vitest run src/main/__tests__/gitRemoteNames.test.ts src/main/__tests__/gitService.test.ts src/main/__tests__/gitService.status.integration.test.ts
```

Expected: FAIL（`../gitRemoteNames` が無い、`hasOrigin` / `upstream` / `detached` が返らない）

- [ ] **Step 2: 型と実装を追加する**

`src/shared/types/git.ts` の `GitStatusResult` を次に置き換える:

```ts
export type GitStatusResult = {
  isRepo: boolean
  branch: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
  /** マージ中（`.git/MERGE_HEAD` がある）か。リポジトリでないときは false */
  mergeInProgress: boolean
  /** リモート origin があるか(`git remote` の出力に origin の行がある)。リポジトリでないときは false */
  hasOrigin: boolean
  /** リモートが 1 つでもあるか(`git remote` の出力が空でない)。origin 以外の名前のリモートだけ(git clone -o github
   *  など)でも真。バナー『リモートが未設定です』はこれが偽のときだけ出す。リポジトリでないときは false */
  hasRemote: boolean
  /** 現在のブランチの upstream の短い名前(simple-git の status.tracking。例: origin/main)。リモートの ref が
   *  消えた gone でも値が入る。未設定・detached HEAD・リポジトリでないときは null */
  upstream: string | null
  /** ブランチ上にいない(detached HEAD・リベース中・bisect 中)か。リポジトリでないときは false */
  detached: boolean
}
```

`src/main/gitRemoteNames.ts`:

```ts
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
```

`src/main/gitService.ts`:

- import に `import { ORIGIN_REMOTE, listRemoteNames } from './gitRemoteNames'` を足す（差分 26 で `hasOriginRemote` から変更）
- `getGitStatus` を次に置き換える:

```ts
export async function getGitStatus(folderPath: string): Promise<GitStatusResult> {
  const git = simpleGit(folderPath)
  const isRepo = await git.checkIsRepo()
  if (!isRepo) {
    return {
      isRepo: false,
      branch: null,
      ahead: 0,
      behind: 0,
      files: [],
      mergeInProgress: false,
      hasOrigin: false,
      hasRemote: false,
      upstream: null,
      detached: false
    }
  }
  // リモートの名前は git remote で 1 回だけ問い合わせ、origin の有無(hasOrigin)とリモートの有無(hasRemote)を
  // 同じ出力から決める。upstream と detached は git.status() の結果に含まれる(追加の git 呼び出しは無い)。
  // リモートのバナー(renderer の remoteSetupState)がこの 4 つで表示を決める
  const [status, mergeInProgress, remoteNames] = await Promise.all([
    git.status(),
    hasMergeInProgress(git),
    listRemoteNames(git)
  ])
  return {
    isRepo: true,
    branch: status.current,
    ahead: status.ahead,
    behind: status.behind,
    mergeInProgress,
    hasOrigin: remoteNames.includes(ORIGIN_REMOTE),
    hasRemote: remoteNames.length > 0,
    // gone(リモートの ref が消えた)でも origin/<b> が入る。既存の push は gone の upstream にも送れるため、
    // 「設定済み」として扱う(実機で確認)
    upstream: status.tracking ?? null,
    // `## HEAD (no branch)` のとき真。リベースで止めている間も真になる(実機で確認)
    detached: status.detached,
    files: status.files.map((f) => ({
      path: f.path,
      index: f.index,
      workingDir: f.working_dir,
      // simple-git はリネームのとき from に旧パスを入れる。undefined の
      // プロパティを持たせるとテストの toEqual や IPC の構造化クローンで
      // 余計な差異になるため、値があるときだけ含める
      ...(f.from === undefined ? {} : { from: f.from })
    }))
  }
}
```

- [ ] **Step 3: 既存のフィクスチャを機械的に更新する**

`GitStatusResult` を作っている既存のテストは、すべて `isRepo: <値>,` の次の行が `mergeInProgress: <値>,`（または `mergeInProgress,`）になっている（プラン作成時に 21 ファイル・45 か所を確認）。その直後に 4 つのフィールド（`hasRemote` は差分 26 で追加）を足すスクリプトを、`mktemp -d` の中に作って実行する（リポジトリの中にスクリプトを残さない）。`isRepo: false` のフィクスチャは `false` / `null` / `false`、それ以外は「upstream 設定済み」（`true` / `'origin/main'` / `false`）にする。既存のテストにリモートのバナーを出さないため。

```bash
WORK=$(mktemp -d)
cat > "$WORK/add-status-fields.mjs" <<'SCRIPT'
import { readFileSync, writeFileSync } from 'node:fs'

let total = 0
for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const out = []
  let count = 0
  lines.forEach((line, index) => {
    out.push(line)
    const match = /^(\s*)mergeInProgress(: [^,]+)?,$/.exec(line)
    if (match === null) return
    if ((lines[index + 1] ?? '').trim().startsWith('hasOrigin')) return
    const previous = lines[index - 1] ?? ''
    if (!previous.includes('isRepo:')) throw new Error(`${file}:${index + 1}: 直前の行が isRepo ではありません`)
    const notRepo = previous.includes('isRepo: false')
    const indent = match[1]
    out.push(`${indent}hasOrigin: ${notRepo ? 'false' : 'true'},`)
    out.push(`${indent}hasRemote: ${notRepo ? 'false' : 'true'},`)
    out.push(`${indent}upstream: ${notRepo ? 'null' : "'origin/main'"},`)
    out.push(`${indent}detached: false,`)
    count += 1
  })
  writeFileSync(file, out.join('\n'))
  total += count
  console.log(`${file}: ${count}`)
}
console.log(`total: ${total}`)
SCRIPT
grep -rlE '^\s*mergeInProgress(: [^,]+)?,$' src | grep -v '^src/main/gitService.ts$' | sort | xargs node "$WORK/add-status-fields.mjs"
rm -rf "$WORK"
```

Expected: 21 ファイル、`total: 45`（差分 26 では、`RemoteSetupFlow.test.tsx` を含む 22 ファイル・53 か所の `hasOrigin: <値>` の隣に同じ値の `hasRemote` を足した）。`src/main/__tests__/gitService.test.ts` の `Git リポジトリでない場合 isRepo: false を返す` の期待値にも `hasOrigin: false` / `upstream: null` / `detached: false` が入る（新しい戻り値の形そのもの）。

- [ ] **Step 4: 通過を確認する**

```bash
npx vitest run src/main/__tests__/gitRemoteNames.test.ts src/main/__tests__/gitService.test.ts src/main/__tests__/gitService.status.integration.test.ts
npm run typecheck
npm test
```

Expected: PASS（typecheck も成功。フィクスチャの追加漏れがあれば typecheck が `Property 'hasOrigin' is missing` で示すので、同じ値を手で足す）

- [ ] **Step 5: ミューテーション**

1. `hasOriginRemote` の `split(/\r?\n/)` を `split('\n')` にする → `\r\n` のテスト
2. `includes(ORIGIN_REMOTE)` を `some((l) => l.startsWith('origin'))` にする → 前方一致のテスト
3. `getGitStatus` の `upstream: status.tracking ?? null` を `upstream: null` にする → 単体の upstream と統合の push -u・gone・ローカルの upstream
4. `detached: status.detached` を `detached: false` にする → 単体の detached と統合の detached・リベース中
5. `isRepo: false` の分岐の `hasOrigin: false` を外す → 型エラーになることを確認し（typecheck）、戻す
6. `Promise.all` から `hasOriginRemote(git)` を外して `hasOrigin: false` にする → 単体の hasOrigin: true と統合の origin を追加（差分 26 の後は `listRemoteNames(git)` を外す形になる）
7. （差分 26）`hasRemote: remoteNames.length > 0` を `hasRemote: remoteNames.includes(ORIGIN_REMOTE)` にする（新フィールドを origin の有無と同じにする）→ 単体の「origin 以外の名前だけ」2 件と統合の `git clone -o github`（3 件）
8. （差分 26）`listRemoteNames` の `.filter((name) => name !== '')` を外す → `listRemoteNames` の空・改行だけ・行末の改行と、`getGitStatus` の「リモートが無い」、統合の「リモートが 1 つも無い」など（7 件）

- [ ] **Step 6: 検証**

```bash
npx vitest run src/main
npm run typecheck
npx eslint src/main/gitService.ts src/main/gitRemoteNames.ts src/shared/types/git.ts src/main/__tests__/gitRemoteNames.test.ts src/main/__tests__/gitService.test.ts src/main/__tests__/gitService.status.integration.test.ts
(git diff --name-only --diff-filter=d; git ls-files --others --exclude-standard) | grep -E '\.tsx?$' | xargs npx prettier --check
```

Expected: すべて成功

- [ ] **Step 7: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 3: `gitService.ts` の部品の切り出し（ブランチ名の検証・現在のブランチ・リモートのタイムアウト）

振る舞いは変えない。既存の `gitService.test.ts`（`createBranch` / `mergeBranch` / `push` / `pull` / `fetchRemote`）がそのまま通ることで固定し、切り出した部品には単体テストを足す。

**Files:**

- Create: `src/main/gitBranchNameGuard.ts`, `src/main/gitHeadState.ts`, `src/main/gitRemoteTimeout.ts`, `src/main/gitStepErrors.ts`, `src/main/__tests__/gitBranchNameGuard.test.ts`, `src/main/__tests__/gitHeadState.test.ts`, `src/main/__tests__/gitRemoteTimeout.test.ts`, `src/main/__tests__/gitStepErrors.test.ts`
- Modify: `src/main/gitService.ts`, `src/main/gitTagService.ts`（`errorDetail` と打ち切りの判定の直書き・失敗の文言の組み立てを `gitStepErrors` に置き換える。import の差し替えと関数の中身の置き換えだけ。既存の `gitTagService.test.ts` がそのまま通る）

**Interfaces:**

- Consumes: Task 1 の `GIT_REMOTE_TIMEOUT_MS`
- Produces（Task 4 が使う）:
  - `assertValidNewBranchName(git: SimpleGit, branchName: string): Promise<void>`、`invalidBranchNameError(branchName: string): Error`（`src/main/gitBranchNameGuard.ts`）
  - `getCurrentBranchRef(git: SimpleGit): Promise<string | null>`（`src/main/gitHeadState.ts`。`refs/heads/<b>` か `null`）
  - `simpleGitWithRemoteTimeout(folderPath: string, timeoutMs?: number): SimpleGit`、`toRemoteOperationError(err: unknown): unknown`、`REMOTE_OPERATION_TIMEOUT_MESSAGE`（`src/main/gitRemoteTimeout.ts`）
  - `isGitTimeoutError(err: unknown): boolean`、`errorDetail(err: unknown): string`、`failure(prefix: string, detail: string): Error`、`toStepError(err: unknown, timeoutMessage: string, failurePrefix: string, redact?: (detail: string) => string): Error`（`redact` の既定は恒等。差分 19）、`redactCredentials(text: string): string`、`runGitStep<T>(run: () => Promise<T>, toError: (err: unknown) => Error): Promise<T>`（`src/main/gitStepErrors.ts`。打ち切りの判定は通信を伴わない init・remote add・git tag にも使うため、リモート用の `gitRemoteTimeout` には置かない）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/gitBranchNameGuard.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SimpleGit } from 'simple-git'
import { assertValidNewBranchName, invalidBranchNameError } from '../gitBranchNameGuard'

const mockRaw = vi.fn()
const git = { raw: mockRaw } as unknown as SimpleGit

beforeEach(() => {
  mockRaw.mockReset()
})

// ブランチの作成(gitService の createBranch)とリポジトリの初期化(gitRemoteSetupService の initRepository)が
// 同じ検証を使う(パターン 55・88)。重複・階層の衝突の判定は作成側に残す(初期化にはブランチが無い)
describe('assertValidNewBranchName', () => {
  // '-' 始まりは check-ref-format 自体にもオプションとして解釈されるため、git に渡す前に弾く(パターン 21)
  it("'-' で始まる名前は git を呼ばずに専用の文言で拒否する", async () => {
    await expect(assertValidNewBranchName(git, '-x')).rejects.toThrow(
      '`-` で始まるブランチ名は使用できません: -x'
    )
    expect(mockRaw).not.toHaveBeenCalled()
  })

  it.each(['', '@'])('%j は git を呼ばずに「使用できない名前」で拒否する', async (name) => {
    await expect(assertValidNewBranchName(git, name)).rejects.toThrow(
      `ブランチ名として使用できない名前です: ${name}`
    )
    expect(mockRaw).not.toHaveBeenCalled()
  })

  it('check-ref-format --branch の出力(trim)が入力と一致すれば通す', async () => {
    mockRaw.mockResolvedValue('feat/x\n')
    await expect(assertValidNewBranchName(git, 'feat/x')).resolves.toBeUndefined()
    expect(mockRaw).toHaveBeenCalledWith(['check-ref-format', '--branch', 'feat/x'])
  })

  // --branch は @{-1} を直前のブランチ名へ展開して成功扱いにする(パターン 25)
  it('出力が入力と違えば拒否する', async () => {
    mockRaw.mockResolvedValue('main\n')
    await expect(assertValidNewBranchName(git, '@{-1}')).rejects.toThrow(
      'ブランチ名として使用できない名前です: @{-1}'
    )
  })

  // HEAD・a..b・main.lock などは check-ref-format が GitError で reject する(実機で確認)
  it('check-ref-format の reject も同じ文言で拒否する', async () => {
    mockRaw.mockRejectedValue(new Error("fatal: 'a..b' is not a valid branch name"))
    await expect(assertValidNewBranchName(git, 'a..b')).rejects.toThrow(
      'ブランチ名として使用できない名前です: a..b'
    )
  })

  it('invalidBranchNameError は共通の文言を作る', () => {
    expect(invalidBranchNameError('x').message).toBe('ブランチ名として使用できない名前です: x')
  })
})
```

`src/main/__tests__/gitHeadState.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SimpleGit } from 'simple-git'
import { getCurrentBranchRef } from '../gitHeadState'

const mockRaw = vi.fn()
const git = { raw: mockRaw } as unknown as SimpleGit

beforeEach(() => {
  mockRaw.mockReset()
})

// マージ(gitService の isOnBranch)と初回 push(gitRemoteSetupService)が同じ判定を使う(パターン 55)
describe('getCurrentBranchRef', () => {
  it('ブランチ上なら refs/heads/<name> を返す', async () => {
    mockRaw.mockResolvedValue('refs/heads/feat/x\n')
    await expect(getCurrentBranchRef(git)).resolves.toBe('refs/heads/feat/x')
    expect(mockRaw).toHaveBeenCalledWith(['symbolic-ref', '-q', 'HEAD'])
  })

  // detached・リベース中・bisect 中は終了コード 1・stderr 空で、simple-git は空文字で resolve する(実機で確認)
  it('空の出力(ブランチ上にいない)なら null', async () => {
    mockRaw.mockResolvedValue('')
    await expect(getCurrentBranchRef(git)).resolves.toBeNull()
  })

  it('refs/heads/ 以外を指す HEAD は null', async () => {
    mockRaw.mockResolvedValue('refs/remotes/origin/main\n')
    await expect(getCurrentBranchRef(git)).resolves.toBeNull()
  })

  it('reject はそのまま投げる(握りつぶさない。パターン 74)', async () => {
    mockRaw.mockRejectedValue(new Error('fatal: not a git repository'))
    await expect(getCurrentBranchRef(git)).rejects.toThrow('fatal: not a git repository')
  })
})
```

`src/main/__tests__/gitRemoteTimeout.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const MockGitError = vi.hoisted(() => class MockGitError extends Error {})
const MockGitPluginError = vi.hoisted(
  () =>
    class MockGitPluginError extends MockGitError {
      plugin?: string
      constructor(_task?: unknown, plugin?: string, message?: string) {
        super(message)
        this.plugin = plugin
      }
    }
)
const mockSimpleGit = vi.hoisted(() => vi.fn(() => ({})))

vi.mock('simple-git', () => ({
  default: mockSimpleGit,
  GitError: MockGitError,
  GitPluginError: MockGitPluginError
}))

import { GIT_REMOTE_TIMEOUT_MS } from '@shared/remoteTimeout'
import {
  REMOTE_OPERATION_TIMEOUT_MESSAGE,
  simpleGitWithRemoteTimeout,
  toRemoteOperationError
} from '../gitRemoteTimeout'

beforeEach(() => {
  vi.clearAllMocks()
})

// push / pull / fetch(gitService)と初回 push(gitRemoteSetupService)が同じ打ち切りと文言を使う
describe('simpleGitWithRemoteTimeout', () => {
  // progress を渡さないと --progress が付かず、転送中でも stderr に何も流れずに誤って打ち切られる
  it('既定は GIT_REMOTE_TIMEOUT_MS の打ち切りと no-op の progress で作る', () => {
    simpleGitWithRemoteTimeout('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      timeout: { block: GIT_REMOTE_TIMEOUT_MS },
      progress: expect.any(Function)
    })
  })

  it('timeoutMs を渡すとその値で打ち切る(テストで実時間を待たないため。パターン 84)', () => {
    simpleGitWithRemoteTimeout('/project', 500)
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      timeout: { block: 500 },
      progress: expect.any(Function)
    })
  })
})

// 打ち切りの判定そのもの(isGitTimeoutError)の網羅は gitStepErrors.test.ts で行う(パターン 55)
describe('toRemoteOperationError', () => {
  it('timeout プラグインの GitPluginError は、原因の推測を添えた日本語の Error にする', () => {
    const err = new MockGitPluginError(undefined, 'timeout', 'block timeout reached')
    const converted = toRemoteOperationError(err)
    expect(converted).toBeInstanceOf(Error)
    expect((converted as Error).message).toBe(REMOTE_OPERATION_TIMEOUT_MESSAGE)
    expect(REMOTE_OPERATION_TIMEOUT_MESSAGE).toBe(
      '操作がタイムアウトしました。認証情報が未設定か、ネットワークに問題がある可能性があります'
    )
  })

  it.each([
    ['timeout 以外のプラグイン', new MockGitPluginError(undefined, 'unsafe', 'x')],
    ['GitError', new MockGitError('fatal: x')],
    ['Error 以外', 'string']
  ])('%s はそのまま返す', (_label, err) => {
    expect(toRemoteOperationError(err)).toBe(err)
  })
})
```

`src/main/__tests__/gitStepErrors.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { GitError, GitPluginError } from 'simple-git'
import {
  errorDetail,
  failure,
  isGitTimeoutError,
  redactCredentials,
  runGitStep,
  toStepError
} from '../gitStepErrors'
import { getRemoteUrlRuleViolation } from '@shared/remoteUrl'

// git の呼び出しの失敗の変換(リモートの管理・タグの作成・push/pull/fetch が共有する)。実物の simple-git の
// エラーで確かめる(モックの継承関係のずれで判定の誤りを見逃さないため)
const timeoutError = (): GitPluginError =>
  new GitPluginError(undefined, 'timeout', 'block timeout reached')

describe('isGitTimeoutError', () => {
  it('timeout プラグインの GitPluginError は真', () => {
    expect(isGitTimeoutError(timeoutError())).toBe(true)
  })

  it.each([
    ['timeout 以外のプラグインの GitPluginError', new GitPluginError(undefined, 'unsafe', 'x')],
    ['GitError', new GitError(undefined, 'fatal: x')],
    ['通常の Error', new Error('block timeout reached')],
    ['plugin が timeout の通常のオブジェクト', { plugin: 'timeout' }],
    ['Error 以外', 'string']
  ])('%s は偽', (_label, err) => {
    expect(isGitTimeoutError(err)).toBe(false)
  })
})

describe('errorDetail', () => {
  it('Error はメッセージの前後の空白を除いて返す', () => {
    expect(errorDetail(new GitError(undefined, '\n fatal: x \n'))).toBe('fatal: x')
  })

  it.each([
    ['文字列', '  boom  ', 'boom'],
    ['数値', 42, '42'],
    ['undefined', undefined, 'undefined']
  ])('Error 以外(%s)は文字列にして前後の空白を除く', (_label, err, expected) => {
    expect(errorDetail(err)).toBe(expected)
  })
})

describe('failure', () => {
  it('detail があれば「接頭辞: 詳細」', () => {
    expect(failure('リモートを追加できませんでした', 'fatal: x').message).toBe(
      'リモートを追加できませんでした: fatal: x'
    )
  })

  it('detail が空なら接頭辞だけ', () => {
    const err = failure('リモートを追加できませんでした', '')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('リモートを追加できませんでした')
  })
})

describe('toStepError', () => {
  it('打ち切りは時間切れの文言', () => {
    expect(toStepError(timeoutError(), '時間切れ', '失敗').message).toBe('時間切れ')
  })

  it('それ以外は git のメッセージを添えた失敗の文言', () => {
    expect(toStepError(new GitError(undefined, ' fatal: x\n'), '時間切れ', '失敗').message).toBe(
      '失敗: fatal: x'
    )
  })

  it('メッセージが空なら接頭辞だけ', () => {
    expect(toStepError(new GitError(undefined, '  '), '時間切れ', '失敗').message).toBe('失敗')
  })

  // remote add は config.lock が残っていると `fatal: could not set 'remote.origin.url' to '<url>'` で失敗し、
  // URL を資格情報ごと出す(実機 git 2.50.1 で確認)。呼び出し側が redact を渡すと、詳細を伏せてから添える
  it('redact を渡すと、詳細を伏せてから添える', () => {
    const err = new GitError(
      undefined,
      "fatal: could not set 'remote.origin.url' to 'https://alice:ghp_TOKEN123@github.com/a/b.git'"
    )
    expect(toStepError(err, '時間切れ', '失敗', redactCredentials).message).toBe(
      "失敗: fatal: could not set 'remote.origin.url' to 'https://***@github.com/a/b.git'"
    )
  })

  it('redact を渡さなければ、詳細をそのまま添える(タグ・push などの既存の呼び出し元)', () => {
    expect(toStepError(new GitError(undefined, 'fatal: a@b:c'), '時間切れ', '失敗').message).toBe(
      '失敗: fatal: a@b:c'
    )
  })
})

describe('redactCredentials', () => {
  it.each([
    [
      'https の user:pass',
      'https://alice:ghp_TOKEN123@github.com/a/b.git',
      'https://***@github.com/a/b.git'
    ],
    ['http の user:pass', 'http://u:p@example.com/a.git', 'http://***@example.com/a.git'],
    ['ssh の user:pass と port', 'ssh://alice:pw@host:22/a.git', 'ssh://***@host:22/a.git'],
    [
      'git の user:pass',
      'git://alice:s3cret@127.0.0.1:19418/b.git',
      'git://***@127.0.0.1:19418/b.git'
    ],
    ['file の userinfo', 'file://u:p@/abs/a.git', 'file://***@/abs/a.git'],
    ['パスワードの無い user@', 'https://alice@github.com/a.git', 'https://***@github.com/a.git'],
    ['トークンだけ', 'https://ghp_TOKEN123@github.com/a.git', 'https://***@github.com/a.git'],
    ['パスの無い URL', 'https://u:p@host', 'https://***@host'],
    ['userinfo に @ を含む', 'https://a@b:p@host/x', 'https://***@host/x'],
    ['大文字のスキーム(git が整形した形)', 'HTTPS://u:p@host/x', 'HTTPS://***@host/x'],
    ['scp 形式の user', 'git@github.com:a/b.git', '***@github.com:a/b.git'],
    [
      'ホスト名として出た user:pass',
      'unable to look up alice:s3cret@127.0.0.1:19418 (port 9418)',
      'unable to look up ***@127.0.0.1:19418 (port 9418)'
    ]
  ])('%s を伏せる', (_label, text, expected) => {
    expect(redactCredentials(text)).toBe(expected)
  })

  it('引用符で囲まれた URL を伏せ、引用符は残す', () => {
    expect(redactCredentials('to \'https://a:b@h/x\' and "u@h:p"')).toBe(
      'to \'https://***@h/x\' and "***@h:p"'
    )
  })

  it('複数の URL をすべて伏せる', () => {
    expect(redactCredentials('https://a:1@h1/x ssh://b:2@h2/y c@h3:z')).toBe(
      'https://***@h1/x ssh://***@h2/y ***@h3:z'
    )
  })

  it.each([
    ['URL の無い文', 'fatal: could not lock config file .git/config: File exists'],
    ['userinfo の無い URL', "fatal: unable to access 'https://github.com/a/b.git/': x"],
    ['パスの中の @', 'https://host/a@b/c'],
    ['空文字', '']
  ])('%s は変えない', (_label, text) => {
    expect(redactCredentials(text)).toBe(text)
  })

  it('scp 形式は user だけを伏せ、host と path は残す', () => {
    expect(redactCredentials('fatal: git@example.com:team/repo.git not found')).toBe(
      'fatal: ***@example.com:team/repo.git not found'
    )
  })

  // ssh は `ssh://u:p@ss@127.0.0.1/r` への push で `u:p@ss@127.0.0.1: Permission denied (publickey).` と出す
  // (3 周目のレビューで実機の sshd で確認)。scp 形式の側も、語の中の最後の `@` までを伏せる。URL の検証は
  // authority の `@` を 1 個までに制限する(@shared/remoteUrl)が、`%40` は git が `@` に戻して ssh に渡し、
  // 利用者が端末で追加した origin は検証を通らない
  it.each([
    [
      'ssh の Permission denied',
      'u:p@ss@127.0.0.1: Permission denied (publickey).',
      '***@127.0.0.1: Permission denied (publickey).'
    ],
    [
      'ssh の Could not resolve hostname',
      'ssh: Could not resolve hostname u:p@ss@h: nodename nor servname provided',
      'ssh: Could not resolve hostname ***@h: nodename nor servname provided'
    ],
    ['引用符で囲まれた語', "to 'u:p@ss@h:r'", "to '***@h:r'"],
    [
      'remote add の失敗の文言',
      "could not set 'remote.origin.url' to 'ssh://u:p@ss@h/r'",
      "could not set 'remote.origin.url' to 'ssh://***@h/r'"
    ],
    [
      'https の unable to access',
      "fatal: unable to access 'https://u:p@ss@h/r/'",
      "fatal: unable to access 'https://***@h/r/'"
    ]
  ])('パスワードに @ を含む userinfo(%s)を最後の @ まで伏せる', (_label, text, expected) => {
    expect(redactCredentials(text)).toBe(expected)
  })
})

// 性質テスト(パターン 59): userinfo 付きの URL を組み合わせで作り、URL の検証(@shared/remoteUrl)を通ったものを git・ssh の
// 典型的な失敗の文言に埋め込んで、資格情報(user・パスワード)が出力に残らないことを確かめる。検証はパスワード入りの URL を
// 構造的に拒否する(利用者の決定。認証は credential helper に任せる)ため、通るのは ssh:// のパスワード無しのユーザー名
// だけになる。redactCredentials はその user 名も伏せる(防御の 2 層)。パスワード入りの形を伏せる単体のテストは、
// 検証と独立して上の describe に残す(端末で追加した origin への push の文言など、検証を通らない URL も届くため)。
// ssh の文言には、git が `%XX` を戻した形(sshAuthority)を埋め込む
describe('redactCredentials と URL の検証の組み合わせ', () => {
  const users = ['UsrQx7', 'ghp_TokQx7']
  const passwords = [null, 'PwdZk9', 'Pw%40dZk9', 'Pw@dZk9', 'Pw:dZk9']
  const hosts = ['h.example', '127.0.0.1']
  const schemes = ['https', 'http', 'ssh']
  const candidates = schemes.flatMap((scheme) =>
    users.flatMap((user) =>
      passwords.flatMap((password) =>
        hosts.map((host) => {
          const userinfo = password === null ? user : `${user}:${password}`
          return {
            url: `${scheme}://${userinfo}@${host}/team/r.git`,
            authority: `${userinfo}@${host}`,
            sshAuthority: `${decodeURIComponent(userinfo)}@${host}`,
            host,
            secrets: [user, ...(password === null ? [] : password.split(/%40|@|:/))]
          }
        })
      )
    )
  )
  const allowed = candidates.filter(
    ({ url }) => getRemoteUrlRuleViolation(url, { windowsPaths: false }) === null
  )
  const templates: [string, (c: (typeof candidates)[number]) => string][] = [
    ['Permission denied', (c) => `${c.sshAuthority}: Permission denied (publickey).`],
    ['could not set', (c) => `fatal: could not set 'remote.origin.url' to '${c.url}'`],
    [
      'unable to access',
      (c) => `fatal: unable to access '${c.url}/': The requested URL returned error: 403`
    ],
    [
      'Could not resolve hostname',
      (c) => `ssh: Could not resolve hostname ${c.sshAuthority}: nodename nor servname provided`
    ],
    [
      'Connection refused',
      (c) =>
        `fatal: unable to access '${c.url}': Failed to connect to ${c.host} port 443: Connection refused`
    ]
  ]

  it('検証はパスワード入りの URL をすべて拒否し、ssh:// のユーザー名だけを通す(組み合わせが空にならない)', () => {
    expect(allowed.length).toBeGreaterThan(0)
    expect(allowed.every(({ url }) => url.startsWith('ssh://'))).toBe(true)
    expect(allowed.every(({ secrets }) => secrets.length === 1)).toBe(true)
  })

  it.each(templates)('%s の文言に埋め込んだ資格情報が残らない', (_label, render) => {
    for (const candidate of allowed) {
      const text = render(candidate)
      const out = redactCredentials(text)
      for (const secret of candidate.secrets) expect(out, text).not.toContain(secret)
      expect(out, text).toContain(candidate.host)
    }
  })
})

describe('runGitStep', () => {
  it('成功したら結果をそのまま返し、toError を呼ばない', async () => {
    const toError = vi.fn(() => new Error('x'))
    await expect(runGitStep(async () => 'ok', toError)).resolves.toBe('ok')
    expect(toError).not.toHaveBeenCalled()
  })

  it('失敗したら元のエラーを toError で変換して投げる', async () => {
    const original = new GitError(undefined, 'fatal: x')
    const converted = new Error('変換後')
    const toError = vi.fn(() => converted)
    await expect(
      runGitStep(async () => {
        throw original
      }, toError)
    ).rejects.toBe(converted)
    expect(toError).toHaveBeenCalledWith(original)
  })
})
```

```bash
npx vitest run src/main/__tests__/gitBranchNameGuard.test.ts src/main/__tests__/gitHeadState.test.ts src/main/__tests__/gitRemoteTimeout.test.ts src/main/__tests__/gitStepErrors.test.ts
```

Expected: FAIL（モジュールが無い）

- [ ] **Step 2: 部品を作る**

`src/main/gitBranchNameGuard.ts`:

```ts
import type { SimpleGit } from 'simple-git'
import { getBranchNameRuleViolation } from '@shared/branchName'

// ブランチ名が不正なときのエラー。形式違反(アプリ独自の規則・git の check-ref-format)は
// 原則この同じ文言にし、呼び出し元(エラーバナー・ダイアログ)が違反の種類を区別する必要が無いように
// する。例外は '-' 始まりで、直し方が明確なため assertValidNewBranchName が専用の文言を返す
export function invalidBranchNameError(branchName: string): Error {
  return new Error(`ブランチ名として使用できない名前です: ${branchName}`)
}

// 新しいブランチ名(ブランチの作成・リポジトリの初期化の最初のブランチ)として、名前の形式が正しいかを検証する。
// branchName は IPC 境界から届く任意の文字列のため、次の順で検証する(前の検証に失敗したら後の git 呼び出しには
// 進まない)。gitService の createBranch と gitRemoteSetupService の initRepository が使う(パターン 55・88):
// 1. アプリ独自の規則(@shared/branchName)。'-' 始まりは check-ref-format 自体にもオプションとして
//    解釈されるため、git に渡す前に弾く(パターン 21)。'@' のみは `git checkout @` が HEAD と解釈され、
//    作成後に切り替えられない
// 2. git 本体の規則(`..`、空白、`~^:?*[\`、末尾の .lock、HEAD 等)は check-ref-format --branch に委ねる。
//    --branch は '@{-1}'(直前のブランチ)を実在のブランチ名へ展開して成功扱いにするため、出力(正規化後の名前)が
//    入力と一致することも確認する(パターン 25)。reject(不正な名前・git が起動できない)も拒否する(パターン 74)。
//    リポジトリの外でも動く(実機 git 2.50.1 で確認)
export async function assertValidNewBranchName(git: SimpleGit, branchName: string): Promise<void> {
  const violation = getBranchNameRuleViolation(branchName)
  if (violation === 'leading-dash') {
    throw new Error(`\`-\` で始まるブランチ名は使用できません: ${branchName}`)
  }
  if (violation !== null) throw invalidBranchNameError(branchName)
  let normalized: string
  try {
    normalized = (await git.raw(['check-ref-format', '--branch', branchName])).trim()
  } catch {
    throw invalidBranchNameError(branchName)
  }
  if (normalized !== branchName) throw invalidBranchNameError(branchName)
}
```

`src/main/gitHeadState.ts`:

```ts
import type { SimpleGit } from 'simple-git'

const HEADS_NAMESPACE = 'refs/heads/'

// HEAD が指すブランチの完全な ref 名(refs/heads/<name>)。ブランチ上にいなければ null。
// simple-git の branchLocal() の summary.detached は使わない: `git branch -v` の先頭行が `(HEAD detached at X)` /
// `(HEAD detached from X)` の形のときしか detached と認識せず、rebase 中の `(no branch, rebasing main)` や
// bisect 中の `(no branch, bisect started on main)` は current: "(no"・detached: false と解析されるため、
// rebase を edit で止めている間などに検証をすり抜けてしまう(実機で確認)。
// symbolic-ref -q HEAD はブランチ上なら `refs/heads/<name>` を返し、ブランチ上にいなければ
// (detached・rebase 中・bisect 中)終了コード 1・stderr 空で終わる。simple-git は reject せず空文字で resolve する。
// コミットの無いリポジトリでも refs/heads/<name> を返す。gitService の isOnBranch(マージ)と
// gitRemoteSetupService の pushSetUpstream が同じ判定を使う(パターン 55)
export async function getCurrentBranchRef(git: SimpleGit): Promise<string | null> {
  const ref = (await git.raw(['symbolic-ref', '-q', 'HEAD'])).trim()
  // HEAD が refs/heads/ 以外(refs/remotes/origin/main など)を指す状態は `git symbolic-ref HEAD <ref>` で作れる。
  // 旧実装の isOnBranch(空でなければブランチ上)では、その状態でマージするとリモート追跡 ref を更新していた。
  // ここではブランチ上にいないと扱い、マージも初回 push も拒否する(ガードが厳しくなる方向の変化)
  return ref.startsWith(HEADS_NAMESPACE) ? ref : null
}
```

`src/main/gitStepErrors.ts`:

```ts
import { GitPluginError } from 'simple-git'

// git の呼び出しの失敗を、操作の文脈の日本語の Error にする共通の部品。リモートの管理(gitRemoteSetupService)・
// タグの作成(gitTagService)・push/pull/fetch(gitRemoteTimeout)が使う。打ち切りの判定は通信を伴わない操作
// (init・remote add・git tag)にも使うため、リモート用の gitRemoteTimeout ではなくここに置く(パターン 55)。
// 文言(接頭辞・時間切れの文言)は呼び出し側が持ち、ここは組み立てだけを担う

// simple-git の timeout プラグインが打ち切ったか(英語の固定文言 "block timeout reached" の GitPluginError を投げる)
export function isGitTimeoutError(err: unknown): boolean {
  return err instanceof GitPluginError && err.plugin === 'timeout'
}

// 失敗に添える詳細(git のメッセージ)。前後の空白・改行を除く
export function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message.trim() : String(err).trim()
}

// 「接頭辞: 詳細」の失敗。詳細が空なら接頭辞だけ(末尾に「: 」を残さない)
export function failure(prefix: string, detail: string): Error {
  return new Error(detail === '' ? prefix : `${prefix}: ${detail}`)
}

// 防御の 2 層: URL の検証(@shared/remoteUrl)はパスワード入りの URL を構造的に拒否する(利用者の決定。認証は credential
// helper に任せる)。http・https・git:// の userinfo、ssh:// の `user:pw@`・`%XX`、path の `@` はアプリから追加できない。
// そのため、ここ(マスク)だけが守る入力は減り、アプリが追加した URL で残るのは scp 形式の user・ssh:// の user(パスワード
// 無しのユーザー名)と、git が出力に含める URL(端末で追加した origin への push の文言など、検証を通っていない URL を
// 含む)になる。検証の取りこぼしに備え、パスワード入りの形を伏せる処理と過剰マスクの注意はそのまま維持する

// URL の userinfo(`<scheme>://user:pass@`)。`://` の後、最初の `/`・空白・引用符までの最後の `@` まで。
// スキームは問わない(git が小文字にそろえたり、未知のスキームのまま出したりしても効く)。
// userinfo に生の `/` がある URL(`https://user:pa/ss@h/r`)は `user:pa` が残るが、`/` を越えて最後の `@` まで伏せる
// 形にすると `repository 'https://host/a@b/' not found` が `https://***@b/` になり、ホストとパスを消す(5 周目の
// レビューで確認)。その URL は検証(@shared/remoteUrl の path の `@` の拒否)が拒否するため、ここは変えない
const URL_USERINFO_PATTERN = /:\/\/[^/\s'"`]+@/g
// scp 形式の user(`user@host:path`)と、ホスト名として出た `user:pass@host`(git:// は userinfo を解釈せず、
// `unable to look up alice:s3cret@host` と出す。実機で確認)。語の先頭(行頭・空白・引用符の直後)から、語の中の
// 最後の `@`(直後が `@` でない)まで。貪欲に一致させ、パスワードに `@` を含む `u:p@ss@host`(ssh の
// `u:p@ss@127.0.0.1: Permission denied (publickey).`。3 周目のレビューで実機の sshd で確認)も `ss` を残さない。
// URL の検証は ssh:// の `user:pw@` と `%XX` を拒否するが、git は `%40` を `@` に戻して ssh に渡すため、端末で追加した
// `ssh://u:p%40ss@h/r` への push では ssh が `u:p@ss@h: …` と出す(実機 git 2.50.1 と偽の ssh で確認)。その防御として残す
// `/` を含む語(`https://host/a@b` のパス)は対象にしない。host と path は残す
const SCP_USERINFO_PATTERN = /(^|[\s'"`])[^\s/'"`]+@(?=[^@\s/'"`])/g

// 文中の URL の資格情報(userinfo)を `***` に伏せる。git の失敗のメッセージは、https の push のように資格情報を
// 取り除いて出す場合と、remote add の `could not set 'remote.origin.url' to '<url>'`(config.lock が残っていたとき)
// のように URL をそのまま出す場合がある(実機 git 2.50.1 で確認)。入力した URL の完全一致ではなく形で伏せる
// (git が整形した形にも効かせる)。パスワードの無い user@ も伏せる(トークンだけを user に置く書き方があるため)。
// 引用符を区切りとして扱うため、userinfo に引用符を含む URL(`https://u:p'ss@h/r`)ではその前の部分が残る。
// URL の検証(@shared/remoteUrl の invalid-char)が引用符を拒否するため、アプリが追加した URL はここに来ない前提
// (利用者が端末で追加した origin への初回 push の文言はこの限りでない)
export function redactCredentials(text: string): string {
  return text.replace(URL_USERINFO_PATTERN, '://***@').replace(SCP_USERINFO_PATTERN, '$1***@')
}

// git の呼び出しの失敗を、操作の文脈の日本語にする。timeout プラグインの打ち切り(英語の固定文言)は時間切れの
// 文言、それ以外は git のメッセージを添えた失敗の文言(英語の GitError をそのまま見せない。パターン 74)。
// git の出力は URL の資格情報を伏せる場合と伏せない場合があるため、利用者が入力した URL を扱う呼び出し側は
// redact(redactCredentials)を渡して詳細を伏せる。既定は詳細をそのまま添える(タグの作成など URL を扱わない操作)
export function toStepError(
  err: unknown,
  timeoutMessage: string,
  failurePrefix: string,
  redact: (detail: string) => string = (detail) => detail
): Error {
  if (isGitTimeoutError(err)) return new Error(timeoutMessage)
  return failure(failurePrefix, redact(errorDetail(err)))
}

// git の呼び出し 1 つを実行し、失敗を toError で変換して投げる。アプリ自身の検証の Error は包まない
export async function runGitStep<T>(
  run: () => Promise<T>,
  toError: (err: unknown) => Error
): Promise<T> {
  try {
    return await run()
  } catch (err) {
    throw toError(err)
  }
}
```

`src/main/gitRemoteTimeout.ts`:

```ts
import simpleGit from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { GIT_REMOTE_TIMEOUT_MS } from '@shared/remoteTimeout'
import { isGitTimeoutError } from './gitStepErrors'

// push/pull/fetch/初回 push はネットワークI/Oを伴う。認証プロンプト待ち(認証情報未設定で
// 端末から起動した場合、git が /dev/tty を開いてプロンプトを出し誰も応答しない)や
// 到達不能なホストへの接続では、タイムアウトが無いと simple-git の Promise が
// 永久に解決せず、呼び出し元(useGitRemoteOperations.ts)の実行中フラグが true の
// まま戻らずボタンが恒久的に disabled のまま固まる(pull の場合は共有ロックも
// 解除されず commit/ハンク操作まで巻き添えになる、runGitApply の
// GIT_APPLY_TIMEOUT_MS と同じ理由)。simple-git 標準の timeout プラグイン
// (stdout/stderr に一定時間データが来ないと強制終了する)を使う。
// env() 経由で GIT_TERMINAL_PROMPT 等を渡す方式は、blockUnsafeOperationsPlugin が
// GIT_SSH_COMMAND 等の継承環境変数を検査して GitPluginError を投げる既存の地雷
// (getLog 参照)を再び踏むため採用しない。
// 元は gitService.ts の非公開の関数だったが、初回 push(gitRemoteSetupService)も同じ打ち切りを使うため
// 切り出した(振る舞いは変えていない)。timeoutMs はテストで実時間を待たないための引数(パターン 84)
export function simpleGitWithRemoteTimeout(
  folderPath: string,
  timeoutMs: number = GIT_REMOTE_TIMEOUT_MS
): SimpleGit {
  return simpleGit(folderPath, {
    timeout: { block: timeoutMs },
    // git は stderr が tty に接続されていないと既定で進捗行を出力しない。
    // simple-git は progress オプションを渡した場合のみ push/pull/fetch に
    // --progress を自動付与する(渡さないと timeout プラグインが見ている
    // stdout/stderr に実際の転送中(圧縮・送受信)も何も流れず、正常に進行中の
    // 操作まで誤ってタイムアウトしてしまう)。--progress は引数の末尾に足されるため、
    // push の引数に `--` を使うと --progress が refspec として扱われて失敗する(実機で確認)。
    // コールバックの中身は使わないため no-op
    progress: () => {}
  })
}

export const REMOTE_OPERATION_TIMEOUT_MESSAGE =
  '操作がタイムアウトしました。認証情報が未設定か、ネットワークに問題がある可能性があります'

// timeout プラグインが投げる GitPluginError のメッセージは "block timeout
// reached" という固定の英語の内部文字列で、ユーザーに見せても原因が伝わらない
// (アプリの他の文言はすべて日本語)。plugin === 'timeout' のときだけ、原因の
// 推測もセットにした日本語メッセージへ差し替える。それ以外の GitPluginError
// (timeout プラグイン以外が投げたもの)は素通しする
export function toRemoteOperationError(err: unknown): unknown {
  if (isGitTimeoutError(err)) return new Error(REMOTE_OPERATION_TIMEOUT_MESSAGE)
  return err
}
```

- [ ] **Step 3: `gitService.ts` を部品に置き換える**

`src/main/gitService.ts`:

- `import simpleGit, { GitError, GitPluginError } from 'simple-git'` を `import simpleGit, { GitError } from 'simple-git'` にする
- `import { findConflictingBranchName, getBranchNameRuleViolation } from '@shared/branchName'` を `import { findConflictingBranchName } from '@shared/branchName'` にする
- import に追加:

```ts
import { assertValidNewBranchName } from './gitBranchNameGuard'
import { getCurrentBranchRef } from './gitHeadState'
import { simpleGitWithRemoteTimeout, toRemoteOperationError } from './gitRemoteTimeout'
```

- 「push/pull/fetch はネットワークI/Oを伴う。…」のコメントから `toRemoteOperationError` の関数の終わりまで（`const GIT_REMOTE_TIMEOUT_MS = 30_000`・`simpleGitWithRemoteTimeout`・`toRemoteOperationError` とそのコメント）を削除する（`gitRemoteTimeout.ts` へ移した）。`push` の前のコメント（「既に origin が設定され、…」）は残す
- 「ブランチ名が不正なときのエラー。…」のコメントと `invalidBranchNameError` を削除し、`assertCreatableBranchName` を次に置き換える:

```ts
// 新しいブランチ名として使えるかを検証する。branchName は IPC 境界から届く任意の文字列の
// ため、次の順で検証する(前の検証に失敗したら後の git 呼び出しには進まない):
// 1・2. 名前の形式(アプリ独自の規則と git の check-ref-format --branch)。リポジトリの初期化と
//    共有する(gitBranchNameGuard の assertValidNewBranchName)
// 3. 同名の既存ブランチ、および階層が衝突する既存ブランチ('main' に対する 'main/sub' 等)は、
//    checkout -b の失敗(英語のエラー文)を見せる前に日本語で弾く
async function assertCreatableBranchName(git: SimpleGit, branchName: string): Promise<void> {
  await assertValidNewBranchName(git, branchName)
  const summary = await git.branchLocal()
  if (summary.all.includes(branchName)) {
    throw new Error(`同じ名前のブランチが既に存在します: ${branchName}`)
  }
  const conflicting = findConflictingBranchName(branchName, summary.all)
  if (conflicting !== null) {
    throw new Error(`既存のブランチ ${conflicting} と名前が衝突します: ${branchName}`)
  }
}
```

- `isOnBranch` のコメントと本体を次に置き換える:

```ts
// HEAD がブランチを指しているか。判定の理由(branchLocal().detached を使わない)は gitHeadState の
// getCurrentBranchRef を参照(初回 push と同じ判定を使う)
async function isOnBranch(git: SimpleGit): Promise<boolean> {
  return (await getCurrentBranchRef(git)) !== null
}
```

- [ ] **Step 4: 通過を確認する**

```bash
npx vitest run src/main
npm run typecheck
```

Expected: PASS（既存の `gitService.test.ts` の `createBranch` / `mergeBranch` / `push` / `pull` / `fetchRemote` と、`gitService.merge.integration.test.ts` もそのまま通る）

- [ ] **Step 5: ミューテーション**

1. `assertValidNewBranchName` の `normalized !== branchName` の比較を外す → `@{-1}` のテストと、既存の `gitService.test.ts` の `createBranch` の `@{-1}` のテスト
2. `catch` で `invalidBranchNameError` を投げずに `return` する → reject のテスト
3. `getCurrentBranchRef` の `startsWith(HEADS_NAMESPACE)` を `ref !== ''` にする → `refs/remotes/...` のテスト
4. `simpleGitWithRemoteTimeout` の `progress` を外す → gitRemoteTimeout のテストと、既存の `gitService.test.ts` の push / pull / fetch の `simpleGit` の引数のテスト
5. `isGitTimeoutError`（gitStepErrors）の `err.plugin === 'timeout'` を外す → gitStepErrors の `timeout 以外のプラグインの GitPluginError` のテスト。`instanceof GitPluginError` を `plugin` の有無だけの判定にする → `plugin が timeout の通常のオブジェクト` のテスト
6. `failure` の `detail === ''` の分岐を外す → gitStepErrors の「detail が空なら接頭辞だけ」、既存の `gitTagService.test.ts` の作成後の確認で見つからないケース
7. `errorDetail` の `trim()` を外す → gitStepErrors の Error / Error 以外のテスト
8. `runGitStep` で `toError` を通さずに元のエラーを投げる → gitStepErrors の runGitStep のテスト
9. （差分 19）`redactCredentials` の `URL_USERINFO_PATTERN` の置換を外す → `://` の userinfo の 14 件。`SCP_USERINFO_PATTERN` の置換を外す → scp 形式・ホスト名として出た `user:pass@`・引用符・複数の URL の 5 件。`URL_USERINFO_PATTERN` を最初の `@` までにする（`[^/@\s'"\`]+@`）→ 「userinfo に @ を含む」。`toStepError`で`redact` を通さない → 「redact を渡すと、詳細を伏せてから添える」と Task 4 の統合の config.lock
10. （差分 21）`SCP_USERINFO_PATTERN` を語の先頭から最初の `@` までの形（`[^@\s/'"`]+@`）に戻す → 「パスワードに @ を含む userinfo（ssh の Permission denied・Could not resolve hostname・引用符で囲まれた語）を最後の @ まで伏せる」の 3 件（差分 24 で更新: 検証がパスワード入りの URL を拒否するようになり、性質テストの組み合わせに `Pw@dZk9` が入らなくなったため、性質テストの 2 件は落ちなくなった。マスク単体の 3 件で固定する）。検証の側を固定するテストは Task 1 の 17

- [ ] **Step 6: 検証**

```bash
npx vitest run src/main
npm run typecheck
npx eslint src/main/gitService.ts src/main/gitTagService.ts src/main/gitBranchNameGuard.ts src/main/gitHeadState.ts src/main/gitRemoteTimeout.ts src/main/gitStepErrors.ts src/main/__tests__/gitBranchNameGuard.test.ts src/main/__tests__/gitHeadState.test.ts src/main/__tests__/gitRemoteTimeout.test.ts src/main/__tests__/gitStepErrors.test.ts
npx prettier --check src/main/gitService.ts src/main/gitTagService.ts src/main/gitBranchNameGuard.ts src/main/gitHeadState.ts src/main/gitRemoteTimeout.ts src/main/gitStepErrors.ts src/main/__tests__/gitBranchNameGuard.test.ts src/main/__tests__/gitHeadState.test.ts src/main/__tests__/gitRemoteTimeout.test.ts src/main/__tests__/gitStepErrors.test.ts
```

Expected: すべて成功（`gitService.ts` に未使用の import が残っていれば eslint が示す）

- [ ] **Step 7: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 4: `gitRemoteSetupService.ts`（`initRepository`・`addOrigin`・`pushSetUpstream`。モック単体 + 実 git 統合）

**Files:**

- Create: `src/main/gitRemoteSetupService.ts`, `src/main/__tests__/gitRemoteSetupService.test.ts`, `src/main/__tests__/gitRemoteSetupService.integration.test.ts`

**Interfaces:**

- Consumes: Task 1 の `normalizeInitialBranchName` / `normalizeRemoteUrl` / `getRemoteUrlRuleViolation` / `MAX_REMOTE_URL_LENGTH` / `GIT_REMOTE_TIMEOUT_MS`、Task 2 の `ORIGIN_REMOTE` / `hasOriginRemote`、Task 3 の `assertValidNewBranchName` / `getCurrentBranchRef` / `simpleGitWithRemoteTimeout` / `REMOTE_OPERATION_TIMEOUT_MESSAGE` / `isGitTimeoutError` / `failure` / `toStepError` / `runGitStep`、統合テストのヘルパ（`realGitRepo.ts`。Task 2 の `stubGitCeiling` を含む）
- Produces: `initRepository(folderPath: string, branch: string, timeoutMs?: number): Promise<void>`、`addOrigin(folderPath: string, url: string, timeoutMs?: number, windowsPaths?: boolean): Promise<void>`、`pushSetUpstream(folderPath: string, timeoutMs?: number): Promise<void>`、`REMOTE_SETUP_LOCAL_TIMEOUT_MS`、文言の定数（`ALREADY_REPOSITORY_MESSAGE` / `INIT_TIMEOUT_MESSAGE` / `NOT_REPOSITORY_MESSAGE` / `ORIGIN_EXISTS_MESSAGE` / `ADD_ORIGIN_TIMEOUT_MESSAGE` / `NO_ORIGIN_FOR_PUSH_MESSAGE` / `NOT_ON_BRANCH_FOR_PUSH_MESSAGE` / `NO_COMMIT_FOR_PUSH_MESSAGE` / `UPSTREAM_CONFIG_EXISTS_MESSAGE` / `UPSTREAM_NOT_CONFIRMED_MESSAGE` / `FOLDER_NOT_FOUND_MESSAGE` / `REMOTE_URL_RULE_MESSAGES`。テストで使う）

- [ ] **Step 1: 単体テスト（モック）を書く（`src/main/__tests__/gitRemoteSetupService.test.ts`）**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// simple-git の GitError(git プロセスが失敗した)と、プラグイン(timeout 等)が投げるエラーのモック
const MockGitError = vi.hoisted(() => class MockGitError extends Error {})
const MockGitPluginError = vi.hoisted(
  () =>
    class MockGitPluginError extends MockGitError {
      plugin?: string
      constructor(_task?: unknown, plugin?: string, message?: string) {
        super(message)
        this.plugin = plugin
      }
    }
)
// フォルダが存在しないとき、simpleGit() の生成そのものが投げる(英語の固定文言)
const MockGitConstructError = vi.hoisted(() => class MockGitConstructError extends MockGitError {})
const mockRaw = vi.hoisted(() => vi.fn())
const mockCheckIsRepo = vi.hoisted(() => vi.fn())
const mockSimpleGit = vi.hoisted(() =>
  vi.fn(() => ({ raw: mockRaw, checkIsRepo: mockCheckIsRepo }))
)

vi.mock('simple-git', () => ({
  default: mockSimpleGit,
  GitError: MockGitError,
  GitPluginError: MockGitPluginError,
  GitConstructError: MockGitConstructError
}))

import { GIT_REMOTE_TIMEOUT_MS } from '@shared/remoteTimeout'
import { REMOTE_OPERATION_TIMEOUT_MESSAGE } from '../gitRemoteTimeout'
import {
  ADD_ORIGIN_TIMEOUT_MESSAGE,
  ALREADY_REPOSITORY_MESSAGE,
  FOLDER_NOT_FOUND_MESSAGE,
  INIT_TIMEOUT_MESSAGE,
  NOT_ON_BRANCH_FOR_PUSH_MESSAGE,
  NOT_REPOSITORY_MESSAGE,
  NO_COMMIT_FOR_PUSH_MESSAGE,
  NO_ORIGIN_FOR_PUSH_MESSAGE,
  ORIGIN_EXISTS_MESSAGE,
  REMOTE_SETUP_LOCAL_TIMEOUT_MS,
  REMOTE_URL_RULE_MESSAGES,
  UPSTREAM_CONFIG_EXISTS_MESSAGE,
  UPSTREAM_NOT_CONFIRMED_MESSAGE,
  addOrigin,
  initRepository,
  pushSetUpstream
} from '../gitRemoteSetupService'

const HEAD_SHA = `${'a'.repeat(40)}\n`
const timeoutError = (): Error =>
  new MockGitPluginError(undefined, 'timeout', 'block timeout reached')

type RawOptions = {
  /** check-ref-format --branch の名前ごとの結果(省略時は入力の名前そのままを出力)。Error なら reject */
  checkRefFormat?: (name: string) => string | Error
  /** rev-parse --git-dir の結果(省略時は not a git repository で reject = リポジトリの外)。Error なら reject */
  gitDir?: string | Error
  init?: Error
  /** symbolic-ref -q HEAD の出力(省略時 refs/heads/main) */
  headRef?: string
  /** git remote の出力(省略時は空) */
  remotes?: string | Error
  remoteAdd?: Error
  /** config --get remote.origin.url の出力(省略時は remote add に渡した URL) */
  originUrl?: string
  /** rev-parse -q --verify HEAD の出力(省略時はコミットあり) */
  headCommit?: string
  /** for-each-ref --format=%(upstream:short) の出力(省略時は空=upstream なし) */
  upstream?: string
  push?: Error
  /** push の前の config --get branch.<b>.remote / merge の出力(省略時は空=設定なし) */
  existingBranchRemote?: string
  existingBranchMerge?: string
  /** push の後の config --get branch.<b>.remote / merge の出力(省略時は origin と headRef) */
  branchRemote?: string
  branchMerge?: string
}

const notRepositoryError = (): Error =>
  new MockGitError('fatal: not a git repository (or any of the parent directories): .git\n')

// 問い合わせを種類で振り分ける。出力の前提は一時ディレクトリの実 git 2.50.1・simple-git 3.36.0 で確認済み:
// - check-ref-format --branch は成功時に名前を出力し、不正な名前は GitError で reject する
// - symbolic-ref -q HEAD・rev-parse -q --verify HEAD・config --get は、無いと終了コード 1・stderr 空で、
//   simple-git は空文字で resolve する
const setupRaw = (o: RawOptions = {}): void => {
  const headRef = o.headRef ?? 'refs/heads/main\n'
  let addedUrl = ''
  let pushed = false
  mockRaw.mockImplementation(async (args: string[]) => {
    const [command] = args
    if (command === 'check-ref-format') {
      const result = o.checkRefFormat?.(args[2]) ?? `${args[2]}\n`
      if (result instanceof Error) throw result
      return result
    }
    if (command === 'init') {
      if (o.init !== undefined) throw o.init
      return 'Initialized empty Git repository\n'
    }
    if (command === 'symbolic-ref') return headRef
    if (command === 'remote' && args[1] === 'add') {
      if (o.remoteAdd !== undefined) throw o.remoteAdd
      addedUrl = args[4]
      return ''
    }
    if (command === 'remote') {
      if (o.remotes instanceof Error) throw o.remotes
      return o.remotes ?? ''
    }
    if (command === 'config' && args[2] === 'remote.origin.url') {
      return o.originUrl ?? `${addedUrl}\n`
    }
    if (command === 'config' && args[2].endsWith('.remote')) {
      return pushed ? (o.branchRemote ?? 'origin\n') : (o.existingBranchRemote ?? '')
    }
    if (command === 'config' && args[2].endsWith('.merge')) {
      return pushed ? (o.branchMerge ?? headRef) : (o.existingBranchMerge ?? '')
    }
    if (command === 'rev-parse' && args[1] === '--git-dir') {
      const result = o.gitDir ?? notRepositoryError()
      if (result instanceof Error) throw result
      return result
    }
    if (command === 'rev-parse') return o.headCommit ?? HEAD_SHA
    if (command === 'for-each-ref') return o.upstream ?? ''
    if (command === 'push') {
      if (o.push !== undefined) throw o.push
      pushed = true
      return ''
    }
    throw new Error(`unexpected raw: ${args.join(' ')}`)
  })
}

const rawCalls = (): string[][] => mockRaw.mock.calls.map((call) => call[0] as string[])
const calledCommands = (): string[] => rawCalls().map((args) => args[0])

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckIsRepo.mockReset()
  mockRaw.mockReset()
})

describe('initRepository', () => {
  beforeEach(() => {
    mockCheckIsRepo.mockResolvedValue(false)
  })

  it('check-ref-format → checkIsRepo → rev-parse --git-dir → init → symbolic-ref の順に、名前を 1 引数で渡す', async () => {
    setupRaw()
    await initRepository('/project', 'main')
    expect(rawCalls()).toEqual([
      ['check-ref-format', '--branch', 'main'],
      ['rev-parse', '--git-dir'],
      ['init', '--initial-branch=main'],
      ['symbolic-ref', '-q', 'HEAD']
    ])
    // checkIsRepo は check-ref-format の後、init の前
    const checkOrder = mockCheckIsRepo.mock.invocationCallOrder[0]
    expect(checkOrder).toBeGreaterThan(mockRaw.mock.invocationCallOrder[0])
    expect(checkOrder).toBeLessThan(mockRaw.mock.invocationCallOrder[1])
  })

  // 作成中のダイアログは閉じられないため、最長の待ち時間を保証する(パターン 84・85)
  it('simple-git は 30 秒の打ち切りで作り、timeoutMs で差し替えられる', async () => {
    setupRaw()
    expect(REMOTE_SETUP_LOCAL_TIMEOUT_MS).toBe(30_000)
    await initRepository('/project', 'main')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      timeout: { block: REMOTE_SETUP_LOCAL_TIMEOUT_MS }
    })
    await initRepository('/project', 'main', 500)
    expect(mockSimpleGit).toHaveBeenLastCalledWith('/project', { timeout: { block: 500 } })
  })

  // 入口で 1 回だけ正規化し、以後の検証・init・確認・文言はその名前を使う(パターン 83)
  it('前後の空白を除き NFC にそろえた名前で検証・初期化・確認する', async () => {
    setupRaw({ headRef: 'refs/heads/caf\u00e9\n' })
    await initRepository('/project', '  cafe\u0301 ')
    expect(rawCalls()).toEqual([
      ['check-ref-format', '--branch', 'caf\u00e9'],
      ['rev-parse', '--git-dir'],
      ['init', '--initial-branch=caf\u00e9'],
      ['symbolic-ref', '-q', 'HEAD']
    ])
  })

  it("'-' で始まる名前は git を呼ばずに拒否する", async () => {
    setupRaw()
    await expect(initRepository('/project', '-x')).rejects.toThrow(
      '`-` で始まるブランチ名は使用できません: -x'
    )
    expect(mockRaw).not.toHaveBeenCalled()
    expect(mockCheckIsRepo).not.toHaveBeenCalled()
  })

  it.each(['', '   ', '@'])('%j は git を呼ばずに拒否する', async (name) => {
    setupRaw()
    await expect(initRepository('/project', name)).rejects.toThrow(
      `ブランチ名として使用できない名前です: ${name.trim()}`
    )
    expect(mockRaw).not.toHaveBeenCalled()
  })

  // git init は HEAD・refs/heads/foo などを通し、a..b などは失敗しても .git を残す(実機で確認)。git に任せない
  it.each([
    ['reject', new MockGitError("fatal: 'HEAD' is not a valid branch name")],
    ['出力が入力と違う', 'main\n']
  ])(
    'check-ref-format が %s なら拒否し、checkIsRepo にも init にも進まない',
    async (_label, result) => {
      setupRaw({ checkRefFormat: (name) => (name === 'HEAD' ? result : `${name}\n`) })
      await expect(initRepository('/project', 'HEAD')).rejects.toThrow(
        'ブランチ名として使用できない名前です: HEAD'
      )
      expect(mockCheckIsRepo).not.toHaveBeenCalled()
      expect(calledCommands()).not.toContain('init')
    }
  )

  // 壊れた .git ファイルがあると check-ref-format --branch はどの名前でも失敗する(実機で確認。差分 1)。
  // 名前の誤りと見せず、git がこのフォルダで動かないことを初期化の失敗として伝える
  it('check-ref-format が名前と関係なく失敗するなら、初期化の失敗にする', async () => {
    setupRaw({ checkRefFormat: () => new MockGitError('fatal: not a git repository: /x\n') })
    await expect(initRepository('/project', 'feat')).rejects.toThrow(
      'リポジトリを初期化できませんでした: fatal: not a git repository: /x'
    )
    expect(rawCalls()).toEqual([
      ['check-ref-format', '--branch', 'feat'],
      ['check-ref-format', '--branch', 'main']
    ])
    expect(mockCheckIsRepo).not.toHaveBeenCalled()
  })

  // 既存のリポジトリに git init すると終了コード 0 で再初期化され、--initial-branch は無視される(実機で確認)
  it('既にリポジトリ(親を含む)なら拒否し、init しない', async () => {
    setupRaw()
    mockCheckIsRepo.mockResolvedValue(true)
    await expect(initRepository('/project', 'main')).rejects.toThrow(ALREADY_REPOSITORY_MESSAGE)
    expect(calledCommands()).not.toContain('init')
  })

  // bare リポジトリと .git ディレクトリ(とその中)では、checkIsRepo(--is-inside-work-tree)は false だが、
  // rev-parse --git-dir は成功する(実機で確認)。git init すると中に .git が作られてしまう
  it.each(['.', '/repo/.git'])(
    'checkIsRepo が偽でも rev-parse --git-dir が成功(%s)すれば拒否し、init しない',
    async (gitDir) => {
      setupRaw({ gitDir: `${gitDir}\n` })
      await expect(initRepository('/project', 'main')).rejects.toThrow(ALREADY_REPOSITORY_MESSAGE)
      expect(calledCommands()).not.toContain('init')
    }
  )

  // checkIsRepo が偽で resolve した直後の rev-parse --git-dir の reject は、リポジトリの外(not a git repository・
  // 終了コード 128)。文言では分岐しない(パターン 18)。打ち切りだけは区別し、init に進まない
  it('rev-parse --git-dir の打ち切りは時間切れの文言にし、init しない', async () => {
    setupRaw({ gitDir: timeoutError() })
    await expect(initRepository('/project', 'main')).rejects.toThrow(INIT_TIMEOUT_MESSAGE)
    expect(calledCommands()).not.toContain('init')
  })

  it('rev-parse --git-dir の打ち切り以外の reject は、リポジトリの外として初期化する', async () => {
    setupRaw({ gitDir: new MockGitError('fatal: something else\n') })
    await initRepository('/project', 'main')
    expect(calledCommands()).toContain('init')
  })

  it('checkIsRepo が真なら rev-parse --git-dir を呼ばない', async () => {
    setupRaw({ gitDir: '.\n' })
    mockCheckIsRepo.mockResolvedValue(true)
    await expect(initRepository('/project', 'main')).rejects.toThrow(ALREADY_REPOSITORY_MESSAGE)
    expect(rawCalls()).toEqual([['check-ref-format', '--branch', 'main']])
  })

  it('checkIsRepo の reject(dubious ownership など)は初期化の失敗にし、init しない', async () => {
    setupRaw()
    mockCheckIsRepo.mockRejectedValue(new MockGitError('fatal: detected dubious ownership\n'))
    await expect(initRepository('/project', 'main')).rejects.toThrow(
      'リポジトリを初期化できませんでした: fatal: detected dubious ownership'
    )
    expect(calledCommands()).not.toContain('init')
  })

  it('init の失敗は git のメッセージを添える', async () => {
    setupRaw({ init: new MockGitError('fatal: cannot mkdir .git: Permission denied\n') })
    await expect(initRepository('/project', 'main')).rejects.toThrow(
      'リポジトリを初期化できませんでした: fatal: cannot mkdir .git: Permission denied'
    )
  })

  it('init の打ち切りは時間切れの文言にする', async () => {
    setupRaw({ init: timeoutError() })
    await expect(initRepository('/project', 'main')).rejects.toThrow(INIT_TIMEOUT_MESSAGE)
  })

  it('checkIsRepo の打ち切りも時間切れの文言にする', async () => {
    setupRaw()
    mockCheckIsRepo.mockRejectedValue(timeoutError())
    await expect(initRepository('/project', 'main')).rejects.toThrow(INIT_TIMEOUT_MESSAGE)
  })

  // 終了コード 0 は効果があったことを意味しない(パターン 69)
  it('init の後に HEAD が refs/heads/<name> でなければ失敗にする', async () => {
    setupRaw({ headRef: 'refs/heads/master\n' })
    await expect(initRepository('/project', 'main')).rejects.toThrow(
      /^リポジトリを初期化できませんでした$/
    )
  })
})

describe('addOrigin', () => {
  beforeEach(() => {
    mockCheckIsRepo.mockResolvedValue(true)
  })

  it('checkIsRepo → git remote → remote add -- origin <url> → config --get の順に、前後の空白を除いた URL で呼ぶ', async () => {
    setupRaw()
    await addOrigin('/project', '  https://github.com/a/b.git \n')
    expect(rawCalls()).toEqual([
      ['remote'],
      ['remote', 'add', '--', 'origin', 'https://github.com/a/b.git'],
      ['config', '--get', 'remote.origin.url']
    ])
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      timeout: { block: REMOTE_SETUP_LOCAL_TIMEOUT_MS }
    })
  })

  it.each([
    ['empty', '   ', 'URL を入力してください'],
    ['too-long', `https://h/${'a'.repeat(2039)}`, 'URL が長すぎます（2048 文字まで）'],
    [
      'invalid-char',
      'https://h/a b',
      'URL に空白・改行・制御文字・引用符（\' " `）は使用できません'
    ],
    [
      'invalid-char',
      "https://u:p'ss@h/r",
      'URL に空白・改行・制御文字・引用符（\' " `）は使用できません'
    ],
    // 引用符を含むローカルのパスも拒否する(既知の制約)。文言で引用符が理由だと分かる(3 周目のレビュー)
    [
      'invalid-char',
      "/repos/O'Brien/b.git",
      'URL に空白・改行・制御文字・引用符（\' " `）は使用できません'
    ],
    ['leading-dash', '--upload-pack=x', '`-` で始まる URL は使用できません'],
    [
      'unsupported',
      'ext::sh',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // authority の `@` は 1 個まで(パスワードの `@` は %40 と書く。3 周目のレビュー)
    [
      'unsupported',
      'ssh://u:p@ss@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // ssh:// の userinfo の %2F は git が `/` に戻して ssh に渡し、資格情報の前半がホスト名として出る(4 周目のレビュー)
    [
      'unsupported',
      'ssh://alice:s3cr%2Fet@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // userinfo に生の `/` があると authority が `user:pa` で切れ、git は失敗の文言に `user:pa` を出す。port は数字だけ
    // (5 周目のレビュー)
    [
      'unsupported',
      'https://user:pa/ss@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // パスワード入りの URL は構造的に拒否する(利用者の決定。認証は credential helper に任せる)
    [
      'unsupported',
      'https://alice:ghp_TOKEN@github.com/a/b.git',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    [
      'unsupported',
      'ssh://u:pw@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // userinfo に生の `/` を含み、パスワードが数字で始まる形(authority が `alice:1234` に切れる。6 周目のレビュー)
    [
      'unsupported',
      'https://alice:1234/s3cret@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ]
  ])('規則の違反(%s)は git を呼ばずに拒否する', async (kind, url, message) => {
    setupRaw()
    await expect(addOrigin('/project', url)).rejects.toThrow(message)
    expect(REMOTE_URL_RULE_MESSAGES[kind as keyof typeof REMOTE_URL_RULE_MESSAGES]).toBe(message)
    expect(mockSimpleGit).not.toHaveBeenCalled()
    expect(mockRaw).not.toHaveBeenCalled()
  })

  // URL に資格情報(https://user:token@host/...)が入っていても、画面に出さない
  it('エラーの文言に URL を含めない', async () => {
    setupRaw()
    const err = await addOrigin('/project', 'https://user:secret@h/a b').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe(REMOTE_URL_RULE_MESSAGES['invalid-char'])
    expect((err as Error).message).not.toContain('secret')
  })

  describe('Windows のドライブの形', () => {
    const originalPlatform = process.platform
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('windowsPaths が偽なら拒否し、真なら追加する', async () => {
      setupRaw()
      await expect(addOrigin('/project', 'C:/repos/a.git', undefined, false)).rejects.toThrow(
        REMOTE_URL_RULE_MESSAGES.unsupported
      )
      await addOrigin('/project', 'C:/repos/a.git', undefined, true)
      expect(rawCalls()).toContainEqual(['remote', 'add', '--', 'origin', 'C:/repos/a.git'])
    })

    it('windowsPaths の既定は process.platform === win32', async () => {
      setupRaw()
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      await expect(addOrigin('/project', 'C:/repos/a.git')).rejects.toThrow(
        REMOTE_URL_RULE_MESSAGES.unsupported
      )
      Object.defineProperty(process, 'platform', { value: 'win32' })
      await expect(addOrigin('/project', 'C:/repos/a.git')).resolves.toBeUndefined()
    })
  })

  it('リポジトリでなければ拒否し、git remote を呼ばない', async () => {
    setupRaw()
    mockCheckIsRepo.mockResolvedValue(false)
    await expect(addOrigin('/project', 'https://h/a.git')).rejects.toThrow(NOT_REPOSITORY_MESSAGE)
    expect(mockRaw).not.toHaveBeenCalled()
  })

  // git remote add は already exists の英語で失敗する。先に日本語で弾く
  it('origin が既にあれば拒否し、remote add しない', async () => {
    setupRaw({ remotes: 'upstream\r\norigin\r\n' })
    await expect(addOrigin('/project', 'https://h/a.git')).rejects.toThrow(ORIGIN_EXISTS_MESSAGE)
    expect(rawCalls()).toEqual([['remote']])
  })

  it.each([
    ['git remote', { remotes: new MockGitError('fatal: bad config line 3\n') }],
    ['remote add', { remoteAdd: new MockGitError('error: could not lock config file\n') }]
  ] as Array<[string, RawOptions]>)(
    '%s の失敗は git のメッセージを添えた追加の失敗にする',
    async (_label, o) => {
      setupRaw(o)
      await expect(addOrigin('/project', 'https://h/a.git')).rejects.toThrow(
        /^リモートを追加できませんでした: (fatal: bad config line 3|error: could not lock config file)$/
      )
    }
  )

  it('remote add の打ち切りは時間切れの文言にする', async () => {
    setupRaw({ remoteAdd: timeoutError() })
    await expect(addOrigin('/project', 'https://h/a.git')).rejects.toThrow(
      ADD_ORIGIN_TIMEOUT_MESSAGE
    )
  })

  it('追加の後に remote.origin.url が入力と違えば失敗にする', async () => {
    setupRaw({ originUrl: 'https://other/a.git\n' })
    await expect(addOrigin('/project', 'https://h/a.git')).rejects.toThrow(
      /^リモートを追加できませんでした$/
    )
  })
})

describe('pushSetUpstream', () => {
  beforeEach(() => {
    mockCheckIsRepo.mockResolvedValue(true)
  })

  it('検証の後、完全な refspec で push -u し、branch.<b>.remote / merge を確かめる', async () => {
    setupRaw({ remotes: 'origin\n', headRef: 'refs/heads/feat/x\n' })
    await pushSetUpstream('/project')
    expect(rawCalls()).toEqual([
      ['remote'],
      ['symbolic-ref', '-q', 'HEAD'],
      ['rev-parse', '-q', '--verify', 'HEAD'],
      ['for-each-ref', '--format=%(upstream:short)', 'refs/heads/feat/x'],
      ['config', '--get', 'branch.feat/x.remote'],
      ['config', '--get', 'branch.feat/x.merge'],
      ['push', '--set-upstream', 'origin', 'refs/heads/feat/x:refs/heads/feat/x'],
      ['config', '--get', 'branch.feat/x.remote'],
      ['config', '--get', 'branch.feat/x.merge']
    ])
  })

  // progress プラグインが末尾に --progress を足すため、`--` を使うと refspec として扱われて失敗する(実機で確認)
  it('push の引数に `--` を使わない', async () => {
    setupRaw({ remotes: 'origin\n' })
    await pushSetUpstream('/project')
    const pushArgs = rawCalls().find((args) => args[0] === 'push')
    expect(pushArgs).not.toContain('--')
  })

  it('simple-git は push と同じ打ち切り(30 秒・progress あり)で作り、timeoutMs で差し替えられる', async () => {
    setupRaw({ remotes: 'origin\n' })
    await pushSetUpstream('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      timeout: { block: GIT_REMOTE_TIMEOUT_MS },
      progress: expect.any(Function)
    })
    // 1 回目の push の後は、モックの branch.<b>.remote が設定済みになるため作り直す
    setupRaw({ remotes: 'origin\n' })
    await pushSetUpstream('/project', 500)
    expect(mockSimpleGit).toHaveBeenLastCalledWith('/project', {
      timeout: { block: 500 },
      progress: expect.any(Function)
    })
  })

  it.each([
    ['リポジトリでない', {}, NOT_REPOSITORY_MESSAGE, false],
    ['origin が無い', { remotes: 'upstream\n' }, NO_ORIGIN_FOR_PUSH_MESSAGE, true],
    [
      'ブランチ上にいない(detached・リベース中)',
      { remotes: 'origin\n', headRef: '' },
      NOT_ON_BRANCH_FOR_PUSH_MESSAGE,
      true
    ],
    ['コミットが無い', { remotes: 'origin\n', headCommit: '' }, NO_COMMIT_FOR_PUSH_MESSAGE, true],
    [
      'upstream が既にある',
      { remotes: 'origin\n', upstream: 'origin/main\n' },
      'upstream は既に設定されています: origin/main',
      true
    ],
    // %(upstream:short) は、削除済みの remote や fetch の refspec の無い remote を指す upstream を空にする
    // (実機で確認)。-u はその branch.<b>.remote / merge を黙って上書きする(パターン 45)
    [
      'branch.<b>.remote だけが設定済み(upstream は表示されない)',
      { remotes: 'origin\n', existingBranchRemote: 'ghost\n' },
      UPSTREAM_CONFIG_EXISTS_MESSAGE,
      true
    ],
    [
      'branch.<b>.merge だけが設定済み(upstream は表示されない)',
      { remotes: 'origin\n', existingBranchMerge: 'refs/heads/feature\n' },
      UPSTREAM_CONFIG_EXISTS_MESSAGE,
      true
    ]
  ] as Array<[string, RawOptions, string, boolean]>)(
    '%s なら拒否し、push しない',
    async (_label, o, message, isRepo) => {
      setupRaw(o)
      mockCheckIsRepo.mockResolvedValue(isRepo)
      await expect(pushSetUpstream('/project')).rejects.toThrow(message)
      expect(calledCommands()).not.toContain('push')
    }
  )

  it('push の失敗は git のメッセージを添える(non-fast-forward など)', async () => {
    setupRaw({
      remotes: 'origin\n',
      push: new MockGitError(' ! [rejected]        main -> main (fetch first)\n')
    })
    await expect(pushSetUpstream('/project')).rejects.toThrow(
      '初回 push に失敗しました: ! [rejected]        main -> main (fetch first)'
    )
    // push の後の設定の確認には進まない(push の前の設定の確認は行う)
    expect(calledCommands().at(-1)).toBe('push')
  })

  it.each([
    ['push', { remotes: 'origin\n', push: timeoutError() }],
    ['事前検証(git remote)', { remotes: timeoutError() }]
  ] as Array<[string, RawOptions]>)(
    '%s の打ち切りは既存の push と同じ文言にする',
    async (_label, o) => {
      setupRaw(o)
      await expect(pushSetUpstream('/project')).rejects.toThrow(REMOTE_OPERATION_TIMEOUT_MESSAGE)
    }
  )

  // 事前検証の git の失敗も英語の GitError のまま見せない(パターン 74)
  it('事前検証の git の失敗は初回 push の失敗にする', async () => {
    setupRaw({ remotes: new MockGitError('fatal: bad config line 3\n') })
    await expect(pushSetUpstream('/project')).rejects.toThrow(
      '初回 push に失敗しました: fatal: bad config line 3'
    )
  })

  // 終了コード 0 は効果があったことを意味しない(パターン 69)
  it.each([
    ['branch.<b>.remote が無い', { remotes: 'origin\n', branchRemote: '' }],
    ['branch.<b>.merge が別の ref', { remotes: 'origin\n', branchMerge: 'refs/heads/other\n' }]
  ] as Array<[string, RawOptions]>)('push の後に %s なら失敗にする', async (_label, o) => {
    setupRaw(o)
    await expect(pushSetUpstream('/project')).rejects.toThrow(UPSTREAM_NOT_CONFIRMED_MESSAGE)
  })
})

// フォルダが開いた後に削除・移動されていると、simpleGit() の生成が英語の GitConstructError を投げる(パターン 74)
describe('フォルダが存在しない', () => {
  beforeEach(() => {
    setupRaw({ remotes: 'origin\n' })
    mockCheckIsRepo.mockResolvedValue(true)
    mockSimpleGit.mockImplementationOnce(() => {
      throw new MockGitConstructError('Cannot use simple-git on a directory that does not exist')
    })
  })

  it.each([
    ['initRepository', () => initRepository('/gone', 'main')],
    ['addOrigin', () => addOrigin('/gone', 'https://h/a.git')],
    ['pushSetUpstream', () => pushSetUpstream('/gone')]
  ] as Array<[string, () => Promise<void>]>)(
    '%s はフォルダが見つからない旨の日本語で失敗し、git を呼ばない',
    async (_label, run) => {
      await expect(run()).rejects.toThrow(/^フォルダが見つかりません: \/gone$/)
      expect(FOLDER_NOT_FOUND_MESSAGE).toBe('フォルダが見つかりません')
      expect(mockRaw).not.toHaveBeenCalled()
      expect(mockCheckIsRepo).not.toHaveBeenCalled()
    }
  )
})

// フォルダが見つからない旨に変換するのは GitConstructError だけ。生成時のそれ以外の失敗は、操作の失敗の文言に
// 元のメッセージを添える(フォルダがあるのに「見つかりません」と見せない)
describe('simple-git の生成が GitConstructError 以外で失敗する', () => {
  beforeEach(() => {
    mockSimpleGit.mockImplementationOnce(() => {
      throw new Error('boom')
    })
  })

  it.each([
    [
      'initRepository',
      () => initRepository('/project', 'main'),
      'リポジトリを初期化できませんでした: boom'
    ],
    [
      'addOrigin',
      () => addOrigin('/project', 'https://h/a.git'),
      'リモートを追加できませんでした: boom'
    ],
    ['pushSetUpstream', () => pushSetUpstream('/project'), '初回 push に失敗しました: boom']
  ] as Array<[string, () => Promise<void>, string]>)(
    '%s はフォルダが見つからない旨にせず、操作の失敗として投げる',
    async (_label, run, message) => {
      // Error を渡した toThrow は message の完全一致で比べる
      await expect(run()).rejects.toThrow(new Error(message))
      expect(mockRaw).not.toHaveBeenCalled()
      expect(mockCheckIsRepo).not.toHaveBeenCalled()
    }
  )
})
```

```bash
npx vitest run src/main/__tests__/gitRemoteSetupService.test.ts
```

Expected: FAIL（`../gitRemoteSetupService` が無い）

- [ ] **Step 2: 統合テスト（実 git）を書く（`src/main/__tests__/gitRemoteSetupService.integration.test.ts`）**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { REMOTE_OPERATION_TIMEOUT_MESSAGE } from '../gitRemoteTimeout'
import {
  ALREADY_REPOSITORY_MESSAGE,
  NOT_ON_BRANCH_FOR_PUSH_MESSAGE,
  NOT_REPOSITORY_MESSAGE,
  NO_COMMIT_FOR_PUSH_MESSAGE,
  NO_ORIGIN_FOR_PUSH_MESSAGE,
  ORIGIN_EXISTS_MESSAGE,
  REMOTE_URL_RULE_MESSAGES,
  UPSTREAM_CONFIG_EXISTS_MESSAGE,
  addOrigin,
  initRepository,
  pushSetUpstream
} from '../gitRemoteSetupService'
import {
  commitAll,
  initRepo,
  runGit,
  stubGitCeiling,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'

// 'é' の NFC(1 文字)と NFD(e + 結合文字)
const NFC_E = '\u00e9'
const NFD_E = 'e\u0301'

// gitRemoteSetupService.test.ts は simple-git をモックするため、実際の git が引数をどう解釈するか
// (--initial-branch の 1 引数、remote add の --、完全な refspec と --progress、利用者の push の設定)は
// 検証できない。ここで実 git で固定する。環境は GIT_CONFIG_GLOBAL=/dev/null・GIT_CONFIG_NOSYSTEM=1 で
// 固定し、init.defaultBranch などの既定に依存しない(パターン 46)
describe('gitRemoteSetupService(実 git)', () => {
  let root: string

  beforeEach(() => {
    stubIsolatedGitEnv()
    // 一時ディレクトリより上のリポジトリ(TMPDIR がリポジトリの中にある環境など)を checkIsRepo が拾わない
    stubGitCeiling(tmpdir())
    root = mkdtempSync(join(tmpdir(), 'remote-setup-'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  const dir = (name: string): string => {
    const path = join(root, name)
    mkdirSync(path, { recursive: true })
    return path
  }
  const headRef = (repo: string): string => runGit(repo, 'symbolic-ref', 'HEAD').trim()
  // キーが無いと git config は終了コード 1 で終わり、runGit が投げる
  const configOrEmpty = (repo: string, key: string): string => {
    try {
      return runGit(repo, 'config', '--get', key).trim()
    } catch {
      return ''
    }
  }
  const makeBare = (name = 'remote.git'): string => {
    const bare = join(root, name)
    runGit(root, 'init', '-q', '--bare', bare)
    return bare
  }
  const makeRepoWithCommit = (name = 'repo', content = '1\n'): string => {
    const repo = dir(name)
    initRepo(repo)
    writeRepoFile(repo, 'a.txt', content)
    commitAll(repo, 'first')
    return repo
  }
  const refOf = (repo: string, ref: string): string => runGit(repo, 'rev-parse', ref).trim()

  describe('initRepository', () => {
    it.each(['main', 'feat/x', '日本語'])(
      '%s で初期化し、HEAD がそのブランチを指す',
      async (name) => {
        const folder = dir('work')
        await initRepository(folder, name)
        expect(headRef(folder)).toBe(`refs/heads/${name}`)
      }
    )

    // macOS の git は NFD の名前を NFD のまま refs/heads/<NFD> にする(実機で確認。パターン 83)
    it('NFD の名前は NFC にそろえて初期化する', async () => {
      const folder = dir('work')
      await initRepository(folder, `caf${NFD_E}`)
      expect(headRef(folder)).toBe(`refs/heads/caf${NFC_E}`)
    })

    it('前後の空白を除いて初期化する', async () => {
      const folder = dir('work')
      await initRepository(folder, '  main  ')
      expect(headRef(folder)).toBe('refs/heads/main')
    })

    // git init は HEAD・-x・@ を通し、a..b・main.lock・@{-1} は失敗しても .git を残す(実機で確認)
    it.each([
      ['HEAD', 'ブランチ名として使用できない名前です: HEAD'],
      ['-x', '`-` で始まるブランチ名は使用できません: -x'],
      ['@', 'ブランチ名として使用できない名前です: @'],
      ['a..b', 'ブランチ名として使用できない名前です: a..b'],
      ['main.lock', 'ブランチ名として使用できない名前です: main.lock'],
      ['@{-1}', 'ブランチ名として使用できない名前です: @{-1}']
    ])('%s は拒否し、.git を作らない', async (name, message) => {
      const folder = dir('work')
      await expect(initRepository(folder, name)).rejects.toThrow(message)
      expect(existsSync(join(folder, '.git'))).toBe(false)
    })

    // 既存のリポジトリに git init すると、終了コード 0 で再初期化され --initial-branch は無視される(実機で確認)
    it('既にリポジトリのフォルダは拒否し、HEAD を変えない', async () => {
      const repo = makeRepoWithCommit()
      await expect(initRepository(repo, 'trunk')).rejects.toThrow(ALREADY_REPOSITORY_MESSAGE)
      expect(headRef(repo)).toBe('refs/heads/main')
    })

    it('親がリポジトリのサブフォルダは拒否し、サブフォルダに .git を作らない', async () => {
      const repo = makeRepoWithCommit()
      const sub = join(repo, 'sub')
      mkdirSync(sub)
      await expect(initRepository(sub, 'main')).rejects.toThrow(ALREADY_REPOSITORY_MESSAGE)
      expect(existsSync(join(sub, '.git'))).toBe(false)
    })

    it('利用者の init.defaultBranch より、入力した名前を使う', async () => {
      const globalConfig = join(root, 'gitconfig')
      writeFileSync(globalConfig, '[init]\n\tdefaultBranch = trunk\n')
      vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig)
      const folder = dir('work')
      await initRepository(folder, 'main')
      expect(headRef(folder)).toBe('refs/heads/main')
    })

    // git init は名前の検証で失敗しても HEAD の無い .git を残す。それは checkIsRepo では「リポジトリではない」になる
    it('失敗した init の残骸(HEAD の無い .git)があっても、正しい名前で初期化できる', async () => {
      const folder = dir('work')
      expect(() => runGit(folder, 'init', '-q', '--initial-branch=a..b')).toThrow()
      expect(existsSync(join(folder, '.git', 'HEAD'))).toBe(false)
      await initRepository(folder, 'main')
      expect(headRef(folder)).toBe('refs/heads/main')
    })

    // bare リポジトリと .git ディレクトリ(とその中)では checkIsRepo(--is-inside-work-tree)が false になる。
    // git init は成功して中に .git を作ってしまう(実機で確認)。rev-parse --git-dir の成功で既存のリポジトリと判定する
    it.each([
      ['bare リポジトリ', (): string => makeBare('bare.git')],
      ['bare リポジトリの中のフォルダ', (): string => join(makeBare('bare.git'), 'refs')],
      ['.git ディレクトリ', (): string => join(makeRepoWithCommit(), '.git')],
      ['.git ディレクトリの中のフォルダ', (): string => join(makeRepoWithCommit(), '.git', 'refs')]
    ])('%s では拒否し、.git を作らず、既存の config を変えない', async (_label, make) => {
      const folder = make()
      const configPath = join(runGit(folder, 'rev-parse', '--absolute-git-dir').trim(), 'config')
      const before = readFileSync(configPath, 'utf8')
      await expect(initRepository(folder, 'dev')).rejects.toThrow(ALREADY_REPOSITORY_MESSAGE)
      expect(existsSync(join(folder, '.git'))).toBe(false)
      expect(readFileSync(configPath, 'utf8')).toBe(before)
    })

    // simple-git の checkIsRepo は「not a git repository」を false に読み替える(差分 1)。git init が失敗する
    it('壊れた .git ファイルは、git の失敗として「初期化できませんでした」を返す', async () => {
      const folder = dir('work')
      writeFileSync(join(folder, '.git'), `gitdir: ${join(root, 'nonexistent')}\n`)
      await expect(initRepository(folder, 'main')).rejects.toThrow(
        'リポジトリを初期化できませんでした: '
      )
    })
  })

  describe('addOrigin', () => {
    let repo: string
    const configText = (): string => readFileSync(join(repo, '.git', 'config'), 'utf8')
    const originUrl = (): string => runGit(repo, 'remote', 'get-url', 'origin').trim()

    beforeEach(() => {
      repo = makeRepoWithCommit()
    })

    it.each([
      'https://github.com/a/b.git',
      'http://example.com/a.git',
      'ssh://git@host:22/a.git',
      'git://host/a',
      'git@github.com:a/b.git'
    ])('%s を追加し、remote get-url が一致する', async (url) => {
      await addOrigin(repo, url)
      expect(originUrl()).toBe(url)
    })

    it('bare リポジトリの絶対パスと file:// を追加できる', async () => {
      const bare = makeBare()
      await addOrigin(repo, bare)
      expect(originUrl()).toBe(bare)
      const other = makeRepoWithCommit('other')
      await addOrigin(other, `file://${bare}`)
      expect(runGit(other, 'remote', 'get-url', 'origin').trim()).toBe(`file://${bare}`)
    })

    // remote add は通信しない(-f を付けない)
    it('到達できない URL でも通信せずにすぐ終わる', async () => {
      const started = Date.now()
      await addOrigin(repo, 'https://unreachable.invalid/x.git')
      expect(Date.now() - started).toBeLessThan(5000)
      expect(originUrl()).toBe('https://unreachable.invalid/x.git')
    })

    it.each([
      ['ext:: とコマンド', 'ext::sh -c touch% x'],
      ['ext::', 'ext::sh'],
      ['fd::', 'fd::3'],
      ['相対パス', '../remote.git'],
      ['user@ の無い host:path', 'host:path'],
      ['- で始まる', '--upload-pack=x'],
      ['改行を含む', '/a\n/b'],
      // git:// は userinfo を解釈せず、push の失敗の文言にホスト名として資格情報を出す(実機で確認)
      ['git:// の userinfo', 'git://alice:s3cret@127.0.0.1:19418/b.git'],
      // パスワード入りの URL は構造的に拒否する(利用者の決定。認証は credential helper に任せる)
      ['https の user:token', 'https://alice:ghp_TOKEN123@github.com/a/b.git'],
      ['https のトークンだけ', 'https://ghp_TOKEN123@github.com/a/b.git'],
      ['ssh の user:password', 'ssh://u:pw@github.com/x/y.git'],
      ['userinfo に生の /(パスワードが数字で始まる)', 'https://alice:1234/s3cret@h/r'],
      ['userinfo の #', 'https://h#sec@h2/r'],
      ['ssh の host の %XX', 'ssh://alice%3Apw%40h/r']
    ])('%s(%j)は拒否し、.git/config を変えない', async (_label, url) => {
      const before = configText()
      await expect(addOrigin(repo, url)).rejects.toThrow()
      expect(configText()).toBe(before)
    })

    // protocol.ext.allow=always では、push 時に ext:: のコマンドが実行される(実機で確認)。追加の時点で止める
    it('protocol.ext.allow=always の環境でも ext:: を追加しない', async () => {
      runGit(repo, 'config', 'protocol.ext.allow', 'always')
      const before = configText()
      await expect(addOrigin(repo, 'ext::sh')).rejects.toThrow(REMOTE_URL_RULE_MESSAGES.unsupported)
      expect(configText()).toBe(before)
    })

    it('origin が既にあれば拒否する', async () => {
      runGit(repo, 'remote', 'add', 'origin', 'https://h/first.git')
      await expect(addOrigin(repo, 'https://h/second.git')).rejects.toThrow(ORIGIN_EXISTS_MESSAGE)
      expect(originUrl()).toBe('https://h/first.git')
    })

    // remote.origin.url が無くても git remote は origin を出し、remote add は already exists になる(実機で確認)
    it('remote.origin.fetch だけがある場合も拒否する', async () => {
      runGit(repo, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*')
      await expect(addOrigin(repo, 'https://h/a.git')).rejects.toThrow(ORIGIN_EXISTS_MESSAGE)
    })

    it('リポジトリでなければ拒否する', async () => {
      const plain = dir('plain')
      await expect(addOrigin(plain, 'https://h/a.git')).rejects.toThrow(NOT_REPOSITORY_MESSAGE)
    })

    // クラッシュ後に残った config.lock(または addOrigin の同時実行)で remote add が失敗すると、git は
    // `fatal: could not set 'remote.origin.url' to '<url>'` と URL をそのまま出す(実機 git 2.50.1 で確認)。
    // 検証はパスワード入りの URL を拒否するため、ここに届く userinfo は scp 形式・ssh:// のユーザー名だけ。
    // 文言は IPC で画面まで届くため、それも伏せる(防御の 2 層)
    it('config.lock が残っていて失敗しても、文言に URL の user を出さない', async () => {
      writeFileSync(join(repo, '.git', 'config.lock'), '')
      const err = await addOrigin(repo, 'tok123@github.com:a/b.git').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(Error)
      const message = (err as Error).message
      expect(message).toMatch(/^リモートを追加できませんでした: /)
      expect(message).toContain('***@github.com:a/b.git')
      expect(message).not.toContain('tok123')
    })

    it('Windows のドライブの形は windowsPaths のときだけ追加する', async () => {
      await expect(addOrigin(repo, 'C:/repos/a.git', undefined, false)).rejects.toThrow(
        REMOTE_URL_RULE_MESSAGES.unsupported
      )
      await addOrigin(repo, 'C:/repos/a.git', undefined, true)
      expect(originUrl()).toBe('C:/repos/a.git')
    })
  })

  describe('pushSetUpstream', () => {
    let repo: string
    let bare: string

    beforeEach(() => {
      repo = makeRepoWithCommit()
      bare = makeBare()
    })

    const expectUpstreamOf = (branch: string): void => {
      expect(configOrEmpty(repo, `branch.${branch}.remote`)).toBe('origin')
      expect(configOrEmpty(repo, `branch.${branch}.merge`)).toBe(`refs/heads/${branch}`)
      expect(refOf(bare, `refs/heads/${branch}`)).toBe(refOf(repo, 'HEAD'))
    }

    it('origin(絶対パス)へ送り、upstream を設定する', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      await pushSetUpstream(repo)
      expectUpstreamOf('main')
      expect(runGit(repo, 'rev-parse', '--abbrev-ref', 'main@{upstream}').trim()).toBe(
        'origin/main'
      )
    })

    it('file:// の origin へも送れる', async () => {
      runGit(repo, 'remote', 'add', 'origin', `file://${bare}`)
      await pushSetUpstream(repo)
      expectUpstreamOf('main')
    })

    it('detached HEAD では送らない', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      runGit(repo, 'checkout', '-q', '--detach')
      await expect(pushSetUpstream(repo)).rejects.toThrow(NOT_ON_BRANCH_FOR_PUSH_MESSAGE)
      expect(runGit(bare, 'for-each-ref').trim()).toBe('')
    })

    it('リベースで止めている間は送らない', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      writeRepoFile(repo, 'a.txt', '2\n')
      commitAll(repo, 'second')
      try {
        runGit(repo, 'rebase', '--exec', 'false', 'HEAD~1')
      } catch {
        // 意図した停止(終了コード 1)
      }
      expect(existsSync(join(repo, '.git', 'rebase-merge'))).toBe(true)
      await expect(pushSetUpstream(repo)).rejects.toThrow(NOT_ON_BRANCH_FOR_PUSH_MESSAGE)
      expect(runGit(bare, 'for-each-ref').trim()).toBe('')
    })

    // git に任せると `src refspec main does not match any` の英語になる(実機で確認)
    it('コミットが無ければ送らない', async () => {
      const empty = dir('empty')
      initRepo(empty)
      runGit(empty, 'remote', 'add', 'origin', bare)
      await expect(pushSetUpstream(empty)).rejects.toThrow(NO_COMMIT_FOR_PUSH_MESSAGE)
    })

    it('origin が無ければ送らない', async () => {
      await expect(pushSetUpstream(repo)).rejects.toThrow(NO_ORIGIN_FOR_PUSH_MESSAGE)
    })

    // -u は既存の branch.<b>.remote / merge を黙って上書きする。利用者の設定を変えない(パターン 45)
    it('upstream が既にあれば上書きしない', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      runGit(repo, 'push', '-q', '-u', 'origin', 'main')
      await expect(pushSetUpstream(repo)).rejects.toThrow(
        'upstream は既に設定されています: origin/main'
      )
      expect(configOrEmpty(repo, 'branch.main.merge')).toBe('refs/heads/main')
    })

    // %(upstream:short) は、削除済み(または fetch の refspec の無い)remote を指す upstream を空にする。
    // 名前の . や / は config のキーのサブセクションにそのまま入る(実機で確認)。サブセクションは大文字小文字を
    // 区別するため、大文字を含む名前も小文字にせずに読む
    it.each(['main', 'feat.x/y', 'Feat.X/y'])(
      '%s の branch.<b>.remote / merge が表示されない upstream として設定済みなら、上書きせず送らない',
      async (name) => {
        runGit(repo, 'remote', 'add', 'origin', bare)
        if (name !== 'main') runGit(repo, 'checkout', '-q', '-b', name)
        runGit(repo, 'config', `branch.${name}.remote`, 'ghost')
        runGit(repo, 'config', `branch.${name}.merge`, 'refs/heads/feature')
        await expect(pushSetUpstream(repo)).rejects.toThrow(UPSTREAM_CONFIG_EXISTS_MESSAGE)
        expect(configOrEmpty(repo, `branch.${name}.remote`)).toBe('ghost')
        expect(configOrEmpty(repo, `branch.${name}.merge`)).toBe('refs/heads/feature')
        expect(runGit(bare, 'for-each-ref').trim()).toBe('')
      }
    )

    // 同名のタグがあると `push -u origin main` は `src refspec main matches more than one` で失敗する(パターン 43)
    it('同じ名前のタグがあっても、完全な refspec で送れる', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      runGit(repo, 'tag', 'main')
      await pushSetUpstream(repo)
      expectUpstreamOf('main')
    })

    // refs/ で始まる refspec なので、- で始まるブランチ名もオプションと解釈されない(パターン 21)
    it('- で始まるブランチ名でも送れる', async () => {
      const dash = dir('dash')
      runGit(dash, 'init', '-q', '--initial-branch=-x')
      runGit(dash, 'config', 'user.email', 'test@example.com')
      runGit(dash, 'config', 'user.name', 'test')
      runGit(dash, 'config', 'commit.gpgsign', 'false')
      writeRepoFile(dash, 'a.txt', '1\n')
      commitAll(dash, 'first')
      runGit(dash, 'remote', 'add', 'origin', bare)
      await pushSetUpstream(dash)
      expect(configOrEmpty(dash, 'branch.-x.merge')).toBe('refs/heads/-x')
      expect(refOf(bare, 'refs/heads/-x')).toBe(refOf(dash, 'HEAD'))
    })

    it('リモートの同名のブランチと non-fast-forward なら失敗し、upstream を設定しない', async () => {
      const other = makeRepoWithCommit('other', 'other\n')
      runGit(other, 'push', '-q', bare, 'main')
      runGit(repo, 'remote', 'add', 'origin', bare)
      await expect(pushSetUpstream(repo)).rejects.toThrow(/^初回 push に失敗しました: /)
      expect(configOrEmpty(repo, 'branch.main.remote')).toBe('')
    })

    // 完全な refspec のため、push.default・remote.origin.push に影響されない(実機で確認)
    it('push.default=nothing・remote.origin.push があっても、そのブランチを同じ名前で送る', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      runGit(repo, 'config', 'push.default', 'nothing')
      runGit(repo, 'config', 'remote.origin.push', 'refs/heads/main:refs/heads/elsewhere')
      await pushSetUpstream(repo)
      expectUpstreamOf('main')
      expect(runGit(bare, 'for-each-ref', '--format=%(refname)').trim()).toBe('refs/heads/main')
    })

    // ssh と scp 形式の push の失敗では、ssh 自身が `<user>@<host>: Permission denied (publickey).` と
    // 接続先を出し、git はそれをそのまま stderr に流す(https・http は git が資格情報を取り除く)。
    // ssh:// の `u:pw@` は user が `u:pw` として ssh に渡る(実機 git 2.50.1 で確認)。addOrigin の検証はパスワード入りの
    // URL を拒否するが、端末で追加した origin(ここでは runGit で追加)への初回 push の文言は伏せる(防御の 2 層)。
    // ネットワークに出ないよう、
    // core.sshCommand に、最初のオプションでない引数(接続先)を ssh と同じ形で出して失敗する偽の ssh を置く
    it.each([
      ['ssh:// の user:password', 'ssh://u:pw@github.com/x/y.git', ['u:pw', 'pw']],
      ['scp 形式の user(トークン)', 'tok123@github.com:x/y.git', ['tok123']]
    ])('ssh の認証の失敗(%s)でも、文言に資格情報を出さない', async (_label, url, secrets) => {
      const fakeSsh = join(root, 'fake-ssh')
      writeFileSync(
        fakeSsh,
        [
          '#!/bin/sh',
          'for a in "$@"; do case "$a" in -*) ;; *) host="$a"; break;; esac; done',
          'echo "$host: Permission denied (publickey)." >&2',
          'exit 255',
          ''
        ].join('\n')
      )
      chmodSync(fakeSsh, 0o755)
      runGit(repo, 'config', 'core.sshCommand', fakeSsh)
      runGit(repo, 'remote', 'add', 'origin', url)
      const err = await pushSetUpstream(repo).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(Error)
      const message = (err as Error).message
      expect(message).toMatch(/^初回 push に失敗しました: /)
      // 偽の ssh が呼ばれ、接続先(資格情報を伏せた形)が文言に届いている
      expect(message).toContain('***@github.com: Permission denied (publickey).')
      for (const secret of secrets) expect(message).not.toContain(secret)
      expect(configOrEmpty(repo, 'branch.main.remote')).toBe('')
    })

    // 認証待ちなどで出力が途絶えた場合と同じく、pre-push フックの sleep で打ち切りを確かめる(パターン 84)
    it('応答が途絶えたら打ち切り、upstream を設定しない', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      const hook = join(repo, '.git', 'hooks', 'pre-push')
      writeFileSync(hook, '#!/bin/sh\nsleep 5\n')
      chmodSync(hook, 0o755)
      await expect(pushSetUpstream(repo, 300)).rejects.toThrow(REMOTE_OPERATION_TIMEOUT_MESSAGE)
      expect(configOrEmpty(repo, 'branch.main.remote')).toBe('')
    })
  })

  // 開いた後に削除・移動されたフォルダ。simpleGit() の英語の GitConstructError を見せない(パターン 74)
  describe('フォルダが存在しない', () => {
    it.each([
      ['initRepository', (path: string) => initRepository(path, 'main')],
      ['addOrigin', (path: string) => addOrigin(path, 'https://h/a.git')],
      ['pushSetUpstream', (path: string) => pushSetUpstream(path)]
    ] as Array<[string, (path: string) => Promise<void>]>)(
      '%s はフォルダが見つからない旨の日本語で失敗する',
      async (_label, run) => {
        const gone = join(root, 'gone')
        await expect(run(gone)).rejects.toThrow(`フォルダが見つかりません: ${gone}`)
        expect(existsSync(gone)).toBe(false)
      }
    )
  })
})
```

```bash
npx vitest run src/main/__tests__/gitRemoteSetupService.integration.test.ts
```

Expected: FAIL（`../gitRemoteSetupService` が無い）

- [ ] **Step 3: 実装する（`src/main/gitRemoteSetupService.ts`）**

```ts
import simpleGit, { GitConstructError } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { getBranchNameRuleViolation, normalizeInitialBranchName } from '@shared/branchName'
import {
  MAX_REMOTE_URL_LENGTH,
  getRemoteUrlRuleViolation,
  normalizeRemoteUrl
} from '@shared/remoteUrl'
import type { RemoteUrlRuleViolation } from '@shared/remoteUrl'
import { GIT_REMOTE_TIMEOUT_MS } from '@shared/remoteTimeout'
import { assertValidNewBranchName } from './gitBranchNameGuard'
import { getCurrentBranchRef } from './gitHeadState'
import { ORIGIN_REMOTE, hasOriginRemote } from './gitRemoteNames'
import { REMOTE_OPERATION_TIMEOUT_MESSAGE, simpleGitWithRemoteTimeout } from './gitRemoteTimeout'
import {
  failure,
  isGitTimeoutError,
  redactCredentials,
  runGitStep,
  toStepError
} from './gitStepErrors'

// リモートの管理(新規リポジトリの init・origin の追加・初回 push)。責務はこのファイルにまとめ、
// gitService.ts には足さない(パターン 55)。どの操作も、前の検証に失敗したら後の git 呼び出しには進まない

// init と remote add は通信も対話もしないが、実行中のダイアログは閉じられない設計(パターン 85)のため、
// 最長の待ち時間を保証する(パターン 84)。テストでは第 3 引数で短くする
export const REMOTE_SETUP_LOCAL_TIMEOUT_MS = 30_000

export const ALREADY_REPOSITORY_MESSAGE =
  'このフォルダは既に Git リポジトリ（または親フォルダのリポジトリ）の中にあります'
export const INIT_TIMEOUT_MESSAGE = 'リポジトリの初期化が時間内に終わりませんでした'
export const NOT_REPOSITORY_MESSAGE = 'Git リポジトリではありません'
export const ORIGIN_EXISTS_MESSAGE = 'リモート origin は既に設定されています'
export const ADD_ORIGIN_TIMEOUT_MESSAGE = 'リモートの追加が時間内に終わりませんでした'
export const NO_ORIGIN_FOR_PUSH_MESSAGE = 'リモート origin が未設定のため、初回 push できません'
export const NOT_ON_BRANCH_FOR_PUSH_MESSAGE =
  'ブランチ上にいないため（detached HEAD・リベース中など）、初回 push できません'
export const NO_COMMIT_FOR_PUSH_MESSAGE =
  'コミットが無いため、初回 push できません。先にコミットしてください'
export const UPSTREAM_CONFIG_EXISTS_MESSAGE =
  'upstream の設定が既にあるため、初回 push できません（設定先のリモートが無いか、fetch の設定が無いため表示されていません）'
export const FOLDER_NOT_FOUND_MESSAGE = 'フォルダが見つかりません'
export const UPSTREAM_NOT_CONFIRMED_MESSAGE =
  'push は完了しましたが、upstream を設定できませんでした'

// URL の規則の違反ごとの文言。判定(種類と順序)は renderer と同じ getRemoteUrlRuleViolation(@shared/remoteUrl)。
// 文言は各側の表で持つ(パターン 88)。URL は資格情報を含みうるため、文言に入れない
export const REMOTE_URL_RULE_MESSAGES: Record<RemoteUrlRuleViolation, string> = {
  empty: 'URL を入力してください',
  'too-long': `URL が長すぎます（${MAX_REMOTE_URL_LENGTH} 文字まで）`,
  'invalid-char': 'URL に空白・改行・制御文字・引用符（\' " `）は使用できません',
  'leading-dash': '`-` で始まる URL は使用できません',
  unsupported:
    '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
}

const INIT_FAILURE = 'リポジトリを初期化できませんでした'
const ADD_ORIGIN_FAILURE = 'リモートを追加できませんでした'
const SET_UPSTREAM_FAILURE = '初回 push に失敗しました'
const HEADS_NAMESPACE = 'refs/heads/'

// simple-git を作る。フォルダが存在しない(開いた後に削除・移動された)と、simpleGit() は git を呼ぶ前に
// 英語の GitConstructError を投げる(生成の時点で同期的に投げるため、runGitStep の外で漏れる)。
// フォルダが見つからない旨の日本語にする(パターン 74)。GitConstructError を投げるのはこの確認だけ(simple-git 3.36.0)
function openGit(
  folderPath: string,
  create: () => SimpleGit,
  toError: (err: unknown) => Error
): SimpleGit {
  try {
    return create()
  } catch (err) {
    if (err instanceof GitConstructError) throw failure(FOLDER_NOT_FOUND_MESSAGE, folderPath)
    throw toError(err)
  }
}

// bare リポジトリと .git ディレクトリ(とその中)では、checkIsRepo(--is-inside-work-tree)は `false` を出力して
// 偽になるが、そこで git init すると成功して中に .git を作ってしまう(実機で確認)。rev-parse --git-dir は
// そこで成功する(`.` や絶対パスを出力する)ため、成功なら既存のリポジトリと判定する。checkIsRepo が偽で
// resolve した直後のため、reject はリポジトリの外(管理外・壊れた .git ファイル・HEAD の無い .git は、どれも
// `fatal: not a git repository` で終了コード 128。実機で確認)と扱う。文言では分岐しない(パターン 18)。
// 打ち切りだけは区別して投げ、init に進まない(打ち切りは「リポジトリの外」の根拠にならない)
async function isInsideGitDirectory(git: SimpleGit): Promise<boolean> {
  try {
    await git.raw(['rev-parse', '--git-dir'])
    return true
  } catch (err) {
    if (isGitTimeoutError(err)) throw err
    return false
  }
}

// 空のリポジトリを作る(初期コミットや .gitignore は作らない)。branch は IPC 境界から届く任意の文字列。
// git init は、名前の検証で失敗しても HEAD の無い .git を残し、既存のリポジトリでは終了コード 0 で再初期化する
// (--initial-branch は無視される。実機 git 2.50.1 で確認)。そのため名前の検証と「既にリポジトリか」の判定を
// git init の前に行う。--initial-branch を指定すれば利用者の init.defaultBranch は使われない(入力した名前を優先する)。
// init.templateDir などのテンプレートは上書きしない(フックはコピーされるが init のときには実行されない。パターン 45・81)
export async function initRepository(
  folderPath: string,
  rawBranch: string,
  timeoutMs: number = REMOTE_SETUP_LOCAL_TIMEOUT_MS
): Promise<void> {
  // 入口で 1 回だけ正規化し、以後の検証・git init・作成の確認・エラーの文言はこの名前を使う(パターン 83)
  const branch = normalizeInitialBranchName(rawBranch)
  const toInitError = (err: unknown): Error => toStepError(err, INIT_TIMEOUT_MESSAGE, INIT_FAILURE)
  const git = openGit(
    folderPath,
    () => simpleGit(folderPath, { timeout: { block: timeoutMs } }),
    toInitError
  )
  // 1・2. アプリ独自の規則と git の check-ref-format --branch(ブランチの作成と同じ。HEAD・-x・@・a..b を拒否する)
  try {
    await assertValidNewBranchName(git, branch)
  } catch (err) {
    // 壊れた .git ファイル(存在しない gitdir を指す)があると、check-ref-format --branch はリポジトリを探す途中で
    // `fatal: not a git repository` になり、どの名前でも失敗する(実機で確認。差分 1)。名前の誤りと見せないよう、
    // アプリ独自の規則を通った名前のときだけ、名前と関係の無い main で git がこのフォルダで動くかを確かめる
    if (getBranchNameRuleViolation(branch) === null) {
      await runGitStep(() => git.raw(['check-ref-format', '--branch', 'main']), toInitError)
    }
    throw err
  }
  // 3. 親フォルダのリポジトリも含めて判定する(gitignore されたサブフォルダでも親を拾う。実機で確認)。
  //    壊れた .git ファイル・HEAD の無い .git(失敗した init の残骸)は false になる(差分 1)。
  //    bare リポジトリと .git ディレクトリの中も false になるため、rev-parse --git-dir でも確かめる(差分 15)
  if (
    (await runGitStep(() => git.checkIsRepo(), toInitError)) ||
    (await runGitStep(() => isInsideGitDirectory(git), toInitError))
  ) {
    throw new Error(ALREADY_REPOSITORY_MESSAGE)
  }
  // 4. 値を 1 つの引数にする(パターン 49)
  await runGitStep(() => git.raw(['init', `--initial-branch=${branch}`]), toInitError)
  // 5. 終了コード 0 は効果があったことを意味しない(パターン 69)
  const head = await runGitStep(() => getCurrentBranchRef(git), toInitError)
  if (head !== `${HEADS_NAMESPACE}${branch}`) throw failure(INIT_FAILURE, '')
}

// リモート origin を追加する(この時点では通信しない。-f を付けない)。url は IPC 境界から届く任意の文字列。
// 許可リスト(@shared/remoteUrl)が唯一の防御: simple-git は `git remote add -- origin <url>` で ext::・fd::・
// --upload-pack=... も止めない(実機で確認)。url.<base>.insteadOf などの書き換えは利用者の設定として尊重し、
// 検証は入力した URL に対して行う(既知の制約)。windowsPaths はテスト用(既定は実行中の OS)
export async function addOrigin(
  folderPath: string,
  rawUrl: string,
  timeoutMs: number = REMOTE_SETUP_LOCAL_TIMEOUT_MS,
  windowsPaths: boolean = process.platform === 'win32'
): Promise<void> {
  // 前後の空白だけを除く(NFC にはそろえない。URL の中の文字を変えるとサーバー側で別のパスになる)
  const url = normalizeRemoteUrl(rawUrl)
  const violation = getRemoteUrlRuleViolation(url, { windowsPaths })
  if (violation !== null) throw new Error(REMOTE_URL_RULE_MESSAGES[violation])
  // remote add は config.lock が残っていると URL をそのまま出して失敗する(実機で確認)。検証はパスワード入りの URL を
  // 拒否するが、scp 形式・ssh:// の user は残る。文言は IPC で画面まで届くため、詳細の userinfo を伏せる(防御の 2 層)
  const toAddError = (err: unknown): Error =>
    toStepError(err, ADD_ORIGIN_TIMEOUT_MESSAGE, ADD_ORIGIN_FAILURE, redactCredentials)
  const git = openGit(
    folderPath,
    () => simpleGit(folderPath, { timeout: { block: timeoutMs } }),
    toAddError
  )
  if (!(await runGitStep(() => git.checkIsRepo(), toAddError))) {
    throw new Error(NOT_REPOSITORY_MESSAGE)
  }
  // git remote add は already exists の英語で失敗する。先に日本語で弾く(バナーの hasOrigin と同じ判定)
  if (await runGitStep(() => hasOriginRemote(git), toAddError)) {
    throw new Error(ORIGIN_EXISTS_MESSAGE)
  }
  // URL は `--` の後に置く(パターン 21)
  await runGitStep(() => git.raw(['remote', 'add', '--', ORIGIN_REMOTE, url]), toAddError)
  // 終了コード 0 は効果があったことを意味しない(パターン 69)
  const actual = await runGitStep(
    () => git.raw(['config', '--get', `remote.${ORIGIN_REMOTE}.url`]),
    toAddError
  )
  if (actual.trim() !== url) throw failure(ADD_ORIGIN_FAILURE, '')
}

// upstream の無い現在のブランチを origin へ送り、upstream を設定する(git push --set-upstream)。
// 既存の push と同じ打ち切り(GIT_REMOTE_TIMEOUT_MS・progress あり)を使い、事前検証の git 呼び出しも同じ simple-git で行う。
// 引数は IPC 境界から受け取らない(対象は常に現在のブランチ)。timeoutMs はテスト用
export async function pushSetUpstream(
  folderPath: string,
  timeoutMs: number = GIT_REMOTE_TIMEOUT_MS
): Promise<void> {
  // ssh:// と scp 形式の push の失敗では、ssh 自身が `u:pw@github.com: Permission denied (publickey).` のように
  // 接続先を資格情報ごと出し、git はそのまま流す(https・http は git が取り除く。実機 git 2.50.1 で確認)。
  // 文言は IPC で画面まで届くため、addOrigin と同じく詳細の資格情報を伏せる(差分 20)
  const toPushError = (err: unknown): Error =>
    toStepError(err, REMOTE_OPERATION_TIMEOUT_MESSAGE, SET_UPSTREAM_FAILURE, redactCredentials)
  const git = openGit(
    folderPath,
    () => simpleGitWithRemoteTimeout(folderPath, timeoutMs),
    toPushError
  )
  // 1. リポジトリ
  if (!(await runGitStep(() => git.checkIsRepo(), toPushError))) {
    throw new Error(NOT_REPOSITORY_MESSAGE)
  }
  // 2. origin(バナーの hasOrigin と同じ判定)
  if (!(await runGitStep(() => hasOriginRemote(git), toPushError))) {
    throw new Error(NO_ORIGIN_FOR_PUSH_MESSAGE)
  }
  // 3. 現在のブランチ(detached・リベース中・bisect 中は null。マージの isOnBranch と同じ判定)
  const ref = await runGitStep(() => getCurrentBranchRef(git), toPushError)
  if (ref === null) throw new Error(NOT_ON_BRANCH_FOR_PUSH_MESSAGE)
  // 4. コミット(git に任せると `src refspec main does not match any` の英語になる)
  const head = await runGitStep(() => git.raw(['rev-parse', '-q', '--verify', 'HEAD']), toPushError)
  if (head.trim() === '') throw new Error(NO_COMMIT_FOR_PUSH_MESSAGE)
  // 5. upstream が既にあれば上書きしない(-u は既存の branch.<b>.remote / merge を黙って上書きする。パターン 45)。
  //    判定はバナーの status.tracking と同じく ref の解決で行う(パターン 59)。出力は短い名前(origin/main)
  const upstream = (
    await runGitStep(
      () => git.raw(['for-each-ref', '--format=%(upstream:short)', ref]),
      toPushError
    )
  ).trim()
  if (upstream !== '') throw new Error(`upstream は既に設定されています: ${upstream}`)
  //    %(upstream:short) は、削除済みの remote や fetch の refspec の無い remote を指す upstream を空にする
  //    (実機で確認)。その branch.<b>.remote / merge も上書きしないよう、設定そのものも確かめる(差分 16)。
  //    ブランチ名の . や / はキーのサブセクションにそのまま入る(実機で確認)
  const branch = ref.slice(HEADS_NAMESPACE.length)
  const readBranchConfig = async (key: 'remote' | 'merge'): Promise<string> =>
    (
      await runGitStep(() => git.raw(['config', '--get', `branch.${branch}.${key}`]), toPushError)
    ).trim()
  if ((await readBranchConfig('remote')) !== '' || (await readBranchConfig('merge')) !== '') {
    throw new Error(UPSTREAM_CONFIG_EXISTS_MESSAGE)
  }
  // 6. 完全な refspec で送る: (a) 同名のタグがあると短い名前は `matches more than one` で失敗する(パターン 43)、
  //    (b) refs/ で始まるので - で始まるブランチ名もオプションにならない(パターン 21)、(c) `--` は使えない
  //    (progress プラグインが末尾に足す --progress が refspec になる)。明示した refspec のため push.default・
  //    push.autoSetupRemote・remote.origin.push に影響されない(いずれも実機で確認)。pre-push フックは実行する
  await runGitStep(
    () => git.raw(['push', '--set-upstream', ORIGIN_REMOTE, `${ref}:${ref}`]),
    toPushError
  )
  // 7. 設定の確認(パターン 69)。for-each-ref %(upstream) で確かめないのは、fetch の refspec の無い origin では
  //    branch.<b>.remote / merge が設定されても空のままになるため(既知の制約)
  const remote = await readBranchConfig('remote')
  const merge = await readBranchConfig('merge')
  if (remote !== ORIGIN_REMOTE || merge !== ref) {
    throw new Error(UPSTREAM_NOT_CONFIRMED_MESSAGE)
  }
}
```

```bash
npx vitest run src/main/__tests__/gitRemoteSetupService.test.ts src/main/__tests__/gitRemoteSetupService.integration.test.ts
```

Expected: PASS

- [ ] **Step 4: ミューテーション**

手順は Global Constraints のとおり。次の変異で、それぞれ該当のテストが落ちること（落ちない変異があればテストを足す）。

1. `initRepository` の `normalizeInitialBranchName(rawBranch)` を `rawBranch` にする → 単体の NFC・空白、統合の NFD・前後の空白
2. `assertValidNewBranchName` の呼び出しを外す → 単体の `-x`・`@`・check-ref-format、統合の `HEAD`・`-x`・`@`・`a..b`（`.git` が作られる）
3. `checkIsRepo` の判定を外す → 単体の「既にリポジトリ」、統合の既存のリポジトリ（`trunk` に再初期化はされないが拒否されない）・サブフォルダ（`.git` が作られる）
4. `['init', `--initial-branch=${branch}`]` を `['init', '--initial-branch', branch]` の 2 引数にする → 単体の引数のテスト
5. 作成の確認（`head !== ...`）を外す → 単体の `refs/heads/master`
6. `addOrigin` の規則の検証を外す → 単体の規則の違反（git が呼ばれる）、統合の拒否（`.git/config` が変わる）・`protocol.ext.allow`
7. `hasOriginRemote` の判定を外す → 単体の origin あり、統合の origin あり・`remote.origin.fetch` だけ（git の英語のエラーになる）
8. `['remote', 'add', '--', ORIGIN_REMOTE, url]` から `'--'` を外す → 単体の引数のテスト
9. 追加の確認（`actual.trim() !== url`）を外す → 単体の remote.origin.url の不一致
10. `windowsPaths` の既定を `false` にする → 単体の「既定は process.platform === win32」
11. push の refspec を `ref.slice(HEADS_NAMESPACE.length)` の短い名前にする → 単体の引数、統合の同名のタグ（`matches more than one`）
12. push の引数に `'--'` を足す（`['push', '--set-upstream', 'origin', '--', `${ref}:${ref}`]`）→ 単体の「`--` を使わない」、統合の全成功ケース（`--progress` が refspec になる）
13. upstream の事前判定を外す → 単体の「upstream が既にある」、統合の「上書きしない」（成功して例外にならない）
14. コミットの判定を外す → 単体・統合のコミット無し（git の英語のエラー）
15. 設定の確認（`remote.trim() !== ORIGIN_REMOTE || ...`）を外す → 単体の branch.<b>.remote が無い / merge が別
16. `toStepError`（gitStepErrors）の `isGitTimeoutError` の分岐を外す → 単体の打ち切りのテスト（init・remote add・push・事前検証）、統合の pre-push フック
17. `runGitStep` で包まずに `await git.checkIsRepo()` を直接呼ぶ（`initRepository`）→ 単体の dubious ownership
18. 名前の検証の `catch` の中の `check-ref-format --branch main` の確認を外す → 単体の「名前と関係なく失敗」、統合の壊れた `.git` ファイル（`ブランチ名として使用できない名前です: main` になる）。`getBranchNameRuleViolation(branch) === null` の条件を外す → 単体の `-x`・`@`（git が呼ばれる）
19. `initRepository` の判定から `isInsideGitDirectory`（`rev-parse --git-dir`）を外す → 単体の「`rev-parse --git-dir` が成功すれば拒否」、統合の bare リポジトリ・その中・`.git` ディレクトリ・その中（`.git` が作られる）
20. `isInsideGitDirectory` の `catch` で打ち切りを区別しない（常に `false`）→ 単体の「`rev-parse --git-dir` の打ち切り」（init に進む）
21. `isInsideGitDirectory` の `catch` で `true` を返す（reject をリポジトリ扱い）→ 単体・統合の通常の初期化（管理外のフォルダ・失敗した init の残骸を含めて拒否される）
22. `pushSetUpstream` の push の前の `branch.<b>.remote` / `merge` の判定を外す → 単体の「remote だけ / merge だけが設定済み」、統合の `ghost` の設定（`main`・`feat.x/y`・`Feat.X/y`。上書きされる）
23. 上の判定を `remote` だけ（または `merge` だけ）にする → 単体の「merge だけ（または remote だけ）が設定済み」
24. `openGit` の `GitConstructError` の変換を外す → 単体・統合の「フォルダが存在しない」（3 関数。英語の `Cannot use simple-git on a directory that does not exist`）
25. `openGit` の `err instanceof GitConstructError` を `err instanceof Error` にする（どの失敗もフォルダが見つからない旨にする）→ 単体の「simple-git の生成が GitConstructError 以外で失敗する」（3 関数）
26. `branch.${branch}.${key}` を `branch.${branch.toLowerCase()}.${key}` にする → 統合の `ghost` の設定の `Feat.X/y`（サブセクションは大文字小文字を区別するため、設定を見落として上書きする）
27. （差分 19。差分 24 で更新）`toAddError` の `redactCredentials` を外す → 統合の「config.lock が残っていて失敗しても、文言に URL の user を出さない」（`tok123` が文言に出る）
28. （差分 20）`toPushError` の `redactCredentials` を外す → 統合の「ssh の認証の失敗(…)でも、文言に資格情報を出さない」の 2 件（`u:pw@github.com`・`tok123@github.com` が文言に出る）
29. （差分 21）`REMOTE_URL_RULE_MESSAGES` の invalid-char の文言から `・引用符（' " `）` を除く → 単体の規則の違反（invalid-char）の 3 件
30. （差分 25）`REMOTE_URL_RULE_MESSAGES` の unsupported の文言から `（認証は credential helper か ssh の鍵を使います）` を除く → 単体の規則の違反（unsupported）の 7 件

- [ ] **Step 5: 検証**

```bash
npx vitest run src/main
npm run typecheck
npx eslint src/main/gitRemoteSetupService.ts src/main/__tests__/gitRemoteSetupService.test.ts src/main/__tests__/gitRemoteSetupService.integration.test.ts
npx prettier --check src/main/gitRemoteSetupService.ts src/main/__tests__/gitRemoteSetupService.test.ts src/main/__tests__/gitRemoteSetupService.integration.test.ts
```

Expected: すべて成功

- [ ] **Step 6: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 5: IPC ハンドラ・preload・`gitApi`

**Files:**

- Modify: `src/main/handlers/gitHandlers.ts`, `src/preload/api.ts`, `src/preload/index.d.ts`, `src/renderer/src/lib/gitApi.ts`
- Test: `src/main/__tests__/handlers/gitHandlers.test.ts`, `src/preload/__tests__/api.test.ts`, `src/renderer/src/lib/__tests__/gitApi.test.ts`

**Interfaces:**

- Consumes: Task 4 の `initRepository` / `addOrigin` / `pushSetUpstream`
- Produces: IPC `git:init` / `git:addOrigin` / `git:pushSetUpstream`、`window.api.initRepository(branch)` / `addOrigin(url)` / `pushSetUpstream()`、`gitApi.initRepository(branch: string): Promise<void>` / `gitApi.addOrigin(url: string): Promise<void>` / `gitApi.pushSetUpstream(): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/handlers/gitHandlers.test.ts`:

- `const mockCreateTag = vi.hoisted(() => vi.fn())` の次に追加:

```ts
const mockInitRepository = vi.hoisted(() => vi.fn())
const mockAddOrigin = vi.hoisted(() => vi.fn())
const mockPushSetUpstream = vi.hoisted(() => vi.fn())
```

- `vi.mock('../../gitTagService', () => ({ createTag: mockCreateTag }))` の次に追加:

```ts
vi.mock('../../gitRemoteSetupService', () => ({
  initRepository: mockInitRepository,
  addOrigin: mockAddOrigin,
  pushSetUpstream: mockPushSetUpstream
}))
```

- `describe('git:createTag', ...)` の後に追加:

```ts
// service は第 3 引数以降にテスト用の値(打ち切りの時間・windowsPaths)を取る。renderer から届いた余分な引数を
// そこへ渡さない(許可フォルダと値の 2 つだけで呼ぶ)
describe.each([
  ['git:init', () => mockInitRepository, 'main', 'Invalid branch name'],
  ['git:addOrigin', () => mockAddOrigin, 'https://github.com/a/b.git', 'Invalid remote url']
] as const)('%s', (channel, getMock, value, invalidMessage) => {
  // 型検証より先にフォルダの許可を確認する
  it('folderAccess が未設定のとき、引数に関わらず "No folder open" エラーをスロー', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
    registerGitHandlers(mockIpcMain, folderAccess)
    await expect(getRegisteredHandler(channel)(makeEvent(1), 123)).rejects.toThrow('No folder open')
    expect(getMock()).not.toHaveBeenCalled()
  })

  it('allowedFolder と値だけで service を呼ぶ(余分な引数は渡さない)', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    getMock().mockResolvedValue(undefined)
    await getRegisteredHandler(channel)(makeEvent(1), value, 1, true)
    expect(getMock().mock.calls[0]).toStrictEqual(['/project', value])
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['数値', 1],
    ['配列', [value]],
    ['オブジェクト', { value }]
  ])('値が文字列でない(%s)なら service を呼ばずに拒否する', async (_label, bad) => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    await expect(getRegisteredHandler(channel)(makeEvent(1), bad)).rejects.toThrow(invalidMessage)
    expect(getMock()).not.toHaveBeenCalled()
  })

  it('service の失敗をそのまま伝える', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    getMock().mockRejectedValue(new Error('リモート origin は既に設定されています'))
    await expect(getRegisteredHandler(channel)(makeEvent(1), value)).rejects.toThrow(
      'リモート origin は既に設定されています'
    )
  })
})

describe('git:pushSetUpstream', () => {
  it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
    registerGitHandlers(mockIpcMain, folderAccess)
    await expect(getRegisteredHandler('git:pushSetUpstream')(makeEvent(1))).rejects.toThrow(
      'No folder open'
    )
    expect(mockPushSetUpstream).not.toHaveBeenCalled()
  })

  // 第 2 引数(打ち切りの時間)に renderer の値が渡ると、打ち切りを無効にできてしまう
  it('allowedFolder だけで pushSetUpstream を呼ぶ(余分な引数は渡さない)', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    mockPushSetUpstream.mockResolvedValue(undefined)
    await getRegisteredHandler('git:pushSetUpstream')(makeEvent(1), 999_999)
    expect(mockPushSetUpstream.mock.calls[0]).toStrictEqual(['/project'])
  })

  it('pushSetUpstream の失敗をそのまま伝える', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    mockPushSetUpstream.mockRejectedValue(
      new Error('コミットが無いため、初回 push できません。先にコミットしてください')
    )
    await expect(getRegisteredHandler('git:pushSetUpstream')(makeEvent(1))).rejects.toThrow(
      'コミットが無いため、初回 push できません。先にコミットしてください'
    )
  })
})
```

`src/preload/__tests__/api.test.ts` の `invokeCases` の `createTag` の項目の後に追加:

```ts
  [
    'initRepository は git:init チャンネルにブランチ名を渡す',
    () => api.initRepository('main'),
    ['git:init', 'main']
  ],
  [
    'addOrigin は git:addOrigin チャンネルに URL を渡す',
    () => api.addOrigin('https://github.com/a/b.git'),
    ['git:addOrigin', 'https://github.com/a/b.git']
  ],
  [
    'pushSetUpstream は git:pushSetUpstream チャンネルを引数なしで呼び出す',
    () => api.pushSetUpstream(),
    ['git:pushSetUpstream']
  ],
```

`src/renderer/src/lib/__tests__/gitApi.test.ts`:

- import に `initRepository, addOrigin, pushSetUpstream` を足し、`mockApi` に `initRepository: vi.fn(), addOrigin: vi.fn(), pushSetUpstream: vi.fn(),` を足す
- ファイル末尾に追加:

```ts
describe('initRepository / addOrigin / pushSetUpstream', () => {
  it('window.api の同名の関数を値で呼ぶ', async () => {
    mockApi.initRepository.mockResolvedValue(undefined)
    mockApi.addOrigin.mockResolvedValue(undefined)
    mockApi.pushSetUpstream.mockResolvedValue(undefined)
    await initRepository('main')
    await addOrigin('https://github.com/a/b.git')
    await pushSetUpstream()
    expect(mockApi.initRepository).toHaveBeenCalledWith('main')
    expect(mockApi.addOrigin).toHaveBeenCalledWith('https://github.com/a/b.git')
    expect(mockApi.pushSetUpstream).toHaveBeenCalledWith()
  })

  it('失敗をそのまま伝える', async () => {
    mockApi.pushSetUpstream.mockRejectedValue(
      new Error('リモート origin が未設定のため、初回 push できません')
    )
    await expect(pushSetUpstream()).rejects.toThrow(
      'リモート origin が未設定のため、初回 push できません'
    )
  })
})
```

```bash
npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts src/preload src/renderer/src/lib/__tests__/gitApi.test.ts
```

Expected: FAIL（ハンドラ・preload・gitApi の関数が無い）

- [ ] **Step 2: 実装する**

`src/main/handlers/gitHandlers.ts`:

- import に `import { initRepository, addOrigin, pushSetUpstream } from '../gitRemoteSetupService'` を足す（`createTag` の import の次）
- `assertCreateTagArg` の後に追加:

```ts
// 文字列であることだけを検証する。値の中身(許可リスト・長さ・制御文字)は service 層が検証する
function assertRemoteUrlArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid remote url')
}
```

- `git:createTag` のハンドラの後に追加:

```ts
// service の第 3 引数以降(打ち切りの時間・windowsPaths)はテスト用。renderer から届いた余分な引数は渡さない
ipcMain.handle('git:init', async (event: IpcMainInvokeEvent, branch: unknown) => {
  const allowedFolder = getAllowedFolder(folderAccess, event)
  assertBranchNameArg(branch)
  await initRepository(allowedFolder, branch)
})

ipcMain.handle('git:addOrigin', async (event: IpcMainInvokeEvent, url: unknown) => {
  const allowedFolder = getAllowedFolder(folderAccess, event)
  assertRemoteUrlArg(url)
  await addOrigin(allowedFolder, url)
})

ipcMain.handle('git:pushSetUpstream', async (event: IpcMainInvokeEvent) => {
  const allowedFolder = getAllowedFolder(folderAccess, event)
  await pushSetUpstream(allowedFolder)
})
```

`src/preload/api.ts` の `createTag` の後に追加:

```ts
  initRepository: (branch: string): Promise<void> => ipcRenderer.invoke('git:init', branch),
  addOrigin: (url: string): Promise<void> => ipcRenderer.invoke('git:addOrigin', url),
  pushSetUpstream: (): Promise<void> => ipcRenderer.invoke('git:pushSetUpstream'),
```

`src/preload/index.d.ts` の `createTag(request: CreateTagRequest): Promise<void>` の後に追加:

```ts
      initRepository(branch: string): Promise<void>
      addOrigin(url: string): Promise<void>
      pushSetUpstream(): Promise<void>
```

`src/renderer/src/lib/gitApi.ts` の末尾に追加:

```ts
// Git 管理外のフォルダに空のリポジトリを作る(最初のブランチ名を渡す)
export function initRepository(branch: string): Promise<void> {
  return window.api.initRepository(branch)
}

// リモート origin を追加する(この時点では通信しない)
export function addOrigin(url: string): Promise<void> {
  return window.api.addOrigin(url)
}

// 現在のブランチを origin へ送り、upstream を設定する
export function pushSetUpstream(): Promise<void> {
  return window.api.pushSetUpstream()
}
```

```bash
npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts src/preload src/renderer/src/lib/__tests__/gitApi.test.ts
npm run typecheck
```

Expected: PASS

- [ ] **Step 3: ミューテーション**

1. `git:init` のハンドラで `await initRepository(allowedFolder, branch, ...args)` のように余分な引数を渡す（ハンドラの引数に `...rest: unknown[]` を足して渡す）→ 「余分な引数は渡さない」のテスト
2. `assertRemoteUrlArg` の呼び出しを外す → 「値が文字列でない」の `git:addOrigin` 側
3. `getAllowedFolder` を `assertRemoteUrlArg` の後にする → 「No folder open」の `git:addOrigin`（`Invalid remote url` が先に出る）
4. preload の `git:pushSetUpstream` を `git:push` にする → preload のテスト

- [ ] **Step 4: 検証**

```bash
npx vitest run src/main src/preload src/renderer/src/lib
npm run typecheck
npx eslint src/main/handlers/gitHandlers.ts src/preload/api.ts src/preload/index.d.ts src/renderer/src/lib/gitApi.ts src/main/__tests__/handlers/gitHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/gitApi.test.ts
npx prettier --check src/main/handlers/gitHandlers.ts src/preload/api.ts src/preload/index.d.ts src/renderer/src/lib/gitApi.ts src/main/__tests__/handlers/gitHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/gitApi.test.ts
```

Expected: すべて成功

- [ ] **Step 5: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 6: renderer の状態の導出・検証・フック（`remoteSetupState` / `remoteSetupValidation` / `useGitRemoteSetup` / `useGitRemoteOperations.pushSetUpstream`）

**Files:**

- Modify: `src/renderer/src/types.ts`, `src/renderer/src/hooks/useGitRemoteOperations.ts`, `src/renderer/src/hooks/__tests__/useGitRemoteOperations.test.ts`
- Create: `src/renderer/src/__tests__/makeRemoteSetupPanelState.ts`, `src/renderer/src/lib/remoteSetupState.ts`, `src/renderer/src/lib/__tests__/remoteSetupState.test.ts`, `src/renderer/src/lib/remoteSetupValidation.ts`, `src/renderer/src/lib/__tests__/remoteSetupValidation.test.ts`, `src/renderer/src/hooks/useGitRemoteSetup.ts`, `src/renderer/src/hooks/__tests__/useGitRemoteSetup.test.ts`

**Interfaces:**

- Consumes: Task 1 の `normalizeInitialBranchName` / `getRemoteUrlRuleViolation` / `normalizeRemoteUrl` / `MAX_REMOTE_URL_LENGTH` / `GIT_REMOTE_TIMEOUT_SECONDS`、Task 2 の `GitStatusResult`、Task 5 の `gitApi.initRepository` / `addOrigin` / `pushSetUpstream`、既存の `validateBranchName`（`lib/branchNameValidation.ts`。ブランチ名の規則違反の文言の表を共有する）
- Produces:
  - `RemoteSetupPanelState`（`src/renderer/src/types.ts`）、`makeRemoteSetupPanelState(overrides?)`（テスト用）
  - `getRemoteSetupState(gitStatus: GitStatusResult | null): RemoteSetupKind | null`、`RemoteSetupKind`、`RemoteSetupFocusTarget`、`buildRemoteSetupBannerText(kind, branch): string`、`SETTING_UPSTREAM_NOTICE`（`lib/remoteSetupState.ts`）
  - `validateInitialBranchName(name: string): string | null`、`validateRemoteUrl(url: string): string | null`（`lib/remoteSetupValidation.ts`）
  - `useGitRemoteSetup(gitStatus, refreshGitStatus, refreshHistory, fileLock?): GitRemoteSetupState`（`GitRemoteSetupState` は `RemoteSetupPanelState` から初回 push の 5 項目を除いたもの）
  - `useGitRemoteOperations(gitStatus, refreshGitStatus, fileLock?, refreshHistory?)` の戻り値に `isSettingUpstream: boolean` / `pushSetUpstream: () => Promise<boolean>`

- [ ] **Step 1: 型とテスト用のモックを足す**

`src/renderer/src/types.ts` の `GitTagPanelState` の後に追加:

```ts
// リモートの管理(Git 管理外の「リポジトリを初期化」、状態バナーの「リモートを追加」「初回 push」)が受け取る状態と操作。
// 初期化・追加は useGitRemoteSetup、初回 push は useGitRemoteOperations のものを useAppState で合成する。
// App → Sidebar → SourceControlPanel へ 1 つの props(remoteSetup)で渡し、SourceControlPanel が GitRepoView(状態バナー)と
// NotRepositoryView(Git 管理外のときの初期化)に渡す
export interface RemoteSetupPanelState {
  /** 初期化の実行中か(ダイアログの入力とボタンを disabled にする) */
  isInitializing: boolean
  /** 初期化の失敗(main のエラー)。ダイアログ内に role="alert" で表示する */
  initError: Error | null
  /** 空のリポジトリを作る。戻り値は実際に実行され成功したか(ダイアログを閉じるかの判定に使う)。
   *  他の操作中などで実行しなかった場合と失敗した場合は false */
  initRepository: (branch: string) => Promise<boolean>
  /** initError を消す。ダイアログを開くときに、前回の失敗の表示を持ち越さないために呼ぶ */
  clearInitError: () => void
  /** origin の追加の実行中か */
  isAddingOrigin: boolean
  /** 追加の失敗(main のエラー)。ダイアログ内に role="alert" で表示する */
  addOriginError: Error | null
  /** リモート origin を追加する。戻り値は initRepository と同じ */
  addOrigin: (url: string) => Promise<boolean>
  /** addOriginError を消す */
  clearAddOriginError: () => void
  /** 初回 push の実行中か(push と実行中フラグを共有する。どちらの push かの表示に使う) */
  isSettingUpstream: boolean
  /** push(ツールバーの push・初回 push のどちらか)の実行中か */
  isPushing: boolean
  /** pull 中・他の Git 操作のロック中で、push を要求しても no-op になる状態か */
  isPushBlocked: boolean
  /** push / pull / fetch / 初回 push の失敗(パネル上部に表示する)。初回 push 中の案内を出すかの判定に使う */
  remoteOperationError: Error | null
  /** 現在のブランチを origin へ送り upstream を設定する。戻り値は実際に実行され成功したか */
  pushSetUpstream: () => Promise<boolean>
}
```

`src/renderer/src/__tests__/makeRemoteSetupPanelState.ts`:

```ts
import { vi } from 'vitest'
import type { RemoteSetupPanelState } from '../types'

/**
 * テスト用の RemoteSetupPanelState のモック。既定は「Git 操作を何も実行していない・エラーなし・各操作は成功する」。
 * 各操作は RemoteSetupPanelState の型で vi.fn を作るため、戻り値の契約(Promise<boolean>)から外れたモックは
 * 型検査で検出される(パターン 78)
 */
export const makeRemoteSetupPanelState = (
  overrides: Partial<RemoteSetupPanelState> = {}
): RemoteSetupPanelState => ({
  isInitializing: false,
  initError: null,
  initRepository: vi.fn<RemoteSetupPanelState['initRepository']>().mockResolvedValue(true),
  clearInitError: vi.fn<RemoteSetupPanelState['clearInitError']>(),
  isAddingOrigin: false,
  addOriginError: null,
  addOrigin: vi.fn<RemoteSetupPanelState['addOrigin']>().mockResolvedValue(true),
  clearAddOriginError: vi.fn<RemoteSetupPanelState['clearAddOriginError']>(),
  isSettingUpstream: false,
  isPushing: false,
  isPushBlocked: false,
  remoteOperationError: null,
  pushSetUpstream: vi.fn<RemoteSetupPanelState['pushSetUpstream']>().mockResolvedValue(true),
  ...overrides
})
```

- [ ] **Step 2: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/remoteSetupState.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { GitStatusResult } from '@shared/types'
import { GIT_REMOTE_TIMEOUT_SECONDS } from '@shared/remoteTimeout'
import {
  SETTING_UPSTREAM_NOTICE,
  buildRemoteSetupBannerText,
  getRemoteSetupState
} from '../remoteSetupState'

const configured: GitStatusResult = {
  isRepo: true,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [],
  mergeInProgress: false,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/main',
  detached: false
}

// 設計書の「状態ごとの表示」の表の各行。バナー(RemoteSetupBanner)とテストが同じ判定を使う
describe('getRemoteSetupState', () => {
  it.each([
    ['gitStatus が null', null, null],
    [
      'リポジトリでない',
      {
        ...configured,
        isRepo: false,
        branch: null,
        hasOrigin: false,
        hasRemote: false,
        upstream: null
      },
      null
    ],
    [
      'リモートが 1 つも無い',
      { ...configured, hasOrigin: false, hasRemote: false, upstream: null },
      'no-origin'
    ],
    [
      'リモートが無く detached でも no-origin(追加はブランチに関係しない)',
      {
        ...configured,
        hasOrigin: false,
        hasRemote: false,
        upstream: null,
        detached: true,
        branch: 'HEAD'
      },
      'no-origin'
    ],
    // git clone -o github など。既存の push / pull は通信できるため何も出さない(レビュー 8 周目)
    [
      'origin 以外の名前のリモートだけ・upstream あり',
      { ...configured, hasOrigin: false, hasRemote: true, upstream: 'github/main' },
      null
    ],
    // 初回 push は origin 固定で、押しても「リモート origin が未設定のため…」で拒否されるため出さない
    [
      'origin 以外の名前のリモートだけ・upstream なし(新しいブランチ)',
      { ...configured, hasOrigin: false, hasRemote: true, upstream: null },
      null
    ],
    [
      'origin あり・detached(リベース中など)',
      { ...configured, upstream: null, detached: true, branch: 'HEAD' },
      null
    ],
    ['origin あり・ブランチの上・upstream なし', { ...configured, upstream: null }, 'no-upstream'],
    // コミットが無い(init の直後)ことは status では区別せず、同じバナーを出す(押すと main が拒否する)
    [
      'コミットが無くても同じ',
      { ...configured, upstream: null, ahead: 0, files: [] },
      'no-upstream'
    ],
    ['upstream 設定済み(gone を含む)', configured, null],
    ['ローカルのブランチが upstream', { ...configured, upstream: 'main' }, null],
    [
      'マージ中でも条件どおり',
      { ...configured, mergeInProgress: true, upstream: null },
      'no-upstream'
    ],
    ['branch が null', { ...configured, branch: null, upstream: null }, null]
  ] as Array<[string, GitStatusResult | null, string | null]>)(
    '%s → %s',
    (_label, status, expected) => {
      expect(getRemoteSetupState(status)).toBe(expected)
    }
  )

  // リポジトリの中の全組み合わせ(リモートの有無 3 通り × ブランチの位置 3 通り × upstream の有無 2 通り)。
  // origin があればリモートもあるため、hasOrigin: true・hasRemote: false の組は git の上では起きない(作らない)
  const remotes = {
    なし: { hasOrigin: false, hasRemote: false },
    'origin 以外だけ': { hasOrigin: false, hasRemote: true },
    'origin あり': { hasOrigin: true, hasRemote: true }
  } as const
  const positions = {
    ブランチの上: { detached: false, branch: 'main' },
    detached: { detached: true, branch: 'HEAD' },
    'branch が null': { detached: false, branch: null }
  } as const
  // リモートが無いと upstream はローカルのブランチ(main)だけがあり得る
  const upstreams = { なし: null, あり: 'x/main' } as const
  it.each([
    ['なし', 'ブランチの上', 'なし', 'no-origin'],
    ['なし', 'ブランチの上', 'あり', 'no-origin'],
    ['なし', 'detached', 'なし', 'no-origin'],
    ['なし', 'detached', 'あり', 'no-origin'],
    ['なし', 'branch が null', 'なし', 'no-origin'],
    ['なし', 'branch が null', 'あり', 'no-origin'],
    ['origin 以外だけ', 'ブランチの上', 'なし', null],
    ['origin 以外だけ', 'ブランチの上', 'あり', null],
    ['origin 以外だけ', 'detached', 'なし', null],
    ['origin 以外だけ', 'detached', 'あり', null],
    ['origin 以外だけ', 'branch が null', 'なし', null],
    ['origin 以外だけ', 'branch が null', 'あり', null],
    ['origin あり', 'ブランチの上', 'なし', 'no-upstream'],
    ['origin あり', 'ブランチの上', 'あり', null],
    ['origin あり', 'detached', 'なし', null],
    ['origin あり', 'detached', 'あり', null],
    ['origin あり', 'branch が null', 'なし', null],
    ['origin あり', 'branch が null', 'あり', null]
  ] as Array<
    [keyof typeof remotes, keyof typeof positions, keyof typeof upstreams, string | null]
  >)('リモート %s・%s・upstream %s → %s', (remote, position, upstream, expected) => {
    const status: GitStatusResult = {
      ...configured,
      ...remotes[remote],
      ...positions[position],
      upstream:
        upstreams[upstream] === null ? null : remote === 'なし' ? 'main' : upstreams[upstream]
    }
    expect(getRemoteSetupState(status)).toBe(expected)
  })
})

describe('buildRemoteSetupBannerText', () => {
  it('種類ごとの文言(upstream はブランチ名を括弧で添える)', () => {
    expect(buildRemoteSetupBannerText('no-origin', 'main')).toBe('リモートが未設定です')
    expect(buildRemoteSetupBannerText('no-upstream', 'feat/x')).toBe(
      'upstream が未設定です（feat/x）'
    )
  })

  it('branch が null のとき no-upstream では括弧内が空文字になる', () => {
    // L31: `upstream が未設定です（${branch ?? ''}）` の branch ?? '' ブランチ
    expect(buildRemoteSetupBannerText('no-upstream', null)).toBe('upstream が未設定です（）')
  })
})

// 秒数は main の打ち切り(GIT_REMOTE_TIMEOUT_MS)から組み立てる(パターン 88)
describe('SETTING_UPSTREAM_NOTICE', () => {
  it('打ち切りまでの秒数を共有の定数から組み立てる', () => {
    expect(SETTING_UPSTREAM_NOTICE).toBe(
      `初回 push 中です。応答が ${GIT_REMOTE_TIMEOUT_SECONDS} 秒途絶えると打ち切ります`
    )
    expect(SETTING_UPSTREAM_NOTICE).toBe('初回 push 中です。応答が 30 秒途絶えると打ち切ります')
  })
})
```

`src/renderer/src/lib/__tests__/remoteSetupValidation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeInitialBranchName } from '@shared/branchName'
import { validateBranchName } from '../branchNameValidation'
import { validateInitialBranchName, validateRemoteUrl } from '../remoteSetupValidation'

// ダイアログの検証(UX 用)。規則と順序は main と共有の @shared/branchName・@shared/remoteUrl を使い、
// git の規則(check-ref-format)と Windows のドライブの形の最終判断は main が行う
describe('validateInitialBranchName', () => {
  it.each([
    ['', '名前を入力してください'],
    ['   ', '名前を入力してください'],
    ['-x', '`-` で始まる名前は使用できません'],
    ['@', 'この名前は使用できません']
  ])('%j → %s', (name, message) => {
    expect(validateInitialBranchName(name)).toBe(message)
  })

  // HEAD・a..b などは main の check-ref-format に委ねる(ダイアログでは通す)
  it.each(['main', '  main  ', 'feat/x', 'HEAD', 'a..b', '日本語'])('%j は null', (name) => {
    expect(validateInitialBranchName(name)).toBeNull()
  })

  // 文言の表はブランチの作成ダイアログ(validateBranchName)と共有する(同じ層に表を 2 つ持たない。パターン 88)。
  // 値は main の入口と同じ正規化(前後の空白の除去・NFC)を通してから検証する(パターン 83)
  it.each(['', '-x', '@', '  -x  ', '\t@\n', 'e\u0301', '  main  ', 'HEAD'])(
    '%j は validateBranchName(normalizeInitialBranchName(x), []) と一致する',
    (name) => {
      expect(validateInitialBranchName(name)).toBe(
        validateBranchName(normalizeInitialBranchName(name), [])
      )
    }
  )
})

describe('validateRemoteUrl', () => {
  it.each([
    ['', 'URL を入力してください'],
    ['  \n', 'URL を入力してください'],
    [`https://h/${'a'.repeat(2039)}`, 'URL が長すぎます（2048 文字まで）'],
    ['https://h/a b', 'URL に空白・改行・制御文字・引用符（\' " `）は使用できません'],
    // 引用符も invalid-char(main と共有の判定)
    ["https://u:p'ss@h/r", 'URL に空白・改行・制御文字・引用符（\' " `）は使用できません'],
    ["/repos/O'Brien/b.git", 'URL に空白・改行・制御文字・引用符（\' " `）は使用できません'],
    ['--upload-pack=x', '`-` で始まる URL は使用できません'],
    [
      'ext::sh',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // git:// は userinfo を許可しない(main と共有の判定)
    [
      'git://alice:s3cret@host/a',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // authority の `@` は 1 個まで(main と共有の判定)
    [
      'ssh://u:p@ss@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // ssh:// の userinfo を decode した結果に `/` があれば拒否する(main と共有の判定。4 周目のレビュー)
    [
      'ssh://alice:s3cr%2Fet@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // userinfo の生の `/` で authority が `user:pa` に切れる形は、port が数字でないため拒否する(main と共有の判定。
    // 5 周目のレビュー)
    [
      'ssh://user:pa/ss@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // パスワード入りの URL は構造的に拒否する(main と共有の判定。認証は credential helper に任せる)
    [
      'https://alice:ghp_TOKEN@github.com/a/b.git',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    [
      'https://alice:1234/s3cret@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    [
      'https://h#sec@h2/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ]
  ])('%j → %s', (url, message) => {
    expect(validateRemoteUrl(url)).toBe(message)
  })

  // renderer は platform を知らないため、Windows のドライブの形は寛容側で通す(最終判断は main)
  it.each([
    'https://github.com/a/b.git',
    '  git@github.com:a/b.git  ',
    '/abs/bare.git',
    'C:/repos/a.git'
  ])('%j は null', (url) => {
    expect(validateRemoteUrl(url)).toBeNull()
  })
})
```

`src/renderer/src/hooks/__tests__/useGitRemoteSetup.test.ts`:

```ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitStatusResult } from '@shared/types'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useGitRemoteSetup } from '../useGitRemoteSetup'
import type { FileOperationLock } from '../useFileOperationLock'

const mockInitRepository = vi.mocked(gitApi.initRepository)
const mockAddOrigin = vi.mocked(gitApi.addOrigin)

const notRepo: GitStatusResult = {
  isRepo: false,
  branch: null,
  ahead: 0,
  behind: 0,
  files: [],
  mergeInProgress: false,
  hasOrigin: false,
  hasRemote: false,
  upstream: null,
  detached: false
}
const repoWithoutOrigin: GitStatusResult = { ...notRepo, isRepo: true, branch: 'main' }

const makeFileLock = (overrides: Partial<FileOperationLock> = {}): FileOperationLock => ({
  isLocked: vi.fn().mockReturnValue(false),
  lock: vi.fn(),
  unlock: vi.fn(),
  isAnyLocked: vi.fn().mockReturnValue(false),
  lockGlobal: vi.fn(),
  unlockGlobal: vi.fn(),
  ...overrides
})

const setup = (
  gitStatus: GitStatusResult | null,
  lock: FileOperationLock = makeFileLock()
): ReturnType<typeof renderHook<ReturnType<typeof useGitRemoteSetup>, unknown>> & {
  refreshGitStatus: ReturnType<typeof vi.fn<() => Promise<void>>>
  refreshHistory: ReturnType<typeof vi.fn<() => Promise<void>>>
} => {
  const refreshGitStatus = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const refreshHistory = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const hook = renderHook(() =>
    useGitRemoteSetup(gitStatus, refreshGitStatus, refreshHistory, lock)
  )
  return Object.assign(hook, { refreshGitStatus, refreshHistory })
}

// 保留させ、解決・失敗を後から起こせるようにする
const hold = (
  mock: typeof mockInitRepository | typeof mockAddOrigin
): { resolve: () => void; reject: (err: Error) => void } => {
  const handlers: { resolve: () => void; reject: (err: Error) => void } = {
    resolve: () => {},
    reject: () => {}
  }
  mock.mockImplementationOnce(
    () =>
      new Promise<void>((resolve, reject) => {
        handlers.resolve = () => resolve()
        handlers.reject = reject
      })
  )
  return { resolve: () => handlers.resolve(), reject: (err) => handlers.reject(err) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInitRepository.mockReset()
  mockAddOrigin.mockReset()
})

describe('initRepository', () => {
  it('gitApi.initRepository を呼び、ステータスと履歴を取り直して true を返す', async () => {
    mockInitRepository.mockResolvedValue(undefined)
    const { result, refreshGitStatus, refreshHistory } = setup(notRepo)
    let succeeded = false
    await act(async () => {
      succeeded = await result.current.initRepository('develop')
    })
    expect(succeeded).toBe(true)
    expect(mockInitRepository).toHaveBeenCalledWith('develop')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).toHaveBeenCalledOnce()
    expect(result.current.isInitializing).toBe(false)
    expect(result.current.initError).toBeNull()
  })

  it('失敗は initError に入れて false を返し、取り直しはする', async () => {
    mockInitRepository.mockRejectedValue(new Error('ブランチ名として使用できない名前です: a..b'))
    const { result, refreshGitStatus, refreshHistory } = setup(notRepo)
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.initRepository('a..b')
    })
    expect(succeeded).toBe(false)
    expect(result.current.initError?.message).toBe('ブランチ名として使用できない名前です: a..b')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).toHaveBeenCalledOnce()
  })

  // 実行中フラグは取り直しの後で下ろす(下ろしてから取り直すと、古い表示のまま押せてしまう。パターン 73)
  it('取り直しが終わるまで isInitializing は true のまま', async () => {
    mockInitRepository.mockResolvedValue(undefined)
    const { result, refreshGitStatus } = setup(notRepo)
    let resolveRefresh: () => void = () => {}
    refreshGitStatus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        })
    )
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.initRepository('main')
    })
    await waitFor(() => expect(refreshGitStatus).toHaveBeenCalled())
    expect(result.current.isInitializing).toBe(true)
    await act(async () => {
      resolveRefresh()
      await promise
    })
    expect(result.current.isInitializing).toBe(false)
  })

  // 履歴の取り直しが先に失敗しても、ステータスの取り直しを待ってから実行中フラグを下ろす。Promise.all では
  // 先に失敗した時点で下ろしてしまい、Git 管理外の表示のまま「リポジトリを初期化」を押せる(パターン 73)
  it('履歴の取り直しが即失敗しても、ステータスの取り直しが終わるまで isInitializing は true のまま', async () => {
    mockInitRepository.mockResolvedValue(undefined)
    const { result, refreshGitStatus, refreshHistory } = setup(notRepo)
    let resolveStatus: () => void = () => {}
    refreshGitStatus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveStatus = resolve
        })
    )
    refreshHistory.mockRejectedValueOnce(new Error('履歴の取得に失敗'))
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.initRepository('main')
    })
    await waitFor(() => expect(refreshHistory).toHaveBeenCalled())
    // 履歴の失敗が処理されるまで待つ(Promise.all なら、ここで実行中フラグが下りる)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.current.isInitializing).toBe(true)
    let second = true
    await act(async () => {
      second = await result.current.initRepository('main')
    })
    expect(second).toBe(false)
    expect(mockInitRepository).toHaveBeenCalledOnce()
    let succeeded = false
    await act(async () => {
      resolveStatus()
      succeeded = await promise
    })
    expect(succeeded).toBe(true)
    expect(result.current.isInitializing).toBe(false)
  })

  // 取り直しの失敗で、成功した初期化を失敗にしない(パターン 52)
  it.each([
    ['ステータス', 'status'],
    ['履歴', 'history']
  ] as const)(
    '%sの取り直しが失敗しても、成功として true を返しエラーを出さない',
    async (_label, which) => {
      mockInitRepository.mockResolvedValue(undefined)
      const { result, refreshGitStatus, refreshHistory } = setup(notRepo)
      ;(which === 'status' ? refreshGitStatus : refreshHistory).mockRejectedValueOnce(
        new Error('取り直しに失敗')
      )
      let succeeded = false
      await act(async () => {
        succeeded = await result.current.initRepository('main')
      })
      expect(succeeded).toBe(true)
      expect(result.current.initError).toBeNull()
      expect(result.current.isInitializing).toBe(false)
    }
  )

  it('実行中の二重呼び出しは 1 回だけ実行し、2 回目は false', async () => {
    const pending = hold(mockInitRepository)
    const { result } = setup(notRepo)
    let first: Promise<boolean> = Promise.resolve(false)
    let second = true
    act(() => {
      first = result.current.initRepository('main')
    })
    await act(async () => {
      second = await result.current.initRepository('main')
    })
    expect(second).toBe(false)
    await act(async () => {
      pending.resolve()
      await first
    })
    expect(mockInitRepository).toHaveBeenCalledOnce()
  })

  it('他の Git 操作がロック中なら実行せず false を返し、表示中のエラーは消さない', async () => {
    mockInitRepository.mockRejectedValueOnce(new Error('前回の失敗'))
    let locked = false
    const lock = makeFileLock({ isAnyLocked: vi.fn(() => locked) })
    const { result } = setup(notRepo, lock)
    await act(async () => {
      await result.current.initRepository('a..b')
    })
    locked = true
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.initRepository('main')
    })
    expect(succeeded).toBe(false)
    expect(mockInitRepository).toHaveBeenCalledOnce()
    expect(result.current.initError?.message).toBe('前回の失敗')
  })

  // 再試行の実行中に前回の alert が残ると、実行中の案内と重なり、同じ文言の失敗が読み上げられない(パターン 87)
  it('再試行の開始時に前回のエラーを消す', async () => {
    mockInitRepository.mockRejectedValueOnce(new Error('前回の失敗'))
    const { result } = setup(notRepo)
    await act(async () => {
      await result.current.initRepository('a..b')
    })
    const pending = hold(mockInitRepository)
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.initRepository('main')
    })
    expect(result.current.isInitializing).toBe(true)
    expect(result.current.initError).toBeNull()
    await act(async () => {
      pending.resolve()
      await promise
    })
  })

  it('clearInitError でエラーを消す', async () => {
    mockInitRepository.mockRejectedValueOnce(new Error('前回の失敗'))
    const { result } = setup(notRepo)
    await act(async () => {
      await result.current.initRepository('a..b')
    })
    act(() => result.current.clearInitError())
    expect(result.current.initError).toBeNull()
  })
})

describe('addOrigin', () => {
  it('gitApi.addOrigin を呼び、ステータスだけを取り直して true を返す', async () => {
    mockAddOrigin.mockResolvedValue(undefined)
    const { result, refreshGitStatus, refreshHistory } = setup(repoWithoutOrigin)
    let succeeded = false
    await act(async () => {
      succeeded = await result.current.addOrigin('https://github.com/a/b.git')
    })
    expect(succeeded).toBe(true)
    expect(mockAddOrigin).toHaveBeenCalledWith('https://github.com/a/b.git')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).not.toHaveBeenCalled()
    expect(result.current.isAddingOrigin).toBe(false)
  })

  // 実行中フラグは取り直しの後で下ろす(パターン 73)
  it('ステータスの取り直しが終わるまで isAddingOrigin は true のまま', async () => {
    mockAddOrigin.mockResolvedValue(undefined)
    const { result, refreshGitStatus } = setup(repoWithoutOrigin)
    let resolveStatus: () => void = () => {}
    refreshGitStatus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveStatus = resolve
        })
    )
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.addOrigin('https://github.com/a/b.git')
    })
    await waitFor(() => expect(refreshGitStatus).toHaveBeenCalled())
    expect(result.current.isAddingOrigin).toBe(true)
    let second = true
    await act(async () => {
      second = await result.current.addOrigin('https://github.com/a/b.git')
    })
    expect(second).toBe(false)
    expect(mockAddOrigin).toHaveBeenCalledOnce()
    await act(async () => {
      resolveStatus()
      await promise
    })
    expect(result.current.isAddingOrigin).toBe(false)
  })

  // 取り直しの失敗で、成功した追加を失敗にしない(パターン 52)
  it('ステータスの取り直しが失敗しても、成功として true を返しエラーを出さない', async () => {
    mockAddOrigin.mockResolvedValue(undefined)
    const { result, refreshGitStatus } = setup(repoWithoutOrigin)
    refreshGitStatus.mockRejectedValueOnce(new Error('取り直しに失敗'))
    let succeeded = false
    await act(async () => {
      succeeded = await result.current.addOrigin('https://github.com/a/b.git')
    })
    expect(succeeded).toBe(true)
    expect(result.current.addOriginError).toBeNull()
    expect(result.current.isAddingOrigin).toBe(false)
  })

  it('失敗は addOriginError に入れて false を返す', async () => {
    mockAddOrigin.mockRejectedValue(new Error('リモート origin は既に設定されています'))
    const { result } = setup(repoWithoutOrigin)
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.addOrigin('https://github.com/a/b.git')
    })
    expect(succeeded).toBe(false)
    expect(result.current.addOriginError?.message).toBe('リモート origin は既に設定されています')
  })

  it('実行中は isAddingOrigin が true で、再試行の開始時に前回のエラーを消す', async () => {
    mockAddOrigin.mockRejectedValueOnce(new Error('前回の失敗'))
    const { result } = setup(repoWithoutOrigin)
    await act(async () => {
      await result.current.addOrigin('x')
    })
    const pending = hold(mockAddOrigin)
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.addOrigin('https://github.com/a/b.git')
    })
    expect(result.current.isAddingOrigin).toBe(true)
    expect(result.current.addOriginError).toBeNull()
    await act(async () => {
      pending.resolve()
      await promise
    })
    expect(result.current.isAddingOrigin).toBe(false)
  })

  it.each([
    ['gitStatus が null', null, false],
    ['リポジトリでない', notRepo, false],
    ['ロック中', repoWithoutOrigin, true]
  ] as Array<[string, GitStatusResult | null, boolean]>)(
    '%s なら実行せず false を返す',
    async (_label, status, locked) => {
      const { result } = setup(status, makeFileLock({ isAnyLocked: vi.fn(() => locked) }))
      let succeeded = true
      await act(async () => {
        succeeded = await result.current.addOrigin('https://github.com/a/b.git')
      })
      expect(succeeded).toBe(false)
      expect(mockAddOrigin).not.toHaveBeenCalled()
    }
  )

  it('実行中の二重呼び出しは 1 回だけ実行し、2 回目は false', async () => {
    const pending = hold(mockAddOrigin)
    const { result } = setup(repoWithoutOrigin)
    let first: Promise<boolean> = Promise.resolve(false)
    let second = true
    act(() => {
      first = result.current.addOrigin('https://github.com/a/b.git')
    })
    await act(async () => {
      second = await result.current.addOrigin('https://github.com/a/b.git')
    })
    expect(second).toBe(false)
    await act(async () => {
      pending.resolve()
      await first
    })
    expect(mockAddOrigin).toHaveBeenCalledOnce()
  })

  it('clearAddOriginError でエラーを消す', async () => {
    mockAddOrigin.mockRejectedValueOnce(new Error('前回の失敗'))
    const { result } = setup(repoWithoutOrigin)
    await act(async () => {
      await result.current.addOrigin('x')
    })
    act(() => result.current.clearAddOriginError())
    expect(result.current.addOriginError).toBeNull()
  })
})
```

`src/renderer/src/hooks/__tests__/useGitRemoteOperations.test.ts`:

- import を `import { renderHook, act, waitFor } from '@testing-library/react'` にする
- `const mockFetchRemote = vi.mocked(gitApi.fetchRemote)` の次に `const mockPushSetUpstream = vi.mocked(gitApi.pushSetUpstream)` を足す
- ファイル末尾に追加:

```ts
describe('pushSetUpstream(初回 push)', () => {
  const makeRefreshes = (): {
    refreshGitStatus: ReturnType<typeof vi.fn<() => Promise<void>>>
    refreshHistory: ReturnType<typeof vi.fn<() => Promise<void>>>
  } => ({
    refreshGitStatus: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    refreshHistory: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  })

  // 保留させ、解決・失敗を後から起こせるようにする
  const holdSetUpstream = (): { resolve: () => void; reject: (err: Error) => void } => {
    const handlers: { resolve: () => void; reject: (err: Error) => void } = {
      resolve: () => {},
      reject: () => {}
    }
    mockPushSetUpstream.mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          handlers.resolve = () => resolve()
          handlers.reject = reject
        })
    )
    return { resolve: () => handlers.resolve(), reject: (err) => handlers.reject(err) }
  }

  beforeEach(() => {
    mockPushSetUpstream.mockReset()
  })

  it('gitApi.pushSetUpstream を呼び、ステータスと履歴を取り直して true を返す', async () => {
    mockPushSetUpstream.mockResolvedValue(undefined)
    const { refreshGitStatus, refreshHistory } = makeRefreshes()
    const { result } = renderHook(() =>
      useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
    )
    let succeeded = false
    await act(async () => {
      succeeded = await result.current.pushSetUpstream()
    })
    expect(succeeded).toBe(true)
    expect(mockPushSetUpstream).toHaveBeenCalledOnce()
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).toHaveBeenCalledOnce()
    expect(result.current.isSettingUpstream).toBe(false)
    expect(result.current.isPushing).toBe(false)
    expect(result.current.remoteOperationError).toBeNull()
  })

  // 既存の呼び出し(refreshHistory を渡さない)は従来どおり動く(差分 3)
  it('refreshHistory を渡さなければ、ステータスだけ取り直す', async () => {
    mockPushSetUpstream.mockResolvedValue(undefined)
    const { refreshGitStatus } = makeRefreshes()
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))
    await act(async () => {
      await result.current.pushSetUpstream()
    })
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  // push と初回 push は同じ ref と branch.<b> の設定を書くため、同時に走らせない
  it('実行中は isSettingUpstream と isPushing が true で、ツールバーの push は実行されない', async () => {
    const pending = holdSetUpstream()
    mockPush.mockResolvedValue(undefined)
    const { refreshGitStatus, refreshHistory } = makeRefreshes()
    const { result } = renderHook(() =>
      useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
    )
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.pushSetUpstream()
    })
    expect(result.current.isSettingUpstream).toBe(true)
    expect(result.current.isPushing).toBe(true)
    await act(async () => {
      await result.current.push()
    })
    expect(mockPush).not.toHaveBeenCalled()
    await act(async () => {
      pending.resolve()
      await promise
    })
    expect(result.current.isSettingUpstream).toBe(false)
    expect(result.current.isPushing).toBe(false)
  })

  it('ツールバーの push の実行中は実行せず false を返し、isSettingUpstream は立たない', async () => {
    let resolvePush: () => void = () => {}
    mockPush.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePush = resolve
        })
    )
    const { refreshGitStatus } = makeRefreshes()
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))
    let pushPromise: Promise<void> = Promise.resolve()
    act(() => {
      pushPromise = result.current.push()
    })
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.pushSetUpstream()
    })
    expect(succeeded).toBe(false)
    expect(mockPushSetUpstream).not.toHaveBeenCalled()
    expect(result.current.isSettingUpstream).toBe(false)
    await act(async () => {
      resolvePush()
      await pushPromise
    })
  })

  // 実行中フラグは取り直しの後で下ろす(パターン 73)
  it('取り直しが終わるまで isSettingUpstream は true のまま', async () => {
    mockPushSetUpstream.mockResolvedValue(undefined)
    const { refreshGitStatus, refreshHistory } = makeRefreshes()
    let resolveRefresh: () => void = () => {}
    refreshHistory.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        })
    )
    const { result } = renderHook(() =>
      useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
    )
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.pushSetUpstream()
    })
    await waitFor(() => expect(refreshHistory).toHaveBeenCalled())
    expect(result.current.isSettingUpstream).toBe(true)
    await act(async () => {
      resolveRefresh()
      await promise
    })
    expect(result.current.isSettingUpstream).toBe(false)
  })

  // 履歴の取り直しが先に失敗しても、ステータスの取り直しを待ってから実行中フラグを下ろす。Promise.all では
  // 先に失敗した時点で下ろしてしまい、upstream 未設定の古い表示のまま初回 push を押せる(パターン 73)
  it('履歴の取り直しが即失敗しても、ステータスの取り直しが終わるまで isSettingUpstream は true のまま', async () => {
    mockPushSetUpstream.mockResolvedValue(undefined)
    const { refreshGitStatus, refreshHistory } = makeRefreshes()
    let resolveStatus: () => void = () => {}
    refreshGitStatus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveStatus = resolve
        })
    )
    refreshHistory.mockRejectedValueOnce(new Error('履歴の取得に失敗'))
    const { result } = renderHook(() =>
      useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
    )
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.pushSetUpstream()
    })
    await waitFor(() => expect(refreshHistory).toHaveBeenCalled())
    // 履歴の失敗が処理されるまで待つ(Promise.all なら、ここで実行中フラグが下りる)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.current.isSettingUpstream).toBe(true)
    expect(result.current.isPushing).toBe(true)
    let second = true
    await act(async () => {
      second = await result.current.pushSetUpstream()
    })
    expect(second).toBe(false)
    expect(mockPushSetUpstream).toHaveBeenCalledOnce()
    let succeeded = false
    await act(async () => {
      resolveStatus()
      succeeded = await promise
    })
    expect(succeeded).toBe(true)
    expect(result.current.isSettingUpstream).toBe(false)
  })

  // 取り直しの失敗で、成功した初回 push を失敗にしない(パターン 52)
  it.each([
    ['ステータス', 'status'],
    ['履歴', 'history']
  ] as const)(
    '%sの取り直しが失敗しても、成功として true を返しエラーを出さない',
    async (_label, which) => {
      mockPushSetUpstream.mockResolvedValue(undefined)
      const { refreshGitStatus, refreshHistory } = makeRefreshes()
      ;(which === 'status' ? refreshGitStatus : refreshHistory).mockRejectedValueOnce(
        new Error('取り直しに失敗')
      )
      const { result } = renderHook(() =>
        useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
      )
      let succeeded = false
      await act(async () => {
        succeeded = await result.current.pushSetUpstream()
      })
      expect(succeeded).toBe(true)
      expect(result.current.remoteOperationError).toBeNull()
      expect(result.current.isSettingUpstream).toBe(false)
    }
  )

  it('失敗は remoteOperationError に入れて false を返し、取り直しはする', async () => {
    mockPushSetUpstream.mockRejectedValue(
      new Error('コミットが無いため、初回 push できません。先にコミットしてください')
    )
    const { refreshGitStatus, refreshHistory } = makeRefreshes()
    const { result } = renderHook(() =>
      useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
    )
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.pushSetUpstream()
    })
    expect(succeeded).toBe(false)
    expect(result.current.remoteOperationError?.message).toBe(
      'コミットが無いため、初回 push できません。先にコミットしてください'
    )
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).toHaveBeenCalledOnce()
  })

  // パネル上部の前回のエラーが、再試行の実行中に残らない(パターン 87)
  it('再試行の開始時に前回のエラーを消す', async () => {
    mockPushSetUpstream.mockRejectedValueOnce(new Error('前回の失敗'))
    const { refreshGitStatus } = makeRefreshes()
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))
    await act(async () => {
      await result.current.pushSetUpstream()
    })
    expect(result.current.remoteOperationError?.message).toBe('前回の失敗')
    const pending = holdSetUpstream()
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.pushSetUpstream()
    })
    expect(result.current.remoteOperationError).toBeNull()
    await act(async () => {
      pending.resolve()
      await promise
    })
  })

  it.each([
    ['リポジトリが無い(null)', null, false],
    ['ロック中', repoStatus, true]
  ] as Array<[string, GitStatusResult | null, boolean]>)(
    '%s なら実行せず false を返す',
    async (_label, status, locked) => {
      const { refreshGitStatus } = makeRefreshes()
      const lock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(locked) })
      const { result } = renderHook(() => useGitRemoteOperations(status, refreshGitStatus, lock))
      let succeeded = true
      await act(async () => {
        succeeded = await result.current.pushSetUpstream()
      })
      expect(succeeded).toBe(false)
      expect(mockPushSetUpstream).not.toHaveBeenCalled()
    }
  )

  it('pull の実行中は実行せず false を返す', async () => {
    let resolvePull: () => void = () => {}
    mockPull.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePull = resolve
        })
    )
    const { refreshGitStatus } = makeRefreshes()
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))
    let pullPromise: Promise<void> = Promise.resolve()
    act(() => {
      pullPromise = result.current.pull()
    })
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.pushSetUpstream()
    })
    expect(succeeded).toBe(false)
    expect(mockPushSetUpstream).not.toHaveBeenCalled()
    await act(async () => {
      resolvePull()
      await pullPromise
    })
  })
})
```

```bash
npx vitest run src/renderer/src/lib/__tests__/remoteSetupState.test.ts src/renderer/src/lib/__tests__/remoteSetupValidation.test.ts src/renderer/src/hooks/__tests__/useGitRemoteSetup.test.ts src/renderer/src/hooks/__tests__/useGitRemoteOperations.test.ts
```

Expected: FAIL（モジュール・`pushSetUpstream` が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/lib/remoteSetupState.ts`:

```ts
import type { GitStatusResult } from '@shared/types'
import { GIT_REMOTE_TIMEOUT_SECONDS } from '@shared/remoteTimeout'

// リモートの状態バナーの種類。リモートが 1 つも無い / origin はあるが現在のブランチに upstream が無い
export type RemoteSetupKind = 'no-origin' | 'no-upstream'

// 初期化・origin の追加・初回 push の成功の後に、フォーカスを移す先(次の操作のボタン)。
// 移す先の要素は data-remote-setup-focus 属性にこの値を持つ(useRemoteSetupFocus が描画の後に探す)。
// 属性に書く側(RemoteSetupBanner・SourceControlToolbar)は `satisfies RemoteSetupFocusTarget` で型と結ぶ
// (綴りの食い違いを typecheck で検出する。パターン 88)
export type RemoteSetupFocusTarget = 'add-remote' | 'set-upstream' | 'push'

// 設計書の「状態ごとの表示」の表。バナー(RemoteSetupBanner)とテストが同じ判定を使う。
// - no-origin はリモートが 1 つも無い(hasRemote が偽)ときだけ出す。origin の追加はブランチに関係しないため、
//   detached でも出す
// - origin 以外の名前のリモートだけがある(git clone -o github など。hasOrigin が偽・hasRemote が真)ときは何も出さない。
//   既存の push / pull はそのリモートと通信でき、『リモートが未設定です』は事実と違う。upstream の無いブランチでも、
//   初回 push は origin 固定で「リモート origin が未設定のため…」と拒否されるため no-upstream も出さない
// - 初回 push はブランチの上でしかできないため、detached(detached HEAD・リベース中・bisect 中)では出さない
// - upstream が設定済み(gone・ローカルのブランチを upstream にしているものを含む)なら出さない
// - コミットの有無は区別しない(init の直後も no-upstream。押すと main がコミット無しで拒否する)。
//   GitStatusResult はコミットの有無を持たないため、コミットが無くても branch.<b>.remote / merge が設定済みなら
//   upstream に origin/<b> が入り(git status の「No commits yet on main...origin/main [gone]」)、バナーは出さない。
//   この状態で初回 push を押すと、main は設計書の順(4. コミットの有無 → 5. upstream の有無)に確かめるため、未コミットの間は
//   「コミットが無いため…」、コミットの後は「upstream は既に設定されています」で拒否される。どちらでも出さない方が正しい
// - マージ中かどうかは見ない(マージのバナーと両方出す。初回 push・追加は作業ツリー・index を変えない)
export function getRemoteSetupState(gitStatus: GitStatusResult | null): RemoteSetupKind | null {
  if (gitStatus === null || !gitStatus.isRepo) return null
  if (!gitStatus.hasRemote) return 'no-origin'
  if (!gitStatus.hasOrigin) return null
  if (gitStatus.detached || gitStatus.branch === null) return null
  return gitStatus.upstream === null ? 'no-upstream' : null
}

export function buildRemoteSetupBannerText(kind: RemoteSetupKind, branch: string | null): string {
  return kind === 'no-origin' ? 'リモートが未設定です' : `upstream が未設定です（${branch ?? ''}）`
}

// 初回 push 中の案内。秒数は main の打ち切り(GIT_REMOTE_TIMEOUT_MS)と同じ定数から組み立てる(パターン 87・88)
export const SETTING_UPSTREAM_NOTICE = `初回 push 中です。応答が ${GIT_REMOTE_TIMEOUT_SECONDS} 秒途絶えると打ち切ります`
```

`src/renderer/src/lib/remoteSetupValidation.ts`:

```ts
import { normalizeInitialBranchName } from '@shared/branchName'
import {
  MAX_REMOTE_URL_LENGTH,
  getRemoteUrlRuleViolation,
  normalizeRemoteUrl
} from '@shared/remoteUrl'
import type { RemoteUrlRuleViolation } from '@shared/remoteUrl'
import { validateBranchName } from './branchNameValidation'

// リポジトリの初期化・リモートの追加のダイアログの検証(UX 用。セキュリティ境界は main 側)。
// 規則と順序は main と共有の @shared/branchName・@shared/remoteUrl を使い、URL の文言はここの表で持つ
// (ブランチ名の文言は branchNameValidation の表を使う。パターン 88)。
// 値は main の入口と同じ正規化を通してから検証する(パターン 83)

// 規則違反の文言はブランチの作成ダイアログ(branchNameValidation)の表を使う(同じ層に同じ表を 2 つ持たない。
// パターン 88)。既存のブランチの一覧を空で渡すため、重複・階層の衝突の判定は働かず、規則違反の文言だけが返る。
// git の規則(HEAD・`..`・末尾の .lock 等)は main の check-ref-format に委ねる
export function validateInitialBranchName(name: string): string | null {
  return validateBranchName(normalizeInitialBranchName(name), [])
}

// main(gitRemoteSetupService の REMOTE_URL_RULE_MESSAGES)と同じ文言。文脈(ダイアログ内)は同じだが、
// 層ごとに表を持つ(タグ・ブランチの検証と同じ作り)
const REMOTE_URL_RULE_VIOLATION_MESSAGES: Record<RemoteUrlRuleViolation, string> = {
  empty: 'URL を入力してください',
  'too-long': `URL が長すぎます（${MAX_REMOTE_URL_LENGTH} 文字まで）`,
  'invalid-char': 'URL に空白・改行・制御文字・引用符（\' " `）は使用できません',
  'leading-dash': '`-` で始まる URL は使用できません',
  unsupported:
    '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
}

// renderer は platform を知らないため、Windows のドライブの形は寛容側(windowsPaths: true)で通し、
// 最終判断は main が行う
export function validateRemoteUrl(url: string): string | null {
  const violation = getRemoteUrlRuleViolation(normalizeRemoteUrl(url), { windowsPaths: true })
  return violation === null ? null : REMOTE_URL_RULE_VIOLATION_MESSAGES[violation]
}
```

`src/renderer/src/hooks/useGitRemoteSetup.ts`:

```ts
import { useRef, useState } from 'react'
import type { GitStatusResult } from '@shared/types'
import * as gitApi from '../lib/gitApi'
import { isGitOperationDisabled } from '../lib/gitUtils'
import type { RemoteSetupPanelState } from '../types'
import { useFileOperationLock } from './useFileOperationLock'
import type { FileOperationLock } from './useFileOperationLock'
import { useRunExclusiveGitOperation } from './useRunExclusiveGitOperation'

// 初期化・origin の追加の状態と操作(初回 push の 5 項目は useGitRemoteOperations が持ち、useAppState で合成する)
export type GitRemoteSetupState = Omit<
  RemoteSetupPanelState,
  'isSettingUpstream' | 'isPushing' | 'isPushBlocked' | 'remoteOperationError' | 'pushSetUpstream'
>

// リポジトリの初期化と origin の追加。useGitTagOperations と同じ作り: 操作ごとの実行中フラグ(ref)で二重実行を防ぎ、
// 他の Git 操作がロックを持っている間(lock.isAnyLocked())は実行しない。どちらも作業ツリー・index・HEAD を変えないため
// lockGlobal は取らない(設計書の排他の表)。初期化は Git 管理外の間だけ呼ばれ、他の Git 操作は disabled のため
// 競合しない。追加は .git/config に 1 節足すだけで、origin が無い間は push / pull が通信できないため競合しない。
// 再取得は成功・失敗のどちらでも行い、実行中フラグは再取得の後で解除する(useRunExclusiveGitOperation。パターン 73)。
// 開始時(onStart。実行しない no-op では呼ばれない)に前回のエラーを消す(パターン 87)。
// 成功の後のフォーカスの要求は UI の振る舞いのため、ここでは持たない(SourceControlPanel の useRemoteSetupFocus)
export function useGitRemoteSetup(
  gitStatus: GitStatusResult | null,
  refreshGitStatus: () => Promise<void>,
  refreshHistory: () => Promise<void>,
  fileLock?: FileOperationLock
): GitRemoteSetupState {
  const [isInitializing, setIsInitializing] = useState(false)
  const isInitializingRef = useRef(false)
  const [initError, setInitError] = useState<Error | null>(null)
  const [isAddingOrigin, setIsAddingOrigin] = useState(false)
  const isAddingOriginRef = useRef(false)
  const [addOriginError, setAddOriginError] = useState<Error | null>(null)
  const localFileLock = useFileOperationLock()
  const lock = fileLock ?? localFileLock
  const isRepoMissing = isGitOperationDisabled(gitStatus)

  // 初期化の後は、Git 管理外の表示からリポジトリの表示へ切り替えるためにステータスを、空の履歴(ブランチ)を出すために
  // 履歴を取り直す。ファイルツリーは取り直さない(.git は走査から除外され、見た目は変わらない)。
  // 両方の完了を待つ(allSettled): Promise.all では履歴が先に失敗した時点で実行中フラグが下り、ステータスの
  // 取り直し前の Git 管理外の表示のまま「リポジトリを初期化」を押せてしまう(パターン 73)。失敗はどちらも
  // 呼び出し側へ伝えない。共有ランナーは取り直しの失敗を握りつぶすため、Promise.all のときもステータスの失敗は
  // 操作の結果を変えていなかった(取り直しの失敗で成功を失敗にしない。パターン 52)
  const refreshStatusAndHistory = async (): Promise<void> => {
    await Promise.allSettled([refreshGitStatus(), refreshHistory()])
  }
  const runInit = useRunExclusiveGitOperation(refreshStatusAndHistory, setInitError)
  // 追加は origin の有無(バナー)だけが変わるため、ステータスだけ取り直す
  const runAddOrigin = useRunExclusiveGitOperation(refreshGitStatus, setAddOriginError)

  const initRepository = (branch: string): Promise<boolean> =>
    runInit({
      isBusy: () => isInitializingRef.current || lock.isAnyLocked(),
      setBusy: (busy) => {
        isInitializingRef.current = busy
        setIsInitializing(busy)
      },
      onStart: () => setInitError(null),
      execute: () => gitApi.initRepository(branch)
    })

  const addOrigin = (url: string): Promise<boolean> =>
    runAddOrigin({
      isBusy: () => isAddingOriginRef.current || lock.isAnyLocked() || isRepoMissing,
      setBusy: (busy) => {
        isAddingOriginRef.current = busy
        setIsAddingOrigin(busy)
      },
      onStart: () => setAddOriginError(null),
      execute: () => gitApi.addOrigin(url)
    })

  const clearInitError = (): void => setInitError(null)
  const clearAddOriginError = (): void => setAddOriginError(null)

  return {
    isInitializing,
    initError,
    initRepository,
    clearInitError,
    isAddingOrigin,
    addOriginError,
    addOrigin,
    clearAddOriginError
  }
}
```

`src/renderer/src/hooks/useGitRemoteOperations.ts`:

- `GitRemoteOperationsState` の `remoteOperationError: Error | null` の前に追加:

```ts
/** 初回 push(pushSetUpstream)の実行中か。isPushing と同時に true になる(実行中フラグを共有する)。
 *  バナーのボタンの「push 中...」の表示に使う */
isSettingUpstream: boolean
/** upstream の無い現在のブランチを origin へ送り、upstream を設定する。戻り値は実際に実行され成功したか
 *  (成功の後にフォーカスをツールバーの「プッシュ」へ移すかの判定に使う) */
pushSetUpstream: () => Promise<boolean>
```

- 関数の引数を次にする（`fileLock` の後に省略可能な `refreshHistory`。差分 3）:

```ts
export function useGitRemoteOperations(
  gitStatus: GitStatusResult | null,
  refreshGitStatus: () => Promise<void>,
  fileLock?: FileOperationLock,
  refreshHistory?: () => Promise<void>
): GitRemoteOperationsState {
```

- `const isFetchingRef = useRef(false)` の次に `const [isSettingUpstream, setIsSettingUpstream] = useState(false)` を足す
- `push` の定義の後に追加:

```ts
// 初回 push(upstream の設定)。成功すると upstream が設定され ↑/↓ と履歴のリモートの ref が変わるため、
// ステータスと履歴を取り直す(refreshHistory を渡さない呼び出しではステータスだけ。差分 3)。
// 両方の完了を待つ(allSettled): Promise.all では履歴が先に失敗した時点で実行中フラグが下り、ステータスの
// 取り直し前の upstream 未設定の表示のまま初回 push を押せてしまう(パターン 73)。失敗はどちらも呼び出し側へ
// 伝えない(共有ランナーと同じ。取り直しの失敗で成功を失敗にしない。パターン 52)
const refreshAfterSetUpstream = async (): Promise<void> => {
  await Promise.allSettled([refreshGitStatus(), refreshHistory?.()])
}
const runSetUpstreamOperation = useRunExclusiveGitOperation(
  refreshAfterSetUpstream,
  setRemoteOperationError
)

// 開始条件と実行中フラグは push と共有する: push と初回 push は同じ ref と branch.<b> の設定を書くため
// 同時に走らせず、commit・checkout の途中に古い HEAD を送らないようロック中は待つ(push のコメントと同じ理由)。
// lockGlobal は取らない(既存の push と同じ。設計書の排他の表)。どちらの push かをバナーの表示に使うため、
// isSettingUpstream を別に持つ。開始時(onStart)にパネル上部の前回のエラーを消す(パターン 87)
const pushSetUpstream = (): Promise<boolean> =>
  runSetUpstreamOperation({
    isBusy: () =>
      isPushingRef.current ||
      isPullingRef.current ||
      lock.isAnyLocked() ||
      isRemoteOperationDisabled,
    setBusy: (busy) => {
      isPushingRef.current = busy
      setIsPushing(busy)
      setIsSettingUpstream(busy)
    },
    onStart: () => setRemoteOperationError(null),
    execute: gitApi.pushSetUpstream
  })
```

- 戻り値の `fetchRemote,` の後に `isSettingUpstream,` と `pushSetUpstream,` を足す

```bash
npx vitest run src/renderer/src/lib src/renderer/src/hooks
npm run typecheck
```

Expected: PASS

- [ ] **Step 4: ミューテーション**

1. `getRemoteSetupState` の `if (!gitStatus.hasRemote) return 'no-origin'` を detached の判定の後に移す → 「リモートが無く detached でも no-origin」（差分 26 で `hasOrigin` から変更）
2. `gitStatus.detached ||` を外す → 「origin あり・detached」
   - （差分 26）`if (!gitStatus.hasRemote) return 'no-origin'` を `hasOrigin` で判定する（新フィールドを無視する）→ origin 以外だけの 2 行と全組み合わせの 6 件、`SourceControlPanel` の結合 2 件（10 件）
   - （差分 26）`if (!gitStatus.hasOrigin) return null` を消す → 「origin 以外の名前のリモートだけ・upstream なし」・全組み合わせの「origin 以外だけ・ブランチの上・upstream なし」・`SourceControlPanel` の「upstream なし(新しいブランチ)」（3 件）
3. `SETTING_UPSTREAM_NOTICE` の秒数を `30` の直書きにする → 変異としては落ちない（値が同じ）ため、`GIT_REMOTE_TIMEOUT_MS` を一時的に `20_000` にしてテストの 1 つ目の期待が通り 2 つ目が落ちることを確かめる（共有の定数から組み立てていることの確認）
4. `validateRemoteUrl` の `{ windowsPaths: true }` を `false` にする → `C:/repos/a.git` が null でなくなる
5. `validateInitialBranchName` の `normalizeInitialBranchName` を外す → `'   '` と `'  main  '`、`validateBranchName(normalizeInitialBranchName(x), [])` との一致（`'  -x  '`・`'\t@\n'`）。ブランチ名の文言の表を remoteSetupValidation に復活させ、1 文言だけ変える → 同じ一致のテスト（同じ層の 2 つの表の食い違い。パターン 88）
6. `useGitRemoteSetup` の `refreshStatusAndHistory` から `refreshHistory()` を外す → 初期化の取り直し
7. `onStart: () => setInitError(null)` を外す → 再試行の開始時のテスト
8. `addOrigin` の `isRepoMissing` を外す → `gitStatus が null` / `リポジトリでない`
9. （単一責任のレビューで削除。フォーカスの要求は Task 8 の `useRemoteSetupFocus` へ移した）
10. `pushSetUpstream` の `setBusy` で `isPushingRef.current = busy` を外す → 「ツールバーの push は実行されない」
11. `pushSetUpstream` の `isBusy` から `isPushingRef.current ||` を外す → 「ツールバーの push の実行中は実行せず」
12. `refreshAfterSetUpstream` の `refreshHistory?.()` を外す → 「ステータスと履歴を取り直して」
13. `pushSetUpstream` の `onStart` を外す → 「再試行の開始時に前回のエラーを消す」
14. `refreshStatusAndHistory` の `Promise.allSettled` を `Promise.all` に戻す → 「履歴の取り直しが即失敗しても、ステータスの取り直しが終わるまで isInitializing は true のまま」（Task 6 のレビューで追加。パターン 73）
15. `refreshAfterSetUpstream` の `Promise.allSettled` を `Promise.all` に戻す → 「…isSettingUpstream は true のまま」
16. `runAddOrigin` の取り直しを `async () => { void refreshGitStatus() }`（待たない）にする → 「ステータスの取り直しが終わるまで isAddingOrigin は true のまま」
17. 取り直しの失敗を伝播させる（`refreshStatusAndHistory` / `refreshAfterSetUpstream` で allSettled の結果に rejected があれば throw し、`useRunExclusiveGitOperation` の取り直しの catch で `succeeded = false` にする）→ 「〜の取り直しが失敗しても、成功として true を返しエラーを出さない」の 5 件（init 2・追加 1・初回 push 2）がすべて落ちる。ランナーだけの変異では追加の 1 件だけが落ちる（init・初回 push の取り直しは allSettled のため reject しない）
18. （差分 21）`remoteSetupValidation` の表の invalid-char の文言から `・引用符（' " `）`を除く →`validateRemoteUrl` の invalid-char の 3 件（`https://h/a b`・`https://u:p'ss@h/r`・`/repos/O'Brien/b.git`）
19. （差分 25）`remoteSetupValidation` の表の unsupported の文言から `（認証は credential helper か ssh の鍵を使います）` を除く → `validateRemoteUrl` の unsupported の 8 件と、`AddRemoteDialog` の「許可されない形式の URL は理由を出して追加を disabled にする」（1 件）

- [ ] **Step 5: 検証**

```bash
npx vitest run src/renderer
npm run typecheck
npx eslint src/renderer/src/types.ts src/renderer/src/__tests__/makeRemoteSetupPanelState.ts src/renderer/src/lib/remoteSetupState.ts src/renderer/src/lib/remoteSetupValidation.ts src/renderer/src/hooks/useGitRemoteSetup.ts src/renderer/src/hooks/useGitRemoteOperations.ts src/renderer/src/lib/__tests__/remoteSetupState.test.ts src/renderer/src/lib/__tests__/remoteSetupValidation.test.ts src/renderer/src/hooks/__tests__/useGitRemoteSetup.test.ts src/renderer/src/hooks/__tests__/useGitRemoteOperations.test.ts
npx prettier --check src/renderer/src/types.ts src/renderer/src/__tests__/makeRemoteSetupPanelState.ts src/renderer/src/lib/remoteSetupState.ts src/renderer/src/lib/remoteSetupValidation.ts src/renderer/src/hooks/useGitRemoteSetup.ts src/renderer/src/hooks/useGitRemoteOperations.ts src/renderer/src/lib/__tests__/remoteSetupState.test.ts src/renderer/src/lib/__tests__/remoteSetupValidation.test.ts src/renderer/src/hooks/__tests__/useGitRemoteSetup.test.ts src/renderer/src/hooks/__tests__/useGitRemoteOperations.test.ts
```

Expected: すべて成功

- [ ] **Step 6: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 7: ダイアログ（`RemoteSetupInputDialog` / `InitRepositoryDialog` / `AddRemoteDialog`）・`NotRepositoryView`・`RemoteSetupBanner`・CSS

**Files:**

- Create: `src/renderer/src/components/source-control/RemoteSetupInputDialog.tsx`, `InitRepositoryDialog.tsx`, `AddRemoteDialog.tsx`, `NotRepositoryView.tsx`, `RemoteSetupBanner.tsx`（いずれも `src/renderer/src/components/source-control/`）
- Create（テスト）: `src/renderer/src/components/source-control/__tests__/RemoteSetupInputDialog.test.tsx`, `RemoteSetupDialogs.test.tsx`, `NotRepositoryView.test.tsx`, `RemoteSetupBanner.test.tsx`, `RemoteSetupBanner.styles.test.tsx`
- Create（単一責任のレビューで切り出し）: `src/renderer/src/hooks/useDialogFocusReturn.ts`（開閉と、閉じた後に開いたボタンへ戻すフォーカス。`NotRepositoryView`・`RemoteSetupBanner`・タグの作成の `HistorySection` で共通）、`src/renderer/src/hooks/useFocusOnRunningEnd.ts`（実行中が解けたときのフォーカスの復帰。`RemoteSetupInputDialog`・`RemoteSetupBanner`・タグの作成の `CreateTagDialog` で共通）と、それぞれのテスト `src/renderer/src/hooks/__tests__/useDialogFocusReturn.test.tsx`・`useFocusOnRunningEnd.test.tsx`
- Create（コードレビューで追加。差分 19）: `src/renderer/src/hooks/useOverlayDismiss.ts`（オーバーレイで押して離したときだけ閉じる。`RemoteSetupInputDialog`・タグの作成の `CreateTagDialog` で共通）と、テスト `src/renderer/src/hooks/__tests__/useOverlayDismiss.test.tsx`。Modify: `src/renderer/src/components/source-control/CreateTagDialog.tsx` とテスト
- Modify: `src/renderer/src/assets/main.css`

**Interfaces:**

- Consumes: Task 1 の `normalizeInitialBranchName` / `normalizeRemoteUrl`、Task 6 の `RemoteSetupPanelState` / `makeRemoteSetupPanelState` / `RemoteSetupKind` / `buildRemoteSetupBannerText` / `SETTING_UPSTREAM_NOTICE` / `validateInitialBranchName` / `validateRemoteUrl`
- Produces（Task 8 が配線する）:
  - `NotRepositoryView`（Props: `remoteSetup: RemoteSetupPanelState`、`isBlocked: boolean`、`requestFocus: (target: RemoteSetupFocusTarget) => void`）
  - `RemoteSetupBanner`（Props: `kind: RemoteSetupKind | null`、`branch: string | null`、`remoteSetup: RemoteSetupPanelState`、`isBlocked: boolean`、`requestFocus: (target: RemoteSetupFocusTarget) => void`）
  - `useDialogFocusReturn({ isRunning, onOpen?, openerRef }): { isOpen, open, close, closeWithoutReturn }`（`close` は開いたボタンへ戻す予約を立てて閉じ、`closeWithoutReturn` は閉じるだけ）、`useFocusOnRunningEnd(isRunning, targetRef, { containerRef?, enabled? }): void`、`useOverlayDismiss(onDismiss): { onMouseDown, onClick }`（オーバーレイに展開する）
  - フォーカスの移し先の印: `data-remote-setup-focus="add-remote"`（`リモートを追加`）、`data-remote-setup-focus="set-upstream"`（`初回 push（upstream を設定）`）。`push` はツールバー（Task 8）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useDialogFocusReturn.test.tsx`（3 か所に同じ形で書いていたフォーカスの処理を、単一責任のレビューで切り出した。パターン 55）:

```tsx
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { useDialogFocusReturn } from '../useDialogFocusReturn'

// 実際の DOM のフォーカスを見るため、renderHook ではなく小さな部品で使う。開くボタンは実行中に disabled になる
// (呼び出し元の 3 か所と同じ)。ダイアログの中の「閉じる」は、実行中に閉じる経路(成功)を試すため disabled にしない
function Harness({
  isRunning,
  onOpen
}: {
  isRunning: boolean
  onOpen?: () => void
}): React.JSX.Element {
  const openerRef = useRef<HTMLButtonElement>(null)
  const dialog = useDialogFocusReturn({ isRunning, onOpen, openerRef })
  return (
    <>
      <button ref={openerRef} type="button" disabled={isRunning} onClick={dialog.open}>
        開く
      </button>
      {dialog.isOpen && (
        <div role="dialog" aria-label="ダイアログ">
          <button type="button" onClick={dialog.close}>
            閉じる
          </button>
          <button type="button" onClick={dialog.closeWithoutReturn}>
            戻さずに閉じる
          </button>
        </div>
      )}
      <input aria-label="外の入力欄" />
    </>
  )
}

const opener = (): HTMLElement => screen.getByRole('button', { name: '開く' })
// ボタンへフォーカスを移さずに押す(userEvent.click はフォーカスを押したボタンへ移す。フォーカスが body のまま・
// 外へ移したままの状態を保つために使う)
const clickWithoutFocus = (name: string): void =>
  act(() => screen.getByRole('button', { name }).click())

// 開く → 閉じるときに戻す予約 → 閉じて実行中でもなくなった描画の後、body のときだけ開いたボタンへ戻す(パターン 86)
describe('useDialogFocusReturn', () => {
  it('開くと onOpen を呼んでから開く', async () => {
    const onOpen = vi.fn()
    render(<Harness isRunning={false} onOpen={onOpen} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(opener())
    expect(onOpen).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'ダイアログ' })).toBeInTheDocument()
  })

  it('閉じる(キャンセル)と、開いたボタンへフォーカスを戻す', async () => {
    render(<Harness isRunning={false} />)
    await userEvent.click(opener())
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener()).toHaveFocus()
  })

  // 成功の経路: 実行中フラグの解除が反映される前に閉じる。disabled のボタンへの focus() は無視されるため、
  // 実行中の間は戻さず(予約は残す)、解けた描画の後で戻す(パターン 73・86)
  it('実行中に閉じたら(成功の経路)、実行中の間は戻さず、解けてから戻す', () => {
    const { rerender } = render(<Harness isRunning={false} />)
    clickWithoutFocus('開く')
    rerender(<Harness isRunning={true} />)
    clickWithoutFocus('閉じる')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body).toHaveFocus()
    rerender(<Harness isRunning={false} />)
    expect(opener()).toHaveFocus()
  })

  it('利用者が別の要素へ移していたら奪わない', async () => {
    render(<Harness isRunning={false} />)
    await userEvent.click(opener())
    const outside = screen.getByRole('textbox', { name: '外の入力欄' })
    act(() => outside.focus())
    clickWithoutFocus('閉じる')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(outside).toHaveFocus()
  })

  // 成功の後に次の操作のボタンへ移す呼び出し元(初期化・リモートの追加)は、戻さずに閉じる
  it('戻さずに閉じたら、開いたボタンへ戻さない', () => {
    render(<Harness isRunning={false} />)
    clickWithoutFocus('開く')
    clickWithoutFocus('戻さずに閉じる')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body).toHaveFocus()
  })

  // 予約は部品ごとに持ち、アンマウントで消える(フォルダの切り替え等で、別の部品のボタンへ持ち越さない)
  it('予約はアンマウントで消え、次にマウントした部品で戻さない', () => {
    const { rerender, unmount } = render(<Harness isRunning={false} />)
    clickWithoutFocus('開く')
    rerender(<Harness isRunning={true} />)
    clickWithoutFocus('閉じる')
    unmount()
    render(<Harness isRunning={false} />)
    expect(document.body).toHaveFocus()
  })
})
```

`src/renderer/src/hooks/__tests__/useFocusOnRunningEnd.test.tsx`（3 か所に同じ形で書いていたフォーカスの処理を、単一責任のレビューで切り出した。パターン 55）:

```tsx
import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, it, expect } from 'vitest'
import { useFocusOnRunningEnd } from '../useFocusOnRunningEnd'

// 実際の DOM のフォーカスを見るため、renderHook ではなく小さな部品で使う
function Harness({
  isRunning,
  enabled,
  withContainer = false
}: {
  isRunning: boolean
  enabled?: boolean
  withContainer?: boolean
}): React.JSX.Element {
  const targetRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLFormElement>(null)
  useFocusOnRunningEnd(isRunning, targetRef, {
    containerRef: withContainer ? containerRef : undefined,
    enabled
  })
  return (
    <>
      <form ref={containerRef}>
        <input ref={targetRef} aria-label="対象" />
        <button type="button">中のボタン</button>
      </form>
      <input aria-label="外の入力欄" />
    </>
  )
}

const target = (): HTMLElement => screen.getByRole('textbox', { name: '対象' })

// 実行中に disabled になった要素から body に落ちたフォーカスを、実行中が解けたときに対象へ戻す(パターン 86)
describe('useFocusOnRunningEnd', () => {
  it('実行中が true→false になったとき、フォーカスが body なら対象へ戻す', () => {
    const { rerender } = render(<Harness isRunning={true} />)
    expect(document.body).toHaveFocus()
    rerender(<Harness isRunning={false} />)
    expect(target()).toHaveFocus()
  })

  it('外の要素にあるフォーカスは奪わない', () => {
    const { rerender } = render(<Harness isRunning={true} withContainer />)
    const outside = screen.getByRole('textbox', { name: '外の入力欄' })
    act(() => outside.focus())
    rerender(<Harness isRunning={false} withContainer />)
    expect(outside).toHaveFocus()
  })

  it('containerRef の中にあるフォーカスも対象へ戻す', () => {
    const { rerender } = render(<Harness isRunning={true} withContainer />)
    act(() => screen.getByRole('button', { name: '中のボタン' }).focus())
    rerender(<Harness isRunning={false} withContainer />)
    expect(target()).toHaveFocus()
  })

  it('enabled が false なら戻さない', () => {
    const { rerender } = render(<Harness isRunning={true} enabled={false} />)
    rerender(<Harness isRunning={false} enabled={false} />)
    expect(document.body).toHaveFocus()
  })

  it('false→true や、実行中を経ていない描画(初回のマウント・false のままの再描画)では何もしない', () => {
    const { rerender } = render(<Harness isRunning={false} />)
    expect(document.body).toHaveFocus()
    rerender(<Harness isRunning={false} />)
    expect(document.body).toHaveFocus()
    rerender(<Harness isRunning={true} />)
    expect(document.body).toHaveFocus()
  })

  // 直前の実行中の状態は部品ごとに持ち、アンマウントで消える(次にマウントした部品へ持ち越さない)
  it('アンマウントした部品の実行中の状態で、次にマウントした部品が戻さない', () => {
    const { unmount } = render(<Harness isRunning={true} />)
    unmount()
    render(<Harness isRunning={false} />)
    expect(document.body).toHaveFocus()
  })
})
```

`src/renderer/src/hooks/__tests__/useOverlayDismiss.test.tsx`（コードレビューで追加。差分 19。逆向きのドラッグと記録の持ち越しは差分 20）:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useOverlayDismiss } from '../useOverlayDismiss'

// 実際の DOM のイベントの経路(target と currentTarget)を見るため、renderHook ではなく小さな部品で使う。
// ダイアログの中のクリックはダイアログ側の stopPropagation で止まるが、中で押してオーバーレイで離したときの click は
// Chromium が共通の祖先(オーバーレイ)へ送るため、その経路はダイアログを通らない
function Harness({
  onDismiss,
  stopInside = true
}: {
  onDismiss: () => void
  stopInside?: boolean
}): React.JSX.Element {
  const overlayHandlers = useOverlayDismiss(onDismiss)
  return (
    <div data-testid="overlay" role="presentation" {...overlayHandlers}>
      <form
        role="dialog"
        aria-label="ダイアログ"
        onClick={stopInside ? (e) => e.stopPropagation() : undefined}
      >
        <input aria-label="入力欄" />
      </form>
    </div>
  )
}

describe('useOverlayDismiss', () => {
  it('オーバーレイで押して離すと onDismiss を呼ぶ', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} />)
    fireEvent.mouseDown(screen.getByTestId('overlay'))
    fireEvent.mouseUp(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  // オーバーレイで押してダイアログの中(入力欄)で離すと、Chromium は共通の祖先(オーバーレイ)へ click を送る
  // (Electron の sendInputEvent で確認: 記録は down:overlay → click:overlay)。jsdom は click の target を
  // 自動で決めないため、mouseUp は入力欄、click はオーバーレイに手動で送る
  it('オーバーレイで押してダイアログの中で離しても onDismiss を呼ばない', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} />)
    fireEvent.mouseDown(screen.getByTestId('overlay'))
    fireEvent.mouseUp(screen.getByRole('textbox', { name: '入力欄' }))
    fireEvent.click(screen.getByTestId('overlay'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  // 離した位置の記録は click ごとにリセットする。前回の「オーバーレイで離した」を次の click に持ち越さない
  it('離した位置の記録は次の click に持ち越さない', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} />)
    // 1 回目: オーバーレイで押して離す(閉じる)
    fireEvent.mouseDown(screen.getByTestId('overlay'))
    fireEvent.mouseUp(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    // 2 回目: オーバーレイで押し、mouseup がオーバーレイに届かない(中で離した)まま click だけが届く
    fireEvent.mouseDown(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  // 押下と離した位置の両方の記録を click の後で捨てる。押下の無い click(スクリプトからの click など)を、
  // 前回の操作の記録で閉じる判定にしない
  it('押下と離した位置の記録は click の後で捨て、押下の無い click では閉じない', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} />)
    fireEvent.mouseDown(screen.getByTestId('overlay'))
    fireEvent.mouseUp(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  // 長い URL のドラッグ選択など: mousedown は入力欄、mouseup と click はオーバーレイ
  it('ダイアログの中で押してオーバーレイで離しても onDismiss を呼ばない', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} />)
    fireEvent.mouseDown(screen.getByRole('textbox', { name: '入力欄' }))
    fireEvent.mouseUp(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('押下の記録は次の押下で上書きされる(中で押した後でも、オーバーレイで押し直せば閉じる)', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} />)
    fireEvent.mouseDown(screen.getByRole('textbox', { name: '入力欄' }))
    fireEvent.mouseUp(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    fireEvent.mouseDown(screen.getByTestId('overlay'))
    fireEvent.mouseUp(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByTestId('overlay'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  // 中の click を止めない部品でも、子を target にした click では閉じない(押下の判定だけに頼らない)
  it('オーバーレイで押しても、click の target が子なら onDismiss を呼ばない', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} stopInside={false} />)
    fireEvent.mouseDown(screen.getByTestId('overlay'))
    fireEvent.click(screen.getByRole('textbox', { name: '入力欄' }))
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
```

`src/renderer/src/components/source-control/__tests__/RemoteSetupInputDialog.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import RemoteSetupInputDialog from '../RemoteSetupInputDialog'

type Props = ComponentProps<typeof RemoteSetupInputDialog>

const renderDialog = (
  overrides: Partial<Props> = {}
): Props & { container: HTMLElement; rerenderWith: (next: Partial<Props>) => void } => {
  const props: Props = {
    title: 'ダイアログ',
    description: '説明',
    label: '値',
    initialValue: 'main',
    submitLabel: '実行',
    runningSubmitLabel: '実行中...',
    runningNotice: '実行中です',
    normalize: (value) => value.trim(),
    validate: (value) => (value === '' ? '値を入力してください' : null),
    isRunning: false,
    isBlocked: false,
    error: null,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides
  }
  const { container, rerender } = render(<RemoteSetupInputDialog {...props} />)
  const rerenderWith = (next: Partial<Props>): void =>
    rerender(<RemoteSetupInputDialog {...props} {...next} />)
  return { ...props, container, rerenderWith }
}
const input = (): HTMLInputElement => screen.getByRole('textbox', { name: '値' })
const submitButton = (): HTMLElement => screen.getByRole('button', { name: '実行' })

// 初期化・リモートの追加のダイアログの共通部分(タグの作成のダイアログと同じ扱い。パターン 85・86・87)
describe('RemoteSetupInputDialog', () => {
  it('開くと見出し・説明があり、入力欄にフォーカスがあって初期値が全選択されている', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'ダイアログ' })).toHaveAccessibleDescription('説明')
    expect(input()).toHaveFocus()
    expect(input()).toHaveValue('main')
    expect(input().selectionStart).toBe(0)
    expect(input().selectionEnd).toBe(4)
  })

  it('検証エラーは入力欄の説明として表示し、実行ボタンを disabled にする', async () => {
    renderDialog()
    await userEvent.clear(input())
    expect(input()).toHaveAccessibleDescription('値を入力してください')
    expect(input()).toHaveAttribute('aria-invalid', 'true')
    expect(submitButton()).toBeDisabled()
  })

  it('正規化した値で onSubmit を呼ぶ(Enter でも送る)', async () => {
    const props = renderDialog()
    await userEvent.clear(input())
    await userEvent.type(input(), '  feat  {Enter}')
    expect(props.onSubmit).toHaveBeenCalledWith('feat')
  })

  it('他の操作中(isBlocked)は実行ボタンが disabled で、Enter でも送らない', async () => {
    const props = renderDialog({ isBlocked: true })
    expect(submitButton()).toBeDisabled()
    await userEvent.type(input(), '{Enter}')
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  describe('実行中', () => {
    it('ボタンは実行中の文言で disabled、入力とキャンセルも disabled、案内(status)と aria-busy を出す', () => {
      renderDialog({ isRunning: true })
      expect(screen.getByRole('button', { name: '実行中...' })).toBeDisabled()
      expect(input()).toBeDisabled()
      expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled()
      expect(screen.getByRole('status')).toHaveTextContent('実行中です')
      expect(screen.getByRole('dialog', { name: 'ダイアログ' })).toHaveAttribute(
        'aria-busy',
        'true'
      )
    })

    // 失敗の直後(取り直しの間は isRunning が true のままエラーが入る)に、案内と alert を重ねない(パターン 87)
    it('エラーがあれば、実行中でも案内と aria-busy を出さず alert だけ出す', () => {
      renderDialog({ isRunning: true, error: new Error('失敗しました') })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('失敗しました')
      expect(screen.getByRole('dialog', { name: 'ダイアログ' })).not.toHaveAttribute(
        'aria-busy',
        'true'
      )
    })

    // 閉じると、遅れて届いた失敗の行き先が無くなる(パターン 85)
    it('キャンセル・Escape・オーバーレイのクリックで閉じない', async () => {
      const props = renderDialog({ isRunning: true })
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      fireEvent.keyDown(input(), { key: 'Escape', isComposing: false })
      await userEvent.click(props.container.querySelector('.name-input-dialog__overlay')!)
      expect(props.onCancel).not.toHaveBeenCalled()
    })

    it.each([
      ['実行中(isRunning)', { isRunning: true }],
      ['他の操作中(isBlocked)', { isBlocked: true }]
    ] as Array<[string, Partial<Props>]>)(
      '%sは、submit イベントが直接来ても onSubmit を呼ばない',
      (_label, overrides) => {
        const props = renderDialog(overrides)
        fireEvent.submit(screen.getByRole('dialog', { name: 'ダイアログ' }))
        expect(props.onSubmit).not.toHaveBeenCalled()
      }
    )
  })

  it('失敗は role="alert" で表示する', () => {
    renderDialog({ error: new Error('リモート origin は既に設定されています') })
    expect(screen.getByRole('alert')).toHaveTextContent('リモート origin は既に設定されています')
  })

  it('キャンセル・Escape・オーバーレイのクリックで onCancel を呼び、ダイアログの中のクリックでは呼ばない', async () => {
    const props = renderDialog()
    await userEvent.click(screen.getByRole('dialog', { name: 'ダイアログ' }))
    expect(props.onCancel).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(props.container.querySelector('.name-input-dialog__overlay')!)
    expect(props.onCancel).toHaveBeenCalledTimes(3)
  })

  // 長い URL のドラッグ選択など: 入力欄で押してオーバーレイで離すと、Chromium は共通の祖先(オーバーレイ)へ click を
  // 送る。フォームの stopPropagation はこの経路に入らないため、押したのもオーバーレイのときだけ閉じる
  it('入力欄で押してオーバーレイで離しても onCancel を呼ばず、入力が残る', () => {
    const props = renderDialog()
    const overlay = props.container.querySelector('.name-input-dialog__overlay')!
    fireEvent.change(input(), { target: { value: 'https://example.com/long/url.git' } })
    fireEvent.mouseDown(input())
    fireEvent.mouseUp(overlay)
    fireEvent.click(overlay)
    expect(props.onCancel).not.toHaveBeenCalled()
    expect(input()).toHaveValue('https://example.com/long/url.git')
  })

  // 逆向き: オーバーレイで押して入力欄で離しても、click は共通の祖先(オーバーレイ)へ届く。離したのも
  // オーバーレイのときだけ閉じる(jsdom は click の target を決めないため、click はオーバーレイに送る)
  it('オーバーレイで押して入力欄で離しても onCancel を呼ばず、入力が残る', () => {
    const props = renderDialog()
    const overlay = props.container.querySelector('.name-input-dialog__overlay')!
    fireEvent.change(input(), { target: { value: 'https://example.com/long/url.git' } })
    fireEvent.mouseDown(overlay)
    fireEvent.mouseUp(input())
    fireEvent.click(overlay)
    expect(props.onCancel).not.toHaveBeenCalled()
    expect(input()).toHaveValue('https://example.com/long/url.git')
  })

  it('オーバーレイで押して離すと onCancel を呼ぶ', () => {
    const props = renderDialog()
    const overlay = props.container.querySelector('.name-input-dialog__overlay')!
    fireEvent.mouseDown(overlay)
    fireEvent.mouseUp(overlay)
    fireEvent.click(overlay)
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('実行中は、オーバーレイで押して離しても onCancel を呼ばない', () => {
    const props = renderDialog({ isRunning: true })
    const overlay = props.container.querySelector('.name-input-dialog__overlay')!
    fireEvent.mouseDown(overlay)
    fireEvent.mouseUp(overlay)
    fireEvent.click(overlay)
    expect(props.onCancel).not.toHaveBeenCalled()
  })

  it('IME の変換中の Escape では onCancel を呼ばない', () => {
    const props = renderDialog()
    fireEvent.keyDown(input(), { key: 'Escape', isComposing: true })
    expect(props.onCancel).not.toHaveBeenCalled()
    fireEvent.keyDown(input(), { key: 'Escape', isComposing: false })
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  // 実行中は入力欄が disabled になり、ブラウザはフォーカスを body に落とす。失敗して実行中が解けたら、
  // Escape がフォームに届くよう入力欄へ戻す(body かダイアログ内にフォーカスがある場合だけ。パターン 86)。
  // 外のフォーカスを奪わないこと・実行中を経ていない描画で何もしないことは useFocusOnRunningEnd のテストで確かめる。
  // ここは配線(戻す先が入力欄で、ダイアログのフォームを「中」とする)だけ
  describe('実行が終わったときのフォーカス', () => {
    it('isRunning が true→false になったとき、フォーカスが body にあれば入力欄へ戻す', () => {
      const { rerenderWith } = renderDialog({ isRunning: true })
      ;(document.activeElement as HTMLElement | null)?.blur()
      expect(document.body).toHaveFocus()
      rerenderWith({ isRunning: false })
      expect(input()).toHaveFocus()
    })

    // jsdom は disabled になった要素からフォーカスを外さないため、実行中に disabled になったキャンセルに
    // フォーカスが残った状態(ダイアログ内)を作れる
    it('ダイアログ内(実行中に disabled になったキャンセル)にあるフォーカスも入力欄へ戻す', () => {
      const { rerenderWith } = renderDialog()
      act(() => screen.getByRole('button', { name: 'キャンセル' }).focus())
      rerenderWith({ isRunning: true })
      rerenderWith({ isRunning: false })
      expect(input()).toHaveFocus()
    })
  })
})
```

`src/renderer/src/components/source-control/__tests__/RemoteSetupDialogs.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import InitRepositoryDialog from '../InitRepositoryDialog'
import AddRemoteDialog from '../AddRemoteDialog'

const common = { isBlocked: false, error: null, onCancel: vi.fn() }

describe('InitRepositoryDialog', () => {
  it('見出し・説明・既定値 main のブランチ名と、初期化のボタンを出す', () => {
    render(<InitRepositoryDialog {...common} isRunning={false} onSubmit={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'リポジトリを初期化' })).toHaveAccessibleDescription(
      'このフォルダに空の Git リポジトリを作成します'
    )
    expect(screen.getByRole('textbox', { name: 'ブランチ名' })).toHaveValue('main')
    expect(screen.getByRole('button', { name: '初期化' })).toBeEnabled()
  })

  it.each([
    ['', '名前を入力してください'],
    ['-x', '`-` で始まる名前は使用できません'],
    ['@', 'この名前は使用できません']
  ])('ブランチ名 %j は %s', async (name, message) => {
    render(<InitRepositoryDialog {...common} isRunning={false} onSubmit={vi.fn()} />)
    const field = screen.getByRole('textbox', { name: 'ブランチ名' })
    await userEvent.clear(field)
    if (name !== '') await userEvent.type(field, name)
    expect(field).toHaveAccessibleDescription(message)
    expect(screen.getByRole('button', { name: '初期化' })).toBeDisabled()
  })

  // main の入口と同じ正規化(前後の空白・NFC)をした名前を送る(パターン 83)
  it('前後の空白を除き NFC にそろえた名前を送る', async () => {
    const onSubmit = vi.fn()
    render(<InitRepositoryDialog {...common} isRunning={false} onSubmit={onSubmit} />)
    const field = screen.getByRole('textbox', { name: 'ブランチ名' })
    await userEvent.clear(field)
    await userEvent.type(field, '  café  {Enter}')
    expect(onSubmit).toHaveBeenCalledWith('café')
  })

  it('実行中は「初期化中...」と案内「初期化中です」を出す', () => {
    render(<InitRepositoryDialog {...common} isRunning={true} onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: '初期化中...' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('初期化中です')
  })
})

describe('AddRemoteDialog', () => {
  it('見出し・説明・空の URL 欄と、追加のボタン(未入力の間は disabled)を出す', () => {
    render(<AddRemoteDialog {...common} isRunning={false} onSubmit={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'リモートを追加' })).toHaveAccessibleDescription(
      'リモート origin を追加します（この時点では接続しません）'
    )
    const field = screen.getByRole('textbox', { name: 'URL' })
    expect(field).toHaveValue('')
    expect(field).toHaveAccessibleDescription('URL を入力してください')
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled()
  })

  it('許可されない形式の URL は理由を出して追加を disabled にする', async () => {
    render(<AddRemoteDialog {...common} isRunning={false} onSubmit={vi.fn()} />)
    const field = screen.getByRole('textbox', { name: 'URL' })
    await userEvent.type(field, 'ext::sh')
    expect(field).toHaveAccessibleDescription(
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    )
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled()
  })

  it('前後の空白だけを除いた URL を送る', async () => {
    const onSubmit = vi.fn()
    render(<AddRemoteDialog {...common} isRunning={false} onSubmit={onSubmit} />)
    await userEvent.type(
      screen.getByRole('textbox', { name: 'URL' }),
      '  https://github.com/a/b.git  {Enter}'
    )
    expect(onSubmit).toHaveBeenCalledWith('https://github.com/a/b.git')
  })

  it('実行中は「追加中...」と案内「追加中です」を出す', () => {
    render(<AddRemoteDialog {...common} isRunning={true} onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: '追加中...' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('追加中です')
  })
})
```

`src/renderer/src/components/source-control/__tests__/NotRepositoryView.test.tsx`:

```tsx
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import NotRepositoryView from '../NotRepositoryView'
import { makeRemoteSetupPanelState } from '../../../__tests__/makeRemoteSetupPanelState'

type Props = ComponentProps<typeof NotRepositoryView>

// props に加え、同じ props を基に一部だけ変えて描き直す rerenderWith を返す
const renderView = (
  overrides: Partial<Props> = {}
): Props & { rerenderWith: (next: Partial<Props>) => void } => {
  const props: Props = {
    remoteSetup: makeRemoteSetupPanelState(),
    isBlocked: false,
    requestFocus: vi.fn<Props['requestFocus']>(),
    ...overrides
  }
  const { rerender } = render(<NotRepositoryView {...props} />)
  const rerenderWith = (next: Partial<Props>): void =>
    rerender(<NotRepositoryView {...props} {...next} />)
  return { ...props, rerenderWith }
}
const openButton = (): HTMLElement => screen.getByRole('button', { name: 'リポジトリを初期化' })

describe('NotRepositoryView', () => {
  it('「Git リポジトリではありません」と「リポジトリを初期化」ボタンを出す', () => {
    renderView()
    expect(screen.getByText('Git リポジトリではありません')).toBeInTheDocument()
    expect(openButton()).toBeEnabled()
  })

  it('初期化中だけボタンを disabled にする', () => {
    renderView({ remoteSetup: makeRemoteSetupPanelState({ isInitializing: true }) })
    expect(openButton()).toBeDisabled()
  })

  it('押すと前回のエラーを消してダイアログを開く', async () => {
    const { remoteSetup } = renderView()
    await userEvent.click(openButton())
    expect(remoteSetup.clearInitError).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'リポジトリを初期化' })).toBeInTheDocument()
  })

  // 戻す条件(実行中・body のときだけ・アンマウント)は useDialogFocusReturn のテストで確かめる。ここは配線だけ
  it('キャンセルで閉じると、ボタンへフォーカスを戻す', async () => {
    renderView()
    await userEvent.click(openButton())
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // フォーカスを戻す処理は passive な useEffect で、ダイアログが消えた後に走る。消えた直後に同期で評価せず待つ
    await waitFor(() => expect(openButton()).toHaveFocus())
  })

  // 成功するとボタンは(リポジトリの表示に切り替わって)消えるため、次の操作のボタンへフォーカスを移す要求を出す
  it('成功するとダイアログを閉じ、「リモートを追加」へのフォーカスを要求する', async () => {
    const { remoteSetup, requestFocus } = renderView()
    await userEvent.click(openButton())
    await userEvent.click(screen.getByRole('button', { name: '初期化' }))
    expect(remoteSetup.initRepository).toHaveBeenCalledWith('main')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(requestFocus).toHaveBeenCalledWith('add-remote')
  })

  // 成功しても取り直しが失敗すると(握りつぶされる)、この部品が残り、移す先(バナー)が無い。フォーカスを body に
  // 落とさず開いたボタンへ戻す。通常の経路ではこの部品ごと外れるため戻さない(RemoteSetupFlow のテストで確かめる)
  it('成功した後もこの部品が残っていれば(Git 管理外のまま)、ボタンへフォーカスを戻す', async () => {
    renderView()
    await userEvent.click(openButton())
    await userEvent.click(screen.getByRole('button', { name: '初期化' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(openButton()).toHaveFocus())
  })

  it('失敗(false)ならダイアログを閉じず、フォーカスの要求もしない', async () => {
    const remoteSetup = makeRemoteSetupPanelState()
    remoteSetup.initRepository = async () => false
    const { requestFocus } = renderView({ remoteSetup })
    await userEvent.click(openButton())
    await userEvent.click(screen.getByRole('button', { name: '初期化' }))
    expect(screen.getByRole('dialog', { name: 'リポジトリを初期化' })).toBeInTheDocument()
    expect(requestFocus).not.toHaveBeenCalled()
  })

  it('失敗は開いているダイアログ内に alert で出す', async () => {
    const { rerenderWith } = renderView()
    await userEvent.click(openButton())
    rerenderWith({
      remoteSetup: makeRemoteSetupPanelState({
        initError: new Error('ブランチ名として使用できない名前です: a..b')
      })
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'ブランチ名として使用できない名前です: a..b'
    )
  })

  it('他の Git 操作のロック中(isBlocked)は、ダイアログの「初期化」を disabled にする', async () => {
    renderView({ isBlocked: true })
    await userEvent.click(openButton())
    expect(screen.getByRole('button', { name: '初期化' })).toBeDisabled()
  })
})
```

`src/renderer/src/components/source-control/__tests__/RemoteSetupBanner.test.tsx`:

```tsx
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import RemoteSetupBanner from '../RemoteSetupBanner'
import { SETTING_UPSTREAM_NOTICE } from '../../../lib/remoteSetupState'
import { makeRemoteSetupPanelState } from '../../../__tests__/makeRemoteSetupPanelState'

type Props = ComponentProps<typeof RemoteSetupBanner>

const renderBanner = (
  overrides: Partial<Props> = {}
): Props & { container: HTMLElement; rerenderWith: (next: Partial<Props>) => void } => {
  const props: Props = {
    kind: 'no-origin',
    branch: 'main',
    remoteSetup: makeRemoteSetupPanelState(),
    isBlocked: false,
    requestFocus: vi.fn<Props['requestFocus']>(),
    ...overrides
  }
  const { container, rerender } = render(<RemoteSetupBanner {...props} />)
  const rerenderWith = (next: Partial<Props>): void =>
    rerender(<RemoteSetupBanner {...props} {...next} />)
  return { ...props, container, rerenderWith }
}
const addButton = (): HTMLElement => screen.getByRole('button', { name: 'リモートを追加' })
const setUpstreamButton = (): HTMLElement =>
  screen.getByRole('button', { name: '初回 push（upstream を設定）' })

describe('RemoteSetupBanner', () => {
  it('kind が null なら何も出さない', () => {
    const { container } = renderBanner({ kind: null })
    expect(container).toBeEmptyDOMElement()
  })

  describe('origin が無い(no-origin)', () => {
    it('文言(status)と「リモートを追加」を出し、フォーカスの移し先の印を付ける', () => {
      renderBanner()
      expect(screen.getByRole('status')).toHaveTextContent('リモートが未設定です')
      expect(addButton()).toHaveAttribute('data-remote-setup-focus', 'add-remote')
      expect(addButton()).toBeEnabled()
    })

    it.each([
      ['追加中', { remoteSetup: makeRemoteSetupPanelState({ isAddingOrigin: true }) }],
      ['他の操作中', { isBlocked: true }]
    ] as Array<[string, Partial<Props>]>)('%s は disabled', (_label, overrides) => {
      renderBanner(overrides)
      expect(addButton()).toBeDisabled()
    })

    it('押すと前回のエラーを消して追加のダイアログを開く', async () => {
      const remoteSetup = makeRemoteSetupPanelState()
      renderBanner({ remoteSetup })
      await userEvent.click(addButton())
      expect(remoteSetup.clearAddOriginError).toHaveBeenCalledOnce()
      expect(screen.getByRole('dialog', { name: 'リモートを追加' })).toBeInTheDocument()
    })

    it('成功するとダイアログを閉じ、「初回 push（upstream を設定）」へのフォーカスを要求する', async () => {
      const { remoteSetup, requestFocus } = renderBanner()
      await userEvent.click(addButton())
      await userEvent.type(
        screen.getByRole('textbox', { name: 'URL' }),
        'https://github.com/a/b.git{Enter}'
      )
      expect(remoteSetup.addOrigin).toHaveBeenCalledWith('https://github.com/a/b.git')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(requestFocus).toHaveBeenCalledWith('set-upstream')
      // 戻さずに閉じる(開いたボタンへの戻しと、次の操作のボタンへの移しを重ねない)。否定のアサーションは、
      // 遅れて走る effect を見逃さないよう、描画をもう 1 回待ってから評価する
      await act(async () => {})
      expect(addButton()).not.toHaveFocus()
    })

    it('失敗(false)ならダイアログを閉じず、フォーカスの要求もしない', async () => {
      const remoteSetup = makeRemoteSetupPanelState()
      remoteSetup.addOrigin = async () => false
      const { requestFocus } = renderBanner({ remoteSetup })
      await userEvent.click(addButton())
      await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), '/abs/bare.git{Enter}')
      expect(screen.getByRole('dialog', { name: 'リモートを追加' })).toBeInTheDocument()
      expect(requestFocus).not.toHaveBeenCalled()
    })

    // 別のプロセスが先に origin を追加した場合など、失敗の取り直しでバナーの種類が変わっても、
    // 開いているダイアログと失敗の表示を残す(結果の行き先を消さない。パターン 85)
    it('ダイアログを開いたままバナーの種類が変わっても、ダイアログと失敗を出し続ける', async () => {
      const { rerenderWith } = renderBanner()
      await userEvent.click(addButton())
      rerenderWith({
        kind: 'no-upstream',
        remoteSetup: makeRemoteSetupPanelState({
          addOriginError: new Error('リモート origin は既に設定されています')
        })
      })
      expect(screen.getByRole('dialog', { name: 'リモートを追加' })).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('リモート origin は既に設定されています')
    })

    // 戻す条件(実行中・body のときだけ・アンマウント)は useDialogFocusReturn のテストで確かめる。ここは配線だけ
    it('キャンセルで閉じると「リモートを追加」へフォーカスを戻す', async () => {
      renderBanner()
      await userEvent.click(addButton())
      await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      // フォーカスを戻す処理は passive な useEffect で、ダイアログが消えた後に走る。消えた直後に同期で評価せず待つ
      await waitFor(() => expect(addButton()).toHaveFocus())
    })
  })

  describe('upstream が無い(no-upstream)', () => {
    it('ブランチ名を添えた文言と「初回 push（upstream を設定）」を出し、フォーカスの移し先の印を付ける', () => {
      renderBanner({ kind: 'no-upstream', branch: 'feat/x' })
      expect(screen.getByRole('status')).toHaveTextContent('upstream が未設定です（feat/x）')
      expect(setUpstreamButton()).toHaveAttribute('data-remote-setup-focus', 'set-upstream')
      expect(setUpstreamButton()).toBeEnabled()
    })

    it.each([
      ['push 中', { remoteSetup: makeRemoteSetupPanelState({ isPushing: true }) }],
      ['pull 中・ロック中', { remoteSetup: makeRemoteSetupPanelState({ isPushBlocked: true }) }],
      ['他の操作中', { isBlocked: true }]
    ] as Array<[string, Partial<Props>]>)('%s は disabled', (_label, overrides) => {
      renderBanner({ kind: 'no-upstream', ...overrides })
      expect(setUpstreamButton()).toBeDisabled()
    })

    it('押すと初回 push し、成功したらツールバーの「プッシュ」へのフォーカスを要求する', async () => {
      const { remoteSetup, requestFocus } = renderBanner({ kind: 'no-upstream' })
      await userEvent.click(setUpstreamButton())
      expect(remoteSetup.pushSetUpstream).toHaveBeenCalledOnce()
      await waitFor(() => expect(requestFocus).toHaveBeenCalledWith('push'))
    })

    it('失敗(false)ならフォーカスの要求をしない', async () => {
      const remoteSetup = makeRemoteSetupPanelState()
      remoteSetup.pushSetUpstream = async () => false
      const { requestFocus } = renderBanner({ kind: 'no-upstream', remoteSetup })
      await userEvent.click(setUpstreamButton())
      expect(requestFocus).not.toHaveBeenCalled()
    })

    it('初回 push 中は「push 中...」と、打ち切りまでの秒数の案内(status)を出す', () => {
      renderBanner({
        kind: 'no-upstream',
        remoteSetup: makeRemoteSetupPanelState({ isSettingUpstream: true, isPushing: true })
      })
      const button = screen.getByRole('button', { name: 'push 中' })
      expect(button).toHaveTextContent('push 中...')
      expect(button).toBeDisabled()
      expect(screen.getByText(SETTING_UPSTREAM_NOTICE)).toHaveAttribute('role', 'status')
    })

    // 失敗の直後(取り直しの間は実行中のままエラーが入る)に、案内とパネル上部のエラーを重ねない(パターン 87)
    it('エラーがあれば、初回 push 中でも案内を出さない', () => {
      renderBanner({
        kind: 'no-upstream',
        remoteSetup: makeRemoteSetupPanelState({
          isSettingUpstream: true,
          isPushing: true,
          remoteOperationError: new Error('初回 push に失敗しました: x')
        })
      })
      expect(screen.queryByText(SETTING_UPSTREAM_NOTICE)).not.toBeInTheDocument()
    })

    // ツールバーの push の実行中は、バナーのボタンは disabled だが「push 中...」にはしない(どちらの push かを区別する)
    it('ツールバーの push の実行中は、ボタンの文言を変えず案内も出さない', () => {
      renderBanner({
        kind: 'no-upstream',
        remoteSetup: makeRemoteSetupPanelState({ isPushing: true })
      })
      expect(setUpstreamButton()).toBeDisabled()
      // 名前(aria-label)だけでなく、画面に見える文言も変えない
      expect(setUpstreamButton()).toHaveTextContent('初回 push（upstream を設定）')
      expect(screen.queryByText(SETTING_UPSTREAM_NOTICE)).not.toBeInTheDocument()
    })

    // 実行中はボタンが disabled になり、ブラウザはフォーカスを body に落とす。失敗して押せるに戻っても
    // body のままだと、キーボードの利用者がボタンへ戻れない。そのため実行中が解けたとき(失敗)に、フォーカスが
    // body ならボタンへ戻す(パターン 86)。戻す条件(外のフォーカスは奪わない・実行中を経ていない描画では
    // 何もしない)は useFocusOnRunningEnd のテストで確かめる。ここは配線(エラーの有無で戻すかを決める)だけ
    describe('初回 push の失敗の後のフォーカス', () => {
      const running = makeRemoteSetupPanelState({ isSettingUpstream: true, isPushing: true })
      const failed = makeRemoteSetupPanelState({
        remoteOperationError: new Error('初回 push に失敗しました: x')
      })

      it('失敗して実行中が解けたら、フォーカスが body ならボタンへ戻す', () => {
        const { rerenderWith } = renderBanner({ kind: 'no-upstream', remoteSetup: running })
        expect(document.body).toHaveFocus()
        rerenderWith({ remoteSetup: failed })
        expect(setUpstreamButton()).toHaveFocus()
      })

      // 成功するとバナーが消える。戻す先が無いので何もしない(ツールバーの「プッシュ」へは useRemoteSetupFocus が移す)
      it('成功してバナーが消えたら、何もしない', () => {
        const { rerenderWith } = renderBanner({ kind: 'no-upstream', remoteSetup: running })
        rerenderWith({ kind: null, remoteSetup: makeRemoteSetupPanelState() })
        expect(document.body).toHaveFocus()
      })

      // 成功してもバナーが残る場合(fetch の設定の無い origin で upstream が表示されない)は、成功の後の
      // フォーカスの要求(ツールバーの「プッシュ」)に任せ、バナーのボタンへは移さない
      it('エラーが無ければ(成功)、バナーが残ってもボタンへは移さない', () => {
        const { rerenderWith } = renderBanner({ kind: 'no-upstream', remoteSetup: running })
        rerenderWith({ remoteSetup: makeRemoteSetupPanelState() })
        expect(document.body).toHaveFocus()
      })
    })
  })
})
```

`src/renderer/src/components/source-control/__tests__/RemoteSetupBanner.styles.test.tsx`:

```tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import RemoteSetupBanner from '../RemoteSetupBanner'
import NotRepositoryView from '../NotRepositoryView'
import InitRepositoryDialog from '../InitRepositoryDialog'
import { SETTING_UPSTREAM_NOTICE } from '../../../lib/remoteSetupState'
import { makeRemoteSetupPanelState } from '../../../__tests__/makeRemoteSetupPanelState'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。
// バナーのボタンと「リポジトリを初期化」は、退避・マージのバナーのボタンと 1 つのグループセレクタで宣言を共有する
// (パターン 30・77)。グループから外れると見た目が崩れるため固定する。jsdom は :hover を計算しない
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

describe('リモートの管理のスタイル(main.css)', () => {
  it('バナーはマージのバナーと同じく横並びで、ボタンは 32px 四方以上の枠付きボタンになる', () => {
    render(
      <RemoteSetupBanner
        kind="no-origin"
        branch="main"
        remoteSetup={makeRemoteSetupPanelState()}
        isBlocked={false}
        requestFocus={vi.fn()}
      />
    )
    const section = screen.getByRole('status').parentElement as HTMLElement
    expect(getComputedStyle(section).display).toBe('flex')
    const style = getComputedStyle(screen.getByRole('button', { name: 'リモートを追加' }))
    expect(style.minWidth).toBe('32px')
    expect(style.minHeight).toBe('32px')
    expect(style.borderTopStyle).toBe('solid')
    expect(style.cursor).toBe('pointer')
  })

  it('disabled のボタンは半透明で、カーソルが既定に戻る', () => {
    render(
      <RemoteSetupBanner
        kind="no-upstream"
        branch="main"
        remoteSetup={makeRemoteSetupPanelState()}
        isBlocked={true}
        requestFocus={vi.fn()}
      />
    )
    const style = getComputedStyle(
      screen.getByRole('button', { name: '初回 push（upstream を設定）' })
    )
    expect(style.opacity).toBe('0.5')
    expect(style.cursor).toBe('default')
  })

  // `/` `.` `_` では折り返されない長いブランチ名が、枠からはみ出さない(パターン 90)
  it('バナーの文言は途中でも折り返す', () => {
    render(
      <RemoteSetupBanner
        kind="no-upstream"
        branch="release/2024.01.15_hotfix_for_customer_contoso_emergency_patch_v2"
        remoteSetup={makeRemoteSetupPanelState()}
        isBlocked={false}
        requestFocus={vi.fn()}
      />
    )
    expect(getComputedStyle(screen.getByRole('status')).overflowWrap).toBe('anywhere')
  })

  it('「リポジトリを初期化」は 32px 四方以上の枠付きボタンになる', () => {
    render(
      <NotRepositoryView
        remoteSetup={makeRemoteSetupPanelState()}
        isBlocked={false}
        requestFocus={vi.fn()}
      />
    )
    const style = getComputedStyle(screen.getByRole('button', { name: 'リポジトリを初期化' }))
    expect(style.minWidth).toBe('32px')
    expect(style.minHeight).toBe('32px')
    expect(style.borderTopStyle).toBe('solid')
  })

  it('初期化中の「リポジトリを初期化」は半透明で、カーソルが既定に戻る', () => {
    render(
      <NotRepositoryView
        remoteSetup={makeRemoteSetupPanelState({ isInitializing: true })}
        isBlocked={false}
        requestFocus={vi.fn()}
      />
    )
    const style = getComputedStyle(screen.getByRole('button', { name: 'リポジトリを初期化' }))
    expect(style.opacity).toBe('0.5')
    expect(style.cursor).toBe('default')
  })

  it('ダイアログの説明とラベルは小さい補足の文字になる', async () => {
    render(
      <NotRepositoryView
        remoteSetup={makeRemoteSetupPanelState()}
        isBlocked={false}
        requestFocus={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'リポジトリを初期化' }))
    expect(
      getComputedStyle(screen.getByText('このフォルダに空の Git リポジトリを作成します')).fontSize
    ).toBe('11px')
    expect(getComputedStyle(screen.getByText('ブランチ名')).fontSize).toBe('11px')
  })

  // 初回 push 中の案内は、ダイアログの説明と同じ小さい補足の文字で、文言とボタンの下の行に出す
  it('初回 push 中の案内は小さい補足の文字で、1 行を占める', () => {
    render(
      <RemoteSetupBanner
        kind="no-upstream"
        branch="main"
        remoteSetup={makeRemoteSetupPanelState({ isSettingUpstream: true, isPushing: true })}
        isBlocked={false}
        requestFocus={vi.fn()}
      />
    )
    const style = getComputedStyle(screen.getByText(SETTING_UPSTREAM_NOTICE))
    expect(style.fontSize).toBe('11px')
    expect(style.flexBasis).toBe('100%')
  })

  // 実行中は実行ボタンとキャンセルの両方が disabled になる。対の片方だけ押せるように見えないこと(パターン 90)
  it('実行中のダイアログでは、実行ボタンとキャンセルがどちらも半透明で、カーソルが既定に戻る', () => {
    render(
      <InitRepositoryDialog
        isRunning={true}
        isBlocked={false}
        error={null}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    )
    for (const name of ['初期化中...', 'キャンセル']) {
      const style = getComputedStyle(screen.getByRole('button', { name }))
      expect(style.opacity).toBe('0.5')
      expect(style.cursor).toBe('default')
    }
  })
})
```

```bash
npx vitest run src/renderer/src/components/source-control/__tests__/RemoteSetupInputDialog.test.tsx src/renderer/src/components/source-control/__tests__/RemoteSetupDialogs.test.tsx src/renderer/src/components/source-control/__tests__/NotRepositoryView.test.tsx src/renderer/src/components/source-control/__tests__/RemoteSetupBanner.test.tsx src/renderer/src/components/source-control/__tests__/RemoteSetupBanner.styles.test.tsx
```

Expected: FAIL（部品が無い）

- [ ] **Step 2: 部品を実装する**

`src/renderer/src/hooks/useDialogFocusReturn.ts`（3 か所に同じ形で書いていたフォーカスの処理を、単一責任のレビューで切り出した。パターン 55）:

```ts
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

interface Options {
  /** ダイアログの操作の実行中か(開いたボタンが disabled になる間)。解けるまでフォーカスを戻さない */
  isRunning: boolean
  /** 開くときに呼ぶ(前回の失敗の表示を消す clearError など)。開く前に呼ぶ */
  onOpen?: () => void
  /** 開いたボタンの ref(戻す先)。呼び出し元が作ってボタンに付ける(ref を戻り値に含めると、描画中に
   *  戻り値を読むたびに react-hooks/refs に「描画中の ref の参照」とみなされるため) */
  openerRef: RefObject<HTMLButtonElement | null>
}

export interface DialogFocusReturn {
  isOpen: boolean
  /** onOpen を呼んでから開く */
  open: () => void
  /** 閉じて、開いたボタンへフォーカスを戻す予約を立てる(キャンセル・Escape・オーバーレイのクリック、
   *  成功の後に開いたボタンへ戻す場合) */
  close: () => void
  /** 閉じるだけで戻さない(成功の後に、次の操作のボタンへ移す要求と組む場合) */
  closeWithoutReturn: () => void
}

// ボタンで開くダイアログの開閉と、閉じた後に開いたボタンへフォーカスを戻す処理
// (NotRepositoryView・RemoteSetupBanner・HistorySection で共通。パターン 55)。
// 閉じる時点で直接 focus() せず、「戻す予約」(ref)を立てるだけにする。成功の経路では実行中フラグの解除が
// まだ再描画に反映されておらず、disabled のボタンへの focus() は無視されてフォーカスが body に落ちる
// (パターン 73・86)。そのため、ダイアログが閉じて実行中でもなくなった描画の後(useEffect)で戻す。
// 戻すのはフォーカスが行き場を失っている(閉じたダイアログの中にあって body に落ちた)ときだけで、
// 実行中に利用者が外へ移した先は奪わない。予約は部品ごとの ref のため、アンマウントで消え、
// フォルダの切り替え等で別のボタンへ持ち越さない
export function useDialogFocusReturn({ isRunning, onOpen, openerRef }: Options): DialogFocusReturn {
  const [isOpen, setIsOpen] = useState(false)
  const restoreFocusPendingRef = useRef(false)

  const open = (): void => {
    onOpen?.()
    setIsOpen(true)
  }
  const close = (): void => {
    restoreFocusPendingRef.current = true
    setIsOpen(false)
  }
  const closeWithoutReturn = (): void => {
    setIsOpen(false)
  }

  // onOpen は毎回変わる参照のため effect では使わない。openerRef は描画をまたいで同じ ref のため、
  // 実際に effect を走らせるのは開閉と実行中の変化
  useEffect(() => {
    if (!restoreFocusPendingRef.current || isOpen || isRunning) return
    restoreFocusPendingRef.current = false
    const active = document.activeElement
    if (active === null || active === document.body) openerRef.current?.focus()
  }, [isOpen, isRunning, openerRef])

  return { isOpen, open, close, closeWithoutReturn }
}
```

`src/renderer/src/hooks/useFocusOnRunningEnd.ts`（3 か所に同じ形で書いていたフォーカスの処理を、単一責任のレビューで切り出した。パターン 55）:

```ts
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

interface Options {
  /** この要素の中にあるフォーカスも戻す対象にする(ダイアログのフォーム。中で disabled になった要素に残ったフォーカス) */
  containerRef?: RefObject<HTMLElement | null>
  /** false なら何もしない(例: エラーが無い=成功のときは、成功の後のフォーカスの要求に任せる)。既定は true */
  enabled?: boolean
}

// 実行中は入力欄やボタンが disabled になり、ブラウザはフォーカスを body に落とす。失敗して実行中が解けても
// body のままだと、キーボードの利用者が戻れない(ダイアログでは Escape がフォームに届かず閉じられない)。
// そのため実行中が true→false になったとき、フォーカスが body(または containerRef の中)にあれば対象へ戻す。
// 外の要素にあるフォーカスは奪わない(パターン 86)。RemoteSetupInputDialog・CreateTagDialog・RemoteSetupBanner で
// 共通(パターン 55)。直前の実行中の状態は部品ごとの ref のため、初回のマウントでは何もせず、アンマウントで消える
export function useFocusOnRunningEnd(
  isRunning: boolean,
  targetRef: RefObject<HTMLButtonElement | HTMLInputElement | null>,
  { containerRef, enabled = true }: Options = {}
): void {
  const wasRunningRef = useRef(isRunning)
  useEffect(() => {
    const wasRunning = wasRunningRef.current
    wasRunningRef.current = isRunning
    if (!wasRunning || isRunning || !enabled) return
    const target = targetRef.current
    if (target === null || target.disabled) return
    const active = document.activeElement
    if (active === null || active === document.body || containerRef?.current?.contains(active)) {
      target.focus()
    }
    // targetRef・containerRef は描画をまたいで同じ ref のため、実際に effect を走らせるのは実行中と enabled の変化
  }, [isRunning, enabled, targetRef, containerRef])
}
```

`src/renderer/src/components/source-control/RemoteSetupInputDialog.tsx`:

```tsx
import { useEffect, useId, useRef, useState } from 'react'
import { useFocusOnRunningEnd } from '../../hooks/useFocusOnRunningEnd'
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss'

interface Props {
  /** 見出し(ダイアログの名前) */
  title: string
  /** 説明(ダイアログの aria-describedby) */
  description: string
  /** 入力欄の可視のラベル */
  label: string
  /** 開いたときの値(開いたときに全選択する) */
  initialValue: string
  /** 実行ボタンの文言と、実行中の文言 */
  submitLabel: string
  runningSubmitLabel: string
  /** 実行中の案内(role="status") */
  runningNotice: string
  /** main の入口と同じ正規化。検証と送信値の両方に使う(パターン 83) */
  normalize: (value: string) => string
  /** 正規化した値の検証。違反の文言か null(UX 用。セキュリティ境界は main) */
  validate: (normalized: string) => string | null
  /** 実行中か(入力・実行ボタン・キャンセルを disabled にし、閉じさせない) */
  isRunning: boolean
  /** 他の操作中で、実行しても no-op になる状態か */
  isBlocked: boolean
  /** 実行の失敗(main のエラー)。role="alert" で表示する */
  error: Error | null
  /** 検証を通過した、正規化済みの値 */
  onSubmit: (normalized: string) => void
  /** キャンセル・Escape・オーバーレイのクリックのいずれでも呼ばれる(実行中は呼ばない) */
  onCancel: () => void
}

// リポジトリの初期化・リモートの追加の共通のダイアログ(1 項目の入力・実行中の案内・エラー・閉じる経路・フォーカス)。
// 見た目の枠(.name-input-dialog__*)はタグの作成のダイアログと共有する。2 つのダイアログに同じ実行中の処理を
// 書かないよう、InitRepositoryDialog / AddRemoteDialog はここに検証と文言を渡すだけにする(パターン 55)。
// 閉じるのは呼び出し元が成功を受け取ったとき(失敗はダイアログ内に残す)
export default function RemoteSetupInputDialog({
  title,
  description,
  label,
  initialValue,
  submitLabel,
  runningSubmitLabel,
  runningNotice,
  normalize,
  validate,
  isRunning,
  isBlocked,
  error,
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const errorId = useId()

  const normalized = normalize(value)
  const validationError = validate(normalized)
  // 失敗の直後は、取り直しの間だけ isRunning が true のまま error がセットされる。その間も案内(status)と
  // aria-busy を出さず、エラー(alert)だけを伝える(パターン 87)
  const showRunningNotice = isRunning && error === null
  const canSubmit = validationError === null && !isRunning && !isBlocked

  // 開いたときに初期値を全選択する(既定のブランチ名 main をそのまま打ち替えられるように)。autoFocus の後に選ぶ
  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit(normalized)
  }

  // 実行中は閉じさせない。閉じると、遅れて届いた失敗がダイアログの外に出ず(開き直すと clearError で消える)、
  // 遅れて届いた成功が閉じた後のフォーカスを奪う(パターン 73・85)。閉じる経路はすべてここを通す
  const requestCancel = (): void => {
    if (!isRunning) onCancel()
  }

  // オーバーレイで押して離したときだけ閉じる(中で押してオーバーレイで離したドラッグでは閉じない。useOverlayDismiss)
  const overlayHandlers = useOverlayDismiss(requestCancel)

  // 実行中は入力欄と実行ボタンが disabled になり、ブラウザはフォーカスを body に落とす。失敗して実行中が解けても
  // body のままだと、Escape がフォームに届かず閉じられない。そのため実行中が解けたとき(ダイアログが開いたまま=失敗)に、
  // フォーカスが body かダイアログ内にあれば入力欄へ戻す(useFocusOnRunningEnd。パターン 86)。
  // 成功ではこの描画の前に閉じられている
  useFocusOnRunningEnd(isRunning, inputRef, { containerRef: formRef })

  return (
    <div className="name-input-dialog__overlay" role="presentation" {...overlayHandlers}>
      <form
        ref={formRef}
        className="name-input-dialog remote-setup-dialog"
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={showRunningNotice}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // IME の変換を取り消す Escape ではダイアログを閉じない(入力中の値が消えるため)
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) requestCancel()
        }}
        onSubmit={handleSubmit}
      >
        <p id={titleId} className="name-input-dialog__title">
          {title}
        </p>
        <p id={descriptionId} className="remote-setup-dialog__note">
          {description}
        </p>
        <label className="remote-setup-dialog__field">
          <span className="remote-setup-dialog__label">{label}</span>
          <input
            // ダイアログを開いた直後に入力を始められるようにする(モーダルの慣例。autoFocus は React がマウント時に focus() を呼ぶ)
            ref={inputRef}
            autoFocus
            type="text"
            className="name-input-dialog__input"
            value={value}
            disabled={isRunning}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={validationError !== null}
            aria-describedby={validationError !== null ? errorId : undefined}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {validationError !== null && (
          <p id={errorId} className="name-input-dialog__error">
            {validationError}
          </p>
        )}
        {/* 実行中は入力欄とボタンが disabled になりフォーカスが body に落ちるため、ボタンの文言だけでは
            スクリーンリーダーに伝わらない。role="status" で案内する(完了・失敗で消え、失敗は下の alert が伝える) */}
        {showRunningNotice && (
          <p className="remote-setup-dialog__note" role="status">
            {runningNotice}
          </p>
        )}
        {error !== null && (
          <p className="name-input-dialog__error" role="alert">
            {error.message}
          </p>
        )}
        <div className="name-input-dialog__actions">
          <button type="submit" className="name-input-dialog__ok" disabled={!canSubmit}>
            {isRunning ? runningSubmitLabel : submitLabel}
          </button>
          <button
            type="button"
            className="name-input-dialog__cancel"
            disabled={isRunning}
            onClick={requestCancel}
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  )
}
```

`src/renderer/src/components/source-control/InitRepositoryDialog.tsx`:

```tsx
import { normalizeInitialBranchName } from '@shared/branchName'
import { validateInitialBranchName } from '../../lib/remoteSetupValidation'
import RemoteSetupInputDialog from './RemoteSetupInputDialog'

interface Props {
  isRunning: boolean
  isBlocked: boolean
  error: Error | null
  /** 検証を通過した最初のブランチ名(前後の空白を除き NFC) */
  onSubmit: (branch: string) => void
  onCancel: () => void
}

// リポジトリの初期化のダイアログ。共通のダイアログに、最初のブランチ名の正規化・検証と文言を渡すだけにする
// (CreateBranchDialog が NameInputDialog を包むのと同じ形)。既定値は main(init.defaultBranch は読まない。利用者の決定)
export default function InitRepositoryDialog({
  isRunning,
  isBlocked,
  error,
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  return (
    <RemoteSetupInputDialog
      title="リポジトリを初期化"
      description="このフォルダに空の Git リポジトリを作成します"
      label="ブランチ名"
      initialValue="main"
      submitLabel="初期化"
      runningSubmitLabel="初期化中..."
      runningNotice="初期化中です"
      normalize={normalizeInitialBranchName}
      validate={validateInitialBranchName}
      isRunning={isRunning}
      isBlocked={isBlocked}
      error={error}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  )
}
```

`src/renderer/src/components/source-control/AddRemoteDialog.tsx`:

```tsx
import { normalizeRemoteUrl } from '@shared/remoteUrl'
import { validateRemoteUrl } from '../../lib/remoteSetupValidation'
import RemoteSetupInputDialog from './RemoteSetupInputDialog'

interface Props {
  isRunning: boolean
  isBlocked: boolean
  error: Error | null
  /** 検証を通過した URL(前後の空白だけを除いたもの) */
  onSubmit: (url: string) => void
  onCancel: () => void
}

// リモート origin の追加のダイアログ。共通のダイアログに、URL の正規化・検証と文言を渡すだけにする。
// 名前は origin 固定で、この時点では接続しない
export default function AddRemoteDialog({
  isRunning,
  isBlocked,
  error,
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  return (
    <RemoteSetupInputDialog
      title="リモートを追加"
      description="リモート origin を追加します（この時点では接続しません）"
      label="URL"
      initialValue=""
      submitLabel="追加"
      runningSubmitLabel="追加中..."
      runningNotice="追加中です"
      normalize={normalizeRemoteUrl}
      validate={validateRemoteUrl}
      isRunning={isRunning}
      isBlocked={isBlocked}
      error={error}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  )
}
```

`src/renderer/src/components/source-control/NotRepositoryView.tsx`:

```tsx
import { useRef } from 'react'
import type { RemoteSetupPanelState } from '../../types'
import type { RemoteSetupFocusTarget } from '../../lib/remoteSetupState'
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn'
import InitRepositoryDialog from './InitRepositoryDialog'

interface Props {
  remoteSetup: RemoteSetupPanelState
  /** 他の Git 操作のロック中で、初期化しても no-op になる状態(ダイアログの「初期化」を disabled にする) */
  isBlocked: boolean
  /** 成功の後に、次の操作のボタンへのフォーカスを要求する(SourceControlPanel の useRemoteSetupFocus) */
  requestFocus: (target: RemoteSetupFocusTarget) => void
}

// Git 管理外のフォルダの表示。「リポジトリを初期化」とダイアログの開閉を持つ。初期化に成功すると、ステータスの
// 取り直しでパネルがリポジトリの表示に切り替わり、この部品ごと外れる(開閉の状態は別のフォルダへ持ち越さない。差分 5)
export default function NotRepositoryView({
  remoteSetup,
  isBlocked,
  requestFocus
}: Props): React.JSX.Element {
  // 開くときに前回の失敗の表示を消す(キャンセルしたダイアログのエラーを持ち越さない)。キャンセル・Escape・
  // オーバーレイのクリックで閉じたら、初期化中でもなくなった描画の後にボタンへフォーカスを戻す(useDialogFocusReturn)
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const dialog = useDialogFocusReturn({
    isRunning: remoteSetup.isInitializing,
    onOpen: remoteSetup.clearInitError,
    openerRef: openButtonRef
  })

  // 成功したときだけ閉じ、次の操作のボタン(「リモートを追加」)へのフォーカスを要求する。要求はダイアログを閉じるのと
  // 同じ描画に入れ、SourceControlPanel が描画の後に移す(差分 4)。通常はステータスの取り直しでリポジトリの表示に
  // 切り替わり、この部品ごと外れるため、close の「戻す予約」は捨てられて要求の先(バナー)へ移る。取り直しが失敗して
  // (握りつぶされる)Git 管理外の表示のままなら、移す先が無いため、予約どおり開いたボタンへ戻す(子の effect が
  // 親の useRemoteSetupFocus より先に走り、body でなくなったフォーカスを親は奪わない)。
  // 失敗(false)はダイアログ内に initError を表示したまま残す
  const handleSubmit = async (branch: string): Promise<void> => {
    if (!(await remoteSetup.initRepository(branch))) return
    dialog.close()
    requestFocus('add-remote')
  }

  return (
    <div className="source-control-panel__no-repo-view">
      <p className="source-control-panel__no-repo">Git リポジトリではありません</p>
      <div className="source-control-panel__no-repo-actions">
        <button
          ref={openButtonRef}
          type="button"
          className="source-control-panel__init-btn"
          aria-label="リポジトリを初期化"
          // 初期化中も押せない(開き直したダイアログが、前の初期化の成功で閉じられるのを防ぐ。パターン 73)
          disabled={remoteSetup.isInitializing}
          onClick={dialog.open}
        >
          リポジトリを初期化
        </button>
      </div>
      {dialog.isOpen && (
        <InitRepositoryDialog
          isRunning={remoteSetup.isInitializing}
          isBlocked={isBlocked}
          error={remoteSetup.initError}
          onSubmit={(branch) => void handleSubmit(branch)}
          onCancel={dialog.close}
        />
      )}
    </div>
  )
}
```

`src/renderer/src/components/source-control/RemoteSetupBanner.tsx`:

```tsx
import { useRef } from 'react'
import type { RemoteSetupPanelState } from '../../types'
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn'
import { useFocusOnRunningEnd } from '../../hooks/useFocusOnRunningEnd'
import { SETTING_UPSTREAM_NOTICE, buildRemoteSetupBannerText } from '../../lib/remoteSetupState'
import type { RemoteSetupFocusTarget, RemoteSetupKind } from '../../lib/remoteSetupState'
import AddRemoteDialog from './AddRemoteDialog'

interface Props {
  /** getRemoteSetupState(gitStatus) の結果。null ならバナーを出さない(開いている追加のダイアログは出し続ける) */
  kind: RemoteSetupKind | null
  /** 現在のブランチ名(upstream が未設定の文言に使う) */
  branch: string | null
  remoteSetup: RemoteSetupPanelState
  /** 他の操作中(ステージ・ハンク操作・commit・pull・ブランチ操作・退避・解決ビューの操作)で、押しても no-op になる状態 */
  isBlocked: boolean
  /** 成功の後に、次の操作のボタンへのフォーカスを要求する(SourceControlPanel の useRemoteSetupFocus) */
  requestFocus: (target: RemoteSetupFocusTarget) => void
}

// リモートの状態バナー(MergeBanner と同じ作り: section、文言は role="status"、ボタンの並び)。
// origin が無ければ「リモートを追加」(ダイアログの開閉もここで持つ)、upstream が無ければ「初回 push（upstream を設定）」。
// 追加のダイアログは、バナーの種類が変わっても(別のプロセスが先に origin を追加した失敗など)閉じずに出し続け、
// 失敗を見せる(差分 5。パターン 85)。成功の後のフォーカスの要求は、成功を受け取ったここで出す(差分 4)
export default function RemoteSetupBanner({
  kind,
  branch,
  remoteSetup,
  isBlocked,
  requestFocus
}: Props): React.JSX.Element {
  // 開くときに前回の失敗の表示を消す。キャンセル等で閉じたら、追加中でもなくなった描画の後に「リモートを追加」へ
  // フォーカスを戻す(body のときだけ。useDialogFocusReturn。NotRepositoryView と同じ)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const addDialog = useDialogFocusReturn({
    isRunning: remoteSetup.isAddingOrigin,
    onOpen: remoteSetup.clearAddOriginError,
    openerRef: addButtonRef
  })

  // 成功すると「リモートを追加」は消える(バナーが upstream の未設定に変わる)ため、戻さずに閉じ、次の操作のボタンへ移す
  const handleAddOrigin = async (url: string): Promise<void> => {
    if (!(await remoteSetup.addOrigin(url))) return
    addDialog.closeWithoutReturn()
    requestFocus('set-upstream')
  }

  // 成功するとバナーごと消えるため、ツールバーの「プッシュ」へ移す
  const handleSetUpstream = async (): Promise<void> => {
    if (await remoteSetup.pushSetUpstream()) requestFocus('push')
  }

  const isSettingUpstream = remoteSetup.isSettingUpstream
  // 失敗の直後(取り直しの間は実行中のままエラーが入る)は案内を出さない(パターン 87)
  const showSettingUpstreamNotice = isSettingUpstream && remoteSetup.remoteOperationError === null

  // 初回 push の実行中はボタンが disabled になり、ブラウザはフォーカスを body に落とす。失敗して押せるに戻っても
  // body のままだと、キーボードの利用者がボタンへ戻れない。そのため実行中が解けたとき(エラーがある=失敗)に、
  // フォーカスが body ならボタンへ戻す(外の要素にあるフォーカスは奪わない。useFocusOnRunningEnd。パターン 86)。
  // 成功ではバナーが消えるか、残っても(upstream が表示されない origin)成功の後のフォーカスの要求
  // (ツールバーの「プッシュ」。useRemoteSetupFocus)に任せるため、ここでは移さない(enabled をエラーの有無にする)
  const setUpstreamButtonRef = useRef<HTMLButtonElement>(null)
  useFocusOnRunningEnd(isSettingUpstream, setUpstreamButtonRef, {
    enabled: remoteSetup.remoteOperationError !== null
  })

  return (
    <>
      {kind !== null && (
        <section className="remote-setup-banner">
          <p className="remote-setup-banner__message" role="status">
            {buildRemoteSetupBannerText(kind, branch)}
          </p>
          <div className="remote-setup-banner__actions">
            {kind === 'no-origin' ? (
              <button
                ref={addButtonRef}
                type="button"
                className="remote-setup-banner__button"
                // 値は RemoteSetupFocusTarget と型で結ぶ(綴りの食い違いを typecheck で検出する。パターン 88)
                data-remote-setup-focus={'add-remote' satisfies RemoteSetupFocusTarget}
                aria-label="リモートを追加"
                disabled={remoteSetup.isAddingOrigin || isBlocked}
                onClick={addDialog.open}
              >
                リモートを追加
              </button>
            ) : (
              <button
                ref={setUpstreamButtonRef}
                type="button"
                className="remote-setup-banner__button"
                data-remote-setup-focus={'set-upstream' satisfies RemoteSetupFocusTarget}
                aria-label={isSettingUpstream ? 'push 中' : '初回 push（upstream を設定）'}
                // push と実行中フラグを共有する(ツールバーの push 中・pull 中・ロック中も押せない)
                disabled={remoteSetup.isPushing || remoteSetup.isPushBlocked || isBlocked}
                onClick={() => void handleSetUpstream()}
              >
                {isSettingUpstream ? 'push 中...' : '初回 push（upstream を設定）'}
              </button>
            )}
          </div>
          {kind === 'no-upstream' && showSettingUpstreamNotice && (
            <p className="remote-setup-banner__note" role="status">
              {SETTING_UPSTREAM_NOTICE}
            </p>
          )}
        </section>
      )}
      {addDialog.isOpen && (
        <AddRemoteDialog
          isRunning={remoteSetup.isAddingOrigin}
          isBlocked={isBlocked}
          error={remoteSetup.addOriginError}
          onSubmit={(url) => void handleAddOrigin(url)}
          onCancel={addDialog.close}
        />
      )}
    </>
  )
}
```

- [ ] **Step 3: CSS を足す（`src/renderer/src/assets/main.css`）**

1. 共通のボタンの規則（「枠付きの小さなボタンの共通の見た目」のコメントの直後）の 3 つのセレクタの並びに、新しいボタンを足す:
   - 基本: `.history-section__create-tag,` の次の行に `.remote-setup-banner__button,` と `.source-control-panel__init-btn,` を足す
   - ホバー: `.history-section__create-tag:hover:not(:disabled),` の次の行に `.remote-setup-banner__button:hover:not(:disabled),` と `.source-control-panel__init-btn:hover:not(:disabled),` を足す
   - disabled: `.history-section__create-tag:disabled,` の次の行に `.remote-setup-banner__button:disabled,` と `.source-control-panel__init-btn:disabled,` を足す
   - コメントの「(退避・マージのバナー・解決ビューのツールバー・ブロック)」を「(退避・マージのバナー・リモートのバナー・初期化・解決ビューのツールバー・ブロック)」にする
2. マージのバナーの規則を、リモートのバナーと共有する。`.merge-banner {` を `.merge-banner,\n.remote-setup-banner {`、`.merge-banner__message {` を `.merge-banner__message,\n.remote-setup-banner__message {`、`.merge-banner__actions {` を `.merge-banner__actions,\n.remote-setup-banner__actions {` にし、コメントを「マージ中のバナーとリモートの状態バナー。ボタン(.merge-banner**button / .remote-setup-banner**button)の見た目は退避セクションの共通のボタン規則で共有する」にする。`.merge-banner__error { … }` の後に追加:

```css
/* ブランチ名が長いと `/` `.` `_` で折り返せないため、枠からはみ出さないよう途中でも折り返す(パターン 90) */
.remote-setup-banner__message {
  overflow-wrap: anywhere;
}

/* 初回 push 中の案内(打ち切りまでの秒数)。文言の下の行に出す */
.remote-setup-banner__note {
  flex-basis: 100%;
  margin: 0;
  color: #969696;
  font-size: 11px;
}
```

3. ダイアログの説明・ラベル・項目の規則を、タグの作成のダイアログと共有する。`.create-tag-dialog__note,\n.create-tag-dialog__label {` を `.create-tag-dialog__note,\n.create-tag-dialog__label,\n.remote-setup-dialog__note,\n.remote-setup-dialog__label {`、`.create-tag-dialog__note {`（margin の規則）を `.create-tag-dialog__note,\n.remote-setup-dialog__note {`、`.create-tag-dialog__field {` を `.create-tag-dialog__field,\n.remote-setup-dialog__field {` にする
4. `.source-control-panel__no-repo, .source-control-panel__empty, .source-control-panel__placeholder { … }` の後に追加:

```css
/* Git 管理外の表示の「リポジトリを初期化」。文言の下に、文言と同じ左の余白で置く */
.source-control-panel__no-repo-actions {
  padding: 0 12px 12px;
}
```

```bash
npx vitest run src/renderer/src/components/source-control
```

Expected: PASS

- [ ] **Step 4: ミューテーション**

1. `RemoteSetupInputDialog` の `showRunningNotice` を `isRunning` にする → 「エラーがあれば…alert だけ」
2. `requestCancel` の `if (!isRunning)` を外す → 「実行中は閉じない」
3. Escape の `!e.nativeEvent.isComposing` を外す → IME のテスト
4. 全選択の `useEffect` を外す → 「初期値が全選択」
5. （単一責任のレビューで変更）`RemoteSetupInputDialog` の `useFocusOnRunningEnd` から `containerRef: formRef` を外す → 「ダイアログ内(実行中に disabled になったキャンセル)にあるフォーカスも入力欄へ戻す」。呼び出しを外す → 同じテストと「isRunning が true→false…入力欄へ戻す」。外のフォーカスを奪わない条件は `useFocusOnRunningEnd` のテストで確かめる（下の 15）
6. `InitRepositoryDialog` の `normalize={normalizeInitialBranchName}` を `(v) => v.trim()` にする → NFC のテスト
7. `NotRepositoryView` の `requestFocus('add-remote')` を外す → 成功のテスト。`dialog.close()` を `dialog.closeWithoutReturn()` にする（差分 19）→ 「成功した後もこの部品が残っていれば(Git 管理外のまま)、ボタンへフォーカスを戻す」と、Task 8 の結合の「成功しても取り直し後に Git 管理外のままなら…」。`onCancel={dialog.close}` を `closeWithoutReturn` にする → 「キャンセルで閉じると、ボタンへフォーカスを戻す」（`RemoteSetupBanner` の `addDialog` は成功の後も `closeWithoutReturn` のまま。`requestFocus` を外す・`closeWithoutReturn()` を `close()` にする・`onCancel` を `closeWithoutReturn` にする変異で、それぞれ成功・成功・キャンセルのテストが落ちる）
8. `NotRepositoryView` の `onOpen: remoteSetup.clearInitError` を外す → 「前回のエラーを消して」
9. `RemoteSetupBanner` の追加のダイアログを出す条件を `kind === 'no-origin' && addDialog.isOpen` にする → 「ダイアログを開いたままバナーの種類が変わっても、ダイアログと失敗を出し続ける」
10. `RemoteSetupBanner` の初回 push のボタンの disabled から `remoteSetup.isPushBlocked ||` を外す → 「pull 中・ロック中」
11. `showSettingUpstreamNotice` の `remoteOperationError === null` を外す → 「エラーがあれば、初回 push 中でも案内を出さない」
12. ボタンの文言の判定を `isSettingUpstream` から `remoteSetup.isPushing` にする → 「ツールバーの push の実行中は、ボタンの文言を変えず」
13. CSS の共通のボタンの規則から `.remote-setup-banner__button,` を外す → styles のテスト。`.remote-setup-banner__message { overflow-wrap }` を外す → 折り返しのテスト
14. `RemoteSetupBanner` の初回 push の失敗の後のフォーカスの復帰（Task 7 のレビューで追加。単一責任のレビューで `useFocusOnRunningEnd` に置き換えた）: 呼び出しを外す → 「失敗して実行中が解けたら…ボタンへ戻す」。`enabled`（エラーの有無）を外す → 「エラーが無ければ(成功)、バナーが残ってもボタンへは移さない」。body の条件・実行中を経ていない描画は 15 のフックのテストで確かめる
15. （単一責任のレビューで追加）`useFocusOnRunningEnd`: `!wasRunning` を外す → 「false→true や、実行中を経ていない描画(初回のマウント・false のままの再描画)では何もしない」など 2 件。`active === document.body` を外す → 「true→false…body なら対象へ戻す」。`containerRef?.current?.contains(active)` を外す → 「containerRef の中にあるフォーカスも対象へ戻す」。`!enabled` を外す → 「enabled が false なら戻さない」。`useRef(isRunning)` を `useRef(true)` にする → 初回のマウントのテスト。`wasRunningRef` をモジュールの変数にする → 「アンマウントした部品の実行中の状態で…」
16. （単一責任のレビューで追加）`useDialogFocusReturn`: effect の `|| isRunning` を外す → 「実行中に閉じたら(成功の経路)…解けてから戻す」。body の条件を外す → 「利用者が別の要素へ移していたら奪わない」。`close` の予約を外す → キャンセル・成功の 2 件。`closeWithoutReturn` で予約を立てる → 「戻さずに閉じたら…」。`onOpen?.()` を外す → 「開くと onOpen を呼んでから開く」。予約をモジュールの変数にする → 「予約はアンマウントで消え…」
17. （差分 19）`useOverlayDismiss` の `pressedOnOverlayRef.current &&` を外す → useOverlayDismiss の「ダイアログの中で押してオーバーレイで離しても…」と、`RemoteSetupInputDialog`・`CreateTagDialog` の「入力欄で押してオーバーレイで離しても onCancel を呼ばず、入力が残る」（4 件）。`e.target === e.currentTarget` の条件を外す → 「オーバーレイで押しても、click の target が子なら…」。ダイアログを `onClick={requestCancel}` に戻す → それぞれのダイアログのドラッグのテスト
18. （差分 20）`useOverlayDismiss` の click の判定から `releasedOnOverlayRef.current &&` を外す → useOverlayDismiss の「オーバーレイで押してダイアログの中で離しても…」「離した位置の記録は次の click に持ち越さない」と、両ダイアログの「オーバーレイで押して入力欄で離しても…」（4 件）。click の後の記録のリセット（2 行）を外す → 「押下と離した位置の記録は click の後で捨て、押下の無い click では閉じない」

- [ ] **Step 5: 検証**

```bash
npx vitest run src/renderer
npm run typecheck
npx eslint src/renderer/src/components/source-control/RemoteSetupInputDialog.tsx src/renderer/src/components/source-control/InitRepositoryDialog.tsx src/renderer/src/components/source-control/AddRemoteDialog.tsx src/renderer/src/components/source-control/NotRepositoryView.tsx src/renderer/src/components/source-control/RemoteSetupBanner.tsx src/renderer/src/components/source-control/__tests__/RemoteSetupInputDialog.test.tsx src/renderer/src/components/source-control/__tests__/RemoteSetupDialogs.test.tsx src/renderer/src/components/source-control/__tests__/NotRepositoryView.test.tsx src/renderer/src/components/source-control/__tests__/RemoteSetupBanner.test.tsx src/renderer/src/components/source-control/__tests__/RemoteSetupBanner.styles.test.tsx
npx prettier --check src/renderer/src/assets/main.css src/renderer/src/components/source-control/RemoteSetupInputDialog.tsx src/renderer/src/components/source-control/InitRepositoryDialog.tsx src/renderer/src/components/source-control/AddRemoteDialog.tsx src/renderer/src/components/source-control/NotRepositoryView.tsx src/renderer/src/components/source-control/RemoteSetupBanner.tsx src/renderer/src/components/source-control/__tests__/RemoteSetupInputDialog.test.tsx src/renderer/src/components/source-control/__tests__/RemoteSetupDialogs.test.tsx src/renderer/src/components/source-control/__tests__/NotRepositoryView.test.tsx src/renderer/src/components/source-control/__tests__/RemoteSetupBanner.test.tsx src/renderer/src/components/source-control/__tests__/RemoteSetupBanner.styles.test.tsx
```

Expected: すべて成功（新しいファイルに eslint の警告が無いこと。写し元の `CreateTagDialog` の流儀をそのまま持ち込んでいないかも確かめる。パターン 90）

- [ ] **Step 6: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 8: 配線（`useRemoteSetupFocus` / `SourceControlToolbar` / `GitRepoView` / `SourceControlPanel` / `Sidebar` / `App` / `useAppState`）と配線テスト

**Files:**

- Create: `src/renderer/src/hooks/useRemoteSetupFocus.ts`, `src/renderer/src/hooks/__tests__/useRemoteSetupFocus.test.tsx`, `src/renderer/src/components/source-control/__tests__/RemoteSetupFlow.test.tsx`
- Modify: `src/renderer/src/components/source-control/SourceControlToolbar.tsx`, `GitRepoView.tsx`, `SourceControlPanel.tsx`（`src/renderer/src/components/source-control/`）、`src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/hooks/useAppState.ts`
- Test: `src/renderer/src/components/source-control/__tests__/SourceControlToolbar.test.tsx`, `GitRepoView.test.tsx`, `SourceControlPanel.test.tsx`, `src/renderer/src/components/__tests__/Sidebar.test.tsx`, `src/renderer/src/hooks/__tests__/useAppState.test.ts`

**Interfaces:**

- Consumes: Task 6 の `useGitRemoteSetup` / `useGitRemoteOperations`（`isSettingUpstream` / `pushSetUpstream`）/ `RemoteSetupPanelState` / `makeRemoteSetupPanelState` / `getRemoteSetupState` / `RemoteSetupKind`、Task 7 の `NotRepositoryView` / `RemoteSetupBanner`
- Produces: `useAppState()` の戻り値の `remoteSetup: RemoteSetupPanelState`。`GitRepoView` の必須 Props `remoteSetupKind: RemoteSetupKind | null` / `remoteSetup: RemoteSetupPanelState`、`SourceControlPanel` / `Sidebar` の必須 Props `remoteSetup: RemoteSetupPanelState`。`GitRepoView` の必須 Props `requestRemoteSetupFocus: (target: RemoteSetupFocusTarget) => void`。`useRemoteSetupFocus(rootRef): { requestFocus }`（要求の state を持つ。単一責任のレビューで `useGitRemoteSetup` から移した）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useRemoteSetupFocus.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, it, expect } from 'vitest'
import type { RemoteSetupFocusTarget } from '../../lib/remoteSetupState'
import { useRemoteSetupFocus } from '../useRemoteSetupFocus'

type RequestFocus = ReturnType<typeof useRemoteSetupFocus>['requestFocus']

// 描画ごとの requestFocus を外へ渡す(要求を出す部品の代わり。ボタンを押して要求するとフォーカスがそのボタンへ移り、
// 「フォーカスが body のときだけ移す」を試せないため)
function Harness({
  onRender,
  target = 'push',
  showTarget = true,
  disabled = false
}: {
  onRender: (requestFocus: RequestFocus) => void
  target?: RemoteSetupFocusTarget
  showTarget?: boolean
  disabled?: boolean
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const { requestFocus } = useRemoteSetupFocus(rootRef)
  onRender(requestFocus)
  return (
    <div ref={rootRef}>
      {showTarget && (
        <button type="button" data-remote-setup-focus={target} disabled={disabled}>
          移す先
        </button>
      )}
      <input aria-label="外の入力欄" />
    </div>
  )
}

const setup = (
  props: Omit<Parameters<typeof Harness>[0], 'onRender'> = {}
): {
  request: (target: RemoteSetupFocusTarget) => void
  requestFocusOfEachRender: RequestFocus[]
  rerenderWith: (next: Omit<Parameters<typeof Harness>[0], 'onRender'>) => void
} => {
  const requestFocusOfEachRender: RequestFocus[] = []
  const onRender = (requestFocus: RequestFocus): void => {
    requestFocusOfEachRender.push(requestFocus)
  }
  const { rerender } = render(<Harness onRender={onRender} {...props} />)
  return {
    request: (target) => act(() => requestFocusOfEachRender.at(-1)?.(target)),
    requestFocusOfEachRender,
    rerenderWith: (next) => rerender(<Harness onRender={onRender} {...next} />)
  }
}
const targetButton = (): HTMLElement => screen.getByRole('button', { name: '移す先' })

// 成功の後に、次の操作のボタンへ描画の後で移す。フォーカスが body のときだけ移し、要求は 1 回だけ扱う(パターン 86)
describe('useRemoteSetupFocus', () => {
  it('要求があり、フォーカスが body なら、印の付いたボタンへ移す', () => {
    const { request } = setup()
    expect(document.body).toHaveFocus()
    request('push')
    expect(targetButton()).toHaveFocus()
  })

  it('利用者が別の要素へ移していたら奪わない', () => {
    const { request } = setup()
    const outside = screen.getByRole('textbox', { name: '外の入力欄' })
    act(() => outside.focus())
    request('push')
    expect(outside).toHaveFocus()
  })

  // 要求は呼ぶたびに別の要求として扱うため、同じ先をもう一度要求しても描画の後に移す
  it('同じ先を続けて要求しても、毎回移す', () => {
    const { request } = setup()
    request('push')
    expect(targetButton()).toHaveFocus()
    act(() => targetButton().blur())
    expect(document.body).toHaveFocus()
    request('push')
    expect(targetButton()).toHaveFocus()
  })

  // 移せなかった要求は持ち越さない。後から現れたボタンへ遅れて移さない(例: 追加の後に detached でバナーが出ない)
  it('移す先が無ければ何もせず、後から現れても移さない', () => {
    const { request, rerenderWith } = setup({ showTarget: false })
    request('push')
    expect(document.body).toHaveFocus()
    rerenderWith({ showTarget: true })
    expect(document.body).toHaveFocus()
  })

  it('移す先が disabled なら移さず、後から押せるようになっても移さない', () => {
    const { request, rerenderWith } = setup({ disabled: true })
    request('push')
    expect(targetButton()).not.toHaveFocus()
    rerenderWith({ disabled: false })
    expect(targetButton()).not.toHaveFocus()
  })

  it('別の先の要求では、印の違うボタンへ移さない', () => {
    const { request } = setup({ target: 'push' })
    request('set-upstream')
    expect(document.body).toHaveFocus()
  })

  it('要求が無ければ何もしない', () => {
    setup()
    expect(document.body).toHaveFocus()
  })

  // 子の部品へ props で渡すため、描画ごとに変わらない
  it('requestFocus の参照は再描画で変わらない', () => {
    const { request, requestFocusOfEachRender } = setup()
    request('push')
    expect(requestFocusOfEachRender.length).toBeGreaterThan(1)
    expect(new Set(requestFocusOfEachRender).size).toBe(1)
  })
})
```

`src/renderer/src/components/source-control/__tests__/SourceControlToolbar.test.tsx` の末尾（`describe` の中の最後）に追加:

```tsx
// 初回 push の成功の後に、フォーカスを移す先(useRemoteSetupFocus が探す)
it('プッシュボタンはフォーカスの移し先の印を持つ', () => {
  render(<SourceControlToolbar {...baseProps} />)
  expect(screen.getByRole('button', { name: 'プッシュ' })).toHaveAttribute(
    'data-remote-setup-focus',
    'push'
  )
})
```

`src/renderer/src/components/source-control/__tests__/GitRepoView.test.tsx`:

- import に `import type { RemoteSetupKind } from '../../../lib/remoteSetupState'` と `import { makeRemoteSetupPanelState } from '../../../__tests__/makeRemoteSetupPanelState'` を足す
- `baseProps` の `gitTag: makeGitTagPanelState()` の後に `remoteSetupKind: null as RemoteSetupKind | null,` と `remoteSetup: makeRemoteSetupPanelState()` を足す（`gitTag` の行末にカンマを足す）。`baseProps` を使わずに Props を並べている 4 つの `render`（`gitTag={makeGitTagPanelState()}` を渡しているもの）にも `remoteSetupKind={null}` と `remoteSetup={makeRemoteSetupPanelState()}` を足す（足りなければ typecheck が `missing the following properties … remoteSetupKind, remoteSetup` で示す）
- （単一責任のレビューで追加）`baseProps` に `requestRemoteSetupFocus: vi.fn()` を、Props を並べている 4 つの `render` に `requestRemoteSetupFocus={vi.fn()}` を足し、`describe` の最後に「requestRemoteSetupFocus がバナーまで届く(初回 push の成功 → ツールバーの「プッシュ」を要求する)」（`no-upstream` のバナーの初回 push を押し、`waitFor` で `'push'` の要求を確かめる）を足す
- 追加:

```tsx
// マージのバナーを先に、その下にリモートのバナーを出す(どちらも条件を満たせば両方。設計書の表)
it('マージのバナーの直後にリモートのバナーを出す', () => {
  render(
    <GitRepoView
      branch="main"
      ahead={0}
      behind={0}
      files={noFiles}
      {...baseProps}
      mergeState={{ ...emptyMergeState, inProgress: true, unresolvedCount: 1 }}
      remoteSetupKind="no-upstream"
    />
  )
  const statuses = screen.getAllByRole('status')
  expect(statuses[0]).toHaveTextContent('マージ中')
  expect(statuses[1]).toHaveTextContent('upstream が未設定です（main）')
})

it('他の操作中は、バナーのボタンが押せない', () => {
  render(
    <GitRepoView
      branch="main"
      ahead={0}
      behind={0}
      files={noFiles}
      {...baseProps}
      stagingPaths={new Set(['a.ts'])}
      remoteSetupKind="no-origin"
    />
  )
  expect(screen.getByRole('button', { name: 'リモートを追加' })).toBeDisabled()
})

it('remoteSetup がバナーまで届く(リモートを追加 → 前回のエラーを消す)', async () => {
  const remoteSetup = makeRemoteSetupPanelState()
  render(
    <GitRepoView
      branch="main"
      ahead={0}
      behind={0}
      files={noFiles}
      {...baseProps}
      remoteSetupKind="no-origin"
      remoteSetup={remoteSetup}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: 'リモートを追加' }))
  expect(remoteSetup.clearAddOriginError).toHaveBeenCalledOnce()
})
```

`src/renderer/src/components/source-control/__tests__/SourceControlPanel.test.tsx`:

- import に `import { makeRemoteSetupPanelState } from '../../../__tests__/makeRemoteSetupPanelState'` を足す
- `baseProps` の `gitTag: makeGitTagPanelState(),` の後に `remoteSetup: makeRemoteSetupPanelState(),` を足し、`baseProps` を使わずに全 Props を並べている `render`（`operationError があれば表示する` のテスト）にも `remoteSetup={makeRemoteSetupPanelState()}` を足す
- 追加:

```tsx
describe('リモートの管理', () => {
  it('Git 管理外では「リポジトリを初期化」を出す', () => {
    render(
      <SourceControlPanel
        {...baseProps}
        gitStatus={{
          ...repoStatus,
          isRepo: false,
          branch: null,
          hasOrigin: false,
          hasRemote: false,
          upstream: null
        }}
      />
    )
    expect(screen.getByText('Git リポジトリではありません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'リポジトリを初期化' })).toBeEnabled()
  })

  it('リモートが 1 つも無いリポジトリでは「リモートが未設定です」のバナーを出す', () => {
    render(
      <SourceControlPanel
        {...baseProps}
        gitStatus={{ ...repoStatus, hasOrigin: false, hasRemote: false, upstream: null }}
      />
    )
    expect(screen.getByText('リモートが未設定です')).toBeInTheDocument()
  })

  // （差分 26）
  // git clone -o github など、origin 以外の名前のリモートだけを持つリポジトリ。既存の push / pull は
  // 通信できるため『リモートが未設定です』は出さない。初回 push は origin 固定で拒否されるため、upstream の
  // 無いブランチでも upstream のバナーを出さない(レビュー 8 周目)
  it.each([
    ['upstream あり', 'github/main'],
    ['upstream なし(新しいブランチ)', null]
  ])('origin 以外の名前のリモートだけなら、リモートのバナーを出さない(%s)', (_label, upstream) => {
    render(
      <SourceControlPanel
        {...baseProps}
        gitStatus={{ ...repoStatus, hasOrigin: false, hasRemote: true, upstream }}
      />
    )
    expect(screen.queryByText('リモートが未設定です')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'リモートを追加' })).not.toBeInTheDocument()
    expect(screen.queryByText(/upstream が未設定です/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '初回 push（upstream を設定）' })
    ).not.toBeInTheDocument()
  })

  it('upstream の無いブランチでは upstream のバナーを出し、設定済みなら出さない', () => {
    const { rerender } = render(
      <SourceControlPanel {...baseProps} gitStatus={{ ...repoStatus, upstream: null }} />
    )
    expect(screen.getByText('upstream が未設定です（main）')).toBeInTheDocument()
    rerender(<SourceControlPanel {...baseProps} gitStatus={repoStatus} />)
    expect(screen.queryByText('upstream が未設定です（main）')).not.toBeInTheDocument()
  })

  // 初回 push の成功の後は、ツールバーの「プッシュ」へ移す(パネルの中の印の付いたボタン)。要求の state は
  // このパネルの useRemoteSetupFocus が持ち、バナーへ requestFocus を渡す(移す条件はフックのテストで確かめる)
  it('バナーの初回 push に成功すると、バナーが消えた後にツールバーの「プッシュ」へフォーカスを移す', async () => {
    const remoteSetup = makeRemoteSetupPanelState()
    let resolvePush: (succeeded: boolean) => void = () => {}
    remoteSetup.pushSetUpstream = () =>
      new Promise<boolean>((resolve) => {
        resolvePush = resolve
      })
    const noUpstream = { ...repoStatus, upstream: null }
    const { rerender } = render(
      <SourceControlPanel {...baseProps} gitStatus={noUpstream} remoteSetup={remoteSetup} />
    )
    await userEvent.click(screen.getByRole('button', { name: '初回 push（upstream を設定）' }))
    // 実物では、成功の取り直しで upstream が付きバナーが消え、押したボタンにあったフォーカスは body に落ちる
    rerender(<SourceControlPanel {...baseProps} gitStatus={repoStatus} remoteSetup={remoteSetup} />)
    expect(document.body).toHaveFocus()
    await act(async () => resolvePush(true))
    expect(screen.getByRole('button', { name: 'プッシュ' })).toHaveFocus()
  })
})
```

（`repoStatus` は Task 2 のスクリプトで `hasOrigin: true` / `upstream: 'origin/main'` / `detached: false` を持つ。）

`src/renderer/src/components/__tests__/Sidebar.test.tsx`:

- import に `import { makeRemoteSetupPanelState } from '../../__tests__/makeRemoteSetupPanelState'` を足す
- `defaultProps` の `gitTag: makeGitTagPanelState(),` の後に `remoteSetup: makeRemoteSetupPanelState(),` を足す
- 追加（`source-control: gitTag が履歴セクションまで届く` の後）:

```tsx
it('source-control: remoteSetup がバナーまで届く', async () => {
  const remoteSetup = makeRemoteSetupPanelState()
  render(
    <Sidebar
      activePanel="source-control"
      {...defaultProps}
      gitStatus={{
        isRepo: true,
        mergeInProgress: false,
        hasOrigin: false,
        hasRemote: false,
        upstream: null,
        detached: false,
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: []
      }}
      remoteSetup={remoteSetup}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: 'リモートを追加' }))
  expect(remoteSetup.clearAddOriginError).toHaveBeenCalledOnce()
})
```

`src/renderer/src/hooks/__tests__/useAppState.test.ts`:

- import に `import { makeRemoteSetupPanelState } from '../../__tests__/makeRemoteSetupPanelState'` を足す
- `mockUseGitTagOperations` の定義の後に追加:

```ts
// 初期化・追加の組み立ては useGitRemoteSetup.test.ts で検証する。ここでは配線(依存の受け渡しと、初回 push の
// 状態との合成)だけを見る。戻り値はテスト内で makeRemoteSetupPanelState から作って渡す(パターン 78)。
// 他のテストでは既定の undefined のままでよい(合成は spread のため undefined でも落ちない)
const mockUseGitRemoteSetup = vi.hoisted(() =>
  vi.fn<typeof import('../useGitRemoteSetup').useGitRemoteSetup>()
)
```

- `vi.mock('../useGitTagOperations', …)` の次に `vi.mock('../useGitRemoteSetup', () => ({ useGitRemoteSetup: mockUseGitRemoteSetup }))` を足す
- `describe('gitTag(タグの作成)', …)` の後に追加:

```ts
describe('remoteSetup(初期化・origin の追加・初回 push)', () => {
  const repoStatus: GitStatusResult = {
    isRepo: true,
    mergeInProgress: false,
    hasOrigin: true,
    hasRemote: true,
    upstream: null,
    detached: false,
    branch: 'main',
    ahead: 0,
    behind: 0,
    files: []
  }

  const setupStatusAndHistory = (): {
    refreshGitStatus: ReturnType<typeof vi.fn<() => Promise<void>>>
    refreshHistory: ReturnType<typeof vi.fn<() => Promise<void>>>
  } => {
    const refreshGitStatus = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const refreshHistory = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    mockUseGitStatus.mockReturnValue({
      gitStatus: repoStatus,
      gitLoading: false,
      gitError: null,
      refreshGitStatus
    })
    mockUseGitHistory.mockReturnValue({
      log: [],
      branches: [],
      tags: [],
      hasMore: false,
      isLoading: false,
      loadMore: vi.fn(),
      refresh: refreshHistory
    })
    return { refreshGitStatus, refreshHistory }
  }

  it('useGitRemoteSetup に gitStatus・ステータスと履歴の再取得・共有ロックを渡し、初回 push の状態と合わせて公開する', () => {
    const { refreshGitStatus, refreshHistory } = setupStatusAndHistory()
    const setupState = makeRemoteSetupPanelState()
    mockUseGitRemoteSetup.mockReturnValue(setupState)
    const { result } = renderHook(() => useAppState())
    expect(mockUseGitRemoteSetup).toHaveBeenCalledWith(
      repoStatus,
      refreshGitStatus,
      refreshHistory,
      expect.anything()
    )
    // 他の Git 操作と同じロックを渡す(別のロックだと、commit などの途中でも初期化・追加できてしまう)
    const sharedLock = mockUseStashPanel.mock.calls[0][0].fileOperationLock
    expect(mockUseGitRemoteSetup.mock.calls[0][3]).toBe(sharedLock)
    const { remoteSetup } = result.current
    expect(remoteSetup.initRepository).toBe(setupState.initRepository)
    expect(remoteSetup.addOrigin).toBe(setupState.addOrigin)
    // 初回 push の 5 項目は useGitRemoteOperations のもの
    expect(remoteSetup.pushSetUpstream).toBe(result.current.pushSetUpstream)
    expect(remoteSetup.isSettingUpstream).toBe(false)
    expect(remoteSetup.isPushing).toBe(result.current.isPushing)
    expect(remoteSetup.isPushBlocked).toBe(result.current.isPushBlocked)
    expect(remoteSetup.remoteOperationError).toBe(result.current.remoteOperationError)
  })

  // useGitRemoteOperations の 4 番目の引数(refreshHistory)を渡していることを、実物のフックで確かめる(差分 3)
  it('初回 push の後に、ステータスと履歴を取り直す', async () => {
    const { refreshGitStatus, refreshHistory } = setupStatusAndHistory()
    const originalPushSetUpstream = window.api.pushSetUpstream
    window.api.pushSetUpstream = vi.fn().mockResolvedValue(undefined)
    try {
      const { result } = renderHook(() => useAppState())
      await act(async () => {
        await result.current.remoteSetup.pushSetUpstream()
      })
      expect(window.api.pushSetUpstream).toHaveBeenCalledOnce()
      expect(refreshGitStatus).toHaveBeenCalled()
      expect(refreshHistory).toHaveBeenCalled()
    } finally {
      window.api.pushSetUpstream = originalPushSetUpstream
    }
  })
})
```

`src/renderer/src/components/source-control/__tests__/RemoteSetupFlow.test.tsx`（実物のフック・`SourceControlPanel` を結合し、保留 → 操作 → 解決の順で確かめる。パターン 85・86）:

```tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitStatusResult } from '@shared/types'

vi.mock('../../../lib/gitApi')

import * as gitApi from '../../../lib/gitApi'
import SourceControlPanel from '../SourceControlPanel'
import { useGitRemoteOperations } from '../../../hooks/useGitRemoteOperations'
import { useGitRemoteSetup } from '../../../hooks/useGitRemoteSetup'
import type {
  DiscardAllState,
  MergeStatePanelState,
  RemoteSetupPanelState,
  StashPanelState
} from '../../../types'
import { makeGitTagPanelState } from '../../../__tests__/makeGitTagPanelState'

const emptyStash: StashPanelState = {
  entries: [],
  pendingOperation: null,
  error: null,
  onPush: vi.fn().mockResolvedValue(undefined),
  onPop: vi.fn().mockResolvedValue(undefined),
  onDrop: vi.fn().mockResolvedValue(true)
}

const emptyMergeState: MergeStatePanelState = {
  inProgress: false,
  unresolvedCount: 0,
  pendingOperation: null,
  error: null,
  canComplete: false,
  onComplete: vi.fn().mockResolvedValue(undefined),
  onAbort: vi.fn().mockResolvedValue(undefined)
}

const emptyDiscardAll: DiscardAllState = {
  isDiscarding: false,
  error: null,
  onDiscardAll: vi.fn().mockResolvedValue(undefined)
}

// リモートの操作以外の Props(この結合テストでは使わない)
const otherProps = {
  gitLoading: false,
  gitError: null,
  onRefresh: vi.fn(),
  stagingPaths: new Set<string>(),
  onStage: vi.fn(),
  onDiscard: vi.fn(),
  onUnstage: vi.fn(),
  onOpenDiff: vi.fn(),
  isCommitting: false,
  onCommit: vi.fn().mockResolvedValue(true),
  lastCommitMessage: null,
  onAmend: vi.fn().mockResolvedValue(true),
  log: [],
  branches: [],
  tags: [],
  hasMoreLog: false,
  isLoadingLog: false,
  isLoadingFolder: false,
  historyError: null,
  onLoadMoreLog: vi.fn(),
  operationError: null,
  pendingBranchOperation: null,
  onCheckoutBranch: vi.fn().mockResolvedValue(undefined),
  onCreateBranch: vi.fn().mockResolvedValue(true),
  onDeleteBranch: vi.fn().mockResolvedValue(true),
  onMergeBranch: vi.fn().mockResolvedValue(undefined),
  stash: emptyStash,
  discardAll: emptyDiscardAll,
  mergeState: emptyMergeState,
  gitTag: makeGitTagPanelState(),
  branchOperationError: null
}

const configured: GitStatusResult = {
  isRepo: true,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [],
  mergeInProgress: false,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/main',
  detached: false
}
const notRepo: GitStatusResult = {
  ...configured,
  isRepo: false,
  branch: null,
  hasOrigin: false,
  hasRemote: false,
  upstream: null
}
const noOrigin: GitStatusResult = {
  ...configured,
  hasOrigin: false,
  hasRemote: false,
  upstream: null
}
const noUpstream: GitStatusResult = { ...configured, upstream: null }

// refreshGitStatus が次に返すステータス。操作を解決する前に、テストが「main の処理の後の状態」に差し替える
let nextStatus: GitStatusResult = configured

// useAppState の合成(remoteSetup)と同じ形で、実物の 2 つのフックを SourceControlPanel に渡す
function Harness({ initial }: { initial: GitStatusResult }): React.JSX.Element {
  const [gitStatus, setGitStatus] = useState(initial)
  const refreshGitStatus = useCallback(async (): Promise<void> => {
    setGitStatus(nextStatus)
  }, [])
  const refreshHistory = useCallback(async (): Promise<void> => {}, [])
  const remoteOps = useGitRemoteOperations(gitStatus, refreshGitStatus, undefined, refreshHistory)
  const setup = useGitRemoteSetup(gitStatus, refreshGitStatus, refreshHistory)
  const remoteSetup: RemoteSetupPanelState = {
    ...setup,
    isSettingUpstream: remoteOps.isSettingUpstream,
    isPushing: remoteOps.isPushing,
    isPushBlocked: remoteOps.isPushBlocked,
    remoteOperationError: remoteOps.remoteOperationError,
    pushSetUpstream: remoteOps.pushSetUpstream
  }
  return (
    <SourceControlPanel
      {...otherProps}
      gitStatus={gitStatus}
      isPushing={remoteOps.isPushing}
      isPulling={remoteOps.isPulling}
      isFetching={remoteOps.isFetching}
      isPushBlocked={remoteOps.isPushBlocked}
      isPullBlocked={remoteOps.isPullBlocked}
      isRemoteOperationDisabled={remoteOps.isRemoteOperationDisabled}
      onPush={remoteOps.push}
      onPull={remoteOps.pull}
      onFetch={remoteOps.fetchRemote}
      remoteOperationError={remoteOps.remoteOperationError}
      remoteSetup={remoteSetup}
    />
  )
}

type Pending = { resolve: () => void; reject: (err: Error) => void }

// 次の 1 回の呼び出しを保留させ、解決・失敗を後から起こせるようにする
const holdNext = (setImpl: (impl: () => Promise<void>) => void): Pending => {
  const handlers: Pending = { resolve: () => {}, reject: () => {} }
  setImpl(
    () =>
      new Promise<void>((resolve, reject) => {
        handlers.resolve = () => resolve()
        handlers.reject = reject
      })
  )
  return { resolve: () => handlers.resolve(), reject: (err) => handlers.reject(err) }
}

// ブラウザは disabled になった入力欄からフォーカスを外し body に落とす。jsdom は外さず、disabled の要素の blur() も
// 無視するため、外の要素を経由して body に落とした状態を再現する
const dropFocusToBody = (): void => {
  const outside = document.createElement('input')
  document.body.appendChild(outside)
  act(() => {
    outside.focus()
    outside.blur()
  })
  outside.remove()
}

beforeEach(() => {
  vi.clearAllMocks()
  nextStatus = configured
})

describe('リモートの管理の流れ(実物のフックと SourceControlPanel)', () => {
  it('初期化: 実行中は閉じられず、成功するとリポジトリの表示に変わり「リモートを追加」へフォーカスが移る', async () => {
    const pending = holdNext((impl) =>
      vi.mocked(gitApi.initRepository).mockImplementationOnce(impl)
    )
    render(<Harness initial={notRepo} />)
    await userEvent.click(screen.getByRole('button', { name: 'リポジトリを初期化' }))
    await userEvent.keyboard('{Enter}')
    expect(gitApi.initRepository).toHaveBeenCalledWith('main')
    expect(screen.getByRole('button', { name: '初期化中...' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('初期化中です')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'ブランチ名' }), { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'リポジトリを初期化' })).toBeInTheDocument()

    // act の中で解決すると、実機の「描画の後でフォーカスを移す」順序が再現しない。act の外で解決し、
    // React の通常のスケジューラで再描画させる(パターン 86)
    nextStatus = noOrigin
    pending.resolve()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'リモートを追加' })).toHaveFocus()
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('リモートが未設定です')).toBeInTheDocument()
  })

  it('初期化: 失敗はダイアログ内に alert で出て入力欄へフォーカスが戻り、再試行の実行中は alert が消える', async () => {
    const first = holdNext((impl) => vi.mocked(gitApi.initRepository).mockImplementationOnce(impl))
    render(<Harness initial={notRepo} />)
    await userEvent.click(screen.getByRole('button', { name: 'リポジトリを初期化' }))
    await userEvent.keyboard('{Enter}')
    dropFocusToBody()
    nextStatus = notRepo
    await act(async () => {
      first.reject(new Error('ブランチ名として使用できない名前です: main'))
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'ブランチ名として使用できない名前です: main'
    )
    expect(screen.getByRole('textbox', { name: 'ブランチ名' })).toHaveFocus()

    const second = holdNext((impl) => vi.mocked(gitApi.initRepository).mockImplementationOnce(impl))
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('初期化中です')
    await act(async () => {
      second.reject(new Error('ブランチ名として使用できない名前です: main'))
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'ブランチ名として使用できない名前です: main'
    )
  })

  // 初期化は成功したが直後のステータスの取り直しが失敗した(握りつぶされ、Git 管理外の表示のまま)場合、移す先の
  // 「リモートを追加」が無い。フォーカスを body に落とさず、開いたボタンへ戻す
  it('初期化: 成功しても取り直し後に Git 管理外のままなら、「リポジトリを初期化」へフォーカスを戻す', async () => {
    const pending = holdNext((impl) =>
      vi.mocked(gitApi.initRepository).mockImplementationOnce(impl)
    )
    render(<Harness initial={notRepo} />)
    await userEvent.click(screen.getByRole('button', { name: 'リポジトリを初期化' }))
    await userEvent.keyboard('{Enter}')
    nextStatus = notRepo
    pending.resolve()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'リポジトリを初期化' })).toHaveFocus()
    )
    expect(screen.queryByRole('button', { name: 'リモートを追加' })).not.toBeInTheDocument()
  })

  it('初期化: 実行中に利用者が別の要素へ移していたら、成功してもフォーカスを奪わない', async () => {
    const pending = holdNext((impl) =>
      vi.mocked(gitApi.initRepository).mockImplementationOnce(impl)
    )
    render(<Harness initial={notRepo} />)
    await userEvent.click(screen.getByRole('button', { name: 'リポジトリを初期化' }))
    await userEvent.keyboard('{Enter}')
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    try {
      act(() => outside.focus())
      nextStatus = noOrigin
      pending.resolve()
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      // 否定のアサーションは、遅れて走る effect がフォーカスを奪うのを見逃さないよう、描画をもう 1 回待ってから評価する
      await act(async () => {})
      expect(outside).toHaveFocus()
    } finally {
      outside.remove()
    }
  })

  it('追加: 成功するとバナーが upstream の未設定に変わり「初回 push（upstream を設定）」へフォーカスが移る', async () => {
    vi.mocked(gitApi.addOrigin).mockResolvedValue(undefined)
    render(<Harness initial={noOrigin} />)
    await userEvent.click(screen.getByRole('button', { name: 'リモートを追加' }))
    nextStatus = noUpstream
    await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), '/abs/bare.git{Enter}')
    expect(gitApi.addOrigin).toHaveBeenCalledWith('/abs/bare.git')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '初回 push（upstream を設定）' })).toHaveFocus()
    )
    expect(screen.getByText('upstream が未設定です（main）')).toBeInTheDocument()
  })

  it('初回 push: 実行中はバナーとツールバーが push 中になり、成功するとバナーが消えて「プッシュ」へフォーカスが移る', async () => {
    const pending = holdNext((impl) =>
      vi.mocked(gitApi.pushSetUpstream).mockImplementationOnce(impl)
    )
    render(<Harness initial={noUpstream} />)
    await userEvent.click(screen.getByRole('button', { name: '初回 push（upstream を設定）' }))
    expect(screen.getByRole('button', { name: 'push 中' })).toBeDisabled()
    expect(
      screen.getByText('初回 push 中です。応答が 30 秒途絶えると打ち切ります')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'プッシュ中' })).toBeDisabled()

    nextStatus = configured
    pending.resolve()
    await waitFor(() => expect(screen.getByRole('button', { name: 'プッシュ' })).toHaveFocus())
    expect(screen.queryByText('upstream が未設定です（main）')).not.toBeInTheDocument()
  })

  it('初回 push: 失敗はパネル上部に出て、バナーは残る', async () => {
    vi.mocked(gitApi.pushSetUpstream).mockRejectedValue(
      new Error('コミットが無いため、初回 push できません。先にコミットしてください')
    )
    nextStatus = noUpstream
    render(<Harness initial={noUpstream} />)
    await userEvent.click(screen.getByRole('button', { name: '初回 push（upstream を設定）' }))
    expect(
      await screen.findByText('コミットが無いため、初回 push できません。先にコミットしてください')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '初回 push（upstream を設定）' })).toBeEnabled()
  })
})
```

```bash
npx vitest run src/renderer
```

Expected: FAIL（`useRemoteSetupFocus` が無い、`remoteSetup` が配線されていない、ツールバーに印が無い）

- [ ] **Step 2: 配線する**

`src/renderer/src/hooks/useRemoteSetupFocus.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { RemoteSetupFocusTarget } from '../lib/remoteSetupState'

// 成功の後に、次の操作のボタンへフォーカスを移す(初期化 → 「リモートを追加」、追加 → 「初回 push（upstream を設定）」、
// 初回 push → ツールバーの「プッシュ」)。移す先は rootRef の中の data-remote-setup-focus="<target>" の要素。
// 要求の state もここで持つ(UI の振る舞いで、Git 操作のフックとは変わる理由が違う。要求する部品
// (NotRepositoryView・RemoteSetupBanner)も移す先も、rootRef を持つ SourceControlPanel の配下にある)。
// 要求は、成功を受け取った部品がダイアログを閉じるのと同じ描画で出す(差分 4)ため、この useEffect が走る時点では、
// 閉じたダイアログ・消えたボタンにあったフォーカスは body に落ちている。移すのはフォーカスが body のときだけ
// (利用者が移した先を奪わない)で、移す先が無い・disabled のときは何もしない(例: 追加の後に detached で
// バナーが出ない)。どの場合も要求は 1 回だけ扱う(後から現れたボタンへ遅れて移さない。パターン 86)。
// そのため要求は呼ぶたびに新しいオブジェクトにし(同じ先を続けて要求しても effect が走る)、effect は要求が
// 変わったときだけ走る(effect の中で要求を消す setState は不要)
export function useRemoteSetupFocus(rootRef: RefObject<HTMLElement | null>): {
  /** 成功を受け取った部品が、ダイアログを閉じるのと同じ描画で呼ぶ。参照は描画をまたいで変わらない */
  requestFocus: (target: RemoteSetupFocusTarget) => void
} {
  const [focusRequest, setFocusRequest] = useState<{ target: RemoteSetupFocusTarget } | null>(null)
  // 子の部品へ props で渡すため、参照を固定する
  const requestFocus = useCallback((target: RemoteSetupFocusTarget): void => {
    setFocusRequest({ target })
  }, [])

  useEffect(() => {
    if (focusRequest === null) return
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    const target = rootRef.current?.querySelector<HTMLButtonElement>(
      `[data-remote-setup-focus="${focusRequest.target}"]`
    )
    if (target === null || target === undefined || target.disabled) return
    target.focus()
  }, [rootRef, focusRequest])

  return { requestFocus }
}
```

`src/renderer/src/components/source-control/SourceControlToolbar.tsx` のプッシュボタンに、`className="source-control-panel__push-btn"` の次の行として `data-remote-setup-focus={'push' satisfies RemoteSetupFocusTarget}` を足す（初回 push の成功の後のフォーカスの移し先。useRemoteSetupFocus が探す、とコメントを付ける。値は `satisfies` で `RemoteSetupFocusTarget` と型で結び、綴りの食い違いを typecheck で検出する。パターン 88。ファイルの先頭に `import type { RemoteSetupFocusTarget } from '../../types'` を足す）:

```tsx
<button
  type="button"
  className="source-control-panel__push-btn"
  // 初回 push の成功の後のフォーカスの移し先(useRemoteSetupFocus が探す)。値は RemoteSetupFocusTarget と型で結ぶ
  data-remote-setup-focus={'push' satisfies RemoteSetupFocusTarget}
  onClick={onPush}
  disabled={isRemoteOperationDisabled || isPushing || isPushBlocked}
  aria-label={isPushing ? 'プッシュ中' : 'プッシュ'}
>
  {isPushing ? 'プッシュ中...' : 'プッシュ'}
</button>
```

`src/renderer/src/components/source-control/GitRepoView.tsx`:

- import に `import RemoteSetupBanner from './RemoteSetupBanner'` と `import type { RemoteSetupKind } from '../../lib/remoteSetupState'` を足し、`import type { … } from '../../types'` に `RemoteSetupPanelState` を足す
- Props の `gitTag: GitTagPanelState` の後に追加:

```ts
/** リモートの状態バナーの種類(getRemoteSetupState(gitStatus)。SourceControlPanel が導出する) */
remoteSetupKind: RemoteSetupKind | null
/** リモートの管理の状態と操作(状態バナーの「リモートを追加」「初回 push」とダイアログ) */
remoteSetup: RemoteSetupPanelState
```

- （単一責任のレビューで追加）Props の `remoteSetup` の後に、追加・初回 push の成功の後のフォーカスの要求を足す（`RemoteSetupFocusTarget` は `lib/remoteSetupState` から import する）:

```ts
/** 追加・初回 push の成功の後に、次の操作のボタンへのフォーカスを要求する(SourceControlPanel の useRemoteSetupFocus) */
requestRemoteSetupFocus: (target: RemoteSetupFocusTarget) => void
```

- 分割代入の `gitTag` の後に `remoteSetupKind,` `remoteSetup,` `requestRemoteSetupFocus` を足し、`<MergeBanner … />` の直後に追加:

```tsx
<RemoteSetupBanner
  kind={remoteSetupKind}
  branch={branch}
  remoteSetup={remoteSetup}
  requestFocus={requestRemoteSetupFocus}
  isBlocked={isBlockedByOtherOperation}
/>
```

`src/renderer/src/components/source-control/SourceControlPanel.tsx`:

- import に次を足し、`import type { … } from '../../types'` に `RemoteSetupPanelState` を足す:

```ts
import { useRef } from 'react'
import NotRepositoryView from './NotRepositoryView'
import { getRemoteSetupState } from '../../lib/remoteSetupState'
import { useRemoteSetupFocus } from '../../hooks/useRemoteSetupFocus'
```

- Props の `gitTag: GitTagPanelState` の後に `remoteSetup: RemoteSetupPanelState`、分割代入の `gitTag,` の後に `remoteSetup,` を足す
- 関数の先頭（`return` の前）に追加:

```ts
// 初期化・追加・初回 push の成功の後に、次の操作のボタン(このパネルの中にある)へフォーカスを移す。
// 要求する部品(NotRepositoryView・RemoteSetupBanner)へ requestFocus を渡す
const rootRef = useRef<HTMLDivElement>(null)
const { requestFocus: requestRemoteSetupFocus } = useRemoteSetupFocus(rootRef)
```

- `<div className="source-control-panel">` を `<div className="source-control-panel" ref={rootRef}>` にする
- `<p className="source-control-panel__no-repo">Git リポジトリではありません</p>` を次に置き換える:

```tsx
<NotRepositoryView
  remoteSetup={remoteSetup}
  isBlocked={isAnyLocked()}
  requestFocus={requestRemoteSetupFocus}
/>
```

- `<GitRepoView … gitTag={gitTag} />` に `remoteSetupKind={getRemoteSetupState(gitStatus)}`・`remoteSetup={remoteSetup}`・`requestRemoteSetupFocus={requestRemoteSetupFocus}` を足す

`src/renderer/src/components/Sidebar.tsx`: import type に `RemoteSetupPanelState`、Props の `gitTag: GitTagPanelState` の後に `remoteSetup: RemoteSetupPanelState`、分割代入の `gitTag,` の後に `remoteSetup,`、`<SourceControlPanel … gitTag={gitTag} remoteSetup={remoteSetup} … />`。

`src/renderer/src/App.tsx`: `useAppState()` の分割代入の `gitTag,` の後に `remoteSetup,` を足し、`<Sidebar … gitTag={gitTag} remoteSetup={remoteSetup} … />`。

`src/renderer/src/hooks/useAppState.ts`:

- import に `import { useGitRemoteSetup } from './useGitRemoteSetup'` を足し、`import type { … } from '../types'` に `RemoteSetupPanelState` を足す
- `AppState` の型の `gitTag: GitTagPanelState` の後に追加:

```ts
/** リモートの管理の状態と操作(Git 管理外の「リポジトリを初期化」、状態バナーの「リモートを追加」「初回 push」) */
remoteSetup: RemoteSetupPanelState
```

- `const gitRemoteOperations = useGitRemoteOperations(…)` の呼び出しを、`const gitHistory = useGitHistory(fileSystem.folderPath)` の直後へ移し、次にする（初回 push の後に履歴も取り直すため、`gitHistory` の後に置く）:

```ts
// 初回 push(pushSetUpstream)の後は upstream と履歴のリモートの ref が変わるため、履歴も取り直す(差分 3)。
// 履歴の再取得(gitHistory.refresh)に依存するため、gitHistory より後に配置する
const gitRemoteOperations = useGitRemoteOperations(
  git.gitStatus,
  git.refreshGitStatus,
  fileOperationLock,
  gitHistory.refresh
)
```

- `const gitTag = useGitTagOperations(…)` の後に追加:

```ts
// 初期化・origin の追加。他の Git 操作の途中は実行しないよう、同じロックを渡す(ロック自体は取らない)
const gitRemoteSetup = useGitRemoteSetup(
  git.gitStatus,
  git.refreshGitStatus,
  gitHistory.refresh,
  fileOperationLock
)
// 初回 push は push と実行中フラグ・エラーの表示先を共有するため useGitRemoteOperations が持つ。
// バナーに渡す状態として 1 つにまとめる(差分 8)
const remoteSetup: RemoteSetupPanelState = {
  ...gitRemoteSetup,
  isSettingUpstream: gitRemoteOperations.isSettingUpstream,
  isPushing: gitRemoteOperations.isPushing,
  isPushBlocked: gitRemoteOperations.isPushBlocked,
  remoteOperationError: gitRemoteOperations.remoteOperationError,
  pushSetUpstream: gitRemoteOperations.pushSetUpstream
}
```

- 戻り値の `gitTag,` の後に `remoteSetup,` を足す

```bash
npx vitest run src/renderer
npm run typecheck
```

Expected: PASS（typecheck も成功。App の配線は `Sidebar` の必須 Props で typecheck が固定する）

- [ ] **Step 3: ミューテーション**

1. `useRemoteSetupFocus` の `if (active !== null && active !== document.body) return` を外す → 「利用者が別の要素へ移していたら奪わない」と、結合の「初期化: …フォーカスを奪わない」
2. （単一責任のレビューで変更）`requestFocus` が同じ先なら前の要求を使い回す（`prev?.target === target ? prev : { target }`）→ 「同じ先を続けて要求しても、毎回移す」。effect の依存を外して毎回の描画で走らせる → 「移す先が無ければ何もせず、後から現れても移さない」「disabled なら移さず、後から押せるようになっても移さない」。`requestFocus` の `useCallback` を外す → 「requestFocus の参照は再描画で変わらない」
3. `target.disabled` の判定を外す → 「移す先が disabled なら移さない」
4. ツールバーの `data-remote-setup-focus` を外す → ツールバーのテスト、SourceControlPanel の「バナーの初回 push に成功すると…「プッシュ」へフォーカスを移す」、結合の初回 push
5. `GitRepoView` で `isBlocked={false}` を渡す → 「他の操作中は、バナーのボタンが押せない」。`RemoteSetupBanner` を `MergeBanner` の前に置く → 「マージのバナーの直後に」
6. `SourceControlPanel` の `useRemoteSetupFocus` の呼び出しを外す → 同じ SourceControlPanel のテストと結合の 3 つのフォーカスのテスト。`GitRepoView` / `NotRepositoryView` へ `() => {}` を渡す → それぞれ同じ SourceControlPanel のテスト・GitRepoView の「requestRemoteSetupFocus がバナーまで届く」と、結合の初期化のテスト
7. `useAppState` の `useGitRemoteOperations` に `gitHistory.refresh` を渡さない → 「初回 push の後に、ステータスと履歴を取り直す」
8. `useAppState` の `useGitRemoteSetup` に `git.refreshGitStatus` を 2 回渡す（`refreshHistory` の代わり）→ useAppState の配線のテスト
9. `NotRepositoryView`（Task 7）の `dialog.close()` と `requestFocus` の順序を入れ替える → 落ちないこと（同じ描画に入る）を確かめ、`requestFocus` を `await` の前（`initRepository` を呼ぶ前）に出す変異では結合の初期化のテストが落ちる（ダイアログが開いている描画で要求が処理され、捨てられる）
10. （実装時に追加）`GitRepoView` で `isBlocked={true}` を渡す → 「他の操作が無ければ、バナーのボタンを押せる」（追加したテスト）。`SourceControlPanel` で `NotRepositoryView` に `isBlocked={false}` を渡す → 「Git 管理外で他の操作中(isAnyLocked)は、初期化のダイアログの「初期化」が押せない」（追加）。`remoteSetupKind={null}` を渡す → バナーの 3 つのテスト。`useAppState` の合成で `isSettingUpstream` と `isPushing` を取り違える → 「ツールバーの push の実行中は、remoteSetup の isPushing だけが真になる」（追加。両方が false の状態だけでは区別できないため）。`RemoteSetupBanner` の失敗の後のフォーカスの復帰（Task 7 のレビューで追加）を外す → 結合の「初回 push: 失敗して実行中が解けたら、フォーカスがバナーのボタンへ戻る」（追加）
11. （Task 8 のレビューで追加）`data-remote-setup-focus` の値の綴りを変える（`'pushx'`・`'add-remot'`）→ typecheck が `TS1360`（`satisfies` を満たさない）で落ちる。`useRemoteSetupFocus` の `active` の判定を外す → 結合の「初期化: …フォーカスを奪わない」（否定のアサーションの前に描画をもう 1 回待つ形にした）
12. 3 の `target.disabled` の判定を外す変異は落ちない（等価な変異。`useFocusOnRunningEnd` の `target.disabled` の判定も同じ）。jsdom もブラウザも disabled のボタンへの `focus()` を無視するため、判定の有無で振る舞いが変わらない。判定は意図を明示するために残す

- [ ] **Step 4: 検証**

```bash
npx vitest run src/renderer
npm run typecheck
npx eslint src/renderer/src/hooks/useRemoteSetupFocus.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/components/source-control/SourceControlToolbar.tsx src/renderer/src/components/source-control/GitRepoView.tsx src/renderer/src/components/source-control/SourceControlPanel.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx src/renderer/src/hooks/__tests__/useRemoteSetupFocus.test.tsx src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/components/source-control/__tests__/SourceControlToolbar.test.tsx src/renderer/src/components/source-control/__tests__/GitRepoView.test.tsx src/renderer/src/components/source-control/__tests__/SourceControlPanel.test.tsx src/renderer/src/components/source-control/__tests__/RemoteSetupFlow.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx
npx prettier --check src/renderer/src/hooks/useRemoteSetupFocus.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/components/source-control/SourceControlToolbar.tsx src/renderer/src/components/source-control/GitRepoView.tsx src/renderer/src/components/source-control/SourceControlPanel.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx src/renderer/src/hooks/__tests__/useRemoteSetupFocus.test.tsx src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/components/source-control/__tests__/SourceControlToolbar.test.tsx src/renderer/src/components/source-control/__tests__/GitRepoView.test.tsx src/renderer/src/components/source-control/__tests__/SourceControlPanel.test.tsx src/renderer/src/components/source-control/__tests__/RemoteSetupFlow.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx
```

Expected: すべて成功

- [ ] **Step 5: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 9: ROADMAP の確認・テスト仕様書への追記と Artifact の再公開・全体検証

**Files:**

- Modify: `docs/manual-test-spec.md`
- 確認のみ: `ROADMAP.md`（このブランチで更新済み）

**Interfaces:**

- Consumes: Task 1〜8 の実装（文言は実装のファイルと突き合わせる）
- Produces: 実機テスト仕様書の領域 `RMT`、再生成した `.superpowers/manual-test-spec.html`

- [ ] **Step 1: ROADMAP を確認する（変更しない）**

`ROADMAP.md` に、実装済みの「リモートの管理（init・origin の追加・初回 push。…）」（117 行目付近）と、未実装の「リポジトリの clone」、見送り項目「複数のリモート、リモートの URL の変更・削除、リモート名の変更」「リモートへの接続の事前確認」「初期化時の最初のコミット・`.gitignore` の作成、`user@` の無い `host:path`」があることを確認する。実装と食い違う記述があれば、コントローラー（親エージェント）に報告する（このタスクでは直さない）。設計書の「ドキュメント」が求める既知の制約 2 件（ツールバーの push の英語のエラー・non-fast-forward の後に pull できない）は、プラン作成の時点では ROADMAP に無かったが、その後「改善・技術的負債」に追記済み（差分 14）。

```bash
grep -n "リモート\|clone\|upstream" ROADMAP.md
npx prettier --check ROADMAP.md
```

- [ ] **Step 2: 実機テスト仕様書に追記する**

`docs/manual-test-spec.md` の `## タグの作成` の領域の最後（`TAG-030` の後、`## 設定` の前）に、次の領域を追加する（実装の文言・挙動と突き合わせた最終版。`GIT-006` の期待結果にも `リポジトリを初期化` ボタンを足す）。書式は仕様書の冒頭と `scripts/build-manual-test-spec.mjs` に従う（1 行 1 項目、ID は `RMT-001` から昇順、手順と期待結果は最初の「→」で区切る）。文言は実装（`NotRepositoryView` / `InitRepositoryDialog` / `AddRemoteDialog` / `RemoteSetupBanner` / `remoteSetupState` / `remoteSetupValidation` / `gitRemoteSetupService` / `gitRemoteTimeout`）と突き合わせて確認する（パターン 65・89）。実機で自信が持てない期待結果は項目にせず、ファイル末尾の HTML コメント（要確認事項）に足す。

```markdown
## リモートの管理

> 前提: 【要 Git リポジトリ】「管理外のフォルダ」は、端末で `cd "$(mktemp -d)" && pwd` を実行して作り、表示されたパスをアプリで開く(フォルダの選択画面では Cmd+Shift+G でパスを入力でき、Cmd+Shift+. で `.git` などの隠しフォルダが表示される)。送り先の bare リポジトリは、別の端末で `BARE="$(mktemp -d)/remote.git" && git init -q --bare --initial-branch=main "$BARE" && echo "$BARE"` を実行して作り、表示された絶対パスを URL に使う(以後もその端末で `$BARE` を使う)。端末での確認は開いたフォルダで行い、端末での変更はパネルの `更新` ボタンで反映する。
> 前提: main プロセスが返したエラーの文言の前には、Electron が付ける英語の前置き `Error invoking remote method '<チャンネル>': Error: ` が付く(IPC を通る全操作に共通の既知の制約。ROADMAP 参照)。以下の期待結果には、前置きの後の文言を書く。
> 前提: 利用者の git の設定で `push.autoSetupRemote` が `true` になっていないこと(`git config --global --get push.autoSetupRemote` が何も出力しない)。

### リポジトリの初期化

- [ ] **RMT-001** 管理外のフォルダを開き、ソース管理パネルを表示する → `Git リポジトリではありません` の下に `リポジトリを初期化` ボタンがある。ツールバーの `フェッチ` `プル` `プッシュ` は押せない
- [ ] **RMT-002** `リポジトリを初期化` を押す → `リポジトリを初期化` のダイアログが開き、`このフォルダに空の Git リポジトリを作成します` の説明、`ブランチ名` の入力欄(値 `main` が全選択された状態でフォーカスあり)、`初期化` と `キャンセル` のボタンが表示される
- [ ] **RMT-003** ダイアログを `キャンセル`・Escape キー・ダイアログの外側のクリックのそれぞれで閉じる → どの方法でもダイアログが閉じ、`リポジトリを初期化` ボタンにフォーカスが戻る。端末で `ls -a` を実行しても `.git` は無い
- [ ] **RMT-004** `ブランチ名` を空にする → `名前を入力してください` が表示され `初期化` が押せない。空白だけでも同じ。`-x` を入力すると `` `-` で始まる名前は使用できません ``、`@` を入力すると `この名前は使用できません` が表示され、どちらも `初期化` が押せない
- [ ] **RMT-005** `ブランチ名` に `a..b` を入力して `初期化` を押す → ダイアログは閉じず、赤字で `ブランチ名として使用できない名前です: a..b` が表示され、`ブランチ名` の入力欄にフォーカスがある。続けて `HEAD` を入力して `初期化` を押すと、前のエラーに代わって `ブランチ名として使用できない名前です: HEAD` が表示される。端末で `ls -a` を実行しても `.git` は無い
- [ ] **RMT-006** RMT-005 のあと `キャンセル` で閉じ、もう一度 `リポジトリを初期化` を押す → 赤字のエラーは残っておらず、`ブランチ名` は `main` に戻っている
- [ ] **RMT-007** `main` のまま `初期化` を押す → ダイアログが閉じ、パネルがリポジトリの表示(ブランチ `main`・`変更はありません`)に切り替わり、ブランチ名の下に `リモートが未設定です` と `リモートを追加` ボタンのバナーが表示され、`リモートを追加` にフォーカスがある。`履歴` にエラーは表示されない。端末で `git symbolic-ref HEAD` が `refs/heads/main`
- [ ] **RMT-008** 別の管理外のフォルダを開き、`ブランチ名` に前後に空白を付けた `  feat/初期  ` を入力して初期化する → パネルがリポジトリの表示に切り替わり、ブランチ名に `feat/初期` が表示される。端末で `git symbolic-ref HEAD` が `refs/heads/feat/初期`
- [ ] **RMT-009** RMT-007 のフォルダの中に端末で `mkdir sub` を実行し、アプリで `sub` フォルダを開く → `リポジトリを初期化` ボタンは無く、親のリポジトリとして表示され、`リモートが未設定です` のバナーが出る。端末で `ls -a sub` に `.git` は無い
- [ ] **RMT-010** 別の管理外のフォルダを開いて `リポジトリを初期化` のダイアログを開いたまま、端末でそのフォルダに `git init -q -b trunk` を実行してから、ダイアログの `初期化` を押す → ダイアログが消え、パネルがリポジトリの表示(ブランチ `trunk`)に変わる。端末で `git symbolic-ref HEAD` は `refs/heads/trunk` のまま(再初期化されない)
- [ ] **RMT-011** 端末で `B2="$(mktemp -d)/other.git" && git init -q --bare "$B2" && echo "$B2"` を実行して別の bare リポジトリを作り、そのフォルダをアプリで開く → `Git リポジトリではありません` と `リポジトリを初期化` が表示される(既知の制約)。`初期化` を押すとダイアログは閉じず、赤字で `このフォルダは既に Git リポジトリ（または親フォルダのリポジトリ）の中にあります` が表示される。端末で `ls -a "$B2"` に `.git` は無い。RMT-007 のフォルダの `.git` フォルダを開いて同じ操作をしても、同じ文言で拒否され、`ls -a .git` に `.git` は無い
- [ ] **RMT-012** 別の管理外のフォルダを開いてから、端末で `rm -rf <そのフォルダのパス>` を実行してフォルダを消し、パネルの `リポジトリを初期化` から `初期化` を押す → ダイアログは閉じず、ダイアログ内に赤字で `フォルダが見つかりません: ` に続けて開いていたフォルダのパスが表示される(ダイアログ内には英語の `Cannot use simple-git on a directory that does not exist` は出ない)

### リモートの状態バナー

- [ ] **RMT-013** 端末で `cd "$(mktemp -d)" && git init -q -b main && git config user.name test && git config user.email test@example.com && echo 1 > a.txt && git add . && git commit -qm first && pwd` を実行してリモートの無いリポジトリを作り、アプリで開く → ブランチ名の下に `リモートが未設定です` と `リモートを追加` のバナーが出る。バナーを閉じるボタンは無く、別のフォルダを開いてから開き直してもバナーは出る
- [ ] **RMT-014** RMT-013 のリポジトリで端末から `git checkout -q --detach` を実行して `更新` を押す → `リモートが未設定です` のバナーは出たまま(origin の追加はブランチに関係しない)。確認後 `git checkout -q main` で戻す
- [ ] **RMT-015** RMT-013 のリポジトリで端末から `git checkout -qb other && echo other > a.txt && git commit -qam other && git checkout -q main && echo mine > a.txt && git commit -qam mine && git merge other` を実行してコンフリクトさせ、`更新` を押す → `マージ中（未解決 1 件）` のバナーの直後に `リモートが未設定です` のバナーが出て、`リモートを追加` は押せる。確認後 `git merge --abort` で戻す

### リモートの追加

> 前提: RMT-007 で初期化したフォルダを開き直して行う(コミットはまだ無い)。

- [ ] **RMT-016** `リモートを追加` を押す → `リモートを追加` のダイアログが開き、`リモート origin を追加します（この時点では接続しません）` の説明と、空の `URL` 入力欄(フォーカスあり)が表示され、`URL を入力してください` が出て `追加` が押せない
- [ ] **RMT-017** `URL` に `https://github.com/a/b.git`・`http://example.com/a.git`・`ssh://git@example.com:22/a.git`・`git://example.com/a`・`git@github.com:a/b.git`・`file:///tmp/a.git`・`/tmp/a.git` を 1 つずつ入力する → どれも検証の文言が出ず、`追加` が押せる(押さずに次へ進む)
- [ ] **RMT-018** `URL` に `ext::sh -c touch% /tmp/pwned`、続けて `https://example.com/a b` を入力する → どちらも ``URL に空白・改行・制御文字・引用符（' " `）は使用できません`` が表示され `追加` が押せない。端末で `printf 'https://example.com/a\xe2\x80\x8bb' | pbcopy` を実行してゼロ幅スペースを含む URL をクリップボードに入れ、`URL` に貼り付けても同じ文言が表示される
- [ ] **RMT-019** `URL` に `ext::sh`・`fd::3`・`../remote.git`・`example.com:repo.git`(`user@` の無い形)・`HTTPS://github.com/a/b.git`・`git://alice:s3cret@example.com/a`(git:// の資格情報)・`https://alice:ghp_DUMMY123@example.com/a/b.git`(https の資格情報)・`https://ghp_DUMMY123@example.com/a/b.git`(トークンだけ)・`http://alice@example.com/a.git`(user だけ)を 1 つずつ入力する → どれも `使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）` が表示され、`追加` が押せない(パスワード入りの URL は追加できない。認証は credential helper に任せる)。`--upload-pack=x` と `-oProxyCommand=x` では `` `-` で始まる URL は使用できません `` が表示され、`追加` が押せない
- [ ] **RMT-020** ダイアログを `キャンセル`・Escape キー・ダイアログの外側のクリックのそれぞれで閉じる → どの方法でもダイアログが閉じ、`リモートを追加` にフォーカスが戻る。端末で `git remote` は何も出力しない
- [ ] **RMT-021** `URL` に前提の bare リポジトリの絶対パス(`echo "$BARE"` の出力)を入力して `追加` を押す → ダイアログが閉じ、バナーが `upstream が未設定です（main）` と `初回 push（upstream を設定）` に変わり、そのボタンにフォーカスがある。端末で `git remote get-url origin` が入力した絶対パス
- [ ] **RMT-022** 別の管理外のフォルダを開いて初期化し、`リモートを追加` で `https://unreachable.invalid/x.git` を `追加` する → 待たずにすぐ追加され(通信しない)、バナーが `upstream が未設定です（main）` に変わる。端末で `git remote get-url origin` が `https://unreachable.invalid/x.git`
- [ ] **RMT-023** 別の管理外のフォルダを開いて初期化し、`リモートを追加` のダイアログを開いたまま、端末で `git remote add origin https://example.com/a.git` を実行してから、ダイアログで `https://example.com/b.git` を `追加` する → ダイアログは閉じず、赤字で `リモート origin は既に設定されています` が表示され、`URL` の入力欄にフォーカスがある。`キャンセル` で閉じるとバナーは `upstream が未設定です（main）` に変わっていて、端末で `git remote get-url origin` は `https://example.com/a.git` のまま

### 初回 push(upstream の設定)と初期化の後の既存の機能

> 前提: RMT-021 のリポジトリ(origin は bare リポジトリ・コミット無し)で、上から順に行う。

- [ ] **RMT-024** `初回 push（upstream を設定）` を押す → パネル上部(ツールバーの下)に赤字で `コミットが無いため、初回 push できません。先にコミットしてください` が表示され、バナーはそのまま残り、`初回 push（upstream を設定）` にフォーカスがある
- [ ] **RMT-025** 端末で `git config user.name test && git config user.email test@example.com && echo 1 > a.txt` を実行して `更新` を押し、`変更` の `a.txt` 行の `+` でステージし、`コミットメッセージ` に `first` を入力して `コミット` を押す → コミットされ、`履歴` の先頭に `first` が表示され、バッジに `main` が出る。`upstream が未設定です（main）` のバナーは残る
- [ ] **RMT-026** `初回 push（upstream を設定）` を押す → RMT-024 の赤字のエラーが消え、バナーが消えて、ツールバーの `プッシュ` にフォーカスがある。端末で `git rev-parse --abbrev-ref main@{upstream}` が `origin/main`、`git --git-dir="$BARE" rev-parse main` が `git rev-parse main` と同じ
- [ ] **RMT-027** 端末で `echo 2 >> a.txt && git commit -qam second` を実行して `更新` を押す → ブランチ名の横に `↑1` が出る。ツールバーの `プッシュ` を押すと `↑1` が消える
- [ ] **RMT-028** ブランチ名ボタンのメニューの `＋ 新しいブランチを作成…` から `topic` を作る → ブランチ名が `topic` に切り替わり、バナー `upstream が未設定です（topic）` が出る。続けて `履歴` の `タグを作成` から名前 `v1` の軽量タグを作ると、`履歴` のバッジに `v1` が加わる
- [ ] **RMT-029** 端末で `git checkout -q --detach` を実行して `更新` を押す → `upstream が未設定です` のバナーは出ない。確認後 `git checkout -q topic` で戻して `更新` を押すとバナーが戻る
- [ ] **RMT-030** `topic` の上で、ツールバーの `プッシュ` を押す → パネル上部に git の英語のエラー(`has no upstream branch` を含む)が表示される(既知の制約)。続けてバナーの `初回 push（upstream を設定）` を押すと送れて、エラーとバナーが消える
- [ ] **RMT-031** 端末で `OTHER="$(mktemp -d)/c" && git clone -q "$BARE" "$OTHER" && git -C "$OTHER" checkout -q -b clash && git -C "$OTHER" -c user.name=o -c user.email=o@example.com commit -q --allow-empty -m other && git -C "$OTHER" push -q origin clash` を実行して別のクローンから `clash` を先に送り、アプリのリポジトリで `git checkout -q -b clash` を実行して `更新` を押し、`初回 push（upstream を設定）` を押す → パネル上部に `初回 push に失敗しました: ` に続く git のエラー(`[rejected]` を含む)が表示され、バナー `upstream が未設定です（clash）` は残り、`初回 push（upstream を設定）` にフォーカスがある。端末で `git config --get branch.clash.remote` は何も出力しない(non-fast-forward の後はアプリから pull できない。既知の制約)
- [ ] **RMT-032** 端末で `git checkout -q -b ghosted && git config branch.ghosted.remote ghost && git config branch.ghosted.merge refs/heads/ghosted` を実行して `更新` を押す → バナー `upstream が未設定です（ghosted）` が出る。`初回 push（upstream を設定）` を押すと、パネル上部に `upstream の設定が既にあるため、初回 push できません（設定先のリモートが無いか、fetch の設定が無いため表示されていません）` が表示される。端末で `git config --get branch.ghosted.remote` は `ghost` のままで、`git --git-dir="$BARE" for-each-ref refs/heads/ghosted` は何も出力しない
- [ ] **RMT-033** 端末で `printf '#!/bin/sh\nsleep 5\n' > .git/hooks/pre-push && chmod +x .git/hooks/pre-push && git checkout -q -b slow` を実行して `更新` を押し、`初回 push（upstream を設定）` を素早く 2 回押す → 約 5 秒間、バナーのボタンが `push 中...` で押せず、バナーに `初回 push 中です。応答が 30 秒途絶えると打ち切ります` が出て、ツールバーは `プッシュ中...` で押せない。5 秒後にバナーが消え、ツールバーの `プッシュ` にフォーカスがあり、エラーは表示されない。確認後 `rm .git/hooks/pre-push` で戻す
- [ ] **RMT-034** 端末で `printf '#!/bin/sh\nexec sleep 40\n' > .git/hooks/pre-push && chmod +x .git/hooks/pre-push && git checkout -q -b hang` を実行して `更新` を押し、`初回 push（upstream を設定）` を押す → 約 30 秒間は `push 中...` と案内のまま、その後案内が消えてパネル上部に `操作がタイムアウトしました。認証情報が未設定か、ネットワークに問題がある可能性があります` が表示され、バナーは残り、`初回 push（upstream を設定）` にフォーカスがある。端末で `git config --get branch.hang.remote` は何も出力しない。確認後 `rm .git/hooks/pre-push` と `pkill -f '^sleep 40$'`(残ったフックの sleep を止める)で戻す

### 見た目

- [ ] **RMT-035** RMT-001 の `リポジトリを初期化` ボタンと、このリポジトリのバナーを見る → 暗色の背景で、バナーの文言は黄色系、ボタンはマージのバナーのボタンと同じ枠付きの見た目(押せない間は半透明)。端末で `git checkout -q -b release/2024.01.15_hotfix_for_customer_contoso_emergency_patch_v2` を実行して `更新` を押すと、バナーの文言はブランチ名の途中で折り返され、パネルの右端からはみ出さない

### 資格情報の伏せ字とオーバーレイのドラッグ

- [ ] **RMT-036** 別の管理外のフォルダを開いて初期化し、`リモートを追加` のダイアログで `URL` に `https://example.com/very/long/path/to/repository.git` を入力して、入力欄の中でマウスのボタンを押したまま、ダイアログの外側(暗い部分)まで動かして離す → ダイアログは閉じず、入力した URL が残っている。続けてダイアログの外側で押して離すと閉じ、`リモートを追加` にフォーカスが戻る
- [ ] **RMT-037** RMT-036 のフォルダの `リモートを追加` で、`URL` に `https://alice:ghp_DUMMY123@example.com/a/b.git` を入力する → `使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）` が表示され `追加` が押せない(パスワード入りの URL は追加できない)。続けて端末から `touch .git/config.lock` を実行し、`URL` に `tok123@example.com:a/b.git`(scp 形式の user)を入力して `追加` を押す → ダイアログは閉じず、赤字で `リモートを追加できませんでした: ` に続く git のエラーが表示され、その中の URL は `***@example.com:a/b.git` になっていて、`tok123` は表示されない。確認後 `rm .git/config.lock` で戻す
- [ ] **RMT-043** RMT-036 のフォルダの `リモートを追加` で、`URL` に `ssh://alice:s3cr%2Fet@example.com/a.git`、続けて `ssh://u:p%20ss@example.com/a.git`、`ssh://u:p%27ss@example.com/a.git`、`ssh://u:p%G1ss@example.com/a.git`、`ssh://u:p%3Ass@example.com/a.git`、`https://alice:s3cr%2Fet@example.com/a.git` を入力する → どれも `使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）` が表示され `追加` が押せない。続けて `ssh://example.com/a%2Fb.git`(path の `%2F`)を入力する → 検証の文言が出ず、`追加` が押せる(押さずに閉じる)
- [ ] **RMT-045** RMT-036 のフォルダの `リモートを追加` で、`URL` に Azure DevOps の「Clone」が出す形の `https://org@dev.azure.com/org/proj/_git/repo` を入力する → `使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）` が表示され `追加` が押せない(userinfo の `org` を user と解析するため)。続けて `org@` を消した `https://dev.azure.com/org/proj/_git/repo` に直す → エラーの表示が消え、`追加` が押せる(押さずに `キャンセル` で閉じる)
```

ファイル末尾の HTML コメント（要確認事項）に、次の行を足す:

```markdown
- RMT の初期化中・追加中の表示(`初期化中...` `追加中...` のボタン、`初期化中です` `追加中です` の案内と `aria-busy`、実行中にダイアログを `キャンセル`・Escape キー・外側のクリックで閉じられないこと、`初期化` `追加` の二重送信が 1 回になること)は、init・remote add が一瞬で終わり目視確認が難しいため項目にしていない(単体・結合テストで確認。実機で未確認)。失敗の直後、ステータスの取り直しが終わるまで実行中のまま案内を出さずエラーだけを出すこと(取り直しの待ち)も同じ理由で項目にしていない
- RMT-010 では、先に端末で作ったリポジトリのため main プロセスは `このフォルダは既に Git リポジトリ（または親フォルダのリポジトリ）の中にあります` で拒否するが、ステータスの取り直しでダイアログごと消えるため文言は見えない想定(実機で未確認)
- RMT-012 で、ステータスの取り直しが失敗したときにパネル上部(ツールバーの下)へ英語の `Cannot use simple-git on a directory that does not exist` が出るか(既存の getGitStatus の挙動)は実機で未確認
- RMT-024・RMT-031・RMT-034 の失敗の後に `初回 push（upstream を設定）` へフォーカスが戻ること、RMT-007・RMT-021・RMT-026・RMT-033 の成功の後のフォーカスの移動は、ボタンが disabled になったときに Electron(Chromium)がフォーカスを body へ落とす前提で、実機で未確認
- URL の改行は、`input type="text"` が貼り付け時に改行を取り除くため画面から入力できず、項目にしていない(main と renderer の単体テスト・main の統合テストで確認)
- RMT-034 は、pre-push フックが出力を出さずに待つ間に打ち切られることを前提にしている(main の統合テストでは 300 ミリ秒の打ち切りで確認。実機の 30 秒は未確認)
```

```bash
npx prettier --write docs/manual-test-spec.md
npx vitest run scripts
node scripts/build-manual-test-spec.mjs
```

Expected: すべて成功（ID の一意性・接頭辞ごとの昇順・書式の検査が通り、`.superpowers/manual-test-spec.html` が再生成される）

- [ ] **Step 3: 全体を検証する**

```bash
npm test
npm run typecheck
git diff --name-only --diff-filter=d | grep -E '\.(tsx?|mjs)$' | xargs npx eslint
git ls-files --others --exclude-standard | grep -E '\.(tsx?|mjs)$' | xargs npx eslint
(git diff --name-only --diff-filter=d; git ls-files --others --exclude-standard) | grep -v '^.gitignore$' | xargs npx prettier --check
git status -s --untracked-files=all
```

Expected: すべて成功。`git status` に、この機能に関係ないファイルや一時ファイル（ミューテーションの退避先・フィクスチャ更新のスクリプトなど）が無いこと

- [ ] **Step 4: Artifact を再公開する（CLAUDE.md のルール）**

`.superpowers/manual-test-spec.html` を同じファイルパス・同じ URL（<manual-test-spec-artifact-url>）で再公開する。これはコントローラー（親エージェント）が行う（実装者のサブエージェントは行わない）。

- [ ] **Step 5: Commit（ユーザーの許可がある場合のみ）**

## Self-Review

**Spec coverage:**

- Git 管理外での初期化（ブランチ名・既定 `main`・全選択・検証・既にリポジトリ・親のリポジトリ・残骸の `.git`・タイムアウト・作成の確認）: Task 1（正規化）・Task 3（名前の検証の共有）・Task 4（`initRepository`）・Task 7（ダイアログ・`NotRepositoryView`）
- origin の追加（許可リスト・長さ・制御文字・`-` 始まり・既存の origin・`remote.origin.fetch` だけの origin・通信しない・作成の確認・URL を文言に出さない）: Task 1（`remoteUrl`）・Task 4（`addOrigin`）・Task 6（ダイアログの検証）・Task 7（ダイアログ・バナー）
- 初回 push（完全な refspec・`--` を使わない・detached・リベース中・コミット無し・upstream が既にある・同名のタグ・`-` 始まりのブランチ・non-fast-forward・利用者の push の設定・タイムアウト・設定の確認）: Task 3（タイムアウト・現在のブランチの切り出し）・Task 4（`pushSetUpstream`）・Task 6（`useGitRemoteOperations`）・Task 7（バナー）
- `getGitStatus` の `hasOrigin` / `upstream` / `detached` と状態の表: Task 2・Task 6（`getRemoteSetupState`）
- 排他・再取得・実行中フラグの解除の順序・再試行の開始時のエラーの消去: Task 6
- 実行中のダイアログ（閉じない 3 経路・`aria-busy` と案内・alert・IME）とフォーカス（キャンセル・成功の後の移動・body のときだけ）: Task 7・Task 8（`useRemoteSetupFocus`・結合テスト）
- IPC の型検証・余分な引数を渡さない・preload: Task 5。配線: Task 8。実機テスト仕様書・ROADMAP の確認: Task 9

**Placeholder scan:** TBD / TODO / 「同様に」なし。各タスクのテストと実装のコードは完全な形で書いた（既存のファイルへの小さな追加は、挿入位置と追加するコードを示した）。

**Type consistency:** `GIT_REMOTE_TIMEOUT_MS` / `normalizeInitialBranchName` / `getRemoteUrlRuleViolation`（Task 1）→ `GitStatusResult` / `hasOriginRemote`（Task 2）→ `assertValidNewBranchName` / `getCurrentBranchRef` / `simpleGitWithRemoteTimeout`（Task 3）→ `initRepository` / `addOrigin` / `pushSetUpstream`（Task 4）→ `git:init` / `git:addOrigin` / `git:pushSetUpstream` / `gitApi.*`（Task 5）→ `RemoteSetupPanelState` / `useGitRemoteSetup` / `useGitRemoteOperations.pushSetUpstream`（Task 6）→ `NotRepositoryView` / `RemoteSetupBanner`（Task 7）→ `remoteSetup` の配線 / `useRemoteSetupFocus`（Task 8）。

**検証の記録:** プラン作成時に、Task 1〜8 のコードを `mktemp -d` に複製したリポジトリへ適用し、`npm test`（284 ファイル・5181 件）・`npm run typecheck`・変更したファイルへの `npx eslint` と `npx prettier --check` が通ることを確認した（実 git 2.50.1・simple-git 3.36.0。統合テストの壊れた `.git` ファイルの失敗から差分 1 を見つけて反映した）。ミューテーションはプラン作成時には実施していない（実装時に各タスクで行う）。
