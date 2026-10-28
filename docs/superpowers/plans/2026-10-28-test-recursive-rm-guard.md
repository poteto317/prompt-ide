# テストの再帰削除をすべてガード経由にそろえる 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テストのコード（テストのファイルとテストの補助）の再帰削除 50 か所を、一時ディレクトリの中だけを消すガード（`removeTempPathSync`・新しい `removeTempPath`）にすべて通し、後から書くテストが素の再帰削除に戻らないよう ESLint の `no-restricted-syntax` で機械的に止める。アプリの挙動は変えない。

**Architecture:** ガード `tempDirGuard.ts` を main と renderer の両方の tsconfig に入る `src/shared/__tests__/helpers/` へ移し、非同期版 `removeTempPath` を足す。テストの素の `rmSync(…, { recursive: true … })`・`await rm(…, { recursive: true … })` を、検証済みの Python のスクリプトで行を指定して置き換える。置き換えが全部終わってから、テストのファイルだけにかかる ESLint の規則を足し、実際の `eslint.config.mjs` を読む規則のテストで globs・除外まで確かめる。

**Tech Stack:** TypeScript, Node の `node:fs`・`node:fs/promises`・`node:os`, Vitest 4, ESLint 9.39.4（flat config・`ESLint` クラスの `lintText`）, Python 3（置き換えのスクリプト）

**設計書:** `docs/superpowers/specs/2026-10-28-test-recursive-rm-guard-design.md`（承認済み。実装の前に必ず読む）。このプランは設計書の「実装の分割」の 1〜5 を、そのまま Task 1〜5 に割り当てた（Task 2 と 3 の境界だけ、下の「計画の時点で設計書から調整した細部」のとおりファイル単位に引き直した）。各タスクで読む節はタスクの冒頭に書いた。書き方の参考は `docs/superpowers/plans/2026-10-26-agent-cli-copilot-hooks.md`。

**実装の前に読むもの:** `$DEV_FLOW_KIT/lessons/review-lessons.md` の「優先度 A のチェックリスト」（CLAUDE.md の「実装前の確認」）と、L-618 の本文（460 行付近）。今回の変更に関係する項目は本文も読む。

**反映する知見（dev-flow-kit の `lessons/review-lessons.md`）:** 設計書の「気をつける知見」の L-618・L-002・L-004・L-014・L-609（各タスクの冒頭の「気をつける知見」に、そのタスクで効くものを書いた）

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
>
> - **Task 2 と 3 の境界（ファイル単位にした）:** 設計書の「実装の分割」は、場所の種類（後始末か操作か）で 41 か所・9 か所に分けている。そのままだと `agentChangesUndo.test.ts`・`gitDiscardService.integration.test.ts`・`gitTagService.integration.test.ts` が 2 つのタスクにまたがり、Task 2 の終わりに「触ったファイルの再帰削除がすべてガードを通っている」状態にならない（下の「安全の手順」を満たせない）。そこで、テストの操作を含む 4 ファイル（上の 3 つと `agentBaselineSnapshot.integration.test.ts`）は、後始末の行も含めてファイルごと Task 3 に移した。**Task 2 は 28 ファイル・35 か所、Task 3 は 6 ファイル・15 か所**（操作 7・同じ 4 ファイルの後始末 6・非同期 1・renderer 1）。合計 50 か所は変わらない（設計書も「2 と 3 の境界は件数で分けただけで、依存の向きは無い」としている）
> - **`git mv` の代わりに `mv`:** CLAUDE.md の「コミットはユーザーの指示まで」に合わせ、インデックスを変える `git mv`・`git add` は使わない。`mv` で移し、git の改名の検出は commit-ja の `git add` の時点に任せる。移した新しいファイルは未追跡なので、grep の対象の一覧は `git ls-files` に `git ls-files --others --exclude-standard` を足して作る（下の「素の再帰削除の grep」）
> - **ガードのテストの import:** 設計書の「13 ファイル」のうちガードのテストは、ガードと同じフォルダへ一緒に移るので、相対の `./tempDirGuard` のままにする。`@shared/__tests__/helpers/tempDirGuard` に書き換えるのは残りの 12 ファイル
> - **`removeTempPath` のテストに存在するパスを渡さない（L-618）:** 設計書のテスト方針は `removeTempPath` に「.」・一時ディレクトリそのものを渡して reject を確かめるとしているが、どちらも存在するパスで、ガードが壊れていると作業ディレクトリ（リポジトリ）や一時ディレクトリの全体が消える。「.」・`tmpdir()`・`process.cwd()` は今のとおり `assertInsideTempDir` にだけ渡し（`removeTempPath` は同じ `assertInsideTempDir` を通るので、これで覆える）、`removeTempPath` の reject のテストは null・undefined・空・**存在しない**相対のパス・**存在しない**外のパス・**存在しない** `..` のパスで確かめる
> - **「実装を外すとテストが落ちる」の確かめ:** 設計書の `git stash push eslint.config.mjs` は使わず、手で外して手で戻す（Global Constraints）。ガードの `assertInsideTempDir(target)` を丸ごと外す変異は**しない**（「.」などを消す危険がある。L-618）。`removeTempPath` からは「一時ディレクトリの中」の確かめだけを外し（絶対パスの確かめは残す）、テストが存在しないパスしか渡さないことを確かめてから流す（Task 1 Step 8 の 3）
> - **テストの前の退避（プランのレビュー 1 回目の指摘）:** 各タスクでテストを流す前に、`git diff` のパッチと未追跡のファイルの写しを scratchpad の下のタスクごとのフォルダへ退避する（Global Constraints の安全の手順 6）
> - **ガードの単体テストの環境:** `src/shared` の下のテストは jsdom で走る（`vitest.config.ts` の `environmentMatchGlobs` は `src/main/**` だけを node にしている）ので、移したガードのテストと規則のテストの 1 行目に `// @vitest-environment node` を書く
> - **最後の grep の除外:** 規則のテスト `tempDirGuard.lint.test.ts` は、検出する・しないコードを文字列で並べるので、grep の正規表現に当たる。ガードの実装のファイルと並べて除外し、規則のテストの当たりは文字列のリテラルだけであることを別に確かめる
> - **既知の制約に足す（設計書レビューの推奨）:** 型の表明（`rmSync(dir, { recursive: true } as RmOptions)`・`… satisfies RmOptions`）は、引数が `ObjectExpression` ではなく `TSAsExpression`・`TSSatisfiesExpression` になるので、規則をすり抜ける。下の「既知の制約」に足し、`eslint.config.mjs` の規則のコメントにも書く（Task 4）

## Global Constraints

- コメント・文言は日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。`any` を使わない。テストの補助関数にも戻り値の型を書く
- **コミット・プッシュはしない**（CLAUDE.md。利用者の明示の指示があるまで行わない）。各タスクの最後の Step は「コミットしない（dev-flow の commit-ja でまとめてコミットする）」。`git add`・`git mv`・`git stash` もしない
- **アプリの挙動は変えない。** 変えるのはテストのファイル・テストの補助（`__tests__` の下）・`eslint.config.mjs` だけ。本番のコード（`src/main/*.ts` など、`__tests__` の外）の再帰削除は触らない
- **安全の手順（2026-10-26 にテストの `rmSync` でリポジトリが `.git` ごと消えた事故〈L-618〉の再発防止）:**
  1. 各タスクの冒頭の「安全の手順」を、そのタスクで最初に読む
  2. **置き換えの途中ではテストを流さない。** 置き換えのスクリプトを流し終え、prettier をかけ、下の grep で確かめるまで、`npx vitest` を 1 回も流さない
  3. **テストを流す前に**、そのタスクで触ったテストのファイルの再帰削除が、すべてガードを通っていることを grep で確かめる（各タスクの「安全の確かめ」の Step）。期待どおりでなければ、テストを流さずに止まって報告する
  4. 広い import の書き換えの後は、テストより先に `npm run typecheck` を流す
  5. ガードに存在するパス（「.」・`process.cwd()`・`tmpdir()`）を渡して消させるテスト・変異を書かない
  6. **テストを流す前に、作業をリポジトリの外へ退避する。** このプランはコミットも `git stash` もしないので、実装の作業と未追跡のプラン・設計書は作業ツリーにしか無い。各タスクで最初にテストを流す前（と、各タスクの指定の時点）に、`git diff` のパッチと未追跡のファイルの写しを、scratchpad（`$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad/`）の下のタスクごとのフォルダ `backup/<ラベル>/` に置く（`.git` の中に置くスナップショットは、リポジトリごと消えると一緒に失われるので使わない。scratchpad はリポジトリの外で、`os.tmpdir()`〈`/var/folders/…/T`〉の外でもあるので、ガードを通る削除にも巻き込まれない）。コマンドと戻し方は、各タスクの「退避」の手順に書いた
- **素の再帰削除の grep（以下「全体の grep」）。** 移したファイルが未追跡でも当たるよう、追跡中と未追跡の両方から対象を作り、ガードの実装と規則のテストの 2 ファイルを除く:

  ```sh
  cd <repo-root>
  { git ls-files; git ls-files --others --exclude-standard; } | sort -u \
    | grep -E '(__tests__/|\.test\.(ts|tsx|mjs)$)' \
    | while read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done \
    | xargs grep -nE '\b(rm|rmSync|rmdir|rmdirSync)\(.*recursive' \
    | grep -vE '^src/shared/__tests__/helpers/tempDirGuard(\.lint\.test)?\.ts:'
  ```

  期待の行数: 計画の時点（`b6519aa`）で **50**（このほかに、移す前のガードの実装 `src/main/__tests__/helpers/tempDirGuard.ts` の 2 行が当たる）、Task 1 の後で **50**、Task 2 の後で **15**、Task 3 の後で **0**

- 各タスクの終わりで次が通る状態を保つ: `npm run typecheck`・触ったテストのファイルの `npx vitest run <ファイル>`・変更・作成したファイルへの `npx eslint --max-warnings 0 <ファイル>` と `npx prettier --check <ファイル>`（L-609）。全体の `npx vitest run --reporter=dot` は Task 5 で流す
- **`npx prettier --write` は、変更したファイルを明示して実行する**（引数が空だとリポジトリ全体を整形してしまう）
- **このマシンは負荷が高く、`npx vitest run` の全体でテストが時間切れ（`Test timed out`・`waitFor` の打ち切り）で落ちることがある。** 落ちたら、落ちたファイルを `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書いて先へ進む。単体でも落ちれば本当の失敗として直す
- **シェルで `path` を変数名に使わない**（zsh では `path` が `PATH` と結び付いた配列で、代入すると `PATH` が壊れる）。**zsh では、変数に入れたファイル名の並びが単語に分かれない。** 複数のファイルは `set -- a.ts b.ts` と `"$@"` を使う。**シェルの変数は Bash の呼び出しをまたいで残らない。** コードブロックごとに先頭で設定し直す
- **日本語を含むファイルを Python で書き換えるときは、`# -*- coding: utf-8 -*-` 付きのスクリプトのファイルにして実行する**（`python3 -c` に日本語を書かない）。スクリプトは実行するエージェントのセッションの作業用の一時ディレクトリ（scratchpad。以下 `$S`。各コードブロックの先頭で `S=<scratchpad の絶対パス>` を設定し直す）に置く。`perl -pi` の置き換えは ASCII のパターンと ASCII の置き換え後の文字列だけで行う
- **「実装を外すとテストが落ちることの確かめ」は `git stash` を使わず、手で外して手で戻す。** 書いた実装の該当の行を一時的に元の形へ戻す（または消す）→ 該当のテストを流して落ちることを確かめる → 手で元に戻す → `git diff <ファイル>` か `grep` で戻したことを確かめ、テストが通ることを確かめ直す
- **`node:fs/promises` を `vi.mock` しているテスト**（`agentBaselineSnapshot.copyIndex.test.ts`・`agentChangesUndo.mocked.test.ts`・`gitCloneService.test.ts`・`settingsFileStore.atomic.test.ts`・`claudeHandlers.settingsFile.test.ts`・`settingsHandlers.apiKeyStatus.test.ts`）では、ガードの `removeTempPath` の `rm` も差し替えの後の関数になる。計画の時点で、どの差し替えも `...actual` を広げて `rm` を実物のまま残していることを確かめた。これらのファイルでは同期の `removeTempPathSync` だけを使う（今回の置き換えもそう）

