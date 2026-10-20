# claude 以外のエージェント CLI への対応 段階 1（土台と起動）実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定で使うエージェント CLI（`claude`〈既定〉/ GitHub Copilot CLI〈`copilot`〉）をアプリ全体で 1 つ選べるようにし、main がその種類で CLI を起動する。`copilot` はターミナルで直接操作し、`claude` の画面・引数・hooks に依存する機能（送信・画面の判定とそれに基づく表示と通知・中断・hooks による区別・再開）は能力の表で「使えない」とし、入口ごとに使えない理由を出す。`claude` を選んでいる間の挙動は変えない。

**Architecture:** shared の `src/shared/agentCliKinds.ts` に種類の型 `AgentCliKind` と能力の表 `AGENT_CLI_PROFILES` を置き、main と renderer が同じ表を読む。main は設定（`settings.json` の `agentCliKind`）を `agentCliKindStore.ts` で読み書きし、起動のたびに読んだ種類を起動の計画（`AgentLaunchPlan.cliKind`）に入れて、種類ごとの起動の表（`agentCliLaunchSpecs.ts`。コマンド名・引数・追加で取り除く環境変数）と能力で、探索・引数・環境変数・hooks の準備・再開の拒否・起動の記録を分ける。起動の結果と状態の取得に `cliKind` を載せ、renderer のタブはその値（未起動なら設定の値）で名前と能力を引き、送信・中断・再開の入口の純関数に種類を必須の引数として渡す。設定の画面と切り替え（確認・すべてのタブの停止・保存）は `useAgentWorkspace` が組み立てる。

**Tech Stack:** Electron（main・preload）, React 19, TypeScript, node-pty 1.1.0（偽の実行ファイルの統合テスト）, Vitest（偽の依存・偽の pty・偽のタイマー）, Testing Library, 素の CSS（`main.css`。Tailwind 不使用）

**設計書:** `docs/superpowers/specs/2026-10-20-agent-cli-kind-foundation-design.md`（承認済み。実装の前に必ず読む）。このプランは設計書の「実装の分割」の **タスク 1〜7 のすべて**（タスク 3 を 3a・3b に、タスク 5 を 5a・5b に分けた）。各タスクで読む節はタスクの冒頭に書いた。書き方の参考は `docs/superpowers/plans/2026-10-19-agent-interrupt-ui.md`。

**反映する知見（設計書の「反映した知見」。dev-flow-kit の `lessons/review-lessons.md`）:** L-001・L-017・L-018・L-019・L-029・L-034・L-041・L-043・L-044・L-052・L-058・L-059・L-060・L-061・L-466・L-456・L-459・L-072（各タスクの冒頭の「気をつける知見」に、そのタスクで効くものを書いた）

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
>
> - 設計書のタスク 3 を **Task 3a（起動の表・解決・統合テスト）と Task 3b（starter の能力による分岐・状態の取得・hooks）** に、タスク 5 を **Task 5a（送信の入口）と Task 5b（中断・再開の入口と `起動` の名前）** に分ける。どちらも前半だけを差し戻せる境目にした。
> - **共有の型の変更（Task 1）に追随する一時の値:** `AgentStartResult`・`AgentSessionSnapshotEntry` に `cliKind` が必須になると、main の starter と `agentSessionSnapshot.ts` が型エラーになる。Task 1 では `DEFAULT_AGENT_CLI_KIND` を入れ、行に印のコメント `段階 1 の途中(main)` を付ける。Task 3a・3b で起動の計画の種類に置き換え、Task 3b の検証で `grep -rn "段階 1 の途中(main)" src` が何も出さないことを確かめる。renderer の `useAgentWorkspace` の設定の種類 `appCliKind` は Task 4 で `DEFAULT_AGENT_CLI_KIND` のローカルの定数（印 `段階 1 の途中(renderer)`）にし、Task 6 で設定の hook の値に替える（Task 6 の検証で同じ grep をする）。
> - **型が求める文言を Task 1 で実装する:** `AgentTerminalErrorKind` に `resume-unsupported`、`command-not-found` に `cliKind` を足すと renderer の `describeAgentStartError`（網羅の `switch`）が、`AgentChangesAttributionLostReason` に `cli-unsupported` を足すと `AGENT_CHANGES_ATTRIBUTION_LOST_REASONS`（`Record`）が型エラーになるため、この 3 つの文言は Task 1 で実装する（設計書の分割ではタスク 5）。文字列は設計書の「文言」のとおり。
> - **名前の補い（設計書が名前を決めていないもの）:** preload・renderer の窓口は `getAgentCliKind(): Promise<AgentCliKindSetting>`・`setAgentCliKind(kind: AgentCliKind): Promise<void>`。設計書の `unsupportedCliMessage(commandName)` は `agentPromptSendUnsupportedReason(commandName)`（`lib/agentCliMessages.ts`）、`failureMessage(reason, commandName)` は `agentSendFailureMessage(reason, commandName)`（`lib/agentSendMessages.ts`）。starter が返す種類と会話の ID の組は `AgentSessionInfo`（`agentSessionStarter.ts` が export）。`agentSessionSnapshot.ts` の `attachClaudeSessionIds` は `attachSessionInfo` にする（設計書の「起動の手順」6 にあり、「構成」の表に無い）。
> - **`claudeSessionIdOf` → `sessionInfoOf` の呼び出し元:** 設計書は「呼び出し元は `agentTerminalHandlers.ts` だけ」と書いたが、`ipcHandlers.ts` が starter の関数を受け口へ渡している。`ipcHandlers.ts`・`ipcHandlers.test.ts` も名前を変える。
> - **`起動` の `aria-label` の種類:** 設計書は「設定の種類」とだけ書いた。パネルは `AgentTerminalPanelState` だけを読むため、`AgentTerminalPanelState.appCliKind: AgentCliKind`（必須）を足して渡す（Task 5b。値は Task 6 まで一時の定数）。
> - **通知の注記:** `AgentNotificationPanelState` を `BooleanSettingPanelState` に `unsupportedNote: string | null`（必須）を足した型にし、`BooleanSettingSection` に省略できる `extraNote` を足して `p.settings-panel__note` で出す（`AgentSendConfirmSection` は渡さない）。
> - **ログ:** `getAgentCliKindSetting(log)` の `log` の既定は `console.warn`（CLAUDE.md の「デフォルト引数は関数を直接渡す」）。設定ファイルを読めないときの固定のログは `[agentCliKind] 設定ファイルを読めないため claude を使います`（設計書は「固定の文言」とだけ書いた）。`agentTerminal:getState` で外すときの警告は `[agentTerminal:getState] セッションの種類と会話の ID が見つからないセッションを一覧から外します:` にする（今は「claude のセッション ID が…」）。
> - **保存に成功したら `fallback` を `null` に戻す**（「選び直すと保存します」の注記を消す）。失敗したら `kind` だけを保存の前の値に戻し、`fallback` は変えない。
> - **送信に対応しない送り先への `send`** は、`onSettled`（パネルを開く）を呼んでから `failed`（`unsupported-cli`）を返す（ほかの失敗と同じ。準備・控え・書き込みはしない）。送信前の確認の送れない理由（`targetBlockedReason`）は、確認を開いた時点に控えた送り先の `cliKind`（`pendingSend.target.cliKind`）で求める。
> - **使えない理由の「claude に戻すと」「claude を使っています」** は `AGENT_CLI_PROFILES[DEFAULT_AGENT_CLI_KIND].commandName` から作る（できる文字列は設計書と同じ）。設定の画面の選択肢は `ExecutionModeSection` の class（`execution-mode-section__options`・`execution-mode-section__option`・`--selected`）を使い、CSS を足さない。
> - **統合テストの偽の `copilot`** は `writeFakeExecutable`（`#!/bin/sh` を書き、本文を実行しない warm-up の引数で 1 回起動する）を使わず、`writeFileSync(…, { mode: 0o755 })` で書く（`#!/usr/bin/env node` の本文に warm-up を入れると、引数を空で起動する確かめと混ざるため）。macOS の初回の検査の遅れは `waitForFile` の 10 秒と、テストの打ち切り 20 秒で吸収する。
> - **統合テストのログインシェルの PATH の偽物** は、設計書の「`process.execPath` のディレクトリ」ではなく、`node`（`process.execPath` へのシンボリックリンク）だけを置いた一時ディレクトリを返す（nvm では `process.execPath` のディレクトリに実物の `copilot` があり、PATH に入れないため）。さらに起動の前に、解決された `file` が偽の `copilot` のパスと一致しなければ起動せずに投げる。

## Global Constraints

- コメント・文言・ログは日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。クライアントのコンポーネントには `'use client'`。`any` を使わない。テストの補助関数にも戻り値の型を書く（`@typescript-eslint/explicit-function-return-type`）
- **コミット・プッシュはしない**（CLAUDE.md。利用者の明示の指示があるまで行わず、後の工程でまとめて行う）。各タスクの最後の Step は「検証」
- **実物の `copilot` は起動しない。** 統合テストは偽の実行ファイル（`#!/usr/bin/env node` のスクリプト）で行う。テストは利用者の `~/.gitconfig`・`~/.copilot`・`~/.claude` に書かない（`HOME` は一時ディレクトリ。`process.env` を書き換えない）。実機（Electron）の確認は利用者がまとめて行う（Task 7 で実機テスト仕様書に追記する）。プランに実機の手順は書かない
- 各タスクの終わりで次が通る状態を保つ: `npx vitest run`（全テスト）・`npm run typecheck`・変更・作成した TypeScript のファイルへの `npx eslint --max-warnings 0 <ファイル>` と `npx prettier --check <ファイル>`（`npx eslint --fix`・`npx prettier --write` で直してから確かめてよい）。型を変えるタスクは、型に追随する呼び出し元・テストの補助・既存のテストを同じタスクで直す
- **このマシンは負荷が高く、`npx vitest run` の全体でテストが時間切れ（`Test timed out`・`waitFor` の打ち切り）で落ちることがある。** 落ちたら、落ちたファイルを `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書いて先へ進む。単体でも落ちれば本当の失敗として直す
- **シェルで `path` を変数名に使わない**（zsh では `path` が `PATH` と結び付いた配列で、代入すると `PATH` が壊れる）。**シェルの変数は Bash の呼び出しをまたいで残らない。** コードブロックごとに先頭で設定し直し、`test -f`・`test -d` で存在を確かめる
- `ROADMAP.md` は prettier にかけない（今も prettier の書式に揃っていないため、かけると無関係な差分が出る）。`src/renderer/src/lib/__tests__/fixtures/agentScreens.json` も整形しない（`.prettierignore` 済み）
- 「変異で確かめる」の Step は、書いた実装の一部を一時的に戻して該当のテストが落ちることを確かめ、必ず元に戻す（戻したことを `git diff` で確かめる）。`act(...).then(...)` の形でテストを書かない。`console.*` の spy と `vi.spyOn(window.api, …)` は `afterEach`（か `finally`）で戻す。偽のタイマーを使うテストは `afterEach` で `vi.clearAllTimers()`・`vi.useRealTimers()` を呼ぶ
- 能力の参照は `if (capabilities.x)` の肯定の形（`agentCliCapabilities(kind).x`）で書き、`kind !== 'claude'` のような否定の名指しにしない（種類を足したときに許可側へ倒れない）。種類・能力の引数は省略できない形にする（省略で `claude` に倒れない。L-060）

### 設計書の決めたこと（利用者の確認済み。一字一句）

- **最初に対応する CLI**: GitHub Copilot CLI（`copilot`）。このマシンでは `$HOME/.nvm/versions/node/<version>/bin/copilot`（nvm の下の node スクリプト。GUI の PATH では見つからない可能性がある。`.superpowers/agent-terminal-mvp/collision-report.md:125-126`）
- **起動するコマンド**: 既知の CLI から選ぶだけ。コマンドの名前・引数・取り除く環境変数は main が持つ許可リスト（CLI の種類ごとの表）で決め、renderer から任意のコマンドを起動させない（MVP の方針。L-019・L-034）
- **今回の範囲**: 土台と起動まで: CLI の種類の型と能力の表（shared）、設定（`settings.json` に保存。既定は `claude`）と設定の画面、main の起動の差し替え。`claude` は今までどおり動く。`copilot` はタブで起動して手で操作できるが、実行ボタンでの送信・画面の判定（作業中などの表示・通知・中断・自動の取り直し）・hooks（エージェントの変更の区別）・前回の続きからは能力の表で「使えない」とし、使えない理由を出す
- **選ぶ単位**: アプリ全体で 1 つ（タブごとには選ばない）

### 設計書の決めたこと（推奨案で決めた事項。一字一句）

- **型の名前と置き場**: `AgentCliKind = 'claude' | 'copilot'` と能力の表 `AGENT_CLI_PROFILES: Record<AgentCliKind, AgentCliProfile>` を `src/shared/agentCliKinds.ts`（新規）に置く。main（起動・hooks・再開の拒否）と renderer（入口の判定・文言）が同じ表を読む。従来の方式の `PromptToolId`（`src/shared/types/cli.ts`。`copilot` は `gh copilot -p`）とは別の型にする（従来の方式は非対話の 1 回の実行で、能力の意味が違うため）
- **能力の項目**: `promptSend`（実行ボタン・履歴の再実行・送信前の確認からの送信）・`screenActivity`（画面からの活動の判定と、それに基づく帯・タブ・ステータスバーの表示・通知・自動の取り直し・hooks への作業中の知らせ）・`interrupt`（帯の `中断`）・`changeAttribution`（hooks によるエージェントの変更の区別）・`sessionResume`（前回の続きから・このセッションで再開・起動の記録）の 5 つ。`claude` はすべて `true`、`copilot` はすべて `false`
- **未知の値の扱い**: `settings.json` の `agentCliKind` が無いときは既定の `claude`。値が壊れている（知らない文字列・文字列以外）・ファイルを読めないときも `claude` に戻すが、黙って流さない（L-044）: main のログに記録し、設定の画面に「保存されていた値を読めなかったため claude を使っています」を出す。保存（renderer からの IPC）では知らない値を投げて拒否し、`claude` に倒さない
- **起動に使う種類の決め方**: main が起動のたびに `settings.json` を読んで決める（renderer は起動の依頼に種類を含めない。L-019）。読んだ値を起動の計画（`AgentLaunchPlan.cliKind`）に入れ、その後の手順（コマンドの探索・引数・環境変数・hooks・再開の可否・記録）はすべてその値を使い、別の場所で読み直さない（L-018）。起動の結果に `cliKind` を載せ、renderer のタブはその値で能力を引く
- **切り替えの時機**: 実行方式の切り替え（`useAgentWorkspace.selectExecutionMode`）に倣う。起動中・実行中のタブがあれば確認のダイアログ（`使う CLI を切り替えると、動いているエージェントをすべて終了します。切り替えますか？`）を出し、OK ならすべてのタブを止めてから保存する。止められなかったタブがあれば保存しない。切り替えの途中は起動・`+`・前回の続きからを押せない。保存した値は次の起動から使われる（main が起動のたびに読むため。L-466）
- **画面の判定の止め方**: `copilot` のタブは判定そのものを止める（`useAgentActivity` が購読しない・活動を記録しない）。常に `unknown` を返す判定に差し替えるのではなく、購読を張らない。記録の無いタブは各機能が `unknown` として扱う既存の規則（`useAgentInterrupt` の「未記録のタブは `unknown`」など）に乗り、作業中・許可待ちに基づく通知・自動の取り直し・hooks への作業中の知らせは起きない
- **使えない理由の出し方**: 入口ごとに、既存の押せない理由の経路（実行ボタンの理由・中断の `aria-describedby` と `title`・前回の続きからの理由・履歴の再開の理由・区別の状態の 1 行）に理由を足す。見た目だけ無効にせず、処理の側でも同じ判定で止める（L-058）。設定の画面には、選んだ CLI で使えない機能の一覧を出す（「renderer の使えない理由の出し方」）
- **文言のうち今回直すもの**: タブの名前（`claude 1` → CLI のコマンド名から `copilot 1`）、`起動` の `aria-label`、「コマンドが見つかりません」の文言（CLI ごと）、設定の画面の実行方式の選択肢（`Claude Code を動かす` → `エージェント CLI を動かす`）。中断・前回の続きから・変更の区別などの `claude` と書く文言は、`copilot` では使えない機能のものなので次の段階に回す（「文言」）
- **起動の記録・履歴に CLI の種類を足すか**: 今回は足さない。`copilot` のセッションは起動の記録（`agent-sessions.json`）に書かず、前回の続きからにも出さない。`copilot` では送信が使えないため、履歴（`HistoryEntry.agent`）に `copilot` のエントリは作られない。種類を足すのは再開・送信に対応する次の段階で、そのとき古い記録・エントリ（種類の無いもの）は `claude` として読み、ほかの欄は書き換えない（L-456・L-459。「記録と履歴」）
- **取り除く環境変数**: 今の一覧（`REMOVED_AGENT_ENV_KEYS`・`REMOVED_AGENT_ENV_PREFIXES`）はすべての CLI で取り除く。`copilot` だけ `COPILOT_ALLOW_ALL` を足して取り除く（アプリが起動した CLI の許可を自動で全部にしない。`claude` に `--dangerously-skip-permissions` を付けないのと同じ方針。「copilot の調べた事実」4）
- **`copilot` の引数**: 空（`copilot` を引数なしで起動すると対話のセッションになる）。作業ディレクトリは pty の `cwd`（許可のフォルダ）で決め、`-C` は使わない。`--session-id`・`--resume`・`--allow-*`・`--yolo` などは付けない
- **`copilot` の版の確認**: しない。版で変わる能力がまだ無いため（hooks を使わない）。版の表示形式は調べた事実として残し、次の段階で使う
- **中断の IPC の main での拒否**: しない。`agentTerminal:interrupt` が書く `\x1b` は、ターミナルのキー入力（`agentTerminal:write`）でも同じバイトを送れるため、権限の境界ではない。renderer の判定（押せない理由と、押した処理の先頭の判定）で止める

### 能力の表と起動の表（一字一句。設計書「型と能力の表」「起動の表」）

| 種類      | `displayName`        | `commandName` | 能力（5 つ）   | 引数                                                                                                                                                                            | 取り除く環境変数（共通の一覧に足すもの） |
| --------- | -------------------- | ------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `claude`  | `Claude Code`        | `claude`      | すべて `true`  | 今の `buildAgentLaunchArgs`（`new` は `--session-id <ID>`、`resume` は `--resume <ID>`、`hookSettingsPath` があれば `--settings <path>`）。`claudeSessionId` が null なら投げる | なし                                     |
| `copilot` | `GitHub Copilot CLI` | `copilot`     | すべて `false` | `new` は `[]`。`resume` は投げる（starter が先に `resume-unsupported` で断るので届かない）。`claudeSessionId`・`hookSettingsPath` が null でなければ投げる                      | `COPILOT_ALLOW_ALL`                      |

- 能力の表の並び: `promptSend`・`screenActivity`・`interrupt`・`changeAttribution`・`sessionResume`（`interrupt` が真なら `screenActivity` も真）
- `COPILOT_GITHUB_TOKEN`・`GH_TOKEN`・`GITHUB_TOKEN` は取り除かない（利用者の認証の設定）
- 設定の既定 `DEFAULT_AGENT_CLI_KIND = 'claude'`。読み込みの結果 `AgentCliKindSetting = { kind: AgentCliKind; fallback: null | 'invalid-value' | 'read-failed' }`（キーが無い → `fallback: null`、`isAgentCliKind` に当たらない値 → `invalid-value`、`readSettingsFile` が投げた・読んだ値が普通のオブジェクトでない → `read-failed`）

### 文言（一字一句。実機テスト仕様書もこの文字列で書く）

- 設定の見出し: `使うエージェント CLI`／説明: `エージェント CLI 方式で使います。切り替えると、次の起動から使われます`／選択肢: `Claude Code（claude）`・`GitHub Copilot CLI（copilot）`
- 使えない機能（選んだ CLI）: `copilot では次の機能を使えません（ターミナルで直接操作します）: プロンプトの送信（実行・再実行）、作業中・入力待ちの表示と通知、中断、利用者の変更との区別、前回の続きから・このセッションで再開`（能力の名前: `promptSend` → `プロンプトの送信（実行・再実行）`、`screenActivity` → `作業中・入力待ちの表示と通知`、`interrupt` → `中断`、`changeAttribution` → `利用者の変更との区別`、`sessionResume` → `前回の続きから・このセッションで再開`）
- 既定に戻した旨: `invalid-value` → `保存されていた値を読めなかったため claude を使っています（選び直すと保存します）`、`read-failed` → `設定ファイルを読めなかったため claude を使っています`
- 選べない理由（起動中）: `エージェントの起動中は、使う CLI を切り替えられません`
- 保存の失敗の接頭辞: `使うエージェント CLI を保存できませんでした: `
- 切り替えの確認: `使う CLI を切り替えると、動いているエージェントをすべて終了します。切り替えますか？`（`AGENT_STOP_ON_CLI_KIND_CHANGE_CONFIRM`。`lib/agentSessionMessages.ts`）
- 切り替えの途中の起動の理由: `使うエージェント CLI を切り替えています`（`AGENT_START_DISABLED_SWITCHING_CLI_KIND`）。実行方式は今の `実行方式を切り替えています`
- 通知の注記: `copilot では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）`
- 実行・再実行・送信前の確認の理由と `unsupported-cli` の文言: `copilot へのプロンプトの送信には、まだ対応していません（ターミナルに直接入力してください）`
- 中断の理由: `copilot では中断のボタンを使えません（ターミナルで操作してください）`（判定の順は `starting` の直後）
- 前回の続きからの理由: `copilot では「前回の続きから」を使えません（設定で claude に戻すと使えます）`（判定の順は起動の理由の直後）
- このセッションで再開の理由: `copilot では「このセッションで再開」を使えません（設定で claude に戻すと使えます）`（判定の順は実行方式の判定の直後）
- 区別の理由: `'cli-unsupported': '使っているエージェント CLI が区別に対応していません（claude だけが対応しています）'`
- 見つからない: `${commandName} コマンドが見つかりません。${displayName} をインストールしてください（探した場所: ログインシェルの PATH）`（PATH を取れなかった旨の添え書き `（ログインシェルから PATH を取得できなかったため、既定の場所だけを探しました）` は今のまま）
- 再開の拒否: `使っているエージェント CLI は、セッションの再開に対応していません`
- タブの名前: `${commandName} ${number}`（`claude 1`・`copilot 1`）
- `起動` の `aria-label`: `起動（開いているフォルダで ${commandName} を起動）`
- 実行方式の選択肢: `エージェント CLI（アプリ内のターミナルでエージェント CLI を動かす）`
- 保存の拒否（main）: `使うエージェント CLI が不正です`（値を文言に入れない）
- ログ（main）: `[agentCliKind] 保存されていた値を読めないため claude を使います: <JSON.stringify(値) の先頭 80 文字>`・`[agentCliKind] 設定ファイルを読めないため claude を使います`

### 型・関数の名前（後のタスクはこの名前と型で使う）

- shared（Task 1）: `src/shared/agentCliKinds.ts` の `AGENT_CLI_KINDS`・`AgentCliKind`・`DEFAULT_AGENT_CLI_KIND`・`isAgentCliKind(value: unknown): value is AgentCliKind`・`AgentCliCapabilities`・`AgentCliProfile`・`AGENT_CLI_PROFILES`・`agentCliCapabilities(kind): AgentCliCapabilities`。`src/shared/types/agentTerminal.ts` の `'resume-unsupported'`・`AgentStartResult`（`started`・`already-running` に `cliKind`・`claudeSessionId: string | null`、`command-not-found` の組に `cliKind`・`shellPathUnavailable: boolean`）・`AgentSessionSnapshotEntry.cliKind`・`claudeSessionId: string | null`。`src/shared/types/agentChanges.ts` の `'cli-unsupported'`。`src/shared/types/settings.ts` の `AgentCliKindSetting`
- renderer の文言（Task 1）: `AGENT_RESUME_UNSUPPORTED`（`lib/agentSessionMessages.ts`）
- main（Task 2）: `getAgentCliKindSetting(log?: (message: string) => void): Promise<AgentCliKindSetting>`・`setAgentCliKind(kind: unknown): Promise<void>`・`AGENT_CLI_KIND_LOG_VALUE_MAX_LENGTH = 80`・`AGENT_CLI_KIND_INVALID_ERROR`（`agentCliKindStore.ts`）、`SettingsFile.agentCliKind?: string`、IPC `'settings:getAgentCliKind'`・`'settings:setAgentCliKind'`
- preload・renderer の窓口（Task 2）: `getAgentCliKind(): Promise<AgentCliKindSetting>`・`setAgentCliKind(kind: AgentCliKind): Promise<void>`（`api.ts`・`index.d.ts`・`lib/settingsApi.ts`）
- main（Task 3a）: `AgentCliLaunchSpec`・`AGENT_CLI_LAUNCH_SPECS`（`agentCliLaunchSpecs.ts`）、`ResolveAgentLaunchDeps.cliKind`・`AgentLaunchPlan.cliKind`・`AgentLaunchResolution` の `not-found` の `cliKind`・`buildAgentEnv(base, pathValue, platform, extraRemovedKeys)`（4 つとも必須）。`AGENT_COMMAND_NAME`・`buildAgentLaunchArgs` は消す
- main（Task 3b）: `AgentSessionInfo = { cliKind: AgentCliKind; claudeSessionId: string | null }`・`AgentSessionStarterService.sessionInfoOf(sessionId): AgentSessionInfo | undefined`（`claudeSessionIdOf` を置き換える）・`attachSessionInfo(entries, sessionInfoOf)`（`agentSessionSnapshot.ts`）・`AgentTerminalHandlerDeps.sessionInfoOf`・`AgentHooksUnavailableReason` の `'cli-unsupported'`
- shared・renderer（Task 4）: `formatAgentTabLabel(number: number, kind: AgentCliKind): string`・`AgentTabSessionFields.cliKind: AgentCliKind | null`・`AgentSessionTabView.cliKind: AgentCliKind`・`UseAgentSessionsOptions.appCliKind: AgentCliKind`（必須）・`AgentActivityTab.cliKind: AgentCliKind`
- renderer（Task 5a）: `lib/agentCliMessages.ts` の `AGENT_CLI_CAPABILITY_NAMES`・`AGENT_CLI_KIND_SECTION_TITLE`・`AGENT_CLI_KIND_SECTION_NOTE`・`agentCliKindOptionLabel(kind)`・`agentCliUnsupportedFeaturesNote(kind): string | null`・`agentCliFallbackNote(fallback): string | null`・`AGENT_CLI_KIND_LOCKED_WHILE_STARTING`・`AGENT_CLI_KIND_SAVE_ERROR_PREFIX`・`agentPromptSendUnsupportedReason(commandName)`・`agentInterruptUnsupportedReason(commandName)`・`agentResumeLastUnsupportedReason(commandName)`・`agentResumeEntryUnsupportedReason(commandName)`・`agentNotificationUnsupportedNote(kind): string | null`。`AgentSendFailure` の `'unsupported-cli'`・`AGENT_SEND_FAILURE_MESSAGES: Record<Exclude<AgentSendFailure, 'unsupported-cli'>, string>`・`agentSendFailureMessage(reason, commandName)`。`getPromptRunAvailability`・`getHistoryRerunAvailability`・`PromptRunStateInput` の `cliKind: AgentCliKind`（必須）。`AgentSendTarget.cliKind: AgentCliKind`（必須。`hooks/useAgentPromptSender.ts`）
- renderer（Task 5b）: `AgentInterruptAvailabilityInput.cliKind`・`AgentInterruptTab` の `cliKind`、`getResumeLastDisabledReason`・`getResumeEntryDisabledReason` の `appCliKind`・`UseAgentResumeOptions.appCliKind`（必須）、`agentStartAriaLabel(commandName)`（`lib/agentSessionMessages.ts`）、`AgentTerminalPanelState.appCliKind: AgentCliKind`（必須）
- renderer（Task 6）: `AGENT_STOP_ON_CLI_KIND_CHANGE_CONFIRM`・`AGENT_START_DISABLED_SWITCHING_CLI_KIND`（`lib/agentSessionMessages.ts`）、`useAgentCliKind(): AgentCliKindState`（`kind: AgentCliKind | null`・`fallback`・`saveError`・`changeKind(next): Promise<boolean>`）、`AgentCliKindPanelState`（`types.ts`）・`AgentNotificationPanelState.unsupportedNote`、`AgentCliKindSection`、`AgentWorkspaceState.agentCliKindPanel`（必須）、`SettingsPanel`・`Sidebar` の `agentCliKind`（必須）、`useAppState` の `agentCliKindPanel`
- テストの補助: `makeAgentSessionTabView` の `cliKind`（既定 `'claude'`。名前は上書きの `number`・`cliKind` から作る。Task 4）、`makeAgentTerminalPanelState` の `appCliKind`（既定 `'claude'`。Task 5b）、`makeAgentWorkspaceState` の `agentCliKindPanel`・`agentNotificationPanel.unsupportedNote`（Task 6）、テストの既定の `window.api`（`src/renderer/src/__tests__/setup.ts`）の `getAgentCliKind`・`setAgentCliKind`（Task 2）

### ファイルの構成（作る・変えるもの）

| ファイル                                                                                                                                                                                                                                                                                          | 責務                                                                              | タスク    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------- |
| `src/shared/agentCliKinds.ts`（新規）・`src/shared/types/agentTerminal.ts`・`agentChanges.ts`・`settings.ts`・`src/shared/types.ts`                                                                                                                                                               | 種類・能力の表・起動の結果の型・区別の理由・設定の型                              | 1         |
| `src/main/agentSessionStarter.ts`・`src/main/agentSessionSnapshot.ts`                                                                                                                                                                                                                             | 型への追随（Task 1 は一時の値、3a・3b で本実装）・能力による分岐・`sessionInfoOf` | 1・3a・3b |
| `src/renderer/src/lib/agentSessionMessages.ts`                                                                                                                                                                                                                                                    | `command-not-found`・`resume-unsupported`・`起動` の名前・切り替えの文言          | 1・5b・6  |
| `src/renderer/src/lib/agentChangesMessages.ts`                                                                                                                                                                                                                                                    | `cli-unsupported` の理由                                                          | 1         |
| `src/main/agentCliKindStore.ts`（新規）・`src/main/settingsFileStore.ts`・`src/main/handlers/settingsHandlers.ts`                                                                                                                                                                                 | 設定の読み書きと IPC                                                              | 2         |
| `src/preload/api.ts`・`src/preload/index.d.ts`・`src/renderer/src/lib/settingsApi.ts`・`src/renderer/src/__tests__/setup.ts`                                                                                                                                                                      | 設定の窓口・テストの既定                                                          | 2         |
| `src/main/agentCliLaunchSpecs.ts`（新規）・`src/main/agentCommand.ts`・`src/main/agentRuntime.ts`                                                                                                                                                                                                 | 種類ごとの起動の表・解決・起動のたびの設定の読み込み                              | 3a        |
| `src/main/handlers/agentTerminalHandlers.ts`・`src/main/ipcHandlers.ts`・`src/main/agentHookSessions.ts`・`src/main/agentToolActivity.ts`                                                                                                                                                         | 状態の取得の種類・`cli-unsupported`                                               | 3b        |
| `src/shared/agentTabLabel.ts`・`src/shared/agentNotificationText.ts`・`src/renderer/src/lib/agentSessionTabState.ts`・`hooks/useAgentSessions.ts`・`hooks/useAgentActivity.ts`                                                                                                                    | タブの種類と名前・判定を止める                                                    | 4         |
| `src/renderer/src/lib/agentCliMessages.ts`（新規）・`lib/agentPromptSend.ts`・`lib/agentSendMessages.ts`・`lib/promptRunState.ts`・`hooks/useAgentPromptSender.ts`・`hooks/useAgentSendConfirm.ts`                                                                                                | 使えない理由の文言・送信の入口                                                    | 5a        |
| `src/renderer/src/lib/agentInterrupt.ts`・`hooks/useAgentInterrupt.ts`・`lib/agentResumeAvailability.ts`・`hooks/useAgentResume.ts`・`components/agent/AgentTerminalPanel.tsx`                                                                                                                    | 中断・再開の入口・`起動` の名前                                                   | 5b        |
| `src/renderer/src/hooks/useAgentCliKind.ts`（新規）・`components/settings/AgentCliKindSection.tsx`（新規）・`SettingsPanel.tsx`・`AgentNotificationSection.tsx`・`BooleanSettingSection.tsx`・`ExecutionModeSection.tsx`・`types.ts`・`components/Sidebar.tsx`・`App.tsx`・`hooks/useAppState.ts` | 設定の hook と画面・配線                                                          | 6         |
| `src/renderer/src/hooks/useAgentWorkspace.ts`                                                                                                                                                                                                                                                     | 種類の受け渡し（4・5a・5b）・設定の保持と切り替え（6）                            | 4〜6      |
| `ROADMAP.md`・`docs/manual-test-spec.md`（と生成物 `.superpowers/manual-test-spec.html`）・設計書                                                                                                                                                                                                 | ROADMAP の更新・AGT-228〜240・BASE-007・既知の制約の照合                          | 7         |

---

### Task 1: shared の型と能力の表（と型に追随する呼び出し）

> **設計書の読む節:** 「決めたこと（推奨案）」の型の名前・能力の項目、「型と能力の表」（コードと箇条書きのすべて）、「設定」の `AgentCliKindSetting`、「hooks」の `AgentChangesAttributionLostReason`、「文言」の見つからない・再開の拒否、「テスト方針」の shared。
>
> **気をつける知見:** L-034（`commandName` は `-` で始まらない英小文字であることをテストで固定する）・L-044（`command-not-found` の組は `cliKind` を必須にし、省略で `claude` の文言に流さない）・L-060（種類を省略できない型にする）

**Files:**

- Create: `src/shared/agentCliKinds.ts`・`src/shared/__tests__/agentCliKinds.test.ts`
- Modify: `src/shared/types/agentTerminal.ts`・`src/shared/types/agentChanges.ts`・`src/shared/types/settings.ts`・`src/shared/types.ts`
- Modify（型への追随）: `src/main/agentSessionStarter.ts`・`src/main/agentSessionSnapshot.ts`・`src/renderer/src/lib/agentSessionMessages.ts`・`src/renderer/src/lib/agentChangesMessages.ts`
- Test（追随）: `src/shared/__tests__/agentTerminal.test.ts`・`src/main/__tests__/agentSessionStarter.test.ts`・`src/main/__tests__/agentSessionRegistry.test.ts`・`src/main/__tests__/agentSessionSnapshot.test.ts`・`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`・`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`・`src/renderer/src/lib/__tests__/agentChangesMessages.test.ts`・`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`・`src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx`・`src/renderer/src/components/__tests__/App.agentReferences.test.tsx`

**Interfaces:**

- Consumes: なし
- Produces（後のタスクはこの名前と型で使う）:

```ts
// src/shared/agentCliKinds.ts(設計書「型と能力の表」のコードそのまま)
export const AGENT_CLI_KINDS = ['claude', 'copilot'] as const
export type AgentCliKind = (typeof AGENT_CLI_KINDS)[number]
export const DEFAULT_AGENT_CLI_KIND: AgentCliKind = 'claude'
export function isAgentCliKind(value: unknown): value is AgentCliKind
export interface AgentCliCapabilities {
  promptSend: boolean
  screenActivity: boolean
  interrupt: boolean
  changeAttribution: boolean
  sessionResume: boolean
}
export interface AgentCliProfile {
  kind: AgentCliKind
  displayName: string
  commandName: string
  capabilities: AgentCliCapabilities
}
export const AGENT_CLI_PROFILES: Record<AgentCliKind, AgentCliProfile>
export function agentCliCapabilities(kind: AgentCliKind): AgentCliCapabilities
// src/shared/types/settings.ts
export type AgentCliKindSetting = {
  kind: AgentCliKind
  fallback: null | 'invalid-value' | 'read-failed'
}
// src/renderer/src/lib/agentSessionMessages.ts
export const AGENT_RESUME_UNSUPPORTED =
  '使っているエージェント CLI は、セッションの再開に対応していません'
