# エージェントの変更の Git 管理外のフォルダでの記録（隠れた git） 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Git 管理外のフォルダを開いたときに、アプリの一時ディレクトリの中に記録専用の bare リポジトリ（隠れた git）を作り、`GIT_DIR`・`GIT_WORK_TREE`・`GIT_INDEX_FILE` で開いたフォルダを作業ツリーとして記録する。利用者のフォルダには何も書かず、記録の後はリポジトリと同じセクション・同じ操作（一覧・diff・行の `↶`・ハンク・`すべて戻す`・実行ごと・利用者の変更との区別・取り消し）を使えるようにする。

**Architecture:** main は、記録の git の場所を `BaselineGitLocation`（`folderPath`・`indexPath`・`gitDir`。`gitDir` が null ならリポジトリの方式）にまとめ、`buildBaselineGitEnv` の 1 か所で `GIT_INDEX_FILE`（と隠れた git なら `GIT_DIR`・`GIT_WORK_TREE`）を付ける。`takeBaselineSnapshot` は `resolveBaselineMode` で方式（リポジトリ・隠れた git の新規・隠れた git の区切り・記録できない）を決め、方式ごとの関数で記録する。隠れた git は累積の始点の一時ディレクトリの中（`<tempDir>/git`）に `agentBaselineHiddenGit.ts` の `createHiddenGit` で作り、区切りは `base`（`BaselineCheckpointBase`）で同じ隠れた git を共有する。一覧・diff・戻すは記録の場所で問い合わせ、HEAD は `readRecordHead`、コンフリクトと blob の有無は `createRecordRepoGit` で問い合わせ先を切り替える。保護の ref は隠れた git の記録では作らない。記録の一時ディレクトリの名前に main の起動ごとの ID を入れ、起動時に `agentBaselineTempSweep.ts` で異常終了の残りを消す。IPC は記録中の状態に `storage: 'repository' | 'app'` を足し、renderer はセクションの本文の先頭に記録の置き場の注記を 1 行出す。

**Tech Stack:** Electron（main・preload）, React 19, TypeScript, simple-git 3.36.0（`env()` で `GIT_DIR`・`GIT_WORK_TREE`・`GIT_INDEX_FILE` を渡す。`--template` は拒否されるため `init` は spawn）, git 2.50.1, Vitest（実 git の統合テスト・偽の `takeSnapshot`）, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-15-agent-changes-non-git-folder-design.md`（承認済み。実装の前に必ず読む）。このプランは設計書の「実装の分割」の **タスク 1〜6 のすべて**（タスク 2・3 は境目を保ったまま 2a・2b、3a・3b に分けた）。各タスクで読む節はタスクの冒頭に書いた。書き方の参考は `docs/superpowers/plans/2026-10-14-agent-changes-user-edit-distinction-stage-b2.md`。

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
> - 設計書のタスク 2 を **Task 2a（隠れた git の作成）と Task 2b（一時ディレクトリの名前・`instanceId`・起動時の掃除）** に、タスク 3 を **Task 3a（区切りの写しの元 `base`。挙動はリポジトリのまま）と Task 3b（方式の決め方・隠れた git の記録・理由・保護の分岐）** に分ける。どちらも、片方だけを差し戻せる境目で分けた（各タスクの終わりで `npm test`・`npm run typecheck` が通る）。
> - simple-git 3.36.0 は `--template` を `allowUnsafeTemplateDir` なしに拒否する（`node_modules/@simple-git/argv-parser/dist/index.mjs` の `h(null, "--template", "allowUnsafeTemplateDir")`）。そのため隠れた git の `init`・`config` は、`agentBaselineGit.ts` に足す **`runIsolatedGit(cwd, args, options)`**（位置の変数を足さない環境 `buildIsolatedGitEnv` + `extraEnv` で spawn。`runBaselineGitWithInput` と spawn の部分を共有する）で実行する。`init` の作る場所は cwd（記録の一時ディレクトリ）からの相対の名前 `git` で渡し、パスを git の引数にしない（L-034。設計書の `git init --bare -q --template= <記録の一時ディレクトリ>/git` と同じ場所になる）。
> - 前提の確かめを 2 つの関数に分ける: **`assertBaselineRecord(snapshot)`**（記録のインデックス + 隠れた git なら `gitDir`。累積の一覧・diff が使う）と **`assertBaselineGitDir(snapshot)`**（`gitDir` だけ。null なら何もしない）。`collectAgentChangeEntriesBetween`・`getAgentChangeDiffBetween` は `assertBaselineGitDir(start)` だけを呼ぶ（tree どうしの比較は記録のインデックスを読まないため、リポジトリの方式の今の挙動〈インデックスを確かめない〉を変えない）。`resolveBaselineMode` の区切りの `base.gitDir` の確かめ（リンクでないディレクトリ）も `assertBaselineGitDir` を使う。
> - 大域の `core.hooksPath` の hook のテストは、**Task 2a で git の命令（`add -A`・`diff`・`restore --worktree`）を隠れた git で直接実行する形**（と、隠れた git の設定が無い bare リポジトリでは hook が動く前提のテスト）にし、**Task 4 で記録（始点・区切り）・一覧・diff・戻す（ファイル・ハンク・すべて戻す）の一連の操作の形**を同じファイルに足す（Task 2a の時点では `takeBaselineSnapshot` が隠れた git を作らないため）。未確認事項 3（sha256・reftable）も、Task 2a で `write-tree` までを、Task 4 で一連の操作を確かめる。
> - 「親の環境に別のリポジトリを指す `GIT_DIR`・`GIT_OBJECT_DIRECTORY` があっても、そのリポジトリが変わらない」のテストは、親の環境を `takeBaselineSnapshot` の **`env` の選択肢**で渡す（`createRepoGit` は simple-git の既定で `process.env` を引き継ぐため、`process.env` に入れると方式の判定そのものが別のリポジトリを指す。これはリポジトリの方式の今の挙動と同じで、この機能の範囲外。隠れた git の命令〈`createHiddenGit`・記録の git〉が親の位置の変数を外すことを確かめるのが目的）。
> - 理由 `not-repository` の全文の変更（`Git 管理外のフォルダになったため、記録できません`）は、**Task 3b ではなく Task 5**（`AgentChangesSection` の Git 管理外の分岐の撤去と同じタスク）で行う。Task 3b の時点で変えると、まだ残っている Git 管理外の分岐が新しい文言を出し、既存の `AgentChangesSection.test.tsx` の 3 つのテストが落ちる。Task 3b は型の網羅に要る新しい理由 2 つの文言だけを足す。
> - 実機テスト仕様書の **GIT-006**（期待結果に `Git 管理外のフォルダでは、エージェントの変更を記録できません` が出ると書いている）も Task 6 で直す（設計書は AGC-005 だけを挙げているが、挙動の変わる既存の項目は直す。CLAUDE.md）。
> - テストの補助の名前（設計書は決めていない）: `repoLocation(folderPath, indexPath)`・`snapshotBase(snapshot)`・`createAgentNonGitFolder(prefix)`（戻り値は `AgentBaselineRepo` と同じ形で、`repo` が Git 管理外のフォルダ。`disposeAgentBaselineRepo` でそのまま片付ける。上のリポジトリを拾わないよう `stubGitCeiling(folder)` も行う）・`folderEntries(folder)`・`folderChangesExcept(before, after, changed)`。テストの `takeBaselineSnapshot` の `instanceId` は既存の **`FAKE_PROTECTION_INSTANCE_ID`（`'1-00000000'`）** を使う（本番と同じく保護と記録の一時ディレクトリで同じ値。コメントを直す）。
> - `sweepStaleBaselineTempDirs` は `uid`（既定 `process.getuid?.() ?? null`）・`platform`（既定 `process.platform`）を受け取れるようにし、`readdir` に失敗したら 0 を返す（投げない）。Windows 以外で `uid` が分からなければ「自分のもの」としない。
> - 隠れた git の新規の記録の取り消しの確認（`checkpoint()`）は 9 回（リポジトリか・`.git` の中か・隠れた git の作成・未追跡の検査・`add` の前・`add`・ignore 済みの一覧・HEAD・tree）。リポジトリの方式は今の 10 回のまま（既存のテストで固定）。
> - 未確認事項 2（時間と大きさ）は、Task 3b で一時的な計測のテストのファイルを作って測り、測った後に消す（コミットしない）。

## Global Constraints

- コメント・文言・ログは日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。クライアントのコンポーネントには `'use client'`（`AgentChangesSection.tsx` は既に付いている）。`any` を使わない
- **コミットは利用者の明示の指示があるときだけ行う**（CLAUDE.md）。各タスクの最後の「コミット」の Step は、指示があったときにだけ実行する。そのときは `git add <このタスクで変えたファイルを列挙>`（**`git add -A` は使わない**）で、メッセージは日本語の Conventional Commit、本文の最後に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **実物の `claude` は起動しない。** 実機の確認はユーザーがまとめて行う（Task 6 で実機テスト仕様書に追記する）。プランに実機の手順は書かない
- 各タスクの終わりで次が通る状態を保つ: `npm test`（全テスト）・`npm run typecheck`・変更・作成した TypeScript のファイルへの `npx eslint --fix <ファイル>` → `npx eslint --max-warnings 0 <ファイル>`（各タスクの「通す」の Step の `<同じファイル>` は、直前の `npx eslint --fix` に渡したファイルの並びと同じものを渡す）。型を変えるタスクは、型に追随する呼び出し元・テストの補助・既存のテストを同じタスクで直す
- **このマシンは負荷が高く、`npm test` の全体でテストが時間切れ（`Test timed out`・`waitFor` の打ち切り）で落ちることがある。** 落ちたら、落ちたファイルを `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書いて先へ進む。単体でも落ちれば本当の失敗として直す
- **シェルで `path` を変数名に使わない**（zsh では `path` が `PATH` と結び付いた配列で、代入すると `PATH` が壊れて以後のコマンドが見つからなくなる）。`for f in ...`・`p=...` などの別の名前を使う
- 隠れた git の作り方（`src/main/agentBaselineHiddenGit.ts`。一字一句この値）:
  - 場所: 累積の始点の一時ディレクトリの中の `git`（`<tempDir>/git`）。`git init --bare -q --template= git` を cwd を `<tempDir>` にして実行する（環境は `buildIsolatedGitEnv`。`GIT_INDEX_FILE`・`GIT_DIR`・`GIT_WORK_TREE` を足さない）
  - 設定の 4 つの値（`git config`。環境の `GIT_DIR` で隠れた git を指す）: `core.fsmonitor=false`・`gc.auto=0`・`maintenance.auto=false`・`core.hooksPath=<gitDir>/no-hooks`（作らない。存在しない絶対パス）
  - `<gitDir>/info` を `mkdir`（0700。再帰しない）し、`info/exclude` を `wx`・0600 で書く。中身は先頭に注釈の行 `# prompt-ide が書いた既定の一覧（記録に含めないもの）`、続けて既定の一覧を 1 行ずつ
  - 既定の一覧 `AGENT_BASELINE_DEFAULT_EXCLUDES`（この順）: `node_modules/`・`.venv/`・`venv/`・`__pycache__/`・`.next/`・`dist/`・`build/`・`target/`・`.DS_Store`・`Thumbs.db`（フォルダは末尾の `/`、先頭に `/` を付けない。`.git/` と `.env` は書かない）
  - 未追跡の事前の検査の空の index: `<tempDir>/empty-index`（作らない）
- 記録の一時ディレクトリの名前（`src/main/agentBaselineTempSweep.ts`）:
  - 接頭辞 `AGENT_BASELINE_TEMP_DIR_PREFIX = 'prompt-ide-agent-baseline-'`、`baselineTempDirPrefix(instanceId)` は `prompt-ide-agent-baseline-<instanceId>-`（`mkdtemp` が 6 文字を足す）
  - `instanceId` は `<pid>-<16 進 8 桁>`（`createProtectionInstanceId(process.pid, randomBytes(4).toString('hex'))`。保護の ref と同じ値を `ipcHandlers.ts` で 1 回だけ作る）
  - 名前の解釈の正規表現: `^prompt-ide-agent-baseline-([1-9][0-9]{0,9})-([0-9a-f]{8})-[A-Za-z0-9]{6}$`。pid は `Number.isSafeInteger` で 1 以上 2^31−1（2147483647）以下のときだけ `{ pid, instanceId: '<pid>-<16 進>' }`、それ以外は null
  - 自分のもの: `lstat` の結果がディレクトリでシンボリックリンクでなく、Windows 以外は `uid` が自分と一致し `mode & 0o077` が 0
- 型（`src/shared/types/agentChanges.ts`。どれも必須。L-060）:
  - `AGENT_CHANGES_UNAVAILABLE_REASONS` に `'too-many-files'`（Git 管理外のフォルダで、ignore されていないファイルが多すぎる・大きすぎる）と `'inside-git-dir'`（`.git` の中・bare リポジトリのフォルダ）を足す（Task 3b）
  - `export type AgentChangesStorage = 'repository' | 'app'`、`AgentChangesState` の `recording` と `AgentChangesListResult` の `recording`・`scope-unavailable` に `storage: AgentChangesStorage`（Task 5）
- main の型・関数の名前（後のタスクはこの名前と型で使う）:
  - `BaselineSnapshot.gitDir: string | null`（Task 1）
  - `type BaselineGitLocation = Pick<BaselineSnapshot, 'folderPath' | 'indexPath' | 'gitDir'>`（Task 1。`agentBaselineGit.ts`）
  - `buildIsolatedGitEnv(source: NodeJS.ProcessEnv): Record<string, string>`・`buildBaselineGitEnv(source: NodeJS.ProcessEnv, location: BaselineGitLocation): Record<string, string>`（Task 1）
  - `createBaselineGit(location, options?)`・`runBaselineGitWithInput(location, args, input, options?)`・`runBaselineGitWithInputSync(location, args, input, options?)`（Task 1）
  - `createRecordRepoGit(location: BaselineGitLocation, options?: BaselineGitOptions): SimpleGit`・`readRecordHead(location: BaselineGitLocation, options?: BaselineGitOptions): Promise<string | null>`（Task 1）
  - `assertBaselineRecord(snapshot: Pick<BaselineSnapshot, 'indexPath' | 'gitDir'>): Promise<void>`・`assertBaselineGitDir(snapshot: Pick<BaselineSnapshot, 'gitDir'>): Promise<void>`（Task 1。`agentBaselineCoverage.ts`。文言は `記録が見つかりません`）
  - `runIsolatedGit(cwd: string, args: readonly string[], options?: BaselineGitOptions & { extraEnv?: Record<string, string> }): Promise<string>`（Task 2a）
  - `createHiddenGit(tempDir: string, gitOptions?: BaselineGitOptions): Promise<string>`・`AGENT_BASELINE_DEFAULT_EXCLUDES`・`hiddenGitConfig(gitDir)`・`hiddenGitExcludeContent()`・`hiddenGitEmptyIndexPath(tempDir)`（Task 2a）
  - `AGENT_BASELINE_TEMP_DIR_PREFIX`・`baselineTempDirPrefix(instanceId)`・`parseBaselineTempDirName(name)`・`isOwnBaselineTempDir(stat, { uid, platform })`・`sweepStaleBaselineTempDirs(options): Promise<number>`（Task 2b）
  - `TakeBaselineOptions.instanceId: string`（必須。Task 2b）・`TakeBaselineOptions.base?: BaselineCheckpointBase`（`baseIndexPath` を置き換える。Task 3a）
  - `interface BaselineCheckpointBase { indexPath: string; gitDir: string | null }`（Task 3a。`agentBaselineSnapshot.ts`）
  - `checkpointBaseOf(record: AgentChangesRecord): BaselineCheckpointBase`（Task 3a。`agentChangesRecord.ts`）
  - `AgentBaselineRegistryDeps.takeSnapshot` の `options: { isCanceled; now; base?: BaselineCheckpointBase }`（Task 3a）
  - `isInsideGitDirectory(git: SimpleGit): Promise<boolean>`（Task 3b。`gitRepoDetection.ts` へ移す）
- renderer の文言（`src/renderer/src/lib/agentChangesMessages.ts`。一字一句この形。実機テスト仕様書もこの文字列で書く）:
  - `AGENT_CHANGES_APP_STORAGE_NOTE = 'Git 管理外のフォルダのため、アプリの一時領域に記録しています（node_modules などは記録しません）'`（記録中で `storage: 'app'`。Task 5）
  - `AGENT_CHANGES_APP_STORAGE_HINT = 'Git 管理外のフォルダのため、記録はアプリの一時領域に置きます（node_modules などは記録しません）'`（記録の前で Git 管理外のフォルダ。Task 5）
  - `AGENT_CHANGES_UNAVAILABLE_MESSAGES['too-many-files'] = 'ファイルが多すぎるため、記録できません。リポジトリを初期化するか、.gitignore で記録しないファイルを指定してください'`（件数・大きさは `too-many-untracked` と同じく `（5,001 件）`・`（21 件・105.0 MB）` の形で添える。Task 3b）
  - `AGENT_CHANGES_UNAVAILABLE_MESSAGES['inside-git-dir'] = 'Git のデータのフォルダ（.git の中・bare リポジトリ）では、エージェントの変更を記録できません'`（Task 3b）
  - `AGENT_CHANGES_RUN_UNAVAILABLE_SHORT['too-many-files'] = 'ファイルが多すぎます'`・`AGENT_CHANGES_RUN_UNAVAILABLE_SHORT['inside-git-dir'] = 'Git のデータのフォルダです'`（Task 3b）
  - `AGENT_CHANGES_UNAVAILABLE_MESSAGES['not-repository'] = 'Git 管理外のフォルダになったため、記録できません'`（Task 5。短い形 `Git 管理外のフォルダです` は変えない）
  - `canRetryAgentChanges` は変えない（`too-many-files`・`inside-git-dir` では `もう一度試す` を出さない）
- 画面: CSS は変えない（注記は既存の `agent-changes__note`）。注記は `aria-live` にしない（読み上げの要素は今のまま）。新しいボタン・フォーカスの移動は足さない
- テストの規約: 実 git の統合テストは既存の補助（`createAgentBaselineRepo`・新しい `createAgentNonGitFolder`。大域の設定を隔離した `HOME`）で動かし、実 git・一時ディレクトリは使う `describe` の中の `beforeEach` で用意する（L-440）。**利用者の大域の設定を試すときは `writeFileSync(join(home, '.gitconfig'), ...)` で隔離した `HOME` の設定ファイルに書く**（テストの `runGit` は `GIT_CONFIG_GLOBAL=/dev/null` のため `git config --global` は効かない。記録の git は `GIT_CONFIG_GLOBAL` を外して `HOME` の設定を読む）。偽のタイマーは使わない。`act(...).then(...)` で書かない。`console.*` の spy は `afterEach`（か `finally`）で戻す。テストの補助関数にも戻り値の型を書く（`@typescript-eslint/explicit-function-return-type`）。待ちは状態で待ち、固定時間で待たない（L-185）
- 「変異で確かめる」の Step は、書いた実装の一部を一時的に戻して該当のテストが落ちる（型検査で落ちるものは `npm run typecheck` が落ちる）ことを確かめ、必ず元に戻す（戻したことを `git diff` で確かめる）

### 気をつける知見（dev-flow-kit の `lessons/review-lessons.md`。設計書の「反映した知見」）

- **L-002**（「無い」「失敗」を「空」として扱わない）: 区切りで `base.gitDir`・写しの元が無いのを「新しい隠れた git を作る」「空から始める」にせず `git-failed`（Task 3b）。一覧・diff で `gitDir` が無いのを `記録が見つかりません`（Task 1・Task 4）。空の index は意図して存在しないファイルを渡す（Task 2a・3b）
- **L-004**（自分が作ったもの以外を消さない）: 起動時の掃除は、名前の完全一致・自分の `instanceId` でない・pid のプロセスが無い・`lstat` でリンクでないディレクトリ・持ち主と 0700 を対にして確かめたものだけを消す（Task 2b）。区切りの失敗では共有の隠れた git に触れず自分の一時ディレクトリだけを消す（Task 3b）
- **L-009**（大文字小文字）: 隠れた git の `core.ignorecase` が開いたフォルダと食い違いうることを既知の制約に書く。戻す操作の分類は今の問い合わせのまま（Task 6）
- **L-010**（巻き戻し・掃除は 1 つの失敗で止めない）: 起動時の掃除の 1 つの失敗を握って次へ進む（Task 2b）
- **L-016**（シンボリックリンク）: リンクはリンクとして記録・戻し、指す先（フォルダの外を含む）を辿らない・書き換えない（Task 3b・Task 4・AGC-136）
- **L-017**（理由の文にパスを出さない）: 記録できない理由の文にパスを入れない（Task 3b の文言）
- **L-020・L-046**（pid の検証）: 掃除で `process.kill(pid, 0)` に渡す pid を、正規表現・`Number.isSafeInteger`・2^31−1 以下で検証する（Task 2b）
- **L-041**（モードで意味が変わる操作）: 区切りではフォルダを調べ直さず記録の方式に従う（`git init` の後も隠れた git、`.git` が消えても隠れた git に切り替えない）。テストで固定する（Task 3b）
- **L-059**（モックだけで確かめない）: 隠れた git は実 git の統合テストを主にし、未確認事項 1〜3 を実装の最初に確かめる（Task 2a・3b・4）
- **L-060**（必須の依存・型）: `BaselineSnapshot.gitDir`・`BaselineGitLocation`・`TakeBaselineOptions.instanceId`・`recording.storage` を必須にし、配線の変異で落ちるテストを確かめる（Task 1・2b・3a・5）
- **L-061**（新しい状態の入口を列挙する）: 設計書の「新しい状態と既存の入口」の表の各入口を、Task 3a〜5 のテストで押さえる（Self-Review の表）
- **L-072**（手動テストで利用者のファイル・設定を消さない）: 実機テスト仕様書の手順は毎回 `mktemp -d` のフォルダで行い、消すコマンドに作ったフォルダの絶対パスを書き、プロセスを止める項目は pid が Electron であることを確かめてから止める（Task 6）
- **L-075**（別の index で git を動かしても漏れる経路）: `GIT_DIR`・`GIT_WORK_TREE`・`GIT_INDEX_FILE` は `buildBaselineGitEnv` の 1 か所で常に付け、親の位置の変数を除いた後に置く。テストで別のリポジトリを指す親の環境を入れて確かめる（Task 1・3b）
- **L-079**（環境変数の大文字小文字）: 除き方は今どおり大文字小文字を問わない（`git_dir` を残さない）（Task 1）
- **L-186・L-268**（統合テストの隔離）: 大域の `init.templateDir`・`core.hooksPath`（`post-index-change`）・`core.fsmonitor`・`init.defaultObjectFormat` を意図して設定した `HOME` でテストを通す（Task 2a・4）
- **L-354**（実機で動かさずに書いた仕様書）: 実機テスト仕様書の新しい項目は、実装後の文言・コードと照らし合わせてから追記する（Task 6）
- **L-403・L-428**（同じ寿命の状態・試し直しの残り）: 隠れた git の寿命を累積の始点の一時ディレクトリに持たせ、保護の ref を作らないことで、消えた場所への削除の試し直しが残る経路を作らない（Task 3b）
- **L-435**（閉じた状態）: 起動時の掃除は自分の `instanceId` のものを消さない。終了中（`close` の後）の記録は今の registry の扱い（取れたものをその場で消す）のまま（Task 2b）
- **L-437**（存在だけで「自分のもの」と判定しない）: 掃除の判定を `lstat`・リンクでない・持ち主・0700 の純粋な関数にして固定する。区切りの `gitDir` もリンクでないディレクトリであることを確かめる（Task 1・2b・3b）

### ファイルの構成（作る・変えるもの）

| ファイル | 責務 | タスク |
| --- | --- | --- |
| `src/main/agentBaselineGit.ts` | `BaselineGitLocation`・`buildIsolatedGitEnv`・`buildBaselineGitEnv(source, location)`・場所を受け取る `createBaselineGit`・`runBaselineGitWithInput(Sync)`・`createRecordRepoGit`・`readRecordHead`（1）、spawn の共通部分と `runIsolatedGit`（2a） | 1・2a |
| `src/main/agentBaselineCoverage.ts` | `assertBaselineRecord`・`assertBaselineGitDir`（`assertBaselineIndex` を置き換える） | 1 |
| `src/main/agentBaselineSnapshot.ts` | `BaselineSnapshot.gitDir`・場所で git を作る（1）、`instanceId`・一時ディレクトリの名前（2b）、`base`・`BaselineCheckpointBase`（3a）、`resolveBaselineMode`・方式ごとの記録・`inheritedIgnoredPaths` の注入（3b） | 1・2b・3a・3b |
| `src/main/agentChangesQuery.ts`・`src/main/agentChangeDiff.ts` | 場所を記録から渡す・前提の確かめ・`readRecordHead` | 1 |
| `src/main/agentChangesRevert.ts` | `gitsFor` の `createRecordRepoGit` | 1 |
| `src/main/agentChangesProtectionRef.ts` | リポジトリの方式の場所で `runBaselineGitWithInput(Sync)` を呼ぶ | 1 |
| `src/main/agentBaselineHiddenGit.ts`（新規） | `createHiddenGit`・既定の一覧・設定・`info/exclude` の中身・空の index のパス | 2a |
| `src/main/agentBaselineTempSweep.ts`（新規） | 接頭辞・`baselineTempDirPrefix`・`parseBaselineTempDirName`・`isOwnBaselineTempDir`・`sweepStaleBaselineTempDirs` | 2b |
| `src/main/ipcHandlers.ts` | `instanceId` を 1 回作って保護と `takeSnapshot` の包みに渡す・起動時の掃除 | 2b |
| `src/main/agentBaselineLifecycle.ts` | コメント（異常終了の残りは次の起動で消す） | 2b |
| `src/main/agentChangesRecord.ts` | `checkpointBaseOf`（3a）、`summarizeAgentChangesRecord` の `storage`（5） | 3a・5 |
| `src/main/agentBaselineRegistry.ts` | 依存の `takeSnapshot` の `base`・実行の区切りと判定の区切りの `base`（3a）、`syncProtectionValue` の先頭の分岐（3b） | 3a・3b |
| `src/main/gitRepoDetection.ts`（新規）・`src/main/gitRemoteSetupService.ts` | `isInsideGitDirectory` の移動 | 3b |
| `src/shared/types/agentChanges.ts` | 理由 `too-many-files`・`inside-git-dir`（3b）、`AgentChangesStorage`・`storage`（5） | 3b・5 |
| `src/renderer/src/lib/agentChangesMessages.ts` | 新しい理由の全文・短い形・件数（3b）、NOTE・HINT・`not-repository` の全文（5） | 3b・5 |
| `src/renderer/src/types.ts`・`src/renderer/src/lib/agentChangesView.ts` | 写しの `storage` | 5 |
| `src/renderer/src/lib/agentChangesSectionText.ts` | `describeAgentChangesStorage` | 5 |
| `src/renderer/src/components/source-control/AgentChangesSection.tsx`・`NotRepositoryView.tsx` | Git 管理外の分岐と特例の撤去・注記の 1 行・コメント | 5 |
| `src/main/__tests__/helpers/agentBaselineFixtures.ts` | `makeBaselineSnapshot` の `gitDir`・`repoLocation`（1）、`instanceId`（2b）、`snapshotBase`（3a）、`createAgentNonGitFolder`・`folderEntries`・`folderChangesExcept`（3b）、`attributionOffRecordingState` の `storage`（5） | 1・2b・3a・3b・5 |
| `src/renderer/src/__tests__/makeAgentChangesState.ts` | 状態・写し・一覧の結果の `storage` の既定（`'repository'`） | 5 |
| `ROADMAP.md`・`docs/superpowers/specs/2026-10-06-agent-changes-review-design.md`・設計書の「既知の制約」・`docs/manual-test-spec.md` | 項目の完了・新しい節・既知の制約・注記・AGC-005 と GIT-006 の直し・AGC-131〜143 | 6 |

---

### Task 1: 記録の git の場所（main。挙動はリポジトリのまま）

> **設計書の読む節:** 「決めたこと（推奨案で決めた事項）」の「HEAD」「コンフリクトの判定・blob の有無の確認」、「記録の方式（main）」の「記録の git の場所と環境」、「一覧・diff・戻す・取り消し・実行ごと・区別」の表、「セキュリティ」の環境変数の行、「テスト方針」の `agentBaselineGit.test.ts`、「確認の結果」14。
>
> **気をつける知見:** L-075（位置の変数は `buildBaselineGitEnv` の 1 か所で常に付ける。独立したリテラルで固定）・L-079（大文字小文字を問わずに除く）・L-060（`gitDir` を必須にして呼び出し元の直し忘れを型検査で落とす）・L-002・L-437（`gitDir` がリンクでないディレクトリでなければ `記録が見つかりません`）

この Task では、すべての記録の `gitDir` が null（リポジトリの方式）なので、利用者から見える挙動は変わらない。

**Files:**
- Modify: `src/main/agentBaselineGit.ts`（`BaselineGitLocation`・`buildIsolatedGitEnv`・`buildBaselineGitEnv`・`createBaselineGit`・`runBaselineGitWithInput`・`runBaselineGitWithInputSync`・`createRecordRepoGit`〈新規〉・`readRecordHead`〈新規〉）
- Modify: `src/main/agentBaselineCoverage.ts`（`assertBaselineIndex` → `assertBaselineRecord`・`assertBaselineGitDir`）
- Modify: `src/main/agentBaselineSnapshot.ts`（`BaselineSnapshot.gitDir`・場所の組み立て・戻り値の `gitDir: null`）
- Modify: `src/main/agentChangesQuery.ts`・`src/main/agentChangeDiff.ts`・`src/main/agentChangesRevert.ts`・`src/main/agentChangesProtectionRef.ts`
- Modify: `src/main/__tests__/helpers/agentBaselineFixtures.ts`（`makeBaselineSnapshot` の `gitDir: null`・`repoLocation`）・`src/main/__tests__/helpers/agentBaselineFixtures.test.ts`
- Test: `src/main/__tests__/agentBaselineGit.test.ts`・`src/main/__tests__/agentBaselineGit.spawn.test.ts`・`src/main/__tests__/agentBaselineCoverage.test.ts`
- Modify（呼び出しの形の追随）: `src/main/__tests__/agentBaselineSnapshot.integration.test.ts`・`src/main/__tests__/agentChangesProtectionRef.integration.test.ts`・`src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`

**Interfaces:**
- Consumes: 既存の `BaselineGitOptions`（`timeoutMs`・`config`・`env`）・`SIMPLE_GIT_BLOCKED_ENV_KEYS`・`REPO_LOCATION_ENV_KEYS`・`createRepoGit(folderPath, { timeoutMs })`・`ProtectionGitContext`（`folderPath`・`indexPath`・`noHooksDir`。変えない）
- Produces:
```ts
// src/main/agentBaselineGit.ts
export type BaselineGitLocation = Pick<BaselineSnapshot, 'folderPath' | 'indexPath' | 'gitDir'>
export function buildIsolatedGitEnv(source: NodeJS.ProcessEnv): Record<string, string>
export function buildBaselineGitEnv(source: NodeJS.ProcessEnv, location: BaselineGitLocation): Record<string, string>
export function createBaselineGit(location: BaselineGitLocation, options?: BaselineGitOptions): SimpleGit
export function runBaselineGitWithInput(location: BaselineGitLocation, args: readonly string[], input: string, options?: BaselineGitOptions): Promise<string>
export function runBaselineGitWithInputSync(location: BaselineGitLocation, args: readonly string[], input: string, options?: BaselineGitOptions): boolean
export function createRecordRepoGit(location: BaselineGitLocation, options?: BaselineGitOptions): SimpleGit
export function readRecordHead(location: BaselineGitLocation, options?: BaselineGitOptions): Promise<string | null>

// src/main/agentBaselineCoverage.ts
export const AGENT_BASELINE_RECORD_MISSING_MESSAGE = '記録が見つかりません'
export async function assertBaselineRecord(snapshot: Pick<BaselineSnapshot, 'indexPath' | 'gitDir'>): Promise<void>
export async function assertBaselineGitDir(snapshot: Pick<BaselineSnapshot, 'gitDir'>): Promise<void>

// src/main/agentBaselineSnapshot.ts(BaselineSnapshot に足す)
/** 隠れた git(記録専用の bare リポジトリ。累積の始点の一時ディレクトリの中)の場所。null はリポジトリの方式(利用者の .git を使う) */
gitDir: string | null

// src/main/__tests__/helpers/agentBaselineFixtures.ts
export function repoLocation(folderPath: string, indexPath: string): BaselineGitLocation
```

- [ ] **Step 1: 失敗するテストを書く（環境・場所・前提の確かめ）**

`src/main/__tests__/helpers/agentBaselineFixtures.ts`:
1. import に `import type { BaselineGitLocation } from '../../agentBaselineGit'` を足す
2. `makeBaselineSnapshot` の戻り値の `indexPath: \`${tempDir}/index\`,` の次の行に `gitDir: null,` を足す
3. `makeBaselineSnapshot` の後に足す:
```ts
// リポジトリの方式の記録の git の場所(gitDir null)。記録の git を直接呼ぶテストで使う
export function repoLocation(folderPath: string, indexPath: string): BaselineGitLocation {
  return { folderPath, indexPath, gitDir: null }
}
```

`src/main/__tests__/helpers/agentBaselineFixtures.test.ts` の `describe('makeBaselineSnapshot', ...)` の `既定値で埋める` と `渡したフィールドだけを上書きする` の 2 つのテストの期待値（どちらも `makeBaselineSnapshot` の戻り値を `toEqual` で全項目比べる）の `indexPath: '/tmp/baseline/index',` の次の行に、それぞれ `gitDir: null,` を足す。

`src/main/__tests__/agentBaselineGit.test.ts`:
1. import を次にする（`buildIsolatedGitEnv`・`createRecordRepoGit`・`readRecordHead` と型を足す）:
```ts
import {
  AGENT_BASELINE_GIT_TIMEOUT_MS,
  REPO_LOCATION_ENV_KEYS,
  SIMPLE_GIT_BLOCKED_ENV_KEYS,
  buildBaselineGitEnv,
  buildIsolatedGitEnv,
  createBaselineGit,
  createRecordRepoGit,
  readRecordHead,
  runBaselineGitWithInput
} from '../agentBaselineGit'
import type { BaselineGitLocation } from '../agentBaselineGit'
```
   と、`./helpers/agentBaselineFixtures` の import に `repoLocation` を足す
