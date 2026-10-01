# 変更の取り消しの拡張（ハンク単位・一括）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** diff タブの各ハンクに「取り消し」ボタン、「変更」セクションに「すべて取り消す」ボタンを追加し、作業ツリーの変更をハンク単位・一括で取り消せるようにする。

**Architecture:** main の取り消しの分類と実行を `gitDiscardService.ts` に集め、ファイル単位・ハンク単位（`git apply --reverse`、`--cached` なし）・一括を同じ分類（`classifyDiscardTarget`）で扱う。ハンクはパッチの対象が対象ファイルだけであることを `git apply --numstat -z` で確認してから適用する。一括は実行時に `git status` から対象を作り直し、件数が確認時と違えば拒否し、全ファイルを先に分類して 1 件でも取り消せなければ何もしない。renderer は `useDiscardHunk`（確認 → 取り消し → タブ再読込）と `useDiscardAllChanges`（確認 → 全体ロック → 取り消し → 全タブ・ツリー再読込）を `useAppState` で組み立て、`DiffView` / `ChangesSection` から呼ぶ。

**Tech Stack:** Electron, React, TypeScript, simple-git, Vitest + Testing Library

> **実装後の注記:** 実装で次の点がこの計画から変わった。(1) ハンクのパッチ検証は、`gitHunkPatch.ts` の許可リスト（`assertHunkPatchTargets`）+ 順方向・逆方向の両方の `git apply --numstat -z` になった（1 方向の numstat では、a/b 不一致や旧形式の `rename old/new` を見逃したため）。(2) モード変更つきの diff（`old mode` / `new mode`）は、検証後に 2 行を取り除いて適用する（内容だけが戻り、モードは残る）。`deleted file mode` は `100644` / `100755` のみ許可する。(3) ハンクボタンの `aria-label` は固定（実行中は `disabled`）。(4) `parseUnstagedStatusPaths` は、`git add -N` したリネーム（` R`）の旧パスも読み飛ばす。(5) 分類（`classifyDiscardTarget`・`assertDiscardable`）は `gitDiscardClassifier.ts` に分離し、`gitDiscardService.ts` は取り消しの実行だけにした。(6) `classifyDiscardTarget(git, filePath)` は引数から `pathspec` を外し、リテラルの pathspec を内部で組み立てる。conflicted / unknown / overlaps-untracked の拒否は `assertDiscardable`（classifier 側）に集約し、`discardFileChanges` / `discardHunk` から呼ぶ。(7) `discardAllChanges` の戻り値を `DiscardAllResult`（`done` / `partial`）にした。1 件以上取り消した後の途中失敗は例外ではなく `partial` で返し、renderer が全タブとツリーを再読込する（0 件での失敗は従来どおり例外）。以降の本文（Interfaces とコード例）は実行時点の記録として残している。

設計は [docs/superpowers/specs/2026-10-02-discard-hunk-and-all-design.md](../specs/2026-10-02-discard-hunk-and-all-design.md)。

## Global Constraints

- 返答・コメント・エラーメッセージ・テスト名は日本語。型だけの import は `import type`。`git commit` / `git push` は、ユーザーの明示的な指示があるまで行わない（SDD 中はコミットしない運用。各タスクのコミット手順は飛ばす）。
- 取り消しは元に戻せない操作。ハンクも一括も、毎回確認ダイアログ（`confirm()`）を出す。キャンセルしたときは何もしない（ロックも取らない）。
- エラーメッセージの文言（完全一致）:
  - 共通（ファイル単位と同じ）: `コンフリクト中のファイルは取り消せません: <path>` / `状態を判定できないため取り消せません: <path>` / `未追跡のファイルと重なるため取り消せません: <path>` / `ゴミ箱へ移動できませんでした: <path>`
  - ハンク: `ゴミ箱へ移す対象のため、ハンクでは取り消せません: <path>` / `パッチの対象がファイルと一致しません` / `ハンクを取り消せませんでした。ファイルが変更された可能性があります。diff を開き直してください`
  - 一括: `変更の状態が変わったため取り消しを中止しました。もう一度操作してください` / `取り消せないファイルがあるため、何も取り消しませんでした（<path1>、<path2>…）`（パスは最大 5 件を `、` で区切り、超えた分は末尾に `ほか <n> 件` を足す。`<path1>、<path2>、…、ほか 3 件` のように、5 件の後に `、ほか <n> 件`）/ `一括の取り消しが途中で失敗しました（<済んだ件数> / <全件数> 件を取り消し済み）: <原因のメッセージ>`
- 確認文言（完全一致）:
  - ハンク: `<path> の次のハンクを取り消しますか？この操作は元に戻せません。\n\n<ハンクの見出し>`。未保存の編集があるときは末尾に `\n\nエディタの未保存の編集も破棄されます。`
  - 一括: `変更 <N> 件を取り消しますか？この操作は元に戻せません。`。ゴミ箱へ移すものがあるときは末尾に `\nうち <M> 件の未追跡ファイルはゴミ箱へ移動します。`
- UI 文言と `aria-label`:
  - ハンクのボタン: 表示 `このハンクを取り消す`、`aria-label` は固定で `このハンクを取り消す`（ステージボタンと同じく、実行中は `disabled` で表す）
  - 一括のボタン: 表示 `すべて取り消す`（実行中は `取り消し中...`）、`aria-label` は `変更をすべて取り消す`（実行中は `変更を取り消し中`）。タップ領域は 32px 以上
  - ハンクのボタンは、未ステージの diff で、対象が追跡済みの変更ファイル（未追跡・intent-to-add・コンフリクトでない）のときだけ出す。結合 diff では出さない。打ち切り表示中は、そのハンクの一部が表示されていないとき出さない（ステージボタンと同じ規則）
- 排他: ハンクは既存の `runHunkOperation`（パスのロック）。一括は `lockGlobal`。busy の判定は `useGitStashOperations` と同じ（自分の busy ref + `lock.isAnyLocked()` + リポジトリの有無）
- 既存テストが依存する取り消しの挙動（`discardFileChanges` の分類・文言）は変えない。

## File Structure