### 設計書の決めたこと（要点）

| 項目               | 決定                                                                                                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ガードの置き場     | `src/shared/__tests__/helpers/tempDirGuard.ts`（main から移す。main に再 export の薄いファイルは残さない）。単体テストも `src/shared/__tests__/helpers/tempDirGuard.test.ts` へ移す。import は `@shared/__tests__/helpers/tempDirGuard`                                    |
| API                | `assertInsideTempDir(target: string \| null \| undefined): string`・`removeTempPathSync(target: string \| null \| undefined): void`（今のまま）。`removeTempPath(target: string \| null \| undefined): Promise<void>` を足す（`async` 関数。確かめの失敗も reject で返す） |
| ESLint の規則      | テストのファイルだけに `no-restricted-syntax` をかけ、`rm`・`rmSync`・`rmdir`・`rmdirSync` の呼び出しの引数のオブジェクトリテラルに `recursive` の欄があれば止める。ガードの実装のファイルだけを除外する。`no-restricted-imports` は使わない                               |
| 一律にガードを通す | mkdtemp の値をそのまま消す箇所も、テストの操作として消す箇所も、すべてガードに替える                                                                                                                                                                                       |
| try/finally        | 構造は変えず、finally の中の呼び出しだけを替える。ガードの例外を catch で握り潰さない（L-014）                                                                                                                                                                             |
| null の確かめ      | `if (dir !== null) rmSync(…)` の null の確かめは残す（L-002）                                                                                                                                                                                                              |
| `let dir: string`  | 初期値無しの宣言は書き換えない（推奨案で確定）                                                                                                                                                                                                                             |
| ROADMAP            | 更新しない（ROADMAP の項目ではない）                                                                                                                                                                                                                                       |
| 実機テスト仕様書   | 追記しない（アプリの挙動を変えないため）。HTML の再生成・Artifact の再公開もしない                                                                                                                                                                                         |

### 既知の制約（設計書の「既知の制約」に、設計書レビューの推奨を足したもの）

- **規則がすり抜ける形:** オプションを変数で渡す（`rmSync(dir, opts)`）、スプレッド（`{ ...opts }`）、別名の import（`import { rmSync as remove }`）、計算されたキー（`{ [key]: true }`）、**型の表明（`{ recursive: true } as RmOptions`・`{ recursive: true } satisfies RmOptions`。引数が `ObjectExpression` でなくなる）**は検出しない。今は 0 件。レビューと全体の grep で補う
- **`TMPDIR` がリポジトリの中を指す環境:** その下は消せる。CI・手元の既定の `TMPDIR` では起こらない
- **ガードは「一時ディレクトリの中」しか確かめない**（L-004）
- **finally の中のガードの例外は try の例外を置き換える**（L-014。受け入れる）
- **規則のテストは実際の設定を読むので数秒かかる**（時間の上限を 30 秒にする）

### 型・関数の名前（後のタスクはこの名前と型で使う）

- ガード（Task 1。`src/shared/__tests__/helpers/tempDirGuard.ts`）: `assertInsideTempDir(target: string | null | undefined): string`・`removeTempPathSync(target: string | null | undefined): void`・`removeTempPath(target: string | null | undefined): Promise<void>`。import は `import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'`（非同期は `removeTempPath`）
- 規則（Task 4。`eslint.config.mjs`）: 定数 `RECURSIVE_RM_MESSAGE`・`RECURSIVE_RM_OPTION`（セレクターの共通部分）。規則のテスト `src/shared/__tests__/helpers/tempDirGuard.lint.test.ts`

### ファイルの構成（作る・変えるもの）

| ファイル                                                                                                                                                    | 責務                                                     | タスク |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------ |
| `src/shared/__tests__/helpers/tempDirGuard.ts`（`src/main/__tests__/helpers/` から移す）・`src/shared/__tests__/helpers/tempDirGuard.test.ts`（同じく移す） | ガードと非同期版・その単体テスト                         | 1      |
| ガードを使っている 12 ファイル（Task 1 の Files）                                                                                                           | import の付け替え                                        | 1      |
| main のテスト 27 ファイルとテストの補助 `src/main/__tests__/helpers/realGitRepo.ts`（Task 2 の表）                                                          | 後始末の素の再帰削除の置き換え（35 か所）                | 2      |
| テストの操作を含む 4 ファイル・`agentSessionRecordFileIo.test.ts`・renderer の `copilotPromptSend.integration.test.ts`（Task 3 の表）                       | 操作・後始末・非同期・renderer の置き換え（15 か所）     | 3      |
| `eslint.config.mjs`・`src/shared/__tests__/helpers/tempDirGuard.lint.test.ts`（新規）                                                                       | テストの再帰削除を止める規則と、そのテスト               | 4      |
| なし（検証だけ）                                                                                                                                            | 全体の検証・grep・実機テスト仕様書に追記しないことの記録 | 5      |

---

### Task 1: ガードの移動と非同期版

> **設計書の読む節:** 「調べた結果」の「renderer 側のテストから main 側のガードを import できるか」、「決めたこと」の 1・2、「テストの方針」の「ガードの単体テスト」、「実装の分割」の 1。
>
> **気をつける知見:** L-618（ガードのテストで外のパスを確かめるときは存在しないパスを使う。`removeTempPath(Sync)` に「.」・`process.cwd()`・`tmpdir()` を渡さない。広い import の書き換えの後はテストより先に型検査）・L-609（ガードの移動と import の書き換えを同じタスクに入れる。分けると途中で型検査が落ちる）。
>
> **安全の手順（このタスクで最初に読む）:** このタスクで触るテストのファイルは、すでにガードを使っている 12 ファイルとガードのテストだけで、素の再帰削除は増やさない。`removeTempPath` の実装は、必ず `assertInsideTempDir(target)` の戻り値だけを `rm` に渡す形で書く（Step 5 のコードのまま）。テストを流すのは Step 4（`removeTempPath` がまだ無い状態。呼ぶと `TypeError` で何も消えない）と、Step 6 の安全の確かめの後だけ。どちらの前にも、作業をリポジトリの外へ退避する（Step 4 の冒頭と Step 6 の最後）。

**Files:**

- Move: `src/main/__tests__/helpers/tempDirGuard.ts` → `src/shared/__tests__/helpers/tempDirGuard.ts`（`removeTempPath` を足す）
- Move: `src/main/__tests__/helpers/tempDirGuard.test.ts` → `src/shared/__tests__/helpers/tempDirGuard.test.ts`（1 行目の環境の指定と `removeTempPath` のテストを足す）
- Modify（import の付け替えだけ）: 次の 12 ファイル
  - `src/main/__tests__/settingsFileStore.atomic.test.ts:99`（`'./helpers/tempDirGuard'`）
  - `src/main/__tests__/agentChangesQuery.integration.test.ts:23`（`'./helpers/tempDirGuard'`）
  - `src/main/__tests__/agentHookSettings.test.ts:27`（`'./helpers/tempDirGuard'`）
  - `src/main/__tests__/handlers/claudeHandlers.settingsFile.test.ts:47`（`'../helpers/tempDirGuard'`）
  - `src/main/__tests__/agentCommand.test.ts:12`（`'./helpers/tempDirGuard'`）
  - `src/main/__tests__/agentCliLaunch.integration.test.ts:48`（`'./helpers/tempDirGuard'`）
  - `src/main/__tests__/agentHooks.integration.test.ts:25`（`'./helpers/tempDirGuard'`）
  - `src/main/__tests__/agentCopilotHookPlugin.test.ts:26`（`'./helpers/tempDirGuard'`）
  - `src/main/__tests__/agentChangesRuns.integration.test.ts:13`（`'./helpers/tempDirGuard'`）
  - `src/main/__tests__/agentShellEnv.integration.test.ts:6`（`'./helpers/tempDirGuard'`）
  - `src/main/__tests__/handlers/settingsHandlers.apiKeyStatus.test.ts:45`（`'../helpers/tempDirGuard'`）
  - `src/main/__tests__/helpers/agentBaselineFixtures.ts:30`（`'./tempDirGuard'`）
- Test: `src/shared/__tests__/helpers/tempDirGuard.test.ts`

**Interfaces:**

- Consumes: なし
- Produces: `@shared/__tests__/helpers/tempDirGuard` の `assertInsideTempDir`・`removeTempPathSync`・`removeTempPath`（Task 2・3 の置き換えが使う。Task 4 の規則はこのファイルのパスを除外する）

- [ ] **Step 1: ガードとテストを移し、12 ファイルの import を付け替える**

```bash
cd <repo-root>
mkdir -p src/shared/__tests__/helpers
mv src/main/__tests__/helpers/tempDirGuard.ts src/shared/__tests__/helpers/tempDirGuard.ts
mv src/main/__tests__/helpers/tempDirGuard.test.ts src/shared/__tests__/helpers/tempDirGuard.test.ts
set -- src/main/__tests__/settingsFileStore.atomic.test.ts src/main/__tests__/agentChangesQuery.integration.test.ts src/main/__tests__/agentHookSettings.test.ts src/main/__tests__/handlers/claudeHandlers.settingsFile.test.ts src/main/__tests__/agentCommand.test.ts src/main/__tests__/agentCliLaunch.integration.test.ts src/main/__tests__/agentHooks.integration.test.ts src/main/__tests__/agentCopilotHookPlugin.test.ts src/main/__tests__/agentChangesRuns.integration.test.ts src/main/__tests__/agentShellEnv.integration.test.ts src/main/__tests__/handlers/settingsHandlers.apiKeyStatus.test.ts src/main/__tests__/helpers/agentBaselineFixtures.ts
perl -pi -e "s#from '(\./|\.\./)(helpers/)?tempDirGuard'#from '\@shared/__tests__/helpers/tempDirGuard'#" "$@"
grep -c "from '@shared/__tests__/helpers/tempDirGuard'" "$@"
grep -rn "tempDirGuard'" src | grep -v "from '@shared/__tests__/helpers/tempDirGuard'"
ls src/main/__tests__/helpers/tempDirGuard* 2>/dev/null || echo "main に残っていない"
```

Expected: 1 つ目の `grep -c` が 12 ファイルすべてで `1`。2 つ目の `grep` は `src/shared/__tests__/helpers/tempDirGuard.test.ts:5:import { assertInsideTempDir, removeTempPathSync } from './tempDirGuard'` の 1 行だけ（ガードのテストは同じフォルダへ一緒に移ったので相対のまま）。最後が `main に残っていない`（計画の時点で、この perl の置き換えを写しにかけて確かめた）

- [ ] **Step 2: 型検査を流す（広い import の書き換えの後、テストより先に。L-618）**

Run: `npm run typecheck`
Expected: エラーなし（`src/shared` は `tsconfig.node.json`・`tsconfig.web.json` の両方の `include` に入り、`@shared/*` は両方の `paths` と `vitest.config.ts` の `resolve.alias` にある）

- [ ] **Step 3: `removeTempPath` の失敗するテストを書く**

`src/shared/__tests__/helpers/tempDirGuard.test.ts` を次のように変える。

1 行目（`import { afterEach, … } from 'vitest'` の前）に次を足す（`src/shared` の下のテストは jsdom で走るため）:

```ts
// @vitest-environment node
```

`import { assertInsideTempDir, removeTempPathSync } from './tempDirGuard'` を次にする:

```ts
import { assertInsideTempDir, removeTempPath, removeTempPathSync } from './tempDirGuard'
```

ファイルの末尾に次を足す（既存の describe は変えない）:

```ts
describe('removeTempPath', () => {
  // ガードが壊れていても何も消えないよう、reject を確かめるパスはすべて存在しないパスにする。
  // 「.」・作業ディレクトリ・一時ディレクトリそのもの(存在するパス)は、同じ確かめを通る assertInsideTempDir のテストで確かめる(L-618)
  it('一時ディレクトリの中のディレクトリを中身ごと消し、親は残す', async () => {
    const dir = makeWorkDir()
    const target = join(dir, 'nested')
    mkdirSync(join(target, 'deep'), { recursive: true })
    writeFileSync(join(target, 'deep', 'file.txt'), 'x')
    await removeTempPath(target)
    expect(existsSync(target)).toBe(false)
    expect(existsSync(dir)).toBe(true)
  })

  it.each<[string, string | null | undefined]>([
    ['null', null],
    ['undefined', undefined],
    ['空のパス', ''],
    ['相対のパス(存在しない)', 'prompt-ide-temp-dir-guard-test-missing/x']
  ])('%s は呼んだ時点では投げず、返った Promise が reject する', async (_label, target) => {
    let pending: Promise<void> | undefined
    expect(() => {
      pending = removeTempPath(target)
    }).not.toThrow()
    await expect(pending).rejects.toThrow('一時ディレクトリの中の絶対パスではないので消しません')
  })

  it.each<[string, string]>([
    [
      '一時ディレクトリの外(存在しないパス)',
      resolve('/', 'prompt-ide-temp-dir-guard-test-missing')
    ],
    [
      '.. で一時ディレクトリの外に出るパス(存在しないパス)',
      join(tmpdir(), '..', 'prompt-ide-temp-dir-guard-test-missing')
    ]
  ])('%s は消さずに reject する', async (_label, target) => {
    await expect(removeTempPath(target)).rejects.toThrow('一時ディレクトリの外なので消しません')
  })

  it('一時ディレクトリの中の存在しないパスでは reject しない(force)', async () => {
    const dir = makeWorkDir()
    await expect(removeTempPath(join(dir, 'missing'))).resolves.toBeUndefined()
    expect(existsSync(dir)).toBe(true)
  })
})
```

- [ ] **Step 4: テストが落ちることを確かめる**

作業をリポジトリの外へ退避する（L-618。テストがリポジトリを消しても戻せるように）:

```bash
cd <repo-root>
B=$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad/backup/task1-red
mkdir -p "$B"
git rev-parse HEAD > "$B/base-commit.txt"
git diff --binary HEAD > "$B/changes.patch"
git ls-files --others --exclude-standard -z | tar -czf "$B/untracked.tgz" --null -T -
wc -c < "$B/changes.patch"
tar -tzf "$B/untracked.tgz"
```

Expected: `changes.patch` の大きさが 0 より大きく（task1-red の時点の変更が入っている）、`tar -tzf` がプラン・設計書と、この時点の新しいファイルを出す。戻し方（リポジトリの根で。リポジトリごと消えていたら、先に `git clone` し直してその根で）: `git checkout "$(cat "$B/base-commit.txt")" && git apply "$B/changes.patch" && tar -xzf "$B/untracked.tgz"`

Run: `npx vitest run src/shared/__tests__/helpers/tempDirGuard.test.ts`
Expected: FAIL（`removeTempPath` がまだ無く、呼ぶと `TypeError: … is not a function` で落ちる。既存の `assertInsideTempDir`・`removeTempPathSync` のテストは通る。何も消えない）

- [ ] **Step 5: `removeTempPath` を実装する（`src/shared/__tests__/helpers/tempDirGuard.ts`）**

import に `node:fs/promises` の `rm` を足す（`import { realpathSync, rmSync } from 'node:fs'` の次の行）:

```ts
import { rm } from 'node:fs/promises'
```

冒頭のコメントの 1 行目を次にする（2 行目の事故の説明はそのまま）:

```ts
// テストの再帰削除の安全装置(同期の removeTempPathSync・非同期の removeTempPath)。空・相対・一時ディレクトリ(os.tmpdir())の外のパスは消さずに投げる。
```

ファイルの末尾に次を足す:

```ts
/** 一時ディレクトリの中であることを確かめてから、再帰で消す(非同期)。確かめの失敗も、同期の throw ではなく reject で返す */
export async function removeTempPath(target: string | null | undefined): Promise<void> {
  await rm(assertInsideTempDir(target), { recursive: true, force: true })
}
```

- [ ] **Step 6: 安全の確かめ（テストを流す前に）**

```bash
cd <repo-root>
grep -nE '\b(rm|rmSync)\(' src/shared/__tests__/helpers/tempDirGuard.ts
set -- src/shared/__tests__/helpers/tempDirGuard.test.ts src/main/__tests__/settingsFileStore.atomic.test.ts src/main/__tests__/agentChangesQuery.integration.test.ts src/main/__tests__/agentHookSettings.test.ts src/main/__tests__/handlers/claudeHandlers.settingsFile.test.ts src/main/__tests__/agentCommand.test.ts src/main/__tests__/agentCliLaunch.integration.test.ts src/main/__tests__/agentHooks.integration.test.ts src/main/__tests__/agentCopilotHookPlugin.test.ts src/main/__tests__/agentChangesRuns.integration.test.ts src/main/__tests__/agentShellEnv.integration.test.ts src/main/__tests__/handlers/settingsHandlers.apiKeyStatus.test.ts src/main/__tests__/helpers/agentBaselineFixtures.ts
grep -nE '\b(rm|rmSync|rmdir|rmdirSync)\(.*recursive' "$@" || echo "素の再帰削除なし"
grep -nE "removeTempPath(Sync)?\((tmpdir\(\)|process\.cwd\(\)|'\.')" "$@" || echo "存在するパスを消させるテストなし"
```

Expected:

- 1 つ目の grep が、事故を説明するコメントの行と、`rmSync(assertInsideTempDir(target), { recursive: true, force: true })`・`await rm(assertInsideTempDir(target), { recursive: true, force: true })` の 2 行の計 3 行（`rm`・`rmSync` に渡すのは `assertInsideTempDir(target)` の戻り値だけ）
- `素の再帰削除なし`
- `存在するパスを消させるテストなし`

期待と違えば、テストを流さずに止まって報告する。期待どおりなら、続けて作業をリポジトリの外へ退避する（L-618。テストがリポジトリを消しても戻せるように）:

```bash
cd <repo-root>
B=$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad/backup/task1
mkdir -p "$B"
git rev-parse HEAD > "$B/base-commit.txt"
git diff --binary HEAD > "$B/changes.patch"
git ls-files --others --exclude-standard -z | tar -czf "$B/untracked.tgz" --null -T -
wc -c < "$B/changes.patch"
tar -tzf "$B/untracked.tgz"
```

Expected: `changes.patch` の大きさが 0 より大きく（task1 の時点の変更が入っている）、`tar -tzf` がプラン・設計書と、この時点の新しいファイルを出す。戻し方（リポジトリの根で。リポジトリごと消えていたら、先に `git clone` し直してその根で）: `git checkout "$(cat "$B/base-commit.txt")" && git apply "$B/changes.patch" && tar -xzf "$B/untracked.tgz"`

- [ ] **Step 7: テストと型検査が通ることを確かめる**

```bash
cd <repo-root>
npm run typecheck
npx vitest run src/shared/__tests__/helpers/tempDirGuard.test.ts
set -- src/main/__tests__/settingsFileStore.atomic.test.ts src/main/__tests__/agentChangesQuery.integration.test.ts src/main/__tests__/agentHookSettings.test.ts src/main/__tests__/handlers/claudeHandlers.settingsFile.test.ts src/main/__tests__/agentCommand.test.ts src/main/__tests__/agentCliLaunch.integration.test.ts src/main/__tests__/agentHooks.integration.test.ts src/main/__tests__/agentCopilotHookPlugin.test.ts src/main/__tests__/agentChangesRuns.integration.test.ts src/main/__tests__/agentShellEnv.integration.test.ts src/main/__tests__/handlers/settingsHandlers.apiKeyStatus.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts
npx vitest run "$@"
```

Expected: すべて PASS（`agentBaselineFixtures.ts` は補助なので、それを使う `agentBaselineFixtures.test.ts` を流す）

- [ ] **Step 8: 実装を外すとテストが落ちることを確かめる（手で外して手で戻す）**

ガードの `assertInsideTempDir(target)` を丸ごと外す変異はしない（相対のパス・「.」が `rm` に届く。L-618）。`removeTempPathSync` にも触れない。

1. `removeTempPath` の `async` を外し、本体を `return rm(assertInsideTempDir(target), { recursive: true, force: true })` にする（確かめの失敗が同期の throw になる）→ `npx vitest run src/shared/__tests__/helpers/tempDirGuard.test.ts` で「呼んだ時点では投げず、返った Promise が reject する」の 4 件が落ちる → 手で戻す
2. `removeTempPath` の `force: true` を `force: false` にする → 「一時ディレクトリの中の存在しないパスでは reject しない(force)」が落ちる → 手で戻す
3. `removeTempPath` から「一時ディレクトリの中」の確かめだけを外す（絶対パスの確かめは残し、相対のパス・null などは `rm` に届かない形にする）。先に、テストが `removeTempPath` に渡すパスが安全なことを確かめる:

   ```bash
   cd <repo-root>
   grep -n "removeTempPath(" src/shared/__tests__/helpers/tempDirGuard.test.ts
   ls -d /prompt-ide-temp-dir-guard-test-missing "$(dirname "$(node -p 'require("os").tmpdir()')")/prompt-ide-temp-dir-guard-test-missing" 2>&1 | grep -c 'No such file'
   ```

   Expected: `grep` の当たりは `removeTempPath(target)`（表の値。Step 3 の表は null・undefined・空・存在しない相対・存在しない外・存在しない `..` だけ）と、`makeWorkDir()` の下（`target`・`join(dir, 'missing')`）だけ。`ls` の行が `2`（外のパスはどちらも存在しない）。違えばこの変異はせずに報告する。

   確かめたら、`removeTempPath` の本体を次にする（`isAbsolute` はガードの import に既にある）:

   ```ts
   if (typeof target !== 'string' || !isAbsolute(target)) {
     throw new Error('一時ディレクトリの中の絶対パスではないので消しません')
   }
   await rm(target, { recursive: true, force: true })
   ```

   → `npx vitest run src/shared/__tests__/helpers/tempDirGuard.test.ts` で「一時ディレクトリの外(存在しないパス)」「.. で一時ディレクトリの外に出るパス(存在しないパス)」の 2 件が落ちる（どちらも存在しないパスなので、`force: true` の `rm` は何も消さずに終わる）→ 手で戻す

戻した後に `grep -n -A2 'export async function removeTempPath' src/shared/__tests__/helpers/tempDirGuard.ts` で Step 5 の形（本体が `await rm(assertInsideTempDir(target), { recursive: true, force: true })` の 1 行）であることを確かめ、`npx vitest run src/shared/__tests__/helpers/tempDirGuard.test.ts` が通ることを確かめ直す。

- [ ] **Step 9: lint と整形**

```bash
cd <repo-root>
set -- src/shared/__tests__/helpers/tempDirGuard.ts src/shared/__tests__/helpers/tempDirGuard.test.ts src/main/__tests__/settingsFileStore.atomic.test.ts src/main/__tests__/agentChangesQuery.integration.test.ts src/main/__tests__/agentHookSettings.test.ts src/main/__tests__/handlers/claudeHandlers.settingsFile.test.ts src/main/__tests__/agentCommand.test.ts src/main/__tests__/agentCliLaunch.integration.test.ts src/main/__tests__/agentHooks.integration.test.ts src/main/__tests__/agentCopilotHookPlugin.test.ts src/main/__tests__/agentChangesRuns.integration.test.ts src/main/__tests__/agentShellEnv.integration.test.ts src/main/__tests__/handlers/settingsHandlers.apiKeyStatus.test.ts src/main/__tests__/helpers/agentBaselineFixtures.ts
npx prettier --write "$@"
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
```

Expected: すべて通る。全体の grep（Global Constraints）が **50** 行

- [ ] **Step 10: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 2: main のテストの後始末の置き換え（28 ファイル・35 か所）

> **設計書の読む節:** 「調べた結果」の「パスの出どころ」「呼び出しの場所」、「置き換えの方針」（パターンごとの置き換え方・後始末の try/finally・mkdtemp の値をそのまま消している箇所）、「実装の分割」の 2。このプランの冒頭の「計画の時点で設計書から調整した細部」の 1 つ目（境界をファイル単位にした）。
>
> **気をつける知見:** L-618（置き換えの途中でテストを流さない。import の書き換えの後はテストより先に型検査）・L-002（`if (dir !== null)` の null の確かめは残す）・L-014（try/finally は構造を変えず、finally の中の呼び出しだけを替える。ガードの例外を catch で包まない）・L-609（使わなくなった `rmSync` の import を同じタスクで消す。`noUnusedLocals` で型検査が落ちる）。
>
> **安全の手順（このタスクで最初に読む）:** Step 1〜3（スクリプトの作成・実行・整形）の間は、テストを 1 回も流さない。Step 4 の安全の確かめで、表の 28 ファイルに素の再帰削除が 1 行も残っていないこと・全体の grep が 15 行（Task 3 の 6 ファイルの分だけ）であることを確かめてから、Step 5 でテストを流す。期待と違えば、テストを流さずに止まって報告する。スクリプトは、すべての置き換えが指定の行にちょうど 1 回当たることを確かめてから書き込むので、途中で止まっても半端な状態は残らない。

