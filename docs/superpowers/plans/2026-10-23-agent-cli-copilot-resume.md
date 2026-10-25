# claude 以外のエージェント CLI への対応 段階 3a（実行履歴への CLI の種類の記録と copilot のセッションの再開）実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定で GitHub Copilot CLI（`copilot`）を選んでいる間も、帯の `前回の続きから` と実行履歴の `このセッションで再開` で `copilot` の会話を再開できるようにし、`copilot` へ送ったプロンプトも CLI の種類付きで実行履歴に記録する。`claude` を選んでいる間の挙動・文言・起動の記録のファイルは変えない（履歴のエントリには種類の欄が 1 つ増える）。

**Architecture:** `copilot` は main が振った小文字の UUID で `--session-id <ID>` で起動し、再開は記録と照合した ID を `--resume=<ID>`（1 つの引数）で起動する。起動の表（`agentCliLaunchSpecs.ts`）に `extraEnv` を足し、`copilot` の環境に `COPILOT_DISABLE_RESUME_AUTO_CD=1` を足す。起動の記録は種類ごとの別のファイル（`claude` は今の `agent-sessions.json`、`copilot` は `agent-sessions-copilot.json`）で、store を種類ごとに作って `Record<AgentCliKind, …>` で starter に渡す。再開の依頼と「前回」の取得に種類を載せ、main は起動のたびに読んだ設定の種類と照らし合わせて違えば `resume-cli-mismatch` で断る。履歴の `agent` に `cliKind`（知らない種類の値も保つ文字列）を足し、renderer はエントリの種類と設定の種類が違う・知らない種類なら `このセッションで再開` を押せなくする。再開で起動したタブが画面の活動を一度も見ないまま 0 以外で終わったら、種類ごとの表の文言（`copilot` だけ）を出す。

**Tech Stack:** Electron（main・preload・renderer）, React 19, TypeScript, node-pty 1.1.0（偽の `copilot` の統合テスト）, Vitest 4（偽の pty・偽の `window.api`・偽の記録の I/O）, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-23-agent-cli-copilot-resume-design.md`（承認済み。実装の前に必ず読む）。このプランは設計書の「実装の分割」の 1〜6 を、そのまま Task 1〜6 に割り当てた。各タスクで読む節はタスクの冒頭に書いた。書き方の参考は `docs/superpowers/plans/2026-10-22-agent-cli-copilot-send.md`。

**実装の前に読むもの:** `$DEV_FLOW_KIT/lessons/review-lessons.md` の「優先度 A のチェックリスト」（CLAUDE.md の「実装前の確認」）。今回の変更に関係する項目は本文も読む。

**反映する知見（dev-flow-kit の `lessons/review-lessons.md`）:** 設計書の「気をつける知見」の L-001・L-002・L-006・L-007・L-015・L-017・L-018・L-019・L-034・L-037・L-040・L-044・L-052・L-058・L-059・L-060・L-061・L-072・L-354・L-456・L-459（各タスクの冒頭の「気をつける知見」に、そのタスクで効くものを書いた）

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
>
> - **`useAgentLastSession` の種類の受け取り方:** 設計書の「取り直しの契機（`refreshKey`）に `appCliKind` を足す」を、省略できない引数 `cliKind` にして effect の依存に入れる形にした（依存に入るので、種類が変われば取り直す。働きは同じ）。Task 2 で引数・依頼・結果の `cliKind` を足し、Task 4 で結果を「取りに行ったフォルダと種類」が今と同じときだけ使う規則と、依頼と違う種類の結果を記録なしにする規則を足す。
> - **Task 2〜3 の間に知らない種類のエントリで渡すもの（設計書レビューの推奨 2）:** `onResumeEntry` は `knownAgentCliKindOf(entry.agent)` が `null` なら何もしない（タブを足さない）。知っている種類はエントリの種類をそのまま `resumeInNewTab(claudeSessionId, cliKind)` に渡す（設定と違えば main が `resume-cli-mismatch` で断る）。押せない理由は Task 4 で足す。
> - **統合テストの方式（設計書レビューの推奨 3）:** 既存の `src/main/__tests__/agentCliLaunch.integration.test.ts` に足す。新しい describe は、実物の `createAgentSessionStarter`・`resolveAgentLaunch`・node-pty・記録の store（偽の I/O）・予約で起動する（設計書の「実物の `resolveAgentLaunch` と starter で起動する」）。既存の `runPlan` の 2 件は、`buildArgs` に ID を渡す形に直すだけにする（starter を通さない確かめとして残す）。
> - **preload の手書きの型（設計書レビューの推奨 1）:** `src/preload/index.d.ts` の `getLastAgentSession` を Task 2 で直す。
> - **起動の表と能力の表の整合のテスト（設計書の「実装の分割」3 の 31・38 行）:** 起動の表（`buildCopilotArgs`）は能力の表を読まないので、`vi.mock` で能力の表を差し替えても `buildCopilotArgs` の挙動は変わらず、差し替えでは保てない。全種類を回し、`sessionResume` が真の種類は ID が `null` で投げ、偽の種類は ID があると投げる、と表の今の値に応じた期待で確かめる（どの種類も 1 件以上の確かめを作る）。38 行は ID を渡す形に直す。
> - **main の能力の差し替え:** starter の `resume-unsupported` と「会話の ID を持たない種類」の流れは、新しいテストのファイル `src/main/__tests__/agentSessionStarter.capabilities.test.ts` に `vi.mock('@shared/agentCliKinds', …)` を置いて保つ。設計書の「小さな補助を main のテストに置く」は、使うのがこの 1 ファイルだけなので、補助のファイルを作らずにこのファイルの中に置く。ID を持たない種類の起動は、起動の表の `buildArgs` を `vi.spyOn` で `[]` を返すように差し替えて確かめる（今の `copilot` の起動の表は ID が無いと投げるため）。
> - **種類ごとの store の組み立て:** 設計書の「`AGENT_CLI_KINDS` から作る」は、`map` で作ると型の上で `Record` にならず `as` が要る。`ipcHandlers.ts` では、種類をキーにしたオブジェクトのリテラル `{ claude: …, copilot: … }` を `Record<AgentCliKind, AgentSessionRecordStore>` に入れる（種類を足すとキーの欠けが型エラーになる。L-060 の狙いと同じ）。
> - **`knownAgentCliKindOf` の置き場:** 新しいファイル `src/shared/historyAgentCliKind.ts` に、`HISTORY_AGENT_CLI_KIND_PATTERN`・`isHistoryAgentCliKindValue`・`knownAgentCliKindOf`・`LEGACY_AGENT_HISTORY_CLI_KIND`（段階 3a より前のエントリの種類 `'claude'`）を置く。古いエントリに補う値は「既定の種類」ではなく「当時は claude だけが記録された」ことによる値なので、`DEFAULT_AGENT_CLI_KIND` を使わずに名前を分けた。
> - **`buildAgentEnv` の足す環境変数:** 5 つ目の引数 `extraEnv: Readonly<Record<string, string>>`（省略できない）にする。足すのは取り除く一覧を適用した直後で、`PATH`・`TERM`・`COLORTERM`・`LANG` の設定より前（表に同じ名前があっても `PATH` などは上書きされる）。
> - **活動を見たかの配線（設計書の「構成」の最後の段落）:** `useAgentSessions` がタブごとに起動の控え（起動の指定 `new`・`resume` と活動を見たか）を持ち、`noteScreenActivity(slotId)` を返す。`useAgentWorkspace` の effect が、活動が `unknown` 以外のタブについて `noteScreenActivity` を呼ぶ。`start` が控えを作り直し（起動し直すと戻る）、状態の取得で合わせ込んだタブは `new` として控える。省略できない形にするため `AgentSessionsState` の必須の値にし、配線のテストと変異の確認（Task 5）で受け渡しの外れを捕まえる。
> - **`AGENT_SESSION_RECORDS_FILE_NAME` は消す:** 種類ごとのファイル名の表 `AGENT_SESSION_RECORD_FILE_NAMES` に置き換える（使っているのはテストだけ）。
> - **統合テストの偽の `copilot`:** 受け取った引数と `COPILOT_DISABLE_RESUME_AUTO_CD` の値を 1 行ずつ追記し、`--resume=` の値が新しく起動した ID なら終了コード 1 で終える（記録の 5f の「何も送らずに閉じたセッション」を模す）。
> - **計画の時点で grep をかけ直した結果（設計書の「実装の分割」3 の一覧に足したもの）:** `src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx`（`getLastAgentSession` の結果・呼び出しの引数・再開の依頼と `AGENT_RESUME_LAST_ARIA_LABEL`。Task 2・4）、`src/preload/__tests__/api.test.ts`・`src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`（`getLastAgentSession` の引数。Task 2）、`src/main/__tests__/ipcHandlers.test.ts`（記録の store の組み立て。Task 2）、`src/main/__tests__/claudeSessionIdSelection.test.ts`（再開の依頼の `cliKind`。Task 2）、`src/main/__tests__/agentCommand.test.ts` の `buildAgentEnv` の呼び出し（5 つ目の引数。Task 3）、`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`（aria-label。Task 4）、`src/renderer/src/__tests__/makeAgentSessionsState.ts`（`noteScreenActivity`。Task 5）。`AgentHistoryInfo` を作るテストのファイル 18 個（Task 1 の Step 1）。

## Global Constraints

- コメント・文言・ログは日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。クライアントのコンポーネントには `'use client'`。`any` を使わない。テストの補助関数にも戻り値の型を書く
- **コミット・プッシュはしない**（CLAUDE.md。利用者の明示の指示があるまで行わない）。各タスクの最後の Step は「コミットしない（dev-flow の commit-ja でまとめてコミットする）」。`git add`・`git mv`・`git stash` もしない
- **実物の `claude`・`copilot` はテストで起動しない。** pty を通す確かめは、一時ディレクトリに置いた小さな node のスクリプト（偽の `copilot`）を実物の node-pty で起動して行う（PATH には偽物と node だけを置いた場所を入れ、起動の前に解決された file が偽物であることを確かめる。既存の統合テストの作り）。テストは利用者の `~/.copilot`・`~/.claude`・`userData` に書かない。実機（Electron）の確認は利用者がまとめて行う（Task 6 で実機テスト仕様書に追記する）。プランに実機の手順は書かない
- 各タスクの終わりで次が通る状態を保つ: `npx vitest run`（全テスト）・`npm run typecheck`・変更・作成した TypeScript のファイルへの `npx eslint --max-warnings 0 <ファイル>` と `npx prettier --check <ファイル>`。型を変えるタスクは、型に追随する呼び出し元・テストの補助・既存のテストを同じタスクで直す（設計書の「実装の分割」の冒頭）
- **`npx prettier --write` は、変更したファイルを明示して実行する**（引数が空だとリポジトリ全体を整形してしまう）。`ROADMAP.md` と `src/renderer/src/lib/__tests__/fixtures/*.json` は prettier にかけない
- **このマシンは負荷が高く、`npx vitest run` の全体でテストが時間切れ（`Test timed out`・`waitFor` の打ち切り）で落ちることがある。** 落ちたら、落ちたファイルを `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書いて先へ進む。単体でも落ちれば本当の失敗として直す
- **シェルで `path` を変数名に使わない**（zsh では `path` が `PATH` と結び付いた配列で、代入すると `PATH` が壊れる）。**zsh では、変数に入れたファイル名の並びが単語に分かれない。** 複数のファイルは直接書くか、`set -- a.ts b.ts` と `"$@"` を使う。**シェルの変数は Bash の呼び出しをまたいで残らない。** コードブロックごとに先頭で設定し直す
- **日本語を含むファイルを Python で書き換えるときは、`# -*- coding: utf-8 -*-` 付きのスクリプトのファイルにして実行する**（`python3 -c` に日本語を書かない）。スクリプトは実行するエージェントのセッションの作業用の一時ディレクトリ（scratchpad。以下 `$S`。各コードブロックの先頭で `S=<scratchpad の絶対パス>` を設定し直す）に置く。`perl -pi` の置き換えは ASCII のパターンと ASCII の置き換え後の文字列だけで行う
- **「実装を外すとテストが落ちることの確かめ」は `git stash` を使わず、手で外して手で戻す。** 書いた実装の該当の行を一時的に元の形へ戻す（または消す）→ 該当のテストを流して落ちることを確かめる → 手で元に戻す → `git diff <ファイル>` か `grep` で戻したことを確かめ、テストが通ることを確かめ直す
- `act(...).then(...)` の形でテストを書かない。`console.*` の spy と `vi.spyOn(window.api, …)`・`vi.spyOn(<実物のオブジェクト>, …)` は `afterEach`（か `finally`）で戻す。偽のタイマーを使うテストは `afterEach` で `vi.clearAllTimers()`・`vi.useRealTimers()` を呼ぶ
- 種類の違いは種類をキーにした表（`AGENT_CLI_PROFILES`・`AGENT_CLI_LAUNCH_SPECS`・`AGENT_SESSION_RECORD_FILE_NAMES`・`AGENT_RESUME_FAILURE_NOTES`）から引き、入口に `kind === 'copilot'` のような種類の名前との比較を書かない。起動の指定の `cliKind`・`getLastSession` の `cliKind`・`useAgentLastSession` の `cliKind`・`buildAgentEnv` の `extraEnv`・starter の `records` は省略できない形にする（省略で `claude` に倒れない。L-060）
- pty の引数に入れる会話の ID は、main が `randomUUID()` で振った値か、入り口で小文字の UUID v4 を検証し、さらに設定の種類の記録と照合した値だけ（L-019・L-034）。`copilot` の起動の表でも最後の守りとして形を確かめ、例外の文言に渡された値を入れない（L-017）

### 設計書の決めたこと（利用者の確認済み。一字一句）

- **今回の範囲**: 段階 3a だけ。実行履歴への CLI の種類の記録と、`copilot` のセッションの再開
- **範囲の外**: hooks による変更の区別（`copilot` の `changeAttribution`）は、実測（段階 3b-0）の後の段階 3b で扱う
- **copilot の新しい起動**: `--session-id <アプリが決めた小文字の UUID>` で起動する
- **copilot の再開**: `--resume=<ID>` で起動する
- **保存先への自動の移動**: `copilot` の環境に `COPILOT_DISABLE_RESUME_AUTO_CD=1` を足して止める（`-C` との比べ方は下の「起動の引数と環境変数」。記録の 4 をもとに決めた）
- **合わせる `copilot` の挙動**: 記録した GitHub Copilot CLI 1.0.87 の挙動に合わせる
- **何も送らずに閉じた copilot のセッションの記録の時点**: `claude` と同じく、起動が確定したとき（started）に記録する。そのような ID は `--resume` で終了コード 1 になるので、再開に失敗したらタブに `copilot` 用の文言を出し、記録は消さない（理由と見分け方は下の表の「何も送らずに閉じた copilot のセッション」と「再開の失敗の見分け方と伝え方」）
- **履歴で保つ知らない値**: 知らない種類の値（`agent.cliKind`）だけを保つ。エントリや `agent` の知らない欄は、今どおり保存のときに落とす（理由は「履歴への CLI の種類」の「知らない欄」）

### 設計書の決めたこと（推奨案で決めた事項。要点）

- **再開できるセッションの種類**: 設定の種類（次に起動する CLI）と同じ種類のセッションだけ再開できる。`前回の続きから` は設定の種類の最後のセッション、`このセッションで再開` は設定と同じ種類のエントリだけ押せる。main は起動のたびに設定を読んで種類を決める（L-018）ので、依頼の種類で起動の種類を変える経路を作らない
- **起動の記録の持ち方**: 種類ごとに別のファイル。`claude` は今の `agent-sessions.json` のまま（形も中身も変えない）、`copilot` は新しい `agent-sessions-copilot.json`（形は同じ `{ version: 1, folders: [{ key, ids }] }`）。記録の store（`agentSessionRecordStore.ts`）は変えずに種類ごとに 1 つずつ作る
- **会話の ID の予約**: 今の全ウィンドウで共有する 1 つの予約（`claudeSessionReservations.ts`）を種類をまたいで使う。`copilot` も同じ ID の二重の起動を `session-in-use` で拒む
- **履歴の `agent.cliKind`**: 保存の欄名 `claudeSessionId` は保つ。種類の無い古いエントリは `claude` として読む。形の正しい知らない種類は捨てずに値を保ち、そのエントリの `このセッションで再開` だけを押せなくする。`isValidHistoryEntry` と `sanitizeHistoryEntry` の両方を直す（L-015）
- **コード上の名前 `claudeSessionId`**: 型・IPC・関数の名前は変えない。型と主な関数のコメントだけを直す
- **再開の失敗の見分け方**: 再開（`resume`）で起動したタブが、画面の活動が一度も `unknown` 以外にならないまま、`copilot` 自身の終了（`reason: 'exited'`）で終了コードが 0 以外のとき。時間の上限では見ない。`claude` には当てはめない（今の「起動の直後に終了しました」のまま）
- **履歴の `再実行` の種類**: エントリの種類を見ない（今のまま）。送れたら、送り先のタブの種類で新しいエントリを記録する
- **`このセッションで再開` の種類が違うとき**: 押せず、`<エントリのコマンド名> のセッションのため、<設定のコマンド名> では再開できません（設定の「使うエージェント CLI」で <エントリのコマンド名> に切り替えると再開できます）` を出す。知らない種類は `このアプリの版が知らないエージェント CLI（<種類>）のセッションのため、再開できません`
- **前回の続きからの種類**: renderer が設定の種類を渡して「前回」を取る（`agentTerminal:getLastSession(folderPath, cliKind)`）。押した時点の再開の依頼にも種類を載せ、main は起動のたびに読んだ設定の種類と違えば起動せずに `resume-cli-mismatch` で断る
- **renderer から pty へ届く文字**: 新しい経路は作らない。ID は main の入り口で小文字の UUID v4 を検証し、さらに設定の種類の記録にある ID だけを使う（L-019・L-034）
- **copilot の版の確認**: しない（L-052）

### 起動の引数と環境変数（一字一句。設計書「起動の引数と環境変数」）

| 種類      | `new`                           | `resume`                      |
| --------- | ------------------------------- | ----------------------------- |
| `claude`  | `--session-id <ID>`（今のまま） | `--resume <ID>`（今のまま）   |
| `copilot` | `--session-id <ID>`             | `--resume=<ID>`（1 つの引数） |

- 起動の表の `extraEnv`: `claude` は `{}`、`copilot` は `{ COPILOT_DISABLE_RESUME_AUTO_CD: '1' }`。`new` でも足す
- `buildCopilotArgs` は会話の ID が `null` なら投げ、`isClaudeSessionId` に合わなければ投げる（文言に値を入れない）。hooks の設定のファイルのパスが渡ったら今までどおり投げる

### 文言（一字一句。実機テスト仕様書もこの文字列で書く。設計書「文言」）

`claude` の文言は 1 文字も変えない。

| 定数・関数                                                                           | 文言                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentResumeLastAriaLabel(commandName)`（`AGENT_RESUME_LAST_ARIA_LABEL` を置き換え） | `前回の続きから（このフォルダで最後に起動した <commandName> のセッションを再開）`                                                                              |
| `agentResumeEntryCliMismatch(entryCommandName, appCommandName)`                      | `<entry> のセッションのため、<app> では再開できません（設定の「使うエージェント CLI」で <entry> に切り替えると再開できます）`                                  |
| `agentResumeEntryUnknownCli(cliKind)`                                                | `このアプリの版が知らないエージェント CLI（<cliKind>）のセッションのため、再開できません`                                                                      |
| `AGENT_RESUME_CLI_MISMATCH`（`resume-cli-mismatch`）                                 | `使うエージェント CLI の設定が変わったため、再開しませんでした（設定を確かめてから、もう一度押してください）`                                                  |
| `AGENT_RESUME_FAILURE_NOTES.copilot`                                                 | `copilot がセッションを再開できずに終了しました。ターミナルの表示を確かめてください（何も送らずに閉じたセッションは、copilot が保存しないため再開できません）` |
| 設定の使えない機能の注記（能力の表から作る。コードは変えない）                       | `copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別`                                                                         |

### このセッションで再開の押せない理由の順（一字一句。設計書「再開の入口」）

上から順に、最初に当たったものを 1 つ出す。太字が足すもの。

1. 実行方式の読み込み中（今のまま）
2. エージェント CLI 方式でない（今のまま）
3. 設定の種類が再開に対応していない（今のまま。今の表では当たらない）
4. **エントリの種類が知らない種類**
5. **エントリの種類と設定の種類が違う**
6. 記録したフォルダを開いていない（今のまま）
7. 起動を受け付けない間（今のまま）
8. 同じ ID のタブが起動中・実行中（今のまま）
9. タブが上限（今のまま）

### 型・関数の名前（後のタスクはこの名前と型で使う）

- 履歴の種類（Task 1）: `AgentHistoryInfo.cliKind: string`（`src/shared/types/history.ts`）、`HISTORY_AGENT_CLI_KIND_PATTERN = /^[a-z][a-z0-9-]{0,31}$/`・`LEGACY_AGENT_HISTORY_CLI_KIND: AgentCliKind`（`'claude'`）・`isHistoryAgentCliKindValue(value: unknown): value is string`・`knownAgentCliKindOf(info: Pick<AgentHistoryInfo, 'cliKind'>): AgentCliKind | null`（`src/shared/historyAgentCliKind.ts`）、`AgentTabSessionSource.cliKind: AgentCliKind`（`src/renderer/src/lib/agentTabSessionInfo.ts`）
- 記録と IPC（Task 2）: `AgentLaunchRequest = { kind: 'new' } | { kind: 'resume'; claudeSessionId: string; cliKind: AgentCliKind }`・`AgentTerminalErrorKind` の `'resume-cli-mismatch'`・`AgentLastSession = { cliKind: AgentCliKind; claudeSessionId: string }`（`src/shared/types/agentTerminal.ts`）、`AGENT_SESSION_RECORD_FILE_NAMES: Record<AgentCliKind, string>`・`createAgentSessionRecordFileIo(userDataDir: string, fileName: string): AgentSessionRecordIo`（`agentSessionRecordFileIo.ts`）、`AgentSessionStarterDeps.records: Readonly<Record<AgentCliKind, Pick<AgentSessionRecordStore, 'whenLoaded' | 'has' | 'last' | 'record'>>>`・`AgentSessionStarterService.lastSessionOf(ownerId: number, folderPath: string, cliKind: AgentCliKind): Promise<AgentLastSession | null>`（`agentSessionStarter.ts`）、`parseAgentCliKind(value: unknown): AgentCliKind`（`handlers/agentTerminalPayloadParser.ts`）、`getLastAgentSession(folderPath: string, cliKind: AgentCliKind): Promise<AgentLastSession | null>`（preload・`lib/agentTerminalApi.ts`）、`UseAgentLastSessionOptions.cliKind: AgentCliKind`、`AgentLastSessionLookup` の `{ kind: 'found'; cliKind: AgentCliKind; claudeSessionId: string }`、`AgentSessionsState.resumeInNewTab(claudeSessionId: string, cliKind: AgentCliKind): string | null`、`AGENT_RESUME_CLI_MISMATCH`
- copilot の再開（Task 3）: `AgentCliLaunchSpec.extraEnv: Readonly<Record<string, string>>`、`buildAgentEnv(base, pathValue, platform, extraRemovedKeys, extraEnv: Readonly<Record<string, string>>)`、テストの補助 `AgentCliCapabilityOverrides.sessionResumeUnsupportedKinds: Set<AgentCliKind>`（renderer）
- 再開の入口（Task 4）: `agentResumeLastAriaLabel(commandName: string): string`・`agentResumeEntryCliMismatch(entryCommandName: string, appCommandName: string): string`・`agentResumeEntryUnknownCli(cliKind: string): string`（`agentSessionMessages.ts`。`AGENT_RESUME_LAST_ARIA_LABEL` は消す）
- 再開の失敗（Task 5）: `isAgentResumeFailure(input: { launchKind: AgentLaunchRequest['kind']; exit: Pick<AgentSessionExit, 'exitCode' | 'reason'>; sawScreenActivity: boolean }): boolean`（`agentSessionTabState.ts`）、`AGENT_RESUME_FAILURE_NOTES: Record<AgentCliKind, string | null>`（`agentSessionMessages.ts`）、`AgentSessionsState.noteScreenActivity(slotId: string): void`（`useAgentSessions.ts`）

### ファイルの構成（作る・変えるもの）

| ファイル                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 責務                                                                                     | タスク |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| `src/shared/historyAgentCliKind.ts`（新規）・`src/shared/types/history.ts`・`src/main/historyUtils.ts`・`src/renderer/src/lib/agentTabSessionInfo.ts`・`src/renderer/src/lib/historyEntryFactory.ts`（コメント）                                                                                                                                                                                                                                                                                                                                                                        | 履歴の種類の形・読み方・保存の正規化・送り先の控えの種類                                 | 1      |
| `src/shared/types/agentTerminal.ts`・`src/main/agentSessionRecordFileIo.ts`・`src/main/agentSessionRecordStore.ts`（コメント）・`src/main/agentSessionStarter.ts`・`src/main/handlers/agentTerminalPayloadParser.ts`・`src/main/handlers/agentTerminalHandlers.ts`・`src/main/ipcHandlers.ts`・`src/preload/api.ts`・`src/preload/index.d.ts`・`src/renderer/src/lib/agentTerminalApi.ts`・`hooks/useAgentLastSession.ts`・`hooks/useAgentResume.ts`・`hooks/useAgentSessions.ts`・`lib/agentResumeAvailability.ts`（型）・`lib/agentSessionMessages.ts`（`AGENT_RESUME_CLI_MISMATCH`） | 種類ごとの起動の記録・再開の依頼と「前回」の種類・種類の照らし合わせ                     | 2      |
| `src/main/agentCliLaunchSpecs.ts`・`src/main/agentCommand.ts`・`src/shared/agentCliKinds.ts`・`src/renderer/src/__tests__/agentCliCapabilityOverrides.ts`・`src/renderer/src/hooks/usePromptRunner.ts`（コメント）・`src/main/__tests__/agentSessionStarter.capabilities.test.ts`（新規）・`src/main/__tests__/agentCliLaunch.integration.test.ts`                                                                                                                                                                                                                                      | copilot の引数・環境変数・能力の表の `sessionResume`・前提を失うテストの直し・統合テスト | 3      |
| `src/renderer/src/lib/agentResumeAvailability.ts`・`lib/agentSessionMessages.ts`・`hooks/useAgentLastSession.ts`・`hooks/useAgentResume.ts`・`components/agent/AgentTerminalPanel.tsx`                                                                                                                                                                                                                                                                                                                                                                                                  | エントリの種類の理由・前回の結果の照らし合わせ・aria-label                               | 4      |
| `src/renderer/src/lib/agentSessionTabState.ts`・`lib/agentSessionMessages.ts`・`hooks/useAgentSessions.ts`・`hooks/useAgentWorkspace.ts`・`src/renderer/src/__tests__/makeAgentSessionsState.ts`                                                                                                                                                                                                                                                                                                                                                                                        | 再開の失敗の判定・文言・起動の控えと活動の配線                                           | 5      |
| `ROADMAP.md`・`docs/manual-test-spec.md`・（食い違いがあれば）設計書                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 段階 3a の記録・実機テスト仕様書                                                         | 6      |

---

### Task 1: 履歴の種類

> **設計書の読む節:** 「履歴への CLI の種類」（形・読み方の表・互換性・知らない欄）、「実装の分割」の 1、「テスト方針」の `knownAgentCliKindOf`・`historyUtils.test.ts`・`agentTabSessionInfo.test.ts`・`historyEntryFactory.test.ts`。
>
> **気をつける知見:** L-015（`cliKind` を `isValidHistoryEntry` と `sanitizeHistoryEntry` の両方に足し、保存の往復で落ちないことをテストで固定する）・L-044（形の不正な `cliKind` は既定の `claude` に流さずエントリを捨てる。種類の無い古いエントリだけを `claude` として読む）・L-456（古い履歴の ID・時刻を作り直さず、欠けている `cliKind` だけを補う）・L-459（知らない種類の値は保つ。知らない欄は保たない今の規則は変えない）・L-060（`AgentHistoryInfo.cliKind` は省略できない欄にし、作るすべての箇所を同じタスクで直す）・L-017（知らない種類の値を文言に出すのは、形を検証した値だけ。Task 4 で使う）

**Files:**

- Create: `src/shared/historyAgentCliKind.ts`
- Modify: `src/shared/types/history.ts`・`src/main/historyUtils.ts`・`src/renderer/src/lib/agentTabSessionInfo.ts`・`src/renderer/src/lib/historyEntryFactory.ts`（コメントだけ）
- Test（新規）: `src/shared/__tests__/historyAgentCliKind.test.ts`
- Test（変更）: `src/main/__tests__/historyUtils.test.ts`・`src/renderer/src/lib/__tests__/agentTabSessionInfo.test.ts`・`src/renderer/src/lib/__tests__/historyEntryFactory.test.ts`
- Test（`AgentHistoryInfo` の値に `cliKind: 'claude'` を足すだけ）: `src/main/__tests__/handlers/historyHandlers.test.ts`・`src/main/__tests__/historyUtils.test.ts`・`src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx`・`src/renderer/src/components/__tests__/Sidebar.test.tsx`・`src/renderer/src/components/history/__tests__/HistoryDetail.styles.test.tsx`・`src/renderer/src/components/history/__tests__/HistoryDetail.test.tsx`・`src/renderer/src/components/history/__tests__/HistoryItem.test.tsx`・`src/renderer/src/components/history/__tests__/HistoryPanel.test.tsx`・`src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`・`src/renderer/src/hooks/__tests__/useAgentResume.test.ts`・`src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`・`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`・`src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts`・`src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts`・`src/renderer/src/lib/__tests__/agentTabSessionInfo.test.ts`・`src/renderer/src/lib/__tests__/historyEntryFactory.test.ts`・`src/renderer/src/lib/__tests__/historyFormatters.test.ts`

**Interfaces:**

- Consumes: `AGENT_CLI_KINDS`・`isAgentCliKind`・`AgentCliKind`（`src/shared/agentCliKinds.ts`。既存）、`isClaudeSessionId`（`@shared/types`。既存）
- Produces（Task 2〜5 が使う）:

```ts
// src/shared/types/history.ts
export interface AgentHistoryInfo {
  claudeSessionId: string
  cliKind: string
  tabLabel: string
  folderPath: string
}

// src/shared/historyAgentCliKind.ts
export const HISTORY_AGENT_CLI_KIND_PATTERN: RegExp // /^[a-z][a-z0-9-]{0,31}$/
export const LEGACY_AGENT_HISTORY_CLI_KIND: AgentCliKind // 'claude'
export function isHistoryAgentCliKindValue(value: unknown): value is string
export function knownAgentCliKindOf(info: Pick<AgentHistoryInfo, 'cliKind'>): AgentCliKind | null

// src/renderer/src/lib/agentTabSessionInfo.ts
export interface AgentTabSessionSource {
  slotId: string
  label: string
  status: AgentSessionStatus
  cliKind: AgentCliKind
  claudeSessionId: string | null
}
```

この時点の `copilot` のタブは会話の ID を持たないので、送り先の控えは今までどおり `null`（`copilot` のエントリはまだ作られない）。

- [ ] **Step 1: 既存のテストの `AgentHistoryInfo` の値に `cliKind: 'claude'` を足す（型を変える前の準備。挙動は変えない）**

`AgentHistoryInfo` を作るテストの値（`tabLabel:` を持つオブジェクト）に、`tabLabel` の前へ `cliKind: 'claude', ` を足す。実装のファイル（`src/shared/types/history.ts`・`src/main/historyUtils.ts`・`src/renderer/src/lib/agentTabSessionInfo.ts`・`src/renderer/src/lib/historyFormatters.ts`）にはかけない（Step 4・5 で手で直す）。

```bash
cd <repo-root>
set -- \
  src/main/__tests__/handlers/historyHandlers.test.ts \
  src/main/__tests__/historyUtils.test.ts \
  src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx \
  src/renderer/src/components/__tests__/Sidebar.test.tsx \
  src/renderer/src/components/history/__tests__/HistoryDetail.styles.test.tsx \
  src/renderer/src/components/history/__tests__/HistoryDetail.test.tsx \
  src/renderer/src/components/history/__tests__/HistoryItem.test.tsx \
  src/renderer/src/components/history/__tests__/HistoryPanel.test.tsx \
  src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts \
  src/renderer/src/hooks/__tests__/useAgentResume.test.ts \
  src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts \
  src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts \
  src/renderer/src/hooks/__tests__/usePromptRunner.test.ts \
  src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts \
  src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts \
  src/renderer/src/lib/__tests__/agentTabSessionInfo.test.ts \
  src/renderer/src/lib/__tests__/historyEntryFactory.test.ts \
  src/renderer/src/lib/__tests__/historyFormatters.test.ts
for f in "$@"; do test -f "$f" || echo "missing: $f"; done
perl -pi -e "s/\btabLabel: /cliKind: 'claude', tabLabel: /g" "$@"
npx prettier --write "$@"
grep -c "cliKind: 'claude'" "$@"
grep -rn "tabLabel:" src --include='*.test.ts' --include='*.test.tsx' | grep -v "cliKind" || echo "残りなし"
```

Expected: `missing` は出ない。`grep -c` がどのファイルも 1 以上。最後の `grep` は、複数行に整形されたオブジェクトの `tabLabel:` の行を出すことがあるので、出た行の 1 つ上の行に `cliKind: 'claude',` があることを目で確かめる（無い行があれば手で足す）。ほかのファイルで `tabLabel:` を持つテストが見つかれば、同じように足して、このプランの完了の報告に書く。

この時点では型にまだ `cliKind` が無いので、`npm run typecheck` は「オブジェクトのリテラルは既知のプロパティだけ」で落ちる。Step 4 で型に足すと通る。

- [ ] **Step 2: 失敗するテストを書く（種類の読み方・履歴の検証と保存・送り先の控え・エントリの作り方）**

`src/shared/__tests__/historyAgentCliKind.test.ts` を作る:

```ts
import { describe, it, expect } from 'vitest'
import {
  HISTORY_AGENT_CLI_KIND_PATTERN,
  LEGACY_AGENT_HISTORY_CLI_KIND,
  isHistoryAgentCliKindValue,
  knownAgentCliKindOf
} from '../historyAgentCliKind'

describe('isHistoryAgentCliKindValue(履歴に保てる種類の値)', () => {
  it.each(['claude', 'copilot', 'gemini', 'a', `a${'b'.repeat(31)}`, 'gemini-2', 'x1'])(
    '%s は形が正しい(知らない種類も保つ)',
    (value) => {
      expect(isHistoryAgentCliKindValue(value)).toBe(true)
    }
  )

  it.each<[string, unknown]>([
    ['空', ''],
    ['大文字を含む', 'Gemini'],
    ['数字で始まる', '1abc'],
    ['ハイフンで始まる', '-gemini'],
    ['33 文字', `a${'b'.repeat(32)}`],
    ['空白を含む', 'gem ini'],
    ['下線を含む', 'gem_ini'],
    ['数', 1],
    ['null', null],
    ['undefined', undefined]
  ])('%s は形が正しくない', (_label, value) => {
    expect(isHistoryAgentCliKindValue(value)).toBe(false)
  })

  it('形の規則は英小文字で始まる 1〜32 文字の英小文字・数字・ハイフン', () => {
    expect(HISTORY_AGENT_CLI_KIND_PATTERN.source).toBe('^[a-z][a-z0-9-]{0,31}$')
  })
})

describe('knownAgentCliKindOf(この版が知っている種類として読む)', () => {
  it('claude・copilot はその値、知らない種類(gemini)は null', () => {
    expect(knownAgentCliKindOf({ cliKind: 'claude' })).toBe('claude')
    expect(knownAgentCliKindOf({ cliKind: 'copilot' })).toBe('copilot')
    expect(knownAgentCliKindOf({ cliKind: 'gemini' })).toBeNull()
  })

  it('段階 3a より前のエントリの種類は claude(当時は claude だけが記録された)', () => {
    expect(LEGACY_AGENT_HISTORY_CLI_KIND).toBe('claude')
  })
})
```

`src/main/__tests__/historyUtils.test.ts` の末尾に足す（`agentEntry` は Step 1 で `cliKind: 'claude'` を持つようになっている）:

```ts
describe('agent.cliKind(段階 3a。履歴への CLI の種類)', () => {
  // 段階 3a より前のエージェントのエントリ(agent に cliKind が無い)
  const legacyAgentEntry = (): Record<string, unknown> => {
    const agent: Record<string, unknown> = { ...agentEntry.agent }
    delete agent.cliKind
    return { ...agentEntry, agent }
  }
  const withCliKind = (cliKind: unknown): Record<string, unknown> => ({
    ...agentEntry,
    agent: { ...agentEntry.agent, cliKind }
  })

  it('種類の無い古いエントリは有効で、保存の正規化で claude を補う(ID・時刻・ほかの欄は作り直さない。L-456)', () => {
    const legacy = legacyAgentEntry()
    expect(isValidHistoryEntry(legacy)).toBe(true)
    const sanitized = sanitizeHistoryEntry(legacy as HistoryEntry)
    expect(sanitized).toEqual(agentEntry)
    expect(sanitized.id).toBe(agentEntry.id)
    expect(sanitized.executedAt).toBe(agentEntry.executedAt)
    expect(sanitized.agent?.claudeSessionId).toBe(agentEntry.agent?.claudeSessionId)
  })

  it.each(['copilot', 'gemini'])(
    '%s の種類は読み込み(検証と正規化)と保存の往復で値を保つ(L-015・L-459)',
    (cliKind) => {
      const entry = withCliKind(cliKind)
      expect(isValidHistoryEntry(entry)).toBe(true)
      const once = sanitizeHistoryEntry(entry as HistoryEntry)
      expect(once.agent?.cliKind).toBe(cliKind)
      expect(isValidHistoryEntry(once)).toBe(true)
      expect(sanitizeHistoryEntry(once)).toEqual(once)
    }
  )

  it.each<[string, unknown]>([
    ['数', 1],
    ['空', ''],
    ['大文字を含む', 'Gemini'],
    ['33 文字', `a${'b'.repeat(32)}`],
    ['null', null]
  ])(
    '形の不正な cliKind(%s)のエントリは捨てる(既定の claude に読み替えない。L-044)',
    (_label, cliKind) => {
      expect(isValidHistoryEntry(withCliKind(cliKind))).toBe(false)
    }
  )

  it('agent の中の知らない欄は今どおり落とし、種類は保つ', () => {
    const entry = { ...agentEntry, agent: { ...agentEntry.agent, cliKind: 'gemini', extra: 'x' } }
    const sanitized = sanitizeHistoryEntry(entry as HistoryEntry)
    expect(sanitized.agent).toEqual({ ...agentEntry.agent, cliKind: 'gemini' })
    expect(sanitized.agent).not.toHaveProperty('extra')
  })
})
```

`src/renderer/src/lib/__tests__/agentTabSessionInfo.test.ts` を次のように直す（`tab` の既定に `cliKind: 'claude'` を足し、`copilot` のタブのテストを足す）:

```ts
const tab = (overrides: Partial<AgentTabSessionSource>): AgentTabSessionSource => ({
  slotId: 'tab-1',
  label: 'claude',
  status: 'running',
  cliKind: 'claude',
  claudeSessionId: ID_A,
  ...overrides
})
```

`describe('describeAgentTabSession', …)` の中に足す:

```ts
it('送り先の種類はタブの種類(起動の結果の種類)', () => {
  const tabs = [
    tab({ slotId: 'tab-2', label: 'copilot 2', cliKind: 'copilot', claudeSessionId: ID_B })
  ]
  expect(describeAgentTabSession(tabs, 'tab-2', '/work')).toEqual({
    claudeSessionId: ID_B,
    cliKind: 'copilot',
    tabLabel: 'copilot 2',
    folderPath: '/work'
  })
})
```

`src/renderer/src/lib/__tests__/historyEntryFactory.test.ts` の `describe('buildAgentSentHistoryEntry', …)` の中に足す:

```ts
it('agent.cliKind は送り先の種類(copilot へ送ったエントリは copilot)。ツールの欄は今までどおり claude', () => {
  const copilotSent = { ...sent, cliKind: 'copilot', tabLabel: 'copilot 1' }
  const entry = buildAgentSentHistoryEntry(
    { promptId: 'p1', promptTitle: 'タイトル' },
    '全文',
    copilotSent,
    1
  )
  expect(entry.agent).toEqual(copilotSent)
  expect(entry.agent?.cliKind).toBe('copilot')
  expect(entry.toolId).toBe('claude')
})
```

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/shared/__tests__/historyAgentCliKind.test.ts src/main/__tests__/historyUtils.test.ts src/renderer/src/lib/__tests__/agentTabSessionInfo.test.ts src/renderer/src/lib/__tests__/historyEntryFactory.test.ts`
Expected: FAIL。`historyAgentCliKind.test.ts` は `../historyAgentCliKind` が無くて読み込みで落ちる。`historyUtils.test.ts` は「種類の無い古いエントリ…claude を補う」「copilot・gemini を保つ」「形の不正な cliKind のエントリは捨てる」「知らない欄は落とし、種類は保つ」と、既存の `agentEntry` を使う「agent を残し、agent の中の余分なキーを落とす」（今の正規化は `cliKind` を落とす）が落ちる。`agentTabSessionInfo.test.ts` は `cliKind` が返らずに落ちる。`historyEntryFactory.test.ts` の新しいテストは型の上では通らないが vitest は型を見ないので PASS しうる（実装を変えない関数なので、Step 6 の型検査で確かめる）

- [ ] **Step 4: 型と種類の読み方を書く**

`src/shared/historyAgentCliKind.ts` を作る:

```ts
import { isAgentCliKind } from './agentCliKinds'
import type { AgentCliKind } from './agentCliKinds'
import type { AgentHistoryInfo } from './types/history'

// 履歴のエントリの送り先の CLI の種類(設計書 2026-10-23「履歴への CLI の種類」)。新しい版で作った知らない種類の値も捨てずに保つため、
// 保存の形は文字列にし、AgentCliKind として使うときはここで読む(renderer の判定で文字列を種類の表のキーに直接使わない)。
// main の検証(historyUtils.ts)と renderer の判定が同じ規則を使う

/** 形の正しい種類の値(英小文字で始まり、英小文字・数字・ハイフンの 1〜32 文字)。知らない種類もこの形なら保つ */
export const HISTORY_AGENT_CLI_KIND_PATTERN = /^[a-z][a-z0-9-]{0,31}$/

