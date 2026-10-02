# タグの作成 設計書

作成日: 2026-10-03 / 対象: ROADMAP の「タグの作成」

## 目的

ソース管理パネルから、現在の HEAD に Git のタグを作成できるようにする。リリース時に最も多い使い方
（HEAD に `v1.0.0` を付ける）を、アプリ内で完結させる。軽量タグと注釈付きタグを選べる。

## 範囲

### 含める

- 現在の HEAD へのタグの作成（軽量 / 注釈付き）
- 履歴セクションの見出しの「タグを作成」ボタンと、作成ダイアログ
- 名前の検証（アプリ独自の規則 + git の規則）、重複・衝突の事前拒否（日本語）
- 作成後の履歴・タグ一覧の再取得

### 含めない（ROADMAP に見送り項目として残す）

- 履歴の任意のコミットへのタグ付け（対象は HEAD のみ）
- タグのリモートへの送信（push）
- タグの削除
- タグの署名（GPG）の UI。署名の設定（`tag.gpgSign` 等）はユーザーの設定に従い、アプリは上書きしない

## 振る舞い

### ダイアログ

- 項目: タグ名（必須）、種類（`軽量` / `注釈付き`。既定は軽量）、メッセージ（種類が注釈付きのときだけ表示。必須）
- 種類の選択は `role="radiogroup"` と各選択肢の `role="radio"` + `aria-checked`（CLAUDE.md の規約）
- 名前は前後の空白を除き、Unicode の NFC にそろえる（共有の `normalizeTagName`。`trim()` の直後に `normalize('NFC')`）。検証も送信値もこの名前を使う。クライアント側の検証は UX 用で、セキュリティ境界は main 側
- 検証エラーはダイアログ内に表示し、作成ボタンを disabled にする。作成の失敗（main のエラー）はダイアログ内に `role="alert"` で表示し、ダイアログは閉じない
- 実行中は二重送信を防ぐ（作成ボタンと入力を disabled）
- 作成中は、ダイアログ（`form`）に `aria-busy="true"` を付け、ダイアログ内に `role="status"` の案内 `作成中です。署名の入力待ちなどで最大 2 分かかることがあります` を出す（既存の説明文と同じ `create-tag-dialog__note` の見た目）。入力欄とボタンが disabled になりフォーカスが body に落ちるため、ボタンの `作成中...` だけではスクリーンリーダーに伝わらない。案内は完了・失敗で消え、失敗は `role="alert"` が伝える。「2 分」は main の `TAG_CREATE_TIMEOUT_MS`（120 秒）に合わせた renderer 側の定数で、値を変えるときは両方を直す（PR #41 の 2 周目のレビューで追加）
- 作成中は `キャンセル`・Escape・オーバーレイのクリックでダイアログを閉じず（`キャンセル` は disabled）、履歴の `タグを作成` ボタンも押せない。作成中に閉じると、遅れて届いた失敗を見る手段が無くなり（開き直すと前回の失敗の表示を消すため）、遅れて届いた成功が別の場所のフォーカスを奪い、開き直したダイアログが前の作成の成功で閉じられる（署名付きの注釈付きタグでパスフレーズの入力を待つ間など、作成が長引くときに起きる）。作成が終わらないままにならないよう、main が 120 秒で打ち切って失敗を返す（「main の検証と実行」9）
- 成功したらダイアログを閉じ、履歴セクションのタグ一覧とログを再取得する。フォーカスはボタンへ戻す
- フォーカスの扱い（再レビューで追加）:
  - ダイアログを閉じたら（成功・キャンセル・Escape・オーバーレイのクリック）`タグを作成` ボタンへ戻す。閉じる時点で直接 `focus()` すると、成功の経路では作成中フラグの解除がまだ描画に反映されておらず、`disabled` のボタンへの `focus()` が無視されて body に落ちる（パターン 73）。そのため閉じるときは「戻す予約」を立てるだけにし、ダイアログが閉じて作成中でもなくなった描画の後（`useEffect`）で戻す。予約は閉じたダイアログに対してだけ立ち、`HistorySection` のアンマウントで消える
  - **奪わない条件**: 戻すのは、その時点のフォーカスが body（閉じたダイアログの中にあった要素が消えて落ちた）のときだけ。作成中にユーザーがダイアログの外の要素へフォーカスを移していたら、遅れて届いた成功で奪わない
  - 作成中は入力欄と作成ボタンが `disabled` になり、ブラウザはフォーカスを body に落とす。失敗して作成中が解けたとき（ダイアログは開いたまま）、フォーカスが body かダイアログ内にあれば `タグ名` の入力欄へ戻す（Escape がフォームに届き、閉じられるようにする）。`readOnly` / `aria-disabled` でフォーカスを保つ案は、パネルのボタン（退避・マージのバナー等）が実行中に `disabled` にする流儀と揃えるため採らない

