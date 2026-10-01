# 変更の取り消しの拡張（ハンク単位・一括）設計

## 背景・現状

- ソース管理パネルの「変更」セクションでは、ファイル単位の取り消し（`discardFileChanges`）が実装済み。追跡済みは
  `git restore --worktree` で index の内容へ戻し、未追跡・intent-to-add は OS のゴミ箱へ移す。コンフリクト中、
  判定不能、未追跡と重なる配置は拒否する。状態の判定は `classifyDiscardTarget` が git に問い合わせて行う。
- diff タブでは、ハンク単位のステージ / アンステージ（`git apply --cached [--reverse]`）が実装済み。
- ROADMAP「今後実装した方がよい機能 > ソース管理（Git）」の先頭に「変更の取り消しの拡張（ハンク単位・一括取り消し。
  ファイル単位は実装済み）」がある。ハンクだけを捨てたい、変更をまとめて捨てたい場合に、外部ターミナルへ抜ける必要がある。

## スコープ

### やること

1. **ハンク単位の取り消し**: diff タブ（未ステージの diff）の各ハンクに「取り消し」ボタンを置き、そのハンクだけを作業ツリーから
   取り消す
2. **一括取り消し**: 「変更」セクションの見出しに「すべて取り消す」ボタンを置き、セクションの全ファイルを、ファイル単位の
   取り消しと同じ規則で取り消す

### やらないこと

- ステージ済み（index）の取り消し（ステージ済みのハンクは「アンステージ」で未ステージに戻してから取り消す）
- 行単位の取り消し
- 取り消しの元に戻す（Undo）。取り消しは元に戻せないため、毎回確認する
- コンフリクトの解決 UI（コンフリクト中のファイルは従来どおり拒否する）

## 仕様

### ハンク単位の取り消し

- diff タブが**未ステージの diff**で、対象が**追跡済みの変更ファイル**のとき、各ハンクの見出しに「取り消し」ボタンを置く。
  ステージ / アンステージのボタンの隣に並べる
- 次の場合は出さない:
  - ステージ済みの diff
  - 未追跡ファイル、intent-to-add のファイル（ハンクは疑似 diff の全行追加 1 つで、ファイル単位の取り消し（ゴミ箱）と
    同じ操作になるため。ファイル単位の取り消しを使う）
  - 結合 diff（`parsed.isCombined`。コンフリクト中）
  - 打ち切り表示中で、そのハンクの一部が表示されていないとき（ボタンは打ち切り前の全量からパッチを作るため、見ていない行まで
    取り消してしまう。ステージボタンと同じ規則）
- 押すと確認ダイアログを出す。文言: `<ファイル名> の次のハンクを取り消しますか？この操作は元に戻せません。\n\n<ハンクの見出し>`。
  対象ファイルのタブに未保存の編集があるときは、`\n\nエディタの未保存の編集も破棄されます。` を足す
  （ファイル単位の取り消しと同じく、確認は 1 回にまとめる）
- 承諾すると、作業ツリーにそのハンクを逆適用する。index には触れない（ステージ済みの内容は残る）
- 成功したら、開いているタブを再読込し、`git status` と diff を取り直す。失敗または何もしなかった（確認の拒否など）ときは
  再読込しない（未保存の編集を守る。パターン 20）

### 一括取り消し

- 「変更」セクションの見出し行に、「すべて取り消す」ボタンを置く（セクションが空のときはセクションごと出ない）
- 押すと、件数を示す確認ダイアログを出す。承諾後、未保存の編集を持つタブがあれば、既存の破棄の確認（`confirmDiscardAnyDirty`）がもう一度出る
  （ブランチ操作・退避と同じ。ハンクと違い、全タブが対象になるため確認文言には未保存の編集の注記を入れない）。文言: `変更 <N> 件を取り消しますか？この操作は元に戻せません。` に、
  ゴミ箱へ移すものがあれば `\nうち <M> 件の未追跡ファイルはゴミ箱へ移動します。` を足し、
  そのうちフォルダ（ネストした git リポジトリ。renderer のパスが `/` で終わる）が <K> 件あれば `\nうち <K> 件はフォルダ（git リポジトリ）で、フォルダとその中身がすべて移動します。` をさらに足す
  （ファイル単位の確認文言と揃える）
