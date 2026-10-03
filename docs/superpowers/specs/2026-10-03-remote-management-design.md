# リモートの管理（init・origin の追加・初回 push） 設計書

作成日: 2026-10-03 / 対象: ROADMAP の「リモートの管理（新規リポジトリの init・リモートの追加・リポジトリの clone）」のうち init・リモートの追加・初回 push

## 設計書の確認事項（実機と食い違った点・判断に迷った点）

- `git init` は失敗しても中身の無い `.git`（`HEAD` が無い）を残し、既存のリポジトリでは終了コード 0 で再初期化する（`--initial-branch` は無視される）。どちらも実機 git 2.50.1 で確認した。そのため、名前の検証と「既にリポジトリか」の判定は必ず事前に行う
- `git init --initial-branch=` は `HEAD`・`-x`・`@`・`refs/heads/foo` を通す。このため、ブランチの作成と同じ検証（`check-ref-format --branch` の出力が入力と一致すること）を必須にする
- 合意した「lockGlobal を取るのは初回 push のみ（push と同じ）」は、今のコードと食い違う。既存の push は `lockGlobal` を取らず、`lock.isAnyLocked()` が真の間は待つだけである。初回 push も push と同じく取らない
- simple-git の progress プラグインは、引数の末尾に `--progress` を足す。このため `push -u origin -- <branch>` では `--progress` が refspec として扱われて失敗する（実機で確認）。`--` は使わず、完全な refspec の `refs/heads/<b>:refs/heads/<b>` を渡す
- detached HEAD・リベース中を見分けるため、`GitStatusResult` には合意した `hasOrigin`・`upstream` に加えて `detached` も足す（simple-git の `status.detached`。追加の git 呼び出しは無い）
- ツールバーの `プッシュ` は、upstream が無くても事前に拒否しない（`push.default=current`・`push.autoSetupRemote=true` の利用者は、そのまま push できるため）。git の英語のエラーは今のまま出る
- 初回 push がリモートの同名ブランチとの non-fast-forward で拒否されると upstream が設定されず、アプリからは pull できない（upstream が無いため）。ターミナルで解決してもらう。既知の制約として扱う
- bare リポジトリと `.git` ディレクトリ（とその中のフォルダ）では、`checkIsRepo()`（`--is-inside-work-tree`）が偽になり、`git init` は成功して中に `.git` を作ってしまう（実機で確認）。`initRepository` は `git rev-parse --git-dir` の成功でも「既にリポジトリ」と判定する。`getGitStatus` は変えないため、そのようなフォルダを開くと初期化のボタンは出る（既知の制約）
- `for-each-ref %(upstream:short)` は、削除済みの remote や fetch の refspec の無い remote を指す upstream を空にする。`pushSetUpstream` は `branch.<b>.remote` / `merge` の設定そのものも確かめ、あれば上書きしない（実機で確認）
- フォルダが存在しない（開いた後に削除・移動された）と、`simpleGit()` は生成の時点で英語の `GitConstructError` を投げる。このサービスの 3 関数は `フォルダが見つかりません: <path>` にする（`gitService.ts` の既存の関数は変えない）
- 利用者の決定: (a) ローカル専用のリポジトリにも `リモートが未設定です` を常に出す（origin を設定すれば消える。閉じる機能は作らない）、(b) `user@` の無い `host:path`（ssh の設定の別名）は許可しない（`user@host:path` だけ）、(c) ブランチ名の初期表示は `main` に固定する（`init.defaultBranch` は読まない）
- `origin` 以外の名前のリモートだけを持つリポジトリ（`git clone -o github` など）では、`hasOrigin` が偽でも既存の push / pull はそのリモートと通信できる（`upstream` は `github/main`。実機 git 2.50.1 で確認）。当初は `hasOrigin=false` で `リモートが未設定です` を出していたため、事実と違う表示が閉じられずに出続け、`リモートを追加` を押すと 2 つ目のリモートとして origin が足されていた。`GitStatusResult` に `hasRemote`（リモートが 1 つでもあるか）を足し、バナーはリモートが 1 つも無いときだけ出すように変えた（コードレビュー 8 周目で修正。差分 26）。`upstream` が設定済みかで代わりに判定する案は、同じリポジトリで新しいブランチを作ると（`upstream=null`・`hasOrigin=false`）誤判定が残るため採らなかった（実 git で確認）
- 利用者の決定（コードレビュー 6 周目の後）: パスワード入りの URL は構造的に拒否し、認証は credential helper に任せる。userinfo の区切り方の解釈違いで資格情報が漏れる穴が 6 周続いたため、個別の穴塞ぎをやめた（「`addOrigin`」の 5 と差分 24 を参照）

## 目的

Git 管理外のフォルダを開いたとき、アプリの中だけで「リポジトリを作る → リモート（origin）を登録する → 最初の push で upstream を設定する」まで進められるようにする。今は、ソース管理パネルに `Git リポジトリではありません` と出るだけで、ターミナルに切り替える必要がある。また、upstream の無いブランチで `プッシュ` を押すと git の英語のエラー（`has no upstream branch`）が出るだけで、次に何をすればよいかが分からない。

## 範囲

### 含める

- Git 管理外のフォルダでの「リポジトリを初期化」（ブランチ名を入力。既定は `main`）
- リモート `origin` の追加（URL を入力）。追加は origin が無いときだけ
- upstream の無い現在のブランチの「初回 push（upstream を設定）」（`git push --set-upstream origin refs/heads/<b>:refs/heads/<b>`）
- `getGitStatus` への `hasOrigin`・`upstream`・`detached` の追加と、それに基づく状態バナー
- 入力の検証（アプリ独自の規則 + git の規則）と、日本語のエラー

### 含めない（ROADMAP に見送り項目として残す）

- リポジトリの clone
- 複数のリモート（origin 以外の名前）、リモート名の変更（名前は `origin` 固定）
- URL の変更・削除
- 追加の前に、接続できるかを確かめること（`git ls-remote` などで通信しない）
- 初期コミットや `.gitignore` の自動作成（init は空のリポジトリを作るだけ）

## 振る舞い

### 状態ごとの表示

| 状態                                                                                                        | パネルの表示                                                                           | ボタン                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `isRepo=false`                                                                                              | 従来どおり `Git リポジトリではありません`。その下に `リポジトリを初期化` ボタン        | 初期化中だけ disabled                                                                                                                  |
| `isRepo=true`、`hasRemote=false`（リモートが 1 つも無い）                                                   | パネル上部に状態バナー `リモートが未設定です`                                          | `リモートを追加`。追加中・他の操作中（`isBlocked`）は disabled                                                                         |
| `hasOrigin=false`、`hasRemote=true`（`origin` 以外の名前のリモートだけ。`git clone -o github` など）        | バナーは出さない（`upstream` の有無・ブランチの位置によらない）                        | なし。既存の push / pull はそのリモートと通信できる。初回 push は `origin` 固定で拒否されるため、`upstream` が無くても出さない         |
| `hasOrigin=true`、`detached=true`（detached HEAD・リベース中・bisect 中）                                   | バナーは出さない（初回 push はブランチの上でしかできない）                             | なし                                                                                                                                   |
| `hasOrigin=true`、ブランチの上、`upstream=null`                                                             | バナー `upstream が未設定です（<branch>）`                                             | `初回 push（upstream を設定）`。push 中・pull 中・他の操作中は disabled                                                                |
| 上と同じだが、コミットが無い（init の直後）                                                                 | 同じバナーを出す                                                                       | ボタンは押せる。押すと main が `コミットが無いため、初回 push できません。先にコミットしてください` で拒否する（タグの作成と同じ扱い） |
| `upstream` が設定済み（リモートの ref が消えた `gone`・ローカルのブランチを upstream にしているものを含む） | バナーは出さない                                                                       | なし                                                                                                                                   |
| マージ中（`mergeInProgress`）                                                                               | マージのバナーを先に、その下にリモートのバナーを出す（どちらも条件を満たせば両方出す） | 上の各行と同じ。初回 push・origin の追加は、マージ中でも作業ツリー・index を変えないので許可する                                       |

