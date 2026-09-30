# Git ブランチのマージ 設計

対応する ROADMAP 項目（「今後実装した方がよい機能」の「ソース管理（Git）」セクション）:

- ブランチのマージ（表示・切り替え・作成・削除は実装済み）

## 背景・現状

ブランチの表示・切り替え・作成・削除は、ソース管理パネルのブランチスイッチャー
（`BranchSwitcher` / `BranchSwitcherMenu` / `BranchMenuItem`）から行える。操作は
`gitService` → IPC（`gitHandlers.ts`）→ `gitApi` → `useGitBranchOperations`（排他制御・
`lockGlobal`）→ `useAppState` のラッパー（未保存編集の破棄確認・成功時のみ `reloadOpenFiles`）
という経路で動く。

一方、作業ブランチの内容を別のブランチへ取り込むマージはできず、そのたびに外部ターミナルへ
抜ける必要がある。ブランチの作成・削除まではアプリ内で完結するようになったため、
「別画面を開かずタッチ操作だけで開発フローを完結する」というコンセプトに対して、次に欠けている
ブランチ操作である。

## スコープ

含む:

- ローカルブランチを、現在のブランチへマージする（`git merge --no-edit <branch>`）
- ブランチスイッチャーのメニューの各行（現在ブランチ以外）に置くマージボタンと、`M` キー
- 実行前の確認ダイアログ（未保存のエディタ編集がある場合は、その破棄の確認も含む）
- コンフリクトが起きたときの自動中止（`git merge --abort`）と、対象ファイルを示すエラー表示
- マージ成功後の、開いているタブの再読込と、ステータス・履歴の再取得

含まない（別スコープ）:

- マージ方式の選択（`--no-ff` / `--squash` / `--ff-only`）。git の既定に任せる
- コンフリクトの解決 UI（ROADMAP の「マージコンフリクトの解決 UI」。今回は自動で中止する）
- リモートブランチのマージ、マージコミットのメッセージ編集
- マージ済みかどうかの表示（メニューにマージ済みの印を付ける等）

## 仕様

### マージの流れ

1. ブランチスイッチャーのメニューで、対象ブランチの行のマージボタンを押す（または radio に
   フォーカスして `M` キー）
2. 開いているタブに未保存の編集があれば、checkout と同じ確認（既存の
   `confirmDiscardAnyDirty`）を出す。キャンセルなら何もしない
3. マージの確認ダイアログを出す。キャンセルなら何もしない

   > `<branch>` を `<current>` にマージしますか？
   > コンフリクトした場合は自動で中止して元に戻します。

4. main 側でマージを実行する（下記「main の判定」）
5. 成功したら、開いているタブをディスクの内容へ再読込し、ステータスと履歴を再取得する。
   失敗したら `branchOperationError` のバナーに日本語のメッセージを表示する。
   再読込は成功時だけ行う（失敗時に行うと、無関係な未保存編集がディスクの内容で上書きされる。
   checkout と同じ理由）

「すでに最新」（マージするコミットが無い）は git が成功で終わるため、通常の成功として扱う。
早送り可能なら早送りし、できなければマージコミットを作る（git の既定）。

### main の判定

`gitService.mergeBranch(folderPath, branchName)` は、次の順で検証する。前の検証に失敗したら
後の git 呼び出しには進まない。