- 対象は「変更」セクションに表示されているファイル（`isUnstagedFile`: 作業ツリー側に変更がある、または未追跡）。
  ステージ済みの内容は触らない（ファイル単位の取り消しと同じ）
- 追跡済みは index の内容へ戻し、未追跡・intent-to-add は OS のゴミ箱へ移す。
  いずれも、ファイル単位の取り消しと同じ手段で行う
- 成功したら、開いている全タブとファイルツリーを再読込し、`git status` と履歴を取り直す

### main の判定

#### ハンク（`discardHunk(folderPath, filePath, patch)`）

1. `classifyDiscardTarget` で `filePath` を判定し、`tracked` 以外は拒否する（ファイル単位の取り消しと同じ分類と文言を使う）:
   - `conflicted`: `コンフリクト中のファイルは取り消せません: <path>`
   - `untracked` / `intent-to-add`: `ゴミ箱へ移す対象のため、ハンクでは取り消せません: <path>`（intent-to-add は逆適用すると
     ファイルが消えて index に ` D` が残り、内容が失われるため。実機で確認）
   - `unknown`: `状態を判定できないため取り消せません: <path>`
   - `overlaps-untracked`: `未追跡のファイルと重なるため取り消せません: <path>`
2. パッチが `filePath` だけを対象にしていることを確認する（IPC の境界で、任意のパッチが別のファイルを書き換えないようにする）。
   `git apply --numstat -z` は順方向の新パスしか見ず、`--reverse` では適用先が入れ替わるパッチ（a/b 不一致、`rename old`/`rename new`
   の旧形式）を見逃すため、次の 2 段で確認する。どちらかに合わなければ `パッチの対象がファイルと一致しません` で拒否する:
   1. **許可リスト**（`gitHunkPatch.ts` の `assertHunkPatchTargets`）: `diff --git a/<p> b/<p>` が 1 つ（a 側・b 側とも `filePath`）、
      `deleted file mode`（`100644` / `100755` のみ。`120000` などで任意のリンクとして復元されるのを防ぐ）。`index` 行にモードが付く場合は `deleted file mode` と一致することも要求する（git apply は `index` 行のモードを採用するため、一致を見ないと `index … 120000` で任意のリンクとして復元できる。git の実際の削除 diff は `index abc..0000000` でモードを付けない）または `old mode` →
      `new mode` の 1 組、`index`、`--- a/<p>` / `+++ b/<p>`（削除は `+++ /dev/null`）、そして本文の行数が `@@` の見出しと一致する
      ハンクだけを許可する。それ以外（`rename`/`copy`/`similarity`/`new file mode`/`--- /dev/null`/`Binary files`/`GIT binary patch`/
      ほかの未知の行）は拒否する。`core.quotepath` の既定では非 ASCII のパスが `"a/\346\227\245….txt"` の引用符つきで出るため、
      8 進エスケープをデコードして比較する。`filePath` が `..` や絶対パスのときも拒否する
   2. **`git apply --numstat -z -`**（作業ツリーは変えない）を、順方向と `--reverse` の両方で実行し、どちらも `[filePath]` 1 件であること
      `old mode` / `new mode` は検証後に取り除いてから numstat と適用に渡す（内容だけが戻り、実行権限などのモードは残る）
3. `git apply --reverse --whitespace=nowarn --no-ignore-whitespace -` を、パッチを標準入力で渡して実行する。`--cached` は付けない
   （作業ツリーだけを書き換える）。ステージ / アンステージ（`runHunkApply`）と共通の引数は 1 か所にまとめる
