# マージコンフリクトの解決 UI 設計

## 背景・現状

- ブランチのマージ（`mergeBranch`）は、コンフリクトすると**自動で `git merge --abort`** して元に戻し、「コンフリクトしたため中止しました: <ファイル>」を出す。アプリ内にコンフリクトを解決する手段が無いため。
- 外部ターミナルやプル（マージ）で起きたコンフリクトは、ファイルが「変更」セクションに `UU` などで出る。diff タブは結合 diff（`@@@`）で、ハンクの操作は出ない。ステージ（`+`）は「解決済みにする」に相当するが、マーカーを直す手段も、マージを完了・中止する手段もアプリには無い。
- ROADMAP「今後実装した方がよい機能 > ソース管理（Git）」の先頭に「マージコンフリクトの解決 UI」がある。

## スコープ

### やること

1. **マージ中の状態の検出と表示**: `MERGE_HEAD` があるとき、ソース管理パネルの上部に「マージ中」バナーを出す。未解決の件数と、「マージを中止」「マージを完了」を置く。
2. **ブランチのマージの挙動変更**: コンフリクトしても自動で中止せず、マージ中の状態で止める（解決 UI へ誘導する）。未解決ファイルが無いのに `MERGE_HEAD` が残る場合（pre-merge-commit フックの失敗など）は、従来どおり自動で中止する。
3. **コンフリクト解決ビュー**: 未解決ファイルの diff タブを、結合 diff の代わりにコンフリクト解決ビューで表示する。コンフリクトのブロックごとに「自分を採用」「相手を採用」「両方」を選べる。ファイル単位の「自分をすべて採用」「相手をすべて採用」もある。
4. **解決済みにする**: マーカーが残っていないファイルをステージ（`git add`）する。
5. **マージを完了 / 中止**: 未解決が 0 件のとき `git commit --no-edit` で完了する。中止は `git merge --abort`（確認ダイアログあり）。

### やらないこと

- rebase・cherry-pick・revert の途中のコンフリクト。stash の復元がコンフリクトしたときは、従来どおり巻き戻す。
- 3 ウェイの並列表示（自分・相手・base を横に並べる）。ブロック内の行単位の取り込み。手編集は、エディタでマーカーを直接直してから「解決済みにする」を押す形で行う。
- マージコミットのメッセージの編集（既定の `MERGE_MSG` で完了する。変えたい場合は、完了後に amend する）。
- リネームの検出が絡むコンフリクトのブロック単位の解決（ファイル単位の採用のみ）。

## 仕様

### マージ中のバナー

- `GitStatusResult` に `mergeInProgress: boolean`（`MERGE_HEAD` があるか）を足す。リポジトリでないときは `false`。
- バナーは `mergeInProgress` が真のときだけ、ソース管理パネルの上部（ツールバーの下）に出す。文言: `マージ中（未解決 <N> 件）`。`<N>` は未解決のファイル数（`isConflictedFile` の件数）。0 件のときは `マージ中（すべて解決済み。マージを完了できます）`。
- 「マージを完了」は未解決が 0 件のときだけ押せる（それ以外は disabled）。「マージを中止」は常に押せる。
- 実行中は押したボタンだけ実行中の表示（`完了中...` / `中止中...`）にし、他の操作を disabled にする。

### ブランチのマージの挙動変更