/** 段階 3a より前のエントリ(cliKind が無い)の種類。当時は claude へ送ったプロンプトだけが記録されたため(既定の種類とは別の値) */
export const LEGACY_AGENT_HISTORY_CLI_KIND: AgentCliKind = 'claude'

/** 履歴に保てる種類の値か(知らない種類を含む) */
export function isHistoryAgentCliKindValue(value: unknown): value is string {
  return typeof value === 'string' && HISTORY_AGENT_CLI_KIND_PATTERN.test(value)
}

/** 送り先の種類を、この版が知っている種類として読む。知らない種類(新しい版の種類)は null */
export function knownAgentCliKindOf(info: Pick<AgentHistoryInfo, 'cliKind'>): AgentCliKind | null {
  return isAgentCliKind(info.cliKind) ? info.cliKind : null
}
```

`src/shared/types/history.ts` の `AgentHistoryInfo` を次にする:

```ts
/** エージェント CLI 方式で送ったときの送り先(送信の手順を始める時点に控えたタブの状態とフォルダ)。送信の onSent・describeSession も同じ型 */
export interface AgentHistoryInfo {
  /** 送り先のタブで動いていたエージェント CLI の会話の ID(UUID。claude・copilot)。欄名は古い版との互換のため claude のまま */
  claudeSessionId: string
  /** 送り先のタブの CLI の種類。知らない種類(新しい版の種類)の値も保つ。AgentCliKind として使うときは knownAgentCliKindOf で読む
   *  (shared/historyAgentCliKind.ts)。段階 3a より前のエントリは無く、読み込みで claude を補う */
  cliKind: string
  /** 送り先のタブの名前(claude 2・copilot 1 など) */
  tabLabel: string
  /** 送ったときに開いていたフォルダ(renderer の文字列) */
  folderPath: string
}
```

- [ ] **Step 5: 履歴の検証と保存の正規化・送り先の控えを直す**

`src/main/historyUtils.ts`:

import に足す:

```ts
import {
  LEGACY_AGENT_HISTORY_CLI_KIND,
  isHistoryAgentCliKindValue
} from '@shared/historyAgentCliKind'
```

`isAgentHistoryInfo` の戻り値の式を次にする:

```ts
return (
  isClaudeSessionId(a.claudeSessionId) &&
  // 段階 3a より前のエントリは cliKind が無い(正規化で claude を補う)。形の不正な値は既定に流さず不正とする(L-044)
  (a.cliKind === undefined || isHistoryAgentCliKindValue(a.cliKind)) &&
  isNonEmptyString(a.tabLabel) &&
  isNonEmptyString(a.folderPath)
)
```

`sanitizeHistoryEntry` の上のコメントの 2 行目を `// 古い形式(agent 無し)は null にし、agent の中も 4 つのフィールドだけに作り直す(cliKind が無い段階 3a より前のエントリは claude を補う)` にし、`agent` の作り直しを次にする:

```ts
        : {
            claudeSessionId: agent.claudeSessionId,
            // 段階 3a より前のエントリは cliKind が無い(型の外の値)。知らない種類の値はそのまま保つ(L-456・L-459)
            cliKind: (agent.cliKind as string | undefined) ?? LEGACY_AGENT_HISTORY_CLI_KIND,
            tabLabel: agent.tabLabel,
            folderPath: agent.folderPath
          }
```

`src/renderer/src/lib/agentTabSessionInfo.ts` を次にする（冒頭の import とコメント・型・戻り値）:

```ts
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentHistoryInfo } from '@shared/types'
import type { AgentSessionStatus } from './agentSessionTabState'

// タブの状態からエージェント CLI の会話の情報を取り出す純粋な関数(セッションの再開の設計書「履歴への記録」、段階 3a の設計書
// 「履歴への CLI の種類」)。組み立ては useAgentWorkspace。React に依存しない

/** 送り先の控えに使うタブの値(AgentSessionTabView の一部) */
export interface AgentTabSessionSource {
  slotId: string
  label: string
  status: AgentSessionStatus
  /** タブの種類(起動の結果の種類。無ければ設定の種類。AgentSessionTabView.cliKind) */
  cliKind: AgentCliKind
  claudeSessionId: string | null
}

/**
 * slotId のタブの今の会話の ID・種類・名前と開いているフォルダ(履歴の HistoryEntry.agent と同じ形)。タブが無い・
 * ID が無い(起動中の new・終了・起動の失敗)・フォルダを開いていなければ null
 */
export function describeAgentTabSession(
  tabs: readonly AgentTabSessionSource[],
  slotId: string,
  folderPath: string | null
): AgentHistoryInfo | null {
  const tab = tabs.find((t) => t.slotId === slotId)
  if (tab === undefined || tab.claudeSessionId === null || folderPath === null) return null
  return {
    claudeSessionId: tab.claudeSessionId,
    cliKind: tab.cliKind,
    tabLabel: tab.label,
    folderPath
  }
}
```

`src/renderer/src/lib/historyEntryFactory.ts` の `buildAgentSentHistoryEntry` のコメントを次にする（コードは変えない）:

```ts
/**
 * エージェント CLI 方式で送れたときの履歴のエントリ(結果の文章は記録しない。status は sent、ツールは claude)。
 * text は送った全文(参照を足した後)、sentTo は送信の手順を始める時点に控えた送り先(送り先のタブの CLI の種類を含む)。
 * toolId は従来の方式の claude のまま(従来の方式の copilot は gh copilot -p を指すので流用しない。種類は agent.cliKind とタブ名で分かる)
 */
```

- [ ] **Step 6: テストと型検査が通ることを確かめる**

Run: `npx vitest run src/shared/__tests__/historyAgentCliKind.test.ts src/main/__tests__/historyUtils.test.ts src/main/__tests__/handlers/historyHandlers.test.ts src/renderer/src/lib/__tests__/agentTabSessionInfo.test.ts src/renderer/src/lib/__tests__/historyEntryFactory.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: PASS（`useAgentWorkspace.test.ts` の「送り先の控え(describeSession)」は、Step 1 で期待に `cliKind: 'claude'` が入り、`makeAgentSessionTabView` の既定の種類が `claude` なので通る）
Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: 実装を外すとテストが落ちることを確かめる（手で外して手で戻す）**

1. `src/main/historyUtils.ts` の `sanitizeHistoryEntry` の `cliKind: (agent.cliKind as string | undefined) ?? LEGACY_AGENT_HISTORY_CLI_KIND,` を `cliKind: LEGACY_AGENT_HISTORY_CLI_KIND,` に書き換える → `npx vitest run src/main/__tests__/historyUtils.test.ts` で「copilot・gemini の種類は…値を保つ」の 2 件が落ちる → 元の行に手で戻す
2. `isAgentHistoryInfo` の `(a.cliKind === undefined || isHistoryAgentCliKindValue(a.cliKind)) &&` の行を消す → 同じテストで「形の不正な cliKind…捨てる」の 5 件が落ちる → 手で戻す
3. `describeAgentTabSession` の戻り値の `cliKind: tab.cliKind,` を `cliKind: 'claude',` に書き換える → `npx vitest run src/renderer/src/lib/__tests__/agentTabSessionInfo.test.ts` で「送り先の種類はタブの種類」が落ちる → 手で戻す

戻したことを `git diff src/main/historyUtils.ts src/renderer/src/lib/agentTabSessionInfo.ts` で確かめ（Step 5 の差分だけが出る）、Step 6 のテストを流し直して PASS を確かめる。

- [ ] **Step 8: 全体の検証**

```bash
cd <repo-root>
npm run typecheck
set -- src/shared/historyAgentCliKind.ts src/shared/types/history.ts src/main/historyUtils.ts \
  src/renderer/src/lib/agentTabSessionInfo.ts src/renderer/src/lib/historyEntryFactory.ts \
  src/shared/__tests__/historyAgentCliKind.test.ts src/main/__tests__/historyUtils.test.ts \
  src/main/__tests__/handlers/historyHandlers.test.ts \
  src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx \
  src/renderer/src/components/__tests__/Sidebar.test.tsx \
  src/renderer/src/components/history/__tests__/HistoryDetail.styles.test.tsx \
  src/renderer/src/components/history/__tests__/HistoryDetail.test.tsx \
  src/renderer/src/components/history/__tests__/HistoryItem.test.tsx \
  src/renderer/src/components/history/__tests__/HistoryPanel.test.tsx \
  src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts \
  src/renderer/src/hooks/__tests__/useAgentResume.test.ts \
  src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts \
  src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts \
  src/renderer/src/hooks/__tests__/usePromptRunner.test.ts \
  src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts \
  src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts \
  src/renderer/src/lib/__tests__/agentTabSessionInfo.test.ts \
  src/renderer/src/lib/__tests__/historyEntryFactory.test.ts \
  src/renderer/src/lib/__tests__/historyFormatters.test.ts
npx prettier --write "$@"
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
npx vitest run
```

Expected: どれも PASS（`npx vitest run` の時間切れは Global Constraints のとおり単体で流し直す）

- [ ] **Step 9: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 2: 起動の記録の種類ごとのファイルと IPC の型

> **設計書の読む節:** 「起動の記録（種類ごとのファイル）」、「起動の流れ（`agentSessionStarter.ts`）」、「IPC と型」、「再開の入口（押せない理由）」の「前回の続きから」の 1 つ目の箇条書き、「エラー処理」の `resume-cli-mismatch` と記録のファイルの行、「文言」の `AGENT_RESUME_CLI_MISMATCH`、「実装の分割」の 2、「テスト方針」の `agentSessionRecordFileIo.test.ts`・`agentSessionStarter.test.ts`・`agentTerminalPayloadParser.test.ts`。
>
> **気をつける知見:** L-002・L-006（`copilot` の記録は別のファイル・別の store にし、`copilot` の記録が読めなくても `claude` の起動と記録に影響させない）・L-018（起動の種類は main が起動のたびに読んだ設定〈`launch.plan.cliKind`〉で決め、依頼の種類は照らし合わせにだけ使う）・L-019・L-034（renderer は列挙型の起動の指定と種類だけを渡し、ID は入り口で小文字の UUID v4 を検証して記録と照合する）・L-044（再開の依頼の `cliKind`・`getLastSession` の `cliKind` が無い・知らない値は既定の `claude` に流さずに投げる）・L-060（starter の `records` は種類をキーにした表で、起動の指定の `cliKind` は省略できない）・L-001（記録は起動の確定〈started〉のときだけ書く。今の規則のまま）・L-037（「前回」の結果に種類を載せ、renderer が依頼と違う種類の結果を捨てられるようにする。捨てる規則は Task 4）・L-456・L-459（今の `agent-sessions.json` の形・中身・ID・順序には触れない。`copilot` の記録は古い版の書き戻しで消えない別のファイルにする）

**Files:**

- Modify: `src/shared/types/agentTerminal.ts`
- Modify: `src/main/agentSessionRecordFileIo.ts`・`src/main/agentSessionRecordStore.ts`（冒頭のコメントだけ）・`src/main/agentSessionStarter.ts`・`src/main/handlers/agentTerminalPayloadParser.ts`・`src/main/handlers/agentTerminalHandlers.ts`・`src/main/ipcHandlers.ts`
- Modify: `src/preload/api.ts`・`src/preload/index.d.ts`
- Modify: `src/renderer/src/lib/agentTerminalApi.ts`・`src/renderer/src/hooks/useAgentLastSession.ts`・`src/renderer/src/hooks/useAgentResume.ts`・`src/renderer/src/hooks/useAgentSessions.ts`・`src/renderer/src/lib/agentResumeAvailability.ts`（`AgentLastSessionLookup` の型だけ）・`src/renderer/src/lib/agentSessionMessages.ts`（`AGENT_RESUME_CLI_MISMATCH` と `describeAgentStartError` の `case`）
- Test（変更）: `src/main/__tests__/agentSessionRecordFileIo.test.ts`・`src/main/__tests__/ipcHandlers.test.ts`・`src/main/__tests__/agentSessionStarter.test.ts`・`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`・`src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts`・`src/main/__tests__/claudeSessionIdSelection.test.ts`・`src/main/__tests__/agentCliLaunchSpecs.test.ts`（`RESUME` の値だけ）・`src/preload/__tests__/api.test.ts`・`src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`・`src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts`・`src/renderer/src/hooks/__tests__/useAgentResume.test.ts`・`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`・`src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx`・`src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts`・`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`

**Interfaces:**

- Consumes: `AgentHistoryInfo.cliKind`・`knownAgentCliKindOf(info): AgentCliKind | null`（Task 1）、`AGENT_CLI_KINDS`・`isAgentCliKind`（既存）、`createAgentSessionRecordStore(io)`・`AgentSessionRecordStore`・`toAgentFolderKey`（`agentSessionRecordStore.ts`。既存）
- Produces（Task 3〜5 が使う）:

```ts
// src/shared/types/agentTerminal.ts
export type AgentTerminalErrorKind = /* 今の値 */ | 'resume-cli-mismatch'
export type AgentLaunchRequest =
  | { kind: 'new' }
  | { kind: 'resume'; claudeSessionId: string; cliKind: AgentCliKind }
export interface AgentLastSession {
  cliKind: AgentCliKind
  claudeSessionId: string
}

// src/main/agentSessionRecordFileIo.ts
export const AGENT_SESSION_RECORD_FILE_NAMES: Record<AgentCliKind, string>
export function createAgentSessionRecordFileIo(userDataDir: string, fileName: string): AgentSessionRecordIo

// src/main/agentSessionStarter.ts
export interface AgentSessionStarterDeps {
  // …今の値…
  records: Readonly<
    Record<AgentCliKind, Pick<AgentSessionRecordStore, 'whenLoaded' | 'has' | 'last' | 'record'>>
  >
}
export interface AgentSessionStarterService {
  // …今の値…
  lastSessionOf(ownerId: number, folderPath: string, cliKind: AgentCliKind): Promise<AgentLastSession | null>
}

// src/main/handlers/agentTerminalPayloadParser.ts
export function parseAgentCliKind(value: unknown): AgentCliKind

// src/preload/api.ts・src/preload/index.d.ts・src/renderer/src/lib/agentTerminalApi.ts
getLastAgentSession(folderPath: string, cliKind: AgentCliKind): Promise<AgentLastSession | null>

// src/renderer/src/hooks/useAgentLastSession.ts
export interface UseAgentLastSessionOptions {
  folderPath: string | null
  cliKind: AgentCliKind
  enabled: boolean
  refreshKey: string
}

// src/renderer/src/lib/agentResumeAvailability.ts
export type AgentLastSessionLookup =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'found'; cliKind: AgentCliKind; claudeSessionId: string }

// src/renderer/src/hooks/useAgentSessions.ts
resumeInNewTab: (claudeSessionId: string, cliKind: AgentCliKind) => string | null

// src/renderer/src/lib/agentSessionMessages.ts
export const AGENT_RESUME_CLI_MISMATCH: string
```

このタスクの間、`copilot` の能力の `sessionResume` は `false` のままなので、`copilot` は記録せず、ID を振らず、引数は空のまま（既存のテストが通る）。`copilot` の再開の依頼は、種類の照らし合わせより前の `resume-unsupported` で断られる（照らし合わせは `sessionResume` の確かめの直後）。

- [ ] **Step 1: 既存のテストの機械的な直し（再開の依頼・「前回」の結果に種類を足す）**

単一行の値を ASCII のパターンで直す。直した後に prettier をかける。

```bash
cd <repo-root>
set -- \
  src/main/__tests__/agentSessionStarter.test.ts \
  src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts \
  src/main/__tests__/claudeSessionIdSelection.test.ts \
  src/main/__tests__/agentCliLaunchSpecs.test.ts \
  src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx \
  src/renderer/src/hooks/__tests__/useAgentResume.test.ts
for f in "$@"; do test -f "$f" || echo "missing: $f"; done
# 1 行に書いた再開の依頼に cliKind: 'claude' を足す(余分なキーを持つ値・ID の無い値には当たらない)
perl -pi -e "s/kind: 'resume', claudeSessionId: ([^,}]+?) \}/kind: 'resume', claudeSessionId: \$1, cliKind: 'claude' }/g" "$@"
set -- \
  src/renderer/src/hooks/__tests__/useAgentResume.test.ts \
  src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts \
  src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts \
  src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts
# 「前回」の結果(found)に種類を足す
perl -pi -e "s/kind: 'found', claudeSessionId/kind: 'found', cliKind: 'claude', claudeSessionId/g; s/kind: 'found' as const, claudeSessionId/kind: 'found' as const, cliKind: 'claude' as const, claudeSessionId/g" "$@"
# starter・IPC の受け口の「前回」の取得に種類を足す
set -- src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts
perl -pi -e "s/lastSessionOf\((\d), ('[^']*')\)/lastSessionOf(\$1, \$2, 'claude')/g; s/resolves\.toEqual\(\{ claudeSessionId: (ID|CLAUDE_ID) \}\)/resolves.toEqual({ cliKind: 'claude', claudeSessionId: \$1 })/g" "$@"
# useAgentLastSession のテストの依頼の引数・結果・呼び出しの確かめに種類を足す
f=src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts
perl -pi -e "s/refreshKey: /cliKind: 'claude', refreshKey: /g; s/\{ claudeSessionId: (A|B) \}/{ cliKind: 'claude', claudeSessionId: \$1 }/g; s/(toHaveBeen(?:CalledExactlyOnceWith|LastCalledWith))\('(\/[wx])'\)/\$1('\$2', 'claude')/g" "$f"
# useAgentSessions のテストの resumeInNewTab の呼び出しに種類を足す
perl -pi -e "s/resumeInNewTab\(CSID\)/resumeInNewTab(CSID, 'claude')/g" src/renderer/src/hooks/__tests__/useAgentSessions.test.ts
git diff --stat
```

Expected: `missing` は出ない。`git diff --stat` に上の 11 ファイルが出る。

続けて、パターンに当たらない箇所を手で直す:

1. `src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts`:
   - import に `parseAgentCliKind` を足す
   - 「new と、小文字の UUID v4 の resume を返す」の `.toEqual({ kind: 'resume', claudeSessionId: ID })`（複数行の方）に `cliKind: 'claude'` を足す
   - `it.each` の `['resume に余分なキー', { kind: 'resume', claudeSessionId: ID, fork: true }]` を `{ kind: 'resume', claudeSessionId: ID, cliKind: 'claude', fork: true }` に、`['resume の ID が無い', { kind: 'resume' }]` を `{ kind: 'resume', cliKind: 'claude' }` にする（どちらも、狙った理由だけで投げることを確かめるため）
2. `src/main/__tests__/handlers/agentTerminalHandlers.test.ts`: `getLast` の補助を次にする:

   ```ts
   const getLast = (
     event: ReturnType<typeof makeEvent>,
     folderPath: unknown,
     cliKind: unknown = 'claude'
   ): Promise<unknown> =>
     handles.get('agentTerminal:getLastSession')?.(event, folderPath, cliKind) as Promise<unknown>
   ```

3. `src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`: `resumeOf` を次にする（import に `AgentCliKind` があることを確かめる。あれば足さない）:

   ```ts
   const resumeOf = (
     claudeSessionId: string,
     cliKind: AgentCliKind = 'claude'
   ): AgentLaunchRequest => ({
     kind: 'resume',
     claudeSessionId,
     cliKind
   })
   ```

4. `src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`:
   - 「useAgentLastSession に開いているフォルダ・…を渡す」の `toHaveBeenLastCalledWith({ folderPath: '/p', enabled: true, refreshKey: '3' })` に `cliKind: 'claude'` を足す
   - 「押せるときは、そのタブで前回の ID を resume で起動する」の `toHaveBeenCalledExactlyOnceWith('slot-1', { kind: 'resume', claudeSessionId: ID })`（複数行）に `cliKind: 'claude'` を足す
   - 「onResume は新しいタブで再開し…」の `expect(sessions.resumeInNewTab).toHaveBeenCalledExactlyOnceWith(ID)` を `(ID, 'claude')` にする
5. `src/renderer/src/hooks/__tests__/useAgentResume.test.ts`:
   - 「起動の確定の回数だけを取り直しの契機にし…」の `toHaveBeenLastCalledWith({ folderPath: FOLDER, enabled: false, refreshKey: '0' })` に `cliKind: 'claude'` を足す
   - 「押せるときは新しいタブで再開し、足したタブへ移る」の `toHaveBeenCalledWith(ID)` を `(ID, 'claude')` にする
6. `src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx`:
   - `window.api.getLastAgentSession = vi.fn().mockResolvedValue({ claudeSessionId: ID })` を `mockResolvedValue({ cliKind: 'claude', claudeSessionId: ID })` にする
   - `expect(window.api.getLastAgentSession).toHaveBeenCalledWith('/project')` を `('/project', 'claude')` にする
7. `src/preload/__tests__/api.test.ts`: `getLastAgentSession` の行を次にする:

   ```ts
       [
         'getLastAgentSession は agentTerminal:getLastSession にフォルダと種類を渡す',
         () => api.getLastAgentSession('/p', 'copilot'),
         ['agentTerminal:getLastSession', '/p', 'copilot']
       ],
   ```

8. `src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`: `agentTerminalApi.getLastAgentSession('/p')` を `('/p', 'copilot')` に、`expect(mockApi.getLastAgentSession).toHaveBeenCalledWith('/p')` を `('/p', 'copilot')` にする

- [ ] **Step 2: 失敗するテストを書く（記録のファイル名・store の組み立て・種類の照らし合わせ・種類ごとの記録・入力の検証・依頼の種類）**

`src/main/__tests__/agentSessionRecordFileIo.test.ts` の全体を次にする:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import {
  AGENT_SESSION_RECORD_FILE_NAMES,
  createAgentSessionRecordFileIo
} from '../agentSessionRecordFileIo'

const CLAUDE_FILE = 'agent-sessions.json'

let tempDir: string | null = null

afterEach(async () => {
  if (tempDir !== null) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('AGENT_SESSION_RECORD_FILE_NAMES(種類ごとのファイル名)', () => {
  it('claude は段階 3a より前と同じ agent-sessions.json、copilot は agent-sessions-copilot.json', () => {
    expect(AGENT_SESSION_RECORD_FILE_NAMES).toEqual({
      claude: 'agent-sessions.json',
      copilot: 'agent-sessions-copilot.json'
    })
  })

  it('種類ごとに違うファイル(同じファイルを 2 つの store が書かない)', () => {
    const names = AGENT_CLI_KINDS.map((kind) => AGENT_SESSION_RECORD_FILE_NAMES[kind])
    expect(new Set(names).size).toBe(AGENT_CLI_KINDS.length)
  })
})

describe('createAgentSessionRecordFileIo', () => {
  it('userData/<ファイル名> を読み書きし、無いディレクトリは作る', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-sessions-'))
    const dir = join(tempDir, 'nested')
    const io = createAgentSessionRecordFileIo(dir, CLAUDE_FILE)
    await expect(io.read()).rejects.toMatchObject({ code: 'ENOENT' })
    await io.write('{"version":1,"folders":[]}')
    expect(await readFile(join(dir, CLAUDE_FILE), 'utf-8')).toBe('{"version":1,"folders":[]}')
    await expect(io.read()).resolves.toBe('{"version":1,"folders":[]}')
  })

  it('copilot のファイル名で作った入出力は copilot のファイルにだけ書き、claude のファイルに触れない', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-sessions-'))
    const io = createAgentSessionRecordFileIo(tempDir, AGENT_SESSION_RECORD_FILE_NAMES.copilot)
    await io.write('{"version":1,"folders":[]}')
    expect(await readFile(join(tempDir, 'agent-sessions-copilot.json'), 'utf-8')).toBe(
      '{"version":1,"folders":[]}'
    )
    await expect(readFile(join(tempDir, CLAUDE_FILE), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('書き込みは中身を丸ごと置き換える(追記しない)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-sessions-'))
    const io = createAgentSessionRecordFileIo(tempDir, CLAUDE_FILE)
    await io.write('{"version":1,"folders":[{"key":"/a","ids":[]}]}')
    await io.write('{"version":1,"folders":[]}')
    await expect(io.read()).resolves.toBe('{"version":1,"folders":[]}')
  })

  it('作っただけではファイルもディレクトリも作らない(書き込むまで触らない)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-sessions-'))
    const dir = join(tempDir, 'nested')
    createAgentSessionRecordFileIo(dir, CLAUDE_FILE)
    await expect(readFile(join(dir, CLAUDE_FILE), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})

describe('agentSessionRecordStore の依存', () => {
  it('記録の規則のモジュールは fs・path を import しない(ファイルの入出力は注入する)', async () => {
    const source = await readFile(join(__dirname, '..', 'agentSessionRecordStore.ts'), 'utf-8')
    expect(source).not.toMatch(/from 'node:fs/)
    expect(source).not.toMatch(/from 'node:path/)
    expect(source).not.toMatch(/from 'electron'/)
  })
})
```