```

- [ ] **Step 1: 失敗するテストを書く（種類と能力の表）**

`src/shared/__tests__/agentCliKinds.test.ts` を作る:

```ts
import { describe, it, expect } from 'vitest'
import {
  AGENT_CLI_KINDS,
  AGENT_CLI_PROFILES,
  DEFAULT_AGENT_CLI_KIND,
  agentCliCapabilities,
  isAgentCliKind
} from '../agentCliKinds'
import type { AgentCliCapabilities } from '../agentCliKinds'

// 能力の項目(設計書「能力の項目」の 5 つ)。足したときは renderer の能力の名前の表(agentCliMessages.ts)も足す
const CAPABILITY_KEYS: readonly (keyof AgentCliCapabilities)[] = [
  'promptSend',
  'screenActivity',
  'interrupt',
  'changeAttribution',
  'sessionResume'
]

describe('isAgentCliKind', () => {
  it.each(['claude', 'copilot'])('%s は種類', (value) => {
    expect(isAgentCliKind(value)).toBe(true)
  })

  it.each(['Claude', '', 'codex', ' claude', 'gh copilot', 1, null, undefined, {}, ['claude']])(
    '%o は種類でない',
    (value) => {
      expect(isAgentCliKind(value)).toBe(false)
    }
  )
})

describe('AGENT_CLI_PROFILES', () => {
  it('既定は claude', () => {
    expect(DEFAULT_AGENT_CLI_KIND).toBe('claude')
  })

  it('種類の一覧のすべてに表があり、表の kind はキーと同じ', () => {
    expect(Object.keys(AGENT_CLI_PROFILES).sort()).toEqual([...AGENT_CLI_KINDS].sort())
    for (const kind of AGENT_CLI_KINDS) expect(AGENT_CLI_PROFILES[kind].kind).toBe(kind)
  })

  it('表示名とコマンド名', () => {
    expect(AGENT_CLI_PROFILES.claude).toMatchObject({
      displayName: 'Claude Code',
      commandName: 'claude'
    })
    expect(AGENT_CLI_PROFILES.copilot).toMatchObject({
      displayName: 'GitHub Copilot CLI',
      commandName: 'copilot'
    })
  })

  it('claude の能力はすべて真、copilot はすべて偽', () => {
    expect(agentCliCapabilities('claude')).toEqual({
      promptSend: true,
      screenActivity: true,
      interrupt: true,
      changeAttribution: true,
      sessionResume: true
    })
    expect(agentCliCapabilities('copilot')).toEqual({
      promptSend: false,
      screenActivity: false,
      interrupt: false,
      changeAttribution: false,
      sessionResume: false
    })
  })

  it.each(AGENT_CLI_KINDS)('%s の能力の項目は 5 つ', (kind) => {
    expect(Object.keys(agentCliCapabilities(kind)).sort()).toEqual([...CAPABILITY_KEYS].sort())
  })

  // 中断を押せる条件は画面の判定の working なので、中断だけ真で判定が偽の種類は作れない
  it.each(AGENT_CLI_KINDS)('%s: interrupt が真なら screenActivity も真', (kind) => {
    const capabilities = agentCliCapabilities(kind)
    expect(!capabilities.interrupt || capabilities.screenActivity).toBe(true)
  })

  // 引数として解釈されない名前(L-034)。main はこの名前で PATH を探す
  it.each(AGENT_CLI_KINDS)('%s: commandName は - で始まらない英小文字だけ', (kind) => {
    expect(AGENT_CLI_PROFILES[kind].commandName).toMatch(/^[a-z]+$/)
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（renderer の文言）**

`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts` の import に `AGENT_RESUME_UNSUPPORTED` を足し、末尾に次を足す:

```ts
describe('起動の失敗の文言(CLI の種類・再開の拒否)', () => {
  const NOT_FOUND_SUFFIX = '（探した場所: ログインシェルの PATH）'
  const PATH_UNAVAILABLE =
    '（ログインシェルから PATH を取得できなかったため、既定の場所だけを探しました）'
  it.each([
    [
      'claude',
      false,
      `claude コマンドが見つかりません。Claude Code をインストールしてください${NOT_FOUND_SUFFIX}`
    ],
    [
      'copilot',
      false,
      `copilot コマンドが見つかりません。GitHub Copilot CLI をインストールしてください${NOT_FOUND_SUFFIX}`
    ],
    [
      'copilot',
      true,
      `copilot コマンドが見つかりません。GitHub Copilot CLI をインストールしてください${NOT_FOUND_SUFFIX}${PATH_UNAVAILABLE}`
    ]
  ] as const)(
    'command-not-found は結果の種類のコマンド名と表示名で出す(%s・PATH を取れなかった %s)',
    (cliKind, shellPathUnavailable, message) => {
      expect(
        describeAgentStartError({
          kind: 'error',
          error: 'command-not-found',
          cliKind,
          shellPathUnavailable
        })
      ).toBe(message)
    }
  )

  it('resume-unsupported', () => {
    expect(AGENT_RESUME_UNSUPPORTED).toBe(
      '使っているエージェント CLI は、セッションの再開に対応していません'
    )
    expect(describeAgentStartError({ kind: 'error', error: 'resume-unsupported' })).toBe(
      AGENT_RESUME_UNSUPPORTED
    )
  })
})
```

`src/renderer/src/lib/__tests__/agentChangesMessages.test.ts` の `区別をやめた理由の文言は 4 つの理由を網羅する` を次に置き換える:

```ts
it('区別をやめた理由の文言は 5 つの理由を網羅する', () => {
  expect(AGENT_CHANGES_ATTRIBUTION_LOST_REASONS).toEqual({
    'hooks-not-confirmed': 'claude の hooks から知らせが届きません',
    'receiver-unavailable': 'hooks の知らせの受け口を用意できませんでした',
    'claude-version-unsupported': 'claude の版が古いか、版を確かめられませんでした',
    'checkpoint-failed': '作業ツリーの記録に失敗しました',
    'cli-unsupported':
      '使っているエージェント CLI が区別に対応していません（claude だけが対応しています）'
  })
})
```

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/shared/__tests__/agentCliKinds.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/lib/__tests__/agentChangesMessages.test.ts`
Expected: FAIL（`agentCliKinds` が無い・`AGENT_RESUME_UNSUPPORTED` が無い・`cli-unsupported` が無い）

- [ ] **Step 4: shared の型を実装する**

`src/shared/agentCliKinds.ts` を作る（設計書「型と能力の表」のコードそのまま。冒頭に次の 1 行のコメントを置く）:

```ts
// エージェント CLI 方式で起動する CLI の種類と、CLI ごとに使えるアプリの機能の表(設計書 2026-10-20「型と能力の表」)。
// main(起動・hooks・再開の拒否)と renderer(入口の判定・文言)が同じ表を読む。従来の方式の PromptToolId とは別の型

/** エージェント CLI 方式で起動する CLI の種類。main の起動の表と renderer の入口の判定が同じ値を使う */
export const AGENT_CLI_KINDS = ['claude', 'copilot'] as const
export type AgentCliKind = (typeof AGENT_CLI_KINDS)[number]
export const DEFAULT_AGENT_CLI_KIND: AgentCliKind = 'claude'

export function isAgentCliKind(value: unknown): value is AgentCliKind {
  return typeof value === 'string' && (AGENT_CLI_KINDS as readonly string[]).includes(value)
}

/** CLI ごとに、アプリの機能が使えるか(claude の画面・引数・hooks に依存する機能) */
export interface AgentCliCapabilities {
  /** 実行ボタン・履歴の再実行・送信前の確認からの送信(入力欄の判定・消去・貼り付け) */
  promptSend: boolean
  /** 画面からの活動の判定と、それに基づく表示・完了と許可待ちの通知・変更の一覧の自動の取り直し・hooks への作業中の知らせ */
  screenActivity: boolean
  /** 帯の中断(Esc を 1 回)。押せる条件が screenActivity の working なので、true なら screenActivity も true */
  interrupt: boolean
  /** hooks によるエージェントの変更と利用者の変更の区別 */
  changeAttribution: boolean
  /** 前回の続きから・このセッションで再開・起動の記録(agent-sessions.json)・会話の ID の予約 */
  sessionResume: boolean
}

export interface AgentCliProfile {
  kind: AgentCliKind
  /** 設定の画面の名前(Claude Code / GitHub Copilot CLI) */
  displayName: string
  /** 起動するコマンドの名前(main の探索に使う)。タブの名前・文言にも使う */
  commandName: string
  capabilities: AgentCliCapabilities
}

export const AGENT_CLI_PROFILES: Record<AgentCliKind, AgentCliProfile> = {
  claude: {
    kind: 'claude',
    displayName: 'Claude Code',
    commandName: 'claude',
    capabilities: {
      promptSend: true,
      screenActivity: true,
      interrupt: true,
      changeAttribution: true,
      sessionResume: true
    }
  },
  copilot: {
    kind: 'copilot',
    displayName: 'GitHub Copilot CLI',
    commandName: 'copilot',
    capabilities: {
      promptSend: false,
      screenActivity: false,
      interrupt: false,
      changeAttribution: false,
      sessionResume: false
    }
  }
}

export function agentCliCapabilities(kind: AgentCliKind): AgentCliCapabilities {
  return AGENT_CLI_PROFILES[kind].capabilities
}
```

`src/shared/types/agentTerminal.ts`:

1. 先頭のコメントの次に `import type { AgentCliKind } from '../agentCliKinds'` を足す
2. `AgentTerminalErrorKind` の末尾（`'session-in-use'` の後）に次を足す:

```ts
  /** 再開の依頼だが、使う CLI が再開に対応していない(main の能力の表) */
  | 'resume-unsupported'
```

3. `AgentStartResult` を次に置き換える（設計書「型と能力の表」の共有の型の変更のとおり）:

```ts
export type AgentStartResult =
  | {
      kind: 'started' | 'already-running'
      sessionId: string
      /** main がこの起動に使った CLI の種類(already-running は動いているセッションの種類) */
      cliKind: AgentCliKind
      /** claude の会話の ID。sessionResume が true の種類では必ず文字列、false の種類では null。already-running は動いているセッションの ID(依頼の launch は使わない) */
      claudeSessionId: string | null
    }
  | {
      kind: 'error'
      error: 'command-not-found'
      /** 探したコマンドの CLI の種類(文言に使う) */
      cliKind: AgentCliKind
      /** ログインシェルから PATH を取得できず既定の場所だけを探したか */
      shellPathUnavailable: boolean
    }
  | {
      kind: 'error'
      error: Exclude<AgentTerminalErrorKind, 'command-not-found'>
      /** folder-missing はフォルダのパス、spawn-failed は例外の文言 */
      detail?: string
    }
```

4. `AgentSessionSnapshotEntry` を次に置き換える:

```ts
/** 生きているセッションと、それを持つ枠(getAgentSessions の戻り値の要素) */
export interface AgentSessionSnapshotEntry {
  slotId: string
  sessionId: string
  /** そのセッションの CLI の種類(作り直しの後の合わせ込みで、タブの種類を合わせる) */
  cliKind: AgentCliKind
  /** そのセッションの claude の会話の ID。再開に対応しない種類では null */
  claudeSessionId: string | null
}
```

`agentStartCanceled()` の戻り値の型 `Extract<AgentStartResult, { kind: 'error' }>` はそのままで通る（`spawn-failed` は 3 つ目の組）。

`src/shared/types/agentChanges.ts` の `AgentChangesAttributionLostReason` の末尾に `| 'cli-unsupported'` を足す（上のコメントに「`cli-unsupported` は使う CLI が hooks による区別に対応していない(main の hooks.prepare)」を 1 行足す）。

`src/shared/types/settings.ts` の先頭に `import type { AgentCliKind } from '../agentCliKinds'` を足し、末尾に次を足す:

```ts
/** 使うエージェント CLI の設定の読み込みの結果(main の agentCliKindStore が返す)。fallback は既定に戻した理由。
 *  値が無い(未設定)なら null、値が壊れていたら invalid-value、設定ファイルを読めなかったら read-failed */
export type AgentCliKindSetting = {
  kind: AgentCliKind
  fallback: null | 'invalid-value' | 'read-failed'
}
```

`src/shared/types.ts` の `export type * from './types/agentNotification'` の次に `export type { AgentCliKind, AgentCliCapabilities, AgentCliProfile } from './agentCliKinds'` を足す（値は `@shared/agentCliKinds` から import する。設計書「再 export には型だけを足す」）。

- [ ] **Step 5: 型に追随する（main は一時の値、renderer は文言を実装する）**

`src/main/agentSessionStarter.ts`:

1. import に `import { DEFAULT_AGENT_CLI_KIND } from '@shared/agentCliKinds'` を足す
2. `command-not-found` を返すところ（`createSession` の中）を次にする:

```ts
        result: {
          kind: 'error',
          error: 'command-not-found',
          // 段階 1 の途中(main): Task 3a で resolveLaunch の結果の種類に置き換える
          cliKind: DEFAULT_AGENT_CLI_KIND,
          shellPathUnavailable: launch.shellPathUnavailable
        }
```

3. `recordStarted` の戻り値を `{ kind: 'started', sessionId, cliKind: DEFAULT_AGENT_CLI_KIND, claudeSessionId: createdClaudeSessionId }`、`alreadyRunning` の戻り値を `{ kind: 'already-running', sessionId, cliKind: DEFAULT_AGENT_CLI_KIND, claudeSessionId }` にし、どちらの行の上にも `// 段階 1 の途中(main): Task 3b で起動の計画の種類に置き換える` を置く

`src/main/agentSessionSnapshot.ts` の import に `import { DEFAULT_AGENT_CLI_KIND } from '@shared/agentCliKinds'` を足し、返す要素を次にする:

```ts
// 段階 1 の途中(main): Task 3b で starter の控えの種類に置き換える
return [
  {
    slotId: entry.slotId,
    sessionId: entry.sessionId,
    cliKind: DEFAULT_AGENT_CLI_KIND,
    claudeSessionId
  }
]
```

`src/renderer/src/lib/agentSessionMessages.ts`:

1. import に `import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'` を足す
2. `AGENT_SESSION_IN_USE` の次に足す:

```ts
/** 再開の依頼だが、使う CLI が再開に対応していない(main が resume-unsupported で拒んだ) */
export const AGENT_RESUME_UNSUPPORTED =
  '使っているエージェント CLI は、セッションの再開に対応していません'
```

3. `describeAgentStartError` の `command-not-found` を次に置き換え、`session-in-use` の次に `resume-unsupported` を足す:

```ts
    case 'command-not-found': {
      // 結果の種類(main が探したコマンド)の名前で出す。省略で claude の文言に流さない(L-044)
      const profile = AGENT_CLI_PROFILES[result.cliKind]
      return (
        `${profile.commandName} コマンドが見つかりません。${profile.displayName} をインストールしてください（探した場所: ログインシェルの PATH）` +
        (result.shellPathUnavailable
          ? '（ログインシェルから PATH を取得できなかったため、既定の場所だけを探しました）'
          : '')
      )
    }
```

```ts
    case 'resume-unsupported':
      return AGENT_RESUME_UNSUPPORTED
```

`src/renderer/src/lib/agentChangesMessages.ts` の `AGENT_CHANGES_ATTRIBUTION_LOST_REASONS` の末尾に `'cli-unsupported': '使っているエージェント CLI が区別に対応していません（claude だけが対応しています）'` を足す。

- [ ] **Step 6: 既存のテストの値を新しい型に合わせる**

起動の結果（`started`・`already-running`）と状態の取得の要素に `cliKind: 'claude'` を足す。単一行・複数行のどちらの形も、`sessionId` の欄の直後に入れる:

```bash
cd <repo-root>
# 配列にする(zsh は引用符なしの変数を単語に分けないため、空白でつないだ文字列では 1 つのパスになる。bash でも同じく働く)
FILES=(
  src/shared/__tests__/agentTerminal.test.ts
  src/main/__tests__/agentSessionStarter.test.ts
  src/main/__tests__/agentSessionSnapshot.test.ts
  src/main/__tests__/handlers/agentTerminalHandlers.test.ts
  src/renderer/src/hooks/__tests__/useAgentSessions.test.ts
  src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts
  src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx
  src/renderer/src/components/__tests__/App.agentReferences.test.tsx
)
for f in "${FILES[@]}"; do test -f "$f" || echo "missing $f"; done
# 起動の結果: kind: 'started' | 'already-running' の直後の sessionId の欄の後ろに cliKind を足す
perl -0pi -e "s/(kind: '(?:started|already-running)',\s*sessionId: [^,]+,)(\s*)claudeSessionId:/\$1\$2cliKind: 'claude',\$2claudeSessionId:/g" "${FILES[@]}"
# 状態の取得の要素: slotId・sessionId の後ろに cliKind を足す
perl -0pi -e "s/(slotId: [^,]+,\s*sessionId: [^,]+,)(\s*)claudeSessionId:/\$1\$2cliKind: 'claude',\$2claudeSessionId:/g" "${FILES[@]}"
for f in "${FILES[@]}"; do echo "$(grep -c "cliKind: 'claude'" "$f") $f"; done
npx prettier --write "${FILES[@]}"
git diff --stat -- "${FILES[@]}"
```

Expected: `missing` が出ない。`grep -c` の数は agentTerminal 2・agentSessionStarter 9・agentSessionSnapshot 3・agentTerminalHandlers 8・useAgentSessions 47・useAgentWorkspace 1・App.agentSessionResume 3・App.agentReferences 1（今のコードに対して写しで確かめた数。テストを足して数が変わっていれば、増えた分が起動の結果・状態の取得の要素であることを確かめる）。差分は `cliKind: 'claude'` の追加と prettier の折り返しだけ（同じシェルで `git diff -- "${FILES[@]}" | grep '^[-+]' | grep -v cliKind` を流し、`cliKind` を含まない変更行が折り返しの移動だけであることを目で確かめる）。

`command-not-found` の値（型に `cliKind` が要る）は手で直す:

- `src/main/__tests__/agentSessionRegistry.test.ts` の 2 か所（`error: 'command-not-found' as const` の組と、`result: { kind: 'error', error: 'command-not-found', shellPathUnavailable: false }`）に `cliKind: 'claude' as const`（2 か所目は `cliKind: 'claude'`）を足す
- `src/main/__tests__/agentSessionStarter.test.ts` の `コマンドが見つからなければ command-not-found(PATH の取得の失敗を添える)` と `src/main/__tests__/handlers/agentTerminalHandlers.test.ts` の `claude が見つからなければ command-not-found(PATH の取得の失敗を添える)` の期待に `cliKind: 'claude'` を足す（`resolveLaunch` の偽の値はまだ種類を持たない。Task 3a で足す）
- `src/renderer/src/hooks/__tests__/useAgentSessions.test.ts` の `{ kind: 'error' as const, error: 'command-not-found' as const, shellPathUnavailable: false }` に `cliKind: 'claude' as const` を足す

`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts` のほかの `describeAgentStartError` の呼び出しは、`command-not-found` 以外の組なので変えない。

- [ ] **Step 7: テストが通ることを確かめる**

Run: `npx vitest run src/shared src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/agentSessionRegistry.test.ts src/main/__tests__/agentSessionSnapshot.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx src/renderer/src/components/__tests__/App.agentReferences.test.tsx`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS（型エラーが残れば、その場所の値に `cliKind: 'claude'` を足す。`claudeSessionId` の `null` を受けられない呼び出しがあれば、`null` を受ける形にする〈renderer の `setTabClaudeSessionId` は既に `string | null` を受ける〉）

- [ ] **Step 8: 変異で確かめる**

1. `AGENT_CLI_PROFILES.copilot.capabilities.interrupt` を `true` にする → `copilot: interrupt が真なら screenActivity も真` と `claude の能力はすべて真、copilot はすべて偽` が落ちる。戻す
2. `describeAgentStartError` の `command-not-found` の `AGENT_CLI_PROFILES[result.cliKind]` を `AGENT_CLI_PROFILES.claude` にする → `command-not-found は結果の種類の…(copilot・…)` の 2 行が落ちる。戻す
3. `git diff src/shared/agentCliKinds.ts src/renderer/src/lib/agentSessionMessages.ts` で戻したことを確かめる（新規のファイルは `git diff` に出ないので、`grep -n "interrupt: false" src/shared/agentCliKinds.ts` で copilot の値が `false` に戻ったことを確かめる）

- [ ] **Step 9: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/shared/agentCliKinds.ts src/shared/types/agentTerminal.ts src/shared/types/agentChanges.ts src/shared/types/settings.ts src/shared/types.ts src/main/agentSessionStarter.ts src/main/agentSessionSnapshot.ts src/renderer/src/lib/agentSessionMessages.ts src/renderer/src/lib/agentChangesMessages.ts src/shared/__tests__/agentCliKinds.test.ts src/shared/__tests__/agentTerminal.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/agentSessionRegistry.test.ts src/main/__tests__/agentSessionSnapshot.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx src/renderer/src/components/__tests__/App.agentReferences.test.tsx`
Expected: エラー・警告なし
Run: `npx prettier --check <同じファイル>`
Expected: すべて整形済み

---

### Task 2: main の設定（保存・読み込み・IPC・窓口）

> **設計書の読む節:** 「決めたこと（推奨案）」の未知の値の扱い、「設定」の「保存と読み込み（main）」（箇条書きのすべて）、「エラー処理」の設定の行、「テスト方針」の `agentCliKindStore.test.ts`・`settingsHandlers.test.ts`。
>
> **気をつける知見:** L-017（ログには値の先頭 80 文字だけ。設定ファイルの例外の文言は出さない。保存の拒否の文言に値を入れない）・L-029（保存するのは種類の名前だけ）・L-044（未知の値は既定に戻すがログと画面で知らせる。保存では拒否して `claude` に倒さない）

**Files:**

- Create: `src/main/agentCliKindStore.ts`・`src/main/__tests__/agentCliKindStore.test.ts`
- Modify: `src/main/settingsFileStore.ts`・`src/main/handlers/settingsHandlers.ts`・`src/preload/api.ts`・`src/preload/index.d.ts`・`src/renderer/src/lib/settingsApi.ts`・`src/renderer/src/__tests__/setup.ts`
- Test: `src/main/__tests__/settingsFileStore.test.ts`・`src/main/__tests__/handlers/settingsHandlers.test.ts`・`src/preload/__tests__/api.test.ts`・`src/renderer/src/lib/__tests__/settingsApi.test.ts`

**Interfaces:**

- Consumes: Task 1 の `AgentCliKind`・`AgentCliKindSetting`・`DEFAULT_AGENT_CLI_KIND`・`isAgentCliKind`
- Produces:

```ts
// src/main/agentCliKindStore.ts
export const AGENT_CLI_KIND_LOG_VALUE_MAX_LENGTH = 80
export const AGENT_CLI_KIND_INVALID_ERROR = '使うエージェント CLI が不正です'
export async function getAgentCliKindSetting(
  log?: (message: string) => void
): Promise<AgentCliKindSetting>
export async function setAgentCliKind(kind: unknown): Promise<void>
// IPC: 'settings:getAgentCliKind'(AgentCliKindSetting を返す)・'settings:setAgentCliKind'(引数は値 1 つ)
// preload(window.api)・renderer(lib/settingsApi.ts)
getAgentCliKind(): Promise<AgentCliKindSetting>
setAgentCliKind(kind: AgentCliKind): Promise<void>
```

- [ ] **Step 1: 失敗するテストを書く（store）**

`src/main/__tests__/agentCliKindStore.test.ts` を作る:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

const mockReadSettingsFile = vi.hoisted(() => vi.fn())
const mockWriteSettingsFile = vi.hoisted(() => vi.fn())
vi.mock('../settingsFileStore', () => ({
  readSettingsFile: mockReadSettingsFile,
  writeSettingsFile: mockWriteSettingsFile
}))

import {
  AGENT_CLI_KIND_LOG_VALUE_MAX_LENGTH,
  getAgentCliKindSetting,
  setAgentCliKind
} from '../agentCliKindStore'

const INVALID_LOG = '[agentCliKind] 保存されていた値を読めないため claude を使います: '
const READ_FAILED_LOG = '[agentCliKind] 設定ファイルを読めないため claude を使います'

let warnSpy: MockInstance<typeof console.warn> | null = null

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteSettingsFile.mockResolvedValue(undefined)
})

afterEach(() => {
  warnSpy?.mockRestore()
  warnSpy = null
})

describe('getAgentCliKindSetting', () => {
  it.each(['claude', 'copilot'])('保存された %s を返し、ログを出さない', async (kind) => {
    mockReadSettingsFile.mockResolvedValueOnce({
      agentCliKind: kind,
      promptExecutionMode: 'agent-cli'
    })
    const log = vi.fn()
    await expect(getAgentCliKindSetting(log)).resolves.toEqual({ kind, fallback: null })
    expect(log).not.toHaveBeenCalled()
  })

  it('値が無ければ既定の claude で、既定に戻した理由は無い(ログも出さない)', async () => {
    mockReadSettingsFile.mockResolvedValueOnce({})
    const log = vi.fn()
    await expect(getAgentCliKindSetting(log)).resolves.toEqual({ kind: 'claude', fallback: null })
    expect(log).not.toHaveBeenCalled()
  })

  it.each([
    ['知らない文字列', 'codex', '"codex"'],
    ['大文字の違う文字列', 'Claude', '"Claude"'],
    ['数', 1, '1'],
    ['オブジェクト', {}, '{}'],
    ['null', null, 'null']
  ])(
    '%s は claude に戻して invalid-value とし、値をログに出す(L-044)',
    async (_label, value, shown) => {
      mockReadSettingsFile.mockResolvedValueOnce({ agentCliKind: value })
      const log = vi.fn()
      await expect(getAgentCliKindSetting(log)).resolves.toEqual({
        kind: 'claude',
        fallback: 'invalid-value'
      })
      expect(log).toHaveBeenCalledExactlyOnceWith(`${INVALID_LOG}${shown}`)
    }
  )

  it('ログに出す値は JSON の先頭 80 文字だけ(L-017)', async () => {
    const value = 'x'.repeat(200)
    mockReadSettingsFile.mockResolvedValueOnce({ agentCliKind: value })
    const log = vi.fn()
    await getAgentCliKindSetting(log)
    expect(AGENT_CLI_KIND_LOG_VALUE_MAX_LENGTH).toBe(80)
    expect(log).toHaveBeenCalledExactlyOnceWith(
      `${INVALID_LOG}${JSON.stringify(value).slice(0, 80)}`
    )
  })

  it('readSettingsFile が投げたら claude に戻して read-failed とし、例外の文言はログに出さない(L-017)', async () => {
    mockReadSettingsFile.mockRejectedValueOnce(
      new SyntaxError('Unexpected token in JSON: {"encryptedApiKey":"secret-cipher"')
    )
    const log = vi.fn()
    await expect(getAgentCliKindSetting(log)).resolves.toEqual({
      kind: 'claude',
      fallback: 'read-failed'
    })
    expect(log).toHaveBeenCalledExactlyOnceWith(READ_FAILED_LOG)
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-cipher')
  })

  // readSettingsFile は JSON.parse の結果を型の主張だけで返すため、オブジェクトでない JSON でも投げずに返ってくる
  it.each([
    ['null', null],
    ['配列', ['copilot']],
    ['数', 1],
    ['文字列', 'copilot']
  ])('読んだ JSON が %s なら投げずに claude に戻して read-failed', async (_label, data) => {
    mockReadSettingsFile.mockResolvedValueOnce(data)
    const log = vi.fn()
    await expect(getAgentCliKindSetting(log)).resolves.toEqual({
      kind: 'claude',
      fallback: 'read-failed'
    })
    expect(log).toHaveBeenCalledExactlyOnceWith(READ_FAILED_LOG)
  })

  it('log を省くと console.warn に出す', async () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockReadSettingsFile.mockResolvedValueOnce({ agentCliKind: 'codex' })
    await getAgentCliKindSetting()
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith(`${INVALID_LOG}"codex"`)
  })
})

describe('setAgentCliKind', () => {
  it.each(['claude', 'copilot'])('%s を検証してマージで書き込む', async (kind) => {
    await setAgentCliKind(kind)
    expect(mockWriteSettingsFile).toHaveBeenCalledExactlyOnceWith({ agentCliKind: kind })
  })

  it.each(['codex', '', 'Claude', null, 1, undefined])(
    '知らない値(%o)は書き込まずに投げ、値を文言に入れない(claude に倒さない。L-044)',
    async (kind) => {
      await expect(setAgentCliKind(kind)).rejects.toThrow(
        new Error('使うエージェント CLI が不正です')
      )
      expect(mockWriteSettingsFile).not.toHaveBeenCalled()
    }
  )
})
```

`src/main/__tests__/settingsFileStore.test.ts` の `既存フィールドを保持したまま merge 書き込みする` の次に足す（「ほかのキーが残る」をマージの実物で確かめる）:

```ts
it('使うエージェント CLI を書いても、API キーの暗号文・実行方式を残す', async () => {
  mockReadFile.mockResolvedValue(
    JSON.stringify({ encryptedApiKey: 'abc', promptExecutionMode: 'agent-cli' })
  )
  await writeSettingsFile({ agentCliKind: 'copilot' })
  const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
  expect(written).toEqual({
    encryptedApiKey: 'abc',
    promptExecutionMode: 'agent-cli',
    agentCliKind: 'copilot'
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（IPC・preload・renderer の窓口）**

`src/main/__tests__/handlers/settingsHandlers.test.ts` の `vi.mock('../../agentSendConfirmSettingStore', …)` の次に足す:

```ts
const mockGetAgentCliKindSetting = vi.hoisted(() => vi.fn())
const mockSetAgentCliKind = vi.hoisted(() => vi.fn())
vi.mock('../../agentCliKindStore', () => ({
  getAgentCliKindSetting: mockGetAgentCliKindSetting,
  setAgentCliKind: mockSetAgentCliKind
}))
```

`describe('registerSettingsHandlers', …)` の中の末尾に足す:

```ts
it('settings:getAgentCliKind は保存された設定(種類と既定に戻した理由)を返す', async () => {
  mockGetAgentCliKindSetting.mockResolvedValueOnce({ kind: 'copilot', fallback: null })
  await expect(getRegisteredHandler('settings:getAgentCliKind')(makeEvent(1))).resolves.toEqual({
    kind: 'copilot',
    fallback: null
  })
  expect(mockGetAgentCliKindSetting).toHaveBeenCalledOnce()
})

it('settings:setAgentCliKind は受け取った値をそのまま store へ渡す(検証は store が行う)', async () => {
  mockSetAgentCliKind.mockResolvedValueOnce(undefined)
  await getRegisteredHandler('settings:setAgentCliKind')(makeEvent(1), 'copilot')
  expect(mockSetAgentCliKind).toHaveBeenCalledExactlyOnceWith('copilot')
})

it('settings:setAgentCliKind は store の拒否をそのまま返す', async () => {
  mockSetAgentCliKind.mockRejectedValueOnce(new Error('使うエージェント CLI が不正です'))
  await expect(
    getRegisteredHandler('settings:setAgentCliKind')(makeEvent(1), 'codex')
  ).rejects.toThrow('使うエージェント CLI が不正です')
})
```

`src/preload/__tests__/api.test.ts` の `setAgentSendConfirmEnabled は …` の行の次に 2 行足す:

```ts
    [
      'getAgentCliKind は settings:getAgentCliKind を呼ぶ',
      () => api.getAgentCliKind(),
      ['settings:getAgentCliKind']
    ],
    [
      'setAgentCliKind は settings:setAgentCliKind に種類を渡す',
      () => api.setAgentCliKind('copilot'),
      ['settings:setAgentCliKind', 'copilot']
    ],
```

`src/renderer/src/lib/__tests__/settingsApi.test.ts` の import に `getAgentCliKind, setAgentCliKind` を足し、末尾に足す:

```ts
describe('使うエージェント CLI', () => {
  it('getAgentCliKind・setAgentCliKind は window.api に委譲する', async () => {
    const api = {
      getAgentCliKind: vi.fn().mockResolvedValue({ kind: 'copilot', fallback: null }),
      setAgentCliKind: vi.fn().mockResolvedValue(undefined)
    }
    vi.stubGlobal('api', api)
    await expect(getAgentCliKind()).resolves.toEqual({ kind: 'copilot', fallback: null })
    await setAgentCliKind('claude')
    expect(api.setAgentCliKind).toHaveBeenCalledExactlyOnceWith('claude')
  })
})
```

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentCliKindStore.test.ts src/main/__tests__/settingsFileStore.test.ts src/main/__tests__/handlers/settingsHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/settingsApi.test.ts`
Expected: FAIL（`agentCliKindStore` が無い・受け口が無い・窓口が無い）。`settingsFileStore.test.ts` の新しいテストは型の外のキーでも通りうる（`SettingsFile` への追加は型のため）

- [ ] **Step 4: store と IPC を実装する**

`src/main/settingsFileStore.ts` の `SettingsFile` の末尾に足す:

```ts
  /** 使うエージェント CLI(agentCliKindStore が検証する) */
  agentCliKind?: string
```

`src/main/agentCliKindStore.ts` を作る:

```ts
import type { AgentCliKindSetting } from '@shared/types'
import { DEFAULT_AGENT_CLI_KIND, isAgentCliKind } from '@shared/agentCliKinds'
import { readSettingsFile, writeSettingsFile } from './settingsFileStore'

// 使うエージェント CLI の読み書き(userData/settings.json の agentCliKind。executionModeStore と同じ形で、API キー・モデルと同じ
// ファイルにマージで書く)。main は起動のたびにここを読む(renderer の値は使わない。L-019)。読めない値は既定(claude)に戻すが、
// 黙って流さず、ログと設定の画面(fallback)で知らせる(L-044)。設定ファイルには API キーの暗号文があるため、例外の文言はログに
// 出さず、保存されていた値も先頭だけを出す(L-017)

/** 保存されていた値をログに出すときの長さの上限(JSON の文字列の先頭) */
export const AGENT_CLI_KIND_LOG_VALUE_MAX_LENGTH = 80
/** 保存の拒否の文言(値を入れない。L-017) */
export const AGENT_CLI_KIND_INVALID_ERROR = '使うエージェント CLI が不正です'
const READ_FAILED_LOG = '[agentCliKind] 設定ファイルを読めないため claude を使います'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 設定ファイルから読んだ値を、ログに出せる長さの JSON にする(JSON から読んだ値なので JSON.stringify は投げない) */
function describeStoredValue(value: unknown): string {
  return String(JSON.stringify(value)).slice(0, AGENT_CLI_KIND_LOG_VALUE_MAX_LENGTH)
}

/**
 * 保存された種類と、既定に戻した理由。キーが無ければ既定(fallback は null)、知らない値なら既定(invalid-value)、
 * 設定ファイルを読めない・読んだ値が普通のオブジェクトでなければ既定(read-failed)。投げない(起動を止めない)
 */
export async function getAgentCliKindSetting(
  log: (message: string) => void = console.warn
): Promise<AgentCliKindSetting> {
  let value: unknown
  try {
    // readSettingsFile は JSON.parse の結果を型の主張だけで返す。null・配列・数・文字列の JSON でも投げないため、ここで確かめる
    const data: unknown = await readSettingsFile()
    if (!isPlainObject(data)) {
      log(READ_FAILED_LOG)
      return { kind: DEFAULT_AGENT_CLI_KIND, fallback: 'read-failed' }
    }
    value = data.agentCliKind
  } catch {
    log(READ_FAILED_LOG)
    return { kind: DEFAULT_AGENT_CLI_KIND, fallback: 'read-failed' }
  }
  if (value === undefined) return { kind: DEFAULT_AGENT_CLI_KIND, fallback: null }
  if (isAgentCliKind(value)) return { kind: value, fallback: null }
  log(
    `[agentCliKind] 保存されていた値を読めないため claude を使います: ${describeStoredValue(value)}`
  )
  return { kind: DEFAULT_AGENT_CLI_KIND, fallback: 'invalid-value' }
}

/** 検証してから保存する。知らない値は投げて書かない(claude に倒さない。L-044) */
export async function setAgentCliKind(kind: unknown): Promise<void> {
  if (!isAgentCliKind(kind)) throw new Error(AGENT_CLI_KIND_INVALID_ERROR)
  await writeSettingsFile({ agentCliKind: kind })
}
```

`src/main/handlers/settingsHandlers.ts` の import に `import { getAgentCliKindSetting, setAgentCliKind } from '../agentCliKindStore'` を足し、`settings:setPromptExecutionMode` の受け口の次に足す:

```ts
// 使うエージェント CLI。読み込みは種類と既定に戻した理由を返す(設定の画面が注記に使う)。検証は store が行う
ipcMain.handle('settings:getAgentCliKind', async () => getAgentCliKindSetting())

ipcMain.handle(
  'settings:setAgentCliKind',
  async (_event: IpcMainInvokeEvent, kind: unknown): Promise<void> => setAgentCliKind(kind)
)
```

- [ ] **Step 5: preload・renderer の窓口とテストの既定を実装する**

`src/preload/api.ts`: 型の import（`import type { … } from '@shared/types'`）に `AgentCliKind, AgentCliKindSetting` を足し、`setAgentSendConfirmEnabled` の次に足す:

```ts
  getAgentCliKind: (): Promise<AgentCliKindSetting> => ipcRenderer.invoke('settings:getAgentCliKind'),
  setAgentCliKind: (kind: AgentCliKind): Promise<void> =>
    ipcRenderer.invoke('settings:setAgentCliKind', kind),
```

`src/preload/index.d.ts`: 型の import に `AgentCliKind, AgentCliKindSetting` を足し、`setAgentSendConfirmEnabled(enabled: boolean): Promise<void>` の次に足す:

```ts
      getAgentCliKind(): Promise<AgentCliKindSetting>
      setAgentCliKind(kind: AgentCliKind): Promise<void>
```

`src/renderer/src/lib/settingsApi.ts`: 型の import を `import type { AgentCliKind, AgentCliKindSetting, ModelSettings, PromptExecutionMode } from '@shared/types'` にし、末尾に足す:

```ts
export function getAgentCliKind(): Promise<AgentCliKindSetting> {
  return window.api.getAgentCliKind()
}

export function setAgentCliKind(kind: AgentCliKind): Promise<void> {
  return window.api.setAgentCliKind(kind)
}
```

`src/renderer/src/__tests__/setup.ts` の `setAgentSendConfirmEnabled: () => Promise.resolve(),` の次に足す（既存のテストは claude の画面を前提にする）:

```ts
    getAgentCliKind: () => Promise.resolve({ kind: 'claude', fallback: null }),
    setAgentCliKind: () => Promise.resolve(),
```

- [ ] **Step 6: テストが通ることを確かめる**

Run: Step 3 と同じコマンド
Expected: PASS

- [ ] **Step 7: 変異で確かめる**

1. `getAgentCliKindSetting` の `if (!isPlainObject(data)) { … }` の 4 行を消す → `読んだ JSON が null なら…` などが落ちる（`null.agentCliKind` の参照で投げ、catch で read-failed になる場合は、配列・数・文字列の行が `fallback: null` で落ちる）。戻す
2. `setAgentCliKind` の検証を消す → `知らない値(…)は書き込まずに投げ…` が落ちる。戻す
3. `describeStoredValue` の `.slice(…)` を消す → `ログに出す値は JSON の先頭 80 文字だけ` が落ちる。戻す
4. `git diff` と `grep -n "isPlainObject(data)\|slice(0, AGENT_CLI_KIND_LOG_VALUE_MAX_LENGTH)\|isAgentCliKind(kind)" src/main/agentCliKindStore.ts`（3 行が出る）で戻したことを確かめる

- [ ] **Step 8: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/main/agentCliKindStore.ts src/main/settingsFileStore.ts src/main/handlers/settingsHandlers.ts src/preload/api.ts src/preload/index.d.ts src/renderer/src/lib/settingsApi.ts src/renderer/src/__tests__/setup.ts src/main/__tests__/agentCliKindStore.test.ts src/main/__tests__/settingsFileStore.test.ts src/main/__tests__/handlers/settingsHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/settingsApi.test.ts`
Expected: エラー・警告なし（`log = console.warn` に `@typescript-eslint/unbound-method` が出たら、既定を `(message: string): void => console.warn(message)` にせず、モジュールの定数 `const warnToConsole = (message: string): void => console.warn(message)` を作ってそれを既定に渡す〈毎回新しい関数を作らない〉）
Run: `npx prettier --check <同じファイル>`
Expected: すべて整形済み

---

### Task 3a: main の起動の表と解決（偽の実行ファイルの統合テストを含む）

> **設計書の読む節:** 「main の起動」の「起動の表」「解決」（箇条書きのすべて）、「設定」の「起動での読み込み（main）」、「copilot の調べた事実」1・3・4・6、「エラー処理」の 1〜2 行目、「テスト方針」の `agentCommand.test.ts`・`agentCliLaunchSpecs.test.ts`・偽の実行ファイルの統合テスト。
>
> **気をつける知見:** L-018（設定から読んだ種類を計画に入れ、後の手順はその値を使う）・L-019（コマンド名・引数・取り除く環境変数は main の表）・L-034（`copilot` の引数は空。renderer の値を引数にしない）・L-044（種類と能力に合わない引数・未知の `launch.kind` は投げる）・L-052（新しく待つ外部プロセスを足さない）・L-059（node スクリプトの起動を実物の node-pty と偽の `copilot` で確かめる）・L-060（`buildAgentEnv` の除外の引数を必須にする）

**Files:**

- Create: `src/main/agentCliLaunchSpecs.ts`・`src/main/__tests__/agentCliLaunchSpecs.test.ts`・`src/main/__tests__/agentRuntime.test.ts`・`src/main/__tests__/agentCliLaunch.integration.test.ts`
- Modify: `src/main/agentCommand.ts`・`src/main/agentRuntime.ts`・`src/main/agentSessionStarter.ts`（引数を表から作る・`command-not-found` の種類）
- Test: `src/main/__tests__/agentCommand.test.ts`・`src/main/__tests__/agentSessionStarter.test.ts`・`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`・`src/main/__tests__/agentHookSessions.test.ts`・`src/main/__tests__/agentHooks.integration.test.ts`（計画に種類を足す追随）

**Interfaces:**

- Consumes: Task 1 の `AgentCliKind`・`AGENT_CLI_PROFILES`、Task 2 の `getAgentCliKindSetting`
- Produces:

```ts
// src/main/agentCliLaunchSpecs.ts
export interface AgentCliLaunchSpec {
  commandName: string
  extraRemovedEnvKeys: readonly string[]
  buildArgs(
    launch: AgentLaunchRequest,
    claudeSessionId: string | null,
    hookSettingsPath: string | null
  ): string[]
}
export const AGENT_CLI_LAUNCH_SPECS: Record<AgentCliKind, AgentCliLaunchSpec>
// src/main/agentCommand.ts(AGENT_COMMAND_NAME・buildAgentLaunchArgs は消す)
export function buildAgentEnv(
  base: NodeJS.ProcessEnv,
  pathValue: string,
  platform: NodeJS.Platform,
  extraRemovedKeys: readonly string[]
): Record<string, string>
export interface AgentLaunchPlan {
  cliKind: AgentCliKind
  file: string
  args: string[]
  env: Record<string, string>
}
export type AgentLaunchResolution =
  | { kind: 'ok'; plan: AgentLaunchPlan }
  | { kind: 'not-found'; cliKind: AgentCliKind; shellPathUnavailable: boolean }
export interface ResolveAgentLaunchDeps {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  cliKind: AgentCliKind
  readLoginShellPath: () => Promise<string | null>
  isExecutable: ExecutableProbe
}
```

- [ ] **Step 1: 失敗するテストを書く（起動の表）**

`src/main/__tests__/agentCliLaunchSpecs.test.ts` を作る（`claude` の行は今の `agentCommand.test.ts` の `describe('buildAgentLaunchArgs', …)` を移したもの。Step 2 で元の describe を消す）:

```ts
import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS, AGENT_CLI_PROFILES, agentCliCapabilities } from '@shared/agentCliKinds'
import type { AgentLaunchRequest } from '@shared/types'
import { AGENT_CLI_LAUNCH_SPECS } from '../agentCliLaunchSpecs'

const ID = '11111111-1111-4111-8111-111111111111'
const HOOKS = '/tmp/prompt-ide-agent-hooks-x/a.json'
const NEW: AgentLaunchRequest = { kind: 'new' }
const RESUME: AgentLaunchRequest = { kind: 'resume', claudeSessionId: ID }
const UNKNOWN = { kind: 'fork', claudeSessionId: ID } as unknown as AgentLaunchRequest

describe('AGENT_CLI_LAUNCH_SPECS(表)', () => {
  it.each(AGENT_CLI_KINDS)('%s: 探すコマンドの名前は能力の表の commandName', (kind) => {
    expect(AGENT_CLI_LAUNCH_SPECS[kind].commandName).toBe(AGENT_CLI_PROFILES[kind].commandName)
  })

  it('追加で取り除く環境変数は copilot の COPILOT_ALLOW_ALL だけ', () => {
    expect(AGENT_CLI_LAUNCH_SPECS.claude.extraRemovedEnvKeys).toEqual([])
    expect(AGENT_CLI_LAUNCH_SPECS.copilot.extraRemovedEnvKeys).toEqual(['COPILOT_ALLOW_ALL'])
  })

  // 能力が false の種類に会話の ID・設定のファイルが渡ったら投げる(呼び出し側の取り違えを黙って捨てない。L-044)
  it.each(AGENT_CLI_KINDS)('%s: 能力の表に合わない値は投げる', (kind) => {
    const { buildArgs } = AGENT_CLI_LAUNCH_SPECS[kind]
    const capabilities = agentCliCapabilities(kind)
    if (!capabilities.sessionResume) expect(() => buildArgs(NEW, ID, null)).toThrow()
    if (!capabilities.changeAttribution) expect(() => buildArgs(NEW, null, HOOKS)).toThrow()
  })
})

describe('AGENT_CLI_LAUNCH_SPECS.claude.buildArgs(今の buildAgentLaunchArgs)', () => {
  const { buildArgs } = AGENT_CLI_LAUNCH_SPECS.claude

  it('new は --session-id、resume は --resume に、渡した ID をそのまま続ける(hooks なしは 2 つだけ)', () => {
    expect(buildArgs(NEW, ID, null)).toEqual(['--session-id', ID])
    expect(buildArgs(RESUME, ID, null)).toEqual(['--resume', ID])
  })

  it('設定のファイルのパスがあれば、後ろに --settings <パス> を足す(ほかの引数は足さない)', () => {
    expect(buildArgs(NEW, ID, HOOKS)).toEqual(['--session-id', ID, '--settings', HOOKS])
    expect(buildArgs(RESUME, ID, HOOKS)).toEqual(['--resume', ID, '--settings', HOOKS])
  })

  it('会話の ID が null なら投げる(claude は必ず ID を付けて起動する)', () => {
    expect(() => buildArgs(NEW, null, null)).toThrow('claude の起動には会話の ID が要ります')
  })

  it('未知の kind は既定の --session-id へ流さず投げる', () => {
    expect(() => buildArgs(UNKNOWN, ID, null)).toThrow('未知の起動の指定です')
  })
})

describe('AGENT_CLI_LAUNCH_SPECS.copilot.buildArgs', () => {
  const { buildArgs } = AGENT_CLI_LAUNCH_SPECS.copilot

  it('new は引数なし(対話のセッション。-C・--allow-*・--yolo などを付けない)', () => {
    expect(buildArgs(NEW, null, null)).toEqual([])
  })

  it('resume は投げる(starter が先に resume-unsupported で断るので届かない)', () => {
    expect(() => buildArgs(RESUME, null, null)).toThrow(
      'copilot はセッションの再開に対応していません'
    )
  })

  it('会話の ID・hooks の設定のファイルが渡ったら投げる', () => {
    expect(() => buildArgs(NEW, ID, null)).toThrow('copilot の起動に会話の ID は渡せません')
    expect(() => buildArgs(NEW, null, HOOKS)).toThrow(
      'copilot の起動に hooks の設定のファイルは渡せません'
    )
  })

  it('未知の kind は投げる', () => {
    expect(() => buildArgs(UNKNOWN, null, null)).toThrow('未知の起動の指定です')
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（解決・環境変数・設定の読み込み）**

`src/main/__tests__/agentCommand.test.ts`:

1. import から `AGENT_COMMAND_NAME`・`buildAgentLaunchArgs`・`AgentLaunchRequest` の型を外し、`describe('buildAgentLaunchArgs', …)` を丸ごと消す（Step 1 に移した）
2. 既存の `buildAgentEnv(…)` の呼び出しは、platform を省いているもの（`buildAgentEnv(base, '/p')` など）に `'darwin'` を、すべての呼び出しの末尾に `[]` を足す（`buildAgentEnv(base, '/p', 'darwin', [])`・`buildAgentEnv({}, '/p', 'linux', [])` の形。`win32` の呼び出しは `'win32', []`）
3. 既存の `describe('resolveAgentLaunch', …)` の 5 つの呼び出しの引数に `cliKind: 'claude'` を足し、期待を次のように直す: 1 つ目の `plan` に `cliKind: 'claude'` を足し、`` `/nvm/bin/${AGENT_COMMAND_NAME}` `` を `'/nvm/bin/claude'` にする。2 つ目・3 つ目の `{ kind: 'not-found', shellPathUnavailable: … }` に `cliKind: 'claude'` を足す
4. 末尾に次を足す:

```ts
describe('resolveAgentLaunch(CLI の種類)', () => {
  const deps = {
    env: { HOME: '/home/u', PATH: '/usr/bin' },
    platform: 'darwin' as const,
    readLoginShellPath: async (): Promise<string | null> => '/nvm/bin'
  }

  it('copilot は copilot を探し、計画に種類を載せる(引数は空)', async () => {
    const isExecutable = probeOf(['/nvm/bin/copilot'])
    await expect(
      resolveAgentLaunch({ ...deps, cliKind: 'copilot', isExecutable })
    ).resolves.toEqual({
      kind: 'ok',
      plan: { cliKind: 'copilot', file: '/nvm/bin/copilot', args: [], env: expect.any(Object) }
    })
    expect(isExecutable).toHaveBeenNthCalledWith(1, '/nvm/bin/copilot')
  })

  it('copilot だけがある PATH では、claude を選ぶと見つからない(結果に種類を載せる)', async () => {
    const isExecutable = probeOf(['/nvm/bin/copilot'])
    await expect(resolveAgentLaunch({ ...deps, cliKind: 'claude', isExecutable })).resolves.toEqual(
      {
        kind: 'not-found',
        cliKind: 'claude',
        shellPathUnavailable: false
      }
    )
  })

  it('copilot が見つからなければ、結果に copilot を載せる', async () => {
    await expect(
      resolveAgentLaunch({
        ...deps,
        cliKind: 'copilot',
        isExecutable: probeOf(['/nvm/bin/claude'])
      })
    ).resolves.toEqual({ kind: 'not-found', cliKind: 'copilot', shellPathUnavailable: false })
  })

  it('copilot の計画の環境変数だけから COPILOT_ALLOW_ALL を取り除く。共通の一覧はどちらでも取り除く', async () => {
    const env = { HOME: '/home/u', PATH: '/usr/bin', COPILOT_ALLOW_ALL: 'true', CLAUDECODE: '1' }
    const copilot = await resolveAgentLaunch({
      ...deps,
      env,
      cliKind: 'copilot',
      isExecutable: probeOf(['/nvm/bin/copilot'])
    })
    const claude = await resolveAgentLaunch({
      ...deps,
      env,
      cliKind: 'claude',
      isExecutable: probeOf(['/nvm/bin/claude'])
    })
    if (copilot.kind !== 'ok' || claude.kind !== 'ok') throw new Error('not ok')
    expect(copilot.plan.env).not.toHaveProperty('COPILOT_ALLOW_ALL')
    expect(claude.plan.env.COPILOT_ALLOW_ALL).toBe('true')
    expect(copilot.plan.env).not.toHaveProperty('CLAUDECODE')
    expect(claude.plan.env).not.toHaveProperty('CLAUDECODE')
  })
})

describe('buildAgentEnv(種類ごとの追加の除外)', () => {
  it('追加の除外は完全一致で取り除き、似た名前・認証の変数は残す', () => {
    const env = buildAgentEnv(
      {
        COPILOT_ALLOW_ALL: 'true',
        COPILOT_ALLOW_ALL_TOOLS: '1',
        COPILOT_HOME: '/h',
        COPILOT_GITHUB_TOKEN: 'c',
        GH_TOKEN: 'g',
        GITHUB_TOKEN: 't'
      },
      '/p',
      'darwin',
      ['COPILOT_ALLOW_ALL']
    )
    expect(env).not.toHaveProperty('COPILOT_ALLOW_ALL')
    expect(env).toMatchObject({
      COPILOT_ALLOW_ALL_TOOLS: '1',
      COPILOT_HOME: '/h',
      COPILOT_GITHUB_TOKEN: 'c',
      GH_TOKEN: 'g',
      GITHUB_TOKEN: 't'
    })
  })

  it('win32 は追加の除外も大文字小文字を無視する', () => {
    const env = buildAgentEnv({ copilot_allow_all: 'true' }, 'C:\\p', 'win32', [
      'COPILOT_ALLOW_ALL'
    ])
    expect(env).not.toHaveProperty('copilot_allow_all')
  })
})
```

`src/main/__tests__/agentRuntime.test.ts` を作る（起動のたびに設定を読むこと。設計書「起動での読み込み」・L-466）:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// agentRuntime は実物の依存(node-pty)を組み立てる。ここでは設定の読み込みと解決への受け渡しだけを確かめる
vi.mock('node-pty', () => ({ spawn: vi.fn() }))
const mockGetAgentCliKindSetting = vi.hoisted(() => vi.fn())
vi.mock('../agentCliKindStore', () => ({ getAgentCliKindSetting: mockGetAgentCliKindSetting }))
const mockResolveAgentLaunch = vi.hoisted(() => vi.fn())
vi.mock('../agentCommand', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentCommand')>()),
  resolveAgentLaunch: mockResolveAgentLaunch
}))

import { resolveAgentLaunchFromSystem } from '../agentRuntime'

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveAgentLaunch.mockResolvedValue({
    kind: 'not-found',
    cliKind: 'claude',
    shellPathUnavailable: false
  })
})

describe('resolveAgentLaunchFromSystem', () => {
  it('起動のたびに設定を読み、読んだ種類で解決する(保存した値は次の起動から使われる)', async () => {
    mockGetAgentCliKindSetting
      .mockResolvedValueOnce({ kind: 'copilot', fallback: null })
      .mockResolvedValueOnce({ kind: 'claude', fallback: 'invalid-value' })
    await resolveAgentLaunchFromSystem()
    await resolveAgentLaunchFromSystem()
    expect(mockGetAgentCliKindSetting).toHaveBeenCalledTimes(2)
    expect(mockResolveAgentLaunch.mock.calls.map(([deps]) => deps.cliKind)).toEqual([
      'copilot',
      'claude'
    ])
  })
})
```

`src/main/__tests__/agentSessionStarter.test.ts`:

1. `OK_LAUNCH` の `plan` に `cliKind: 'claude'` を足す
2. `resolveLaunch.mockResolvedValueOnce({ kind: 'not-found', shellPathUnavailable: … })` の 2 か所（`コマンドが見つからなければ command-not-found…` と `claude が見つからなければ prepare しない`）に `cliKind: 'claude'` を足す
3. `コマンドが見つからなければ command-not-found…` の次に足す:

```ts
it('copilot が見つからなければ、command-not-found に copilot を載せる(文言はその種類の名前で出す)', async () => {
  resolveLaunch.mockResolvedValueOnce({
    kind: 'not-found',
    cliKind: 'copilot',
    shellPathUnavailable: false
  })
  const start = makeStarter()
  await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
    kind: 'error',
    error: 'command-not-found',
    cliKind: 'copilot',
    shellPathUnavailable: false
  })
  expect(spawnPty).not.toHaveBeenCalled()
})
```

`src/main/__tests__/handlers/agentTerminalHandlers.test.ts` の `plan: { file: '/bin/claude', args: [], env: { PATH: '/p' } }`（4 か所）に `cliKind: 'claude'` を、`resolveLaunch.mockResolvedValueOnce({ kind: 'not-found', shellPathUnavailable: true })` に `cliKind: 'claude'` を足す。`src/main/__tests__/agentHookSessions.test.ts` の `PLAN` に `cliKind: 'claude'` を足す。

```bash
cd <repo-root>
F=src/main/__tests__/handlers/agentTerminalHandlers.test.ts
test -f "$F" && perl -pi -e "s/plan: \{ file: '\/bin\/claude'/plan: { cliKind: 'claude', file: '\/bin\/claude'/g" "$F"
grep -c "cliKind: 'claude', file: '/bin/claude'" "$F"
```

Expected: `4`

`src/main/__tests__/agentHooks.integration.test.ts` の `sessions.prepare(1, { file: '/bin/claude', args: [], env: {} })`（4 か所）にも `cliKind: 'claude'` を足す（必須にした `AgentLaunchPlan.cliKind` で typecheck が落ちず、Task 3b で `prepare` が `agentCliCapabilities(plan.cliKind)` を読んでも `undefined` にならないように）:

```bash
cd <repo-root>
F=src/main/__tests__/agentHooks.integration.test.ts
test -f "$F" && perl -pi -e "s/sessions\.prepare\(1, \{ file: '\/bin\/claude'/sessions.prepare(1, { cliKind: 'claude', file: '\/bin\/claude'/g" "$F"
grep -c "sessions.prepare(1, { cliKind: 'claude', file: '/bin/claude'" "$F"
npx prettier --write "$F"
grep -c "cliKind: 'claude'" "$F"
```

Expected: `4` と `4`（prettier が 100 桁を超えた行を折り返すので、2 つ目は `cliKind: 'claude'` の数で確かめる）

- [ ] **Step 3: 失敗するテストを書く（偽の実行ファイルの統合テスト）**

`src/main/__tests__/agentCliLaunch.integration.test.ts` を作る:

```ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn as ptySpawn } from 'node-pty'
import { isExecutableRegularFile, resolveAgentLaunch } from '../agentCommand'
import type { AgentLaunchPlan } from '../agentCommand'
import { startAgentSession } from '../agentSession'
import type { AgentSession, AgentSessionExitInfo, PtySpawn } from '../agentSession'
import { stopProcessTree } from '../agentProcessTree'
import { createTestTimers, waitForFile } from './helpers/processProbe'

