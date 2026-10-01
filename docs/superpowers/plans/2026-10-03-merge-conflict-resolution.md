# マージコンフリクトの解決 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ブランチのマージがコンフリクトしたら自動で中止せず、「マージ中」バナーとコンフリクト解決ビュー（ブロックごとに自分 / 相手 / 両方）で解決して、マージを完了または中止できるようにする。

**Architecture:** main に純粋関数のコンフリクト解析（`gitConflictParser.ts`）と、解決・完了・中止の実行（`gitConflictService.ts`）を置く。ブロックの解決は、実行時にファイルを読み直して確認時のブロック構成（ダイジェスト）と照合し、違えば何も書かない（パターン62）。`mergeBranch` は、未解決ファイルがあるコンフリクトでは中止せずにエラーを返す。renderer は `GitStatusResult.mergeInProgress` から `MergeBanner` を出し、未解決ファイルの diff タブの中身を `ConflictResolver` に差し替える（新しい種類のタブは作らない）。

**Tech Stack:** Electron, React, TypeScript, simple-git, Vitest + Testing Library

設計は [docs/superpowers/specs/2026-10-03-merge-conflict-resolution-design.md](../specs/2026-10-03-merge-conflict-resolution-design.md)。

## Global Constraints

- 返答・コメント・エラーメッセージ・テスト名は日本語。型だけの import は `import type`。`git commit` / `git push` は、ユーザーの明示的な指示があるまで行わない（SDD 中はコミットしない運用。各タスクのコミット手順は飛ばす）。
- 実機（Electron）の確認手順はプランに書かない。実機テスト仕様書 `docs/manual-test-spec.md` に新しい領域（接頭辞 `CNF`）を追記する（CLAUDE.md のルール。最終タスク）。
- エラー・確認文言（完全一致）:
  - `コンフリクトしました（<ファイル一覧>）。解決するか、マージを中止してください`（ファイル一覧は `formatConflictFiles`。`gitMergeMessages.ts`）
  - 従来の `マージを完了できなかったため中止しました…`（未解決ファイルが 0 件で `MERGE_HEAD` が残る場合）は変えない
  - `コンフリクト中のファイルではありません` / `ファイルが変更されたため中止しました。開き直してください` / `コンフリクトのマーカーが残っています` / `未解決のファイルがあるため完了できません` / `マージ中ではありません` / `この側にはファイルがありません。「ファイルを残す」か「削除する」を選んでください` / `コンフリクトのマーカーを解析できません。エディタで直接編集してください`
  - 中止の確認: `マージを中止して、マージ前の状態に戻しますか？ 解決済みの内容も含め、マージ中の変更は破棄されます。`（未保存編集の破棄は `confirmDiscardAnyDirty`）
  - バナー: `マージ中（未解決 <N> 件）` / 0 件のとき `マージ中（すべて解決済み。マージを完了できます）`
- UI 文言と `aria-label`: バナーのボタン `マージを中止` / `マージを完了`（実行中 `中止中...` / `完了中...`）。ブロックのボタン `自分を採用` / `相手を採用` / `両方`（`aria-label` は `ブロック <i> を自分の内容にする` / `…相手の内容にする` / `…両方にする`、`<i>` は 1 始まり）。ファイル単位 `自分をすべて採用` / `相手をすべて採用` / `ファイルを残す` / `削除する` / `解決済みにする`。選んだブロックはファイルが書き換わってビューから消える。結果は `role="status"` で `ブロック N を自分の内容にしました` のように読み上げ、フォーカスは次のブロックの先頭のボタンへ移す。バナーは `role="status"`、エラーは `role="alert"`。タップ領域は 32px 以上。
- 排他: 完了・中止・ブロックの選択・ファイル単位の操作は `lockGlobal`。busy の判定は `useGitStashOperations` と同じ（自分の busy ref + `lock.isAnyLocked()` + リポジトリの有無）。確認の拒否ではロックを取らない。成功時だけタブとツリーを再読込する（パターン20）。
- マーカーの規則: 行頭の `<<<<<<< ` / `||||||| ` / `=======` / `>>>>>>> `（7 文字ちょうど）。インデント付き・6 文字・8 文字は本文。CRLF は保つ。
- 既存の取り消し・退避・マージのテストが依存する挙動は、`mergeBranch` の自動中止の変更を除いて変えない。

## File Structure

| ファイル                                                                                                                       | 責務                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `src/shared/types/git.ts`（変更）                                                                                              | `GitStatusResult.mergeInProgress`、`ConflictSegment` / `ConflictFile` / `ConflictChoice`                |
| `src/main/gitConflictParser.ts`（新規）                                                                                        | `parseConflictFile` / `applyConflictChoices` / `digestConflictBlocks` / `hasConflictMarker`（純粋関数） |
| `src/main/gitConflictService.ts`（新規）                                                                                       | 読み取り・ブロック解決・ファイル単位・解決済み・完了・中止                                              |
| `src/main/gitService.ts`（変更）                                                                                               | `mergeBranch` の自動中止の変更、`getGitStatus` の `mergeInProgress`                                     |
| `src/main/handlers/gitHandlers.ts`（変更）                                                                                     | IPC `git:getConflictFile` ほか                                                                          |
| `src/renderer/src/lib/mergeStateMessage.ts`（新規）                                                                            | バナー・中止の文言                                                                                      |
| `src/renderer/src/hooks/useMergeState.ts` / `useConflictFile.ts`（新規）                                                       | 完了・中止、解決ビューの状態と操作                                                                      |
| `MergeBanner.tsx` / `ConflictResolver.tsx` / `ConflictBlock.tsx` / `ConflictLines.tsx`（新規）、`EditorPanel.tsx` ほか（変更） | UI と配線（`ConflictLines` は行の並びの描画を共有する）                                                 |

---

### Task 1: 型とコンフリクトの解析（純粋関数）

**Files:**

- Modify: `src/shared/types/git.ts`
- Create: `src/main/gitConflictParser.ts`, `src/main/__tests__/gitConflictParser.test.ts`