- `mergeBranch` は、マージ後に `MERGE_HEAD` が残り、かつ未解決ファイルが 1 件以上あるとき、中止せず、**例外ではなく結果で返す**: `MergeBranchResult = { status: 'merged' } | { status: 'conflict'; message: string }`（`src/shared/types/git.ts`）。`message` は `コンフリクトしました（<ファイル一覧>）。解決するか、マージを中止してください`（ファイル一覧は `formatConflictFiles`）。コンフリクトで止まると作業ツリーがマーカー入りに変わっており、renderer は例外のときは開いているタブを再読込しないため、例外で返すと古い内容のタブを編集して保存したときにマーカーと相手側の変更が消える（パターン52。`StashPopResult` / `DiscardAllResult` と同じ契約）。
- renderer の `useGitBranchOperations.mergeBranch` は、`conflict` のとき `message` を（実行完了後に）`branchOperationError` にセットし、**作業ツリーが変わったので `true` を返す**。これで `useAppState.mergeBranch`（`runEditorSyncedOperation`）が成功時と同じく開いているタブを再読込し、ステータスを再取得してマージ中のバナーを出す。事前検証の失敗・`MERGE_HEAD` が無い失敗・未解決 0 件の自動中止は従来どおり例外（作業ツリーは変わらない）で、`false` を返し再読込しない。
- コンフリクトで止まったときのメッセージ（`branchOperationError`）は、`useGitBranchOperations` が `gitStatus.mergeInProgress` の解除（true → false）に連動して消す（消さないと解決済みなのにエラーが出たままになる）。バナーの完了・中止、コミット欄でのマージの完了、CLI の `merge --abort` のどの経路でも `MERGE_HEAD` が無くなるため、状態に連動させる。消すのは通知として出した `Error` と同一のときだけで、別のブランチ操作のエラーに置き換わっていれば消さない。
- 未解決ファイルが 0 件で `MERGE_HEAD` が残る場合は、従来どおり `merge --abort` して `マージを完了できなかったため中止しました…` を投げる（解決するものが無いため）。
- 事前検証（`assertMergeStartable` のマージ中の拒否）は変えない。マージ中に別のマージは始められない。
- 確認ダイアログの文言は `コンフリクトした場合はマージ中の状態で止まります。解決するか、マージを中止できます。`（`branchMerge.ts`）。
- `checkoutBranch` と `createBranch`（作成して切り替える）はマージ中（`MERGE_HEAD` あり）を拒否する: `マージ中のためブランチを切り替えられません。マージを完了または中止してください`。解決済みにしたファイルが切り替え先と一致すると、git が `MERGE_HEAD` ごとマージ中の状態を黙って捨てるため（実機で確認）。

### コンフリクト解決ビュー

- 「変更」セクションの未解決ファイルをタップすると、従来どおり diff タブが開く。**そのファイルが未解決の間は、タブの中身を結合 diff ではなくコンフリクト解決ビューにする**（新しい種類のタブは作らない。diff タブの開閉・自動で閉じる挙動を流用する）。解決済みにしてステージ済みになると、未ステージの diff タブは既存の処理で自動で閉じる。
- ビューはファイルを main から読み直して表示する。内容は、テキスト（そのまま表示）とコンフリクトのブロックの並び。ブロックには、自分側（`<<<<<<< <ラベル>` の内容）と相手側（`>>>>>>> <ラベル>` の内容）を並べて表示する。diff3 形式（`|||||||` の base）がある場合は、base も表示する（選択肢には含めない）。
- ブロックごとのボタン: `自分を採用` / `相手を採用` / `両方`（自分 → 相手の順に連結）。`aria-label` は `ブロック <i> を自分の内容にする` / `…相手の内容にする` / `…両方にする`。
- ファイル単位のボタン: `自分をすべて採用` / `相手をすべて採用`（`git checkout --ours/--theirs` 相当）。
- ブロックを選ぶと、main がファイルを書き換える（そのブロックのマーカーと不採用側を取り除く）。書き換えた結果、ブロックが残っていなければ「解決済みにする」を押せるようになる。残りのブロックは続けて選べる。
- 追加/削除が絡むコンフリクト（`UD` / `DU` / `AU` / `UA` / `DD`）と、バイナリのコンフリクトには、ブロックが無い。これらはファイル単位の操作だけを出す: 内容の競合なしで一方のファイルが残っている場合は `ファイルを残す`（残っている側を採用して `git add`）と `削除する`（`git rm`）、`UU`/`AA` のバイナリは `自分をすべて採用` / `相手をすべて採用` の後に `解決済みにする`（`checkout --ours/--theirs` はステージ 1/2/3 を残すため、`git add` するまで未解決のまま）。
- 出し分けは `ConflictFile.stages`（ステージ 2・3 の有無）で行う。両側にあれば `自分をすべて採用` / `相手をすべて採用`、片側だけ（または無し）なら `ファイルを残す` / `削除する`。解析できない理由（`reason`: `binary` / `markers` / `not-regular` / `missing` / `submodule`）で文言を出し分ける。サブモジュール（`submodule`）のコンフリクトは解決のボタンを 1 つも出さず、`サブモジュールのコンフリクトです。サブモジュールの中で採用するコミットを選んでから、ターミナルで git add して解決してください` と案内する（コードレビュー指摘で追加。それまでは `not-regular` 扱いで `すべて採用` と `解決済みにする` が出ており、案内どおりに押すと自分側のコミットが黙って記録された）。`解決済みにする` は、作業ツリーにファイルがあれば（`reason` が `missing` 以外なら）出す。バイナリ・リンク（`binary` / `not-regular`）で両側があるときの案内は `…「自分をすべて採用」か「相手をすべて採用」を選んでから、「解決済みにする」を押してください`（コードレビュー指摘で変更。それまでは `markers` のときだけ出しており、バイナリ・リンクはアプリ内で解決済みにできず、マージを完了できなかった）。`削除する` は `<path> を削除してマージの解決にしますか？` の確認を出す。
- ファイルを書き換える操作の前に、そのファイルのエディタのタブに未保存の編集があれば、破棄の確認を出す。書き換えが成功したら、エディタのタブを再読込する。
- ファイルの有無が変わり得る操作（`削除する`・`ファイルを残す`（作業ツリーに無ければ checkout で復元する）・`自分/相手をすべて採用`（作業ツリーから消していれば checkout で作り直す））が成功したら、エクスプローラーのツリーも読み直す（`refreshTree`。ファイル監視もフォーカス時の再読込も無いため）。読み直しの失敗はツリー側のエラー表示に任せ、操作の結果は成功のまま。ブロックの選択・`解決済みにする` はファイルの有無を変えないので読み直さない（コードレビュー指摘で追加。それまでは `git rm` したファイルがツリーに残っていた）。
- **解決ビューを出すのはマージ中（`mergeInProgress`、`MERGE_HEAD` あり）だけ**。CLI の rebase・cherry-pick 等の途中（`MERGE_HEAD` が無い）の未解決ファイルは、従来どおり通常の diff で表示し、renderer は `getConflictFile` も呼ばない。rebase 中は ours/theirs の意味がマージと逆（`git checkout --ours` が upstream 側）で、「自分を採用」でユーザー自身の変更を捨ててしまうため（コードレビュー指摘で追加）。main 側も、解決ビューの 6 操作（`getConflictFile` と書き換える 5 操作）の先頭で `MERGE_HEAD` を確認し、無ければ `マージ中ではないため、コンフリクトを解決できません(リベース・チェリーピックなどの途中のコンフリクトは対象外です。ターミナルで解決してください)` で拒否する（何も読まず、書かない）。「変更」セクションの `+` の非表示・取り消しの操作の出し分けは、マージ中かどうかによらず、未解決なら従来どおり。
- 操作が失敗したときも、ビューを読み直す（エラーの文言は残す）。照合の失敗（エディタで手で解決して保存した・CLI で書き換えた等）の後に古いブロックが残り、「解決済みにする」が押せなくなるのを防ぐ（コードレビュー指摘で追加。それまでは成功時だけ読み直していた）。
- 操作の実行中フラグ・`pendingOperation`・全体ロックは、操作の後の読み直し（タブの再読込・ビューの読み直し）が終わるまで保つ。読み直しの間に古いダイジェストのままブロックのボタンを押せないようにするため（コードレビュー指摘で変更。それまでは読み直しの前に解放していた）。読み直しは読み取りだけ（ファイルの読み込みと `getConflictFile`）で、ロックを取る他の処理を待たないため、握り続けても互いに待ち合うことはない。