1. `branchLocal()` の結果で検証する（IPC 境界から届く任意の文字列のため許可リスト方式。
   `docs/review-findings-patterns.md` パターン 21）
   - 実在するローカルブランチでなければ「存在しないブランチです: <name>」
   - ブランチ上にいなければ（detached HEAD・rebase 中・bisect 中）「ブランチをチェックアウトしてからマージしてください」
     （どのブランチにも属さない、または途中状態の履歴にコミットを作るため）。
     判定は `branchLocal()` の `summary.detached` ではなく `git symbolic-ref -q HEAD` の結果が空かどうかで行う
     （下記「実機で確認した git の挙動」。simple-git の `detached` は rebase・bisect 中を検出しない）
   - 現在のブランチ自身なら「現在のブランチ自身はマージできません: <name>」
   - ブランチ名が同名のタグ等に解決されないこと。`git rev-parse --verify -q <name>^{commit}`
     （名前の解決先）と、`git for-each-ref --format='%(refname) %(objectname)' refs/heads/<name>` の
     refname が完全一致する行の SHA（ブランチの先端）を比べ、行が無い・食い違うなら
     「同名のタグ等があり、ブランチを特定できないためマージできません: <name>」。同じコミットを指すタグは拒否しない（無害。ただし git はタグの方をマージするため、
     マージコミットができる場合の件名は `Merge tag '<name>'` になり、注釈付きタグなら本文にタグの
     メッセージも入る。内容は同じでデータは失われない。`refs/heads/<name>` を渡す方式にすると件名が
     `Merge branch 'refs/heads/<name>'` になり別の見え方になるため、コードでは対応しない）。
     先端を rev-parse ではなく for-each-ref で取るのは、大文字小文字を区別しない FS で `feat`
     （packed-refs）と `Feat`（loose ref）が共存すると、rev-parse が両方とも `Feat` のファイルへ
     解決し、選んでいないコミットをマージして成功扱いにするため（実機で確認）
2. マージ中（`git rev-parse -q --verify MERGE_HEAD` に出力がある）なら
   「マージ中のため実行できません」。git 自身も 2 つ目のマージを拒否するが、英語のエラーを
   見せる前に日本語で弾く
3. 追跡済みファイルの未コミットの変更があれば
   「未コミットの変更があるためマージできません。先にコミットしてください」。
   判定は `git status --porcelain -z --untracked-files=no` に出力があるか。未追跡ファイルだけなら
   開始できる（マージで上書きされる未追跡ファイル（ignored を除く）があれば git が拒否する。
   ignored のファイルは拒否されず上書きされる。下記「実機で確認した git の挙動」と既知の制約を参照）
4. `git merge --no-edit <branch>` を実行する。merge の成否（resolve か reject か）にかかわらず、
   実行後に `MERGE_HEAD` が残っていれば中止する（エラー文から原因を判定しない。パターン 28。
   コンフリクトでは git が終了コード 1・stderr 空で終わるため simple-git は reject せず resolve する）
   - `MERGE_HEAD` が無いまま reject した: git が何も変えずに失敗している（無関係な履歴の拒否、
     上書きされる未追跡ファイル、コミッター情報が無い等）。git のエラーをそのまま投げる（checkout と同じ）
   - `MERGE_HEAD` がある: マージが途中で止まっている。`git diff --name-only -z --diff-filter=U`
     で未解決のファイルを取得してから `git merge --abort` で元に戻し、エラーを投げる
     - 未解決のファイルがある（コンフリクト）:
       「コンフリクトしたため中止しました: a.txt, b.txt」。ファイルは 5 件まで表示し、
       超えたら「ほか N 件」を付ける
     - 未解決のファイルが無い（`pre-merge-commit` フックの失敗等）:
       「マージを完了できなかったため中止しました」に git のエラーを添える
       （git のエラーが空なら末尾のコロンは付けない）

### 未コミットの変更がある状態で開始しない理由

`git merge --abort` は、マージ開始前から未コミットの変更があると、それを元に戻せない場合が
あると git の公式ドキュメントが警告している。重ならない変更であれば git はそのままマージを
始めてしまう（実機で確認）ため、アプリ側で開始前に止める。自動中止で作業中の変更を失う可能性を
無くす（assume-unchanged を除く。下記の既知の制約）。

### 実機で確認した git の挙動（git 2.50.1）