- バナーは `MergeBanner` と同じ作り（`section`、文言は `role="status"`、ボタンの並び）で、`RemoteSetupBanner` として GitRepoView の `MergeBanner` の直後に置く。文言と条件の判定は `lib/remoteSetupState.ts` の純粋関数（`getRemoteSetupState(gitStatus): 'no-origin' | 'no-upstream' | null`）にまとめ、バナーとテストが同じ判定を使う
- `upstream` の判定には simple-git の `status.tracking` を使う。`gone` でも `origin/<b>` が返る（実機で確認）ので、「設定済み」として扱う。既存の `プッシュ` は `gone` の upstream にも push してリモートのブランチを作り直せる（実機で確認）
- `hasOrigin` は `git remote` の出力に `origin` の行があるかで判定する。`remote.origin.url` が無くても、`remote.origin.fetch`・`prune`・`pushurl` のどれかがあれば `origin` が出て、`git remote add` は `already exists` で失敗する（実機で確認）。この判定は、追加できるかどうかと一致する
- `hasRemote` は同じ `git remote` の出力に行が 1 つでもあるか。バナー `リモートが未設定です` はこれが偽のときだけ出す（`hasOrigin` は `origin` の追加と初回 push の事前検証が使う意味のまま変えない）

### リポジトリを初期化

- `リポジトリを初期化` を押すとダイアログが開く。項目は `ブランチ名`（既定値 `main`。開いたときに全選択）。説明は `このフォルダに空の Git リポジトリを作成します`
- 名前は前後の空白を除き、NFC にそろえる（共有の `normalizeInitialBranchName`。パターン 83）。ダイアログの検証は `@shared/branchName` の規則（空・`-` 始まり・`@`）だけで、git の規則は main が判定する（ブランチの作成と同じ分担）
- 成功したらダイアログを閉じ、ステータスと履歴を取り直す。パネルは GitRepoView に切り替わり、`リモートが未設定です` のバナーが出る
- ファイルツリーは取り直さない。`.git` はツリーの走査から除外されており（`traversalPolicy.ts` の `SKIP_DIRS`）、init で見た目は変わらない。ファイルの監視は無いので、Git 管理外かどうかは `refreshGitStatus`（`checkIsRepo`）を呼んだときにだけ判定し直される。初期化のフックが成功・失敗のどちらでも呼ぶ
- 親フォルダが既にリポジトリの場合は、`checkIsRepo` が親を拾って `isRepo=true` になる（実機で確認。gitignore されたサブフォルダでも同じ）。このため初期化のボタンは出ない。入れ子のリポジトリはアプリからは作らない

### リモートを追加

- `リモートを追加` を押すとダイアログが開く。項目は `URL`。説明は `リモート origin を追加します（この時点では接続しません）`
- URL は前後の空白だけを除く（`normalizeRemoteUrl`。NFC にはそろえない。URL の中の文字を変えるとサーバー側で別のパスになるため）。検証は renderer・main とも共有の `getRemoteUrlRuleViolation` で行う（パターン 88）
- 成功したらダイアログを閉じ、ステータスを取り直す。コミットのあるブランチなら、バナーは `upstream が未設定です` に変わる

### 初回 push（upstream を設定）

- バナーのボタンを押すと、確認なしで実行する（push と同じ。リモートに新しいブランチを作るだけで、ローカルは変わらない）
- 実行中は、ボタンを `push 中...`（`aria-label` は `push 中`）にし、バナーの中に `role="status"` の案内 `初回 push 中です。応答が 30 秒途絶えると打ち切ります` を出す。「30 秒」は `GIT_REMOTE_TIMEOUT_MS` から組み立てる（パターン 87・88）
- 成功したら、ステータスと履歴を取り直す。バナーは消え、`↑`/`↓` の表示は upstream に対する値になる
- 失敗は既存の push と同じ場所（パネル上部の `remoteOperationError`）に出す。再試行の開始時には前回のエラーを消す（パターン 87）

### 実行中のダイアログの扱い（タグの作成に揃える）

- 文言: 見出しは `リポジトリを初期化` / `リモートを追加`、実行ボタンは `初期化`（実行中 `初期化中...`）/ `追加`（実行中 `追加中...`）。初期化ダイアログ内の検証の文言は、ブランチの作成ダイアログと同じ（`名前を入力してください` など）
- 実行中は、入力欄と実行ボタンを disabled にする。`キャンセル` も disabled にし、Escape とオーバーレイのクリックでは閉じない（閉じる経路は共通の `requestCancel` に集める。パターン 85）
- オーバーレイのクリックで閉じるのは、押したのも離したのもオーバーレイ自体のときだけ（`useOverlayDismiss`。タグの作成の `CreateTagDialog` と共通）。入力欄で押して（長い URL のドラッグ選択など）オーバーレイで離すと、Chromium は押した要素と離した要素に共通する祖先（オーバーレイ）へ click を送り、ダイアログ側の `stopPropagation` はこの経路に入らないため、click だけで判定すると閉じて入力が消える（コードレビューで修正）。逆向き（オーバーレイで押してダイアログの中で離す）も click の target はオーバーレイになる（Electron の `sendInputEvent` で確認）ため、`mousedown` と `mouseup` の target をそれぞれ記録し、click で両方がオーバーレイ自体のときだけ閉じる。記録は click ごとに捨て、次の click に持ち越さない（コードレビュー 2 周目で修正）
- 実行中は `form` に `aria-busy="true"` を付け、`role="status"` の案内（`初期化中です` / `追加中です`）を出す。案内と `aria-busy` を出すのは `isRunning && error === null` のときだけで、失敗の直後に案内と alert を重ねない（パターン 87）
- 失敗はダイアログ内に `role="alert"` で出し、ダイアログは閉じない。再試行の開始時にエラーを消す（フックの `onStart`）。ダイアログを開くときにも前回のエラーを消す（`clearError`）
- フォーカス（パターン 86）:
  - キャンセル・Escape・オーバーレイのクリックで閉じたら、ダイアログを開いたボタンへ戻す
  - 成功すると、開いたボタンは消える（初期化のボタンは GitRepoView に切り替わって消え、`リモートを追加` はバナーが変わって消える）。そのため「次の操作のボタン」へ移す。初期化の後は `リモートを追加`、追加の後は `初回 push（upstream を設定）`、初回 push の後はツールバーの `プッシュ`。移すのは、その時点のフォーカスが body のときだけで（利用者が移した先を奪わない）、描画の後（`useEffect`）に移す。移す先が無い（例: 追加の後に detached でバナーが出ない）ときは何もしない。ただし初期化の成功の後に、ステータスの取り直しが失敗して（失敗は既存の refresh と同じく利用者に示さない）Git 管理外の表示のまま残ったときは、移す先（`リモートを追加`）が無くフォーカスが body に落ちるため、開いたボタン（`リポジトリを初期化`）へ戻す（`NotRepositoryView` は成功の後も戻す予約付きの `close()` で閉じる。通常はリポジトリの表示に切り替わって `NotRepositoryView` ごと外れ、予約は捨てられる。コードレビューで修正）
  - 失敗して実行中が解けたら、フォーカスが body かダイアログ内にあれば入力欄へ戻す
  - 初回 push（バナーのボタン。ダイアログは無い）が失敗して実行中が解けたら、フォーカスが body なら `初回 push（upstream を設定）` へ戻す（実行中は disabled でフォーカスが body に落ちるため。外の要素にあるフォーカスは奪わない）。成功ではバナーが消えるか、残っても成功の後の移し先（ツールバーの `プッシュ`）に任せる
  - Escape は `isComposing` のときは無視する（IME）
- モーダルとして扱う（PR #42 のレビュー指摘で追加）: `form` に `aria-modal="true"` を付け、Tab / Shift+Tab をダイアログの中（入力欄・実行・キャンセル）で循環させて、背後のコミット欄やツールバーへフォーカスを出さない（`useDialogFocusTrap`）。Tab は document の capture で受け（フォーカスが外や body にあっても受けられる。`QuickOpenDialog` と同じ理由）、操作対象（disabled と tabindex=-1 を除く）は押すたびに列挙し直す（実行中に disabled で対象が減るため。パターン 86）。外や body にあるフォーカスは、Tab で先頭へ、Shift+Tab で末尾へ入れる。実行中にすべて disabled になったときはフォーム自体に置く（tabindex=-1 を付ける）。IME の変換中（`isComposing`）は奪わない。`form` には最初から `tabIndex={-1}` を付ける（2 回目のレビューで修正）: 付けないと、ダイアログ内の文字・余白をクリックしたときにフォーカスが body に落ち、Escape（`form` の `onKeyDown`）が届かず閉じられなかった。また一度実行して操作対象が 0 件になるとフックが tabindex=-1 を付けるため、実行の有無で挙動が変わっていた。Escape を document の capture で受ける方式は採らない（クイックオープンなど document で Escape を受ける他の画面と取り合いになり、閉じる経路が `form` と document の 2 か所に分かれる）。実行中は Escape で閉じない挙動（`requestCancel`）は変えない。form がフォーカスを受けたときは、フォーカスリングを出さない（`.remote-setup-dialog:focus { outline: none; }`。Chromium 既定の `:focus-visible` の `outline: auto` がダイアログ全体に出るため。3 回目のレビューで修正。中の入力欄・ボタンのフォーカスの表示は変えない）。タグの作成の `CreateTagDialog` とエクスプローラーとブランチの作成で使う `NameInputDialog` には付けていない（範囲外。ROADMAP の既知の制約）