### 解決済みにする

- ファイルにコンフリクトマーカー（`<<<<<<<` `|||||||` `>>>>>>>` で始まる行。7 文字ちょうど）が残っていなければ `git add -- <file>` で解決済みにする。残っているときは、`コンフリクトのマーカーが残っています` で拒否する（手編集中に誤って確定しないため）。**`=======` は検査しない**: Markdown の見出し下線などの本文と区別できず、ブロックを解決した後も本文として残るため、検査すると解決済みにできなくなる。
- ファイルが存在しないときは、`ファイルが存在しないため解決済みにできません。「削除する」を使うか、ファイルを復元してください` で拒否する（削除として確定するのは「削除する」の役割）。シンボリックリンク・バイナリはマーカー検査を飛ばして `git add` する。
- ブロックを選び終えたら自動でステージはしない（選択と確定を分ける）。

### マージ中の他の操作の制限（マーカー入りのまま確定しない）

- 「変更」の `+`（`stageFile` = `git add`）は、未解決のファイルをマーカー入りのまま解決済み（`M `）にしてしまい、バナーが「すべて解決済み」になって、そのまま完了するとマーカー入りのマージコミットができる（実 git で再現済み）。二重に防ぐ: (a) `ChangesFileItem` は未解決（`isConflictedFile`）のファイルに `+` を出さない（取り消しボタンと同じ。ファイル名から解決ビューへ誘導する）。(b) main の `stageFile` は、`ls-files -u -z -- <literal pathspec>` にそのパスがあれば `コンフリクト中のファイルはステージできません。コンフリクト解決ビューの「解決済みにする」を使ってください` で拒否する。判定は `gitMergeState.isUnmergedPath` に切り出し、`gitDiscardClassifier` の `conflicted` 判定と共有する。ステージ済みや通常のファイルは従来どおり。
- コミット欄から: `commit` は未解決のファイルがあれば `未解決のコンフリクトがあるためコミットできません。解決するか、マージを中止してください`、`amendCommit` はマージ中（`MERGE_HEAD` あり）なら `マージ中のためコミットを修正できません。マージを完了または中止してください` で拒否する（git の英語の生のエラー `Committing is not possible because you have unmerged files` / `You are in the middle of a merge -- cannot amend.` を出さないため。どちらも何も実行しない）。未解決が無いマージ中の通常のコミットと、マージ中でない通常のコミット・amend は変えない。