**Interfaces:**

- Produces（`shared/types/git.ts`）:
  - `GitStatusResult` に `mergeInProgress: boolean` を足す（既存の生成箇所（`getGitStatus`、テストの fixture）をすべて更新。リポジトリでないときは `false`）
  - `export type ConflictChoice = 'ours' | 'theirs' | 'both'`
  - `export type ConflictSegment = { kind: 'text'; lines: string[] } | { kind: 'conflict'; ours: string[]; theirs: string[]; base?: string[]; oursLabel: string; theirsLabel: string }`
  - `export type ConflictFile = { status: 'parsed'; segments: ConflictSegment[]; digests: string[]; eol: '\n' | '\r\n' } | { status: 'unparsable' }`（`digests` はコンフリクトのブロックの順の SHA-1 ダイジェスト）
- Produces（`gitConflictParser.ts`）:
  - `parseConflictFile(content: string): { segments: ConflictSegment[]; eol: '\n' | '\r\n' } | null`（解析不能は `null`。CRLF が主なら `eol` は `'\r\n'`。内部の行は改行コードを含まない）
  - `digestConflictBlocks(segments: ConflictSegment[]): string[]`（ブロックごとの `ours` + `theirs`（+ `base`）の内容から作る。`node:crypto` の sha1 hex。内容が変われば変わる）
  - `applyConflictChoices(parsed: ParsedConflict, choices: Record<number, ConflictChoice>): string`（コードレビュー指摘で、行ごとの改行 `lineEnds` を使うため解析結果ごと受け取る形に変更。本文の行・選んだ側の行・残すマーカー行を元の改行のまま出力する。`choices` のキーはコンフリクトのブロックの 0 始まりの番号。未指定のブロックは元のマーカー付きの形で書き戻す。`both` は自分 → 相手の順。最後の行末の改行の有無は元のとおりに保つ）

- [ ] **Step 1: 失敗するテストを書く（`gitConflictParser.test.ts`）**

- 1 ブロック、複数ブロック（間にテキスト）、先頭・末尾がブロック、片側が空のブロック（`ours` が空・`theirs` が空）
- diff3 形式（`||||||| base` あり）で `base` が入る。ラベル（`HEAD` / ブランチ名、空白を含むラベル）が `oursLabel` / `theirsLabel` に入る
- CRLF のファイルで `eol === '\r\n'`、行に `\r` が残らない。`applyConflictChoices` の出力が CRLF で、元のテキスト部分と一致する
- 行ごとの改行の保持（コードレビュー指摘で追加）: LF と CRLF の混在、CRLF のファイルで最終行だけ LF、改行なしで終わる終了マーカー（ours / theirs / both / 空の側）、`both` の境界で改行が欠けも重なりもしない、ダイジェストが改行コードに依存しない
- 末尾に改行が無いファイル、あるファイルの両方で、`applyConflictChoices` の出力の末尾が元と同じ
- 本文のマーカーに見える文字列: インデント付き（`  <<<<<<< x`）、6 文字（`<<<<<< x`）、8 文字（`<<<<<<<< x`）、`=======` を含む行（`======= x`）は本文として扱う（`=======` は行全体が 7 個の `=` のときだけマーカー）
- 解析不能（`null`）: 閉じていない（`<<<<<<<` だけ）、`=======` が無い、`>>>>>>>` が無い、ネスト（`<<<<<<<` の中にもう一つ）、順序の崩れ（`>>>>>>>` が先）
- `applyConflictChoices`: `ours` / `theirs` / `both` の 3 択 × 複数ブロック、未指定のブロックが元のマーカー付きで残る（ラベル・base も復元される）、すべて選ぶとマーカーが残らない、範囲外の番号は無視せず `Error('ブロックの番号が範囲外です')` を投げる
- `digestConflictBlocks`: 同じ内容で同じ値、自分側 1 文字の変更で値が変わる、ブロックの順で並ぶ

```bash
npx vitest run src/main/__tests__/gitConflictParser.test.ts
```

Expected: FAIL（モジュールが無い）

- [ ] **Step 2: 実装する**

`parseConflictFile` は行ごとの状態機械（text → ours → (base →) theirs → text）。行頭のマーカー判定は `line.startsWith('<<<<<<< ')` または `line === '<<<<<<<'`（ラベル無し）、`line.startsWith('||||||| ')` / `line === '|||||||'`、`line === '======='`、`line.startsWith('>>>>>>> ')` / `line === '>>>>>>>'`。ブロックの外で `=======` / `>>>>>>>` / `|||||||` が現れたら解析不能（本文として扱うのは、7 文字ちょうどのマーカーの形に当たらないものだけ）。ブロックの中で `<<<<<<<` が現れたらネストで `null`。ファイル末で状態が text でなければ `null`。行の分割は `content.split(/(\r?\n)/)` で行と改行を組で持ち（行ごとの改行は `lineEnds` に記録する。コードレビュー指摘で変更）、最後の空要素（末尾の改行）は `segments` に含めず、`applyConflictChoices` が「元が改行で終わっていたか」を保つために、解析結果に `endsWithEol: boolean` を持たせて使う（`ConflictFile` の型には出さず、`parseConflictFile` の戻り値に含める）。

```bash
npx vitest run src/main/__tests__/gitConflictParser.test.ts
```

Expected: PASS

- [ ] **Step 3: ミューテーション**

`mktemp -d` の新規ディレクトリへ `cp` で退避 → 変異 → テストが落ちる → 復元 → `cmp`: (1) `both` の連結順を逆にする、(2) 7 文字ちょうどの判定を `startsWith('<<<<<<')` に緩める、(3) CRLF の `eol` を常に `\n` にする、(4) ダイジェストから `theirs` を外す。それぞれ該当のテストが落ちること。

- [ ] **Step 4: 検証**