| ファイル                                                                                             | 責務                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/main/gitPathParsing.ts`（変更）                                                                 | `toLiteralPathspec`（`gitService.ts` から移動）、`parseNulSeparatedPaths`、`parseUnstagedStatusPaths`（新規）  |
| `src/main/gitDiscardService.ts`（新規）                                                              | 取り消しの実行（`discardFileChanges` / `discardHunk` / `discardAllChanges` / `applyDiscard`）                  |
| `src/main/gitDiscardClassifier.ts`（新規。実装後に分離）                                             | 取り消しの分類（`classifyDiscardTarget`、`assertDiscardable`）。`gitDiscardService.ts` は実行だけ              |
| `src/main/gitHunkPatch.ts`（新規。実装後に追加）                                                     | パッチ構造の許可リスト検証、モード行の取り除き、引用符つきパスのデコード                                       |
| `src/main/gitApply.ts`（変更）                                                                       | `runGitApply` が stdout を返す、`discardHunkPatch`（作業ツリーへの逆適用）、`listPatchPaths`（`--numstat -z`） |
| `src/main/handlers/gitHandlers.ts`（変更）                                                           | IPC `git:discardHunk` / `git:discardAll`                                                                       |
| `src/renderer/src/lib/discardConfirmMessage.ts`（変更）                                              | ハンク・一括の確認文言                                                                                         |
| `src/renderer/src/hooks/useDiffOperations.ts`（変更）                                                | `discardHunk` と `canDiscardHunk`                                                                              |
| `src/renderer/src/hooks/useDiscardHunk.ts`（新規）                                                   | ハンクの確認 → 取り消し → 再読込                                                                               |
| `src/renderer/src/hooks/useDiscardAllChanges.ts`（新規）                                             | 一括の確認 → ロック → 取り消し → 再読込                                                                        |
| `DiffView.tsx` / `ChangesSection.tsx`（変更）                                                        | ボタン                                                                                                         |
| `EditorPanel.tsx` / `App.tsx` / `Sidebar.tsx` / `SourceControlPanel.tsx` / `GitRepoView.tsx`（変更） | props の配線                                                                                                   |

---

### Task 1: 取り消しの分類と実行を `gitDiscardService.ts` へ移す（挙動を変えない）

**Files:**

- Create: `src/main/gitDiscardService.ts`
- Create: `src/main/__tests__/gitDiscardService.test.ts`
- Rename: `src/main/__tests__/gitService.discard.integration.test.ts` → `src/main/__tests__/gitDiscardService.integration.test.ts`（`mv`）
- Modify: `src/main/gitPathParsing.ts`, `src/main/gitService.ts`, `src/main/handlers/gitHandlers.ts`, `src/main/__tests__/gitService.test.ts`, `src/main/__tests__/handlers/gitHandlers.test.ts`

**Interfaces:**

- Produces（`gitDiscardService.ts`）:
  - `export async function discardFileChanges(folderPath: string, filePath: string, trash: (absolutePath: string) => Promise<void>): Promise<void>`（既存と同じ）
  - `export type DiscardTargetKind = 'conflicted' | 'untracked' | 'unknown' | 'intent-to-add' | 'overlaps-untracked' | 'tracked'`
  - `export async function classifyDiscardTarget(git: SimpleGit, filePath: string, pathspec: string): Promise<DiscardTargetKind>`
  - `export async function applyDiscard(git: SimpleGit, folderPath: string, kind: Exclude<DiscardTargetKind, 'conflicted' | 'unknown' | 'overlaps-untracked'>, filePath: string, trash: ...): Promise<void>` — 状態ごとの手段（`tracked` は `restore --worktree`、`untracked` はゴミ箱、`intent-to-add` は `rm --cached` → ゴミ箱）。`discardFileChanges` の `switch` の実行部分を切り出したもの。拒否の分岐（conflicted / unknown / overlaps-untracked）は `discardFileChanges` に残す
- Produces（`gitPathParsing.ts`）: `export function toLiteralPathspec(filePath: string): string`（`gitService.ts` の同名の非公開関数を移す。`stageFile` / `unstageFile` は import して使う）
- Consumes: `parseNulSeparatedPaths`（`gitPathParsing.ts`）

- [ ] **Step 1: `toLiteralPathspec` を `gitPathParsing.ts` へ移す**

`src/main/gitService.ts` の `toLiteralPathspec`（コメントごと）を `src/main/gitPathParsing.ts` に移して `export` し、`gitService.ts` は import する。`gitPathParsing.test.ts` に、既存の `gitService.test.ts` で固定されている挙動（`:(literal)` 接頭辞）を確認するテストが無ければ追加する。

```bash
npx vitest run src/main/__tests__/gitPathParsing.test.ts src/main/__tests__/gitService.test.ts
```

Expected: PASS

- [ ] **Step 2: 取り消しのコードを `gitDiscardService.ts` へ移す**

`gitService.ts` から次をコメントごと `gitDiscardService.ts` へ移す: `DiscardTargetKind`、`overlapsUntracked`、`isUntracked`、`classifyDiscardTarget`、`discardFileChanges`。`classifyDiscardTarget` と `DiscardTargetKind` は `export` する。`discardFileChanges` の `switch (await classifyDiscardTarget(...))` のうち、`tracked` / `untracked` / `intent-to-add` の実行部分を `applyDiscard` に切り出す（拒否の 3 分岐はそのまま残す）。`moveToTrash` の補助関数は `applyDiscard` の中に置く。`gitService.ts` は取り消しを再エクスポートしない。`gitService.ts` に残る import（`join` など）で未使用になったものは削除する。

`src/main/handlers/gitHandlers.ts` の `discardFileChanges` の import 先を `../gitDiscardService` に変える。`gitHandlers.test.ts` のモックも同様に分ける。

- [ ] **Step 3: テストを移す**

`gitService.test.ts` の `describe('discardFileChanges', ...)`（`classifyDiscardTarget` の各分類のテストを含む）を `gitDiscardService.test.ts` へ移す（`simple-git` のモックの作りは `gitService.test.ts` 先頭を参照して同じ形で用意する）。統合テストを `mv` で `gitDiscardService.integration.test.ts` に改名し、import 先と冒頭コメントを直す。

```bash
npx vitest run src/main
```

Expected: PASS（移設前後でテスト件数が減っていないこと。`npx vitest run src/main 2>&1 | tail -4` の件数を移設前と比べる）

- [ ] **Step 4: 検証**

```bash
npm run typecheck
npx eslint src/main/gitDiscardService.ts src/main/gitService.ts src/main/gitPathParsing.ts src/main/handlers/gitHandlers.ts
npx prettier --check src/main/gitDiscardService.ts src/main/gitService.ts src/main/gitPathParsing.ts src/main/__tests__/gitDiscardService.test.ts
```

Expected: すべて成功

- [ ] **Step 5: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 2: `discardHunk`（main）

**Files:**

- Modify: `src/main/gitApply.ts`, `src/main/gitDiscardService.ts`
- Test: `src/main/__tests__/gitApply.test.ts`, `src/main/__tests__/gitDiscardService.test.ts`, `src/main/__tests__/gitDiscardService.integration.test.ts`

**Interfaces:**

- Consumes: `classifyDiscardTarget`、`toLiteralPathspec`（Task 1）
- Produces:
  - `gitApply.ts`: `runGitApply(...)` が `Promise<string>`（stdout。上限 64KB）を返す。`export function discardHunkPatch(folderPath: string, filePath: string, patch: string): Promise<void>`（`git apply --reverse --whitespace=nowarn --no-ignore-whitespace -`）。`export function listPatchPaths(folderPath: string, patch: string): Promise<string[]>`（`git apply --numstat -z -` の対象パス一覧）
  - `gitDiscardService.ts`: `export async function discardHunk(folderPath: string, filePath: string, patch: string): Promise<void>`

- [ ] **Step 1: `gitApply.ts` の失敗するテストを書く**

`gitApply.test.ts`（既存の `spawn` モックの作りに合わせる）に追加:

- `discardHunkPatch` が `['apply', '--reverse', '--whitespace=nowarn', '--no-ignore-whitespace', '-']` で `spawn` を呼ぶ（`--cached` を含まない）
- `listPatchPaths` が `['apply', '--numstat', '-z', '-']` で呼び、stdout `"1\t1\tf.txt\0"` から `['f.txt']` を返す。リネーム（`"0\t0\t\0old\0new\0"`）は `['old', 'new']`（空要素を除く 2 件）を返す。空の stdout は `[]`
- `runGitApply` が stdout を文字列で返す（既存のテストの期待は変えない）

```bash
npx vitest run src/main/__tests__/gitApply.test.ts
```

Expected: FAIL

- [ ] **Step 2: `gitApply.ts` を実装する**

`runGitApply` の stdout の読み捨て（`proc.stdout.on('data', () => {})`）を、`StringDecoder` で上限（`MAX_STDERR_BYTES` と同じ 64KB、バイト数の累計で判定）まで蓄積して resolve する形に変える（戻り値を `Promise<string>` にする。既存の呼び出し元は戻り値を使わないので影響しない。stdout を読み続けるため、パイプが満杯でブロックしない点を維持するコメントを残す）。

```ts
export function discardHunkPatch(
  folderPath: string,
  filePath: string,
  patch: string
): Promise<void> {
  return runGitApply(
    folderPath,
    filePath,
    ['apply', '--reverse', '--whitespace=nowarn', '--no-ignore-whitespace', '-'],
    patch
  ).then(() => undefined)
}