2. `describe('buildBaselineGitEnv', ...)` の前に足す:
```ts
// リポジトリの方式の場所(環境の組み立てだけを見るため、フォルダは使わない)
const at = (indexPath: string): BaselineGitLocation => ({ folderPath: '/repo', indexPath, gitDir: null })
```
3. `describe('buildBaselineGitEnv', ...)` の中のすべての `buildBaselineGitEnv(<環境>, '/tmp/baseline/index')`・`buildBaselineGitEnv(<環境>, '/i')` の第 2 引数を `at('/tmp/baseline/index')`・`at('/i')` にする（期待値は変えない）
4. `describe('buildBaselineGitEnv', ...)` の最後の `it` の後(その describe の閉じ括弧 `})` の直前)に、次をそのまま挿入する(挿入する文の途中で `buildBaselineGitEnv` の describe を閉じ、`buildIsolatedGitEnv` の describe を開く。元の閉じ括弧がそれを閉じる):
```ts
  it('隠れた git(gitDir が文字列)なら、親の位置の変数(別の綴りを含む)を外した後に GIT_DIR・GIT_WORK_TREE・GIT_INDEX_FILE を置く(L-075・L-079)', () => {
    expect(
      buildBaselineGitEnv(
        {
          PATH: '/usr/bin',
          GIT_DIR: '/elsewhere/.git',
          git_dir: '/other/.git',
          GIT_WORK_TREE: '/elsewhere',
          GIT_OBJECT_DIRECTORY: '/elsewhere/.git/objects',
          GIT_INDEX_FILE: '/elsewhere/.git/index'
        },
        { folderPath: '/folder', indexPath: '/tmp/b/index', gitDir: '/tmp/b/git' }
      )
    ).toEqual({
      PATH: '/usr/bin',
      GIT_INDEX_FILE: '/tmp/b/index',
      GIT_DIR: '/tmp/b/git',
      GIT_WORK_TREE: '/folder'
    })
  })

  it('gitDir が null なら GIT_DIR・GIT_WORK_TREE を置かない(リポジトリの方式は今と同じ)', () => {
    expect(
      buildBaselineGitEnv({ PATH: '/usr/bin', GIT_DIR: '/elsewhere/.git' }, at('/tmp/b/index'))
    ).toEqual({ PATH: '/usr/bin', GIT_INDEX_FILE: '/tmp/b/index' })
  })
})

describe('buildIsolatedGitEnv', () => {
  it('拒否される変数・位置の変数・設定の組を外し、位置の変数を足さない(隠れた git の作成で使う)', () => {
    expect(
      buildIsolatedGitEnv({
        PATH: '/usr/bin',
        HOME: '/home/me',
        EDITOR: 'vim',
        GIT_DIR: '/elsewhere/.git',
        git_work_tree: '/elsewhere',
        GIT_INDEX_FILE: '/elsewhere/.git/index',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.pager',
        GIT_CONFIG_VALUE_0: 'cat',
        UNDEFINED_VALUE: undefined
      })
    ).toEqual({ PATH: '/usr/bin', HOME: '/home/me' })
  })
```
5. `describe('createBaselineGit(実 git)', ...)` と `describe('runBaselineGitWithInput(実 git)', ...)` の中のすべての `createBaselineGit(repo, index` を `createBaselineGit(repoLocation(repo, index)` に、`runBaselineGitWithInput(repo, index,`・`runBaselineGitWithInput(repo, join(indexDir, 'index'),`（改行を挟む形を含む）の最初の 2 つの引数を `repoLocation(repo, index)`・`repoLocation(repo, join(indexDir, 'index'))` の 1 つにする
6. ファイルの最後に足す:
```ts
// 記録の HEAD と、戻す操作のコンフリクトの判定・blob の有無を問い合わせる git の切り替え(設計書「記録の git の場所と環境」)
describe('readRecordHead・createRecordRepoGit(実 git)', () => {
  let repo: string
  let home: string
  let indexDir: string

  beforeEach(() => {
    ;({ repo, home, tempRoot: indexDir } = createAgentBaselineRepo('record-repo-git-'))
    writeRepoFile(repo, 'a.txt', 'a\n')
    commitAll(repo, 'init')
  })

  afterEach(() => disposeAgentBaselineRepo({ repo, home, tempRoot: indexDir }))

  // 隠れた git の場所(中身は空の bare リポジトリ。記録のインデックスは作らない = 空の index)
  const hiddenLocation = (): BaselineGitLocation => {
    const gitDir = join(indexDir, 'git')
    runGit(indexDir, 'init', '-q', '--bare', '--template=', gitDir)
    return { folderPath: repo, indexPath: join(indexDir, 'index'), gitDir }
  }

  it('リポジトリの方式の HEAD は利用者の HEAD', async () => {
    await expect(readRecordHead(repoLocation(repo, join(indexDir, 'index')))).resolves.toBe(
      runGit(repo, 'rev-parse', 'HEAD').trim()
    )
  })

  it('隠れた git の HEAD は git を呼ばずに null(git が無くても解決する)', async () => {
    const location = hiddenLocation()
    vi.stubEnv('PATH', join(home, 'no-bin'))
    await expect(readRecordHead(location)).resolves.toBeNull()
  })

  it('リポジトリの方式の createRecordRepoGit は利用者の index で問い合わせる', async () => {
    const listed = await createRecordRepoGit(repoLocation(repo, join(indexDir, 'index'))).raw([
      'ls-files',
      '-z'
    ])
    expect(listed.split('\0').filter((p) => p !== '')).toEqual(['a.txt'])
  })

  it('隠れた git の createRecordRepoGit は記録のインデックス(ここでは無い = 空)で問い合わせる', async () => {
    await expect(createRecordRepoGit(hiddenLocation()).raw(['ls-files', '-z'])).resolves.toBe('')
  })
})
```

`src/main/__tests__/agentBaselineGit.spawn.test.ts`:
1. import に `import type { BaselineGitLocation } from '../agentBaselineGit'` を足し、`describe('runBaselineGitWithInput の spawn', ...)` の前に足す（このファイルは `node:child_process` をモックするため、実 git の補助〈fixtures〉を import しない）:
```ts
const LOCATION: BaselineGitLocation = { folderPath: '/repo', indexPath: '/tmp/index', gitDir: null }
```
2. すべての `runBaselineGitWithInput('/repo', '/tmp/index',`・`runBaselineGitWithInputSync('/repo', '/tmp/index',`（改行を挟む形を含む）の最初の 2 つの引数を `LOCATION` の 1 つにする（期待値は変えない）
3. `describe('runBaselineGitWithInput の spawn', ...)` の最後に足す:
```ts
  it('隠れた git の場所なら GIT_DIR・GIT_WORK_TREE も環境に置き、cwd は開いたフォルダ', async () => {
    await runBaselineGitWithInput(
      { folderPath: '/folder', indexPath: '/tmp/b/index', gitDir: '/tmp/b/git' },
      ['ls-files'],
      '',
      { env: { PATH: '/bin', GIT_DIR: '/elsewhere' } }
    )
    const [, , options] = spawnMock.mock.calls[0] as [string, string[], object]
    expect(options).toEqual({
      cwd: '/folder',
      env: {
        PATH: '/bin',
        GIT_INDEX_FILE: '/tmp/b/index',
        GIT_DIR: '/tmp/b/git',
        GIT_WORK_TREE: '/folder'
      },
      windowsHide: true
    })
  })
```

`src/main/__tests__/agentBaselineCoverage.test.ts`:
1. import の `assertBaselineIndex` を `assertBaselineGitDir, assertBaselineRecord` にし、`node:fs` の import に `symlinkSync` を足す
2. `describe('assertBaselineIndex', ...)` の全体を次に置き換える:
```ts
describe('assertBaselineRecord・assertBaselineGitDir', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-baseline-coverage-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const indexAt = (): string => {
    const indexPath = join(dir, 'index')
    writeFileSync(indexPath, '')
    return indexPath
  }

  it('リポジトリの方式(gitDir null)は記録のインデックスだけを確かめる', async () => {
    await expect(assertBaselineRecord({ indexPath: indexAt(), gitDir: null })).resolves.toBeUndefined()
    await expect(
      assertBaselineRecord({ indexPath: join(dir, 'missing'), gitDir: null })
    ).rejects.toThrow('記録が見つかりません')
  })

  it('記録のインデックスがファイルでなければ(フォルダ)拒否する', async () => {
    const indexPath = join(dir, 'index')
    mkdirSync(indexPath)
    await expect(assertBaselineRecord({ indexPath, gitDir: null })).rejects.toThrow(
      '記録が見つかりません'
    )
  })

  it('隠れた git は gitDir がシンボリックリンクでないディレクトリであることも確かめる(L-002・L-437)', async () => {
    const indexPath = indexAt()
    const gitDir = join(dir, 'git')
    mkdirSync(gitDir)
    await expect(assertBaselineRecord({ indexPath, gitDir })).resolves.toBeUndefined()
    await expect(
      assertBaselineRecord({ indexPath, gitDir: join(dir, 'missing') })
    ).rejects.toThrow('記録が見つかりません')
    const link = join(dir, 'link')
    symlinkSync(gitDir, link)
    await expect(assertBaselineRecord({ indexPath, gitDir: link })).rejects.toThrow(
      '記録が見つかりません'
    )
  })

  it('assertBaselineGitDir は gitDir だけを確かめ、null なら何もしない', async () => {
    await expect(assertBaselineGitDir({ gitDir: null })).resolves.toBeUndefined()
    const file = join(dir, 'file')
    writeFileSync(file, '')
    await expect(assertBaselineGitDir({ gitDir: file })).rejects.toThrow('記録が見つかりません')
  })
})
```

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineGit.test.ts src/main/__tests__/agentBaselineGit.spawn.test.ts src/main/__tests__/agentBaselineCoverage.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts`
Expected: FAIL（`buildIsolatedGitEnv`・`createRecordRepoGit`・`readRecordHead`・`assertBaselineRecord`・`assertBaselineGitDir` が無い、`buildBaselineGitEnv` が場所を受け取らない、`makeBaselineSnapshot` に `gitDir` が無い）

- [ ] **Step 3: 記録の git の場所と環境を実装する**

`src/main/agentBaselineGit.ts`:
1. 先頭の import の後に `import type { BaselineSnapshot } from './agentBaselineSnapshot'` を足す（型だけ。`agentBaselineSnapshot.ts` からの値の import と循環しない）
2. 先頭のコメントの最後の行（`// 既知の制約: 除く変数に GIT_CONFIG_GLOBAL・…`）の前に足す:
```ts
// 記録の git の場所は BaselineGitLocation で受け取る。隠れた git(Git 管理外のフォルダの記録。2026-10-15 の設計書)は GIT_DIR・
// GIT_WORK_TREE を、この環境の組み立ての 1 か所で常に付ける(呼び出しごとに選ばない。L-075)
```
3. `/** source から除く変数を外し、GIT_INDEX_FILE を indexPath にした環境(…) */ export function buildBaselineGitEnv(...) { ... }` の全体を次に置き換える:
```ts
/** 記録の git の場所。gitDir が null ならリポジトリの方式(利用者の .git の object の DB を使う) */
export type BaselineGitLocation = Pick<BaselineSnapshot, 'folderPath' | 'indexPath' | 'gitDir'>

/**
 * source から除く変数(simple-git が拒否する変数・位置の変数・設定の組。大文字小文字を問わない。L-079)を外した環境。
 * 位置の変数は足さない(隠れた git の作成 runIsolatedGit と、buildBaselineGitEnv が使う)。source の既定値は無い
 */
export function buildIsolatedGitEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    const lower = key.toLowerCase().trim()
    if (
      SIMPLE_GIT_BLOCKED_ENV_KEYS.includes(lower) ||
      REPO_LOCATION_ENV_KEYS.includes(lower) ||
      isConfigPairKey(lower)
    ) {
      continue
    }
    env[key] = value
  }
  return env
}

/**
 * 記録の git の環境: buildIsolatedGitEnv の後に GIT_INDEX_FILE を記録のインデックスにし、隠れた git(gitDir が文字列)なら
 * GIT_DIR・GIT_WORK_TREE(開いたフォルダ)も置く。親の位置の変数を除いた後に置くため、別のリポジトリを指さない(L-075)
 */
export function buildBaselineGitEnv(
  source: NodeJS.ProcessEnv,
  location: BaselineGitLocation
): Record<string, string> {
  const env = buildIsolatedGitEnv(source)
  env.GIT_INDEX_FILE = location.indexPath
  if (location.gitDir !== null) {
    env.GIT_DIR = location.gitDir
    env.GIT_WORK_TREE = location.folderPath
  }
  return env
}
```
4. `createBaselineGit` を次にする（コメントと本体。`config` の扱いは今と同じ）:
```ts
/** 記録の場所(記録のインデックス・隠れた git)で問い合わせる git。cwd は作業ツリーの最上位(location.folderPath) */
export function createBaselineGit(
  location: BaselineGitLocation,
  {
    timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS,
    config = [],
    env = process.env
  }: BaselineGitOptions = {}
): SimpleGit {
  // 一覧・diff・戻す操作の git も記録のインデックスを(stat 情報の更新で)書き直すことがある。利用者の core.splitIndex=true が
  // 効くと、共有部分の sharedindex.<sha> が利用者の .git に作られるため、常に split 形式を使わない(最終レビュー A の I1)
  return simpleGit(location.folderPath, {
    timeout: { block: timeoutMs },
    config: ['core.splitIndex=false', ...config]
  }).env(buildBaselineGitEnv(env, location))
}
```
5. `createRepoGit` の後に足す:
```ts
/**
 * 戻す操作のコンフリクトの判定と blob の有無を問い合わせる git。リポジトリの方式は利用者の index(createRepoGit)、隠れた git は
 * 記録の git(記録のインデックスはコンフリクトのエントリを持たず、blob は隠れた git の DB にしかない)
 */
export function createRecordRepoGit(
  location: BaselineGitLocation,
  options: BaselineGitOptions = {}
): SimpleGit {
  return location.gitDir === null
    ? createRepoGit(location.folderPath, options)
    : createBaselineGit(location, options)
}

/**
 * 記録の HEAD・一覧の HEAD の比較に使う HEAD。リポジトリの方式は利用者の HEAD(コミットが無ければ null。打ち切りなどの失敗は投げる)、
 * 隠れた git は git を呼ばずに null(Git 管理外には HEAD が無く、記録中に git init・コミットしても隠れた git の記録とは関係が無い)
 */
export async function readRecordHead(
  location: BaselineGitLocation,
  options: BaselineGitOptions = {}
): Promise<string | null> {
  if (location.gitDir !== null) return null
  const output = await createRepoGit(location.folderPath, options).raw([
    'rev-parse',
    '--verify',
    '-q',
    'HEAD'
  ])
  return output.trim() || null
}
```
6. `runBaselineGitWithInput` の引数の `folderPath: string, indexPath: string,` を `location: BaselineGitLocation,` にし、本体の `cwd: folderPath,` を `cwd: location.folderPath,`、`env: buildBaselineGitEnv(env, indexPath),` を `env: buildBaselineGitEnv(env, location),` にする。コメントの `記録のインデックス indexPath で、` を `記録の場所 location で、` にする
7. `runBaselineGitWithInputSync` も 6 と同じに直す

`src/main/agentBaselineCoverage.ts`:
1. `/** 記録のインデックスが消えていると … */ export async function assertBaselineIndex(...) { ... }` の全体を次に置き換える:
```ts
/** 記録が見つからないときの文言(記録のインデックス・隠れた git が消えた。git の fatal をそのまま見せない) */
export const AGENT_BASELINE_RECORD_MISSING_MESSAGE = '記録が見つかりません'

/**
 * 隠れた git(gitDir が文字列)が、シンボリックリンクでないディレクトリであることを確かめる(無ければ git は
 * `fatal: not a git repository` で失敗する。差し替えられたリンクの先を使わない。L-002・L-437)。リポジトリの方式(null)は何もしない
 */
export async function assertBaselineGitDir(
  snapshot: Pick<BaselineSnapshot, 'gitDir'>
): Promise<void> {
  if (snapshot.gitDir === null) return
  const stat = await lstat(snapshot.gitDir).catch(() => null)
  if (stat === null || !stat.isDirectory()) throw new Error(AGENT_BASELINE_RECORD_MISSING_MESSAGE)
}

/**
 * 累積の一覧・diff の前提: 記録のインデックス(消えていると git は空の index として扱い、全体が追加に見える)と、隠れた git の場所
 */
export async function assertBaselineRecord(
  snapshot: Pick<BaselineSnapshot, 'indexPath' | 'gitDir'>
): Promise<void> {
  const stat = await lstat(snapshot.indexPath).catch(() => null)
  if (stat === null || !stat.isFile()) throw new Error(AGENT_BASELINE_RECORD_MISSING_MESSAGE)
  await assertBaselineGitDir(snapshot)
}
```
   （`lstat` は シンボリックリンクに対して `isDirectory()` が偽になる）

`src/main/agentBaselineSnapshot.ts`:
1. import の `import { createBaselineGit, createRepoGit, runBaselineGitWithInput } from './agentBaselineGit'` の次に `import type { BaselineGitLocation } from './agentBaselineGit'` を足す（`import type { BaselineGitOptions } …` の行と 1 つにまとめてよい）
2. `BaselineSnapshot` の `indexPath: string` の次の行に足す:
```ts
  /** 隠れた git(記録専用の bare リポジトリ。累積の始点の一時ディレクトリの中)の場所。null はリポジトリの方式(利用者の .git を使う) */
  gitDir: string | null
```
3. `takeBaselineSnapshot` の `const baselineGit = createBaselineGit(folderPath, indexPath, {` の直前に `const location: BaselineGitLocation = { folderPath, indexPath, gitDir: null }` を足し、`createBaselineGit(folderPath, indexPath, {` を `createBaselineGit(location, {` に、`runBaselineGitWithInput(\n folderPath,\n indexPath,` の 2 つの引数を `location` の 1 つにする
4. 戻り値の `snapshot: { folderPath, tempDir, indexPath,` の `indexPath,` の次に `gitDir: null,` を足す

`src/main/agentChangesQuery.ts`:
1. import の `assertBaselineIndex,` を `assertBaselineGitDir,\n  assertBaselineRecord,` にし、`import { createBaselineGit, createRepoGit } from './agentBaselineGit'` を `import { createBaselineGit, readRecordHead } from './agentBaselineGit'` にする
2. `collectAgentChangeEntries` の `const { folderPath, indexPath } = snapshot\n  await assertBaselineIndex(indexPath)\n  const git = createBaselineGit(folderPath, indexPath, options)` を次にする:
```ts
  const { folderPath } = snapshot
  await assertBaselineRecord(snapshot)
  const git = createBaselineGit(snapshot, options)
```
3. `listAgentChanges` の `const head = await createRepoGit(snapshot.folderPath, options)\n    .raw(['rev-parse', '--verify', '-q', 'HEAD'])\n    .then((output) => output.trim() || null)` を `const head = await readRecordHead(snapshot, options)` にし、関数のコメントを `/** 記録の時点 → いまの作業ツリーの変更の一覧。AGENT_CHANGES_LIST_LIMIT 件で打ち切り、HEAD が変わったかを添える(隠れた git の記録は HEAD が null どうしで常に false) */` にする
4. `collectAgentChangeEntriesBetween` の `const git = createBaselineGit(start.folderPath, start.indexPath, options)` を次にする:
```ts
  // 隠れた git の区切りは累積の始点の隠れた git を共有する。消えていたら git の fatal を見せずに「記録が見つかりません」にする
  // (tree どうしの比較は記録のインデックスを読まないため、インデックスは確かめない)
  await assertBaselineGitDir(start)
  const git = createBaselineGit(start, options)
```

`src/main/agentChangeDiff.ts`:
1. import の `assertBaselineIndex,` を `assertBaselineGitDir,\n  assertBaselineRecord,` にする
2. `getAgentChangeDiff` の `const { folderPath, indexPath } = snapshot\n  await assertBaselineIndex(indexPath)` を `const { folderPath } = snapshot\n  await assertBaselineRecord(snapshot)` にし、`createBaselineGit(folderPath, indexPath, {` を `createBaselineGit(snapshot, {` にする
3. `getAgentChangeDiffBetween` の `const git = createBaselineGit(start.folderPath, start.indexPath, {` の直前に `await assertBaselineGitDir(start)` を足し、`createBaselineGit(start.folderPath, start.indexPath, {` を `createBaselineGit(start, {` にする

`src/main/agentChangesRevert.ts`:
1. `import { createBaselineGit, createRepoGit } from './agentBaselineGit'` を `import { createBaselineGit, createRecordRepoGit } from './agentBaselineGit'` にする
2. 先頭のコメントの `コンフリクトの判定だけは利用者の index で行う` を `コンフリクトの判定と blob の有無は createRecordRepoGit(リポジトリの方式は利用者の index、隠れた git は記録の git)で行う` にする
3. `assess` の中の `// コンフリクトは利用者の index の状態(記録のインデックスには未解決のエントリが無い)` を `// コンフリクトは利用者の index の状態(記録のインデックスには未解決のエントリが無い。隠れた git の記録は常に偽になる)` にする
4. `gitsFor` を次にする:
```ts
function gitsFor(context: AgentRevertContext): { baseline: SimpleGit; repo: SimpleGit } {
  return {
    baseline: createBaselineGit(context.snapshot, context.gitOptions),
    repo: createRecordRepoGit(context.snapshot, context.gitOptions)
  }
}
```

`src/main/agentChangesProtectionRef.ts`:
1. `runProtectionGit` の本体の `runBaselineGitWithInput(ctx.folderPath, ctx.indexPath, args, input, { config: configOf(ctx) })` を次にする:
```ts
  runBaselineGitWithInput(repositoryLocationOf(ctx), args, input, { config: configOf(ctx) })
```
2. `configOf` の定義の後に足す:
```ts
// 保護の ref は リポジトリの方式の記録だけが作る(隠れた git の記録では registry が同期しない)。場所は gitDir null
const repositoryLocationOf = (ctx: ProtectionGitContext): BaselineGitLocation => ({
  folderPath: ctx.folderPath,
  indexPath: ctx.indexPath,
  gitDir: null
})
```
   と、import に `import type { BaselineGitLocation } from './agentBaselineGit'` を足す
3. `deleteProtectionRefSync` の `runBaselineGitWithInputSync(\n    ctx.folderPath,\n    ctx.indexPath,` の 2 つの引数を `repositoryLocationOf(ctx),` の 1 つにする

- [ ] **Step 4: 呼び出しの形が変わった既存のテストを直す**

Run: `grep -rn "createBaselineGit(\|runBaselineGitWithInput(\|runBaselineGitWithInputSync(\|buildBaselineGitEnv(\|assertBaselineIndex" src/main/__tests__`
で当たった行のうち、Step 1 で直していないものを次の規則で直す:
- `src/main/__tests__/agentBaselineSnapshot.integration.test.ts`: `createBaselineGit(repo, snapshot.indexPath)`・`createBaselineGit(worktree, snapshot.indexPath)` を `createBaselineGit(snapshot)` にする（`snapshot.folderPath` は記録を取ったフォルダ）
- `src/main/__tests__/agentChangesProtectionRef.integration.test.ts`: `runBaselineGitWithInput(\n        dirs.repo,\n        index,` の 2 つの引数を `repoLocation(dirs.repo, index),` の 1 つにし、`./helpers/agentBaselineFixtures` の import に `repoLocation` を足す
- `src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`: `runBaselineGitWithInput(\n        repo,\n        indexPath,`・`runBaselineGitWithInput(repo, indexPath,` の 2 つの引数を `repoLocation(repo, indexPath),` の 1 つにし、`../helpers/agentBaselineFixtures` の import に `repoLocation` を足す
- 上の規則に当たらない行が出たら、同じ考え方（`(folderPath, indexPath, …)` の 2 つの引数を `repoLocation(folderPath, indexPath)` にする・記録があればその記録を渡す）で直す

- [ ] **Step 5: テストが通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineGit.test.ts src/main/__tests__/agentBaselineGit.spawn.test.ts src/main/__tests__/agentBaselineCoverage.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/agentChangesQuery.integration.test.ts src/main/__tests__/agentChangesRevert.integration.test.ts src/main/__tests__/agentChangesRuns.integration.test.ts src/main/__tests__/agentChangesProtectionRef.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`
Expected: PASS

- [ ] **Step 6: 変異で確かめる**

1. `buildBaselineGitEnv` の `if (location.gitDir !== null) { ... }` を消す → `npx vitest run src/main/__tests__/agentBaselineGit.test.ts src/main/__tests__/agentBaselineGit.spawn.test.ts` の `隠れた git(gitDir が文字列)なら…`・`隠れた git の場所なら GIT_DIR・GIT_WORK_TREE も…` が落ちる。戻す
2. `readRecordHead` の `if (location.gitDir !== null) return null` を消す → `隠れた git の HEAD は git を呼ばずに null…` が落ちる。戻す
3. `assertBaselineRecord` の `await assertBaselineGitDir(snapshot)` を消す → `隠れた git は gitDir がシンボリックリンクでないディレクトリであることも確かめる…` が落ちる。戻す
4. `git diff` で戻したことを確かめる

- [ ] **Step 7: 全体の検証**

Run: `npm test`
Expected: PASS（時間切れで落ちたファイルは単体で流し直す。Global Constraints）
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/main/agentBaselineGit.ts src/main/agentBaselineCoverage.ts src/main/agentBaselineSnapshot.ts src/main/agentChangesQuery.ts src/main/agentChangeDiff.ts src/main/agentChangesRevert.ts src/main/agentChangesProtectionRef.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentBaselineGit.test.ts src/main/__tests__/agentBaselineGit.spawn.test.ts src/main/__tests__/agentBaselineCoverage.test.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/agentChangesProtectionRef.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts` → `npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 8: コミット（利用者の指示があるときだけ）**

```bash
git add src/main/agentBaselineGit.ts src/main/agentBaselineCoverage.ts src/main/agentBaselineSnapshot.ts src/main/agentChangesQuery.ts src/main/agentChangeDiff.ts src/main/agentChangesRevert.ts src/main/agentChangesProtectionRef.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentBaselineGit.test.ts src/main/__tests__/agentBaselineGit.spawn.test.ts src/main/__tests__/agentBaselineCoverage.test.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/agentChangesProtectionRef.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts
git commit -m "refactor: 記録の git の場所を BaselineGitLocation にまとめ、隠れた git の GIT_DIR・GIT_WORK_TREE を環境の 1 か所で付ける"
```

---

### Task 2a: 隠れた git の作成（main。未確認事項 1・3 の確かめ）

> **設計書の読む節:** 「決めたこと（推奨案で決めた事項）」の「隠れた git の作り方」「ファイルシステムの性質」、「記録の方式（main）」の「隠れた git の作成」「記録に含めないもの（既定の一覧）」、「確認の結果」1・2・9・11・13、「セキュリティ」の hook・テンプレート・fsmonitor・引数インジェクションの行、「テスト方針」の `agentBaselineHiddenGit.integration.test.ts`、「未確認事項」1・3。
>
> **気をつける知見:** L-059（実 git で確かめる）・L-186・L-268（大域の `init.templateDir`・`core.hooksPath`・`core.fsmonitor`・`init.defaultObjectFormat` を設定した `HOME` で通す）・L-075（`init` の環境も位置の変数を外す）・L-034（パスを git の引数にしない。`init` は cwd からの相対の名前）

この Task では隠れた git を作る部品だけを作り、記録（`takeBaselineSnapshot`）からはまだ呼ばない。

**Files:**
- Modify: `src/main/agentBaselineGit.ts`（spawn の共通部分 `spawnGitWithInput`〈非公開〉・`runIsolatedGit`〈新規〉）
- Create: `src/main/agentBaselineHiddenGit.ts`
- Test: `src/main/__tests__/agentBaselineHiddenGit.test.ts`（新規。純粋な値）・`src/main/__tests__/agentBaselineHiddenGit.integration.test.ts`（新規。実 git）・`src/main/__tests__/agentBaselineGit.spawn.test.ts`

**Interfaces:**
- Consumes: Task 1 の `buildIsolatedGitEnv`・`createBaselineGit(location)`・`BaselineGitLocation`・`BaselineGitOptions`、既存の `parseWriteTreeOutput`（`agentBaselineSnapshot.ts`）・`isGitTimeoutError`（`gitStepErrors.ts`）・`AGENT_BASELINE_GIT_TIMEOUT_MS`
- Produces:
```ts
// src/main/agentBaselineGit.ts
export function runIsolatedGit(
  cwd: string,
  args: readonly string[],
  options?: BaselineGitOptions & { extraEnv?: Record<string, string> }
): Promise<string>

// src/main/agentBaselineHiddenGit.ts
export const AGENT_BASELINE_DEFAULT_EXCLUDES: readonly string[]
export function hiddenGitConfig(gitDir: string): readonly (readonly [string, string])[]
export function hiddenGitExcludeContent(): string
export function hiddenGitEmptyIndexPath(tempDir: string): string
export async function createHiddenGit(tempDir: string, gitOptions?: BaselineGitOptions): Promise<string>
```

- [ ] **Step 1: 失敗するテストを書く（純粋な値と spawn）**

`src/main/__tests__/agentBaselineHiddenGit.test.ts`（新規）:
```ts
import { describe, it, expect } from 'vitest'
import {
  AGENT_BASELINE_DEFAULT_EXCLUDES,
  hiddenGitConfig,
  hiddenGitEmptyIndexPath,
  hiddenGitExcludeContent
} from '../agentBaselineHiddenGit'

// 記録に含めない既定の一覧(設計書「記録に含めないもの(既定の一覧)」)。実装の一覧とは別にリテラルで持ち、実装から 1 個消えたら落ちるようにする
const EXPECTED_DEFAULT_EXCLUDES = [
  'node_modules/',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.next/',
  'dist/',
  'build/',
  'target/',
  '.DS_Store',
  'Thumbs.db'
]

