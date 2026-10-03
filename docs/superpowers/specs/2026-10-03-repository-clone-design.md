# リポジトリの clone 設計書

作成日: 2026-10-03 / 対象: ROADMAP の「リポジトリの clone」

## 目的

「別画面を開かず、タッチ操作だけで Git 操作までの開発フローを完結する」というコンセプトに対し、リモートのリポジトリを
アプリの中だけで取得して、そのまま開けるようにする。リモートの管理（#42）で、新規リポジトリの初期化・origin の追加・初回 push は
できるようになったが、既存のリポジトリを取得するには外部のターミナルが必要だった。

## 範囲

### 含める

- エクスプローラーの「フォルダを開く」の下に、`リポジトリを clone` のボタンを置く（フォルダが未選択でも選択済みでも使える）
- ダイアログで URL とフォルダ名を入力し、保存先の親フォルダを OS のダイアログで選んで clone する
- 実行中の `キャンセル`（プロセスを止め、自分が作ったフォルダを削除する）と、無出力のタイムアウト
- 成功したら、そのフォルダを自動で開く（「フォルダを変更」と同じ、未保存の変更の確認を経る）
- URL の検証は、リモートの管理（#42）の規則（`@shared/remoteUrl`）を再利用する。パスワード入りの URL は拒否する

### 含めない（ROADMAP に見送り項目として残す）

- ブランチの指定、浅い clone（`--depth`）、サブモジュールの再帰（`--recurse-submodules`）、LFS の設定
- 進捗の % 表示（「clone 中」の表示のみ）
- 既存のフォルダへの上書き・マージ（保存先が既に存在する場合は拒否する）
- 認証情報の入力欄（認証は credential helper か ssh の鍵に任せる。#42 と同じ方針）

## 設計の前提（利用者の決定）

- 入口はエクスプローラーの「フォルダを開く」の下
- 保存先は、親フォルダを OS のダイアログで選び、フォルダ名は URL から決めて編集できる（パスをアプリが文字列で受け取らない）
- 成功したらそのフォルダを自動で開く
- 実行中は `キャンセル` と無出力のタイムアウトを持つ。進捗は「clone 中」の表示のみ

## 設計書の確認事項（実装の最初に実機の git で確かめ、結果をここに追記する）

以下は設計時点では推測で、実装の最初のタスクで実機の git で確認する。食い違えば設計を直す。

1. `git clone` は標準エラーが端末でないと進捗を出さない。無出力タイムアウトは出力を数えるため、長い clone を誤って打ち切らないよう
   `--progress` を明示する（`--` より前に置く。simple-git の progress プラグインは引数の末尾に `--progress` を足し、`--` の後だと
   refspec 扱いになって失敗した。パターン 94）
2. simple-git の `timeout.block` が、標準エラーの出力も数えること
3. 打ち切り（`abort` のシグナル、またはタイムアウト）で、`git clone` の子プロセス（`git-remote-https`・`ssh`）まで止まり、孤児が残らないこと
   （パターン 84）。止めた後に保存先に残る状態（空のフォルダ・`.git` だけ）
4. `GIT_TERMINAL_PROMPT=0` で、認証情報を求められる https の clone が待たずに失敗すること。失敗の文言
5. `-c protocol.ext.allow=never` を付けても、許可リストの形式（https・http・ssh・git・file・scp 形式・絶対パス）の clone が成功すること
6. ssh の未知のホスト鍵の確認（`yes/no`）は、端末が無いと待たずに失敗すること。ユーザーの ssh の設定を上書きしない（`GIT_SSH_COMMAND` を
   設定しない。パターン 81）
7. ローカルの絶対パス・`file://` からの clone が成功すること（`ALREADY_REPOSITORY` 等の判定に影響しないこと）
8. 保存先のフォルダ名の候補を URL から決める規則（末尾の `/`・`.git`・scp 形式・クエリ）の実在する URL での結果

### 確認の結果（2026-10-03。実機 git 2.50.1（Apple Git-155）・simple-git 3.36.0・`@simple-git/argv-parser` 1.1.1）

一時ディレクトリのローカルの bare リポジトリ・偽の ssh（`core.sshCommand`）・偽の git（PATH の先頭）・`127.0.0.1` の閉じたポート・
ローカルの HTTP サーバー（応答しない／401 を返す）・ローカルの sshd（`127.0.0.1:22999`、使い捨ての鍵）で確かめた。ネットワークには出ていない。
食い違った点は本文も直した（「確認事項の結果で変更」と書いた箇所）。実装プランの「差異」に番号付きで記録した。