### main の検証と実行（`createTag`）

0. 入口で名前を `normalizeTagName`（`@shared/tagName`。前後の空白を除き NFC にそろえる。renderer と同じ関数）に通す。以後の検証・衝突の判定・`git tag`・作成の確認は、すべてこの名前で行い、文言の `<name>` もこの名前にする（`check-ref-format --normalize` は NFD をそのまま返すため、ここで正規化しないと NFC の既存タグとの照合をすり抜ける。実装プランの「設計書との差分」10）
1. 名前の規則（`@shared/tagName`。renderer と main が同じ判定を使う）:
   - 空 → 拒否
   - `-` で始まる → `` `-` で始まるタグ名は使用できません: <name> ``（git にオプションと解釈されるため。パターン 21）
   - `@`、または大文字小文字を問わず `head` → `タグ名として使用できない名前です: <name>`（予約名。`check-ref-format` は `HEAD` と `@` を通すが、`HEAD` は `git tag` が拒否し、`@` のタグは以後の HEAD の解決を曖昧にし、`head` は大文字小文字を区別しない FS で `.git/HEAD` に解決されてタグに届かない。実装プランの「設計書との差分」4 で追加）
2. git の規則は `git check-ref-format --normalize refs/tags/<name>` に委ねる。出力（trim）が入力（`refs/tags/` を付けた形）と完全一致しなければ `タグ名として使用できない名前です: <name>` で拒否する（`--normalize` が無いと成功時も何も出力しない。失敗・正規化で別の名前になるもの・reject のいずれも通さない。パターン 25・74）
3. 既存のタグと同名（既存のタグ名も NFC にそろえて比べる）→ `同じ名前のタグが既に存在します: <name>`
4. 階層が衝突する既存タグ（`v1` と `v1/x`）、または大文字小文字だけが違う既存タグ（NFC にそろえ、Unicode の完全な case folding に近い形で大文字小文字を無視して判定。`ß` と `ss`、`ſ` と `s` なども同じ名前とみなす）→ `既存のタグ <existing> と名前が衝突します: <name>`
5. **既存のローカルブランチと同名（NFC にそろえ、4 と同じく大文字小文字を無視）→ 拒否**: `同じ名前のブランチが存在するため、タグを作成できません: <name>`。大文字小文字を区別しない FS では、タグ `FEAT` がブランチ `feat` の解決を奪うため、FS に関わらず大文字小文字を無視して判定する（実装プランの「設計書との差分」5）。同名のタグとブランチが共存すると、`git merge <name>` などが `refs/tags` を優先して別のコミットを選ぶ（ROADMAP の既知の問題、パターン 43）ため、アプリの側から作らない
   - 3〜5 の判定と順序は renderer と共有する `getTagNameCollision`（`@shared/tagName`）が持つ。main はタグ・ブランチの一覧を先に両方取得してから呼び、種類ごとの文言の表を引く
