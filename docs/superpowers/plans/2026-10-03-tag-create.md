# タグの作成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ソース管理パネルの履歴セクションの見出しにある「タグを作成」から、現在の HEAD に軽量タグ / 注釈付きタグを作成できるようにする。名前の規則・重複・階層の衝突・ブランチとの同名・コミットの有無・コミッター情報は、git の英語のエラーを見せる前に日本語で拒否する。

**Architecture:** 名前の規則（アプリ独自の規則・階層の衝突・ブランチとの同名）は `src/shared/tagName.ts` に、注釈付きタグのメッセージの規則（空白のみ・NUL）は `src/shared/tagMessage.ts` に置き、main と renderer が同じ判定を使う（文言はそれぞれの側に持つ）。main は新しい `src/main/gitTagService.ts` に検証（`assertCreatableTag`）と実行（`createTag`）をまとめ（`gitService.ts` には足さない。パターン 55）、IPC `git:createTag` → preload → `gitApi.createTag` → `useGitTagOperations` で配線する。UI は `HistorySection` の見出しのボタンと新しい `CreateTagDialog`（名前・種類の radiogroup・メッセージ）。状態と操作は `GitTagPanelState` 1 つにまとめ、`gitTag` という 1 つの props で App → Sidebar → SourceControlPanel → GitRepoView → HistorySection へ渡す（退避・マージ状態の配線に揃える）。

**Tech Stack:** Electron / React 19 / TypeScript / simple-git 3.36 / Vitest 4 + Testing Library

**Spec:** [docs/superpowers/specs/2026-10-03-tag-create-design.md](../specs/2026-10-03-tag-create-design.md)

## 設計書との差分（実機 git 2.50.1 で確認。実装はこちらに従う）

一時リポジトリ（`mktemp -d`、`GIT_CONFIG_GLOBAL=/dev/null` `GIT_CONFIG_NOSYSTEM=1` `LC_ALL=C`）と、simple-git 経由の呼び出しで確認した。

1. **軽量タグは `git tag --no-sign -- <name> HEAD`**（設計書は `git tag -- <name> HEAD`）。`tag.gpgSign=true` の環境では、`--no-sign` の無い軽量タグの作成が「署名付きの注釈付きタグ」に変わり、メッセージを求めて `GIT_EDITOR` を起動して**終わるまで待つ**（`GIT_EDITOR="sleep 3; false"` で 3 秒待って失敗した）。軽量タグはそもそも署名できないため、`--no-sign` は「軽量」の意味を保つだけで、ユーザーの署名の方針（注釈付きタグの署名）は上書きしない（パターン 45）。注釈付きタグには `--no-sign` を付けない。
2. **注釈付きタグは `git tag --cleanup=whitespace --message=<message> -- <name> HEAD`**（設計書は `-a -m <message>`）。
   - `-a` は付けない（Task 2 のレビューで変更）。`--message` だけで注釈付きになる（`git cat-file -t` が `tag`）。`-a`（`--annotate`）を明示すると `tag.forceSignAnnotated=true` より優先され、`gpg.program=false` でも終了コード 0 で**署名なしの**タグが作られた（`-a` を外すと署名を試みて 128 で失敗する）。署名の方針を黙って上書きしない（パターン 45）。
   - `-m <message>` の 2 引数だと、simple-git の blockUnsafeOperationsPlugin がメッセージ `--upload-pack=x` を値でなくオプションとみなし、`GitPluginError` で拒否した。`--message=<message>` の 1 引数なら、`-x` / `--upload-pack=x` / `-c x` で始まるメッセージもそのまま件名になる（パターン 49。退避の `stashPush` と同じ）。
   - `git tag` の既定の cleanup（strip）は、`-m` で渡したメッセージからも `#` で始まる行を消す（`#1 release` が消えて空のメッセージになった）。`--cleanup=whitespace` で前後の空行と行末の空白だけを整える。
3. **`git check-ref-format --normalize refs/tags/<name>`**（設計書は `--normalize` 無し）。`--normalize` が無いと成功しても何も出力せず、「出力が入力と一致する」の確認ができない。失敗時は終了コード 1・stderr 空のため、simple-git は reject せず空文字で resolve する。そのため「出力（trim 後）が `refs/tags/<name>` と完全一致しなければ拒否」で、失敗と正規化（`/x` → `refs/tags/x`、`a//b` → `refs/tags/a/b`）の両方を弾く（パターン 25）。
4. **名前の規則に `reserved` を追加**（設計書は `empty` / `leading-dash` のみ）。`check-ref-format` は `HEAD` と `@` を通すが、`git tag -- HEAD HEAD` は `fatal: 'HEAD' is not a valid tag name.` で失敗する。`@` のタグは作れるが、以後の `git rev-parse HEAD` などが `warning: refname 'HEAD' is ambiguous.` を出し、`git rev-parse @` は HEAD を返す（タグに届かない）。`head` のタグは、大文字小文字を区別しない FS（macOS）で `git rev-parse head` が `.git/HEAD` を返し、タグに届かない。よって `@` と、大文字小文字を問わず `head` を拒否する。
5. **ブランチとの同名は大文字小文字を無視して判定する**（設計書は同名のみ）。macOS（files backend）でブランチ `feat` とタグ `FEAT` があると、`git rev-parse feat` は `warning: refname 'feat' is ambiguous.` を出して**タグの**コミットを返した（パターン 43 と同じ曖昧さ）。大文字小文字を区別する FS では無害だが、区別せず一律に拒否する（判定を FS に依存させない）。タグどうしの大文字小文字の違い（`v1` と `V1`、`v1` と `V1/x`）も、大文字小文字を無視して拒否する（Task 2 のレビューで変更。設計書の既知の制約では git のエラーを表示するとしていた）。既存の `v1` が packed-refs にあると（clone・gc の後）、git は `V1` を終了コード 0 で作り、`git rev-parse v1` が `V1` のコミットを返して既存のタグの解決を奪った。loose なら `fatal: tag 'V1' already exists` / `cannot lock ref 'refs/tags/V1/x'` の英語のエラーになる。文言は階層の衝突と同じ `既存のタグ <existing> と名前が衝突します: <name>`（既存のタグ名を示す）。
6. **作成後に `git rev-parse -q --verify refs/tags/<name>` で作成されたことを確かめる**（設計書に無い。パターン 69: 終了コード 0 は効果があったことを意味しない）。
7. **設計書で未規定だった文言を確定する**（Global Constraints）: `-` 始まり・形式違反の main の文言、注釈付きの空メッセージ・NUL の main の文言、ダイアログ内の文言。
8. **`GitTagPanelState` に `clearError` を足す**（設計書は `createTag` / `isCreating` / `error`）。ダイアログを開くときに前回の失敗の表示を持ち越さないため。また、`createTag` は実行を始めるとき（`useRunExclusiveGitOperation` の `onStart`。実行しない no-op では呼ばれない）に `error` を `null` にする。再試行の作成中に前回の `role="alert"` が案内（`role="status"`）と同時に残り、同じ文言で再び失敗すると alert の DOM が変わらず読み上げられなかったため（PR #41 の 3 周目のレビューで追加。`useRunExclusiveGitOperation` の共通の挙動は他の操作に波及するため変えない）。
9. **`useGitTagOperations` は、他の Git 操作がロックを持っている間（`lock.isAnyLocked()`）は実行しない**（no-op で `false`）。設計書どおりロック（`lockGlobal`）は取らないが、checkout・マージ・commit の途中は HEAD が動くため、付ける先が定まらない間は待つ（ブランチの削除と同じ判断）。ダイアログの `作成` とセクションの `タグを作成` は、その間 disabled にする。

10. **タグ名は Unicode の NFC にそろえて扱う**（PR 前のレビューで追加。設計書は「前後の空白を除く」のみ）。共有の `normalizeTagName(name)`（`@shared/tagName`。`trim()` の直後に `normalize('NFC')`）を、renderer のダイアログ（検証と送信値）と main の `createTag` の入口の両方で使う。main は以後の検証・衝突の判定・`git tag`・作成後の `rev-parse refs/tags/<name>` のすべてでこの名前を使う。衝突・重複・ブランチ同名の比較は、既存のタグ・ブランチ側も NFC にそろえる（衝突とブランチ同名は NFC にそろえてから大文字小文字を無視する。差分 11 で完全な case folding に変更。重複は NFC にそろえた完全一致）。`check-ref-format --normalize` は NFD をそのまま返すため、正規化しないと次が起きた（macOS）:
    - `core.precomposeunicode=false` で packed-refs に NFC の `é` があると、NFD の `é` が `git tag --no-sign -- <NFD> HEAD` で終了コード 0 で作られ、`git rev-parse <NFC>` が新しいコミットを返した（既存のタグの解決を奪う）
    - `--ref-format=reftable` では、git が argv を NFC に直して作成し終了コード 0 だが、作成後の `rev-parse -q --verify refs/tags/<NFD>` が見つからず「タグを作成できませんでした」になった（タグは NFC 名で残る）
    - 既定（`precomposeunicode=true`）で NFC の `é` があると、NFD の要求は重複の判定をすり抜け、`fatal: tag 'é' already exists` が英語のまま漏れた
11. **大文字小文字の無視は Unicode の完全な case folding に近づける**（PR 前のレビューで追加）。`toLowerCase` だけでは、macOS の APFS が同じ名前とみなす `ß` と `ss`・`ẞ`、`ſ` と `s`、`µ` と `μ`、`ας` と `ασ`、`ﬁ` と `fi` などが一致しない。packed-refs に `ss` があると `git tag --no-sign -- ß HEAD` が終了コード 0 で作られ、`git rev-parse refs/tags/ss` が新しいコミットを返した（既存のタグの解決を奪う）。ブランチ `ss` があるとタグ `ß` の作成後に `git rev-parse ss` が `refname 'ss' is ambiguous` になった（いずれも実機 git 2.50.1 / APFS）。`collisionKey` は NFC にそろえた後、1 文字ずつ小文字 → 大文字 → 小文字の順に変換し（`ẞ` → `ß` → `SS` → `ss`、`ς` → `Σ` → `σ`）、最後に NFC にそろえる。`ı`（点の無い i）は大文字化で `I` になるが、APFS は `i` と別の名前として扱うため変換しない。APFS 上で確かめた結果、Unicode の全文字について、この変換で同じになる単一文字の組（同値類 2295 個・2439 組）はすべて APFS でも同じ名前になり、`ı` と `i`、`İ` と `i`、`ss1` と `ß2`、全角と半角の英字は APFS でも別の名前で、この変換でも衝突しない（過剰な拒否は見つからなかった）。`ǅ` / `ǆ` / `Ǆ`、`İ` と `i` + U+0307、`K`（ケルビン記号）と `k` も APFS で同じ名前になり、この変換でも衝突する。
12. **`git tag` を時間で打ち切る**（PR #41 のレビューで追加。設計書は「失敗しうる（失敗は表示する）」）。`gpg.format=ssh`・`tag.gpgSign=true`・パスフレーズ付きの鍵（ssh-agent に未登録）や、入力を待ち続ける `gpg.program` では、simple-git の `raw(['tag', ...])` がいつまでも pending のままだった。なお `ssh-keygen` が入力を待つのは端末から起動した場合だけで、制御端末の無い環境では 0.01 秒で終了コード 128 になる（待ち続けない）。パッケージ版（GUI から起動）で時間切れになるのは主に gpg の pinentry の入力待ち（PR #41 の 2 周目のレビューで補足）。`simpleGit(folderPath, { timeout: { block: TAG_CREATE_TIMEOUT_MS } })`（120 秒。定数は `src/shared/tagTimeout.ts` に置き、renderer の作成中の案内「最大 2 分」と共有する（PR #41 の 3 周目のレビューで一本化）。`createTag` の第 3 引数でテスト用に差し替える）で git を止め、`GitPluginError`（`plugin === 'timeout'`）を `タグの作成が時間内に終わりませんでした（署名のパスフレーズの入力待ちなど）: <name>` にする。打ち切った後はタグも `refs/tags/<name>.lock` も残らず、同じ名前で作り直せた。git が起動した `gpg.program` のプロセスは git を止めても残る（`ssh-keygen -Y sign` は一緒に終わった）

設計書の仮定のうち、次は実機で確認でき、そのまま採用する。

- `git tag -- <name> HEAD` / `git tag --message=... -- <name> HEAD` は通る（`--` の後の位置引数として名前と HEAD を渡せる）。マージ中・detached HEAD でも作成でき、付ける先は今の HEAD。
- コミットが無いリポジトリでは `git tag` が `fatal: Failed to resolve 'HEAD' as a valid ref.`（128）。`git rev-parse -q --verify 'HEAD^{commit}'` は終了コード 1・出力なしで、simple-git は空文字で resolve する。
- `git var GIT_COMMITTER_IDENT` は、`user.name` / `user.email` の未設定（自動推定できない環境）、`user.useConfigOnly=true`、空の `user.name` のいずれでも、`git tag -a` と同じく終了コード 128・stderr ありで失敗する（simple-git は `GitError` で reject）。ホスト名からメールを自動推定できる環境では両方とも成功する（判定が一致する）。軽量タグはコミッター情報が無くても作れる。
- ブランチと同名のタグは git が黙って作る（終了コード 0）。階層が衝突するタグは `fatal: cannot lock ref 'refs/tags/v1/x': 'refs/tags/v1' exists` で失敗する（アプリが先に拒否する）。
- `tag.gpgSign=true` と署名に失敗する `gpg.program` の注釈付きタグは `error: gpg failed to sign the data` で失敗し、タグは作られない。

## Global Constraints

- 返答・コメント・エラーメッセージ・テスト名は日本語。型だけの import は `import type`。`git commit` / `git push` は、ユーザーの明示的な指示があるまで行わない（SDD 中はコミットしない運用。各タスクのコミット手順は飛ばす）。`git add -A` は使わない。
- 実機（Electron）の確認手順はプランに書かない。実機テスト仕様書 `docs/manual-test-spec.md` に新しい領域（接頭辞 `TAG`）を追記する（最終タスク）。
- `env()` を simple-git に使わない（`gitService.ts` の `getLog` のコメント。blockUnsafeOperationsPlugin の地雷）。git のエラーメッセージ文字列で分岐しない（パターン 18）。
- テストは TDD。実装後の検知力の確認は、`mktemp -d` の新しいディレクトリへ実装ファイルを `cp` で退避 → 変異 → 該当のテストが落ちることを確認 → 復元 → `cmp` で一致を確認、の手順で行う（`git stash` は使わない。パターン 57・78）。`act(...).then(...)` 形式でテストを書かない（`await act(async () => { ... })`）。
- 型・チャネル（完全一致）:
  - `src/shared/types/git.ts`: `export const TAG_KINDS = ['lightweight', 'annotated'] as const`、`export type TagKind = (typeof TAG_KINDS)[number]`、`export type CreateTagRequest = { name: string; kind: TagKind; message: string }`
  - IPC チャネル: `git:createTag`（引数は `CreateTagRequest` 1 つ、戻り値 `Promise<void>`）
  - preload / `gitApi`: `createTag(request: CreateTagRequest): Promise<void>`
  - `src/shared/tagName.ts`: `normalizeTagName(name): string`（`trim()` + `normalize('NFC')`。差分 10）、`getTagNameRuleViolation(name): TagNameRuleViolation | null`（`'empty' | 'leading-dash' | 'reserved'`）、`getTagNameCollision(name, existingTags, existingBranches): TagNameCollision | null`（`{ kind: 'duplicate' | 'conflict' | 'branch'; with: string }`。NFC にそろえて一致するタグ → 衝突するタグ（階層・大文字小文字）→ 同名のブランチ（大文字小文字を無視）の順で判定し（比較は既存側も NFC にそろえる）、main と renderer がこの順序を共有する。`with` は文言に使う既存の名前。部品の `findConflictingTagName` / `findSameNameBranch` はモジュール内に閉じる）
  - `src/shared/tagMessage.ts`: `getTagMessageRuleViolation(kind: TagKind, message: string): TagMessageRuleViolation | null`（`'empty' | 'nul'`。軽量は常に null。注釈付きで trim 後が空 → `'empty'`、NUL を含む → `'nul'` の順で判定する）
  - `src/renderer/src/types.ts`: `GitTagPanelState`（`isCreating` / `error` / `createTag(request): Promise<boolean>` / `clearError()`）
- main の検証の順序（前の検証に失敗したら後の git 呼び出しには進まない。この順で固定する）:
  1. 名前の規則（`getTagNameRuleViolation`）。git を呼ばない
  2. `git check-ref-format --normalize refs/tags/<name>` の出力（trim）が `refs/tags/<name>` と完全一致
  3. 既存のタグと同名（完全一致。`git for-each-ref --format=%(refname) refs/tags/`）
  4. 衝突する既存のタグ（階層の衝突と、大文字小文字だけの違い。大文字小文字を無視）
  5. 既存のローカルブランチと同名（大文字小文字を無視。`git for-each-ref --format=%(refname) refs/heads/`）
  6. HEAD がコミットを指す（`git rev-parse -q --verify HEAD^{commit}` が空でない）
  7. 注釈付きのとき: メッセージが空白のみでない → NUL を含まない（いずれも `getTagMessageRuleViolation`）→ `git var GIT_COMMITTER_IDENT` が成功する
  8. 実行（軽量 `git tag --no-sign -- <name> HEAD` / 注釈付き `git tag --cleanup=whitespace --message=<message> -- <name> HEAD`。`-a` は付けない）
  9. 作成の確認（`git rev-parse -q --verify refs/tags/<name>` が空でない）
- main のエラー文言（完全一致）:
  - `` `-` で始まるタグ名は使用できません: <name> ``
  - `タグ名として使用できない名前です: <name>`（空・`reserved`・check-ref-format の違反・正規化で別名になる）
  - `同じ名前のタグが既に存在します: <name>`
  - `既存のタグ <existing> と名前が衝突します: <name>`（階層の衝突、または大文字小文字だけが違う既存のタグ）
  - `同じ名前のブランチが存在するため、タグを作成できません: <name>`
  - `コミットが無いため、タグを作成できません`
  - `注釈付きタグにはメッセージが必要です`
  - `メッセージに使用できない文字が含まれています`
  - `コミッター情報（user.name / user.email）が未設定のため、注釈付きタグを作成できません`
  - `タグを作成できませんでした: <detail>`（git のエラーの trim。detail が空なら `タグを作成できませんでした`）。`git tag` の失敗に加え、タグ・ブランチの一覧（`for-each-ref`）と作成後の確認（`rev-parse`）の reject もこの文言にする（英語の GitError をそのまま見せない。パターン 74）
  - IPC の型検証: `Invalid tag request`
- ダイアログ内の検証の文言（完全一致）: `名前を入力してください` / `` `-` で始まる名前は使用できません `` / `この名前は使用できません` / `同じ名前のタグが既に存在します` / `既存のタグ <existing> と名前が衝突します` / `同じ名前のブランチが存在するため、タグを作成できません` / `メッセージを入力してください` / `メッセージに使用できない文字が含まれています`
- UI 文言と ARIA: 履歴の見出しのボタン `タグを作成`（`aria-label="タグを作成"`）。ダイアログは `role="dialog"`、名前は見出し `タグを作成`（`aria-labelledby`）、説明 `現在の HEAD にタグを付けます`（`aria-describedby`）。入力欄は可視のラベル `タグ名` / `メッセージ`。種類は可視の `種類` を名前にした `role="radiogroup"` と、`role="radio"` + `aria-checked` の `軽量` / `注釈付き`（既定は軽量。矢印キーで切り替え、roving tabindex）。メッセージ欄は注釈付きのときだけ表示。ボタン `作成`（実行中 `作成中...`）/ `キャンセル`。作成中はダイアログ（`form`）に `aria-busy="true"` を付け、`role="status"` の案内 `作成中です。署名の入力待ちなどで最大 2 分かかることがあります` を出す（完了・失敗で消える。失敗の直後に履歴を取り直している間は `isCreating` が `true` のままエラーがセットされるため、`isCreating && error === null` のときだけ出す。PR #41 の 2・4 周目のレビューで追加）。検証エラーは入力欄の `aria-describedby` と `aria-invalid` で結び、作成の失敗は `role="alert"`。タップ領域は 32px 以上（共通のボタンの規則に入れる）。
- 排他: タグの作成どうしは実行中フラグ（ref）で排他。`lockGlobal` は取らない。他の Git 操作がロック中（`lock.isAnyLocked()`）・リポジトリでない間は no-op（`false`）。再取得（`refreshHistory`）は成功・失敗のどちらでも行い、実行中フラグはその後で解除する（`useRunExclusiveGitOperation`。パターン 73）。再取得の失敗で作成の成功を失敗にしない（パターン 52）。
- 作業ツリー・index・HEAD は変わらないので、エディタのタブ・ファイルツリーの再読込、未保存編集の破棄確認、`refreshGitStatus` はしない。

## File Structure