4. 失敗（`patch does not apply` など）は、作業ツリーを変えずに、`ハンクを取り消せませんでした。ファイルが変更された可能性があります。diff を開き直してください`
   に変換して投げる（原因は `cause` に残す）

#### 一括（`discardAllChanges(folderPath, expected, trash)`）

1. `git status --porcelain -z --untracked-files=all` から、「変更」セクション相当のファイル（作業ツリー側に変更がある、または
   未追跡）を、実行時に自分で一覧にする。renderer が持つパス一覧は信用しない
2. 確認ダイアログで見せた一覧 `expected`（`DiscardAllEntry[]`: `path` と、index + workingDir の 2 文字の `status`）と、実行時の一覧を
   **パスでソートした配列として完全一致**で照合し、違えば何も変えずに
   `変更の状態が変わったため取り消しを中止しました。もう一度操作してください` で拒否する（分類の問い合わせより前。状態は確認と実行の間に変わる。
   パターン 53）。件数だけを比べていたときは、確認していたファイルと別のファイルに入れ替わっても件数が同じなら通り、確認していない
   ファイルの編集が `restore --worktree` で復元できない形で消えた（このPRで修正）。ステータスも照合に含めるのは、同じパスで `??` → `AM` に
   変わると「ゴミ箱へ移す」から「restore で消す」に変わるため。照合キーは、renderer の `path`（simple-git の表記: ネストした git
   リポジトリは `sub/`、末尾空白は trim 済み）に合わせ、main の生のパスから末尾 `/` は削らず、末尾の空白だけを削ったもの（`.trimEnd()`。simple-git が行の末尾だけを削り、先頭の空白は残すため）を使う。
   両端を `trim()` していた初版は、先頭が空白のパス（未追跡の ` lead`、`AM`、全角空白始まり）で renderer と一致せず、一括取り消しが毎回中止された（2 周目のレビューで指摘、このPRで修正）。
   実行に使うパスは従来どおり（末尾 `/` を削った値）
3. **全ファイルを先に分類**する。`conflicted` / `unknown` / `overlaps-untracked` が 1 件でもあれば、何も変えずに全体を拒否する
   （全か無か。エラーには対象のパスを最大 5 件まで含める）
4. 分類が通ったら、ファイルごとに、ファイル単位の取り消しと同じ手段（追跡済みは `restore --worktree`、未追跡は
   ゴミ箱、intent-to-add は `rm --cached` してゴミ箱）をファイルごとに順に実行する。実行部分は
   `discardFileChanges` と共有の関数にまとめる
5. 途中で失敗した（ゴミ箱への移動が失敗した）ときは、そこで止め、`一括の取り消しが途中で失敗しました（<済んだ件数> / <全件数> 件を取り消し済み）: <原因>`
   で知らせる。済んだぶんは戻せないため、件数を伝える。戻り値は `DiscardAllResult`（`{ status: 'done' }` / `{ status: 'partial'; message }`）で、
   **1 件以上済んでいれば例外ではなく `partial` の結果で返す**（作業ツリーが変わっており、renderer が開いているタブとツリーを再読込する必要があるため。パターン 52）。
   1 件目で失敗した（済み 0 件）ときは何も変わっていないので、同じ文言を例外で投げる（再読込しない）

### 実機で確認した git の挙動（git 2.50.1）

- **未ステージのハンクの逆適用**: `git diff <file>`（index と作業ツリーの差）から作ったパッチを `git apply --reverse`（`--cached` なし）に
  渡すと、作業ツリーの該当箇所だけが戻り、index（ステージ済みの変更）は変わらない
- **複数ハンクのうち 1 つ**: ヘッダー + 2 番目のハンクだけのパッチを逆適用すると、そのハンクだけが戻り、他のハンクの差分は残る
- **古いパッチ**: diff を取った後にファイルが変わっていると、`patch does not apply`（終了コード 1）で失敗し、ファイルは変わらない
- **作業ツリーで削除されたファイル**: ` D` のファイルの diff を逆適用すると、ファイルが元の内容で復元される
- **intent-to-add**: 逆適用すると作業ツリーのファイルが**消え**、index に ` D` のエントリが残る。履歴に内容が無いため
  失われる（ハンクの取り消しの対象外にする根拠）