`src/main/__tests__/ipcHandlers.test.ts`:

- `mockAgentSessionRecords`・`mockAgentSessionRecordIo` の 2 つの定数を消し、記録の store と入出力の偽物と `vi.mock` を次にする:

  ```ts
  // 記録の store と入出力の偽物。種類ごとに作られた値を見分けられるよう、受け取った値を持たせる
  const mockCreateAgentSessionRecordStore = vi.hoisted(() =>
    vi.fn((io: unknown) => ({ marker: 'records', io }))
  )
  const mockCreateAgentSessionRecordFileIo = vi.hoisted(() =>
    vi.fn((_userDataDir: string, fileName: string) => ({ marker: 'record-io', fileName }))
  )
  vi.mock('../agentSessionRecordStore', () => ({
    createAgentSessionRecordStore: mockCreateAgentSessionRecordStore
  }))
  // ファイル名の表(AGENT_SESSION_RECORD_FILE_NAMES)は本物を使う
  vi.mock('../agentSessionRecordFileIo', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../agentSessionRecordFileIo')>()),
    createAgentSessionRecordFileIo: mockCreateAgentSessionRecordFileIo
  }))
  ```

- starter の依存を確かめるテストの、記録の 4 行（`// 起動の記録は userData の agent-sessions.json…` から `expect(starterDeps.records).toBe(mockAgentSessionRecords)` まで）を次にする:

  ```ts
  // 起動の記録は種類ごとに userData の別のファイル(claude は今の agent-sessions.json)。読み込みは組み立ての時点で一度だけ始める
  expect(mockCreateAgentSessionRecordFileIo.mock.calls).toEqual([
    ['/mock/userData', 'agent-sessions.json'],
    ['/mock/userData', 'agent-sessions-copilot.json']
  ])
  expect(mockCreateAgentSessionRecordStore).toHaveBeenCalledTimes(2)
  expect(starterDeps.records).toEqual({
    claude: { marker: 'records', io: { marker: 'record-io', fileName: 'agent-sessions.json' } },
    copilot: {
      marker: 'records',
      io: { marker: 'record-io', fileName: 'agent-sessions-copilot.json' }
    }
  })
  ```

`src/main/__tests__/agentSessionStarter.test.ts`:

- `let records: AgentSessionRecordStore` の次に `let copilotRecords: AgentSessionRecordStore` を足し、`beforeEach` の `records = createAgentSessionRecordStore(makeFakeRecordIo())` の次に `copilotRecords = createAgentSessionRecordStore(makeFakeRecordIo())` を足す
- `makeStarterService` の `records,` を `records: { claude: records, copilot: copilotRecords },` にする
- 「起動が確定したら、記録の失敗でも started を返す」の `service({ records: { … } })` を、今の 4 つの関数のオブジェクトを `claude:` に入れた `records: { claude: { …今のまま… }, copilot: copilotRecords }` にする
- `describe('createAgentSessionStarter(hooks)')` の `recordsWithWhenLoaded` を次にする:

  ```ts
  /** claude の記録の whenLoaded だけを差し替えた記録の表(ほかは本物の records・copilotRecords に任せる) */
  const recordsWithWhenLoaded = (
    whenLoaded: () => Promise<void>
  ): AgentSessionStarterDeps['records'] => ({
    claude: {
      whenLoaded,
      has: (key, id) => records.has(key, id),
      last: (key) => records.last(key),
      record: (key, id) => records.record(key, id)
    },
    copilot: copilotRecords
  })
  ```

- `it.each` の `'records.whenLoaded() の reject'` の上書きを次にする（`it.each` の値は describe を作る時点で評価されるので、`copilotRecords` を参照しない）:

  ```ts
      [
        'records.whenLoaded() の reject',
        {
          records: {
            claude: {
              whenLoaded: async () => Promise.reject(new Error('load failed')),
              has: () => false,
              last: () => null,
              record: () => undefined
            },
            copilot: {
              whenLoaded: async () => undefined,
              has: () => false,
              last: () => null,
              record: () => undefined
            }
          }
        }
      ],
  ```

- `describe('createAgentSessionStarter: lastSessionOf(前回)')` の中に足す:

  ```ts
  it('依頼の種類の記録の先頭を種類付きで返す(copilot の記録は copilot の依頼にだけ返す)', async () => {
    const OTHER = '22222222-2222-4222-9222-222222222222'
    await records.whenLoaded()
    await copilotRecords.whenLoaded()
    records.record('/work', ID)
    copilotRecords.record('/work', OTHER)
    const { lastSessionOf } = makeStarterService()
    await expect(lastSessionOf(1, '/work', 'claude')).resolves.toEqual({
      cliKind: 'claude',
      claudeSessionId: ID
    })
    await expect(lastSessionOf(1, '/work', 'copilot')).resolves.toEqual({
      cliKind: 'copilot',
      claudeSessionId: OTHER
    })
  })

  it('ほかの種類の記録にだけある ID は返さない(copilot の依頼で claude の記録を見ない)', async () => {
    await records.whenLoaded()
    records.record('/work', ID)
    await expect(makeStarterService().lastSessionOf(1, '/work', 'copilot')).resolves.toBeNull()
  })
  ```

- ファイルの末尾に足す:

  ```ts
  describe('createAgentSessionStarter(種類ごとの起動の記録と種類の照らし合わせ)', () => {
    const ID = '11111111-1111-4111-8111-111111111111'

    beforeEach(async () => {
      await records.whenLoaded()
      await copilotRecords.whenLoaded()
    })

    it('resume の依頼の種類が起動の計画の種類と違えば resume-cli-mismatch で断り、hooks の準備・記録の読み込み・spawn をしない(L-018)', async () => {
      records.record('/work', ID)
      const claudeWhenLoaded = vi.fn(() => records.whenLoaded())
      const copilotWhenLoaded = vi.fn(() => copilotRecords.whenLoaded())
      const start = makeStarter({
        records: {
          claude: {
            whenLoaded: claudeWhenLoaded,
            has: (key, id) => records.has(key, id),
            last: (key) => records.last(key),
            record: (key, id) => records.record(key, id)
          },
          copilot: {
            whenLoaded: copilotWhenLoaded,
            has: (key, id) => copilotRecords.has(key, id),
            last: (key) => copilotRecords.last(key),
            record: (key, id) => copilotRecords.record(key, id)
          }
        }
      })
      await expect(
        start(
          1,
          { ...REQUEST, launch: { kind: 'resume', claudeSessionId: ID, cliKind: 'copilot' } },
          makeSink()
        )
      ).resolves.toEqual({ kind: 'error', error: 'resume-cli-mismatch' })
      expect(hooks.prepare).not.toHaveBeenCalled()
      expect(claudeWhenLoaded).not.toHaveBeenCalled()
      expect(copilotWhenLoaded).not.toHaveBeenCalled()
      expect(spawnPty).not.toHaveBeenCalled()
      expect(registry.snapshot(1)).toEqual([])
    })

    it('resume の依頼の種類が計画の種類と同じなら起動する(照らし合わせは依頼の種類で起動の種類を変えない)', async () => {
      records.record('/work', ID)
      await expect(
        makeStarter()(
          1,
          { ...REQUEST, launch: { kind: 'resume', claudeSessionId: ID, cliKind: 'claude' } },
          makeSink()
        )
      ).resolves.toEqual({
        kind: 'started',
        sessionId: 'sid-1',
        cliKind: 'claude',
        claudeSessionId: ID
      })
      expect(spawnPty).toHaveBeenCalledWith(
        '/bin/claude',
        ['--x', '--resume', ID],
        expect.any(Object)
      )
    })

    it('claude の起動は claude の記録だけに書き、copilot の記録に触れない', async () => {
      const copilotRecordSpy = vi.spyOn(copilotRecords, 'record')
      const copilotHasSpy = vi.spyOn(copilotRecords, 'has')
      await expect(makeStarter()(1, REQUEST, makeSink())).resolves.toMatchObject({
        kind: 'started',
        claudeSessionId: NEW_IDS[0]
      })
      expect(records.last('/work')).toBe(NEW_IDS[0])
      expect(copilotRecords.last('/work')).toBeNull()
      expect(copilotRecordSpy).not.toHaveBeenCalled()
      expect(copilotHasSpy).not.toHaveBeenCalled()
    })

    it.each<[string, () => Promise<string>]>([
      ['読み込みが終わらない', () => new Promise<string>(() => undefined)],
      [
        '読み込みが失敗する',
        async () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
      ]
    ])(
      'copilot の記録の%sときも、claude の起動と記録は今と同じ(別のファイル・別の store。L-002・L-006)',
      async (_label, read) => {
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        copilotRecords = createAgentSessionRecordStore({
          read: vi.fn(read),
          write: vi.fn(async () => undefined)
        })
        await expect(makeStarter()(1, REQUEST, makeSink())).resolves.toEqual({
          kind: 'started',
          sessionId: 'sid-1',
          cliKind: 'claude',
          claudeSessionId: NEW_IDS[0]
        })
        expect(records.last('/work')).toBe(NEW_IDS[0])
      }
    )
  })
  ```

`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`:

- `let records: AgentSessionRecordStore` の次に `let copilotRecords: AgentSessionRecordStore` を足し、`beforeEach` の `records = …` の次に `copilotRecords = createAgentSessionRecordStore(makeFakeRecordIo())` を足す。`register` の `records,` を `records: { claude: records, copilot: copilotRecords },` にする
- `describe('agentTerminal:getLastSession')` の中に足す:

  ```ts
  it('依頼の種類の記録の先頭を種類付きで返す(copilot の依頼に claude の記録を返さない)', async () => {
    register()
    folderAccess.set(1, '/work')
    await records.whenLoaded()
    await copilotRecords.whenLoaded()
    records.record('/work', CLAUDE_ID)
    await expect(getLast(makeEvent(), '/work', 'copilot')).resolves.toBeNull()
    copilotRecords.record('/work', '22222222-2222-4222-9222-222222222222')
    await expect(getLast(makeEvent(), '/work', 'copilot')).resolves.toEqual({
      cliKind: 'copilot',
      claudeSessionId: '22222222-2222-4222-9222-222222222222'
    })
  })

  it.each<[string, unknown]>([
    ['無い', undefined],
    ['知らない値', 'gemini'],
    ['大文字', 'Claude'],
    ['文字列でない', 1]
  ])('種類が%sなら投げる(既定の claude に流さない。L-044)', async (_label, cliKind) => {
    register()
    folderAccess.set(1, '/work')
    await expect(
      handles.get('agentTerminal:getLastSession')?.(
        makeEvent(),
        '/work',
        cliKind
      ) as Promise<unknown>
    ).rejects.toThrow()
  })
  ```

`src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts`:

- `describe('parseAgentLaunchRequest')` の最初の `it` の中に足す:

  ```ts
  expect(
    parseAgentLaunchRequest({ kind: 'resume', claudeSessionId: ID, cliKind: 'copilot' })
  ).toEqual({ kind: 'resume', claudeSessionId: ID, cliKind: 'copilot' })
  ```

- 同じ describe の投げる `it.each` の表の末尾に足す:

  ```ts
  ;(['resume の cliKind が無い', { kind: 'resume', claudeSessionId: ID }],
    ['resume の cliKind が知らない値', { kind: 'resume', claudeSessionId: ID, cliKind: 'gemini' }],
    ['resume の cliKind が大文字', { kind: 'resume', claudeSessionId: ID, cliKind: 'Claude' }],
    ['resume の cliKind が文字列でない', { kind: 'resume', claudeSessionId: ID, cliKind: 1 }])
  ```

- ファイルの末尾に足す:

  ```ts
  describe('parseAgentCliKind', () => {
    it('claude・copilot はその値を返す', () => {
      expect(parseAgentCliKind('claude')).toBe('claude')
      expect(parseAgentCliKind('copilot')).toBe('copilot')
    })

    it.each<[string, unknown]>([
      ['無い', undefined],
      ['null', null],
      ['知らない値', 'gemini'],
      ['大文字', 'Copilot'],
      ['文字列でない', 1]
    ])('%s なら投げる(既定の claude に流さない。L-044)', (_label, value) => {
      expect(() => parseAgentCliKind(value)).toThrow()
    })
  })
  ```

`src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts` の `describe('useAgentLastSession')` の中に足す:

```ts
it('取りに行く種類(設定の種類)を依頼に載せ、種類が変わったら取り直す', async () => {
  mockGetLast.mockResolvedValueOnce({ cliKind: 'claude', claudeSessionId: A })
  const { result, rerender } = renderLast({
    folderPath: '/w',
    cliKind: 'claude',
    enabled: true,
    refreshKey: ''
  })
  await waitFor(() =>
    expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: A })
  )
  mockGetLast.mockResolvedValueOnce({ cliKind: 'copilot', claudeSessionId: B })
  rerender({ folderPath: '/w', cliKind: 'copilot', enabled: true, refreshKey: '' })
  expect(mockGetLast).toHaveBeenLastCalledWith('/w', 'copilot')
  await waitFor(() =>
    expect(result.current).toEqual({ kind: 'found', cliKind: 'copilot', claudeSessionId: B })
  )
})
```

`src/renderer/src/hooks/__tests__/useAgentResume.test.ts`:

- `legacyEntry` の次に足す:

  ```ts
  /** 送り先の種類を cliKind にしたエージェントのエントリ */
  const agentEntryOf = (cliKind: string, claudeSessionId = ID): HistoryEntry => {
    const entry = agentEntry(claudeSessionId)
    return { ...entry, agent: entry.agent === null ? null : { ...entry.agent, cliKind } }
  }
  ```

- `describe('前回の続きから')` の中に足す:

  ```ts
  it('useAgentLastSession に設定の種類を渡し、押すと「前回」の種類を再開の依頼に載せる', () => {
    mockUseAgentLastSession.mockReturnValue({
      kind: 'found',
      cliKind: 'claude',
      claudeSessionId: ID
    })
    const sessions = makeAgentSessionsState()
    const { result } = renderResume({ sessions })
    expect(mockUseAgentLastSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ cliKind: 'claude' })
    )
    act(() => result.current.resumeLast.onResume('slot-1'))
    expect(sessions.start).toHaveBeenCalledWith('slot-1', {
      kind: 'resume',
      claudeSessionId: ID,
      cliKind: 'claude'
    })
  })
  ```

- `describe('このセッションで再開')` の中に足す:

  ```ts
  it('知らない種類のエントリは、押されても新しいタブを足さない(この版で起動できる種類が無い)', () => {
    const sessions = makeAgentSessionsState({ resumeInNewTab: vi.fn(() => 'slot-new') })
    const { result, options } = renderResume({ sessions })
    act(() => result.current.onResumeEntry(agentEntryOf('gemini')))
    expect(sessions.resumeInNewTab).not.toHaveBeenCalled()
    expect(options.activateTab).not.toHaveBeenCalled()
  })
  ```

`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts` の「resumeInNewTab はタブを足して選択し…」の次に足す:

```ts
it('resumeInNewTab は渡された種類を再開の依頼に載せる', () => {
  mockStart.mockReturnValueOnce(new Promise<AgentStartResult>(() => undefined))
  const { result } = render()
  act(() => {
    result.current.resumeInNewTab(CSID, 'copilot')
  })
  expect(mockStart).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ slotId: 'slot-2', launch: resumeOf(CSID, 'copilot') })
  )
})
```

`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts` の `describe('起動の失敗の文言(CLI の種類・再開の拒否)')` の中に足す（import に `AGENT_RESUME_CLI_MISMATCH` を足す）:

```ts
it('resume-cli-mismatch は、設定が変わった旨を CLI の名前を含めずに出す', () => {
  expect(AGENT_RESUME_CLI_MISMATCH).toBe(
    '使うエージェント CLI の設定が変わったため、再開しませんでした（設定を確かめてから、もう一度押してください）'
  )
  expect(describeAgentStartError({ kind: 'error', error: 'resume-cli-mismatch' })).toBe(
    AGENT_RESUME_CLI_MISMATCH
  )
})
```

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentSessionRecordFileIo.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts src/renderer/src/hooks/__tests__/useAgentResume.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`
Expected: FAIL。記録の入出力（表が無い）、`ipcHandlers`（store が 1 つ）、starter（`records` が表でない・`resume-cli-mismatch` が無い・「前回」に種類が無い）、IPC の受け口（種類を見ない）、入力の検証（`cliKind` を検証しない・`parseAgentCliKind` が無い）、`useAgentLastSession`（種類を依頼に載せない）、`useAgentResume`（依頼に種類が無い）、`useAgentSessions`（`resumeInNewTab` が種類を載せない）、文言（`AGENT_RESUME_CLI_MISMATCH` が無い）が落ちる

- [ ] **Step 4: 共有の型を直す**

`src/shared/types/agentTerminal.ts`:

- `CLAUDE_SESSION_ID_PATTERN` のコメントを次にする（値は変えない）:

  ```ts
  /** エージェント CLI(claude・copilot)の会話の ID の形式(小文字の UUID v4 の厳密な形式)。main は新しい ID を crypto.randomUUID() で作り、
   *  再開の依頼の ID もこの形式で検証する(`-` 始まりの値が CLI のオプションとして解釈される経路を断つ。L-034) */
  ```

- `isClaudeSessionId` のコメントを `/** エージェント CLI の会話の ID の形式に当たる文字列か */` にする
- `AgentTerminalErrorKind` の `'session-in-use'` のコメントを `/** 同じ ID のエージェント CLI がほかのタブかウィンドウで起動中・実行中・止まりきる前 */` にし、末尾に足す:

  ```ts
    /** 再開の依頼の種類が、main が起動のたびに読んだ設定の種類と違う(別のウィンドウで設定を変えた。起動しない) */
    | 'resume-cli-mismatch'
  ```

- `AgentLaunchRequest` を次にする:

  ```ts
  /** 起動の指定。renderer は列挙型だけを渡し、コマンドと引数の並び(--session-id / --resume)は main が決める(L-019)。
   *  resume の cliKind は押した時点の設定の種類で、main は読んだ設定の種類との照らし合わせにだけ使う(起動の種類は main の値。L-018)。
   *  省略させない(L-060) */
  export type AgentLaunchRequest =
    | { kind: 'new' }
    | { kind: 'resume'; claudeSessionId: string; cliKind: AgentCliKind }
  ```

- `AgentStartRequest.launch` のコメントを `/** 新しく起動するか、起動の記録にあるセッションを再開するか(省略できない。既定の new に流さない。L-044) */` にする
- `AgentStartResult` の `claudeSessionId` のコメントを `/** エージェント CLI の会話の ID(claude・copilot)。sessionResume が true の種類では必ず文字列、false の種類では null。already-running は動いているセッションの ID(依頼の launch は使わない) */` にする
- `AgentSessionSnapshotEntry.claudeSessionId` のコメントを `/** そのセッションのエージェント CLI の会話の ID。再開に対応しない種類では null */` にする
- `AgentLastSession` を次にする:

  ```ts
  /** このフォルダで最後に起動が確定した、依頼した種類のセッション(「前回の続きから」の再開の相手) */
  export interface AgentLastSession {
    /** 依頼した種類(renderer は依頼と違う種類の結果を捨てる。L-037) */
    cliKind: AgentCliKind
    claudeSessionId: string
  }
  ```

- [ ] **Step 5: main を直す（記録のファイル・store の組み立て・starter・入力の検証・受け口）**

`src/main/agentSessionRecordFileIo.ts` の全体を次にする:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentSessionRecordIo } from './agentSessionRecordStore'

// エージェント CLI のセッションの起動の記録のファイルの入出力(agentSessionRecordStore に注入する実物)。記録の規則は agentSessionRecordStore.ts。
// 種類ごとに別のファイルにする(古い版のアプリは claude のファイルだけを読み書きし、copilot の記録を消さない。設計書 2026-10-23「起動の記録」。L-459)

/** 種類ごとの起動の記録のファイル名(userData の下)。claude は段階 3a より前と同じファイル(形も中身も変えない) */
export const AGENT_SESSION_RECORD_FILE_NAMES: Record<AgentCliKind, string> = {
  claude: 'agent-sessions.json',
  copilot: 'agent-sessions-copilot.json'
}

/** userData の fileName を読み書きする(ディレクトリが無ければ作る) */
export function createAgentSessionRecordFileIo(
  userDataDir: string,
  fileName: string
): AgentSessionRecordIo {
  const filePath = join(userDataDir, fileName)
  return {
    read: () => readFile(filePath, 'utf-8'),
    write: async (content) => {
      await mkdir(userDataDir, { recursive: true })
      await writeFile(filePath, content, 'utf-8')
    }
  }
}
```

`src/main/agentSessionRecordStore.ts` の冒頭のコメントの 1 行目を次にする（2 行目以降と規則は変えない）:

```ts
// フォルダごとのエージェント CLI のセッションの起動の記録(種類ごとに 1 つ作る。ファイルも種類ごと〈agentSessionRecordFileIo.ts〉。
// 設計書「記録の置き場」「記録の中身」、段階 3a の設計書「起動の記録」)。main が振った ID の一覧を新しい順に持ち、
```

（続く行の先頭の「先頭が「前回」。」は、前の行の末尾に続く形のまま残す。冒頭の段落が日本語の文として続くことを読み直して確かめる）

`src/main/ipcHandlers.ts`:

- import を直す（`createAgentSessionRecordFileIo` の行を置き換え、型を足す）:

  ```ts
  import type { AgentCliKind } from '@shared/agentCliKinds'
  import type { AgentSessionRecordStore } from './agentSessionRecordStore'
  import {
    AGENT_SESSION_RECORD_FILE_NAMES,
    createAgentSessionRecordFileIo
  } from './agentSessionRecordFileIo'
  ```

- `const agentSessionRecords = createAgentSessionRecordStore(…)` の 4 行（直前のコメントを含む）を次にする:

  ```ts
  // エージェント CLI のセッションの起動の記録(種類ごとに userData の別のファイル。claude は agent-sessions.json)。読み込みはここで
  // 一度だけ始める。種類を足したときに記録の決め忘れを型エラーにするため、種類をキーにしたオブジェクトで作る(L-060)
  const userDataDir = app.getPath('userData')
  const recordStoreOf = (kind: AgentCliKind): AgentSessionRecordStore =>
    createAgentSessionRecordStore(
      createAgentSessionRecordFileIo(userDataDir, AGENT_SESSION_RECORD_FILE_NAMES[kind])
    )
  const agentSessionRecords: Record<AgentCliKind, AgentSessionRecordStore> = {
    claude: recordStoreOf('claude'),
    copilot: recordStoreOf('copilot')
  }
  ```

  （`createAgentSessionStarter` に渡す `records: agentSessionRecords,` は今のまま）

`src/main/agentSessionStarter.ts`:

- 冒頭のコメントの「記録の規則は agentSessionRecordStore.ts」を「記録の規則は agentSessionRecordStore.ts(種類ごとに 1 つ。起動の計画の種類の記録だけを使う)」にする
- `AgentSessionStarterDeps.records` を次にする:

  ```ts
  /** 種類ごとの、フォルダごとのエージェント CLI のセッションの起動の記録(再開の照合・起動が確定したときの記録・「前回」)。起動の計画の
   *  種類(main が読んだ設定)の記録だけを使う。種類をキーにした表で、種類を足したときの渡し忘れを型エラーにする(L-060) */
  records: Readonly<
    Record<AgentCliKind, Pick<AgentSessionRecordStore, 'whenLoaded' | 'has' | 'last' | 'record'>>
  >
  ```

- `reservations` のコメントを `/** 全ウィンドウで共有する会話の ID の予約(種類をまたいで 1 つ。ID は main が振る UUID なので種類をまたいで重ならない) */` にする
- `AgentSessionStarterService.lastSessionOf` を次にする:

  ```ts
    /**
     * 「前回」の取得(agentTerminal:getLastSession)。folderPath を正規化して許可のフォルダと一致するときだけ、cliKind の記録の先頭を
     * 種類付きで返す。一致しない・記録が無ければ null
     */
    lastSessionOf(ownerId: number, folderPath: string, cliKind: AgentCliKind): Promise<AgentLastSession | null>
  ```

- `createSession` の `resume-unsupported` の `if` の直後に足す:

  ```ts
  // 再開の依頼の種類が、起動のたびに読んだ設定の種類と違えば起動しない(別のウィンドウで設定を変えた。起動の種類は依頼の値で変えず、
  // main の値を使う。L-018)。hooks を準備する前に断る
  if (request.launch.kind === 'resume' && request.launch.cliKind !== launch.plan.cliKind) {
    return { kind: 'failed', result: { kind: 'error', error: 'resume-cli-mismatch' } }
  }
  ```

- `createSession` の `await records.whenLoaded()` を `await records[launch.plan.cliKind].whenLoaded()` にし、直前のコメントを `// 再開の照合は下の同期の区間で行うため、起動の計画の種類の記録の読み込みの完了をここで待つ(ほかの種類の記録は待たない。L-002)` にする
- `spawnSession` の `selectClaudeSessionId(request.launch, folderKey, records, createClaudeSessionId)` の `records` を `records[plan.cliKind]` にする
- `recordStarted` の `records.record(folderKey, claudeSessionId)` を `records[cliKind].record(folderKey, claudeSessionId)` にし、関数のコメントの最後の文を `対応しない種類は ID を持たず、記録しない(前回の続きからに出さない)。記録は起動した種類の記録だけに書く` にする
- `lastSessionOf` を次にする:

  ```ts
  async function lastSessionOf(
    ownerId: number,
    folderPath: string,
    cliKind: AgentCliKind
  ): Promise<AgentLastSession | null> {
    const match = await matchAllowedFolder(ownerId, folderPath)
    if (match.kind !== 'matched') return null
    const { allowedFolder } = match
    const kindRecords = records[cliKind]
    await kindRecords.whenLoaded()
    // await の間にフォルダが切り替わっていたら、切り替え前のフォルダの記録を返さない
    if (folderAccess.get(ownerId) !== allowedFolder) return null
    const claudeSessionId = kindRecords.last(toAgentFolderKey(allowedFolder, platform))
    return claudeSessionId === null ? null : { cliKind, claudeSessionId }
  }
  ```

`src/main/handlers/agentTerminalPayloadParser.ts`:

- import に足す:

  ```ts
  import { AGENT_CLI_KINDS, isAgentCliKind } from '@shared/agentCliKinds'
  import type { AgentCliKind } from '@shared/agentCliKinds'
  ```

- `parseAgentFolderPath` の次に足す:

  ```ts
  /** エージェント CLI の種類(再開の依頼・「前回」の取得)。無い・知らない値は投げる(既定の claude に流さない。L-044) */
  export function parseAgentCliKind(value: unknown): AgentCliKind {
    if (!isAgentCliKind(value)) {
      throw new Error(`cliKind は ${AGENT_CLI_KINDS.join('・')} のどれかである必要があります`)
    }
    return value
  }
  ```

- `parseAgentLaunchRequest` のコメントの 1 行目を `起動の指定(新しく起動・記録した ID で再開)。無い・未知の kind・余分なキー・ID が小文字の UUID v4 でないもの・resume の種類が無い・知らない値は投げる` にし、`resume` の分岐を次にする:

  ```ts
  if (launch.kind === 'resume') {
    if (!hasOnlyKeys(launch, ['kind', 'claudeSessionId', 'cliKind'])) {
      throw new Error('launch に余分なキーがあります')
    }
    if (!isClaudeSessionId(launch.claudeSessionId)) {
      throw new Error('claudeSessionId は小文字の UUID v4 である必要があります')
    }
    return {
      kind: 'resume',
      claudeSessionId: launch.claudeSessionId,
      cliKind: parseAgentCliKind(launch.cliKind)
    }
  }
  ```