### マージを完了

- 前提: `MERGE_HEAD` があり、未解決ファイル（`ls-files -u`）が 0 件。そうでなければ `未解決のファイルがあるため完了できません` / `マージ中ではありません` で拒否する。
- `git commit --no-edit` を実行する（`.git/MERGE_MSG` の既定メッセージ）。成功したら、ステータス・履歴を再取得し、開いているタブとツリーを再読込する。

### マージを中止

- 確認ダイアログ: `マージを中止して、マージ前の状態に戻しますか？ 解決済みの内容も含め、マージ中の変更は破棄されます。`。エディタに未保存の編集があれば、その破棄の確認も出す。
- `git merge --abort` を実行する。成功したら、ステータス・履歴を再取得し、開いているタブとツリーを再読込する。`MERGE_HEAD` が無いときは `マージ中ではありません` で拒否する。

### main の判定

#### コンフリクトの解析（純粋関数）

- `parseConflictFile(content)` が、ファイル内容を `Segment[]` に分ける: `{ kind: 'text', lines }` と `{ kind: 'conflict', ours, theirs, base?, oursLabel, theirsLabel }`。マーカーは行頭の `<<<<<<< ` / `||||||| ` / `=======` / `>>>>>>> ` で、7 文字ちょうど。改行コード（LF / CRLF）は**行ごとに**保って、書き戻しでも同じにする。解析時に行ごとの元の改行（`\r\n` / `\n` / 最終行で無ければ空）を `lineEnds` に記録し、`applyConflictChoices(parsed, choices)` は本文の行・選んだ側の行・残すマーカー行を、それぞれ元の改行のまま出力する（多数派の 1 種へ揃えない。LF と CRLF の混在や「CRLF のファイルで最終行だけ LF」でも、コンフリクトと無関係な行の改行は変わらない。コードレビュー指摘で変更。それまでは多数派の改行で結合していた）。選んだ側の行は直後にマーカー行が続くため必ず改行を持ち、`both` の境界で改行が欠けたり重なったりしない。ファイル末尾の改行の有無は元のとおりに保つ（元が改行なしで終わるなら、出力の最後の行の改行を除く。最終行が改行なしの終了マーカーの場合を含む）。ブロックのダイジェストは行の内容（`\r` を含まない）だけから作るため、改行コードでは変わらない（renderer との照合は従来どおり）。`ConflictFile.eol` は多数派の改行で、表示用の情報として残す。
- 閉じていないマーカー、順序の崩れ（`=======` が無い、`>>>>>>>` が無い）、ネストは「解析不能」として扱い、ビューにはブロックを出さずに `コンフリクトのマーカーを解析できません。エディタで直接編集してください` を表示する。本文中にマーカーに見える文字列（インデント付き、7 文字でない）は本文として扱う。

#### ブロックの解決（`resolveConflictBlocks(folderPath, filePath, expectedBlocks, choices)`）

0. `MERGE_HEAD` が無ければ拒否する（上記。ファイル単位の操作・解決済みにする・`getConflictFile` も同じ）。
1. `filePath` を、取り消しと同じ境界チェックと分類で検証する。**未解決（`ls-files -u` に含まれる）ファイルのみ**を対象とし、それ以外は `コンフリクト中のファイルではありません` で拒否する。
2. ファイルを実行時に読み直して解析する。確認時（renderer が表示した時点）のブロック構成 `expectedBlocks`（各ブロックの自分側・相手側の内容のダイジェスト列）と一致しなければ、何も書かずに `ファイルが変更されたため中止しました。開き直してください` で拒否する（パターン62）。
3. `choices` は、ブロックの番号 → `'ours' | 'theirs' | 'both'` の対応で、**未指定のブロックはそのまま残す**。範囲外の番号・列挙外の値は拒否する。
4. 選択を適用して書き戻す。書き込みは、一時ファイルへ書いてからリネームする（途中で壊れたファイルを残さない）。

#### ファイル単位の操作

