# claude 以外のエージェント CLI への対応 段階 3b（copilot の hooks によるエージェントの変更と利用者の変更の区別）実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定で GitHub Copilot CLI（`copilot`）を選んでいる間も、アプリが起動する `copilot` に 1 回の起動だけに効く http の hooks（`--plugin-dir`）を渡し、`claude` と同じ受け口・追跡・判定の区切りで、エージェントのツールが動いていない間の変更に `利用者の変更` の印を付ける。`copilot` の区別が `claude` より粗い点は、設定・区別の状態の 1 行・`すべて戻す` の確認で伝える。`claude` を選んでいる間の挙動・受け口の応答・設定のファイル・文言は変えない。

**Architecture:** main はタブ（枠）ごとに固定のプラグインのフォルダ（`<userData>/agent-hooks-copilot/slot-<1〜4>`）を持ち、起動のたびにトークン入りの `hooks/hooks.json`（0600）を原子的に書き直して `--plugin-dir` で渡し、環境に `COPILOT_HOOK_ALLOW_LOCALHOST=1` を足す。受け口は `copilot` 向けのパス（`/prompt-ide/agent-hooks/copilot/v1/…`）を足し、そこへの要求には照合の失敗・例外でも常に 200 の空の本文を返す。`copilot` の本文は純粋な関数で解釈し、トークンの持ち主に持たせた「主の会話の ID」で主・サブエージェントに振り分けて、ツールの呼び出しの ID を持たない区間（`ToolIdRead` の `none`）として追跡に渡す。区間の規則は会話ごとのグループで数え、バッチの区切り（`idlessEndedGroups`）と持ち越しの印（`carried`）で閉じる。renderer は区別の文言の CLI の名前を設定の種類から作り、種類ごとの精度の注記の表を足す。

**Tech Stack:** Electron（main・renderer）, React 19, TypeScript, Node の `http`・`fs/promises`, node-pty 1.1.0（偽の `copilot` の統合テスト）, Vitest 4（実ファイルの一時ディレクトリ・実際の listen・偽のタイマー・偽の pty）, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-26-agent-cli-copilot-hooks-design.md`（承認済み。実装の前に必ず読む）。このプランは設計書の「実装の分割」の 1〜8 を、そのまま Task 1〜8 に割り当てた。各タスクで読む節はタスクの冒頭に書いた。書き方の参考は `docs/superpowers/plans/2026-10-23-agent-cli-copilot-resume.md`。

**実装の前に読むもの:** `$DEV_FLOW_KIT/lessons/review-lessons.md` の「優先度 A のチェックリスト」（CLAUDE.md の「実装前の確認」）。今回の変更に関係する項目は本文も読む。実物の記録の要点は `.superpowers/agent-cli-kind/copilot-hooks-recorder/report.md`（読むだけ。書き換えない）。

**反映する知見（dev-flow-kit の `lessons/review-lessons.md`）:** 設計書の「気をつける知見」の L-001・L-002・L-004・L-010・L-014・L-016・L-017・L-018・L-019・L-023・L-034・L-044・L-052・L-053・L-059・L-060・L-061・L-072・L-079・L-082・L-203・L-354・L-403・L-435・L-437・L-591・L-606・L-609（各タスクの冒頭の「気をつける知見」に、そのタスクで効くものを書いた）

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
>
> - **`idlessEndedGroups` の説明（設計書レビュー 3 回目の推奨）:** 設計書 254 行の「前の `tool-start` の後に `tool-end` を受けたグループ」は、`prompt-submit`・`turn-end` などで外れることを含まない。コードのコメントは「バッチの区切りを待つグループ（`tool-end` で入り、次の `tool-start` で前のバッチの残りを閉じて外れる。入れる・外す時点は `applyToolIntervalEvent` の規則と、外す 5 つの時点〈`tool-start`（g）・`prompt-submit`（主）・`turn-end`（主）・`subagent-stop`（X）・`session-end`（すべて）〉）」と書く（Task 1）。Task 8 で設計書の 254 行も同じ説明に直す。
> - **グループの持ち方:** `copilot` の `tool-start`・`tool-end` は、今の `AgentHookEvent` の `agentId` の欄にグループ（`null` は主、文字列はサブエージェントの会話の ID）を入れて渡す（型を増やさない）。`subagent-stop` の `agentId` も同じ値なので、`subagent-stop`（X）で X のグループを閉じる規則がそのまま書ける。追跡のログの `agent=` は、サブエージェントのグループで `あり`、主で `なし` になる（設計書の実機の項目 AGT-280・284 の期待と同じ）。
> - **`confirm-only` の理由の追加:** 設計書の 6 つ（`subagent-prompt`・`other-session-end`・`session-id-unreadable`・`stop-while-awaiting`・`copilot-body-unreadable`）に、`subagent-stop-unmatched`（主の ID と同じ `agent_id`・主の ID を待っている間の `SubagentStop`。設計書「振り分け」の注記の `confirm-only`）を足す（設計書の「など」の範囲）。
> - **`agentHookEvents.ts` の共有:** `copilot` の解釈が `claude` と同じ本文の読み方を使えるよう、`readBody`・`isId`・`readAgentId`・`TOOL_NAME_PATTERN` を、名前を `readAgentHookBodyObject`・`isAgentHookId`・`readAgentHookAgentId`・`AGENT_HOOK_TOOL_NAME_PATTERN` にして export する（中身は変えない。Task 2）。
> - **受け口の照合の結果:** `checkAgentHookRequest` の `accepted` は `event` の代わりに `route`（`agentHookRouteOfPath` の結果）を返す。`rejected` の形（`kind`・`status`・`reason`）は変えず、`copilot` の経路（`isCopilotHookPath` が真のパス）では `status` を 200 にする。ログのラベルの `拒んだ要求（copilot）` は、受け口が同じ `isCopilotHookPath` でパスから決める。`読めない知らせ` のラベルは `copilot` でも同じにする（設計書は `拒んだ要求（copilot）` だけを決めている。AGT-279 は `[agent-hooks] 読めない知らせ` の行で確かめる）。
> - **`PreparedAgentHooks` の後始末:** `hooks` を `{ configPath; token; discard: () => void }` にする（`claude` の `discard` は設定のファイルを消し、`copilot` は枠を返す）。`release` はトークンの除去と `discard` を 1 つずつ試す（L-001・L-053）。テストで `prepare` の結果を比べるときは `discard: expect.any(Function)` にし、`release` の後始末は `prepare` が返した値で確かめる（Task 5）。
> - **プラグインのフォルダの API:** 設計書の `createCopilotHookPluginSlots`・`writeCopilotHookPlugin`・`removeTokenFilesSync` を、`createCopilotHookPluginSlots({ rootDir })` が返す 1 つのオブジェクト（`acquire`・`release`・`write(slot, config)`・`removeTokenFilesSync`）にまとめる（終了の後の `closed` を 4 つが共有するため。L-435）。`isOwnPrivateDirStat` の持ち主（今の `agentHookSettings.ts` の内部の `currentOwner`）を `currentAgentHookDirOwner` として export して使う（Task 4）。
> - **テストの偽の hooks:** `helpers/fakeAgentHookSessions.ts` の `prepared` の関数に起動の計画も渡し、`preparedWithoutHooks(ownerId, plan)` が `plan.cliKind` を `cliKind` に入れる（Task 3）。
> - **renderer の引数:** 設計書の 3 つの文言の関数（`agentChangesAttributionLostReason`・`agentChangesUnassignedNote`・`agentRevertAllDistinguishingNote`）はコマンド名を受け取る。名前と精度の注記の両方が要る `describeAgentChangesAttribution`・`describeAgentChangesSectionAttribution`・`buildAgentRevertAllConfirmMessage` と、`AgentChangesPanelState`・`useAgentChangesRevert`・`useAgentChangesWiring` は、省略できない `cliKind: AgentCliKind` を受け取る（L-060）。精度の注記は句点で終わらないので、`すべて戻す` の確認では後ろに `。` を足してつなぐ（ほかの順の文と同じく句点で終わる文にする）。区別の状態の 1 行では今の規則どおり `。` で区切る（Task 6）。
> - **配線の確かめ（L-060）:** `cliKind` の受け渡しの経路は `useAgentWorkspace` の `agentTerminal.appCliKind` → `useAppState` → `useAgentChangesWiring({ cliKind })` → `useAgentChangesRevert` と `agentChangesPanel.cliKind` → `GitRepoView`・`NotRepositoryView` の `{...agentChanges}` → `AgentChangesSection`（計画の時点で確かめた）。配線のテストは `App.agentChanges.test.tsx` に `getAgentCliKind` を `copilot` にした 1 件を足し、受け渡しを外す変異で落ちることを確かめる（Task 6）。
> - **ROADMAP の段階 1・2a・2b・3a の行:** 設計書の「`（段階 3b で対応した）` を書き足す」は、それらの行がすでに末尾の括弧に「段階 2a で…対応した。…段階 3a で…対応した」を並べているので、同じ括弧の中に `段階 3b で利用者の変更との区別に対応した` を足す形にする（Task 8）。

## Global Constraints

- コメント・文言・ログは日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。クライアントのコンポーネントには `'use client'`。`any` を使わない。テストの補助関数にも戻り値の型を書く
- **コミット・プッシュはしない**（CLAUDE.md。利用者の明示の指示があるまで行わない）。各タスクの最後の Step は「コミットしない（dev-flow の commit-ja でまとめてコミットする）」。`git add`・`git mv`・`git stash` もしない
- **実物の `claude`・`copilot` はテストで起動しない。** pty を通す確かめは、一時ディレクトリに置いた小さな node のスクリプト（偽の `copilot`）を実物の node-pty で起動して行う（PATH には偽物と node だけを置いた場所を入れ、起動の前に解決された file が偽物であることを確かめる。既存の `agentCliLaunch.integration.test.ts` の作り）。hook の要求は、テストの中で `sendHookRequest` か偽の `copilot` から送る（偽の hook の要求）。テストは利用者の `~/.copilot`・`~/.claude`・`userData` に書かない（`userData` は一時ディレクトリにする）。実機（Electron）の確認は利用者がまとめて行う（Task 8 で実機テスト仕様書に追記する）
- 各タスクの終わりで次が通る状態を保つ: `npx vitest run`（全テスト）・`npm run typecheck`・変更・作成した TypeScript のファイルへの `npx eslint --max-warnings 0 <ファイル>` と `npx prettier --check <ファイル>`（L-609）。型に値や欄を足すタスクでは、その型を網羅する `switch`・`Record` と、その型の値を作るすべての箇所（テストの値・テストの補助を含む）と、その値に依存する既存のテストを同じタスクで直す
- **`npx prettier --write` は、変更したファイルを明示して実行する**（引数が空だとリポジトリ全体を整形してしまう）。`ROADMAP.md` は prettier にかけない
- **このマシンは負荷が高く、`npx vitest run` の全体でテストが時間切れ（`Test timed out`・`waitFor` の打ち切り）で落ちることがある。** 落ちたら、落ちたファイルを `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書いて先へ進む。単体でも落ちれば本当の失敗として直す
- **シェルで `path` を変数名に使わない**（zsh では `path` が `PATH` と結び付いた配列で、代入すると `PATH` が壊れる）。**zsh では、変数に入れたファイル名の並びが単語に分かれない。** 複数のファイルは直接書くか、`set -- a.ts b.ts` と `"$@"` を使う。**シェルの変数は Bash の呼び出しをまたいで残らない。** コードブロックごとに先頭で設定し直す
- **日本語を含むファイルを Python で書き換えるときは、`# -*- coding: utf-8 -*-` 付きのスクリプトのファイルにして実行する**（`python3 -c` に日本語を書かない）。スクリプトは実行するエージェントのセッションの作業用の一時ディレクトリ（scratchpad。以下 `$S`。各コードブロックの先頭で `S=<scratchpad の絶対パス>` を設定し直す）に置く。`perl -pi` の置き換えは ASCII のパターンと ASCII の置き換え後の文字列だけで行う
- **「実装を外すとテストが落ちることの確かめ」は `git stash` を使わず、手で外して手で戻す。** 書いた実装の該当の行を一時的に元の形へ戻す（または消す）→ 該当のテストを流して落ちることを確かめる → 手で元に戻す → `git diff <ファイル>` か `grep` で戻したことを確かめ、テストが通ることを確かめ直す
- **テストのタイマー:** 偽のタイマー（`vi.useFakeTimers()`）を使うテストは `afterEach` で `vi.clearAllTimers()`・`vi.useRealTimers()` を呼ぶ。テストのコードで本物の `setTimeout`・`setInterval` を張るときは、返った ID を変数に保持し、`afterEach` で `clearTimeout`・`clearInterval` する（`null` を確かめてから）。待ちは `new Promise((r) => setTimeout(r, ms))` ではなく `vi.waitFor` で書く（既存のテストの待ちは変えない）。偽の `copilot` のスクリプトの中の `setInterval`（子プロセスを生かしておくため）は、子プロセスごと `registry.stopAll` で止まるので対象外
- `act(...).then(...)` の形でテストを書かない。`console.*` の spy と `vi.spyOn(window.api, …)`・`vi.spyOn(<実物のオブジェクト>, …)` は `afterEach`（か `finally`）で戻す
- 種類の違いは種類をキーにした表（`Record<AgentCliKind, …>`）から引き、入口に `kind === 'copilot'` のような種類の名前との比較を書かない（受け口の経路の種類 `route.cliKind`・持ち主の `owner.cli.kind` の判別は、判別可能な union の絞り込みとして使ってよい）。`activate` の会話の ID・`PreparedAgentHooks.cliKind`・`AgentHookOwner.cli`・能力の差し替えの補助の `changeAttributionUnsupportedKinds`・renderer の `cliKind` は省略できない形にする（省略で `claude` に倒れない。L-060）
- トークン・本文は、ログ・応答・例外の文言に出さない。fs の例外（パスに利用者名が入りうる）はログにだけ出し、画面に出さない（L-017）。`--plugin-dir` の値は main が作った絶対パスだけ（L-034）

### 設計書の決めたこと（利用者の確認済み。一字一句）

| 項目                      | 決定                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 設計の根拠                | 実物の `copilot` の hooks を、切り離した環境で記録して設計した（記録の承認済み。`report.md`）                                                                                                                                                                                                              |
| 精度の違い                | `claude` と同じ精度で区別できない点があっても、できる範囲で入れる。違いは既知の制約と画面の表示で伝える                                                                                                                                                                                                    |
| トークンの置き場          | タブ（枠）ごとに、固定のプラグインのフォルダをアプリのデータのフォルダ（`userData`）に置く。起動のたびに、トークン入りの hooks の設定（権限 0600）を書き直す。トークンは環境変数に置かない。`~/.copilot/plugin-data/_direct/` に残る空のディレクトリは、タブの上限の数（4）までで止まる                    |
| localhost の http の hook | アプリから起動した `copilot` の環境に `COPILOT_HOOK_ALLOW_LOCALHOST=1` を足す。利用者自身の localhost の hook も動くようになる副作用は既知の制約に書く                                                                                                                                                     |
| 精度の違いを出す場所      | 3 か所で伝える。種類ごとの注記の表 `AGENT_CLI_ATTRIBUTION_PRECISION_NOTES: Record<AgentCliKind, string \| null>`（`claude` は `null`）を置き、`copilot` の注記を設定の画面・変更の一覧の区別の状態の 1 行・`すべて戻す` の確認に出す（2026-10-26。詳しくは「画面の表示と文言」の「精度の注記を出す場所」） |

### 設計書の決めたこと（推奨案で決めた事項。要点）

- **hooks の書き方**: PascalCase のイベント名を `copilot` の平らな形（`{"version":1,"hooks":{"<イベント>":[{"type":"http",…}]}}`）で書く。camelCase は書かない
- **渡すイベント**: `UserPromptSubmit`・`PreToolUse`・`PostToolUse`・`PostToolUseFailure`・`Stop`・`SubagentStop`・`SessionEnd` の 7 つ
- **区間**: ツールの呼び出しの ID が無いので、すべて「ID を持たない CLI の区間」として、会話の ID（本文の `session_id`）ごとのグループで数える。バッチの終わりは、グループの開いた区間が 0 に戻った時点
- **閉じる合図に使わないもの**: 次の `UserPromptSubmit` と renderer の作業の終わりでは区間を閉じない。中断（Esc）の後は、次のプロンプトで残った区間に「持ち越し」の印を付けるだけにし、「次のターンの `Stop` まで開いたまま＋作業の終わりから 30 秒で保留」で受ける
- **サブエージェント**: 本文の `session_id` がタブの「主の会話の ID」と違う知らせを、その ID のサブエージェントのものとして扱う。中の `Stop` はそのサブエージェントの区間を閉じるだけ。中の `UserPromptSubmit` は確かめにだけ使う
- **受け口の応答**: `copilot` 向けのパスへの要求には、照合の失敗・本文の不正・閉じた後・処理の例外でも常に 200 の空の本文を返す。`{"permissionDecision":"allow"}` は返さない。`claude` 向けのパスの応答は変えない
- **PreToolUse の待ちと timeoutSec**: 待ちの上限は 5 秒のまま。`copilot` の `PreToolUse` の `timeoutSec` は 10 秒、ほかのイベントは 5 秒
- **ファイルのパスの扱い**: 読まない（`tool_input` は読まない）
- **プラグインのフォルダの割り当て**: main 全体で 4 つの枠（`slot-1`〜`slot-4`）。空いている一番小さい番号を割り当て、その pty の終了で返す。使い切っていたら hooks なしで起動する（`receiver-unavailable`）
- **`COPILOT_HOOK_ALLOW_LOCALHOST` の範囲**: 起動の表の `extraEnv` に足し、hooks を用意できなかった起動でも常に足す
- **画面の文言の CLI の名前**: そのウィンドウの設定の種類（`appCliKind`）のコマンド名で作る。`claude` では今と 1 文字も変わらない。main の要約に種類を足さない
- **受け口が止まったとき**: 既知の制約にとどめる（同じポートで待ち受け直す処理は足さない）
- **版の確認**: しない（L-052）
- **renderer から届く値**: 新しい経路は作らない。フォルダ・環境変数・引数・トークンはすべて main が決める（L-019）

### 文言（一字一句。設計書「画面の表示と文言」の「文言の表」。実機テスト仕様書もこの文字列で書く）

`claude` の文言は 1 文字も変えない（`<cmd>` に `claude` を入れると今の文と同じ）。

| 定数・関数                                                                                           | 文言                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentChangesAttributionLostReason(reason, commandName)`（表を置き換え）                             | `hooks-not-confirmed`: `<cmd> の hooks から知らせが届きません`。`cli-unsupported`: `使っているエージェント CLI が区別に対応していません`。ほかは今のまま（`receiver-unavailable`・`claude-version-unsupported`・`checkpoint-failed`） |
| `agentChangesUnassignedNote(commandName)`（`AGENT_CHANGES_UNASSIGNED_NOTE` を置き換え）              | `アプリの中で <cmd> が動いていなかった間などの変更には、印を付けていません`                                                                                                                                                           |
| `agentRevertAllDistinguishingNote(commandName)`（`AGENT_REVERT_ALL_DISTINGUISHING_NOTE` を置き換え） | `エージェントのツールが動いている間（終わってから 2 秒・許可の確認を待つ間を含む）と、<cmd> を起動してから最初のプロンプトを送るまで・中断（Esc）の後にあなたが編集した内容は、エージェントの変更として戻ります。`                    |
| `すべて戻す` の確認の順 3                                                                            | `アプリの中で <cmd> が動いていなかった間などのあなたの編集も戻ります。`                                                                                                                                                               |
| `AGENT_CLI_ATTRIBUTION_PRECISION_NOTES.copilot`（新規。`claude` は `null`）                          | `copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）`                                                              |
| プラグインのマニフェスト（`plugin.json`）                                                            | `{"name":"prompt-ide-agent-hooks","version":"1.0.0","description":"prompt-ide がエージェントの変更の区別に使う hooks（アプリが起動した copilot だけに渡します）"}`                                                                    |
| `buildCopilotArgs` の例外                                                                            | `copilot の起動の hooks のフォルダのパスが正しくありません`（値を文言に入れない）                                                                                                                                                     |

### 型・関数の名前（後のタスクはこの名前と型で使う）

- 区間（Task 1。`src/main/agentHookEvents.ts`・`src/main/agentToolIntervals.ts`）: `ToolIdRead = { kind: 'read'; id: string } | { kind: 'unreadable' } | { kind: 'none' }`、`AgentHookConfirmOnlyReason` に `'subagent-prompt' | 'other-session-end' | 'session-id-unreadable' | 'stop-while-awaiting' | 'copilot-body-unreadable' | 'subagent-stop-unmatched'`、`IdlessInterval extends OpenInterval { group: string | null; carried: boolean }`、`ToolIntervals.idlessOpen: IdlessInterval[]`・`ToolIntervals.idlessEndedGroups: Set<string | null>`。テストの補助 `idlessToolStart(group?: string | null)`・`idlessToolEnd(group?: string | null)`・`confirmOnly(reason)`（`helpers/agentHookEventFixtures.ts`）
- copilot の解釈（Task 2。`src/main/agentHookProtocol.ts`・`src/main/agentCopilotHookEvents.ts`）: `CopilotHookEventName = Exclude<AgentHookEventName, 'PostToolBatch' | 'StopFailure'>`・`COPILOT_HOOK_EVENT_NAMES`・`copilotHookPathOf(event: CopilotHookEventName): string`・`isCopilotHookPath(path: string): boolean`・`COPILOT_HOOK_TOOL_NAMES: readonly string[]`・`COPILOT_HOOK_TOOL_MATCHER: string`、`CopilotHookNotice`・`CopilotMainSession = { kind: 'known'; id: string } | { kind: 'awaiting' }`・`parseCopilotHookRequest(event: CopilotHookEventName, body: AgentHookBody): CopilotHookParseResult`・`resolveCopilotHookNotice(main: CopilotMainSession, notice: CopilotHookNotice): CopilotHookResolution`（`{ event: AgentHookEvent; main: CopilotMainSession }`）。`agentHookEvents.ts` から `readAgentHookBodyObject`・`isAgentHookId`・`readAgentHookAgentId`・`AGENT_HOOK_TOOL_NAME_PATTERN` を export
- 受け口（Task 3）: `AgentHookRoute = { cliKind: 'claude'; event: AgentHookEventName } | { cliKind: 'copilot'; event: CopilotHookEventName }`・`agentHookRouteOfPath(path: string): AgentHookRoute | null`（`agentHookProtocol.ts`）、`AgentHookOwnerCli = { kind: 'claude' } | { kind: 'copilot'; main: CopilotMainSession }`・`AgentHookOwner = { ownerId: number; sessionId: string; cli: AgentHookOwnerCli }`・`AgentHookRequestCheck` の `accepted` が `{ kind: 'accepted'; route: AgentHookRoute; owner: AgentHookOwner }`（`agentHookReceiverRequest.ts`）、`PreparedAgentHooks` の両方の形に `cliKind: AgentCliKind`、`AgentHookSessions.activate(prepared, sessionId: string, cliSessionId: string | null): void`
- プラグインのフォルダ（Task 4。`src/main/agentCopilotHookPlugin.ts`）: `COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME = 'agent-hooks-copilot'`・`COPILOT_HOOK_PLUGIN_SLOT_COUNT`（= `AGENT_MAX_SESSIONS_PER_WINDOW` = 4）・`COPILOT_HOOK_PLUGIN_MANIFEST`・`CopilotHttpHook`・`CopilotHookConfigJson`・`buildCopilotHookConfig({ baseUrl, token }): CopilotHookConfigJson`・`CopilotHookPluginSlot = { number: number; dir: string }`・`CopilotHookPluginSlots`（`acquire(): CopilotHookPluginSlot | null`・`release(slot): void`・`write(slot, config): Promise<void>`・`removeTokenFilesSync(): void`）・`createCopilotHookPluginSlots(deps: CopilotHookPluginSlotsDeps): CopilotHookPluginSlots`。`agentHookSettings.ts` から `currentAgentHookDirOwner(): AgentHookSettingsDirOwner` を export
- 有効化（Task 5）: `AgentHookPreparation = { configPath: string; token: string; discard: () => void }`、`AgentHookSessionsDeps.copilotPlugins: Pick<CopilotHookPluginSlots, 'acquire' | 'release' | 'write'>`、`AgentCliLaunchSpec.buildArgs(launch, claudeSessionId, hookConfigPath: string | null)`、`AgentHooksRuntimeOptions.userDataDir: string`、`AgentHooksLifecycleParts.copilotPlugins: Pick<CopilotHookPluginSlots, 'removeTokenFilesSync'>`、renderer のテストの補助 `AgentCliCapabilityOverrides.changeAttributionUnsupportedKinds: Set<AgentCliKind>`
- 文言（Task 6）: `AGENT_CLI_ATTRIBUTION_PRECISION_NOTES: Record<AgentCliKind, string | null>`（`agentCliMessages.ts`）、`agentChangesAttributionLostReason(reason: AgentChangesAttributionLostReason, commandName: string): string`・`agentChangesUnassignedNote(commandName: string): string`・`agentRevertAllDistinguishingNote(commandName: string): string`・`describeAgentChangesAttribution(attribution, startedAt, cliKind: AgentCliKind)`・`buildAgentRevertAllConfirmMessage({ …, cliKind })`（`agentChangesMessages.ts`。旧定数 `AGENT_CHANGES_ATTRIBUTION_LOST_REASONS`・`AGENT_CHANGES_UNASSIGNED_NOTE`・`AGENT_REVERT_ALL_DISTINGUISHING_NOTE` は消す）、`describeAgentChangesSectionAttribution(view, scope, cliKind)`、`AgentChangesPanelState.cliKind`・`AgentChangesRevertOptions.cliKind`・`AgentChangesWiringOptions.cliKind`

### ファイルの構成（作る・変えるもの）

| ファイル                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 責務                                                                            | タスク |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| `src/main/agentHookEvents.ts`・`src/main/agentToolIntervals.ts`・`src/main/agentToolActivity.ts`（コメントとログの求め方）・`src/main/__tests__/helpers/agentHookEventFixtures.ts`                                                                                                                                                                                                                                                                                                        | ID を持たない CLI の区間の規則                                                  | 1      |
| `src/main/agentHookProtocol.ts`・`src/main/agentHookEvents.ts`（export）・`src/main/agentCopilotHookEvents.ts`（新規）                                                                                                                                                                                                                                                                                                                                                                    | copilot の定数・入力の解釈・会話の ID の振り分け（純粋な関数）                  | 2      |
| `src/main/agentHookProtocol.ts`・`src/main/agentHookReceiverRequest.ts`・`src/main/agentHookReceiver.ts`・`src/main/agentHookSessions.ts`・`src/main/agentSessionStarter.ts`・`src/main/__tests__/helpers/fakeAgentHookSessions.ts`                                                                                                                                                                                                                                                       | 受け口の経路・持ち主の種類・copilot の経路の応答・振り分けの呼び出し            | 3      |
| `src/main/agentCopilotHookPlugin.ts`（新規）・`src/main/agentHookSettings.ts`（export だけ）                                                                                                                                                                                                                                                                                                                                                                                              | 設定の JSON・マニフェスト・枠・フォルダの確かめ・原子的な書き直し・終了の後始末 | 4      |
| `src/shared/agentCliKinds.ts`・`src/main/agentHookSessions.ts`・`src/main/agentSessionStarter.ts`・`src/main/agentCliLaunchSpecs.ts`・`src/main/agentHooksRuntime.ts`・`src/main/agentHooksLifecycle.ts`・`src/main/ipcHandlers.ts`・`src/renderer/src/__tests__/agentCliCapabilityOverrides.ts`・`src/renderer/src/hooks/useAgentHooksWorkingReport.ts`（コメント）                                                                                                                      | copilot の区別の有効化（準備・引数・環境変数・能力の表）                        | 5      |
| `src/renderer/src/lib/agentCliMessages.ts`・`src/renderer/src/lib/agentChangesMessages.ts`・`src/renderer/src/lib/agentChangesSectionText.ts`・`src/renderer/src/components/settings/AgentCliKindSection.tsx`・`src/renderer/src/components/source-control/AgentChangesSection.tsx`・`src/renderer/src/hooks/useAgentChangesRevert.ts`・`src/renderer/src/hooks/useAgentChangesWiring.ts`・`src/renderer/src/hooks/useAppState.ts`・`src/renderer/src/__tests__/makeAgentChangesState.ts` | 文言の関数化・精度の注記・`cliKind` の受け渡し                                  | 6      |
| `src/main/__tests__/agentCliLaunch.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                   | 偽の copilot と実物の node-pty の統合テスト（テストだけ）                       | 7      |
| `ROADMAP.md`・`docs/manual-test-spec.md`・`docs/superpowers/specs/2026-10-26-agent-cli-copilot-hooks-design.md`（食い違いがあれば）                                                                                                                                                                                                                                                                                                                                                       | 段階 3b の記録・実機テスト仕様書・全体の検証                                    | 8      |

---

### Task 1: ID を持たない CLI の区間の規則

> **設計書の読む節:** 「区間の規則」（表・外す 5 つの時点・持ち越し・「次の `tool-start` を、そのまま閉じる合図にしない理由」・「記録の場面を規則に当てはめた結果」）、「claude への影響と互換性」、「実装の分割」の 1、「テスト方針」の `agentToolIntervals.test.ts`。設計書レビューの推奨は `.claude/dev-flow/spec-review3.md`（`idlessEndedGroups` の説明。このプランの冒頭の「計画の時点で設計書から調整した細部」の 1 つ目）。
>
> **気をつける知見:** L-002（開く側〈`tool-start`〉は上限でも捨てずに `overflowed` に倒す）・L-044（`tool-end` は持ち越しの区間・ほかのグループを閉じない。`prompt-submit` は印を付けるだけで閉じない。読めない知らせで閉じない）・L-609（`ToolIdRead` に `none` を足したら、`toolId.kind` で分ける箇所〈`applyToolIntervalEvent`・追跡の `detailOf`〉とテストの補助を同じタスクで直す）・L-203（冒頭のコメントの「confirm-only は何もしない」を直す）。

**Files:**

- Modify: `src/main/agentHookEvents.ts`（`ToolIdRead`・`AgentHookConfirmOnlyReason`）
- Modify: `src/main/agentToolIntervals.ts`（冒頭のコメント・`IdlessInterval`・`ToolIntervals`・`createToolIntervals`・`openIntervalsOf`・`openCountOf`・`applyToolIntervalEvent` と補助の関数）
- Modify: `src/main/agentToolActivity.ts`（`detailOf` のコメントだけ。`none` は今の式で `なし` になる）
- Modify: `src/main/__tests__/helpers/agentHookEventFixtures.ts`（`idlessToolStart`・`idlessToolEnd`・`confirmOnly`）
- Test: `src/main/__tests__/agentToolIntervals.test.ts`・`src/main/__tests__/agentToolActivity.test.ts`・`src/main/__tests__/agentHookEvents.test.ts`

**Interfaces:**

- Consumes: なし（この時点で `none` を作る解釈は無い。規則のテストは知らせを直接作る）
- Produces: `ToolIdRead` の `{ kind: 'none' }`、`AgentHookConfirmOnlyReason` の 6 つの理由（`subagent-prompt`・`other-session-end`・`session-id-unreadable`・`stop-while-awaiting`・`copilot-body-unreadable`・`subagent-stop-unmatched`）、`ToolIntervals.idlessOpen`・`idlessEndedGroups`。グループは `AgentHookEvent` の `agentId` の欄（`null` は主）。Task 2 の振り分けがこの形の知らせを作る

- [ ] **Step 1: テストの補助を足す（失敗するテストの前提）**

`src/main/__tests__/helpers/agentHookEventFixtures.ts` の import と末尾を次にする（import は `AgentHookConfirmOnlyReason` を足す）:

```ts
import type { AgentHookConfirmOnlyReason, AgentHookEvent } from '../../agentHookEvents'
```

```ts
/** ツールの呼び出しの ID を持たない CLI(copilot)の tool-start。group は会話のグループ(null は主、文字列はサブエージェントの会話の ID) */
export const idlessToolStart = (group: string | null = null): AgentHookEvent => ({
  kind: 'tool-start',
  hookEventName: 'PreToolUse',
  toolName: 'Edit',
  toolId: { kind: 'none' },
  agentId: group
})

/** ツールの呼び出しの ID を持たない CLI(copilot)の tool-end */
export const idlessToolEnd = (group: string | null = null): AgentHookEvent => ({
  kind: 'tool-end',
  hookEventName: 'PostToolUse',
  toolName: 'Edit',
  toolId: { kind: 'none' },
  agentId: group
})

/** 理由を指定した confirm-only(hookEventName は区間の規則に使わないため UserPromptSubmit に固定する) */
export const confirmOnly = (reason: AgentHookConfirmOnlyReason): AgentHookEvent => ({
  kind: 'confirm-only',
  reason,
  hookEventName: 'UserPromptSubmit',
  toolName: null
})
```

冒頭のコメントの「id が null なら ID を読めなかった知らせ」の後に「`idless*` はツールの呼び出しの ID を持たない CLI の知らせ」を足す。

- [ ] **Step 2: 区間の規則の失敗するテストを書く**

`src/main/__tests__/agentToolIntervals.test.ts` の import に `idlessToolStart`・`idlessToolEnd`・`confirmOnly` と、型 `ToolIntervals`（`../agentToolIntervals`）・`AgentHookEvent`（`../agentHookEvents`）を足し、末尾に次を足す:

```ts
describe('applyToolIntervalEvent(ID を持たない CLI の区間。段階 3b)', () => {
  /** 知らせを順に当てる(openedAt は start から 1 ずつ進める) */
  function run(intervals: ToolIntervals, events: AgentHookEvent[], start = 0): void {
    events.forEach((event, index) => applyToolIntervalEvent(intervals, event, start + index))
  }
  /** 開いた ID を持たない区間の [グループ, 持ち越し] の並び(開いた順) */
  const groupsOf = (intervals: ToolIntervals): Array<[string | null, boolean]> =>
    intervals.idlessOpen.map((interval) => [interval.group, interval.carried])

  it('createToolIntervals は空の idlessOpen・idlessEndedGroups から始める', () => {
    const intervals = createToolIntervals()
    expect(intervals.idlessOpen).toEqual([])
    expect(intervals.idlessEndedGroups.size).toBe(0)
  })

  it('tool-start(none)はグループ付きの持ち越しでない区間を now で開き、開いた区間の数と openIntervalsOf に入る(ID のある区間・ID なしの区間は変えない)', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, idlessToolStart(), 10)
    applyToolIntervalEvent(intervals, idlessToolStart('sub-1'), 11)
    expect(intervals.idlessOpen).toEqual([
      { openedAt: 10, expired: false, group: null, carried: false },
      { openedAt: 11, expired: false, group: 'sub-1', carried: false }
    ])
    expect(openCountOf(intervals)).toBe(2)
    expect(openIntervalsOf(intervals)).toHaveLength(2)
    expect(intervals.openTools.size).toBe(0)
    expect(intervals.anonymousOpen).toEqual([])
  })

  it('並列のバッチ(記録 02): pre A・pre B・post B・post A で 0 に戻り、主が集合に入る', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart(), idlessToolStart(), idlessToolEnd()])
    expect(openCountOf(intervals)).toBe(1)
    expect([...intervals.idlessEndedGroups]).toEqual([null])
    applyToolIntervalEvent(intervals, idlessToolEnd(), 3)
    expect(openCountOf(intervals)).toBe(0)
  })

  it('次のバッチの tool-start は主を集合から外す(閉じる区間が無ければ何も閉じない)', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart(), idlessToolEnd(), idlessToolStart()])
    expect(groupsOf(intervals)).toEqual([[null, false]])
    expect(intervals.idlessEndedGroups.size).toBe(0)
  })

  it('断った・同じバッチ: tool-end の後の tool-start は、そのグループの前のバッチの残りを閉じてから開く', () => {
    const intervals = createToolIntervals()
    // pre A・pre B(断る)・post A で 1 つ残る
    run(intervals, [idlessToolStart(), idlessToolStart(), idlessToolEnd()])
    expect(openCountOf(intervals)).toBe(1)
    // 次のバッチの pre C で残り(B)を閉じる
    applyToolIntervalEvent(intervals, idlessToolStart(), 3)
    expect(intervals.idlessOpen).toEqual([
      { openedAt: 3, expired: false, group: null, carried: false }
    ])
    expect(intervals.idlessEndedGroups.size).toBe(0)
  })

  it('断った・続けて呼ぶ(記録 60・36・50): 間に tool-end の無い tool-start では閉じず、残りは turn-end で閉じる', () => {
    const intervals = createToolIntervals()
    // pre A(断る)・pre B・post B
    run(intervals, [idlessToolStart(), idlessToolStart(), idlessToolEnd()])
    expect(openCountOf(intervals)).toBe(1)
    applyToolIntervalEvent(intervals, turnEnd(), 3)
    expect(openCountOf(intervals)).toBe(0)
    expect(intervals.idlessEndedGroups.has(null)).toBe(false)
  })

  it('中断の後の持ち越し(記録 61・62): pre B → prompt-submit → pre C → post C → pre D → post D で B が残り、turn-end で閉じる', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, idlessToolStart(), 0)
    applyToolIntervalEvent(intervals, promptSubmit(), 1)
    expect(groupsOf(intervals)).toEqual([[null, true]])
    run(intervals, [idlessToolStart(), idlessToolEnd()], 2)
    expect(groupsOf(intervals)).toEqual([[null, true]])
    expect(intervals.idlessEndedGroups.has(null)).toBe(true)
    run(intervals, [idlessToolStart(), idlessToolEnd()], 4)
    expect(groupsOf(intervals)).toEqual([[null, true]])
    applyToolIntervalEvent(intervals, turnEnd(), 6)
    expect(openCountOf(intervals)).toBe(0)
  })

  it('並列の途中の中断: pre A・pre B・post A → prompt-submit → pre C → post C → pre D でも、残りは turn-end まで開いたまま', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart(), idlessToolStart(), idlessToolEnd()])
    applyToolIntervalEvent(intervals, promptSubmit(), 3)
    expect(groupsOf(intervals)).toEqual([[null, true]])
    expect(intervals.idlessEndedGroups.size).toBe(0)
    run(intervals, [idlessToolStart(), idlessToolEnd(), idlessToolStart()], 4)
    expect(groupsOf(intervals)).toEqual([
      [null, true],
      [null, false]
    ])
    applyToolIntervalEvent(intervals, turnEnd(), 7)
    expect(openCountOf(intervals)).toBe(0)
  })

  it('prompt-submit を受けないと、中断したツールの区間は post C の数の消費と pre D の区切りで閉じる(既知の制約)', () => {
    const intervals = createToolIntervals()
    // B(中断)・C
    run(intervals, [idlessToolStart(), idlessToolStart()])
    // post C は一番古い区間(B)を閉じる
    applyToolIntervalEvent(intervals, idlessToolEnd(), 2)
    expect(intervals.idlessOpen.map((interval) => interval.openedAt)).toEqual([1])
    // pre D は前のバッチの残り(C の分)を閉じる
    applyToolIntervalEvent(intervals, idlessToolStart(), 3)
    expect(intervals.idlessOpen.map((interval) => interval.openedAt)).toEqual([3])
  })

  it('tool-end は持ち越しの区間を閉じず、持ち越しでない一番古い区間を閉じる。持ち越しでない区間が無くても集合には入れる', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, idlessToolStart(), 0)
    applyToolIntervalEvent(intervals, promptSubmit(), 1)
    run(intervals, [idlessToolStart(), idlessToolStart()], 2)
    applyToolIntervalEvent(intervals, idlessToolEnd(), 4)
    expect(intervals.idlessOpen.map((interval) => [interval.openedAt, interval.carried])).toEqual([
      [0, true],
      [3, false]
    ])
    run(intervals, [idlessToolEnd(), idlessToolEnd()], 5)
    expect(intervals.idlessOpen.map((interval) => [interval.openedAt, interval.carried])).toEqual([
      [0, true]
    ])
    expect(intervals.idlessEndedGroups.has(null)).toBe(true)
  })

  it('prompt-submit は主のグループだけに持ち越しの印を付ける(サブエージェントのグループと集合のサブエージェントの ID は変えない)', () => {
    const intervals = createToolIntervals()
    run(intervals, [
      idlessToolStart(),
      idlessToolStart('sub-1'),
      idlessToolStart('sub-1'),
      idlessToolEnd('sub-1'),
      promptSubmit()
    ])
    expect(groupsOf(intervals)).toEqual([
      [null, true],
      ['sub-1', false]
    ])
    expect([...intervals.idlessEndedGroups]).toEqual(['sub-1'])
  })

  it('prompt-submit 以外の confirm-only は、印も集合も変えない', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart(), idlessToolStart(), idlessToolEnd()])
    run(
      intervals,
      [
        confirmOnly('subagent-prompt'),
        confirmOnly('other-session-end'),
        confirmOnly('session-id-unreadable'),
        confirmOnly('stop-while-awaiting'),
        confirmOnly('copilot-body-unreadable'),
        confirmOnly('subagent-stop-unmatched'),
        confirmOnly('unknown-tool-end')
      ],
      3
    )
    expect(groupsOf(intervals)).toEqual([[null, false]])
    expect([...intervals.idlessEndedGroups]).toEqual([null])
  })

  it('サブエージェントのグループ(記録 70)は主の turn-end で閉じず、自分の subagent-stop で閉じて集合からも外れる', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart('sub-1'), idlessToolStart('sub-1'), idlessToolEnd('sub-1')])
    applyToolIntervalEvent(intervals, turnEnd(), 3)
    expect(groupsOf(intervals)).toEqual([['sub-1', false]])
    expect(intervals.idlessEndedGroups.has('sub-1')).toBe(true)
    applyToolIntervalEvent(intervals, subagentStop('sub-1'), 4)
    expect(intervals.idlessOpen).toEqual([])
    expect(intervals.idlessEndedGroups.has('sub-1')).toBe(false)
  })

  it('tool-end はほかのグループの区間を閉じない(自分のグループを集合に入れるだけ)', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart(), idlessToolEnd('sub-1')])
    expect(groupsOf(intervals)).toEqual([[null, false]])
    expect([...intervals.idlessEndedGroups]).toEqual(['sub-1'])
  })

  it('グループの中の新しいバッチは、そのグループの残りだけを閉じる(主の区間は閉じない)', () => {
    const intervals = createToolIntervals()
    run(intervals, [
      idlessToolStart(),
      idlessToolStart('sub-1'),
      idlessToolStart('sub-1'),
      idlessToolEnd('sub-1'),
      idlessToolStart('sub-1')
    ])
    expect(intervals.idlessOpen.map((interval) => [interval.group, interval.openedAt])).toEqual([
      [null, 0],
      ['sub-1', 4]
    ])
  })

  it('turn-end の後の最初のバッチは、前のターンの区間を閉じない(主は集合から外れている。サブエージェントの区間も残る)', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart('sub-1'), idlessToolStart(), idlessToolEnd(), turnEnd()])
    expect(groupsOf(intervals)).toEqual([['sub-1', false]])
    expect(intervals.idlessEndedGroups.has(null)).toBe(false)
    applyToolIntervalEvent(intervals, idlessToolStart(), 4)
    expect(groupsOf(intervals)).toEqual([
      ['sub-1', false],
      [null, false]
    ])
  })

  it('作業中に送ったプロンプト: 動いているツールに持ち越しの印が付き、そのツールの tool-end では閉じず、turn-end で閉じる', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart(), promptSubmit(), idlessToolEnd()])
    expect(groupsOf(intervals)).toEqual([[null, true]])
    run(intervals, [idlessToolStart(), idlessToolEnd()], 3)
    expect(groupsOf(intervals)).toEqual([[null, true]])
    applyToolIntervalEvent(intervals, turnEnd(), 5)
    expect(openCountOf(intervals)).toBe(0)
  })

  it('/clear(記録 91): session-end はすべてのグループの区間(持ち越しを含む)を閉じ、集合を空にする', () => {
    const intervals = createToolIntervals()
    run(intervals, [
      idlessToolStart(),
      idlessToolStart('sub-1'),
      idlessToolEnd('sub-1'),
      promptSubmit()
    ])
    applyToolIntervalEvent(intervals, sessionEnd(), 4)
    expect(intervals.idlessOpen).toEqual([])
    expect(intervals.idlessEndedGroups.size).toBe(0)
  })

  it(`ID を持たない区間が ${AGENT_TOOL_OPEN_MAX} 件ある間の tool-start は足さず(一番古い区間も捨てない)、overflowed を立てる`, () => {
    const intervals = createToolIntervals()
    for (let i = 0; i < AGENT_TOOL_OPEN_MAX; i++)
      applyToolIntervalEvent(intervals, idlessToolStart(), i)
    applyToolIntervalEvent(intervals, idlessToolStart(), 999)
    expect(intervals.idlessOpen).toHaveLength(AGENT_TOOL_OPEN_MAX)
    expect(intervals.idlessOpen[0].openedAt).toBe(0)
    expect(intervals.overflowed).toBe(true)
    expect(hasUnassignableInterval(intervals)).toBe(true)
  })

  it('ID を持たない区間も期限切れになり、earliestUnexpiredOpenedAt と hasUnassignableInterval に入る', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, idlessToolStart(), 100)
    applyToolIntervalEvent(intervals, idlessToolStart('sub-1'), 200)
    expect(earliestUnexpiredOpenedAt(intervals)).toBe(100)
    markExpiredIntervals(intervals, 150, 50)
    expect(intervals.idlessOpen.map((interval) => interval.expired)).toEqual([true, false])
    expect(earliestUnexpiredOpenedAt(intervals)).toBe(200)
    expect(hasUnassignableInterval(intervals)).toBe(true)
  })

  it('claude の知らせ(none を作らない)では idlessOpen・idlessEndedGroups は空のまま', () => {
    const intervals = createToolIntervals()
    run(intervals, [
      promptSubmit(),
      toolStart('a'),
      toolEnd('a'),
      batchEnd(),
      toolStart(null),
      toolEnd('x'),
      subagentStop('agent-1'),
      turnEnd(),
      sessionEnd()
    ])
    expect(intervals.idlessOpen).toEqual([])
    expect(intervals.idlessEndedGroups.size).toBe(0)
  })
})
```

`src/main/__tests__/agentHookEvents.test.ts` の末尾に、`claude` の解釈が `none` を作らないことの確かめを足す:

```ts
describe('parseAgentHookRequest(none を作らない。段階 3b)', () => {
  const EVENTS: AgentHookEventName[] = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure']
  it.each(EVENTS)(
    '%s: 本文を読めても読めなくても、ツールの ID は read か unreadable(none は copilot だけ)',
    (event) => {
      const bodies: AgentHookBody[] = [
        json({ hook_event_name: event, tool_name: 'Edit', tool_use_id: 't1' }),
        json({ hook_event_name: event, tool_name: 'Edit' }),
        { kind: 'too-large' },
        { kind: 'unreadable' }
      ]
      for (const body of bodies) {
        const { event: parsed } = parseAgentHookRequest(event, body)
        if (parsed.kind === 'tool-start' || parsed.kind === 'tool-end')
          expect(parsed.toolId.kind).not.toBe('none')
      }
    }
  )
})
```

`src/main/__tests__/agentToolActivity.test.ts` の import に `idlessToolStart`・`idlessToolEnd` を足し、`afterEach` を次にする（偽のタイマーを片付ける）:

```ts
afterEach(() => {
  tracker.close()
  vi.clearAllTimers()
  vi.useRealTimers()
})
```

末尾に次を足す:

```ts
describe('createAgentToolActivity(ID を持たない CLI の区間。段階 3b)', () => {
  it('ID を持たない区間でも段階が agent になり、すべて閉じた 2 秒後に idle に戻る', () => {
    confirmed()
    tracker.deliver(1, 's1', idlessToolStart())
    expect(phase()).toBe('agent')
    tracker.deliver(1, 's1', idlessToolEnd())
    expect(phase()).toBe('agent')
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('中断の後: 次のプロンプトの後のツールの終わりでは idle に戻らず、Stop の 2 秒後に戻る', () => {
    confirmed()
    tracker.deliver(1, 's1', idlessToolStart())
    tracker.deliver(1, 's1', promptSubmit())
    tracker.deliver(1, 's1', idlessToolStart())
    tracker.deliver(1, 's1', idlessToolEnd())
    passGrace()
    expect(phase()).toBe('agent')
    tracker.deliver(1, 's1', turnEnd())
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('ログの id= は none で なし、agent= はサブエージェントのグループで あり・主で なし', () => {
    tracker.addSession(1, 'abcdefgh-1', { kind: 'pending' })
    tracker.deliver(1, 'abcdefgh-1', idlessToolStart('sub-1'))
    tracker.deliver(1, 'abcdefgh-1', idlessToolStart())
    expect(devLog.mock.calls.slice(-2).map(([line]) => line)).toEqual([
      '[agent-hooks] owner=1 session=abcdefgh event=PreToolUse tool=Edit id=なし agent=あり hooks=confirmed phase=agent→agent unassignable=なし',
      '[agent-hooks] owner=1 session=abcdefgh event=PreToolUse tool=Edit id=なし agent=なし hooks=confirmed phase=agent→agent unassignable=なし'
    ])
  })
})
```

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentToolIntervals.test.ts src/main/__tests__/agentToolActivity.test.ts src/main/__tests__/agentHookEvents.test.ts`
Expected: FAIL（`toolId: { kind: 'none' }` が `ToolIdRead` に無い型の不一致は vitest では落ちないが、`idlessOpen` が `undefined` で落ちる。`confirmOnly('subagent-prompt')` などの理由も型に無い。`npm run typecheck` でも落ちる）

- [ ] **Step 4: 型を足す（`src/main/agentHookEvents.ts`）**

`ToolIdRead` と `AgentHookConfirmOnlyReason` を次にする:

```ts
/**
 * 読めた ID と、読めない(本文が大きすぎる・読めない・形が違う)と、その CLI がツールの呼び出しの ID を持たない(copilot。
 * 段階 3b)を型で区別する。claude の解釈は none を作らない
 */
export type ToolIdRead = { kind: 'read'; id: string } | { kind: 'unreadable' } | { kind: 'none' }

export type AgentHookConfirmOnlyReason =
  | 'prompt-submit'
  | 'unknown-tool-end'
  | 'bad-agent-id'
  | 'subagent-stop-without-agent'
  /** PostToolBatch の本文を読めない(大きすぎる・JSON でない・イベント名がパスと違う) */
  | 'batch-end-unreadable'
  /** agent_id のある PostToolBatch(サブエージェントのバッチの終わりでメインの区間を閉じない) */
  | 'subagent-batch-end'
  /** copilot: 主の会話の ID と違う会話(サブエージェント)の UserPromptSubmit。確かめにだけ使う */
  | 'subagent-prompt'
  /** copilot: 主の会話ではない会話の SessionEnd(--resume の直後の別の ID など)。区間を閉じない */
  | 'other-session-end'
  /** copilot: 本文の session_id を読めない(区間を閉じる根拠・主の会話の ID の採り直しの根拠にしない。L-044) */
  | 'session-id-unreadable'
  /** copilot: 主の会話の ID を待っている間(/clear などの後)の Stop */
  | 'stop-while-awaiting'
  /** copilot: PreToolUse 以外の本文を読めない(大きすぎる・JSON でない・イベント名がパスと違う) */
  | 'copilot-body-unreadable'
  /** copilot: サブエージェントのものと確かめられない SubagentStop(agent_id が主の会話の ID と同じ・主の会話の ID を待っている間) */
  | 'subagent-stop-unmatched'
```

`AgentHookEvent` の `tool-start`・`tool-end` の `agentId` の説明として、型の上のコメント（`hookEventName はパスから決めたイベント名。…`）の後に「`toolId` が `none` の知らせの `agentId` は会話のグループ（`null` は主、文字列はサブエージェントの会話の ID）」を足す。

- [ ] **Step 5: 区間の規則を実装する（`src/main/agentToolIntervals.ts`）**

冒頭のコメントを次にする:

```ts
// 1 つのセッションのツールの区間の開閉の規則(設計書「ツールの区間の追跡」「PostToolBatch で区間を閉じる」、段階 3b の設計書
// 「区間の規則」。タイマーを持たない状態の更新)。ID のある区間・ID なしの区間・ツールの呼び出しの ID を持たない CLI(copilot)の
// 区間・区間を閉じる知らせを待たずに外した ID の控え・上限を超えた印(overflowed)を持ち、知らせごとに開閉する。割り当てられない
// 区間(期限切れ・あふれ)の判定もここで行う。
// ID があって agent_id の無い区間は、自分の tool-end で「終わった」印(ended)を付けて開いたままにし、PostToolBatch で閉じる。
// ID を持たない CLI の区間は会話のグループ(null は主)ごとに数で数え、バッチの区切り(idlessEndedGroups)と持ち越しの印(carried)で閉じる。
// confirm-only は prompt-submit だけが持ち越しの印を付け(区間は閉じない)、ほかの理由は何もしない。
// 区間が開いたままになる側(利用者の編集をエージェントに数える)に倒し、知らない・読めない知らせで区間を閉じない(L-002・L-044)。
// 確かめた状態・猶予・期限切れのタイマー・ウィンドウの段階は agentToolActivity.ts
```

`IdInterval` の後に型を足し、`ToolIntervals`・`createToolIntervals`・`openIntervalsOf`・`openCountOf` を次にする:

```ts
/** ツールの呼び出しの ID を持たない CLI(copilot)の区間 */
export interface IdlessInterval extends OpenInterval {
  /** 会話のグループ(null は主の会話、文字列はサブエージェントの会話の ID) */
  group: string | null
  /**
   * 前のターンからの持ち越し(主のグループだけに付く。prompt-submit で付け、外さない)。持ち越しの区間は turn-end(主)・
   * session-end・pty の終了だけで閉じ、バッチの区切り・tool-end の数の消費では閉じない
   */
  carried: boolean
}

export interface ToolIntervals {
  openTools: Map<string, IdInterval>
  anonymousOpen: OpenInterval[]
  /** ツールの呼び出しの ID を持たない CLI の区間(開いた順。claude では常に空) */
  idlessOpen: IdlessInterval[]
  /**
   * バッチの区切りを待つグループ(tool-end を受けて入り、次の tool-start で前のバッチの残りを閉じて外れる)。入れる・外す時点は
   * applyToolIntervalEvent の規則(外すのは tool-start(g)・prompt-submit(主)・turn-end(主)・subagent-stop(X)・session-end(すべて)の
   * 5 つの時点だけ)。claude では常に空
   */
  idlessEndedGroups: Set<string | null>
  /** 区間を閉じる知らせを待たずに外した ID(遅れた tool-end で別の区間を閉じないため) */
  droppedToolIds: Set<string>
  /** 上限(AGENT_TOOL_OPEN_MAX)を超える tool-start を受けた。どのエージェントの区間か分からないため、session-end と pty の終了でだけ下ろす */
  overflowed: boolean
}

export const createToolIntervals = (): ToolIntervals => ({
  openTools: new Map(),
  anonymousOpen: [],
  idlessOpen: [],
  idlessEndedGroups: new Set(),
  droppedToolIds: new Set(),
  overflowed: false
})

/** 開いている区間(期限切れ・ended・持ち越しを含む) */
export const openIntervalsOf = (intervals: ToolIntervals): OpenInterval[] => [
  ...intervals.openTools.values(),
  ...intervals.anonymousOpen,
  ...intervals.idlessOpen
]

/** 開いた区間の数。あふれたセッションは開いた区間があるものとして 1 を足す */
export const openCountOf = (intervals: ToolIntervals): number =>
  intervals.openTools.size +
  intervals.anonymousOpen.length +
  intervals.idlessOpen.length +
  (intervals.overflowed ? 1 : 0)
```

`dropIdInterval` の後に補助の関数を足す:

```ts
/**
 * ID を持たない CLI の tool-start(グループ g)。g がバッチの区切りを待っていれば、g の持ち越しでない区間(前のバッチの残り。
 * 許可の確認で断った・hook が拒否したツール)をすべて閉じて g を集合から外す。copilot は 1 つのバッチの結果がそろうまで次の
 * モデルの要求を出さないので、この時点で同じターンの前のバッチのツールは動いていない。そのあと持ち越しでない区間を 1 つ開く
 */
function startIdlessInterval(intervals: ToolIntervals, group: string | null, now: number): void {
  if (intervals.idlessEndedGroups.delete(group)) {
    intervals.idlessOpen = intervals.idlessOpen.filter(
      (interval) => interval.group !== group || interval.carried
    )
  }
  if (intervals.idlessOpen.length >= AGENT_TOOL_OPEN_MAX) {
    // 上限を超える区間は足さない(一番古い区間も捨てない。まだ動いているツールの区間を早く閉じない。L-002)
    intervals.overflowed = true
    return
  }
  intervals.idlessOpen.push({ openedAt: now, expired: false, group, carried: false })
}

/**
 * ID を持たない CLI の tool-end(グループ g)。g の持ち越しでない一番古い区間を 1 つ閉じ、g を集合に入れる。持ち越しでない区間が
 * 無ければ何も閉じない(持ち越しの区間・ほかのグループを閉じない。L-044)
 */
function endIdlessInterval(intervals: ToolIntervals, group: string | null): void {
  const index = intervals.idlessOpen.findIndex(
    (interval) => interval.group === group && !interval.carried
  )
  if (index !== -1) intervals.idlessOpen.splice(index, 1)
  intervals.idlessEndedGroups.add(group)
}

/**
 * 主のグループで開いている区間すべてに持ち越しの印を付け、主を集合から外す(区間は閉じない。前のターンの残り〈中断したツールなど〉を、
 * 新しいターンのバッチの区切り・数の消費で閉じないため)
 */
function carryMainIdlessIntervals(intervals: ToolIntervals): void {
  for (const interval of intervals.idlessOpen) {
    if (interval.group === null) interval.carried = true
  }
  intervals.idlessEndedGroups.delete(null)
}

/** グループの区間(持ち越しを含む)をすべて閉じ、グループを集合から外す */
function closeIdlessGroup(intervals: ToolIntervals, group: string | null): void {
  intervals.idlessOpen = intervals.idlessOpen.filter((interval) => interval.group !== group)
  intervals.idlessEndedGroups.delete(group)
}
```

`applyToolIntervalEvent` の doc コメントを `/** 知らせ 1 件で区間を開閉する。tool-start の openedAt は呼び出し側が渡す(confirm-only は prompt-submit だけが持ち越しの印を付ける) */` にし、各 `case` を次のとおり直す（ほかの行は変えない）:

```ts
    case 'confirm-only':
      // prompt-submit は主のグループの区間に持ち越しの印を付ける(区間は閉じない)。claude では idlessOpen・集合が空なので何も変わらない
      if (event.reason === 'prompt-submit') carryMainIdlessIntervals(intervals)
      return
    case 'tool-start': {
      if (event.toolId.kind === 'none') {
        startIdlessInterval(intervals, event.agentId, now)
        return
      }
      if (event.toolId.kind === 'read') {
        // (今のまま)
      }
      // (今のまま。ID なしの区間)
    }
    case 'tool-end': {
      if (event.toolId.kind === 'none') {
        endIdlessInterval(intervals, event.agentId)
        return
      }
      // (4) ID を読めない tool-end は何も閉じない
      if (event.toolId.kind !== 'read') return
      // (今のまま)
    }
    case 'batch-end':
      // (今のまま。copilot は PostToolBatch を渡さない)
    case 'subagent-stop':
      // agent_id のある区間は ended にならないため、外した ID はすべて控える
      for (const [id, interval] of intervals.openTools) {
        if (interval.agentId === event.agentId) dropIdInterval(intervals, id, interval)
      }
      // ID を持たない CLI の、そのサブエージェントのグループ
      closeIdlessGroup(intervals, event.agentId)
      return
    case 'turn-end':
      // 背景のサブエージェントは Stop の後も動くため、agent_id のある区間と ID なしの区間は閉じない
      for (const [id, interval] of intervals.openTools) {
        if (interval.agentId === null) dropIdInterval(intervals, id, interval)
      }
      // ID を持たない CLI は主のグループだけ(持ち越しを含む。サブエージェントのグループは閉じない)
      closeIdlessGroup(intervals, null)
      return
    case 'session-end':
      // /clear・/resume でも届くため、セッションは外さず区間だけを閉じる
      for (const [id, interval] of intervals.openTools) dropIdInterval(intervals, id, interval)
      intervals.anonymousOpen = []
      intervals.idlessOpen = []
      intervals.idlessEndedGroups.clear()
      intervals.overflowed = false
      return
```

- [ ] **Step 6: 追跡のログのコメントを直す（`src/main/agentToolActivity.ts`）**

`detailOf` の `hasId` の式の上に次のコメントを足す（式は変えない）:

```ts
// id= は ID を読めたときだけ あり。読めない(unreadable)と、その CLI が ID を持たない(none。copilot)は なし。
// agent= は agent_id(copilot ではサブエージェントのグループ)があれば あり
```

- [ ] **Step 7: テストと型検査が通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentToolIntervals.test.ts src/main/__tests__/agentToolActivity.test.ts src/main/__tests__/agentHookEvents.test.ts`
Expected: PASS（既存の `claude` のテストも変えずに通る）
Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 8: 実装を外すとテストが落ちることを確かめる（手で外して手で戻す）**

1. `applyToolIntervalEvent` の `confirm-only` の `if (event.reason === 'prompt-submit') carryMainIdlessIntervals(intervals)` の行を消す → `npx vitest run src/main/__tests__/agentToolIntervals.test.ts` で「中断の後の持ち越し」「並列の途中の中断」「作業中に送ったプロンプト」が落ちる → 手で戻す
2. `startIdlessInterval` の `interval.group !== group || interval.carried` を `interval.group !== group` にする → 「中断の後の持ち越し」が落ちる → 手で戻す
3. `startIdlessInterval` の `if (intervals.idlessEndedGroups.delete(group))` を `intervals.idlessEndedGroups.delete(group); if (true)` にする（集合を見ずに閉じる）→ 「並列のバッチ」「断った・続けて呼ぶ」が落ちる → 手で戻す
4. `endIdlessInterval` の `&& !interval.carried` を消す → 「tool-end は持ち越しの区間を閉じず」が落ちる → 手で戻す
5. `openCountOf` の `intervals.idlessOpen.length +` を消す → 「並列のバッチ」と `agentToolActivity.test.ts` の「ID を持たない区間でも段階が agent になり」が落ちる → 手で戻す

戻した後に `git diff src/main/agentToolIntervals.ts` で上の 5 か所が Step 5 の形であることを確かめ、Step 7 のコマンドで通ることを確かめ直す。

- [ ] **Step 9: 全体の検証**

```bash
cd <repo-root>
npx vitest run
npm run typecheck
set -- src/main/agentHookEvents.ts src/main/agentToolIntervals.ts src/main/agentToolActivity.ts src/main/__tests__/helpers/agentHookEventFixtures.ts src/main/__tests__/agentToolIntervals.test.ts src/main/__tests__/agentToolActivity.test.ts src/main/__tests__/agentHookEvents.test.ts
npx prettier --write "$@"
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
```

Expected: すべて通る

- [ ] **Step 10: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 2: copilot の入力の解釈と振り分け（純粋な関数）

> **設計書の読む節:** 「copilot の hooks（記録の要点）」、「渡す hooks」の「書き方の選択」と「中身」の matcher・ツールの名前、「入力の解釈と会話の ID の振り分け」（解釈・振り分けの表・列を選ぶ順・注記）、「区間の規則」の「記録の場面を規則に当てはめた結果」の `/clear`・`--resume`・サブエージェントの行、「実装の分割」の 2、「テスト方針」の `agentCopilotHookEvents.test.ts`。
>
> **気をつける知見:** L-023（本文の `hook_event_name` とパスのイベントを照らし合わせる。`claude` と同じ読み方を共有する）・L-044（読めない `session_id`・形の違う `agent_id`・知らない `tool_name` を区間を閉じる根拠・主の会話の ID の採り直しの根拠にしない。列を選ぶ順の (1) を先にする）・L-002（読めない `PreToolUse` は区間を開く側に倒す）・L-018（主の会話の ID は main が振った・照合した起動の ID から始める。この関数は渡された状態から決めるだけ）・L-019（`tool_input`・`cwd`・`transcript_path`・`prompt`・`tool_result` は読まない）・L-059（規則は記録〈`report.md`〉の形で決める）。

**Files:**

- Modify: `src/main/agentHookProtocol.ts`（`copilot` の定数とパス）
- Modify: `src/main/agentHookEvents.ts`（本文の読み方の補助を export する。中身は変えない）
- Create: `src/main/agentCopilotHookEvents.ts`
- Test: `src/main/__tests__/agentHookProtocol.test.ts`（新しい describe を足す。既存のテストは変えない）・`src/main/__tests__/agentCopilotHookEvents.test.ts`（新規）

**Interfaces:**

- Consumes: Task 1 の `ToolIdRead` の `none`・`AgentHookConfirmOnlyReason` の理由・グループを `agentId` に入れる形
- Produces: `CopilotHookEventName`・`COPILOT_HOOK_EVENT_NAMES`・`copilotHookPathOf`・`isCopilotHookPath`・`COPILOT_HOOK_TOOL_NAMES`・`COPILOT_HOOK_TOOL_MATCHER`（Task 3・4 が使う）、`CopilotHookNotice`・`CopilotMainSession`・`CopilotHookParseResult`・`CopilotHookResolution`・`parseCopilotHookRequest`・`resolveCopilotHookNotice`（Task 3 の受け口が使う）。受け口はまだ使わない

- [ ] **Step 1: 失敗するテストを書く（定数とパス）**

`src/main/__tests__/agentHookProtocol.test.ts` の import に `AGENT_HOOK_TOOL_NAMES`・`COPILOT_HOOK_EVENT_NAMES`・`COPILOT_HOOK_TOOL_MATCHER`・`COPILOT_HOOK_TOOL_NAMES`・`copilotHookPathOf`・`isCopilotHookPath` を足し、末尾に次を足す:

```ts
describe('agentHookProtocol(copilot。段階 3b)', () => {
  it('copilot に渡すイベントは 7 つ(claude の 9 つから PostToolBatch・StopFailure を除いたもの)', () => {
    expect(COPILOT_HOOK_EVENT_NAMES).toEqual([
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'SubagentStop',
      'Stop',
      'SessionEnd'
    ])
  })

  it('copilot のパスは /prompt-ide/agent-hooks/copilot/v1/ に claude と同じ最後の段を続け、claude のパスと重ならない', () => {
    expect(copilotHookPathOf('PreToolUse')).toBe('/prompt-ide/agent-hooks/copilot/v1/pre-tool-use')
    expect(copilotHookPathOf('PostToolUseFailure')).toBe(
      '/prompt-ide/agent-hooks/copilot/v1/post-tool-use-failure'
    )
    for (const event of COPILOT_HOOK_EVENT_NAMES) {
      expect(copilotHookPathOf(event)).not.toBe(agentHookPathOf(event))
      expect(agentHookEventOfPath(copilotHookPathOf(event))).toBeNull()
    }
  })

  it('isCopilotHookPath は copilot の経路の前の部分で始まるパスだけ真(一致しないパスも含む)', () => {
    expect(isCopilotHookPath('/prompt-ide/agent-hooks/copilot/v1/stop')).toBe(true)
    expect(isCopilotHookPath('/prompt-ide/agent-hooks/copilot/v1/session-start')).toBe(true)
    expect(isCopilotHookPath('/prompt-ide/agent-hooks/copilot/v1/')).toBe(true)
    expect(isCopilotHookPath(agentHookPathOf('Stop'))).toBe(false)
    expect(isCopilotHookPath('/prompt-ide/agent-hooks/copilot/v2/stop')).toBe(false)
    expect(isCopilotHookPath('/other')).toBe(false)
  })

  it('知っているツールの名前は claude の名前に copilot の名前を足したもの。matcher はその並び', () => {
    expect(COPILOT_HOOK_TOOL_NAMES).toEqual([
      ...AGENT_HOOK_TOOL_NAMES,
      'bash',
      'powershell',
      'apply_patch',
      'create',
      'edit'
    ])
    expect(COPILOT_HOOK_TOOL_MATCHER).toBe(
      'Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|bash|powershell|apply_patch|create|edit'
    )
    // 読むだけのツールとサブエージェントの呼び出しは数えない(claude で Read・Agent を数えないのと同じ)
    for (const name of ['view', 'rg', 'glob', 'task', 'Read', 'Agent']) {
      expect(COPILOT_HOOK_TOOL_NAMES).not.toContain(name)
    }
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（解釈と振り分け）**

`src/main/__tests__/agentCopilotHookEvents.test.ts` を作る:

```ts
import { describe, expect, it } from 'vitest'
import { parseCopilotHookRequest, resolveCopilotHookNotice } from '../agentCopilotHookEvents'
import type {
  CopilotHookNotice,
  CopilotHookParseResult,
  CopilotMainSession
} from '../agentCopilotHookEvents'
import type { AgentHookBody, AgentHookConfirmOnlyReason, AgentHookEvent } from '../agentHookEvents'
import type { CopilotHookEventName } from '../agentHookProtocol'

// copilot の PascalCase の hooks の本文の解釈と、主の会話の ID による振り分け(設計書「入力の解釈と会話の ID の振り分け」)。
// 本文の形は記録(.superpowers/agent-cli-kind/copilot-hooks-recorder/report.md)の PascalCase の形

const MAIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SUB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const KNOWN: CopilotMainSession = Object.freeze({ kind: 'known', id: MAIN })
const AWAITING: CopilotMainSession = Object.freeze({ kind: 'awaiting' })

const json = (value: unknown): AgentHookBody => ({ kind: 'text', text: JSON.stringify(value) })
const parse = (
  event: CopilotHookEventName,
  fields: Record<string, unknown>
): CopilotHookParseResult =>
  parseCopilotHookRequest(event, json({ hook_event_name: event, session_id: MAIN, ...fields }))

describe('parseCopilotHookRequest(7 つのイベント)', () => {
  it.each<[CopilotHookEventName, Record<string, unknown>, CopilotHookNotice]>([
    [
      'UserPromptSubmit',
      { prompt: 'hi', cwd: '/w', transcript_path: '/t' },
      { kind: 'prompt', hookEventName: 'UserPromptSubmit', toolName: null, sessionId: MAIN }
    ],
    [
      'PreToolUse',
      { tool_name: 'Edit', tool_input: { path: '/w/a.txt' } },
      { kind: 'tool-start', hookEventName: 'PreToolUse', toolName: 'Edit', sessionId: MAIN }
    ],
    [
      'PostToolUse',
      { tool_name: 'Write', tool_result: { ok: true } },
      { kind: 'tool-end', hookEventName: 'PostToolUse', toolName: 'Write', sessionId: MAIN }
    ],
    [
      'PostToolUseFailure',
      { tool_name: 'Bash' },
      { kind: 'tool-end', hookEventName: 'PostToolUseFailure', toolName: 'Bash', sessionId: MAIN }
    ],
    ['Stop', {}, { kind: 'stop', hookEventName: 'Stop', toolName: null, sessionId: MAIN }],
    [
      'SubagentStop',
      { agent_id: SUB },
      {
        kind: 'subagent-stop',
        hookEventName: 'SubagentStop',
        toolName: null,
        sessionId: MAIN,
        agentId: SUB
      }
    ],
    [
      'SessionEnd',
      { reason: 'clear' },
      { kind: 'session-end', hookEventName: 'SessionEnd', toolName: null, sessionId: MAIN }
    ]
  ])('%s', (event, fields, expected) => {
    expect(parse(event, fields)).toEqual({ notice: expected, notes: [] })
  })

  it.each([
    'apply_patch',
    'create',
    'edit',
    'bash',
    'powershell',
    'MultiEdit',
    'NotebookEdit',
    'PowerShell'
  ])(
    'copilot の名前・寄せた名前 %s も知っているツールとして扱う(tool-end を閉じる根拠にする)',
    (toolName) => {
      expect(parse('PostToolUse', { tool_name: toolName }).notice.kind).toBe('tool-end')
    }
  )

  it.each<[string, AgentHookBody, string[]]>([
    ['読めない', { kind: 'unreadable' }, ['unreadable-body']],
    ['大きすぎる', { kind: 'too-large' }, []],
    ['JSON でない', { kind: 'text', text: '{' }, ['unreadable-body']],
    ['配列', { kind: 'text', text: '[]' }, ['unreadable-body']]
  ])(
    '本文が %s とき: PreToolUse は session_id なしの tool-start(開く側。L-002)、ほかは copilot-body-unreadable(L-044)',
    (_label, body, notes) => {
      expect(parseCopilotHookRequest('PreToolUse', body)).toEqual({
        notice: {
          kind: 'tool-start',
          hookEventName: 'PreToolUse',
          toolName: null,
          sessionId: null
        },
        notes
      })
      for (const event of [
        'UserPromptSubmit',
        'PostToolUse',
        'PostToolUseFailure',
        'Stop',
        'SubagentStop',
        'SessionEnd'
      ] as const) {
        expect(parseCopilotHookRequest(event, body)).toEqual({
          notice: {
            kind: 'confirm-only',
            reason: 'copilot-body-unreadable',
            hookEventName: event,
            toolName: null,
            sessionId: null
          },
          notes
        })
      }
    }
  )

  it('本文のイベント名がパスと違えば、読めない本文と同じに扱い event-name-mismatch(L-023)', () => {
    expect(
      parseCopilotHookRequest(
        'PostToolUse',
        json({ hook_event_name: 'PreToolUse', session_id: MAIN, tool_name: 'Edit' })
      )
    ).toEqual({
      notice: {
        kind: 'confirm-only',
        reason: 'copilot-body-unreadable',
        hookEventName: 'PostToolUse',
        toolName: null,
        sessionId: null
      },
      notes: ['event-name-mismatch']
    })
    // camelCase の本文(hook_event_name が無い)も同じ
    expect(parseCopilotHookRequest('Stop', json({ sessionId: MAIN })).notes).toEqual([
      'event-name-mismatch'
    ])
  })

  it('知らない tool_name: PreToolUse は開き(unknown-tool-name)、PostToolUse* は unknown-tool-end の confirm-only', () => {
    expect(parse('PreToolUse', { tool_name: 'view' })).toEqual({
      notice: {
        kind: 'tool-start',
        hookEventName: 'PreToolUse',
        toolName: 'view',
        sessionId: MAIN
      },
      notes: ['unknown-tool-name']
    })
    for (const event of ['PostToolUse', 'PostToolUseFailure'] as const) {
      expect(parse(event, { tool_name: 'view' })).toEqual({
        notice: {
          kind: 'confirm-only',
          reason: 'unknown-tool-end',
          hookEventName: event,
          toolName: 'view',
          sessionId: MAIN
        },
        notes: ['unknown-tool-name']
      })
    }
    // 形の違う名前はログに出さない(toolName は null)
    expect(parse('PreToolUse', { tool_name: 'a b' }).notice.toolName).toBeNull()
  })

  it.each<[string, unknown]>([
    ['数', 1],
    ['空文字', ''],
    ['257 文字', 'x'.repeat(257)],
    ['オブジェクト', {}],
    ['無い', undefined]
  ])('session_id が %s なら sessionId は null(読めない。L-044)', (_label, value) => {
    expect(parse('Stop', { session_id: value }).notice.sessionId).toBeNull()
  })

  it('256 文字の session_id は読む', () => {
    expect(parse('Stop', { session_id: 'x'.repeat(256) }).notice.sessionId).toBe('x'.repeat(256))
  })

  it('SubagentStop の agent_id が無ければ subagent-stop-without-agent、形が違えば bad-agent-id の confirm-only', () => {
    expect(parse('SubagentStop', {}).notice).toEqual({
      kind: 'confirm-only',
      reason: 'subagent-stop-without-agent',
      hookEventName: 'SubagentStop',
      toolName: null,
      sessionId: MAIN
    })
    expect(parse('SubagentStop', { agent_id: 3 })).toEqual({
      notice: {
        kind: 'confirm-only',
        reason: 'bad-agent-id',
        hookEventName: 'SubagentStop',
        toolName: null,
        sessionId: MAIN
      },
      notes: ['bad-agent-id']
    })
  })
})

const prompt = (sessionId: string | null): CopilotHookNotice => ({
  kind: 'prompt',
  hookEventName: 'UserPromptSubmit',
  toolName: null,
  sessionId
})
const pre = (sessionId: string | null): CopilotHookNotice => ({
  kind: 'tool-start',
  hookEventName: 'PreToolUse',
  toolName: 'Edit',
  sessionId
})
const post = (sessionId: string | null): CopilotHookNotice => ({
  kind: 'tool-end',
  hookEventName: 'PostToolUse',
  toolName: 'Edit',
  sessionId
})
const stop = (sessionId: string | null): CopilotHookNotice => ({
  kind: 'stop',
  hookEventName: 'Stop',
  toolName: null,
  sessionId
})
const end = (sessionId: string | null): CopilotHookNotice => ({
  kind: 'session-end',
  hookEventName: 'SessionEnd',
  toolName: null,
  sessionId
})
const subagentStopOf = (agentId: string, sessionId: string | null = MAIN): CopilotHookNotice => ({
  kind: 'subagent-stop',
  hookEventName: 'SubagentStop',
  toolName: null,
  sessionId,
  agentId
})