1. **進捗**: 標準エラーが端末でないと `git clone` は `Cloning into '…'...` だけを出し、進捗を出さない。`--progress` を付けると
   `remote: Counting objects:  3% (1/32)`・`Receiving objects: …` を `\r` 区切りで出す（ローカルの絶対パスの clone は小さいと `done.` だけ）。
   simple-git の progress プラグインは、`--progress` が無ければ引数の末尾に足し、その後の suffixPathsPlugin が `--` 以降を末尾へ移すため、
   `raw(['clone', '--', url, dest])` は `fatal: Too many arguments.` で失敗した。`--progress` を `--` の前に自分で置けば足されない（成功）。
   → 想定どおり。ただし下の 3 の理由で simple-git を使わない（`--progress` は自分で付ける）
2. **`timeout.block` と標準エラー**: simple-git の timeout プラグインは既定（`stdErr: true`）で標準エラーの出力も数える（標準エラーにだけ
   0.3 秒ごとに書く偽の git は 0.6 秒の打ち切りで止まらず、`stdErr: false` では止まった）。→ 想定どおり。ただし 3 の理由で、同じ数え方
   （標準出力・標準エラーのどちらの出力でも打ち切りまでの時間を延ばす）を自前で実装する
3. **打ち切り・中止と孤児（食い違い）**: simple-git の `abort`・`timeout` は git 本体に `SIGINT` を送るだけだった（`context.kill` →
   `spawned.kill('SIGINT')`。SIGKILL への切り替えも無い）。git は止まるが、git が起動した `git-remote-http`（応答しない HTTP サーバー相手）と
   偽の ssh とその子（`sleep`）は孤児として残った。git の代わりの sh（`sleep` を待つ）は `SIGINT` で止まらず、Promise は解決しなかった。
   さらに `-c protocol.ext.allow=never` は blockUnsafeOperationsPlugin が `Configuring protocol.allow is not permitted without enabling
allowUnsafeProtocolOverride` で拒否した（git の前に置いても、clone の `-c` でも、`config` オプションでも同じ）。
   → **simple-git を使わず `child_process.spawn` で起動する**。POSIX では新しいプロセスグループ（`detached: true`）にし、打ち切り・中止では
   グループごと `SIGTERM`、5 秒の猶予の後も閉じなければ `SIGKILL` を送る。この方式では `git-remote-http`・偽の ssh・その子・`SIGTERM` を
   無視する sh まで止まり、孤児は残らなかった。止めた後の保存先: git が作った保存先は `SIGTERM` で git 自身が削除し、作成済みの空の
   フォルダへの clone では中身だけ消して空のフォルダを残し、`SIGKILL` では `.git`（`HEAD`・`config`・`objects` など）が残った
   （どれもサービスが削除する）。Windows はプロセスグループが無いため `taskkill /pid <pid> /T /F` で子孫ごと止める（実機で未確認）
4. **`GIT_TERMINAL_PROMPT=0`（一部食い違い）**: 401 を返すローカルの HTTP サーバーへの clone は、`GIT_ASKPASS` と `SSH_ASKPASS` が空なら
   20〜40ms で `fatal: could not read Username for 'http://127.0.0.1:<port>': terminal prompts disabled`（終了コード 128）で失敗した。
   `GIT_TERMINAL_PROMPT` を付けず制御端末も無い（`detached`）と `… Device not configured`。**しかし `GIT_ASKPASS` が設定されている環境
   （VS Code のターミナルから起動すると VS Code の `askpass.sh` が入る）では、`GIT_TERMINAL_PROMPT=0` でも askpass が呼ばれ、5 秒で
   打ち切るまで待った**。askpass・`core.askPass`・credential helper は利用者の設定として上書きしない（パターン 81）。その GUI に応答すれば
   進み、応答しなければ無出力の 60 秒で打ち切る（既知の制約に追記）
5. **`-c protocol.ext.allow=never -c protocol.fd.allow=never`**: git の前に置いて、`http://`（401 で認証の失敗まで進む）・`https://`（接続の
   失敗）・`git://`（接続の失敗）・`ssh://` と scp 形式（ローカルの sshd でホスト鍵の確認まで進む）・`file://`・絶対パス（成功）の
   どれも、protocol の拒否（`transport '<x>' not allowed`）にならずに進んだ。`ext::` と `fd::` は `transport 'ext' not allowed` /
   `transport 'fd' not allowed` で止まった。git の既定では `fd::` は許可されていて、`git clone fd::3` は入力を待ち続けた（URL の許可リストが
   拒否するが、防御の 2 層として付ける意味がある）。**clone の `-c`（`git clone -c …`）は新しいリポジトリの `.git/config` に
   `protocol.ext.allow=never` を書き残した**。git の `-c`（`git -c … clone`）は書き残さない → **`-c` は `clone` の前（git の前）に置く**
   （食い違い。本文を変更）