```bash
npm run typecheck
npx eslint src/shared/types/git.ts src/main/gitConflictParser.ts
npx prettier --check src/shared/types/git.ts src/main/gitConflictParser.ts src/main/__tests__/gitConflictParser.test.ts
```

Expected: すべて成功（`mergeInProgress` を足した型の影響で他の fixture が型エラーになる場合は、このタスクで更新する: `grep -rn "isRepo:" src` で洗う）

- [ ] **Step 5: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 2: `gitConflictService.ts`（読み取り・ブロック解決・ファイル単位・解決済み・完了・中止）

**Files:**

- Create: `src/main/gitConflictService.ts`, `src/main/__tests__/gitConflictService.test.ts`, `src/main/__tests__/gitConflictService.integration.test.ts`

**Interfaces:**

- Consumes: Task 1 の関数と型、`toLiteralPathspec` / `parseNulSeparatedPaths`（`gitPathParsing.ts`）、統合テストのヘルパ（`src/main/__tests__/helpers/realGitRepo.ts` の隔離・`writeRepoFile` / `readRepoFile`。既存の統合テストの作りに合わせる）
- Produces（すべて `async`、`folderPath` が第 1 引数、`filePath` はリポジトリ相対）:
  - `getConflictFile(folderPath, filePath): Promise<ConflictFile>` — 未解決（`ls-files -u` に含まれる）でなければ `コンフリクト中のファイルではありません` で throw。バイナリ（NUL を含む）と解析不能は `{ status: 'unparsable' }`
  - `resolveConflictBlocks(folderPath, filePath, expectedDigests: string[], choices: Record<number, ConflictChoice>): Promise<void>` — 実行時に読み直して解析し、`digestConflictBlocks` が `expectedDigests` と配列として完全一致しなければ `ファイルが変更されたため中止しました。開き直してください`（何も書かない）。`choices` の値が列挙内であることを検証（違反は `Invalid choices`）。キー（番号）が正規の 10 進表記で範囲内であることは `applyConflictChoices` が検証する（違反は `ブロックの番号が範囲外です`）。書き込みは同じディレクトリの一時ファイルへ書いてから `rename`
  - `resolveConflictWholeFile(folderPath, filePath, side: 'ours' | 'theirs'): Promise<void>` — 未解決の確認の後、`ls-files -u -z` のステージ番号（2 = 自分、3 = 相手）で該当の側が存在するか確認し、無ければ `この側にはファイルがありません。「ファイルを残す」か「削除する」を選んでください`。あれば `git checkout --ours|--theirs -- <literal pathspec>`
  - `keepConflictFile(folderPath, filePath)`: 未解決の確認の後 `git add -- <literal>`（作業ツリーにファイルが無いときは、存在するステージの版を `checkout` してから add。実機で `DU` / `UD` の挙動を確認して実装する）。`removeConflictFile(folderPath, filePath)`: 未解決の確認の後 `git rm -- <literal>`
  - `markConflictResolved(folderPath, filePath)`: 未解決の確認の後、ファイルを読み、行頭のマーカー（`<<<<<<< ` / `=======` / `>>>>>>> ` の 7 文字ちょうど）が残っていれば `コンフリクトのマーカーが残っています`、無ければ `git add -- <literal>`。バイナリはマーカー検査を飛ばす
  - `completeMerge(folderPath)`: `MERGE_HEAD` が無ければ `マージ中ではありません`、`ls-files -u` が非空なら `未解決のファイルがあるため完了できません`、そうでなければ `git commit --no-edit`
  - `abortMerge(folderPath)`: `MERGE_HEAD` が無ければ `マージ中ではありません`、あれば `git merge --abort`
  - `getConflictFile` と書き換える 5 操作は、先頭で `MERGE_HEAD` を確認し、無ければ `マージ中ではないため、コンフリクトを解決できません(…)` で拒否する（CLI の rebase 中は ours/theirs の意味が逆のため。コードレビュー指摘で追加）。統合テストで `git rebase` を止めた状態の拒否とファイル・index の不変を固定する
- 共通: 未解決の確認は `ls-files -u -z -- <literal pathspec>` の出力に `filePath` と完全一致するパスがあるか（`parseNulSeparatedPaths(output, true)`。`gitDiscardClassifier` の `conflicted` 判定と同じ作り）。パスは呼び出し側（IPC）が境界チェック済みの相対パス。

- [ ] **Step 1: 単体テスト（モック）を先に書く（`gitConflictService.test.ts`）**

simple-git の `raw` のスタブ（既存の `gitDiscardService.test.ts` の作りに合わせる）とファイル I/O（`fs/promises` のモック）で、次を固定する: 各関数が未解決でないファイルを `コンフリクト中のファイルではありません` で拒否し、後続の git・書き込みを呼ばない（検証の順序）、`resolveConflictBlocks` のダイジェスト不一致で `writeFile`/`rename` を呼ばない、`choices` の番号の不正（小数・負数・範囲外・空・先頭ゼロ）で `ブロックの番号が範囲外です`、値の不正（列挙外）で `Invalid choices`、書き込みが一時ファイル → `rename` の順、`resolveConflictWholeFile` でステージ 2/3 の有無による拒否、`markConflictResolved` がマーカーありで `git add` を呼ばない、`completeMerge` の前提の順序（`MERGE_HEAD` → 未解決）、`abortMerge` の `MERGE_HEAD` 確認。git の引数（`checkout --ours -- :(literal)…`、`commit --no-edit`、`merge --abort`、`rm --`）。

```bash
npx vitest run src/main/__tests__/gitConflictService.test.ts
```

Expected: FAIL

- [ ] **Step 2: 統合テスト（実 git）を書く（`gitConflictService.integration.test.ts`）**

既存の統合テスト（`gitDiscardService.integration.test.ts` など）の隔離（`stubIsolatedGitEnv`、`LC_ALL=C`、`GIT_DEFAULT_REF_FORMAT=files` 等）に合わせる。`main` と `feat` ブランチで `f.txt` を2か所ずつ別内容に変更して `git merge --no-edit feat` でコンフリクトを作る補助関数を用意する（`g.txt` も別内容で `UU`、`del.txt` を自分側で削除・相手側で変更して `DU`、`add.txt` を両方で追加して `AA`、バイナリ `b.bin` を両方で変更して `UU`）。