| ファイル                                                                                          | 責務                                                      | 変更   |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------ |
| `src/shared/types/git.ts` / `src/shared/types.ts`                                                 | `TAG_KINDS` / `TagKind` / `CreateTagRequest`              | Modify |
| `src/shared/tagName.ts`                                                                           | 名前の規則・衝突の判定と順序（main と renderer で共有）   | Create |
| `src/shared/tagMessage.ts`                                                                        | 注釈付きタグのメッセージの規則（main と renderer で共有） | Create |
| `src/main/gitTagService.ts`                                                                       | `createTag` と検証（`assertCreatableTag`）                | Create |
| `src/main/handlers/gitHandlers.ts`                                                                | IPC `git:createTag`、`assertCreateTagArg`                 | Modify |
| `src/preload/api.ts` / `src/preload/index.d.ts`                                                   | `createTag`                                               | Modify |
| `src/renderer/src/lib/gitApi.ts`                                                                  | `createTag`                                               | Modify |
| `src/renderer/src/types.ts`                                                                       | `GitTagPanelState`                                        | Modify |
| `src/renderer/src/lib/tagValidation.ts`                                                           | ダイアログ用の検証と文言                                  | Create |
| `src/renderer/src/hooks/useGitTagOperations.ts`                                                   | 作成の実行・排他・再取得・エラー                          | Create |
| `src/renderer/src/components/source-control/CreateTagDialog.tsx`                                  | 名前・種類・メッセージの入力                              | Create |
| `src/renderer/src/components/source-control/HistorySection.tsx`                                   | 見出しの「タグを作成」、ダイアログの開閉とフォーカス      | Modify |
| `src/renderer/src/assets/main.css`                                                                | 見出し行・ボタン・ダイアログの見た目                      | Modify |
| `GitRepoView.tsx` / `SourceControlPanel.tsx` / `Sidebar.tsx` / `App.tsx` / `hooks/useAppState.ts` | `gitTag` の配線                                           | Modify |
| `src/renderer/src/__tests__/makeGitTagPanelState.ts`                                              | テスト用の型付きモック                                    | Create |
| `docs/manual-test-spec.md`                                                                        | 領域 `TAG`                                                | Modify |

---

### Task 1: 型と名前の規則（`src/shared`）

**Files:**

- Modify: `src/shared/types/git.ts`, `src/shared/types.ts`
- Create: `src/shared/tagName.ts`, `src/shared/__tests__/tagName.test.ts`, `src/shared/tagMessage.ts`, `src/shared/__tests__/tagMessage.test.ts`（`tagMessage` は SRP レビューで、main と renderer に独立して書かれていたメッセージの規則を共有するために追加）

**Interfaces:**

- Consumes: なし（当初は `findConflictingBranchName` を使っていたが、Task 2 のレビューでタグどうしを大文字小文字を無視して比べるよう変えたため、タグの衝突は独自に判定する）
- Produces: `TAG_KINDS` / `TagKind` / `CreateTagRequest`（`@shared/types` から import できる）、`getTagNameRuleViolation` / `getTagNameCollision` / `TagNameRuleViolation` / `TagNameCollision` / `TagNameCollisionKind`（`@shared/tagName`）、`getTagMessageRuleViolation` / `TagMessageRuleViolation`（`@shared/tagMessage`）

- [ ] **Step 1: 失敗するテストを書く（`src/shared/__tests__/tagName.test.ts`）**

```ts
import { describe, it, expect } from 'vitest'
import { getTagNameCollision, getTagNameRuleViolation } from '../tagName'

describe('getTagNameRuleViolation', () => {
  it('空文字は empty', () => {
    expect(getTagNameRuleViolation('')).toBe('empty')
  })

  // '-' 始まりは git(check-ref-format を含む)にオプションとして解釈される(パターン 21)
  it.each(['-x', '--force', '-'])("'-' で始まる名前 %s は leading-dash", (name) => {
    expect(getTagNameRuleViolation(name)).toBe('leading-dash')
  })

  // git tag は 'HEAD' を拒否し、'@' のタグは HEAD の解決を曖昧にする。'head' は大文字小文字を
  // 区別しない FS で .git/HEAD に隠れる(実機 git 2.50.1 で確認)
  it.each(['HEAD', 'head', 'Head', '@'])('%s は reserved', (name) => {
    expect(getTagNameRuleViolation(name)).toBe('reserved')
  })

  // git 本体の規則(`..` 等)は main 側の check-ref-format に委ねる
  it.each(['v1.0.0', 'release/2026-10', 'a-b', 'foo@bar', '@x', 'HEADS', 'my-head', 'a..b'])(
    '%s は null',
    (name) => {
      expect(getTagNameRuleViolation(name)).toBeNull()
    }
  )
})

// 既存のタグ・ブランチとの衝突。main(gitTagService)と renderer(tagValidation)が同じ順序で判定する
// ための共有の判定(片方だけ順序を変えると、ダイアログは通るのに main で拒否される。パターン 14)
describe('getTagNameCollision', () => {
  const conflict = (name: string, tags: string[]): ReturnType<typeof getTagNameCollision> =>
    getTagNameCollision(name, tags, [])
  const branch = (name: string, branches: string[]): ReturnType<typeof getTagNameCollision> =>
    getTagNameCollision(name, [], branches)

  describe('優先順位(完全一致のタグ → 衝突するタグ → 同名のブランチ)', () => {
    it('同名のタグと同名のブランチの両方があれば duplicate', () => {
      expect(getTagNameCollision('v1', ['v1'], ['v1'])).toEqual({ kind: 'duplicate', with: 'v1' })
    })

    it('完全一致のタグと、大文字小文字だけ違うタグの両方があれば duplicate', () => {
      expect(getTagNameCollision('v1', ['V1', 'v1'], [])).toEqual({
        kind: 'duplicate',
        with: 'v1'
      })
    })

    it('衝突するタグと同名のブランチの両方があれば conflict(with は衝突するタグ)', () => {
      expect(getTagNameCollision('V1', ['v1'], ['v1'])).toEqual({ kind: 'conflict', with: 'v1' })
    })

    it('同名のブランチだけなら branch(with は既存のブランチ)', () => {
      expect(getTagNameCollision('FEAT', ['v1'], ['main', 'feat'])).toEqual({
        kind: 'branch',
        with: 'feat'
      })
    })

    it('どれにも当たらなければ null', () => {
      expect(getTagNameCollision('v2', ['v1', 'v1/x'], ['main'])).toBeNull()
      expect(getTagNameCollision('v1', [], [])).toBeNull()
    })
  })

  // refs/tags 配下はディレクトリ構造のため、'v1' と 'v1/x' は共存できない
  // (git は `cannot lock ref` の英語エラーで失敗する)
  describe('衝突するタグ(conflict)', () => {
    it('既存のタグの配下になる名前は、その既存のタグと衝突する', () => {
      expect(conflict('v1/x', ['v1', 'v2'])).toEqual({ kind: 'conflict', with: 'v1' })
    })

    it('既存のタグを配下に持つ名前は、その既存のタグと衝突する', () => {
      expect(conflict('v1', ['v1/x'])).toEqual({ kind: 'conflict', with: 'v1/x' })
    })

    it('前方一致するだけの別名は衝突しない', () => {
      expect(conflict('v10', ['v1'])).toBeNull()
      expect(conflict('v1', ['v1.0'])).toBeNull()
      expect(conflict('v1-x', ['v1'])).toBeNull()
    })

    // 大文字小文字を区別しない FS では、packed-refs の 'v1' があると 'V1' が作れてしまい、
    // `git rev-parse v1` が 'V1' のコミットを返す(実機 git 2.50.1 で確認)。FS に依存させず一律に比べる
    it('大文字小文字だけが違う既存のタグと衝突する(両方の向き)', () => {
      expect(conflict('V1', ['v1'])).toEqual({ kind: 'conflict', with: 'v1' })
      expect(conflict('v1', ['V1'])).toEqual({ kind: 'conflict', with: 'V1' })
    })

    it('大文字小文字が違っても階層の衝突を検出する(両方の向き)', () => {
      expect(conflict('V1/x', ['v1'])).toEqual({ kind: 'conflict', with: 'v1' })
      expect(conflict('v1/x', ['V1'])).toEqual({ kind: 'conflict', with: 'V1' })
      expect(conflict('V1', ['v1/x'])).toEqual({ kind: 'conflict', with: 'v1/x' })
    })

    it('大文字小文字が違っても、前方一致するだけの別名は衝突しない', () => {
      expect(conflict('V10', ['v1'])).toBeNull()
      expect(conflict('v1', ['V1.0'])).toBeNull()
    })
  })

  // 同名のタグとブランチが共存すると、git merge <name> などがタグを優先する(パターン 43)。
  // 大文字小文字を区別しない FS では 'FEAT' のタグも 'feat' の解決を奪う(実機で確認)
  describe('同名のブランチ(branch)', () => {
    it('同じ名前のブランチと衝突する', () => {
      expect(branch('feat', ['main', 'feat'])).toEqual({ kind: 'branch', with: 'feat' })
    })

    it('大文字小文字だけ違うブランチとも衝突する(両方の向き)', () => {
      expect(branch('FEAT', ['feat'])).toEqual({ kind: 'branch', with: 'feat' })
      expect(branch('main', ['Main'])).toEqual({ kind: 'branch', with: 'Main' })
    })

    it('前方一致や階層の違う名前のブランチとは衝突しない', () => {
      expect(branch('feat', ['feature', 'feat/x', 'my-feat'])).toBeNull()
    })
  })
})
```

```bash
npx vitest run src/shared/__tests__/tagName.test.ts
```

Expected: FAIL（モジュール `../tagName` が無い）

- [ ] **Step 2: 型を追加する**

`src/shared/types/git.ts` の `MergeBranchResult` の直後に追加:

```ts
// タグの種類。IPC 境界(gitHandlers の assertCreateTagArg)が値の検証に使うため、配列としても公開する
export const TAG_KINDS = ['lightweight', 'annotated'] as const
export type TagKind = (typeof TAG_KINDS)[number]

// タグの作成の要求。付ける先は常に現在の HEAD。message は注釈付きのときだけ使う(軽量では無視する)
export type CreateTagRequest = { name: string; kind: TagKind; message: string }
```

`src/shared/types.ts` の値の再エクスポートを変える:

```ts
export { CONFLICT_CHOICES, TAG_KINDS } from './types/git'
```

- [ ] **Step 3: 実装する（`src/shared/tagName.ts`）**

```ts
// タグ名のうち、git 本体の規則(check-ref-format)より手前でアプリ独自に拒否する規則。
// main 側(gitTagService)と renderer 側(tagValidation)が同じ判定を使うために共有する
// (片方だけ規則を変えると、ダイアログは通るのに main で拒否される等の食い違いが起きる。パターン 14)。
// 文言は文脈ごとに異なるため、ここでは違反の種類だけを返す
// タグ名の入口(main の createTag と renderer のダイアログ)で使う正規化。前後の空白を除き、Unicode の NFC に
// そろえる。'é' などは NFC(1 文字)と NFD(e + 結合文字)で見た目が同じでも別の文字列になり、
// check-ref-format --normalize も NFD をそのまま返す。正規化しないと次が起きる(いずれも実機 git 2.50.1 で確認):
// - core.precomposeunicode=false: packed-refs の NFC のタグがあると NFD のタグが終了コード 0 で作られ、
//   `git rev-parse <NFC>` が NFD のタグのコミットを返す(既存のタグの解決を奪う)
// - 既定(precomposeunicode=true): git が argv を NFC に直すため、NFC のタグがあると英語の
//   `already exists` になり、reftable では NFC 名で作られて作成後の確認(NFD の ref)が見つからない
// renderer が送る値も main が git に渡す値も、この関数の結果にそろえる
export function normalizeTagName(name: string): string {
  return name.trim().normalize('NFC')
}

// 衝突の判定に使う比較用の形(NFC にそろえてから、Unicode の完全な case folding で大文字小文字を無視する)。
// 既存のタグ・ブランチは NFD で保存されていることがある(precomposeunicode=false のリポジトリや他のツールが
// 作った ref)ため、要求側と既存側の両方に適用する。
// macOS の APFS は完全な case folding で名前を比べるため、toLowerCase だけでは一致しない 'ß' と 'ss'・'ẞ'、
// 'ſ' と 's'、'µ' と 'μ'、'ς' と 'σ'、'ﬁ' と 'fi' なども同じ名前になる。packed-refs の 'ss' があると 'ß' が
// 終了コード 0 で作られ、`git rev-parse refs/tags/ss` が新しいコミットを返す(実機 git 2.50.1 / APFS で確認)。
// JavaScript に case folding の API は無いため、1 文字ずつ小文字 → 大文字 → 小文字の順に変換して近づける:
// - 大文字化で 'ß' → 'SS'、'ﬁ' → 'FI'、'ſ' → 'S' のように展開・統一し、最初の小文字化で 'ẞ' を 'ß' に寄せる
// - 'ς'(語末の σ)も大文字化で 'Σ' になり、1 文字ずつ小文字化するので常に 'σ' にそろう(文字列全体の
//   toLowerCase は語末の 'Σ' を文脈に応じて 'ς' にするため、文字単位にして比較用の形を文脈に依存させない)
// - 'ı'(点の無い i)は大文字化で 'I' になり 'i' と同じになるが、APFS は別の名前として扱うため変換しない
//   (文字単位にしているのは、この例外を入れるためでもある)
// Unicode の全文字の単一文字の同値類(2295 個)が APFS と一致することを実機で確認した
function caseFoldChar(char: string): string {
  if (char === '\u0131') return char
  return char.toLowerCase().toUpperCase().toLowerCase()
}

function collisionKey(name: string): string {
  return Array.from(name.normalize('NFC'), caseFoldChar).join('').normalize('NFC')
}

export type TagNameRuleViolation = 'empty' | 'leading-dash' | 'reserved'

export function getTagNameRuleViolation(name: string): TagNameRuleViolation | null {
  if (name.length === 0) return 'empty'
  // '-' 始まりは git 自身(check-ref-format を含む)にオプションとして解釈される(パターン 21)
  if (name.startsWith('-')) return 'leading-dash'
  // check-ref-format は 'HEAD' と '@' を通すが、git tag は 'HEAD' を拒否し、'@' のタグは作れても
  // 以後の HEAD の解決を曖昧にする(`refname 'HEAD' is ambiguous`)。'head' は大文字小文字を区別しない
  // FS で `git rev-parse head` が .git/HEAD を返し、タグに届かない(いずれも実機 git 2.50.1 で確認)
  if (name === '@' || name.toLowerCase() === 'head') return 'reserved'
  return null
}

// 既存のタグと衝突する名前を返す。無ければ null。次のいずれも NFC にそろえ、大文字小文字を無視して判定する:
// - 階層の衝突: refs/tags 配下も refs/heads と同じくディレクトリ構造で保存されるため、一方が他方の
//   親階層になる名前('v1' と 'v1/x')は共存できない
// - 大文字小文字だけの違い('v1' と 'V1'): 大文字小文字を区別しない FS(macOS)では、packed-refs の 'v1' が
//   あると 'V1' が終了コード 0 で作られ、`git rev-parse v1` が 'V1' のコミットを返す(既存のタグの解決を
//   奪う)。loose なら git の英語のエラーになる(いずれも実機 git 2.50.1 で確認)。FS に依存させず一律に弾く
// 同名(NFC にそろえて完全一致)の重複はここでは扱わない(getTagNameCollision が先に duplicate として判定する)
function findConflictingTagName(name: string, existingTags: readonly string[]): string | null {
  const lowered = collisionKey(name)
  return (
    existingTags.find((existing) => {
      const existingLowered = collisionKey(existing)
      return (
        existingLowered === lowered ||
        lowered.startsWith(`${existingLowered}/`) ||
        existingLowered.startsWith(`${lowered}/`)
      )
    }) ?? null
  )
}

// 同名のローカルブランチ(NFC にそろえ、大文字小文字を無視)を返す。無ければ null。
// 同名のタグとブランチが共存すると、git merge <name> などが refs/tags を優先して別のコミットを選ぶ
// (パターン 43)。大文字小文字を区別しない FS では、タグ 'FEAT' がブランチ 'feat' の解決を奪う
// (実機で確認)ため、FS の性質に依存させず一律に大文字小文字を無視して比べる
function findSameNameBranch(name: string, branchNames: readonly string[]): string | null {
  const lowered = collisionKey(name)
  return branchNames.find((branch) => collisionKey(branch) === lowered) ?? null
}

export type TagNameCollisionKind = 'duplicate' | 'conflict' | 'branch'

// 衝突の種類と、文言に使う既存の名前(duplicate は同名のタグ、conflict は衝突するタグ、
// branch は同名のブランチ)
export interface TagNameCollision {
  kind: TagNameCollisionKind
  with: string
}

// 既存のタグ・ブランチとの衝突を、同名のタグ(NFC にそろえて一致)→ 衝突するタグ(階層・大文字小文字)→
// 同名のブランチの順に判定する。main(gitTagService)と renderer(tagValidation)の両方がこの順序を使う
// (片方だけ順序を変えると、ダイアログと main で報告する衝突が食い違う。パターン 14)。
// 文言は文脈ごとに異なるため、ここでは種類と相手の名前だけを返す
export function getTagNameCollision(
  name: string,
  existingTags: readonly string[],
  existingBranches: readonly string[]
): TagNameCollision | null {
  const normalized = name.normalize('NFC')
  const duplicate = existingTags.find((existing) => existing.normalize('NFC') === normalized)
  if (duplicate !== undefined) return { kind: 'duplicate', with: duplicate }
  const conflicting = findConflictingTagName(name, existingTags)
  if (conflicting !== null) return { kind: 'conflict', with: conflicting }
  const branch = findSameNameBranch(name, existingBranches)
  if (branch !== null) return { kind: 'branch', with: branch }
  return null
}
```

```bash
npx vitest run src/shared/__tests__/tagName.test.ts
```

Expected: PASS

- [ ] **Step 4: ミューテーション**

手順は Global Constraints のとおり（`mktemp -d` へ `cp` → 変異 → 落ちる → 復元 → `cmp`）。(1) `name.toLowerCase() === 'head'` を `name === 'HEAD'` にする → `head` / `Head` のテストが落ちる、(2) `findSameNameBranch` の `toLowerCase()` を両方外す → 大文字小文字のテスト（両方の向き）が落ちる、(3) `'@'` の判定を外す → `@` のテストが落ちる、(4) `leading-dash` を `name.startsWith('--')` にする → `-x` / `-` が落ちる、(5) `getTagNameCollision` の段の順序を入れ替える（ブランチを衝突するタグより先、または完全一致を最後）→ 優先順位のテストが落ちる、(6) `with` を `name` にする → `with` の値のテストが落ちる。

- [ ] **Step 5: 検証**

```bash
npx vitest run src/shared
npm run typecheck
npx eslint src/shared/tagName.ts src/shared/types/git.ts src/shared/types.ts src/shared/__tests__/tagName.test.ts
npx prettier --check src/shared/tagName.ts src/shared/types/git.ts src/shared/types.ts src/shared/__tests__/tagName.test.ts
```

Expected: すべて成功

- [ ] **Step 6: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 2: `gitTagService.ts`（検証と実行。モック単体 + 実 git 統合）

**Files:**

- Create: `src/main/gitTagService.ts`, `src/main/__tests__/gitTagService.test.ts`, `src/main/__tests__/gitTagService.integration.test.ts`

**Interfaces:**

- Consumes: Task 1 の `CreateTagRequest` / `getTagNameRuleViolation` / `getTagNameCollision`、統合テストのヘルパ（`src/main/__tests__/helpers/realGitRepo.ts` の `initRepo` / `commitAll` / `runGit` / `stubIsolatedGitEnv` / `writeRepoFile`）
- Produces: `createTag(folderPath: string, request: CreateTagRequest): Promise<void>`、`COMMITTER_UNKNOWN_MESSAGE`（定数。テストで使う）

- [ ] **Step 1: 単体テスト（モック）を書く（`src/main/__tests__/gitTagService.test.ts`）**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CreateTagRequest } from '@shared/types'

// simple-git の GitError(git プロセスが失敗した)と、それ以外の失敗(spawn の失敗等)を区別するためのモック
const MockGitError = vi.hoisted(() => class MockGitError extends Error {})
const mockRaw = vi.hoisted(() => vi.fn())
const mockSimpleGit = vi.hoisted(() => vi.fn(() => ({ raw: mockRaw })))

vi.mock('simple-git', () => ({
  default: mockSimpleGit,
  GitError: MockGitError
}))

import { COMMITTER_UNKNOWN_MESSAGE, createTag } from '../gitTagService'

const HEAD_SHA = `${'a'.repeat(40)}\n`
const TAG_SHA = `${'b'.repeat(40)}\n`