// 実物の node-pty と偽の copilot(`#!/usr/bin/env node` のスクリプト)で、選んだ CLI の解決と起動を確かめる(設計書「テスト方針」。
// L-059)。本物の copilot は起動しない。HOME は一時ディレクトリで、利用者の ~/.copilot・~/.gitconfig・~/.claude に書かない。
// process.env は書き換えず、親の環境は resolveAgentLaunch の env に渡す。Windows は対象外。
// テストを動かす node の場所(dirname(process.execPath))には実物の copilot があることがある(nvm)。PATH にはその場所を入れず、
// node へのシンボリックリンクだけを置いた一時ディレクトリを入れ、さらに起動の前に解決された file が偽物であることを確かめる
const spawn: PtySpawn = (file, args, options) => ptySpawn(file, args, options)
const timers = createTestTimers()
// テストが起動したプロセスの印(`pgrep -fl amt-test-` で残りを確かめられる。agentSession.integration.test.ts と同じ形)
const MARKER = `amt-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}-`
let dir: string
let nodeDir: string
const started: AgentSession[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), MARKER))
  // node だけを置いた PATH の場所(shebang の env node をここで解決する。実物の copilot を PATH に入れない)
  nodeDir = join(dir, 'node-only')
  mkdirSync(nodeDir)
  symlinkSync(process.execPath, join(nodeDir, 'node'))
})

afterEach(async () => {
  for (const session of started.splice(0)) await session.stop('stopped')
  timers.clearAll()
  rmSync(dir, { recursive: true, force: true })
})

/** binDir の下に copilot という名の実行ファイルを書く(warm-up はしない。本文を引数なしで 1 回だけ動かすため) */
function writeFakeCopilot(binDir: string, lines: readonly string[]): void {
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, 'copilot'), `${lines.join('\n')}\n`, { mode: 0o755 })
}

/**
 * main と同じ解決で copilot の計画を作る。ログインシェルの PATH の代わりに、偽の copilot の場所と、node だけを置いた場所を返す。
 * 解決された file が偽物でなければ、起動せずに投げる(実物の copilot を起動しない)
 */