- `getConflictFile`: 2 ブロックを解析、`digests` の長さ 2、未解決でないファイルは throw、バイナリは `unparsable`
- `resolveConflictBlocks`: 1 つ目だけ `ours` → もう一方のマーカーは残る。全部選ぶとマーカーが無くなり、`markConflictResolved` → `completeMerge` でマージコミット（親が 2 つ、`MERGE_HEAD` が消える、メッセージが `Merge branch 'feat'`）
- 確認時と構成が変わったら（別の変更でダイジェストが変わる）何も書かない（ファイルの内容が不変）
- `resolveConflictWholeFile`: `UU`（`g.txt`）で `ours` / `theirs`、`AA` で `ours`、バイナリで `theirs`。`DU`（`del.txt`）の `ours` は拒否され、`theirs` は成功。`keepConflictFile` / `removeConflictFile` で `DU` を解決
- `completeMerge` は未解決が残ると拒否し、`MERGE_HEAD` が残る。`abortMerge` は元の状態（マージ前のコミットと作業ツリー）に戻る。マージ中でないときは両方とも `マージ中ではありません`
- `markConflictResolved` はマーカーが残っていると拒否し、`git add` されない（`ls-files -u` が変わらない）
- 手編集（マーカーを手で消した）後の `markConflictResolved` が成功する

```bash
npx vitest run src/main/__tests__/gitConflictService.integration.test.ts
```

Expected: FAIL

- [ ] **Step 3: 実装する**

上記の Interfaces に従う。`resolveConflictBlocks` は `parseConflictFile` が `null` のとき `コンフリクトのマーカーを解析できません。エディタで直接編集してください` で throw。書き込みの一時ファイル名は `<filePath>.conflict-<pid>-<時刻>.tmp`（同じディレクトリ。失敗時は `unlink` を試みて元の例外を投げる）。

```bash
npx vitest run src/main
```

Expected: PASS

- [ ] **Step 4: ミューテーション**

(1) ダイジェストの照合を外す、(2) 未解決の確認を外す、(3) `completeMerge` の未解決の確認を外す、(4) `markConflictResolved` のマーカー検査を外す、(5) 一時ファイル → `rename` をやめて直接 `writeFile`（途中失敗テストがあれば）、(6) `resolveConflictWholeFile` の側の存在確認を外す。それぞれ該当のテストが落ちること（手順は Task 1 と同じ）。

- [ ] **Step 5: 検証**

```bash
npx vitest run src/main
npm run typecheck
npx eslint src/main/gitConflictService.ts
npx prettier --check src/main/gitConflictService.ts src/main/__tests__/gitConflictService.test.ts src/main/__tests__/gitConflictService.integration.test.ts
```

Expected: すべて成功

- [ ] **Step 6: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 3: `mergeBranch` の自動中止の変更と `getGitStatus` の `mergeInProgress`

**Files:**

- Modify: `src/main/gitService.ts`, `src/main/gitMergeMessages.ts`
- Test: `src/main/__tests__/gitService.test.ts`, `src/main/__tests__/gitMergeMessages.test.ts`, `src/main/__tests__/gitService.merge.integration.test.ts`

**Interfaces:**

- Produces: `buildMergeConflictMessage(conflicted: string[]): string`（`コンフリクトしました（<formatConflictFiles>）。解決するか、マージを中止してください`。`gitMergeMessages.ts`）。`mergeBranch` はコンフリクト（`MERGE_HEAD` あり + 未解決 1 件以上）で `merge --abort` せずに上のメッセージで throw、未解決が 0 件で `MERGE_HEAD` が残る場合は従来の `abortFailedMerge`（`buildMergeAbortMessage`）。`getGitStatus` が `mergeInProgress`（`hasMergeInProgress`）を返す。

- [ ] **Step 1: 失敗するテストを書く**

- `gitMergeMessages.test.ts`: `buildMergeConflictMessage` の完全一致（1 件、5 件超の `ほか N 件`）
- `gitService.test.ts`（モック）: コンフリクトで `merge --abort` が呼ばれない、未解決 0 件 + `MERGE_HEAD` で `merge --abort` が呼ばれる、`getGitStatus` の `mergeInProgress`（真・偽・リポジトリでないとき偽）。既存の「コンフリクトで自動中止する」テストは、新しい挙動に直す（観点を落とさない: 未解決ファイルの取得は中止の前後どちらでも、メッセージに含まれる）
- `gitService.merge.integration.test.ts`（実 git）: コンフリクトのマージ後に `MERGE_HEAD` が残り、作業ツリーにマーカーがあり、メッセージが `コンフリクトしました（…）。解決するか、マージを中止してください`。続けて Task 2 の `abortMerge` で元に戻る。pre-merge-commit フックの失敗（未解決 0 件）は従来どおり中止して元に戻る。`squash` / `no-commit` の設定でも結果が壊れない（既存のテストが通り続ける）

```bash
npx vitest run src/main/__tests__/gitService.test.ts src/main/__tests__/gitMergeMessages.test.ts src/main/__tests__/gitService.merge.integration.test.ts
```

Expected: FAIL

- [ ] **Step 2: 実装する**

`mergeBranch` の `if (await hasMergeInProgress(git)) await abortFailedMerge(git, mergeError)` を、未解決ファイルの取得（`diff --name-only -z --diff-filter=U`）→ 1 件以上なら `buildMergeConflictMessage` で throw、0 件なら `abortFailedMerge` に変える。`abortFailedMerge` の「未解決は中止より前に取得」の注記は、0 件の分岐だけの説明に直す。`mergeBranch` の doc コメントの「コンフリクトはアプリ内に解決手段が無いため、自動で中止して元に戻す」を、新しい挙動に直す。`getGitStatus` に `mergeInProgress` を足す（リポジトリでないときは `false`）。

