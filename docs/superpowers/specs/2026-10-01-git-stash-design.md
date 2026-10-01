# Git stash（一時退避 / 復元）設計

対応する ROADMAP 項目（「今後実装した方がよい機能」の「ソース管理（Git）」セクション）:

- stash（一時退避 / 復元）のうち、**退避・一覧・復元（pop）・削除（drop）**

## 背景・現状

ソース管理パネルは、ブランチの切り替え・作成・削除・マージ、コミット、push / pull / fetch、変更の
ファイル単位の取り消しまでアプリ内で完結する。一方、作業中の変更を一時的に脇へ置く手段が無い。
ブランチのマージと checkout は「未コミットの変更がある間は開始しない」または「切り替え先と衝突すると
失敗する」ため、作業中に別のブランチへ移る場面で、外部ターミナルの `git stash` が必要になっている。

## スコープ

含む:

- 作業中の変更（追跡済みの変更・ステージ済みの変更・未追跡ファイル）の退避（`git stash push -u`）。
  メッセージは任意
- 退避の一覧表示（新しい順。メッセージ・ブランチ・日時）
- 退避の復元（pop）。作業ツリーが完全にきれいなときだけ行い、失敗したら元に戻して退避を残す
- 退避の削除（drop。確認ダイアログつき）
- ソース管理パネルの「退避」セクション

含まない（別スコープ）:

- 退避の中身の確認（変更ファイル一覧・差分の表示）
- `apply`（復元しても一覧に残す）、退避からのブランチ作成（`stash branch`）
- ファイル単位・ハンク単位の退避（`stash push -- <path>`）
- 退避のメッセージの後からの編集、ignored のファイルの退避（`-a`）
- 作業ツリーがきれいでないときの復元（衝突の解決 UI とセットで別サイクルで扱う）

## 仕様

### 退避する

1. 「退避」セクション見出しの「退避する」ボタンを押すと、メッセージ入力ダイアログ（既存の
   `NameInputDialog`）を開く。メッセージは**任意**で、空のまま OK してよい。空なら `--message` を付けず、git の
   既定（`WIP on <branch>: <hash> <subject>`）になる
2. 開いているタブに未保存の編集があれば、checkout と同じ確認（既存の `confirmDiscardAnyDirty`）を出す。
   退避でファイルがディスク上で元に戻る（または消える）ため、編集中のバッファと食い違うことを防ぐ。
   キャンセルなら何もしない
3. main 側で退避を実行する（下記「main の判定」）
4. 成功したら、開いているタブをディスクの内容へ再読込し、ステータスと退避一覧を再取得し、ファイルツリーを
   読み直す（未追跡ファイルが消えるため。変更の取り消しと同じ理由）

退避の対象は `git stash push -u`: 追跡済みの変更（ステージ済み・未ステージ）と、未追跡ファイル。
ignored のファイルは対象外で、そのまま残る（実機で確認）。ステージ済みと未ステージの区別も退避に含まれる。

### 退避の一覧

- 「退避」セクション（「変更」の下）に、退避を新しい順（`stash@{0}` が先頭）に表示する。見出しに件数を
  出す（例:「退避（2）」）。0 件のときはセクション自体は表示し、「退避はありません」を出す
- 各行は、表示メッセージ・退避したブランチ・退避した日時（`formatRelativeDate`）を出す。行の右側に
  「戻す」「捨てる」ボタンを置く
- 表示メッセージは、`git stash list` の件名（`%gs`）から組み立てる
  - `On <branch>: <メッセージ>`（メッセージを指定した退避）→ `<メッセージ>`
  - `WIP on <branch>: <hash> <subject>`（メッセージ無しの退避）→ `<subject>`（先頭のハッシュを除く）
  - 上のどちらの形式にも当てはまらない件名は、件名をそのまま表示する
- 退避したブランチ名は同じ件名から取る。detached HEAD で退避すると `(no branch)` になる
- 退避の識別には、番号（`stash@{n}`）ではなく**退避コミットの SHA** を使う。他の操作で退避が増減すると
  番号は別の退避を指すようになるため（下記「main の判定」）

### 戻す（pop）

1. 「戻す」ボタンを押すと、開いているタブに未保存の編集があれば確認（`confirmDiscardAnyDirty`）を出す
2. main 側で復元を実行する。作業ツリーが完全にきれいなときだけ復元できる（下記）
3. 成功したら、開いているタブを再読込し、ステータス・退避一覧・ファイルツリーを再取得する

復元は `git stash apply --index <sha>` で行い、成功したら退避を一覧から消す（`pop` と同じ結果）。
`--index` により、ステージ済みと未ステージの区別まで退避した時点の状態に戻る（実機で確認。付けないと
ステージ済みだった変更が未ステージになる）。

### 捨てる（drop）