6. **ssh の未知のホスト鍵**: ローカルの sshd（known_hosts が空）へ `ssh://git@127.0.0.1:22999/a/b.git` と scp 形式で clone すると、
   制御端末が無ければ 30ms 前後で `Host key verification failed.` → `fatal: Could not read from remote repository.`（終了コード 128）で
   失敗した。**制御端末がある状態（`script` で擬似端末を付けた。端末から `npm run dev` で起動したアプリと同じ）で `detached` にしないと、
   ssh は端末に `Are you sure you want to continue connecting (yes/no/[fingerprint])?` を出して待ち続けた**。`detached: true`（setsid で
   制御端末が外れる）なら、端末があっても即座に失敗した → 3 のプロセスグループと合わせて `detached` で起動する（`GIT_SSH_COMMAND` は
   設定しない。利用者の ssh の設定を上書きしない）
7. **ローカルからの clone**: 絶対パスの bare リポジトリ・作業ツリーのあるリポジトリ・`file://`（末尾の `/` あり・日本語のパス）・
   シンボリックリンク経由のパスのどれも成功した。別のリポジトリの中の親フォルダへの clone も成功し、入れ子のリポジトリになる（外側の
   リポジトリには `?? <名前>/` と未追跡で出る。`initRepository` の「既にリポジトリか」の判定とは関係しない）。git clone は**空の既存
   フォルダへの clone を受け付け**、中身のあるフォルダは `destination path '…' already exists and is not an empty directory.` で拒否する
   （→ 保存先の作成を本文で変更）
8. **既定のフォルダ名**: `git clone <url>`（保存先を省略）が出した `Cloning into '<名前>'...` を表にした（実装プランの Task 1 のテストに
   そのまま載せた）。git の規則: 末尾の `/` を除き、末尾の `/.git` を除き、末尾の `.git` を 1 回だけ除く（大文字小文字を区別。`b.git.git` →
   `b.git`・`b.GIT` はそのまま）。最後の `/` か `:` より後ろを名前にする（`https://h/a/b:c.git` → `c`）。`%XX` は decode しない（`%E6%97%A5`）。
   `.bundle` はそのまま（リモートの場合）。query・fragment は名前に残す（`b.git?x=1` → `b.git?x=1`）。ホストだけ（`https://h`・`ssh://h`・
   `git@h:`）はホスト名、`..git` は `.` になる。アプリの規則は git に揃え、`<scheme>://` の形の query・fragment は落とし、ホストだけ・`.`
   になる形は空（利用者が入力する）にする（本文を変更）

## 振る舞い

### 画面（renderer）

- エクスプローラーの `フォルダを開く` / `フォルダを変更` の下に `リポジトリを clone` を置く。clone の実行中と、他の Git 操作の実行中は押せない
  （「フォルダの読み込み中は押せない」は設けない。後述。SRP リファクタで記述を実装に合わせて修正）
- ダイアログ（タグの作成・リモートの追加と同じ共通の入力ダイアログの作り: `aria-modal`、フォーカストラップ、実行中は閉じない）
  - `URL`（必須）。入力のたびに、`getRemoteUrlRuleViolation`（`windowsPaths` は寛容側の `true`。最終判断は main）で検証し、違反は日本語で出す
  - `フォルダ名`（必須）。URL を入力すると、末尾のリポジトリ名を既定値にする（git の既定の名前の規則に揃える。`<scheme>://` の形の
    query・fragment は落とし、ホストだけの URL などは空にする。確認事項 8 の結果で変更）。利用者が編集した後は、URL を変えても上書きしない。
    名前の規則は `@shared/entryName` の `isSafeEntryName`（空は `フォルダ名を入力してください`、それ以外の違反は
    `フォルダ名に使えない文字が含まれています`。`@shared/cloneFolderName` の `getCloneFolderNameViolation`）
  - `保存先を選んで clone`（既定のボタン）と `キャンセル`
- 押したとき: 未保存の変更があれば、`フォルダを変更` と同じ確認（`confirmDiscardAnyDirty`）を出す。キャンセルされたら何もしない。続けて main へ依頼する
  （main が OS のダイアログを出す）
- 実行中は案内 `clone 中です。キャンセルで中止できます（応答が 60 秒途絶えると打ち切ります）`（`role="status"`・`aria-busy`。秒数は
  `GIT_CLONE_IDLE_TIMEOUT_SECONDS` から組み立てる）を出し、入力欄と実行ボタン（表示 `clone 中…`）を無効にし、閉じる経路（Escape・
  オーバーレイ）を塞ぐ。`キャンセル` だけは押せる（キャンセルの意味は「clone を中止する」）。実行が始まったらフォーカスを `キャンセル` へ、
  失敗・中止で解けたら URL の入力欄へ移す（ダイアログの外へ移したフォーカスは奪わない）。OS のダイアログはウィンドウのモーダル（macOS は
  シート）で、開いている間は画面を操作できないため、OS のダイアログで中止する。他の Git 操作の実行中は実行ボタンを押せず、
  `他の Git 操作の実行中は clone できません` を案内する