- simple-git 3.36 の `branchLocal()` は、`git branch -v` の先頭行が `(HEAD detached at X)` /
  `(HEAD detached from X)` の形のときだけ `detached: true` を返す。対話的 rebase の途中は
  `* (no branch, rebasing main) …`、bisect の途中は `* (no branch, bisect started on main) …` と出力され、
  `current: "(no"`・`detached: false` と解析される（`all` にも `"(no"` が混ざる）。このため `summary.detached`
  で拒否すると、rebase を `edit` で止めている間（作業ツリーはきれいで `MERGE_HEAD` もない）は検証をすべて
  すり抜け、rebase 途中の履歴にマージコミットが入ってしまう。`git symbolic-ref -q HEAD` は、ブランチ上なら
  `refs/heads/<name>` を返し、ブランチ上にいなければ（detached・rebase 中・bisect 中）終了コード 1・stderr 空で
  終わるため、simple-git は reject せず空文字で resolve する。この空文字をブランチ上にいない状態として扱う
- コンフリクト: `MERGE_HEAD` が残り、`diff --name-only -z --diff-filter=U` で対象ファイルが
  取れる。`merge --abort` で `MERGE_HEAD` も working tree も元に戻る
- ステージしていない変更がある状態では、それがマージ対象のファイルと重ならなければ、git は
  マージを始める。ステージ済みの変更がある状態では、重ならなくても `MERGE_HEAD` を残さずに
  失敗する（`Merge with strategy ort failed`）
- コミッター情報が無い場合、git はマージを始める前に失敗し、`MERGE_HEAD` は残らない
- `pre-merge-commit` フックが失敗すると `MERGE_HEAD` が残り、未解決のファイルは無い。
  `merge --abort` で元に戻る
- 無関係な履歴（`refusing to merge unrelated histories`）と、上書きされる未追跡ファイル
  （`untracked working tree files would be overwritten`）は `MERGE_HEAD` を残さずに失敗する
- 「すでに最新」は成功で終わる
- 同名のタグがあると git はタグを優先し、`refname is ambiguous` の警告を出すだけで終了コード 0 になる
  （別のコミットへ早送りされ、`MERGE_HEAD` も残らない）
- マージ中に別のマージを始めると `Merging is not possible because you have unmerged files`
- `rev-parse -q --verify MERGE_HEAD` は、無いと終了コード 1・stderr 空で終わり、simple-git は
  reject せず空文字で resolve する（`deleteBranch` の `isBranchMerged` と同じ扱い）
- コンフリクトでは git が終了コード 1・stderr 空で終わるため、simple-git は reject せず resolve する
- 相手のブランチで追跡されているファイル（例 `ign.txt`）が、こちらでは `.gitignore` 対象でローカルに
  独自の内容があるとき、`git merge` はそれを黙って上書きする（`--no-overwrite-ignore` は早送りの
  ときしか効かない）。コンフリクトで自動中止すると `git merge --abort` がそのファイルごと消し、
  元の内容は戻らない。git の既定動作で checkout も同じ。確認文言の「元に戻します」はこのケースでは
  成り立たない

### 実行中・他操作中の表示

- ブランチ操作の実行中は、トリガーボタンの表示テキストと `aria-label` を切り替える（既存の表に追加）

| 状態         | 表示テキスト | `aria-label`       |
| ------------ | ------------ | ------------------ |
| マージ実行中 | マージ中...  | ブランチのマージ中 |

- 実行中・他操作中はトリガーボタンが disabled になり、メニューは開けない（既存の挙動を踏襲）

### キーボード操作・アクセシビリティ

- マージボタンは削除ボタンと同じく `tabIndex={-1}` とし、roving tabindex（radiogroup 内の
  Tab 停止点は 1 つ）を崩さない
- radio にフォーカスした状態で `M` キー（修飾キー無し）を押すと、そのブランチのマージボタンと
  同じ処理を行う。radio の `aria-keyshortcuts` は `Delete M` にする。現在ブランチの radio は
  disabled でフォーカスできないため、現在ブランチに対して発火することはない