- `resolveConflictWholeFile(folderPath, filePath, side: 'ours' | 'theirs')`: `git checkout --ours|--theirs -- <file>`（リテラル pathspec）。相手の版が無い（`UD` / `DU` などで一方が削除側）ときは、git が `does not have our version` で失敗するため、事前に `ls-files -u` のステージ番号（2 = 自分、3 = 相手）で存在を確認し、無ければ `この側にはファイルがありません。「ファイルを残す」か「削除する」を選んでください` で拒否する。採用した後は、`解決済みにする` で確定する。
- `keepConflictFile(folderPath, filePath)`: 作業ツリーにファイルが残っている場合の `git add -- <file>`。`removeConflictFile(folderPath, filePath)`: `git rm -- <file>`。
- サブモジュール（`getConflictFile` は `ls-files -u` のどれかのステージの mode が `160000`（gitlink）なら、作業ツリーを調べずに `reason: 'submodule'` を返す）: `resolveConflictBlocks` / `resolveConflictWholeFile` / `keepConflictFile` / `removeConflictFile` / `markConflictResolved` はすべて `サブモジュールのコンフリクトはターミナルで解決してください(…)` で拒否し、git を呼ばない。判定は作業ツリーの lstat（ディレクトリ）ではなくステージの mode で行う（通常のディレクトリとファイルの衝突は git がファイルを `<path>~HEAD` へ退避するため、未解決のパスがディレクトリになるのは実質サブモジュールだけだが、mode の方が確実）。

#### マージ中のステータス・完了・中止

- `getGitStatus` に `mergeInProgress`（`rev-parse -q --verify MERGE_HEAD` が空でない）を足す。
- `completeMerge(folderPath)`: 上記の前提を検証して `git commit --no-edit`。コミッター情報が無いなどの失敗は git のエラーをそのまま投げる。
- `abortMerge(folderPath)`: `MERGE_HEAD` を確認して `git merge --abort`。

### 実機で確認した git の挙動（git 2.50.1）

- マージがコンフリクトすると `MERGE_HEAD` が残り、`status` は `UU`（両方変更）/ `AA`（両方追加）/ `DU`（自分が削除・相手が変更）などを出す。マーカーは `<<<<<<< HEAD` / `=======` / `>>>>>>> <ブランチ名>`。
- `git checkout --ours|--theirs -- <file>` はファイルを書き換えるが、status は `UU` のまま（`git add` で解決済みになる）。`DU` のファイルに `--ours` を使うと `path 'del.txt' does not have our version` で失敗し、`--theirs` は成功する。`AA` とバイナリ（`UU`）は `--ours|--theirs` が使える。
- 未解決のファイルがあるうちの `git commit --no-edit` は `Committing is not possible because you have unmerged files.` で失敗する。解決して `git add`（削除は `git rm`）すると、`git commit --no-edit` が `Merge branch '<ブランチ名>'` のコミットを作り、`MERGE_HEAD` が消える。
- 解決の結果がコミット済みの内容と同じになると、`status` には出ない（`M` も付かない）。
- サブモジュール（gitlink、mode `160000`）の `UU` では、`git checkout --theirs -- <sub>` が終了コード 0 のまま index も作業ツリーも変えず `UU` のまま残る。続けて `git add <sub>` すると、作業ツリーのサブモジュールの HEAD（自分側のコミット）がステージ 0 に記録される。`git rm -- <sub>` はサブモジュールの作業ツリーを消し、`.gitmodules` からも外す。ディレクトリとファイルの衝突（一方が `a` をファイル、他方が `a/x` を追加）では、git がファイルを `a~HEAD` へ退避し、未解決のパスは `a~HEAD`（通常ファイル）になる。

### 実行中・他操作中の表示

- バナーの完了・中止、ブロックの選択、ファイル単位の操作は、全体ロック（`lockGlobal`）を取り、実行中のステージ・コミット・ブランチ操作・退避・取り消しと相互に待つ。実行中の他の操作のためにボタンが押せないときは `disabled` にする（押して何も起きない状態にしない）。
- busy の判定は退避（`useGitStashOperations`）と同じ: 自分の busy ref + `lock.isAnyLocked()` + リポジトリの有無。確認ダイアログの拒否ではロックを取らない。

### キーボード操作・アクセシビリティ

- バナーは `role="status"`（件数の変化を読み上げる）、エラー表示は `role="alert"`。ボタンの `aria-label` は仕様のとおり。選んだブロックはファイルが書き換わってビューから消える。結果は `role="status"` で `ブロック N を自分の内容にしました` のように読み上げ、フォーカスは次のブロックの先頭のボタンへ移す。
- タップ領域は 32px 以上。ダークテーマの配色は、既存の危険系ボタン・差分表示に合わせる。

### エラーハンドリング