// パッチが触るパスの一覧。--numstat -z は出力が NUL 区切りで、通常は `<追加>\t<削除>\t<パス>\0`、
// リネーム・コピーは `<追加>\t<削除>\t\0<旧>\0<新>\0` になる。ファイルは書き換えない
export async function listPatchPaths(folderPath: string, patch: string): Promise<string[]> {
  const output = await runGitApply(folderPath, '(patch)', ['apply', '--numstat', '-z', '-'], patch)
  return output
    .split('\0')
    .filter((token) => token !== '')
    .map((token) => token.replace(/^\d+\t\d+\t|^-\t-\t/, ''))
    .filter((path) => path !== '')
}
```

`runHunkApply`（ステージ / アンステージ）と共通の引数 `['--whitespace=nowarn', '--no-ignore-whitespace', '-']` は 1 つの定数にまとめ、3 か所が同じ定数を使うようにする。

```bash
npx vitest run src/main/__tests__/gitApply.test.ts
```

Expected: PASS

- [ ] **Step 3: `discardHunk` の失敗するテストを書く（単体、モック）**

`gitDiscardService.test.ts` に `describe('discardHunk')` を追加（`classifyDiscardTarget` の判定を左右するモックの作りは既存の `discardFileChanges` のテストに合わせる）。`gitApply` は `vi.mock('../gitApply')` で `discardHunkPatch` / `listPatchPaths` をモックする:

- `tracked` のとき、`listPatchPaths` が `['f.txt']` なら `discardHunkPatch(folder, 'f.txt', patch)` を呼ぶ
- `conflicted` → `コンフリクト中のファイルは取り消せません: f.txt`、`discardHunkPatch` を呼ばない
- `untracked` / `intent-to-add` → `ゴミ箱へ移す対象のため、ハンクでは取り消せません: f.txt`（`it.each`）
- `unknown` → `状態を判定できないため取り消せません: f.txt`
- `overlaps-untracked` → `未追跡のファイルと重なるため取り消せません: f.txt`
- `listPatchPaths` が `['other.txt']`（別ファイル）、`['f.txt', 'g.txt']`（複数）、`[]`（空）のとき → `パッチの対象がファイルと一致しません`、`discardHunkPatch` を呼ばない（`it.each`）
- 検証の順序: 分類で拒否したら `listPatchPaths` を呼ばない
- `discardHunkPatch` が reject したとき → `ハンクを取り消せませんでした。ファイルが変更された可能性があります。diff を開き直してください`、`cause` が元のエラー

```bash
npx vitest run src/main/__tests__/gitDiscardService.test.ts -t "discardHunk"
```

Expected: FAIL

- [ ] **Step 4: `discardHunk` を実装する**

```ts
export async function discardHunk(
  folderPath: string,
  filePath: string,
  patch: string
): Promise<void> {
  const git = simpleGit(folderPath)
  switch (await classifyDiscardTarget(git, filePath, toLiteralPathspec(filePath))) {
    case 'conflicted':
      throw new Error(`コンフリクト中のファイルは取り消せません: ${filePath}`)
    case 'untracked':
    case 'intent-to-add':
      throw new Error(`ゴミ箱へ移す対象のため、ハンクでは取り消せません: ${filePath}`)
    case 'unknown':
      throw new Error(`状態を判定できないため取り消せません: ${filePath}`)
    case 'overlaps-untracked':
      throw new Error(`未追跡のファイルと重なるため取り消せません: ${filePath}`)
    case 'tracked':
      break
  }
  // IPC の境界で届いた任意のパッチが、対象以外のファイルを書き換えないようにする
  const targets = await listPatchPaths(folderPath, patch)
  if (targets.length !== 1 || targets[0] !== filePath) {
    throw new Error('パッチの対象がファイルと一致しません')
  }
  try {
    await discardHunkPatch(folderPath, filePath, patch)
  } catch (error) {
    throw new Error(
      'ハンクを取り消せませんでした。ファイルが変更された可能性があります。diff を開き直してください',
      { cause: error }
    )
  }
}
```

（`listPatchPaths` 自体が失敗した場合（壊れたパッチ）は、そのまま伝播させず、同じ `パッチの対象がファイルと一致しません` に変換する。変換のテストも Step 3 に足す。）

```bash
npx vitest run src/main/__tests__/gitDiscardService.test.ts
```

Expected: PASS

- [ ] **Step 5: 実 git の統合テストを書く（`gitDiscardService.integration.test.ts`）**

既存の統合テストの隔離の仕組み（`isolatedGitEnv` など）に合わせて、次を追加する。パッチは `git diff -- <file>` の出力から、ヘッダー + 指定したハンクだけを組み立てる補助関数で作る（renderer の `buildHunkPatch` と同じ形）:

- 40 行のファイルを 2 か所変更（2 ハンク）→ 2 番目のハンクだけ取り消す → 1 番目の変更は残り、2 番目は戻る。ステージ済みの別の変更は残る（`git diff --cached` が変わらない）
- ファイルが diff 取得後にさらに変更されていると、`ハンクを取り消せませんでした…` で失敗し、ファイルの内容は変わらない
- 作業ツリーで削除されたファイルのハンクで、ファイルが復元される
- `core.autocrlf=true` の CRLF ファイルで、改行コードを保ったまま戻る
- 未追跡 / intent-to-add / コンフリクト中のファイルは拒否され、ファイルが変わらない
- 別のファイルを対象にしたパッチ（`filePath` と違う）は `パッチの対象がファイルと一致しません` で拒否され、どちらのファイルも変わらない

```bash
npx vitest run src/main/__tests__/gitDiscardService.integration.test.ts
```

Expected: PASS

- [ ] **Step 6: ミューテーションで確認する**

`cp` で退避 → 変異 → テストが落ちる → 復元 → `cmp`（`git stash` / `git checkout` は使わない。退避先は `mktemp -d`）: (1) `discardHunkPatch` の引数に `--cached` を足す、(2) `targets.length !== 1` の検査を外す、(3) 分類の検査を外す（`tracked` 以外も通す）、(4) `--reverse` を外す。それぞれ該当のテストが落ちること。

- [ ] **Step 7: 検証**

```bash
npx vitest run src/main
npm run typecheck
npx eslint src/main/gitApply.ts src/main/gitDiscardService.ts
npx prettier --check src/main/gitApply.ts src/main/gitDiscardService.ts src/main/__tests__/gitApply.test.ts src/main/__tests__/gitDiscardService.test.ts src/main/__tests__/gitDiscardService.integration.test.ts
```

Expected: すべて成功

- [ ] **Step 8: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 3: `discardAllChanges`（main）

**Files:**

- Modify: `src/main/gitPathParsing.ts`, `src/main/gitDiscardService.ts`
- Test: `src/main/__tests__/gitPathParsing.test.ts`, `src/main/__tests__/gitDiscardService.test.ts`, `src/main/__tests__/gitDiscardService.integration.test.ts`

**Interfaces:**

- Consumes: `classifyDiscardTarget` / `applyDiscard` / `DiscardTargetKind`（Task 1）
- Produces:
  - `gitPathParsing.ts`: `export function parseUnstagedStatusPaths(output: string): string[]` — `git status --porcelain -z --untracked-files=all` の出力から、作業ツリー側に変更がある（`workingDir !== ' '`）または未追跡（`??`）のエントリのパスを、出力の順に返す。ステージ済みのリネーム・コピー（`R`/`C`）は、直後の元のパスの要素を読み飛ばす。パスの末尾の `/`（ネストした git リポジトリ）は削る
  - `gitDiscardService.ts`: `export async function discardAllChanges(folderPath: string, expectedCount: number, trash: (absolutePath: string) => Promise<void>): Promise<void>`

- [ ] **Step 1: `parseUnstagedStatusPaths` の失敗するテストを書く**

`gitPathParsing.test.ts` に追加:

- `" M a.txt\0"` → `['a.txt']`
- `"M  a.txt\0"`（ステージ済みのみ）→ `[]`
- `"MM a.txt\0"` → `['a.txt']`（ステージ済み + 作業ツリー）
- `"?? n.txt\0"` → `['n.txt']`
- `"UU c.txt\0"` / `"AA c.txt\0"` → 含まれる（コンフリクトも対象）
- `" D d.txt\0"` → `['d.txt']`
- `"R  new.txt\0old.txt\0 M b.txt\0"` → `['b.txt']`（リネームの旧パス `old.txt` を別エントリとして誤読しない）
- `"RM new.txt\0old.txt\0"` → `['new.txt']`（旧パスは含まない）
- `"?? sub/\0"` → `['sub']`（末尾の `/` を削る）
- 日本語・空白・改行を含むパスがそのまま返る
- 空文字 → `[]`

```bash
npx vitest run src/main/__tests__/gitPathParsing.test.ts
```

Expected: FAIL

- [ ] **Step 2: `parseUnstagedStatusPaths` を実装する**

```ts
export function parseUnstagedStatusPaths(output: string): string[] {
  const tokens = output.split('\0')
  const paths: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.length < 4) continue
    const index = token[0]
    const workingDir = token[1]
    // リネーム・コピーは直後の要素が元のパス。別のエントリとして読まない
    if (index === 'R' || index === 'C') i++
    if (workingDir === ' ' && index !== '?') continue
    paths.push(token.slice(3).replace(/\/$/, ''))
  }
  return paths
}
```

（`index === '?'` のとき `workingDir` も `'?'` なので 1 つ目の条件は通る。実装後、上のテストが通ること。）

```bash
npx vitest run src/main/__tests__/gitPathParsing.test.ts
```

Expected: PASS

- [ ] **Step 3: `discardAllChanges` の失敗するテストを書く（単体、モック）**

`gitDiscardService.test.ts` に `describe('discardAllChanges')` を追加。`git.raw` のモックで `status` の出力と各分類の問い合わせを返す（`classifyDiscardTarget` を直接モックするため、`vi.spyOn` が使えない場合はモジュールの構成に合わせて分類の `raw` 応答を用意する）:

- 件数が `expectedCount` と違う → `変更の状態が変わったため取り消しを中止しました。もう一度操作してください`、`restore` もゴミ箱も呼ばない
- 1 件が `conflicted` → `取り消せないファイルがあるため、何も取り消しませんでした（c.txt）`、`restore` もゴミ箱も呼ばない
- `conflicted` / `unknown` / `overlaps-untracked` が混ざっても、パスの列挙は最大 5 件で、超えた分は `ほか <n> 件`（7 件で `…、p5、ほか 2 件）`）
- 追跡済み 2 件 + 未追跡 1 件 + intent-to-add 1 件 → 追跡済みは `restore --worktree`（リテラル pathspec）、未追跡と intent-to-add はゴミ箱（intent-to-add は先に `rm --cached`）が、すべて実行される
- ゴミ箱への移動が 2 件目で失敗 → `一括の取り消しが途中で失敗しました（1 / 3 件を取り消し済み）: ゴミ箱へ移動できませんでした: b.txt`、3 件目は実行しない
- 対象が 0 件で `expectedCount` も 0 → 何もせず成功（ゴミ箱も `restore` も呼ばない）
- `status` の引数が `['status', '--porcelain', '-z', '--untracked-files=all']`
- 検証の順序: 件数の不一致で拒否したら、分類の問い合わせ（`ls-files`）を呼ばない

```bash
npx vitest run src/main/__tests__/gitDiscardService.test.ts -t "discardAllChanges"
```

Expected: FAIL

- [ ] **Step 4: `discardAllChanges` を実装する**

```ts
const MAX_LISTED_PATHS = 5