describe('隠れた git の既定の一覧と設定', () => {
  it('既定の一覧は設計書の 10 個(この順)', () => {
    expect([...AGENT_BASELINE_DEFAULT_EXCLUDES]).toEqual(EXPECTED_DEFAULT_EXCLUDES)
  })

  it('フォルダは末尾の / でフォルダだけに当て、先頭に / を付けない(どの深さでも当てる)。.git/ と .env は書かない', () => {
    for (const pattern of AGENT_BASELINE_DEFAULT_EXCLUDES) expect(pattern.startsWith('/')).toBe(false)
    expect(AGENT_BASELINE_DEFAULT_EXCLUDES).not.toContain('.git/')
    expect(AGENT_BASELINE_DEFAULT_EXCLUDES.some((pattern) => pattern.includes('.env'))).toBe(false)
  })

  it('隠れた git の設定は core.fsmonitor=false・gc.auto=0・maintenance.auto=false・core.hooksPath=<gitDir>/no-hooks の 4 つ', () => {
    expect(hiddenGitConfig('/t/git')).toEqual([
      ['core.fsmonitor', 'false'],
      ['gc.auto', '0'],
      ['maintenance.auto', 'false'],
      ['core.hooksPath', '/t/git/no-hooks']
    ])
  })

  it('info/exclude の中身は、注釈の行の後に既定の一覧を 1 行ずつ', () => {
    expect(hiddenGitExcludeContent()).toBe(
      `# prompt-ide が書いた既定の一覧（記録に含めないもの）\n${EXPECTED_DEFAULT_EXCLUDES.join('\n')}\n`
    )
  })

  it('未追跡の事前の検査の空の index は、記録の一時ディレクトリの empty-index', () => {
    expect(hiddenGitEmptyIndexPath('/t')).toBe('/t/empty-index')
  })
})
```

`src/main/__tests__/agentBaselineGit.spawn.test.ts`:
1. `import { runBaselineGitWithInput, runBaselineGitWithInputSync } from '../agentBaselineGit'` に `runIsolatedGit` を足す
2. ファイルの最後に足す:
```ts
describe('runIsolatedGit の spawn', () => {
  it('位置の変数を外し(足さず)、extraEnv だけを足して cwd で起動する', async () => {
    await runIsolatedGit('/tmp/rec', ['init', '--bare', '-q', '--template=', 'git'], {
      env: { PATH: '/bin', GIT_DIR: '/elsewhere', GIT_INDEX_FILE: '/x', EDITOR: 'vim' },
      extraEnv: { GIT_DIR: '/tmp/rec/git' }
    })
    const [command, args, options] = spawnMock.mock.calls[0] as [string, string[], object]
    expect(command).toBe('git')
    expect(args).toEqual(['-c', 'core.splitIndex=false', 'init', '--bare', '-q', '--template=', 'git'])
    expect(options).toEqual({
      cwd: '/tmp/rec',
      env: { PATH: '/bin', GIT_DIR: '/tmp/rec/git' },
      windowsHide: true
    })
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（実 git）**

`src/main/__tests__/agentBaselineHiddenGit.integration.test.ts`（新規）:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBaselineGit, runIsolatedGit } from '../agentBaselineGit'
import type { BaselineGitLocation } from '../agentBaselineGit'
import {
  AGENT_BASELINE_DEFAULT_EXCLUDES,
  createHiddenGit,
  hiddenGitExcludeContent
} from '../agentBaselineHiddenGit'
import { parseWriteTreeOutput } from '../agentBaselineSnapshot'
import { isGitTimeoutError } from '../gitStepErrors'
import { runGit, stubGitHome, stubIsolatedGitEnv, writeRepoFile } from './helpers/realGitRepo'

// 隠れた git の作成(設計書「隠れた git の作成」)を実 git で試す。利用者の大域の設定は、隔離した HOME の .gitconfig に書いて試す
// (記録の git は GIT_CONFIG_GLOBAL を外して HOME の設定を読む。テストの runGit は GIT_CONFIG_GLOBAL=/dev/null のため --global は効かない)

describe('createHiddenGit(実 git)', () => {
  let home: string
  let tempDir: string
  let folder: string

  beforeEach(() => {
    stubIsolatedGitEnv()
    home = mkdtempSync(join(tmpdir(), 'hidden-git-home-'))
    stubGitHome(home)
    // 記録の一時ディレクトリ(takeBaselineSnapshot の mkdtemp と同じ役割)と、Git 管理外のフォルダ
    tempDir = mkdtempSync(join(tmpdir(), 'hidden-git-temp-'))
    folder = realpathSync(mkdtempSync(join(tmpdir(), 'hidden-git-folder-')))
    writeRepoFile(folder, 'a.txt', 'one\ntwo\n')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    for (const dir of [home, tempDir, folder]) rmSync(dir, { recursive: true, force: true })
  })

  const writeGlobalConfig = (body: string): void => writeFileSync(join(home, '.gitconfig'), body)
  const configOf = (gitDir: string, key: string): string =>
    runGit(tempDir, 'config', '--file', join(gitDir, 'config'), '--get', key).trim()
  const locationOf = (gitDir: string): BaselineGitLocation => ({
    folderPath: folder,
    indexPath: join(tempDir, 'index'),
    gitDir
  })

  it('HEAD・config・objects・refs と info だけを作り(hooks・description を作らない)、cwd には git のほかに何も作らない(確認の結果 1)', async () => {
    const gitDir = await createHiddenGit(tempDir)
    expect(gitDir).toBe(join(tempDir, 'git'))
    expect(readdirSync(gitDir).sort()).toEqual(['HEAD', 'config', 'info', 'objects', 'refs'])
    expect(readdirSync(tempDir)).toEqual(['git'])
    expect(configOf(gitDir, 'core.bare')).toBe('true')
  })

  it('利用者の大域の init.templateDir に hook があっても写さない(--template=)', async () => {
    const template = join(home, 'template')
    mkdirSync(join(template, 'hooks'), { recursive: true })
    writeFileSync(join(template, 'hooks', 'post-index-change'), '#!/bin/sh\n', { mode: 0o755 })
    writeGlobalConfig(`[init]\n\ttemplateDir = ${template}\n`)
    const gitDir = await createHiddenGit(tempDir)
    expect(existsSync(join(gitDir, 'hooks'))).toBe(false)
  })

  it('設定に core.fsmonitor=false・gc.auto=0・maintenance.auto=false・core.hooksPath=<gitDir>/no-hooks(作らない)を書く', async () => {
    const gitDir = await createHiddenGit(tempDir)
    expect(configOf(gitDir, 'core.fsmonitor')).toBe('false')
    expect(configOf(gitDir, 'gc.auto')).toBe('0')
    expect(configOf(gitDir, 'maintenance.auto')).toBe('false')
    expect(configOf(gitDir, 'core.hooksPath')).toBe(join(gitDir, 'no-hooks'))
    expect(existsSync(join(gitDir, 'no-hooks'))).toBe(false)
  })

  it('info/exclude に既定の一覧を 0600 で書き、info は 0700', async () => {
    const gitDir = await createHiddenGit(tempDir)
    const exclude = join(gitDir, 'info', 'exclude')
    expect(readFileSync(exclude, 'utf8')).toBe(hiddenGitExcludeContent())
    expect(statSync(exclude).mode & 0o777).toBe(0o600)
    expect(statSync(join(gitDir, 'info')).mode & 0o777).toBe(0o700)
  })

  it('隠れた git で記録すると、info/exclude の既定の一覧とフォルダの .gitignore の両方に従う(確認の結果 2)', async () => {
    writeRepoFile(folder, '.gitignore', 'secret.txt\n')
    writeRepoFile(folder, 'secret.txt', 's\n')
    writeRepoFile(folder, 'node_modules/m.js', 'm\n')
    writeRepoFile(folder, 'packages/x/dist/y.js', 'y\n')
    const gitDir = await createHiddenGit(tempDir)
    const git = createBaselineGit(locationOf(gitDir))
    await git.raw(['add', '-A'])
    expect((await git.raw(['ls-files', '-z'])).split('\0').filter((p) => p !== '')).toEqual([
      '.gitignore',
      'a.txt'
    ])
    expect(AGENT_BASELINE_DEFAULT_EXCLUDES).toContain('node_modules/')
  })

  it('作れなければ例外(呼び出し側が一時ディレクトリごと消して git-failed にする)', async () => {
    await expect(createHiddenGit(join(tempDir, 'missing'))).rejects.toThrow()
  })

  it('init が打ち切りの時間を超えたら、打ち切りの例外にする(呼び出し側が timeout にする)', async () => {
    const bin = join(home, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nexec sleep 5\n', { mode: 0o755 })
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
    const error = await createHiddenGit(tempDir, { timeoutMs: 300 }).catch((e: unknown) => e)
    expect(isGitTimeoutError(error)).toBe(true)
  })

  describe('利用者の大域の core.hooksPath の hook(セキュリティ)', () => {
    let marker: string

    beforeEach(() => {
      const hooks = join(home, 'hooks')
      mkdirSync(hooks)
      marker = join(home, 'hook-ran')
      for (const name of ['post-index-change', 'pre-commit', 'post-checkout', 'reference-transaction']) {
        writeFileSync(join(hooks, name), `#!/bin/sh\necho ${name} >> "${marker}"\n`, { mode: 0o755 })
      }
      writeGlobalConfig(`[core]\n\thooksPath = ${hooks}\n`)
    })

    // 記録・一覧・戻すが使う、index を書きうる命令
    const runSteps = async (location: BaselineGitLocation): Promise<void> => {
      const git = createBaselineGit(location)
      await git.raw(['add', '-A'])
      writeRepoFile(folder, 'a.txt', 'one\nchanged\n')
      await git.raw(['diff'])
      await git.raw(['restore', '--worktree', '--', 'a.txt'])
    }

    it('前提: 隠れた git の設定が無い bare リポジトリでは、記録の命令で大域の hook(post-index-change)が動く', async () => {
      const bare = join(tempDir, 'plain.git')
      runGit(tempDir, 'init', '-q', '--bare', '--template=', bare)
      await runSteps(locationOf(bare))
      expect(existsSync(marker)).toBe(true)
    })

    it('隠れた git では、add・diff・restore の後に hook が動かない(core.hooksPath を gitDir の中の存在しないパスにする)', async () => {
      await runSteps(locationOf(await createHiddenGit(tempDir)))
      expect(existsSync(marker)).toBe(false)
      expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
    })
  })

  it('利用者の大域の core.fsmonitor=true があっても、隠れた git の記録で fsmonitor の daemon を起動しない(未確認事項 1)', async () => {
    writeGlobalConfig('[core]\n\tfsmonitor = true\n')
    const gitDir = await createHiddenGit(tempDir)
    const git = createBaselineGit(locationOf(gitDir))
    await git.raw(['add', '-A'])
    await git.raw(['ls-files', '-z', '--others', '--exclude-standard'])
    const daemonEnv = { extraEnv: { GIT_DIR: gitDir, GIT_WORK_TREE: folder } }
    try {
      // 起動していなければ status は「watching していない」旨か失敗を返す(daemon を持たない git でも失敗する)
      const status = await runIsolatedGit(folder, ['fsmonitor--daemon', 'status'], daemonEnv).then(
        (output) => output,
        (error: Error) => error.message
      )
      expect(status).not.toMatch(/is watching/)
    } finally {
      await runIsolatedGit(folder, ['fsmonitor--daemon', 'stop'], daemonEnv).catch(() => undefined)
    }
  })

  it('大域の init.defaultObjectFormat=sha256 を引き継いでも、記録の tree を 64 桁の ID で作れる(未確認事項 3 の一部。一連の操作は Task 4)', async () => {
    writeGlobalConfig('[init]\n\tdefaultObjectFormat = sha256\n')
    const git = createBaselineGit(locationOf(await createHiddenGit(tempDir)))
    await git.raw(['add', '-A'])
    expect(parseWriteTreeOutput(await git.raw(['write-tree']))).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineHiddenGit.test.ts src/main/__tests__/agentBaselineHiddenGit.integration.test.ts src/main/__tests__/agentBaselineGit.spawn.test.ts`
Expected: FAIL（`agentBaselineHiddenGit.ts`・`runIsolatedGit` が無い）

- [ ] **Step 4: spawn の共通部分と `runIsolatedGit` を実装する**

`src/main/agentBaselineGit.ts`:
1. `runBaselineGitWithInput` の本体（`const configArgs = …` から `return new Promise(…)` の終わりまで）を、次の非公開の関数に移し、`runBaselineGitWithInput` から呼ぶ:
```ts
// spawn で git を起動し、標準入力に input を渡して stdout を返す(runBaselineGitWithInput・runIsolatedGit の共通部分)。
// 打ち切りは timeoutMs の経過で止め、simple-git の打ち切りと同じ判定(isGitTimeoutError)になる GitPluginError にする
function spawnGitWithInput(
  cwd: string,
  env: Record<string, string>,
  args: readonly string[],
  input: string,
  timeoutMs: number,
  config: readonly string[]
): Promise<string> {
  const configArgs = ['core.splitIndex=false', ...config].flatMap((entry) => ['-c', entry])
  return new Promise((resolve, reject) => {
    // (今の runBaselineGitWithInput の Promise の中身をそのまま移す。spawn の cwd は cwd、env は env にする)
  })
}

export function runBaselineGitWithInput(
  location: BaselineGitLocation,
  args: readonly string[],
  input: string,
  {
    timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS,
    config = [],
    env = process.env
  }: BaselineGitOptions = {}
): Promise<string> {
  return spawnGitWithInput(
    location.folderPath,
    buildBaselineGitEnv(env, location),
    args,
    input,
    timeoutMs,
    config
  )
}
```
   （移した中身の `spawn('git', [...configArgs, ...args], { cwd: …, env: …, windowsHide: true })` の `cwd` と `env` だけを引数にし、ほかの行〈打ち切り・stdout・stderr の上限・EPIPE の扱い・終了コード〉は変えない）
2. `runBaselineGitWithInput` の後に足す:
```ts
/**
 * 位置の変数を足さない環境(buildIsolatedGitEnv に extraEnv を足したもの)で git を実行する。隠れた git の作成(init・config)に使う
 * (init の --template= は simple-git が allowUnsafeTemplateDir なしに拒否するため spawn で渡す)。打ち切り・失敗の扱いは
 * runBaselineGitWithInput と同じ。extraEnv は main が作った値だけを渡す(GIT_DIR に隠れた git など)
 */
export function runIsolatedGit(
  cwd: string,
  args: readonly string[],
  {
    timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS,
    config = [],
    env = process.env,
    extraEnv = {}
  }: BaselineGitOptions & { extraEnv?: Record<string, string> } = {}
): Promise<string> {
  return spawnGitWithInput(cwd, { ...buildIsolatedGitEnv(env), ...extraEnv }, args, '', timeoutMs, config)
}
```

- [ ] **Step 5: 隠れた git の作成を実装する**

`src/main/agentBaselineHiddenGit.ts`（新規）:
```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runIsolatedGit } from './agentBaselineGit'
import type { BaselineGitOptions } from './agentBaselineGit'

// Git 管理外のフォルダの記録の隠れた git(設計書 2026-10-15「隠れた git の作成」)。記録の一時ディレクトリ(mkdtemp。0700)の中に
// 記録専用の bare リポジトリを作り、利用者のフォルダには何も書かない。bare にしておけば、GIT_WORK_TREE を渡し忘れた命令は
// 作業ツリーに触れずに失敗する(確認の結果 9)。設定の値・除外の一覧は main の定数だけ(L-034)。ファイルシステムの性質
// (core.ignorecase・core.symlinks・core.filemode・core.precomposeunicode)は git init が一時ディレクトリで調べた値をそのまま使う

/**
 * 記録に含めない既定の一覧(隠れた git の info/exclude)。依存の置き場・生成物・OS が作るファイル。フォルダは末尾の / でフォルダだけに
 * 当て、先頭に / を付けない(どの深さでも当てる)。.env などの秘密のファイルは除かない(エージェントが変えたら一覧に出し、戻せるようにする)。
 * フォルダの .gitignore の !dist/ などで打ち消せる(確認の結果 11)
 */
export const AGENT_BASELINE_DEFAULT_EXCLUDES: readonly string[] = [
  'node_modules/',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.next/',
  'dist/',
  'build/',
  'target/',
  '.DS_Store',
  'Thumbs.db'
]

const HIDDEN_GIT_DIR_NAME = 'git'
const HIDDEN_GIT_NO_HOOKS_NAME = 'no-hooks'
const EMPTY_INDEX_NAME = 'empty-index'
const EXCLUDE_HEADER = '# prompt-ide が書いた既定の一覧（記録に含めないもの）'

/**
 * 隠れた git の設定(利用者の大域の設定より優先される)。fsmonitor の daemon を起動させない・自動の gc と maintenance を起こさない・
 * index を書くたびに動く post-index-change などの hook を利用者の大域の core.hooksPath から動かさない(gitDir の中の存在しない絶対パス)
 */
export function hiddenGitConfig(gitDir: string): readonly (readonly [string, string])[] {
  return [
    ['core.fsmonitor', 'false'],
    ['gc.auto', '0'],
    ['maintenance.auto', 'false'],
    ['core.hooksPath', join(gitDir, HIDDEN_GIT_NO_HOOKS_NAME)]
  ]
}

/** info/exclude の中身(先頭に注釈の行、続けて既定の一覧を 1 行ずつ) */
export function hiddenGitExcludeContent(): string {
  return [EXCLUDE_HEADER, ...AGENT_BASELINE_DEFAULT_EXCLUDES].map((line) => `${line}\n`).join('')
}

/**
 * 未追跡の事前の検査に渡す空の index(作らない)。存在しないファイルを GIT_INDEX_FILE に渡すと、フォルダの ignore されていない
 * ファイルがすべて未追跡として出る(確認の結果 2。意図した「無い」。L-002)
 */
export function hiddenGitEmptyIndexPath(tempDir: string): string {
  return join(tempDir, EMPTY_INDEX_NAME)
}

/**
 * 記録の一時ディレクトリ tempDir の中に隠れた git を作り、gitDir(<tempDir>/git)を返す。init → 設定の 4 つ → info/exclude の順。
 * どこかで失敗したら例外(呼び出し側が一時ディレクトリごと消して git-failed。打ち切りは timeout)
 */
export async function createHiddenGit(
  tempDir: string,
  gitOptions: BaselineGitOptions = {}
): Promise<string> {
  const { timeoutMs, env } = gitOptions
  // cwd は記録の一時ディレクトリ。作る場所は相対の名前で渡し、パスを git の引数にしない(L-034)。--template= で利用者の
  // init.templateDir の hook などを写さない(確認の結果 1)
  await runIsolatedGit(tempDir, ['init', '--bare', '-q', '--template=', HIDDEN_GIT_DIR_NAME], {
    timeoutMs,
    env
  })
  const gitDir = join(tempDir, HIDDEN_GIT_DIR_NAME)
  for (const [key, value] of hiddenGitConfig(gitDir)) {
    await runIsolatedGit(tempDir, ['config', key, value], {
      timeoutMs,
      env,
      extraEnv: { GIT_DIR: gitDir }
    })
  }
  await mkdir(join(gitDir, 'info'), { mode: 0o700 })
  await writeFile(join(gitDir, 'info', 'exclude'), hiddenGitExcludeContent(), {
    flag: 'wx',
    mode: 0o600
  })
  return gitDir
}
```

- [ ] **Step 6: テストが通ることを確かめる（未確認事項 1・3 の結果を読む）**

Run: `npx vitest run src/main/__tests__/agentBaselineHiddenGit.test.ts src/main/__tests__/agentBaselineHiddenGit.integration.test.ts src/main/__tests__/agentBaselineGit.spawn.test.ts src/main/__tests__/agentBaselineGit.test.ts`
Expected: PASS
- `前提: 隠れた git の設定が無い bare リポジトリでは…` が落ちたら（hook が動かない）、この git では `post-index-change` が記録の命令で動かないことになる。その場合は前提のテストを外さず、`git --version` と、どの命令で hook が動くかを `GIT_TRACE=1` で調べて報告に書き、設計書の「セキュリティ」の hook の行の「3 回動き」を実測に合わせて直す（隠れた git の `core.hooksPath` の設定はそのまま残す）
- 未確認事項 1（fsmonitor）・3（sha256）のテストが落ちたら、設計書の「隠れた git の作成」「既知の制約」を実測に合わせて直してから進める（設計書「未確認事項」の最後の文）。`fsmonitor--daemon status` の出力を報告に書く（daemon を持たない git なら、その旨）

- [ ] **Step 7: 変異で確かめる**

1. `hiddenGitConfig` の `['core.hooksPath', …]` の行を消す → `npx vitest run src/main/__tests__/agentBaselineHiddenGit.integration.test.ts` の `隠れた git では、add・diff・restore の後に hook が動かない…` が落ちる（`agentBaselineHiddenGit.test.ts` の 4 つの設定のテストも落ちる）。戻す
2. `createHiddenGit` の `'--template='` を消す → `利用者の大域の init.templateDir に hook があっても写さない…` と `HEAD・config・objects・refs と info だけを作り…` が落ちる。戻す
3. `hiddenGitConfig` の `['core.fsmonitor', 'false']` の行を消す → `…fsmonitor の daemon を起動しない…` が落ちることを確かめる（この git が fsmonitor の daemon を持たない場合は落ちない。その旨を報告に書く）。戻す
4. `runIsolatedGit` の `...buildIsolatedGitEnv(env)` を `...env` にする（型を合わせるために `env as Record<string, string>`）→ `agentBaselineGit.spawn.test.ts` の `位置の変数を外し(足さず)…` が落ちる。戻す
5. `git diff` で戻したことを確かめる

- [ ] **Step 8: 全体の検証**

Run: `npm test`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/main/agentBaselineGit.ts src/main/agentBaselineHiddenGit.ts src/main/__tests__/agentBaselineHiddenGit.test.ts src/main/__tests__/agentBaselineHiddenGit.integration.test.ts src/main/__tests__/agentBaselineGit.spawn.test.ts` → `npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 9: コミット（利用者の指示があるときだけ）**

```bash
git add src/main/agentBaselineGit.ts src/main/agentBaselineHiddenGit.ts src/main/__tests__/agentBaselineHiddenGit.test.ts src/main/__tests__/agentBaselineHiddenGit.integration.test.ts src/main/__tests__/agentBaselineGit.spawn.test.ts
git commit -m "feat: Git 管理外のフォルダの記録に使う隠れた git の作成と既定の除外の一覧を追加する"
```

---

### Task 2b: 記録の一時ディレクトリの名前と起動時の掃除（main）

> **設計書の読む節:** 「決めたこと（推奨案で決めた事項）」の「起動時の掃除」「掃除の対象」、「記録の方式（main）」の「記録の一時ディレクトリの名前と起動時の掃除」、「エラー処理」の起動時の掃除の行、「セキュリティ」の掃除・pid の検証の行、「新しい状態と既存の入口」の起動時の掃除の行、「テスト方針」の `agentBaselineTempSweep`・配線の変異。
>
> **気をつける知見:** L-004・L-437（名前・自分の `instanceId` でない・pid が無い・`lstat` でリンクでないディレクトリ・持ち主・0700 を対にして確かめたものだけを消す。純粋な関数で固定する）・L-020・L-046（pid の検証）・L-010（1 つの失敗で止めない）・L-435（自分の `instanceId` のものは消さない）・L-060（`instanceId` を必須にする。配線の変異）

**Files:**
- Create: `src/main/agentBaselineTempSweep.ts`
- Modify: `src/main/agentBaselineSnapshot.ts`（`TakeBaselineOptions.instanceId`〈必須〉・`TEMP_DIR_PREFIX` の撤去・`baselineTempDirPrefix`・削除の失敗のコメント）
- Modify: `src/main/ipcHandlers.ts`（`instanceId` の共有・起動時の掃除）
- Modify: `src/main/agentBaselineLifecycle.ts`（コメント）
- Modify: `src/main/__tests__/helpers/agentBaselineFixtures.ts`（`recordBaseline`・`recordBaselineFrom` の `instanceId`・`FAKE_PROTECTION_INSTANCE_ID` のコメント）
- Test: `src/main/__tests__/agentBaselineTempSweep.test.ts`（新規）・`src/main/__tests__/agentBaselineTempSweep.integration.test.ts`（新規）・`src/main/__tests__/ipcHandlers.test.ts`・`src/main/__tests__/agentBaselineSnapshot.integration.test.ts`
- Modify（`instanceId` の追随）: `src/main/__tests__/agentChangesAttribution.integration.test.ts`・`src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`

**Interfaces:**
- Consumes: 既存の `createProtectionInstanceId(pid, randomHex)`（`agentChangesProtectionRules.ts`）・`isProcessAliveOnThisMachine(pid)`（`agentChangesProtectionRef.ts`。`EPERM` は生きているとみなす）・`FAKE_PROTECTION_INSTANCE_ID`（`'1-00000000'`）
- Produces:
```ts
// src/main/agentBaselineTempSweep.ts
export const AGENT_BASELINE_TEMP_DIR_PREFIX = 'prompt-ide-agent-baseline-'
export function baselineTempDirPrefix(instanceId: string): string
export function parseBaselineTempDirName(name: string): { pid: number; instanceId: string } | null
export function isOwnBaselineTempDir(
  stat: Pick<Stats, 'isDirectory' | 'isSymbolicLink' | 'uid' | 'mode'>,
  owner: { uid: number | null; platform: NodeJS.Platform }
): boolean
export interface SweepBaselineTempDirsOptions {
  tempRoot: string
  instanceId: string
  isProcessAlive: (pid: number) => boolean
  uid?: number | null
  platform?: NodeJS.Platform
}
export async function sweepStaleBaselineTempDirs(options: SweepBaselineTempDirsOptions): Promise<number>

// src/main/agentBaselineSnapshot.ts(TakeBaselineOptions に足す。takeBaselineSnapshot の第 2 引数は既定値なしの必須になる)
/** main の起動ごとの ID(<pid>-<16 進 8 桁>。保護の ref と同じ値)。記録の一時ディレクトリの名前に入れ、起動時の掃除が使う(必須。L-060) */
instanceId: string
```

- [ ] **Step 1: 失敗するテストを書く（名前の解釈・自分のものの判定）**

`src/main/__tests__/agentBaselineTempSweep.test.ts`（新規）:
```ts
import { describe, it, expect } from 'vitest'
import type { Stats } from 'node:fs'
import {
  AGENT_BASELINE_TEMP_DIR_PREFIX,
  baselineTempDirPrefix,
  isOwnBaselineTempDir,
  parseBaselineTempDirName
} from '../agentBaselineTempSweep'

describe('記録の一時ディレクトリの名前', () => {
  it('接頭辞は prompt-ide-agent-baseline-、起動ごとの接頭辞は <接頭辞><instanceId>-', () => {
    expect(AGENT_BASELINE_TEMP_DIR_PREFIX).toBe('prompt-ide-agent-baseline-')
    expect(baselineTempDirPrefix('123-0a1b2c3d')).toBe('prompt-ide-agent-baseline-123-0a1b2c3d-')
  })

  it('自分の形の名前なら pid と instanceId を返す', () => {
    expect(parseBaselineTempDirName('prompt-ide-agent-baseline-123-0a1b2c3d-Ab12Cd')).toEqual({
      pid: 123,
      instanceId: '123-0a1b2c3d'
    })
    expect(parseBaselineTempDirName('prompt-ide-agent-baseline-2147483647-ffffffff-zzzzzz')).toEqual({
      pid: 2147483647,
      instanceId: '2147483647-ffffffff'
    })
  })

  it.each([
    ['古い形(pid を含まない)', 'prompt-ide-agent-baseline-Ab12Cd'],
    ['pid が 0', 'prompt-ide-agent-baseline-0-0a1b2c3d-Ab12Cd'],
    ['pid の先頭が 0', 'prompt-ide-agent-baseline-0123-0a1b2c3d-Ab12Cd'],
    ['pid が 11 桁', 'prompt-ide-agent-baseline-12345678901-0a1b2c3d-Ab12Cd'],
    ['pid が 2^31−1 を超える', 'prompt-ide-agent-baseline-2147483648-0a1b2c3d-Ab12Cd'],
    ['負の pid', 'prompt-ide-agent-baseline--1-0a1b2c3d-Ab12Cd'],
    ['16 進が大文字', 'prompt-ide-agent-baseline-123-0A1B2C3D-Ab12Cd'],
    ['16 進が 7 桁', 'prompt-ide-agent-baseline-123-0a1b2c3-Ab12Cd'],
    ['mkdtemp の文字が 5 文字', 'prompt-ide-agent-baseline-123-0a1b2c3d-Ab12C'],
    ['後ろに続く文字がある', 'prompt-ide-agent-baseline-123-0a1b2c3d-Ab12Cd-x'],
    ['取り消しの控えの接頭辞', 'prompt-ide-agent-undo-123-0a1b2c3d-Ab12Cd'],
    ['別の接頭辞', 'other-123-0a1b2c3d-Ab12Cd']
  ])('%s は null(触らない。L-020・L-046)', (_label, name) => {
    expect(parseBaselineTempDirName(name)).toBeNull()
  })
})

describe('isOwnBaselineTempDir(自分のものの判定。L-437)', () => {
  const statOf = (
    overrides: Partial<{ dir: boolean; link: boolean; uid: number; mode: number }> = {}
  ): Pick<Stats, 'isDirectory' | 'isSymbolicLink' | 'uid' | 'mode'> => {
    const { dir = true, link = false, uid = 501, mode = 0o40700 } = overrides
    return { isDirectory: () => dir, isSymbolicLink: () => link, uid, mode }
  }
  const mac = { uid: 501, platform: 'darwin' as const }

  it('リンクでないディレクトリで、持ち主が自分で 0700 なら自分のもの', () => {
    expect(isOwnBaselineTempDir(statOf(), mac)).toBe(true)
  })

  it.each([
    ['シンボリックリンク', statOf({ dir: false, link: true })],
    ['ファイル', statOf({ dir: false })],
    ['持ち主が違う', statOf({ uid: 502 })],
    ['0755', statOf({ mode: 0o40755 })],
    ['0777', statOf({ mode: 0o40777 })]
  ])('%s は自分のものとしない', (_label, stat) => {
    expect(isOwnBaselineTempDir(stat, mac)).toBe(false)
  })

  it('Windows 以外で自分の uid が分からなければ自分のものとしない', () => {
    expect(isOwnBaselineTempDir(statOf(), { uid: null, platform: 'linux' })).toBe(false)
  })

  it('Windows はリンクでないディレクトリだけを見る(持ち主・モードを見ない)', () => {
    expect(
      isOwnBaselineTempDir(statOf({ uid: 0, mode: 0o40777 }), { uid: null, platform: 'win32' })
    ).toBe(true)
    expect(
      isOwnBaselineTempDir(statOf({ dir: false, link: true }), { uid: null, platform: 'win32' })
    ).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（実 fs の掃除）**

`src/main/__tests__/agentBaselineTempSweep.integration.test.ts`（新規）:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sweepStaleBaselineTempDirs } from '../agentBaselineTempSweep'

// 起動時の掃除(設計書「記録の一時ディレクトリの名前と起動時の掃除」)を実 fs で試す。pid の生死は偽物(ALIVE だけが生きている)
const isRoot = process.getuid?.() === 0
const SELF = '300-0000beef'
const ALIVE = 200
const isProcessAlive = (pid: number): boolean => pid === ALIVE
const nameOf = (pid: number, hex = '0000abcd', suffix = 'Ab12Cd'): string =>
  `prompt-ide-agent-baseline-${pid}-${hex}-${suffix}`

describe('sweepStaleBaselineTempDirs(実 fs)', () => {
  let tempRoot: string
  let outside: string
  // 権限を落としたフォルダ(後始末の前に戻す)
  const lockedDirs: string[] = []

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'baseline-sweep-'))
    outside = mkdtempSync(join(tmpdir(), 'baseline-sweep-outside-'))
  })

  afterEach(() => {
    for (const dir of lockedDirs.splice(0)) chmodSync(dir, 0o700)
    for (const dir of [tempRoot, outside]) rmSync(dir, { recursive: true, force: true })
  })

  // 自分の形の名前の 0700 のディレクトリ(中に隠れた git の代わりのファイルを置く)
  const makeDir = (name: string, mode = 0o700): string => {
    const dir = join(tempRoot, name)
    mkdirSync(join(dir, 'git'), { recursive: true })
    writeFileSync(join(dir, 'git', 'HEAD'), 'ref: refs/heads/main\n')
    chmodSync(dir, mode)
    return dir
  }
  const sweep = (): Promise<number> =>
    sweepStaleBaselineTempDirs({ tempRoot, instanceId: SELF, isProcessAlive })

  it('pid のプロセスが無い自分の形の名前の 0700 のディレクトリを中身ごと消し、消した数を返す', async () => {
    makeDir(nameOf(100))
    await expect(sweep()).resolves.toBe(1)
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it('生きている pid・自分の instanceId(pid が無くても)・古い形の名前・ファイル・0777 のディレクトリは残す', async () => {
    const kept = [
      makeDir(nameOf(ALIVE)),
      makeDir(`prompt-ide-agent-baseline-${SELF}-Zz99Yy`),
      makeDir('prompt-ide-agent-baseline-Ab12Cd'),
      makeDir(nameOf(101, '0000abcd', 'Perm77'), 0o777)
    ]
    writeFileSync(join(tempRoot, nameOf(102)), 'not a dir')
    await expect(sweep()).resolves.toBe(0)
    for (const dir of kept) expect(existsSync(dir)).toBe(true)
    expect(existsSync(join(tempRoot, nameOf(102)))).toBe(true)
  })

  it('自分の形の名前のシンボリックリンクは、リンクも指す先のディレクトリも消さない', async () => {
    const target = join(outside, 'target')
    mkdirSync(target, { mode: 0o700 })
    writeFileSync(join(target, 'keep.txt'), 'k\n')
    symlinkSync(target, join(tempRoot, nameOf(103)))
    await expect(sweep()).resolves.toBe(0)
    expect(existsSync(join(tempRoot, nameOf(103)))).toBe(true)
    expect(existsSync(join(target, 'keep.txt'))).toBe(true)
  })

  it.skipIf(isRoot)('1 つが消せなくても残りを試す(L-010)', async () => {
    const stuck = makeDir(nameOf(104, '0000abcd', 'Stuck1'))
    // 中のフォルダを書き込めなくすると、中身を消せずに rm が失敗する
    chmodSync(join(stuck, 'git'), 0o500)
    lockedDirs.push(join(stuck, 'git'))
    makeDir(nameOf(105, '0000abcd', 'Gone22'))
    await expect(sweep()).resolves.toBe(1)
    expect(existsSync(join(tempRoot, nameOf(105, '0000abcd', 'Gone22')))).toBe(false)
    expect(existsSync(stuck)).toBe(true)
  })

  it('一時ディレクトリの親を読めなければ 0 を返す(投げない)', async () => {
    await expect(
      sweepStaleBaselineTempDirs({ tempRoot: join(tempRoot, 'missing'), instanceId: SELF, isProcessAlive })
    ).resolves.toBe(0)
  })
})
```

- [ ] **Step 3: 失敗するテストを書く（記録の一時ディレクトリの名前と配線）**

`src/main/__tests__/agentBaselineSnapshot.integration.test.ts`:
1. import に `import { basename } from 'node:path'`（既存の `import { join } from 'node:path'` に `basename` を足す）と `import { parseBaselineTempDirName } from '../agentBaselineTempSweep'` を足し、`./helpers/agentBaselineFixtures` の import に `FAKE_PROTECTION_INSTANCE_ID` を足す
2. `describe('takeBaselineSnapshot(実 git)', ...)` の最初のテストの後に足す:
```ts
  it('記録の一時ディレクトリの名前に起動ごとの ID を入れ(prompt-ide-agent-baseline-<instanceId>-<6 文字>)、0700 で作る', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const snapshot = recordedSnapshot(
      await takeBaselineSnapshot(repo, { tempRoot, instanceId: '4242-0a1b2c3d' })
    )
    const name = basename(snapshot.tempDir)
    expect(name).toMatch(/^prompt-ide-agent-baseline-4242-0a1b2c3d-[A-Za-z0-9]{6}$/)
    expect(parseBaselineTempDirName(name)).toEqual({ pid: 4242, instanceId: '4242-0a1b2c3d' })
    expect(statSync(snapshot.tempDir).mode & 0o777).toBe(0o700)
  })
```
3. このファイルのほかのすべての `takeBaselineSnapshot(<フォルダ>, { tempRoot` に `instanceId: FAKE_PROTECTION_INSTANCE_ID` を足す。次のコマンドで機械的に直し、`npx eslint --fix` で整形する（`{ tempRoot }`・`{ tempRoot, … }`・改行を挟む `{\n        tempRoot,` のどれも `tempRoot, instanceId: FAKE_PROTECTION_INSTANCE_ID` になる。2 で足したテストは `instanceId: '4242-0a1b2c3d'` を書いたので当たらない）:
```bash
perl -0pi -e 's/takeBaselineSnapshot\(([^,()]+), \{(\s*)tempRoot(?!, instanceId)/takeBaselineSnapshot($1, {$2tempRoot, instanceId: FAKE_PROTECTION_INSTANCE_ID/g' src/main/__tests__/agentBaselineSnapshot.integration.test.ts
```
   直した後に `grep -n "takeBaselineSnapshot(" src/main/__tests__/agentBaselineSnapshot.integration.test.ts | grep -v instanceId` が `describe('takeBaselineSnapshot(実 git)'` の行だけを出すこと（複数行にまたがる呼び出しは、その次の行に `instanceId` があることを目で確かめる）。第 1 引数に括弧やカンマを含む呼び出し（例: `takeBaselineSnapshot(join(repo, 'sub'), { tempRoot })`）は上の置き換えに当たらないため、この確かめで出た行を手で直す

`src/main/__tests__/ipcHandlers.test.ts`:
1. `const mockSetupAgentBaselineLifecycle = vi.hoisted(() => vi.fn())` の前に足す:
```ts
// 記録を取る関数と起動時の掃除(実物の git・一時ディレクトリを使わない。takeSnapshot の包みと掃除の引数を見る)
const mockTakeBaselineSnapshot = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ kind: 'canceled' as const }))
)
vi.mock('../agentBaselineSnapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentBaselineSnapshot')>()),
  takeBaselineSnapshot: mockTakeBaselineSnapshot
}))
const mockSweepStaleBaselineTempDirs = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => 0))
vi.mock('../agentBaselineTempSweep', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentBaselineTempSweep')>()),
  sweepStaleBaselineTempDirs: mockSweepStaleBaselineTempDirs
}))
```
2. import の並びに `import { isProcessAliveOnThisMachine } from '../agentChangesProtectionRef'` を足す
3. `it('記録の registry に、追跡(区別の合図と通し番号)・…', ...)` の後に足す:
```ts
  it('起動ごとの ID を 1 回だけ作り、保護の ref と記録を取る関数(takeSnapshot の包み)と起動時の掃除に同じ値を渡す(L-060)', async () => {
    registerIpcHandlers(mockIpcMain)
    const registry = mockSetupAgentBaselineLifecycle.mock.calls[0][1] as AgentBaselineRegistry
    // 依存は private のため、組み立ての確認に限って型を外して読む
    const deps = (registry as unknown as { deps: AgentBaselineRegistryDeps }).deps
    const { instanceId } = deps.protection
    expect(instanceId).toMatch(new RegExp(`^${process.pid}-[0-9a-f]{8}$`))
    const isCanceled = (): boolean => false
    const now = (): number => 7
    await deps.takeSnapshot('/folder', { isCanceled, now })
    expect(mockTakeBaselineSnapshot).toHaveBeenCalledExactlyOnceWith('/folder', {
      isCanceled,
      now,
      instanceId
    })
    expect(mockSweepStaleBaselineTempDirs).toHaveBeenCalledExactlyOnceWith({
      tempRoot: tmpdir(),
      instanceId,
      isProcessAlive: isProcessAliveOnThisMachine
    })
  })