async function resolveCopilot(binDir: string): Promise<AgentLaunchPlan> {
  const resolution = await resolveAgentLaunch({
    env: { HOME: dir, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', COPILOT_ALLOW_ALL: 'true' },
    platform: process.platform,
    cliKind: 'copilot',
    readLoginShellPath: async () => `${binDir}:${nodeDir}`,
    isExecutable: isExecutableRegularFile
  })
  if (resolution.kind !== 'ok')
    throw new Error(`copilot が見つかりません: ${JSON.stringify(resolution)}`)
  const fake = join(binDir, 'copilot')
  if (resolution.plan.file !== fake)
    throw new Error(`偽の copilot ではないため起動しません: ${resolution.plan.file}(期待: ${fake})`)
  return resolution.plan
}

/** 計画のとおりに pty で起動し、終了を待つ */
function runPlan(plan: AgentLaunchPlan, cwd: string): Promise<AgentSessionExitInfo> {
  return new Promise((resolve) => {
    const session = startAgentSession({
      id: 'copilot-it',
      spawn,
      file: plan.file,
      args: plan.args,
      env: plan.env,
      cwd,
      cols: 80,
      rows: 24,
      callbacks: { onData: () => undefined, onExit: (exit) => resolve(exit) },
      stopTree: (pty, exited) => stopProcessTree({ pid: pty.pid, exited })
    })
    started.push(session)
  })
}

describe.skipIf(process.platform === 'win32')('copilot の起動(実物の pty と偽の copilot)', () => {
  it('引数なし・作業ディレクトリは許可のフォルダ・COPILOT_ALLOW_ALL なしで起動し、shebang の env node は渡した PATH で解決される', async () => {
    const binDir = join(dir, 'bin')
    const work = join(dir, 'work')
    mkdirSync(work)
    const report = join(dir, 'report.json')
    writeFakeCopilot(binDir, [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      `fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), allowAll: process.env.COPILOT_ALLOW_ALL ?? null }))`
    ])
    const plan = await resolveCopilot(binDir)
    expect(plan).toMatchObject({ cliKind: 'copilot', file: join(binDir, 'copilot'), args: [] })
    const exit = await runPlan(plan, work)
    // 報告が書かれた = スクリプトが動いた = env node が pty の PATH(copilot を見つけたのと同じ値)で解決された
    expect(JSON.parse(await waitForFile(report, timers))).toEqual({
      args: [],
      cwd: realpathSync(work),
      allowAll: null
    })
    expect(exit.exitCode).toBe(0)
  }, 20_000)

  // 既定の探索先(/usr/local/bin・/opt/homebrew/bin)に node がある環境でも確かめられるよう、存在しない解釈系の名前にする(設計書「テスト方針」)
  it('shebang の解釈系が pty の PATH で見つからないと、起動の直後に 0 以外で終わる(本文は動かない)', async () => {
    const binDir = join(dir, 'bin-missing')
    const report = join(dir, 'report-missing.json')
    writeFakeCopilot(binDir, [
      '#!/usr/bin/env prompt-ide-missing-node',
      `require('node:fs').writeFileSync(${JSON.stringify(report)}, 'ran')`
    ])
    const plan = await resolveCopilot(binDir)
    const exit = await runPlan(plan, dir)
    expect(exit.exitCode).not.toBe(0)
    expect(existsSync(report)).toBe(false)
  }, 20_000)
})
```

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentCliLaunchSpecs.test.ts src/main/__tests__/agentCommand.test.ts src/main/__tests__/agentRuntime.test.ts src/main/__tests__/agentCliLaunch.integration.test.ts src/main/__tests__/agentSessionStarter.test.ts`
Expected: FAIL（`agentCliLaunchSpecs` が無い・`resolveAgentLaunch` が `cliKind` を使わない・計画に種類が無い・`copilot` の command-not-found が `claude` のまま）

- [ ] **Step 5: 起動の表を実装する**

`src/main/agentCliLaunchSpecs.ts` を作る:

```ts
import type { AgentLaunchRequest } from '@shared/types'
import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'

// CLI の種類ごとの起動の表(設計書 2026-10-20「起動の表」)。コマンドの名前・引数・追加で取り除く環境変数は main だけが決め、
// renderer からは受け取らない(L-019)。引数に入れるのは、main が検証した会話の ID と main が作った設定のファイルの絶対パスだけ(L-034)。
// 能力の表(sessionResume・changeAttribution)に合わない値が渡ったら投げる(呼び出し側の取り違えを黙って捨てない。L-044)

export interface AgentCliLaunchSpec {
  /** 探すコマンドの名前(AGENT_CLI_PROFILES[kind].commandName) */
  commandName: string
  /** すべての CLI で取り除く一覧に足して取り除く環境変数(完全一致) */
  extraRemovedEnvKeys: readonly string[]
  /**
   * 起動の引数。claudeSessionId と hookSettingsPath は、能力の表で sessionResume・changeAttribution が true の種類だけが受け取り、
   * false の種類に値が渡ったら投げる(呼び出し側の取り違えを黙って捨てない。L-044)
   */
  buildArgs(
    launch: AgentLaunchRequest,
    claudeSessionId: string | null,
    hookSettingsPath: string | null
  ): string[]
}

/** 起動の指定の種類を足したときに既定の引数へ流さないよう、未知の kind は投げる(L-044) */
function throwUnknownLaunch(launch: never): never {
  throw new Error(`未知の起動の指定です: ${JSON.stringify(launch)}`)
}

/**
 * claude の起動の引数(MVP からの buildAgentLaunchArgs と同じ中身。hooks の設計書「起動の引数」)。新しく起動するときは main が振った
 * ID を --session-id で、再開は記録と照合した ID を --resume で渡す。hookSettingsPath があれば後ろに --settings を足す
 */
function buildClaudeArgs(
  launch: AgentLaunchRequest,
  claudeSessionId: string | null,
  hookSettingsPath: string | null
): string[] {
  if (claudeSessionId === null) throw new Error('claude の起動には会話の ID が要ります')
  const settings = hookSettingsPath === null ? [] : ['--settings', hookSettingsPath]
  switch (launch.kind) {
    case 'new':
      return ['--session-id', claudeSessionId, ...settings]
    case 'resume':
      return ['--resume', claudeSessionId, ...settings]
    default:
      return throwUnknownLaunch(launch)
  }
}

/**
 * copilot の起動の引数。引数なしで対話のセッションになる。作業ディレクトリは pty の cwd で決め、-C・--session-id・--resume・
 * --allow-*・--yolo などは付けない(設計書「copilot の引数」)。再開は starter が resume-unsupported で先に断る
 */
function buildCopilotArgs(
  launch: AgentLaunchRequest,
  claudeSessionId: string | null,
  hookSettingsPath: string | null
): string[] {
  if (claudeSessionId !== null) throw new Error('copilot の起動に会話の ID は渡せません')
  if (hookSettingsPath !== null)
    throw new Error('copilot の起動に hooks の設定のファイルは渡せません')
  switch (launch.kind) {
    case 'new':
      return []
    case 'resume':
      throw new Error('copilot はセッションの再開に対応していません')
    default:
      return throwUnknownLaunch(launch)
  }
}

export const AGENT_CLI_LAUNCH_SPECS: Record<AgentCliKind, AgentCliLaunchSpec> = {
  claude: {
    commandName: AGENT_CLI_PROFILES.claude.commandName,
    extraRemovedEnvKeys: [],
    buildArgs: buildClaudeArgs
  },
  copilot: {
    commandName: AGENT_CLI_PROFILES.copilot.commandName,
    // アプリが起動した CLI の許可を自動で全部にしない(claude に --dangerously-skip-permissions を付けないのと同じ方針)
    extraRemovedEnvKeys: ['COPILOT_ALLOW_ALL'],
    buildArgs: buildCopilotArgs
  }
}
```

- [ ] **Step 6: 解決・環境変数・設定の読み込みを実装する**

`src/main/agentCommand.ts`:

1. `import type { AgentLaunchRequest } from '@shared/types'` を消し、`import type { AgentCliKind } from '@shared/agentCliKinds'` と `import { AGENT_CLI_LAUNCH_SPECS } from './agentCliLaunchSpecs'` を足す
2. `AGENT_COMMAND_NAME`（コメントを含む）と `buildAgentLaunchArgs`（JSDoc を含む）を消す
3. `REMOVED_AGENT_ENV_KEYS` の JSDoc の先頭に「すべての CLI で取り除く。」を足す
4. `buildAgentEnv` を次の形にする（本体は `REMOVED_AGENT_ENV_PREFIXES` の行の次に 1 行足すだけ）:

```ts
/**
 * pty へ渡す環境変数(設計書「環境変数」)。base を写し、取り除く変数(すべての CLI の一覧と、種類ごとの追加の一覧)を除き、
 * PATH・TERM・COLORTERM・LANG を設定し、NO_PROXY・no_proxy にループバックを足す。platform と追加の一覧は省略できない(L-060)
 */
export function buildAgentEnv(
  base: NodeJS.ProcessEnv,
  pathValue: string,
  platform: NodeJS.Platform,
  extraRemovedKeys: readonly string[]
): Record<string, string> {
```

```ts
if (REMOVED_AGENT_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))) continue
// 種類ごとの追加の除外(copilot の COPILOT_ALLOW_ALL)。名前は大文字で持ち、Windows は normalize で大文字にそろう
if (extraRemovedKeys.includes(name)) continue
```

5. `AgentLaunchPlan`・`AgentLaunchResolution`・`ResolveAgentLaunchDeps` を Interfaces のとおりにする（`AgentLaunchPlan` の JSDoc: `cliKind` は「main が設定から読んだ種類(後の手順はこの値を使い、読み直さない。L-018)」、`file` は「起動する CLI の絶対パス」、`args` は「引数(空。セッションの指定と --settings は starter が起動の表の buildArgs で後ろに足す)」。`ResolveAgentLaunchDeps.cliKind` は「main が設定から読んだ種類(renderer の値ではない)」）
6. `resolveAgentLaunch` の分割代入に `cliKind` を足し、探索と戻り値を次にする（PATH の決め方は変えない）:

```ts
const spec = AGENT_CLI_LAUNCH_SPECS[cliKind]
const file = await findExecutableInPath(spec.commandName, pathValue, {
  platform,
  pathExt: platform === 'win32' ? getEnvIgnoreCase(env, 'PATHEXT') : undefined,
  isExecutable
})
if (file === null) return { kind: 'not-found', cliKind, shellPathUnavailable }
return {
  kind: 'ok',
  plan: {
    cliKind,
    file,
    args: [],
    env: buildAgentEnv(env, pathValue, platform, spec.extraRemovedEnvKeys)
  }
}
```

（JSDoc の「claude を探す」を「設定の種類のコマンド(起動の表の commandName)を探す」にする）

`src/main/agentRuntime.ts`: import に `import { getAgentCliKindSetting } from './agentCliKindStore'` を足し、`resolveAgentLaunchFromSystem` を次にする:

```ts
// 起動のたびに main が設定を読む(renderer の値は使わない。L-019)。保存した値は、保存の後に始まった起動から使われる(L-466)。
// 読んだ種類は計画に入れ、後の手順(探索・引数・環境変数・hooks・再開の可否・記録)はその値を使う(L-018)
export const resolveAgentLaunchFromSystem = async (): Promise<AgentLaunchResolution> =>
  resolveAgentLaunch({
    env: process.env,
    platform: process.platform,
    cliKind: (await getAgentCliKindSetting()).kind,
    readLoginShellPath: () => readLoginShellPath({ userShell: currentUserShell() }),
    isExecutable: isExecutableRegularFile
  })
```

`src/main/agentSessionStarter.ts`:

1. `import { buildAgentLaunchArgs } from './agentCommand'` を `import { AGENT_CLI_LAUNCH_SPECS } from './agentCliLaunchSpecs'` にする（冒頭のコメントの `agentCommand.buildAgentLaunchArgs` を `agentCliLaunchSpecs の種類ごとの buildArgs` にする）
2. `spawnSession` の `...buildAgentLaunchArgs(` を `...AGENT_CLI_LAUNCH_SPECS[plan.cliKind].buildArgs(` にする（引数はそのまま。能力による分岐は Task 3b）
3. `command-not-found` の `// 段階 1 の途中(main): Task 3a …` の行を消し、`cliKind: DEFAULT_AGENT_CLI_KIND` を `cliKind: launch.cliKind` にする（`DEFAULT_AGENT_CLI_KIND` の import は `recordStarted`・`alreadyRunning` がまだ使う）

- [ ] **Step 7: テストが通ることを確かめる**

Run: Step 4 と同じコマンドに `src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentHooks.integration.test.ts src/main/__tests__/agentSession.integration.test.ts` を足して流す
Expected: PASS
Run: `pgrep -fl amt-test- || true`
Expected: 何も出ない（統合テストの子が残っていない）

- [ ] **Step 8: 変異で確かめる**

1. `buildAgentEnv` の `if (extraRemovedKeys.includes(name)) continue` を消す → `copilot の計画の環境変数だけから COPILOT_ALLOW_ALL を取り除く…`・`追加の除外は完全一致で…`・統合テストの 1 つ目（`allowAll: 'true'` になる）が落ちる。戻す
2. `resolveAgentLaunch` の `spec.commandName` を `'claude'` にする → `copilot は copilot を探し…`・統合テストが落ちる。戻す
3. `resolveAgentLaunchFromSystem` の `(await getAgentCliKindSetting()).kind` を `'claude'` にする → `起動のたびに設定を読み…` が落ちる。戻す
4. `buildCopilotArgs` の `case 'new': return []` を `return ['-C', '.']` にする → `new は引数なし…`・統合テストの 1 つ目が落ちる。戻す
5. `git diff` で戻したことを確かめる（`agentCliLaunchSpecs.ts` は新規なので `grep -n "case 'new':" -A1 src/main/agentCliLaunchSpecs.ts` で `return []` に戻ったことを確かめる）

- [ ] **Step 9: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/main/agentCliLaunchSpecs.ts src/main/agentCommand.ts src/main/agentRuntime.ts src/main/agentSessionStarter.ts src/main/__tests__/agentCliLaunchSpecs.test.ts src/main/__tests__/agentCommand.test.ts src/main/__tests__/agentRuntime.test.ts src/main/__tests__/agentCliLaunch.integration.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentHooks.integration.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check <同じファイル>`
Expected: すべて整形済み
Run: `grep -rn "AGENT_COMMAND_NAME\|buildAgentLaunchArgs" src`
Expected: 何も出ない

---

### Task 3b: main の起動の能力による分岐・状態の取得・hooks

> **設計書の読む節:** 「main の起動」の「起動の手順」（1〜6 と、その後の段落）・「版」・「hooks」・「前回の続きから（main）」、「記録と履歴」、「エラー処理」の再開の拒否の行、「テスト方針」の `agentSessionStarter.test.ts`・`agentHookSessions.test.ts`・`agentTerminalHandlers.test.ts`。
>
> **気をつける知見:** L-001（再開の拒否は `resume-unsupported` を返して起動しない）・L-018（計画の種類だけを使う）・L-041（再開は renderer に加えて main でも断る。hooks は main の `prepare` で `cli-unsupported`）・L-043（`copilot` の実行ファイルに `claude` の版の確認を通さない）・L-044（`recordStarted` は種類が入っていない取り違えを投げる）

**Files:**

- Modify: `src/main/agentSessionStarter.ts`・`src/main/agentSessionSnapshot.ts`・`src/main/handlers/agentTerminalHandlers.ts`・`src/main/ipcHandlers.ts`・`src/main/agentHookSessions.ts`・`src/main/agentToolActivity.ts`
- Test: `src/main/__tests__/agentSessionStarter.test.ts`・`src/main/__tests__/agentSessionSnapshot.test.ts`・`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`・`src/main/__tests__/ipcHandlers.test.ts`・`src/main/__tests__/agentHookSessions.test.ts`・`src/main/__tests__/agentToolActivity.test.ts`

**Interfaces:**

- Consumes: Task 1 の `agentCliCapabilities`・`AgentStartResult`・`AgentSessionSnapshotEntry`、Task 3a の `AgentLaunchPlan.cliKind`・`AGENT_CLI_LAUNCH_SPECS`
- Produces:

```ts
// src/main/agentSessionStarter.ts
export interface AgentSessionInfo {
  cliKind: AgentCliKind
  claudeSessionId: string | null
}
export interface AgentSessionStarterService {
  start: AgentSessionStarter
  /** pty の sessionId → 種類と claude の会話の ID(claudeSessionIdOf を置き換える) */
  sessionInfoOf(sessionId: string): AgentSessionInfo | undefined
  lastSessionOf(ownerId: number, folderPath: string): Promise<AgentLastSession | null>
}
// src/main/agentSessionSnapshot.ts
export function attachSessionInfo(
  entries: readonly AgentRegistrySnapshotEntry[],
  sessionInfoOf: (sessionId: string) => AgentSessionInfo | undefined
): AgentSessionSnapshotEntry[]
// src/main/handlers/agentTerminalHandlers.ts
AgentTerminalHandlerDeps.sessionInfoOf: AgentSessionStarterService['sessionInfoOf']
// src/main/agentToolActivity.ts
export type AgentHooksUnavailableReason =
  | 'receiver-unavailable'
  | 'claude-version-unsupported'
  | 'cli-unsupported'
```

- [ ] **Step 1: 失敗するテストを書く（starter）**

`src/main/__tests__/agentSessionStarter.test.ts`:

1. ファイル全体の `claudeSessionIdOf` を `sessionInfoOf` にする（`perl -pi -e 's/claudeSessionIdOf/sessionInfoOf/g' src/main/__tests__/agentSessionStarter.test.ts`）
2. `.toBe(NEW_IDS[0])` で `sessionInfoOf(…)` の値を比べている 2 か所（`new は ID を振って --session-id で起動し…` と `セッションの exited で Map から消え…`）を `.toEqual({ cliKind: 'claude', claudeSessionId: NEW_IDS[0] })` にする。`セッションの exited で Map から消え…` の `const observed: (string | undefined)[] = []` を `const observed: (AgentSessionInfo | undefined)[] = []` にし、型の import（`from '../agentSessionStarter'` の `import type`）に `AgentSessionInfo` を足す。`sessionInfoOf のキーは pty の sessionId で…`（名前を変えた後のテスト名）の `.toBeUndefined()` はそのまま
3. 末尾に足す:

```ts
describe('createAgentSessionStarter(CLI の種類)', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  const COPILOT_LAUNCH: AgentLaunchResolution = {
    kind: 'ok',
    plan: { cliKind: 'copilot', file: '/bin/copilot', args: [], env: { PATH: '/p' } }
  }

  beforeEach(async () => {
    resolveLaunch.mockResolvedValue(COPILOT_LAUNCH)
    await records.whenLoaded()
  })

  it('copilot の計画で起動すると、引数は空で、会話の ID を振らず・予約せず・記録せず、結果に copilot と null を載せる', async () => {
    const recordSpy = vi.spyOn(records, 'record')
    const reserveSpy = vi.spyOn(reservations, 'tryReserve')
    const { start, sessionInfoOf } = makeStarterService()
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    expect(spawnPty).toHaveBeenCalledWith('/bin/copilot', [], {
      name: 'xterm-256color',
      cols: 90,
      rows: 20,
      cwd: '/work',
      env: { PATH: '/p' }
    })
    expect(recordSpy).not.toHaveBeenCalled()
    expect(reserveSpy).not.toHaveBeenCalled()
    expect(claudeIdCount).toBe(0)
    expect(records.last('/work')).toBeNull()
    expect(sessionInfoOf('sid-1')).toEqual({ cliKind: 'copilot', claudeSessionId: null })
  })

  it('copilot で resume の依頼は resume-unsupported で断り、hooks.prepare も spawn も呼ばない(起動しない。L-041)', async () => {
    records.record('/work', ID)
    const start = makeStarter()
    await expect(
      start(1, { ...REQUEST, launch: { kind: 'resume', claudeSessionId: ID } }, makeSink())
    ).resolves.toEqual({ kind: 'error', error: 'resume-unsupported' })
    expect(hooks.prepare).not.toHaveBeenCalled()
    expect(spawnPty).not.toHaveBeenCalled()
    expect(registry.snapshot(1)).toEqual([])
  })

  it('copilot の already-running は、動いているセッションの種類と null を返す', async () => {
    const start = makeStarter()
    await start(1, REQUEST, makeSink())
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'already-running',
      sessionId: 'sid-1',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    expect(spawnPty).toHaveBeenCalledOnce()
  })

  it('copilot のセッションの exited で sessionInfoOf から消える', async () => {
    const { start, sessionInfoOf } = makeStarterService()
    await start(1, REQUEST, makeSink())
    pty.emitExit(0)
    await vi.waitFor(() => expect(sessionInfoOf('sid-1')).toBeUndefined())
  })

  it('hooks が設定のファイルを返しても(copilot では本来返さない)、copilot の引数には --settings を足さない', async () => {
    hooks = makeFakeAgentHookSessions((ownerId) => ({
      ownerId,
      hooks: { settingsPath: '/tmp/prompt-ide-agent-hooks-x/abc.json', token: 'ab'.repeat(32) },
      unavailableReason: null
    }))
    await makeStarter({ hooks })(1, REQUEST, makeSink())
    expect(spawnPty).toHaveBeenCalledWith('/bin/copilot', [], expect.any(Object))
  })

  it('claude の計画では今までどおり ID を振って記録・予約し、結果と控えに claude を載せる', async () => {
    resolveLaunch.mockResolvedValue(OK_LAUNCH)
    const { start, sessionInfoOf } = makeStarterService()
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      cliKind: 'claude',
      claudeSessionId: NEW_IDS[0]
    })
    expect(records.last('/work')).toBe(NEW_IDS[0])
    expect(reservations.tryReserve(NEW_IDS[0])).toBeNull()
    expect(sessionInfoOf('sid-1')).toEqual({ cliKind: 'claude', claudeSessionId: NEW_IDS[0] })
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（状態の取得・受け口・組み立て・hooks・追跡）**

`src/main/__tests__/agentSessionSnapshot.test.ts` を次に置き換える:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { attachSessionInfo } from '../agentSessionSnapshot'
import type { AgentSessionInfo } from '../agentSessionStarter'

const ID_A = '11111111-1111-4111-8111-111111111111'

describe('attachSessionInfo', () => {
  let warnSpy: MockInstance<typeof console.warn> | null = null

  afterEach(() => {
    warnSpy?.mockRestore()
    warnSpy = null
  })

  it('各セッションに種類と claude の会話の ID(再開に対応しない種類は null)を足し、順序を保つ', () => {
    const infos = new Map<string, AgentSessionInfo>([
      ['s1', { cliKind: 'claude', claudeSessionId: ID_A }],
      ['s2', { cliKind: 'copilot', claudeSessionId: null }]
    ])
    expect(
      attachSessionInfo(
        [
          { slotId: 'tab-1', sessionId: 's1' },
          { slotId: 'tab-2', sessionId: 's2' }
        ],
        (sessionId) => infos.get(sessionId)
      )
    ).toEqual([
      { slotId: 'tab-1', sessionId: 's1', cliKind: 'claude', claudeSessionId: ID_A },
      { slotId: 'tab-2', sessionId: 's2', cliKind: 'copilot', claudeSessionId: null }
    ])
  })

  it('情報が引けないセッションだけを外して警告を出し、ほかは返す', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(
      attachSessionInfo(
        [
          { slotId: 'tab-1', sessionId: 'gone' },
          { slotId: 'tab-2', sessionId: 's2' }
        ],
        (sessionId) =>
          sessionId === 's2' ? { cliKind: 'copilot', claudeSessionId: null } : undefined
      )
    ).toEqual([{ slotId: 'tab-2', sessionId: 's2', cliKind: 'copilot', claudeSessionId: null }])
    expect(warnSpy).toHaveBeenCalledWith(
      '[agentTerminal:getState] セッションの種類と会話の ID が見つからないセッションを一覧から外します:',
      'gone'
    )
  })

  it('空の一覧は空', () => {
    expect(attachSessionInfo([], () => ({ cliKind: 'claude', claudeSessionId: ID_A }))).toEqual([])
  })
})
```

`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`:

1. `register` の `claudeSessionIdOf: starter.claudeSessionIdOf` を `sessionInfoOf: starter.sessionInfoOf` にする
2. `describe('agentTerminal:getState(claude のセッション ID)', …)` の `register({ claudeSessionIdOf: () => undefined })` を `register({ sessionInfoOf: () => undefined })` に、警告の文言を `'[agentTerminal:getState] セッションの種類と会話の ID が見つからないセッションを一覧から外します:'` にし、同じ describe の中に足す:

```ts
it('copilot のセッションは、種類と null の会話の ID を載せて返す', async () => {
  resolveLaunch.mockResolvedValue({
    kind: 'ok',
    plan: { cliKind: 'copilot', file: '/bin/copilot', args: [], env: { PATH: '/p' } }
  })
  register()
  folderAccess.set(1, '/work')
  const event = makeEvent()
  await expect(
    start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
  ).resolves.toEqual({
    kind: 'started',
    sessionId: 'sid-1',
    cliKind: 'copilot',
    claudeSessionId: null
  })
  expect(handles.get('agentTerminal:getState')?.(event)).toEqual([
    { slotId: 'slot-1', sessionId: 'sid-1', cliKind: 'copilot', claudeSessionId: null }
  ])
})
```

（describe の名前は `agentTerminal:getState(種類と claude のセッション ID)` にする）

`src/main/__tests__/ipcHandlers.test.ts` の `mockClaudeSessionIdOf` を `mockSessionInfoOf` に、`claudeSessionIdOf:` を `sessionInfoOf:` に、`deps.claudeSessionIdOf` を `deps.sessionInfoOf` にする（`perl -pi -e 's/mockClaudeSessionIdOf/mockSessionInfoOf/g; s/claudeSessionIdOf/sessionInfoOf/g' src/main/__tests__/ipcHandlers.test.ts`）。

`src/main/__tests__/agentHookSessions.test.ts` の `describe('createAgentHookSessions: prepare', …)` の中の末尾に足す:

```ts
it('種類の能力に区別(changeAttribution)が無ければ、版の読み取りも受け口の用意もせず cli-unsupported(copilot に claude の版の確認を通さない。L-043)', async () => {
  const COPILOT_PLAN: AgentLaunchPlan = {
    cliKind: 'copilot',
    file: '/bin/copilot',
    args: [],
    env: { PATH: '/p' }
  }
  await expect(sessions().prepare(7, COPILOT_PLAN)).resolves.toEqual({
    ownerId: 7,
    hooks: null,
    unavailableReason: 'cli-unsupported'
  })
  expect(calls).toEqual([])
  expect(deps.log).not.toHaveBeenCalled()
})
```

`describe('createAgentHookSessions: activate・release', …)` の中の末尾に足す:

```ts
it('cli-unsupported の prepared を activate すると、追跡に unconfirmed(cli-unsupported)で足すだけ', () => {
  sessions().activate({ ownerId: 7, hooks: null, unavailableReason: 'cli-unsupported' }, 'sid-1')
  expect(deps.tracker.addSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1', {
    kind: 'unconfirmed',
    reason: 'cli-unsupported'
  })
  expect(deps.receiver.addToken).not.toHaveBeenCalled()
})
```

`src/main/__tests__/agentToolActivity.test.ts` の `hooks なしで起動した(unconfirmed)セッションがあれば、区別をやめる合図と agent` の次に足す:

```ts
it('区別に対応しない CLI(cli-unsupported)のセッションがあれば、その理由で区別をやめる合図を出す', () => {
  confirmed()
  tracker.addSession(1, 's2', { kind: 'unconfirmed', reason: 'cli-unsupported' })
  expect(tracker.activityOf(1)).toEqual({
    phase: 'agent',
    lost: 'cli-unsupported',
    unassignable: false
  })
})
```

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/agentSessionSnapshot.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentToolActivity.test.ts`
Expected: FAIL（`sessionInfoOf`・`attachSessionInfo` が無い・copilot で記録と予約をする・`resume-unsupported` を返さない）。ただし `agentToolActivity.test.ts` の `区別に対応しない CLI(cli-unsupported)のセッションがあれば…` と `agentHookSessions.test.ts` の `cli-unsupported の prepared を activate すると…` の 2 つは、vitest が型を検査しないため実行時には通る（不具合ではない）。この 2 つは次の typecheck で落ちる
Run: `npm run typecheck`
Expected: FAIL（`'cli-unsupported'` が `AgentHooksUnavailableReason` に無いことによる型エラーを含む）

- [ ] **Step 4: starter を実装する**

`src/main/agentSessionStarter.ts`:

1. import: `import { DEFAULT_AGENT_CLI_KIND } from '@shared/agentCliKinds'` を `import { agentCliCapabilities } from '@shared/agentCliKinds'` と `import type { AgentCliKind } from '@shared/agentCliKinds'` にする
2. `AgentSessionStarterService` の `claudeSessionIdOf` を次に置き換え、その上に `AgentSessionInfo` を置く:

```ts
/** pty のセッションの CLI の種類と claude の会話の ID(再開に対応しない種類は null)。already-running と状態の取得で返す */
export interface AgentSessionInfo {
  cliKind: AgentCliKind
  claudeSessionId: string | null
}
```

```ts
  /**
   * pty の sessionId → 種類と claude の会話の ID。作ったセッションの exited の解決で消す(消す購読はセッションを registry へ返す前に
   * 付けるため、registry が枠からセッションを外すより先に消える)。無ければ undefined
   */
  sessionInfoOf(sessionId: string): AgentSessionInfo | undefined
```

3. `CreatedClaudeSession` を次にする:

```ts
/** この依頼の create で作ったセッションの種類と claude の会話の ID の受け渡し(registry が started を返したときに記録する)。
 *  cliKind の null は「まだ入っていない」(spawnSession が created を返す直前に入れる) */
interface CreatedClaudeSession {
  cliKind: AgentCliKind | null
  claudeSessionId: string | null
}
```

4. `const claudeSessionIdBySessionId = new Map<string, string>()` を `const sessionInfoBySessionId = new Map<string, AgentSessionInfo>()` にする（コメントは「pty の sessionId → 種類と claude の会話の ID(already-running・作り直しの後の合わせ込みで返す)」）
5. `startHeld` の受け渡しを `{ cliKind: null, claudeSessionId: null }` で作り、`return finishStart(result, folderKey, createdClaudeSession)` にする
6. `createSession` の `resolveLaunch()` の `not-found` の後（`hooks.prepare` の前）に足す:

```ts
// 再開の依頼で、使う CLI が再開に対応していなければ、hooks を準備する前に断る(起動しない。renderer の理由に加えた main の守り。L-041)
if (request.launch.kind === 'resume' && !agentCliCapabilities(launch.plan.cliKind).sessionResume) {
  return { kind: 'failed', result: { kind: 'error', error: 'resume-unsupported' } }
}
```

7. `spawnSession` の先頭から `releaseReservation` までを次に置き換え、引数・`Map`・受け渡しを直す（`startAgentSession` の呼び出しの `args` 以外と、`exited` の後始末の順はそのまま）:

```ts
const capabilities = agentCliCapabilities(plan.cliKind)
// 会話の ID の選択・予約は再開に対応する種類(claude)だけ。copilot は ID を選ばず予約もしない(設計書「起動の手順」4)
let claudeSessionId: string | null = null
if (capabilities.sessionResume) {
  const selection = selectClaudeSessionId(request.launch, folderKey, records, createClaudeSessionId)
  if (selection.kind === 'rejected') return { kind: 'failed', result: selection.result }
  claudeSessionId = selection.claudeSessionId
}
// 予約の後で投げて予約が残らないよう、ID は予約の前に振る
const sessionId = createSessionId()
// 新しい ID も予約する(UUID の衝突は起きない前提だが、外す経路を 1 つにそろえるため)
let releaseReservation: () => void = () => undefined
if (claudeSessionId !== null) {
  const release = reservations.tryReserve(claudeSessionId)
  if (release === null) {
    return { kind: 'failed', result: { kind: 'error', error: 'session-in-use' } }
  }
  releaseReservation = release
}
```

```ts
        // 検証を通った ID と、main が作った設定のファイルの絶対パスをそのまま引数にする(L-018・L-034)。区別に対応しない種類には
        // 設定のファイルを渡さない(起動の表が投げる)
        args: [
          ...plan.args,
          ...AGENT_CLI_LAUNCH_SPECS[plan.cliKind].buildArgs(
            request.launch,
            claudeSessionId,
            capabilities.changeAttribution ? (prepared.hooks?.settingsPath ?? null) : null
          )
        ],
```

```ts
sessionInfoBySessionId.set(sessionId, { cliKind: plan.cliKind, claudeSessionId })
void session.exited.then(() => {
  cleanUpQuietly('Map', () => sessionInfoBySessionId.delete(sessionId))
  cleanUpQuietly('予約', releaseReservation)
  cleanUpQuietly('hooks', () => hooks.release(prepared, sessionId))
})
```

```ts
createdClaudeSession.cliKind = plan.cliKind
createdClaudeSession.claudeSessionId = claudeSessionId
return { kind: 'created', session }
```

8. `finishStart` の第 3 引数を `createdClaudeSession: CreatedClaudeSession` にして `recordStarted(result.sessionId, folderKey, createdClaudeSession)` を呼び、`recordStarted` と `alreadyRunning` を次に置き換える（`段階 1 の途中(main)` の印の行はここで消える）:

```ts
/**
 * started を共有の結果にして記録する。registry の started は、この依頼の create が作り、取り消さずに枠に置いたセッションだけ。
 * 種類が入っていない取り違えは能力で見分けずに投げる(L-044)。再開に対応する種類は会話の ID を必ず持ち、記録する。
 * 対応しない種類(copilot)は ID を持たず、記録しない(前回の続きからに出さない)
 */
function recordStarted(
  sessionId: string,
  folderKey: string,
  { cliKind, claudeSessionId }: CreatedClaudeSession
): AgentStartResult {
  if (cliKind === null) {
    throw new Error('起動したセッションの CLI の種類がありません')
  }
  if (agentCliCapabilities(cliKind).sessionResume) {
    if (claudeSessionId === null) {
      throw new Error('起動したセッションの claude のセッション ID がありません')
    }
    // 起動は成功しているため、記録の失敗はログだけにする(次の 前回の続きから が古い記録を使うことがある。L-001)
    try {
      records.record(folderKey, claudeSessionId)
    } catch (err) {
      console.error('[agentSessionStarter] 起動の記録に失敗しました:', err)
    }
  } else if (claudeSessionId !== null) {
    throw new Error('再開に対応しない CLI のセッションに claude のセッション ID があります')
  }
  return { kind: 'started', sessionId, cliKind, claudeSessionId }
}

/** already-running(StrictMode の二重の依頼など)は、動いているセッションの種類と ID を返す(依頼の launch は使わない) */
function alreadyRunning(sessionId: string): AgentStartResult {
  const info = sessionInfoBySessionId.get(sessionId)
  if (info === undefined) {
    console.error(
      '[agentSessionStarter] 動いているセッションの種類と claude のセッション ID が見つかりません:',
      sessionId
    )
    throw new Error('動いているセッションの種類と claude のセッション ID が見つかりません')
  }
  return { kind: 'already-running', sessionId, ...info }
}
```

9. 戻り値の `claudeSessionIdOf: …` を `sessionInfoOf: (sessionId) => sessionInfoBySessionId.get(sessionId)` にする
10. 冒頭のコメントの「起動に使う claude の会話の ID の選択」の前に「CLI の種類ごとの分岐(再開の拒否・会話の ID と予約と記録は能力の表で分ける)」を足す

- [ ] **Step 5: 状態の取得・受け口・組み立て・hooks・追跡を実装する**

`src/main/agentSessionSnapshot.ts` を次にする（`DEFAULT_AGENT_CLI_KIND` と印の行は消える）:

```ts
import type { AgentSessionSnapshotEntry } from '@shared/types'
import type { AgentRegistrySnapshotEntry } from './agentSessionRegistry'
import type { AgentSessionInfo } from './agentSessionStarter'

// registry の snapshot(pty の sessionId だけ)に、starter が持つ CLI の種類と claude の会話の ID を足して、IPC で返す形にする
// (agentTerminal:getState の作り直しの後の合わせ込み)。Electron に依存しない

/**
 * 情報が引けないセッションは一覧から外してログに残す(exited の途中の瞬間〈starter の Map から消えた後、registry が枠から外す前〉
 * に当たりうる。合わせ込みの全体を止めない)
 */
export function attachSessionInfo(
  entries: readonly AgentRegistrySnapshotEntry[],
  sessionInfoOf: (sessionId: string) => AgentSessionInfo | undefined
): AgentSessionSnapshotEntry[] {
  return entries.flatMap((entry): AgentSessionSnapshotEntry[] => {
    const info = sessionInfoOf(entry.sessionId)
    if (info === undefined) {
      console.warn(
        '[agentTerminal:getState] セッションの種類と会話の ID が見つからないセッションを一覧から外します:',
        entry.sessionId
      )
      return []
    }
    return [{ slotId: entry.slotId, sessionId: entry.sessionId, ...info }]
  })
}
```

`src/main/handlers/agentTerminalHandlers.ts`: `attachClaudeSessionIds` の import を `attachSessionInfo` にし、`AgentTerminalHandlerDeps` の `claudeSessionIdOf` を次にする（分割代入と `getState` の呼び出しも `sessionInfoOf` と `attachSessionInfo(registry.snapshot(event.sender.id), sessionInfoOf)` にする）:

```ts
/** pty の sessionId → 種類と claude の会話の ID(starter の Map)。作り直しの後の合わせ込み(getState)で足す */
sessionInfoOf: AgentSessionStarterService['sessionInfoOf']
```

`src/main/ipcHandlers.ts` の `claudeSessionIdOf: agentStarter.claudeSessionIdOf,` を `sessionInfoOf: agentStarter.sessionInfoOf,` にする。

`src/main/agentToolActivity.ts` の `AgentHooksUnavailableReason` を Interfaces のとおりにする（上に「`cli-unsupported` は使う CLI が hooks による区別に対応していない(agentHookSessions の prepare)」を 1 行足す）。

`src/main/agentHookSessions.ts`: import に `import { agentCliCapabilities } from '@shared/agentCliKinds'` を足し、`prepare` の先頭（`try` の前）に足す:

```ts
// 区別に対応しない種類(copilot)は、版の確認も受け口の用意もしない(copilot の実行ファイルに --version を渡して claude の版
// として読まない。L-043)。activate は今の hooks === null の経路で、追跡に unconfirmed(cli-unsupported)で足す
if (!agentCliCapabilities(plan.cliKind).changeAttribution) {
  return without(ownerId, 'cli-unsupported')
}
```

- [ ] **Step 6: テストが通ることを確かめる**

Run: Step 3 と同じコマンドに `src/main/__tests__/agentChangesAttribution.test.ts src/main/__tests__/agentHooks.integration.test.ts` を足して流す
Expected: PASS

- [ ] **Step 7: 変異で確かめる**

1. `createSession` の再開の拒否の `if (…) { return … }` を消す → `copilot で resume の依頼は resume-unsupported で断り…` が落ちる（`hooks.prepare` が呼ばれ、起動の表の `buildCopilotArgs` が投げて結果が `spawn-failed` になる）。戻す
2. `spawnSession` の `if (capabilities.sessionResume) {` を `if (true) {` にする（中身は残す） → `copilot の計画で起動すると…` が落ちる。戻す
3. `recordStarted` の `if (agentCliCapabilities(cliKind).sessionResume) {` の条件を `cliKind !== null` にする → `copilot の計画で起動すると…` が落ちる（`claudeSessionId === null` で投げる）。戻す
4. `prepare` の先頭の `if (!agentCliCapabilities(plan.cliKind).changeAttribution) { … }` を消す → `種類の能力に区別(changeAttribution)が無ければ…` が落ちる。戻す
5. `attachSessionInfo` の `...info` を `cliKind: 'claude', claudeSessionId: info.claudeSessionId` にする → `各セッションに種類と…`・`copilot のセッションは、種類と null の…` が落ちる。戻す
6. `git diff` で戻したことを確かめる

- [ ] **Step 8: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/main/agentSessionStarter.ts src/main/agentSessionSnapshot.ts src/main/handlers/agentTerminalHandlers.ts src/main/ipcHandlers.ts src/main/agentHookSessions.ts src/main/agentToolActivity.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/agentSessionSnapshot.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentToolActivity.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check <同じファイル>`
Expected: すべて整形済み
Run: `grep -rn "段階 1 の途中(main)\|claudeSessionIdOf\|attachClaudeSessionIds" src`
Expected: 何も出ない

---

### Task 4: renderer のタブの種類と名前・画面の判定を止める

> **設計書の読む節:** 「決めたこと（推奨案）」の画面の判定の止め方、「renderer の「使えない」の出し方」の「タブの種類と名前」・「画面の判定を止める」、入口ごとの表の「帯・タブの状態の文言」「完了・許可待ちの通知」「変更の一覧の自動の取り直し」の行、「文言」のタブの名前、「既知の制約」の読み込み前の名前、「テスト方針」の `useAgentActivity.test.ts`・`useAgentSessions.test.ts`・`useAgentNotifications.test.ts`・`agentTabLabel.test.ts`。
>
> **気をつける知見:** L-018（タブの能力は起動の結果の種類を使う）・L-060（`appCliKind`・タブの `cliKind`・`formatAgentTabLabel` の種類を必須にする）・L-061（判定を止めると、作業中・許可待ちに基づく通知・自動の取り直し・hooks への作業中の知らせが起きないことを、通知の組のテストで確かめる）

**Files:**

- Modify: `src/shared/agentTabLabel.ts`・`src/shared/agentNotificationText.ts`・`src/renderer/src/lib/agentSessionTabState.ts`・`src/renderer/src/hooks/useAgentSessions.ts`・`src/renderer/src/hooks/useAgentActivity.ts`・`src/renderer/src/hooks/useAgentWorkspace.ts`（一時の `appCliKind`）・`src/renderer/src/__tests__/makeAgentSessionsState.ts`
- Test: `src/shared/__tests__/agentTabLabel.test.ts`・`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`・`src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts`・`src/renderer/src/lib/__tests__/agentSessionTabState.test.ts`・`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`・`src/renderer/src/hooks/__tests__/useAgentActivity.test.ts`・`src/renderer/src/hooks/__tests__/useAgentNotifications.test.ts`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`

**Interfaces:**

- Consumes: Task 1 の `AgentCliKind`・`AGENT_CLI_PROFILES`・`agentCliCapabilities`・`DEFAULT_AGENT_CLI_KIND`・`AgentStartResult.cliKind`・`AgentSessionSnapshotEntry.cliKind`
- Produces:

```ts
// src/shared/agentTabLabel.ts
export function formatAgentTabLabel(number: number, kind: AgentCliKind): string
// src/renderer/src/lib/agentSessionTabState.ts
AgentTabSessionFields.cliKind: AgentCliKind | null // INITIAL は null
// src/renderer/src/hooks/useAgentSessions.ts
AgentSessionTabView.cliKind: AgentCliKind // fields.cliKind ?? appCliKind
UseAgentSessionsOptions.appCliKind: AgentCliKind // 必須
// src/renderer/src/hooks/useAgentActivity.ts
AgentActivityTab.cliKind: AgentCliKind
```

- [ ] **Step 1: 失敗するテストを書く（名前）**

`src/shared/__tests__/agentTabLabel.test.ts` を次に置き換える:

```ts
import { describe, it, expect } from 'vitest'
import { formatAgentTabLabel } from '../agentTabLabel'

describe('formatAgentTabLabel', () => {
  it('種類のコマンド名とタブの番号から作る(claude 1・copilot 1)', () => {
    expect(formatAgentTabLabel(1, 'claude')).toBe('claude 1')
    expect(formatAgentTabLabel(4, 'claude')).toBe('claude 4')
    expect(formatAgentTabLabel(1, 'copilot')).toBe('copilot 1')
    expect(formatAgentTabLabel(3, 'copilot')).toBe('copilot 3')
  })
})
```

`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts` の `formatAgentTabLabel(2)` を `formatAgentTabLabel(2, 'claude')` に、`src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts` の `formatAgentTabLabel(3)` を `formatAgentTabLabel(3, 'claude')` にする（`src/shared/__tests__/agentNotificationText.test.ts` は変えない。通知の題は `claude` のまま）。`src/renderer/src/lib/__tests__/agentSessionTabState.test.ts` の `状態があるタブはその値を返す` の `fields` に `cliKind: null` を足す。

- [ ] **Step 2: 失敗するテストを書く（タブの種類）**

`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`:

1. `render`・`renderStrict` と、ファイルの中で `useAgentSessions({ … })` を直接呼んでいるところ（`enabled` を切り替えるテスト）の引数に `appCliKind: 'claude'` を足す
2. import に `import type { AgentCliKind } from '@shared/agentCliKinds'` を足す
3. 末尾に足す:

```ts
describe('useAgentSessions: CLI の種類(タブの cliKind と名前)', () => {
  const renderKind = (
    appCliKind: AgentCliKind,
    options: Partial<UseAgentSessionsOptions> = {}
  ): ReturnType<typeof renderHook<AgentSessionsState, { appCliKind: AgentCliKind }>> =>
    renderHook(
      (props: { appCliKind: AgentCliKind }) =>
        useAgentSessions({
          folderPath: '/work',
          tabs,
          enabled: true,
          now: currentNow,
          ...options,
          appCliKind: props.appCliKind
        }),
      { initialProps: { appCliKind } }
    )

  it('未起動のタブは設定の種類で名前と種類を出し、設定が変わればついていく', () => {
    const { result, rerender } = renderKind('claude')
    expect(result.current.selected).toMatchObject({ cliKind: 'claude', label: 'claude 1' })
    rerender({ appCliKind: 'copilot' })
    expect(result.current.selected).toMatchObject({ cliKind: 'copilot', label: 'copilot 1' })
  })

  it('起動の結果の種類をタブに入れ、設定が変わっても起動の結果の種類のまま', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    const { result, rerender } = renderKind('claude')
    await startSelected(result)
    expect(result.current.selected).toMatchObject({
      status: 'running',
      cliKind: 'copilot',
      label: 'copilot 1',
      claudeSessionId: null
    })
    rerender({ appCliKind: 'claude' })
    expect(result.current.selected.cliKind).toBe('copilot')
  })

  it('終了しても種類は残る(終了したタブの名前と画面の中身が合う)', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    const { result, rerender } = renderKind('copilot')
    await startSelected(result)
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'stopped' }))
    rerender({ appCliKind: 'claude' })
    expect(result.current.selected).toMatchObject({
      status: 'exited',
      cliKind: 'copilot',
      label: 'copilot 1'
    })
  })

  it('起動を始めると種類を null に戻して設定の種類で出し、結果で入れ直す', async () => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    const { result, rerender } = renderKind('copilot')
    await startSelected(result)
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'stopped' }))
    rerender({ appCliKind: 'claude' })
    let resolveStart: (value: AgentStartResult) => void = () => undefined
    mockStart.mockImplementationOnce(() => new Promise((resolve) => (resolveStart = resolve)))
    let starting: Promise<void> = Promise.resolve()
    act(() => {
      starting = result.current.start('slot-1', NEW)
    })
    expect(result.current.selected).toMatchObject({
      status: 'starting',
      cliKind: 'claude',
      label: 'claude 1'
    })
    await act(async () => {
      resolveStart({ kind: 'started', sessionId: 's2', cliKind: 'claude', claudeSessionId: CSID })
      await starting
    })
    expect(result.current.selected).toMatchObject({ status: 'running', cliKind: 'claude' })
  })

  it('起動の失敗では種類を入れない(設定の種類で出す)', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'error', error: 'spawn-failed', detail: 'x' })
    const { result, rerender } = renderKind('copilot')
    await startSelected(result)
    expect(result.current.selected).toMatchObject({ status: 'none', cliKind: 'copilot' })
    rerender({ appCliKind: 'claude' })
    expect(result.current.selected.cliKind).toBe('claude')
  })

  it('作り直しの後の状態の取得で種類を入れる', async () => {
    mockGetState.mockResolvedValue([
      { slotId: 'slot-1', sessionId: 's9', cliKind: 'copilot', claudeSessionId: null }
    ])
    const { result } = renderKind('claude')
    await waitFor(() =>
      expect(result.current.selected).toMatchObject({
        status: 'running',
        cliKind: 'copilot',
        label: 'copilot 1'
      })
    )
  })

  it('閉じる前の確認は、そのタブの種類の名前で出す', async () => {
    const onConfirm = vi.fn(() => false)
    mockStart
      .mockResolvedValueOnce({
        kind: 'started',
        sessionId: 's-1',
        cliKind: 'copilot',
        claudeSessionId: null
      })
      .mockResolvedValueOnce({
        kind: 'started',
        sessionId: 's-2',
        cliKind: 'claude',
        claudeSessionId: CSID
      })
    const { result } = renderKind('claude', { onConfirm })
    await startSelected(result)
    await act(async () => {
      await result.current.addTab()
    })
    await act(async () => {
      await result.current.closeTab('slot-1')
    })
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(agentCloseTabConfirm('copilot 1'))
  })
})
```