type RawOptions = {
  tags?: string[]
  branches?: string[]
  /** for-each-ref の行末(Windows の git で \r\n になる場合の確認用) */
  eol?: string
  /** check-ref-format --normalize の出力。省略時は入力の ref をそのまま返す(成功) */
  normalized?: string
  checkRefFormatRejects?: boolean
  head?: string
  ident?: 'ok' | 'git-error' | 'spawn-error'
  tagError?: Error
  createdTag?: string
  tagsListRejects?: boolean
  branchesListRejects?: boolean
  createdTagRejects?: boolean
}

// 問い合わせを種類で振り分ける。出力の前提は一時ディレクトリの実 git 2.50.1 で確認済み:
// - check-ref-format --normalize は成功時に正規化した ref を出力し、失敗時は終了コード 1・stderr 空
//   (simple-git は reject せず空文字で resolve する)
// - rev-parse -q --verify は ref が無いと空文字で resolve する
// - var GIT_COMMITTER_IDENT はコミッター情報が無いと終了コード 128・stderr ありで reject する
const setupRaw = (o: RawOptions = {}): void => {
  const eol = o.eol ?? '\n'
  mockRaw.mockImplementation(async (args: string[]) => {
    const last = args[args.length - 1]
    if (args[0] === 'check-ref-format') {
      if (o.checkRefFormatRejects === true) throw new MockGitError('fatal')
      return o.normalized ?? `${last}\n`
    }
    if (args[0] === 'for-each-ref' && last === 'refs/tags/') {
      if (o.tagsListRejects === true) throw new MockGitError('fatal: bad object refs/tags/x\n')
      return (o.tags ?? []).map((tag) => `refs/tags/${tag}${eol}`).join('')
    }
    if (args[0] === 'for-each-ref' && last === 'refs/heads/') {
      if (o.branchesListRejects === true) throw new MockGitError('fatal: bad object refs/heads/x\n')
      return (o.branches ?? ['main']).map((branch) => `refs/heads/${branch}${eol}`).join('')
    }
    if (args[0] === 'rev-parse' && last === 'HEAD^{commit}') return o.head ?? HEAD_SHA
    if (args[0] === 'rev-parse' && last.startsWith('refs/tags/')) {
      if (o.createdTagRejects === true) throw new MockGitError('fatal: unable to read refs\n')
      return o.createdTag ?? TAG_SHA
    }
    if (args[0] === 'var') {
      if (o.ident === 'git-error') {
        throw new MockGitError('fatal: unable to auto-detect email address')
      }
      if (o.ident === 'spawn-error') throw new Error('spawn git ENOENT')
      return 'test <test@example.com> 1790000000 +0900\n'
    }
    if (args[0] === 'tag') {
      if (o.tagError !== undefined) throw o.tagError
      return ''
    }
    throw new Error(`unexpected raw: ${args.join(' ')}`)
  })
}

const rawCalls = (): string[][] => mockRaw.mock.calls.map((call) => call[0] as string[])
const calledCommands = (): string[] => rawCalls().map((args) => args[0])
const lightweight = (name: string, message = ''): CreateTagRequest => ({
  name,
  kind: 'lightweight',
  message
})
const annotated = (name: string, message: string): CreateTagRequest => ({
  name,
  kind: 'annotated',
  message
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createTag の実行', () => {
  // tag.gpgSign=true のとき、--no-sign が無いと軽量タグが「署名付きの注釈付きタグ」に変わり、
  // エディタを起動して待つ(実機で確認。パターン 45)
  it('軽量タグは tag --no-sign -- <name> HEAD を呼ぶ(付ける先を HEAD と明示する)', async () => {
    setupRaw()
    await createTag('/project', lightweight('v1.0.0'))
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(rawCalls()).toContainEqual(['tag', '--no-sign', '--', 'v1.0.0', 'HEAD'])
  })

  it('軽量タグはメッセージを渡さず、コミッター情報も確認しない', async () => {
    setupRaw({ ident: 'git-error' })
    await createTag('/project', lightweight('v1', 'ignored'))
    expect(rawCalls().find((args) => args[0] === 'tag')).toEqual([
      'tag',
      '--no-sign',
      '--',
      'v1',
      'HEAD'
    ])
    expect(calledCommands()).not.toContain('var')
  })

  // -a(--annotate)を明示すると tag.forceSignAnnotated=true より優先され、署名なしのタグになる
  // (実機 git 2.50.1 で確認)。--message だけで注釈付きになるため -a は付けない(パターン 45)
  it('注釈付きタグは tag --cleanup=whitespace --message=<message> -- <name> HEAD を呼ぶ', async () => {
    setupRaw()
    await createTag('/project', annotated('v1', 'リリース'))
    expect(rawCalls()).toContainEqual([
      'tag',
      '--cleanup=whitespace',
      '--message=リリース',
      '--',
      'v1',
      'HEAD'
    ])
  })

  // -m <値> の 2 引数だと、simple-git が `--upload-pack=...` 等の値をオプションとして拒否する
  // (パターン 49)。--message=<値> の 1 引数なら '-' 始まりも値として渡る(パターン 21)
  it.each(['-x', '--upload-pack=evil', '-c core.pager=evil', '#1 release\n\n本文'])(
    'メッセージ %j は --message=<message> の 1 引数で渡す',
    async (message) => {
      setupRaw()
      await createTag('/project', annotated('v1', message))
      expect(rawCalls()).toContainEqual([
        'tag',
        '--cleanup=whitespace',
        `--message=${message}`,
        '--',
        'v1',
        'HEAD'
      ])
    }
  )

  it('名前 → 衝突 → HEAD → コミッター情報 → 作成 → 作成の確認の順に git を呼ぶ', async () => {
    setupRaw()
    await createTag('/project', annotated('v1', 'm'))
    expect(rawCalls()).toEqual([
      ['check-ref-format', '--normalize', 'refs/tags/v1'],
      ['for-each-ref', '--format=%(refname)', 'refs/tags/'],
      ['for-each-ref', '--format=%(refname)', 'refs/heads/'],
      ['rev-parse', '-q', '--verify', 'HEAD^{commit}'],
      ['var', 'GIT_COMMITTER_IDENT'],
      ['tag', '--cleanup=whitespace', '--message=m', '--', 'v1', 'HEAD'],
      ['rev-parse', '-q', '--verify', 'refs/tags/v1']
    ])
  })
})

describe('名前の検証', () => {
  it.each(['', 'HEAD', 'head', '@'])('%j は git を一切呼ばずに拒否する', async (name) => {
    setupRaw()
    await expect(createTag('/project', lightweight(name))).rejects.toMatchObject({
      message: `タグ名として使用できない名前です: ${name}`
    })
    expect(mockRaw).not.toHaveBeenCalled()
  })

  // check-ref-format 自体にもオプションとして解釈されるため、git に渡す前に弾く(パターン 21)
  it.each(['-x', '--force', '-'])("'-' で始まる %s は git を一切呼ばずに拒否する", async (name) => {
    setupRaw()
    await expect(createTag('/project', lightweight(name))).rejects.toMatchObject({
      message: `\`-\` で始まるタグ名は使用できません: ${name}`
    })
    expect(mockRaw).not.toHaveBeenCalled()
  })

  // check-ref-format の失敗は終了コード 1・stderr 空で、simple-git は空文字で resolve する
  it('check-ref-format の出力が空(規則違反)なら拒否し、一覧を取りに行かない', async () => {
    setupRaw({ normalized: '' })
    await expect(createTag('/project', lightweight('a..b'))).rejects.toMatchObject({
      message: 'タグ名として使用できない名前です: a..b'
    })
    expect(calledCommands()).toEqual(['check-ref-format'])
  })

  it('check-ref-format が reject しても拒否する(判定できないときは拒否側。パターン 74)', async () => {
    setupRaw({ checkRefFormatRejects: true })
    await expect(createTag('/project', lightweight('v1'))).rejects.toMatchObject({
      message: 'タグ名として使用できない名前です: v1'
    })
    expect(calledCommands()).toEqual(['check-ref-format'])
  })

  // 'a//b' は --normalize で refs/tags/a/b に正規化され成功扱いになる。入力と違う名前は通さない(パターン 25)
  it('正規化で別の名前になる入力は拒否する', async () => {
    setupRaw({ normalized: 'refs/tags/a/b\n' })
    await expect(createTag('/project', lightweight('a//b'))).rejects.toMatchObject({
      message: 'タグ名として使用できない名前です: a//b'
    })
    expect(calledCommands()).not.toContain('tag')
  })
})

describe('衝突の検証', () => {
  it('同じ名前のタグがあれば拒否し、HEAD の確認にも進まない', async () => {
    setupRaw({ tags: ['v1'] })
    await expect(createTag('/project', lightweight('v1'))).rejects.toMatchObject({
      message: '同じ名前のタグが既に存在します: v1'
    })
    expect(calledCommands()).not.toContain('rev-parse')
    expect(calledCommands()).not.toContain('tag')
  })

  it.each([
    ['v1/x', ['v1'], 'v1'],
    ['v1', ['v1/x'], 'v1/x']
  ])('%s は既存のタグ %j と階層が衝突するので拒否する', async (name, tags, existing) => {
    setupRaw({ tags })
    await expect(createTag('/project', lightweight(name))).rejects.toMatchObject({
      message: `既存のタグ ${existing} と名前が衝突します: ${name}`
    })
    expect(calledCommands()).not.toContain('tag')
  })

  // 大文字小文字を区別しない FS では、packed-refs の 'v1' があると 'V1' が作れてしまい、既存のタグの
  // 解決を奪う。loose なら git の英語のエラーになる(実機 git 2.50.1 で確認)。FS に依存させず一律に弾く
  it.each([
    ['V1', ['v1'], 'v1'],
    ['v1', ['V1'], 'V1'],
    ['V1/x', ['v1'], 'v1'],
    ['v1', ['V1/x'], 'V1/x']
  ])(
    '%s は大文字小文字だけが違う既存のタグ %j と衝突するので拒否する',
    async (name, tags, existing) => {
      setupRaw({ tags })
      await expect(createTag('/project', lightweight(name))).rejects.toMatchObject({
        message: `既存のタグ ${existing} と名前が衝突します: ${name}`
      })
      expect(calledCommands()).not.toContain('tag')
    }
  )

  it('前方一致するだけの既存のタグとは衝突しない', async () => {
    setupRaw({ tags: ['v1'] })
    await createTag('/project', lightweight('v10'))
    expect(calledCommands()).toContain('tag')
  })

  // Windows の git で行末が \r\n でも、既存のタグを取りこぼさない(パターン 27)
  it('for-each-ref の行末が \\r\\n でも同名のタグを検出する', async () => {
    setupRaw({ tags: ['v1'], eol: '\r\n' })
    await expect(createTag('/project', lightweight('v1'))).rejects.toMatchObject({
      message: '同じ名前のタグが既に存在します: v1'
    })
  })

  it.each(['feat', 'FEAT'])(
    'ブランチ feat があるとき %s は拒否する(大文字小文字を無視。パターン 43)',
    async (name) => {
      setupRaw({ branches: ['main', 'feat'] })
      await expect(createTag('/project', lightweight(name))).rejects.toMatchObject({
        message: `同じ名前のブランチが存在するため、タグを作成できません: ${name}`
      })
      expect(calledCommands()).not.toContain('rev-parse')
      expect(calledCommands()).not.toContain('tag')
    }
  )

  it('名前が前方一致するだけのブランチがあっても作成する', async () => {
    setupRaw({ branches: ['main', 'feature'] })
    await createTag('/project', lightweight('feat'))
    expect(calledCommands()).toContain('tag')
  })
})

describe('HEAD と注釈付きの検証', () => {
  it('HEAD がコミットを指さなければ拒否し、コミッター情報の確認にも進まない', async () => {
    setupRaw({ head: '' })
    await expect(createTag('/project', annotated('v1', 'm'))).rejects.toMatchObject({
      message: 'コミットが無いため、タグを作成できません'
    })
    expect(calledCommands()).not.toContain('var')
    expect(calledCommands()).not.toContain('tag')
  })

  it.each(['', '   ', ' \n\t '])(
    '注釈付きでメッセージが空白だけ(%j)なら拒否し、コミッター情報を確認しない',
    async (message) => {
      setupRaw()
      await expect(createTag('/project', annotated('v1', message))).rejects.toMatchObject({
        message: '注釈付きタグにはメッセージが必要です'
      })
      expect(calledCommands()).not.toContain('var')
      expect(calledCommands()).not.toContain('tag')
    }
  )

  // spawn の引数に NUL を含められない
  it('注釈付きでメッセージに NUL を含むと拒否する', async () => {
    setupRaw()
    await expect(createTag('/project', annotated('v1', 'a\0b'))).rejects.toMatchObject({
      message: 'メッセージに使用できない文字が含まれています'
    })
    expect(calledCommands()).not.toContain('var')
    expect(calledCommands()).not.toContain('tag')
  })

  it('コミッター情報が解決できなければ(GitError)日本語で拒否し、作成しない', async () => {
    setupRaw({ ident: 'git-error' })
    await expect(createTag('/project', annotated('v1', 'm'))).rejects.toMatchObject({
      message: COMMITTER_UNKNOWN_MESSAGE
    })
    expect(calledCommands()).not.toContain('tag')
  })

  // GitError 以外(git が起動できない等)は「コミッター情報が無い」と誤認させず、そのまま投げる(パターン 74)
  it('git var が GitError 以外で失敗したら、その例外をそのまま投げる', async () => {
    setupRaw({ ident: 'spawn-error' })
    await expect(createTag('/project', annotated('v1', 'm'))).rejects.toMatchObject({
      message: 'spawn git ENOENT'
    })
    expect(calledCommands()).not.toContain('tag')
  })
})

describe('作成の失敗', () => {
  it('git tag が失敗したら git のメッセージを添えて投げる', async () => {
    setupRaw({ tagError: new MockGitError("fatal: tag 'v1' already exists\n") })
    await expect(createTag('/project', lightweight('v1'))).rejects.toMatchObject({
      message: "タグを作成できませんでした: fatal: tag 'v1' already exists"
    })
  })

  // 一覧が取れないと衝突を判定できない。英語の GitError をそのまま見せず、作成もしない(パターン 74)
  it.each([
    ['タグ', { tagsListRejects: true }, 'fatal: bad object refs/tags/x'],
    ['ブランチ', { branchesListRejects: true }, 'fatal: bad object refs/heads/x']
  ])(
    '%sの一覧の取得が reject したら日本語の失敗にし、作成しない',
    async (_kind, options, detail) => {
      setupRaw(options)
      await expect(createTag('/project', lightweight('v1'))).rejects.toMatchObject({
        message: `タグを作成できませんでした: ${detail}`
      })
      expect(calledCommands()).not.toContain('tag')
    }
  )

  // 作成後の確認が reject したら、成功扱いにせず日本語の失敗にする(パターン 69・74)
  it('作成後の確認(rev-parse)が reject したら日本語の失敗にする', async () => {
    setupRaw({ createdTagRejects: true })
    await expect(createTag('/project', lightweight('v1'))).rejects.toMatchObject({
      message: 'タグを作成できませんでした: fatal: unable to read refs'
    })
  })

  // 終了コード 0 でもタグができたとは限らない(パターン 69)
  it('git tag が成功してもタグが無ければ失敗にする', async () => {
    setupRaw({ createdTag: '' })
    await expect(createTag('/project', lightweight('v1'))).rejects.toMatchObject({
      message: 'タグを作成できませんでした'
    })
  })
})
```

```bash
npx vitest run src/main/__tests__/gitTagService.test.ts
```

Expected: FAIL（モジュール `../gitTagService` が無い）

- [ ] **Step 2: 統合テスト（実 git）を書く（`src/main/__tests__/gitTagService.integration.test.ts`）**

既存の統合テスト（`gitStashService.integration.test.ts`）と同じ隔離を使う（`stubIsolatedGitEnv` で `GIT_CONFIG_GLOBAL=/dev/null`・`GIT_CONFIG_NOSYSTEM=1`・`GIT_DEFAULT_REF_FORMAT=files`・`LC_ALL=C`。パターン 46）。

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CreateTagRequest } from '@shared/types'
import { COMMITTER_UNKNOWN_MESSAGE, createTag } from '../gitTagService'
import {
  commitAll,
  initRepo,
  runGit,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'

// gitTagService.test.ts は simple-git をモックするため、実際の git が引数をどう解釈するか
// (-- と HEAD の位置、--message の 1 引数、--no-sign、--cleanup)は検証できない。ここで実 git で固定する
describe('gitTagService(実 git)', () => {
  let repo: string

  const rev = (ref: string): string => runGit(repo, 'rev-parse', ref).trim()
  const objectType = (ref: string): string => runGit(repo, 'cat-file', '-t', ref).trim()
  const tagNames = (): string[] =>
    runGit(repo, 'tag', '-l')
      .split('\n')
      .filter((line) => line !== '')
  // %(contents) は本文の後に改行を付け、for-each-ref も行末に改行を足すため、末尾の改行を除いて比べる
  const tagMessage = (name: string): string =>
    runGit(repo, 'for-each-ref', '--format=%(contents)', `refs/tags/${name}`).replace(/\n+$/, '')
  const commit = (path: string, content: string, message = 'c'): void => {
    writeRepoFile(repo, path, content)
    commitAll(repo, message)
  }
  const lightweight = (name: string): CreateTagRequest => ({
    name,
    kind: 'lightweight',
    message: ''
  })
  const annotated = (name: string, message: string): CreateTagRequest => ({
    name,
    kind: 'annotated',
    message
  })

  beforeEach(() => {
    stubIsolatedGitEnv()
    repo = mkdtempSync(join(tmpdir(), 'tag-integration-'))
    initRepo(repo)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(repo, { recursive: true, force: true })
  })

  it('軽量タグを現在の HEAD に作る(オブジェクトの種類は commit)', async () => {
    commit('a.txt', 'one')
    await createTag(repo, lightweight('v1.0.0'))
    expect(objectType('v1.0.0')).toBe('commit')
    expect(rev('v1.0.0')).toBe(rev('HEAD'))
  })

  it('注釈付きタグを現在の HEAD に作る(オブジェクトの種類は tag)', async () => {
    commit('a.txt', 'one')
    await createTag(repo, annotated('v1.0.0', 'リリース 1.0.0'))
    expect(objectType('v1.0.0')).toBe('tag')
    expect(rev('v1.0.0^{commit}')).toBe(rev('HEAD'))
    expect(tagMessage('v1.0.0')).toBe('リリース 1.0.0')
  })

  // -m <値> だと simple-git が拒否し、`-` 始まりは git のオプションになりうる(パターン 21・49)
  it.each(['-x', '--upload-pack=evil', '-c core.pager=evil'])(
    '- で始まるメッセージ %j もそのまま本文になる',
    async (message) => {
      commit('a.txt', 'one')
      await createTag(repo, annotated('v1', message))
      expect(tagMessage('v1')).toBe(message)
    }
  )

  // 既定の cleanup(strip)は # で始まる行を消す(実機で確認)。--cleanup=whitespace で残す
  it('日本語・空白・複数行・# で始まる行を含むメッセージをそのまま残す', async () => {
    commit('a.txt', 'one')
    const message = '#1 リリース 準備\n\n本文 の 2 行目'
    await createTag(repo, annotated('v1', message))
    expect(tagMessage('v1')).toBe(message)
  })

  it('同じ名前のタグがあれば拒否し、既存のタグは変わらない', async () => {
    commit('a.txt', 'one')
    runGit(repo, 'tag', 'v1')
    const before = rev('v1')
    commit('a.txt', 'two')
    await expect(createTag(repo, lightweight('v1'))).rejects.toMatchObject({
      message: '同じ名前のタグが既に存在します: v1'
    })
    expect(rev('v1')).toBe(before)
  })

  it.each([
    ['v1/x', 'v1', 'v1'],
    ['v1', 'v1/x', 'v1/x']
  ])('%s は既存のタグ %s と階層が衝突するので拒否する', async (name, existing, conflicting) => {
    commit('a.txt', 'one')
    runGit(repo, 'tag', existing)
    await expect(createTag(repo, lightweight(name))).rejects.toMatchObject({
      message: `既存のタグ ${conflicting} と名前が衝突します: ${name}`
    })
    expect(tagNames()).toEqual([existing])
  })

  // 大文字小文字を区別しない FS(macOS)では、packed-refs の 'v1' があると git は 'V1' を終了コード 0 で
  // 作り、`git rev-parse v1` が 'V1' のコミットを返す。loose なら英語のエラーになる(実機 git 2.50.1 で確認)
  describe.each([
    ['packed-refs', true],
    ['loose', false]
  ])('大文字小文字だけが違う既存のタグ(%s)', (_label, pack) => {
    it.each([
      ['V1', 'v1'],
      ['V1/x', 'v1']
    ])(
      '%s は既存のタグ %s と衝突するので拒否し、既存のタグの解決を変えない',
      async (name, existing) => {
        commit('a.txt', 'one')
        runGit(repo, 'tag', existing)
        if (pack) runGit(repo, 'pack-refs', '--all')
        const before = rev(existing)
        commit('a.txt', 'two')
        await expect(createTag(repo, lightweight(name))).rejects.toMatchObject({
          message: `既存のタグ ${existing} と名前が衝突します: ${name}`
        })
        expect(rev(existing)).toBe(before)
        expect(tagNames()).toEqual([existing])
      }
    )
  })

  // git は同名のタグを黙って作る(終了コード 0)。アプリの側から曖昧さを作らない(パターン 43)
  it.each(['feat', 'FEAT'])('ブランチ feat があるとき %s のタグは作らない', async (name) => {
    commit('a.txt', 'one')
    runGit(repo, 'branch', 'feat')
    await expect(createTag(repo, lightweight(name))).rejects.toMatchObject({
      message: `同じ名前のブランチが存在するため、タグを作成できません: ${name}`
    })
    expect(tagNames()).toEqual([])
  })

  it.each(['HEAD', 'head', '@', 'a..b', 'a b', 'x.lock', '/x', 'a//b', 'x/'])(
    '使えない名前 %j は拒否し、タグを作らない',
    async (name) => {
      commit('a.txt', 'one')
      await expect(createTag(repo, lightweight(name))).rejects.toMatchObject({
        message: `タグ名として使用できない名前です: ${name}`
      })
      expect(tagNames()).toEqual([])
    }
  )

  it('detached HEAD でも、今の HEAD に作る', async () => {
    commit('a.txt', 'one')
    commit('a.txt', 'two')
    runGit(repo, 'checkout', '-q', '--detach', 'HEAD~1')
    await createTag(repo, lightweight('old'))
    expect(rev('old')).toBe(rev('HEAD'))
    expect(rev('old')).not.toBe(rev('main'))
  })

  it('マージ中でも作成でき、マージ中の状態は変わらない', async () => {
    commit('f.txt', 'base\n')
    runGit(repo, 'checkout', '-q', '-b', 'topic')
    commit('f.txt', 'topic\n')
    runGit(repo, 'checkout', '-q', 'main')
    commit('f.txt', 'main\n')
    // コンフリクトすると git merge は終了コード 1 で終わる(runGit は例外を投げる)
    expect(() => runGit(repo, 'merge', 'topic')).toThrow()
    const mergeHead = rev('MERGE_HEAD')
    await createTag(repo, lightweight('during-merge'))
    expect(rev('during-merge')).toBe(rev('HEAD'))
    expect(rev('MERGE_HEAD')).toBe(mergeHead)
    expect(runGit(repo, 'ls-files', '-u')).not.toBe('')
  })

  it('コミットが無いリポジトリでは拒否する', async () => {
    await expect(createTag(repo, lightweight('v1'))).rejects.toMatchObject({
      message: 'コミットが無いため、タグを作成できません'
    })
  })

  describe('コミッター情報が無い環境', () => {
    // 開発者の環境変数がコミッター情報を補わないよう外し、自動推定も無効にする(パターン 46)
    beforeEach(() => {
      commit('a.txt', 'one')
      runGit(repo, 'config', '--unset', 'user.name')
      runGit(repo, 'config', '--unset', 'user.email')
      runGit(repo, 'config', 'user.useConfigOnly', 'true')
      ;[
        'GIT_COMMITTER_NAME',
        'GIT_COMMITTER_EMAIL',
        'GIT_AUTHOR_NAME',
        'GIT_AUTHOR_EMAIL',
        'EMAIL'
      ].forEach((key) => vi.stubEnv(key, undefined))
    })

    it('注釈付きタグは日本語で拒否し、作らない', async () => {
      await expect(createTag(repo, annotated('v1', 'm'))).rejects.toMatchObject({
        message: COMMITTER_UNKNOWN_MESSAGE
      })
      expect(tagNames()).toEqual([])
    })

    it('軽量タグは作れる', async () => {
      await createTag(repo, lightweight('v1'))
      expect(objectType('v1')).toBe('commit')
    })
  })

  describe('tag.gpgSign=true で署名に失敗する環境(パターン 45)', () => {
    // --no-sign を外す変異で git がエディタを起動して待たないよう、エディタはすぐ失敗させる
    beforeEach(() => {
      commit('a.txt', 'one')
      runGit(repo, 'config', 'tag.gpgSign', 'true')
      runGit(repo, 'config', 'gpg.program', 'false')
      vi.stubEnv('GIT_EDITOR', 'false')
    })

    it('軽量タグは署名の設定に関わらず軽量のまま作る', async () => {
      await createTag(repo, lightweight('v1'))
      expect(objectType('v1')).toBe('commit')
    })

    it('注釈付きタグは署名の設定に従い、失敗を git のメッセージ付きで伝える', async () => {
      await expect(createTag(repo, annotated('v1', 'm'))).rejects.toThrow(
        /^タグを作成できませんでした: .+/
      )
      expect(tagNames()).toEqual([])
    })
  })

  // -a(--annotate)を明示すると tag.forceSignAnnotated より優先され、署名なしのタグが黙って作られる
  // (実機 git 2.50.1 で確認)。署名の方針は上書きしない(パターン 45)
  describe('tag.forceSignAnnotated=true で署名に失敗する環境(パターン 45)', () => {
    beforeEach(() => {
      commit('a.txt', 'one')
      runGit(repo, 'config', 'tag.forceSignAnnotated', 'true')
      runGit(repo, 'config', 'gpg.program', 'false')
      vi.stubEnv('GIT_EDITOR', 'false')
    })

    it('注釈付きタグは署名を試み、失敗を git のメッセージ付きで伝え、タグを残さない', async () => {
      await expect(createTag(repo, annotated('v1', 'm'))).rejects.toThrow(
        /^タグを作成できませんでした: .+/
      )
      expect(tagNames()).toEqual([])
    })

    it('軽量タグは影響を受けず作れる', async () => {
      await createTag(repo, lightweight('v1'))
      expect(objectType('v1')).toBe('commit')
    })
  })
})
```