```

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineTempSweep.test.ts src/main/__tests__/agentBaselineTempSweep.integration.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts`
Expected: FAIL（`agentBaselineTempSweep.ts` が無い、`instanceId` を受け取らない・名前に入らない、掃除を呼ばない）

- [ ] **Step 5: 名前の解釈・判定・掃除を実装する**

`src/main/agentBaselineTempSweep.ts`（新規）:
```ts
import { lstat, readdir, rm } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'

// 記録の一時ディレクトリの名前と起動時の掃除(設計書 2026-10-15「記録の一時ディレクトリの名前と起動時の掃除」)。名前に main の
// 起動ごとの ID(<pid>-<16 進 8 桁>。保護の ref と同じ instanceId)を入れ、起動のときに、名前の形が一致し、自分の instanceId でなく、
// pid のプロセスが無く、自分のもの(lstat でリンクでないディレクトリ・持ち主が自分・0700)と分かるものだけを消す(L-004・L-437)。
// 隠れた git は記録の時点のフォルダの写しを持つため、異常終了で残すと大きい。取り消しの控え(prompt-ide-agent-undo-)は対象にしない

/** 記録の一時ディレクトリの接頭辞(リポジトリの方式の記録も含む) */
export const AGENT_BASELINE_TEMP_DIR_PREFIX = 'prompt-ide-agent-baseline-'

// pid は 1 以上の 10 桁まで、instanceId の 16 進は小文字 8 桁、mkdtemp が足す 6 文字
const TEMP_DIR_NAME_PATTERN =
  /^prompt-ide-agent-baseline-([1-9][0-9]{0,9})-([0-9a-f]{8})-[A-Za-z0-9]{6}$/
// process.kill(pid, 0) に渡してよい pid の上限(L-020・L-046)
const MAX_PID = 2 ** 31 - 1

/** 起動ごとの接頭辞(mkdtemp に渡す。mkdtemp が 6 文字を足す) */
export function baselineTempDirPrefix(instanceId: string): string {
  return `${AGENT_BASELINE_TEMP_DIR_PREFIX}${instanceId}-`
}

/** 自分の形の名前なら pid と instanceId。形が違う(古い形の名前を含む)・pid が範囲外なら null(触らない) */
export function parseBaselineTempDirName(name: string): { pid: number; instanceId: string } | null {
  const match = TEMP_DIR_NAME_PATTERN.exec(name)
  if (match === null) return null
  const pid = Number(match[1])
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > MAX_PID) return null
  return { pid, instanceId: `${match[1]}-${match[2]}` }
}

/**
 * 自分のものか(存在ではなく lstat の結果で判定する。L-437): シンボリックリンクでないディレクトリで、Windows 以外は持ち主が自分の
 * uid と一致し、グループ・他人の権限が無い(mode & 0o077 が 0)。Windows 以外で自分の uid が分からなければ自分のものとしない
 */
export function isOwnBaselineTempDir(
  stat: Pick<Stats, 'isDirectory' | 'isSymbolicLink' | 'uid' | 'mode'>,
  { uid, platform }: { uid: number | null; platform: NodeJS.Platform }
): boolean {
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false
  if (platform === 'win32') return true
  return uid !== null && stat.uid === uid && (stat.mode & 0o077) === 0
}

export interface SweepBaselineTempDirsOptions {
  /** 一時ディレクトリの親(takeBaselineSnapshot の tempRoot と同じ。本番は OS の一時ディレクトリ) */
  tempRoot: string
  /** 自分の起動ごとの ID(このインスタンスの記録は消さない。L-435) */
  instanceId: string
  /** その pid のプロセスがこのマシンにあるか(isProcessAliveOnThisMachine。EPERM は生きているとみなす) */
  isProcessAlive: (pid: number) => boolean
  /** 自分の uid(既定は process.getuid。Windows には無い) */
  uid?: number | null
  platform?: NodeJS.Platform
}

/**
 * 前の起動の異常終了で残った記録の一時ディレクトリを消す。tempRoot の直下だけを見る。1 つの失敗(読めない・消せない)は握って
 * 次へ進み(L-010)、残ったものは次の起動で試す。消した数を返す(テスト用)。投げない
 */
export async function sweepStaleBaselineTempDirs({
  tempRoot,
  instanceId,
  isProcessAlive,
  uid = process.getuid?.() ?? null,
  platform = process.platform
}: SweepBaselineTempDirsOptions): Promise<number> {
  let names: string[]
  try {
    names = await readdir(tempRoot)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    const parsed = parseBaselineTempDirName(name)
    if (parsed === null || parsed.instanceId === instanceId) continue
    try {
      if (isProcessAlive(parsed.pid)) continue
      const dir = join(tempRoot, name)
      if (!isOwnBaselineTempDir(await lstat(dir), { uid, platform })) continue
      await rm(dir, { recursive: true, force: true })
      removed += 1
    } catch {
      // 消せなかったものは次の起動で試す(残りは続けて試す。L-010)
    }
  }
  return removed
}
```

- [ ] **Step 6: 記録の一時ディレクトリの名前に `instanceId` を入れる**

`src/main/agentBaselineSnapshot.ts`:
1. import に `import { baselineTempDirPrefix } from './agentBaselineTempSweep'` を足す
2. `TakeBaselineOptions` の `tempRoot?: string` の次に足す:
```ts
  /** main の起動ごとの ID(<pid>-<16 進 8 桁>。保護の ref と同じ値)。記録の一時ディレクトリの名前に入れ、起動時の掃除が使う(必須。L-060) */
  instanceId: string
```
3. `const TEMP_DIR_PREFIX = 'prompt-ide-agent-baseline-'` の行を消す
4. `removeBaselineDir` のコメントの `(失敗は握る。残ったものは OS の一時ディレクトリの掃除に任せる)` を `(失敗は握る。残ったものは次の起動の掃除〈agentBaselineTempSweep〉で消す)` にし、`removeBaselineDirSync` の中のコメント `// 消せなかったものは OS の一時ディレクトリの掃除に任せる` を `// 消せなかったものは次の起動の掃除で消す` にする
5. `takeBaselineSnapshot` の引数を次にする（第 2 引数の既定値 `= {}` をやめる）:
```ts
export async function takeBaselineSnapshot(
  folderPath: string,
  {
    isCanceled = () => false,
    now = Date.now,
    tempRoot = tmpdir(),
    baseIndexPath,
    instanceId,
    ...gitOptions
  }: TakeBaselineOptions
): Promise<BaselineSnapshotResult> {
```
6. `tempDir = await mkdtemp(join(tempRoot, TEMP_DIR_PREFIX))` を `tempDir = await mkdtemp(join(tempRoot, baselineTempDirPrefix(instanceId)))` にする

`src/main/__tests__/helpers/agentBaselineFixtures.ts`:
1. `recordBaseline` の `takeBaselineSnapshot(repo, { tempRoot })` を `takeBaselineSnapshot(repo, { tempRoot, instanceId: FAKE_PROTECTION_INSTANCE_ID })` に、`recordBaselineFrom` の `{ tempRoot, baseIndexPath: base.indexPath }` を `{ tempRoot, instanceId: FAKE_PROTECTION_INSTANCE_ID, baseIndexPath: base.indexPath }` にする（`FAKE_PROTECTION_INSTANCE_ID` は同じファイルの後ろで `export const` しているため、使う関数の中では参照できる。読みやすさのため、定数の宣言を `recordBaseline` より前へ移してよい）
2. `/** 偽物の保護の instanceId(<pid>-<16 進 8 桁> の形) */` を `/** 偽物の起動ごとの ID(保護の ref の名前と、記録の一時ディレクトリの名前に使う。<pid>-<16 進 8 桁> の形) */` にする

`src/main/__tests__/agentChangesAttribution.integration.test.ts`: `takeBaselineSnapshot(folderPath, { ...options, tempRoot: dirs.tempRoot })` を `takeBaselineSnapshot(folderPath, { ...options, tempRoot: dirs.tempRoot, instanceId: FAKE_PROTECTION_INSTANCE_ID })` にし、`./helpers/agentBaselineFixtures` の import に `FAKE_PROTECTION_INSTANCE_ID` を足す（既に import していれば足さない）。

`src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`: `takeBaselineSnapshot(folderPath, { ...options, tempRoot })` を `takeBaselineSnapshot(folderPath, { ...options, tempRoot, instanceId: INSTANCE_ID })` にする（本番と同じく保護と同じ値）。

- [ ] **Step 7: `instanceId` を 1 回作って共有し、起動時の掃除を呼ぶ**

`src/main/ipcHandlers.ts`:
1. import に `import { sweepStaleBaselineTempDirs } from './agentBaselineTempSweep'` を足す
2. `// エージェントの変更の記録(所有者ごと)。…` のコメントから `setupAgentBaselineLifecycle(app, agentBaselineRegistry, folderAccess)` の行までを次にする（`AgentBaselineRegistry` の依存の残りの欄は今のまま）:
```ts
  // エージェントの変更の記録(所有者ごと)。フォルダの切り替え・リロード・破棄・アプリの終了で捨てる。
  // 記録中は記録の tree を専用の ref から守る(hook の無いディレクトリは userData の下)。main の起動ごとの ID は 1 回だけ作り、
  // 保護の ref の名前と記録の一時ディレクトリの名前に同じ値を使う(起動時の掃除が自分の記録を消さない)
  const instanceId = createProtectionInstanceId(process.pid, randomBytes(4).toString('hex'))
  const agentBaselineRegistry = new AgentBaselineRegistry({
    takeSnapshot: (folderPath, options) => takeBaselineSnapshot(folderPath, { ...options, instanceId }),
    removeDir: removeBaselineDir,
    removeDirSync: removeBaselineDirSync,
    now: Date.now,
    protection: {
      instanceId,
      noHooksDir: prepareAgentChangesNoHooksDir(app.getPath('userData')),
      git: protectionRefGit,
      isProcessAlive: isProcessAliveOnThisMachine
    },
    // (executeUndo・collectBetween・collectCurrent・attributionSource・attributionDevLog・attributionWarn は今のまま)
  })
  setupAgentBaselineLifecycle(app, agentBaselineRegistry, folderAccess)
  // 前の起動の異常終了で残った記録の一時ディレクトリを消す(待たない。自分の instanceId のものは消さないため、最初の記録と並んでも消さない)
  void sweepStaleBaselineTempDirs({
    tempRoot: tmpdir(),
    instanceId,
    isProcessAlive: isProcessAliveOnThisMachine
  }).catch(() => undefined)
```

`src/main/agentBaselineLifecycle.ts`: 先頭のコメントの `異常終了で残った一時ディレクトリは OS の掃除に任せる` を `異常終了で残った記録の一時ディレクトリは次の起動の掃除(agentBaselineTempSweep。ipcHandlers.ts が呼ぶ)で消す` にする。

- [ ] **Step 8: テストが通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineTempSweep.test.ts src/main/__tests__/agentBaselineTempSweep.integration.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/agentChangesAttribution.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts`
Expected: PASS

- [ ] **Step 9: 変異で確かめる**

1. `ipcHandlers.ts` の `takeSnapshot` の包みを `(folderPath, options) => takeBaselineSnapshot(folderPath, { ...options, instanceId: 'x' })` にする → `ipcHandlers.test.ts` の `起動ごとの ID を 1 回だけ作り…` が落ちる。`{ ...options }` だけにする → `npm run typecheck` が落ちる。戻す
2. `void sweepStaleBaselineTempDirs(...)` の文を消す → 同じテストが落ちる。戻す
3. `sweepStaleBaselineTempDirs` の `parsed.instanceId === instanceId` の条件を消す → `…自分の instanceId(pid が無くても)…は残す` が落ちる。戻す
4. `isOwnBaselineTempDir` の `stat.isSymbolicLink() ||` を消す → `agentBaselineTempSweep.test.ts` の `シンボリックリンク は自分のものとしない` が落ちる。戻す
5. `parseBaselineTempDirName` の `|| pid > MAX_PID` を消す → `pid が 2^31−1 を超える は null` が落ちる。戻す
6. `sweepStaleBaselineTempDirs` の `try { … } catch { … }` の catch で `return removed` する（1 つの失敗で止める）→ `1 つが消せなくても残りを試す` が落ちることを確かめる（readdir の順で失敗が後になると落ちないことがあるため、落ちなければ `Stuck1` と `Gone22` の名前を入れ替えて確かめる）。戻す
7. `git diff` で戻したことを確かめる

- [ ] **Step 10: 全体の検証**

Run: `npm test`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/main/agentBaselineTempSweep.ts src/main/agentBaselineSnapshot.ts src/main/ipcHandlers.ts src/main/agentBaselineLifecycle.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/agentBaselineTempSweep.test.ts src/main/__tests__/agentBaselineTempSweep.integration.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/agentChangesAttribution.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts` → `npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 11: コミット（利用者の指示があるときだけ）**

```bash
git add src/main/agentBaselineTempSweep.ts src/main/agentBaselineSnapshot.ts src/main/ipcHandlers.ts src/main/agentBaselineLifecycle.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/agentBaselineTempSweep.test.ts src/main/__tests__/agentBaselineTempSweep.integration.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/agentChangesAttribution.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts
git commit -m "feat: 記録の一時ディレクトリの名前に起動ごとの ID を入れ、異常終了で残ったものを次の起動で消す"
```

---

### Task 3a: 区切りの写しの元を `base` にする（main。挙動はリポジトリのまま）

> **設計書の読む節:** 「記録の方式（main）」の「区切りの写しの元（`base`）」、「新しい状態と既存の入口」の実行の区切り・判定の区切りの行、「テスト方針」の `agentBaselineRegistry.test.ts`・`agentChangesRecord.test.ts`・配線の変異の `checkpointBaseOf`。
>
> **気をつける知見:** L-041（区切りは記録の方式を記録から受け取り、フォルダを調べ直さない。そのために `gitDir` を記録から渡す）・L-060（`checkpointBaseOf` の `gitDir` を外すと落ちるテスト）

この Task では、`base.gitDir` は渡すが `takeBaselineSnapshot` はまだ `base.indexPath` だけを使う（隠れた git の記録はまだ作られない）。

**Files:**
- Modify: `src/main/agentBaselineSnapshot.ts`（`BaselineCheckpointBase`〈新規〉・`TakeBaselineOptions.base`）
- Modify: `src/main/agentChangesRecord.ts`（`checkpointBaseOf`〈新規〉）
- Modify: `src/main/agentBaselineRegistry.ts`（依存の `takeSnapshot` の型・`addRun`・`attributionContextOf`）
- Modify: `src/main/__tests__/helpers/agentBaselineFixtures.ts`（`snapshotBase`〈新規〉・`recordBaselineFrom`）
- Test: `src/main/__tests__/agentChangesRecord.test.ts`・`src/main/__tests__/agentBaselineRegistry.test.ts`・`src/main/__tests__/agentBaselineRegistry.attribution.test.ts`・`src/main/__tests__/agentBaselineSnapshot.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 の `BaselineSnapshot.gitDir`・Task 2b の `TakeBaselineOptions.instanceId`、既存の `latestRecordedIndexPath(record)`・`AttributionSyncContext.takeSnapshot: (baseIndexPath: string) => Promise<BaselineSnapshotResult>`（形は変えない）
- Produces:
```ts
// src/main/agentBaselineSnapshot.ts
/** 区切りの写しの元: 直前の取れた記録のインデックスと、記録の隠れた git の場所(リポジトリの方式は null) */
export interface BaselineCheckpointBase {
  indexPath: string
  gitDir: string | null
}
// TakeBaselineOptions の baseIndexPath?: string を base?: BaselineCheckpointBase に置き換える

// src/main/agentChangesRecord.ts
export function checkpointBaseOf(record: AgentChangesRecord): BaselineCheckpointBase

// src/main/agentBaselineRegistry.ts
takeSnapshot: (
  folderPath: string,
  options: { isCanceled: () => boolean; now: () => number; base?: BaselineCheckpointBase }
) => Promise<BaselineSnapshotResult>

// src/main/__tests__/helpers/agentBaselineFixtures.ts
export function snapshotBase(snapshot: BaselineSnapshot): BaselineCheckpointBase
```

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/helpers/agentBaselineFixtures.ts`:
1. `import type { BaselineSnapshot, BaselineSnapshotResult } from '../../agentBaselineSnapshot'` に `BaselineCheckpointBase` を足す
2. `recordBaselineFrom` の前に足し、`recordBaselineFrom` の `baseIndexPath: base.indexPath` を `base: snapshotBase(base)` にする:
```ts
// 記録を写しの元にした区切りの base(記録のインデックスと隠れた git の場所。区切りの gitDir は累積の始点と同じ値を持つ)
export function snapshotBase(snapshot: BaselineSnapshot): BaselineCheckpointBase {
  return { indexPath: snapshot.indexPath, gitDir: snapshot.gitDir }
}
```

`src/main/__tests__/agentChangesRecord.test.ts`:
1. import の `agentChangesRecordTempDirs,` の次に `checkpointBaseOf,` を足す
2. `describe('latestRecordedIndexPath', ...)` の後に足す:
```ts
describe('checkpointBaseOf', () => {
  it('写しの元は直前の取れた記録のインデックス、gitDir はリポジトリの方式なら null', () => {
    const record = recordOf([baselineRun(1), snapshotRun(2), failedRun(3)])
    expect(checkpointBaseOf(record)).toEqual({ indexPath: '/tmp/r2/index', gitDir: null })
  })

  it('隠れた git の記録は、累積の始点の gitDir を常に渡す', () => {
    const hiddenBaseline = makeBaselineSnapshot({
      tempDir: '/tmp/base',
      startedAt: 100,
      gitDir: '/tmp/base/git'
    })
    expect(checkpointBaseOf(makeAgentChangesRecord([], { baseline: hiddenBaseline }))).toEqual({
      indexPath: '/tmp/base/index',
      gitDir: '/tmp/base/git'
    })
  })
})
```
   （`failedRun` はこのファイルで定義済み。無ければ `baselineRun` と同じ形で `start: { kind: 'failed', reason: 'timeout', startedAt: runId * 100 }` を返す補助を足す）

`src/main/__tests__/agentBaselineRegistry.test.ts`:
1. import の `import type { BaselineSnapshot, BaselineSnapshotResult } from '../agentBaselineSnapshot'` に `BaselineCheckpointBase` を足す（今の import の形に合わせる）
2. `setup` の戻り値の型の `baseIndexPaths: () => (string | undefined)[]` の次に足す:
```ts
  /** 記録の依頼ごとの区切りの写しの元(累積の始点は undefined) */
  bases: () => (BaselineCheckpointBase | undefined)[]
```
3. `setup` の中の `const baseIndexPaths: (string | undefined)[] = []` の次に `const bases: (BaselineCheckpointBase | undefined)[] = []` を足し、`baseIndexPaths.push(options.baseIndexPath)` を次にする:
```ts
        baseIndexPaths.push(options.base?.indexPath)
        bases.push(options.base)