6. HEAD がコミットを指していない（コミットが 1 つも無いリポジトリ）→ `コミットが無いため、タグを作成できません`
7. 注釈付きのとき（メッセージの規則は renderer と共有する `getTagMessageRuleViolation`）: メッセージが空（空白のみを含む）→ `注釈付きタグにはメッセージが必要です`。NUL を含む → `メッセージに使用できない文字が含まれています`。コミッター情報（`git var GIT_COMMITTER_IDENT` で確認）（`user.name` / `user.email`）が解決できない → `コミッター情報（user.name / user.email）が未設定のため、注釈付きタグを作成できません`（git の英語のエラーを見せる前に弾く）
8. 実行:
   - 軽量: `git tag --no-sign -- <name> HEAD`（付ける先を `HEAD` と明示する）。`tag.gpgSign=true` の環境で `--no-sign` が無いと「署名付きの注釈付きタグ」に変わり、エディタを起動して待つ。軽量タグは署名できないため、軽量の意味を保つだけで署名の方針は上書きしない（パターン 45）
   - 注釈付き: `git tag --cleanup=whitespace --message=<message> -- <name> HEAD`（`-a` を付けない。`--message` だけで注釈付きになる）
   - メッセージは `--message=<message>` の 1 つの引数として渡す。`-m <message>` の 2 引数だと、simple-git が `--upload-pack=...` などの値をオプションとみなして拒否する。先頭が `-` でも値として扱われることを実 git で確認する（パターン 49）。`--cleanup=whitespace` は、既定の strip が `#` で始まる行を消すのを防ぐ
9. `tag.gpgSign` / `tag.forceSignAnnotated` などで git が失敗した場合は、git のメッセージを添えて `タグを作成できませんでした: <detail>`（署名の設定は上書きしない）。タグ・ブランチの一覧（`for-each-ref`）の reject も同じ文言にする（英語の GitError をそのまま見せない。パターン 74）
   - 時間内に終わらない場合: 署名付きの注釈付きタグでは、`git tag` がパスフレーズの入力（gpg の pinentry・`ssh-keygen -Y sign`）を待っていつまでも終わらないことがある（実機 git 2.50.1 で確認）。ただし `ssh-keygen` が入力を待つのは端末から起動した場合だけで、制御端末の無い環境では入力を待たずに失敗する（PR #41 の 2 周目のレビューで、0.01 秒で終了コード 128 になったことを確認）。パッケージ版（GUI から起動）で時間切れになるのは主に gpg の pinentry の入力待ち。作成中はダイアログを閉じられないため、simple-git の timeout プラグイン（`timeout: { block }`。stdout / stderr に何も出ない時間）で 120 秒（`TAG_CREATE_TIMEOUT_MS`。GUI の pinentry での入力に足りる長さ）で git を止め、`タグの作成が時間内に終わりませんでした（署名のパスフレーズの入力待ちなど）: <name>` を返す（PR #41 のレビューで追加）。git が ref を書くのは署名の後のため、打ち切ってもタグも ref のロック（`refs/tags/<name>.lock`）も残らず、そのまま再試行できる（実機で確認）
10. 作成の確認: `git rev-parse -q --verify refs/tags/<name>`（`<name>` は NFC にそろえた名前） が空、または reject なら `タグを作成できませんでした`（detail があれば添える）。終了コード 0 は効果があったことを意味しない（パターン 69。実装プランの「設計書との差分」6 で追加）

### 状態ごとの扱い

- マージ中・detached HEAD・rebase / bisect の途中: タグの作成は許可する（ref を 1 つ増やすだけで、作業ツリー・index・HEAD を変えない。付ける先は常に今の HEAD）
- 作業ツリー・index・HEAD は変わらないので、エディタのタブやファイルツリーの再読込、未保存編集の破棄確認は不要
- 排他: タグの作成中は他のタグ作成を受け付けない（実行中フラグ）。push / pull / ブランチ操作とは、読み書きする対象が重ならないためロック（`lockGlobal`）は取らない（ブランチの削除と同じ判断）。ただし他の Git 操作がロックを持っている間（`lock.isAnyLocked()`。checkout・マージ・commit の途中は HEAD が動く）は実行せず、`タグを作成` と `作成` を disabled にする（実装プランの「設計書との差分」9）