- **`core.autocrlf=true` の CRLF ファイル**: 逆適用しても改行コードは保たれ、差分が消える
- **モード変更つきの diff**: 内容変更 + `chmod +x` の diff には `old mode 100644` / `new mode 100755` が入り（`index` 行はモードが付かない形になる）、
  そのまま `--reverse` で適用するとモードも戻そうとして失敗する。2 行を取り除いたパッチを逆適用すると、内容だけが戻りモード（+x）は残る
- **`git apply --numstat -z` のリネーム**: 新しいパスだけを返す（`git diff --numstat -z` の `<旧>\0<新>` 形式とは異なる）。`--reverse` では
  適用先が入れ替わるため、順方向の結果だけでは検査にならない
- **非 ASCII のパス**: diff のヘッダーは引用符つきの 8 進エスケープで出る。空白を含むパスは `--- a/p` の末尾にタブが付く
- **` R`（intent-to-add のリネーム）**: `mv old new && git add -N new` の status は `' R new\0old\0'`（index が空白、workingDir が `R`）で、旧パスが続く

### 実行中・他操作中の表示

- **ハンク**: 既存の `runHunkOperation`（`useDiffOperations`）の排他とタブスコープの実行中表示をそのまま使う。ステージ / アンステージと
  同じ `isHunkOperationInProgress` でボタンを disabled にする。取り消しが成功した後の diff の再取得待ち（`staleTab`）も同じ
- **一括**: `lockGlobal` を取り、実行中の push / ステージ / ブランチ操作 / 退避と相互に待つ。実行中はボタンを `取り消し中...` にし、
  他の操作を disabled にする。busy の判定は退避（`useGitStashOperations`）と同じ（自分の busy ref + `lock.isAnyLocked()` + リポジトリの有無）
- 確認ダイアログで「キャンセル」を押したときは何もしない（ロックも取らない）

### キーボード操作・アクセシビリティ

- ハンクのボタン: `aria-label="このハンクを取り消す"`（固定。ステージボタンと同じく、実行中は `disabled` で表す）
- 一括のボタン: `aria-label="変更をすべて取り消す"`（実行中は `変更を取り消し中`）。タップ領域は 32px 以上
- 確認は `confirm()`（既存のファイル単位の取り消しと同じ）。フォーカスは操作したボタンのまま

### エラーハンドリング

- 一括の失敗は、「変更」セクション内の `<p role="alert">` に出す。途中失敗で 1 件以上済んでいる `partial` も同じ場所に message を出すが、
  成功扱いで全タブとツリーを再読込する（例外のときは再読込しない）（退避のエラー表示と同じ）。ハンクは diff タブの既存のエラー表示
  （`hunkError`）に出す
- 拒否の文言は上記「main の判定」のとおり（ファイル単位と共通のものは同じ文言）

### 既知の制約

- 取り消しは元に戻せない。ハンクの取り消しも、作業ツリーのその範囲の内容は git に残らない
- 一括取り消しで途中（ゴミ箱への移動）に失敗すると、済んだぶんは戻らない（1 件以上済んでいれば `partial` の結果で返り、renderer がタブとツリーを再読込する。0 件なら例外で再読込しない）。分類を先に全件行うため、コンフリクト・判定不能・
  重なりによる失敗は、何も変えずに起こる
- ハンクの取り消しと、エディタでの保存（Cmd+S）が重なると、ブランチ切り替えや退避と同じ種類の競合がある（保存したばかりの
  内容を取り消す、またはパッチが古くなって失敗する）。パッチが古い場合は `patch does not apply` で何も変えずに失敗する