- 結果
  - 成功（`cloned`）: ダイアログを閉じ、そのフォルダを開く（後述）
  - キャンセル（`canceled`: OS のダイアログの取り消し、または `キャンセル`）: ダイアログは開いたまま、入力を保持する
  - 失敗: ダイアログは開いたまま、エラーを `role="alert"` で出す。入力は保持する
- 開く処理: `useFileSystem.openFolder` を「フォルダの選択」と「選ばれたパスを開く（`applyOpenedFolder(path, { dirtySnapshotAtConfirm })`）」に分け、
  後者を clone の成功後にも使う。世代管理・タブの破棄・ツリーの走査は、今の `openFolder` と同じ。`dirtySnapshotAtConfirm` は未保存の確認をした時点の
  未保存の内容（`useFileSystem.captureDirtySnapshot`。未保存のタブを path 順に並べた `[path, content]` の組の JSON）で、開くときに未保存のタブがあり、
  その内容が確認の時点から変わっていれば（clone の実行中に編集が入った。確認の時点で未保存があったタブをさらに編集した場合や、別のタブを編集した場合を
  含む）、もう一度確認する。未保存の有無（真偽値）だけで比べると、有無が true のまま変わらない編集を確認なしで捨てるため、内容で比べる
  （Task 5 のレビューで変更。当初は `dirtyAtConfirm`（`hasAnyDirtyTab` の真偽値）だった）。`openFolder` は従来どおり、ダイアログが返った時点の未保存の有無で比べる
  （clone は時間がかかる。`openFolder` はダイアログが返った時点の状態を使う従来のまま。確認事項の検討で変更）。ただし clone 中はダイアログの
  オーバーレイが画面全体を覆い、フォーカスもダイアログ内に閉じ込められるため、画面から clone 中にエディタを編集することは実際にはできない。
  この再確認は「画面からは到達しにくい、防御の層」として残す（clone 中に未保存の内容が変わる経路は、ダイアログが画面全体を覆うため今は無い。将来オーバーレイが外れる・別の入口が増えたときのための防御。
  リロードすると renderer の状態が消え clone も中止されるため、リロードの後にこの再確認へ届く経路は無い。ブランチ全体の最終レビューで位置づけを修正）
- 成功・キャンセルでダイアログを閉じたら、`リポジトリを clone` へフォーカスを戻す（clone 中でもなくなった描画の後。`useDialogFocusReturn`）

### main

`gitCloneService.ts`（新規）の `cloneRepository(url, folderName, parentDir, signal, options?)`。

1. 入口の検証（実行前。パターン 94。`assertValidCloneRequest(url, folderName)` に切り出し、IPC ハンドラが OS のダイアログの前にも呼ぶ）
   - `normalizeRemoteUrl` → `getRemoteUrlRuleViolation(url, { windowsPaths })` の違反は日本語の文言に（`REMOTE_URL_RULE_MESSAGES` を再利用する）
   - `folderName` は `@shared/cloneFolderName` の `getCloneFolderNameViolation`（判定は `isSafeEntryName`。`assertValidEntryName` の文言
     `無効な名前です: <name>` ではなく、下のエラーの表の文言にする）
   - `parentDir` は存在するディレクトリの絶対パスであること（`realpath`）
2. 保存先 `<parentDir の実体>/<folderName>` を**再帰しない `mkdir` で作る**（確認事項 7 の結果で変更）。既にあれば（空のフォルダ・ファイル・
   壊れたリンクでも）`EEXIST` で `保存先に同名のフォルダがあります`。存在の確認と作成が 1 回で済み、競合で他のプロセスが作ったフォルダを
   自分のものと取り違えない（git clone は空の既存フォルダへの clone を受け付けるため、「git が拒否することに任せる」では空のフォルダを
   作られる競合で他人のフォルダを削除しうる）
3. 実行: `git -c protocol.ext.allow=never -c protocol.fd.allow=never clone --progress -- <url> <保存先>`（`-c` は git の前。clone の `-c` は
   新しいリポジトリの設定に書き残すため。確認事項 5 の結果で変更。サブモジュールは再帰しない）。simple-git ではなく `child_process.spawn`
   （`gitCloneProcess.ts`。確認事項 3 の結果で変更）
   - 環境: 親の環境に `GIT_TERMINAL_PROMPT=0` だけを足す（`GIT_ASKPASS`・`GIT_SSH_COMMAND` などは設定も削除もしない）
   - 起動: POSIX は `detached: true`（新しいプロセスグループ。制御端末も外れ、ssh のホスト鍵の確認が端末で待たない。確認事項 6）
   - 無出力のタイムアウト: `GIT_CLONE_IDLE_TIMEOUT_MS`（60 秒。`@shared/remoteTimeout`）。標準出力・標準エラーのどちらの出力でも延ばす。
     合計時間の上限は設けない
   - 中止: `signal`（`AbortController`）。中止・タイムアウトのどちらも、プロセスグループごと `SIGTERM`、5 秒後も閉じなければ `SIGKILL`
     （Windows は `taskkill /T /F`）。子プロセスの標準出力・標準エラーが閉じてから（全員が止まってから）結果を返す
   - 標準エラーは末尾の 64KB を残す（進捗で巨大になっても、最後の `fatal:` を失わない）