- マージボタンの `aria-label` は「ブランチ <name> を現在のブランチにマージ」
- マージボタンのタップ領域は削除ボタンと同じく 32px × 32px 以上を確保する
- マージの確認ダイアログを閉じたあとは、メニューが閉じてトリガーボタンへフォーカスを戻す
  （削除と同じ）

### エラーハンドリング

- main 側のエラーはすべて日本語メッセージにして投げ、既存の `branchOperationError` バナーに表示する
  （git が何も変えずに失敗した場合の git 自身のエラーは、checkout と同じくそのまま出す）
  - 存在しない: 「存在しないブランチです: <name>」（既存と同じ文言）
  - detached HEAD: 「ブランチをチェックアウトしてからマージしてください」
  - 現在のブランチ自身: 「現在のブランチ自身はマージできません: <name>」
  - 同名のタグ等: 「同名のタグ等があり、ブランチを特定できないためマージできません: <name>」
  - マージ中: 「マージ中のため実行できません」
  - 未コミットの変更あり: 「未コミットの変更があるためマージできません。先にコミットしてください」
  - コンフリクト（自動中止済み）: 「コンフリクトしたため中止しました: <ファイル一覧>」
  - フックの失敗等（自動中止済み）: 「マージを完了できなかったため中止しました」＋ git のエラー
- 成功時は `branchOperationError` をクリアする（既存の `useRunExclusiveGitOperation` の挙動）
- 自動中止（`merge --abort`）自体が失敗した場合は、その git のエラーをそのまま投げる。
  この場合はマージ途中の状態が残りうるが、アプリ内に解決手段が無いため、既知の制約として扱う
- ignored のファイルは git の既定どおり上書きされ、中止しても復元されない（既知の制約）。
  事前拒否は今回は行わない。やるなら `ls-files -o -i --exclude-standard` と `ls-tree -r <branch>` が
  重なるパスを拒否する

### 既知の制約

- `git update-index --assume-unchanged` を付けたファイルの未コミットの変更は、`git status` に
  出ないため「未コミットの変更がある間は開始しない」の検証をすり抜ける。分岐していて相手の
  ブランチがそのファイルを変更していると、git 自身が `Your local changes … would be overwritten`
  で失敗し（MERGE_HEAD は残らない）、そのファイルが HEAD の内容に戻って変更が失われる
  （レビューで実機再現、git CLI でも同じ結果）。ユーザー自身が assume-unchanged を付けた場合に
  限られ、検出には `ls-files -v` で全追跡ファイルを列挙する必要があり、大きなリポジトリでは
  コストが釣り合わないため、今回は行わない。skip-worktree の場合は変更が残る。
- `rerere.enabled` と `rerere.autoupdate` が両方有効だと、コンフリクトが以前の解決で自動
  ステージされ、未解決ファイルが空になる。そのため「コンフリクトしたため中止しました」ではなく
  「マージを完了できなかったため中止しました: Staged '<file>' using previous resolution.」と
  表示される。中止とデータの復元は正しく行われ、文言だけの問題。
- `git am` の途中（パッチの適用に失敗して止まっている間）は、HEAD がブランチを指したままなので
  `isOnBranch` は true になり、作業ツリーはきれいで MERGE_HEAD もないため、マージの検証をすべて
  通る。git 本体の `merge` もこの状態を拒否せず、am セッションの途中でマージコミットが作られる
  （`git status` は「You are in the middle of an am session.」）。その後 `git am --abort` しても
  「You seem to have moved HEAD since the last 'am' failure. Not rewinding to ORIG_HEAD」となり、
  マージコミットは残る（実機で確認済み。データは失われない）。cherry-pick・revert の途中は git
  自身が `You have not concluded your cherry-pick (CHERRY_PICK_HEAD exists)` 等で拒否する。検出には
  `git rev-parse --git-path rebase-apply` のディレクトリの存在をファイルシステムで調べる必要があり、
  GUI ツールで am の途中はまれなため、今回は行わない。