function listPathsForMessage(paths: string[]): string {
  const shown = paths.slice(0, MAX_LISTED_PATHS).join('、')
  const rest = paths.length - MAX_LISTED_PATHS
  return rest > 0 ? `${shown}、ほか ${rest} 件` : shown
}

export async function discardAllChanges(
  folderPath: string,
  expectedCount: number,
  trash: (absolutePath: string) => Promise<void>
): Promise<void> {
  const git = simpleGit(folderPath)
  // renderer が持つ一覧は信用せず、実行時の状態から対象を作り直す。確認ダイアログで見せた件数と
  // 違えば、見せていない取り消しを実行してしまうため中止する(位置や状態は確認と実行の間に変わる)
  const paths = parseUnstagedStatusPaths(
    await git.raw(['status', '--porcelain', '-z', '--untracked-files=all'])
  )
  if (paths.length !== expectedCount) {
    throw new Error('変更の状態が変わったため取り消しを中止しました。もう一度操作してください')
  }
  // 全ファイルを先に分類し、1 件でも取り消せなければ何も変えずに全体を拒否する
  const targets: { path: string; kind: DiscardTargetKind }[] = []
  for (const path of paths) {
    targets.push({ path, kind: await classifyDiscardTarget(git, path, toLiteralPathspec(path)) })
  }
  const blocked = targets.filter(
    (t) => t.kind === 'conflicted' || t.kind === 'unknown' || t.kind === 'overlaps-untracked'
  )
  if (blocked.length > 0) {
    throw new Error(
      `取り消せないファイルがあるため、何も取り消しませんでした（${listPathsForMessage(blocked.map((t) => t.path))}）`
    )
  }
  let done = 0
  for (const { path, kind } of targets) {
    try {
      await applyDiscard(git, folderPath, kind as ApplicableDiscardKind, path, trash)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `一括の取り消しが途中で失敗しました（${done} / ${targets.length} 件を取り消し済み）: ${reason}`,
        { cause: error }
      )
    }
    done++
  }
}
```

（`ApplicableDiscardKind` は Task 1 で `applyDiscard` が受ける型 `Exclude<DiscardTargetKind, 'conflicted' | 'unknown' | 'overlaps-untracked'>` に名前を付けて export したもの。`kind as` のキャストは、直前の `blocked` の検査で絞り込めているため。型ガード関数にして `as` を避けられるなら、そうする。）

```bash
npx vitest run src/main/__tests__/gitDiscardService.test.ts
```

Expected: PASS

- [ ] **Step 5: 実 git の統合テストを書く**

`gitDiscardService.integration.test.ts` に追加:

- 追跡済みの変更 + 未追跡 + intent-to-add の混在 → 追跡済みは index の内容へ戻り、未追跡と intent-to-add のファイルは `trash` に渡され（`trash` はスタブ。渡されたパスを記録）、ステージ済みの別ファイルの変更は残る
- ステージ済みと作業ツリーの両方に変更があるファイル → 作業ツリーの分だけが index の内容に戻り、`git diff --cached` は変わらない
- `expectedCount` が実際と違うと拒否し、何も変わらない
- コンフリクトのファイルが 1 件あると、他の追跡済みの変更も含めて何も変わらない（`trash` も呼ばれない）
- 変更が 0 件・`expectedCount` 0 で何も起きない

```bash
npx vitest run src/main/__tests__/gitDiscardService.integration.test.ts
```

Expected: PASS

- [ ] **Step 6: ミューテーションで確認する**

(1) 件数の検査を外す、(2) `blocked` の拒否を外す（先に実行してしまう）、(3) `parseUnstagedStatusPaths` の `R`/`C` の読み飛ばしを外す、(4) `done` を数えない（常に 0）。それぞれ該当のテストが落ちること（手順は Task 2 Step 6 と同じ）。

- [ ] **Step 7: 検証**

```bash
npx vitest run src/main
npm run typecheck
npx eslint src/main/gitDiscardService.ts src/main/gitPathParsing.ts
npx prettier --check src/main/gitDiscardService.ts src/main/gitPathParsing.ts src/main/__tests__/gitPathParsing.test.ts src/main/__tests__/gitDiscardService.test.ts src/main/__tests__/gitDiscardService.integration.test.ts
```

Expected: すべて成功

- [ ] **Step 8: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 4: IPC・preload・`gitApi`

**Files:**

- Modify: `src/main/handlers/gitHandlers.ts`, `src/preload/api.ts`, `src/preload/index.d.ts`, `src/renderer/src/lib/gitApi.ts`
- Test: `src/main/__tests__/handlers/gitHandlers.test.ts`, `src/preload/__tests__/api.test.ts`, `src/renderer/src/lib/__tests__/gitApi.test.ts`

**Interfaces:**

- Consumes: `discardHunk` / `discardAllChanges`（Task 2・3）、`resolveAndAssertStatusRelativePath`、`moveToTrash`
- Produces:
  - IPC `git:discardHunk`（引数 `filePath: unknown, patch: unknown`）、`git:discardAll`（引数 `expectedCount: unknown`）
  - preload: `discardHunk(filePath: string, patch: string): Promise<void>`、`discardAll(expectedCount: number): Promise<void>`
  - `gitApi.ts`: `discardHunk(filePath, patch)`、`discardAll(expectedCount)`

- [ ] **Step 1: ハンドラーの失敗するテストを書く**

`gitHandlers.test.ts`（既存の `git:discardChanges` のテストの作りに合わせる）:

- `git:discardHunk`: 許可フォルダが無いと拒否（型検証より先）。`patch` が文字列でないと `Invalid patch`。境界チェック後、リポジトリ相対パス（`resolveAndAssertStatusRelativePath`）と `patch` で `discardHunk(allowedFolder, relativePath, patch)` を呼ぶ。許可フォルダの外のパスは `Access denied`
- `git:discardAll`: 許可フォルダが無いと拒否。`expectedCount` が非負の整数でない（文字列・負数・小数・`NaN`）と `Invalid count`。有効なら `discardAllChanges(allowedFolder, expectedCount, moveToTrash)` を呼ぶ

```bash
npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts
```

Expected: FAIL

- [ ] **Step 2: ハンドラーを実装する**

`assertPatchArg(value: unknown): asserts value is string`（`Invalid patch`）、`assertCountArg(value: unknown): asserts value is number`（`Number.isInteger(value) && value >= 0`、`Invalid count`）を、既存の `assert*Arg` の並びに足す。`git:discardHunk` は `git:discardChanges` と同じく `resolveAndAssertStatusRelativePath` で相対パス化してから `discardHunk` を呼ぶ。`git:discardAll` は `discardAllChanges(allowedFolder, expectedCount, moveToTrash)`。

- [ ] **Step 3: preload / `gitApi` のテストを書いて実装する**

`api.test.ts` に、`discardHunk(filePath, patch)` が `ipcRenderer.invoke('git:discardHunk', filePath, patch)`、`discardAll(count)` が `invoke('git:discardAll', count)` を呼ぶテスト（既存の `discardChanges` のテストに合わせる）。`gitApi.test.ts` に素通しのテスト。`api.ts` / `index.d.ts` / `gitApi.ts` に実装する。

```bash
npx vitest run src/main/__tests__/handlers src/preload src/renderer/src/lib/__tests__/gitApi.test.ts
```

Expected: PASS

- [ ] **Step 4: 検証**

```bash
npm run typecheck
npx eslint src/main/handlers/gitHandlers.ts src/preload/api.ts src/preload/index.d.ts src/renderer/src/lib/gitApi.ts
npx prettier --check src/main/handlers/gitHandlers.ts src/preload/api.ts src/preload/index.d.ts src/renderer/src/lib/gitApi.ts
```

Expected: すべて成功

- [ ] **Step 5: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 5: renderer のフック（確認文言・`useDiffOperations`・`useDiscardHunk`・`useDiscardAllChanges`・`useAppState`）

**Files:**

- Modify: `src/renderer/src/lib/discardConfirmMessage.ts`, `src/renderer/src/hooks/useDiffOperations.ts`, `src/renderer/src/hooks/useAppState.ts`, `src/renderer/src/types.ts`
- Create: `src/renderer/src/hooks/useDiscardHunk.ts`, `src/renderer/src/hooks/useDiscardAllChanges.ts`
- Test: `src/renderer/src/lib/__tests__/discardConfirmMessage.test.ts`, `src/renderer/src/hooks/__tests__/useDiffOperations.test.ts`, `src/renderer/src/hooks/__tests__/useDiscardHunk.test.ts`, `src/renderer/src/hooks/__tests__/useDiscardAllChanges.test.ts`, `src/renderer/src/hooks/__tests__/useAppState.test.ts`

**Interfaces:**

- Consumes: `gitApi.discardHunk` / `discardAll`（Task 4）、`useRunExclusiveGitOperation`、`useFileOperationLock`、`runEditorSyncedOperation`、`movesToTrashOnDiscard`（`lib/discardTarget.ts`）、`isUnstagedFile` / `isUntrackedFile` / `isIntentToAddFile` / `isConflictedFile`（`lib/gitUtils.ts`）
- Produces:
  - `discardConfirmMessage.ts`: `buildDiscardHunkConfirmMessage({ path, hunkHeader, hasUnsavedEdits }): string`、`buildDiscardAllConfirmMessage({ count, trashCount }): string`
  - `useDiffOperations`: `discardHunk: (patch: string) => Promise<boolean>`（成功なら true。排他で弾かれた・失敗は false）、`canDiscardHunk: boolean`（開いている diff が未ステージで、対象が追跡済みの変更ファイルか）。`runHunkOperation` は `Promise<boolean>` を返すようにし、`stageHunk` / `unstageHunk` の公開型は `Promise<void>` のまま
  - `useDiscardHunk(options): (patch: string, hunkHeader: string) => Promise<void>`
  - `types.ts`: `DiscardAllState { isDiscarding: boolean; error: Error | null; onDiscardAll: () => Promise<void> }`
  - `useDiscardAllChanges(options): DiscardAllState`
  - `useAppState().discardHunk`（`(patch, hunkHeader) => Promise<void>`）、`useAppState().discardAll`（`DiscardAllState`）、`useDiffOperations` の `canDiscardHunk` を `useAppState` 経由で公開

- [ ] **Step 1: 確認文言の失敗するテストを書いて実装する**

`discardConfirmMessage.test.ts` に Global Constraints の文言を完全一致で固定する: ハンク（未保存の編集なし / あり）、一括（ゴミ箱なし / `trashCount` > 0）。実装:

```ts
export function buildDiscardHunkConfirmMessage({
  path,
  hunkHeader,
  hasUnsavedEdits
}: {
  path: string
  hunkHeader: string
  hasUnsavedEdits: boolean
}): string {
  const base = `${path} の次のハンクを取り消しますか？この操作は元に戻せません。\n\n${hunkHeader}`
  return hasUnsavedEdits ? `${base}\n\nエディタの未保存の編集も破棄されます。` : base
}

