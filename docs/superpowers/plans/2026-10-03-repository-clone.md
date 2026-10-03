# リポジトリの clone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エクスプローラーの「フォルダを開く」の隣の `リポジトリを clone` から、URL とフォルダ名を入力し、保存先の親フォルダを OS のダイアログで選んで clone し、成功したらそのフォルダを開く。実行中は `キャンセル` で中止でき、出力が 60 秒途絶えたら打ち切る。中止・打ち切り・失敗では、git が起動した子プロセスまで止め、アプリが作った保存先だけを削除する。

**Architecture:** 規則は shared に置く（既定のフォルダ名の導出と名前の判定 `@shared/cloneFolderName`、無出力の打ち切り時間 `@shared/remoteTimeout` の `GIT_CLONE_IDLE_TIMEOUT_MS`、結果の型 `CloneRepositoryResult`）。URL の許可リストはリモートの管理の `@shared/remoteUrl` と `REMOTE_URL_RULE_MESSAGES` を再利用する。main は、子プロセスの実行だけを担う `gitCloneProcess.ts`（simple-git を使わず `spawn`。新しいプロセスグループで起動し、打ち切り・中止はグループごと SIGTERM → SIGKILL）と、検証・保存先の作成と削除・文言を担う `gitCloneService.ts` に分ける。IPC は `handlers/cloneHandlers.ts`（`git:cloneRepository` / `git:cancelCloneRepository`。OS のダイアログ・ウィンドウごとの実行中の登録 `cloneRegistry.ts`・成功したときだけ `FolderAccessManager.set`）。renderer は `useFileSystem.openFolder` から「選ばれたパスを開く」`applyOpenedFolder` を切り出し、`useCloneRepository`（確認・全体ロック・依頼・開く）と `CloneRepositoryDialog`（URL・フォルダ名・実行中の案内・中止）を `ExplorerPanel` に置く。状態と操作は `CloneRepositoryPanelState` 1 つにまとめ、`clone` という 1 つの props で App → Sidebar → ExplorerPanel へ渡す（リモートの管理の `remoteSetup` と同じ配線）。

**Tech Stack:** Electron / React 19 / TypeScript / git 2.50.1（Apple Git-155）/ simple-git 3.36.0（clone では使わない）/ Vitest 4 + Testing Library

**Spec:** [docs/superpowers/specs/2026-10-03-repository-clone-design.md](../specs/2026-10-03-repository-clone-design.md)

## 設計書との差異（実機 git 2.50.1・simple-git 3.36.0 で確認。実装はこちらに従う）

設計書の「設計書の確認事項」1〜8 を、プラン作成の最初に実機で確かめた（結果は設計書の同じ節に追記済み）。一時ディレクトリ（scratchpad）のローカルの bare リポジトリ・偽の ssh（`core.sshCommand`）・偽の git（PATH の先頭）・`127.0.0.1` の閉じたポート・ローカルの HTTP サーバー（応答しない／401 を返す）・ローカルの sshd（`127.0.0.1:22999`、使い捨ての鍵）を使い、ネットワークには出ていない。各項目は設計書の本文にも反映済み（「確認事項の結果で変更」「確認事項の検討で変更」と書いた箇所）。

1. （設計書へ反映済み）**clone は simple-git ではなく `child_process.spawn` で実行する**（`src/main/gitCloneProcess.ts`。当初の設計書は「simple-git の `timeout.block` と `abort`」）。simple-git の abort・timeout プラグインは `context.kill` → `spawned.kill('SIGINT')` で git 本体に SIGINT を送るだけで（SIGKILL への切り替えも無い。`node_modules/simple-git/dist/esm/index.js` の `abortPlugin`・`timeoutPlugin`・`gitResponse`）、実測では git は止まるが、git が起動した `git-remote-http`（応答しない HTTP サーバー相手）と偽の ssh とその子の `sleep` は孤児として残った。git の代わりの sh（`sleep` を待つ）は SIGINT で止まらず、Promise が解決しなかった（パターン 10・84）。
2. （設計書へ反映済み）**起動は POSIX で `detached: true`（新しいプロセスグループ）にし、打ち切り・中止はグループごと SIGTERM → 5 秒後も閉じなければ SIGKILL**（`CLONE_KILL_GRACE_MS`。cliService.ts・gitApply.ts と同じ 5 秒。エスカレーションのタイマーは `unref`）。実測で `git-remote-http`・偽の ssh とその子・SIGTERM を無視する sh まで止まり、孤児は残らなかった。結果は子プロセスの標準出力・標準エラーが閉じた後（`close`）に返すため、呼び出し側は全員が止まってから保存先を削除できる。Windows はプロセスグループが無いため `taskkill /pid <pid> /T /F`（実機で未確認。既知の制約）。
3. （設計書へ反映済み）**`detached` は ssh の未知のホスト鍵の確認を端末で待たせないためにも要る**（確認事項 6）。制御端末がある状態（`script` で擬似端末を付けた。端末から `npm run dev` で起動したアプリと同じ）で `detached` にしないと、ssh は端末に `Are you sure you want to continue connecting (yes/no/[fingerprint])?` を出して待ち続けた。`detached`（setsid で制御端末が外れる）なら、30ms 前後で `Host key verification failed.` で失敗した。`GIT_SSH_COMMAND` は設定しない（パターン 81）。
4. （設計書へ反映済み）**`-c protocol.ext.allow=never -c protocol.fd.allow=never` は `clone` の前（git の前）に置く**（当初の設計書は `git clone --progress -c … -- <url> <dest>`）。clone の `-c` は新しいリポジトリの `.git/config` に `protocol.ext.allow=never` を書き残した。git の `-c` は書き残さない。なお simple-git の blockUnsafeOperationsPlugin は、どちらの位置の `-c protocol.*.allow` も `Configuring protocol.allow is not permitted without enabling allowUnsafeProtocolOverride` で拒否した（`@simple-git/argv-parser` 1.1.1 の `i("protocol.allow", …)`）。spawn を使うため関係しない。git の既定では `fd::` が許可されていて、`git clone fd::3` は入力を待ち続けた（URL の許可リストが拒否するが、防御の 2 層として付ける）。https・http・ssh・git・file・scp 形式・絶対パスはどれも protocol の拒否にならずに進んだ（確認事項 5）。
5. （設計書へ反映済み）**`GIT_TERMINAL_PROMPT=0` は askpass を止めない**（確認事項 4）。`GIT_ASKPASS` が空なら、401 を返すサーバーへの clone は 20〜40ms で `fatal: could not read Username for 'http://127.0.0.1:<port>': terminal prompts disabled` で失敗した。しかし VS Code のターミナルから起動すると `GIT_ASKPASS` に VS Code の `askpass.sh` が入っていて、`GIT_TERMINAL_PROMPT=0` でも askpass が呼ばれて待った。askpass・`core.askPass`・credential helper は利用者の設定として上書きしない（パターン 81）。応答が無ければ無出力の 60 秒で打ち切る（既知の制約）。環境は親を引き継ぎ、`GIT_TERMINAL_PROMPT=0` だけを足す。
6. （設計書へ反映済み）**保存先は再帰しない `mkdir` で作ってから、その空のフォルダへ clone する**（当初の設計書は「存在しないことを確認し、存在確認と作成の間の競合は git clone 自身が『空でない既存フォルダ』を拒否することに任せる」）。git clone は空の既存フォルダへの clone を受け付ける（確認事項 7）ため、確認の後に別のプロセスが空のフォルダを作ると、それを自分のものとして失敗時に削除しうる。`mkdir` の `EEXIST` で既存（空のフォルダ・ファイル・壊れたリンクを含む）を拒否し、作ったのが自分であることを 1 回で確かめる（パターン 1）。作成済みの空のフォルダへの clone を SIGTERM で止めると git は中身を消して空のフォルダを残し、SIGKILL では `.git` が残った（どちらもサービスが削除する）。
7. （設計書へ反映済み）**失敗・中止の後の削除は、保存先が親フォルダの直下のディレクトリで、シンボリックリンクでないときだけ**（`lstat`）。実行中にリンクへ差し替えられていたら消さない（統合テストで偽の git が差し替える）。削除できなければ文言の後ろに `（途中まで作られた保存先のフォルダを削除できませんでした: <path>）` を添える（中止なら `clone を中止しました（…）` で reject）。
8. （設計書へ反映済み）**中止の要求が届いていれば、git が先に成功していても削除して `canceled`**（利用者が押した結果に合わせる）。
9. （設計書へ反映済み）**標準エラーは末尾の 64KB を残し（`MAX_CLONE_STDERR_BYTES`）、失敗の詳細からは進捗の行（`\d+% \(\d+/\d+\)` を含む行）と空行を除く**。`--progress` の進捗は巨大なリポジトリで数 MB になり、`fatal:` は末尾に出る。判定は数値の形で行い、文言の言語に依存しない（パターン 18・28）。詳細は `redactCredentials` で伏せる。
10. （設計書へ反映済み）**既定のフォルダ名の規則は git の既定の名前に揃える**（確認事項 8。`git clone <url>` の `Cloning into '<名前>'...` を実測した表を Task 1 のテストに載せた）。違いは、`<scheme>://` の形の query・fragment を落とす（git は `b.git?x=1` を名前に含める）ことと、ホストだけの URL・`.` になる形を空にする（git はホスト名・`.`）ことだけ。`\` も区切りにする（renderer は Windows のドライブの形も寛容に通すため）。
11. （設計書へ反映済み）**フォルダ名の検証は `assertValidEntryName` ではなく `@shared/cloneFolderName` の `getCloneFolderNameViolation`（`'empty' | 'invalid' | null`。判定は `isSafeEntryName`）と、各層の文言の表**。`assertValidEntryName` の文言（`無効な名前です: <name>`）は設計書のエラーの表（`フォルダ名に使えない文字が含まれています`）と違う。空は `フォルダ名を入力してください`（設計書の表に追加）。main（`CLONE_FOLDER_NAME_MESSAGES`）と renderer（`cloneValidation` の表）は同じ文言（パターン 88）。
12. （設計書へ反映済み）**URL とフォルダ名の検証は、OS のダイアログを出す前にも行う**（`assertValidCloneRequest`。IPC ハンドラが呼び、`cloneRepository` も呼ぶ）。不正な入力で保存先を選ばせない（パターン 94）。順序は「引数の型 → URL → フォルダ名 → 実行中の登録（`既に clone を実行中です`）→ OS のダイアログ」。
13. （設計書へ反映済み）**OS のダイアログは送信元のウィンドウのモーダル（macOS はシート）**（`chooseCloneParentDialog(BrowserWindow.fromWebContents(event.sender))`。タイトル `clone の保存先（親フォルダ）を選択`、ボタン `ここに clone`）。表示中は画面を操作できない（設計書の「OS のダイアログが開いている間は OS のダイアログで中止する」を構造で保証する）。表示中に中止された（ウィンドウを閉じた）ら、選ばれても clone へ進まない。成功の時点でウィンドウが閉じていたら（`event.sender.isDestroyed()`）許可を登録せずに `canceled` を返す。
14. （設計書へ反映済み）**`applyOpenedFolder(path, { dirtySnapshotAtConfirm })`**（当初の設計書は `applyOpenedFolder(path)`）と **`captureDirtySnapshot` の公開**。`openFolder` は「未保存の確認 → ダイアログ → ダイアログが返った時点の未保存の有無を基準に走査 → 走査の後に有無が変わっていれば再確認」で、ネイティブのダイアログはモーダルのため確認とダイアログの間に編集は入らない。clone は時間がかかるため、基準を「確認した時点」にしないと、clone 中に入った編集を確認なしで捨てる（ブランチ全体の最終レビューで位置づけを修正: clone 中はダイアログのオーバーレイが画面全体を覆い、フォーカスもダイアログ内に閉じ込められるため、画面からエディタを編集することは実際にはできない。この再確認は「画面からは到達しにくい、防御の層」として残す。clone 中に未保存の内容が変わる経路は今は無いが、将来オーバーレイが外れる・別の入口が増えたときのための防御として残す。リロードすると renderer の状態が消え clone も中止される（`did-start-navigation`）ため、リロードの後にこの再確認へ届く経路は無い）。さらに、基準を未保存の「有無」（真偽値）にすると、確認の時点で未保存があったタブをさらに編集した場合や別のタブを編集した場合（有無は true のまま）を見逃すため、`applyOpenedFolder` は確認の時点の未保存の**内容**（`captureDirtySnapshot()` の値。未保存のタブを path 順に並べた `[path, content]` の組の JSON）で比べ、未保存のタブがあり内容が変わっていれば再確認する（Task 5 のレビューで変更。当初のプランは `{ dirtyAtConfirm: boolean }` と `hasAnyDirtyTab` の公開だった）。`openFolder` は従来どおり（省略時はダイアログが返った時点の未保存の有無）で、既存のテストは変更せずに通る。
15. （設計書へ反映済み）**排他の具体**: clone の間は共有のロック（`useFileOperationLock`）の全体ロック（`lockGlobal`）を取り、ロックを見る Git 操作（commit・pull・push・ステージ・ブランチ操作・退避・取り消し・マージ・タグ・初期化・origin の追加）を始めさせない。ロックを見ない fetch と、エクスプローラーのファイル操作もロックでは塞がないが、clone 中のダイアログは閉じられず、オーバーレイが画面全体を覆ってフォーカスもダイアログ内に閉じ込めるため、画面からは始められない（ブランチ全体の最終レビューで修正。以前は「塞がない（既知の制約）」としていた。塞がれないのはメニューバーの操作とそのショートカット。実機では未確認で CLN-027 で確かめる）。逆向きの「Git 操作の実行中」は、`useAppState` が `isAnyLocked()` とロックを取らない操作の実行中フラグ（`isPushing`・`isFetching`・`isSettingUpstream`・`pendingBranchOperation !== null`・`stash.pendingOperation !== null`（退避の削除。drop はロックを取らない。Task 8 のレビューで追加し、合成を `useStashPanel` の後ろへ移した）・`gitTag.isCreating`・`isInitializing`・`isAddingOrigin`）から合成する。実行中フラグ（`isCloning`）は、成功の後のフォルダの読み込みが終わるまで下ろさない（パターン 73・96）。
16. （設計書へ反映済み）**「フォルダの読み込み中は押せない」は設けない**。読み込み中を表す状態が無い（`useFileSystem` の `pendingFolderOpenRef` は ref で描画に出ない）。`applyOpenedFolder` は `openFolder` と同じ選択の世代（`dialogAttemptRef`）を進めるため、実行中の `openFolder` のダイアログが後から返っても捨てられ、後の操作が勝つ。
17. （設計書へ反映済み）**未規定だった文言を確定する**（Global Constraints の表）: ボタン `リポジトリを clone`、ダイアログの説明、実行ボタン `保存先を選んで clone` / `clone 中…`、実行中の案内 `clone 中です。キャンセルで中止できます（応答が 60 秒途絶えると打ち切ります）`（秒は `GIT_CLONE_IDLE_TIMEOUT_SECONDS`）、他の操作中の案内 `他の Git 操作の実行中は clone できません`、IPC の型検証 `Invalid remote url` / `Invalid folder name`。
18. （設計書へ反映済み）**フォーカス**: 実行が始まったら `キャンセル` へ移す（実行ボタンが disabled になりフォーカスが body に落ちるため）。失敗・中止で解けたら URL の入力欄へ（`useFocusOnRunningEnd`）。成功・キャンセル・Escape・オーバーレイで閉じたら `リポジトリを clone` へ戻す（`useDialogFocusReturn`。clone 中でなくなった描画の後、body のときだけ）。いずれもダイアログの外へ移したフォーカスは奪わない（パターン 86）。
19. （設計書の範囲外: タスクの分割）**`useFileSystem` の分割は独立したタスク（Task 5）**にし、先に分け目の既存の挙動を固定するテストを新しいファイル（`useFileSystem.openFolder.test.ts`）に足してから分ける。既存の `useFileSystem.test.ts`（134 件）は変更しない。
20. （設計書の範囲外: テストの作り）**偽の git・偽の ssh を使うテストの打ち切りは 1.5 秒以上**。macOS は新しく作った実行ファイルの初回の起動を検査するため、偽のスクリプトが動き出すまで数百ミリ秒かかることがあり、300 ミリ秒の打ち切りでは pid を書く前に止められた（プラン作成時に実測）。ブランチ全体の最終レビューで、1.5 秒は無負荷の実測で、vitest を同時に 2 本以上走らせると起動が 1 秒を超えて落ちることが分かったため、打ち切り・SIGKILL のテストは 3 秒、「出力が続く間は打ち切らない」のテストは 2.5 秒（出力は 0.3 秒 × 12 回 = 3.6 秒）、pid のファイルを待つ上限は 10 秒、該当するテストの時間切れは 15 秒に広げた。さらに、時間を広げるだけでは同時 4 本で偽の git の起動が 3 秒を超えて落ちることがあったため、偽のスクリプトは作った直後に専用の引数（`--test-warmup`。本文を実行せずに終わる）で一度起動しておき、初回の起動の検査をテストの計測の外へ出した（同時 2 本・4 本で全て成功を確認）。pid を記録するスクリプトは `exec sleep 30` にして、テストの後始末（`afterEach` の SIGKILL）が実体を止められるようにする（変異で孤児が残っても次の実行に持ち越さない）。

設計書の仮定のうち、次は実機で確認でき、そのまま採用する。

- 標準エラーが端末でないと `git clone` は進捗を出さない（確認事項 1）。`--progress` を `--` の前に置く。simple-git の progress プラグインに任せると、末尾に足された `--progress` が suffixPathsPlugin で `--` の後ろへ移り、`fatal: Too many arguments.` で失敗した（`--progress` を自分で `--` の前に置けば足されない）。
- simple-git の `timeout.block` は既定で標準エラーの出力も数える（確認事項 2。自前の実装も同じ数え方にする）。
- ローカルの絶対パス・作業ツリーのあるリポジトリ・`file://`（末尾の `/`・日本語のパス）・シンボリックリンク経由のパスの clone は成功する（確認事項 7）。別のリポジトリの中の親フォルダへの clone も成功し、入れ子のリポジトリになる（`initRepository` の「既にリポジトリか」の判定とは関係しない）。
- `-c protocol.ext.allow=never -c protocol.fd.allow=never` は許可リストの形式の clone を妨げない（確認事項 5）。

## Global Constraints

- 返答・コメント・エラーメッセージ・テスト名は日本語。型だけの import は `import type`（CLAUDE.md）。
- `'use client'`: CLAUDE.md は「クライアントコンポーネントには必ず宣言」。この renderer（Electron + Vite。React Server Components は無い）では動作に影響しない指示子で、既存のファイルは混在している（`components/progress`・`prompts`・`history` の 25 ファイルは宣言あり、`components/explorer`・`source-control` は無し。プラン作成時に `grep -rln "^'use client'" src` で確認）。規約に従い、**新しいコンポーネント `CloneRepositoryDialog.tsx` の先頭に `'use client'` を置く**。変更する既存のコンポーネント（`ExplorerPanel.tsx`・`Sidebar.tsx`・`App.tsx`）には足さない（差分を機能に限る）。フック・lib・テストには置かない。
- `git commit` / `git push` は、ユーザーの明示的な指示があるまで行わない（SDD 中はコミットしない運用。各タスクのコミット手順は飛ばす）。`git add -A` は使わない。ブランチを切り替えない（`git branch --show-current` が `feat/repository-clone`）。
- Copilot へのレビュー依頼・監視（`scripts/request-copilot-review.sh`・`scripts/watch-pr-review.sh`）は行わない（停止中。レビューはローカルで回す）。
- 実機（Electron）の確認手順はプランに書かない。実機テスト仕様書 `docs/manual-test-spec.md` に新しい領域（接頭辞 `CLN`）を追記する（Task 9）。Artifact の再公開は親（コントローラー）が行う。
- simple-git を clone に使わない（差異 1）。他の操作の simple-git の使い方（`env()` を使わない等）は変えない。git のエラーメッセージ文字列で分岐しない（パターン 18）。
- テストは TDD（失敗するテスト → 実装 → 成功）。実装後の検知力の確認は、`mktemp -d` の新しいディレクトリへ実装ファイルを `cp` で退避 → 変異 → 該当のテストが落ちることを確認 → 復元 → `cmp` で一致を確認、の手順で行う（`git stash` は使わない。パターン 57・78）。変異は、ファイル全体の実行と `-t` による単独の実行の両方で確かめる（パターン 103）。変異で孤児が残りうるタスク（Task 2・3）は、最後に `pgrep -fl 'sleep 30'` が空であることを確かめ、残っていれば `kill -9` する。
- `act(...).then(...)` 形式でテストを書かない（`await act(async () => { ... })`）。テストのモックは、そのテストが依存する実装を `beforeEach`（`vi.resetAllMocks()` / `mockReset()` の後に設定し直す）かテストの中の `Once` で設定し、前のテストの持続する実装に頼らない（パターン 103）。テストで `setTimeout` を使う場合は ID を保持して `afterEach` で消す（`delay` ヘルパの `timers` の Set）。
- CLAUDE.md の規約: 新しいボタンには `aria-label`（可視の文言を含む。パターン 76）。リストの `key` に表示文言を使わない（このプランでは新しいリストを作らない）。選択状態を表す UI は作らない（radiogroup は不要）。暗色固定のテーマに合わせる（`main.css` の既存の色と共通のボタンの規則）。
- 型・チャネル（完全一致）:
  - `src/shared/types/git.ts`: `CloneRepositoryResult = { status: 'cloned'; path: string } | { status: 'canceled' }`
  - `src/shared/remoteTimeout.ts`: `GIT_CLONE_IDLE_TIMEOUT_MS = 60_000`、`GIT_CLONE_IDLE_TIMEOUT_SECONDS = GIT_CLONE_IDLE_TIMEOUT_MS / 1000`
  - `src/shared/cloneFolderName.ts`: `deriveCloneFolderName(url: string): string`、`type CloneFolderNameViolation = 'empty' | 'invalid'`、`getCloneFolderNameViolation(name: string): CloneFolderNameViolation | null`
  - `src/main/gitCloneProcess.ts`: `runGitCloneProcess(options: GitCloneProcessOptions): Promise<GitCloneProcessResult>`、`GitCloneProcessOptions = { args; cwd; signal; idleTimeoutMs; killGraceMs? }`、`GitCloneProcessResult = { kind: 'exited'; code: number | null; stderr: string } | { kind: 'aborted' } | { kind: 'timed-out' } | { kind: 'spawn-failed'; error: Error }`、`MAX_CLONE_STDERR_BYTES = 64 * 1024`、`CLONE_KILL_GRACE_MS = 5_000`
  - `src/main/gitCloneService.ts`: `cloneRepository(rawUrl, folderName, parentDir, signal, options?: CloneRepositoryOptions): Promise<CloneRepositoryResult>`、`assertValidCloneRequest(rawUrl, folderName, windowsPaths = process.platform === 'win32'): string`（正規化した URL を返す）、`toCloneFailureDetail(stderr): string`、`cleanupFailedNote(destination): string`、`CLONE_PROTOCOL_GUARD_ARGS`、文言の定数（下の表）
  - `src/main/cloneRegistry.ts`: `class CloneRegistry { begin(ownerId): AbortController; end(ownerId, controller): void; cancel(ownerId): void; isRunning(ownerId): boolean }`、`setupCloneLifecycle(app, registry): void`、`CLONE_ALREADY_RUNNING_MESSAGE = '既に clone を実行中です'`
  - `src/main/dialogService.ts`: `chooseCloneParentDialog(window: BrowserWindow | null): Promise<string | null>`
  - `src/main/handlers/cloneHandlers.ts`: `registerCloneHandlers(ipcMain, folderAccess, registry): void`
  - IPC チャネル: `git:cloneRepository`（引数は URL の文字列とフォルダ名の文字列、戻り値 `Promise<CloneRepositoryResult>`）、`git:cancelCloneRepository`（引数なし、戻り値 `Promise<void>`）
  - preload / `gitApi`: `cloneRepository(url: string, folderName: string): Promise<CloneRepositoryResult>`、`cancelCloneRepository(): Promise<void>`
  - `src/renderer/src/hooks/useFileSystem.ts`: `applyOpenedFolder(path: string, options: ApplyOpenedFolderOptions): Promise<void>`、`ApplyOpenedFolderOptions = { dirtySnapshotAtConfirm: string }`、`captureDirtySnapshot(): string`
  - `src/renderer/src/types.ts`: `CloneRepositoryPanelState = { isCloning; isBlocked; error; cloneRepository(url, folderName): Promise<boolean>; cancelClone(): void; clearError(): void }`
  - `src/renderer/src/hooks/useCloneRepository.ts`: `useCloneRepository(options: UseCloneRepositoryOptions): CloneRepositoryPanelState`、`UseCloneRepositoryOptions = { captureDirtySnapshot; confirmDiscardAnyDirty; applyOpenedFolder; lock: FileOperationLock; isGitOperationRunning: boolean }`
  - `src/renderer/src/lib/cloneValidation.ts`: `validateCloneFolderName(name: string): string | null`
  - `src/renderer/src/components/explorer/CloneRepositoryDialog.tsx`: props `{ isCloning; isBlocked; error; onSubmit(url, folderName); onCancelClone(); onClose() }`、`CLONE_RUNNING_NOTICE`・`CLONE_BLOCKED_NOTICE`
- main の検証と実行の順序（前の段に失敗したら後の段には進まない）:
  - IPC `git:cloneRepository`: 0. 引数の型（`Invalid remote url` / `Invalid folder name`）→ 1. `assertValidCloneRequest`（URL の 5 つの違反 → フォルダ名の 2 つの違反）→ 2. `registry.begin`（`既に clone を実行中です`）→ 3. OS のダイアログ（取り消し・中止は `canceled`）→ 4. `cloneRepository` → 5. `cloned` で、ウィンドウが生きていれば `folderAccess.set(id, path)` → finally `registry.end`
  - `cloneRepository`: 1. `assertValidCloneRequest` → 2. 親フォルダ（絶対パス・`realpath`・ディレクトリ）→ 3. 中止済みなら `canceled`（保存先を作らない）→ 4. `mkdir(<親の実体>/<名前>)`（再帰しない）→ 5. `runGitCloneProcess`（`['-c','protocol.ext.allow=never','-c','protocol.fd.allow=never','clone','--progress','--',<url>,<保存先>]`、cwd は親の実体）→ 6. 終了コード 0 かつ中止なし → `realpath(保存先)` で `cloned` / それ以外は保存先の削除の後に、中止 → `canceled`、打ち切り → 時間切れの文言、起動失敗・終了コード 0 以外 → 失敗の文言
- main のエラー文言（完全一致）:

| 状況                                       | 文言                                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL の規則違反                             | `REMOTE_URL_RULE_MESSAGES`（`gitRemoteSetupService.ts`。リモートの追加と同じ 5 つ）                                                                                  |
| フォルダ名が空                             | `フォルダ名を入力してください`                                                                                                                                       |
| フォルダ名が不正                           | `フォルダ名に使えない文字が含まれています`                                                                                                                           |
| 親フォルダが無い・フォルダでない・相対パス | `保存先の親フォルダが見つかりません`                                                                                                                                 |
| 保存先が既にある                           | `保存先に同名のフォルダがあります`                                                                                                                                   |
| 既に clone 中                              | `既に clone を実行中です`                                                                                                                                            |
| 無出力の打ち切り                           | `clone が時間内に進みませんでした（認証の待ち、または通信の停止の可能性があります）`                                                                                 |
| git の失敗・起動の失敗                     | `リポジトリを clone できませんでした: <詳細>`（詳細が空なら `リポジトリを clone できませんでした`。詳細は進捗の行を除いた標準エラーを `redactCredentials` で伏せる） |
| 保存先を削除できなかった                   | 上の文言の後ろに `（途中まで作られた保存先のフォルダを削除できませんでした: <path>）`。中止のときは `clone を中止しました（途中まで…: <path>）`                      |

- UI 文言と ARIA（完全一致）:
  - エクスプローラー: ボタン `リポジトリを clone`（`aria-label="リポジトリを clone"`）。フォルダが未選択なら `フォルダを開く` の下、開いていれば `フォルダを変更` の下。clone 中・他の Git 操作の実行中は disabled。`フォルダを開く` / `フォルダを変更` は clone 中だけ disabled
  - ダイアログ: `role="dialog"`・`aria-modal="true"`、見出し `リポジトリを clone`（`aria-labelledby`）、説明 `保存先の親フォルダを選ぶと、その中にフォルダを作って取得し、そのフォルダを開きます`（`aria-describedby`）、可視のラベル `URL`（開いたときにフォーカス）と `フォルダ名`、実行ボタン `保存先を選んで clone`（実行中 `clone 中…`）、`キャンセル`。検証の文言は入力欄の `aria-describedby` と `aria-invalid`。URL の文言は `REMOTE_URL_RULE_VIOLATION_MESSAGES`（`remoteSetupValidation.validateRemoteUrl`）。フォルダ名は `フォルダ名を入力してください` / `フォルダ名に使えない文字が含まれています`
  - 実行中: 案内 `clone 中です。キャンセルで中止できます（応答が 60 秒途絶えると打ち切ります）`（`role="status"`。`isCloning && error === null` のときだけ。form の `aria-busy` も同じ条件。パターン 87）。入力欄・実行ボタンは disabled、`キャンセル` は押せて clone を中止する。Escape・オーバーレイでは閉じない
  - 他の Git 操作の実行中（`isBlocked && !isCloning`）: `他の Git 操作の実行中は clone できません`（`role="status"`）。実行ボタンは disabled
  - 失敗: `role="alert"`。ダイアログは開いたまま、入力を保持する。開き直すと消える（`clearError`）
  - タップ領域: `リポジトリを clone` は 32px 以上（共通の枠付きボタンの規則に入れる）
- 排他（差異 15）: clone は自身の実行中・`isGitOperationRunning`・`lock.isAnyLocked()` の間 no-op（確認も出さない）。実行中は `lock.lockGlobal()`、成功の後のフォルダの読み込みまで終えてから `unlockGlobal()` と実行中の解除。開始時に前回のエラーを消す（パターン 87）。

## File Structure

| ファイル                                                                                        | 責務                                                                        | 変更   |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------ |
| `src/shared/cloneFolderName.ts`                                                                 | 既定のフォルダ名の導出・フォルダ名の判定                                    | Create |
| `src/shared/remoteTimeout.ts`                                                                   | `GIT_CLONE_IDLE_TIMEOUT_MS` / `GIT_CLONE_IDLE_TIMEOUT_SECONDS`              | Modify |
| `src/shared/types/git.ts`                                                                       | `CloneRepositoryResult`                                                     | Modify |
| `src/main/gitCloneProcess.ts`                                                                   | spawn・無出力の打ち切り・中止・プロセスグループごとの停止・標準エラーの末尾 | Create |
| `src/main/gitCloneService.ts`                                                                   | 検証・保存先の作成と削除・失敗の文言                                        | Create |
| `src/main/cloneRegistry.ts`                                                                     | ウィンドウごとの実行中の登録・中止・ウィンドウを閉じたときの中止            | Create |
| `src/main/dialogService.ts`                                                                     | `chooseCloneParentDialog`                                                   | Modify |
| `src/main/handlers/cloneHandlers.ts`                                                            | IPC 2 つ・引数の型検証・OS のダイアログ・`FolderAccessManager` への登録     | Create |
| `src/main/ipcHandlers.ts`                                                                       | 登録                                                                        | Modify |
| `src/preload/api.ts` / `src/preload/index.d.ts`                                                 | `cloneRepository` / `cancelCloneRepository`                                 | Modify |
| `src/renderer/src/lib/gitApi.ts`                                                                | 同上                                                                        | Modify |
| `src/renderer/src/hooks/useFileSystem.ts`                                                       | `runFolderOpen` への切り出し・`applyOpenedFolder`・`captureDirtySnapshot`   | Modify |
| `src/renderer/src/types.ts`                                                                     | `CloneRepositoryPanelState`                                                 | Modify |
| `src/renderer/src/lib/cloneValidation.ts`                                                       | フォルダ名の検証の文言                                                      | Create |
| `src/renderer/src/hooks/useCloneRepository.ts`                                                  | 確認・全体ロック・依頼・開く・中止・エラー                                  | Create |
| `src/renderer/src/components/explorer/CloneRepositoryDialog.tsx`                                | URL・フォルダ名・実行中の案内・中止・閉じる経路・フォーカス                 | Create |
| `src/renderer/src/assets/main.css`                                                              | ダイアログ・ボタンの見た目（既存のグループセレクタに足す）                  | Modify |
| `src/renderer/src/components/explorer/ExplorerPanel.tsx`                                        | ボタン・無効化・ダイアログの開閉                                            | Modify |
| `src/renderer/src/components/Sidebar.tsx` / `src/renderer/src/App.tsx` / `hooks/useAppState.ts` | `clone` の配線・Git 操作の実行中の合成                                      | Modify |
| `src/renderer/src/__tests__/makeCloneRepositoryPanelState.ts`                                   | テスト用の型付きモック                                                      | Create |
| テスト（新規 13・変更 8）                                                                       | 各タスクを参照                                                              | —      |
| `ROADMAP.md` / `docs/manual-test-spec.md`                                                       | 実装済みへの移動・見送り・既知の制約 / 領域 `CLN`                           | Modify |

---

### Task 1: shared の規則（既定のフォルダ名・フォルダ名の判定・無出力の打ち切り時間・結果の型）

**Files:**

- Create: `src/shared/cloneFolderName.ts`, `src/shared/__tests__/cloneFolderName.test.ts`
- Modify: `src/shared/remoteTimeout.ts`, `src/shared/__tests__/remoteTimeout.test.ts`, `src/shared/types/git.ts`

**Interfaces:**

- Consumes: `isSafeEntryName`（`@shared/entryName`）、`normalizeRemoteUrl` / `getRemoteUrlRuleViolation`（`@shared/remoteUrl`。テストだけ）
- Produces: `deriveCloneFolderName` / `getCloneFolderNameViolation` / `CloneFolderNameViolation`（`@shared/cloneFolderName`）、`GIT_CLONE_IDLE_TIMEOUT_MS` / `GIT_CLONE_IDLE_TIMEOUT_SECONDS`（`@shared/remoteTimeout`）、`CloneRepositoryResult`（`@shared/types`）
- 注: 既定のフォルダ名は renderer だけが使うが、規則を 1 か所で固定するため shared に置く（パターン 88）。表の「git の名前」は確認事項 8 の実測（設計書）

- [ ] **Step 1: 失敗するテストを書く**

`src/shared/__tests__/cloneFolderName.test.ts`（新規。全文）:

```ts
import { describe, it, expect } from 'vitest'
import { deriveCloneFolderName, getCloneFolderNameViolation } from '../cloneFolderName'
import { getRemoteUrlRuleViolation } from '../remoteUrl'

// 期待値の「git」の列は、実機 git 2.50.1 で `git clone <url>`(保存先を省略)が出した `Cloning into '<名前>'...`
// (ネットワークに出ないよう、ホストは 127.0.0.1 の閉じたポート・偽の ssh で確認)。アプリの規則は git に揃え、
// 食い違うのは query・fragment(git は名前に含める)・ホストだけ・`.` になる形(git はホスト名・`.` を使う)だけ
describe('deriveCloneFolderName', () => {
  it.each([
    // [URL, アプリの既定値, git の名前]
    ['https://github.com/a/b.git', 'b', 'b'],
    ['https://github.com/a/b', 'b', 'b'],
    ['https://github.com/a/b/', 'b', 'b'],
    ['https://github.com/a/b.git/', 'b', 'b'],
    ['https://github.com/a/b.git///', 'b', 'b'],
    ['https://github.com/a/b/.git', 'b', 'b'],
    ['https://github.com/a/b/.git/', 'b', 'b'],
    ['https://github.com/a/b.git.git', 'b.git', 'b.git'],
    ['https://github.com/a/b.c.git', 'b.c', 'b.c'],
    ['https://github.com/a/b.GIT', 'b.GIT', 'b.GIT'],
    ['https://github.com/a/b.bundle', 'b.bundle', 'b.bundle'],
    ['https://host:8443/~user/repo.git', 'repo', 'repo'],
    ['https://github.com/a/%E6%97%A5.git', '%E6%97%A5', '%E6%97%A5'],
    ['https://github.com/a/-x.git', '-x', '-x'],
    ['https://github.com/a/b:c.git', 'c', 'c'],
    ['http://example.com/a.git', 'a', 'a'],
    ['ssh://git@host:22/a/b.git', 'b', 'b'],
    ['ssh://git@host/b.git', 'b', 'b'],
    ['ssh://host/a/b', 'b', 'b'],
    ['git://host:9418/a/b.git', 'b', 'b'],
    ['git@github.com:a/b.git', 'b', 'b'],
    ['git@github.com:b.git', 'b', 'b'],
    ['git@github.com:b', 'b', 'b'],
    ['git@github.com:a/b/', 'b', 'b'],
    ['file:///abs/bare.git', 'bare', 'bare'],
    ['/abs/path/repo.git', 'repo', 'repo'],
    ['/abs/path/repo.git/', 'repo', 'repo'],
    ['/abs/worktree-repo', 'worktree-repo', 'worktree-repo'],
    ['/abs/worktree-repo/.git', 'worktree-repo', 'worktree-repo'],
    ['/abs/日本語/リポ.git', 'リポ', 'リポ'],
    ['  https://github.com/a/b.git \n', 'b', 'b']
  ])('%s は %s(git も %s)', (url, expected) => {
    expect(deriveCloneFolderName(url)).toBe(expected)
  })

  // git と食い違う形。名前として使いにくい・使えないため、アプリは query・fragment を落とすか空にする(利用者が入力する)
  it.each([
    // [URL, アプリの既定値, git の名前]
    ['https://github.com/a/b.git?x=1', 'b', 'b.git?x=1'],
    ['https://github.com/a/b?x=1', 'b', 'b?x=1'],
    ['https://github.com/a/b.git#frag', 'b', 'b.git#frag'],
    ['https://github.com/a/b#frag', 'b', 'b#frag'],
    ['https://github.com', '', 'github.com'],
    ['https://github.com/', '', 'github.com'],
    ['ssh://host', '', 'host'],
    ['git@host:', '', 'host'],
    ['git@host:/', '', 'host'],
    ['https://github.com/a/..git', '', '.'],
    ['', '', '(URL が無い)']
  ])('%s は %s(git は %s)', (url, expected) => {
    expect(deriveCloneFolderName(url)).toBe(expected)
  })

  // scp 形式・絶対パスの `?` `#` はパスの一部(git と同じく名前に残す)
  it('scp 形式の ? は名前に残す', () => {
    expect(deriveCloneFolderName('git@host:a/b.git?x')).toBe('b.git?x')
  })

  // renderer は Windows のドライブの形も寛容に通す(validateRemoteUrl の windowsPaths: true)ため、名前も決める
  it.each([
    ['C:\\repos\\bare.git', 'bare'],
    ['C:\\repos\\bare.git\\', 'bare'],
    ['C:/repos/bare.git', 'bare'],
    ['C:\\repos\\work\\.git', 'work'],
    ['C:\\', '']
  ])('Windows のドライブの形 %s は %s', (url, expected) => {
    expect(deriveCloneFolderName(url)).toBe(expected)
  })

  // 既定値は、そのまま保存先の名前の検証を通るか空(空なら利用者に入力させる)
  it('既定値は空か、名前の検証を通る', () => {
    const urls = [
      'https://github.com/a/b.git',
      'https://github.com/a/..git',
      'https://github.com/a/.git',
      'git@host:a/ b .git',
      'git@host:a/\u3000.git',
      'https://github.com'
    ]
    for (const url of urls) {
      const name = deriveCloneFolderName(url)
      expect(name === '' || getCloneFolderNameViolation(name) === null).toBe(true)
    }
  })

  // URL の許可リスト(@shared/remoteUrl)を通る代表の形は、すべて空でない名前になる(ダイアログの既定値が出る)
  it('許可リストを通る代表の URL は空でない名前になる', () => {
    const allowed = [
      'https://github.com/a/b.git',
      'http://example.com/a.git',
      'ssh://git@host:22/a.git',
      'git://host/a',
      'git@github.com:a/b.git',
      'file:///abs/bare.git',
      '/abs/bare.git'
    ]
    for (const url of allowed) {
      expect(getRemoteUrlRuleViolation(url, { windowsPaths: false })).toBeNull()
      expect(deriveCloneFolderName(url)).not.toBe('')
    }
  })
})

describe('getCloneFolderNameViolation', () => {
  it.each(['b', 'my-repo', 'リポ', 'b.git', '-x', 'a b', '.hidden'])('%s は使える', (name) => {
    expect(getCloneFolderNameViolation(name)).toBeNull()
  })

  it.each(['', ' ', '\u3000', '\n'])('空・空白だけ(%j)は empty', (name) => {
    expect(getCloneFolderNameViolation(name)).toBe('empty')
  })

  it.each(['.', '..', 'a/b', 'a\\b', '/abs', ' b', 'b ', '../x'])('%j は invalid', (name) => {
    expect(getCloneFolderNameViolation(name)).toBe('invalid')
  })
})
```

`src/shared/__tests__/remoteTimeout.test.ts`（変更。差分）:

```diff
--- a/src/shared/__tests__/remoteTimeout.test.ts
+++ b/src/shared/__tests__/remoteTimeout.test.ts
@@ -1,5 +1,10 @@
 import { describe, it, expect } from 'vitest'
-import { GIT_REMOTE_TIMEOUT_MS, GIT_REMOTE_TIMEOUT_SECONDS } from '../remoteTimeout'
+import {
+  GIT_CLONE_IDLE_TIMEOUT_MS,
+  GIT_CLONE_IDLE_TIMEOUT_SECONDS,
+  GIT_REMOTE_TIMEOUT_MS,
+  GIT_REMOTE_TIMEOUT_SECONDS
+} from '../remoteTimeout'

 // main の打ち切り(push / pull / fetch / 初回 push)と renderer の初回 push 中の案内(「応答が N 秒途絶えると
 // 打ち切ります」)が同じ値を使う(パターン 88)。値を変えるときは manual-test-spec の RMT の項目も直す
@@ -15,3 +20,17 @@ describe('GIT_REMOTE_TIMEOUT_MS', () => {
     expect(Number.isInteger(GIT_REMOTE_TIMEOUT_SECONDS)).toBe(true)
   })
 })
+
+// main の clone の打ち切り(出力が途絶えた時間)と renderer の clone 中の案内が同じ値を使う(パターン 88)。
+// 値を変えるときは manual-test-spec の CLN の項目も直す
+describe('GIT_CLONE_IDLE_TIMEOUT_MS', () => {
+  it('60 秒', () => {
+    expect(GIT_CLONE_IDLE_TIMEOUT_MS).toBe(60_000)
+  })
+
+  it('1000 の倍数で、GIT_CLONE_IDLE_TIMEOUT_SECONDS はその秒数', () => {
+    expect(GIT_CLONE_IDLE_TIMEOUT_MS % 1000).toBe(0)
+    expect(GIT_CLONE_IDLE_TIMEOUT_SECONDS).toBe(GIT_CLONE_IDLE_TIMEOUT_MS / 1000)
+    expect(Number.isInteger(GIT_CLONE_IDLE_TIMEOUT_SECONDS)).toBe(true)
+  })
+})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run src/shared/__tests__/cloneFolderName.test.ts src/shared/__tests__/remoteTimeout.test.ts
```

Expected: FAIL（`../cloneFolderName` が無い。`GIT_CLONE_IDLE_TIMEOUT_MS` が export されていない）

- [ ] **Step 3: 実装する**

`src/shared/cloneFolderName.ts`（新規。全文）:

```ts
import { isSafeEntryName } from './entryName'
import { normalizeRemoteUrl } from './remoteUrl'

// clone の保存先のフォルダ名の規則。既定のフォルダ名の導出(deriveCloneFolderName)は renderer(CloneRepositoryDialog)だけが
// 使うが、URL の形式の網羅(@shared/remoteUrl のテスト)と揃えて規則を 1 か所で固定するため shared に置く(パターン 88)。
// 名前の検証(getCloneFolderNameViolation)は main(gitCloneService の入口)と renderer(ダイアログ)が同じ判定を使い、
// 文言は各側の表で持つ

// URL の形式(`<scheme>://`)。query・fragment を落とすのはこの形だけ(scp 形式・絶対パスの `?` `#` はパスの一部)
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//
// 末尾のリポジトリ名の区切り。git は `/` と `:` で切る(`https://h/a/b:c.git` は `c`。実機 git 2.50.1 で確認)。
// Windows のドライブの形(`C:\repos\x.git`)のために `\` も区切りにする
const SEGMENT_SEPARATOR_PATTERN = /[/\\:]/

// URL から既定のフォルダ名を決める(git clone が保存先を省略したときの名前の規則に揃える。実機 git 2.50.1 で確認)。
// 1. 前後の空白を除く(normalizeRemoteUrl。main の入口と同じ)
// 2. `<scheme>://` の形だけ、最初の `?` `#` から後ろを落とす(git は `b.git?x=1` をそのまま名前にするが、名前として
//    使いにくいため落とす。利用者は編集できる)
// 3. 末尾の `/` `\` を除き、続けて末尾の `/.git`、末尾の `.git`(1 回だけ。大文字小文字を区別する)を除く
// 4. 最後の `/` `\` `:` より後ろを名前にする(`%XX` は decode しない。git と同じ)
// 5. 名前として使えない(空・`.`・`..`・前後の空白)なら空文字(ホストだけの URL など。利用者が入力する)
export function deriveCloneFolderName(url: string): string {
  let rest = normalizeRemoteUrl(url)
  if (SCHEME_PATTERN.test(rest)) {
    const authorityStart = rest.indexOf('://') + 3
    const cut = rest.slice(authorityStart).search(/[?#]/)
    if (cut !== -1) rest = rest.slice(0, authorityStart + cut)
    // ホストだけ(`https://h`・`https://h/`)は名前が無い
    const pathStart = rest.indexOf('/', authorityStart)
    if (pathStart === -1) return ''
    rest = rest.slice(pathStart)
  }
  rest = rest.replace(/[/\\]+$/, '')
  if (rest.endsWith('/.git') || rest.endsWith('\\.git')) rest = rest.slice(0, -'/.git'.length)
  if (rest.endsWith('.git')) rest = rest.slice(0, -'.git'.length)
  const segments = rest.split(SEGMENT_SEPARATOR_PATTERN)
  const name = segments[segments.length - 1] ?? ''
  return isSafeEntryName(name) ? name : ''
}

export type CloneFolderNameViolation = 'empty' | 'invalid'

// 保存先のフォルダ名として使えるか。空(空白だけを含む) → 'empty'、パス区切り・`.`・`..`・前後の空白 → 'invalid'
// (新規作成・リネームと同じ @shared/entryName の規則)。保存先は親フォルダの直下に限るため、パス区切りを拒否する
export function getCloneFolderNameViolation(name: string): CloneFolderNameViolation | null {
  if (name.trim() === '') return 'empty'
  return isSafeEntryName(name) ? null : 'invalid'
}
```

`src/shared/remoteTimeout.ts`（変更。差分）:

```diff
--- a/src/shared/remoteTimeout.ts
+++ b/src/shared/remoteTimeout.ts
@@ -7,3 +7,12 @@ export const GIT_REMOTE_TIMEOUT_MS = 30_000

 // 初回 push 中の案内に出す秒数
 export const GIT_REMOTE_TIMEOUT_SECONDS = GIT_REMOTE_TIMEOUT_MS / 1000
+
+// clone で git を打ち切るまでの、出力(stdout / stderr)が途絶えた時間。main(gitCloneService の cloneRepository)が
+// 打ち切りに使い、renderer(CloneRepositoryDialog)が実行中の案内「応答が N 秒途絶えると打ち切ります」に使う(パターン 88)。
+// 合計時間の上限は設けない(巨大なリポジトリでも、進捗が出ている間は続ける)。git は標準エラーが端末でないと進捗を
+// 出さないため、main は `--progress` を明示する(実機 git 2.50.1 で確認)。案内は秒で表すため、1000 の倍数にする
+export const GIT_CLONE_IDLE_TIMEOUT_MS = 60_000
+
+// clone 中の案内に出す秒数
+export const GIT_CLONE_IDLE_TIMEOUT_SECONDS = GIT_CLONE_IDLE_TIMEOUT_MS / 1000
```

`src/shared/types/git.ts`（変更。差分）:

```diff
--- a/src/shared/types/git.ts
+++ b/src/shared/types/git.ts
@@ -143,3 +143,7 @@ export type StashPopResult =
       status: 'rollbackFailed'
       message: string
     }
+
+// リポジトリの clone(git:cloneRepository)の結果。canceled は保存先の選択(OS のダイアログ)の取り消しと、
+// clone 中の中止(git:cancelCloneRepository・ウィンドウを閉じた)の両方。失敗は例外(日本語の文言)
+export type CloneRepositoryResult = { status: 'cloned'; path: string } | { status: 'canceled' }
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run src/shared
```

Expected: すべて成功

- [ ] **Step 5: 変異で検知力を確かめる**

`BAK="$(mktemp -d)" && cp src/shared/cloneFolderName.ts src/shared/remoteTimeout.ts "$BAK/"` で退避し、1 つずつエディタで書き換えて `npx vitest run src/shared/__tests__/cloneFolderName.test.ts src/shared/__tests__/remoteTimeout.test.ts` が落ちることを確かめ、そのつど `cp "$BAK/<file>" src/shared/` で戻す。

1. `deriveCloneFolderName` の query・fragment を落とす `if (cut !== -1) …` の行を消す → `?x=1`・`#frag` の行が落ちる
2. 末尾の `.git` を除く行を `while (rest.endsWith('.git'))` にする → `b.git.git` の行が落ちる
3. `SEGMENT_SEPARATOR_PATTERN` から `:` を外す → `b:c.git`・scp 形式の行が落ちる
4. ホストだけの `if (pathStart === -1) return ''` を消す → `https://github.com` の行が落ちる
5. `getCloneFolderNameViolation` の `return isSafeEntryName(name) ? null : 'invalid'` を `return null` にする → invalid の行が落ちる
6. `GIT_CLONE_IDLE_TIMEOUT_MS = 60_500` にする → 2 件とも落ちる

最後に `for f in cloneFolderName.ts remoteTimeout.ts; do cmp "$BAK/$f" "src/shared/$f"; done` が何も出力しないことを確かめる。

- [ ] **Step 6: 型・lint・整形を確かめる**

```bash
npm run typecheck
npx eslint src/shared/cloneFolderName.ts src/shared/__tests__/cloneFolderName.test.ts src/shared/remoteTimeout.ts src/shared/__tests__/remoteTimeout.test.ts src/shared/types/git.ts
npx prettier --check src/shared/cloneFolderName.ts src/shared/__tests__/cloneFolderName.test.ts src/shared/remoteTimeout.ts src/shared/__tests__/remoteTimeout.test.ts src/shared/types/git.ts
```

Expected: すべて成功

- [ ] **Step 7: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 2: `gitCloneProcess.ts`（子プロセスの実行・無出力の打ち切り・中止・プロセスグループごとの停止）

**Files:**

- Create: `src/main/gitCloneProcess.ts`, `src/main/__tests__/gitCloneProcess.test.ts`

**Interfaces:**

- Consumes: なし（`node:child_process` の `spawn`）
- Produces: `runGitCloneProcess` / `GitCloneProcessOptions` / `GitCloneProcessResult` / `MAX_CLONE_STDERR_BYTES` / `CLONE_KILL_GRACE_MS`
- 注: simple-git を使わない理由は差異 1〜3。テストは実際の子プロセス（PATH の先頭に置いた偽の git = sh のスクリプト）で、孤児が残らないことを pid で確かめる（モックでは確かめられない。パターン 41・84）。POSIX だけ（`describe.skipIf(process.platform === 'win32')`）。打ち切りの時間は差異 20 のとおり 1.5 秒以上にする

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/gitCloneProcess.test.ts`（新規。全文）:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_CLONE_STDERR_BYTES, runGitCloneProcess } from '../gitCloneProcess'

// 実際の子プロセス(PATH の先頭に置いた偽の git = sh のスクリプト)で、打ち切り・中止の後に子孫まで止まることを
// 確かめる(モックでは孤児が残るかを確かめられない。パターン 41・84)。プロセスグループは POSIX だけ
const isWindows = process.platform === 'win32'

let work: string
let binDir: string
// テストの待ち(delay)のタイマー。テストが途中で失敗しても残さない(CLAUDE.md のテスト規約)
const timers = new Set<ReturnType<typeof setTimeout>>()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(() => {
      timers.delete(id)
      resolve()
    }, ms)
    timers.add(id)
  })
}

// 偽の git を置く。中身は sh のスクリプト(`$1` 以降は git の引数)
function writeFakeGit(body: string): void {
  writeFileSync(join(binDir, 'git'), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// 止めたプロセスが消えるまで待つ(親が先に止まると launchd・init が回収するまで一瞬ゾンビとして残る)
async function waitUntilDead(pid: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await delay(20)
  }
  return !isAlive(pid)
}

async function waitForFile(path: string, timeoutMs = 3000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf8').trim()
      if (content !== '') return content
    }
    await delay(20)
  }
  throw new Error(`${path} が書かれませんでした`)
}

// 後始末: テストが失敗しても、偽の git が起動した sleep を残さない
const startedPids: number[] = []

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'clone-process-')))
  binDir = join(work, 'bin')
  mkdirSync(binDir)
  vi.stubEnv('PATH', `${binDir}:${process.env.PATH ?? ''}`)
})

afterEach(() => {
  for (const id of timers) clearTimeout(id)
  timers.clear()
  for (const pid of startedPids.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // 既に終わっている
    }
  }
  vi.unstubAllEnvs()
  rmSync(work, { recursive: true, force: true })
})

describe.skipIf(isWindows)('runGitCloneProcess', () => {
  it('引数・作業ディレクトリ・GIT_TERMINAL_PROMPT=0 で git を起動し、終了コードと標準エラーを返す', async () => {
    writeFakeGit(
      'echo "args=$*" >&2\necho "cwd=$(pwd -P)" >&2\necho "prompt=$GIT_TERMINAL_PROMPT" >&2\nexit 3'
    )
    const result = await runGitCloneProcess({
      args: ['clone', '--progress', '--', 'u', 'd'],
      cwd: work,
      signal: new AbortController().signal,
      idleTimeoutMs: 5000
    })
    expect(result.kind).toBe('exited')
    if (result.kind !== 'exited') return
    expect(result.code).toBe(3)
    expect(result.stderr).toContain('args=clone --progress -- u d')
    expect(result.stderr).toContain(`cwd=${work}`)
    expect(result.stderr).toContain('prompt=0')
  })

  it('出力が途絶えたら子孫ごと止めて timed-out で解決する', async () => {
    const pidFile = join(work, 'sleep.pid')
    writeFakeGit(`sleep 30 &\necho $! > '${pidFile}'\nwait`)
    const started = Date.now()
    const result = await runGitCloneProcess({
      args: ['clone'],
      cwd: work,
      signal: new AbortController().signal,
      // 偽の git が pid を書く前に打ち切らないよう 1.5 秒(macOS は新しい実行ファイルの初回の起動を検査して遅れる)
      idleTimeoutMs: 1500
    })
    const sleepPid = Number(await waitForFile(pidFile))
    startedPids.push(sleepPid)
    expect(result).toEqual({ kind: 'timed-out' })
    expect(Date.now() - started).toBeLessThan(5000)
    // git(偽の sh)が起動した sleep まで止まっている(simple-git の timeout では孤児として残った)
    expect(await waitUntilDead(sleepPid)).toBe(true)
  })

  it('標準エラーへの出力が続く間は打ち切らない', async () => {
    // 0.3 秒ごとに 8 回(合計 2.4 秒)。打ち切りの 1 秒より長く続くが、間隔は 1 秒より短い
    writeFakeGit(
      'for i in 1 2 3 4 5 6 7 8; do echo "Receiving objects: $i" >&2; sleep 0.3; done\nexit 0'
    )
    const result = await runGitCloneProcess({
      args: ['clone'],
      cwd: work,
      signal: new AbortController().signal,
      idleTimeoutMs: 1000
    })
    expect(result).toMatchObject({ kind: 'exited', code: 0 })
  })

  it('標準出力への出力も打ち切りまでの時間を延ばす', async () => {
    writeFakeGit('for i in 1 2 3 4 5 6 7 8; do echo "line $i"; sleep 0.3; done\nexit 0')
    const result = await runGitCloneProcess({
      args: ['clone'],
      cwd: work,
      signal: new AbortController().signal,
      idleTimeoutMs: 1000
    })
    expect(result).toMatchObject({ kind: 'exited', code: 0 })
  })

  it('中止すると子孫ごと止めて aborted で解決する', async () => {
    const pidFile = join(work, 'sleep.pid')
    writeFakeGit(`sleep 30 &\necho $! > '${pidFile}'\nwait`)
    const controller = new AbortController()
    const running = runGitCloneProcess({
      args: ['clone'],
      cwd: work,
      signal: controller.signal,
      idleTimeoutMs: 10_000
    })
    const sleepPid = Number(await waitForFile(pidFile))
    startedPids.push(sleepPid)
    controller.abort()
    expect(await running).toEqual({ kind: 'aborted' })
    expect(await waitUntilDead(sleepPid)).toBe(true)
  })

  it('既に中止されていれば git を起動しない', async () => {
    const marker = join(work, 'started')
    writeFakeGit(`touch '${marker}'`)
    const controller = new AbortController()
    controller.abort()
    const result = await runGitCloneProcess({
      args: ['clone'],
      cwd: work,
      signal: controller.signal,
      idleTimeoutMs: 1000
    })
    expect(result).toEqual({ kind: 'aborted' })
    await delay(200)
    expect(existsSync(marker)).toBe(false)
  })

  it('SIGTERM を無視するプロセスも、猶予の後の SIGKILL で止める', async () => {
    const pidFile = join(work, 'self.pid')
    writeFakeGit(`trap '' TERM INT\necho $$ > '${pidFile}'\nexec sleep 30`)
    const controller = new AbortController()
    const running = runGitCloneProcess({
      args: ['clone'],
      cwd: work,
      signal: controller.signal,
      idleTimeoutMs: 10_000,
      killGraceMs: 200
    })
    const shPid = Number(await waitForFile(pidFile))
    startedPids.push(shPid)
    const started = Date.now()
    controller.abort()
    expect(await running).toEqual({ kind: 'aborted' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(150)
    expect(await waitUntilDead(shPid)).toBe(true)
  })

  it('標準エラーは末尾を残す(進捗で上限を超えても、最後の fatal を失わない)', async () => {
    // 1 行 1000 バイトの進捗を 200 行(約 200KB)出してから fatal を出す
    writeFakeGit(
      `i=0\nwhile [ $i -lt 200 ]; do printf '%01000d\\r' 0 >&2; i=$((i+1)); done\necho 'fatal: tail-marker' >&2\nexit 128`
    )
    const result = await runGitCloneProcess({
      args: ['clone'],
      cwd: work,
      signal: new AbortController().signal,
      idleTimeoutMs: 5000
    })
    expect(result.kind).toBe('exited')
    if (result.kind !== 'exited') return
    expect(result.code).toBe(128)
    expect(result.stderr.trimEnd().endsWith('fatal: tail-marker')).toBe(true)
    expect(Buffer.byteLength(result.stderr)).toBeLessThan(200_000)
    expect(Buffer.byteLength(result.stderr)).toBeGreaterThanOrEqual(MAX_CLONE_STDERR_BYTES)
  })

  it('git を起動できなければ spawn-failed で解決する', async () => {
    vi.stubEnv('PATH', join(work, 'empty'))
    const result = await runGitCloneProcess({
      args: ['clone'],
      cwd: work,
      signal: new AbortController().signal,
      idleTimeoutMs: 1000
    })
    expect(result.kind).toBe('spawn-failed')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run src/main/__tests__/gitCloneProcess.test.ts
```

Expected: FAIL（`../gitCloneProcess` が無い）

- [ ] **Step 3: 実装する**

`src/main/gitCloneProcess.ts`（新規。全文）:

```ts
import { spawn } from 'node:child_process'

// git clone の子プロセスの実行・打ち切り・中止だけを担う(検証・保存先の作成と削除・文言は gitCloneService)。
// simple-git を使わない理由(実機 git 2.50.1・simple-git 3.36.0 で確認。設計書の確認事項 3):
// - simple-git の abort・timeout プラグインは git 本体に SIGINT を送るだけで、git が起動した git-remote-http・ssh
//   (core.sshCommand の偽の ssh で確認)は孤児として残る。SIGINT を無視するプロセス(git の代わりの sh)では
//   Promise が解決しない(パターン 10・84)
// - `-c protocol.ext.allow=never` を blockUnsafeOperationsPlugin が拒否する(allowUnsafeProtocolOverride が要る)
// そのため spawn を直接使い、POSIX では新しいプロセスグループ(detached。setsid で制御端末も外れる)で起動して、
// 打ち切り・中止ではグループごと SIGTERM → 猶予の後に SIGKILL を送る(cliService の killWithEscalation と同じ考え方)。
// 制御端末を外すのは、端末から起動したアプリ(npm run dev)で ssh の未知のホスト鍵の確認(yes/no)が端末に出て
// 待ち続けるのを防ぐため(detached では `Host key verification failed.` で即座に失敗する。実機で確認)。
// Windows はプロセスグループが無いため taskkill /T /F で子孫ごと止める(実機で未確認。既知の制約)

// 標準エラーの蓄積の上限。--progress の進捗行は巨大なリポジトリで数 MB になりうる。失敗の文言(fatal: …)は末尾に
// 出るため、先頭を捨てて末尾を残す(gitApply.ts の上限と同じ 64KB)
export const MAX_CLONE_STDERR_BYTES = 64 * 1024

// SIGTERM の後、SIGKILL へ切り替えるまでの猶予(cliService.ts・gitApply.ts と同じ 5 秒)
export const CLONE_KILL_GRACE_MS = 5_000

export interface GitCloneProcessOptions {
  /** git に渡す引数(`git` の後ろ全体) */
  args: string[]
  /** 作業ディレクトリ(保存先の親フォルダ) */
  cwd: string
  /** 中止の要求。中止したら子孫ごと止めて { kind: 'aborted' } で解決する */
  signal: AbortSignal
  /** stdout / stderr に何も出ない時間がこれを超えたら、子孫ごと止めて { kind: 'timed-out' } で解決する */
  idleTimeoutMs: number
  /** SIGTERM から SIGKILL までの猶予。テストで実時間を待たないための引数(パターン 84) */
  killGraceMs?: number
}

export type GitCloneProcessResult =
  | { kind: 'exited'; code: number | null; stderr: string }
  | { kind: 'aborted' }
  | { kind: 'timed-out' }
  | { kind: 'spawn-failed'; error: Error }

// pid のプロセスグループ(POSIX)または子孫(Windows)を止める。既に終わっていれば(ESRCH)何もしない
function killProcessTree(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
    killer.on('error', () => undefined)
    return
  }
  try {
    process.kill(-pid, signal)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err
  }
}

// git clone を実行し、終了・打ち切り・中止・起動失敗のどれかで解決する(reject しない)。解決するのは子プロセスの
// 標準出力・標準エラーが閉じた後(close)。打ち切り・中止ではグループの全員が止まってから解決するため、呼び出し側は
// 解決の後に保存先を安全に削除できる。環境変数は親(main プロセス)を引き継ぎ、GIT_TERMINAL_PROMPT=0 だけを足す
// (git 自身の認証の入力を端末で待たない。GIT_ASKPASS・core.askPass・credential helper などの利用者の設定は
// 上書きしない。パターン 81)
export function runGitCloneProcess({
  args,
  cwd,
  signal,
  idleTimeoutMs,
  killGraceMs = CLONE_KILL_GRACE_MS
}: GitCloneProcessOptions): Promise<GitCloneProcessResult> {
  if (signal.aborted) return Promise.resolve({ kind: 'aborted' })
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let settled = false
    let closed = false
    let stopReason: 'aborted' | 'timed-out' | null = null
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const stderrChunks: Buffer[] = []
    let stderrBytes = 0

    const clearIdleTimer = (): void => {
      if (idleTimer !== null) clearTimeout(idleTimer)
      idleTimer = null
    }
    const settle = (result: GitCloneProcessResult): void => {
      if (settled) return
      settled = true
      clearIdleTimer()
      signal.removeEventListener('abort', onAbort)
      resolve(result)
    }
    // 止める理由を記録し、グループごと SIGTERM → 猶予の後もまだ閉じていなければ SIGKILL。解決は close を待つ
    const stop = (reason: 'aborted' | 'timed-out'): void => {
      if (stopReason !== null || closed || child.pid === undefined) return
      stopReason = reason
      clearIdleTimer()
      killProcessTree(child.pid, 'SIGTERM')
      const pid = child.pid
      const escalation = setTimeout(() => {
        if (!closed) killProcessTree(pid, 'SIGKILL')
      }, killGraceMs)
      // このタイマーだけでアプリの終了を引き延ばさない(パターン 10)
      escalation.unref()
    }
    const resetIdleTimer = (): void => {
      if (stopReason !== null) return
      clearIdleTimer()
      idleTimer = setTimeout(() => stop('timed-out'), idleTimeoutMs)
    }
    function onAbort(): void {
      stop('aborted')
    }

    signal.addEventListener('abort', onAbort)
    resetIdleTimer()
    // stdout は使わないが、読まないとパイプが満杯になって git の書き込みが止まる。出力は無出力の判定にだけ使う
    child.stdout?.on('data', resetIdleTimer)
    child.stderr?.on('data', (chunk: Buffer) => {
      resetIdleTimer()
      stderrChunks.push(chunk)
      stderrBytes += chunk.length
      // 末尾の MAX_CLONE_STDERR_BYTES 以上を残して、先頭のチャンクを捨てる
      while (
        stderrChunks.length > 1 &&
        stderrBytes - stderrChunks[0].length >= MAX_CLONE_STDERR_BYTES
      ) {
        stderrBytes -= stderrChunks[0].length
        stderrChunks.shift()
      }
    })
    // git が PATH に無い(ENOENT)など、起動できなかった
    child.on('error', (error) => settle({ kind: 'spawn-failed', error }))
    child.on('close', (code) => {
      closed = true
      if (stopReason !== null) {
        settle({ kind: stopReason })
        return
      }
      settle({ kind: 'exited', code, stderr: Buffer.concat(stderrChunks).toString('utf8') })
    })
  })
}
```

- [ ] **Step 4: テストを実行して成功を確認する（3 回続けて安定することも確かめる）**

```bash
for i in 1 2 3; do npx vitest run src/main/__tests__/gitCloneProcess.test.ts; done
pgrep -fl 'sleep 30' || echo 'no orphans'
```

Expected: 3 回ともすべて成功し、最後に `no orphans`

- [ ] **Step 5: 変異で検知力を確かめる**

`BAK="$(mktemp -d)" && cp src/main/gitCloneProcess.ts "$BAK/"` で退避し、1 つずつエディタで書き換えて、ファイル全体の実行（`npx vitest run src/main/__tests__/gitCloneProcess.test.ts`）と、落ちるはずのテストの単独の実行（`-t '<テスト名の一部>'`）の両方で落ちることを確かめ、そのつど `cp "$BAK/gitCloneProcess.ts" src/main/` で戻す。変異の後は `pgrep -fl 'sleep 30'` を見て、残っていれば `kill -9 <pid>` する。

1. `process.kill(-pid, signal)` を `process.kill(pid, signal)`（グループではなく git だけ）にする → `出力が途絶えたら子孫ごと止めて` と `中止すると子孫ごと止めて` が落ちる（sleep が残る。プラン作成時に確認）
2. `detached: process.platform !== 'win32'` を `detached: false` にする → 上の 2 件と `SIGTERM を無視するプロセスも` の 3 件が落ちる（グループが無く ESRCH で何も止まらない）
3. エスカレーションの `setTimeout(() => { if (!closed) killProcessTree(pid, 'SIGKILL') }, …)` を消す → `SIGTERM を無視するプロセスも` が落ちる
4. `child.stderr?.on('data', …)` の中の `resetIdleTimer()` を消す → `標準エラーへの出力が続く間は打ち切らない` が落ちる
5. 標準エラーの `while (…) { … stderrChunks.shift() }` を消す → `標準エラーは末尾を残す` が落ちる（200KB のまま）
6. `env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }` を `env: process.env` にする → 最初のテスト（`prompt=0`）が落ちる
7. 先頭の `if (signal.aborted) return Promise.resolve({ kind: 'aborted' })` を消す → `既に中止されていれば git を起動しない` が落ちる（`signal.addEventListener` は既に中止された signal では発火しないため、git が起動して `started` が作られる）

（1〜7 はプラン作成時に検証用の写しで確認済み。）最後に `cmp "$BAK/gitCloneProcess.ts" src/main/gitCloneProcess.ts` が何も出力しないこと、`pgrep -fl 'sleep 30'` が空であることを確かめる。

- [ ] **Step 6: 型・lint・整形を確かめる**

```bash
npm run typecheck
npx eslint src/main/gitCloneProcess.ts src/main/__tests__/gitCloneProcess.test.ts
npx prettier --check src/main/gitCloneProcess.ts src/main/__tests__/gitCloneProcess.test.ts
```

Expected: すべて成功

- [ ] **Step 7: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 3: `gitCloneService.ts`（検証・保存先の作成と削除・失敗の文言。モック単体 + 実 git 統合）

**Files:**

- Create: `src/main/gitCloneService.ts`, `src/main/__tests__/gitCloneService.test.ts`, `src/main/__tests__/gitCloneService.integration.test.ts`

**Interfaces:**

- Consumes: `runGitCloneProcess` / `CLONE_KILL_GRACE_MS`（Task 2）、`getCloneFolderNameViolation` / `CloneFolderNameViolation`（Task 1）、`GIT_CLONE_IDLE_TIMEOUT_MS`（Task 1）、`normalizeRemoteUrl` / `getRemoteUrlRuleViolation`（`@shared/remoteUrl`）、`REMOTE_URL_RULE_MESSAGES`（`gitRemoteSetupService.ts`。変更しない）、`failure` / `redactCredentials`（`gitStepErrors.ts`。変更しない）、`CloneRepositoryResult`（Task 1）
- Produces: `cloneRepository` / `assertValidCloneRequest` / `CloneRepositoryOptions` / `toCloneFailureDetail` / `cleanupFailedNote` / `CLONE_PROTOCOL_GUARD_ARGS` / 文言の定数（`CLONE_FAILURE`・`CLONE_PARENT_NOT_FOUND_MESSAGE`・`CLONE_DESTINATION_EXISTS_MESSAGE`・`CLONE_TIMEOUT_MESSAGE`・`CLONE_FOLDER_NAME_MESSAGES`）
- 注: 失敗の文言の組み立ては `toStepError` ではなく `failure(CLONE_FAILURE, redactCredentials(detail))`（`toStepError` は simple-git の打ち切りの `GitPluginError` を判定する部品で、spawn の結果には合わない。差異 1）。`FolderAccessManager` への登録は IPC ハンドラ（Task 4）が行い、このサービスは触れない（失敗時に登録が変わらないことは Task 4 のテストで固定する）
- 注: 統合テストは実 git 2.50.1 とローカルの bare リポジトリ（`helpers/realGitRepo` の `initRepo`・`commitAll`・`runGit`・`stubIsolatedGitEnv`・`stubGitCeiling`）。偽の ssh は `core.sshCommand` を書いたグローバル設定（`vi.stubEnv('GIT_CONFIG_GLOBAL', …)`）で渡す（アプリは `GIT_SSH_COMMAND` を使わないため、テストでも使わない）。偽の git は PATH の先頭に置く

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/gitCloneService.test.ts`（新規。全文）:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GitCloneProcessOptions, GitCloneProcessResult } from '../gitCloneProcess'

// 子プロセスの結果ごとの扱い(成功・中止・打ち切り・起動失敗・終了コード)と、渡す引数を固定する。
// 子プロセスの実物の振る舞いは gitCloneService.integration.test.ts と gitCloneProcess.test.ts で確かめる
const mockRunGitCloneProcess = vi.hoisted(() =>
  vi.fn<(options: GitCloneProcessOptions) => Promise<GitCloneProcessResult>>()
)
vi.mock('../gitCloneProcess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../gitCloneProcess')>()),
  runGitCloneProcess: mockRunGitCloneProcess
}))

import { GIT_CLONE_IDLE_TIMEOUT_MS } from '@shared/remoteTimeout'
import { CLONE_KILL_GRACE_MS } from '../gitCloneProcess'
import {
  CLONE_FAILURE,
  CLONE_FOLDER_NAME_MESSAGES,
  CLONE_TIMEOUT_MESSAGE,
  assertValidCloneRequest,
  cleanupFailedNote,
  cloneRepository,
  toCloneFailureDetail
} from '../gitCloneService'
import { REMOTE_URL_RULE_MESSAGES } from '../gitRemoteSetupService'

const isWindows = process.platform === 'win32'
let work: string
let parent: string

beforeEach(() => {
  // 持続する実装は使わない。各テストで mockImplementationOnce / mockResolvedValueOnce を設定する(パターン 103)
  mockRunGitCloneProcess.mockReset()
  work = realpathSync(mkdtempSync(join(tmpdir(), 'clone-unit-')))
  parent = join(work, 'parent')
  mkdirSync(parent)
})

afterEach(() => {
  if (existsSync(parent)) chmodSync(parent, 0o755)
  rmSync(work, { recursive: true, force: true })
})

describe('cloneRepository(子プロセスの結果の扱い)', () => {
  it('既定の打ち切り・猶予と、親フォルダの実体を作業ディレクトリにして実行する', async () => {
    mockRunGitCloneProcess.mockResolvedValueOnce({ kind: 'exited', code: 0, stderr: '' })
    const signal = new AbortController().signal
    const result = await cloneRepository('/abs/bare.git', 'repo', parent, signal)
    expect(result).toEqual({ status: 'cloned', path: join(parent, 'repo') })
    expect(mockRunGitCloneProcess).toHaveBeenCalledOnce()
    expect(mockRunGitCloneProcess.mock.calls[0][0]).toStrictEqual({
      args: [
        '-c',
        'protocol.ext.allow=never',
        '-c',
        'protocol.fd.allow=never',
        'clone',
        '--progress',
        '--',
        '/abs/bare.git',
        join(parent, 'repo')
      ],
      cwd: parent,
      signal,
      idleTimeoutMs: GIT_CLONE_IDLE_TIMEOUT_MS,
      killGraceMs: CLONE_KILL_GRACE_MS
    })
  })

  it('git が終わった後でも、中止の要求が届いていれば保存先を削除して canceled', async () => {
    const controller = new AbortController()
    mockRunGitCloneProcess.mockImplementationOnce(async () => {
      controller.abort()
      return { kind: 'exited', code: 0, stderr: '' }
    })
    expect(await cloneRepository('/abs/bare.git', 'repo', parent, controller.signal)).toEqual({
      status: 'canceled'
    })
    expect(readdirSync(parent)).toEqual([])
  })

  it('既に中止されていれば、保存先を作らず git も起動しない', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await cloneRepository('/abs/bare.git', 'repo', parent, controller.signal)).toEqual({
      status: 'canceled'
    })
    expect(mockRunGitCloneProcess).not.toHaveBeenCalled()
    expect(readdirSync(parent)).toEqual([])
  })

  it('aborted は保存先を削除して canceled', async () => {
    mockRunGitCloneProcess.mockResolvedValueOnce({ kind: 'aborted' })
    expect(
      await cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
    ).toEqual({ status: 'canceled' })
    expect(readdirSync(parent)).toEqual([])
  })

  it('timed-out は保存先を削除して打ち切りの文言', async () => {
    mockRunGitCloneProcess.mockResolvedValueOnce({ kind: 'timed-out' })
    await expect(
      cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(new Error(CLONE_TIMEOUT_MESSAGE))
    expect(readdirSync(parent)).toEqual([])
  })

  it('起動できなければ、その理由を添えて失敗する', async () => {
    mockRunGitCloneProcess.mockResolvedValueOnce({
      kind: 'spawn-failed',
      error: new Error('spawn git ENOENT')
    })
    await expect(
      cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(new Error(`${CLONE_FAILURE}: spawn git ENOENT`))
    expect(readdirSync(parent)).toEqual([])
  })

  it('終了コードが 0 以外なら、進捗を除いた標準エラーを伏せ字にして添える', async () => {
    mockRunGitCloneProcess.mockResolvedValueOnce({
      kind: 'exited',
      code: 128,
      stderr:
        "Cloning into 'repo'...\nReceiving objects:  50% (1/2)\rReceiving objects: 100% (2/2), done.\n" +
        'git@example.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n'
    })
    await expect(
      cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(
      new Error(
        `${CLONE_FAILURE}: Cloning into 'repo'...\n***@example.com: Permission denied (publickey).\nfatal: Could not read from remote repository.`
      )
    )
  })

  it('標準エラーが空なら接頭辞だけ', async () => {
    mockRunGitCloneProcess.mockResolvedValueOnce({ kind: 'exited', code: 1, stderr: '\n' })
    await expect(
      cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(new Error(CLONE_FAILURE))
  })

  // 親フォルダを書き込み禁止にすると、作った保存先を削除できない(root では書き込み禁止が効かないため除く)
  it.skipIf(isWindows || process.getuid?.() === 0)(
    '保存先を削除できなければ、そのパスを文言に添える',
    async () => {
      mockRunGitCloneProcess.mockImplementationOnce(async () => {
        chmodSync(parent, 0o555)
        return { kind: 'timed-out' }
      })
      await expect(
        cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
      ).rejects.toThrow(
        new Error(`${CLONE_TIMEOUT_MESSAGE}${cleanupFailedNote(join(parent, 'repo'))}`)
      )
    }
  )
})

describe('toCloneFailureDetail', () => {
  it('進捗の行(\\r で上書きする行を含む)と空行を除き、行末の空白を落とす', () => {
    expect(
      toCloneFailureDetail(
        "Cloning into 'x'...\nremote: Counting objects:   3% (1/32)        \rremote: Counting objects: 100% (32/32), done.        \n\nfatal: bad  \n"
      )
    ).toBe("Cloning into 'x'...\nfatal: bad")
  })

  it('CRLF の改行もそろえる', () => {
    expect(toCloneFailureDetail('a\r\nb\r\n')).toBe('a\nb')
  })
})

describe('assertValidCloneRequest', () => {
  it('前後の空白を除いた URL を返す', () => {
    expect(assertValidCloneRequest('  https://github.com/a/b.git \n', 'b', false)).toBe(
      'https://github.com/a/b.git'
    )
  })

  it('URL を先に、フォルダ名を後に検証する', () => {
    expect(() => assertValidCloneRequest('', '', false)).toThrow(REMOTE_URL_RULE_MESSAGES.empty)
    expect(() => assertValidCloneRequest('/abs/bare.git', '', false)).toThrow(
      CLONE_FOLDER_NAME_MESSAGES.empty
    )
  })

  it('Windows のドライブの形は windowsPaths のときだけ通す', () => {
    expect(assertValidCloneRequest('C:/repos/bare.git', 'b', true)).toBe('C:/repos/bare.git')
    expect(() => assertValidCloneRequest('C:/repos/bare.git', 'b', false)).toThrow(
      REMOTE_URL_RULE_MESSAGES.unsupported
    )
  })
})
```

`src/main/__tests__/gitCloneService.integration.test.ts`（新規。全文）:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  commitAll,
  initRepo,
  runGit,
  stubGitCeiling,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'
import {
  CLONE_DESTINATION_EXISTS_MESSAGE,
  CLONE_FAILURE,
  CLONE_FOLDER_NAME_MESSAGES,
  CLONE_PARENT_NOT_FOUND_MESSAGE,
  CLONE_TIMEOUT_MESSAGE,
  cloneRepository
} from '../gitCloneService'
import { REMOTE_URL_RULE_MESSAGES } from '../gitRemoteSetupService'

// 実 git 2.50.1 でのみ確かめられる振る舞い(パターン 41): ローカルの bare リポジトリからの clone、保存先の作成と削除、
// 打ち切り・中止で git が起動した ssh(偽の ssh)とその子まで止まること。ネットワークには出ない(偽の ssh・閉じたポート)
const isWindows = process.platform === 'win32'

let work: string
let parent: string
let bare: string
const timers = new Set<ReturnType<typeof setTimeout>>()
const startedPids: number[] = []

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(() => {
      timers.delete(id)
      resolve()
    }, ms)
    timers.add(id)
  })
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitUntilDead(pid: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await delay(20)
  }
  return !isAlive(pid)
}