## アーキテクチャ

### main プロセス（`src/main/gitService.ts`）

- `mergeBranch(folderPath, branchName): Promise<void>` を追加する
- 判定を小さな関数に分ける（`checkout` / `createBranch` / `deleteBranch` と同じ粒度）
  - `assertMergeTargetBranch(git, branchName)`: 上記 1（許可リスト・detached・自身・同名タグ等の曖昧さ。
    曖昧さの検証は `assertBranchRefUnambiguous`）
  - `assertMergeStartable(git)`: 上記 2〜3（マージ中・未コミットの変更）
  - `abortFailedMerge(git, error)`: 上記 4 の失敗時（未解決ファイルの取得 → 中止。日本語エラーの文言は
    `buildMergeAbortMessage` が組み立てる）
- `src/main/gitMergeMessages.ts`: 中止したマージのエラー文言を組み立てる純粋関数
  （`formatConflictFiles` / `buildMergeAbortMessage`）。git の入出力から分離している
- ローカルの操作でネットワーク I/O を伴わないため、`simpleGitWithRemoteTimeout` は使わない

### IPC（`src/main/handlers/gitHandlers.ts`）

- `git:mergeBranch`（引数 `branchName: unknown`）。`assertBranchNameArg` で型を検証してから
  `mergeBranch` を呼ぶ

### preload / renderer lib

- `src/preload/api.ts` / `src/preload/index.d.ts` / `src/renderer/src/lib/gitApi.ts` に
  `mergeBranch(branchName: string): Promise<void>` を追加する
- `src/renderer/src/lib/branchMerge.ts`（新規）: 確認文言の組み立て `buildMergeConfirmMessage`
  （`lib/branchDeletion.ts` と同じ位置づけの純粋関数）

### renderer フック（`src/renderer/src/hooks/useGitBranchOperations.ts`）

- `BranchOperationKind`（`src/renderer/src/types.ts`）に `'merge'` を追加する
- `mergeBranch(branchName): Promise<boolean>` を追加する。戻り値は実行され成功したか
  - 確認（`onConfirm`）→ `runOperation`。開始条件は checkout / 作成 / 削除と共通の
    `isBranchOperationBusy`
  - マージは working tree / index / HEAD を書き換えるため、checkout と同じ理由で
    `lockGlobal` を取る（マージ中に push が始まると、確定前の HEAD を送ってしまう）
  - 確認文言には現在のブランチ名が必要なため、`gitStatus` から取る。現在のブランチ名が
    分からない状態（リポジトリが無い）は `isBranchOperationDisabled` で既に弾かれている

### renderer の配線（`src/renderer/src/hooks/useAppState.ts`）

- checkout と同じ形のラッパー `mergeBranch` を追加する
  1. `fileSystem.confirmDiscardAnyDirty()` が false なら何もしない
  2. `gitBranchOperations.mergeBranch(branchName)` を呼ぶ
  3. 戻り値が true のときだけ `fileSystem.reloadOpenFiles()` を呼ぶ
- マージは新しいファイルを追加・削除しうるが、ファイルツリーの再読込は checkout と同じく
  今回は行わない（checkout も行っておらず、ブランチ切り替えの既存の制約として揃える）

### renderer コンポーネント

- `BranchMenuItem`: Props に `onMerge: (branchName: string) => void` を追加する。現在ブランチ
  以外の行にマージボタンを描画し、`M` キーを処理する
- `BranchSwitcherMenu`: `onMerge` を受けて各行へ渡す
- `BranchSwitcher`: マージはメニューを閉じてトリガーへフォーカスを戻してから `onMergeBranch` を
  呼ぶ（削除と同じ。確認ダイアログはフック側で出す）。`pendingBranchOperation` に応じた
  トリガーの表示は `getBranchTriggerLabel` に任せる