export function buildDiscardAllConfirmMessage({
  count,
  trashCount
}: {
  count: number
  trashCount: number
}): string {
  const base = `変更 ${count} 件を取り消しますか？この操作は元に戻せません。`
  return trashCount > 0
    ? `${base}\nうち ${trashCount} 件の未追跡ファイルはゴミ箱へ移動します。`
    : base
}
```

```bash
npx vitest run src/renderer/src/lib/__tests__/discardConfirmMessage.test.ts
```

Expected: PASS

- [ ] **Step 2: `useDiffOperations.discardHunk` の失敗するテストを書く**

`useDiffOperations.test.ts`（既存のハンク操作のテストの作りに合わせる）:

- `discardHunk(patch)` が `gitApi.discardHunk(activeDiffTab.path, patch)` を呼び、成功で `true`、diff を取り直す（`getDiff` が再度呼ばれる）
- 失敗（reject）で `false`、`diffError` に入り、diff を取り直す（`stageHunk` の失敗と同じ）
- 実行中は多重実行を弾く（2 回目が `false`、`gitApi.discardHunk` は 1 回）
- 他のパスのロック中（`lock.isAnyLocked()`）は `false`
- `canDiscardHunk`: 未ステージ + `' M'` で `true`。ステージ済み diff、未追跡（`??`）、intent-to-add（` A`）、コンフリクト（`UU`）、`activeFileStatus` が無い、`activeDiffTab` が `null` では `false`
- `stageHunk` / `unstageHunk` の既存の挙動が変わらない（既存テストが通る）

```bash
npx vitest run src/renderer/src/hooks/__tests__/useDiffOperations.test.ts
```

Expected: FAIL

- [ ] **Step 3: `useDiffOperations` を実装する**

`runHunkOperation` を `Promise<boolean>`（先頭のガードで弾いた・失敗は `false`、成功は `true`）にし、`stageHunk` / `unstageHunk` は戻り値を捨てて `Promise<void>` を保つ。`discardHunk` と `canDiscardHunk` を足す:

```ts
const canDiscardHunk =
  activeDiffTab !== null &&
  !activeDiffTab.staged &&
  activeFileStatus !== undefined &&
  !isUntrackedFile(activeFileStatus) &&
  !isIntentToAddFile(activeFileStatus) &&
  !isConflictedFile(activeFileStatus)