```bash
npx vitest run src/main
```

Expected: PASS

- [ ] **Step 3: ミューテーション**

(1) コンフリクトでも `abortFailedMerge` を呼ぶ（元の挙動）、(2) `mergeInProgress` を常に false、(3) 未解決 0 件の分岐を外す（中止しない）。それぞれ該当のテストが落ちること。

- [ ] **Step 4: 検証**

```bash
npm test
npm run typecheck
npx eslint src/main/gitService.ts src/main/gitMergeMessages.ts
npx prettier --check src/main/gitService.ts src/main/gitMergeMessages.ts
```

Expected: すべて成功（renderer のテストで `GitStatusResult` の fixture が `mergeInProgress` を要求して落ちる場合は、Task 1 で更新済みのはず。残りがあればここで更新する）

- [ ] **Step 5: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 4: IPC・preload・`gitApi`

**Files:**

- Modify: `src/main/handlers/gitHandlers.ts`, `src/preload/api.ts`, `src/preload/index.d.ts`, `src/renderer/src/lib/gitApi.ts`
- Test: `src/main/__tests__/handlers/gitHandlers.test.ts`, `src/preload/__tests__/api.test.ts`, `src/renderer/src/lib/__tests__/gitApi.test.ts`

**Interfaces:**

- Consumes: Task 2 の関数、`resolveAndAssertStatusRelativePath`、既存の `assert*Arg`
- Produces（IPC → preload → gitApi の同名・同シグネチャ）:
  - `getConflictFile(filePath: string): Promise<ConflictFile>`（`git:getConflictFile`）
  - `resolveConflictBlocks(filePath: string, expectedDigests: string[], choices: Record<number, ConflictChoice>): Promise<void>`（`git:resolveConflictBlocks`）
  - `resolveConflictWholeFile(filePath: string, side: 'ours' | 'theirs'): Promise<void>`
  - `keepConflictFile(filePath)` / `removeConflictFile(filePath)` / `markConflictResolved(filePath)`
  - `completeMerge(): Promise<void>` / `abortMerge(): Promise<void>`
- ハンドラーの順序: 許可フォルダの確認 → 引数の型検証 → （パスのある操作は）`resolveAndAssertStatusRelativePath` → service。型検証: `expectedDigests` は文字列の配列（要素は 40 桁の 16 進、最大 1000 件）、`choices` は番号（整数文字列のキー）→ 列挙の値のオブジェクト（最大 1000 件、`__proto__` などの特殊キーは拒否）、`side` は `'ours' | 'theirs'`。違反は `Invalid digests` / `Invalid choices` / `Invalid side`。

- [ ] **Step 1: ハンドラーの失敗するテストを書く**

既存の `git:discardChanges` / `git:discardAll` のテストの作りに合わせる。各チャンネルで、許可フォルダが無いと拒否（型検証より先）、不正な引数の拒否（`it.each`: 配列でない、要素が文字列でない、長さ 40 でない、特殊キー、列挙外の値、`side` が不正）、パスのある操作で境界の外のパスが `Access denied`、正常系で service が相対パスと引数で呼ばれること、`completeMerge` / `abortMerge` は引数なし。preload・gitApi は素通しのテスト。

- [ ] **Step 2: 実装する**

既存のパターンで IPC を登録し、preload・`index.d.ts`・`gitApi.ts` を同名・同シグネチャで足す。

```bash
npx vitest run src/main/__tests__/handlers src/preload src/renderer/src/lib/__tests__/gitApi.test.ts
```

Expected: PASS

- [ ] **Step 3: ミューテーション・検証**

(1) 型検証を外す、(2) 相対パス化を外す。該当のテストが落ちること。`npm run typecheck`、変更ファイルの eslint・prettier --check。

- [ ] **Step 4: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 5: renderer のフック（`useMergeState` / `useConflictFile`）と `useAppState`

**Files:**

- Create: `src/renderer/src/lib/mergeStateMessage.ts`, `src/renderer/src/hooks/useMergeState.ts`, `src/renderer/src/hooks/useConflictFile.ts`、各テスト
- Modify: `src/renderer/src/hooks/useAppState.ts`, `src/renderer/src/types.ts`、`src/renderer/src/hooks/__tests__/useAppState.test.ts`

**Interfaces:**

- Consumes: Task 4 の `gitApi`、`useRunExclusiveGitOperation`、`runEditorSyncedOperation`、`useDiscardAllChanges` / `useDiscardHunk`（作りの見本）、`isConflictedFile`
- Produces:
  - `mergeStateMessage.ts`: `buildMergeBannerText(unresolvedCount: number): string`、`MERGE_ABORT_CONFIRM_MESSAGE`（Global Constraints の文言）
  - `types.ts`: `MergeStatePanelState { inProgress: boolean; unresolvedCount: number; pendingOperation: 'complete' | 'abort' | null; error: Error | null; canComplete: boolean; onComplete(): Promise<void>; onAbort(): Promise<void> }`
  - `useMergeState(options): MergeStatePanelState`（`options`: `gitStatus`、`refreshGitStatus`、`refreshHistory`（マージコミットの履歴の更新に必要なら。`useGitBranchOperations` の更新の作りに合わせる）、`fileLock`、`confirmDiscardAnyDirty`、`reloadOpenFiles`、`refreshTree`、`onConfirm = confirm`）。`onAbort`: busy 判定 → 中止の確認 → `confirmDiscardAnyDirty` → `lockGlobal` → `gitApi.abortMerge` → 成功時 `reloadOpenFiles` と `refreshTree`。`onComplete`: `canComplete`（`inProgress && unresolvedCount === 0`）でなければ何もしない → `lockGlobal` → `gitApi.completeMerge` → 成功時に再読込。`error` は失敗時にセット、次の成功で消える
  - `useConflictFile(options)`: `activePath`（未解決ファイルの diff タブのパス、または `null`）、`gitStatus`、`refreshGitStatus`、`fileLock`、`hasDirtyTabAtOrInside` / `reloadOpenFile`、`refreshTree`（削除・残す・すべて採用の成功後にツリーを読み直す。失敗は無視。コードレビュー指摘で追加）、`folderPath`、`onConfirm`。状態: `file: ConflictFile | null`、`isLoading`、`error`、`pendingOperation`。操作: `chooseBlock(index, choice)`（今のダイジェストを `expectedDigests` として `gitApi.resolveConflictBlocks`）、`resolveWholeFile(side)`、`keepFile()`、`removeFile()`、`markResolved()`。ファイルを書き換える操作の前に、そのファイルのタブに未保存編集があれば破棄を確認（拒否で何もしない）、成功時にそのタブを `reloadOpenFile`、続けて `getConflictFile` で読み直し、`refreshGitStatus`。失敗時も（エラーの文言を残して）読み直す。実行中フラグ・`pendingOperation`・ロックは読み直しの完了まで保つ（コードレビュー指摘で変更）。`useAppState` は `mergeInProgress` のときだけ `activePath` を渡す（rebase 中などは通常の diff）。`activePath` の変化・フォルダ切替で古い結果が反映されない（キャンセルフラグ）
  - `useAppState`: `mergeState: MergeStatePanelState` と `conflictFile`（`useConflictFile` の戻り値）を公開。`useStashPanel` の組み立てに合わせて 1 呼び出しずつ置く