- `lib/branchTriggerLabel.ts`: `PENDING_LABELS` に `merge` 実行中の表示テキストと `aria-label` を追加する
- `GitRepoView` / `SourceControlPanel` / `Sidebar` / `App`: 新しい Props を配線する

## テスト方針

- `gitService.test.ts`（simple-git をモック）
  - `mergeBranch`: `symbolic-ref -q HEAD` が空（ブランチ上にいない）・現在ブランチ自身・マージ中・未コミットの変更の各拒否、拒否時に `merge` が呼ばれないこと
  - 成功時に `merge --no-edit <branch>` が呼ばれること、`-` 始まりの名前は許可リストで弾かれること
  - 失敗時の分岐: `MERGE_HEAD` なしはそのまま再 throw、コンフリクトは未解決ファイルを取得して
    `merge --abort` を呼び日本語エラー、未解決なしは別の日本語エラー、中止の前に未解決ファイルを
    取得していること（中止後は取れない）、中止自体の失敗はそのまま投げ直すこと。
    文言の組み立て（「ほか N 件」等の境界値）は `gitMergeMessages.test.ts` で固定し、
    `gitService.test.ts` は `buildMergeAbortMessage` の結果を投げる配線だけを確認する
  - 許可リスト（存在しない名前）: checkout・削除・マージの 3 操作が、許可リストに無い名前
    （`--force` 等）を同じ文言で拒否し、git の操作（merge・abort・rev-parse・status を含む
    `raw` 全般）を一切呼ばないこと（`it.each`。検証順序の固定も兼ねる）
  - 未コミットの判定は `--untracked-files=no` で、未追跡のみなら拒否しないこと
- `gitService.merge.integration.test.ts`（新規、実 git）: 早送り、マージコミット、「すでに最新」、
  コンフリクトで中止して working tree と `MERGE_HEAD` が元に戻ること、未コミットの変更で
  拒否されて変更が残ること、マージ中の拒否、フックの失敗で中止して元に戻ること、
  未追跡のファイルだけなら開始できること、対話的 rebase を `edit` で止めている間と bisect の途中
  （simple-git の `detached` が検出しない状態）の拒否で HEAD と working tree が変わらないこと
  （`GIT_SEQUENCE_EDITOR` にシェルスクリプトを渡すため Windows は対象外）。グローバル・システムの git 設定から切り離す
  （`gitService.discard.integration.test.ts` と同じ。パターン 41）
- `gitHandlers.test.ts` / `api.test.ts`: 引数の型検証と配線
- `branchMerge.test.ts`: 確認文言
- `gitMergeMessages.test.ts`: 中止したマージのエラー文言の境界値（5 件まで表示・ちょうど 5 件は
  「ほか」なし・6 件以上は「ほか N 件」・detail が空なら末尾のコロンなし）
- `branchMenuShortcut.test.ts`: キー判定（Delete・M・修飾キー付きは無視）と、`aria-keyshortcuts` の
  告知文字列がキー判定と同期していること
- `editorSyncedOperation.test.ts`: 確認 → 操作 → 成功時のみ再読込の手順（キャンセルや失敗では
  再読込しない）
- `branchTriggerLabel.test.ts`: merge 実行中のトリガーの表示テキストと `aria-label`
- `useGitBranchOperations.test.ts`: 確認キャンセルで API を呼ばないこと、排他、`lockGlobal` を
  取ること、成功時の再取得、戻り値。ガード条件は他の条件が偶然真にならないモックロックで検証し、
  checkout / 作成 / 削除 / マージの相互排他を `it.each` で操作ごとに固定する（パターン 34）
- `useAppState.test.ts`: 未保存編集の確認のキャンセルでマージしないこと、成功時だけ
  `reloadOpenFiles` を呼ぶこと、失敗時は呼ばないこと