`src/main/handlers/agentTerminalHandlers.ts`:

- import の `parseAgentFolderPath,` の前に `parseAgentCliKind,` を足す
- 冒頭のコメントの「起動の指定(新規・再開の列挙型)」を「起動の指定(新規・再開の列挙型と種類)・「前回」の種類」にする
- `agentTerminal:getLastSession` の受け口を次にする:

  ```ts
  ipcMain.handle(
    'agentTerminal:getLastSession',
    async (
      event: IpcMainInvokeEvent,
      folderPath: unknown,
      cliKind: unknown
    ): Promise<AgentLastSession | null> => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      return getLastSession(
        event.sender.id,
        parseAgentFolderPath(folderPath),
        parseAgentCliKind(cliKind)
      )
    }
  )
  ```

- [ ] **Step 6: preload と renderer を直す（依頼の種類・「前回」の種類・文言）**

`src/preload/api.ts` の `getLastAgentSession` を次にする（`AgentCliKind` の import が既にあることを確かめる）:

```ts
  // このフォルダで最後に起動が確定した、cliKind の種類のセッション(前回の続きから)。照合は main が許可のフォルダと種類の記録で行う
  getLastAgentSession: (folderPath: string, cliKind: AgentCliKind): Promise<AgentLastSession | null> =>
    ipcRenderer.invoke('agentTerminal:getLastSession', folderPath, cliKind),
```

`src/preload/index.d.ts` の `getLastAgentSession(folderPath: string): Promise<AgentLastSession | null>` を `getLastAgentSession(folderPath: string, cliKind: AgentCliKind): Promise<AgentLastSession | null>` にする（`AgentCliKind` の import が無ければ、ほかの共有の型と同じ import に足す）。

`src/renderer/src/lib/agentTerminalApi.ts`:

```ts
import type { AgentCliKind } from '@shared/agentCliKinds'
// …
/** このフォルダで最後に起動が確定した、cliKind の種類のセッション(前回の続きから)。照合は main が行う */
export function getLastAgentSession(
  folderPath: string,
  cliKind: AgentCliKind
): Promise<AgentLastSession | null> {
  return window.api.getLastAgentSession(folderPath, cliKind)
}
```

`src/renderer/src/lib/agentResumeAvailability.ts` の `AgentLastSessionLookup` の `found` を `| { kind: 'found'; cliKind: AgentCliKind; claudeSessionId: string }` にし、コメントを `/** 「前回」の取得の結果(useAgentLastSession)。found の cliKind は取りに行った種類 */` にする。

`src/renderer/src/hooks/useAgentLastSession.ts`:

- import に `import type { AgentCliKind } from '@shared/agentCliKinds'` を足す
- 冒頭のコメントの「このフォルダで最後に起動が確定した claude のセッション」を「このフォルダで最後に起動が確定した、設定の種類のセッション」にする
- `UseAgentLastSessionOptions` に足す（`folderPath` の次）:

  ```ts
  /** 取りに行く種類(設定の種類。次に起動する CLI)。省略できない(L-060)。変わったら取り直す */
  cliKind: AgentCliKind
  ```

- 関数の引数の分割に `cliKind,` を足し、effect を次にする:

  ```ts
  useEffect(() => {
    if (!enabled || folderPath === null) return
    const requestId = ++requestIdRef.current
    let cancelled = false
    void agentTerminalApi
      .getLastAgentSession(folderPath, cliKind)
      .then(
        (last): AgentLastSessionLookup =>
          last === null
            ? NONE
            : { kind: 'found', cliKind: last.cliKind, claudeSessionId: last.claudeSessionId }
      )
      .catch((err: unknown): AgentLastSessionLookup => {
        // 取得の失敗は記録なしとして扱う(前回の続きから は押せない)
        console.error('[useAgentLastSession] getLastAgentSession failed:', err)
        return NONE
      })
      .then((lookup) => {
        // 依頼の後にフォルダ・種類・契機が変わった(effect の後始末)・より新しい依頼がある結果は捨てる
        if (cancelled || requestId !== requestIdRef.current) return
        setResolved({ folderPath, lookup })
      })
    return () => {
      cancelled = true
    }
    // refreshKey は取り直しの契機としてだけ使う
  }, [enabled, folderPath, cliKind, refreshKey])
  ```

`src/renderer/src/hooks/useAgentResume.ts`:

- import に `import { knownAgentCliKindOf } from '@shared/historyAgentCliKind'` を足す
- `useAgentLastSession({ … })` の引数に `cliKind: appCliKind,` を足す（`folderPath` の次）
- `resumeLast` の `launch` を次にする:

  ```ts
  const launch: AgentLaunchRequest = {
    kind: 'resume',
    claudeSessionId: current.claudeSessionId,
    cliKind: current.cliKind
  }
  ```

- `onResumeEntry` を次にする:

  ```ts
  const onResumeEntry = (entry: HistoryEntry): void => {
    if (entry.agent === null) return
    // 押した時点の条件で求め直し、押せないときは何もしない(ボタンは押せないが、処理の側でも同じ条件で守る。L-058)
    if (resumeEntryReasonOf(entry.agent) !== null) return
    // 送り先の種類をこの版の種類として読む。知らない種類(新しい版の種類)は起動できる種類が無いので何もしない(押せない理由は
    // agentResumeAvailability.ts が出す)。知っている種類はそのまま渡し、設定と違えば main が resume-cli-mismatch で断る
    const entryCliKind = knownAgentCliKindOf(entry.agent)
    if (entryCliKind === null) return
    const slotId = sessions.resumeInNewTab(entry.agent.claudeSessionId, entryCliKind)
    // タブを足せなかった(押してから条件が変わった)ら何もしない。起動の失敗は足したタブのエラーとして出る
    if (slotId !== null) activateTab(slotId)
  }
  ```

`src/renderer/src/hooks/useAgentSessions.ts`:

- `AgentSessionsState.resumeInNewTab` を次にする:

  ```ts
  /** 新しいタブを足して選択し、そのタブで claudeSessionId を再開する(+ と同じ検査の後。同じ ID のタブが起動中・実行中なら
   *  何もしない)。cliKind は再開するセッションの種類(押せる理由を通った後は設定の種類と同じ。違えば main が resume-cli-mismatch
   *  で断る)。足したタブの slotId、足さなかったら null。起動の完了は待たない(失敗は足したタブのエラーとして出す) */
  resumeInNewTab: (claudeSessionId: string, cliKind: AgentCliKind) => string | null
  ```

- `resumeInNewTab` の実装の引数と依頼を次にする:

  ```ts
  const resumeInNewTab = useCallback(
    (claudeSessionId: string, cliKind: AgentCliKind): string | null => {
      // + と同じ検査(フォルダ無し・起動を受け付けない間・上限)。押してから条件が変わったら何もしない
      if (addDisabledReason !== null) return null
      if (isClaudeSessionIdActiveElsewhere(claudeSessionId, null)) return null
      const tab = tabs.add()
      if (tab === null) return null
      // start は拒否しない(失敗は足したタブのエラーとして出す)
      void start(tab.slotId, { kind: 'resume', claudeSessionId, cliKind })
      return tab.slotId
    },
    [addDisabledReason, isClaudeSessionIdActiveElsewhere, tabs, start]
  )
  ```

`src/renderer/src/lib/agentSessionMessages.ts`:

- `AGENT_RESUME_UNSUPPORTED` の次に足す:

  ```ts
  /** 再開の依頼の種類が main の読んだ設定の種類と違った(main が resume-cli-mismatch で拒んだ。別のウィンドウで設定を変えたとき) */
  export const AGENT_RESUME_CLI_MISMATCH =
    '使うエージェント CLI の設定が変わったため、再開しませんでした（設定を確かめてから、もう一度押してください）'
  ```

- `describeAgentStartError` の `case 'resume-unsupported':` の次に足す:

  ```ts
      case 'resume-cli-mismatch':
        return AGENT_RESUME_CLI_MISMATCH
  ```

- [ ] **Step 7: テストと型検査が通ることを確かめる**

Run: `npx vitest run src/main src/preload src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts src/renderer/src/hooks/__tests__/useAgentResume.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`
Expected: PASS（`agentCliLaunch.integration.test.ts` も含まれる。偽の `copilot` を実物の pty で起動するので数秒かかる）
Run: `npm run typecheck`
Expected: PASS。落ちたら、型に追随していない呼び出し元（`AgentLaunchRequest` の `resume` を作る箇所・`lastSessionOf`・`getLastAgentSession`・`resumeInNewTab`・`records`）を `grep -rn` で探して直す

- [ ] **Step 8: 実装を外すとテストが落ちることを確かめる（手で外して手で戻す）**

1. `agentSessionStarter.ts` の `resume-cli-mismatch` の `if` を丸ごと消す → `npx vitest run src/main/__tests__/agentSessionStarter.test.ts` で「resume の依頼の種類が起動の計画の種類と違えば resume-cli-mismatch で断り…」が落ちる → 手で戻す
2. `createSession` の `records[launch.plan.cliKind].whenLoaded()` を `Promise.all([records.claude.whenLoaded(), records.copilot.whenLoaded()])` に書き換える → 同じテストで「copilot の記録の読み込みが終わらないときも…」が時間切れで落ちる → 手で戻す
3. `lastSessionOf` の `records[cliKind]` を `records.claude` に書き換える → 同じテストの「依頼の種類の記録の先頭を種類付きで返す」「ほかの種類の記録にだけある ID は返さない」が落ちる → 手で戻す
4. `parseAgentLaunchRequest` の `cliKind: parseAgentCliKind(launch.cliKind)` を `cliKind: 'claude'` に書き換える → `npx vitest run src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts` で copilot の再開の依頼と `cliKind` の不正な値の 4 件が落ちる → 手で戻す

戻したことを `git diff src/main/agentSessionStarter.ts src/main/handlers/agentTerminalPayloadParser.ts` で確かめ（Step 5 の差分だけが出る）、Step 7 のテストを流し直して PASS を確かめる。

- [ ] **Step 9: 全体の検証**

```bash
cd <repo-root>
npm run typecheck
set -- $(git status --porcelain | grep -v '^ D' | awk '{print $NF}' | grep -E '\.(ts|tsx)$')
echo "$#" "$@"
npx prettier --write "$@"
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
npx vitest run
```

Expected: `echo` が Task 1・2 で変えた TypeScript のファイルを並べる。どれも PASS（`npx vitest run` の時間切れは Global Constraints のとおり単体で流し直す）

- [ ] **Step 10: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 3: copilot の再開の有効化（引数・環境変数・能力の表）

> **設計書の読む節:** 「copilot の再開（記録の要点）」、「起動の引数と環境変数（`agentCliLaunchSpecs.ts`）」（引数・環境変数・`-C` ではなく環境変数にした理由）、「起動の流れ」の 3〜5 と最後の段落、「履歴への CLI の種類」の `recordAgentSent` の箇条書き、「実装の分割」の 3（前提を失う既存のテストの一覧・テストの補助・統合テスト）、「テスト方針」の `agentCliKinds.test.ts`・`agentCliLaunchSpecs.test.ts`・`agentCommand.test.ts`・`agentSessionStarter.test.ts`・統合テスト。
>
> **気をつける知見:** L-007（`copilot --resume` は前方一致・名前でも照合するので、完全な小文字の UUID 以外を渡さない）・L-017（起動の表の例外の文言は `spawn-failed` の detail として画面に出るので、渡された値を入れない）・L-034・L-019（ID は入り口の検証と記録の照合に加え、起動の表でも確かめる）・L-044（ID が無い・形が違う値は黙って捨てずに投げる）・L-052（`copilot` の版を確かめる外部プロセスを足さない）・L-059（引数と環境の経路は偽の実行ファイルと実物の node-pty の統合テストで確かめる。実物の `copilot` の挙動の確かめではない）・L-060（起動の表の `extraEnv` は `Record<AgentCliKind, …>` の表の項目、`buildAgentEnv` の `extraEnv` は省略できない引数）・L-018（starter は起動の計画の種類の表の値をそのまま使う）

**Files:**

- Modify: `src/main/agentCliLaunchSpecs.ts`・`src/main/agentCommand.ts`・`src/shared/agentCliKinds.ts`・`src/main/agentSessionStarter.ts`（コメントだけ）・`src/renderer/src/hooks/usePromptRunner.ts`（コメントだけ）
- Modify（テストの補助）: `src/renderer/src/__tests__/agentCliCapabilityOverrides.ts`
- Create: `src/main/__tests__/agentSessionStarter.capabilities.test.ts`
- Test（変更）: `src/main/__tests__/agentCliLaunchSpecs.test.ts`・`src/main/__tests__/agentCommand.test.ts`・`src/main/__tests__/agentCliLaunch.integration.test.ts`・`src/main/__tests__/agentSessionStarter.test.ts`・`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`・`src/shared/__tests__/agentCliKinds.test.ts`・`src/renderer/src/lib/__tests__/agentCliMessages.test.ts`・`src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx`・`src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts`・`src/renderer/src/hooks/__tests__/useAgentResume.test.ts`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`・`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`・`src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts`・`src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`
- Test（差し替えの補助の項目を足すだけ）: `src/renderer/src/hooks/__tests__/useAgentActivity.test.ts`・`src/renderer/src/lib/__tests__/agentInterrupt.test.ts`・`src/renderer/src/lib/__tests__/promptRunAvailability.test.ts`

**Interfaces:**

- Consumes: `AgentLaunchRequest`（Task 2 の `cliKind` 付き）・`records: Record<AgentCliKind, …>`・`lastSessionOf(ownerId, folderPath, cliKind)`（Task 2）、`describeAgentTabSession`（Task 1 の `cliKind` 付き）、`isClaudeSessionId`（既存）
- Produces:

```ts
// src/main/agentCliLaunchSpecs.ts
export interface AgentCliLaunchSpec {
  commandName: string
  extraRemovedEnvKeys: readonly string[]
  /** 取り除く一覧を適用した後に足す環境変数(利用者の環境の同じ名前を上書きする)。名前は大文字で書く */
  extraEnv: Readonly<Record<string, string>>
  buildArgs(
    launch: AgentLaunchRequest,
    claudeSessionId: string | null,
    hookSettingsPath: string | null
  ): string[]
}

// src/main/agentCommand.ts
export function buildAgentEnv(
  base: NodeJS.ProcessEnv,
  pathValue: string,
  platform: NodeJS.Platform,
  extraRemovedKeys: readonly string[],
  extraEnv: Readonly<Record<string, string>>
): Record<string, string>

// src/renderer/src/__tests__/agentCliCapabilityOverrides.ts
export interface AgentCliCapabilityOverrides {
  unsupportedKinds: Set<AgentCliKind>
  promptSendUnsupportedKinds: Set<AgentCliKind>
  /** 会話の再開(sessionResume)を偽にする種類(段階 3a で copilot も再開に対応したため) */
  sessionResumeUnsupportedKinds: Set<AgentCliKind>
}
```

能力の表の `copilot` の `sessionResume` を `true` にする変更と、`buildCopilotArgs` を「ID が `null` なら投げる」に変える変更は、同じタスクに入れる（分けると、その間 `copilot` の `new` がすべて `spawn-failed` になる。設計書の「実装の分割」の冒頭）。このタスクの後、`copilot` のタブは会話の ID を持つので、送り先の控え（`describeAgentTabSession`）が `copilot` のタブでも値を返し、`copilot` へ送ったプロンプトが `cliKind: 'copilot'` で履歴に記録される（`usePromptRunner` のコードは変えない）。

- [ ] **Step 1: テストの補助に「再開を偽にする種類」を足す**

`src/renderer/src/__tests__/agentCliCapabilityOverrides.ts` を次にする:

```ts
import type { AgentCliCapabilities, AgentCliKind } from '@shared/agentCliKinds'

// 能力の表を差し替えて「能力が無い種類」を作るテストの補助(設計書 2026-10-21「段階 1 の『判定しない・押せない』の扱い」、
// 2026-10-22「文言」の agentPromptSendUnsupportedReason、2026-10-23「実装の分割」の 3)。今の表には画面の判定・中断・送信・再開の
// 能力が無い種類が無いため、vi.mock('@shared/agentCliKinds') の factory から使う

/** 差し替える種類(テストが足し、afterEach で消す) */
export interface AgentCliCapabilityOverrides {
  /** 画面の判定(screenActivity)と中断(interrupt)を偽にする種類 */
  unsupportedKinds: Set<AgentCliKind>
  /** プロンプトの送信(promptSend)を偽にする種類(段階 2b で copilot も送信に対応したため、送信に対応しない種類を作るときに使う) */
  promptSendUnsupportedKinds: Set<AgentCliKind>
  /** 会話の再開(sessionResume)を偽にする種類(段階 3a で copilot も再開に対応したため、再開に対応しない種類を作るときに使う) */
  sessionResumeUnsupportedKinds: Set<AgentCliKind>
}

/**
 * 本物の agentCliCapabilities を包み、unsupportedKinds の種類は screenActivity と interrupt を、promptSendUnsupportedKinds の種類は
 * promptSend を、sessionResumeUnsupportedKinds の種類は sessionResume を偽にして返す(能力の表の不変条件「interrupt が真なら
 * screenActivity も真」を保つため、1 つ目は両方を偽にする)
 */
export function overrideAgentCliCapabilities(
  actual: (kind: AgentCliKind) => AgentCliCapabilities,
  overrides: AgentCliCapabilityOverrides
): (kind: AgentCliKind) => AgentCliCapabilities {
  return (kind) => {
    const capabilities = { ...actual(kind) }
    if (overrides.unsupportedKinds.has(kind)) {
      capabilities.screenActivity = false
      capabilities.interrupt = false
    }
    if (overrides.promptSendUnsupportedKinds.has(kind)) capabilities.promptSend = false
    if (overrides.sessionResumeUnsupportedKinds.has(kind)) capabilities.sessionResume = false
    return capabilities
  }
}
```

今の補助を使っているテストの `vi.hoisted` の値に新しい項目を足す（型の必須の項目になるため）:

```bash
cd <repo-root>
set -- \
  src/renderer/src/hooks/__tests__/useAgentActivity.test.ts \
  src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts \
  src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts \
  src/renderer/src/lib/__tests__/agentInterrupt.test.ts \
  src/renderer/src/lib/__tests__/promptRunAvailability.test.ts \
  src/renderer/src/lib/__tests__/agentCliMessages.test.ts
perl -0pi -e "s/promptSendUnsupportedKinds: new Set<AgentCliKind>\(\)\n/promptSendUnsupportedKinds: new Set<AgentCliKind>(),\n    sessionResumeUnsupportedKinds: new Set<AgentCliKind>()\n/g" "$@"
grep -c "sessionResumeUnsupportedKinds: new Set<AgentCliKind>()" "$@"
npx prettier --write "$@"
```

Expected: `grep -c` が `useAgentActivity.test.ts` 以外のファイルで `1`。`useAgentActivity.test.ts` は `new Set()`（型引数なし）で書いてあって当たらないので（計画の時点で確かめた）、その `vi.hoisted` の値の `promptSendUnsupportedKinds: new Set()` の後に `,` と `sessionResumeUnsupportedKinds: new Set()` を手で足す

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` の最上位の `afterEach` の `capabilityOverrides.promptSendUnsupportedKinds.clear()` の次に `capabilityOverrides.sessionResumeUnsupportedKinds.clear()` を足す。

- [ ] **Step 2: 失敗するテストを書く（main: 能力の表・起動の表・環境変数・starter・受け口）**

`src/shared/__tests__/agentCliKinds.test.ts` の「claude の能力はすべて真、copilot は promptSend・screenActivity・interrupt だけ真(段階 2b)」を次にする:

```ts
it('claude の能力はすべて真、copilot は changeAttribution だけ偽(段階 3a で sessionResume も真にした)', () => {
  expect(agentCliCapabilities('claude')).toEqual({
    promptSend: true,
    screenActivity: true,
    interrupt: true,
    changeAttribution: true,
    sessionResume: true
  })
  expect(agentCliCapabilities('copilot')).toEqual({
    promptSend: true,
    screenActivity: true,
    interrupt: true,
    changeAttribution: false,
    sessionResume: true
  })
})
```

`src/main/__tests__/agentCliLaunchSpecs.test.ts` の全体を次にする:

```ts
import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS, AGENT_CLI_PROFILES, agentCliCapabilities } from '@shared/agentCliKinds'
import type { AgentLaunchRequest } from '@shared/types'
import { AGENT_CLI_LAUNCH_SPECS } from '../agentCliLaunchSpecs'

const ID = '11111111-1111-4111-8111-111111111111'
// 英字を含む ID(大文字にすると値が変わる)
const LETTER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const HOOKS = '/tmp/prompt-ide-agent-hooks-x/a.json'
const NEW: AgentLaunchRequest = { kind: 'new' }
const RESUME: AgentLaunchRequest = { kind: 'resume', claudeSessionId: ID, cliKind: 'claude' }
const UNKNOWN = { kind: 'fork', claudeSessionId: ID } as unknown as AgentLaunchRequest

/** fn が投げた例外の文言(投げなければ空文字) */
function thrownMessage(fn: () => unknown): string {
  try {
    fn()
    return ''
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

describe('AGENT_CLI_LAUNCH_SPECS(表)', () => {
  it.each(AGENT_CLI_KINDS)('%s: 探すコマンドの名前は能力の表の commandName', (kind) => {
    expect(AGENT_CLI_LAUNCH_SPECS[kind].commandName).toBe(AGENT_CLI_PROFILES[kind].commandName)
  })

  it('追加で取り除く環境変数は copilot の COPILOT_ALLOW_ALL だけ', () => {
    expect(AGENT_CLI_LAUNCH_SPECS.claude.extraRemovedEnvKeys).toEqual([])
    expect(AGENT_CLI_LAUNCH_SPECS.copilot.extraRemovedEnvKeys).toEqual(['COPILOT_ALLOW_ALL'])
  })

  it('足す環境変数は copilot の COPILOT_DISABLE_RESUME_AUTO_CD=1 だけ(保存先への自動の移動を止める)', () => {
    expect(AGENT_CLI_LAUNCH_SPECS.claude.extraEnv).toEqual({})
    expect(AGENT_CLI_LAUNCH_SPECS.copilot.extraEnv).toEqual({ COPILOT_DISABLE_RESUME_AUTO_CD: '1' })
  })

  // win32 では環境変数の名前を大文字にそろえて比べるため、表の名前は大文字で書く(小文字だと取りこぼす)
  it.each(AGENT_CLI_KINDS)('%s: 取り除く・足す環境変数の名前はすべて大文字', (kind) => {
    const spec = AGENT_CLI_LAUNCH_SPECS[kind]
    for (const key of [...spec.extraRemovedEnvKeys, ...Object.keys(spec.extraEnv)]) {
      expect(key).toBe(key.toUpperCase())
    }
  })

  // 能力の表と起動の表の引数の整合(呼び出し側の取り違えを黙って捨てない。L-044)。起動の表は能力の表を読まないので、表の今の値に
  // 応じた期待で全種類を回す(どの種類も 1 件以上の確かめを作る。何も確かめずに通る行を作らない)
  it.each(AGENT_CLI_KINDS)(
    '%s: 会話の再開に対応する種類は ID が無いと投げ、対応しない種類は ID があると投げる',
    (kind) => {
      const { buildArgs } = AGENT_CLI_LAUNCH_SPECS[kind]
      const call = agentCliCapabilities(kind).sessionResume
        ? (): string[] => buildArgs(NEW, null, null)
        : (): string[] => buildArgs(NEW, ID, null)
      expect(call).toThrow()
    }
  )

  it.each(AGENT_CLI_KINDS.filter((kind) => !agentCliCapabilities(kind).changeAttribution))(
    '%s: hooks に対応しない種類に設定のファイルが渡ったら投げる(会話の ID は正しい値を渡す)',
    (kind) => {
      expect(() => AGENT_CLI_LAUNCH_SPECS[kind].buildArgs(NEW, ID, HOOKS)).toThrow(
        'hooks の設定のファイルは渡せません'
      )
    }
  )
})

describe('AGENT_CLI_LAUNCH_SPECS.claude.buildArgs(MVP からの claude の起動の引数)', () => {
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

describe('AGENT_CLI_LAUNCH_SPECS.copilot.buildArgs(段階 3a)', () => {
  const { buildArgs } = AGENT_CLI_LAUNCH_SPECS.copilot

  it('new は --session-id <ID>(2 つの要素)、resume は --resume=<ID>(1 つの要素。-C・--allow-*・--yolo などを付けない)', () => {
    expect(buildArgs(NEW, ID, null)).toEqual(['--session-id', ID])
    expect(buildArgs(RESUME, ID, null)).toEqual([`--resume=${ID}`])
    expect(buildArgs(RESUME, ID, null)).toHaveLength(1)
  })

  it('会話の ID が無いと投げる(new・resume とも)', () => {
    expect(() => buildArgs(NEW, null, null)).toThrow('copilot の起動には会話の ID が要ります')
    expect(() => buildArgs(RESUME, null, null)).toThrow('copilot の起動には会話の ID が要ります')
  })

  it.each<[string, string]>([
    ['大文字', LETTER_ID.toUpperCase()],
    ['36 文字でない', ID.slice(0, 35)],
    ['UUID の先頭 8 文字(copilot の前方一致で別の会話が開きうる)', ID.slice(0, 8)],
    ['- 始まり', '--yolo'],
    ['UUID でない語(copilot では新しいセッションに落ちる)', 'my-session'],
    ['v4 以外', '11111111-1111-1111-8111-111111111111']
  ])(
    '会話の ID が小文字の UUID v4 の完全な形でなければ(%s)、値を文言に入れずに投げる(L-007・L-017)',
    (_label, value) => {
      for (const launch of [NEW, RESUME]) {
        const message = thrownMessage(() => buildArgs(launch, value, null))
        expect(message).toBe('copilot の起動の会話の ID の形が正しくありません')
        expect(message).not.toContain(value)
      }
    }
  )

  it('hooks の設定のファイルが渡ったら投げる(changeAttribution は偽のまま)', () => {
    expect(() => buildArgs(NEW, ID, HOOKS)).toThrow(
      'copilot の起動に hooks の設定のファイルは渡せません'
    )
  })

  it('未知の kind は投げる', () => {
    expect(() => buildArgs(UNKNOWN, ID, null)).toThrow('未知の起動の指定です')
  })
})
```

`src/main/__tests__/agentCommand.test.ts`:

1 行の `buildAgentEnv(…, [])` の呼び出しに 5 つ目の引数 `{}` を足す（ASCII のパターン）:

```bash
cd <repo-root>
perl -pi -e 's/(buildAgentEnv\(.*), \[\]\)/$1, [], {})/g' src/main/__tests__/agentCommand.test.ts
grep -n "buildAgentEnv(" src/main/__tests__/agentCommand.test.ts
```

Expected: 1 行の呼び出しがすべて `, [], {})` で終わる。複数行の 3 か所（「win32 は大文字小文字を無視して Path を PATH に置き換え…」の `'win32',\n      []`、「追加の除外は完全一致で取り除き…」の `['COPILOT_ALLOW_ALL']`、「win32 は追加の除外も大文字小文字を無視する」の `['COPILOT_ALLOW_ALL']`）は、最後の引数の後に `, {}` を手で足す。

ファイルの末尾に足す:

```ts
describe('buildAgentEnv(種類ごとの足す環境変数。段階 3a)', () => {
  it('取り除く一覧を適用した後に足し、利用者の環境の同じ名前を上書きする', () => {
    const env = buildAgentEnv(
      { HOME: '/home/u', COPILOT_DISABLE_RESUME_AUTO_CD: '0' },
      '/p',
      'darwin',
      [],
      { COPILOT_DISABLE_RESUME_AUTO_CD: '1' }
    )
    expect(env.COPILOT_DISABLE_RESUME_AUTO_CD).toBe('1')
    expect(env.HOME).toBe('/home/u')
  })

  it('win32 は大文字小文字だけ違う同じ名前を取り除いてから足す', () => {
    const env = buildAgentEnv({ copilot_disable_resume_auto_cd: '0' }, 'C:\\p', 'win32', [], {
      COPILOT_DISABLE_RESUME_AUTO_CD: '1'
    })
    expect(env).not.toHaveProperty('copilot_disable_resume_auto_cd')
    expect(env.COPILOT_DISABLE_RESUME_AUTO_CD).toBe('1')
  })

  it('POSIX は大文字小文字の違う名前を別の変数として残す', () => {
    const env = buildAgentEnv({ copilot_disable_resume_auto_cd: '0' }, '/p', 'linux', [], {
      COPILOT_DISABLE_RESUME_AUTO_CD: '1'
    })
    expect(env.copilot_disable_resume_auto_cd).toBe('0')
    expect(env.COPILOT_DISABLE_RESUME_AUTO_CD).toBe('1')
  })

  it('PATH・TERM・COLORTERM は足す環境変数より後に設定する(表に同じ名前があっても上書きされる)', () => {
    const env = buildAgentEnv({}, '/p', 'darwin', [], {
      PATH: '/evil',
      TERM: 'dumb',
      COLORTERM: 'none'
    })
    expect(env.PATH).toBe('/p')
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
  })
})
```

`describe('resolveAgentLaunch(CLI の種類)')` の中に足す:

```ts
it('copilot の計画の環境変数には COPILOT_DISABLE_RESUME_AUTO_CD=1 を足し(利用者の 0 を上書き)、claude の計画は利用者の値のまま', async () => {
  const env = { HOME: '/home/u', PATH: '/usr/bin', COPILOT_DISABLE_RESUME_AUTO_CD: '0' }
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
  expect(copilot.plan.env.COPILOT_DISABLE_RESUME_AUTO_CD).toBe('1')
  expect(claude.plan.env.COPILOT_DISABLE_RESUME_AUTO_CD).toBe('0')
  // 計画の引数は空のまま(会話の指定は starter が起動の表の buildArgs で足す)
  expect(copilot.plan.args).toEqual([])
})
```

`src/main/__tests__/agentSessionStarter.test.ts` の `describe('createAgentSessionStarter(CLI の種類)', …)` の全体を次にする（「copilot で resume の依頼は resume-unsupported で断り…」は新しいファイル `agentSessionStarter.capabilities.test.ts` へ移す）:

```ts
describe('createAgentSessionStarter(CLI の種類)', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  const OTHER = '22222222-2222-4222-9222-222222222222'
  const COPILOT_LAUNCH: AgentLaunchResolution = {
    kind: 'ok',
    plan: { cliKind: 'copilot', file: '/bin/copilot', args: [], env: { PATH: '/p' } }
  }
  const copilotResume = (claudeSessionId: string, slotId = 'slot-1'): AgentStartRequest => ({
    ...REQUEST,
    slotId,
    launch: { kind: 'resume', claudeSessionId, cliKind: 'copilot' }
  })

  beforeEach(async () => {
    resolveLaunch.mockResolvedValue(COPILOT_LAUNCH)
    await records.whenLoaded()
    await copilotRecords.whenLoaded()
  })

  it('copilot の new は会話の ID を振って --session-id <ID> で起動し、予約し、copilot の記録だけに書き、結果に copilot と ID を載せる', async () => {
    const claudeRecordSpy = vi.spyOn(records, 'record')
    const reserveSpy = vi.spyOn(reservations, 'tryReserve')
    const { start, sessionInfoOf } = makeStarterService()
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      cliKind: 'copilot',
      claudeSessionId: NEW_IDS[0]
    })
    expect(spawnPty).toHaveBeenCalledWith('/bin/copilot', ['--session-id', NEW_IDS[0]], {
      name: 'xterm-256color',
      cols: 90,
      rows: 20,
      cwd: '/work',
      env: { PATH: '/p' }
    })
    expect(reserveSpy).toHaveBeenCalledExactlyOnceWith(NEW_IDS[0])
    expect(copilotRecords.last('/work')).toBe(NEW_IDS[0])
    expect(claudeRecordSpy).not.toHaveBeenCalled()
    expect(records.last('/work')).toBeNull()
    expect(sessionInfoOf('sid-1')).toEqual({ cliKind: 'copilot', claudeSessionId: NEW_IDS[0] })
  })

  it('copilot の resume は copilot の記録にある ID を --resume=<ID>(1 つの引数)で起動し、記録の先頭へ移す(新しく振らない)', async () => {
    copilotRecords.record('/work', ID)
    copilotRecords.record('/work', OTHER)
    await expect(makeStarter()(1, copilotResume(ID), makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      cliKind: 'copilot',
      claudeSessionId: ID
    })
    expect(spawnPty).toHaveBeenCalledWith('/bin/copilot', [`--resume=${ID}`], expect.any(Object))
    expect(copilotRecords.last('/work')).toBe(ID)
    expect(claudeIdCount).toBe(0)
  })

  it('claude の記録にだけある ID の copilot の再開は unknown-session で、spawn しない(claude の ID を copilot で再開する経路は無い)', async () => {
    records.record('/work', ID)
    await expect(makeStarter()(1, copilotResume(ID), makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'unknown-session'
    })
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('同じ ID の copilot の二重の起動は session-in-use(種類をまたいで共有の予約)', async () => {
    copilotRecords.record('/work', ID)
    let count = 0
    spawnPty.mockImplementation(() => makeFakePty())
    const { start } = makeStarterService({ createSessionId: () => `sid-${++count}` })
    await expect(start(1, copilotResume(ID), makeSink())).resolves.toMatchObject({
      kind: 'started'
    })
    await expect(start(1, copilotResume(ID, 'slot-2'), makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'session-in-use'
    })
  })

  it('copilot の already-running は、動いているセッションの種類と ID を返す', async () => {
    const start = makeStarter()
    await start(1, REQUEST, makeSink())
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'already-running',
      sessionId: 'sid-1',
      cliKind: 'copilot',
      claudeSessionId: NEW_IDS[0]
    })
    expect(spawnPty).toHaveBeenCalledOnce()
  })

  it('copilot のセッションも hooks を prepare・activate し、exited で sessionInfoOf から消えて release(prepared, sessionId) を 1 回呼ぶ', async () => {
    const { start, sessionInfoOf } = makeStarterService()
    await start(1, REQUEST, makeSink())
    expect(hooks.calls).toEqual(['prepare', 'activate:sid-1'])
    pty.emitExit(0)
    await vi.waitFor(() => expect(sessionInfoOf('sid-1')).toBeUndefined())
    await vi.waitFor(() =>
      expect(hooks.calls).toEqual(['prepare', 'activate:sid-1', 'release:sid-1'])
    )
  })

  it('hooks が設定のファイルを返しても(copilot では本来返さない)、copilot の引数には --settings を足さない', async () => {
    hooks = makeFakeAgentHookSessions((ownerId) => ({
      ownerId,
      hooks: { settingsPath: '/tmp/prompt-ide-agent-hooks-x/abc.json', token: 'ab'.repeat(32) },
      unavailableReason: null
    }))
    await makeStarter({ hooks })(1, REQUEST, makeSink())
    expect(spawnPty).toHaveBeenCalledWith(
      '/bin/copilot',
      ['--session-id', NEW_IDS[0]],
      expect.any(Object)
    )
  })

  it('lastSessionOf は copilot の依頼に copilot の記録の先頭を種類付きで返す', async () => {
    copilotRecords.record('/work', ID)
    await expect(makeStarterService().lastSessionOf(1, '/work', 'copilot')).resolves.toEqual({
      cliKind: 'copilot',
      claudeSessionId: ID
    })
  })

  it('copilot の計画で起動したセッションの中断は、2 回目の案内(afterMs: 100)を返す(starter が計画の種類の送り方を渡す。L-018)', async () => {
    await makeStarter()(1, REQUEST, makeSink())
    expect(registry.interrupt(1, 'sid-1')).toEqual({ kind: 'sent', followUp: { afterMs: 100 } })
  })

  it('claude の計画で起動したセッションの中断は、2 回目の案内が null(今までどおり 1 回)', async () => {
    resolveLaunch.mockResolvedValue(OK_LAUNCH)
    await makeStarter()(1, REQUEST, makeSink())
    expect(registry.interrupt(1, 'sid-1')).toEqual({ kind: 'sent', followUp: null })
  })
})
```

`src/main/__tests__/agentSessionStarter.capabilities.test.ts` を作る:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCliCapabilities, AgentCliKind } from '@shared/agentCliKinds'

// 能力の表の sessionResume が偽の種類の流れ(再開の拒否・会話の ID を持たない起動)を確かめるため、能力の表を差し替える(段階 3a で
// copilot も再開に対応し、今の表には該当する種類が無い。設計書 2026-10-23「実装の分割」の 3)。差し替えはこのファイルの中だけ
const capabilityOverrides = vi.hoisted(() => ({
  sessionResumeUnsupportedKinds: new Set<AgentCliKind>()
}))
vi.mock('@shared/agentCliKinds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/agentCliKinds')>()
  return {
    ...actual,
    agentCliCapabilities: (kind: AgentCliKind): AgentCliCapabilities => {
      const capabilities = { ...actual.agentCliCapabilities(kind) }
      if (capabilityOverrides.sessionResumeUnsupportedKinds.has(kind)) {
        capabilities.sessionResume = false
      }
      return capabilities
    }
  }
})

import type { AgentStartRequest } from '@shared/types'
import { FolderAccessManager } from '../folderAccessManager'
import { AgentSessionRegistry } from '../agentSessionRegistry'
import { createAgentSessionStarter } from '../agentSessionStarter'
import type { AgentSessionSink, AgentSessionStarterService } from '../agentSessionStarter'
import { createAgentSessionRecordStore } from '../agentSessionRecordStore'
import type { AgentSessionRecordStore } from '../agentSessionRecordStore'
import { createClaudeSessionReservations } from '../claudeSessionReservations'
import type { ClaudeSessionReservations } from '../claudeSessionReservations'
import { AGENT_CLI_LAUNCH_SPECS } from '../agentCliLaunchSpecs'
import type { PtySpawn, StopTree } from '../agentSession'
import type { AgentLaunchResolution } from '../agentCommand'
import { makeFakePty } from './helpers/fakePty'
import type { FakePty } from './helpers/fakePty'
import { makeFakeRecordIo } from './helpers/fakeAgentSessionRecordIo'
import { makeFakeAgentHookSessions } from './helpers/fakeAgentHookSessions'
import type { FakeAgentHookSessions } from './helpers/fakeAgentHookSessions'

const ID = '11111111-1111-4111-8111-111111111111'
const NEW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REQUEST: AgentStartRequest = {
  slotId: 'slot-1',
  folderPath: '/work',
  cols: 90,
  rows: 20,
  launch: { kind: 'new' }
}
const COPILOT_LAUNCH: AgentLaunchResolution = {
  kind: 'ok',
  plan: { cliKind: 'copilot', file: '/bin/copilot', args: [], env: { PATH: '/p' } }
}

let folderAccess: FolderAccessManager
let registry: AgentSessionRegistry
let spawnPty: ReturnType<typeof vi.fn<PtySpawn>>
let claudeRecords: AgentSessionRecordStore
let copilotRecords: AgentSessionRecordStore
let reservations: ClaudeSessionReservations
let hooks: FakeAgentHookSessions
let createClaudeSessionId: ReturnType<typeof vi.fn<() => string>>
const stopTree = vi.fn<StopTree>(async (target, exited) => {
  ;(target as FakePty).emitExit(0, 15)
  await exited
})

const makeSink = (): AgentSessionSink => ({
  isGone: () => false,
  onData: () => undefined,
  onExit: () => undefined
})

function makeService(): AgentSessionStarterService {
  return createAgentSessionStarter({
    folderAccess,
    registry,
    resolveLaunch: async () => COPILOT_LAUNCH,
    spawnPty,
    stopTree,
    createSessionId: () => 'sid-1',
    records: { claude: claudeRecords, copilot: copilotRecords },
    reservations,
    createClaudeSessionId,
    platform: 'linux',
    canonicalize: async (folderPath) => folderPath,
    isDirectory: async () => true,
    hooks
  })
}

beforeEach(async () => {
  capabilityOverrides.sessionResumeUnsupportedKinds.add('copilot')
  folderAccess = new FolderAccessManager()
  folderAccess.set(1, '/work')
  registry = new AgentSessionRegistry()
  spawnPty = vi.fn<PtySpawn>().mockReturnValue(makeFakePty(4242))
  claudeRecords = createAgentSessionRecordStore(makeFakeRecordIo())
  copilotRecords = createAgentSessionRecordStore(makeFakeRecordIo())
  await claudeRecords.whenLoaded()
  await copilotRecords.whenLoaded()
  reservations = createClaudeSessionReservations()
  hooks = makeFakeAgentHookSessions()
  createClaudeSessionId = vi.fn<() => string>(() => NEW_ID)
})

afterEach(() => {
  capabilityOverrides.sessionResumeUnsupportedKinds.clear()
  vi.restoreAllMocks()
})

describe('createAgentSessionStarter(再開に対応しない種類。能力の表を差し替えた copilot)', () => {
  it('resume の依頼は resume-unsupported で断り、hooks.prepare・記録の読み込み・spawn をしない(起動しない。L-041)', async () => {
    copilotRecords.record('/work', ID)
    const whenLoadedSpy = vi.spyOn(copilotRecords, 'whenLoaded')
    await expect(
      makeService().start(
        1,
        { ...REQUEST, launch: { kind: 'resume', claudeSessionId: ID, cliKind: 'copilot' } },
        makeSink()
      )
    ).resolves.toEqual({ kind: 'error', error: 'resume-unsupported' })
    expect(hooks.prepare).not.toHaveBeenCalled()
    expect(whenLoadedSpy).not.toHaveBeenCalled()
    expect(spawnPty).not.toHaveBeenCalled()
    expect(registry.snapshot(1)).toEqual([])
  })

  it('new は会話の ID を振らず・予約せず・記録せず、起動の表に null を渡し、結果と sessionInfoOf の ID は null', async () => {
    // 今の copilot の起動の表は ID が無いと投げるので、ID を持たない種類の起動の表の形(引数なし)に差し替える
    const buildArgs = vi.spyOn(AGENT_CLI_LAUNCH_SPECS.copilot, 'buildArgs').mockReturnValue([])
    const reserveSpy = vi.spyOn(reservations, 'tryReserve')
    const recordSpy = vi.spyOn(copilotRecords, 'record')
    const { start, sessionInfoOf } = makeService()
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    expect(buildArgs).toHaveBeenCalledExactlyOnceWith({ kind: 'new' }, null, null)
    expect(spawnPty).toHaveBeenCalledWith('/bin/copilot', [], expect.any(Object))
    expect(createClaudeSessionId).not.toHaveBeenCalled()
    expect(reserveSpy).not.toHaveBeenCalled()
    expect(recordSpy).not.toHaveBeenCalled()
    expect(copilotRecords.last('/work')).toBeNull()
    expect(sessionInfoOf('sid-1')).toEqual({ cliKind: 'copilot', claudeSessionId: null })
  })
})
```

`src/main/__tests__/handlers/agentTerminalHandlers.test.ts` の「copilot のセッションは、種類と null の会話の ID を載せて返す」を次にする:

```ts
it('copilot のセッションは、種類と会話の ID を載せて返す(段階 3a で copilot も ID を持つ)', async () => {
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
    claudeSessionId: CLAUDE_ID
  })
  expect(spawnPty).toHaveBeenCalledWith(
    '/bin/copilot',
    ['--session-id', CLAUDE_ID],
    expect.any(Object)
  )
  expect(handles.get('agentTerminal:getState')?.(event)).toEqual([
    { slotId: 'slot-1', sessionId: 'sid-1', cliKind: 'copilot', claudeSessionId: CLAUDE_ID }
  ])
})
```

`src/main/__tests__/agentCliLaunch.integration.test.ts`:

- import を足す:

  ```ts
  import { readFileSync } from 'node:fs'
  import type { AgentLaunchRequest, AgentSessionExit, AgentStartResult } from '@shared/types'
  import { FolderAccessManager } from '../folderAccessManager'
  import { AgentSessionRegistry } from '../agentSessionRegistry'
  import { createAgentSessionStarter } from '../agentSessionStarter'
  import { createAgentSessionRecordStore, toAgentFolderKey } from '../agentSessionRecordStore'
  import { createClaudeSessionReservations } from '../claudeSessionReservations'
  import { makeFakeRecordIo } from './helpers/fakeAgentSessionRecordIo'
  import { makeFakeAgentHookSessions } from './helpers/fakeAgentHookSessions'
  ```

  （`readFileSync` は今の `node:fs` の import の並びに足す。vitest の import に `vi` を足す）

- 冒頭のコメントの 1 行目を `// 実物の node-pty と偽の copilot(`#!/usr/bin/env node` のスクリプト)で、選んだ CLI の解決と起動・会話の指定の引数と環境変数の届き方を確かめる(設計書「テスト方針」。` にする（以降の行は今のまま）
- `resolveCopilot` を、利用者の環境に足す値を受け取る形にする:

  ```ts
  async function resolveCopilot(
    binDir: string,
    extraEnv: NodeJS.ProcessEnv = {}
  ): Promise<AgentLaunchPlan> {
    const resolution = await resolveAgentLaunch({
      env: {
        HOME: dir,
        PATH: '/usr/bin:/bin',
        LANG: 'en_US.UTF-8',
        COPILOT_ALLOW_ALL: 'true',
        ...extraEnv
      },
      // (以降は今のまま)
  ```

- `runPlan` の上のコメントを `計画のとおりに pty で起動し、終了を待つ。引数は starter と同じく、計画の引数の後ろに起動の表の buildArgs(新しく起動する・RUN_PLAN_ID の会話・hooks の設定のファイルなし)を足す` にし、`buildArgs({ kind: 'new' }, null, null)` を `buildArgs({ kind: 'new' }, RUN_PLAN_ID, null)` にする。`MARKER` の定義の次に `const RUN_PLAN_ID = '44444444-4444-4444-8444-444444444444'` を足す
- 1 つ目のテストの名前を `新しい起動は --session-id <ID> だけ・作業ディレクトリは許可のフォルダ・COPILOT_ALLOW_ALL なしで起動し、shebang の env node は渡した PATH で解決される` にし、報告の期待の `args: []` を `args: ['--session-id', RUN_PLAN_ID]` にする（`expect(plan).toMatchObject({ … args: [] })` は計画の引数なので今のまま）
- ファイルの末尾に足す:

  ```ts
  describe.skipIf(process.platform === 'win32')(
    'copilot の新しい起動と再開(実物の starter・resolveAgentLaunch・pty と偽の copilot。段階 3a)',
    () => {
      const NEW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      let registry: AgentSessionRegistry

      beforeEach(() => {
        registry = new AgentSessionRegistry()
      })

      afterEach(async () => {
        await registry.stopAll('stopped')
      })

      it('新しい起動は [--session-id, ID]、再開は [--resume=ID](1 つの要素)で届き、COPILOT_DISABLE_RESUME_AUTO_CD=1 が届き、再開できない ID の終了コード 1 が届く', async () => {
        const binDir = join(dir, 'bin-resume')
        const work = join(dir, 'work-resume')
        mkdirSync(work)
        const report = join(dir, 'report-resume.jsonl')
        writeFakeCopilot(binDir, [
          '#!/usr/bin/env node',
          "const fs = require('node:fs')",
          'const args = process.argv.slice(2)',
          `fs.appendFileSync(${JSON.stringify(report)}, JSON.stringify({ args, autoCd: process.env.COPILOT_DISABLE_RESUME_AUTO_CD ?? null }) + '\\n')`,
          // 何も送らずに閉じたセッションの再開(copilot 1.0.87 は終了コード 1。記録の 5f)を模す
          `if (args[0] === '--resume=${NEW_ID}') process.exit(1)`
        ])
        // 利用者の環境の 0 は、起動の表の値(1)で上書きされる
        const plan = await resolveCopilot(binDir, { COPILOT_DISABLE_RESUME_AUTO_CD: '0' })
        const allowedFolder = realpathSync(work)
        const folderAccess = new FolderAccessManager()
        folderAccess.set(1, allowedFolder)
        const claudeRecords = createAgentSessionRecordStore(makeFakeRecordIo())
        const copilotRecords = createAgentSessionRecordStore(makeFakeRecordIo())
        // 終了の後に予約が外れるのを待つため、予約を手元に持つ
        const reservations = createClaudeSessionReservations()
        let sessionCount = 0
        const { start } = createAgentSessionStarter({
          folderAccess,
          registry,
          resolveLaunch: async () => ({ kind: 'ok', plan }),
          spawnPty: spawn,
          stopTree: (pty, exited) => stopProcessTree({ pid: pty.pid, exited }),
          createSessionId: () => `it-${++sessionCount}`,
          records: { claude: claudeRecords, copilot: copilotRecords },
          reservations,
          createClaudeSessionId: () => NEW_ID,
          hooks: makeFakeAgentHookSessions()
        })
        /** 起動して、そのセッションの終了を待つ(起動に失敗したら終了を待たずに投げる) */
        const startAndWaitForExit = async (
          slotId: string,
          launch: AgentLaunchRequest
        ): Promise<{ result: AgentStartResult; exit: AgentSessionExit }> => {
          let resolveExit: (exit: AgentSessionExit) => void = () => undefined
          const exited = new Promise<AgentSessionExit>((resolve) => {
            resolveExit = resolve
          })
          const result = await start(
            1,
            { slotId, folderPath: work, cols: 80, rows: 24, launch },
            { isGone: () => false, onData: () => undefined, onExit: (exit) => resolveExit(exit) }
          )
          if (result.kind === 'error')
            throw new Error(`起動できませんでした: ${JSON.stringify(result)}`)
          return { result, exit: await exited }
        }

        const first = await startAndWaitForExit('slot-1', { kind: 'new' })
        expect(first.result).toEqual({
          kind: 'started',
          sessionId: 'it-1',
          cliKind: 'copilot',
          claudeSessionId: NEW_ID
        })
        expect(first.exit).toMatchObject({ exitCode: 0, reason: 'exited' })
        const folderKey = toAgentFolderKey(allowedFolder, process.platform)
        expect(copilotRecords.last(folderKey)).toBe(NEW_ID)
        expect(claudeRecords.last(folderKey)).toBeNull()
        // 予約は starter が exited の解決の後に外す(sink の終了の知らせより後になりうる)ので、外れるまで待ってから再開する
        await vi.waitFor(() => expect(reservations.has(NEW_ID)).toBe(false))

        const second = await startAndWaitForExit('slot-2', {
          kind: 'resume',
          claudeSessionId: NEW_ID,
          cliKind: 'copilot'
        })
        expect(second.result).toMatchObject({
          kind: 'started',
          cliKind: 'copilot',
          claudeSessionId: NEW_ID
        })
        expect(second.exit).toMatchObject({ exitCode: 1, reason: 'exited' })

        const lines = readFileSync(report, 'utf-8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as unknown)
        expect(lines).toEqual([
          { args: ['--session-id', NEW_ID], autoCd: '1' },
          { args: [`--resume=${NEW_ID}`], autoCd: '1' }
        ])
      }, 30_000)
    }
  )
  ```

- [ ] **Step 3: 失敗するテストを書く（renderer: 前提を失うテストの直し）**

`src/renderer/src/lib/__tests__/agentCliMessages.test.ts`:

- 「使えない機能の注記: copilot は区別・再開の 2 つを並べ…」を `使えない機能の注記: copilot は区別だけを並べ(段階 2a で画面の判定と中断、段階 2b で送信、段階 3a で再開に対応した)、claude は出さない` にし、期待を `'copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別'` にする
- 「画面の判定と中断が無い種類(能力の表を差し替えた copilot)…」の期待を `'copilot では次の機能を使えません（ターミナルで直接操作します）: 作業中・入力待ちの表示と通知、中断、利用者の変更との区別'` にする
- 「送信が無い種類(能力の表を差し替えた copilot)…」の期待を `'copilot では次の機能を使えません（ターミナルで直接操作します）: プロンプトの送信（実行・再実行）、利用者の変更との区別'` にする
- その次に足す（`afterEach` に `capabilityOverrides.sessionResumeUnsupportedKinds.clear()` も足す）:

  ```ts
  it('使えない機能の注記: 再開が無い種類(能力の表を差し替えた copilot)は、再開の名前も並べる', () => {
    capabilityOverrides.sessionResumeUnsupportedKinds.add('copilot')
    expect(agentCliUnsupportedFeaturesNote('copilot')).toBe(
      'copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別、前回の続きから・このセッションで再開'
    )
  })
  ```

`src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx` の「copilot を選んでいると、使えない機能の注記に能力の表で使えない機能(区別・再開)を出す」を、名前を `copilot を選んでいると、使えない機能の注記に能力の表で使えない機能(区別)を出す` にし、`getByText` の文字列を `'copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別'` にする。

`src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts`:

- 先頭の import を `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'` にし、import の後に足す:

  ```ts
  import type { AgentCliKind } from '@shared/agentCliKinds'
  import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

  // 設定の種類が再開に対応していない理由(agentResume*UnsupportedReason)を確かめるため、能力の表を種類ごとに差し替える
  // (段階 3a で copilot も再開に対応し、今の表には該当する種類が無い)
  const capabilityOverrides = vi.hoisted(
    (): AgentCliCapabilityOverrides => ({
      unsupportedKinds: new Set<AgentCliKind>(),
      promptSendUnsupportedKinds: new Set<AgentCliKind>(),
      sessionResumeUnsupportedKinds: new Set<AgentCliKind>()
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
  ```

- `describe('再開の入口の CLI の種類(設定の種類)', …)` の名前を `再開の入口の CLI の種類(設定の種類が再開に対応しない種類。能力の表を差し替えた copilot)` にし、describe の先頭に足す（中の 4 つのテストは変えない）:

  ```ts
  beforeEach(() => {
    capabilityOverrides.sessionResumeUnsupportedKinds.add('copilot')
  })
  afterEach(() => {
    capabilityOverrides.sessionResumeUnsupportedKinds.clear()
  })
  ```

- ファイルの末尾に足す:

  ```ts
  describe('再開の入口の CLI の種類(copilot も再開に対応する。段階 3a)', () => {
    it('前回の続きから: 設定が copilot で copilot の前回があれば押せる', () => {
      expect(
        getResumeLastDisabledReason({
          startDisabledReason: null,
          appCliKind: 'copilot',
          lastSession: { kind: 'found', cliKind: 'copilot', claudeSessionId: ID },
          tabs: [tab({ label: 'copilot 1' })]
        })
      ).toBeNull()
    })
  })
  ```

`src/renderer/src/hooks/__tests__/useAgentResume.test.ts`:

- import の後（`mockUseAgentLastSession` の定義の前）に足す（`vi` は import 済み。`afterEach` を vitest の import に足す）:

  ```ts
  import type { AgentCliKind } from '@shared/agentCliKinds'
  import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

  // 設定の種類が再開に対応していないときの理由を確かめるため、能力の表を差し替える(段階 3a で copilot も再開に対応した)
  const capabilityOverrides = vi.hoisted(
    (): AgentCliCapabilityOverrides => ({
      unsupportedKinds: new Set<AgentCliKind>(),
      promptSendUnsupportedKinds: new Set<AgentCliKind>(),
      sessionResumeUnsupportedKinds: new Set<AgentCliKind>()
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
  ```

- `describe('設定の種類が再開に対応していない(copilot)', …)` の名前を `設定の種類が再開に対応していない(能力の表を差し替えた copilot)` にし、describe の先頭に `beforeEach(() => { capabilityOverrides.sessionResumeUnsupportedKinds.add('copilot') })` と `afterEach(() => { capabilityOverrides.sessionResumeUnsupportedKinds.clear() })` を足す（中の 2 つのテストは変えない）

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`:

- 「使う CLI の配線(本物の useAgentSessions。L-060)」の describe:
  - `const CLAUDE_ID = …` の次に `const COPILOT_ID = '33333333-3333-4333-8333-333333333333'` と `const ID_OF: Record<AgentCliKind, string> = { claude: CLAUDE_ID, copilot: COPILOT_ID }` を足し、`startWith` の `claudeSessionId: cliKind === 'claude' ? CLAUDE_ID : null` を `claudeSessionId: ID_OF[cliKind]` にする
  - 「設定が copilot なら、未起動のタブの名前は copilot で…前回の続きから・このセッションで再開は copilot の理由で押せない」を、次の 2 つに置き換える（import の `agentSessionMessages` の並びに `AGENT_RESUME_LAST_NO_RECORD` を足す）:

    ```ts
    it('設定が copilot なら、未起動のタブの名前は copilot で、起動すると実行と中断は活動の理由で押せず、前回の続きからは記録の理由になる(copilot も再開に対応した。段階 3a)', async () => {
      setCliKind('copilot')
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.agentTerminal.sessions.selected.label).toBe('copilot 1')
      await startWith(result, 'copilot')
      expect(result.current.promptRun).toMatchObject({
        isRunDisabled: true,
        runDisabledReason: agentSendBlockedByActivityReason('unknown', 'copilot')
      })
      expect(result.current.agentTerminal.interrupt.disabledReason).toBe(
        agentInterruptBlockedByActivityReason('unknown', 'copilot')
      )
      expect(result.current.agentTerminal.resumeLast.disabledReason).toBe(
        AGENT_RESUME_LAST_NO_RECORD
      )
    })

    it('設定の種類が再開に対応していなければ(能力の表を差し替えた copilot)、前回の続きから・このセッションで再開はその理由で押せない', async () => {
      capabilityOverrides.sessionResumeUnsupportedKinds.add('copilot')
      setCliKind('copilot')
      const { result } = renderWorkspace({ folderPath: '/p' })
      await startWith(result, 'copilot')
      expect(result.current.agentTerminal.resumeLast.disabledReason).toBe(
        agentResumeLastUnsupportedReason('copilot')
      )
      expect(result.current.getHistoryActions(agentEntry).resume?.reason).toBe(
        agentResumeEntryUnsupportedReason('copilot')
      )
    })
    ```

- 「copilot の配線(本物の useAgentSessions・useAgentActivity・…)」の describe:
  - describe の先頭（`let startSpy` の前）に `const COPILOT_ID = '33333333-3333-4333-8333-333333333333'` と `const COPILOT_ID_2 = '55555555-5555-4555-8555-555555555555'` を足す
  - `beforeEach` の `startSpy` の結果の `claudeSessionId: null` を `claudeSessionId: COPILOT_ID` に、`sessionId: 'sid-copilot-2'` を返す 2 か所の `mockResolvedValueOnce` の `claudeSessionId: null` を `claudeSessionId: COPILOT_ID_2` にする（`grep -n "claudeSessionId: null" src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` の結果のうち、この describe の中の 3 か所だけを直す。ほかの describe の `claudeSessionId: null`〈送り先の控えのテストの ID の無いタブなど〉は変えない）
  - 「入力待ちの copilot のタブへ、実行(送信前の確認はオフ)で貼り付けと \\r を書き…onSent に copilot を渡す」の `expect(onSent).toHaveBeenCalledExactlyOnceWith(null, 'copilot')` を次にし、テストの名前の末尾を `…onSent に copilot の送り先(会話の ID と種類)を渡す` にする:

    ```ts
    expect(onSent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        claudeSessionId: COPILOT_ID,
        cliKind: 'copilot',
        folderPath: '/p'
      }),
      'copilot'
    )
    ```

`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`:

- 先頭の import の後に足す:

  ```ts
  import type { AgentCliKind } from '@shared/agentCliKinds'
  import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

  // 会話の ID を持たない種類(sessionResume が偽)の記録の省略を確かめるため、能力の表を差し替える(段階 3a で copilot も再開に
  // 対応し、今の表には該当する種類が無い)
  const capabilityOverrides = vi.hoisted(
    (): AgentCliCapabilityOverrides => ({
      unsupportedKinds: new Set<AgentCliKind>(),
      promptSendUnsupportedKinds: new Set<AgentCliKind>(),
      sessionResumeUnsupportedKinds: new Set<AgentCliKind>()
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
  ```

- `SENT_TO` の次に足す:

  ```ts
  const COPILOT_SENT_TO: AgentHistoryInfo = {
    claudeSessionId: '33333333-3333-4333-8333-333333333333',
    cliKind: 'copilot',
    tabLabel: 'copilot 1',
    folderPath: '/repo'
  }
  ```

- 送れたときの記録の describe の `afterEach` に `capabilityOverrides.sessionResumeUnsupportedKinds.clear()` を足す
- 「会話の ID を持たない種類(copilot。sessionResume が偽)の送り先で送れたときは、参照の後始末だけ行い、記録もログもしない(段階 3 で記録する)」を、次の 3 つに置き換える:

  ```ts
  it('copilot の送り先で送れたら、cliKind: copilot のエントリを記録する(ツールの欄は claude のまま。段階 3a)', async () => {
    const { onSent, addHistoryEntry } = await runAndTakeOnSent()
    onSent(COPILOT_SENT_TO, 'copilot')
    expect(addHistoryEntry).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 'sent', toolId: 'claude', agent: COPILOT_SENT_TO })
    )
  })

  it('copilot の送り先で送り先を控えられなかった(null)ときは、claude と同じく記録を省いてログに残す', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { onSent, addHistoryEntry, agentReferences } = await runAndTakeOnSent()
    onSent(null, 'copilot')
    expect(agentReferences.markSent).toHaveBeenCalledOnce()
    expect(addHistoryEntry).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('会話の ID を持たない種類(能力の表を差し替えた copilot)の送り先で送れたときは、参照の後始末だけ行い、記録もログもしない', async () => {
    capabilityOverrides.sessionResumeUnsupportedKinds.add('copilot')
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { onSent, addHistoryEntry, agentReferences } = await runAndTakeOnSent()
    onSent(null, 'copilot')
    expect(agentReferences.markSent).toHaveBeenCalledOnce()
    expect(addHistoryEntry).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
  ```

- 「copilot のタブへ再実行して送れたとき(sentTo が null)は、記録もログもしない」を次に置き換える:

  ```ts
  it('copilot のタブへ再実行して送れたときは、copilot の送り先で新しいエントリを記録する(エントリの種類は見ない)', async () => {
    const addHistoryEntry = vi.fn()
    const sendToAgent = vi.fn<(text: string, options: AgentSendOptions) => Promise<unknown>>(
      async () => undefined
    )
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        folderPath: '/repo',
        executePrompt: vi.fn(),
        addHistoryEntry,
        executionMode: 'agent-cli',
        sendToAgent,
        agentReferences: makeAgentReferencesState()
      })
    )
    await result.current.rerunHistoryEntry(agentEntry)
    sendToAgent.mock.calls[0][1].onSent?.(COPILOT_SENT_TO, 'copilot')
    expect(addHistoryEntry).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        promptId: 'p2',
        promptContent: '送った全文\n\n参照:\n- @src/app.ts',
        status: 'sent',
        agent: COPILOT_SENT_TO
      })
    )
  })
  ```

`src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts` の「送り先の種類を onSent に渡す(copilot の送り先は sentTo が null で、種類で記録を省くかを決める)」を次にする:

```ts
it('送り先の種類を onSent に渡す(copilot の送り先も、控えた送り先を渡す。段階 3a)', () => {
  const onSent = vi.fn()
  const sentTo = {
    claudeSessionId: '33333333-3333-4333-8333-333333333333',
    cliKind: 'copilot',
    tabLabel: 'copilot 1',
    folderPath: '/work'
  }
  notifyAgentSent({ kind: 'sent', clearedDraft: false, sentTo, cliKind: 'copilot' }, onSent)
  expect(onSent).toHaveBeenCalledExactlyOnceWith(sentTo, 'copilot')
})
```

`src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`:

- `const COPILOT_TEXT = …` の次に足す:

  ```ts
  const COPILOT_SENT_TO: AgentHistoryInfo = {
    claudeSessionId: '33333333-3333-4333-8333-333333333333',
    cliKind: 'copilot',
    tabLabel: 'copilot 1',
    folderPath: '/work'
  }
  ```

- 「表の copilot の手順を通り、貼り付けと \\r だけを書いて sent になり、結果に送り先の種類を載せる」の `describeSession: noSession,` を `describeSession: () => COPILOT_SENT_TO,` にし、期待を `expect(outcome).toEqual({ kind: 'sent', clearedDraft: false, sentTo: COPILOT_SENT_TO, cliKind: 'copilot' })` にする。テストの名前の末尾を `…結果に送り先(会話の ID と種類)と種類を載せる` にする

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `npx vitest run src/shared/__tests__/agentCliKinds.test.ts src/main/__tests__/agentCliLaunchSpecs.test.ts src/main/__tests__/agentCommand.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/agentCliLaunch.integration.test.ts src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: FAIL。能力の表（`sessionResume` が偽）、起動の表（`extraEnv` が無い・`copilot` は ID を受け取ると投げる）、環境変数（5 つ目の引数を見ない）、starter（`copilot` に ID を振らない）、受け口、統合テスト（引数が空）、注記（再開の名前が残る）、送れたときの記録（`copilot` の送り先が `null`）、workspace（`onSent` に `null`）が落ちる。`agentSessionStarter.capabilities.test.ts` は差し替えた表で今の実装と同じ挙動になるため、この時点で通ってよい（実装の後も通ることを Step 7 で確かめる）