```
   戻り値の `baseIndexPaths: () => [...baseIndexPaths],` の次に `bases: () => [...bases],` を足す
4. `describe('AgentBaselineRegistry の取り消しの控え', ...)` の前に足す:
```ts
describe('AgentBaselineRegistry の隠れた git の記録', () => {
  // 隠れた git の記録(累積の始点の一時ディレクトリの中に gitDir がある。区切りも同じ gitDir を持つ)
  const hidden = (tempDir: string, startedAt = 100): BaselineSnapshotResult => ({
    kind: 'recorded',
    snapshot: makeBaselineSnapshot({
      folderPath: '/repo',
      tempDir,
      startedAt,
      gitDir: '/tmp/base/git'
    })
  })
  // send で記録・区切りを取り終えるまで進める
  async function sendHidden(
    s: ReturnType<typeof setup>,
    tempDir: string,
    startedAt: number
  ): Promise<void> {
    const calls = s.takeSnapshot.mock.calls.length
    const begun = s.registry.begin(1, '/repo', 'send')
    await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalledTimes(calls + 1))
    s.release(hidden(tempDir, startedAt))
    await begun
  }

  it('実行の区切りの写しの元に、直前の取れた記録のインデックスと記録の隠れた git(gitDir)を渡す(L-041)', async () => {
    const s = setup()
    await sendHidden(s, '/tmp/base', 100)
    await sendHidden(s, '/tmp/r2', 200)
    await sendHidden(s, '/tmp/r3', 300)
    expect(s.bases()).toEqual([
      undefined,
      { indexPath: '/tmp/base/index', gitDir: '/tmp/base/git' },
      { indexPath: '/tmp/r2/index', gitDir: '/tmp/base/git' }
    ])
  })
})
```

`src/main/__tests__/agentBaselineRegistry.attribution.test.ts`:
1. import の `import type { BaselineSnapshotResult } from '../agentBaselineSnapshot'` に `BaselineCheckpointBase` を足す（今の import の形に合わせる）
2. `interface SnapshotCall` の `baseIndexPath: string | undefined` の次に `base: BaselineCheckpointBase | undefined` を足し、`setup` の `calls.push({ baseIndexPath: options.baseIndexPath,` を `calls.push({ baseIndexPath: options.base?.indexPath, base: options.base,` にする
3. `checkpointResult` の定義の後に足す:
```ts
/** 隠れた git の記録の区切り n(gitDir は累積の始点 cp-0 の隠れた git。ほかは checkpointResult と同じ) */
const hiddenCheckpointResult = (n: number): BaselineSnapshotResult => ({
  kind: 'recorded',
  snapshot: makeBaselineSnapshot({
    folderPath: FOLDER,
    tempDir: `/tmp/cp-${n}`,
    tree: `tree-${n}`,
    startedAt: 100 + n,
    gitDir: '/tmp/cp-0/git'
  })
})
```
4. `describe('区別の同期(syncAttribution・notifyAttributionSignal)', ...)` の最後に足す:
```ts
  it('隠れた git の記録の判定の区切りは、写しの元に記録の累積の始点の隠れた git(gitDir)を渡す(L-041)', async () => {
    const h = setup()
    const begun = h.registry.begin(1, FOLDER, 'manual')
    ;(await snapshotCall(h, 0)).resolve(hiddenCheckpointResult(0))
    await begun
    change(h, { phase: 'agent' })
    const call = await snapshotCall(h, 1)
    expect(call.base).toEqual({ indexPath: '/tmp/cp-0/index', gitDir: '/tmp/cp-0/git' })
    call.resolve(hiddenCheckpointResult(1))
    await flush(h)
  })
```

`src/main/__tests__/agentBaselineSnapshot.integration.test.ts`:
1. `./helpers/agentBaselineFixtures` の import に `snapshotBase` を足す
2. `takeFrom` の `baseIndexPath: base?.indexPath` を `base: base === undefined ? undefined : snapshotBase(base)` にする
3. `baseIndexPath: first.indexPath` の 2 か所を `base: snapshotBase(first)` にする
4. `describe('takeBaselineSnapshot の tree と区切り(baseIndexPath)(実 git)', ...)` の題を `describe('takeBaselineSnapshot の tree と区切り(base)(実 git)', ...)` にする

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts`
Expected: FAIL（`checkpointBaseOf`・`BaselineCheckpointBase` が無い、`base` が渡らない）

- [ ] **Step 3: `base` を実装する**

`src/main/agentBaselineSnapshot.ts`:
1. `TakeBaselineOptions` の前に足す:
```ts
/** 区切りの写しの元: 直前の取れた記録のインデックスと、記録の隠れた git の場所(リポジトリの方式は null) */
export interface BaselineCheckpointBase {
  indexPath: string
  gitDir: string | null
}
```
2. `TakeBaselineOptions` の `baseIndexPath?: string` とそのコメントを次に置き換える:
```ts
  /**
   * 区切りの写しの元。区切りは直前の取れた記録のインデックスと記録の隠れた git の場所を渡す(直前の記録の stat の情報が使える)。
   * 指定が無ければ累積の始点(リポジトリの方式は利用者の index から写す)。指定した写しの元が無ければ空から始めず git-failed にする(L-002)
   */
  base?: BaselineCheckpointBase
```
3. `takeBaselineSnapshot` の引数の分割の `baseIndexPath,` を `base,` にし、本体の先頭（`const startedAt = now()` の次）に `const baseIndexPath = base?.indexPath` を足す（本体の残りの `baseIndexPath` はそのまま使う。方式の決め方は Task 3b）
4. 関数のコメントの `写し(baseIndexPath、無ければ .git/index。…)` を `写し(base の記録のインデックス、無ければ .git/index。…)` にする

`src/main/agentChangesRecord.ts`:
1. `import type { BaselineSnapshot, BaselineSnapshotResult } from './agentBaselineSnapshot'` に `BaselineCheckpointBase` を足す
2. `latestRecordedIndexPath` の後に足す:
```ts
/**
 * 実行の区切りの写しの元: 直前の取れた記録のインデックスと、記録の隠れた git の場所。gitDir は累積の始点の値を常に使う(区切りの
 * 記録は始点と同じ値を持つ)。区切りはこの gitDir で方式を決め、フォルダを調べ直さない(L-041)
 */
export function checkpointBaseOf(record: AgentChangesRecord): BaselineCheckpointBase {
  return { indexPath: latestRecordedIndexPath(record), gitDir: record.baseline.gitDir }
}
```

`src/main/agentBaselineRegistry.ts`:
1. `import type { BaselineSnapshot, BaselineSnapshotResult } from './agentBaselineSnapshot'` に `BaselineCheckpointBase` を足す
2. import の `./agentChangesRecord` の並びの `latestRecordedIndexPath,` を `checkpointBaseOf,` にする（`latestRecordedIndexPath` を registry で使わなくなる）
3. `AgentBaselineRegistryDeps.takeSnapshot` のコメントと型を次にする:
```ts
  /**
   * 記録を取る(agentBaselineSnapshot.takeBaselineSnapshot。instanceId は ipcHandlers.ts の包みが足す)。isCanceled は await のたびに呼ばれる。
   * base は区切りの写しの元(記録のインデックスと隠れた git の場所)。now は記録の時刻の時計(deps.now をそのまま渡す)
   */
  takeSnapshot: (
    folderPath: string,
    options: { isCanceled: () => boolean; now: () => number; base?: BaselineCheckpointBase }
  ) => Promise<BaselineSnapshotResult>
```
4. `addRun` の `baseIndexPath: latestRecordedIndexPath(record)` を `base: checkpointBaseOf(record)` にする
5. `attributionContextOf` の `takeSnapshot: (baseIndexPath) =>` の包みを次にする:
```ts
      // 判定の区切りの写しの元は直前の判定の区切り。隠れた git の場所は記録の累積の始点の値を渡す(フォルダを調べ直さない。L-041)
      takeSnapshot: (baseIndexPath) =>
        this.deps.takeSnapshot(record.baseline.folderPath, {
          isCanceled: isStale,
          now: this.deps.now,
          base: { indexPath: baseIndexPath, gitDir: record.baseline.gitDir }
        }),
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/agentChangesRuns.integration.test.ts src/main/__tests__/agentChangesAttribution.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`
Expected: PASS

- [ ] **Step 5: 変異で確かめる**

1. `checkpointBaseOf` の `gitDir: record.baseline.gitDir` を `gitDir: null` にする → `agentChangesRecord.test.ts` の `隠れた git の記録は、累積の始点の gitDir を常に渡す` と `agentBaselineRegistry.test.ts` の `実行の区切りの写しの元に…` が落ちる。戻す
2. registry の `attributionContextOf` の `gitDir: record.baseline.gitDir` を `gitDir: null` にする → `agentBaselineRegistry.attribution.test.ts` の `隠れた git の記録の判定の区切りは…` が落ちる。戻す
3. `git diff` で戻したことを確かめる

- [ ] **Step 6: 全体の検証**

Run: `npm test`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS（`grep -rn "baseIndexPath" src/main --include='*.ts' | grep -v __tests__` が `agentBaselineSnapshot.ts` の本体の変数と `agentChangesAttributionSync.ts` の `takeSnapshot: (baseIndexPath: string)` だけを出すこと）
Run: `npx eslint --fix src/main/agentBaselineSnapshot.ts src/main/agentChangesRecord.ts src/main/agentBaselineRegistry.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts` → `npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 7: コミット（利用者の指示があるときだけ）**

```bash
git add src/main/agentBaselineSnapshot.ts src/main/agentChangesRecord.ts src/main/agentBaselineRegistry.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts
git commit -m "refactor: 区切りの写しの元を記録のインデックスと隠れた git の場所の base にする"
```

---

### Task 3b: 方式の決め方と隠れた git の記録（main・shared の理由・renderer の理由の文言。未確認事項 2 の計測）

> **設計書の読む節:** 「決めたこと（利用者の確認済み）」の全行、「決めたこと（推奨案で決めた事項）」の「記録中に利用者が `git init` した場合」「記録中にリポジトリの `.git` が消えた場合」「`.git` の中・bare リポジトリのフォルダ」「上限を超えたときの理由」「`not-repository` の理由」「隠れた git の置き場」「未追跡の事前の検査の基準」「HEAD」、「範囲」、「確認の結果」3〜8・12、「記録の方式（main）」の「方式の決め方」「隠れた git の記録の手順」「一覧・diff・戻す…」の表の保護の ref の行、「記録中のフォルダの変化」、「IPC と型」の理由の行、「renderer」の文言の表の新しい理由の行、「エラー処理」、「セキュリティ」、「テスト方針」の `agentBaselineSnapshot.integration.test.ts`・`agentBaselineRegistry.test.ts`、「未確認事項」2。
>
> **気をつける知見:** L-041（区切りは記録の方式に従う。`git init` の後も隠れた git、`.git` が消えても隠れた git に切り替えない）・L-002（`base.gitDir` が無ければ `git-failed`）・L-004（区切りの失敗では共有の隠れた git に触れない）・L-437（区切りの `gitDir` がリンクなら使わない）・L-016（リンクを辿らない）・L-075（親の環境の位置の変数）・L-017（理由の文にパスを出さない）・L-403・L-428（保護の ref を作らない）

**Files:**
- Create: `src/main/gitRepoDetection.ts`（`isInsideGitDirectory` を移す）
- Modify: `src/main/gitRemoteSetupService.ts`（移動に追随）
- Modify: `src/main/agentBaselineSnapshot.ts`（`resolveBaselineMode`・`recordRepositorySnapshot`・`recordHiddenSnapshot`・`finishSnapshot`・`inheritedIgnoredPaths` の注入）
- Modify: `src/main/agentBaselineRegistry.ts`（`syncProtectionValue` の先頭の分岐）
- Modify: `src/shared/types/agentChanges.ts`（理由 `too-many-files`・`inside-git-dir` と説明）
- Modify: `src/renderer/src/lib/agentChangesMessages.ts`（新しい理由の全文・短い形・件数）
- Modify: `src/main/__tests__/helpers/agentBaselineFixtures.ts`（`createAgentNonGitFolder`・`folderEntries`・`folderChangesExcept`〈新規〉）
- Test: `src/main/__tests__/agentBaselineSnapshot.integration.test.ts`・`src/main/__tests__/agentBaselineRegistry.test.ts`・`src/renderer/src/lib/__tests__/agentChangesMessages.test.ts`・`src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts`・`src/main/__tests__/helpers/agentBaselineFixtures.test.ts`

**Interfaces:**
- Consumes: Task 1 の `createBaselineGit(location)`・`runBaselineGitWithInput(location, …)`・`readRecordHead`・`assertBaselineGitDir`・`BaselineGitLocation`、Task 2a の `createHiddenGit`・`hiddenGitEmptyIndexPath`、Task 2b の `baselineTempDirPrefix`・`TakeBaselineOptions.instanceId`、Task 3a の `BaselineCheckpointBase`・`snapshotBase`
- Produces:
```ts
// src/main/gitRepoDetection.ts
export async function isInsideGitDirectory(git: SimpleGit): Promise<boolean>

// src/shared/types/agentChanges.ts
export const AGENT_CHANGES_UNAVAILABLE_REASONS = [
  'not-repository', 'not-toplevel', 'too-many-untracked', 'too-many-files', 'inside-git-dir', 'timeout', 'git-failed'
] as const

// src/main/__tests__/helpers/agentBaselineFixtures.ts
export function createAgentNonGitFolder(prefix: string): AgentBaselineRepo
export function folderEntries(folder: string): Record<string, string>
export function folderChangesExcept(
  before: Record<string, string>,
  after: Record<string, string>,
  changed: readonly string[]
): string[]
```
- 記録の結果の形（後のタスクが前提にする）: Git 管理外のフォルダの累積の始点は `gitDir: join(snapshot.tempDir, 'git')`・`head: null`。区切りは `gitDir` が始点と同じで、区切りの一時ディレクトリに `git` を作らない。

- [ ] **Step 1: 失敗するテストを書く（renderer の理由の文言と shared の理由）**

`src/renderer/src/lib/__tests__/agentChangesMessages.test.ts`:
1. `describe('記録できない理由', ...)` の最後に足す:
```ts
  it('Git 管理外のフォルダのファイルが多すぎるときは、リポジトリの初期化と .gitignore を勧め、件数と合計を添える', () => {
    expect(
      describeAgentChangesUnavailable({
        kind: 'unavailable',
        reason: 'too-many-files',
        untrackedCount: 5005,
        untrackedBytes: 0
      })
    ).toBe(
      'ファイルが多すぎるため、記録できません。リポジトリを初期化するか、.gitignore で記録しないファイルを指定してください（5,005 件）'
    )
    expect(
      describeAgentChangesUnavailable({
        kind: 'unavailable',
        reason: 'too-many-files',
        untrackedCount: 21,
        untrackedBytes: 105 * 1024 * 1024
      })
    ).toBe(
      'ファイルが多すぎるため、記録できません。リポジトリを初期化するか、.gitignore で記録しないファイルを指定してください（21 件・105.0 MB）'
    )
  })

  it('.git の中・bare リポジトリのフォルダの理由(パスを含めない。L-017)', () => {
    expect(describeAgentChangesUnavailable({ kind: 'unavailable', reason: 'inside-git-dir' })).toBe(
      'Git のデータのフォルダ（.git の中・bare リポジトリ）では、エージェントの変更を記録できません'
    )
  })
```
2. `it('開始を記録できなかった理由の短い形は、記録できない理由をすべて網羅する', ...)` の期待値を次にする:
```ts
    expect(AGENT_CHANGES_RUN_UNAVAILABLE_SHORT).toEqual({
      'not-repository': 'Git 管理外のフォルダです',
      'not-toplevel': 'リポジトリの最上位のフォルダではありません',
      'too-many-untracked': '未追跡のファイルが多すぎます',
      'too-many-files': 'ファイルが多すぎます',
      'inside-git-dir': 'Git のデータのフォルダです',
      timeout: '時間がかかりすぎました',
      'git-failed': 'git を実行できませんでした'
    })
```

`src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts` の `describe('「もう一度試す」を出す理由', ...)`:
1. `it.each([...])` の表の `['too-many-untracked', false]` の次に `['too-many-files', false],` と `['inside-git-dir', false],` を足す
2. `covered` の配列の `'too-many-untracked'` の次に `'too-many-files',` と `'inside-git-dir'` を足す

- [ ] **Step 2: 失敗するテストを書く（Git 管理外のフォルダの補助）**

`src/main/__tests__/helpers/agentBaselineFixtures.ts`:
1. `node:fs` の import に `lstatSync`・`readdirSync` を足し、`node:path` の import に `dirname` を足し、`./realGitRepo` の import に `stubGitCeiling` を足す
2. `disposeAgentBaselineRepo` の後に足す:
```ts
// Git 管理外のフォルダ(realpath 済み。中身は空)と HOME・tempRoot。戻り値は AgentBaselineRepo と同じ形で、repo が Git 管理外のフォルダ
// (disposeAgentBaselineRepo でそのまま片付ける)。stubIsolatedGitEnv・stubGitHome は createAgentBaselineRepo と同じ。上の
// フォルダのリポジトリ(TMPDIR がリポジトリの中にある環境など)を拾わないよう、GIT_CEILING_DIRECTORIES をフォルダの親にする
// (git は作業中のフォルダと同じパスの GIT_CEILING_DIRECTORIES を無視して上へ探すため、フォルダ自身を指定しても効かない)
export function createAgentNonGitFolder(prefix: string): AgentBaselineRepo {
  stubIsolatedGitEnv()
  const repo = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  const home = mkdtempSync(join(tmpdir(), `${prefix}home-`))
  const tempRoot = mkdtempSync(join(tmpdir(), `${prefix}temp-`))
  stubGitHome(home)
  stubGitCeiling(dirname(repo))
  return { repo, home, tempRoot }
}

// フォルダの中のすべてのパス(相対。.git の中を含む)の種類・大きさ・更新時刻・モード。操作の前後で比べ、利用者のフォルダに
// 書かないこと(.git などを作らないこと)を確かめる(設計書「セキュリティ」)
export function folderEntries(folder: string): Record<string, string> {
  const result: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const name of readdirSync(join(folder, dir))) {
      const rel = dir === '' ? name : `${dir}/${name}`
      const stat = lstatSync(join(folder, rel))
      const kind = stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'dir' : 'file'
      result[rel] = `${kind} ${stat.size} ${stat.mtimeMs} ${(stat.mode & 0o7777).toString(8)}`
      if (kind === 'dir') walk(rel)
    }
  }
  walk('')
  return result
}

// folderEntries の前後の違いのうち、操作が変えたパス(changed)・その中・その祖先のフォルダ(中身が変わると更新時刻が変わる)を
// 除いたもの。空なら、操作が変えたもの以外は変わっていない
export function folderChangesExcept(
  before: Record<string, string>,
  after: Record<string, string>,
  changed: readonly string[]
): string[] {
  const touched = (rel: string): boolean =>
    changed.some((c) => rel === c || rel.startsWith(`${c}/`) || c.startsWith(`${rel}/`))
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((rel) => !touched(rel) && before[rel] !== after[rel])
    .sort()
}
```

`src/main/__tests__/helpers/agentBaselineFixtures.test.ts` の最後に足す（import に `createAgentNonGitFolder`・`folderChangesExcept`・`folderEntries`、`node:fs` の `existsSync`・`mkdirSync`・`writeFileSync`、`node:path` の `dirname`・`join` が無ければ足す）:
```ts
describe('createAgentNonGitFolder / folderEntries / folderChangesExcept', () => {
  let dirs: AgentBaselineRepo | null = null

  afterEach(() => {
    if (dirs !== null) disposeAgentBaselineRepo(dirs)
    dirs = null
  })

  it('Git 管理外のフォルダ(.git が無い)を作り、dispose で消す', () => {
    dirs = createAgentNonGitFolder('baseline-fixtures-plain-')
    expect(existsSync(join(dirs.repo, '.git'))).toBe(false)
    expect(process.env.GIT_CEILING_DIRECTORIES).toBe(dirname(dirs.repo))
  })

  it('folderEntries はフォルダの中のパスを再帰で並べ、folderChangesExcept は変えたパス・その中・祖先を除いて違いを返す', () => {
    dirs = createAgentNonGitFolder('baseline-fixtures-plain-')
    mkdirSync(join(dirs.repo, 'd'))
    writeFileSync(join(dirs.repo, 'd', 'x.txt'), 'x')
    writeFileSync(join(dirs.repo, 'a.txt'), 'a')
    const before = folderEntries(dirs.repo)
    expect(Object.keys(before).sort()).toEqual(['a.txt', 'd', 'd/x.txt'])
    writeFileSync(join(dirs.repo, 'd', 'x.txt'), 'xx')
    const after = folderEntries(dirs.repo)
    expect(folderChangesExcept(before, after, ['d/x.txt'])).toEqual([])
    expect(folderChangesExcept(before, after, [])).toEqual(['d/x.txt'])
  })
})
```
（`AgentBaselineRepo` の型の import が無ければ `import type { AgentBaselineRepo } from './agentBaselineFixtures'` を足す）

- [ ] **Step 3: 失敗するテストを書く（隠れた git の記録・実 git）**

`src/main/__tests__/agentBaselineSnapshot.integration.test.ts`:
1. import に次を足す（今の import の並びに合わせてまとめる）: `node:fs` の `chmodSync`・`renameSync`・`symlinkSync`、`node:path` の `basename`（Task 2b で足した）、`import type { BaselineSnapshotResult, TakeBaselineOptions } from '../agentBaselineSnapshot'`、`./helpers/agentBaselineFixtures` の `createAgentNonGitFolder`・`folderEntries`
2. `it('Git 管理外のフォルダは not-repository', ...)` のテストを消す（Git 管理外のフォルダは隠れた git で記録する。下の節で固定する）
3. `describe('takeBaselineSnapshot の tree と区切り(base)(実 git)', ...)` の最後に足す:
```ts
  it('リポジトリの方式の記録の区切りで .git が消えていたら not-repository で、隠れた git を作らない(L-041)', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const first = await takeFrom()
    rmSync(join(repo, '.git'), { recursive: true, force: true })
    expect(
      await takeBaselineSnapshot(repo, {
        tempRoot,
        instanceId: FAKE_PROTECTION_INSTANCE_ID,
        base: snapshotBase(first)
      })
    ).toEqual({ kind: 'unavailable', state: { kind: 'unavailable', reason: 'not-repository' } })
    expect(readdirSync(tempRoot)).toEqual([basename(first.tempDir)])
  })
```
4. ファイルの最後に足す:
```ts
describe('Git 管理外のフォルダ(隠れた git)(実 git)', () => {
  let folder: string
  let folderHome: string
  let folderTemp: string
  const put = (p: string, content: string): void => writeRepoFile(folder, p, content)
  const take = (options: Partial<TakeBaselineOptions> = {}): Promise<BaselineSnapshotResult> =>
    takeBaselineSnapshot(folder, {
      tempRoot: folderTemp,
      instanceId: FAKE_PROTECTION_INSTANCE_ID,
      ...options
    })
  const hiddenPaths = async (snapshot: BaselineSnapshot): Promise<string[]> =>
    (await createBaselineGit(snapshot).raw(['ls-files', '-z']))
      .split('\0')
      .filter((p) => p !== '')
  const gitDirOf = (snapshot: BaselineSnapshot): string => {
    if (snapshot.gitDir === null) throw new Error('隠れた git の記録ではない')
    return snapshot.gitDir
  }
  // 偽の git: 引数に word があれば script を実行し、それ以外は本物の git に渡す
  const fakeGitOn = (word: string, script: string): void => {
    const realGit = execFileSync('which', ['git']).toString().trim()
    const bin = join(folderHome, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(
      join(bin, 'git'),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = "${word}" ] && ${script}; done\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 }
    )
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
  }

  beforeEach(() => {
    ;({ repo: folder, home: folderHome, tempRoot: folderTemp } = createAgentNonGitFolder('baseline-plain-'))
  })

  afterEach(() => disposeAgentBaselineRepo({ repo: folder, home: folderHome, tempRoot: folderTemp }))

  it('累積の始点: 通常・実行ビット・シンボリックリンク(指す先を辿らない)・バイナリを記録し、HEAD は null、gitDir は一時ディレクトリの中。フォルダの中は変わらない(.git を作らない)', async () => {
    put('a.txt', 'a\n')
    put('run.sh', '#!/bin/sh\n')
    chmodSync(join(folder, 'run.sh'), 0o755)
    symlinkSync('../outside.txt', join(folder, 'link.txt'))
    writeFileSync(join(folder, 'bin.dat'), Buffer.from([0, 1, 2, 255]))
    const before = folderEntries(folder)
    const snapshot = recordedSnapshot(await take())
    expect(folderEntries(folder)).toEqual(before)
    expect(existsSync(join(folder, '.git'))).toBe(false)
    expect(snapshot.head).toBeNull()
    expect(snapshot.gitDir).toBe(join(snapshot.tempDir, 'git'))
    expect(snapshot.tree).toMatch(/^[0-9a-f]{40}$/)
    const staged = await createBaselineGit(snapshot).raw(['ls-files', '-s'])
    expect(staged).toMatch(/^100644 \S+ 0\ta\.txt$/m)
    expect(staged).toMatch(/^100755 \S+ 0\trun\.sh$/m)
    expect(staged).toMatch(/^100644 \S+ 0\tbin\.dat$/m)
    const linkBlob = /^120000 (\S+) 0\tlink\.txt$/m.exec(staged)?.[1] ?? ''
    // リンクは指す先の文字列を記録する(フォルダの外を辿らない。L-016)
    expect(await createBaselineGit(snapshot).raw(['cat-file', '-p', linkBlob])).toBe('../outside.txt')
  })

  it('フォルダの .gitignore と既定の一覧(node_modules/・dist/・.DS_Store。深い dist/ も)は記録せず、記録の時点の ignore 済みの一覧に入る', async () => {
    put('a.txt', 'a\n')
    put('.gitignore', 'secret.txt\n')
    put('secret.txt', 's\n')
    put('node_modules/m.js', 'm\n')
    put('dist/out.js', 'o\n')
    put('packages/x/dist/y.js', 'y\n')
    put('.DS_Store', 'x')
    const snapshot = recordedSnapshot(await take())
    expect(await hiddenPaths(snapshot)).toEqual(['.gitignore', 'a.txt'])
    expect(snapshot.ignoredAtBaseline).toEqual(
      expect.arrayContaining(['.DS_Store', 'dist/', 'node_modules/', 'secret.txt'])
    )
  })

  it('フォルダの .gitignore の !dist/ で既定の一覧を打ち消すと記録する(確認の結果 11)', async () => {
    put('.gitignore', '!dist/\n')
    put('dist/out.js', 'o\n')
    expect(await hiddenPaths(recordedSnapshot(await take()))).toEqual(['.gitignore', 'dist/out.js'])
  })

  it('ignore されていないファイルが 5,000 件を超えると too-many-files(件数)で、一時ディレクトリを残さない(既定の一覧の中は数えない)', async () => {
    mkdirSync(join(folder, 'many'))
    for (let i = 0; i <= 5_000; i++) writeFileSync(join(folder, 'many', `${i}.txt`), '')
    put('node_modules/skip.js', 'x\n')
    expect(await take()).toEqual({
      kind: 'unavailable',
      state: {
        kind: 'unavailable',
        reason: 'too-many-files',
        untrackedCount: 5_001,
        untrackedBytes: 0
      }
    })
    expect(readdirSync(folderTemp)).toEqual([])
  })

  it('区切りの未追跡の事前の検査も空の index で数える(始点の記録に入ったファイルも数える)。超えたら too-many-files で、区切りの一時ディレクトリを残さない', async () => {
    mkdirSync(join(folder, 'many'))
    // 始点は上限(AGENT_BASELINE_MAX_UNTRACKED_FILES = 5,000)より 1 件少ない 4,999 件で記録できる
    for (let i = 0; i < 4_999; i++) writeFileSync(join(folder, 'many', `${i}.txt`), '')
    const first = recordedSnapshot(await take())
    // 2 件足すと、始点の記録に入った 4,999 件も数えて 5,001 件になる(記録のインデックスを基準にすると 2 件に見える)
    put('one.txt', '1\n')
    put('two.txt', '2\n')
    expect(await take({ base: snapshotBase(first) })).toEqual({
      kind: 'unavailable',
      state: {
        kind: 'unavailable',
        reason: 'too-many-files',
        untrackedCount: 5_001,
        untrackedBytes: 0
      }
    })
    expect(readdirSync(folderTemp)).toEqual([basename(first.tempDir)])
  })

  it('5MB を超えるファイルは記録から除外して控える', async () => {
    put('a.txt', 'a\n')
    put('big.bin', '')
    truncateSync(join(folder, 'big.bin'), 6 * 1024 * 1024)
    const snapshot = recordedSnapshot(await take())
    expect(await hiddenPaths(snapshot)).toEqual(['a.txt'])
    expect(snapshot.excluded.map((file) => file.path)).toEqual(['big.bin'])
  })

  it.each(['bare リポジトリのフォルダ', '.git の中'] as const)(
    '%s は inside-git-dir で、一時ディレクトリを作らず、中身も変えない',
    async (kind) => {
      let target: string
      if (kind === 'bare リポジトリのフォルダ') {
        target = join(folder, 'x.git')
        runGit(folder, 'init', '-q', '--bare', target)
      } else {
        runGit(folder, 'init', '-q')
        target = join(folder, '.git')
      }
      const before = folderEntries(target)
      expect(
        await takeBaselineSnapshot(target, {
          tempRoot: folderTemp,
          instanceId: FAKE_PROTECTION_INSTANCE_ID
        })
      ).toEqual({ kind: 'unavailable', state: { kind: 'unavailable', reason: 'inside-git-dir' } })
      expect(folderEntries(target)).toEqual(before)
      expect(readdirSync(folderTemp)).toEqual([])
    }
  )

  it('区切りは始点と同じ隠れた git を使い、新しい隠れた git を作らない(区切りの一時ディレクトリに git が無い)', async () => {
    put('a.txt', 'a\n')
    const first = recordedSnapshot(await take())
    put('a.txt', 'a\nrun1\n')
    put('n.txt', 'n\n')
    const second = recordedSnapshot(await take({ base: snapshotBase(first) }))
    expect(second.gitDir).toBe(first.gitDir)
    expect(readdirSync(second.tempDir)).not.toContain('git')
    expect(second.head).toBeNull()
    expect(
      (
        await createBaselineGit(first).raw([
          'diff-tree',
          '-r',
          '--name-status',
          '--no-renames',
          first.tree,
          second.tree
        ])
      )
        .trim()
        .split('\n')
    ).toEqual(['M\ta.txt', 'A\tn.txt'])
    expect(existsSync(join(folder, '.git'))).toBe(false)
  })

  it('区切りの写しの元に引き継いだパスが今 ignore されるなら外す(利用者の追跡済みの一覧は空として求める)', async () => {
    put('a.txt', 'a\n')
    put('later.txt', 'l\n')
    const first = recordedSnapshot(await take())
    put('.gitignore', 'later.txt\n')
    put('later.txt', 'l2\n')
    const second = recordedSnapshot(await take({ base: snapshotBase(first) }))
    expect(await hiddenPaths(second)).toEqual(['.gitignore', 'a.txt'])
    expect(second.ignoredAtBaseline).toContain('later.txt')
  })

  it('区切りで記録の隠れた git(base.gitDir)が無ければ git-failed で、新しい隠れた git を作らない(L-002)', async () => {
    put('a.txt', 'a\n')
    const first = recordedSnapshot(await take())
    const gitDir = gitDirOf(first)
    rmSync(gitDir, { recursive: true, force: true })
    expect(await take({ base: snapshotBase(first) })).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'git-failed' }
    })
    expect(readdirSync(folderTemp)).toEqual([basename(first.tempDir)])
    expect(existsSync(gitDir)).toBe(false)
  })

  it('区切りで base.gitDir がシンボリックリンクなら git-failed で、リンクの先を使わない(L-437)', async () => {
    put('a.txt', 'a\n')
    const first = recordedSnapshot(await take())
    const gitDir = gitDirOf(first)
    renameSync(gitDir, `${gitDir}-real`)
    symlinkSync(`${gitDir}-real`, gitDir)
    expect(await take({ base: snapshotBase(first) })).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'git-failed' }
    })
    expect(readdirSync(folderTemp)).toEqual([basename(first.tempDir)])
  })

  it('記録中に利用者が git init しても、区切りは隠れた git のまま取れ、.git を記録せず、利用者の .git を変えない(L-041)', async () => {
    put('a.txt', 'a\n')
    const first = recordedSnapshot(await take())
    runGit(folder, 'init', '-q')
    put('b.txt', 'b\n')
    const gitBefore = folderEntries(join(folder, '.git'))
    const second = recordedSnapshot(await take({ base: snapshotBase(first) }))
    expect(second.gitDir).toBe(first.gitDir)
    expect(second.head).toBeNull()
    expect(await hiddenPaths(second)).toEqual(['a.txt', 'b.txt'])
    expect(folderEntries(join(folder, '.git'))).toEqual(gitBefore)
  })

  // 親の環境は env の選択肢で渡す(createRepoGit は process.env を引き継ぐため、process.env に入れると方式の判定そのものが
  // 別のリポジトリを指す。リポジトリの方式の今の挙動と同じで範囲外)。隠れた git の作成と記録の git が位置の変数を外すことを確かめる
  it('親の環境に別のリポジトリを指す GIT_DIR・GIT_OBJECT_DIRECTORY があっても、そのリポジトリを変えずに隠れた git で記録する(L-075)', async () => {
    const other = realpathSync(mkdtempSync(join(folderHome, 'other-')))
    initRepo(other)
    writeRepoFile(other, 'o.txt', 'o\n')
    commitAll(other, 'init')
    const otherBefore = folderEntries(join(other, '.git'))
    put('a.txt', 'a\n')
    const snapshot = recordedSnapshot(
      await take({
        env: {
          ...process.env,
          GIT_DIR: join(other, '.git'),
          GIT_OBJECT_DIRECTORY: join(other, '.git', 'objects')
        }
      })
    )
    expect(folderEntries(join(other, '.git'))).toEqual(otherBefore)
    expect(await hiddenPaths(snapshot)).toEqual(['a.txt'])
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
    '%i 回目の確認で取り消されたら canceled を返し、一時ディレクトリを残さない(パターン 141)',
    async (cancelAt) => {
      put('a.txt', 'a\n')
      let calls = 0
      expect(await take({ isCanceled: () => ++calls >= cancelAt })).toEqual({ kind: 'canceled' })
      expect(readdirSync(folderTemp)).toEqual([])
    }
  )

  // 確認は 9 か所(リポジトリか・.git の中か・隠れた git の作成・未追跡の検査・add の前・add・ignore 済みの一覧・HEAD・tree の後)
  it('9 回の確認のどれでも取り消されなければ記録を返す', async () => {
    put('a.txt', 'a\n')
    let calls = 0
    const result = await take({ isCanceled: () => ++calls >= 10 })
    expect(result.kind).toBe('recorded')
    expect(calls).toBe(9)
  })

  it('隠れた git を作れなければ git-failed で、一時ディレクトリを残さない', async () => {
    put('a.txt', 'a\n')
    fakeGitOn('--bare', 'exit 1')
    expect(await take()).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'git-failed' }
    })
    expect(readdirSync(folderTemp)).toEqual([])
  })

  it('隠れた git の作成が打ち切りの時間を超えたら timeout で、一時ディレクトリを残さない', async () => {
    put('a.txt', 'a\n')
    fakeGitOn('--bare', 'exec sleep 5')
    expect(await take({ timeoutMs: 300 })).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'timeout' }
    })
    expect(readdirSync(folderTemp)).toEqual([])
  })
})
```

`src/main/__tests__/agentBaselineRegistry.test.ts` の `describe('AgentBaselineRegistry の隠れた git の記録', ...)`（Task 3a で足した）の最後に足す:
```ts
  it('保護の ref を作らず(保護の git を呼ばない)、実行を足しても・確認を終えても・アプリの終了でも呼ばない(L-403・L-428)', async () => {
    const s = setup()
    await sendHidden(s, '/tmp/base', 100)
    await sendHidden(s, '/tmp/r2', 200)
    // 列の後ろに並んだ保護の同期を走らせ終える
    await s.registry.withRecord(1, '/repo', async () => undefined)
    expect(s.protection.calls).toEqual([])
    await s.registry.clear(1)
    s.registry.close()
    expect(s.protection.calls).toEqual([])
  })
```

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts`
Expected: FAIL（Git 管理外のフォルダが `not-repository` のまま、理由 `too-many-files`・`inside-git-dir` が無い、補助が無い、保護の git が呼ばれる）

- [ ] **Step 5: shared の理由と renderer の文言を足す**

`src/shared/types/agentChanges.ts` の `AGENT_CHANGES_UNAVAILABLE_REASONS` とコメントを次にする:
```ts
/**
 * 記録できない理由。not-repository: リポジトリの方式の記録の途中で Git 管理外になった(区切りでだけ返る)、not-toplevel: リポジトリの
 * サブフォルダ、too-many-untracked: 未追跡のファイルが多すぎる・大きすぎる(リポジトリ)、too-many-files: ignore されていないファイルが
 * 多すぎる・大きすぎる(Git 管理外のフォルダ)、inside-git-dir: .git の中・bare リポジトリのフォルダ、timeout: 記録の打ち切り、
 * git-failed: git を実行できない
 */
export const AGENT_CHANGES_UNAVAILABLE_REASONS = [
  'not-repository',
  'not-toplevel',
  'too-many-untracked',
  'too-many-files',
  'inside-git-dir',
  'timeout',
  'git-failed'
] as const
```
と、`AgentChangesState` の `unavailable` の `/** too-many-untracked のときの未追跡のファイルの数・合計の大きさ(バイト) */` を `/** too-many-untracked・too-many-files のときのファイルの数・合計の大きさ(バイト) */` にする。

`src/renderer/src/lib/agentChangesMessages.ts`:
1. `AGENT_CHANGES_UNAVAILABLE_MESSAGES` の `'too-many-untracked': …,` の次に足す:
```ts
  'too-many-files':
    'ファイルが多すぎるため、記録できません。リポジトリを初期化するか、.gitignore で記録しないファイルを指定してください',
  'inside-git-dir':
    'Git のデータのフォルダ（.git の中・bare リポジトリ）では、エージェントの変更を記録できません',
```
2. `describeAgentChangesUnavailable` のコメントを `/** 記録できない理由の文言。ファイルが多すぎるとき(too-many-untracked・too-many-files)は件数と合計を添える */` にし、`if (state.reason !== 'too-many-untracked' || state.untrackedCount === undefined) return base` を次にする:
```ts
  const isTooMany = state.reason === 'too-many-untracked' || state.reason === 'too-many-files'
  if (!isTooMany || state.untrackedCount === undefined) return base
```
3. `AGENT_CHANGES_RUN_UNAVAILABLE_SHORT` の `'too-many-untracked': '未追跡のファイルが多すぎます',` の次に足す:
```ts
  'too-many-files': 'ファイルが多すぎます',
  'inside-git-dir': 'Git のデータのフォルダです',
```

- [ ] **Step 6: `isInsideGitDirectory` を移す**

`src/main/gitRepoDetection.ts`（新規）:
```ts
import type { SimpleGit } from 'simple-git'
import { isGitTimeoutError } from './gitStepErrors'

// リポジトリの判定のうち、リポジトリの初期化(gitRemoteSetupService)とエージェントの変更の記録(agentBaselineSnapshot)が共有するもの

/**
 * bare リポジトリと .git ディレクトリ(とその中)では、checkIsRepo(--is-inside-work-tree)は `false` を出力して偽になるが、
 * rev-parse --git-dir はそこで成功する(`.` や絶対パスを出力する)ため、成功なら Git のデータのフォルダと判定する。checkIsRepo が偽で
 * resolve した直後に呼び、reject はリポジトリの外(管理外・壊れた .git ファイル・HEAD の無い .git は、どれも
 * `fatal: not a git repository` で終了コード 128。実機で確認)と扱う。文言では分岐しない(パターン 18)。
 * 打ち切りだけは区別して投げる(打ち切りは「リポジトリの外」の根拠にならない)
 */
export async function isInsideGitDirectory(git: SimpleGit): Promise<boolean> {
  try {
    await git.raw(['rev-parse', '--git-dir'])
    return true
  } catch (err) {
    if (isGitTimeoutError(err)) throw err
    return false
  }
}
```

`src/main/gitRemoteSetupService.ts`: `// bare リポジトリと .git ディレクトリ(とその中)では、…` のコメントから `async function isInsideGitDirectory(git: SimpleGit): Promise<boolean> { … }` の終わりまでを消し、import に `import { isInsideGitDirectory } from './gitRepoDetection'` を足す（`isGitTimeoutError` をほかで使っていなければ `./gitStepErrors` の import から外す。`npx eslint` の未使用の検査で分かる）。

- [ ] **Step 7: 方式の決め方と隠れた git の記録を実装する**