- サブモジュールの ` M sub`（サブモジュールが新しいコミットを指している）は、ハンクの取り消しも一括の取り消しも「成功」と表示されるが
  何も変わらず、実行後も「変更」に残る（データは失われない。ファイル単位の取り消しと同じ既存の挙動。ROADMAP の見送りに記載）
- リネームした新パスを `git add -N` している状態（` R new` / 旧パス `old`）を取り消すと、新パスはゴミ箱へ移り index から外れるが、
  旧パスの削除は作業ツリーに ` D old` として残る（元のファイルは作業ツリーで削除されたままのため）。復元するには続けて ` D old` も取り消す。
  一括の一覧は ` R` の旧パスを数えないので、確認時と実行時で一覧がずれることはない
- ` M` のように index が空白のエントリで、パスの先頭が空白（` M  lead`）だと、simple-git が行頭を `trim()` してステータスがずれ、ステージ済みの `lead` と誤って解析されて「変更」に出ない
  （実 git で確認）。main の一覧には出るため、一括取り消しは一覧の不一致で常に中止される（安全側。今回の範囲外）。未追跡（`?? lead`）・`AM` など index が空白でないものは正しく解析され、一括取り消しも通る
- 名前が空白だけのトップレベルのファイル（例: ` `）は、simple-git が行ごと読み捨てる。renderer の一覧は 1 件少なく、main は数えるため、一括取り消しが常に中止される（安全側。ファイルには触れない）
- `status.renames=copies` のとき、コピー元のパスの 2〜3 文字目に空白がある（`a b.txt` など）と、simple-git がコピー元を別の行と誤って読み、renderer の一覧に存在しないエントリが混ざって、一括取り消しが常に中止される（安全側）。どちらも simple-git の解析の制約で、ファイル単位の取り消しや退避など他の操作には影響しない
- ` R`（intent-to-add のリネーム）は main の分類ではゴミ箱へ移す扱いだが、renderer の確認文言ではゴミ箱へ移す件数に数えられない
  （`movesToTrashOnDiscard` が ` A` だけを見るため。復元できる側のずれ。今回の範囲外）
- 行単位の取り消し、ステージ済みのハンクの直接の取り消しは対象外（ROADMAP の見送りとして残す）
- 追跡中のシンボリックリンクを作業ツリーで削除した場合、git の diff は `deleted file mode 120000` になる。ハンクの取り消しは削除モードを `100644` / `100755` に限る
  （任意のモードで復元できると、細工したパッチでシンボリックリンクを復元できてしまうため）ので、ボタンは出るが押すと
  「パッチの対象がファイルと一致しません」で失敗する。ファイル単位の取り消しなら戻せる。文言の分離は今後の課題

## アーキテクチャ

### main プロセス

- `src/main/gitDiscardClassifier.ts`（新規。取り消しの分類）: `DiscardTargetKind` / `ApplicableDiscardKind` / `isApplicableDiscardKind`、`classifyDiscardTarget`
  （補助の `isUntracked` / `overlapsUntracked` は非公開）、`assertDiscardable`（`conflicted` / `unknown` / `overlaps-untracked` を 3 種の文言で拒否。
  ファイル単位とハンク単位で共通）。git の状態判定ルールが変わる理由はここだけにする
- `src/main/gitDiscardService.ts`（新規。`gitService.ts` から取り消し関連を移した。取り消しの実行）: `discardFileChanges`、`discardHunk`、`discardAllChanges`、
  `applyDiscard`。分類は `gitDiscardClassifier.ts` を import する（再エクスポートしない）。`gitService.ts` も取り消しを再エクスポートしない（呼び出し元を向け直す）。
  `discardHunk` 固有の「ゴミ箱へ移す対象のため、ハンクでは取り消せません」（未追跡・intent-to-add）はここに置く
- `src/main/gitHunkPatch.ts`（新規）: パッチ構造の許可リスト検証（`assertHunkPatchTargets`）、モード行の取り除き（`stripModeChangeLines`）、
  引用符つきパスのデコード