## main の検証と実行

すべて `src/main/gitRemoteSetupService.ts`（新規）に置く。`gitService.ts` には足さない（単一責任。パターン 55）。

### `initRepository(folderPath, branch)`

0. 入口で `normalizeInitialBranchName`（`@shared/branchName` に追加。`trim()` の直後に `normalize('NFC')`）に通す。以後の検証・`git init`・作成の確認・エラーの文言は、すべてこの名前で行う（パターン 83）
1. アプリ独自の規則（`getBranchNameRuleViolation`）: 空 → `ブランチ名として使用できない名前です: <name>`、`-` で始まる → `` `-` で始まるブランチ名は使用できません: <name> ``、`@` → `ブランチ名として使用できない名前です: <name>`（パターン 21）
2. git の規則: `git check-ref-format --branch <name>` の出力（trim）が入力と一致しなければ `ブランチ名として使用できない名前です: <name>`。reject も同じ文言にする（パターン 25・74）。リポジトリの外でも動き、`HEAD`・`-x`・`a..b`・`@{-1}`・`main.lock`・`main/` を拒否する（実機で確認）。1・2 は `createBranch` の `assertCreatableBranchName` の前半と同じなので、`src/main/gitBranchNameGuard.ts`（新規）の `assertValidNewBranchName(git, name)` に切り出して両方が使う（パターン 55・88）。壊れた `.git` ファイル（存在しない gitdir を指す）があると、`check-ref-format --branch` はリポジトリを探す途中で `fatal: not a git repository` になり、どの名前でも失敗する（実機で確認）。名前の誤りと見せないよう、git の規則の検証に失敗したとき（1 は通っている場合だけ）、名前と関係の無い `check-ref-format --branch main` で git がこのフォルダで動くかを確かめ、動かなければ `リポジトリを初期化できませんでした: <detail>` にする
3. `checkIsRepo()` が真、または `git rev-parse --git-dir` が成功する（bare リポジトリ・`.git` ディレクトリとその中。`checkIsRepo()` は偽になる）→ `このフォルダは既に Git リポジトリ（または親フォルダのリポジトリ）の中にあります`。`rev-parse --git-dir` は、管理外のフォルダ・壊れた `.git` ファイル・失敗した init の残骸では `fatal: not a git repository`（終了コード 128）で失敗する（実機で確認）ので、`checkIsRepo()` が偽の直後の reject は「リポジトリの外」と扱う（文言では分岐しない）。打ち切りは時間切れの文言にする。既存のリポジトリに `git init` すると終了コード 0 で再初期化され、`--initial-branch` は警告だけで無視される（実機で確認）ため、git に任せず事前に拒否する。`checkIsRepo` が reject したとき（`dubious ownership` など）は `リポジトリを初期化できませんでした: <detail>`。壊れた `.git` ファイルでは `checkIsRepo` は reject せず偽で resolve する（simple-git が `not a git repository` を「リポジトリではない」に読み替える。実機で確認）ので、2 の確かめで止まる
4. 実行: `git init --initial-branch=<name>`（値を 1 つの引数にする。パターン 49）。`--initial-branch` が指定されれば利用者の `init.defaultBranch` は使われない（入力した名前を優先するのは意図どおり）。`init.templateDir` などのテンプレートは上書きしない（テンプレートのフックはコピーされるが、init のときには実行されない。実機で確認。パターン 45・81）。失敗したら `リポジトリを初期化できませんでした: <detail>`
5. 作成の確認: `getCurrentBranchRef`（`git symbolic-ref -q HEAD`。下の `pushSetUpstream` の 3 を参照）が `refs/heads/<name>` でなければ `リポジトリを初期化できませんでした`（パターン 69）

- タイムアウト: init は対話も通信もしないが、ダイアログを閉じられない設計（パターン 85）なので、最長の待ち時間を保証するため simple-git の `timeout: { block: 30_000 }` を付ける（パターン 84）。30 秒は main の定数 `REMOTE_SETUP_LOCAL_TIMEOUT_MS`（`gitRemoteSetupService.ts`）にし、第 3 引数で差し替えられる形にする（テストで実時間を待たない）。打ち切ったら `リポジトリの初期化が時間内に終わりませんでした`
- 失敗したときの残骸: `git init` は名前の検証で失敗しても、`HEAD` の無い `.git`（config・hooks・refs）を作って残す（実機で確認）。残った `.git` は `checkIsRepo` では「リポジトリではない」になり、もう一度正しい名前で初期化すれば正常なリポジトリになる（実機で確認）。アプリからは `.git` を消さない（利用者のデータを消す危険があるため）。1・2 の事前検証で、通常はここに来ない

### `addOrigin(folderPath, url)`