4. 失敗・中止したら、**自分が作ったフォルダだけ**を削除する（2 で作ったもの。削除の前に、保存先が親フォルダの直下のディレクトリで、
   シンボリックリンクでないことを確かめる）。削除できなければ、文言の後ろに `（途中まで作られた保存先のフォルダを削除できませんでした: <path>）`
   を添える。失敗の文言は `リポジトリを clone できませんでした: <詳細>`（詳細は進捗の行を除いた標準エラーを `redactCredentials` で伏せたもの）。
   中止の要求が届いていれば、git が先に終わっていても削除して `canceled` にする
5. 成功したら、保存先を `realpath` してパスを返す。IPC ハンドラが `FolderAccessManager.set` で登録する。**失敗・キャンセル時は登録を変えない**
   （開いているフォルダはそのまま）。成功の時点でウィンドウが閉じていたら登録せずに `canceled` を返す

IPC（`handlers/cloneHandlers.ts`、新規）

- `git:cloneRepository(url, folderName)` → `{ status: 'cloned', path } | { status: 'canceled' }`
  - 引数は `unknown` で受け、型を検証する（`assertRemoteUrlArg` と同じ流儀。`Invalid remote url` / `Invalid folder name`）。続けて
    `assertValidCloneRequest` で URL とフォルダ名を検証してから OS のダイアログを出す
  - OS のダイアログ（`properties: ['openDirectory', 'createDirectory']`、送信元のウィンドウのモーダル）で親フォルダを選ぶ。取り消しは
    `{ status: 'canceled' }`。ダイアログの表示中に中止された（ウィンドウを閉じた）ら、選ばれても clone へ進まない
  - 1 つのウィンドウ（`event.sender.id`）で同時に 1 つだけ。実行中の再依頼は `既に clone を実行中です` で拒否
- `git:cancelCloneRepository` → 実行中の clone の `AbortController` を中止する。実行中でなければ何もしない（冪等）
- ウィンドウが閉じたら、実行中の clone を中止する。renderer のリロード（メインフレームの別文書への遷移。`did-start-navigation` で
  `isMainFrame && !isSameDocument`）でも中止する。clone を待つ画面が消えた後に成功すると、再読み込み後に開いたフォルダの許可が clone 先へ
  書き換わり、表示中のフォルダの保存・ファイル操作が全て拒否されるため。許可を切り替える直前にも中止を確かめる（防御の 2 層目。ブランチ全体の
  最終レビューで追加）

### 排他

- clone の実行中（OS のダイアログの表示中と、成功の後のフォルダの読み込みが終わるまでを含む）は、`フォルダを開く` / `フォルダを変更` /
  `リポジトリを clone` を押せない。Git 操作は、共有のロック（`useFileOperationLock`）の全体ロック（`lockGlobal`）を clone の間だけ取って
  始めさせない（ロックを見る commit・pull・push・ステージ・ブランチ操作・退避・取り消し・マージ・タグ・初期化・origin の追加）。
  加えて、clone 中のダイアログは閉じられず（`requestClose` が `isCloning` で止める）、オーバーレイ（`.name-input-dialog__overlay`。
  `position: fixed; inset: 0; z-index: 1100`）がウィンドウ全体を覆うため、アクティビティバー・エディタ・ソース管理パネル・
  エクスプローラーは画面から操作できない。フォーカスは `useDialogFocusTrap` でダイアログ内に閉じ込められ、クイックオープン（Cmd+P）も
  `[role="dialog"]` があると開かない。したがって、ロックを見ない fetch とエクスプローラーのファイル操作も、画面からは clone 中に始められない
  （ブランチ全体の最終レビューで記述を事実に合わせて修正。以前は「塞がない（既知の制約）」としていたが、オーバーレイが覆うことを
  見落としていた）。塞がれないのは、メニューバーの操作（View > Reload・アプリの終了・ウィンドウを閉じる操作など）とそのキーボード
  ショートカット。CSS とコードからの判断で、実機では未確認（CLN-027）