- [ ] **Step 3: 失敗するテストを書く（判定を止める・通知の組）**

`src/renderer/src/hooks/__tests__/useAgentActivity.test.ts`:

1. import に `import type { AgentCliKind } from '@shared/agentCliKinds'` を足し、`tabOf` を次にする:

```ts
const tabOf = (
  slotId: string,
  controller: FakeController,
  status: AgentSessionStatus = 'running',
  cliKind: AgentCliKind = 'claude'
): AgentActivityTab => ({ slotId, status, controller, cliKind })
```

2. `describe('useAgentActivity', …)` の中の末尾に足す:

```ts
it('画面の判定が無い種類(copilot)のタブは購読せず、出力が来ても判定しない(タイマーも張らない)', () => {
  const controller = makeFakeController()
  const { result } = render([tabOf('a', controller, 'running', 'copilot')])
  expect(controller.outputWrittenListeners.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  act(() => controller.emitOutputWritten())
  act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_MAX_WAIT_MS))
  expect(classify).not.toHaveBeenCalled()
  expect(result.current.get('a')).toBe('unknown')
})

it('claude から copilot に種類が変わったタブ(同じタブで起動し直した)は、購読を外して活動の記録を消す', () => {
  const controller = makeFakeController()
  const { result, rerender } = render([tabOf('a', controller)])
  act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
  expect(result.current.get('a')).toBe('working')
  rerender({ tabs: [tabOf('a', controller, 'running', 'copilot')], classify })
  expect(controller.outputWrittenListeners.size).toBe(0)
  expect(result.current.get('a')).toBe('unknown')
  classify.mockClear()
  act(() => controller.emitOutputWritten())
  act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_MAX_WAIT_MS))
  expect(classify).not.toHaveBeenCalled()
})

it('copilot から claude に戻ったタブは、購読を張り直して判定する', () => {
  const controller = makeFakeController()
  const { result, rerender } = render([tabOf('a', controller, 'running', 'copilot')])
  rerender({ tabs: [tabOf('a', controller)], classify })
  expect(controller.outputWrittenListeners.size).toBe(1)
  act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
  expect(result.current.get('a')).toBe('working')
})
```

`src/renderer/src/hooks/__tests__/useAgentNotifications.test.ts` の import に次を足し、末尾に足す（判定を止めた copilot のタブでは、作業中 → 入力待ちの出力が来ても知らせない。claude を対照にする）:

```ts
import { AGENT_ACTIVITY_SETTLE_MS, useAgentActivity } from '../useAgentActivity'
import type { AgentActivityTab } from '../useAgentActivity'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import type { AgentCliKind } from '@shared/agentCliKinds'
```

```ts
describe('useAgentNotifications と useAgentActivity の組(CLI の種類)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  /** 作業中を判定させてから、入力待ちの画面の出力を流す(claude なら作業の完了になる) */
  const runWorkThenIdle = (cliKind: AgentCliKind): RenderHookResult<string, unknown> => {
    const controller = makeFakeController()
    let activity: AgentActivity = 'working'
    const classify = (): AgentActivity => activity
    const tabs: (AgentNotificationTab & AgentActivityTab)[] = [
      { slotId: 'slot-1', number: 1, status: 'running', isClosing: false, controller, cliKind }
    ]
    const hook = renderHook(() => {
      const activities = useAgentActivity({ tabs, classify })
      return useAgentNotifications({
        tabs,
        activities,
        enabled: true,
        isAgentMode: true,
        activateTab: vi.fn()
      })
    })
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    activity = 'idle'
    act(() => controller.emitOutputWritten())
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    return hook
  }

  it('claude のタブは、作業中 → 入力待ちで完了を知らせる(組の対照)', () => {
    const { result } = runWorkThenIdle('claude')
    expect(result.current).toBe(said(['done', 1]))
    expect(mockShow).toHaveBeenCalledOnce()
  })

  it('copilot のタブは画面を判定しないので、同じ出力でも知らせない', () => {
    const { result } = runWorkThenIdle('copilot')
    expect(result.current).toBe('')
    expect(mockShow).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `npx vitest run src/shared/__tests__/agentTabLabel.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentActivity.test.ts src/renderer/src/hooks/__tests__/useAgentNotifications.test.ts`
Expected: FAIL（名前が種類を見ない・タブに種類が無い・copilot のタブを購読する・copilot でも完了を知らせる）

- [ ] **Step 5: 名前とタブの種類を実装する**

`src/shared/agentTabLabel.ts` を次にする:

```ts
import { AGENT_CLI_PROFILES } from './agentCliKinds'
import type { AgentCliKind } from './agentCliKinds'

// エージェントのタブの名前。renderer のタブの表示と、main の OS の通知の題で同じ文言を使う(文言を二重に持たない)

/** タブのラベル(`claude 1`・`copilot 1`)。番号の振り方は renderer の agentSessionTabs の AgentSessionTab.number。
 *  種類は省略させない(省略で claude の名前に流さない。L-060) */
export function formatAgentTabLabel(number: number, kind: AgentCliKind): string {
  return `${AGENT_CLI_PROFILES[kind].commandName} ${number}`
}
```

`src/shared/agentNotificationText.ts` の `formatAgentTabLabel(tabNumber)` を `formatAgentTabLabel(tabNumber, 'claude')` にし、その行の上に `// 通知は画面の判定(screenActivity)が true の種類でだけ出るため claude の名前にする(種類を通知の依頼に足すのは段階 2)` を置く。

`src/renderer/src/lib/agentSessionTabState.ts`: import に `import type { AgentCliKind } from '@shared/agentCliKinds'` を足し、`AgentTabSessionFields` の `claudeSessionId` の前に足す（`INITIAL_AGENT_TAB_SESSION_FIELDS` に `cliKind: null` を足す）:

```ts
/** 起動の結果(started・already-running)・状態の取得の CLI の種類。起動を始めると null に戻し、終了しても消さない(終了したタブの
 *  名前と画面の中身が合うように)。null の間は設定の種類で名前と能力を引く(useAgentSessions の AgentSessionTabView.cliKind) */
cliKind: AgentCliKind | null
```

`src/renderer/src/hooks/useAgentSessions.ts`:

1. import に `import type { AgentCliKind } from '@shared/agentCliKinds'` と `import { useLatestRef } from './useLatestRef'` を足す
2. `AgentSessionTabView` の `label` の JSDoc を `formatAgentTabLabel(番号, cliKind)` にし、`claudeSessionId` の前に足す:

```ts
/** タブの CLI の種類。起動の結果の種類(AgentTabSessionFields.cliKind)、無ければ(未起動・起動中・起動の失敗)設定の種類。
 *  名前と能力(送信・中断の入口)はこの値で引く */
cliKind: AgentCliKind
```

3. `UseAgentSessionsOptions` の `startBlockedReason` の前に足し、分割代入にも `appCliKind` を足す:

```ts
/** 設定の種類(次に起動する CLI。起動の結果の無いタブの名前と能力に使う)。読み込み中は既定の claude を渡す。省略できない(L-060) */
appCliKind: AgentCliKind
```

4. `claudeSessionIdBySlotRef` の次に足す:

```ts
// 起動の結果の種類(タブ → 種類)。閉じる前の確認の名前を同期的に引くのに使う(描画は states の cliKind)。setTabCliKind でまとめて更新する
const cliKindBySlotRef = useRef(new Map<string, AgentCliKind>())
// 閉じる前の確認で使う、その時点の設定の種類(closeTab の参照を設定の変化で作り直さない)
const appCliKindRef = useLatestRef(appCliKind)
```

5. `forgetTab` に `cliKindBySlotRef.current.delete(slotId)` を足す
6. `setTabClaudeSessionId` の次に足す:

```ts
// タブの起動の結果の種類を、同期の参照用の ref と描画用の状態の両方に置く(null は「起動の結果が無い」)
const setTabCliKind = useCallback(
  (slotId: string, cliKind: AgentCliKind | null): void => {
    if (cliKind === null) cliKindBySlotRef.current.delete(slotId)
    else cliKindBySlotRef.current.set(slotId, cliKind)
    patchTab(slotId, { cliKind })
  },
  [patchTab]
)
```

7. 作り直しの後の合わせ込み（`getAgentSessions` の `then`）の `setTabClaudeSessionId(tab.slotId, entry.claudeSessionId)` の次に `setTabCliKind(tab.slotId, entry.cliKind)` を足し、effect の依存に `setTabCliKind` を足す
8. `start` の `setTabClaudeSessionId(slotId, launch.kind === 'resume' ? … : null)` の次に足す:

```ts
// 起動の結果の種類は結果が届いてから入れる(起動中は設定の種類で出す。前の起動の種類を残さない)
setTabCliKind(slotId, null)
```

`setTabClaudeSessionId(slotId, result.claudeSessionId)` の次に `setTabCliKind(slotId, result.cliKind)` を足し、`useCallback` の依存に `setTabCliKind` を足す

9. `closeTab` の確認の名前を `formatAgentTabLabel(tab.number, cliKindBySlotRef.current.get(slotId) ?? appCliKindRef.current)` にし、依存に `appCliKindRef` を足す
10. `tabViews` を次にする:

```ts
const tabViews = useMemo(
  () =>
    snapshot.tabs.map((tab): AgentSessionTabView => {
      const fields = agentTabSessionFieldsOf(states, tab.slotId)
      // 起動の結果の種類が無ければ(未起動・起動中・起動の失敗)設定の種類で出す
      const cliKind = fields.cliKind ?? appCliKind
      return {
        slotId: tab.slotId,
        number: tab.number,
        ...fields,
        cliKind,
        label: formatAgentTabLabel(tab.number, cliKind),
        isClosing: closingSlotIds.has(tab.slotId),
        controller: tab.controller
      }
    }),
  [snapshot, states, closingSlotIds, appCliKind]
)
```

`src/renderer/src/__tests__/makeAgentSessionsState.ts` の `makeAgentSessionTabView` を次にする（名前は上書きの番号と種類から作る。今の上書きは `number` と `label` を組で渡している）:

```ts
/** タブ 1 つ分の表示の偽物。既定は「claude 1・未起動」。名前は上書きの number・cliKind から作る(label を渡せばそれを使う) */
export function makeAgentSessionTabView(
  overrides: Partial<AgentSessionTabView> = {}
): AgentSessionTabView {
  const number = overrides.number ?? 1
  const cliKind = overrides.cliKind ?? 'claude'
  return {
    slotId: 'slot-1',
    number,
    label: formatAgentTabLabel(number, cliKind),
    status: 'none',
    exit: null,
    error: null,
    cliKind,
    claudeSessionId: null,
    isClosing: false,
    controller: makeFakeController(),
    ...overrides
  }
}
```

`src/renderer/src/hooks/useAgentWorkspace.ts`: import に `import { DEFAULT_AGENT_CLI_KIND } from '@shared/agentCliKinds'` と `import type { AgentCliKind } from '@shared/agentCliKinds'` を足し、`useAgentSessions` の呼び出しの前に足して、呼び出しの引数に `appCliKind,` を足す:

```ts
// 段階 1 の途中(renderer): Task 6 で設定の hook(useAgentCliKind)の値に替える
const appCliKind: AgentCliKind = DEFAULT_AGENT_CLI_KIND
```

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` の `useAgentSessions に開いているフォルダ・…` の期待（`toHaveBeenLastCalledWith({ … })`）に `appCliKind: 'claude',` を足す（テスト名に「設定の種類」を足す）。

- [ ] **Step 6: 画面の判定を止める**

`src/renderer/src/hooks/useAgentActivity.ts`:

1. import に `import { agentCliCapabilities } from '@shared/agentCliKinds'` と `import type { AgentCliKind } from '@shared/agentCliKinds'` を足す
2. `AgentActivityTab` に足す:

```ts
/** タブの CLI の種類。画面の判定(screenActivity)が無い種類は購読しない(設計書「画面の判定を止める」) */
cliKind: AgentCliKind
```

3. effect の `for (const tab of tabs) {` の先頭に足す:

```ts
// 画面の判定が無い種類(copilot): 購読・タイマーを持たず、記録も消す(種類が変わったタブ〈同じタブで起動し直した〉の区切り)。
// 常に unknown を返す判定に差し替えず、購読そのものを張らない。記録の無いタブは各機能が unknown として扱う
if (!agentCliCapabilities(tab.cliKind).screenActivity) {
  const watch = watches.get(tab.slotId)
  if (watch !== undefined) {
    releaseWatch(watch)
    watches.delete(tab.slotId)
  }
  reset.push(tab.slotId)
  continue
}
```

4. 戻り値の `resolved` の活動の取り出しを次にする（種類が変わった描画で、effect が記録を消す前の古い活動を返さない）:

```ts
const resolved = tabs.map((tab): [string, AgentActivity] => {
  const judged = tab.status === 'running' && agentCliCapabilities(tab.cliKind).screenActivity
  const activity = judged ? entries.get(tab.slotId) : undefined
  return [tab.slotId, activity ?? 'unknown']
})
```

5. 冒頭のコメントの末尾に「画面の判定が無い種類(copilot)のタブは購読しない」を足す

- [ ] **Step 7: テストが通ることを確かめる**

Run: `npx vitest run src/shared src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts src/renderer/src/lib/__tests__/agentSessionTabState.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentActivity.test.ts src/renderer/src/hooks/__tests__/useAgentNotifications.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS（`AgentSessionTabView` を手で作っているテストがあれば `cliKind: 'claude'` を足す）

- [ ] **Step 8: 変異で確かめる**

1. `useAgentActivity` の `if (!agentCliCapabilities(tab.cliKind).screenActivity) { … continue }` を消す → `画面の判定が無い種類(copilot)のタブは購読せず…`・`copilot のタブは画面を判定しないので、同じ出力でも知らせない` が落ちる。戻す
2. `tabViews` の `fields.cliKind ?? appCliKind` を `appCliKind` にする → `起動の結果の種類をタブに入れ…`・`終了しても種類は残る…` が落ちる。戻す
3. `start` の `setTabCliKind(slotId, null)` を消す → `起動を始めると種類を null に戻して…` が落ちる。戻す
4. `closeTab` の `cliKindBySlotRef.current.get(slotId) ?? appCliKindRef.current` を `appCliKindRef.current` にする → `閉じる前の確認は、そのタブの種類の名前で出す` が落ちる。戻す
5. `git diff` で戻したことを確かめる

- [ ] **Step 9: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/shared/agentTabLabel.ts src/shared/agentNotificationText.ts src/renderer/src/lib/agentSessionTabState.ts src/renderer/src/hooks/useAgentSessions.ts src/renderer/src/hooks/useAgentActivity.ts src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/__tests__/makeAgentSessionsState.ts src/shared/__tests__/agentTabLabel.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts src/renderer/src/lib/__tests__/agentSessionTabState.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentActivity.test.ts src/renderer/src/hooks/__tests__/useAgentNotifications.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check <同じファイル>`
Expected: すべて整形済み

---

### Task 5a: renderer の使えない理由の文言と送信の入口

> **設計書の読む節:** 「renderer の「使えない」の出し方」の入口ごとの表（実行・再実行・送信前の確認の 3 行）と表の後の 3 つの段落、「設定」の「画面」の表（文言だけ。部品は Task 6）、「文言」の最後の段落、「テスト方針」の `agentCliMessages.test.ts`・`agentSendMessages.test.ts`・`useAgentPromptSender.test.ts`・`useAgentSendConfirm` のテスト。
>
> **気をつける知見:** L-058（実行ボタンの理由と同じ判定で `send` の先頭でも止め、準備〈変更の記録〉より前に断る）・L-060（送り先の型の `cliKind`・純関数の種類の引数を必須にする）・L-061（実行・再実行・送信前の確認の 3 つの入口を同じ関数で止める）

**Files:**

- Create: `src/renderer/src/lib/agentCliMessages.ts`・`src/renderer/src/lib/__tests__/agentCliMessages.test.ts`
- Modify: `src/renderer/src/lib/agentPromptSend.ts`・`src/renderer/src/lib/agentSendMessages.ts`・`src/renderer/src/lib/promptRunState.ts`・`src/renderer/src/hooks/useAgentPromptSender.ts`・`src/renderer/src/hooks/useAgentSendConfirm.ts`・`src/renderer/src/hooks/useAgentWorkspace.ts`
- Test: `src/renderer/src/lib/__tests__/agentSendMessages.test.ts`・`src/renderer/src/lib/__tests__/promptRunState.test.ts`・`src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`・`src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`

**Interfaces:**

- Consumes: Task 1 の `AgentCliKind`・`AGENT_CLI_PROFILES`・`agentCliCapabilities`・`DEFAULT_AGENT_CLI_KIND`・`AgentCliKindSetting`、Task 4 の `AgentSessionTabView.cliKind`
- Produces:

```ts
// src/renderer/src/lib/agentCliMessages.ts
export const AGENT_CLI_CAPABILITY_NAMES: Record<keyof AgentCliCapabilities, string>
export const AGENT_CLI_KIND_SECTION_TITLE = '使うエージェント CLI'
export const AGENT_CLI_KIND_SECTION_NOTE = 'エージェント CLI 方式で使います。切り替えると、次の起動から使われます'
export function agentCliKindOptionLabel(kind: AgentCliKind): string
export function agentCliUnsupportedFeaturesNote(kind: AgentCliKind): string | null
export function agentCliFallbackNote(fallback: AgentCliKindSetting['fallback']): string | null
export const AGENT_CLI_KIND_LOCKED_WHILE_STARTING = 'エージェントの起動中は、使う CLI を切り替えられません'
export const AGENT_CLI_KIND_SAVE_ERROR_PREFIX = '使うエージェント CLI を保存できませんでした: '
export function agentPromptSendUnsupportedReason(commandName: string): string
export function agentInterruptUnsupportedReason(commandName: string): string
export function agentResumeLastUnsupportedReason(commandName: string): string
export function agentResumeEntryUnsupportedReason(commandName: string): string
export function agentNotificationUnsupportedNote(kind: AgentCliKind): string | null
// src/renderer/src/lib/agentPromptSend.ts
export type AgentSendFailure = AgentPromptRejection | 'not-accepting' | 'input-not-found' | 'clear-failed' | 'not-echoed' | 'unsupported-cli'
// src/renderer/src/lib/agentSendMessages.ts
export const AGENT_SEND_FAILURE_MESSAGES: Record<Exclude<AgentSendFailure, 'unsupported-cli'>, string>
export function agentSendFailureMessage(reason: AgentSendFailure, commandName: string): string
// getPromptRunAvailability・getHistoryRerunAvailability の params と PromptRunStateInput に cliKind: AgentCliKind(必須)
// src/renderer/src/hooks/useAgentPromptSender.ts
AgentSendTarget.cliKind: AgentCliKind // 必須
```

- [ ] **Step 1: 失敗するテストを書く（文言）**

`src/renderer/src/lib/__tests__/agentCliMessages.test.ts` を作る（文字列は設計書の一字一句。実機テスト仕様書もこの文字列で書く）:

```ts
import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS, agentCliCapabilities } from '@shared/agentCliKinds'
import {
  AGENT_CLI_CAPABILITY_NAMES,
  AGENT_CLI_KIND_LOCKED_WHILE_STARTING,
  AGENT_CLI_KIND_SAVE_ERROR_PREFIX,
  AGENT_CLI_KIND_SECTION_NOTE,
  AGENT_CLI_KIND_SECTION_TITLE,
  agentCliFallbackNote,
  agentCliKindOptionLabel,
  agentCliUnsupportedFeaturesNote,
  agentInterruptUnsupportedReason,
  agentNotificationUnsupportedNote,
  agentPromptSendUnsupportedReason,
  agentResumeEntryUnsupportedReason,
  agentResumeLastUnsupportedReason
} from '../agentCliMessages'

describe('agentCliMessages(設定の画面)', () => {
  it('見出し・説明・選択肢・選べない理由・保存の失敗の接頭辞', () => {
    expect(AGENT_CLI_KIND_SECTION_TITLE).toBe('使うエージェント CLI')
    expect(AGENT_CLI_KIND_SECTION_NOTE).toBe(
      'エージェント CLI 方式で使います。切り替えると、次の起動から使われます'
    )
    expect(agentCliKindOptionLabel('claude')).toBe('Claude Code（claude）')
    expect(agentCliKindOptionLabel('copilot')).toBe('GitHub Copilot CLI（copilot）')
    expect(AGENT_CLI_KIND_LOCKED_WHILE_STARTING).toBe(
      'エージェントの起動中は、使う CLI を切り替えられません'
    )
    expect(AGENT_CLI_KIND_SAVE_ERROR_PREFIX).toBe('使うエージェント CLI を保存できませんでした: ')
  })

  it('能力の名前の表は 5 つの能力を網羅する(並びは能力の表と同じ)', () => {
    expect(AGENT_CLI_CAPABILITY_NAMES).toEqual({
      promptSend: 'プロンプトの送信（実行・再実行）',
      screenActivity: '作業中・入力待ちの表示と通知',
      interrupt: '中断',
      changeAttribution: '利用者の変更との区別',
      sessionResume: '前回の続きから・このセッションで再開'
    })
    expect(Object.keys(AGENT_CLI_CAPABILITY_NAMES)).toEqual(
      Object.keys(agentCliCapabilities('claude'))
    )
  })

  it('使えない機能の注記: copilot は能力の表のすべての名前を並べ、claude は出さない', () => {
    expect(agentCliUnsupportedFeaturesNote('copilot')).toBe(
      'copilot では次の機能を使えません（ターミナルで直接操作します）: プロンプトの送信（実行・再実行）、作業中・入力待ちの表示と通知、中断、利用者の変更との区別、前回の続きから・このセッションで再開'
    )
    expect(agentCliUnsupportedFeaturesNote('claude')).toBeNull()
  })

  it.each(AGENT_CLI_KINDS)('%s: 使えない機能の注記は、false の能力の名前だけを含む', (kind) => {
    const note = agentCliUnsupportedFeaturesNote(kind) ?? ''
    const capabilities = agentCliCapabilities(kind)
    for (const [key, name] of Object.entries(AGENT_CLI_CAPABILITY_NAMES)) {
      expect(note.includes(name)).toBe(!capabilities[key as keyof typeof capabilities])
    }
  })

  it('既定に戻した旨', () => {
    expect(agentCliFallbackNote(null)).toBeNull()
    expect(agentCliFallbackNote('invalid-value')).toBe(
      '保存されていた値を読めなかったため claude を使っています（選び直すと保存します）'
    )
    expect(agentCliFallbackNote('read-failed')).toBe(
      '設定ファイルを読めなかったため claude を使っています'
    )
  })

  it('通知の注記: 画面の判定が無い種類だけに出す', () => {
    expect(agentNotificationUnsupportedNote('copilot')).toBe(
      'copilot では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）'
    )
    expect(agentNotificationUnsupportedNote('claude')).toBeNull()
  })
})