0. 入口で `normalizeRemoteUrl`（`@shared/remoteUrl`。`trim()` だけ）に通す
1. 規則（`getRemoteUrlRuleViolation(url, { windowsPaths })`。renderer と共有）。判定の順序:
   1. 空 → `URL を入力してください`
   2. 2048 文字を超える → `URL が長すぎます（2048 文字まで）`
   3. 空白（全角の空白を含む `\s`）・改行・タブ・NUL などの制御文字（C0・DEL・C1 の U+0080〜U+009F）・不可視の書式文字（Unicode の Cf。ゼロ幅スペースや双方向の制御文字）・引用符（`'` `"` `` ` ``）を含む → ``URL に空白・改行・制御文字・引用符（' " `）は使用できません``（コードレビュー 3 周目で引用符を加えた。`/repos/O'Brien/b.git` のように空白も制御文字も無い入力で、理由が伝わらなかったため）。git の `remote add` は改行を含む URL をそのまま受け付け、config には複数行の値として書かれる（実機で確認）
      - 引用符を拒否する理由: git は失敗の文言で URL を引用符で囲んで出すことがあり（4 の `could not set 'remote.origin.url' to '<url>'`）、URL の中の引用符は資格情報を伏せる処理（`redactCredentials`）の区切りと区別できない。`https://u:p'ss@h/r` は `https://u:p'***@h/r'` になり、パスワードの一部（`p`）が残る。git 自体は引用符を含む URL を受け付ける（`remote add` も、`/…/O'Brien/b.git` への push も成功する。実機 git 2.50.1 で確認）が、GitHub・GitLab などのリポジトリ名には引用符を使えず、現実に要るのはローカルの絶対パスのフォルダ名くらいのため、安全側に倒して拒否する。`redactCredentials` の除外文字は変えない（検証が引用符を拒否するため、アプリが追加した URL では到達しない。コードレビュー 2 周目で修正）
   4. `-` で始まる → `` `-` で始まる URL は使用できません ``（パターン 21）
   5. 許可リスト（パターン 21・59）のどれにも当たらない → `使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）`（後半の資格情報の案内はコードレビュー 7 周目で追加。違反の種類と判定の順序は変えていない）
      - **資格情報の扱い（利用者の決定）: パスワード入りの URL は構造的に拒否し、認証は credential helper（`git credential`・ssh の鍵・`~/.ssh/config`）に任せる。** 理由: コードレビューの 6 周で毎回、userinfo（`user:pass@`）の区切り方の解釈違いで資格情報が漏れる穴が見つかった（remote add の失敗の文言・`ssh://` の `user:pw@`・`@` を含むパスワード・`%XX` の decode・`git://` の userinfo・引用符・userinfo の生の `/`（パスワードが数字か空で始まる `https://alice:1234/s3cret@h/r`・`https://alice:/s3cret@h/r`、`:` の無いトークンだけの `https://ghp_tok/en@h/r`）・userinfo の `?` `#`（`https://h#sec@h2/r`））。個別に塞ぐ方式は終わりが見えないため、許可する形を最小に定義し直した（コードレビュー 6 周目の後に変更。差分 24）
      - `https://` `http://` `ssh://` `git://`: スキームは小文字で完全一致。構造の解析は `parseNetworkUrl(url)`（`{ scheme, userinfo, host, port, pathAndAfter } | null`）の 1 か所にまとめ、判定はそこから派生させる（判定の分散が穴の温床だった。パターン 88）。authority は `://` の後の最初の `/` `?` `#` まで、userinfo は authority の最初の `@` まで
      - authority は `[userinfo@]host[:port]` の構造に限る。`host` は `[IPv6]`（括弧の中は 16 進数・`:`・`.` だけ）か、`:` `@` `%` と角括弧を含まない名前（ホスト名・IPv4。全角の IDN も通す）で、空でも `-` で始まるものでもない（パターン 21）。`port` は数字だけ（空の `host:` も可。git が既定のポートとして扱う。範囲（`:0`・`:99999`）は確かめない。git は範囲外で失敗するだけで、資格情報を出さない。実機で確認）
      - authority は `/` か末尾で終わる。`?` `#` で終わる形（`https://h#sec@h2/r`・`ssh://h?x@y/r`）は拒否する。RFC 3986 と curl は authority を最初の `/` `?` `#` で切り、git（ssh:// と git://）は最初の `/` で切るため、両者の解釈を一致させる
      - userinfo: `http://` `https://` `git://` は authority に `@` があれば拒否する（user だけでもトークンだけでも秘密になりうる。git:// には認証が無く、git は `user:pass@host` 全体をホスト名として `unable to look up alice:s3cret@127.0.0.1:19418` と出す。実機 git 2.50.1 で確認）。`ssh://` は「パスワードの無いユーザー名だけ」を許可する: userinfo は `[A-Za-z0-9._~+-]+` の文字だけで、先頭は `-` でない（`ssh://git@host/r`・`ssh://first.last+tag@host/r`・`ssh://ec2-user@host/r`）。`:`（パスワードの区切り。空のパスワードの `ssh://u:@h/r` も）・`%`・空の userinfo・`@` の 2 個目は拒否する
      - authority の `%XX` は拒否する（userinfo も host も）。git は `ssh://` と `git://` の URL 全体の `%XX` を元の文字に戻してから host と path を分ける（`ssh://alice%3Apw%40h/r` は ssh に `alice:pw@h` が渡り、`ssh://git@h%2Fx/r` は host が `h`・path が `/x/r` になる。偽の ssh で引数を記録して確認。実機 git 2.50.1）
      - path・query・fragment（authority の後）の `@` と `%40` は、すべてのスキームで拒否する。userinfo に生の `/` がある URL は、authority を最初の `/` で切ると `alice:1234`（`@` 無し）になり、port が数字のため host:port に見えて通っていた（git は https では `unable to access 'https://alice:1234/s3cret@h/r/'` と URL ごと出し、ssh では `Could not resolve hostname alice` と出す。5・6 周目のレビュー）。`%40` も git が `@` に戻すため同じく扱う。正当な URL の path の `@` は稀なため許容する（既知の制約）
      - 違反はすべて `unsupported`（文言は 5 のまま）
      - `file://`: 直後が `/`（絶対パス）
      - scp 形式: `<user>@<host>:<path>`。`user` は ssh:// の userinfo と同じ `[A-Za-z0-9._~+-]+`（先頭は `-` でない。`git`・`ec2-user`・`first.last` は通る）。`host` は `/` `:` `@` を含まず、`-` で始まらない。`path` は空でなく、`@` を含まない（`Ua1@Ub2:Pa3@h:r` は user `Ua1@Ub2`・パスワード `Pa3` のつもりでも、git は host を `Ub2`・path を `Pa3@h:r` と解釈し、パスワードが URL ごと失敗の文言に残る。開発中の探索で検出し、ネットワークの URL と揃えた。コミット済みの性質テストが `g@u:p@h:r` として再現する）。`[::1]` のような角括弧のホストは許可しない。scp 形式は git が `%XX` を decode しない（実機で確認）
      - 絶対パス: `/` で始まる。`windowsPaths` が真のときだけ、`C:\` `C:/` の形も許可する（main は `process.platform === 'win32'` を渡す。macOS で `C:/x` は git に scp 形式として解釈されるため拒否する。renderer は platform を知らないので、ダイアログでは寛容側の `true` を渡し、最終判断は main が行う）。相対パス（`../bare.git`）は git が開いているフォルダからの相対で解決して受け付けるが（実機で確認）、開いているフォルダが変わると別の場所を指すため拒否する
      - 上記以外はすべて拒否する。特に `ext::<command>`（任意のコマンドを実行する）、`fd::<n>`、`<名前>::<address>`、未知のスキームの `<名前>://`（`git-remote-<名前>` が起動する）。`ext::` は git の既定（`protocol.ext.allow=never`）では push 時に `transport 'ext' not allowed` で止まるが、利用者が `protocol.ext.allow=always` や `protocol.allow=always` を設定していると push 時にコマンドが実行された（実機で確認）。`fd::3` は push 時に読み込み待ちのまま終わらなかった（実機で確認）。simple-git は `git remote add -- origin <url>` で、これらの値も `--upload-pack=...` も止めない（実機で確認）。アプリの許可リストが唯一の防御になる
   - 規則の違反の文言には URL を含めない（拒否した URL は資格情報を含みうるため、画面に出さない）。git の失敗の詳細に URL が出る場合は 4 のとおり userinfo を伏せる
2. `checkIsRepo()` が偽 → `Git リポジトリではありません`
3. `git remote` に `origin` がある → `リモート origin は既に設定されています`（`already exists` の英語を見せない）
4. 実行: `git remote add -- origin <url>`（`--` の後に置く。`remote add` は通信しない。`-f` を付けない）。失敗したら `リモートを追加できませんでした: <detail>`
   - git の出力は資格情報を伏せる場合と伏せない場合がある。`.git/config.lock` が残っている（クラッシュ後・`addOrigin` の同時実行）と、`fatal: could not set 'remote.origin.url' to '<url>'` と URL をそのまま出す（実機 git 2.50.1 で確認）。検証がパスワード入りの URL を拒否するため、ここに届く userinfo は scp 形式の user と `ssh://` のユーザー名だけになる。それでも防御を 2 層にする方針は維持する（検証の取りこぼしと、端末で追加した origin への初回 push の文言に備える）。そのため addOrigin の失敗（2〜5 のどの git 呼び出しでも）の detail は、アプリ側で `redactCredentials`（`gitStepErrors.ts`）を通して伏せる: `://` の後の userinfo（最後の `@` まで）と、語の先頭から語の中の最後の `@` まで（scp 形式の `user@`・ホスト名として出た `user:pass@host`・ssh が出す `u:p@ss@host`）を `***@` にし、ホスト・パスは残す。入力した URL の完全一致ではなく形で伏せる（git が整形した形にも効かせる）。共通の `toStepError` の第 4 引数 `redact`（既定は恒等）で渡し、タグの作成・push/pull/fetch の文言は変えない（コードレビューで修正）
   - `redactCredentials` の `://…@` のパターンは `/` を越えない。userinfo に生の `/` がある URL（`https://user:pa/ss@h/r`）では `user:pa` が残るが、`/` を越えて最後の `@` まで伏せる形にすると `repository 'https://host/a@b/' not found` が `https://***@b/` になり、ホストとパスを消す（コードレビュー 5 周目で確認）。その URL は 5 の検証（path の `@` の拒否）が拒否するため、マスクの側は変えない（検証で防ぐ層に任せる）
5. 追加の確認: `git config --get remote.origin.url` が入力と一致しなければ `リモートを追加できませんでした`（パターン 69）

- タイムアウト: init と同じ理由で 30 秒（`REMOTE_SETUP_LOCAL_TIMEOUT_MS`。第 3 引数で差し替えられる。パターン 84）。打ち切ったら `リモートの追加が時間内に終わりませんでした`。第 4 引数 `windowsPaths` の既定は `process.platform === 'win32'`
- `url.<base>.insteadOf`・`pushInsteadOf` による書き換えは利用者の設定として尊重し、検証は入力した URL に対して行う（パターン 60 の観点から「既知の制約」に記録する）

### `pushSetUpstream(folderPath)`