const discardHunk = (patch: string): Promise<boolean> => runHunkOperation(gitApi.discardHunk, patch)
```

`DiffOperationsState` の型にコメントつきで追加する（`discardHunk` は「確認は呼び出し元（useDiscardHunk）が行う」と書く）。

```bash
npx vitest run src/renderer/src/hooks/__tests__/useDiffOperations.test.ts
```

Expected: PASS

- [ ] **Step 4: `useDiscardHunk` の失敗するテストを書いて実装する**

`useDiscardHunk.test.ts`:

- 確認で拒否 → `discardHunk` を呼ばず、再読込もしない
- 確認文言が `buildDiscardHunkConfirmMessage`（パス・ハンクの見出し・未保存の編集の有無 = `hasDirtyTabAtOrInside(絶対パス)`）で作られる
- 成功 → `reloadOpenFile(絶対パス)` と `refreshTree()` が呼ばれる。`refreshTree` が reject しても例外にならない
- 失敗（`discardHunk` が `false`）→ 再読込もツリーの再読込もしない（パターン 20）
- `folderPath` が `null`、`activeDiffTabPath` が `null` → 何もしない（確認も出さない）

実装:

```ts
export interface DiscardHunkOptions {
  folderPath: string | null
  /** 開いている diff タブのリポジトリ相対パス(無ければ null) */
  activeDiffTabPath: string | null
  /** useDiffOperations.discardHunk。実行され成功したら true */
  discardHunk: (patch: string) => Promise<boolean>
  hasDirtyTabAtOrInside: (absolutePath: string) => boolean
  reloadOpenFile: (absolutePath: string) => Promise<void>
  /** useFileSystem.refreshTree。削除されたファイルの復元でツリーの構成が変わり得る */
  refreshTree: () => Promise<unknown>
  onConfirm?: (message: string) => boolean
}

// ハンクの取り消しを「確認 → 取り消し → 成功時だけタブを同期」の順で行う。
// 失敗・no-op のときに同期すると、取り消されていないファイルの未保存の編集がディスクの内容で
// 上書きされて失われるため、成功時だけ同期する(パターン 20)
export function useDiscardHunk({ ... , onConfirm = confirm }: DiscardHunkOptions) {
  return async (patch: string, hunkHeader: string): Promise<void> => {
    if (folderPath === null || activeDiffTabPath === null) return
    const absolutePath = joinPath(folderPath, activeDiffTabPath)
    const message = buildDiscardHunkConfirmMessage({
      path: activeDiffTabPath,
      hunkHeader,
      hasUnsavedEdits: hasDirtyTabAtOrInside(absolutePath)
    })
    if (!onConfirm(message)) return
    if (!(await discardHunk(patch))) return
    await reloadOpenFile(absolutePath)
    await refreshTree().catch(() => undefined)
  }
}
```

```bash
npx vitest run src/renderer/src/hooks/__tests__/useDiscardHunk.test.ts
```

Expected: PASS

- [ ] **Step 5: `useDiscardAllChanges` の失敗するテストを書く**

`useDiscardAllChanges.test.ts`（`useGitStashOperations.test.ts` の作り（`renderHook`、`useRunExclusiveGitOperation` を実物で使う、`useFileOperationLock` の差し替え）に合わせる）:

- `gitStatus.files` のうち `isUnstagedFile` の件数 N、`movesToTrashOnDiscard` の件数 M で `buildDiscardAllConfirmMessage({ count: N, trashCount: M })` の確認が出る
- 確認で拒否 → ロックを取らず、`gitApi.discardAll` を呼ばない
- 変更が 0 件 → 確認も出さず何もしない
- 承諾 → `confirmDiscardAnyDirty` の確認 → `lockGlobal` → `gitApi.discardAll(N)` → `unlockGlobal`（成功時・失敗時のどちらも解放される）→ `refreshGitStatus`
- `confirmDiscardAnyDirty` が拒否 → `gitApi.discardAll` を呼ばず、ロックも取らない
- 成功 → `reloadOpenFiles` と `refreshTree` が呼ばれる。失敗（`discardAll` が reject）→ `error` にエラー、再読込しない
- 多重実行: 実行中に再度呼んでも `gitApi.discardAll` は 1 回。実行中は `isDiscarding` が `true`
- 他の操作がロック中（`lock.isAnyLocked()`）、`gitStatus` が `null`（リポジトリ無し）→ 確認も出さずに何もしない
- 次の成功した実行で `error` が消える

```bash
npx vitest run src/renderer/src/hooks/__tests__/useDiscardAllChanges.test.ts
```

Expected: FAIL

- [ ] **Step 6: `useDiscardAllChanges` を実装する**

```ts
export interface DiscardAllChangesOptions {
  gitStatus: GitStatusResult | null
  refreshGitStatus: () => Promise<void>
  fileLock: FileOperationLock
  confirmDiscardAnyDirty: () => boolean
  reloadOpenFiles: () => Promise<void>
  refreshTree: () => Promise<unknown>
  onConfirm?: (message: string) => boolean
}