- [ ] **Step 1: 失敗するテストを書く**

- `mergeStateMessage.test.ts`: バナーの文言（件数 > 0、0 件）、中止の確認文言の完全一致
- `useMergeState.test.ts`（`useGitStashOperations.test.ts` / `useDiscardAllChanges.test.ts` の作りに合わせる）: `inProgress` / `unresolvedCount`（`isConflictedFile` の件数）の導出、`canComplete` の条件、中止: 確認の拒否でロックを取らず `abortMerge` を呼ばない、`confirmDiscardAnyDirty` の拒否で何もしない、成功で `lockGlobal` → 実行 → `unlockGlobal`、`reloadOpenFiles` と `refreshTree`、失敗（reject）で `error` がセットされ再読込しない・ロックが解放される、多重実行・他の操作がロック中・リポジトリ無しで何もしない、完了: `canComplete` でなければ何もしない、成功で再読込、失敗で error
- `useConflictFile.test.ts`: `activePath` が null で何もしない、読み込み（`getConflictFile`）、`chooseBlock` が今の `digests` で `resolveConflictBlocks` を呼ぶ、成功で読み直しとステータスの再取得とタブの再読込、未保存編集の確認の拒否で書き込まない、失敗で error、`activePath` を切り替えた後に遅れて解決した古い結果を反映しない、ファイル単位の各操作、`markResolved` の後に `refreshGitStatus`、削除・残す・すべて採用の成功後だけ `refreshTree`（reject しても操作は成功のまま、失敗した操作・ブロックの選択・解決済みにするでは呼ばない）、ロックの取得と解放（成功・失敗）
- `useAppState.test.ts`: 2 つのフックが依存つきで呼ばれ、戻り値が公開される（子フックは `vi.mock`）

- [ ] **Step 2: 実装する**

上の Interfaces に従う（`useRunExclusiveGitOperation` の実際の引数は `useGitStashOperations.ts` を読んで合わせる）。

```bash
npx vitest run src/renderer/src/hooks src/renderer/src/lib
```

Expected: PASS

- [ ] **Step 3: ミューテーション**

(1) 中止の確認の拒否後もロックを取る、(2) 成功判定を外して常に再読込、(3) `unlockGlobal` を外す、(4) `chooseBlock` が古いダイジェストを使う（空配列）、(5) `activePath` の変化の無効化を外す。それぞれ該当のテストが落ちること。

- [ ] **Step 4: 検証**

```bash
npx vitest run src/renderer
npm run typecheck
npx eslint src/renderer/src/hooks/useMergeState.ts src/renderer/src/hooks/useConflictFile.ts src/renderer/src/lib/mergeStateMessage.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/types.ts
npx prettier --check <変更・新規のファイル>
```

Expected: すべて成功

- [ ] **Step 5: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 6: UI（`MergeBanner` / `ConflictResolver` / `ConflictBlock`）と配線・CSS

**Files:**

- Create: `src/renderer/src/components/source-control/MergeBanner.tsx`, `ConflictResolver.tsx`, `ConflictBlock.tsx`、各テスト
- Modify: `EditorPanel.tsx`, `SourceControlPanel.tsx`, `GitRepoView.tsx`, `Sidebar.tsx`, `App.tsx`, `src/renderer/src/assets/main.css`、既存テストの fixture

**Interfaces:**

- Consumes: Task 5 の `MergeStatePanelState` / `useConflictFile` の戻り値
- Produces: `MergeBanner({ mergeState })`（`mergeState.inProgress` が偽なら `null`）、`ConflictResolver({ conflict })`（`conflict` は `useConflictFile` の戻り値）、`ConflictBlock({ index, segment, applied?, disabled, onChoose })`。`EditorPanel` は、アクティブな diff タブが未解決のファイル（`gitStatus` で `isConflictedFile`）のとき、`DiffView` の代わりに `ConflictResolver` を表示する。判定に使う値は props（`isActiveFileConflicted: boolean`）で受け、`EditorPanel` 自身は状態を持たない。

- [ ] **Step 1: 失敗するテストを書く**