**Files（置き換えの全件。行は計画の時点〈`b6519aa`〉のもの。置き換えはすべて `rmSync(<引数>, { recursive: true, force: true })` → `removeTempPathSync(<引数>)`。行の残りの部分〈`if (dir !== null) `・`for (const dir of …) ` など〉は変えない）:**

| ファイル（`src/main/__tests__/` の下）              | 行                | `<引数>`                                       | 場所                                          | `rmSync` の import       |
| --------------------------------------------------- | ----------------- | ---------------------------------------------- | --------------------------------------------- | ------------------------ |
| `agentBaselineCoverage.test.ts`                     | 182               | `dir`                                          | afterEach                                     | 消す                     |
| `agentBaselineHiddenGit.integration.test.ts`        | 84                | `probe`                                        | try/finally                                   | 消す（複数行の import）  |
| `agentBaselineMode.test.ts`                         | 16                | `dir`（`if (dir !== null)`）                   | afterEach                                     | 消す                     |
| `agentBaselineSnapshot.copyIndex.test.ts`           | 28                | `dir`（`if (dir !== null)`）                   | afterEach                                     | 残す（51・61 行で使う）  |
| `agentBaselineSnapshot.test.ts`                     | 34・135           | `dir`（`if (dir !== null)`）                   | afterEach                                     | 消す                     |
| `agentBaselineTempSweep.integration.test.ts`        | 37                | `dir`（`for … of [tempRoot, outside]`）        | afterEach                                     | 消す（複数行の import）  |
| `agentChangesProtectionRef.integration.test.ts`     | 67                | `dir`（`for … of [noHooksDir, ...extraDirs]`） | afterEach                                     | 残す（111 行で使う）     |
| `agentChangesProtectionRef.test.ts`                 | 87・97            | `root`                                         | try/finally                                   | 消す                     |
| `agentChangesUndo.mocked.test.ts`                   | 69                | `root`                                         | afterEach                                     | 残す（167 行で使う）     |
| `agentSession.integration.test.ts`                  | 54                | `dir`                                          | afterEach                                     | 消す                     |
| `gitCloneProcess.test.ts`                           | 71                | `work`                                         | afterEach                                     | 消す（複数行の import）  |
| `gitCloneService.integration.test.ts`               | 116               | `work`                                         | afterEach                                     | 消す（複数行の import）  |
| `gitCloneService.test.ts`                           | 78                | `work`                                         | afterEach                                     | 消す（複数行の import）  |
| `gitConflictService.integration.test.ts`            | 85・639           | `repo`・`subSource`                            | afterEach                                     | 残す（280 行などで使う） |
| `gitRemoteSetupService.integration.test.ts`         | 57                | `root`                                         | afterEach                                     | 消す（複数行の import）  |
| `gitService.diff.integration.test.ts`               | 37                | `root`                                         | afterEach                                     | 消す                     |
| `gitService.merge.integration.test.ts`              | 73                | `repo`                                         | afterEach                                     | 残す（358 行で使う）     |
| `gitService.status.integration.test.ts`             | 36                | `root`                                         | afterEach                                     | 消す（`rmSync` が最後）  |
| `gitStashService.integration.test.ts`               | 32・213・373・449 | `repo`・`subSource`×3                          | afterEach（32・213）・try/finally（373・449） | 消す                     |
| `handlers/agentChangesHandlers.integration.test.ts` | 367               | `shaRepo`                                      | try/finally（`registry.close()` の後）        | 残す（485 行で使う）     |
| `handlers/agentChangesHandlers.test.ts`             | 131               | `folder`                                       | afterEach                                     | 消す                     |
| `handlers/externalChangeHandlers.fs.test.ts`        | 43                | `root`                                         | afterEach                                     | 消す（複数行の import）  |
| `handlers/gitPathResolver.test.ts`                  | 38                | `tempRoot`                                     | afterEach                                     | 消す                     |
| `helpers/agentBaselineFixtures.test.ts`             | 152               | `dir`（`for … of dirs.splice(0)`）             | afterEach                                     | 消す                     |
| `helpers/processProbe.test.ts`                      | 37                | `dir`（`for … of workDirs.splice(0)`）         | afterEach                                     | 消す                     |
| `helpers/realGitRepo.test.ts`                       | 24                | `dir`（`for … of workDirs.splice(0)`）         | afterEach                                     | 消す（`rmSync` が最後）  |
| `helpers/realGitRepo.ts`（テストの補助）            | 126・146          | `probe`                                        | try/finally                                   | 消す（複数行の import）  |
| `openFileWatcher.integration.test.ts`               | 29                | `dir`                                          | afterEach                                     | 消す                     |

各ファイルの `'fs'`・`'node:fs'` の import 文（`rmSync` を含むもの）の直後の行に `import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'` を足す。

**Interfaces:**

- Consumes: Task 1 の `removeTempPathSync`（`@shared/__tests__/helpers/tempDirGuard`）
- Produces: 表の 28 ファイルに素の再帰削除が無い状態（Task 4 の規則がこれらのファイルで落ちない前提）

- [ ] **Step 1: 置き換えのスクリプトを書く**

`$S/replace-recursive-rm-task2.py` に次をそのまま書く（Write ツールで。計画の時点で、`b6519aa` のテストのファイルの写しにかけて `ok: 28 ファイル` になり、置き換え後の写しで表の 28 ファイルの素の再帰削除が 0 行になることを確かめた）:

```python
# -*- coding: utf-8 -*-
# Task 2: main のテストの後始末の素の再帰削除(28 ファイル・35 か所)を removeTempPathSync に置き換える。
# 各置き換えは、指定した行にちょうど 1 回当たることを確かめる。当たらなければ何も書かずに止まる。
# 使い方: python3 replace-recursive-rm-task2.py <リポジトリの根>
import os
import re
import sys

root = sys.argv[1]
GUARD = "import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'"
FULL = ', { recursive: true, force: true })'

# ファイル: (rmSync の import を消すか〈drop〉残すか〈keep〉, [(行, rmSync の第 1 引数)])
EDITS = {
    'src/main/__tests__/agentBaselineCoverage.test.ts': ('drop', [(182, 'dir')]),
    'src/main/__tests__/agentBaselineHiddenGit.integration.test.ts': ('drop', [(84, 'probe')]),
    'src/main/__tests__/agentBaselineMode.test.ts': ('drop', [(16, 'dir')]),
    'src/main/__tests__/agentBaselineSnapshot.copyIndex.test.ts': ('keep', [(28, 'dir')]),
    'src/main/__tests__/agentBaselineSnapshot.test.ts': ('drop', [(34, 'dir'), (135, 'dir')]),
    'src/main/__tests__/agentBaselineTempSweep.integration.test.ts': ('drop', [(37, 'dir')]),
    'src/main/__tests__/agentChangesProtectionRef.integration.test.ts': ('keep', [(67, 'dir')]),
    'src/main/__tests__/agentChangesProtectionRef.test.ts': ('drop', [(87, 'root'), (97, 'root')]),
    'src/main/__tests__/agentChangesUndo.mocked.test.ts': ('keep', [(69, 'root')]),
    'src/main/__tests__/agentSession.integration.test.ts': ('drop', [(54, 'dir')]),
    'src/main/__tests__/gitCloneProcess.test.ts': ('drop', [(71, 'work')]),
    'src/main/__tests__/gitCloneService.integration.test.ts': ('drop', [(116, 'work')]),
    'src/main/__tests__/gitCloneService.test.ts': ('drop', [(78, 'work')]),
    'src/main/__tests__/gitConflictService.integration.test.ts': ('keep', [(85, 'repo'), (639, 'subSource')]),
    'src/main/__tests__/gitRemoteSetupService.integration.test.ts': ('drop', [(57, 'root')]),
    'src/main/__tests__/gitService.diff.integration.test.ts': ('drop', [(37, 'root')]),
    'src/main/__tests__/gitService.merge.integration.test.ts': ('keep', [(73, 'repo')]),
    'src/main/__tests__/gitService.status.integration.test.ts': ('drop', [(36, 'root')]),
    'src/main/__tests__/gitStashService.integration.test.ts': (
        'drop',
        [(32, 'repo'), (213, 'subSource'), (373, 'subSource'), (449, 'subSource')],
    ),
    'src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts': ('keep', [(367, 'shaRepo')]),
    'src/main/__tests__/handlers/agentChangesHandlers.test.ts': ('drop', [(131, 'folder')]),
    'src/main/__tests__/handlers/externalChangeHandlers.fs.test.ts': ('drop', [(43, 'root')]),
    'src/main/__tests__/handlers/gitPathResolver.test.ts': ('drop', [(38, 'tempRoot')]),
    'src/main/__tests__/helpers/agentBaselineFixtures.test.ts': ('drop', [(152, 'dir')]),
    'src/main/__tests__/helpers/processProbe.test.ts': ('drop', [(37, 'dir')]),
    'src/main/__tests__/helpers/realGitRepo.test.ts': ('drop', [(24, 'dir')]),
    'src/main/__tests__/helpers/realGitRepo.ts': ('drop', [(126, 'probe'), (146, 'probe')]),
    'src/main/__tests__/openFileWatcher.integration.test.ts': ('drop', [(29, 'dir')]),
}
assert len(EDITS) == 28 and sum(len(items) for _, items in EDITS.values()) == 35


def fs_import_range(lines):
    """rmSync を含む 'fs'・'node:fs' の import 文の(始まり, 終わり)の行の番号(0 始まり)"""
    for end, line in enumerate(lines):
        if re.search(r"from '(node:)?fs'$", line):
            start = end
            while not lines[start].startswith('import '):
                start -= 1
            if any(re.search(r'\brmSync\b', l) for l in lines[start : end + 1]):
                return start, end
    raise AssertionError('rmSync の fs の import が無い')


results = {}
for rel, (mode, items) in EDITS.items():
    text = open(os.path.join(root, rel), encoding='utf-8').read()
    assert 'tempDirGuard' not in text, f'{rel}: 既にガードを import している'
    lines = text.split('\n')
    for n, arg in items:
        old = f'rmSync({arg}{FULL}'
        assert lines[n - 1].count(old) == 1, f'{rel}:{n}: {lines[n - 1].strip()}'
        lines[n - 1] = lines[n - 1].replace(old, f'removeTempPathSync({arg})')
    start, end = fs_import_range(lines)
    if mode == 'drop':
        if start == end:
            before = lines[start]
            lines[start] = re.sub(r', rmSync \}', ' }', re.sub(r'\brmSync, ', '', before))
            assert lines[start] != before, f'{rel}: import から rmSync を消せない'
        else:
            hits = [i for i in range(start, end + 1) if lines[i] == '  rmSync,']
            assert len(hits) == 1, f'{rel}: 複数行の import の rmSync の行が {len(hits)} 行'
            del lines[hits[0]]
            end -= 1
    lines.insert(end + 1, GUARD)
    out = '\n'.join(lines)
    remaining = len(re.findall(r'\brmSync\b', out))
    if mode == 'drop':
        assert remaining == 0, f'{rel}: rmSync が {remaining} か所残る'
    else:
        assert remaining >= 2, f'{rel}: 残す rmSync が無い'
    assert not re.search(r'\b(rm|rmSync)\(.*recursive', out), f'{rel}: 素の再帰削除が残る'
    results[rel] = out

# すべて確かめてから書く(途中で止まったときに半端な状態を残さない)
for rel, out in results.items():
    open(os.path.join(root, rel), 'w', encoding='utf-8').write(out)
print(f'ok: {len(results)} ファイル')
```

- [ ] **Step 2: スクリプトを流す（テストは流さない）**