async function waitForFile(path: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf8').trim()
      if (content !== '') return content
    }
    await delay(20)
  }
  throw new Error(`${path} が書かれませんでした`)
}

// 偽の ssh を core.sshCommand に設定したグローバル設定を使う(GIT_SSH_COMMAND はアプリが設定しないため使わない)。
// git は ssh の種類を調べるために `-G` 付きで一度起動するので、そのときはすぐ終える
function useFakeSsh(body: string): void {
  const sshPath = join(work, 'fake-ssh')
  writeFileSync(sshPath, `#!/bin/sh\ncase "$1" in -G) exit 0;; esac\n${body}\n`, { mode: 0o755 })
  const configPath = join(work, 'gitconfig')
  writeFileSync(configPath, `[core]\n\tsshCommand = ${sshPath}\n`)
  vi.stubEnv('GIT_CONFIG_GLOBAL', configPath)
}

// PATH の先頭に偽の git を置く(引数の確認・出力しない git・保存先の差し替え)。
// 打ち切りの時間は 1.5 秒以上にする: macOS は新しく作った実行ファイルの初回の起動を検査するため、偽のスクリプトが
// 動き出すまでに数百ミリ秒かかることがあり、短いと pid を書く前に止められる(作成時に 300 ミリ秒で確認)
function useFakeGit(body: string): void {
  const binDir = join(work, 'bin')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, 'git'), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  vi.stubEnv('PATH', `${binDir}:${process.env.PATH ?? ''}`)
}

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'clone-service-')))
  stubIsolatedGitEnv()
  stubGitCeiling(work)
  const source = join(work, 'source')
  mkdirSync(source)
  initRepo(source)
  writeRepoFile(source, 'README.md', 'hello\n')
  commitAll(source, 'init')
  bare = join(work, 'remote.git')
  runGit(work, 'clone', '-q', '--bare', source, bare)
  parent = join(work, 'parent')
  mkdirSync(parent)
})

afterEach(() => {
  for (const id of timers) clearTimeout(id)
  timers.clear()
  for (const pid of startedPids.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // 既に終わっている
    }
  }
  vi.unstubAllEnvs()
  rmSync(work, { recursive: true, force: true })
})

describe.skipIf(isWindows)('cloneRepository(実 git)', () => {
  it('絶対パスの bare リポジトリから clone し、保存先の実体のパスを返す', async () => {
    const result = await cloneRepository(bare, 'repo', parent, new AbortController().signal)
    const destination = join(parent, 'repo')
    expect(result).toEqual({ status: 'cloned', path: realpathSync(destination) })
    expect(readFileSync(join(destination, 'README.md'), 'utf8')).toBe('hello\n')
    expect(runGit(destination, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main')
    expect(runGit(destination, 'remote', 'get-url', 'origin').trim()).toBe(bare)
    // protocol の設定は git の -c で渡し、新しいリポジトリの設定には書き残さない(clone の -c は書き残す)
    expect(readFileSync(join(destination, '.git', 'config'), 'utf8')).not.toContain('protocol')
  })

  it('file:// の URL からも clone できる', async () => {
    const result = await cloneRepository(
      `file://${bare}`,
      'via-file',
      parent,
      new AbortController().signal
    )
    expect(result.status).toBe('cloned')
    expect(readFileSync(join(parent, 'via-file', 'README.md'), 'utf8')).toBe('hello\n')
  })

  it('URL の前後の空白は除く', async () => {
    const result = await cloneRepository(
      `  ${bare}\n`,
      'trimmed',
      parent,
      new AbortController().signal
    )
    expect(result.status).toBe('cloned')
  })

  // 既存のフォルダは上書きしない。空のフォルダでも拒否する(git clone 自身は空のフォルダへの clone を受け付ける)
  it.each([
    ['中身のあるフォルダ', true],
    ['空のフォルダ', false]
  ])('保存先に%sがあれば拒否し、そのフォルダには触れない', async (_label, withFile) => {
    const existing = join(parent, 'repo')
    mkdirSync(existing)
    if (withFile) writeFileSync(join(existing, 'keep.txt'), 'keep')
    await expect(
      cloneRepository(bare, 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(CLONE_DESTINATION_EXISTS_MESSAGE)
    expect(existsSync(existing)).toBe(true)
    expect(readdirSync(existing)).toEqual(withFile ? ['keep.txt'] : [])
  })

  it('保存先に同名のファイルがあれば拒否する', async () => {
    writeFileSync(join(parent, 'repo'), 'file')
    await expect(
      cloneRepository(bare, 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(CLONE_DESTINATION_EXISTS_MESSAGE)
    expect(readFileSync(join(parent, 'repo'), 'utf8')).toBe('file')
  })

  it.each([
    ['存在しない', () => join(work, 'missing')],
    ['ファイル', () => join(work, 'source', 'README.md')],
    ['相対パス', () => 'parent']
  ])('親フォルダが%sなら拒否する', async (_label, makeParent) => {
    await expect(
      cloneRepository(bare, 'repo', makeParent(), new AbortController().signal)
    ).rejects.toThrow(CLONE_PARENT_NOT_FOUND_MESSAGE)
  })

  it.each([
    ['', REMOTE_URL_RULE_MESSAGES.empty],
    ['ext::sh -c touch% /tmp/pwned', REMOTE_URL_RULE_MESSAGES['invalid-char']],
    ['fd::3', REMOTE_URL_RULE_MESSAGES.unsupported],
    ['--upload-pack=touch', REMOTE_URL_RULE_MESSAGES['leading-dash']],
    ['https://alice:secret@example.com/a.git', REMOTE_URL_RULE_MESSAGES.unsupported]
  ])('URL %j は git を呼ぶ前に拒否し、保存先を作らない', async (url, message) => {
    await expect(
      cloneRepository(url, 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(message)
    expect(readdirSync(parent)).toEqual([])
  })

  it.each([
    ['', CLONE_FOLDER_NAME_MESSAGES.empty],
    ['a/b', CLONE_FOLDER_NAME_MESSAGES.invalid],
    ['..', CLONE_FOLDER_NAME_MESSAGES.invalid],
    ['../escape', CLONE_FOLDER_NAME_MESSAGES.invalid],
    [' repo', CLONE_FOLDER_NAME_MESSAGES.invalid]
  ])('フォルダ名 %j は拒否し、親フォルダの外にも作らない', async (name, message) => {
    await expect(cloneRepository(bare, name, parent, new AbortController().signal)).rejects.toThrow(
      message
    )
    expect(readdirSync(parent)).toEqual([])
    expect(existsSync(join(work, 'escape'))).toBe(false)
  })

  it('git の失敗は詳細を添えて投げ、作った保存先を削除する', async () => {
    const error = await cloneRepository(
      join(work, 'missing.git'),
      'repo',
      parent,
      new AbortController().signal
    ).catch((err: Error) => err)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message.startsWith(`${CLONE_FAILURE}: `)).toBe(true)
    expect((error as Error).message).toContain('missing.git')
    expect(readdirSync(parent)).toEqual([])
  })

  it('既に中止されていれば、保存先を作らずに canceled を返す', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await cloneRepository(bare, 'repo', parent, controller.signal)).toEqual({
      status: 'canceled'
    })
    expect(readdirSync(parent)).toEqual([])
  })

  it('git の前に protocol の設定を置き、clone の引数は -- の後ろに URL と保存先を渡す', async () => {
    const argsFile = join(work, 'args.txt')
    useFakeGit(`for a in "$@"; do printf '%s\\n' "$a"; done > '${argsFile}'\nexit 0`)
    await cloneRepository(bare, 'repo', parent, new AbortController().signal)
    expect(readFileSync(argsFile, 'utf8').trimEnd().split('\n')).toEqual([
      '-c',
      'protocol.ext.allow=never',
      '-c',
      'protocol.fd.allow=never',
      'clone',
      '--progress',
      '--',
      bare,
      join(parent, 'repo')
    ])
  })

  // scp 形式の user は検証を通る。ssh は接続先を `user@host: Permission denied` と出し、git はそのまま流す
  it.each([
    ['scp 形式', 'tok123@127.0.0.1:a/b.git', 'tok123'],
    ['ssh://', 'ssh://tok123@127.0.0.1/a/b.git', 'tok123']
  ])('%s の URL の失敗の文言では、ユーザー名を伏せる', async (_label, url, secret) => {
    useFakeSsh(`echo "${secret}@127.0.0.1: Permission denied (publickey)." >&2\nexit 255`)
    const error = await cloneRepository(url, 'repo', parent, new AbortController().signal).catch(
      (err: Error) => err
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message.startsWith(`${CLONE_FAILURE}: `)).toBe(true)
    expect((error as Error).message).toContain('***@127.0.0.1')
    expect((error as Error).message).not.toContain(secret)
    expect(readdirSync(parent)).toEqual([])
  })

  it('ssh が出力せずに待ち続けると打ち切り、ssh の子まで止めて保存先を削除する', async () => {
    const pidFile = join(work, 'ssh-sleep.pid')
    useFakeSsh(`sleep 30 &\necho $! > '${pidFile}'\nwait`)
    const running = cloneRepository(
      'ssh://git@127.0.0.1/a/b.git',
      'repo',
      parent,
      new AbortController().signal,
      { idleTimeoutMs: 1500 }
    )
    const sleepPid = Number(await waitForFile(pidFile))
    startedPids.push(sleepPid)
    await expect(running).rejects.toThrow(CLONE_TIMEOUT_MESSAGE)
    expect(await waitUntilDead(sleepPid)).toBe(true)
    expect(readdirSync(parent)).toEqual([])
  })

  it('中止すると ssh の子まで止め、保存先を削除して canceled を返す', async () => {
    const pidFile = join(work, 'ssh-sleep.pid')
    useFakeSsh(`sleep 30 &\necho $! > '${pidFile}'\nwait`)
    const controller = new AbortController()
    const running = cloneRepository('git@127.0.0.1:a/b.git', 'repo', parent, controller.signal)
    const sleepPid = Number(await waitForFile(pidFile))
    startedPids.push(sleepPid)
    controller.abort()
    expect(await running).toEqual({ status: 'canceled' })
    expect(await waitUntilDead(sleepPid)).toBe(true)
    expect(readdirSync(parent)).toEqual([])
  })

  it('出力せず SIGTERM も無視する git は、SIGKILL で止めて保存先を削除する', async () => {
    const pidFile = join(work, 'git.pid')
    useFakeGit(`trap '' TERM INT\necho $$ > '${pidFile}'\nexec sleep 30`)
    const running = cloneRepository(bare, 'repo', parent, new AbortController().signal, {
      idleTimeoutMs: 1500,
      killGraceMs: 200
    })
    const gitPid = Number(await waitForFile(pidFile))
    startedPids.push(gitPid)
    await expect(running).rejects.toThrow(CLONE_TIMEOUT_MESSAGE)
    expect(await waitUntilDead(gitPid)).toBe(true)
    expect(readdirSync(parent)).toEqual([])
  })

  it('保存先が実行中にシンボリックリンクへ差し替えられていたら、リンクの先を消さない', async () => {
    const outside = join(work, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'precious.txt'), 'keep')
    // 引数の最後(保存先)を消して、外のフォルダへのリンクに差し替えてから失敗する
    useFakeGit(`for last; do :; done\nrmdir "$last"\nln -s '${outside}' "$last"\nexit 128`)
    await expect(
      cloneRepository(bare, 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(CLONE_FAILURE)
    expect(readFileSync(join(outside, 'precious.txt'), 'utf8')).toBe('keep')
    expect(lstatSync(join(parent, 'repo')).isSymbolicLink()).toBe(true)
  })

  it('別のリポジトリの中の親フォルダにも clone できる(入れ子のリポジトリになる)', async () => {
    const outerRepo = join(work, 'outer')
    mkdirSync(outerRepo)
    initRepo(outerRepo)
    const result = await cloneRepository(bare, 'nested', outerRepo, new AbortController().signal)
    expect(result.status).toBe('cloned')
    expect(runGit(join(outerRepo, 'nested'), 'rev-parse', '--show-toplevel').trim()).toBe(
      realpathSync(join(outerRepo, 'nested'))
    )
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run src/main/__tests__/gitCloneService.test.ts src/main/__tests__/gitCloneService.integration.test.ts
```

Expected: FAIL（`../gitCloneService` が無い）

- [ ] **Step 3: 実装する**

`src/main/gitCloneService.ts`（新規。全文）:

```ts
import { lstat, mkdir, realpath, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { getCloneFolderNameViolation } from '@shared/cloneFolderName'
import type { CloneFolderNameViolation } from '@shared/cloneFolderName'
import { GIT_CLONE_IDLE_TIMEOUT_MS } from '@shared/remoteTimeout'
import { getRemoteUrlRuleViolation, normalizeRemoteUrl } from '@shared/remoteUrl'
import type { CloneRepositoryResult } from '@shared/types'
import { CLONE_KILL_GRACE_MS, runGitCloneProcess } from './gitCloneProcess'
import { REMOTE_URL_RULE_MESSAGES } from './gitRemoteSetupService'
import { failure, redactCredentials } from './gitStepErrors'

export const CLONE_FAILURE = 'リポジトリを clone できませんでした'
export const CLONE_PARENT_NOT_FOUND_MESSAGE = '保存先の親フォルダが見つかりません'
export const CLONE_DESTINATION_EXISTS_MESSAGE = '保存先に同名のフォルダがあります'
export const CLONE_TIMEOUT_MESSAGE =
  'clone が時間内に進みませんでした（認証の待ち、または通信の停止の可能性があります）'
// renderer(cloneValidation)の表と同じ文言。層ごとに表を持つ(パターン 88)
export const CLONE_FOLDER_NAME_MESSAGES: Record<CloneFolderNameViolation, string> = {
  empty: 'フォルダ名を入力してください',
  invalid: 'フォルダ名に使えない文字が含まれています'
}

// 失敗・中止の後に、作った保存先を削除できなかったときに文言の後ろへ添える
export function cleanupFailedNote(destination: string): string {
  return `（途中まで作られた保存先のフォルダを削除できませんでした: ${destination}）`
}

// git の前に置く設定(clone の `-c` ではなく git の `-c`。clone の `-c` は新しいリポジトリの .git/config に
// 書き残す。実機 git 2.50.1 で確認)。URL の許可リストが ext:: と fd:: を拒否するが、利用者の protocol.allow の
// 設定に関わらず、この実行では使わせない(防御の 2 層。git の既定では fd:: は許可されていて、`git clone fd::3` は
// 入力を待ち続けた。実機で確認)。https・http・ssh・git・file・scp 形式・絶対パスの clone には影響しない(実機で確認)
export const CLONE_PROTOCOL_GUARD_ARGS = [
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'protocol.fd.allow=never'
] as const

export interface CloneRepositoryOptions {
  /** 出力が途絶えてから打ち切るまでの時間(テストで実時間を待たないための引数。パターン 84) */
  idleTimeoutMs?: number
  /** SIGTERM から SIGKILL までの猶予(テスト用) */
  killGraceMs?: number
  /** Windows のドライブの形の URL を許可するか(テスト用。既定は実行中の OS) */
  windowsPaths?: boolean
}

// 進捗の行(`Receiving objects:  50% (1/2)`・`remote: Counting objects: 100% (32/32), done.`)。失敗の文言からは除く
// (数値の形で判定する。文言の言語には依存しない)
const PROGRESS_LINE_PATTERN = /\d+% \(\d+\/\d+\)/

// git の標準エラーから、失敗の詳細に添える行だけを残す(進捗の行と空行を除き、行の末尾の空白を落とす)
export function toCloneFailureDetail(stderr: string): string {
  return stderr
    .split(/\r\n|\r|\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line !== '' && !PROGRESS_LINE_PATTERN.test(line))
    .join('\n')
}

function isMissingError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

// 保存先の親フォルダを、実体のパスにして返す。無い・フォルダでない・相対パスは「見つからない」
async function resolveParentDir(parentDir: string): Promise<string> {
  if (!isAbsolute(parentDir)) throw new Error(CLONE_PARENT_NOT_FOUND_MESSAGE)
  let resolved: string
  try {
    resolved = await realpath(parentDir)
  } catch (err) {
    if (isMissingError(err)) throw new Error(CLONE_PARENT_NOT_FOUND_MESSAGE)
    throw failure(CLONE_FAILURE, err instanceof Error ? err.message : String(err))
  }
  if (!(await stat(resolved)).isDirectory()) throw new Error(CLONE_PARENT_NOT_FOUND_MESSAGE)
  return resolved
}

// 保存先を作る。再帰しない mkdir は、既にある(空のフォルダ・ファイル・壊れたシンボリックリンクでも)と EEXIST で
// 失敗するため、「このサービスが作った」ことと「既存を上書きしない」ことを 1 回で確かめられる(存在の確認と作成の間に
// 別のプロセスが作る競合も起きない。パターン 1)。git clone は空のフォルダへの clone を受け付ける(実機で確認)
async function createDestination(destination: string): Promise<void> {
  try {
    await mkdir(destination)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EEXIST') throw new Error(CLONE_DESTINATION_EXISTS_MESSAGE)
    if (code === 'ENOENT') throw new Error(CLONE_PARENT_NOT_FOUND_MESSAGE)
    throw failure(CLONE_FAILURE, err instanceof Error ? err.message : String(err))
  }
}

// このサービスが作った保存先を削除する。削除できなかったら、そのパスを返す(呼び出し側が文言に添える)。
// 保存先が親フォルダの直下でない、または別のプロセスがシンボリックリンクなどフォルダ以外に差し替えていたら、
// 自分が作ったものではないため削除しない(リンクの先を消さない)。git は SIGTERM で中断すると中身を消して空の
// フォルダを残し、SIGKILL では .git を残す(実機で確認)。どちらもここで消す
async function removeCreatedDestination(
  destination: string,
  parent: string
): Promise<string | null> {
  if (dirname(destination) !== parent) return null
  try {
    if (!(await lstat(destination)).isDirectory()) return null
  } catch (err) {
    if (isMissingError(err)) return null
    return destination
  }
  try {
    await rm(destination, { recursive: true, force: true })
    return null
  } catch {
    return destination
  }
}

function withCleanupNote(error: Error, leftover: string | null): Error {
  return leftover === null ? error : new Error(`${error.message}${cleanupFailedNote(leftover)}`)
}

// URL とフォルダ名を検証し、正規化した URL を返す(git も OS のダイアログも使わない)。IPC ハンドラが保存先の選択
// (OS のダイアログ)の前に呼び、cloneRepository も実行の前に呼ぶ(パターン 94)。URL は前後の空白だけを除き、
// リモートの追加と同じ許可リスト(@shared/remoteUrl。パスワード入りの URL は拒否する)で検証する
export function assertValidCloneRequest(
  rawUrl: string,
  folderName: string,
  windowsPaths: boolean = process.platform === 'win32'
): string {
  const url = normalizeRemoteUrl(rawUrl)
  const urlViolation = getRemoteUrlRuleViolation(url, { windowsPaths })
  if (urlViolation !== null) throw new Error(REMOTE_URL_RULE_MESSAGES[urlViolation])
  const nameViolation = getCloneFolderNameViolation(folderName)
  if (nameViolation !== null) throw new Error(CLONE_FOLDER_NAME_MESSAGES[nameViolation])
  return url
}

// リポジトリを clone する。url と folderName は IPC 境界から届く任意の文字列、parentDir は OS のダイアログで選ばれた
// 親フォルダ。検証はすべて実行の前に行う(パターン 94)。成功したら保存先の実体のパスを返す。中止(signal)は
// { status: 'canceled' }。失敗は日本語の Error。失敗・中止のときは、作った保存先を削除する(既存のフォルダには触れない)
export async function cloneRepository(
  rawUrl: string,
  folderName: string,
  parentDir: string,
  signal: AbortSignal,
  options: CloneRepositoryOptions = {}
): Promise<CloneRepositoryResult> {
  const {
    idleTimeoutMs = GIT_CLONE_IDLE_TIMEOUT_MS,
    killGraceMs = CLONE_KILL_GRACE_MS,
    windowsPaths = process.platform === 'win32'
  } = options
  const url = assertValidCloneRequest(rawUrl, folderName, windowsPaths)
  const parent = await resolveParentDir(parentDir)
  if (signal.aborted) return { status: 'canceled' }
  const destination = join(parent, folderName)
  await createDestination(destination)

  const result = await runGitCloneProcess({
    args: [...CLONE_PROTOCOL_GUARD_ARGS, 'clone', '--progress', '--', url, destination],
    cwd: parent,
    signal,
    idleTimeoutMs,
    killGraceMs
  })
  // 中止の要求が届いていれば、git が先に終わっていても中止として扱う(利用者が押した結果に合わせる)
  if (result.kind === 'exited' && result.code === 0 && !signal.aborted) {
    return { status: 'cloned', path: await realpath(destination) }
  }
  const leftover = await removeCreatedDestination(destination, parent)
  if (result.kind === 'aborted' || signal.aborted) {
    if (leftover !== null) throw new Error(`clone を中止しました${cleanupFailedNote(leftover)}`)
    return { status: 'canceled' }
  }
  if (result.kind === 'timed-out') {
    throw withCleanupNote(new Error(CLONE_TIMEOUT_MESSAGE), leftover)
  }
  // git の出力は URL の資格情報を伏せない場合がある(ssh の `user@host: Permission denied` など)。検証はパスワード入りの
  // URL を拒否するが、scp 形式・ssh:// のユーザー名は残るため、詳細を伏せる(防御の 2 層。パターン 93)
  const detail =
    result.kind === 'spawn-failed' ? result.error.message : toCloneFailureDetail(result.stderr)
  throw withCleanupNote(failure(CLONE_FAILURE, redactCredentials(detail)), leftover)
}
```

- [ ] **Step 4: テストを実行して成功を確認する（3 回続けて安定することも確かめる）**

```bash
for i in 1 2 3; do npx vitest run src/main/__tests__/gitCloneService.test.ts src/main/__tests__/gitCloneService.integration.test.ts; done
pgrep -fl 'sleep 30' || echo 'no orphans'
```

Expected: 3 回ともすべて成功し、最後に `no orphans`

- [ ] **Step 5: 変異で検知力を確かめる**

`BAK="$(mktemp -d)" && cp src/main/gitCloneService.ts "$BAK/"` で退避し、1 つずつエディタで書き換えて、`npx vitest run src/main/__tests__/gitCloneService.test.ts src/main/__tests__/gitCloneService.integration.test.ts` と、落ちるはずのテストの `-t` 単独の実行の両方で落ちることを確かめ、そのつど `cp "$BAK/gitCloneService.ts" src/main/` で戻す（変異の後は `pgrep -fl 'sleep 30'` を見て、残っていれば `kill -9`）。括弧内はプラン作成時に検証用の写しで落ちたテスト。

1. `args` を `['clone', ...CLONE_PROTOCOL_GUARD_ARGS, '--progress', '--', url, destination]`（clone の `-c`）にする（単体の引数のテスト・統合の `.git/config` に protocol が無いこと・偽の git の引数の 3 件）
2. `removeCreatedDestination` の `if (!(await lstat(destination)).isDirectory()) return null` を `await lstat(destination)` にする（シンボリックリンクへの差し替えの 1 件）
3. `failure(CLONE_FAILURE, redactCredentials(detail))` を `failure(CLONE_FAILURE, detail)` にする（単体の伏せ字・統合の scp 形式と ssh:// の 3 件）
4. `await mkdir(destination)` を `await mkdir(destination, { recursive: true })` にする（保存先に中身のあるフォルダ・空のフォルダの 2 件。中身のあるフォルダは git が拒否した後に削除までされる）
5. `toCloneFailureDetail` の `!PROGRESS_LINE_PATTERN.test(line)` を外す（進捗の行の 2 件）
6. `const leftover = await removeCreatedDestination(destination, parent)` を `const leftover: string | null = null` にする（削除を確かめる単体・統合のテストが 8 件以上）
7. `if (result.kind === 'exited' && result.code === 0 && !signal.aborted)` から `&& !signal.aborted` を外す（`git が終わった後でも、中止の要求が届いていれば` の 1 件）
8. `cloneRepository` の `if (signal.aborted) return { status: 'canceled' }` を消す（単体の `既に中止されていれば、保存先を作らず git も起動しない` の 1 件。統合の同名のテストは、作ってから削除されるため落ちない。単体で「git を起動しない」を固定する）

最後に `cmp "$BAK/gitCloneService.ts" src/main/gitCloneService.ts` が何も出力しないこと、`pgrep -fl 'sleep 30'` が空であることを確かめる。

- [ ] **Step 6: 型・lint・整形を確かめる**

```bash
npm run typecheck
npx eslint src/main/gitCloneService.ts src/main/__tests__/gitCloneService.test.ts src/main/__tests__/gitCloneService.integration.test.ts
npx prettier --check src/main/gitCloneService.ts src/main/__tests__/gitCloneService.test.ts src/main/__tests__/gitCloneService.integration.test.ts
```

Expected: すべて成功

- [ ] **Step 7: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 4: IPC（`cloneRegistry`・`chooseCloneParentDialog`・`cloneHandlers`・登録）・preload・`gitApi`

**Files:**

- Create: `src/main/cloneRegistry.ts`, `src/main/handlers/cloneHandlers.ts`, `src/main/__tests__/cloneRegistry.test.ts`, `src/main/__tests__/handlers/cloneHandlers.test.ts`
- Modify: `src/main/dialogService.ts`, `src/main/ipcHandlers.ts`, `src/preload/api.ts`, `src/preload/index.d.ts`, `src/renderer/src/lib/gitApi.ts`, `src/main/__tests__/dialogService.test.ts`, `src/main/__tests__/ipcHandlers.test.ts`, `src/preload/__tests__/api.test.ts`, `src/renderer/src/lib/__tests__/gitApi.test.ts`

**Interfaces:**

- Consumes: `cloneRepository` / `assertValidCloneRequest` / `CLONE_FOLDER_NAME_MESSAGES`（Task 3）、`FolderAccessManager`（`set` だけ使う。`getAllowedFolder` は使わない: clone はフォルダが開いていなくても使える）、`REMOTE_URL_RULE_MESSAGES`（テスト）、`CloneRepositoryResult`（Task 1）
- Produces: `CloneRegistry` / `setupCloneLifecycle` / `CLONE_ALREADY_RUNNING_MESSAGE`、`chooseCloneParentDialog`、`registerCloneHandlers`、IPC `git:cloneRepository` / `git:cancelCloneRepository`、`window.api.cloneRepository` / `cancelCloneRepository`、`gitApi.cloneRepository` / `cancelCloneRepository`
- 注: 引数の型の検証は `gitHandlers.ts` の `assertRemoteUrlArg` と同じ流儀（`unknown` で受けて `typeof` で確かめる）だが、`gitHandlers.ts` の関数は非公開のため `cloneHandlers.ts` に同じ形で置く（文言 `Invalid remote url` は同じ）。`gitHandlers.ts` は変更しない
- 注: `ipcHandlers.test.ts` は `electron` の `app` を空のオブジェクトでモックしているため、`setupCloneLifecycle`（`app.on` を呼ぶ）を `vi.mock('../cloneRegistry', …)` で差し替える（`CloneRegistry` は実物）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/cloneRegistry.test.ts`（新規。全文）:

```ts
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { CLONE_ALREADY_RUNNING_MESSAGE, CloneRegistry, setupCloneLifecycle } from '../cloneRegistry'

describe('CloneRegistry', () => {
  it('begin で実行中になり、end で解ける', () => {
    const registry = new CloneRegistry()
    const controller = registry.begin(1)
    expect(registry.isRunning(1)).toBe(true)
    registry.end(1, controller)
    expect(registry.isRunning(1)).toBe(false)
  })

  it('同じウィンドウで実行中なら拒否し、既存の clone は中止しない', () => {
    const registry = new CloneRegistry()
    const first = registry.begin(1)
    expect(() => registry.begin(1)).toThrow(CLONE_ALREADY_RUNNING_MESSAGE)
    expect(first.signal.aborted).toBe(false)
    expect(registry.isRunning(1)).toBe(true)
  })

  it('別のウィンドウは同時に実行できる', () => {
    const registry = new CloneRegistry()
    registry.begin(1)
    expect(() => registry.begin(2)).not.toThrow()
  })

  it('cancel は実行中の clone を中止する。実行中でなければ何もしない', () => {
    const registry = new CloneRegistry()
    expect(() => registry.cancel(1)).not.toThrow()
    const controller = registry.begin(1)
    registry.cancel(1)
    registry.cancel(1)
    expect(controller.signal.aborted).toBe(true)
  })

  it('古い controller の end は、新しい実行の登録を消さない', () => {
    const registry = new CloneRegistry()
    const first = registry.begin(1)
    registry.end(1, first)
    const second = registry.begin(1)
    registry.end(1, first)
    expect(registry.isRunning(1)).toBe(true)
    registry.cancel(1)
    expect(second.signal.aborted).toBe(true)
  })
})

describe('setupCloneLifecycle', () => {
  it('ウィンドウ(webContents)が閉じたら、そのウィンドウの clone だけを中止する', () => {
    const app = new EventEmitter()
    const registry = new CloneRegistry()
    setupCloneLifecycle(app as unknown as App, registry)
    const closing = Object.assign(new EventEmitter(), { id: 1 })
    const other = Object.assign(new EventEmitter(), { id: 2 })
    app.emit('web-contents-created', {}, closing)
    app.emit('web-contents-created', {}, other)
    const closingClone = registry.begin(1)
    const otherClone = registry.begin(2)
    closing.emit('destroyed')
    expect(closingClone.signal.aborted).toBe(true)
    expect(otherClone.signal.aborted).toBe(false)
  })

  it('実行中でないウィンドウが閉じても何もしない', () => {
    const app = new EventEmitter()
    const registry = new CloneRegistry()
    const cancel = vi.spyOn(registry, 'cancel')
    setupCloneLifecycle(app as unknown as App, registry)
    const webContents = Object.assign(new EventEmitter(), { id: 3 })
    app.emit('web-contents-created', {}, webContents)
    expect(() => webContents.emit('destroyed')).not.toThrow()
    expect(cancel).toHaveBeenCalledWith(3)
  })
})
```

`src/main/__tests__/dialogService.test.ts`（変更。差分）:

```diff
--- a/src/main/__tests__/dialogService.test.ts
+++ b/src/main/__tests__/dialogService.test.ts
@@ -4,10 +4,16 @@ const mockShowOpenDialog = vi.hoisted(() => vi.fn())
 const mockShowSaveDialog = vi.hoisted(() => vi.fn())

 vi.mock('electron', () => ({
-  dialog: { showOpenDialog: mockShowOpenDialog, showSaveDialog: mockShowSaveDialog },
+  dialog: { showOpenDialog: mockShowOpenDialog, showSaveDialog: mockShowSaveDialog }
 }))

-import { openFolderDialog, openJsonDialog, saveJsonDialog } from '../dialogService'
+import type { BrowserWindow } from 'electron'
+import {
+  chooseCloneParentDialog,
+  openFolderDialog,
+  openJsonDialog,
+  saveJsonDialog
+} from '../dialogService'

 const JSON_FILTERS = [{ name: 'JSON', extensions: ['json'] }]

@@ -53,7 +59,7 @@ describe('saveJsonDialog', () => {
     await saveJsonDialog('prompts.json')
     expect(mockShowSaveDialog).toHaveBeenCalledWith({
       defaultPath: 'prompts.json',
-      filters: JSON_FILTERS,
+      filters: JSON_FILTERS
     })
   })

@@ -76,7 +82,7 @@ describe('openJsonDialog', () => {
     await openJsonDialog()
     expect(mockShowOpenDialog).toHaveBeenCalledWith({
       properties: ['openFile'],
-      filters: JSON_FILTERS,
+      filters: JSON_FILTERS
     })
   })

@@ -92,3 +98,31 @@ describe('openJsonDialog', () => {
     expect(result).toBeNull()
   })
 })
+
+describe('chooseCloneParentDialog', () => {
+  const options = {
+    title: 'clone の保存先（親フォルダ）を選択',
+    buttonLabel: 'ここに clone',
+    properties: ['openDirectory', 'createDirectory']
+  }
+
+  it('ウィンドウがあれば、そのウィンドウのモーダルとしてフォルダの作成を許可して開く', async () => {
+    mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/parent'] })
+    const window = { id: 1 } as unknown as BrowserWindow
+    expect(await chooseCloneParentDialog(window)).toBe('/parent')
+    expect(mockShowOpenDialog).toHaveBeenCalledWith(window, options)
+  })
+
+  it('ウィンドウが無ければ、親を指定せずに開く', async () => {
+    mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/parent'] })
+    expect(await chooseCloneParentDialog(null)).toBe('/parent')
+    expect(mockShowOpenDialog).toHaveBeenCalledWith(options)
+  })
+
+  it('取り消し・空の選択は null', async () => {
+    mockShowOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: ['/parent'] })
+    expect(await chooseCloneParentDialog(null)).toBeNull()
+    mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] })
+    expect(await chooseCloneParentDialog(null)).toBeNull()
+  })
+})
```

`src/main/__tests__/handlers/cloneHandlers.test.ts`（新規。全文）:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CloneRepositoryResult } from '@shared/types'
import type { FolderAccessManager } from '../../folderAccessManager'

const mockHandle = vi.hoisted(() => vi.fn())
const mockFromWebContents = vi.hoisted(() => vi.fn())
const mockChooseCloneParentDialog = vi.hoisted(() => vi.fn<() => Promise<string | null>>())
const mockCloneRepository = vi.hoisted(() =>
  vi.fn<
    (
      url: string,
      folderName: string,
      parentDir: string,
      signal: AbortSignal
    ) => Promise<CloneRepositoryResult>
  >()
)

vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: mockFromWebContents } }))
vi.mock('../../dialogService', () => ({ chooseCloneParentDialog: mockChooseCloneParentDialog }))
// URL・フォルダ名の検証(assertValidCloneRequest)は実物を使い、clone の実行だけを差し替える
vi.mock('../../gitCloneService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../gitCloneService')>()),
  cloneRepository: mockCloneRepository
}))

import { CLONE_ALREADY_RUNNING_MESSAGE, CloneRegistry } from '../../cloneRegistry'
import { CLONE_FOLDER_NAME_MESSAGES } from '../../gitCloneService'
import { REMOTE_URL_RULE_MESSAGES } from '../../gitRemoteSetupService'
import { registerCloneHandlers } from '../../handlers/cloneHandlers'

const mockIpcMain = { handle: mockHandle } as never
const URL = 'https://github.com/a/b.git'

function makeFolderAccess(): FolderAccessManager & { set: ReturnType<typeof vi.fn> } {
  return {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    assertWithinFolder: vi.fn(),
    assertParentWithinFolder: vi.fn()
  } as unknown as FolderAccessManager & { set: ReturnType<typeof vi.fn> }
}

function makeEvent(senderId: number, destroyed = false): unknown {
  return { sender: { id: senderId, isDestroyed: () => destroyed } }
}

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

let folderAccess: ReturnType<typeof makeFolderAccess>
let registry: CloneRegistry

beforeEach(() => {
  // 持続する実装は使わず、各テストで Once を設定する(パターン 103)
  mockHandle.mockReset()
  mockFromWebContents.mockReset()
  mockChooseCloneParentDialog.mockReset()
  mockCloneRepository.mockReset()
  mockFromWebContents.mockReturnValue({ id: 'window' })
  folderAccess = makeFolderAccess()
  registry = new CloneRegistry()
  registerCloneHandlers(mockIpcMain, folderAccess, registry)
})

describe('git:cloneRepository', () => {
  it('送信元のウィンドウのダイアログで親フォルダを選び、URL・フォルダ名・親・中止の口だけで clone する', async () => {
    mockChooseCloneParentDialog.mockResolvedValueOnce('/parent')
    mockCloneRepository.mockResolvedValueOnce({ status: 'cloned', path: '/parent/b' })
    const event = makeEvent(1) as { sender: unknown }
    const result = await getRegisteredHandler('git:cloneRepository')(event, URL, 'b', 'extra', 1)
    expect(result).toEqual({ status: 'cloned', path: '/parent/b' })
    expect(mockFromWebContents).toHaveBeenCalledWith(event.sender)
    expect(mockChooseCloneParentDialog).toHaveBeenCalledWith({ id: 'window' })
    expect(mockCloneRepository).toHaveBeenCalledOnce()
    const args = mockCloneRepository.mock.calls[0]
    expect(args).toHaveLength(4)
    expect(args.slice(0, 3)).toEqual([URL, 'b', '/parent'])
    expect(args[3]).toBeInstanceOf(AbortSignal)
    // 成功したときだけ、そのフォルダを開く許可に切り替える
    expect(folderAccess.set).toHaveBeenCalledWith(1, '/parent/b')
    expect(registry.isRunning(1)).toBe(false)
  })

  it.each([
    ['URL が文字列でない', 1, 'b', 'Invalid remote url'],
    ['フォルダ名が文字列でない', URL, null, 'Invalid folder name'],
    ['URL が許可リストに無い', 'ext::sh -c x', 'b', REMOTE_URL_RULE_MESSAGES['invalid-char']],
    ['フォルダ名が空', URL, '', CLONE_FOLDER_NAME_MESSAGES.empty],
    ['フォルダ名にパス区切り', URL, 'a/b', CLONE_FOLDER_NAME_MESSAGES.invalid]
  ])('%s なら、ダイアログを出さずに拒否する', async (_label, url, name, message) => {
    await expect(
      getRegisteredHandler('git:cloneRepository')(makeEvent(1), url, name)
    ).rejects.toThrow(message)
    expect(mockChooseCloneParentDialog).not.toHaveBeenCalled()
    expect(mockCloneRepository).not.toHaveBeenCalled()
    expect(registry.isRunning(1)).toBe(false)
  })

  it('ダイアログを取り消したら clone せずに canceled', async () => {
    mockChooseCloneParentDialog.mockResolvedValueOnce(null)
    expect(await getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')).toEqual({
      status: 'canceled'
    })
    expect(mockCloneRepository).not.toHaveBeenCalled()
    expect(folderAccess.set).not.toHaveBeenCalled()
    expect(registry.isRunning(1)).toBe(false)
  })

  it('clone の中止(canceled)では、開くフォルダの許可を変えない', async () => {
    mockChooseCloneParentDialog.mockResolvedValueOnce('/parent')
    mockCloneRepository.mockResolvedValueOnce({ status: 'canceled' })
    expect(await getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')).toEqual({
      status: 'canceled'
    })
    expect(folderAccess.set).not.toHaveBeenCalled()
  })

  it('clone の失敗はそのまま投げ、開くフォルダの許可を変えず、実行中を解く', async () => {
    mockChooseCloneParentDialog.mockResolvedValueOnce('/parent')
    mockCloneRepository.mockRejectedValueOnce(new Error('リポジトリを clone できませんでした: x'))
    await expect(
      getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')
    ).rejects.toThrow('リポジトリを clone できませんでした: x')
    expect(folderAccess.set).not.toHaveBeenCalled()
    expect(registry.isRunning(1)).toBe(false)
  })

  it('ダイアログの失敗でも実行中を解く', async () => {
    mockChooseCloneParentDialog.mockRejectedValueOnce(new Error('dialog failed'))
    await expect(
      getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')
    ).rejects.toThrow('dialog failed')
    expect(registry.isRunning(1)).toBe(false)
  })

  it('同じウィンドウで実行中なら拒否する(別のウィンドウは実行できる)', async () => {
    const dialog = deferred<string | null>()
    mockChooseCloneParentDialog.mockReturnValueOnce(dialog.promise)
    const first = getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')
    await expect(
      getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'c')
    ).rejects.toThrow(CLONE_ALREADY_RUNNING_MESSAGE)
    mockChooseCloneParentDialog.mockResolvedValueOnce(null)
    await expect(
      getRegisteredHandler('git:cloneRepository')(makeEvent(2), URL, 'c')
    ).resolves.toEqual({ status: 'canceled' })
    dialog.resolve(null)
    await expect(first).resolves.toEqual({ status: 'canceled' })
  })

  it('ダイアログの表示中に中止されたら、選ばれても clone しない', async () => {
    const dialog = deferred<string | null>()
    mockChooseCloneParentDialog.mockReturnValueOnce(dialog.promise)
    const running = getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')
    await getRegisteredHandler('git:cancelCloneRepository')(makeEvent(1))
    dialog.resolve('/parent')
    await expect(running).resolves.toEqual({ status: 'canceled' })
    expect(mockCloneRepository).not.toHaveBeenCalled()
  })

  it('成功の時点でウィンドウが閉じていたら、許可を登録せずに canceled', async () => {
    mockChooseCloneParentDialog.mockResolvedValueOnce('/parent')
    mockCloneRepository.mockResolvedValueOnce({ status: 'cloned', path: '/parent/b' })
    expect(await getRegisteredHandler('git:cloneRepository')(makeEvent(1, true), URL, 'b')).toEqual(
      { status: 'canceled' }
    )
    expect(folderAccess.set).not.toHaveBeenCalled()
  })
})