`src/main/agentBaselineSnapshot.ts`:
1. import を次の形にする（今の import に足す。`createRepoGit` は入れ子のリポジトリの HEAD と利用者の index で使い続ける）:
```ts
import type { SimpleGit } from 'simple-git'
import type { AgentChangesState, AgentChangesUnavailableReason } from '@shared/types'
import { assertBaselineGitDir } from './agentBaselineCoverage'
import {
  createBaselineGit,
  createRepoGit,
  readRecordHead,
  runBaselineGitWithInput
} from './agentBaselineGit'
import type { BaselineGitLocation, BaselineGitOptions } from './agentBaselineGit'
import { createHiddenGit, hiddenGitEmptyIndexPath } from './agentBaselineHiddenGit'
import { baselineTempDirPrefix } from './agentBaselineTempSweep'
import { isInsideGitDirectory } from './gitRepoDetection'
import { parseNulSeparatedPaths } from './gitPathParsing'
import { isGitTimeoutError } from './gitStepErrors'
```
2. 先頭のコメント（`// エージェントの実行の前の作業ツリーを、…`）の最後に足す:
```ts
// Git 管理外のフォルダは、記録の一時ディレクトリの中の隠れた git(agentBaselineHiddenGit)に GIT_DIR・GIT_WORK_TREE で記録する
// (2026-10-15 の設計書。利用者のフォルダには何も書かない)。方式は resolveBaselineMode で決め、方式ごとの関数で記録する
```
3. `inheritedIgnoredPaths` を次に置き換える（`repoGit` の問い合わせを、利用者の追跡済みのパスの集合を返す関数の注入にする）:
```ts
/**
 * 写しの元から引き継いだエントリのうち、利用者から見て未追跡(trackedByUser に無い)で、今の規則で ignore されるパス。
 * 前の記録に未追跡として入った後に .gitignore に足された・利用者が git rm --cached してから ignore したファイルは、
 * 記録のインデックスでは追跡中のまま残る(git add -A は追跡中のファイルを ignore の規則に関わらず更新する)。
 * .git/index から作った場合には記録に入らないため、区切りでも外して同じ tree・ignoredAtBaseline にする。
 * trackedByUser はリポジトリの方式は利用者の index の一覧、隠れた git は空の集合(フォルダ全体が利用者から見て未追跡)
 */
async function inheritedIgnoredPaths(
  baselineGit: SimpleGit,
  trackedByUser: () => Promise<ReadonlySet<string>>
): Promise<string[]> {
  const ignoredInRecord = parseNulSeparatedPaths(
    await baselineGit.raw(['ls-files', '-z', '--cached', '--ignored', '--exclude-standard'])
  )
  if (ignoredInRecord.length === 0) return []
  const tracked = await trackedByUser()
  // コンフリクト中のエントリは段ごとに並ぶため、重ねない
  return [...new Set(ignoredInRecord.filter((path) => !tracked.has(path)))]
}
```
4. `/**\n * 記録を取る。手順: …` のコメントから、ファイルの最後（`takeBaselineSnapshot` の終わり）までを次に置き換える:
```ts
/**
 * 記録の方式。repository: 利用者の .git(今の手順)、hidden-new: 隠れた git を作る(Git 管理外のフォルダの累積の始点)、
 * hidden: 記録の隠れた git(その区切り)、unavailable: 記録できない
 */
type BaselineMode =
  | { kind: 'repository' }
  | { kind: 'hidden-new' }
  | { kind: 'hidden'; gitDir: string }
  | {
      kind: 'unavailable'
      reason: Extract<AgentChangesUnavailableReason, 'not-repository' | 'not-toplevel' | 'inside-git-dir'>
    }

/** 方式ごとの手順が共有するもの */
interface SnapshotStep {
  folderPath: string
  tempDir: string
  indexPath: string
  startedAt: number
  gitOptions: BaselineGitOptions
  /** await のたびに呼ぶ(取り消されていたら SnapshotCanceled を投げる) */
  checkpoint: () => void
}

type UntrackedInspection = Extract<Awaited<ReturnType<typeof inspectUntracked>>, { kind: 'ok' }>

/** 方式ごとの手順の結果。too-many は理由(リポジトリは too-many-untracked、隠れた git は too-many-files)と数を返す */
type SnapshotOutcome =
  | { kind: 'recorded'; snapshot: BaselineSnapshot }
  | { kind: 'too-many'; reason: 'too-many-untracked' | 'too-many-files'; count: number; bytes: number }

/**
 * 方式の決め方(設計書「方式の決め方」)。base の gitDir が文字列(隠れた git の記録の区切り)ならフォルダを調べ直さず隠れた git に
 * する(記録中に git init されても変えない。L-041)。共有の隠れた git がリンクでないディレクトリでなければ例外(git-failed。新しく作らない。
 * L-002・L-437)。それ以外はリポジトリか・最上位かを確かめ、リポジトリの方式の区切りで Git 管理外になっていたら not-repository
 * (隠れた git に切り替えない)。累積の始点で Git 管理外なら、.git の中・bare リポジトリでなければ隠れた git を作る
 */
async function resolveBaselineMode(
  folderPath: string,
  repoGit: SimpleGit,
  base: BaselineCheckpointBase | undefined,
  checkpoint: () => void
): Promise<BaselineMode> {
  if (base !== undefined && base.gitDir !== null) {
    await assertBaselineGitDir({ gitDir: base.gitDir })
    checkpoint()
    return { kind: 'hidden', gitDir: base.gitDir }
  }
  const isRepo = await repoGit.checkIsRepo()
  checkpoint()
  if (isRepo) {
    const toplevel = stripTrailingNewline(await repoGit.raw(['rev-parse', '--show-toplevel']))
    checkpoint()
    return (await canonical(toplevel)) === (await canonical(folderPath))
      ? { kind: 'repository' }
      : { kind: 'unavailable', reason: 'not-toplevel' }
  }
  if (base !== undefined) return { kind: 'unavailable', reason: 'not-repository' }
  const insideGitDir = await isInsideGitDirectory(repoGit)
  checkpoint()
  return insideGitDir ? { kind: 'unavailable', reason: 'inside-git-dir' } : { kind: 'hidden-new' }
}

/**
 * リポジトリの方式: 写し(base の記録のインデックス、無ければ .git/index。.git/index が無ければ空)→ 未追跡の事前の検査(区切りでも
 * 利用者の index で問い合わせる)→ 共通の手順(finishSnapshot)
 */
async function recordRepositorySnapshot(
  step: SnapshotStep,
  repoGit: SimpleGit,
  baseIndexPath: string | undefined
): Promise<SnapshotOutcome> {
  const { folderPath, indexPath, gitOptions, checkpoint } = step
  const sourceIndex = baseIndexPath ?? (await userIndexPathOf(repoGit, folderPath))
  checkpoint()
  // 区切りの写しの元が無いのは記録の一時ディレクトリが失われた異常で、空から始めると全ファイルを追加として記録するため、
  // 例外にして git-failed にする(L-002)
  await copyIndexPreservingTimes(sourceIndex, indexPath, { required: baseIndexPath !== undefined })
  checkpoint()
  // 未追跡の事前の検査は、区切りでも利用者の index で問い合わせる(累積の始点と同じ基準)。記録のインデックスで問い合わせると、
  // 前の記録に未追跡として入ったファイルが後で 5MB を超えても追跡済みに見えて除外されず、送るたびに丸ごと hash する
  const inspection = await inspectUntracked(
    folderPath,
    await repoGit.raw(['ls-files', '-z', '--others', '--exclude-standard']),
    gitOptions
  )
  checkpoint()
  if (inspection.kind === 'too-many') {
    return { kind: 'too-many', reason: 'too-many-untracked', count: inspection.count, bytes: inspection.bytes }
  }
  return finishSnapshot(step, { folderPath, indexPath, gitDir: null }, inspection, {
    inherited: baseIndexPath !== undefined,
    trackedByUser: async () =>
      new Set(parseNulSeparatedPaths(await repoGit.raw(['ls-files', '-z', '--cached'])))
  })
}

/**
 * 隠れた git: 新規なら記録の一時ディレクトリの中に作る(区切りは base の隠れた git を共有する)→ 写し(新規は写さず空から、区切りは
 * base の記録のインデックス。無ければ例外)→ 未追跡の事前の検査(始点でも区切りでも空の index で数える。フォルダ全体が利用者から見て
 * 未追跡)→ 共通の手順。失敗したら呼び出し側が自分の一時ディレクトリだけを消す(区切りは共有の隠れた git に触れない。L-004)
 */
async function recordHiddenSnapshot(
  step: SnapshotStep,
  mode: Extract<BaselineMode, { kind: 'hidden-new' } | { kind: 'hidden' }>,
  baseIndexPath: string | undefined
): Promise<SnapshotOutcome> {
  const { folderPath, tempDir, indexPath, gitOptions, checkpoint } = step
  const gitDir = mode.kind === 'hidden' ? mode.gitDir : await createHiddenGit(tempDir, gitOptions)
  checkpoint()
  if (baseIndexPath !== undefined) {
    await copyIndexPreservingTimes(baseIndexPath, indexPath, { required: true })
    checkpoint()
  }
  const untracked = await createBaselineGit(
    { folderPath, indexPath: hiddenGitEmptyIndexPath(tempDir), gitDir },
    gitOptions
  ).raw(['ls-files', '-z', '--others', '--exclude-standard'])
  const inspection = await inspectUntracked(folderPath, untracked, gitOptions)
  checkpoint()
  if (inspection.kind === 'too-many') {
    return { kind: 'too-many', reason: 'too-many-files', count: inspection.count, bytes: inspection.bytes }
  }
  return finishSnapshot(step, { folderPath, indexPath, gitDir }, inspection, {
    inherited: baseIndexPath !== undefined,
    trackedByUser: async () => new Set()
  })
}

/**
 * 方式に共通の手順: `git add -A`(除外したファイルを pathspec で外し、区切りは写しの元から引き継いだ除外のパスと、利用者から見て
 * 未追跡で今 ignore されるパスを記録のインデックスから外す)→ ignore 済みの一覧 → HEAD(隠れた git は null)→ tree を控える
 */
async function finishSnapshot(
  step: SnapshotStep,
  location: BaselineGitLocation,
  inspection: UntrackedInspection,
  inheritance: { inherited: boolean; trackedByUser: () => Promise<ReadonlySet<string>> }
): Promise<SnapshotOutcome> {
  const { folderPath, tempDir, indexPath, startedAt, gitOptions, checkpoint } = step
  // (ここから、今の takeBaselineSnapshot の「// 除外の pathspec は数が多くても…」から「const tree = parseWriteTreeOutput(…)」の
  // 後の checkpoint() までを、次の 5 点だけ変えて移す。コメントは今のまま)
  //   1. createBaselineGit(location, { ...gitOptions, config: ['advice.addEmbeddedRepo=false'] }) にする(Task 1 で location にした形)
  //   2. if (baseIndexPath !== undefined) を if (inheritance.inherited) にし、inheritedIgnoredPaths(baselineGit, repoGit) を
  //      inheritedIgnoredPaths(baselineGit, inheritance.trackedByUser) にする
  //   3. const head = (await repoGit.raw(['rev-parse', '--verify', '-q', 'HEAD'])).trim() || null を、次の 2 行にする:
  //      // リポジトリの方式は利用者の HEAD(コミットが無ければ null。打ち切りなどの失敗は握らない)、隠れた git は git を呼ばずに null
  //      const head = await readRecordHead(location, gitOptions)
  //   4. return は次の形にする
  //   5. Task 1 の Step 3 の 3 で足した `const location: BaselineGitLocation = { folderPath, indexPath, gitDir: null }` の行は移さない
  //      (引数の location を使う。移すと引数と名前が衝突し、引数を消すと隠れた git の記録が利用者の .git の場所で書かれる誤りになる)
  return {
    kind: 'recorded',
    snapshot: {
      folderPath,
      tempDir,
      indexPath,
      gitDir: location.gitDir,
      startedAt,
      head,
      tree,
      excluded: inspection.excluded,
      skippedRepos: inspection.skippedRepos,
      ignoredAtBaseline
    }
  }
}

/**
 * 記録を取る。方式を決め(resolveBaselineMode)、記録の一時ディレクトリ(名前に起動ごとの ID)を作って方式ごとの手順で記録する。
 * 記録できない理由は一時ディレクトリを作る前に返す。失敗・取り消しのときは自分の一時ディレクトリだけを消す(新規の隠れた git は
 * 一時ディレクトリの中なので一緒に消える)。各 git に打ち切り(既定は agentBaselineGit の AGENT_BASELINE_GIT_TIMEOUT_MS)
 */
export async function takeBaselineSnapshot(
  folderPath: string,
  {
    isCanceled = () => false,
    now = Date.now,
    tempRoot = tmpdir(),
    base,
    instanceId,
    ...gitOptions
  }: TakeBaselineOptions
): Promise<BaselineSnapshotResult> {
  const startedAt = now()
  const repoGit = createRepoGit(folderPath, gitOptions)
  let tempDir: string | null = null
  const checkpoint = (): void => {
    if (isCanceled()) throw new SnapshotCanceled()
  }
  try {
    const mode = await resolveBaselineMode(folderPath, repoGit, base, checkpoint)
    if (mode.kind === 'unavailable') {
      return { kind: 'unavailable', state: { kind: 'unavailable', reason: mode.reason } }
    }
    tempDir = await mkdtemp(join(tempRoot, baselineTempDirPrefix(instanceId)))
    const step: SnapshotStep = {
      folderPath,
      tempDir,
      indexPath: join(tempDir, 'index'),
      startedAt,
      gitOptions,
      checkpoint
    }
    const outcome =
      mode.kind === 'repository'
        ? await recordRepositorySnapshot(step, repoGit, base?.indexPath)
        : await recordHiddenSnapshot(step, mode, base?.indexPath)
    if (outcome.kind === 'too-many') {
      await removeBaselineDir(tempDir)
      return {
        kind: 'unavailable',
        state: {
          kind: 'unavailable',
          reason: outcome.reason,
          untrackedCount: outcome.count,
          untrackedBytes: outcome.bytes
        }
      }
    }
    return { kind: 'recorded', snapshot: outcome.snapshot }
  } catch (error) {
    if (tempDir !== null) await removeBaselineDir(tempDir)
    if (error instanceof SnapshotCanceled) return { kind: 'canceled' }
    if (isGitTimeoutError(error)) {
      return { kind: 'unavailable', state: { kind: 'unavailable', reason: 'timeout' } }
    }
    return { kind: 'unavailable', state: { kind: 'unavailable', reason: 'git-failed' } }
  }
}
```
   `finishSnapshot` の中の移す部分は、移した後に次の形になっていること（`checkpoint()` の数がリポジトリの方式で今と同じ 10 回・隠れた git の新規で 9 回になる）: pathspec のファイルを書く → `createBaselineGit(location, …)` → `if (inheritance.inherited) { removeInheritedPaths → checkpoint() → inheritedIgnoredPaths → checkpoint() → update-index }` → `checkpoint()` → `add` → `checkpoint()` → ignore 済みの一覧 → `checkpoint()` → `readRecordHead` → `checkpoint()` → `write-tree` → `checkpoint()`。`takeBaselineSnapshot` の今の本体にあった `const indexPath = join(tempDir, 'index')`・`const sourceIndex = …`・写し・未追跡の検査・`too-many` の分岐は `recordRepositorySnapshot` と `takeBaselineSnapshot` に移したので、`finishSnapshot` には残さない。
5. `AgentChangesUnavailable` の型（`Extract<AgentChangesState, …>`）は今のまま使う。`AgentChangesState` の import が型だけなら `import type` のまま

- [ ] **Step 8: 隠れた git の記録で保護を同期しない**

`src/main/agentBaselineRegistry.ts` の `syncProtectionValue` の本体の先頭（`const state = record.protection` の前）に足し、関数のコメントの最後に `隠れた git の記録(gitDir が文字列)は ref を作らず何もしない(設計書「保護の ref」。protectedRecords に入らないため、close・捨てた記録の削除の試し直しの対象にもならない)` を足す:
```ts
    // 隠れた git の記録は保護の ref を作らない(隠れた git の命令は自動の gc を起こさず、gc.auto=0 も書いてある。ref を通すと、
    // 前の記録の一時ディレクトリを消した後に並ぶ ref の削除が消えた場所に対して失敗し続ける。L-403・L-428)
    if (record.baseline.gitDir !== null) return
```

- [ ] **Step 9: テストが通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts src/main/__tests__/gitRemoteSetupService.test.ts src/main/__tests__/gitRemoteSetupService.integration.test.ts src/main/__tests__/agentBaselineHiddenGit.integration.test.ts`
Expected: PASS（`10 回の確認のどれでも取り消されなければ記録を返す`〈リポジトリの方式〉も今のまま通る）

- [ ] **Step 10: 変異で確かめる**

1. `resolveBaselineMode` の先頭の `if (base !== undefined && base.gitDir !== null) { … }` を消す → `記録中に利用者が git init しても、区切りは隠れた git のまま…` が落ちる（区切りが新しい記録の方式を決め直す）。戻す
2. `resolveBaselineMode` の `if (base !== undefined) return { kind: 'unavailable', reason: 'not-repository' }` を消す → `リポジトリの方式の記録の区切りで .git が消えていたら not-repository で…` が落ちる。戻す
3. `assertBaselineGitDir({ gitDir: base.gitDir })` の行を消す → `区切りで base.gitDir がシンボリックリンクなら git-failed…` が落ちる。戻す
4. `recordHiddenSnapshot` の `hiddenGitEmptyIndexPath(tempDir)` を `indexPath` にする → `区切りの未追跡の事前の検査も空の index で数える…` が落ちる（区切りが記録のインデックスを基準にして 2 件しか数えず、記録できてしまう）。戻す
5. `recordHiddenSnapshot` の `trackedByUser: async () => new Set()` を `trackedByUser: async () => new Set(['later.txt'])` にする → `区切りの写しの元に引き継いだパスが今 ignore されるなら外す…` が落ちる。戻す
6. `syncProtectionValue` の `if (record.baseline.gitDir !== null) return` を消す → `保護の ref を作らず(保護の git を呼ばない)…` が落ちる。戻す
7. `git diff` で戻したことを確かめる

- [ ] **Step 11: 未確認事項 2 を測る（計測のファイルは消す）**

一時的な計測のテスト `src/main/__tests__/agentBaselineHiddenGit.measure.integration.test.ts` を作る:
```ts
import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { takeBaselineSnapshot } from '../agentBaselineSnapshot'
import {
  FAKE_PROTECTION_INSTANCE_ID,
  createAgentNonGitFolder,
  disposeAgentBaselineRepo
} from './helpers/agentBaselineFixtures'

// 未確認事項 2 の計測(コミットしない。測ったら消す)
describe('隠れた git の記録の時間と大きさ(計測)', () => {
  it.each([
    ['5,000 件の小さなファイル', 5_000, 16],
    ['4,900 件・合計 約 98MB', 4_900, 20 * 1024]
  ])('%s', async (_label, count, size) => {
    const dirs = createAgentNonGitFolder('baseline-measure-')
    try {
      for (let d = 0; d < 50; d++) mkdirSync(join(dirs.repo, `d${d}`))
      for (let i = 0; i < count; i++) {
        writeFileSync(join(dirs.repo, `d${i % 50}`, `${i}.bin`), randomBytes(size))
      }
      const started = Date.now()
      const result = await takeBaselineSnapshot(dirs.repo, {
        tempRoot: dirs.tempRoot,
        instanceId: FAKE_PROTECTION_INSTANCE_ID
      })
      const elapsed = Date.now() - started
      expect(result.kind).toBe('recorded')
      const du = execFileSync('du', ['-sk', dirs.tempRoot]).toString().trim()
      console.log(`[measure] ${count} 件・${size} バイト: ${elapsed}ms・一時ディレクトリ ${du}`)
    } finally {
      disposeAgentBaselineRepo(dirs)
    }
  }, 120_000)
})
```
Run: `npx vitest run src/main/__tests__/agentBaselineHiddenGit.measure.integration.test.ts`
出力の `[measure]` の 2 行（時間と大きさ）を報告に書く。どちらかが 10 秒（打ち切り）に近い（8 秒を超える）なら、設計書の「既知の制約」の 1 つ目の箇条（大きなフォルダは…打ち切られる）に実測の値を書き足す（設計書「未確認事項」の最後の文）。
Run: `rm src/main/__tests__/agentBaselineHiddenGit.measure.integration.test.ts && git status --short src/main/__tests__`
Expected: 計測のファイルが出ない（消えている）

- [ ] **Step 12: 全体の検証**

Run: `npm test`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/main/gitRepoDetection.ts src/main/gitRemoteSetupService.ts src/main/agentBaselineSnapshot.ts src/main/agentBaselineRegistry.ts src/shared/types/agentChanges.ts src/renderer/src/lib/agentChangesMessages.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts` → `npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 13: コミット（利用者の指示があるときだけ）**

```bash
git add src/main/gitRepoDetection.ts src/main/gitRemoteSetupService.ts src/main/agentBaselineSnapshot.ts src/main/agentBaselineRegistry.ts src/shared/types/agentChanges.ts src/renderer/src/lib/agentChangesMessages.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts
git commit -m "feat: Git 管理外のフォルダを隠れた git で記録し、ファイルが多すぎるときと .git の中で理由を返す"
```

---

### Task 4: 一覧・diff・戻す・取り消し・実行ごとの Git 管理外での動作（main。未確認事項 3 の残り）

> **設計書の読む節:** 「一覧・diff・戻す・取り消し・実行ごと・区別」の表、「記録中のフォルダの変化」、「確認の結果」4・5・10、「エラー処理」の一覧・diff の行、「セキュリティ」の利用者のフォルダに書く・hook・シンボリックリンクの行、「新しい状態と既存の入口」の `list`・`getDiff`・`revertFile`・`revertHunk`・`revertAll`・`undo` の行、「テスト方針」の `agentChangesQuery`・`agentChangesRevert`・`agentChangesRuns`・`agentChangesUndo` と `agentBaselineHiddenGit.integration.test.ts` の一連の操作、「未確認事項」3。
>
> **気をつける知見:** L-016（リンクを作り直し、指す先を書き換えない）・L-002（`gitDir` が無いときは `記録が見つかりません`）・L-059（実 git で確かめる）・L-186・L-268（大域の `core.hooksPath`・`init.defaultObjectFormat`）・L-061（入口ごとに確かめる）

この Task はテストを足して、Git 管理外のフォルダで既存の部品がそのまま動くことを確かめる。食い違い（テストが落ちる）が見つかったら、その原因を `superpowers:systematic-debugging` の手順で調べて直し、直した点を報告に書く（設計書の「一覧・diff・戻す…」の表と食い違う直し方が要るなら、設計書の表も直す）。

**Files:**
- Test: `src/main/__tests__/agentChangesQuery.integration.test.ts`・`src/main/__tests__/agentChangesRevert.integration.test.ts`・`src/main/__tests__/agentChangesRuns.integration.test.ts`・`src/main/__tests__/agentChangesUndo.integration.test.ts`・`src/main/__tests__/agentBaselineHiddenGit.integration.test.ts`
- Modify（食い違いが見つかったときだけ）: `src/main/agentChangesQuery.ts`・`src/main/agentChangeDiff.ts`・`src/main/agentChangesRevert.ts` などの該当のファイル

**Interfaces:**
- Consumes: Task 1〜3b のすべて（`createAgentNonGitFolder`・`folderEntries`・`folderChangesExcept`・`recordBaseline`・`recordBaselineFrom`・`snapshotBase`・`createFakeTrash`・`listAgentChanges`・`listAgentChangesBetween`・`getAgentChangeDiff`・`getAgentChangeDiffBetween`・`revertAgentChange`・`revertAgentChangeHunk`・`revertAllAgentChanges`・`executeAgentChangesUndo`・`AgentRevertContext`〈`snapshot`・`trash`・`undoCapture`・`attributeEntries`〉）
- Produces: なし（テストの追加と、見つかった食い違いの直し）

- [ ] **Step 1: 一覧・diff のテストを書く**

`src/main/__tests__/agentChangesQuery.integration.test.ts` の最後に足す（import に `createAgentNonGitFolder`・`folderEntries`・`recordBaseline`〈無ければ〉、`node:fs` の `existsSync`・`rmSync`・`unlinkSync`、`node:path` の `join`、`./helpers/realGitRepo` の `commitAll`・`runGit`・`writeRepoFile` のうち無いものを足す）:
```ts
// Git 管理外のフォルダ(隠れた git)。ファイルの先頭の beforeEach もリポジトリを作るが、この節では使わない
describe('Git 管理外のフォルダの一覧と diff(隠れた git)(実 git)', () => {
  let folder: string
  let folderHome: string
  let folderTemp: string
  const put = (p: string, content: string): void => writeRepoFile(folder, p, content)

  beforeEach(() => {
    ;({ repo: folder, home: folderHome, tempRoot: folderTemp } = createAgentNonGitFolder('agent-changes-query-plain-'))
  })

  afterEach(() => disposeAgentBaselineRepo({ repo: folder, home: folderHome, tempRoot: folderTemp }))

  it('一覧は M・D・A・新しいフォルダの 1 行を出し、headChanged は false。一覧・diff の前後でフォルダの中は変わらない(.git を作らない)', async () => {
    put('a.txt', 'one\n')
    put('b.txt', 'b\n')
    const snapshot = await recordBaseline(folder, folderTemp)
    expect(snapshot.gitDir).not.toBeNull()
    put('a.txt', 'one\nagent\n')
    unlinkSync(join(folder, 'b.txt'))
    put('c.txt', 'c\n')
    put('d/x.txt', 'x\n')
    const before = folderEntries(folder)
    const list = await listAgentChanges(snapshot)
    expect(list.entries.map((e) => [e.path, e.status, e.isDirectory])).toEqual([
      ['a.txt', 'M', false],
      ['b.txt', 'D', false],
      ['c.txt', 'A', false],
      ['d/', 'A', true]
    ])
    expect(list.headChanged).toBe(false)
    expect(await getAgentChangeDiff(snapshot, 'a.txt')).toContain('+agent')
    expect(await getAgentChangeDiff(snapshot, 'b.txt')).toContain('-b')
    expect(await getAgentChangeDiff(snapshot, 'c.txt')).toContain('+c')
    expect(await getAgentChangeDiff(snapshot, 'd')).toBe('フォルダが追加されました（1 件のファイル）\n')
    expect(folderEntries(folder)).toEqual(before)
    expect(existsSync(join(folder, '.git'))).toBe(false)
  })

  it('既定の一覧の中(node_modules/)の変更は一覧に出ない', async () => {
    put('a.txt', 'a\n')
    put('node_modules/m.js', 'm\n')
    const snapshot = await recordBaseline(folder, folderTemp)
    put('node_modules/m.js', 'changed\n')
    put('node_modules/new.js', 'n\n')
    expect((await listAgentChanges(snapshot)).entries).toEqual([])
  })

  it('記録中に利用者が git init してコミットしても、一覧は隠れた git で問い合わせ、.git の行も HEAD の帯も出ない', async () => {
    put('a.txt', 'a\n')
    const snapshot = await recordBaseline(folder, folderTemp)
    runGit(folder, 'init', '-q', '-b', 'main')
    runGit(folder, 'config', 'user.email', 'test@example.com')
    runGit(folder, 'config', 'user.name', 'test')
    runGit(folder, 'config', 'commit.gpgsign', 'false')
    commitAll(folder, 'init')
    put('c.txt', 'c\n')
    const list = await listAgentChanges(snapshot)
    expect(list.entries.map((e) => e.path)).toEqual(['c.txt'])
    expect(list.headChanged).toBe(false)
  })

  it('隠れた git(gitDir)を消すと、一覧・diff は「記録が見つかりません」で拒否する(git の fatal をそのまま見せない。L-002)', async () => {
    put('a.txt', 'a\n')
    const snapshot = await recordBaseline(folder, folderTemp)
    put('a.txt', 'a\nb\n')
    rmSync(snapshot.gitDir ?? '', { recursive: true, force: true })
    await expect(listAgentChanges(snapshot)).rejects.toThrow('記録が見つかりません')
    await expect(getAgentChangeDiff(snapshot, 'a.txt')).rejects.toThrow('記録が見つかりません')
  })
})
```

- [ ] **Step 2: 戻すのテストを書く**

`src/main/__tests__/agentChangesRevert.integration.test.ts` の最後に足す（import に `createAgentNonGitFolder`・`folderChangesExcept`・`folderEntries`、`node:fs` の `chmodSync`・`existsSync`・`readFileSync`・`readlinkSync`・`statSync`・`symlinkSync`・`unlinkSync`・`writeFileSync` のうち無いものを足す）:
```ts
// Git 管理外のフォルダ(隠れた git)。ファイルの先頭の beforeEach もリポジトリを作るが、この節では使わない
describe('Git 管理外のフォルダの戻す操作(隠れた git)(実 git)', () => {
  let folder: string
  let folderHome: string
  let folderTemp: string
  let plainTrash: FakeTrash['trash']
  let plainTrashed: string[]
  const put = (p: string, content: string): void => writeRepoFile(folder, p, content)
  const readPlain = (p: string): string => readFileSync(join(folder, p), 'utf8')
  const lines = (n: number, replace: Record<number, string> = {}): string =>
    Array.from({ length: n }, (_, i) => replace[i + 1] ?? `l${i + 1}`).join('\n') + '\n'
  const firstHunk = (diff: string): string => {
    const parts = diff.split(/(?=^@@ )/m)
    return parts[0] + parts[1]
  }
  const recordPlain = async (): Promise<AgentRevertContext> => ({
    snapshot: await recordBaseline(folder, folderTemp),
    trash: plainTrash,
    undoCapture: { tempRoot: folderTemp, maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES },
    attributeEntries: async (entries) => entries
  })

  beforeEach(() => {
    ;({ repo: folder, home: folderHome, tempRoot: folderTemp } = createAgentNonGitFolder('agent-changes-revert-plain-'))
    ;({ trash: plainTrash, trashed: plainTrashed } = createFakeTrash())
  })

  afterEach(() => disposeAgentBaselineRepo({ repo: folder, home: folderHome, tempRoot: folderTemp }))

  it('行の ↶: 変更は記録の時点の内容へ、削除は作り直し、追加はゴミ箱へ。変えたもの以外のフォルダの中は変わらない(.git を作らない)', async () => {
    put('a.txt', 'one\n')
    put('b.txt', 'b\n')
    put('keep.txt', 'k\n')
    const context = await recordPlain()
    put('a.txt', 'one\nagent\n')
    unlinkSync(join(folder, 'b.txt'))
    put('c.txt', 'c\n')
    const before = folderEntries(folder)
    await revertAgentChange(context, 'a.txt')
    await revertAgentChange(context, 'b.txt')
    await revertAgentChange(context, 'c.txt')
    expect(readPlain('a.txt')).toBe('one\n')
    expect(readPlain('b.txt')).toBe('b\n')
    expect(plainTrashed).toEqual([join(folder, 'c.txt')])
    expect(folderChangesExcept(before, folderEntries(folder), ['a.txt', 'b.txt', 'c.txt'])).toEqual([])
    expect(existsSync(join(folder, '.git'))).toBe(false)
    expect((await listAgentChanges(context.snapshot)).entries).toEqual([])
  })

  it('シンボリックリンクは元の指す先(フォルダの外を含む)のリンクとして作り直し、指す先を書き換えない(L-016)', async () => {
    put('a.txt', 'a\n')
    const outside = join(folderHome, 'outside.txt')
    writeFileSync(outside, 'outside\n')
    symlinkSync('a.txt', join(folder, 'link.txt'))
    symlinkSync(outside, join(folder, 'out.txt'))
    const context = await recordPlain()
    unlinkSync(join(folder, 'link.txt'))
    unlinkSync(join(folder, 'out.txt'))
    symlinkSync('a.txt', join(folder, 'out.txt'))
    await revertAgentChange(context, 'link.txt')
    await revertAgentChange(context, 'out.txt')
    expect(readlinkSync(join(folder, 'link.txt'))).toBe('a.txt')
    expect(readlinkSync(join(folder, 'out.txt'))).toBe(outside)
    expect(readFileSync(outside, 'utf8')).toBe('outside\n')
  })

  it('実行ビットの変更を戻す', async () => {
    put('run.sh', '#!/bin/sh\necho run\n')
    chmodSync(join(folder, 'run.sh'), 0o755)
    const context = await recordPlain()
    put('run.sh', '#!/bin/sh\necho changed\n')
    chmodSync(join(folder, 'run.sh'), 0o644)
    await revertAgentChange(context, 'run.sh')
    expect(readPlain('run.sh')).toBe('#!/bin/sh\necho run\n')
    expect(statSync(join(folder, 'run.sh')).mode & 0o111).not.toBe(0)
  })

  it('ハンクを戻す(パッチはフォルダからの相対で解釈する。確認の結果 10)', async () => {
    put('d.txt', lines(20))
    const context = await recordPlain()
    put('d.txt', lines(20, { 2: 'A2', 18: 'A18' }))
    const before = folderEntries(folder)
    const diff = await getAgentChangeDiff(context.snapshot, 'd.txt')
    await revertAgentChangeHunk(context, 'd.txt', firstHunk(diff))
    expect(readPlain('d.txt')).toBe(lines(20, { 18: 'A18' }))
    expect(folderChangesExcept(before, folderEntries(folder), ['d.txt'])).toEqual([])
    expect(existsSync(join(folder, '.git'))).toBe(false)
  })

  it('すべて戻す(変更・削除・追加・新しいフォルダ)', async () => {
    put('a.txt', 'one\n')
    put('b.txt', 'b\n')
    const context = await recordPlain()
    put('a.txt', 'one\nagent\n')
    unlinkSync(join(folder, 'b.txt'))
    put('c.txt', 'c\n')
    put('d/x.txt', 'x\n')
    const result = await revertAllAgentChanges(context, [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'D' },
      { path: 'c.txt', status: 'A' },
      { path: 'd/', status: 'A' }
    ])
    expect(result).toMatchObject({ status: 'done', applied: 4 })
    expect(readPlain('a.txt')).toBe('one\n')
    expect(readPlain('b.txt')).toBe('b\n')
    expect(plainTrashed.sort()).toEqual([join(folder, 'c.txt'), join(folder, 'd')])
    expect(existsSync(join(folder, '.git'))).toBe(false)
  })
})
```
（`DiscardAllResult` の形は `revertAllAgentChanges` の戻り値の型に合わせる。`status: 'done'` で `applied` を持つ）

- [ ] **Step 3: 実行ごとのテストを書く**

`src/main/__tests__/agentChangesRuns.integration.test.ts` の最後に足す（import に `createAgentNonGitFolder`、`node:fs` の `existsSync`・`readdirSync`・`rmSync` のうち無いものを足す）:
```ts
describe('Git 管理外のフォルダの実行ごとの一覧と diff(隠れた git)(実 git)', () => {
  let folder: string
  let folderHome: string
  let folderTemp: string
  const put = (p: string, content: string): void => writeRepoFile(folder, p, content)

  beforeEach(() => {
    ;({ repo: folder, home: folderHome, tempRoot: folderTemp } = createAgentNonGitFolder('agent-changes-runs-plain-'))
  })

  afterEach(() => disposeAgentBaselineRepo({ repo: folder, home: folderHome, tempRoot: folderTemp }))

  it('区切りは同じ隠れた git を共有し、途中の実行は tree どうし、最後の実行は作業ツリーと比べる', async () => {
    put('a.txt', 'a\n')
    put('b.txt', 'b\n')
    const base = await recordBaseline(folder, folderTemp)
    put('a.txt', 'a\nrun1\n')
    const second = await recordBaselineFrom(folder, folderTemp, base)
    expect(second.gitDir).toBe(base.gitDir)
    expect(readdirSync(second.tempDir)).not.toContain('git')
    put('b.txt', 'b\nrun2\n')
    expect((await listAgentChangesBetween(base, second)).entries.map((e) => [e.path, e.status])).toEqual([
      ['a.txt', 'M']
    ])
    expect((await listAgentChangesBetween(base, second)).headChanged).toBe(false)
    expect((await listAgentChanges(second)).entries.map((e) => [e.path, e.status])).toEqual([['b.txt', 'M']])
    expect(changedLines(await getAgentChangeDiffBetween(base, second, 'a.txt'))).toEqual(['+run1'])
    expect(existsSync(join(folder, '.git'))).toBe(false)
  })

  it('隠れた git(gitDir)を消すと、途中の実行の一覧・diff は「記録が見つかりません」で拒否する(L-002)', async () => {
    put('a.txt', 'a\n')
    const base = await recordBaseline(folder, folderTemp)
    put('a.txt', 'a\nrun1\n')
    const second = await recordBaselineFrom(folder, folderTemp, base)
    rmSync(base.gitDir ?? '', { recursive: true, force: true })
    await expect(listAgentChangesBetween(base, second)).rejects.toThrow('記録が見つかりません')
    await expect(getAgentChangeDiffBetween(base, second, 'a.txt')).rejects.toThrow('記録が見つかりません')
  })
})
```

- [ ] **Step 4: 取り消しのテストを書く**

`src/main/__tests__/agentChangesUndo.integration.test.ts` の最後に足す（import に `createAgentNonGitFolder`、`node:fs` の `existsSync`・`readFileSync`・`unlinkSync` のうち無いものを足す）:
```ts
describe('Git 管理外のフォルダの戻す → 取り消す(隠れた git)(実 git)', () => {
  let folder: string
  let folderHome: string
  let folderTemp: string
  let plainTrash: FakeTrash['trash']
  const put = (p: string, content: string): void => writeRepoFile(folder, p, content)
  const recordPlain = async (): Promise<AgentRevertContext> => ({
    snapshot: await recordBaseline(folder, folderTemp),
    trash: plainTrash,
    undoCapture: { tempRoot: folderTemp, maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES },
    attributeEntries: async (entries) => entries
  })
  const undoPlain = async (
    outcome: AgentRevertOutcome,
    operation: AgentChangesUndoOperation
  ): Promise<AgentChangesUndoExecution> => {
    if (outcome.capture.kind !== 'saved') throw new Error('控えが取れなかった')
    return executeAgentChangesUndo({
      folderPath: folder,
      undo: { undoId: 1, operation, dir: outcome.capture.dir, items: outcome.capture.items },
      trash: plainTrash
    })
  }

  beforeEach(() => {
    ;({ repo: folder, home: folderHome, tempRoot: folderTemp } = createAgentNonGitFolder('agent-changes-undo-plain-'))
    ;({ trash: plainTrash } = createFakeTrash())
  })

  afterEach(() => disposeAgentBaselineRepo({ repo: folder, home: folderHome, tempRoot: folderTemp }))

  it('戻した変更・削除を取り消すと、戻す前(エージェントの変更の後)の内容に戻る。.git を作らない', async () => {
    put('a.txt', 'one\n')
    put('b.txt', 'b\n')
    const context = await recordPlain()
    put('a.txt', 'one\nagent\n')
    unlinkSync(join(folder, 'b.txt'))
    const all = await revertAllAgentChanges(context, [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'D' }
    ])
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('one\n')
    expect(await undoPlain(all, 'all')).toMatchObject({ kind: 'done' })
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('one\nagent\n')
    expect(existsSync(join(folder, 'b.txt'))).toBe(false)
    expect(existsSync(join(folder, '.git'))).toBe(false)
  })
})
```
（`executeAgentChangesUndo` の結果の `kind` の値は `AgentChangesUndoExecution` の型に合わせる。既存の `describe('戻す → 取り消す(実 git)', ...)` の期待値の書き方に合わせて直してよい）

- [ ] **Step 5: hook と sha256・reftable の一連の操作のテストを書く**

`src/main/__tests__/agentBaselineHiddenGit.integration.test.ts`:
1. import に次を足す: `import { takeBaselineSnapshot } from '../agentBaselineSnapshot'`（`parseWriteTreeOutput` の import と 1 つにする）・`import type { BaselineSnapshot } from '../agentBaselineSnapshot'`・`import { getAgentChangeDiff } from '../agentChangeDiff'`・`import { listAgentChanges, listAgentChangesBetween } from '../agentChangesQuery'`・`import { revertAgentChange, revertAgentChangeHunk, revertAllAgentChanges } from '../agentChangesRevert'`・`import type { AgentRevertContext } from '../agentChangesRevert'`・`import { AGENT_CHANGES_UNDO_MAX_BYTES } from '../agentChangesUndo'`・`import { FAKE_PROTECTION_INSTANCE_ID, createFakeTrash, snapshotBase } from './helpers/agentBaselineFixtures'`
2. `describe('createHiddenGit(実 git)', ...)` の中の、`利用者の大域の core.hooksPath の hook(セキュリティ)` の describe の最後に足す:
```ts
    it('記録(始点・区切り)・一覧・diff・戻す(ファイル・ハンク・すべて戻す)の一連の操作の後に hook が動かない', async () => {
      const take = async (base?: BaselineSnapshot): Promise<BaselineSnapshot> => {
        const result = await takeBaselineSnapshot(folder, {
          tempRoot: tempDir,
          instanceId: FAKE_PROTECTION_INSTANCE_ID,
          base: base === undefined ? undefined : snapshotBase(base)
        })
        if (result.kind !== 'recorded') throw new Error(JSON.stringify(result))
        return result.snapshot
      }
      const numbered = (n: number, replace: Record<number, string> = {}): string =>
        Array.from({ length: n }, (_, i) => replace[i + 1] ?? `l${i + 1}`).join('\n') + '\n'
      writeRepoFile(folder, 'd.txt', numbered(20))
      writeRepoFile(folder, 'b.txt', 'b\n')
      const baseline = await take()
      writeRepoFile(folder, 'a.txt', 'one\ntwo\nagent\n')
      const checkpoint = await take(baseline)
      writeRepoFile(folder, 'd.txt', numbered(20, { 2: 'A2', 18: 'A18' }))
      writeRepoFile(folder, 'b.txt', 'b\nagent\n')
      writeRepoFile(folder, 'c.txt', 'c\n')
      await listAgentChanges(baseline)
      await listAgentChangesBetween(baseline, checkpoint)
      const context: AgentRevertContext = {
        snapshot: baseline,
        trash: createFakeTrash().trash,
        undoCapture: { tempRoot: tempDir, maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES },
        attributeEntries: async (entries) => entries
      }
      const diff = await getAgentChangeDiff(baseline, 'd.txt')
      const parts = diff.split(/(?=^@@ )/m)
      await revertAgentChangeHunk(context, 'd.txt', parts[0] + parts[1])
      await revertAgentChange(context, 'a.txt')
      await revertAllAgentChanges(context, [
        { path: 'b.txt', status: 'M' },
        { path: 'c.txt', status: 'A' },
        { path: 'd.txt', status: 'M' }
      ])
      expect(existsSync(marker)).toBe(false)
    })