```bash
cd <repo-root>
S=<scratchpad の絶対パス>
python3 "$S/replace-recursive-rm-task2.py" <repo-root>
```

Expected: `ok: 28 ファイル`。`AssertionError` で止まったら、どのファイルも書き換わっていないので、当たらなかった行を `sed -n '<行>p' <ファイル>` で見て、計画の時点から行がずれていれば `EDITS` の行の番号だけを直して流し直す（置き換え前・後の形は変えない）

- [ ] **Step 3: 整形する（import の折り返しを直す）**

```bash
cd <repo-root>
set -- src/main/__tests__/agentBaselineCoverage.test.ts src/main/__tests__/agentBaselineHiddenGit.integration.test.ts src/main/__tests__/agentBaselineMode.test.ts src/main/__tests__/agentBaselineSnapshot.copyIndex.test.ts src/main/__tests__/agentBaselineSnapshot.test.ts src/main/__tests__/agentBaselineTempSweep.integration.test.ts src/main/__tests__/agentChangesProtectionRef.integration.test.ts src/main/__tests__/agentChangesProtectionRef.test.ts src/main/__tests__/agentChangesUndo.mocked.test.ts src/main/__tests__/agentSession.integration.test.ts src/main/__tests__/gitCloneProcess.test.ts src/main/__tests__/gitCloneService.integration.test.ts src/main/__tests__/gitCloneService.test.ts src/main/__tests__/gitConflictService.integration.test.ts src/main/__tests__/gitRemoteSetupService.integration.test.ts src/main/__tests__/gitService.diff.integration.test.ts src/main/__tests__/gitService.merge.integration.test.ts src/main/__tests__/gitService.status.integration.test.ts src/main/__tests__/gitStashService.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/externalChangeHandlers.fs.test.ts src/main/__tests__/handlers/gitPathResolver.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/helpers/processProbe.test.ts src/main/__tests__/helpers/realGitRepo.test.ts src/main/__tests__/helpers/realGitRepo.ts src/main/__tests__/openFileWatcher.integration.test.ts
npx prettier --write "$@"
```

Expected: 28 ファイルを整形する（複数行の import から `rmSync` を抜いた分の折り返しが直る）

- [ ] **Step 4: 安全の確かめ（テストを流す前に）**

```bash
cd <repo-root>
set -- src/main/__tests__/agentBaselineCoverage.test.ts src/main/__tests__/agentBaselineHiddenGit.integration.test.ts src/main/__tests__/agentBaselineMode.test.ts src/main/__tests__/agentBaselineSnapshot.copyIndex.test.ts src/main/__tests__/agentBaselineSnapshot.test.ts src/main/__tests__/agentBaselineTempSweep.integration.test.ts src/main/__tests__/agentChangesProtectionRef.integration.test.ts src/main/__tests__/agentChangesProtectionRef.test.ts src/main/__tests__/agentChangesUndo.mocked.test.ts src/main/__tests__/agentSession.integration.test.ts src/main/__tests__/gitCloneProcess.test.ts src/main/__tests__/gitCloneService.integration.test.ts src/main/__tests__/gitCloneService.test.ts src/main/__tests__/gitConflictService.integration.test.ts src/main/__tests__/gitRemoteSetupService.integration.test.ts src/main/__tests__/gitService.diff.integration.test.ts src/main/__tests__/gitService.merge.integration.test.ts src/main/__tests__/gitService.status.integration.test.ts src/main/__tests__/gitStashService.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/externalChangeHandlers.fs.test.ts src/main/__tests__/handlers/gitPathResolver.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/helpers/processProbe.test.ts src/main/__tests__/helpers/realGitRepo.test.ts src/main/__tests__/helpers/realGitRepo.ts src/main/__tests__/openFileWatcher.integration.test.ts
grep -nE '\b(rm|rmSync|rmdir|rmdirSync)\(.*recursive' "$@" || echo "素の再帰削除なし"
grep -oE 'removeTempPathSync\(' "$@" | wc -l
grep -L "from '@shared/__tests__/helpers/tempDirGuard'" "$@" || true
grep -nE 'removeTempPathSync\((dirname|.*\?\?)' "$@" || echo "dirname・?? を経たパスなし"
```

Expected:

- `素の再帰削除なし`
- `35`（`removeTempPathSync(` の呼び出しの数。import の行は `removeTempPathSync }` なので数えない）
- `grep -L` が何も出さない（28 ファイルすべてがガードを import している）
- `dirname・?? を経たパスなし`（L-618 の事故の形が無い）

続けて全体の grep（Global Constraints）を流し、**15** 行（Task 3 の 6 ファイル: `agentBaselineSnapshot.integration.test.ts` 3・`agentChangesUndo.test.ts` 2・`gitDiscardService.integration.test.ts` 4・`gitTagService.integration.test.ts` 4・`agentSessionRecordFileIo.test.ts` 1・`copilotPromptSend.integration.test.ts` 1）であることを確かめる。期待と違えば、テストを流さずに止まって報告する。期待どおりなら、続けて作業をリポジトリの外へ退避する（L-618。テストがリポジトリを消しても戻せるように）:

```bash
cd <repo-root>
B=$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad/backup/task2
mkdir -p "$B"
git rev-parse HEAD > "$B/base-commit.txt"
git diff --binary HEAD > "$B/changes.patch"
git ls-files --others --exclude-standard -z | tar -czf "$B/untracked.tgz" --null -T -
wc -c < "$B/changes.patch"
tar -tzf "$B/untracked.tgz"
```

Expected: `changes.patch` の大きさが 0 より大きく（task2 の時点の変更が入っている）、`tar -tzf` がプラン・設計書と、この時点の新しいファイルを出す。戻し方（リポジトリの根で。リポジトリごと消えていたら、先に `git clone` し直してその根で）: `git checkout "$(cat "$B/base-commit.txt")" && git apply "$B/changes.patch" && tar -xzf "$B/untracked.tgz"`

- [ ] **Step 5: 型検査、次にテストを流す**

```bash
cd <repo-root>
npm run typecheck
set -- src/main/__tests__/agentBaselineCoverage.test.ts src/main/__tests__/agentBaselineHiddenGit.integration.test.ts src/main/__tests__/agentBaselineMode.test.ts src/main/__tests__/agentBaselineSnapshot.copyIndex.test.ts src/main/__tests__/agentBaselineSnapshot.test.ts src/main/__tests__/agentBaselineTempSweep.integration.test.ts src/main/__tests__/agentChangesProtectionRef.integration.test.ts src/main/__tests__/agentChangesProtectionRef.test.ts src/main/__tests__/agentChangesUndo.mocked.test.ts src/main/__tests__/agentSession.integration.test.ts src/main/__tests__/gitCloneProcess.test.ts src/main/__tests__/gitCloneService.integration.test.ts src/main/__tests__/gitCloneService.test.ts src/main/__tests__/gitConflictService.integration.test.ts src/main/__tests__/gitRemoteSetupService.integration.test.ts src/main/__tests__/gitService.diff.integration.test.ts src/main/__tests__/gitService.merge.integration.test.ts src/main/__tests__/gitService.status.integration.test.ts src/main/__tests__/gitStashService.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/externalChangeHandlers.fs.test.ts src/main/__tests__/handlers/gitPathResolver.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/helpers/processProbe.test.ts src/main/__tests__/helpers/realGitRepo.test.ts src/main/__tests__/openFileWatcher.integration.test.ts
npx vitest run "$@"
```

Expected: 型検査はエラーなし（`noUnusedLocals` で `rmSync` の import の消し忘れ・消し過ぎを拾う）。テストはすべて PASS（`helpers/realGitRepo.ts` は補助なので、それを使う `realGitRepo.test.ts` を含めて流す。ほかに `realGitRepo.ts` を使うテストは Task 5 の全体で流す）。置き換えは振る舞いを変えないので、新しいテストは書かない（設計書「置き換えのテスト」）

- [ ] **Step 6: 置き換えが効いていることを確かめる（手で外して手で戻す）**

置き換えは振る舞いを変えないので、テストが落ちる変異は無い。代わりに、ガードが実際に呼ばれていることを 1 か所で確かめる（ガードの確かめを外す変異はしない。L-618）:

1. `src/shared/__tests__/helpers/tempDirGuard.ts` の `removeTempPathSync` の本体の先頭に `throw new Error('ガードを通った')` を足す → `npx vitest run src/main/__tests__/gitService.status.integration.test.ts` が afterEach の `ガードを通った` で落ちる（何も消えない）→ 手で戻す
2. `grep -c "ガードを通った" src/shared/__tests__/helpers/tempDirGuard.ts` が `0` であることで戻したことを確かめる（移したファイルは未追跡なので `git diff` では見えない）。`npx vitest run src/main/__tests__/gitService.status.integration.test.ts` が通ることを確かめ直す

- [ ] **Step 7: lint と整形の確かめ**

```bash
cd <repo-root>
set -- src/main/__tests__/agentBaselineCoverage.test.ts src/main/__tests__/agentBaselineHiddenGit.integration.test.ts src/main/__tests__/agentBaselineMode.test.ts src/main/__tests__/agentBaselineSnapshot.copyIndex.test.ts src/main/__tests__/agentBaselineSnapshot.test.ts src/main/__tests__/agentBaselineTempSweep.integration.test.ts src/main/__tests__/agentChangesProtectionRef.integration.test.ts src/main/__tests__/agentChangesProtectionRef.test.ts src/main/__tests__/agentChangesUndo.mocked.test.ts src/main/__tests__/agentSession.integration.test.ts src/main/__tests__/gitCloneProcess.test.ts src/main/__tests__/gitCloneService.integration.test.ts src/main/__tests__/gitCloneService.test.ts src/main/__tests__/gitConflictService.integration.test.ts src/main/__tests__/gitRemoteSetupService.integration.test.ts src/main/__tests__/gitService.diff.integration.test.ts src/main/__tests__/gitService.merge.integration.test.ts src/main/__tests__/gitService.status.integration.test.ts src/main/__tests__/gitStashService.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/externalChangeHandlers.fs.test.ts src/main/__tests__/handlers/gitPathResolver.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/helpers/processProbe.test.ts src/main/__tests__/helpers/realGitRepo.test.ts src/main/__tests__/helpers/realGitRepo.ts src/main/__tests__/openFileWatcher.integration.test.ts
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
```

Expected: すべて通る

- [ ] **Step 8: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 3: テストの操作・非同期・renderer の置き換え（6 ファイル・15 か所）

> **設計書の読む節:** 「調べた結果」の「パスの出どころ」（本番のコードが返した値の 2 か所）・「非同期の `rm`」・「renderer 側のテストから main 側のガードを import できるか」、「置き換えの方針」（`force` 無し・本番の値・`await rm` の行）、「実装の分割」の 3。このプランの冒頭の「計画の時点で設計書から調整した細部」の 1 つ目（操作を含む 4 ファイルは後始末の行もここで替える）。
>
> **気をつける知見:** L-618（本番のコードが返した値〈`first.tempDir`・`gitDir`〉は、欄の改名の途中で undefined になる危険の型。ガードが投げるようにする。置き換えの途中でテストを流さない）・L-002（`if (tempDir !== null)`・`if (dir !== null)` の null の確かめは残す）・L-609（使わなくなった `rmSync`・`rm` の import を同じタスクで消す）。
>
> **安全の手順（このタスクで最初に読む）:** Step 1〜3（スクリプトの作成・実行・整形）の間は、テストを 1 回も流さない。Step 4 の安全の確かめで、表の 6 ファイルに素の再帰削除が 1 行も残っていないこと・全体の grep が 0 行であることを確かめてから、Step 5 でテストを流す。期待と違えば、テストを流さずに止まって報告する。特に、テストの操作として消す 7 か所（`first.tempDir`・`join(repo, '.git')`・`gitDir`・`join(folder, 'sub')`・`join(repo, tracked.split('/')[0])`・`join(repo, 'foo')`・`repo`）は、テストの途中で走るので、ガードを通っていないまま流さない。

**Files（置き換えの全件。行は計画の時点〈`b6519aa`〉のもの）:**