- 「捨てる」ボタンを押すと、確認ダイアログ（`<メッセージ> を捨てますか？この操作は元に戻せません。`）を出す。
  退避を捨てると、含まれていた変更・未追跡ファイルは git の通常の手段では取り戻せない
- 承諾されたら、main 側で削除する。作業ツリーには触れないため、エディタとの同期は不要

### main の判定

#### 退避（`stashPush(folderPath, message)`）

次の順に検証する。前の検証に失敗したら後の git 呼び出しには進まない。

1. メッセージが文字列であり、NUL 文字（`\0`）を含まないこと（IPC 境界から届く任意の値のため。
   spawn の引数に NUL は渡せない）
2. 初期コミットがあること（`git rev-parse --verify -q HEAD` に出力があること）。無ければ
   「コミットが無いため退避できません」。git 自身は `You do not have the initial commit yet` で
   失敗する（実機で確認）が、英語のエラーを見せる前に日本語で弾く
3. マージ中などで未解決のファイルが無いこと（`git ls-files -u -z` が空）。あれば
   「コンフリクト中のため退避できません」。git 自身は `needs merge` / `could not write index` で失敗する
4. マージ・cherry-pick・revert の途中でないこと（`MERGE_HEAD` / `CHERRY_PICK_HEAD` / `REVERT_HEAD` の
   いずれも `git rev-parse --verify -q <名前>` で存在しないこと）。あれば
   「マージ・cherry-pick・revert の途中のため退避できません」。コンフリクトを解決してステージした後は
   手順 3 の `ls-files -u` に現れないが、そのまま退避すると**成功して `MERGE_HEAD` 等が消え、「途中」の状態が
   黙って失われる**（実機で確認。解決した内容は退避に残るが、後で戻してコミットすると親が 1 つの普通のコミットに
   なる）。検証の順序は 初期コミット → コンフリクト → 途中の操作 → 変更の有無
5. 退避する変更があること（`git status --porcelain -z --untracked-files=all --ignore-submodules=all` に出力が
   あること）。無ければ「退避する変更がありません」。サブモジュールの変更は `stash push` が扱わず、
   `status` はサブモジュールの変更だけでも変更ありと報告する（終了コード 0 で `No local changes to save`
   になり、何も退避されないのに成功を返してしまう）ため、`--ignore-submodules=all` で stash の判定と揃える。**git は変更が無くても終了コード 0 で `No local changes to save` と言う**
   （実機で確認）ため、出力の文言ではなく事前の状態で判定する（パターン 28）
6. `git stash push -u [--message=<message>]` を実行する（メッセージが空・空白だけなら付けない）。
   `-m <message>` の 2 引数ではなく `--message=<message>` の 1 引数にするのは、simple-git の
   `blockUnsafeOperationsPlugin` が引数列の中の `--upload-pack=...` / `--receive-pack=...` /
   `--template=...` / `-c core.pager=...` / `-ccore.sshCommand=...` を、**値であってもオプションとして
   検出して拒否する**ため（git には渡らず安全性の問題ではないが、そのようなメッセージの退避が英語のエラーで
   失敗する。パターン 21・41）。1 引数にすれば `-` で始まるメッセージも含め、件名としてそのまま残る
   （実機で確認）。コミッター情報が無いときは git が作業ツリーを変えずに失敗する（実機で確認）ので、
   git のエラーをそのまま投げる

#### 復元（`stashPop(folderPath, sha)`）

1. `sha` が 40 桁の 16 進数であること（IPC 境界の型・形式の検証。パターン 21）
2. `sha` が**現在の退避一覧（`git stash list`）に存在する**こと。無ければ
   「退避が見つかりません（すでに削除された可能性があります）」。**git は、すでに捨てた退避の SHA でも
   `stash apply <sha>` で復元できてしまう**（ぶら下がったコミットが残っている間。実機で確認）ため、
   一覧で許可リスト方式の検証を行う。これを怠ると、捨てたはずの退避が復活し、その後の `drop` が
   見つけられなくなる
3. 作業ツリーが**完全にきれい**であること（`git status --porcelain -z --untracked-files=all --ignore-submodules=all` が空）。
   無ければ「作業中の変更があるため戻せません。先にコミットまたは退避してください」
4. **マージ・cherry-pick・revert の途中でない**こと（`MERGE_HEAD` / `CHERRY_PICK_HEAD` / `REVERT_HEAD` が無い。
   退避の `assertStashable` と同じ `hasInProgressOperation`）。あれば「マージ・cherry-pick・revert の途中のため
   戻せません」。コンフリクトを `git checkout --ours f && git add f` で解決した後は status も `ls-files -u` も空だが
   `MERGE_HEAD` は残る。ここで復元に失敗すると巻き戻しの `reset --hard` が `MERGE_HEAD` を消し、解決途中のマージが
   黙って失われる（成功しても途中のマージに退避の変更が混ざる）。検証の順序は status → 途中の操作 → assume-unchanged