| 状況                                                     | 動作                                                                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| マージがコンフリクトした                                 | `conflict` の結果で返り、パネル上部に `コンフリクトしました（…）。解決するか、マージを中止してください`。タブを再読込し、ステータスを再取得してバナーを出す。完了・中止の成功で消える                   |
| 解決ビューを開いたが、ファイルが解決済み（未解決でない） | ビューを出さず、通常の diff を表示する                                                                                                                                                                  |
| ブロック構成が確認時と違う                               | 何も書かず `ファイルが変更されたため中止しました。開き直してください`。ビューを読み直す（エラーの文言は残す。他の操作の失敗でも読み直す）                                                               |
| マージ中でない（CLI の rebase・cherry-pick 等）の未解決  | 解決ビューを出さず通常の diff を表示する。main の解決操作は `マージ中ではないため、コンフリクトを解決できません(…)` で拒否                                                                              |
| マーカーが残ったまま「解決済みにする」                   | `コンフリクトのマーカーが残っています`                                                                                                                                                                  |
| ファイルが無いまま「解決済みにする」                     | `ファイルが存在しないため解決済みにできません。「削除する」を使うか、ファイルを復元してください`                                                                                                        |
| 未解決が残ったまま「マージを完了」                       | ボタンは disabled。直接呼ばれたら main が拒否                                                                                                                                                           |
| 未解決のファイルをステージ(`stageFile`)                  | ボタンを出さない。直接呼ばれたら main が `コンフリクト中のファイルはステージできません。…` で拒否                                                                                                       |
| 未解決があるまま `commit` / マージ中の `amendCommit`     | main が日本語のエラーで拒否（何も実行しない）                                                                                                                                                           |
| 解析不能なマーカー                                       | ビューに `コンフリクトのマーカーを解析できません。エディタで直接編集してください`                                                                                                                       |
| サブモジュール（gitlink）のコンフリクト                  | 解決のボタンを出さず、ビューに `サブモジュールのコンフリクトです。…ターミナルで git add して解決してください`。main の解決操作は `サブモジュールのコンフリクトはターミナルで解決してください(…)` で拒否 |

### 既知の制約

- 解決の結果がコミット済みの内容と同じになると `status` に出ないため、「解決済みにする」を押すまで未解決の件数に残る（`ls-files -u` で数える）。
- ブロックの選択と、エディタでの保存（Cmd+S）が重なると、ブランチ切り替えや退避と同じ種類の競合がある（確認時のブロック構成との照合で、ずれたら何も書かずに中止する）。
- 1 回のマージで、同時に解決できるのは 1 ファイルずつ。ファイルが非常に大きい場合の表示の打ち切りは行わない。
- rebase・cherry-pick・revert の途中、stash の復元のコンフリクトは対象外（`MERGE_HEAD` が無いため、解決ビューを出さず、main も解決操作を拒否する）。
- マーカーの検査は `<<<<<<<` / `|||||||` / `>>>>>>>` だけで、`=======` は検査しない。`<<<<<<<` と `>>>>>>>` を消して `=======` だけ残す手編集は見逃す。
- サブモジュール（gitlink）のコンフリクトはアプリ内で解決できない（ターミナルで、サブモジュールの中で採用するコミットを選んでから `git add` する）。サブモジュールとファイルの衝突（片側だけ gitlink）も同じ扱い。片側が削除した衝突（`UD` / `DU`）では案内の末尾に `（削除する場合は git rm）` を足す（`git add` だけでは `.gitmodules` から消えたまま gitlink が残るため）。
- `.gitattributes` の `working-tree-encoding=UTF-16` を明示したファイルは、マーカーも UTF-16（NUL を含む）になるため、バイナリ扱いで検査が飛ぶ。
- パネル上部の `コンフリクトしました（…）。解決するか、マージを中止してください` は、マージ中が解除されたときに消える（バナーの「マージを完了」「マージを中止」、コミット欄でのマージの完了、外部ターミナルの `merge --abort` のいずれでも消える）。当初はバナーの経路（`useMergeState.onFinished`）だけで消していたが、SRP レビューの対応で状態に連動させる形に変えた

## アーキテクチャ

### main プロセス