## アーキテクチャ

### main

- `src/shared/tagMessage.ts`（新規）: `getTagMessageRuleViolation(kind, message)`（`empty` / `nul`。軽量は常に null。注釈付きで trim 後が空 → `empty`、NUL を含む → `nul` の順）。main の `assertAnnotatable` と renderer の `validateTagMessage` が同じ判定を使い、文言はそれぞれの側に持つ
- `src/shared/tagName.ts`（新規）: `normalizeTagName(name)`（前後の空白を除き NFC にそろえる。renderer の送信値と main の入口が使う）、`getTagNameRuleViolation(name)`（`empty` / `leading-dash` / `reserved`）、`getTagNameCollision(name, existingTags, existingBranches)`（`{ kind: 'duplicate' | 'conflict' | 'branch'; with: string } | null`。既存のタグと一致（NFC にそろえて比べる）→ 衝突するタグ（`branchName.ts` の階層衝突の判定と同じ考え方に、大文字小文字だけの違いを加え、NFC にそろえて大文字小文字を無視して判定）→ 同名のブランチ（NFC にそろえ、大文字小文字を無視）の順で判定する。大文字小文字の無視は、APFS が同じ名前とみなす組（`ß` と `ss` など）にも合わせるため、1 文字ずつ小文字 → 大文字 → 小文字に変換して比べる（`ı` は除く。実装プランの「設計書との差分」11）。`with` は文言に使う既存の名前。main の `assertNoNameCollision` と renderer の `validateTagName` がこの順序を共有し、文言はそれぞれの側に種類ごとの表で持つ。片方だけ順序を変えて「ダイアログは通るのに main で拒否」が起きないようにする）
- `src/main/gitTagService.ts`（新規）: `createTag(folderPath, { name, kind, message })` と、検証をまとめた `assertCreatableTag`。`gitService.ts` に足さない（単一責任。パターン 55）
- `src/main/handlers/gitHandlers.ts`: `git:createTag` を追加。引数の検証（`assertCreateTagArg`: オブジェクトであること、`name` は文字列、`kind` は `'lightweight' | 'annotated'`、`message` は文字列。余分なキーを無視する）を行ってから呼ぶ
- `src/preload/api.ts` / `index.d.ts`: `createTag(request)` を追加
- `src/shared/types/git.ts`: `CreateTagRequest`（`{ name: string; kind: TagKind; message: string }`）、`TagKind`

### renderer

- `src/renderer/src/lib/gitApi.ts`: `createTag(request)`
- `src/renderer/src/lib/tagValidation.ts`（新規）: ダイアログ用の検証と文言（`validateTagName(name, existingTags, existingBranches)` と `validateTagMessage(kind, message)`。メッセージの規則は `@shared/tagMessage` を main と共有する）
- `src/renderer/src/components/source-control/CreateTagDialog.tsx`（新規）: 名前・種類・メッセージの入力。`NameInputDialog` が名前だけの前提なら、同じ見た目の枠（既存のダイアログのスタイル）を使って別コンポーネントにする
- `src/renderer/src/hooks/useGitTagOperations.ts`（新規）: `createTag(request): Promise<boolean>`（`useRunExclusiveGitOperation` を使う。成功・失敗のどちらでも履歴とタグを再取得）、`isCreating`、`error`、`clearError`（ダイアログを開くときに前回の失敗の表示を消す。実装プランの「設計書との差分」8）
- `HistorySection.tsx`: 見出しの右に「タグを作成」ボタン（`aria-label="タグを作成"`）。履歴の再取得は `useGitHistory` の既存の仕組みを使う
- `useAppState` が `useGitTagOperations` を呼び、`gitTag`（`GitTagPanelState`）を App → Sidebar → SourceControlPanel → GitRepoView → HistorySection へそのまま渡す（退避・マージ状態の配線に揃える）。ダイアログの開閉は HistorySection が自前の state で持ち、`isBlocked`（GitRepoView が計算）は HistorySection に渡す