5. **assume-unchanged を付けたファイルが無い**こと（`git ls-files -v -z` の各エントリ `<タグ> <パス>` の先頭の
   タグが小文字なら assume-unchanged）。あれば「assume-unchanged を付けたファイルがあるため戻せません（失敗した
   ときの巻き戻しでそのファイルの変更が失われるおそれがあります）」。assume-unchanged のファイルの変更は
   status に出ず、手順 3 では見えないのに、失敗時の `reset --hard` が HEAD の内容に戻して消す（実機で確認）。
   skip-worktree（タグは大文字の `S`）の変更は `reset --hard` で消えないため、拒否しない（実機で確認）
6. `git stash apply --index <sha>` を実行する
   - 成功したら、一覧から `sha` の現在の番号を引き直して `git stash drop stash@{n}` を実行する。この drop が
     失敗しても（SHA 不一致での再保存、別プロセスが先に drop、git の失敗）、復元は済んでいるため、
     「退避は戻しましたが、一覧から削除できませんでした。不要なら「捨てる」で削除してください」を
     **例外ではなく結果 `{ status: 'dropFailed', message }` で返す**（下記「戻り値」）
   - 失敗したら（コンフリクト、同名の ignored ファイルがある、等）、`git reset --hard --no-recurse-submodules` と
     `git clean -fd` で作業ツリーを元に戻し、日本語のエラーを投げる。**退避は残す**（`apply` は退避を消さない）。未解決
     ファイルの取得（`diff`）が失敗しても巻き戻しは必ず試み、`reset` が失敗しても `clean` も試みる。巻き戻しが
     失敗したときは「退避を戻せず、元に戻す処理にも失敗しました。作業ツリーに途中の変更が残っている可能性が
     あります。退避は残っています」を**結果 `{ status: 'rollbackFailed', message }` で返す**（下記「戻り値」）

**戻り値（`StashPopResult`。`src/shared/types/git.ts`。このレビュー対応で `Promise<void>` から変更した）:**
`{ status: 'restored' } | { status: 'dropFailed' | 'rollbackFailed'; message: string }`。事前検証の失敗と、
巻き戻しに成功した apply の失敗は従来どおり例外（作業ツリーは変わっていない）。作業ツリーが**変わったうえで**
警告が要るケース（apply 成功後の drop 失敗、巻き戻し失敗）だけを結果で返す。renderer は例外のときにタブを
再読込しない（未保存編集を守る）ため、変わった場合だけ成功扱いにして再読込させる必要がある。`cause` は IPC を
渡れないので結果に含めない

「完全にきれい」を要求する理由: 失敗時の巻き戻し（`reset --hard` と `clean -fd`）は作業ツリーの未コミットの
変更・未追跡ファイルを消すため、実行前にそれらが無いことが保証されていなければ安全に使えない。ツリーが
きれいなら、失うものは無い。`--no-recurse-submodules` を付けるのは、事前の status が `--ignore-submodules=all` で
サブモジュール内の変更を見ないため、ユーザー設定の `submodule.recurse=true` だと `reset --hard` が
サブモジュールの中まで戻してローカル変更を消すから（実機で確認。`clean -fd` はこの設定でも中身を消さない）。（`clean -fd` は ignored のファイルに触れない。status に出ない assume-unchanged の変更は手順 4 で拒否して守る）。

#### 削除（`stashDrop(folderPath, sha)`）

1. `sha` の形式（40 桁の 16 進数）と、現在の退避一覧に存在することを検証する（復元と同じ検証）
2. 一覧での `sha` の位置から `stash@{n}` を決めて `git stash drop stash@{n}` を実行する
3. git が出力する `Dropped stash@{n} (<sha>)` の `<sha>` が、要求した `sha` と一致することを確認する。
   一致しなければ（検索と削除の間に退避が増減した）、誤って削除した退避を
   `git stash store --message=<メッセージ> <誤って削除した sha>` で一覧に戻し、エラーを投げる

退避の番号ではなく SHA で識別し、実行時に番号を引き直すのは、番号が他の操作（別の退避の追加・削除、
外部ターミナルからの操作）でずれると、**別の退避を戻したり捨てたりする**ため。

#### 一覧（`getStashes(folderPath)`）

- `git stash list -z --format=%H%x00%gs%x00%cI` の出力を、NUL 区切りで解析する。simple-git の
  `stashList()` の解析結果には依存しない（解析形式が git の出力の特殊な場合を覆わない可能性があるため。
  パターン 44）。各レコードは SHA・件名・ISO 8601 の日時
- 一覧の解析と、件名からの「表示メッセージ・ブランチ」の取り出しは、純粋関数（`gitStashParser.ts`）に
  分ける（`gitLogFormatter.ts` / `gitMergeMessages.ts` と同じ位置づけ）。件名に改行が含まれる場合は、git が
  空白に置き換える（実機で確認）
- 退避が無いときは空配列を返す（`git stash list` は何も出力しない）