describe('git:cancelCloneRepository', () => {
  it('同じウィンドウの実行中の clone の中止の口を中止する', async () => {
    mockChooseCloneParentDialog.mockResolvedValueOnce('/parent')
    const clone = deferred<CloneRepositoryResult>()
    mockCloneRepository.mockReturnValueOnce(clone.promise)
    const running = getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')
    await vi.waitFor(() => expect(mockCloneRepository).toHaveBeenCalledOnce())
    const signal = mockCloneRepository.mock.calls[0][3]
    await getRegisteredHandler('git:cancelCloneRepository')(makeEvent(2))
    expect(signal.aborted).toBe(false)
    await getRegisteredHandler('git:cancelCloneRepository')(makeEvent(1))
    expect(signal.aborted).toBe(true)
    clone.resolve({ status: 'canceled' })
    await expect(running).resolves.toEqual({ status: 'canceled' })
  })

  it('実行中でなければ何もしない', async () => {
    expect(() => getRegisteredHandler('git:cancelCloneRepository')(makeEvent(1))).not.toThrow()
  })
})
```

`src/main/__tests__/ipcHandlers.test.ts`（変更。差分）:

```diff
--- a/src/main/__tests__/ipcHandlers.test.ts
+++ b/src/main/__tests__/ipcHandlers.test.ts
@@ -8,6 +8,8 @@ const mockRegisterSettingsHandlers = vi.hoisted(() => vi.fn())
 const mockRegisterPromptsHandlers = vi.hoisted(() => vi.fn())
 const mockRegisterProgressHandlers = vi.hoisted(() => vi.fn())
 const mockRegisterClaudeHandlers = vi.hoisted(() => vi.fn())