- `src/main/gitConflictParser.ts`（新規）: `parseConflictFile`、ブロックの選択を適用する `applyConflictChoices`（ブロックの番号の範囲検査を含む。キーは 0 始まりの正規の 10 進表記だけ）、ブロックのダイジェスト（`digestConflictBlocks`）、マーカーの残りの判定 `hasConflictMarker`（解析と同じ「7 文字ちょうど、または直後が半角スペース」の規則を共有する）。純粋関数。
- `src/main/gitConflictService.ts`（新規）: `getConflictFile`（読み取りと解析）、`resolveConflictBlocks`、`resolveConflictWholeFile`、`keepConflictFile`、`removeConflictFile`、`markConflictResolved`（マーカーの判定は parser の `hasConflictMarker`）、`completeMerge`、`abortMerge`。`resolveConflictBlocks` は選択の値（`CONFLICT_CHOICES`）だけを検査し（違反は `Invalid choices`）、番号の範囲は `applyConflictChoices` に任せる（違反は `ブロックの番号が範囲外です`）。分類・境界チェックは `gitDiscardClassifier` の考え方に揃え、未解決の判定は `gitMergeState.ts` の `getUnmergedStages` / `hasUnmergedFiles`（`ls-files -u`）を使う。
- `src/main/gitService.ts`: `mergeBranch` の自動中止の分岐の変更（コンフリクトは `MergeBranchResult` の `conflict` で返す）、`getGitStatus` の `mergeInProgress`、`stageFile` / `commit` / `amendCommit` の拒否。`abortFailedMerge` は、未解決ファイルが 0 件のときだけ使う。
- `src/main/gitMergeState.ts`: `hasMergeInProgress` に加え、未解決の判定（`ls-files -u`）を持つ。ステージ番号を返す `getUnmergedStages`、それを使う `isUnmergedPath`、`hasUnmergedFiles`、未解決のパスの一覧 `listUnresolvedFiles`（`diff --name-only -z --diff-filter=U`。`gitService.ts` のマージと `gitStashService.ts` の復元で共有する）。`gitConflictService.ts` はこれらを import して使い、判定を自前では実装しない。
- `src/main/handlers/gitHandlers.ts`: IPC `git:getConflictFile` / `git:resolveConflictBlocks` / `git:resolveConflictWholeFile` / `git:keepConflictFile` / `git:removeConflictFile` / `git:markConflictResolved` / `git:completeMerge` / `git:abortMerge`。引数の型検証と、パスは取り消しと同じ境界チェック。
- `src/shared/types/git.ts`: `GitStatusResult.mergeInProgress`、`MergeBranchResult`、`ConflictSegment` / `ConflictFile`（`stages`・`unparsable` の `reason`）/ `ConflictChoice` の型と、値の `CONFLICT_CHOICES`（型はそこから導出。service と handler の検証が参照する）。

### preload / renderer lib

- `src/preload/api.ts` / `index.d.ts` / `src/renderer/src/lib/gitApi.ts`: 上の IPC。
- `src/renderer/src/lib/mergeStateMessage.ts`（新規）: バナーの件数の文言、中止の確認文言。
- `src/renderer/src/lib/conflictActions.ts`（新規）: `getConflictActions`。ファイルの `stages` と状態から、出す操作（すべて採用・残す・削除する・解決済みにする）を決める純関数。ボタンの出し分けと解析不能のときの案内文言が同じ規則を使う。
- `src/renderer/src/lib/conflictChoice.ts`（新規）: 選択（`ours` / `theirs` / `both`）の表示用の文言。

### renderer フック

- `src/renderer/src/hooks/useMergeState.ts`（新規）: 完了・中止の操作（確認 → `lockGlobal` → 実行 → 成功時の全タブ・ツリーの再読込）。`useDiscardAllChanges` と同じ作り。
- `src/renderer/src/hooks/useConflictFile.ts`（新規）: 開いているコンフリクトファイルの読み込み、ブロックの選択、ファイル単位の操作、解決済みにする。未保存編集の確認とタブの再読込は、ファイル単位の同期（`useDiscardHunk` と同じ作り）。削除・残す・すべて採用の成功後は、`useMergeState` と同じ流儀で注入した `refreshTree` でツリーを読み直す（ロックを握ったまま、タブの再読込の後。`refreshTree` はファイル操作のロックを取らない）。
- `useAppState.ts`: 上の 2 つを 1 呼び出しずつ組み立てる。

### renderer コンポーネント