- `BranchMenuItem.test.tsx` / `BranchSwitcherMenu.test.tsx` / `BranchSwitcher.test.tsx`
  - 現在ブランチの行にマージボタンが無いこと、マージボタンの `aria-label`
  - `M` キーで呼ばれること、`aria-keyshortcuts`。修飾キー付きの判定そのものは
    `branchMenuShortcut.test.ts` で固定し、`BranchMenuItem.test.tsx` は判定関数を経由して
    いること（修飾キー付きでは呼ばれない）の配線確認にとどめる
  - マージ後にメニューが閉じてフォーカスがトリガーへ戻ること
  - 実行中の表示テキストと `aria-label` の同期
- 各修正は TDD で行い、実装を戻すと該当テストが落ちること（ミューテーション）を確認する
- Electron 実機で、早送り・マージコミット・コンフリクトの自動中止・未コミットの拒否・
  エディタの再読込を確認する

## 実装順序

1. `gitService.mergeBranch`（許可リスト・事前検証・失敗時の中止）と統合テスト
2. IPC ハンドラー・preload・`gitApi`・`branchMerge.ts`
3. `useGitBranchOperations` の `mergeBranch`（`BranchOperationKind` に `'merge'`）
4. `useAppState` の配線
5. `BranchMenuItem` / `BranchSwitcherMenu` / `BranchSwitcher` の UI と配線
6. ROADMAP の更新（「ブランチのマージ」を実装済みへ移す）

## 実装後のリファクタリング（単一責任への分割）

実装とレビューの後、責務が混ざっていた・重複していた箇所を、振る舞いを変えずに分割した。

| 分割先                                                                      | 責務                                                                                                  | 分割元                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `gitService.ts` の `assertMergeTargetBranch` / `assertBranchRefUnambiguous` | マージ対象のブランチを特定できるか（許可リスト・detached・自身・同名タグ等）                          | `assertMergeableBranch`（対象の特定とリポジトリの状態の検証が混在していた）     |
| `gitService.ts` の `assertMergeStartable`                                   | リポジトリがマージを始められる状態か（マージ中・未コミット）                                          | 同上                                                                            |
| `gitService.ts` の `assertLocalBranchExists`                                | checkout・削除・マージで共通の許可リスト検証（実在するローカルブランチ名のみ通す。パターン 21）       | 3 か所にコピーされていた `summary.all.includes(branchName)` の判定              |
| `src/main/gitMergeMessages.ts`                                              | 中止したマージのエラー文言の組み立て（純粋関数）                                                      | `abortFailedMerge`（git の入出力と文言の組み立てが混在していた）                |
| `src/renderer/src/lib/branchMenuShortcut.ts`                                | ブランチ一覧の radio 上のキー入力の解釈（Delete・M）と、`aria-keyshortcuts` の告知文字列              | `BranchMenuItem` の `onKeyDown`（判定が直書きで、告知は別の場所の文字列だった） |
| `src/renderer/src/lib/editorSyncedOperation.ts`                             | working tree を書き換える操作をエディタと同期して実行する手順（破棄の確認 → 操作 → 成功時のみ再読込） | `useAppState` の `checkoutBranch` / `mergeBranch`（同じ手順が重複していた）     |
| `BranchSwitcher.tsx` の `closeMenuThen`                                     | 「メニューを閉じる → トリガーへフォーカスを戻す → 操作を呼ぶ」                                        | `handleSelect` / `handleDelete` / `handleMerge`（3 つで重複していた）           |
| `main.css` のグループセレクタ                                               | 削除・マージボタンの共通の基本宣言（32px 四方のタップ領域等）                                         | 削除ボタンと丸ごと重複していた宣言（パターン 30）                               |
| `src/main/__tests__/helpers/realGitRepo.ts`                                 | 実 git を使う統合テストの共通ヘルパー（グローバル設定・`GIT_DIR` 等の切り離し）                       | `gitService.discard.integration.test.ts` と重複していたヘルパー                 |