+const mockRegisterCloneHandlers = vi.hoisted(() => vi.fn())
+const mockSetupCloneLifecycle = vi.hoisted(() => vi.fn())

 vi.mock('electron', () => ({
   app: {}
@@ -23,6 +25,14 @@ vi.mock('../handlers/fileSystemHandlers', () => ({
 vi.mock('../handlers/gitHandlers', () => ({
   registerGitHandlers: mockRegisterGitHandlers
 }))
+vi.mock('../handlers/cloneHandlers', () => ({
+  registerCloneHandlers: mockRegisterCloneHandlers
+}))
+// CloneRegistry は実物を使い、app へのイベントの登録(setupCloneLifecycle)だけを差し替える(app はモックの空オブジェクト)
+vi.mock('../cloneRegistry', async (importOriginal) => ({
+  ...(await importOriginal<typeof import('../cloneRegistry')>()),
+  setupCloneLifecycle: mockSetupCloneLifecycle
+}))
 vi.mock('../handlers/settingsHandlers', () => ({
   registerSettingsHandlers: mockRegisterSettingsHandlers
 }))
@@ -37,6 +47,7 @@ vi.mock('../handlers/claudeHandlers', () => ({
 }))

 import { registerIpcHandlers } from '../ipcHandlers'
+import { CloneRegistry } from '../cloneRegistry'

 const mockIpcMain = { handle: mockHandle } as never

@@ -45,6 +56,17 @@ beforeEach(() => {
 })

 describe('registerIpcHandlers', () => {
+  it('registerCloneHandlers に、ファイル操作と同じ FolderAccessManager と、ウィンドウを閉じたときに中止する CloneRegistry を渡す', () => {
+    registerIpcHandlers(mockIpcMain)
+    expect(mockRegisterCloneHandlers).toHaveBeenCalledOnce()
+    const [ipcMain, folderAccess, registry] = mockRegisterCloneHandlers.mock.calls[0]
+    expect(ipcMain).toBe(mockIpcMain)
+    expect(folderAccess).toBe(mockRegisterFileSystemHandlers.mock.calls[0][1])
+    expect(registry).toBeInstanceOf(CloneRegistry)
+    expect(mockSetupCloneLifecycle).toHaveBeenCalledOnce()
+    expect(mockSetupCloneLifecycle.mock.calls[0][1]).toBe(registry)
+  })
+
   it('registerFileSystemHandlers を ipcMain と FolderAccessManager を引数に呼び出す', () => {
     registerIpcHandlers(mockIpcMain)
     expect(mockRegisterFileSystemHandlers).toHaveBeenCalledOnce()
@@ -80,7 +102,10 @@ describe('registerIpcHandlers', () => {
   it('setupFolderAccessLifecycle を app と FolderAccessManager を引数に呼び出す', () => {
     registerIpcHandlers(mockIpcMain)
     expect(mockSetupFolderAccessLifecycle).toHaveBeenCalledOnce()
-    expect(mockSetupFolderAccessLifecycle).toHaveBeenCalledWith(expect.any(Object), expect.any(Object))
+    expect(mockSetupFolderAccessLifecycle).toHaveBeenCalledWith(
+      expect.any(Object),
+      expect.any(Object)
+    )
   })

   it('fileSystemHandlers と gitHandlers に同一の FolderAccessManager インスタンスを渡す', () => {
```

`src/preload/__tests__/api.test.ts`（変更。差分）:

```diff
--- a/src/preload/__tests__/api.test.ts
+++ b/src/preload/__tests__/api.test.ts
@@ -206,6 +206,16 @@ const invokeCases: Array<[string, () => unknown, unknown[]]> = [
     () => api.pushSetUpstream(),
     ['git:pushSetUpstream']
   ],
+  [
+    'cloneRepository は git:cloneRepository チャンネルに URL とフォルダ名を渡す',
+    () => api.cloneRepository('https://github.com/a/b.git', 'b'),
+    ['git:cloneRepository', 'https://github.com/a/b.git', 'b']
+  ],
+  [
+    'cancelCloneRepository は git:cancelCloneRepository チャンネルを引数なしで呼び出す',
+    () => api.cancelCloneRepository(),
+    ['git:cancelCloneRepository']
+  ],
   [
     'stashPush は git:stashPush チャンネルにメッセージを渡す',
     () => api.stashPush('msg'),
```

`src/renderer/src/lib/__tests__/gitApi.test.ts`（変更。差分）:

```diff
--- a/src/renderer/src/lib/__tests__/gitApi.test.ts
+++ b/src/renderer/src/lib/__tests__/gitApi.test.ts
@@ -25,6 +25,8 @@ import {
   stashDrop,
   createTag,
   initRepository,
+  cloneRepository,
+  cancelCloneRepository,
   addOrigin,
   pushSetUpstream,
   mergeBranch,
@@ -65,6 +67,8 @@ const mockApi = {
   stashDrop: vi.fn(),
   createTag: vi.fn(),
   initRepository: vi.fn(),
+  cloneRepository: vi.fn(),
+  cancelCloneRepository: vi.fn(),
   addOrigin: vi.fn(),
   pushSetUpstream: vi.fn(),
   mergeBranch: vi.fn(),
@@ -419,3 +423,24 @@ describe('initRepository / addOrigin / pushSetUpstream', () => {
     )
   })
 })
+
+describe('cloneRepository / cancelCloneRepository', () => {
+  it('window.api の同名の関数を呼び、結果をそのまま返す', async () => {
+    mockApi.cloneRepository.mockResolvedValueOnce({ status: 'cloned', path: '/parent/b' })
+    mockApi.cancelCloneRepository.mockResolvedValueOnce(undefined)
+    await expect(cloneRepository('https://github.com/a/b.git', 'b')).resolves.toEqual({
+      status: 'cloned',
+      path: '/parent/b'
+    })
+    await cancelCloneRepository()
+    expect(mockApi.cloneRepository).toHaveBeenCalledWith('https://github.com/a/b.git', 'b')
+    expect(mockApi.cancelCloneRepository).toHaveBeenCalledWith()
+  })
+
+  it('失敗をそのまま伝える', async () => {
+    mockApi.cloneRepository.mockRejectedValueOnce(new Error('既に clone を実行中です'))
+    await expect(cloneRepository('https://github.com/a/b.git', 'b')).rejects.toThrow(
+      '既に clone を実行中です'
+    )
+  })
+})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run src/main/__tests__/cloneRegistry.test.ts src/main/__tests__/dialogService.test.ts src/main/__tests__/handlers/cloneHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/gitApi.test.ts
```

Expected: FAIL（`../cloneRegistry`・`../../handlers/cloneHandlers` が無い。`chooseCloneParentDialog`・`api.cloneRepository`・`gitApi.cloneRepository` が無い）

- [ ] **Step 3: 実装する**

`src/main/cloneRegistry.ts`（新規。全文）:

```ts
import type { App } from 'electron'

export const CLONE_ALREADY_RUNNING_MESSAGE = '既に clone を実行中です'

// ウィンドウ(webContents の id)ごとの、実行中の clone の中止の口。1 つのウィンドウで同時に 1 つだけ。
// 保存先の選択(OS のダイアログ)の間も実行中として扱う(その間の中止は、選択の後に clone へ進まない)
export class CloneRegistry {
  private readonly running = new Map<number, AbortController>()

  /** 実行中にする。既に実行中なら、既存の clone に触れずに拒否する */
  begin(ownerId: number): AbortController {
    if (this.running.has(ownerId)) throw new Error(CLONE_ALREADY_RUNNING_MESSAGE)
    const controller = new AbortController()
    this.running.set(ownerId, controller)
    return controller
  }

  /** 実行中を解く。begin が返した controller と一致するときだけ(別の実行の登録を消さない) */
  end(ownerId: number, controller: AbortController): void {
    if (this.running.get(ownerId) === controller) this.running.delete(ownerId)
  }

  /** 実行中の clone を中止する。実行中でなければ何もしない(冪等) */
  cancel(ownerId: number): void {
    this.running.get(ownerId)?.abort()
  }

  isRunning(ownerId: number): boolean {
    return this.running.has(ownerId)
  }
}

// ウィンドウが閉じたら(webContents の destroyed)、そのウィンドウの clone を中止する(子プロセスを止め、作った保存先を
// 削除する)。アプリの終了で main プロセスごと止まる場合は、保存先に不完全なフォルダが残りうる(既知の制約)
export function setupCloneLifecycle(app: App, registry: CloneRegistry): void {
  app.on('web-contents-created', (_event, webContents) => {
    webContents.on('destroyed', () => registry.cancel(webContents.id))
  })
}
```

`src/main/dialogService.ts`（変更。差分）:

```diff
--- a/src/main/dialogService.ts
+++ b/src/main/dialogService.ts
@@ -1,10 +1,11 @@
 import { dialog } from 'electron'
+import type { BrowserWindow, OpenDialogOptions } from 'electron'

 const JSON_FILTERS = [{ name: 'JSON', extensions: ['json'] }]

 export async function openFolderDialog(): Promise<string | null> {
   const { filePaths } = await dialog.showOpenDialog({
-    properties: ['openDirectory'],
+    properties: ['openDirectory']
   })
   return filePaths[0] ?? null
 }
@@ -13,7 +14,7 @@ export async function openFolderDialog(): Promise<string | null> {
 export async function saveJsonDialog(defaultFileName: string): Promise<string | null> {
   const { filePath } = await dialog.showSaveDialog({
     defaultPath: defaultFileName,
-    filters: JSON_FILTERS,
+    filters: JSON_FILTERS
   })
   return filePath ?? null
 }
@@ -22,7 +23,27 @@ export async function saveJsonDialog(defaultFileName: string): Promise<string |
 export async function openJsonDialog(): Promise<string | null> {
   const { filePaths } = await dialog.showOpenDialog({
     properties: ['openFile'],
-    filters: JSON_FILTERS,
+    filters: JSON_FILTERS
   })
   return filePaths[0] ?? null
 }
+
+const CLONE_PARENT_DIALOG_OPTIONS: OpenDialogOptions = {
+  title: 'clone の保存先（親フォルダ）を選択',
+  buttonLabel: 'ここに clone',
+  properties: ['openDirectory', 'createDirectory']
+}
+
+/** clone の保存先の親フォルダを選ぶダイアログ。キャンセル時は null を返す。
+ *  ウィンドウがあれば、そのウィンドウのモーダル(macOS はシート)にする。選んでいる間は画面の操作(clone のダイアログの
+ *  `キャンセル` など)を受け付けず、中止は OS のダイアログで行う */
+export async function chooseCloneParentDialog(
+  window: BrowserWindow | null
+): Promise<string | null> {
+  const { canceled, filePaths } =
+    window === null
+      ? await dialog.showOpenDialog(CLONE_PARENT_DIALOG_OPTIONS)
+      : await dialog.showOpenDialog(window, CLONE_PARENT_DIALOG_OPTIONS)
+  if (canceled) return null
+  return filePaths[0] ?? null
+}
```

`src/main/handlers/cloneHandlers.ts`（新規。全文）:

```ts
import { BrowserWindow } from 'electron'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { CloneRepositoryResult } from '@shared/types'
import type { CloneRegistry } from '../cloneRegistry'
import { chooseCloneParentDialog } from '../dialogService'
import type { FolderAccessManager } from '../folderAccessManager'
import { assertValidCloneRequest, cloneRepository } from '../gitCloneService'

// IPC 境界は任意の値を受け付けるため、service が TypeError で落ちる前に引数の型を検証する(gitHandlers の
// assertRemoteUrlArg と同じ流儀)。値の中身(URL の許可リスト・フォルダ名の規則)は service が検証する
function assertCloneUrlArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid remote url')
}

function assertCloneFolderNameArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid folder name')
}

// リポジトリの clone。フォルダが開いていなくても使える(getAllowedFolder を使わない)。保存先の親フォルダは OS の
// ダイアログで main が選ぶ(renderer からパスを受け取らない)。成功したときだけ、そのフォルダを開く許可に切り替える
// (失敗・中止では、開いているフォルダの許可はそのまま)。service の第 5 引数(打ち切りの時間など)はテスト用。
// renderer から届いた余分な引数は渡さない
export function registerCloneHandlers(
  ipcMain: IpcMain,
  folderAccess: FolderAccessManager,
  registry: CloneRegistry
): void {
  ipcMain.handle(
    'git:cloneRepository',
    async (
      event: IpcMainInvokeEvent,
      url: unknown,
      folderName: unknown
    ): Promise<CloneRepositoryResult> => {
      assertCloneUrlArg(url)
      assertCloneFolderNameArg(folderName)
      // OS のダイアログを出す前に、URL とフォルダ名を検証する(不正な入力で保存先を選ばせない。パターン 94)
      assertValidCloneRequest(url, folderName)
      const ownerId = event.sender.id
      const controller = registry.begin(ownerId)
      try {
        const parentDir = await chooseCloneParentDialog(BrowserWindow.fromWebContents(event.sender))
        // 選んでいる間に中止された(ウィンドウを閉じた)ら clone へ進まない
        if (parentDir === null || controller.signal.aborted) return { status: 'canceled' }
        const result = await cloneRepository(url, folderName, parentDir, controller.signal)
        if (result.status !== 'cloned') return result
        // 閉じたウィンドウの id で許可を残さない(destroyed の後に登録すると、FolderAccessManager から消えない)
        if (event.sender.isDestroyed()) return { status: 'canceled' }
        folderAccess.set(ownerId, result.path)
        return result
      } finally {
        registry.end(ownerId, controller)
      }
    }
  )

  // 実行中の clone を中止する。実行中でなければ何もしない(冪等)
  ipcMain.handle('git:cancelCloneRepository', (event: IpcMainInvokeEvent): void => {
    registry.cancel(event.sender.id)
  })
}
```

`src/main/ipcHandlers.ts`（変更。差分）:

```diff
--- a/src/main/ipcHandlers.ts
+++ b/src/main/ipcHandlers.ts
@@ -4,6 +4,8 @@ import { FolderAccessManager } from './folderAccessManager'
 import { setupFolderAccessLifecycle } from './folderAccessLifecycle'
 import { registerFileSystemHandlers } from './handlers/fileSystemHandlers'
 import { registerGitHandlers } from './handlers/gitHandlers'
+import { registerCloneHandlers } from './handlers/cloneHandlers'
+import { CloneRegistry, setupCloneLifecycle } from './cloneRegistry'
 import { registerSettingsHandlers } from './handlers/settingsHandlers'
 import { registerPromptsHandlers } from './handlers/promptsHandlers'
 import { registerProgressHandlers } from './handlers/progressHandlers'
@@ -19,6 +21,10 @@ export function registerIpcHandlers(ipcMain: IpcMain): void {

   registerFileSystemHandlers(ipcMain, folderAccess)
   registerGitHandlers(ipcMain, folderAccess)
+  // clone は成功したフォルダを開く許可に切り替えるため、同じ FolderAccessManager を渡す
+  const cloneRegistry = new CloneRegistry()
+  setupCloneLifecycle(app, cloneRegistry)
+  registerCloneHandlers(ipcMain, folderAccess, cloneRegistry)
   registerSettingsHandlers(ipcMain)
   registerPromptsHandlers(ipcMain)
   registerProgressHandlers(ipcMain)
```

`src/preload/api.ts`（変更。差分）:

```diff
--- a/src/preload/api.ts
+++ b/src/preload/api.ts
@@ -1,6 +1,7 @@
 import { ipcRenderer } from 'electron'
 import type {
   CLIOnlyToolId,
+  CloneRepositoryResult,
   ConflictChoice,
   ConflictFile,
   CreateTagRequest,
@@ -99,6 +100,9 @@ export const api = {
   initRepository: (branch: string): Promise<void> => ipcRenderer.invoke('git:init', branch),
   addOrigin: (url: string): Promise<void> => ipcRenderer.invoke('git:addOrigin', url),
   pushSetUpstream: (): Promise<void> => ipcRenderer.invoke('git:pushSetUpstream'),
+  cloneRepository: (url: string, folderName: string): Promise<CloneRepositoryResult> =>
+    ipcRenderer.invoke('git:cloneRepository', url, folderName),
+  cancelCloneRepository: (): Promise<void> => ipcRenderer.invoke('git:cancelCloneRepository'),
   addToGitignore: (targetPath: string): Promise<void> =>
     ipcRenderer.invoke('fs:addToGitignore', targetPath),
   hasApiKey: (): Promise<boolean> => ipcRenderer.invoke('settings:hasApiKey'),
```

`src/preload/index.d.ts`（変更。差分）:

```diff
--- a/src/preload/index.d.ts
+++ b/src/preload/index.d.ts
@@ -1,6 +1,7 @@
 import { ElectronAPI } from '@electron-toolkit/preload'
 import type {
   CLIOnlyToolId,
+  CloneRepositoryResult,
   ConflictChoice,
   ConflictFile,
   CreateTagRequest,
@@ -78,6 +79,8 @@ declare global {
       initRepository(branch: string): Promise<void>
       addOrigin(url: string): Promise<void>
       pushSetUpstream(): Promise<void>
+      cloneRepository(url: string, folderName: string): Promise<CloneRepositoryResult>
+      cancelCloneRepository(): Promise<void>
       addToGitignore(targetPath: string): Promise<void>
       hasApiKey(): Promise<boolean>
       setApiKey(apiKey: string): Promise<void>
```

`src/renderer/src/lib/gitApi.ts`（変更。差分）:

```diff
--- a/src/renderer/src/lib/gitApi.ts
+++ b/src/renderer/src/lib/gitApi.ts
@@ -1,4 +1,5 @@
 import type {
+  CloneRepositoryResult,
   ConflictChoice,
   ConflictFile,
   CreateTagRequest,
@@ -172,3 +173,14 @@ export function addOrigin(url: string): Promise<void> {
 export function pushSetUpstream(): Promise<void> {
   return window.api.pushSetUpstream()
 }
+
+// リポジトリを clone する(保存先の親フォルダは main が OS のダイアログで選ぶ)。成功したら main はそのフォルダを
+// 開く許可に切り替えている(renderer は返ったパスを開く)
+export function cloneRepository(url: string, folderName: string): Promise<CloneRepositoryResult> {
+  return window.api.cloneRepository(url, folderName)
+}
+
+// 実行中の clone を中止する(実行中でなければ何もしない)
+export function cancelCloneRepository(): Promise<void> {
+  return window.api.cancelCloneRepository()
+}
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run src/main src/preload src/renderer/src/lib/__tests__/gitApi.test.ts
```

Expected: すべて成功（main の既存のテストを含む）

- [ ] **Step 5: 変異で検知力を確かめる**

`BAK="$(mktemp -d)" && cp src/main/handlers/cloneHandlers.ts src/main/cloneRegistry.ts src/main/ipcHandlers.ts "$BAK/"` で退避し、1 つずつエディタで書き換えて `npx vitest run src/main/__tests__/handlers/cloneHandlers.test.ts src/main/__tests__/cloneRegistry.test.ts src/main/__tests__/ipcHandlers.test.ts`（と `-t` 単独）で落ちることを確かめ、そのつど元に戻す。括弧内はプラン作成時に検証用の写しで落ちたテスト。

1. `cloneHandlers.ts` の `if (result.status !== 'cloned') return result` の前に `folderAccess.set(ownerId, (result as { path: string }).path)` を足す（失敗・中止で許可を変えてしまう。`clone の中止(canceled)では、開くフォルダの許可を変えない`・`成功の時点でウィンドウが閉じていたら` の 2 件）
2. `assertValidCloneRequest(url, folderName)` の行を消す（`URL が許可リストに無い`・`フォルダ名が空`・`フォルダ名にパス区切り` の 3 件。ダイアログが出てしまう）
3. `if (parentDir === null || controller.signal.aborted)` を `if (parentDir === null)` にする（`ダイアログの表示中に中止されたら` の 1 件）
4. `if (event.sender.isDestroyed()) return { status: 'canceled' }` を消す（`成功の時点でウィンドウが閉じていたら` の 1 件）
5. `cloneRegistry.ts` の `end` を、controller を見ずに `this.running.delete(ownerId)` にする（`古い controller の end は、新しい実行の登録を消さない` の 1 件）
6. `ipcHandlers.ts` の `setupCloneLifecycle(app, cloneRegistry)` を消す（`registerCloneHandlers に、…CloneRegistry を渡す` の 1 件）

最後に `for f in cloneHandlers.ts; do cmp "$BAK/$f" "src/main/handlers/$f"; done; for f in cloneRegistry.ts ipcHandlers.ts; do cmp "$BAK/$f" "src/main/$f"; done` が何も出力しないことを確かめる。

- [ ] **Step 6: 型・lint・整形を確かめる**

```bash
npm run typecheck
npx eslint src/main/cloneRegistry.ts src/main/handlers/cloneHandlers.ts src/main/dialogService.ts src/main/ipcHandlers.ts src/preload/api.ts src/preload/index.d.ts src/renderer/src/lib/gitApi.ts src/main/__tests__/cloneRegistry.test.ts src/main/__tests__/handlers/cloneHandlers.test.ts src/main/__tests__/dialogService.test.ts src/main/__tests__/ipcHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/gitApi.test.ts
npx prettier --check src/main/cloneRegistry.ts src/main/handlers/cloneHandlers.ts src/main/dialogService.ts src/main/ipcHandlers.ts src/preload/api.ts src/preload/index.d.ts src/renderer/src/lib/gitApi.ts src/main/__tests__/cloneRegistry.test.ts src/main/__tests__/handlers/cloneHandlers.test.ts src/main/__tests__/dialogService.test.ts src/main/__tests__/ipcHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/gitApi.test.ts
```

Expected: すべて成功

- [ ] **Step 7: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 5: `useFileSystem` の `openFolder` から `applyOpenedFolder` を切り出す（既存の挙動を先に固定する）

**Files:**

- Modify: `src/renderer/src/hooks/useFileSystem.ts`
- Create: `src/renderer/src/hooks/__tests__/useFileSystem.openFolder.test.ts`
- 変更しない: `src/renderer/src/hooks/__tests__/useFileSystem.test.ts`（134 件）・`useFileSystem.conflict.test.ts`

**Interfaces:**

- Consumes: なし（既存の `fileSystemApi.openFolder` / `readDirectory`）
- Produces: `applyOpenedFolder(path, { dirtySnapshotAtConfirm })`・`ApplyOpenedFolderOptions`・`captureDirtySnapshot()`（`useFileSystem` の戻り値）
- 注: リスクが高いため 3 段に分ける。(1) 分け目にあたる既存の挙動（未保存の確認はダイアログの前に 1 回・ダイアログが返った時点の未保存の有無を基準にする・ダイアログの失敗は `error` だけ・走査の失敗はフォルダを確定して `error` と `folderLoadError`）を新しいファイルのテストで固定し、**今の実装で通る**ことを確かめる。(2) 本体を `runFolderOpen(selectPath)` へ移し、`openFolder` はそれを呼ぶだけにする（外から見える挙動は変えない。既存の 134 件と固定のテストが**変更なしで**通る）。(3) `applyOpenedFolder` と `captureDirtySnapshot` を足し、`runFolderOpen` に確認の時点の未保存の内容（`dirtySnapshotAtConfirm?`）を渡せるようにする（差異 14。未保存の有無ではなく内容で比べる）
- 注: 世代の管理（`dialogAttemptRef`・`latestDirectoryReadRef`・`treeWriteSeqRef`・`pendingFolderOpenRef`）・キャンセル時に現在のエラーを消さない扱い・走査の失敗でもフォルダを確定する扱い・`finally` の取り直しは `runFolderOpen` の中にそのまま残す（行を動かさない）

- [ ] **Step 1: 分け目の既存の挙動を固定するテストを書く**

`src/renderer/src/hooks/__tests__/useFileSystem.openFolder.test.ts`（新規。Step 4 で末尾に applyOpenedFolder のテストを追記する）:

```ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileTreeNode } from '../../types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import { useFileSystem } from '../useFileSystem'

// openFolder を「フォルダの選択(OS のダイアログ)」と「選ばれたパスを開く(applyOpenedFolder)」に分ける変更の前に、
// 分け目にあたる既存の挙動を固定する(clone の機能のプラン Task 5)。既存の useFileSystem.test.ts は変更しない
const mockOpenFolder = vi.mocked(fileSystemApi.openFolder)
const mockReadDirectory = vi.mocked(fileSystemApi.readDirectory)
const mockReadFileContent = vi.mocked(fileSystemApi.readFileContent)

const projectTree: FileTreeNode[] = [{ name: 'index.ts', path: '/project/index.ts', type: 'file' }]
const otherTree: FileTreeNode[] = [{ name: 'other.ts', path: '/other/other.ts', type: 'file' }]

function treeFor(path: string): FileTreeNode[] {
  if (path === '/project') return projectTree
  if (path === '/other') return otherTree
  return []
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (err: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type Hook = { current: ReturnType<typeof useFileSystem> }

// /project を開いて index.ts をタブで開く
async function openProjectWithTab(result: Hook): Promise<void> {
  mockOpenFolder.mockResolvedValueOnce('/project')
  await act(async () => {
    await result.current.openFolder()
  })
  await act(async () => {
    await result.current.selectFile(projectTree[0])
  })
}

beforeEach(() => {
  // 持続する実装を前のテストから持ち込まない(パターン 103)。走査はパスごとに決まった木を返す
  vi.resetAllMocks()
  mockReadDirectory.mockImplementation((path: string) => Promise.resolve(treeFor(path)))
  mockReadFileContent.mockResolvedValue('const x = 1')
})

describe('openFolder(切り出しの前に固定する既存の挙動)', () => {
  it('未保存の確認はダイアログの前に 1 回だけ。ダイアログを取り消しても、もう一度は確認せずタブを残す', async () => {
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    act(() => result.current.updateFileContent('編集'))
    mockOpenFolder.mockResolvedValueOnce(null)
    await act(async () => {
      await result.current.openFolder()
    })
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(result.current.folderPath).toBe('/project')
    expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/index.ts'])
  })

  it('ダイアログが返った時点の未保存の有無を基準にし、走査の後も変わらなければ確認せずにタブを閉じる', async () => {
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    const dialog = deferred<string | null>()
    mockOpenFolder.mockReturnValueOnce(dialog.promise)
    let opening: Promise<void> = Promise.resolve()
    act(() => {
      opening = result.current.openFolder()
    })
    // ダイアログの表示中(ネイティブのダイアログはモーダルで、実際には編集できない)に未保存にする
    act(() => result.current.updateFileContent('編集'))
    await act(async () => {
      dialog.resolve('/other')
      await opening
    })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.openFiles).toEqual([])
  })

  it('ダイアログの失敗は error だけを立て、folderLoadError は立てず、フォルダもそのまま', async () => {
    const { result } = renderHook(() => useFileSystem())
    await openProjectWithTab(result)
    mockOpenFolder.mockRejectedValueOnce(new Error('dialog error'))
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.error?.message).toBe('dialog error')
    expect(result.current.folderLoadError).toBeNull()
    expect(result.current.folderPath).toBe('/project')
    expect(mockReadDirectory).toHaveBeenCalledTimes(1)
  })

  it('走査の失敗では、選んだフォルダを確定して error と folderLoadError の両方を立てる', async () => {
    const { result } = renderHook(() => useFileSystem())
    mockOpenFolder.mockResolvedValueOnce('/other')
    mockReadDirectory.mockRejectedValueOnce(new Error('scan error'))
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.fileTree).toEqual([])
    expect(result.current.error?.message).toBe('scan error')
    expect(result.current.folderLoadError?.message).toBe('scan error')
  })
})
```

- [ ] **Step 2: 今の実装で固定のテストが通ることを確かめる**

```bash
npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.openFolder.test.ts src/renderer/src/hooks/__tests__/useFileSystem.test.ts src/renderer/src/hooks/__tests__/useFileSystem.conflict.test.ts
```

Expected: すべて成功（固定のテスト 4 件は、まだ何も変えていない実装で通る。通らなければ、テストが既存の挙動を表していないので直す）

- [ ] **Step 3: 本体を `runFolderOpen` へ移す（挙動は変えない）**

`src/renderer/src/hooks/useFileSystem.ts` の `const openFolder = async (): Promise<void> => {` から始まる関数を、次のとおり `runFolderOpen` に変える（本体の行は動かさず、先頭の 2 行と、ダイアログの呼び出しだけを書き換える）:

```diff
-  const openFolder = async (): Promise<void> => {
-    if (!confirmDiscardAnyDirty()) return
+  // フォルダを選び(selectPath)、そのフォルダを走査して開く。openFolder(OS のダイアログで選ぶ)と
+  // applyOpenedFolder(既に選ばれたパス)が共有する
+  const runFolderOpen = async (selectPath: () => Promise<string | null>): Promise<void> => {
     // ダイアログの表示前に試行の世代を割り当てる。解決後だと、ダイアログが
     // reject した時点で「最新の試行か」を判定できず、後続のフォルダ選択が
     // 確定したあとに先行操作のエラーで上書きしてしまう
@@
     try {
-      const path = await fileSystemApi.openFolder()
+      const path = await selectPath()
       // 先行ダイアログが後発の選択より遅れて返ることがある。古い試行のまま
       // 進むと、走査の世代を進めて後発の結果を捨て、古いフォルダが最終表示になる
       if (dialogAttemptId !== dialogAttemptRef.current) return
```

続けて、`runFolderOpen` の閉じ括弧の直後（`// 呼び出し側が「実際に開けたか」で分岐できるよう成否を返す。` の直前）に `openFolder` を置く:

```ts
const openFolder = async (): Promise<void> => {
  if (!confirmDiscardAnyDirty()) return
  await runFolderOpen(() => fileSystemApi.openFolder())
}
```

```bash
npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.openFolder.test.ts src/renderer/src/hooks/__tests__/useFileSystem.test.ts src/renderer/src/hooks/__tests__/useFileSystem.conflict.test.ts
git diff --stat -- src/renderer/src/hooks/__tests__/useFileSystem.test.ts src/renderer/src/hooks/__tests__/useFileSystem.conflict.test.ts
```

Expected: すべて成功し、既存のテストファイルの差分は空

- [ ] **Step 4: `applyOpenedFolder` の失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useFileSystem.openFolder.test.ts` の末尾に追加（確認の時点の未保存の内容 `captureDirtySnapshot()` を渡す。未保存の有無が true のまま内容が変わる場合・別のタブを編集した場合・走査の失敗でタブを閉じる判定も固定する）:

```ts
// /project の 2 つ目のファイル(別のタブの編集を確かめるために開く。走査の木には含めない)
const secondFile: FileTreeNode = { name: 'b.ts', path: '/project/b.ts', type: 'file' }

describe('applyOpenedFolder', () => {
  it('渡したパスを走査して開き、ダイアログは使わない', async () => {
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(mockOpenFolder).not.toHaveBeenCalled()
    expect(mockReadDirectory).toHaveBeenCalledExactlyOnceWith('/other')
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.fileTree).toEqual(otherTree)
    expect(result.current.error).toBeNull()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('確認の時点から未保存の内容が変わらなければ、もう一度は確認せずにタブを閉じる', async () => {
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    act(() => result.current.updateFileContent('編集'))
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(result.current.openFiles).toEqual([])
    expect(result.current.folderPath).toBe('/other')
  })

  it('確認の時点で未保存が無く、その後に編集が入ったら、もう一度確認する。取り消せばフォルダだけ切り替えてタブを残す', async () => {
    const onConfirm = vi.fn(() => false)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    // 確認の後(clone の実行中)に編集した
    act(() => result.current.updateFileContent('clone 中の編集'))
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.openFiles.map((f) => f.content)).toEqual(['clone 中の編集'])
  })

  it('確認の時点で未保存があり、その後に同じタブをさらに編集したら、もう一度確認する。取り消せばタブを残す', async () => {
    const onConfirm = vi.fn(() => false)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    act(() => result.current.updateFileContent('確認前の編集'))
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    // 未保存の有無は true のまま変わらないが、内容は変わった(clone の実行中の編集)
    act(() => result.current.updateFileContent('確認前の編集 + clone 中の編集'))
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.openFiles.map((f) => f.content)).toEqual([
      '確認前の編集 + clone 中の編集'
    ])
  })

  it('確認の時点で未保存があり、その後に別のタブを編集しても、もう一度確認する。承諾すればタブを閉じる', async () => {
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    act(() => result.current.updateFileContent('確認前の編集'))
    await act(async () => {
      await result.current.selectFile(secondFile)
    })
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    act(() => result.current.updateFileContent('別のタブの clone 中の編集'))
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.openFiles).toEqual([])
  })

  it('実行中の openFolder のダイアログより後に呼ばれたら、ダイアログの結果を捨てる', async () => {
    const { result } = renderHook(() => useFileSystem())
    const dialog = deferred<string | null>()
    mockOpenFolder.mockReturnValueOnce(dialog.promise)
    let opening: Promise<void> = Promise.resolve()
    act(() => {
      opening = result.current.openFolder()
    })
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    await act(async () => {
      dialog.resolve('/project')
      await opening
    })
    expect(result.current.folderPath).toBe('/other')
    expect(mockReadDirectory).not.toHaveBeenCalledWith('/project')
  })

  it('走査の失敗では、パスを確定して error と folderLoadError を立てる', async () => {
    const { result } = renderHook(() => useFileSystem())
    mockReadDirectory.mockRejectedValueOnce(new Error('scan error'))
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.error?.message).toBe('scan error')
    expect(result.current.folderLoadError?.message).toBe('scan error')
  })

  it('走査の失敗でも、確認の時点から未保存の内容が変わらなければ、もう一度は確認せずにタブを閉じる', async () => {
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    act(() => result.current.updateFileContent('編集'))
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    mockReadDirectory.mockRejectedValueOnce(new Error('scan error'))
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.openFiles).toEqual([])
    expect(result.current.error?.message).toBe('scan error')
  })

  it('走査の失敗でも、確認の後に編集が入っていれば、もう一度確認する。取り消せばタブを残す', async () => {
    const onConfirm = vi.fn(() => false)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    act(() => result.current.updateFileContent('確認前の編集'))
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    act(() => result.current.updateFileContent('確認前の編集 + clone 中の編集'))
    mockReadDirectory.mockRejectedValueOnce(new Error('scan error'))
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.openFiles.map((f) => f.content)).toEqual([
      '確認前の編集 + clone 中の編集'
    ])
    expect(result.current.error?.message).toBe('scan error')
    expect(result.current.folderLoadError?.message).toBe('scan error')
  })

  it('captureDirtySnapshot は未保存の内容が同じなら同じ値を返し、編集で変わり、保存済みの内容へ戻すと元の値に戻る', async () => {
    const { result } = renderHook(() => useFileSystem())
    await openProjectWithTab(result)
    const clean = result.current.captureDirtySnapshot()
    expect(result.current.captureDirtySnapshot()).toBe(clean)
    act(() => result.current.updateFileContent('編集 1'))
    const edited1 = result.current.captureDirtySnapshot()
    expect(edited1).not.toBe(clean)
    act(() => result.current.updateFileContent('編集 2'))
    expect(result.current.captureDirtySnapshot()).not.toBe(edited1)
    act(() => result.current.updateFileContent('const x = 1'))
    expect(result.current.captureDirtySnapshot()).toBe(clean)
  })
})
```

```bash
npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.openFolder.test.ts
```

Expected: FAIL（`captureDirtySnapshot`・`applyOpenedFolder` が無い。typecheck でも `Property 'applyOpenedFolder' does not exist`）

- [ ] **Step 5: `applyOpenedFolder` と `captureDirtySnapshot` を足す**

`src/renderer/src/hooks/useFileSystem.ts`:

1. `export interface SelectFileOptions {` の直前に `ApplyOpenedFolderOptions`（`dirtySnapshotAtConfirm: string`）と、走査の前の状態の型 `DirtyBaseline`（`openFolder` は未保存の有無 `presence`、`applyOpenedFolder` は確認の時点の内容 `snapshot`）を追加する
2. `interface FileSystemState` に `applyOpenedFolder`（`openFolder` の直後）と `captureDirtySnapshot`（`confirmDiscardAnyDirty` の直後）を追加する
3. `captureDirtySnapshot`（未保存のタブを path 順に並べた `[path, content]` の組の JSON）を `confirmDiscardAnyDirty` の直後に置き、`confirmDiscardChangedSinceOpenFolder` が `DirtyBaseline` を受けて、`snapshot` なら「内容が確認の時点と同じなら確認しない。違えば `confirmDiscardAnyDirty()`（未保存が無ければ確認せず true）」で判定するようにする
4. `runFolderOpen` に `dirtySnapshotAtConfirm?: string` を足し、走査の前に `dirtyAtStart` を `DirtyBaseline` で控える（省略時は従来どおり `{ kind: 'presence', dirty: hasAnyDirtyTab() }`）
5. `openFolder` の直後に `applyOpenedFolder` を置き、戻り値に `applyOpenedFolder`・`captureDirtySnapshot` を足す

最終的な差分（Step 3 と Step 5 の合計）は次のとおり:

`src/renderer/src/hooks/useFileSystem.ts`（変更。差分）:

```diff
--- a/src/renderer/src/hooks/useFileSystem.ts
+++ b/src/renderer/src/hooks/useFileSystem.ts
@@ -37,6 +37,21 @@ export interface OpenedFileSignal {
   events: OpenedFileEvent[]
 }

+export interface ApplyOpenedFolderOptions {
+  /**
+   * 呼び出し側が未保存の確認(confirmDiscardAnyDirty)をした時点の未保存の状態(captureDirtySnapshot の値)。
+   * 走査の後にタブを閉じるとき、未保存のタブがあり、その内容がこの時点から変わっていれば、もう一度確認する
+   * (clone の実行中に入った編集を確認なしで捨てないため。未保存の有無だけで比べると、確認の時点で未保存が
+   * あったタブをさらに編集した場合や、別のタブを編集した場合を見逃す)
+   */
+  dirtySnapshotAtConfirm: string
+}
+
+// 走査の後にタブを閉じる前の再確認で、走査の前の状態として控えるもの。openFolder は未保存の有無(presence)で
+// 比べる(ダイアログはモーダルで、ダイアログが返ってから走査が終わるまでは短い)。applyOpenedFolder は
+// 呼び出し側が確認した時点の未保存の内容(snapshot)で比べる(clone の実行中は長い。画面はダイアログが覆うため
+// 編集は入りにくい。clone 中に未保存の内容が変わる経路は今は無く、将来オーバーレイが外れる・別の入口が増えたときのための防御の層として比べる)
+type DirtyBaseline = { kind: 'presence'; dirty: boolean } | { kind: 'snapshot'; snapshot: string }
+
 export interface SelectFileOptions {
   /** 開いたあとエディタへフォーカスを移すか(クイックオープン経由の場合のみ true) */
   moveFocusToEditor?: boolean
@@ -58,6 +73,12 @@ interface FileSystemState {
   error: Error | null
   saveError: Error | null
   openFolder: () => Promise<void>
+  /**
+   * 既に選ばれたフォルダ(clone の保存先など。main が開く許可を切り替え済み)を開く。走査・タブを閉じる判定・
+   * 世代の管理・エラーの表示は openFolder と同じ。未保存の確認は呼び出し側が事前に行う(options.dirtySnapshotAtConfirm)。
+   * 実行中の openFolder のダイアログより後に呼ばれたら、そのダイアログの結果は捨てる
+   */
+  applyOpenedFolder: (path: string, options: ApplyOpenedFolderOptions) => Promise<void>
   /** ファイルを開けたら true。ディレクトリ・破棄確認のキャンセル・読み込み失敗では false */
   selectFile: (node: FileTreeNode, options?: SelectFileOptions) => Promise<boolean>
   closeFile: () => void
@@ -78,6 +99,12 @@ interface FileSystemState {
    *  確認せず true)。checkout 等、working tree を書き換える操作の実行前に
    *  呼び出し側が使う */
   confirmDiscardAnyDirty: () => boolean
+  /**
+   * 未保存のタブの状態を、値で比べられる不透明な文字列にして返す(未保存のタブを path 順に並べた [path, content]
+   * の組)。編集・保存・タブを閉じるで変わり、未保存の内容が同じなら同じ値になる。applyOpenedFolder の
+   * dirtySnapshotAtConfirm を、未保存の確認(confirmDiscardAnyDirty)の直前に測るために使う
+   */
+  captureDirtySnapshot: () => string
   /** 開いている全タブのバッファをディスクの最新内容へ同期する。git checkout
    *  等、このフック外の要因(gitコマンド)で working tree のファイルが
    *  書き換わった後に呼ぶ想定。読み込みに失敗したタブ(対象ファイルが無く
@@ -289,11 +316,24 @@ export function useFileSystem(options?: Options): FileSystemState {
   const confirmDiscardAnyDirty = (): boolean =>
     !hasAnyDirtyTab() || onConfirm(DISCARD_CONFIRM_MESSAGE)

+  const captureDirtySnapshot = (): string =>
+    JSON.stringify(
+      openFilesMirrorRef.current
+        .filter((f) => f.content !== f.savedContent)
+        .map((f) => [f.path, f.content])
+        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
+    )
+
   // 待機の前後で「dirty なタブがあるか」が変わっていたら、開始時の確認はその状態を
-  // 見ていない。変わっていなければ再確認しない(同じダイアログが 2 回出てしまうため)
-  const confirmDiscardChangedSinceOpenFolder = (dirtyAtStart: boolean): boolean => {
+  // 見ていない。変わっていなければ再確認しない(同じダイアログが 2 回出てしまうため)。
+  // snapshot で控えた場合は、未保存のタブがあり、その内容が確認の時点から変わっていれば再確認する
+  const confirmDiscardChangedSinceOpenFolder = (dirtyAtStart: DirtyBaseline): boolean => {
+    if (dirtyAtStart.kind === 'snapshot') {
+      if (captureDirtySnapshot() === dirtyAtStart.snapshot) return true
+      return confirmDiscardAnyDirty()
+    }
     const dirtyNow = hasAnyDirtyTab()
-    if (dirtyNow === dirtyAtStart) return true
+    if (dirtyNow === dirtyAtStart.dirty) return true
     return confirmDiscardAnyDirty()
   }

@@ -355,8 +395,14 @@ export function useFileSystem(options?: Options): FileSystemState {
     invalidatePendingReads
   })

-  const openFolder = async (): Promise<void> => {
-    if (!confirmDiscardAnyDirty()) return
+  // フォルダを選び(selectPath)、そのフォルダを走査して開く。openFolder(OS のダイアログで選ぶ)と
+  // applyOpenedFolder(既に選ばれたパス)が共有する。dirtySnapshotAtConfirm は呼び出し側が未保存を確認した時点の
+  // 状態(captureDirtySnapshot)で、省略時は選択が返った時点の未保存の有無を使う(openFolder の従来の挙動。
+  // ネイティブのダイアログはモーダルで、確認からダイアログが返るまでの間に編集は入らない)
+  const runFolderOpen = async (
+    selectPath: () => Promise<string | null>,
+    dirtySnapshotAtConfirm?: string
+  ): Promise<void> => {
     // ダイアログの表示前に試行の世代を割り当てる。解決後だと、ダイアログが
     // reject した時点で「最新の試行か」を判定できず、後続のフォルダ選択が
     // 確定したあとに先行操作のエラーで上書きしてしまう
@@ -372,9 +418,9 @@ export function useFileSystem(options?: Options): FileSystemState {
     let selectedPath: string | null = null
     // 失敗経路でも成功経路と同じ判定を行うため、走査開始時点の状態を控える
     let committedOpenAtStart: number | null = null
-    let dirtyAtStart: boolean | null = null
+    let dirtyAtStart: DirtyBaseline | null = null
     try {
-      const path = await fileSystemApi.openFolder()
+      const path = await selectPath()
       // 先行ダイアログが後発の選択より遅れて返ることがある。古い試行のまま
       // 進むと、走査の世代を進めて後発の結果を捨て、古いフォルダが最終表示になる
       if (dialogAttemptId !== dialogAttemptRef.current) return
@@ -390,7 +436,10 @@ export function useFileSystem(options?: Options): FileSystemState {
       // フォルダが変わるので、旧フォルダのファイルを読み込み中なら無効化する
       latestReadRef.current += 1
       committedOpenAtStart = committedOpenRef.current
-      dirtyAtStart = hasAnyDirtyTab()
+      dirtyAtStart =
+        dirtySnapshotAtConfirm === undefined
+          ? { kind: 'presence', dirty: hasAnyDirtyTab() }
+          : { kind: 'snapshot', snapshot: dirtySnapshotAtConfirm }
       const treeWriteSeq = ++treeWriteSeqRef.current
       const tree = await fileSystemApi.readDirectory(path)
       // より新しいフォルダ選択が始まっていたら、こちらの結果は捨てる
@@ -485,6 +534,15 @@ export function useFileSystem(options?: Options): FileSystemState {
     }
   }

+  const openFolder = async (): Promise<void> => {
+    if (!confirmDiscardAnyDirty()) return
+    await runFolderOpen(() => fileSystemApi.openFolder())
+  }
+
+  // 選択の世代(dialogAttemptRef)も進めるため、実行中の openFolder のダイアログが後から返っても捨てられる
+  const applyOpenedFolder = (path: string, options: ApplyOpenedFolderOptions): Promise<void> =>
+    runFolderOpen(() => Promise.resolve(path), options.dirtySnapshotAtConfirm)
+
   // 呼び出し側が「実際に開けたか」で分岐できるよう成否を返す。クイックオープンは
   // 開けなかったとき(破棄確認のキャンセルなど)にダイアログを閉じずに残す。
   const selectFile = async (node: FileTreeNode, options?: SelectFileOptions): Promise<boolean> => {
@@ -782,6 +840,7 @@ export function useFileSystem(options?: Options): FileSystemState {
     error,
     saveError,
     openFolder,
+    applyOpenedFolder,
     selectFile,
     closeFile,
     activateTab,
@@ -795,6 +854,7 @@ export function useFileSystem(options?: Options): FileSystemState {
     deleteEntry,
     refreshTree,
     confirmDiscardAnyDirty,
+    captureDirtySnapshot,
     reloadOpenFiles,
     reloadOpenFile,
     closeTabsAtOrInside,
```

- [ ] **Step 6: テストを実行して成功を確認する**

```bash
npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.openFolder.test.ts src/renderer/src/hooks/__tests__/useFileSystem.test.ts src/renderer/src/hooks/__tests__/useFileSystem.conflict.test.ts
git diff --stat -- src/renderer/src/hooks/__tests__/useFileSystem.test.ts src/renderer/src/hooks/__tests__/useFileSystem.conflict.test.ts
```

Expected: すべて成功（固定 4 件・`applyOpenedFolder` 10 件・既存 135 件）。既存のテストファイルの差分は空

- [ ] **Step 7: 変異で検知力を確かめる**

`BAK="$(mktemp -d)" && cp src/renderer/src/hooks/useFileSystem.ts "$BAK/"` で退避し、1 つずつエディタで書き換えて `npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.openFolder.test.ts`（と `-t` 単独）で落ちることを確かめ、そのつど戻す。括弧内は Task 5 の実装時に落ちたテスト。

1. `snapshot` の比較を真偽値に戻す（`if (captureDirtySnapshot() === dirtyAtStart.snapshot) return true` を `if (hasAnyDirtyTab() === (dirtyAtStart.snapshot !== '[]')) return true`）（`同じタブをさらに編集したら`・`別のタブを編集しても`・`走査の失敗でも、確認の後に編集が入っていれば` の 3 件。clone 中の編集を確認なしで捨てる退行）
2. スナップショットを無視する（`dirtySnapshotAtConfirm === undefined` を `true` に）（上の 3 件と `確認の時点で未保存が無く、その後に編集が入ったら` の 4 件）
3. catch の中の判定を現在の値に差し替える（`confirmDiscardChangedSinceOpenFolder(dirtyAtStart)` を `confirmDiscardChangedSinceOpenFolder({ kind: 'snapshot', snapshot: captureDirtySnapshot() })`）（`走査の失敗でも、確認の後に編集が入っていれば` の 1 件）
4. スナップショットに内容を含めない（`.map((f) => [f.path, f.content])` を `.map((f) => [f.path])`）（`同じタブをさらに編集したら`・`走査の失敗でも、確認の後に…`・`captureDirtySnapshot は…` の 3 件）
5. `openFolder` も確認の時点の内容を渡す（`runFolderOpen(() => fileSystemApi.openFolder(), captureDirtySnapshot())`）（固定の `ダイアログが返った時点の未保存の有無を基準にし` の 1 件。既存の挙動を変える退行）
6. `openFolder` の確認をダイアログの後へ移す（`runFolderOpen(async () => { const selected = await fileSystemApi.openFolder(); if (selected !== null && !confirmDiscardAnyDirty()) return null; return selected })`）（固定の 2 件）

最後に `cmp "$BAK/useFileSystem.ts" src/renderer/src/hooks/useFileSystem.ts` が何も出力しないことを確かめる。

- [ ] **Step 8: 型・lint・整形を確かめる**

```bash
npm run typecheck
npx eslint src/renderer/src/hooks/useFileSystem.ts src/renderer/src/hooks/__tests__/useFileSystem.openFolder.test.ts
npx prettier --check src/renderer/src/hooks/useFileSystem.ts src/renderer/src/hooks/__tests__/useFileSystem.openFolder.test.ts
```

Expected: すべて成功（`useAppState.test.ts` の `mockUseFileSystem` は戻り値の型を明示しているため、`applyOpenedFolder` を足しても typecheck は通る）

- [ ] **Step 9: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 6: renderer の状態と操作（`CloneRepositoryPanelState`・`cloneValidation`・`useCloneRepository`・テスト用のモック）

**Files:**

- Modify: `src/renderer/src/types.ts`
- Create: `src/renderer/src/lib/cloneValidation.ts`, `src/renderer/src/hooks/useCloneRepository.ts`, `src/renderer/src/__tests__/makeCloneRepositoryPanelState.ts`, `src/renderer/src/lib/__tests__/cloneValidation.test.ts`, `src/renderer/src/hooks/__tests__/useCloneRepository.test.ts`

**Interfaces:**

- Consumes: `gitApi.cloneRepository` / `cancelCloneRepository`（Task 4）、`ApplyOpenedFolderOptions`（Task 5）、`FileOperationLock`（`useFileOperationLock`。`isAnyLocked` / `lockGlobal` / `unlockGlobal`）、`getCloneFolderNameViolation`（Task 1）、`toError`（`lib/errorUtils`）
- Produces: `CloneRepositoryPanelState`（`types.ts`）、`validateCloneFolderName`、`useCloneRepository` / `UseCloneRepositoryOptions`、`makeCloneRepositoryPanelState`
- 注: `useRunExclusiveGitOperation` は使わない（成功の後に「開く」処理を挟み、その完了まで実行中とロックを保つ必要があるため。取り直し（refresh）の概念も無い）。順序は差異 15 のとおり。中止の依頼の失敗は表示しない（結果は `cloneRepository` の側に届く）
- 注: URL の検証はリモートの追加と同じ `validateRemoteUrl`（`lib/remoteSetupValidation`）をダイアログ（Task 7）が使う。`cloneValidation` はフォルダ名だけ（同じ層に同じ表を 2 つ持たない。パターン 88）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/cloneValidation.test.ts`（新規。全文）:

```ts
import { describe, it, expect } from 'vitest'
import { validateCloneFolderName } from '../cloneValidation'

// 判定は @shared/cloneFolderName(main と共有)。ここは文言の表だけを確かめる
describe('validateCloneFolderName', () => {
  it.each([
    ['', 'フォルダ名を入力してください'],
    ['   ', 'フォルダ名を入力してください'],
    ['a/b', 'フォルダ名に使えない文字が含まれています'],
    ['..', 'フォルダ名に使えない文字が含まれています'],
    [' b', 'フォルダ名に使えない文字が含まれています']
  ])('%j → %s', (name, message) => {
    expect(validateCloneFolderName(name)).toBe(message)
  })

  it.each(['b', 'my-repo', 'リポ'])('%j は null', (name) => {
    expect(validateCloneFolderName(name)).toBeNull()
  })
})
```

`src/renderer/src/hooks/__tests__/useCloneRepository.test.ts`（新規。全文）:

```ts
import { renderHook, act, waitFor } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CloneRepositoryResult } from '@shared/types'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useCloneRepository } from '../useCloneRepository'
import type { UseCloneRepositoryOptions } from '../useCloneRepository'
import { useFileOperationLock } from '../useFileOperationLock'
import type { FileOperationLock } from '../useFileOperationLock'
import type { CloneRepositoryPanelState } from '../../types'

const mockCloneRepository = vi.mocked(gitApi.cloneRepository)
const mockCancelCloneRepository = vi.mocked(gitApi.cancelCloneRepository)

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

type Overrides = Partial<Omit<UseCloneRepositoryOptions, 'lock'>>
type CloneOptions = Omit<UseCloneRepositoryOptions, 'lock'>
type RenderedClone = RenderHookResult<
  { lock: FileOperationLock; clone: CloneRepositoryPanelState },
  { isGitOperationRunning: boolean }
> & { options: CloneOptions }

// 実物のロック(useFileOperationLock)と組み合わせて描画する
function renderClone(overrides: Overrides = {}): RenderedClone {
  const options: CloneOptions = {
    captureDirtySnapshot: vi.fn<() => string>().mockReturnValue('[]'),
    confirmDiscardAnyDirty: vi.fn<() => boolean>().mockReturnValue(true),
    applyOpenedFolder: vi
      .fn<UseCloneRepositoryOptions['applyOpenedFolder']>()
      .mockResolvedValue(undefined),
    isGitOperationRunning: false,
    ...overrides
  }
  const hook = renderHook(
    (props: { isGitOperationRunning: boolean }) => {
      const lock = useFileOperationLock()
      return {
        lock,
        clone: useCloneRepository({ ...options, ...props, lock })
      }
    },
    { initialProps: { isGitOperationRunning: options.isGitOperationRunning } }
  )
  return { ...hook, options }
}

beforeEach(() => {
  // 持続する実装を前のテストから持ち込まない(パターン 103)
  vi.resetAllMocks()
  mockCancelCloneRepository.mockResolvedValue(undefined)
})

describe('useCloneRepository', () => {
  it('確認 → clone の依頼 → 返ったパスを開く。開き終わるまで実行中で全体ロックを持つ', async () => {
    const clone = deferred<CloneRepositoryResult>()
    mockCloneRepository.mockReturnValueOnce(clone.promise)
    const opened = deferred<void>()
    const { result, options } = renderClone({
      applyOpenedFolder: vi
        .fn<UseCloneRepositoryOptions['applyOpenedFolder']>()
        .mockReturnValueOnce(opened.promise)
    })
    let running: Promise<boolean> = Promise.resolve(false)
    act(() => {
      running = result.current.clone.cloneRepository('https://github.com/a/b.git', 'b')
    })
    expect(options.confirmDiscardAnyDirty).toHaveBeenCalledOnce()
    expect(mockCloneRepository).toHaveBeenCalledWith('https://github.com/a/b.git', 'b')
    expect(result.current.clone.isCloning).toBe(true)
    expect(result.current.lock.isAnyLocked()).toBe(true)
    await act(async () => {
      clone.resolve({ status: 'cloned', path: '/parent/b' })
    })
    expect(options.applyOpenedFolder).toHaveBeenCalledWith('/parent/b', {
      dirtySnapshotAtConfirm: '[]'
    })
    // フォルダの読み込み中も実行中のまま(フォルダの変更・clone を押させない)
    expect(result.current.clone.isCloning).toBe(true)
    expect(result.current.lock.isAnyLocked()).toBe(true)
    await act(async () => {
      opened.resolve()
      expect(await running).toBe(true)
    })
    expect(result.current.clone.isCloning).toBe(false)
    expect(result.current.lock.isAnyLocked()).toBe(false)
  })

  it('確認の時点の未保存の内容(captureDirtySnapshot)を確認より前に測り、開くときに渡す', async () => {
    mockCloneRepository.mockResolvedValueOnce({ status: 'cloned', path: '/parent/b' })
    const order: string[] = []
    const { result, options } = renderClone({
      captureDirtySnapshot: vi.fn(() => {
        order.push('measure')
        return 'snapshot-at-confirm'
      }),
      confirmDiscardAnyDirty: vi.fn(() => {
        order.push('confirm')
        return true
      })
    })
    await act(async () => {
      await result.current.clone.cloneRepository('u', 'b')
    })
    expect(order).toEqual(['measure', 'confirm'])
    expect(options.applyOpenedFolder).toHaveBeenCalledWith('/parent/b', {
      dirtySnapshotAtConfirm: 'snapshot-at-confirm'
    })
  })

  it('未保存の確認を取り消したら、依頼せずに false', async () => {
    const { result } = renderClone({ confirmDiscardAnyDirty: vi.fn(() => false) })
    let opened = true
    await act(async () => {
      opened = await result.current.clone.cloneRepository('u', 'b')
    })
    expect(opened).toBe(false)
    expect(mockCloneRepository).not.toHaveBeenCalled()
    expect(result.current.clone.isCloning).toBe(false)
    expect(result.current.lock.isAnyLocked()).toBe(false)
  })

  it('canceled(保存先の選択の取り消し・中止)は開かずに false。エラーは出さない', async () => {
    mockCloneRepository.mockResolvedValueOnce({ status: 'canceled' })
    const { result, options } = renderClone()
    let opened = true
    await act(async () => {
      opened = await result.current.clone.cloneRepository('u', 'b')
    })
    expect(opened).toBe(false)
    expect(options.applyOpenedFolder).not.toHaveBeenCalled()
    expect(result.current.clone.error).toBeNull()
    expect(result.current.clone.isCloning).toBe(false)
    expect(result.current.lock.isAnyLocked()).toBe(false)
  })

  it('失敗はエラーにして false。ロックと実行中を解く', async () => {
    mockCloneRepository.mockRejectedValueOnce(new Error('リポジトリを clone できませんでした: x'))
    const { result } = renderClone()
    let opened = true
    await act(async () => {
      opened = await result.current.clone.cloneRepository('u', 'b')
    })
    expect(opened).toBe(false)
    expect(result.current.clone.error?.message).toBe('リポジトリを clone できませんでした: x')
    expect(result.current.clone.isCloning).toBe(false)
    expect(result.current.lock.isAnyLocked()).toBe(false)
  })

  it('再試行の開始時に前回のエラーを消す', async () => {
    mockCloneRepository.mockRejectedValueOnce(new Error('前回の失敗'))
    const { result } = renderClone()
    await act(async () => {
      await result.current.clone.cloneRepository('u', 'b')
    })
    const pending = deferred<CloneRepositoryResult>()
    mockCloneRepository.mockReturnValueOnce(pending.promise)
    act(() => {
      void result.current.clone.cloneRepository('u', 'b')
    })
    expect(result.current.clone.error).toBeNull()
    await act(async () => {
      pending.resolve({ status: 'canceled' })
    })
  })

  it('他の Git 操作の実行中・ロック中・実行中は何もしない(確認も出さない)', async () => {
    const { result, options, rerender } = renderClone({ isGitOperationRunning: true })
    expect(result.current.clone.isBlocked).toBe(true)
    await act(async () => {
      expect(await result.current.clone.cloneRepository('u', 'b')).toBe(false)
    })
    rerender({ isGitOperationRunning: false })
    expect(result.current.clone.isBlocked).toBe(false)
    act(() => result.current.lock.lock('/project/a.ts'))
    await act(async () => {
      expect(await result.current.clone.cloneRepository('u', 'b')).toBe(false)
    })
    act(() => result.current.lock.unlock('/project/a.ts'))
    expect(options.confirmDiscardAnyDirty).not.toHaveBeenCalled()
    expect(mockCloneRepository).not.toHaveBeenCalled()

    const pending = deferred<CloneRepositoryResult>()
    mockCloneRepository.mockReturnValueOnce(pending.promise)
    act(() => {
      void result.current.clone.cloneRepository('u', 'b')
    })
    await act(async () => {
      expect(await result.current.clone.cloneRepository('u', 'c')).toBe(false)
    })
    expect(mockCloneRepository).toHaveBeenCalledOnce()
    await act(async () => {
      pending.resolve({ status: 'canceled' })
    })
  })

  it('cancelClone は実行中だけ main へ中止を依頼し、依頼の失敗は表示しない', async () => {
    const { result } = renderClone()
    act(() => result.current.clone.cancelClone())
    expect(mockCancelCloneRepository).not.toHaveBeenCalled()
    const pending = deferred<CloneRepositoryResult>()
    mockCloneRepository.mockReturnValueOnce(pending.promise)
    mockCancelCloneRepository.mockRejectedValueOnce(new Error('ipc failed'))
    act(() => {
      void result.current.clone.cloneRepository('u', 'b')
    })
    act(() => result.current.clone.cancelClone())
    expect(mockCancelCloneRepository).toHaveBeenCalledOnce()
    await act(async () => {
      pending.resolve({ status: 'canceled' })
    })
    await waitFor(() => expect(result.current.clone.isCloning).toBe(false))
    expect(result.current.clone.error).toBeNull()
  })

  it('clearError でエラーを消す', async () => {
    mockCloneRepository.mockRejectedValueOnce(new Error('失敗'))
    const { result } = renderClone()
    await act(async () => {
      await result.current.clone.cloneRepository('u', 'b')
    })
    act(() => result.current.clone.clearError())
    expect(result.current.clone.error).toBeNull()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/cloneValidation.test.ts src/renderer/src/hooks/__tests__/useCloneRepository.test.ts
```

Expected: FAIL（`../cloneValidation`・`../useCloneRepository` が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/types.ts` の `RemoteSetupPanelState` の説明コメントの直前に追加:

`src/renderer/src/types.ts`（変更。差分）:

```diff
--- a/src/renderer/src/types.ts
+++ b/src/renderer/src/types.ts
@@ -89,6 +89,24 @@ export interface GitTagPanelState {
   clearError: () => void
 }

+// リポジトリの clone(エクスプローラーの「リポジトリを clone」とそのダイアログ)が受け取る状態と操作。
+// useCloneRepository が作り、App → Sidebar → ExplorerPanel へ 1 つの props(clone)で渡す
+export interface CloneRepositoryPanelState {
+  /** clone の依頼中(保存先の選択・clone・成功の後のフォルダの読み込みまで)。フォルダの変更と clone を押せなくする */
+  isCloning: boolean
+  /** 他の Git 操作の実行中で、clone を始められない(押しても何もしない) */
+  isBlocked: boolean
+  /** clone の失敗(main のエラー)。ダイアログ内に role="alert" で表示する */
+  error: Error | null
+  /** clone し、成功したらそのフォルダを開く。戻り値は開いたか(保存先の選択の取り消し・中止・失敗・未保存の確認の
+   *  取り消し・他の操作中で実行しなかった場合は false。ダイアログを閉じるかの判定に使う) */
+  cloneRepository: (url: string, folderName: string) => Promise<boolean>
+  /** 実行中の clone を中止する(実行中でなければ何もしない) */
+  cancelClone: () => void
+  /** error を消す。ダイアログを開くときに、前回の失敗の表示を持ち越さないために呼ぶ */
+  clearError: () => void
+}
+
 // リモートの管理(Git 管理外の「リポジトリを初期化」、状態バナーの「リモートを追加」「初回 push」)が受け取る状態と操作。
 // 初期化・追加は useGitRemoteSetup、初回 push は useGitRemoteOperations のものを useAppState で合成する。
 // App → Sidebar → SourceControlPanel へ 1 つの props(remoteSetup)で渡し、SourceControlPanel が GitRepoView(状態バナー)と
```

`src/renderer/src/lib/cloneValidation.ts`（新規。全文）:

```ts
import { getCloneFolderNameViolation } from '@shared/cloneFolderName'
import type { CloneFolderNameViolation } from '@shared/cloneFolderName'

// clone のダイアログのフォルダ名の検証(UX 用。セキュリティ境界は main 側)。判定は main と共有の @shared/cloneFolderName、
// 文言はここの表で持つ(main の gitCloneService の CLONE_FOLDER_NAME_MESSAGES と同じ文言。層ごとに表を持つ。パターン 88)。
// URL の検証はリモートの追加と同じ validateRemoteUrl(remoteSetupValidation)を使う
const CLONE_FOLDER_NAME_VIOLATION_MESSAGES: Record<CloneFolderNameViolation, string> = {
  empty: 'フォルダ名を入力してください',
  invalid: 'フォルダ名に使えない文字が含まれています'
}

export function validateCloneFolderName(name: string): string | null {
  const violation = getCloneFolderNameViolation(name)
  return violation === null ? null : CLONE_FOLDER_NAME_VIOLATION_MESSAGES[violation]
}
```

`src/renderer/src/hooks/useCloneRepository.ts`（新規。全文）:

```ts
import { useRef, useState } from 'react'
import * as gitApi from '../lib/gitApi'
import { toError } from '../lib/errorUtils'
import type { CloneRepositoryPanelState } from '../types'
import type { FileOperationLock } from './useFileOperationLock'
import type { ApplyOpenedFolderOptions } from './useFileSystem'

export interface UseCloneRepositoryOptions {
  /** 未保存のタブの内容のスナップショット(useFileSystem.captureDirtySnapshot) */
  captureDirtySnapshot: () => string
  /** 未保存の編集があれば破棄を確認する(useFileSystem.confirmDiscardAnyDirty。「フォルダを変更」と同じ確認) */
  confirmDiscardAnyDirty: () => boolean
  /** clone したフォルダを開く(useFileSystem.applyOpenedFolder) */
  applyOpenedFolder: (path: string, options: ApplyOpenedFolderOptions) => Promise<void>
  /** 他の Git 操作と共有するロック。clone の間は全体ロックを取り、Git 操作(commit・pull・ブランチ操作など)を始めさせない */
  lock: FileOperationLock
  /** 他の Git 操作の実行中か(useAppState が各操作の実行中フラグとロックから合成する)。実行中は clone を始めない */
  isGitOperationRunning: boolean
}

// リポジトリの clone の状態と操作。順序は「実行中・他の操作中なら何もしない → 未保存の確認(取り消しなら何もしない)→
// 実行中にして全体ロック → main へ依頼(main が保存先を OS のダイアログで選ばせて clone)→ 成功ならフォルダを開く →
// ロックと実行中を解く」。実行中フラグは開き終わってから下ろす(読み込み中に「フォルダを変更」や clone を押させない。
// パターン 73・96)。開始時に前回のエラーを消す(パターン 87)。clone が成功するとフォルダが切り替わるため、Git 操作の
// 実行中は始めず(isGitOperationRunning)、clone の間は全体ロックで Git 操作を始めさせない(設計書の排他)
export function useCloneRepository({
  captureDirtySnapshot,
  confirmDiscardAnyDirty,
  applyOpenedFolder,
  lock,
  isGitOperationRunning
}: UseCloneRepositoryOptions): CloneRepositoryPanelState {
  const [isCloning, setIsCloning] = useState(false)
  const isCloningRef = useRef(false)
  const [error, setError] = useState<Error | null>(null)

  const setCloning = (cloning: boolean): void => {
    isCloningRef.current = cloning
    setIsCloning(cloning)
  }

  const cloneRepository = async (url: string, folderName: string): Promise<boolean> => {
    if (isCloningRef.current || isGitOperationRunning || lock.isAnyLocked()) return false
    // 確認の時点の未保存の内容。clone の実行中に入った編集は、開くときにもう一度確認する(applyOpenedFolder)
    const dirtySnapshotAtConfirm = captureDirtySnapshot()
    if (!confirmDiscardAnyDirty()) return false
    setCloning(true)
    setError(null)
    lock.lockGlobal()
    try {
      const result = await gitApi.cloneRepository(url, folderName)
      if (result.status === 'canceled') return false
      await applyOpenedFolder(result.path, { dirtySnapshotAtConfirm })
      return true
    } catch (err) {
      setError(toError(err))
      return false
    } finally {
      lock.unlockGlobal()
      setCloning(false)
    }
  }

  // 中止は main が子プロセスを止めて保存先を削除し、cloneRepository が canceled で返る。依頼の失敗は表示しない
  // (中止できなかった場合も、clone の結果は cloneRepository の側に届く)
  const cancelClone = (): void => {
    if (!isCloningRef.current) return
    gitApi.cancelCloneRepository().catch(() => undefined)
  }

  const clearError = (): void => setError(null)

  return {
    isCloning,
    isBlocked: isGitOperationRunning,
    error,
    cloneRepository,
    cancelClone,
    clearError
  }
}
```

`src/renderer/src/__tests__/makeCloneRepositoryPanelState.ts`（新規。全文）:

```ts
import { vi } from 'vitest'
import type { CloneRepositoryPanelState } from '../types'

/**
 * テスト用の CloneRepositoryPanelState のモック。既定は「clone していない・他の操作中でない・エラーなし・clone は成功する」。
 * 各操作は CloneRepositoryPanelState の型で vi.fn を作るため、戻り値の契約から外れたモックは型検査で検出される(パターン 78)
 */
export const makeCloneRepositoryPanelState = (
  overrides: Partial<CloneRepositoryPanelState> = {}
): CloneRepositoryPanelState => ({
  isCloning: false,
  isBlocked: false,
  error: null,
  cloneRepository: vi.fn<CloneRepositoryPanelState['cloneRepository']>().mockResolvedValue(true),
  cancelClone: vi.fn<CloneRepositoryPanelState['cancelClone']>(),
  clearError: vi.fn<CloneRepositoryPanelState['clearError']>(),
  ...overrides
})
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/cloneValidation.test.ts src/renderer/src/hooks/__tests__/useCloneRepository.test.ts
```

Expected: すべて成功

- [ ] **Step 5: 変異で検知力を確かめる**

`BAK="$(mktemp -d)" && cp src/renderer/src/hooks/useCloneRepository.ts src/renderer/src/lib/cloneValidation.ts "$BAK/"` で退避し、1 つずつエディタで書き換えて `npx vitest run src/renderer/src/hooks/__tests__/useCloneRepository.test.ts src/renderer/src/lib/__tests__/cloneValidation.test.ts`（と `-t` 単独）で落ちることを確かめ、そのつど戻す。括弧内はプラン作成時に検証用の写しで落ちたテスト。

1. `lock.lockGlobal()` を消す（`開き終わるまで実行中で全体ロックを持つ` の 1 件）
2. `await applyOpenedFolder(…)` を `void applyOpenedFolder(…)` にする（同じ 1 件。開き終わる前に実行中とロックが解ける）
3. 開始時の `setError(null)` を消す（`再試行の開始時に前回のエラーを消す` の 1 件）
4. 開始条件から `isGitOperationRunning ||` を外す（`他の Git 操作の実行中・ロック中・実行中は何もしない` の 1 件）
5. `const dirtySnapshotAtConfirm = captureDirtySnapshot()` を `confirmDiscardAnyDirty()` の後へ移す（`確認より前に測り` の 1 件）
6. `cancelClone` の `if (!isCloningRef.current) return` を消す（`cancelClone は実行中だけ` の 1 件）
7. `cloneValidation.ts` の表の `empty` の文言を変える（`'' → フォルダ名を入力してください` の行）

最後に `cmp "$BAK/useCloneRepository.ts" src/renderer/src/hooks/useCloneRepository.ts && cmp "$BAK/cloneValidation.ts" src/renderer/src/lib/cloneValidation.ts` が何も出力しないことを確かめる。

- [ ] **Step 6: 型・lint・整形を確かめる**

```bash
npm run typecheck
npx eslint src/renderer/src/types.ts src/renderer/src/lib/cloneValidation.ts src/renderer/src/hooks/useCloneRepository.ts src/renderer/src/__tests__/makeCloneRepositoryPanelState.ts src/renderer/src/lib/__tests__/cloneValidation.test.ts src/renderer/src/hooks/__tests__/useCloneRepository.test.ts
npx prettier --check src/renderer/src/types.ts src/renderer/src/lib/cloneValidation.ts src/renderer/src/hooks/useCloneRepository.ts src/renderer/src/__tests__/makeCloneRepositoryPanelState.ts src/renderer/src/lib/__tests__/cloneValidation.test.ts src/renderer/src/hooks/__tests__/useCloneRepository.test.ts
```

Expected: すべて成功

- [ ] **Step 7: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 7: `CloneRepositoryDialog` と CSS（a11y・閉じる経路・実行中・フォーカス）

**Files:**

- Create: `src/renderer/src/components/explorer/CloneRepositoryDialog.tsx`, `src/renderer/src/components/explorer/__tests__/CloneRepositoryDialog.test.tsx`, `src/renderer/src/components/explorer/__tests__/CloneRepositoryDialog.styles.test.tsx`
- Modify: `src/renderer/src/assets/main.css`

**Interfaces:**

- Consumes: `deriveCloneFolderName`（Task 1）、`GIT_CLONE_IDLE_TIMEOUT_SECONDS`（Task 1）、`normalizeRemoteUrl`（`@shared/remoteUrl`）、`validateRemoteUrl`（`lib/remoteSetupValidation`。変更しない）、`validateCloneFolderName`（Task 6）、共通フック `useDialogFocusTrap(formRef, true)`・`useFocusOnRunningEnd(isRunning, targetRef, { containerRef })`・`useOverlayDismiss(onDismiss)`（変更しない）
- Produces: `CloneRepositoryDialog`（default export）、`CLONE_RUNNING_NOTICE`・`CLONE_BLOCKED_NOTICE`
- 注: 作りは `RemoteSetupInputDialog` と同じ（`aria-modal`・フォーカストラップ・form の `tabIndex={-1}`・`onClick` の `stopPropagation`・IME の Escape を除く・閉じる経路を `requestClose` に集める。パターン 85・97）。違いは 2 項目と、実行中も `キャンセル` が押せて中止すること（差異 18 のフォーカス）。見た目の枠は `.name-input-dialog__*` を共有し、ダイアログ固有のクラス（`clone-repository-dialog*`）は既存のグループセレクタに足す（宣言を複製しない。パターン 30・77）
- 注: `リポジトリを clone`（`.explorer-panel__clone-btn`）の見た目は Task 8 で使うが、CSS の変更をこのタスクにまとめる（共通の枠付きボタンのグループに入れ、`フォルダを開く` / `フォルダを変更` の disabled の見た目も足す）。ボタンの見た目のテストは Task 8 の配線の後に `ExplorerPanel` で行う

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/explorer/__tests__/CloneRepositoryDialog.test.tsx`（新規。全文）:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import CloneRepositoryDialog, {
  CLONE_BLOCKED_NOTICE,
  CLONE_RUNNING_NOTICE
} from '../CloneRepositoryDialog'

type Props = React.ComponentProps<typeof CloneRepositoryDialog>

function renderDialog(overrides: Partial<Props> = {}): {
  props: Props
  rerender: (next: Partial<Props>) => void
} {
  const props: Props = {
    isCloning: false,
    isBlocked: false,
    error: null,
    onSubmit: vi.fn(),
    onCancelClone: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  }
  const { rerender } = render(<CloneRepositoryDialog {...props} />)
  return {
    props,
    rerender: (next) => rerender(<CloneRepositoryDialog {...props} {...next} />)
  }
}

const urlInput = (): HTMLElement => screen.getByRole('textbox', { name: 'URL' })
const folderInput = (): HTMLElement => screen.getByRole('textbox', { name: 'フォルダ名' })
const submitButton = (): HTMLElement => screen.getByRole('button', { name: '保存先を選んで clone' })

describe('CloneRepositoryDialog', () => {
  it('モーダルとして開き、URL の入力欄にフォーカスがあり、空の入力は検証の文言を出して実行できない', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'リポジトリを clone' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription(
      '保存先の親フォルダを選ぶと、その中にフォルダを作って取得し、そのフォルダを開きます'
    )
    expect(urlInput()).toHaveFocus()
    expect(urlInput()).toHaveAccessibleDescription('URL を入力してください')
    expect(folderInput()).toHaveAccessibleDescription('フォルダ名を入力してください')
    expect(submitButton()).toBeDisabled()
  })

  it('URL を入力すると、末尾のリポジトリ名をフォルダ名の既定値にする', async () => {
    renderDialog()
    await userEvent.type(urlInput(), 'https://github.com/a/my-repo.git')
    expect(folderInput()).toHaveValue('my-repo')
    expect(urlInput()).toHaveAttribute('aria-invalid', 'false')
    expect(submitButton()).toBeEnabled()
  })

  it('フォルダ名を編集した後は、URL を変えても上書きしない', async () => {
    renderDialog()
    await userEvent.type(urlInput(), 'https://github.com/a/b.git')
    await userEvent.clear(folderInput())
    await userEvent.type(folderInput(), 'mine')
    await userEvent.clear(urlInput())
    await userEvent.type(urlInput(), 'https://github.com/a/other.git')
    expect(folderInput()).toHaveValue('mine')
  })

  it('URL とフォルダ名の規則違反を入力欄に結び付けて出し、実行できない', async () => {
    renderDialog()
    await userEvent.type(urlInput(), 'ext::sh')
    expect(urlInput()).toHaveAttribute('aria-invalid', 'true')
    expect(urlInput()).toHaveAccessibleDescription(
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    )
    await userEvent.type(folderInput(), 'a/b')
    expect(folderInput()).toHaveAccessibleDescription('フォルダ名に使えない文字が含まれています')
    expect(submitButton()).toBeDisabled()
  })

  it('実行すると、前後の空白を除いた URL とフォルダ名を渡す(Enter でも実行する)', async () => {
    const { props } = renderDialog()
    await userEvent.type(urlInput(), '  https://github.com/a/b.git  ')
    await userEvent.click(submitButton())
    expect(props.onSubmit).toHaveBeenCalledWith('https://github.com/a/b.git', 'b')
    await userEvent.type(folderInput(), '{Enter}')
    expect(props.onSubmit).toHaveBeenCalledTimes(2)
  })

  it('他の Git 操作の実行中は実行できず、理由を案内する', async () => {
    renderDialog({ isBlocked: true })
    await userEvent.type(urlInput(), 'https://github.com/a/b.git')
    expect(submitButton()).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(CLONE_BLOCKED_NOTICE)
  })

  describe('実行中', () => {
    it('入力と実行を止め、案内を出し、`キャンセル` だけは押せて clone を中止する', async () => {
      const { props } = renderDialog({ isCloning: true })
      expect(urlInput()).toBeDisabled()
      expect(folderInput()).toBeDisabled()
      expect(screen.getByRole('button', { name: 'clone 中…' })).toBeDisabled()
      expect(screen.getByRole('status')).toHaveTextContent(CLONE_RUNNING_NOTICE)
      expect(CLONE_RUNNING_NOTICE).toContain('60 秒')
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
      await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      expect(props.onCancelClone).toHaveBeenCalledOnce()
      expect(props.onClose).not.toHaveBeenCalled()
    })

    it('Escape・オーバーレイのクリックでは閉じない', async () => {
      const { props } = renderDialog({ isCloning: true })
      const dialog = screen.getByRole('dialog')
      fireEvent.keyDown(dialog, { key: 'Escape' })
      const overlay = dialog.parentElement as HTMLElement
      fireEvent.mouseDown(overlay)
      fireEvent.mouseUp(overlay)
      fireEvent.click(overlay)
      expect(props.onClose).not.toHaveBeenCalled()
      expect(props.onCancelClone).not.toHaveBeenCalled()
    })

    it('失敗が届いたら(実行中のままでも)案内と aria-busy を出さず、エラーを alert で出す', () => {
      renderDialog({ isCloning: true, error: new Error('リポジトリを clone できませんでした: x') })
      expect(screen.queryByText(CLONE_RUNNING_NOTICE)).not.toBeInTheDocument()
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'false')
      expect(screen.getByRole('alert')).toHaveTextContent('リポジトリを clone できませんでした: x')
    })

    it('Tab は押せる `キャンセル` に留まる', async () => {
      renderDialog({ isCloning: true })
      await userEvent.tab()
      expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus()
      await userEvent.tab()
      expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus()
    })
  })

  describe('閉じる経路(実行中でないとき)', () => {
    it('`キャンセル`・Escape・オーバーレイで押して離したときに閉じる', async () => {
      const { props } = renderDialog()
      await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      const overlay = screen.getByRole('dialog').parentElement as HTMLElement
      fireEvent.mouseDown(overlay)
      fireEvent.mouseUp(overlay)
      fireEvent.click(overlay)
      expect(props.onClose).toHaveBeenCalledTimes(3)
      expect(props.onCancelClone).not.toHaveBeenCalled()
    })

    it('入力欄で押してオーバーレイで離しても閉じない', () => {
      const { props } = renderDialog()
      const overlay = screen.getByRole('dialog').parentElement as HTMLElement
      fireEvent.mouseDown(urlInput())
      fireEvent.mouseUp(overlay)
      fireEvent.click(overlay)
      expect(props.onClose).not.toHaveBeenCalled()
    })

    it('IME の変換を取り消す Escape では閉じない', () => {
      const { props } = renderDialog()
      fireEvent.keyDown(urlInput(), { key: 'Escape', isComposing: true })
      expect(props.onClose).not.toHaveBeenCalled()
    })

    it('説明の文字をクリックした後も Escape で閉じる', async () => {
      const { props } = renderDialog()
      await userEvent.click(
        screen.getByText(
          '保存先の親フォルダを選ぶと、その中にフォルダを作って取得し、そのフォルダを開きます'
        )
      )
      expect(screen.getByRole('dialog')).toHaveFocus()
      await userEvent.keyboard('{Escape}')
      expect(props.onClose).toHaveBeenCalledOnce()
    })

    it('Tab / Shift+Tab はダイアログの中で循環する', async () => {
      renderDialog()
      await userEvent.type(urlInput(), 'https://github.com/a/b.git')
      await userEvent.tab()
      expect(folderInput()).toHaveFocus()
      await userEvent.tab()
      expect(submitButton()).toHaveFocus()
      await userEvent.tab()
      expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus()
      await userEvent.tab()
      expect(urlInput()).toHaveFocus()
      await userEvent.tab({ shift: true })
      expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus()
    })
  })

  describe('フォーカス', () => {
    it('実行が始まったら `キャンセル` へ、失敗・中止で解けたら URL の入力欄へ移す', async () => {
      const { rerender } = renderDialog()
      await userEvent.type(urlInput(), 'https://github.com/a/b.git')
      await userEvent.click(submitButton())
      rerender({ isCloning: true })
      expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus()
      rerender({ isCloning: false })
      expect(urlInput()).toHaveFocus()
      // 入力は保持する
      expect(urlInput()).toHaveValue('https://github.com/a/b.git')
      expect(folderInput()).toHaveValue('b')
    })

    it('実行中にダイアログの外へ移したフォーカスは奪わない', () => {
      const outside = document.createElement('button')
      document.body.appendChild(outside)
      const { rerender } = renderDialog({ isCloning: true })
      outside.focus()
      rerender({ isCloning: false })
      expect(outside).toHaveFocus()
      outside.remove()
    })
  })
})
```

`src/renderer/src/components/explorer/__tests__/CloneRepositoryDialog.styles.test.tsx`（新規。全文）:

```tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import CloneRepositoryDialog from '../CloneRepositoryDialog'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)と :focus の規則を検証する(パターン 30・77・97)
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

describe('clone のダイアログのスタイル(main.css)', () => {
  // form は tabindex=-1。フォーカスを受けると Chromium 既定のフォーカスリングがダイアログ全体に出るため消す。
  // jsdom の getComputedStyle は :focus を計算しないため、form に一致する :focus の規則を集めて確かめる
  it('ダイアログ内の文字をクリックして form にフォーカスがあっても、form にフォーカスリングを出さない', async () => {
    render(
      <CloneRepositoryDialog
        isCloning={false}
        isBlocked={false}
        error={null}
        onSubmit={vi.fn()}
        onCancelClone={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const dialog = screen.getByRole('dialog', { name: 'リポジトリを clone' })
    await userEvent.click(screen.getByText('URL'))
    await userEvent.click(
      screen.getByText(
        '保存先の親フォルダを選ぶと、その中にフォルダを作って取得し、そのフォルダを開きます'
      )
    )
    expect(dialog).toHaveFocus()
    const focusRules = Array.from(styleElement.sheet?.cssRules ?? []).filter(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule &&
        rule.selectorText.includes(':focus') &&
        dialog.matches(rule.selectorText)
    )
    expect(
      focusRules.map(
        (rule) =>
          rule.style.getPropertyValue('outline') || rule.style.getPropertyValue('outline-style')
      )
    ).toContain('none')
  })

  it('説明・ラベルは補足の文字、入力欄は縦に並ぶ', () => {
    render(
      <CloneRepositoryDialog
        isCloning={false}
        isBlocked={false}
        error={null}
        onSubmit={vi.fn()}
        onCancelClone={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const label = getComputedStyle(screen.getByText('フォルダ名'))
    expect(label.fontSize).toBe('11px')
    const field = getComputedStyle(screen.getByText('フォルダ名').parentElement as HTMLElement)
    expect(field.display).toBe('flex')
    expect(field.flexDirection).toBe('column')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run src/renderer/src/components/explorer/__tests__/CloneRepositoryDialog.test.tsx src/renderer/src/components/explorer/__tests__/CloneRepositoryDialog.styles.test.tsx
```

Expected: FAIL（`../CloneRepositoryDialog` が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/components/explorer/CloneRepositoryDialog.tsx`（新規。全文）:

```tsx
'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { deriveCloneFolderName } from '@shared/cloneFolderName'
import { GIT_CLONE_IDLE_TIMEOUT_SECONDS } from '@shared/remoteTimeout'
import { normalizeRemoteUrl } from '@shared/remoteUrl'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { useFocusOnRunningEnd } from '../../hooks/useFocusOnRunningEnd'
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss'
import { validateCloneFolderName } from '../../lib/cloneValidation'
import { validateRemoteUrl } from '../../lib/remoteSetupValidation'

// 実行中の案内。打ち切りの秒数は main の打ち切りと同じ定数から組み立てる(パターン 87・88)
export const CLONE_RUNNING_NOTICE = `clone 中です。キャンセルで中止できます（応答が ${GIT_CLONE_IDLE_TIMEOUT_SECONDS} 秒途絶えると打ち切ります）`
export const CLONE_BLOCKED_NOTICE = '他の Git 操作の実行中は clone できません'

interface Props {
  /** clone の依頼中(保存先の選択・clone・開くまで)。入力と実行ボタンを disabled にし、閉じさせない */
  isCloning: boolean
  /** 他の Git 操作の実行中で、clone を始められない */
  isBlocked: boolean
  /** clone の失敗(main のエラー)。role="alert" で表示する */
  error: Error | null
  /** 検証を通過した、正規化済みの URL とフォルダ名 */
  onSubmit: (url: string, folderName: string) => void
  /** 実行中の `キャンセル`(clone の中止) */
  onCancelClone: () => void
  /** 実行中でないときの `キャンセル`・Escape・オーバーレイのクリック(閉じる) */
  onClose: () => void
}

// リポジトリの clone のダイアログ(URL・フォルダ名・実行中の案内・エラー・閉じる経路・フォーカス)。作りはリモートの
// 入力ダイアログ(RemoteSetupInputDialog)と同じ(aria-modal・フォーカストラップ・form の tabIndex=-1・オーバーレイで
// 押して離したときだけ閉じる・IME の Escape を除く。パターン 97)。違いは、項目が 2 つあることと、実行中も `キャンセル`
// だけは押せて clone を中止すること(閉じる経路の Escape・オーバーレイは実行中は塞ぐ。パターン 85)。
// 閉じるのは呼び出し元が成功を受け取ったとき(失敗・中止はダイアログに残し、入力も保持する)
export default function CloneRepositoryDialog({
  isCloning,
  isBlocked,
  error,
  onSubmit,
  onCancelClone,
  onClose
}: Props): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [folderName, setFolderName] = useState('')
  // 利用者がフォルダ名を編集したら、URL を変えても既定値で上書きしない
  const [isFolderNameEdited, setIsFolderNameEdited] = useState(false)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const urlErrorId = useId()
  const folderNameErrorId = useId()

  const urlError = validateRemoteUrl(url)
  const folderNameError = validateCloneFolderName(folderName)
  // 失敗の直後(開き直しの待ちなど)に案内と alert を重ねない(パターン 87)
  const showRunningNotice = isCloning && error === null
  const canSubmit = urlError === null && folderNameError === null && !isCloning && !isBlocked

  const handleUrlChange = (value: string): void => {
    setUrl(value)
    if (!isFolderNameEdited) setFolderName(deriveCloneFolderName(value))
  }

  const handleFolderNameChange = (value: string): void => {
    setIsFolderNameEdited(true)
    setFolderName(value)
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit(normalizeRemoteUrl(url), folderName)
  }

  // 閉じる経路(Escape・オーバーレイ・実行中でないときの `キャンセル`)はすべてここを通す。実行中は閉じない
  // (閉じると、遅れて届いた失敗・成功の行き先が無くなる。パターン 73・85)
  const requestClose = (): void => {
    if (!isCloning) onClose()
  }

  // `キャンセル` は実行中なら clone を中止し、実行中でなければ閉じる
  const handleCancelButton = (): void => {
    if (isCloning) onCancelClone()
    else onClose()
  }

  const overlayHandlers = useOverlayDismiss(requestClose)

  // 実行が始まると入力欄と実行ボタンが disabled になり、フォーカスが body に落ちる。押せる `キャンセル` へ移す
  // (フォーカスがダイアログの外に移されていたら奪わない。パターン 86)
  const wasCloningRef = useRef(isCloning)
  useEffect(() => {
    const wasCloning = wasCloningRef.current
    wasCloningRef.current = isCloning
    if (wasCloning || !isCloning) return
    const active = document.activeElement
    if (active === null || active === document.body || formRef.current?.contains(active)) {
      cancelButtonRef.current?.focus()
    }
  }, [isCloning])

  // 実行が解けたとき(ダイアログが開いたまま=失敗・中止)に、フォーカスが body かダイアログ内なら URL の入力欄へ戻す
  useFocusOnRunningEnd(isCloning, urlInputRef, { containerRef: formRef })

  // Tab / Shift+Tab をダイアログの中で循環させる(このダイアログは開いている間だけマウントされる)
  useDialogFocusTrap(formRef, true)

  return (
    <div className="name-input-dialog__overlay" role="presentation" {...overlayHandlers}>
      <form
        ref={formRef}
        className="name-input-dialog clone-repository-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={showRunningNotice}
        // ダイアログ内の文字・余白のクリックで form にフォーカスを置き、Escape を下の onKeyDown に届ける
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // IME の変換を取り消す Escape ではダイアログを閉じない
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) requestClose()
        }}
        onSubmit={handleSubmit}
      >
        <p id={titleId} className="name-input-dialog__title">
          リポジトリを clone
        </p>
        <p id={descriptionId} className="clone-repository-dialog__note">
          保存先の親フォルダを選ぶと、その中にフォルダを作って取得し、そのフォルダを開きます
        </p>
        <label className="clone-repository-dialog__field">
          <span className="clone-repository-dialog__label">URL</span>
          <input
            ref={urlInputRef}
            autoFocus
            type="text"
            className="name-input-dialog__input"
            value={url}
            disabled={isCloning}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={urlError !== null}
            aria-describedby={urlError !== null ? urlErrorId : undefined}
            onChange={(e) => handleUrlChange(e.target.value)}
          />
        </label>
        {urlError !== null && (
          <p id={urlErrorId} className="name-input-dialog__error">
            {urlError}
          </p>
        )}
        <label className="clone-repository-dialog__field">
          <span className="clone-repository-dialog__label">フォルダ名</span>
          <input
            type="text"
            className="name-input-dialog__input"
            value={folderName}
            disabled={isCloning}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={folderNameError !== null}
            aria-describedby={folderNameError !== null ? folderNameErrorId : undefined}
            onChange={(e) => handleFolderNameChange(e.target.value)}
          />
        </label>
        {folderNameError !== null && (
          <p id={folderNameErrorId} className="name-input-dialog__error">
            {folderNameError}
          </p>
        )}
        {isBlocked && !isCloning && (
          <p className="clone-repository-dialog__note" role="status">
            {CLONE_BLOCKED_NOTICE}
          </p>
        )}
        {showRunningNotice && (
          <p className="clone-repository-dialog__note" role="status">
            {CLONE_RUNNING_NOTICE}
          </p>
        )}
        {error !== null && (
          <p className="name-input-dialog__error" role="alert">
            {error.message}
          </p>
        )}
        <div className="name-input-dialog__actions">
          <button type="submit" className="name-input-dialog__ok" disabled={!canSubmit}>
            {isCloning ? 'clone 中…' : '保存先を選んで clone'}
          </button>
          <button
            ref={cancelButtonRef}
            type="button"
            className="name-input-dialog__cancel"
            onClick={handleCancelButton}
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  )
}
```

`src/renderer/src/assets/main.css`（変更。差分）:

```diff
--- a/src/renderer/src/assets/main.css
+++ b/src/renderer/src/assets/main.css
@@ -635,7 +635,7 @@ body {
   align-self: stretch;
 }

-.explorer-panel__open-btn:hover {
+.explorer-panel__open-btn:hover:not(:disabled) {
   background: #1177bb;
 }

@@ -651,11 +651,17 @@ body {
   flex-shrink: 0;
 }

-.explorer-panel__change-btn:hover {
+.explorer-panel__change-btn:hover:not(:disabled) {
   color: #cccccc;
   border-color: #888888;
 }

+/* 「リポジトリを clone」(寸法・枠・配色は下の共通のボタンの規則。ここは配置だけ) */
+.explorer-panel__clone-btn {
+  margin: 0 12px 6px;
+  align-self: flex-start;
+}
+
 .explorer-panel__error {
   margin: 8px 12px;
   font-size: 12px;
@@ -772,18 +778,22 @@ body {
 .create-tag-dialog__label,
 .remote-setup-dialog__note,
 .remote-setup-dialog__label,
+.clone-repository-dialog__note,
+.clone-repository-dialog__label,
 .remote-setup-banner__note {
   font-size: 11px;
   color: #969696;
 }

 .create-tag-dialog__note,
-.remote-setup-dialog__note {
+.remote-setup-dialog__note,
+.clone-repository-dialog__note {
   margin: 0 0 4px;
 }

 .create-tag-dialog__field,
-.remote-setup-dialog__field {
+.remote-setup-dialog__field,
+.clone-repository-dialog__field {
   display: flex;
   flex-direction: column;
   gap: 4px;
@@ -792,7 +802,8 @@ body {

 /* リポジトリの初期化・リモートの追加のダイアログの form は tabindex=-1(中の文字・余白のクリックでフォーカスを受け、
    Escape が届くように)。Chromium 既定のフォーカスリングがダイアログ全体に出ないよう消す(中の操作対象には出る) */
-.remote-setup-dialog:focus {
+.remote-setup-dialog:focus,
+.clone-repository-dialog:focus {
   outline: none;
 }

@@ -1223,6 +1234,7 @@ body {
 .history-section__create-tag,
 .remote-setup-banner__button,
 .source-control-panel__init-btn,
+.explorer-panel__clone-btn,
 .create-tag-dialog__kind {
   flex: none;
   min-width: 32px;
@@ -1244,6 +1256,7 @@ body {
 .history-section__create-tag:hover:not(:disabled),
 .remote-setup-banner__button:hover:not(:disabled),
 .source-control-panel__init-btn:hover:not(:disabled),
+.explorer-panel__clone-btn:hover:not(:disabled),
 .create-tag-dialog__kind:hover:not(:disabled) {
   background: #094771;
   color: #ffffff;
@@ -1263,6 +1276,9 @@ body {
 .history-section__create-tag:disabled,
 .remote-setup-banner__button:disabled,
 .source-control-panel__init-btn:disabled,
+.explorer-panel__clone-btn:disabled,
+.explorer-panel__open-btn:disabled,
+.explorer-panel__change-btn:disabled,
 .create-tag-dialog__kind:disabled,
 .name-input-dialog__ok:disabled,
 .name-input-dialog__cancel:disabled {
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run src/renderer/src/components/explorer src/renderer/src/components/source-control
```

Expected: すべて成功（`main.css` の変更で既存のスタイルのテストが崩れないことも確かめる）

- [ ] **Step 5: 変異で検知力を確かめる**

`BAK="$(mktemp -d)" && cp src/renderer/src/components/explorer/CloneRepositoryDialog.tsx src/renderer/src/assets/main.css "$BAK/"` で退避し、1 つずつエディタで書き換えて `npx vitest run src/renderer/src/components/explorer/__tests__/CloneRepositoryDialog.test.tsx src/renderer/src/components/explorer/__tests__/CloneRepositoryDialog.styles.test.tsx`（と `-t` 単独）で落ちることを確かめ、そのつど戻す。括弧内はプラン作成時に検証用の写しで落ちたテスト。

1. `requestClose` の `if (!isCloning)` を外して常に `onClose()` にする（`Escape・オーバーレイのクリックでは閉じない` の 2 件。プラン作成時に確認）
2. `handleCancelButton` を常に `onClose()` にする（`キャンセル だけは押せて clone を中止する` の 1 件）
3. `handleUrlChange` の `if (!isFolderNameEdited)` を外す（`フォルダ名を編集した後は、URL を変えても上書きしない` の 1 件）
4. 実行開始の effect の `cancelButtonRef.current?.focus()` を消す（`実行が始まったら キャンセル へ` の 1 件）
5. `main.css` の `.clone-repository-dialog:focus` をグループから外す（`form にフォーカスリングを出さない` の 1 件）
6. `showRunningNotice` を `isCloning` だけにする（`失敗が届いたら(実行中のままでも)案内と aria-busy を出さず` の 1 件）
7. `canSubmit` から `&& !isBlocked` を外す（`他の Git 操作の実行中は実行できず` の 1 件）

最後に `cmp "$BAK/CloneRepositoryDialog.tsx" src/renderer/src/components/explorer/CloneRepositoryDialog.tsx && cmp "$BAK/main.css" src/renderer/src/assets/main.css` が何も出力しないことを確かめる。

- [ ] **Step 6: 型・lint・整形を確かめる**

```bash
npm run typecheck
npx eslint src/renderer/src/components/explorer/CloneRepositoryDialog.tsx src/renderer/src/components/explorer/__tests__/CloneRepositoryDialog.test.tsx src/renderer/src/components/explorer/__tests__/CloneRepositoryDialog.styles.test.tsx
npx prettier --check src/renderer/src/components/explorer/CloneRepositoryDialog.tsx src/renderer/src/components/explorer/__tests__/CloneRepositoryDialog.test.tsx src/renderer/src/components/explorer/__tests__/CloneRepositoryDialog.styles.test.tsx src/renderer/src/assets/main.css
```

Expected: すべて成功

- [ ] **Step 7: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 8: 配線（`ExplorerPanel`・`Sidebar`・`App`・`useAppState`）と結合テスト

**Files:**

- Modify: `src/renderer/src/components/explorer/ExplorerPanel.tsx`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/hooks/useAppState.ts`, `src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx`, `src/renderer/src/components/__tests__/Sidebar.test.tsx`, `src/renderer/src/hooks/__tests__/useAppState.test.ts`
- Create: `src/renderer/src/components/explorer/__tests__/ExplorerPanel.clone.test.tsx`, `src/renderer/src/components/explorer/__tests__/ExplorerPanel.styles.test.tsx`

**Interfaces:**

- Consumes: `CloneRepositoryPanelState` / `useCloneRepository`（Task 6）、`CloneRepositoryDialog`（Task 7）、`applyOpenedFolder` / `captureDirtySnapshot` / `confirmDiscardAnyDirty`（Task 5）、`useDialogFocusReturn({ isRunning, onOpen, openerRef })`（変更しない）、`useAppState` の既存の `fileOperationLock`・`gitRemoteOperations`・`gitBranchOperations`・`gitTag`・`gitRemoteSetup`
- Produces: `ExplorerPanel` の props `clone`、`Sidebar` の props `clone`、`useAppState` の戻り値 `clone`
- 注: `clone` は必須の props にする（配線の漏れを typecheck で見つける）。そのため既存の `ExplorerPanel.test.tsx`・`Sidebar.test.tsx` の既定の props に `clone: makeCloneRepositoryPanelState()` を足す（`remoteSetup` を足したときと同じ）
- 注: `useAppState.test.ts` は `useGitTagOperations`・`useGitRemoteSetup` を戻り値なし（`undefined`）でモックしている。「Git 操作の実行中」の合成が `gitTag.isCreating`・`gitRemoteSetup.isInitializing` を読むため、`beforeEach` で `makeGitTagPanelState()`・`makeRemoteSetupPanelState()`・`makeCloneRepositoryPanelState()` を毎回設定し直す（前のテストの `mockReturnValue` を持ち込まない。パターン 103）。これが無いと既存の 58 件が `Cannot read properties of undefined (reading 'isCreating')` で落ちる（プラン作成時に確認）
- 注: 結合テスト（`ExplorerPanel.clone.test.tsx` の後半）は実物の `useCloneRepository`・`useFileOperationLock` と `ExplorerPanel` を組み合わせ、`gitApi` だけをモックして「保留 → 操作 → 解決」の順序を作る（パターン 85）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/explorer/__tests__/ExplorerPanel.clone.test.tsx`（新規。全文）:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CloneRepositoryResult } from '@shared/types'
import type { FileTreeNode } from '../../../types'

vi.mock('../../../lib/gitApi')

import * as gitApi from '../../../lib/gitApi'
import ExplorerPanel from '../ExplorerPanel'
import { CLONE_RUNNING_NOTICE } from '../CloneRepositoryDialog'
import { useCloneRepository } from '../../../hooks/useCloneRepository'
import type { UseCloneRepositoryOptions } from '../../../hooks/useCloneRepository'
import { useFileOperationLock } from '../../../hooks/useFileOperationLock'
import { makeCloneRepositoryPanelState } from '../../../__tests__/makeCloneRepositoryPanelState'

const mockCloneRepository = vi.mocked(gitApi.cloneRepository)
const mockCancelCloneRepository = vi.mocked(gitApi.cancelCloneRepository)

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const baseProps = {
  fileTree: [] as FileTreeNode[],
  openFilePath: null as string | null,
  onOpenFolder: vi.fn(),
  onSelectFile: vi.fn(),
  error: null as Error | null,
  gitignoreError: null as Error | null,
  onCreateFile: vi.fn(),
  onCreateDirectory: vi.fn(),
  onRenameEntry: vi.fn(),
  onDeleteEntry: vi.fn(),
  onAddToGitignore: vi.fn()
}

const cloneButton = (): HTMLElement => screen.getByRole('button', { name: 'リポジトリを clone' })

beforeEach(() => {
  vi.resetAllMocks()
  mockCancelCloneRepository.mockResolvedValue(undefined)
})

describe('ExplorerPanel の「リポジトリを clone」(状態はモック)', () => {
  it.each([
    ['フォルダが未選択', null, 'フォルダを開く'],
    ['フォルダを開いている', '/p', 'フォルダを変更']
  ])('%s のとき、%s の隣に置く', (_label, folderPath, folderButton) => {
    render(
      <ExplorerPanel
        {...baseProps}
        folderPath={folderPath}
        clone={makeCloneRepositoryPanelState()}
      />
    )
    expect(screen.getByRole('button', { name: folderButton })).toBeEnabled()
    expect(cloneButton()).toBeEnabled()
  })

  it('clone の実行中は、clone とフォルダの変更を押せない', () => {
    render(
      <ExplorerPanel
        {...baseProps}
        folderPath="/p"
        clone={makeCloneRepositoryPanelState({ isCloning: true })}
      />
    )
    expect(cloneButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeDisabled()
  })

  it('他の Git 操作の実行中は clone を押せない(フォルダの変更は押せる)', () => {
    render(
      <ExplorerPanel
        {...baseProps}
        folderPath={null}
        clone={makeCloneRepositoryPanelState({ isBlocked: true })}
      />
    )
    expect(cloneButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'フォルダを開く' })).toBeEnabled()
  })

  it('開くと前回の失敗を消してダイアログを出し、キャンセルで閉じたら「リポジトリを clone」へフォーカスを戻す', async () => {
    const clone = makeCloneRepositoryPanelState()
    render(<ExplorerPanel {...baseProps} folderPath={null} clone={clone} />)
    await userEvent.click(cloneButton())
    expect(clone.clearError).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'リポジトリを clone' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(cloneButton()).toHaveFocus()
  })

  it('開けなかった(false)ときはダイアログを閉じない', async () => {
    const clone = makeCloneRepositoryPanelState({
      cloneRepository: vi
        .fn<(url: string, name: string) => Promise<boolean>>()
        .mockResolvedValue(false)
    })
    render(<ExplorerPanel {...baseProps} folderPath={null} clone={clone} />)
    await userEvent.click(cloneButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), 'https://github.com/a/b.git')
    await userEvent.click(screen.getByRole('button', { name: '保存先を選んで clone' }))
    expect(clone.cloneRepository).toHaveBeenCalledWith('https://github.com/a/b.git', 'b')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

// 実物のフック(useCloneRepository・useFileOperationLock)と ExplorerPanel を組み合わせ、gitApi だけをモックする
// (保留 → 操作 → 解決の順序を作る。パターン 85)
function Harness({
  applyOpenedFolder,
  onLock
}: {
  applyOpenedFolder: UseCloneRepositoryOptions['applyOpenedFolder']
  onLock?: (locked: boolean) => void
}): React.JSX.Element {
  const lock = useFileOperationLock()
  const clone = useCloneRepository({
    captureDirtySnapshot: () => '[]',
    confirmDiscardAnyDirty: () => true,
    applyOpenedFolder,
    lock,
    isGitOperationRunning: false
  })
  onLock?.(lock.isAnyLocked())
  return <ExplorerPanel {...baseProps} folderPath="/p" clone={clone} />
}

describe('ExplorerPanel と useCloneRepository の結合', () => {
  it('clone 中は閉じられず、キャンセルで中止を依頼し、中止の後は入力を保持して開いたまま', async () => {
    const pending = deferred<CloneRepositoryResult>()
    mockCloneRepository.mockReturnValueOnce(pending.promise)
    const applyOpenedFolder = vi.fn<UseCloneRepositoryOptions['applyOpenedFolder']>()
    render(<Harness applyOpenedFolder={applyOpenedFolder} />)
    await userEvent.click(cloneButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), 'https://github.com/a/b.git')
    await userEvent.click(screen.getByRole('button', { name: '保存先を選んで clone' }))
    expect(screen.getByRole('status')).toHaveTextContent(CLONE_RUNNING_NOTICE)
    expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeDisabled()
    expect(cloneButton()).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(mockCancelCloneRepository).toHaveBeenCalledOnce()
    pending.resolve({ status: 'canceled' })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'URL' })).toBeEnabled())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'URL' })).toHaveValue('https://github.com/a/b.git')
    expect(screen.getByRole('textbox', { name: 'URL' })).toHaveFocus()
    expect(applyOpenedFolder).not.toHaveBeenCalled()
  })

  it('失敗はダイアログ内に alert で出し、開き直すと消える', async () => {
    mockCloneRepository.mockRejectedValueOnce(new Error('リポジトリを clone できませんでした: x'))
    render(<Harness applyOpenedFolder={vi.fn()} />)
    await userEvent.click(cloneButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), 'https://github.com/a/b.git')
    await userEvent.click(screen.getByRole('button', { name: '保存先を選んで clone' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'リポジトリを clone できませんでした: x'
    )
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await userEvent.click(cloneButton())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('成功したら開き終わってからダイアログを閉じ、ロックを解き、「リポジトリを clone」へフォーカスを戻す', async () => {
    mockCloneRepository.mockResolvedValueOnce({ status: 'cloned', path: '/parent/b' })
    const opened = deferred<void>()
    const applyOpenedFolder = vi
      .fn<UseCloneRepositoryOptions['applyOpenedFolder']>()
      .mockReturnValueOnce(opened.promise)
    const locks: boolean[] = []
    render(<Harness applyOpenedFolder={applyOpenedFolder} onLock={(l) => locks.push(l)} />)
    await userEvent.click(cloneButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), 'https://github.com/a/b.git')
    await userEvent.click(screen.getByRole('button', { name: '保存先を選んで clone' }))
    await waitFor(() =>
      expect(applyOpenedFolder).toHaveBeenCalledWith('/parent/b', { dirtySnapshotAtConfirm: '[]' })
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(locks.at(-1)).toBe(true)
    opened.resolve()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(cloneButton()).toHaveFocus())
    expect(locks.at(-1)).toBe(false)
  })
})
```

`src/renderer/src/components/explorer/__tests__/ExplorerPanel.styles.test.tsx`（新規。全文）:

```tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FileTreeNode } from '../../../types'
import ExplorerPanel from '../ExplorerPanel'
import { makeCloneRepositoryPanelState } from '../../../__tests__/makeCloneRepositoryPanelState'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。
// 「リポジトリを clone」は、退避・マージ・リモートのバナーのボタンと 1 つのグループセレクタで宣言を共有する
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

const baseProps = {
  fileTree: [] as FileTreeNode[],
  openFilePath: null as string | null,
  onOpenFolder: vi.fn(),
  onSelectFile: vi.fn(),
  error: null as Error | null,
  gitignoreError: null as Error | null,
  onCreateFile: vi.fn(),
  onCreateDirectory: vi.fn(),
  onRenameEntry: vi.fn(),
  onDeleteEntry: vi.fn(),
  onAddToGitignore: vi.fn()
}

describe('エクスプローラーの clone のボタンのスタイル(main.css)', () => {
  it('「リポジトリを clone」は 32px 四方以上の枠付きボタン', () => {
    render(
      <ExplorerPanel {...baseProps} folderPath={null} clone={makeCloneRepositoryPanelState()} />
    )
    const style = getComputedStyle(screen.getByRole('button', { name: 'リポジトリを clone' }))
    expect(style.minWidth).toBe('32px')
    expect(style.minHeight).toBe('32px')
    expect(style.borderTopStyle).toBe('solid')
    expect(style.cursor).toBe('pointer')
  })

  it('clone 中は「リポジトリを clone」と「フォルダを変更」が半透明で、カーソルが既定に戻る', () => {
    render(
      <ExplorerPanel
        {...baseProps}
        folderPath="/p"
        clone={makeCloneRepositoryPanelState({ isCloning: true })}
      />
    )
    for (const name of ['リポジトリを clone', 'フォルダを変更']) {
      const style = getComputedStyle(screen.getByRole('button', { name }))
      expect(style.opacity).toBe('0.5')
      expect(style.cursor).toBe('default')
    }
  })
})
```

`src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx`（変更。差分）:

```diff
--- a/src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx
+++ b/src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx
@@ -3,6 +3,7 @@ import userEvent from '@testing-library/user-event'
 import { describe, it, expect, vi } from 'vitest'
 import type { FileTreeNode } from '../../../types'
 import ExplorerPanel from '../ExplorerPanel'
+import { makeCloneRepositoryPanelState } from '../../../__tests__/makeCloneRepositoryPanelState'

 const mockTree: FileTreeNode[] = [
   {
@@ -26,7 +27,8 @@ const defaultProps = {
   onCreateDirectory: vi.fn(),
   onRenameEntry: vi.fn(),
   onDeleteEntry: vi.fn(),
-  onAddToGitignore: vi.fn()
+  onAddToGitignore: vi.fn(),
+  clone: makeCloneRepositoryPanelState()
 }

 const openedProps = { ...defaultProps, folderPath: '/p', fileTree: mockTree }
```

`src/renderer/src/components/__tests__/Sidebar.test.tsx`（変更。差分）:

```diff
--- a/src/renderer/src/components/__tests__/Sidebar.test.tsx
+++ b/src/renderer/src/components/__tests__/Sidebar.test.tsx
@@ -6,6 +6,7 @@ import type { DiscardAllState, MergeStatePanelState, StashPanelState } from '../
 import { sidebarTitles } from '../../config/sidebarTitles'
 import { makeGitTagPanelState } from '../../__tests__/makeGitTagPanelState'
 import { makeRemoteSetupPanelState } from '../../__tests__/makeRemoteSetupPanelState'
+import { makeCloneRepositoryPanelState } from '../../__tests__/makeCloneRepositoryPanelState'

 const emptyStash: StashPanelState = {
   entries: [],
@@ -97,6 +98,7 @@ const defaultProps = {
   mergeState: emptyMergeState,
   gitTag: makeGitTagPanelState(),
   remoteSetup: makeRemoteSetupPanelState(),
+  clone: makeCloneRepositoryPanelState(),
   gitBranchOperationError: null as Error | null,
   onOpenDiff: vi.fn(),
   onAmend: vi.fn().mockResolvedValue(true),
@@ -179,6 +181,14 @@ describe('Sidebar', () => {
     expect(gitTag.clearError).toHaveBeenCalledOnce()
   })

+  it('explorer: clone が「リポジトリを clone」とダイアログまで届く', async () => {
+    const clone = makeCloneRepositoryPanelState()
+    render(<Sidebar {...defaultProps} activePanel="explorer" clone={clone} />)
+    await userEvent.click(screen.getByRole('button', { name: 'リポジトリを clone' }))
+    expect(clone.clearError).toHaveBeenCalledOnce()
+    expect(screen.getByRole('dialog', { name: 'リポジトリを clone' })).toBeInTheDocument()
+  })
+
   it('source-control: remoteSetup がバナーまで届く', async () => {
     const remoteSetup = makeRemoteSetupPanelState()
     render(
```

`src/renderer/src/hooks/__tests__/useAppState.test.ts`（変更。差分）:

```diff
--- a/src/renderer/src/hooks/__tests__/useAppState.test.ts
+++ b/src/renderer/src/hooks/__tests__/useAppState.test.ts
@@ -4,6 +4,7 @@ import type { GitStatusResult } from '@shared/types'
 import type { DiffTabKey } from '../useDiffTabs'
 import { makeGitTagPanelState } from '../../__tests__/makeGitTagPanelState'
 import { makeRemoteSetupPanelState } from '../../__tests__/makeRemoteSetupPanelState'
+import { makeCloneRepositoryPanelState } from '../../__tests__/makeCloneRepositoryPanelState'

 const mockUsePanelState = vi.hoisted(() =>
   vi.fn(() => ({
@@ -35,6 +36,8 @@ const mockUseFileSystem = vi.hoisted(() =>
       reloadOpenFile?: (absolutePath: string) => Promise<void>
       closeTabsAtOrInside?: (absolutePath: string) => void
       refreshTree?: () => Promise<boolean>
+      captureDirtySnapshot?: () => string
+      applyOpenedFolder?: (
+        path: string,
+        options: { dirtySnapshotAtConfirm: string }
+      ) => Promise<void>
     } => ({
       folderPath: null,
       fileTree: [],
@@ -237,6 +240,10 @@ const mockUseGitTagOperations = vi.hoisted(() =>
 const mockUseGitRemoteSetup = vi.hoisted(() =>
   vi.fn<typeof import('../useGitRemoteSetup').useGitRemoteSetup>()
 )
+// clone の組み立ては useCloneRepository.test.ts で検証する。ここでは配線(依存の受け渡し・Git 操作の実行中の合成)だけを見る
+const mockUseCloneRepository = vi.hoisted(() =>
+  vi.fn<typeof import('../useCloneRepository').useCloneRepository>()
+)

 vi.mock('../useQuickOpen', () => ({ useQuickOpen: mockUseQuickOpen }))
 vi.mock('../usePanelState', () => ({ usePanelState: mockUsePanelState }))
@@ -256,11 +263,17 @@ vi.mock('../useMergeState', () => ({ useMergeState: mockUseMergeState }))
 vi.mock('../useConflictFile', () => ({ useConflictFile: mockUseConflictFile }))
 vi.mock('../useGitTagOperations', () => ({ useGitTagOperations: mockUseGitTagOperations }))
 vi.mock('../useGitRemoteSetup', () => ({ useGitRemoteSetup: mockUseGitRemoteSetup }))
+vi.mock('../useCloneRepository', () => ({ useCloneRepository: mockUseCloneRepository }))

 import { useAppState } from '../useAppState'

 beforeEach(() => {
   vi.clearAllMocks()
+  // clone の「Git 操作の実行中」の合成がタグ・初期化の実行中フラグを読むため、既定の戻り値を毎回設定し直す
+  // (前のテストの mockReturnValue を持ち込まない。パターン 103)。個別のテストは mockReturnValue で上書きする
+  mockUseGitTagOperations.mockReturnValue(makeGitTagPanelState())
+  mockUseGitRemoteSetup.mockReturnValue(makeRemoteSetupPanelState())
+  mockUseCloneRepository.mockReturnValue(makeCloneRepositoryPanelState())
 })

 describe('useAppState', () => {
@@ -1886,4 +1899,50 @@ describe('useAppState', () => {
     renderHook(() => useAppState())
     expect(mockCloseDiffTab).not.toHaveBeenCalled()
   })
+
+  describe('clone(リポジトリの clone)', () => {
+    it('useCloneRepository に useFileSystem の確認・未保存の判定・開く処理と共有ロックを渡し、clone として公開する', () => {
+      const fileSystemDeps = {
+        captureDirtySnapshot: vi.fn(() => '[]'),
+        confirmDiscardAnyDirty: vi.fn(() => true),
+        applyOpenedFolder: vi.fn(() => Promise.resolve())
+      }
+      mockUseFileSystem.mockReturnValueOnce({
+        ...mockUseFileSystem.getMockImplementation()!(),
+        ...fileSystemDeps
+      })
+      const cloneState = makeCloneRepositoryPanelState()
+      mockUseCloneRepository.mockReturnValue(cloneState)
+      const { result } = renderHook(() => useAppState())
+      const options = mockUseCloneRepository.mock.calls[0][0]
+      expect(options.captureDirtySnapshot).toBe(fileSystemDeps.captureDirtySnapshot)
+      expect(options.confirmDiscardAnyDirty).toBe(fileSystemDeps.confirmDiscardAnyDirty)
+      expect(options.applyOpenedFolder).toBe(fileSystemDeps.applyOpenedFolder)
+      // 他の Git 操作と同じロック(別のロックだと、clone の間に commit などを始められる)
+      expect(options.lock).toBe(mockUseStashPanel.mock.calls[0][0].fileOperationLock)
+      expect(options.isGitOperationRunning).toBe(false)
+      expect(result.current.clone).toBe(cloneState)
+    })
+
+    it.each([
+      [
+        'タグの作成中',
+        () => mockUseGitTagOperations.mockReturnValue(makeGitTagPanelState({ isCreating: true }))
+      ],
+      [
+        'リポジトリの初期化中',
+        () =>
+          mockUseGitRemoteSetup.mockReturnValue(makeRemoteSetupPanelState({ isInitializing: true }))
+      ],
+      [
+        'origin の追加中',
+        () =>
+          mockUseGitRemoteSetup.mockReturnValue(makeRemoteSetupPanelState({ isAddingOrigin: true }))
+      ]
+    ])('%s は Git 操作の実行中として渡す', (_label, arrange) => {
+      arrange()
+      renderHook(() => useAppState())
+      expect(mockUseCloneRepository.mock.calls[0][0].isGitOperationRunning).toBe(true)
+    })
+  })
 })
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run src/renderer/src/components/explorer src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/hooks/__tests__/useAppState.test.ts
```

Expected: FAIL（`リポジトリを clone` のボタンが無い。`useAppState` の戻り値に `clone` が無く、`useCloneRepository` が呼ばれない）

- [ ] **Step 3: 実装する**

`src/renderer/src/components/explorer/ExplorerPanel.tsx`（変更。差分）:

```diff
--- a/src/renderer/src/components/explorer/ExplorerPanel.tsx
+++ b/src/renderer/src/components/explorer/ExplorerPanel.tsx
@@ -1,10 +1,12 @@
-import { useState } from 'react'
-import type { FileTreeNode } from '../../types'
+import { useRef, useState } from 'react'
+import type { CloneRepositoryPanelState, FileTreeNode } from '../../types'
 import { useContextMenu } from '../../hooks/useContextMenu'
+import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn'
 import { buildMenuItems } from '../../lib/explorerMenuItems'
 import FileTreeItem from './FileTreeItem'
 import ExplorerContextMenu from './ExplorerContextMenu'
 import NameInputDialog from './NameInputDialog'
+import CloneRepositoryDialog from './CloneRepositoryDialog'

 interface Props {
   folderPath: string | null
@@ -21,6 +23,8 @@ interface Props {
   onRenameEntry: (node: FileTreeNode, newName: string) => void
   onDeleteEntry: (node: FileTreeNode) => void
   onAddToGitignore: (node: FileTreeNode) => void
+  /** リポジトリの clone の状態と操作(「リポジトリを clone」とダイアログ) */
+  clone: CloneRepositoryPanelState
 }

 type DialogState =
@@ -45,10 +49,38 @@ export default function ExplorerPanel({
   onCreateDirectory,
   onRenameEntry,
   onDeleteEntry,
-  onAddToGitignore
+  onAddToGitignore,
+  clone
 }: Props): React.JSX.Element {
   const { menu, openMenu, closeMenu } = useContextMenu()
   const [dialog, setDialog] = useState<DialogState | null>(null)
+  // clone のダイアログ。閉じたら(キャンセル・Escape・オーバーレイ・成功)、clone 中でもなくなった描画の後に
+  // 「リポジトリを clone」へフォーカスを戻す(useDialogFocusReturn。パターン 86)。開くときに前回の失敗を消す
+  const cloneButtonRef = useRef<HTMLButtonElement>(null)
+  const cloneDialog = useDialogFocusReturn({
+    isRunning: clone.isCloning,
+    onOpen: clone.clearError,
+    openerRef: cloneButtonRef
+  })
+
+  // 成功(フォルダを開いた)ときだけ閉じる。取り消し・中止・失敗はダイアログに残す(入力を保持する)
+  const handleCloneSubmit = async (url: string, folderName: string): Promise<void> => {
+    if (await clone.cloneRepository(url, folderName)) cloneDialog.close()
+  }
+
+  // clone の実行中はフォルダを変えさせない(成功するとフォルダが切り替わるため)。clone は他の Git 操作の実行中も押せない
+  const cloneButton = (
+    <button
+      ref={cloneButtonRef}
+      type="button"
+      className="explorer-panel__clone-btn"
+      aria-label="リポジトリを clone"
+      disabled={clone.isCloning || clone.isBlocked}
+      onClick={cloneDialog.open}
+    >
+      リポジトリを clone
+    </button>
+  )

   const handleDialogSubmit = (name: string): void => {
     if (dialog === null) return
@@ -67,14 +99,28 @@ export default function ExplorerPanel({
       {error && <p className="explorer-panel__error">{error.message}</p>}
       {gitignoreError && <p className="explorer-panel__error">{gitignoreError.message}</p>}
       {folderPath === null ? (
-        <button type="button" className="explorer-panel__open-btn" onClick={onOpenFolder}>
-          フォルダを開く
-        </button>
+        <>
+          <button
+            type="button"
+            className="explorer-panel__open-btn"
+            disabled={clone.isCloning}
+            onClick={onOpenFolder}
+          >
+            フォルダを開く
+          </button>
+          {cloneButton}
+        </>
       ) : (
         <>
-          <button type="button" className="explorer-panel__change-btn" onClick={onOpenFolder}>
+          <button
+            type="button"
+            className="explorer-panel__change-btn"
+            disabled={clone.isCloning}
+            onClick={onOpenFolder}
+          >
             フォルダを変更
           </button>
+          {cloneButton}
           <div
             role="tree"
             aria-label="ファイルツリー"
@@ -108,6 +154,16 @@ export default function ExplorerPanel({
           onClose={closeMenu}
         />
       )}
+      {cloneDialog.isOpen && (
+        <CloneRepositoryDialog
+          isCloning={clone.isCloning}
+          isBlocked={clone.isBlocked}
+          error={clone.error}
+          onSubmit={(url, folderName) => void handleCloneSubmit(url, folderName)}
+          onCancelClone={clone.cancelClone}
+          onClose={cloneDialog.close}
+        />
+      )}
       {dialog !== null && (
         <NameInputDialog
           title={
```

`src/renderer/src/components/Sidebar.tsx`（変更。差分）:

```diff
--- a/src/renderer/src/components/Sidebar.tsx
+++ b/src/renderer/src/components/Sidebar.tsx
@@ -19,7 +19,8 @@ import type {
   DiscardAllState,
   MergeStatePanelState,
   GitTagPanelState,
-  RemoteSetupPanelState
+  RemoteSetupPanelState,
+  CloneRepositoryPanelState
 } from '../types'
 import type { GitBranch, GitLogEntry, GitStatusResult, ModelSettings } from '@shared/types'
 import { alwaysUnlocked } from '../hooks/useFileOperationLock'
@@ -37,6 +38,8 @@ interface Props {
   onCreateDirectory: (parentPath: string, name: string) => void
   onRenameEntry: (node: FileTreeNode, newName: string) => void
   onDeleteEntry: (node: FileTreeNode) => void
+  /** リポジトリの clone の状態と操作(ExplorerPanel へそのまま渡す) */
+  clone: CloneRepositoryPanelState
   prompts: Prompt[]
   onAddPrompt: (title: string, content: string) => void
   onDeletePrompt: (id: string) => void
@@ -128,6 +131,7 @@ export default function Sidebar({
   onCreateDirectory,
   onRenameEntry,
   onDeleteEntry,
+  clone,
   prompts,
   onAddPrompt,
   onDeletePrompt,
@@ -221,6 +225,7 @@ export default function Sidebar({
           onRenameEntry={onRenameEntry}
           onDeleteEntry={onDeleteEntry}
           onAddToGitignore={onAddToGitignore}
+          clone={clone}
         />
       </PanelContainer>
       <PanelContainer isActive={activePanel === 'prompts'}>
```

`src/renderer/src/App.tsx`（変更。差分）:

```diff
--- a/src/renderer/src/App.tsx
+++ b/src/renderer/src/App.tsx
@@ -112,6 +112,7 @@ export default function App(): React.JSX.Element {
     mergeState,
     gitTag,
     remoteSetup,
+    clone,
     conflictFile,
     isActiveFileConflicted,
     branchOperationError,
@@ -238,6 +239,7 @@ export default function App(): React.JSX.Element {
               onCreateDirectory={createDirectory}
               onRenameEntry={renameEntry}
               onDeleteEntry={deleteEntry}
+              clone={clone}
               prompts={prompts}
               onAddPrompt={addPrompt}
               onDeletePrompt={deletePrompt}
```

`src/renderer/src/hooks/useAppState.ts`（変更。差分）:

```diff
--- a/src/renderer/src/hooks/useAppState.ts
+++ b/src/renderer/src/hooks/useAppState.ts
@@ -23,12 +23,14 @@ import { useMergeState } from './useMergeState'
 import { useConflictFile } from './useConflictFile'
 import { useGitTagOperations } from './useGitTagOperations'
 import { useGitRemoteSetup } from './useGitRemoteSetup'
+import { useCloneRepository } from './useCloneRepository'
 import type { ConflictFileState } from './useConflictFile'
 import { useFileOperationLock } from './useFileOperationLock'
 import { useOnChange } from './useOnChange'
 import { runEditorSyncedOperation } from '../lib/editorSyncedOperation'
 import { isSamePath } from '../lib/pathUtils'
 import type {
+  CloneRepositoryPanelState,
   DiscardAllState,
   GitTagPanelState,
   MergeStatePanelState,
@@ -70,6 +72,8 @@ type AppState = {
   gitTag: GitTagPanelState
   /** リモートの管理の状態と操作(Git 管理外の「リポジトリを初期化」、状態バナーの「リモートを追加」「初回 push」) */
   remoteSetup: RemoteSetupPanelState
+  /** リポジトリの clone の状態と操作(エクスプローラーの「リポジトリを clone」とダイアログ) */
+  clone: CloneRepositoryPanelState
   /** マージ中バナーの状態と、マージの完了・中止の操作 */
   mergeState: MergeStatePanelState
   /** 未解決ファイルの解決ビューの状態と操作 */
@@ -345,6 +345,32 @@ export function useAppState(): AppState {
   const stash = useStashPanel({
     folderPath: fileSystem.folderPath,
     gitStatus: git.gitStatus,
     refreshGitStatus: git.refreshGitStatus,
     fileOperationLock,
     confirmDiscardAnyDirty: fileSystem.confirmDiscardAnyDirty,
     reloadOpenFiles: fileSystem.reloadOpenFiles,
     refreshTree: fileSystem.refreshTree
   })
+  // clone は成功するとフォルダが切り替わるため、Git 操作の実行中は始めない。全体ロックを取る操作(commit・pull・
+  // checkout・ブランチの作成・マージ・退避の push と pop・取り消し・マージの完了と中止)と、パス単位のロックを取る
+  // 操作(ステージ・ハンク)はロックで見る。ロックを取らない操作(push・fetch・初回 push・ブランチの削除・退避の
+  // 削除(drop)・タグの作成・初期化・origin の追加)は実行中フラグで見る。退避の実行中フラグ(stash.pendingOperation)
+  // を読むため、useStashPanel より後ろに置く
+  const isGitOperationRunning =
+    fileOperationLock.isAnyLocked() ||
+    gitRemoteOperations.isPushing ||
+    gitRemoteOperations.isFetching ||
+    gitRemoteOperations.isSettingUpstream ||
+    gitBranchOperations.pendingBranchOperation !== null ||
+    stash.pendingOperation !== null ||
+    gitTag.isCreating ||
+    gitRemoteSetup.isInitializing ||
+    gitRemoteSetup.isAddingOrigin
+  const clone = useCloneRepository({
+    captureDirtySnapshot: fileSystem.captureDirtySnapshot,
+    confirmDiscardAnyDirty: fileSystem.confirmDiscardAnyDirty,
+    applyOpenedFolder: fileSystem.applyOpenedFolder,
+    lock: fileOperationLock,
+    isGitOperationRunning
+  })
@@ -442,6 +465,7 @@ export function useAppState(): AppState {
     discardAll,
     gitTag,
     remoteSetup,
+    clone,
     mergeState,
     conflictFile,
     isActiveFileConflicted
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run src/renderer
npm run typecheck
```

Expected: すべて成功（`App.test.tsx` などの既存の結合テストを含む）

- [ ] **Step 5: 変異で検知力を確かめる**

`BAK="$(mktemp -d)" && cp src/renderer/src/components/explorer/ExplorerPanel.tsx src/renderer/src/hooks/useAppState.ts src/renderer/src/assets/main.css "$BAK/"` で退避し、1 つずつエディタで書き換えて `npx vitest run src/renderer/src/components/explorer src/renderer/src/hooks/__tests__/useAppState.test.ts`（と `-t` 単独）で落ちることを確かめ、そのつど戻す。括弧内はプラン作成時に検証用の写しで落ちたテスト。

1. `フォルダを変更` の `disabled={clone.isCloning}` を消す（`clone の実行中は、clone とフォルダの変更を押せない`・結合の `clone 中は閉じられず`・スタイルの半透明の 3 件）
2. `handleCloneSubmit` を、結果に関わらず `cloneDialog.close()` する形にする（`開けなかった(false)ときはダイアログを閉じない`・結合の中止・失敗の 3 件）
3. `useAppState.ts` の `isGitOperationRunning` から `gitTag.isCreating ||` を外す（`タグの作成中 は Git 操作の実行中として渡す` の 1 件）
4. `useAppState.ts` の `lock: fileOperationLock` を `lock: useFileOperationLock()` の別のロックにする（`…と共有ロックを渡し` の 1 件）
5. `main.css` の共通の disabled のグループから `.explorer-panel__change-btn:disabled,` を外す（`ExplorerPanel.styles.test.tsx` の半透明の 1 件）

最後に `cmp` で 3 ファイルとも元に戻ったことを確かめる。`Sidebar.tsx` と `App.tsx` の配線の漏れ（`clone={clone}` を消す）は typecheck（必須の props）と `Sidebar.test.tsx` の `explorer: clone が「リポジトリを clone」とダイアログまで届く` で落ちることを確かめる。

- [ ] **Step 6: 型・lint・整形を確かめる**

```bash
npm run typecheck
npx eslint src/renderer/src/components/explorer/ExplorerPanel.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx src/renderer/src/hooks/useAppState.ts src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx src/renderer/src/components/explorer/__tests__/ExplorerPanel.clone.test.tsx src/renderer/src/components/explorer/__tests__/ExplorerPanel.styles.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/hooks/__tests__/useAppState.test.ts
npx prettier --check src/renderer/src/components/explorer/ExplorerPanel.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx src/renderer/src/hooks/useAppState.ts src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx src/renderer/src/components/explorer/__tests__/ExplorerPanel.clone.test.tsx src/renderer/src/components/explorer/__tests__/ExplorerPanel.styles.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/hooks/__tests__/useAppState.test.ts
```

Expected: すべて成功

- [ ] **Step 7: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 9: ROADMAP の更新・テスト仕様書への追記・全体検証

**Files:**

- Modify: `ROADMAP.md`, `docs/manual-test-spec.md`
- 生成: `.superpowers/manual-test-spec.html`（git 管理外）

**Interfaces:**

- Consumes: Task 1〜8 の実装（文言は実装のファイルと突き合わせる。パターン 65・89）
- Produces: ROADMAP の実装済みの項目・見送り項目・既知の制約、実機テスト仕様書の領域 `CLN`

- [ ] **Step 1: ROADMAP を更新する**

1. 「実装済み機能 → ソース管理（Git 操作）」の `- [x] リモートの管理（…）` の項目の直後に追加:

```markdown
- [x] リポジトリの clone（エクスプローラーの「リポジトリを clone」から URL とフォルダ名を入力し、保存先の親フォルダを
      OS のダイアログで選んで clone し、そのフォルダを開く。フォルダ名は URL から決めて編集できる。URL はリモートの追加と
      同じ許可リストで検証し、パスワード入りの URL は拒否する。実行中は「キャンセル」で中止でき、出力が 60 秒途絶えたら
      打ち切る。中止・打ち切り・失敗では git が起動した子プロセスまで止め、アプリが作った保存先だけを削除する。
      保存先が既にあれば上書きしない）
```

2. 「今後実装した方がよい機能 → ソース管理（Git）」の `- [ ] リポジトリの clone` を消し、同じ位置に次の見送り項目を置く:

```markdown
- [ ] clone の拡張（ブランチの指定、浅い clone（`--depth`）、サブモジュールの再帰（`--recurse-submodules`）、LFS の設定、
      進捗の % 表示、既存のフォルダへの clone（上書き・マージ）、認証情報の入力欄）
```

3. 「改善・技術的負債」の末尾に、既知の制約を追加:

```markdown
- [ ] 既知の制約（リポジトリの clone）: `GIT_ASKPASS`（VS Code のターミナルから起動したときの VS Code の askpass など）・
      `core.askPass`・`SSH_ASKPASS` がある環境では、`GIT_TERMINAL_PROMPT=0` でもそのプログラムが資格情報を求める（上書き
      しない。応答が無ければ 60 秒で打ち切る）。clone 中も fetch とエクスプローラーのファイル操作（作成・リネーム・削除）は
      押せる（今のフォルダに対して行われる）。clone 中にアプリを終了すると保存先に不完全なフォルダが残りうる（ウィンドウを
      閉じたときは中止して削除する）。Windows での子孫ごとの停止（`taskkill /T /F`）と、ssh のホスト鍵の確認が待たないことは
      実機で未確認。既定のフォルダ名は query・fragment を落とすなど git の既定の名前と一部違う（編集できる）
```

（ブランチ全体の最終レビューで、上の「clone 中も fetch とエクスプローラーのファイル操作は押せる」は事実と違う（ダイアログのオーバーレイが画面全体を覆う）と分かったため、ROADMAP では塞がれないもの（メニューバーの操作）を書く形に直し、リロードでの中止・Windows のフォルダ選択の食い違い・デーモン化する子孫の制約を追記した。現行の文面は ROADMAP を参照）

```bash
grep -n "clone" ROADMAP.md
npx prettier --check ROADMAP.md
```

Expected: 実装済みの項目・見送り項目・既知の制約の 3 か所が出て、未実装の `- [ ] リポジトリの clone` は出ない。prettier が通る（通らなければ `npx prettier --write ROADMAP.md`）

- [ ] **Step 2: 実機テスト仕様書に追記する**

`docs/manual-test-spec.md` の `## リモートの管理` の領域の最後（`RMT-049` の後、`## 設定` の前）に、次の領域を追加する。書式は仕様書の冒頭と `scripts/build-manual-test-spec.mjs` に従う（1 行 1 項目、ID は `CLN-001` から昇順、手順と期待結果は最初の「→」で区切る。ID は以後変えない）。文言は実装（`ExplorerPanel` / `CloneRepositoryDialog` / `cloneValidation` / `remoteSetupValidation` / `gitCloneService` / `dialogService` / `cloneRegistry`）と突き合わせて確認する（パターン 65・89）。実機で自信が持てない期待結果は項目にせず、ファイル末尾の HTML コメント（要確認事項）に足す。

```markdown
## リポジトリの clone

> 前提: 【要 Git リポジトリ】clone 元の bare リポジトリは、端末で `SRC="$(mktemp -d)" && git init -q -b main "$SRC/seed" && echo hello > "$SRC/seed/README.md" && git -C "$SRC/seed" add README.md && git -C "$SRC/seed" -c user.name=t -c user.email=t@example.com commit -qm init && git clone -q --bare "$SRC/seed" "$SRC/remote.git" && echo "$SRC/remote.git"` を実行して作り、表示された絶対パスを URL に使う。保存先の親フォルダは、同じ端末で `PARENT="$(mktemp -d)" && echo "$PARENT"` を実行して作る(フォルダの選択画面では Cmd+Shift+G でパスを入力できる)。以後もその端末で `$SRC`・`$PARENT` を使う。
> 前提: アプリは VS Code のターミナルではなく、macOS のターミナル(Terminal.app など)から `npm run dev` で起動する(VS Code のターミナルでは `GIT_ASKPASS` に VS Code の askpass が入り、認証の待ち方が変わる。既知の制約)。
> 前提: main プロセスが返したエラーの文言の前には、Electron が付ける英語の前置き `Error invoking remote method '<チャンネル>': Error: ` が付く(IPC を通る全操作に共通の既知の制約。ROADMAP 参照)。以下の期待結果には、前置きの後の文言を書く。

### 入口とダイアログ

- [ ] **CLN-001** フォルダを開いていない状態でエクスプローラーを表示する → `フォルダを開く` の下に `リポジトリを clone` ボタンがある。`フォルダを開く` で `$SRC/seed` を開くと、`フォルダを変更` の下にも `リポジトリを clone` がある
- [ ] **CLN-002** `リポジトリを clone` を押す → `リポジトリを clone` のダイアログが開き、`保存先の親フォルダを選ぶと、その中にフォルダを作って取得し、そのフォルダを開きます` の説明、`URL`(フォーカスあり)と `フォルダ名` の入力欄、赤字の `URL を入力してください` と `フォルダ名を入力してください`、押せない `保存先を選んで clone`、`キャンセル` が表示される
- [ ] **CLN-003** `URL` に `https://github.com/octocat/Hello-World.git` を入力する → `フォルダ名` が `Hello-World` になり、赤字の文言が消え、`保存先を選んで clone` が押せる(押さない)。続けて `URL` を `git@github.com:a/b.git/` に変えると `フォルダ名` は `b`、`https://github.com/a/c.git?x=1` に変えると `c` になる
- [ ] **CLN-004** CLN-003 のあと `フォルダ名` を `mine` に書き換え、`URL` を `https://github.com/a/other.git` に変える → `フォルダ名` は `mine` のまま
- [ ] **CLN-005** `URL` に `ext::sh -c touch% /tmp/pwned` を入力する → ``URL に空白・改行・制御文字・引用符（' " `）は使用できません`` が表示され、`保存先を選んで clone` が押せない。`https://alice:secret@example.com/a.git` では `使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）`、`--upload-pack=x` では `` `-` で始まる URL は使用できません `` が表示され、どちらも押せない
- [ ] **CLN-006** `URL` を `https://github.com/a/b.git` に戻し、`フォルダ名` に `a/b`、続けて `..`、続けて先頭に空白を付けた ` b` を入力する → どれも `フォルダ名に使えない文字が含まれています` が表示され、`保存先を選んで clone` が押せない
- [ ] **CLN-007** ダイアログを `キャンセル`・Escape キー・ダイアログの外側のクリックのそれぞれで閉じる → どの方法でもダイアログが閉じ、`リポジトリを clone` にフォーカスが戻る。開き直すと入力は空に戻っている
- [ ] **CLN-008** ダイアログを開いて `URL` に `https://github.com/a/b.git` を入力し、Tab を 6 回、続けて Shift+Tab を 6 回押す → フォーカスは背後のエクスプローラーやエディタに移らず、`URL`・`フォルダ名`・`保存先を選んで clone`・`キャンセル` を循環する。続けて説明の文字をクリックしてから Escape を押す → ダイアログ全体を囲むフォーカスリング(枠線)は出ず、ダイアログが閉じる
- [ ] **CLN-009** ダイアログを開いて `URL` に `https://github.com/a/b.git` を入力し、入力欄の中でマウスのボタンを押したまま、ダイアログの外側(暗い部分)まで動かして離す → ダイアログは閉じず、入力が残っている

### clone の実行

- [ ] **CLN-010** `URL` に `$SRC/remote.git` の絶対パス(`echo "$SRC/remote.git"` の出力)を入力し、`フォルダ名` は既定の `remote` のまま `保存先を選んで clone` を押す → アプリのウィンドウにシートでフォルダの選択画面(`ここに clone` ボタン)が開き、閉じるまで clone のダイアログは操作できない
- [ ] **CLN-011** CLN-010 の選択画面で `$PARENT` を選んで `ここに clone` を押す → ダイアログが閉じ、エクスプローラーが `remote` フォルダ(`README.md` がある)を表示し、`リポジトリを clone` にフォーカスがある。ソース管理パネルはブランチ `main` を表示し、`リモートが未設定です` のバナーは出ない。端末で `git -C "$PARENT/remote" remote get-url origin` が入力した URL で、`grep -c protocol "$PARENT/remote/.git/config"` は `0`
- [ ] **CLN-012** CLN-011 と同じ URL・フォルダ名 `remote` でもう一度 clone し、`$PARENT` を選ぶ → ダイアログは閉じず、赤字で `保存先に同名のフォルダがあります` が表示され、`URL` の入力欄にフォーカスがある。開いているフォルダは変わらない。続けて端末で `mkdir "$PARENT/empty"` を実行し、フォルダ名 `empty` で同じことをすると同じ文言が表示され、`ls -A "$PARENT/empty"` は何も出力しない
- [ ] **CLN-013** フォルダ名 `second` で `保存先を選んで clone` を押し、選択画面の `新規フォルダ` で `$PARENT` の中に `nest` を作ってそれを選ぶ → `$PARENT/nest/second` に clone され、そのフォルダが開く
- [ ] **CLN-014** フォルダ名 `third` で `保存先を選んで clone` を押し、選択画面を `キャンセル` する → clone のダイアログは開いたまま入力が残り、赤字のエラーは出ない。エクスプローラーのフォルダは変わらない。端末で `ls "$PARENT"` に `third` は無い
- [ ] **CLN-015** `URL` に `echo "file://$SRC/remote.git"` の出力、`フォルダ名` に `via-file` を入力して clone し、`$PARENT` を選ぶ → 成功し、`via-file` フォルダが開く
- [ ] **CLN-016** `URL` に `/tmp/does-not-exist.git`、`フォルダ名` に `missing` を入力して clone し、`$PARENT` を選ぶ → ダイアログは閉じず、赤字で `リポジトリを clone できませんでした: ` に続けて git のエラー(`does not exist` を含む)が表示される。端末で `ls "$PARENT"` に `missing` は無い
- [ ] **CLN-017** 開いているフォルダのファイルを編集して保存せずに、`リポジトリを clone` から URL `$SRC/remote.git`・フォルダ名 `dirty` で `保存先を選んで clone` を押す → `フォルダを変更` と同じ未保存の破棄の確認が出る。取り消すと何も起きない(選択画面も出ず、ダイアログは開いたまま)。もう一度押して OK を押すと選択画面が出る(`キャンセル` で閉じる)

### 実行中・中止・打ち切り

> 前提: 応答しないサーバーとして、別の端末で `nc -lk 127.0.0.1 9419` を実行したままにする(終わったら Ctrl+C で止める)。

- [ ] **CLN-018** `URL` に `git://127.0.0.1:9419/x.git`、`フォルダ名` に `slow` を入力して clone し、`$PARENT` を選ぶ → ボタンが `clone 中…` で押せず、`clone 中です。キャンセルで中止できます（応答が 60 秒途絶えると打ち切ります）` が表示され、`URL`・`フォルダ名` は入力できず、`キャンセル` にフォーカスがある。エクスプローラーの `フォルダを変更` と `リポジトリを clone` は押せない(半透明)。Escape キーとダイアログの外側のクリックでは閉じない
- [ ] **CLN-019** CLN-018 の状態で `キャンセル` を押す → 案内が消え、ダイアログは開いたまま入力が残り、`URL` の入力欄にフォーカスがある。赤字のエラーは出ない。端末で `ls "$PARENT"` に `slow` は無く、`pgrep -fl '9419/x.git'` は何も出力しない
- [ ] **CLN-020** CLN-018 と同じく clone を始め、何もせずに待つ → 約 60 秒後に案内が消え、赤字で `clone が時間内に進みませんでした（認証の待ち、または通信の停止の可能性があります）` が表示される。端末で `ls "$PARENT"` に `slow` は無く、`pgrep -fl '9419/x.git'` は何も出力しない
- [ ] **CLN-021** CLN-018 と同じく clone を始めてから、アプリのウィンドウを閉じる(Cmd+W) → 端末で `pgrep -fl '9419/x.git'` は何も出力せず、`ls "$PARENT"` に `slow` は無い
- [ ] **CLN-022** CLN-011 の `remote` フォルダを開き、端末で `printf '#!/bin/sh\nsleep 5\n' > "$PARENT/remote/.git/hooks/pre-push" && chmod +x "$PARENT/remote/.git/hooks/pre-push" && git -C "$PARENT/remote" -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m second` を実行してソース管理の `更新` を押し、`プッシュ` を押してすぐにエクスプローラーを表示する → 約 5 秒間 `リポジトリを clone` が押せず(半透明)、プッシュが終わると押せるようになる。確認後 `rm "$PARENT/remote/.git/hooks/pre-push"` で戻す

### 認証と ssh

- [ ] **CLN-023** 【要リモート】`URL` に `https://github.com/octocat/Hello-World.git`、`フォルダ名` は既定の `Hello-World` のまま clone し、`$PARENT` を選ぶ → 成功し、`Hello-World` フォルダが開く
- [ ] **CLN-024** 【要リモート】`URL` に `https://github.com/octocat/this-repository-does-not-exist-cln.git`、`フォルダ名` に `nope` を入力して clone し、`$PARENT` を選ぶ → 数秒以内に、赤字で `リポジトリを clone できませんでした: ` に続く git のエラー(`terminal prompts disabled` か `not found` を含む)が表示され、入力を待ち続けない。アプリを起動した端末にユーザー名の入力は出ない。`ls "$PARENT"` に `nope` は無い
- [ ] **CLN-025** 【要リモート】端末で `ssh-keygen -F '[ssh.github.com]:443'` が何も出力しない(このホストの鍵が未登録)ことを確かめ、`URL` に `ssh://git@ssh.github.com:443/octocat/Hello-World.git`、`フォルダ名` に `ssh-check` を入力して clone し、`$PARENT` を選ぶ → 数秒以内に、赤字で `リポジトリを clone できませんでした: ` に続けて `Host key verification failed.` を含むエラーが表示される。アプリを起動した端末に `Are you sure you want to continue connecting` の確認は出ない。`ls "$PARENT"` に `ssh-check` は無く、`ssh-keygen -F '[ssh.github.com]:443'` は何も出力しないまま

### 見た目

- [ ] **CLN-026** `リポジトリを clone` ボタンとダイアログを見る → 暗色の背景で、ボタンはソース管理の `リモートを追加` と同じ枠付きの見た目(押せない間は半透明)、ダイアログは `リモートを追加` のダイアログと同じ枠・入力欄・ボタンの見た目
```

ファイル末尾の HTML コメント（要確認事項）に、次の行を足す:

```markdown
- CLN の clone 中にエディタで編集したとき、clone の成功の後にもう一度未保存の破棄を確認すること(applyOpenedFolder の dirtySnapshotAtConfirm)は、成功する clone を長引かせる手順が作りにくいため項目にしていない(単体テストで確認。実機で未確認)
- CLN の scp 形式・ssh:// のユーザー名の伏せ字(`***@`)は ssh サーバーが要るため項目にしていない(統合テストで偽の ssh を使って確認)
- CLN-010 のシートの見た目・CLN-021 でウィンドウを閉じた後のアプリの状態(dev 起動で残るか)は実機で未確認。Windows での子孫ごとの停止と ssh の確認が待たないことは未確認(既知の制約)
- CLN-024 は GitHub の応答(存在しないリポジトリへの認証の要求)と利用者の credential helper の設定で文言が変わる(keychain に GitHub の資格情報があると `not found`)
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
(git diff --name-only --diff-filter=d; git ls-files --others --exclude-standard) | xargs npx prettier --check
pgrep -fl 'sleep 30' || echo 'no orphans'
git status -s --untracked-files=all
git branch --show-current
```

Expected: すべて成功。`no orphans`。`git status` に、この機能に関係ないファイルや一時ファイル（変異の退避先・`.superpowers/` 以外の生成物）が無いこと（`.superpowers/` は git 管理外）。ブランチは `feat/repository-clone`

- [ ] **Step 4: Artifact を再公開する（CLAUDE.md のルール）**

`.superpowers/manual-test-spec.html` を同じファイルパス・同じ URL（<manual-test-spec-artifact-url>）で再公開する。これはコントローラー（親エージェント）が行う（実装者のサブエージェントは行わない）。

- [ ] **Step 5: Commit（ユーザーの許可がある場合のみ）**

## Self-Review

**Spec coverage:**

- 入口（エクスプローラーの「フォルダを開く」/「フォルダを変更」の隣、未選択でも選択済みでも）と無効化の条件: Task 8（`ExplorerPanel`・スタイル）
- ダイアログ（URL の検証・既定のフォルダ名と編集後に上書きしない・フォルダ名の規則・実行中の案内と閉じる経路・`キャンセル` で中止・結果ごとの表示・フォーカスの戻り・a11y 一式）: Task 1（規則）・Task 6（文言）・Task 7（ダイアログ）・Task 8（開閉とフォーカスの戻り）
- 未保存の確認・開く処理（`applyOpenedFolder`・世代管理・clone 中の編集の再確認）: Task 5・Task 6
- main の入口の検証・保存先の作成・実行（`--progress`・protocol の拒否・`GIT_TERMINAL_PROMPT=0`・無出力の打ち切り・中止）・子プロセスまで止める・自分が作ったフォルダだけの削除・資格情報の伏せ字・成功のときだけ `FolderAccessManager` を変える: Task 2・Task 3・Task 4
- IPC（引数の型・OS のダイアログ・1 ウィンドウ 1 つ・中止は冪等・ウィンドウを閉じたら中止）・preload・`gitApi`: Task 4
- 排他（clone 中はフォルダの変更・clone・ロックを見る Git 操作を始めさせない、Git 操作の実行中は clone を押せない）: Task 6・Task 8
- 設計書の確認事項 1〜8 の実測と、食い違いの本文への反映: 設計書（確認の結果）・差異 1〜20
- ROADMAP・実機テスト仕様書（`CLN-001`〜`CLN-026`）・全体検証・Artifact の再公開（親）: Task 9

**Placeholder scan:** TBD / TODO / 「同様に」なし。各タスクのテストと実装のコードは、新規のファイルは全文、既存のファイルは差分（`git diff` の出力）で示した。`useFileSystem.ts` は 2 段に分けて挿入位置とコードを示し、最終的な差分も載せた。

**Type consistency:** `CloneRepositoryResult` / `GIT_CLONE_IDLE_TIMEOUT_MS` / `deriveCloneFolderName` / `getCloneFolderNameViolation`（Task 1）→ `runGitCloneProcess` / `GitCloneProcessResult`（Task 2）→ `cloneRepository` / `assertValidCloneRequest` / `CLONE_FOLDER_NAME_MESSAGES`（Task 3）→ `CloneRegistry` / `chooseCloneParentDialog` / `registerCloneHandlers` / `git:cloneRepository` / `git:cancelCloneRepository` / `gitApi.cloneRepository`（Task 4）→ `applyOpenedFolder` / `ApplyOpenedFolderOptions` / `captureDirtySnapshot`（Task 5）→ `CloneRepositoryPanelState` / `useCloneRepository` / `validateCloneFolderName`（Task 6）→ `CloneRepositoryDialog` / `CLONE_RUNNING_NOTICE`（Task 7）→ `clone` の配線（Task 8）。

**既存の名前の確認:** プランが使う既存の名前はすべて現行のコードで確認した: `FolderAccessManager.set`（`folderAccessManager.ts`）、`getAllowedFolder`（`handlers/fileAccessGuard.ts`。clone では使わない理由を Task 4 に記載）、`isSafeEntryName`（`@shared/entryName`）、`assertValidEntryName`（`handlers/entryNameValidator.ts`。使わない理由は差異 11）、`REMOTE_URL_RULE_MESSAGES`（`gitRemoteSetupService.ts`）、`normalizeRemoteUrl` / `getRemoteUrlRuleViolation`（`@shared/remoteUrl`）、`failure` / `redactCredentials` / `toStepError`（`gitStepErrors.ts`。`toStepError` を使わない理由は Task 3）、`useFileSystem` の `openFolder`・`confirmDiscardAnyDirty`・`dialogAttemptRef` などの世代管理、`useDialogFocusTrap` / `useDialogFocusReturn` / `useOverlayDismiss` / `useFocusOnRunningEnd`、`RemoteSetupInputDialog`（作りの手本）、`validateRemoteUrl`（`lib/remoteSetupValidation.ts`）、`useFileOperationLock`（`isAnyLocked` / `lockGlobal` / `unlockGlobal`）、`gitHandlers.ts` の `assertRemoteUrlArg`（流儀だけを写す）、`ipcHandlers.ts` の登録、preload の `api.ts` / `index.d.ts`、`helpers/realGitRepo.ts` の `initRepo` / `commitAll` / `runGit` / `writeRepoFile` / `stubIsolatedGitEnv` / `stubGitCeiling`、`makeGitTagPanelState` / `makeRemoteSetupPanelState`。

**検証の記録:** プラン作成時に、リポジトリの追跡ファイルを scratchpad の検証用の写し（`git ls-files` を rsync。`node_modules` はリンク）へ写し、Task 1〜8 のコードをすべて適用して、`npx vitest run`（304 ファイル・5823 件。適用前の現行のリポジトリは 291 ファイル・5608 件）・`npm run typecheck`・変更したファイルへの `npx eslint` と `npx prettier --check` が通ることを確認した（実 git 2.50.1、macOS）。偽の git・偽の ssh を使うテストは 3 回続けて安定し、孤児（`sleep 30`）は残らなかった。各タスクの Step 5 の変異は、Task 1 を除き、検証用の写しで 1 つずつ入れて落ちることを確認した（括弧内に落ちたテストを書いた。Task 1 の変異はテストの表から落ちる行が明らかなため未実施）。Task 9 の仕様書の追記と ROADMAP の更新も写しに適用し、`npx vitest run scripts`（24 件）・`node scripts/build-manual-test-spec.mjs`（16 領域・885 項目）・`npx prettier --check` が通ることを確認した。実機（Electron）での確認はしていない（実機テスト仕様書の `CLN-001`〜`CLN-026`）。