### 実機で確認した git の挙動（git 2.50.1）

- `git stash push -u` は、追跡済みの変更・ステージ済みの変更・未追跡ファイル（新しいディレクトリ配下を含む）を
  退避し、作業ツリーを HEAD の内容へ戻す。ignored のファイルは対象外で残る
- 変更が無いとき（ignored の変更だけのときも）は、終了コード 0 で `No local changes to save` と出力する
- 初期コミットが無い状態では、終了コード 1 で `You do not have the initial commit yet`。コンフリクト中は
  終了コード 1 で `needs merge`。detached HEAD では成功し、件名は `On (no branch): <メッセージ>`
- `--message=<値>` の値が `-` で始まっていても、メッセージとして扱われる。改行を含むメッセージは、一覧の件名では空白に
  置き換わる。空のメッセージ（git に `--message=` を渡した場合。アプリは空なら `--message` 自体を付けない）はメッセージ無しと同じ件名（`WIP on …`）になる
- サブモジュールの中だけを変更した場合も、サブモジュールに新しいコミットを作った場合も、
  `status --porcelain` は ` M sub`（変更あり）だが、`stash push -u` は終了コード 0 で
  `No local changes to save`（退避は作られない）。`status --ignore-submodules=all` なら空になる
- `merge --no-commit --no-ff` の後（コンフリクト無し・ステージ済み）や、cherry-pick / revert でコンフリクトを
  解決して `add` した後は、`ls-files -u` が空で `stash push -u` が成功し、`MERGE_HEAD` / `CHERRY_PICK_HEAD` /
  `REVERT_HEAD` が消える。解決した内容は退避に残る
- simple-git の `blockUnsafeOperationsPlugin` は、`raw()` の引数列に `--upload-pack=...` / `--template=...` /
  `-c core.pager=...` / `-ccore.sshCommand=...` があると、値であっても `GitPluginError` で拒否する
  （`-m <値>` の 2 引数形式で値が `--upload-pack=x` だと拒否される。誤検知のため、アプリは `--message=<値>` の 1 引数にしており、これなら通る）
- `git stash list --format=%H|%gd|%gs|%cI` で SHA・番号・件名・日時が取れる。件名は `On <branch>: <メッセージ>`
  または `WIP on <branch>: <hash> <subject>`
- `git stash apply <sha>` は、退避コミットの SHA を直接指定できる。未追跡ファイルも復元する。
  **すでに `drop` した SHA（ぶら下がったコミット）でも復元できる**
- `apply --index` を付けると、ステージ済み（`M `）・未ステージ（` M`）・新規ファイルのステージ（`A `）が
  退避前と同じに戻る。付けないと、ステージ済みだった変更が未ステージ（` M`）になる
- コンフリクトで `apply` が失敗すると終了コード 1 で、`UU` とマーカー入りのファイルが残る。未追跡ファイルは
  復元される。`git reset --hard` と `git clean -fd` で作業ツリーは完全にきれいに戻り（ignored のファイルは
  触れない）、退避は残る
- 退避に含まれる未追跡ファイルと同じパスに、ignored のファイルがある場合、`apply` は**黙って上書きせず**失敗する
  （終了コード 1。ignored のファイルは元の内容のまま残る。追跡済みの変更は一部適用されるので、巻き戻しが要る）。
  マージが ignored のファイルを黙って上書きしたのとは違う、安全側の動作
- `git update-index --assume-unchanged` を付けたファイルを編集しても `status` は空（きれいと判定される）。その状態で
  別のファイルのコンフリクトにより `apply --index` が失敗して `reset --hard` を実行すると、編集内容が HEAD の
  内容に戻って消える。`ls-files -v -z` は `<タグ> <パス>` を NUL 区切りで返し、assume-unchanged は小文字（`h`）、
  通常は `H`、skip-worktree は `S`。skip-worktree の変更は `reset --hard` で消えない
- `git clean -fd` は、元からあった空のディレクトリ（status に現れない）も消す
- `submodule.recurse=true` の設定下では、`git reset --hard` がサブモジュールの中まで戻し、サブモジュール内の
  ローカル変更が消える。`git reset --hard --no-recurse-submodules` なら残る。`git clean -fd` は影響を受けない
- `git stash drop stash@{n}` は `Dropped stash@{n} (<sha>)` を出力する（`<sha>` で削除した退避を確認できる）
- `commit.gpgsign=true` で署名できない設定でも、`stash push` は成功する（退避コミットは署名されない）
- コミッター情報が無いと `fatal: empty ident name` で失敗し、作業ツリーは変わらない

### 実行中・他操作中の表示

- 「退避する」ボタンと各行の「戻す」「捨てる」ボタンは、他の操作中（`isBlockedByOtherOperation`: ステージ操作・
  ハンク操作・commit・pull・checkout・作成・マージのいずれか）と、リポジトリが無いとき、退避操作の実行中に
  disabled にする（既存の push / pull / ブランチ操作と同じ扱い）