const confirmEvent = (
  notice: CopilotHookNotice,
  reason: AgentHookConfirmOnlyReason
): AgentHookEvent => ({
  kind: 'confirm-only',
  reason,
  hookEventName: notice.hookEventName,
  toolName: notice.toolName
})
const idlessEvent = (
  kind: 'tool-start' | 'tool-end',
  hookEventName: 'PreToolUse' | 'PostToolUse',
  group: string | null
): AgentHookEvent => ({
  kind,
  hookEventName,
  toolName: 'Edit',
  toolId: { kind: 'none' },
  agentId: group
})
const TURN_END: AgentHookEvent = { kind: 'turn-end', hookEventName: 'Stop', toolName: null }
const SESSION_END: AgentHookEvent = {
  kind: 'session-end',
  hookEventName: 'SessionEnd',
  toolName: null
}

describe('resolveCopilotHookNotice(振り分けの表の全部のマス)', () => {
  it.each<[string, CopilotMainSession, CopilotHookNotice, AgentHookEvent, CopilotMainSession]>([
    // (3) 主の ID と同じ
    ['主: prompt', KNOWN, prompt(MAIN), confirmEvent(prompt(MAIN), 'prompt-submit'), KNOWN],
    ['主: tool-start', KNOWN, pre(MAIN), idlessEvent('tool-start', 'PreToolUse', null), KNOWN],
    ['主: tool-end', KNOWN, post(MAIN), idlessEvent('tool-end', 'PostToolUse', null), KNOWN],
    ['主: stop', KNOWN, stop(MAIN), TURN_END, KNOWN],
    ['主: session-end', KNOWN, end(MAIN), SESSION_END, AWAITING],
    // (3) 主の ID と違う(サブエージェント)
    ['サブ: prompt', KNOWN, prompt(SUB), confirmEvent(prompt(SUB), 'subagent-prompt'), KNOWN],
    ['サブ: tool-start', KNOWN, pre(SUB), idlessEvent('tool-start', 'PreToolUse', SUB), KNOWN],
    ['サブ: tool-end', KNOWN, post(SUB), idlessEvent('tool-end', 'PostToolUse', SUB), KNOWN],
    [
      'サブ: stop',
      KNOWN,
      stop(SUB),
      { kind: 'subagent-stop', hookEventName: 'Stop', toolName: null, agentId: SUB },
      KNOWN
    ],
    ['サブ: session-end', KNOWN, end(SUB), confirmEvent(end(SUB), 'other-session-end'), KNOWN],
    // (1) session_id を読めない(状態にかかわらず。状態は変えない)
    ...[KNOWN, AWAITING].flatMap(
      (
        main
      ): [string, CopilotMainSession, CopilotHookNotice, AgentHookEvent, CopilotMainSession][] => [
        [
          `読めない(${main.kind}): prompt`,
          main,
          prompt(null),
          confirmEvent(prompt(null), 'session-id-unreadable'),
          main
        ],
        [
          `読めない(${main.kind}): tool-start`,
          main,
          pre(null),
          idlessEvent('tool-start', 'PreToolUse', null),
          main
        ],
        [
          `読めない(${main.kind}): tool-end`,
          main,
          post(null),
          confirmEvent(post(null), 'session-id-unreadable'),
          main
        ],
        [
          `読めない(${main.kind}): stop`,
          main,
          stop(null),
          confirmEvent(stop(null), 'session-id-unreadable'),
          main
        ],
        [
          `読めない(${main.kind}): session-end`,
          main,
          end(null),
          confirmEvent(end(null), 'session-id-unreadable'),
          main
        ]
      ]
    ),
    // (2) 読めて、状態が awaiting
    [
      'awaiting: prompt',
      AWAITING,
      prompt(NEW),
      confirmEvent(prompt(NEW), 'prompt-submit'),
      { kind: 'known', id: NEW }
    ],
    [
      'awaiting: tool-start',
      AWAITING,
      pre(NEW),
      idlessEvent('tool-start', 'PreToolUse', null),
      AWAITING
    ],
    [
      'awaiting: tool-end',
      AWAITING,
      post(NEW),
      idlessEvent('tool-end', 'PostToolUse', null),
      AWAITING
    ],
    [
      'awaiting: stop',
      AWAITING,
      stop(NEW),
      confirmEvent(stop(NEW), 'stop-while-awaiting'),
      AWAITING
    ],
    [
      'awaiting: session-end',
      AWAITING,
      end(NEW),
      confirmEvent(end(NEW), 'other-session-end'),
      AWAITING
    ]
  ])('%s', (_label, main, notice, event, nextMain) => {
    expect(resolveCopilotHookNotice(main, notice)).toEqual({ event, main: nextMain })
  })

  it('SubagentStop は agent_id で決まる: known で主と違えば subagent-stop、主と同じ・awaiting は subagent-stop-unmatched(session_id は見ない)', () => {
    expect(resolveCopilotHookNotice(KNOWN, subagentStopOf(SUB))).toEqual({
      event: { kind: 'subagent-stop', hookEventName: 'SubagentStop', toolName: null, agentId: SUB },
      main: KNOWN
    })
    expect(resolveCopilotHookNotice(KNOWN, subagentStopOf(SUB, null)).event.kind).toBe(
      'subagent-stop'
    )
    expect(resolveCopilotHookNotice(KNOWN, subagentStopOf(MAIN))).toEqual({
      event: confirmEvent(subagentStopOf(MAIN), 'subagent-stop-unmatched'),
      main: KNOWN
    })
    expect(resolveCopilotHookNotice(AWAITING, subagentStopOf(SUB))).toEqual({
      event: confirmEvent(subagentStopOf(SUB), 'subagent-stop-unmatched'),
      main: AWAITING
    })
  })

  it('解釈の confirm-only は、理由とツールの名前をそのまま渡し、状態を変えない', () => {
    const notice: CopilotHookNotice = {
      kind: 'confirm-only',
      reason: 'unknown-tool-end',
      hookEventName: 'PostToolUse',
      toolName: 'view',
      sessionId: MAIN
    }
    for (const main of [KNOWN, AWAITING]) {
      expect(resolveCopilotHookNotice(main, notice)).toEqual({
        event: confirmEvent(notice, 'unknown-tool-end'),
        main
      })
    }
  })
})

describe('resolveCopilotHookNotice(流れ)', () => {
  /** 知らせを順に振り分け、各結果の知らせと最後の状態を返す */
  function flow(
    start: CopilotMainSession,
    notices: CopilotHookNotice[]
  ): { events: AgentHookEvent[]; main: CopilotMainSession } {
    let main = start
    const events: AgentHookEvent[] = []
    for (const notice of notices) {
      const resolved = resolveCopilotHookNotice(main, notice)
      events.push(resolved.event)
      main = resolved.main
    }
    return { events, main }
  }

  it('/clear(記録 91): 主の SessionEnd → 新しい ID の prompt で採り直し → その ID の tool-start は主のグループ、Stop は turn-end', () => {
    const { events, main } = flow(KNOWN, [end(MAIN), prompt(NEW), pre(NEW), stop(NEW)])
    expect(events).toEqual([
      SESSION_END,
      confirmEvent(prompt(NEW), 'prompt-submit'),
      idlessEvent('tool-start', 'PreToolUse', null),
      TURN_END
    ])
    expect(main).toEqual({ kind: 'known', id: NEW })
  })

  it('--resume(記録 92): 再開した ID で known のまま、直後の別の ID の SessionEnd は other-session-end で状態を変えない', () => {
    const { events, main } = flow(KNOWN, [end(NEW), pre(MAIN), stop(MAIN)])
    expect(events).toEqual([
      confirmEvent(end(NEW), 'other-session-end'),
      idlessEvent('tool-start', 'PreToolUse', null),
      TURN_END
    ])
    expect(main).toBe(KNOWN)
  })

  it('列を選ぶ順の重なり: awaiting で session_id を読めない prompt・tool-end は「読めない」の列になり、awaiting のまま', () => {
    const { events, main } = flow(AWAITING, [prompt(null), post(null)])
    expect(events).toEqual([
      confirmEvent(prompt(null), 'session-id-unreadable'),
      confirmEvent(post(null), 'session-id-unreadable')
    ])
    expect(main).toEqual(AWAITING)
  })

  it('サブエージェント(記録 70): 中の prompt は主に触れず、中の Stop はそのグループの subagent-stop、親の SubagentStop も同じ ID', () => {
    const { events } = flow(KNOWN, [
      prompt(SUB),
      pre(SUB),
      post(SUB),
      stop(SUB),
      subagentStopOf(SUB),
      stop(MAIN)
    ])
    expect(events.map((event) => event.kind)).toEqual([
      'confirm-only',
      'tool-start',
      'tool-end',
      'subagent-stop',
      'subagent-stop',
      'turn-end'
    ])
  })
})
```

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentHookProtocol.test.ts src/main/__tests__/agentCopilotHookEvents.test.ts`
Expected: FAIL（`COPILOT_HOOK_EVENT_NAMES` などが export されていない・`../agentCopilotHookEvents` が無い）

- [ ] **Step 4: copilot の定数とパスを足す（`src/main/agentHookProtocol.ts`）**

冒頭のコメントを `// claude・copilot の hooks の受け取りの取り決め(設計書「受け口」「設定のファイル」「渡す hooks」、段階 3b の設計書「渡す hooks」)。…`（残りは今のまま）にし、`agentHookEventOfPath` の後に次を足す:

```ts
/** copilot に渡す 7 つのイベント(PascalCase。claude の 9 つから、copilot に当たるものが無い PostToolBatch・StopFailure を除いたもの) */
export type CopilotHookEventName = Exclude<AgentHookEventName, 'PostToolBatch' | 'StopFailure'>

/** copilot の hooks の設定に書く順 */
export const COPILOT_HOOK_EVENT_NAMES: readonly CopilotHookEventName[] = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStop',
  'Stop',
  'SessionEnd'
]

/** copilot 向けのパスの前の部分。最後の段は claude と同じ表を使い、claude のパスと重ならない */
const COPILOT_HOOK_PATH_PREFIX = '/prompt-ide/agent-hooks/copilot/v1/'

export function copilotHookPathOf(event: CopilotHookEventName): string {
  return COPILOT_HOOK_PATH_PREFIX + AGENT_HOOK_EVENT_PATH_SEGMENTS[event]
}

/**
 * 要求のパスが copilot の経路(前の部分)で始まるか。7 つに一致しないパスも copilot の経路の不明なパスとして扱う
 * (copilot は preToolUse の 4xx・5xx をツールの拒否にするため、受け口は copilot の経路には常に 200 を返す)
 */
export function isCopilotHookPath(path: string): boolean {
  return path.startsWith(COPILOT_HOOK_PATH_PREFIX)
}
```

`AGENT_HOOK_TOOL_MATCHER` の後に次を足す:

```ts
/**
 * copilot で区間を数えるツール。PascalCase の入力では Edit・Write・Bash に寄せられるが(1.0.62 から)、copilot の名前
 * (apply_patch・create・edit・bash、記録していない Windows の powershell)も並べる(並べた名前が増えるだけで害は無い)。
 * 読むだけのツール(view・rg・glob)とサブエージェントの呼び出し(task)は数えない(claude で Read・Agent を数えないのと同じ)
 */
export const COPILOT_HOOK_TOOL_NAMES: readonly string[] = [
  ...AGENT_HOOK_TOOL_NAMES,
  'bash',
  'powershell',
  'apply_patch',
  'create',
  'edit'
]

/** copilot の matcher(記録の 80 で確かめた、名前を | で並べた形) */
export const COPILOT_HOOK_TOOL_MATCHER = COPILOT_HOOK_TOOL_NAMES.join('|')
```

- [ ] **Step 5: 本文の読み方の補助を export する（`src/main/agentHookEvents.ts`）**

名前を変えて export する（中身・呼び出しの意味は変えない）。ASCII の識別子だけなので `perl` で置き換えてから、`export` を足す:

```bash
cd <repo-root>
perl -pi -e 's/\breadBody\b/readAgentHookBodyObject/g; s/\bisId\b/isAgentHookId/g; s/\breadAgentId\b/readAgentHookAgentId/g; s/\bTOOL_NAME_PATTERN\b/AGENT_HOOK_TOOL_NAME_PATTERN/g; s/\bAgentIdRead\b/AgentHookAgentIdRead/g' src/main/agentHookEvents.ts
grep -n -E "readAgentHookBodyObject|isAgentHookId|readAgentHookAgentId|AGENT_HOOK_TOOL_NAME_PATTERN|AgentHookAgentIdRead" src/main/agentHookEvents.ts
```

続けて、定義の行に `export` を付け、短いコメントを足す:

```ts
/** ツールの名前の形(ログに出してよい名前) */
export const AGENT_HOOK_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export type AgentHookAgentIdRead = { kind: 'absent' } | { kind: 'read'; id: string } | { kind: 'bad' }

/** 1〜256 文字の文字列だけを ID として読む(L-044) */
export const isAgentHookId = (value: unknown): value is string => …(今のまま)

export function readAgentHookAgentId(body: Record<string, unknown>): AgentHookAgentIdRead { …(今のまま) }

/** 本文を JSON のオブジェクトとして読み、hook_event_name をパスのイベントと照らし合わせる(L-023)。copilot の解釈も同じ規則で読む */
export function readAgentHookBodyObject(
  pathEvent: AgentHookEventName,
  body: AgentHookBody
): { value: Record<string, unknown> | null; notes: AgentHookParseNote[] } { …(今のまま) }
```

- [ ] **Step 6: 解釈と振り分けを実装する（`src/main/agentCopilotHookEvents.ts`）**

```ts
import { COPILOT_HOOK_TOOL_NAMES } from './agentHookProtocol'
import type { CopilotHookEventName } from './agentHookProtocol'
import {
  AGENT_HOOK_TOOL_NAME_PATTERN,
  isAgentHookId,
  readAgentHookAgentId,
  readAgentHookBodyObject
} from './agentHookEvents'
import type {
  AgentHookBody,
  AgentHookConfirmOnlyReason,
  AgentHookEvent,
  AgentHookParseNote
} from './agentHookEvents'

// copilot の PascalCase の hooks の本文の解釈と、主の会話の ID による振り分け(設計書 2026-10-26「入力の解釈と会話の ID の振り分け」。
// 純粋な関数)。本文の読み方(16 MiB の上限・JSON のオブジェクト・hook_event_name とパスのイベントの照らし合わせ)は claude と同じ。
// 使う欄は hook_event_name・session_id・tool_name・agent_id(SubagentStop だけ)で、tool_input・cwd・transcript_path・prompt・
// tool_result は読まない(区別は区間と判定の区切りの git の差分で行う。L-019)。copilot にはツールの呼び出しの ID が無いので、
// 区間は会話のグループ(AgentHookEvent の agentId。null は主)ごとの「ID を持たない区間」(toolId: none)として渡す。
// 主の会話の ID の状態は受け口のトークンの持ち主が持ち、受け口は本文を読み終えた後に await を挟まずに「状態を読む → 振り分け →
// 状態を書く → deliver」を行う

/** 解釈の結果。どれも読めた session_id(無い・形が違えば null)を持つ */
export type CopilotHookNotice = {
  hookEventName: CopilotHookEventName
  /** 検証済みのツールの名前(ツール以外のイベント・形の違う名前は null。ログにだけ使う) */
  toolName: string | null
  sessionId: string | null
} & (
  | { kind: 'prompt' }
  | { kind: 'tool-start' }
  | { kind: 'tool-end' }
  | { kind: 'stop' }
  /** 親の SubagentStop(本文の agent_id を読めたときだけ) */
  | { kind: 'subagent-stop'; agentId: string }
  | { kind: 'session-end' }
  | { kind: 'confirm-only'; reason: AgentHookConfirmOnlyReason }
)

export interface CopilotHookParseResult {
  notice: CopilotHookNotice
  notes: AgentHookParseNote[]
}

/**
 * タブの主の会話の ID。初めは起動に使った会話の ID(--session-id・--resume= に渡した小文字の UUID)で known。主の ID の
 * SessionEnd(/clear・copilot の中の /new・/resume)で awaiting になり、次の主のプロンプトの ID を採る(追跡の中だけ)
 */
export type CopilotMainSession = { kind: 'known'; id: string } | { kind: 'awaiting' }

export interface CopilotHookResolution {
  /** 追跡に渡す知らせ */
  event: AgentHookEvent
  /** 次の状態(変わらなければ渡した値) */
  main: CopilotMainSession
}

/** 本文を読めないときの結果。PreToolUse は区間を開く側に倒し(L-002)、ほかは区間を閉じる根拠にしない(L-044) */
function noticeWithoutBody(event: CopilotHookEventName): CopilotHookNotice {
  const base = { hookEventName: event, toolName: null, sessionId: null }
  return event === 'PreToolUse'
    ? { ...base, kind: 'tool-start' }
    : { ...base, kind: 'confirm-only', reason: 'copilot-body-unreadable' }
}

export function parseCopilotHookRequest(
  event: CopilotHookEventName,
  body: AgentHookBody
): CopilotHookParseResult {
  const { value, notes } = readAgentHookBodyObject(event, body)
  if (value === null) return { notice: noticeWithoutBody(event), notes }
  const sessionId = isAgentHookId(value.session_id) ? value.session_id : null
  const base = { hookEventName: event, toolName: null, sessionId }
  switch (event) {
    case 'UserPromptSubmit':
      return { notice: { ...base, kind: 'prompt' }, notes: [] }
    case 'Stop':
      return { notice: { ...base, kind: 'stop' }, notes: [] }
    case 'SessionEnd':
      return { notice: { ...base, kind: 'session-end' }, notes: [] }
    case 'SubagentStop': {
      const agent = readAgentHookAgentId(value)
      if (agent.kind === 'absent') {
        return {
          notice: { ...base, kind: 'confirm-only', reason: 'subagent-stop-without-agent' },
          notes: []
        }
      }
      if (agent.kind === 'bad') {
        return {
          notice: { ...base, kind: 'confirm-only', reason: 'bad-agent-id' },
          notes: ['bad-agent-id']
        }
      }
      return { notice: { ...base, kind: 'subagent-stop', agentId: agent.id }, notes: [] }
    }
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const rawToolName = value.tool_name
      const toolName =
        typeof rawToolName === 'string' && AGENT_HOOK_TOOL_NAME_PATTERN.test(rawToolName)
          ? rawToolName
          : null
      const known = typeof rawToolName === 'string' && COPILOT_HOOK_TOOL_NAMES.includes(rawToolName)
      const toolBase = { ...base, toolName }
      // 知らない名前でも区間を開く(捨てると、そのツールの書き込みが利用者の区間に入る。L-002)
      if (event === 'PreToolUse') {
        return {
          notice: { ...toolBase, kind: 'tool-start' },
          notes: known ? [] : ['unknown-tool-name']
        }
      }
      // 区間を閉じる知らせは、知らない名前を根拠にしない(L-044)
      if (!known) {
        return {
          notice: { ...toolBase, kind: 'confirm-only', reason: 'unknown-tool-end' },
          notes: ['unknown-tool-name']
        }
      }
      return { notice: { ...toolBase, kind: 'tool-end' }, notes: [] }
    }
  }
}

/** 振り分けの表の列で決める知らせ */
type ColumnNotice = Extract<
  CopilotHookNotice,
  { kind: 'prompt' | 'tool-start' | 'tool-end' | 'stop' | 'session-end' }
>

const confirmOnlyEvent = (
  notice: CopilotHookNotice,
  reason: AgentHookConfirmOnlyReason
): AgentHookEvent => ({
  hookEventName: notice.hookEventName,
  toolName: notice.toolName,
  kind: 'confirm-only',
  reason
})

/** ID を持たない区間の知らせ(group は null が主、文字列はサブエージェントの会話の ID) */
const idlessEvent = (
  notice: CopilotHookNotice,
  kind: 'tool-start' | 'tool-end',
  group: string | null
): AgentHookEvent => ({
  hookEventName: notice.hookEventName,
  toolName: notice.toolName,
  kind,
  toolId: { kind: 'none' },
  agentId: group
})

/** (1) session_id を読めない: 状態にかかわらず。tool-start だけは主のグループで開く(L-002)、ほかは閉じる根拠にしない(L-044) */
function unreadableColumnEvent(notice: ColumnNotice): AgentHookEvent {
  switch (notice.kind) {
    case 'tool-start':
      return idlessEvent(notice, 'tool-start', null)
    case 'prompt':
    case 'tool-end':
    case 'stop':
    case 'session-end':
      return confirmOnlyEvent(notice, 'session-id-unreadable')
  }
}

/** (2) 読めて、状態が awaiting: 主のプロンプトでその ID を主にする。ツールは主のグループで数える */
function resolveAwaiting(
  main: CopilotMainSession,
  notice: ColumnNotice,
  sessionId: string
): CopilotHookResolution {
  switch (notice.kind) {
    case 'prompt':
      return {
        event: confirmOnlyEvent(notice, 'prompt-submit'),
        main: { kind: 'known', id: sessionId }
      }
    case 'tool-start':
      return { event: idlessEvent(notice, 'tool-start', null), main }
    case 'tool-end':
      return { event: idlessEvent(notice, 'tool-end', null), main }
    case 'stop':
      return { event: confirmOnlyEvent(notice, 'stop-while-awaiting'), main }
    case 'session-end':
      return { event: confirmOnlyEvent(notice, 'other-session-end'), main }
  }
}

/** (3) 読めて、状態が known: 主の ID と同じなら主、違えばその ID のサブエージェント */
function resolveKnown(
  main: Extract<CopilotMainSession, { kind: 'known' }>,
  notice: ColumnNotice,
  sessionId: string
): CopilotHookResolution {
  const isMain = sessionId === main.id
  const group = isMain ? null : sessionId
  const base = { hookEventName: notice.hookEventName, toolName: notice.toolName }
  switch (notice.kind) {
    case 'prompt':
      return { event: confirmOnlyEvent(notice, isMain ? 'prompt-submit' : 'subagent-prompt'), main }
    case 'tool-start':
      return { event: idlessEvent(notice, 'tool-start', group), main }
    case 'tool-end':
      return { event: idlessEvent(notice, 'tool-end', group), main }
    case 'stop':
      // サブエージェントの中の Stop はそのグループを閉じるだけで、親のターンの終わりにしない
      return {
        event: isMain
          ? { ...base, kind: 'turn-end' }
          : { ...base, kind: 'subagent-stop', agentId: sessionId },
        main
      }
    case 'session-end':
      // 主の SessionEnd(/clear など)で主の ID を待つ。別の ID(--resume の直後など)は区間・状態に触れない
      return isMain
        ? { event: { ...base, kind: 'session-end' }, main: { kind: 'awaiting' } }
        : { event: confirmOnlyEvent(notice, 'other-session-end'), main }
  }
}

/**
 * 解釈の結果を主の会話の ID の状態で振り分ける。列を選ぶ順は (1) session_id を読めない → (2) 状態が awaiting → (3) 状態が known
 * (主の ID と同じか)。SubagentStop は本文の agent_id で決まり、session_id と状態を見ない。解釈の confirm-only はそのまま渡す
 */
export function resolveCopilotHookNotice(
  main: CopilotMainSession,
  notice: CopilotHookNotice
): CopilotHookResolution {
  if (notice.kind === 'confirm-only') {
    return { event: confirmOnlyEvent(notice, notice.reason), main }
  }
  if (notice.kind === 'subagent-stop') {
    if (main.kind === 'known' && notice.agentId !== main.id) {
      return {
        event: {
          hookEventName: notice.hookEventName,
          toolName: notice.toolName,
          kind: 'subagent-stop',
          agentId: notice.agentId
        },
        main
      }
    }
    return { event: confirmOnlyEvent(notice, 'subagent-stop-unmatched'), main }
  }
  const sessionId = notice.sessionId
  if (sessionId === null) return { event: unreadableColumnEvent(notice), main }
  if (main.kind === 'awaiting') return resolveAwaiting(main, notice, sessionId)
  return resolveKnown(main, notice, sessionId)
}
```