- `MergeBanner.test.tsx`: `inProgress` が偽で何も出ない、`マージ中（未解決 N 件）` / 0 件の文言、`role="status"`、「マージを完了」は `canComplete` が偽で disabled、「マージを中止」は常に有効、実行中の表示（`完了中...` / `中止中...`）と他のボタンの disabled、クリックで `onComplete` / `onAbort`、`error` が `role="alert"`
- `ConflictBlock.test.tsx`: 自分側・相手側の内容を表示（base があれば表示）、3 ボタンの `getByRole('button', { name })` による取得（`aria-label`）、クリックで `onChoose(choice)`、`disabled` で押せない
- `ConflictResolver.test.tsx`: 読み込み中、`parsed` でブロックの並びとテキスト、`unparsable` の文言、ブロックが 0 件になると `解決済みにする` が押せる（未解決のブロックが残る間は disabled）、ファイル単位のボタン（`自分をすべて採用` / `相手をすべて採用`）、追加/削除型（ブロックなし）でファイル単位の `ファイルを残す` / `削除する` を出す、`unparsable` は `missing` 以外（バイナリ・リンクを含む）で `解決済みにする` を出す（コードレビュー指摘で変更）、実行中は全ボタン disabled、`error` が `role="alert"`
- `EditorPanel.test.tsx`: 未解決のとき `ConflictResolver` を出して `DiffView` を出さない、解決済みなら `DiffView`
- 配線: `SourceControlPanel` / `GitRepoView` の既存テストの fixture に `mergeState` を足し、バナーが `GitRepoView` の上部に出ることを確認（`mergeState.inProgress` が偽なら何も出ない）。`ChangesSection` の未解決ファイルのタップが diff タブを開く（既存の挙動が変わらない）ことを確認

- [ ] **Step 2: 実装する**

見本: `StashSection.tsx`（`role="alert"`、`aria-label` の切り替え、`disabled` の条件）、`DiffView.tsx`、`main.css` の `.stash-section__*` と `.diff-view__*`（ダークテーマの配色・寸法）。`mergeState` は `App` → `Sidebar` → `SourceControlPanel` → `GitRepoView` と 1 つのオブジェクトで渡す（`grep -rn "stash" src/renderer/src/components` で既存の配線の全箇所を洗い、`mergeState` が同じ箇所すべてにあることを確認する）。`conflictFile` は `App` → `EditorPanel` → `ConflictResolver`。React の `key` に表示文言を使わない（ブロックは番号）。CSS は追記のみ（ただしボタンの共通の見た目は、既存の `.stash-section__push` / `.stash-section__action` のグループセレクタに新しいクラスを加えて共有する。宣言を複製しない）。

```bash
npx vitest run src/renderer
npm run typecheck
```

Expected: PASS

- [ ] **Step 3: ミューテーション**

(1) バナーの完了ボタンの disabled 条件を外す、(2) `EditorPanel` の分岐を外す（常に `DiffView`）、(3) `ConflictBlock` のボタンの `aria-label` を変える、(4) `ConflictResolver` の `解決済みにする` の disabled 条件を外す、(5) `GitRepoView` でバナーを渡し忘れる。それぞれ該当のテストが落ちること。

- [ ] **Step 4: 検証**

```bash
npm test
npm run typecheck
git diff --name-only --diff-filter=d | grep -E '\.(tsx?|mjs)$' | xargs npx eslint
npx prettier --check <変更・新規のファイル>
git status -s --untracked-files=all
```

Expected: すべて成功。`git status` に、この機能に関係ないファイルや一時ファイルが無いこと

- [ ] **Step 5: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 7: ROADMAP・実機テスト仕様書への追記と全体検証

**Files:**

- Modify: `ROADMAP.md`, `docs/manual-test-spec.md`

- [ ] **Step 1: ROADMAP を更新する**

- 「実装済み機能 > ソース管理（Git 操作）」の取り消しの拡張の行の後に追加する:

```md
- [x] マージコンフリクトの解決 UI（ブランチのマージがコンフリクトしても自動で中止せず、「マージ中」バナーとコンフリクト解決ビューで
      ブロックごとに自分 / 相手 / 両方を選んで解決し、「マージを完了」または「マージを中止」で終える。プルや外部ターミナルで
      起きたマージ中の状態も同じ UI で扱う。追加/削除型やバイナリのコンフリクトはファイル単位の操作のみ）
```

- 「今後実装した方がよい機能 > ソース管理（Git）」から `- [ ] マージコンフリクトの解決 UI` を削除し、見出し直後の説明文の「コンフリクトの解決などは」を実態に直す（例: 「blame やグラフ表示などは」）
- 「改善・技術的負債」の見送りに `[ ]` で追記（隣の項目と同じ書式）: `rebase・cherry-pick・revert の途中のコンフリクトの解決`、`コンフリクト解決の 3 ウェイ並列表示・ブロック内の行単位の取り込み`、`マージコミットのメッセージの編集（現在は既定メッセージで完了し、必要なら amend）`

```bash
npx prettier --check ROADMAP.md
```

- [ ] **Step 2: 実機テスト仕様書に追記する**

`docs/manual-test-spec.md` に、領域 `## マージコンフリクトの解決`（接頭辞 `CNF`、`CNF-001` から）を、「変更の取り消しの拡張」の領域の後に追加する。書式は仕様書の冒頭と `scripts/build-manual-test-spec.mjs` に従う（`- [ ] **CNF-001** 手順 → 期待結果` の 1 行）。領域の先頭の `> 前提:` に、コンフリクトを作る手順（`mktemp -d` で `git init`、`main` と `feat` で同じファイルの 2 か所を別内容に変更してコミット、`main` で `feat` をアプリのブランチ一覧からマージ）を書く。項目は、実コード（`MergeBanner` / `ConflictResolver` / `ConflictBlock` の表示文言と `aria-label`）を読んで書く: ブランチのマージがコンフリクトして止まる（エラー表示とバナー）、バナーの文言と件数、未解決ファイルをタップすると解決ビュー、ブロックごとの3択と選択結果の読み上げ、ファイル単位の採用、解決済みにする（マーカーが残っているときの拒否）、すべて解決するとバナーの文言が変わり「マージを完了」が押せる、完了するとマージコミットが履歴に出てバナーが消える、中止の確認と元に戻ること、未保存編集がある場合の確認、追加/削除型（`DU`）のファイル単位操作、バイナリ、実行中の表示と他の操作の disabled、ダークテーマの見た目、外部ターミナルで起きたマージ中の状態も同じ UI で扱えること。実機で確認できない・自信が持てない期待結果は、書かずにファイル末尾の HTML コメント（要確認事項）に残す。