describe('agentCliMessages(入口ごとの使えない理由)', () => {
  it('実行・再実行・送信前の確認', () => {
    expect(agentPromptSendUnsupportedReason('copilot')).toBe(
      'copilot へのプロンプトの送信には、まだ対応していません（ターミナルに直接入力してください）'
    )
  })

  it('中断', () => {
    expect(agentInterruptUnsupportedReason('copilot')).toBe(
      'copilot では中断のボタンを使えません（ターミナルで操作してください）'
    )
  })

  it('前回の続きから・このセッションで再開', () => {
    expect(agentResumeLastUnsupportedReason('copilot')).toBe(
      'copilot では「前回の続きから」を使えません（設定で claude に戻すと使えます）'
    )
    expect(agentResumeEntryUnsupportedReason('copilot')).toBe(
      'copilot では「このセッションで再開」を使えません（設定で claude に戻すと使えます）'
    )
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（実行・再実行の理由と `unsupported-cli`）**

`src/renderer/src/lib/__tests__/agentSendMessages.test.ts`:

1. `describe('getPromptRunAvailability', …)` と `describe('getHistoryRerunAvailability(…)', …)` の `base` に `cliKind: 'claude' as const,` を足す
2. import に `AGENT_SEND_FAILURE_MESSAGES, agentSendFailureMessage` と `import { agentPromptSendUnsupportedReason } from '../agentCliMessages'` を足し、末尾に足す:

```ts
describe('送信の入口の CLI の種類(送り先のタブの cliKind)', () => {
  const COPILOT = agentPromptSendUnsupportedReason('copilot')
  const running = {
    mode: 'agent-cli' as const,
    isExecuting: false,
    cliKind: 'copilot' as const,
    isSessionRunning: true,
    isSessionClosing: false,
    isSending: false
  }

  it('送り先が copilot なら押せず、理由を出す', () => {
    expect(getPromptRunAvailability(running)).toEqual({ disabled: true, reason: COPILOT })
  })

  it('copilot の理由は、閉じる途中・未起動・送信中より先(起動しても送れないため)', () => {
    for (const patch of [
      { isSessionClosing: true },
      { isSessionRunning: false },
      { isSending: true }
    ]) {
      expect(getPromptRunAvailability({ ...running, ...patch })).toEqual({
        disabled: true,
        reason: COPILOT
      })
    }
  })

  it('読み込み中・従来の方式は種類を見ない(従来の方式の判定の直後に見る)', () => {
    expect(getPromptRunAvailability({ ...running, mode: null })).toEqual({
      disabled: true,
      reason: RUN_DISABLED_LOADING_MODE
    })
    expect(getPromptRunAvailability({ ...running, mode: 'legacy' })).toEqual({
      disabled: false,
      reason: null
    })
  })

  it('履歴の再実行(エージェントのエントリ)も同じ理由(getPromptRunAvailability を通る)', () => {
    expect(
      getHistoryRerunAvailability({ ...running, recordedFolderPath: '/repo', folderPath: '/repo' })
    ).toEqual({ disabled: true, reason: COPILOT })
  })
})

describe('送信の失敗の文言(agentSendFailureMessage)', () => {
  it('unsupported-cli は実行ボタンの理由と同じ関数の文言', () => {
    expect(agentSendFailureMessage('unsupported-cli', 'copilot')).toBe(
      agentPromptSendUnsupportedReason('copilot')
    )
  })

  it('ほかの理由は AGENT_SEND_FAILURE_MESSAGES の文言(CLI の名前を使わない)', () => {
    expect(agentSendFailureMessage('input-not-found', 'copilot')).toBe(
      AGENT_SEND_FAILURE_MESSAGES['input-not-found']
    )
  })

  it('AGENT_SEND_FAILURE_MESSAGES は unsupported-cli を持たない(CLI の名前の要る文言は関数で引く)', () => {
    expect(Object.keys(AGENT_SEND_FAILURE_MESSAGES)).not.toContain('unsupported-cli')
  })
})
```

`src/renderer/src/lib/__tests__/promptRunState.test.ts` の `base` に `cliKind: 'claude',` を足し、末尾に足す:

```ts
it('エージェント CLI 方式で送り先が copilot なら、running でも押せず理由を出す', () => {
  const state = buildPromptRunPanelState({
    ...base,
    mode: 'agent-cli',
    cliKind: 'copilot',
    sessionStatus: 'running'
  })
  expect(state.isRunDisabled).toBe(true)
  expect(state.runDisabledReason).toBe(
    'copilot へのプロンプトの送信には、まだ対応していません（ターミナルに直接入力してください）'
  )
})
```

（`describe('buildPromptRunPanelState', …)` の中に入れる）

- [ ] **Step 3: 失敗するテストを書く（送信の守りと確認の控え）**

`src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts` の送り先に `cliKind: 'claude'` を足す（単一行・複数行の `describeSession: noSession` の後ろに入れ、残りの 3 か所〈`describeSession })`・`describeSession: () => SENT_TO`・`describeSession: () => { … }`〉は手で足す）:

```bash
cd <repo-root>
F=src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts
test -f "$F" && perl -0pi -e "s/describeSession: noSession(\s*)\}/describeSession: noSession,\1cliKind: 'claude'\1}/g" "$F"
npx prettier --write "$F"
grep -c "cliKind: 'claude'" "$F"
```

Expected: `16`（`describeSession: noSession` の数と同じ）。続けて `npm run typecheck` が指す残りの送り先に `cliKind: 'claude'` を足す。

import に `import { agentPromptSendUnsupportedReason } from '../../lib/agentCliMessages'` を足し、末尾に足す:

```ts
describe('useAgentPromptSender: 送信に対応しない CLI(copilot)の送り先', () => {
  it('準備・送り先の控え・入力の保留・書き込みをどれもせず unsupported-cli で失敗し、実行ボタンの理由と同じ文言を出す(L-058)', async () => {
    const controller = controllerWithEmptyInput()
    const beforeSend = vi.fn(async () => undefined)
    const describeSession = vi.fn(noSession)
    const onSettled = vi.fn()
    const { result } = renderHook(() => useAgentPromptSender({ onSettled, beforeSend, clock }))
    let outcome: AgentPromptSendResult | undefined
    await act(async () => {
      outcome = await result.current.send('hello', {
        slotId: 'a',
        controller,
        describeSession,
        cliKind: 'copilot'
      })
    })
    expect(outcome).toEqual({ kind: 'failed', reason: 'unsupported-cli' })
    expect(beforeSend).not.toHaveBeenCalled()
    expect(describeSession).not.toHaveBeenCalled()
    expect(controller.beginSending).not.toHaveBeenCalled()
    expect(controller.writes).toEqual([])
    expect(result.current.error).toBe(agentPromptSendUnsupportedReason('copilot'))
    expect(result.current.isSending).toBe(false)
    expect(result.current.sendingSlotId).toBeNull()
    expect(onSettled).toHaveBeenCalledOnce()
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`:

1. `tab1`・`tab2` に `cliKind: 'claude' as const,` を足す
2. 送り先の期待（`target: { slotId: 'slot-1', controller: tab1.controller, describeSession: tab1.describeSession }` と `send` の第 2 引数の `{ slotId, controller, describeSession }`）に `cliKind: 'claude'` を足す（`npx vitest run` が落ちた期待を示す）
3. `describe('useAgentSendConfirm: 送り先の控え(describeSession)', …)` の中に足す:

```ts
it('確認を開いた時点の送り先の cliKind を控え、開いた後に選択中のタブが変わっても控えた値で送る', async () => {
  const copilotTab = { ...tab1, cliKind: 'copilot' as const }
  const { result, rerender, send, onSendSettled } = renderConfirm({ selected: copilotTab })
  act(() => result.current.request('hello', opts('p1')))
  expect(result.current.pending?.target.cliKind).toBe('copilot')
  rerender({ selected: tab2, send, onSendSettled })
  await act(async () => {
    result.current.confirm()
  })
  expect(send.mock.calls[0][1].cliKind).toBe('copilot')
})
```

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`:

1. 送り先の期待（`describeSession: expect.any(Function)` を含む 3 か所の `{ slotId, controller, describeSession }`）に `cliKind: 'claude'` を足す
2. import に `import { agentPromptSendUnsupportedReason } from '../../lib/agentCliMessages'` を足し、`describe('エージェントへの送信', …)` の次に足す:

```ts
describe('送信の入口の CLI の種類(選択中のタブの cliKind)', () => {
  const COPILOT = agentPromptSendUnsupportedReason('copilot')
  const copilotRunning = (): ReturnType<typeof makeAgentSessionsState> =>
    makeAgentSessionsState({ selected: { status: 'running', cliKind: 'copilot' } })

  it('選択中のタブが copilot なら実行を押せず、理由を出す', () => {
    setMode('agent-cli')
    mockUseAgentSessions.mockReturnValue(copilotRunning())
    const { result } = renderWorkspace()
    expect(result.current.promptRun).toMatchObject({
      isRunDisabled: true,
      runDisabledReason: COPILOT
    })
  })

  it('履歴の再実行(エージェントのエントリ)も選択中のタブの種類で止める', () => {
    setMode('agent-cli')
    mockUseAgentSessions.mockReturnValue(copilotRunning())
    const entry: HistoryEntry = {
      id: 'h2',
      promptId: 'p1',
      promptTitle: '要約',
      promptContent: '本文',
      fileContent: null,
      toolId: 'claude',
      status: 'sent',
      resultText: null,
      errorMessage: null,
      executedAt: 1000,
      agent: {
        claudeSessionId: '11111111-1111-4111-8111-111111111111',
        tabLabel: 'claude 1',
        folderPath: '/p'
      }
    }
    const { result } = renderWorkspace({ folderPath: '/p' })
    expect(result.current.getHistoryActions(entry).rerun).toEqual({
      disabled: true,
      reason: COPILOT
    })
  })

  it('確認なしで送るとき、送り先に選択中のタブの cliKind を載せる(send の先頭の守りに届く)', async () => {
    setMode('agent-cli')
    setSendConfirmEnabled(false)
    const sender = makeSender()
    mockUseAgentPromptSender.mockReturnValue(sender)
    mockUseAgentSessions.mockReturnValue(copilotRunning())
    const { result } = renderWorkspace()
    await act(async () => {
      await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
    })
    expect(sender.send).toHaveBeenCalledExactlyOnceWith(
      'hello',
      expect.objectContaining({ cliKind: 'copilot' })
    )
  })

  it('送信前の確認の送れない理由は、確認を開いた時点の送り先の種類で求める', async () => {
    setMode('agent-cli')
    mockUseAgentSessions.mockReturnValue(copilotRunning())
    const { result } = renderWorkspace()
    await act(async () => {
      await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
    })
    expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(COPILOT)
  })
})
```

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/lib/__tests__/promptRunState.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: FAIL（`agentCliMessages` が無い・種類を見ない・送り先に種類が無い）

- [ ] **Step 5: 文言を実装する**

`src/renderer/src/lib/agentCliMessages.ts` を作る:

```ts
import {
  AGENT_CLI_PROFILES,
  DEFAULT_AGENT_CLI_KIND,
  agentCliCapabilities
} from '@shared/agentCliKinds'
import type { AgentCliCapabilities, AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliKindSetting } from '@shared/types'

// 使うエージェント CLI の文言(設計書 2026-10-20「文言」「renderer の「使えない」の出し方」「設定」の「画面」)。
// 使えない理由は commandName を引数に取る関数にし、文字列に CLI の名前を直書きしない。能力の名前は Record で持ち、
// 能力を足したときの決め忘れを型エラーにする

/** 既定の CLI(claude)のコマンド名。「claude に戻すと使えます」「claude を使っています」に使う */
const DEFAULT_COMMAND_NAME = AGENT_CLI_PROFILES[DEFAULT_AGENT_CLI_KIND].commandName

/** 能力の名前(設定の画面の「使えない機能」に並べる。並びは能力の表と同じ) */
export const AGENT_CLI_CAPABILITY_NAMES: Record<keyof AgentCliCapabilities, string> = {
  promptSend: 'プロンプトの送信（実行・再実行）',
  screenActivity: '作業中・入力待ちの表示と通知',
  interrupt: '中断',
  changeAttribution: '利用者の変更との区別',
  sessionResume: '前回の続きから・このセッションで再開'
}

export const AGENT_CLI_KIND_SECTION_TITLE = '使うエージェント CLI'
export const AGENT_CLI_KIND_SECTION_NOTE =
  'エージェント CLI 方式で使います。切り替えると、次の起動から使われます'
/** 設定の画面で、起動中のタブがあるときに選べない理由 */
export const AGENT_CLI_KIND_LOCKED_WHILE_STARTING =
  'エージェントの起動中は、使う CLI を切り替えられません'
/** 保存の失敗の文言の接頭辞。後ろに理由を付ける */
export const AGENT_CLI_KIND_SAVE_ERROR_PREFIX = '使うエージェント CLI を保存できませんでした: '

/** 選択肢の名前(`Claude Code（claude）`) */
export function agentCliKindOptionLabel(kind: AgentCliKind): string {
  const { displayName, commandName } = AGENT_CLI_PROFILES[kind]
  return `${displayName}（${commandName}）`
}

/** 選んだ CLI で使えない機能の注記(能力の表で false のものを並べる)。すべて使えるなら null */
export function agentCliUnsupportedFeaturesNote(kind: AgentCliKind): string | null {
  const capabilities = agentCliCapabilities(kind)
  const names = (Object.keys(AGENT_CLI_CAPABILITY_NAMES) as (keyof AgentCliCapabilities)[])
    .filter((key) => !capabilities[key])
    .map((key) => AGENT_CLI_CAPABILITY_NAMES[key])
  if (names.length === 0) return null
  return `${AGENT_CLI_PROFILES[kind].commandName} では次の機能を使えません（ターミナルで直接操作します）: ${names.join('、')}`
}

/** 既定に戻した旨(main が読めなかった理由)。戻していなければ null */
export function agentCliFallbackNote(fallback: AgentCliKindSetting['fallback']): string | null {
  switch (fallback) {
    case null:
      return null
    case 'invalid-value':
      return `保存されていた値を読めなかったため ${DEFAULT_COMMAND_NAME} を使っています（選び直すと保存します）`
    case 'read-failed':
      return `設定ファイルを読めなかったため ${DEFAULT_COMMAND_NAME} を使っています`
  }
}

/** 実行・履歴の再実行・送信前の確認の送れない理由と、send の unsupported-cli の文言(同じ関数) */
export function agentPromptSendUnsupportedReason(commandName: string): string {
  return `${commandName} へのプロンプトの送信には、まだ対応していません（ターミナルに直接入力してください）`
}

/** 帯の 中断 の押せない理由 */
export function agentInterruptUnsupportedReason(commandName: string): string {
  return `${commandName} では中断のボタンを使えません（ターミナルで操作してください）`
}

/** 前回の続きから の押せない理由(設定の種類が再開に対応していない) */
export function agentResumeLastUnsupportedReason(commandName: string): string {
  return `${commandName} では「前回の続きから」を使えません（設定で ${DEFAULT_COMMAND_NAME} に戻すと使えます）`
}

/** 履歴の このセッションで再開 の押せない理由 */
export function agentResumeEntryUnsupportedReason(commandName: string): string {
  return `${commandName} では「このセッションで再開」を使えません（設定で ${DEFAULT_COMMAND_NAME} に戻すと使えます）`
}

/** 設定の エージェントの通知 に添える注記。選んだ CLI が画面を判定しない(screenActivity が無い)ときだけ */
export function agentNotificationUnsupportedNote(kind: AgentCliKind): string | null {
  if (agentCliCapabilities(kind).screenActivity) return null
  return `${AGENT_CLI_PROFILES[kind].commandName} では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）`
}
```

- [ ] **Step 6: 送信の入口を実装する**

`src/renderer/src/lib/agentPromptSend.ts` の `AgentSendFailure` の末尾に足す:

```ts
  /** 送り先の CLI が送信に対応していない(useAgentPromptSender.send の先頭の守り。sendAgentPrompt は返さない) */
  | 'unsupported-cli'
```

`src/renderer/src/lib/agentSendMessages.ts`:

1. import に `import { AGENT_CLI_PROFILES, agentCliCapabilities } from '@shared/agentCliKinds'`・`import type { AgentCliKind } from '@shared/agentCliKinds'`・`import { agentPromptSendUnsupportedReason } from './agentCliMessages'` を足す
2. `AGENT_SEND_FAILURE_MESSAGES` の型を `Record<Exclude<AgentSendFailure, 'unsupported-cli'>, string>` にし、上に「CLI の名前が要る unsupported-cli は持たない(agentSendFailureMessage で引く)」を足す。その次に足す:

```ts
/** 送信の失敗の文言。unsupported-cli は実行ボタンの理由と同じ関数で、送り先の CLI の名前で作る */
export function agentSendFailureMessage(reason: AgentSendFailure, commandName: string): string {
  return reason === 'unsupported-cli'
    ? agentPromptSendUnsupportedReason(commandName)
    : AGENT_SEND_FAILURE_MESSAGES[reason]
}
```

3. `getPromptRunAvailability` の params の `isExecuting` の次に `cliKind: AgentCliKind`（JSDoc「送り先のタブの CLI の種類(起動の結果の種類。未起動なら設定の種類)」）を足し、`legacy` の判定の次に足す（JSDoc に「送り先の CLI が送信に対応していなければ押せない」を足す）:

```ts
// 送り先の CLI が送信に対応していない(copilot など)。起動しても送れないため、閉じる途中・未起動より前に見る
if (!agentCliCapabilities(params.cliKind).promptSend) {
  return {
    disabled: true,
    reason: agentPromptSendUnsupportedReason(AGENT_CLI_PROFILES[params.cliKind].commandName)
  }
}
```

4. `getHistoryRerunAvailability` の params の `isExecuting` の次に `cliKind: AgentCliKind` を足す（`getPromptRunAvailability(params)` にそのまま渡る）

`src/renderer/src/lib/promptRunState.ts`: `PromptRunStateInput` の `isExecuting` の次に `cliKind: AgentCliKind`（JSDoc「送り先のタブの CLI の種類」）を足し（`import type { AgentCliKind } from '@shared/agentCliKinds'`）、分割代入と `getPromptRunAvailability({ mode, isExecuting, cliKind, … })` に足す。

`src/renderer/src/hooks/useAgentPromptSender.ts`:

1. import の `AGENT_SEND_FAILURE_MESSAGES` を `agentSendFailureMessage` にし、`import { AGENT_CLI_PROFILES, agentCliCapabilities } from '@shared/agentCliKinds'` と `import type { AgentCliKind } from '@shared/agentCliKinds'` を足す
2. `AgentSendTarget` の `controller` の次に足す:

```ts
/** 送り先のタブの CLI の種類(押した時点の値。送信に対応しない種類には書き込まない。実行ボタンと同じ判定。L-058) */
cliKind: AgentCliKind
```

3. `send` の `if (sendingRef.current) return undefined` の次に足す:

```ts
// 送り先の CLI が送信に対応していなければ、準備(変更の記録)・送り先の控え・入力の保留・書き込みをどれもせずに断る
// (実行ボタンの理由と同じ判定・同じ文言。見た目だけで止めない。L-058)。ほかの失敗と同じくパネルを開く
if (!agentCliCapabilities(target.cliKind).promptSend) {
  clear()
  setError(
    agentSendFailureMessage('unsupported-cli', AGENT_CLI_PROFILES[target.cliKind].commandName)
  )
  onSettled()
  return { kind: 'failed', reason: 'unsupported-cli' }
}
```

4. 失敗の文言の `setError(AGENT_SEND_FAILURE_MESSAGES[outcome.reason])` を `setError(agentSendFailureMessage(outcome.reason, AGENT_CLI_PROFILES[target.cliKind].commandName))` にする

`src/renderer/src/hooks/useAgentSendConfirm.ts` の `request` の分割代入に `cliKind` を足し、`target: { slotId, controller, describeSession, cliKind }` にする（コメントの「送り先の控え(describeSession)も写す」を「送り先の控え(describeSession)と種類(cliKind)も写す」にする）。

`src/renderer/src/hooks/useAgentWorkspace.ts`:

1. `agentSessions.selected` の分割代入に `cliKind: selectedCliKind` を足し、`selectedTarget` に `cliKind: selectedCliKind` を足して依存に足す
2. `sendToAgent` の `sendAgentPrompt(text, { … })` に `cliKind: selectedTarget.cliKind` を足す
3. `targetBlockedReason` の条件を `pendingSend === null || pendingTab === undefined ? null : getPromptRunAvailability({ … })` にし、`getPromptRunAvailability({ … })` に `cliKind: pendingSend.target.cliKind,` を足す（`pendingTab` は `pendingSend` から求めた別の変数で、TypeScript は相関した絞り込みをしないため、`pendingSend === null` を条件に直接書いて絞り込む。非 null アサーションは使わない。コメントに「`pendingSend` を条件で絞り込む(pendingTab からは絞り込まれない)。送り先の種類は確認を開いた時点に控えた値」を足す）
4. `buildPromptRunPanelState({ … })` と `getHistoryRerunAvailability({ … })` に `cliKind: agentSessions.selected.cliKind,` を足す

- [ ] **Step 7: テストが通ることを確かめる**

Run: Step 4 と同じコマンドに `src/renderer/src/lib/__tests__/agentSendPreview.test.ts src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx src/renderer/src/components/agent/__tests__/AgentSendFeedbackAnnouncer.test.tsx src/renderer/src/components/__tests__/App.agentSendConfirm.test.tsx` を足して流す
Expected: PASS
Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 8: 変異で確かめる**

1. `getPromptRunAvailability` の種類の判定を `isSessionClosing`・`isSessionRunning` の判定の後ろへ移す → `copilot の理由は、閉じる途中・未起動・送信中より先…` が落ちる。戻す
2. `useAgentPromptSender.send` の先頭の守りを消す → `準備・送り先の控え・入力の保留・書き込みをどれもせず…` が落ちる。戻す
3. `useAgentSendConfirm.request` の `cliKind` の写しを消し、`target` を `{ slotId, controller, describeSession, cliKind: 'claude' }` にする → `確認を開いた時点の送り先の cliKind を控え…` が落ちる。戻す
4. `useAgentWorkspace` の `buildPromptRunPanelState` に渡す `cliKind` を `'claude'` にする → `選択中のタブが copilot なら実行を押せず…` が落ちる。戻す
5. `targetBlockedReason` の `cliKind` を `'claude'` にする → `送信前の確認の送れない理由は…` が落ちる。戻す
6. `git diff` で戻したことを確かめる

- [ ] **Step 9: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/renderer/src/lib/agentCliMessages.ts src/renderer/src/lib/agentPromptSend.ts src/renderer/src/lib/agentSendMessages.ts src/renderer/src/lib/promptRunState.ts src/renderer/src/hooks/useAgentPromptSender.ts src/renderer/src/hooks/useAgentSendConfirm.ts src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/lib/__tests__/promptRunState.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check <同じファイル>`
Expected: すべて整形済み

---

### Task 5b: renderer の中断・再開の入口と `起動` の名前

> **設計書の読む節:** 「renderer の「使えない」の出し方」の入口ごとの表（帯の `中断`・`前回の続きから`・履歴の `このセッションで再開`・`起動`・`+` の行）と表の後の「判定に使う種類」の段落、「文言」の `起動` の `aria-label`、「既知の制約」の別のウィンドウの行、「テスト方針」の `agentInterrupt.test.ts`・`agentResumeAvailability.test.ts`。
>
> **気をつける知見:** L-041（`copilot` で使えない入口を拒否するコードとテストで対象外にする）・L-058（押した処理の先頭でも同じ純関数で止める）・L-060（純関数の種類の引数・`AgentTerminalPanelState.appCliKind` を必須にする）

**Files:**

- Modify: `src/renderer/src/lib/agentInterrupt.ts`・`src/renderer/src/hooks/useAgentInterrupt.ts`・`src/renderer/src/lib/agentResumeAvailability.ts`・`src/renderer/src/hooks/useAgentResume.ts`・`src/renderer/src/lib/agentSessionMessages.ts`・`src/renderer/src/components/agent/AgentTerminalPanel.tsx`・`src/renderer/src/hooks/useAgentWorkspace.ts`・`src/renderer/src/__tests__/makeAgentTerminalPanelState.ts`
- Test: `src/renderer/src/lib/__tests__/agentInterrupt.test.ts`・`src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts`・`src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts`・`src/renderer/src/hooks/__tests__/useAgentResume.test.ts`・`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`・`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`

**Interfaces:**

- Consumes: Task 5a の `agentInterruptUnsupportedReason`・`agentResumeLastUnsupportedReason`・`agentResumeEntryUnsupportedReason`、Task 4 の `AgentSessionTabView.cliKind` と `useAgentWorkspace` の一時の `appCliKind`
- Produces:

```ts
// src/renderer/src/lib/agentInterrupt.ts
AgentInterruptAvailabilityInput.cliKind: AgentCliKind // 選択中のタブの種類
// src/renderer/src/hooks/useAgentInterrupt.ts
export type AgentInterruptTab = Pick<AgentSessionTabView, 'slotId' | 'label' | 'status' | 'isClosing' | 'cliKind'> & {
  controller: Pick<AgentTerminalController, 'readScreen'>
}
// src/renderer/src/lib/agentResumeAvailability.ts(どちらも appCliKind: AgentCliKind を必須で受け取る)
getResumeLastDisabledReason({ startDisabledReason, appCliKind, lastSession, tabs })
getResumeEntryDisabledReason({ mode, appCliKind, folderPath, recorded, startDisabledReason, addDisabledReason, tabs })
// src/renderer/src/hooks/useAgentResume.ts
UseAgentResumeOptions.appCliKind: AgentCliKind
// src/renderer/src/lib/agentSessionMessages.ts
export function agentStartAriaLabel(commandName: string): string
// src/renderer/src/hooks/useAgentWorkspace.ts
AgentTerminalPanelState.appCliKind: AgentCliKind // 必須
```

- [ ] **Step 1: 失敗するテストを書く（中断）**

`src/renderer/src/lib/__tests__/agentInterrupt.test.ts`:

1. `RUNNING_WORKING` に `cliKind: 'claude',` を足す（今の組の表はすべて `claude` で確かめる）
2. import に `import { agentInterruptUnsupportedReason } from '../agentCliMessages'` を足し、末尾に足す:

```ts
describe('getAgentInterruptAvailability(CLI の種類)', () => {
  const COPILOT = agentInterruptUnsupportedReason('copilot')
  const COPILOT_RUNNING: AgentInterruptAvailabilityInput = {
    ...RUNNING_WORKING,
    cliKind: 'copilot'
  }

  it('copilot の running は出すが押せず、閉じる途中・送信中・確認の表示中・待ち・活動より先にその理由', () => {
    for (const activity of ACTIVITIES) {
      for (const flag of FLAGS) {
        const input: AgentInterruptAvailabilityInput = { ...COPILOT_RUNNING, activity }
        input[flag] = true
        expect(getAgentInterruptAvailability(input)).toEqual({ visible: true, reason: COPILOT })
      }
      expect(getAgentInterruptAvailability({ ...COPILOT_RUNNING, activity })).toEqual({
        visible: true,
        reason: COPILOT
      })
    }
  })

  it('copilot でも starting は起動中の理由が先(判定の順は starting の直後)', () => {
    expect(getAgentInterruptAvailability({ ...COPILOT_RUNNING, status: 'starting' })).toEqual({
      visible: true,
      reason: AGENT_INTERRUPT_DISABLED_STARTING
    })
  })

  it.each(['none', 'exited'] as const)('copilot の %s は出さない', (status) => {
    expect(getAgentInterruptAvailability({ ...COPILOT_RUNNING, status })).toEqual({
      visible: false,
      reason: AGENT_INTERRUPT_NOT_RUNNING
    })
  })

  it('押した時点の判定も、copilot なら画面を読まずに止める(L-058)', () => {
    const readScreen = vi.fn((): readonly ViewportLine[] => agentScreen('working').lines)
    expect(checkAgentInterruptAtPress(COPILOT_RUNNING, readScreen)).toEqual({
      kind: 'blocked',
      reason: COPILOT
    })
    expect(readScreen).not.toHaveBeenCalled()
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts`:

1. `選択中のタブは AgentInterruptTab の値(…)だけで押せる` の `selected` に `cliKind: 'claude',` を足し、テスト名の値の並びに `cliKind` を足す
2. `describe('toAgentInterruptAvailabilityInput', …)` の 1 つ目の期待に `cliKind: 'claude',` を足す
3. import に `import { agentInterruptUnsupportedReason } from '../../lib/agentCliMessages'` を足し、`describe('useAgentInterrupt', …)` の中の末尾に足す:

```ts
it('選択中のタブが copilot なら押せず理由を出し、押しても interrupt を呼ばずに理由を読み上げる', async () => {
  const { result } = render({ selected: { ...tab1, cliKind: 'copilot' } })
  const reason = agentInterruptUnsupportedReason('copilot')
  expect(result.current).toMatchObject({ visible: true, disabledReason: reason })
  await press(result)
  expect(interrupt).not.toHaveBeenCalled()
  expect(result.current.notice?.text).toBe(reason)
})
```

`describe('toAgentInterruptAvailabilityInput', …)` の中に足す:

```ts
it('選択中のタブの種類を写す', () => {
  const input = toAgentInterruptAvailabilityInput(
    {
      selected: { ...runningTab('slot-1', 1), cliKind: 'copilot' },
      activities: workingOf('slot-1'),
      isSending: false,
      isSendConfirmOpen: false
    },
    false
  )
  expect(input.cliKind).toBe('copilot')
})
```

- [ ] **Step 2: 失敗するテストを書く（再開・`起動` の名前）**

`src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts`:

1. `getResumeLastDisabledReason({ … })` と `getResumeEntryDisabledReason({ … })` のすべての呼び出しに `appCliKind: 'claude',` を足す（`npm run typecheck` が場所を示す。エントリの方は共通の引数のオブジェクトがあればそこに足す）
2. import に `import { agentResumeEntryUnsupportedReason, agentResumeLastUnsupportedReason } from '../agentCliMessages'` を足し、末尾に足す:

```ts
describe('再開の入口の CLI の種類(設定の種類)', () => {
  const LAST = agentResumeLastUnsupportedReason('copilot')
  const ENTRY = agentResumeEntryUnsupportedReason('copilot')
  const recorded = { claudeSessionId: ID, tabLabel: 'claude 1', folderPath: '/work' }

  it('前回の続きから: 設定が copilot なら、取得中・記録なし・同じ ID のタブより先にその理由', () => {
    for (const lastSession of [
      { kind: 'loading' as const },
      { kind: 'none' as const },
      { kind: 'found' as const, claudeSessionId: ID }
    ]) {
      expect(
        getResumeLastDisabledReason({
          startDisabledReason: null,
          appCliKind: 'copilot',
          lastSession,
          tabs: [tab({ status: 'running', claudeSessionId: ID })]
        })
      ).toBe(LAST)
    }
  })

  it('前回の続きから: 起動の理由(フォルダ無し・切り替えの途中)は copilot の理由より先', () => {
    expect(
      getResumeLastDisabledReason({
        startDisabledReason: '使うエージェント CLI を切り替えています',
        appCliKind: 'copilot',
        lastSession: { kind: 'found', claudeSessionId: ID },
        tabs: []
      })
    ).toBe('使うエージェント CLI を切り替えています')
  })

  it('このセッションで再開: 設定が copilot なら、フォルダ・起動の理由・同じ ID・上限より先にその理由', () => {
    expect(
      getResumeEntryDisabledReason({
        mode: 'agent-cli',
        appCliKind: 'copilot',
        folderPath: '/other',
        recorded,
        startDisabledReason: 'フォルダを開いてください',
        addDisabledReason: 'タブは 4 つまでです（使わないタブを閉じると追加できます）',
        tabs: [tab({ status: 'running', claudeSessionId: ID })]
      })
    ).toBe(ENTRY)
  })

  it('このセッションで再開: 読み込み中・従来の方式の理由は copilot の理由より先(判定の順は実行方式の直後)', () => {
    const base = {
      appCliKind: 'copilot' as const,
      folderPath: '/work',
      recorded,
      startDisabledReason: null,
      addDisabledReason: null,
      tabs: []
    }
    expect(getResumeEntryDisabledReason({ ...base, mode: null })).toBe('設定を読み込んでいます')
    expect(getResumeEntryDisabledReason({ ...base, mode: 'legacy' })).toBe(
      'エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）'
    )
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentResume.test.ts`:

1. `renderResume` の既定の `options` と、`実行中のタブの ID の並びが変わっても…` などで手で作っている `UseAgentResumeOptions` に `appCliKind: 'claude',` を足す
2. import に `import { agentResumeEntryUnsupportedReason, agentResumeLastUnsupportedReason } from '../../lib/agentCliMessages'` を足し、`describe('useAgentResume', …)` の中の末尾に足す:

```ts
describe('設定の種類が再開に対応していない(copilot)', () => {
  it('前回の続きからは理由を出し、前回が見つかっていても押しても起動しない', () => {
    mockUseAgentLastSession.mockReturnValue({ kind: 'found', claudeSessionId: ID })
    const sessions = makeAgentSessionsState()
    const { result } = renderResume({ appCliKind: 'copilot', sessions })
    expect(result.current.resumeLast.disabledReason).toBe(
      agentResumeLastUnsupportedReason('copilot')
    )
    act(() => result.current.resumeLast.onResume('slot-1'))
    expect(sessions.start).not.toHaveBeenCalled()
  })

  it('このセッションで再開は理由を出し、押しても新しいタブを足さない', () => {
    const sessions = makeAgentSessionsState()
    const { result, options } = renderResume({ appCliKind: 'copilot', sessions })
    expect(result.current.resumeActionOf(agentEntry())).toEqual({
      disabled: true,
      reason: agentResumeEntryUnsupportedReason('copilot')
    })
    act(() => result.current.onResumeEntry(agentEntry()))
    expect(sessions.resumeInNewTab).not.toHaveBeenCalled()
    expect(options.activateTab).not.toHaveBeenCalled()
  })
})
```

`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts` の import に `agentStartAriaLabel` を足し、末尾に足す:

```ts
describe('起動の名前', () => {
  it('可視の文言「起動」で始め、起動するコマンドの名前を入れる', () => {
    expect(agentStartAriaLabel('claude')).toBe('起動（開いているフォルダで claude を起動）')
    expect(agentStartAriaLabel('copilot')).toBe('起動（開いているフォルダで copilot を起動）')
  })
})
```

`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx` の `見出し・状態(未起動)・起動・最大化を出し…` の次に足す:

```tsx
it('起動の名前は設定の種類のコマンド名(appCliKind)', () => {
  render(
    <AgentTerminalPanel
      state={makeAgentTerminalPanelState({ sessions: makeSessions(), appCliKind: 'copilot' })}
    />
  )
  expect(
    screen.getByRole('button', { name: '起動（開いているフォルダで copilot を起動）' })
  ).toBeEnabled()
})
```

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` の `ターミナルのパネルにセッション・レイアウト・送信中のタブを渡す` の中の期待の末尾に `expect(result.current.agentTerminal.appCliKind).toBe('claude')` を足す（Task 6 で設定の値に替わる）。

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts src/renderer/src/hooks/__tests__/useAgentResume.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: FAIL（種類を見ない・`agentStartAriaLabel` が無い・`appCliKind` が無い）

- [ ] **Step 4: 中断の入口を実装する**

`src/renderer/src/lib/agentInterrupt.ts`:

1. import に `import { AGENT_CLI_PROFILES, agentCliCapabilities } from '@shared/agentCliKinds'`・`import type { AgentCliKind } from '@shared/agentCliKinds'`・`import { agentInterruptUnsupportedReason } from './agentCliMessages'` を足す
2. `AgentInterruptAvailabilityInput` の `status` の次に足す:

```ts
/** 対象のタブ(選択中のタブ)の CLI の種類。中断に対応しない種類(copilot)は押せない */
cliKind: AgentCliKind
```

3. `blockedReasonOf` の `starting` の行の次に足し、JSDoc の順を「起動中 → CLI が中断に対応していない → 閉じる途中 → …」にする:

```ts
// CLI に中断の能力が無い(copilot など)。起動中の直後・閉じる途中より前(設計書「入口ごとの表」)。main では拒否しない
if (!agentCliCapabilities(input.cliKind).interrupt) {
  return agentInterruptUnsupportedReason(AGENT_CLI_PROFILES[input.cliKind].commandName)
}
```

`src/renderer/src/hooks/useAgentInterrupt.ts`: `AgentInterruptTab` の `Pick` に `'cliKind'` を足し（JSDoc の値の並びにも「種類に cliKind」を足す）、`toAgentInterruptAvailabilityInput` の戻り値に `cliKind: selected.cliKind,` を足す（`status` の次）。

- [ ] **Step 5: 再開の入口と `起動` の名前を実装する**

`src/renderer/src/lib/agentResumeAvailability.ts`:

1. import に `import { AGENT_CLI_PROFILES, agentCliCapabilities } from '@shared/agentCliKinds'`・`import type { AgentCliKind } from '@shared/agentCliKinds'`・`import { agentResumeEntryUnsupportedReason, agentResumeLastUnsupportedReason } from './agentCliMessages'` を足す
2. `getResumeLastDisabledReason` の引数に `appCliKind`（型 `appCliKind: AgentCliKind`。JSDoc「設定の種類(次に起動する CLI)」）を足し、`startDisabledReason` の判定の次に足す（JSDoc の順に「設定の CLI が再開に対応していない」を足す）:

```ts
// 次に起動する CLI(設定の種類)が再開に対応していない。起動の理由の直後(設計書「入口ごとの表」)。main も resume-unsupported で断る
if (!agentCliCapabilities(appCliKind).sessionResume) {
  return agentResumeLastUnsupportedReason(AGENT_CLI_PROFILES[appCliKind].commandName)
}
```

3. `getResumeEntryDisabledReason` の引数に `appCliKind: AgentCliKind` を足し、`mode !== 'agent-cli'` の判定の次に足す（JSDoc の順に「設定の CLI が再開に対応していない」を足す）:

```ts
// 設定の CLI が再開に対応していない。実行方式の判定の直後(設計書「入口ごとの表」)
if (!agentCliCapabilities(appCliKind).sessionResume) {
  return agentResumeEntryUnsupportedReason(AGENT_CLI_PROFILES[appCliKind].commandName)
}
```

`src/renderer/src/hooks/useAgentResume.ts`: `UseAgentResumeOptions` の `mode` の次に `appCliKind: AgentCliKind`（JSDoc「設定の種類(次に起動する CLI)。再開の入口の判定に使う(タブの種類ではない)」）を足し（`import type { AgentCliKind } from '@shared/agentCliKinds'`）、分割代入と 2 つの純関数の呼び出しに `appCliKind` を足す。

`src/renderer/src/lib/agentSessionMessages.ts` の `AGENT_START_DISABLED_NO_FOLDER` の次に足す:

```ts
/** 帯の 起動 の aria-label。可視の文言「起動」で始める(パターン 76)。commandName は設定の種類のコマンド名 */
export function agentStartAriaLabel(commandName: string): string {
  return `起動（開いているフォルダで ${commandName} を起動）`
}
```

`src/renderer/src/hooks/useAgentWorkspace.ts`:

1. `AgentTerminalPanelState` の末尾に足す:

```ts
/** 設定の種類(次に起動する CLI)。帯の 起動 の名前に使う(タブの名前・能力はタブの cliKind) */
appCliKind: AgentCliKind
```

2. `useAgentResume({ … })` の引数に `appCliKind,` を足す
3. 戻り値の `agentTerminal` に `appCliKind` を足す

`src/renderer/src/__tests__/makeAgentTerminalPanelState.ts` の `makeAgentTerminalPanelState` の既定に `appCliKind: 'claude',` を足す。

`src/renderer/src/components/agent/AgentTerminalPanel.tsx`: import に `import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'` と（`agentSessionMessages` の import に）`agentStartAriaLabel` を足し、`state` の分割代入に `appCliKind` を足して、`起動` の `aria-label` を次にする:

<!-- prettier-ignore -->
```tsx
              aria-label={agentStartAriaLabel(AGENT_CLI_PROFILES[appCliKind].commandName)}
```

- [ ] **Step 6: テストが通ることを確かめる**

Run: Step 3 と同じコマンドに `src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx src/renderer/src/components/__tests__/App.agentReferences.test.tsx src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx` を足して流す
Expected: PASS
Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: 変異で確かめる**

1. `blockedReasonOf` の種類の判定を `isClosing` の判定の後ろへ移す → `copilot の running は出すが押せず…より先にその理由` が落ちる。戻す
2. `toAgentInterruptAvailabilityInput` の `cliKind: selected.cliKind` を `cliKind: 'claude'` にする → `選択中のタブが copilot なら押せず…`・`選択中のタブの種類を写す` が落ちる。戻す
3. `getResumeLastDisabledReason` の種類の判定を消す → `前回の続きから: 設定が copilot なら…`・`前回の続きからは理由を出し…` が落ちる。戻す
4. `useAgentResume` の `getResumeEntryDisabledReason` に渡す `appCliKind` を `'claude'` にする → `このセッションで再開は理由を出し…` が落ちる。戻す
5. `AgentTerminalPanel` の `aria-label` を `agentStartAriaLabel('claude')` にする → `起動の名前は設定の種類のコマンド名` が落ちる。戻す
6. `git diff` で戻したことを確かめる

- [ ] **Step 8: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/renderer/src/lib/agentInterrupt.ts src/renderer/src/hooks/useAgentInterrupt.ts src/renderer/src/lib/agentResumeAvailability.ts src/renderer/src/hooks/useAgentResume.ts src/renderer/src/lib/agentSessionMessages.ts src/renderer/src/components/agent/AgentTerminalPanel.tsx src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/__tests__/makeAgentTerminalPanelState.ts src/renderer/src/lib/__tests__/agentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts src/renderer/src/hooks/__tests__/useAgentResume.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check <同じファイル>`
Expected: すべて整形済み

---

### Task 6: renderer の設定の画面と切り替え（配線の変異の確認を含む）

> **設計書の読む節:** 「決めたこと（推奨案）」の切り替えの時機、「設定」の「画面（renderer）」（箇条書き・表・表の後の段落）と「切り替え（renderer。`useAgentWorkspace`）」（コードと箇条書きのすべて）、入口ごとの表の「完了・許可待ちの通知」「設定の CLI の切り替え」の行、「文言」の実行方式の選択肢、「エラー処理」の保存の失敗・止められなかったタブの行、「既知の制約」の別のウィンドウ・読み込み前の名前の行、「テスト方針」の `useAgentCliKind.test.ts`・`AgentCliKindSection.test.tsx`・`SettingsPanel.test.tsx`・配線。
>
> **気をつける知見:** L-001（保存の失敗は前の値に戻して false。`stopAll` が false なら保存しない）・L-058（選べない間は `disabled` にし、`selectAgentCliKind` の先頭でも同じ条件で止める）・L-060（`agentCliKindPanel`・`SettingsPanel`・`Sidebar` の props を必須にし、受け渡しを 1 つずつ外す変異で落ちることを確かめる）・L-466（設定の画面と入口が同じ state を読み、選んだ値はすぐ反映する）

**Files:**

- Create: `src/renderer/src/hooks/useAgentCliKind.ts`・`src/renderer/src/hooks/__tests__/useAgentCliKind.test.ts`・`src/renderer/src/components/settings/AgentCliKindSection.tsx`・`src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx`
- Modify: `src/renderer/src/types.ts`・`src/renderer/src/lib/agentSessionMessages.ts`・`src/renderer/src/components/settings/SettingsPanel.tsx`・`AgentNotificationSection.tsx`・`BooleanSettingSection.tsx`・`ExecutionModeSection.tsx`・`src/renderer/src/components/Sidebar.tsx`・`src/renderer/src/App.tsx`・`src/renderer/src/hooks/useAppState.ts`・`src/renderer/src/hooks/useAgentWorkspace.ts`・`src/renderer/src/__tests__/makeAgentWorkspaceState.ts`
- Test: `src/renderer/src/components/settings/__tests__/SettingsPanel.test.tsx`・`AgentNotificationSection.test.tsx`・`ExecutionModeSection.test.tsx`・`src/renderer/src/components/__tests__/Sidebar.test.tsx`・`src/renderer/src/components/__tests__/App.agentCli.test.tsx`・`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`

**Interfaces:**

- Consumes: Task 2 の `getAgentCliKind`・`setAgentCliKind`（`lib/settingsApi.ts`）、Task 5a の `agentCliKindOptionLabel`・`agentCliUnsupportedFeaturesNote`・`agentCliFallbackNote`・`AGENT_CLI_KIND_SECTION_TITLE`・`AGENT_CLI_KIND_SECTION_NOTE`・`AGENT_CLI_KIND_LOCKED_WHILE_STARTING`・`AGENT_CLI_KIND_SAVE_ERROR_PREFIX`・`agentNotificationUnsupportedNote`、Task 4・5b の `useAgentWorkspace` の一時の `appCliKind`
- Produces:

```ts
// src/renderer/src/hooks/useAgentCliKind.ts
export interface AgentCliKindState {
  kind: AgentCliKind | null
  fallback: AgentCliKindSetting['fallback']
  saveError: string | null
  changeKind: (next: AgentCliKind) => Promise<boolean>
}
export function useAgentCliKind(): AgentCliKindState
// src/renderer/src/types.ts
export interface AgentNotificationPanelState extends BooleanSettingPanelState {
  unsupportedNote: string | null
}
export interface AgentCliKindPanelState {
  kind: AgentCliKind | null
  fallback: AgentCliKindSetting['fallback']
  saveError: string | null
  isLocked: boolean
  lockedReason: string | null
  onSelect: (kind: AgentCliKind) => void
}
// src/renderer/src/lib/agentSessionMessages.ts
export const AGENT_START_DISABLED_SWITCHING_CLI_KIND = '使うエージェント CLI を切り替えています'
export const AGENT_STOP_ON_CLI_KIND_CHANGE_CONFIRM = '使う CLI を切り替えると、動いているエージェントをすべて終了します。切り替えますか？'
// src/renderer/src/hooks/useAgentWorkspace.ts
AgentWorkspaceState.agentCliKindPanel: AgentCliKindPanelState // 必須
// SettingsPanel・Sidebar の props: agentCliKind: AgentCliKindPanelState(必須)。useAppState の戻り値: agentCliKindPanel
```

- [ ] **Step 1: 失敗するテストを書く（設定の hook）**

`src/renderer/src/hooks/__tests__/useAgentCliKind.test.ts` を作る:

```ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

vi.mock('../../lib/settingsApi')

import * as settingsApi from '../../lib/settingsApi'
import { useAgentCliKind } from '../useAgentCliKind'

const mockGet = vi.mocked(settingsApi.getAgentCliKind)
const mockSet = vi.mocked(settingsApi.setAgentCliKind)
let consoleErrorSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = null
})

describe('useAgentCliKind', () => {
  it('読み込みが終わるまでは null、終わったら保存された種類と既定に戻した理由', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: 'invalid-value' })
    const { result } = renderHook(() => useAgentCliKind())
    expect(result.current.kind).toBeNull()
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    expect(result.current.fallback).toBe('invalid-value')
  })

  it('読み込みの IPC が拒否されたら claude と read-failed にし、記録する(画面を止めない)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockRejectedValueOnce(new Error('ipc'))
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    expect(result.current.fallback).toBe('read-failed')
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('選んだらすぐ保存して表示を切り替え、既定に戻した旨を消す', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: 'invalid-value' })
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await expect(result.current.changeKind('copilot')).resolves.toBe(true)
    })
    expect(mockSet).toHaveBeenCalledExactlyOnceWith('copilot')
    expect(result.current).toMatchObject({ kind: 'copilot', fallback: null, saveError: null })
  })

  it('保存に失敗したら保存の前の値に戻し、false を返して理由を出す(既定に戻した旨は残す。L-001)', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: 'read-failed' })
    mockSet.mockRejectedValueOnce(new Error('disk full'))
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await expect(result.current.changeKind('copilot')).resolves.toBe(false)
    })
    expect(result.current).toMatchObject({
      kind: 'claude',
      fallback: 'read-failed',
      saveError: '使うエージェント CLI を保存できませんでした: disk full'
    })
  })

  it('次の保存で失敗の文言を消す', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: null })
    mockSet.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await result.current.changeKind('copilot')
    })
    await act(async () => {
      await result.current.changeKind('copilot')
    })
    expect(result.current).toMatchObject({ kind: 'copilot', saveError: null })
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（設定の画面）**