- 逆に、Git 操作の実行中は `リポジトリを clone` を押せない（clone が成功するとフォルダが切り替わるため）。「実行中」は、ロック中
  （`isAnyLocked`）か、ロックを取らない操作の実行中フラグ（push・fetch・初回 push・ブランチ操作・退避の削除（drop。`stash.pendingOperation`）・タグの作成・初期化・origin の追加）の
  どれかが真のとき（`useAppState` が `lib/gitOperationActivity.ts` の `isAnyGitOperationRunning` で合成する。退避の削除はロックを取らないため
  実行中フラグで見る。Task 8 のレビューで追加）。合成はロックを含むため clone 自身の全体ロックでも真になるので、画面へ渡す
  `isBlocked`（他の Git 操作の実行中）は `useCloneRepository` が `isGitOperationRunning && !isCloning` にする（clone の実行中は
  `isCloning` が表す。SRP リファクタで、ダイアログ側の補正から hook へ移した）
- 「フォルダの読み込み中は押せない」は設けない（読み込み中を表す状態が無い。`applyOpenedFolder` と `openFolder` は世代の管理で後の操作が勝つ）

## アーキテクチャ

### shared

- `remoteTimeout.ts`: `GIT_CLONE_IDLE_TIMEOUT_MS`（60 秒）を追加
- `cloneFolderName.ts`（新規）: `deriveCloneFolderName(url): string`（URL から既定のフォルダ名を決める純粋関数）。renderer のみが使うが、規則の
  テストを main の URL 形式の網羅と揃えるため shared に置く（パターン 88）。`getCloneFolderNameViolation(name): 'empty' | 'invalid' | null`
  （main と renderer が同じ判定を使い、文言は各側の表で持つ）
- `types/git.ts`: `CloneRepositoryResult = { status: 'cloned'; path: string } | { status: 'canceled' }`

### main

- `gitCloneService.ts`（新規）: 上記の `cloneRepository`・`assertValidCloneRequest`、保存先の作成、失敗時のクリーンアップ、文言
- `gitCloneProcess.ts`（新規）: `runGitCloneProcess`（spawn・無出力のタイムアウト・中止・プロセスグループごとの停止・標準エラーの末尾）
- `cloneRegistry.ts`（新規）: ウィンドウごとの実行中の `AbortController` の登録・中止（1 ウィンドウ 1 つ）。Electron に依存しない
  レジストリだけを持つ
- `cloneLifecycle.ts`（新規）: `setupCloneLifecycle`。ウィンドウを閉じたとき（`destroyed`）とリロード（メインフレームの別文書への
  `did-start-navigation`）に、そのウィンドウの clone を中止する（`folderAccessManager.ts` と `folderAccessLifecycle.ts` の分け方に揃える）
- `handlers/cloneHandlers.ts`（新規）: 2 つの IPC、引数の検証、OS のダイアログ、`FolderAccessManager` への登録
- `ipcHandlers.ts`: `CloneRegistry` を 1 つ作り、`setupCloneLifecycle`（lifecycle）と `registerCloneHandlers`（handler）に渡す。handler には
  ファイル操作と同じ `FolderAccessManager` も渡す
- `dialogService.ts`: 親フォルダを選ぶダイアログ `chooseCloneParentDialog(window)`（`createDirectory` を許可、ウィンドウのモーダル）を追加
- `gitRemoteUrlMessages.ts`（新規）: `REMOTE_URL_RULE_MESSAGES`（URL の規則の違反の文言だけの純粋なモジュール）。`gitRemoteSetupService.ts`
  から移した（clone の service が、simple-git を読み込む兄弟の service に文言のためだけに依存しないため）。`gitRemoteSetupService.ts` は
  ここから import する（変更あり）
- `gitStepErrors.ts`（`failure`・`errorDetail`・`redactCredentials`）・`fsErrors.ts`（`isMissingPathError`）: 再利用（変更なし）
- テスト用 `__tests__/helpers/processProbe.ts`（新規）: 実際の子プロセスを使うテストの補助（`createTestTimers`・`isAlive`・
  `waitUntilDead`・`waitForFile`・`writeFakeExecutable`）。`gitCloneProcess.test.ts` と `gitCloneService.integration.test.ts` が使う

### preload

- `api.ts` / `index.d.ts`: `cloneRepository(url, folderName)`・`cancelCloneRepository()`

### renderer

- `components/explorer/CloneRepositoryDialog.tsx`（新規）: URL・フォルダ名・実行中の表示
- `components/explorer/CloneRepositoryEntry.tsx`（新規）: `リポジトリを clone` のボタンと、ダイアログの開閉（`useDialogFocusReturn`）・
  成功したら閉じる判定・閉じた後のフォーカスの戻し
- `hooks/useCloneRepository.ts`（新規）: 実行中、結果、エラー、キャンセル、排他（ダイアログの開閉は持たない）
- `hooks/useFocusOnRunningStart.ts`（新規）: 実行が始まったとき、フォーカスが body かダイアログの中にあれば `キャンセル` へ移す
  （`useFocusOnRunningEnd` の対）