1. `checkIsRepo()` が偽 → `Git リポジトリではありません`
2. `git remote` に `origin` が無い → `リモート origin が未設定のため、初回 push できません`
3. 現在のブランチ: `git symbolic-ref -q HEAD` が空（detached HEAD・リベース中・bisect 中）→ `ブランチ上にいないため（detached HEAD・リベース中など）、初回 push できません`。`gitService.ts` の `isOnBranch` と同じ判定なので、`src/main/gitHeadState.ts`（新規）の `getCurrentBranchRef(git): Promise<string | null>` に切り出して両方が使う（simple-git の `branchLocal().detached` を使わない理由も同じ。パターン 55）。`refs/heads/` で始まらない値（`git symbolic-ref HEAD refs/remotes/origin/main` で作れる状態）もブランチ上にいないと扱う。旧実装の `isOnBranch` は空でなければブランチ上と扱い、その状態でマージするとリモート追跡 ref を更新していた。新実装は拒否する（ガードが厳しくなる方向の変化）
4. コミットが無い: `git rev-parse -q --verify HEAD` が空 → `コミットが無いため、初回 push できません。先にコミットしてください`。git に任せると `src refspec main does not match any` の英語になる（実機で確認）
5. upstream が既にある: `git for-each-ref --format=%(upstream:short) refs/heads/<b>` が空でない → `upstream は既に設定されています: <upstream の短い名前>`（出力の `origin/main` などをそのまま使う）。`-u` は既存の `branch.<b>.remote` / `merge` を黙って上書きするため、利用者の設定を変えない（パターン 45）。判定はバナーの `status.tracking` と同じく ref の解決で行う（パターン 59）。`%(upstream:short)` は、削除済みの remote や fetch の refspec の無い remote を指す upstream を空にする（実機で確認）ため、続けて `git config --get branch.<b>.remote` / `branch.<b>.merge` のどちらかがあれば `upstream の設定が既にあるため、初回 push できません（設定先のリモートが無いか、fetch の設定が無いため表示されていません）` で拒否する（上書きしない）
6. 実行: `simpleGitWithRemoteTimeout(folderPath).raw(['push', '--set-upstream', 'origin', 'refs/heads/<b>:refs/heads/<b>'])`
   - 完全な refspec にする理由: (a) 同じ名前のタグがあると `git push -u origin v9` は `src refspec v9 matches more than one` で失敗する（実機で確認。パターン 43）。(b) `refs/` で始まるので、`-` で始まるブランチ名（`init --initial-branch=-x` や `update-ref` で作れる）でもオプションと解釈されない（パターン 21）。(c) `--` を使えない。simple-git の progress プラグインが末尾に `--progress` を足すため、`--` の後だと refspec として扱われて失敗する（実機で確認）
   - 明示した refspec のため、`push.default`・`push.autoSetupRemote`・`remote.origin.push` の設定には影響されない（実機で確認）。pre-push フックは利用者の設定として実行する
   - リモートに同じ名前のブランチがあって non-fast-forward のときは、git が拒否し upstream も設定されない（実機で確認）。失敗は `初回 push に失敗しました: <detail>`（git の出力を添える）。時間切れは既存の `toRemoteOperationError` の文言（`操作がタイムアウトしました。認証情報が未設定か、ネットワークに問題がある可能性があります`）
   - https・http の push の失敗では、git は URL の資格情報を取り除いて出す（`fatal: unable to access 'https://127.0.0.1:1/a/b.git/'`。`https://user:secret@...` で確認）。一方、`ssh://u:pw@github.com/x/y.git` と scp 形式の `tok123@github.com:x/y.git` では、ssh 自身が接続先を `u:pw@github.com: Permission denied (publickey).` / `tok123@github.com: Permission denied (publickey).` と出し、git はそのまま流す（ssh:// の `u:pw` は user として ssh に渡る。実機 git 2.50.1 で確認）。そのため detail は `addOrigin` の 4 と同じく `redactCredentials` を通して伏せる（`***@github.com: Permission denied (publickey).`。コードレビュー 2 周目で修正。パスワードに `@` を含む `u:p@ss@127.0.0.1: …` も語の中の最後の `@` まで伏せる。URL の検証がパスワード入りの URL を拒否するのと合わせて防御を 2 層にする（パターン 59。コードレビュー 3 周目で修正）。検証の変更（差分 24）の後は、`ssh://u:pw@…` の origin は端末で追加したものだけになる（アプリからは追加できない）。テストは `core.sshCommand` の偽の ssh で、ネットワークに出ずに確かめる）
   - 既存の push / pull / fetch（`toRemoteOperationError`）は git のエラーをそのまま返すため、同じ ssh の失敗で資格情報が文言に出る。既存の機能の問題として、この機能では変えない（「既知の制約」を参照）
7. 設定の確認: `git config --get branch.<b>.remote` が `origin`、`branch.<b>.merge` が `refs/heads/<b>` でなければ `push は完了しましたが、upstream を設定できませんでした`（パターン 69）。`for-each-ref %(upstream:short)` で確かめない理由は「既知の制約」の fetch の refspec を参照

- 1〜5 の事前の確かめの git 呼び出しも、6 と同じく `simpleGitWithRemoteTimeout`（30 秒の打ち切り付き）で行う。reject は `初回 push に失敗しました: <detail>`、打ち切りは既存の `toRemoteOperationError` の文言にする（英語の GitError をそのまま見せない。パターン 74）

- `simpleGitWithRemoteTimeout` と `toRemoteOperationError` は `gitService.ts` の非公開の関数なので、`src/main/gitRemoteTimeout.ts`（新規）へ移し、push / pull / fetch と初回 push が同じものを使う。`GIT_REMOTE_TIMEOUT_MS`（30 秒）は `src/shared/remoteTimeout.ts` に移し、renderer の案内（秒）もここから組み立てる（パターン 88。秒の倍数であることを単体テストで固定する）
- 認証: パッケージ版（GUI から起動）には制御端末が無いため、git は端末でのユーザー名の入力を待たずに失敗する（端末の無い環境で 1 秒以内に失敗することを確認）。資格情報ヘルパーが GUI で入力を待つ場合は、既存の push と同じく 30 秒間出力が無いと打ち切る

### `getGitStatus` の追加

- `GitStatusResult` に `hasOrigin: boolean`、`hasRemote: boolean`、`upstream: string | null`、`detached: boolean` を足す。リポジトリでないときは `false` / `false` / `null` / `false`
- `git remote` は 1 回だけ呼び、出力（行ごとに分け、`\r` と空行を落とす。`gitRemoteNames.ts` の `listRemoteNames`）から `hasOrigin`（`origin` があるか）と `hasRemote`（名前が 1 つでもあるか）を決める。`gitRemoteSetupService` の origin の判定（`hasOriginRemote`）も同じ `listRemoteNames` を使う（パターン 88）。`git.status()`・`hasMergeInProgress` と並行して取る（`hasRemote` はコードレビュー 8 周目で追加。差分 26）
- `upstream` は `status.tracking`、`detached` は `status.detached`（`## HEAD (no branch)` のとき真。リベースで止めている間も真になることを実機で確認）

### 排他

| 操作          | 自身の実行中フラグ            | 待つ条件（`isBusy`）                                                    | `lockGlobal` | 根拠                                                                                                                                                                                        |
| ------------- | ----------------------------- | ----------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 初期化        | `isInitializing`              | 自身・`lock.isAnyLocked()`                                              | 取らない     | `isRepo=false` の間は他の Git 操作がすべて disabled で、競合する相手がいない                                                                                                                |
| origin の追加 | `isAddingOrigin`              | 自身・`lock.isAnyLocked()`・リポジトリが無い                            | 取らない     | `.git/config` に 1 節足すだけで、作業ツリー・index・HEAD を変えない（タグの作成と同じ判断）。追加を出すのはリモートが 1 つも無い間だけで、その間は push / pull が通信できないので競合しない |
| 初回 push     | push と共有（`isPushingRef`） | push と同じ（自身・push・pull・`lock.isAnyLocked()`・リポジトリが無い） | 取らない     | 既存の push と同じ。commit・checkout の途中に古い HEAD を送らないよう、ロック中は待つ。push と初回 push は同時に走らせない（同じ ref と `branch.<b>` の設定を書く）                         |

- 初回 push は `useGitRemoteOperations` に `pushSetUpstream` として足し、`isPushingRef` / `isPushing` を push と共有する（ツールバーの `プッシュ` も `プッシュ中...` で disabled になる）。どちらの push かをバナーのボタンの表示に使うため、`isSettingUpstream` を別に持つ
- 実行中フラグは、取り直し（ステータス・履歴）が終わってから下ろす（`useRunExclusiveGitOperation`。パターン 73）。初期化・初回 push の後の取り直しは `Promise.allSettled` で両方の完了を待つ（`Promise.all` では片方が先に reject した時点でフラグが下りる）。取り直しの失敗は操作の結果（戻り値・エラー）にしない（パターン 52）

## アーキテクチャ

### shared

- `src/shared/branchName.ts`: `normalizeInitialBranchName(name)` を追加（`trim` + NFC）。規則は既存の `getBranchNameRuleViolation` を使う
- `src/shared/remoteUrl.ts`（新規）: `normalizeRemoteUrl(url)`、`getRemoteUrlRuleViolation(url, { windowsPaths }): 'empty' | 'too-long' | 'invalid-char' | 'leading-dash' | 'unsupported' | null`、`MAX_REMOTE_URL_LENGTH = 2048`、`parseNetworkUrl(url)`（ネットワークの URL の構造の解析の 1 か所）。違反の種類だけを返し、文言は各側の表で持つ（パターン 88）
- `src/shared/remoteTimeout.ts`（新規）: `GIT_REMOTE_TIMEOUT_MS = 30_000`、`GIT_REMOTE_TIMEOUT_SECONDS = GIT_REMOTE_TIMEOUT_MS / 1000`
- `src/shared/types/git.ts`: `GitStatusResult` に `hasOrigin`・`hasRemote`・`upstream`・`detached`