- [ ] **Step 7: テストと型検査が通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentHookProtocol.test.ts src/main/__tests__/agentCopilotHookEvents.test.ts src/main/__tests__/agentHookEvents.test.ts`
Expected: PASS（`agentHookEvents.test.ts` の既存のテストも変えずに通る）
Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 8: 実装を外すとテストが落ちることを確かめる（手で外して手で戻す）**

1. `resolveCopilotHookNotice` の `if (sessionId === null) return { event: unreadableColumnEvent(notice), main }` を `if (sessionId === null && main.kind === 'known') …` にする（列を選ぶ順を崩す。型検査は落ちるが vitest は流れる）→ `awaiting` で読めない行（「読めない(awaiting): …」と「列を選ぶ順の重なり」）が落ちる → 手で戻す
2. `subagent-stop` の `&& notice.agentId !== main.id` を消す → SubagentStop のテストが落ちる → 手で戻す
3. `resolveKnown` の `stop` を常に `turn-end` にする → 「サブ: stop」と「サブエージェント(記録 70)」が落ちる → 手で戻す
4. `noticeWithoutBody` の `event === 'PreToolUse'` を `false` にする → 「本文が … とき」が落ちる → 手で戻す
5. `parseCopilotHookRequest` の `COPILOT_HOOK_TOOL_NAMES.includes` を `AGENT_HOOK_TOOL_NAMES.includes`（import を一時的に足す）にする → 「copilot の名前・寄せた名前 apply_patch …」が落ちる → 手で戻す（import も消す）

戻した後に `git diff src/main/agentCopilotHookEvents.ts`（新規なので `git status` で未追跡のまま。`grep -n "sessionId === null) return\|notice.agentId !== main.id\|event === 'PreToolUse'\|COPILOT_HOOK_TOOL_NAMES.includes" src/main/agentCopilotHookEvents.ts` で 4 か所が Step 6 の形であること）を確かめ、Step 7 のコマンドで通ることを確かめ直す。

- [ ] **Step 9: 全体の検証**

```bash
cd <repo-root>
npx vitest run
npm run typecheck
set -- src/main/agentHookProtocol.ts src/main/agentHookEvents.ts src/main/agentCopilotHookEvents.ts src/main/__tests__/agentHookProtocol.test.ts src/main/__tests__/agentCopilotHookEvents.test.ts
npx prettier --write "$@"
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
```

Expected: すべて通る

- [ ] **Step 10: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 3: 受け口の経路・持ち主の種類・応答の規則

> **設計書の読む節:** 「受け口」（経路・応答の規則の表・ログ・終了の順序）、「入力の解釈と会話の ID の振り分け」の「振り分け」の 1 段落目（await を挟まない順）、「claude への影響と互換性」、「実装の分割」の 3（直す既存のテストの一覧）、「テスト方針」の `agentHookReceiver.test.ts`。
>
> **気をつける知見:** L-609（`AgentHookOwner` の `cli`・`activate` の会話の ID・`PreparedAgentHooks.cliKind` を、作る箇所とテストの値・偽物と同じタスクで直す）・L-017（`copilot` の経路で拒んだ要求も、本文・トークンをログ・応答に出さない。200 は何の情報も返さない）・L-435（閉じた後に残った接続の要求は渡さない。`copilot` の経路では 200 で返す）・L-060（持ち主の CLI の種類は種類をキーにした表で作り、`activate` の会話の ID は省略できない）・L-018（主の会話の ID は起動に使った ID から始める）・L-023（経路の種類と持ち主の種類が違えば照合の失敗にする）。この時点の `copilot` は `prepare` が `cli-unsupported` のまま（トークンを足さない）なので、アプリの挙動は変わらない。

**Files:**

- Modify: `src/main/agentHookProtocol.ts`（`AgentHookRoute`・`agentHookRouteOfPath`。`agentHookEventOfPath` は残す）
- Modify: `src/main/agentHookReceiverRequest.ts`（`AgentHookOwnerCli`・`AgentHookOwner.cli`・`checkAgentHookRequest` の結果の `route`・`copilot` の経路の 200）
- Modify: `src/main/agentHookReceiver.ts`（経路ごとの解釈と振り分け・`copilot` の経路の応答・ログのラベル）
- Modify: `src/main/agentHookSessions.ts`（`PreparedAgentHooks.cliKind`・`activate(prepared, sessionId, cliSessionId)`・持ち主の CLI の表）
- Modify: `src/main/agentSessionStarter.ts`（`activate` に会話の ID を渡す）
- Modify: `src/main/__tests__/helpers/fakeAgentHookSessions.ts`（`prepared` の関数に計画を渡し、`cliKind` を入れる）
- Test（直す既存のテスト。2026-10-26 の計画の時点に `addToken`・`AgentHookOwner`・`checkAgentHookRequest`・`.activate(`・`unavailableReason:`・`hooks: {` で grep し直した結果。行番号はその時点のもの）:
  - `AgentHookOwner` の `cli`: `src/main/__tests__/agentHookReceiver.test.ts` 77・270 行（`addToken`）、`src/main/__tests__/agentHookReceiverRequest.test.ts` 13 行（`OWNER`）と 34 行（`accepted` の結果の `toEqual` を `route` に）
  - `activate` の 3 つ目の引数（会話の ID）: `src/main/__tests__/agentHookSessions.test.ts` 154・159・168・203 行、`src/main/__tests__/agentHooks.integration.test.ts` 83・162・163 行、`src/main/__tests__/agentSessionStarter.test.ts` 879・894 行（`toHaveBeenCalledExactlyOnceWith` に会話の ID を足す）。`helpers/fakeAgentHookSessions.ts` 28 行の偽物は引数を足しても型は合う（記録の文字列 `activate:<sid>` は変えないので、starter の 883・1207・1211 行は変えない）。`src/main/__tests__/agentHooksRuntime.test.ts` 44 行の `vi.fn()` は変えない
  - `PreparedAgentHooks.cliKind`（値を作るすべての箇所）: `agentHookSessions.test.ts` 69〜73 行（`WITH_HOOKS`）・104〜108・127〜131・142〜146・169・194・203 行、`agentHooks.integration.test.ts` 164 行、`agentSessionStarter.test.ts` 843〜847 行（`PREPARED`）・857・895・910・1216〜1220 行、`helpers/fakeAgentHookSessions.ts` 14〜16 行（`preparedWithoutHooks`）
- Test（足す）: `src/main/__tests__/agentHookProtocol.test.ts`（経路）・`agentHookReceiverRequest.test.ts`・`agentHookReceiver.test.ts`・`agentHookSessions.test.ts`・`agentSessionStarter.test.ts`

**Interfaces:**

- Consumes: Task 2 の `CopilotHookEventName`・`COPILOT_HOOK_EVENT_NAMES`・`copilotHookPathOf`・`isCopilotHookPath`・`CopilotMainSession`・`parseCopilotHookRequest`・`resolveCopilotHookNotice`
- Produces: `AgentHookRoute`・`agentHookRouteOfPath`、`AgentHookOwnerCli`・`AgentHookOwner = { ownerId; sessionId; cli }`、`PreparedAgentHooks` の `cliKind`、`AgentHookSessions.activate(prepared, sessionId, cliSessionId: string | null)`。Task 5 の `prepare` がトークンを足すと、この経路で `copilot` の知らせが追跡に届く

- [ ] **Step 1: 既存のテストの値を新しい形に直す（型の変更の準備）**

次のとおり直す（テストの意味は変えない）:

1. `src/main/__tests__/agentHookReceiverRequest.test.ts` 13 行: `const OWNER: AgentHookOwner = { ownerId: 1, sessionId: 's1', cli: { kind: 'claude' } }`。34〜38 行の期待を `{ kind: 'accepted', route: { cliKind: 'claude', event: 'PreToolUse' }, owner: OWNER }` にする
2. `src/main/__tests__/agentHookReceiver.test.ts` 77 行: `receiver.addToken(TOKEN, { ownerId: 7, sessionId: 'sid-1', cli: { kind: 'claude' } })`。270 行: `receiver?.addToken(OTHER_TOKEN, { ownerId: 8, sessionId: 'sid-2', cli: { kind: 'claude' } })`
3. `src/main/__tests__/helpers/fakeAgentHookSessions.ts`: 次の形にする（`prepared` は計画も受け取る）

```ts
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { AgentHookSessions, PreparedAgentHooks } from '../../agentHookSessions'
import type { AgentLaunchPlan } from '../../agentCommand'

// starter・handler のテスト用の偽の hooks。呼ばれた順を calls に記録する。既定は hooks なし(今までどおりの引数)で起動する

export interface FakeAgentHookSessions {
  prepare: Mock<AgentHookSessions['prepare']>
  activate: Mock<AgentHookSessions['activate']>
  release: Mock<AgentHookSessions['release']>
  calls: string[]
}

/** hooks なしの準備の結果(種類は起動の計画の種類) */
export function preparedWithoutHooks(ownerId: number, plan: AgentLaunchPlan): PreparedAgentHooks {
  return {
    ownerId,
    cliKind: plan.cliKind,
    hooks: null,
    unavailableReason: 'claude-version-unsupported'
  }
}

export function makeFakeAgentHookSessions(
  prepared: (ownerId: number, plan: AgentLaunchPlan) => PreparedAgentHooks = preparedWithoutHooks
): FakeAgentHookSessions {
  const calls: string[] = []
  return {
    calls,
    prepare: vi.fn<AgentHookSessions['prepare']>(async (ownerId, plan) => {
      calls.push('prepare')
      return prepared(ownerId, plan)
    }),
    activate: vi.fn<AgentHookSessions['activate']>((_prepared, sessionId) => {
      calls.push(`activate:${sessionId}`)
    }),
    release: vi.fn<AgentHookSessions['release']>((_prepared, sessionId) => {
      calls.push(`release:${sessionId ?? 'null'}`)
    })
  }
}
```

4. `src/main/__tests__/agentHookSessions.test.ts`: `PreparedAgentHooks` の値と期待にすべて `cliKind` を足す（`WITH_HOOKS`・版の確認の失敗・受け口の失敗は `cliKind: 'claude'`、142〜146 行の `cli-unsupported` は `cliKind: 'copilot'`、169・194・203 行の値は `cliKind: 'claude'`）。`activate` の呼び出し（154・159・168・203 行）に 3 つ目の引数 `CLAUDE_SESSION_ID`（ファイルの冒頭に `const CLAUDE_SESSION_ID = '11111111-1111-4111-8111-111111111111'` を足す）を渡し、160〜163 行の期待を `{ ownerId: 7, sessionId: 'sid-1', cli: { kind: 'claude' } }` にする
5. `src/main/__tests__/agentHooks.integration.test.ts`: 83・162 行の `activate` に 3 つ目の引数 `'11111111-1111-4111-8111-111111111111'` を、163〜166 行の値に `cliKind: 'claude'` と 3 つ目の引数 `null` を足す
6. `src/main/__tests__/agentSessionStarter.test.ts`: 843〜847 行の `PREPARED` に `cliKind: 'claude'`、857 行の戻り値に `cliKind: 'claude'`、894〜897 行と 909〜912 行の期待の値に `cliKind: 'claude'`、1216〜1220 行の戻り値に `cliKind: 'copilot'` を足す。879 行を `expect(hooks.activate).toHaveBeenCalledExactlyOnceWith(PREPARED, 'sid-1', NEW_IDS[0])`、894 行の期待に 3 つ目の引数 `NEW_IDS[0]` を足す

- [ ] **Step 2: 失敗するテストを書く（経路・照合・持ち主）**

`src/main/__tests__/agentHookProtocol.test.ts` の import に `agentHookRouteOfPath` を足し、末尾に足す:

```ts
describe('agentHookRouteOfPath(段階 3b)', () => {
  it('claude の 9 つのパスは claude の経路、copilot の 7 つのパスは copilot の経路', () => {
    for (const event of AGENT_HOOK_EVENT_NAMES) {
      expect(agentHookRouteOfPath(agentHookPathOf(event))).toEqual({ cliKind: 'claude', event })
    }
    for (const event of COPILOT_HOOK_EVENT_NAMES) {
      expect(agentHookRouteOfPath(copilotHookPathOf(event))).toEqual({ cliKind: 'copilot', event })
    }
  })

  it('どれにも完全一致しないパスは null(copilot の前の部分で始まるパス・クエリ付きを含む)', () => {
    expect(agentHookRouteOfPath('/prompt-ide/agent-hooks/copilot/v1/post-tool-batch')).toBeNull()
    expect(agentHookRouteOfPath('/prompt-ide/agent-hooks/copilot/v1/stop-failure')).toBeNull()
    expect(agentHookRouteOfPath('/prompt-ide/agent-hooks/copilot/v1/stop?x=1')).toBeNull()
    expect(agentHookRouteOfPath('/other')).toBeNull()
  })
})
```

`src/main/__tests__/agentHookReceiverRequest.test.ts` の import に `copilotHookPathOf` を足し、`describe('checkAgentHookRequest(本文を読む前の検査)'` の後に足す:

```ts
describe('checkAgentHookRequest(copilot の経路。段階 3b)', () => {
  const COPILOT_OWNER: AgentHookOwner = {
    ownerId: 2,
    sessionId: 's2',
    cli: { kind: 'copilot', main: { kind: 'known', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }
  }
  const owners = (authorization: string | undefined): AgentHookOwner | null =>
    authorization === 'Bearer ok'
      ? OWNER
      : authorization === 'Bearer copilot'
        ? COPILOT_OWNER
        : null
  const copilotRequest = (overrides: Partial<RequestLike> = {}): RequestLike =>
    validRequest({
      url: copilotHookPathOf('PreToolUse'),
      ...overrides,
      headers: { authorization: 'Bearer copilot', ...overrides.headers }
    })

  it('copilot の持ち主のトークンで copilot のパスなら、copilot の経路と持ち主を返す', () => {
    expect(checkAgentHookRequest(copilotRequest(), PORT, owners)).toEqual({
      kind: 'accepted',
      route: { cliKind: 'copilot', event: 'PreToolUse' },
      owner: COPILOT_OWNER
    })
  })

  it.each([
    ['メソッド', copilotRequest({ method: 'GET' }), 'method'],
    ['パス', copilotRequest({ url: '/prompt-ide/agent-hooks/copilot/v1/session-start' }), 'path'],
    ['Host', copilotRequest({ headers: { host: 'localhost:41234' } }), 'host'],
    ['Origin', copilotRequest({ headers: { origin: 'http://example.com' } }), 'origin'],
    ['トークン', copilotRequest({ headers: { authorization: 'Bearer ng' } }), 'token'],
    ['Content-Type', copilotRequest({ headers: { 'content-type': 'text/plain' } }), 'content-type']
  ])('copilot の経路で %s が違えば、状態コード 200 で拒む(理由は同じ)', (_name, req, reason) => {
    expect(checkAgentHookRequest(req, PORT, owners)).toEqual({
      kind: 'rejected',
      status: 200,
      reason
    })
  })

  it('経路の種類と持ち主の種類が違えば、トークンの照合の失敗(claude の経路は 401、copilot の経路は 200)', () => {
    expect(
      checkAgentHookRequest(
        copilotRequest({ headers: { authorization: 'Bearer ok' } }),
        PORT,
        owners
      )
    ).toEqual({ kind: 'rejected', status: 200, reason: 'token' })
    expect(
      checkAgentHookRequest(
        validRequest({ headers: { authorization: 'Bearer copilot' } }),
        PORT,
        owners
      )
    ).toEqual({ kind: 'rejected', status: 401, reason: 'token' })
  })
})
```

`src/main/__tests__/agentHookSessions.test.ts` の `describe('createAgentHookSessions: activate・release'` に足す:

```ts
it('copilot の prepared なら、トークンの持ち主に起動に使った会話の ID を主の ID(known)として持たせる(L-018)', () => {
  sessions().activate({ ...WITH_HOOKS, cliKind: 'copilot' }, 'sid-1', CLAUDE_SESSION_ID)
  expect(deps.receiver.addToken).toHaveBeenCalledExactlyOnceWith(TOKEN, {
    ownerId: 7,
    sessionId: 'sid-1',
    cli: { kind: 'copilot', main: { kind: 'known', id: CLAUDE_SESSION_ID } }
  })
})

it('copilot で会話の ID が無ければ(起こらない想定)、主の ID を待つ状態(awaiting)で持たせる', () => {
  sessions().activate({ ...WITH_HOOKS, cliKind: 'copilot' }, 'sid-1', null)
  expect(deps.receiver.addToken).toHaveBeenCalledExactlyOnceWith(TOKEN, {
    ownerId: 7,
    sessionId: 'sid-1',
    cli: { kind: 'copilot', main: { kind: 'awaiting' } }
  })
})
```

`src/main/__tests__/agentSessionStarter.test.ts` の hooks の describe（`PREPARED` の後）に足す（記録への足し方は同じファイルの `lastSessionOf は copilot の依頼に…` のテストと同じ）:

```ts
it('activate には起動に使った会話の ID を渡す(再開は記録と照合した ID)', async () => {
  const RESUME_ID = '33333333-3333-4333-8333-333333333333'
  claudeRecords.record('/work', RESUME_ID)
  await makeStarter()(
    1,
    { ...REQUEST, launch: { kind: 'resume', claudeSessionId: RESUME_ID, cliKind: 'claude' } },
    makeSink()
  )
  expect(hooks.activate).toHaveBeenCalledExactlyOnceWith(expect.any(Object), 'sid-1', RESUME_ID)
})
```

- [ ] **Step 3: 失敗するテストを書く（受け口の copilot の経路）**

`src/main/__tests__/agentHookReceiver.test.ts` の末尾に足す（`start` の後に `copilot` の持ち主のトークンを足す補助を使う）:

```ts
describe('createAgentHookReceiver(copilot の経路。段階 3b)', () => {
  const COPILOT_TOKEN = 'ef'.repeat(32)
  const MAIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const NEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const COPILOT_HEADERS = {
    Authorization: `Bearer ${COPILOT_TOKEN}`,
    'Content-Type': 'application/json'
  }

  async function startCopilot(overrides: Partial<AgentHookReceiverDeps> = {}): Promise<void> {
    await start(overrides)
    receiver?.addToken(COPILOT_TOKEN, {
      ownerId: 9,
      sessionId: 'sid-c',
      cli: { kind: 'copilot', main: { kind: 'known', id: MAIN } }
    })
  }

  const postCopilot = (
    segment: string,
    body: unknown,
    headers: Record<string, string> = COPILOT_HEADERS
  ): Promise<HookResponse> =>
    sendHookRequest(port, {
      path: `/prompt-ide/agent-hooks/copilot/v1/${segment}`,
      headers,
      body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
    })

  it('主の会話の UserPromptSubmit は 200 の空の本文で、prompt-submit を deliver する', async () => {
    await startCopilot()
    const response = await postCopilot('user-prompt-submit', {
      hook_event_name: 'UserPromptSubmit',
      session_id: MAIN,
      prompt: 'hi'
    })
    expect(response.status).toBe(200)
    expect(response.body).toBe('')
    expect(delivered).toEqual([
      [
        9,
        'sid-c',
        {
          kind: 'confirm-only',
          reason: 'prompt-submit',
          hookEventName: 'UserPromptSubmit',
          toolName: null
        }
      ]
    ])
  })

  it('PreToolUse は ID を持たない区間(主のグループ)を deliver してから onToolStart を待ち、200 を返す', async () => {
    await startCopilot()
    const response = await postCopilot('pre-tool-use', {
      hook_event_name: 'PreToolUse',
      session_id: MAIN,
      tool_name: 'Edit'
    })
    expect(response.status).toBe(200)
    expect(delivered.map(([, , event]) => event)).toEqual([
      {
        kind: 'tool-start',
        hookEventName: 'PreToolUse',
        toolName: 'Edit',
        toolId: { kind: 'none' },
        agentId: null
      }
    ])
    expect(calls).toEqual(['deliver:tool-start', 'onToolStart'])
  })

  it('PreToolUse の待ちが上限で打ち切られても 200 を返す(onToolStartTimedOut を 1 回呼ぶ)', async () => {
    await startCopilot({ onToolStart: vi.fn(() => new Promise<void>(() => undefined)) })
    const response = await postCopilot('pre-tool-use', {
      hook_event_name: 'PreToolUse',
      session_id: MAIN,
      tool_name: 'Edit'
    })
    expect(response.status).toBe(200)
    expect(deps.onToolStartTimedOut).toHaveBeenCalledExactlyOnceWith(9)
  })

  it('主の会話の ID の状態を持ち主に書き戻す: /clear の SessionEnd → 新しい ID の prompt → その ID の PreToolUse は主のグループ', async () => {
    await startCopilot()
    await postCopilot('session-end', { hook_event_name: 'SessionEnd', session_id: MAIN })
    await postCopilot('user-prompt-submit', {
      hook_event_name: 'UserPromptSubmit',
      session_id: NEW
    })
    await postCopilot('pre-tool-use', {
      hook_event_name: 'PreToolUse',
      session_id: NEW,
      tool_name: 'Edit'
    })
    expect(delivered.map(([, , event]) => event)).toEqual([
      { kind: 'session-end', hookEventName: 'SessionEnd', toolName: null },
      {
        kind: 'confirm-only',
        reason: 'prompt-submit',
        hookEventName: 'UserPromptSubmit',
        toolName: null
      },
      {
        kind: 'tool-start',
        hookEventName: 'PreToolUse',
        toolName: 'Edit',
        toolId: { kind: 'none' },
        agentId: null
      }
    ])
  })

  it('16 MiB を超える本文は主のグループの tool-start として deliver し、拒んだ要求（copilot）の too-large を数える', async () => {
    await startCopilot()
    const response = await postCopilot(
      'pre-tool-use',
      Buffer.alloc(AGENT_HOOK_MAX_BODY_BYTES + 1, 0x20)
    )
    expect(response.status).toBe(200)
    expect(delivered.map(([, , event]) => event)).toEqual([
      {
        kind: 'tool-start',
        hookEventName: 'PreToolUse',
        toolName: null,
        toolId: { kind: 'none' },
        agentId: null
      }
    ])
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] 拒んだ要求（copilot）: too-large 1 件')
  })

  const body = JSON.stringify({ hook_event_name: 'Stop', session_id: MAIN })
  it.each<[string, () => Promise<HookResponse>, string]>([
    [
      'GET',
      () =>
        sendHookRequest(port, {
          method: 'GET',
          path: '/prompt-ide/agent-hooks/copilot/v1/stop',
          headers: COPILOT_HEADERS
        }),
      'method'
    ],
    ['知らないパス', () => postCopilot('session-start', body), 'path'],
    [
      'Host が localhost',
      () => postCopilot('stop', body, { ...COPILOT_HEADERS, Host: `localhost:${port}` }),
      'host'
    ],
    [
      'Origin がある',
      () => postCopilot('stop', body, { ...COPILOT_HEADERS, Origin: 'http://evil.example' }),
      'origin'
    ],
    [
      'Authorization が無い',
      () => postCopilot('stop', body, { 'Content-Type': 'application/json' }),
      'token'
    ],
    [
      '表に無いトークン',
      () =>
        postCopilot('stop', body, { ...COPILOT_HEADERS, Authorization: `Bearer ${OTHER_TOKEN}` }),
      'token'
    ],
    [
      'claude の持ち主のトークン(経路と持ち主の種類の食い違い)',
      () => postCopilot('stop', body, HEADERS),
      'token'
    ],
    [
      'Content-Type が text/plain',
      () => postCopilot('stop', body, { ...COPILOT_HEADERS, 'Content-Type': 'text/plain' }),
      'content-type'
    ]
  ])(
    '%s は 200 の空の本文を返し、deliver せず、拒んだ要求（copilot）の件数をログに出す(トークン・本文は出さない)',
    async (_label, send, reason) => {
      await startCopilot()
      const response = await send()
      expect(response.status).toBe(200)
      expect(response.body).toBe('')
      expect(deps.deliver).not.toHaveBeenCalled()
      expect(deps.log).toHaveBeenCalledWith(`[agent-hooks] 拒んだ要求（copilot）: ${reason} 1 件`)
      for (const [message] of deps.log.mock.calls) {
        expect(message).not.toContain(COPILOT_TOKEN)
        expect(message).not.toContain(MAIN)
      }
    }
  )

  it('copilot の持ち主のトークンで claude のパスに送ると 401(claude の経路の応答は変えない)', async () => {
    await startCopilot()
    const response = await post('stop', { hook_event_name: 'Stop' }, COPILOT_HEADERS)
    expect(response.status).toBe(401)
    expect(deps.deliver).not.toHaveBeenCalled()
  })

  it('処理の例外は、copilot の経路では 200、claude の経路では今どおり 500', async () => {
    await startCopilot({
      deliver: vi.fn(() => {
        throw new Error('boom')
      })
    })
    expect((await postCopilot('stop', body)).status).toBe(200)
    expect((await post('stop', { hook_event_name: 'Stop' })).status).toBe(500)
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] 要求の処理に失敗しました: boom')
  })

  it('閉じた後に残った接続から届いた要求は、copilot の経路では 200、claude の経路では今どおり 503 で返し、deliver しない', async () => {
    await startCopilot()
    const server = createdServers[0]
    receiver?.close()
    receiver = null
    const respondTo = async (url: string): Promise<ReturnType<typeof vi.fn>> => {
      const res = { destroyed: false, writableEnded: false, writeHead: vi.fn(), end: vi.fn() }
      const req = { url, method: 'POST', headers: {}, resume: vi.fn() }
      server.emit('request', req, res)
      await vi.waitFor(() => expect(res.end).toHaveBeenCalled())
      return res.writeHead
    }
    expect(await respondTo('/prompt-ide/agent-hooks/copilot/v1/stop')).toHaveBeenCalledWith(200, {
      'Content-Length': '0'
    })
    expect(await respondTo('/prompt-ide/agent-hooks/v1/stop')).toHaveBeenCalledWith(503, {
      'Content-Length': '0'
    })
    expect(deps.deliver).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentHookProtocol.test.ts src/main/__tests__/agentHookReceiverRequest.test.ts src/main/__tests__/agentHookReceiver.test.ts src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentSessionStarter.test.ts`
Expected: FAIL（`agentHookRouteOfPath` が無い・`accepted` に `route` が無い・`copilot` の経路が 404 になる・`addToken` の持ち主に `cli` が無い・`activate` が会話の ID を受け取らない）

- [ ] **Step 5: 経路を足す（`src/main/agentHookProtocol.ts`）**

`isCopilotHookPath` の後に足す:

```ts
/** 受け口の経路(CLI の種類とイベント)。経路の種類とトークンの持ち主の種類が違えば、受け口はトークンの照合の失敗にする */
export type AgentHookRoute =
  | { cliKind: 'claude'; event: AgentHookEventName }
  | { cliKind: 'copilot'; event: CopilotHookEventName }

/** 要求のパス(クエリを含む req.url)が claude の 9 つ・copilot の 7 つのどれかに完全一致すればその経路。違えば null */
export function agentHookRouteOfPath(path: string): AgentHookRoute | null {
  const claudeEvent = agentHookEventOfPath(path)
  if (claudeEvent !== null) return { cliKind: 'claude', event: claudeEvent }
  const copilotEvent = COPILOT_HOOK_EVENT_NAMES.find((event) => copilotHookPathOf(event) === path)
  return copilotEvent === undefined ? null : { cliKind: 'copilot', event: copilotEvent }
}
```

- [ ] **Step 6: 照合の結果と持ち主の型を直す（`src/main/agentHookReceiverRequest.ts`）**

冒頭のコメントの「claude の http の hook の要求の受け付けの規則(設計書「受け口」)」を「claude・copilot の http の hook の要求の受け付けの規則(設計書「受け口」、段階 3b の設計書「受け口」)」にし、import と型・関数を次にする:

```ts
import type { IncomingMessage } from 'node:http'
import { agentHookRouteOfPath, isCopilotHookPath } from './agentHookProtocol'
import type { AgentHookRoute } from './agentHookProtocol'
import type { AgentHookBody } from './agentHookEvents'
import type { CopilotMainSession } from './agentCopilotHookEvents'
```

```ts
/** トークンの持ち主の CLI の種類。copilot は主の会話の ID の状態を持つ(受け口が振り分けのたびに書き戻す) */
export type AgentHookOwnerCli = { kind: 'claude' } | { kind: 'copilot'; main: CopilotMainSession }

export interface AgentHookOwner {
  ownerId: number
  sessionId: string
  cli: AgentHookOwnerCli
}

export type AgentHookRequestCheck =
  | { kind: 'accepted'; route: AgentHookRoute; owner: AgentHookOwner }
  | { kind: 'rejected'; status: number; reason: AgentHookRejectReason }

/**
 * 本文を読む前の要求の検査(メソッド → パス → Host → Origin → トークン → Content-Type の順。最初に外れた理由で拒む)。
 * ownerOf は Authorization の値から所有者を引く(トークンの表は受け口が持つ)。経路の種類と持ち主の種類が違えばトークンの照合の失敗。
 * copilot の経路(isCopilotHookPath が真のパス)では、拒むときの状態コードを 200 にする(copilot は preToolUse の 4xx・5xx・
 * 接続の失敗をツールの拒否にするため。200 の空の本文は何の情報も返さない)
 */
export function checkAgentHookRequest(
  req: Pick<IncomingMessage, 'method' | 'url' | 'headers'>,
  port: number,
  ownerOf: (authorization: string | undefined) => AgentHookOwner | null
): AgentHookRequestCheck {
  const path = req.url ?? ''
  const copilotPath = isCopilotHookPath(path)
  const rejected = (status: number, reason: AgentHookRejectReason): AgentHookRequestCheck => ({
    kind: 'rejected',
    status: copilotPath ? 200 : status,
    reason
  })
  if (req.method !== 'POST') return rejected(405, 'method')
  const route = agentHookRouteOfPath(path)
  if (route === null) return rejected(404, 'path')
  if (req.headers.host !== `127.0.0.1:${port}`) return rejected(403, 'host')
  if (req.headers.origin !== undefined) return rejected(403, 'origin')
  const owner = ownerOf(req.headers.authorization)
  if (owner === null || owner.cli.kind !== route.cliKind) return rejected(401, 'token')
  const contentType = req.headers['content-type']
  if (contentType === undefined || !contentType.toLowerCase().startsWith('application/json')) {
    return rejected(415, 'content-type')
  }
  return { kind: 'accepted', route, owner }
}
```

- [ ] **Step 7: 受け口の解釈と応答を直す（`src/main/agentHookReceiver.ts`）**

冒頭のコメントの「claude の http の hook の受け口(設計書「受け口」)。」の後に「copilot の経路(段階 3b)は、照合の失敗・閉じた後・処理の例外でも常に 200 の空の本文を返し、本文を copilot の解釈と主の会話の ID の振り分け(agentCopilotHookEvents.ts)で知らせにする。」を足す。import に次を足す:

```ts
import type { AgentHookParseResult } from './agentHookEvents'
import { parseCopilotHookRequest, resolveCopilotHookNotice } from './agentCopilotHookEvents'
import { isCopilotHookPath } from './agentHookProtocol'
import type { AgentHookRoute } from './agentHookProtocol'
import type { AgentHookBody } from './agentHookEvents'
```

（既存の `import { parseAgentHookRequest } from './agentHookEvents'`・`import type { AgentHookEvent, AgentHookParseNote } from './agentHookEvents'` は 1 つの import にまとめてよい）

`count` のラベルの型を `'拒んだ要求' | '拒んだ要求（copilot）' | '読めない知らせ'` にし、`waitForToolStart` の後に次の 2 つを足す:

```ts
/** 拒んだ要求の件数のラベル(copilot の経路は分けて数える。claude のラベルと件数は今のまま) */
const rejectLabelOf = (path: string): '拒んだ要求' | '拒んだ要求（copilot）' =>
  isCopilotHookPath(path) ? '拒んだ要求（copilot）' : '拒んだ要求'

/**
 * 経路ごとに本文を知らせにする。copilot は持ち主の主の会話の ID の状態を読み、振り分け、書き戻す(await を挟まない)。
 * 経路の種類と持ち主の種類は checkAgentHookRequest が照らし合わせ済み(食い違いは届かない。届いたら例外 → 200)
 */
const interpret = (
  route: AgentHookRoute,
  owner: AgentHookOwner,
  body: AgentHookBody
): AgentHookParseResult => {
  if (route.cliKind === 'claude') return parseAgentHookRequest(route.event, body)
  const cli = owner.cli
  if (cli.kind !== 'copilot') throw new Error('経路と持ち主の CLI の種類が違います')
  const { notice, notes } = parseCopilotHookRequest(route.event, body)
  const resolved = resolveCopilotHookNotice(cli.main, notice)
  cli.main = resolved.main
  return { event: resolved.event, notes }
}
```

`handle` を次にする:

```ts
const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const copilotPath = isCopilotHookPath(req.url ?? '')
  // close の後に残った接続から届いた要求は、追跡に渡さない(L-435)。copilot の経路は 200(ツールを拒否させない)
  if (closed) {
    req.resume()
    respond(res, copilotPath ? 200 : 503)
    return
  }
  const check = checkAgentHookRequest(req, port, ownerOf)
  if (check.kind === 'rejected') {
    count(rejectLabelOf(req.url ?? ''), check.reason)
    req.resume()
    respond(res, check.status)
    return
  }
  const { route, owner } = check
  const body = await readAgentHookBody(req)
  // 本文を読んでいる間に close した(接続が切れて unreadable になった)要求も渡さない
  if (closed) {
    respond(res, copilotPath ? 200 : 503)
    return
  }
  if (body.kind === 'too-large') count(rejectLabelOf(req.url ?? ''), 'too-large')
  const { event, notes } = interpret(route, owner, body)
  for (const note of notes) count('読めない知らせ', note)
  // 知らせ 1 件につき 1 回。追跡はこの中で段階の通知まで同期的に済ませる
  deliver(owner.ownerId, owner.sessionId, event)
  if (route.event === 'PreToolUse') await waitForToolStart(owner.ownerId)
  respond(res, 200)
}
```

`createServer` の中の例外の応答を次にする:

```ts
void handle(req, res).catch((err: unknown) => {
  log(`[agent-hooks] 要求の処理に失敗しました: ${messageOf(err)}`)
  // copilot の経路は 200(copilot は 5xx をツールの拒否にする)。claude の経路は今どおり 500
  respond(res, isCopilotHookPath(req.url ?? '') ? 200 : 500)
})
```

- [ ] **Step 8: 準備の種類と持ち主を足す（`src/main/agentHookSessions.ts`）**

import に `import type { AgentCliKind } from '@shared/agentCliKinds'` と `import type { AgentHookOwnerCli } from './agentHookReceiverRequest'` を足し、型と `without`・`prepare` の戻り値・`activate` を次にする:

```ts
export type PreparedAgentHooks =
  | {
      ownerId: number
      /** 起動の計画の種類(main が読んだ設定。L-018) */
      cliKind: AgentCliKind
      hooks: { settingsPath: string; token: string }
      unavailableReason: null
    }
  | {
      ownerId: number
      cliKind: AgentCliKind
      hooks: null
      unavailableReason: AgentHooksUnavailableReason
    }

export interface AgentHookSessions {
  prepare(ownerId: number, plan: AgentLaunchPlan): Promise<PreparedAgentHooks>
  /** cliSessionId は起動に使った会話の ID(--session-id・--resume に渡した ID。持たない種類は null)。copilot の主の会話の ID の初めの値 */
  activate(prepared: PreparedAgentHooks, sessionId: string, cliSessionId: string | null): void
  release(prepared: PreparedAgentHooks, sessionId: string | null): void
}
```

`createRandomToken` の後に足す:

```ts
/**
 * トークンの持ち主の CLI の種類(種類をキーにした表。種類を足したときの決め忘れを型エラーにする。L-060)。copilot の主の会話の ID は
 * 起動に使った ID から始める(L-018。持たないなら awaiting で、次の主のプロンプトの ID を採る)
 */
const OWNER_CLI_OF: Record<AgentCliKind, (cliSessionId: string | null) => AgentHookOwnerCli> = {
  claude: () => ({ kind: 'claude' }),
  copilot: (cliSessionId) => ({
    kind: 'copilot',
    main: cliSessionId === null ? { kind: 'awaiting' } : { kind: 'known', id: cliSessionId }
  })
}
```

`without` に `cliKind` の引数を足し（`without(ownerId, plan.cliKind, '…')` で呼ぶ）、成功の戻り値を `{ ownerId, cliKind: plan.cliKind, hooks: { settingsPath, token }, unavailableReason: null }` にする。`activate` を次にする:

```ts
    activate(prepared, sessionId, cliSessionId) {
      if (prepared.hooks === null) {
        tracker.addSession(prepared.ownerId, sessionId, {
          kind: 'unconfirmed',
          reason: prepared.unavailableReason
        })
        return
      }
      // 追跡に先に足す(addToken で投げても、追跡は pending〈段階は agent〉で残る。安全側。頑健性の 5)
      tracker.addSession(prepared.ownerId, sessionId, { kind: 'pending' })
      receiver.addToken(prepared.hooks.token, {
        ownerId: prepared.ownerId,
        sessionId,
        cli: OWNER_CLI_OF[prepared.cliKind](cliSessionId)
      })
    },
```

- [ ] **Step 9: starter から会話の ID を渡す（`src/main/agentSessionStarter.ts`）**

`spawnSession` の `hooks.activate(prepared, sessionId)` を `hooks.activate(prepared, sessionId, claudeSessionId)` にし、その上のコメントの「spawn の直後(await を挟まず)にトークンを表へ足し、追跡にセッションを足す。」の後に「copilot の主の会話の ID は、ここで渡す起動に使った ID から始める。」を足す。

- [ ] **Step 10: テストと型検査が通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentHookProtocol.test.ts src/main/__tests__/agentHookReceiverRequest.test.ts src/main/__tests__/agentHookReceiver.test.ts src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/agentSessionStarter.capabilities.test.ts src/main/__tests__/agentHooks.integration.test.ts src/main/__tests__/agentCliLaunch.integration.test.ts`
Expected: PASS（`claude` の経路の既存のテストは状態コードを含めて変えずに通る）
Run: `npm run typecheck`
Expected: エラーなし。落ちたら、`PreparedAgentHooks` の値を作る箇所・`activate` の呼び出しで直し漏れたものを `grep -rn -E "unavailableReason:|\.activate\(" src/main` で探して直す

- [ ] **Step 11: 実装を外すとテストが落ちることを確かめる（手で外して手で戻す）**

1. `checkAgentHookRequest` の `status: copilotPath ? 200 : status` を `status` にする → `agentHookReceiverRequest.test.ts` の「copilot の経路で … が違えば、状態コード 200 で拒む」と `agentHookReceiver.test.ts` の拒む要求の行が落ちる → 手で戻す
2. `owner === null || owner.cli.kind !== route.cliKind` を `owner === null` にする → 「経路の種類と持ち主の種類が違えば」と「claude の持ち主のトークン(経路と持ち主の種類の食い違い)」「copilot の持ち主のトークンで claude のパスに送ると 401」が落ちる → 手で戻す
3. `interpret` の `cli.main = resolved.main` を消す → 「主の会話の ID の状態を持ち主に書き戻す」が落ちる → 手で戻す
4. `createServer` の例外の応答を `respond(res, 500)` にする → 「処理の例外は、copilot の経路では 200」が落ちる → 手で戻す
5. `handle` の最初の `respond(res, copilotPath ? 200 : 503)` を `respond(res, 503)` にする → 「閉じた後に残った接続から届いた要求は」が落ちる → 手で戻す
6. `OWNER_CLI_OF.copilot` の `{ kind: 'known', id: cliSessionId }` を `{ kind: 'awaiting' }` にする → `agentHookSessions.test.ts` の「copilot の prepared なら」が落ちる → 手で戻す
7. starter の `hooks.activate(prepared, sessionId, claudeSessionId)` を `hooks.activate(prepared, sessionId, null)` にする → `agentSessionStarter.test.ts` の「activate には起動に使った会話の ID を渡す」と 879・894 行のテストが落ちる → 手で戻す

戻した後に `git diff src/main/agentHookReceiverRequest.ts src/main/agentHookReceiver.ts src/main/agentHookSessions.ts src/main/agentSessionStarter.ts` で上の箇所が Step 6〜9 の形であることを確かめ、Step 10 のコマンドで通ることを確かめ直す。

- [ ] **Step 12: 全体の検証**

```bash
cd <repo-root>
npx vitest run
npm run typecheck
set -- src/main/agentHookProtocol.ts src/main/agentHookReceiverRequest.ts src/main/agentHookReceiver.ts src/main/agentHookSessions.ts src/main/agentSessionStarter.ts src/main/__tests__/helpers/fakeAgentHookSessions.ts src/main/__tests__/agentHookProtocol.test.ts src/main/__tests__/agentHookReceiverRequest.test.ts src/main/__tests__/agentHookReceiver.test.ts src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentHooks.integration.test.ts src/main/__tests__/agentSessionStarter.test.ts
npx prettier --write "$@"
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
```

Expected: すべて通る

- [ ] **Step 13: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 4: プラグインのフォルダ

> **設計書の読む節:** 「渡す hooks（`copilot` 向けの設定）」の「中身」（JSON の形・matcher・`timeoutSec`・書かない欄）、「プラグインのフォルダ」（置き場と形・枠の割り当て・書き直し・アプリの終了）、「セキュリティ」、「実装の分割」の 4、「テスト方針」の `agentCopilotHookPlugin.test.ts`。
>
> **気をつける知見:** L-004（失敗では自分が作った一時ファイルだけを消す。`EEXIST` のときは消さない。親のフォルダの確かめに外れても親を作り直さない〈ほかの枠の `hooks.json` まで消す〉）・L-014・L-082（一時ファイルは `wx`・`0600` で作り、`sync` して閉じてから `rename` する。作成時に `0600`）・L-016・L-437（固定のパスのフォルダは使うたびに `lstat` で持ち主・権限・シンボリックリンクを確かめ、外れたら作り直す。判定を存在だけに戻すとテストが落ちることを確かめる）・L-010（終了の後始末は 1 つずつ試し、失敗はパスだけをログに出す）・L-403・L-435（終了の後は枠を貸さず書き直しを reject にし、書き直しの最中の終了ではできた `hooks.json` をその場で消す）・L-017（トークンは例外・ログの文言に入れない。パスはログにだけ）。

**Files:**

- Create: `src/main/agentCopilotHookPlugin.ts`
- Modify: `src/main/agentHookSettings.ts`（内部の `currentOwner` を `currentAgentHookDirOwner` として export するだけ）
- Test: `src/main/__tests__/agentCopilotHookPlugin.test.ts`（新規。一時ディレクトリの実ファイル）

**Interfaces:**

- Consumes: Task 2 の `COPILOT_HOOK_EVENT_NAMES`・`copilotHookPathOf`・`COPILOT_HOOK_TOOL_MATCHER`・`CopilotHookEventName`、既存の `AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS`（10）・`AGENT_HOOK_TIMEOUT_SECONDS`（5）・`isOwnPrivateDirStat`・`AgentHookSettingsDirOwner`・`AGENT_MAX_SESSIONS_PER_WINDOW`（`@shared/types`）
- Produces: `COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME`・`COPILOT_HOOK_PLUGIN_SLOT_COUNT`・`COPILOT_HOOK_PLUGIN_MANIFEST`・`CopilotHttpHook`・`CopilotHookConfigJson`・`buildCopilotHookConfig`・`CopilotHookPluginSlot`・`CopilotHookPluginSlots`・`CopilotHookPluginSlotsDeps`・`createCopilotHookPluginSlots`（Task 5 が組み立てる。まだ組み立てない）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/agentCopilotHookPlugin.test.ts` を作る:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  COPILOT_HOOK_PLUGIN_MANIFEST,
  COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME,
  COPILOT_HOOK_PLUGIN_SLOT_COUNT,
  buildCopilotHookConfig,
  createCopilotHookPluginSlots
} from '../agentCopilotHookPlugin'
import type { CopilotHookPluginSlots, CopilotHookPluginSlotsDeps } from '../agentCopilotHookPlugin'

// copilot に --plugin-dir で渡すプラグインのフォルダ(設計書 2026-10-26「プラグインのフォルダ」)。設定の JSON の形・枠の割り当て・
// 実 fs での権限・原子的な書き直し・作り直し・終了の後始末を確かめる。userData の代わりに一時ディレクトリを使う

const TOKEN = 'ab'.repeat(32)
const OTHER_TOKEN = 'cd'.repeat(32)
const BASE = 'http://127.0.0.1:43210'
const POSIX = process.platform !== 'win32'

let dir: string
let rootDir: string
let warnSpy: MockInstance<typeof console.warn>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prompt-ide-copilot-plugin-test-'))
  rootDir = join(dir, COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME)
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warnSpy.mockRestore()
  rmSync(dir, { recursive: true, force: true })
})

const slotsOf = (overrides: Partial<CopilotHookPluginSlotsDeps> = {}): CopilotHookPluginSlots =>
  createCopilotHookPluginSlots({ rootDir, ...overrides })
const modeOf = (target: string): number => statSync(target).mode & 0o777
const hooksFileOf = (slotDir: string): string => join(slotDir, 'hooks', 'hooks.json')

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('buildCopilotHookConfig(設定の JSON)', () => {
  it('7 つのイベントを copilot の平らな形で書き、ツールのイベントだけに matcher、PreToolUse だけ timeoutSec 10', () => {
    const hook = (segment: string, timeoutSec: number): Record<string, unknown> => ({
      type: 'http',
      url: `${BASE}/prompt-ide/agent-hooks/copilot/v1/${segment}`,
      headers: { Authorization: `Bearer ${TOKEN}` },
      timeoutSec
    })
    const matcher =
      'Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|bash|powershell|apply_patch|create|edit'
    expect(buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN })).toEqual({
      version: 1,
      hooks: {
        UserPromptSubmit: [hook('user-prompt-submit', 5)],
        PreToolUse: [{ ...hook('pre-tool-use', 10), matcher }],
        PostToolUse: [{ ...hook('post-tool-use', 5), matcher }],
        PostToolUseFailure: [{ ...hook('post-tool-use-failure', 5), matcher }],
        SubagentStop: [hook('subagent-stop', 5)],
        Stop: [hook('stop', 5)],
        SessionEnd: [hook('session-end', 5)]
      }
    })
  })

  it('camelCase のイベント・onFailure・allowedEnvVars・env を書かず、URL に環境変数を使わない', () => {
    const text = JSON.stringify(buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    for (const word of [
      'preToolUse',
      'onFailure',
      'allowedEnvVars',
      '"env"',
      '$',
      'permissionDecision'
    ]) {
      expect(text).not.toContain(word)
    }
  })

  it('マニフェストはアプリのものと分かる名前と説明', () => {
    expect(COPILOT_HOOK_PLUGIN_MANIFEST).toEqual({
      name: 'prompt-ide-agent-hooks',
      version: '1.0.0',
      description:
        'prompt-ide がエージェントの変更の区別に使う hooks（アプリが起動した copilot だけに渡します）'
    })
    expect(COPILOT_HOOK_PLUGIN_SLOT_COUNT).toBe(4)
    expect(COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME).toBe('agent-hooks-copilot')
  })
})

describe('createCopilotHookPluginSlots(枠の割り当て)', () => {
  it('空いている一番小さい番号を返し、4 つで null、返した番号を再び使う。フォルダは <root>/slot-<番号>', () => {
    const slots = slotsOf()
    const taken = [slots.acquire(), slots.acquire(), slots.acquire(), slots.acquire()]
    expect(taken.map((slot) => slot?.number)).toEqual([1, 2, 3, 4])
    expect(taken[1]?.dir).toBe(join(rootDir, 'slot-2'))
    expect(slots.acquire()).toBeNull()
    if (taken[2] === null) throw new Error('slot-3 が無い')
    slots.release(taken[2])
    expect(slots.acquire()?.number).toBe(3)
  })

  it('removeTokenFilesSync の後は枠を貸さない', () => {
    const slots = slotsOf()
    slots.removeTokenFilesSync()
    expect(slots.acquire()).toBeNull()
  })
})

describe('createCopilotHookPluginSlots(書き直し。実 fs)', () => {
  it.skipIf(!POSIX)(
    '親・枠・hooks のフォルダを 0700、plugin.json・hooks.json を 0600 で作り、一時ファイルを残さない',
    async () => {
      const slots = slotsOf()
      const slot = slots.acquire()
      if (slot === null) throw new Error('枠が無い')
      const config = buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN })
      await slots.write(slot, config)
      expect([modeOf(rootDir), modeOf(slot.dir), modeOf(join(slot.dir, 'hooks'))]).toEqual([
        0o700, 0o700, 0o700
      ])
      expect(modeOf(join(slot.dir, 'plugin.json'))).toBe(0o600)
      expect(modeOf(hooksFileOf(slot.dir))).toBe(0o600)
      expect(JSON.parse(readFileSync(join(slot.dir, 'plugin.json'), 'utf8'))).toEqual(
        COPILOT_HOOK_PLUGIN_MANIFEST
      )
      expect(readFileSync(hooksFileOf(slot.dir), 'utf8')).toBe(JSON.stringify(config))
      expect(readdirSync(slot.dir).sort()).toEqual(['hooks', 'plugin.json'])
      expect(readdirSync(join(slot.dir, 'hooks'))).toEqual(['hooks.json'])
    }
  )

  it('2 回目の書き直しは hooks.json だけを新しいトークンに置き換え、フォルダの実体(inode)を保つ', async () => {
    const slots = slotsOf()
    const slot = slots.acquire()
    if (slot === null) throw new Error('枠が無い')
    await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    const inode = statSync(slot.dir).ino
    await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: OTHER_TOKEN }))
    expect(statSync(slot.dir).ino).toBe(inode)
    const text = readFileSync(hooksFileOf(slot.dir), 'utf8')
    expect(text).toContain(OTHER_TOKEN)
    expect(text).not.toContain(TOKEN)
    expect(readdirSync(join(slot.dir, 'hooks'))).toEqual(['hooks.json'])
  })

  it.skipIf(!POSIX)(
    'グループ・他人も書ける(0777)枠のフォルダは使わず、消して 0700 で作り直す(L-437)',
    async () => {
      const slots = slotsOf()
      const slot = slots.acquire()
      if (slot === null) throw new Error('枠が無い')
      mkdirSync(rootDir, { mode: 0o700 })
      mkdirSync(slot.dir)
      chmodSync(slot.dir, 0o777)
      writeFileSync(join(slot.dir, 'planted.txt'), 'x')
      await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
      expect(modeOf(slot.dir)).toBe(0o700)
      expect(existsSync(join(slot.dir, 'planted.txt'))).toBe(false)
      expect(existsSync(hooksFileOf(slot.dir))).toBe(true)
    }
  )

  it.skipIf(!POSIX)(
    '枠のフォルダがシンボリックリンクなら、リンクだけを消して実体のフォルダを作り直す(リンク先は変えない。L-016)',
    async () => {
      const slots = slotsOf()
      const slot = slots.acquire()
      if (slot === null) throw new Error('枠が無い')
      const target = join(dir, 'elsewhere')
      mkdirSync(target, { mode: 0o700 })
      writeFileSync(join(target, 'keep.txt'), 'keep')
      mkdirSync(rootDir, { mode: 0o700 })
      symlinkSync(target, slot.dir)
      await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
      expect(lstatSync(slot.dir).isSymbolicLink()).toBe(false)
      expect(lstatSync(slot.dir).isDirectory()).toBe(true)
      expect(readdirSync(target)).toEqual(['keep.txt'])
    }
  )

  it.skipIf(!POSIX)(
    '親のフォルダ(agent-hooks-copilot)の確かめに外れたら、作り直さずに reject する(ほかの枠の hooks.json を消さない。L-004)',
    async () => {
      const slots = slotsOf()
      const first = slots.acquire()
      const second = slots.acquire()
      if (first === null || second === null) throw new Error('枠が無い')
      await slots.write(first, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
      chmodSync(rootDir, 0o777)
      await expect(
        slots.write(second, buildCopilotHookConfig({ baseUrl: BASE, token: OTHER_TOKEN }))
      ).rejects.toThrow()
      expect(existsSync(hooksFileOf(first.dir))).toBe(true)
      expect(existsSync(second.dir)).toBe(false)
      chmodSync(rootDir, 0o700)
    }
  )

  it('rename が失敗したら自分の一時ファイルだけを消して reject する(ほかの .tmp は残す。例外にトークンを入れない)', async () => {
    const slots = slotsOf({
      renameFile: async (from, to) => {
        if (to.endsWith('hooks.json')) throw new Error('EPERM')
        await rename(from, to)
      }
    })
    const slot = slots.acquire()
    if (slot === null) throw new Error('枠が無い')
    mkdirSync(join(slot.dir, 'hooks'), { recursive: true, mode: 0o700 })
    chmodSync(rootDir, 0o700)
    writeFileSync(join(slot.dir, 'hooks', '.foreign.tmp'), 'x')
    const error = await slots
      .write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
      .then(
        () => null,
        (err: unknown) => err
      )
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toContain(TOKEN)
    expect(readdirSync(join(slot.dir, 'hooks'))).toEqual(['.foreign.tmp'])
  })

  it('一時ファイルの名前が既にあれば(EEXIST)そのファイルを消さずに reject する(L-004)', async () => {
    const slots = slotsOf({ createTempName: () => '.taken.tmp' })
    const slot = slots.acquire()
    if (slot === null) throw new Error('枠が無い')
    mkdirSync(join(slot.dir, 'hooks'), { recursive: true, mode: 0o700 })
    chmodSync(rootDir, 0o700)
    // plugin.json の書き込みも同じ名前を使うため、先に正しい plugin.json を置いて書き込みを飛ばさせる
    writeFileSync(
      join(slot.dir, 'plugin.json'),
      `${JSON.stringify(COPILOT_HOOK_PLUGIN_MANIFEST, null, 2)}\n`,
      { mode: 0o600 }
    )
    writeFileSync(join(slot.dir, 'hooks', '.taken.tmp'), 'other')
    await expect(
      slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(join(slot.dir, 'hooks', '.taken.tmp'), 'utf8')).toBe('other')
  })
})

describe('createCopilotHookPluginSlots(アプリの終了)', () => {
  it('removeTokenFilesSync はすべての枠の hooks.json だけを消し、plugin.json とフォルダは残す。以後の書き直しは reject', async () => {
    const slots = slotsOf()
    const first = slots.acquire()
    const second = slots.acquire()
    if (first === null || second === null) throw new Error('枠が無い')
    await slots.write(first, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    await slots.write(second, buildCopilotHookConfig({ baseUrl: BASE, token: OTHER_TOKEN }))
    slots.release(second)
    slots.removeTokenFilesSync()
    for (const slot of [first, second]) {
      expect(existsSync(hooksFileOf(slot.dir))).toBe(false)
      expect(existsSync(join(slot.dir, 'plugin.json'))).toBe(true)
      expect(existsSync(join(slot.dir, 'hooks'))).toBe(true)
    }
    await expect(
      slots.write(first, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    ).rejects.toThrow('copilot の hooks のフォルダは終了処理で閉じられています')
  })

  it('書き直しの最中に removeTokenFilesSync が来たら、書き終えた hooks.json をその場で消して reject する(L-435)', async () => {
    const gate = deferred()
    const renameCalled = deferred()
    const slots = slotsOf({
      renameFile: async (from, to) => {
        if (to.endsWith('hooks.json')) {
          renameCalled.resolve()
          await gate.promise
        }
        await rename(from, to)
      }
    })
    const slot = slots.acquire()
    if (slot === null) throw new Error('枠が無い')
    const writing = slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    await renameCalled.promise
    slots.removeTokenFilesSync()
    gate.resolve()
    await expect(writing).rejects.toThrow('copilot の hooks のフォルダは終了処理で閉じられています')
    expect(existsSync(hooksFileOf(slot.dir))).toBe(false)
  })

  it('hooks.json を消せなくても投げず、パスだけをログに出して残りの枠を続ける(L-010)', () => {
    const removed: string[] = []
    const slots = slotsOf({
      rmSync: (target) => {
        removed.push(target)
        if (target.includes('slot-1')) throw new Error('EBUSY')
      }
    })
    expect(() => slots.removeTokenFilesSync()).not.toThrow()
    expect(removed).toHaveLength(COPILOT_HOOK_PLUGIN_SLOT_COUNT)
    expect(warnSpy).toHaveBeenCalledWith(
      '[agent-hooks] copilot の hooks の設定のファイルを消せませんでした:',
      hooksFileOf(join(rootDir, 'slot-1'))
    )
  })
})
```

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentCopilotHookPlugin.test.ts`
Expected: FAIL（`../agentCopilotHookPlugin` が無い）

- [ ] **Step 3: 持ち主を export する（`src/main/agentHookSettings.ts`）**

`const currentOwner = (): AgentHookSettingsDirOwner => ({ … })` を次にし、同じファイルの `currentOwner()` の呼び出しを `currentAgentHookDirOwner()` に置き換える（ASCII なので `perl -pi -e 's/\bcurrentOwner\b/currentAgentHookDirOwner/g' src/main/agentHookSettings.ts` でよい）:

```ts
/** 今のプロセスの持ち主(isOwnPrivateDirStat に渡す。copilot のプラグインのフォルダの確かめにも使う) */
export const currentAgentHookDirOwner = (): AgentHookSettingsDirOwner => ({
  platform: process.platform,
  uid: typeof process.getuid === 'function' ? process.getuid() : null
})
```

- [ ] **Step 4: プラグインのフォルダを実装する（`src/main/agentCopilotHookPlugin.ts`）**

```ts
import { randomBytes } from 'node:crypto'
import { rmSync as fsRmSync } from 'node:fs'
import { chmod, lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AGENT_MAX_SESSIONS_PER_WINDOW } from '@shared/types'
import {
  AGENT_HOOK_TIMEOUT_SECONDS,
  AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS,
  COPILOT_HOOK_EVENT_NAMES,
  COPILOT_HOOK_TOOL_MATCHER,
  copilotHookPathOf
} from './agentHookProtocol'
import type { CopilotHookEventName } from './agentHookProtocol'
import { currentAgentHookDirOwner, isOwnPrivateDirStat } from './agentHookSettings'
import type { AgentHookSettingsDirOwner } from './agentHookSettings'

// copilot に --plugin-dir で渡すプラグインのフォルダ(設計書 2026-10-26「渡す hooks」「プラグインのフォルダ」)。main 全体で 4 つの枠
// (<userData>/agent-hooks-copilot/slot-<1〜4>)を持ち、起動の準備で空いている一番小さい番号を貸して、その pty の終了で返す。
// フォルダのパスが枠ごとに固定なので、copilot が作る ~/.copilot/plugin-data/_direct/<ハッシュ>/ は 4 つまでで止まる。起動のたびに
// トークン入りの hooks/hooks.json(0600)を原子的に書き直す(トークンは起動の引数・環境変数に置かない)。フォルダは使うたびに
// lstat で持ち主・権限・シンボリックリンクを確かめる(L-016・L-437)。フォルダと plugin.json は消さない(_direct のハッシュの元が
// inode などだった場合に空のディレクトリが増えうるため)。アプリの終了では hooks.json だけを消す。利用者のリポジトリ・~/.copilot には書かない

export const COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME = 'agent-hooks-copilot'
/** 枠の数(ウィンドウのタブの上限と同じ) */
export const COPILOT_HOOK_PLUGIN_SLOT_COUNT = AGENT_MAX_SESSIONS_PER_WINDOW

/** ルートの plugin.json(記録の最小の形)。name は copilot の拒否の文言・/env に出るので、アプリのものと分かる名前にする */
export const COPILOT_HOOK_PLUGIN_MANIFEST = {
  name: 'prompt-ide-agent-hooks',
  version: '1.0.0',
  description:
    'prompt-ide がエージェントの変更の区別に使う hooks（アプリが起動した copilot だけに渡します）'
} as const

/** copilot の平らな形の http の hook(onFailure・allowedEnvVars・env は書かない) */
export interface CopilotHttpHook {
  type: 'http'
  url: string
  headers: { Authorization: string }
  timeoutSec: number
  matcher?: string
}

export interface CopilotHookConfigJson {
  version: 1
  hooks: Record<CopilotHookEventName, CopilotHttpHook[]>
}

/** matcher を付けるイベント(ツールのイベント) */
const COPILOT_HOOK_TOOL_EVENTS: readonly CopilotHookEventName[] = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure'
]

/**
 * hooks の設定の JSON(純粋な関数)。PascalCase のイベント名を copilot の平らな形で書く(camelCase と両方書くと同じ出来事が 2 回届く)。
 * PreToolUse の timeoutSec は受け口の待ちの上限(5 秒)の 2 倍(copilot の打ち切りはツールの許可になるので、先に打ち切らせない)。
 * 書く値は main の値(受け口のポート・トークン)だけ。URL・ヘッダーに環境変数を使わない
 */
export function buildCopilotHookConfig({
  baseUrl,
  token
}: {
  baseUrl: string
  token: string
}): CopilotHookConfigJson {
  const entries = COPILOT_HOOK_EVENT_NAMES.map(
    (event): [CopilotHookEventName, CopilotHttpHook[]] => {
      const hook: CopilotHttpHook = {
        type: 'http',
        url: baseUrl + copilotHookPathOf(event),
        headers: { Authorization: `Bearer ${token}` },
        timeoutSec:
          event === 'PreToolUse'
            ? AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS
            : AGENT_HOOK_TIMEOUT_SECONDS
      }
      return [
        event,
        [
          COPILOT_HOOK_TOOL_EVENTS.includes(event)
            ? { ...hook, matcher: COPILOT_HOOK_TOOL_MATCHER }
            : hook
        ]
      ]
    }
  )
  return {
    version: 1,
    hooks: Object.fromEntries(entries) as Record<CopilotHookEventName, CopilotHttpHook[]>
  }
}

export interface CopilotHookPluginSlot {
  /** 1〜COPILOT_HOOK_PLUGIN_SLOT_COUNT */
  number: number
  /** --plugin-dir に渡す絶対パス(<rootDir>/slot-<番号>) */
  dir: string
}

export interface CopilotHookPluginSlots {
  /** 空いている一番小さい番号の枠を貸す。空きが無い・終了の後は null */
  acquire(): CopilotHookPluginSlot | null
  /** 枠を返す(その pty の終了・起動しなかったとき)。hooks.json は消さない(次の持ち主の書き直しと競るため) */
  release(slot: CopilotHookPluginSlot): void
  /**
   * 枠のフォルダを確かめ(親は作り直さない)、plugin.json を(無いか違うときだけ)、hooks/hooks.json を原子的に書き直す。
   * 失敗は例外(呼び出し側が hooks なしの起動に読み替える)。終了の後は reject、書き直しの最中の終了ではできた hooks.json を消して reject
   */
  write(slot: CopilotHookPluginSlot, config: CopilotHookConfigJson): Promise<void>
  /** will-quit: 以後の acquire を null、write を reject にし、すべての枠の hooks.json を同期で消す(失敗はパスだけをログに出して続ける) */
  removeTokenFilesSync(): void
}

export interface CopilotHookPluginSlotsDeps {
  /** <userData>/agent-hooks-copilot の絶対パス */
  rootDir: string
  /** テスト用。持ち主の確かめ(既定は今のプロセス) */
  owner?: AgentHookSettingsDirOwner
  /** テスト用。一時ファイルの名前(既定は .<16 進 16 桁>.tmp) */
  createTempName?: () => string
  /** テスト用。一時ファイルの置き換え(既定は fs.rename) */
  renameFile?: (from: string, to: string) => Promise<void>
  /** テスト用。終了の後始末の削除(既定は fs.rmSync) */
  rmSync?: (target: string, options: { force: true }) => void
}

const PRIVATE_DIR_ERROR = 'copilot の hooks のフォルダの持ち主・権限が正しくありません'
const CLOSED_ERROR = 'copilot の hooks のフォルダは終了処理で閉じられています'
const MANIFEST_TEXT = `${JSON.stringify(COPILOT_HOOK_PLUGIN_MANIFEST, null, 2)}\n`

const createRandomTempName = (): string => `.${randomBytes(8).toString('hex')}.tmp`
const errnoOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException).code

/**
 * path が自分の持ち物の 0700 のディレクトリ(シンボリックリンクでない)であることを確かめ、無ければ 0700 で作る。外れたとき、
 * recreate なら消して(シンボリックリンクならリンクだけ。rm はリンク先を辿らない)作り直し、recreate でなければ投げる。
 * 作るときの EEXIST(別の prepare が先に作った)は、lstat し直して同じ確かめをする
 */
async function ensurePrivateDir(
  target: string,
  owner: AgentHookSettingsDirOwner,
  recreate: boolean
): Promise<void> {
  const stateOf = async (): Promise<'usable' | 'missing' | 'unusable'> => {
    try {
      return isOwnPrivateDirStat(await lstat(target), owner) ? 'usable' : 'unusable'
    } catch (err) {
      if (errnoOf(err) === 'ENOENT') return 'missing'
      throw err
    }
  }
  const state = await stateOf()
  if (state === 'usable') return
  if (state === 'unusable') {
    if (!recreate) throw new Error(PRIVATE_DIR_ERROR)
    await rm(target, { recursive: true, force: true })
  }
  try {
    await mkdir(target, { mode: 0o700 })
  } catch (err) {
    if (errnoOf(err) !== 'EEXIST') throw err
  }
  if ((await stateOf()) !== 'usable') throw new Error(PRIVATE_DIR_ERROR)
}

/**
 * dir に一時ファイルを wx・0600 で作って書き、sync して閉じてから name へ rename する(原子的な置き換え。settingsFileStore.ts の
 * 書き込みと同じ手順。L-014・L-082)。途中で失敗したら自分が作った一時ファイルだけを消す(EEXIST のときは消さない。L-004)
 */
async function writeFileAtomically(
  dir: string,
  name: string,
  text: string,
  createTempName: () => string,
  renameFile: (from: string, to: string) => Promise<void>
): Promise<void> {
  const tempPath = join(dir, createTempName())
  try {
    await writeFile(tempPath, text, { flag: 'wx', mode: 0o600 })
    const handle = await open(tempPath, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await chmod(tempPath, 0o600)
    await renameFile(tempPath, join(dir, name))
  } catch (err) {
    if (errnoOf(err) !== 'EEXIST') await rm(tempPath, { force: true }).catch(() => undefined)
    throw err
  }
}

export function createCopilotHookPluginSlots({
  rootDir,
  owner = currentAgentHookDirOwner(),
  createTempName = createRandomTempName,
  renameFile = (from, to) => rename(from, to),
  rmSync = (target, options) => fsRmSync(target, options)
}: CopilotHookPluginSlotsDeps): CopilotHookPluginSlots {
  const used = new Set<number>()
  let closed = false
  const slotOf = (number: number): CopilotHookPluginSlot => ({
    number,
    dir: join(rootDir, `slot-${number}`)
  })
  const hooksFileOf = (slot: CopilotHookPluginSlot): string => join(slot.dir, 'hooks', 'hooks.json')
  const removeQuietly = (target: string): void => {
    try {
      rmSync(target, { force: true })
    } catch {
      console.warn('[agent-hooks] copilot の hooks の設定のファイルを消せませんでした:', target)
    }
  }
  return {
    acquire() {
      if (closed) return null
      for (let number = 1; number <= COPILOT_HOOK_PLUGIN_SLOT_COUNT; number++) {
        if (!used.has(number)) {
          used.add(number)
          return slotOf(number)
        }
      }
      return null
    },
    release(slot) {
      used.delete(slot.number)
    },
    async write(slot, config) {
      if (closed) throw new Error(CLOSED_ERROR)
      // JSON は書き込みの前に作る(文字列の連結で作らない)
      const text = JSON.stringify(config)
      // 親を作り直すと、動いているほかの枠の hooks.json まで消すため、親は確かめに外れたら投げる(L-004)
      await ensurePrivateDir(rootDir, owner, false)
      await ensurePrivateDir(slot.dir, owner, true)
      const hooksDir = join(slot.dir, 'hooks')
      await ensurePrivateDir(hooksDir, owner, true)
      const manifest = await readFile(join(slot.dir, 'plugin.json'), 'utf8').catch(() => null)
      if (manifest !== MANIFEST_TEXT) {
        await writeFileAtomically(
          slot.dir,
          'plugin.json',
          MANIFEST_TEXT,
          createTempName,
          renameFile
        )
      }
      if (closed) throw new Error(CLOSED_ERROR)
      await writeFileAtomically(hooksDir, 'hooks.json', text, createTempName, renameFile)
      // 書き直しの最中に終了の後始末が来た。誰にも使われないので、できた hooks.json をここで消す(L-435)
      if (closed) {
        removeQuietly(hooksFileOf(slot))
        throw new Error(CLOSED_ERROR)
      }
    },
    removeTokenFilesSync() {
      closed = true
      for (let number = 1; number <= COPILOT_HOOK_PLUGIN_SLOT_COUNT; number++) {
        removeQuietly(hooksFileOf(slotOf(number)))
      }
    }
  }
}
```

- [ ] **Step 5: テストと型検査が通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentCopilotHookPlugin.test.ts src/main/__tests__/agentHookSettings.test.ts`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 6: 実装を外すとテストが落ちることを確かめる（手で外して手で戻す）**

1. `ensurePrivateDir` の `isOwnPrivateDirStat(await lstat(target), owner) ? 'usable' : 'unusable'` を `'usable'`（存在だけの判定。`await lstat(target)` は残す）にする → 「0777 枠のフォルダは使わず」「シンボリックリンクなら」「親のフォルダの確かめに外れたら」が落ちる（L-437）→ 手で戻す
2. `writeFileAtomically` の catch の `if (errnoOf(err) !== 'EEXIST')` を外して常に `rm` する → 「一時ファイルの名前が既にあれば(EEXIST)」が落ちる → 手で戻す
3. `write` の最後の `if (closed) { removeQuietly(…); throw … }` を消す → 「書き直しの最中に removeTokenFilesSync が来たら」が落ちる → 手で戻す
4. `ensurePrivateDir(rootDir, owner, false)` を `true` にする → 「親のフォルダの確かめに外れたら、作り直さずに」が落ちる → 手で戻す
5. `acquire` の `if (closed) return null` を消す → 「removeTokenFilesSync の後は枠を貸さない」が落ちる → 手で戻す

戻した後に `grep -n "? 'usable' : 'unusable'\|!== 'EEXIST') await rm\|removeQuietly(hooksFileOf(slot))\|ensurePrivateDir(rootDir, owner, false)\|if (closed) return null" src/main/agentCopilotHookPlugin.ts` で 5 か所が Step 4 の形であることを確かめ、Step 5 のコマンドで通ることを確かめ直す。

- [ ] **Step 7: 全体の検証**

```bash
cd <repo-root>
npx vitest run
npm run typecheck
set -- src/main/agentCopilotHookPlugin.ts src/main/agentHookSettings.ts src/main/__tests__/agentCopilotHookPlugin.test.ts
npx prettier --write "$@"
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
```

Expected: すべて通る

- [ ] **Step 8: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 5: copilot の区別の有効化（準備・引数・環境変数・能力の表）

> **設計書の読む節:** 「プラグインのフォルダ」の「枠の割り当て」「アプリの終了」、「起動の引数と環境変数」、「既存の絞り込みの扱い」、「新しい状態と既存の入口」、「エラー処理」、「hooks が届かないとき」、「実装の分割」の 5（前提を失う既存のテストの一覧・テストの補助・変えないもの）、「テスト方針」の `agentHookSessions.test.ts`・`agentCliLaunchSpecs.test.ts`・統合テスト（`agentHooks.integration.test.ts`）・`useAgentHooksWorkingReport.test.tsx`。
>
> **気をつける知見:** L-609（引数の関数が `--plugin-dir` を受け付ける変更・準備の表・能力の表の値は、どれかだけでは起動が壊れるか既存のテストが落ちるので 1 つのタスクに入れ、前提を失う既存のテストを同じタスクで直す）・L-001・L-053（準備の失敗は hooks なしの起動として結果で返し、後始末は 1 つずつ試す）・L-034（`--plugin-dir` の値は main が作った絶対パスだけ。起動の表でも確かめる）・L-017（起動の表の例外・準備のログにパス〈利用者名〉・トークンを画面に出さない）・L-079（足す環境変数は今の `buildAgentEnv` の規則で足す）・L-052（`copilot` の版を確かめない）・L-060（種類ごとの準備は `Record<AgentCliKind, …>`。能力の差し替えの補助の欄は省略できない）・L-019（フォルダ・引数・環境変数は main が決める。`userData` は `ipcHandlers.ts` が渡す）・L-403・L-010（枠・トークン・追跡のセッションを pty の終了で外し、`will-quit` の後始末は 1 つずつ試す）・L-061（新しい状態〈枠〉の入口: 起動・取り消し・spawn の失敗・終了・アプリの終了）・L-203（「copilot は知らせない」「claude だけ」のコメントを直す）。

**Files:**

- Modify: `src/shared/agentCliKinds.ts`（`copilot` の `changeAttribution` を `true`。コメント）
- Modify: `src/main/agentHookSessions.ts`（種類ごとの準備の表・`AgentHookPreparation`・`configPath`・`discard`・`copilotPlugins`・`release` の後始末）
- Modify: `src/main/agentSessionStarter.ts`（`configPath`・コメント）
- Modify: `src/main/agentCliLaunchSpecs.ts`（`hookConfigPath`・`--plugin-dir`・`extraEnv`・コメント）
- Modify: `src/main/agentHooksRuntime.ts`（`userDataDir`・プラグインのフォルダの組み立て）
- Modify: `src/main/agentHooksLifecycle.ts`（`will-quit` の後始末に `removeTokenFilesSync` を足す）
- Modify: `src/main/ipcHandlers.ts`（`userDataDir` を渡す・コメント）
- Modify: `src/renderer/src/__tests__/agentCliCapabilityOverrides.ts`（`changeAttributionUnsupportedKinds`）
- Modify: `src/renderer/src/hooks/useAgentHooksWorkingReport.ts`（コメントだけ）
- Create: `src/main/__tests__/agentHookSessions.capabilities.test.ts`
- Test（前提を失う既存のテスト。2026-10-26 の計画の時点に `changeAttribution`・`cli-unsupported`・`hookSettingsPath`・`settingsPath`・`利用者の変更との区別`・`copilot の起動に hooks`・`extraEnv`・`COPILOT_DISABLE_RESUME_AUTO_CD`・`unsupportedKinds` で grep し直した結果。行番号はその時点のもの。Task 3 で行がずれているので、内容で探す）:
  - **落ちるもの（直す）**
    - `src/shared/__tests__/agentCliKinds.test.ts`: 58〜72 行「claude の能力はすべて真、copilot は changeAttribution だけ偽」（すべて真へ）
    - `src/main/__tests__/agentCliLaunchSpecs.test.ts`: 34〜37 行「足す環境変数は copilot の COPILOT_DISABLE_RESUME_AUTO_CD=1 だけ」（2 つへ）、60〜67 行の `it.each(AGENT_CLI_KINDS.filter((kind) => !agentCliCapabilities(kind).changeAttribution))`（消す。起動の表は能力の表を読まず、`claude`・`copilot` のどちらの `buildArgs` も hooks の値を受け付けるので、能力の表を差し替えても投げる種類が無い）、124〜128 行「hooks の設定のファイルが渡ったら投げる(changeAttribution は偽のまま)」（`--plugin-dir` を足す期待へ。60 行のテストの役目〈種類ごとの hooks の値の扱い〉はここと `claude` の 78〜81 行で受け持つ）
    - `src/main/__tests__/agentHookSessions.test.ts`: 135〜149 行「種類の能力に区別(changeAttribution)が無ければ…cli-unsupported」（`copilot` の計画を使っているので、`vi.mock` で能力の表を差し替える専用のファイル `agentHookSessions.capabilities.test.ts` に移す〈段階 3a の `agentSessionStarter.capabilities.test.ts` と同じ形〉。同じファイルに足す `copilot` の準備のテストにモックがかからないようにするため）。`WITH_HOOKS`・`prepare` の期待・`release` のテストを `configPath`・`discard` の形へ
    - `settingsPath` → `configPath` の改名（型検査が落ちる。`settingsFileStore.atomic.test.ts`・`settingsHandlers.apiKeyStatus.test.ts` の同名の関数は無関係）: `agentHookSessions.test.ts` 71 行（`WITH_HOOKS`）、`agentHooks.integration.test.ts` 80・126・139・148・149・150 行、`agentSessionStarter.test.ts` 845・1218 行。あわせて `hooks` に足す後始末（`discard`）を同じ箇所の値に足す
    - `src/main/__tests__/agentSessionStarter.test.ts`: 870〜876 行（`--settings` の期待は今のまま。値の名前だけ）、1215〜1227 行「hooks が設定のファイルを返しても(copilot では本来返さない)、copilot の引数には --settings を足さない」（`--plugin-dir` が付く期待へ）
    - `src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx`: 181〜212 行の describe（「copilot のタブは、作業中・作業の終わりを知らせない」を送る期待へ。絞り込みは `changeAttributionUnsupportedKinds` で保つ）
    - `src/renderer/src/lib/__tests__/agentCliMessages.test.ts`: 74〜79 行（`copilot` の注記が `null` へ）、81〜86・88〜93・95〜100 行（差し替えた能力の注記から `利用者の変更との区別` を外す）
    - `src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx`: 145〜152 行（注記が出ない期待へ）
    - 組み立ての引数（`userData` のフォルダ・プラグインのフォルダの後始末）: `src/main/__tests__/agentHooksRuntime.test.ts` 57〜64 行の `createOptions()`（省略できない引数を足す）と 135〜159 行の `deps`・`lifecycleParts` の期待、`src/main/__tests__/agentHooksLifecycle.test.ts` 15〜27 行（後始末の部品を足し、`will-quit` で呼ばれることを確かめる）、`src/main/__tests__/ipcHandlers.test.ts`（`createAgentHooksRuntime` に渡す値。`userDataDir: '/mock/userData'` の期待を足す。`app.getPath` は 119 行で `'/mock/userData'` を返す）
    - `src/main/__tests__/agentCommand.test.ts` 421〜440 行（`COPILOT_HOOK_ALLOW_LOCALHOST` の期待を足す。`COPILOT_DISABLE_RESUME_AUTO_CD` の個別の値の期待は変えない）
  - **テストの補助**: `src/renderer/src/__tests__/agentCliCapabilityOverrides.ts` に `changeAttributionUnsupportedKinds` を足し（必須の欄。L-060）、オブジェクトを作るすべてのテストを直す。計画の時点で `sessionResumeUnsupportedKinds: new Set` で grep した 9 ファイル: `src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`・`useAgentResume.test.ts`・`useAgentActivity.test.ts`・`useAgentWorkspace.test.ts`・`useAgentPromptSender.test.ts`、`src/renderer/src/lib/__tests__/agentInterrupt.test.ts`・`agentResumeAvailability.test.ts`・`promptRunAvailability.test.ts`・`agentCliMessages.test.ts`。ほかに `useAgentHooksWorkingReport.test.tsx` で新しく使う
  - **変えないもの（確かめた）**: `src/main/__tests__/agentToolActivity.test.ts` 95 行（`cli-unsupported` を直接足す）、`agentHookSessions.test.ts` の「cli-unsupported の prepared を activate すると」（`cli-unsupported` の prepared を直接作る。Task 3 で `cliKind` と `activate` の会話の ID を足し済み）、`agentCommand.test.ts` 480〜520 行（`buildAgentEnv` の個別の値）、`agentCliLaunch.integration.test.ts` の段階 3a の describe（偽の hooks で hooks なし。`--plugin-dir` は付かない）、`agentSessionStarter.capabilities.test.ts`（偽の hooks）
- Test（足す）: `agentHookSessions.test.ts`（`copilot` の準備）・`agentHookSessions.capabilities.test.ts`（新規）・`agentHooks.integration.test.ts`（`copilot` の結合）・`agentCliLaunchSpecs.test.ts`・`agentHooksRuntime.test.ts`

**Interfaces:**

- Consumes: Task 3 の `PreparedAgentHooks.cliKind`・`activate(prepared, sessionId, cliSessionId)`・`AgentHookOwnerCli`、Task 4 の `buildCopilotHookConfig`・`CopilotHookPluginSlots`・`createCopilotHookPluginSlots`・`COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME`・`CopilotHookConfigJson`
- Produces: `AgentHookPreparation = { configPath: string; token: string; discard: () => void }`、`AgentHookSessionsDeps.copilotPlugins`、`AgentCliLaunchSpec.buildArgs(launch, claudeSessionId, hookConfigPath)`、`AgentHooksRuntimeOptions.userDataDir`、`AgentHooksLifecycleParts.copilotPlugins`、`AgentCliCapabilityOverrides.changeAttributionUnsupportedKinds`。能力の表の `copilot` の `changeAttribution: true`（renderer の作業中の知らせ・Task 6 の文言の前提）

- [ ] **Step 1: テストの補助に欄を足し、使うテストを直す**

`src/renderer/src/__tests__/agentCliCapabilityOverrides.ts` の冒頭のコメントの「再開の能力が無い種類が無いため」を「再開・利用者の変更との区別の能力が無い種類が無いため」にし、型と関数を次にする:

```ts
export interface AgentCliCapabilityOverrides {
  /** 画面の判定(screenActivity)と中断(interrupt)を偽にする種類 */
  unsupportedKinds: Set<AgentCliKind>
  /** プロンプトの送信(promptSend)を偽にする種類(段階 2b で copilot も送信に対応したため、送信に対応しない種類を作るときに使う) */
  promptSendUnsupportedKinds: Set<AgentCliKind>
  /** 会話の再開(sessionResume)を偽にする種類(段階 3a で copilot も再開に対応したため、再開に対応しない種類を作るときに使う) */
  sessionResumeUnsupportedKinds: Set<AgentCliKind>
  /** 利用者の変更との区別(changeAttribution)を偽にする種類(段階 3b で copilot も区別に対応したため、区別に対応しない種類を作るときに使う) */
  changeAttributionUnsupportedKinds: Set<AgentCliKind>
}
```

`overrideAgentCliCapabilities` の doc コメントの最後に「changeAttributionUnsupportedKinds の種類は changeAttribution を」を足し、`sessionResume` の行の後に次を足す:

```ts
if (overrides.changeAttributionUnsupportedKinds.has(kind)) capabilities.changeAttribution = false
```

9 つのファイルのオブジェクトに欄を足すスクリプト（`$S/add-change-attribution-override.py`）を書いて実行する:

```python
# -*- coding: utf-8 -*-
# 能力の差し替えの補助のオブジェクトに changeAttributionUnsupportedKinds を足す(各ファイルでちょうど 1 か所)
import re
import sys

pattern = re.compile(
    r'^(\s*)sessionResumeUnsupportedKinds: (new Set(?:<AgentCliKind>)?\(\))(,?)$', re.MULTILINE
)
for target in sys.argv[1:]:
    text = open(target, encoding='utf-8').read()
    matches = pattern.findall(text)
    assert len(matches) == 1, f'{target}: {len(matches)} か所'
    text = pattern.sub(
        lambda m: f'{m.group(1)}sessionResumeUnsupportedKinds: {m.group(2)},\n'
        f'{m.group(1)}changeAttributionUnsupportedKinds: {m.group(2)}{m.group(3)}',
        text,
    )
    open(target, 'w', encoding='utf-8').write(text)
print('ok')
```

```bash
cd <repo-root>
S=<scratchpad の絶対パス>
python3 "$S/add-change-attribution-override.py" \
  src/renderer/src/hooks/__tests__/usePromptRunner.test.ts \
  src/renderer/src/hooks/__tests__/useAgentResume.test.ts \
  src/renderer/src/hooks/__tests__/useAgentActivity.test.ts \
  src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts \
  src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts \
  src/renderer/src/lib/__tests__/agentInterrupt.test.ts \
  src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts \
  src/renderer/src/lib/__tests__/promptRunAvailability.test.ts \
  src/renderer/src/lib/__tests__/agentCliMessages.test.ts
grep -rln "sessionResumeUnsupportedKinds: new Set" src/renderer/src | sort
grep -rln "changeAttributionUnsupportedKinds: new Set" src/renderer/src | sort
```

Expected: `ok`。2 つの `grep` が同じ 9 ファイルを出す（増えていれば、増えたファイルにも同じスクリプトをかける）

- [ ] **Step 2: 失敗するテストを書く（能力の表・起動の表・環境変数）**

1. `src/shared/__tests__/agentCliKinds.test.ts` の 58 行のテストを次にする:

```ts
it('claude・copilot の能力はすべて真(段階 3a で sessionResume、段階 3b で changeAttribution も真にした)', () => {
  for (const kind of ['claude', 'copilot'] as const) {
    expect(agentCliCapabilities(kind)).toEqual({
      promptSend: true,
      screenActivity: true,
      interrupt: true,
      changeAttribution: true,
      sessionResume: true
    })
  }
})
```

2. `src/main/__tests__/agentCliLaunchSpecs.test.ts`: `const HOOKS = …` の後に `const PLUGIN_DIR = '/u/agent-hooks-copilot/slot-1'` を足す。34〜37 行を次にする:

```ts
it('足す環境変数は copilot の COPILOT_DISABLE_RESUME_AUTO_CD=1 と COPILOT_HOOK_ALLOW_LOCALHOST=1(保存先への自動の移動を止める・127.0.0.1 の http の hook を読ませる)', () => {
  expect(AGENT_CLI_LAUNCH_SPECS.claude.extraEnv).toEqual({})
  expect(AGENT_CLI_LAUNCH_SPECS.copilot.extraEnv).toEqual({
    COPILOT_DISABLE_RESUME_AUTO_CD: '1',
    COPILOT_HOOK_ALLOW_LOCALHOST: '1'
  })
})
```

60〜67 行の `it.each(AGENT_CLI_KINDS.filter((kind) => !agentCliCapabilities(kind).changeAttribution))(…)` を消す。124〜128 行を次の 2 つにする:

```ts
it('hooks のフォルダのパスがあれば、後ろに --plugin-dir <パス> を足す(new・resume とも。ほかの引数は足さない)', () => {
  expect(buildArgs(NEW, ID, PLUGIN_DIR)).toEqual(['--session-id', ID, '--plugin-dir', PLUGIN_DIR])
  expect(buildArgs(RESUME, ID, PLUGIN_DIR)).toEqual([`--resume=${ID}`, '--plugin-dir', PLUGIN_DIR])
})

it.each<[string, string]>([
  ['相対パス', 'agent-hooks-copilot/slot-1'],
  ['- 始まり', '--yolo'],
  ['空文字', '']
])(
  'hooks のフォルダのパスが絶対パスでなければ(%s)、値を文言に入れずに投げる(L-017・L-034)',
  (_label, value) => {
    for (const launch of [NEW, RESUME]) {
      const message = thrownMessage(() => buildArgs(launch, ID, value))
      expect(message).toBe('copilot の起動の hooks のフォルダのパスが正しくありません')
      if (value !== '') expect(message).not.toContain(value)
    }
  }
)
```

3. `src/main/__tests__/agentCommand.test.ts` の 421 行のテストの名前を `copilot の計画の環境変数には COPILOT_DISABLE_RESUME_AUTO_CD=1(利用者の 0 を上書き)と COPILOT_HOOK_ALLOW_LOCALHOST=1 を足し、claude の計画は利用者の値のまま` にし、`expect(claude.plan.env.COPILOT_DISABLE_RESUME_AUTO_CD).toBe('0')` の後に足す:

```ts
expect(copilot.plan.env.COPILOT_HOOK_ALLOW_LOCALHOST).toBe('1')
expect(claude.plan.env).not.toHaveProperty('COPILOT_HOOK_ALLOW_LOCALHOST')
```

- [ ] **Step 3: 失敗するテストを書く（準備・組み立て・後始末）**

1. `src/main/__tests__/agentHookSessions.test.ts`:
   - import に `import { buildCopilotHookConfig } from '../agentCopilotHookPlugin'` を足す
   - 定数を足す: `const SLOT = { number: 1, dir: '/u/agent-hooks-copilot/slot-1' }` と `const COPILOT_PLAN: AgentLaunchPlan = { cliKind: 'copilot', file: '/bin/copilot', args: [], env: { PATH: '/p' } }`
   - `deps` の型と `beforeEach` に `copilotPlugins` を足す:

```ts
copilotPlugins: {
  acquire: ReturnType<typeof vi.fn>
  release: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
}
```

```ts
    copilotPlugins: {
      acquire: recorder('acquire', () => SLOT),
      release: recorder('release', () => undefined),
      write: recorder('write', async () => undefined)
    },
```

- `WITH_HOOKS` を `{ ownerId: 7, cliKind: 'claude', hooks: { configPath: '/tmp/hooks-dir/f.json', token: TOKEN, discard: () => undefined }, unavailableReason: null }` にする
- 76 行のテストの期待を次にする（`discard` は関数であることだけを比べる）:

```ts
await expect(sessions().prepare(7, PLAN)).resolves.toEqual({
  ownerId: 7,
  cliKind: 'claude',
  hooks: { configPath: '/tmp/hooks-dir/f.json', token: TOKEN, discard: expect.any(Function) },
  unavailableReason: null
})
```

- 135〜149 行のテスト（`cli-unsupported`）を消す（Step 3 の 2 のファイルへ移す）
- `release` の 2 つのテスト（「release は hooks があれば…」「release(prepared, null) は…」。「hooks: null でも sessionId があれば追跡から外す」は変えない）を `prepare` が返した値で確かめる形にする:

```ts
it('release は hooks があればトークンを表から外して後始末(claude は設定のファイルを消す)をし、sessionId があれば追跡から外す', async () => {
  const prepared = await sessions().prepare(7, PLAN)
  sessions().release(prepared, 'sid-1')
  expect(deps.receiver.removeToken).toHaveBeenCalledExactlyOnceWith(TOKEN)
  expect(deps.removeSettingsFile).toHaveBeenCalledExactlyOnceWith('/tmp/hooks-dir/f.json')
  expect(deps.tracker.removeSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1')
})

it('release(prepared, null) は追跡に触らない(起動しなかった)', async () => {
  const prepared = await sessions().prepare(7, PLAN)
  sessions().release(prepared, null)
  expect(deps.removeSettingsFile).toHaveBeenCalledOnce()
  expect(deps.tracker.removeSession).not.toHaveBeenCalled()
})

it('トークンの除去が投げても後始末(discard)と追跡からの除去を試し、ログに出す(L-001・L-053)', () => {
  deps.receiver.removeToken.mockImplementationOnce(() => {
    throw new Error('boom')
  })
  const discard = vi.fn()
  sessions().release({ ...WITH_HOOKS, hooks: { configPath: '/x', token: TOKEN, discard } }, 'sid-1')
  expect(discard).toHaveBeenCalledOnce()
  expect(deps.tracker.removeSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1')
  expect(deps.log).toHaveBeenCalledWith('[agent-hooks] hooks のトークンを外せませんでした: boom')
})
```

- 末尾に `copilot` の準備の describe を足す:

```ts
describe('createAgentHookSessions: prepare・release(copilot。段階 3b)', () => {
  it('版を確かめず(L-052)、受け口 → 枠 → 書き直しの順に行い、プラグインのフォルダのパスとトークンを返す(トークンはまだ表に足さない)', async () => {
    await expect(sessions().prepare(7, COPILOT_PLAN)).resolves.toEqual({
      ownerId: 7,
      cliKind: 'copilot',
      hooks: { configPath: SLOT.dir, token: TOKEN, discard: expect.any(Function) },
      unavailableReason: null
    })
    expect(calls.map((call) => call.split('(')[0])).toEqual(['ensureListening', 'acquire', 'write'])
    expect(deps.copilotPlugins.write).toHaveBeenCalledExactlyOnceWith(
      SLOT,
      buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN })
    )
    expect(deps.versions.readClaudeVersion).not.toHaveBeenCalled()
    expect(deps.settingsDir.ensure).not.toHaveBeenCalled()
    expect(deps.writeSettingsFile).not.toHaveBeenCalled()
    expect(deps.receiver.addToken).not.toHaveBeenCalled()
  })

  it('受け口の失敗は枠を取らずに receiver-unavailable(例外にしない)', async () => {
    deps.receiver.ensureListening.mockRejectedValueOnce(new Error('EADDRINUSE'))
    await expect(sessions().prepare(7, COPILOT_PLAN)).resolves.toEqual({
      ownerId: 7,
      cliKind: 'copilot',
      hooks: null,
      unavailableReason: 'receiver-unavailable'
    })
    expect(deps.copilotPlugins.acquire).not.toHaveBeenCalled()
  })

  it('枠が空いていなければ書き直さずに receiver-unavailable', async () => {
    deps.copilotPlugins.acquire.mockReturnValueOnce(null)
    await expect(sessions().prepare(7, COPILOT_PLAN)).resolves.toMatchObject({
      hooks: null,
      unavailableReason: 'receiver-unavailable'
    })
    expect(deps.copilotPlugins.write).not.toHaveBeenCalled()
    expect(deps.log).toHaveBeenCalledWith(
      '[agent-hooks] copilot の hooks のフォルダの枠が空いていません'
    )
  })

  it('書き直しの失敗は枠を返して receiver-unavailable。ログにトークンを入れない', async () => {
    deps.copilotPlugins.write.mockRejectedValueOnce(new Error('EACCES: /Users/u/x'))
    await expect(sessions().prepare(7, COPILOT_PLAN)).resolves.toMatchObject({
      hooks: null,
      unavailableReason: 'receiver-unavailable'
    })
    expect(deps.copilotPlugins.release).toHaveBeenCalledExactlyOnceWith(SLOT)
    for (const [message] of deps.log.mock.calls as [string][]) expect(message).not.toContain(TOKEN)
  })

  it('release は枠を返し(hooks.json は消さない)、トークンを外し、追跡から外す', async () => {
    const prepared = await sessions().prepare(7, COPILOT_PLAN)
    sessions().release(prepared, 'sid-1')
    expect(deps.copilotPlugins.release).toHaveBeenCalledExactlyOnceWith(SLOT)
    expect(deps.receiver.removeToken).toHaveBeenCalledExactlyOnceWith(TOKEN)
    expect(deps.removeSettingsFile).not.toHaveBeenCalled()
    expect(deps.tracker.removeSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1')
  })

  it('起動しなかったとき(release(prepared, null))も枠を返す(取り消し・ID の選択の拒否・spawn の失敗。L-061)', async () => {
    const prepared = await sessions().prepare(7, COPILOT_PLAN)
    sessions().release(prepared, null)
    expect(deps.copilotPlugins.release).toHaveBeenCalledExactlyOnceWith(SLOT)
    expect(deps.tracker.removeSession).not.toHaveBeenCalled()
  })
})
```

2. `src/main/__tests__/agentHookSessions.capabilities.test.ts` を作る:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { AgentCliCapabilities, AgentCliKind } from '@shared/agentCliKinds'

// 能力の表の changeAttribution が偽の種類の流れ(cli-unsupported)を確かめるため、能力の表を差し替える(段階 3b で copilot も区別に
// 対応し、今の表には該当する種類が無い。将来の種類の守り)。差し替えはこのファイルの中だけ(agentHookSessions.test.ts の copilot の
// 準備のテストにかからないよう、ファイルを分けた)
const capabilityOverrides = vi.hoisted(() => ({
  changeAttributionUnsupportedKinds: new Set<AgentCliKind>(['copilot'])
}))
vi.mock('@shared/agentCliKinds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/agentCliKinds')>()
  return {
    ...actual,
    agentCliCapabilities: (kind: AgentCliKind): AgentCliCapabilities => {
      const capabilities = { ...actual.agentCliCapabilities(kind) }
      if (capabilityOverrides.changeAttributionUnsupportedKinds.has(kind)) {
        capabilities.changeAttribution = false
      }
      return capabilities
    }
  }
})

import { createAgentHookSessions } from '../agentHookSessions'
import type { AgentHookSessionsDeps } from '../agentHookSessions'
import type { AgentLaunchPlan } from '../agentCommand'

describe('createAgentHookSessions(区別に対応しない種類)', () => {
  it('種類の能力に区別(changeAttribution)が無ければ、版の読み取りも受け口・枠の用意もせず cli-unsupported(L-043)', async () => {
    const deps = {
      receiver: { ensureListening: vi.fn(), addToken: vi.fn(), removeToken: vi.fn() },
      settingsDir: { ensure: vi.fn() },
      tracker: { addSession: vi.fn(), removeSession: vi.fn() },
      versions: { readClaudeVersion: vi.fn() },
      writeSettingsFile: vi.fn(),
      removeSettingsFile: vi.fn(),
      copilotPlugins: { acquire: vi.fn(), release: vi.fn(), write: vi.fn() },
      log: vi.fn()
    }
    const plan: AgentLaunchPlan = {
      cliKind: 'copilot',
      file: '/bin/copilot',
      args: [],
      env: { PATH: '/p' }
    }
    const sessions = createAgentHookSessions(deps as unknown as AgentHookSessionsDeps)
    await expect(sessions.prepare(7, plan)).resolves.toEqual({
      ownerId: 7,
      cliKind: 'copilot',
      hooks: null,
      unavailableReason: 'cli-unsupported'
    })
    for (const fn of [
      deps.receiver.ensureListening,
      deps.settingsDir.ensure,
      deps.versions.readClaudeVersion,
      deps.writeSettingsFile,
      deps.copilotPlugins.acquire,
      deps.copilotPlugins.write,
      deps.log
    ]) {
      expect(fn).not.toHaveBeenCalled()
    }
  })
})
```

3. `src/main/__tests__/agentHooksRuntime.test.ts`:
   - `mockCreateAgentHookSessions` の後に、プラグインのフォルダのモックを足す:

```ts
const mockCopilotPlugins = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  write: vi.fn(),
  removeTokenFilesSync: vi.fn()
}))
const mockCreateCopilotHookPluginSlots = vi.hoisted(() => vi.fn(() => mockCopilotPlugins))
vi.mock('../agentCopilotHookPlugin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentCopilotHookPlugin')>()),
  createCopilotHookPluginSlots: mockCreateCopilotHookPluginSlots
}))
```

- `createOptions()` に `userDataDir: '/u/data'` を足す
- 135 行のテストの期待に `expect(deps.copilotPlugins).toBe(mockCopilotPlugins)` を足し、148 行のテストの `lifecycleParts` の `toEqual` に `copilotPlugins: mockCopilotPlugins` を足し、`expect(runtime.lifecycleParts.copilotPlugins).toBe(mockCopilotPlugins)` を足す
- テストを足す:

```ts
it('copilot のプラグインのフォルダは <userData>/agent-hooks-copilot に置く(userData は渡された値。L-019)', () => {
  createAgentHooksRuntime(createOptions())
  expect(mockCreateCopilotHookPluginSlots).toHaveBeenCalledExactlyOnceWith({
    rootDir: join('/u/data', 'agent-hooks-copilot')
  })
})
```

4. `src/main/__tests__/agentHooksLifecycle.test.ts` の `setup` に `copilotPlugins: { removeTokenFilesSync: ReturnType<typeof vi.fn> }` を足し（`const copilotPlugins = { removeTokenFilesSync: vi.fn() }` を作って `setupAgentHooksLifecycle` に渡し、戻り値にも入れる）、「will-quit で受け口・設定のディレクトリ・追跡を 1 回ずつ片付け」のテストの名前に「copilot の hooks の設定のファイル」を足して `expect(copilotPlugins.removeTokenFilesSync).toHaveBeenCalledOnce()` を足す。「1 つが投げても残りを呼ぶ」にも `expect(copilotPlugins.removeTokenFilesSync).toHaveBeenCalledOnce()` を足す

5. `src/main/__tests__/ipcHandlers.test.ts` の「組み立てた hooks の準備を starter に…」のテストの後に足す:

```ts
it('copilot の hooks のフォルダの置き場として userData のパスを hooks の組み立てに渡す', () => {
  registerIpcHandlers(mockIpcMain)
  expect((mockCreateAgentHooksRuntime.mock.calls[0] as unknown[])[0]).toMatchObject({
    userDataDir: '/mock/userData'
  })
})
```

6. `src/main/__tests__/agentSessionStarter.test.ts`: 845 行の `PREPARED` の `hooks` を `{ configPath: '/tmp/prompt-ide-agent-hooks-x/abc.json', token: 'ab'.repeat(32), discard: () => undefined }` にする。1215〜1227 行のテストを次にする:

```ts
it('hooks がプラグインのフォルダを返したら、copilot の引数の後ろに --plugin-dir <パス> を足す', async () => {
  hooks = makeFakeAgentHookSessions((ownerId) => ({
    ownerId,
    cliKind: 'copilot',
    hooks: {
      configPath: '/u/agent-hooks-copilot/slot-1',
      token: 'ab'.repeat(32),
      discard: () => undefined
    },
    unavailableReason: null
  }))
  await makeStarter({ hooks })(1, REQUEST, makeSink())
  expect(spawnPty).toHaveBeenCalledWith(
    '/bin/copilot',
    ['--session-id', NEW_IDS[0], '--plugin-dir', '/u/agent-hooks-copilot/slot-1'],
    expect.any(Object)
  )
})
```

7. `src/main/__tests__/agentHooks.integration.test.ts`:
   - import を足す: `mkdtempSync`（`node:fs`）、`tmpdir`（`node:os`）、`join`（`node:path`）、`createCopilotHookPluginSlots`・`COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME`・型 `CopilotHookConfigJson`・`CopilotHookPluginSlots`（`../agentCopilotHookPlugin`）、型 `CopilotHookEventName`（`../agentHookProtocol`）
   - 冒頭のコメントを「受け口・追跡・agentHookSessions を実物で組み立て、claude・copilot が送る形の要求を送る(claude・copilot は起動しない)。URL とトークンは prepare が書いた設定のファイル(claude)・hooks.json(copilot)から読む…」にする
   - `let userDataDir: string` と `let copilotPlugins: CopilotHookPluginSlots` を足し、`beforeEach` の `settingsDir = …` の後に次を足して、`createAgentHookSessions` に `copilotPlugins` を渡す:

```ts
userDataDir = mkdtempSync(join(tmpdir(), 'prompt-ide-hooks-it-'))
copilotPlugins = createCopilotHookPluginSlots({
  rootDir: join(userDataDir, COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME)
})
```

- `afterEach` に `copilotPlugins.removeTokenFilesSync()` と `rmSync(userDataDir, { recursive: true, force: true })` を足す
- `prepared.hooks.settingsPath` を `prepared.hooks.configPath` に、`first.hooks?.settingsPath`・`second.hooks?.settingsPath` を `…configPath` にする（80・126・139・148・149・150 行）
- 末尾に足す:

```ts
describe('copilot の hooks の受け取りと区間の追跡(結合。段階 3b)', () => {
  const MAIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const SUB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const NEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const COPILOT_PLAN = { cliKind: 'copilot' as const, file: '/bin/copilot', args: [], env: {} }

  /** hooks.json のイベントの URL へ、copilot の PascalCase の形(Bearer・application/json。記録の本文の形)で POST する */
  function copilotPoster(
    config: CopilotHookConfigJson
  ): (
    event: CopilotHookEventName,
    body: Record<string, unknown>,
    authorization?: string
  ) => Promise<HookResponse> {
    return (event, body, authorization) => {
      const hook = config.hooks[event][0]
      const url = new URL(hook.url)
      return sendHookRequest(Number(url.port), {
        path: url.pathname,
        headers: {
          Authorization: authorization ?? hook.headers.Authorization,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ hook_event_name: event, ...body })
      })
    }
  }

  const waitForIdle = async (): Promise<void> => {
    await vi.waitFor(() => expect(tracker.activityOf(1).phase).toBe('idle'), {
      timeout: 4_000,
      interval: 100
    })
  }

  it('prepare が書いた hooks.json の URL・トークンで、区間の開閉・サブエージェント・/clear の採り直しが追跡に届く。不正なトークンは 200 で追跡を変えない。release で枠が返る', async () => {
    const prepared = await sessions.prepare(1, COPILOT_PLAN)
    if (prepared.hooks === null) throw new Error('hooks を用意できなかった')
    expect(prepared.hooks.configPath).toBe(join(userDataDir, 'agent-hooks-copilot', 'slot-1'))
    const config = JSON.parse(
      readFileSync(join(prepared.hooks.configPath, 'hooks', 'hooks.json'), 'utf8')
    ) as CopilotHookConfigJson
    const post = copilotPoster(config)
    sessions.activate(prepared, 'sid-1', MAIN)
    expect(tracker.activityOf(1).phase).toBe('agent')

    // 不正なトークンは 200 で、追跡は pending(agent)のまま
    expect(
      (await post('UserPromptSubmit', { session_id: MAIN }, `Bearer ${'0'.repeat(64)}`)).status
    ).toBe(200)
    expect(tracker.activityOf(1).phase).toBe('agent')

    // 主のプロンプトで確かめ、主のツールの区間が開いて閉じる
    expect((await post('UserPromptSubmit', { session_id: MAIN, prompt: 'hi' })).status).toBe(200)
    expect(tracker.activityOf(1).phase).toBe('idle')
    await post('PreToolUse', {
      session_id: MAIN,
      tool_name: 'Edit',
      tool_input: { path: '/x/a.txt' }
    })
    expect(tracker.activityOf(1).phase).toBe('agent')
    await post('PostToolUse', { session_id: MAIN, tool_name: 'Edit' })
    await waitForIdle()

    // サブエージェント: 中の Stop でそのグループを閉じる(主の Stop を待たない)
    await post('PreToolUse', { session_id: SUB, tool_name: 'Write' })
    expect(tracker.activityOf(1).phase).toBe('agent')
    await post('Stop', { session_id: SUB })
    await waitForIdle()

    // /clear: 主の SessionEnd → 新しい ID のプロンプトで採り直し → その ID の Stop で主の区間を閉じる
    await post('SessionEnd', { session_id: MAIN, reason: 'clear' })
    await post('UserPromptSubmit', { session_id: NEW })
    await post('PreToolUse', { session_id: NEW, tool_name: 'Bash' })
    expect(tracker.activityOf(1).phase).toBe('agent')
    await post('Stop', { session_id: NEW })
    await waitForIdle()

    sessions.release(prepared, 'sid-1')
    expect((await post('Stop', { session_id: NEW })).status).toBe(200)
    expect(tracker.activityOf(1).phase).toBe('paused')
    // 枠は返り、次の prepare は同じ slot-1 を使う(hooks.json は新しいトークンで書き直される)
    const next = await sessions.prepare(1, COPILOT_PLAN)
    expect(next.hooks?.configPath).toBe(prepared.hooks.configPath)
    expect(next.hooks?.token).not.toBe(prepared.hooks.token)
    sessions.release(next, null)
  }, 20_000)
})
```

8. renderer:
   - `src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx`: import の `beforeEach` の並びに `afterEach` を足し、`vi.mock('../../lib/agentTerminalApi', …)` の後に能力の表の差し替えを足す:

```ts
import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