- 実行中は、押したボタンの表示とアクセシブルネームを切り替える

| 状態         | 表示テキスト | `aria-label` |
| ------------ | ------------ | ------------ |
| 退避の実行中 | 退避中...    | 退避中       |
| 復元の実行中 | 戻し中...    | 退避を戻し中 |
| 削除の実行中 | 削除中...    | 退避を削除中 |

### キーボード操作・アクセシビリティ

- 「退避」セクションは `<section>` と見出し（`<h3>`）で、既存の「変更」「履歴」と同じ作りにする
- 「退避する」「戻す」「捨てる」は通常の `<button>`（Tab 停止点）で、`aria-label` を付ける
  - 「退避する」: `変更を退避する`
  - 「戻す」: `退避 <メッセージ> を戻す`
  - 「捨てる」: `退避 <メッセージ> を捨てる`
- 一覧は `<ul>`/`<li>` とし、行ごとに `key` は退避の SHA（番号や表示メッセージは使わない）
- ボタンのタップ領域は、ブランチ一覧のボタンと同じく 32px × 32px 以上を確保する（タッチ操作を前提とする
  アプリのコンセプトのため。ホバー時だけ表示する作りにはしない）
- メッセージ入力ダイアログを閉じたとき（OK・キャンセル・Escape・オーバーレイクリックのいずれも）は、
  「退避する」ボタンへフォーカスを戻す

### エラーハンドリング

main 側のエラーはすべて日本語メッセージにして投げ（作業ツリーが変わったうえで警告が要る復元の 2 件だけは、
例外ではなく `StashPopResult` の message で返し、renderer が `stashOperationError` に出す）、退避セクション内の `role="alert"` の
`<p>` に表示する。

- メッセージが不正（文字列でない・NUL を含む）: 「メッセージに使用できない文字が含まれています」
- 初期コミットが無い: 「コミットが無いため退避できません」
- コンフリクト中: 「コンフリクト中のため退避できません」
- 退避する変更が無い: 「退避する変更がありません」
- マージ・cherry-pick・revert の途中: 「マージ・cherry-pick・revert の途中のため退避できません」
- 退避が見つからない（形式不正・一覧に無い）: 「退避が見つかりません（すでに削除された可能性があります）」
- 作業ツリーがきれいでない: 「作業中の変更があるため戻せません。先にコミットまたは退避してください」
- assume-unchanged のファイルがある: 「assume-unchanged を付けたファイルがあるため戻せません（失敗したときの巻き戻しでそのファイルの変更が失われるおそれがあります）」
- マージ・cherry-pick・revert の途中（復元）: 「マージ・cherry-pick・revert の途中のため戻せません」
- 復元は成功したが一覧からの削除に失敗した（結果 `dropFailed` の message）: 「退避は戻しましたが、一覧から削除できませんでした。不要なら「捨てる」で削除してください」
- 復元に失敗し、元に戻す処理にも失敗した（結果 `rollbackFailed` の message）: 「退避を戻せず、元に戻す処理にも失敗しました。作業ツリーに途中の変更が残っている可能性があります。退避は残っています」
- 復元に失敗して元に戻した: 「退避を戻せなかったため元に戻しました。退避は残っています（コンフリクト: <ファイル一覧>）」
  （コンフリクトが無いときは「（同名のファイルがあるなど、git が復元を完了できませんでした）」。ファイルは 5 件まで、
  超えたら「ほか N 件」。マージのコンフリクトの表示と同じ書式。git のエラー文は status の出力のような長い文章で
  原因が分からないため添えない）
- 削除で別の退避を削除してしまった: 「退避の状態が変わったため削除をやり直しました。もう一度操作してください」
- git が作業ツリーを変えずに失敗した場合（コミッター情報が無い等）は、git のエラーをそのまま投げる
- 成功時は、既存の `useRunExclusiveGitOperation` の挙動でエラーをクリアする。ただし `dropFailed` / `rollbackFailed` は
  `popStash` が true（再読込が要る）を返したうえで、`runOperation` の完了後に message を `stashOperationError` にセットする
  （`runOperation` は execute 成功時に `setError(null)` するため、その後でないと警告が消える）

### 既知の制約

- 復元の「ツリーがきれいか」の確認と `apply` の間に、外部のプロセスが作業ツリーへファイルを作ると、失敗時の
  巻き戻しがそのファイルも消す。アプリ内の操作とは `lockGlobal` で排他にするが、外部プロセスとの競合は
  防げない（マージの事前確認と実行の間の競合と同じ）
- ignored のファイルは退避されない。退避後にブランチを切り替えて ignored のファイルが変わっても、復元は
  それを上書きせず失敗する（失敗時は巻き戻す）
- 退避の識別に使う SHA は、`git stash list` に存在している間だけ有効。外部ターミナルで同時に操作すると、
  「退避が見つかりません」になることがある