### main

- `src/main/gitRemoteSetupService.ts`（新規）: `initRepository`・`addOrigin`・`pushSetUpstream` と、各文言の定数
- `src/main/gitBranchNameGuard.ts`（新規）: `assertValidNewBranchName`（`createBranch` と `initRepository` が使う）
- `src/main/gitHeadState.ts`（新規）: `getCurrentBranchRef`（`isOnBranch` と `initRepository`・`pushSetUpstream` が使う）
- `src/main/gitRemoteNames.ts`（新規）: `ORIGIN_REMOTE`・`listRemoteNames`（`getGitStatus` が使う）・`hasOriginRemote`（`gitRemoteSetupService` が使う。`listRemoteNames` で判定する）
- `src/main/gitRemoteTimeout.ts`（新規）: `simpleGitWithRemoteTimeout`・`toRemoteOperationError` を `gitService.ts` から移す（振る舞いは変えない）
- `src/main/gitStepErrors.ts`（新規）: git の呼び出しの失敗の変換（`isGitTimeoutError`・`errorDetail`・`failure`（「接頭辞: 詳細」。詳細が空なら接頭辞だけ）・`toStepError`・`runGitStep`）。`gitRemoteSetupService`・`gitRemoteTimeout`・`gitTagService` が使う。打ち切りの判定は通信を伴わない init・remote add・git tag にも使うため、リモート用の `gitRemoteTimeout` には置かない（パターン 55）。文言は呼び出し側が持つ
- `src/main/gitService.ts`: `getGitStatus` に 4 つの値を足す
- `src/main/handlers/gitHandlers.ts`: `git:init`（`assertBranchNameArg` を使う）、`git:addOrigin`（`assertRemoteUrlArg`: 文字列であること）、`git:pushSetUpstream`（引数なし）。どれも `getAllowedFolder` で許可フォルダを取り、余分な引数は使わない。値の中身は service が検証する
- `src/preload/api.ts` / `index.d.ts`: `initRepository(branch)`、`addOrigin(url)`、`pushSetUpstream()`

### renderer

- `src/renderer/src/lib/gitApi.ts`: 上の 3 つ
- `src/renderer/src/lib/remoteSetupValidation.ts`（新規）: ダイアログ用の検証と文言（`validateInitialBranchName`・`validateRemoteUrl`）。最初のブランチ名は `validateBranchName(normalizeInitialBranchName(name), [])` で、ブランチの作成ダイアログ（`branchNameValidation`）の文言の表を共有する（同じ層に同じ表を 2 つ持たない。パターン 88）。URL の文言はここの表で持つ
  - （注記）clone の PR で、`validateRemoteUrl` と URL の文言の表は `lib/remoteUrlValidation.ts` へ移した（`remoteSetupValidation.ts` は `initRepositoryValidation.ts` に改名）
- `src/renderer/src/lib/remoteSetupState.ts`（新規）: `getRemoteSetupState(gitStatus)`（状態の表の判定）と、成功後のフォーカスの移し先の型 `RemoteSetupFocusTarget`（`'add-remote' | 'set-upstream' | 'push'`）
- `src/renderer/src/hooks/useGitRemoteSetup.ts`（新規）: `initRepository(branch): Promise<boolean>`、`addOrigin(url): Promise<boolean>`、`isInitializing`、`isAddingOrigin`、`initError`、`addOriginError`、`clearInitError`、`clearAddOriginError`。`useRunExclusiveGitOperation` を使い、`onStart` でエラーを消す。初期化の取り直しはステータスと履歴、追加はステータスだけ
- `src/renderer/src/hooks/useGitRemoteOperations.ts`: `pushSetUpstream(): Promise<boolean>`（実際に実行され成功したか。成功の後のフォーカスの移動に使う）・`isSettingUpstream` を追加。取り直しはステータスと履歴（`refreshHistory` を末尾（4 番目）の省略可能な引数に足す。省略時はステータスだけ。`useAppState` は必ず渡す）
- `src/renderer/src/components/source-control/RemoteSetupInputDialog.tsx`（新規）: 1 項目の入力・実行中の案内・エラー・閉じる経路・フォーカスの扱いを持つ共通のダイアログ（`CreateTagDialog` と同じ見た目の枠）。`InitRepositoryDialog.tsx` と `AddRemoteDialog.tsx` は、これに検証と文言を渡すだけの薄い部品にする（`CreateBranchDialog` が `NameInputDialog` を包むのと同じ形。2 つのダイアログに同じ実行中の処理を書かない。パターン 55）
- `src/renderer/src/components/source-control/RemoteSetupBanner.tsx`（新規）: 状態バナー。`AddRemoteDialog` の開閉の状態をバナーの最上位で持ち、バナーの種類が変わってもダイアログを出し続ける（別のプロセスが先に origin を追加した場合も失敗の文言を見せる）
- `src/renderer/src/components/source-control/NotRepositoryView.tsx`（新規）: Git 管理外の表示（`Git リポジトリではありません` と `リポジトリを初期化`）。`InitRepositoryDialog` の開閉の状態を持つ。`isRepo` が真になると表示ごと外れるので、開いたままの状態が別のフォルダへ持ち越されない
- `src/renderer/src/hooks/useRemoteSetupFocus.ts`（新規）: 成功の後のフォーカスの要求の state を持ち、描画の後に `data-remote-setup-focus="<target>"` の要素へ移す（下の「配線」を参照）
- `src/renderer/src/hooks/useDialogFocusReturn.ts`（新規）: ボタンで開くダイアログの開閉と、閉じた後に開いたボタンへ戻すフォーカス（閉じるときに予約し、閉じて実行中でもなくなった描画の後、body のときだけ戻す）。`NotRepositoryView`・`RemoteSetupBanner`・タグの作成の `HistorySection` で共通（パターン 55）
- `src/renderer/src/hooks/useDialogFocusTrap.ts`（新規）: モーダルのダイアログの中で Tab / Shift+Tab を循環させる（`useDialogFocusTrap(containerRef, isOpen)`。`RemoteSetupInputDialog` で使う）
- `src/renderer/src/hooks/useFocusOnRunningEnd.ts`（新規）: 実行中が解けたときに、body（または `containerRef` の中）にあるフォーカスを対象へ戻す。`RemoteSetupInputDialog`・`RemoteSetupBanner`（`enabled` にエラーの有無）・タグの作成の `CreateTagDialog` で共通（パターン 55）
- `SourceControlPanel.tsx`: `isRepo=false` のときに `NotRepositoryView` を出す
- `GitRepoView.tsx`: `MergeBanner` の直後に `RemoteSetupBanner` を置き、`isBlocked`（`isBlockedByOtherOperation`）を渡す
- 配線: `useAppState` が `useGitRemoteSetup` を呼び、`remoteSetup`（`RemoteSetupPanelState`、`types.ts`。`useGitRemoteSetup` の値に、`useGitRemoteOperations` の `isSettingUpstream`・`isPushing`・`isPushBlocked`・`remoteOperationError`・`pushSetUpstream` を合成する。バナーのボタンの disabled と、案内を「実行中かつエラーなし」のときだけ出す判定に使う）を App → Sidebar → SourceControlPanel へ渡し、SourceControlPanel が GitRepoView と NotRepositoryView に渡す（タグの作成・マージ状態の配線に揃える）。成功後のフォーカスの移し先は、`SourceControlPanel` の `useRemoteSetupFocus(rootRef)` が要求の state を持ち、返す `requestFocus` を `NotRepositoryView` と（`GitRepoView` を経て）`RemoteSetupBanner` へ渡す。成功を受け取った部品がダイアログを閉じるのと同じ描画で要求し、フックが描画の後に移す（要求は 1 回だけ扱う）。要求する側も移す先もパネルの配下にあるため、`remoteSetup`（Git 操作の状態）には入れない（単一責任のレビューで `remoteSetup.focusRequest` から変更）

## エラーハンドリング