- [ ] **Step 5: 起動の表と環境変数を書く**

`src/main/agentCliLaunchSpecs.ts`:

- import に `import { isClaudeSessionId } from '@shared/types'` を足す（値の import なので、今の `import type { AgentLaunchRequest } from '@shared/types'` とは別の行にする。型だけの import は `import type` のまま）
- 冒頭のコメントを次にする:

  ```ts
  // CLI の種類ごとの起動の表(設計書 2026-10-20「起動の表」、2026-10-23「起動の引数と環境変数」)。コマンドの名前・引数・追加で取り除く・
  // 足す環境変数は main だけが決め、renderer からは受け取らない(L-019)。引数に入れるのは、main が振った・記録と照合した会話の ID と
  // main が作った設定のファイルの絶対パスだけ(L-034)。能力の表(sessionResume・changeAttribution)に合わない値が渡ったら投げる
  // (呼び出し側の取り違えを黙って捨てない。L-044)
  ```

- `AgentCliLaunchSpec` の `extraRemovedEnvKeys` の次に足す:

  ```ts
  /** 取り除く一覧を適用した後に足す環境変数(利用者の環境の同じ名前を上書きする。Windows は大文字小文字だけ違う名前を取り除いてから足す)。
   *  名前は大文字で書く */
  extraEnv: Readonly<Record<string, string>>
  ```

- `buildCopilotArgs` を次にする:

  ```ts
  /**
   * copilot の起動の引数(GitHub Copilot CLI 1.0.87 の記録。段階 3a)。新しく起動するときは main が振った ID を --session-id で、
   * 再開は記録と照合した ID を --resume=<ID> の 1 つの引数で渡す(--resume は値を省ける形なので、2 つに分けると ID が値として
   * 読まれない恐れがある)。再開に --session-id は使わない(copilot 側に無い ID は黙って新しい会話になる)。作業ディレクトリは
   * pty の cwd で決め、-C・--allow-*・--yolo などは付けない(保存先への自動の移動は extraEnv で止める)
   */
  function buildCopilotArgs(
    launch: AgentLaunchRequest,
    claudeSessionId: string | null,
    hookSettingsPath: string | null
  ): string[] {
    if (claudeSessionId === null) throw new Error('copilot の起動には会話の ID が要ります')
    // copilot の --resume は大文字小文字を区別せず、前方一致・名前でも照合し、UUID でない値は新しいセッションに落ちるので、
    // 完全な小文字の UUID v4 だけを渡す(入り口の検証に加えた最後の守り。L-007・L-034)。例外の文言は spawn-failed の detail として
    // 画面に出るので、渡された値を入れない(L-017)
    if (!isClaudeSessionId(claudeSessionId)) {
      throw new Error('copilot の起動の会話の ID の形が正しくありません')
    }
    if (hookSettingsPath !== null)
      throw new Error('copilot の起動に hooks の設定のファイルは渡せません')
    switch (launch.kind) {
      case 'new':
        return ['--session-id', claudeSessionId]
      case 'resume':
        return [`--resume=${claudeSessionId}`]
      default:
        return throwUnknownLaunch(launch)
    }
  }
  ```

- `AGENT_CLI_LAUNCH_SPECS` を次にする:

  ```ts
  export const AGENT_CLI_LAUNCH_SPECS: Record<AgentCliKind, AgentCliLaunchSpec> = {
    claude: {
      commandName: AGENT_CLI_PROFILES.claude.commandName,
      extraRemovedEnvKeys: [],
      extraEnv: {},
      buildArgs: buildClaudeArgs
    },
    copilot: {
      commandName: AGENT_CLI_PROFILES.copilot.commandName,
      // アプリが起動した CLI の許可を自動で全部にしない(claude に --dangerously-skip-permissions を付けないのと同じ方針)
      extraRemovedEnvKeys: ['COPILOT_ALLOW_ALL'],
      // 再開したときに copilot の中の作業フォルダが保存先へ移るのを止める(許可のフォルダの外で動き出さない。-C と違い copilot の
      // 保存先〈workspace.yaml の cwd〉を書き換えない。設計書 2026-10-23「-C ではなく環境変数にした理由」)。new では効かないが、
      // 起動の計画を起動の指定に依存させないため常に足す
      extraEnv: { COPILOT_DISABLE_RESUME_AUTO_CD: '1' },
      buildArgs: buildCopilotArgs
    }
  }
  ```

`src/main/agentCommand.ts`:

- `buildAgentEnv` の上に足す:

  ```ts
  /**
   * 種類ごとの足す環境変数を env に入れる(利用者の環境の同じ名前を上書きする)。Windows は名前の大文字小文字を区別しないため、
   * 大文字小文字だけ違う同じ名前を取り除いてから足す(NO_PROXY の扱いと同じ)
   */
  function addExtraAgentEnv(
    env: Record<string, string>,
    extraEnv: Readonly<Record<string, string>>,
    platform: NodeJS.Platform
  ): void {
    for (const [name, value] of Object.entries(extraEnv)) {
      if (platform === 'win32') {
        for (const key of Object.keys(env)) {
          if (key.toUpperCase() === name.toUpperCase()) delete env[key]
        }
      }
      env[name] = value
    }
  }
  ```

- `buildAgentEnv` のコメントと引数と本体を次にする:

  ```ts
  /**
   * pty へ渡す環境変数(設計書「環境変数」)。base を写し、取り除く変数(すべての CLI の一覧と、種類ごとの追加の一覧)を除き、種類ごとの
   * 足す環境変数を入れ、PATH・TERM・COLORTERM・LANG を設定し、NO_PROXY・no_proxy にループバックを足す。platform と追加の一覧・足す
   * 環境変数は省略できない(L-060)
   */
  export function buildAgentEnv(
    base: NodeJS.ProcessEnv,
    pathValue: string,
    platform: NodeJS.Platform,
    extraRemovedKeys: readonly string[],
    extraEnv: Readonly<Record<string, string>>
  ): Record<string, string> {
    // (Windows の名前の扱い・写しのループは今のまま)
    // …今の for のループ…
    // 種類ごとの足す環境変数(copilot の COPILOT_DISABLE_RESUME_AUTO_CD)。取り除く一覧を適用した後に足す。PATH・TERM などは
    // この後に設定するので、表に同じ名前があっても上書きされる
    addExtraAgentEnv(env, extraEnv, platform)
    env.PATH = pathValue
    // (以降は今のまま)
  ```

  （今の `for` のループと `env.PATH = pathValue` 以降の行は変えない。`addExtraAgentEnv` の呼び出しを、ループの直後・`env.PATH` の直前に入れる）

- `resolveAgentLaunch` の `buildAgentEnv(env, pathValue, platform, spec.extraRemovedEnvKeys)` を `buildAgentEnv(env, pathValue, platform, spec.extraRemovedEnvKeys, spec.extraEnv)` にする

- [ ] **Step 6: 能力の表とコメントを直す**

`src/shared/agentCliKinds.ts`:

- `sessionResume` のコメントを `/** 前回の続きから・このセッションで再開・種類ごとの起動の記録(main の agentSessionRecordFileIo.ts の表)・会話の ID の予約 */` にする
- `copilot` の `sessionResume: false` を `sessionResume: true` にする

`src/main/agentSessionStarter.ts` の `spawnSession` の `// 会話の ID の選択・予約は再開に対応する種類(claude)だけ。copilot は ID を選ばず予約もしない(設計書「起動の手順」4)` を `// 会話の ID の選択・予約は能力の表で再開に対応する種類だけ(段階 3a で claude・copilot の両方。対応しない種類は ID を選ばず予約もしない)` にする。

`src/renderer/src/hooks/usePromptRunner.ts` の `recordAgentSent` の上のコメントを次にする（コードは変えない）:

```ts
// エージェント CLI 方式で送れたときの記録(結果の文章は記録しない)。送り先(sentTo)は送信の手順を始める時点に控えた値で、送り先の
// タブの種類を含む(段階 3a で copilot へ送ったプロンプトも記録する)。会話の ID を持たない種類(能力の表の sessionResume が偽。今の
// 表には無い)は送り先を控えられないのが常なので、黙って記録を省く。会話の ID を持つ種類で控えられなかった(ありえない想定)ときだけ
// ログに残す。記録が投げても呼び出し元(参照の後始末)を止めない
```

- [ ] **Step 7: テストと型検査が通ることを確かめる**

Run: `npx vitest run src/shared src/main src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts src/renderer/src/hooks/__tests__/useAgentResume.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`
Expected: PASS（統合テストは偽の `copilot` を実物の pty で 4 回起動するので数秒かかる）
Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 8: 実装を外すとテストが落ちることを確かめる（手で外して手で戻す）**

1. `buildCopilotArgs` の ``return [`--resume=${claudeSessionId}`]`` を `return ['--resume', claudeSessionId]` に書き換える → `npx vitest run src/main/__tests__/agentCliLaunchSpecs.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/agentCliLaunch.integration.test.ts` で、起動の表の「new は --session-id <ID>…resume は --resume=<ID>(1 つの要素)…」、starter の「copilot の resume は…--resume=<ID>(1 つの引数)」、統合テストが落ちる → 手で戻す
2. `isClaudeSessionId` の `if` を丸ごと消す → 起動の表のテストの「会話の ID が小文字の UUID v4 の完全な形でなければ」の 6 件が落ちる → 手で戻す
3. `addExtraAgentEnv(env, extraEnv, platform)` の行を消す → `npx vitest run src/main/__tests__/agentCommand.test.ts src/main/__tests__/agentCliLaunch.integration.test.ts` で、足す環境変数のテストと統合テスト（`autoCd` が `'0'`）が落ちる → 手で戻す
4. `addExtraAgentEnv` の `if (platform === 'win32') { … }` を丸ごと消す → `agentCommand.test.ts` の「win32 は大文字小文字だけ違う同じ名前を取り除いてから足す」が落ちる → 手で戻す

戻したことを `git diff src/main/agentCliLaunchSpecs.ts src/main/agentCommand.ts` で確かめ（Step 5 の差分だけが出る）、Step 7 のテストを流し直して PASS を確かめる。

- [ ] **Step 9: 全体の検証**

```bash
cd <repo-root>
npm run typecheck
set -- $(git status --porcelain | grep -v '^ D' | awk '{print $NF}' | grep -E '\.(ts|tsx)$')
echo "$#" "$@"
npx prettier --write "$@"
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
npx vitest run
```

Expected: どれも PASS（`npx vitest run` の時間切れは Global Constraints のとおり単体で流し直す）。統合テストを流した後に `pgrep -fl amt-test-` で、テストが起動したプロセスが残っていないことを確かめる（残っていたら `pgrep -fl amt-test-` の結果を報告に書き、その pid だけを `kill` する）

- [ ] **Step 10: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 4: 再開の入口と文言

> **設計書の読む節:** 「再開の入口（押せない理由）」（前回の続きから・このセッションで再開・履歴の `再実行`）、「文言」の `agentResumeLastAriaLabel`・`agentResumeEntryCliMismatch`・`agentResumeEntryUnknownCli`、「新しい状態と既存の入口」の「前回の続きから・このセッションで再開」「別のウィンドウでの CLI の切り替え」、「エラー処理」の `getLastSession` の行、「実装の分割」の 4、「テスト方針」の `agentResumeAvailability.test.ts`・`agentSessionMessages.test.ts`・`useAgentLastSession.test.ts`・`useAgentResume.test.ts`・配線。
>
> **気をつける知見:** L-037・L-040（「前回」の結果は取りに行ったフォルダと種類が今と同じときだけ使い、古い種類の結果を出さない。依頼と違う種類の結果は記録なしにする）・L-058（`このセッションで再開`・`前回の続きから` は押した時点に同じ理由を求め直す。今の `onResumeEntry`・`resumeLast` の作りのまま、理由の関数に種類を足す）・L-017（知らない種類の名前は、main が形を検証した履歴の値だけを文言に出す）・L-044（知らない種類のエントリを `claude` として再開しない）・L-060（配線のテストで、`copilot` の設定のときの依頼の種類とエントリの種類の理由を確かめる）

**Files:**

- Modify: `src/renderer/src/lib/agentSessionMessages.ts`・`src/renderer/src/lib/agentResumeAvailability.ts`・`src/renderer/src/hooks/useAgentLastSession.ts`・`src/renderer/src/hooks/useAgentResume.ts`（コメントだけ）・`src/renderer/src/components/agent/AgentTerminalPanel.tsx`
- Test（変更）: `src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`・`src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts`・`src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts`・`src/renderer/src/hooks/__tests__/useAgentResume.test.ts`・`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`・`src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`

**Interfaces:**

- Consumes: `knownAgentCliKindOf(info)`（Task 1）、`AgentLastSessionLookup` の `found` の `cliKind`・`UseAgentLastSessionOptions.cliKind`（Task 2）、`AGENT_CLI_PROFILES`（既存）
- Produces:

```ts
// src/renderer/src/lib/agentSessionMessages.ts(AGENT_RESUME_LAST_ARIA_LABEL は消す)
export function agentResumeLastAriaLabel(commandName: string): string
export function agentResumeEntryCliMismatch(
  entryCommandName: string,
  appCommandName: string
): string
export function agentResumeEntryUnknownCli(cliKind: string): string
```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`（import に `agentResumeLastAriaLabel`・`agentResumeEntryCliMismatch`・`agentResumeEntryUnknownCli` を足す）のファイルの末尾に足す:

```ts
describe('再開の入口の文言(CLI の種類。段階 3a)', () => {
  it('前回の続きからの aria-label は設定の種類のコマンド名で作り、claude では段階 3a より前と同じ文字列', () => {
    expect(agentResumeLastAriaLabel('claude')).toBe(
      '前回の続きから（このフォルダで最後に起動した claude のセッションを再開）'
    )
    expect(agentResumeLastAriaLabel('copilot')).toBe(
      '前回の続きから（このフォルダで最後に起動した copilot のセッションを再開）'
    )
  })

  it('エントリの種類と設定の種類が違うときの理由は、切り替えれば再開できる旨を出す', () => {
    expect(agentResumeEntryCliMismatch('claude', 'copilot')).toBe(
      'claude のセッションのため、copilot では再開できません（設定の「使うエージェント CLI」で claude に切り替えると再開できます）'
    )
    expect(agentResumeEntryCliMismatch('copilot', 'claude')).toBe(
      'copilot のセッションのため、claude では再開できません（設定の「使うエージェント CLI」で copilot に切り替えると再開できます）'
    )
  })

  it('知らない種類のエントリの理由は、種類の値をそのまま出す', () => {
    expect(agentResumeEntryUnknownCli('gemini')).toBe(
      'このアプリの版が知らないエージェント CLI（gemini）のセッションのため、再開できません'
    )
  })
})
```

`src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts`（import に `agentResumeEntryCliMismatch`・`agentResumeEntryUnknownCli` を足す）のファイルの末尾に足す:

```ts
describe('getResumeEntryDisabledReason: エントリの種類(段階 3a)', () => {
  const recordedOf = (cliKind: string): AgentHistoryInfo => ({
    claudeSessionId: ID,
    cliKind,
    tabLabel: `${cliKind} 1`,
    folderPath: '/work'
  })
  const base = {
    mode: 'agent-cli' as const,
    appCliKind: 'copilot' as const,
    folderPath: '/work',
    startDisabledReason: null,
    addDisabledReason: null,
    tabs: [tab()]
  }

  it('エントリの種類と設定の種類が同じ(copilot)なら押せる', () => {
    expect(getResumeEntryDisabledReason({ ...base, recorded: recordedOf('copilot') })).toBeNull()
  })

  it('エントリの種類と設定の種類が違えば、切り替えれば再開できる理由', () => {
    expect(getResumeEntryDisabledReason({ ...base, recorded: recordedOf('claude') })).toBe(
      agentResumeEntryCliMismatch('claude', 'copilot')
    )
    expect(
      getResumeEntryDisabledReason({
        ...base,
        appCliKind: 'claude',
        recorded: recordedOf('copilot')
      })
    ).toBe(agentResumeEntryCliMismatch('copilot', 'claude'))
  })

  it('知らない種類(gemini)のエントリは、その種類の名前を出す理由(設定の種類に依らない)', () => {
    for (const appCliKind of ['claude', 'copilot'] as const) {
      expect(
        getResumeEntryDisabledReason({ ...base, appCliKind, recorded: recordedOf('gemini') })
      ).toBe(agentResumeEntryUnknownCli('gemini'))
    }
  })

  it('種類の理由は、フォルダ・起動を受け付けない間・同じ ID のタブ・上限の理由より先(フォルダを開き直しても押せないため)', () => {
    const blocked = {
      ...base,
      folderPath: '/other',
      startDisabledReason: '実行方式を切り替えています',
      addDisabledReason: 'タブは 4 つまでです（使わないタブを閉じると追加できます）',
      tabs: [tab({ label: 'copilot 2', status: 'running', claudeSessionId: ID })]
    }
    expect(getResumeEntryDisabledReason({ ...blocked, recorded: recordedOf('gemini') })).toBe(
      agentResumeEntryUnknownCli('gemini')
    )
    expect(getResumeEntryDisabledReason({ ...blocked, recorded: recordedOf('claude') })).toBe(
      agentResumeEntryCliMismatch('claude', 'copilot')
    )
  })

  it('読み込み中・従来の方式・設定の種類が再開に対応しない理由は、種類の理由より先', () => {
    expect(
      getResumeEntryDisabledReason({ ...base, mode: null, recorded: recordedOf('gemini') })
    ).toBe('設定を読み込んでいます')
    expect(
      getResumeEntryDisabledReason({ ...base, mode: 'legacy', recorded: recordedOf('gemini') })
    ).toBe('エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）')
    capabilityOverrides.sessionResumeUnsupportedKinds.add('copilot')
    try {
      expect(getResumeEntryDisabledReason({ ...base, recorded: recordedOf('gemini') })).toBe(
        agentResumeEntryUnsupportedReason('copilot')
      )
    } finally {
      capabilityOverrides.sessionResumeUnsupportedKinds.clear()
    }
  })
})
```

（`AgentHistoryInfo` は `import type { AgentHistoryInfo, PromptExecutionMode } from '@shared/types'` として import に足す）

`src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts` の `describe('useAgentLastSession')` の中に足す:

```ts
it('種類が変わったら、新しい種類の結果が届くまで取得中に戻し、前の種類の結果を出さない(L-037)', async () => {
  mockGetLast.mockResolvedValueOnce({ cliKind: 'claude', claudeSessionId: A })
  const { result, rerender } = renderLast({
    folderPath: '/w',
    cliKind: 'claude',
    enabled: true,
    refreshKey: ''
  })
  await waitFor(() =>
    expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: A })
  )
  const pending = deferred<AgentLastSession | null>()
  mockGetLast.mockReturnValueOnce(pending.promise)
  rerender({ folderPath: '/w', cliKind: 'copilot', enabled: true, refreshKey: '' })
  expect(result.current).toEqual({ kind: 'loading' })
  await act(async () => {
    pending.resolve({ cliKind: 'copilot', claudeSessionId: B })
    await Promise.resolve()
  })
  expect(result.current).toEqual({ kind: 'found', cliKind: 'copilot', claudeSessionId: B })
})

it('種類を戻したときは、前に取った結果を出さず取り直す', async () => {
  mockGetLast.mockResolvedValueOnce({ cliKind: 'claude', claudeSessionId: A })
  const { result, rerender } = renderLast({
    folderPath: '/w',
    cliKind: 'claude',
    enabled: true,
    refreshKey: ''
  })
  await waitFor(() =>
    expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: A })
  )
  const back = deferred<AgentLastSession | null>()
  mockGetLast.mockReturnValueOnce(new Promise(() => undefined)).mockReturnValueOnce(back.promise)
  rerender({ folderPath: '/w', cliKind: 'copilot', enabled: true, refreshKey: '' })
  rerender({ folderPath: '/w', cliKind: 'claude', enabled: true, refreshKey: '' })
  expect(result.current).toEqual({ kind: 'loading' })
  await act(async () => {
    back.resolve({ cliKind: 'claude', claudeSessionId: B })
    await Promise.resolve()
  })
  expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: B })
})

it('依頼と違う種類の結果は記録なしとして扱い、ログに残す(起きない想定)', async () => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mockGetLast.mockResolvedValueOnce({ cliKind: 'claude', claudeSessionId: A })
  const { result } = renderLast({
    folderPath: '/w',
    cliKind: 'copilot',
    enabled: true,
    refreshKey: ''
  })
  await waitFor(() => expect(result.current).toEqual({ kind: 'none' }))
  expect(consoleErrorSpy).toHaveBeenCalled()
})
```

`src/renderer/src/hooks/__tests__/useAgentResume.test.ts`（import に `agentResumeEntryCliMismatch`・`agentResumeEntryUnknownCli` を足す）の `describe('このセッションで再開')` の中に足す:

```ts
it('設定と同じ種類(copilot)のエントリは押せて、押すとエントリの種類で新しいタブを足す', () => {
  const sessions = makeAgentSessionsState({ resumeInNewTab: vi.fn(() => 'slot-new') })
  const { result, options } = renderResume({ appCliKind: 'copilot', sessions })
  expect(result.current.resumeActionOf(agentEntryOf('copilot'))).toEqual({
    disabled: false,
    reason: null
  })
  act(() => result.current.onResumeEntry(agentEntryOf('copilot')))
  expect(sessions.resumeInNewTab).toHaveBeenCalledExactlyOnceWith(ID, 'copilot')
  expect(options.activateTab).toHaveBeenCalledWith('slot-new')
})

it('設定と違う種類のエントリは、切り替えれば再開できる理由を出し、押しても新しいタブを足さない', () => {
  const sessions = makeAgentSessionsState({ resumeInNewTab: vi.fn(() => 'slot-new') })
  const { result } = renderResume({ appCliKind: 'copilot', sessions })
  expect(result.current.resumeActionOf(agentEntryOf('claude'))).toEqual({
    disabled: true,
    reason: agentResumeEntryCliMismatch('claude', 'copilot')
  })
  act(() => result.current.onResumeEntry(agentEntryOf('claude')))
  expect(sessions.resumeInNewTab).not.toHaveBeenCalled()
})

it('知らない種類のエントリは、その種類の名前の理由を出す', () => {
  const { result } = renderResume()
  expect(result.current.resumeActionOf(agentEntryOf('gemini'))).toEqual({
    disabled: true,
    reason: agentResumeEntryUnknownCli('gemini')
  })
})
```

`describe('前回の続きから')` の中に足す:

```ts
it('設定が copilot なら、copilot の前回を取りに行き、押すと copilot の種類で再開する', () => {
  mockUseAgentLastSession.mockReturnValue({
    kind: 'found',
    cliKind: 'copilot',
    claudeSessionId: ID
  })
  const sessions = makeAgentSessionsState()
  const { result } = renderResume({ appCliKind: 'copilot', sessions })
  expect(mockUseAgentLastSession).toHaveBeenLastCalledWith(
    expect.objectContaining({ cliKind: 'copilot' })
  )
  expect(result.current.resumeLast.disabledReason).toBeNull()
  act(() => result.current.resumeLast.onResume('slot-1'))
  expect(sessions.start).toHaveBeenCalledWith('slot-1', {
    kind: 'resume',
    claudeSessionId: ID,
    cliKind: 'copilot'
  })
})
```

`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx` の `describe('AgentTerminalPanel: 前回の続きから')` の中に足す:

```ts
  it('名前は設定の種類のコマンド名(appCliKind)で作る', () => {
    render(
      <AgentTerminalPanel
        state={makeAgentTerminalPanelState({ sessions: makeSessions(), appCliKind: 'copilot' })}
      />
    )
    expect(
      screen.getByRole('button', {
        name: '前回の続きから（このフォルダで最後に起動した copilot のセッションを再開）'
      })
    ).toBeInTheDocument()
  })
```

`src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx` の `import { AGENT_RESUME_LAST_ARIA_LABEL } from '../../lib/agentSessionMessages'` を `import { agentResumeLastAriaLabel } from '../../lib/agentSessionMessages'` にし、`AGENT_RESUME_LAST_ARIA_LABEL` の 2 か所を `agentResumeLastAriaLabel('claude')` にする。

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` の「使う CLI の配線(本物の useAgentSessions。L-060)」の describe の中に足す（import の `agentSessionMessages` の並びに `agentResumeEntryCliMismatch` を足す）:

```ts
it('設定が copilot なら、前回の続きからは copilot の前回を取りに行き、押すと copilot の種類で再開を依頼する(本物の useAgentSessions まで)', async () => {
  setCliKind('copilot')
  mockUseAgentLastSession.mockReturnValue({
    kind: 'found',
    cliKind: 'copilot',
    claudeSessionId: COPILOT_ID
  })
  startSpy = vi.spyOn(window.api, 'startAgentSession').mockResolvedValue({
    kind: 'started',
    sessionId: 'sid-cli',
    cliKind: 'copilot',
    claudeSessionId: COPILOT_ID
  })
  const { result } = renderWorkspace({ folderPath: '/p' })
  expect(mockUseAgentLastSession).toHaveBeenLastCalledWith(
    expect.objectContaining({ folderPath: '/p', cliKind: 'copilot' })
  )
  expect(result.current.agentTerminal.resumeLast.disabledReason).toBeNull()
  await act(async () => {
    result.current.agentTerminal.resumeLast.onResume(slotId)
  })
  expect(startSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      slotId,
      launch: { kind: 'resume', claudeSessionId: COPILOT_ID, cliKind: 'copilot' }
    })
  )
})

it('設定が copilot なら、履歴の claude のエントリの このセッションで再開 は、切り替えれば再開できる理由で押せない', () => {
  setCliKind('copilot')
  const { result } = renderWorkspace({ folderPath: '/p' })
  expect(result.current.getHistoryActions(agentEntry).resume).toEqual({
    disabled: true,
    reason: agentResumeEntryCliMismatch('claude', 'copilot')
  })
})
```

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts src/renderer/src/hooks/__tests__/useAgentResume.test.ts src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: FAIL。文言の関数が無い（import で落ちる）、種類の理由が無い（押せてしまう）、種類を変えた直後に前の種類の結果が出る、依頼と違う種類の結果が見つかった扱いになる、aria-label が `claude` のまま、が落ちる。`App.agentSessionResume.test.tsx` は import の名前が無くて落ちる

- [ ] **Step 3: 文言を書く**

`src/renderer/src/lib/agentSessionMessages.ts`:

- `AGENT_RESUME_LAST_LABEL` のコメントを `/** ターミナルのタブの「前回の続きから」(このフォルダで最後に起動が確定した、設定の種類のセッションを再開する) */` にする
- `AGENT_RESUME_LAST_ARIA_LABEL` の定数（コメントを含む）を消し、次を置く:

  ```ts
  /** 帯の 前回の続きから の aria-label。可視の文言「前回の続きから」で始める(パターン 76)。commandName は設定の種類のコマンド名
   *  (claude では段階 3a より前と同じ文字列) */
  export function agentResumeLastAriaLabel(commandName: string): string {
    return `前回の続きから（このフォルダで最後に起動した ${commandName} のセッションを再開）`
  }
  ```

- `AGENT_RESUME_ENTRY_LABEL` のコメントを `/** 実行の履歴の詳細の「このセッションで再開」(新しいタブを開いて、エントリのセッションを再開する) */` にする
- `agentResumeEntryUnsupportedReason` の次に足す:

  ```ts
  /** 履歴の このセッションで再開 の押せない理由(エントリの種類と設定の種類が違う。設定を切り替えると再開できる) */
  export function agentResumeEntryCliMismatch(
    entryCommandName: string,
    appCommandName: string
  ): string {
    return `${entryCommandName} のセッションのため、${appCommandName} では再開できません（設定の「使うエージェント CLI」で ${entryCommandName} に切り替えると再開できます）`
  }
  /** 履歴の このセッションで再開 の押せない理由(エントリの種類をこの版が知らない)。cliKind は main が形を検証した履歴の値(L-017) */
  export function agentResumeEntryUnknownCli(cliKind: string): string {
    return `このアプリの版が知らないエージェント CLI（${cliKind}）のセッションのため、再開できません`
  }
  ```

- [ ] **Step 4: 押せない理由・「前回」の照らし合わせ・aria-label を直す**

`src/renderer/src/lib/agentResumeAvailability.ts`:

- import に足す:

  ```ts
  import { knownAgentCliKindOf } from '@shared/historyAgentCliKind'
  ```

  `./agentSessionMessages` の import の並びに `agentResumeEntryCliMismatch`・`agentResumeEntryUnknownCli` を足す

- 冒頭のコメントの「claude のセッションの再開の入口」を「エージェント CLI のセッションの再開の入口」にし、末尾に `再開できるのは設定と同じ種類のセッションだけ(段階 3a の設計書「決めたこと(推奨案)」)。` を足す
- `getResumeEntryDisabledReason` のコメントを次にする:

  ```ts
  /**
   * 「このセッションで再開」の押せない理由(上から順に、最初に当たったものを 1 つ)。実行方式の読み込み中 → エージェント CLI 方式でない →
   * 設定の CLI が再開に対応していない → エントリの種類をこの版が知らない → エントリの種類と設定の種類が違う → 記録したフォルダを
   * 開いていない(isSamePath。Windows は大文字小文字を区別しない) → 起動を受け付けない間 → 同じ ID のタブが起動中・実行中 →
   * タブが上限(+ と同じ。L-048)。種類の理由をフォルダの理由より前に置くのは、フォルダを開き直しても押せないため。押せるなら null
   */
  ```

- 設定の種類の `if` の直後（`folderPath === null || !isSamePath(…)` の前）に足す:

  ```ts
  // エントリの種類(この版が知らない種類・設定と違う種類)。再開は設定と同じ種類だけ(起動の種類は main が読む設定で決まるため)
  const entryCliKind = knownAgentCliKindOf(recorded)
  if (entryCliKind === null) return agentResumeEntryUnknownCli(recorded.cliKind)
  if (entryCliKind !== appCliKind) {
    return agentResumeEntryCliMismatch(
      AGENT_CLI_PROFILES[entryCliKind].commandName,
      AGENT_CLI_PROFILES[appCliKind].commandName
    )
  }
  ```