- サブモジュールの変更は扱わない（退避されず、サブモジュールの変更だけなら「退避する変更がありません」）
- 入れ子の未追跡 git リポジトリ（サブモジュールではない `nested/.git`）だけがあると、`status` は `?? nested/` を出し、
  `git stash push -u` は `Ignoring path nested/` と出しつつ終了コード 0 で退避を 1 件作る（nested は作業ツリーに
  残る。データは失われない）
- 退避した未追跡ファイルのパスが、その後 `.gitignore` の追加で ignored になっていると、「戻す」が失敗して
  巻き戻した後も、復元の途中で作られたそのファイルが ignored のまま残る（`clean -fd` は ignored を消さない）。
  以後、原因を除いても「戻す」が「同名のファイルがあるなど」で失敗し続けるため、手動でそのファイルを削除する
  必要がある。データは失われない。巻き戻しで退避由来のパスだけを `clean -fdx -- <paths>` で消す対応は今後の課題
- 退避した時点でステージしていたファイルが、その後 HEAD で変わると、`apply --index` が失敗して戻せない
  （作業ツリーは変わらず、退避は残る）。エラー文言は「同名のファイルがあるなど」と原因が合わない場合がある。
  `--index` なしでの再試行は今後の課題
- 退避・戻すの実行中に、アプリ内の保存（Cmd+S）ができてしまう（`saveFile` がロックを見ない。既存のブランチ切り替えと
  同じ種類の競合）。戻すが失敗したときの巻き戻しで保存した内容が消える、または退避にも作業ツリーにも残らない場合がある
- `git clean -fd` は、元からあった空のディレクトリ（status に現れない）も、失敗時の巻き戻しで消す（実機で確認）。
  データは失われない
- SHA256 のリポジトリ（`git init --object-format=sha256`、64 桁の SHA）では、SHA の形式検証（40 桁の 16 進数）に
  より復元・削除は常に「退避が見つかりません」になる（データ損失は無く安全側。対応しない）
- 削除で別の退避を誤って消した後の再保存（`stash store`）が失敗すると、その退避は一覧から消えたままになる。
  `stashPop` の drop の失敗の文言（「退避は戻しましたが…」）ではその事実が伝わらない（競合の時間幅が極小の
  ときだけ）
- `core.ignoreStat=true` のリポジトリでは `git add` したファイルが自動で assume-unchanged（`h`）になるため、
  復元は常に拒否される（変更が見えない以上は正しい挙動）
- 復元の assume-unchanged の確認は `ls-files -v -z` の出力全体を読み込むため、巨大なリポジトリではそのぶんの
  コストがかかる（復元は頻繁な操作ではない）
- skip-worktree と assume-unchanged が両方付いたファイル（タグ `s`）は、変更が `reset --hard` で消えないが
  拒否される（安全側）
- 削除で別の退避を誤って消した場合の再保存（`stash store`）は、件名のブランチ情報が落ちる（`On main: ` の部分が
  付かない）ことと、一覧の先頭に入ることが起きる（競合の時間幅が極小のときだけ。表示のみ）
- intent-to-add（`git add -N`）のファイルがあると、git が `Entry … not uptodate. Cannot merge.` で失敗し、
  その英語のエラーがそのまま表示される（データは失われない）
- `core.autocrlf` で改行だけが違うファイルは、退避が作られても作業ツリーの改行は変わらない
- 大量の未追跡ファイル（巨大なディレクトリ）がある状態での退避は、時間がかかる
- Electron が IPC のエラーメッセージに付ける英語の前置きが、日本語のメッセージの前に表示される
  （ROADMAP に記載済みの、全ての IPC 操作に共通する既存の挙動）

## アーキテクチャ

### main プロセス（`src/main/gitStashService.ts` ほか）

- `src/main/gitStashParser.ts`（新規）: `git stash list -z` の出力の解析と、件名からの表示メッセージ・
  ブランチの取り出し（純粋関数。`parseStashList` / `parseStashSubject`）
- `src/main/gitStashMessages.ts`（新規）: 復元の失敗メッセージの組み立て（`buildStashRestoreFailureMessage`。
  コンフリクトのファイル一覧の整形は、マージと共通の `formatConflictFiles`（`gitMergeMessages.ts`）を再利用）
- `src/main/gitStashService.ts`（新規。リファクタリングで `gitService.ts` から分離）: `getStashes` / `stashPush` / `stashPop` / `stashDrop`
  と、実行側の内部関数（`listStashes` / `findExistingStash` / `applyOrRollback` / `readConflictedPaths` /
  `rollbackToCleanTree` / `dropStashBySha`）
  - `applyOrRollback(git, sha)`: `apply --index` → 失敗なら未解決ファイルの収集（`readConflictedPaths`）と
    巻き戻し（`rollbackToCleanTree`: `reset --hard --no-recurse-submodules` + `clean -fd`）を行い、エラーを選ぶ