`src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx` を作る:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import AgentCliKindSection from '../AgentCliKindSection'
import type { AgentCliKindPanelState } from '../../../types'
import { AGENT_CLI_CAPABILITY_NAMES } from '../../../lib/agentCliMessages'

const LOCKED = 'エージェントの起動中は、使う CLI を切り替えられません'

const props = (overrides: Partial<AgentCliKindPanelState> = {}): AgentCliKindPanelState => ({
  kind: 'claude',
  fallback: null,
  saveError: null,
  isLocked: false,
  lockedReason: null,
  onSelect: vi.fn(),
  ...overrides
})

describe('AgentCliKindSection', () => {
  it('見出しを名前にした radiogroup に 2 つの radio を出し、選択中を aria-checked で示す。説明も出す', () => {
    render(<AgentCliKindSection {...props()} />)
    expect(screen.getByRole('radiogroup', { name: '使うエージェント CLI' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Claude Code（claude）' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: 'GitHub Copilot CLI（copilot）' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(
      screen.getByText('エージェント CLI 方式で使います。切り替えると、次の起動から使われます')
    ).toBeInTheDocument()
  })

  it('選ぶと onSelect を呼ぶ。選択中のものを押しても呼ばない', async () => {
    const onSelect = vi.fn()
    render(<AgentCliKindSection {...props({ onSelect })} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Claude Code（claude）' }))
    await userEvent.click(screen.getByRole('radio', { name: 'GitHub Copilot CLI（copilot）' }))
    expect(onSelect.mock.calls).toEqual([['copilot']])
  })

  it('読み込み中(kind が null)は選べず、読み込み中と出す(isLocked が false でも)', () => {
    render(<AgentCliKindSection {...props({ kind: null })} />)
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('選べない間(切り替えの途中など)は disabled', () => {
    render(<AgentCliKindSection {...props({ isLocked: true })} />)
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
  })

  it('起動中の理由を出し、選択肢から aria-describedby で参照する', () => {
    render(<AgentCliKindSection {...props({ isLocked: true, lockedReason: LOCKED })} />)
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled()
      expect(radio).toHaveAccessibleDescription(LOCKED)
    }
  })

  it('copilot を選んでいると、使えない機能の注記に能力の表のすべての名前を含む', () => {
    render(<AgentCliKindSection {...props({ kind: 'copilot' })} />)
    const note = screen.getByText(
      /^copilot では次の機能を使えません（ターミナルで直接操作します）: /
    )
    for (const name of Object.values(AGENT_CLI_CAPABILITY_NAMES)) {
      expect(note).toHaveTextContent(name)
    }
  })

  it('claude では使えない機能の注記を出さない', () => {
    render(<AgentCliKindSection {...props()} />)
    expect(screen.queryByText(/では次の機能を使えません/)).toBeNull()
  })

  it.each([
    [
      'invalid-value',
      '保存されていた値を読めなかったため claude を使っています（選び直すと保存します）'
    ],
    ['read-failed', '設定ファイルを読めなかったため claude を使っています']
  ] as const)('既定に戻した旨(%s)を role="alert" にせずに出す', (fallback, text) => {
    render(<AgentCliKindSection {...props({ fallback })} />)
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('保存の失敗を role="alert" で出す', () => {
    render(
      <AgentCliKindSection
        {...props({ saveError: '使うエージェント CLI を保存できませんでした: x' })}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      '使うエージェント CLI を保存できませんでした: x'
    )
  })
})
```

`src/renderer/src/components/settings/__tests__/SettingsPanel.test.tsx`:

1. `defaultProps` に足す:

```tsx
  agentCliKind: {
    kind: 'claude' as const,
    fallback: null,
    saveError: null,
    isLocked: false,
    lockedReason: null,
    onSelect: vi.fn()
  },
```

2. `agentNotification を渡すとエージェントの通知の節へ…` の `agentNotification` の値に `unsupportedNote: null` を足す
3. 末尾（`describe` の中）に足す:

```tsx
it('プロンプトの実行方式の直後に使うエージェント CLI を出し、6 つの節が並ぶ', () => {
  const { container } = render(
    <SettingsPanel
      {...defaultProps}
      executionMode={{ mode: 'agent-cli', saveError: null, isLocked: false, onSelect: vi.fn() }}
      agentNotification={{
        enabled: true,
        saveError: null,
        onChange: vi.fn(),
        unsupportedNote: null
      }}
    />
  )
  expect(
    // 節の見出しは <p>。ModelSettingsSection の max_tokens の <label> も同じクラスなので p に限る
    Array.from(container.querySelectorAll('p.settings-panel__label'), (label) => label.textContent)
  ).toEqual([
    'プロンプトの実行方式',
    '使うエージェント CLI',
    'エージェントの通知',
    '送信前の確認',
    'Anthropic API キー',
    'モデル'
  ])
})

it('使うエージェント CLI の節へ agentCliKind の値を渡し、選んだ値を onSelect へ渡す', async () => {
  const onSelect = vi.fn()
  render(
    <SettingsPanel
      {...defaultProps}
      agentCliKind={{ ...defaultProps.agentCliKind, kind: 'copilot', onSelect }}
    />
  )
  expect(screen.getByRole('radio', { name: 'GitHub Copilot CLI（copilot）' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await userEvent.click(screen.getByRole('radio', { name: 'Claude Code（claude）' }))
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('claude')
})

it('通知の項目に、選んだ CLI で通知を出せない旨の注記を出す', () => {
  const note = 'copilot では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）'
  render(
    <SettingsPanel
      {...defaultProps}
      agentNotification={{
        enabled: true,
        saveError: null,
        onChange: vi.fn(),
        unsupportedNote: note
      }}
    />
  )
  expect(screen.getByText(note)).toHaveClass('settings-panel__note')
})
```

`src/renderer/src/components/settings/__tests__/AgentNotificationSection.test.tsx` のすべての `render(<AgentNotificationSection … />)` に `unsupportedNote={null}` を足し、末尾に足す:

```tsx
it('注記(unsupportedNote)があれば説明の後ろに出し、無ければ出さない', () => {
  const note = 'copilot では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）'
  const { rerender } = render(
    <AgentNotificationSection enabled saveError={null} onChange={vi.fn()} unsupportedNote={note} />
  )
  expect(screen.getByText(note)).toHaveClass('settings-panel__note')
  rerender(
    <AgentNotificationSection enabled saveError={null} onChange={vi.fn()} unsupportedNote={null} />
  )
  expect(screen.queryByText(note)).toBeNull()
})
```

`src/renderer/src/components/settings/__tests__/ExecutionModeSection.test.tsx` の末尾（`describe` の中）に足す:

```tsx
it('エージェント CLI の選択肢は特定の CLI の名前を書かない(使う CLI は別の節で選ぶ)', () => {
  render(
    <ExecutionModeSection mode="agent-cli" saveError={null} isLocked={false} onSelect={vi.fn()} />
  )
  expect(
    screen.getByRole('radio', {
      name: 'エージェント CLI（アプリ内のターミナルでエージェント CLI を動かす）'
    })
  ).toBeInTheDocument()
})
```

`src/renderer/src/components/__tests__/Sidebar.test.tsx` の `defaultProps` の `agentSendConfirm` の次に足す:

```tsx
  agentCliKind: {
    kind: 'claude' as const,
    fallback: null,
    saveError: null,
    isLocked: false,
    lockedReason: null,
    onSelect: vi.fn()
  },
```

`src/renderer/src/components/__tests__/App.agentCli.test.tsx` の `beforeEach` に `window.api.getAgentCliKind = vi.fn().mockResolvedValue({ kind: 'claude', fallback: null })` を足し、`設定にプロンプトの実行方式を出し…` の次に足す:

```tsx
it('設定に使うエージェント CLI を出して保存された種類を選び、帯の 起動 の名前もその種類にする', async () => {
  window.api.getAgentCliKind = vi.fn().mockResolvedValue({ kind: 'copilot', fallback: null })
  render(<App />)
  expect(
    await screen.findByRole('button', { name: '起動（開いているフォルダで copilot を起動）' })
  ).toBeInTheDocument()
  await userEvent.click(panelButton('settings'))
  const group = await screen.findByRole('radiogroup', { name: '使うエージェント CLI' })
  await waitFor(() =>
    expect(
      within(group).getByRole('radio', { name: 'GitHub Copilot CLI（copilot）' })
    ).toHaveAttribute('aria-checked', 'true')
  )
})
```

`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`: `通知の設定の項目を…` の `agentNotificationPanel` の値に `unsupportedNote: null` を足し、その次に足す:

```ts
it('使うエージェント CLI の設定の項目を、useAgentWorkspace の戻り値のまま公開する', () => {
  const workspace = makeAgentWorkspaceState({
    agentCliKindPanel: {
      kind: 'copilot',
      fallback: 'invalid-value',
      saveError: null,
      isLocked: false,
      lockedReason: null,
      onSelect: vi.fn()
    }
  })
  mockUseAgentWorkspace.mockReturnValue(workspace)
  const { result } = renderHook(() => useAppState())
  expect(result.current.agentCliKindPanel).toBe(workspace.agentCliKindPanel)
})
```

- [ ] **Step 3: 失敗するテストを書く（切り替えと配線）**

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`:

1. `vi.mock('../useExecutionMode', …)` の前に足し、`beforeEach` の `mockUseExecutionMode.mockImplementation(…)` の次に `setCliKind('claude')` を足す:

```ts
const mockUseAgentCliKind = vi.hoisted(() => vi.fn())
vi.mock('../useAgentCliKind', () => ({ useAgentCliKind: mockUseAgentCliKind }))
```

```ts
// 使う CLI の設定(既定は claude を読み込み済み)
const setCliKind = (
  kind: AgentCliKind | null,
  changeKind = vi.fn<(next: AgentCliKind) => Promise<boolean>>(async () => true),
  overrides: { fallback?: AgentCliKindSetting['fallback']; saveError?: string | null } = {}
): typeof changeKind => {
  mockUseAgentCliKind.mockReturnValue({
    kind,
    fallback: overrides.fallback ?? null,
    saveError: overrides.saveError ?? null,
    changeKind
  })
  return changeKind
}
```

（`setCliKind` は `setSendConfirmEnabled` の次に置き、import に `import type { AgentCliKind } from '@shared/agentCliKinds'` と、`@shared/types` の型の import に `AgentCliKindSetting` を足す）

2. import に `AGENT_START_DISABLED_SWITCHING_CLI_KIND`（`agentSessionMessages` の import）と `import { AGENT_CLI_KIND_LOCKED_WHILE_STARTING, agentInterruptUnsupportedReason, agentNotificationUnsupportedNote, agentResumeEntryUnsupportedReason, agentResumeLastUnsupportedReason } from '../../lib/agentCliMessages'`（Task 5a の import の `agentPromptSendUnsupportedReason` とまとめる）を足す
3. `describe('実行方式の切り替え(executionModePanel.onSelect)', …)` の次に足す:

```ts
describe('使うエージェント CLI(agentCliKindPanel)', () => {
  const CLI_CHANGE_CONFIRM =
    '使う CLI を切り替えると、動いているエージェントをすべて終了します。切り替えますか？'
  const selectCli = async (result: Rendered['result'], kind: AgentCliKind): Promise<void> => {
    await act(async () => {
      result.current.agentCliKindPanel.onSelect(kind)
    })
  }

  it('設定の値・既定に戻した理由・保存の失敗を渡し、選べる', () => {
    setCliKind('copilot', undefined, { fallback: 'invalid-value', saveError: 'x' })
    const { result } = renderWorkspace()
    expect(result.current.agentCliKindPanel).toMatchObject({
      kind: 'copilot',
      fallback: 'invalid-value',
      saveError: 'x',
      isLocked: false,
      lockedReason: null
    })
  })

  it('設定の種類を useAgentSessions(appCliKind)・ターミナルのパネル・通知の注記に渡す', () => {
    setMode('agent-cli')
    setCliKind('copilot')
    const { result } = renderWorkspace()
    expect(mockUseAgentSessions).toHaveBeenLastCalledWith(
      expect.objectContaining({ appCliKind: 'copilot' })
    )
    expect(result.current.agentTerminal.appCliKind).toBe('copilot')
    expect(result.current.agentNotificationPanel.unsupportedNote).toBe(
      agentNotificationUnsupportedNote('copilot')
    )
  })

  it('読み込み中(null)は選べず、useAgentSessions には既定の claude を渡す', () => {
    setCliKind(null)
    const { result } = renderWorkspace()
    expect(result.current.agentCliKindPanel.isLocked).toBe(true)
    expect(mockUseAgentSessions).toHaveBeenLastCalledWith(
      expect.objectContaining({ appCliKind: 'claude' })
    )
    expect(result.current.agentNotificationPanel.unsupportedNote).toBeNull()
  })

  it('起動中のタブがあれば選べず、理由を出す', () => {
    mockUseAgentSessions.mockReturnValue(
      makeAgentSessionsState({ selected: { status: 'starting' } })
    )
    const { result } = renderWorkspace()
    expect(result.current.agentCliKindPanel).toMatchObject({
      isLocked: true,
      lockedReason: AGENT_CLI_KIND_LOCKED_WHILE_STARTING
    })
  })

  it('動いているタブがあれば確認し、OK なら停止を待ってから保存する', async () => {
    const order: string[] = []
    const changeKind = setCliKind(
      'claude',
      vi.fn(async () => {
        order.push('save')
        return true
      })
    )
    const sessions = makeAgentSessionsState({
      selected: { status: 'running' },
      stopAll: vi.fn(async () => {
        await Promise.resolve()
        order.push('stopped')
        return true
      })
    })
    mockUseAgentSessions.mockReturnValue(sessions)
    const onConfirm = vi.fn(() => true)
    const { result } = renderWorkspace({ onConfirm })
    await selectCli(result, 'copilot')
    await waitFor(() => expect(changeKind).toHaveBeenCalledWith('copilot'))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(CLI_CHANGE_CONFIRM)
    expect(order).toEqual(['stopped', 'save'])
  })

  it('確認でキャンセルしたら止めず、保存もしない', async () => {
    const changeKind = setCliKind('claude')
    const sessions = makeAgentSessionsState({ selected: { status: 'running' } })
    mockUseAgentSessions.mockReturnValue(sessions)
    const { result } = renderWorkspace({ onConfirm: () => false })
    await selectCli(result, 'copilot')
    await waitFor(() => expect(result.current.agentCliKindPanel.isLocked).toBe(false))
    expect(sessions.stopAll).not.toHaveBeenCalled()
    expect(changeKind).not.toHaveBeenCalled()
  })

  it('止められなかったタブがあれば保存しない', async () => {
    const changeKind = setCliKind('claude')
    const sessions = makeAgentSessionsState({
      selected: { status: 'running' },
      stopAll: vi.fn(async () => false)
    })
    mockUseAgentSessions.mockReturnValue(sessions)
    const { result } = renderWorkspace({ onConfirm: () => true })
    await selectCli(result, 'copilot')
    await waitFor(() => expect(result.current.agentCliKindPanel.isLocked).toBe(false))
    expect(sessions.stopAll).toHaveBeenCalledOnce()
    expect(changeKind).not.toHaveBeenCalled()
  })

  it('動いているタブが無ければ確認せずに保存する(従来の方式の間も選べる)', async () => {
    setMode('legacy')
    const changeKind = setCliKind('claude')
    const onConfirm = vi.fn(() => true)
    const { result } = renderWorkspace({ onConfirm })
    await selectCli(result, 'copilot')
    await waitFor(() => expect(changeKind).toHaveBeenCalledWith('copilot'))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('同じ値・読み込み中・起動中は何もしない(押した処理の側でも止める。L-058)', async () => {
    const changeKind = setCliKind('claude')
    const { result, rerender } = renderWorkspace()
    await selectCli(result, 'claude')
    setCliKind(null, changeKind)
    rerender()
    await selectCli(result, 'copilot')
    setCliKind('claude', changeKind)
    mockUseAgentSessions.mockReturnValue(
      makeAgentSessionsState({ selected: { status: 'starting' } })
    )
    rerender()
    await selectCli(result, 'copilot')
    expect(changeKind).not.toHaveBeenCalled()
  })

  it('切り替えの途中は起動の理由を出し、実行方式も使う CLI も選べない。終わったら戻す', async () => {
    setMode('agent-cli')
    let finishStop: () => void = () => undefined
    mockUseAgentSessions.mockReturnValue(
      makeAgentSessionsState({
        selected: { status: 'running' },
        stopAll: vi.fn(
          () =>
            new Promise<boolean>((resolve) => {
              finishStop = () => resolve(true)
            })
        )
      })
    )
    const { result } = renderWorkspace({ onConfirm: () => true })
    await selectCli(result, 'copilot')
    expect(mockUseAgentSessions).toHaveBeenLastCalledWith(
      expect.objectContaining({ startBlockedReason: AGENT_START_DISABLED_SWITCHING_CLI_KIND })
    )
    expect(result.current.executionModePanel.isLocked).toBe(true)
    expect(result.current.agentCliKindPanel.isLocked).toBe(true)
    await act(async () => {
      finishStop()
    })
    await waitFor(() => expect(result.current.agentCliKindPanel.isLocked).toBe(false))
    expect(result.current.executionModePanel.isLocked).toBe(false)
    expect(mockUseAgentSessions).toHaveBeenLastCalledWith(
      expect.objectContaining({ startBlockedReason: null })
    )
  })

  it('実行方式の切り替えの途中は、使う CLI を選べず、選んでも何もしない', async () => {
    setMode('agent-cli')
    const changeKind = setCliKind('claude')
    mockUseAgentSessions.mockReturnValue(
      makeAgentSessionsState({
        selected: { status: 'running' },
        stopAll: vi.fn(() => new Promise<boolean>(() => undefined))
      })
    )
    const { result } = renderWorkspace({ onConfirm: () => true })
    await select(result, 'legacy')
    expect(result.current.agentCliKindPanel.isLocked).toBe(true)
    await selectCli(result, 'copilot')
    expect(changeKind).not.toHaveBeenCalled()
  })
})
```

4. 末尾の `describe('中断の配線(…)', …)` の次（`describe('useAgentWorkspace', …)` の中）に足す:

```ts
describe('使う CLI の配線(本物の useAgentSessions。L-060)', () => {
  const CLAUDE_ID = '11111111-1111-4111-8111-111111111111'
  let startSpy: MockInstance<typeof window.api.startAgentSession> | null = null
  let slotId: string
  const agentEntry: HistoryEntry = {
    id: 'h-wire',
    promptId: 'p1',
    promptTitle: '要約',
    promptContent: '本文',
    fileContent: null,
    toolId: 'claude',
    status: 'sent',
    resultText: null,
    errorMessage: null,
    executedAt: 1000,
    agent: { claudeSessionId: CLAUDE_ID, tabLabel: 'claude 1', folderPath: '/p' }
  }

  beforeEach(async () => {
    const actual =
      await vi.importActual<typeof import('../useAgentSessions')>('../useAgentSessions')
    mockUseAgentSessions.mockImplementation(actual.useAgentSessions)
    setMode('agent-cli')
    slotId = getAgentSessionTabs().getSnapshot().selectedSlotId
  })

  afterEach(() => {
    startSpy?.mockRestore()
    startSpy = null
  })

  const startWith = async (result: Rendered['result'], cliKind: AgentCliKind): Promise<void> => {
    startSpy = vi.spyOn(window.api, 'startAgentSession').mockResolvedValue({
      kind: 'started',
      sessionId: 'sid-cli',
      cliKind,
      claudeSessionId: cliKind === 'claude' ? CLAUDE_ID : null
    })
    await act(async () => {
      await result.current.agentTerminal.sessions.start(slotId, { kind: 'new' })
    })
  }

  it('設定が copilot なら、未起動のタブの名前は copilot で、起動すると実行・中断・前回の続きから・このセッションで再開がどれも copilot の理由で押せない', async () => {
    setCliKind('copilot')
    const { result } = renderWorkspace({ folderPath: '/p' })
    expect(result.current.agentTerminal.sessions.selected.label).toBe('copilot 1')
    await startWith(result, 'copilot')
    expect(result.current.promptRun).toMatchObject({
      isRunDisabled: true,
      runDisabledReason: agentPromptSendUnsupportedReason('copilot')
    })
    expect(result.current.agentTerminal.interrupt.disabledReason).toBe(
      agentInterruptUnsupportedReason('copilot')
    )
    expect(result.current.agentTerminal.resumeLast.disabledReason).toBe(
      agentResumeLastUnsupportedReason('copilot')
    )
    expect(result.current.getHistoryActions(agentEntry).resume?.reason).toBe(
      agentResumeEntryUnsupportedReason('copilot')
    )
  })

  it('起動の結果が copilot なら、設定が claude のままでも(別のウィンドウで変えた場合)そのタブの実行は押せない', async () => {
    setCliKind('claude')
    const { result } = renderWorkspace({ folderPath: '/p' })
    await startWith(result, 'copilot')
    expect(result.current.agentTerminal.sessions.selected).toMatchObject({
      cliKind: 'copilot',
      label: 'copilot 1'
    })
    expect(result.current.promptRun.runDisabledReason).toBe(
      agentPromptSendUnsupportedReason('copilot')
    )
    // 再開の入口は設定の種類(claude)で決まる
    expect(result.current.agentTerminal.resumeLast.disabledReason).not.toBe(
      agentResumeLastUnsupportedReason('copilot')
    )
  })

  it('設定も起動の結果も claude なら、今までどおり実行を押せる', async () => {
    setCliKind('claude')
    const { result } = renderWorkspace({ folderPath: '/p' })
    await startWith(result, 'claude')
    expect(result.current.promptRun).toMatchObject({
      isRunDisabled: false,
      runDisabledReason: null
    })
  })
})
```

（`afterEach` は `describe` の中で使うので、ファイルの import の `afterEach` を確かめる〈既に import 済み〉）

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentCliKind.test.ts src/renderer/src/components/settings src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/App.agentCli.test.tsx src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: FAIL（hook・部品・`agentCliKindPanel`・切り替えが無い）

- [ ] **Step 5: 設定の hook・文言・型を実装する**

`src/renderer/src/hooks/useAgentCliKind.ts` を作る:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_AGENT_CLI_KIND } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliKindSetting } from '@shared/types'
import * as settingsApi from '../lib/settingsApi'
import { AGENT_CLI_KIND_SAVE_ERROR_PREFIX } from '../lib/agentCliMessages'
import { toError } from '../lib/errorUtils'

// 使うエージェント CLI の設定(設計書 2026-10-20「設定」の「画面」。useExecutionMode と同じ形)。読み込みは main が既定に戻した理由
// (fallback)も返す。useAgentWorkspace が 1 つだけ持ち、設定の画面と入口(タブの名前・再開の理由)が同じ値を読む(L-466)

export interface AgentCliKindState {
  /** 読み込みが終わるまでは null(選べない。入口は既定の claude で出す) */
  kind: AgentCliKind | null
  /** main が既定に戻した理由(設定の画面の注記)。保存に成功したら null に戻す */
  fallback: AgentCliKindSetting['fallback']
  /** 保存の失敗の文言。次の保存で消える */
  saveError: string | null
  /** 選んですぐ保存する。失敗したら保存前の値に戻し、false を返す */
  changeKind: (next: AgentCliKind) => Promise<boolean>
}

export function useAgentCliKind(): AgentCliKindState {
  const [kind, setKind] = useState<AgentCliKind | null>(null)
  const [fallback, setFallback] = useState<AgentCliKindSetting['fallback']>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const kindRef = useRef<AgentCliKind | null>(null)

  useEffect(() => {
    let cancelled = false
    // main は投げない(壊れた値は既定に戻して理由を返す)が、IPC が失敗したら既定で続け、読めなかった旨を出す
    settingsApi
      .getAgentCliKind()
      .then((loaded) => {
        if (cancelled) return
        kindRef.current = loaded.kind
        setKind(loaded.kind)
        setFallback(loaded.fallback)
      })
      .catch((err) => {
        console.error('[useAgentCliKind] getAgentCliKind failed:', err)
        if (cancelled) return
        kindRef.current = DEFAULT_AGENT_CLI_KIND
        setKind(DEFAULT_AGENT_CLI_KIND)
        setFallback('read-failed')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const changeKind = useCallback(async (next: AgentCliKind): Promise<boolean> => {
    const previous = kindRef.current
    kindRef.current = next
    setKind(next)
    setSaveError(null)
    try {
      await settingsApi.setAgentCliKind(next)
      // 選び直して保存できたので、既定に戻した旨は消す
      setFallback(null)
      return true
    } catch (err) {
      kindRef.current = previous
      setKind(previous)
      setSaveError(`${AGENT_CLI_KIND_SAVE_ERROR_PREFIX}${toError(err).message}`)
      return false
    }
  }, [])

  return { kind, fallback, saveError, changeKind }
}
```

`src/renderer/src/lib/agentSessionMessages.ts` の `AGENT_START_DISABLED_SWITCHING_MODE` の次と、`AGENT_STOP_ON_MODE_CHANGE_CONFIRM` の次に足す:

```ts
/** 使う CLI の切り替えの途中(エージェントの停止を待つ間)に、起動・+・前回の続きからを押せない理由 */
export const AGENT_START_DISABLED_SWITCHING_CLI_KIND = '使うエージェント CLI を切り替えています'
```

```ts
/** 使う CLI の切り替えの前の確認(動いているタブをすべて止めてから保存する) */
export const AGENT_STOP_ON_CLI_KIND_CHANGE_CONFIRM =
  '使う CLI を切り替えると、動いているエージェントをすべて終了します。切り替えますか？'
```

`src/renderer/src/types.ts`: 先頭の `import type { … } from '@shared/types'` に `AgentCliKindSetting` を足し、`import type { AgentCliKind } from '@shared/agentCliKinds'` を足す。`AgentNotificationPanelState` を次に置き換え、`AgentSendConfirmPanelState` の次に `AgentCliKindPanelState` を足す:

```ts
// エージェントの通知の設定(useAgentWorkspace が組み立て、Sidebar → SettingsPanel へ渡す)
export interface AgentNotificationPanelState extends BooleanSettingPanelState {
  /** 選んだ CLI が完了・許可待ちの通知を出せない(画面を判定しない)ときの注記。出せるなら null(省略できない。L-060) */
  unsupportedNote: string | null
}
```

```ts
// 使うエージェント CLI の設定(useAgentWorkspace が組み立て、Sidebar → SettingsPanel → AgentCliKindSection へ渡す)
export interface AgentCliKindPanelState {
  /** 読み込み中は null(選べない) */
  kind: AgentCliKind | null
  /** main が既定に戻した理由(注記に出す)。戻していなければ null */
  fallback: AgentCliKindSetting['fallback']
  saveError: string | null
  /** 読み込み中・どれかのタブが起動中・実行方式か CLI の切り替えの途中は選べない */
  isLocked: boolean
  /** 選べない理由(起動中だけ)。表示し、選択肢から参照する。出さないときは null */
  lockedReason: string | null
  /** 選ぶ(動いているタブがあれば確認してから止め、保存する) */
  onSelect: (kind: AgentCliKind) => void
}
```

- [ ] **Step 6: 設定の画面を実装する**

`src/renderer/src/components/settings/AgentCliKindSection.tsx` を作る:

```tsx
'use client'
import { useId } from 'react'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import type { AgentCliKindPanelState } from '../../types'
import {
  AGENT_CLI_KIND_SECTION_NOTE,
  AGENT_CLI_KIND_SECTION_TITLE,
  agentCliFallbackNote,
  agentCliKindOptionLabel,
  agentCliUnsupportedFeaturesNote
} from '../../lib/agentCliMessages'

// 設定パネルの「使うエージェント CLI」(設計書 2026-10-20「設定」の「画面」)。ExecutionModeSection と同じ作りで、選ぶとすぐ保存する
// (見た目も同じ class)。選択肢は能力の表から作り、選んだ CLI で使えない機能を並べる。選べない間は disabled(押した後に状態が変わって
// フォーカスを失う操作ではないため。押した処理の側でも同じ条件で止める。L-058)
export default function AgentCliKindSection({
  kind,
  fallback,
  saveError,
  isLocked,
  lockedReason,
  onSelect
}: AgentCliKindPanelState): React.JSX.Element {
  const labelId = useId()
  const reasonId = useId()
  const unsupportedNote = kind === null ? null : agentCliUnsupportedFeaturesNote(kind)
  const fallbackNote = agentCliFallbackNote(fallback)
  return (
    <div className="settings-panel__section">
      <p className="settings-panel__label" id={labelId}>
        {AGENT_CLI_KIND_SECTION_TITLE}
      </p>
      <p className="settings-panel__note">{AGENT_CLI_KIND_SECTION_NOTE}</p>
      <div role="radiogroup" aria-labelledby={labelId} className="execution-mode-section__options">
        {AGENT_CLI_KINDS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={kind === option}
            // 読み込み前に選ぶと、保存の失敗・後から届く読み込みでの上書きになるため、kind が null の間も選べなくする
            disabled={isLocked || kind === null}
            aria-describedby={lockedReason !== null ? reasonId : undefined}
            className={`execution-mode-section__option${kind === option ? ' execution-mode-section__option--selected' : ''}`}
            onClick={() => {
              if (kind !== option) onSelect(option)
            }}
          >
            {agentCliKindOptionLabel(option)}
          </button>
        ))}
      </div>
      {unsupportedNote !== null && <p className="settings-panel__note">{unsupportedNote}</p>}
      {fallbackNote !== null && <p className="settings-panel__status">{fallbackNote}</p>}
      {lockedReason !== null && (
        <p className="settings-panel__status" id={reasonId}>
          {lockedReason}
        </p>
      )}
      {kind === null && <p className="settings-panel__status">読み込み中...</p>}
      {saveError !== null && (
        <p className="settings-panel__error" role="alert">
          {saveError}
        </p>
      )}
    </div>
  )
}
```

`src/renderer/src/components/settings/BooleanSettingSection.tsx`: `Props` の `note` の次に足し、分割代入に `extraNote = null` を足して、説明（`p.settings-panel__note` の `id={noteId}`）の次に出す:

```tsx
  /** 説明の後ろに添える注記(選んだ CLI で使えない旨など)。無ければ出さない */
  extraNote?: string | null
```

<!-- prettier-ignore -->
```tsx
      {extraNote !== null && <p className="settings-panel__note">{extraNote}</p>}
```

`src/renderer/src/components/settings/AgentNotificationSection.tsx` を次にする:

```tsx
'use client'
import type { AgentNotificationPanelState } from '../../types'
import BooleanSettingSection from './BooleanSettingSection'

// 設定パネルの「エージェントの通知」(設計書「設定」)。表示と状態の出し分けは BooleanSettingSection が持ち、ここは文言だけ。
// 選んだ CLI が画面を判定しない(copilot)ときは、通知を出さない旨の注記を添える(設計書 2026-10-20「入口ごとの表」)
export default function AgentNotificationSection({
  unsupportedNote,
  ...props
}: AgentNotificationPanelState): React.JSX.Element {
  return (
    <BooleanSettingSection
      title="エージェントの通知"
      optionLabel="ウィンドウが背面のとき、許可待ち・確認待ち・作業の完了を通知する"
      note="Dock のバッジ（macOS）・タスクバーの点滅（Windows・Linux）も、この設定でまとめてオン・オフします。通知が出ないときは、OS の通知の設定も確かめてください"
      extraNote={unsupportedNote}
      {...props}
    />
  )
}
```

`src/renderer/src/components/settings/ExecutionModeSection.tsx` の `agent-cli` の選択肢の `label` を `'エージェント CLI（アプリ内のターミナルでエージェント CLI を動かす）'` にする。

`src/renderer/src/components/settings/SettingsPanel.tsx`: 型の import に `AgentCliKindPanelState` を、`import AgentCliKindSection from './AgentCliKindSection'` を足し、`Props` の `agentNotification` の前に `agentCliKind: AgentCliKindPanelState`（JSDoc「使うエージェント CLI の設定(省略できない。配線の漏れを型で検出する。L-060)」）を足し、分割代入に足して、`ExecutionModeSection` の直後（`agentNotification` の節の前）に足す:

<!-- prettier-ignore -->
```tsx
      <AgentCliKindSection {...agentCliKind} />
```

同じファイルの `AgentNotificationSection` の呼び出しに `unsupportedNote={agentNotification.unsupportedNote}` を足す。

`src/renderer/src/components/Sidebar.tsx`: 型の import に `AgentCliKindPanelState` を足し、`Props` の `agentSendConfirm` の次に `agentCliKind: AgentCliKindPanelState`（JSDoc「使うエージェント CLI の設定(省略できない。L-060)」）を足し、分割代入に足して、`SettingsPanel` に `agentCliKind={agentCliKind}` を渡す。

`src/renderer/src/hooks/useAppState.ts` の戻り値の `agentSendConfirmPanel: agentWorkspace.agentSendConfirmPanel,` の次に `agentCliKindPanel: agentWorkspace.agentCliKindPanel,` を足す（戻り値の型を明示している interface があれば、そこにも `agentCliKindPanel: AgentCliKindPanelState` を足す）。

`src/renderer/src/App.tsx` の `useAppState()` の分割代入の `agentSendConfirmPanel,` の次に `agentCliKindPanel,` を足し、`Sidebar` の `agentSendConfirm={agentSendConfirmPanel}` の次に `agentCliKind={agentCliKindPanel}` を足す。

`src/renderer/src/__tests__/makeAgentWorkspaceState.ts`: `agentNotificationPanel` に `unsupportedNote: null,` を足し、`agentSendConfirmPanel` の次に足す:

```ts
    agentCliKindPanel: {
      kind: 'claude',
      fallback: null,
      saveError: null,
      isLocked: false,
      lockedReason: null,
      onSelect: vi.fn<AgentWorkspaceState['agentCliKindPanel']['onSelect']>()
    },
```

- [ ] **Step 7: `useAgentWorkspace` の設定の保持と切り替えを実装する**

`src/renderer/src/hooks/useAgentWorkspace.ts`:

1. import に `import { useAgentCliKind } from './useAgentCliKind'`・`AgentCliKindPanelState`（`../types` の型の import）・`import { AGENT_CLI_KIND_LOCKED_WHILE_STARTING, agentNotificationUnsupportedNote } from '../lib/agentCliMessages'` を足し、`agentSessionMessages` の import に `AGENT_START_DISABLED_SWITCHING_CLI_KIND`・`AGENT_STOP_ON_CLI_KIND_CHANGE_CONFIRM` を足す
2. 関数の外（`AgentTerminalPanelState` の前）に足す:

```ts
/** 切り替えの途中(エージェントの停止を待つ間)の種類。実行方式と使う CLI の切り替えを 1 つの値で持ち、片方の途中はもう片方も始めない */
type WorkspaceSwitching = 'mode' | 'cli-kind' | null

/** 切り替えの途中に、起動・+・前回の続きからを受け付けない理由 */
function startBlockedReasonOf(switching: WorkspaceSwitching): string | null {
  switch (switching) {
    case 'mode':
      return AGENT_START_DISABLED_SWITCHING_MODE
    case 'cli-kind':
      return AGENT_START_DISABLED_SWITCHING_CLI_KIND
    case null:
      return null
  }
}
```

3. `AgentWorkspaceState` の `agentSendConfirmPanel` の次に足す:

```ts
/** 設定パネルの使うエージェント CLI の項目。kind は読み込み中は null。isLocked は読み込み中・エージェントの起動中・切り替えの途中。
 *  onSelect は動いているタブがあれば確認してから止め、保存する */
agentCliKindPanel: AgentCliKindPanelState
```

4. Task 4 の一時の行（`// 段階 1 の途中(renderer): …` とその次の `const appCliKind: AgentCliKind = DEFAULT_AGENT_CLI_KIND`）を次に置き換える（`useExecutionMode()` の呼び出しの次に置く）:

```ts
const agentCliKind = useAgentCliKind()
// 起動・タブの名前・再開の入口が使う設定の種類。読み込み中は既定(claude)で出す(読み込みの前の一瞬は claude 1 と出る。既知の制約)
const appCliKind: AgentCliKind = agentCliKind.kind ?? DEFAULT_AGENT_CLI_KIND
```

5. `switchingModeRef`・`isSwitchingMode` を次に置き換え、コメントの「切り替えの途中」に「実行方式か使う CLI の」を足す:

```ts
const switchingRef = useRef(false)
const [switching, setSwitching] = useState<WorkspaceSwitching>(null)
```

`useAgentSessions` の `startBlockedReason` を `startBlockedReasonOf(switching)` にする（コメントに「使う CLI の切り替えでも、止める対象に入らないタブが残ると種類が混ざる」を足す）

6. `selectExecutionMode` の `switchingModeRef` を `switchingRef` に、`setIsSwitchingMode(true)` を `setSwitching('mode')` に、`setIsSwitchingMode(false)` を `setSwitching(null)` にする
7. `selectExecutionMode` の次に足す（設計書「切り替え」のコード）:

```ts
// 使う CLI の切り替え(設計書 2026-10-20「切り替え」)。アプリ全体で 1 つの種類という前提を保つため、動いているタブがあれば確認して
// すべて止めてから保存する(止めずに保存すると、動いている claude のタブと次に起動する copilot のタブが混ざる)。止められなかった
// タブがあれば保存しない(L-001)。従来の方式の間も選べる(動いているタブが無いので確認は出ない)。保存した値は次の起動から使われる
const selectAgentCliKind = async (next: AgentCliKind): Promise<void> => {
  // 実行方式の切り替えと共有の ref(どちらかの途中はもう一方も始めない)
  if (switchingRef.current) return
  if (next === agentCliKind.kind || agentCliKind.kind === null || isAnyAgentStarting) return
  switchingRef.current = true
  setSwitching('cli-kind')
  try {
    if (isAnyAgentSessionActive) {
      if (!onConfirm(AGENT_STOP_ON_CLI_KIND_CHANGE_CONFIRM)) return
      if (!(await agentSessions.stopAll())) return
    }
    await agentCliKind.changeKind(next)
  } finally {
    switchingRef.current = false
    setSwitching(null)
  }
}
```

8. 戻り値の `executionModePanel.isLocked` の `isSwitchingMode` を `switching !== null` にし、`agentNotificationPanel` に `unsupportedNote: agentNotificationUnsupportedNote(appCliKind),` を足し、`agentSendConfirmPanel` の次に足す:

```ts
    agentCliKindPanel: {
      kind: agentCliKind.kind,
      fallback: agentCliKind.fallback,
      saveError: agentCliKind.saveError,
      isLocked: agentCliKind.kind === null || isAnyAgentStarting || switching !== null,
      lockedReason: isAnyAgentStarting ? AGENT_CLI_KIND_LOCKED_WHILE_STARTING : null,
      // 選択肢のクリックは完了を待たない。changeKind は失敗を false で返し、stopAll は reject しないので本来は投げないが、
      // 投げたら記録して握る(ロックは finally で戻している)
      onSelect: (kind) => {
        selectAgentCliKind(kind).catch((err: unknown) => {
          console.error('[useAgentWorkspace] selectAgentCliKind failed:', err)
        })
      }
    },
```

9. 冒頭のコメントの「実行方式の切り替えの手順」を「実行方式と使う CLI の切り替えの手順」にする

- [ ] **Step 8: テストが通ることを確かめる**

Run: Step 4 と同じコマンドに `src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/components/__tests__/App.agentSendConfirm.test.tsx src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx` を足して流す
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `grep -rn "段階 1 の途中" src`
Expected: 何も出ない

- [ ] **Step 9: 変異で確かめる（配線。L-060）**

1つずつ戻して、該当のテストが落ちることを確かめ、そのつど元に戻す:

1. `useAgentWorkspace` の `useAgentSessions` に渡す `appCliKind` を `DEFAULT_AGENT_CLI_KIND` にする → `設定が copilot なら、未起動のタブの名前は copilot で…`（名前）・`設定の種類を useAgentSessions(appCliKind)…` が落ちる
2. `useAgentSessions` の `tabViews` の `fields.cliKind ?? appCliKind` を `appCliKind` にする → `起動の結果が copilot なら、設定が claude のままでも…` が落ちる
3. `useAgentWorkspace` の `buildPromptRunPanelState` に渡す `cliKind` を `'claude'` にする → 配線の 1 つ目・2 つ目が落ちる
4. `useAgentWorkspace` の `useAgentResume` に渡す `appCliKind` を `'claude'` にする → 配線の 1 つ目（前回の続きから・このセッションで再開）が落ちる
5. `toAgentInterruptAvailabilityInput` の `cliKind: selected.cliKind` を `'claude'` にする → 配線の 1 つ目（中断）が落ちる
6. 戻り値の `agentTerminal` の `appCliKind` を `DEFAULT_AGENT_CLI_KIND` にする → `設定の種類を useAgentSessions(appCliKind)・ターミナルのパネル…`・`App: …設定に使うエージェント CLI を出して…起動 の名前も…` が落ちる
7. `selectAgentCliKind` の `if (!(await agentSessions.stopAll())) return` を `await agentSessions.stopAll()` にする → `止められなかったタブがあれば保存しない` が落ちる
8. `startBlockedReasonOf` の `'cli-kind'` の戻り値を `AGENT_START_DISABLED_SWITCHING_MODE` にする → `切り替えの途中は起動の理由を出し…` が落ちる
9. `SettingsPanel` の `<AgentCliKindSection {...agentCliKind} />` を消す → `プロンプトの実行方式の直後に使うエージェント CLI を出し…`（節の見出し `p.settings-panel__label` が 5 つになる）と App のテストが落ちる（`Sidebar` の `agentCliKind={agentCliKind}` を消すと `npm run typecheck` が落ちる〈必須の props〉ことも確かめる）
10. `git diff` で戻したことを確かめる

- [ ] **Step 10: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/renderer/src/hooks/useAgentCliKind.ts src/renderer/src/components/settings/AgentCliKindSection.tsx src/renderer/src/types.ts src/renderer/src/lib/agentSessionMessages.ts src/renderer/src/components/settings/SettingsPanel.tsx src/renderer/src/components/settings/AgentNotificationSection.tsx src/renderer/src/components/settings/BooleanSettingSection.tsx src/renderer/src/components/settings/ExecutionModeSection.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx src/renderer/src/hooks/useAppState.ts src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/__tests__/makeAgentWorkspaceState.ts src/renderer/src/hooks/__tests__/useAgentCliKind.test.ts src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx src/renderer/src/components/settings/__tests__/SettingsPanel.test.tsx src/renderer/src/components/settings/__tests__/AgentNotificationSection.test.tsx src/renderer/src/components/settings/__tests__/ExecutionModeSection.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/App.agentCli.test.tsx src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check <同じファイル>`
Expected: すべて整形済み

---

### Task 7: ROADMAP の更新・既知の制約・テスト仕様書と全体の検証（テスト仕様書への追記と Artifact の再公開）

> **設計書の読む節:** 「ROADMAP の更新の方針」、「既知の制約」、「実機テスト仕様書の新しい項目の下書き」、「実装の分割」の 7、「main に入れた時点で利用者から見える挙動」。CLAUDE.md の実機テスト仕様書の規則（書式・ID を変えない・接頭辞ごとの連番）と `scripts/build-manual-test-spec.mjs`。
>
> **気をつける知見:** L-072（実機の項目にファイルを書き換える指示を含めない。`copilot` の実行ファイルの名前の変更や `settings.json` の手書きをさせない。プロセスは `pgrep` で見るだけで止めない。設定を変えた領域は最後の項目で `claude` に戻す。アカウントの操作は利用者が自分で行う）・L-466（別のウィンドウの古い値を既知の制約に書く）

**Files:**

- Modify: `docs/manual-test-spec.md`（`### 使うエージェント CLI の切り替え（copilot）` と AGT-228〜240、BASE-007 の期待結果。**ほかの既存の項目の ID と文言は変えない**）
- Modify: `ROADMAP.md`（**prettier にかけない**）
- Modify（食い違いがあれば）: `docs/superpowers/specs/2026-10-20-agent-cli-kind-foundation-design.md`（「既知の制約」の照合と、プランの冒頭の「計画の時点で設計書から調整した細部」の反映）
- 生成（git 管理外）: `.superpowers/manual-test-spec.html`

**Interfaces:**

- Consumes: Task 1〜6 の実装（文言は Global Constraints の「文言」と一字一句同じ。正は `src/renderer/src/lib/agentCliMessages.ts`・`agentSessionMessages.ts`）
- Produces: 実機テスト仕様書の AGT-228〜AGT-240 と BASE-007 の修正（コントローラーが Artifact を再公開する）

- [ ] **Step 1: 設計書の「既知の制約」を実装と照らし合わせ、調整した細部を設計書に反映する**

`sed -n '/^## 既知の制約/,/^## 次の段階の見通し/p' docs/superpowers/specs/2026-10-20-agent-cli-kind-foundation-design.md` で読み、次を確かめる。食い違いがあれば設計書の行を実装に合わせて直す（無ければ変えない）:

1. `copilot` で使えない入口（実行・再実行・送信前の確認・作業中や入力待ちの表示・通知・中断・自動の取り直し・区別・前回の続きから・このセッションで再開）が、Task 4〜6 の実装と一致する
2. `copilot` の帯・タブ・ステータスバーが `実行中`（`describeAgentActivity('unknown')`）になる（`useAgentActivity` が購読しない）
3. 別のウィンドウの古い値（設定の画面・`起動` の名前・前回の続きからの理由は `useAgentWorkspace` の state、タブの名前と能力は起動の結果の種類）
4. 読み込み前の名前（`agentCliKind.kind ?? DEFAULT_AGENT_CLI_KIND`）
5. `COPILOT_ALLOW_ALL` を取り除き、`COPILOT_GITHUB_TOKEN`・`GH_TOKEN`・`GITHUB_TOKEN` を残す（`AGENT_CLI_LAUNCH_SPECS.copilot.extraRemovedEnvKeys`）
6. 中断の IPC を main で拒否していない（`git diff --stat src/main/handlers/agentTerminalHandlers.ts` の差分が状態の取得の名前の変更だけで、`agentTerminal:interrupt` の受け口が変わっていない）
7. 設計書のほかの節の語を、プランの冒頭の「計画の時点で設計書から調整した細部」に合わせて直す（「決めたこと（利用者の確認済み）」「決めたこと（推奨案で決めた事項）」の表の文言は変えない）:
   - 「構成」の表に `src/main/agentSessionSnapshot.ts`（`attachSessionInfo`）・`src/main/ipcHandlers.ts`（`sessionInfoOf`）・`src/main/agentRuntime.ts` のテスト・`src/renderer/src/components/settings/BooleanSettingSection.tsx`（`extraNote`）・`src/renderer/src/components/Sidebar.tsx`・`App.tsx`・`hooks/useAppState.ts`（`agentCliKindPanel` の受け渡し）の行を足す
   - 「起動の手順」6 の `claudeSessionIdOf は sessionInfoOf に名前を変える（呼び出し元は agentTerminalHandlers.ts だけ）` を、`ipcHandlers.ts` も呼び出し元である旨にする
   - 「設定」の「保存と読み込み（main）」に、`read-failed` の固定のログの文言（`[agentCliKind] 設定ファイルを読めないため claude を使います`）と `log` の既定（`console.warn`）を足す。「画面（renderer）」に、保存に成功したら `fallback` を `null` に戻す旨を足す
   - 「入口ごとの表」の後の段落の `unsupportedCliMessage(commandName)`・`failureMessage(reason, commandName)` を、実装の名前（`agentPromptSendUnsupportedReason`・`agentSendFailureMessage`）にする
   - 「文言」の `起動` の `aria-label` の「（設定の種類）」に、`AgentTerminalPanelState.appCliKind` で渡す旨を足す

- [ ] **Step 2: 実機テスト仕様書の文言を実装と照らし合わせる（L-354）**

Run:

```bash
cd <repo-root>
R=src/renderer/src/lib
test -d "$R" || echo "missing $R"
for s in '使うエージェント CLI' 'エージェント CLI 方式で使います。切り替えると、次の起動から使われます' '使う CLI を切り替えると、動いているエージェントをすべて終了します。切り替えますか？' '使うエージェント CLI を切り替えています' 'では次の機能を使えません（ターミナルで直接操作します）: ' 'では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）' 'へのプロンプトの送信には、まだ対応していません（ターミナルに直接入力してください）' 'では中断のボタンを使えません（ターミナルで操作してください）' 'では「前回の続きから」を使えません（設定で ' 'では「このセッションで再開」を使えません（設定で ' '使っているエージェント CLI が区別に対応していません（claude だけが対応しています）' '起動（開いているフォルダで '; do
  grep -rqF "$s" "$R" && echo "OK $s" || echo "NG $s"
done
grep -nF "エージェント CLI（アプリ内のターミナルでエージェント CLI を動かす）" src/renderer/src/components/settings/ExecutionModeSection.tsx
grep -nF "displayName: 'GitHub Copilot CLI'" src/shared/agentCliKinds.ts
```

Expected: `missing` が出ず、すべて `OK`。最後の 2 つの `grep` がそれぞれ 1 行出す。`NG` が出たら、Step 3 で足す項目の文言をコードの文字列に合わせて直す（コードは変えない）

- [ ] **Step 3: 実機テスト仕様書に新しい節と項目を足し、BASE-007 を直す**

`docs/manual-test-spec.md`:

1. 「## エージェント CLI のアプリ内ターミナル」の最後の節 `### 実行の中断` の最後の項目（今の最大の **AGT-227** の行）の直後、`## エージェントの変更の確認` の前に、空行を 1 つ置いて次をそのまま足す（1 行 1 項目。新しい項目は AGT-228 から振る。既存の項目は変えない）:

```text
### 使うエージェント CLI の切り替え（copilot）

> 前提: エージェント CLI 方式で、テスト用のフォルダを開いている。GitHub Copilot CLI（`copilot`）がインストール済みで、端末で `copilot --version` が動く。
> 前提: フォルダの信頼の確認が出たら、「このセッションだけ信頼する」選択肢を選び、「今後も覚える」選択肢は選ばない（覚えさせると、テスト用のフォルダが利用者の `~/.copilot` の設定の `trustedFolders` に残る。覚えさせてしまったら、`copilot` の中で `/` のコマンドから信頼のフォルダの一覧を開いて外すか、`~/.copilot` の設定の `trustedFolders` からそのフォルダを手で消す）。
> 前提: `copilot` のログイン・プランの選択など GitHub のアカウントに関わる操作は、利用者が自分のアカウントで、`copilot` の画面の案内に従って行う（アプリは判定も代行もしない）。この節の項目では、`copilot` に送る内容を返答だけで済むもの（例: `こんにちは`）にする。

- [ ] **AGT-228** 設定を開いて `プロンプトの実行方式` の下を見る → `使うエージェント CLI` の見出しと `エージェント CLI 方式で使います。切り替えると、次の起動から使われます` の説明、`Claude Code（claude）`・`GitHub Copilot CLI（copilot）` の 2 つの選択肢があり、`Claude Code（claude）` が選ばれている（初めて使う環境の既定）
- [ ] **AGT-229** `claude 1` を起動して入力待ちにしてから、設定で `GitHub Copilot CLI（copilot）` を選び、出た確認で `キャンセル` を押す → 確認に `使う CLI を切り替えると、動いているエージェントをすべて終了します。切り替えますか？` が出る。キャンセルすると選択は `Claude Code（claude）` のままで、`claude 1` は動き続ける
- [ ] **AGT-230** もう一度 `GitHub Copilot CLI（copilot）` を選び、確認で `OK` を押す → `claude 1` が終了し（帯が `終了しました…`。タブの名前は `claude 1` のまま）、選択が `GitHub Copilot CLI（copilot）` に変わる。選択肢の下に `copilot では次の機能を使えません（ターミナルで直接操作します）:` に続けて使えない機能の一覧が出る。`エージェントの通知` の項目に `copilot では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）` が出る
- [ ] **AGT-231** 帯の `起動` にマウスを載せてから押す（VoiceOver を使う場合は `起動` の名前も聞く） → 名前が `起動（開いているフォルダで copilot を起動）`。押すとタブの名前が `copilot 1` になり、ターミナルに `copilot` の画面が出る（初回はフォルダの信頼の確認・ログインの案内などが出うる。前提のとおり利用者が答え、フォルダの信頼は「このセッションだけ」を選ぶ）。帯は `実行中` になる
- [ ] **AGT-232** `copilot` が入力を受け付ける状態で、ターミナルの中をクリックして `こんにちは` と入力して `Enter` を押し、応答が終わるまで帯とステータスバーを見る → `copilot` が応答する。帯とステータスバーは応答の間も後も `実行中` のままで、`作業中`・`入力待ち` に変わらない。応答が終わっても完了の通知（読み上げ・OS の通知）は出ない
- [ ] **AGT-233** 「プロンプト」パネルで登録したプロンプトの `実行` を見る → `実行` は押せず、`copilot へのプロンプトの送信には、まだ対応していません（ターミナルに直接入力してください）` が出る。`copilot` の入力欄には何も入らない
- [ ] **AGT-234** `copilot 1` が動いている間に、帯の `中断` にマウスを載せてから押す → `中断` は薄い色で、`copilot では中断のボタンを使えません（ターミナルで操作してください）` が出る。押しても `copilot` の画面は変わらない
- [ ] **AGT-235** `終了` で `copilot 1` を止めて帯を見る。`前回の続きから` にマウスを載せる → `前回の続きから` は押せず、`copilot では「前回の続きから」を使えません（設定で claude に戻すと使えます）` が出る
- [ ] **AGT-236** 実行の履歴に、`claude` で送って作ったエントリがあれば（この節の前の既存の項目で `claude` に送った履歴が残っていればそれでよい。この節の項目では `claude` に送らない）開いて `このセッションで再開` と `再実行` を見る（無ければそのことを記録して次へ進む） → `このセッションで再開` は押せず `copilot では「このセッションで再開」を使えません（設定で claude に戻すと使えます）` が出る。`再実行` は押せず、AGT-233 と同じ理由が出る
- [ ] **AGT-237** テスト用のフォルダが Git リポジトリで `変更を確認` の記録を始められるなら、`起動` で `copilot 1` を起動し、`変更を確認` → `いまから記録する` で記録を始めて区別の状態の 1 行を見る（Git リポジトリでなければ、そのことを記録して次へ進む） → 区別できない旨と `使っているエージェント CLI が区別に対応していません（claude だけが対応しています）` が出る。記録の一覧は今までどおり開ける。確かめた後、`確認を終える` で記録を終える
- [ ] **AGT-238** `copilot 1` を起動して入力待ちにしてから `終了` を押し、別の端末で `pgrep -fl '@github/copilot'` を実行する（`npm-loader.js` とネイティブの `copilot-darwin-arm64` の実行ファイルのパスに共通する文字列。VS Code の GitHub Copilot の拡張など無関係なプロセスに当たらない。何も止めない。見るだけ） → 帯が `終了しました…` になる。アプリの外で `copilot` を使っていなければ、`pgrep` は何も出さない（`npm-loader.js` とネイティブの `copilot` の子が残らない）。外で使っていて何か出たときは、出力を記録して次へ進む
- [ ] **AGT-239** `copilot 1` を起動したまま、`+` で 2 つ目のタブを足して起動する → 2 つ目のタブの名前は `copilot 2` で、`copilot` が起動する。2 つのタブとも帯は `実行中`。確かめた後、`copilot 2` のタブを `×` で閉じる
- [ ] **AGT-240** `copilot 1` が動いている状態で、設定で `Claude Code（claude）` を選び、確認で `OK` を押してから `起動` を押す → `copilot 1` が終了し、選択が `Claude Code（claude）` に戻り、使えない機能の注記と通知の項目の注記が消える。起動するとタブの名前が `claude 1` になり、入力待ちになると帯が `入力待ち` に変わり、プロンプトの `実行` が押せる（今までどおり）。この項目で設定は元に戻る
```

2. **BASE-007** の行の `→` より後ろ（期待結果）を次にする（手順と ID は変えない）:

```text
サイドバーの見出しが `設定` に変わり `プロンプトの実行方式`・`使うエージェント CLI`・`エージェントの通知`・`送信前の確認`・`Anthropic API キー`・`モデル` の 6 つのセクションが表示される
```

3. `grep -cE '^- \[ \] \*\*AGT-(22[89]|23[0-9]|240)\*\*' docs/manual-test-spec.md` が `13` であること、`grep -n 'BASE-007' docs/manual-test-spec.md` の行に `使うエージェント CLI` と `6 つのセクション` が含まれること、`git diff docs/manual-test-spec.md | grep '^-' | grep -v '^---'` が BASE-007 の古い行だけであること（ほかの既存の項目を変えていない）を確かめる

- [ ] **Step 4: HTML を再生成し、仕様書の検査を通す**

Run: `node scripts/build-manual-test-spec.mjs`
Expected: `.superpowers/manual-test-spec.html (N 領域 / M 項目)` が出る（項目の数が足す前より 13 増えている）
Run: `npx vitest run scripts`
Expected: PASS（ID の一意性・接頭辞ごとの連番の昇順〈欠番は許容〉・書式）
Run: `npx prettier --check docs/manual-test-spec.md`
Expected: 整形済み

Artifact（<manual-test-spec-artifact-url>）の再公開は、このタスクの実装者ではなく**コントローラーが** `.superpowers/manual-test-spec.html` を同じファイルパスで公開して行う（実装者は HTML の生成までで止め、報告に「再公開が必要」と書く）。

- [ ] **Step 5: ROADMAP を更新する（prettier にかけない）**

`<実装の日>` は `date +%Y-%m-%d` の出力に置き換える（設計書の `<main に入れた日付>` は、main に入れるのが後の工程のため、実装の日で書き、PR の工程で直す）。行番号は計画の時点のもの（`grep -n` で該当の文を探してから直す）。

1. 「エージェント実行の支援（MVP の次）」の `- [ ] \`claude\` 以外のエージェント CLI への対応（起動コマンドの設定。入力欄の挙動が CLI ごとに違う点の吸収）`（:559）は**未完了のまま**にし、その直下に次の 2 行を足す（字下げは上の `- [x] 実行のキャンセル / 中断の UI` の下の行と同じ 6 つの空白）:

```text
      - 実装済み（<実装の日>。段階 1。設計書 `docs/superpowers/specs/2026-10-20-agent-cli-kind-foundation-design.md`）: 使う CLI の設定（Claude Code / GitHub Copilot CLI。アプリ全体で 1 つ。既定は claude）と、選んだ CLI の起動。copilot はターミナルで直接操作する。実装済み機能の「使うエージェント CLI の切り替え（段階 1）」を参照
      - 残り: copilot へのプロンプトの送信と画面の判定（作業中などの表示・通知・中断・自動の取り直し）＝段階 2、copilot の hooks による変更の区別・セッションの再開・起動の記録と履歴への CLI の種類の記録＝段階 3
```

2. 実装済み機能の `### エージェントの実行の中断` の節の末尾（その節の既知の制約の最後の行の後、`---` の前）に、空行を置いて次を足す:

```text
### 使うエージェント CLI の切り替え（段階 1）

設計書: `docs/superpowers/specs/2026-10-20-agent-cli-kind-foundation-design.md`（2026-10-20）。

- [x] 設定の `使うエージェント CLI` で、エージェント CLI 方式で使う CLI を `Claude Code（claude）`（既定）と `GitHub Copilot CLI（copilot）` から選ぶ（アプリ全体で 1 つ。`settings.json` の `agentCliKind` に保存。保存されていた値を読めなければ claude を使い、設定の画面に出す）
- [x] 切り替えると、動いているエージェントがあれば確認してすべて終了してから保存する（止められなかったら保存しない）。切り替えの途中は `起動`・`+`・`前回の続きから` を押せない。保存した値は次の起動から使われる（main が起動のたびに設定を読む）
- [x] 起動は main の種類ごとの表で決める（コマンド名・引数・取り除く環境変数。renderer からは種類を送らない）。`copilot` は引数なしで起動し、`COPILOT_ALLOW_ALL` を取り除く（`COPILOT_GITHUB_TOKEN`・`GH_TOKEN`・`GITHUB_TOKEN` は残す）。タブの名前は `copilot 1` のように CLI のコマンド名になる
- [x] `copilot` では、プロンプトの送信（実行・再実行・送信前の確認）・中断・前回の続きから・このセッションで再開は押せず、入口ごとに理由を出す（処理の側でも同じ判定で止め、再開は main も断る）。画面の判定（作業中・入力待ちの表示・完了と許可待ちの通知・変更の一覧の自動の取り直し）はしない。変更の確認の区別は `使っているエージェント CLI が区別に対応していません（claude だけが対応しています）` になる。設定の画面に使えない機能の一覧を出す

既知の制約（設計書の「既知の制約」と同じ）:

- `copilot` では、プロンプトの送信（実行・再実行・送信前の確認）・作業中や入力待ちの表示・完了と許可待ちの通知・中断のボタン・変更の一覧の自動の取り直し・利用者の変更との区別・前回の続きから・このセッションで再開を使えない（段階 2・3）。ターミナルで直接操作する
- `copilot` の帯・タブ・ステータスバーは、動いている間ずっと `実行中` と出る（作業中か入力待ちかを判定しない）
- 使う CLI はアプリ全体で 1 つ。切り替えると動いているタブをすべて終了する（会話を失う。`claude` の会話は前回の続きからで再開できる）
- 設定の画面と入口の判定は、ウィンドウごとに起動したときに読んだ値を使う。別のウィンドウで切り替えると、このウィンドウの設定の画面・`起動` の名前・前回の続きからの理由は古い値のまま（次に起動したタブは main が読んだ新しい値で起動し、そのタブの名前と能力は起動の結果の種類に従う）。通常の使い方ではウィンドウは 1 つ
- 設定を読み込む前の一瞬、未起動のタブの名前は既定の `claude 1` と出て、読み込むと `copilot 1` に変わることがある
- `copilot` が見つかっても、pty に渡す PATH に Node.js 24 以上の `node` が無いと、起動の直後に終わる（ターミナルの表示と「起動の直後に終了しました」で分かる）。起動の前には確かめない
- `copilot` は GUI から起動したアプリでも、ログインシェル（`$SHELL -l -i`）の PATH に入っていれば見つかる。ログインシェルの設定で nvm を遅延読み込みにしている（`nvm` を呼ぶまで PATH に入れない）と見つからない
- 親の環境の `COPILOT_ALLOW_ALL` は取り除くので、アプリの中の `copilot` では全ツールの自動の許可が効かない（`copilot` の中の `/allow-all`・`/permissions` や設定 `defaultPermissionMode` は効く）。`COPILOT_GITHUB_TOKEN`・`GH_TOKEN`・`GITHUB_TOKEN` は取り除かないので、アプリを起動した環境にあれば `copilot` の認証に使われる
- `copilot` は既定で IDE のワークスペースへ自動で接続しようとし（`ide.autoConnect`）、端末のタイトルの書き換え（OSC 0/2）と進み具合（OSC 9;4）を出す。アプリはタイトルを使わず（MVP の方針）、OSC 9;4 は xterm が表示しない
- 起動の記録（`agent-sessions.json`）と履歴は `claude` のものだけ。`copilot` のセッションは残らない
- 中断の IPC は main で CLI の種類を見ない（renderer の判定で止める。同じバイトはターミナルのキー入力でも送れるため）
```

3. 「MVP の対象外」の行（:530。`` `claude` 以外のエージェント CLI（起動コマンドの設定） `` を含む行）は MVP の時点の範囲の記録なので変えない
4. `git diff --stat ROADMAP.md` で ROADMAP の変更が上の 2 か所だけであること（prettier で整形していないこと）、`grep -n "使うエージェント CLI の切り替え（段階 1）" ROADMAP.md` が 2 行（参照と見出し）を出すことを確かめる

- [ ] **Step 6: 全体の検証**

Run: `npx vitest run`
Expected: PASS（時間切れで落ちたファイルは `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書く）
Run: `npm run typecheck`
Expected: PASS
Run: `git diff --name-only -- '*.ts' '*.tsx' && git ls-files --others --exclude-standard -- '*.ts' '*.tsx'` で、このプランで変更・作成した TypeScript のファイルを列挙し、`npx eslint --max-warnings 0 <列挙したファイル>` と `npx prettier --check <列挙したファイル>`
Expected: エラー・警告なし・すべて整形済み
Run: `npx vitest run scripts`
Expected: PASS
Run: `grep -rn "段階 1 の途中\|AGENT_COMMAND_NAME\|buildAgentLaunchArgs\|claudeSessionIdOf\|attachClaudeSessionIds" src`
Expected: 何も出ない
Run: `pgrep -fl amt-test- || true`
Expected: 何も出ない（統合テストの子が残っていない）
Run: `git status --short`
Expected: このプランで変えたファイルと、設計書・プランの未追跡・変更のファイルだけが出る（`.superpowers/` は git 管理外）。報告に「Artifact の再公開が必要」と書く

---

## Self-Review（計画の作成者が設計書と照らし合わせた結果）

**1. 設計書の要件と対応するタスク:**

| 設計書の要件                                                                                                                                                            | タスク        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 型と能力の表（`AGENT_CLI_KINDS`・`isAgentCliKind`・`AgentCliCapabilities`・`AGENT_CLI_PROFILES`・`agentCliCapabilities`）・`commandName` の形のテスト（L-034）          | 1             |
| 共有の型（`resume-unsupported`・`AgentStartResult` の `cliKind` と `command-not-found` の組・`AgentSessionSnapshotEntry`・`cli-unsupported`・`AgentCliKindSetting`）    | 1             |
| 設定の保存と読み込み（キー無し・未知の値・読めない・オブジェクトでない JSON・ログの 80 文字・例外の文言を出さない・保存の拒否）・`SettingsFile.agentCliKind`・IPC・窓口 | 2             |
| 起動の表（コマンド名・引数・`COPILOT_ALLOW_ALL`・能力に合わない値と未知の `launch.kind` を投げる）・`AGENT_COMMAND_NAME` と `buildAgentLaunchArgs` の移動               | 3a            |
| 解決（`cliKind` の `commandName` を探す・計画と `not-found` に種類・`buildAgentEnv` の必須の除外）・起動のたびに設定を読む（`agentRuntime.ts`）                         | 3a            |
| 偽の実行ファイルの統合テスト（引数が空・作業ディレクトリ・`COPILOT_ALLOW_ALL` が無い・`env node` の解決・解釈系が無いと 0 以外で終わる）                                | 3a            |
| 起動の手順（再開の拒否を hooks の前に・会話の ID と予約と記録を能力で分ける・受け渡しの `cliKind`・`recordStarted` の検査・`sessionInfoOf`・状態の取得）                | 3b            |
| hooks（`cli-unsupported`・版の確認をしない・`activate` の `unconfirmed`）・前回の続きから（main は変えない）                                                            | 3b            |
| タブの種類と名前（`cliKind` を起動の結果で入れ、起動を始めると null・終了しても残す・`appCliKind`・`formatAgentTabLabel`・通知の題は `claude`）                         | 4             |
| 画面の判定を止める（購読しない・種類が変わったら記録を消す）・通知が起きないこと                                                                                        | 4             |
| 入口ごとの表: 実行・再実行・送信前の確認（`getPromptRunAvailability`・`send` の先頭の守り・`unsupported-cli`・控えた `cliKind`）                                        | 5a            |
| 入口ごとの表: 中断（`starting` の直後）・前回の続きから（起動の理由の直後）・このセッションで再開（実行方式の直後）・`起動` の `aria-label`                             | 5b            |
| 入口ごとの表: 区別（`cli-unsupported` の文言）・帯の文言（`実行中`）・自動の取り直しと hooks への知らせ（判定を止めて起きない）・`終了` などは変えない                  | 1・3b・4      |
| 設定の画面（見出し・説明・選択肢・使えない機能・既定に戻した旨・選べない間・保存の失敗）・通知の注記・実行方式の選択肢の文言                                            | 5a（文言）・6 |
| 切り替え（確認・`stopAll`・保存・共有の切り替えの値・起動の理由・実行方式の選択肢も選べない）・`agentCliKindPanel`                                                      | 6             |
| 配線のテストと受け渡しを 1 つずつ外す変異（L-060）                                                                                                                      | 6（Step 9）   |
| 記録と履歴（形を変えない・`copilot` は記録しない・予約しない）                                                                                                          | 3b            |
| 実機テスト仕様書（AGT-228〜240・BASE-007・HTML の再生成・`npx vitest run scripts`・Artifact はコントローラー）・ROADMAP の更新の方針・既知の制約の照合                  | 7             |

「入口ごとの表」（L-061）: `agentTerminal:write`・`終了`・タブの `×`・フォルダの切り替え・実行方式の切り替え・リロード・参照を添えるは変えない（変えるファイルの一覧に入れていない）。参照を添えるは送信が止まることで扱われる（5a）。

抜けは見つからなかった。

**2. 書きかけの検索:** `TBD`・`TODO`・「同じように」・説明だけのコードの Step を探した。テストの値の機械的な書き換え（`cliKind: 'claude'` の追加・`buildAgentEnv` の引数の追加・名前の変更）は、`perl` の置き換えのコマンドか、規則と場所（テスト名・行の形）を書いた。`<実装の日>` は Step の中で求め方（`date +%Y-%m-%d`）を書いた。

**3. 名前と型の一貫性:** `AgentCliKind`・`AGENT_CLI_PROFILES`・`agentCliCapabilities`・`DEFAULT_AGENT_CLI_KIND`・`AgentCliKindSetting`・`AGENT_RESUME_UNSUPPORTED`・`getAgentCliKindSetting`・`setAgentCliKind`・`getAgentCliKind`・`AGENT_CLI_LAUNCH_SPECS`・`AgentLaunchPlan.cliKind`・`AgentSessionInfo`・`sessionInfoOf`・`attachSessionInfo`・`'cli-unsupported'`・`formatAgentTabLabel(number, kind)`・`AgentSessionTabView.cliKind`・`appCliKind`・`AgentActivityTab.cliKind`・`agentCliMessages.ts` の 13 の名前・`agentSendFailureMessage`・`AgentSendTarget.cliKind`・`AgentInterruptAvailabilityInput.cliKind`・`agentStartAriaLabel`・`AgentTerminalPanelState.appCliKind`・`useAgentCliKind`・`AgentCliKindPanelState`・`agentCliKindPanel`・`AGENT_START_DISABLED_SWITCHING_CLI_KIND`・`AGENT_STOP_ON_CLI_KIND_CHANGE_CONFIRM` を、定義したタスクと使うタスクで同じ綴りにした（Global Constraints の「型・関数の名前」）。

**作成中に直した点:**

- 共有の型を Task 1 で変えると main の starter・状態の取得と renderer の網羅の `switch`・`Record` が型エラーになることに気づき、main は印付きの一時の値、renderer は型が求める 3 つの文言を Task 1 で実装する形にした（印は Task 3b・6 の検証の `grep` で消えたことを確かめる）
- `useAgentWorkspace` の `appCliKind` を Task 4〜5b で使うが、設定の hook は Task 6 で作るため、一時の定数にして Task 6 で置き換える形にした
- `claudeSessionIdOf` の呼び出し元に `ipcHandlers.ts` があることを確かめ、名前の変更に含めた
- `makeAgentSessionTabView` の名前を上書きの番号と種類から作る形にする前に、番号を上書きする既存のテストがすべて `label` も渡していることを確かめた
- `useAgentPromptSender.test.ts` の送り先の置き換えの `perl` を、写しにかけて 16 か所に入ることを確かめた。Task 1 の起動の結果・状態の取得の置き換えも写しにかけ、複数行の形にも入ることを確かめた
- 統合テストの偽の `copilot` を `writeFakeExecutable`（sh 用・warm-up あり）で書くと引数なしの 1 回の起動を確かめられないため、`writeFileSync` で書く形にした
- 「解釈系が無いと 0 以外で終わる」は、設計書のとおり存在しない名前の shebang で確かめる（既定の探索先に `node` がある環境でも落ちない）