// 区別をしない種類のタブを知らせない絞り込みを確かめるため、能力の表の changeAttribution を種類ごとに偽にできるようにする
// (段階 3b で copilot も区別に対応し、今の表には該当する種類が無い)
const capabilityOverrides = vi.hoisted(
  (): AgentCliCapabilityOverrides => ({
    unsupportedKinds: new Set<AgentCliKind>(),
    promptSendUnsupportedKinds: new Set<AgentCliKind>(),
    sessionResumeUnsupportedKinds: new Set<AgentCliKind>(),
    changeAttributionUnsupportedKinds: new Set<AgentCliKind>()
  })
)
vi.mock('@shared/agentCliKinds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/agentCliKinds')>()
  const { overrideAgentCliCapabilities } =
    await import('../../__tests__/agentCliCapabilityOverrides')
  return {
    ...actual,
    agentCliCapabilities: overrideAgentCliCapabilities(
      actual.agentCliCapabilities,
      capabilityOverrides
    )
  }
})

afterEach(() => {
  capabilityOverrides.changeAttributionUnsupportedKinds.clear()
})
```

     （`import type { AgentCliKind } from '@shared/agentCliKinds'` はファイルの冒頭にあるので、`vi.hoisted` の型注釈に使える。`vi.mock` と `vi.hoisted` は import より前に巻き上げられる）

     181〜212 行の describe を次にする:

```ts
describe('useAgentHooksWorkingReport(変更の区別をする種類・しない種類)', () => {
  it('copilot のタブも、作業中・作業の終わりを知らせる(段階 3b で copilot も区別に対応した)', () => {
    const tabs = [tab('a', 'sid-a', 'copilot')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReport).toHaveBeenCalledExactlyOnceWith('sid-a')
    expect(mockReportEnded).toHaveBeenCalledExactlyOnceWith('sid-a')
  })

  it('能力の表で区別をしない種類(差し替えた copilot)のタブは、作業中・作業の終わりを知らせない', () => {
    capabilityOverrides.changeAttributionUnsupportedKinds.add('copilot')
    const tabs = [tab('a', 'sid-a', 'copilot')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReport).not.toHaveBeenCalled()
    expect(mockReportEnded).not.toHaveBeenCalled()
  })

  it('claude と区別をしない種類のタブが並んでいても、claude のタブだけを今までどおり知らせる', () => {
    capabilityOverrides.changeAttributionUnsupportedKinds.add('copilot')
    const tabs = [tab('a', 'sid-a'), tab('b', 'sid-b', 'copilot')]
    const { rerender } = render({
      tabs,
      activities: activitiesOf([
        ['a', 'working'],
        ['b', 'working']
      ])
    })
    rerender({
      tabs,
      activities: activitiesOf([
        ['a', 'idle'],
        ['b', 'idle']
      ])
    })
    expect(mockReport.mock.calls).toEqual([['sid-a']])
    expect(mockReportEnded.mock.calls).toEqual([['sid-a']])
  })
})
```

- `src/renderer/src/lib/__tests__/agentCliMessages.test.ts`: 74〜79 行のテストを次にし、81〜100 行の 3 つの期待の末尾の `、利用者の変更との区別`（再開の行は `利用者の変更との区別、` の部分）を外し、区別の能力の差し替えのテストを足す。`afterEach` に `capabilityOverrides.changeAttributionUnsupportedKinds.clear()` を足す:

```ts
it('使えない機能の注記: copilot も claude もすべての機能を使えるので出さない(段階 2a〜3b で対応した)', () => {
  expect(agentCliUnsupportedFeaturesNote('copilot')).toBeNull()
  expect(agentCliUnsupportedFeaturesNote('claude')).toBeNull()
})
```

     直した後の 3 つの期待は、順に `'copilot では次の機能を使えません（ターミナルで直接操作します）: 作業中・入力待ちの表示と通知、中断'`・`'…: プロンプトの送信（実行・再実行）'`・`'…: 前回の続きから・このセッションで再開'`（`…` は `copilot では次の機能を使えません（ターミナルで直接操作します）`）。足すテスト:

```ts
it('使えない機能の注記: 区別が無い種類(能力の表を差し替えた copilot)は、区別の名前を並べる', () => {
  capabilityOverrides.changeAttributionUnsupportedKinds.add('copilot')
  expect(agentCliUnsupportedFeaturesNote('copilot')).toBe(
    'copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別'
  )
})
```

- `src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx` の 145〜152 行のテストを次にする:

```ts
  it('copilot を選んでも、使えない機能の注記を出さない(段階 3b ですべての機能に対応した)', () => {
    render(<AgentCliKindSection {...props({ kind: 'copilot' })} />)
    expect(screen.queryByText(/では次の機能を使えません/)).toBeNull()
  })