- `src/main/gitStashGuards.ts`（新規）: 事前検証だけを持つ。`assertStashable(git)`（初期コミット・コンフリクト中・
  途中の操作・変更の有無）、`assertRestorable(git)`（ツリーがきれい・途中の操作が無い・assume-unchanged が無い）。途中の操作の判定 `hasInProgressOperation`
  （MERGE_HEAD / CHERRY_PICK_HEAD / REVERT_HEAD のいずれか）も単体でテストするため export する。status の判定
  （`--ignore-submodules=all`）は非公開の `readStashRelevantStatus` に集約し、退避と復元で同じ判定を使う。
  SHA の形式・一覧に存在するかは `gitStashService.ts` の `findExistingStash`（一覧と位置を返す。`findStashIndex(stashes, sha)` を使う）
- `src/main/gitPathParsing.ts`（新規）: NUL 区切りのパス一覧の解析（`parseNulSeparatedPaths`。`gitService.ts` と共有）
- ローカルの操作でネットワーク I/O を伴わないため、`simpleGitWithRemoteTimeout` は使わない

### IPC（`src/main/handlers/gitHandlers.ts`）

- `git:getStashes`、`git:stashPush`（引数 `message: unknown`）、`git:stashPop`（引数 `sha: unknown`。戻り値は
  `StashPopResult` をそのまま返す）、
  `git:stashDrop`（引数 `sha: unknown`）。フォルダの許可確認の後に、引数の型を検証してから service を呼ぶ

### preload / renderer lib

- `src/preload/api.ts` / `src/preload/index.d.ts` / `src/renderer/src/lib/gitApi.ts` に `getStashes` /
  `stashPush(message)` / `stashPop(sha): Promise<StashPopResult>` / `stashDrop(sha)` を追加する
- `src/renderer/src/lib/stashConfirmMessage.ts`（新規）: 削除の確認文言の組み立て
- `src/renderer/src/lib/stashDisplayName.ts`（新規。リファクタリングで分離）: メッセージが空のときの表示名（`getStashDisplayName`）
- `src/shared/types.ts`: `GitStashEntry`（`sha` / `message` / `branch` / `createdAt`）

### renderer フック

- `src/renderer/src/hooks/useGitStashes.ts`（新規）: 退避一覧の取得・保持（フォルダを開いたとき、各操作の後に
  再取得）。操作の実行は担わない（`useGitHistory` と同じ責務の切り方）
- `src/renderer/src/hooks/useGitStashOperations.ts`（新規）: 退避・復元・削除の実行。ブランチ操作と同じ
  排他制御（自分の busy ref + `lock.isAnyLocked()` + リポジトリの有無）。退避・復元は作業ツリーを書き換えるため
  `lockGlobal` を取る（実行中の push / ステージ操作 / ブランチ操作を待たせる）。削除は取らない。
  `StashOperationKind = 'push' | 'pop' | 'drop'` を `pendingStashOperation` として公開する
- `src/renderer/src/hooks/useStashPanel.ts`（新規。リファクタリングで `useAppState.ts` から分離。`useAppState` は 1 回呼ぶだけ）: 退避・復元のラッパーを、`runEditorSyncedOperation` で組み立てる
  （未保存編集の確認 → 操作 → 成功時のみタブ再読込。成功後はファイルツリーも読み直す）。失敗時は再読込しない
  （`runEditorSyncedOperation` は変更しない）。復元の `dropFailed` / `rollbackFailed` は作業ツリーが変わっているため、
  `useGitStashOperations.popStash` が true を返して再読込させる（以前は `reloadOnFailure` で失敗時も再読込していたが、
  事前検証の失敗でも未保存編集が破棄されるため、このレビュー対応で結果型に置き換えた）

### renderer コンポーネント

- `StashSection.tsx`（新規）: 「退避」セクション全体（見出し・件数・「退避する」ボタン・一覧・空表示）。
  一覧の 1 行は `StashItem.tsx`（新規。表示メッセージ・ブランチ・日時・「戻す」「捨てる」）
- `StashMessageDialog.tsx`（新規）: メッセージ入力ダイアログ。`NameInputDialog` を流用し、`validate` に
  **空を許可する**検証（NUL を含まないこと）を差し込む（`NameInputDialog` は `validate` が渡されたとき
  既定の「空は不可」の検証を使わないため、`NameInputDialog` 自体の変更は不要。`CreateBranchDialog` と
  同じ使い方）。開閉状態とフォーカスの戻し先は呼び出し元の責務
- `GitRepoView` / `SourceControlPanel` / `Sidebar` / `App`: 退避の Props を配線する。props の増え方に注意し、
  退避に関する値は `stash` オブジェクト 1 つにまとめて渡す（`entries` / `pendingOperation` / `error` / `onPush` /
  `onPop` / `onDrop`）。既存のブランチ操作の props のように 1 つずつ増やさない