| 状況                                                                                    | 動作                                                                                                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| ブランチ名が空 / `-` 始まり / `@`                                                       | ダイアログ内に日本語で表示し、`初期化` を disabled。main も同じ理由で拒否                                                                   |
| ブランチ名が git の規則に違反（`HEAD`・`a..b`・`main.lock`）                            | main が `ブランチ名として使用できない名前です: <name>` で拒否し、ダイアログ内に表示                                                         |
| 既にリポジトリ（親フォルダを含む）                                                      | main が拒否（ボタンは通常出ない。別のプロセスが先に init した場合）                                                                         |
| `git init` の失敗（書き込み権限なしなど）                                               | `リポジトリを初期化できませんでした: <detail>`。`.git` の残骸は消さない                                                                     |
| URL が空・長すぎる・空白や改行・`-` 始まり・許可外の形式（パスワード入りの URL を含む） | ダイアログ内に日本語で表示し、`追加` を disabled。main も同じ規則で拒否（Windows のドライブの形だけは main が最終判断）                     |
| origin が既にある                                                                       | `リモート origin は既に設定されています`                                                                                                    |
| 初回 push: origin が無い / detached / コミットが無い / upstream が既にある              | それぞれの日本語の文言でパネル上部に表示。git は実行しない                                                                                  |
| 初回 push: 表示されない upstream の設定（`branch.<b>.remote` / `merge`）がある          | `upstream の設定が既にあるため、初回 push できません（設定先のリモートが無いか、fetch の設定が無いため表示されていません）`。設定は変えない |
| 開いたフォルダが存在しない（削除・移動された）                                          | 3 つの操作とも `フォルダが見つかりません: <path>`。git は実行しない                                                                         |
| bare リポジトリ・`.git` ディレクトリの中で初期化                                        | `このフォルダは既に Git リポジトリ（または親フォルダのリポジトリ）の中にあります`。`.git` を作らない                                        |
| 初回 push: non-fast-forward・権限なし・リポジトリが無い                                 | `初回 push に失敗しました: <detail>`。upstream は設定されない                                                                               |
| 初回 push: 30 秒間応答が無い（認証待ち・到達不能）                                      | `操作がタイムアウトしました。認証情報が未設定か、ネットワークに問題がある可能性があります`                                                  |
| 初回 push の後、upstream の設定を確かめられない                                         | `push は完了しましたが、upstream を設定できませんでした`。ステータスは取り直す                                                              |
| init・追加が 30 秒終わらない                                                            | それぞれ `…が時間内に終わりませんでした` をダイアログ内に表示                                                                               |
| 実行中に再度押す                                                                        | 二重に実行しない                                                                                                                            |

## 既知の制約

- `--initial-branch` は git 2.28 以降の機能。それより古い git では `git init` が失敗し、`リポジトリを初期化できませんでした: <detail>` になる
- 初期化の検証をすり抜けて `git init` が失敗すると、中身の無い `.git` が残る。正しい名前でもう一度初期化すれば直る
- ブランチ名の規則はブランチの作成と同じなので、`refs/heads/foo` のような名前も通る（`refs/heads/refs/heads/foo` になる。ブランチの作成と同じ既知の挙動）
- `hasOrigin` は利用者のグローバル設定の `remote.origin.*` も拾う。グローバル設定にだけ origin がある場合、バナーは出ない（そのリポジトリには `git remote add` で追加できる状態だが、アプリは追加を出さない。実機で確認）
- `hasRemote` も同じく、グローバル設定の `remote.<name>.*` を拾う。グローバル設定にだけリモートがある場合、`リモートが未設定です` は出ない
- `origin` 以外の名前のリモートだけを持つリポジトリには、アプリから `origin` を足す導線が無い（バナーを出さないため）。複数のリモートの管理は範囲外（ROADMAP の見送り項目）なので、必要なら端末で `git remote add origin <url>` する
- 手で設定した origin に fetch の refspec（`remote.origin.fetch`）が無いと、初回 push の後も `status.tracking` が空のままで、バナーが消えない（`branch.<b>.remote` / `merge` は設定される。実機で確認）。アプリが追加した origin には refspec が付くので起きない。この状態で初回 push をもう一度押すと、`upstream の設定が既にあるため、初回 push できません（設定先のリモートが無いか、fetch の設定が無いため表示されていません）` で拒否する（設定を上書きしない）
- bare リポジトリや `.git` ディレクトリ（とその中のフォルダ）を開くと、`getGitStatus` は `isRepo=false` を返すため `Git リポジトリではありません` と `リポジトリを初期化` が出る。押すと main が `このフォルダは既に Git リポジトリ（または親フォルダのリポジトリ）の中にあります` で拒否する（`.git` は作らない）。「作業ツリーの無いリポジトリ」として別の表示にするのは範囲外
- `url.<base>.insteadOf` / `pushInsteadOf` / `remote.origin.pushurl` は、入力した URL を書き換える。許可リストは入力した URL だけを見る。書き換えの設定は利用者自身の設定として尊重する
- パスワード入りの URL（`https://user:token@host/...`・`ssh://user:pw@host/...`）と、http・https・git:// の userinfo（user だけ・トークンだけも）は追加できない（利用者の決定）。https で資格情報を URL に書いていた利用者は credential helper（`git credential`・OS のキーチェーン・Git Credential Manager）を使う。ssh は鍵か `~/.ssh/config` を使う。拒否は違反の種類 `unsupported` のまま（違反の種類を増やすと main と renderer の表・判定の順序の変更が要るため見送る）で、文言 `使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）` の後半で資格情報が理由であることと認証の手段を伝える（コードレビュー 7 周目で後半を追加）
- Azure DevOps の「Clone」が出す https の URL（`https://org@dev.azure.com/org/proj/_git/repo`）は、userinfo が組織名 `org` と解析されるため `unsupported` で拒否する（user だけの userinfo の拒否と同じ。Bitbucket の `https://alice@bitbucket.org/…` も同じ）。回避策は `org@` を消した `https://dev.azure.com/org/proj/_git/repo` を入力すること（こちらは通る。認証は credential helper（Git Credential Manager など）に任せる）か、ssh の `git@ssh.dev.azure.com:v3/org/proj/repo` を使うこと。判定は shared の remoteUrl.test.ts の「実在のホスティングサービスの URL」で固定している
- 既存の push / pull / fetch の失敗の文言は資格情報を伏せない。`ssh://u:pw@host/...` や `tok123@host:path` の origin で ssh の認証に失敗すると、`u:pw@host: Permission denied (publickey).` が画面に出る（実機 git 2.50.1 で確認）。初回 push だけは伏せる。既存の操作への適用は ROADMAP の見送り項目の候補
- 引用符（`'` `"` `` ` ``）を含む URL（ローカルの `/…/O'Brien/b.git` など）は追加できない。端末で `git remote add` すれば使える
- path・query・fragment に `@`（`%40` を含む）がある URL（`https://host/a@b`・`git@host:a@b.git`）は追加できない。GitHub などの実在のリポジトリ名では稀なため許容する。端末で `git remote add` すれば使える
- authority（userinfo と host）に `%XX` を含む URL（`ssh://h%2Fx/r`・パーセントエンコードした IDN のホスト）と、`?` `#` で終わる authority（`https://h#frag`）は追加できない
- 資格情報を伏せる処理（`redactCredentials` の scp 形式のパターン）は、`@` を含む語を伏せすぎることがある。`@` を含むブランチ名（`' ! [rejected] me@fix -> me@fix'` → `' ! [rejected] ***@fix -> ***@fix'`）や、scp 形式で path に `@` がある URL（`'git@host:a@b.git'` → `'***@b.git'`）。秘密が漏れない方向の誤差（安全側）のため許容する（コードレビュー 4 周目で確認）
- 初期化は成功したが直後のステータスの取り直しが失敗すると、Git 管理外の表示のまま残る（取り直しの失敗は既存の refresh と同じく示さない）。フォーカスは `リポジトリを初期化` へ戻り、押すと `このフォルダは既に Git リポジトリ…` で拒否される。更新ボタンかフォルダの開き直しで表示が直る
- ツールバーの `プッシュ` は、upstream の無いブランチでは git の英語のエラー（`has no upstream branch`）のままになる。利用者の `push.default` / `push.autoSetupRemote` を尊重するため、事前の拒否はしない。バナーで初回 push に誘導する
- 初回 push がリモートの同名ブランチとの non-fast-forward で拒否されると、upstream が無いためアプリから pull できない。ターミナルで `git pull origin <b>` などで解決してもらう
- pre-push フックや資格情報ヘルパーの GUI（Windows の Git Credential Manager など）が 30 秒以上出力を出さずに待つと、既存の push と同じく打ち切られる
- 入れ子のリポジトリ（Git 管理下のフォルダの中の新しいリポジトリ）は作れない
- 初回 push の成功の後のフォーカスが、ツールバーの `プッシュ` ではなくバナーの `初回 push（upstream を設定）` へ移ることがある（極めてまれなので許容する。Task 8 のレビューで確認）。再現条件は次のすべて: (1) 初回 push の実行中に並行して走った fetch が失敗して `remoteOperationError` が残る（fetch は push と排他しない）、(2) その後に初回 push が成功する、(3) 成功してもバナーが残る（fetch の refspec の無い origin で upstream が表示されない）。このとき `RemoteSetupBanner` の「実行中が解けた・エラーがある」の effect（子。`useFocusOnRunningEnd`）が先に走ってバナーのボタンへフォーカスを移し、`useRemoteSetupFocus`（親）はフォーカスが body でないので何もしない。影響はフォーカスの移し先が変わるだけで、push の結果・データは失われない