```bash
npx vitest run src/main/__tests__/gitTagService.integration.test.ts
```

Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する（`src/main/gitTagService.ts`）**

```ts
import simpleGit, { GitError } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import type { CreateTagRequest } from '@shared/types'
import { getTagNameCollision, getTagNameRuleViolation, normalizeTagName } from '@shared/tagName'
import type { TagNameCollision, TagNameCollisionKind } from '@shared/tagName'
import { getTagMessageRuleViolation } from '@shared/tagMessage'
import type { TagMessageRuleViolation } from '@shared/tagMessage'

// タグの作成(git tag)。付ける先は常に現在の HEAD。タグの責務はこのファイルにまとめ、gitService.ts には
// 足さない(パターン 55)。ref を 1 つ増やすだけで作業ツリー・index・HEAD を変えないため、
// マージ中・detached HEAD・rebase / bisect の途中でも許可する

export const COMMITTER_UNKNOWN_MESSAGE =
  'コミッター情報（user.name / user.email）が未設定のため、注釈付きタグを作成できません'

const MESSAGE_RULE_VIOLATION_MESSAGES: Record<TagMessageRuleViolation, string> = {
  empty: '注釈付きタグにはメッセージが必要です',
  nul: 'メッセージに使用できない文字が含まれています'
}

// 衝突の種類ごとの文言。判定の順序は renderer と同じ getTagNameCollision(@shared/tagName)に従う
const COLLISION_MESSAGES: Record<
  TagNameCollisionKind,
  (collision: TagNameCollision, name: string) => string
> = {
  duplicate: (_collision, name) => `同じ名前のタグが既に存在します: ${name}`,
  conflict: (collision, name) => `既存のタグ ${collision.with} と名前が衝突します: ${name}`,
  branch: (_collision, name) => `同じ名前のブランチが存在するため、タグを作成できません: ${name}`
}

const TAGS_NAMESPACE = 'refs/tags/'
const HEADS_NAMESPACE = 'refs/heads/'

function invalidTagNameError(name: string): Error {
  return new Error(`タグ名として使用できない名前です: ${name}`)
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message.trim() : String(err).trim()
}

function tagCreateFailureError(detail: string): Error {
  return new Error(
    detail === '' ? 'タグを作成できませんでした' : `タグを作成できませんでした: ${detail}`
  )
}

// 名前空間の配下の ref 名を、名前空間を除いて返す。完全な refname で列挙するため、短い名前の解決
// (タグとブランチの曖昧さ)の影響を受けない(パターン 43)。行末の \r は分割で落とす(パターン 27)。
// 一覧が取れないと衝突を判定できないため、英語の GitError を見せずに作成の失敗として投げる(パターン 74)
async function listRefNames(git: SimpleGit, namespace: string): Promise<string[]> {
  let output: string
  try {
    output = await git.raw(['for-each-ref', '--format=%(refname)', namespace])
  } catch (err) {
    throw tagCreateFailureError(errorDetail(err))
  }
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith(namespace))
    .map((line) => line.slice(namespace.length))
}

// 1. アプリ独自の規則(@shared/tagName)。'-' 始まりは check-ref-format 自体にもオプションとして
//    解釈されるため、git に渡す前に弾く(パターン 21)
// 2. git 本体の規則は check-ref-format --normalize に委ねる。--normalize が無いと成功時も何も出力せず、
//    失敗時は終了コード 1・stderr 空で simple-git は空文字で resolve する。出力(trim)が入力の ref と
//    完全一致しなければ拒否することで、失敗と正規化(`a//b` → `a/b`)の両方を弾く(パターン 25)。
//    reject(git が起動できない等)も判定できないので拒否する(拒否側に倒す。パターン 74)
async function assertValidTagName(git: SimpleGit, name: string): Promise<void> {
  const violation = getTagNameRuleViolation(name)
  if (violation === 'leading-dash') {
    throw new Error(`\`-\` で始まるタグ名は使用できません: ${name}`)
  }
  if (violation !== null) throw invalidTagNameError(name)
  const ref = `${TAGS_NAMESPACE}${name}`
  let normalized: string
  try {
    normalized = (await git.raw(['check-ref-format', '--normalize', ref])).trim()
  } catch {
    throw invalidTagNameError(name)
  }
  if (normalized !== ref) throw invalidTagNameError(name)
}

// 3〜5. 同名のタグ・衝突するタグ(階層の衝突と大文字小文字だけの違い)・同名のブランチを、
// NFC にそろえて(衝突とブランチは大文字小文字も無視して)、git の英語のエラー
// (`already exists` / `cannot lock ref`)や、黙って作られる曖昧なタグ(パターン 43)より先に日本語で弾く。
// 判定の順序は renderer と共有する(@shared/tagName の getTagNameCollision)ため、一覧は先に両方取る
async function assertNoNameCollision(git: SimpleGit, name: string): Promise<void> {
  const tags = await listRefNames(git, TAGS_NAMESPACE)
  const branches = await listRefNames(git, HEADS_NAMESPACE)
  const collision = getTagNameCollision(name, tags, branches)
  if (collision !== null) throw new Error(COLLISION_MESSAGES[collision.kind](collision, name))
}

// 6. コミットが 1 つも無いリポジトリでは HEAD がコミットを指さない。rev-parse -q --verify は ref が
// 無いと終了コード 1・stderr 空で終わり、simple-git は空文字で resolve する。reject は本物の失敗なので
// 握りつぶさず投げる(パターン 74)
async function assertHeadIsCommit(git: SimpleGit): Promise<void> {
  const head = await git.raw(['rev-parse', '-q', '--verify', 'HEAD^{commit}'])
  if (head.trim() === '') throw new Error('コミットが無いため、タグを作成できません')
}

// 7. 注釈付きタグはタグオブジェクトにコミッター情報を書く。git var GIT_COMMITTER_IDENT は git tag -a と
// 同じ規則(user.name / user.email、user.useConfigOnly、自動推定)で解決し、解決できないと終了コード 128・
// stderr ありで失敗する(simple-git は GitError で reject。実機で確認)。英語の `Please tell me who you are`
// を見せる前に日本語で弾く。GitError 以外(git が起動できない等)は原因を取り違えないようそのまま投げる
async function assertAnnotatable(git: SimpleGit, message: string): Promise<void> {
  // メッセージの規則は renderer と同じ判定(@shared/tagMessage)を使う。文言は main 側のもの
  const violation = getTagMessageRuleViolation('annotated', message)
  if (violation !== null) throw new Error(MESSAGE_RULE_VIOLATION_MESSAGES[violation])
  try {
    await git.raw(['var', 'GIT_COMMITTER_IDENT'])
  } catch (err) {
    if (!(err instanceof GitError)) throw err
    throw new Error(COMMITTER_UNKNOWN_MESSAGE)
  }
}

// 作成してよいかを検証する。request は IPC 境界から届く任意の値(型だけ検証済み)のため、
// 次の順で検証し、前の検証に失敗したら後の git 呼び出しには進まない(設計書「main の検証と実行」)。
// request.name は入口(createTag)で normalizeTagName 済み
async function assertCreatableTag(git: SimpleGit, request: CreateTagRequest): Promise<void> {
  await assertValidTagName(git, request.name)
  await assertNoNameCollision(git, request.name)
  await assertHeadIsCommit(git)
  if (request.kind === 'annotated') await assertAnnotatable(git, request.message)
}

// 名前は `--` の後の位置引数、付ける先は HEAD と明示する。
// - 軽量: --no-sign。tag.gpgSign=true だと、付けない限り「署名付きの注釈付きタグ」に変わり、メッセージを
//   求めてエディタを起動して待つ(実機で確認)。軽量タグは署名できないため、軽量の意味を保つだけで、
//   注釈付きタグの署名の方針は上書きしない(パターン 45)
// - 注釈付き: --message=<message> の 1 引数。-m <message> の 2 引数だと simple-git の
//   blockUnsafeOperationsPlugin が `--upload-pack=...` 等の値をオプションとみなして拒否する(パターン 49)。
//   --message だけで注釈付きになるため -a(--annotate)は付けない。-a を明示すると tag.forceSignAnnotated=true
//   より優先され、署名なしのタグが黙って作られる(実機 git 2.50.1 で確認。パターン 45)。
//   --cleanup=whitespace は、既定の strip が `#` で始まる行を消すのを防ぐ(実機で確認)
function buildTagArgs(request: CreateTagRequest): string[] {
  if (request.kind === 'annotated') {
    return [
      'tag',
      '--cleanup=whitespace',
      `--message=${request.message}`,
      '--',
      request.name,
      'HEAD'
    ]
  }
  return ['tag', '--no-sign', '--', request.name, 'HEAD']
}

// 現在の HEAD にタグを作る。署名の失敗・他のプロセスとの競合などの git のエラーは、git のメッセージを
// 添えて返す(署名の設定は上書きしない)。終了コード 0 でもタグができたとは限らないため、
// 作成後に ref を確かめる(パターン 69)
export async function createTag(folderPath: string, rawRequest: CreateTagRequest): Promise<void> {
  // 名前は前後の空白を除き NFC にそろえる(@shared/tagName の normalizeTagName。renderer の送信値と同じ)。
  // 検証・衝突の判定・git tag・作成後の確認のすべてで、この名前を使う(NFD のまま渡すと、
  // check-ref-format を通り、既存の NFC のタグの解決を奪うか、作成後の確認で見つからない。実機で確認)
  const request: CreateTagRequest = { ...rawRequest, name: normalizeTagName(rawRequest.name) }
  const git = simpleGit(folderPath)
  await assertCreatableTag(git, request)
  try {
    await git.raw(buildTagArgs(request))
  } catch (err) {
    throw tagCreateFailureError(errorDetail(err))
  }
  // 確認の reject も成功扱いにせず、英語の GitError を見せずに作成の失敗として投げる(パターン 74)
  let created: string
  try {
    created = await git.raw(['rev-parse', '-q', '--verify', `${TAGS_NAMESPACE}${request.name}`])
  } catch (err) {
    throw tagCreateFailureError(errorDetail(err))
  }
  if (created.trim() === '') throw tagCreateFailureError('')
}
```

```bash
npx vitest run src/main/__tests__/gitTagService.test.ts src/main/__tests__/gitTagService.integration.test.ts
```

Expected: PASS

- [ ] **Step 4: ミューテーション**

手順は Global Constraints のとおり。次の変異で、それぞれ該当のテストが落ちること（落ちない変異があればテストを足す）。

1. 軽量の `--no-sign` を外す → 単体の引数のテスト、統合の `tag.gpgSign` の軽量タグのテスト（`GIT_EDITOR=false` で失敗する）
2. `--message=${message}` を `'-m', message` の 2 引数にする → 単体の引数のテスト、統合の `--upload-pack=evil`（simple-git が拒否）
3. `--cleanup=whitespace` を外す → 統合の `#` で始まる行のテスト
4. `--normalize` を外す → 単体の「名前 → 衝突 …の順」と統合の全成功ケース（出力が空になり常に拒否）
5. `normalized !== ref` の比較を外す → 単体の `a//b`、統合の `/x` `a//b`
6. `@shared/tagName` の `findSameNameBranch` を `branches.includes(name)` にする → 単体・統合の `FEAT`
7. `assertHeadIsCommit` を外す → 単体の HEAD のテストと統合のコミット無し（git の英語のエラーになる）
8. `assertAnnotatable` の `instanceof GitError` の判定を外す → 単体の spawn-error のテスト
9. `assertAnnotatable` の呼び出しを外す → 単体・統合のコミッター情報のテスト
10. 作成後の `rev-parse` の確認を外す → 単体の「タグが無ければ失敗」
11. 検証の順序を入れ替える（`assertHeadIsCommit` を名前の検証より前に）→ 単体の順序と「git を一切呼ばずに拒否」

- [ ] **Step 5: 検証**

```bash
npx vitest run src/main
npm run typecheck
npx eslint src/main/gitTagService.ts src/main/__tests__/gitTagService.test.ts src/main/__tests__/gitTagService.integration.test.ts
npx prettier --check src/main/gitTagService.ts src/main/__tests__/gitTagService.test.ts src/main/__tests__/gitTagService.integration.test.ts
```

Expected: すべて成功

- [ ] **Step 6: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 3: IPC ハンドラ・preload・`gitApi`

**Files:**

- Modify: `src/main/handlers/gitHandlers.ts`, `src/preload/api.ts`, `src/preload/index.d.ts`, `src/renderer/src/lib/gitApi.ts`
- Test: `src/main/__tests__/handlers/gitHandlers.test.ts`, `src/preload/__tests__/api.test.ts`, `src/renderer/src/lib/__tests__/gitApi.test.ts`

**Interfaces:**

- Consumes: Task 1 の `TAG_KINDS` / `CreateTagRequest`、Task 2 の `createTag`
- Produces: IPC `git:createTag`、`window.api.createTag(request: CreateTagRequest): Promise<void>`、`gitApi.createTag(request: CreateTagRequest): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/handlers/gitHandlers.test.ts`: 先頭のモック定義に追加し、モジュールをモックする（`vi.mock('../../gitStashService', …)` の直後）:

```ts
const mockCreateTag = vi.hoisted(() => vi.fn())
```

```ts
vi.mock('../../gitTagService', () => ({ createTag: mockCreateTag }))
```

`describe('git:stashPush', …)` の後に追加:

```ts
describe('git:createTag', () => {
  const request = { name: 'v1.0.0', kind: 'annotated', message: 'リリース' }

  // 型検証より先にフォルダの許可を確認する
  it('folderAccess が未設定のとき、引数に関わらず "No folder open" エラーをスロー', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
    registerGitHandlers(mockIpcMain, folderAccess)
    await expect(getRegisteredHandler('git:createTag')(makeEvent(1), 123)).rejects.toThrow(
      'No folder open'
    )
    expect(mockCreateTag).not.toHaveBeenCalled()
  })

  it('allowedFolder と要求を引数に createTag を呼ぶ', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    mockCreateTag.mockResolvedValue(undefined)
    await getRegisteredHandler('git:createTag')(makeEvent(1), request)
    expect(mockCreateTag).toHaveBeenCalledWith('/project', request)
  })

  // 余分なキーは service に渡さない(name・kind・message の 3 つだけを詰め直す)
  it('余分なキーは無視して、name・kind・message だけを渡す', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    mockCreateTag.mockResolvedValue(undefined)
    await getRegisteredHandler('git:createTag')(makeEvent(1), {
      ...request,
      force: true,
      sign: true
    })
    expect(mockCreateTag.mock.calls[0][1]).toStrictEqual(request)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['文字列', 'v1'],
    ['配列', ['v1']],
    ['name が無い', { kind: 'lightweight', message: '' }],
    ['name が文字列でない', { name: 1, kind: 'lightweight', message: '' }],
    ['kind が列挙外', { name: 'v1', kind: 'signed', message: '' }],
    ['kind が無い', { name: 'v1', message: '' }],
    ['message が文字列でない', { name: 'v1', kind: 'annotated', message: null }],
    ['message が無い', { name: 'v1', kind: 'lightweight' }]
  ])('要求が不正(%s)なら createTag を呼ばずに拒否する', async (_label, bad) => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    await expect(getRegisteredHandler('git:createTag')(makeEvent(1), bad)).rejects.toThrow(
      'Invalid tag request'
    )
    expect(mockCreateTag).not.toHaveBeenCalled()
  })

  it('createTag の失敗をそのまま伝える', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    mockCreateTag.mockRejectedValue(new Error('同じ名前のタグが既に存在します: v1.0.0'))
    await expect(getRegisteredHandler('git:createTag')(makeEvent(1), request)).rejects.toThrow(
      '同じ名前のタグが既に存在します: v1.0.0'
    )
  })
})
```