## エラーハンドリング

| 状況                                     | 動作                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 名前が空 / `-` 始まり / 予約名           | ダイアログ内に日本語で表示。main も同じ理由で拒否                                                                     |
| git の規則に違反（`a..b` など）          | ダイアログでは判定せず、main が `タグ名として使用できない名前です: <name>` で拒否して表示                             |
| 既存のタグと同名 / 衝突（大小文字無視）  | ダイアログ内に日本語で表示（renderer の一覧で事前に弾く。main も最終判断）                                            |
| 既存のブランチと同名（大小文字無視）     | 同上（ブランチとの曖昧さを作らない）                                                                                  |
| コミットが無い                           | main が日本語で拒否。ボタンの表示は出したまま、押すとダイアログ内に表示                                               |
| 注釈付きでメッセージが空 / NUL を含む    | 作成ボタンを disabled にし、理由を表示。main も拒否                                                                   |
| コミッター情報が未設定（注釈付き）       | main が日本語で拒否                                                                                                   |
| 署名の失敗など git のエラー              | `タグを作成できませんでした: <detail>` をダイアログ内に表示                                                           |
| 署名の入力待ちなどで 120 秒終わらない    | git を止め、`タグの作成が時間内に終わりませんでした（署名のパスフレーズの入力待ちなど）: <name>` をダイアログ内に表示 |
| 作成中に再度押す                         | 二重送信しない                                                                                                        |
| 作成と同時にタグが他のプロセスで作られた | git が拒否。`タグを作成できませんでした: <detail>`（競合は対象外とし、データは失われない）                            |

## 既知の制約

- 署名付きタグ（`-s`）は UI にない。`tag.gpgSign=true` / `tag.forceSignAnnotated=true` の環境では、注釈付きタグの作成にパスフレーズの入力が必要になると、入力されるまで `git tag` が終わらない（PR #41 のレビューまでは無期限に待っていた）。120 秒で打ち切ってダイアログ内に失敗を表示する（「main の検証と実行」9）。打ち切るのは git だけで、git が起動した署名プログラム（`gpg.program` など）は止められず、入力を待ったまま残りうる（gpg の pinentry は表示されたまま残る。入力されても署名を書き出す先の git が無いため、タグは作られない）。`ssh-keygen -Y sign` は git と一緒に終わった（実機 git 2.50.1 で確認）
- 注釈付きタグに `-a` を付けないのは、明示した `-a` が `tag.forceSignAnnotated=true` を黙って無効にし、署名なしのタグを作ってしまうため（実機 git 2.50.1 で確認。パターン 45）
- タグ名の大文字小文字だけが違う名前（`v1` と `V1`、`v1` と `V1/x`）は、大文字小文字を区別しないファイルシステムで既存のタグの解決を奪いうる（packed-refs の `v1` に対して `V1` が作られる）ため、FS に関わらず `既存のタグ <existing> と名前が衝突します: <name>` で拒否する（実装プランの「設計書との差分」5 で変更）
- 大文字小文字の無視は、macOS の APFS が同じ名前とみなす組にもそろえる。APFS は Unicode の完全な case folding で名前を比べるため、`ß` と `ss`・`ẞ`、`ſ` と `s`、`µ` と `μ`、`ας` と `ασ`、`ﬁ` と `fi` なども、`toLowerCase` だけでは一致しないのに同じ名前になり、packed-refs の `ss` があると `ß` のタグが終了コード 0 で作られて `ss` の解決を奪う（実機 git 2.50.1 / APFS で確認）。これらも FS に関わらず衝突（ブランチなら同名）として拒否する。APFS が別の名前として扱う `ı` と `i`、`İ` と `i` は衝突させない。Unicode の全文字の単一文字の組で APFS と一致することを確認し、過剰な拒否は見つからなかったが、JavaScript（Node.js）の Unicode のバージョンが APFS より新しい文字では、APFS が区別する名前を衝突として拒否しうる（安全側）。大文字小文字を区別する FS（Linux など）では本来共存できる `ß` と `ss` も拒否する（`v1` と `V1` と同じ扱い）。実装プランの「設計書との差分」11
- タグ名と同名の `refs/remotes/<remote>/<branch>`（例: `origin/main` という名前のタグ）は拒否しない。`refs/tags` が優先されるため、作成後は `git merge origin/main` などがリモート追跡ブランチではなくタグを選ぶ（パターン 43）。`ORIG_HEAD` / `FETCH_HEAD` / `MERGE_HEAD` などの擬似 ref と同名のタグも作れる（擬似 ref の解決が優先されるため、タグには短い名前で届かない）
- タグ名は常に Unicode の NFC にそろえて作る（NFD で入力・貼り付けしても NFC のタグになる）。既存のタグ・ブランチは NFD で保存されていても NFC にそろえて比べ、見た目が同じ名前は重複・衝突として拒否する。NFC にそろえないと、`core.precomposeunicode=false` のリポジトリで packed-refs の NFC のタグの解決を NFD のタグが奪い、reftable では作成後の確認が NFD の ref を見つけられず失敗し、既定の設定では git の英語の `already exists` が漏れる（いずれも実機 git 2.50.1 / macOS で確認。実装プランの「設計書との差分」10）。NFKC ではないため、全角と半角の英数字は別の名前として扱う
- 作成したタグはローカルにだけ存在する。送信は別の機能（見送り）