```bash
npx prettier --write docs/manual-test-spec.md
npx vitest run scripts
node scripts/build-manual-test-spec.mjs
```

Expected: すべて成功（ID の一意性・昇順・書式の検査が通る）

- [ ] **Step 3: 全体を検証する**

```bash
npm test
npm run typecheck
git diff --name-only --diff-filter=d | grep -E '\.(tsx?|mjs)$' | xargs npx eslint
(git diff --name-only --diff-filter=d; git ls-files --others --exclude-standard) | grep -v '^.gitignore$' | xargs npx prettier --check
git status -s --untracked-files=all
```

Expected: すべて成功。`git status` に、この機能に関係ないファイルや一時ファイルが無いこと

- [ ] **Step 4: Artifact を再公開する（CLAUDE.md のルール）**

`.superpowers/manual-test-spec.html` を同じファイルパス・同じ URL（<manual-test-spec-artifact-url>）で再公開する。これはコントローラーが行う（実装者は行わない）。

- [ ] **Step 5: Commit（ユーザーの許可がある場合のみ）**

## 実装後の注記

実装とレビューを経て、上のタスクの記述から次の点が変わった（設計書が現行の仕様）。**検証の許可リスト化ではなく**、結果型と拒否の追加で対応している。

- `mergeBranch` はコンフリクトで例外を投げず、`MergeBranchResult`（`{ status: 'merged' } | { status: 'conflict'; message }`）の `conflict` で返す。作業ツリーが変わるため、例外だと renderer が開いているタブを再読込せず、古いタブの保存でマーカーと相手側の変更が消える（パターン52）。`useGitBranchOperations.mergeBranch` は `conflict` で `true` を返し、`message` を `branchOperationError` に残す。`gitStatus.mergeInProgress` が true → false になったら（バナー・コミット欄・CLI のどの経路の完了・中止でも）、`useGitBranchOperations` がそれを消す。通知として出した `Error` と同一のときだけ消し、別のブランチ操作のエラーは残す。
- `ConflictFile` に `stages`（ステージ 2・3 の有無）と、解析不能の `reason` を足した。ファイル単位の操作の出し分けに使う。結果の `applied` は削除した。
- 「解決済みにする」のマーカー検査は `<<<<<<<` / `|||||||` / `>>>>>>>` だけで、`=======` は検査しない（Markdown の見出し下線などの本文と区別できないため）。Task 2 の `markConflictResolved` の記述（`=======` も検査する）は実装と異なる。
- 「解決済みにする」のボタン（`getConflictActions` の `markResolved`）は、`parsed` か `reason !== 'missing'` で出す。バイナリ・リンクは `自分/相手をすべて採用` の後に押して解決する（`checkout --ours/--theirs` だけではステージ 1/2/3 が残る。コードレビュー指摘で変更。それまでは `markers` のときだけ出しており、バイナリ・リンクを解決できなかった）。
- `markConflictResolved` は、ファイルが無い（`reason === 'missing'`）と `ファイルが存在しないため解決済みにできません。…` で拒否する（削除は `removeConflictFile` の役割）。シンボリックリンク・バイナリはマーカー検査を飛ばして add する。
- `ConflictUnparsableReason` に `submodule` を足した。`getConflictFile` は `ls-files -u` のステージの mode が `160000`（gitlink）なら `reason: 'submodule'` を返し、書き換える 5 操作はすべて日本語で拒否する。`getConflictActions` はどのボタンも出さず、ビューはターミナルでの解決を案内する（コードレビュー指摘で追加。それまでは `not-regular` 扱いで、`相手をすべて採用`（実 git では何も変わらない）→ `解決済みにする` で自分側のコミットが黙って記録された）。
- マージ中の拒否を追加した: `checkoutBranch` / `createBranch`（マージ中）、`stageFile`（未解決のファイル。`ChangesFileItem` も `+` を出さない）、`commit`（未解決あり）、`amendCommit`（マージ中）。いずれも日本語のエラーで、何も実行しない。
- 確認ダイアログの文言は `コンフリクトした場合はマージ中の状態で止まります。解決するか、マージを中止できます。` に変えた。
- PR レビュー指摘で次を変えた: `.gitattributes` の `conflict-marker-size` に対応した（`parseConflictFile` / `hasConflictMarker` にマーカーの長さの引数を足し、`gitConflictService` が `git check-attr` で長さを得る）。`pull` もマージ中は日本語で拒否する。`ConflictBlock` のボタンの `aria-label` を表示文言を含む `ブロック <i> の自分を採用` などにした。`MergeBanner` の文言を `buildMergeBannerText` に置き換えた。

## Self-Review

**Spec coverage:**

- マージ中の検出・バナー・完了・中止: Task 3（`mergeInProgress`）・Task 2（`completeMerge` / `abortMerge`）・Task 5・6
- マージの自動中止の変更: Task 3
- 解決ビュー（ブロック・ファイル単位・追加/削除型・バイナリ）: Task 1・2・5・6
- 解決済みにする（マーカー検査）: Task 2・5・6
- TOCTOU（ブロック構成の照合）: Task 1（ダイジェスト）・2（`resolveConflictBlocks`）
- 排他・確認・成功時だけの再読込: Task 5
- IPC の検証: Task 4
- 実機テスト仕様書・ROADMAP: Task 7

**Placeholder scan:** TBD / TODO なし。

**Type consistency:** `ConflictFile` / `ConflictSegment` / `ConflictChoice`（Task 1）→ `getConflictFile` / `resolveConflictBlocks`（Task 2）→ IPC（Task 4）→ `useConflictFile`（Task 5）→ `ConflictResolver` / `ConflictBlock`（Task 6）。`MergeStatePanelState`（Task 5 の `types.ts`）→ `MergeBanner`（Task 6）。