## テスト方針

- `gitStashParser.test.ts`: `parseStashList`（空・複数件・NUL 区切りの境界・件名に空白や `:` を含む）、
  `parseStashSubject`（`On <branch>: <msg>`・`WIP on <branch>: <hash> <subject>`・`(no branch)`・
  どちらにも当てはまらない件名・メッセージに `: ` を含む）
- `gitStashMessages.test.ts`: 復元失敗メッセージ（コンフリクトあり・なし、5 件超、detail 空）
- `gitStashGuards.test.ts`（`raw` だけのスタブ）: 各検証の拒否と順序、status の引数、assume-unchanged の判定。
  `gitPathParsing.test.ts`: NUL 区切りのパスの解析
- `gitStashService.test.ts`（simple-git をモック）: 検証の詳細は `gitStashGuards.test.ts` に任せ、ここでは
  guards が拒否したら後続の git（`stash push` / `apply`）を呼ばないこと（代表 1 ケース）、SHA の形式 → 一覧に存在 →
  guards の順序、実行する引数（`['stash','push','-u','--message=<msg>']` の 1 引数形式、空メッセージでは `--message` を
  付けない、`apply --index <sha>`、`stash store --message=<msg>`）、復元の失敗時に `reset --hard`（引数
  `--no-recurse-submodules`）と `clean -fd` が呼ばれて退避が残ること（`diff` の失敗・`reset`/`clean` の失敗でも
  巻き戻しを試みて日本語のエラーにすること）、`apply` 失敗の `cause`、pop 成功後の drop の失敗が `dropFailed`・巻き戻しの失敗が `rollbackFailed` の結果で返ること、削除の SHA 不一致での再保存
- `gitStashService.integration.test.ts`（新規、実 git。`gitStashService` を対象にする。`gitService.merge.integration.test.ts` と同じく
  グローバル設定・ロケール・ref 形式から切り離す）: 退避（追跡済み・ステージ済み・未追跡・ignored が残ること）、
  変更が無いときの拒否、コミット無し・コンフリクト中の拒否、途中の操作（merge / cherry-pick）の拒否、
  サブモジュール（中だけの変更は拒否、外も変更していれば退避でき、サブモジュールの中だけが変更されていても復元できる）、
  危険なオプション風メッセージ（`--upload-pack=x` 等）、未追跡だけの退避、`-` で始まるメッセージ、復元（ステージ状態の
  再現・未追跡の復元）、復元のコンフリクトでの巻き戻しと退避が残ること、作業ツリーがきれいでないときの拒否、
  ignored との衝突での失敗と巻き戻し、assume-unchanged のファイルがあるときの拒否（内容が変わらないこと）と
  skip-worktree では復元できること、`submodule.recurse=true` でも巻き戻しでサブモジュール内のローカル変更が消えないこと、すでに捨てた SHA での復元が拒否されること、drop、番号がずれても SHA で
  正しい退避を操作すること
- `gitHandlers.test.ts` / `api.test.ts`: 引数の検証と配線（SHA の形式、メッセージの型）
- `useGitStashes.test.ts` / `useGitStashOperations.test.ts`: 排他（他の操作中は呼ばない）、`lockGlobal` を取る/
  取らない、実行中の表示、失敗時のエラー、確認（削除）のキャンセル。ガード条件ごとの検証は他の条件が
  偶然真にならないモックロックで行い、退避・復元・削除の 3 操作と、ブランチ操作との相互排他を `it.each` で固定する
- `useStashPanel.test.ts`: 未保存編集の確認、成功時だけ再読込・ファイルツリーの再読込（復元も、失敗（false）では再読込しない。
  `dropFailed` / `rollbackFailed` は true なので再読込する）。
  `useAppState.test.ts` は `useStashPanel` の呼び出しと公開だけ
- コンポーネントのテスト: `StashSection` / `StashItem`（0 件の表示、行のボタンの `aria-label`、実行中の表示、
  disabled）、`StashMessageDialog`（空を許可する、NUL を拒否する、フォーカスの戻り）
- 各修正は TDD で行い、実装を戻すと該当テストが落ちること（ミューテーション）を確認する
- Electron 実機で、退避・一覧・復元・コンフリクトでの巻き戻し・削除、未保存編集の確認、ブランチ切り替えとの
  組み合わせを確認する

## 実装順序

1. 型定義、`gitStashParser.ts`、`gitStashMessages.ts`（純粋関数とそのテスト）
2. `gitStashService` の `getStashes` / `stashPush` / `stashPop` / `stashDrop` と統合テスト
3. IPC ハンドラー・preload・`gitApi`
4. `useGitStashes` / `useGitStashOperations`
5. `useStashPanel` の組み立てと `useAppState` の配線
6. `StashSection` / `StashItem` / `StashMessageDialog` と、`GitRepoView` 以下の配線
7. ROADMAP の更新（「stash」を実装済みへ移す）