export function useDiscardAllChanges({ ..., onConfirm = confirm }: DiscardAllChangesOptions): DiscardAllState {
  const [isDiscarding, setIsDiscarding] = useState(false)
  const isRunningRef = useRef(false)
  const [error, setError] = useState<Error | null>(null)
  const runOperation = useRunExclusiveGitOperation(refreshGitStatus, setError)
  const isBusy = (): boolean =>
    isRunningRef.current || fileLock.isAnyLocked() || isGitOperationDisabled(gitStatus)

  const onDiscardAll = async (): Promise<void> => {
    const files = gitStatus?.files.filter(isUnstagedFile) ?? []
    if (files.length === 0 || isBusy()) return
    const trashCount = files.filter(movesToTrashOnDiscard).length
    if (!onConfirm(buildDiscardAllConfirmMessage({ count: files.length, trashCount }))) return
    await runEditorSyncedOperation({
      confirmDiscardAnyDirty,
      reloadOpenFiles,
      operation: async () => {
        const succeeded = await runOperation({
          isBusy,
          setBusy: (busy) => {
            isRunningRef.current = busy
            setIsDiscarding(busy)
          },
          onStart: fileLock.lockGlobal,
          onEnd: fileLock.unlockGlobal,
          execute: () => gitApi.discardAll(files.length)
        })
        if (succeeded) await refreshTree().catch(() => undefined)
        return succeeded
      }
    })
  }
  return { isDiscarding, error, onDiscardAll }
}
```

（`useRunExclusiveGitOperation` の実際のシグネチャ（`useGitStashOperations.ts` の使い方）に合わせて引数名を直す。確認 → ロックの順序を保ち、確認を拒否したときにロックを取らないこと。）

```bash
npx vitest run src/renderer/src/hooks/__tests__/useDiscardAllChanges.test.ts
```

Expected: PASS

- [ ] **Step 7: `useAppState` に組み立てる**

`useAppState.ts` で、`useDiscardHunk` と `useDiscardAllChanges` を、`useStashPanel` と同じく依存を渡して 1 呼び出しずつ置き、`discardHunk` / `discardAll` / `canDiscardHunk` を返す（`AppState` の型にコメントつきで追加）。`useAppState.test.ts` に、2 つのフックが依存つきで呼ばれ、戻り値が公開されることのテストを足す（子フックは `vi.mock` で差し替える。既存の `useStashPanel` のモックの作りに合わせる）。

```bash
npx vitest run src/renderer/src/hooks
```

Expected: PASS

- [ ] **Step 8: ミューテーションで確認する**

(1) `useDiscardHunk` の成功判定を外して常に再読込する、(2) `useDiscardAllChanges` の `unlockGlobal` を外す、(3) 確認の拒否後もロックを取る、(4) `canDiscardHunk` から `isIntentToAddFile` の条件を外す、(5) `runHunkOperation` が失敗でも `true` を返す。それぞれ該当のテストが落ちること。

- [ ] **Step 9: 検証**

```bash
npx vitest run src/renderer
npm run typecheck
npx eslint src/renderer/src/hooks/useDiscardHunk.ts src/renderer/src/hooks/useDiscardAllChanges.ts src/renderer/src/hooks/useDiffOperations.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/lib/discardConfirmMessage.ts src/renderer/src/types.ts
npx prettier --check <変更・新規のファイル>
```

Expected: すべて成功

- [ ] **Step 10: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 6: UI（`DiffView`・`ChangesSection`）と配線・CSS

**Files:**

- Modify: `src/renderer/src/components/source-control/DiffView.tsx`, `ChangesSection.tsx`, `GitRepoView.tsx`, `SourceControlPanel.tsx`, `src/renderer/src/components/Sidebar.tsx`, `EditorPanel.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/assets/main.css`
- Test: `DiffView.test.tsx`, `ChangesSection.test.tsx`, `GitRepoView.test.tsx`, `SourceControlPanel.test.tsx`, `Sidebar.test.tsx`, `EditorPanel.test.tsx`（既存のテストの fixture を、新しい props に合わせて更新する）

**Interfaces:**

- Consumes: `useAppState().discardHunk` / `discardAll` / `canDiscardHunk`（Task 5）、`DiscardAllState`（`types.ts`）
- Produces:
  - `DiffView` の props: `onDiscardHunk?: (patch: string, hunkHeader: string) => void`、`canDiscardHunk?: boolean`（既定 `false`）
  - `ChangesSection` の props: `discardAll?: DiscardAllState`
  - `EditorPanel` の props: `onDiscardHunk` / `canDiscardHunk`。`GitRepoView` / `SourceControlPanel` / `Sidebar` の props: `discardAll: DiscardAllState`

- [ ] **Step 1: `DiffView` の失敗するテストを書く**

`DiffView.test.tsx` に追加:

- `canDiscardHunk` が真、未ステージ、`onDiscardHunk` あり → 各ハンクに `このハンクを取り消す` のボタンが出る。クリックで `onDiscardHunk(patch, hunk.header)` が呼ばれる（`patch` は `buildHunkPatch(parsed, index)` と同じ）
- `canDiscardHunk` が偽、`staged` が真、`isUntracked` が真、結合 diff、`onDiscardHunk` が無い → 出ない
- 打ち切り表示中で、一部が表示されていないハンクには出ない（表示されているハンクには出る）
- `disabled` のとき押せない
- 実行中の表示（`aria-label` は `このハンクを取り消す` のまま。`disabled` で表す。実行中の文言は `useDiffOperations` の実行中状態が `disabled` になるだけなので、ここでは `disabled` を確認）
- 複数ハンクで、押したハンクのパッチだけが渡る

```bash
npx vitest run src/renderer/src/components/source-control/__tests__/DiffView.test.tsx
```

Expected: FAIL

- [ ] **Step 2: `DiffView` を実装する**

ステージ / アンステージのボタンと同じ表示条件（`!parsed.isCombined && (isUntracked || !(isTruncated && visibleLinesByHunk[index].length < hunk.lines.length))`）の中に、`canDiscardHunk && !staged && onDiscardHunk !== undefined` のときだけ、隣に取り消しのボタンを置く:

```tsx
<button
  type="button"
  className="diff-view__hunk-action-btn diff-view__hunk-action-btn--danger"
  aria-label="このハンクを取り消す"
  disabled={disabled}
  onClick={() => onDiscardHunk(buildHunkPatch(parsed, index), hunk.header)}
>
  このハンクを取り消す