```
3. `describe('createHiddenGit(実 git)', ...)` の最後に足す:
```ts
  it('大域の init.defaultObjectFormat=sha256・init.defaultRefFormat=reftable を引き継いでも、記録・一覧・tree どうしの比較・戻すが動く(未確認事項 3)', async () => {
    // テストの隔離の GIT_DEFAULT_REF_FORMAT=files は設定より優先されるため、この試験だけ外す
    vi.stubEnv('GIT_DEFAULT_REF_FORMAT', undefined)
    writeGlobalConfig('[init]\n\tdefaultObjectFormat = sha256\n\tdefaultRefFormat = reftable\n')
    const take = async (base?: BaselineSnapshot): Promise<BaselineSnapshot> => {
      const result = await takeBaselineSnapshot(folder, {
        tempRoot: tempDir,
        instanceId: FAKE_PROTECTION_INSTANCE_ID,
        base: base === undefined ? undefined : snapshotBase(base)
      })
      if (result.kind !== 'recorded') throw new Error(JSON.stringify(result))
      return result.snapshot
    }
    const baseline = await take()
    expect(baseline.tree).toMatch(/^[0-9a-f]{64}$/)
    writeRepoFile(folder, 'a.txt', 'one\ntwo\nrun1\n')
    const checkpoint = await take(baseline)
    expect((await listAgentChangesBetween(baseline, checkpoint)).entries.map((e) => e.path)).toEqual([
      'a.txt'
    ])
    expect((await listAgentChanges(baseline)).entries.map((e) => e.path)).toEqual(['a.txt'])
    await revertAgentChange(
      {
        snapshot: baseline,
        trash: createFakeTrash().trash,
        undoCapture: { tempRoot: tempDir, maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES },
        attributeEntries: async (entries) => entries
      },
      'a.txt'
    )
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })
```

- [ ] **Step 6: テストを流し、食い違いを直す**

Run: `npx vitest run src/main/__tests__/agentChangesQuery.integration.test.ts src/main/__tests__/agentChangesRevert.integration.test.ts src/main/__tests__/agentChangesRuns.integration.test.ts src/main/__tests__/agentChangesUndo.integration.test.ts src/main/__tests__/agentBaselineHiddenGit.integration.test.ts`
Expected: PASS（Task 1〜3b で問い合わせ先を切り替えてあるため、追加のコードなしで通る見込み）
- 落ちたテストがあれば、テストの期待値が設計書（「一覧・diff・戻す…」の表・「確認の結果」4・5・10）と合っているかを先に確かめ、合っていれば実装の側の原因を調べて直す（例: どこかで `createRepoGit(folderPath)` を使って利用者の index・HEAD に問い合わせている、`git apply` が利用者の環境の位置の変数を引き継ぐ、など）。直したら、その直しを外すと落ちることを確かめる
- 未確認事項 3 のテストが落ち、原因が sha256・reftable そのものなら、設計書の「既知の制約」に「`init.defaultObjectFormat=sha256` などを大域に設定していると記録できない」旨を書き、テストを `it.skip` にせず、記録できないときの理由（`git-failed`）を固定するテストに書き換える（設計書「未確認事項」の最後の文）

- [ ] **Step 7: 変異で確かめる**

1. `agentChangesRevert.ts` の `gitsFor` の `repo: createRecordRepoGit(…)` を `repo: createRepoGit(context.snapshot.folderPath, context.gitOptions)` にする（import も直す）→ `Git 管理外のフォルダの戻す操作…` の `行の ↶…` が落ちる（Git 管理外では blob の有無の `cat-file` が失敗して戻せない）。戻す
2. `hiddenGitConfig` の `['core.hooksPath', …]` の行を消す → `記録(始点・区切り)・一覧・diff・戻す…の一連の操作の後に hook が動かない` が落ちる。戻す
3. `agentChangesQuery.ts` の `collectAgentChangeEntriesBetween` の `await assertBaselineGitDir(start)` を消す → `隠れた git(gitDir)を消すと、途中の実行の一覧・diff は…` が落ちる（git の fatal の文言になる）。戻す
4. `git diff` で戻したことを確かめる

- [ ] **Step 8: 全体の検証**

Run: `npm test`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/main/__tests__/agentChangesQuery.integration.test.ts src/main/__tests__/agentChangesRevert.integration.test.ts src/main/__tests__/agentChangesRuns.integration.test.ts src/main/__tests__/agentChangesUndo.integration.test.ts src/main/__tests__/agentBaselineHiddenGit.integration.test.ts <Step 6 で直した実装のファイル>` → `npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 9: コミット（利用者の指示があるときだけ）**

```bash
git add src/main/__tests__/agentChangesQuery.integration.test.ts src/main/__tests__/agentChangesRevert.integration.test.ts src/main/__tests__/agentChangesRuns.integration.test.ts src/main/__tests__/agentChangesUndo.integration.test.ts src/main/__tests__/agentBaselineHiddenGit.integration.test.ts <Step 6 で直した実装のファイル>
git commit -m "test: Git 管理外のフォルダで一覧・diff・戻す・取り消し・実行ごとが隠れた git で動き、フォルダに書かないことを固定する"
```

---

### Task 5: 記録の置き場の IPC と画面（shared・main・renderer）

> **設計書の読む節:** 「決めたこと（利用者の確認済み）」の「見せ方」、「決めたこと（推奨案で決めた事項）」の「記録の置き場の IPC」、「IPC と型」、「renderer」の全体、「記録中のフォルダの変化」の `git init` の行、「新しい状態と既存の入口」の `getState`・パネルの `リポジトリを初期化` の行、「テスト方針」の renderer・`agentChangesRecord.test.ts`・`agentBaselineRegistry.test.ts` の `storage`・配線の変異の `storage`。
>
> **気をつける知見:** L-060（`storage` を必須にし、`summarizeAgentChangesRecord` の 1 か所で決める。固定値にすると落ちるテスト）・L-423（写しの構造の比較に `storage` が入る）・L-057（記録の置き場を見える文字で伝える）

**Files:**
- Modify: `src/shared/types/agentChanges.ts`（`AgentChangesStorage`・`recording.storage`・一覧の結果の `storage`）
- Modify: `src/main/agentChangesRecord.ts`（`summarizeAgentChangesRecord` の `storage`）
- Modify: `src/renderer/src/types.ts`（写し `AgentChangesView` の `recording.storage`）
- Modify: `src/renderer/src/lib/agentChangesView.ts`（`planRecordingState`・`planListResult`）
- Modify: `src/renderer/src/lib/agentChangesMessages.ts`（NOTE・HINT・`not-repository` の全文）
- Modify: `src/renderer/src/lib/agentChangesSectionText.ts`（`describeAgentChangesStorage`〈新規〉）
- Modify: `src/renderer/src/components/source-control/AgentChangesSection.tsx`・`src/renderer/src/components/source-control/NotRepositoryView.tsx`
- Modify: `src/renderer/src/__tests__/makeAgentChangesState.ts`・`src/main/__tests__/helpers/agentBaselineFixtures.ts`
- Test: `src/main/__tests__/agentChangesRecord.test.ts`・`src/main/__tests__/agentBaselineRegistry.test.ts`・`src/main/__tests__/agentChangesScopedQuery.test.ts`・`src/renderer/src/lib/__tests__/agentChangesMessages.test.ts`・`src/renderer/src/lib/__tests__/agentChangesSectionText.test.ts`・`src/renderer/src/lib/__tests__/agentChangesView.test.ts`・`src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`・`src/renderer/src/components/__tests__/App.agentChanges.test.tsx`（古い文言を待つ「Git 管理外のフォルダでは、セクションに理由を出す」の書き直し）
- Modify（型と `toEqual` の追随）: `src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts`・`src/renderer/src/lib/__tests__/agentChangesApi.test.ts`・`src/main/__tests__/handlers/agentChangesHandlers.test.ts`・`src/main/__tests__/helpers/agentBaselineFixtures.test.ts` ほか、型検査・テストで落ちたもの

**Interfaces:**
- Consumes: Task 1 の `BaselineSnapshot.gitDir`、既存の `summarizeAgentChangesRecord(record, { unassignedNow })`・`planRecordingState(previous, state, selected)`・`planListResult(result, previous)`・`isSameAgentChangesView(a, b)`・`AgentChangesSectionProps`
- Produces:
```ts
// src/shared/types/agentChanges.ts
/** 記録の置き場。repository: 利用者のリポジトリ(.git の object の DB)、app: アプリの一時領域の隠れた git(Git 管理外のフォルダ) */
export type AgentChangesStorage = 'repository' | 'app'
// AgentChangesState の recording・AgentChangesListResult の recording・scope-unavailable に storage: AgentChangesStorage(必須)

// src/renderer/src/types.ts(AgentChangesView の recording に足す)
storage: AgentChangesStorage

// src/renderer/src/lib/agentChangesMessages.ts
export const AGENT_CHANGES_APP_STORAGE_NOTE: string
export const AGENT_CHANGES_APP_STORAGE_HINT: string

// src/renderer/src/lib/agentChangesSectionText.ts
export function describeAgentChangesStorage(view: AgentChangesView, isNotRepository: boolean): string | null
```

- [ ] **Step 1: 失敗するテストを書く（main の要約）**

`src/main/__tests__/agentChangesRecord.test.ts`:
1. `describe('summarizeAgentChangesRecord', ...)` の 1 つ目のテストの期待値の `attribution: { kind: 'tracking', since: 100, hadUnassignedSince: true }` の後に `,\n      storage: 'repository'` を足す
2. 同じ describe の最後に足す:
```ts
  it('記録の置き場(storage)は、隠れた git の記録なら app、リポジトリの方式なら repository', () => {
    const hiddenBaseline = makeBaselineSnapshot({ tempDir: '/tmp/base', gitDir: '/tmp/base/git' })
    expect(
      summarizeAgentChangesRecord(makeAgentChangesRecord([], { baseline: hiddenBaseline })).storage
    ).toBe('app')
    expect(summarizeAgentChangesRecord(recordOf([])).storage).toBe('repository')
  })
```

`src/main/__tests__/agentBaselineRegistry.test.ts` の `describe('AgentBaselineRegistry の隠れた git の記録', ...)` の最後に足す:
```ts
  it('記録中の状態(begin・getState)の storage は app', async () => {
    const s = setup()
    const begun = s.registry.begin(1, '/repo', 'manual')
    s.release(hidden('/tmp/base'))
    await expect(begun).resolves.toMatchObject({ kind: 'recording', storage: 'app' })
    expect(s.registry.getState(1, '/repo')).toMatchObject({ kind: 'recording', storage: 'app' })
  })
```

`src/main/__tests__/agentChangesScopedQuery.test.ts` の `describe('listAgentChangesInScope', ...)` の最後に足す（`makeAgentChangesRecord`・`makeBaselineSnapshot` は既存の import を使う。無ければ足す）:
```ts
  it('結果の storage は記録の置き場(範囲の一覧を出せないときも同じ要約から入れる)', async () => {
    const hidden = makeAgentChangesRecord([], {
      baseline: makeBaselineSnapshot({ tempDir: '/tmp/h', gitDir: '/tmp/h/git' })
    })
    await expect(
      listAgentChangesInScope(hidden, { kind: 'run', runId: 99 }, keepEntries)
    ).resolves.toMatchObject({ kind: 'scope-unavailable', storage: 'app' })
  })
```

- [ ] **Step 2: 失敗するテストを書く（renderer の文言・純粋な関数・写し）**

`src/renderer/src/lib/__tests__/agentChangesMessages.test.ts`:
1. import に `AGENT_CHANGES_APP_STORAGE_HINT`・`AGENT_CHANGES_APP_STORAGE_NOTE` を足す
2. `describe('記録できない理由', ...)` の最後に足す:
```ts
  it('not-repository はリポジトリの方式の記録の途中で Git 管理外になったときの文言(区切りでだけ返る)', () => {
    expect(describeAgentChangesUnavailable({ kind: 'unavailable', reason: 'not-repository' })).toBe(
      'Git 管理外のフォルダになったため、記録できません'
    )
  })

  it('記録の置き場の注記の文言', () => {
    expect(AGENT_CHANGES_APP_STORAGE_NOTE).toBe(
      'Git 管理外のフォルダのため、アプリの一時領域に記録しています（node_modules などは記録しません）'
    )
    expect(AGENT_CHANGES_APP_STORAGE_HINT).toBe(
      'Git 管理外のフォルダのため、記録はアプリの一時領域に置きます（node_modules などは記録しません）'
    )
  })
```

`src/renderer/src/__tests__/makeAgentChangesState.ts`（テストの補助。テストより先に直す）:
1. `@shared/types` の型の import に `AgentChangesStorage` を足す
2. `makeAgentChangesRecordingState`・`makeAgentChangesRecordingView`・`makeAgentChangesScopeUnavailableView`・`makeAgentChangesScopeUnavailableListResult` の `overrides` の型に `storage?: AgentChangesStorage` を足し、分割に `storage = 'repository'` を足して、戻り値の `attribution` の次に `storage` を足す。`makeAgentChangesListResult` は `overrides` の型が `Partial<Omit<…recording…>>` なので型はそのまま、分割に `storage = 'repository',` を足して戻り値の `attribution,` の次に `storage,` を足す
3. 各関数のコメントの `区別の要約は区別していない tracking` の後に `、記録の置き場は repository` を足す

`src/renderer/src/lib/__tests__/agentChangesSectionText.test.ts`:
1. import に `AGENT_CHANGES_APP_STORAGE_HINT`・`AGENT_CHANGES_APP_STORAGE_NOTE`（`../agentChangesMessages`）と `describeAgentChangesStorage`（`../agentChangesSectionText`）を足す
2. `describe('agentChangesReasonTargets', ...)` の前に足す:
```ts
describe('describeAgentChangesStorage(記録の置き場の注記)', () => {
  it.each([true, false])(
    '記録中で記録が隠れた git(storage: app)なら、パネルが Git 管理外(%s)かに関わらず NOTE',
    (isNotRepository) => {
      expect(
        describeAgentChangesStorage(
          makeAgentChangesRecordingView([], { storage: 'app' }),
          isNotRepository
        )
      ).toBe(AGENT_CHANGES_APP_STORAGE_NOTE)
    }
  )

  it('記録中でリポジトリの方式なら出さない', () => {
    expect(
      describeAgentChangesStorage(makeAgentChangesRecordingView([], { storage: 'repository' }), true)
    ).toBeNull()
  })

  it('記録が無く Git 管理外のフォルダなら HINT、リポジトリなら出さない', () => {
    expect(describeAgentChangesStorage({ kind: 'none' }, true)).toBe(AGENT_CHANGES_APP_STORAGE_HINT)
    expect(describeAgentChangesStorage({ kind: 'none' }, false)).toBeNull()
  })

  it('記録できない理由が出ている間は出さない(理由の文と重ねない)', () => {
    expect(
      describeAgentChangesStorage(
        { kind: 'unavailable', state: { kind: 'unavailable', reason: 'too-many-files' } },
        true
      )
    ).toBeNull()
  })
})
```

`src/renderer/src/lib/__tests__/agentChangesView.test.ts`:
1. `describe('planRecordingState', ...)` の最後に足す:
```ts
  it('記録の置き場(storage)を状態から写す', () => {
    const plan = planRecordingState(
      makeAgentChangesRecordingView(null, { startedAt: 5 }),
      makeAgentChangesRecordingState({ startedAt: 5, storage: 'app' }),
      { kind: 'all' }
    )
    expect(plan.view.storage).toBe('app')
  })
```
2. `describe('planListResult', ...)` の最後に足す:
```ts
  it('一覧の結果・範囲の一覧を出せない結果・実行が消えていた結果のどれも、記録の置き場(storage)を写す', () => {
    const previous = makeAgentChangesRecordingView(null)
    const listed = planListResult(makeAgentChangesListResult([], { storage: 'app' }), previous)
    const unavailable = planListResult(
      makeAgentChangesScopeUnavailableListResult({ kind: 'run', runId: 1 }, 'end-not-recorded', {
        storage: 'app'
      }),
      previous
    )
    const missing = planListResult(
      makeAgentChangesScopeUnavailableListResult({ kind: 'run', runId: 1 }, 'run-missing', {
        storage: 'app'
      }),
      previous
    )
    for (const plan of [listed, unavailable, missing]) {
      expect(plan.kind !== 'none' && plan.view.storage).toBe('app')
    }
  })
```
3. `describe('isSameAgentChangesView', ...)` の最後に足す:
```ts
  it('記録の置き場(storage)だけが違えば同じとしない(L-423)', () => {
    expect(
      isSameAgentChangesView(
        makeAgentChangesRecordingView([], { storage: 'repository' }),
        makeAgentChangesRecordingView([], { storage: 'app' })
      )
    ).toBe(false)
  })
```
   （import に `makeAgentChangesListResult`・`makeAgentChangesScopeUnavailableListResult`・`makeAgentChangesRecordingState` が無ければ足す）

- [ ] **Step 3: 失敗するテストを書く（セクション）**

`src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`:
1. import の `../../../lib/agentChangesMessages` に `AGENT_CHANGES_APP_STORAGE_HINT`・`AGENT_CHANGES_APP_STORAGE_NOTE` を足す
2. `it('Git 管理外のフォルダは理由を出し、記録のボタンを出さない', ...)`・`it('管理外で記録できなかった後にリポジトリを初期化したら、記録なしと同じ表示に戻す', ...)`・`it('管理外で記録できなかった間は、管理外の理由を出したままにする', ...)` の 3 つを消し、その位置に足す:
```ts
  it('Git 管理外のフォルダの記録の前は、リポジトリと同じ案内と「いまから記録する」に、アプリの一時領域に記録する旨(HINT)を本文の先頭に添える', async () => {
    const props = renderSection({ kind: 'none' }, { isNotRepository: true })
    expect(within(section()).getByText(AGENT_CHANGES_NONE_HINT)).toBeInTheDocument()
    const body = section().querySelector('.agent-changes__body')
    expect(body?.firstElementChild?.textContent).toBe(AGENT_CHANGES_APP_STORAGE_HINT)
    expect(screen.queryByText('Git 管理外のフォルダでは、エージェントの変更を記録できません')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'いまから記録する' }))
    expect(props.changes.begin).toHaveBeenCalledOnce()
  })

  it('リポジトリの記録の前は HINT を出さない', () => {
    renderSection({ kind: 'none' }, { isNotRepository: false })
    expect(screen.queryByText(AGENT_CHANGES_APP_STORAGE_HINT)).toBeNull()
  })

  it.each([true, false])(
    '記録中で記録が隠れた git(storage: app)なら、パネルが Git 管理外(%s)かに関わらず NOTE を本文の先頭に出す(git init の後も出し続ける)',
    (isNotRepository) => {
      renderSection(makeAgentChangesRecordingView([], { startedAt, storage: 'app' }), {
        isNotRepository
      })
      const body = section().querySelector('.agent-changes__body')
      expect(body?.firstElementChild?.textContent).toBe(AGENT_CHANGES_APP_STORAGE_NOTE)
      // 注記は読み上げの要素にしない
      expect(screen.getByText(AGENT_CHANGES_APP_STORAGE_NOTE)).not.toHaveAttribute('aria-live')
    }
  )

  it('記録中でリポジトリの方式(storage: repository)なら NOTE を出さない', () => {
    renderSection(recordingView([]))
    expect(screen.queryByText(AGENT_CHANGES_APP_STORAGE_NOTE)).toBeNull()
  })

  it('区切りでだけ返る not-repository は理由の文を出し、「もう一度試す」も HINT も出さない', () => {
    renderSection(
      { kind: 'unavailable', state: { kind: 'unavailable', reason: 'not-repository' } },
      { isNotRepository: true }
    )
    expect(screen.getByText('Git 管理外のフォルダになったため、記録できません')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'もう一度試す' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'いまから記録する' })).toBeNull()
    expect(screen.queryByText(AGENT_CHANGES_APP_STORAGE_HINT)).toBeNull()
  })

  it('ファイルが多すぎる(too-many-files)は理由と件数を出し、「もう一度試す」を出さない', () => {
    renderSection(
      {
        kind: 'unavailable',
        state: { kind: 'unavailable', reason: 'too-many-files', untrackedCount: 5005, untrackedBytes: 0 }
      },
      { isNotRepository: true }
    )
    expect(
      screen.getByText(
        'ファイルが多すぎるため、記録できません。リポジトリを初期化するか、.gitignore で記録しないファイルを指定してください（5,005 件）'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'もう一度試す' })).toBeNull()
  })
```
3. ファイルの中の `recordingView` の補助の `extra` の型に `storage?: AgentChangesStorage` を足さなくてよい（上のテストは `makeAgentChangesRecordingView` を直接使う）

`src/renderer/src/components/__tests__/App.agentChanges.test.tsx`（256〜264 行目付近。古い文言を待つため Task 5 で必ず落ちる）:
1. `it('Git 管理外のフォルダでは、セクションに理由を出す', ...)` を次に置き換える:
```tsx
  it('Git 管理外のフォルダでは、セクションにアプリの一時領域に記録する旨(HINT)と「いまから記録する」を出し、古い理由の文言は出さない', async () => {
    window.api.getGitStatus = vi.fn().mockResolvedValue({ ...repoStatus, isRepo: false })
    await openRepository()
    await userEvent.click(panelButton('source-control'))
    expect(await within(section()).findByText(AGENT_CHANGES_APP_STORAGE_HINT)).toBeInTheDocument()
    expect(within(section()).getByRole('button', { name: 'いまから記録する' })).toBeInTheDocument()
    expect(
      within(section()).queryByText('Git 管理外のフォルダでは、エージェントの変更を記録できません')
    ).toBeNull()
  })
```
2. import に `import { AGENT_CHANGES_APP_STORAGE_HINT } from '../../lib/agentChangesMessages'` を足す（既に `../../lib/agentChangesMessages` から import していれば、その並びに足す）

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/agentChangesScopedQuery.test.ts src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/lib/__tests__/agentChangesSectionText.test.ts src/renderer/src/lib/__tests__/agentChangesView.test.ts src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx src/renderer/src/components/__tests__/App.agentChanges.test.tsx`
Expected: FAIL（`storage` が無い、NOTE・HINT・`describeAgentChangesStorage` が無い、Git 管理外の分岐が残っている）

- [ ] **Step 5: IPC の型と main の要約を実装する**

`src/shared/types/agentChanges.ts`:
1. `AgentChangesState` の前に足す:
```ts
/** 記録の置き場。repository: 利用者のリポジトリ(.git の object の DB)、app: アプリの一時領域の隠れた git(Git 管理外のフォルダ) */
export type AgentChangesStorage = 'repository' | 'app'
```
2. `AgentChangesState` の `recording` の `attribution: AgentChangesAttributionSummary` の次に `storage: AgentChangesStorage` を足し、その上のコメントの `attribution は記録の区別の要約` を `attribution は記録の区別の要約、storage は記録の置き場(記録中に git init してもその記録の間は変わらない)` にする
3. `AgentChangesListResult` の `recording` と `scope-unavailable` の `attribution: AgentChangesAttributionSummary` の次に `storage: AgentChangesStorage` を足し、型のコメントの `記録の区別の要約と、` を `記録の区別の要約・記録の置き場と、` にする

`src/main/agentChangesRecord.ts` の `summarizeAgentChangesRecord`:
1. 戻り値の `attribution: summarizeAttribution(record.attribution, options)` の次に足す:
```ts
    // 記録の置き場はこの 1 か所で決める(記録中の状態と範囲ごとの一覧の結果が共有する。パネルの isRepo では決めない)
    storage: record.baseline.gitDir === null ? 'repository' : 'app'
```
2. 関数のコメントの `記録の要約(開始の時刻・実行の一覧・取り消しの控えの要約・区別の要約)` を `記録の要約(開始の時刻・実行の一覧・取り消しの控えの要約・区別の要約・記録の置き場)` にする

`src/main/__tests__/helpers/agentBaselineFixtures.ts` の `attributionOffRecordingState` の戻り値に `storage: 'repository'` を足す（`return { kind: 'recording', startedAt, runs, undo, attribution: attributionOffSummary(startedAt), storage: 'repository' }`）。コメントの `実行の既定はなし、取り消しの控えの既定はなし` の後に `、記録の置き場はリポジトリ` を足す。

- [ ] **Step 6: renderer の写し・文言・注記を実装する**

`src/renderer/src/types.ts`:
1. `@shared/types` の型の import に `AgentChangesStorage` を足す
2. `AgentChangesView` の `recording` の `attribution: AgentChangesAttributionSummary` の次に `storage: AgentChangesStorage` を足し、コメントの `attribution は main の記録の区別の要約` を `attribution は main の記録の区別の要約、storage は main の記録の置き場` にする

`src/renderer/src/lib/agentChangesView.ts`:
1. `planRecordingState` の `view` の `attribution: state.attribution` の次に `,\n      storage: state.storage` を足す
2. `planListResult` の `scope-unavailable` の `base` の `attribution: result.attribution` の次に `,\n      storage: result.storage` を足し、`listed` の分割 `const { startedAt, runs, undo, attribution, scope, entries, totalCount, truncated, headChanged } = result` に `storage` を足して、`view` の `attribution` の次に `storage` を足す
3. 先頭のコメントの `(記録の区別の要約 attribution も写す)` を `(記録の区別の要約 attribution と記録の置き場 storage も写す)` にする

`src/renderer/src/lib/agentChangesMessages.ts`:
1. `AGENT_CHANGES_LOADING` の定数の後に足す:
```ts
/** 記録の置き場の注記(記録中で、記録がアプリの一時領域の隠れた git のとき) */
export const AGENT_CHANGES_APP_STORAGE_NOTE =
  'Git 管理外のフォルダのため、アプリの一時領域に記録しています（node_modules などは記録しません）'
/** 記録の置き場の注記(記録の前で、Git 管理外のフォルダのとき) */
export const AGENT_CHANGES_APP_STORAGE_HINT =
  'Git 管理外のフォルダのため、記録はアプリの一時領域に置きます（node_modules などは記録しません）'
```
2. `AGENT_CHANGES_UNAVAILABLE_MESSAGES` の `'not-repository': 'Git 管理外のフォルダでは、エージェントの変更を記録できません',` を `'not-repository': 'Git 管理外のフォルダになったため、記録できません',` にし、その行の上に `// not-repository はリポジトリの方式の記録の区切りでだけ返る(累積の始点では Git 管理外のフォルダを隠れた git で記録する)` を足す

`src/renderer/src/lib/agentChangesSectionText.ts`:
1. `./agentChangesMessages` の import に `AGENT_CHANGES_APP_STORAGE_HINT`・`AGENT_CHANGES_APP_STORAGE_NOTE` を足す
2. 先頭のコメントの `(見出し・範囲の一覧が取れない理由・区別の状態の 1 行・すべて戻すから除く旨)` を `(見出し・範囲の一覧が取れない理由・区別の状態の 1 行・すべて戻すから除く旨・記録の置き場の注記)` にする
3. `describeAgentChangesSectionExcluded` の後に足す:
```ts
/**
 * 記録の置き場の注記(出さないなら null)。記録中は記録が隠れた git(storage: 'app')のとき NOTE(記録中に git init してパネルが
 * リポジトリの表示に変わっても、記録が隠れた git のままなら出し続ける)。記録が無い間は Git 管理外のフォルダのとき HINT。
 * 記録できない理由が出ている間は出さない(理由の文と重ねない)
 */
export function describeAgentChangesStorage(
  view: AgentChangesView,
  isNotRepository: boolean
): string | null {
  if (view.kind === 'recording') return view.storage === 'app' ? AGENT_CHANGES_APP_STORAGE_NOTE : null
  if (view.kind === 'none') return isNotRepository ? AGENT_CHANGES_APP_STORAGE_HINT : null
  return null
}
```

`src/renderer/src/components/source-control/AgentChangesSection.tsx`:
1. `../../lib/agentChangesMessages` の import から `AGENT_CHANGES_UNAVAILABLE_MESSAGES,` を外し、`../../lib/agentChangesSectionText` の import に `describeAgentChangesStorage,` を足す
2. `AgentChangesSectionProps` の `/** Git 管理外のフォルダか(記録を始める前から理由を出す) */` を `/** Git 管理外のフォルダか(記録の前に、記録をアプリの一時領域に置く旨の 1 行を出す) */` にする
3. `// 管理外で記録できなかった後にリポジトリを初期化したら、…` のコメントと `const isNoneShown = …` の 3 行を次にする:
```ts
  const isNoneShown = view.kind === 'none'
  // 記録の置き場の注記(本文の先頭に 1 行。記録中は記録が隠れた git のとき、記録の前は Git 管理外のフォルダのとき)。読み上げない
  const storageNote = describeAgentChangesStorage(view, isNotRepository)
```
4. `<div id={bodyId} className="agent-changes__body" hidden={!isOpen}>` の直後から `{view.kind === 'unavailable' && !isNoneShown && (` の直前までを次にする（Git 管理外の分岐を外し、リポジトリと同じ案内とボタンにする）:
```tsx
          {storageNote !== null && <p className="agent-changes__note">{storageNote}</p>}
          {isNoneShown && (
            <>
              <p className="agent-changes__note">{AGENT_CHANGES_NONE_HINT}</p>
              <div className="agent-changes__actions">
                <button
                  type="button"
                  className="agent-changes__button"
                  disabled={changes.isBeginning}
                  onClick={() => {
                    reserveFocusRestore()
                    void changes.begin()
                  }}
                >
                  {changes.isBeginning ? '記録しています…' : 'いまから記録する'}
                </button>
              </div>
            </>
          )}
```
5. `{view.kind === 'unavailable' && !isNoneShown && (` を `{view.kind === 'unavailable' && (` にする

`src/renderer/src/components/source-control/NotRepositoryView.tsx` の `/** セクション「エージェントの変更」(Git 管理外の理由を出す) */` を `/** セクション「エージェントの変更」(Git 管理外のフォルダでもアプリの一時領域に記録できる。記録の前はその旨を 1 行出す) */` にする。

- [ ] **Step 7: 型と `toEqual` で落ちる既存のテストを直す**

Run: `npm run typecheck`
で落ちたテストのファイル（`kind: 'recording'` の状態・写し・一覧の結果をリテラルで作っているもの）と、
Run: `npx vitest run src/renderer src/main/__tests__/handlers src/main/__tests__/helpers src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/agentChangesScopedQuery.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts`
で `toEqual` の違い（`storage` が足りない・多い）で落ちたものを、次の規則で直す:
- 期待値・入力のリテラルの `attribution: …` の次に `storage: 'repository'` を足す（リポジトリの方式の記録の偽物。計画の時点で当たると分かっているのは `src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts` の `kind: 'recording'` の期待値 5 か所・`src/renderer/src/lib/__tests__/agentChangesView.test.ts` の `kind: 'recording'` の期待値・`src/renderer/src/lib/__tests__/agentChangesApi.test.ts` の 31 行目付近の入力・`src/main/__tests__/handlers/agentChangesHandlers.test.ts` の 183 行目付近の期待値・`src/main/__tests__/helpers/agentBaselineFixtures.test.ts` の 252 行目付近の期待値）
- `toMatchObject` の期待値は直さない（`storage` の有無で落ちない）
- 上の規則に当たらない落ち方をしたら、その理由を確かめてから直す（`storage` の配線の誤りなら実装を直す）