- `src/main/gitApply.ts`: `runGitApply` が stdout を返す。`discardHunkPatch(folderPath, filePath, patch)` は `runGitApply` を直接呼び（`--cached` なし、`--reverse`）、
  `listPatchPaths`（`git apply --numstat -z`）で対象のパスを列挙する。引数（`--whitespace=nowarn --no-ignore-whitespace -`）はステージ / アンステージと共通
- `src/main/gitPathParsing.ts`: `toLiteralPathspec`・`parseNulSeparatedPaths`・`parseUnstagedStatusEntries`（パス・生のパス・ステータスを返す）/ `parseUnstagedStatusPaths`（一括の対象を status から作り直す）
- `src/main/handlers/gitHandlers.ts`: IPC `git:discardHunk`（引数 `filePath` / `patch`）、`git:discardAll`（引数 `expected`: `DiscardAllEntry[]`）。
  `filePath` はファイル単位の取り消しと同じ境界チェック（`resolveAndAssertStatusRelativePath`）を通す。`patch` は型を、`expected` は `{path: string; status: 2 文字の文字列}` の配列であること（`Invalid entries`）を検証する

### preload / renderer lib

- `src/preload/api.ts` / `index.d.ts` / `src/renderer/src/lib/gitApi.ts`: `discardHunk(filePath, patch)` / `discardAll(expected)` を追加
- `src/renderer/src/lib/discardConfirmMessage.ts`: ハンクと一括の確認文言の組み立てを足す（`buildDiscardHunkConfirmMessage` /
  `buildDiscardAllConfirmMessage`）

### renderer フック

- `src/renderer/src/hooks/useDiffOperations.ts`: `discardHunk(patch)`（`boolean` を返す）を足す。`runHunkOperation` に `gitApi.discardHunk` を渡す。
  `canDiscardHunk` は未ステージの diff・アクティブなファイルの有無の判定と、`lib/discardTarget.ts` の `canDiscardHunkFor`（追跡済みの変更ファイルだけ。
  `movesToTrashOnDiscard` とコンフリクトを除く。main の `discardHunk` の分類と揃える）の呼び出しだけにする。
  確認ダイアログと未保存編集の扱いは `useDiscardHunk` が組み立てる
- `src/renderer/src/hooks/useDiscardAllChanges.ts`（新規）: 一括取り消し。確認文言は件数（`count`）、ゴミ箱へ移す件数（`trashCount`）、そのうちフォルダの件数（`folderCount`）から作る
  （未保存編集の有無は文言に入れず、`confirmDiscardAnyDirty` で別途確認する）。確認 → `confirmDiscardAnyDirty` → `lockGlobal` →
  `gitApi.discardAll(expected)`（確認時の一覧から作った path + status の配列）の流れ全体を `runEditorSyncedOperation` で包み、成功時のみ全タブとファイルツリーの再読込までフック内で行い、
  `refreshGitStatus` で status を取り直す。busy の判定は `useGitStashOperations` と同じ。`DiscardAllState`（`isDiscarding` / `error` / `onDiscardAll`）を返す
- `src/renderer/src/hooks/useDiscardHunk.ts`（新規）: ハンクの取り消し（確認 → `useDiffOperations.discardHunk` → 成功時のみ、そのファイルの
  `reloadOpenFile` と `refreshTree`。全タブの再読込ではない）
- `src/renderer/src/hooks/useAppState.ts`: ハンクと一括を `runEditorSyncedOperation` で包まない（一括はフック内で包んでいる）。
  組み立ては退避（`useStashPanel`）と同じく専用のフックにまとめ、`useAppState` には `useDiscardHunk` と `useDiscardAllChanges` を、
  依存を渡して 1 呼び出しずつ置くだけにする

### renderer コンポーネント