`src/renderer/src/hooks/useAgentLastSession.ts`:

- 冒頭のコメントの最後の文を `フォルダ・種類が変わったとき・取り直しの契機(起動の確定の回数)が変わったときに取り直し、最新の依頼でない結果・依頼の後にフォルダ・種類が変わった結果・依頼と違う種類の結果は捨てる(L-037・L-040)` にする
- import に `import type { AgentCliKind } from '@shared/agentCliKinds'` があることを確かめる（Task 2 で足した）
- `ResolvedLastSession` に `cliKind` を足す:

  ```ts
  interface ResolvedLastSession {
    /** 取りに行ったフォルダ */
    folderPath: string
    /** 取りに行った種類 */
    cliKind: AgentCliKind
    lookup: AgentLastSessionLookup
  }
  ```

- `useOnChange(enabled, clearResolved)` の次に `useOnChange(cliKind, clearResolved)` を足し、直前のコメントを `// フォルダ・種類・方式が変わったら、前に取った結果を捨てる(ほかのフォルダ・種類から戻ったときに古い結果を出さない)` にする
- effect の最初の `.then` を次にする:

  ```ts
        .then((last): AgentLastSessionLookup => {
          if (last === null) return NONE
          // 依頼と違う種類の結果は記録なしとして扱う(起きない想定。main は依頼の種類の記録だけを返す。L-037)
          if (last.cliKind !== cliKind) {
            console.error('[useAgentLastSession] 依頼と違う種類の前回が返りました:', last.cliKind)
            return NONE
          }
          return { kind: 'found', cliKind: last.cliKind, claudeSessionId: last.claudeSessionId }
        })
  ```

- 最後の `.then` の `setResolved({ folderPath, lookup })` を `setResolved({ folderPath, cliKind, lookup })` にする
- 戻り値の行とコメントを次にする:

  ```ts
  // 同じフォルダ・種類の取り直しの間は前の結果を出し続ける(起動のたびに理由がちらつかないように)。フォルダか種類が変わったら、
  // そのフォルダと種類の結果が届くまで取得中
  return resolved !== null && resolved.folderPath === folderPath && resolved.cliKind === cliKind
    ? resolved.lookup
    : LOADING
  ```

`src/renderer/src/hooks/useAgentResume.ts` の冒頭のコメントの「claude のセッションの再開の入口」を「エージェント CLI のセッションの再開の入口」にする（コードは変えない）。

`src/renderer/src/components/agent/AgentTerminalPanel.tsx`:

- import の `AGENT_RESUME_LAST_ARIA_LABEL,` を消し、`agentStartAriaLabel,` の次に `agentResumeLastAriaLabel,` を足す
- `aria-label={AGENT_RESUME_LAST_ARIA_LABEL}` を `aria-label={agentResumeLastAriaLabel(AGENT_CLI_PROFILES[appCliKind].commandName)}` にする（`起動` の `aria-label` と同じ引き方）

- [ ] **Step 5: テストと型検査が通ることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts src/renderer/src/hooks/__tests__/useAgentResume.test.ts src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS（`grep -rn "AGENT_RESUME_LAST_ARIA_LABEL" src` が何も出さないことも確かめる）

- [ ] **Step 6: 実装を外すとテストが落ちることを確かめる（手で外して手で戻す）**

1. `getResumeEntryDisabledReason` の `if (entryCliKind !== appCliKind) { … }` を丸ごと消す → `npx vitest run src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts src/renderer/src/hooks/__tests__/useAgentResume.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` で、違う種類の理由のテストと配線の「履歴の claude のエントリの このセッションで再開 は…」が落ちる → 手で戻す
2. `useAgentLastSession` の戻り値の `&& resolved.cliKind === cliKind` と `useOnChange(cliKind, clearResolved)` の 2 つを消す → `npx vitest run src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts` で「種類が変わったら、新しい種類の結果が届くまで取得中に戻し…」が落ちる → 手で戻す
3. 依頼と違う種類の `if (last.cliKind !== cliKind) { … }` を消す → 同じテストの「依頼と違う種類の結果は記録なしとして扱い…」が落ちる → 手で戻す

戻したことを `git diff src/renderer/src/lib/agentResumeAvailability.ts src/renderer/src/hooks/useAgentLastSession.ts` で確かめ（Step 4 の差分と Task 2 の差分だけが出る）、Step 5 のテストを流し直して PASS を確かめる。

- [ ] **Step 7: 全体の検証**

```bash
cd <repo-root>
npm run typecheck
set -- $(git status --porcelain | grep -v '^ D' | awk '{print $NF}' | grep -E '\.(ts|tsx)$')
echo "$#" "$@"
npx prettier --write "$@"
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
npx vitest run
```

Expected: どれも PASS（`npx vitest run` の時間切れは Global Constraints のとおり単体で流し直す）

- [ ] **Step 8: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 5: 再開の失敗

> **設計書の読む節:** 「再開の失敗の見分け方と伝え方」、「決めたこと（推奨案）」の「再開の失敗の見分け方」「何も送らずに閉じた copilot のセッション」、「文言」の `AGENT_RESUME_FAILURE_NOTES.copilot`、「新しい状態と既存の入口（L-061）」、「構成」の最後の段落（活動を見たかの配線）、「実装の分割」の 5、「テスト方針」の `agentSessionTabState.test.ts`・`useAgentSessions.test.ts`・配線。
>
> **気をつける知見:** L-001（`started` を再開できた印にせず、終了の事実〈終了コード・活動〉から伝える）・L-002・L-006（終了コード 1 だけを根拠に起動の記録を消さない。このタスクは記録に触れない）・L-017（文言は固定の文で、`copilot` の出力〈`Error: No session, task, or name matched …`〉を写さない）・L-060（再開の失敗の文言は `Record<AgentCliKind, string | null>` の表にし、活動を見たかの受け渡しは配線のテストと変異の確認で外れを捕まえる）・L-061（新しい状態「タブの起動の指定と活動を見たか」に対して、起動・再開・合わせ込み・閉じる・起動し直しの入口を確かめる）

**Files:**

- Modify: `src/renderer/src/lib/agentSessionTabState.ts`・`src/renderer/src/lib/agentSessionMessages.ts`・`src/renderer/src/hooks/useAgentSessions.ts`・`src/renderer/src/hooks/useAgentWorkspace.ts`
- Modify（テストの補助）: `src/renderer/src/__tests__/makeAgentSessionsState.ts`
- Test（変更）: `src/renderer/src/lib/__tests__/agentSessionTabState.test.ts`・`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`・`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`

**Interfaces:**

- Consumes: `AgentLaunchRequest`（Task 2）、`AGENT_EXITED_SOON_NOTE`・`isAgentExitedSoon`（既存）、`useAgentActivity` の戻り値 `ReadonlyMap<string, AgentActivity>`（既存）
- Produces:

```ts
// src/renderer/src/lib/agentSessionTabState.ts
export function isAgentResumeFailure(input: {
  launchKind: AgentLaunchRequest['kind']
  exit: Pick<AgentSessionExit, 'exitCode' | 'reason'>
  sawScreenActivity: boolean
}): boolean

// src/renderer/src/lib/agentSessionMessages.ts
export const AGENT_RESUME_FAILURE_NOTES: Record<AgentCliKind, string | null>

// src/renderer/src/hooks/useAgentSessions.ts
export interface AgentSessionsState {
  // …今の値…
  /** そのタブの今の起動で、画面の活動が unknown 以外になったことを控える(useAgentWorkspace が活動から呼ぶ) */
  noteScreenActivity: (slotId: string) => void
}
```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentSessionTabState.test.ts`（import に `isAgentResumeFailure` を足す）のファイルの末尾に足す:

```ts
describe('isAgentResumeFailure(再開の失敗の見分け)', () => {
  const failure = {
    launchKind: 'resume' as const,
    exit: { exitCode: 1, reason: 'exited' as const },
    sawScreenActivity: false
  }

  it('再開で起動し、画面の活動を見ないまま、エージェント自身が 0 以外で終わったら真(終了コードが分からない null も含む)', () => {
    expect(isAgentResumeFailure(failure)).toBe(true)
    expect(isAgentResumeFailure({ ...failure, exit: { exitCode: null, reason: 'exited' } })).toBe(
      true
    )
  })

  it.each<[string, Partial<Parameters<typeof isAgentResumeFailure>[0]>]>([
    ['新しい起動', { launchKind: 'new' }],
    ['止めた終了(stopped)', { exit: { exitCode: 1, reason: 'stopped' } }],
    ['フォルダの切り替え', { exit: { exitCode: 1, reason: 'folder-changed' } }],
    ['終了コード 0', { exit: { exitCode: 0, reason: 'exited' } }],
    ['活動を見た後', { sawScreenActivity: true }]
  ])('%s なら偽', (_label, override) => {
    expect(isAgentResumeFailure({ ...failure, ...override })).toBe(false)
  })
})
```

`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`（import に `AGENT_RESUME_FAILURE_NOTES` を足す）の末尾に足す:

```ts
describe('再開の失敗の文言(種類ごとの表。段階 3a)', () => {
  it('claude は出さない(今の「起動の直後に終了しました」のまま)、copilot は何も送らずに閉じたセッションを案内する', () => {
    expect(AGENT_RESUME_FAILURE_NOTES).toEqual({
      claude: null,
      copilot:
        'copilot がセッションを再開できずに終了しました。ターミナルの表示を確かめてください（何も送らずに閉じたセッションは、copilot が保存しないため再開できません）'
    })
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`（import の `agentSessionMessages` の並びに `AGENT_EXITED_SOON_NOTE`・`AGENT_RESUME_FAILURE_NOTES` を足す）のファイルの末尾に足す:

```ts
describe('useAgentSessions — 再開の失敗(起動の控えと活動。段階 3a)', () => {
  const COPILOT_NOTE = AGENT_RESUME_FAILURE_NOTES.copilot
  const startedAs = (cliKind: AgentCliKind, sessionId = 's1'): AgentStartResult => ({
    kind: 'started',
    sessionId,
    cliKind,
    claudeSessionId: CSID
  })
  const exitWith = (exitCode: number, sessionId = 's1'): AgentSessionExit => ({
    sessionId,
    exitCode,
    signal: null,
    reason: 'exited'
  })

  it('copilot のタブを再開で起動し、活動を見ないまま終了コード 1 で終わると copilot の文言を出す(起動の直後の文言より優先)', async () => {
    mockStart.mockResolvedValueOnce(startedAs('copilot'))
    const { result } = render({ appCliKind: 'copilot' })
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID, 'copilot'))
    })
    act(() => emitExit(exitWith(1)))
    expect(tabOf(result.current, 'slot-1').error).toBe(COPILOT_NOTE)
  })

  it('時間では見ない(起動から 2 秒を超えて終わっても、活動を見ていなければ copilot の文言)', async () => {
    mockStart.mockResolvedValueOnce(startedAs('copilot'))
    const { result } = render({ appCliKind: 'copilot' })
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID, 'copilot'))
    })
    now = 10_000
    act(() => emitExit(exitWith(1)))
    expect(tabOf(result.current, 'slot-1').error).toBe(COPILOT_NOTE)
  })

  it('活動を見た後(noteScreenActivity)なら、今までどおり起動の直後の文言', async () => {
    mockStart.mockResolvedValueOnce(startedAs('copilot'))
    const { result } = render({ appCliKind: 'copilot' })
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID, 'copilot'))
    })
    act(() => result.current.noteScreenActivity('slot-1'))
    act(() => emitExit(exitWith(1)))
    expect(tabOf(result.current, 'slot-1').error).toBe(AGENT_EXITED_SOON_NOTE)
  })

  it('claude のタブの再開の失敗は、今までどおり起動の直後の文言(claude の文言は表で null)', async () => {
    mockStart.mockResolvedValueOnce(startedAs('claude'))
    const { result } = render()
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID))
    })
    act(() => emitExit(exitWith(1)))
    expect(tabOf(result.current, 'slot-1').error).toBe(AGENT_EXITED_SOON_NOTE)
  })

  it('copilot の新しい起動(new)の終了コード 1 は、今までどおり起動の直後の文言', async () => {
    mockStart.mockResolvedValueOnce(startedAs('copilot'))
    const { result } = render({ appCliKind: 'copilot' })
    await act(async () => {
      await result.current.start('slot-1', NEW)
    })
    act(() => emitExit(exitWith(1)))
    expect(tabOf(result.current, 'slot-1').error).toBe(AGENT_EXITED_SOON_NOTE)
  })

  it('再開の後の終了コード 0 と、止めた終了(stopped)は文言を出さない', async () => {
    mockStart
      .mockResolvedValueOnce(startedAs('copilot'))
      .mockResolvedValueOnce(startedAs('copilot', 's2'))
    const { result } = render({ appCliKind: 'copilot' })
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID, 'copilot'))
    })
    act(() => emitExit(exitWith(0)))
    expect(tabOf(result.current, 'slot-1').error).toBeNull()
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID, 'copilot'))
    })
    act(() => emitExit({ sessionId: 's2', exitCode: 1, signal: null, reason: 'stopped' }))
    expect(tabOf(result.current, 'slot-1').error).toBeNull()
  })

  it('前の起動で見た活動は、起動し直すと戻す(次の再開の失敗は copilot の文言)', async () => {
    mockStart
      .mockResolvedValueOnce(startedAs('copilot'))
      .mockResolvedValueOnce(startedAs('copilot', 's2'))
    const { result } = render({ appCliKind: 'copilot' })
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID, 'copilot'))
    })
    act(() => result.current.noteScreenActivity('slot-1'))
    act(() => emitExit(exitWith(0)))
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID, 'copilot'))
    })
    act(() => emitExit(exitWith(1, 's2')))
    expect(tabOf(result.current, 'slot-1').error).toBe(COPILOT_NOTE)
  })

  it('起動の結果より先に届いた終了(起動中に溜めた終了)でも、再開の失敗なら copilot の文言', async () => {
    let resolveStart: (result: AgentStartResult) => void = () => undefined
    mockStart.mockReturnValueOnce(
      new Promise<AgentStartResult>((resolve) => {
        resolveStart = resolve
      })
    )
    const { result } = render({ appCliKind: 'copilot' })
    let started: Promise<void> = Promise.resolve()
    act(() => {
      started = result.current.start('slot-1', resumeOf(CSID, 'copilot'))
    })
    act(() => emitExit(exitWith(1)))
    await act(async () => {
      resolveStart(startedAs('copilot'))
      await started
    })
    expect(tabOf(result.current, 'slot-1')).toMatchObject({ status: 'exited', error: COPILOT_NOTE })
  })

  it('作り直しの後に合わせ込んだタブは、起動の指定が分からないので new として扱う(copilot の文言を出さない)', async () => {
    mockGetState.mockResolvedValueOnce([
      { slotId: 'slot-1', sessionId: 's-9', cliKind: 'copilot', claudeSessionId: CSID }
    ])
    const { result } = render({ appCliKind: 'copilot' })
    await waitFor(() => expect(result.current.selected.status).toBe('running'))
    act(() => emitExit(exitWith(1, 's-9')))
    expect(tabOf(result.current, 'slot-1').error).not.toBe(COPILOT_NOTE)
  })

  it('noteScreenActivity は描画をまたいで同じ参照(活動の effect を作り直さない)', () => {
    const { result, rerender } = render()
    const first = result.current.noteScreenActivity
    rerender()
    expect(result.current.noteScreenActivity).toBe(first)
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`:

- `describe('組み立て')` の中に足す（偽の sessions で、活動が `unknown` 以外のタブだけを控えることを確かめる）:

  ```ts
  it('活動が unknown 以外のタブだけを sessions.noteScreenActivity に渡す(再開の失敗の見分け)', () => {
    setMode('agent-cli')
    const sessions = makeAgentSessionsState()
    mockUseAgentSessions.mockReturnValue(sessions)
    mockUseAgentActivity.mockReturnValue(
      new Map<string, AgentActivity>([
        ['slot-1', 'unknown'],
        ['slot-2', 'idle'],
        ['slot-3', 'confirm']
      ])
    )
    renderWorkspace({ folderPath: '/p' })
    expect(vi.mocked(sessions.noteScreenActivity).mock.calls).toEqual([['slot-2'], ['slot-3']])
  })
  ```

- 「copilot の配線(本物の useAgentSessions・useAgentActivity・…)」の describe:
  - `let stopSpy …` の次に足す:

    ```ts
    let exitSpy: MockInstance<typeof window.api.onAgentExit> | null = null
    // 終了の購読者(本物の useAgentSessions が張る)。テストから終了を流す
    let exitListeners: Set<(exit: AgentSessionExit) => void>
    const emitAgentExit = (exit: AgentSessionExit): void =>
      exitListeners.forEach((listener) => listener(exit))
    ```

  - `beforeEach` の最後に足す:

    ```ts
    exitListeners = new Set()
    exitSpy = vi.spyOn(window.api, 'onAgentExit').mockImplementation((listener) => {
      exitListeners.add(listener)
      return () => {
        exitListeners.delete(listener)
      }
    })
    ```

  - `afterEach` の `stopSpy = null` の次に `exitSpy?.mockRestore()` と `exitSpy = null` を足す
  - describe の中に足す（import に `AGENT_RESUME_FAILURE_NOTES`（`agentSessionMessages`）と `import type { AgentSessionExit } from '@shared/types'` を足す）:

    ```ts
    it('再開で起動した copilot のタブが、画面の活動を見ないまま終了コード 1 で終わると copilot の文言を出し、活動を見た後なら出さない(活動の受け渡しの配線。L-060)', async () => {
      const { result } = renderWorkspace({ folderPath: '/p' })
      // 1 回目: 画面に何も無い(判定は unknown)うちに終わる。running に入ると useAgentActivity が 150ms 後に画面を判定するので、
      // 作業中の画面のままにしない
      if (controller !== null) controller.screen = []
      await act(async () => {
        await result.current.agentTerminal.sessions.start(slotId, {
          kind: 'resume',
          claudeSessionId: COPILOT_ID,
          cliKind: 'copilot'
        })
      })
      act(() =>
        emitAgentExit({ sessionId: 'sid-copilot', exitCode: 1, signal: null, reason: 'exited' })
      )
      expect(result.current.agentTerminal.sessions.selected.error).toBe(
        AGENT_RESUME_FAILURE_NOTES.copilot
      )
      // 2 回目: 作業中の画面を判定してから終わる(本物の useAgentActivity → useAgentWorkspace → useAgentSessions)
      if (controller !== null) controller.screen = copilotScreen('working3000').lines
      await act(async () => {
        await result.current.agentTerminal.sessions.start(slotId, {
          kind: 'resume',
          claudeSessionId: COPILOT_ID,
          cliKind: 'copilot'
        })
      })
      act(() => controller?.emitOutputWritten())
      await waitFor(() =>
        expect(result.current.agentTerminal.activities.get(slotId)).toBe('working')
      )
      act(() =>
        emitAgentExit({ sessionId: 'sid-copilot', exitCode: 1, signal: null, reason: 'exited' })
      )
      expect(result.current.agentTerminal.sessions.selected.status).toBe('exited')
      expect(result.current.agentTerminal.sessions.selected.error).not.toBe(
        AGENT_RESUME_FAILURE_NOTES.copilot
      )
    })
    ```

`src/renderer/src/__tests__/makeAgentSessionsState.ts` の `makeAgentSessionsState` の戻り値の `startConfirmedCount: 0,` の次に `noteScreenActivity: vi.fn<AgentSessionsState['noteScreenActivity']>(),` を足す（このファイルは Step 3 の実装の型に合わせるための補助。テストの一部として先に直す）。

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentSessionTabState.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: FAIL。`isAgentResumeFailure`・`AGENT_RESUME_FAILURE_NOTES` が無い（import で落ちる）、`noteScreenActivity` が無い、再開の失敗で `copilot` の文言が出ない、workspace が `noteScreenActivity` を呼ばない、が落ちる

- [ ] **Step 3: 判定と文言を書く**

`src/renderer/src/lib/agentSessionTabState.ts`:

- import を次にする:

  ```ts
  import type { AgentCliKind } from '@shared/agentCliKinds'
  import type { AgentExitReason, AgentLaunchRequest, AgentSessionExit } from '@shared/types'
  ```

- `isAgentExitedSoon` の次に足す:

  ```ts
  /**
   * 再開の失敗か(設計書 2026-10-23「再開の失敗の見分け方と伝え方」)。再開(resume)で起動したタブが、画面の活動を一度も見ないまま
   * (起動の後に活動が unknown 以外にならなかった)、エージェント自身の終了(exited)で 0 以外(null を含む)で終わったときだけ真。
   * 時間では見ない(初回の起動は遅いことがある)。文言を出すかは種類ごとの表(AGENT_RESUME_FAILURE_NOTES)で決める
   */
  export function isAgentResumeFailure({
    launchKind,
    exit,
    sawScreenActivity
  }: {
    launchKind: AgentLaunchRequest['kind']
    exit: Pick<AgentSessionExit, 'exitCode' | 'reason'>
    sawScreenActivity: boolean
  }): boolean {
    return (
      launchKind === 'resume' &&
      exit.reason === 'exited' &&
      exit.exitCode !== 0 &&
      !sawScreenActivity
    )
  }
  ```

`src/renderer/src/lib/agentSessionMessages.ts`:

- import の `AGENT_CLI_PROFILES, DEFAULT_AGENT_CLI_COMMAND_NAME` に、型の import `import type { AgentCliKind } from '@shared/agentCliKinds'` を足す
- `AGENT_EXITED_SOON_NOTE` の次に足す:

  ```ts
  /**
   * 再開の失敗(isAgentResumeFailure)の文言。種類ごとの表で、claude は今の「起動の直後に終了しました」のまま(null)。copilot は
   * 何も送らずに閉じたセッションを --resume で開けない(GitHub Copilot CLI 1.0.87 の記録の 5f)。原因を言い切らず、copilot の出力は写さずに
   * ターミナルの表示を見るよう案内する(L-017)。起動の記録は消さない(終了コード 1 には別の原因もある。L-002)
   */
  export const AGENT_RESUME_FAILURE_NOTES: Record<AgentCliKind, string | null> = {
    claude: null,
    copilot: `${AGENT_CLI_PROFILES.copilot.commandName} がセッションを再開できずに終了しました。ターミナルの表示を確かめてください（何も送らずに閉じたセッションは、${AGENT_CLI_PROFILES.copilot.commandName} が保存しないため再開できません）`
  }
  ```

- [ ] **Step 4: 起動の控えと活動の配線を書く**

`src/renderer/src/hooks/useAgentSessions.ts`:

- import の `agentSessionMessages` の並びに `AGENT_RESUME_FAILURE_NOTES` を、`agentSessionTabState` の並びに `isAgentResumeFailure` を足す
- `AgentSessionsState` の `startConfirmedCount` の次に足す:

  ```ts
    /** そのタブの今の起動で、画面の活動が unknown 以外になったことを控える(再開の失敗の見分け。useAgentWorkspace が活動から呼ぶ)。
     *  起動し直すと控えは戻る。描画をまたいで同じ参照 */
    noteScreenActivity: (slotId: string) => void
  ```

- フックの本体の、`startedAtRef` の定義の次に足す:

  ```ts
  // タブごとの今の起動の控え(起動の指定と、画面の活動を一度でも見たか)。再開の失敗の見分け(isAgentResumeFailure)だけに使う。
  // start で作り直し、状態の取得で合わせ込んだタブは起動の指定が分からないので new として控える(再開の失敗の文言を出さない側に倒す)
  const launchWatchBySlotRef = useRef(
    new Map<string, { launchKind: AgentLaunchRequest['kind']; sawScreenActivity: boolean }>()
  )
  ```

- `forgetTab` の `startedAtRef.current.delete(slotId)` の次に `launchWatchBySlotRef.current.delete(slotId)` を足す
- `applyExit` を次にする:

  ```ts
  const applyExit = useCallback(
    (slotId: string, event: AgentSessionExit): void => {
      const exitedSoon = isAgentExitedSoon(event, startedAtRef.current.get(slotId), now())
      // 再開の失敗(活動を見ないまま 0 以外で終わった再開)は、種類ごとの文言を起動の直後の文言より優先する(claude は null で今のまま)
      const watch = launchWatchBySlotRef.current.get(slotId)
      const resumeFailureNote =
        watch !== undefined &&
        isAgentResumeFailure({
          launchKind: watch.launchKind,
          exit: event,
          sawScreenActivity: watch.sawScreenActivity
        })
          ? AGENT_RESUME_FAILURE_NOTES[cliKindOf(slotId)]
          : null
      const note = resumeFailureNote ?? (exitedSoon ? AGENT_EXITED_SOON_NOTE : null)
      adoptSession(slotId, null)
      setTabClaudeSessionId(slotId, null)
      patchTab(slotId, {
        exit: { exitCode: event.exitCode, reason: event.reason },
        status: 'exited',
        ...(note !== null ? { error: note } : {})
      })
    },
    [adoptSession, setTabClaudeSessionId, patchTab, now, cliKindOf]
  )
  ```

- `applyExit` の次に足す:

  ```ts
  const noteScreenActivity = useCallback((slotId: string): void => {
    const watch = launchWatchBySlotRef.current.get(slotId)
    if (watch !== undefined) watch.sawScreenActivity = true
  }, [])
  ```

- 作り直しの後の合わせ込みの `adoptSession(tab.slotId, entry.sessionId)` の次に `launchWatchBySlotRef.current.set(tab.slotId, { launchKind: 'new', sawScreenActivity: false })` を足す
- `start` の `const endStarting = beginStarting(slotId)` の次に足す:

  ```ts
  // 今の起動の控えを作り直す(前の起動で見た活動を持ち越さない)
  launchWatchBySlotRef.current.set(slotId, { launchKind: launch.kind, sawScreenActivity: false })
  ```

- 戻り値の `startConfirmedCount` の次に `noteScreenActivity` を足す

`src/renderer/src/hooks/useAgentWorkspace.ts` の `useAgentHooksWorkingReport({ tabs: agentSessions.tabs, activities })` の次に足す:

```ts
// 再開の失敗の見分け(設計書 2026-10-23「再開の失敗の見分け方と伝え方」): 活動が unknown 以外になったタブを、そのタブの今の起動に控える。
// 活動は useAgentSessions の後で判定するため、effect で渡す(noteScreenActivity は参照が安定)
const { noteScreenActivity } = agentSessions
useEffect(() => {
  for (const [slotId, activity] of activities) {
    if (activity !== 'unknown') noteScreenActivity(slotId)
  }
}, [activities, noteScreenActivity])
```

- [ ] **Step 5: テストと型検査が通ることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentSessionTabState.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS（`AgentSessionsState` を作るほかの偽物があれば型エラーになるので、`noteScreenActivity` を足す）

- [ ] **Step 6: 実装を外すとテストが落ちることを確かめる（手で外して手で戻す）**

1. `useAgentWorkspace.ts` の effect の `if (activity !== 'unknown') noteScreenActivity(slotId)` の行を消す（活動の受け渡しを外す） → `npx vitest run src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` で、「活動が unknown 以外のタブだけを sessions.noteScreenActivity に渡す」と配線の「再開で起動した copilot のタブが、…活動を見た後なら出さない」が落ちる → 手で戻す
2. `start` の `launchWatchBySlotRef.current.set(slotId, …)` の行を消す → `npx vitest run src/renderer/src/hooks/__tests__/useAgentSessions.test.ts` で、再開の失敗の describe の copilot の文言のテストが落ちる → 手で戻す
3. `applyExit` の `const note = resumeFailureNote ?? (exitedSoon ? AGENT_EXITED_SOON_NOTE : null)` を `const note = exitedSoon ? AGENT_EXITED_SOON_NOTE : null` に書き換える → 同じテストの copilot の文言のテストが落ちる → 手で戻す
4. 合わせ込みの `launchWatchBySlotRef.current.set(tab.slotId, { launchKind: 'new', … })` の `'new'` を `'resume'` に書き換える → 同じテストの「作り直しの後に合わせ込んだタブは…new として扱う」が落ちる → 手で戻す

戻したことを `git diff src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/hooks/useAgentSessions.ts` で確かめ（Step 4 の差分と Task 2 の差分だけが出る）、Step 5 のテストを流し直して PASS を確かめる。

- [ ] **Step 7: 全体の検証**

```bash
cd <repo-root>
npm run typecheck
set -- $(git status --porcelain | grep -v '^ D' | awk '{print $NF}' | grep -E '\.(ts|tsx)$')
echo "$#" "$@"
npx prettier --write "$@"
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
npx vitest run
```

Expected: どれも PASS（`npx vitest run` の時間切れは Global Constraints のとおり単体で流し直す）

- [ ] **Step 8: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 6: ROADMAP の更新・既知の制約・テスト仕様書と全体の検証（テスト仕様書への追記と Artifact の再公開）

> **設計書の読む節:** 「ROADMAP の更新の方針」、「既知の制約」、「実機テスト仕様書の方針と項目の下書き」（既存の項目の直しと新しい節）、「実装の分割」の 6、「main に入れた時点で利用者から見える挙動」。CLAUDE.md の実機テスト仕様書の規則（書式・ID を変えない・接頭辞ごとの連番）と `scripts/build-manual-test-spec.mjs`。
>
> **気をつける知見:** L-072（実機の項目では起動の記録のファイル・履歴のファイル・`~/.copilot` を消さず書き換えず〈`ls` で見るだけ〉、フォルダの信頼で覚えさせず、足したプロンプトと変えた設定〈使う CLI・送信前の確認〉を節の最後で戻す）・L-354（下書きの文言を実装の文言と照らし合わせてから追記する）・L-059（記録できなかった場面は既知の制約に書き、実機の項目で確かめる）

**Files:**

- Modify: `docs/manual-test-spec.md`（AGT-230・235・236・259 の直しと、新しい節 AGT-270〜277。**ほかの既存の項目の ID と文言は変えない**）
- Modify: `ROADMAP.md`（**prettier にかけない**）
- Modify（食い違いがあれば）: `docs/superpowers/specs/2026-10-23-agent-cli-copilot-resume-design.md`（「既知の制約」の照合と、プランの冒頭の「計画の時点で設計書から調整した細部」の反映）
- 生成（git 管理外）: `.superpowers/manual-test-spec.html`

**Interfaces:**

- Consumes: Task 1〜5 の実装（文言の正は `src/renderer/src/lib/agentSessionMessages.ts`・`src/renderer/src/lib/agentSendMessages.ts`・`src/renderer/src/lib/agentCliMessages.ts`）
- Produces: 実機テスト仕様書の AGT-270〜AGT-277 と既存の項目の直し、ROADMAP の段階 3a の記録、再公開した Artifact

- [ ] **Step 1: 設計書の「既知の制約」を実装と照らし合わせ、調整した細部を設計書に反映する**

`sed -n '/^## 既知の制約/,/^## 実機テスト仕様書の方針と項目の下書き/p' docs/superpowers/specs/2026-10-23-agent-cli-copilot-resume-design.md` で読み、次を確かめる。食い違いがあれば設計書の行を実装に合わせて直す（無ければ変えない）:

1. 起動の引数（`--session-id <ID>`・`--resume=<ID>`）と足す環境変数（`COPILOT_DISABLE_RESUME_AUTO_CD=1`）が `src/main/agentCliLaunchSpecs.ts` の表と一致する
2. 起動の記録のファイル名が `src/main/agentSessionRecordFileIo.ts` の `AGENT_SESSION_RECORD_FILE_NAMES` と一致する
3. 再開の失敗の文言を出す条件（再開で起動・活動を一度も見ない・`exited`・0 以外）が `isAgentResumeFailure` と一致し、記録を消していない（`grep -n "record\|delete" src/renderer/src/hooks/useAgentSessions.ts` で、終了の扱いが起動の記録に触れないことを確かめる。起動の記録は main にしか無い）
4. 設計書のほかの節の語を、プランの冒頭の「計画の時点で設計書から調整した細部」に合わせて直す（「決めたこと（利用者の確認済み）」「決めたこと（推奨案で決めた事項）」の表の文言は変えない）:
   - 「再開の入口」の「前回の続きから」の 1 つ目の箇条書きの「取り直しの契機（`refreshKey`）に `appCliKind` を足し」を「省略できない引数 `cliKind` を effect の依存に入れ（種類が変われば取り直す）」にする
   - 「構成」の `src/shared/types/history.ts` の行の `knownAgentCliKindOf` の置き場を `src/shared/historyAgentCliKind.ts`（`HISTORY_AGENT_CLI_KIND_PATTERN`・`isHistoryAgentCliKindValue`・`knownAgentCliKindOf`・`LEGACY_AGENT_HISTORY_CLI_KIND`）に確定した旨にし、表に `src/main/__tests__/agentSessionStarter.capabilities.test.ts` の行（能力の表を差し替えて `resume-unsupported` と ID を持たない種類の流れを保つ）を足す
   - 「構成」の最後の段落（活動を見たかの配線）を「`useAgentSessions` が起動ごとの控え（起動の指定と活動を見たか）を持って `noteScreenActivity(slotId)` を返し、`useAgentWorkspace` の effect が活動が `unknown` 以外のタブについて呼ぶ」に確定した旨にする
   - 「テスト方針」の統合テストの箇条書きに「既存のファイルに足し、新しい describe は実物の starter で起動する。既存の `runPlan` の 2 件は ID を渡す形に直す」を、`agentCliLaunchSpecs.test.ts` の箇条書きに「能力の表との整合は、表の今の値に応じた期待で全種類を回す（起動の表は能力の表を読まないため、`vi.mock` の差し替えでは保てない）」を足す
   - 「起動の記録」の「`AGENT_CLI_KINDS` から作る」を「種類をキーにしたオブジェクトのリテラルで作る（キーの欠けが型エラーになる）」にする

- [ ] **Step 2: 実機テスト仕様書の文言を実装と照らし合わせる（L-354）**

```bash
cd <repo-root>
node -e '
const fs = require("node:fs")
const checks = [
  ["src/renderer/src/lib/__tests__/agentSessionMessages.test.ts", "copilot がセッションを再開できずに終了しました。ターミナルの表示を確かめてください（何も送らずに閉じたセッションは、copilot が保存しないため再開できません）"],
  ["src/renderer/src/lib/__tests__/agentSessionMessages.test.ts", "claude のセッションのため、copilot では再開できません（設定の「使うエージェント CLI」で claude に切り替えると再開できます）"],
  ["src/renderer/src/lib/__tests__/agentSessionMessages.test.ts", "copilot のセッションのため、claude では再開できません（設定の「使うエージェント CLI」で copilot に切り替えると再開できます）"],
  ["src/renderer/src/lib/__tests__/agentSessionMessages.test.ts", "前回の続きから（このフォルダで最後に起動した copilot のセッションを再開）"],
  ["src/renderer/src/lib/__tests__/agentCliMessages.test.ts", "copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別"],
  ["src/renderer/src/lib/agentSessionMessages.ts", "このセッションは ${label} で動いています"],
  ["src/renderer/src/lib/agentSendMessages.ts", "エージェントが起動していません（ターミナルの「起動」を押してください）"]
]
let ok = true
for (const [file, text] of checks) {
  if (!fs.readFileSync(file, "utf-8").includes(text)) { ok = false; console.log("見つからない:", file, text) }
}
console.log(ok ? "ok" : "ng")
'
```

Expected: `ok`。`ng` なら、下の Step 3 の仕様書の文言を実装の文言に合わせて直す（実装は変えない）

- [ ] **Step 3: 実機テスト仕様書に追記する（既存の項目の直しと新しい節）**

新しい節の本文を `$S/agt-270-section.md` に書く（Write ツールで、次の内容をそのまま。前後の空行は付けない）:

```markdown
### copilot のセッションの再開と履歴

> 前提: エージェント CLI 方式で、テスト用のフォルダを開いている。GitHub Copilot CLI（`copilot`）がインストール済みで、端末で `copilot --version` が動く。設定の `使うエージェント CLI` で `GitHub Copilot CLI（copilot）` を選んでから始め（動いているタブがあれば確認で `OK`）、この節の最後の項目で `Claude Code（claude）` に戻す。途中で止めるときも `Claude Code（claude）` に戻す。
> 前提: フォルダの信頼の確認が出たら、その回だけ信頼する選択肢（`1. Yes`）を選ぶ（覚えさせてしまったら、AGT-228 の節の前提の手順で外す）。`copilot` のログインなど GitHub のアカウントに関わる操作は、利用者が自分のアカウントで行う。
> 前提: 「プロンプト」パネルに、タイトル `copilot 覚える`・内容 `Without using any tools or files, remember the word apple. Reply with only OK.` のプロンプトを足しておく（この節の最後の項目で消す）。思い出させるときは、ターミナルの `copilot` の入力欄に `Without using any tools or files, reply with only the word I asked you to remember.` を入力して `Enter` で送る。
> 前提: 設定の `送信前の確認` はオン（既定）で行う（AGT-270・277 は確認のダイアログが出ることを前提にしている）。オフにしている場合は、この節の間だけオンにし、この節の最後の項目で元に戻す。
> 前提: この節の項目では、起動の記録のファイル（`agent-sessions.json`・`agent-sessions-copilot.json`）と履歴のファイルを消したり書き換えたりしない。

- [ ] **AGT-270** `起動` で `copilot 1` を起動し、入力待ちになったら `copilot 覚える` の `実行` → `送信` を押して `OK` を待つ。「実行履歴」の一番上の項目を選ぶ → 項目は `送信済み`・`エージェント（copilot 1）`。詳細の `セッション:` に小文字の UUID が出る。`このセッションで再開` は押せず `このセッションは copilot 1 で動いています` が出る
- [ ] **AGT-271** ターミナルの中をクリックして `Ctrl+C` を 2 回押し、`copilot` を終了させて、ターミナルの最後の表示を見る → `Resume` の行に `copilot --resume=<ID>` が出て、その ID が AGT-270 の `セッション:` と同じ。帯は `終了しました（終了コード 0）`
- [ ] **AGT-272** 帯の `前回の続きから` を押し（信頼の確認が出たら `1. Yes`）、入力待ちになったら前提の文で思い出させる → 前の会話がターミナルに出てから入力待ちになり、`copilot` が `apple` と答える。タブに赤字は出ない
- [ ] **AGT-273** 帯の `終了` で `copilot 1` を止め、「実行履歴」の AGT-270 の項目の `このセッションで再開` を押す。入力待ちになったら前提の文で思い出させる → 新しいタブが足されて選ばれ、`copilot` が `apple` と答える。確かめた後、足したタブを `×` で閉じ、確認で `OK` を押す
- [ ] **AGT-274** `起動`（または `+`）で `copilot` を起動し、入力待ちになったら何も送らずに帯の `終了` で止める。続けて `前回の続きから` を押す → 起動したタブがすぐ終了し、タブに `copilot がセッションを再開できずに終了しました。ターミナルの表示を確かめてください（何も送らずに閉じたセッションは、copilot が保存しないため再開できません）` が赤字で出る。ターミナルに `Error: No session, task, or name matched '<ID>'.` が出る（出なければ、ターミナルの表示と `copilot --version` を記録する）。「実行履歴」の AGT-270 の項目の `このセッションで再開` は押せる（押さない）
- [ ] **AGT-275** アプリを `Cmd+Q` で終了し、`npm run dev` で起動し直して同じテスト用のフォルダを開く。別の端末で `ls ~/Library/Application\ Support/prompt-ide/` を実行する（中身は変えない）。「実行履歴」の AGT-270 の項目の `このセッションで再開` を押し、入力待ちになったら前提の文で思い出させる → `ls` に `agent-sessions.json` と `agent-sessions-copilot.json` が並ぶ（`agent-sessions.json` は `claude` を一度も起動していなければ無いことがある。そのときはそのことを記録する）。再開した `copilot` が `apple` と答える。確かめた後、帯の `終了` で止める
- [ ] **AGT-276** 設定の `使うエージェント CLI` で `Claude Code（claude）` を選ぶ（動いているタブがあれば確認で `OK`）。「実行履歴」の AGT-270 の項目を選んで `このセッションで再開` と `再実行` を見る → `このセッションで再開` は押せず `copilot のセッションのため、claude では再開できません（設定の「使うエージェント CLI」で copilot に切り替えると再開できます）` が出る。`再実行` は押せず `エージェントが起動していません（ターミナルの「起動」を押してください）` が出る
- [ ] **AGT-277** `claude 1` を `起動` で起動して入力待ちにし、AGT-270 の項目の `再実行` を押して確認のダイアログで `送信` を押す。`claude` が答えたら「実行履歴」の一番上の項目を見てから、帯の `終了` で止め、「プロンプト」パネルで `copilot 覚える` を消す → `copilot` のエントリの全文が `claude 1` に送られ、一番上に `送信済み`・`エージェント（claude 1）` の新しい項目が足される。その項目の `このセッションで再開` は押せる（押さない）。確かめた後、この節の前に `送信前の確認` をオフにしていた場合は、オフに戻す。この項目で設定は元に戻る
```

置き換えのスクリプトを書いて実行する（`$S/update-manual-test-spec.py`。日本語を含むので `# -*- coding: utf-8 -*-` 付きのファイルにする。各置き換えが 1 か所だけに当たることを確かめる）:

```python
# -*- coding: utf-8 -*-
# 実機テスト仕様書の段階 3a の直し(既存の項目の直しと、新しい節の追記)。各置き換えはちょうど 1 か所に当たることを確かめる
import sys

spec_path, section_path = sys.argv[1], sys.argv[2]
text = open(spec_path, encoding='utf-8').read()
section = open(section_path, encoding='utf-8').read().rstrip('\n')


def replace_once(old, new):
    global text
    count = text.count(old)
    assert count == 1, f'{count} か所: {old[:60]}'
    text = text.replace(old, new)


# AGT-230: 使えない機能の注記から再開を外す
replace_once(
    '`copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別、前回の続きから・このセッションで再開` が出る',
    '`copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別` が出る',
)
# AGT-235: 前回の続きからは押せる(AGT-231〜232 で copilot 1 を起動して送っているため、記録がある)
replace_once(
    '→ `前回の続きから` は押せず、`copilot では「前回の続きから」を使えません（設定で claude に戻すと使えます）` が出る',
    '→ `前回の続きから` は押せる色で、押せない理由は出ない（押さない。再開の確かめは AGT-272 以降）',
)
# AGT-236: このセッションで再開の理由は種類が違う理由
replace_once(
    '`このセッションで再開` は押せず `copilot では「このセッションで再開」を使えません（設定で claude に戻すと使えます）` が出る',
    '`このセッションで再開` は押せず `claude のセッションのため、copilot では再開できません（設定の「使うエージェント CLI」で claude に切り替えると再開できます）` が出る',
)
# AGT-259: copilot へ送ったプロンプトも履歴に残る
replace_once(
    '→ AGT-257 の前に控えた数から、AGT-257・258 で `copilot` に送ったプロンプトのエントリは増えていない（既知の制約。`copilot` へ送ったプロンプトは履歴に残らない）',
    '→ AGT-257 の前に控えた数から 2 件増え、一番上の 2 件が `送信済み`・`エージェント（copilot 1）` になる',
)
# 新しい節: copilot へのプロンプトの送信の節の後(エージェントの変更の確認の前)
replace_once('\n\n## エージェントの変更の確認', '\n\n' + section + '\n\n## エージェントの変更の確認')
open(spec_path, 'w', encoding='utf-8').write(text)
print('ok')
```

```bash
cd <repo-root>
S=<scratchpad の絶対パス>
test -f "$S/update-manual-test-spec.py" && test -f "$S/agt-270-section.md" || echo "missing"
python3 "$S/update-manual-test-spec.py" docs/manual-test-spec.md "$S/agt-270-section.md"
git diff docs/manual-test-spec.md | grep '^[-+]- \[ \]' | grep -o '^[-+]- \[ \] \*\*AGT-[0-9]*\*\*' | sort | uniq -c
grep -c '^- \[ \] \*\*AGT-27[0-7]\*\*' docs/manual-test-spec.md
```

Expected: `ok`。`uniq -c` が AGT-230・235・236・259 を `-` と `+` で 1 回ずつ、AGT-270〜277 を `+` で 1 回ずつ出す（ほかの ID は出ない）。最後の `grep -c` が `8`

- [ ] **Step 4: HTML を再生成し、仕様書の検査を流す**

Run: `node scripts/build-manual-test-spec.mjs`
Expected: `.superpowers/manual-test-spec.html` が書き出される（エラーなし）
Run: `npx vitest run scripts`
Expected: PASS（ID の一意性・接頭辞ごとの連番が昇順・書式の検査が通る）

- [ ] **Step 5: Artifact を再公開する（コントローラーが行う）**

実装のサブエージェントはこの Step を行わず、Step 4 まで終えたことを報告する。コントローラー（このプランを実行するメインのエージェント）が、Artifact ツールで `<manual-test-spec-artifact-url>` を同じファイルパス `.superpowers/manual-test-spec.html` で再公開する（`url` にこの Artifact の URL を渡す。先に `action: "read"` で読む必要があれば読む）。再公開した結果の URL を報告に書く。

- [ ] **Step 6: ROADMAP を更新する（prettier にかけない）**

`$S/update-roadmap.py` を書いて実行する（日本語を含むので `# -*- coding: utf-8 -*-` 付きのファイルにする。`DATE` は実装した日〈`date +%F` の出力〉を引数で渡す）:

```python
# -*- coding: utf-8 -*-
# ROADMAP の段階 3a の記録(設計書「ROADMAP の更新の方針」)。各置き換えはちょうど 1 か所に当たることを確かめる
import sys

roadmap_path, date, constraints_path = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(roadmap_path, encoding='utf-8').read()
constraints = open(constraints_path, encoding='utf-8').read().rstrip('\n')


def replace_once(old, new):
    global text
    count = text.count(old)
    assert count == 1, f'{count} か所: {old[:60]}'
    text = text.replace(old, new)


NOTE_3A = '段階 3a で前回の続きから・このセッションで再開と履歴への記録に対応した'

# 「エージェント実行の支援（MVP の次）」の項目(未完了のまま): 段階 2b の行の後に段階 3a の行を足し、残りを直す
replace_once(
    '      - 残り: copilot の hooks による変更の区別・セッションの再開・起動の記録と履歴への CLI の種類の記録＝段階 3',
    f'      - 実装済み（{date}。段階 3a。設計書 `docs/superpowers/specs/2026-10-23-agent-cli-copilot-resume-design.md`）: copilot のセッションの再開（前回の続きから・このセッションで再開。新しい起動は --session-id、再開は --resume=）と、起動の記録の種類ごとのファイル、実行履歴への CLI の種類の記録（copilot へ送ったプロンプトも記録する）。実装済み機能の「copilot のセッションの再開と履歴への CLI の種類（段階 3a）」を参照\n'
    '      - 残り: copilot の hooks による変更の区別＝段階 3b（実測の段階 3b-0 の後）',
)
# 段階 1 の節の機能の行と既知の制約の行(どちらも段階 1 の時点の記録として過去形)の括弧書きに書き足す
replace_once(
    '（段階 2a で中断と画面の判定に対応した。段階 2b でプロンプトの送信に対応した）',
    f'（段階 2a で中断と画面の判定に対応した。段階 2b でプロンプトの送信に対応した。{NOTE_3A}）',
)
replace_once(
    '（段階 2a で、表示・通知・中断・自動の取り直しに対応した。段階 2b でプロンプトの送信に対応した）',
    f'（段階 2a で、表示・通知・中断・自動の取り直しに対応した。段階 2b でプロンプトの送信に対応した。{NOTE_3A}）',
)
# 段階 2a の節の既知の制約の最後の行
replace_once(
    '（段階 2b・3。段階 2b でプロンプトの送信に対応した）',
    f'（段階 2b・3。段階 2b でプロンプトの送信に対応した。{NOTE_3A}）',
)
# 段階 2b の節: 履歴に記録しない旨の機能の行・既知の制約の行と、最後の既知の制約の行を、段階 2b の時点の記録として過去形にする
replace_once(
    '`copilot` へ送ったプロンプトは実行履歴に記録しない（送り先の会話の ID を持たないため。黙って省く）',
    '段階 2b の時点では、`copilot` へ送ったプロンプトは実行履歴に記録しなかった（送り先の会話の ID を持たないため。黙って省いた）（段階 3a で履歴への記録に対応した）',
)
replace_once(
    '- `copilot` へ送ったプロンプトは実行履歴に残らない（送り先の会話の ID を持たないため。段階 3 で履歴への CLI の種類の記録とあわせて扱う）。',
    f'- 段階 2b の時点では、`copilot` へ送ったプロンプトは実行履歴に残らなかった（送り先の会話の ID を持たないため）（{NOTE_3A}）。',
)
old_2b_last = '- `copilot` ではプロンプトの送信は使えるが、利用者の変更との区別・前回の続きから・このセッションで再開は使えない（段階 3）'
new_2b_last = f'- 段階 2b の時点では、`copilot` ではプロンプトの送信は使えたが、利用者の変更との区別・前回の続きから・このセッションで再開は使えなかった（段階 3）（{NOTE_3A}）'
replace_once(old_2b_last, new_2b_last)
# 「エージェントのセッションの再開と履歴への記録」の節の既知の制約: 古い版のアプリの行の後に段階 3a の互換性への参照を足す
replace_once(
    '- 新しい形式の履歴（`status: \'sent\'`）を古い版のアプリで読むと、そのエントリは捨てられる\n',
    '- 新しい形式の履歴（`status: \'sent\'`）を古い版のアプリで読むと、そのエントリは捨てられる\n'
    '- 段階 3a で履歴のエントリの送り先に CLI の種類（`agent.cliKind`）を足した。古い版のアプリで段階 3a の履歴を保存すると種類が落ち、段階 3a の版に戻したとき `copilot` のエントリは `claude` のエントリとして読まれる（「copilot のセッションの再開と履歴への CLI の種類（段階 3a）」の既知の制約）\n',
)
# 実装済み機能の末尾(段階 2b の節の後、--- の前)に段階 3a の節を足す
section = '''### copilot のセッションの再開と履歴への CLI の種類（段階 3a）

設計書: `docs/superpowers/specs/2026-10-23-agent-cli-copilot-resume-design.md`（2026-10-23）。

- [x] 設定で `copilot` を選んでいる間も、帯の `前回の続きから` と実行履歴の `このセッションで再開` で `copilot` の会話を再開する（能力の表の `copilot` の `sessionResume` を真にした）。再開できるのは設定と同じ種類のセッションだけ
- [x] 起動の引数と環境変数は main の起動の表（`agentCliLaunchSpecs.ts`）で決める（下の表）。会話の ID は main が振った小文字の UUID と、入り口で形を検証し設定の種類の記録と照合した ID だけを使う。同じ ID の二重の起動は種類をまたいで拒む
- [x] 起動の記録は種類ごとの別のファイル（下の表）。記録の規則（読み込み・合わせ込み・直列の書き込み・読めないときに書かない）は今のまま
- [x] 再開の依頼と「前回」の取得に種類を載せ、main は起動のたびに読んだ設定の種類と違えば起動せずに `使うエージェント CLI の設定が変わったため、再開しませんでした（設定を確かめてから、もう一度押してください）` を出す
- [x] 実行履歴のエントリの送り先に CLI の種類（`agent.cliKind`）を足し、`copilot` へ送ったプロンプトも記録する。種類の無い古いエントリは `claude` として読み、形の正しい知らない種類（新しい版の種類）は値を保つ。形の不正な種類のエントリは捨てる。履歴の `再実行` は種類を見ない
- [x] `このセッションで再開` の押せない理由の順: 実行方式の読み込み中 → エージェント CLI 方式でない → 設定の種類が再開に対応していない → エントリの種類が知らない種類（`このアプリの版が知らないエージェント CLI（<種類>）のセッションのため、再開できません`）→ エントリの種類と設定の種類が違う（`<エントリ> のセッションのため、<設定> では再開できません（設定の「使うエージェント CLI」で <エントリ> に切り替えると再開できます）`）→ 記録したフォルダを開いていない → 起動を受け付けない間 → 同じ ID のタブが動いている → タブが上限
- [x] 再開で起動した `copilot` のタブが、画面の活動を一度も見ないまま 0 以外で終わったら `copilot がセッションを再開できずに終了しました。ターミナルの表示を確かめてください（何も送らずに閉じたセッションは、copilot が保存しないため再開できません）` を出す（記録は消さない。`claude` は今の「起動の直後に終了しました」のまま）

| 種類      | 新しい起動          | 再開                          | 足す環境変数                                                         |
| --------- | ------------------- | ----------------------------- | -------------------------------------------------------------------- |
| `claude`  | `--session-id <ID>` | `--resume <ID>`               | なし                                                                 |
| `copilot` | `--session-id <ID>` | `--resume=<ID>`（1 つの引数） | `COPILOT_DISABLE_RESUME_AUTO_CD=1`（保存先への自動の移動を止める） |

| 種類      | 起動の記録のファイル（`userData` の下）                                           |
| --------- | --------------------------------------------------------------------------------- |
| `claude`  | `agent-sessions.json`（段階 3a より前と同じ形・中身）                             |
| `copilot` | `agent-sessions-copilot.json`（同じ形。フォルダごと 200 件・フォルダ 50 件まで） |

既知の制約（設計書の「既知の制約」と同じ）:

''' + constraints
replace_once(new_2b_last + '\n\n---\n', new_2b_last + '\n\n' + section + '\n\n---\n')
open(roadmap_path, 'w', encoding='utf-8').write(text)
print('ok')
```

既知の制約の一覧（設計書の「既知の制約」の箇条書きそのまま。Step 1 で設計書を直したら、直した後の行を使う）を一時ファイルに書き出してから実行する:

```bash
cd <repo-root>
S=<scratchpad の絶対パス>
test -f "$S/update-roadmap.py" || echo "missing"
sed -n '/^## 既知の制約/,/^## 実機テスト仕様書の方針と項目の下書き/p' docs/superpowers/specs/2026-10-23-agent-cli-copilot-resume-design.md | grep '^- ' > "$S/roadmap-constraints.md"
wc -l "$S/roadmap-constraints.md"
python3 "$S/update-roadmap.py" ROADMAP.md "$(date +%F)" "$S/roadmap-constraints.md"
git diff --stat ROADMAP.md
grep -n "段階 3a" ROADMAP.md | cut -c1-120
```

Expected: `wc -l` が `11`（Step 1 で行を足し引きしたらその数）。`ok`。`grep` が、項目の段階 3a の行・段階 1 の機能の行と既知の制約の行・段階 2a の既知の制約の行・段階 2b の 3 行・再開の節の互換性の行・新しい節の見出しと本文を出す。`- [ ] \`claude\` 以外のエージェント CLI への対応`は`- [ ]` のまま（段階 3b が残る）

- [ ] **Step 7: 全体の検証**

```bash
cd <repo-root>
npm run typecheck
set -- $(git status --porcelain | grep -v '^ D' | awk '{print $NF}' | grep -E '\.(ts|tsx)$')
echo "$#" "$@"
npx eslint --max-warnings 0 "$@"
set -- $(git status --porcelain | grep -v '^ D' | awk '{print $NF}' | grep -E '\.(ts|tsx|md)$' | grep -v '^ROADMAP.md$')
npx prettier --check "$@"
npx vitest run
npx vitest run scripts
pgrep -fl amt-test- || echo "テストのプロセスは残っていない"
```

Expected:

- `npm run typecheck` が PASS
- `echo` が、Task 1〜5 で作った・変えた TypeScript のファイルを並べる。`npx eslint` がエラー・警告なし
- `npx prettier --check` がすべて整形済み（`ROADMAP.md` は外している。外れたファイルは、そのファイルだけを `npx prettier --write <ファイル>` で直す。`docs/manual-test-spec.md`・設計書・このプランが外れたら、そのファイルだけを `--write` する）
- `npx vitest run`・`npx vitest run scripts` が PASS（負荷による時間切れは、落ちたファイルを単体で流し直して確かめ、報告に書く）
- `pgrep` がテストのプロセスを出さない

`git status --short` で、変更・作成したファイルが「ファイルの構成」の表と一致することと、`.superpowers/` が出ないことを確かめる。

- [ ] **Step 8: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

## Self-Review（計画の作成者が設計書と照らし合わせた結果）

**1. 設計書の要件の取りこぼし（構成・テスト方針の割り当て）**

| 設計書の項目                                                                                                                                                                                                                                           | タスク |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `AgentHistoryInfo.cliKind`・`knownAgentCliKindOf`・形の規則・`isValidHistoryEntry` と `sanitizeHistoryEntry`・送り先の控えの種類・`buildAgentSentHistoryEntry` のコメント                                                                              | 1      |
| 種類ごとの起動の記録のファイル・store の組み立て・starter の `records` の表・種類の照らし合わせ（`resume-cli-mismatch`）・`lastSessionOf` の種類・IPC の入力の検証・preload（`index.d.ts` を含む）・renderer の依頼の種類・`AGENT_RESUME_CLI_MISMATCH` | 2      |
| `buildCopilotArgs`（`new`・`resume`・ID の検証）・`extraEnv`・`buildAgentEnv`・能力の表の `sessionResume`・前提を失うテストの直し・テストの補助・統合テスト                                                                                            | 3      |
| エントリの種類の理由（知らない種類・違う種類）・`agentResumeLastAriaLabel`・「前回」の結果の照らし合わせ・配線のテスト                                                                                                                                 | 4      |
| `isAgentResumeFailure`・`AGENT_RESUME_FAILURE_NOTES`・起動の控えと活動の配線・合わせ込みのタブ・配線のテストと変異                                                                                                                                     | 5      |
| ROADMAP・既知の制約の照合・実機テスト仕様書（AGT-270〜277 と AGT-230・235・236・259 の直し）・HTML の再生成・Artifact の再公開・全体の検証                                                                                                             | 6      |

設計書の「テスト方針」の各ファイル（`agentCliKinds.test.ts`・`historyAgentCliKind.test.ts`〈`knownAgentCliKindOf`〉・`agentCliLaunchSpecs.test.ts`・`agentCommand.test.ts`・`agentSessionRecordFileIo.test.ts`・`agentSessionStarter.test.ts`・`agentTerminalPayloadParser.test.ts`・`historyUtils.test.ts`・`agentResumeAvailability.test.ts`・`agentSessionMessages.test.ts`・`agentSessionTabState.test.ts`・`useAgentLastSession.test.ts`・`useAgentResume.test.ts`・`useAgentSessions.test.ts`・`agentTabSessionInfo.test.ts`・`usePromptRunner.test.ts`・`agentSendCallbacks.test.ts`・`historyEntryFactory.test.ts`・`useAgentWorkspace.test.ts` の配線・統合テスト）は、どれもいずれかのタスクの Step に入れた。設計書の「実装の分割」3 の「前提を失う既存のテスト」の一覧は、全件を Task 3 の Step 2・3 に入れ、計画の時点で grep をかけ直して見つかったものを冒頭の「計画の時点で設計書から調整した細部」の最後の項目に書いた。

**2. 気をつける知見の割り当て**

| 知見         | タスク        |
| ------------ | ------------- |
| L-001        | 2・5          |
| L-002・L-006 | 2・5          |
| L-007        | 3             |
| L-015        | 1             |
| L-017        | 1・3・4・5    |
| L-018        | 2・3          |
| L-019・L-034 | 2・3          |
| L-037・L-040 | 2・4          |
| L-044        | 1・2・3・4    |
| L-052        | 3             |
| L-058        | 4             |
| L-059        | 3・6          |
| L-060        | 1・2・3・4・5 |
| L-061        | 5             |
| L-072・L-354 | 6             |
| L-456・L-459 | 1・2          |

**3. 型・名前の一貫性**

冒頭の「型・関数の名前」と、各タスクの Interfaces・コードで、`AgentHistoryInfo.cliKind`・`LEGACY_AGENT_HISTORY_CLI_KIND`・`isHistoryAgentCliKindValue`・`knownAgentCliKindOf`・`AGENT_SESSION_RECORD_FILE_NAMES`・`createAgentSessionRecordFileIo(userDataDir, fileName)`・`records: Record<AgentCliKind, …>`・`lastSessionOf(ownerId, folderPath, cliKind)`・`parseAgentCliKind`・`getLastAgentSession(folderPath, cliKind)`・`UseAgentLastSessionOptions.cliKind`・`resumeInNewTab(claudeSessionId, cliKind)`・`AGENT_RESUME_CLI_MISMATCH`・`extraEnv`・`buildAgentEnv(…, extraEnv)`・`sessionResumeUnsupportedKinds`・`agentResumeLastAriaLabel`・`agentResumeEntryCliMismatch`・`agentResumeEntryUnknownCli`・`isAgentResumeFailure`・`AGENT_RESUME_FAILURE_NOTES`・`noteScreenActivity` が同じ名前と型であることを確かめた。

**4. 計画の時点で確かめたこと（リポジトリは変えていない）**

- 設計書の「実装の分割」3 の一覧の行番号の内容を、計画の時点のテストで読み直した（`agentCliLaunchSpecs.test.ts` 31・38・71・75・81・88 行、`agentSessionStarter.test.ts` 1048・1072・1083・1106 行、`agentTerminalHandlers.test.ts` 800 行、`usePromptRunner.test.ts` 339・424 行、`agentSendCallbacks.test.ts` 63 行、`useAgentWorkspace.test.ts` 2726・2806・2923・2974・3029 行、`useAgentPromptSender.test.ts` 624 行）。行番号は実装の時点でずれるので、プランではテストの名前で指した
- `buildAgentEnv` の 1 行の呼び出し（14 か所）と複数行の呼び出し（3 か所）、再開の依頼の 1 行の値（`agentSessionStarter.test.ts` 4 か所・`agentTerminalPayloadParser.test.ts` の複数か所・`claudeSessionIdSelection.test.ts` 2 か所・`agentCliLaunchSpecs.test.ts` 1 か所・`App.agentSessionResume.test.tsx` 2 か所・`useAgentResume.test.ts` 1 か所）、`AgentHistoryInfo` を作るテストのファイル（18 個）を grep で数え、機械的な置き換えのパターンが当たる形であることを確かめた。当たらない複数行の箇所は手で直す箇所としてタスクに書いた
- `useAgentActivity` は running に入ると 150ms 後に通知を待たずに画面を判定するので、Task 5 の配線のテストの 1 回目は画面を空にしてから起動する形にした
- 統合テストの 2 回目の起動（再開）は、starter が exited の解決の後に予約を外すので、sink の終了の知らせの後に予約が外れるまで待つ形にした
- 実機テスト仕様書の最大の ID は AGT-269（新しい節は AGT-270 から）、AGT-230 の置き換える文字列は仕様書に 1 か所だけ（`grep -c` で確かめた）
- ROADMAP の置き換える文字列（段階 1 の 2 行・段階 2a の 1 行・段階 2b の 3 行・項目の残りの行・再開の節の互換性の行）は、計画の時点で `grep -n` で読んだ全文から写した