```

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `npx vitest run src/shared/__tests__/agentCliKinds.test.ts src/main/__tests__/agentCliLaunchSpecs.test.ts src/main/__tests__/agentCommand.test.ts src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentHookSessions.capabilities.test.ts src/main/__tests__/agentHooksRuntime.test.ts src/main/__tests__/agentHooksLifecycle.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/agentHooks.integration.test.ts src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx`
Expected: FAIL（`copilot` の `changeAttribution` が偽・`--plugin-dir` を足さない・`extraEnv` が 1 つ・`copilotPlugins` を使わない・`userDataDir` を渡さない など）

- [ ] **Step 5: 能力の表を直す（`src/shared/agentCliKinds.ts`）**

`copilot` の `changeAttribution: false` を `true` にする。`AgentCliCapabilities.changeAttribution` のコメントを次にする:

```ts
/** hooks によるエージェントの変更と利用者の変更の区別と、画面の作業中・作業の終わりを main の区間の追跡へ知らせること(claude は --settings、
 *  copilot は --plugin-dir で 1 回の起動だけに効く hooks を渡す。copilot はツールの呼び出しの ID が無いため区別が粗い。段階 3b) */
changeAttribution: boolean
```

- [ ] **Step 6: 起動の表を直す（`src/main/agentCliLaunchSpecs.ts`）**

import に `import { isAbsolute } from 'node:path'` を足す。冒頭のコメントの「引数に入れるのは、main が振った・記録と照合した会話の ID と main が作った設定のファイルの絶対パスだけ(L-034)。能力の表(sessionResume・changeAttribution)に合わない値が渡ったら投げる」を「引数に入れるのは、main が振った・記録と照合した会話の ID と、main が作った hooks の設定のファイル(claude)・プラグインのフォルダ(copilot)の絶対パスだけ(L-034)。能力の表(sessionResume)に合わない値が渡ったら投げる」にする。`buildArgs` の宣言とコメントを次にする:

```ts
  /**
   * 起動の引数。claudeSessionId は能力の表で sessionResume が true の種類だけが受け取り、false の種類に値が渡ったら投げる
   * (呼び出し側の取り違えを黙って捨てない。L-044)。hookConfigPath は claude では設定のファイル(--settings)、copilot では
   * プラグインのフォルダ(--plugin-dir)。hooks なしなら null
   */
  buildArgs(
    launch: AgentLaunchRequest,
    claudeSessionId: string | null,
    hookConfigPath: string | null
  ): string[]
```

`buildClaudeArgs` の引数名を `hookConfigPath` にする（中身の `hookSettingsPath` も同じ名前に。引数の配列は変えない）。`buildCopilotArgs` を次にする（doc コメントの最後に「hookConfigPath があれば後ろに --plugin-dir を足す(段階 3b)」を足す）:

```ts
function buildCopilotArgs(
  launch: AgentLaunchRequest,
  claudeSessionId: string | null,
  hookConfigPath: string | null
): string[] {
  if (claudeSessionId === null) throw new Error('copilot の起動には会話の ID が要ります')
  // (今のまま: isClaudeSessionId の確かめ)
  if (!isClaudeSessionId(claudeSessionId)) {
    throw new Error('copilot の起動の会話の ID の形が正しくありません')
  }
  // main が作ったプラグインのフォルダの絶対パスしか来ない想定の最後の守り(L-034)。値を文言に入れない(L-017)
  if (hookConfigPath !== null && !isAbsolute(hookConfigPath)) {
    throw new Error('copilot の起動の hooks のフォルダのパスが正しくありません')
  }
  const pluginDir = hookConfigPath === null ? [] : ['--plugin-dir', hookConfigPath]
  switch (launch.kind) {
    case 'new':
      return ['--session-id', claudeSessionId, ...pluginDir]
    case 'resume':
      return [`--resume=${claudeSessionId}`, ...pluginDir]
    default:
      return throwUnknownLaunch(launch)
  }
}
```

`copilot` の `extraEnv` とコメントを次にする:

```ts
    // COPILOT_DISABLE_RESUME_AUTO_CD: 再開したときに copilot の中の作業フォルダが保存先へ移るのを止める(許可のフォルダの外で動き出さない。
    // -C と違い copilot の保存先〈workspace.yaml の cwd〉を書き換えない。設計書 2026-10-23「-C ではなく環境変数にした理由」)。
    // COPILOT_HOOK_ALLOW_LOCALHOST: 127.0.0.1 の受け口への http の hook を読ませる(無いと preToolUse を含む hooks のファイルが丸ごと
    // 捨てられる。設計書 2026-10-26)。どちらも起動の計画を起動の指定・hooks の準備の結果に依存させないため常に足す
    extraEnv: { COPILOT_DISABLE_RESUME_AUTO_CD: '1', COPILOT_HOOK_ALLOW_LOCALHOST: '1' },
```

- [ ] **Step 7: 準備の表と後始末を実装する（`src/main/agentHookSessions.ts`）**

冒頭のコメントを次にする:

```ts
// starter に注入する hooks の準備・結び付け・解放(設計書「起動への組み込み」、段階 3b の設計書「プラグインのフォルダ」)。prepare は
// pty の sessionId を使わない(sessionId は spawn の直前の await を挟まない区間で振るため)。準備は種類ごとの表で決める(claude は版の確認 →
// 受け口 → 設定のファイル、copilot は版を確かめず受け口 → 枠 → プラグインのフォルダの書き直し。L-052・L-060)。トークンは spawn の後の
// activate で初めて表に足す。prepare は失敗しても null を返さず、hooks なしで起動する理由を返す(L-001)
```

import に `import { buildCopilotHookConfig } from './agentCopilotHookPlugin'` と `import type { CopilotHookPluginSlots } from './agentCopilotHookPlugin'` を足し、型を次にする:

```ts
/** hooks を渡す起動の準備の結果 */
export interface AgentHookPreparation {
  /** 起動の引数に渡す絶対パス(claude は設定のファイル、copilot はプラグインのフォルダ) */
  configPath: string
  token: string
  /** 起動しなかった・終了したときの後始末(claude は設定のファイルを消し、copilot は枠を返す。hooks.json は消さない) */
  discard: () => void
}

export type PreparedAgentHooks =
  | {
      ownerId: number
      /** 起動の計画の種類(main が読んだ設定。L-018) */
      cliKind: AgentCliKind
      hooks: AgentHookPreparation
      unavailableReason: null
    }
  | {
      ownerId: number
      cliKind: AgentCliKind
      hooks: null
      unavailableReason: AgentHooksUnavailableReason
    }
```

`AgentHookSessionsDeps` の `removeSettingsFile` の後に足す:

```ts
/** copilot のプラグインのフォルダの枠(main 全体で 1 つ。組み立ては agentHooksRuntime.ts) */
copilotPlugins: Pick<CopilotHookPluginSlots, 'acquire' | 'release' | 'write'>
```

`createAgentHookSessions` の中身を次にする（`OWNER_CLI_OF`・`createRandomToken`・`messageOf` は今のまま）:

```ts
export function createAgentHookSessions({
  receiver,
  settingsDir,
  tracker,
  versions,
  writeSettingsFile,
  removeSettingsFile,
  copilotPlugins,
  log,
  createToken = createRandomToken
}: AgentHookSessionsDeps): AgentHookSessions {
  const without = (
    ownerId: number,
    cliKind: AgentCliKind,
    unavailableReason: AgentHooksUnavailableReason
  ): PreparedAgentHooks => ({ ownerId, cliKind, hooks: null, unavailableReason })

  /** 種類ごとの準備。成功なら hooks の値、失敗なら hooks なしで起動する理由を返す(例外にしない) */
  type KindPreparer = (
    plan: AgentLaunchPlan,
    token: string
  ) => Promise<AgentHookPreparation | AgentHooksUnavailableReason>

  const prepareClaude: KindPreparer = async (plan, token) => {
    try {
      const check = await versions.readClaudeVersion(plan)
      if (check.kind !== 'supported') return 'claude-version-unsupported'
    } catch (err) {
      log(`[agent-hooks] claude の版を確かめられませんでした: ${messageOf(err)}`)
      return 'claude-version-unsupported'
    }
    try {
      const { baseUrl } = await receiver.ensureListening()
      const dir = await settingsDir.ensure()
      const configPath = await writeSettingsFile(dir, buildAgentHookSettings({ baseUrl, token }))
      return { configPath, token, discard: () => void removeSettingsFile(configPath) }
    } catch (err) {
      // 例外の文言にトークンは含まれない(トークンは JSON の中身だけで、パス・URL に入れない)
      log(`[agent-hooks] hooks の受け口・設定のファイルを用意できませんでした: ${messageOf(err)}`)
      return 'receiver-unavailable'
    }
  }

  // copilot の版は確かめない(L-052)。受け口 → 枠 → 書き直しの順。失敗の各段で hooks なしの起動にし、取った枠は返す
  const prepareCopilot: KindPreparer = async (_plan, token) => {
    let baseUrl: string
    try {
      ;({ baseUrl } = await receiver.ensureListening())
    } catch (err) {
      log(`[agent-hooks] hooks の受け口を用意できませんでした: ${messageOf(err)}`)
      return 'receiver-unavailable'
    }
    const slot = copilotPlugins.acquire()
    if (slot === null) {
      log('[agent-hooks] copilot の hooks のフォルダの枠が空いていません')
      return 'receiver-unavailable'
    }
    try {
      await copilotPlugins.write(slot, buildCopilotHookConfig({ baseUrl, token }))
    } catch (err) {
      copilotPlugins.release(slot)
      // fs の例外にはパス(利用者名)が入りうるので、ログにだけ出す(画面に出さない。L-017)
      log(`[agent-hooks] copilot の hooks のフォルダを用意できませんでした: ${messageOf(err)}`)
      return 'receiver-unavailable'
    }
    return { configPath: slot.dir, token, discard: () => copilotPlugins.release(slot) }
  }

  /** 種類ごとの準備の表(種類を足したときの決め忘れを型エラーにする。L-060) */
  const preparers: Record<AgentCliKind, KindPreparer> = {
    claude: prepareClaude,
    copilot: prepareCopilot
  }

  return {
    async prepare(ownerId, plan) {
      // 区別に対応しない種類(今の表には無い。将来の種類の守り)は、版の確認も受け口の用意もしない(L-043)。activate は
      // hooks === null の経路で、追跡に unconfirmed(cli-unsupported)で足す
      if (!agentCliCapabilities(plan.cliKind).changeAttribution) {
        return without(ownerId, plan.cliKind, 'cli-unsupported')
      }
      const result = await preparers[plan.cliKind](plan, createToken())
      return typeof result === 'string'
        ? without(ownerId, plan.cliKind, result)
        : { ownerId, cliKind: plan.cliKind, hooks: result, unavailableReason: null }
    },
    activate(prepared, sessionId, cliSessionId) {
      // (Task 3 のまま)
    },
    release(prepared, sessionId) {
      if (prepared.hooks !== null) {
        const { token, discard } = prepared.hooks
        // 1 つが投げても残りを試す(枠を返し損ねると、以後の copilot が hooks なしで起動する。L-001・L-053)
        try {
          receiver.removeToken(token)
        } catch (err) {
          log(`[agent-hooks] hooks のトークンを外せませんでした: ${messageOf(err)}`)
        }
        try {
          discard()
        } catch (err) {
          log(`[agent-hooks] hooks の後始末に失敗しました: ${messageOf(err)}`)
        }
      }
      if (sessionId !== null) tracker.removeSession(prepared.ownerId, sessionId)
    }
  }
}
```

（`activate` は Task 3 で書いた本体をそのまま残す。`KindPreparer` の型は関数の外に出してもよい）

- [ ] **Step 8: starter・組み立て・後始末を直す**

1. `src/main/agentSessionStarter.ts`:
   - `capabilities.changeAttribution ? (prepared.hooks?.settingsPath ?? null) : null` を `capabilities.changeAttribution ? (prepared.hooks?.configPath ?? null) : null` にする
   - その上のコメントを「検証を通った ID と、main が作った hooks の設定のファイル(claude)・プラグインのフォルダ(copilot)の絶対パスをそのまま引数にする(L-018・L-034)。区別に対応しない種類には hooks の値を渡さない」にする
   - 冒頭のコメントの「引数(--session-id / --resume と --settings)」を「引数(--session-id / --resume と、claude の --settings・copilot の --plugin-dir)」に、「claude の hooks の準備・結び付け・解放は agentHookSessions.ts」を「hooks の準備・結び付け・解放は agentHookSessions.ts」にする。`hooks` の依存のコメントの「claude の hooks の準備(prepare)」を「hooks の準備(prepare)」にする

2. `src/main/agentHooksRuntime.ts`:
   - import に `import { COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME, createCopilotHookPluginSlots } from './agentCopilotHookPlugin'` を足す
   - 冒頭のコメントの「claude の hooks の実物の依存」を「claude・copilot の hooks の実物の依存」にする
   - `AgentHooksRuntimeOptions` に足す:

```ts
/** アプリのデータのフォルダ(copilot のプラグインのフォルダ <userData>/agent-hooks-copilot の置き場)。ipcHandlers.ts が
 *  app.getPath('userData') を渡す(このモジュールは Electron に依存しない) */