- `DiffView.tsx`: ハンクの「取り消し」ボタンと `onDiscardHunk` の props。表示条件は上記
- `ChangesSection.tsx`: 見出しの「すべて取り消す」ボタンと、状態をまとめた props `discardAll: DiscardAllState`。`isOperationBlocked` は既存の判定を共有する
- `EditorPanel.tsx` / `App.tsx` / `Sidebar.tsx` / `SourceControlPanel.tsx` / `GitRepoView.tsx`: props の配線。
  一括は `discardAll: DiscardAllState` の 1 つにまとめ、App → Sidebar → SourceControlPanel → GitRepoView → ChangesSection へ渡す。
  ハンクは `onDiscardHunk` と `canDiscardHunk` の 2 props で、App → EditorPanel → DiffView へ渡す（中継は EditorPanel の 1 段）

## テスト方針

- `gitDiscardClassifier.test.ts`（simple-git の `raw` をスタブ）: `classifyDiscardTarget` の問い合わせ（unmerged / tracked / intent-to-add / overlaps の順序、icase、NFD、
  未追跡の肯定的確認、重なる配置）と `assertDiscardable` の 3 文言
- `gitDiscardService.test.ts`（分類をモックして kind を直接返す）: kind ごとの実行（追跡済み → restore、未追跡 → ゴミ箱、intent-to-add → rm --cached → ゴミ箱）、
  拒否の kind なら実行しない、`discardHunk` の untracked / intent-to-add 拒否、`discardAllChanges` の一覧の不一致（件数違い・中身の入れ替わり・同じパスでステータス違い）、分類 1 件でも失敗したら何も実行しない、
  混在の実行、ゴミ箱の失敗での途中中止と件数の文言
- `gitApply.test.ts`: 作業ツリー用の引数に `--cached` が無いこと、`--reverse` が付くこと、共通引数が揃っていること
- `gitDiscardService.integration.test.ts`（新規、実 git。環境から切り離す）: 複数ハンクのうち 1 つだけを取り消し、他のハンクとステージ済みの内容が残る、
  古いパッチは失敗して何も変わらない、削除されたファイルのハンクで復元できる、CRLF、intent-to-add / 未追跡 / コンフリクトは拒否、
  一括: 追跡済み + 未追跡の混在、ステージ済みと作業ツリーの両方に変更があるファイル（作業ツリー側だけが戻る）、一覧の不一致での拒否、`sub/`・末尾空白・` R`・`RM` の照合、
  コンフリクトが 1 件あれば何も変えない
- `gitHandlers.test.ts` / `api.test.ts` / `gitApi.test.ts`: IPC の引数検証と素通し
- `DiffView.test.tsx`: ボタンの表示条件（未ステージ・追跡済みのみ。ステージ済み / 未追跡 / 結合 diff / 打ち切りでは出ない）、`aria-label`、クリックで `onDiscardHunk` にパッチが渡る
- `ChangesSection.test.tsx`: 「すべて取り消す」の表示・disabled・クリック
- `useDiffOperations.test.ts`: `discardHunk` が `runHunkOperation` の排他に従う、成功時に diff を取り直す、失敗時のエラー
- `useDiscardAllChanges.test.ts`: 確認の拒否で何もしない、`lockGlobal` の取得と解放（成功時・失敗時）、`expected`（path + status）の受け渡し、`sub/` を含むときの確認文言、busy 判定、成功時の再取得
- `useAppState` 系: 未保存編集の確認、成功時だけ再読込、失敗時は再読込しない

## 実装順序

1. 取り消しの分類と実行を `gitDiscardService.ts` へ移す（挙動を変えない。テストも移設）
2. `discardHunk`（`gitApply.ts` の作業ツリー用モード + 分類の拒否）と統合テスト
3. `discardAllChanges` と統合テスト
4. IPC・preload・`gitApi`
5. 確認文言と `useDiscardAllChanges`、`useDiffOperations.discardHunk`
6. `useAppState` の組み立て（専用フック）
7. UI（`DiffView` / `ChangesSection`）と配線、CSS
8. ROADMAP の更新と全体の検証