- `MergeBanner.tsx`（新規）: バナー。
- `ConflictResolver.tsx`（新規）: 解決ビュー（ブロックの並び、ボタン、ファイル単位の操作）。`ConflictBlock.tsx`（新規）: 1 ブロックの表示と 3 ボタン。`ConflictLines.tsx`（新規）: 行の並びの描画（空行は空白 1 文字）。`ConflictResolver` のテキスト部分と `ConflictBlock` の各側で共有する。ボタンの見た目は `.merge-banner__button` / `.conflict-resolver__button` / `.conflict-block__button` を既存の `.stash-section__push` / `.stash-section__action` と同じ 1 つのグループセレクタに入れて共有する（危険系のホバーは各 `--danger`）。`解決済みにする` だけは `.conflict-resolver__button--primary` でコミットボタンと同じ青に強調し、disabled のときは強調しない。
- `EditorPanel.tsx`: アクティブな diff タブのファイルが未解決のときだけ、`DiffView` の代わりに `ConflictResolver` を出す。
- `SourceControlPanel.tsx` / `GitRepoView.tsx` / `Sidebar.tsx` / `App.tsx`: バナーの props の配線（取り消し・退避と同様に、マージ中の状態と操作は 1 つのオブジェクトにまとめる）。

## テスト方針

- `gitConflictParser.test.ts`: 複数ブロック、diff3 の base、CRLF（書き戻しで保つ）、行ごとの改行の保持（LF と CRLF の混在、CRLF のファイルの最終行だけ LF、改行なしで終わる終了マーカー、`both` の境界、ダイジェストが改行コードに依存しない）、マーカーに見える本文（インデント付き・6 文字・8 文字）、閉じていない/順序の崩れ/ネスト（解析不能）、空のブロック（片側が空）、`both` の連結順、未指定ブロックの保持、ダイジェストが内容の変化で変わる。
- `gitConflictService.test.ts`（モック）と `gitConflictService.integration.test.ts`（実 git。環境から隔離）: 実際にマージのコンフリクトを作り、ブロックの解決 → 解決済み → 完了。中止で元に戻る。確認時とブロック構成が変わったら何も書かない。`UD` / `DU` / `AA` / バイナリのファイル単位の操作（`--ours` が使えない側の拒否）。未解決のままの完了の拒否。マーカーが残ったままの「解決済みにする」の拒否。未解決でないファイルの拒否。自動中止の変更（コンフリクトは結果で返り `MERGE_HEAD` とマーカーが残る / 未解決が 0 件で `MERGE_HEAD` が残るなら中止）。マージ中の `stageFile` / `commit` / `amendCommit` の拒否と、通常の成功。CLI の rebase 中（`MERGE_HEAD` なし）は `getConflictFile` と書き換える 5 操作を拒否し、作業ツリーと index を変えない。CRLF の本文で最終行だけ LF のファイルを ours で解決しても、最終行は LF のまま。
- `gitMergeState.test.ts`: `getUnmergedStages`（ステージ番号の取り出し・別パスを数えない）、`isUnmergedPath` / `hasUnmergedFiles`、`hasMergeInProgress`（reject は throw）、`listUnresolvedFiles`。
- `conflictActions.test.ts`: `stages`（両側・片側・DD）× 状態（parsed・解析不能の各 reason）ごとの操作の出し分け。`submodule` はどの `stages` でもボタンを出さない。
- `gitHandlers.test.ts` / `api.test.ts` / `gitApi.test.ts`: 引数検証と素通し。
- `ChangesFileItem.test.tsx`（未解決の行に `+` が無い・通常の行にはある）、`useGitBranchOperations.test.ts`（`conflict` で error セット + `true`、例外は `false`、マージ中の解除で通知だけが消える）、`useMergeState.test.ts`、`ConflictLines.test.tsx`、`MergeBanner.styles.test.tsx`、`ConflictResolver.styles.test.tsx`（`解決済みにする` の強調色。disabled のときは強調しない）、`useConflictFile.test.ts`、`MergeBanner.test.tsx`、`ConflictResolver.test.tsx`、`ConflictBlock.test.tsx`、`EditorPanel.test.tsx`（未解決のときだけ解決ビュー）、`useAppState.test.ts`: 確認の順序、ロック、成功時だけの再読込、未保存編集の確認、ボタンの disabled、`aria-label`、選択結果の表示。
- 実機テスト仕様書に新しい領域（接頭辞 `CNF`）を追記する（CLAUDE.md のルール）。

## 実装順序

1. 型（`mergeInProgress`、`ConflictFile` ほか）、`gitConflictParser.ts` と単体テスト
2. `gitConflictService.ts`（読み取り・ブロック解決・ファイル単位・解決済み・完了・中止）と統合テスト
3. `mergeBranch` の自動中止の変更と `getGitStatus` の `mergeInProgress`（既存のマージのテストの更新）
4. IPC・preload・`gitApi`
5. `useMergeState` / `useConflictFile`、`useAppState` の組み立て
6. UI（`MergeBanner` / `ConflictResolver` / `ConflictBlock` / `EditorPanel` の分岐）と配線、CSS
7. ROADMAP の更新、実機テスト仕様書への追記、Artifact の再公開、全体の検証