## テスト方針

- `shared/remoteUrl`: 許可する形（`https://github.com/a/b.git`、`http://`、`ssh://git@host:22/a.git`、`git://host/a`、`file:///abs/bare.git`、`git@github.com:a/b.git`、`/abs/bare.git`、Windows のドライブの形を `windowsPaths` の真偽で）、拒否する形（`git://user:pass@host/a`・`git://user@host/a`、空、2049 文字、末尾以外の空白、改行、タブ、NUL、全角の空白、`-` 始まり、`--upload-pack=x`、`ext::sh -c x`、`fd::3`、`foo::bar`、`HTTPS://`、`unknown://x`、`ssh://-oProxyCommand=x/a`、`git@-x:a`、`file://host/a`、`../bare.git`、`host:path`、`[::1]:a`）、パスワード入りの URL（`https://user:pw@h/r`・`https://ghp_tok@h/r`・`ssh://u:pw@h/r`・`ssh://u%40x@h/r`・`https://alice:1234/s3cret@h/r`・`https://h#sec@h2/r` など）の拒否と `ssh://git@host/r`・`ec2-user@host:path` の許可、`parseNetworkUrl` の分解、判定の順序、`normalizeRemoteUrl`。開発中に一度だけ実行した大規模探索（スキーム × authority の各部 × path の `@` の組み合わせ 168,087 件。scratchpad でコミットしていない。差分 24）で、検証を通った URL を git・ssh の失敗の文言に埋め込んで `redactCredentials` を通し、パスワード・トークン・user の断片が残らないこと（ssh のユーザー名を除く）を確かめた。コミット済みの性質テストは、これを縮めた決定的な組み合わせ 7,290 件（スキーム・scp 形式・file://・絶対パス・Windows のドライブの形（`C:/` `C:\`） × 区切り `@ : / ? # %40 %3A %2F` を挟んだ断片。posix と windows の両方で検証し、通るのは 1,865 件と 3,323 件）で、(1) 検証を通った URL を git の解釈で分解しても userinfo に `:` が無いこと、(2) 「パスワード入りの URL を拒否する」方針の不変条件（authority は `/` か末尾で終わる・http・https・git:// の authority に `@` `%40` が無い・path・query・fragment に `@` `%40` が無い・scp の path に `@` が無い・ssh と scp の userinfo はユーザー名の文字種だけ）を満たすこと、を確かめる。通った件数が 0 でなく、scp・ssh の user あり・userinfo 無し・ドライブの形（windows だけで通る）の各形が通ることも確かめる（PR #42 のレビュー指摘で追加。(2) は 2 回目のレビューで、(1) だけでは authority の終わり・path の `@` `%40`・http・https・git:// の userinfo を緩める変異を検出できないと指摘されて足した）
- `shared/branchName`: `normalizeInitialBranchName`（前後の空白、NFD → NFC）
- `gitRemoteSetupService` の統合（実 git。`GIT_CONFIG_GLOBAL=/dev/null`・`GIT_CONFIG_NOSYSTEM=1` で環境を固定し、`init.defaultBranch` などの既定に依存しない。`GIT_CEILING_DIRECTORIES` に一時ディレクトリ（symlink を解決したもの）を入れ、`TMPDIR` がリポジトリの中にあっても `checkIsRepo` が親を拾わないようにする。パターン 46）:
  - init: `main` と `feat/x` と日本語の名前で `symbolic-ref HEAD` を確認。`HEAD`・`-x`・`@`・`a..b` は拒否され、`.git` が作られないこと。既にリポジトリのフォルダ、親がリポジトリのサブフォルダの拒否（`.git` が増えないこと）。`init.defaultBranch=trunk` があっても入力した名前になること
  - addOrigin: 各形式の追加と `remote get-url` の一致。拒否する形で `.git/config` が変わらないこと。origin の重複、`remote.origin.fetch` だけがある場合の拒否。追加で通信しないこと（到達できない URL でもすぐ終わる）
  - pushSetUpstream: ローカルの bare リポジトリ（絶対パスと `file://`）へ実際に送り、`branch.<b>.remote` / `merge` とリモートの ref を確認。detached HEAD、リベースで止めている間、コミット無し、origin 無し、upstream が既にある、同名のタグがある（完全な refspec で成功すること）、`-` で始まるブランチ名、non-fast-forward の拒否（upstream が設定されないこと）、`push.default=nothing` と `remote.origin.push` があっても成功すること、`protocol.ext.allow=always` の環境でも `ext::` が追加の時点で拒否されること
  - タイムアウトは値を注入できる形にし、実時間を待たずに確かめる（パターン 84）
- `gitService.getGitStatus`: `hasOrigin`・`hasRemote`（リモート無し・`origin` だけ・`origin` と別名・`git clone -o github` したリポジトリとその上の新しいブランチ）・`upstream`（設定済み・`gone`・ローカルの upstream・無し）・`detached`
- `gitHandlers`: 引数の型の検証、許可フォルダ。preload: 3 つの IPC チャネル
- renderer: `remoteSetupState`（状態の表の各行と、リモートの有無 3 通り × ブランチの位置 3 通り × `upstream` の有無 2 通りの全組み合わせ）、`remoteSetupValidation`、`RemoteSetupInputDialog`（実行中に閉じない 3 経路、`aria-busy` と案内、失敗で alert と入力欄へのフォーカス、再試行で古い alert が消える、IME の Escape、`aria-modal` と Tab の循環）、`useDialogFocusTrap`（循環・逆循環・外から入る・disabled と tabindex=-1 を飛ばす・対象が減っても循環・0 件でダイアログ自体・IME 中は奪わない・isOpen=false・アンマウントで解除）、`RemoteSetupBanner`（状態ごとの文言とボタンの disabled）、`useGitRemoteSetup`・`useGitRemoteOperations.pushSetUpstream`（成功・失敗のどちらでも取り直し、取り直しの後で実行中を下ろす、push と同時に走らない、開始時にエラーを消す）、成功後のフォーカスの移し先と「body のときだけ」。結合テストは実物のフックで、保留 → 操作 → 解決の順に作る（`act` の外で解決して `waitFor`。パターン 86）
  - （注記）clone の PR で、`validateRemoteUrl` と URL の文言の表は `lib/remoteUrlValidation.ts` へ移した（`remoteSetupValidation.ts` は `initRepositoryValidation.ts` に改名）
- 配線のテスト（`GitRepoView` / `SourceControlPanel` / `App`）は、タグの作成の既存のテストに揃える
- すべてのテストで、実装を壊すと落ちることを変異で確かめる（パターン 57・78）

## ドキュメント

- ROADMAP: 「リモートの管理」のうち init・origin の追加・初回 push を実装済みに移す。見送り項目として「リポジトリの clone」「複数のリモート・リモート名の変更」「リモートの URL の変更・削除」「追加前の接続確認」「初期コミット・`.gitignore` の自動作成」を追記する。既知の制約として「upstream の無いブランチでのツールバーの push は英語のエラーのまま」「初回 push が non-fast-forward で拒否されたときはアプリから pull できない」を追記する
- `docs/manual-test-spec.md`: 新しい領域（接頭辞 `RMT`）を足す。前提に「Git 管理外のフォルダ（`mktemp -d`）」と「bare リポジトリ（`git init --bare`）」の作り方を書く。確認項目の例: 管理外のフォルダで初期化ボタンが出る、既定の `main` での初期化と、パネルが切り替わって `リモートが未設定です` が出ること、`HEAD` や `a..b` の拒否、親がリポジトリのサブフォルダではボタンが出ない、bare の絶対パスでの origin の追加と `upstream が未設定です` への切り替わり、`ext::sh -c ...` と相対パスの拒否、コミット無しでの初回 push の拒否、初回 push の成功とバナーが消えること、detached HEAD でバナーが出ない、別クローンが同名ブランチを先に push したときの拒否（手順で別クローンを用意する。パターン 89）、実行中にダイアログを閉じられない、成功後のフォーカスの移り先
- 実装後、`docs/review-findings-patterns.md` への追記は、レビューで新しい種類の指摘が出たときだけ行う