- `hooks/useFileSystem.ts`: `applyOpenedFolder(path, { dirtySnapshotAtConfirm })` を `openFolder` から切り出し、`captureDirtySnapshot` を公開する
- `lib/dirtySnapshot.ts`（新規）: `toDirtySnapshot(openFiles)`（`captureDirtySnapshot` の直列化。未保存のタブを path の順に並べる）
- `lib/gitOperationActivity.ts`（新規）: `isAnyGitOperationRunning`（Git 操作の実行中の合成。`useAppState` が使う）
- `components/explorer/ExplorerPanel.tsx`: 「フォルダを開く／変更」の 2 つの分岐の同じ位置に `CloneRepositoryEntry` を置く（ボタンは
  `CloneRepositoryEntry` にある）。clone の実行中は「フォルダを開く／変更」を無効にする
- 既存の共通部品を使う: `useDialogFocusTrap`・`useDialogFocusReturn`・`useOverlayDismiss`・`useFocusOnRunningEnd`、
  `.name-input-dialog` 系の CSS（リモートの入力ダイアログと同じ作り。パターン 97）
- `hooks/useAppState.ts`: `useCloneRepository` を組み立て（Git 操作の実行中の合成・ロック・`useFileSystem` の依存を渡す）、`clone` として返す
- `types.ts`: `CloneRepositoryPanelState`（画面へ渡す clone の状態と操作の型）
- `lib/gitApi.ts`: `cloneRepository`・`cancelCloneRepository`（IPC の窓口）
- `App.tsx`・`components/Sidebar.tsx`: `clone` を ExplorerPanel まで受け渡す（props のみ）
- `lib/cloneValidation.ts`（新規）: フォルダ名の検証の文言（renderer 側の表。判定は shared。パターン 88）
- `lib/remoteUrlValidation.ts`（新規）: URL の文言の表と `validateRemoteUrl`（リモートの追加と clone のダイアログで共通。
  `remoteSetupValidation.ts` から移し、残った初期化の検証は `initRepositoryValidation.ts` に改名した）

## エラーハンドリング

| 状況                     | 文言                                                                                  | 備考                                 |
| ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------ |
| URL の規則違反           | `REMOTE_URL_RULE_MESSAGES` のとおり                                                   | URL は含めない                       |
| フォルダ名が空           | `フォルダ名を入力してください`                                                        | 確認事項の検討で追加                 |
| フォルダ名が不正         | `フォルダ名に使えない文字が含まれています`                                            |                                      |
| 親フォルダが見つからない | `保存先の親フォルダが見つかりません`                                                  |                                      |
| 保存先が既にある         | `保存先に同名のフォルダがあります`                                                    | 上書きしない                         |
| 既に clone 中            | `既に clone を実行中です`                                                             |                                      |
| 無出力のタイムアウト     | `clone が時間内に進みませんでした（認証の待ち、または通信の停止の可能性があります）`  | 保存先を削除する                     |
| キャンセル               | （結果 `canceled`）                                                                   | 保存先を削除する                     |
| git の失敗               | `リポジトリを clone できませんでした: <git の詳細>`                                   | 資格情報を伏せる。進捗の行を除く     |
| 保存先を削除できなかった | 上の文言の後ろに `（途中まで作られた保存先のフォルダを削除できませんでした: <path>）` | 中止なら `clone を中止しました（…）` |

## 既知の制約（設計時点。実装で追記する）

ROADMAP の「既知の制約（リポジトリの clone）」と 1 対 1 で対応させる（コードレビューで同期。Windows で「フォルダを変更」の
ダイアログが親ウィンドウ無しで開く問題は、`openFolderDialog` に送信元のウィンドウを渡す修正で解消したため外した）