## テスト方針

- `shared/tagName`: 規則（空、`-` 始まり、予約名）、階層衝突・大文字小文字だけの違い・ブランチとの同名（前方一致の別名が衝突しない例を含む）、衝突の優先順位（同名のタグと同名のブランチ → `duplicate`、衝突するタグと同名のブランチ → `conflict`）と `with` の値。main と renderer のテストは文言の対応を確かめる
- `gitTagService`（モック）: 検証の順序、各エラー文言、軽量 / 注釈付きの引数（`--` と `HEAD` の位置、メッセージが 1 つの引数）、HEAD 未確定、コミッター情報なし
- `gitTagService` の統合（実 git）: 軽量・注釈付きの作成（`git cat-file -t` で種類を確認）、同名タグ、階層衝突、ブランチと同名、`-` で始まるメッセージ、日本語・空白を含むメッセージ、detached HEAD、マージ中、コミットが無いリポジトリ、`user.name` / `user.email` の未設定（`GIT_CONFIG_GLOBAL=/dev/null` 等で環境を固定。パターン 46）
- `gitHandlers`: 引数検証（`kind` の不正、`message` が文字列でない、余分なキー）、許可フォルダ
- preload: `createTag` の IPC チャネル
- `tagValidation`、`CreateTagDialog`（radiogroup、メッセージの表示 / 非表示、disabled、エラー表示、二重送信の防止、フォーカス）、`HistorySection`（ボタン）、`useGitTagOperations`（成功時の再取得、失敗時にダイアログを閉じない、二重実行の防止）
- 配線のテスト（`GitRepoView` / `SourceControlPanel` / `App`）は、ブランチ作成の既存のテストに揃える
- すべてのテストで、実装を壊すと落ちることを変異で確認する（パターン 57, 78）

## ドキュメント

- ROADMAP: 「タグの作成」を実装済みに移し、見送り項目として「タグの送信（push）」「タグの削除」「履歴の任意のコミットへのタグ付け」「署名付きタグの UI」と、既知の制約（擬似 ref・リモート追跡ブランチと同名のタグが作れる）を追記する
- `docs/manual-test-spec.md`: 新しい領域（接頭辞 `TAG`）を追加する。確認項目の例: 軽量タグの作成、注釈付きタグの作成とメッセージ必須、重複・階層衝突・ブランチとの同名の拒否、`-` 始まりの拒否、コミットが無いリポジトリ、作成後に履歴のバッジへ反映される、マージ中の作成、二重送信の防止
- 実装後、`docs/review-findings-patterns.md` への追記は、レビューで新しい種類の指摘が出たときだけ行う