`src/preload/__tests__/api.test.ts` の `invokeCases` の `stashPush` の項目の前に追加:

```ts
  [
    'createTag は git:createTag チャンネルに要求を渡す',
    () => api.createTag({ name: 'v1', kind: 'annotated', message: 'm' }),
    ['git:createTag', { name: 'v1', kind: 'annotated', message: 'm' }]
  ],
```

`src/renderer/src/lib/__tests__/gitApi.test.ts`: import 文と `mockApi` に `createTag` / `createTag: vi.fn()` を足し、末尾に追加:

```ts
describe('createTag', () => {
  it('window.api.createTag を要求で呼ぶ', async () => {
    mockApi.createTag.mockResolvedValue(undefined)
    const request = { name: 'v1', kind: 'lightweight' as const, message: '' }
    await createTag(request)
    expect(mockApi.createTag).toHaveBeenCalledWith(request)
  })

  it('失敗をそのまま伝える', async () => {
    mockApi.createTag.mockRejectedValue(new Error('コミットが無いため、タグを作成できません'))
    await expect(createTag({ name: 'v1', kind: 'lightweight', message: '' })).rejects.toThrow(
      'コミットが無いため、タグを作成できません'
    )
  })
})
```

```bash
npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts src/preload src/renderer/src/lib/__tests__/gitApi.test.ts
```

Expected: FAIL（ハンドラ・API が無い）

- [ ] **Step 2: 実装する**

`src/main/handlers/gitHandlers.ts`:

```ts
import { CONFLICT_CHOICES, TAG_KINDS } from '@shared/types'
import type { ConflictChoice, CreateTagRequest, DiscardAllEntry } from '@shared/types'
```

```ts
import { createTag } from '../gitTagService'
```

`assertConflictSideArg` の後に追加:

```ts
// { name: string, kind: 'lightweight' | 'annotated', message: string } のオブジェクトであることだけを検証する。
// 値の中身(名前の規則・重複・メッセージの空)は service 層が検証する。余分なキーは呼び出し側で
// 詰め直して service に渡さない
function assertCreateTagArg(value: unknown): asserts value is CreateTagRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid tag request')
  }
  const { name, kind, message } = value as Record<string, unknown>
  const valid =
    typeof name === 'string' &&
    typeof message === 'string' &&
    typeof kind === 'string' &&
    (TAG_KINDS as readonly string[]).includes(kind)
  if (!valid) throw new Error('Invalid tag request')
}
```

`git:stashDrop` のハンドラの後に追加:

```ts
ipcMain.handle('git:createTag', async (event: IpcMainInvokeEvent, request: unknown) => {
  const allowedFolder = getAllowedFolder(folderAccess, event)
  assertCreateTagArg(request)
  await createTag(allowedFolder, {
    name: request.name,
    kind: request.kind,
    message: request.message
  })
})
```

`src/preload/api.ts`（import type に `CreateTagRequest` を足し、`stashDrop` の後に追加）:

```ts
  createTag: (request: CreateTagRequest): Promise<void> =>
    ipcRenderer.invoke('git:createTag', request),
```

`src/preload/index.d.ts`（import type に `CreateTagRequest` を足し、`stashDrop` の後に追加）:

```ts
      createTag(request: CreateTagRequest): Promise<void>
```

`src/renderer/src/lib/gitApi.ts`（import type に `CreateTagRequest` を足し、`stashDrop` の関数の後に追加）:

```ts
export function createTag(request: CreateTagRequest): Promise<void> {
  return window.api.createTag(request)
}
```

```bash
npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts src/preload src/renderer/src/lib/__tests__/gitApi.test.ts
```

Expected: PASS

- [ ] **Step 3: ミューテーション**

(1) `assertCreateTagArg` の `TAG_KINDS` の判定を外す → `kind が列挙外` / `kind が無い` が落ちる、(2) 詰め直しをやめて `request` をそのまま渡す → 「余分なキー」が落ちる、(3) `getAllowedFolder` と `assertCreateTagArg` の順を入れ替える → 「No folder open」が落ちる、(4) preload のチャネル名を `git:createTags` にする → preload のテストが落ちる。

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

### Task 4: renderer の検証（`tagValidation`）と `useGitTagOperations`

**Files:**

- Modify: `src/renderer/src/types.ts`
- Create: `src/renderer/src/lib/tagValidation.ts`, `src/renderer/src/lib/__tests__/tagValidation.test.ts`, `src/renderer/src/hooks/useGitTagOperations.ts`, `src/renderer/src/hooks/__tests__/useGitTagOperations.test.ts`, `src/renderer/src/__tests__/makeGitTagPanelState.ts`

**Interfaces:**

- Consumes: Task 1 の `@shared/tagName` と `CreateTagRequest` / `TagKind`、Task 3 の `gitApi.createTag`、`useRunExclusiveGitOperation` / `useFileOperationLock` / `isGitOperationDisabled`
- Produces:
  - `GitTagPanelState`（`src/renderer/src/types.ts`）
  - `validateTagName(name: string, existingTags: readonly string[], existingBranches: readonly string[]): string | null`（`name` は内部で `normalizeTagName` を通してから検証する。差分 10）、`validateTagMessage(kind: TagKind, message: string): string | null`
  - `useGitTagOperations(gitStatus: GitStatusResult | null, refreshHistory: () => Promise<void>, fileLock?: FileOperationLock): GitTagPanelState`
  - `makeGitTagPanelState(overrides?: Partial<GitTagPanelState>): GitTagPanelState`（テスト用）

- [ ] **Step 1: 型とテスト用のモックを足す**

`src/renderer/src/types.ts` の先頭の import を `import type { CreateTagRequest, FileTreeNode, GitStashEntry } from '@shared/types'` にし、`MergeStatePanelState` の後に追加:

```ts
// タグの作成(履歴セクションの「タグを作成」とダイアログ)が受け取る状態と操作。
// App → Sidebar → SourceControlPanel → GitRepoView → HistorySection へ 1 つの props(gitTag)で渡す
export interface GitTagPanelState {
  /** タグの作成が実行中か(ダイアログの作成ボタンと入力を disabled にする) */
  isCreating: boolean
  /** 作成の失敗(main のエラー)。ダイアログ内に role="alert" で表示する */
  error: Error | null
  /** 現在の HEAD にタグを作る。戻り値は実際に実行され成功したか(ダイアログを閉じるかの判定に使う)。
   *  他の操作中などで実行しなかった場合と失敗した場合は false */
  createTag: (request: CreateTagRequest) => Promise<boolean>
  /** error を消す。ダイアログを開くときに、前回の失敗の表示を持ち越さないために呼ぶ */
  clearError: () => void
}
```

`src/renderer/src/__tests__/makeGitTagPanelState.ts`:

```ts
import { vi } from 'vitest'
import type { GitTagPanelState } from '../types'

/**
 * テスト用の GitTagPanelState(useGitTagOperations の戻り値)のモック。既定は「実行していない・
 * エラーなし・作成は成功する」。各操作は GitTagPanelState の型で vi.fn を作るため、戻り値の契約
 * (createTag は Promise<boolean>)から外れたモックは型検査で検出される(パターン 78)
 */
export const makeGitTagPanelState = (
  overrides: Partial<GitTagPanelState> = {}
): GitTagPanelState => ({
  isCreating: false,
  error: null,
  createTag: vi.fn<GitTagPanelState['createTag']>().mockResolvedValue(true),
  clearError: vi.fn<GitTagPanelState['clearError']>(),
  ...overrides
})
```

- [ ] **Step 2: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/tagValidation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateTagMessage, validateTagName } from '../tagValidation'

describe('validateTagName', () => {
  it.each([
    ['', '名前を入力してください'],
    ['-x', '`-` で始まる名前は使用できません'],
    ['HEAD', 'この名前は使用できません'],
    ['head', 'この名前は使用できません'],
    ['@', 'この名前は使用できません']
  ])('規則に違反する %j は「%s」', (name, expected) => {
    expect(validateTagName(name, [], ['main'])).toBe(expected)
  })

  it('既存のタグと同名なら拒否する', () => {
    expect(validateTagName('v1', ['v1'], ['main'])).toBe('同じ名前のタグが既に存在します')
  })

  it('既存のタグと階層が衝突する名前は拒否する(両方の向き)', () => {
    expect(validateTagName('v1/x', ['v1'], [])).toBe('既存のタグ v1 と名前が衝突します')
    expect(validateTagName('v1', ['v1/x'], [])).toBe('既存のタグ v1/x と名前が衝突します')
  })

  // main と同じく大文字小文字を無視する(getTagNameCollision。「設計書との差分」5)
  it('大文字小文字だけが違う既存のタグ・階層の衝突も拒否する', () => {
    expect(validateTagName('V1', ['v1'], [])).toBe('既存のタグ v1 と名前が衝突します')
    expect(validateTagName('V1/x', ['v1'], [])).toBe('既存のタグ v1 と名前が衝突します')
    expect(validateTagName('V10', ['v1'], [])).toBeNull()
  })

  it.each(['main', 'Main', 'MAIN'])(
    'ブランチ main と同名(大文字小文字を無視)の %s は拒否する',
    (name) => {
      expect(validateTagName(name, [], ['main'])).toBe(
        '同じ名前のブランチが存在するため、タグを作成できません'
      )
    }
  )

  // 規則違反(@shared/tagName)は重複より先に判定する
  it('規則違反の名前は、既存のタグと一致していても規則違反の文言を返す', () => {
    expect(validateTagName('@', ['@'], [])).toBe('この名前は使用できません')
  })

  // それ以外の形式(`..` 等)は main 側の check-ref-format に委ねる
  it('それ以外は null(通過)', () => {
    expect(validateTagName('v1.0.0', ['v1'], ['main'])).toBeNull()
    expect(validateTagName('a..b', [], [])).toBeNull()
    expect(validateTagName('mainline', [], ['main'])).toBeNull()
  })
})

describe('validateTagMessage', () => {
  it('軽量タグはメッセージを見ない', () => {
    expect(validateTagMessage('lightweight', '')).toBeNull()
    expect(validateTagMessage('lightweight', 'a\0b')).toBeNull()
  })

  it.each(['', '   ', '\n\t'])(
    '注釈付きで空白だけ(%j)は「メッセージを入力してください」',
    (message) => {
      expect(validateTagMessage('annotated', message)).toBe('メッセージを入力してください')
    }
  )

  it('注釈付きで NUL を含むと拒否する', () => {
    expect(validateTagMessage('annotated', 'a\0b')).toBe(
      'メッセージに使用できない文字が含まれています'
    )
  })

  it('注釈付きで本文があれば null', () => {
    expect(validateTagMessage('annotated', '-x リリース')).toBeNull()
  })
})
```

`src/renderer/src/hooks/__tests__/useGitTagOperations.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CreateTagRequest, GitStatusResult } from '@shared/types'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useGitTagOperations } from '../useGitTagOperations'
import type { GitTagPanelState } from '../../types'
import type { FileOperationLock } from '../useFileOperationLock'

const mockCreateTag = vi.mocked(gitApi.createTag)

const makeFileLock = (overrides: Partial<FileOperationLock> = {}): FileOperationLock => ({
  isLocked: vi.fn().mockReturnValue(false),
  lock: vi.fn(),
  unlock: vi.fn(),
  isAnyLocked: vi.fn().mockReturnValue(false),
  lockGlobal: vi.fn(),
  unlockGlobal: vi.fn(),
  ...overrides
})
const repoStatus: GitStatusResult = {
  isRepo: true,
  mergeInProgress: false,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: []
}
const request: CreateTagRequest = { name: 'v1.0.0', kind: 'annotated', message: 'リリース' }

const setup = (
  overrides: {
    status?: GitStatusResult | null
    lock?: FileOperationLock
    refreshHistory?: () => Promise<void>
  } = {}
): RenderHookResult<GitTagPanelState, unknown> & {
  refreshHistory: () => Promise<void>
  lock: FileOperationLock
} => {
  const refreshHistory =
    overrides.refreshHistory ?? vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const lock = overrides.lock ?? makeFileLock()
  const hook = renderHook(() =>
    useGitTagOperations(
      overrides.status === undefined ? repoStatus : overrides.status,
      refreshHistory,
      lock
    )
  )
  return { ...hook, refreshHistory, lock }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useGitTagOperations', () => {
  it('createTag を要求で呼び、成功したら true を返して履歴(ログ・ブランチ・タグ)を再取得する', async () => {
    mockCreateTag.mockResolvedValue(undefined)
    const { result, refreshHistory } = setup()
    let ok = false
    await act(async () => {
      ok = await result.current.createTag(request)
    })
    expect(ok).toBe(true)
    expect(mockCreateTag).toHaveBeenCalledWith(request)
    expect(refreshHistory).toHaveBeenCalledOnce()
    expect(result.current.error).toBeNull()
  })

  // ref を 1 つ増やすだけで、push / pull / ブランチ操作と読み書きする対象が重ならない(設計書)
  it('lockGlobal は取らない', async () => {
    mockCreateTag.mockResolvedValue(undefined)
    const { result, lock } = setup()
    await act(async () => {
      await result.current.createTag(request)
    })
    expect(lock.lockGlobal).not.toHaveBeenCalled()
    expect(lock.unlockGlobal).not.toHaveBeenCalled()
  })

  it('実行中は isCreating が true で、再取得が終わってから false に戻る', async () => {
    let resolveCreate: () => void = () => {}
    let resolveRefresh: () => void = () => {}
    mockCreateTag.mockReturnValue(new Promise<void>((r) => (resolveCreate = r)))
    const refreshHistory = vi
      .fn<() => Promise<void>>()
      .mockReturnValue(new Promise<void>((r) => (resolveRefresh = r)))
    const { result } = setup({ refreshHistory })
    act(() => {
      void result.current.createTag(request)
    })
    expect(result.current.isCreating).toBe(true)
    await act(async () => {
      resolveCreate()
    })
    // 再取得の途中はまだ実行中(古い一覧のまま操作させない。パターン 73)
    expect(result.current.isCreating).toBe(true)
    await act(async () => {
      resolveRefresh()
    })
    expect(result.current.isCreating).toBe(false)
  })

  // 失敗しても、他のプロセスが作ったタグ等を反映するため再取得する(パターン 73)
  it('失敗したら false を返し、error に反映して、履歴も再取得する', async () => {
    mockCreateTag.mockRejectedValue(new Error('同じ名前のタグが既に存在します: v1.0.0'))
    const { result, refreshHistory } = setup()
    let ok = true
    await act(async () => {
      ok = await result.current.createTag(request)
    })
    expect(ok).toBe(false)
    expect(result.current.error?.message).toBe('同じ名前のタグが既に存在します: v1.0.0')
    expect(result.current.isCreating).toBe(false)
    expect(refreshHistory).toHaveBeenCalledOnce()
  })

  // 再取得の失敗で、作成の成功を失敗にしない(パターン 52)
  it('作成に成功して再取得が失敗しても true を返し、error は null のまま', async () => {
    mockCreateTag.mockResolvedValue(undefined)
    const refreshHistory = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('log failed'))
    const { result } = setup({ refreshHistory })
    let ok = false
    await act(async () => {
      ok = await result.current.createTag(request)
    })
    expect(ok).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('実行中にもう一度呼ぶと、二重に作成せず false を返す', async () => {
    let resolveCreate: () => void = () => {}
    mockCreateTag.mockReturnValue(new Promise<void>((r) => (resolveCreate = r)))
    const { result } = setup()
    let second = true
    await act(async () => {
      void result.current.createTag(request)
      second = await result.current.createTag(request)
    })
    expect(second).toBe(false)
    expect(mockCreateTag).toHaveBeenCalledOnce()
    await act(async () => {
      resolveCreate()
    })
  })

  // checkout・マージ・commit の途中は HEAD が動くため、付ける先が定まるまで実行しない
  it('他の Git 操作がロックを持っている間は実行せず false を返す', async () => {
    const { result, refreshHistory } = setup({
      lock: makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    })
    let ok = true
    await act(async () => {
      ok = await result.current.createTag(request)
    })
    expect(ok).toBe(false)
    expect(mockCreateTag).not.toHaveBeenCalled()
    expect(refreshHistory).not.toHaveBeenCalled()
  })

  it.each([
    ['null', null],
    ['リポジトリでない', { ...repoStatus, isRepo: false }]
  ])('gitStatus が %s の間は実行せず false を返す', async (_label, status) => {
    const { result } = setup({ status })
    let ok = true
    await act(async () => {
      ok = await result.current.createTag(request)
    })
    expect(ok).toBe(false)
    expect(mockCreateTag).not.toHaveBeenCalled()
  })

  it('失敗の後に成功すると error が消える', async () => {
    mockCreateTag.mockRejectedValueOnce(new Error('失敗')).mockResolvedValueOnce(undefined)
    const { result } = setup()
    await act(async () => {
      await result.current.createTag(request)
    })
    expect(result.current.error?.message).toBe('失敗')
    await act(async () => {
      await result.current.createTag(request)
    })
    expect(result.current.error).toBeNull()
  })

  it('clearError で error を消す', async () => {
    mockCreateTag.mockRejectedValue(new Error('失敗'))
    const { result } = setup()
    await act(async () => {
      await result.current.createTag(request)
    })
    act(() => {
      result.current.clearError()
    })
    expect(result.current.error).toBeNull()
  })
})
```

```bash
npx vitest run src/renderer/src/lib/__tests__/tagValidation.test.ts src/renderer/src/hooks/__tests__/useGitTagOperations.test.ts
```

Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/lib/tagValidation.ts`:

```ts
import { getTagNameCollision, getTagNameRuleViolation, normalizeTagName } from '@shared/tagName'
import type { TagNameCollision, TagNameCollisionKind, TagNameRuleViolation } from '@shared/tagName'
import { getTagMessageRuleViolation } from '@shared/tagMessage'
import type { TagMessageRuleViolation } from '@shared/tagMessage'
import type { TagKind } from '@shared/types'

// タグの作成ダイアログの検証(UX 用)。アプリ独自の規則と、既存のタグ・ブランチとの衝突は
// main と同じ判定(@shared/tagName)を使う。git の規則(`..`、空白、末尾の .lock 等)は main 側の
// check-ref-format に委ねる(セキュリティ境界も main 側)。name は main の入口と同じ normalizeTagName
// (前後の空白を除き NFC)を通してから検証する
const RULE_VIOLATION_MESSAGES: Record<TagNameRuleViolation, string> = {
  empty: '名前を入力してください',
  'leading-dash': '`-` で始まる名前は使用できません',
  reserved: 'この名前は使用できません'
}

const COLLISION_MESSAGES: Record<TagNameCollisionKind, (collision: TagNameCollision) => string> = {
  duplicate: () => '同じ名前のタグが既に存在します',
  conflict: (collision) => `既存のタグ ${collision.with} と名前が衝突します`,
  branch: () => '同じ名前のブランチが存在するため、タグを作成できません'
}

export function validateTagName(
  name: string,
  existingTags: readonly string[],
  existingBranches: readonly string[]
): string | null {
  const normalized = normalizeTagName(name)
  const violation = getTagNameRuleViolation(normalized)
  if (violation !== null) return RULE_VIOLATION_MESSAGES[violation]
  const collision = getTagNameCollision(normalized, existingTags, existingBranches)
  return collision === null ? null : COLLISION_MESSAGES[collision.kind](collision)
}

const MESSAGE_RULE_VIOLATION_MESSAGES: Record<TagMessageRuleViolation, string> = {
  empty: 'メッセージを入力してください',
  nul: 'メッセージに使用できない文字が含まれています'
}

// 注釈付きタグのメッセージの検証。規則は main と同じ判定(@shared/tagMessage)を使う
export function validateTagMessage(kind: TagKind, message: string): string | null {
  const violation = getTagMessageRuleViolation(kind, message)
  return violation === null ? null : MESSAGE_RULE_VIOLATION_MESSAGES[violation]
}
```

`src/renderer/src/hooks/useGitTagOperations.ts`:

```ts
import { useRef, useState } from 'react'
import type { CreateTagRequest, GitStatusResult } from '@shared/types'
import * as gitApi from '../lib/gitApi'
import { isGitOperationDisabled } from '../lib/gitUtils'
import type { GitTagPanelState } from '../types'
import { useFileOperationLock } from './useFileOperationLock'
import type { FileOperationLock } from './useFileOperationLock'
import { useRunExclusiveGitOperation } from './useRunExclusiveGitOperation'

// タグの作成。useGitStashOperations と同じ作り: 作成どうしは実行中フラグ(ref)で排他にし、
// 他の Git 操作がロックを持っている間(lock.isAnyLocked())とリポジトリが無い間は実行しない。
// checkout・マージ・commit の途中は HEAD が動くため、付ける先が定まるまで待つ(ブランチの削除と同じ判断)。
// 作成は ref を 1 つ増やすだけで作業ツリー・index・HEAD を変えず、push / pull / ブランチ操作と読み書きする
// 対象が重ならないため、lockGlobal は取らない(取ると作成中に push 等が無意味に待たされる)。
// 再取得は成功・失敗のどちらでも行い(他のプロセスが作ったタグも反映する)、実行中フラグは再取得の後で
// 解除する(useRunExclusiveGitOperation。パターン 73)。再取得の失敗は作成の成否を変えない(パターン 52)
export function useGitTagOperations(
  gitStatus: GitStatusResult | null,
  refreshHistory: () => Promise<void>,
  fileLock?: FileOperationLock
): GitTagPanelState {
  const [isCreating, setIsCreating] = useState(false)
  const isRunningRef = useRef(false)
  const [error, setError] = useState<Error | null>(null)
  const localFileLock = useFileOperationLock()
  const lock = fileLock ?? localFileLock
  const isDisabled = isGitOperationDisabled(gitStatus)

  // 履歴の再取得(useGitHistory.refresh)がログ・ブランチ・タグをまとめて取り直す。
  // 作業ツリーは変わらないため、ステータスの再取得は不要
  const runOperation = useRunExclusiveGitOperation(refreshHistory, setError)

  const createTag = (request: CreateTagRequest): Promise<boolean> =>
    runOperation({
      isBusy: () => isRunningRef.current || lock.isAnyLocked() || isDisabled,
      setBusy: (busy) => {
        isRunningRef.current = busy
        setIsCreating(busy)
      },
      // 再試行の作成中に前回のエラー(role="alert")を残さない(PR #41 の 3 周目のレビューで追加)
      onStart: () => setError(null),
      execute: () => gitApi.createTag(request)
    })

  const clearError = (): void => setError(null)

  return { isCreating, error, createTag, clearError }
}
```

```bash
npx vitest run src/renderer/src/lib/__tests__/tagValidation.test.ts src/renderer/src/hooks/__tests__/useGitTagOperations.test.ts
```

Expected: PASS

- [ ] **Step 4: ミューテーション**

(1) `isBusy` から `lock.isAnyLocked()` を外す → ロック中のテストが落ちる、(2) `isRunningRef.current` を外す → 二重実行のテストが落ちる、(3) `isDisabled` を外す → gitStatus のテスト（2 行とも）が落ちる、(4) `onStart: lock.lockGlobal` を足す → `lockGlobal は取らない` が落ちる、(5) `validateTagName` のブランチ判定を外す → `Main` / `MAIN` / `main` が落ちる、(6) `getTagMessageRuleViolation` の `trim()` を外す → 空白だけのテスト（`tagMessage.test.ts` と `tagValidation.test.ts`）が落ちる。

- [ ] **Step 5: 検証**

```bash
npx vitest run src/renderer/src/lib src/renderer/src/hooks
npm run typecheck
npx eslint src/renderer/src/types.ts src/renderer/src/lib/tagValidation.ts src/renderer/src/hooks/useGitTagOperations.ts src/renderer/src/__tests__/makeGitTagPanelState.ts src/renderer/src/lib/__tests__/tagValidation.test.ts src/renderer/src/hooks/__tests__/useGitTagOperations.test.ts
npx prettier --check src/renderer/src/types.ts src/renderer/src/lib/tagValidation.ts src/renderer/src/hooks/useGitTagOperations.ts src/renderer/src/__tests__/makeGitTagPanelState.ts src/renderer/src/lib/__tests__/tagValidation.test.ts src/renderer/src/hooks/__tests__/useGitTagOperations.test.ts
```

Expected: すべて成功

- [ ] **Step 6: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 5: `CreateTagDialog` と `HistorySection` のボタン・CSS

**Files:**

- Create: `src/renderer/src/components/source-control/CreateTagDialog.tsx`, `src/renderer/src/components/source-control/__tests__/CreateTagDialog.test.tsx`, `src/renderer/src/components/source-control/__tests__/HistorySection.styles.test.tsx`
- Modify: `src/renderer/src/components/source-control/HistorySection.tsx`, `src/renderer/src/components/source-control/__tests__/HistorySection.test.tsx`, `src/renderer/src/assets/main.css`

**Interfaces:**

- Consumes: Task 4 の `GitTagPanelState` / `validateTagName` / `validateTagMessage` / `makeGitTagPanelState`
- Produces:
  - `CreateTagDialog` の Props: `tags: string[]`、`branchNames: string[]`、`isCreating: boolean`、`isBlocked: boolean`、`error: Error | null`、`onSubmit: (request: CreateTagRequest) => void`、`onCancel: () => void`
  - `HistorySection` に Props `gitTag: GitTagPanelState` と `isBlocked: boolean` を足す（必須）

`NameInputDialog` は名前 1 つの入力（`validate` と `onSubmit(name)`）の前提で、種類とメッセージを持てない。見た目の枠（`.name-input-dialog__*` のクラス）を共有した別コンポーネントにする（設計書の方針）。

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/source-control/__tests__/CreateTagDialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import CreateTagDialog from '../CreateTagDialog'

type Props = ComponentProps<typeof CreateTagDialog>

const renderDialog = (overrides: Partial<Props> = {}): Props & { container: HTMLElement } => {
  const props: Props = {
    tags: [],
    branchNames: ['main'],
    isCreating: false,
    isBlocked: false,
    error: null,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides
  }
  const { container } = render(<CreateTagDialog {...props} />)
  return { ...props, container }
}
const nameInput = (): HTMLElement => screen.getByRole('textbox', { name: 'タグ名' })
const createButton = (): HTMLElement => screen.getByRole('button', { name: '作成' })
const radio = (name: '軽量' | '注釈付き'): HTMLElement => screen.getByRole('radio', { name })

describe('CreateTagDialog', () => {
  it('開くとタグ名の入力欄にフォーカスがあり、種類は軽量で、メッセージ欄は無い', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'タグを作成' })).toHaveAccessibleDescription(
      '現在の HEAD にタグを付けます'
    )
    expect(nameInput()).toHaveFocus()
    expect(screen.getByRole('radiogroup', { name: '種類' })).toBeInTheDocument()
    expect(radio('軽量')).toHaveAttribute('aria-checked', 'true')
    expect(radio('注釈付き')).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('textbox', { name: 'メッセージ' })).not.toBeInTheDocument()
  })

  it('名前が空の間は作成ボタンが disabled で、理由を入力欄の説明として表示する', () => {
    renderDialog()
    expect(createButton()).toBeDisabled()
    expect(nameInput()).toHaveAccessibleDescription('名前を入力してください')
    expect(nameInput()).toHaveAttribute('aria-invalid', 'true')
  })

  it('前後の空白を除いた名前で、軽量タグ(メッセージは空)を送る', async () => {
    const props = renderDialog()
    await userEvent.type(nameInput(), '  v1.0.0  ')
    expect(nameInput()).toHaveAttribute('aria-invalid', 'false')
    await userEvent.click(createButton())
    expect(props.onSubmit).toHaveBeenCalledWith({
      name: 'v1.0.0',
      kind: 'lightweight',
      message: ''
    })
  })

  it('タグ名の入力欄で Enter を押しても送る', async () => {
    const props = renderDialog()
    await userEvent.type(nameInput(), 'v1{Enter}')
    expect(props.onSubmit).toHaveBeenCalledOnce()
  })

  it.each([
    ['-x', '`-` で始まる名前は使用できません'],
    ['HEAD', 'この名前は使用できません'],
    ['v1', '同じ名前のタグが既に存在します'],
    ['v1/x', '既存のタグ v1 と名前が衝突します'],
    ['Main', '同じ名前のブランチが存在するため、タグを作成できません']
  ])('名前 %s は「%s」を表示して作成できない', async (name, message) => {
    const props = renderDialog({ tags: ['v1'], branchNames: ['main'] })
    await userEvent.type(nameInput(), `${name}{Enter}`)
    expect(nameInput()).toHaveAccessibleDescription(message)
    expect(createButton()).toBeDisabled()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('注釈付きを選ぶとメッセージ欄が出て、メッセージが空白だけの間は作成できない', async () => {
    const props = renderDialog()
    await userEvent.type(nameInput(), 'v1')
    await userEvent.click(radio('注釈付き'))
    expect(radio('注釈付き')).toHaveAttribute('aria-checked', 'true')
    const messageInput = screen.getByRole('textbox', { name: 'メッセージ' })
    expect(messageInput).toHaveAccessibleDescription('メッセージを入力してください')
    expect(createButton()).toBeDisabled()
    await userEvent.type(messageInput, '   ')
    expect(createButton()).toBeDisabled()
    await userEvent.clear(messageInput)
    await userEvent.type(messageInput, 'リリース{Enter}2 行目')
    await userEvent.click(createButton())
    expect(props.onSubmit).toHaveBeenCalledWith({
      name: 'v1',
      kind: 'annotated',
      message: 'リリース\n2 行目'
    })
  })

  it('注釈付きから軽量に戻すと、メッセージ欄が消え、送るメッセージは空になる', async () => {
    const props = renderDialog()
    await userEvent.type(nameInput(), 'v1')
    await userEvent.click(radio('注釈付き'))
    await userEvent.type(screen.getByRole('textbox', { name: 'メッセージ' }), 'm')
    await userEvent.click(radio('軽量'))
    expect(screen.queryByRole('textbox', { name: 'メッセージ' })).not.toBeInTheDocument()
    await userEvent.click(createButton())
    expect(props.onSubmit).toHaveBeenCalledWith({ name: 'v1', kind: 'lightweight', message: '' })
  })

  // radiogroup の慣例(roving tabindex): Tab で止まるのは選択中の 1 つだけで、矢印キーで移る
  it('矢印キーで種類を切り替え、フォーカスも移る(両方向・端で折り返す)', async () => {
    renderDialog()
    expect(radio('軽量')).toHaveAttribute('tabindex', '0')
    expect(radio('注釈付き')).toHaveAttribute('tabindex', '-1')
    radio('軽量').focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(radio('注釈付き')).toHaveAttribute('aria-checked', 'true')
    expect(radio('注釈付き')).toHaveFocus()
    expect(radio('注釈付き')).toHaveAttribute('tabindex', '0')
    await userEvent.keyboard('{ArrowDown}')
    expect(radio('軽量')).toHaveAttribute('aria-checked', 'true')
    expect(radio('軽量')).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(radio('注釈付き')).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(radio('軽量')).toHaveFocus()
  })

  it('実行中は「作成中...」で、作成ボタン・入力・種類が disabled になり、送らない', async () => {
    const props = renderDialog({ isCreating: true })
    expect(screen.getByRole('button', { name: '作成中...' })).toBeDisabled()
    expect(nameInput()).toBeDisabled()
    expect(radio('軽量')).toBeDisabled()
    expect(radio('注釈付き')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '作成中...' }))
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  // 作成中は入力欄とボタンが disabled になりフォーカスが body に落ちるため、ボタンの「作成中...」だけでは
  // スクリーンリーダーに伝わらない。署名の入力待ちで最大 2 分(main が git を打ち切る TAG_CREATE_TIMEOUT_MS)
  // かかることも案内する。分は @shared/tagTimeout の定数から組み立てる(main と別々の値を持たない。PR #41 の 3 周目のレビュー)
  describe('作成中の案内(role="status"・aria-busy)', () => {
    it('作成中は role="status" で最大 2 分かかりうることを案内し、ダイアログを aria-busy にする', () => {
      renderDialog({ isCreating: true })
      expect(screen.getByRole('status')).toHaveTextContent(
        `作成中です。署名の入力待ちなどで最大 ${TAG_CREATE_TIMEOUT_MINUTES} 分かかることがあります`
      )
      expect(screen.getByRole('status')).toHaveClass('create-tag-dialog__note')
      expect(screen.getByRole('dialog', { name: 'タグを作成' })).toHaveAttribute(
        'aria-busy',
        'true'
      )
    })

    it('作成中でなければ案内は出ず、aria-busy は true でない', () => {
      renderDialog()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'タグを作成' })).not.toHaveAttribute(
        'aria-busy',
        'true'
      )
    })

    it('失敗の直後(履歴の取り直しで isCreating がまだ true)でも、エラーがあれば案内と aria-busy を出さず alert だけ出す', () => {
      renderDialog({ isCreating: true, error: new Error('タグを作成できませんでした: x') })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('タグを作成できませんでした: x')
      expect(screen.getByRole('dialog', { name: 'タグを作成' })).not.toHaveAttribute(
        'aria-busy',
        'true'
      )
    })

    it('失敗して作成中が解けると、案内は消えてエラーの alert が出る', () => {
      const { rerenderWith } = renderDialog({ isCreating: true })
      expect(screen.getByRole('status')).toBeInTheDocument()
      rerenderWith({ isCreating: false, error: new Error('タグを作成できませんでした: x') })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('タグを作成できませんでした: x')
      expect(screen.getByRole('dialog', { name: 'タグを作成' })).not.toHaveAttribute(
        'aria-busy',
        'true'
      )
    })
  })

  it('他の操作中(isBlocked)は、名前が正しくても作成ボタンが disabled', async () => {
    const props = renderDialog({ isBlocked: true })
    await userEvent.type(nameInput(), 'v1{Enter}')
    expect(createButton()).toBeDisabled()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('作成の失敗は role="alert" で表示する', () => {
    renderDialog({ error: new Error('コミットが無いため、タグを作成できません') })
    expect(screen.getByRole('alert')).toHaveTextContent('コミットが無いため、タグを作成できません')
  })

  it('キャンセル・Escape・オーバーレイのクリックで onCancel を呼ぶ', async () => {
    const props = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(props.container.querySelector('.name-input-dialog__overlay')!)
    expect(props.onCancel).toHaveBeenCalledTimes(3)
  })

  // 作成中に閉じると、遅れて届いた失敗がダイアログの外に出ず(開き直すと消える)、遅れて届いた成功が
  // 別の場所のフォーカスを奪う(パターン 73)。作成が終わるまで閉じさせない
  it('作成中(isCreating)は、キャンセルが disabled で、Escape・オーバーレイのクリックでも onCancel を呼ばない', async () => {
    const props = renderDialog({ isCreating: true })
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    fireEvent.keyDown(nameInput(), { key: 'Escape', isComposing: false })
    await userEvent.click(props.container.querySelector('.name-input-dialog__overlay')!)
    expect(props.onCancel).not.toHaveBeenCalled()
  })

  it('ダイアログの中のクリックでは onCancel を呼ばない', async () => {
    const props = renderDialog()
    await userEvent.click(screen.getByRole('dialog', { name: 'タグを作成' }))
    expect(props.onCancel).not.toHaveBeenCalled()
  })
})
```

`src/renderer/src/components/source-control/__tests__/HistorySection.test.tsx`: 既存の各 `render(<HistorySection … />)` に `gitTag={makeGitTagPanelState()}` と `isBlocked={false}` を足し（import は `import { makeGitTagPanelState } from '../../../__tests__/makeGitTagPanelState'`）、末尾に追加:

```tsx
describe('HistorySection のタグの作成', () => {
  const renderSection = (
    overrides: Partial<ComponentProps<typeof HistorySection>> = {}
  ): ComponentProps<typeof HistorySection> => {
    const props: ComponentProps<typeof HistorySection> = {
      log: [],
      branches: [{ name: 'main', current: true }],
      tags: ['v1'],
      hasMore: false,
      isLoading: false,
      error: null,
      onLoadMore: vi.fn(),
      gitTag: makeGitTagPanelState(),
      isBlocked: false,
      ...overrides
    }
    render(<HistorySection {...props} />)
    return props
  }
  const openButton = (): HTMLElement => screen.getByRole('button', { name: 'タグを作成' })

  it('見出しの右に「タグを作成」ボタンがあり、他の操作中は disabled', () => {
    const { unmount } = render(
      <HistorySection
        log={[]}
        branches={[]}
        tags={[]}
        hasMore={false}
        isLoading={false}
        error={null}
        onLoadMore={vi.fn()}
        gitTag={makeGitTagPanelState()}
        isBlocked={true}
      />
    )
    expect(openButton()).toHaveTextContent('タグを作成')
    expect(openButton()).toBeDisabled()
    unmount()
    renderSection()
    expect(openButton()).toBeEnabled()
  })

  it('押すと前回のエラーを消してからダイアログを開く', async () => {
    const props = renderSection()
    await userEvent.click(openButton())
    expect(props.gitTag.clearError).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'タグを作成' })).toBeInTheDocument()
  })

  it('既存のタグ・ブランチをダイアログの検証に使う', async () => {
    renderSection()
    await userEvent.click(openButton())
    const input = screen.getByRole('textbox', { name: 'タグ名' })
    await userEvent.type(input, 'v1')
    expect(input).toHaveAccessibleDescription('同じ名前のタグが既に存在します')
    await userEvent.clear(input)
    await userEvent.type(input, 'main')
    expect(input).toHaveAccessibleDescription(
      '同じ名前のブランチが存在するため、タグを作成できません'
    )
  })

  it('作成に成功したらダイアログを閉じ、ボタンへフォーカスを戻す', async () => {
    const props = renderSection()
    await userEvent.click(openButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'タグ名' }), 'v2{Enter}')
    expect(props.gitTag.createTag).toHaveBeenCalledWith({
      name: 'v2',
      kind: 'lightweight',
      message: ''
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(openButton()).toHaveFocus()
  })

  it('作成に失敗したら(false)ダイアログを閉じない', async () => {
    const gitTag = makeGitTagPanelState({
      createTag: vi.fn<GitTagPanelState['createTag']>().mockResolvedValue(false)
    })
    renderSection({ gitTag })
    await userEvent.click(openButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'タグ名' }), 'v2{Enter}')
    expect(gitTag.createTag).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'タグを作成' })).toBeInTheDocument()
  })

  it('ダイアログに gitTag のエラーを渡す', async () => {
    renderSection({ gitTag: makeGitTagPanelState({ error: new Error('作成の失敗') }) })
    await userEvent.click(openButton())
    expect(screen.getByRole('alert')).toHaveTextContent('作成の失敗')
  })

  it('作成中(isCreating)は「タグを作成」ボタンも disabled(開き直したダイアログが前の作成の成功で閉じられない)', () => {
    renderSection({ gitTag: makeGitTagPanelState({ isCreating: true }) })
    expect(openButton()).toBeDisabled()
  })

  it('キャンセルしたらダイアログを閉じ、ボタンへフォーカスを戻す', async () => {
    renderSection()
    await userEvent.click(openButton())
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(openButton()).toHaveFocus()
  })
})
```

（`HistorySection.test.tsx` の import に `import type { ComponentProps } from 'react'` と `import type { GitTagPanelState } from '../../../types'` を足す。）

`src/renderer/src/components/source-control/__tests__/HistorySection.styles.test.tsx`:

```tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import HistorySection from '../HistorySection'
import { makeGitTagPanelState } from '../../../__tests__/makeGitTagPanelState'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。
// 「タグを作成」と種類の選択肢は、退避・マージのバナーのボタンと 1 つのグループセレクタで宣言を共有する
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

const renderSection = (): void => {
  render(
    <HistorySection
      log={[]}
      branches={[]}
      tags={[]}
      hasMore={false}
      isLoading={false}
      error={null}
      onLoadMore={vi.fn()}
      gitTag={makeGitTagPanelState()}
      isBlocked={false}
    />
  )
}

describe('HistorySection のスタイル(main.css)', () => {
  it('見出し行は見出しとボタンを横に並べる', () => {
    renderSection()
    const header = screen.getByRole('heading', { name: '履歴' }).parentElement as HTMLElement
    const style = getComputedStyle(header)
    expect(style.display).toBe('flex')
    expect(style.justifyContent).toBe('space-between')
  })

  it('「タグを作成」は 32px 四方以上の枠付きボタンになる', () => {
    renderSection()
    const style = getComputedStyle(screen.getByRole('button', { name: 'タグを作成' }))
    expect(style.minWidth).toBe('32px')
    expect(style.minHeight).toBe('32px')
    expect(style.borderTopStyle).toBe('solid')
  })

  it('種類の選択肢は 32px 四方以上で、作成ボタンは disabled のとき半透明になる', async () => {
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
    const kindStyle = getComputedStyle(screen.getByRole('radio', { name: '軽量' }))
    expect(kindStyle.minWidth).toBe('32px')
    expect(kindStyle.minHeight).toBe('32px')
    expect(getComputedStyle(screen.getByRole('button', { name: '作成' })).opacity).toBe('0.5')
  })
})
```

```bash
npx vitest run src/renderer/src/components/source-control/__tests__/CreateTagDialog.test.tsx src/renderer/src/components/source-control/__tests__/HistorySection.test.tsx src/renderer/src/components/source-control/__tests__/HistorySection.styles.test.tsx
```

Expected: FAIL（`CreateTagDialog` が無い、`HistorySection` にボタンが無い）

- [ ] **Step 2: `CreateTagDialog.tsx` を実装する**

> 注（リモートの管理の単一責任のレビューで変更）: 下の `wasCreatingRef` の effect（作成中が解けたときのフォーカスの復帰）は `hooks/useFocusOnRunningEnd.ts` に切り出し、`useFocusOnRunningEnd(isCreating, nameInputRef, { containerRef: formRef })` で呼ぶ形にした（`RemoteSetupInputDialog`・`RemoteSetupBanner` と共通。挙動は同じ）。外のフォーカスを奪わない条件のテストはフックのテストへ移し、`CreateTagDialog` のテストは「ダイアログ内(キャンセル)にあるフォーカスもタグ名の入力欄へ戻す」に置き換えた

```tsx
import { useEffect, useId, useRef, useState } from 'react'
import type { CreateTagRequest, TagKind } from '@shared/types'
import { normalizeTagName } from '@shared/tagName'
import { validateTagMessage, validateTagName } from '../../lib/tagValidation'