</button>
```

（ステージボタンの条件式を変数にまとめ、2 つのボタンが同じ条件を共有するようにする。`isUntracked` のときは `canDiscardHunk` が偽なので取り消しは出ない。）

```bash
npx vitest run src/renderer/src/components/source-control/__tests__/DiffView.test.tsx
```

Expected: PASS

- [ ] **Step 3: `ChangesSection` の失敗するテストを書いて実装する**

`ChangesSection.test.tsx`:

- `discardAll` あり → 見出し行に `すべて取り消す` のボタン（`aria-label="変更をすべて取り消す"`）が出る。クリックで `discardAll.onDiscardAll` が呼ばれる
- `discardAll` が無い → 出ない（既存のテストが壊れない）
- `discardAll.isDiscarding` → 表示が `取り消し中...`、`aria-label` が `変更を取り消し中`、ボタンが disabled
- 他の操作中（`stagingPaths.size > 0` / `isAnyLocked()`）→ disabled
- `discardAll.error` があれば `<p role="alert">` にメッセージが出る。無ければ出ない
- 変更が 0 件ならセクションごと出ない（既存の挙動）

実装: 見出しを `<div className="changes-section__header">` で包み、`<h3>` の隣にボタン、見出しの下にエラーを置く。

```bash
npx vitest run src/renderer/src/components/source-control/__tests__/ChangesSection.test.tsx
```

Expected: PASS

- [ ] **Step 4: 配線する**

`discardAll` を `App.tsx` → `Sidebar` → `SourceControlPanel` → `GitRepoView` → `ChangesSection` へ、`onDiscardHunk` / `canDiscardHunk` を `App.tsx` → `EditorPanel` → `DiffView` へ渡す。props の増え方に注意し、`discardAll` は 1 つのオブジェクトで渡す。`grep -rn "onMergeBranch" src/renderer/src` と `grep -rn "stash" src/renderer/src/components` で既存の配線の全箇所を洗い出し、`discardAll` が同じ箇所すべてにあること（本番の 4 段、テストの fixture）を確認する。`App.tsx` では `onDiscardHunk={discardHunk}` `canDiscardHunk={canDiscardHunk}`。既存のテストの fixture（`GitRepoView.test.tsx` の `baseProps`、`SourceControlPanel.test.tsx`、`Sidebar.test.tsx`、`EditorPanel.test.tsx` など）に新しい props を足し、配線を確認するテスト（`discardAll` が `ChangesSection` まで届く、`onDiscardHunk` が `DiffView` まで届く）を `GitRepoView.test.tsx` と `EditorPanel.test.tsx` に追加する。

```bash
npx vitest run src/renderer
npm run typecheck
```

Expected: PASS

- [ ] **Step 5: CSS を足す**

`main.css` に、`.changes-section__header`（見出しとボタンを横に並べる）、`.diff-view__hunk-action-btn--danger`（取り消しボタンの色。既存の削除系のボタン（`.stash-section__action--danger` など）のダークテーマの配色に合わせる）、「すべて取り消す」のボタン（タップ領域 32px 以上、既存のセクションのボタン（`.stash-section__push` など）の寸法に合わせる）を足す。既存のクラスを書き換えない。

- [ ] **Step 6: ミューテーションで確認する**

(1) `DiffView` で `staged` の条件を外す、(2) `canDiscardHunk` の条件を外す、(3) `ChangesSection` の `isAnyLocked()` の条件を外す、(4) `discardAll` を `GitRepoView` で渡し忘れる。それぞれ該当のテストが落ちること。

- [ ] **Step 7: 検証**

```bash
npm test
npm run typecheck
{ git diff --name-only; git ls-files --others --exclude-standard; } | grep -E '\.tsx?$' | xargs npx eslint
{ git diff --name-only; git ls-files --others --exclude-standard; } | xargs npx prettier --check
git status -s --untracked-files=all
```

Expected: すべて成功。`git status` に、この機能に関係ないファイルや一時ファイルが無いこと

- [ ] **Step 8: Commit（ユーザーの許可がある場合のみ。SDD 中は飛ばす）**

---

### Task 7: ROADMAP と全体検証

**Files:**

- Modify: `ROADMAP.md`

- [ ] **Step 1: ROADMAP を更新する**

- 「実装済み機能 > ソース管理（Git 操作）」の stash の行の後に追加する:

```md
- [x] 変更の取り消しの拡張（diff タブの未ステージのハンクの取り消しと、「変更」セクションの「すべて取り消す」。
      ハンクは追跡済みの変更ファイルの作業ツリーだけを逆適用し、ステージ済みの内容は残す。一括は実行時の状態から対象を
      作り直し、確認時の件数と違えば中止、取り消せないファイルが 1 件でもあれば何もしない。未追跡はゴミ箱へ移動する）
```

- 「今後実装した方がよい機能 > ソース管理（Git）」から `- [ ] 変更の取り消しの拡張（ハンク単位・一括取り消し。ファイル単位は実装済み）` を削除する
- 「改善・技術的負債」の見送りの並びに `[ ]` で追記する（隣の項目と同じ書式）:
  - `ステージ済みのハンクの直接の取り消し・行単位の取り消し`
  - `ハンクの取り消しとエディタでの保存（Cmd+S）の競合（ブランチ切り替え・退避と同じ種類。パッチが古くなれば失敗して何も変えない）`
  - `ステージ / アンステージのハンク操作（stageHunk / unstageHunk）はパッチの対象が対象ファイルだけであることを確認していない（取り消しでは numstat で確認している。同じ確認を揃える）`

```bash
npx prettier --check ROADMAP.md
```

- [ ] **Step 2: 全体を検証する**

```bash
npm test
npm run typecheck
{ git diff --name-only; git ls-files --others --exclude-standard; } | grep -E '\.tsx?$' | xargs npx eslint
{ git diff --name-only; git ls-files --others --exclude-standard; } | xargs npx prettier --check
git status -s --untracked-files=all
```

Expected: すべて成功。`git status` に、この機能に関係ないファイルや一時ファイルが無いこと

- [ ] **Step 3: 実機確認**

実機確認は `docs/manual-test-spec.md` の `DSC-001` 以降（変更の取り消しの拡張の領域）に移した。ユーザーがまとめて行う。

- [ ] **Step 4: Commit（ユーザーの許可がある場合のみ）**

## Self-Review

**Spec coverage:**

- ハンクの取り消し（未ステージ・追跡済みのみ、作業ツリーだけ、パッチ対象の確認、古いパッチの失敗）: Task 2・5・6
- 一括取り消し（実行時に対象を作り直す、件数チェック、先に全件分類、途中失敗の件数、ステージ済みは触らない）: Task 3・5・6
- 確認文言・未保存の編集の扱い・成功時だけ再読込（パターン 20）: Task 5
- 排他（ハンクは `runHunkOperation`、一括は `lockGlobal`）・実行中の表示・`aria-label`: Task 5・6
- IPC の引数検証（型、境界チェック）: Task 4
- 取り消しの分類と実行の共有（`gitDiscardService.ts`）: Task 1
- 既知の制約と見送り: Task 7（ROADMAP）

**Placeholder scan:** TBD / TODO なし。各コード手順に実コードまたは、既存の同種コードを参照する具体的な指示（ファイル名つき）を載せた。

**Type consistency:** `DiscardTargetKind` / `classifyDiscardTarget` / `applyDiscard`（Task 1）→ `discardHunk`（Task 2）・`discardAllChanges`（Task 3）→ IPC `git:discardHunk` / `git:discardAll`（Task 4）→ `gitApi.discardHunk(filePath, patch)` / `discardAll(expectedCount)` → `useDiffOperations.discardHunk(patch): Promise<boolean>` → `useDiscardHunk` の `(patch, hunkHeader) => Promise<void>` → `DiffView.onDiscardHunk(patch, hunkHeader)`（Task 5・6）。`DiscardAllState`（`types.ts`）は `useDiscardAllChanges` が作り、`ChangesSection` が `discardAll` として受け取る。