userDataDir: string
```

- 引数の分割代入に `userDataDir` を足し、`settingsDir` の後に `const copilotPlugins = createCopilotHookPluginSlots({ rootDir: join(userDataDir, COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME) })` を足し、`createAgentHookSessions` に `copilotPlugins` を渡し、戻り値の `lifecycleParts` を `{ receiver, settingsDir, copilotPlugins, tracker }` にする。準備のコメントを「起動ごとの hooks の準備(claude は版の確認 → 受け口 → 設定のファイル、copilot は受け口 → 枠 → プラグインのフォルダ)・結び付け・解放」にする

3. `src/main/agentHooksLifecycle.ts`:
   - import に `import type { CopilotHookPluginSlots } from './agentCopilotHookPlugin'` を足す
   - 冒頭のコメントの「claude の hooks の後始末の契機」を「claude・copilot の hooks の後始末の契機」に、「受け口・設定のディレクトリ・追跡のタイマーを片付ける」を「受け口・設定のディレクトリ・copilot の hooks の設定のファイル(hooks.json。フォルダと plugin.json は残す)・追跡のタイマーを片付ける」にする
   - `AgentHooksLifecycleParts` に `copilotPlugins: Pick<CopilotHookPluginSlots, 'removeTokenFilesSync'>` を足し、`will-quit` の手順を次にする:

```ts
    for (const step of [
      () => receiver.close(),
      () => settingsDir.removeSync(),
      () => copilotPlugins.removeTokenFilesSync(),
      () => tracker.close()
    ]) {
```

4. `src/main/ipcHandlers.ts`: `createAgentHooksRuntime({ … })` に `userDataDir,` を足し（88 行の `const userDataDir = app.getPath('userData')` は 100 行より前にある）、97 行のコメントの「claude の hooks(ツールの区間の追跡・127.0.0.1 の受け口・起動ごとの準備)」を「claude・copilot の hooks(ツールの区間の追跡・127.0.0.1 の受け口・起動ごとの準備・copilot のプラグインのフォルダ〈userData の下〉)」にする

5. `src/renderer/src/hooks/useAgentHooksWorkingReport.ts`: 冒頭のコメントの最後の文を「変更の区別(能力の表の changeAttribution)をしない種類のタブは知らせない(段階 3b で claude・copilot の両方が区別をする)。」に、`useEffect` の中のコメントを `// 変更の区別をしない種類(今の表には無い)は知らせず、控えも持たない(main の hooks は cli-unsupported で、知らせを使わない)` にする

- [ ] **Step 9: テストと型検査が通ることを確かめる**

Run: Step 4 のコマンド
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし。落ちたら `grep -rn -E "settingsPath|hookSettingsPath" src/main` で改名の漏れ（`settingsFileStore`・`settingsHandlers` の同名の関数は無関係）を、`grep -rn "createAgentHookSessions(" src/main` で `copilotPlugins` の渡し漏れを探して直す

- [ ] **Step 10: 実装を外すとテストが落ちることを確かめる（手で外して手で戻す）**

1. `src/shared/agentCliKinds.ts` の `copilot` の `changeAttribution: true` を `false` に戻す → `agentCliKinds.test.ts`・`agentHookSessions.test.ts` の `copilot` の準備・`agentHooks.integration.test.ts` の `copilot` の結合・`useAgentHooksWorkingReport.test.tsx` の「copilot のタブも」が落ちる → 手で戻す
2. `buildCopilotArgs` の `...pluginDir` を 2 か所とも消す → `agentCliLaunchSpecs.test.ts` の「--plugin-dir <パス> を足す」と `agentSessionStarter.test.ts` の「--plugin-dir <パス> を足す」が落ちる → 手で戻す
3. `buildCopilotArgs` の `!isAbsolute(hookConfigPath)` の `if` を消す → 「絶対パスでなければ」が落ちる → 手で戻す
4. `extraEnv` の `COPILOT_HOOK_ALLOW_LOCALHOST: '1'` を消す → `agentCliLaunchSpecs.test.ts` の環境変数のテストと `agentCommand.test.ts` が落ちる → 手で戻す
5. `prepareCopilot` の catch の `copilotPlugins.release(slot)` を消す → 「書き直しの失敗は枠を返して」が落ちる → 手で戻す
6. `release` の `receiver.removeToken(token)` を囲む `try` を外す（`discard` の前で投げたら止まる形）→ 「トークンの除去が投げても後始末」が落ちる → 手で戻す
7. `agentHooksLifecycle.ts` の `() => copilotPlugins.removeTokenFilesSync(),` を消す → `agentHooksLifecycle.test.ts` が落ちる → 手で戻す
8. `agentHooksRuntime.ts` の `rootDir: join(userDataDir, COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME)` を `rootDir: userDataDir` にする → 「<userData>/agent-hooks-copilot に置く」が落ちる → 手で戻す
9. `ipcHandlers.ts` の `userDataDir,` を `userDataDir: '/tmp',` にする → `ipcHandlers.test.ts` の足したテストが落ちる → 手で戻す

戻した後に `git diff src/shared/agentCliKinds.ts src/main/agentCliLaunchSpecs.ts src/main/agentHookSessions.ts src/main/agentHooksLifecycle.ts src/main/agentHooksRuntime.ts src/main/ipcHandlers.ts` で上の箇所が Step 5〜8 の形であることを確かめ、Step 4 のコマンドで通ることを確かめ直す。

- [ ] **Step 11: 古い説明の grep（L-203）**

```bash
cd <repo-root>
grep -rn -E "copilot は知らせ|copilot では本来返さない|changeAttribution は偽のまま|hooks の設定のファイルは渡せません|claude だけが区別|区別に対応しない種類\(copilot\)|copilot\)は、版の確認" src
```

Expected: 何も出ない（出たら、段階 3b の時点の内容〈`copilot` も区別に対応した〉に直す。`agentChangesMessages.ts` の `claude だけが対応しています` は Task 6 で直すので、この時点では出てよい）

- [ ] **Step 12: 全体の検証**

```bash
cd <repo-root>
npx vitest run
npm run typecheck
set -- src/shared/agentCliKinds.ts src/main/agentHookSessions.ts src/main/agentSessionStarter.ts src/main/agentCliLaunchSpecs.ts src/main/agentHooksRuntime.ts src/main/agentHooksLifecycle.ts src/main/ipcHandlers.ts src/renderer/src/__tests__/agentCliCapabilityOverrides.ts src/renderer/src/hooks/useAgentHooksWorkingReport.ts src/shared/__tests__/agentCliKinds.test.ts src/main/__tests__/agentCliLaunchSpecs.test.ts src/main/__tests__/agentCommand.test.ts src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentHookSessions.capabilities.test.ts src/main/__tests__/agentHooksRuntime.test.ts src/main/__tests__/agentHooksLifecycle.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/agentHooks.integration.test.ts src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/hooks/__tests__/useAgentResume.test.ts src/renderer/src/hooks/__tests__/useAgentActivity.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/lib/__tests__/agentInterrupt.test.ts src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts src/renderer/src/lib/__tests__/promptRunAvailability.test.ts
npx prettier --write "$@"
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
```

Expected: すべて通る

- [ ] **Step 13: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 6: 画面の文言と精度の注記

> **設計書の読む節:** 「画面の表示と文言」（CLI の名前の出し方・文言の表・精度の注記を出す場所）、「既存の絞り込みの扱い」の `cli-unsupported` の文言・使えない機能の注記、「claude への影響と互換性」の「区別の文言を関数にする」、「実装の分割」の 6、「テスト方針」の renderer の各項目と「配線」。このプランの冒頭の「計画の時点で設計書から調整した細部」の「renderer の引数」「配線の確かめ」。
>
> **気をつける知見:** L-060（`cliKind` は省略できない引数にして、設定の種類が `AgentChangesSection`・`useAgentChangesRevert` に届く配線をテストし、受け渡しを外す変異で落ちることを確かめる）・L-203（旧定数名・`claude だけが対応` などの古い説明を、型の説明・コメント・テスト名で grep し直す）・L-017（新しい文言は固定の文）。`claude` の文言は 1 文字も変えない（`claude` を渡した各関数が今の文字列と同じことをテストで固定する）。

**Files:**

- Modify: `src/renderer/src/lib/agentCliMessages.ts`（`AGENT_CLI_ATTRIBUTION_PRECISION_NOTES`）
- Modify: `src/renderer/src/lib/agentChangesMessages.ts`（3 つの文言の関数化・`describeAgentChangesAttribution` と `buildAgentRevertAllConfirmMessage` の `cliKind`・精度の注記。旧定数 3 つを消す）
- Modify: `src/renderer/src/lib/agentChangesSectionText.ts`（`describeAgentChangesSectionAttribution` の `cliKind`）
- Modify: `src/renderer/src/components/settings/AgentCliKindSection.tsx`（精度の注記の表示）
- Modify: `src/renderer/src/components/source-control/AgentChangesSection.tsx`（`cliKind` を区別の状態の 1 行に渡す）
- Modify: `src/renderer/src/hooks/useAgentChangesRevert.ts`（`cliKind` の引数）
- Modify: `src/renderer/src/hooks/useAgentChangesWiring.ts`（`cliKind` の引数・`AgentChangesPanelState.cliKind`）
- Modify: `src/renderer/src/hooks/useAppState.ts`（`agentWorkspace.agentTerminal.appCliKind` を渡す）
- Modify: `src/renderer/src/__tests__/makeAgentChangesState.ts`（`makeAgentChangesPanelState` の既定に `cliKind: 'claude'`）
- Test（直す既存のテスト）: `src/renderer/src/lib/__tests__/agentChangesMessages.test.ts`（7・11 行の import、511〜525 行の `buildAll`、554〜563 行の `AGENT_CHANGES_ATTRIBUTION_LOST_REASONS` の `toEqual`、576〜624 行の区別の状態の 1 行、627〜700 行のすべて戻すの確認）、`src/renderer/src/lib/__tests__/agentChangesSectionText.test.ts`（99 行付近の `describeAgentChangesAttribution(attribution, 100)` と `describeAgentChangesSectionAttribution` の呼び出し）、`src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`（`makeAgentChangesPanelState` の既定で `claude` になる。`claude` の文言の期待は変えない）、`src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts`（28 行の import・65〜90 行の `makeOptions`・1020 行の期待）、`src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts`（75〜110 行の `makeOptions`）
- Test（足す）: `src/renderer/src/lib/__tests__/agentCliMessages.test.ts`・`src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx`・`agentChangesMessages.test.ts`・`agentChangesSectionText.test.ts`・`AgentChangesSection.test.tsx`・`useAgentChangesRevert.test.ts`・`useAgentChangesWiring.test.ts`・`src/renderer/src/components/__tests__/App.agentChanges.test.tsx`（配線）

**Interfaces:**

- Consumes: Task 5 の能力の表（`copilot` の `changeAttribution: true`）、`AGENT_CLI_PROFILES[kind].commandName`、`useAgentWorkspace` の `agentTerminal.appCliKind`（設定の種類。読み込み中は既定の `claude`）
- Produces: `AGENT_CLI_ATTRIBUTION_PRECISION_NOTES`、`agentChangesAttributionLostReason`・`agentChangesUnassignedNote`・`agentRevertAllDistinguishingNote`、`describeAgentChangesAttribution(attribution, startedAt, cliKind)`・`buildAgentRevertAllConfirmMessage({ …, cliKind })`・`describeAgentChangesSectionAttribution(view, scope, cliKind)`、`AgentChangesPanelState.cliKind`・`AgentChangesRevertOptions.cliKind`・`AgentChangesWiringOptions.cliKind`

- [ ] **Step 1: 失敗するテストを書く（文言）**

1. `src/renderer/src/lib/__tests__/agentCliMessages.test.ts` の import に `AGENT_CLI_ATTRIBUTION_PRECISION_NOTES` を足し、末尾に足す:

```ts
describe('AGENT_CLI_ATTRIBUTION_PRECISION_NOTES(区別の精度の注記。段階 3b)', () => {
  it('claude は null、copilot は区別が粗い旨', () => {
    expect(AGENT_CLI_ATTRIBUTION_PRECISION_NOTES).toEqual({
      claude: null,
      copilot:
        'copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）'
    })
  })
})
```

2. `src/renderer/src/lib/__tests__/agentChangesMessages.test.ts`:
   - import の `AGENT_CHANGES_ATTRIBUTION_LOST_REASONS`・`AGENT_REVERT_ALL_DISTINGUISHING_NOTE` を `agentChangesAttributionLostReason`・`agentChangesUnassignedNote`・`agentRevertAllDistinguishingNote` に置き換える（`AGENT_CHANGES_UNASSIGNED_NOTE` を import していれば同じく置き換える）
   - `describe('利用者の変更との区別の文言'` の中の先頭に `const CLAUDE_NOTE = agentRevertAllDistinguishingNote('claude')` と `const PRECISION = 'copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）'` を足し、`buildAll` に 3 つ目の引数を足す:

```ts
const buildAll = (
  attribution: Parameters<typeof buildAgentRevertAllConfirmMessage>[0]['attribution'],
  excludedCount = 0,
  cliKind: AgentCliKind = 'claude'
): string =>
  buildAgentRevertAllConfirmMessage({
    count: 2,
    trashCount: 0,
    hasDirectory: false,
    savedInApp: false,
    agentRunning: false,
    attribution,
    startedAt,
    excludedCount,
    cliKind
  })
```

     （`import type { AgentCliKind } from '@shared/agentCliKinds'` を足す）

- 554〜563 行のテストを次にする:

```ts
it('区別をやめた理由の文言は 5 つの理由を網羅し、claude では今の文と同じ(cli-unsupported は括弧を外した)', () => {
  const reasons = [
    'hooks-not-confirmed',
    'receiver-unavailable',
    'claude-version-unsupported',
    'checkpoint-failed',
    'cli-unsupported'
  ] as const
  expect(
    Object.fromEntries(reasons.map((r) => [r, agentChangesAttributionLostReason(r, 'claude')]))
  ).toEqual({
    'hooks-not-confirmed': 'claude の hooks から知らせが届きません',
    'receiver-unavailable': 'hooks の知らせの受け口を用意できませんでした',
    'claude-version-unsupported': 'claude の版が古いか、版を確かめられませんでした',
    'checkpoint-failed': '作業ツリーの記録に失敗しました',
    'cli-unsupported': '使っているエージェント CLI が区別に対応していません'
  })
  expect(agentChangesAttributionLostReason('hooks-not-confirmed', 'copilot')).toBe(
    'copilot の hooks から知らせが届きません'
  )
})

it('印を付けていない間の文と、すべて戻すの順 1 の文は、コマンド名を入れる(claude では今の文と同じ)', () => {
  expect(agentChangesUnassignedNote('claude')).toBe(
    'アプリの中で claude が動いていなかった間などの変更には、印を付けていません'
  )
  expect(agentChangesUnassignedNote('copilot')).toBe(
    'アプリの中で copilot が動いていなかった間などの変更には、印を付けていません'
  )
  expect(agentRevertAllDistinguishingNote('copilot')).toBe(
    'エージェントのツールが動いている間（終わってから 2 秒・許可の確認を待つ間を含む）と、copilot を起動してから最初のプロンプトを送るまで・中断（Esc）の後にあなたが編集した内容は、エージェントの変更として戻ります。'
  )
})
```

- 576〜624 行の `it.each` の呼び出しを `describeAgentChangesAttribution(attribution, startedAt, 'claude')` にする（期待の文字列は変えない）。続けて `copilot` の行を足す:

```ts
it.each<[string, Parameters<typeof describeAgentChangesAttribution>[0], string | null]>([
  [
    'tracking・記録の開始から区別していて、印を付けていない間も無い(注記だけ)',
    makeAgentChangesTrackingSummary({ since: startedAt }),
    PRECISION
  ],
  [
    'tracking・区別を始めたのが記録の開始より後(今の文の後に 。でつなぐ)',
    makeAgentChangesTrackingSummary({ since: at(10, 5), hadUnassignedSince: true }),
    `利用者の変更の区別は 10:05 からです（それより前の変更には印を付けません）。アプリの中で copilot が動いていなかった間などの変更には、印を付けていません。${PRECISION}`
  ],
  [
    'lost・印あり(区別している記録)',
    makeAgentChangesLostSummary({
      reason: 'hooks-not-confirmed',
      lostAt: at(11, 30),
      hadMarks: true
    }),
    `11:30 から利用者の変更を区別できなくなりました（copilot の hooks から知らせが届きません）。それ以降の変更には印を付けません。${PRECISION}`
  ],
  ['tracking・区別をまだ始めていない(注記を出さない)', makeAgentChangesTrackingSummary(), null],
  [
    'lost・印なし(区別していない記録には注記を出さない)',
    makeAgentChangesLostSummary({ reason: 'hooks-not-confirmed' }),
    '利用者の変更を区別できません（copilot の hooks から知らせが届きません）。すべてエージェントの変更として表示します'
  ]
])('区別の状態の 1 行(copilot): %s', (_label, attribution, expected) => {
  expect(describeAgentChangesAttribution(attribution, startedAt, 'copilot')).toBe(expected)
})
```

- 627〜700 行の期待の `AGENT_REVERT_ALL_DISTINGUISHING_NOTE` を `CLAUDE_NOTE` に置き換え（`it.each` の配列は `const` の初期化の後に評価されるので、`CLAUDE_NOTE` は describe の先頭で定義する）、697 行のテストを次にする:

```ts
it('区別しているときの順 1 の文は、エージェントの変更になる利用者の編集をすべて言う(claude では今の文と同じ)', () => {
  expect(agentRevertAllDistinguishingNote('claude')).toBe(
    'エージェントのツールが動いている間（終わってから 2 秒・許可の確認を待つ間を含む）と、claude を起動してから最初のプロンプトを送るまで・中断（Esc）の後にあなたが編集した内容は、エージェントの変更として戻ります。'
  )
})

it('すべて戻すの確認(copilot): 順 1 の直後に精度の注記を句点付きで足し、順 3 のコマンド名も copilot にする。区別していない記録には足さない', () => {
  expect(
    buildAll(
      makeAgentChangesTrackingSummary({ since: startedAt, hadUnassignedSince: true }),
      0,
      'copilot'
    )
  ).toBe(
    allConfirm(
      `${agentRevertAllDistinguishingNote('copilot')}${PRECISION}。アプリの中で copilot が動いていなかった間などのあなたの編集も戻ります。`
    )
  )
  expect(buildAll(makeAgentChangesTrackingSummary(), 0, 'copilot')).toBe(
    allConfirm('記録を始めた後にあなたが編集した内容も戻ります。')
  )
})
```

3. `src/renderer/src/lib/__tests__/agentChangesSectionText.test.ts`: `describeAgentChangesAttribution(attribution, 100)` を `describeAgentChangesAttribution(attribution, 100, 'claude')` に、`describeAgentChangesSectionAttribution(view, scope)` の呼び出しをすべて `describeAgentChangesSectionAttribution(view, scope, 'claude')` にする（`grep -n describeAgentChangesSectionAttribution src/renderer/src/lib/__tests__/agentChangesSectionText.test.ts` で出た行を手で直す）。describe の末尾に足す:

```ts
it('渡した種類の文言と精度の注記で出す(copilot)', () => {
  const tracking = makeAgentChangesTrackingSummary({ since: 100 })
  const view = makeAgentChangesRecordingView(null, { attribution: tracking, startedAt: 100 })
  expect(describeAgentChangesSectionAttribution(view, { kind: 'all' }, 'copilot')).toBe(
    describeAgentChangesAttribution(tracking, 100, 'copilot')
  )
  expect(describeAgentChangesSectionAttribution(view, { kind: 'all' }, 'claude')).toBeNull()
})
```

     （`makeAgentChangesTrackingSummary` の import が無ければ `../../__tests__/makeAgentChangesState` から足す）

- [ ] **Step 2: 失敗するテストを書く（画面と配線）**

1. `src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx` に足す:

```ts
  it('copilot を選んでいると、選択肢の下に区別の精度の注記を出す(claude では出さない)', () => {
    const { unmount } = render(<AgentCliKindSection {...props({ kind: 'copilot' })} />)
    expect(
      screen.getByText(
        'copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）'
      )
    ).toHaveClass('settings-panel__note')
    unmount()
    render(<AgentCliKindSection {...props()} />)
    expect(screen.queryByText(/より粗くなります/)).toBeNull()
  })
```

2. `src/renderer/src/__tests__/makeAgentChangesState.ts` の `makeAgentChangesPanelState` の既定に `cliKind: 'claude',` を足す（`folderPath` の前）。doc コメントの「既定はエージェント CLI 方式・フォルダ '/repo'・フォーカスの依頼なし」に「・設定の種類 claude」を足す

3. `src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx` の区別の describe に足す:

```ts
it('設定の種類(cliKind)の名前で区別の文言を出し、copilot では区別している記録に精度の注記を足す', () => {
  renderSection(
    recordingView([makeAgentChangeEntry('a.txt')], { attribution: lateAndUnassigned }),
    { cliKind: 'copilot' }
  )
  expect(
    within(section()).getByText(
      '利用者の変更の区別は 10:50 からです（それより前の変更には印を付けません）。アプリの中で copilot が動いていなかった間などの変更には、印を付けていません。copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）'
    )
  ).toBeInTheDocument()
})
```

4. `src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts`: 28 行の `AGENT_REVERT_ALL_DISTINGUISHING_NOTE` の import を `agentRevertAllDistinguishingNote` にし、1020 行の期待の `${AGENT_REVERT_ALL_DISTINGUISHING_NOTE}` を `${agentRevertAllDistinguishingNote('claude')}` にする。`makeOptions` の既定に `cliKind: 'claude',` を足す。「すべて戻すの確認に、写しの区別の要約…」のテストの後に足す:

```ts
it('すべて戻すの確認は、渡した種類(cliKind)の文言と精度の注記で作る(copilot)', async () => {
  const options = { ...optionsWith(entries), cliKind: 'copilot' as const }
  const { result } = renderHook(() => useRevertWithRunner(options))
  await act(async () => {
    await result.current.revertAll()
  })
  const message = vi.mocked(options.onConfirm!).mock.calls[0][0]
  expect(message).toContain(
    `？${agentRevertAllDistinguishingNote('copilot')}copilot では、利用者の変更との区別が claude より粗くなります（`
  )
})
```

5. `src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts`: `makeOptions` の既定に `cliKind: 'claude',` を足し、テストを足す:

```ts
it('設定の種類(cliKind)をセクションの状態に渡す(省略できない。L-060)', () => {
  const { result } = setup(makeOptions({ cliKind: 'copilot' }))
  expect(result.current.agentChangesPanel.cliKind).toBe('copilot')
})
```

6. `src/renderer/src/components/__tests__/App.agentChanges.test.tsx` の `describe('App: エージェントの変更の配線'` に足す（設定の種類 → `useAppState` → `useAgentChangesWiring` → セクション・`すべて戻す` の確認の配線。L-060）:

```ts
it('設定の種類が copilot なら、区別の状態の 1 行とすべて戻すの確認に copilot の文言と精度の注記が出る(配線)', async () => {
  const PRECISION =
    'copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）'
  window.api.getAgentCliKind = vi.fn().mockResolvedValue({ kind: 'copilot', fallback: null })
  window.api.listAgentChanges = vi.fn().mockResolvedValue(
    makeAgentChangesListResult([makeAgentChangeEntry('a.txt')], {
      startedAt: listedStartedAt,
      attribution: makeAgentChangesTrackingSummary({ since: listedStartedAt })
    })
  )
  window.confirm = vi.fn().mockReturnValue(false)
  await openRepository()
  await userEvent.click(panelButton('source-control'))
  await userEvent.click(await within(section()).findByRole('button', { name: 'いまから記録する' }))
  expect(await within(section()).findByText(PRECISION)).toBeInTheDocument()
  await userEvent.click(within(section()).getByRole('button', { name: 'すべて戻す' }))
  expect(window.confirm).toHaveBeenLastCalledWith(
    expect.stringContaining(
      `copilot を起動してから最初のプロンプトを送るまで・中断（Esc）の後にあなたが編集した内容は、エージェントの変更として戻ります。${PRECISION}。`
    )
  )
})
```

（`makeAgentChangesTrackingSummary` を `../../__tests__/makeAgentChangesState` の import に足す。区別の状態の 1 行は「記録の開始から区別していて印を付けていない間も無い」ので、精度の注記だけが 1 行に出る。設定の読み込みが一覧より遅れると `claude` の文言で出ることがあるので、`findByText` で待つ）

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/lib/__tests__/agentChangesSectionText.test.ts src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts src/renderer/src/components/__tests__/App.agentChanges.test.tsx`
Expected: FAIL（新しい関数・定数が無い・`cliKind` を受け取らない）

- [ ] **Step 4: 精度の注記の表を足す（`src/renderer/src/lib/agentCliMessages.ts`）**

`agentCliUnsupportedFeaturesNote` の後に足す:

```ts
/**
 * 利用者の変更との区別の精度の注記(設計書 2026-10-26「画面の表示と文言」)。claude より粗い種類だけ文を持つ。設定の画面・変更の一覧の
 * 区別の状態の 1 行・すべて戻すの確認に出す。種類をキーにした表で、種類を足したときの決め忘れを型エラーにする
 */
export const AGENT_CLI_ATTRIBUTION_PRECISION_NOTES: Record<AgentCliKind, string | null> = {
  claude: null,
  copilot:
    'copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）'
}
```

冒頭のコメントの「使えない機能の注記・」の後に「区別の精度の注記・」を足す。

- [ ] **Step 5: 文言を関数にする（`src/renderer/src/lib/agentChangesMessages.ts`）**

import に足す:

```ts
import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import { AGENT_CLI_ATTRIBUTION_PRECISION_NOTES } from './agentCliMessages'
```

冒頭のコメントの後に「区別の文言の CLI の名前は、そのウィンドウの設定の種類(appCliKind)のコマンド名で作る(段階 3b。claude では今と 1 文字も変わらない)。」を足す。`AGENT_CHANGES_ATTRIBUTION_LOST_REASONS` を消して次にする:

```ts
/** 区別をやめた理由の文言(理由の型ごとに分ける。L-439)。commandName は設定の種類のコマンド名 */
export function agentChangesAttributionLostReason(
  reason: AgentChangesAttributionLostReason,
  commandName: string
): string {
  switch (reason) {
    case 'hooks-not-confirmed':
      return `${commandName} の hooks から知らせが届きません`
    case 'receiver-unavailable':
      return 'hooks の知らせの受け口を用意できませんでした'
    case 'claude-version-unsupported':
      return 'claude の版が古いか、版を確かめられませんでした'
    case 'checkpoint-failed':
      return '作業ツリーの記録に失敗しました'
    case 'cli-unsupported':
      // 今の能力の表では届かない(claude・copilot とも区別に対応している)。将来の種類の守り
      return '使っているエージェント CLI が区別に対応していません'
  }
}
```

`AGENT_CHANGES_UNASSIGNED_NOTE` を消して次にする:

```ts
/** 区別の状態の 1 行の、印を付けていない間があった旨(tracking・lost の hadUnassignedSince) */
export function agentChangesUnassignedNote(commandName: string): string {
  return `アプリの中で ${commandName} が動いていなかった間などの変更には、印を付けていません`
}
```

`describeAgentChangesAttribution` を、今の本体を内部の関数にして包む形にする:

```ts
/** 区別の状態の 1 行の、精度の注記を足す前の文(出さないなら null) */
function describeAttributionState(
  attribution: AgentChangesAttributionSummary,
  startedAt: number,
  commandName: string
): string | null {
  if (attribution.kind === 'lost') {
    const reason = agentChangesAttributionLostReason(attribution.reason, commandName)
    if (!attribution.hadMarks) {
      return `利用者の変更を区別できません（${reason}）。すべてエージェントの変更として表示します`
    }
    // やめた時点で開いていた区間(最後の区切りから lostAt まで)は印が付かないため、lostAt より前にも印の無い間があることを伝える
    const lost = `${formatAgentChangesStartedAt(attribution.lostAt)} から利用者の変更を区別できなくなりました（${reason}）。それ以降の変更には印を付けません`
    return attribution.hadUnassignedSince
      ? `${lost}。${agentChangesUnassignedNote(commandName)}`
      : lost
  }
  if (attribution.since === null) return null
  const parts = [
    attribution.since > startedAt
      ? `利用者の変更の区別は ${formatAgentChangesStartedAt(attribution.since)} からです（それより前の変更には印を付けません）`
      : null,
    attribution.hadUnassignedSince ? agentChangesUnassignedNote(commandName) : null
  ].filter((text): text is string => text !== null)
  return parts.length === 0 ? null : parts.join('。')
}

/**
 * 累積の一覧の上の区別の状態の 1 行(出さないなら null)。区別をやめた理由、区別を始めたのが記録の開始より後であること、
 * 印を付けていない間があったことを見える文字で伝える(L-057)。cliKind は設定の種類で、文言の CLI の名前と精度の注記に使う。
 * 精度の注記は区別している記録(isAgentChangesAttributionDistinguishing)だけに、今の文の後に 。でつないで足す(今の文が無ければ注記だけ)
 */
export function describeAgentChangesAttribution(
  attribution: AgentChangesAttributionSummary,
  startedAt: number,
  cliKind: AgentCliKind
): string | null {
  const base = describeAttributionState(
    attribution,
    startedAt,
    AGENT_CLI_PROFILES[cliKind].commandName
  )
  const precision = AGENT_CLI_ATTRIBUTION_PRECISION_NOTES[cliKind]
  if (precision === null || !isAgentChangesAttributionDistinguishing(attribution)) return base
  return base === null ? precision : `${base}。${precision}`
}
```

`AGENT_REVERT_ALL_DISTINGUISHING_NOTE` を消して次にする（doc コメントの「claude の起動から最初のプロンプトまで」を「CLI の起動から最初のプロンプトまで」にする）:

```ts
export function agentRevertAllDistinguishingNote(commandName: string): string {
  return `エージェントのツールが動いている間（終わってから 2 秒・許可の確認を待つ間を含む）と、${commandName} を起動してから最初のプロンプトを送るまで・中断（Esc）の後にあなたが編集した内容は、エージェントの変更として戻ります。`
}
```

`revertAllUserEditsNote` に `cliKind: AgentCliKind` を足し、区別している側を次にする:

```ts
  } else {
    const commandName = AGENT_CLI_PROFILES[cliKind].commandName
    parts.push(agentRevertAllDistinguishingNote(commandName))
    // 精度の注記は順 1 の直後(句点で終わらないので 。を足す)
    const precision = AGENT_CLI_ATTRIBUTION_PRECISION_NOTES[cliKind]
    if (precision !== null) parts.push(`${precision}。`)
    if (attribution.since !== null && attribution.since > startedAt) {
      parts.push(
        `${formatAgentChangesStartedAt(attribution.since)} より前のあなたの編集も戻ります。`
      )
    }
    if (attribution.hadUnassignedSince) {
      parts.push(`アプリの中で ${commandName} が動いていなかった間などのあなたの編集も戻ります。`)
    }
    // (lost の行は今のまま)
  }
```

`buildAgentRevertAllConfirmMessage` の引数に足し、`revertAllUserEditsNote(attribution, startedAt, excludedCount, cliKind)` で呼ぶ:

```ts
/** 設定の種類(文言の CLI の名前と精度の注記。必須。L-060) */
cliKind: AgentCliKind
```

- [ ] **Step 6: 区別の状態の 1 行・設定・セクション・hooks に `cliKind` を通す**

1. `src/renderer/src/lib/agentChangesSectionText.ts`: `import type { AgentCliKind } from '@shared/agentCliKinds'` を足し、`describeAgentChangesSectionAttribution(view, scope, cliKind: AgentCliKind)` にして `describeAgentChangesAttribution(view.attribution, view.startedAt, cliKind)` を返す。doc コメントに「cliKind は設定の種類(文言の CLI の名前と精度の注記)」を足す

2. `src/renderer/src/components/settings/AgentCliKindSection.tsx`: import に `AGENT_CLI_ATTRIBUTION_PRECISION_NOTES` を足し、`const unsupportedNote = …` の後に `const precisionNote = kind === null ? null : AGENT_CLI_ATTRIBUTION_PRECISION_NOTES[kind]` を足し、`{unsupportedNote !== null && …}` の次の行に `{precisionNote !== null && <p className="settings-panel__note">{precisionNote}</p>}` を足す。冒頭のコメントの「選んだ CLI で使えない機能を並べる」を「選んだ CLI で使えない機能と、区別の精度の注記を出す」にする

3. `src/renderer/src/hooks/useAgentChangesWiring.ts`: `import type { AgentCliKind } from '@shared/agentCliKinds'` を足し、`AgentChangesPanelState` と `AgentChangesWiringOptions` に次を足して、`useAgentChangesWiring` の分割代入・`useAgentChangesRevert({ …, cliKind })`・`agentChangesPanel` の `cliKind,` に渡す:

```ts
/** 設定の種類(useAgentWorkspace の appCliKind)。区別の文言の CLI の名前と精度の注記に使う(省略できない。L-060) */
cliKind: AgentCliKind
```

4. `src/renderer/src/hooks/useAgentChangesRevert.ts`: `AgentChangesRevertOptions` に同じ `cliKind: AgentCliKind`（コメントは「設定の種類。すべて戻すの確認の CLI の名前と精度の注記に使う(省略できない。L-060)」）を足し、分割代入と `buildAgentRevertAllConfirmMessage({ …, cliKind })` に渡す

5. `src/renderer/src/components/source-control/AgentChangesSection.tsx`: 分割代入に `cliKind` を足し、`describeAgentChangesSectionAttribution(view, changes.scope, cliKind)` にする

6. `src/renderer/src/hooks/useAppState.ts`: `useAgentChangesWiring({ … })` に `cliKind: agentWorkspace.agentTerminal.appCliKind,` を足す（`isAgentMode` の後。コメント `// 区別の文言の CLI の名前は設定の種類(使う CLI の切り替えは動いているタブをすべて止めるので、区別している間のタブと同じ)` を付ける）

- [ ] **Step 7: テストと型検査が通ることを確かめる**

Run: Step 3 のコマンド
Expected: PASS（`claude` の文言の既存の期待は変えずに通る）
Run: `npm run typecheck`
Expected: エラーなし。落ちたら `grep -rn -E "AGENT_CHANGES_ATTRIBUTION_LOST_REASONS|AGENT_CHANGES_UNASSIGNED_NOTE|AGENT_REVERT_ALL_DISTINGUISHING_NOTE|describeAgentChanges(Section)?Attribution\(|buildAgentRevertAllConfirmMessage\(|useAgentChangesRevert\(|useAgentChangesWiring\(" src/renderer` で直し漏れを探して直す（`AgentChangesPanelState` を作る箇所は `useAgentChangesWiring.ts` と `makeAgentChangesPanelState` だけ）

- [ ] **Step 8: 実装を外すとテストが落ちることを確かめる（手で外して手で戻す。配線の変異を含む。L-060）**

1. `useAppState.ts` の `cliKind: agentWorkspace.agentTerminal.appCliKind,` を `cliKind: 'claude',` にする → `App.agentChanges.test.tsx` の配線のテストが落ちる → 手で戻す
2. `useAgentChangesWiring.ts` の `useAgentChangesRevert({ …, cliKind })` の `cliKind` を `cliKind: 'claude'` にする → `App.agentChanges.test.tsx` の配線のテスト（すべて戻すの確認）が落ちる → 手で戻す
3. `useAgentChangesWiring.ts` の `agentChangesPanel` の `cliKind,` を `cliKind: 'claude',` にする → `useAgentChangesWiring.test.ts` の足したテストと `App.agentChanges.test.tsx` の区別の状態の 1 行が落ちる → 手で戻す
4. `AgentChangesSection.tsx` の `describeAgentChangesSectionAttribution(view, changes.scope, cliKind)` の `cliKind` を `'claude'` にする → `AgentChangesSection.test.tsx` の足したテストが落ちる → 手で戻す
5. `describeAgentChangesAttribution` の `!isAgentChangesAttributionDistinguishing(attribution)` の条件を消す → 「区別の状態の 1 行(copilot): tracking・区別をまだ始めていない」「lost・印なし」が落ちる → 手で戻す
6. `revertAllUserEditsNote` の `if (precision !== null) parts.push(\`${precision}。\`)`を消す →`agentChangesMessages.test.ts`の「すべて戻すの確認(copilot)」と`useAgentChangesRevert.test.ts` の足したテストが落ちる → 手で戻す
7. `AgentCliKindSection.tsx` の `{precisionNote !== null && …}` の行を消す → `AgentCliKindSection.test.tsx` の足したテストが落ちる → 手で戻す

戻した後に `git diff src/renderer/src/hooks/useAppState.ts src/renderer/src/hooks/useAgentChangesWiring.ts src/renderer/src/components/source-control/AgentChangesSection.tsx src/renderer/src/lib/agentChangesMessages.ts src/renderer/src/components/settings/AgentCliKindSection.tsx` で上の箇所が Step 4〜6 の形であることを確かめ、Step 3 のコマンドで通ることを確かめ直す。

- [ ] **Step 9: 古い説明の grep（L-203）**

```bash
cd <repo-root>
grep -rn -E "AGENT_CHANGES_ATTRIBUTION_LOST_REASONS|AGENT_CHANGES_UNASSIGNED_NOTE|AGENT_REVERT_ALL_DISTINGUISHING_NOTE|claude だけが対応|claude の起動から最初のプロンプトまで" src
grep -rn -E "claude の hooks" src | grep -v __tests__
```

Expected: 1 つ目は何も出ない。2 つ目は、`claude` だけを指すことが正しい箇所（`agentHookSettings.ts` の `--settings` の説明・`agentClaudeVersion.ts` など）だけが残る。`claude`・`copilot` の両方を扱うモジュール（`agentHookProtocol.ts`・`agentHooksRuntime.ts`・`agentHooksLifecycle.ts`・`agentSessionStarter.ts`・`ipcHandlers.ts`）の冒頭のコメントで `claude の hooks` のまま残っているものがあれば「claude・copilot の hooks」に直す。`src/shared/types/agentChanges.ts` の `cli-unsupported` の説明（`使う CLI が hooks による区別に対応していない`）は正しいので変えない

- [ ] **Step 10: 全体の検証**

```bash
cd <repo-root>
npx vitest run
npm run typecheck
set -- src/renderer/src/lib/agentCliMessages.ts src/renderer/src/lib/agentChangesMessages.ts src/renderer/src/lib/agentChangesSectionText.ts src/renderer/src/components/settings/AgentCliKindSection.tsx src/renderer/src/components/source-control/AgentChangesSection.tsx src/renderer/src/hooks/useAgentChangesRevert.ts src/renderer/src/hooks/useAgentChangesWiring.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/__tests__/makeAgentChangesState.ts src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/lib/__tests__/agentChangesSectionText.test.ts src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts src/renderer/src/components/__tests__/App.agentChanges.test.tsx
npx prettier --write "$@"
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
```

Expected: すべて通る（Step 9 で直したファイルがあれば `set --` に足す）

- [ ] **Step 11: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 7: 偽の copilot の統合テスト

> **設計書の読む節:** 「テスト方針」の統合テスト（`agentCliLaunch.integration.test.ts` に足す）、「起動の引数と環境変数」、「プラグインのフォルダ」の「置き場と形」、「hooks が届かないとき」、「実装の分割」の 7。
>
> **気をつける知見:** L-059（引数・環境・プラグインのフォルダの経路は、偽の `copilot` と実物の node-pty の統合テストで確かめる。実物の `copilot` の挙動の確かめではない。Windows では飛ばす）。既存の `agentCliLaunch.integration.test.ts` の作り（PATH に偽物と node だけ・起動の前に解決された file が偽物か確かめる・`HOME` は一時ディレクトリ・テストのタイマーは `createTestTimers` で片付ける）に合わせる。

**Files:**

- Test: `src/main/__tests__/agentCliLaunch.integration.test.ts`（新しい describe を足すだけ。既存の describe は変えない）

**Interfaces:**

- Consumes: Task 3〜5 の実物（`createAgentHookReceiver`・`createAgentToolActivity`・`createAgentHookSessions`・`createCopilotHookPluginSlots`・`createAgentHookSettingsDir`・`writeAgentHookSettingsFile`・`removeAgentHookSettingsFile`・`createAgentSessionStarter`・`resolveAgentLaunch`）
- Produces: なし（テストだけ）

- [ ] **Step 1: テストを書く**

`src/main/__tests__/agentCliLaunch.integration.test.ts` の import に足す:

```ts
import { createAgentToolActivity } from '../agentToolActivity'
import type { AgentToolActivity } from '../agentToolActivity'
import { createAgentHookReceiver } from '../agentHookReceiver'
import type { AgentHookReceiver } from '../agentHookReceiver'
import {
  createAgentHookSettingsDir,
  removeAgentHookSettingsFile,
  writeAgentHookSettingsFile
} from '../agentHookSettings'
import type { AgentHookSettingsDir } from '../agentHookSettings'
import { createAgentHookSessions } from '../agentHookSessions'
import {
  COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME,
  createCopilotHookPluginSlots
} from '../agentCopilotHookPlugin'
import type { CopilotHookPluginSlots } from '../agentCopilotHookPlugin'
```

ファイルの末尾に足す:

```ts
describe.skipIf(process.platform === 'win32')(
  'copilot の hooks のプラグインのフォルダ(実物の starter・hooks の組み立て・pty と偽の copilot。段階 3b)',
  () => {
    const NEW_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    let registry: AgentSessionRegistry
    let tracker: AgentToolActivity
    let receiver: AgentHookReceiver
    let settingsDir: AgentHookSettingsDir
    let copilotPlugins: CopilotHookPluginSlots

    beforeEach(() => {
      registry = new AgentSessionRegistry()
      tracker = createAgentToolActivity({
        onPhaseChange: () => undefined,
        devLog: null,
        warn: () => undefined
      })
      receiver = createAgentHookReceiver({
        deliver: (ownerId, sessionId, event) => tracker.deliver(ownerId, sessionId, event),
        onToolStart: async () => undefined,
        onToolStartTimedOut: () => undefined,
        log: () => undefined
      })
      settingsDir = createAgentHookSettingsDir()
      // userData は一時ディレクトリ(外側の beforeEach が作る dir)の下。利用者の userData に書かない
      copilotPlugins = createCopilotHookPluginSlots({
        rootDir: join(dir, 'userData', COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME)
      })
    })

    afterEach(async () => {
      await registry.stopAll('stopped')
      receiver.close()
      tracker.close()
      settingsDir.removeSync()
      copilotPlugins.removeTokenFilesSync()
    })

    it('--plugin-dir <userData>/agent-hooks-copilot/slot-1 と COPILOT_HOOK_ALLOW_LOCALHOST=1 が届き、偽の copilot が hooks.json の URL・トークンで送った UserPromptSubmit で追跡が confirmed(idle)になる', async () => {
      const binDir = join(dir, 'bin-hooks')
      const work = join(dir, 'work-hooks')
      const userDataDir = join(dir, 'userData')
      mkdirSync(work)
      mkdirSync(userDataDir)
      const report = join(dir, 'report-hooks.json')
      // 受け取った --plugin-dir の hooks.json を読み、UserPromptSubmit の URL へヘッダー付きで POST し、結果を記録してから待つ
      // (追跡を確かめる間に終わって release されないよう、止められるまで生きている)
      writeFakeCopilot(binDir, [
        '#!/usr/bin/env node',
        "const fs = require('node:fs')",
        "const path = require('node:path')",
        "const http = require('node:http')",
        'const args = process.argv.slice(2)',
        "const pluginDir = args[args.indexOf('--plugin-dir') + 1]",
        "const sessionId = args[args.indexOf('--session-id') + 1]",
        "const hooksFile = path.join(pluginDir, 'hooks', 'hooks.json')",
        "const config = JSON.parse(fs.readFileSync(hooksFile, 'utf8'))",
        "const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'))",
        'const hook = config.hooks.UserPromptSubmit[0]',
        'const url = new URL(hook.url)',
        "const body = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: sessionId, prompt: 'hi' })",
        "const req = http.request({ host: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { Authorization: hook.headers.Authorization, 'Content-Type': 'application/json' } }, (res) => {",
        '  res.resume()',
        "  res.on('end', () => {",
        `    fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({`,
        '      args,',
        '      allowLocalhost: process.env.COPILOT_HOOK_ALLOW_LOCALHOST ?? null,',
        '      manifestName: manifest.name,',
        '      events: Object.keys(config.hooks),',
        '      status: res.statusCode,',
        '      pluginDirMode: fs.statSync(pluginDir).mode & 0o777,',
        '      hooksFileMode: fs.statSync(hooksFile).mode & 0o777',
        '    }))',
        '  })',
        '})',
        'req.end(body)',
        'setInterval(() => undefined, 1000)'
      ])
      // 利用者の環境の 0 は、起動の表の値(1)で上書きされる
      const plan = await resolveCopilot(binDir, { COPILOT_HOOK_ALLOW_LOCALHOST: '0' })
      const folderAccess = new FolderAccessManager()
      folderAccess.set(1, realpathSync(work))
      const hooks = createAgentHookSessions({
        receiver,
        settingsDir,
        tracker,
        // copilot の準備は claude の版を確かめない(呼ばれたら失敗させて分かるようにする)
        versions: {
          readClaudeVersion: async () => {
            throw new Error('copilot の準備で claude の版を確かめた')
          }
        },
        writeSettingsFile: writeAgentHookSettingsFile,
        removeSettingsFile: removeAgentHookSettingsFile,
        copilotPlugins,
        log: () => undefined
      })
      const { start } = createAgentSessionStarter({
        folderAccess,
        registry,
        resolveLaunch: async () => ({ kind: 'ok', plan }),
        spawnPty: spawn,
        stopTree: (pty, exited) => stopProcessTree({ pid: pty.pid, exited }),
        createSessionId: () => 'it-hooks-1',
        records: {
          claude: createAgentSessionRecordStore(makeFakeRecordIo()),
          copilot: createAgentSessionRecordStore(makeFakeRecordIo())
        },
        reservations: createClaudeSessionReservations(),
        createClaudeSessionId: () => NEW_ID,
        hooks
      })
      const result = await start(
        1,
        { slotId: 'slot-1', folderPath: work, cols: 80, rows: 24, launch: { kind: 'new' } },
        { isGone: () => false, onData: () => undefined, onExit: () => undefined }
      )
      expect(result).toMatchObject({ kind: 'started', cliKind: 'copilot', claudeSessionId: NEW_ID })
      // 起動の直後は hooks を確かめる前(pending。段階は agent)
      const pluginDir = join(userDataDir, 'agent-hooks-copilot', 'slot-1')
      expect(JSON.parse(await waitForFile(report, timers))).toEqual({
        args: ['--session-id', NEW_ID, '--plugin-dir', pluginDir],
        allowLocalhost: '1',
        manifestName: 'prompt-ide-agent-hooks',
        events: [
          'UserPromptSubmit',
          'PreToolUse',
          'PostToolUse',
          'PostToolUseFailure',
          'SubagentStop',
          'Stop',
          'SessionEnd'
        ],
        status: 200,
        pluginDirMode: 0o700,
        hooksFileMode: 0o600
      })
      // 照合の通った知らせで confirmed(開いた区間が無いので idle)。追跡の deliver は応答より前に済んでいる
      expect(tracker.activityOf(1).phase).toBe('idle')
      // 起動の引数にトークンは無い(プラグインのフォルダの中の 0600 のファイルにだけある)
      const hooksText = readFileSync(join(pluginDir, 'hooks', 'hooks.json'), 'utf8')
      const token = /Bearer ([0-9a-f]{64})/.exec(hooksText)?.[1]
      expect(token).toBeDefined()
      expect(JSON.parse(readFileSync(report, 'utf8')).args.join(' ')).not.toContain(token)
    }, 30_000)
  }
)
```

- [ ] **Step 2: テストを流す**

Run: `npx vitest run src/main/__tests__/agentCliLaunch.integration.test.ts`
Expected: PASS（Windows では飛ぶ）。落ちたら、偽の `copilot` の報告（`report-hooks.json`）が書かれたか・`waitForFile` の打ち切りかを見て、Task 3〜5 の実装の不一致（パス・トークン・環境変数）を直す（このタスクで実装を変えたら、そのタスクの検証もやり直す）

- [ ] **Step 3: 実装を外すとテストが落ちることを確かめる（手で外して手で戻す）**

1. `src/main/agentCliLaunchSpecs.ts` の `extraEnv` の `COPILOT_HOOK_ALLOW_LOCALHOST: '1'` を消す → `allowLocalhost` が `'0'` になって落ちる → 手で戻す
2. `src/main/agentSessionStarter.ts` の `capabilities.changeAttribution ? (prepared.hooks?.configPath ?? null) : null` を `null` にする → 偽の `copilot` が `--plugin-dir` を受け取れず報告が書かれない（`waitForFile` の打ち切り）で落ちる → 手で戻す
3. `src/main/agentHookSessions.ts` の `prepareCopilot` の戻り値の `token` を `createToken()` の別の値にする（例: `token: token.replace(/^./, token[0] === 'a' ? 'b' : 'a')`）→ 受け口がトークンを照合できず追跡が `agent` のままで落ちる → 手で戻す

戻した後に `git diff src/main/agentCliLaunchSpecs.ts src/main/agentSessionStarter.ts src/main/agentHookSessions.ts` で Task 5 の形のままであることを確かめ、Step 2 のコマンドで通ることを確かめ直す。

- [ ] **Step 4: 全体の検証**

```bash
cd <repo-root>
npx vitest run
npm run typecheck
set -- src/main/__tests__/agentCliLaunch.integration.test.ts
npx prettier --write "$@"
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
pgrep -fl amt-test- || echo "残ったプロセスなし"
```

Expected: すべて通り、最後の行が `残ったプロセスなし`（テストが起動した偽の `copilot` が残っていない）

- [ ] **Step 5: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 8: ROADMAP・既知の制約・テスト仕様書と全体の検証（テスト仕様書への追記と Artifact の再公開）

> **設計書の読む節:** 「ROADMAP の更新の方針」、「既知の制約」、「実機テスト仕様書の方針と項目の下書き」（既存の項目の直しと新しい節）、「実装の分割」の 8、「main に入れた時点で利用者から見える挙動」。CLAUDE.md の実機テスト仕様書の規則（書式・ID を変えない・接頭辞ごとの連番・新しい項目は接頭辞の最大値の次から）と、`scripts/build-manual-test-spec.mjs` の冒頭のコメント。
>
> **気をつける知見:** L-072（実機の項目は `~/.copilot`・アプリのデータのフォルダを `ls`・`ps` で見るだけにし、ファイルを変える手順は `pwd` を確かめてから行い、設定とタブを節の中で戻す）・L-354（下書きの文言・ログの形を実装と照らし合わせてから追記する）・L-606（時間の値〈猶予 2 秒・作業の終わりからの保留 30 秒〈待つのは 40 秒〉・届きの確かめ 15 秒〉は実装の値から書く）・L-591（`claude` の hooks の節の「ほかの CLI は区別しない」を段階 3b の時点の内容に直す）・L-203（設計書の既知の制約を実装と照らし合わせ、食い違いがあれば直す）。**この ROADMAP の更新で、段階 3b の項目（`claude` 以外のエージェント CLI への対応）を完了にする**（設計書の「ROADMAP の更新の方針」のとおり。段階 3a の時点の「残り」は段階 3b だけ）。

**Files:**

- Modify: `docs/manual-test-spec.md`（AGT-230・237 の直しと、新しい節 AGT-278〜289。**ほかの既存の項目の ID と文言は変えない**）
- Modify: `ROADMAP.md`（**prettier にかけない**）
- Modify（食い違いがあれば）: `docs/superpowers/specs/2026-10-26-agent-cli-copilot-hooks-design.md`（「既知の制約」の照合と、プランの冒頭の「計画の時点で設計書から調整した細部」の反映）
- 生成（git 管理外）: `.superpowers/manual-test-spec.html`

**Interfaces:**

- Consumes: Task 1〜7 の実装（文言の正は `src/renderer/src/lib/agentCliMessages.ts`・`src/renderer/src/lib/agentChangesMessages.ts`、ログの形の正は `src/main/agentToolActivity.ts`・`src/main/agentHookReceiver.ts`、プラグインのフォルダの形の正は `src/main/agentCopilotHookPlugin.ts`）
- Produces: 実機テスト仕様書の AGT-278〜AGT-289 と既存の項目の直し、ROADMAP の段階 3b の記録（項目の完了）、再公開した Artifact

- [ ] **Step 1: 設計書の「既知の制約」を実装と照らし合わせ、調整した細部を設計書に反映する**

`sed -n '/^## 既知の制約/,/^## 実機テスト仕様書の方針と項目の下書き/p' docs/superpowers/specs/2026-10-26-agent-cli-copilot-hooks-design.md` で読み、次を確かめる。食い違いがあれば設計書の行を実装に合わせて直す（無ければ変えない）:

1. 足す環境変数（`COPILOT_HOOK_ALLOW_LOCALHOST=1`）・`--plugin-dir` の値（`<userData>/agent-hooks-copilot/slot-<番号>`）が `src/main/agentCliLaunchSpecs.ts`・`src/main/agentCopilotHookPlugin.ts` と一致する
2. 枠の数（4）が `COPILOT_HOOK_PLUGIN_SLOT_COUNT` と、マニフェストの名前（`prompt-ide-agent-hooks`）が `COPILOT_HOOK_PLUGIN_MANIFEST.name` と一致する
3. 区間の規則の記述（断ったツールの後はそのターンの終わりまで・中断の後の持ち越し・サブエージェントのグループ）が `src/main/agentToolIntervals.ts` の規則と一致する
4. 設計書のほかの節の語を、プランの冒頭の「計画の時点で設計書から調整した細部」に合わせて直す（「決めたこと（利用者の確認済み）」「決めたこと（推奨案で決めた事項）」の表の文言は変えない）:
   - 「区間の規則」の `idlessEndedGroups` の説明（254 行付近の「前の `tool-start` の後に `tool-end` を受けたグループ」）を「バッチの区切りを待つグループ（`tool-end` で入り、次の `tool-start` で前のバッチの残りを閉じて外れる。入れる・外す時点は下の表と、表の後の段落の 5 つの時点）」にする（設計書レビュー 3 回目の推奨）
   - 「入力の解釈と会話の ID の振り分け」の注記の `subagent-stop` の `confirm-only` に、理由 `subagent-stop-unmatched` を書き足す。「構成」の `agentHookEvents.ts` の行の理由の並びにも足す
   - 「構成」の `agentCopilotHookPlugin.ts` の行を「`buildCopilotHookConfig`・マニフェスト・`createCopilotHookPluginSlots`（`acquire`・`release`・`write`・`removeTokenFilesSync`）」に確定した旨にし、表に `src/main/__tests__/agentHookSessions.capabilities.test.ts`（能力の表を差し替えて `cli-unsupported` を保つ）の行を足す
   - 「受け口」の「経路」に、`checkAgentHookRequest` の `accepted` が `route` を返し、`copilot` の経路では拒むときの状態コードを 200 にすること、`読めない知らせ` のラベルは `copilot` でも同じであることを書き足す
   - 「構成」の最後の段落（`AgentChangesSection` までの `cliKind` の受け渡しの経路）を「`useAgentWorkspace` の `agentTerminal.appCliKind` → `useAppState` → `useAgentChangesWiring({ cliKind })` → `useAgentChangesRevert` と `agentChangesPanel.cliKind` → `GitRepoView`・`NotRepositoryView` → `AgentChangesSection`」に確定した旨にする
   - 「ROADMAP の更新の方針」の 2 つ目の箇条書きに「行の末尾の括弧の中に `段階 3b で利用者の変更との区別に対応した` を足す」を書き足す

- [ ] **Step 2: 実機テスト仕様書の文言とログの形を実装と照らし合わせる（L-354）**

```bash
cd <repo-root>
node -e '
const fs = require("node:fs")
const checks = [
  ["src/renderer/src/lib/agentCliMessages.ts", "copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）"],
  ["src/renderer/src/lib/agentChangesMessages.ts", "の hooks から知らせが届きません"],
  ["src/renderer/src/lib/agentChangesMessages.ts", "を起動してから最初のプロンプトを送るまで・中断（Esc）の後にあなたが編集した内容は、エージェントの変更として戻ります。"],
  ["src/renderer/src/lib/agentChangesMessages.ts", "使っているエージェント CLI が区別に対応していません"],
  ["src/main/agentToolActivity.ts", "[agent-hooks] ターンの終わりの知らせが届かないため、次の知らせまで割り当てを保留します"],
  ["src/main/agentToolActivity.ts", "[agent-hooks] 知らせが届いたため、保留を解きます"],
  ["src/main/agentToolActivity.ts", "終わりの待ちの終わり"],
  ["src/main/agentToolActivity.ts", "猶予の終わり"],
  ["src/main/agentToolActivity.ts", "id=${flag(detail.hasId)} agent=${flag(detail.hasAgent)} hooks=${hooksLabel(session)} phase=${before.phase}→${after.phase}"],
  ["src/main/agentToolActivity.ts", "AGENT_TOOL_END_GRACE_MS = 2_000"],
  ["src/main/agentToolActivity.ts", "AGENT_HOOKS_TURN_END_WAIT_MS = 30_000"],
  ["src/main/agentHookReceiver.ts", "拒んだ要求（copilot）"],
  ["src/main/agentHookReceiver.ts", "読めない知らせ"],
  ["src/main/agentCopilotHookPlugin.ts", "prompt-ide-agent-hooks"],
  ["src/main/agentCopilotHookPlugin.ts", "agent-hooks-copilot"],
  ["src/main/agentCliLaunchSpecs.ts", "--plugin-dir"],
  ["src/main/agentCliLaunchSpecs.ts", "COPILOT_HOOK_ALLOW_LOCALHOST: \"1\"".replace(/"/g, "\x27")]
]
let ok = true
for (const [file, text] of checks) {
  if (!fs.readFileSync(file, "utf-8").includes(text)) { ok = false; console.log("見つからない:", file, text) }
}
console.log(ok ? "ok" : "ng")
'
```

Expected: `ok`。`ng` なら、下の Step 3 の仕様書の文言を実装の文言・ログの形に合わせて直す（実装は変えない）

- [ ] **Step 3: 実機テスト仕様書に追記する（既存の項目の直しと新しい節）**

新しい節の本文を `$S/agt-278-section.md` に書く（Write ツールで、次の内容をそのまま。前後の空行は付けない）:

```markdown
### copilot の利用者の変更との区別

> 前提: エージェント CLI 方式で、「## エージェントの変更の確認」の冒頭の前提の手順（`R=$(mktemp -d); cd "$R" && git init …`）でテスト用の Git リポジトリを作り、その最上位のフォルダを開いている（追跡しているのは a.txt・b.txt・c.txt だけ）。アプリは `npm run dev` で起動し、その端末の `[agent-hooks]` の行を見る（開発版のログの 1 行の形は「利用者の変更との区別」の節の前提と同じ）。GitHub Copilot CLI（`copilot`）がインストール済みで、端末で `copilot --version` が動く。
> 前提: 設定の `使うエージェント CLI` で `GitHub Copilot CLI（copilot）` を選んでから始め（動いているタブがあれば確認で `OK`）、この節の最後の項目で `Claude Code（claude）` に戻す。途中で止めるときも戻す。
> 前提: フォルダの信頼の確認・許可の確認では、項目に書いたもの以外は、その回だけ許可する選択肢（`Yes`）を選び、覚える選択肢は選ばない（覚えさせてしまったら、AGT-228 の節の前提の手順で外す）。`copilot` のログインなど GitHub のアカウントに関わる操作は、利用者が自分のアカウントで行う。`copilot` への指示は、ターミナルの `copilot` の入力欄に入力して `Enter` で送る。
> 前提: 始める前に、別の端末で `ls ~/.copilot/plugin-data/_direct/ 2>/dev/null | wc -l` を実行して数を控える（中身は変えない）。

- [ ] **AGT-278** `起動` で `copilot 1` を起動し、別の端末で `ps -axo pid=,args= | grep -- '[-]-plugin-dir'` を実行する（`[-]` は grep 自身の行を拾わないため）。続けて、出たパスを `D` として `ls -ld "$D" "$D/hooks"` と `ls -l "$D" "$D/hooks"` を実行する → `copilot` の行に `--plugin-dir <ホーム>/Library/Application Support/prompt-ide/agent-hooks-copilot/slot-1` が付いている。フォルダは 2 つとも `drwx------`、`$D` に `plugin.json` と `hooks`、`$D/hooks` に `hooks.json`（`-rw-------`）がある。`ps` の出力にトークン（64 桁の 16 進）が出ない。`npm run dev` の端末に `event=起動 tool=- id=- agent=- hooks=pending phase=paused→agent` の行が出る
- [ ] **AGT-279** `こんにちは` を送る（信頼の確認が出たら `1. Yes`）。応答の後に `/env` を送る → `npm run dev` の端末に `event=UserPromptSubmit tool=- id=- agent=- hooks=confirmed` の行が出る。`[agent-hooks] 拒んだ要求`・`[agent-hooks] 読めない知らせ` の行が出ない（出たら理由と件数を記録する）。`/env` の表示にプラグイン `prompt-ide-agent-hooks` と hooks が出る（出方を記録する）
- [ ] **AGT-280** 帯の `変更を確認` → `いまから記録する` で記録を始める。`a.txt の最後に agent という行を足して` を送り、許可の確認が出たら `Yes` を選ぶ → 端末に `event=PreToolUse tool=Edit id=なし agent=なし hooks=confirmed phase=idle→agent` と `event=PostToolUse tool=Edit id=なし agent=なし` の行が出て、その約 2 秒後に `session=- event=猶予の終わり … phase=agent→idle` の行が出る（`Edit` 以外の名前〈`Write` など〉なら記録する）。`copilot` の画面に `Denied by preToolUse hook` の行が出ない
- [ ] **AGT-281** `copilot` の作業が終わって入力待ちになったら、別の端末でテスト用のリポジトリの直下に移り（`pwd` で確かめる）、`echo user >> b.txt` を実行してから、セクションの `更新` を押す → 一覧の `M a.txt` には印が無く、`M b.txt` に `利用者の変更` の印が付く。区別の状態の 1 行に `copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）` が出る
- [ ] **AGT-282** `c.txt を消すコマンドを実行して` を送り、許可の確認で断る選択肢（`No`）を選び、指示の欄があれば `何もせずに終えて` と送る → 端末に `event=PreToolUse tool=Bash … phase=idle→agent` の行が出て、そのツールの `event=PostToolUse`・`event=PostToolUseFailure` の行は出ない。`copilot` が答え終わると `event=Stop tool=- id=- agent=-` の行が出て、その約 2 秒後に `event=猶予の終わり … phase=agent→idle` の行が出る。テスト用のリポジトリで `git status --porcelain` を実行すると `D c.txt` は出ない
- [ ] **AGT-283** `sleep 20 を実行して` を送り（許可は `Yes`）、`event=PreToolUse tool=Bash` の行が出たら、実行中に帯の `中断` を押す。そのまま次の指示を送らずに 40 秒待つ → `event=PostToolUse`・`event=Stop` の行は出ない。画面の活動が作業の終わりになってから約 30 秒後に `[agent-hooks] ターンの終わりの知らせが届かないため、次の知らせまで割り当てを保留します` と `event=終わりの待ちの終わり … unassignable=あり` の行が出る。続けて `こんにちは` を送ると `[agent-hooks] 知らせが届いたため、保留を解きます` の行が出て、答え終わると `event=Stop … agent=-` の行と、その約 2 秒後の `event=猶予の終わり … phase=agent→idle` の行が出る
- [ ] **AGT-284** `task ツールのサブエージェントに、c.txt の最後に sub という行を足させて` を送る → `agent=あり` の `event=PreToolUse`・`event=PostToolUse` の行と、`event=Stop tool=- id=- agent=あり` の行（サブエージェントのターンの終わり。主のターンの終わりとして扱わない。主の `task` は区間に数えないので、段階はサブエージェントのツールの `PostToolUse` の約 2 秒後の `猶予の終わり` の行で先に `idle` になっていることが多く、そのときこの行は `phase=idle→idle`）、`event=SubagentStop tool=- id=- agent=あり` の行が出て、最後に `event=Stop … agent=-` の行が出る（サブエージェントを使わずに答えたら、そのことを記録する）
- [ ] **AGT-285** `/clear` を送り、続けて `b.txt の最後に after-clear という行を足して` を送る（許可は `Yes`）→ `/clear` で `event=SessionEnd tool=- id=- agent=- hooks=confirmed` の行が出る。その後のツールの行は `agent=なし`（主の会話として数える）で、`event=PostToolUse` の行の約 2 秒後に `event=猶予の終わり … phase=agent→idle` の行が出て、答え終わると `event=Stop … agent=-` の行が出る（ツールが終わった時点で区間が 0 に戻って猶予が始まるので、`Stop` の行は `phase=idle→idle` になり、`Stop` の後に `猶予の終わり` の行は出ない）
- [ ] **AGT-286** 帯の `終了` で `copilot 1` を止め、`前回の続きから` を押す（信頼の確認が出たら `1. Yes`）。入力待ちになったら `a.txt の最後に resumed という行を足して` を送る（許可は `Yes`）→ 再開の直後（約 1 秒以内）に `event=SessionEnd tool=- id=- agent=- hooks=confirmed` の行が出る（別の ID の終わりとして扱い、区間を閉じない。起動の直後の確かめになるので `phase=agent→idle`）。その後のツールの行は `agent=なし` で、`event=PostToolUse` の行の約 2 秒後に `event=猶予の終わり … phase=agent→idle` の行が出る（答え終わった後の `Stop` の行は `phase=idle→idle`）
- [ ] **AGT-287** `+` で 2 つ目のタブ（`copilot 2`）を起動し、AGT-278 と同じ `ps` を実行する。次に `copilot 2` を `×` で閉じ（確認で `OK`）、もう一度 `+` で起動して `ps` を実行してから、そのタブを `×` で閉じる（確認で `OK`）。最後に `ls ~/.copilot/plugin-data/_direct/ 2>/dev/null | wc -l` を実行する → 2 つ目のタブの `--plugin-dir` は 2 回とも `…/agent-hooks-copilot/slot-2`。`_direct` の数は前提で控えた数から 2 つより多く増えていない（初めて使う環境で 1〜2 増える。2 回目の起動では増えない）
- [ ] **AGT-288** セクションの `すべて戻す` を押し、確認の文言を見てから `キャンセル` を押す → 確認に `copilot を起動してから最初のプロンプトを送るまで` を含む文と、`copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）。` が出る。`キャンセル` でファイルは変わらない
- [ ] **AGT-289** `確認を終える` で記録を終え、帯の `終了` で `copilot 1` を止めてから、設定の `使うエージェント CLI` で `Claude Code（claude）` を選ぶ。アプリを `Cmd+Q` で終了し、AGT-278 の `D` について `ls "$D" "$D/hooks"` を実行する → `$D` に `plugin.json` と `hooks` は残り、`$D/hooks` に `hooks.json` は無い。この項目で設定は元に戻る（続けて確かめるときは `npm run dev` で起動し直す）
```

置き換えのスクリプトを書いて実行する（`$S/update-manual-test-spec.py`。日本語を含むので `# -*- coding: utf-8 -*-` 付きのファイルにする。各置き換えが 1 か所だけに当たることを確かめる。計画の時点で、仕様書の写しにかけて AGT-230・237 の直しと 12 項目の追加、`parseSpec` の検査が通ることを確かめた）:

```python
# -*- coding: utf-8 -*-
# 実機テスト仕様書の段階 3b の直し(AGT-230・237 の直しと、新しい節 AGT-278〜289 の追記)。各置き換えはちょうど 1 か所に当たることを確かめる
import sys

spec_path, section_path = sys.argv[1], sys.argv[2]
text = open(spec_path, encoding='utf-8').read()
section = open(section_path, encoding='utf-8').read().rstrip('\n')

PRECISION = 'copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）'


def replace_once(old, new):
    global text
    count = text.count(old)
    assert count == 1, f'{count} か所: {old[:60]}'
    text = text.replace(old, new)


# AGT-230: 使えない機能の注記は出ず、精度の注記が出る
replace_once(
    '選択肢の下に `copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別` が出る。',
    f'選択肢の下に `copilot では次の機能を使えません…` は出ず、`{PRECISION}` が出る。',
)
# AGT-237: 区別はプロンプトを送って hooks を確かめてから始まるので、区別の状態の 1 行は出ない
replace_once(
    '→ 区別できない旨と `使っているエージェント CLI が区別に対応していません（claude だけが対応しています）` が出る。',
    '→ 区別の状態の 1 行は出ない（区別はプロンプトを送って hooks を確かめてから始まる。`使っているエージェント CLI が区別に対応していません` も出ない）。',
)
# 新しい節: copilot のセッションの再開と履歴の節の後(エージェントの変更の確認の前)
replace_once('\n\n## エージェントの変更の確認', '\n\n' + section + '\n\n## エージェントの変更の確認')
open(spec_path, 'w', encoding='utf-8').write(text)
print('ok')
```

```bash
cd <repo-root>
S=<scratchpad の絶対パス>
test -f "$S/update-manual-test-spec.py" && test -f "$S/agt-278-section.md" || echo "missing"
python3 "$S/update-manual-test-spec.py" docs/manual-test-spec.md "$S/agt-278-section.md"
git diff docs/manual-test-spec.md | grep '^[-+]- \[ \]' | grep -o '^[-+]- \[ \] \*\*AGT-[0-9]*\*\*' | sort | uniq -c
grep -c '^- \[ \] \*\*AGT-2\(7[89]\|8[0-9]\)\*\*' docs/manual-test-spec.md
```

Expected: `ok`。`uniq -c` が AGT-230・237 を `-` と `+` で 1 回ずつ、AGT-278〜289 を `+` で 1 回ずつ出す（ほかの ID は出ない）。最後の `grep -c` が `12`

- [ ] **Step 4: HTML を再生成し、仕様書の検査を流す**

Run: `node scripts/build-manual-test-spec.mjs`
Expected: `.superpowers/manual-test-spec.html` が書き出される（エラーなし）
Run: `npx vitest run scripts`
Expected: PASS（ID の一意性・接頭辞ごとの連番が昇順・書式の検査が通る）

- [ ] **Step 5: Artifact を再公開する（コントローラーが行う）**

実装のサブエージェントはこの Step を行わず、Step 4 まで終えたことを報告する。コントローラー（このプランを実行するメインのエージェント）が、Artifact ツールで `<manual-test-spec-artifact-url>` を同じファイルパス `.superpowers/manual-test-spec.html` で再公開する（`url` にこの Artifact の URL を渡す。この会話で読んでいなければ、先に `action: "read"` で読む）

- [ ] **Step 6: ROADMAP を更新する（prettier にかけない）**

段階 3b の節の本文を `$S/roadmap-3b-section.md` に書く（Write ツールで、次の内容をそのまま。既知の制約の箇条書きは、スクリプトが設計書の「既知の制約」からそのまま写して後ろに足す）:

```markdown
### copilot の hooks による利用者の変更との区別（段階 3b）

設計書: `docs/superpowers/specs/2026-10-26-agent-cli-copilot-hooks-design.md`（2026-10-26）。

- [x] 設定で `copilot` を選んでいる間も、変更の一覧で `利用者の変更` の印を付け、`すべて戻す` から外す（能力の表の `copilot` の `changeAttribution` を真にした）。アプリが起動する `copilot` に、1 回の起動だけに効く http の hooks を `--plugin-dir` で渡す（利用者のリポジトリ・`~/.copilot` には書かない）
- [x] hooks は PascalCase のイベント名を `copilot` の平らな形（`{"version":1,"hooks":{…}}`）で書く（下の表）。アプリから起動した `copilot` の環境には `COPILOT_HOOK_ALLOW_LOCALHOST=1` を足す（hooks を用意できなかった起動でも足す）
- [x] プラグインのフォルダは `<userData>/agent-hooks-copilot/slot-<1〜4>`（`0700`）。main 全体で 4 つの枠を持ち、起動の準備で空いている一番小さい番号を貸して、その pty の終了で返す。起動のたびにトークン入りの `hooks/hooks.json`（`0600`）を原子的に書き直す（トークンは起動の引数・環境変数に置かない）。フォルダは使うたびに持ち主・権限・シンボリックリンクを確かめる。アプリの終了で `hooks.json` だけを消す（フォルダと `plugin.json` は残す）。枠が空いていない・書き直せないときは hooks なしで起動する（`hooks の知らせの受け口を用意できませんでした`）
- [x] 受け口は `copilot` 向けのパス（`/prompt-ide/agent-hooks/copilot/v1/…`）を足し、そこへの要求には照合の失敗・不明なパス・閉じた後・処理の例外でも常に 200 の空の本文を返す（`copilot` は preToolUse の 4xx・5xx・接続の失敗をツールの拒否にするため。`{"permissionDecision":"allow"}` は返さない）。`claude` 向けのパスの応答は変えない
- [x] `copilot` の hooks にはツールの呼び出しの ID が無いので、会話の ID（本文の `session_id`）ごとのグループで区間を数える。タブの主の会話の ID（起動に使った ID。`/clear` などの後は採り直す）と違う会話はサブエージェントとして扱い、中の `Stop` はそのグループだけを閉じる。バッチの終わりはグループの開いた区間が 0 に戻った時点で、`tool-end` の後の `tool-start` で前のバッチの残り（許可の確認で断った・hook が拒否したツール）を閉じる。中断の後は次のプロンプトで残った区間に持ち越しの印を付け、次のターンの `Stop` まで開いたままにする
- [x] 区別の文言の CLI の名前は設定の種類で出す（`copilot の hooks から知らせが届きません` など。`claude` では今と同じ）。設定・区別の状態の 1 行・`すべて戻す` の確認に `copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）` を出す。設定の使えない機能の注記は `copilot` でも出ない

| イベント                             | パスの最後の段                           | `timeoutSec` | matcher                                                                                               |
| ------------------------------------ | ---------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| `UserPromptSubmit`                   | `user-prompt-submit`                     | 5            | なし                                                                                                  |
| `PreToolUse`                         | `pre-tool-use`                           | 10           | `Write\|Edit\|MultiEdit\|NotebookEdit\|Bash\|PowerShell\|bash\|powershell\|apply_patch\|create\|edit` |
| `PostToolUse`・`PostToolUseFailure`  | `post-tool-use`・`post-tool-use-failure` | 5            | `PreToolUse` と同じ                                                                                   |
| `SubagentStop`・`Stop`・`SessionEnd` | `subagent-stop`・`stop`・`session-end`   | 5            | なし                                                                                                  |

既知の制約（設計書の「既知の制約」と同じ）:
```

`$S/update-roadmap.py` を書いて実行する（日本語を含むので `# -*- coding: utf-8 -*-` 付きのファイルにする。`DATE` は実装した日〈`date +%F` の出力〉を渡す。設計書の方針では「日付は main に入れた日」なので、PR のマージの日と違えば、マージの後に直す。計画の時点で、ROADMAP の写しにかけて各置き換えが 1 か所に当たることを確かめた）:

```python
# -*- coding: utf-8 -*-
# ROADMAP の段階 3b の更新(設計書「ROADMAP の更新の方針」)。各置き換えはちょうど 1 か所に当たることを確かめる。
# 使い方: python3 update-roadmap.py <ROADMAP.md> <段階 3b の節の md> <設計書の md> <日付 YYYY-MM-DD>
import sys

roadmap_path, section_path, design_path, date = sys.argv[1:5]
text = open(roadmap_path, encoding='utf-8').read()
section = open(section_path, encoding='utf-8').read().rstrip('\n')
design = open(design_path, encoding='utf-8').read()


def replace_once(old, new):
    global text
    count = text.count(old)
    assert count == 1, f'{count} か所: {old[:60]}'
    text = text.replace(old, new)


def append_in_last_paren(prefix, note):
    """prefix で始まるちょうど 1 行の、末尾の括弧の中の最後に note を足す(行は「…対応した）」で終わること)"""
    global text
    lines = text.split('\n')
    hits = [i for i, line in enumerate(lines) if line.startswith(prefix)]
    assert len(hits) == 1, f'{len(hits)} 行: {prefix[:40]}'
    line = lines[hits[0]]
    assert line.endswith('対応した）'), f'末尾が違う: {line[-20:]}'
    lines[hits[0]] = line[: -len('）')] + f'。{note}）'
    text = '\n'.join(lines)


# 1. 今後実装の項目を完了にし、段階 3b の行を足して「残り」の行を消す
replace_once(
    '- [ ] `claude` 以外のエージェント CLI への対応（起動コマンドの設定。入力欄の挙動が CLI ごとに違う点の吸収）',
    '- [x] `claude` 以外のエージェント CLI への対応（起動コマンドの設定。入力欄の挙動が CLI ごとに違う点の吸収）',
)
replace_once(
    '      - 残り: copilot の hooks による変更の区別＝段階 3b（実測の段階 3b-0 の後）',
    f'      - 実装済み（{date}。段階 3b。設計書 `docs/superpowers/specs/2026-10-26-agent-cli-copilot-hooks-design.md`）: copilot の hooks による利用者の変更との区別（アプリが起動する copilot に --plugin-dir で http の hooks を渡す）。実装済み機能の「copilot の hooks による利用者の変更との区別（段階 3b）」を参照',
)

# 2. 段階 1・2a・2b の「copilot では利用者の変更との区別を使えない」行を、その段階の時点の記録として直す
NOTE = '段階 3b で利用者の変更との区別に対応した'
replace_once(
    '変更の確認の区別は `使っているエージェント CLI が区別に対応していません（claude だけが対応しています）` になる。',
    '変更の確認の区別は `使っているエージェント CLI が区別に対応していません（claude だけが対応しています）` になっていた。',
)
append_in_last_paren('- [x] 段階 1 の時点では、`copilot` では、プロンプトの送信', NOTE)
append_in_last_paren('- 段階 1 の時点では、`copilot` では、プロンプトの送信', NOTE)
append_in_last_paren('- 段階 2a の時点では、`copilot` ではプロンプトの送信', NOTE)
append_in_last_paren('- 段階 2b の時点では、`copilot` ではプロンプトの送信は使えたが', NOTE)

# 3. claude の hooks の節の既知の制約(区別するのは claude だけ)を段階 3b の時点の内容にする(L-591)
replace_once(
    '- 区別するのは、アプリの中のタブで起動した `claude` のツールの区間だけ。アプリの外で起動した `claude`、エージェントが起動した別の `claude`、ほかのエージェント CLI の変更は区別しない（アプリの中で `claude` が動いていない間は印を付けない。動いている間に外で書かれた変更は `利用者の変更` になる）',
    '- 区別するのは、アプリの中のタブで起動した `claude`・`copilot`（段階 3b から）のツールの区間だけ。アプリの外で起動した CLI、エージェントが起動した別の CLI、ほかのエージェント CLI の変更は区別しない（アプリの中で CLI が動いていない間は印を付けない。動いている間に外で書かれた変更は `利用者の変更` になる）。`copilot` の区別の違い（ツールの呼び出しの ID が無いことによる粗さ）は、実装済み機能の「copilot の hooks による利用者の変更との区別（段階 3b）」を参照',
)

# 4. 実装済み機能の末尾(段階 3a の節の後)に段階 3b の節を足す。既知の制約は設計書の「既知の制約」の箇条書きをそのまま写す
start = design.index('## 既知の制約')
end = design.index('\n## ', start + 1)
limits = [line for line in design[start:end].split('\n') if line.startswith('- ')]
assert len(limits) >= 10, f'既知の制約が {len(limits)} 行'
replace_once(
    '\n\n---\n\n## MVP: エージェント CLI のアプリ内ターミナル実行',
    '\n\n' + section + '\n\n' + '\n'.join(limits) + '\n\n---\n\n## MVP: エージェント CLI のアプリ内ターミナル実行',
)
open(roadmap_path, 'w', encoding='utf-8').write(text)
print('ok')
```

```bash
cd <repo-root>
S=<scratchpad の絶対パス>
python3 "$S/update-roadmap.py" ROADMAP.md "$S/roadmap-3b-section.md" docs/superpowers/specs/2026-10-26-agent-cli-copilot-hooks-design.md "$(date +%F)"
git diff --stat ROADMAP.md
grep -n "段階 3b" ROADMAP.md | cut -c1-80
grep -n -E "利用者の変更との区別を使えな|区別は使えなかった|ほかのエージェント CLI の変更は区別しない" ROADMAP.md | cut -c1-120
```

Expected: `ok`。`grep -n "段階 3b"` が、今後実装の項目の「実装済み（… 段階 3b …）」の行・段階 1・2a・2b の 4 行の括弧の中・`claude` の hooks の節の既知の制約の行・段階 3b の節の見出しを出す。最後の `grep` は、過去形の記録（段階 1・2a・2b の行。括弧に段階 3b の対応を書いた行）と、`claude`・`copilot` の両方を書いた `claude` の hooks の節の行だけを出す（`copilot` では区別を使えないと現在形で書いた行が残っていない）

- [ ] **Step 7: 全体の検証**

```bash
cd <repo-root>
npx vitest run
npm run typecheck
git diff --name-only --diff-filter=d origin/main -- 'src/**/*.ts' 'src/**/*.tsx' > "$S/changed-ts.txt"; git ls-files --others --exclude-standard -- 'src/**/*.ts' 'src/**/*.tsx' >> "$S/changed-ts.txt"
xargs npx eslint --max-warnings 0 < "$S/changed-ts.txt"
xargs npx prettier --check < "$S/changed-ts.txt"
npx prettier --check docs/manual-test-spec.md docs/superpowers/plans/2026-10-26-agent-cli-copilot-hooks.md docs/superpowers/specs/2026-10-26-agent-cli-copilot-hooks-design.md
pgrep -fl amt-test- || echo "残ったプロセスなし"
```

（このコードブロックの先頭でも `S=<scratchpad の絶対パス>` を設定する。`changed-ts.txt` が空なら eslint・prettier の行は飛ばす）

Expected: すべて通り、最後の行が `残ったプロセスなし`。`npx prettier --check` が仕様書・設計書で落ちたら、そのファイルを明示して `npx prettier --write <ファイル>` をかけ（`ROADMAP.md` にはかけない）、Step 4 の HTML の再生成と `npx vitest run scripts` をやり直す（コントローラーに Artifact の再公開をもう一度頼む）

- [ ] **Step 8: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

## 自己レビューの結果（計画の時点）

- **設計書の網羅:** 「範囲」の shared・main・renderer・テスト・実機テスト仕様書・ROADMAP は Task 1〜8 に割り当てた（能力の表 → Task 5、hooks の設定とプラグインのフォルダ → Task 4・5、起動の引数と環境変数 → Task 5、受け口の経路と応答 → Task 3、入力の解釈と振り分け → Task 2・3、区間の規則 → Task 1、文言と精度の注記 → Task 6、統合テスト → Task 5・7、仕様書・ROADMAP → Task 8）。「既存の絞り込みの扱い」の 7 行は、`useAgentHooksWorkingReport`（Task 5 のコメントとテスト）・`cli-unsupported` の `prepare`（Task 5 の能力の差し替えのテスト）・starter の `capabilities.changeAttribution ? …`（Task 5 で `configPath` に改名して残す）・`buildCopilotArgs`（Task 5）・使えない機能の注記（Task 5 のテスト）・`cli-unsupported` の文言（Task 6）・`claude-version-unsupported`（`copilot` の準備で使わない。Task 5）に当てた
- **テスト方針の網羅:** 「テスト方針」の各ファイルの項目は、`agentCopilotHookEvents.test.ts`（Task 2）・`agentToolIntervals.test.ts`（Task 1）・`agentCopilotHookPlugin.test.ts`（Task 4）・`agentCliLaunchSpecs.test.ts`（Task 5）・`agentHookReceiver.test.ts`（Task 3）・`agentHookSessions.test.ts`（Task 3・5）・`agentSessionStarter.test.ts`（Task 3・5）・2 つの統合テスト（Task 5・7）・renderer の各テストと配線（Task 5・6）に写した
- **型の一貫性:** `ToolIdRead` の `none`・`AgentHookOwnerCli`・`AgentHookRoute`・`PreparedAgentHooks`（`cliKind`・`configPath`・`discard`）・`CopilotHookPluginSlots` の名前と形は、「型・関数の名前」の節と各タスクの Interfaces で同じにした。`settingsPath` → `configPath` の改名は Task 5 だけで行い、Task 3 の時点のコードは `settingsPath` のまま `cliKind` を足す