interface Props {
  /** 重複・階層の衝突の判定に使う既存のタグ */
  tags: string[]
  /** 同名の判定に使う既存のローカルブランチ名 */
  branchNames: string[]
  /** 作成の実行中か(作成ボタンと入力を disabled にし、二重送信を防ぐ) */
  isCreating: boolean
  /** 他の操作中で、作成しても no-op になる状態か */
  isBlocked: boolean
  /** 作成の失敗(main のエラー)。role="alert" で表示する */
  error: Error | null
  /** 検証を通過した要求(名前は normalizeTagName 済み=前後の空白を除き NFC。軽量ではメッセージは空) */
  onSubmit: (request: CreateTagRequest) => void
  /** キャンセル・Escape・オーバーレイのクリックのいずれでも呼ばれる(作成中は呼ばない) */
  onCancel: () => void
}

const KIND_OPTIONS: ReadonlyArray<{ value: TagKind; label: string }> = [
  { value: 'lightweight', label: '軽量' },
  { value: 'annotated', label: '注釈付き' }
]

// 矢印キーで選択肢を移る量(radiogroup の慣例。端で折り返す)
const KIND_KEY_DELTAS: Partial<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1
}

// 作成中の打ち切りまでの時間(分)は、main が git を打ち切る時間と同じ @shared/tagTimeout の定数から組み立てる
// (import { TAG_CREATE_TIMEOUT_MINUTES } from '@shared/tagTimeout'。PR #41 の 3 周目のレビューで一本化)
const CREATING_STATUS_MESSAGE = `作成中です。署名の入力待ちなどで最大 ${TAG_CREATE_TIMEOUT_MINUTES} 分かかることがあります`

