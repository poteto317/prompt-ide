# エージェントが変更したファイルの確認導線 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プロンプトの `実行`（エージェント CLI 方式）の直前に作業ツリーを「記録のインデックス」へ記録し、その時点からの差分を「エージェントの変更」としてソース管理パネルの新しいセクションと新しい種類の diff タブに出し、ファイル・ハンク・すべての単位で実行前の内容へ戻せるようにする。ターミナルの帯の `変更を確認` からソース管理パネルのセクションへすぐ移れるようにする。

**Architecture:** main は `agentBaselineGit`（記録のインデックスで問い合わせる simple-git。拒否される環境変数を除いて `GIT_INDEX_FILE` を足す）→ `agentBaselineSnapshot`（最上位の確認・未追跡の事前検査・`.git/index` の写しに `git add -A`）→ `agentChangesQuery`（`diff --name-status` と `ls-files --others --directory` の一覧・1 ファイルの diff）→ `agentChangesRevert`（既存の分類・`applyDiscard`・パッチの検査を記録のインデックスの git で呼ぶ）を、所有者（webContents）ごとの `agentBaselineRegistry`（世代・直列化・一時ディレクトリの後始末）と `agentBaselineLifecycle`（所有者の文脈の終わり・`before-quit`）で持つ。IPC は `agentChanges:*`（invoke だけ。送信元のメインフレームの確認・入力の検証）。renderer は `lib/agentChangesApi`・`lib/agentChangesMessages`（文言と押せる条件の純粋関数）・`hooks/useAgentChanges`（状態・一覧・取り直しの契機・実行中に保存したパス）・`hooks/useAgentChangesRevert`（確認 → 実行 → 成功したときだけ同期）・`AgentChangesSection`/`AgentChangesFileItem`、diff タブの種類 `kind: 'unstaged' | 'staged' | 'agent'`、ターミナルの帯の `変更を確認` で組み立てる。

**Tech Stack:** Electron 39 / React 19 / TypeScript 5.9 / simple-git 3.36.0 / git 2.50.1（macOS で実測）/ Vitest 4.1.7（jsdom）+ Testing Library

**Spec:** [docs/superpowers/specs/2026-10-06-agent-changes-review-design.md](../specs/2026-10-06-agent-changes-review-design.md)（承認済み。ユーザーの決定は設計書の「決定した点」）

**検証の記録:** プラン作成時（2026-10-07）に、`git archive HEAD`（`080e0d7`）の写しを scratchpad に作って `npm ci` し（リポジトリの作業ツリー・`.git`・`node_modules` は変えていない）、このプランの Task 1〜18 のコードを Task ごとに当てて、それぞれ対象のテストが通ることを確かめた。全部を当てた写しで `npx vitest run` が **408 ファイル・7,334 件の成功**（適用前は 392 ファイル・7,041 件）、`npm run typecheck`・`npm run build`・変更したファイルへの `npx eslint`（指摘 0）・`npx prettier --check` を確かめた。各 Task の変異の表は、同じ写しで 1 つずつ入れて表のテストのファイルで落ちることを確かめたもの。プランに載せたコードと diff は、その写しの各 Task の時点のファイルから機械的に埋め込んだ（手で書き写していない）。実 git の結合テストが起動したプロセス（clean filter の `sleep`）は止め、`pgrep -fl` で残っていないこと、OS の一時ディレクトリに記録の一時ディレクトリが残っていないことを確かめた。

---

## 設計書との差異・プラン作成時の確認の結果（実装はこちらに従う）

プランの作成時（2026-10-07。macOS 26.6・git 2.50.1・simple-git 3.36.0・node v24.14.1）に実測した。設計書の「確認の結果」1〜18 は前提として使い、ここは**その後に分かったこと**と**設計書の記述から変えた点**。各項目に、設計書のどの記述を優先したかを書く。設計書の本文の書き換えは Task 19 で行う。

確認の結果のうち、このプランのコードがその環境で動くことまで確かめたもの: 記録のインデックス（`.git/index` の写し + `GIT_INDEX_FILE` + `add -A`）で利用者の index の更新時刻（ナノ秒）・内容・stash・ref・HEAD が変わらないこと（確認の結果 2。Task 4・6 のテスト）、`git diff --name-status --no-renames -z` と `ls-files -z --others --exclude-standard --directory --no-empty-directory` で設計書の 3 と同じ集合が出ること・更新時刻だけ変わったファイルは出ないこと（確認の結果 3・5。Task 5）、`restore --worktree`（記録のインデックス）で実行の前の未ステージの変更が残ること（確認の結果 7・9。Task 6）、`git apply --reverse` で 1 ハンクだけ戻り、文脈が合わないと何も変わらないこと（確認の結果 8。Task 6）、同名のフォルダに置き換わったファイルの拒否（確認の結果 11）、`gc --prune=now` の後に戻すと拒否されファイルが消えないこと（確認の結果 12）、simple-git の `env()` が `GIT_ASKPASS` で例外になり、除けば例外にならないこと（確認の結果 14。Task 3）、コミットの無いリポジトリ・入れ子のリポジトリ（確認の結果 15。Task 4・5・6）、一時ディレクトリが `mkdtemp`（0700）でアプリの一時ディレクトリに作られ、取り消し・打ち切りで消えること（Task 4）。

1. **simple-git が `env()` で拒否する 18 個の変数に `GIT_CONFIG_GLOBAL`・`GIT_CONFIG_SYSTEM`・`GIT_CONFIG` が含まれる**（`node_modules/@simple-git/argv-parser/dist/index.cjs` の表。他に `EDITOR`・`GIT_ASKPASS`・`GIT_EDITOR`・`GIT_EXEC_PATH`・`GIT_EXTERNAL_DIFF`・`GIT_PAGER`・`GIT_PROXY_COMMAND`・`GIT_SEQUENCE_EDITOR`・`GIT_SSH`・`GIT_SSH_COMMAND`・`GIT_TEMPLATE_DIR`・`GIT_CONFIG_COUNT`・`PAGER`・`PREFIX`・`SSH_ASKPASS`）。設計書（確認の結果 14・`agentBaselineGit.ts`）のとおり除くと、記録のインデックスの git は `GIT_CONFIG_GLOBAL` を受け取れず、既定の場所（`~/.gitconfig`・`$XDG_CONFIG_HOME/git/config`）の設定を読む。→ **設計書を優先**して除く。既存の実 git のテストの隔離（`stubIsolatedGitEnv` の `GIT_CONFIG_GLOBAL=/dev/null`）がこの git には効かないため、テストの補助 `stubGitHome(dir)`（`HOME`・`XDG_CONFIG_HOME` を一時ディレクトリへ）を Task 3 で足し、記録の git を使う結合テストはすべてこれを呼ぶ（呼ばないと開発者の `core.excludesFile`・`core.hooksPath` などで結果が揺れる。Task 3 のテストで「`GIT_CONFIG_GLOBAL` は子へ渡らず、HOME の設定を読む」を固定した）。本番で利用者が `GIT_CONFIG_GLOBAL` を設定していると、記録・一覧で `core.excludesFile` などが他の Git 操作と食い違いうる → 既知の制約に足す（Task 19）。**ユーザーの判断が要る点**として最後の報告に挙げる（代わりに simple-git の `unsafe` の許可で全部を引き継ぐ案がある）
2. **既存の `assertPatchArg`（`gitHandlers.ts:173`）は文字列かどうかだけで、上限を持たない**（設計書「セキュリティ」は「既存の `assertPatchArg` と同じ上限」）。→ 粗い上限（10,000,000 文字）を足す（`AGENT_CHANGES_PATCH_MAX_LENGTH`。Task 8）。既存の `git:*` は変えない
3. **`discardFileChanges` は分けない**（設計書「既存の破棄の再利用の範囲」は `discardHunk`・`discardFileChanges` を「git を受け取る関数」に分けると書いた）。エージェントの変更のファイル単位の戻しは、一覧との照合・記録しなかったファイル・利用者の index でのコンフリクト・gitlink・blob の存在の検査を挟むため、既存の `classifyDiscardTarget`・`assertDiscardable`・`applyDiscard`（もともと git を受け取る）を直接呼ぶ。ハンクのパッチの検査だけを `verifyHunkPatch` に切り出す（Task 2。挙動は変えない。既存のテストがそのまま通る）。「すべて戻す」の文言のために `listPathsForMessage` も export する
4. **記録しなかった（5MB を超える）ファイルの「変わったか」は、記録の時点の大きさと更新時刻（`lstat`）で判断する**（設計書は「変わっていれば『記録していないため戻せません』と出す」とだけ書いた）。同じなら一覧に出さず、違えば `M`、消えたら `D`（どちらも `notRecorded`）。記録の時点に未追跡のフォルダの中にあると、記録の後にそのフォルダが `ls-files --others --directory` で `<dir>/` の 1 行になる（中の他のファイルも記録されない）ため、その行も `notRecorded`（ゴミ箱へ移すと記録していない大きいファイルを失うため戻せない）にする（Task 5）
5. **除外の pathspec は `--pathspec-from-file=<一時ディレクトリのファイル> --pathspec-file-nul` で渡す**（設計書は `add -A -- . ':(exclude,literal)<path>'`）。除外が多くても引数の長さの上限に触れないため。ファイルは `wx` で作る（パターン 147）。`git add -A --pathspec-from-file` で除外が効くことを git 2.50.1 で確かめた。入れ子のリポジトリの `hint:` を出さないよう `-c advice.addEmbeddedRepo=false` を付ける（Task 4）
6. **記録の時点のファイルが同名のフォルダに置き換わると、`ls-files --others` にフォルダの中身が出ない**（実測: `c.txt` を消して `c.txt/x` を作ると、一覧は `D c.txt` だけ）。`c.txt` の戻しは既存の重なりの検査で拒否される（確認の結果 11。フォルダの中身は消えない）。→ 既知の制約に足す（Task 19）。Task 6 の「1 件でも戻せなければ」のテストはこの形で拒否を確かめる
7. **`git cat-file -e <sha>` は、blob が無いと stderr 空・終了コード 1 で終わり、simple-git の `raw` は reject しない**（空文字で resolve する。`gitMergeState.ts:9` の `rev-parse -q --verify` と同じ）。設計書「戻す手順」4 の `cat-file -e` では存在の検査がすり抜ける（変異で確かめた）。→ `cat-file -t` の出力が `blob` かで確かめる（無いと `fatal` で reject）。また、記録の後に作業ツリーで変わったファイルの blob が消えていると、変更の一覧の `git diff --name-status` 自体が `fatal: unable to read <sha>` で失敗する（実測）。→ その失敗を `実行前の内容が見つかりません（git gc などで消えた可能性があります）` に置き換える（`AGENT_BASELINE_BLOB_MISSING_MESSAGE`。Task 6）。`cat-file -t` の検査が効くのは、一覧が取れる削除（`D`）・種類の変更のとき
8. **記録できない状態（`unavailable`）は main の registry に持たない**（設計書「記録の中身」は記録を 0 か 1 つとだけ書いた）。`begin` の結果として返し、renderer（`useAgentChanges`）が持つ。`getState` は `none` か `recording`。Git 管理外は記録を始める前から理由を出すため、renderer が `gitStatus.isRepo === false` で判断する（`NotRepositoryView` のセクション。Task 16・18）
9. **設計書に無い文言を足す**（Task 11）: 押せない理由 `一覧を取得しています`・`他の Git 操作の実行中です`・`戻す操作の実行中です`・`一覧の取得に失敗したため、戻す操作は使えません。「更新」で取り直してください`（パターン 126）、記録しなかった行の印 `記録していないため戻せません`、すべて戻すの確認の追記 `記録を始めた後にアプリで保存したファイルを含みます。`、記録を始める依頼中のボタンの文言 `記録しています…`、main の `エージェントの変更の記録がありません`・`追加・削除されたファイルはハンクでは戻せません。ファイルごと戻してください: <path>`・`サブモジュール・入れ子のリポジトリの変更は戻せません。ターミナルで操作してください: <path>`・`すべて戻すが途中で失敗しました（N / M 件を戻し済み）: <理由>`。拒否の文言のうち既存の `assertDiscardable` のもの（`未追跡のファイルと重なるため取り消せません` など）は、設計書「既存の部品を使う」に従いそのまま使う（「取り消せません」の語のまま）。Task 15 のレビューで、すべて戻すを押せない理由 `記録していないファイルがあるため、すべて戻すは使えません。ファイルごとに戻すか、ターミナルで操作してください`（`AGENT_CHANGES_NOT_RECORDED_REASON`）を足した。一覧に記録していない行（`notRecorded`）が 1 件でもあると、main は全件を先に調べて必ず全体を中止するため、押せる状態で確認を 2 回通させないよう renderer で先に止める（main へ渡す `expected` からは除かない。完全一致の照合のため）
10. **一覧の行のボタンは常に表示し 32px にする**（設計書は「既存の `ChangesFileItem` と同じ大きさ」と書いたが、既存の取り消しのボタンは 18px で hover のときだけ出る〈`main.css:1448-1470`〉。設計書の「タップ領域 32px 以上（コンセプトのタッチ操作）」を優先する。Task 16）
11. **記録を始めたら一覧を 1 回取る**（設計書「いつ完了とするか」の 4 つの契機には無い）。記録の直後は一覧が無く、セクションに何も出ないため。送信の前の準備は一覧を待たない（`void refresh()`）。Task 18 の `beginAgentChanges`
12. **すべての `agentChanges:*` で送信元のメインフレームを確かめ、パスは `resolveAndAssertStatusRelativePath`（`gitHandlers.ts:101`。export する）で検証する**（設計書のとおり。既存の `git:*` は送信元のフレームを確かめていないが、エージェントの IPC〈`agentTerminalHandlers.ts`〉に揃えた）
13. **renderer の結合テストの置き場所**: App から末端までの配線は `components/__tests__/App.agentChanges.test.tsx`（新規）、`useAppState` の配線は既存の `hooks/__tests__/useAppState.agent.test.ts` に足す（Task 18）。`DiffTabKey` の置き換え（Task 10）でテストの 162 か所を機械的に直す（スクリプトを Task 10 に載せた）

## 実装の最初に確かめること（設計書「未確認事項」1〜5 の扱い）

| #   | 設計書の項目                                                                                      | 扱い                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Electron の main から記録・一覧・戻すの時間（このリポジトリの写し・大きいリポジトリ）。macOS 以外 | プラン作成時は、このリポジトリを `git clone --no-hardlinks` した写し（追跡 852 ファイル）で、Task 4・5 と同じ git の手順をシェルから計測した（記録〈写し + `add -A`〉0.04 秒・一覧〈2 つのコマンド〉0.02 秒。設計書の確認の結果 6 と同じ桁）。Electron の main からの時間は実機の AGC-001・AGC-003 で記録する。遅くても打ち切り（10 秒）で `記録に時間がかかりすぎたため、中止しました` になり、送信は続く（設計書どおり安全側）。macOS 以外は未確認のまま既知の制約に残す |
| 2   | `claude` の書き換え方（その場の書き込み・一時ファイルからの rename）で一覧が正しいか              | Task 5 のテストで、更新時刻だけ変わったファイルが出ないこと・`echo >>`・`unlink`・`rename`・`symlink` の変更が出ることを固定した。実物の `claude` の書き換えは AGC-001・AGC-002 で確かめる。`git diff` は stat が古いと内容を読み直すため、書き換え方によらず内容で判断する（porcelain の `diff`。`diff-files` は使わない）                                                                                                                                                |
| 3   | LFS の clean filter・`core.fsmonitor` のあるリポジトリ                                            | clean filter が止まったままのとき打ち切りで `timeout` になり、一時ディレクトリが消えることを Task 4 のテストで固定した（filter の子の `sleep` は git を止めても残るため、テストで止める）。LFS・fsmonitor の実物は未確認のまま既知の制約に残す（設計書の記載のまま）                                                                                                                                                                                                       |
| 4   | `shell.trashItem` で中身の多いフォルダを移す時間                                                  | 実機の AGC-015 で時間を記録する。終わるまで戻す操作は実行中（`戻す操作の実行中です`）のまま                                                                                                                                                                                                                                                                                                                                                                                |
| 5   | `claude` のセッションの中の巻き戻しの機能                                                         | API に接続しないと確かめられない。プラン作成時は確かめていない（`claude` を起動していない）。未確認のまま設計書・ROADMAP に残す                                                                                                                                                                                                                                                                                                                                            |

## Global Constraints

- 返答・コメント・エラーメッセージ・テスト名・UI の文言は日本語。型だけの import は `import type`。関数には戻り値の型を書く（`@typescript-eslint/explicit-function-return-type`）。
- 新しい React のコンポーネント（`AgentChangesSection.tsx`・`AgentChangesFileItem.tsx`）の先頭に `'use client'` を置く。既存のコンポーネントには足さない。
- 見た目は既存の暗色固定のテーマ（`src/renderer/src/assets/main.css` の既存の色・枠付きボタンの規則）に合わせる。Tailwind は使っていないので CLAUDE.md の `dark:` の規則は既存の CSS に従う。ボタンのタップ領域は 32px 以上。
- a11y: 無効のボタンの理由は 1 か所に出して `aria-describedby` で参照する（パターン 126）。`aria-label` は可視の文言で始める（パターン 76）。結果の通知は先に在る `aria-live="polite"` の要素の文言を変える（`toAnnouncementText`。パターン 87・151）。消える要素にフォーカスを残さず、フォーカスの移動は要素がマウントされた後の effect で行う（パターン 86・152）。
- MVP の安全策を弱めない: renderer から受け取るのはパス・パッチ・確認の一覧だけ。記録のインデックスの場所・フォルダ・git の引数は main が決め、IPC に出さない（パターン 144）。すべての `agentChanges:*` で送信元がメインフレームか（`isMainFrameSender`）を確かめ、パスは許可のフォルダの中の相対パスに限る。記録は送信元の webContents の id で引く（所有者の分離）。世代で待つ間の取り消しを扱う（パターン 141）。一時ファイルは `wx`（パターン 147）。編集中のタブは自動で上書きせず、確認で未保存の破棄を承諾したときだけ読み直す。
- 既存の Git 層の挙動を変えない。切り出し（`gitDiffArgs.ts`・`verifyHunkPatch`・`listPathsForMessage`）は既存のテストが通ることで確かめる。既存の Git 層は新しいファイルを知らない（依存の向き）。
- `git commit`・`git push`・`git add`・`git stash`・`git checkout`・`git restore` はリポジトリで行わない（コミットはユーザーの指示まで保留。各タスクの最後は「確認コマンド」）。ブランチは `feat/agent-changes-review` のまま。設計書は未追跡のまま。Copilot へのレビュー依頼は行わない。
- 実 git のテストは既存の流儀で隔離する: `stubIsolatedGitEnv()`（`GIT_CONFIG_GLOBAL=/dev/null` など）・`mkdtemp` のリポジトリ・`afterEach` の `vi.unstubAllEnvs()` と削除。加えて、記録のインデックスの git は `GIT_CONFIG_GLOBAL` を受け取れない（差異 1）ため、`stubGitHome(dir)`（Task 3 で `helpers/realGitRepo.ts` に足す）で `HOME`・`XDG_CONFIG_HOME` を一時ディレクトリにする。ゴミ箱は偽物を注入する。
- テストは TDD（失敗するテスト → 実装 → 成功）。変異の確認は、`mktemp -d` へ実装のファイルを `cp` で退避 → 変異を入れる → テストのファイルで `Tests N failed` を確かめる → `cp` で復元 → `cmp` で一致を確かめる（`git stash` は使わない。パターン 57・130）。置き換えは失敗が見える `python3` のスクリプトのファイルで行う（例は Task 4）。
- `act(...).then(...)` の形でテストを書かない。モックの実装はテストの中か `beforeEach` で設定する。偽のタイマーは `afterEach` の `vi.useRealTimers()` で戻す。テストのタイマー・購読は後始末する（CLAUDE.md）。effect の後に起きるもの（フォーカス・通知）は `waitFor` で待つ。
- 整形は変更したファイルだけに `npx prettier --write <ファイル…>` をかける（パターン 135）。zsh は変数を単語分割しないので、複数のファイルはコマンドに直接並べる。macOS に `timeout` は無い。長い出力は `| tail -n 20` で絞る。
- ソースに U+200B などの見えない文字をそのまま書かない（既存の `announcementText.ts` と同じく `'\u200b'` のエスケープで書く）。
- 既存のファイルの変更は unified diff で示す（`-` を消して `+` を足す）。読むためのもので、文書の整形で空の文脈の行の先頭の空白は落ちている（`git apply` にそのまま渡さない）。新しいファイルは全文を示す。
- 実機（Electron）の確認の手順はプランに書かない。手動テスト仕様の接頭辞 `AGC` を Task 19 で追記する。

### 型・定数・文言（完全一致。Task 間で共有する）

- `src/shared/types/agentChanges.ts`（Task 1）: `AGENT_CHANGES_LIST_LIMIT = 500`・`AGENT_BASELINE_MAX_UNTRACKED_FILES = 5_000`・`AGENT_BASELINE_MAX_UNTRACKED_BYTES = 100 * 1024 * 1024`・`AGENT_BASELINE_EXCLUDE_FILE_BYTES = 5 * 1024 * 1024`・`AGENT_BASELINE_GIT_TIMEOUT_MS = 10_000`、`AgentChangesUnavailableReason = 'not-repository' | 'not-toplevel' | 'too-many-untracked' | 'timeout' | 'git-failed'`、`AgentChangesState = { kind: 'none' } | { kind: 'unavailable'; reason; untrackedCount?; untrackedBytes? } | { kind: 'recording'; startedAt: number }`、`AgentChangeStatus = 'A' | 'M' | 'D' | 'T'`、`AgentChangeEntry = { path; status; isDirectory; notRecorded }`、`AgentChangesListResult = { kind: 'none' } | { kind: 'recording'; startedAt; entries; totalCount; truncated; headChanged }`、`AgentRevertAllEntry = { path; status }`、`isAgentChangeStatus(value): value is AgentChangeStatus`
- IPC のチャンネル（すべて invoke）: `agentChanges:begin`・`agentChanges:getState`・`agentChanges:list`・`agentChanges:getDiff`・`agentChanges:revertFile`・`agentChanges:revertHunk`・`agentChanges:revertAll`・`agentChanges:clear`
- `window.api`: `beginAgentChanges(): Promise<AgentChangesState>`・`getAgentChangesState(): Promise<AgentChangesState>`・`listAgentChanges(): Promise<AgentChangesListResult>`・`getAgentChangeDiff(path): Promise<string>`・`revertAgentChange(path): Promise<void>`・`revertAgentChangeHunk(path, patch): Promise<void>`・`revertAllAgentChanges(expected: AgentRevertAllEntry[]): Promise<DiscardAllResult>`・`clearAgentChanges(): Promise<void>`
- main の文言（`agentChangesRevert.ts`。Task 6）: `変更の状態が変わりました。一覧を更新してください`・`ハンクを戻せませんでした。ファイルが変更された可能性があります。diff を開き直してください`・`変更の状態が変わったため、戻すのを中止しました。もう一度操作してください`・`変更が多すぎるため、すべて戻すは使えません。ファイルごとに戻すか、ターミナルで操作してください`
- renderer の文言（`lib/agentChangesMessages.ts`。Task 11）: 設計書「A の詳細」の表・「確認ダイアログの文言」の表・「状況ごとの扱い」の文言のとおり
- diff タブの種類（Task 10・14）: `DiffTabKind = 'unstaged' | 'staged' | 'agent'`、`DiffTabKey = { path: string; kind: DiffTabKind }`、ラベル `<path> (エージェントの変更)`

## File Structure

| ファイル                                                                                                                                                       | 責務                                                                             | 変更   | Task |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------ | ---- |
| `src/shared/types/agentChanges.ts`・`src/shared/types.ts`                                                                                                      | IPC の型・上限                                                                   | 両方   | 1    |
| `src/main/gitDiffArgs.ts`・`gitService.ts`・`gitDiscardService.ts`                                                                                             | パッチの形式の引数の共有・ハンクのパッチの検査の切り出し（挙動は変えない）       | 両方   | 2    |
| `src/main/agentBaselineGit.ts`・`__tests__/helpers/realGitRepo.ts`                                                                                             | 記録のインデックスで問い合わせる git（環境変数の除外）・テストの HOME の隔離     | 両方   | 3    |
| `src/main/agentBaselineSnapshot.ts`                                                                                                                            | 記録を取る（最上位・未追跡の事前検査・写し・`add -A`・HEAD・打ち切り・取り消し） | Create | 4    |
| `src/main/agentChangesQuery.ts`                                                                                                                                | 一覧と 1 ファイルの diff                                                         | Create | 5・6 |
| `src/main/agentChangesRevert.ts`                                                                                                                               | 戻す（ファイル・ハンク・すべて）                                                 | Create | 6    |
| `src/main/agentBaselineRegistry.ts`                                                                                                                            | 所有者ごとの記録・世代・直列化・後始末                                           | Create | 7    |
| `src/main/agentBaselineLifecycle.ts`・`handlers/agentChangesPayloadParser.ts`・`handlers/agentChangesHandlers.ts`・`handlers/gitHandlers.ts`・`ipcHandlers.ts` | 記録を捨てる契機・入力の検証・IPC の受け口・組み立て                             | 両方   | 8    |
| `src/preload/api.ts`・`index.d.ts`・`src/renderer/src/lib/agentChangesApi.ts`・`__tests__/setup.ts`                                                            | preload の API・renderer の窓口・テストの stub                                   | 両方   | 9    |
| `src/renderer/src/hooks/useDiffTabs.ts`・`diffTabPath.ts`・`useCombinedEditorTabs.ts`・`useDiffOperations.ts`・`useAppState.ts`・`App.tsx`                     | diff タブのキーを `kind` へ（挙動は変えない）                                    | Modify | 10   |
| `src/renderer/src/lib/agentChangesMessages.ts`                                                                                                                 | 文言・押せる条件・確認の文言                                                     | Create | 11   |
| `src/renderer/src/hooks/useAgentChanges.ts`                                                                                                                    | 記録の状態・一覧・保存したパス・フォーカスの依頼                                 | Create | 12   |
| `src/renderer/src/hooks/useAgentPromptSender.ts`・`useAgentWorkspace.ts`                                                                                       | 送信の前に記録を始める                                                           | Modify | 13   |
| `useDiffTabs.ts`・`diffTabPath.ts`・`useCombinedEditorTabs.ts`・`useDiffOperations.ts`・`types.ts`・`DiffView.tsx`・`EditorPanel.tsx`・`useAppState.ts`        | エージェントの変更の diff タブ                                                   | Modify | 14   |
| `src/renderer/src/hooks/useAgentChangesRevert.ts`                                                                                                              | 戻す操作（確認 → ロック → 実行 → 成功したときだけ同期）                          | Create | 15   |
| `src/renderer/src/components/source-control/AgentChangesSection.tsx`・`AgentChangesFileItem.tsx`・`assets/main.css`                                            | セクションと 1 行・見た目                                                        | 両方   | 16   |
| `src/renderer/src/hooks/usePanelState.ts`・`components/agent/AgentTerminalPanel.tsx`・`components/EditorPanel.tsx`                                             | 帯の `変更を確認`・パネルを切り替えて開く                                        | Modify | 17   |
| `useAppState.ts`・`App.tsx`・`Sidebar.tsx`・`SourceControlPanel.tsx`・`GitRepoView.tsx`・`NotRepositoryView.tsx`                                               | 組み立て・取り直しの契機・diff タブの同期                                        | Modify | 18   |
| `ROADMAP.md`・`docs/manual-test-spec.md`・設計書                                                                                                               | 実装済みへの移動・既知の制約・`AGC`・既存の前提の更新                            | Modify | 19   |

依存の向き（設計書「依存の向き」のとおり）: main は `handlers/agentChangesHandlers` → `agentBaselineRegistry`・`agentChangesQuery`・`agentChangesRevert` → `agentBaselineSnapshot`・`agentBaselineGit`・既存の `gitDiscardClassifier`・`gitDiscardService`・`gitApply`・`gitHunkPatch`・`gitDiffFormatter`・`gitService.getDiff`。既存の Git 層は新しいファイルを import しない。renderer は コンポーネント → hooks → `lib/agentChangesMessages`・`lib/agentChangesApi`。

## 設計書の要件の網羅（要件 → Task）

| 設計書の要件                                                                                                                                            | Task                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 記録の開始: `実行` の直前（記録が無いときだけ・累積）・`いまから記録する`・待つ上限 10 秒・失敗しても送る                                               | 7・12・13・16・18   |
| 記録の中身（記録のインデックス・一時ディレクトリ 0700・`.git` の外・HEAD・記録しなかったファイル・世代）                                                | 4・7                |
| 状況ごとの扱い: Git 管理外・サブフォルダ・未追跡の上限（5,000 件・100MB）と 5MB の除外・コミット・HEAD の帯・入れ子のリポジトリ・リネーム・コンフリクト | 4・5・6・11・16・18 |
| 一覧（`diff --name-status`・`ls-files --others --directory`・500 行の打ち切り・`ほか N 件`・blob を書かない・利用者の index を変えない）                | 5・16               |
| diff タブ（`<path> (エージェントの変更)`・ステージの操作を出さない・追加は全行の追加・フォルダは件数の 1 行・一覧から消えたら閉じる）                   | 5・10・14・18       |
| 戻す: ファイル（変更・削除は記録の時点へ・追加はゴミ箱）・ハンク（逆適用・追加と削除は拒否）・すべて（照合・全件を先に分類・`partial`）                 | 2・6・15・16        |
| 戻す前の検査（一覧に含まれるか・コンフリクト・gitlink・blob の存在・重なり・記録しなかったファイル）                                                    | 6                   |
| 利用者の編集を誤って破棄しない確認（実行前の編集は構造で守る・アプリでの保存の印・未保存の編集・エージェントの動作中・確認の文言の表）                  | 11・12・15・16・18  |
| 成功したときだけタブとツリーを同期（`reloadOpenFile`・`closeTabsAtOrInside`・`reloadOpenFiles`・`partial`）                                             | 15                  |
| 記録の終了: `確認を終える`・フォルダの切り替え・リロード・ウィンドウの破棄・renderer の終了・アプリの終了                                               | 7・8・12・16        |
| 導線（案 A）: セクションの位置（バナーの直後・コミットの欄の上）・状態ごとの表示・折りたたみ・従来の方式の扱い                                          | 16・18              |
| 導線: ターミナルの帯の `変更を確認`（記録がある間だけ・切り替えて開く・取り直す・フォーカス・最大化の解除・狭い幅）                                     | 17・18              |
| いつ完了とするか: 取り直しの契機 4 つ（帯・`更新` と既存の更新・`refreshGitStatus`・セッションの終了）・フォーカスの復帰では取り直さない                | 12・18              |
| a11y: `aria-live` の常設の通知・`aria-describedby` の理由・`aria-expanded`・`aria-label`・32px                                                          | 14・16・17          |
| IPC（8 つのチャンネル）・セキュリティ（入力の検証・送信元のフレーム・所有者の分離・場所を出さない・git の引数を固定）                                   | 1・8・9             |
| エラー処理の表（git が無い・リポジトリでない・未追跡の上限・打ち切り・一覧の失敗・戻す失敗・blob が消えた）                                             | 4・5・6・12・15・16 |
| テスト方針（単体・実 git の結合・変異・配線）                                                                                                           | 1〜18               |
| ROADMAP の更新・既知の制約（設計書と 1 対 1）・手動テスト仕様 `AGC`・既存の項目の前提                                                                   | 19                  |

---

### Task 1: shared: エージェントの変更の型と上限

**Files:**

- Create: `src/shared/types/agentChanges.ts`、`src/shared/__tests__/agentChanges.test.ts`
- Modify: `src/shared/types.ts:8`（`export type *` に足す）・`src/shared/types.ts:30`（`CONFLICT_CHOICES` の再公開の前に値の再公開を足す）

**Interfaces:**

- Consumes: なし
- Produces: 「型・定数・文言」の `src/shared/types/agentChanges.ts` の全部（`@shared/types` から import できる）。`DiscardAllResult` は既存（`src/shared/types/git.ts:114`）をそのまま使う

- [ ] **Step 1: 失敗するテストを書く**

`src/shared/__tests__/agentChanges.test.ts`（新規）:

```ts
import { describe, it, expect } from 'vitest'
import {
  AGENT_BASELINE_EXCLUDE_FILE_BYTES,
  AGENT_CHANGE_STATUSES,
  isAgentChangeStatus
} from '../types/agentChanges'
import { AGENT_CHANGES_LIST_LIMIT, isAgentChangeStatus as fromIndex } from '../types'

describe('isAgentChangeStatus', () => {
  it.each(AGENT_CHANGE_STATUSES)('%s は状態の文字', (status) => {
    expect(isAgentChangeStatus(status)).toBe(true)
  })

  it.each<[string, unknown]>([
    ['未追跡の印', '??'],
    ['小文字', 'm'],
    ['2 文字', 'MM'],
    ['リネーム(一覧はリネームを検出しない)', 'R'],
    ['空文字列', ''],
    ['数', 1],
    ['null', null],
    ['undefined', undefined]
  ])('%s は状態の文字ではない', (_label, value) => {
    expect(isAgentChangeStatus(value)).toBe(false)
  })
})

describe('共有の上限と再公開', () => {
  it('除外の閾値は diff の未追跡の上限(5MB)と同じ値', () => {
    expect(AGENT_BASELINE_EXCLUDE_FILE_BYTES).toBe(5 * 1024 * 1024)
  })

  it('types.ts から値と判定を使える', () => {
    expect(AGENT_CHANGES_LIST_LIMIT).toBe(500)
    expect(fromIndex('A')).toBe(true)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/shared/__tests__/agentChanges.test.ts 2>&1 | tail -n 5`
Expected: FAIL（`Failed to resolve import "../types/agentChanges"`）

- [ ] **Step 3: 型と上限を書く**

`src/shared/types/agentChanges.ts`（新規）:

```ts
// エージェントの変更の確認(記録・一覧・diff・戻す)の IPC の型と上限。main・preload・renderer が共有する

/** 一覧の行数の上限。超えた分は打ち切り、「すべて戻す」を使えなくする */
export const AGENT_CHANGES_LIST_LIMIT = 500
/** 記録の時点の未追跡(ignore されていない)のファイルの数の上限。超えると記録しない */
export const AGENT_BASELINE_MAX_UNTRACKED_FILES = 5_000
/** 記録の時点の未追跡のファイル(除外の後)の合計の大きさの上限(バイト)。超えると記録しない */
export const AGENT_BASELINE_MAX_UNTRACKED_BYTES = 100 * 1024 * 1024
/** これを超える大きさの未追跡のファイルは記録から除外する(バイト。diff の未追跡の上限と同じ値) */
export const AGENT_BASELINE_EXCLUDE_FILE_BYTES = 5 * 1024 * 1024
/** 記録・一覧・戻すの git の 1 回の打ち切り(出力が無いまま経った時間) */
export const AGENT_BASELINE_GIT_TIMEOUT_MS = 10_000

/**
 * 記録できない理由。not-repository: Git 管理外、not-toplevel: リポジトリのサブフォルダ、
 * too-many-untracked: 未追跡のファイルが多すぎる・大きすぎる、timeout: 記録の打ち切り、git-failed: git を実行できない
 */
export const AGENT_CHANGES_UNAVAILABLE_REASONS = [
  'not-repository',
  'not-toplevel',
  'too-many-untracked',
  'timeout',
  'git-failed'
] as const
export type AgentChangesUnavailableReason = (typeof AGENT_CHANGES_UNAVAILABLE_REASONS)[number]

/** 記録の状態(main の registry が真実の源)。startedAt は記録を始めた時刻(エポックミリ秒) */
export type AgentChangesState =
  | { kind: 'none' }
  | {
      kind: 'unavailable'
      reason: AgentChangesUnavailableReason
      /** too-many-untracked のときの未追跡のファイルの数・合計の大きさ(バイト) */
      untrackedCount?: number
      untrackedBytes?: number
    }
  | { kind: 'recording'; startedAt: number }

/** A: 追加、M: 変更、D: 削除、T: 種類の変更(ファイル ↔ リンク・サブモジュール) */
export const AGENT_CHANGE_STATUSES = ['A', 'M', 'D', 'T'] as const
export type AgentChangeStatus = (typeof AGENT_CHANGE_STATUSES)[number]

export function isAgentChangeStatus(value: unknown): value is AgentChangeStatus {
  return typeof value === 'string' && (AGENT_CHANGE_STATUSES as readonly string[]).includes(value)
}

export interface AgentChangeEntry {
  /** リポジトリ相対のパス(git の表記)。追加されたフォルダは末尾が '/' */
  path: string
  status: AgentChangeStatus
  /** 記録の後に作られたフォルダ(中身ごと 1 行にまとめたもの) */
  isDirectory: boolean
  /** 記録の時点に記録しなかった(大きすぎて除外した)ファイルを含む。戻せない */
  notRecorded: boolean
}

export type AgentChangesListResult =
  | { kind: 'none' }
  | {
      kind: 'recording'
      startedAt: number
      /** 先頭 AGENT_CHANGES_LIST_LIMIT 件(パスの順) */
      entries: AgentChangeEntry[]
      /** 打ち切る前の件数 */
      totalCount: number
      truncated: boolean
      /** 記録の時点から HEAD が変わったか */
      headChanged: boolean
    }

/** 「すべて戻す」の確認のときに見せた一覧の 1 件。main は実行時の一覧と完全一致で照合する */
export interface AgentRevertAllEntry {
  path: string
  status: AgentChangeStatus
}
```

`src/shared/types.ts` の変更:

```diff
--- a/src/shared/types.ts
+++ b/src/shared/types.ts
@@ -6,6 +6,7 @@ export type * from './types/cli'
 export type * from './types/history'
 export type * from './types/settings'
 export type * from './types/agentTerminal'
+export type * from './types/agentChanges'
 export { PROMPT_EXPORT_KIND } from './types/prompt'
 export { EXECUTION_TOOLS, CLI_ONLY_TOOL_IDS } from './types/cli'
 export {
@@ -27,4 +28,14 @@ export {
   isAgentStartCanceled,
   isAgentExitReason
 } from './types/agentTerminal'
+export {
+  AGENT_CHANGES_LIST_LIMIT,
+  AGENT_BASELINE_MAX_UNTRACKED_FILES,
+  AGENT_BASELINE_MAX_UNTRACKED_BYTES,
+  AGENT_BASELINE_EXCLUDE_FILE_BYTES,
+  AGENT_BASELINE_GIT_TIMEOUT_MS,
+  AGENT_CHANGES_UNAVAILABLE_REASONS,
+  AGENT_CHANGE_STATUSES,
+  isAgentChangeStatus
+} from './types/agentChanges'
 export { CONFLICT_CHOICES, TAG_KINDS } from './types/git'
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/shared/__tests__/agentChanges.test.ts 2>&1 | tail -n 5`
Expected: PASS（14 件）

- [ ] **Step 5: 確認コマンド**

```bash
npm run typecheck 2>&1 | tail -n 5
npx prettier --write src/shared/types/agentChanges.ts src/shared/types.ts src/shared/__tests__/agentChanges.test.ts
npx eslint src/shared/types/agentChanges.ts src/shared/types.ts src/shared/__tests__/agentChanges.test.ts
```

Expected: 型エラー 0・eslint の指摘 0

---

### Task 2: main: 共通部品の切り出し（挙動を変えない）

設計書「既存の破棄の再利用の範囲」の `patchFormatArgs` の切り出しと、`discardHunk` のパッチの検査の切り出し。差異 3 のとおり `discardFileChanges` は分けない。

**Files:**

- Create: `src/main/gitDiffArgs.ts`、`src/main/__tests__/gitDiffArgs.test.ts`
- Modify: `src/main/gitService.ts:20`（import）・`src/main/gitService.ts:213-232`（`patchFormatArgs` の定義とコメントを外す）・`src/main/gitService.ts:256-257`、`src/main/gitDiscardService.ts:69-104`（`verifyHunkPatch` を切り出す）・`src/main/gitDiscardService.ts:111`（`listPathsForMessage` を export）、`src/main/__tests__/gitDiscardService.test.ts`（import と、`describe('discardAllChanges'` の前に 2 つの describe を足す）

**Interfaces:**

- Consumes: なし
- Produces: `PATCH_FORMAT_ARGS: readonly string[]`（`gitDiffArgs.ts`）、`verifyHunkPatch(folderPath: string, filePath: string, patch: string): Promise<string>`（検査を通ったパッチからモード変更の行を取り除いたもの。合わなければ `PATCH_MISMATCH_MESSAGE` で reject）、`listPathsForMessage(paths: string[]): string`（`gitDiscardService.ts`）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/gitDiffArgs.test.ts`（新規）:

```ts
import { describe, it, expect } from 'vitest'
import { PATCH_FORMAT_ARGS } from '../gitDiffArgs'

describe('PATCH_FORMAT_ARGS', () => {
  it('外部 diff・textconv・色を打ち消し、a/ b/ の接頭辞を固定する', () => {
    expect(PATCH_FORMAT_ARGS).toEqual([
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--src-prefix=a/',
      '--dst-prefix=b/'
    ])
  })
})
```

`src/main/__tests__/gitDiscardService.test.ts` の変更:

```diff
--- a/src/main/__tests__/gitDiscardService.test.ts
+++ b/src/main/__tests__/gitDiscardService.test.ts
@@ -17,7 +17,13 @@ vi.mock('../gitDiscardClassifier', async (importOriginal) => ({
   classifyDiscardTarget: vi.fn()
 }))

-import { discardAllChanges, discardFileChanges, discardHunk } from '../gitDiscardService'
+import {
+  discardAllChanges,
+  discardFileChanges,
+  discardHunk,
+  listPathsForMessage,
+  verifyHunkPatch
+} from '../gitDiscardService'
 import { discardHunkPatch, listPatchPaths } from '../gitApply'
 import { classifyDiscardTarget } from '../gitDiscardClassifier'

@@ -247,6 +253,48 @@ describe('discardHunk', () => {
   })
 })

+// discardHunk から切り出したパッチの検査(エージェントの変更のハンクも使う)。拒否の網羅は上の discardHunk のテスト
+describe('verifyHunkPatch', () => {
+  const PATCH = [
+    'diff --git a/f.txt b/f.txt',
+    'old mode 100644',
+    'new mode 100755',
+    'index 1111111..2222222',
+    '--- a/f.txt',
+    '+++ b/f.txt',
+    '@@ -1 +1 @@',
+    '-a',
+    '+b',
+    ''
+  ].join('\n')
+
+  it('モード変更の行を取り除いたパッチを返し、順・逆の両方で対象を確かめる。逆適用はしない', async () => {
+    vi.mocked(listPatchPaths).mockResolvedValue(['f.txt'])
+    const stripped = PATCH.replace('old mode 100644\nnew mode 100755\n', '')
+    await expect(verifyHunkPatch('/project', 'f.txt', PATCH)).resolves.toBe(stripped)
+    expect(listPatchPaths).toHaveBeenCalledWith('/project', stripped, { reverse: false })
+    expect(listPatchPaths).toHaveBeenCalledWith('/project', stripped, { reverse: true })
+    expect(discardHunkPatch).not.toHaveBeenCalled()
+  })
+
+  it('対象が別のファイルなら拒否する', async () => {
+    vi.mocked(listPatchPaths).mockResolvedValue(['other.txt'])
+    await expect(verifyHunkPatch('/project', 'f.txt', PATCH)).rejects.toThrow(
+      'パッチの対象がファイルと一致しません'
+    )
+  })
+})
+
+describe('listPathsForMessage', () => {
+  it.each([
+    [['a'], 'a'],
+    [['a', 'b', 'c', 'd', 'e'], 'a、b、c、d、e'],
+    [['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'a、b、c、d、e、ほか 2 件']
+  ])('%j → %s', (paths, expected) => {
+    expect(listPathsForMessage(paths)).toBe(expected)
+  })
+})
+
 describe('discardAllChanges', () => {
   type State = DiscardTargetKind
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/gitDiffArgs.test.ts src/main/__tests__/gitDiscardService.test.ts 2>&1 | tail -n 5`
Expected: FAIL（`../gitDiffArgs` が無い・`verifyHunkPatch is not a function`）

- [ ] **Step 3: 切り出す**

`src/main/gitDiffArgs.ts`（新規。コメントは `gitService.ts:213-226` から移す）:

```ts
// diff の出力をパッチとして使える形に固定する引数。gitService.getDiff(ソース管理の diff)と agentChangesQuery
// (エージェントの変更の diff)が共有する(同じ規則の写しを作らない。パターン 88)。
// 利用者の gitconfig がそのまま効くため、パッチの形式を左右する設定を明示的にすべて打ち消す。いずれも実機で再現確認済み:
// - diff.noprefix=true: 出力に a/ b/ が付かず、gitApply の `git apply`(既定は -p1 = 先頭 1 階層を剥がす)が
//   "git diff header lacks filename information" で全ハンクのステージ/アンステージに失敗する
// - diff.external: パッチとして適用できない出力になる(--no-ext-diff)
// - textconv(.gitattributes の diff=<driver> + diff.<driver>.textconv): 変換後のテキストで diff が作られるため、変換結果が
//   同一だと「差分はありません」と表示され、異なる場合は実体と食い違うパッチが作られる。--no-ext-diff では無効化されない
//   ので --no-textconv が別途必要
// - color.ui / color.diff = always: パイプ出力でも ANSI エスケープが混入し、DiffView にエスケープ列が文字として表示され、
//   パッチも壊れる
// 未追跡ファイルの疑似 diff(buildUntrackedDiff)は常に a/ b/ を付けるので、揃えるべきはこちら側
export const PATCH_FORMAT_ARGS: readonly string[] = [
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--src-prefix=a/',
  '--dst-prefix=b/'
]
```

`src/main/gitService.ts` の変更:

```diff
--- a/src/main/gitService.ts
+++ b/src/main/gitService.ts
@@ -18,6 +18,7 @@ import {
   buildEmptyFileDiffMessage
 } from './gitDiffFormatter'
 import { toLiteralPathspec } from './gitPathParsing'
+import { PATCH_FORMAT_ARGS } from './gitDiffArgs'
 import { parseGitLogOutput } from './gitLogFormatter'
 import { parseWorktreeBranches } from './gitWorktreeParser'
 import { findConflictingBranchName } from '@shared/branchName'
@@ -210,27 +211,7 @@ export async function getDiff(
       throw convertFsAccessError(err, `ファイルが見つかりません: ${filePath}`, filePath)
     }
   }
-  // ユーザーの gitconfig がそのまま効くため、パッチの形式を左右する設定を
-  // 明示的にすべて打ち消す。いずれも実機で再現確認済み:
-  // - diff.noprefix=true: 出力に a/ b/ が付かず、gitApply の `git apply`
-  //   (既定は -p1 = 先頭1階層を剥がす)が "git diff header lacks filename
-  //   information" で全ハンクのステージ/アンステージに失敗する
-  // - diff.external: パッチとして適用できない出力になる(--no-ext-diff)
-  // - textconv(.gitattributes の diff=<driver> + diff.<driver>.textconv):
-  //   変換後のテキストで diff が作られるため、変換結果が同一だと「差分は
-  //   ありません」と表示され、異なる場合は実体と食い違うパッチが作られる。
-  //   --no-ext-diff では無効化されないので --no-textconv が別途必要
-  // - color.ui / color.diff = always: パイプ出力でも ANSI エスケープが混入し、
-  //   DiffView にエスケープ列が文字として表示され、パッチも壊れる
-  // 未追跡ファイルの疑似diff(buildUntrackedDiff)は常に a/ b/ を付けるので、
-  // 揃えるべきはこちら側
-  const patchFormatArgs = [
-    '--no-ext-diff',
-    '--no-textconv',
-    '--no-color',
-    '--src-prefix=a/',
-    '--dst-prefix=b/'
-  ]
+  // パッチの形式を左右する利用者の設定を打ち消す引数は gitDiffArgs.ts(エージェントの変更の diff と共有)
   const literalPathspec = toLiteralPathspec(filePath)
   // ステージ済みリネームは、新パスだけを pathspec に渡すと旧パス側が対象から
   // 外れるため git がリネーム検出を行わず、「新規ファイル + 全行追加」として
@@ -253,8 +234,8 @@ export async function getDiff(
   // (実機で再現確認済み)。--find-renames で設定に依存させない
   const renameArgs = isStagedRename ? ['--find-renames'] : []
   const args = staged
-    ? [...patchFormatArgs, '--cached', ...renameArgs, '-U3', '--', ...pathspecs]
-    : [...patchFormatArgs, '-U3', '--', ...pathspecs]
+    ? [...PATCH_FORMAT_ARGS, '--cached', ...renameArgs, '-U3', '--', ...pathspecs]
+    : [...PATCH_FORMAT_ARGS, '-U3', '--', ...pathspecs]
   return git.diff(args)
 }
```

`src/main/gitDiscardService.ts` の変更:

```diff
--- a/src/main/gitDiscardService.ts
+++ b/src/main/gitDiscardService.ts
@@ -66,11 +66,30 @@ export async function discardFileChanges(
   await applyDiscard(git, folderPath, kind, filePath, trash)
 }

+// 逆適用するパッチの検査。IPC の境界で届いた任意のパッチが、対象以外のファイルを書き換えないよう、許可リストで構造を
+// 検証し(rename / copy / 新規作成 / a と b の不一致などを拒否)、さらに git apply の解釈でも順方向・逆方向の両方で対象が
+// filePath 1 件だけであることを確かめる。chmod を伴う変更の old mode / new mode は取り除いた(内容だけが戻り、モードは残る)
+// パッチを返す。git apply --numstat は index を読まないため、エージェントの変更のハンク(agentChangesRevert)も同じ検査を使う
+export async function verifyHunkPatch(
+  folderPath: string,
+  filePath: string,
+  patch: string
+): Promise<string> {
+  assertHunkPatchTargets(patch, filePath)
+  const contentPatch = stripModeChangeLines(patch)
+  for (const reverse of [false, true]) {
+    const targets = await listPatchPaths(folderPath, contentPatch, { reverse }).catch(() => null)
+    if (targets === null || targets.length !== 1 || targets[0] !== filePath) {
+      throw new Error(PATCH_MISMATCH_MESSAGE)
+    }
+  }
+  return contentPatch
+}
+
 // 「変更」セクションのハンク単位の取り消し。作業ツリーだけへパッチを逆適用する(index は変わらない)。
 // - 分類はファイル単位と同じ classifyDiscardTarget を使う。ハンクで扱えるのは追跡済みだけ
 //   (未追跡・intent-to-add はファイルごとゴミ箱へ移す対象で、ハンクの粒度では取り消せない)
-// - IPC の境界で届いた任意のパッチが、対象以外のファイルを書き換えないよう、git apply に
-//   パッチの対象を列挙させて filePath 1 件だけであることを確かめる
+// - パッチの検査は verifyHunkPatch
 export async function discardHunk(
   folderPath: string,
   filePath: string,
@@ -82,17 +101,7 @@ export async function discardHunk(
   if (kind === 'untracked' || kind === 'intent-to-add') {
     throw new Error(`ゴミ箱へ移す対象のため、ハンクでは取り消せません: ${filePath}`)
   }
-  // 許可リストで構造を検証し(rename / copy / 新規作成 / a と b の不一致などを拒否)、さらに
-  // git apply の解釈でも順方向・逆方向の両方で対象が filePath 1 件だけであることを確かめる
-  assertHunkPatchTargets(patch, filePath)
-  // chmod を伴う変更の old mode / new mode は取り除いて適用する(内容だけが戻り、モードは残る)
-  const contentPatch = stripModeChangeLines(patch)
-  for (const reverse of [false, true]) {
-    const targets = await listPatchPaths(folderPath, contentPatch, { reverse }).catch(() => null)
-    if (targets === null || targets.length !== 1 || targets[0] !== filePath) {
-      throw new Error(PATCH_MISMATCH_MESSAGE)
-    }
-  }
+  const contentPatch = await verifyHunkPatch(folderPath, filePath, patch)
   try {
     await discardHunkPatch(folderPath, filePath, contentPatch)
   } catch (error) {
@@ -108,7 +117,8 @@ const MAX_LISTED_PATHS = 5
 // 確認時の一覧との照合キー。パスは NUL を含められない(-z の区切り)ため、NUL で区切れば衝突しない
 const toMatchKey = (status: string, path: string): string => `${status}\0${path}`

-function listPathsForMessage(paths: string[]): string {
+// 拒否したファイルの列挙(最大 5 件。超えた分は「ほか n 件」)。エージェントの変更の「すべて戻す」(agentChangesRevert)も使う
+export function listPathsForMessage(paths: string[]): string {
   const shown = paths.slice(0, MAX_LISTED_PATHS).join('、')
   const rest = paths.length - MAX_LISTED_PATHS
   return rest > 0 ? `${shown}、ほか ${rest} 件` : shown
```

- [ ] **Step 4: 通ることと、既存のテストが変わらず通ることを確かめる**

Run: `npx vitest run src/main/__tests__/gitDiffArgs.test.ts src/main/__tests__/gitService.test.ts src/main/__tests__/gitDiscardService.test.ts src/main/__tests__/gitDiscardService.integration.test.ts 2>&1 | tail -n 5`
Expected: PASS（既存の `gitService.test.ts` の `--no-ext-diff` を含む引数の期待がそのまま通る）

- [ ] **Step 5: 確認コマンド**

```bash
npm run typecheck 2>&1 | tail -n 5
npx prettier --write src/main/gitDiffArgs.ts src/main/gitService.ts src/main/gitDiscardService.ts src/main/__tests__/gitDiffArgs.test.ts src/main/__tests__/gitDiscardService.test.ts
npx eslint src/main/gitDiffArgs.ts src/main/gitService.ts src/main/gitDiscardService.ts src/main/__tests__/gitDiffArgs.test.ts src/main/__tests__/gitDiscardService.test.ts
grep -n "patchFormatArgs" src/main/gitService.ts
```

Expected: 型エラー 0・eslint 0・`patchFormatArgs` は 0 件

---

### Task 3: main: 記録のインデックスで問い合わせる git（`agentBaselineGit`）

**Files:**

- Create: `src/main/agentBaselineGit.ts`、`src/main/__tests__/agentBaselineGit.test.ts`
- Modify: `src/main/__tests__/helpers/realGitRepo.ts:97`（`isCaseInsensitiveFs` の前に `stubGitHome` を足す）

**Interfaces:**

- Consumes: `AGENT_BASELINE_GIT_TIMEOUT_MS`（Task 1）
- Produces: `SIMPLE_GIT_BLOCKED_ENV_KEYS: readonly string[]`、`buildBaselineGitEnv(source: NodeJS.ProcessEnv, indexPath: string): Record<string, string>`、`interface BaselineGitOptions { timeoutMs?: number; config?: string[]; env?: NodeJS.ProcessEnv }`、`createBaselineGit(folderPath: string, indexPath: string, options?: BaselineGitOptions): SimpleGit`、`createRepoGit(folderPath: string, options?: Pick<BaselineGitOptions, 'timeoutMs'>): SimpleGit`、テストの補助 `stubGitHome(dir: string): void`（`helpers/realGitRepo.ts`）
- 注: 除く変数の一覧は simple-git 3.36.0 の `@simple-git/argv-parser`（`node_modules/@simple-git/argv-parser/dist/index.cjs` の `y` の表）と同じ 18 個（差異 1）。版を上げて一覧が変わったら、`前提: 変数を除かずに env() へ渡すと simple-git が拒否する` のテストと一緒に見直す

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/helpers/realGitRepo.ts` の変更:

```diff
--- a/src/main/__tests__/helpers/realGitRepo.ts
+++ b/src/main/__tests__/helpers/realGitRepo.ts
@@ -94,6 +94,14 @@ export function stubGitCeiling(dir: string): void {
   vi.stubEnv('GIT_CEILING_DIRECTORIES', realpathSync(dir))
 }

+// 記録のインデックスで問い合わせる git(agentBaselineGit.ts)は、simple-git の env() の制限のため GIT_CONFIG_GLOBAL を子へ
+// 渡せない(外す)。その git が開発者の ~/.gitconfig・~/.config/git/* を読まないよう、HOME と XDG_CONFIG_HOME を dir に
+// する。stubIsolatedGitEnv と同じく afterEach の vi.unstubAllEnvs() で復元する
+export function stubGitHome(dir: string): void {
+  vi.stubEnv('HOME', dir)
+  vi.stubEnv('XDG_CONFIG_HOME', dir)
+}
+
 // ファイルシステムが大文字小文字を区別しないかを実測する(macOS・Windows の既定は区別しない)。
 // 区別する FS では 'a' と 'A' が別物になり、大文字小文字だけ違う配置を作るテストが成り立たない
 export function isCaseInsensitiveFs(): boolean {
```

`src/main/__tests__/agentBaselineGit.test.ts`（新規）:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import simpleGit from 'simple-git'
import {
  SIMPLE_GIT_BLOCKED_ENV_KEYS,
  buildBaselineGitEnv,
  createBaselineGit
} from '../agentBaselineGit'
import {
  commitAll,
  initRepo,
  stubGitHome,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'

describe('buildBaselineGitEnv', () => {
  it('simple-git が拒否する変数と位置の変数を外し、GIT_INDEX_FILE を記録のインデックスにする', () => {
    const env = buildBaselineGitEnv(
      {
        PATH: '/usr/bin',
        HOME: '/home/me',
        LANG: 'ja_JP.UTF-8',
        GIT_CONFIG_NOSYSTEM: '1',
        EDITOR: 'vim',
        GIT_ASKPASS: '/askpass',
        SSH_ASKPASS: '/askpass',
        PAGER: 'less',
        GIT_PAGER: 'less',
        GIT_SSH_COMMAND: 'ssh -i key',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.pager',
        GIT_CONFIG_VALUE_0: 'cat',
        GIT_DIR: '/elsewhere/.git',
        GIT_WORK_TREE: '/elsewhere',
        GIT_INDEX_FILE: '/elsewhere/.git/index',
        UNDEFINED_VALUE: undefined
      },
      '/tmp/baseline/index'
    )
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/me',
      LANG: 'ja_JP.UTF-8',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_INDEX_FILE: '/tmp/baseline/index'
    })
  })

  it('大文字小文字の違う変数名も外す(simple-git は小文字にして比べる)', () => {
    expect(buildBaselineGitEnv({ Editor: 'vim', git_askpass: '/a' }, '/i')).toEqual({
      GIT_INDEX_FILE: '/i'
    })
  })

  it.each(SIMPLE_GIT_BLOCKED_ENV_KEYS)('%s を外す', (key) => {
    expect(buildBaselineGitEnv({ [key.toUpperCase()]: 'x' }, '/i')).toEqual({
      GIT_INDEX_FILE: '/i'
    })
  })
})

// 実 git で、記録のインデックスで問い合わせられること・利用者の index に触れないことを確かめる
describe('createBaselineGit(実 git)', () => {
  let repo: string
  let home: string
  let indexDir: string

  beforeEach(() => {
    stubIsolatedGitEnv()
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'baseline-git-')))
    home = mkdtempSync(join(tmpdir(), 'baseline-git-home-'))
    indexDir = mkdtempSync(join(tmpdir(), 'baseline-git-index-'))
    stubGitHome(home)
    initRepo(repo)
    writeRepoFile(repo, 'a.txt', 'a\n')
    commitAll(repo, 'init')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    for (const dir of [repo, home, indexDir]) rmSync(dir, { recursive: true, force: true })
  })

  it('EDITOR・GIT_ASKPASS・GIT_DIR がある環境でも例外にならず、記録のインデックスで問い合わせる', async () => {
    const index = join(indexDir, 'index')
    copyFileSync(join(repo, '.git/index'), index)
    writeRepoFile(repo, 'new.txt', 'n\n')
    const userIndexBefore = readFileSync(join(repo, '.git/index'))
    const mtimeBefore = statSync(join(repo, '.git/index')).mtimeMs
    const git = createBaselineGit(repo, index, {
      env: {
        ...process.env,
        EDITOR: 'vim',
        GIT_ASKPASS: '/nonexistent/askpass',
        GIT_DIR: join(home, 'not-a-repo')
      }
    })
    await git.raw(['add', '-A'])
    const listed = await git.raw(['ls-files', '-z'])
    expect(listed.split('\0').filter((p) => p !== '')).toEqual(['a.txt', 'new.txt'])
    // 利用者の index には new.txt が無く、書き換わってもいない
    expect(readFileSync(join(repo, '.git/index'))).toEqual(userIndexBefore)
    expect(statSync(join(repo, '.git/index')).mtimeMs).toBe(mtimeBefore)
  })

  // 前提の固定: simple-git の env() に GIT_ASKPASS を含めると拒否される(除かないと使えない理由)
  it('前提: 変数を除かずに env() へ渡すと simple-git が拒否する', async () => {
    const git = simpleGit(repo).env({ PATH: process.env.PATH, GIT_ASKPASS: '/nonexistent/askpass' })
    await expect(git.raw(['ls-files'])).rejects.toThrow(
      'Use of "GIT_ASKPASS" is not permitted without enabling allowUnsafeAskPass'
    )
  })

  // 既知の制約の固定: GIT_CONFIG_GLOBAL は渡らず、HOME の .gitconfig を読む(テストは stubGitHome で隔離する)
  it('GIT_CONFIG_GLOBAL は子へ渡らず、HOME の設定(core.excludesFile)を読む', async () => {
    const excludes = join(home, 'excludes')
    writeFileSync(excludes, 'ignored-by-home.txt\n')
    writeFileSync(join(home, '.gitconfig'), `[core]\n\texcludesFile = ${excludes}\n`)
    writeRepoFile(repo, 'ignored-by-home.txt', 'x\n')
    const index = join(indexDir, 'index')
    const git = createBaselineGit(repo, index)
    const others = await git.raw(['ls-files', '-z', '--others', '--exclude-standard'])
    expect(others.split('\0')).not.toContain('ignored-by-home.txt')
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineGit.test.ts 2>&1 | tail -n 5`
Expected: FAIL（`../agentBaselineGit` が無い）

- [ ] **Step 3: 実装する**

`src/main/agentBaselineGit.ts`（新規）:

```ts
import simpleGit from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { AGENT_BASELINE_GIT_TIMEOUT_MS } from '@shared/types'

// 記録のインデックス(利用者の .git/index の写しに作業ツリーを入れたもの)で問い合わせる git を作る(設計書「確認の結果」14)。
// GIT_INDEX_FILE を渡すには simple-git の env() が要るが、env() は環境変数の中身を検査し、simple-git 3.36.0
// (@simple-git/argv-parser)が拒否する変数(EDITOR・GIT_ASKPASS など)が 1 つでもあると GitPluginError を投げる
// (gitService.ts の getLog のコメントと同じ現象。VS Code から起動すると GIT_ASKPASS が引き継がれる)。拒否される変数と、
// 利用者の別のリポジトリを指しうる位置の変数を除いた環境に、記録のインデックスの GIT_INDEX_FILE を足す。
// 既知の制約: 除く変数に GIT_CONFIG_GLOBAL・GIT_CONFIG_SYSTEM が含まれるため、この git は既定の場所の設定を読む

/** simple-git 3.36.0 の env() が拒否する変数(小文字。@simple-git/argv-parser の一覧と同じ 18 個) */
export const SIMPLE_GIT_BLOCKED_ENV_KEYS: readonly string[] = [
  'editor',
  'git_askpass',
  'git_config',
  'git_config_count',
  'git_config_global',
  'git_config_system',
  'git_editor',
  'git_exec_path',
  'git_external_diff',
  'git_pager',
  'git_proxy_command',
  'git_sequence_editor',
  'git_ssh',
  'git_ssh_command',
  'git_template_dir',
  'pager',
  'prefix',
  'ssh_askpass'
]

/** 利用者の別のリポジトリ・別のインデックスを指しうる変数(GIT_INDEX_FILE は記録のインデックスで置き換える) */
const REPO_LOCATION_ENV_KEYS: readonly string[] = ['git_dir', 'git_work_tree', 'git_index_file']

// GIT_CONFIG_COUNT を外すと読まれなくなる設定の組(GIT_CONFIG_KEY_n・GIT_CONFIG_VALUE_n)。残しても働かないが、外して揃える
const isConfigPairKey = (lower: string): boolean => /^git_config_(key|value)_\d+$/.test(lower)

/** source(既定は process.env)から除く変数を外し、GIT_INDEX_FILE を indexPath にした環境 */
export function buildBaselineGitEnv(
  source: NodeJS.ProcessEnv,
  indexPath: string
): Record<string, string> {
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
  env.GIT_INDEX_FILE = indexPath
  return env
}

export interface BaselineGitOptions {
  /** 出力が無いまま経ったら git を止める時間(simple-git の timeout.block)。テストで短くする */
  timeoutMs?: number
  /** `git -c` で渡す設定(diff の core.quotePath=false など) */
  config?: string[]
  /** 元にする環境変数。テストで差し替える */
  env?: NodeJS.ProcessEnv
}

/** 記録のインデックス indexPath で問い合わせる git。作業ツリーは folderPath(リポジトリの最上位) */
export function createBaselineGit(
  folderPath: string,
  indexPath: string,
  {
    timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS,
    config = [],
    env = process.env
  }: BaselineGitOptions = {}
): SimpleGit {
  return simpleGit(folderPath, { timeout: { block: timeoutMs }, config }).env(
    buildBaselineGitEnv(env, indexPath)
  )
}

/** 利用者の index で問い合わせる git(記録の HEAD・最上位の確認・コンフリクトの判定)。打ち切りだけを付ける */
export function createRepoGit(
  folderPath: string,
  { timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS }: Pick<BaselineGitOptions, 'timeoutMs'> = {}
): SimpleGit {
  return simpleGit(folderPath, { timeout: { block: timeoutMs } })
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineGit.test.ts 2>&1 | tail -n 5`
Expected: PASS（23 件）

- [ ] **Step 5: 変異で落ちることを確かめる**（Global Constraints の手順。表の「置き換え前」を「置き換え後」にして、テストのファイルで落ちることを見て戻す）

| #   | ファイル              | 置き換え前                                    | 置き換え後   | 落ちるテスト                                                                    |
| --- | --------------------- | --------------------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| A1  | `agentBaselineGit.ts` | `  'git_askpass',`（一覧の 1 行）             | （空行）     | `GIT_ASKPASS がある環境でも例外にならず`・`git_askpass を外す`                  |
| A2  | `agentBaselineGit.ts` | `  env.GIT_INDEX_FILE = indexPath`            | （空行）     | `記録のインデックスで問い合わせる`・`GIT_INDEX_FILE を記録のインデックスにする` |
| A3  | `agentBaselineGit.ts` | `REPO_LOCATION_ENV_KEYS.includes(lower) \|\|` | （空文字列） | `GIT_DIR がある環境でも`（GIT_DIR が残ると別のリポジトリを見る）                |

- [ ] **Step 6: 確認コマンド**

```bash
npx vitest run src/main/__tests__/helpers/realGitRepo.test.ts 2>&1 | tail -n 3
npm run typecheck 2>&1 | tail -n 5
npx prettier --write src/main/agentBaselineGit.ts src/main/__tests__/agentBaselineGit.test.ts src/main/__tests__/helpers/realGitRepo.ts
npx eslint src/main/agentBaselineGit.ts src/main/__tests__/agentBaselineGit.test.ts src/main/__tests__/helpers/realGitRepo.ts
```

---

### Task 4: main: 記録を取る（`agentBaselineSnapshot`）

**Files:**

- Create: `src/main/agentBaselineSnapshot.ts`、`src/main/__tests__/agentBaselineSnapshot.integration.test.ts`

**Interfaces:**

- Consumes: `createBaselineGit`・`createRepoGit`・`BaselineGitOptions`（Task 3）、`AGENT_BASELINE_*`・`AgentChangesState`（Task 1）、既存の `parseNulSeparatedPaths`（`gitPathParsing.ts:3`）・`isGitTimeoutError`（`gitStepErrors.ts:9`）
- Produces: `interface ExcludedBaselineFile { path: string; size: number; mtimeMs: number }`、`interface BaselineSnapshot { folderPath; tempDir; indexPath; startedAt: number; head: string | null; excluded: ExcludedBaselineFile[] }`、`type AgentChangesUnavailable = Extract<AgentChangesState, { kind: 'unavailable' }>`、`type BaselineSnapshotResult = { kind: 'recorded'; snapshot } | { kind: 'unavailable'; state: AgentChangesUnavailable } | { kind: 'canceled' }`、`interface TakeBaselineOptions extends BaselineGitOptions { isCanceled?: () => boolean; now?: () => number; tempRoot?: string }`、`takeBaselineSnapshot(folderPath: string, options?: TakeBaselineOptions): Promise<BaselineSnapshotResult>`、`removeBaselineDir(tempDir: string): Promise<void>`、`removeBaselineDirSync(tempDir: string): void`
- 注: 手順は設計書「データフロー」3 のとおり。除外の pathspec は `--pathspec-from-file`（一時ディレクトリのファイル。`wx`）で渡す（差異 5）。`isCanceled` は 8 か所の await の後で見る（テストで 8 か所すべてを固定する）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/agentBaselineSnapshot.integration.test.ts`（新規。確認の結果 2・6・15 の回帰、打ち切り、取り消し）:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { takeBaselineSnapshot } from '../agentBaselineSnapshot'
import type { BaselineSnapshot, BaselineSnapshotResult } from '../agentBaselineSnapshot'
import { createBaselineGit } from '../agentBaselineGit'
import {
  commitAll,
  initRepo,
  killRecordedProcess,
  runGit,
  stubGitHome,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'

let repo: string
let home: string
let tempRoot: string
const write = (path: string, content: string): void => writeRepoFile(repo, path, content)

beforeEach(() => {
  stubIsolatedGitEnv()
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'baseline-snapshot-')))
  home = mkdtempSync(join(tmpdir(), 'baseline-snapshot-home-'))
  tempRoot = mkdtempSync(join(tmpdir(), 'baseline-snapshot-temp-'))
  stubGitHome(home)
  initRepo(repo)
})

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of [repo, home, tempRoot]) rmSync(dir, { recursive: true, force: true })
})

const recorded = (result: BaselineSnapshotResult): BaselineSnapshot => {
  if (result.kind !== 'recorded') throw new Error(`記録できなかった: ${JSON.stringify(result)}`)
  return result.snapshot
}

const baselinePaths = async (snapshot: BaselineSnapshot): Promise<string[]> =>
  (await createBaselineGit(repo, snapshot.indexPath).raw(['ls-files', '-z']))
    .split('\0')
    .filter((path) => path !== '')

// 利用者の状態(index の更新時刻〈ナノ秒〉と内容・stash・ref・HEAD・status)
const userState = (): unknown => ({
  indexMtimeNs: statSync(join(repo, '.git/index'), { bigint: true }).mtimeNs,
  index: readFileSync(join(repo, '.git/index')).toString('base64'),
  stash: runGit(repo, 'stash', 'list'),
  refs: runGit(repo, 'for-each-ref'),
  head: runGit(repo, 'rev-parse', 'HEAD')
})

describe('takeBaselineSnapshot(実 git)', () => {
  it('利用者の index・stash・ref・HEAD を変えずに、未コミットの変更と未追跡を含めて記録する(確認の結果 2)', async () => {
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    write('.gitignore', 'ignored/\n')
    commitAll(repo, 'init')
    write('a.txt', 'a\nunstaged\n')
    write('b.txt', 'b\nstaged\n')
    runGit(repo, 'add', 'b.txt')
    write('user-untracked.txt', 'u\n')
    write('ignored/x', 'x\n')
    runGit(repo, 'status', '--porcelain')
    const before = userState()
    const snapshot = recorded(await takeBaselineSnapshot(repo, { tempRoot, now: () => 1234 }))
    expect(userState()).toEqual(before)
    expect(await baselinePaths(snapshot)).toEqual([
      '.gitignore',
      'a.txt',
      'b.txt',
      'user-untracked.txt'
    ])
    expect(snapshot).toMatchObject({
      folderPath: repo,
      startedAt: 1234,
      head: runGit(repo, 'rev-parse', 'HEAD').trim(),
      excluded: []
    })
    // 記録のインデックスはアプリの一時ディレクトリ(0700)にあり、.git の中には無い
    expect(snapshot.tempDir.startsWith(tempRoot)).toBe(true)
    expect(statSync(snapshot.tempDir).mode & 0o777).toBe(0o700)
    expect(existsSync(snapshot.indexPath)).toBe(true)
  })

  it('Git 管理外のフォルダは not-repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'baseline-plain-'))
    try {
      const result = await takeBaselineSnapshot(plain, { tempRoot })
      expect(result).toEqual({
        kind: 'unavailable',
        state: { kind: 'unavailable', reason: 'not-repository' }
      })
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it('リポジトリのサブフォルダは not-toplevel', async () => {
    write('sub/a.txt', 'a\n')
    commitAll(repo, 'init')
    const result = await takeBaselineSnapshot(join(repo, 'sub'), { tempRoot })
    expect(result).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'not-toplevel' }
    })
  })

  it('コミットが無いリポジトリ(.git/index が無い)でも記録でき、HEAD は null(確認の結果 15)', async () => {
    write('a.txt', 'a\n')
    const snapshot = recorded(await takeBaselineSnapshot(repo, { tempRoot }))
    expect(snapshot.head).toBeNull()
    expect(await baselinePaths(snapshot)).toEqual(['a.txt'])
    expect(existsSync(join(repo, '.git/index'))).toBe(false)
  })

  it('入れ子のリポジトリは gitlink(mode 160000)として記録する', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const nested = join(repo, 'sub')
    mkdirSync(nested)
    initRepo(nested)
    writeRepoFile(nested, 's.txt', 's\n')
    commitAll(nested, 's')
    const snapshot = recorded(await takeBaselineSnapshot(repo, { tempRoot }))
    const staged = await createBaselineGit(repo, snapshot.indexPath).raw(['ls-files', '-s', 'sub'])
    expect(staged.startsWith('160000 ')).toBe(true)
  })

  it('worktree(.git がファイル)では、その worktree の index を写す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const worktree = join(realpathSync(tempRoot), 'wt')
    runGit(repo, 'worktree', 'add', '-q', worktree)
    writeRepoFile(worktree, 'w.txt', 'w\n')
    const snapshot = recorded(await takeBaselineSnapshot(worktree, { tempRoot }))
    const listed = await createBaselineGit(worktree, snapshot.indexPath).raw(['ls-files', '-z'])
    expect(listed.split('\0').filter((p) => p !== '')).toEqual(['a.txt', 'w.txt'])
  })

  it('5MB を超える未追跡のファイルは記録から除外し、大きさと更新時刻を控える', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('big.bin', '')
    truncateSync(join(repo, 'big.bin'), 6 * 1024 * 1024)
    write('small.txt', 's\n')
    const snapshot = recorded(await takeBaselineSnapshot(repo, { tempRoot }))
    expect(await baselinePaths(snapshot)).toEqual(['a.txt', 'small.txt'])
    const stat = statSync(join(repo, 'big.bin'))
    expect(snapshot.excluded).toEqual([
      { path: 'big.bin', size: 6 * 1024 * 1024, mtimeMs: stat.mtimeMs }
    ])
  })

  it('未追跡のファイルが 5,000 件を超えると記録せず、件数を返す', async () => {
    mkdirSync(join(repo, 'many'))
    for (let i = 0; i <= 5_000; i++) writeFileSync(join(repo, 'many', `${i}.txt`), '')
    const result = await takeBaselineSnapshot(repo, { tempRoot })
    expect(result).toEqual({
      kind: 'unavailable',
      state: {
        kind: 'unavailable',
        reason: 'too-many-untracked',
        untrackedCount: 5_001,
        untrackedBytes: 0
      }
    })
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it('除外の後の未追跡の合計が 100MB を超えると記録せず、件数と合計を返す', async () => {
    // 5MB ちょうど(除外しない)の疎なファイルを 21 個 = 105MB
    for (let i = 0; i < 21; i++) {
      write(`f${i}.bin`, '')
      truncateSync(join(repo, `f${i}.bin`), 5 * 1024 * 1024)
    }
    const result = await takeBaselineSnapshot(repo, { tempRoot })
    expect(result).toEqual({
      kind: 'unavailable',
      state: {
        kind: 'unavailable',
        reason: 'too-many-untracked',
        untrackedCount: 21,
        untrackedBytes: 21 * 5 * 1024 * 1024
      }
    })
  })

  it('git add が打ち切りの時間を超えたら timeout を返し、一時ディレクトリを消す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const pidFile = join(home, 'filter.pid')
    // clean filter(LFS などと同じ仕組み)が止まったままの状況を作る
    runGit(repo, 'config', 'filter.slow.clean', `sh -c 'echo $$ > ${pidFile}; exec sleep 5'`)
    write('.gitattributes', '*.slow filter=slow\n')
    write('x.slow', 'x\n')
    try {
      const result = await takeBaselineSnapshot(repo, { tempRoot, timeoutMs: 300 })
      expect(result).toEqual({
        kind: 'unavailable',
        state: { kind: 'unavailable', reason: 'timeout' }
      })
      expect(readdirSync(tempRoot)).toEqual([])
    } finally {
      await killRecordedProcess(pidFile, 1_000)
    }
  })

  it('git を実行できなければ git-failed', async () => {
    vi.stubEnv('PATH', join(home, 'no-bin'))
    const result = await takeBaselineSnapshot(repo, { tempRoot })
    expect(result).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'git-failed' }
    })
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    '%i 回目の確認で取り消されたら canceled を返し、一時ディレクトリを残さない(パターン 141)',
    async (cancelAt) => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      let calls = 0
      const result = await takeBaselineSnapshot(repo, {
        tempRoot,
        isCanceled: () => ++calls >= cancelAt
      })
      expect(result).toEqual({ kind: 'canceled' })
      expect(readdirSync(tempRoot)).toEqual([])
    }
  )

  // 確認は 8 か所(リポジトリか・最上位・未追跡の検査・index の場所・写し・pathspec の書き込み・add・HEAD の後)。取り消されなければ記録が返る
  it('8 回の確認のどれでも取り消されなければ記録を返す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    let calls = 0
    const result = await takeBaselineSnapshot(repo, { tempRoot, isCanceled: () => ++calls >= 9 })
    expect(result.kind).toBe('recorded')
    expect(calls).toBe(8)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineSnapshot.integration.test.ts 2>&1 | tail -n 5`
Expected: FAIL（`../agentBaselineSnapshot` が無い）

- [ ] **Step 3: 実装する**

`src/main/agentBaselineSnapshot.ts`（新規）:

```ts
import { constants as fsConstants } from 'node:fs'
import { copyFile, lstat, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { AgentChangesState } from '@shared/types'
import {
  AGENT_BASELINE_EXCLUDE_FILE_BYTES,
  AGENT_BASELINE_MAX_UNTRACKED_BYTES,
  AGENT_BASELINE_MAX_UNTRACKED_FILES
} from '@shared/types'
import { createBaselineGit, createRepoGit } from './agentBaselineGit'
import type { BaselineGitOptions } from './agentBaselineGit'
import { parseNulSeparatedPaths } from './gitPathParsing'
import { isGitTimeoutError } from './gitStepErrors'

// エージェントの実行の前の作業ツリーを、利用者の index・stash・HEAD を変えずに記録する(設計書「記録の中身」)。
// .git/index をアプリの一時ディレクトリ(0700)へ写し、GIT_INDEX_FILE をその写しにして `git add -A` する(確認の結果 2)。
// 記録のインデックスは消さずに残し、一覧・diff・戻すが GIT_INDEX_FILE で使う(確認の結果 5)。.git の中には置かない

/** 記録の時点に大きすぎて除外した未追跡のファイル。一覧で変わったかを見るため、大きさと更新時刻を控える */
export interface ExcludedBaselineFile {
  path: string
  size: number
  mtimeMs: number
}

/** 1 つの記録。renderer には渡さない(場所を IPC に出さない。パターン 144) */
export interface BaselineSnapshot {
  /** 記録を取ったときの許可のフォルダ(リポジトリの最上位) */
  folderPath: string
  /** 記録のインデックスを置いた一時ディレクトリ。記録を捨てるときに消す */
  tempDir: string
  indexPath: string
  startedAt: number
  /** 記録の時点の HEAD(コミットが無ければ null) */
  head: string | null
  excluded: ExcludedBaselineFile[]
}

export type AgentChangesUnavailable = Extract<AgentChangesState, { kind: 'unavailable' }>

export type BaselineSnapshotResult =
  | { kind: 'recorded'; snapshot: BaselineSnapshot }
  | { kind: 'unavailable'; state: AgentChangesUnavailable }
  /** 待つ間に記録が取り消された(フォルダの切り替え・記録の破棄・アプリの終了)。一時ディレクトリは消してある */
  | { kind: 'canceled' }

export interface TakeBaselineOptions extends BaselineGitOptions {
  /** await のたびに呼び、true なら一時ディレクトリを消して canceled を返す(パターン 141) */
  isCanceled?: () => boolean
  now?: () => number
  /** 一時ディレクトリの親(既定は OS の一時ディレクトリ)。テストで差し替える */
  tempRoot?: string
}

const TEMP_DIR_PREFIX = 'prompt-ide-agent-baseline-'

class SnapshotCanceled extends Error {}

/** 記録の一時ディレクトリを消す(失敗は握る。残ったものは OS の一時ディレクトリの掃除に任せる) */
export async function removeBaselineDir(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
}

/** アプリの終了(before-quit)で、待たずに消す */
export function removeBaselineDirSync(tempDir: string): void {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // 消せなかったものは OS の一時ディレクトリの掃除に任せる
  }
}

// git rev-parse --show-toplevel・mkdtemp などのパスの表記を揃える(macOS の /var → /private/var など)
const canonical = async (path: string): Promise<string> => realpath(path).catch(() => path)

/** 記録の前の検査: 未追跡(ignore されていない)のファイルの数・大きさ。大きいファイルは除外の対象として返す */
async function inspectUntracked(
  folderPath: string,
  output: string
): Promise<
  | { kind: 'ok'; excluded: ExcludedBaselineFile[] }
  | { kind: 'too-many'; count: number; bytes: number }
> {
  const paths = parseNulSeparatedPaths(output)
  if (paths.length > AGENT_BASELINE_MAX_UNTRACKED_FILES) {
    return { kind: 'too-many', count: paths.length, bytes: 0 }
  }
  const excluded: ExcludedBaselineFile[] = []
  let bytes = 0
  for (const path of paths) {
    // 入れ子のリポジトリ('sub/')は gitlink として記録され、中身は数えない
    if (path.endsWith('/')) continue
    const stat = await lstat(join(folderPath, path)).catch(() => null)
    if (stat === null || !stat.isFile()) continue
    if (stat.size > AGENT_BASELINE_EXCLUDE_FILE_BYTES) {
      excluded.push({ path, size: stat.size, mtimeMs: stat.mtimeMs })
    } else {
      bytes += stat.size
    }
  }
  if (bytes > AGENT_BASELINE_MAX_UNTRACKED_BYTES) {
    return { kind: 'too-many', count: paths.length, bytes }
  }
  return { kind: 'ok', excluded }
}

/**
 * 記録を取る。手順: リポジトリの最上位か → 未追跡の事前の検査 → 一時ディレクトリ → .git/index の写し(無ければ空)→
 * `git add -A`(除外したファイルを pathspec で外す)→ HEAD を控える。各 git に打ち切り(既定 10 秒)
 */
export async function takeBaselineSnapshot(
  folderPath: string,
  {
    isCanceled = () => false,
    now = Date.now,
    tempRoot = tmpdir(),
    ...gitOptions
  }: TakeBaselineOptions = {}
): Promise<BaselineSnapshotResult> {
  const startedAt = now()
  const repoGit = createRepoGit(folderPath, gitOptions)
  let tempDir: string | null = null
  const checkpoint = (): void => {
    if (isCanceled()) throw new SnapshotCanceled()
  }
  try {
    const isRepo = await repoGit.checkIsRepo()
    checkpoint()
    if (!isRepo)
      return { kind: 'unavailable', state: { kind: 'unavailable', reason: 'not-repository' } }
    const toplevel = (await repoGit.raw(['rev-parse', '--show-toplevel'])).trim()
    checkpoint()
    if ((await canonical(toplevel)) !== (await canonical(folderPath))) {
      return { kind: 'unavailable', state: { kind: 'unavailable', reason: 'not-toplevel' } }
    }
    const inspection = await inspectUntracked(
      folderPath,
      await repoGit.raw(['ls-files', '-z', '--others', '--exclude-standard'])
    )
    checkpoint()
    if (inspection.kind === 'too-many') {
      return {
        kind: 'unavailable',
        state: {
          kind: 'unavailable',
          reason: 'too-many-untracked',
          untrackedCount: inspection.count,
          untrackedBytes: inspection.bytes
        }
      }
    }
    tempDir = await mkdtemp(join(tempRoot, TEMP_DIR_PREFIX))
    const indexPath = join(tempDir, 'index')
    // worktree の .git はファイルのため、index の場所は git に聞く(相対ならリポジトリの最上位から)
    const userIndex = (await repoGit.raw(['rev-parse', '--git-path', 'index'])).trim()
    checkpoint()
    // 写しから始めると stat の情報が使え、変わっていないファイルを読み直さない。コミットの無いリポジトリは index が無く、
    // 空から始める(確認の結果 15)
    await copyFile(
      isAbsolute(userIndex) ? userIndex : join(folderPath, userIndex),
      indexPath,
      fsConstants.COPYFILE_EXCL
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    checkpoint()
    // 除外の pathspec は数が多くても引数の長さの上限に触れないよう、一時ディレクトリのファイルで渡す
    const pathspecFile = join(tempDir, 'pathspec')
    const pathspecs = ['.', ...inspection.excluded.map((file) => `:(exclude,literal)${file.path}`)]
    await writeFile(pathspecFile, pathspecs.map((spec) => `${spec}\0`).join(''), { flag: 'wx' })
    checkpoint()
    const baselineGit = createBaselineGit(folderPath, indexPath, {
      ...gitOptions,
      config: ['advice.addEmbeddedRepo=false']
    })
    await baselineGit.raw([
      'add',
      '-A',
      `--pathspec-from-file=${pathspecFile}`,
      '--pathspec-file-nul'
    ])
    checkpoint()
    const head = await repoGit
      .raw(['rev-parse', '--verify', '-q', 'HEAD'])
      .then((output) => output.trim() || null)
      .catch(() => null)
    checkpoint()
    return {
      kind: 'recorded',
      snapshot: {
        folderPath,
        tempDir,
        indexPath,
        startedAt,
        head,
        excluded: inspection.excluded
      }
    }
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

- [ ] **Step 4: 通ることと、プロセスが残らないことを確かめる**

```bash
npx vitest run src/main/__tests__/agentBaselineSnapshot.integration.test.ts 2>&1 | tail -n 5
pgrep -fl "exec sleep 5"
```

Expected: PASS（20 件）。`pgrep` は何も出さない（打ち切りのテストの clean filter の `sleep` は `killRecordedProcess` で止めている）

- [ ] **Step 5: 変異で落ちることを確かめる**

例（A1）:

```bash
BK="$(mktemp -d)"; F=src/main/agentBaselineSnapshot.ts; cp "$F" "$BK/"
cat > "$BK/mut.py" <<'EOF'
import sys
p, o, n = sys.argv[1:]
s = open(p).read()
assert s.count(o) == 1, s.count(o)
open(p, 'w').write(s.replace(o, n))
EOF
python3 "$BK/mut.py" "$F" "    if ((await canonical(toplevel)) !== (await canonical(folderPath))) {" "    if (false) {"
npx vitest run src/main/__tests__/agentBaselineSnapshot.integration.test.ts 2>&1 | grep "Tests "
cp "$BK/agentBaselineSnapshot.ts" "$F"; cmp "$F" "$BK/agentBaselineSnapshot.ts" && echo restored
```

| #   | 置き換え前                                                                               | 置き換え後                           | 落ちるテスト                                                               |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| A1  | `    if ((await canonical(toplevel)) !== (await canonical(folderPath))) {`               | `    if (false) {`                   | `リポジトリのサブフォルダは not-toplevel`                                  |
| A2  | `    if (stat.size > AGENT_BASELINE_EXCLUDE_FILE_BYTES) {`                               | `    if (false) {`                   | `5MB を超える未追跡のファイルは記録から除外`                               |
| A3  | `  if (bytes > AGENT_BASELINE_MAX_UNTRACKED_BYTES) {`                                    | `  if (false) {`                     | `合計が 100MB を超えると記録せず`                                          |
| A4  | `    if (tempDir !== null) await removeBaselineDir(tempDir)`                             | （空行）                             | `取り消されたら canceled を返し`・`timeout を返し、一時ディレクトリを消す` |
| A5  | `    const userIndex = (await repoGit.raw(['rev-parse', '--git-path', 'index'])).trim()` | `    const userIndex = '.git/index'` | `worktree(.git がファイル)では`                                            |

- [ ] **Step 6: 確認コマンド**

```bash
npm run typecheck 2>&1 | tail -n 5
npx prettier --write src/main/agentBaselineSnapshot.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts
npx eslint src/main/agentBaselineSnapshot.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts
```

---

### Task 5: main: 一覧と diff（`agentChangesQuery`）

**Files:**

- Create: `src/main/agentChangesQuery.ts`、`src/main/__tests__/agentChangesQuery.integration.test.ts`

**Interfaces:**

- Consumes: `BaselineSnapshot`・`takeBaselineSnapshot`（Task 4）、`createBaselineGit`・`createRepoGit`・`BaselineGitOptions`（Task 3）、`PATCH_FORMAT_ARGS`（Task 2）、既存の `getDiff`（`gitService.ts:145`。未追跡の疑似 diff に使う）・`parseNulSeparatedPaths`・`toLiteralPathspec`
- Produces: `interface AgentChangesList { entries: AgentChangeEntry[]; totalCount: number; truncated: boolean; headChanged: boolean }`、`collectAgentChangeEntries(snapshot, options?): Promise<AgentChangeEntry[]>`（打ち切らない。パスの順）、`listAgentChanges(snapshot, options?): Promise<AgentChangesList>`、`buildAddedFolderDiffMessage(fileCount: number): string`、`getAgentChangeDiff(snapshot, filePath: string, options?): Promise<string>`（`filePath` は末尾の `/` を落としたリポジトリ相対のパス）
- 注: `git diff --name-status` は porcelain の `diff`（stat が古いだけのファイルを出さない）。`diff-files` は使わない。記録しなかったファイル（`excluded`）は大きさと更新時刻が控えと同じなら出さず、違えば `M`・消えたら `D`（どちらも `notRecorded`）、中にそれを含む新しいフォルダの行も `notRecorded`（差異 4）。記録の時点のファイルが同名のフォルダに置き換わると、フォルダの中身は一覧に出ない（`D` の 1 行だけ。差異 6）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/agentChangesQuery.integration.test.ts`（新規。確認の結果 3〜5 の回帰・打ち切り・`--directory`・`notRecorded`）:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { takeBaselineSnapshot } from '../agentBaselineSnapshot'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import {
  buildAddedFolderDiffMessage,
  getAgentChangeDiff,
  listAgentChanges
} from '../agentChangesQuery'
import {
  commitAll,
  initRepo,
  runGit,
  stubGitHome,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'

let repo: string
let home: string
let tempRoot: string
const write = (path: string, content: string): void => writeRepoFile(repo, path, content)

beforeEach(() => {
  stubIsolatedGitEnv()
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'agent-changes-query-')))
  home = mkdtempSync(join(tmpdir(), 'agent-changes-query-home-'))
  tempRoot = mkdtempSync(join(tmpdir(), 'agent-changes-query-temp-'))
  stubGitHome(home)
  initRepo(repo)
})

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of [repo, home, tempRoot]) rmSync(dir, { recursive: true, force: true })
})

const record = async (): Promise<BaselineSnapshot> => {
  const result = await takeBaselineSnapshot(repo, { tempRoot })
  if (result.kind !== 'recorded') throw new Error(`記録できなかった: ${JSON.stringify(result)}`)
  return result.snapshot
}

const userIndexState = (): unknown => ({
  mtimeNs: statSync(join(repo, '.git/index'), { bigint: true }).mtimeNs,
  content: readFileSync(join(repo, '.git/index')).toString('base64')
})

const entry = (
  path: string,
  status: 'A' | 'M' | 'D' | 'T',
  extra: { isDirectory?: boolean; notRecorded?: boolean } = {}
): unknown => ({ path, status, isDirectory: false, notRecorded: false, ...extra })

describe('listAgentChanges(実 git)', () => {
  it('実行の前からの利用者の変更を出さず、エージェントの変更だけを出す。利用者の index を変えない(確認の結果 3・5)', async () => {
    write('a.txt', 'a1\na2\na3\n')
    write('b.txt', 'b\n')
    write('c.txt', 'c\n')
    write('d.txt', 'd1\nd2\nd3\nd4\nd5\nd6\nd7\nd8\n')
    write('.gitignore', 'ignored/\n')
    commitAll(repo, 'init')
    // 利用者の実行の前の変更(未ステージ・ステージ済み・未追跡)
    write('a.txt', 'a1\na2\na3\nunstaged\n')
    write('b.txt', 'b\nstaged\n')
    runGit(repo, 'add', 'b.txt')
    write('user-untracked.txt', 'u\n')
    runGit(repo, 'status', '--porcelain')
    const snapshot = await record()
    // エージェントの変更
    write('a.txt', 'a1\na2\na3\nunstaged\nagent\n')
    write('d.txt', 'd1\nd2\nd3\nD4\nd5\nd6\nd7\nd8\n')
    unlinkSync(join(repo, 'c.txt'))
    renameSync(join(repo, 'user-untracked.txt'), join(repo, 'moved.txt'))
    write('new.txt', 'n\n')
    write('newdir/x', '1\n')
    write('newdir/y', '2\n')
    mkdirSync(join(repo, 'emptydir'))
    write('ignored/gen', 'g\n')
    const before = userIndexState()
    const list = await listAgentChanges(snapshot)
    expect(list).toEqual({
      entries: [
        entry('a.txt', 'M'),
        entry('c.txt', 'D'),
        entry('d.txt', 'M'),
        entry('moved.txt', 'A'),
        entry('new.txt', 'A'),
        entry('newdir/', 'A', { isDirectory: true }),
        entry('user-untracked.txt', 'D')
      ],
      totalCount: 7,
      truncated: false,
      headChanged: false
    })
    // a.txt の diff はエージェントの行だけ(実行の前の unstaged は文脈の行)
    const diff = await getAgentChangeDiff(snapshot, 'a.txt')
    expect(diff.split('\n').filter((line) => /^[+-][^+-]/.test(line))).toEqual(['+agent'])
    expect(diff).toContain(' unstaged')
    expect(userIndexState()).toEqual(before)
  })

  it('内容が同じまま更新時刻だけ変わったファイルは出さない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const snapshot = await record()
    utimesSync(join(repo, 'a.txt'), new Date(), new Date(Date.now() + 5_000))
    expect((await listAgentChanges(snapshot)).entries).toEqual([])
  })

  it('記録の時点からの種類の変更(ファイル → リンク)は T、入れ子のリポジトリのコミットは M', async () => {
    write('a.txt', 'a\n')
    write('target.txt', 't\n')
    commitAll(repo, 'init')
    const nested = join(repo, 'sub')
    mkdirSync(nested)
    initRepo(nested)
    writeRepoFile(nested, 's.txt', 's\n')
    commitAll(nested, 's')
    const snapshot = await record()
    unlinkSync(join(repo, 'a.txt'))
    symlinkSync('target.txt', join(repo, 'a.txt'))
    writeRepoFile(nested, 't.txt', 't\n')
    commitAll(nested, 't')
    expect((await listAgentChanges(snapshot)).entries).toEqual([
      entry('a.txt', 'T'),
      entry('sub', 'M')
    ])
  })

  it('記録の後に HEAD が変わったら headChanged(コミットしても内容が記録と違えば一覧に残る)', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const snapshot = await record()
    write('a.txt', 'agent\n')
    commitAll(repo, 'agent')
    expect(await listAgentChanges(snapshot)).toMatchObject({
      entries: [entry('a.txt', 'M')],
      headChanged: true
    })
  })

  it('500 件で打ち切り、全件数を返す', async () => {
    write('many/keep.txt', 'k\n')
    commitAll(repo, 'init')
    const snapshot = await record()
    for (let i = 0; i < 501; i++)
      writeFileSync(join(repo, 'many', `${String(i).padStart(3, '0')}.txt`), '')
    const list = await listAgentChanges(snapshot)
    expect(list.entries).toHaveLength(500)
    expect(list.totalCount).toBe(501)
    expect(list.truncated).toBe(true)
    expect(list.entries[0].path).toBe('many/000.txt')
  })

  describe('記録しなかった(5MB を超える)未追跡のファイル', () => {
    const big = 6 * 1024 * 1024

    it('変わっていなければ出さない', async () => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      write('big.bin', '')
      truncateSync(join(repo, 'big.bin'), big)
      const snapshot = await record()
      expect((await listAgentChanges(snapshot)).entries).toEqual([])
    })

    it('変わったら M、消えたら D で、どちらも notRecorded', async () => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      write('big1.bin', '')
      truncateSync(join(repo, 'big1.bin'), big)
      write('big2.bin', '')
      truncateSync(join(repo, 'big2.bin'), big)
      const snapshot = await record()
      truncateSync(join(repo, 'big1.bin'), big + 1)
      unlinkSync(join(repo, 'big2.bin'))
      expect((await listAgentChanges(snapshot)).entries).toEqual([
        entry('big1.bin', 'M', { notRecorded: true }),
        entry('big2.bin', 'D', { notRecorded: true })
      ])
    })

    it('記録の時点で未追跡のフォルダの中にあったら、そのフォルダの行を notRecorded にする', async () => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      write('out/big.bin', '')
      truncateSync(join(repo, 'out/big.bin'), big)
      const snapshot = await record()
      expect((await listAgentChanges(snapshot)).entries).toEqual([
        entry('out/', 'A', { isDirectory: true, notRecorded: true })
      ])
    })
  })
})

describe('getAgentChangeDiff(実 git)', () => {
  it('記録の後に作られたファイルは未追跡の疑似 diff、フォルダは件数の 1 行、削除は削除の diff', async () => {
    write('a.txt', 'a\n')
    write('gone.txt', 'g\n')
    commitAll(repo, 'init')
    const snapshot = await record()
    write('new.txt', 'n1\nn2\n')
    write('newdir/x', '1\n')
    write('newdir/sub/y', '2\n')
    unlinkSync(join(repo, 'gone.txt'))
    expect(await getAgentChangeDiff(snapshot, 'new.txt')).toBe(
      'diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+n1\n+n2\n'
    )
    expect(await getAgentChangeDiff(snapshot, 'newdir')).toBe(buildAddedFolderDiffMessage(2))
    expect(await getAgentChangeDiff(snapshot, 'gone.txt')).toContain('deleted file mode 100644')
    expect(await getAgentChangeDiff(snapshot, 'missing.txt')).toBe('')
  })

  it('日本語のパスの diff のヘッダーを引用符で囲まない(core.quotePath=false)', async () => {
    write('日本.txt', 'a\n')
    commitAll(repo, 'init')
    const snapshot = await record()
    write('日本.txt', 'b\n')
    expect(await getAgentChangeDiff(snapshot, '日本.txt')).toContain('+++ b/日本.txt')
  })
})

describe('buildAddedFolderDiffMessage', () => {
  it('件数を入れた 1 行', () => {
    expect(buildAddedFolderDiffMessage(3)).toBe('フォルダが追加されました（3 件のファイル）\n')
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentChangesQuery.integration.test.ts 2>&1 | tail -n 5`
Expected: FAIL（`../agentChangesQuery` が無い）

- [ ] **Step 3: 実装する**

`src/main/agentChangesQuery.ts`（新規）:

```ts
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentChangeEntry, AgentChangeStatus } from '@shared/types'
import { AGENT_CHANGES_LIST_LIMIT } from '@shared/types'
import { createBaselineGit, createRepoGit } from './agentBaselineGit'
import type { BaselineGitOptions } from './agentBaselineGit'
import type { BaselineSnapshot } from './agentBaselineSnapshot'
import { PATCH_FORMAT_ARGS } from './gitDiffArgs'
import { parseNulSeparatedPaths, toLiteralPathspec } from './gitPathParsing'
import { getDiff } from './gitService'

// エージェントの変更の一覧と diff(設計書「確認の結果」5)。記録のインデックス(GIT_INDEX_FILE)と作業ツリーを比べる:
// - `git diff --name-status --no-renames -z`: 記録の時点にあったファイルの変更・削除・種類の変更
// - `git ls-files -z --others --exclude-standard --directory --no-empty-directory`: 記録の後に現れたファイル。
//   新しいフォルダは 1 行('<dir>/')にまとめる
// どちらも blob を書かず、利用者の .git/index を変えない。リネームは削除 + 追加の 2 行になる

export interface AgentChangesList {
  entries: AgentChangeEntry[]
  totalCount: number
  truncated: boolean
  headChanged: boolean
}

// name-status の 1 文字。記録のインデックスはコンフリクトのエントリを持たない(add -A が解消する)。
// 未知の文字は内容が変わったものとして M にする
const toStatus = (letter: string): AgentChangeStatus =>
  letter === 'D' || letter === 'T' || letter === 'A' ? letter : 'M'

function parseNameStatus(output: string): { path: string; status: AgentChangeStatus }[] {
  const tokens = output.split('\0')
  const result: { path: string; status: AgentChangeStatus }[] = []
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    if (tokens[i] === '') break
    result.push({ status: toStatus(tokens[i].charAt(0)), path: tokens[i + 1] })
  }
  return result
}

// 記録しなかった(大きすぎて除外した)ファイルの、いまの状態。変わっていなければ一覧に出さない
async function excludedChange(
  folderPath: string,
  file: BaselineSnapshot['excluded'][number]
): Promise<'unchanged' | 'modified' | 'deleted'> {
  const stat = await lstat(join(folderPath, file.path)).catch(() => null)
  if (stat === null) return 'deleted'
  return stat.isFile() && stat.size === file.size && stat.mtimeMs === file.mtimeMs
    ? 'unchanged'
    : 'modified'
}

/** 記録の時点 → いまの作業ツリーの変更のすべて(打ち切らない)。パスの順。戻す操作の照合(agentChangesRevert)も使う */
export async function collectAgentChangeEntries(
  snapshot: BaselineSnapshot,
  options: BaselineGitOptions = {}
): Promise<AgentChangeEntry[]> {
  const { folderPath, indexPath } = snapshot
  const git = createBaselineGit(folderPath, indexPath, options)
  const tracked = parseNameStatus(await git.raw(['diff', '--name-status', '--no-renames', '-z']))
  const others = parseNulSeparatedPaths(
    await git.raw([
      'ls-files',
      '-z',
      '--others',
      '--exclude-standard',
      '--directory',
      '--no-empty-directory'
    ])
  )
  const excludedByPath = new Map(snapshot.excluded.map((file) => [file.path, file]))
  const entries: AgentChangeEntry[] = tracked.map(({ path, status }) => ({
    path,
    status,
    isDirectory: false,
    notRecorded: false
  }))
  for (const path of others) {
    const isDirectory = path.endsWith('/')
    if (isDirectory) {
      // 除外したファイルを中に含む新しいフォルダは、ゴミ箱へ移すと記録していない内容を失うため戻せない
      const notRecorded = snapshot.excluded.some((file) => file.path.startsWith(path))
      entries.push({ path, status: 'A', isDirectory, notRecorded })
      continue
    }
    const excluded = excludedByPath.get(path)
    if (excluded === undefined) {
      entries.push({ path, status: 'A', isDirectory, notRecorded: false })
      continue
    }
    excludedByPath.delete(path)
    if ((await excludedChange(folderPath, excluded)) === 'modified') {
      entries.push({ path, status: 'M', isDirectory, notRecorded: true })
    }
  }
  // 一覧に現れなかった除外のファイルは、消えたものだけを出す(ignore されたもの・追跡に変わったものは出さない)
  for (const excluded of excludedByPath.values()) {
    if ((await excludedChange(folderPath, excluded)) === 'deleted') {
      entries.push({ path: excluded.path, status: 'D', isDirectory: false, notRecorded: true })
    }
  }
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** 記録の時点 → いまの作業ツリーの変更の一覧。AGENT_CHANGES_LIST_LIMIT 件で打ち切り、HEAD が変わったかを添える */
export async function listAgentChanges(
  snapshot: BaselineSnapshot,
  options: BaselineGitOptions = {}
): Promise<AgentChangesList> {
  const entries = await collectAgentChangeEntries(snapshot, options)
  const head = await createRepoGit(snapshot.folderPath, options)
    .raw(['rev-parse', '--verify', '-q', 'HEAD'])
    .then((output) => output.trim() || null)
    .catch(() => null)
  return {
    entries: entries.slice(0, AGENT_CHANGES_LIST_LIMIT),
    totalCount: entries.length,
    truncated: entries.length > AGENT_CHANGES_LIST_LIMIT,
    headChanged: head !== snapshot.head
  }
}

/** 追加されたフォルダの diff の代わりの 1 行(DiffView はハンクの無い行を説明として出す) */
export function buildAddedFolderDiffMessage(fileCount: number): string {
  return `フォルダが追加されました（${fileCount} 件のファイル）\n`
}

/**
 * 1 ファイルの diff(記録の時点 → いまの作業ツリー)。filePath はリポジトリ相対(末尾の '/' は落ちている)。
 * - 記録の時点にあったファイル: 記録のインデックスでの git diff(getDiff と同じ引数・-U3)
 * - 記録の後に現れたフォルダ: 中のファイルの数の 1 行
 * - 記録の後に現れたファイル: 未追跡の疑似 diff(getDiff の未追跡の扱いと同じ。大きさ・バイナリ・リンクの判定を含む)
 */
export async function getAgentChangeDiff(
  snapshot: BaselineSnapshot,
  filePath: string,
  options: BaselineGitOptions = {}
): Promise<string> {
  const { folderPath, indexPath } = snapshot
  const literal = toLiteralPathspec(filePath)
  const git = createBaselineGit(folderPath, indexPath, {
    ...options,
    config: ['core.quotePath=false']
  })
  const inBaseline = parseNulSeparatedPaths(await git.raw(['ls-files', '-z', '--', literal]))
  if (inBaseline.includes(filePath)) {
    return git.raw(['diff', ...PATCH_FORMAT_ARGS, '-U3', '--', literal])
  }
  const stat = await lstat(join(folderPath, filePath)).catch(() => null)
  if (stat === null) return ''
  if (stat.isDirectory()) {
    const files = parseNulSeparatedPaths(
      await git.raw([
        'ls-files',
        '-z',
        '--others',
        '--exclude-standard',
        '--',
        toLiteralPathspec(`${filePath}/`)
      ])
    )
    return buildAddedFolderDiffMessage(files.length)
  }
  return getDiff(folderPath, filePath, false, true)
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentChangesQuery.integration.test.ts 2>&1 | tail -n 5`
Expected: PASS（11 件）

- [ ] **Step 5: 変異で落ちることを確かめる**（手順は Task 4 の Step 5）

| #   | 置き換え前                                                                               | 置き換え後                        | 落ちるテスト                                         |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------- |
| A1  | `      const notRecorded = snapshot.excluded.some((file) => file.path.startsWith(path))` | `      const notRecorded = false` | `そのフォルダの行を notRecorded にする`              |
| A2  | `    if ((await excludedChange(folderPath, excluded)) === 'modified') {`                 | `    if (true) {`                 | `変わっていなければ出さない`                         |
| A3  | `      '--directory',`                                                                   | （空行）                          | `エージェントの変更だけを出す`・`そのフォルダの行を` |
| A4  | `    config: ['core.quotePath=false']`                                                   | `    config: []`                  | `日本語のパスの diff のヘッダーを引用符で囲まない`   |
| A5  | `    headChanged: head !== snapshot.head`                                                | `    headChanged: false`          | `HEAD が変わったら headChanged`                      |

- [ ] **Step 6: 確認コマンド**

```bash
npm run typecheck 2>&1 | tail -n 5
npx prettier --write src/main/agentChangesQuery.ts src/main/__tests__/agentChangesQuery.integration.test.ts
npx eslint src/main/agentChangesQuery.ts src/main/__tests__/agentChangesQuery.integration.test.ts
```

---

### Task 6: main: 戻す（`agentChangesRevert`）

**Files:**

- Create: `src/main/agentChangesRevert.ts`、`src/main/__tests__/agentChangesRevert.integration.test.ts`
- Modify: `src/main/agentChangesQuery.ts`（blob が無いときの git のエラーを分かる文言に置き換える）

**Interfaces:**

- Consumes: `collectAgentChangeEntries`（Task 5）、`createBaselineGit`・`createRepoGit`（Task 3）、`verifyHunkPatch`・`listPathsForMessage`（Task 2）、既存の `applyDiscard`（`gitDiscardService.ts:27`）・`classifyDiscardTarget`・`assertDiscardable`（`gitDiscardClassifier.ts:105・128`）・`isUnmergedPath`（`gitMergeState.ts:45`）・`discardHunkPatch`（`gitApply.ts:143`）、`DiscardAllResult`（`shared/types/git.ts:114`）
- Produces: `AGENT_BASELINE_BLOB_MISSING_MESSAGE`（`agentChangesQuery.ts`）、`AGENT_CHANGES_STALE_MESSAGE`・`AGENT_REVERT_HUNK_FAILED_MESSAGE`・`AGENT_REVERT_ALL_MISMATCH_MESSAGE`・`AGENT_REVERT_ALL_TOO_MANY_MESSAGE`、`interface AgentRevertContext { snapshot: BaselineSnapshot; trash: (absolutePath: string) => Promise<void>; gitOptions?: BaselineGitOptions }`、`revertAgentChange(context, filePath: string): Promise<void>`、`revertAgentChangeHunk(context, filePath: string, patch: string): Promise<void>`、`revertAllAgentChanges(context, expected: AgentRevertAllEntry[]): Promise<DiscardAllResult>`
- 注: 1 件の検査の順は設計書「戻す手順」のとおり（一覧に含まれるか → 記録しなかったか → 利用者の index でコンフリクトか → gitlink か → 記録のインデックスで分類と拒否 → `tracked` なら blob の存在）。blob の存在は `cat-file -t` で確かめる（`cat-file -e` は simple-git では無いときも resolve する。差異 7）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/agentChangesRevert.integration.test.ts`（新規。確認の結果 7〜12 の回帰と完了条件 4）:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  unlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { takeBaselineSnapshot } from '../agentBaselineSnapshot'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import {
  AGENT_BASELINE_BLOB_MISSING_MESSAGE,
  getAgentChangeDiff,
  listAgentChanges
} from '../agentChangesQuery'
import {
  AGENT_CHANGES_STALE_MESSAGE,
  AGENT_REVERT_ALL_MISMATCH_MESSAGE,
  AGENT_REVERT_ALL_TOO_MANY_MESSAGE,
  AGENT_REVERT_HUNK_FAILED_MESSAGE,
  revertAgentChange,
  revertAgentChangeHunk,
  revertAllAgentChanges
} from '../agentChangesRevert'
import type { AgentRevertContext } from '../agentChangesRevert'
import {
  commitAll,
  initRepo,
  readRepoFile,
  runGit,
  stubGitHome,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'

let repo: string
let home: string
let tempRoot: string
let trashed: string[]
const write = (path: string, content: string): void => writeRepoFile(repo, path, content)
const read = (path: string): string => readRepoFile(repo, path)

// ゴミ箱の偽物: 移したパスを記録し、実際に作業ツリーから取り除く
const fakeTrash = async (absolutePath: string): Promise<void> => {
  trashed.push(absolutePath)
  rmSync(absolutePath, { recursive: true, force: true })
}

beforeEach(() => {
  stubIsolatedGitEnv()
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'agent-changes-revert-')))
  home = mkdtempSync(join(tmpdir(), 'agent-changes-revert-home-'))
  tempRoot = mkdtempSync(join(tmpdir(), 'agent-changes-revert-temp-'))
  trashed = []
  stubGitHome(home)
  initRepo(repo)
})

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of [repo, home, tempRoot]) rmSync(dir, { recursive: true, force: true })
})

const record = async (): Promise<AgentRevertContext> => {
  const result = await takeBaselineSnapshot(repo, { tempRoot })
  if (result.kind !== 'recorded') throw new Error(`記録できなかった: ${JSON.stringify(result)}`)
  return { snapshot: result.snapshot, trash: fakeTrash }
}

// 利用者の状態(index の更新時刻〈ナノ秒〉と内容・stash・ref・HEAD)。戻す操作の前後で変わらないこと(完了条件 4)
const userState = (): unknown => ({
  indexMtimeNs: statSync(join(repo, '.git/index'), { bigint: true }).mtimeNs,
  index: readFileSync(join(repo, '.git/index')).toString('base64'),
  stash: runGit(repo, 'stash', 'list'),
  refs: runGit(repo, 'for-each-ref'),
  head: runGit(repo, 'rev-parse', 'HEAD')
})

const listPaths = async (snapshot: BaselineSnapshot): Promise<string[]> =>
  (await listAgentChanges(snapshot)).entries.map((e) => e.path)

describe('revertAgentChange(実 git)', () => {
  it('変更は実行の前の内容(利用者の未ステージの変更を含む)へ戻し、利用者の index・stash・ref・HEAD を変えない(確認の結果 7・9)', async () => {
    write('a.txt', 'a1\na2\na3\n')
    commitAll(repo, 'init')
    write('a.txt', 'a1\na2\na3\nunstaged\n')
    runGit(repo, 'stash', 'list')
    const context = await record()
    write('a.txt', 'a1\na2\na3\nunstaged\nagent\n')
    runGit(repo, 'status', '--porcelain')
    const before = userState()
    await revertAgentChange(context, 'a.txt')
    expect(read('a.txt')).toBe('a1\na2\na3\nunstaged\n')
    expect(userState()).toEqual(before)
    expect(await listPaths(context.snapshot)).toEqual([])
  })

  it('削除は記録の時点の内容で作り直す。利用者の index で未追跡だったファイルも作り直す', async () => {
    write('c.txt', 'c\n')
    commitAll(repo, 'init')
    write('user-untracked.txt', 'u\n')
    const context = await record()
    unlinkSync(join(repo, 'c.txt'))
    renameSync(join(repo, 'user-untracked.txt'), join(repo, 'moved.txt'))
    await revertAgentChange(context, 'c.txt')
    await revertAgentChange(context, 'user-untracked.txt')
    expect(read('c.txt')).toBe('c\n')
    expect(read('user-untracked.txt')).toBe('u\n')
    expect(trashed).toEqual([])
  })

  it('追加されたファイル・フォルダはゴミ箱へ移す(フォルダは末尾の / を落としたパスで届く)', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const context = await record()
    write('new.txt', 'n\n')
    write('newdir/x', '1\n')
    await revertAgentChange(context, 'new.txt')
    await revertAgentChange(context, 'newdir')
    expect(trashed).toEqual([join(repo, 'new.txt'), join(repo, 'newdir')])
    expect(await listPaths(context.snapshot)).toEqual([])
  })

  it('一覧に無いパスは拒否し、何も変えない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const context = await record()
    await expect(revertAgentChange(context, 'a.txt')).rejects.toThrow(AGENT_CHANGES_STALE_MESSAGE)
    await expect(revertAgentChange(context, '../outside')).rejects.toThrow(
      AGENT_CHANGES_STALE_MESSAGE
    )
  })

  it('記録しなかった(5MB を超える)ファイルは拒否し、何も変えない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('big.bin', '')
    truncateSync(join(repo, 'big.bin'), 6 * 1024 * 1024)
    const context = await record()
    truncateSync(join(repo, 'big.bin'), 7 * 1024 * 1024)
    await expect(revertAgentChange(context, 'big.bin')).rejects.toThrow(
      '実行前の内容を記録していないため戻せません: big.bin'
    )
    expect(statSync(join(repo, 'big.bin')).size).toBe(7 * 1024 * 1024)
    expect(trashed).toEqual([])
  })

  it('記録の blob が gc で消えていたら、変更は一覧の取得で失敗し、ファイルを消さない(確認の結果 12 の回帰)', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('a.txt', 'user edit\n')
    const context = await record()
    write('a.txt', 'agent\n')
    runGit(repo, 'gc', '-q', '--prune=now')
    await expect(revertAgentChange(context, 'a.txt')).rejects.toThrow(
      AGENT_BASELINE_BLOB_MISSING_MESSAGE
    )
    expect(read('a.txt')).toBe('agent\n')
  })

  it('記録の blob が消えた削除は、戻す前の cat-file -e で拒否する', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('a.txt', 'user edit\n')
    const context = await record()
    unlinkSync(join(repo, 'a.txt'))
    runGit(repo, 'gc', '-q', '--prune=now')
    await expect(revertAgentChange(context, 'a.txt')).rejects.toThrow(
      `${AGENT_BASELINE_BLOB_MISSING_MESSAGE}: a.txt`
    )
    expect(existsSync(join(repo, 'a.txt'))).toBe(false)
  })

  it('同じ名前のディレクトリに置き換わったファイルは拒否し、ディレクトリの中身を消さない(確認の結果 11)', async () => {
    write('c.txt', 'c\n')
    commitAll(repo, 'init')
    const context = await record()
    unlinkSync(join(repo, 'c.txt'))
    write('c.txt/x', 'keep\n')
    await expect(revertAgentChange(context, 'c.txt')).rejects.toThrow(
      '未追跡のファイルと重なるため取り消せません: c.txt'
    )
    expect(read('c.txt/x')).toBe('keep\n')
  })

  it('入れ子のリポジトリ(gitlink)の変更は拒否する', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const nested = join(repo, 'sub')
    mkdirSync(nested)
    initRepo(nested)
    writeRepoFile(nested, 's.txt', 's\n')
    commitAll(nested, 's')
    const context = await record()
    writeRepoFile(nested, 't.txt', 't\n')
    commitAll(nested, 't')
    await expect(revertAgentChange(context, 'sub')).rejects.toThrow(
      'サブモジュール・入れ子のリポジトリの変更は戻せません。ターミナルで操作してください: sub'
    )
    expect(existsSync(join(nested, 't.txt'))).toBe(true)
  })

  it('利用者の index でコンフリクト中のファイルは拒否する', async () => {
    write('a.txt', 'base\n')
    commitAll(repo, 'init')
    runGit(repo, 'checkout', '-q', '-b', 'other')
    write('a.txt', 'other\n')
    commitAll(repo, 'other')
    runGit(repo, 'checkout', '-q', 'main')
    write('a.txt', 'main\n')
    commitAll(repo, 'main')
    const context = await record()
    try {
      runGit(repo, 'merge', '-q', 'other')
    } catch {
      // コンフリクトで終了コード 1
    }
    await expect(revertAgentChange(context, 'a.txt')).rejects.toThrow(
      'コンフリクト中のファイルは戻せません: a.txt'
    )
  })
})

describe('revertAgentChangeHunk(実 git)', () => {
  const lines = (n: number, replace: Record<number, string> = {}): string =>
    Array.from({ length: n }, (_, i) => replace[i + 1] ?? `l${i + 1}`).join('\n') + '\n'
  // diff の 1 つ目のハンクだけのパッチ
  const firstHunk = (diff: string): string => {
    const parts = diff.split(/(?=^@@ )/m)
    return parts[0] + parts[1]
  }

  it('1 つのハンクだけを実行の前の内容へ戻し、他のハンクと利用者の index は変えない(確認の結果 8)', async () => {
    write('d.txt', lines(20))
    commitAll(repo, 'init')
    const context = await record()
    write('d.txt', lines(20, { 2: 'A2', 18: 'A18' }))
    const before = userState()
    const diff = await getAgentChangeDiff(context.snapshot, 'd.txt')
    await revertAgentChangeHunk(context, 'd.txt', firstHunk(diff))
    expect(read('d.txt')).toBe(lines(20, { 18: 'A18' }))
    expect(userState()).toEqual(before)
  })

  it('diff を取った後にファイルが変わって文脈が合わなければ失敗し、何も変えない', async () => {
    write('d.txt', lines(20))
    commitAll(repo, 'init')
    const context = await record()
    write('d.txt', lines(20, { 2: 'A2' }))
    const diff = await getAgentChangeDiff(context.snapshot, 'd.txt')
    write('d.txt', lines(20, { 2: 'A2', 3: 'later' }))
    await expect(revertAgentChangeHunk(context, 'd.txt', diff)).rejects.toThrow(
      AGENT_REVERT_HUNK_FAILED_MESSAGE
    )
    expect(read('d.txt')).toBe(lines(20, { 2: 'A2', 3: 'later' }))
  })

  it('追加・削除されたファイルのハンクは拒否する(新規ファイルのパッチの逆適用は削除になる)', async () => {
    write('gone.txt', 'g\n')
    commitAll(repo, 'init')
    const context = await record()
    write('new.txt', 'n\n')
    unlinkSync(join(repo, 'gone.txt'))
    const newDiff = await getAgentChangeDiff(context.snapshot, 'new.txt')
    await expect(revertAgentChangeHunk(context, 'new.txt', newDiff)).rejects.toThrow(
      '追加・削除されたファイルはハンクでは戻せません。ファイルごと戻してください: new.txt'
    )
    expect(read('new.txt')).toBe('n\n')
    const goneDiff = await getAgentChangeDiff(context.snapshot, 'gone.txt')
    await expect(revertAgentChangeHunk(context, 'gone.txt', goneDiff)).rejects.toThrow(
      '追加・削除されたファイルはハンクでは戻せません。ファイルごと戻してください: gone.txt'
    )
  })

  it('別のファイルを対象にしたパッチは拒否し、どちらのファイルも変えない', async () => {
    write('a.txt', lines(5))
    write('b.txt', lines(5))
    commitAll(repo, 'init')
    const context = await record()
    write('a.txt', lines(5, { 2: 'A' }))
    write('b.txt', lines(5, { 2: 'B' }))
    const bDiff = await getAgentChangeDiff(context.snapshot, 'b.txt')
    await expect(revertAgentChangeHunk(context, 'a.txt', bDiff)).rejects.toThrow(
      'パッチの対象がファイルと一致しません'
    )
    expect(read('a.txt')).toBe(lines(5, { 2: 'A' }))
    expect(read('b.txt')).toBe(lines(5, { 2: 'B' }))
  })
})

describe('revertAllAgentChanges(実 git)', () => {
  const setup = async (): Promise<AgentRevertContext> => {
    write('a.txt', 'a\n')
    write('c.txt', 'c\n')
    commitAll(repo, 'init')
    write('a.txt', 'a\nuser\n')
    const context = await record()
    write('a.txt', 'a\nuser\nagent\n')
    unlinkSync(join(repo, 'c.txt'))
    write('new.txt', 'n\n')
    return context
  }
  const shown = [
    { path: 'a.txt', status: 'M' as const },
    { path: 'c.txt', status: 'D' as const },
    { path: 'new.txt', status: 'A' as const }
  ]

  it('確認のときの一覧と一致すれば、すべて実行の前の状態へ戻す。利用者の index などは変えない', async () => {
    const context = await setup()
    const before = userState()
    await expect(revertAllAgentChanges(context, [...shown].reverse())).resolves.toEqual({
      status: 'done'
    })
    expect(read('a.txt')).toBe('a\nuser\n')
    expect(read('c.txt')).toBe('c\n')
    expect(trashed).toEqual([join(repo, 'new.txt')])
    expect(userState()).toEqual(before)
  })

  it.each([
    ['件数が違う', shown.slice(0, 2)],
    ['状態の文字が違う', [shown[0], shown[1], { path: 'new.txt', status: 'M' as const }]],
    ['パスが入れ替わった', [shown[0], shown[1], { path: 'other.txt', status: 'A' as const }]]
  ])('%s なら何も変えずに中止する(パターン 62)', async (_label, expected) => {
    const context = await setup()
    await expect(revertAllAgentChanges(context, expected)).rejects.toThrow(
      AGENT_REVERT_ALL_MISMATCH_MESSAGE
    )
    expect(read('a.txt')).toBe('a\nuser\nagent\n')
    expect(existsSync(join(repo, 'c.txt'))).toBe(false)
    expect(trashed).toEqual([])
  })

  // 記録の時点のファイル c.txt が同名のフォルダに置き換わると、フォルダの中身は ls-files --others に出ない(c.txt の D だけ)
  it('1 件でも戻せなければ、何も戻さずに拒否する', async () => {
    const context = await setup()
    write('c.txt/x', 'keep\n')
    await expect(revertAllAgentChanges(context, shown)).rejects.toThrow(
      '戻せないファイルがあるため、何も戻しませんでした（c.txt）'
    )
    expect(read('a.txt')).toBe('a\nuser\nagent\n')
    expect(trashed).toEqual([])
  })

  it('途中で失敗したら、1 件以上済んでいれば partial を返す', async () => {
    const context = await setup()
    context.trash = async () => {
      throw new Error('trash failed')
    }
    await expect(revertAllAgentChanges(context, shown)).resolves.toEqual({
      status: 'partial',
      message:
        'すべて戻すが途中で失敗しました（2 / 3 件を戻し済み）: ゴミ箱へ移動できませんでした: new.txt'
    })
    expect(read('a.txt')).toBe('a\nuser\n')
  })

  it('1 件目で失敗したら例外にする(何も変わっていない)', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const context = await record()
    write('new.txt', 'n\n')
    context.trash = async () => {
      throw new Error('trash failed')
    }
    await expect(
      revertAllAgentChanges(context, [{ path: 'new.txt', status: 'A' }])
    ).rejects.toThrow('すべて戻すが途中で失敗しました（0 / 1 件を戻し済み）')
  })

  it('一覧が 500 件を超えると拒否する', async () => {
    write('many/keep.txt', 'k\n')
    commitAll(repo, 'init')
    const context = await record()
    for (let i = 0; i < 501; i++) write(`many/${i}.txt`, '')
    await expect(revertAllAgentChanges(context, [])).rejects.toThrow(
      AGENT_REVERT_ALL_TOO_MANY_MESSAGE
    )
    expect(trashed).toEqual([])
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentChangesRevert.integration.test.ts 2>&1 | tail -n 5`
Expected: FAIL（`../agentChangesRevert` が無い）

- [ ] **Step 3: 実装する**

`src/main/agentChangesQuery.ts` の変更:

```diff
--- a/src/main/agentChangesQuery.ts
+++ b/src/main/agentChangesQuery.ts
@@ -15,6 +15,17 @@ import { getDiff } from './gitService'
 //   新しいフォルダは 1 行('<dir>/')にまとめる
 // どちらも blob を書かず、利用者の .git/index を変えない。リネームは削除 + 追加の 2 行になる

+/** 記録の blob が object の DB から消えた(git gc --prune=now など。確認の結果 12) */
+export const AGENT_BASELINE_BLOB_MISSING_MESSAGE =
+  '実行前の内容が見つかりません（git gc などで消えた可能性があります）'
+
+// 記録のインデックスが指す blob が無いと、diff は `fatal: unable to read <sha>` で失敗する。分かる文言に置き換える
+function toBaselineQueryError(error: unknown): unknown {
+  return error instanceof Error && /unable to read [0-9a-f]{7,}/.test(error.message)
+    ? new Error(AGENT_BASELINE_BLOB_MISSING_MESSAGE, { cause: error })
+    : error
+}
+
 export interface AgentChangesList {
   entries: AgentChangeEntry[]
   totalCount: number
@@ -56,7 +67,11 @@ export async function collectAgentChangeEntries(
 ): Promise<AgentChangeEntry[]> {
   const { folderPath, indexPath } = snapshot
   const git = createBaselineGit(folderPath, indexPath, options)
-  const tracked = parseNameStatus(await git.raw(['diff', '--name-status', '--no-renames', '-z']))
+  const tracked = parseNameStatus(
+    await git.raw(['diff', '--name-status', '--no-renames', '-z']).catch((error: unknown) => {
+      throw toBaselineQueryError(error)
+    })
+  )
   const others = parseNulSeparatedPaths(
     await git.raw([
       'ls-files',
@@ -143,7 +158,9 @@ export async function getAgentChangeDiff(
   })
   const inBaseline = parseNulSeparatedPaths(await git.raw(['ls-files', '-z', '--', literal]))
   if (inBaseline.includes(filePath)) {
-    return git.raw(['diff', ...PATCH_FORMAT_ARGS, '-U3', '--', literal])
+    return git.raw(['diff', ...PATCH_FORMAT_ARGS, '-U3', '--', literal]).catch((error: unknown) => {
+      throw toBaselineQueryError(error)
+    })
   }
   const stat = await lstat(join(folderPath, filePath)).catch(() => null)
   if (stat === null) return ''
```

`src/main/agentChangesRevert.ts`（新規）:

```ts
import type { SimpleGit } from 'simple-git'
import type { AgentChangeEntry, AgentRevertAllEntry, DiscardAllResult } from '@shared/types'
import { AGENT_CHANGES_LIST_LIMIT } from '@shared/types'
import { createBaselineGit, createRepoGit } from './agentBaselineGit'
import type { BaselineGitOptions } from './agentBaselineGit'
import type { BaselineSnapshot } from './agentBaselineSnapshot'
import { AGENT_BASELINE_BLOB_MISSING_MESSAGE, collectAgentChangeEntries } from './agentChangesQuery'
import { discardHunkPatch } from './gitApply'
import { assertDiscardable, classifyDiscardTarget } from './gitDiscardClassifier'
import { applyDiscard, listPathsForMessage, verifyHunkPatch } from './gitDiscardService'
import { isUnmergedPath } from './gitMergeState'
import { toLiteralPathspec } from './gitPathParsing'

// エージェントの変更を、記録の時点(実行の前)の内容へ戻す(設計書「変更を戻す」)。既存の取り消しの部品(分類・重なりの検査・
// applyDiscard・パッチの検査)を、記録のインデックスで問い合わせる git で呼ぶ(確認の結果 7・8・10)。戻すのは作業ツリーだけで、
// 利用者の index・stash・HEAD は変えない。コンフリクトの判定だけは利用者の index で行う

export const AGENT_CHANGES_STALE_MESSAGE = '変更の状態が変わりました。一覧を更新してください'
export const AGENT_REVERT_HUNK_FAILED_MESSAGE =
  'ハンクを戻せませんでした。ファイルが変更された可能性があります。diff を開き直してください'
export const AGENT_REVERT_ALL_MISMATCH_MESSAGE =
  '変更の状態が変わったため、戻すのを中止しました。もう一度操作してください'
export const AGENT_REVERT_ALL_TOO_MANY_MESSAGE =
  '変更が多すぎるため、すべて戻すは使えません。ファイルごとに戻すか、ターミナルで操作してください'

export interface AgentRevertContext {
  snapshot: BaselineSnapshot
  /** OS のゴミ箱へ移す(trash.ts の moveToTrash)。テストで偽物を注入する */
  trash: (absolutePath: string) => Promise<void>
  gitOptions?: BaselineGitOptions
}

type RevertKind = 'tracked' | 'untracked'
type Assessment = { ok: true; path: string; kind: RevertKind } | { ok: false; reason: string }

// IPC の境界は末尾の '/' を落としたパスを渡し、一覧の新しいフォルダは '<dir>/' で持つ
const withoutTrailingSlash = (path: string): string => path.replace(/\/+$/, '')

// 記録のインデックスのエントリ(モードと blob)。パスと完全一致するものだけ
async function readBaselineEntry(
  git: SimpleGit,
  filePath: string
): Promise<{ mode: string; sha: string } | null> {
  const output = await git.raw(['ls-files', '-s', '-z', '--', toLiteralPathspec(filePath)])
  for (const record of output.split('\0')) {
    const tab = record.indexOf('\t')
    if (tab === -1 || record.slice(tab + 1) !== filePath) continue
    const [mode, sha] = record.slice(0, tab).split(' ')
    return { mode, sha }
  }
  return null
}

// 1 件を戻せるかを調べる(何も変えない)。手順は設計書「戻す手順」の 3〜6
async function assess(
  gits: { baseline: SimpleGit; repo: SimpleGit },
  entry: AgentChangeEntry
): Promise<Assessment> {
  const path = withoutTrailingSlash(entry.path)
  if (entry.notRecorded) {
    return { ok: false, reason: `実行前の内容を記録していないため戻せません: ${path}` }
  }
  // コンフリクトは利用者の index の状態(記録のインデックスには未解決のエントリが無い)
  if (await isUnmergedPath(gits.repo, path)) {
    return { ok: false, reason: `コンフリクト中のファイルは戻せません: ${path}` }
  }
  const baselineEntry = await readBaselineEntry(gits.baseline, path)
  if (baselineEntry?.mode === '160000') {
    return {
      ok: false,
      reason: `サブモジュール・入れ子のリポジトリの変更は戻せません。ターミナルで操作してください: ${path}`
    }
  }
  const kind = await classifyDiscardTarget(gits.baseline, path)
  try {
    assertDiscardable(kind, path)
    // 記録のインデックスは intent-to-add を持たない(add -A が実体を入れる)。現れたら判定を誤っているため拒否する
    if (kind === 'intent-to-add') assertDiscardable('unknown', path)
  } catch (error) {
    return { ok: false, reason: (error as Error).message }
  }
  if (kind === 'tracked') {
    // 記録の blob が gc で消えていると、restore は復元できずに削除だけを行う(確認の結果 12)。戻す前に確かめる。
    // `cat-file -e` は無いときに stderr 空・終了コード 1 で終わり、simple-git は reject しない(空文字で resolve)ため使えない。
    // `cat-file -t` は無いと fatal で reject する
    const exists =
      baselineEntry !== null &&
      (await gits.repo
        .raw(['cat-file', '-t', baselineEntry.sha])
        .then((type) => type.trim() === 'blob')
        .catch(() => false))
    if (!exists) {
      return { ok: false, reason: `${AGENT_BASELINE_BLOB_MISSING_MESSAGE}: ${path}` }
    }
  }
  return { ok: true, path, kind: kind === 'tracked' ? 'tracked' : 'untracked' }
}

function gitsFor(context: AgentRevertContext): { baseline: SimpleGit; repo: SimpleGit } {
  const { folderPath, indexPath } = context.snapshot
  return {
    baseline: createBaselineGit(folderPath, indexPath, context.gitOptions),
    repo: createRepoGit(folderPath, context.gitOptions)
  }
}

// いまの一覧から、パス(末尾の '/' を除いて比べる)の行を探す。一覧に無いパスは戻さない
async function findCurrentEntry(
  context: AgentRevertContext,
  filePath: string
): Promise<AgentChangeEntry> {
  const entries = await collectAgentChangeEntries(context.snapshot, context.gitOptions)
  const entry = entries.find((e) => withoutTrailingSlash(e.path) === filePath)
  if (entry === undefined) throw new Error(AGENT_CHANGES_STALE_MESSAGE)
  return entry
}

/** ファイル単位で戻す。変更・削除・種類の変更は記録の時点の内容へ、追加(ファイル・フォルダ)はゴミ箱へ */
export async function revertAgentChange(
  context: AgentRevertContext,
  filePath: string
): Promise<void> {
  const entry = await findCurrentEntry(context, filePath)
  const gits = gitsFor(context)
  const assessment = await assess(gits, entry)
  if (!assessment.ok) throw new Error(assessment.reason)
  const { folderPath } = context.snapshot
  await applyDiscard(gits.baseline, folderPath, assessment.kind, assessment.path, context.trash)
}

/** ハンク単位で戻す(作業ツリーへの逆適用。index は使わない)。追加・削除されたファイルはファイル単位で戻す */
export async function revertAgentChangeHunk(
  context: AgentRevertContext,
  filePath: string,
  patch: string
): Promise<void> {
  const entry = await findCurrentEntry(context, filePath)
  // 新規ファイルのパッチの逆適用はファイルを(ゴミ箱を経由せずに)消す(確認の結果 8)
  if (entry.status === 'A' || entry.status === 'D' || entry.isDirectory) {
    throw new Error(
      `追加・削除されたファイルはハンクでは戻せません。ファイルごと戻してください: ${filePath}`
    )
  }
  const gits = gitsFor(context)
  const assessment = await assess(gits, entry)
  if (!assessment.ok) throw new Error(assessment.reason)
  if (assessment.kind !== 'tracked') {
    throw new Error(`ゴミ箱へ移す対象のため、ハンクでは戻せません: ${filePath}`)
  }
  const { folderPath } = context.snapshot
  const contentPatch = await verifyHunkPatch(folderPath, filePath, patch)
  try {
    await discardHunkPatch(folderPath, filePath, contentPatch)
  } catch (error) {
    throw new Error(AGENT_REVERT_HUNK_FAILED_MESSAGE, { cause: error })
  }
}

// 照合キー(パスは NUL を含められないため、NUL で区切れば衝突しない)
const toMatchKey = (entry: { path: string; status: string }): string =>
  `${entry.status}\0${entry.path}`

/**
 * すべて戻す。確認のときに見せた一覧(expected)と実行時の一覧を完全一致で照合し、違えば何も変えない(パターン 62)。
 * 全件を先に調べ、1 件でも戻せなければ何もしない。途中で失敗したら、1 件以上済んでいれば partial(パターン 52)
 */
export async function revertAllAgentChanges(
  context: AgentRevertContext,
  expected: AgentRevertAllEntry[]
): Promise<DiscardAllResult> {
  const entries = await collectAgentChangeEntries(context.snapshot, context.gitOptions)
  if (entries.length > AGENT_CHANGES_LIST_LIMIT) throw new Error(AGENT_REVERT_ALL_TOO_MANY_MESSAGE)
  const actualKeys = entries.map(toMatchKey).sort()
  const expectedKeys = expected.map(toMatchKey).sort()
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, i) => key !== expectedKeys[i])
  ) {
    throw new Error(AGENT_REVERT_ALL_MISMATCH_MESSAGE)
  }
  const gits = gitsFor(context)
  const targets: { path: string; kind: RevertKind }[] = []
  const blocked: string[] = []
  for (const entry of entries) {
    const assessment = await assess(gits, entry)
    if (assessment.ok) targets.push(assessment)
    else blocked.push(withoutTrailingSlash(entry.path))
  }
  if (blocked.length > 0) {
    throw new Error(
      `戻せないファイルがあるため、何も戻しませんでした（${listPathsForMessage(blocked)}）`
    )
  }
  let done = 0
  for (const { path, kind } of targets) {
    try {
      await applyDiscard(gits.baseline, context.snapshot.folderPath, kind, path, context.trash)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const message = `すべて戻すが途中で失敗しました（${done} / ${targets.length} 件を戻し済み）: ${reason}`
      if (done > 0) return { status: 'partial', message }
      throw new Error(message, { cause: error })
    }
    done++
  }
  return { status: 'done' }
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentChangesRevert.integration.test.ts src/main/__tests__/agentChangesQuery.integration.test.ts 2>&1 | tail -n 5`
Expected: PASS（22 件 + 11 件）

- [ ] **Step 5: 変異で落ちることを確かめる**（主要な守り。パターン 130。手順は Task 4 の Step 5）

| #   | 置き換え前                                                                       | 置き換え後                         | 落ちるテスト                                                                 |
| --- | -------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| A1  | `      baselineEntry !== null &&⏎      (await gits.repo`（⏎ は改行）             | `      true \|\| (await gits.repo` | `戻す前の cat-file -t で拒否する`                                            |
| A2  | `    assertDiscardable(kind, path)⏎    // 記録`                                  | `    // 記録`                      | `同じ名前のディレクトリに置き換わったファイルは拒否`・`1 件でも戻せなければ` |
| A3  | `    actualKeys.length !== expectedKeys.length \|\|⏎    actualKeys.some`         | `    false && actualKeys.some`     | `件数が違う`・`状態の文字が違う`・`パスが入れ替わった`                       |
| A4  | `  if (entry.notRecorded) {`                                                     | `  if (false) {`                   | `記録しなかった(5MB を超える)ファイルは拒否`                                 |
| A5  | `  if (baselineEntry?.mode === '160000') {`                                      | `  if (false) {`                   | `入れ子のリポジトリ(gitlink)の変更は拒否`                                    |
| A6  | `  if (await isUnmergedPath(gits.repo, path)) {`                                 | `  if (false) {`                   | `コンフリクト中のファイルは拒否`                                             |
| A7  | `  if (entry.status === 'A' \|\| entry.status === 'D' \|\| entry.isDirectory) {` | `  if (false) {`                   | `追加・削除されたファイルのハンクは拒否`                                     |

- [ ] **Step 6: 確認コマンド**

```bash
npm run typecheck 2>&1 | tail -n 5
npx prettier --write src/main/agentChangesRevert.ts src/main/agentChangesQuery.ts src/main/__tests__/agentChangesRevert.integration.test.ts
npx eslint src/main/agentChangesRevert.ts src/main/agentChangesQuery.ts src/main/__tests__/agentChangesRevert.integration.test.ts
```

---

### Task 7: main: 所有者ごとの記録の登録（`agentBaselineRegistry`）

**Files:**

- Create: `src/main/agentBaselineRegistry.ts`、`src/main/__tests__/agentBaselineRegistry.test.ts`

**Interfaces:**

- Consumes: `BaselineSnapshot`・`BaselineSnapshotResult`（Task 4）、`AgentChangesState`（Task 1）
- Produces: `interface AgentBaselineRegistryDeps { takeSnapshot: (folderPath: string, options: { isCanceled: () => boolean }) => Promise<BaselineSnapshotResult>; removeDir: (tempDir: string) => Promise<void>; removeDirSync: (tempDir: string) => void }`、`class AgentBaselineRegistry` の `generationOf(ownerId): number`・`begin(ownerId, folderPath): Promise<AgentChangesState>`・`getState(ownerId, folderPath): AgentChangesState`・`withRecord<T>(ownerId, folderPath, task: (snapshot: BaselineSnapshot) => Promise<T>): Promise<T | null>`・`clear(ownerId): Promise<void>`・`close(): void`
- 注: Electron に依存しない（`AgentSessionRegistry` と同じ作り。`agentSessionRegistry.ts:12-91` の世代とまとめの流儀）。記録できない結果（`unavailable`）は持たない（renderer が持つ。差異 8）。`clear` は記録をすぐ外し、一時ディレクトリの削除は列の後ろ（実行中の戻す操作は最後まで行う。設計書「世代」）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/agentBaselineRegistry.test.ts`（新規。パターン 141 の順序一式・所有者の分離・列の直列化・後始末）:

```ts
import { describe, it, expect, vi } from 'vitest'
import { AgentBaselineRegistry } from '../agentBaselineRegistry'
import type { AgentBaselineRegistryDeps } from '../agentBaselineRegistry'
import type { BaselineSnapshot, BaselineSnapshotResult } from '../agentBaselineSnapshot'

const snapshotOf = (folderPath: string, tempDir: string, startedAt = 100): BaselineSnapshot => ({
  folderPath,
  tempDir,
  indexPath: `${tempDir}/index`,
  startedAt,
  head: null,
  excluded: []
})

// 記録を取る偽物。release で結果を返し、isCanceled を控える
function setup(): {
  registry: AgentBaselineRegistry
  takeSnapshot: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['takeSnapshot']>>
  removeDir: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['removeDir']>>
  removeDirSync: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['removeDirSync']>>
  /** index 番目(既定は最後)の記録の依頼に結果を返す */
  release: (result: BaselineSnapshotResult, index?: number) => void
  canceled: () => boolean
} {
  const resolvers: ((result: BaselineSnapshotResult) => void)[] = []
  let isCanceled: () => boolean = () => false
  const takeSnapshot = vi.fn<AgentBaselineRegistryDeps['takeSnapshot']>(
    (_folder, options) =>
      new Promise<BaselineSnapshotResult>((r) => {
        resolvers.push(r)
        isCanceled = options.isCanceled
      })
  )
  const removeDir = vi.fn<AgentBaselineRegistryDeps['removeDir']>(async () => undefined)
  const removeDirSync = vi.fn<AgentBaselineRegistryDeps['removeDirSync']>()
  const registry = new AgentBaselineRegistry({ takeSnapshot, removeDir, removeDirSync })
  return {
    registry,
    takeSnapshot,
    removeDir,
    removeDirSync,
    release: (result, index = resolvers.length - 1) => resolvers[index](result),
    canceled: () => isCanceled()
  }
}

const recorded = (
  folderPath: string,
  tempDir: string,
  startedAt = 100
): BaselineSnapshotResult => ({
  kind: 'recorded',
  snapshot: snapshotOf(folderPath, tempDir, startedAt)
})

// begin を記録まで進める
async function recordFor(
  s: ReturnType<typeof setup>,
  ownerId: number,
  folder: string,
  tempDir: string
): Promise<void> {
  const begun = s.registry.begin(ownerId, folder)
  await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalled())
  s.release(recorded(folder, tempDir))
  await begun
  s.takeSnapshot.mockClear()
}

describe('AgentBaselineRegistry', () => {
  it('記録を取ると recording を返し、所有者ごとに分ける', async () => {
    const s = setup()
    const begun = s.registry.begin(1, '/repo')
    s.release(recorded('/repo', '/tmp/a', 42))
    await expect(begun).resolves.toEqual({ kind: 'recording', startedAt: 42 })
    expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'recording', startedAt: 42 })
    expect(s.registry.getState(2, '/repo')).toEqual({ kind: 'none' })
    await expect(s.registry.withRecord(2, '/repo', async () => 'used')).resolves.toBeNull()
  })

  it('記録がある間の begin は記録を取り直さない(累積)', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/a')
    await expect(s.registry.begin(1, '/repo')).resolves.toEqual({
      kind: 'recording',
      startedAt: 100
    })
    expect(s.takeSnapshot).not.toHaveBeenCalled()
  })

  it('同じ世代の記録の途中の begin は 1 つにまとめる', async () => {
    const s = setup()
    const first = s.registry.begin(1, '/repo')
    const second = s.registry.begin(1, '/repo')
    s.release(recorded('/repo', '/tmp/a'))
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'recording', startedAt: 100 },
      { kind: 'recording', startedAt: 100 }
    ])
    expect(s.takeSnapshot).toHaveBeenCalledOnce()
  })

  it('記録できない結果はそのまま返し、記録を持たない', async () => {
    const s = setup()
    const begun = s.registry.begin(1, '/repo')
    s.release({ kind: 'unavailable', state: { kind: 'unavailable', reason: 'not-toplevel' } })
    await expect(begun).resolves.toEqual({ kind: 'unavailable', reason: 'not-toplevel' })
    expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'none' })
  })

  it('記録の途中に clear が来たら取り消し、取れた記録の一時ディレクトリを消して none を返す(パターン 141)', async () => {
    const s = setup()
    const begun = s.registry.begin(1, '/repo')
    await s.registry.clear(1)
    expect(s.canceled()).toBe(true)
    s.release(recorded('/repo', '/tmp/a'))
    await expect(begun).resolves.toEqual({ kind: 'none' })
    expect(s.removeDir).toHaveBeenCalledWith('/tmp/a')
    expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'none' })
  })

  it('取り消された世代の記録の途中の依頼には、新しい begin をまとめない', async () => {
    const s = setup()
    const old = s.registry.begin(1, '/repo')
    await s.registry.clear(1)
    const fresh = s.registry.begin(1, '/repo')
    expect(s.takeSnapshot).toHaveBeenCalledTimes(2)
    s.release({ kind: 'canceled' }, 0)
    s.release(recorded('/repo', '/tmp/b'), 1)
    await expect(old).resolves.toEqual({ kind: 'none' })
    await expect(fresh).resolves.toEqual({ kind: 'recording', startedAt: 100 })
  })

  it('別のフォルダの記録の途中の依頼にはまとめない', async () => {
    const s = setup()
    void s.registry.begin(1, '/repo')
    void s.registry.begin(1, '/other')
    expect(s.takeSnapshot).toHaveBeenCalledTimes(2)
  })

  it('記録のフォルダがいまの許可のフォルダと違えば none とし、記録を捨てる', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/a')
    expect(s.registry.getState(1, '/other')).toEqual({ kind: 'none' })
    await vi.waitFor(() => expect(s.removeDir).toHaveBeenCalledWith('/tmp/a'))
    expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'none' })
  })

  it('記録を使う操作は所有者ごとに 1 本の列で順に行う', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/a')
    const order: string[] = []
    let releaseFirst: () => void = () => undefined
    const first = s.registry.withRecord(1, '/repo', async (snapshot) => {
      order.push(`start1:${snapshot.tempDir}`)
      await new Promise<void>((r) => (releaseFirst = r))
      order.push('end1')
    })
    const second = s.registry.withRecord(1, '/repo', async () => {
      order.push('start2')
    })
    await vi.waitFor(() => expect(order).toEqual(['start1:/tmp/a']))
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['start1:/tmp/a', 'end1', 'start2'])
  })

  it('操作の途中に clear が来たら、以後の依頼は記録なしにし、一時ディレクトリは操作の後に消す', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/a')
    let releaseTask: () => void = () => undefined
    let started = false
    const running = s.registry.withRecord(1, '/repo', async () => {
      started = true
      await new Promise<void>((r) => (releaseTask = r))
      return 'done'
    })
    await vi.waitFor(() => expect(started).toBe(true))
    const cleared = s.registry.clear(1)
    expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'none' })
    const later = s.registry.withRecord(1, '/repo', async () => 'used')
    expect(s.removeDir).not.toHaveBeenCalled()
    releaseTask()
    await expect(running).resolves.toBe('done')
    await cleared
    expect(s.removeDir).toHaveBeenCalledWith('/tmp/a')
    await expect(later).resolves.toBeNull()
  })

  it('失敗した操作の後も列は進む', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/a')
    const failed = s.registry.withRecord(1, '/repo', async () => {
      throw new Error('git failed')
    })
    await expect(failed).rejects.toThrow('git failed')
    await expect(s.registry.withRecord(1, '/repo', async () => 'next')).resolves.toBe('next')
  })

  it('close はすべての一時ディレクトリを待たずに消し、以後は記録を取らない', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/a')
    await recordFor(s, 2, '/repo2', '/tmp/b')
    s.registry.close()
    expect(s.removeDirSync.mock.calls).toEqual([['/tmp/a'], ['/tmp/b']])
    await expect(s.registry.begin(1, '/repo')).resolves.toEqual({ kind: 'none' })
    expect(s.takeSnapshot).not.toHaveBeenCalled()
  })

  it('記録の途中に close したら、取れた記録を捨てる', async () => {
    const s = setup()
    const begun = s.registry.begin(1, '/repo')
    s.registry.close()
    expect(s.canceled()).toBe(true)
    s.release(recorded('/repo', '/tmp/a'))
    await expect(begun).resolves.toEqual({ kind: 'none' })
    expect(s.removeDir).toHaveBeenCalledWith('/tmp/a')
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineRegistry.test.ts 2>&1 | tail -n 5`
Expected: FAIL（`../agentBaselineRegistry` が無い）

- [ ] **Step 3: 実装する**

`src/main/agentBaselineRegistry.ts`（新規）:

```ts
import type { AgentChangesState } from '@shared/types'
import type { BaselineSnapshot, BaselineSnapshotResult } from './agentBaselineSnapshot'

// 所有者(webContents の id)→ 記録(0 か 1 つ)。Electron に依存しない(設計書「状態の持ち主」)。
// - 世代: 記録の開始の依頼・clear・所有者の文脈の終わりで進める。記録を取る間に世代が変わったら、取れた記録を捨てる(パターン 141)
// - 列: 記録のインデックスを使う操作(一覧・diff・戻す)は所有者ごとに 1 本の列に並べる(index.lock の衝突を避ける)。
//   clear は記録をすぐに外し(以後の依頼は記録なしになる)、一時ディレクトリの削除は列の後ろで行う(実行中の操作は最後まで行う)

export interface AgentBaselineRegistryDeps {
  /** 記録を取る(agentBaselineSnapshot.takeBaselineSnapshot)。isCanceled は await のたびに呼ばれる */
  takeSnapshot: (
    folderPath: string,
    options: { isCanceled: () => boolean }
  ) => Promise<BaselineSnapshotResult>
  /** 一時ディレクトリを消す(removeBaselineDir) */
  removeDir: (tempDir: string) => Promise<void>
  /** アプリの終了で、待たずに消す(removeBaselineDirSync) */
  removeDirSync: (tempDir: string) => void
}

export class AgentBaselineRegistry {
  private readonly records = new Map<number, BaselineSnapshot>()
  private readonly generations = new Map<number, number>()
  // 記録を取っている途中の依頼(同じ世代・同じフォルダの依頼はこれにまとめる。二重の「実行」・「いまから記録する」)
  private readonly pending = new Map<
    number,
    { generation: number; folderPath: string; run: Promise<AgentChangesState> }
  >()
  private readonly queues = new Map<number, Promise<unknown>>()
  private closed = false

  constructor(private readonly deps: AgentBaselineRegistryDeps) {}

  generationOf(ownerId: number): number {
    return this.generations.get(ownerId) ?? 0
  }

  /**
   * 記録を始める。記録があれば何もせずに recording を返す(累積。設計書「複数回の実行」)。
   * 記録を取る間に clear・所有者の文脈の終わり・アプリの終了が来たら、取れた記録を捨てて none を返す
   */
  async begin(ownerId: number, folderPath: string): Promise<AgentChangesState> {
    if (this.closed) return { kind: 'none' }
    const existing = this.currentRecord(ownerId, folderPath)
    if (existing !== null) return { kind: 'recording', startedAt: existing.startedAt }
    const generation = this.generationOf(ownerId)
    const inFlight = this.pending.get(ownerId)
    if (
      inFlight !== undefined &&
      inFlight.generation === generation &&
      inFlight.folderPath === folderPath
    ) {
      return inFlight.run
    }
    const isCanceled = (): boolean => this.closed || this.generationOf(ownerId) !== generation
    const run = (async (): Promise<AgentChangesState> => {
      const result = await this.deps.takeSnapshot(folderPath, { isCanceled })
      if (result.kind === 'canceled') return { kind: 'none' }
      if (result.kind === 'unavailable') return result.state
      if (isCanceled()) {
        await this.deps.removeDir(result.snapshot.tempDir)
        return { kind: 'none' }
      }
      this.records.set(ownerId, result.snapshot)
      return { kind: 'recording', startedAt: result.snapshot.startedAt }
    })()
    const entry = { generation, folderPath, run }
    this.pending.set(ownerId, entry)
    try {
      return await run
    } finally {
      if (this.pending.get(ownerId) === entry) this.pending.delete(ownerId)
    }
  }

  /** いまの状態(一覧を作らない)。記録のフォルダがいまの許可のフォルダと違えば、記録を捨てて none */
  getState(ownerId: number, folderPath: string): AgentChangesState {
    const record = this.currentRecord(ownerId, folderPath)
    return record === null ? { kind: 'none' } : { kind: 'recording', startedAt: record.startedAt }
  }

  /**
   * 記録を使う操作を所有者の列に並べて行う。列の順番が来た時点で記録が無い(clear 済み・フォルダが違う)なら
   * task を呼ばずに null を返す
   */
  withRecord<T>(
    ownerId: number,
    folderPath: string,
    task: (snapshot: BaselineSnapshot) => Promise<T>
  ): Promise<T | null> {
    return this.enqueue(ownerId, async () => {
      const record = this.currentRecord(ownerId, folderPath)
      return record === null ? null : task(record)
    })
  }

  /** 記録を捨てる(確認を終える・所有者の文脈の終わり)。記録を取る途中の依頼も取り消す */
  async clear(ownerId: number): Promise<void> {
    this.generations.set(ownerId, this.generationOf(ownerId) + 1)
    const record = this.records.get(ownerId)
    if (record === undefined) return
    this.records.delete(ownerId)
    await this.enqueue(ownerId, () => this.deps.removeDir(record.tempDir))
  }

  /** アプリの終了。以後の記録を取らず、すべての一時ディレクトリを待たずに消す */
  close(): void {
    this.closed = true
    for (const record of this.records.values()) this.deps.removeDirSync(record.tempDir)
    this.records.clear()
  }

  // 記録があり、そのフォルダがいまの許可のフォルダと同じなら返す。違えば捨てる(フォルダの切り替えの通知より先に依頼が来た場合)
  private currentRecord(ownerId: number, folderPath: string): BaselineSnapshot | null {
    const record = this.records.get(ownerId)
    if (record === undefined) return null
    if (record.folderPath === folderPath) return record
    void this.clear(ownerId)
    return null
  }

  private enqueue<T>(ownerId: number, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(ownerId) ?? Promise.resolve()
    const run = previous.then(task)
    const tail = run.catch(() => undefined)
    this.queues.set(ownerId, tail)
    void tail.then(() => {
      if (this.queues.get(ownerId) === tail) this.queues.delete(ownerId)
    })
    return run
  }
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineRegistry.test.ts 2>&1 | tail -n 5`
Expected: PASS（13 件）

- [ ] **Step 5: 変異で落ちることを確かめる**（手順は Task 4 の Step 5）

| #   | 置き換え前                                                | 置き換え後               | 落ちるテスト                                                        |
| --- | --------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| A1  | `      if (isCanceled()) {`                               | `      if (false) {`     | `記録の途中に clear が来たら取り消し`・`記録の途中に close したら`  |
| A2  | `inFlight.generation === generation && `                  | （空文字列）             | `取り消された世代の記録の途中の依頼には、新しい begin をまとめない` |
| A3  | `    if (record.folderPath === folderPath) return record` | `    return record`      | `記録のフォルダがいまの許可のフォルダと違えば none`                 |
| A4  | `    this.records.delete(ownerId)⏎    await`              | `    await`              | `操作の途中に clear が来たら`                                       |
| A5  | `    const run = previous.then(task)`                     | `    const run = task()` | `1 本の列で順に行う`・`操作の途中に clear が来たら`                 |

- [ ] **Step 6: 確認コマンド**

```bash
npm run typecheck 2>&1 | tail -n 5
npx prettier --write src/main/agentBaselineRegistry.ts src/main/__tests__/agentBaselineRegistry.test.ts
npx eslint src/main/agentBaselineRegistry.ts src/main/__tests__/agentBaselineRegistry.test.ts
```

---

### Task 8: main: 寿命・入力の検証・IPC の受け口・組み立て

**Files:**

- Create: `src/main/agentBaselineLifecycle.ts`、`src/main/handlers/agentChangesPayloadParser.ts`、`src/main/handlers/agentChangesHandlers.ts`、`src/main/__tests__/agentBaselineLifecycle.test.ts`、`src/main/__tests__/handlers/agentChangesPayloadParser.test.ts`、`src/main/__tests__/handlers/agentChangesHandlers.test.ts`
- Modify: `src/main/handlers/gitHandlers.ts:100-101`（`resolveAndAssertStatusRelativePath` を export）、`src/main/ipcHandlers.ts:30`（import）・`src/main/ipcHandlers.ts:75`（組み立て）、`src/main/__tests__/ipcHandlers.test.ts`（モックと配線のテスト）

**Interfaces:**

- Consumes: `AgentBaselineRegistry`（Task 7）、`takeBaselineSnapshot`・`removeBaselineDir`・`removeBaselineDirSync`（Task 4）、`listAgentChanges`・`getAgentChangeDiff`（Task 5）、`revertAgentChange`・`revertAgentChangeHunk`・`revertAllAgentChanges`（Task 6）、既存の `onOwnerContextEnded`（`ownerContextLifecycle.ts:16`）・`isMainFrameSender`・`AGENT_FOLDER_PATH_MAX_LENGTH`（`agentTerminalPayloadParser.ts:75・22`）・`moveToTrash`（`trash.ts:5`）
- Produces: `setupAgentBaselineLifecycle(app, registry: Pick<AgentBaselineRegistry, 'clear' | 'close'>, folderAccess): void`、`AGENT_CHANGES_PATCH_MAX_LENGTH = 10_000_000`・`parseAgentChangePath(value: unknown): string`・`parseAgentChangePatch(value: unknown): string`・`parseAgentRevertAllEntries(value: unknown): AgentRevertAllEntry[]`、`AGENT_CHANGES_NOT_MAIN_FRAME`・`AGENT_CHANGES_NO_RECORD_MESSAGE = 'エージェントの変更の記録がありません'`・`interface AgentChangesHandlerDeps { registry; folderAccess; trash }`・`registerAgentChangesHandlers(ipcMain, deps): void`（チャンネルは Global Constraints の 8 つ）
- 注: すべてのチャンネルで送信元がメインフレームかを最初に確かめる（既存の `git:*` は確かめていないが、エージェントの IPC と同じ扱いにする。設計書「セキュリティ」）。パスは `resolveAndAssertStatusRelativePath`（`git:discardChanges` と同じ規則。index の表記のまま・許可のフォルダの外は `Access denied`）。`before-quit` では registry を閉じるだけで終了は止めない（`agentSessionLifecycle` の 2 回目の `before-quit` で呼ばれても `close` は何もしない）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/handlers/agentChangesPayloadParser.test.ts`（新規）:

```ts
import { describe, it, expect } from 'vitest'
import {
  AGENT_CHANGES_PATCH_MAX_LENGTH,
  parseAgentChangePatch,
  parseAgentChangePath,
  parseAgentRevertAllEntries
} from '../../handlers/agentChangesPayloadParser'
import { AGENT_FOLDER_PATH_MAX_LENGTH } from '../../handlers/agentTerminalPayloadParser'

describe('parseAgentChangePath', () => {
  it('空でない文字列を返す', () => {
    expect(parseAgentChangePath('src/a.ts')).toBe('src/a.ts')
  })
  it.each<[string, unknown]>([
    ['空文字列', ''],
    ['数', 1],
    ['null', null],
    ['配列', ['a']],
    ['オブジェクト', { path: 'a' }]
  ])('%s なら投げる', (_label, value) => {
    expect(() => parseAgentChangePath(value)).toThrow('path は空でない文字列である必要があります')
  })
  it('上限ちょうどは通し、超えたら投げる', () => {
    const path = 'a'.repeat(AGENT_FOLDER_PATH_MAX_LENGTH)
    expect(parseAgentChangePath(path)).toBe(path)
    expect(() => parseAgentChangePath(path + 'a')).toThrow()
  })
})

describe('parseAgentChangePatch', () => {
  it('文字列(空を含む)を返す', () => {
    expect(parseAgentChangePatch('')).toBe('')
    expect(parseAgentChangePatch('diff --git a/x b/x\n')).toBe('diff --git a/x b/x\n')
  })
  it('文字列でなければ投げる', () => {
    expect(() => parseAgentChangePatch(undefined)).toThrow('patch は文字列である必要があります')
  })
  it('上限ちょうどは通し、超えたら投げる', () => {
    const patch = 'x'.repeat(AGENT_CHANGES_PATCH_MAX_LENGTH)
    expect(parseAgentChangePatch(patch)).toBe(patch)
    expect(() => parseAgentChangePatch(patch + 'x')).toThrow()
  })
})

describe('parseAgentRevertAllEntries', () => {
  it('{ path, status } に詰め直して返す(余分なキーは落とす)', () => {
    expect(
      parseAgentRevertAllEntries([
        { path: 'a.txt', status: 'M', extra: 1 },
        { path: 'dir/', status: 'A' }
      ])
    ).toEqual([
      { path: 'a.txt', status: 'M' },
      { path: 'dir/', status: 'A' }
    ])
  })
  it('空の配列は通す', () => {
    expect(parseAgentRevertAllEntries([])).toEqual([])
  })
  it.each<[string, unknown]>([
    ['配列でない', { path: 'a', status: 'M' }],
    ['要素が null', [null]],
    ['要素が配列', [['a', 'M']]],
    ['path が空', [{ path: '', status: 'M' }]],
    ['path が文字列でない', [{ path: 1, status: 'M' }]],
    ['status が不正', [{ path: 'a', status: '??' }]],
    ['status が無い', [{ path: 'a' }]]
  ])('%s なら投げる', (_label, value) => {
    expect(() => parseAgentRevertAllEntries(value)).toThrow('確認の一覧が不正です')
  })
  it('500 件は通し、501 件は投げる', () => {
    const entries = Array.from({ length: 500 }, (_, i) => ({ path: `${i}`, status: 'A' }))
    expect(parseAgentRevertAllEntries(entries)).toHaveLength(500)
    expect(() => parseAgentRevertAllEntries([...entries, { path: 'x', status: 'A' }])).toThrow()
  })
})
```

`src/main/__tests__/handlers/agentChangesHandlers.test.ts`（新規。一覧・diff・戻すの中身はモックにし、受け口の検証・所有者の分離・相対パス化を確かめる）:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../agentChangesQuery', () => ({
  listAgentChanges: vi.fn(),
  getAgentChangeDiff: vi.fn()
}))
vi.mock('../../agentChangesRevert', () => ({
  revertAgentChange: vi.fn(),
  revertAgentChangeHunk: vi.fn(),
  revertAllAgentChanges: vi.fn()
}))

import { FolderAccessManager } from '../../folderAccessManager'
import { AgentBaselineRegistry } from '../../agentBaselineRegistry'
import type { BaselineSnapshot } from '../../agentBaselineSnapshot'
import { getAgentChangeDiff, listAgentChanges } from '../../agentChangesQuery'
import {
  revertAgentChange,
  revertAgentChangeHunk,
  revertAllAgentChanges
} from '../../agentChangesRevert'
import {
  AGENT_CHANGES_NOT_MAIN_FRAME,
  AGENT_CHANGES_NO_RECORD_MESSAGE,
  registerAgentChangesHandlers
} from '../../handlers/agentChangesHandlers'

type Listener = (...args: unknown[]) => unknown
const handles = new Map<string, Listener>()
const ipcMain = {
  handle: vi.fn((channel: string, listener: Listener) => handles.set(channel, listener))
}
const makeEvent = (id = 1, main = true): unknown => ({
  sender: { id },
  senderFrame: { parent: main ? null : {} }
})
const invoke = (channel: string, event: unknown, ...args: unknown[]): Promise<unknown> =>
  Promise.resolve().then(() => {
    const handler = handles.get(channel)
    if (handler === undefined) throw new Error(`未登録: ${channel}`)
    return handler(event, ...args)
  })

let folder: string
let folderAccess: FolderAccessManager
let registry: AgentBaselineRegistry
const trash = vi.fn(async () => undefined)
const snapshotFor = (folderPath: string): BaselineSnapshot => ({
  folderPath,
  tempDir: '/tmp/baseline',
  indexPath: '/tmp/baseline/index',
  startedAt: 42,
  head: null,
  excluded: []
})

beforeEach(() => {
  vi.clearAllMocks()
  handles.clear()
  folder = realpathSync(mkdtempSync(join(tmpdir(), 'agent-changes-handlers-')))
  writeFileSync(join(folder, 'a.txt'), 'a')
  folderAccess = new FolderAccessManager()
  folderAccess.set(1, folder)
  registry = new AgentBaselineRegistry({
    takeSnapshot: async (folderPath) => ({ kind: 'recorded', snapshot: snapshotFor(folderPath) }),
    removeDir: vi.fn(async () => undefined),
    removeDirSync: vi.fn()
  })
  registerAgentChangesHandlers(ipcMain as never, { registry, folderAccess, trash })
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

describe('registerAgentChangesHandlers', () => {
  it('8 つのチャンネルを invoke で登録する', () => {
    expect([...handles.keys()].sort()).toEqual(
      [
        'agentChanges:begin',
        'agentChanges:clear',
        'agentChanges:getDiff',
        'agentChanges:getState',
        'agentChanges:list',
        'agentChanges:revertAll',
        'agentChanges:revertFile',
        'agentChanges:revertHunk'
      ].sort()
    )
  })

  it.each([
    ['agentChanges:begin', []],
    ['agentChanges:getState', []],
    ['agentChanges:list', []],
    ['agentChanges:getDiff', ['a.txt']],
    ['agentChanges:revertFile', ['a.txt']],
    ['agentChanges:revertHunk', ['a.txt', 'patch']],
    ['agentChanges:revertAll', [[]]],
    ['agentChanges:clear', []]
  ])('%s はメインフレーム以外からの依頼を拒否する', async (channel, args) => {
    await expect(invoke(channel, makeEvent(1, false), ...args)).rejects.toThrow(
      AGENT_CHANGES_NOT_MAIN_FRAME
    )
  })

  it('begin は送信元の許可のフォルダで記録を始め、getState・list はその記録を返す', async () => {
    vi.mocked(listAgentChanges).mockResolvedValue({
      entries: [{ path: 'a.txt', status: 'M', isDirectory: false, notRecorded: false }],
      totalCount: 1,
      truncated: false,
      headChanged: false
    })
    await expect(invoke('agentChanges:begin', makeEvent())).resolves.toEqual({
      kind: 'recording',
      startedAt: 42
    })
    await expect(invoke('agentChanges:getState', makeEvent())).resolves.toEqual({
      kind: 'recording',
      startedAt: 42
    })
    await expect(invoke('agentChanges:list', makeEvent())).resolves.toEqual({
      kind: 'recording',
      startedAt: 42,
      entries: [{ path: 'a.txt', status: 'M', isDirectory: false, notRecorded: false }],
      totalCount: 1,
      truncated: false,
      headChanged: false
    })
    expect(listAgentChanges).toHaveBeenCalledWith(snapshotFor(folder))
  })

  it('別のウィンドウの記録には触れない(所有者の分離)', async () => {
    folderAccess.set(2, folder)
    await invoke('agentChanges:begin', makeEvent(1))
    await expect(invoke('agentChanges:getState', makeEvent(2))).resolves.toEqual({ kind: 'none' })
    await expect(invoke('agentChanges:list', makeEvent(2))).resolves.toEqual({ kind: 'none' })
    await expect(invoke('agentChanges:revertFile', makeEvent(2), 'a.txt')).rejects.toThrow(
      AGENT_CHANGES_NO_RECORD_MESSAGE
    )
    expect(revertAgentChange).not.toHaveBeenCalled()
  })

  it('フォルダを開いていなければ begin・getState・list は none', async () => {
    await expect(invoke('agentChanges:begin', makeEvent(3))).resolves.toEqual({ kind: 'none' })
    await expect(invoke('agentChanges:getState', makeEvent(3))).resolves.toEqual({ kind: 'none' })
    await expect(invoke('agentChanges:list', makeEvent(3))).resolves.toEqual({ kind: 'none' })
  })

  it('getDiff・revertFile・revertHunk は許可のフォルダの中の相対パスにして渡す', async () => {
    await invoke('agentChanges:begin', makeEvent())
    vi.mocked(getAgentChangeDiff).mockResolvedValue('diff')
    await expect(invoke('agentChanges:getDiff', makeEvent(), 'a.txt')).resolves.toBe('diff')
    await invoke('agentChanges:revertFile', makeEvent(), 'gone/b.txt')
    await invoke('agentChanges:revertHunk', makeEvent(), 'a.txt', 'patch')
    expect(getAgentChangeDiff).toHaveBeenCalledWith(snapshotFor(folder), 'a.txt')
    expect(revertAgentChange).toHaveBeenCalledWith(
      { snapshot: snapshotFor(folder), trash },
      'gone/b.txt'
    )
    expect(revertAgentChangeHunk).toHaveBeenCalledWith(
      { snapshot: snapshotFor(folder), trash },
      'a.txt',
      'patch'
    )
  })

  it.each(['../outside.txt', join('/', 'etc', 'passwd'), ''])(
    'パス %j は許可のフォルダの外・不正として拒否し、戻さない',
    async (path) => {
      await invoke('agentChanges:begin', makeEvent())
      await expect(invoke('agentChanges:revertFile', makeEvent(), path)).rejects.toThrow()
      expect(revertAgentChange).not.toHaveBeenCalled()
    }
  )

  it('revertHunk はパッチの型を確かめる', async () => {
    await invoke('agentChanges:begin', makeEvent())
    await expect(invoke('agentChanges:revertHunk', makeEvent(), 'a.txt', 1)).rejects.toThrow(
      'patch は文字列である必要があります'
    )
    expect(revertAgentChangeHunk).not.toHaveBeenCalled()
  })

  it('revertAll は確認の一覧を検証して詰め直したものを渡し、結果を返す', async () => {
    await invoke('agentChanges:begin', makeEvent())
    vi.mocked(revertAllAgentChanges).mockResolvedValue({ status: 'done' })
    await expect(
      invoke('agentChanges:revertAll', makeEvent(), [{ path: 'a.txt', status: 'M', x: 1 }])
    ).resolves.toEqual({ status: 'done' })
    expect(revertAllAgentChanges).toHaveBeenCalledWith({ snapshot: snapshotFor(folder), trash }, [
      { path: 'a.txt', status: 'M' }
    ])
    await expect(invoke('agentChanges:revertAll', makeEvent(), 'all')).rejects.toThrow(
      '確認の一覧が不正です'
    )
  })

  it('記録が無ければ getDiff・revertFile・revertHunk・revertAll は例外にする', async () => {
    for (const [channel, args] of [
      ['agentChanges:getDiff', ['a.txt']],
      ['agentChanges:revertFile', ['a.txt']],
      ['agentChanges:revertHunk', ['a.txt', 'p']],
      ['agentChanges:revertAll', [[]]]
    ] as const) {
      await expect(invoke(channel, makeEvent(), ...args)).rejects.toThrow(
        AGENT_CHANGES_NO_RECORD_MESSAGE
      )
    }
  })

  it('clear で記録を捨てる', async () => {
    await invoke('agentChanges:begin', makeEvent())
    await invoke('agentChanges:clear', makeEvent())
    await expect(invoke('agentChanges:getState', makeEvent())).resolves.toEqual({ kind: 'none' })
  })
})
```

`src/main/__tests__/agentBaselineLifecycle.test.ts`（新規）:

```ts
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { FolderAccessManager } from '../folderAccessManager'
import { setupAgentBaselineLifecycle } from '../agentBaselineLifecycle'

function setup(): {
  app: EventEmitter
  clear: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  folderAccess: FolderAccessManager
} {
  const app = new EventEmitter()
  const clear = vi.fn(async () => undefined)
  const close = vi.fn()
  const folderAccess = new FolderAccessManager()
  setupAgentBaselineLifecycle(app as unknown as App, { clear, close }, folderAccess)
  return { app, clear, close, folderAccess }
}

const createWebContents = (app: EventEmitter, id: number): EventEmitter => {
  const webContents = Object.assign(new EventEmitter(), { id })
  app.emit('web-contents-created', {}, webContents)
  return webContents
}

describe('setupAgentBaselineLifecycle', () => {
  it.each<[string, (webContents: EventEmitter) => void]>([
    ['ウィンドウの破棄', (w) => w.emit('destroyed')],
    ['renderer のプロセスの終了', (w) => w.emit('render-process-gone')],
    ['リロード(文書の入れ替わり)', (w) => w.emit('did-navigate', {}, 'app://index.html', 200, 'OK')]
  ])('%s でその所有者の記録を捨てる', (_label, trigger) => {
    const { app, clear } = setup()
    const webContents = createWebContents(app, 7)
    createWebContents(app, 8)
    trigger(webContents)
    expect(clear).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('フォルダが別のパスに変わったら捨て、同じパスなら捨てない', () => {
    const { clear, folderAccess } = setup()
    folderAccess.set(1, '/a')
    clear.mockClear()
    folderAccess.set(1, '/a')
    expect(clear).not.toHaveBeenCalled()
    folderAccess.set(1, '/b')
    expect(clear).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('捨てる失敗は未処理の拒否にしない', async () => {
    const { app, clear } = setup()
    clear.mockRejectedValueOnce(new Error('rm failed'))
    const webContents = createWebContents(app, 7)
    expect(() => webContents.emit('destroyed')).not.toThrow()
    await Promise.resolve()
  })

  it('アプリの終了(before-quit)で registry を閉じ、終了は止めない', () => {
    const { app, close } = setup()
    const event = { preventDefault: vi.fn() }
    app.emit('before-quit', event)
    expect(close).toHaveBeenCalledOnce()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
```

`src/main/__tests__/ipcHandlers.test.ts` の変更（配線のテスト。パターン 155）:

```diff
--- a/src/main/__tests__/ipcHandlers.test.ts
+++ b/src/main/__tests__/ipcHandlers.test.ts
@@ -26,6 +26,16 @@ const mockSendExternalChange = vi.hoisted(() => vi.fn())
 // 親ディレクトリの監視(fs.watch)。実物のディレクトリを監視しない
 const mockWatch = vi.hoisted(() => vi.fn(() => ({ close: vi.fn(), on: vi.fn() })))

+const mockSetupAgentBaselineLifecycle = vi.hoisted(() => vi.fn())
+const mockRegisterAgentChangesHandlers = vi.hoisted(() => vi.fn())
+const mockMoveToTrash = vi.hoisted(() => vi.fn())
+vi.mock('../agentBaselineLifecycle', () => ({
+  setupAgentBaselineLifecycle: mockSetupAgentBaselineLifecycle
+}))
+vi.mock('../handlers/agentChangesHandlers', () => ({
+  registerAgentChangesHandlers: mockRegisterAgentChangesHandlers
+}))
+vi.mock('../trash', () => ({ moveToTrash: mockMoveToTrash }))
 vi.mock('electron', () => ({
   app: {},
   shell: { openExternal: vi.fn() }
@@ -90,6 +100,7 @@ vi.mock('../handlers/claudeHandlers', () => ({
 import { registerIpcHandlers } from '../ipcHandlers'
 import { CloneRegistry } from '../cloneRegistry'
 import { AgentSessionRegistry } from '../agentSessionRegistry'
+import { AgentBaselineRegistry } from '../agentBaselineRegistry'
 import { OpenFileWatcher, EXTERNAL_CHANGE_DEBOUNCE_MS } from '../openFileWatcher'

 const mockIpcMain = { handle: mockHandle } as never
@@ -176,6 +187,19 @@ describe('registerIpcHandlers', () => {
     expect(deps.startSession).toBe(mockStartAgentSession)
   })

+  it('エージェントの変更の記録の寿命と IPC に、ファイル操作と同じ FolderAccessManager・同じ記録の registry・ゴミ箱を渡す', () => {
+    registerIpcHandlers(mockIpcMain)
+    const folderAccess = mockRegisterFileSystemHandlers.mock.calls[0][1]
+    const [, registry, lifecycleFolderAccess] = mockSetupAgentBaselineLifecycle.mock.calls[0]
+    expect(registry).toBeInstanceOf(AgentBaselineRegistry)
+    expect(lifecycleFolderAccess).toBe(folderAccess)
+    const [ipcMain, deps] = mockRegisterAgentChangesHandlers.mock.calls[0]
+    expect(ipcMain).toBe(mockIpcMain)
+    expect(deps.registry).toBe(registry)
+    expect(deps.folderAccess).toBe(folderAccess)
+    expect(deps.trash).toBe(mockMoveToTrash)
+  })
+
   it('エージェントの起動の規則(starter)を、同じ FolderAccessManager・同じ registry・実物の起動の部品で組み立てる', () => {
     registerIpcHandlers(mockIpcMain)
     const folderAccess = mockRegisterFileSystemHandlers.mock.calls[0][1]
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/handlers/agentChangesPayloadParser.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/agentBaselineLifecycle.test.ts src/main/__tests__/ipcHandlers.test.ts 2>&1 | tail -n 5`
Expected: FAIL（新しいファイルが無い・`mockSetupAgentBaselineLifecycle` が呼ばれない）

- [ ] **Step 3: 実装する**

`src/main/handlers/agentChangesPayloadParser.ts`（新規）:

```ts
import type { AgentRevertAllEntry } from '@shared/types'
import { AGENT_CHANGES_LIST_LIMIT, isAgentChangeStatus } from '@shared/types'
import { AGENT_FOLDER_PATH_MAX_LENGTH } from './agentTerminalPayloadParser'

// agentChanges:* の入力の型の検証(設計書「セキュリティ」)。値の中身(許可のフォルダの中か・いまの一覧に含まれるか・パッチの
// 対象)は受け口(resolveAndAssertStatusRelativePath)と agentChangesRevert が確かめる。ここは型と粗い上限だけ

/** パッチの長さの上限(UTF-16 の単位)。git apply に巨大な入力を渡さないための粗い上限(差異 2) */
export const AGENT_CHANGES_PATCH_MAX_LENGTH = 10_000_000

/** リポジトリ相対のパス。空でない文字列で、realpath に渡す前の粗い上限はフォルダのパスと同じ */
export function parseAgentChangePath(value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error('path は空でない文字列である必要があります')
  }
  if (value.length > AGENT_FOLDER_PATH_MAX_LENGTH) {
    throw new Error(`path は ${AGENT_FOLDER_PATH_MAX_LENGTH} 文字以下である必要があります`)
  }
  return value
}

export function parseAgentChangePatch(value: unknown): string {
  if (typeof value !== 'string') throw new Error('patch は文字列である必要があります')
  if (value.length > AGENT_CHANGES_PATCH_MAX_LENGTH) {
    throw new Error(`patch は ${AGENT_CHANGES_PATCH_MAX_LENGTH} 文字以下である必要があります`)
  }
  return value
}

/** 「すべて戻す」の確認の一覧。{ path, status } の配列(最大 AGENT_CHANGES_LIST_LIMIT 件)。余分なキーは詰め直して落とす */
export function parseAgentRevertAllEntries(value: unknown): AgentRevertAllEntry[] {
  if (!Array.isArray(value) || value.length > AGENT_CHANGES_LIST_LIMIT) {
    throw new Error('確認の一覧が不正です')
  }
  return value.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('確認の一覧が不正です')
    }
    const { path, status } = entry as Record<string, unknown>
    if (typeof path !== 'string' || path === '' || path.length > AGENT_FOLDER_PATH_MAX_LENGTH) {
      throw new Error('確認の一覧が不正です')
    }
    if (!isAgentChangeStatus(status)) throw new Error('確認の一覧が不正です')
    return { path, status }
  })
}
```

`src/main/handlers/agentChangesHandlers.ts`（新規）:

```ts
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AgentChangesListResult, AgentChangesState, DiscardAllResult } from '@shared/types'
import type { AgentBaselineRegistry } from '../agentBaselineRegistry'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import { getAgentChangeDiff, listAgentChanges } from '../agentChangesQuery'
import {
  revertAgentChange,
  revertAgentChangeHunk,
  revertAllAgentChanges
} from '../agentChangesRevert'
import type { FolderAccessManager } from '../folderAccessManager'
import { isMainFrameSender } from './agentTerminalPayloadParser'
import {
  parseAgentChangePatch,
  parseAgentChangePath,
  parseAgentRevertAllEntries
} from './agentChangesPayloadParser'
import { resolveAndAssertStatusRelativePath } from './gitHandlers'

// エージェントの変更の IPC の受け口(設計書「IPC」「セキュリティ」)。renderer から受け取るのはパス・パッチ・確認の一覧だけで、
// 記録のインデックスの場所・フォルダ・git の引数は main が決める。記録は送信元の webContents の id で引く(所有者の分離)

export const AGENT_CHANGES_NOT_MAIN_FRAME = 'メインフレーム以外からの依頼は受け付けません'
export const AGENT_CHANGES_NO_RECORD_MESSAGE = 'エージェントの変更の記録がありません'

export interface AgentChangesHandlerDeps {
  registry: Pick<AgentBaselineRegistry, 'begin' | 'getState' | 'withRecord' | 'clear'>
  folderAccess: FolderAccessManager
  /** OS のゴミ箱へ移す(trash.ts の moveToTrash) */
  trash: (absolutePath: string) => Promise<void>
}

export function registerAgentChangesHandlers(
  ipcMain: IpcMain,
  { registry, folderAccess, trash }: AgentChangesHandlerDeps
): void {
  // 送信元の確認と、許可のフォルダ(無ければ null)
  const ownerOf = (event: IpcMainInvokeEvent): { ownerId: number; folder: string | null } => {
    if (!isMainFrameSender(event)) throw new Error(AGENT_CHANGES_NOT_MAIN_FRAME)
    return { ownerId: event.sender.id, folder: folderAccess.get(event.sender.id) ?? null }
  }
  // パスの検証(許可のフォルダの中・index の表記のまま。git:discardChanges と同じ規則)
  const relativePathOf = async (folder: string, path: unknown): Promise<string> =>
    resolveAndAssertStatusRelativePath(folderAccess, folder, parseAgentChangePath(path))
  // 記録を使う操作。フォルダが無い・記録が無いなら例外
  const withRecordOrThrow = async <T>(
    ownerId: number,
    folder: string | null,
    task: (snapshot: BaselineSnapshot) => Promise<T>
  ): Promise<T> => {
    if (folder === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
    const result = await registry.withRecord(ownerId, folder, task)
    if (result === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
    return result
  }

  ipcMain.handle('agentChanges:begin', async (event): Promise<AgentChangesState> => {
    const { ownerId, folder } = ownerOf(event)
    if (folder === null) return { kind: 'none' }
    return registry.begin(ownerId, folder)
  })

  ipcMain.handle('agentChanges:getState', (event): AgentChangesState => {
    const { ownerId, folder } = ownerOf(event)
    return folder === null ? { kind: 'none' } : registry.getState(ownerId, folder)
  })

  ipcMain.handle('agentChanges:list', async (event): Promise<AgentChangesListResult> => {
    const { ownerId, folder } = ownerOf(event)
    if (folder === null) return { kind: 'none' }
    const result = await registry.withRecord(ownerId, folder, async (snapshot) => ({
      kind: 'recording' as const,
      startedAt: snapshot.startedAt,
      ...(await listAgentChanges(snapshot))
    }))
    return result ?? { kind: 'none' }
  })

  ipcMain.handle('agentChanges:getDiff', async (event, path: unknown): Promise<string> => {
    const { ownerId, folder } = ownerOf(event)
    if (folder === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
    const relativePath = await relativePathOf(folder, path)
    return withRecordOrThrow(ownerId, folder, (snapshot) =>
      getAgentChangeDiff(snapshot, relativePath)
    )
  })

  ipcMain.handle('agentChanges:revertFile', async (event, path: unknown): Promise<void> => {
    const { ownerId, folder } = ownerOf(event)
    if (folder === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
    const relativePath = await relativePathOf(folder, path)
    await withRecordOrThrow(ownerId, folder, (snapshot) =>
      revertAgentChange({ snapshot, trash }, relativePath)
    )
  })

  ipcMain.handle(
    'agentChanges:revertHunk',
    async (event, path: unknown, patch: unknown): Promise<void> => {
      const { ownerId, folder } = ownerOf(event)
      const parsedPatch = parseAgentChangePatch(patch)
      if (folder === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
      const relativePath = await relativePathOf(folder, path)
      await withRecordOrThrow(ownerId, folder, (snapshot) =>
        revertAgentChangeHunk({ snapshot, trash }, relativePath, parsedPatch)
      )
    }
  )

  ipcMain.handle(
    'agentChanges:revertAll',
    async (event, expected: unknown): Promise<DiscardAllResult> => {
      const { ownerId, folder } = ownerOf(event)
      const entries = parseAgentRevertAllEntries(expected)
      return withRecordOrThrow(ownerId, folder, (snapshot) =>
        revertAllAgentChanges({ snapshot, trash }, entries)
      )
    }
  )

  ipcMain.handle('agentChanges:clear', async (event): Promise<void> => {
    const { ownerId } = ownerOf(event)
    await registry.clear(ownerId)
  })
}
```

`src/main/agentBaselineLifecycle.ts`（新規）:

```ts
import type { App } from 'electron'
import type { FolderAccessManager } from './folderAccessManager'
import type { AgentBaselineRegistry } from './agentBaselineRegistry'
import { onOwnerContextEnded } from './ownerContextLifecycle'

// エージェントの変更の記録を捨てる契機(設計書「エラー処理」・決定した点 4): ウィンドウの破棄・renderer のプロセスの終了・
// リロード(メインフレームの文書が実際に入れ替わったとき)・フォルダの切り替え(ownerContextLifecycle.ts)と、アプリの終了
// (before-quit で一時ディレクトリを待たずに消す)。異常終了で残った一時ディレクトリは OS の掃除に任せる
export function setupAgentBaselineLifecycle(
  app: App,
  registry: Pick<AgentBaselineRegistry, 'clear' | 'close'>,
  folderAccess: Pick<FolderAccessManager, 'onDidChange'>
): void {
  onOwnerContextEnded(app, folderAccess, ({ ownerId }) => {
    void registry.clear(ownerId).catch(() => undefined)
  })
  app.on('before-quit', () => registry.close())
}
```

`src/main/handlers/gitHandlers.ts` の変更:

```diff
--- a/src/main/handlers/gitHandlers.ts
+++ b/src/main/handlers/gitHandlers.ts
@@ -97,8 +97,9 @@ export async function resolveAndAssertRelativePath(
 // しない」ことから未追跡と誤判定し、追跡済みの変更ファイルをゴミ箱へ移していた(PR レビュー
 // 指摘、実機で再現)。シンボリックリンクを経由したパスは、discardFileChanges が未追跡を
 // ls-files --others で肯定的に確かめるため、判定不能として拒否される。
-// 境界チェックを通っても相対パスが許可フォルダの外を指す場合は、git へ渡さずに拒否する
-async function resolveAndAssertStatusRelativePath(
+// 境界チェックを通っても相対パスが許可フォルダの外を指す場合は、git へ渡さずに拒否する。
+// エージェントの変更の IPC(agentChangesHandlers.ts)も同じ規則を使う
+export async function resolveAndAssertStatusRelativePath(
   folderAccess: FolderAccessManager,
   allowedFolder: string,
   filePath: string
```

`src/main/ipcHandlers.ts` の変更:

```diff
--- a/src/main/ipcHandlers.ts
+++ b/src/main/ipcHandlers.ts
@@ -28,6 +28,15 @@ import {
   sendExternalChange
 } from './handlers/externalChangeHandlers'
 import { registerShellHandlers } from './handlers/shellHandlers'
+import { AgentBaselineRegistry } from './agentBaselineRegistry'
+import { setupAgentBaselineLifecycle } from './agentBaselineLifecycle'
+import {
+  removeBaselineDir,
+  removeBaselineDirSync,
+  takeBaselineSnapshot
+} from './agentBaselineSnapshot'
+import { registerAgentChangesHandlers } from './handlers/agentChangesHandlers'
+import { moveToTrash } from './trash'

 export function registerIpcHandlers(ipcMain: IpcMain): void {
   const folderAccess = new FolderAccessManager()
@@ -73,4 +82,16 @@ export function registerIpcHandlers(ipcMain: IpcMain): void {
   setupOpenFileWatcherLifecycle(app, openFileWatcher, folderAccess)
   registerExternalChangeHandlers(ipcMain, folderAccess, openFileWatcher)
   registerShellHandlers(ipcMain, (url) => shell.openExternal(url))
+  // エージェントの変更の記録(所有者ごと)。フォルダの切り替え・リロード・破棄・アプリの終了で捨てる
+  const agentBaselineRegistry = new AgentBaselineRegistry({
+    takeSnapshot: (folderPath, options) => takeBaselineSnapshot(folderPath, options),
+    removeDir: removeBaselineDir,
+    removeDirSync: removeBaselineDirSync
+  })
+  setupAgentBaselineLifecycle(app, agentBaselineRegistry, folderAccess)
+  registerAgentChangesHandlers(ipcMain, {
+    registry: agentBaselineRegistry,
+    folderAccess,
+    trash: moveToTrash
+  })
 }
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/main/__tests__/handlers/agentChangesPayloadParser.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/agentBaselineLifecycle.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/handlers/gitHandlers.test.ts 2>&1 | tail -n 5`
Expected: PASS

- [ ] **Step 5: 変異で落ちることを確かめる**（手順は Task 4 の Step 5）

| #   | ファイル                  | 置き換え前                                                                                 | 置き換え後                         | 落ちるテスト                                     |
| --- | ------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------ |
| A1  | `agentChangesHandlers.ts` | `    if (!isMainFrameSender(event)) throw new Error(AGENT_CHANGES_NOT_MAIN_FRAME)`         | （空行）                           | `メインフレーム以外からの依頼を拒否する`（8 件） |
| A2  | `agentChangesHandlers.ts` | `    resolveAndAssertStatusRelativePath(folderAccess, folder, parseAgentChangePath(path))` | `    parseAgentChangePath(path)`   | `許可のフォルダの外・不正として拒否し、戻さない` |
| A3  | `agentChangesHandlers.ts` | `    return { ownerId: event.sender.id, folder:`                                           | `    return { ownerId: 1, folder:` | `別のウィンドウの記録には触れない`               |

- [ ] **Step 6: 確認コマンド**

```bash
npm run typecheck 2>&1 | tail -n 5
npx prettier --write src/main/agentBaselineLifecycle.ts src/main/handlers/agentChangesPayloadParser.ts src/main/handlers/agentChangesHandlers.ts src/main/handlers/gitHandlers.ts src/main/ipcHandlers.ts src/main/__tests__/agentBaselineLifecycle.test.ts src/main/__tests__/handlers/agentChangesPayloadParser.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts
npx eslint src/main/agentBaselineLifecycle.ts src/main/handlers/agentChangesPayloadParser.ts src/main/handlers/agentChangesHandlers.ts src/main/handlers/gitHandlers.ts src/main/ipcHandlers.ts src/main/__tests__/agentBaselineLifecycle.test.ts src/main/__tests__/handlers/agentChangesPayloadParser.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts
npx vitest run src/main 2>&1 | grep -E "Test Files|Tests "
```

---

### Task 9: preload の API・renderer の窓口・テストの stub

**Files:**

- Create: `src/renderer/src/lib/agentChangesApi.ts`、`src/renderer/src/lib/__tests__/agentChangesApi.test.ts`
- Modify: `src/preload/api.ts:2`（型の import）・`src/preload/api.ts:229-230`（末尾に 8 つ）、`src/preload/index.d.ts:2`・`src/preload/index.d.ts:133`、`src/preload/__tests__/api.test.ts:309`（`describe('api'` の前に describe を足す）、`src/renderer/src/__tests__/setup.ts:61`（`window.api` の stub に 8 つ。既定は記録なし）

**Interfaces:**

- Consumes: Task 1 の型、Task 8 のチャンネル
- Produces: `window.api` の 8 つ（Global Constraints）、`lib/agentChangesApi.ts` の同名の 8 つの関数（`beginAgentChanges(): Promise<AgentChangesState>`・`getAgentChangesState()`・`listAgentChanges(): Promise<AgentChangesListResult>`・`getAgentChangeDiff(path)`・`revertAgentChange(path)`・`revertAgentChangeHunk(path, patch)`・`revertAllAgentChanges(expected): Promise<DiscardAllResult>`・`clearAgentChanges()`）

- [ ] **Step 1: 失敗するテストを書く**

`src/preload/__tests__/api.test.ts` の変更:

```diff
--- a/src/preload/__tests__/api.test.ts
+++ b/src/preload/__tests__/api.test.ts
@@ -306,6 +306,54 @@ const invokeCases: Array<[string, () => unknown, unknown[]]> = [
   ]
 ]

+describe('エージェントの変更の API', () => {
+  it.each<[string, () => unknown, unknown[]]>([
+    [
+      'beginAgentChanges は agentChanges:begin を呼ぶ',
+      () => api.beginAgentChanges(),
+      ['agentChanges:begin']
+    ],
+    [
+      'getAgentChangesState は agentChanges:getState を呼ぶ',
+      () => api.getAgentChangesState(),
+      ['agentChanges:getState']
+    ],
+    [
+      'listAgentChanges は agentChanges:list を呼ぶ',
+      () => api.listAgentChanges(),
+      ['agentChanges:list']
+    ],
+    [
+      'getAgentChangeDiff は agentChanges:getDiff にパスを渡す',
+      () => api.getAgentChangeDiff('a.txt'),
+      ['agentChanges:getDiff', 'a.txt']
+    ],
+    [
+      'revertAgentChange は agentChanges:revertFile にパスを渡す',
+      () => api.revertAgentChange('a.txt'),
+      ['agentChanges:revertFile', 'a.txt']
+    ],
+    [
+      'revertAgentChangeHunk は agentChanges:revertHunk にパスとパッチを渡す',
+      () => api.revertAgentChangeHunk('a.txt', 'patch'),
+      ['agentChanges:revertHunk', 'a.txt', 'patch']
+    ],
+    [
+      'revertAllAgentChanges は agentChanges:revertAll に確認の一覧を渡す',
+      () => api.revertAllAgentChanges([{ path: 'a.txt', status: 'M' }]),
+      ['agentChanges:revertAll', [{ path: 'a.txt', status: 'M' }]]
+    ],
+    [
+      'clearAgentChanges は agentChanges:clear を呼ぶ',
+      () => api.clearAgentChanges(),
+      ['agentChanges:clear']
+    ]
+  ])('%s', (_name, call, expectedArgs) => {
+    call()
+    expect(mockInvoke).toHaveBeenCalledWith(...expectedArgs)
+  })
+})
+
 describe('api', () => {
   it.each(invokeCases)('%s', (_name, call, expectedArgs) => {
     call()
```

`src/renderer/src/lib/__tests__/agentChangesApi.test.ts`（新規）:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as agentChangesApi from '../agentChangesApi'

const mockApi = {
  beginAgentChanges: vi.fn(),
  getAgentChangesState: vi.fn(),
  listAgentChanges: vi.fn(),
  getAgentChangeDiff: vi.fn(),
  revertAgentChange: vi.fn(),
  revertAgentChangeHunk: vi.fn(),
  revertAllAgentChanges: vi.fn(),
  clearAgentChanges: vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

describe('agentChangesApi', () => {
  it('各関数は window.api の同名の関数へ引数をそのまま渡し、結果を返す', async () => {
    mockApi.beginAgentChanges.mockResolvedValue({ kind: 'recording', startedAt: 1 })
    mockApi.revertAllAgentChanges.mockResolvedValue({ status: 'done' })
    await expect(agentChangesApi.beginAgentChanges()).resolves.toEqual({
      kind: 'recording',
      startedAt: 1
    })
    await agentChangesApi.getAgentChangesState()
    await agentChangesApi.listAgentChanges()
    await agentChangesApi.getAgentChangeDiff('a.txt')
    await agentChangesApi.revertAgentChange('a.txt')
    await agentChangesApi.revertAgentChangeHunk('a.txt', 'patch')
    await expect(
      agentChangesApi.revertAllAgentChanges([{ path: 'a.txt', status: 'M' }])
    ).resolves.toEqual({ status: 'done' })
    await agentChangesApi.clearAgentChanges()
    expect(mockApi.getAgentChangesState).toHaveBeenCalledOnce()
    expect(mockApi.listAgentChanges).toHaveBeenCalledOnce()
    expect(mockApi.getAgentChangeDiff).toHaveBeenCalledWith('a.txt')
    expect(mockApi.revertAgentChange).toHaveBeenCalledWith('a.txt')
    expect(mockApi.revertAgentChangeHunk).toHaveBeenCalledWith('a.txt', 'patch')
    expect(mockApi.revertAllAgentChanges).toHaveBeenCalledWith([{ path: 'a.txt', status: 'M' }])
    expect(mockApi.clearAgentChanges).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/agentChangesApi.test.ts 2>&1 | tail -n 5`
Expected: FAIL（`api.beginAgentChanges is not a function`・`../agentChangesApi` が無い）

- [ ] **Step 3: 実装する**

`src/preload/api.ts` の変更:

```diff
--- a/src/preload/api.ts
+++ b/src/preload/api.ts
@@ -1,5 +1,8 @@
 import { ipcRenderer } from 'electron'
 import type {
+  AgentChangesListResult,
+  AgentChangesState,
+  AgentRevertAllEntry,
   AgentSessionData,
   AgentSessionExit,
   AgentSessionSnapshot,
@@ -227,5 +230,19 @@ export const api = {
     }
   },
   openExternalLink: (url: string): Promise<boolean> =>
-    ipcRenderer.invoke('shell:openExternalLink', url)
+    ipcRenderer.invoke('shell:openExternalLink', url),
+  // エージェントの変更(記録・一覧・diff・戻す)。記録の場所・フォルダ・git の引数は main が決める
+  beginAgentChanges: (): Promise<AgentChangesState> => ipcRenderer.invoke('agentChanges:begin'),
+  getAgentChangesState: (): Promise<AgentChangesState> =>
+    ipcRenderer.invoke('agentChanges:getState'),
+  listAgentChanges: (): Promise<AgentChangesListResult> => ipcRenderer.invoke('agentChanges:list'),
+  getAgentChangeDiff: (path: string): Promise<string> =>
+    ipcRenderer.invoke('agentChanges:getDiff', path),
+  revertAgentChange: (path: string): Promise<void> =>
+    ipcRenderer.invoke('agentChanges:revertFile', path),
+  revertAgentChangeHunk: (path: string, patch: string): Promise<void> =>
+    ipcRenderer.invoke('agentChanges:revertHunk', path, patch),
+  revertAllAgentChanges: (expected: AgentRevertAllEntry[]): Promise<DiscardAllResult> =>
+    ipcRenderer.invoke('agentChanges:revertAll', expected),
+  clearAgentChanges: (): Promise<void> => ipcRenderer.invoke('agentChanges:clear')
 }
```

`src/preload/index.d.ts` の変更:

```diff
--- a/src/preload/index.d.ts
+++ b/src/preload/index.d.ts
@@ -1,4 +1,7 @@
 import type {
+  AgentChangesListResult,
+  AgentChangesState,
+  AgentRevertAllEntry,
   AgentSessionData,
   AgentSessionExit,
   AgentSessionSnapshot,
@@ -131,6 +134,14 @@ declare global {
       setWatchedFiles(paths: string[]): Promise<void>
       onExternalFileChange(listener: (event: ExternalFileChangeEvent) => void): () => void
       openExternalLink(url: string): Promise<boolean>
+      beginAgentChanges(): Promise<AgentChangesState>
+      getAgentChangesState(): Promise<AgentChangesState>
+      listAgentChanges(): Promise<AgentChangesListResult>
+      getAgentChangeDiff(path: string): Promise<string>
+      revertAgentChange(path: string): Promise<void>
+      revertAgentChangeHunk(path: string, patch: string): Promise<void>
+      revertAllAgentChanges(expected: AgentRevertAllEntry[]): Promise<DiscardAllResult>
+      clearAgentChanges(): Promise<void>
     }
   }
 }
```

`src/renderer/src/__tests__/setup.ts` の変更:

```diff
--- a/src/renderer/src/__tests__/setup.ts
+++ b/src/renderer/src/__tests__/setup.ts
@@ -58,6 +58,15 @@ Object.defineProperty(window, 'api', {
     writeFileChecked: () => Promise.resolve({ kind: 'written' }),
     setWatchedFiles: () => Promise.resolve(),
     onExternalFileChange: () => () => {},
-    openExternalLink: () => Promise.resolve(true)
+    openExternalLink: () => Promise.resolve(true),
+    // エージェントの変更。既定は記録なし(個別のテストで差し替える)
+    beginAgentChanges: () => Promise.resolve({ kind: 'none' }),
+    getAgentChangesState: () => Promise.resolve({ kind: 'none' }),
+    listAgentChanges: () => Promise.resolve({ kind: 'none' }),
+    getAgentChangeDiff: () => Promise.resolve(''),
+    revertAgentChange: () => Promise.resolve(),
+    revertAgentChangeHunk: () => Promise.resolve(),
+    revertAllAgentChanges: () => Promise.resolve({ status: 'done' }),
+    clearAgentChanges: () => Promise.resolve()
   }
 })
```

`src/renderer/src/lib/agentChangesApi.ts`（新規）:

```ts
import type {
  AgentChangesListResult,
  AgentChangesState,
  AgentRevertAllEntry,
  DiscardAllResult
} from '@shared/types'

// エージェントの変更の IPC の窓口(window.api)。renderer の部品は window.api を直接触らずここを使う

export function beginAgentChanges(): Promise<AgentChangesState> {
  return window.api.beginAgentChanges()
}

export function getAgentChangesState(): Promise<AgentChangesState> {
  return window.api.getAgentChangesState()
}

export function listAgentChanges(): Promise<AgentChangesListResult> {
  return window.api.listAgentChanges()
}

export function getAgentChangeDiff(path: string): Promise<string> {
  return window.api.getAgentChangeDiff(path)
}

export function revertAgentChange(path: string): Promise<void> {
  return window.api.revertAgentChange(path)
}

export function revertAgentChangeHunk(path: string, patch: string): Promise<void> {
  return window.api.revertAgentChangeHunk(path, patch)
}

export function revertAllAgentChanges(expected: AgentRevertAllEntry[]): Promise<DiscardAllResult> {
  return window.api.revertAllAgentChanges(expected)
}

export function clearAgentChanges(): Promise<void> {
  return window.api.clearAgentChanges()
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/preload src/renderer/src/lib/__tests__/agentChangesApi.test.ts 2>&1 | tail -n 5`
Expected: PASS

- [ ] **Step 5: 確認コマンド**

```bash
npm run typecheck 2>&1 | tail -n 5
npx prettier --write src/preload/api.ts src/preload/index.d.ts src/preload/__tests__/api.test.ts src/renderer/src/__tests__/setup.ts src/renderer/src/lib/agentChangesApi.ts src/renderer/src/lib/__tests__/agentChangesApi.test.ts
npx eslint src/preload/api.ts src/preload/index.d.ts src/preload/__tests__/api.test.ts src/renderer/src/__tests__/setup.ts src/renderer/src/lib/agentChangesApi.ts src/renderer/src/lib/__tests__/agentChangesApi.test.ts
```

---

### Task 10: renderer: diff タブのキーを `staged` から `kind` へ（挙動を変えない）

設計書「diff タブの種類」の前者（`{ path, kind }`）。この Task では `'unstaged' | 'staged'` だけにし、`'agent'` は Task 14 で足す。

**Files:**

- Modify: `src/renderer/src/hooks/useDiffTabs.ts:5-8・26`、`src/renderer/src/hooks/diffTabPath.ts:1・16・26-28`、`src/renderer/src/hooks/useCombinedEditorTabs.ts:70`、`src/renderer/src/hooks/useDiffOperations.ts:65-68・194・345`、`src/renderer/src/hooks/useAppState.ts:217`、`src/renderer/src/App.tsx:152`
- Test（機械的な置き換え）: `components/__tests__/EditorPanel.test.tsx`・`EditorPanel.applyOutput.test.tsx`、`hooks/__tests__/useAppState.test.ts`・`useAppState.agent.test.ts`・`useDiffOperations.test.ts`・`diffTabPath.test.ts`・`useCombinedEditorTabs.test.ts`・`useDiffTabs.test.ts`

**Interfaces:**

- Consumes: なし
- Produces: `type DiffTabKind = 'unstaged' | 'staged'`、`interface DiffTabKey { path: string; kind: DiffTabKind }`（`useDiffTabs.ts`）。`encodeDiffTabPath` の印は従来の `staged`・`unstaged` のまま（`key.kind` をそのまま入れる）。`Sidebar`・`SourceControlPanel`・`GitRepoView` の `onOpenDiff(path, staged: boolean)` は変えない（App で `kind` に直す）

- [ ] **Step 1: テストを先に置き換える**

リポジトリの最上位で次のスクリプトをファイルに書いて実行し、整形する（`staged: true`→`kind: 'staged'`、`staged: false`→`kind: 'unstaged'`、変数に入れたキーへ `: DiffTabKey` を付ける。`DiffView.test.tsx` の `staged` は DiffView の props なので対象外）:

```bash
SCRIPT="$(mktemp -d)/task10-tests.py"
cat > "$SCRIPT" <<'PY'
# diff タブのキーの staged: boolean を kind に置き換える(テストのファイルだけ。機械的な置き換え)
import re
FILES = [
    'src/renderer/src/components/__tests__/EditorPanel.test.tsx',
    'src/renderer/src/components/__tests__/EditorPanel.applyOutput.test.tsx',
    'src/renderer/src/hooks/__tests__/useAppState.test.ts',
    'src/renderer/src/hooks/__tests__/useAppState.agent.test.ts',
    'src/renderer/src/hooks/__tests__/useDiffOperations.test.ts',
    'src/renderer/src/hooks/__tests__/diffTabPath.test.ts',
    'src/renderer/src/hooks/__tests__/useCombinedEditorTabs.test.ts',
    'src/renderer/src/hooks/__tests__/useDiffTabs.test.ts',
]
for path in FILES:
    s = open(path).read()
    s = s.replace('staged: true', "kind: 'staged'").replace('staged: false', "kind: 'unstaged'")
    s = s.replace('activeDiffTab.staged から', 'activeDiffTab.kind から')
    # 変数に入れたキーは文字列に広がるため、DiffTabKey の型を付ける
    s, n = re.subn(r"(\b(?:const|let) \w+) = (\{ path: [^{}\n]*?, kind: '(?:un)?staged' \})", r'\1: DiffTabKey = \2', s)
    if n and 'DiffTabKey' not in open(path).read():
        rel = '../useDiffTabs' if '/hooks/__tests__/' in path else '../../hooks/useDiffTabs'
        s = s.replace('import ', f"import type {{ DiffTabKey }} from '{rel}'\nimport ", 1)
    open(path, 'w').write(s)
    print(path, n)
PY
python3 "$SCRIPT"
npx prettier --write src/renderer/src/components/__tests__/EditorPanel.test.tsx src/renderer/src/components/__tests__/EditorPanel.applyOutput.test.tsx src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/hooks/__tests__/useDiffOperations.test.ts src/renderer/src/hooks/__tests__/diffTabPath.test.ts src/renderer/src/hooks/__tests__/useCombinedEditorTabs.test.ts src/renderer/src/hooks/__tests__/useDiffTabs.test.ts
```

Expected: 置き換え 162 か所。変数へ型を付けたのは `useDiffOperations.test.ts` 48・`diffTabPath.test.ts` 2・`useAppState.agent.test.ts` 1・`EditorPanel.applyOutput.test.tsx` 1

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/diffTabPath.test.ts src/renderer/src/hooks/__tests__/useDiffTabs.test.ts src/renderer/src/hooks/__tests__/useCombinedEditorTabs.test.ts 2>&1 | tail -n 5`
Expected: FAIL（`staged` を読む実装のまま `kind` のキーを渡すため、印・ラベル・同じキーの判定が合わない）

- [ ] **Step 3: 実装を置き換える**

`src/renderer/src/hooks/useDiffTabs.ts`:

```diff
--- a/src/renderer/src/hooks/useDiffTabs.ts
+++ b/src/renderer/src/hooks/useDiffTabs.ts
@@ -2,9 +2,12 @@ import { useState } from 'react'
 import { computeAdjacentItem } from './computeAdjacentItem'
 import { isSamePath } from '../lib/pathUtils'

+/** diff タブの種類。unstaged: 未ステージ(index → 作業ツリー)、staged: ステージ済み(HEAD → index) */
+export type DiffTabKind = 'unstaged' | 'staged'
+
 export interface DiffTabKey {
   path: string
-  staged: boolean
+  kind: DiffTabKind
 }

 export interface DiffTabsState {
@@ -23,7 +26,7 @@ export interface DiffTabsState {
 // useDiffOperations.ts でも同じ DiffTabKey 同士の比較が必要なため export する
 // (別実装で再現すると、path 正規化ルールを変更したときに片方だけ更新されずずれる)
 export function isSameKey(a: DiffTabKey, b: DiffTabKey): boolean {
-  return isSamePath(a.path, b.path) && a.staged === b.staged
+  return isSamePath(a.path, b.path) && a.kind === b.kind
 }

 // 既にアクティブなタブと同じキーであれば、新しいオブジェクト参照を作らず既存の
```

`src/renderer/src/hooks/diffTabPath.ts`:

```diff
--- a/src/renderer/src/hooks/diffTabPath.ts
+++ b/src/renderer/src/hooks/diffTabPath.ts
@@ -1,4 +1,4 @@
-import type { DiffTabKey } from './useDiffTabs'
+import type { DiffTabKey, DiffTabKind } from './useDiffTabs'

 // EditorPanel のタブバーは実ファイルタブと diff タブを 1 本の文字列キー空間で
 // 扱うため、DiffTabKey <-> 文字列パスの相互変換をここに切り出す。
@@ -13,7 +13,7 @@ const SEPARATOR = '\u0000'
 const MARKER = `${SEPARATOR}diff${SEPARATOR}`

 export function encodeDiffTabPath(key: DiffTabKey): string {
-  return `${MARKER}${key.staged ? 'staged' : 'unstaged'}${SEPARATOR}${key.path}`
+  return `${MARKER}${key.kind}${SEPARATOR}${key.path}`
 }

 export function isDiffTabPath(path: string): boolean {
@@ -23,7 +23,7 @@ export function isDiffTabPath(path: string): boolean {
 export function decodeDiffTabPath(encodedPath: string): DiffTabKey {
   const rest = encodedPath.slice(MARKER.length)
   const separatorIndex = rest.indexOf(SEPARATOR)
-  const staged = rest.slice(0, separatorIndex) === 'staged'
+  const kind: DiffTabKind = rest.slice(0, separatorIndex) === 'staged' ? 'staged' : 'unstaged'
   const path = rest.slice(separatorIndex + 1)
-  return { path, staged }
+  return { path, kind }
 }
```

`src/renderer/src/hooks/useCombinedEditorTabs.ts`:

```diff
--- a/src/renderer/src/hooks/useCombinedEditorTabs.ts
+++ b/src/renderer/src/hooks/useCombinedEditorTabs.ts
@@ -67,7 +67,7 @@ export function useCombinedEditorTabs({
     // フルパス + ステージ状態でラベルの一意性を保つ
     const diffTabItems = diffTabs.map((tab) => ({
       path: encodeDiffTabPath(tab),
-      name: `${tab.path} (${tab.staged ? 'ステージ済み' : '未ステージ'}差分)`,
+      name: `${tab.path} (${tab.kind === 'staged' ? 'ステージ済み' : '未ステージ'}差分)`,
       isDirty: false,
       isReorderable: false
     }))
```

`src/renderer/src/hooks/useDiffOperations.ts`:

```diff
--- a/src/renderer/src/hooks/useDiffOperations.ts
+++ b/src/renderer/src/hooks/useDiffOperations.ts
@@ -62,10 +62,10 @@ export function useDiffOperations(
   // 関数のため、await 後に読む時点では activeDiffTab の最新値を ref 経由で確認する
   const activeDiffTabRef = useLatestRef(activeDiffTab)
   const [diffContent, setDiffContent] = useState<string | null>(null)
-  // diffStaged は activeDiffTab.staged から常に導出できる値のため、専用の state で
+  // diffStaged は activeDiffTab.kind から常に導出できる値のため、専用の state で
   // 二重管理しない。state のままだと getDiff の解決後にのみ同期していたため、
   // 取得中(fetch が未解決の間)は前のタブの staged 値が残り続けてしまっていた
-  const diffStaged = activeDiffTab?.staged ?? false
+  const diffStaged = activeDiffTab?.kind === 'staged'
   // diff の取得エラー。タブ切替・再取得のたびにリセットされる
   const [fetchError, setFetchError] = useState<Error | null>(null)
   // ハンク操作(git apply --cached)の失敗。取得エラーと分けているのは、
@@ -191,7 +191,7 @@ export function useDiffOperations(
         // 旧パスの削除だけがステージに残ってファイルが消えてしまう
         const content = await gitApi.getDiff(
           activeDiffTab.path,
-          activeDiffTab.staged,
+          activeDiffTab.kind === 'staged',
           isUntracked,
           activeFileStatus?.from
         )
@@ -342,7 +342,7 @@ export function useDiffOperations(
   // 移す対象でハンクでは取り消せず、コンフリクト中は取り消せない(main 側でも弾く)
   const canDiscardHunk =
     activeDiffTab !== null &&
-    !activeDiffTab.staged &&
+    activeDiffTab.kind === 'unstaged' &&
     activeFileStatus !== undefined &&
     canDiscardHunkFor(activeFileStatus)
   const discardHunk = (patch: string): Promise<boolean> =>
```

`src/renderer/src/hooks/useAppState.ts`:

```diff
--- a/src/renderer/src/hooks/useAppState.ts
+++ b/src/renderer/src/hooks/useAppState.ts
@@ -214,7 +214,7 @@ export function useAppState(): AppState {
       // ChangesSection.tsx の一覧フィルタと共有し、片方だけ判定基準がずれる
       // ことを防ぐ
       const stillHasMatchingDiff =
-        file !== undefined && (tab.staged ? isStagedFile(file) : isUnstagedFile(file))
+        file !== undefined && (tab.kind === 'staged' ? isStagedFile(file) : isUnstagedFile(file))
       if (!stillHasMatchingDiff) {
         diffTabs.closeDiffTab(tab)
       }
```

`src/renderer/src/App.tsx`:

```diff
--- a/src/renderer/src/App.tsx
+++ b/src/renderer/src/App.tsx
@@ -149,7 +149,7 @@ export default function App(): React.JSX.Element {
   // handleOpenDiff が再度 openDiffTab を呼ぶ → … という無限ループが発生していた
   const handleOpenDiff = useCallback(
     (path: string, staged: boolean): void => {
-      openDiffTab({ path, staged })
+      openDiffTab({ path, kind: staged ? 'staged' : 'unstaged' })
     },
     [openDiffTab]
   )
```

- [ ] **Step 4: 既存のテストがすべて通ることを確かめる**

```bash
npm run typecheck 2>&1 | tail -n 5
npx vitest run src/renderer 2>&1 | grep -E "Test Files|Tests "
grep -rn "\.staged\b\|staged: \(true\|false\)" src/renderer/src --include='*.ts' --include='*.tsx' | grep -v "DiffView"
```

Expected: 型エラー 0、renderer のテストがすべて成功（件数は Task 9 の後と同じ）、`grep` は 0 件

- [ ] **Step 5: 確認コマンド**

```bash
npx prettier --write src/renderer/src/hooks/useDiffTabs.ts src/renderer/src/hooks/diffTabPath.ts src/renderer/src/hooks/useCombinedEditorTabs.ts src/renderer/src/hooks/useDiffOperations.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/App.tsx
npx eslint src/renderer/src/hooks/useDiffTabs.ts src/renderer/src/hooks/diffTabPath.ts src/renderer/src/hooks/useCombinedEditorTabs.ts src/renderer/src/hooks/useDiffOperations.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/App.tsx
```

---

### Task 11: renderer: 文言と押せる条件（`lib/agentChangesMessages`）

**Files:**

- Create: `src/renderer/src/lib/agentChangesMessages.ts`、`src/renderer/src/lib/__tests__/agentChangesMessages.test.ts`

**Interfaces:**

- Consumes: `AgentChangeStatus`・`AgentChangesState`・`AgentChangesUnavailableReason`・`AGENT_CHANGES_UNAVAILABLE_REASONS`（Task 1）
- Produces: 文言の定数 `AGENT_CHANGES_HEADING`・`AGENT_CHANGES_NONE_HINT`・`AGENT_CHANGES_EMPTY`・`AGENT_CHANGES_HEAD_CHANGED`・`AGENT_CHANGES_CLEARED_NOTICE`・`AGENT_CHANGES_SAVED_MARK`・`AGENT_CHANGES_NOT_RECORDED_MARK`・`AGENT_CHANGES_LOADING`・`AGENT_CHANGES_UNAVAILABLE_MESSAGES`・`AGENT_CHANGES_BUSY_LOADING`・`AGENT_CHANGES_BUSY_GIT`・`AGENT_CHANGES_BUSY_REVERTING`・`AGENT_CHANGES_LIST_FAILED`・`AGENT_CHANGES_TRUNCATED_REASON`、関数 `describeAgentChangesUnavailable(state): string`・`canRetryAgentChanges(reason): boolean`・`formatAgentChangesStartedAt(startedAt: number): string`・`buildAgentChangesHeading(recording: { startedAt: number; totalCount: number | null } | null): string`・`formatAgentChangesMore(hiddenCount): string`・`formatAgentChangesListedNotice(totalCount): string`・`formatAgentChangesRevertedNotice(count): string`・`interface AgentRevertAvailability { isLoading; isGitBusy; isReverting; hasListError }`・`agentRevertDisabledReason(availability): string | null`・`agentRevertAllDisabledReason(availability & { truncated }): string | null`・`buildAgentRevertFileConfirmMessage({ path, status, isDirectory, savedInApp, hasUnsavedEdits, agentRunning }): string`・`buildAgentRevertHunkConfirmMessage({ path, hunkHeader, savedInApp, hasUnsavedEdits, agentRunning }): string`・`buildAgentRevertAllConfirmMessage({ count, trashCount, savedInApp, agentRunning }): string`
- 注: 文言は設計書の表のとおり。設計書に無い文言（差異 9）: 押せない理由の 4 つ（`一覧を取得しています`・`他の Git 操作の実行中です`・`戻す操作の実行中です`・`一覧の取得に失敗したため、戻す操作は使えません。「更新」で取り直してください`）、記録しなかった行の印 `記録していないため戻せません`、すべて戻すの確認の追記 `記録を始めた後にアプリで保存したファイルを含みます。`

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentChangesMessages.test.ts`（新規。押せないなら必ず理由がある〈パターン 126〉を 32 通りの組み合わせで固定する）:

```ts
import { describe, it, expect } from 'vitest'
import { AGENT_CHANGES_UNAVAILABLE_REASONS } from '@shared/types'
import {
  AGENT_CHANGES_BUSY_GIT,
  AGENT_CHANGES_BUSY_LOADING,
  AGENT_CHANGES_BUSY_REVERTING,
  AGENT_CHANGES_LIST_FAILED,
  AGENT_CHANGES_TRUNCATED_REASON,
  AGENT_CHANGES_UNAVAILABLE_MESSAGES,
  agentRevertAllDisabledReason,
  agentRevertDisabledReason,
  buildAgentChangesHeading,
  buildAgentRevertAllConfirmMessage,
  buildAgentRevertFileConfirmMessage,
  buildAgentRevertHunkConfirmMessage,
  canRetryAgentChanges,
  describeAgentChangesUnavailable,
  formatAgentChangesListedNotice,
  formatAgentChangesMore,
  formatAgentChangesRevertedNotice,
  formatAgentChangesStartedAt
} from '../agentChangesMessages'

const at = (hours: number, minutes: number): number =>
  new Date(2026, 9, 7, hours, minutes).getTime()

describe('記録できない理由', () => {
  it.each(AGENT_CHANGES_UNAVAILABLE_REASONS)('%s には文言がある', (reason) => {
    expect(describeAgentChangesUnavailable({ kind: 'unavailable', reason })).toBe(
      AGENT_CHANGES_UNAVAILABLE_MESSAGES[reason]
    )
  })

  it('未追跡が多すぎるときは件数と合計を添える', () => {
    expect(
      describeAgentChangesUnavailable({
        kind: 'unavailable',
        reason: 'too-many-untracked',
        untrackedCount: 5001,
        untrackedBytes: 0
      })
    ).toBe(
      '未追跡のファイルが多すぎるため、記録できません。.gitignore を確かめてください（5,001 件）'
    )
    expect(
      describeAgentChangesUnavailable({
        kind: 'unavailable',
        reason: 'too-many-untracked',
        untrackedCount: 21,
        untrackedBytes: 105 * 1024 * 1024
      })
    ).toBe(
      '未追跡のファイルが多すぎるため、記録できません。.gitignore を確かめてください（21 件・105.0 MB）'
    )
  })

  it.each([
    ['timeout', true],
    ['git-failed', true],
    ['not-repository', false],
    ['not-toplevel', false],
    ['too-many-untracked', false]
  ] as const)('%s で「もう一度試す」を出すか: %s', (reason, expected) => {
    expect(canRetryAgentChanges(reason)).toBe(expected)
  })
})

describe('見出しと通知', () => {
  it('記録なしは見出しだけ、記録中は開始の時刻、変更があれば件数を添える', () => {
    expect(buildAgentChangesHeading(null)).toBe('エージェントの変更')
    expect(buildAgentChangesHeading({ startedAt: at(10, 42), totalCount: null })).toBe(
      'エージェントの変更（10:42 から）'
    )
    expect(buildAgentChangesHeading({ startedAt: at(10, 42), totalCount: 0 })).toBe(
      'エージェントの変更（10:42 から）'
    )
    expect(buildAgentChangesHeading({ startedAt: at(9, 5), totalCount: 3 })).toBe(
      'エージェントの変更 (3)（09:05 から）'
    )
  })

  it('時刻は 0 埋めの HH:MM', () => {
    expect(formatAgentChangesStartedAt(at(0, 7))).toBe('00:07')
  })

  it('打ち切り・取得・戻した結果の文言', () => {
    expect(formatAgentChangesMore(12)).toBe('ほか 12 件')
    expect(formatAgentChangesListedNotice(3)).toBe('エージェントの変更: 3 件')
    expect(formatAgentChangesRevertedNotice(2)).toBe('2 件を実行前の状態に戻しました')
  })
})

describe('戻すボタンを押せる条件(押せないなら必ず理由がある。パターン 126)', () => {
  const flags = [false, true]
  const combinations = flags.flatMap((isLoading) =>
    flags.flatMap((isGitBusy) =>
      flags.flatMap((isReverting) =>
        flags.flatMap((hasListError) =>
          flags.map((truncated) => ({ isLoading, isGitBusy, isReverting, hasListError, truncated }))
        )
      )
    )
  )

  it.each(combinations)('%o', (availability) => {
    const blocked =
      availability.isLoading ||
      availability.isGitBusy ||
      availability.isReverting ||
      availability.hasListError
    expect(agentRevertDisabledReason(availability) !== null).toBe(blocked)
    expect(agentRevertAllDisabledReason(availability) !== null).toBe(
      blocked || availability.truncated
    )
  })

  it('理由は実行中 → 一覧の失敗 → 取得中 → 他の Git 操作の順で 1 つ', () => {
    const none = { isLoading: false, isGitBusy: false, isReverting: false, hasListError: false }
    expect(agentRevertDisabledReason({ ...none, isReverting: true, isLoading: true })).toBe(
      AGENT_CHANGES_BUSY_REVERTING
    )
    expect(agentRevertDisabledReason({ ...none, hasListError: true, isGitBusy: true })).toBe(
      AGENT_CHANGES_LIST_FAILED
    )
    expect(agentRevertDisabledReason({ ...none, isLoading: true, isGitBusy: true })).toBe(
      AGENT_CHANGES_BUSY_LOADING
    )
    expect(agentRevertDisabledReason({ ...none, isGitBusy: true })).toBe(AGENT_CHANGES_BUSY_GIT)
    expect(agentRevertAllDisabledReason({ ...none, truncated: true })).toBe(
      AGENT_CHANGES_TRUNCATED_REASON
    )
  })
})

describe('確認の文言', () => {
  const plain = { savedInApp: false, hasUnsavedEdits: false, agentRunning: false }

  it.each([
    [
      'M',
      false,
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。この操作は元に戻せません。'
    ],
    [
      'D',
      false,
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。この操作は元に戻せません。'
    ],
    [
      'T',
      false,
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。この操作は元に戻せません。'
    ],
    ['A', false, 'a.txt をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）'],
    [
      'A',
      true,
      'a.txt をゴミ箱へ移動しますか？フォルダとその中身（.gitignore の対象を含む）がすべて移動します。'
    ]
  ] as const)('ファイル単位 %s(フォルダ %s)', (status, isDirectory, expected) => {
    expect(
      buildAgentRevertFileConfirmMessage({ path: 'a.txt', status, isDirectory, ...plain })
    ).toBe(expected)
  })

  it('追記はアプリでの保存 → 未保存の編集 → エージェントの動作の順に、空行で区切って足す', () => {
    expect(
      buildAgentRevertFileConfirmMessage({
        path: 'a.txt',
        status: 'M',
        isDirectory: false,
        savedInApp: true,
        hasUnsavedEdits: true,
        agentRunning: true
      }).split('\n\n')
    ).toEqual([
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。この操作は元に戻せません。',
      'このファイルは、記録を始めた後にアプリで保存されています。',
      'エディタの未保存の編集も破棄されます。',
      'エージェントが動いている間は、戻した後に同じファイルが書き換えられることがあります。'
    ])
  })

  it('ハンク', () => {
    expect(
      buildAgentRevertHunkConfirmMessage({
        path: 'a.txt',
        hunkHeader: '@@ -1,3 +1,4 @@',
        ...plain,
        hasUnsavedEdits: true
      })
    ).toBe(
      'a.txt の次のハンクを実行前の状態に戻しますか？この操作は元に戻せません。\n\n@@ -1,3 +1,4 @@\n\nエディタの未保存の編集も破棄されます。'
    )
  })

  it('すべて', () => {
    expect(
      buildAgentRevertAllConfirmMessage({
        count: 3,
        trashCount: 1,
        savedInApp: false,
        agentRunning: false
      })
    ).toBe(
      'エージェントの変更 3 件を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。この操作は元に戻せません。\nうち 1 件の新しいファイル・フォルダはゴミ箱へ移動します。\nステージ（index）・コミット・ブランチは戻しません。'
    )
    expect(
      buildAgentRevertAllConfirmMessage({
        count: 2,
        trashCount: 0,
        savedInApp: true,
        agentRunning: true
      })
    ).toBe(
      'エージェントの変更 2 件を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。この操作は元に戻せません。\nステージ（index）・コミット・ブランチは戻しません。\n\n記録を始めた後にアプリで保存したファイルを含みます。\n\nエージェントが動いている間は、戻した後に同じファイルが書き換えられることがあります。'
    )
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentChangesMessages.test.ts 2>&1 | tail -n 5`
Expected: FAIL（`../agentChangesMessages` が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/lib/agentChangesMessages.ts`（新規）:

```ts
import type {
  AgentChangeStatus,
  AgentChangesState,
  AgentChangesUnavailableReason
} from '@shared/types'

// エージェントの変更のセクション・確認のダイアログの文言と、押せる条件(設計書「A の詳細」「確認ダイアログの文言」)。
// 純粋関数だけを置く。押せないボタンには必ず理由を返す(パターン 126)

export const AGENT_CHANGES_HEADING = 'エージェントの変更'
export const AGENT_CHANGES_NONE_HINT = 'プロンプトの「実行」で、実行の前の状態の記録を始めます'
export const AGENT_CHANGES_EMPTY = '記録を始めてから、変わったファイルはありません'
export const AGENT_CHANGES_HEAD_CHANGED =
  '記録を始めた後に HEAD が変わりました（コミット・ブランチの切り替えなど）。戻すのはファイルの内容だけです'
export const AGENT_CHANGES_CLEARED_NOTICE = '記録を終えました。次の「実行」で新しい記録を始めます'
export const AGENT_CHANGES_SAVED_MARK = 'あなたの保存を含む'
export const AGENT_CHANGES_NOT_RECORDED_MARK = '記録していないため戻せません'
export const AGENT_CHANGES_LOADING = '更新中…'

export const AGENT_CHANGES_UNAVAILABLE_MESSAGES: Record<AgentChangesUnavailableReason, string> = {
  'not-repository': 'Git 管理外のフォルダでは、エージェントの変更を記録できません',
  'not-toplevel': 'リポジトリの最上位のフォルダを開いたときだけ、エージェントの変更を記録できます',
  'too-many-untracked':
    '未追跡のファイルが多すぎるため、記録できません。.gitignore を確かめてください',
  timeout: '記録に時間がかかりすぎたため、中止しました',
  'git-failed': 'git を実行できないため、記録できません'
}

/** 記録できない理由の文言。未追跡が多すぎるときは件数と合計を添える */
export function describeAgentChangesUnavailable(
  state: Extract<AgentChangesState, { kind: 'unavailable' }>
): string {
  const base = AGENT_CHANGES_UNAVAILABLE_MESSAGES[state.reason]
  if (state.reason !== 'too-many-untracked' || state.untrackedCount === undefined) return base
  const bytes = state.untrackedBytes ?? 0
  const size = bytes > 0 ? `・${(bytes / (1024 * 1024)).toFixed(1)} MB` : ''
  return `${base}（${state.untrackedCount.toLocaleString('ja-JP')} 件${size}）`
}

/** 「もう一度試す」を出す理由(記録の失敗。フォルダの種類による理由は出さない) */
export function canRetryAgentChanges(reason: AgentChangesUnavailableReason): boolean {
  return reason === 'timeout' || reason === 'git-failed'
}

/** 記録を始めた時刻(HH:MM。表示用) */
export function formatAgentChangesStartedAt(startedAt: number): string {
  const date = new Date(startedAt)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 見出し。記録中は開始の時刻、変更があれば件数(打ち切る前の全件数)を添える */
export function buildAgentChangesHeading(
  recording: { startedAt: number; totalCount: number | null } | null
): string {
  if (recording === null) return AGENT_CHANGES_HEADING
  const since = `（${formatAgentChangesStartedAt(recording.startedAt)} から）`
  const count =
    recording.totalCount !== null && recording.totalCount > 0 ? ` (${recording.totalCount})` : ''
  return `${AGENT_CHANGES_HEADING}${count}${since}`
}

/** 打ち切った残りの件数 */
export function formatAgentChangesMore(hiddenCount: number): string {
  return `ほか ${hiddenCount} 件`
}

/** 取り直した後の読み上げ */
export function formatAgentChangesListedNotice(totalCount: number): string {
  return `エージェントの変更: ${totalCount} 件`
}

/** 戻した後の読み上げ */
export function formatAgentChangesRevertedNotice(count: number): string {
  return `${count} 件を実行前の状態に戻しました`
}

export const AGENT_CHANGES_BUSY_LOADING = '一覧を取得しています'
export const AGENT_CHANGES_BUSY_GIT = '他の Git 操作の実行中です'
export const AGENT_CHANGES_BUSY_REVERTING = '戻す操作の実行中です'
export const AGENT_CHANGES_LIST_FAILED =
  '一覧の取得に失敗したため、戻す操作は使えません。「更新」で取り直してください'
export const AGENT_CHANGES_TRUNCATED_REASON =
  '変更が多すぎるため、すべて戻すは使えません。ファイルごとに戻すか、ターミナルで操作してください'

export interface AgentRevertAvailability {
  /** 一覧の取得中 */
  isLoading: boolean
  /** 他の Git 操作(ステージ・取り消し・pull・ブランチの操作など)の実行中(useAppState の isAnyLocked と同じ合成) */
  isGitBusy: boolean
  /** 戻す操作の実行中 */
  isReverting: boolean
  /** 直前の一覧の取得が失敗した(古い一覧で戻さない) */
  hasListError: boolean
}

/** ファイル・ハンクを戻すボタンを押せない理由(押せるなら null)。セクションの上に 1 か所で出す */
export function agentRevertDisabledReason(availability: AgentRevertAvailability): string | null {
  if (availability.isReverting) return AGENT_CHANGES_BUSY_REVERTING
  if (availability.hasListError) return AGENT_CHANGES_LIST_FAILED
  if (availability.isLoading) return AGENT_CHANGES_BUSY_LOADING
  if (availability.isGitBusy) return AGENT_CHANGES_BUSY_GIT
  return null
}

/** 「すべて戻す」を押せない理由。打ち切った一覧では使えない(確認で見せていない行を照合に含められない) */
export function agentRevertAllDisabledReason(
  availability: AgentRevertAvailability & { truncated: boolean }
): string | null {
  return (
    agentRevertDisabledReason(availability) ??
    (availability.truncated ? AGENT_CHANGES_TRUNCATED_REASON : null)
  )
}

interface RevertAppendix {
  /** 記録を始めた後にアプリで保存したファイルか(すべて戻すでは、そのようなファイルを含むか) */
  savedInApp: boolean
  /** 対象(フォルダなら配下)のタブに未保存の編集があるか */
  hasUnsavedEdits: boolean
  /** エージェントのセッションが動いているか */
  agentRunning: boolean
}

const appendices = ({ savedInApp, hasUnsavedEdits, agentRunning }: RevertAppendix): string =>
  [
    savedInApp ? 'このファイルは、記録を始めた後にアプリで保存されています。' : null,
    hasUnsavedEdits ? 'エディタの未保存の編集も破棄されます。' : null,
    agentRunning
      ? 'エージェントが動いている間は、戻した後に同じファイルが書き換えられることがあります。'
      : null
  ]
    .filter((text): text is string => text !== null)
    .map((text) => `\n\n${text}`)
    .join('')

/** ファイル単位で戻す確認の文言 */
export function buildAgentRevertFileConfirmMessage({
  path,
  status,
  isDirectory,
  ...appendix
}: { path: string; status: AgentChangeStatus; isDirectory: boolean } & RevertAppendix): string {
  const base =
    status !== 'A'
      ? `${path} を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。この操作は元に戻せません。`
      : isDirectory
        ? `${path} をゴミ箱へ移動しますか？フォルダとその中身（.gitignore の対象を含む）がすべて移動します。`
        : `${path} をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）`
  return base + appendices(appendix)
}

/** ハンクを戻す確認の文言 */
export function buildAgentRevertHunkConfirmMessage({
  path,
  hunkHeader,
  ...appendix
}: { path: string; hunkHeader: string } & RevertAppendix): string {
  return (
    `${path} の次のハンクを実行前の状態に戻しますか？この操作は元に戻せません。\n\n${hunkHeader}` +
    appendices(appendix)
  )
}

/** すべて戻す確認の文言。未保存の編集の破棄は confirmDiscardAnyDirty が別に確かめる */
export function buildAgentRevertAllConfirmMessage({
  count,
  trashCount,
  savedInApp,
  agentRunning
}: {
  count: number
  /** そのうちゴミ箱へ移す(追加された)ファイル・フォルダの数 */
  trashCount: number
  savedInApp: boolean
  agentRunning: boolean
}): string {
  const trash =
    trashCount > 0 ? `\nうち ${trashCount} 件の新しいファイル・フォルダはゴミ箱へ移動します。` : ''
  const saved = savedInApp ? '\n\n記録を始めた後にアプリで保存したファイルを含みます。' : ''
  const running = agentRunning
    ? '\n\nエージェントが動いている間は、戻した後に同じファイルが書き換えられることがあります。'
    : ''
  return (
    `エージェントの変更 ${count} 件を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。この操作は元に戻せません。` +
    trash +
    '\nステージ（index）・コミット・ブランチは戻しません。' +
    saved +
    running
  )
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentChangesMessages.test.ts 2>&1 | tail -n 5`
Expected: PASS（55 件）

- [ ] **Step 5: 確認コマンド**

```bash
npm run typecheck 2>&1 | tail -n 5
npx prettier --write src/renderer/src/lib/agentChangesMessages.ts src/renderer/src/lib/__tests__/agentChangesMessages.test.ts
npx eslint src/renderer/src/lib/agentChangesMessages.ts src/renderer/src/lib/__tests__/agentChangesMessages.test.ts
```

---

### Task 12: renderer: 記録の状態と一覧（`useAgentChanges`）

**Files:**

- Create: `src/renderer/src/hooks/useAgentChanges.ts`、`src/renderer/src/hooks/__tests__/useAgentChanges.test.ts`

**Interfaces:**

- Consumes: `lib/agentChangesApi`（Task 9）、`AGENT_CHANGES_CLEARED_NOTICE`・`formatAgentChangesListedNotice`（Task 11）、既存の `useOnChange`（`hooks/useOnChange.ts:10`）・`useTransientNotice`（`hooks/useTransientNotice.ts:15`）・`toError`
- Produces: `AGENT_CHANGES_NOTICE_DURATION_MS = 5_000`、`interface AgentChangesList { entries; totalCount; truncated; headChanged }`、`type AgentChangesView = { kind: 'none' } | { kind: 'unavailable'; state } | { kind: 'recording'; startedAt: number; list: AgentChangesList | null }`、`interface AgentChangesController { view; isLoading; isBeginning; listError: string | null; notice: Announcement | null; savedPaths: ReadonlySet<string>; begin(): Promise<void>; refresh(options?: { announce?: boolean }): Promise<void>; clear(): Promise<void>; markSaved(absolutePath: string): void; announce(text: string): void; isFocusRequested: boolean; requestFocus(): void; consumeFocusRequest(): void }`、`useAgentChanges(folderPath: string | null): AgentChangesController`
- 注: 取り直しの契機（設計書「いつ完了とするか」の 4 つ）の配線は Task 17・18。ここは `refresh` を持つだけ。`begin` は reject しない（送信は続ける。Task 13）。`savedPaths` は絶対パス（`useFileSystem` の `onSaveSucceeded` の引数）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAgentChanges.test.ts`（新規。古い要求を捨てる・フォルダの切り替え・保存したパスの寿命）:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { AgentChangesListResult, AgentChangesState } from '@shared/types'
import { useAgentChanges } from '../useAgentChanges'
import { toAnnouncementText } from '../../lib/announcementText'
import { AGENT_CHANGES_CLEARED_NOTICE } from '../../lib/agentChangesMessages'

const recordingState: AgentChangesState = { kind: 'recording', startedAt: 100 }
const listOf = (paths: string[], startedAt = 100): AgentChangesListResult => ({
  kind: 'recording',
  startedAt,
  entries: paths.map((path) => ({ path, status: 'M', isDirectory: false, notRecorded: false })),
  totalCount: paths.length,
  truncated: false,
  headChanged: false
})

// 解決を遅らせられる Promise
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (e: unknown) => void
} {
  let resolve: (value: T) => void = () => undefined
  let reject: (e: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  window.api.getAgentChangesState = vi.fn().mockResolvedValue({ kind: 'none' })
  window.api.beginAgentChanges = vi.fn().mockResolvedValue(recordingState)
  window.api.listAgentChanges = vi.fn().mockResolvedValue(listOf(['a.txt']))
  window.api.clearAgentChanges = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAgentChanges', () => {
  it('begin で記録中になり、refresh で一覧を取る。announce なら件数を読み上げる', async () => {
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin()
    })
    expect(result.current.view).toEqual({ kind: 'recording', startedAt: 100, list: null })
    await act(async () => {
      await result.current.refresh({ announce: true })
    })
    expect(result.current.view).toEqual({
      kind: 'recording',
      startedAt: 100,
      list: {
        entries: [{ path: 'a.txt', status: 'M', isDirectory: false, notRecorded: false }],
        totalCount: 1,
        truncated: false,
        headChanged: false
      }
    })
    expect(toAnnouncementText(result.current.notice)).toBe('エージェントの変更: 1 件')
  })

  it('記録が無ければ refresh は一覧を取らない', async () => {
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.refresh()
    })
    expect(window.api.listAgentChanges).not.toHaveBeenCalled()
  })

  it('記録できない結果をそのまま見せる', async () => {
    window.api.beginAgentChanges = vi
      .fn()
      .mockResolvedValue({ kind: 'unavailable', reason: 'not-toplevel' })
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin()
    })
    expect(result.current.view).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'not-toplevel' }
    })
  })

  it('begin の依頼の失敗は reject せず、git を実行できない理由にする', async () => {
    window.api.beginAgentChanges = vi.fn().mockRejectedValue(new Error('ipc'))
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin()
    })
    expect(result.current.view).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'git-failed' }
    })
    expect(result.current.isBeginning).toBe(false)
  })

  it('begin の途中でフォルダが変わったら、前のフォルダの結果を捨てる', async () => {
    const pending = deferred<AgentChangesState>()
    window.api.beginAgentChanges = vi.fn(() => pending.promise)
    const { result, rerender } = renderHook(({ folder }) => useAgentChanges(folder), {
      initialProps: { folder: '/a' as string | null }
    })
    let begun: Promise<void> = Promise.resolve()
    act(() => {
      begun = result.current.begin()
    })
    rerender({ folder: '/b' })
    await act(async () => {
      pending.resolve(recordingState)
      await begun
    })
    expect(result.current.view).toEqual({ kind: 'none' })
  })

  it('古い要求の一覧は捨て、最後の要求の結果だけを反映する。読み上げは追い越した結果で行う', async () => {
    const first = deferred<AgentChangesListResult>()
    const second = deferred<AgentChangesListResult>()
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin()
    })
    window.api.listAgentChanges = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    let a: Promise<void> = Promise.resolve()
    let b: Promise<void> = Promise.resolve()
    act(() => {
      a = result.current.refresh({ announce: true })
      b = result.current.refresh()
    })
    await act(async () => {
      second.resolve(listOf(['new.txt', 'b.txt']))
      await b
      first.resolve(listOf(['old.txt']))
      await a
    })
    expect(result.current.view.kind === 'recording' && result.current.view.list?.totalCount).toBe(2)
    expect(toAnnouncementText(result.current.notice)).toBe('エージェントの変更: 2 件')
    expect(result.current.isLoading).toBe(false)
  })

  it('一覧の失敗は前回の一覧を残してエラーを出し、次の成功で消す', async () => {
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin()
      await result.current.refresh()
    })
    window.api.listAgentChanges = vi.fn().mockRejectedValueOnce(new Error('git failed'))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.listError).toBe('git failed')
    expect(result.current.view.kind === 'recording' && result.current.view.list?.totalCount).toBe(1)
    window.api.listAgentChanges = vi.fn().mockResolvedValue(listOf([]))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.listError).toBeNull()
  })

  it('main が記録を捨てていたら(一覧が none)記録なしにする', async () => {
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin()
    })
    window.api.listAgentChanges = vi.fn().mockResolvedValue({ kind: 'none' })
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.view).toEqual({ kind: 'none' })
  })

  it('アプリで保存したパスは記録中だけ覚え、記録が変われば・確認を終えれば捨てる', async () => {
    const { result } = renderHook(() => useAgentChanges('/repo'))
    act(() => result.current.markSaved('/repo/early.txt'))
    expect(result.current.savedPaths.size).toBe(0)
    await act(async () => {
      await result.current.begin()
    })
    act(() => result.current.markSaved('/repo/a.txt'))
    expect([...result.current.savedPaths]).toEqual(['/repo/a.txt'])
    // 同じ記録の取り直しでは残す
    await act(async () => {
      await result.current.refresh()
    })
    expect([...result.current.savedPaths]).toEqual(['/repo/a.txt'])
    await act(async () => {
      await result.current.clear()
    })
    expect(result.current.view).toEqual({ kind: 'none' })
    expect(result.current.savedPaths.size).toBe(0)
    expect(toAnnouncementText(result.current.notice)).toBe(AGENT_CHANGES_CLEARED_NOTICE)
    // 新しい記録(開始の時刻が違う)では前の記録の保存を持ち越さない
    window.api.beginAgentChanges = vi.fn().mockResolvedValue({ kind: 'recording', startedAt: 200 })
    await act(async () => {
      await result.current.begin()
    })
    expect(result.current.savedPaths.size).toBe(0)
  })

  it('フォルダが変わったら記録の写しと保存したパスを捨てる', async () => {
    const { result, rerender } = renderHook(({ folder }) => useAgentChanges(folder), {
      initialProps: { folder: '/a' as string | null }
    })
    await act(async () => {
      await result.current.begin()
    })
    act(() => result.current.markSaved('/a/x.txt'))
    rerender({ folder: '/b' })
    expect(result.current.view).toEqual({ kind: 'none' })
    expect(result.current.savedPaths.size).toBe(0)
  })

  it('部品の作り直しの後、main に記録があれば記録中にする', async () => {
    window.api.getAgentChangesState = vi.fn().mockResolvedValue(recordingState)
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await waitFor(() =>
      expect(result.current.view).toEqual({ kind: 'recording', startedAt: 100, list: null })
    )
  })

  it('フォーカスの依頼を出し、受け取ったら下ろす', () => {
    const { result } = renderHook(() => useAgentChanges('/repo'))
    act(() => result.current.requestFocus())
    expect(result.current.isFocusRequested).toBe(true)
    act(() => result.current.consumeFocusRequest())
    expect(result.current.isFocusRequested).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChanges.test.ts 2>&1 | tail -n 5`
Expected: FAIL（`../useAgentChanges` が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/hooks/useAgentChanges.ts`（新規）:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentChangeEntry, AgentChangesState } from '@shared/types'
import type { Announcement } from '../types'
import * as agentChangesApi from '../lib/agentChangesApi'
import {
  AGENT_CHANGES_CLEARED_NOTICE,
  formatAgentChangesListedNotice
} from '../lib/agentChangesMessages'
import { toError } from '../lib/errorUtils'
import { useOnChange } from './useOnChange'
import { useTransientNotice } from './useTransientNotice'

// エージェントの変更の記録の状態と一覧(設計書「データフロー」「状態の持ち主」)。記録の真実の源は main の registry で、
// ここは写し(表示と押せる条件に使う。戻す操作は main が実行時に照合する)。一覧は要求の番号で古い結果を捨てる(useGitStatus と
// 同じ作り)。実行中にアプリで保存したパスの真実の源はここ(記録ごとに持ち、記録が変われば捨てる)

/** 読み上げの通知を消すまでの時間 */
export const AGENT_CHANGES_NOTICE_DURATION_MS = 5_000

export interface AgentChangesList {
  entries: AgentChangeEntry[]
  totalCount: number
  truncated: boolean
  headChanged: boolean
}

export type AgentChangesView =
  | { kind: 'none' }
  | { kind: 'unavailable'; state: Extract<AgentChangesState, { kind: 'unavailable' }> }
  /** list は取り直す前は null */
  | { kind: 'recording'; startedAt: number; list: AgentChangesList | null }

export interface AgentChangesController {
  view: AgentChangesView
  /** 一覧の取得中 */
  isLoading: boolean
  /** 記録の開始の依頼中(いまから記録する・実行の前) */
  isBeginning: boolean
  /** 直前の一覧の取得の失敗(前回の一覧は残す。戻す操作は押せない) */
  listError: string | null
  /** セクションの aria-live の通知 */
  notice: Announcement | null
  /** 記録を始めた後にアプリで保存したファイル(絶対パス) */
  savedPaths: ReadonlySet<string>
  /** 記録を始める(記録があれば main は何もしない)。失敗しても reject しない */
  begin: () => Promise<void>
  /** 記録があれば一覧を取り直す。announce なら結果の件数を読み上げる */
  refresh: (options?: { announce?: boolean }) => Promise<void>
  /** 確認を終える(記録を捨てる) */
  clear: () => Promise<void>
  /** アプリで保存した(useFileSystem の onSaveSucceeded から呼ぶ)。記録中だけ覚える */
  markSaved: (absolutePath: string) => void
  /** 戻す操作の結果などをセクションの通知に出す */
  announce: (text: string) => void
  /** セクションの見出しへフォーカスを移す依頼(ターミナルの帯の「変更を確認」) */
  isFocusRequested: boolean
  requestFocus: () => void
  /** セクションがフォーカスを移したら呼ぶ */
  consumeFocusRequest: () => void
}

export function useAgentChanges(folderPath: string | null): AgentChangesController {
  const [view, setView] = useState<AgentChangesView>({ kind: 'none' })
  const [isLoading, setIsLoading] = useState(false)
  const [isBeginning, setIsBeginning] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [savedPaths, setSavedPaths] = useState<ReadonlySet<string>>(new Set())
  const [isFocusRequested, setIsFocusRequested] = useState(false)
  const { notice, announce } = useTransientNotice(AGENT_CHANGES_NOTICE_DURATION_MS)
  const viewRef = useRef(view)
  const folderPathRef = useRef(folderPath)
  const requestIdRef = useRef(0)
  // 取り直しの依頼で読み上げを頼まれたか。後の依頼に追い越されても、最後に反映した結果を読み上げる
  const announcePendingRef = useRef(false)

  const applyView = useCallback((next: AgentChangesView): void => {
    const previous = viewRef.current
    viewRef.current = next
    setView(next)
    // 記録が変わったら(無くなった・別の記録になった)、実行中に保存したパスを捨てる
    const sameRecording =
      previous.kind === 'recording' &&
      next.kind === 'recording' &&
      previous.startedAt === next.startedAt
    if (!sameRecording) setSavedPaths(new Set())
  }, [])

  const applyState = useCallback(
    (state: AgentChangesState): void => {
      if (state.kind === 'recording') {
        const previous = viewRef.current
        const list =
          previous.kind === 'recording' && previous.startedAt === state.startedAt
            ? previous.list
            : null
        applyView({ kind: 'recording', startedAt: state.startedAt, list })
      } else if (state.kind === 'unavailable') {
        applyView({ kind: 'unavailable', state })
      } else {
        applyView({ kind: 'none' })
      }
    },
    [applyView]
  )

  // フォルダが変わったら記録の写しを捨てる(main もフォルダの切り替えで記録を捨てる)
  useOnChange(folderPath, () => {
    folderPathRef.current = folderPath
    requestIdRef.current++
    setIsLoading(false)
    setListError(null)
    applyView({ kind: 'none' })
  })

  // 部品の作り直しの後に main の記録に合わせる(リロードでは main が記録を捨てるため、通常は none)
  useEffect(() => {
    if (folderPath === null) return
    let cancelled = false
    void agentChangesApi
      .getAgentChangesState()
      .then((state) => {
        if (!cancelled && folderPathRef.current === folderPath && state.kind === 'recording') {
          applyState(state)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [folderPath, applyState])

  const begin = useCallback(async (): Promise<void> => {
    const requestedFolder = folderPathRef.current
    if (requestedFolder === null) return
    setIsBeginning(true)
    try {
      const state = await agentChangesApi.beginAgentChanges()
      // 送った後にフォルダが変わったら、前のフォルダの結果は捨てる
      if (folderPathRef.current !== requestedFolder) return
      applyState(state)
    } catch {
      if (folderPathRef.current === requestedFolder) {
        applyView({ kind: 'unavailable', state: { kind: 'unavailable', reason: 'git-failed' } })
      }
    } finally {
      setIsBeginning(false)
    }
  }, [applyState, applyView])

  const refresh = useCallback(
    async (options: { announce?: boolean } = {}): Promise<void> => {
      if (viewRef.current.kind !== 'recording') return
      if (options.announce === true) announcePendingRef.current = true
      const requestId = ++requestIdRef.current
      setIsLoading(true)
      try {
        const result = await agentChangesApi.listAgentChanges()
        if (requestId !== requestIdRef.current) return
        setListError(null)
        if (result.kind === 'none') {
          // main が記録を捨てていた(フォルダの切り替えの直後など)
          applyView({ kind: 'none' })
          return
        }
        const { startedAt, entries, totalCount, truncated, headChanged } = result
        applyView({
          kind: 'recording',
          startedAt,
          list: { entries, totalCount, truncated, headChanged }
        })
        if (announcePendingRef.current) {
          announcePendingRef.current = false
          announce(formatAgentChangesListedNotice(totalCount))
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return
        setListError(toError(err).message)
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false)
      }
    },
    [applyView, announce]
  )

  const clear = useCallback(async (): Promise<void> => {
    requestIdRef.current++
    setIsLoading(false)
    try {
      await agentChangesApi.clearAgentChanges()
    } catch {
      // main で消せなくても写しは捨てる(次の取り直しで main の状態に合わせる)
    }
    setListError(null)
    applyView({ kind: 'none' })
    announce(AGENT_CHANGES_CLEARED_NOTICE)
  }, [applyView, announce])

  const markSaved = useCallback((absolutePath: string): void => {
    if (viewRef.current.kind !== 'recording') return
    setSavedPaths((previous) =>
      previous.has(absolutePath) ? previous : new Set([...previous, absolutePath])
    )
  }, [])

  const requestFocus = useCallback(() => setIsFocusRequested(true), [])
  const consumeFocusRequest = useCallback(() => setIsFocusRequested(false), [])

  return {
    view,
    isLoading,
    isBeginning,
    listError,
    notice,
    savedPaths,
    begin,
    refresh,
    clear,
    markSaved,
    announce,
    isFocusRequested,
    requestFocus,
    consumeFocusRequest
  }
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChanges.test.ts 2>&1 | tail -n 5`
Expected: PASS（12 件）

- [ ] **Step 5: 変異で落ちることを確かめる**（手順は Task 4 の Step 5）

| #   | 置き換え前                                                                                                               | 置き換え後                                                        | 落ちるテスト                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| A1  | `        const result = await agentChangesApi.listAgentChanges()⏎        if (requestId !== requestIdRef.current) return` | `        const result = await agentChangesApi.listAgentChanges()` | `古い要求の一覧は捨て`                                         |
| A2  | `      if (folderPathRef.current !== requestedFolder) return⏎      applyState(state)`                                    | `      applyState(state)`                                         | `begin の途中でフォルダが変わったら`                           |
| A3  | `    if (!sameRecording) setSavedPaths(new Set())`                                                                       | （空行）                                                          | `記録が変われば・確認を終えれば捨てる`・`フォルダが変わったら` |
| A4  | `    if (viewRef.current.kind !== 'recording') return⏎    setSavedPaths`                                                 | `    setSavedPaths`                                               | `記録中だけ覚え`                                               |

- [ ] **Step 6: 確認コマンド**

```bash
npm run typecheck 2>&1 | tail -n 5
npx prettier --write src/renderer/src/hooks/useAgentChanges.ts src/renderer/src/hooks/__tests__/useAgentChanges.test.ts
npx eslint src/renderer/src/hooks/useAgentChanges.ts src/renderer/src/hooks/__tests__/useAgentChanges.test.ts
```

---

### Task 13: renderer: 送信の前に記録を始める（`useAgentPromptSender`・`useAgentWorkspace`）

**Files:**

- Modify: `src/renderer/src/hooks/useAgentPromptSender.ts:16`（上限の定数）・`:32`（option）・`:38`（引数）・`:52`（`clear()` の後に待ち）・`:86`（依存）、`src/renderer/src/hooks/useAgentWorkspace.ts:35`・`:57`・`:70`
- Test: `src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`（末尾に describe）、`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`（`エージェントへの送信` の describe）

**Interfaces:**

- Consumes: なし（Task 18 で `useAgentChanges.begin` を渡す）
- Produces: `AGENT_BEFORE_SEND_TIMEOUT_MS = 10_000`、`UseAgentPromptSenderOptions.beforeSend?: () => Promise<void>`、`UseAgentWorkspaceOptions.beforeAgentSend?: () => Promise<void>`（そのまま `beforeSend` に渡す）
- 注: 待ちは `controller.beginSending()`（利用者のキー入力を溜める）より前。失敗・上限超えでも送る（設計書「記録の開始」1）。上限の待ちは送信の手順と同じ `clock.sleep`（テストで仮想の時計にする）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts` の変更:

```diff
--- a/src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts
+++ b/src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts
@@ -1,7 +1,7 @@
 import { renderHook, act } from '@testing-library/react'
 import { describe, it, expect, vi, afterEach } from 'vitest'
 import { AGENT_CLEAR_INPUT_CHUNK } from '@shared/agentPasteText'
-import { useAgentPromptSender } from '../useAgentPromptSender'
+import { AGENT_BEFORE_SEND_TIMEOUT_MS, useAgentPromptSender } from '../useAgentPromptSender'
 import type { AgentSendClock } from '../../lib/agentPromptSend'
 import { AGENT_SENT_AFTER_CLEAR_NOTICE, AGENT_SENT_NOTICE } from '../../lib/agentSendMessages'
 import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
@@ -155,4 +155,82 @@ describe('useAgentPromptSender', () => {
     })
     expect(controller.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~a\x1b[201~', '\r'])
   })
+
+  describe('送信の前の準備(エージェントの変更の記録)', () => {
+    // 上限の待ち(10 秒)だけは release まで解かず、送信の手順の待ちはすぐ解く時計
+    const timeoutClock = (): AgentSendClock & { releaseTimeout: () => void; slept: number[] } => {
+      let releaseTimeout: () => void = () => undefined
+      const slept: number[] = []
+      return {
+        now: () => 0,
+        sleep: (ms: number) => {
+          slept.push(ms)
+          return ms === AGENT_BEFORE_SEND_TIMEOUT_MS
+            ? new Promise<void>((resolve) => (releaseTimeout = resolve))
+            : Promise.resolve()
+        },
+        releaseTimeout: () => releaseTimeout(),
+        slept
+      }
+    }
+
+    it('準備を待ってから、消去・貼り付け・Enter を送る', async () => {
+      const controller = controllerWithEmptyInput()
+      const testClock = timeoutClock()
+      let finishPreparation: () => void = () => undefined
+      const beforeSend = vi.fn(() => new Promise<void>((resolve) => (finishPreparation = resolve)))
+      const { result } = renderHook(() =>
+        useAgentPromptSender({ controller, onSettled: vi.fn(), beforeSend, clock: testClock })
+      )
+      let sending: Promise<unknown> = Promise.resolve()
+      act(() => {
+        sending = result.current.send('hello')
+      })
+      await act(async () => undefined)
+      expect(beforeSend).toHaveBeenCalledOnce()
+      expect(controller.writes).toEqual([])
+      expect(controller.beginSending).not.toHaveBeenCalled()
+      await act(async () => {
+        finishPreparation()
+        await sending
+      })
+      expect(controller.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\x1b[201~', '\r'])
+    })
+
+    it('準備が失敗しても送る', async () => {
+      const controller = controllerWithEmptyInput()
+      const beforeSend = vi.fn(async () => {
+        throw new Error('begin failed')
+      })
+      const { result } = renderHook(() =>
+        useAgentPromptSender({ controller, onSettled: vi.fn(), beforeSend, clock: timeoutClock() })
+      )
+      await act(async () => {
+        await result.current.send('hello')
+      })
+      expect(controller.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\x1b[201~', '\r'])
+      expect(result.current.error).toBeNull()
+    })
+
+    it('準備が上限(10 秒)を超えたら待たずに送る', async () => {
+      const controller = controllerWithEmptyInput()
+      const testClock = timeoutClock()
+      const beforeSend = vi.fn(() => new Promise<void>(() => undefined))
+      const { result } = renderHook(() =>
+        useAgentPromptSender({ controller, onSettled: vi.fn(), beforeSend, clock: testClock })
+      )
+      let sending: Promise<unknown> = Promise.resolve()
+      act(() => {
+        sending = result.current.send('hello')
+      })
+      await act(async () => undefined)
+      expect(controller.writes).toEqual([])
+      await act(async () => {
+        testClock.releaseTimeout()
+        await sending
+      })
+      expect(testClock.slept[0]).toBe(AGENT_BEFORE_SEND_TIMEOUT_MS)
+      expect(controller.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\x1b[201~', '\r'])
+    })
+  })
 })
```

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` の変更（配線。パターン 155）:

```diff
--- a/src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts
+++ b/src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts
@@ -179,11 +179,21 @@ describe('useAgentWorkspace', () => {
       const { result } = renderWorkspace()
       expect(mockUseAgentPromptSender).toHaveBeenLastCalledWith({
         controller: getAgentTerminalController(),
-        onSettled: result.current.agentTerminal.layout.open
+        onSettled: result.current.agentTerminal.layout.open,
+        beforeSend: undefined
       })
       expect(result.current.sendToAgent).toBe(sender.send)
     })

+    // 省略可能な引数のため、渡し忘れを型で検知できない(パターン 155)
+    it('送信の前の準備(beforeAgentSend)を sender の beforeSend へそのまま渡す', () => {
+      const beforeAgentSend = vi.fn(async () => undefined)
+      renderWorkspace({ beforeAgentSend })
+      expect(mockUseAgentPromptSender.mock.lastCall![0]).toMatchObject({
+        beforeSend: beforeAgentSend
+      })
+    })
+
     it('送信の後(onSettled)にターミナルのパネルが開く', () => {
       const { result } = renderWorkspace()
       const { onSettled } = mockUseAgentPromptSender.mock.lastCall![0] as {
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts 2>&1 | tail -n 5`
Expected: FAIL（`AGENT_BEFORE_SEND_TIMEOUT_MS` が無い・`beforeSend` を待たずに書き込む・`beforeSend` が渡らない）

- [ ] **Step 3: 実装する**

`src/renderer/src/hooks/useAgentPromptSender.ts` の変更:

```diff
--- a/src/renderer/src/hooks/useAgentPromptSender.ts
+++ b/src/renderer/src/hooks/useAgentPromptSender.ts
@@ -14,6 +14,8 @@ import { useTransientNotice } from './useTransientNotice'

 /** 送信の結果の通知を消すまでの時間 */
 export const AGENT_SEND_NOTICE_DURATION_MS = 3_000
+/** 送信の前の準備(エージェントの変更の記録)を待つ上限。main の記録の打ち切りと同じ 10 秒 */
+export const AGENT_BEFORE_SEND_TIMEOUT_MS = 10_000

 export interface AgentPromptSenderState {
   isSending: boolean
@@ -29,12 +31,15 @@ export interface UseAgentPromptSenderOptions {
   controller: AgentTerminalController
   /** 送った後・失敗した後に呼ぶ(ターミナルのパネルを開く) */
   onSettled: () => void
+  /** 送信の手順(消去・貼り付け・Enter)の前に待つ準備(エージェントの変更の記録を始める)。失敗しても・上限を超えても送る */
+  beforeSend?: () => Promise<void>
   clock?: AgentSendClock
 }

 export function useAgentPromptSender({
   controller,
   onSettled,
+  beforeSend,
   clock = realClock
 }: UseAgentPromptSenderOptions): AgentPromptSenderState {
   const [isSending, setIsSending] = useState(false)
@@ -50,6 +55,14 @@ export function useAgentPromptSender({
       setIsSending(true)
       setError(null)
       clear()
+      // エージェントが書き始めるのは Enter の後なので、記録はその前に終わらせる(設計書「記録の開始」)。記録はおまけで、
+      // 送ることが主のため、失敗しても上限を超えても送る。待つ間は利用者のキー入力を溜めない
+      if (beforeSend !== undefined) {
+        await Promise.race([
+          beforeSend().catch(() => undefined),
+          clock.sleep(AGENT_BEFORE_SEND_TIMEOUT_MS)
+        ])
+      }
       // 送信の手順の間は利用者のキー入力を溜める(貼り付けの途中に打鍵が混ざらないように)。finally で必ず解く
       controller.beginSending()
       try {
@@ -83,7 +96,7 @@ export function useAgentPromptSender({
         setIsSending(false)
       }
     },
-    [controller, onSettled, clock, announce, clear]
+    [controller, onSettled, beforeSend, clock, announce, clear]
   )

   return { isSending, error, notice, send }
```

`src/renderer/src/hooks/useAgentWorkspace.ts` の変更:

```diff
--- a/src/renderer/src/hooks/useAgentWorkspace.ts
+++ b/src/renderer/src/hooks/useAgentWorkspace.ts
@@ -33,6 +33,8 @@ export interface UseAgentWorkspaceOptions {
   isExecuting: boolean
   /** 確認のダイアログ(既定は window.confirm。テストで差し替える) */
   onConfirm?: (message: string) => boolean
+  /** プロンプトをエージェントへ送る前に待つ準備(useAgentChanges.begin。エージェントの変更の記録を始める) */
+  beforeAgentSend?: () => Promise<void>
 }

 export interface AgentWorkspaceState {
@@ -54,7 +56,8 @@ export interface AgentWorkspaceState {
 export function useAgentWorkspace({
   folderPath,
   isExecuting,
-  onConfirm = confirm
+  onConfirm = confirm,
+  beforeAgentSend
 }: UseAgentWorkspaceOptions): AgentWorkspaceState {
   const executionMode = useExecutionMode()
   // xterm と IPC の購読を持つ、文書ごとに 1 つの部品(StrictMode・パネルの開閉で作り直さない)
@@ -67,7 +70,8 @@ export function useAgentWorkspace({
   })
   const agentSender = useAgentPromptSender({
     controller: agentController,
-    onSettled: agentLayout.open
+    onSettled: agentLayout.open,
+    beforeSend: beforeAgentSend
   })
   const isAgentMode = executionMode.mode === 'agent-cli'
   const isAgentSessionActive =
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts 2>&1 | tail -n 5`
Expected: PASS

- [ ] **Step 5: 変異で落ちることを確かめる**（手順は Task 4 の Step 5）

| #   | ファイル                  | 置き換え前                                            | 置き換え後                                     | 落ちるテスト                                                            |
| --- | ------------------------- | ----------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| A1  | `useAgentPromptSender.ts` | `          beforeSend().catch(() => undefined),`      | `          beforeSend(),`                      | `準備が失敗しても送る`                                                  |
| A2  | `useAgentPromptSender.ts` | `          clock.sleep(AGENT_BEFORE_SEND_TIMEOUT_MS)` | `          new Promise<void>(() => undefined)` | `準備が上限(10 秒)を超えたら待たずに送る`（打ち切りで失敗）             |
| A3  | `useAgentWorkspace.ts`    | `    beforeSend: beforeAgentSend`                     | `    beforeSend: undefined`                    | `送信の前の準備(beforeAgentSend)を sender の beforeSend へそのまま渡す` |

- [ ] **Step 6: 確認コマンド**

```bash
npm run typecheck 2>&1 | tail -n 5
npx prettier --write src/renderer/src/hooks/useAgentPromptSender.ts src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts
npx eslint src/renderer/src/hooks/useAgentPromptSender.ts src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts
```

---

### Task 14: renderer: エージェントの変更の diff タブ（`kind: 'agent'`・DiffView の切り替え）

**Files:**

- Modify: `src/renderer/src/hooks/useDiffTabs.ts`（`DiffTabKind` に `agent`）、`src/renderer/src/hooks/diffTabPath.ts`（`agent` の印の decode）、`src/renderer/src/hooks/useCombinedEditorTabs.ts`（`diffTabLabel` を切り出して `agent` のラベル）、`src/renderer/src/hooks/useDiffOperations.ts:192-197`（`agent` は `agentChangesApi.getAgentChangeDiff`）、`src/renderer/src/types.ts:157`（`AgentDiffActions`）、`src/renderer/src/components/source-control/DiffView.tsx`（`agentActions`）、`src/renderer/src/components/EditorPanel.tsx:79-81・122・202-204`（`agentDiffActions` を agent のタブだけ DiffView に渡す・agent では `isUntracked` を使わない）、`src/renderer/src/hooks/useAppState.ts:201`（gitStatus で閉じる対象から agent を外す）・`:432`（agent のタブは解決ビューにしない）
- Test: `hooks/__tests__/diffTabPath.test.ts`・`useCombinedEditorTabs.test.ts`・`useDiffOperations.test.ts`・`useAppState.test.ts`、`components/source-control/__tests__/DiffView.test.tsx`、`components/__tests__/EditorPanel.test.tsx`

**Interfaces:**

- Consumes: `getAgentChangeDiff`（Task 9 の `lib/agentChangesApi`）、`DiffTabKey`（Task 10）
- Produces: `DiffTabKind = 'unstaged' | 'staged' | 'agent'`、`diffTabLabel(tab: DiffTabKey): string`（`useCombinedEditorTabs.ts`）、`interface AgentDiffActions { canRevertHunk: boolean; disabledReason: string | null; error: string | null; onRevertHunk: (patch: string, hunkHeader: string) => void }`（`error` は DiffView が `role="alert"` で出す）（`types.ts`）、`DiffView` の `agentActions?: AgentDiffActions`、`EditorPanel` の `agentDiffActions?: AgentDiffActions`
- 注: agent のタブではステージ・アンステージ・取り消しのボタンを出さない（設計書「diff タブ」）。打ち切ったハンクは戻させない（既存の `canOperateHunk` の規則。agent では git status の未追跡を見ない）。一覧から消えた agent のタブを閉じる配線と、開く導線は Task 18

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/diffTabPath.test.ts`:

```diff
--- a/src/renderer/src/hooks/__tests__/diffTabPath.test.ts
+++ b/src/renderer/src/hooks/__tests__/diffTabPath.test.ts
@@ -39,3 +39,13 @@ describe('encodeDiffTabPath / isDiffTabPath / decodeDiffTabPath', () => {
     expect(decodeDiffTabPath(encodeDiffTabPath(stagedKey))).toEqual(stagedKey)
   })
 })
+
+describe('エージェントの変更の diff タブ', () => {
+  it('kind: agent も往復変換で元のキーに戻り、他の種類と別の擬似パスになる', () => {
+    const agentKey: DiffTabKey = { path: 'a/b/c.ts', kind: 'agent' }
+    const encoded = encodeDiffTabPath(agentKey)
+    expect(isDiffTabPath(encoded)).toBe(true)
+    expect(decodeDiffTabPath(encoded)).toEqual(agentKey)
+    expect(encoded).not.toBe(encodeDiffTabPath({ path: 'a/b/c.ts', kind: 'unstaged' }))
+  })
+})
```

`src/renderer/src/hooks/__tests__/useCombinedEditorTabs.test.ts`:

```diff
--- a/src/renderer/src/hooks/__tests__/useCombinedEditorTabs.test.ts
+++ b/src/renderer/src/hooks/__tests__/useCombinedEditorTabs.test.ts
@@ -1,6 +1,7 @@
+import type { DiffTabKey } from '../useDiffTabs'
 import { renderHook } from '@testing-library/react'
 import { describe, it, expect, vi } from 'vitest'
-import { useCombinedEditorTabs } from '../useCombinedEditorTabs'
+import { diffTabLabel, useCombinedEditorTabs } from '../useCombinedEditorTabs'
 import { encodeDiffTabPath } from '../diffTabPath'
 import type { OpenFile } from '../../types'

@@ -205,3 +206,13 @@ describe('useCombinedEditorTabs', () => {
     expect(result.current.combinedTabs).not.toBe(firstCombinedTabs)
   })
 })
+
+describe('diffTabLabel', () => {
+  it.each<[DiffTabKey, string]>([
+    [{ path: 'src/a.ts', kind: 'unstaged' }, 'src/a.ts (未ステージ差分)'],
+    [{ path: 'src/a.ts', kind: 'staged' }, 'src/a.ts (ステージ済み差分)'],
+    [{ path: 'src/a.ts', kind: 'agent' }, 'src/a.ts (エージェントの変更)']
+  ])('%o → %s', (tab, label) => {
+    expect(diffTabLabel(tab)).toBe(label)
+  })
+})
```

`src/renderer/src/hooks/__tests__/useDiffOperations.test.ts`:

```diff
--- a/src/renderer/src/hooks/__tests__/useDiffOperations.test.ts
+++ b/src/renderer/src/hooks/__tests__/useDiffOperations.test.ts
@@ -2,8 +2,10 @@ import { renderHook, waitFor, act } from '@testing-library/react'
 import { describe, it, expect, vi, beforeEach } from 'vitest'

 vi.mock('../../lib/gitApi')
+vi.mock('../../lib/agentChangesApi')

 import * as gitApi from '../../lib/gitApi'
+import * as agentChangesApi from '../../lib/agentChangesApi'
 import { useDiffOperations } from '../useDiffOperations'
 import type { FileOperationLock } from '../useFileOperationLock'
 import type { DiffTabKey } from '../useDiffTabs'
@@ -1129,3 +1131,18 @@ describe('canDiscardHunk', () => {
     expect(compute(null, [{ path: 'a.ts', index: ' ', workingDir: 'M' }])).toBe(false)
   })
 })
+
+describe('useDiffOperations — エージェントの変更の diff タブ', () => {
+  it('agent のタブはエージェントの変更の diff を取り、git の diff は呼ばない。ハンクの取り消しは出さない', async () => {
+    vi.mocked(agentChangesApi.getAgentChangeDiff).mockResolvedValue('agent diff')
+    const activeTab: DiffTabKey = { path: 'src/a.ts', kind: 'agent' }
+    const { result } = renderHook(() =>
+      useDiffOperations(activeTab, vi.fn(), [{ path: 'src/a.ts', index: ' ', workingDir: 'M' }])
+    )
+    await waitFor(() => expect(result.current.diffContent).toBe('agent diff'))
+    expect(agentChangesApi.getAgentChangeDiff).toHaveBeenCalledWith('src/a.ts')
+    expect(mockGetDiff).not.toHaveBeenCalled()
+    expect(result.current.canDiscardHunk).toBe(false)
+    expect(result.current.diffStaged).toBe(false)
+  })
+})
```

`src/renderer/src/hooks/__tests__/useAppState.test.ts`:

```diff
--- a/src/renderer/src/hooks/__tests__/useAppState.test.ts
+++ b/src/renderer/src/hooks/__tests__/useAppState.test.ts
@@ -482,6 +482,37 @@ describe('useAppState', () => {
     expect(mockCloseDiffTab).toHaveBeenCalledWith({ path: 'gone.txt', kind: 'unstaged' })
   })

+  it('エージェントの変更の diff タブは、gitStatus.files に無くても閉じない', () => {
+    const mockCloseDiffTab = vi.fn()
+    mockUseDiffTabs.mockReturnValue({
+      diffTabs: [{ path: 'agent-only.txt', kind: 'agent' }],
+      activeDiffTab: null,
+      openDiffTab: vi.fn(),
+      closeDiffTab: mockCloseDiffTab,
+      activateDiffTab: vi.fn(),
+      deactivateDiffTab: vi.fn()
+    })
+    mockUseGitStatus.mockReturnValue({
+      gitStatus: {
+        isRepo: true,
+        mergeInProgress: false,
+        hasOrigin: true,
+        hasRemote: true,
+        upstream: 'origin/main',
+        detached: false,
+        branch: 'main',
+        ahead: 0,
+        behind: 0,
+        files: []
+      },
+      gitLoading: false,
+      gitError: null,
+      refreshGitStatus: vi.fn()
+    })
+    renderHook(() => useAppState())
+    expect(mockCloseDiffTab).not.toHaveBeenCalled()
+  })
+
   it('gitStatus.files にまだ存在する diffTab は閉じない(unstaged タブ、未ステージの変更が残っている)', () => {
     const mockCloseDiffTab = vi.fn()
     mockUseDiffTabs.mockReturnValue({
@@ -1685,6 +1716,24 @@ describe('useAppState', () => {
       expect(result.current.isActiveFileConflicted).toBe(false)
     })

+    it('エージェントの変更の diff タブは、コンフリクト中のファイルでも解決ビューにしない', () => {
+      mockUseGitStatus.mockReturnValue({
+        gitStatus: conflictedStatus,
+        gitLoading: false,
+        gitError: null,
+        refreshGitStatus: vi.fn()
+      })
+      mockUseDiffTabs.mockReturnValue({
+        ...mockUseDiffTabs(),
+        activeDiffTab: { path: 'a.txt', kind: 'agent' }
+      })
+      const { result } = renderHook(() => useAppState())
+      expect(mockUseConflictFile).toHaveBeenLastCalledWith(
+        expect.objectContaining({ activePath: null })
+      )
+      expect(result.current.isActiveFileConflicted).toBe(false)
+    })
+
     // CLI の rebase / cherry-pick 中(MERGE_HEAD が無い)は ours/theirs の意味が逆になるため、
     // 未解決のファイルでも解決ビューを出さず(getConflictFile も呼ばせず)、通常の diff 表示にする
     it('マージ中でなければ、未解決のファイルの diff タブでも activePath は null', () => {
```

`src/renderer/src/components/source-control/__tests__/DiffView.test.tsx`:

```diff
--- a/src/renderer/src/components/source-control/__tests__/DiffView.test.tsx
+++ b/src/renderer/src/components/source-control/__tests__/DiffView.test.tsx
@@ -3,6 +3,7 @@ import userEvent from '@testing-library/user-event'
 import { describe, it, expect, vi } from 'vitest'
 import DiffView from '../DiffView'
 import { parseDiff, buildHunkPatch } from '../../../lib/diffParser'
+import type { AgentDiffActions } from '../../../types'

 const SAMPLE_DIFF = [
   'diff --git a/src/index.ts b/src/index.ts',
@@ -570,3 +571,80 @@ describe('DiffView — ハンクの取り消し', () => {
     }
   })
 })
+
+describe('DiffView — エージェントの変更', () => {
+  const actions = (overrides: Partial<AgentDiffActions> = {}): AgentDiffActions => ({
+    canRevertHunk: true,
+    disabledReason: null,
+    error: null,
+    onRevertHunk: vi.fn(),
+    ...overrides
+  })
+
+  it('ステージ・アンステージ・取り消しを出さず、「このハンクを実行前に戻す」だけを出す', async () => {
+    const agentActions = actions()
+    render(
+      <DiffView
+        diffText={SAMPLE_DIFF}
+        staged={false}
+        onStageHunk={vi.fn()}
+        onUnstageHunk={vi.fn()}
+        onDiscardHunk={vi.fn()}
+        canDiscardHunk
+        agentActions={agentActions}
+      />
+    )
+    expect(screen.queryByRole('button', { name: 'このハンクをステージ' })).toBeNull()
+    expect(screen.queryByRole('button', { name: 'このハンクを取り消す' })).toBeNull()
+    const buttons = screen.getAllByRole('button', { name: 'このハンクを実行前に戻す' })
+    expect(buttons).toHaveLength(2)
+    await userEvent.click(buttons[1])
+    const parsed = parseDiff(SAMPLE_DIFF)
+    expect(agentActions.onRevertHunk).toHaveBeenCalledWith(
+      buildHunkPatch(parsed, 1),
+      '@@ -10,1 +10,2 @@'
+    )
+  })
+
+  it('戻せない diff(追加・削除)ではハンクのボタンを出さない', () => {
+    render(
+      <DiffView
+        diffText={SAMPLE_DIFF}
+        staged={false}
+        onStageHunk={vi.fn()}
+        onUnstageHunk={vi.fn()}
+        agentActions={actions({ canRevertHunk: false })}
+      />
+    )
+    expect(screen.queryAllByRole('button')).toEqual([])
+  })
+
+  it('直前の戻す操作の失敗を role="alert" で出す', () => {
+    render(
+      <DiffView
+        diffText={SAMPLE_DIFF}
+        staged={false}
+        onStageHunk={vi.fn()}
+        onUnstageHunk={vi.fn()}
+        agentActions={actions({ error: 'ハンクを戻せませんでした' })}
+      />
+    )
+    expect(screen.getByRole('alert')).toHaveTextContent('ハンクを戻せませんでした')
+  })
+
+  it('押せないときは理由を 1 か所に出し、ボタンから参照する(パターン 126)', () => {
+    render(
+      <DiffView
+        diffText={SAMPLE_DIFF}
+        staged={false}
+        onStageHunk={vi.fn()}
+        onUnstageHunk={vi.fn()}
+        agentActions={actions({ disabledReason: '他の Git 操作の実行中です' })}
+      />
+    )
+    for (const button of screen.getAllByRole('button', { name: 'このハンクを実行前に戻す' })) {
+      expect(button).toBeDisabled()
+      expect(button).toHaveAccessibleDescription('他の Git 操作の実行中です')
+    }
+  })
+})
```

`src/renderer/src/components/__tests__/EditorPanel.test.tsx`（配線。パターン 155）:

```diff
--- a/src/renderer/src/components/__tests__/EditorPanel.test.tsx
+++ b/src/renderer/src/components/__tests__/EditorPanel.test.tsx
@@ -626,6 +626,30 @@ describe('EditorPanel — 複数タブ', () => {
 })

 describe('EditorPanel — diff タブ', () => {
+  // agentDiffActions は省略可能な props のため、渡し忘れ・種類の取り違えを型で検知できない(パターン 155)
+  it.each([
+    ['agent', 1],
+    ['unstaged', 0]
+  ] as const)('%s の diff タブでは「このハンクを実行前に戻す」を %i 個出す', (kind, count) => {
+    render(
+      <EditorPanel
+        {...defaultProps}
+        diffTabs={[{ path: 'src/index.ts', kind }]}
+        activeDiffTab={{ path: 'src/index.ts', kind }}
+        diffContent={'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n'}
+        agentDiffActions={{
+          canRevertHunk: true,
+          disabledReason: null,
+          error: null,
+          onRevertHunk: vi.fn()
+        }}
+      />
+    )
+    expect(screen.queryAllByRole('button', { name: 'このハンクを実行前に戻す' })).toHaveLength(
+      count
+    )
+  })
+
   it('activeDiffTab がある場合、DiffView を表示しMonaco Editorは表示しない', () => {
     render(
       <EditorPanel
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/diffTabPath.test.ts src/renderer/src/hooks/__tests__/useCombinedEditorTabs.test.ts src/renderer/src/hooks/__tests__/useDiffOperations.test.ts src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/components/source-control/__tests__/DiffView.test.tsx src/renderer/src/components/__tests__/EditorPanel.test.tsx 2>&1 | tail -n 5`
Expected: FAIL（型エラー・`diffTabLabel` が無い・agent の diff を git から取る・ボタンが無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/hooks/useDiffTabs.ts`:

```diff
--- a/src/renderer/src/hooks/useDiffTabs.ts
+++ b/src/renderer/src/hooks/useDiffTabs.ts
@@ -2,8 +2,11 @@ import { useState } from 'react'
 import { computeAdjacentItem } from './computeAdjacentItem'
 import { isSamePath } from '../lib/pathUtils'

-/** diff タブの種類。unstaged: 未ステージ(index → 作業ツリー)、staged: ステージ済み(HEAD → index) */
-export type DiffTabKind = 'unstaged' | 'staged'
+/**
+ * diff タブの種類。unstaged: 未ステージ(index → 作業ツリー)、staged: ステージ済み(HEAD → index)、
+ * agent: エージェントの変更(記録の時点 → 作業ツリー。ステージの操作は無く、実行前に戻す操作だけ)
+ */
+export type DiffTabKind = 'unstaged' | 'staged' | 'agent'

 export interface DiffTabKey {
   path: string
```

`src/renderer/src/hooks/diffTabPath.ts`:

```diff
--- a/src/renderer/src/hooks/diffTabPath.ts
+++ b/src/renderer/src/hooks/diffTabPath.ts
@@ -23,7 +23,8 @@ export function isDiffTabPath(path: string): boolean {
 export function decodeDiffTabPath(encodedPath: string): DiffTabKey {
   const rest = encodedPath.slice(MARKER.length)
   const separatorIndex = rest.indexOf(SEPARATOR)
-  const kind: DiffTabKind = rest.slice(0, separatorIndex) === 'staged' ? 'staged' : 'unstaged'
+  const marker = rest.slice(0, separatorIndex)
+  const kind: DiffTabKind = marker === 'staged' || marker === 'agent' ? marker : 'unstaged'
   const path = rest.slice(separatorIndex + 1)
   return { path, kind }
 }
```

`src/renderer/src/hooks/useCombinedEditorTabs.ts`:

```diff
--- a/src/renderer/src/hooks/useCombinedEditorTabs.ts
+++ b/src/renderer/src/hooks/useCombinedEditorTabs.ts
@@ -41,6 +41,12 @@ interface CombinedEditorTabs {
   handleCloseTab: (path: string) => void
 }

+// diff タブのラベル。フルパス + 種類で一意にする(下の combinedTabs の説明)
+export function diffTabLabel(tab: DiffTabKey): string {
+  if (tab.kind === 'agent') return `${tab.path} (エージェントの変更)`
+  return `${tab.path} (${tab.kind === 'staged' ? 'ステージ済み' : '未ステージ'}差分)`
+}
+
 // 実ファイルタブと diff タブ(擬似パスでエンコードされたタブ)を1本のタブバーへ
 // 統合する責務のみを担う。フォーカス管理等の Monaco 固有ロジックとは責務が異なるため
 // EditorPanel から分離している。
@@ -67,7 +73,7 @@ export function useCombinedEditorTabs({
     // フルパス + ステージ状態でラベルの一意性を保つ
     const diffTabItems = diffTabs.map((tab) => ({
       path: encodeDiffTabPath(tab),
-      name: `${tab.path} (${tab.kind === 'staged' ? 'ステージ済み' : '未ステージ'}差分)`,
+      name: diffTabLabel(tab),
       isDirty: false,
       isReorderable: false
     }))
```

`src/renderer/src/hooks/useDiffOperations.ts`:

```diff
--- a/src/renderer/src/hooks/useDiffOperations.ts
+++ b/src/renderer/src/hooks/useDiffOperations.ts
@@ -1,5 +1,6 @@
 import { useEffect, useMemo, useRef, useState } from 'react'
 import * as gitApi from '../lib/gitApi'
+import * as agentChangesApi from '../lib/agentChangesApi'
 import type { GitFileStatus } from '@shared/types'
 import { isSameKey } from './useDiffTabs'
 import type { DiffTabKey } from './useDiffTabs'
@@ -189,12 +190,16 @@ export function useDiffOperations(
         // ステージ済みリネームは旧パスも渡す。新パスだけだと git がリネーム検出を
         // せず「新規ファイル + 全行追加」の diff になり、それをアンステージすると
         // 旧パスの削除だけがステージに残ってファイルが消えてしまう
-        const content = await gitApi.getDiff(
-          activeDiffTab.path,
-          activeDiffTab.kind === 'staged',
-          isUntracked,
-          activeFileStatus?.from
-        )
+        // エージェントの変更の diff は記録の時点との比較で、git status の情報を使わない(main が記録のインデックスで判定する)
+        const content =
+          activeDiffTab.kind === 'agent'
+            ? await agentChangesApi.getAgentChangeDiff(activeDiffTab.path)
+            : await gitApi.getDiff(
+                activeDiffTab.path,
+                activeDiffTab.kind === 'staged',
+                isUntracked,
+                activeFileStatus?.from
+              )
         if (cancelled) return
         setDiffContent(content)
         setFetchError(null)
```

`src/renderer/src/types.ts`:

```diff
--- a/src/renderer/src/types.ts
+++ b/src/renderer/src/types.ts
@@ -154,6 +154,18 @@ export interface RemoteSetupPanelState {
 // AI の出力のエディタへの反映(useApplyOutputToEditor)。挿入はカーソルの位置へ、置換は選択範囲を置き換える
 export type ApplyMode = 'insert' | 'replace'

+// エージェントの変更の diff タブ(DiffView の agentActions)。ハンクを実行前に戻す操作と、押せない理由
+export interface AgentDiffActions {
+  /** 開いている diff のハンクを戻せるか(変更・種類の変更で、記録したファイル。追加・削除はファイル単位で戻す) */
+  canRevertHunk: boolean
+  /** 押せない理由(押せるなら null。パターン 126) */
+  disabledReason: string | null
+  /** 直前の戻す操作の失敗(無ければ null。role="alert" で出す) */
+  error: string | null
+  /** 確認 → 戻す → 成功したときだけ同期(useAgentChangesRevert) */
+  onRevertHunk: (patch: string, hunkHeader: string) => void
+}
+
 // role="status" で読み上げる通知。id は通知ごとに進め、同じ文言が続いても読み上げられるようにする(パターン 87)
 export interface Announcement {
   text: string
```

`src/renderer/src/components/source-control/DiffView.tsx`:

```diff
--- a/src/renderer/src/components/source-control/DiffView.tsx
+++ b/src/renderer/src/components/source-control/DiffView.tsx
@@ -1,5 +1,6 @@
-import { useMemo } from 'react'
+import { useId, useMemo } from 'react'
 import { parseDiff, buildHunkPatch } from '../../lib/diffParser'
+import type { AgentDiffActions } from '../../types'

 interface Props {
   diffText: string
@@ -18,6 +19,8 @@ interface Props {
   /** 開いている diff が「取り消せるハンク操作の対象」か(追跡済みの変更ファイルで、
    *  未追跡・intent-to-add・コンフリクトでない)。判定は useDiffOperations が行う */
   canDiscardHunk?: boolean
+  /** エージェントの変更の diff のとき渡す。ステージ・アンステージ・取り消しのボタンを出さず、「このハンクを実行前に戻す」だけを出す */
+  agentActions?: AgentDiffActions
 }

 // 描画する diff 行数の上限。main 側のサイズ上限
@@ -93,8 +96,10 @@ export default function DiffView({
   disabled = false,
   isUntracked = false,
   onDiscardHunk,
-  canDiscardHunk = false
+  canDiscardHunk = false,
+  agentActions
 }: Props): React.JSX.Element {
+  const agentReasonId = useId()
   // disabled(実行中フラグ)の切り替えだけでも再レンダーされるため、diffText 自体が
   // 変わっていないときに毎回パースし直さないよう memo 化する
   const parsed = useMemo(() => parseDiff(diffText), [diffText])
@@ -127,6 +132,17 @@ export default function DiffView({

   return (
     <div className="diff-view">
+      {agentActions !== undefined && agentActions.error !== null && (
+        <p className="diff-view__error" role="alert">
+          {agentActions.error}
+        </p>
+      )}
+      {/* エージェントの変更の diff で、戻すボタンを押せない理由(1 か所に出してボタンから参照する。パターン 126) */}
+      {agentActions?.canRevertHunk === true && agentActions.disabledReason !== null && (
+        <p id={agentReasonId} className="diff-view__notice">
+          {agentActions.disabledReason}
+        </p>
+      )}
       {/* 未解決コンフリクトの combined diff は git apply --cached が必ず
           "No valid patches in input" で失敗するため、ハンク操作を出さない。
           なぜ操作できないのかが分かるよう理由を添える */}
@@ -173,7 +189,24 @@ export default function DiffView({
                 ただし isUntracked の場合、ボタンは patch を使わず
                 gitApi.stageFile(path) でファイル全体を git add するだけなので、
                 この懸念は当てはまらない(打ち切っていても隠さない) */}
-              {canOperateHunk && (
+              {canOperateHunk && agentActions !== undefined && agentActions.canRevertHunk && (
+                <span className="diff-view__hunk-actions">
+                  <button
+                    type="button"
+                    className="diff-view__hunk-action-btn diff-view__hunk-action-btn--danger"
+                    disabled={disabled || agentActions.disabledReason !== null}
+                    aria-describedby={
+                      agentActions.disabledReason !== null ? agentReasonId : undefined
+                    }
+                    onClick={() =>
+                      agentActions.onRevertHunk(buildHunkPatch(parsed, index), hunk.header)
+                    }
+                  >
+                    このハンクを実行前に戻す
+                  </button>
+                </span>
+              )}
+              {canOperateHunk && agentActions === undefined && (
                 <span className="diff-view__hunk-actions">
                   <button
                     type="button"
```

`src/renderer/src/components/EditorPanel.tsx`:

```diff
--- a/src/renderer/src/components/EditorPanel.tsx
+++ b/src/renderer/src/components/EditorPanel.tsx
@@ -5,7 +5,7 @@ import { registerSaveCommand } from '../lib/editorShortcuts'
 import { useLatestRef } from '../hooks/useLatestRef'
 import { useEditorFocusManager } from '../hooks/useEditorFocusManager'
 import { useApplyOutputToEditor } from '../hooks/useApplyOutputToEditor'
-import type { OpenFile } from '../types'
+import type { AgentDiffActions, OpenFile } from '../types'
 import WelcomeView from './editor/WelcomeView'
 import EditorTabs from './editor/EditorTabs'
 import OutputPanel from './output/OutputPanel'
@@ -79,6 +79,8 @@ interface Props {
   agentTerminal?: AgentTerminalPanelState
   /** 編集中のタブのファイルがディスク上で変わったときの通知(useExternalFileChanges)。無ければ null */
   externalChangeBanner?: ExternalChangeBannerState | null
+  /** エージェントの変更の diff タブのハンクの操作(アクティブな diff タブが agent のときだけ DiffView に渡す) */
+  agentDiffActions?: AgentDiffActions
 }

 export default function EditorPanel({
@@ -119,7 +121,8 @@ export default function EditorPanel({
   isConflictBlocked,
   bottomPanel = 'output',
   agentTerminal,
-  externalChangeBanner = null
+  externalChangeBanner = null,
+  agentDiffActions
 }: Props): React.JSX.Element {
   const openFile = openFiles.find((f) => f.path === activeFilePath) ?? null
   // Monaco の onMount はファイル切替時の再マウント以外では再発火しないため、
@@ -199,9 +202,11 @@ export default function EditorPanel({
                       onStageHunk={onStageHunk}
                       onUnstageHunk={onUnstageHunk}
                       disabled={isHunkOperationInProgress}
-                      isUntracked={isActiveFileUntracked}
+                      // エージェントの変更の diff は git status の未追跡と無関係(打ち切った行をパッチに含めないため)
+                      isUntracked={activeDiffTab.kind !== 'agent' && isActiveFileUntracked}
                       onDiscardHunk={onDiscardHunk}
                       canDiscardHunk={canDiscardHunk}
+                      agentActions={activeDiffTab.kind === 'agent' ? agentDiffActions : undefined}
                     />
                   )}
                 </>
```

`src/renderer/src/hooks/useAppState.ts`:

```diff
--- a/src/renderer/src/hooks/useAppState.ts
+++ b/src/renderer/src/hooks/useAppState.ts
@@ -199,6 +199,8 @@ export function useAppState(): AppState {
     const files = git.gitStatus?.files
     if (files === undefined) return
     for (const tab of diffTabs.diffTabs) {
+      // エージェントの変更の diff タブは git status ではなく、エージェントの変更の一覧から消えたときに閉じる
+      if (tab.kind === 'agent') continue
       // 素の Set.has(文字列) だと、Windows のドライブレター大文字小文字違い等の
       // 表記揺れで一致しなくなり、まだ存在するファイルの diff タブを誤って
       // 閉じてしまう(ユーザーが見ている最中のタブが消える)。isSamePath で
@@ -429,7 +431,11 @@ export function useAppState(): AppState {
   // (解決済みになれば null)。CLI の rebase / cherry-pick 中(MERGE_HEAD が無い)は ours/theirs の
   // 意味が違うため解決ビューを出さず(getConflictFile も呼ばない)、通常の diff 表示にする。
   // main 側の解決操作もマージ中でなければ拒否する
-  const activeDiffPath = diffTabs.activeDiffTab?.path ?? null
+  // エージェントの変更の diff タブは解決ビューにしない(記録の時点との比較のため)
+  const activeDiffPath =
+    diffTabs.activeDiffTab !== null && diffTabs.activeDiffTab.kind !== 'agent'
+      ? diffTabs.activeDiffTab.path
+      : null
   const conflictActivePath =
     activeDiffPath !== null &&
     git.gitStatus?.mergeInProgress === true &&
```

- [ ] **Step 4: 通ることを確かめる**

```bash
npm run typecheck 2>&1 | tail -n 5
npx vitest run src/renderer 2>&1 | grep -E "Test Files|Tests "
```

Expected: 型エラー 0・すべて成功

- [ ] **Step 5: 変異で落ちることを確かめる**（手順は Task 4 の Step 5）

| #   | ファイル               | 置き換え前                                                                                           | 置き換え後                      | 落ちるテスト                                                           |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| A1  | `EditorPanel.tsx`      | `                      agentActions={activeDiffTab.kind === 'agent' ? agentDiffActions : undefined}` | （空行）                        | `agent の diff タブでは「このハンクを実行前に戻す」を 1 個出す`        |
| A2  | `useAppState.ts`       | `      if (tab.kind === 'agent') continue`                                                           | （空行）                        | `エージェントの変更の diff タブは、gitStatus.files に無くても閉じない` |
| A3  | `useDiffOperations.ts` | `          activeDiffTab.kind === 'agent'⏎            ?`                                             | `          false⏎            ?` | `agent のタブはエージェントの変更の diff を取り`                       |

- [ ] **Step 6: 確認コマンド**

```bash
npx prettier --write src/renderer/src/hooks/useDiffTabs.ts src/renderer/src/hooks/diffTabPath.ts src/renderer/src/hooks/useCombinedEditorTabs.ts src/renderer/src/hooks/useDiffOperations.ts src/renderer/src/types.ts src/renderer/src/components/source-control/DiffView.tsx src/renderer/src/components/EditorPanel.tsx src/renderer/src/hooks/useAppState.ts src/renderer/src/hooks/__tests__/diffTabPath.test.ts src/renderer/src/hooks/__tests__/useCombinedEditorTabs.test.ts src/renderer/src/hooks/__tests__/useDiffOperations.test.ts src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/components/source-control/__tests__/DiffView.test.tsx src/renderer/src/components/__tests__/EditorPanel.test.tsx
npx eslint src/renderer/src/hooks/useDiffTabs.ts src/renderer/src/hooks/diffTabPath.ts src/renderer/src/hooks/useCombinedEditorTabs.ts src/renderer/src/hooks/useDiffOperations.ts src/renderer/src/types.ts src/renderer/src/components/source-control/DiffView.tsx src/renderer/src/components/EditorPanel.tsx src/renderer/src/hooks/useAppState.ts
```

---

### Task 15: renderer: 戻す操作（`useAgentChangesRevert`）

**Files:**

- Create: `src/renderer/src/hooks/useAgentChangesRevert.ts`、`src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts`

**Interfaces:**

- Consumes: `lib/agentChangesApi`（Task 9）、`agentRevertDisabledReason`・`agentRevertAllDisabledReason`・`buildAgentRevert*ConfirmMessage`・`formatAgentChangesRevertedNotice`（Task 11）、`AgentChangesController`（Task 12）、既存の `FileOperationLock`（`hooks/useFileOperationLock.ts:4`）・`isPathAtOrInside`・`joinPath`（`lib/pathUtils.ts:95・155`）
- Produces: `interface AgentChangesRevertOptions { folderPath; changes: Pick<AgentChangesController, 'view' | 'isLoading' | 'listError' | 'savedPaths' | 'refresh' | 'announce'>; fileLock; agentRunning: boolean; hasDirtyTabAtOrInside; reloadOpenFile; closeTabsAtOrInside; confirmDiscardAnyDirty; reloadOpenFiles; refreshTree; refreshGitStatus; refreshDiff; onConfirm? }`、`interface AgentChangesRevertState { isReverting; error: string | null; revertDisabledReason: string | null; revertAllDisabledReason: string | null; revertFile(entry: AgentChangeEntry): Promise<void>; revertHunk(path: string, patch: string, hunkHeader: string): Promise<void>; revertAll(): Promise<void> }`、`useAgentChangesRevert(options): AgentChangesRevertState`
- 注: 既存の取り消し（`useDiscardFileChanges.ts:36-59`・`useDiscardHunk.ts:30-43`・`useDiscardAllChanges.ts:51-95`）と同じ順。実行中は `fileLock.lockGlobal()`（他の Git 操作を止める。パターン 111）。成功したときだけタブを読み直す（追加はタブを閉じる）。失敗でも一覧・git status・ツリー・diff は取り直す（状態が変わりうる）。`partial` は読み直してから警告（パターン 52）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts`（新規。確認のキャンセルで何も呼ばない・成功したときだけ同期・`partial` で同期）:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { AgentChangeEntry } from '@shared/types'

vi.mock('../../lib/agentChangesApi')

import * as agentChangesApi from '../../lib/agentChangesApi'
import { useAgentChangesRevert } from '../useAgentChangesRevert'
import type { AgentChangesRevertOptions } from '../useAgentChangesRevert'
import type { AgentChangesList } from '../useAgentChanges'
import type { FileOperationLock } from '../useFileOperationLock'
import {
  AGENT_CHANGES_BUSY_LOADING,
  AGENT_CHANGES_TRUNCATED_REASON
} from '../../lib/agentChangesMessages'

const entry = (
  path: string,
  status: AgentChangeEntry['status'],
  extra: Partial<AgentChangeEntry> = {}
): AgentChangeEntry => ({
  path,
  status,
  isDirectory: false,
  notRecorded: false,
  ...extra
})

const listOf = (entries: AgentChangeEntry[], truncated = false): AgentChangesList => ({
  entries,
  totalCount: entries.length,
  truncated,
  headChanged: false
})

const makeLock = (): FileOperationLock => ({
  isLocked: vi.fn(() => false),
  lock: vi.fn(),
  unlock: vi.fn(),
  isAnyLocked: vi.fn(() => false),
  lockGlobal: vi.fn(),
  unlockGlobal: vi.fn()
})

function makeOptions(
  overrides: Partial<AgentChangesRevertOptions> = {},
  list: AgentChangesList | null = listOf([entry('a.txt', 'M')])
): AgentChangesRevertOptions {
  return {
    folderPath: '/repo',
    changes: {
      view: { kind: 'recording', startedAt: 1, list },
      isLoading: false,
      listError: null,
      savedPaths: new Set(),
      refresh: vi.fn(async () => undefined),
      announce: vi.fn()
    },
    fileLock: makeLock(),
    agentRunning: false,
    hasDirtyTabAtOrInside: vi.fn(() => false),
    reloadOpenFile: vi.fn(async () => undefined),
    closeTabsAtOrInside: vi.fn(),
    confirmDiscardAnyDirty: vi.fn(() => true),
    reloadOpenFiles: vi.fn(async () => undefined),
    refreshTree: vi.fn(async () => true),
    refreshGitStatus: vi.fn(async () => undefined),
    refreshDiff: vi.fn(),
    onConfirm: vi.fn(() => true),
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(agentChangesApi.revertAgentChange).mockResolvedValue(undefined)
  vi.mocked(agentChangesApi.revertAgentChangeHunk).mockResolvedValue(undefined)
  vi.mocked(agentChangesApi.revertAllAgentChanges).mockResolvedValue({ status: 'done' })
})

describe('useAgentChangesRevert — ファイル単位', () => {
  it('確認をキャンセルしたら何も呼ばず、ロックも取らない', async () => {
    const options = makeOptions({ onConfirm: vi.fn(() => false) })
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertFile(entry('a.txt', 'M'))
    })
    expect(agentChangesApi.revertAgentChange).not.toHaveBeenCalled()
    expect(options.fileLock.lockGlobal).not.toHaveBeenCalled()
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
  })

  it('成功したら、全体ロックの中で戻し、開いているタブを読み直し、結果を読み上げ、一覧と git status を取り直す', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertFile(entry('src/a.txt', 'M'))
    })
    expect(agentChangesApi.revertAgentChange).toHaveBeenCalledWith('src/a.txt')
    expect(options.fileLock.lockGlobal).toHaveBeenCalledOnce()
    expect(options.fileLock.unlockGlobal).toHaveBeenCalledOnce()
    expect(options.reloadOpenFile).toHaveBeenCalledWith('/repo/src/a.txt')
    expect(options.closeTabsAtOrInside).not.toHaveBeenCalled()
    expect(options.changes.announce).toHaveBeenCalledWith('1 件を実行前の状態に戻しました')
    expect(options.refreshGitStatus).toHaveBeenCalledOnce()
    expect(options.changes.refresh).toHaveBeenCalledOnce()
    expect(options.refreshDiff).toHaveBeenCalledOnce()
    expect(result.current.isReverting).toBe(false)
  })

  it('追加されたフォルダはゴミ箱へ移した後、配下のタブを閉じる(読み直さない)', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertFile(entry('newdir/', 'A', { isDirectory: true }))
    })
    expect(options.onConfirm).toHaveBeenCalledWith(
      'newdir/ をゴミ箱へ移動しますか？フォルダとその中身（.gitignore の対象を含む）がすべて移動します。'
    )
    expect(options.closeTabsAtOrInside).toHaveBeenCalledWith('/repo/newdir')
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
  })

  it('失敗したらタブを読み直さず、エラーを出し、一覧は取り直す(パターン 20)', async () => {
    vi.mocked(agentChangesApi.revertAgentChange).mockRejectedValue(new Error('戻せません'))
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertFile(entry('a.txt', 'M'))
    })
    expect(result.current.error).toBe('戻せません')
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
    expect(options.changes.announce).not.toHaveBeenCalled()
    expect(options.changes.refresh).toHaveBeenCalledOnce()
    expect(options.fileLock.unlockGlobal).toHaveBeenCalledOnce()
  })

  it('確認の文言に、アプリでの保存・未保存の編集・エージェントの動作を足す', async () => {
    const options = makeOptions({
      agentRunning: true,
      hasDirtyTabAtOrInside: vi.fn(() => true)
    })
    options.changes.savedPaths = new Set(['/repo/a.txt'])
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertFile(entry('a.txt', 'M'))
    })
    const message = vi.mocked(options.onConfirm!).mock.calls[0][0]
    expect(message).toContain('このファイルは、記録を始めた後にアプリで保存されています。')
    expect(message).toContain('エディタの未保存の編集も破棄されます。')
    expect(message).toContain('エージェントが動いている間は')
    expect(options.hasDirtyTabAtOrInside).toHaveBeenCalledWith('/repo/a.txt')
  })

  it.each<[string, Partial<AgentChangesRevertOptions>, AgentChangeEntry]>([
    ['一覧の取得中', {}, entry('a.txt', 'M')],
    ['記録しなかったファイル', {}, entry('big.bin', 'M', { notRecorded: true })]
  ])('%s は確認も出さずに何もしない', async (label, overrides, target) => {
    const options = makeOptions(overrides)
    if (label === '一覧の取得中') options.changes.isLoading = true
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertFile(target)
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(agentChangesApi.revertAgentChange).not.toHaveBeenCalled()
  })

  it('押せない理由を返す(取得中・他の Git 操作の実行中)', () => {
    const options = makeOptions()
    options.changes.isLoading = true
    const { result } = renderHook(() => useAgentChangesRevert(options))
    expect(result.current.revertDisabledReason).toBe(AGENT_CHANGES_BUSY_LOADING)
  })
})

describe('useAgentChangesRevert — ハンク', () => {
  it('確認の後に戻し、成功したらそのファイルのタブを読み直す', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@')
    })
    expect(options.onConfirm).toHaveBeenCalledWith(
      'a.txt の次のハンクを実行前の状態に戻しますか？この操作は元に戻せません。\n\n@@ -1 +1 @@'
    )
    expect(agentChangesApi.revertAgentChangeHunk).toHaveBeenCalledWith('a.txt', 'patch')
    expect(options.reloadOpenFile).toHaveBeenCalledWith('/repo/a.txt')
    expect(options.refreshDiff).toHaveBeenCalledOnce()
  })

  it('失敗したら読み直さずエラーを出す', async () => {
    vi.mocked(agentChangesApi.revertAgentChangeHunk).mockRejectedValue(new Error('合いません'))
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@')
    })
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
    expect(result.current.error).toBe('合いません')
  })
})

describe('useAgentChangesRevert — すべて', () => {
  const entries = [entry('a.txt', 'M'), entry('new.txt', 'A'), entry('gone.txt', 'D')]

  it('確認で見せた一覧を渡し、成功したら全タブを読み直して件数を読み上げる', async () => {
    const options = makeOptions({}, listOf(entries))
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertAll()
    })
    expect(vi.mocked(options.onConfirm!).mock.calls[0][0]).toContain(
      'うち 1 件の新しいファイル・フォルダはゴミ箱へ移動します。'
    )
    expect(options.confirmDiscardAnyDirty).toHaveBeenCalledOnce()
    expect(agentChangesApi.revertAllAgentChanges).toHaveBeenCalledWith([
      { path: 'a.txt', status: 'M' },
      { path: 'new.txt', status: 'A' },
      { path: 'gone.txt', status: 'D' }
    ])
    expect(options.reloadOpenFiles).toHaveBeenCalledOnce()
    expect(options.changes.announce).toHaveBeenCalledWith('3 件を実行前の状態に戻しました')
  })

  it('未保存の編集の破棄を断ったら何もしない', async () => {
    const options = makeOptions({ confirmDiscardAnyDirty: vi.fn(() => false) }, listOf(entries))
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertAll()
    })
    expect(agentChangesApi.revertAllAgentChanges).not.toHaveBeenCalled()
  })

  it('partial なら読み直してから警告を出す(パターン 52)', async () => {
    vi.mocked(agentChangesApi.revertAllAgentChanges).mockResolvedValue({
      status: 'partial',
      message: '途中で失敗しました'
    })
    const options = makeOptions({}, listOf(entries))
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertAll()
    })
    expect(options.reloadOpenFiles).toHaveBeenCalledOnce()
    expect(result.current.error).toBe('途中で失敗しました')
    expect(options.changes.announce).not.toHaveBeenCalled()
  })

  it('失敗したら読み直さない', async () => {
    vi.mocked(agentChangesApi.revertAllAgentChanges).mockRejectedValue(new Error('中止しました'))
    const options = makeOptions({}, listOf(entries))
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertAll()
    })
    expect(options.reloadOpenFiles).not.toHaveBeenCalled()
    expect(result.current.error).toBe('中止しました')
  })

  it('打ち切った一覧では押せず、確認も出さない', async () => {
    const options = makeOptions({}, listOf(entries, true))
    const { result } = renderHook(() => useAgentChangesRevert(options))
    expect(result.current.revertAllDisabledReason).toBe(AGENT_CHANGES_TRUNCATED_REASON)
    await act(async () => {
      await result.current.revertAll()
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts 2>&1 | tail -n 5`
Expected: FAIL（`../useAgentChangesRevert` が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/hooks/useAgentChangesRevert.ts`（新規）:

```ts
import { useRef, useState } from 'react'
import type { AgentChangeEntry } from '@shared/types'
import * as agentChangesApi from '../lib/agentChangesApi'
import {
  agentRevertAllDisabledReason,
  agentRevertDisabledReason,
  buildAgentRevertAllConfirmMessage,
  buildAgentRevertFileConfirmMessage,
  buildAgentRevertHunkConfirmMessage,
  formatAgentChangesRevertedNotice
} from '../lib/agentChangesMessages'
import { toError } from '../lib/errorUtils'
import { isPathAtOrInside, joinPath } from '../lib/pathUtils'
import type { AgentChangesController } from './useAgentChanges'
import type { FileOperationLock } from './useFileOperationLock'

// エージェントの変更を戻す(ファイル・ハンク・すべて)。既存の取り消し(useDiscardFileChanges・useDiscardHunk・
// useDiscardAllChanges)と同じく「押せるか → 確認 → ロック → 実行 → 成功したときだけタブとツリーを同期」の順で行う
// (パターン 20・52)。作業ツリーを書き換えるため、他の Git 操作と同じロックの全体ロックを取る(パターン 111)

export interface AgentChangesRevertOptions {
  folderPath: string | null
  changes: Pick<
    AgentChangesController,
    'view' | 'isLoading' | 'listError' | 'savedPaths' | 'refresh' | 'announce'
  >
  /** 他の Git 操作と共有するロック(実行中は lockGlobal を取る。isAnyLocked なら押せない) */
  fileLock: FileOperationLock
  /** エージェントのセッションが動いているか(確認の文言に足す) */
  agentRunning: boolean
  hasDirtyTabAtOrInside: (absolutePath: string) => boolean
  reloadOpenFile: (absolutePath: string) => Promise<void>
  closeTabsAtOrInside: (absolutePath: string) => void
  confirmDiscardAnyDirty: () => boolean
  reloadOpenFiles: () => Promise<void>
  refreshTree: () => Promise<unknown>
  refreshGitStatus: () => Promise<void>
  /** 開いている diff タブを取り直す(useDiffOperations.refreshDiff) */
  refreshDiff: () => void
  onConfirm?: (message: string) => boolean
}

export interface AgentChangesRevertState {
  isReverting: boolean
  /** 直前の戻す操作の失敗・partial の警告 */
  error: string | null
  /** ファイル・ハンクを戻すボタンを押せない理由(押せるなら null) */
  revertDisabledReason: string | null
  /** 「すべて戻す」を押せない理由 */
  revertAllDisabledReason: string | null
  revertFile: (entry: AgentChangeEntry) => Promise<void>
  revertHunk: (path: string, patch: string, hunkHeader: string) => Promise<void>
  revertAll: () => Promise<void>
}

const withoutTrailingSlash = (path: string): string => path.replace(/\/+$/, '')

export function useAgentChangesRevert({
  folderPath,
  changes,
  fileLock,
  agentRunning,
  hasDirtyTabAtOrInside,
  reloadOpenFile,
  closeTabsAtOrInside,
  confirmDiscardAnyDirty,
  reloadOpenFiles,
  refreshTree,
  refreshGitStatus,
  refreshDiff,
  onConfirm = confirm
}: AgentChangesRevertOptions): AgentChangesRevertState {
  const [isReverting, setIsReverting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 同じ描画の中の 2 回目の依頼を止める(state は次の描画まで変わらない)
  const revertingRef = useRef(false)
  const list = changes.view.kind === 'recording' ? changes.view.list : null
  const availability = {
    isLoading: changes.isLoading,
    isGitBusy: fileLock.isAnyLocked(),
    isReverting,
    hasListError: changes.listError !== null
  }
  const revertDisabledReason = agentRevertDisabledReason(availability)
  const revertAllDisabledReason = agentRevertAllDisabledReason({
    ...availability,
    truncated: list?.truncated ?? false
  })

  const absoluteOf = (path: string): string | null =>
    folderPath === null ? null : joinPath(folderPath, withoutTrailingSlash(path))
  // 記録を始めた後にアプリで保存したファイルか(フォルダなら配下を含む)
  const isSavedInApp = (absolutePath: string): boolean =>
    [...changes.savedPaths].some((saved) => isPathAtOrInside(saved, absolutePath))

  // 実行(ロックと後片付け)。成功したら true。失敗の文言は error に出す
  const run = async (execute: () => Promise<void>): Promise<boolean> => {
    revertingRef.current = true
    setIsReverting(true)
    setError(null)
    fileLock.lockGlobal()
    try {
      await execute()
      return true
    } catch (err) {
      setError(toError(err).message)
      return false
    } finally {
      fileLock.unlockGlobal()
      revertingRef.current = false
      setIsReverting(false)
    }
  }

  // 成功・失敗のどちらでも一覧と git status を取り直す(状態が変わりうる)。タブの読み直しは呼び出し側が成功したときだけ行う
  const refreshAfter = async (): Promise<void> => {
    await refreshTree().catch(() => undefined)
    await refreshGitStatus().catch(() => undefined)
    await changes.refresh()
    refreshDiff()
  }

  const canStart = (): boolean => !revertingRef.current && revertDisabledReason === null

  const revertFile = async (entry: AgentChangeEntry): Promise<void> => {
    const absolutePath = absoluteOf(entry.path)
    if (absolutePath === null || !canStart() || entry.notRecorded) return
    const message = buildAgentRevertFileConfirmMessage({
      path: entry.path,
      status: entry.status,
      isDirectory: entry.isDirectory,
      savedInApp: isSavedInApp(absolutePath),
      hasUnsavedEdits: hasDirtyTabAtOrInside(absolutePath),
      agentRunning
    })
    if (!onConfirm(message)) return
    const succeeded = await run(() => agentChangesApi.revertAgentChange(entry.path))
    if (succeeded) {
      // 追加はゴミ箱へ移したのでタブを閉じ、それ以外は記録の時点の内容を読み直す
      if (entry.status === 'A') closeTabsAtOrInside(absolutePath)
      else await reloadOpenFile(absolutePath)
      changes.announce(formatAgentChangesRevertedNotice(1))
    }
    await refreshAfter()
  }

  const revertHunk = async (path: string, patch: string, hunkHeader: string): Promise<void> => {
    const absolutePath = absoluteOf(path)
    if (absolutePath === null || !canStart()) return
    const message = buildAgentRevertHunkConfirmMessage({
      path,
      hunkHeader,
      savedInApp: isSavedInApp(absolutePath),
      hasUnsavedEdits: hasDirtyTabAtOrInside(absolutePath),
      agentRunning
    })
    if (!onConfirm(message)) return
    const succeeded = await run(() => agentChangesApi.revertAgentChangeHunk(path, patch))
    if (succeeded) await reloadOpenFile(absolutePath)
    await refreshAfter()
  }

  const revertAll = async (): Promise<void> => {
    if (list === null || list.entries.length === 0) return
    if (revertingRef.current || revertAllDisabledReason !== null) return
    const absolutePaths = list.entries
      .map((entry) => absoluteOf(entry.path))
      .filter((path): path is string => path !== null)
    const message = buildAgentRevertAllConfirmMessage({
      count: list.entries.length,
      trashCount: list.entries.filter((entry) => entry.status === 'A').length,
      savedInApp: absolutePaths.some(isSavedInApp),
      agentRunning
    })
    if (!onConfirm(message)) return
    // 未保存の編集の破棄は、既存の「すべて取り消す」と同じく別の確認で承諾させる
    if (!confirmDiscardAnyDirty()) return
    // 確認で見せた一覧(パスと状態の文字)を main へ渡す。実行時の一覧と完全一致しなければ main が中止する
    const expected = list.entries.map(({ path, status }) => ({ path, status }))
    let warning: string | null = null
    const succeeded = await run(async () => {
      const result = await agentChangesApi.revertAllAgentChanges(expected)
      if (result.status === 'partial') warning = result.message
    })
    if (succeeded) {
      // partial も作業ツリーが変わっているので読み直す(パターン 52)。警告は読み直しの後に出す
      await reloadOpenFiles()
      if (warning !== null) setError(warning)
      else changes.announce(formatAgentChangesRevertedNotice(expected.length))
    }
    await refreshAfter()
  }

  return {
    isReverting,
    error,
    revertDisabledReason,
    revertAllDisabledReason,
    revertFile,
    revertHunk,
    revertAll
  }
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts 2>&1 | tail -n 5`
Expected: PASS（15 件）

- [ ] **Step 5: 変異で落ちることを確かめる**（手順は Task 4 の Step 5）

| #   | 置き換え前                                                                      | 置き換え後                               | 落ちるテスト                                                 |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| A1  | `    if (succeeded) await reloadOpenFile(absolutePath)`                         | `    await reloadOpenFile(absolutePath)` | `失敗したら読み直さずエラーを出す`                           |
| A2  | `    if (!confirmDiscardAnyDirty()) return`                                     | （空行）                                 | `未保存の編集の破棄を断ったら何もしない`                     |
| A3  | `      await reloadOpenFiles()⏎      if (warning`                               | `      if (warning`                      | `成功したら全タブを読み直して`・`partial なら読み直してから` |
| A4  | `    if (absolutePath === null \|\| !canStart() \|\| entry.notRecorded) return` | `    if (absolutePath === null) return`  | `一覧の取得中`・`記録しなかったファイル`                     |

- [ ] **Step 6: 確認コマンド**

```bash
npm run typecheck 2>&1 | tail -n 5
npx prettier --write src/renderer/src/hooks/useAgentChangesRevert.ts src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts
npx eslint src/renderer/src/hooks/useAgentChangesRevert.ts src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts
```

---

### Task 16: renderer: セクション「エージェントの変更」と 1 行（`AgentChangesSection`・`AgentChangesFileItem`）

**Files:**

- Create: `src/renderer/src/components/source-control/AgentChangesSection.tsx`、`src/renderer/src/components/source-control/AgentChangesFileItem.tsx`、`src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`
- Modify: `src/renderer/src/assets/main.css:1394`（`.changes-section__error` の前に `agent-changes__*` の規則）

**Interfaces:**

- Consumes: `AgentChangesController`・`AgentChangesView`（Task 12）、`AgentChangesRevertState`（Task 15）、Task 11 の文言と関数、既存の `toAnnouncementText`（`lib/announcementText.ts:8`）・`isPathAtOrInside`・`joinPath`
- Produces: `AgentChangesSection` の props `{ changes: Pick<AgentChangesController, 'view' | 'isLoading' | 'isBeginning' | 'listError' | 'notice' | 'savedPaths' | 'begin' | 'refresh' | 'clear' | 'isFocusRequested' | 'consumeFocusRequest'>; revert: AgentChangesRevertState; folderPath: string | null; isNotRepository: boolean; isAgentMode: boolean; onOpenDiff: (path: string) => void }`（`onOpenDiff` には末尾の `/` を落としたパスを渡す）、`AgentChangesFileItem` の props `{ entry; savedInApp; disabledReason; disabledReasonId; onOpenDiff; onRevert }`
- 注: 状態ごとの表示は設計書「A の詳細」の表のとおり。`<section aria-labelledby>`、見出しのボタンで折りたたむ（`aria-expanded`・`aria-controls`。保存しない）。通知の `aria-live="polite"` の要素は折りたたみの外に常設する。行のボタンは常に表示し 32px（既存の `ChangesFileItem` の取り消しは 18px で hover のときだけ出る。タッチで押せるよう変える。差異 10）。押せない理由はセクションの 1 か所（`aria-describedby`）。「いまから記録する」「もう一度試す」は依頼中に文言を `記録しています…` に変える（押せない理由を文言で示す）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`（新規。ARIA・無効の理由の参照・フォーカス〈`userEvent.click` と effect の後のフォーカス〉）:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { AgentChangeEntry } from '@shared/types'
import AgentChangesSection from '../AgentChangesSection'
import type { AgentChangesView } from '../../../hooks/useAgentChanges'
import type { AgentChangesRevertState } from '../../../hooks/useAgentChangesRevert'
import {
  AGENT_CHANGES_BUSY_GIT,
  AGENT_CHANGES_EMPTY,
  AGENT_CHANGES_HEAD_CHANGED,
  AGENT_CHANGES_NONE_HINT,
  AGENT_CHANGES_TRUNCATED_REASON
} from '../../../lib/agentChangesMessages'

type Props = ComponentProps<typeof AgentChangesSection>

const startedAt = new Date(2026, 9, 7, 10, 42).getTime()
const entry = (
  path: string,
  status: AgentChangeEntry['status'],
  extra: Partial<AgentChangeEntry> = {}
): AgentChangeEntry => ({
  path,
  status,
  isDirectory: false,
  notRecorded: false,
  ...extra
})
const recordingView = (
  entries: AgentChangeEntry[],
  extra: { truncated?: boolean; totalCount?: number; headChanged?: boolean } = {}
): AgentChangesView => ({
  kind: 'recording',
  startedAt,
  list: {
    entries,
    totalCount: extra.totalCount ?? entries.length,
    truncated: extra.truncated ?? false,
    headChanged: extra.headChanged ?? false
  }
})

const makeRevert = (overrides: Partial<AgentChangesRevertState> = {}): AgentChangesRevertState => ({
  isReverting: false,
  error: null,
  revertDisabledReason: null,
  revertAllDisabledReason: null,
  revertFile: vi.fn(async () => undefined),
  revertHunk: vi.fn(async () => undefined),
  revertAll: vi.fn(async () => undefined),
  ...overrides
})

function renderSection(
  view: AgentChangesView,
  overrides: Partial<Props> = {},
  changes: Partial<Props['changes']> = {}
): Props {
  const props: Props = {
    changes: {
      view,
      isLoading: false,
      isBeginning: false,
      listError: null,
      notice: null,
      savedPaths: new Set(),
      begin: vi.fn(async () => undefined),
      refresh: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      isFocusRequested: false,
      consumeFocusRequest: vi.fn(),
      ...changes
    },
    revert: makeRevert(),
    folderPath: '/repo',
    isNotRepository: false,
    isAgentMode: true,
    onOpenDiff: vi.fn(),
    ...overrides
  }
  render(<AgentChangesSection {...props} />)
  return props
}

const section = (): HTMLElement => screen.getByRole('region', { name: /^エージェントの変更/ })

describe('AgentChangesSection', () => {
  it('従来の方式で記録が無ければ出さない', () => {
    renderSection({ kind: 'none' }, { isAgentMode: false })
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('従来の方式でも記録があれば出す', () => {
    renderSection(recordingView([]), { isAgentMode: false })
    expect(section()).toBeInTheDocument()
  })

  it('記録なしは案内と「いまから記録する」を出し、押すと記録を始める', async () => {
    const props = renderSection({ kind: 'none' })
    expect(within(section()).getByText(AGENT_CHANGES_NONE_HINT)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'いまから記録する' }))
    expect(props.changes.begin).toHaveBeenCalledOnce()
  })

  it('Git 管理外のフォルダは理由を出し、記録のボタンを出さない', () => {
    renderSection({ kind: 'none' }, { isNotRepository: true })
    expect(
      screen.getByText('Git 管理外のフォルダでは、エージェントの変更を記録できません')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'いまから記録する' })).toBeNull()
  })

  it.each([
    ['timeout', '記録に時間がかかりすぎたため、中止しました', true],
    [
      'not-toplevel',
      'リポジトリの最上位のフォルダを開いたときだけ、エージェントの変更を記録できます',
      false
    ]
  ] as const)(
    '記録できない(%s)は理由を出し、記録の失敗のときだけ「もう一度試す」を出す',
    (reason, text, retry) => {
      renderSection({ kind: 'unavailable', state: { kind: 'unavailable', reason } })
      expect(screen.getByText(text)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'もう一度試す' }) !== null).toBe(retry)
    }
  )

  it('記録中は見出しに件数と開始の時刻を出し、行のパスで diff を開き、↶ で戻す', async () => {
    const props = renderSection(
      recordingView([entry('a.txt', 'M'), entry('newdir/', 'A', { isDirectory: true })])
    )
    expect(
      screen.getByRole('button', { name: /エージェントの変更 \(2\)（10:42 から）/ })
    ).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(
      screen.getByRole('button', { name: 'newdir/ のエージェントの変更を表示' })
    )
    expect(props.onOpenDiff).toHaveBeenCalledWith('newdir')
    await userEvent.click(screen.getByRole('button', { name: 'a.txt を実行前の状態に戻す' }))
    expect(props.revert.revertFile).toHaveBeenCalledWith(entry('a.txt', 'M'))
    expect(screen.getByRole('button', { name: 'newdir/ をゴミ箱へ移動' })).toBeEnabled()
  })

  it('アプリで保存したファイルに印を付け、記録しなかったファイルは戻すボタンの代わりに理由を出す', () => {
    renderSection(
      recordingView([entry('a.txt', 'M'), entry('big.bin', 'M', { notRecorded: true })]),
      {},
      { savedPaths: new Set(['/repo/a.txt']) }
    )
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('あなたの保存を含む')).toBeInTheDocument()
    expect(within(rows[1]).getByText('記録していないため戻せません')).toBeInTheDocument()
    expect(within(rows[1]).queryByRole('button', { name: /戻す/ })).toBeNull()
  })

  it('押せないときは理由を 1 か所に出し、戻すボタン・すべて戻すから参照する(パターン 126)', () => {
    renderSection(recordingView([entry('a.txt', 'M')]), {
      revert: makeRevert({
        revertDisabledReason: AGENT_CHANGES_BUSY_GIT,
        revertAllDisabledReason: AGENT_CHANGES_BUSY_GIT
      })
    })
    expect(screen.getAllByText(AGENT_CHANGES_BUSY_GIT)).toHaveLength(1)
    for (const name of ['a.txt を実行前の状態に戻す', 'すべて戻す']) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription(AGENT_CHANGES_BUSY_GIT)
    }
  })

  it('打ち切ったら「ほか N 件」を出し、すべて戻すだけを理由つきで押せなくする', () => {
    renderSection(recordingView([entry('a.txt', 'M')], { truncated: true, totalCount: 501 }), {
      revert: makeRevert({ revertAllDisabledReason: AGENT_CHANGES_TRUNCATED_REASON })
    })
    expect(screen.getByText('ほか 500 件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'すべて戻す' })).toHaveAccessibleDescription(
      AGENT_CHANGES_TRUNCATED_REASON
    )
    expect(screen.getByRole('button', { name: 'a.txt を実行前の状態に戻す' })).toBeEnabled()
  })

  it('変更が無ければその旨を出し、すべて戻すを出さない。HEAD が変わった帯・一覧の失敗を出す', () => {
    renderSection(recordingView([], { headChanged: true }), {}, { listError: 'git failed' })
    expect(screen.getByText(AGENT_CHANGES_EMPTY)).toBeInTheDocument()
    expect(screen.getByText(AGENT_CHANGES_HEAD_CHANGED)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('git failed')
    expect(screen.queryByRole('button', { name: 'すべて戻す' })).toBeNull()
  })

  it('更新は件数を読み上げる取り直し、確認を終えるは記録を捨てる', async () => {
    const props = renderSection(recordingView([entry('a.txt', 'M')]))
    await userEvent.click(screen.getByRole('button', { name: '更新' }))
    expect(props.changes.refresh).toHaveBeenCalledWith({ announce: true })
    await userEvent.click(screen.getByRole('button', { name: '確認を終える' }))
    expect(props.changes.clear).toHaveBeenCalledOnce()
  })

  it('取得中は見出しに「更新中…」を出す', () => {
    renderSection(recordingView([entry('a.txt', 'M')]), {}, { isLoading: true })
    expect(screen.getByText('更新中…')).toBeInTheDocument()
  })

  it('通知は常設の aria-live の要素に入れる(折りたたんでも残る)', async () => {
    renderSection(recordingView([]), {}, { notice: { text: 'エージェントの変更: 0 件', id: 1 } })
    const live = section().querySelector('[aria-live="polite"]')
    expect(live).toHaveTextContent('エージェントの変更: 0 件')
    await userEvent.click(screen.getByRole('button', { name: /エージェントの変更（10:42 から）/ }))
    expect(
      screen.getByRole('button', { name: /エージェントの変更（10:42 から）/ })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(section().querySelector('[aria-live="polite"]')).toHaveTextContent(
      'エージェントの変更: 0 件'
    )
  })

  it('フォーカスの依頼があれば見出しへフォーカスを移し(折りたたみを開く)、依頼を下ろす(パターン 86・152)', async () => {
    const props = renderSection(recordingView([]), {}, { isFocusRequested: true })
    const heading = screen.getByRole('button', { name: /エージェントの変更（10:42 から）/ })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(props.changes.consumeFocusRequest).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx 2>&1 | tail -n 5`
Expected: FAIL（`../AgentChangesSection` が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/components/source-control/AgentChangesFileItem.tsx`（新規）:

```tsx
'use client'
import type { AgentChangeEntry } from '@shared/types'
import {
  AGENT_CHANGES_NOT_RECORDED_MARK,
  AGENT_CHANGES_SAVED_MARK
} from '../../lib/agentChangesMessages'

interface Props {
  entry: AgentChangeEntry
  /** 記録を始めた後にアプリで保存したファイル(フォルダなら配下を含む)か */
  savedInApp: boolean
  /** 戻すボタンを押せない理由(押せるなら null)。表示はセクションの 1 か所 */
  disabledReason: string | null
  /** 理由の要素の id(aria-describedby で参照する。パターン 126) */
  disabledReasonId: string
  onOpenDiff: (path: string) => void
  onRevert: (entry: AgentChangeEntry) => void
}

// 「エージェントの変更」の 1 行(状態の文字・diff を開くパス・印・戻すボタン)。押せる条件の判定は useAgentChangesRevert
export default function AgentChangesFileItem({
  entry,
  savedInApp,
  disabledReason,
  disabledReasonId,
  onOpenDiff,
  onRevert
}: Props): React.JSX.Element {
  const revertLabel =
    entry.status === 'A' ? `${entry.path} をゴミ箱へ移動` : `${entry.path} を実行前の状態に戻す`
  return (
    <li className="agent-changes__item">
      <span className="source-control-panel__file-status source-control-panel__file-status--changed">
        {entry.status}
      </span>
      <button
        type="button"
        className="source-control-panel__file-path agent-changes__path"
        onClick={() => onOpenDiff(entry.path.replace(/\/+$/, ''))}
        aria-label={`${entry.path} のエージェントの変更を表示`}
      >
        {entry.path}
      </button>
      {savedInApp && <span className="agent-changes__mark">{AGENT_CHANGES_SAVED_MARK}</span>}
      {entry.notRecorded ? (
        <span className="agent-changes__mark">{AGENT_CHANGES_NOT_RECORDED_MARK}</span>
      ) : (
        <button
          type="button"
          className="agent-changes__revert"
          aria-label={revertLabel}
          title={revertLabel}
          disabled={disabledReason !== null}
          aria-describedby={disabledReason !== null ? disabledReasonId : undefined}
          onClick={() => onRevert(entry)}
        >
          ↶
        </button>
      )}
    </li>
  )
}
```

`src/renderer/src/components/source-control/AgentChangesSection.tsx`（新規）:

```tsx
'use client'
import { useEffect, useId, useRef, useState } from 'react'
import type { AgentChangesController } from '../../hooks/useAgentChanges'
import type { AgentChangesRevertState } from '../../hooks/useAgentChangesRevert'
import {
  AGENT_CHANGES_EMPTY,
  AGENT_CHANGES_HEAD_CHANGED,
  AGENT_CHANGES_LOADING,
  AGENT_CHANGES_NONE_HINT,
  AGENT_CHANGES_UNAVAILABLE_MESSAGES,
  buildAgentChangesHeading,
  canRetryAgentChanges,
  describeAgentChangesUnavailable,
  formatAgentChangesMore
} from '../../lib/agentChangesMessages'
import { toAnnouncementText } from '../../lib/announcementText'
import { isPathAtOrInside, joinPath } from '../../lib/pathUtils'
import AgentChangesFileItem from './AgentChangesFileItem'

interface Props {
  changes: Pick<
    AgentChangesController,
    | 'view'
    | 'isLoading'
    | 'isBeginning'
    | 'listError'
    | 'notice'
    | 'savedPaths'
    | 'begin'
    | 'refresh'
    | 'clear'
    | 'isFocusRequested'
    | 'consumeFocusRequest'
  >
  revert: AgentChangesRevertState
  /** 開いているフォルダ(保存したパスとの突き合わせに使う) */
  folderPath: string | null
  /** Git 管理外のフォルダか(記録を始める前から理由を出す) */
  isNotRepository: boolean
  /** エージェント CLI 方式か。従来の方式では記録がある間だけ出す */
  isAgentMode: boolean
  onOpenDiff: (path: string) => void
}

// ソース管理パネルのセクション「エージェントの変更」(設計書「A の詳細」)。見出しのボタンで折りたためる(状態は保存しない)。
// 結果の通知は常設の aria-live の要素に入れる(パターン 87・151)。「変更を確認」の依頼があれば、マウントの後に見出しへ
// フォーカスを移す(パターン 86・152)
export default function AgentChangesSection({
  changes,
  revert,
  folderPath,
  isNotRepository,
  isAgentMode,
  onOpenDiff
}: Props): React.JSX.Element | null {
  const headingId = useId()
  const bodyId = useId()
  const reasonId = useId()
  const [isOpen, setIsOpen] = useState(true)
  const headingRef = useRef<HTMLButtonElement>(null)
  const { view, isFocusRequested, consumeFocusRequest } = changes
  const isVisible = isAgentMode || view.kind === 'recording'

  useEffect(() => {
    if (!isVisible || !isFocusRequested) return
    // 折りたたんでいたら開いてから移す(useDiffOperations の clearHunkError と同じく、effect の中の更新は関数に包む)
    const openSection = (): void => setIsOpen(true)
    openSection()
    headingRef.current?.focus()
    consumeFocusRequest()
  }, [isVisible, isFocusRequested, consumeFocusRequest])

  if (!isVisible) return null

  const recording = view.kind === 'recording' ? view : null
  const list = recording?.list ?? null
  const heading = buildAgentChangesHeading(
    recording === null
      ? null
      : { startedAt: recording.startedAt, totalCount: list?.totalCount ?? null }
  )
  const isSavedInApp = (path: string): boolean => {
    if (folderPath === null) return false
    const absolutePath = joinPath(folderPath, path.replace(/\/+$/, ''))
    return [...changes.savedPaths].some((saved) => isPathAtOrInside(saved, absolutePath))
  }
  const hasEntries = list !== null && list.entries.length > 0
  // 押せない理由は 1 か所に出す。「すべて戻す」の理由は「ファイル単位の理由」か「打ち切り」
  const shownReason = hasEntries ? revert.revertAllDisabledReason : null

  return (
    <section className="source-control-panel__section agent-changes" aria-labelledby={headingId}>
      <p className="agent-changes__live" aria-live="polite" aria-atomic="true">
        {toAnnouncementText(changes.notice)}
      </p>
      <div className="agent-changes__header">
        <h3 className="source-control-panel__section-title agent-changes__title">
          <button
            ref={headingRef}
            id={headingId}
            type="button"
            className="agent-changes__toggle"
            aria-expanded={isOpen}
            aria-controls={bodyId}
            onClick={() => setIsOpen((open) => !open)}
          >
            <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span> {heading}
          </button>
        </h3>
        {recording !== null && changes.isLoading && (
          <span className="agent-changes__loading">{AGENT_CHANGES_LOADING}</span>
        )}
      </div>
      <div id={bodyId} className="agent-changes__body" hidden={!isOpen}>
        {view.kind === 'none' &&
          (isNotRepository ? (
            <p className="agent-changes__note">
              {AGENT_CHANGES_UNAVAILABLE_MESSAGES['not-repository']}
            </p>
          ) : (
            <>
              <p className="agent-changes__note">{AGENT_CHANGES_NONE_HINT}</p>
              <div className="agent-changes__actions">
                <button
                  type="button"
                  className="agent-changes__button"
                  disabled={changes.isBeginning}
                  onClick={() => void changes.begin()}
                >
                  {changes.isBeginning ? '記録しています…' : 'いまから記録する'}
                </button>
              </div>
            </>
          ))}
        {view.kind === 'unavailable' && (
          <>
            <p className="agent-changes__note">{describeAgentChangesUnavailable(view.state)}</p>
            {canRetryAgentChanges(view.state.reason) && (
              <div className="agent-changes__actions">
                <button
                  type="button"
                  className="agent-changes__button"
                  disabled={changes.isBeginning}
                  onClick={() => void changes.begin()}
                >
                  {changes.isBeginning ? '記録しています…' : 'もう一度試す'}
                </button>
              </div>
            )}
          </>
        )}
        {recording !== null && (
          <>
            {changes.listError !== null && (
              <p className="agent-changes__error" role="alert">
                {changes.listError}
              </p>
            )}
            {revert.error !== null && (
              <p className="agent-changes__error" role="alert">
                {revert.error}
              </p>
            )}
            {list?.headChanged === true && (
              <p className="agent-changes__note">{AGENT_CHANGES_HEAD_CHANGED}</p>
            )}
            {shownReason !== null && (
              <p id={reasonId} className="agent-changes__note">
                {shownReason}
              </p>
            )}
            {list !== null && list.entries.length === 0 && (
              <p className="agent-changes__note">{AGENT_CHANGES_EMPTY}</p>
            )}
            {hasEntries && (
              <ul className="source-control-panel__file-list">
                {list.entries.map((entry) => (
                  <AgentChangesFileItem
                    key={entry.path}
                    entry={entry}
                    savedInApp={isSavedInApp(entry.path)}
                    disabledReason={revert.revertDisabledReason}
                    disabledReasonId={reasonId}
                    onOpenDiff={onOpenDiff}
                    onRevert={(target) => void revert.revertFile(target)}
                  />
                ))}
              </ul>
            )}
            {list !== null && list.totalCount > list.entries.length && (
              <p className="agent-changes__note">
                {formatAgentChangesMore(list.totalCount - list.entries.length)}
              </p>
            )}
            <div className="agent-changes__actions">
              <button
                type="button"
                className="agent-changes__button"
                onClick={() => void changes.refresh({ announce: true })}
              >
                更新
              </button>
              {hasEntries && (
                <button
                  type="button"
                  className="agent-changes__button agent-changes__button--danger"
                  disabled={revert.revertAllDisabledReason !== null}
                  aria-describedby={revert.revertAllDisabledReason !== null ? reasonId : undefined}
                  onClick={() => void revert.revertAll()}
                >
                  すべて戻す
                </button>
              )}
              <button
                type="button"
                className="agent-changes__button"
                disabled={revert.isReverting}
                aria-describedby={revert.isReverting && shownReason !== null ? reasonId : undefined}
                onClick={() => void changes.clear()}
              >
                確認を終える
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
```

`src/renderer/src/assets/main.css` の変更（狭い幅でも見出しは 1 行で省略し、ボタンは折り返さない〈`flex: none; white-space: nowrap`〉。ボタンの並びは折り返す。パターン 124）:

```diff
--- a/src/renderer/src/assets/main.css
+++ b/src/renderer/src/assets/main.css
@@ -1391,6 +1391,150 @@ body {
   cursor: default;
 }

+/* エージェントの変更(AgentChangesSection)。ボタンはタッチで押せるよう常に表示し、32px 以上にする */
+.agent-changes__header {
+  display: flex;
+  align-items: center;
+  gap: 8px;
+  padding-right: 12px;
+  min-width: 0;
+}
+
+.agent-changes__title {
+  flex: 1;
+  min-width: 0;
+  padding: 0;
+}
+
+.agent-changes__toggle {
+  display: block;
+  width: 100%;
+  min-height: 32px;
+  padding: 6px 12px 2px;
+  border: none;
+  background: none;
+  color: inherit;
+  font: inherit;
+  letter-spacing: inherit;
+  text-align: left;
+  text-transform: inherit;
+  white-space: nowrap;
+  overflow: hidden;
+  text-overflow: ellipsis;
+  cursor: pointer;
+}
+
+.agent-changes__loading {
+  flex: none;
+  color: #969696;
+  font-size: 11px;
+  white-space: nowrap;
+}
+
+.agent-changes__note {
+  margin: 0;
+  padding: 4px 12px;
+  color: #cccccc;
+  font-size: 12px;
+  overflow-wrap: anywhere;
+}
+
+.agent-changes__error {
+  margin: 0;
+  padding: 4px 12px;
+  color: #f48771;
+  font-size: 12px;
+  overflow-wrap: anywhere;
+}
+
+.agent-changes__actions {
+  display: flex;
+  flex-wrap: wrap;
+  gap: 6px;
+  padding: 4px 12px 6px;
+}
+
+.agent-changes__button {
+  flex: none;
+  min-width: 32px;
+  min-height: 32px;
+  padding: 0 8px;
+  background: none;
+  border: 1px solid #555555;
+  border-radius: 3px;
+  color: #cccccc;
+  font-size: 12px;
+  white-space: nowrap;
+  cursor: pointer;
+}
+
+.agent-changes__button:hover:not(:disabled) {
+  background: #2a2d2e;
+  color: #ffffff;
+}
+
+.agent-changes__button--danger:hover:not(:disabled) {
+  background: #5a1d1d;
+}
+
+.agent-changes__button:disabled,
+.agent-changes__revert:disabled {
+  opacity: 0.5;
+  cursor: default;
+}
+
+.agent-changes__item {
+  display: flex;
+  align-items: center;
+  gap: 6px;
+  min-height: 32px;
+  padding: 0 12px;
+  font-size: 13px;
+  color: #cccccc;
+}
+
+.agent-changes__path {
+  flex: 1;
+  min-width: 0;
+}
+
+.agent-changes__mark {
+  flex: none;
+  color: #969696;
+  font-size: 11px;
+  white-space: nowrap;
+}
+
+.agent-changes__revert {
+  flex: none;
+  width: 32px;
+  height: 32px;
+  padding: 0;
+  border: none;
+  border-radius: 3px;
+  background: transparent;
+  color: #cccccc;
+  font-size: 14px;
+  cursor: pointer;
+}
+
+.agent-changes__revert:hover:not(:disabled) {
+  background: #454545;
+}
+
+/* 読み上げだけの通知(見た目には出さない) */
+.agent-changes__live {
+  position: absolute;
+  width: 1px;
+  height: 1px;
+  margin: -1px;
+  padding: 0;
+  overflow: hidden;
+  clip: rect(0 0 0 0);
+  white-space: nowrap;
+  border: 0;
+}
+
 .changes-section__error {
   margin: 0;
   padding: 4px 12px;
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx 2>&1 | tail -n 5`
Expected: PASS（15 件）

- [ ] **Step 5: 変異で落ちることを確かめる**（手順は Task 4 の Step 5）

| #   | ファイル                   | 置き換え前                                                                            | 置き換え後                        | 落ちるテスト                                       |
| --- | -------------------------- | ------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------- |
| A1  | `AgentChangesSection.tsx`  | `    headingRef.current?.focus()`                                                     | （空行）                          | `フォーカスの依頼があれば見出しへフォーカスを移し` |
| A2  | `AgentChangesFileItem.tsx` | `          aria-describedby={disabledReason !== null ? disabledReasonId : undefined}` | （空行）                          | `押せないときは理由を 1 か所に出し`                |
| A3  | `AgentChangesSection.tsx`  | `  const isVisible = isAgentMode \|\| view.kind === 'recording'`                      | `  const isVisible = isAgentMode` | `従来の方式でも記録があれば出す`                   |

- [ ] **Step 6: 確認コマンド**

```bash
npm run typecheck 2>&1 | tail -n 5
npx prettier --write src/renderer/src/components/source-control/AgentChangesSection.tsx src/renderer/src/components/source-control/AgentChangesFileItem.tsx src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx src/renderer/src/assets/main.css
npx eslint src/renderer/src/components/source-control/AgentChangesSection.tsx src/renderer/src/components/source-control/AgentChangesFileItem.tsx src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx
```

---

### Task 17: renderer: ターミナルの帯の `変更を確認` とパネルの切り替え

**Files:**

- Modify: `src/renderer/src/hooks/usePanelState.ts:7・23`（`showPanel`）、`src/renderer/src/components/agent/AgentTerminalPanel.tsx:8-14・95`（`review` の props と、`最大化` の前のボタン）、`src/renderer/src/components/EditorPanel.tsx:17・81・122・247`（`agentChangesReview` を渡す）
- Test: `hooks/__tests__/usePanelState.test.ts`、`components/agent/__tests__/AgentTerminalPanel.test.tsx`・`AgentTerminalPanel.styles.test.tsx`、`components/__tests__/EditorPanel.agentTerminal.test.tsx`

**Interfaces:**

- Consumes: なし（Task 18 で `useAgentChanges` と組み立てる）
- Produces: `usePanelState().showPanel(panel: Panel): void`（切り替えて開く。同じパネルでも閉じない）、`interface AgentChangesReviewAction { isRecording: boolean; onReview: () => void }`（`AgentTerminalPanel.tsx` から export）、`AgentTerminalPanel` の `review?: AgentChangesReviewAction`、`EditorPanel` の `agentChangesReview?: AgentChangesReviewAction`
- 注: ボタンは記録がある間だけ出す（`aria-label="エージェントの変更を確認（ソース管理を開く）"`）。既存の `agent-terminal-panel__button`（`flex: none`・32px）を使い、帯の高さと折り返しの規則は変えない（パターン 124・154。帯の 1 行の確認は実機。手動テスト仕様）。最大化の間に押したら、ターミナルの中のフォーカスを外して最大化を戻してから `onReview`

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/usePanelState.test.ts`:

```diff
--- a/src/renderer/src/hooks/__tests__/usePanelState.test.ts
+++ b/src/renderer/src/hooks/__tests__/usePanelState.test.ts
@@ -33,8 +33,28 @@ describe('usePanelState', () => {
   it('サイドバーが閉じた状態で別パネルを選択すると sidebarOpen が true になる', () => {
     const { result } = renderHook(() => usePanelState())
     act(() => result.current.handlePanelChange('explorer')) // close
-    act(() => result.current.handlePanelChange('prompts'))  // switch → open
+    act(() => result.current.handlePanelChange('prompts')) // switch → open
     expect(result.current.activePanel).toBe('prompts')
     expect(result.current.sidebarOpen).toBe(true)
   })
 })
+
+describe('usePanelState.showPanel', () => {
+  it('別のパネルに切り替えて開く', () => {
+    const { result } = renderHook(() => usePanelState())
+    act(() => result.current.showPanel('source-control'))
+    expect(result.current.activePanel).toBe('source-control')
+    expect(result.current.sidebarOpen).toBe(true)
+  })
+
+  it('同じパネルでも閉じず、閉じていれば開く', () => {
+    const { result } = renderHook(() => usePanelState())
+    act(() => result.current.showPanel('source-control'))
+    act(() => result.current.showPanel('source-control'))
+    expect(result.current.sidebarOpen).toBe(true)
+    act(() => result.current.handlePanelChange('source-control'))
+    expect(result.current.sidebarOpen).toBe(false)
+    act(() => result.current.showPanel('source-control'))
+    expect(result.current.sidebarOpen).toBe(true)
+  })
+})
```

`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`:

```diff
--- a/src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx
+++ b/src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx
@@ -2,6 +2,7 @@ import { render, screen } from '@testing-library/react'
 import userEvent from '@testing-library/user-event'
 import { describe, it, expect, vi, beforeEach } from 'vitest'
 import AgentTerminalPanel from '../AgentTerminalPanel'
+import type { AgentChangesReviewAction } from '../AgentTerminalPanel'
 import type { AgentTerminalPanelState } from '../../../hooks/useAgentWorkspace'
 import { makeFakeController } from '../../../__tests__/makeFakeAgentTerminal'
 import type { FakeController } from '../../../__tests__/makeFakeAgentTerminal'
@@ -21,14 +22,17 @@ function makeLayout(overrides: Partial<AgentTerminalPanelLayout> = {}): AgentTer
   }
 }

-function renderPanel(overrides: Partial<AgentTerminalPanelState> = {}): AgentTerminalPanelState {
+function renderPanel(
+  overrides: Partial<AgentTerminalPanelState> = {},
+  review?: AgentChangesReviewAction
+): AgentTerminalPanelState {
   const state: AgentTerminalPanelState = {
     controller,
     session: makeAgentSessionState(),
     layout: makeLayout(),
     ...overrides
   }
-  render(<AgentTerminalPanel state={state} />)
+  render(<AgentTerminalPanel state={state} review={review} />)
   return state
 }

@@ -137,3 +141,38 @@ describe('AgentTerminalPanel', () => {
     expect(screen.getByRole('button', { name: /エージェント/ })).toHaveFocus()
   })
 })
+
+describe('AgentTerminalPanel — 変更を確認', () => {
+  const REVIEW = 'エージェントの変更を確認（ソース管理を開く）'
+
+  it.each([
+    ['渡されない', undefined],
+    ['記録が無い', { isRecording: false, onReview: vi.fn() }]
+  ])('%s ときは出さない', (_label, review) => {
+    renderPanel({}, review)
+    expect(screen.queryByRole('button', { name: REVIEW })).toBeNull()
+  })
+
+  it('記録がある間だけ最大化の前に出し、押すと確認へ移る', async () => {
+    const onReview = vi.fn()
+    renderPanel({}, { isRecording: true, onReview })
+    const button = screen.getByRole('button', { name: REVIEW })
+    expect(button).toHaveTextContent('変更を確認')
+    expect(button.compareDocumentPosition(screen.getByRole('button', { name: '最大化' }))).toBe(
+      Node.DOCUMENT_POSITION_FOLLOWING
+    )
+    await userEvent.click(button)
+    expect(onReview).toHaveBeenCalledOnce()
+  })
+
+  it('最大化の間に押したら、最大化を元に戻してから移る', async () => {
+    const order: string[] = []
+    const layout = makeLayout({
+      isMaximized: true,
+      toggleMaximized: vi.fn(() => void order.push('restore'))
+    })
+    renderPanel({ layout }, { isRecording: true, onReview: () => void order.push('review') })
+    await userEvent.click(screen.getByRole('button', { name: REVIEW }))
+    expect(order).toEqual(['restore', 'review'])
+  })
+})
```

`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx`（狭い幅の規則。新しいボタンも縮まず折り返さない）:

```diff
--- a/src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx
+++ b/src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx
@@ -39,7 +39,10 @@ function renderNoFolder(): HTMLElement {
       toggleMaximized: vi.fn()
     }
   }
-  const { container } = render(<AgentTerminalPanel state={state} />)
+  // 帯に最も多くの部品が並ぶよう、記録がある間の「変更を確認」も出す
+  const { container } = render(
+    <AgentTerminalPanel state={state} review={{ isRecording: true, onReview: vi.fn() }} />
+  )
   return container
 }

@@ -81,11 +84,12 @@ describe('ターミナルパネルの見出しの帯のスタイル(main.css)',
     expect(actionsShrink).toBeGreaterThan(statusShrink)
   })

-  it('開閉・起動・最大化のボタンは縮まず、折り返さない', () => {
+  it('開閉・起動・変更を確認・最大化のボタンは縮まず、折り返さない', () => {
     renderNoFolder()
     const buttons = [
-      screen.getByRole('button', { name: /エージェント/ }),
+      screen.getByRole('button', { name: /^▾ エージェント$|^エージェント$/ }),
       screen.getByRole('button', { name: /^起動/ }),
+      screen.getByRole('button', { name: 'エージェントの変更を確認（ソース管理を開く）' }),
       screen.getByRole('button', { name: '最大化' })
     ]
     for (const button of buttons) {
```

`src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx`（配線。パターン 155）:

```diff
--- a/src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx
+++ b/src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx
@@ -89,6 +89,21 @@ describe('EditorPanel: 下部のパネル', () => {
     expect(screen.queryByText('result text')).toBeNull()
   })

+  // agentChangesReview は省略可能な props のため、渡し忘れを型で検知できない(パターン 155)
+  it('ターミナルパネルに「変更を確認」を渡す', () => {
+    const onReview = vi.fn()
+    render(
+      <EditorPanel
+        {...baseProps}
+        bottomPanel="agent-terminal"
+        agentTerminal={makeAgentTerminal()}
+        agentChangesReview={{ isRecording: true, onReview }}
+      />
+    )
+    screen.getByRole('button', { name: 'エージェントの変更を確認（ソース管理を開く）' }).click()
+    expect(onReview).toHaveBeenCalledOnce()
+  })
+
   it('none では下部に何も出さない(実行方式の読み込み中)', () => {
     render(<EditorPanel {...baseProps} bottomPanel="none" agentTerminal={makeAgentTerminal()} />)
     expect(screen.queryByRole('region', { name: 'エージェント' })).toBeNull()
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/usePanelState.test.ts src/renderer/src/components/agent src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx 2>&1 | tail -n 5`
Expected: FAIL（`showPanel is not a function`・ボタンが無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/hooks/usePanelState.ts`:

```diff
--- a/src/renderer/src/hooks/usePanelState.ts
+++ b/src/renderer/src/hooks/usePanelState.ts
@@ -5,6 +5,8 @@ interface PanelState {
   activePanel: Panel
   sidebarOpen: boolean
   handlePanelChange: (panel: Panel) => void
+  /** パネルを切り替えて開く(同じパネルでも閉じない。ターミナルの帯の「変更を確認」から使う) */
+  showPanel: (panel: Panel) => void
 }

 export function usePanelState(): PanelState {
@@ -20,5 +22,10 @@ export function usePanelState(): PanelState {
     }
   }

-  return { activePanel, sidebarOpen, handlePanelChange }
+  const showPanel = (panel: Panel): void => {
+    setActivePanel(panel)
+    setSidebarOpen(true)
+  }
+
+  return { activePanel, sidebarOpen, handlePanelChange, showPanel }
 }
```

`src/renderer/src/components/agent/AgentTerminalPanel.tsx`:

```diff
--- a/src/renderer/src/components/agent/AgentTerminalPanel.tsx
+++ b/src/renderer/src/components/agent/AgentTerminalPanel.tsx
@@ -5,13 +5,21 @@ import { describeAgentStatus } from '../../lib/agentSessionMessages'
 import type { AgentTerminalPanelState } from '../../hooks/useAgentWorkspace'
 import AgentTerminalView from './AgentTerminalView'

+/** 見出しの帯の「変更を確認」(エージェントの変更の記録がある間だけ出す) */
+export interface AgentChangesReviewAction {
+  isRecording: boolean
+  /** ソース管理パネルを開き、一覧を取り直し、セクションへフォーカスを移す */
+  onReview: () => void
+}
+
 interface Props {
   state: AgentTerminalPanelState
+  review?: AgentChangesReviewAction
 }

 // エディタの領域の下部のターミナルパネル(設計書「配置の案」A)。見出しの帯(開閉・状態・起動/終了・最大化)と xterm の表示の領域。
 // 閉じても xterm とセッションは破棄せず、表示だけを隠す(出力は裏で受け取り続ける)
-export default function AgentTerminalPanel({ state }: Props): React.JSX.Element {
+export default function AgentTerminalPanel({ state, review }: Props): React.JSX.Element {
   const { controller, session, layout } = state
   const bodyId = useId()
   const hintId = useId()
@@ -92,6 +100,23 @@ export default function AgentTerminalPanel({ state }: Props): React.JSX.Element
               起動
             </button>
           )}
+          {review?.isRecording === true && (
+            <button
+              type="button"
+              className="agent-terminal-panel__button"
+              aria-label="エージェントの変更を確認（ソース管理を開く）"
+              onClick={() => {
+                // 最大化の間はエディタとサイドバーの操作が隠れるため、元に戻してから移る
+                if (layout.isMaximized) {
+                  moveFocusOutOfTerminal()
+                  layout.toggleMaximized()
+                }
+                review.onReview()
+              }}
+            >
+              変更を確認
+            </button>
+          )}
           <button
             type="button"
             className="agent-terminal-panel__button"
```

`src/renderer/src/components/EditorPanel.tsx`:

```diff
--- a/src/renderer/src/components/EditorPanel.tsx
+++ b/src/renderer/src/components/EditorPanel.tsx
@@ -15,6 +15,7 @@ import DiffView from './source-control/DiffView'
 import ConflictResolver from './source-control/ConflictResolver'
 import type { ConflictFileState } from '../hooks/useConflictFile'
 import AgentTerminalPanel from './agent/AgentTerminalPanel'
+import type { AgentChangesReviewAction } from './agent/AgentTerminalPanel'
 import type { AgentTerminalPanelState } from '../hooks/useAgentWorkspace'
 import ExternalChangeBanner, { ExternalChangeAnnouncer } from './editor/ExternalChangeBanner'
 import type { ExternalChangeBannerState } from '../hooks/useExternalFileChanges'
@@ -81,6 +82,8 @@ interface Props {
   externalChangeBanner?: ExternalChangeBannerState | null
   /** エージェントの変更の diff タブのハンクの操作(アクティブな diff タブが agent のときだけ DiffView に渡す) */
   agentDiffActions?: AgentDiffActions
+  /** ターミナルの帯の「変更を確認」 */
+  agentChangesReview?: AgentChangesReviewAction
 }

 export default function EditorPanel({
@@ -122,7 +125,8 @@ export default function EditorPanel({
   bottomPanel = 'output',
   agentTerminal,
   externalChangeBanner = null,
-  agentDiffActions
+  agentDiffActions,
+  agentChangesReview
 }: Props): React.JSX.Element {
   const openFile = openFiles.find((f) => f.path === activeFilePath) ?? null
   // Monaco の onMount はファイル切替時の再マウント以外では再発火しないため、
@@ -249,7 +253,9 @@ export default function EditorPanel({
           applyOutput={applyOutput}
         />
       )}
-      {showAgentTerminal && <AgentTerminalPanel state={agentTerminal} />}
+      {showAgentTerminal && (
+        <AgentTerminalPanel state={agentTerminal} review={agentChangesReview} />
+      )}
     </div>
   )
 }
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/usePanelState.test.ts src/renderer/src/components/agent src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx 2>&1 | tail -n 5`
Expected: PASS

- [ ] **Step 5: 変異で落ちることを確かめる**（手順は Task 4 の Step 5）

| #   | ファイル                 | 置き換え前                                                                                       | 置き換え後                                            | 落ちるテスト                                       |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------- |
| A1  | `AgentTerminalPanel.tsx` | `                  layout.toggleMaximized()⏎                }⏎                review.onReview()` | `                }⏎                review.onReview()` | `最大化の間に押したら、最大化を元に戻してから移る` |
| A2  | `EditorPanel.tsx`        | ` review={agentChangesReview} />`                                                                | ` />`                                                 | `ターミナルパネルに「変更を確認」を渡す`           |

- [ ] **Step 6: 確認コマンド**

```bash
npm run typecheck 2>&1 | tail -n 5
npx prettier --write src/renderer/src/hooks/usePanelState.ts src/renderer/src/components/agent/AgentTerminalPanel.tsx src/renderer/src/components/EditorPanel.tsx src/renderer/src/hooks/__tests__/usePanelState.test.ts src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx
npx eslint src/renderer/src/hooks/usePanelState.ts src/renderer/src/components/agent/AgentTerminalPanel.tsx src/renderer/src/components/EditorPanel.tsx
```

---

### Task 18: renderer: 組み立て（`useAppState`・`App`・`Sidebar`・ソース管理パネル）

**Files:**

- Modify: `src/renderer/src/hooks/useAppState.ts`（記録・戻す・取り直しの契機・diff タブの同期・帯とセクションへ渡す値）、`src/renderer/src/App.tsx:142・303・365`、`src/renderer/src/components/Sidebar.tsx:5・100・195・314`、`src/renderer/src/components/source-control/SourceControlPanel.tsx:5・63・112・153・191`、`src/renderer/src/components/source-control/GitRepoView.tsx:9・64・102・137`（バナーの直後・コミットの欄の上）、`src/renderer/src/components/source-control/NotRepositoryView.tsx:5・12・20・59`、`src/renderer/src/components/source-control/AgentChangesSection.tsx`（props の型を export）
- Create: `src/renderer/src/components/__tests__/App.agentChanges.test.tsx`
- Test: `src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`

**Interfaces:**

- Consumes: Task 12〜17 の全部
- Produces: `type AgentChangesSectionProps`・`type AgentChangesPanelState = Omit<AgentChangesSectionProps, 'isNotRepository'>`（`AgentChangesSection.tsx`）、`useAppState()` の `agentChangesPanel: AgentChangesPanelState`・`agentDiffActions: AgentDiffActions`・`agentChangesReview: AgentChangesReviewAction`、`Sidebar`・`SourceControlPanel`・`GitRepoView`・`NotRepositoryView` の `agentChanges?: AgentChangesPanelState`
- 注: 取り直しの契機は設計書「いつ完了とするか」の 4 つ: (1) 帯の `変更を確認`（`showPanel('source-control')` → フォーカスの依頼 → `refreshGitStatus` → `refresh({ announce: true })`）、(2) セクションの `更新` とソース管理の更新のボタン（`refreshGitStatus` → (3)）、(3) `gitStatus` が新しくなったら（記録が無ければ `refresh` は何もしない）、(4) セッションの終了（`session.exit`）。ウィンドウのフォーカスの復帰では取り直さない。記録を始めたら一覧を 1 回取る（`beginAgentChanges`。送信の前の準備と `いまから記録する` で使う。送信は一覧を待たない）。保存できたパスは `onSaveSucceeded` から `markSaved` へ（`useAgentChanges` は `useFileSystem` の後に作るため ref で渡す）。一覧から消えた agent の diff タブは閉じる（記録が無くなったらすべて。初回のマウントでは呼ばない）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts` の変更（配線。パターン 155）:

```diff
--- a/src/renderer/src/hooks/__tests__/useAppState.agent.test.ts
+++ b/src/renderer/src/hooks/__tests__/useAppState.agent.test.ts
@@ -3,7 +3,7 @@
 // 公開する値だけを確かめる。実行方式の切り替えの安全・確認・実行ボタンの状態の組み立ては useAgentWorkspace.test.ts と
 // promptRunState.test.ts
 import { describe, it, expect, vi, beforeEach } from 'vitest'
-import { renderHook, act } from '@testing-library/react'
+import { renderHook, act, waitFor } from '@testing-library/react'
 import type { GitStatusResult } from '@shared/types'
 import { makeAgentWorkspaceState } from '../../__tests__/makeAgentWorkspaceState'
 import type { DiffTabKey } from '../useDiffTabs'
@@ -16,7 +16,8 @@ const mockUsePanelState = vi.hoisted(() =>
   vi.fn(() => ({
     activePanel: 'explorer' as const,
     sidebarOpen: true,
-    handlePanelChange: vi.fn()
+    handlePanelChange: vi.fn(),
+    showPanel: vi.fn()
   }))
 )

@@ -319,7 +320,8 @@ describe('useAppState', () => {
       renderHook(() => useAppState())
       expect(mockUseAgentWorkspace).toHaveBeenLastCalledWith({
         folderPath: '/repo',
-        isExecuting: true
+        isExecuting: true,
+        beforeAgentSend: expect.any(Function)
       })
     })

@@ -327,7 +329,97 @@ describe('useAppState', () => {
       renderHook(() => useAppState())
       expect(mockUseAgentWorkspace).toHaveBeenLastCalledWith({
         folderPath: null,
-        isExecuting: false
+        isExecuting: false,
+        beforeAgentSend: expect.any(Function)
+      })
+    })
+
+    // beforeAgentSend・agentChangesPanel などは省略可能な引数・props のため、配線の漏れを型で検知できない(パターン 155)
+    describe('エージェントの変更の配線', () => {
+      beforeEach(() => {
+        window.api.getAgentChangesState = vi.fn().mockResolvedValue({ kind: 'none' })
+        window.api.beginAgentChanges = vi
+          .fn()
+          .mockResolvedValue({ kind: 'recording', startedAt: 100 })
+        window.api.listAgentChanges = vi.fn().mockResolvedValue({
+          kind: 'recording',
+          startedAt: 100,
+          entries: [{ path: 'a.txt', status: 'M', isDirectory: false, notRecorded: false }],
+          totalCount: 1,
+          truncated: false,
+          headChanged: false
+        })
+        window.api.clearAgentChanges = vi.fn().mockResolvedValue(undefined)
+        mockUseFileSystem.mockReturnValue({ ...defaultUseFileSystem(), folderPath: '/repo' })
+      })
+
+      it('送信の前の準備(beforeAgentSend)は記録を始めてから一覧を取る', async () => {
+        renderHook(() => useAppState())
+        const { beforeAgentSend } = mockUseAgentWorkspace.mock.lastCall![0] as {
+          beforeAgentSend: () => Promise<void>
+        }
+        await act(async () => {
+          await beforeAgentSend()
+        })
+        expect(window.api.beginAgentChanges).toHaveBeenCalledOnce()
+        await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalled())
+      })
+
+      it('「変更を確認」はソース管理パネルを切り替えて開き、git status と一覧を取り直し、フォーカスを依頼する', async () => {
+        const showPanel = vi.fn()
+        mockUsePanelState.mockReturnValue({ ...mockUsePanelState(), showPanel })
+        const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
+        mockUseGitStatus.mockReturnValue({ ...mockUseGitStatus(), refreshGitStatus })
+        const { result } = renderHook(() => useAppState())
+        await act(async () => {
+          await result.current.agentChangesPanel.changes.begin()
+        })
+        expect(result.current.agentChangesReview.isRecording).toBe(true)
+        act(() => result.current.agentChangesReview.onReview())
+        expect(showPanel).toHaveBeenCalledWith('source-control')
+        expect(refreshGitStatus).toHaveBeenCalled()
+        expect(result.current.agentChangesPanel.changes.isFocusRequested).toBe(true)
+        await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalled())
+      })
+
+      it('記録を終えたら、エージェントの変更の diff タブを閉じる', async () => {
+        const closeDiffTab = vi.fn()
+        mockUseDiffTabs.mockReturnValue({
+          ...mockUseDiffTabs(),
+          diffTabs: [
+            { path: 'a.txt', kind: 'agent' },
+            { path: 'a.txt', kind: 'unstaged' }
+          ],
+          closeDiffTab
+        })
+        const { result } = renderHook(() => useAppState())
+        await act(async () => {
+          await result.current.agentChangesPanel.changes.begin()
+        })
+        await waitFor(() =>
+          expect(result.current.agentChangesPanel.changes.view).toMatchObject({
+            kind: 'recording',
+            list: { totalCount: 1 }
+          })
+        )
+        expect(closeDiffTab).not.toHaveBeenCalled()
+        await act(async () => {
+          await result.current.agentChangesPanel.changes.clear()
+        })
+        expect(closeDiffTab).toHaveBeenCalledExactlyOnceWith({ path: 'a.txt', kind: 'agent' })
+      })
+
+      it('diff タブのハンクの操作は、開いている agent のタブの行が変更なら戻せる', async () => {
+        mockUseDiffTabs.mockReturnValue({
+          ...mockUseDiffTabs(),
+          activeDiffTab: { path: 'a.txt', kind: 'agent' }
+        })
+        const { result } = renderHook(() => useAppState())
+        expect(result.current.agentDiffActions.canRevertHunk).toBe(false)
+        await act(async () => {
+          await result.current.agentChangesPanel.changes.begin()
+        })
+        await waitFor(() => expect(result.current.agentDiffActions.canRevertHunk).toBe(true))
       })
     })
```

`src/renderer/src/components/__tests__/App.agentChanges.test.tsx`（新規。App から末端までの配線）:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentChangesListResult, GitStatusResult } from '@shared/types'
import type { Panel } from '../../types'

// jsdom では xterm を開けないため、文書ごとの controller を偽物にする(App.agentCli.test.tsx と同じ)
vi.mock('../../lib/xtermFactory', async () => {
  const { makeFakeController } = await import('../../__tests__/makeFakeAgentTerminal')
  const controller = makeFakeController()
  return { getAgentTerminalController: () => controller }
})

import App from '../../App'
import { activityBarPanels } from '../../config/activityBarPanels'

// App → Sidebar → SourceControlPanel → GitRepoView → AgentChangesSection と、App → EditorPanel → DiffView・AgentTerminalPanel の
// エージェントの変更の配線を、末端の表示と IPC の呼び出しで確かめる(どれも省略可能な props。パターン 155)

const repoStatus: GitStatusResult = {
  isRepo: true,
  mergeInProgress: false,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/main',
  detached: false,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: []
}

const listed: AgentChangesListResult = {
  kind: 'recording',
  startedAt: new Date(2026, 9, 7, 10, 42).getTime(),
  entries: [
    { path: 'a.txt', status: 'M', isDirectory: false, notRecorded: false },
    { path: 'new.txt', status: 'A', isDirectory: false, notRecorded: false }
  ],
  totalCount: 2,
  truncated: false,
  headChanged: false
}

const panelButton = (panel: Panel): HTMLElement => {
  const config = activityBarPanels.find((p) => p.panel === panel)
  if (config === undefined) throw new Error(`panel config not found: ${panel}`)
  return screen.getByTitle(config.title)
}

const section = (): HTMLElement => screen.getByRole('region', { name: /^エージェントの変更/ })

async function openRepository(): Promise<void> {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
  )
}

describe('App: エージェントの変更の配線', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api.getPromptExecutionMode = vi.fn().mockResolvedValue('agent-cli')
    window.api.openFolder = vi.fn().mockResolvedValue('/project')
    window.api.readDirectory = vi.fn().mockResolvedValue([])
    window.api.getGitStatus = vi.fn().mockResolvedValue(repoStatus)
    window.api.getLog = vi.fn().mockResolvedValue([])
    window.api.getBranches = vi.fn().mockResolvedValue([])
    window.api.getTags = vi.fn().mockResolvedValue([])
    window.api.getStashes = vi.fn().mockResolvedValue([])
    window.api.onExternalFileChange = vi.fn(() => () => {})
    window.api.getAgentChangesState = vi.fn().mockResolvedValue({ kind: 'none' })
    window.api.beginAgentChanges = vi
      .fn()
      .mockResolvedValue({ kind: 'recording', startedAt: listed.startedAt })
    window.api.listAgentChanges = vi.fn().mockResolvedValue(listed)
    window.api.getAgentChangeDiff = vi
      .fn()
      .mockResolvedValue(
        'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n'
      )
    window.api.revertAgentChange = vi.fn().mockResolvedValue(undefined)
    window.api.revertAgentChangeHunk = vi.fn().mockResolvedValue(undefined)
    window.confirm = vi.fn().mockReturnValue(true)
  })

  it('ソース管理のセクションで記録を始め、一覧の行から diff タブを開き、ファイル・ハンクを戻す', async () => {
    await openRepository()
    await userEvent.click(panelButton('source-control'))
    await userEvent.click(
      await within(section()).findByRole('button', { name: 'いまから記録する' })
    )
    expect(window.api.beginAgentChanges).toHaveBeenCalledOnce()
    expect(
      await within(section()).findByRole('button', { name: 'a.txt のエージェントの変更を表示' })
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'a.txt のエージェントの変更を表示' }))
    expect(
      await screen.findByRole('tab', { name: /a\.txt \(エージェントの変更\)/ })
    ).toBeInTheDocument()
    expect(window.api.getAgentChangeDiff).toHaveBeenCalledWith('a.txt')
    await userEvent.click(await screen.findByRole('button', { name: 'このハンクを実行前に戻す' }))
    expect(window.api.revertAgentChangeHunk).toHaveBeenCalledWith(
      'a.txt',
      expect.stringContaining('@@ -1 +1 @@')
    )

    await userEvent.click(screen.getByRole('button', { name: 'new.txt をゴミ箱へ移動' }))
    expect(window.confirm).toHaveBeenLastCalledWith(
      'new.txt をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）'
    )
    expect(window.api.revertAgentChange).toHaveBeenCalledWith('new.txt')
  })

  it('ターミナルの帯の「変更を確認」で、ソース管理パネルへ切り替えて一覧を取り直し、セクションの見出しへフォーカスを移す', async () => {
    window.api.getAgentChangesState = vi
      .fn()
      .mockResolvedValue({ kind: 'recording', startedAt: listed.startedAt })
    await openRepository()
    const review = await screen.findByRole('button', {
      name: 'エージェントの変更を確認（ソース管理を開く）'
    })
    await userEvent.click(review)
    const heading = await within(section()).findByRole('button', {
      name: /エージェントの変更 \(2\)（10:42 から）/
    })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(window.api.listAgentChanges).toHaveBeenCalled()
  })

  it('Git 管理外のフォルダでは、セクションに理由を出す', async () => {
    window.api.getGitStatus = vi.fn().mockResolvedValue({ ...repoStatus, isRepo: false })
    await openRepository()
    await userEvent.click(panelButton('source-control'))
    expect(
      await within(section()).findByText(
        'Git 管理外のフォルダでは、エージェントの変更を記録できません'
      )
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/App.agentChanges.test.tsx 2>&1 | tail -n 5`
Expected: FAIL（`beforeAgentSend` が渡らない・セクションが無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/components/source-control/AgentChangesSection.tsx`:

```diff
--- a/src/renderer/src/components/source-control/AgentChangesSection.tsx
+++ b/src/renderer/src/components/source-control/AgentChangesSection.tsx
@@ -17,7 +17,10 @@ import { toAnnouncementText } from '../../lib/announcementText'
 import { isPathAtOrInside, joinPath } from '../../lib/pathUtils'
 import AgentChangesFileItem from './AgentChangesFileItem'

-interface Props {
+/** ソース管理パネルへ渡すセクションの状態(Git 管理外かは SourceControlPanel が決める) */
+export type AgentChangesPanelState = Omit<AgentChangesSectionProps, 'isNotRepository'>
+
+export interface AgentChangesSectionProps {
   changes: Pick<
     AgentChangesController,
     | 'view'
@@ -52,7 +55,7 @@ export default function AgentChangesSection({
   isNotRepository,
   isAgentMode,
   onOpenDiff
-}: Props): React.JSX.Element | null {
+}: AgentChangesSectionProps): React.JSX.Element | null {
   const headingId = useId()
   const bodyId = useId()
   const reasonId = useId()
```

`src/renderer/src/hooks/useAppState.ts`:

```diff
--- a/src/renderer/src/hooks/useAppState.ts
+++ b/src/renderer/src/hooks/useAppState.ts
@@ -1,4 +1,4 @@
-import { useEffect } from 'react'
+import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
 import { usePanelState } from './usePanelState'
 import { useFileSystem } from './useFileSystem'
 import { usePrompts } from './usePrompts'
@@ -45,6 +45,11 @@ import { useExternalChangeMarks } from './useExternalChangeMarks'
 import { useExternalFileChanges } from './useExternalFileChanges'
 import type { ExternalChangeBannerState } from './useExternalFileChanges'
 import { AGENT_STOP_ON_FOLDER_CHANGE_CONFIRM } from '../lib/agentSessionMessages'
+import { useAgentChanges } from './useAgentChanges'
+import { useAgentChangesRevert } from './useAgentChangesRevert'
+import type { AgentChangesPanelState } from '../components/source-control/AgentChangesSection'
+import type { AgentChangesReviewAction } from '../components/agent/AgentTerminalPanel'
+import type { AgentDiffActions } from '../types'

 type AppState = {
   quickOpen: ReturnType<typeof useQuickOpen>
@@ -90,6 +95,12 @@ type AppState = {
   isActiveFileConflicted: boolean
   /** 編集中のタブの外部変更の通知 */
   externalChangeBanner: ExternalChangeBannerState | null
+  /** ソース管理パネルのセクション「エージェントの変更」 */
+  agentChangesPanel: AgentChangesPanelState
+  /** エージェントの変更の diff タブのハンクの操作 */
+  agentDiffActions: AgentDiffActions
+  /** ターミナルの帯の「変更を確認」 */
+  agentChangesReview: AgentChangesReviewAction
 } & Omit<AgentWorkspaceState, 'confirmStopAgent' | 'sendToAgent'> &
   ReturnType<typeof usePanelState> &
   ReturnType<typeof useFileSystem> &
@@ -112,10 +123,27 @@ export function useAppState(): AppState {
   // 保存の直前の照合で上書きがキャンセルされたタブは、監視と同じ外部変更の確認を通して印を付ける(印を直接付けると
   // 「このまま編集する」で消した後にフォーカスの復帰で出し直す)。保存できたら印を消す
   const externalChangeMarks = useExternalChangeMarks()
+  // 保存できたパスを、エージェントの変更の記録(useAgentChanges。フォルダに依存するため後で作る)へも知らせる
+  const savedPathListenerRef = useRef<(path: string) => void>(() => undefined)
   const fileSystem = useFileSystem({
     onSaveConflict: externalChangeMarks.requestCheck,
-    onSaveSucceeded: externalChangeMarks.clear
+    onSaveSucceeded: (path) => {
+      externalChangeMarks.clear(path)
+      savedPathListenerRef.current(path)
+    }
   })
+  // エージェントの変更の記録・一覧(main の registry の写し)
+  const agentChanges = useAgentChanges(fileSystem.folderPath)
+  useLayoutEffect(() => {
+    savedPathListenerRef.current = agentChanges.markSaved
+  }, [agentChanges.markSaved])
+  // 記録を始めたら一覧を取る(取り直しは一覧が空でも「変わったファイルはありません」を出すため)。送信の前の準備と
+  // 「いまから記録する」で使う。begin は reject しない
+  const { begin: beginAgentChangesOnly, refresh: refreshAgentChanges } = agentChanges
+  const beginAgentChanges = useCallback(async (): Promise<void> => {
+    await beginAgentChangesOnly()
+    void refreshAgentChanges()
+  }, [beginAgentChangesOnly, refreshAgentChanges])
   const prompts = usePrompts()
   const progress = useProgressTasks()
   const git = useGitStatus(fileSystem.folderPath)
@@ -175,7 +203,9 @@ export function useAppState(): AppState {
   // 実行方式とエージェント(ターミナル・セッション・送信)。実行方式の切り替えの手順と、フォルダの切り替えの前の停止の確認を持つ
   const agentWorkspace = useAgentWorkspace({
     folderPath: fileSystem.folderPath,
-    isExecuting: execution.isExecuting
+    isExecuting: execution.isExecuting,
+    // プロンプトの「実行」で送る前に、エージェントの変更の記録を始める(記録があれば main は何もしない)
+    beforeAgentSend: beginAgentChanges
   })
   const promptRunner = usePromptRunner({
     openFile: fileSystem.openFile,
@@ -476,6 +506,79 @@ export function useAppState(): AppState {
     // main はフォルダが変わると監視を閉じる。タブが残る切り替えでも監視の対象を送り直す
     folderPath: fileSystem.folderPath
   })
+  // エージェントの変更の一覧を取り直す契機(設計書「いつ完了とするか」): git status の取り直し(Git の操作・保存・ソース管理の
+  // 更新のボタンの後)と、エージェントのセッションの終了。記録が無ければ refresh は何もしない
+  useEffect(() => {
+    if (git.gitStatus !== null) void refreshAgentChanges()
+  }, [git.gitStatus, refreshAgentChanges])
+  const agentSessionExit = agentWorkspace.agentTerminal.session.exit
+  useEffect(() => {
+    if (agentSessionExit !== null) void refreshAgentChanges()
+  }, [agentSessionExit, refreshAgentChanges])
+  // エージェントの変更の一覧から消えたパスの diff タブを閉じる(記録が無くなったらすべて)。開いているなら取り直す。
+  // 初回のマウントは変化ではないため呼ばない(useOnChange)
+  const agentChangesView = agentChanges.view
+  useOnChange(agentChangesView, () => {
+    const list = agentChangesView.kind === 'recording' ? agentChangesView.list : null
+    if (agentChangesView.kind === 'recording' && list === null) return
+    const paths = (list?.entries ?? []).map((entry) => entry.path.replace(/\/+$/, ''))
+    for (const tab of diffTabs.diffTabs) {
+      if (tab.kind !== 'agent') continue
+      if (!paths.some((path) => isSamePath(path, tab.path))) diffTabs.closeDiffTab(tab)
+    }
+    if (diffTabs.activeDiffTab?.kind === 'agent') diffOperations.refreshDiff()
+  })
+  const agentChangesRevert = useAgentChangesRevert({
+    folderPath: fileSystem.folderPath,
+    changes: agentChanges,
+    fileLock: fileOperationLock,
+    agentRunning: agentWorkspace.agentTerminal.session.status === 'running',
+    hasDirtyTabAtOrInside: fileSystem.hasDirtyTabAtOrInside,
+    reloadOpenFile: fileSystem.reloadOpenFile,
+    closeTabsAtOrInside: fileSystem.closeTabsAtOrInside,
+    confirmDiscardAnyDirty: fileSystem.confirmDiscardAnyDirty,
+    reloadOpenFiles: fileSystem.reloadOpenFiles,
+    refreshTree: fileSystem.refreshTree,
+    refreshGitStatus: git.refreshGitStatus,
+    refreshDiff: diffOperations.refreshDiff
+  })
+  const activeAgentPath =
+    diffTabs.activeDiffTab?.kind === 'agent' ? diffTabs.activeDiffTab.path : null
+  const activeAgentEntry =
+    activeAgentPath === null || agentChangesView.kind !== 'recording'
+      ? undefined
+      : agentChangesView.list?.entries.find((entry) => isSamePath(entry.path, activeAgentPath))
+  const agentDiffActions: AgentDiffActions = {
+    // ハンクで戻せるのは記録した変更・種類の変更だけ(追加・削除はファイル単位。設計書「diff タブ」)
+    canRevertHunk:
+      activeAgentEntry !== undefined &&
+      (activeAgentEntry.status === 'M' || activeAgentEntry.status === 'T') &&
+      !activeAgentEntry.notRecorded &&
+      !activeAgentEntry.isDirectory,
+    disabledReason: agentChangesRevert.revertDisabledReason,
+    error: agentChangesRevert.error,
+    onRevertHunk: (patch, hunkHeader) => {
+      if (activeAgentPath !== null)
+        void agentChangesRevert.revertHunk(activeAgentPath, patch, hunkHeader)
+    }
+  }
+  // ターミナルの帯の「変更を確認」: ソース管理パネルを開き(閉じない)、git status と一覧を取り直し、セクションへフォーカスを移す
+  const agentChangesReview: AgentChangesReviewAction = {
+    isRecording: agentChangesView.kind === 'recording',
+    onReview: () => {
+      panel.showPanel('source-control')
+      agentChanges.requestFocus()
+      void git.refreshGitStatus()
+      void agentChanges.refresh({ announce: true })
+    }
+  }
+  const agentChangesPanel: AgentChangesPanelState = {
+    changes: { ...agentChanges, begin: beginAgentChanges },
+    revert: agentChangesRevert,
+    folderPath: fileSystem.folderPath,
+    isAgentMode: agentWorkspace.executionModePanel.mode === 'agent-cli',
+    onOpenDiff: (path) => diffTabs.openDiffTab({ path, kind: 'agent' })
+  }
   return {
     quickOpen,
     isLocked: fileOperationLock.isLocked,
@@ -524,6 +627,9 @@ export function useAppState(): AppState {
     promptRun: agentWorkspace.promptRun,
     bottomPanel: agentWorkspace.bottomPanel,
     agentTerminal: agentWorkspace.agentTerminal,
-    externalChangeBanner
+    externalChangeBanner,
+    agentChangesPanel,
+    agentDiffActions,
+    agentChangesReview
   }
 }
```

`src/renderer/src/App.tsx`:

```diff
--- a/src/renderer/src/App.tsx
+++ b/src/renderer/src/App.tsx
@@ -139,7 +139,10 @@ export default function App(): React.JSX.Element {
     promptRun,
     bottomPanel,
     agentTerminal,
-    externalChangeBanner
+    externalChangeBanner,
+    agentChangesPanel,
+    agentDiffActions,
+    agentChangesReview
   } = useAppState()

   // タブを開く操作(openDiffTab の呼び出し)と、diff 内容の取得(activeDiffTab の変化に対する
@@ -300,6 +303,7 @@ export default function App(): React.JSX.Element {
               mergeState={mergeState}
               gitTag={gitTag}
               remoteSetup={remoteSetup}
+              agentChanges={agentChangesPanel}
               gitBranchOperationError={branchOperationError}
               onOpenDiff={handleOpenDiff}
               onAmend={handleAmend}
@@ -363,6 +367,8 @@ export default function App(): React.JSX.Element {
             bottomPanel={bottomPanel}
             agentTerminal={agentTerminal}
             externalChangeBanner={externalChangeBanner}
+            agentDiffActions={agentDiffActions}
+            agentChangesReview={agentChangesReview}
           />
         </div>
       </div>
```

`src/renderer/src/components/Sidebar.tsx`:

```diff
--- a/src/renderer/src/components/Sidebar.tsx
+++ b/src/renderer/src/components/Sidebar.tsx
@@ -3,6 +3,7 @@ import ProgressPanel from './progress/ProgressPanel'
 import HistoryPanel from './history/HistoryPanel'
 import ExplorerPanel from './explorer/ExplorerPanel'
 import SourceControlPanel from './source-control/SourceControlPanel'
+import type { AgentChangesPanelState } from './source-control/AgentChangesSection'
 import SettingsPanel from './settings/SettingsPanel'
 import PanelContainer from './PanelContainer'
 import { sidebarTitles } from '../config/sidebarTitles'
@@ -98,6 +99,8 @@ interface Props {
   gitTag: GitTagPanelState
   /** リモートの管理の状態と操作(SourceControlPanel へそのまま渡す) */
   remoteSetup: RemoteSetupPanelState
+  /** セクション「エージェントの変更」の状態と操作(SourceControlPanel へそのまま渡す) */
+  agentChanges?: AgentChangesPanelState
   gitBranchOperationError: Error | null
   onOpenDiff: (path: string, staged: boolean) => void
   onAmend: (message: string) => Promise<boolean>
@@ -193,6 +196,7 @@ export default function Sidebar({
   mergeState,
   gitTag,
   remoteSetup,
+  agentChanges,
   gitBranchOperationError,
   onOpenDiff,
   onAmend,
@@ -312,6 +316,7 @@ export default function Sidebar({
           mergeState={mergeState}
           gitTag={gitTag}
           remoteSetup={remoteSetup}
+          agentChanges={agentChanges}
           branchOperationError={gitBranchOperationError}
           lastCommitMessage={lastCommitMessage}
           onAmend={onAmend}
```

`src/renderer/src/components/source-control/SourceControlPanel.tsx`:

```diff
--- a/src/renderer/src/components/source-control/SourceControlPanel.tsx
+++ b/src/renderer/src/components/source-control/SourceControlPanel.tsx
@@ -3,6 +3,7 @@ import type { GitBranch, GitLogEntry, GitStatusResult } from '@shared/types'
 import GitRepoView from './GitRepoView'
 import SourceControlToolbar from './SourceControlToolbar'
 import NotRepositoryView from './NotRepositoryView'
+import type { AgentChangesPanelState } from './AgentChangesSection'
 import { getRemoteSetupState } from '../../lib/remoteSetupState'
 import { useRemoteSetupFocus } from '../../hooks/useRemoteSetupFocus'
 import { alwaysUnlocked } from '../../hooks/useFileOperationLock'
@@ -61,6 +62,8 @@ interface Props {
   gitTag: GitTagPanelState
   /** リモートの管理の状態と操作(Git 管理外の「リポジトリを初期化」、状態バナー、成功の後のフォーカスの移し先) */
   remoteSetup: RemoteSetupPanelState
+  /** セクション「エージェントの変更」の状態と操作。Git 管理外かはここで決めて渡す */
+  agentChanges?: AgentChangesPanelState
   branchOperationError: Error | null
 }

@@ -109,6 +112,7 @@ export default function SourceControlPanel({
   mergeState,
   gitTag,
   remoteSetup,
+  agentChanges,
   branchOperationError
 }: Props): React.JSX.Element {
   // 初期化・追加・初回 push の成功の後に、次の操作のボタン(このパネルの中にある)へフォーカスを移す。
@@ -151,6 +155,7 @@ export default function SourceControlPanel({
             remoteSetup={remoteSetup}
             isBlocked={isAnyLocked()}
             requestFocus={requestRemoteSetupFocus}
+            agentChanges={agentChanges}
           />
         ) : (
           <GitRepoView
@@ -189,6 +194,7 @@ export default function SourceControlPanel({
             remoteSetupKind={getRemoteSetupState(gitStatus)}
             remoteSetup={remoteSetup}
             requestRemoteSetupFocus={requestRemoteSetupFocus}
+            agentChanges={agentChanges}
           />
         ))}
       {gitStatus === null && !gitLoading && !gitError && (
```

`src/renderer/src/components/source-control/GitRepoView.tsx`:

```diff
--- a/src/renderer/src/components/source-control/GitRepoView.tsx
+++ b/src/renderer/src/components/source-control/GitRepoView.tsx
@@ -7,6 +7,8 @@ import StashSection from './StashSection'
 import BranchSwitcher from './BranchSwitcher'
 import MergeBanner from './MergeBanner'
 import RemoteSetupBanner from './RemoteSetupBanner'
+import AgentChangesSection from './AgentChangesSection'
+import type { AgentChangesPanelState } from './AgentChangesSection'
 import { alwaysUnlocked } from '../../hooks/useFileOperationLock'
 import type {
   BranchOperationKind,
@@ -62,6 +64,8 @@ interface Props {
   remoteSetup: RemoteSetupPanelState
   /** 追加・初回 push の成功の後に、次の操作のボタンへのフォーカスを要求する(SourceControlPanel の useRemoteSetupFocus) */
   requestRemoteSetupFocus: (target: RemoteSetupFocusTarget) => void
+  /** セクション「エージェントの変更」(バナーの直後・コミットの欄の上に置く) */
+  agentChanges?: AgentChangesPanelState
 }

 export default function GitRepoView({
@@ -99,7 +103,8 @@ export default function GitRepoView({
   gitTag,
   remoteSetupKind,
   remoteSetup,
-  requestRemoteSetupFocus
+  requestRemoteSetupFocus,
+  agentChanges
 }: Props): React.JSX.Element {
   const stagedCount = files.filter(isStagedFile).length
   // stage/unstage(useGitOperations)実行中、ハンク操作(useDiffOperations の
@@ -134,6 +139,10 @@ export default function GitRepoView({
         requestFocus={requestRemoteSetupFocus}
         isBlocked={isBlockedByOtherOperation}
       />
+      {/* エージェントの変更の確認 → ステージ → コミットが上から下に並ぶ(設計書「配置の案」A) */}
+      {agentChanges !== undefined && (
+        <AgentChangesSection {...agentChanges} isNotRepository={false} />
+      )}
       <CommitSection
         stagedCount={stagedCount}
         isCommitting={isCommitting}
```

`src/renderer/src/components/source-control/NotRepositoryView.tsx`:

```diff
--- a/src/renderer/src/components/source-control/NotRepositoryView.tsx
+++ b/src/renderer/src/components/source-control/NotRepositoryView.tsx
@@ -3,6 +3,8 @@ import type { RemoteSetupPanelState } from '../../types'
 import type { RemoteSetupFocusTarget } from '../../lib/remoteSetupState'
 import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn'
 import InitRepositoryDialog from './InitRepositoryDialog'
+import AgentChangesSection from './AgentChangesSection'
+import type { AgentChangesPanelState } from './AgentChangesSection'

 interface Props {
   remoteSetup: RemoteSetupPanelState
@@ -10,6 +12,8 @@ interface Props {
   isBlocked: boolean
   /** 成功の後に、次の操作のボタンへのフォーカスを要求する(SourceControlPanel の useRemoteSetupFocus) */
   requestFocus: (target: RemoteSetupFocusTarget) => void
+  /** セクション「エージェントの変更」(Git 管理外の理由を出す) */
+  agentChanges?: AgentChangesPanelState
 }

 // Git 管理外のフォルダの表示。「リポジトリを初期化」とダイアログの開閉を持つ。初期化に成功すると、ステータスの
@@ -17,7 +21,8 @@ interface Props {
 export default function NotRepositoryView({
   remoteSetup,
   isBlocked,
-  requestFocus
+  requestFocus,
+  agentChanges
 }: Props): React.JSX.Element {
   // 開くときに前回の失敗の表示を消す(キャンセルしたダイアログのエラーを持ち越さない)。キャンセル・Escape・
   // オーバーレイのクリックで閉じたら、初期化中でもなくなった描画の後にボタンへフォーカスを戻す(useDialogFocusReturn)
@@ -56,6 +61,7 @@ export default function NotRepositoryView({
           リポジトリを初期化
         </button>
       </div>
+      {agentChanges !== undefined && <AgentChangesSection {...agentChanges} isNotRepository />}
       {dialog.isOpen && (
         <InitRepositoryDialog
           isRunning={remoteSetup.isInitializing}
```

- [ ] **Step 4: 通ることと、renderer 全体が通ることを確かめる**

```bash
npm run typecheck 2>&1 | tail -n 5
npx vitest run src/renderer 2>&1 | grep -E "Test Files|Tests "
```

Expected: 型エラー 0・すべて成功

- [ ] **Step 5: 変異で落ちることを確かめる**（配線の漏れ。手順は Task 4 の Step 5）

| #   | ファイル                 | 置き換え前                                                                                   | 置き換え後                                           | 落ちるテスト                                                                    |
| --- | ------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| A1  | `Sidebar.tsx`            | `          agentChanges={agentChanges}`                                                      | （空行）                                             | `App.agentChanges.test.tsx` の 3 件                                             |
| A2  | `App.tsx`                | `            agentDiffActions={agentDiffActions}`                                            | （空行）                                             | `一覧の行から diff タブを開き、ファイル・ハンクを戻す`                          |
| A3  | `App.tsx`                | `            agentChangesReview={agentChangesReview}`                                        | （空行）                                             | `ターミナルの帯の「変更を確認」で`                                              |
| A4  | `SourceControlPanel.tsx` | `            requestFocus={requestRemoteSetupFocus}⏎            agentChanges={agentChanges}` | `            requestFocus={requestRemoteSetupFocus}` | `Git 管理外のフォルダでは、セクションに理由を出す`                              |
| A5  | `useAppState.ts`         | `    beforeAgentSend: beginAgentChanges`                                                     | `    beforeAgentSend: undefined`                     | `useAgentWorkspace に開いているフォルダと`・`送信の前の準備(beforeAgentSend)は` |

- [ ] **Step 6: 確認コマンド**

```bash
npx prettier --write src/renderer/src/hooks/useAppState.ts src/renderer/src/App.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/source-control/SourceControlPanel.tsx src/renderer/src/components/source-control/GitRepoView.tsx src/renderer/src/components/source-control/NotRepositoryView.tsx src/renderer/src/components/source-control/AgentChangesSection.tsx src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/App.agentChanges.test.tsx
npx eslint src/renderer/src/hooks/useAppState.ts src/renderer/src/App.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/source-control/SourceControlPanel.tsx src/renderer/src/components/source-control/GitRepoView.tsx src/renderer/src/components/source-control/NotRepositoryView.tsx src/renderer/src/components/source-control/AgentChangesSection.tsx src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/App.agentChanges.test.tsx
```

---

### Task 19: ROADMAP・設計書・テスト仕様書の更新と全体の検証

**Files:**

- Modify: `ROADMAP.md:171-186`（実装済みの節を足す）・`ROADMAP.md:238`（未実装の項目を外し、見送りを足す）、`docs/superpowers/specs/2026-10-06-agent-changes-review-design.md`、`docs/manual-test-spec.md`（新しい領域 `AGC`・既存の GIT-006・RMT-001・AGT-046 の前提）
- 生成: `.superpowers/manual-test-spec.html`（git 管理外。Artifact の再公開は親〈コントローラー〉が行う）

**Interfaces:**

- Consumes: Task 1〜18 の実装（文言は実装のファイルと突き合わせる。パターン 65・89）
- Produces: ROADMAP の実装済みの項目と既知の制約（設計書と 1 対 1）、設計書の「確認の結果」19 以降と本文の更新、実機テスト仕様書の `AGC-001`〜`AGC-027`

- [ ] **Step 1: 設計書を更新する**

`docs/superpowers/specs/2026-10-06-agent-changes-review-design.md` を直す（設計の決定は変えない。実装で分かった事実と、このプランの差異を反映する。過去形・事実の記述。パターン 32・133）:

1. 「確認の結果」の 18 の後に 19〜23 を足す（このプランの「設計書との差異」の該当の番号の文を写す）: 19 = 差異 1（simple-git が拒否する変数に `GIT_CONFIG_GLOBAL` が含まれる）、20 = 差異 6（記録の時点のファイルが同名のフォルダに置き換わると、`ls-files --others` にフォルダの中身が出ない）、21 = 差異 7（`cat-file -e` は無いときに simple-git で resolve する。`cat-file -t` を使う）、22 = 差異 7 の後半（blob が消えた後は変更の一覧の取得が `unable to read` で失敗する）、23 = 差異 5（`--pathspec-from-file` で除外を渡せる）
2. 本文の「戻す手順」4 の `git cat-file -e` を `git cat-file -t` に直し、理由（確認の結果 21）を添える。「全体構成」の `agentChangesQuery.ts` の説明に「記録しなかったファイルは大きさと更新時刻で変わったかを見る」を足す（差異 4）。「IPC」の表の後に「すべてのチャンネルで送信元のメインフレームを確かめる」を足す。「セキュリティ」の「パッチは既存の `assertPatchArg` と同じ上限」を「パッチは文字列で 10,000,000 文字以下（既存の `assertPatchArg` は上限を持たないため、粗い上限を足した。差異 2）」に直す
3. 「既知の制約」に次を足す（ROADMAP と 1 対 1 にするため、この文を Step 2 でそのまま写す）:
   - 記録・一覧・戻すの git は、`GIT_CONFIG_GLOBAL`・`GIT_CONFIG_SYSTEM` などの環境変数で変えた設定の場所を使わず、既定の場所の設定を読む（simple-git の制限）
   - 記録の時点のファイルを、エージェントが同じ名前のフォルダに置き換えると、一覧にはファイルの削除だけが出て、フォルダの中身は出ない（戻すと「未追跡のファイルと重なる」で拒否される。ターミナルで操作する）
   - 記録の時点に大きすぎて記録しなかったファイルは、大きさと更新時刻が変わったときだけ一覧に出る（内容だけが同じ大きさ・時刻で変わったものは出ない）
4. 「実装の分割案」の後に「実装: `docs/superpowers/plans/2026-10-06-agent-changes-review.md`」を足す

```bash
npx prettier --write docs/superpowers/specs/2026-10-06-agent-changes-review-design.md
grep -n "cat-file -e" docs/superpowers/specs/2026-10-06-agent-changes-review-design.md
```

Expected: `cat-file -e` は確認の結果 12・21（採らなかった理由）にだけ残る

- [ ] **Step 2: ROADMAP を更新する**

1. 「## 実装済み機能」の「### エージェント CLI のアプリ内ターミナル実行（MVP）」の節の後（`---` の前）に、次の節を足す:

```markdown
### エージェントが変更したファイルの確認（MVP の次）

- [x] プロンプトの `実行`（エージェント CLI 方式）の直前に、作業ツリーを記録する（利用者の index・stash・HEAD を変えない一時のインデックス。
      記録がある間の `実行` は累積する）。ターミナルに直接打ち込む使い方のために、ソース管理パネルの `いまから記録する` でも始められる
- [x] ソース管理パネルのセクション「エージェントの変更」に、記録の時点から変わったファイル（追加・変更・削除・種類の変更）を出し、
      `<path> (エージェントの変更)` の diff タブで記録の時点との差分を見る（実行の前からあった利用者の未コミットの変更は出さない）
- [x] 実行前の状態へ戻す（ファイル・ハンク・すべて。追加はゴミ箱へ）。確認のダイアログで、アプリでの保存・未保存の編集・エージェントの動作中を知らせる
- [x] ターミナルの帯の `変更を確認` で、ソース管理パネルを開いて一覧を取り直し、セクションへフォーカスを移す
- [x] `確認を終える`・フォルダの切り替え・リロード・ウィンドウの破棄・アプリの終了で記録を捨てる

既知の制約（設計書 `docs/superpowers/specs/2026-10-06-agent-changes-review-design.md` の「既知の制約」と同じ）:
```

続けて、設計書の「既知の制約」の箇条書き（Step 1 の 3 で足したものを含む）を、そのままの文で箇条書きにして写す

2. 「### エージェント実行の支援（MVP の次）」の `- [ ] エージェントが変更したファイルの確認導線（ソース管理の変更一覧・diff へすぐ移る。変更を戻す）` を消し、同じ位置に次の見送り項目を足す（設計書「含めない」「この機能の後の候補」）:

```markdown
- [ ] エージェントの変更の確認の拡張: 実行ごとの記録（実行 1・実行 2 を選んで比べる）、戻した操作の取り消し、完了・許可待ちの検知と連動した
      一覧の自動の取り直し、ウィンドウのフォーカスの復帰での取り直し、`claude` の hooks で利用者の編集と区別する、Git 管理外のフォルダでの記録、
      記録の blob を gc から守る（実装済みの「エージェントが変更したファイルの確認」の続き）
```

```bash
npx prettier --write ROADMAP.md
grep -n "エージェントが変更したファイルの確認導線" ROADMAP.md
```

Expected: `grep` は 0 件

- [ ] **Step 3: 既存の項目の前提を直す**（パターン 160。エージェント CLI 方式が既定で、ソース管理パネルにセクションが増え、ターミナルの帯にボタンが増えるため。ID は変えない）

`docs/manual-test-spec.md`:

- **GIT-006** の期待結果の末尾 `コミット欄や `変更` セクションは出ない` を `コミット欄や `変更`セクションは出ない（エージェント CLI 方式では、その下に「エージェントの変更」のセクションと`Git 管理外のフォルダでは、エージェントの変更を記録できません` が出る）` に直す
- **RMT-001** の期待結果 `` `Git リポジトリではありません` の下に `リポジトリを初期化` ボタンがある `` の後に `（エージェント CLI 方式では、その下に「エージェントの変更」のセクションがある）` を足す
- **AGT-046** の手順の `キーボードの Tab でパネルの帯の開閉・`起動`・`最大化` のボタンへ順に移る` の後に `（エージェントの変更の記録が無い状態。記録がある間は `最大化`の前に`変更を確認` が入る〈AGC-022〉）` を足す

- [ ] **Step 4: テスト仕様書に `AGC` を追記する**

`docs/manual-test-spec.md` の「## エージェント CLI のアプリ内ターミナル」の領域の最後の項目（AGT の最後の `###` の節）の後、「## ソース管理（基本）」の前に、次の領域を足す:

```markdown
## エージェントの変更の確認

> 前提: エージェント CLI 方式（既定）。テスト用の Git リポジトリ（`R=$(mktemp -d); cd "$R" && git init -q -b main && git config user.name tester && git config user.email tester@example.com && printf 'one\ntwo\nthree\n' > a.txt && printf 'b\n' > b.txt && printf 'c\n' > c.txt && git add . && git commit -qm init`）の最上位のフォルダを開き、ターミナルパネルで `claude` を起動している。エージェントへの指示は「プロンプト」パネルの `実行` で送る（指示の例は各項目）。
> 前提: 実装の自動テストでは、実物の `claude` も Electron の画面も使っていない。以下はすべて実機で未確認。期待と違ったら、その画面と `git status --porcelain` の出力を記録する。

### 記録と一覧

- [ ] **AGC-001** 端末で `echo user >> a.txt` を実行してから、`a.txt の最後に agent という行を足し、b.txt を消し、z.txt を作って` を `実行` で送り、作業が終わったらターミナルの帯の `変更を確認` を押す → サイドバーがソース管理パネルに切り替わって開き、「エージェントの変更」の見出し（`エージェントの変更 (3)（HH:MM から）`）にフォーカスがある。一覧に `M a.txt`・`D b.txt`・`A z.txt` の 3 件だけが出る。`a.txt` の diff には `+agent` だけが出て、`user` の行は変更として出ない
- [ ] **AGC-002** AGC-001 の後、`c.txt に 1 行足して` を `実行` で送り、作業の後にセクションの `更新` を押す → 記録を取り直さず、一覧に AGC-001 の 3 件と `M c.txt` の 4 件が出る（累積）。見出しの開始の時刻は AGC-001 のまま
- [ ] **AGC-003** 記録がある状態で、`npm init -y && npm install left-pad` をエージェントに実行させる（`.gitignore` に `node_modules` が無い状態）→ 一覧の `node_modules/` は 1 行にまとまって出る（中のファイルが 1 件ずつ並ばない）
- [ ] **AGC-004** 記録がある状態で、エージェントに `git add -A && git commit -m agent` を実行させてから `更新` を押す → セクションに `記録を始めた後に HEAD が変わりました（コミット・ブランチの切り替えなど）。戻すのはファイルの内容だけです` が出る。一覧はコミットの前と同じファイルが出る
- [ ] **AGC-005** Git 管理外のフォルダ（`mktemp -d` で作っただけ）を開き、ソース管理パネルを見る → 「エージェントの変更」に `Git 管理外のフォルダでは、エージェントの変更を記録できません` が出る。`実行` でエージェントへ送れる
- [ ] **AGC-006** テスト用のリポジトリの中のフォルダ（例: `mkdir "$R/sub"` で作ったもの）を開き、`実行` で送ってからソース管理パネルを見る → `リポジトリの最上位のフォルダを開いたときだけ、エージェントの変更を記録できます` が出る。送信はされる
- [ ] **AGC-007** テスト用のリポジトリで端末から `mkdir many && for i in $(seq 1 5001); do : > many/$i.txt; done` を実行し、セクションの `いまから記録する` を押す → `未追跡のファイルが多すぎるため、記録できません。.gitignore を確かめてください（5,001 件）` が出る。`many` を消すと `いまから記録する` で記録できる
- [ ] **AGC-008** 記録が無い状態で、セクションの `いまから記録する` を押し、ターミナルに直接 `z2.txt を作って` と打ち込んで Enter を押し、作業の後に `更新` を押す → 一覧に `A z2.txt` が出る

### diff タブ

- [ ] **AGC-009** 一覧の `a.txt` を押す → `a.txt (エージェントの変更)` の diff タブが開き、記録の時点との差分だけが出る。ハンクの見出しには `このハンクを実行前に戻す` だけがあり、`このハンクをステージ`・`このハンクを取り消す` は無い
- [ ] **AGC-010** `a.txt` をエディタでも開いた（未編集の）状態で、diff タブの `このハンクを実行前に戻す` を押して確認で OK → そのハンクだけが戻り（`user` の行は残る）、開いている `a.txt` のタブがディスクの内容に読み直される。一覧から `a.txt` が消え、diff タブが閉じる
- [ ] **AGC-011** 一覧の追加されたファイル（`z.txt`）・削除されたファイル（`b.txt`）・追加されたフォルダ（AGC-003 の `node_modules/`）をそれぞれ押す → `z.txt` は全行の追加、`b.txt` は全行の削除の diff で、どちらもハンクのボタンが無い。`node_modules` は `フォルダが追加されました（N 件のファイル）` の 1 行

### 戻す

- [ ] **AGC-012** AGC-001 の状態から（AGC-010 で戻した回は AGC-001 からやり直す）一覧の `a.txt` の `↶` を押す → 確認に `a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。この操作は元に戻せません。` が出る。OK で `a.txt` が `one two three user` の 4 行になり、`1 件を実行前の状態に戻しました` が読み上げられる（VoiceOver）
- [ ] **AGC-013** 削除された `b.txt` の `↶` を押して OK → `b.txt` が記録の時点の内容（`b`）で作り直され、エクスプローラーのツリーに現れる
- [ ] **AGC-014** 追加された `z.txt` の `↶`（`aria-label` は `z.txt をゴミ箱へ移動`）を押す → 確認に `z.txt をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）` が出る。OK で OS のゴミ箱に `z.txt` が入り、開いていた `z.txt` のタブが閉じる
- [ ] **AGC-015** 追加された `node_modules/` の `↶` を押す → 確認に `フォルダとその中身（.gitignore の対象を含む）がすべて移動します。` が含まれ、OK でフォルダがゴミ箱へ移る（中身の多いフォルダで、終わるまでの時間を記録する）
- [ ] **AGC-016** 変更が 3 件以上ある状態で、端末で `git add c.txt && git stash list && git log --oneline -1` の出力を控えてから `すべて戻す` を押す → 確認に件数・`うち N 件の新しいファイル・フォルダはゴミ箱へ移動します。`・`ステージ（index）・コミット・ブランチは戻しません。` が出る。OK で一覧が `記録を始めてから、変わったファイルはありません` になる。「ステージ済み」に `c.txt` が残り、`git stash list`・`git log --oneline -1`・ブランチは控えと同じ
- [ ] **AGC-017** 変更のある `a.txt` をエディタで開いて未保存の編集をしてから `↶` を押す → 確認の文言の最後に `エディタの未保存の編集も破棄されます。` が出る。キャンセルすると、ファイル・タブの編集・一覧のどれも変わらない
- [ ] **AGC-018** 記録がある状態で、`b.txt` をアプリで編集して保存する → 一覧の `b.txt` の行に `あなたの保存を含む` が出る。`↶` の確認の文言に `このファイルは、記録を始めた後にアプリで保存されています。` が出る
- [ ] **AGC-019** 記録がある状態で、ソース管理の `プル`（リモートがあるリポジトリ）を押した直後のセクションを見る → 実行中は `↶`・`すべて戻す` が押せず、`他の Git 操作の実行中です` が一覧の上に出る（VoiceOver でボタンを選ぶと理由が読まれる）
- [ ] **AGC-020** 記録の後にエージェントが変えた `a.txt` があり、端末で `git gc --prune=now` を実行してから `更新` を押す → `実行前の内容が見つかりません（git gc などで消えた可能性があります）` が出る。`a.txt` は消えずにエージェントの変更のまま残る

### 記録の終了と見た目

- [ ] **AGC-021** `確認を終える` を押す → 確認は出ず、セクションが `プロンプトの「実行」で、実行の前の状態の記録を始めます` と `いまから記録する` の表示に戻り、ターミナルの帯の `変更を確認` が消え、`記録を終えました。次の「実行」で新しい記録を始めます` が読み上げられる。開いていた `(エージェントの変更)` の diff タブが閉じる。次の `実行` で新しい開始の時刻の記録が始まる
- [ ] **AGC-022** ウィンドウの幅を 500px・640px・1280px にして、記録が無い状態と有る状態のターミナルの帯を見る → どちらも帯は 1 行（高さ 32px）のまま。記録がある間は `最大化` の前に `変更を確認` が出て、切れずに押せる。セクションの見出しのボタンは 1 行で、長いときは末尾が `…` になる
- [ ] **AGC-023** ターミナルを最大化した状態で `変更を確認` を押す → 最大化が戻り（エディタが見える）、ソース管理パネルが開いてセクションの見出しにフォーカスが移る
- [ ] **AGC-024** 記録がある状態で、フォルダを切り替える（別の回にリロード〈`Cmd+R`〉）→ 元のフォルダに戻っても記録は無く、`変更を確認` は出ない
- [ ] **AGC-025** タッチパネル（あれば）で、一覧の行のパスと `↶`、`更新`・`すべて戻す`・`確認を終える` を指で押す → 押し違えずに押せる（32px 以上）
- [ ] **AGC-026** 記録がある状態でアプリを終了し（`Cmd+Q`）、端末で `ls "$TMPDIR" | grep prompt-ide-agent-baseline` を実行する → 何も出ない（記録の一時ディレクトリが残らない）
- [ ] **AGC-027** 記録がある状態で、従来の方式（設定の「プロンプトの実行方式」）へ切り替えてソース管理パネルを見る → セクションは出たまま（記録がある間）で、`確認を終える` を押すとセクションが消える
```

- [ ] **Step 5: HTML を再生成し、仕様書の検査を通す**

```bash
node scripts/build-manual-test-spec.mjs
npx vitest run scripts 2>&1 | tail -n 5
npx prettier --check docs/manual-test-spec.md || npx prettier --write docs/manual-test-spec.md
```

Expected: 再生成の成功・`scripts` のテストがすべて成功（ID の一意性・接頭辞ごとの昇順・書式）。Artifact（<manual-test-spec-artifact-url>）の再公開は、親（コントローラー）が `.superpowers/manual-test-spec.html` を同じファイルパスで公開する

- [ ] **Step 6: 全体を検証する**

```bash
npm test 2>&1 | grep -E "Test Files|Tests "
npm run typecheck 2>&1 | tail -n 5
npm run build 2>&1 | tail -n 3
npx eslint $(git diff --name-only main -- '*.ts' '*.tsx' '*.mjs'; git ls-files --others --exclude-standard -- '*.ts' '*.tsx')
npx prettier --check $(git diff --name-only main; git ls-files --others --exclude-standard)
grep -rnP '[\x{200B}\x{FEFF}]' src | head
pgrep -fl "exec sleep 5"
ls "${TMPDIR:-/tmp}" | grep -c prompt-ide-agent-baseline
```

Expected: テストがすべて成功（プラン作成時の写しでは 408 ファイル・7,334 件。適用前の HEAD は 392 ファイル・7,041 件）、型エラー 0、ビルドの成功、eslint の指摘 0、prettier の差分 0、見えない文字 0 件、`sleep` の残り 0、一時ディレクトリの残り 0（テストは `tempRoot` を使うため OS の一時ディレクトリに残さない）

---

## Self-Review

- **要件の網羅**: 設計書の「範囲（含める）」「完了条件」1〜7「状況ごとの扱い」「A の詳細」「変更を戻す」「確認ダイアログの文言」「セキュリティ」「データフロー」「エラー処理」「テスト方針」を、上の網羅表の Task に割り当てた。完了条件の実機の確認は手動テスト仕様の AGC-001（1）・AGC-010（2）・AGC-014・AGC-016（3）・AGC-016（4）・AGC-021（5）・AGC-005（6）・AGC-017（7）。「含めない」の項目は Task 19 の ROADMAP の見送り項目
- **プレースホルダ**: 各 Task のコードと diff は写しのファイルから埋め込んだ。手で書いたのは Task 19 の文書の文面だけ
- **型・名前の一貫性**: `AgentChangesState`・`AgentChangeEntry`・`AgentChangesListResult`・`AgentRevertAllEntry`（Task 1）→ main（Task 4〜8）→ preload・窓口（Task 9）→ `AgentChangesController`・`AgentChangesView`（Task 12）→ `AgentChangesRevertState`（Task 15）→ `AgentChangesSectionProps`・`AgentChangesPanelState`（Task 16・18）→ `AgentDiffActions`（Task 14）・`AgentChangesReviewAction`（Task 17）の順に、後の Task が前の Task の名前をそのまま使うことを、写しの `npm run typecheck` で確かめた
- **安全策**: 入力の検証・送信元のフレーム・所有者の分離（Task 8）、世代と取り消し（Task 4・7）、場所を IPC に出さない（Task 8。`BaselineSnapshot` は main の中だけ）、`wx`（Task 4 の pathspec のファイル）、編集中のタブは確認で承諾したときだけ読み直す（Task 15）を、それぞれのテストと変異で固定した。既存の `git:*`・`agentTerminal:*` の検証は変えていない
- **コマンド**: macOS の zsh で、複数のファイルは直接並べた（変数に入れて渡さない）。`timeout` は使わない。整形は変更したファイルだけ。Python は `python3` のファイルに書いてから実行する（Task 4・10）
- **見えない文字**: プランとコードに U+200B などをそのまま入れていない（既存の `announcementText.ts` のエスケープを使う）