- [ ] **Step 8: テストが通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/agentChangesScopedQuery.test.ts src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/lib/__tests__/agentChangesSectionText.test.ts src/renderer/src/lib/__tests__/agentChangesView.test.ts src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx src/renderer/src/components/source-control/__tests__/NotRepositoryView.test.tsx src/renderer/src/components/__tests__/App.agentChanges.test.tsx`
Expected: PASS

- [ ] **Step 9: 変異で確かめる**

1. `summarizeAgentChangesRecord` の `storage` を `'repository'` に固定する → `agentChangesRecord.test.ts` の `記録の置き場(storage)は…`・`agentBaselineRegistry.test.ts` の `記録中の状態(begin・getState)の storage は app`・`agentChangesScopedQuery.test.ts` の `結果の storage は…` が落ちる。戻す
2. `planRecordingState` の `storage: state.storage` を `storage: 'repository'` にする → `agentChangesView.test.ts` の `記録の置き場(storage)を状態から写す` が落ちる。戻す
3. `describeAgentChangesStorage` の `if (view.kind === 'recording') …` の行を `if (view.kind === 'recording') return isNotRepository ? AGENT_CHANGES_APP_STORAGE_NOTE : null` にする（パネルの判定で決める誤り）→ `agentChangesSectionText.test.ts` と `AgentChangesSection.test.tsx` の `…パネルが Git 管理外(false)かに関わらず NOTE…` が落ちる。戻す
4. `AgentChangesSection.tsx` の `{storageNote !== null && …}` の行を消す → `AgentChangesSection.test.tsx` の HINT・NOTE のテストが落ちる。戻す
5. `git diff` で戻したことを確かめる

- [ ] **Step 10: 全体の検証**

Run: `npm test`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/shared/types/agentChanges.ts src/main/agentChangesRecord.ts src/renderer/src/types.ts src/renderer/src/lib/agentChangesView.ts src/renderer/src/lib/agentChangesMessages.ts src/renderer/src/lib/agentChangesSectionText.ts src/renderer/src/components/source-control/AgentChangesSection.tsx src/renderer/src/components/source-control/NotRepositoryView.tsx src/renderer/src/__tests__/makeAgentChangesState.ts src/main/__tests__/helpers/agentBaselineFixtures.ts <Step 1〜3・7 で変えたテストのファイル>` → `npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 11: コミット（利用者の指示があるときだけ）**

```bash
git add src/shared/types/agentChanges.ts src/main/agentChangesRecord.ts src/renderer/src/types.ts src/renderer/src/lib/agentChangesView.ts src/renderer/src/lib/agentChangesMessages.ts src/renderer/src/lib/agentChangesSectionText.ts src/renderer/src/components/source-control/AgentChangesSection.tsx src/renderer/src/components/source-control/NotRepositoryView.tsx src/renderer/src/__tests__/makeAgentChangesState.ts src/main/__tests__/helpers/agentBaselineFixtures.ts <Step 1〜3・7 で変えたテストのファイル>
git commit -m "feat: Git 管理外のフォルダでも記録を始められるようにし、アプリの一時領域に記録する旨をセクションに出す"
```

---

### Task 6: ROADMAP の更新・既知の制約・テスト仕様書と全体の検証（テスト仕様書への追記と Artifact の再公開）

> **設計書の読む節:** 「既知の制約」、「実機テスト仕様書の方針」、「実装の分割」の 6、「main に入れた時点で利用者から見える挙動」。
>
> **気をつける知見:** L-354（新しい項目は実装後の文言・コードと照らし合わせて書く）・L-072（毎回 `mktemp -d` のフォルダ。消すコマンドに作ったフォルダの絶対パス。プロセスを止める前に Electron であることを確かめる）・L-009（大文字小文字の食い違いを既知の制約に書く）

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-agent-changes-non-git-folder-design.md`（「既知の制約」を実装と照らし合わせた食い違いだけ）
- Modify: `docs/manual-test-spec.md`（AGC-005・GIT-006 の直し、`### Git 管理外のフォルダでの記録` と AGC-131〜143 の追加。**ID は変えない・振り直さない**）
- Modify: `ROADMAP.md`（**prettier にかけない**）
- Modify: `docs/superpowers/specs/2026-10-06-agent-changes-review-design.md`（注記だけ。本文は書き換えない）
- 生成（git 管理外）: `.superpowers/manual-test-spec.html`

**Interfaces:**
- Consumes: Task 1〜5 の実装（文言は Global Constraints の「renderer の文言」と一字一句同じ。正は `src/renderer/src/lib/agentChangesMessages.ts`）、Task 3b の計測の結果（未確認事項 2）
- Produces: 実機テスト仕様書の AGC-131〜AGC-143 と直した項目（コントローラーが Artifact を再公開する）

- [ ] **Step 1: 設計書の「既知の制約」を実装と照らし合わせる**

`sed -n '/^## 既知の制約/,/^## 未確認事項/p' docs/superpowers/specs/2026-10-15-agent-changes-non-git-folder-design.md` で読み、次を実装と照らし合わせる。食い違いがあれば設計書の行を実装に合わせて直す（無ければ変えない）:
1. 上限の行の値（5,000 件・100MB・10 秒）が `AGENT_BASELINE_MAX_UNTRACKED_FILES`・`AGENT_BASELINE_MAX_UNTRACKED_BYTES`・`AGENT_BASELINE_GIT_TIMEOUT_MS` と同じか。Task 3b の計測（未確認事項 2）で打ち切りに近い値が出ていれば、その値が書かれているか
2. 既定の一覧の行の並びが `AGENT_BASELINE_DEFAULT_EXCLUDES` と同じ順か
3. 「古い版の名前（pid を含まない）の一時ディレクトリと、取り消しの控えの一時ディレクトリは、今までどおり OS の掃除に任せる」が `parseBaselineTempDirName`（古い形は null）・`sweepStaleBaselineTempDirs`（`prompt-ide-agent-baseline-` だけ）のとおりか
4. Task 2a・4 の未確認事項 1・3 の結果（fsmonitor・sha256・reftable）が想定と違っていれば、その旨の行があるか
5. 「読めないファイルがあると記録できない（git を実行できない、と出る）」の文言が `AGENT_CHANGES_UNAVAILABLE_MESSAGES['git-failed']`（`git を実行できないため、記録できません`）と合うか

- [ ] **Step 2: 実機テスト仕様書の既存の項目を直す（ID は変えない）**

`docs/manual-test-spec.md`:
1. **AGC-005** の行（`- [ ] **AGC-005** Git 管理外のフォルダ（`mktemp -d` で作っただけ）を開き、…`）を次に置き換える:
```markdown
- [ ] **AGC-005** Git 管理外のフォルダ（`mktemp -d` で作っただけ）を開き、ソース管理パネルを見る → 「エージェントの変更」に `プロンプトの「実行」で、実行の前の状態の記録を始めます` と `Git 管理外のフォルダのため、記録はアプリの一時領域に置きます（node_modules などは記録しません）` と `いまから記録する` のボタンが出る。`実行` でエージェントへ送れる
```
2. **GIT-006** の行の最後の括弧（`（エージェント CLI 方式では、その下に「エージェントの変更」のセクションと `Git 管理外のフォルダでは、エージェントの変更を記録できません` が出る）`）を次にする（ほかの部分は変えない）:
```markdown
（エージェント CLI 方式では、その下に「エージェントの変更」のセクションと `Git 管理外のフォルダのため、記録はアプリの一時領域に置きます（node_modules などは記録しません）`・`いまから記録する` が出る）
```
3. `grep -n "Git 管理外のフォルダでは、エージェントの変更を記録できません" docs/manual-test-spec.md` が何も出さないことを確かめる（出たら、その項目の期待結果を 1・2 と同じ考え方で直す。ID は変えない）

- [ ] **Step 3: 実機テスト仕様書に新しい節と項目を足す**

`docs/manual-test-spec.md` の「## エージェントの変更の確認」の中の `### 利用者の変更との区別` の節の最後の項目（今の最大の **AGC-130**）の行の直後に、空行を 1 つ置いて次をそのまま足す（1 行 1 項目。新しい項目は AGC-131 から振る）。足す前に、各項目の文言（`` ` `` で囲んだ画面の文字）が `src/renderer/src/lib/agentChangesMessages.ts` の定数と一字一句同じであることを `grep -F` で確かめる（L-354）:
```markdown
### Git 管理外のフォルダでの記録

> 前提: 「Git 管理外のフォルダ」は、端末で `N=$(mktemp -d); cd "$N" && printf 'one\ntwo\nthree\n' > a.txt && printf 'b\n' > b.txt && printf '#!/bin/sh\necho run\n' > run.sh && chmod +x run.sh && ln -s a.txt link.txt && mkdir node_modules && printf 'm\n' > node_modules/m.js && pwd` を実行して作り、表示されたパスをアプリで開く（フォルダの選択画面では Cmd+Shift+G でパスを入力する）。項目ごとに新しく作る。`claude` はアプリの中のタブで起動する
> 前提: 既知の制約として、既定の一覧（`node_modules/`・`.venv/`・`venv/`・`__pycache__/`・`.next/`・`dist/`・`build/`・`target/`・`.DS_Store`・`Thumbs.db`）の中の変更は一覧に出ず、Git 管理外のフォルダの記録では HEAD の帯は出ない。Windows では確かめていない

- [ ] **AGC-131** Git 管理外のフォルダを開く → `Git リポジトリではありません` と `リポジトリを初期化` の下のセクションに、`Git 管理外のフォルダのため、記録はアプリの一時領域に置きます（node_modules などは記録しません）` と `いまから記録する` が出る
- [ ] **AGC-132** `a.txt の最後に agent という行を足し、b.txt を消し、z.txt を作って` を `実行` で送り、作業の後に `変更を確認` を押す → 一覧に `M a.txt`・`D b.txt`・`A z.txt` が出て、`Git 管理外のフォルダのため、アプリの一時領域に記録しています（node_modules などは記録しません）` が出る。HEAD の帯は出ない。端末で `ls -a "$N"` を実行すると `.git` が無い
- [ ] **AGC-133** AGC-132 の後、`a.txt` の diff タブで `このハンクを実行前に戻す` を押して確認で OK → ハンクが戻り、一覧から `a.txt` が消える。帯の `戻した操作を取り消す` で元に戻る
- [ ] **AGC-134** AGC-132 の後、`すべて戻す` を押して確認で OK → `b.txt` が戻り、`z.txt` はゴミ箱に移る。`a.txt` は `one`〜`three` の 3 行に戻る
- [ ] **AGC-135** 記録がある状態で、エージェントに `node_modules/new.js と dist/out.js を作って` を送り、作業の後に `更新` → どちらも一覧に出ない。端末で `printf '!dist/\n' > "$N/.gitignore"` を実行し、`確認を終える` の後に `いまから記録する` を押してから同じ指示で `dist/out2.js` を作らせる → `.gitignore` と `dist/out.js` は一覧に出ず（記録の前からあった）、`A dist/out2.js` の行が出る
- [ ] **AGC-136** `link.txt を消して、run.sh の 2 行目を echo changed にして` を送る → `D link.txt`・`M run.sh` が出る。両方を行の `↶` で戻す → 端末の `readlink "$N/link.txt"` が `a.txt`、`ls -l "$N/run.sh"` が実行ビット付き（`-rwx`）
- [ ] **AGC-137** プロンプトを 2 回送ってから表示の選択で `実行 1`・`実行 2` を選ぶ → それぞれの実行で変わったファイルだけが出る
- [ ] **AGC-138** `claude` で `こんにちは` を送って確かめた状態にしてから `いまから記録する` を押し、claude が止まっている間に端末で `echo user >> "$N/a.txt"` を実行して `更新` → `a.txt` の行に `利用者の変更` の印が付き、`すべて戻す` の対象から外れる
- [ ] **AGC-139** 端末で `mkdir "$N/many" && for i in $(seq 1 5001); do : > "$N/many/$i.txt"; done` を実行してから `いまから記録する` を押す → `ファイルが多すぎるため、記録できません。リポジトリを初期化するか、.gitignore で記録しないファイルを指定してください（5,005 件）` が出て、`もう一度試す` は出ない。端末で `rm -rf "$N/many"` を実行してから `実行` で送ると記録が始まる
- [ ] **AGC-140** 記録がある状態で、パネルの `リポジトリを初期化` で初期化する → パネルがリポジトリの表示に変わり、セクションの一覧と `Git 管理外のフォルダのため、アプリの一時領域に記録しています（node_modules などは記録しません）` はそのまま残る。続けて `c.txt を作って` を送る → 一覧に `A c.txt` が足され、`.git` の行は出ない。`確認を終える` の後に `いまから記録する` を押す → `Git 管理外のフォルダのため、アプリの一時領域に記録しています（node_modules などは記録しません）` が出ない（リポジトリの方式）
- [ ] **AGC-141** 記録の前後で、端末の `ls -d "${TMPDIR:-/tmp}"/prompt-ide-agent-baseline-*` を比べる → 記録を始めると `prompt-ide-agent-baseline-<pid>-<16 進 8 桁>-<6 文字>` の名前で、中に `git` を持つディレクトリが 1 つ増え（判定の区切りの、`git` を持たないディレクトリも増えることがある）、`確認を終える` で消える
- [ ] **AGC-142** 記録がある状態で、AGC-141 のディレクトリの名前の pid を控え、端末で `ps -p <pid> -o comm=` が Electron であることを確かめてから `kill -9 <pid>` を実行する。`npm run dev` の端末が終わっていなければ Ctrl+C で止めてから、`npm run dev` で起動し直す → 数秒の後に、控えた pid のディレクトリが無くなる（ほかのディレクトリは残る）
- [ ] **AGC-143** 端末で `B="$(mktemp -d)/x.git"; git init -q --bare "$B" && echo "$B"` を実行し、表示されたパスを開いて `いまから記録する` を押す → `Git のデータのフォルダ（.git の中・bare リポジトリ）では、エージェントの変更を記録できません` が出る。端末で `ls "$B"` を実行すると、記録の前と同じ（`HEAD`・`config`・`description`・`hooks`・`info`・`objects`・`refs` だけ）
```
（AGC-139 の件数 `5,005` は、前提のフォルダの `a.txt`・`b.txt`・`run.sh`・`link.txt` の 4 件と `many` の 5,001 件。`node_modules/` は既定の一覧で数えない。実装の数え方〈`ls-files --others --exclude-standard`〉と合うことを、Task 3b の `too-many-files` のテストで確かめてある）

- [ ] **Step 4: HTML を再生成し、仕様書の検査を通す**

Run: `node scripts/build-manual-test-spec.mjs`
Expected: `.superpowers/manual-test-spec.html (N 領域 / M 項目)` が出る（項目の数が直す前より 13 増えている）
Run: `npx vitest run scripts`
Expected: PASS（ID の一意性・接頭辞ごとの連番の昇順〈欠番は許容〉・書式）

Artifact（<manual-test-spec-artifact-url>）の再公開は、このタスクの実装者ではなく**コントローラーが** `.superpowers/manual-test-spec.html` を同じファイルパスで公開して行う（実装者は HTML の生成までで止め、報告に「再公開が必要」と書く）。

- [ ] **Step 5: ROADMAP を更新する（prettier にかけない）**

`<実装の日>` は `date +%Y-%m-%d` の出力に置き換える。

1. 実装済み機能「### エージェントが変更したファイルの確認（MVP の次）」の既知の制約の `- Git 管理外のフォルダ・リポジトリのサブフォルダでは使えない` を次に置き換える:
```markdown
- リポジトリのサブフォルダでは使えない（Git 管理外のフォルダは <実装の日> から、アプリの一時領域に記録して使える。実装済みの機能の「エージェントの変更の Git 管理外のフォルダでの記録」を参照）
```
2. 同じ既知の制約の `- リロード・フォルダの切り替え・ウィンドウの破棄・アプリの終了で記録は消える。異常終了で残った一時ファイルは OS の掃除に任せる` を次に置き換える:
```markdown
- リロード・フォルダの切り替え・ウィンドウの破棄・アプリの終了で記録は消える。異常終了で残った一時ファイルは OS の掃除に任せていた（<実装の日> から、記録の一時ディレクトリ〈名前に pid を含む新しい形のもの〉は次の起動で消す。取り消しの控えと古い形の名前のものは今も OS の掃除に任せる）
```
3. 「### エージェントの変更の利用者の編集との区別（`claude` の hooks）」の節の最後の既知の制約の行（`- Windows・Linux では確かめていない（…`）の後、`---`（`## MVP: エージェント CLI のアプリ内ターミナル実行` の前の区切り）の前に、空行を 1 つ置いて新しい節を足す:
```markdown
### エージェントの変更の Git 管理外のフォルダでの記録

設計書: `docs/superpowers/specs/2026-10-15-agent-changes-non-git-folder-design.md`（<実装の日>）。

- [x] Git 管理外のフォルダでは、アプリの一時領域（OS の一時ディレクトリの中の記録の一時ディレクトリ）に記録専用の bare リポジトリ（隠れた git）を作り、開いたフォルダを作業ツリーとして記録する（フォルダには `.git` などを作らない）
- [x] フォルダの `.gitignore` に従い、既定の一覧（`node_modules/`・`.venv/`・`venv/`・`__pycache__/`・`.next/`・`dist/`・`build/`・`target/`・`.DS_Store`・`Thumbs.db`）を記録しない（`.gitignore` の `!dist/` などで打ち消せる）
- [x] リポジトリと同じセクションで、一覧・diff・行の `↶`・ハンク・`すべて戻す`・実行ごとの表示・利用者の変更との区別・戻した操作の取り消しを使える。記録の前は `Git 管理外のフォルダのため、記録はアプリの一時領域に置きます（node_modules などは記録しません）`、記録中は `Git 管理外のフォルダのため、アプリの一時領域に記録しています（node_modules などは記録しません）` を 1 行出す
- [x] ファイルが多すぎるフォルダ（ignore されていないファイルが 5,000 件・合計 100MB を超える）・`.git` の中・bare リポジトリのフォルダでは、それぞれの理由を出して記録しない
- [x] 記録の一時ディレクトリの名前に main の起動ごとの ID を入れ、異常終了で残ったものを次の起動で消す

既知の制約（設計書の「既知の制約」と同じ）:
（ここに、Step 1 で照らし合わせた後の設計書の「## 既知の制約（ROADMAP・実機テスト仕様書に反映する）」の `- ` で始まる箇条を、下の手順のコマンドの出力のとおり順を変えずに置く）
```
   - 「既知の制約」は、`sed -n '/^## 既知の制約（ROADMAP/,/^## 未確認事項/p' docs/superpowers/specs/2026-10-15-agent-changes-non-git-folder-design.md` の出力のうち `- ` で始まる行だけを、順を変えずにそのまま写す
4. 「## 今後実装した方がよい機能（未実装）」の「- [ ] エージェントの変更の確認の拡張:」の項目を `- [x] エージェントの変更の確認の拡張:` にし（項目の本文の 3 行は変えない）、その下の `      - 残り: Git 管理外のフォルダでの記録` の行を次に置き換える（字下げは 6 つの空白。上の 3 つの実装済みの行はそのまま残す）:
```markdown
      - 実装済み（<実装の日>。設計書 `docs/superpowers/specs/2026-10-15-agent-changes-non-git-folder-design.md`）: Git 管理外のフォルダでの記録
```
5. `grep -n "残り: Git 管理外" ROADMAP.md` が何も出さないこと、`git diff --stat ROADMAP.md` で ROADMAP の変更が上の 4 か所だけであること（prettier で整形していないこと）を確かめる

- [ ] **Step 6: 2026-10-06 の設計書へ注記する（本文は書き換えない）**

`docs/superpowers/specs/2026-10-06-agent-changes-review-design.md` の次の 8 か所に、`<実装の日>` を `date +%Y-%m-%d` の出力に置き換えて注記を足す（どれも空行で前後と区切った 1 行の引用。行番号は計画の時点のもの。`grep -n` で該当の文を探してから足す）:
1. 「含めない」の `- Git 管理外のフォルダ・リポジトリのサブフォルダを開いた場合の記録（理由を表示して使えなくする）`（:36）の後:
```markdown
> <実装の日> に変更: Git 管理外のフォルダは、2026-10-15-agent-changes-non-git-folder-design.md で、アプリの一時領域の隠れた git に記録して使えるようにした。リポジトリのサブフォルダは今も対象外。この行は当時の判断。
```
2. 完了条件の `6. Git 管理外のフォルダでは、セクションに使えない理由が出て、`実行` は従来どおり送れる`（:58）の後:
```markdown
> <実装の日> に変更: Git 管理外のフォルダでも記録が始まり、リポジトリと同じ一覧・戻すが使える（2026-10-15-agent-changes-non-git-folder-design.md）。ファイルが多すぎるフォルダ・`.git` の中・bare リポジトリでは理由が出る。
```
3. 「### 状況ごとの扱い」の表の `| Git 管理外のフォルダ …` の行（:207）を含む表の直後:
```markdown
> <実装の日> に変更: 表の「Git 管理外のフォルダ」の行は、2026-10-15-agent-changes-non-git-folder-design.md で、アプリの一時領域の隠れた git に記録するようにした（セクションには `Git 管理外のフォルダのため、記録はアプリの一時領域に置きます（node_modules などは記録しません）` と `いまから記録する` が出る）。
```
4. 導線の UI の表の `| 記録できない …` の行（:258）を含む表の直後:
```markdown
> <実装の日> に変更: 記録できない理由に、Git 管理外のフォルダでファイルが多すぎる（`too-many-files`）・`.git` の中・bare リポジトリ（`inside-git-dir`）を足し、Git 管理外は理由から外した（区切りの途中で Git 管理外になったときだけ `not-repository`。2026-10-15-agent-changes-non-git-folder-design.md）。
```
5. 実機の項目の `- Git 管理外のフォルダ・サブフォルダ・未追跡の多いリポジトリ → 理由が出て、`実行` は送れる`（:608）の後:
```markdown
> <実装の日> に変更: Git 管理外のフォルダは記録できるようになった（実機テスト仕様書の AGC-005・AGC-131〜143）。
```
6. 既知の制約の `- Git 管理外のフォルダ・リポジトリのサブフォルダでは使えない`（:623）の後:
```markdown
> <実装の日> に変更: Git 管理外のフォルダは使えるようになった（2026-10-15-agent-changes-non-git-folder-design.md。既知の制約はその設計書を参照）。リポジトリのサブフォルダは今も使えない。
```
7. この機能の後の候補の `- Git 管理外のフォルダでの記録（アプリの一時ディレクトリの bare リポジトリを `--git-dir`・`--work-tree` で使う。未確認）`（:673）の後:
```markdown
> <実装の日> に変更: 2026-10-15-agent-changes-non-git-folder-design.md で実装した（記録の一時ディレクトリの中の bare リポジトリを GIT_DIR・GIT_WORK_TREE・GIT_INDEX_FILE で使う）。
```
8. 決定した点の `5. **Git 管理外のフォルダ・リポジトリのサブフォルダ**: 対象外とし、理由を表示する`（:707）の後:
```markdown
> <実装の日> に変更: Git 管理外のフォルダは 2026-10-15-agent-changes-non-git-folder-design.md で対象にした。リポジトリのサブフォルダは今も対象外。この決定は当時の判断。
```

- [ ] **Step 7: 全体の検証**

Run: `npm test`
Expected: PASS（時間切れで落ちたファイルは `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書く）
Run: `npm run typecheck`
Expected: PASS
Run: `git diff --name-only -- '*.ts' '*.tsx' && git ls-files --others --exclude-standard -- '*.ts' '*.tsx'` で、このプランで変更・作成した TypeScript のファイルを列挙し、`npx eslint --max-warnings 0 <列挙したファイル>`
Expected: エラー・警告なし
Run: `npx vitest run scripts`
Expected: PASS
Run: `git status --short`
Expected: このプランで変えたファイルと、設計書・プランの未追跡・変更のファイルだけが出る（`.superpowers/` は git 管理外。Task 3b の計測のファイルが残っていない）

- [ ] **Step 8: コミット（利用者の指示があるときだけ）**

```bash
git add docs/manual-test-spec.md ROADMAP.md docs/superpowers/specs/2026-10-06-agent-changes-review-design.md docs/superpowers/specs/2026-10-15-agent-changes-non-git-folder-design.md
git commit -m "docs: Git 管理外のフォルダでの記録を ROADMAP の実装済みに移し、実機テスト仕様書の AGC-131〜143 と AGC-005・GIT-006 の直しを追加する"
```

---

## Self-Review（計画の作成者が設計書と照らし合わせた結果）

**1. 設計書の要件と対応するタスク:**

| 設計書の要件 | タスク |
| --- | --- |
| `BaselineSnapshot.gitDir`（必須）・`BaselineGitLocation`・`buildIsolatedGitEnv`・`buildBaselineGitEnv(source, location)`（`GIT_DIR`・`GIT_WORK_TREE`。大文字小文字を問わない） | 1 |
| 場所を受け取る `createBaselineGit`・`runBaselineGitWithInput(Sync)`、呼び出し元（記録・一覧・diff・戻す・保護の ref）とテストの補助 | 1 |
| `createRecordRepoGit`（コンフリクトの判定・blob の有無）・`readRecordHead`（HEAD・`headChanged`） | 1 |
| `assertBaselineRecord`（インデックス + `gitDir` がリンクでないディレクトリ。`記録が見つかりません`。`Between` も確かめる） | 1（`Between` は `assertBaselineGitDir`。「調整した細部」）・4（隠れた git の場合のテスト） |
| 隠れた git の作成（`init --bare -q --template=`・設定の 4 つ・`info` 0700・`info/exclude` 0600 と注釈の行・失敗は例外・打ち切り） | 2a |
| 既定の一覧（10 個・末尾の `/`・先頭の `/` なし・`.git/`・`.env` を書かない）・`!dist/` で打ち消せる | 2a・3b |
| 未確認事項 1（fsmonitor）・3（sha256・reftable） | 2a（作成と `write-tree`）・4（一連の操作） |
| 大域の `init.templateDir`・`core.hooksPath`（`post-index-change` など）の hook が動かない | 2a（命令）・4（一連の操作） |
| `TakeBaselineOptions.instanceId`（必須）・`baselineTempDirPrefix`・`AGENT_BASELINE_TEMP_DIR_PREFIX` の移動 | 2b |
| `parseBaselineTempDirName`（正規表現・`Number.isSafeInteger`・2^31−1）・`isOwnBaselineTempDir`（`lstat`・リンク・`uid`・`mode & 0o077`・Windows）・`sweepStaleBaselineTempDirs`（自分の `instanceId` を消さない・1 つの失敗で止めない・消した数） | 2b |
| `ipcHandlers.ts` の `instanceId` の共有・起動時の掃除（待たない）・`agentBaselineLifecycle.ts` のコメント | 2b |
| `BaselineCheckpointBase`・`base`・`checkpointBaseOf`・registry の実行の区切りと判定の区切り | 3a |
| `gitRepoDetection.ts`（`isInsideGitDirectory` の移動） | 3b |
| `resolveBaselineMode`（4 つの方式・`inside-git-dir`・`timeout`・区切りの `base.gitDir` の `lstat`） | 3b |
| 隠れた git の記録の手順 1〜10（一時ディレクトリ・作成・写し・空の index の検査・`add -A`・`inheritedIgnoredPaths` の注入・ignore 済み・HEAD null・`write-tree`・失敗時に自分の一時ディレクトリだけを消す） | 3b |
| 理由 `too-many-files`・`inside-git-dir`（shared の型・renderer の文言の表・短い形・件数） | 3b |
| 保護の同期を隠れた git の記録で何もしない | 3b |
| 未確認事項 2（時間と大きさ） | 3b（計測） |
| 一覧・diff・行の `↶`・ハンク・`すべて戻す`・取り消し・実行ごとの Git 管理外での動作と、フォルダに `.git` を作らないこと | 4 |
| `AgentChangesStorage`・`recording.storage`・一覧の結果の `storage`・`summarizeAgentChangesRecord` の 1 か所 | 5 |
| `agentChangesView.ts` の写し・`isSameAgentChangesView` | 5 |
| NOTE・HINT・`not-repository` の全文・`describeAgentChangesStorage`・`AgentChangesSection` の分岐と特例の撤去・注記の 1 行・`NotRepositoryView` のコメント・`makeAgentChangesState.ts` の既定 | 5（`not-repository` の全文は 3b から移した。「調整した細部」） |
| ROADMAP・2026-10-06 の設計書への注記・設計書の「既知の制約」の照合・実機テスト仕様書（AGC-005・AGC-131〜143）・HTML の再生成 | 6（GIT-006 も直す。「調整した細部」） |

「新しい状態と既存の入口」の表（L-061）: `begin`（記録が無い）→ 3b の累積の始点のテスト、`begin`（記録がある）→ 3a の registry のテスト・3b の区切りのテスト、区別の同期・吸収 → 3a の attribution のテスト、`getState` → 5 の registry のテスト、`list`・`getDiff` → 4 の一覧・diff・実行ごとのテスト、`revertFile`・`revertHunk`・`revertAll` → 4 の戻すのテスト、`undo` → 4 の取り消しのテスト、`clear`・`close` と保護の同期 → 3b の registry のテスト、起動時の掃除 → 2b、`リポジトリを初期化` → 3b（区切り）・4（一覧）・5（NOTE が出続ける）、パネルの Git の操作 → 4 の `git init` してコミットした後の一覧。「エラー処理」の各行は、3b（作成の失敗・打ち切り・`too-many-files`・`inside-git-dir`・`base.gitDir` が無い）・1 と 4（一覧・diff の `記録が見つかりません`）・2b（掃除の失敗）・3b（保護の同期）で押さえる。読めないファイル・容量の不足は既存の `git-failed` の経路のまま（新しいテストは足さない）。

抜けは見つからなかった。

**2. 書きかけの検索:** `TBD`・`TODO`・「同じように」・説明だけのコードの Step を探した。`finishSnapshot` の本体は、今のコードの範囲を指して 5 点の変更を書いた（Task 1 で足した `const location` の行を移さないことを含む）（移す範囲と移した後の形〈`checkpoint()` の並び〉を本文に書いた）。`spawnGitWithInput` の Promise の中身も、今の `runBaselineGitWithInput` の中身をそのまま移す指示と、変える 2 点（`cwd`・`env`）を書いた。Task 5 Step 7 と Task 1 Step 4 の既存のテストの直しは、規則と、計画の時点で当たると分かっているファイル・行の目印を書いた。ROADMAP の既知の制約は、写し元と取り出すコマンドを書いた。

**3. 名前と型の一貫性:** `BaselineGitLocation`・`buildIsolatedGitEnv`・`buildBaselineGitEnv(source, location)`・`createRecordRepoGit`・`readRecordHead`・`assertBaselineRecord`・`assertBaselineGitDir`・`runIsolatedGit(cwd, args, { extraEnv })`・`createHiddenGit(tempDir, gitOptions)`・`hiddenGitConfig`・`hiddenGitExcludeContent`・`hiddenGitEmptyIndexPath`・`AGENT_BASELINE_DEFAULT_EXCLUDES`・`AGENT_BASELINE_TEMP_DIR_PREFIX`・`baselineTempDirPrefix`・`parseBaselineTempDirName`・`isOwnBaselineTempDir`・`sweepStaleBaselineTempDirs`・`BaselineCheckpointBase`・`checkpointBaseOf`・`isInsideGitDirectory`・`AgentChangesStorage`・`describeAgentChangesStorage`・`AGENT_CHANGES_APP_STORAGE_NOTE`・`AGENT_CHANGES_APP_STORAGE_HINT`・テストの補助の `repoLocation`・`snapshotBase`・`createAgentNonGitFolder`・`folderEntries`・`folderChangesExcept`・`FAKE_PROTECTION_INSTANCE_ID` を、Global Constraints・各タスクの Interfaces・実装・テストで同じ名前と型にした。既存の名前（`takeBaselineSnapshot`・`copyIndexPreservingTimes`・`inspectUntracked`・`notRecordedPathsOf`・`removeInheritedPaths`・`forceRemoveStdinInput`・`parseWriteTreeOutput`・`summarizeAgentChangesRecord`・`latestRecordedIndexPath`・`attributionContextOf`・`syncProtectionValue`・`planRecordingState`・`planListResult`・`isSameAgentChangesView`・`createAgentBaselineRepo`・`disposeAgentBaselineRepo`・`recordBaseline`・`recordBaselineFrom`・`recordedSnapshot`・`createFakeTrash`・`attributionOffRecordingState`・`makeAgentChangesRecordingView` など）は今のコードに合わせた。

**作成中に直した点:**
- simple-git が `init --template=` を拒否することに気づき（`@simple-git/argv-parser` の `allowUnsafeTemplateDir`）、`createHiddenGit` を simple-git ではなく `runIsolatedGit`（spawn）で書く形に直した。あわせて、パスを git の引数にしないよう `init` の場所を cwd からの相対の `git` にした
- 親の環境の `GIT_DIR` のテストを `vi.stubEnv` で書くと、`createRepoGit` が `process.env` を引き継いで方式の判定が別のリポジトリを指し、隠れた git の経路を試せないことに気づき、`env` の選択肢で渡す形にした（理由を「調整した細部」とテストのコメントに書いた）
- `not-repository` の全文を Task 3b で変えると、Task 5 まで残る Git 管理外の分岐と既存のテストが食い違うことに気づき、Task 5 へ移した
- `Between` の 2 つの関数で記録のインデックスまで確かめると、リポジトリの方式の今の挙動（tree どうしの比較はインデックスを読まない）が変わるため、`gitDir` だけを確かめる `assertBaselineGitDir` に分けた
- 隠れた git の新規の記録の取り消しの確認の数を、実装の並び（方式の決め方の 2 回・作成・検査・`finishSnapshot` の 5 回）から数えて 9 回とし、リポジトリの方式の 10 回（既存のテスト）が変わらない並びにした
- hook のテストに、隠れた git の設定が無い bare リポジトリで hook が動く前提のテストを足し、変異を戻さなくてもテストの効き目が分かる形にした
- 実機テスト仕様書の GIT-006 が古い文言を期待していることを `grep` で見つけ、Task 6 で直す手順を足した
- テストの `takeBaselineSnapshot` の呼び出しが 26 か所あるため、`instanceId` の追加を `perl` の 1 行の置き換えと確かめのコマンドで書いた（シェルで `path` を変数名に使わない書き方にした）