// タグの作成ダイアログ(名前・種類・メッセージ)。NameInputDialog は名前 1 つの入力の前提のため、
// 見た目の枠(.name-input-dialog__*)だけを共有した別コンポーネントにする。
// 検証は UX 用(セキュリティ境界は main 側)。検証エラーは入力欄の説明(aria-describedby)として常に表示し、
// 作成ボタンを disabled にする。作成の失敗は role="alert" で表示し、ダイアログは閉じない
// (閉じるのは呼び出し元 HistorySection が成功を受け取ったとき)
export default function CreateTagDialog({
  tags,
  branchNames,
  isCreating,
  isBlocked,
  error,
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<TagKind>('lightweight')
  const [message, setMessage] = useState('')
  const kindRefs = useRef<Partial<Record<TagKind, HTMLButtonElement | null>>>({})
  const nameInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const wasCreatingRef = useRef(isCreating)
  const titleId = useId()
  const descriptionId = useId()
  const kindLabelId = useId()
  const nameErrorId = useId()
  const messageErrorId = useId()

  // main の入口と同じ正規化(前後の空白を除き NFC)をした名前を検証し、そのまま送る
  const normalizedName = normalizeTagName(name)
  const nameError = validateTagName(normalizedName, tags, branchNames)
  const messageError = validateTagMessage(kind, message)
  // 失敗の直後は、履歴を取り直している間だけ isCreating が true のまま error がセットされる。その短い間も
  // 案内(status)と aria-busy を出さず、エラー(alert)だけを伝える(案内は失敗で消える)
  const showCreatingNotice = isCreating && error === null
  const canSubmit = nameError === null && messageError === null && !isCreating && !isBlocked

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({ name: normalizedName, kind, message: kind === 'annotated' ? message : '' })
  }

  // 作成中は閉じさせない。閉じると、遅れて届いた失敗がダイアログの外に出ず(開き直すと clearError で
  // 消える)、遅れて届いた成功が閉じた後のフォーカスを奪う(パターン 73)。キャンセルボタンは disabled にし、
  // Escape・オーバーレイのクリックはここで無視する
  const requestCancel = (): void => {
    if (!isCreating) onCancel()
  }

  // 作成中は入力欄と作成ボタンが disabled になり、ブラウザはフォーカスを body に落とす。失敗して作成中が
  // 解けても body のままだと、Escape がフォームに届かず閉じられない(Tab で中へ戻るまで)。そのため作成中が
  // 解けたとき(ダイアログが開いたまま=失敗)に、フォーカスが body かダイアログ内にあればタグ名の入力欄へ戻す。
  // 成功ではこの描画の前に閉じられている(HistorySection がアンマウントする)ため、ここには来ない
  useEffect(() => {
    const wasCreating = wasCreatingRef.current
    wasCreatingRef.current = isCreating
    if (!wasCreating || isCreating) return
    const active = document.activeElement
    if (active === null || active === document.body || formRef.current?.contains(active)) {
      nameInputRef.current?.focus()
    }
  }, [isCreating])

  const handleKindKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    const delta = KIND_KEY_DELTAS[e.key]
    if (delta === undefined) return
    e.preventDefault()
    const index = KIND_OPTIONS.findIndex((option) => option.value === kind)
    const next = KIND_OPTIONS[(index + delta + KIND_OPTIONS.length) % KIND_OPTIONS.length].value
    setKind(next)
    kindRefs.current[next]?.focus()
  }

  return (
    <div className="name-input-dialog__overlay" role="presentation" onClick={requestCancel}>
      <form
        ref={formRef}
        className="name-input-dialog create-tag-dialog"
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={showCreatingNotice}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // IME の変換を取り消す Escape ではダイアログを閉じない(入力中の名前が消えるため)
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) requestCancel()
        }}
        onSubmit={handleSubmit}
      >
        <p id={titleId} className="name-input-dialog__title">
          タグを作成
        </p>
        <p id={descriptionId} className="create-tag-dialog__note">
          現在の HEAD にタグを付けます
        </p>
        <label className="create-tag-dialog__field">
          <span className="create-tag-dialog__label">タグ名</span>
          <input
            // ダイアログを開いた直後に入力を始められるようにする(モーダルの慣例。autoFocus は React がマウント時に focus() を呼ぶ)
            ref={nameInputRef}
            autoFocus
            type="text"
            className="name-input-dialog__input"
            value={name}
            disabled={isCreating}
            aria-invalid={nameError !== null}
            aria-describedby={nameError !== null ? nameErrorId : undefined}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {nameError !== null && (
          <p id={nameErrorId} className="name-input-dialog__error">
            {nameError}
          </p>
        )}
        <div className="create-tag-dialog__field">
          <span id={kindLabelId} className="create-tag-dialog__label">
            種類
          </span>
          <div role="radiogroup" aria-labelledby={kindLabelId} className="create-tag-dialog__kinds">
            {KIND_OPTIONS.map((option) => (
              <button
                key={option.value}
                ref={(element) => {
                  kindRefs.current[option.value] = element
                }}
                type="button"
                role="radio"
                aria-checked={kind === option.value}
                tabIndex={kind === option.value ? 0 : -1}
                className="create-tag-dialog__kind"
                disabled={isCreating}
                onClick={() => setKind(option.value)}
                onKeyDown={handleKindKeyDown}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {kind === 'annotated' && (
          <>
            <label className="create-tag-dialog__field">
              <span className="create-tag-dialog__label">メッセージ</span>
              <textarea
                className="name-input-dialog__input create-tag-dialog__message"
                rows={3}
                value={message}
                disabled={isCreating}
                aria-invalid={messageError !== null}
                aria-describedby={messageError !== null ? messageErrorId : undefined}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            {messageError !== null && (
              <p id={messageErrorId} className="name-input-dialog__error">
                {messageError}
              </p>
            )}
          </>
        )}
        {/* 作成中は入力欄とボタンが disabled になりフォーカスが body に落ちるため、ボタンの「作成中...」だけでは
            スクリーンリーダーに伝わらない。role="status" で案内する(完了・失敗で消え、失敗は下の alert が伝える) */}
        {showCreatingNotice && (
          <p className="create-tag-dialog__note" role="status">
            {CREATING_STATUS_MESSAGE}
          </p>
        )}
        {error !== null && (
          <p className="name-input-dialog__error" role="alert">
            {error.message}
          </p>
        )}
        <div className="name-input-dialog__actions">
          <button type="submit" className="name-input-dialog__ok" disabled={!canSubmit}>
            {isCreating ? '作成中...' : '作成'}
          </button>
          <button
            type="button"
            className="name-input-dialog__cancel"
            disabled={isCreating}
            onClick={onCancel}
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: `HistorySection.tsx` を変える**

> 注（リモートの管理の単一責任のレビューで変更）: 下の開閉の state・`restoreFocusPendingRef`・フォーカスを戻す effect は `hooks/useDialogFocusReturn.ts` に切り出し、`useDialogFocusReturn({ isRunning: gitTag.isCreating, onOpen: gitTag.clearError, openerRef: createTagButtonRef })` の `isOpen` / `open` / `close` を使う形にした（`NotRepositoryView`・`RemoteSetupBanner` と共通。挙動は同じ）。外のフォーカスを奪わないテストはフックのテストへ移した

import と Props、本体の先頭と見出し、末尾のダイアログを次のようにする（ログ一覧・バッジ・もっと見るは変えない）:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { CreateTagRequest, GitBranch, GitLogEntry } from '@shared/types'
import type { GitTagPanelState } from '../../types'
import { formatRelativeDate } from '../../lib/dateFormat'
import CreateTagDialog from './CreateTagDialog'

interface Props {
  log: GitLogEntry[]
  branches: GitBranch[]
  tags: string[]
  hasMore: boolean
  isLoading: boolean
  /** getLog が「コミット無し」以外の理由(git 未検出等)で失敗した場合のエラー */
  error: Error | null
  onLoadMore: () => void
  /** タグの作成の状態と操作(useGitTagOperations) */
  gitTag: GitTagPanelState
  /** 他の操作中(ステージ・ハンク操作・commit・pull・ブランチ操作・退避)で、作成しても no-op になる状態 */
  isBlocked: boolean
}

export default function HistorySection({
  log,
  branches,
  tags,
  hasMore,
  isLoading,
  error,
  onLoadMore,
  gitTag,
  isBlocked
}: Props): React.JSX.Element {
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false)
  const createTagButtonRef = useRef<HTMLButtonElement>(null)

  // 開くときに前回の失敗の表示を消す(キャンセルしたダイアログのエラーを持ち越さない)
  const openTagDialog = (): void => {
    gitTag.clearError()
    setIsTagDialogOpen(true)
  }

  // ダイアログを閉じたら(成功・キャンセル・Escape・オーバーレイのクリック)ボタンへフォーカスを戻す
  // (パターン 22)。閉じる時点で直接 focus() すると、成功の経路では作成中フラグの解除(setBusy(false))が
  // まだ再描画に反映されておらず、disabled のボタンへの focus() が無視されてフォーカスが body に落ちる
  // (パターン 73)。そのため閉じるときは「戻す予約」だけを立て、ダイアログが閉じて作成中でもなくなった
  // 描画の後(下の useEffect)で戻す。予約は閉じたダイアログに対してだけ立つため、アンマウントで消え、
  // フォルダの切り替え等で別のボタンへ持ち越さない
  const restoreFocusPendingRef = useRef(false)
  const closeTagDialog = (): void => {
    restoreFocusPendingRef.current = true
    setIsTagDialogOpen(false)
  }

  // gitTag.isCreating の判定は保険(createTag は setBusy(false) の後に解決するため、閉じる描画では
  // 既に作成中が解けている)。createTag・clearError は毎回変わる参照のため依存に入れない
  useEffect(() => {
    if (!restoreFocusPendingRef.current || isTagDialogOpen || gitTag.isCreating) return
    restoreFocusPendingRef.current = false
    // フォーカスが行き場を失っている(閉じたダイアログの中にあって body に落ちた)ときだけ戻す。
    // 作成中にユーザーがダイアログの外の要素へ移していたら、遅れて届いた成功で奪わない
    const active = document.activeElement
    if (active === null || active === document.body) createTagButtonRef.current?.focus()
  }, [isTagDialogOpen, gitTag.isCreating])

  // 成功したときだけ閉じる。失敗(false)はダイアログ内に gitTag.error を表示したまま残す
  const handleCreateTag = async (request: CreateTagRequest): Promise<void> => {
    if (await gitTag.createTag(request)) closeTagDialog()
  }

  return (
    <section className="source-control-panel__section">
      <div className="history-section__header">
        <h3 className="source-control-panel__section-title">履歴</h3>
        <button
          ref={createTagButtonRef}
          type="button"
          className="history-section__create-tag"
          aria-label="タグを作成"
          // 作成中も押せない(開き直したダイアログが、前の作成の成功で閉じられるのを防ぐ。パターン 73)
          disabled={isBlocked || gitTag.isCreating}
          onClick={openTagDialog}
        >
          タグを作成
        </button>
      </div>
```

`</section>` の直前（`もっと見る` の後）に追加:

```tsx
{
  isTagDialogOpen && (
    <CreateTagDialog
      tags={tags}
      branchNames={branches.map((branch) => branch.name)}
      isCreating={gitTag.isCreating}
      isBlocked={isBlocked}
      error={gitTag.error}
      onSubmit={(request) => void handleCreateTag(request)}
      onCancel={closeTagDialog}
    />
  )
}
```

- [ ] **Step 4: CSS を足す（`src/renderer/src/assets/main.css`）**

既存の規則をグループセレクタに広げ、宣言を複製しない（パターン 30・77）。

- `.stash-section__header {` を `.stash-section__header,\n.history-section__header {` にする
- 共通のボタンの規則（`.stash-section__push, .stash-section__action, .merge-banner__button, .conflict-resolver__button, .conflict-block__button`）の基本・`:hover:not(:disabled)`・`:disabled` の 3 つのセレクタ群に、`.history-section__create-tag` と `.create-tag-dialog__kind` を足す。`:disabled` のセレクタ群には `.name-input-dialog__ok:disabled` も足す（作成ボタンの半透明。単独の規則で宣言を複製しない）
- `.name-input-dialog__ok:hover {` を `.name-input-dialog__ok:hover:not(:disabled) {` にし、その後に追加:

```css
/* タグの作成ダイアログ(枠・入力欄・ボタンは .name-input-dialog__* を共有する)。
   disabled の作成ボタンの半透明は、下の共通のボタンの :disabled の規則で宣言する */
.create-tag-dialog__note,
.create-tag-dialog__label {
  font-size: 11px;
  color: #969696;
}

.create-tag-dialog__note {
  margin: 0 0 4px;
}

.create-tag-dialog__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.create-tag-dialog__kinds {
  display: flex;
  gap: 8px;
}

/* 選択中の種類。ボタンの寸法・枠は共通のボタンの規則 */
.create-tag-dialog__kind[aria-checked='true'] {
  border-color: #007acc;
  background: #094771;
  color: #ffffff;
}

.create-tag-dialog__message {
  min-height: 64px;
  resize: vertical;
  font-family: inherit;
}
```

```bash
npx vitest run src/renderer/src/components/source-control
```

Expected: PASS

`HistorySection.test.tsx` には、実物の `useGitTagOperations`（`gitApi` だけをモック）と結合したテストも置く（再レビューで追加）: 作成の保留中は閉じられず失敗が `role="alert"` で見える、保留から成功するとボタンへフォーカスが戻る（`act` の外で解決し、`waitFor` で待つ。`act` の中で解決すると作成中フラグの解除が先に反映され、退行が再現しない）、キャンセルでも戻る、作成中にダイアログの外へ移したフォーカスは奪わない、作成中に body へ落ちたフォーカスが失敗の後にタグ名の入力欄へ戻り Escape で閉じられる。

- [ ] **Step 5: ミューテーション**

(1) `canSubmit` から `!isBlocked` を外す → isBlocked のテスト、(2) `kind === 'annotated' ? message : ''` を `message` にする → 軽量に戻すテスト、(3) `handleKindKeyDown` の `focus()` を外す → 矢印キーのテスト、(4) `tabIndex` を常に `0` にする → roving tabindex のテスト、(5) `handleCreateTag` で成否を見ずに閉じる → 失敗で閉じないテスト、(6) `openTagDialog` の `clearError()` を外す → 前回のエラーのテスト、(7) フォーカスを戻す `useEffect` の `focus()` を外す → フォーカスのテスト（成功とキャンセルの両方）、(7') `closeTagDialog` で予約を立てずに直接 `focus()` する（修正前の実装）→ 実物の `useGitTagOperations` と結合した「保留から成功」のテスト（`act` の外で解決し、作成中の `disabled` が解ける前に `focus()` が走る実機の順序を再現する）、(7'') 戻す条件の「フォーカスが body のときだけ」を外す → 作成中に外へ移したフォーカスを奪わないテスト、(7''') `CreateTagDialog` の失敗後に入力欄へ戻す `focus()` を外す → 失敗の後に Escape で閉じられるテスト、(8) CSS のグループから `.history-section__create-tag` を外す → スタイルのテスト、(9) キャンセルの `disabled={isCreating}` を外す・Escape またはオーバーレイを `requestCancel` でなく `onCancel` にする → 作成中に閉じないテスト、(10) `タグを作成` の `disabled` から `gitTag.isCreating` を外す → 作成中のボタンのテスト、(11) 作成中の `role="status"` の案内を外す・`aria-busy` を外す → 作成中の案内のテスト（PR #41 の 2 周目のレビューで追加）。 (12) `showCreatingNotice = isCreating && error === null` を `isCreating` にする → 失敗の直後に案内と aria-busy を出さないテスト。

- [ ] **Step 6: 検証**

```bash
npx vitest run src/renderer
npm run typecheck
npx eslint src/renderer/src/components/source-control/CreateTagDialog.tsx src/renderer/src/components/source-control/HistorySection.tsx src/renderer/src/components/source-control/__tests__/CreateTagDialog.test.tsx src/renderer/src/components/source-control/__tests__/HistorySection.test.tsx src/renderer/src/components/source-control/__tests__/HistorySection.styles.test.tsx
npx prettier --check src/renderer/src/components/source-control/CreateTagDialog.tsx src/renderer/src/components/source-control/HistorySection.tsx src/renderer/src/components/source-control/__tests__/CreateTagDialog.test.tsx src/renderer/src/components/source-control/__tests__/HistorySection.test.tsx src/renderer/src/components/source-control/__tests__/HistorySection.styles.test.tsx src/renderer/src/assets/main.css
```

Expected: `HistorySection` の Props が必須になったため、`GitRepoView.tsx` の typecheck が失敗する（Task 6 で配線する）。それ以外は成功。typecheck の失敗が `GitRepoView.tsx` の `gitTag` / `isBlocked` の不足だけであることを確認する。

- [ ] **Step 7: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 6: 配線（`GitRepoView` / `SourceControlPanel` / `Sidebar` / `App` / `useAppState`）と配線テスト

**Files:**

- Modify: `src/renderer/src/components/source-control/GitRepoView.tsx`, `src/renderer/src/components/source-control/SourceControlPanel.tsx`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/hooks/useAppState.ts`
- Test: `src/renderer/src/components/source-control/__tests__/GitRepoView.test.tsx`, `src/renderer/src/components/source-control/__tests__/SourceControlPanel.test.tsx`, `src/renderer/src/components/__tests__/Sidebar.test.tsx`, `src/renderer/src/hooks/__tests__/useAppState.test.ts`

**Interfaces:**

- Consumes: Task 4 の `useGitTagOperations` / `GitTagPanelState` / `makeGitTagPanelState`、Task 5 の `HistorySection` の `gitTag` / `isBlocked`
- Produces: `useAppState()` の戻り値の `gitTag: GitTagPanelState`。`GitRepoView` / `SourceControlPanel` / `Sidebar` の必須 Props `gitTag: GitTagPanelState`

- [ ] **Step 1: 失敗するテストを書く**

`GitRepoView.test.tsx`: `baseProps` に `gitTag: makeGitTagPanelState()` を足し（import `makeGitTagPanelState` from `'../../../__tests__/makeGitTagPanelState'`）、追加:

```tsx
it('gitTag が履歴セクションまで届く(タグを作成 → 作成で createTag が呼ばれる)', async () => {
  const gitTag = makeGitTagPanelState()
  render(
    <GitRepoView
      branch="main"
      ahead={0}
      behind={0}
      files={noFiles}
      {...baseProps}
      gitTag={gitTag}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'タグ名' }), 'v1{Enter}')
  expect(gitTag.createTag).toHaveBeenCalledWith({ name: 'v1', kind: 'lightweight', message: '' })
})

// ステージ等の実行中は、他のボタンと同じく押せない(isBlockedByOtherOperation)
it('他の操作中は「タグを作成」が押せない', () => {
  render(
    <GitRepoView
      branch="main"
      ahead={0}
      behind={0}
      files={noFiles}
      {...baseProps}
      stagingPaths={new Set(['a.ts'])}
    />
  )
  expect(screen.getByRole('button', { name: 'タグを作成' })).toBeDisabled()
})
```

`SourceControlPanel.test.tsx`: `baseProps` に `gitTag: makeGitTagPanelState()` を足し、`baseProps` を使わずに全 Props を並べている `render`（`operationError があれば表示する` など）にも `gitTag={makeGitTagPanelState()}` を足す。追加:

```tsx
it('gitTag は GitRepoView を経て履歴セクションまで届く', async () => {
  const gitTag = makeGitTagPanelState({ error: new Error('タグの失敗') })
  render(<SourceControlPanel {...baseProps} gitStatus={repoStatus} gitTag={gitTag} />)
  await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
  expect(screen.getByRole('alert')).toHaveTextContent('タグの失敗')
})
```

（`repoStatus` が無ければ、既存の `mergeState は GitRepoView のバナーまで届く` のテストと同じ `isRepo: true` の `GitStatusResult` を使う。）

`Sidebar.test.tsx`: `defaultProps` に `gitTag: makeGitTagPanelState()` を足し、追加:

```tsx
it('source-control: gitTag が履歴セクションまで届く', async () => {
  const gitTag = makeGitTagPanelState()
  render(
    <Sidebar
      activePanel="source-control"
      {...defaultProps}
      gitStatus={{
        isRepo: true,
        mergeInProgress: false,
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: []
      }}
      gitTag={gitTag}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
  expect(gitTag.clearError).toHaveBeenCalledOnce()
})
```

（`Sidebar.test.tsx` の import に `userEvent` と `makeGitTagPanelState` を足す。）

`useAppState.test.ts`: モックを足す（`mockUseConflictFile` の後）。戻り値の静的モックは作らず、テスト内で `makeGitTagPanelState()` から作って渡す（既定値の重複と型なしの `vi.fn()` を避ける。パターン 78）。import に `makeGitTagPanelState` を足す:

```ts
// タグの作成の組み立ては useGitTagOperations.test.ts で検証する。ここでは配線だけを見る。
// 戻り値はテスト内で makeGitTagPanelState から作って渡す(既定値の重複と型なしのモックを避ける。パターン 78)。
// 他のテストでは useAppState が戻り値をそのまま公開するだけのため、既定の undefined のままでよい
const mockUseGitTagOperations = vi.hoisted(() =>
  vi.fn<typeof import('../useGitTagOperations').useGitTagOperations>()
)
```

```ts
vi.mock('../useGitTagOperations', () => ({ useGitTagOperations: mockUseGitTagOperations }))
```

`describe('stash(退避)', …)` の後に追加:

```ts
describe('gitTag(タグの作成)', () => {
  it('useGitTagOperations に gitStatus・履歴の再取得・共有ロックを渡し、戻り値を gitTag として公開する', () => {
    const refreshHistory = vi.fn()
    mockUseGitHistory.mockReturnValue({
      log: [],
      branches: [],
      tags: [],
      hasMore: false,
      isLoading: false,
      loadMore: vi.fn(),
      refresh: refreshHistory
    })
    const status = {
      isRepo: true,
      mergeInProgress: false,
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: []
    }
    mockUseGitStatus.mockReturnValue({
      gitStatus: status,
      gitLoading: false,
      gitError: null,
      refreshGitStatus: vi.fn()
    })
    const panel = makeGitTagPanelState()
    mockUseGitTagOperations.mockReturnValue(panel)
    const { result } = renderHook(() => useAppState())
    expect(mockUseGitTagOperations).toHaveBeenCalledWith(status, refreshHistory, expect.anything())
    expect(result.current.gitTag).toBe(panel)
  })
})
```

```bash
npx vitest run src/renderer/src/components src/renderer/src/hooks/__tests__/useAppState.test.ts
```

Expected: FAIL（`gitTag` が配線されていない）

- [ ] **Step 2: 配線する**

`src/renderer/src/hooks/useAppState.ts`:

- import に `import { useGitTagOperations } from './useGitTagOperations'` を足し、`import type { DiscardAllState, MergeStatePanelState, StashPanelState } from '../types'` に `GitTagPanelState` を足す
- `AppState` の型の `mergeState` の前に追加:

```ts
/** タグの作成の状態と操作(履歴セクションの「タグを作成」とダイアログ) */
gitTag: GitTagPanelState
```

- `gitBranchOperations` の直後に追加:

```ts
// タグの作成は作業ツリーを変えないため、再取得は履歴(ログ・ブランチ・タグ)だけ。他の Git 操作の
// 途中(HEAD が動く間)は実行しないよう、ブランチ操作などと同じロックを渡す(ロック自体は取らない)
const gitTag = useGitTagOperations(git.gitStatus, gitHistory.refresh, fileOperationLock)
```

- 戻り値の `mergeState,` の前に `gitTag,` を足す

`src/renderer/src/components/source-control/GitRepoView.tsx`: import type に `GitTagPanelState` を足し、Props の `mergeState` の後に `gitTag: GitTagPanelState`、分割代入に `gitTag` を足し、`HistorySection` に渡す:

```tsx
<HistorySection
  log={log}
  branches={branches}
  tags={tags}
  hasMore={hasMoreLog}
  isLoading={isLoadingLog}
  error={historyError}
  onLoadMore={onLoadMoreLog}
  gitTag={gitTag}
  isBlocked={isBlockedByOtherOperation}
/>
```

`SourceControlPanel.tsx`: import type に `GitTagPanelState`、Props の `mergeState` の後に `gitTag: GitTagPanelState`、分割代入に `gitTag`、`<GitRepoView … mergeState={mergeState} gitTag={gitTag} />`。

`Sidebar.tsx`: import type に `GitTagPanelState`、Props の `mergeState: MergeStatePanelState` の後に `gitTag: GitTagPanelState`、分割代入の `mergeState,` の後に `gitTag,`、`<SourceControlPanel … mergeState={mergeState} gitTag={gitTag} … />`。

`App.tsx`: `useAppState()` の分割代入の `mergeState,` の後に `gitTag,` を足し、`<Sidebar … mergeState={mergeState} gitTag={gitTag} … />`。

App 自体の配線は `Sidebar` の必須 Props で typecheck が固定する（`App.test.tsx` は実物の `useAppState` で描画し、フォルダ未選択のため履歴セクションが出ない。ブランチ作成の配線も App のテストは持たない）。

```bash
npx vitest run src/renderer
npm run typecheck
```

Expected: PASS（typecheck も成功）

- [ ] **Step 3: ミューテーション**

(1) `GitRepoView` で `isBlocked={false}` を渡す → 「他の操作中は押せない」が落ちる、(2) `useAppState` で `gitHistory.refresh` の代わりに `git.refreshGitStatus` を渡す → `useAppState` のテストが落ちる、(3) `Sidebar` で `gitTag` を渡さず別の固定値（`makeGitTagPanelState` 相当の新しいオブジェクト）を渡す → Sidebar のテストが落ちる（`clearError` が呼ばれない）。

- [ ] **Step 4: 検証**

```bash
npx vitest run src/renderer
npm run typecheck
npx eslint src/renderer/src/hooks/useAppState.ts src/renderer/src/components/source-control/GitRepoView.tsx src/renderer/src/components/source-control/SourceControlPanel.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/components/source-control/__tests__/GitRepoView.test.tsx src/renderer/src/components/source-control/__tests__/SourceControlPanel.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx
npx prettier --check src/renderer/src/hooks/useAppState.ts src/renderer/src/components/source-control/GitRepoView.tsx src/renderer/src/components/source-control/SourceControlPanel.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/components/source-control/__tests__/GitRepoView.test.tsx src/renderer/src/components/source-control/__tests__/SourceControlPanel.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx
```

Expected: すべて成功

- [ ] **Step 5: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 7: ROADMAP の確認・テスト仕様書への追記と Artifact の再公開・全体検証

**Files:**

- Modify: `docs/manual-test-spec.md`
- 確認のみ: `ROADMAP.md`（このブランチで更新済み）

- [ ] **Step 1: ROADMAP を確認する（変更しない）**

`ROADMAP.md` に、実装済みの「タグの作成」（115〜117 行目付近）と、見送り項目「タグの送信（push）・削除」「履歴の任意のコミットへのタグ付け（現在は HEAD のみ）、署名付きタグ（`-s`）」があることを確認する。実装と食い違う記述（「既存のタグ・ブランチとの同名」）があれば、大文字小文字を無視するブランチとの同名判定に合わせて直す。

```bash
grep -n "タグ" ROADMAP.md
npx prettier --check ROADMAP.md
```

- [ ] **Step 2: 実機テスト仕様書に追記する**

`docs/manual-test-spec.md` の `## マージコンフリクトの解決` の領域の最後（`CNF-065` の後、`## 設定` の前）に、次の領域を追加する。書式は仕様書の冒頭と `scripts/build-manual-test-spec.mjs` に従う（1 行 1 項目、ID は `TAG-001` から昇順）。文言は実装（`HistorySection` / `CreateTagDialog` / `gitTagService` / `tagValidation`）と突き合わせて確認する（パターン 65）。実機で自信が持てない期待結果は項目にせず、ファイル末尾の HTML コメント（要確認事項）に足す。

```markdown
## タグの作成

> 前提: 【要 Git リポジトリ】タグの作成用のリポジトリを作る。`cd "$(mktemp -d)" && git init -b main && git config user.name test && git config user.email test@example.com && echo 1 > a.txt && git add . && git commit -m first && echo 2 >> a.txt && git commit -am second && git branch feat`。アプリでこのフォルダを開き、ソース管理パネルを表示する。端末での確認はこのフォルダで行い、端末での変更はパネルの `更新` ボタンで反映する。
> 前提: 「履歴」のバッジは、ブランチ名に続けてすべてのタグ名を並べる(コミットごとの表示ではない)。

### ダイアログ

- [ ] **TAG-001** 「履歴」セクションの見出しを見る → 見出し `履歴` の右に `タグを作成` ボタンがある
- [ ] **TAG-002** `タグを作成` を押す → `タグを作成` のダイアログが開き、`現在の HEAD にタグを付けます` の説明、`タグ名` の入力欄(フォーカスあり)、`種類` の `軽量`(選択中)と `注釈付き` が表示される。`名前を入力してください` が表示され、`作成` ボタンは押せない
- [ ] **TAG-003** `種類` の `軽量` をクリックしてから右矢印キーを押す → `注釈付き` が選ばれてフォーカスも移り、`メッセージ` の入力欄と `メッセージを入力してください` が表示される。左矢印キーで `軽量` に戻るとメッセージ欄が消える
- [ ] **TAG-004** ダイアログを `キャンセル`・Escape キー・ダイアログの外側のクリックのそれぞれで閉じる → どの方法でもダイアログが閉じ、`タグを作成` ボタンにフォーカスが戻る。タグは作られない(`git tag -l` が空)
- [ ] **TAG-005** ダイアログを開いて名前を入力し、`注釈付き` を選んでから閉じ、もう一度開く → 名前は空に戻り、種類は `軽量` になっている

### 軽量タグ

- [ ] **TAG-006** `タグ名` に `v1.0.0` と入力して `作成` を押す → ダイアログが閉じて `タグを作成` ボタンにフォーカスが戻り、「履歴」のバッジに `v1.0.0` が加わる。端末で `git cat-file -t v1.0.0` が `commit`、`git rev-parse v1.0.0` が `git rev-parse HEAD` と同じ
- [ ] **TAG-007** `タグ名` に前後の空白付きの `  v2  ` を入力して Enter キーを押す → `v2` という名前で作られる(`git tag -l` に `v2`)

### 注釈付きタグ

- [ ] **TAG-008** `注釈付き` を選び、名前 `v1.1.0`、メッセージに 1 行目 `#1 リリース 1.1.0`・2 行目 `-x で始まる行` を入力して `作成` を押す → ダイアログが閉じ、バッジに `v1.1.0` が加わる。端末で `git cat-file -t v1.1.0` が `tag`、`git tag -l -n2 v1.1.0` に 2 行とも(`#` と `-x` を含めて)表示される
- [ ] **TAG-009** `注釈付き` でメッセージに空白と改行だけを入力する → `メッセージを入力してください` のまま `作成` が押せない

### 名前の拒否

- [ ] **TAG-010** TAG-006 のあと、名前に `v1.0.0` を入力する → `同じ名前のタグが既に存在します` が表示され、`作成` が押せない
- [ ] **TAG-011** TAG-006 のあと、名前に `v1.0.0/fix` を入力する → `既存のタグ v1.0.0 と名前が衝突します` が表示され、`作成` が押せない
- [ ] **TAG-012** TAG-006 のあと、名前に `V1.0.0`(大文字小文字だけが違う)を入力する → `既存のタグ v1.0.0 と名前が衝突します` が表示され、`作成` が押せない
- [ ] **TAG-013** 名前に `feat`、続けて `FEAT` を入力する → どちらも `同じ名前のブランチが存在するため、タグを作成できません` が表示され、`作成` が押せない
- [ ] **TAG-014** 名前に `-x` を入力する → `` `-` で始まる名前は使用できません ``。`HEAD`・`head`・`@` を入力する → いずれも `この名前は使用できません`。どれも `作成` が押せない
- [ ] **TAG-015** 名前に `a..b` を入力する → ダイアログ内では拒否されず `作成` が押せる。`作成` を押す → ダイアログは閉じず、赤字で `タグ名として使用できない名前です: a..b` が表示される。`git tag -l` に `a..b` は無い
- [ ] **TAG-016** TAG-015 のあと `キャンセル` で閉じ、もう一度 `タグを作成` を押す → `タグ名として使用できない名前です: a..b` の表示は残っていない

### リポジトリの状態

- [ ] **TAG-017** 端末で `cd "$(mktemp -d)" && git init -b main` だけしたフォルダ(コミット無し)をアプリで開き、`タグを作成` で名前 `v1` を `作成` する → ダイアログは閉じず、`コミットが無いため、タグを作成できません` が表示される
- [ ] **TAG-018** 端末で `git config user.name ""` を実行し、`注釈付き`・名前 `v3`・メッセージ `m` で `作成` を押す → ダイアログは閉じず、`コミッター情報（user.name / user.email）が未設定のため、注釈付きタグを作成できません` が表示される(英語の `Please tell me who you are` は出ない)。同じ状態で `軽量` にして `作成` を押すと作られる。確認後 `git config user.name test` で戻す
- [ ] **TAG-019** 端末で `git config tag.gpgSign true` と `git config gpg.program false` を実行し、`注釈付き` で名前 `v4`・メッセージ `m` を `作成` する → ダイアログは閉じず、`タグを作成できませんでした: ` に続けて `gpg failed to sign the data` を含む git のエラーが表示され、タグ `v4` は作られない。同じ状態で `軽量` の `v5` は作られ、`git cat-file -t v5` が `commit`。確認後 `git config --unset tag.gpgSign` と `git config --unset gpg.program` で戻す
- [ ] **TAG-020** 端末で `git config tag.forceSignAnnotated true` と `git config gpg.program false` を実行し、`注釈付き` で名前 `v7`・メッセージ `m` を `作成` する → ダイアログは閉じず、`タグを作成できませんでした: ` に続けて `gpg failed to sign the data` を含む git のエラーが表示され、署名なしのタグ `v7` が黙って作られることはない(`git tag -l v7` が空)。同じ状態で `軽量` の `v8` は作られる。確認後 `git config --unset tag.forceSignAnnotated` と `git config --unset gpg.program` で戻す
- [ ] **TAG-021** 「マージコンフリクトの解決」の CNF-001 の手順でマージ中にし、`タグを作成` で `軽量`・名前 `during-merge` を `作成` する → 作られ(`git rev-parse during-merge` が `git rev-parse HEAD` と同じ)、マージ中のバナーと未解決のファイルはそのまま残る
- [ ] **TAG-022** 端末で `git checkout --detach HEAD~1` を実行し、パネルの `更新` を押してから `タグを作成` で名前 `old` を `作成` する → 作られ、`git rev-parse old` が `git rev-parse HEAD`(1 つ前のコミット)と同じ。確認後 `git checkout main` で戻す

### 実行中と見た目

- [ ] **TAG-023** 名前 `v6` を入力して `作成` を素早く 2 回押す → タグ `v6` が 1 つだけ作られ、エラーは表示されない
- [ ] **TAG-024** 端末で `printf '#!/bin/sh\nsleep 5\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit && echo 3 >> a.txt && git add a.txt` を実行して `更新` を押し、コミット欄にメッセージを入れてコミットする → コミットが終わるまでの約 5 秒間、`タグを作成` ボタンは半透明で押せず、コミットが終わると押せるようになる。確認後 `rm .git/hooks/pre-commit` で戻す
- [ ] **TAG-025** ダイアログ全体を見る → 暗色の背景で、選択中の種類(`軽量` / `注釈付き`)が青く強調され、`作成` が押せない間は半透明になっている
- [ ] **TAG-026** 端末で `printf '#!/bin/sh\nsleep 5\nexit 1\n' > "$TMPDIR/slow-gpg" && chmod +x "$TMPDIR/slow-gpg" && git config tag.gpgSign true && git config gpg.program "$TMPDIR/slow-gpg"` を実行し、`注釈付き`・名前 `v9`・メッセージ `m` で `作成` を押す → 約 5 秒間は `作成中...` で、ダイアログ内に `作成中です。署名の入力待ちなどで最大 2 分かかることがあります` の案内が出て、`キャンセル` は半透明で押せず、Escape キーやダイアログの外側のクリックでも閉じない。5 秒後、案内が消えてダイアログ内に `タグを作成できませんでした: ` に続く git のエラーが表示され、`タグ名` の入力欄にフォーカスが戻る。そのまま Escape キーを押すとダイアログが閉じ、`タグを作成` ボタンにフォーカスが戻る(`キャンセル` でも閉じられる)。確認後 `git config --unset tag.gpgSign` と `git config --unset gpg.program` で戻す
```

ファイル末尾の HTML コメント（要確認事項）に、次の行を足す:

```markdown
- TAG の `作成中...` の表示は一瞬で目視確認が難しいため項目にしていない。TAG-024 の pre-commit フックの `sleep` で、コミット中に `タグを作成` が押せなくなることを実機で確かめる(未確認)
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
(git diff --name-only --diff-filter=d; git ls-files --others --exclude-standard) | grep -v '^.gitignore$' | xargs npx prettier --check
git status -s --untracked-files=all
```

Expected: すべて成功。`git status` に、この機能に関係ないファイルや一時ファイル（ミューテーションの退避先など）が無いこと

- [ ] **Step 4: Artifact を再公開する（CLAUDE.md のルール）**

`.superpowers/manual-test-spec.html` を同じファイルパス・同じ URL（<manual-test-spec-artifact-url>）で再公開する。これはコントローラー（親エージェント）が行う（実装者のサブエージェントは行わない）。

- [ ] **Step 5: Commit（ユーザーの許可がある場合のみ）**

## Self-Review

**Spec coverage:**

- HEAD への軽量 / 注釈付きタグの作成: Task 2（`createTag`）・Task 5（ダイアログ）
- 履歴セクションの見出しのボタンとダイアログ（radiogroup・メッセージの表示 / 非表示・disabled・エラー表示・二重送信の防止・フォーカス）: Task 5
- 名前の検証（アプリ独自の規則 + check-ref-format）、重複・階層の衝突・ブランチとの同名の事前拒否: Task 1（共有）・Task 2（main）・Task 4（renderer）
- コミットが無い・コミッター情報が無い・署名の失敗: Task 2
- 作成後の履歴・タグの再取得、排他（ロックは取らない）: Task 4
- IPC の引数検証（余分なキーを無視）・許可フォルダ・preload: Task 3
- 配線: Task 6。実機テスト仕様書・ROADMAP の確認: Task 7

**Placeholder scan:** TBD / TODO / 「同様に」なし。各タスクのテストと実装のコードは完全な形で書いた。

**Type consistency:** `TAG_KINDS` / `TagKind` / `CreateTagRequest`（Task 1）→ `createTag(folderPath, request)`（Task 2）→ `git:createTag` / `window.api.createTag` / `gitApi.createTag`（Task 3）→ `GitTagPanelState` / `useGitTagOperations`（Task 4）→ `CreateTagDialog` / `HistorySection`（Task 5）→ `gitTag` の配線（Task 6）。