| ファイル                                                               | 行   | 置き換え前                                                                            | 置き換え後                                              | 場所                                | import                              |
| ---------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------- | ----------------------------------- |
| `src/main/__tests__/agentBaselineSnapshot.integration.test.ts`         | 501  | `rmSync(first.tempDir, { recursive: true, force: true })`                             | `removeTempPathSync(first.tempDir)`                     | 操作（本番の値）                    | `rmSync` を消す（複数行）           |
|                                                                        | 816  | `rmSync(join(repo, '.git'), { recursive: true, force: true })`                        | `removeTempPathSync(join(repo, '.git'))`                | 操作                                |                                     |
|                                                                        | 1048 | `rmSync(gitDir, { recursive: true, force: true })`                                    | `removeTempPathSync(gitDir)`                            | 操作（本番の値。`gitDirOf(first)`） |                                     |
| `src/main/__tests__/agentChangesUndo.test.ts`                          | 61   | `rmSync(root, { recursive: true, force: true })`                                      | `removeTempPathSync(root)`                              | afterEach                           | `rmSync` を残す（656 行で使う）     |
|                                                                        | 464  | `rmSync(join(folder, 'sub'), { recursive: true })`                                    | `removeTempPathSync(join(folder, 'sub'))`               | 操作（`force` 無し）                |                                     |
| `src/main/__tests__/gitDiscardService.integration.test.ts`             | 46   | `rmSync(repo, { recursive: true, force: true })`                                      | `removeTempPathSync(repo)`                              | afterEach                           | `rmSync` を残す（120 行などで使う） |
|                                                                        | 47   | `rmSync(home, { recursive: true, force: true })`                                      | `removeTempPathSync(home)`                              | afterEach                           |                                     |
|                                                                        | 102  | `rmSync(join(repo, tracked.split('/')[0]), { recursive: true, force: true })`         | `removeTempPathSync(join(repo, tracked.split('/')[0]))` | 操作                                |                                     |
|                                                                        | 150  | `rmSync(join(repo, 'foo'), { recursive: true, force: true })`                         | `removeTempPathSync(join(repo, 'foo'))`                 | 操作                                |                                     |
| `src/main/__tests__/gitTagService.integration.test.ts`                 | 37   | `rmSync(probe, { recursive: true, force: true })`                                     | `removeTempPathSync(probe)`                             | try/finally                         | `rmSync` を消す（複数行）           |
|                                                                        | 78   | `rmSync(repo, { recursive: true, force: true })`                                      | `removeTempPathSync(repo)`                              | afterEach                           |                                     |
|                                                                        | 236  | `rmSync(repo, { recursive: true, force: true })`                                      | `removeTempPathSync(repo)`                              | 操作                                |                                     |
|                                                                        | 405  | `rmSync(scriptDir, { recursive: true, force: true })`                                 | `removeTempPathSync(scriptDir)`                         | afterEach                           |                                     |
| `src/main/__tests__/agentSessionRecordFileIo.test.ts`                  | 16   | `await rm(tempDir, { recursive: true, force: true })`（`if (tempDir !== null)` の後） | `await removeTempPath(tempDir)`                         | afterEach（非同期）                 | `node:fs/promises` の `rm` を消す   |
| `src/renderer/src/lib/__tests__/copilotPromptSend.integration.test.ts` | 106  | `rmSync(dir, { recursive: true, force: true })`（`if (dir !== null)` の後）           | `removeTempPathSync(dir)`                               | afterEach（renderer）               | `rmSync` を消す                     |

各ファイルの import 文（`agentSessionRecordFileIo.test.ts` は `node:fs/promises`、ほかは `'fs'`・`'node:fs'`）の直後の行に、`import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'`（`agentSessionRecordFileIo.test.ts` は `import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'`）を足す。renderer のテストは main を import せず、両方の tsconfig に入る `src/shared` の下のガードを使う（設計書の結論）。

**Interfaces:**

- Consumes: Task 1 の `removeTempPathSync`・`removeTempPath`（`@shared/__tests__/helpers/tempDirGuard`）
- Produces: テストのコードに素の再帰削除が 0 か所の状態（全体の grep が 0 行。Task 4 の規則を入れてもリポジトリ全体の lint が落ちない前提）

- [ ] **Step 1: 置き換えのスクリプトを書く**

`$S/replace-recursive-rm-task3.py` に次をそのまま書く（Write ツールで。計画の時点で、`b6519aa` のテストのファイルの写しに Task 2 のスクリプトの後でかけて `ok: 6 ファイル` になり、置き換え後の写しで全体の grep が 0 行になることを確かめた）:

```python
# -*- coding: utf-8 -*-
# Task 3: テストの操作を含む 4 ファイル・非同期・renderer の素の再帰削除(6 ファイル・15 か所)をガードに置き換える。
# 各置き換えは、指定した行にちょうど 1 回当たることを確かめる。当たらなければ何も書かずに止まる。
# 使い方: python3 replace-recursive-rm-task3.py <リポジトリの根>
import os
import re
import sys

root = sys.argv[1]
SYNC = "import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'"
ASYNC = "import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'"
FULL = ', { recursive: true, force: true })'

# ファイル: (import を消す名前〈None は残す〉, import の元のモジュールの正規表現, 足す import, [(行, 置き換え前, 置き換え後)])
EDITS = {
    'src/main/__tests__/agentBaselineSnapshot.integration.test.ts': (
        'rmSync',
        r"(node:)?fs",
        SYNC,
        [
            (501, f'rmSync(first.tempDir{FULL}', 'removeTempPathSync(first.tempDir)'),
            (816, f"rmSync(join(repo, '.git'){FULL}", "removeTempPathSync(join(repo, '.git'))"),
            (1048, f'rmSync(gitDir{FULL}', 'removeTempPathSync(gitDir)'),
        ],
    ),
    'src/main/__tests__/agentChangesUndo.test.ts': (
        None,
        r"(node:)?fs",
        SYNC,
        [
            (61, f'rmSync(root{FULL}', 'removeTempPathSync(root)'),
            (464, "rmSync(join(folder, 'sub'), { recursive: true })", "removeTempPathSync(join(folder, 'sub'))"),
        ],
    ),
    'src/main/__tests__/gitDiscardService.integration.test.ts': (
        None,
        r"(node:)?fs",
        SYNC,
        [
            (46, f'rmSync(repo{FULL}', 'removeTempPathSync(repo)'),
            (47, f'rmSync(home{FULL}', 'removeTempPathSync(home)'),
            (
                102,
                f"rmSync(join(repo, tracked.split('/')[0]){FULL}",
                "removeTempPathSync(join(repo, tracked.split('/')[0]))",
            ),
            (150, f"rmSync(join(repo, 'foo'){FULL}", "removeTempPathSync(join(repo, 'foo'))"),
        ],
    ),
    'src/main/__tests__/gitTagService.integration.test.ts': (
        'rmSync',
        r"(node:)?fs",
        SYNC,
        [
            (37, f'rmSync(probe{FULL}', 'removeTempPathSync(probe)'),
            (78, f'rmSync(repo{FULL}', 'removeTempPathSync(repo)'),
            (236, f'rmSync(repo{FULL}', 'removeTempPathSync(repo)'),
            (405, f'rmSync(scriptDir{FULL}', 'removeTempPathSync(scriptDir)'),
        ],
    ),
    'src/main/__tests__/agentSessionRecordFileIo.test.ts': (
        'rm',
        r"node:fs/promises",
        ASYNC,
        [(16, f'await rm(tempDir{FULL}', 'await removeTempPath(tempDir)')],
    ),
    'src/renderer/src/lib/__tests__/copilotPromptSend.integration.test.ts': (
        'rmSync',
        r"(node:)?fs",
        SYNC,
        [(106, f'rmSync(dir{FULL}', 'removeTempPathSync(dir)')],
    ),
}
assert len(EDITS) == 6 and sum(len(e[3]) for e in EDITS.values()) == 15


def import_range(lines, module_re, name):
    """name を import している module_re の import 文の(始まり, 終わり)の行の番号(0 始まり)"""
    for end, line in enumerate(lines):
        if re.search(rf"from '{module_re}'$", line):
            start = end
            while not lines[start].startswith('import '):
                start -= 1
            if any(re.search(rf'\b{name}\b', l) for l in lines[start : end + 1]):
                return start, end
    raise AssertionError(f'{name} の import が無い')


results = {}
for rel, (drop, module_re, guard, items) in EDITS.items():
    text = open(os.path.join(root, rel), encoding='utf-8').read()
    assert 'tempDirGuard' not in text, f'{rel}: 既にガードを import している'
    lines = text.split('\n')
    for n, old, new in items:
        assert lines[n - 1].count(old) == 1, f'{rel}:{n}: {lines[n - 1].strip()}'
        lines[n - 1] = lines[n - 1].replace(old, new)
    start, end = import_range(lines, module_re, drop or 'rmSync')
    if drop is not None:
        if start == end:
            before = lines[start]
            lines[start] = re.sub(rf', {drop} \}}', ' }', re.sub(rf'\b{drop}, ', '', before))
            assert lines[start] != before, f'{rel}: import から {drop} を消せない'
        else:
            hits = [i for i in range(start, end + 1) if lines[i] == f'  {drop},']
            assert len(hits) == 1, f'{rel}: 複数行の import の {drop} の行が {len(hits)} 行'
            del lines[hits[0]]
            end -= 1
    lines.insert(end + 1, guard)
    out = '\n'.join(lines)
    if drop is not None:
        assert not re.search(rf'\b{drop}\(', out), f'{rel}: {drop}( が残る'
    else:
        assert re.search(r'\brmSync\(', out), f'{rel}: 残す rmSync が無い'
    assert not re.search(r'\b(rm|rmSync)\(.*recursive', out), f'{rel}: 素の再帰削除が残る'
    results[rel] = out

# すべて確かめてから書く(途中で止まったときに半端な状態を残さない)
for rel, out in results.items():
    open(os.path.join(root, rel), 'w', encoding='utf-8').write(out)
print(f'ok: {len(results)} ファイル')
```

- [ ] **Step 2: スクリプトを流す（テストは流さない）**

```bash
cd <repo-root>
S=<scratchpad の絶対パス>
python3 "$S/replace-recursive-rm-task3.py" <repo-root>
```

Expected: `ok: 6 ファイル`。`AssertionError` で止まったら、どのファイルも書き換わっていないので、当たらなかった行を `sed -n '<行>p' <ファイル>` で見て、計画の時点から行がずれていれば `EDITS` の行の番号だけを直して流し直す（置き換え前・後の形は変えない）

- [ ] **Step 3: 整形する**

```bash
cd <repo-root>
set -- src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/agentChangesUndo.test.ts src/main/__tests__/gitDiscardService.integration.test.ts src/main/__tests__/gitTagService.integration.test.ts src/main/__tests__/agentSessionRecordFileIo.test.ts src/renderer/src/lib/__tests__/copilotPromptSend.integration.test.ts
npx prettier --write "$@"
```

- [ ] **Step 4: 安全の確かめ（テストを流す前に）**

```bash
cd <repo-root>
set -- src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/agentChangesUndo.test.ts src/main/__tests__/gitDiscardService.integration.test.ts src/main/__tests__/gitTagService.integration.test.ts src/main/__tests__/agentSessionRecordFileIo.test.ts src/renderer/src/lib/__tests__/copilotPromptSend.integration.test.ts
grep -nE '\b(rm|rmSync|rmdir|rmdirSync)\(.*recursive' "$@" || echo "素の再帰削除なし"
grep -oE 'removeTempPath(Sync)?\(' "$@" | wc -l
grep -L "from '@shared/__tests__/helpers/tempDirGuard'" "$@" || true
grep -nE 'removeTempPath(Sync)?\((dirname|.*\?\?)' "$@" || echo "dirname・?? を経たパスなし"
```

Expected:

- `素の再帰削除なし`
- `15`（`removeTempPathSync(`・`removeTempPath(` の呼び出しの数）
- `grep -L` が何も出さない（6 ファイルすべてがガードを import している）
- `dirname・?? を経たパスなし`

続けて全体の grep（Global Constraints）を流し、**0** 行（何も出ない）であることを確かめる。期待と違えば、テストを流さずに止まって報告する。期待どおりなら、続けて作業をリポジトリの外へ退避する（L-618。テストがリポジトリを消しても戻せるように）:

```bash
cd <repo-root>
B=$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad/backup/task3
mkdir -p "$B"
git rev-parse HEAD > "$B/base-commit.txt"
git diff --binary HEAD > "$B/changes.patch"
git ls-files --others --exclude-standard -z | tar -czf "$B/untracked.tgz" --null -T -
wc -c < "$B/changes.patch"
tar -tzf "$B/untracked.tgz"
```

Expected: `changes.patch` の大きさが 0 より大きく（task3 の時点の変更が入っている）、`tar -tzf` がプラン・設計書と、この時点の新しいファイルを出す。戻し方（リポジトリの根で。リポジトリごと消えていたら、先に `git clone` し直してその根で）: `git checkout "$(cat "$B/base-commit.txt")" && git apply "$B/changes.patch" && tar -xzf "$B/untracked.tgz"`

- [ ] **Step 5: 型検査、次にテストを流す**

```bash
cd <repo-root>
npm run typecheck
set -- src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/agentChangesUndo.test.ts src/main/__tests__/gitDiscardService.integration.test.ts src/main/__tests__/gitTagService.integration.test.ts src/main/__tests__/agentSessionRecordFileIo.test.ts src/renderer/src/lib/__tests__/copilotPromptSend.integration.test.ts
npx vitest run "$@"
```

Expected: 型検査はエラーなし（`typecheck:web` で renderer のテストからの `@shared/__tests__/helpers/tempDirGuard` の import が通る）。テストはすべて PASS（renderer のテストは jsdom の環境で、ガードの `node:fs`・`node:os` を使う。`copilotPromptSend.integration.test.ts` は既に `node:fs` を使っているので同じ理由で動く）

- [ ] **Step 6: ガードが呼ばれていることを確かめる（手で外して手で戻す）**

ガードの確かめを外す変異はしない（L-618）。

1. `src/shared/__tests__/helpers/tempDirGuard.ts` の `removeTempPath` の本体の先頭に `throw new Error('非同期のガードを通った')` を足す → `npx vitest run src/main/__tests__/agentSessionRecordFileIo.test.ts` が afterEach の `非同期のガードを通った` で落ちる → 手で戻す
2. 同じファイルの `removeTempPathSync` の本体の先頭に `throw new Error('ガードを通った')` を足す → `npx vitest run src/renderer/src/lib/__tests__/copilotPromptSend.integration.test.ts` が afterEach の `ガードを通った` で落ちる → 手で戻す
3. `grep -c "ガードを通った" src/shared/__tests__/helpers/tempDirGuard.ts` が `0` であることを確かめ、上の 2 つのテストが通ることを確かめ直す

- [ ] **Step 7: lint と整形の確かめ**

```bash
cd <repo-root>
set -- src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/agentChangesUndo.test.ts src/main/__tests__/gitDiscardService.integration.test.ts src/main/__tests__/gitTagService.integration.test.ts src/main/__tests__/agentSessionRecordFileIo.test.ts src/renderer/src/lib/__tests__/copilotPromptSend.integration.test.ts
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
```

Expected: すべて通る

- [ ] **Step 8: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 4: ESLint の規則

> **設計書の読む節:** 「調べた結果」の「ESLint の設定」、「決めたこと」の 3 と「`no-restricted-syntax` と `no-restricted-imports` の比較」、「ESLint の規則」、「テストの方針」の「ESLint の規則のテスト」、「既知の制約」の「規則がすり抜ける形」、「実装の分割」の 4。このプランの「既知の制約」（型の表明を足した）。
>
> **気をつける知見:** L-618（原因 (4)「守りを一部のファイルに分けると、後から書くテストに素の再帰削除が残る」を lint で閉じる）・L-609（規則は置き換えが全部終わった後のタスクで入れる。先に入れると lint が落ちる）。
>
> **安全の手順（このタスクで最初に読む）:** このタスクの規則のテストは `lintText` に文字列のコードを渡すだけで、ファイルを作らず、何も消さない。Step 1 の後の安全の確かめで、規則のテストが `node:fs` を import していないことと、全体の grep が 0 行のままであることを確かめてからテストを流す。

**Files:**

- Modify: `eslint.config.mjs`（`eslintConfigPrettier` の前に規則のブロックを足し、ファイルの先頭の import の後に定数を足す）
- Create: `src/shared/__tests__/helpers/tempDirGuard.lint.test.ts`

**Interfaces:**

- Consumes: Task 1 のガードのパス `src/shared/__tests__/helpers/tempDirGuard.ts`（規則の除外）。Task 2・3 の置き換え（リポジトリ全体の lint が落ちない前提）
- Produces: テストのファイル（`src/**/__tests__/**/*.{ts,tsx}`・`src/**/*.test.{ts,tsx}`・`scripts/**/__tests__/**/*.mjs`・`scripts/**/*.test.mjs`）の素の再帰削除を止める `no-restricted-syntax`

- [ ] **Step 1: 規則の失敗するテストを書く**

`src/shared/__tests__/helpers/tempDirGuard.lint.test.ts` を作る:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { ESLint } from 'eslint'

// テストの再帰削除をガードに通す ESLint の規則(eslint.config.mjs の no-restricted-syntax)を、実際の設定で確かめる。
// RuleTester ではなく実際の設定を読むのは、files・ignores の globs が効いているかも確かめるため(L-618)

const REPO_ROOT = resolve(__dirname, '../../../..')
const LINT_TIMEOUT_MS = 30_000
const eslint = new ESLint({ cwd: REPO_ROOT })

/** code を filePath のファイルとして lint し、no-restricted-syntax のメッセージだけを返す */
const restrictedMessages = async (code: string, filePath: string): Promise<string[]> => {
  const [result] = await eslint.lintText(code, { filePath: resolve(REPO_ROOT, filePath) })
  // 構文の誤りで 0 件になり、「検出しない」の確かめが素通りしないよう、構文の誤りが無いことも確かめる
  expect(result.messages.filter((message) => message.fatal === true)).toEqual([])
  return result.messages
    .filter((message) => message.ruleId === 'no-restricted-syntax')
    .map((message) => message.message)
}

const TEST_FILE_PATHS = [
  'src/main/__tests__/x.test.ts',
  'src/renderer/src/lib/__tests__/x.test.tsx',
  'src/main/__tests__/helpers/x.ts',
  'scripts/__tests__/x.test.mjs'
]

const RECURSIVE_RM = 'rmSync(dir, { recursive: true, force: true })'

const DETECTED: Array<[string, string]> = [
  ['rmSync の recursive', RECURSIVE_RM],
  ['fs.rmSync の recursive', 'fs.rmSync(dir, { recursive: true })'],
  ['fs.promises.rm の recursive', 'void fs.promises.rm(dir, { recursive: true })'],
  ['await rm の recursive', 'const f = async () => { await rm(dir, { recursive: true }) }'],
  ['rmdirSync の recursive', 'rmdirSync(dir, { recursive: true })'],
  ['文字列のキーの recursive', "rmSync(dir, { 'recursive': true })"],
  ['recursive: false(再帰しないなら欄を書かない)', 'rmSync(dir, { recursive: false })']
]

const NOT_DETECTED: Array<[string, string]> = [
  ['removeTempPathSync', 'removeTempPathSync(dir)'],
  ['await removeTempPath', 'const f = async () => { await removeTempPath(dir) }'],
  ['1 つのファイルを消す rmSync', "rmSync(join(dir, 'f.txt'))"],
  ['force だけの rmSync', 'rmSync(file, { force: true })'],
  ['mkdirSync の recursive', 'mkdirSync(dir, { recursive: true })'],
  ['cpSync の recursive', 'cpSync(a, b, { recursive: true })'],
  [
    'toHaveBeenCalledWith の recursive',
    "expect(mockRm).toHaveBeenCalledWith('/x', { recursive: true })"
  ]
]

describe('テストの再帰削除の ESLint の規則', () => {
  describe.each(TEST_FILE_PATHS)('テストのファイル %s', (filePath) => {
    it.each(DETECTED)(
      '%s を検出し、ガードを案内する',
      async (_label, code) => {
        expect(await restrictedMessages(code, filePath)).toEqual([
          expect.stringContaining('removeTempPathSync')
        ])
      },
      LINT_TIMEOUT_MS
    )

    it.each(NOT_DETECTED)(
      '%s は検出しない',
      async (_label, code) => {
        expect(await restrictedMessages(code, filePath)).toEqual([])
      },
      LINT_TIMEOUT_MS
    )
  })

  it.each<[string, string, number]>([
    ['ガードの実装(除外)', 'src/shared/__tests__/helpers/tempDirGuard.ts', 0],
    ['本番のコード(テストのファイルだけにかける)', 'src/main/foo.ts', 0],
    ['ガードの単体テスト(除外しない)', 'src/shared/__tests__/helpers/tempDirGuard.test.ts', 1],
    ['ガードと同じフォルダのほかの補助(除外しない)', 'src/shared/__tests__/helpers/other.ts', 1]
  ])(
    '%s(%s)での素の再帰削除の検出は %s 件',
    async (_label, filePath, expected) => {
      expect(await restrictedMessages(RECURSIVE_RM, filePath)).toHaveLength(expected)
    },
    LINT_TIMEOUT_MS
  )
})
```

- [ ] **Step 2: 安全の確かめ（テストを流す前に）**

```bash
cd <repo-root>
grep -nE "from 'node:fs|from 'fs" src/shared/__tests__/helpers/tempDirGuard.lint.test.ts || echo "fs を使っていない"
```

Expected: `fs を使っていない`。続けて全体の grep（Global Constraints）が **0** 行であることを確かめる（規則のテストの文字列は全体の grep の除外に入っている）。期待どおりなら、続けて作業をリポジトリの外へ退避する（L-618。テストがリポジトリを消しても戻せるように）:

```bash
cd <repo-root>
B=$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad/backup/task4-red
mkdir -p "$B"
git rev-parse HEAD > "$B/base-commit.txt"
git diff --binary HEAD > "$B/changes.patch"
git ls-files --others --exclude-standard -z | tar -czf "$B/untracked.tgz" --null -T -
wc -c < "$B/changes.patch"
tar -tzf "$B/untracked.tgz"
```

Expected: `changes.patch` の大きさが 0 より大きく（task4-red の時点の変更が入っている）、`tar -tzf` がプラン・設計書と、この時点の新しいファイルを出す。戻し方（リポジトリの根で。リポジトリごと消えていたら、先に `git clone` し直してその根で）: `git checkout "$(cat "$B/base-commit.txt")" && git apply "$B/changes.patch" && tar -xzf "$B/untracked.tgz"`

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/shared/__tests__/helpers/tempDirGuard.lint.test.ts`
Expected: FAIL（規則がまだ無いので、`DETECTED` の 28 件〈7 件 × 4 パス〉と、最後の表の「除外しない」2 件が `[]` で落ちる。`NOT_DETECTED` と「除外」「本番のコード」は通る。`fatal` の確かめで落ちる件があれば、コードの文字列の構文の誤りなので、そのコードを直す）

- [ ] **Step 4: 規則を足す（`eslint.config.mjs`）**

import の後（`export default defineConfig(` の前）に次を足す:

```js
// テストの再帰削除は、一時ディレクトリの中だけを消すガードを通す(L-618。2026-10-26 にテストの rmSync('.') がリポジトリを .git ごと消した)。
// 呼び出しの引数のオブジェクトリテラルに recursive の欄があれば止める(recursive: false も止める。再帰しないなら欄を書かない)。
// すり抜ける形(既知の制約): オプションを変数で渡す・スプレッド・別名の import・計算されたキー・型の表明(as・satisfies)。レビューと grep で補う
const RECURSIVE_RM_MESSAGE =
  'テストの再帰削除は @shared/__tests__/helpers/tempDirGuard の removeTempPathSync・removeTempPath を通してください(L-618)'
const RECURSIVE_RM_OPTION =
  "> ObjectExpression > Property:matches([key.name='recursive'], [key.value='recursive'])"
```

`eslintConfigPrettier` の前（`scripts/**/*.mjs` のブロックの後）に次のブロックを足す:

```js
  {
    // テストのファイルとテストの補助(__tests__ の下)だけにかける。本番のコードは一時ディレクトリの外も正しく消す必要がある
    files: [
      'src/**/__tests__/**/*.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
      'scripts/**/__tests__/**/*.mjs',
      'scripts/**/*.test.mjs'
    ],
    // ガードの実装だけを、このブロックの規則から外す(flat config の ignores はこのブロックだけに効く)
    ignores: ['src/shared/__tests__/helpers/tempDirGuard.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `CallExpression[callee.type='Identifier'][callee.name=/^(rm|rmSync|rmdir|rmdirSync)$/] ${RECURSIVE_RM_OPTION}`,
          message: RECURSIVE_RM_MESSAGE
        },
        {
          selector: `CallExpression[callee.type='MemberExpression'][callee.property.name=/^(rm|rmSync|rmdir|rmdirSync)$/] ${RECURSIVE_RM_OPTION}`,
          message: RECURSIVE_RM_MESSAGE
        }
      ]
    }
  },
```

（セレクターは設計書の「ESLint の規則」と同じ。設計書の時点で `lintText` で試してある）

- [ ] **Step 5: テストとリポジトリ全体の lint が通ることを確かめる**

作業をリポジトリの外へ退避する（L-618。テストがリポジトリを消しても戻せるように）:

```bash
cd <repo-root>
B=$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad/backup/task4
mkdir -p "$B"
git rev-parse HEAD > "$B/base-commit.txt"
git diff --binary HEAD > "$B/changes.patch"
git ls-files --others --exclude-standard -z | tar -czf "$B/untracked.tgz" --null -T -
wc -c < "$B/changes.patch"
tar -tzf "$B/untracked.tgz"
```

Expected: `changes.patch` の大きさが 0 より大きく（task4 の時点の変更が入っている）、`tar -tzf` がプラン・設計書と、この時点の新しいファイルを出す。戻し方（リポジトリの根で。リポジトリごと消えていたら、先に `git clone` し直してその根で）: `git checkout "$(cat "$B/base-commit.txt")" && git apply "$B/changes.patch" && tar -xzf "$B/untracked.tgz"`

```bash
cd <repo-root>
npx vitest run src/shared/__tests__/helpers/tempDirGuard.lint.test.ts
npm run lint
npm run typecheck
```

Expected: 規則のテストはすべて PASS。`npm run lint` はエラーなし（置き換えが終わっているので、規則を入れても既存のファイルで落ちない。キャッシュは設定の変化で無効になる）。型検査はエラーなし（`eslint` の型は `eslint` の包みの `lib/types` にある）

- [ ] **Step 6: 実装を外すとテストが落ちることを確かめる（手で外して手で戻す）**

1. `eslint.config.mjs` の規則のブロック全体（`files: [` から `},` まで）を消す → `npx vitest run src/shared/__tests__/helpers/tempDirGuard.lint.test.ts` で `DETECTED` の 28 件と「除外しない」2 件が落ちる → 手で戻す
2. ブロックの `ignores: ['src/shared/__tests__/helpers/tempDirGuard.ts'],` の行を消す → 「ガードの実装(除外)」が落ちる → 手で戻す
3. `MemberExpression` のセレクターのオブジェクト（2 つ目の `{ selector: …, message: … }`）を消す → `fs.rmSync`・`fs.promises.rm` の 8 件（2 件 × 4 パス）が落ちる → 手で戻す
4. `files` を `['src/**/*.test.{ts,tsx}']` だけにする → 15 件が落ちる（`src/main/__tests__/helpers/x.ts`・`scripts/__tests__/x.test.mjs` の `DETECTED` の 14 件〈7 件 × 2 パス〉と、最後の表の「ガードと同じフォルダのほかの補助(除外しない)」〈`src/shared/__tests__/helpers/other.ts`〉の 1 件）→ 手で戻す

戻した後に `git diff eslint.config.mjs` で Step 4 の形であることを確かめ、Step 5 のコマンドが通ることを確かめ直す。

- [ ] **Step 7: lint と整形**

```bash
cd <repo-root>
set -- eslint.config.mjs src/shared/__tests__/helpers/tempDirGuard.lint.test.ts
npx prettier --write "$@"
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
```

Expected: すべて通る（規則のテストの文字列のコードは `CallExpression` ではないので、規則に当たらない）

- [ ] **Step 8: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 5: 全体の検証（ROADMAP・実機テスト仕様書は更新しない）

> **設計書の読む節:** 「テストの方針」の「全体の確かめ（最後のタスク）」、「実装の分割」の 5、「実機テスト仕様書について」、「決めたこと」の 6（ROADMAP は更新しない）。
>
> **気をつける知見:** L-618（全体の grep の 0 行を確かめてから全体のテストを流す）・L-609（最後に全体で型検査・テスト・lint を通す）。
>
> **安全の手順（このタスクで最初に読む）:** 全体のテストを流す前に、Step 1 の grep で、テストのコードの素の再帰削除が 0 行であることを確かめる。0 行でなければ、全体のテストを流さずに止まって報告する。

**Files:**

- 変更なし（検証だけ）。`ROADMAP.md` は更新しない（該当する項目が無い）。`docs/manual-test-spec.md` には追記しない

**Interfaces:**

- Consumes: Task 1〜4 のすべて
- Produces: なし

- [ ] **Step 1: grep で、残りが期待どおりの件数か確かめる（テストを流す前に）**

```bash
cd <repo-root>
{ git ls-files; git ls-files --others --exclude-standard; } | sort -u \
  | grep -E '(__tests__/|\.test\.(ts|tsx|mjs)$)' \
  | while read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done \
  | xargs grep -nE '\b(rm|rmSync|rmdir|rmdirSync)\(.*recursive' \
  | grep -vE '^src/shared/__tests__/helpers/tempDirGuard(\.lint\.test)?\.ts:' \
  || echo "素の再帰削除なし"
grep -cE '\b(rm|rmSync|rmdir|rmdirSync)\(.*recursive' src/shared/__tests__/helpers/tempDirGuard.ts
grep -nE '\b(rm|rmSync|rmdir|rmdirSync)\(.*recursive' src/shared/__tests__/helpers/tempDirGuard.lint.test.ts
grep -rn "__tests__/helpers/tempDirGuard'" src | grep -v "@shared/__tests__/helpers/tempDirGuard'" | grep -v "from './tempDirGuard'" || echo "古い import なし"
grep -rln "@shared/__tests__/helpers/tempDirGuard" src | wc -l
ls src/main/__tests__/helpers/tempDirGuard* 2>/dev/null || echo "main に残っていない"
```

Expected:

- 1 つ目: `素の再帰削除なし`（ガードの実装と規則のテストを除いて 0 行）
- 2 つ目: `3`（ガードの実装の `rmSync`・`rm` の 2 行と、事故を説明するコメントの 1 行）
- 3 つ目: 規則のテストの `RECURSIVE_RM`・`DETECTED`・`NOT_DETECTED` の文字列の行だけ（どの行も、`rmSync(`・`rm(` などが `'`・`"` の文字列の中にある）
- 4 つ目: `古い import なし`（`src/main/__tests__/helpers/tempDirGuard` を参照する import が 0 件）
- 5 つ目: `46`（Task 1 の 12 ファイル・Task 2 の 28 ファイル・Task 3 の 6 ファイル）
- 6 つ目: `main に残っていない`

期待と違えば、全体のテストを流さずに止まって報告する。期待どおりなら、続けて作業をリポジトリの外へ退避する（L-618。テストがリポジトリを消しても戻せるように）:

```bash
cd <repo-root>
B=$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad/backup/task5
mkdir -p "$B"
git rev-parse HEAD > "$B/base-commit.txt"
git diff --binary HEAD > "$B/changes.patch"
git ls-files --others --exclude-standard -z | tar -czf "$B/untracked.tgz" --null -T -
wc -c < "$B/changes.patch"
tar -tzf "$B/untracked.tgz"
```

Expected: `changes.patch` の大きさが 0 より大きく（task5 の時点の変更が入っている）、`tar -tzf` がプラン・設計書と、この時点の新しいファイルを出す。戻し方（リポジトリの根で。リポジトリごと消えていたら、先に `git clone` し直してその根で）: `git checkout "$(cat "$B/base-commit.txt")" && git apply "$B/changes.patch" && tar -xzf "$B/untracked.tgz"`

- [ ] **Step 2: 全体の検証**

```bash
cd <repo-root>
npm run typecheck
npx vitest run --reporter=dot
npm run lint
{ git diff --name-only --diff-filter=d; git ls-files --others --exclude-standard; } | sort -u | grep -E '\.(ts|tsx|mjs)$' > "$S/changed.txt"
cat "$S/changed.txt" | wc -l
xargs npx eslint --max-warnings 0 < "$S/changed.txt"
xargs npx prettier --check < "$S/changed.txt"
npx prettier --check docs/superpowers/plans/2026-10-28-test-recursive-rm-guard.md docs/superpowers/specs/2026-10-28-test-recursive-rm-guard-design.md
```

（このコードブロックの先頭でも `S=<scratchpad の絶対パス>` を設定する）

Expected: すべて通る。`changed.txt` は 50 行（Task 1 の 12 ファイルと移した 2 ファイル・Task 2 の 28 ファイル・Task 3 の 6 ファイル・Task 4 の `eslint.config.mjs` と規則のテスト。移す前のパスは `--diff-filter=d` で除く）。全体のテストが時間切れで落ちたら、Global Constraints のとおり単体で流し直す

- [ ] **Step 3: 実機テスト仕様書には追記しない（記録だけ）**

この変更はテストのコード・テストの補助・`eslint.config.mjs` だけを変え、Electron のアプリの画面・挙動・ビルドの成果物に入るコードを変えない（アプリの挙動を変えない）ので、**`docs/manual-test-spec.md` には追記しない。** `node scripts/build-manual-test-spec.mjs` の再生成と Artifact（`<manual-test-spec-artifact-url>`）の再公開も行わない。ROADMAP も更新しない（該当する項目が無い）。確かめは自動のテスト（ガードの単体テスト・規則のテスト）・`npm run lint`・Step 1 の grep で行った。

`git diff --name-only -- docs/manual-test-spec.md ROADMAP.md` が何も出さないことを確かめ、報告に「実機テスト仕様書・ROADMAP は変えていない（理由: アプリの挙動を変えないため）」と書く。

- [ ] **Step 4: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

## 自己レビューの結果（計画の時点）

- **設計書の網羅:** 「決めたこと」1（置き場）→ Task 1、2（同期・非同期の API）→ Task 1、3（ESLint の規則）→ Task 4、4（一律にガード）→ Task 2・3、5（try/finally）→ Task 2・3 の表の「場所」と置き換え方（finally の中の呼び出しだけを替える）、6（ROADMAP は更新しない）→ Task 5、7（`let dir: string` は書き換えない）→ 置き換えのスクリプトは呼び出しだけを替える。「置き換えの方針」の 7 つの形は、Task 2・3 の表とスクリプトに写した（`if (dir !== null)`・`for … of`・`join(repo, '.git')`・`force` 無し・本番の値・`await rm`）。「テストの方針」のガードの単体テスト → Task 1 Step 3、規則のテスト → Task 4 Step 1、全体の確かめ → Task 5。「実機テスト仕様書について」→ Task 5 Step 3
- **件数:** 計画の時点（`b6519aa`）で全体の grep をかけ直し、設計書と同じ 34 ファイル・50 か所であることを確かめた。Task 2（28 ファイル・35 か所）と Task 3（6 ファイル・15 か所）のスクリプトを、テストのファイルの写しに順にかけて、すべての置き換えが指定の行に 1 回ずつ当たり、置き換え後の全体の grep が 0 行になることを確かめた
- **型の一貫性:** `removeTempPath(target: string | null | undefined): Promise<void>`・`removeTempPathSync`・`assertInsideTempDir` と import のパス `@shared/__tests__/helpers/tempDirGuard` は、「型・関数の名前」の節と各タスクの Interfaces・スクリプトの `GUARD`・`SYNC`・`ASYNC` で同じにした
- **安全:** 置き換えのスクリプトはすべてを確かめてから書き込み、テストは各タスクの安全の確かめの後にだけ流す。ガードの確かめ（`assertInsideTempDir`）を丸ごと外す変異は書かず（`removeTempPath` の「中」の確かめだけを外す変異は、存在しないパスしか渡さないことを確かめてから流す）、`removeTempPath(Sync)` に存在するパスを渡すテストも書かない。テストを流す前には毎回、作業を scratchpad へ退避する