- 認証が要る https のリポジトリは、credential helper が無いと失敗する（`GIT_TERMINAL_PROMPT=0` のため待たない）。ssh の未知のホスト鍵は、端末が無いと確認できず失敗する。ユーザーの設定は上書きしない
- credential helper の GUI（Git Credential Manager など）が 60 秒以上出力なしで待つと、無出力のタイムアウトで打ち切られる
- `GIT_ASKPASS`（VS Code のターミナルから起動したときの VS Code の askpass など）・`core.askPass`・`SSH_ASKPASS` がある環境では、`GIT_TERMINAL_PROMPT=0` でもそのプログラムが資格情報を求める（上書きしない。応答が無ければ 60 秒で打ち切る）
- パスワード入りの URL・path に `@` を含む URL は、リモートの追加と同じ理由で使えない
- 巨大なリポジトリでも合計時間の上限は無い。止めたいときは `キャンセル`
- clone 中はダイアログのオーバーレイが画面全体を覆うが、メニューバーの操作（View > Reload・アプリの終了・ウィンドウを閉じる操作など）とそのキーボードショートカットは塞がれない（CSS とコードからの判断で、画面の他の操作ができないことは実機で未確認。CLN-027）
- clone 中にアプリを終了すると、保存先に不完全なフォルダが残りうる。macOS でウィンドウを閉じたとき（アプリは終了しない）と、renderer のリロード（メインフレームの別文書への遷移）では clone を中止して保存先を削除する（再読み込み後に開いたフォルダの許可を clone 先へ書き換えないため。許可の切り替えの直前にも中止を確かめる）。Windows・Linux では最後のウィンドウを閉じるとアプリが終了する（`window-all-closed` で `app.quit()`）ため、中止の依頼（SIGTERM・`taskkill` の起動）までは走るが、保存先の削除が終わる前に main が終了し、アプリの終了と同じく残りうる（git は SIGTERM で空のフォルダを残す）
- `gitCloneService.ts` の `!signal.aborted` の確認の後の `await realpath(destination)` の間にリロードが来ると、handler は canceled を返し、完全な clone のフォルダが保存先に残る（データ損失は無く、残ったフォルダは利用者が手で消せる）
- 中止が子プロセスの終了を待つ間は、同じウィンドウからの二重起動は拒否される（`既に clone を実行中です`）
- `applyOpenedFolder` が reject する経路は契約外（実物は例外を握る）で、clone 側ではエラーとしてダイアログに出すだけにしている
- `gitCloneProcess` は、止めた後でも `setsid` したデーモン化する子孫がパイプを持ち続けると `close` が来ず、`isCloning` と全体ロックが再起動まで残りうる（現行の OpenSSH の ControlPersist と credential-cache の daemon は標準エラーを /dev/null へ向けるため、可能性は低い）
- 保存先の親フォルダ自体が clone の最中に symlink へ差し替えられる競合は検知できない（保存先が親の直下にあるかをパスの文字列で比べるため。削除は保存先がフォルダのときだけ行う）
- Windows では、子孫ごとの停止（`taskkill /T /F`）と、ssh のホスト鍵の確認が待たないことは実機で未確認
- 既定のフォルダ名は、query・fragment を落とすなど git の既定の名前と一部違う（利用者は編集できる）
- checkout の失敗（`Clone succeeded, but checkout failed`。LFS の smudge filter の失敗など）でも、clone は失敗として扱い保存先を削除する。git の案内文（`git status` で調べて `git restore --source=HEAD :/` で再試行）はそのまま表示されるが、保存先は削除済みなので無視してよい。LFS の認証などを済ませてからもう一度 clone する（git の出力の文字列で消すとロケールで壊れるため消さない）。実 git 2.50.1 で、失敗する smudge filter を設定して clone すると、終了コード 128 で `warning: Clone succeeded, but checkout failed.`・`You can inspect what was checked out with 'git status'`・`and retry with 'git restore --source=HEAD :/'` の 3 行が出ることを確認した
- Windows では `//host/share/repo` が絶対パスとして許可リストを通り（`@shared/remoteUrl` の `isAbsolutePath` は `/` で始まる形を許可する。リモートの追加から既存の規則）、clone で SMB 接続（NTLM の送出）を起こしうる。入力するのは利用者自身（Windows の実機で未確認）
- Windows の予約名（`CON`・`NUL` など）・`:`・末尾のドットのフォルダ名は検証していない（新規作成・リネームと同じ既存の規則。`getCloneFolderNameViolation` は `isSafeEntryName` だけで判定する）。`:` を含む名前では mkdir の失敗（`ERROR_INVALID_NAME` を libuv が `ENOENT` に変換する）が「保存先の親フォルダが見つかりません」と表示されうる。`foo.` は末尾のドットが落とされて `foo` として作られる。URL が `https://h/CON.git` なら既定のフォルダ名は `CON` になる（Windows の実機で未確認。libuv の対応表からの推定）

## テスト方針

- shared: `deriveCloneFolderName`（実在する形式の URL の表）
- main（実 git）: ローカルの bare リポジトリからの clone（成功、保存先が既存、親が無い、不正な URL、キャンセルでの削除、無出力のタイムアウトで
  削除、資格情報の伏せ字、`folderName` にパス区切り、失敗時に `FolderAccessManager` が変わらない）。タイムアウトの検証は、出力しない偽の
  `git`（PATH 差し替え）で、子プロセスの孤児が残らないことまで確認する
- renderer: ダイアログ（検証、既定のフォルダ名、実行中の閉じる経路、結果ごとの表示、フォーカスの戻り）、`useCloneRepository`、
  `useFileSystem.applyOpenedFolder`、ExplorerPanel の無効化の条件
- 手動テスト仕様: 新しい接頭辞 `CLN-` を `docs/manual-test-spec.md` に追記する

## ドキュメント

- ROADMAP: 「リポジトリの clone」を実装済みに移し、見送り項目・既知の制約を追記する
- `docs/manual-test-spec.md` の追記と Artifact の再公開（CLAUDE.md の共通ルール）
