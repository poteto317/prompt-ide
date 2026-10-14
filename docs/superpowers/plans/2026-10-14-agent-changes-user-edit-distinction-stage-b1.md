# エージェントの変更の利用者の編集との区別（段階 B-1: 受け取りの変更・検知と起動の守り・区別のモデル・registry の同期とつなぎ込み） 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 段階 A の hooks の受け取りに `PostToolBatch`・hooks が届かなくなったときの保留・頑健性の 5 項目を入れ、エージェントの変更の記録（registry）の中で「利用者が変えたパス」「エージェントが変えたパス」を、判定の区切り（作業ツリーの写し）の差分で区別して持つ。一覧・行の印・`すべて戻す`・確認の文言・画面は変えない（B-2 で出す）。

**Architecture:** main の追跡（`agentToolIntervals.ts`・`agentToolActivity.ts`）に、`PostToolBatch` まで開いたままの `ended` の区間・256 件のあふれ（`overflowed`）・ターンの終わりの 30 秒の待ちと保留（`turnEndOverdue`）を足し、合図 `unassignable` に反映する。受け口（`agentHookReceiver.ts`）は常駐の `error` ハンドラ・`onToolStart` の同期の throw・`close` の後の待ちと要求を守る。renderer は作業の終わり（`working` の後の `idle`）を `agentTerminal:reportWorkingEnded` で送る。区別の型と純粋な関数は新規 `agentChangesAttribution.ts`、同期・吸収の手順は新規 `agentChangesAttributionSync.ts` に置き、`AgentBaselineRegistry` は所有者の列の中でそれを呼ぶ（`notifyAttributionSignal`・`syncAttribution`・`waitForAgentPhase`・`markPeriodUnassignable`・`withAttributionAbsorbed`）。`ipcHandlers.ts` は生成の順を変えずに、runtime の 3 つのつなぎ先を registry のメソッドにつなぐ。

**Tech Stack:** Electron（main・preload）, React 19, TypeScript, Node の `node:http`, simple-git（既存の `takeBaselineSnapshot`・`collectAgentChangeEntriesBetween`）, Vitest（偽のタイマー・実際の listen・偽の `takeSnapshot`・実 git）, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-13-agent-changes-user-edit-distinction-design.md`（承認済み。実装の前に必ず読む）。このプランは「実装の分割」の **段階 B-1 のタスク 1〜6 だけ**。B-2（一覧の `author`・`すべて戻す` の絞り込み・IPC の型・renderer の表示・ROADMAP の完了）は含めない。読む節: 「hooks の受け取りと区間の追跡の変更（main。段階 B）」の全体、「利用者の変更の判定（main。段階 B）」の「記録に持つもの」「同期」「`PreToolUse` の待ち」「やめる」「アプリの戻す操作・取り消しの吸収」、「IPC と型」、「新しい状態と既存の入口」、「エラー処理」の B の行、「テスト方針」の段階 B、「実機テスト仕様書の方針」の B-1、「実装の分割」の B-1、「反映した知見」の段階 B の分。段階 A のプラン `docs/superpowers/plans/2026-10-13-agent-changes-user-edit-distinction-stage-a.md` は書き方と既存の部品の経緯の参考。

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
> - 設計書のタスク 1・2・4 は大きいため、境目を保ったまま **Task 1a（`PostToolBatch` と `ended`）・Task 1b（頑健性の 1〜4）**、**Task 2a（ターンの終わりの待ちと保留・作業の終わりの IPC）・Task 2b（頑健性の 5: `activate` の順と starter の守り）**、**Task 4a（記録の区別の項目と開始）・Task 4b（同期・待ち・打ち切りの印）** に分ける。設計書のタスク 3・5・6 はそれぞれ Task 3・Task 5・Task 6。
> - registry の依存に **`collectBetween: (start: BaselineSnapshot, end: BaselineSnapshot) => Promise<AgentChangeEntry[]>`（必須）** を足す（設計書の依存は `attribution`・`attributionDevLog` だけだが、判定の区切りの差分を偽の git で試すため。本番は `ipcHandlers.ts` が `collectAgentChangeEntriesBetween` をそのまま渡す）。
> - `initialAttribution` の引数は設計書の `{ seqBefore, seqAfter, signalBefore, signalAfter, startedAt }` の `startedAt` の代わりに **`baseline: BaselineSnapshot`** を受ける（判定の区切りの初期値 `checkpoint` に始点を置くため。`lostAt`・`trackingSince` には `baseline.startedAt` を使う）。区別をやめるかは、記録を作る時点の合図 `signalAfter.lost` で決める（設計書の「取り終えて…記録を作る時点の合図 d1 で決める」）。
> - 行の `author` の純粋な関数は、1 行ずつの `author` ではなく **`authorsOf(entries, attribution, currentPaths)`**（一覧の行の並びに `AgentChangeAuthor | null` の並びを返す）にする。今の区間のパス（`currentPaths`）は呼び出し側（B-2 の `agentChangesScopedQuery`）が比較して渡し、比べなかった・失敗したら `null` を渡す。比べるかは `needsCurrentPeriod(attribution)` で決める。B-1 では B-2 のために純粋な関数とテストまで入れる（どこからも呼ばない）。
> - 記録の区別は `record.attribution`（`TrackingAttribution | LostAttribution`）に持ち、`lost` にするときは `markAttributionLost` がオブジェクトを置き換える。区別の段階・集合を registry の外へ出す公開のメソッドは足さない（テストは `registry.withRecord(1, folder, async (record) => record)` で記録を受け、`record.attribution` を読む）。
> - 同期の結果の型 `AttributionSyncResult = 'synced' | 'skipped'` と、1 回の手順の結果 `AttributionStepOutcome` は `agentChangesAttributionSync.ts` に置く。区切りの取り消し・世代の変化・失敗（`lost`）はどれも `skipped` を返す（設計書「区切りの途中の取り消し・失敗も含む」）。同期の中で予期しない例外が出たら、記録が今の記録のままなら `lost`（`checkpoint-failed`）にして `skipped` を返す（L-002。reject しない）。
> - 追跡の開発版のログの `unassignable=<あり|なし>` は、行の**末尾**（`phase=<前>→<後>` の後）に足す（実機テスト仕様書の既存の項目の部分一致の期待結果を壊さない）。作業の終わりの知らせで 30 秒の待ちを張ったときに `event=作業の終わり` の行も出す（実機で待ちが張られたことを見るため）。
> - 吸収の (3) の区切り S2 は、差分を割り当てないため `collectBetween` を呼ばない。取り消しの吸収は `undoLastRevert` の `undoId` の照合（作業ツリーを変えない例外）の後から、`executeUndo` から結果を作るまでを包む。
> - 既存のテスト（`agentBaselineRegistry.test.ts`・`handlers/agentChangesHandlers.test.ts`・`handlers/agentChangesHandlers.integration.test.ts`）の registry は、**区別をやめた合図（`lost: 'receiver-unavailable'`）の偽の追跡**で作る（記録が `lost` で始まり、同期・吸収の区切りを取らないため、既存のテストの区切りの数・順序が変わらない）。区別は新しいテストのファイルで見る。
> - 受け口の「待ち受けの後の server の `error`」のテストは、`vi.mock('node:http')` で作った server を控えて `emit('error')` する（受け口の公開の型は変えない）。

## Global Constraints

- コメント・文言・ログは日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。クライアントのコンポーネントには `'use client'`（このプランに新しいコンポーネントは無い）。`any` を使わない
- **コミットは利用者の明示の指示があるときだけ行う**（CLAUDE.md）。各タスクの最後の「コミット」の Step は、指示があったときにだけ実行する。そのときは `git add <このタスクで変えたファイルを列挙>`（**`git add -A` は使わない**）で、メッセージは日本語の Conventional Commit、本文の最後に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **B-1 は一覧・行の印・`すべて戻す` の対象と確認の文言・画面を変えない。** `AgentChangeEntry`・`AgentChangesState`・`AgentChangesListResult` の形、`agentChangesScopedQuery.ts`・`agentChangesRevert.ts`、`src/renderer/src/components/source-control/*`、`src/renderer/src/lib/agentChanges*.ts` は触らない（B-2）
- **実物の `claude` は起動しない。** 実機の確認はユーザーがまとめて行う（Task 6 で実機テスト仕様書に追記する）。プランに実機の手順は書かない
- 各タスクの終わりで次が通る状態を保つ: `npm test`（全テスト）・`npm run typecheck`・変更・作成した TypeScript のファイルへの `npx eslint --fix <ファイル>` → `npx eslint --max-warnings 0 <ファイル>`（各タスクの「通す」の Step の `<同じファイル>` は、直前の `npx eslint --fix` に渡したファイルの並びと同じものを渡す）。**このマシンは負荷が高く、`npm test` の全体でテストが時間切れ（`Test timed out`・`waitFor` の打ち切り）で落ちることがある。** 落ちたら、落ちたファイルを `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書いて先へ進む。単体でも落ちれば本当の失敗として直す
- 定数（値は設計書から写す。後のタスクはこの名前と値で使う）:
  - `agentHookProtocol.ts`: イベントは 9 つ（`UserPromptSubmit`・`PreToolUse`・`PostToolUse`・`PostToolUseFailure`・`PostToolBatch`・`SubagentStop`・`Stop`・`StopFailure`・`SessionEnd` の順）。`PostToolBatch` のパスの段は `post-tool-batch`、matcher なし、hook の `timeout` は `AGENT_HOOK_TIMEOUT_SECONDS`（5）。`AGENT_HOOK_TOOL_EVENTS` には足さない
  - `agentToolIntervals.ts`: `AGENT_TOOL_OPEN_MAX = 256`・`AGENT_DROPPED_TOOL_IDS_MAX = 1_024`（変えない）
  - `agentToolActivity.ts`: `AGENT_HOOKS_TURN_END_WAIT_MS = 30_000`（新規）。既存の `AGENT_TOOL_END_GRACE_MS = 2_000`・`AGENT_TOOL_INTERVAL_MAX_MS = 15 * 60 * 1000`・`AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS = 15_000` は変えない
  - `agentHookReceiver.ts`: `AGENT_PRE_TOOL_USE_WAIT_MS = 5_000`（変えない）。`close` の後の要求は 503（本文なし）
- 型（`src/shared/types/agentChanges.ts` に定義だけする。B-1 では IPC に載せない）:
  - `AgentChangeAuthor = 'agent' | 'user' | 'mixed'`
  - `AgentChangesAttributionLostReason = 'hooks-not-confirmed' | 'receiver-unavailable' | 'claude-version-unsupported' | 'checkpoint-failed'`（追跡の `AgentHooksLostReason` に `checkpoint-failed` を足したもの。`string` で受けない。L-439）
  - `AgentChangesAttributionSummary = { kind: 'tracking'; since: number | null; hadUnassignedSince: boolean } | { kind: 'lost'; reason: AgentChangesAttributionLostReason; lostAt: number; hadMarks: boolean; since: number | null; hadUnassignedSince: boolean }`
- IPC: renderer → main の `agentTerminal:reportWorkingEnded`（`ipcRenderer.send`。引数は pty の sessionId だけ。`agentTerminal:reportWorking` と同じ検査）。preload は `reportAgentSessionWorkingEnded(sessionId: string): void`、renderer の窓口は `lib/agentTerminalApi.ts` の `reportAgentSessionWorkingEnded(sessionId)`
- ログの文言（一字一句この形。実機テスト仕様書もこの文字列で書く）:
  - 追跡の開発版のログ: `[agent-hooks] owner=<id> session=<先頭 8 桁か -> event=<イベント名か 起動・終了・作業中・作業の終わり・確認の待ちの終わり・終わりの待ちの終わり・猶予の終わり・interval-expired> tool=<名前か -> id=<あり|なし|-> agent=<あり|なし|-> hooks=<状態> phase=<前>→<後> unassignable=<あり|なし>`（`unassignable` は求め直した後の合図）
  - 追跡の常に出すログ（`warn`）: `[agent-hooks] ターンの終わりの知らせが届かないため、次の知らせまで割り当てを保留します`・`[agent-hooks] 知らせが届いたため、保留を解きます`・`[agent-hooks] 作業の終わりの知らせのセッションが見つかりません`・`[agent-hooks] 段階の通知に失敗しました: <message>`
  - 受け口: `[agent-hooks] 受け口が止まりました: <message>`
  - handler: `[agent-hooks] 作業の終わりの知らせの sessionId が不正です`（既存の `[agent-hooks] 作業中の知らせの sessionId が不正です` は変えない）
  - registry の開発版のログ（`attributionDevLog`）: `[agent-attribution] owner=<id> event=<開始|同期|吸収|lost> phase=<前か ->→<後か -> user=<利用者の集合の件数> agent=<エージェントの集合の件数> unassignable=<あり|なし> reason=<lost の理由か ->`（パス・内容は出さない。L-017）
  - starter: `[agentSessionStarter] hooks の結び付けに失敗しました:`・`[agentSessionStarter] 終了の後始末(<Map|予約|hooks>)に失敗しました:`（`console.error` の第 1 引数。第 2 引数に例外）
- テストの規約: 偽のタイマー（`vi.useFakeTimers()`）は `afterEach` で `vi.useRealTimers()` まで戻す（CLAUDE.md のタイマーリークの防止）。`act(...).then(...)` で書かない。`console.*` の spy は `afterEach`（か `finally`）で戻す。テストの補助関数にも戻り値の型を書く（`@typescript-eslint/explicit-function-return-type`）。実際に listen するテストは `afterEach` で必ず `close()` する。実 git・一時ディレクトリは使う `describe` の中だけで用意する（L-440）。待ちは状態（Promise の解決・記録の値・呼び出しの数）で待ち、固定時間で待たない（L-185。「まだ解決していない」ことの確認だけは `setImmediate` 1 回分を待つ）。結果は `await` で受け、`void promise.then(...)` で観測しない（解決したかの印を `then` で立てても、最後に元の Promise を `await` する。L-178）。区切りの最中・後の `PreToolUse` は、偽の `takeSnapshot` の完了を外から解決できる形にして順序を作る（L-167）
- 「変異で確かめる」の Step は、書いた実装の一部を一時的に戻して該当のテストが落ちることを確かめ、必ず元に戻す（戻したことを `git diff` で確かめる）

### 気をつける知見（dev-flow-kit の `lessons/review-lessons.md`。設計書の「反映した知見」の段階 B の分）

- **L-002**（「無い」「失敗」を「空」として扱わない）: `PostToolBatch` の本文を読めない・`agent_id` がある知らせで区間を閉じない（Task 1a）。`waitForAgentPhase` の失敗を打ち切りと同じく「割り当てない」に倒す（Task 1b）。区間のあふれで区間を外さず割り当てない（Task 1b）。区切り・差分の失敗を「変化なし」にせず `lost` にする（Task 4b）
- **L-010**（後始末は 1 つが失敗しても残りを試す）: starter の `exited` の後始末（Map・予約・`release`）を 1 つずつ握る（Task 2b）
- **L-040**（複数の発生源の非同期で古い結果が新しい状態を上書きしない）: 同期は `onPhaseChange` の時点の値でなく、番が来た時点の `activityOf` で段階を読み、区切りを取り終えた時点（手順 8）の段階で新しい段階を決める。比べる世代と記録はタスクが走り始めた時点で読む（Task 4b）
- **L-044**（受け付けない入力をフォールバックに流さない）: `subagent-batch-end`・`batch-end-unreadable`・`bad-agent-id` を区間を閉じる根拠にしない（Task 1a）。`subagent-stop` で外した ID を控え、遅れた `tool-end` で別の区間を閉じない（Task 1b）
- **L-052**（待ちに上限）: 受け口の 5 秒の上限は変えない。`close` で待ちのタイマーを外す（Task 1b）。ターンの終わりの待ちは 30 秒（Task 2a）
- **L-053**（通知の途中の例外で後続が走らない）: 追跡の `publish` が `onPhaseChange` の例外を握る（Task 2a）。`notifyAttributionSignal` は投げない（Task 4b）
- **L-055**（`fn().catch()` は同期の throw を捕まえない）: `onToolStart` を `Promise.resolve().then` で包む（Task 1b）
- **L-060**（必須の依存にする）: handler の依存 `reportWorkingEnded`（Task 2a）、registry の依存 `attribution`・`attributionDevLog`・`collectBetween`（Task 4a）、handler の registry の `Pick` に `withAttributionAbsorbed`（Task 5）を必須にし、組み立てのテストで同一性（`toBe`）を確かめる
- **L-061**（新しい状態の入口を列挙する）: 新しい入口 `agentTerminal:reportWorkingEnded`（Task 2a）、記録の区別を変える入口（`begin`・同期・吸収・`clear`・`close`）を設計書の「新しい状態と既存の入口」の表のとおりに扱う（Task 4a・4b・5）
- **L-068**（新しいフォルダの行は配下を含めて照合する）: `matches` はフォルダの表記（末尾 `/`）の下を `/` の境目で前方一致にする（Task 3。B-2 の `mixed` の判定の土台）
- **L-100**（待つ側と待たれる側の上限）: 受け口の 5 秒と hook の `timeout` 10 秒は段階 A のまま。打ち切りの後も続く待ちは `signal` の中止で止め、打ち切った区間に印を立てる（Task 1b・4b）
- **L-101・L-434**（真偽値でなく Promise を共有する。完了前の同時の呼び出しを合流する）: 同期の依頼は待っている依頼の Promise を共有し、走り始めたら外す（Task 4b）
- **L-103**（往復〈ABA〉を値の比較で取りこぼさない）: ツールの開始は区切りを待たせ、待てなかった区間には印を立てる。始点を取っている間の通し番号の変化・合図の往復も拾う（Task 3・4b）
- **L-152**（確認の文言が副作用の差を伝える）: 区切りの途中に列の外から立った印の区間を割り当てなかったときに `hadUnassignedSince` を立てる（B-2 の確認の文言の土台。Task 4b・5）
- **L-153・L-166**（ライブリージョン）: B-1 は画面を変えないため当たらない（B-2 の区別の状態の 1 行は読み上げない設計）
- **L-167**（テストの入力が分岐の違いを作る）: 偽の `takeSnapshot`・`collectBetween` の完了を外から解決し、区切りの最中・差分の最中・同期の手順 8 の後の `PreToolUse`・打ち切りを順序どおりに起こす（Task 4b・5）
- **L-178**（`void promise.then` で観測しない）・**L-185**（固定時間で待たない）: テストの規約のとおり（全タスク）
- **L-413**（隠した要素を `aria-describedby` で参照しない）: B-1 は画面を変えないため当たらない（B-2）
- **L-417**（取り直しの契機を表示用の派生値にしない）: 作業の終わりの知らせは、タブごとの「`working` を見てから `idle` を見た」出来事で送る（Task 2a）
- **L-427**（一時的な失敗と前提の崩れを区別する）: ターンの終わりの知らせが届かないことは `lost` にせず保留にし、次の知らせで区別を続ける。許可の確認の待ち（`permission`・`confirm`）は待ちの対象にしない（Task 2a）
- **L-435**（閉じた後の非同期の完了が後始末をすり抜けない）: 受け口の `close` の後に待ちのタイマーが `onToolStartTimedOut` を呼ばない・要求を `deliver` しない（Task 1b）。registry の `close` の後の同期は取れた区切りを同期で消して記録を変えない（Task 4b・5）
- **L-436**（死んだ資源を作り直す）: 待ち受けの後に止まった受け口の `listening` を捨て、次の起動で始め直す（Task 1b）
- **L-438**（await を挟まない区間は同期の関数に閉じ込める）: starter の `spawnSession` は同期の関数のまま、`exited` の購読を `activate` の前に移す（Task 2b）
- **L-439**（理由の型を用途ごとに分ける）: 追跡の `AgentHooksLostReason` と記録の `AgentChangesAttributionLostReason` を別の型にし、記録の側が追跡の理由を受けられることを型で確かめる（Task 3）
- **L-440**（実 I/O は使う describe の中だけで用意する）: 実 git の結合テスト（Task 4b・5）

### ファイルの構成（作る・変えるもの）

| ファイル | 責務 | タスク |
| --- | --- | --- |
| `src/main/agentHookProtocol.ts` | `PostToolBatch`（9 つ目のイベント・パスの段）と先頭の説明 | 1a |
| `src/main/agentHookEvents.ts` | `batch-end` と `confirm-only` の理由 `batch-end-unreadable`・`subagent-batch-end` | 1a |
| `src/main/agentToolIntervals.ts` | `ended` と `batch-end`（1a）、あふれの `overflowed`・`hasUnassignableInterval`・`subagent-stop` の控え（1b） | 1a・1b |
| `src/main/agentToolActivity.ts` | ログの `unassignable=`（1a）、`hasUnassignableInterval` での合図（1b）、`reportWorkingEnded`・30 秒の待ち・保留と解除・`onPhaseChange` の例外を握る（2a） | 1a・1b・2a |
| `src/main/agentHookReceiver.ts` | 常駐の `error` ハンドラ・`onToolStart` の同期の throw・`close` の後の待ちと要求（頑健性の 1〜3） | 1b |
| `src/main/__tests__/helpers/agentHookEventFixtures.ts` | `batchEnd()` | 1a |
| `src/main/handlers/agentTerminalHandlers.ts` | `agentTerminal:reportWorkingEnded`・依存 `reportWorkingEnded`・2 つの知らせの検査の共通化 | 2a |
| `src/preload/api.ts`・`src/preload/index.d.ts` | `reportAgentSessionWorkingEnded` | 2a |
| `src/renderer/src/lib/agentTerminalApi.ts` | `reportAgentSessionWorkingEnded` | 2a |
| `src/renderer/src/hooks/useAgentHooksWorkingReport.ts` | 作業の終わりの知らせ | 2a |
| `src/renderer/src/__tests__/setup.ts` | `window.api` の偽物に `reportAgentSessionWorkingEnded` | 2a |
| `src/main/agentHookSessions.ts` | `activate` の `addSession` → `addToken` の順 | 2b |
| `src/main/agentSessionStarter.ts` | `exited` の購読を `activate` の前に・`activate` と後始末の例外を握る | 2b |
| `src/shared/types/agentChanges.ts` | `AgentChangeAuthor`・`AgentChangesAttributionLostReason`・`AgentChangesAttributionSummary`（定義だけ） | 3 |
| `src/main/agentChangesAttribution.ts`（新規） | 区別の型・`initialAttribution`・`matches`・`authorsOf`・`needsCurrentPeriod`・`summarizeAttribution`・`attributionTempDirs`・`attributionLogLine`（純粋な関数） | 3 |
| `src/main/agentChangesQuery.ts` | `collectAgentChangeEntriesBetween` を export し、説明に判定の区切りでも使うことを足す | 3 |
| `src/main/agentChangesRecord.ts` | `attribution` の項目・`createAgentChangesRecord` の引数・`agentChangesRecordTempDirs` に判定の区切りと削除待ち | 4a |
| `src/main/agentBaselineRegistry.ts` | 依存 `attribution`・`attributionDevLog`・`collectBetween`・`begin` の区別の初期値と開始のログ（4a）、`notifyAttributionSignal`・`syncAttribution`・`waitForAgentPhase`・`markPeriodUnassignable`・始点の後の同期（4b）、`withAttributionAbsorbed`・`undoLastRevert` の吸収（5） | 4a・4b・5 |
| `src/main/agentChangesAttributionSync.ts`（新規） | 同期の手順（`syncAttributionStep`）・吸収の手順（`absorbBeforeTask`・`absorbAfterTask`）・`markAttributionLost`（registry が列の中で呼ぶ） | 4b・5 |
| `src/main/__tests__/helpers/agentBaselineFixtures.ts` | `makeAgentChangesRecord` の `attribution` の既定値・`makeTrackingAttribution`・`createFakeAttributionSource` | 4a |
| `src/main/handlers/agentChangesHandlers.ts` | 戻す 3 つを吸収で包む・依存の `Pick` に `withAttributionAbsorbed` | 5 |
| `src/main/ipcHandlers.ts` | 作業の終わりの handler の依存（2a）、registry の依存（4a）、runtime の 3 つのつなぎ先（5） | 2a・4a・5 |
| `src/main/agentHooksRuntime.ts`・`src/main/agentHookReceiver.ts`・`src/main/agentToolActivity.ts` の説明 | 「段階 A は何もしない」の説明をつないだ後の説明に直す | 5 |
| `docs/manual-test-spec.md`・`ROADMAP.md` | 実機テスト仕様書（AGC-105〜109 と既存の項目の変更）と ROADMAP の進捗 | 6 |

---

### Task 1a: `PostToolBatch` で区間を閉じる（`agentHookProtocol`・`agentHookSettings` のテスト・`agentHookEvents`・`agentToolIntervals` の `ended`・追跡のログ）

> **気をつける知見:** L-002・L-044（`PostToolBatch` の本文を読めない・`agent_id` がある・形の違う `agent_id` で区間を閉じない）・L-045（設定の JSON の完全一致を直す）

`ended` の導入で前提が変わる段階 A の既存のテスト（`agentToolActivity`・`agentToolIntervals` の「`PostToolUse` で閉じる・2 秒後に `idle`」の類と、結合テスト）をこのタスクで直す。

**Files:**
- Modify: `src/main/agentHookProtocol.ts`（`AgentHookEventName`・`AGENT_HOOK_EVENT_NAMES`・`AGENT_HOOK_EVENT_PATH_SEGMENTS`・先頭と `agentHookEventOfPath` の説明）
- Modify: `src/main/agentHookEvents.ts`（`AgentHookConfirmOnlyReason`・`AgentHookEvent`・`eventWithoutBody`・`parseAgentHookRequest`）
- Modify: `src/main/agentToolIntervals.ts`（`IdInterval.ended`・`tool-end` の規則 (1)・`batch-end`・`turn-end`・`session-end`）
- Modify: `src/main/agentToolActivity.ts`（`writeLog`・`publish` のログの `unassignable=`）
- Modify: `src/main/__tests__/helpers/agentHookEventFixtures.ts`（`batchEnd`）
- Test: `src/main/__tests__/agentHookProtocol.test.ts`・`agentHookSettings.test.ts`・`agentHookEvents.test.ts`・`agentHookReceiver.test.ts`・`agentToolIntervals.test.ts`・`agentToolActivity.test.ts`・`agentHooks.integration.test.ts`

**Interfaces:**
- Consumes: 段階 A の `parseAgentHookRequest(pathEvent, body): AgentHookParseResult`・`applyToolIntervalEvent(intervals, event, now)`・`createAgentToolActivity({ onPhaseChange, devLog, warn })`
- Produces:
```ts
// src/main/agentHookProtocol.ts
export type AgentHookEventName =
  | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'PostToolBatch'
  | 'SubagentStop' | 'Stop' | 'StopFailure' | 'SessionEnd'

// src/main/agentHookEvents.ts
export type AgentHookConfirmOnlyReason =
  | 'prompt-submit' | 'unknown-tool-end' | 'bad-agent-id' | 'subagent-stop-without-agent'
  | 'batch-end-unreadable' | 'subagent-batch-end'
export type AgentHookEvent = { hookEventName: AgentHookEventName; toolName: string | null } & (
  | { kind: 'confirm-only'; reason: AgentHookConfirmOnlyReason }
  | { kind: 'tool-start'; toolId: ToolIdRead; agentId: string | null }
  | { kind: 'tool-end'; toolId: ToolIdRead; agentId: string | null }
  | { kind: 'batch-end' }
  | { kind: 'subagent-stop'; agentId: string }
  | { kind: 'turn-end' }
  | { kind: 'session-end' }
)

// src/main/agentToolIntervals.ts
export interface IdInterval extends OpenInterval {
  agentId: string | null
  /** 自分の tool-end を受け、PostToolBatch を待っている(agent_id の無い区間だけ) */
  ended: boolean
}

// src/main/__tests__/helpers/agentHookEventFixtures.ts
export const batchEnd = (): AgentHookEvent
```

- [ ] **Step 1: 失敗するテストを書く（新しい挙動）**

`src/main/__tests__/helpers/agentHookEventFixtures.ts` の末尾に足す:
```ts
export const batchEnd = (): AgentHookEvent => ({
  kind: 'batch-end',
  hookEventName: 'PostToolBatch',
  toolName: null
})
```

`src/main/__tests__/agentHookEvents.test.ts` の末尾に足す:
```ts
describe('parseAgentHookRequest(PostToolBatch)', () => {
  it('agent_id が無ければ batch-end', () => {
    expect(parse('PostToolBatch', { hook_event_name: 'PostToolBatch', session_id: 's' })).toEqual({
      event: { kind: 'batch-end', hookEventName: 'PostToolBatch', toolName: null },
      notes: []
    })
  })

  it('agent_id があれば confirm-only(subagent-batch-end。サブエージェントのバッチの終わりでメインの区間を閉じない)', () => {
    expect(
      parse('PostToolBatch', { hook_event_name: 'PostToolBatch', agent_id: 'ag-1' })
    ).toEqual({
      event: {
        kind: 'confirm-only',
        reason: 'subagent-batch-end',
        hookEventName: 'PostToolBatch',
        toolName: null
      },
      notes: []
    })
  })

  it('agent_id の形が違えば confirm-only(bad-agent-id。notes に bad-agent-id)', () => {
    expect(parse('PostToolBatch', { hook_event_name: 'PostToolBatch', agent_id: 7 })).toEqual({
      event: {
        kind: 'confirm-only',
        reason: 'bad-agent-id',
        hookEventName: 'PostToolBatch',
        toolName: null
      },
      notes: ['bad-agent-id']
    })
  })

  it.each<[string, AgentHookBody, string[]]>([
    ['16 MiB を超えた', { kind: 'too-large' }, []],
    ['読み込みの失敗', { kind: 'unreadable' }, ['unreadable-body']],
    ['JSON でない', { kind: 'text', text: '{' }, ['unreadable-body']],
    ['イベント名がパスと違う', json({ hook_event_name: 'Stop' }), ['event-name-mismatch']]
  ])('%s ときは confirm-only(batch-end-unreadable。区間を閉じる根拠にしない)', (_label, body, notes) => {
    expect(parseAgentHookRequest('PostToolBatch', body)).toEqual({
      event: {
        kind: 'confirm-only',
        reason: 'batch-end-unreadable',
        hookEventName: 'PostToolBatch',
        toolName: null
      },
      notes
    })
  })
})
```

`src/main/__tests__/agentHookReceiver.test.ts` の `describe('createAgentHookReceiver(受け付ける要求)', ...)` の最後に足す:
```ts
  it('PostToolBatch のパス(post-tool-batch)も受け付け、batch-end を deliver する', async () => {
    await start()
    const response = await post('post-tool-batch', {
      hook_event_name: 'PostToolBatch',
      session_id: 'c1'
    })
    expect(response.status).toBe(200)
    expect(delivered).toEqual([
      [7, 'sid-1', { kind: 'batch-end', hookEventName: 'PostToolBatch', toolName: null }]
    ])
  })
```

`src/main/__tests__/agentToolIntervals.test.ts`: import に `batchEnd` を足し（`./helpers/agentHookEventFixtures` から）、末尾に足す:
```ts
describe('applyToolIntervalEvent(PostToolBatch と ended)', () => {
  it('ID があって agent_id の無い区間は、自分の tool-end で外さずに ended にし、batch-end で外す(控えない)', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a'), 0)
    applyToolIntervalEvent(intervals, toolEnd('a'), 1)
    expect(intervals.openTools.get('a')).toEqual({
      agentId: null,
      openedAt: 0,
      expired: false,
      ended: true
    })
    expect(openCountOf(intervals)).toBe(1)
    applyToolIntervalEvent(intervals, batchEnd(), 2)
    expect(openCountOf(intervals)).toBe(0)
    expect(intervals.droppedToolIds.size).toBe(0)
  })

  it('ended の区間の 2 回目の tool-end では何も変わらない(ID なしの区間を閉じない)', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a'), 0)
    applyToolIntervalEvent(intervals, toolStart(null), 0)
    applyToolIntervalEvent(intervals, toolEnd('a'), 1)
    applyToolIntervalEvent(intervals, toolEnd('a'), 2)
    expect(intervals.openTools.get('a')?.ended).toBe(true)
    expect(intervals.anonymousOpen).toHaveLength(1)
  })

  it('batch-end は ended でない区間(同じバッチで並行に動くツール)・agent_id のある区間・ID なしの区間を残す', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a'), 0)
    applyToolIntervalEvent(intervals, toolStart('b'), 0)
    applyToolIntervalEvent(intervals, toolStart('c', 'x'), 0)
    applyToolIntervalEvent(intervals, toolStart(null), 0)
    applyToolIntervalEvent(intervals, toolEnd('a'), 1)
    applyToolIntervalEvent(intervals, batchEnd(), 2)
    expect([...intervals.openTools.keys()]).toEqual(['b', 'c'])
    expect(intervals.anonymousOpen).toHaveLength(1)
  })

  it('agent_id のある区間は今どおり自分の tool-end で外す', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a', 'x'), 0)
    applyToolIntervalEvent(intervals, toolEnd('a', 'x'), 1)
    expect(openCountOf(intervals)).toBe(0)
  })

  it('ended の区間も期限切れになり、batch-end で外す', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a'), 0)
    applyToolIntervalEvent(intervals, toolEnd('a'), 1)
    markExpiredIntervals(intervals, 100, 50)
    expect(intervals.openTools.get('a')?.expired).toBe(true)
    applyToolIntervalEvent(intervals, batchEnd(), 101)
    expect(openCountOf(intervals)).toBe(0)
  })

  it('turn-end・session-end は ended の区間も外し、その ID を控えない(遅れた tool-end は来ない)', () => {
    const forTurn = createToolIntervals()
    applyToolIntervalEvent(forTurn, toolStart('a'), 0)
    applyToolIntervalEvent(forTurn, toolStart('b'), 0)
    applyToolIntervalEvent(forTurn, toolEnd('a'), 1)
    applyToolIntervalEvent(forTurn, turnEnd(), 2)
    expect(openCountOf(forTurn)).toBe(0)
    expect([...forTurn.droppedToolIds]).toEqual(['b'])

    const forSession = createToolIntervals()
    applyToolIntervalEvent(forSession, toolStart('a'), 0)
    applyToolIntervalEvent(forSession, toolStart('b'), 0)
    applyToolIntervalEvent(forSession, toolEnd('a'), 1)
    applyToolIntervalEvent(forSession, sessionEnd(), 2)
    expect(openCountOf(forSession)).toBe(0)
    expect([...forSession.droppedToolIds]).toEqual(['b'])
  })
})
```

`src/main/__tests__/agentToolActivity.test.ts`: import に `batchEnd` を足し、`describe('createAgentToolActivity(区間と猶予)', ...)` の最後に足す:
```ts
  it('PostToolBatch が届かなければ ended の区間は Stop で閉じ、その 2 秒後に idle', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('a'))
    tracker.deliver(1, 's1', toolEnd('a'))
    passGrace()
    expect(phase()).toBe('agent')
    tracker.deliver(1, 's1', turnEnd())
    vi.advanceTimersByTime(AGENT_TOOL_END_GRACE_MS - 1)
    expect(phase()).toBe('agent')
    vi.advanceTimersByTime(1)
    expect(phase()).toBe('idle')
  })

  it('PostToolBatch が届かなければ ended の区間は 15 分で期限切れになり unassignable が立つ。PostToolBatch で下りる', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('a'))
    tracker.deliver(1, 's1', toolEnd('a'))
    vi.advanceTimersByTime(AGENT_TOOL_INTERVAL_MAX_MS)
    expect(tracker.activityOf(1)).toEqual({ phase: 'agent', lost: null, unassignable: true })
    tracker.deliver(1, 's1', batchEnd())
    expect(tracker.activityOf(1).unassignable).toBe(false)
  })

  it('agent_id のある区間は今どおり PostToolUse で閉じ、その 2 秒後に idle', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('a', 'ag-1'))
    tracker.deliver(1, 's1', toolEnd('a', 'ag-1'))
    passGrace()
    expect(phase()).toBe('idle')
  })
```
同じファイルの `describe('createAgentToolActivity(ログと後始末)', ...)` の最後に足す:
```ts
  it('PostToolBatch の行は event=PostToolBatch で、ツールの名前・ID・agent_id の欄は -', () => {
    confirmed(1, 'abcdefgh-1234')
    tracker.deliver(1, 'abcdefgh-1234', toolStart('a'))
    tracker.deliver(1, 'abcdefgh-1234', toolEnd('a'))
    tracker.deliver(1, 'abcdefgh-1234', batchEnd())
    expect(devLog.mock.calls.at(-1)?.[0]).toBe(
      '[agent-hooks] owner=1 session=abcdefgh event=PostToolBatch tool=- id=- agent=- hooks=confirmed phase=agent→agent unassignable=なし'
    )
  })
```

- [ ] **Step 2: 前提が変わる段階 A の既存のテストを直す**

`src/main/__tests__/agentHookProtocol.test.ts`:
- `'渡すイベントは 8 つで、設定の JSON に書く順に並ぶ'` を次に置き換える:
```ts
  it('渡すイベントは 9 つで、設定の JSON に書く順に並ぶ(PostToolBatch は PostToolUseFailure の後)', () => {
    expect(AGENT_HOOK_EVENT_NAMES).toEqual([
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'PostToolBatch',
      'SubagentStop',
      'Stop',
      'StopFailure',
      'SessionEnd'
    ])
  })
```
- `'8 つのイベントとパスを相互に引ける'` の題を `'9 つのイベントとパスを相互に引ける'` にし、その後に足す:
```ts
  it('PostToolBatch のパスは /prompt-ide/agent-hooks/v1/post-tool-batch', () => {
    expect(agentHookPathOf('PostToolBatch')).toBe('/prompt-ide/agent-hooks/v1/post-tool-batch')
    expect(agentHookEventOfPath('/prompt-ide/agent-hooks/v1/post-tool-batch')).toBe('PostToolBatch')
  })
```
- `it.each([...])('完全一致でないパス %s は null', ...)` の配列から `'/prompt-ide/agent-hooks/v1/post-tool-batch',` の行を消す（受け付けるパスになった）

`src/main/__tests__/agentHookSettings.test.ts` の `'8 つのイベントの http の hook を完全一致の形で返す(SessionStart・PostToolBatch は渡さない)'` を次に置き換える（`hook(segment, timeout = 5)` はこのファイルの既存の補助関数）:
```ts
  it('9 つのイベントの http の hook を完全一致の形で返す(SessionStart は渡さない。PostToolBatch は matcher なし・timeout 5)', () => {
    expect(buildAgentHookSettings({ baseUrl: BASE, token: TOKEN })).toStrictEqual({
      hooks: {
        UserPromptSubmit: [{ hooks: [hook('user-prompt-submit')] }],
        PreToolUse: [{ matcher: MATCHER, hooks: [hook('pre-tool-use', 10)] }],
        PostToolUse: [{ matcher: MATCHER, hooks: [hook('post-tool-use')] }],
        PostToolUseFailure: [{ matcher: MATCHER, hooks: [hook('post-tool-use-failure')] }],
        PostToolBatch: [{ hooks: [hook('post-tool-batch')] }],
        SubagentStop: [{ hooks: [hook('subagent-stop')] }],
        Stop: [{ hooks: [hook('stop')] }],
        StopFailure: [{ hooks: [hook('stop-failure')] }],
        SessionEnd: [{ hooks: [hook('session-end')] }]
      }
    })
  })
```
（`hook` の第 2 引数の `timeout` の既定は 5 で、`AGENT_HOOK_TIMEOUT_SECONDS` と同じ）

`src/main/__tests__/agentHookEvents.test.ts` の `describe('parseAgentHookRequest(読めない本文)', ...)` の `it.each` の本体の最後に足す:
```ts
    expect(parseAgentHookRequest('PostToolBatch', body).event).toMatchObject({
      kind: 'confirm-only',
      reason: 'batch-end-unreadable'
    })
```

`src/main/__tests__/agentToolIntervals.test.ts`:
- `'tool-start は ID のある区間を now で開き、同じ ID は開き直さない'` の期待値を `[['a', { agentId: 'agent-1', openedAt: 10, expired: false, ended: false }]]` に直す
- `'(1) 開いた ID の区間を閉じ、ID なしの区間は残す'` を次に置き換える:
```ts
  it('(1) 開いた ID の区間は、agent_id が無ければ外さずに ended にし(PostToolBatch を待つ)、ID なしの区間は残す', () => {
    const intervals = opened()
    applyToolIntervalEvent(intervals, toolEnd('a'), 2)
    expect(intervals.openTools.get('a')?.ended).toBe(true)
    expect(intervals.anonymousOpen).toHaveLength(2)
  })
```

`src/main/__tests__/agentToolActivity.test.ts`:
- `'区間が閉じてから 2 秒は agent、その後 idle'` を次に置き換える:
```ts
  it('PostToolUse の後も agent のまま。PostToolBatch で閉じてから 2 秒は agent、その後 idle', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('a'))
    tracker.deliver(1, 's1', toolEnd('a'))
    passGrace()
    expect(phase()).toBe('agent')
    tracker.deliver(1, 's1', batchEnd())
    vi.advanceTimersByTime(AGENT_TOOL_END_GRACE_MS - 1)
    expect(phase()).toBe('agent')
    vi.advanceTimersByTime(1)
    expect(phase()).toBe('idle')
  })
```
- `'猶予の間の tool-start で猶予を取り消し、段階は agent のまま変わらない'` の 2 か所の `tracker.deliver(1, 's1', toolEnd('a'))`・`tracker.deliver(1, 's1', toolEnd('b'))` の直後に、それぞれ `tracker.deliver(1, 's1', batchEnd())` を足す
- `'同じ ID の tool-start が 2 回でも区間は 1 つ'` の `tracker.deliver(1, 's1', toolEnd('a'))` の直後に `tracker.deliver(1, 's1', batchEnd())` を足す
- `'期限切れの区間は自分の tool-end で閉じる'` を次に置き換える（ID があって `agent_id` の無い区間は `PostToolBatch` で閉じる形を上の新しいテストで見る）:
```ts
  it('agent_id のある期限切れの区間は自分の tool-end で閉じる', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('a', 'ag-1'))
    vi.advanceTimersByTime(AGENT_TOOL_INTERVAL_MAX_MS)
    expect(tracker.activityOf(1).unassignable).toBe(true)
    tracker.deliver(1, 's1', toolEnd('a', 'ag-1'))
    expect(tracker.activityOf(1).unassignable).toBe(false)
  })
```
- `'開発版のログに 1 行ずつ出す(トークン・本文は無い)'` の期待値を次に直す:
```ts
    expect(devLog.mock.calls.map(([line]) => line)).toEqual([
      '[agent-hooks] owner=1 session=abcdefgh event=起動 tool=- id=- agent=- hooks=pending phase=paused→agent unassignable=なし',
      '[agent-hooks] owner=1 session=abcdefgh event=PreToolUse tool=Edit id=あり agent=なし hooks=confirmed phase=agent→agent unassignable=なし'
    ])
```

`src/main/__tests__/agentHooks.integration.test.ts` の最初のテストの題を `'pending(agent) → UserPromptSubmit で idle → PreToolUse で agent → PostToolUse の後も agent → PostToolBatch の 2 秒後に idle。release の後は 401'` にし、`PostToolUse` を送った後の部分（`expect(tracker.activityOf(1).phase).toBe('agent')` から `vi.waitFor(...)` まで）を次に置き換える:
```ts
    expect(tracker.activityOf(1).phase).toBe('agent')
    // PostToolUse では閉じない(PostToolBatch を待つ)
    await new Promise((resolve) => setTimeout(resolve, 2_100))
    expect(tracker.activityOf(1).phase).toBe('agent')
    expect(
      (await post('PostToolBatch', { hook_event_name: 'PostToolBatch', session_id: 'c1' })).status
    ).toBe(200)
    expect(tracker.activityOf(1).phase).toBe('agent')
    await vi.waitFor(() => expect(tracker.activityOf(1).phase).toBe('idle'), {
      timeout: 4_000,
      interval: 100
    })
```
（`setTimeout` の 2,100 ミリ秒は「猶予の 2 秒を過ぎても閉じていない」ことを見るための待ちで、状態の待ちではない。テストの上限 10 秒のままで足りる）

- [ ] **Step 3: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentHookProtocol.test.ts src/main/__tests__/agentHookSettings.test.ts src/main/__tests__/agentHookEvents.test.ts src/main/__tests__/agentHookReceiver.test.ts src/main/__tests__/agentToolIntervals.test.ts src/main/__tests__/agentToolActivity.test.ts src/main/__tests__/agentHooks.integration.test.ts`
Expected: FAIL（9 つのイベント・`PostToolBatch` の解釈・`ended`・`batch-end`・ログの `unassignable=` のテストが落ちる。`npm run typecheck` も `'batch-end'`・`'PostToolBatch'` が型に無いため落ちる）

- [ ] **Step 4: 実装する**

`src/main/agentHookProtocol.ts`:
- 先頭の型の説明と型・列挙・パスの段を次にする:
```ts
/** アプリが渡す 9 つのイベント(SessionStart は http の hook を使えないため渡さない。PostToolBatch は段階 B から渡す) */
export type AgentHookEventName =
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PostToolBatch'
  | 'SubagentStop'
  | 'Stop'
  | 'StopFailure'
  | 'SessionEnd'

/** 設定の JSON に書く順 */
export const AGENT_HOOK_EVENT_NAMES: readonly AgentHookEventName[] = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'SubagentStop',
  'Stop',
  'StopFailure',
  'SessionEnd'
]

/** イベントごとの URL のパスの最後の段(パスは agentHookPathOf・agentHookEventOfPath を通して使う) */
const AGENT_HOOK_EVENT_PATH_SEGMENTS: Readonly<Record<AgentHookEventName, string>> = {
  UserPromptSubmit: 'user-prompt-submit',
  PreToolUse: 'pre-tool-use',
  PostToolUse: 'post-tool-use',
  PostToolUseFailure: 'post-tool-use-failure',
  PostToolBatch: 'post-tool-batch',
  SubagentStop: 'subagent-stop',
  Stop: 'stop',
  StopFailure: 'stop-failure',
  SessionEnd: 'session-end'
}
```
- `agentHookEventOfPath` の説明の `8 つのどれか` を `9 つのどれか` に直す
- `AGENT_HOOK_TOOL_EVENTS` は変えない（`PostToolBatch` は matcher なし。`agentHookSettings.ts` のコードは変えない）

`src/main/agentHookEvents.ts`:
- `AgentHookConfirmOnlyReason` に 2 つを足す:
```ts
export type AgentHookConfirmOnlyReason =
  | 'prompt-submit'
  | 'unknown-tool-end'
  | 'bad-agent-id'
  | 'subagent-stop-without-agent'
  /** PostToolBatch の本文を読めない(大きすぎる・JSON でない・イベント名がパスと違う) */
  | 'batch-end-unreadable'
  /** agent_id のある PostToolBatch(サブエージェントのバッチの終わりでメインの区間を閉じない) */
  | 'subagent-batch-end'
```
- `AgentHookEvent` の `tool-end` の要素の後に `| { kind: 'batch-end' }` を足す
- `eventWithoutBody` の `switch` の `case 'PostToolUseFailure':`（`tool-end` を返す行）の後に足す:
```ts
    case 'PostToolBatch':
      // 読めない PostToolBatch で区間を閉じない(L-002・L-044)
      return { ...base, kind: 'confirm-only', reason: 'batch-end-unreadable' }
```
- `parseAgentHookRequest` の `switch` の `case 'SubagentStop': { ... }` の後に足す:
```ts
    case 'PostToolBatch': {
      // 本文を読めて agent_id が無いときだけ、メインのエージェントのバッチの終わり(区間を閉じる)にする
      const agent = readAgentId(value)
      if (agent.kind === 'absent') {
        return { event: { ...base, kind: 'batch-end' }, notes: [] }
      }
      if (agent.kind === 'bad') {
        return {
          event: { ...base, kind: 'confirm-only', reason: 'bad-agent-id' },
          notes: ['bad-agent-id']
        }
      }
      return {
        event: { ...base, kind: 'confirm-only', reason: 'subagent-batch-end' },
        notes: []
      }
    }
```

`src/main/agentToolIntervals.ts` を次の内容にする（`ended` と `batch-end`。あふれは Task 1b）:
```ts
import type { AgentHookEvent } from './agentHookEvents'

// 1 つのセッションのツールの区間の開閉の規則(設計書「ツールの区間の追跡」「PostToolBatch で区間を閉じる」。タイマーを持たない
// 状態の更新)。ID のある区間・ID なしの区間・区間を閉じる知らせを待たずに外した ID の控えを持ち、知らせごとに開閉する。
// ID があって agent_id の無い区間は、自分の tool-end で「終わった」印(ended)を付けて開いたままにし、PostToolBatch で閉じる。
// 区間が開いたままになる側(利用者の編集をエージェントに数える)に倒し、知らない・読めない知らせで区間を閉じない(L-002・L-044)。
// 確かめた状態・猶予・期限切れのタイマー・ウィンドウの段階は agentToolActivity.ts

export const AGENT_TOOL_OPEN_MAX = 256
export const AGENT_DROPPED_TOOL_IDS_MAX = 1_024

export interface OpenInterval {
  openedAt: number
  expired: boolean
}

export interface IdInterval extends OpenInterval {
  agentId: string | null
  /** 自分の tool-end を受け、PostToolBatch を待っている(agent_id の無い区間だけ) */
  ended: boolean
}

export interface ToolIntervals {
  openTools: Map<string, IdInterval>
  anonymousOpen: OpenInterval[]
  /** 区間を閉じる知らせを待たずに外した ID(遅れた tool-end で別の区間を閉じないため) */
  droppedToolIds: Set<string>
}

export const createToolIntervals = (): ToolIntervals => ({
  openTools: new Map(),
  anonymousOpen: [],
  droppedToolIds: new Set()
})

/** 開いている区間(期限切れ・ended を含む) */
export const openIntervalsOf = (intervals: ToolIntervals): OpenInterval[] => [
  ...intervals.openTools.values(),
  ...intervals.anonymousOpen
]

export const openCountOf = (intervals: ToolIntervals): number =>
  intervals.openTools.size + intervals.anonymousOpen.length

/** 控えに足す(足し直した ID は新しい側へ)。上限を超えたら古い側から捨てる */
function remember(dropped: Set<string>, id: string): void {
  dropped.delete(id)
  dropped.add(id)
  while (dropped.size > AGENT_DROPPED_TOOL_IDS_MAX) {
    const oldest = dropped.values().next().value
    if (oldest === undefined) break
    dropped.delete(oldest)
  }
}

/** 知らせ 1 件で区間を開閉する。tool-start の openedAt は呼び出し側が渡す(confirm-only は何もしない) */
export function applyToolIntervalEvent(
  intervals: ToolIntervals,
  event: AgentHookEvent,
  now: number
): void {
  switch (event.kind) {
    case 'confirm-only':
      return
    case 'tool-start': {
      if (event.toolId.kind === 'read') {
        if (intervals.openTools.has(event.toolId.id)) return
        intervals.openTools.set(event.toolId.id, {
          agentId: event.agentId,
          openedAt: now,
          expired: false,
          ended: false
        })
        if (intervals.openTools.size > AGENT_TOOL_OPEN_MAX) {
          const oldest = intervals.openTools.keys().next().value
          if (oldest !== undefined) {
            intervals.openTools.delete(oldest)
            remember(intervals.droppedToolIds, oldest)
          }
        }
        return
      }
      intervals.anonymousOpen.push({ openedAt: now, expired: false })
      if (intervals.anonymousOpen.length > AGENT_TOOL_OPEN_MAX) intervals.anonymousOpen.shift()
      return
    }
    case 'tool-end': {
      // (4) ID を読めない tool-end は何も閉じない
      if (event.toolId.kind !== 'read') return
      const id = event.toolId.id
      // (1) 開いた区間の終わり(期限切れでも同じ)。agent_id の無い区間は PostToolBatch まで開いたまま(既に ended なら何もしない)
      const interval = intervals.openTools.get(id)
      if (interval !== undefined) {
        if (interval.agentId === null) interval.ended = true
        else intervals.openTools.delete(id)
        return
      }
      // (2) 外した区間の遅れた知らせは、控えから消すだけ
      if (intervals.droppedToolIds.delete(id)) return
      // (3) PreToolUse を読めなかった区間の終わりとみなし、ID なしの一番古い区間を閉じる
      intervals.anonymousOpen.shift()
      return
    }
    case 'batch-end':
      // メインのエージェントのバッチの終わり。自分の tool-end を受けた区間だけを外す(期限切れでも同じ。控えない)。
      // ended でない区間(同じバッチで並行に動くツール)・agent_id のある区間・ID なしの区間は変えない
      for (const [id, interval] of intervals.openTools) {
        if (interval.agentId === null && interval.ended) intervals.openTools.delete(id)
      }
      return
    case 'subagent-stop':
      for (const [id, interval] of intervals.openTools) {
        if (interval.agentId === event.agentId) intervals.openTools.delete(id)
      }
      return
    case 'turn-end':
      // 背景のサブエージェントは Stop の後も動くため、agent_id のある区間と ID なしの区間は閉じない。
      // ended の区間は自分の tool-end を受けた後なので控えない
      for (const [id, interval] of intervals.openTools) {
        if (interval.agentId === null) {
          intervals.openTools.delete(id)
          if (!interval.ended) remember(intervals.droppedToolIds, id)
        }
      }
      return
    case 'session-end':
      // /clear・/resume でも届くため、セッションは外さず区間だけを閉じる
      for (const [id, interval] of intervals.openTools) {
        if (!interval.ended) remember(intervals.droppedToolIds, id)
      }
      intervals.openTools.clear()
      intervals.anonymousOpen = []
      return
  }
}

/** maxMs を過ぎた区間を外さずに期限切れにする */
export function markExpiredIntervals(intervals: ToolIntervals, now: number, maxMs: number): void {
  for (const interval of openIntervalsOf(intervals)) {
    if (!interval.expired && interval.openedAt + maxMs <= now) interval.expired = true
  }
}

/** 期限切れでない区間の一番早い openedAt(無ければ null) */
export function earliestUnexpiredOpenedAt(intervals: ToolIntervals): number | null {
  let earliest: number | null = null
  for (const interval of openIntervalsOf(intervals)) {
    if (!interval.expired && (earliest === null || interval.openedAt < earliest))
      earliest = interval.openedAt
  }
  return earliest
}
```

`src/main/agentToolActivity.ts`（ログの `unassignable=`。追跡のコードの変更はこれだけ。ツールの終わりの猶予は今どおり「所有者のすべての区間が閉じた時点」から数えるため、`ended` の区間の猶予は `PostToolBatch` から数えることになる）:
- `writeLog` の引数の `before: AgentToolPhase, after: AgentToolPhase` を `before: AgentToolActivitySignal, after: AgentToolActivitySignal` にし、行を次にする:
```ts
    devLog(
      `[agent-hooks] owner=${ownerId} session=${sessionLabel} event=${detail.event} tool=${detail.tool ?? '-'} ` +
        `id=${flag(detail.hasId)} agent=${flag(detail.hasAgent)} hooks=${hooksLabel(session)} ` +
        `phase=${before.phase}→${after.phase} unassignable=${flag(after.unassignable)}`
    )
```
- `publish` の `writeLog(ownerId, detail, session, before.phase, after.phase)` を `writeLog(ownerId, detail, session, before, after)` にする
- 型 `AgentToolPhase` を `writeLog` で使わなくなっても、`AgentToolActivitySignal` の定義が使うため export は残す

- [ ] **Step 5: 通す**

Run: `npx vitest run src/main/__tests__/agentHookProtocol.test.ts src/main/__tests__/agentHookSettings.test.ts src/main/__tests__/agentHookEvents.test.ts src/main/__tests__/agentHookReceiver.test.ts src/main/__tests__/agentToolIntervals.test.ts src/main/__tests__/agentToolActivity.test.ts src/main/__tests__/agentHooks.integration.test.ts`
Expected: PASS
Run: `npm test`
Expected: PASS（時間切れで落ちたファイルは Global Constraints のとおり単体で流し直す）
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/main/agentHookProtocol.ts src/main/agentHookEvents.ts src/main/agentToolIntervals.ts src/main/agentToolActivity.ts src/main/__tests__/helpers/agentHookEventFixtures.ts src/main/__tests__/agentHookProtocol.test.ts src/main/__tests__/agentHookSettings.test.ts src/main/__tests__/agentHookEvents.test.ts src/main/__tests__/agentHookReceiver.test.ts src/main/__tests__/agentToolIntervals.test.ts src/main/__tests__/agentToolActivity.test.ts src/main/__tests__/agentHooks.integration.test.ts && npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 6: 変異で確かめる**

1. `agentToolIntervals.ts` の `tool-end` の `if (interval.agentId === null) interval.ended = true` を `intervals.openTools.delete(id)` だけに戻し、`npx vitest run src/main/__tests__/agentToolIntervals.test.ts src/main/__tests__/agentToolActivity.test.ts` で「自分の tool-end で外さずに ended にし」「PostToolUse の後も agent のまま」が落ちることを確かめて戻す
2. `agentHookEvents.ts` の `case 'PostToolBatch':` の最後の `return`（`subagent-batch-end` を返す行。`agent_id` を読めたときのフォールスルー）を `batch-end` を返す形にし、`npx vitest run src/main/__tests__/agentHookEvents.test.ts` で「agent_id があれば confirm-only(subagent-batch-end…)」が落ちることを確かめて戻す

- [ ] **Step 7: コミット（利用者の指示があるときだけ）**

```bash
git add src/main/agentHookProtocol.ts src/main/agentHookEvents.ts src/main/agentToolIntervals.ts src/main/agentToolActivity.ts src/main/__tests__/helpers/agentHookEventFixtures.ts src/main/__tests__/agentHookProtocol.test.ts src/main/__tests__/agentHookSettings.test.ts src/main/__tests__/agentHookEvents.test.ts src/main/__tests__/agentHookReceiver.test.ts src/main/__tests__/agentToolIntervals.test.ts src/main/__tests__/agentToolActivity.test.ts src/main/__tests__/agentHooks.integration.test.ts
git commit -m "feat: PostToolBatch を hooks に加え、ID があって agent_id の無い区間をバッチの終わりまで開いたままにする"
```

---

### Task 1b: 段階 A の最終レビューで残した頑健性の 1〜4（受け口の `error`・`onToolStart` の同期の throw・`close` の後・区間のあふれと `subagent-stop` の控え）

> **気をつける知見:** L-002（待ちの失敗・あふれを「割り当てない」に倒す）・L-044（`subagent-stop` で外した ID の遅れた `tool-end` で別の区間を閉じない）・L-055（同期の throw）・L-100・L-435（`close` の後に完了する待ち・要求）・L-436（止まった受け口を作り直す）

**Files:**
- Modify: `src/main/agentHookReceiver.ts`（`ensureListening` の `error` ハンドラ・`waitForToolStart`・`handle` の先頭と本文の後・`close`）
- Modify: `src/main/agentToolIntervals.ts`（`ToolIntervals.overflowed`・`tool-start` のあふれ・`subagent-stop` の控え・`session-end` で下ろす・`openCountOf`・新しい `hasUnassignableInterval`）
- Modify: `src/main/agentToolActivity.ts`（`signalOf` の `unassignable` を `hasUnassignableInterval` で求める）
- Test: `src/main/__tests__/agentHookReceiver.test.ts`・`agentToolIntervals.test.ts`・`agentToolActivity.test.ts`

**Interfaces:**
- Consumes: Task 1a の `IdInterval.ended`・`batch-end`
- Produces:
```ts
// src/main/agentToolIntervals.ts
export interface ToolIntervals {
  openTools: Map<string, IdInterval>
  anonymousOpen: OpenInterval[]
  droppedToolIds: Set<string>
  /** 上限(AGENT_TOOL_OPEN_MAX)を超える tool-start を受けた。session-end と pty の終了でだけ下ろす */
  overflowed: boolean
}
/** 割り当てられない区間がある(期限切れの区間がある・あふれた) */
export function hasUnassignableInterval(intervals: ToolIntervals): boolean
// openCountOf は overflowed のとき 1 を足す

// src/main/agentHookReceiver.ts(公開の型は変えない)
// - onToolStart の同期の throw・reject は「待ちの失敗」として、打ち切りと同じく signal を中止して onToolStartTimedOut を呼ぶ
// - close は待っている PreToolUse のタイマーを外して signal を中止し、onToolStartTimedOut を呼ばない。close の後の要求は 503
// - 待ち受けの後の server の error でログを出して server を閉じ、次の ensureListening で始め直す
```

- [ ] **Step 1: 区間の失敗するテストを書く**

`src/main/__tests__/agentToolIntervals.test.ts`: import に `hasUnassignableInterval` を足し、`describe('applyToolIntervalEvent', ...)` の中の次の 3 つのテストを置き換える。

`` it(`ID のある区間が ${AGENT_TOOL_OPEN_MAX} 件を超えたら一番古い ID を外して控える`, ...) `` を:
```ts
  it(`ID のある区間が ${AGENT_TOOL_OPEN_MAX} 件ある間の tool-start は区間を足さず(一番古い区間も外さない)、overflowed を立てて ID を控える`, () => {
    const intervals = createToolIntervals()
    for (let i = 0; i < AGENT_TOOL_OPEN_MAX; i++)
      applyToolIntervalEvent(intervals, toolStart(`id-${i}`), i)
    applyToolIntervalEvent(intervals, toolStart('over'), 999)
    expect(intervals.openTools.size).toBe(AGENT_TOOL_OPEN_MAX)
    expect(intervals.openTools.has('id-0')).toBe(true)
    expect(intervals.openTools.has('over')).toBe(false)
    expect(intervals.overflowed).toBe(true)
    expect(intervals.droppedToolIds.has('over')).toBe(true)
    expect(openCountOf(intervals)).toBe(AGENT_TOOL_OPEN_MAX + 1)
    expect(hasUnassignableInterval(intervals)).toBe(true)
  })
```
`` it(`ID なしの区間が ${AGENT_TOOL_OPEN_MAX} 件を超えたら一番古い区間を捨てる`, ...) `` を:
```ts
  it(`ID なしの区間も ${AGENT_TOOL_OPEN_MAX} 件ある間の tool-start は足さず(一番古い区間も捨てない)、overflowed を立てる`, () => {
    const intervals = createToolIntervals()
    for (let i = 0; i <= AGENT_TOOL_OPEN_MAX; i++)
      applyToolIntervalEvent(intervals, toolStart(null), i)
    expect(intervals.anonymousOpen).toHaveLength(AGENT_TOOL_OPEN_MAX)
    expect(intervals.anonymousOpen[0].openedAt).toBe(0)
    expect(intervals.overflowed).toBe(true)
  })
```
`'subagent-stop は同じ agent_id の区間だけを閉じ、控えない'` を:
```ts
  it('subagent-stop は同じ agent_id の区間だけを閉じ、外した ID を控える', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a', 'x'), 0)
    applyToolIntervalEvent(intervals, toolStart('b', 'y'), 0)
    applyToolIntervalEvent(intervals, subagentStop('x'), 1)
    expect([...intervals.openTools.keys()]).toEqual(['b'])
    expect([...intervals.droppedToolIds]).toEqual(['a'])
  })
```
同じファイルの末尾に足す:
```ts
describe('あふれと控え(頑健性の 4)', () => {
  it('あふれた ID の遅れた tool-end は、ID なしの区間を閉じない', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart(null), 0)
    // 上限は ID のある区間と ID なしの区間で別に数える(ID のある区間を 256 件にする)
    for (let i = 0; i < AGENT_TOOL_OPEN_MAX; i++)
      applyToolIntervalEvent(intervals, toolStart(`id-${i}`), i)
    applyToolIntervalEvent(intervals, toolStart('over'), 999)
    applyToolIntervalEvent(intervals, toolEnd('over'), 1_000)
    expect(intervals.anonymousOpen).toHaveLength(1)
  })

  it('overflowed は turn-end では残り(どのエージェントの区間かが分からない)、session-end で下ろす', () => {
    const intervals = createToolIntervals()
    for (let i = 0; i <= AGENT_TOOL_OPEN_MAX; i++)
      applyToolIntervalEvent(intervals, toolStart(`id-${i}`), i)
    applyToolIntervalEvent(intervals, turnEnd(), 1_000)
    expect(intervals.overflowed).toBe(true)
    expect(openCountOf(intervals)).toBe(1)
    applyToolIntervalEvent(intervals, sessionEnd(), 1_001)
    expect(intervals.overflowed).toBe(false)
    expect(openCountOf(intervals)).toBe(0)
  })

  it('subagent-stop で外した ID の遅れた tool-end は、ID なしの区間を閉じない', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart(null), 0)
    applyToolIntervalEvent(intervals, toolStart('a', 'x'), 0)
    applyToolIntervalEvent(intervals, subagentStop('x'), 1)
    applyToolIntervalEvent(intervals, toolEnd('a', 'x'), 2)
    expect(intervals.anonymousOpen).toHaveLength(1)
  })

  it('hasUnassignableInterval は期限切れの区間があるか overflowed のときだけ真', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a'), 0)
    expect(hasUnassignableInterval(intervals)).toBe(false)
    markExpiredIntervals(intervals, 100, 50)
    expect(hasUnassignableInterval(intervals)).toBe(true)
    const overflowed = createToolIntervals()
    overflowed.overflowed = true
    expect(hasUnassignableInterval(overflowed)).toBe(true)
  })
})
```

`src/main/__tests__/agentToolActivity.test.ts` の `` it(`開いた区間は ${AGENT_TOOL_OPEN_MAX} 件まで。超えたら一番古い ID を外し、外した ID として控える`, ...) `` を置き換える:
```ts
  it(`開いた区間が ${AGENT_TOOL_OPEN_MAX} 件を超えたら区間を足さず、あふれた印で開いた区間ありかつ unassignable にする。session-end で下ろす`, () => {
    confirmed()
    for (let i = 0; i < AGENT_TOOL_OPEN_MAX; i++)
      tracker.deliver(1, 's1', toolStart(`id-${i}`, 'ag'))
    onPhaseChange.mockClear()
    tracker.deliver(1, 's1', toolStart('over', 'ag'))
    expect(tracker.activityOf(1)).toEqual({ phase: 'agent', lost: null, unassignable: true })
    expect(onPhaseChange).toHaveBeenCalledExactlyOnceWith(1)
    for (let i = 0; i < AGENT_TOOL_OPEN_MAX; i++)
      tracker.deliver(1, 's1', toolEnd(`id-${i}`, 'ag'))
    tracker.deliver(1, 's1', turnEnd())
    passGrace()
    expect(tracker.activityOf(1)).toEqual({ phase: 'agent', lost: null, unassignable: true })
    tracker.deliver(1, 's1', sessionEnd())
    passGrace()
    expect(tracker.activityOf(1)).toEqual({ phase: 'idle', lost: null, unassignable: false })
  })

  it('あふれたセッションの印は pty の終了(removeSession)で外れる', () => {
    confirmed(1, 's1')
    confirmed(1, 's2')
    for (let i = 0; i <= AGENT_TOOL_OPEN_MAX; i++) tracker.deliver(1, 's1', toolStart(`id-${i}`))
    expect(tracker.activityOf(1).unassignable).toBe(true)
    tracker.removeSession(1, 's1')
    passGrace()
    expect(tracker.activityOf(1)).toEqual({ phase: 'idle', lost: null, unassignable: false })
  })
```

- [ ] **Step 2: 受け口の失敗するテストを書く**

`src/main/__tests__/agentHookReceiver.test.ts`:
- ファイルの先頭の import の直後（`import { request } from 'node:http'` を含む既存の import の後）に、作った server を控える差し替えを足す（受け口は `createServer` を名前付きで import する。組み込みのモジュールは `default` 経由でも解決されるため両方を差し替える）:
```ts
import type { IncomingMessage, Server } from 'node:http'

// 受け口が作った server(待ち受けの後の error を起こすため)。実物の createServer に渡して作る
const createdServers = vi.hoisted((): Server[] => [])
vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  const createServer = (...args: unknown[]): Server => {
    const server = (actual.createServer as (...rest: unknown[]) => Server)(...args)
    createdServers.push(server)
    return server
  }
  return { ...actual, default: { ...actual, createServer }, createServer }
})
```
- 既存の `afterEach` を次にする:
```ts
afterEach(() => {
  receiver?.close()
  receiver = null
  vi.useRealTimers()
})
```
- `start` の先頭（`calls = []` の前）に `createdServers.length = 0` を足す
- `describe('createAgentHookReceiver(PreToolUse の順序と上限)', ...)` の `'onToolStart が reject したらログを出して応答し、onToolStartTimedOut は呼ばない'` を置き換え、続けて 1 つ足す:
```ts
  it('onToolStart が reject したらログを出し、打ち切りと同じく signal を中止して onToolStartTimedOut を 1 回呼んで 200 を返す(L-002)', async () => {
    let captured = null as AbortSignal | null
    await start({
      onToolStart: vi.fn(async (_ownerId: number, signal: AbortSignal) => {
        captured = signal
        throw new Error('boom')
      })
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    expect((await post('pre-tool-use', PRE)).status).toBe(200)
    expect(captured?.aborted).toBe(true)
    expect(deps.onToolStartTimedOut).toHaveBeenCalledExactlyOnceWith(7)
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] ツールの開始の待ちに失敗しました: boom')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('onToolStart が同期で投げても 200 を返し、onToolStartTimedOut を 1 回呼び、上限のタイマーを残さない(L-055)', async () => {
    let captured = null as AbortSignal | null
    await start({
      onToolStart: vi.fn((_ownerId: number, signal: AbortSignal): Promise<void> => {
        captured = signal
        throw new Error('sync boom')
      })
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    expect((await post('pre-tool-use', PRE)).status).toBe(200)
    expect(captured?.aborted).toBe(true)
    expect(deps.onToolStartTimedOut).toHaveBeenCalledExactlyOnceWith(7)
    expect(deps.log).toHaveBeenCalledWith(
      '[agent-hooks] ツールの開始の待ちに失敗しました: sync boom'
    )
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(AGENT_PRE_TOOL_USE_WAIT_MS)
    expect(deps.onToolStartTimedOut).toHaveBeenCalledOnce()
  })
```
- 既存の `describe('createAgentHookReceiver(close)', ...)` の最後に足す:
```ts
  it('close で待っている PreToolUse の上限のタイマーを外して signal を中止し、上限が過ぎても onToolStartTimedOut を呼ばない(L-435)', async () => {
    let captured = null as AbortSignal | null
    await start({
      onToolStart: vi.fn((_ownerId: number, signal: AbortSignal) => {
        captured = signal
        return new Promise<void>(() => undefined)
      }),
      // vi.waitFor は偽のタイマーを interval ずつ進めるため、上限に届かない長さにする
      preToolUseWaitMs: 60_000
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = post('pre-tool-use', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_use_id: 't'
    })
    await vi.waitFor(() => expect(captured).not.toBeNull())
    receiver?.close()
    expect(captured?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(120_000)
    await expect(pending).rejects.toThrow()
    expect(deps.onToolStartTimedOut).not.toHaveBeenCalled()
  })

  it('本文を読んでいる間に close したら、その要求を deliver しない(L-435)', async () => {
    await start()
    const server = createdServers[0]
    const arrived = new Promise<IncomingMessage>((resolve) => {
      server.once('request', (req: IncomingMessage) => resolve(req))
    })
    const req = request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/prompt-ide/agent-hooks/v1/pre-tool-use',
      headers: { ...HEADERS, 'Content-Length': '100' }
    })
    req.on('error', () => undefined)
    req.write('{"hook_event_name":')
    // 受け口の request のハンドラは先に登録されているため、この時点で本文の読み込みを待っている
    const serverReq = await arrived
    const closedReq = new Promise((resolve) => serverReq.once('close', resolve))
    receiver?.close()
    await closedReq
    await new Promise((resolve) => setImmediate(resolve))
    expect(deps.deliver).not.toHaveBeenCalled()
  })
```
- 同じファイルの末尾に足す:
```ts
describe('createAgentHookReceiver(待ち受けの後の error。頑健性の 1)', () => {
  it('待ち受けの後の server の error でログを出して閉じ、次の ensureListening は新しい server で始め直す(L-436)', async () => {
    await start()
    const first = createdServers[0]
    first.emit('error', new Error('EMFILE'))
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] 受け口が止まりました: EMFILE')
    await vi.waitFor(() => expect(first.listening).toBe(false))
    const { baseUrl } = (await receiver?.ensureListening()) ?? { baseUrl: '' }
    expect(createdServers).toHaveLength(2)
    expect(createdServers[1].listening).toBe(true)
    // トークンの表は残るため、新しい受け口でそのまま受け付ける
    port = Number(new URL(baseUrl).port)
    expect((await post('stop', { hook_event_name: 'Stop' })).status).toBe(200)
  })
})
```

- [ ] **Step 3: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentToolIntervals.test.ts src/main/__tests__/agentToolActivity.test.ts src/main/__tests__/agentHookReceiver.test.ts`
Expected: FAIL（あふれ・`subagent-stop` の控え・`hasUnassignableInterval` が無い・reject と同期の throw で `onToolStartTimedOut` が呼ばれない／500・`close` の後に `deliver` される・`error` の後も同じ server を返す）

- [ ] **Step 4: 区間のあふれと控えを実装する**

`src/main/agentToolIntervals.ts`:
- `ToolIntervals` に `overflowed` を足し、`createToolIntervals` で `false` にする:
```ts
export interface ToolIntervals {
  openTools: Map<string, IdInterval>
  anonymousOpen: OpenInterval[]
  /** 区間を閉じる知らせを待たずに外した ID(遅れた tool-end で別の区間を閉じないため) */
  droppedToolIds: Set<string>
  /** 上限(AGENT_TOOL_OPEN_MAX)を超える tool-start を受けた。どのエージェントの区間か分からないため、session-end と pty の終了でだけ下ろす */
  overflowed: boolean
}

export const createToolIntervals = (): ToolIntervals => ({
  openTools: new Map(),
  anonymousOpen: [],
  droppedToolIds: new Set(),
  overflowed: false
})
```
- `openCountOf` を次にし、その後に `hasUnassignableInterval` を足す:
```ts
/** 開いた区間の数。あふれたセッションは開いた区間があるものとして 1 を足す */
export const openCountOf = (intervals: ToolIntervals): number =>
  intervals.openTools.size + intervals.anonymousOpen.length + (intervals.overflowed ? 1 : 0)

/** 割り当てられない区間がある(期限切れの区間がある・あふれた。設計書「段階 A の最終レビューで残した頑健性」の 4) */
export const hasUnassignableInterval = (intervals: ToolIntervals): boolean =>
  intervals.overflowed || openIntervalsOf(intervals).some((interval) => interval.expired)
```
- `applyToolIntervalEvent` の `case 'tool-start':` を次にする（まだ動いているツールの区間を自分の契機より早く閉じない。L-002）:
```ts
    case 'tool-start': {
      if (event.toolId.kind === 'read') {
        if (intervals.openTools.has(event.toolId.id)) return
        if (intervals.openTools.size >= AGENT_TOOL_OPEN_MAX) {
          // 上限を超える区間は足さず、そのツールの遅れた tool-end で別の区間を閉じないよう ID を控える
          intervals.overflowed = true
          remember(intervals.droppedToolIds, event.toolId.id)
          return
        }
        intervals.openTools.set(event.toolId.id, {
          agentId: event.agentId,
          openedAt: now,
          expired: false,
          ended: false
        })
        return
      }
      if (intervals.anonymousOpen.length >= AGENT_TOOL_OPEN_MAX) {
        intervals.overflowed = true
        return
      }
      intervals.anonymousOpen.push({ openedAt: now, expired: false })
      return
    }
```
- `case 'subagent-stop':` を次にする:
```ts
    case 'subagent-stop':
      // 外した ID を控える(遅れた tool-end が規則 (3) で ID なしの区間を閉じない。L-044)
      for (const [id, interval] of intervals.openTools) {
        if (interval.agentId === event.agentId) {
          intervals.openTools.delete(id)
          remember(intervals.droppedToolIds, id)
        }
      }
      return
```
- `case 'session-end':` の `intervals.anonymousOpen = []` の後に `intervals.overflowed = false` を足す

`src/main/agentToolActivity.ts`:
- import に `hasUnassignableInterval` を足す
- `signalOf` の `unassignable` を次にする:
```ts
  // 段階の分岐と別に、生きているセッションのどれかに割り当てられない区間(期限切れ・あふれ)が残っているかで求める
  const unassignable = sessions.some((s) => hasUnassignableInterval(s.intervals))
```
- 使わなくなった `openIntervalsOf` の import を外す（`eslint` が未使用を指摘する）

- [ ] **Step 5: 受け口の頑健性の 1〜3 を実装する**

`src/main/agentHookReceiver.ts`:
- 先頭の型の後（`const BEARER_PATTERN` の前）に足す:
```ts
/** 待っている PreToolUse 1 件(close でタイマーを外し、signal を中止して待ちを終わらせる) */
interface ToolStartWait {
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  /** close で待ちを終わらせる(onToolStartTimedOut を呼ばない) */
  close: () => void
}
```
- `createAgentHookReceiver` の中の `let closed = false` の後に `const waits = new Set<ToolStartWait>()` を足す
- `waitForToolStart` を次にする:
```ts
  const waitForToolStart = async (ownerId: number): Promise<void> => {
    const controller = new AbortController()
    let settle: (result: 'timeout' | 'closed') => void = () => undefined
    const stopped = new Promise<'timeout' | 'closed'>((resolve) => {
      settle = resolve
    })
    const wait: ToolStartWait = {
      controller,
      timer: setTimeout(() => settle('timeout'), preToolUseWaitMs),
      close: () => settle('closed')
    }
    waits.add(wait)
    // 同期の throw も reject と同じ「待ちの失敗」にする(L-055)
    const started = Promise.resolve()
      .then(() => onToolStart(ownerId, controller.signal))
      .then(
        () => 'started' as const,
        (err: unknown) => {
          log(`[agent-hooks] ツールの開始の待ちに失敗しました: ${messageOf(err)}`)
          return 'failed' as const
        }
      )
    const result = await Promise.race([started, stopped])
    clearTimeout(wait.timer)
    waits.delete(wait)
    // close の後は、記録の側も閉じているため打ち切りを知らせない(L-435)
    if (closed || result === 'closed' || result === 'started') return
    // 打ち切り・待ちの失敗は、覆えたか分からない区間として知らせる(L-002)
    controller.abort()
    onToolStartTimedOut(ownerId)
  }
```
- `handle` の先頭と、本文を読んだ後に `closed` を見る:
```ts
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // close の後に残った接続から届いた要求は、追跡に渡さない(L-435)
    if (closed) {
      req.resume()
      respond(res, 503)
      return
    }
    const check = checkAgentHookRequest(req, port, ownerOf)
    if (check.kind === 'rejected') {
      count('拒んだ要求', check.reason)
      req.resume()
      respond(res, check.status)
      return
    }
    const { event, owner } = check
    const body = await readAgentHookBody(req)
    // 本文を読んでいる間に close した(接続が切れて unreadable になった)要求も渡さない
    if (closed) {
      respond(res, 503)
      return
    }
    if (body.kind === 'too-large') count('拒んだ要求', 'too-large')
    const { event: parsed, notes } = parseAgentHookRequest(event, body)
    for (const note of notes) count('読めない知らせ', note)
    // 知らせ 1 件につき 1 回。追跡はこの中で段階の通知まで同期的に済ませる
    deliver(owner.ownerId, owner.sessionId, parsed)
    if (event === 'PreToolUse') await waitForToolStart(owner.ownerId)
    respond(res, 200)
  }
```
- `ensureListening` の `created.once('error', ...)` と `created.listen(...)` を次にする（`attempt` の `new Promise((resolve, rejectListen) => { ... })` の中）:
```ts
          let listened = false
          // listen の失敗と、待ち受けの後の error(EMFILE など)の両方を 1 つの常駐のハンドラで受ける(頑健性の 1)。
          // 待ち受けの後に止まったら、控えた listening・server を捨てて次の ensureListening で始め直す(L-436)
          created.on('error', (err) => {
            created.close()
            if (!listened) {
              rejectListen(err)
              return
            }
            log(`[agent-hooks] 受け口が止まりました: ${messageOf(err)}`)
            if (server === created) {
              server = null
              listening = null
              port = 0
            }
          })
          created.listen({ host: '127.0.0.1', port: 0 }, () => {
            listened = true
            const address = created.address()
            if (closed || address === null || typeof address === 'string') {
              created.close()
              rejectListen(new Error('受け口は閉じています'))
              return
            }
            port = address.port
            server = created
            resolve({ baseUrl: `http://127.0.0.1:${port}` })
          })
```
- `close` を次にする:
```ts
    close() {
      closed = true
      owners.clear()
      // 待っている PreToolUse の上限のタイマーを外し、記録の側の待ちも止める(L-435)
      for (const wait of waits) {
        clearTimeout(wait.timer)
        wait.controller.abort()
        wait.close()
      }
      waits.clear()
      if (server !== null) {
        server.close()
        server.closeAllConnections()
        server = null
      }
    }
```
- 依存 `onToolStart`・`onToolStartTimedOut` の説明の「段階 A はすぐ解決する」「段階 A は何もしない」は Task 5 で直す（ここでは変えない）

- [ ] **Step 6: 通す**

Run: `npx vitest run src/main/__tests__/agentToolIntervals.test.ts src/main/__tests__/agentToolActivity.test.ts src/main/__tests__/agentHookReceiver.test.ts src/main/__tests__/agentHooks.integration.test.ts`
Expected: PASS
Run: `npm test`
Expected: PASS（時間切れで落ちたファイルは単体で流し直す）
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/main/agentHookReceiver.ts src/main/agentToolIntervals.ts src/main/agentToolActivity.ts src/main/__tests__/agentHookReceiver.test.ts src/main/__tests__/agentToolIntervals.test.ts src/main/__tests__/agentToolActivity.test.ts && npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 7: 変異で確かめる（各テストで修正を戻すと落ちること）**

`npx vitest run src/main/__tests__/agentHookReceiver.test.ts src/main/__tests__/agentToolIntervals.test.ts` を、次を 1 つずつ戻して走らせ、括弧のテストが落ちることを確かめてから元に戻す:
1. `created.on('error', ...)` を `created.once('error', (err) => { created.close(); rejectListen(err) })` に戻す（「待ち受けの後の server の error で…始め直す」）
2. `Promise.resolve().then(() => onToolStart(...))` を `onToolStart(ownerId, controller.signal)` に戻す（「同期で投げても 200」）
3. `if (closed || result === 'closed' || result === 'started') return` を `if (result === 'started') return` に戻す（「close で待っている PreToolUse の…呼ばない」）
4. 本文を読んだ後の `if (closed) { ... }` を消す（「本文を読んでいる間に close したら…deliver しない」）
5. `subagent-stop` の `remember(intervals.droppedToolIds, id)` を消す（「subagent-stop で外した ID の遅れた tool-end は…」）

- [ ] **Step 8: コミット（利用者の指示があるときだけ）**

```bash
git add src/main/agentHookReceiver.ts src/main/agentToolIntervals.ts src/main/agentToolActivity.ts src/main/__tests__/agentHookReceiver.test.ts src/main/__tests__/agentToolIntervals.test.ts src/main/__tests__/agentToolActivity.test.ts
git commit -m "fix: 受け口の待ち受けの後の error・同期の throw・close の後の待ちと要求を守り、区間のあふれを割り当てない区間にする"
```

---

### Task 2a: hooks が届かなくなったことの検知（ターンの終わりの 30 秒の待ちと保留・`agentTerminal:reportWorkingEnded`・作業の終わりの知らせ）

> **気をつける知見:** L-019（renderer の値は送信元のウィンドウのセッションを指すだけ）・L-053（`onPhaseChange` の例外を握る）・L-060（handler の依存 `reportWorkingEnded` を必須にする）・L-061（新しい入口）・L-417（出来事で送る）・L-427（保留にして `lost` にしない。許可の確認の待ちは対象にしない）

**Files:**
- Modify: `src/main/agentToolActivity.ts`（定数・`AgentToolActivity.reportWorkingEnded`・`SessionState` の 3 つの項目・`confirm`・`apply`・`publish`・`signalOf`・`reportWorking`・`removeSession`・`close`）
- Modify: `src/main/handlers/agentTerminalHandlers.ts`（依存 `reportWorkingEnded`・`agentTerminal:reportWorkingEnded`・2 つの知らせの検査の共通化）
- Modify: `src/main/ipcHandlers.ts`（handler に `reportWorkingEnded: agentHooks.tracker.reportWorkingEnded`）
- Modify: `src/preload/api.ts`・`src/preload/index.d.ts`・`src/renderer/src/lib/agentTerminalApi.ts`・`src/renderer/src/hooks/useAgentHooksWorkingReport.ts`・`src/renderer/src/__tests__/setup.ts`
- Test: `src/main/__tests__/agentToolActivity.test.ts`・`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`・`src/main/__tests__/ipcHandlers.test.ts`・`src/preload/__tests__/api.test.ts`・`src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`・`src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx`

**Interfaces:**
- Consumes: Task 1b の `hasUnassignableInterval`
- Produces:
```ts
// src/main/agentToolActivity.ts
export const AGENT_HOOKS_TURN_END_WAIT_MS = 30_000
export interface AgentToolActivity {
  addSession(ownerId: number, sessionId: string, state: AgentHookSessionInitialState): void
  removeSession(ownerId: number, sessionId: string): void
  deliver(ownerId: number, sessionId: string, event: AgentHookEvent): void
  reportWorking(ownerId: number, sessionId: string): void
  /** 作業の終わりの知らせ。confirmed で、作業中の後に Stop・StopFailure を受けておらず、待ち・保留が無ければ 30 秒の待ちを張る */
  reportWorkingEnded(ownerId: number, sessionId: string): void
  activityOf(ownerId: number): AgentToolActivitySignal
  toolStartSeqOf(ownerId: number): number
  close(): void
}
// 保留(turnEndOverdue)のセッションがあると activityOf の unassignable が立つ。保留は照合の通ったどの知らせでも解ける

// src/main/handlers/agentTerminalHandlers.ts
export interface AgentTerminalHandlerDeps {
  // ...既存
  reportWorking: (ownerId: number, sessionId: string) => void
  /** 作業の終わりの知らせ(必須。ipcHandlers.ts が agentHooks.tracker.reportWorkingEnded を渡す) */
  reportWorkingEnded: (ownerId: number, sessionId: string) => void
}

// src/preload/api.ts・index.d.ts
reportAgentSessionWorkingEnded(sessionId: string): void   // ipcRenderer.send('agentTerminal:reportWorkingEnded', sessionId)
// src/renderer/src/lib/agentTerminalApi.ts
export function reportAgentSessionWorkingEnded(sessionId: string): void
```

- [ ] **Step 1: 追跡の失敗するテストを書く**

`src/main/__tests__/agentToolActivity.test.ts`:
- import に `AGENT_HOOKS_TURN_END_WAIT_MS` を足し、`'設計書の値'` に `expect(AGENT_HOOKS_TURN_END_WAIT_MS).toBe(30_000)` を足す
- import の `AgentHookEvent` の型が無ければ `import type { AgentHookEvent } from '../agentHookEvents'` を足す
- ファイルの末尾に足す:
```ts
describe('createAgentToolActivity(ターンの終わりの待ちと保留)', () => {
  /** confirmed にしてから作業中・作業の終わりの知らせを送る(30 秒の待ちが張られる) */
  const workedThenEnded = (sessionId = 's1'): void => {
    tracker.reportWorking(1, sessionId)
    tracker.reportWorkingEnded(1, sessionId)
  }
  const overdue = (): void => {
    vi.advanceTimersByTime(AGENT_HOOKS_TURN_END_WAIT_MS)
  }
  const stopFailure = (): AgentHookEvent => ({
    kind: 'turn-end',
    hookEventName: 'StopFailure',
    toolName: null
  })
  const unknownToolEnd = (): AgentHookEvent => ({
    kind: 'confirm-only',
    reason: 'unknown-tool-end',
    hookEventName: 'PostToolUse',
    toolName: 'Read'
  })

  it('confirmed で作業の終わりから 30 秒 Stop が届かなければ保留にし、unassignable を立てて onPhaseChange を呼ぶ(確かめた状態は confirmed、lost は null のまま)', () => {
    confirmed()
    workedThenEnded()
    onPhaseChange.mockClear()
    vi.advanceTimersByTime(AGENT_HOOKS_TURN_END_WAIT_MS - 1)
    expect(tracker.activityOf(1).unassignable).toBe(false)
    vi.advanceTimersByTime(1)
    expect(tracker.activityOf(1)).toEqual({ phase: 'idle', lost: null, unassignable: true })
    expect(onPhaseChange).toHaveBeenCalledExactlyOnceWith(1)
    expect(warn).toHaveBeenCalledWith(
      '[agent-hooks] ターンの終わりの知らせが届かないため、次の知らせまで割り当てを保留します'
    )
    expect(devLog.mock.calls.at(-1)?.[0]).toContain(
      'event=終わりの待ちの終わり tool=- id=- agent=- hooks=confirmed phase=idle→idle unassignable=あり'
    )
  })

  it('作業の終わりで待ちを張ったときに event=作業の終わり の行を出す', () => {
    confirmed()
    workedThenEnded()
    expect(devLog.mock.calls.at(-1)?.[0]).toContain('event=作業の終わり')
  })

  it.each<[string, () => AgentHookEvent]>([
    ['UserPromptSubmit', promptSubmit],
    ['PreToolUse', () => toolStart('a')],
    ['confirm-only(知らないツールの PostToolUse)', unknownToolEnd],
    ['SessionEnd(/clear)', sessionEnd]
  ])('保留は次の知らせ(%s)で解け、unassignable が下りる(onPhaseChange は deliver 1 回につき高々 1 回)', (_label, event) => {
    confirmed()
    workedThenEnded()
    overdue()
    onPhaseChange.mockClear()
    tracker.deliver(1, 's1', event())
    expect(tracker.activityOf(1).unassignable).toBe(false)
    expect(onPhaseChange.mock.calls.length).toBeLessThanOrEqual(1)
    expect(warn).toHaveBeenCalledWith('[agent-hooks] 知らせが届いたため、保留を解きます')
  })

  it('保留の間も段階は今の規則で変わり、2 つのセッションの片方だけが保留でも unassignable', () => {
    confirmed(1, 's1')
    confirmed(1, 's2')
    workedThenEnded('s1')
    overdue()
    tracker.deliver(1, 's2', toolStart('a'))
    expect(tracker.activityOf(1)).toEqual({ phase: 'agent', lost: null, unassignable: true })
    tracker.deliver(1, 's2', toolEnd('a'))
    tracker.deliver(1, 's2', batchEnd())
    passGrace()
    expect(tracker.activityOf(1)).toEqual({ phase: 'idle', lost: null, unassignable: true })
  })

  it('作業中の知らせでは保留が解けない(画面の作業中は hooks が届く証拠にならない)', () => {
    confirmed()
    workedThenEnded()
    overdue()
    tracker.reportWorking(1, 's1')
    expect(tracker.activityOf(1).unassignable).toBe(true)
  })

  it('保留の間の作業の終わりの知らせでは待ちを張らない', () => {
    confirmed()
    workedThenEnded()
    overdue()
    tracker.reportWorking(1, 's1')
    tracker.reportWorkingEnded(1, 's1')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each<[string, () => AgentHookEvent]>([
    ['Stop', turnEnd],
    ['StopFailure', stopFailure]
  ])('30 秒の間の %s で待ちを取り消す', (_label, event) => {
    confirmed()
    workedThenEnded()
    vi.advanceTimersByTime(10_000)
    tracker.deliver(1, 's1', event())
    overdue()
    expect(tracker.activityOf(1).unassignable).toBe(false)
  })

  it('Stop の後の作業の終わりの知らせでは待ちを張らない(Stop が画面の idle より先に届いた)', () => {
    confirmed()
    tracker.reportWorking(1, 's1')
    tracker.deliver(1, 's1', turnEnd())
    tracker.reportWorkingEnded(1, 's1')
    overdue()
    expect(tracker.activityOf(1).unassignable).toBe(false)
  })

  it('作業の終わりの後の作業中の知らせで待ちを取り消す(画面の判定が idle に揺れた後に作業に戻った)', () => {
    confirmed()
    workedThenEnded()
    vi.advanceTimersByTime(10_000)
    tracker.reportWorking(1, 's1')
    overdue()
    expect(tracker.activityOf(1).unassignable).toBe(false)
  })

  it('pending の間に作業中の知らせを受け、UserPromptSubmit で confirmed になった最初のターンでも、作業の終わりで 30 秒の待ちを張る', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    tracker.reportWorking(1, 's1')
    tracker.deliver(1, 's1', promptSubmit())
    tracker.reportWorkingEnded(1, 's1')
    overdue()
    expect(tracker.activityOf(1).unassignable).toBe(true)
  })

  it('作業中の知らせを受けずに confirmed になったセッションの作業の終わりでは待ちを張らない', () => {
    confirmed()
    tracker.reportWorkingEnded(1, 's1')
    overdue()
    expect(tracker.activityOf(1).unassignable).toBe(false)
  })

  it('pending・unconfirmed のセッションの作業の終わりでは待ちを張らない', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    tracker.addSession(1, 's2', { kind: 'unconfirmed', reason: 'receiver-unavailable' })
    tracker.reportWorkingEnded(1, 's1')
    tracker.reportWorkingEnded(1, 's2')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('2 回目の作業の終わりの知らせでは張り直さない(30 秒は最初の知らせから数える)', () => {
    confirmed()
    workedThenEnded()
    vi.advanceTimersByTime(20_000)
    tracker.reportWorkingEnded(1, 's1')
    vi.advanceTimersByTime(10_000)
    expect(tracker.activityOf(1).unassignable).toBe(true)
  })

  it('別のウィンドウのセッション・知らないセッションの作業の終わりの知らせは捨ててログに出す', () => {
    confirmed()
    tracker.reportWorking(1, 's1')
    tracker.reportWorkingEnded(2, 's1')
    tracker.reportWorkingEnded(1, 'unknown')
    expect(warn).toHaveBeenCalledWith('[agent-hooks] 作業の終わりの知らせのセッションが見つかりません')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('pty の終了(removeSession)で保留とタイマーが外れ、close でタイマーが残らない', () => {
    confirmed(1, 's1')
    confirmed(1, 's2')
    workedThenEnded('s1')
    overdue()
    tracker.removeSession(1, 's1')
    expect(tracker.activityOf(1).unassignable).toBe(false)
    workedThenEnded('s2')
    tracker.removeSession(1, 's2')
    expect(vi.getTimerCount()).toBe(0)
    confirmed(1, 's3')
    workedThenEnded('s3')
    tracker.close()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('onPhaseChange が投げても deliver・addSession は投げず、ログに出す(L-053)', () => {
    onPhaseChange.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => tracker.addSession(1, 's1', { kind: 'pending' })).not.toThrow()
    expect(() => tracker.deliver(1, 's1', promptSubmit())).not.toThrow()
    expect(warn).toHaveBeenCalledWith('[agent-hooks] 段階の通知に失敗しました: boom')
    expect(tracker.activityOf(1).phase).toBe('idle')
  })
})
```

- [ ] **Step 2: handler・preload・renderer の失敗するテストを書く**

`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`:
- `register` の既定の依存（`reportWorking: vi.fn(),` の行の後）に `reportWorkingEnded: vi.fn(),` を足す
- `describe('agentTerminal:reportWorking', ...)` の後に足す:
```ts
describe('agentTerminal:reportWorkingEnded', () => {
  let warnSpy: MockInstance<typeof console.warn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('メインフレームからの sessionId を、送信元のウィンドウの id と一緒に追跡へ渡す', () => {
    const reportWorkingEnded = vi.fn<(ownerId: number, sessionId: string) => void>()
    register({ reportWorkingEnded })
    listeners.get('agentTerminal:reportWorkingEnded')?.(makeEvent(3), 'sid-9')
    expect(reportWorkingEnded).toHaveBeenCalledExactlyOnceWith(3, 'sid-9')
  })

  it.each<[string, unknown]>([
    ['空文字', ''],
    ['数値', 123],
    ['null', null]
  ])('不正な sessionId(%s)は追跡を呼ばず、例外を投げずにログに出す', (_label, sessionId) => {
    const reportWorkingEnded = vi.fn<(ownerId: number, sessionId: string) => void>()
    register({ reportWorkingEnded })
    expect(() =>
      listeners.get('agentTerminal:reportWorkingEnded')?.(makeEvent(3), sessionId)
    ).not.toThrow()
    expect(reportWorkingEnded).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith('[agent-hooks] 作業の終わりの知らせの sessionId が不正です')
  })

  it('サブフレームからの送信は捨てる(L-019)', () => {
    const reportWorkingEnded = vi.fn<(ownerId: number, sessionId: string) => void>()
    register({ reportWorkingEnded })
    listeners.get('agentTerminal:reportWorkingEnded')?.(makeEvent(3, false), 'sid-9')
    expect(reportWorkingEnded).not.toHaveBeenCalled()
  })
})
```

`src/main/__tests__/ipcHandlers.test.ts`:
- `const mockToolActivity = vi.hoisted(() => ({ reportWorking: vi.fn() }))` を `vi.hoisted(() => ({ reportWorking: vi.fn(), reportWorkingEnded: vi.fn() }))` にする
- `'エージェントのセッションの寿命と IPC に、…'` の `expect(deps).toEqual({ ... })` に `reportWorkingEnded: mockToolActivity.reportWorkingEnded` を足し、`expect(deps.reportWorkingEnded).toBe(mockToolActivity.reportWorkingEnded)` を足す

`src/preload/__tests__/api.test.ts` の send の `it.each` の配列の `'reportAgentSessionWorking は send で sessionId だけを送る'` の要素の後に足す:
```ts
    [
      'reportAgentSessionWorkingEnded は send で sessionId だけを送る',
      () => api.reportAgentSessionWorkingEnded('s'),
      ['agentTerminal:reportWorkingEnded', 's']
    ]
```

`src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`: `mockApi` に `reportAgentSessionWorkingEnded: vi.fn()` を足し、既存の「窓口が window.api に渡す」テストの `agentTerminalApi.reportAgentSessionWorking('s')` の後に `agentTerminalApi.reportAgentSessionWorkingEnded('s')`、`expect(mockApi.reportAgentSessionWorking).toHaveBeenCalledWith('s')` の後に `expect(mockApi.reportAgentSessionWorkingEnded).toHaveBeenCalledWith('s')` を足す

`src/renderer/src/__tests__/setup.ts` の `reportAgentSessionWorking: () => {},` の後に `reportAgentSessionWorkingEnded: () => {},` を足す

`src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx`:
- モックを次にする:
```ts
const mockReport = vi.hoisted(() => vi.fn<(sessionId: string) => void>())
const mockReportEnded = vi.hoisted(() => vi.fn<(sessionId: string) => void>())
vi.mock('../../lib/agentTerminalApi', () => ({
  reportAgentSessionWorking: mockReport,
  reportAgentSessionWorkingEnded: mockReportEnded
}))
```
- `beforeEach` に `mockReportEnded.mockClear()` を足す
- ファイルの末尾に足す:
```ts
describe('useAgentHooksWorkingReport(作業の終わり)', () => {
  it('working → idle で reportAgentSessionWorkingEnded を 1 回送る', () => {
    const tabs = [tab('a', 'sid-a')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReportEnded).toHaveBeenCalledExactlyOnceWith('sid-a')
  })

  it('working → permission・confirm では送らず、続く idle で送る(利用者の操作待ちはターンの終わりではない)', () => {
    const tabs = [tab('a', 'sid-a')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'permission']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'confirm']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'unknown']]) })
    expect(mockReportEnded).not.toHaveBeenCalled()
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReportEnded).toHaveBeenCalledExactlyOnceWith('sid-a')
  })

  it('working を見ていない idle(起動の直後)では送らない', () => {
    const tabs = [tab('a', 'sid-a')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'unknown']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReportEnded).not.toHaveBeenCalled()
  })

  it('idle が続いても 2 回送らない(Map が作り直されても)', () => {
    const tabs = [tab('a', 'sid-a')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReportEnded).toHaveBeenCalledOnce()
  })

  it('controller.getSessionId() が null のタブは送らない', () => {
    const tabs = [tab('a', null)]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReportEnded).not.toHaveBeenCalled()
  })

  it('タブごとに独立して見る', () => {
    const tabs = [tab('a', 'sid-a'), tab('b', 'sid-b')]
    const { rerender } = render({
      tabs,
      activities: activitiesOf([
        ['a', 'working'],
        ['b', 'idle']
      ])
    })
    rerender({
      tabs,
      activities: activitiesOf([
        ['a', 'idle'],
        ['b', 'idle']
      ])
    })
    expect(mockReportEnded).toHaveBeenCalledExactlyOnceWith('sid-a')
  })
})
```

- [ ] **Step 3: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentToolActivity.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/agentTerminalApi.test.ts src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx`
Expected: FAIL（`reportWorkingEnded`・`AGENT_HOOKS_TURN_END_WAIT_MS`・`reportAgentSessionWorkingEnded` が無い）

- [ ] **Step 4: 追跡を実装する**

`src/main/agentToolActivity.ts`:
- 定数の後に足す:
```ts
/** 作業の終わり(renderer の活動の working の後の idle)から Stop・StopFailure を待つ時間。過ぎたら次の知らせまで割り当てを保留する */
export const AGENT_HOOKS_TURN_END_WAIT_MS = 30_000
```
- `AgentToolActivity` の `reportWorking` の後に足す:
```ts
  /** 作業の終わりの知らせ。confirmed で、作業中の後に Stop・StopFailure を受けておらず、待ち・保留が無ければ 30 秒の待ちを張る */
  reportWorkingEnded(ownerId: number, sessionId: string): void
```
- `SessionState` を次にする:
```ts
interface SessionState {
  hooks: HooksState
  /** pending の間に作業中の知らせを受けて張った 15 秒のタイマー */
  workingTimer: Timer | null
  /** confirmed の間に作業の終わりの知らせを受けて張った 30 秒のタイマー */
  turnEndTimer: Timer | null
  /** 作業中の知らせの後に Stop・StopFailure を受けたか(初期値 true。作業中の知らせで false) */
  turnEndedSinceWorking: boolean
  /** ターンの終わりの知らせが届かず、次の知らせまで割り当てを保留している(合図 unassignable)。確かめた状態は confirmed のまま */
  turnEndOverdue: boolean
  intervals: ToolIntervals
}
```
- `const flag = ...` の後に足す:
```ts
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))
```
- `signalOf` の `unassignable` を次にする:
```ts
  // 段階の分岐と別に、割り当てられない区間(期限切れ・あふれ)か、保留しているセッションがあるかで求める
  const unassignable = sessions.some(
    (s) => s.turnEndOverdue || hasUnassignableInterval(s.intervals)
  )
```
- `publish` の `onPhaseChange(ownerId)` を次にする:
```ts
    owner.lastSignal = after
    // 受け手(記録の registry)の例外で、知らせの処理・起動を止めない(L-053)
    try {
      onPhaseChange(ownerId)
    } catch (err) {
      warn(`[agent-hooks] 段階の通知に失敗しました: ${messageOf(err)}`)
    }
```
- `clearWorkingTimer` の後に足す:
```ts
  /** 作業の終わりからの 30 秒のタイマーを外す */
  const clearTurnEndTimer = (session: SessionState): void => {
    if (session.turnEndTimer !== null) clearTimeout(session.turnEndTimer)
    session.turnEndTimer = null
  }
```
- `confirm` を次にする:
```ts
  /** どの知らせでも、pending・unconfirmed(hooks-not-confirmed)なら confirmed にし、保留を解く */
  const confirm = (session: SessionState): void => {
    if (
      session.hooks.kind === 'pending' ||
      (session.hooks.kind === 'unconfirmed' && session.hooks.reason === 'hooks-not-confirmed')
    ) {
      // pending の間に作業中の知らせを受けていた(15 秒のタイマーが残っている)なら、このターンの作業中を受けている
      if (session.workingTimer !== null) session.turnEndedSinceWorking = false
      session.hooks = { kind: 'confirmed' }
      clearWorkingTimer(session)
    }
    if (session.turnEndOverdue) {
      session.turnEndOverdue = false
      warn('[agent-hooks] 知らせが届いたため、保留を解きます')
    }
  }
```
- `apply` の `if (event.kind === 'tool-start') { ... }` の後に足す:
```ts
    if (event.kind === 'turn-end') {
      // Stop が画面の idle より先に届いても、後で届いた作業の終わりの知らせで待ちを張らない
      session.turnEndedSinceWorking = true
      clearTurnEndTimer(session)
    }
```
- `addSession` の `owner.sessions.set(sessionId, { ... })` の `workingTimer: null,` の後に `turnEndTimer: null, turnEndedSinceWorking: true, turnEndOverdue: false,` を足す
- `removeSession` の `clearWorkingTimer(session)` の後に `clearTurnEndTimer(session)` を足す
- `reportWorking` の `if (session.hooks.kind !== 'pending' || session.workingTimer !== null) return` の前に足す:
```ts
      if (session.hooks.kind === 'confirmed') {
        // 作業に戻った。保留は解かない(画面の作業中は hooks が届く証拠にならない)
        session.turnEndedSinceWorking = false
        clearTurnEndTimer(session)
        return
      }
```
- `reportWorking` の後に足す:
```ts
    reportWorkingEnded(ownerId, sessionId) {
      const owner = owners.get(ownerId)
      const session = owner?.sessions.get(sessionId)
      if (owner === undefined || session === undefined) {
        warn('[agent-hooks] 作業の終わりの知らせのセッションが見つかりません')
        return
      }
      // pending は 15 秒の確かめ方に任せ、unconfirmed は何もしない
      if (
        session.hooks.kind !== 'confirmed' ||
        session.turnEndedSinceWorking ||
        session.turnEndTimer !== null ||
        session.turnEndOverdue
      )
        return
      session.turnEndTimer = startTimer(() => {
        session.turnEndTimer = null
        if (owner.sessions.get(sessionId) !== session || session.hooks.kind !== 'confirmed') return
        session.turnEndOverdue = true
        warn('[agent-hooks] ターンの終わりの知らせが届かないため、次の知らせまで割り当てを保留します')
        publish(ownerId, owner, { sessionId, event: '終わりの待ちの終わり' })
      }, AGENT_HOOKS_TURN_END_WAIT_MS)
      publish(ownerId, owner, { sessionId, event: '作業の終わり' })
    },
```
- `close` の `for (const session of owner.sessions.values()) clearWorkingTimer(session)` を次にする:
```ts
        for (const session of owner.sessions.values()) {
          clearWorkingTimer(session)
          clearTurnEndTimer(session)
        }
```
- ファイルの先頭の説明に「ターンの終わりの待ち(30 秒)と保留」を足す

- [ ] **Step 5: handler・preload・renderer・組み立てを実装する**

`src/main/handlers/agentTerminalHandlers.ts`:
- `AgentTerminalHandlerDeps` の `reportWorking` の後に足す:
```ts
  /** 作業の終わりの知らせ(送信元のウィンドウの id と pty の sessionId)。組み立ては agentHooksRuntime.ts(区間の追跡の
   *  reportWorkingEnded)で、ipcHandlers.ts が渡す。そのウィンドウに無いセッションは追跡が捨てる */
  reportWorkingEnded: (ownerId: number, sessionId: string) => void
```
- 分割代入に `reportWorkingEnded,` を足す
- 既存の `ipcMain.on('agentTerminal:reportWorking', ...)` の部分を次に置き換える:
```ts
  // 作業中の知らせ・作業の終わりの知らせ(設計書「作業中の知らせ」「hooks が届かなくなったことの検知」)。効果は印を増やさない側
  // (unconfirmed・保留)だけで、renderer の値は送信元のウィンドウのセッションを指すだけ(L-019)。send なので失敗を renderer に返さない
  const onSessionReport = (
    channel: string,
    label: string,
    report: (ownerId: number, sessionId: string) => void
  ): void => {
    ipcMain.on(channel, (event: IpcMainEvent, sessionId: unknown) => {
      if (!isMainFrameSender(event)) return
      let parsed: string
      try {
        parsed = parseAgentSessionId(sessionId)
      } catch {
        console.warn(`[agent-hooks] ${label}の sessionId が不正です`)
        return
      }
      report(event.sender.id, parsed)
    })
  }
  onSessionReport('agentTerminal:reportWorking', '作業中の知らせ', reportWorking)
  onSessionReport('agentTerminal:reportWorkingEnded', '作業の終わりの知らせ', reportWorkingEnded)
```
- 先頭の説明の「sessionId(作業中の知らせを含む)」を「sessionId(作業中・作業の終わりの知らせを含む)」に直す

`src/main/ipcHandlers.ts` の `registerAgentTerminalHandlers(ipcMain, { ... })` の `reportWorking: agentHooks.tracker.reportWorking` の後に `,\n    reportWorkingEnded: agentHooks.tracker.reportWorkingEnded` を足す

`src/preload/api.ts` の `reportAgentSessionWorking` の後に足す:
```ts
  // 作業の終わりの知らせ(一方向。引数は pty の sessionId だけ)
  reportAgentSessionWorkingEnded: (sessionId: string): void =>
    ipcRenderer.send('agentTerminal:reportWorkingEnded', sessionId),
```
`src/preload/index.d.ts` の `reportAgentSessionWorking(sessionId: string): void` の後に `reportAgentSessionWorkingEnded(sessionId: string): void` を足す

`src/renderer/src/lib/agentTerminalApi.ts` の末尾に足す:
```ts
/** 作業の終わりの知らせ(タブの活動が working の後に idle になったとき)。main は hooks が届かなくなったことの検知に使う */
export function reportAgentSessionWorkingEnded(sessionId: string): void {
  window.api.reportAgentSessionWorkingEnded(sessionId)
}
```

`src/renderer/src/hooks/useAgentHooksWorkingReport.ts` を次の内容にする:
```ts
import { useEffect, useRef } from 'react'
import { reportAgentSessionWorking, reportAgentSessionWorkingEnded } from '../lib/agentTerminalApi'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentTerminalController } from '../lib/agentTerminalController'

// 作業中の知らせと作業の終わりの知らせ(設計書「作業中の知らせ」「hooks が届かなくなったことの検知」)。タブの活動(画面の読み取りの判定)が
// working 以外から working に変わったとき(作業中)と、working を見た後に idle になったとき(作業の終わり)だけ、そのタブの pty の
// sessionId を main へ送る。permission・confirm(利用者の操作待ちで、ターンは終わっていない)・unknown(判定の途中)では作業の終わりを
// 送らない。表示用の値の並びで送り続けない(タブごとの出来事だけを送る。L-417)

export interface AgentHooksWorkingReportTab {
  slotId: string
  /** タブの表示(AgentSessionTabView)は sessionId を持たないため、controller から取る */
  controller: Pick<AgentTerminalController, 'getSessionId'>
}

export interface UseAgentHooksWorkingReportOptions {
  tabs: readonly AgentHooksWorkingReportTab[]
  /** slotId → 活動(useAgentActivity の結果) */
  activities: ReadonlyMap<string, AgentActivity>
}

/** タブごとの控え: 前回の活動と、working を見てから idle をまだ見ていないか */
interface TabReportState {
  activity: AgentActivity
  awaitingIdle: boolean
}

export function useAgentHooksWorkingReport({
  tabs,
  activities
}: UseAgentHooksWorkingReportOptions): void {
  // タブごとの控え。消えたタブの控えは次の描画で捨てる
  const previousRef = useRef(new Map<string, TabReportState>())

  useEffect(() => {
    const previous = previousRef.current
    const next = new Map<string, TabReportState>()
    for (const tab of tabs) {
      const activity = activities.get(tab.slotId) ?? 'unknown'
      const before = previous.get(tab.slotId)
      let awaitingIdle = before?.awaitingIdle ?? false
      if (activity === 'working') {
        if (before?.activity !== 'working') {
          const sessionId = tab.controller.getSessionId()
          if (sessionId !== null) reportAgentSessionWorking(sessionId)
        }
        awaitingIdle = true
      } else if (activity === 'idle' && awaitingIdle) {
        const sessionId = tab.controller.getSessionId()
        if (sessionId !== null) reportAgentSessionWorkingEnded(sessionId)
        awaitingIdle = false
      }
      next.set(tab.slotId, { activity, awaitingIdle })
    }
    previousRef.current = next
  }, [tabs, activities])
}
```

- [ ] **Step 6: 通す**

Run: `npx vitest run src/main/__tests__/agentToolActivity.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/agentTerminalApi.test.ts src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx src/main/__tests__/agentHooks.integration.test.ts`
Expected: PASS
Run: `npm test`
Expected: PASS（時間切れで落ちたファイルは単体で流し直す）
Run: `npm run typecheck`
Expected: PASS（`ipcHandlers.ts` が handler の必須の依存 `reportWorkingEnded` を渡していること）
Run: `npx eslint --fix src/main/agentToolActivity.ts src/main/handlers/agentTerminalHandlers.ts src/main/ipcHandlers.ts src/preload/api.ts src/preload/index.d.ts src/renderer/src/lib/agentTerminalApi.ts src/renderer/src/hooks/useAgentHooksWorkingReport.ts src/renderer/src/__tests__/setup.ts src/main/__tests__/agentToolActivity.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/agentTerminalApi.test.ts src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx && npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 7: 変異で確かめる**

1. `confirm` の `if (session.workingTimer !== null) session.turnEndedSinceWorking = false` を消し、`npx vitest run src/main/__tests__/agentToolActivity.test.ts` で「pending の間に作業中の知らせを受け、UserPromptSubmit で confirmed になった最初のターンでも…」が落ちることを確かめて戻す
2. `publish` の `try`/`catch` を外し、「onPhaseChange が投げても…」が落ちることを確かめて戻す
3. `useAgentHooksWorkingReport.ts` の `else if (activity === 'idle' && awaitingIdle)` を `else if (activity !== 'working' && awaitingIdle)` にし、`npx vitest run src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx` で「working → permission・confirm では送らず…」が落ちることを確かめて戻す

- [ ] **Step 8: コミット（利用者の指示があるときだけ）**

```bash
git add src/main/agentToolActivity.ts src/main/handlers/agentTerminalHandlers.ts src/main/ipcHandlers.ts src/preload/api.ts src/preload/index.d.ts src/renderer/src/lib/agentTerminalApi.ts src/renderer/src/hooks/useAgentHooksWorkingReport.ts src/renderer/src/__tests__/setup.ts src/main/__tests__/agentToolActivity.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/agentTerminalApi.test.ts src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx
git commit -m "feat: 作業の終わりから 30 秒ターンの終わりの知らせが届かなければ、次の知らせまで割り当てを保留する"
```

---

### Task 2b: 段階 A の最終レビューで残した頑健性の 5（`activate` の順・starter の `exited` と `activate` の守り）

> **気をつける知見:** L-010（`exited` の後始末を 1 つずつ握る）・L-053・L-438（`spawnSession` は同期の関数のまま、`exited` の購読を `activate` の前に移す）

**Files:**
- Modify: `src/main/agentHookSessions.ts`（`activate` の順）
- Modify: `src/main/agentSessionStarter.ts`（`spawnSession` の後半と、後始末を握る関数）
- Test: `src/main/__tests__/agentHookSessions.test.ts`・`src/main/__tests__/agentSessionStarter.test.ts`

**Interfaces:**
- Consumes: Task 2a の追跡の `publish` が `onPhaseChange` の例外を握ること（`activate` が投げる経路を減らす）
- Produces: 公開の型は変えない。`activate` が投げても起動は `created`（`started`）で、`exited` で `release(prepared, sessionId)` が 1 回呼ばれる。`exited` の後始末（Map・予約・`release`）は 1 つが投げても残りを行う

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/agentHookSessions.test.ts` の `describe('createAgentHookSessions: activate・release', ...)` の最初に足す:
```ts
  it('hooks があれば、追跡に足してから(addSession)トークンを表に足す(addToken。addToken が投げても追跡は pending〈agent〉で残る)', () => {
    sessions().activate(WITH_HOOKS, 'sid-1')
    expect(calls.map((call) => call.split('(')[0])).toEqual(['addSession', 'addToken'])
  })
```

`src/main/__tests__/agentSessionStarter.test.ts` の `describe('createAgentSessionStarter(hooks)', ...)`:
- `'activate が例外を投げたら release(prepared, null) を 1 回呼び、起動は例外で終わる'` を次に置き換える:
```ts
  it('activate が例外を投げても起動は started で終わり、ログに出し、終了で release(prepared, sessionId) を 1 回呼んで予約を外す', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    hooks.activate.mockImplementationOnce(() => {
      throw new Error('activate boom')
    })
    const service = makeStarterService()
    await expect(service.start(1, REQUEST, makeSink())).resolves.toMatchObject({
      kind: 'started',
      sessionId: 'sid-1'
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[agentSessionStarter] hooks の結び付けに失敗しました:',
      expect.any(Error)
    )
    expect(hooks.release).not.toHaveBeenCalled()
    pty.emitExit(0, 0)
    await vi.waitFor(() =>
      expect(hooks.release).toHaveBeenCalledExactlyOnceWith(expect.any(Object), 'sid-1')
    )
    expect(service.claudeSessionIdOf('sid-1')).toBeUndefined()
    expect(reservations.tryReserve(NEW_IDS[0])).not.toBeNull()
  })

  it('終了の release が投げても予約と Map は外れ、unhandled rejection にならずにログに出す(L-010)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      hooks.release.mockImplementationOnce(() => {
        throw new Error('release boom')
      })
      const service = makeStarterService()
      await service.start(1, REQUEST, makeSink())
      pty.emitExit(0, 0)
      await vi.waitFor(() =>
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[agentSessionStarter] 終了の後始末(hooks)に失敗しました:',
          expect.any(Error)
        )
      )
      expect(service.claudeSessionIdOf('sid-1')).toBeUndefined()
      expect(reservations.tryReserve(NEW_IDS[0])).not.toBeNull()
      await new Promise((resolve) => setImmediate(resolve))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
```
（`registry` は実物の `AgentSessionRegistry` で、`emitExit` の後に枠からセッションを外す。`claudeSessionIdOf`・予約は starter の `exited` の後始末で外れる）

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentSessionStarter.test.ts`
Expected: FAIL（順が `addToken`・`addSession`、`activate` の例外で起動が例外で終わる、`release` の例外で unhandled rejection）

- [ ] **Step 3: 実装する**

`src/main/agentHookSessions.ts` の `activate` の hooks ありの分岐を次にする:
```ts
      // 追跡に先に足す(addToken で投げても、追跡は pending〈段階は agent〉で残る。安全側。頑健性の 5)
      tracker.addSession(prepared.ownerId, sessionId, { kind: 'pending' })
      receiver.addToken(prepared.hooks.token, { ownerId: prepared.ownerId, sessionId })
```

`src/main/agentSessionStarter.ts`:
- `createAgentSessionStarter` の中（`spawnSession` の前）に足す:
```ts
  /** 終了の後始末を 1 つずつ行う(1 つが投げても残りを行う。L-010) */
  function cleanUpQuietly(label: string, cleanup: () => void): void {
    try {
      cleanup()
    } catch (err) {
      console.error(`[agentSessionStarter] 終了の後始末(${label})に失敗しました:`, err)
    }
  }
```
- `spawnSession` の `// spawn の直後(await を挟まず)にトークンを表へ足し…` から `return { kind: 'created', session }` までを次にする（await を挟まない同期の区間のまま。L-438）:
```ts
    // 予約・Map・hooks は exited の解決で外す。registry が取り消した起動の停止の完了・終了・止める操作の完了は、どれも exited の
    // 解決になる(AgentSession.stop は止まりきると exited を解決する)。止める操作の間(stoppingSessions)は予約が残る。
    // registry へ返す前に購読するので、registry が枠からセッションを外すより先に Map から消える。activate より前に購読し、
    // activate が投げても後始末が漏れない(頑健性の 5)
    claudeSessionIdBySessionId.set(sessionId, claudeSessionId)
    void session.exited.then(() => {
      cleanUpQuietly('Map', () => claudeSessionIdBySessionId.delete(sessionId))
      cleanUpQuietly('予約', releaseReservation)
      cleanUpQuietly('hooks', () => hooks.release(prepared, sessionId))
    })
    // spawn の直後(await を挟まず)にトークンを表へ足し、追跡にセッションを足す。claude の最初の知らせより先に済む。
    // 失敗しても起動は続ける(hooks の知らせが届かないだけで、追跡は pending か無いまま。終了で release が呼ばれる)
    try {
      hooks.activate(prepared, sessionId)
    } catch (err) {
      console.error('[agentSessionStarter] hooks の結び付けに失敗しました:', err)
    }
    createdClaudeSession.claudeSessionId = claudeSessionId
    return { kind: 'created', session }
```
- `createSession` の `finally` の `if (creation?.kind !== 'created') hooks.release(prepared, null)` は変えない（`activate` の失敗で `created` を返すため、`release(prepared, null)` は呼ばれず、終了の `release(prepared, sessionId)` に任せる。`release` は 2 回呼ばれても害が無い）

- [ ] **Step 4: 通す**

Run: `npx vitest run src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentSessionStarter.test.ts`
Expected: PASS
Run: `npm test`
Expected: PASS（時間切れで落ちたファイルは単体で流し直す）
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/main/agentHookSessions.ts src/main/agentSessionStarter.ts src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentSessionStarter.test.ts && npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 5: 変異で確かめる**

1. `agentHookSessions.ts` の `addSession` と `addToken` の行を入れ替え、「追跡に足してから…」が落ちることを確かめて戻す
2. `spawnSession` の `try`/`catch` を外して `hooks.activate(prepared, sessionId)` だけにし、「activate が例外を投げても起動は started で終わり…」が落ちることを確かめて戻す
3. `cleanUpQuietly('hooks', ...)` を `hooks.release(prepared, sessionId)` に戻し、「終了の release が投げても…」が落ちることを確かめて戻す

- [ ] **Step 6: コミット（利用者の指示があるときだけ）**

```bash
git add src/main/agentHookSessions.ts src/main/agentSessionStarter.ts src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentSessionStarter.test.ts
git commit -m "fix: hooks の結び付けの失敗で起動と終了の後始末を止めない"
```

---

### Task 3: 区別のモデル（共有の型・`agentChangesAttribution`・`collectAgentChangeEntriesBetween` の export）

> **気をつける知見:** L-068（フォルダの行は配下を `/` の境目で照合する）・L-103（始点を取っている間の通し番号の変化・合図の往復を拾う）・L-439（理由の型を分ける）

記録（`agentChangesRecord.ts`）は変えない（記録の `attribution` の項目は、値を決める `begin` の変更と一緒に Task 4a で入れる）。`authorsOf`・`needsCurrentPeriod`・`summarizeAttribution` は B-2 で使うが、純粋な関数として B-1 でテストまで入れる。

**Files:**
- Modify: `src/shared/types/agentChanges.ts`（3 つの型の定義だけ）
- Create: `src/main/agentChangesAttribution.ts`
- Modify: `src/main/agentChangesQuery.ts`（`collectAgentChangeEntriesBetween` を export。説明）
- Test: `src/main/__tests__/agentChangesAttribution.test.ts`（新規）

**Interfaces:**
- Consumes: `AgentToolActivitySignal`・`AgentToolPhase`・`AgentHooksLostReason`（`src/main/agentToolActivity.ts`）、`BaselineSnapshot`（`src/main/agentBaselineSnapshot.ts`）
- Produces:
```ts
// src/shared/types/agentChanges.ts
export type AgentChangeAuthor = 'agent' | 'user' | 'mixed'
export type AgentChangesAttributionLostReason =
  | 'hooks-not-confirmed' | 'receiver-unavailable' | 'claude-version-unsupported' | 'checkpoint-failed'
export type AgentChangesAttributionSummary =
  | { kind: 'tracking'; since: number | null; hadUnassignedSince: boolean }
  | { kind: 'lost'; reason: AgentChangesAttributionLostReason; lostAt: number; hadMarks: boolean; since: number | null; hadUnassignedSince: boolean }

// src/main/agentChangesAttribution.ts
export interface AgentChangesCheckpoint { snapshot: BaselineSnapshot; sharedWithBaseline: boolean }
export interface AttributionMarks {
  userPaths: Set<string>
  agentPaths: Set<string>
  trackingSince: number | null
  hadUnassignedSince: boolean
  staleCheckpointDirs: string[]
}
export interface TrackingAttribution extends AttributionMarks {
  kind: 'tracking'
  phase: AgentToolPhase
  periodUnassignable: boolean
  timedOutPending: boolean
  checkpoint: AgentChangesCheckpoint
}
export interface LostAttribution extends AttributionMarks {
  kind: 'lost'
  reason: AgentChangesAttributionLostReason
  lostAt: number
}
export type AgentChangesAttribution = TrackingAttribution | LostAttribution
export interface InitialAttributionInput {
  baseline: BaselineSnapshot
  seqBefore: number
  seqAfter: number
  signalBefore: AgentToolActivitySignal
  signalAfter: AgentToolActivitySignal
}
export function initialAttribution(input: InitialAttributionInput): { attribution: AgentChangesAttribution; syncNow: boolean }
export function matches(entryPath: string, path: string): boolean
export function needsCurrentPeriod(attribution: AgentChangesAttribution): boolean
export function authorsOf(entries: readonly AgentChangeEntry[], attribution: AgentChangesAttribution, currentPaths: readonly string[] | null): (AgentChangeAuthor | null)[]
export function summarizeAttribution(attribution: AgentChangesAttribution): AgentChangesAttributionSummary
export function attributionTempDirs(attribution: AgentChangesAttribution): string[]
export type AttributionLogEvent = '開始' | '同期' | '吸収' | 'lost'
export function attributionLogLine(ownerId: number, event: AttributionLogEvent, phaseBefore: AgentToolPhase | null, attribution: AgentChangesAttribution): string

// src/main/agentChangesQuery.ts
export async function collectAgentChangeEntriesBetween(start: BaselineSnapshot, end: BaselineSnapshot, options?: BaselineGitOptions): Promise<AgentChangeEntry[]>
```

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/agentChangesAttribution.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { AgentChangeEntry } from '@shared/types'
import {
  attributionLogLine,
  attributionTempDirs,
  authorsOf,
  initialAttribution,
  matches,
  needsCurrentPeriod,
  summarizeAttribution
} from '../agentChangesAttribution'
import type {
  AgentChangesAttribution,
  LostAttribution,
  TrackingAttribution
} from '../agentChangesAttribution'
import type { AgentToolActivitySignal, AgentToolPhase } from '../agentToolActivity'
import { makeBaselineSnapshot } from './helpers/agentBaselineFixtures'

const baseline = makeBaselineSnapshot({ tempDir: '/tmp/base', startedAt: 100 })
const signal = (
  phase: AgentToolPhase,
  extra: Partial<AgentToolActivitySignal> = {}
): AgentToolActivitySignal => ({ phase, lost: null, unassignable: false, ...extra })
const start = (
  before: AgentToolActivitySignal,
  after: AgentToolActivitySignal,
  seqAfter = 3
): ReturnType<typeof initialAttribution> =>
  initialAttribution({ baseline, seqBefore: 3, seqAfter, signalBefore: before, signalAfter: after })

const tracking = (overrides: Partial<TrackingAttribution> = {}): TrackingAttribution => ({
  kind: 'tracking',
  phase: 'idle',
  periodUnassignable: false,
  timedOutPending: false,
  checkpoint: { snapshot: baseline, sharedWithBaseline: true },
  userPaths: new Set(),
  agentPaths: new Set(),
  trackingSince: 100,
  hadUnassignedSince: false,
  staleCheckpointDirs: [],
  ...overrides
})
const lost = (overrides: Partial<LostAttribution> = {}): LostAttribution => ({
  kind: 'lost',
  reason: 'checkpoint-failed',
  lostAt: 200,
  userPaths: new Set(),
  agentPaths: new Set(),
  trackingSince: 100,
  hadUnassignedSince: false,
  staleCheckpointDirs: [],
  ...overrides
})
const entry = (path: string, notRecorded = false): AgentChangeEntry => ({
  path,
  status: 'M',
  isDirectory: path.endsWith('/'),
  notRecorded
})

describe('initialAttribution(記録の始め方)', () => {
  it('idle で始まり idle で取り終え、通し番号が変わらなければ、始点を区切りにした tracking で、区別は始点の時刻から(同期しない)', () => {
    expect(start(signal('idle'), signal('idle'))).toEqual({
      attribution: tracking(),
      syncNow: false
    })
  })

  it('取り終えた時点が paused なら trackingSince は null(同期しない)', () => {
    expect(start(signal('idle'), signal('paused'))).toEqual({
      attribution: tracking({ phase: 'paused', trackingSince: null }),
      syncNow: false
    })
  })

  it('始点を取っている間に通し番号が変わったら、最初の区間に印を立てて同期を 1 回並べる(L-103)', () => {
    expect(start(signal('idle'), signal('idle'), 4)).toEqual({
      attribution: tracking({ periodUnassignable: true, trackingSince: null }),
      syncNow: true
    })
  })

  it.each<[string, AgentToolPhase, AgentToolPhase]>([
    ['取り始めが agent(pending を含む)', 'agent', 'idle'],
    ['取り終えが agent(pending を含む)', 'idle', 'agent']
  ])('%s なら印を立てて同期を 1 回並べる', (_label, before, after) => {
    expect(start(signal(before), signal(after))).toEqual({
      attribution: tracking({ phase: after, periodUnassignable: true, trackingSince: null }),
      syncNow: true
    })
  })

  it('取り始めにだけ合図の unassignable が立っていた(取っている間に保留が解けた)なら、印を立てて同期を並べる', () => {
    expect(start(signal('idle', { unassignable: true }), signal('idle'))).toEqual({
      attribution: tracking({ periodUnassignable: true, trackingSince: null }),
      syncNow: true
    })
  })

  it('取り終えた時点で合図の unassignable が立っていれば、印を立て trackingSince は null で、同期は並べない(合図が下りたときの同期に任せる)', () => {
    expect(
      start(signal('idle', { unassignable: true }), signal('idle', { unassignable: true }))
    ).toEqual({
      attribution: tracking({ periodUnassignable: true, trackingSince: null }),
      syncNow: false
    })
  })

  it('通し番号・段階の条件と合図の条件が両方成り立てば、印を立てて同期を並べる', () => {
    expect(start(signal('agent'), signal('agent', { unassignable: true }))).toEqual({
      attribution: tracking({ phase: 'agent', periodUnassignable: true, trackingSince: null }),
      syncNow: true
    })
  })

  it('区別をやめる合図があれば lost で始める(lostAt は始点の時刻。unassignable が同時に立っていても lost)', () => {
    expect(
      start(
        signal('agent'),
        signal('agent', { lost: 'hooks-not-confirmed', unassignable: true })
      )
    ).toEqual({
      attribution: lost({ reason: 'hooks-not-confirmed', lostAt: 100, trackingSince: null }),
      syncNow: false
    })
  })
})

describe('matches(パスの照合)', () => {
  it.each<[string, string, boolean]>([
    ['a.txt', 'a.txt', true],
    ['dir/', 'dir/a.txt', true],
    ['dir/a.txt', 'dir/', true],
    ['dir/', 'dir/', true],
    ['a', 'ab/', false],
    ['ab/', 'a', false],
    ['dir', 'dir/a.txt', false],
    ['dir/', 'dirx/a.txt', false],
    ['a.txt', 'b.txt', false]
  ])('%s と %s は %s', (entryPath, path, expected) => {
    expect(matches(entryPath, path)).toBe(expected)
  })
})

describe('authorsOf(行の author)', () => {
  const rows = [entry('u.txt'), entry('a.txt'), entry('m.txt'), entry('big.bin', true), entry('new/')]

  it('利用者の集合だけに一致 → user、両方 → mixed、それ以外 → agent、notRecorded → null。フォルダの行は配下を含めて照合する', () => {
    const attribution = tracking({
      userPaths: new Set(['u.txt', 'm.txt', 'big.bin', 'new/x.txt']),
      agentPaths: new Set(['a.txt', 'm.txt', 'new/y.txt'])
    })
    expect(authorsOf(rows, attribution, [])).toEqual(['user', 'agent', 'mixed', null, 'mixed'])
  })

  it('今の区間は段階で割り当てる(idle → 利用者、agent → エージェント、paused → どちらでもない)', () => {
    const paths = ['u.txt']
    expect(authorsOf([entry('u.txt')], tracking({ phase: 'idle' }), paths)).toEqual(['user'])
    expect(
      authorsOf([entry('u.txt')], tracking({ phase: 'agent', userPaths: new Set(['u.txt']) }), paths)
    ).toEqual(['mixed'])
    expect(authorsOf([entry('u.txt')], tracking({ phase: 'paused' }), paths)).toEqual(['agent'])
  })

  it('今の区間に印があれば割り当てない(呼び出し側も比べない)', () => {
    const attribution = tracking({ periodUnassignable: true })
    expect(needsCurrentPeriod(attribution)).toBe(false)
    expect(authorsOf([entry('u.txt')], attribution, ['u.txt'])).toEqual(['agent'])
  })

  it('区別していない記録(tracking で trackingSince が null、lost で集合が空)は、すべて null', () => {
    expect(authorsOf(rows, tracking({ trackingSince: null }), ['u.txt'])).toEqual(
      rows.map(() => null)
    )
    expect(authorsOf(rows, lost(), null)).toEqual(rows.map(() => null))
  })

  it('lost で集合があれば、今の区間を除いて集合だけで決める', () => {
    const attribution = lost({ userPaths: new Set(['u.txt']) })
    expect(needsCurrentPeriod(attribution)).toBe(false)
    expect(authorsOf([entry('u.txt'), entry('a.txt')], attribution, ['a.txt'])).toEqual([
      'user',
      'agent'
    ])
  })

  it('今の区間を比べなかった・失敗した(null)ときは集合だけで決める', () => {
    expect(needsCurrentPeriod(tracking())).toBe(true)
    expect(authorsOf([entry('u.txt')], tracking(), null)).toEqual(['agent'])
  })
})

describe('summarizeAttribution(要約)', () => {
  it('tracking は since・hadUnassignedSince', () => {
    expect(summarizeAttribution(tracking({ hadUnassignedSince: true }))).toEqual({
      kind: 'tracking',
      since: 100,
      hadUnassignedSince: true
    })
  })

  it('lost は理由・時刻・集合が空でないか(hadMarks)', () => {
    expect(summarizeAttribution(lost())).toEqual({
      kind: 'lost',
      reason: 'checkpoint-failed',
      lostAt: 200,
      hadMarks: false,
      since: 100,
      hadUnassignedSince: false
    })
    expect(summarizeAttribution(lost({ agentPaths: new Set(['a.txt']) }))).toMatchObject({
      hadMarks: true
    })
  })
})

describe('attributionTempDirs(記録を捨てるときに消す判定の区切り)', () => {
  it('始点と共有の区切りは返さず、共有でない区切りと削除待ちを返す', () => {
    expect(attributionTempDirs(tracking({ staleCheckpointDirs: ['/tmp/old'] }))).toEqual([
      '/tmp/old'
    ])
    expect(
      attributionTempDirs(
        tracking({
          checkpoint: {
            snapshot: makeBaselineSnapshot({ tempDir: '/tmp/cp' }),
            sharedWithBaseline: false
          },
          staleCheckpointDirs: ['/tmp/old']
        })
      )
    ).toEqual(['/tmp/cp', '/tmp/old'])
    expect(attributionTempDirs(lost({ staleCheckpointDirs: ['/tmp/old'] }))).toEqual(['/tmp/old'])
  })
})

describe('attributionLogLine(開発版のログ)', () => {
  it('段階・集合の件数・印・理由を 1 行にする(パスは出さない)', () => {
    const attribution: AgentChangesAttribution = tracking({
      phase: 'agent',
      userPaths: new Set(['secret/a.txt']),
      periodUnassignable: true
    })
    const line = attributionLogLine(1, '同期', 'idle', attribution)
    expect(line).toBe(
      '[agent-attribution] owner=1 event=同期 phase=idle→agent user=1 agent=0 unassignable=あり reason=-'
    )
    expect(line).not.toContain('secret')
    expect(attributionLogLine(2, '開始', null, lost({ reason: 'receiver-unavailable' }))).toBe(
      '[agent-attribution] owner=2 event=開始 phase=-→- user=0 agent=0 unassignable=なし reason=receiver-unavailable'
    )
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentChangesAttribution.test.ts`
Expected: FAIL（`Cannot find module '../agentChangesAttribution'`）

- [ ] **Step 3: 実装する**

`src/shared/types/agentChanges.ts` の `AgentChangeEntry` の定義の後に足す（`AgentChangeEntry` 自体は変えない）:
```ts
/** 一覧の行の区別(B-2 で AgentChangeEntry.author に載せる。B-1 は main の記録の中だけで使う) */
export type AgentChangeAuthor = 'agent' | 'user' | 'mixed'

/**
 * 記録の区別をやめた理由。main の追跡の理由(agentToolActivity の AgentHooksLostReason)に、判定の区切り・差分・今の区間の
 * 比較の失敗(checkpoint-failed)を足したもの。用途ごとに型を分け、string で受けない(L-439)
 */
export type AgentChangesAttributionLostReason =
  | 'hooks-not-confirmed'
  | 'receiver-unavailable'
  | 'claude-version-unsupported'
  | 'checkpoint-failed'

/** 記録の区別の要約(B-2 で AgentChangesState・AgentChangesListResult に載せる)。since は区別を始めた時刻、hadMarks は集合が空でないか */
export type AgentChangesAttributionSummary =
  | { kind: 'tracking'; since: number | null; hadUnassignedSince: boolean }
  | {
      kind: 'lost'
      reason: AgentChangesAttributionLostReason
      lostAt: number
      hadMarks: boolean
      since: number | null
      hadUnassignedSince: boolean
    }
```

`src/main/agentChangesAttribution.ts`:
```ts
import type {
  AgentChangeAuthor,
  AgentChangeEntry,
  AgentChangesAttributionLostReason,
  AgentChangesAttributionSummary
} from '@shared/types'
import type { BaselineSnapshot } from './agentBaselineSnapshot'
import type { AgentToolActivitySignal, AgentToolPhase } from './agentToolActivity'

// 記録の利用者の変更との区別の型と純粋な関数(設計書「利用者の変更の判定」)。記録ごとに、最後の判定の区切り(checkpoint)・
// 今の区間の段階(phase)・割り当てられない印・利用者とエージェントが変えたパスの集合(git の表記)を持つ。区切りの取得・差分・
// 割り当ての手順は agentChangesAttributionSync.ts(registry が所有者の列の中で呼ぶ)。ここはファイル・git を読まない

/** 最後の判定の区切りと、それが累積の始点(record.baseline)と同じものか(同じなら消さない。L-004) */
export interface AgentChangesCheckpoint {
  snapshot: BaselineSnapshot
  sharedWithBaseline: boolean
}

/** 区別をやめた後も残す印 */
export interface AttributionMarks {
  /** 利用者が変えたパス(リポジトリ相対。git の表記) */
  userPaths: Set<string>
  /** エージェントが変えたパス */
  agentPaths: Set<string>
  /** 最初に割り当てる区間(idle・agent で印の無い区間)が始まった時刻(まだなら null) */
  trackingSince: number | null
  /** trackingSince の後に、paused の区間か割り当てられない区間があったか */
  hadUnassignedSince: boolean
  /** 消せなかった前の判定の区切りの一時ディレクトリ(clear・close で消す。L-428) */
  staleCheckpointDirs: string[]
}

export interface TrackingAttribution extends AttributionMarks {
  kind: 'tracking'
  /** 今の区間(最後の区切りから今まで)の段階 */
  phase: AgentToolPhase
  /** 今の区間を割り当てられない印 */
  periodUnassignable: boolean
  /** PreToolUse の待ちの打ち切り(失敗を含む)があり、まだ同期の手順 9 で片付けていない印(立てるのは markPeriodUnassignable だけ) */
  timedOutPending: boolean
  checkpoint: AgentChangesCheckpoint
}

export interface LostAttribution extends AttributionMarks {
  kind: 'lost'
  reason: AgentChangesAttributionLostReason
  lostAt: number
}

export type AgentChangesAttribution = TrackingAttribution | LostAttribution

export interface InitialAttributionInput {
  /** 累積の始点(最初の判定の区切りにする) */
  baseline: BaselineSnapshot
  /** 始点を取り始める直前のツールの開始の通し番号 */
  seqBefore: number
  /** 記録を作る時点の通し番号 */
  seqAfter: number
  /** 始点を取り始める直前の合図 */
  signalBefore: AgentToolActivitySignal
  /** 記録を作る時点の合図 */
  signalAfter: AgentToolActivitySignal
}

const emptyMarks = (): AttributionMarks => ({
  userPaths: new Set(),
  agentPaths: new Set(),
  trackingSince: null,
  hadUnassignedSince: false,
  staleCheckpointDirs: []
})

/**
 * 記録の区別の初期値(設計書「記録に持つもの」)。syncNow が真なら、registry は記録を置いた後に同期を 1 回並べる。
 * 始点を取っている間の区間(始点から最初の同期まで)は、ツールが動いた・動いていた・合図の unassignable が立っていたら割り当てない
 */
export function initialAttribution({
  baseline,
  seqBefore,
  seqAfter,
  signalBefore,
  signalAfter
}: InitialAttributionInput): { attribution: AgentChangesAttribution; syncNow: boolean } {
  if (signalAfter.lost !== null) {
    // 追跡の理由(AgentHooksLostReason)は記録の理由に含まれる(型で確かめる。L-439)
    const reason: AgentChangesAttributionLostReason = signalAfter.lost
    return {
      attribution: { kind: 'lost', reason, lostAt: baseline.startedAt, ...emptyMarks() },
      syncNow: false
    }
  }
  const toolOrAgent =
    seqAfter !== seqBefore || signalBefore.phase === 'agent' || signalAfter.phase === 'agent'
  const signalMark = signalBefore.unassignable || signalAfter.unassignable
  const periodUnassignable = toolOrAgent || signalMark
  // 合図だけが理由なら、合図が下りたときの同期に任せる。取っている間に下りた場合は、その通知の時点で記録が無かったため並べる
  const syncNow = toolOrAgent || (signalBefore.unassignable && !signalAfter.unassignable)
  return {
    attribution: {
      kind: 'tracking',
      phase: signalAfter.phase,
      periodUnassignable,
      timedOutPending: false,
      checkpoint: { snapshot: baseline, sharedWithBaseline: true },
      ...emptyMarks(),
      trackingSince:
        !periodUnassignable && signalAfter.phase !== 'paused' ? baseline.startedAt : null
    },
    syncNow
  }
}

/**
 * 行のパスと集合のパスの照合: 完全一致、または片方が '/' で終わるフォルダの表記でもう片方がその下(前方一致は '/' の境目でだけ。
 * L-007・L-068)。どちらも git の出力のパス(同じ記録のインデックスの系統)で、hook のパス・OS のパスと比べない(L-009・L-018)
 */
export function matches(entryPath: string, path: string): boolean {
  if (entryPath === path) return true
  if (entryPath.endsWith('/') && path.startsWith(entryPath)) return true
  return path.endsWith('/') && entryPath.startsWith(path)
}

/** 今の区間(最後の判定の区切り → 作業ツリー)を比べて割り当てるか(tracking で印が無いときだけ) */
export function needsCurrentPeriod(attribution: AgentChangesAttribution): boolean {
  return attribution.kind === 'tracking' && !attribution.periodUnassignable
}

/** 区別している記録か(tracking なら区別を始めた後、lost なら印が残っている) */
const isDistinguishing = (attribution: AgentChangesAttribution): boolean =>
  attribution.kind === 'tracking'
    ? attribution.trackingSince !== null
    : attribution.userPaths.size + attribution.agentPaths.size > 0

/**
 * 一覧の行の author(設計書「行の author」2〜5)。currentPaths は今の区間のパス(needsCurrentPeriod が偽・比べなかった・失敗したら null)。
 * 区別していない記録はすべて null。notRecorded の行は null。利用者の集合に一致してエージェントに無い → user、両方 → mixed、それ以外 → agent
 */
export function authorsOf(
  entries: readonly AgentChangeEntry[],
  attribution: AgentChangesAttribution,
  currentPaths: readonly string[] | null
): (AgentChangeAuthor | null)[] {
  if (!isDistinguishing(attribution)) return entries.map(() => null)
  const user = [...attribution.userPaths]
  const agent = [...attribution.agentPaths]
  if (needsCurrentPeriod(attribution) && currentPaths !== null && attribution.kind === 'tracking') {
    if (attribution.phase === 'idle') user.push(...currentPaths)
    else if (attribution.phase === 'agent') agent.push(...currentPaths)
  }
  return entries.map((entry) => {
    if (entry.notRecorded) return null
    if (!user.some((path) => matches(entry.path, path))) return 'agent'
    return agent.some((path) => matches(entry.path, path)) ? 'mixed' : 'user'
  })
}

/** IPC に載せる要約(B-2 で使う) */
export function summarizeAttribution(
  attribution: AgentChangesAttribution
): AgentChangesAttributionSummary {
  if (attribution.kind === 'tracking') {
    return {
      kind: 'tracking',
      since: attribution.trackingSince,
      hadUnassignedSince: attribution.hadUnassignedSince
    }
  }
  return {
    kind: 'lost',
    reason: attribution.reason,
    lostAt: attribution.lostAt,
    hadMarks: attribution.userPaths.size + attribution.agentPaths.size > 0,
    since: attribution.trackingSince,
    hadUnassignedSince: attribution.hadUnassignedSince
  }
}

/** 記録を捨てるときに消す判定の区切りの一時ディレクトリ(始点と共有のものは始点の側で消す。L-004) */
export function attributionTempDirs(attribution: AgentChangesAttribution): string[] {
  const own =
    attribution.kind === 'tracking' && !attribution.checkpoint.sharedWithBaseline
      ? [attribution.checkpoint.snapshot.tempDir]
      : []
  return [...own, ...attribution.staleCheckpointDirs]
}

export type AttributionLogEvent = '開始' | '同期' | '吸収' | 'lost'

/** 開発版のログの 1 行(パス・内容は出さない。L-017) */
export function attributionLogLine(
  ownerId: number,
  event: AttributionLogEvent,
  phaseBefore: AgentToolPhase | null,
  attribution: AgentChangesAttribution
): string {
  const after = attribution.kind === 'tracking' ? attribution.phase : '-'
  const unassignable =
    attribution.kind === 'tracking' && attribution.periodUnassignable ? 'あり' : 'なし'
  const reason = attribution.kind === 'lost' ? attribution.reason : '-'
  return (
    `[agent-attribution] owner=${ownerId} event=${event} phase=${phaseBefore ?? '-'}→${after} ` +
    `user=${attribution.userPaths.size} agent=${attribution.agentPaths.size} ` +
    `unassignable=${unassignable} reason=${reason}`
  )
}
```

`src/main/agentChangesQuery.ts` の `collectAgentChangeEntriesBetween` の `async function` を `export async function` にし、その説明の `使うのは listAgentChangesBetween だけ` を `使うのは listAgentChangesBetween と、記録の区別の判定の区切りの差分(agentChangesAttributionSync。registry の依存 collectBetween として渡す)` に直す

- [ ] **Step 4: 通す**

Run: `npx vitest run src/main/__tests__/agentChangesAttribution.test.ts src/main/__tests__/agentChangesQuery.integration.test.ts`
Expected: PASS
Run: `npm test`
Expected: PASS（時間切れで落ちたファイルは単体で流し直す）
Run: `npm run typecheck`
Expected: PASS（`initialAttribution` の `const reason: AgentChangesAttributionLostReason = signalAfter.lost` が通る＝追跡の理由が記録の理由に含まれる）
Run: `npx eslint --fix src/shared/types/agentChanges.ts src/main/agentChangesAttribution.ts src/main/agentChangesQuery.ts src/main/__tests__/agentChangesAttribution.test.ts && npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 5: 変異で確かめる**

1. `initialAttribution` の `syncNow` を `toolOrAgent` だけにし、「取り始めにだけ合図の unassignable が立っていた…」が落ちることを確かめて戻す
2. `matches` の `path.startsWith(entryPath)` を `path.startsWith(entryPath.slice(0, -1))` にし、「dir/ と dirx/a.txt は false」が落ちることを確かめて戻す

- [ ] **Step 6: コミット（利用者の指示があるときだけ）**

```bash
git add src/shared/types/agentChanges.ts src/main/agentChangesAttribution.ts src/main/agentChangesQuery.ts src/main/__tests__/agentChangesAttribution.test.ts
git commit -m "feat: 記録の利用者の変更との区別の型と純粋な関数を足す"
```

---

### Task 4a: 記録の区別の項目と開始（`agentChangesRecord` の `attribution`・registry の依存・`begin` の区別の初期値）

> **気をつける知見:** L-060（registry の依存 `attribution`・`attributionDevLog`・`collectBetween` を必須にし、組み立てを同一性で確かめる）・L-061（`begin` で区別を始める・`clear`・`close` で判定の区切りと削除待ちを消す）・L-103

このタスクでは区別の初期値を記録に持ち、開発版のログを出すだけで、同期は並べない（`initialAttribution` の `syncNow` は Task 4b で使う）。`ipcHandlers.ts` の runtime のつなぎ先は段階 A のまま何もしない。

**Files:**
- Modify: `src/main/agentChangesRecord.ts`（`AgentChangesRecord.attribution`・`createAgentChangesRecord` の 4 つ目の引数・`agentChangesRecordTempDirs`）
- Modify: `src/main/agentBaselineRegistry.ts`（依存 3 つ・`begin`・`logAttribution`）
- Modify: `src/main/ipcHandlers.ts`（registry の依存）
- Modify: `src/main/__tests__/helpers/agentBaselineFixtures.ts`（`makeTrackingAttribution`・`makeAgentChangesRecord` の既定値・`createFakeAttributionSource`）
- Test: `src/main/__tests__/agentBaselineRegistry.attribution.test.ts`（新規）・`agentChangesRecord.test.ts`・`helpers/agentBaselineFixtures.test.ts`・`agentBaselineRegistry.test.ts`・`handlers/agentChangesHandlers.test.ts`・`handlers/agentChangesHandlers.integration.test.ts`・`ipcHandlers.test.ts`

**Interfaces:**
- Consumes: Task 3 の `AgentChangesAttribution`・`initialAttribution`・`attributionTempDirs`・`attributionLogLine`・`AttributionLogEvent`・`collectAgentChangeEntriesBetween`
- Produces:
```ts
// src/main/agentChangesRecord.ts
export interface AgentChangesRecord {
  // ...既存
  /** 利用者の変更との区別(registry の begin・同期・吸収だけが書き換える) */
  attribution: AgentChangesAttribution
}
export function createAgentChangesRecord(
  baseline: BaselineSnapshot,
  recordSerial: number,
  refName: string,
  attribution: AgentChangesAttribution
): AgentChangesRecord
// agentChangesRecordTempDirs は attributionTempDirs(record.attribution) を最後に足す

// src/main/agentBaselineRegistry.ts
export interface AgentBaselineRegistryDeps {
  // ...既存
  collectBetween: (start: BaselineSnapshot, end: BaselineSnapshot) => Promise<AgentChangeEntry[]>
  attribution: Pick<AgentToolActivity, 'activityOf' | 'toolStartSeqOf'>
  attributionDevLog: ((line: string) => void) | null
}

// src/main/__tests__/helpers/agentBaselineFixtures.ts
export function makeTrackingAttribution(baseline: BaselineSnapshot, overrides?: Partial<TrackingAttribution>): TrackingAttribution
export interface FakeAttributionSource extends Pick<AgentToolActivity, 'activityOf' | 'toolStartSeqOf'> {
  signal: AgentToolActivitySignal
  seq: number
  set(next: Partial<AgentToolActivitySignal>): void
}
export function createFakeAttributionSource(initial?: Partial<AgentToolActivitySignal>): FakeAttributionSource
```

- [ ] **Step 1: 補助の偽物と失敗するテストを書く**

`src/main/__tests__/helpers/agentBaselineFixtures.ts`:
- import に足す:
```ts
import type { TrackingAttribution } from '../../agentChangesAttribution'
import type { AgentToolActivity, AgentToolActivitySignal } from '../../agentToolActivity'
```
- `makeAgentChangesRecord` の前に足す:
```ts
// 区別を始めたばかりの記録の区別(idle・印なし・始点を区切りにする・区別は始点の時刻から)。記録の形のテストの既定値に使う
export function makeTrackingAttribution(
  baseline: BaselineSnapshot,
  overrides: Partial<TrackingAttribution> = {}
): TrackingAttribution {
  return {
    kind: 'tracking',
    phase: 'idle',
    periodUnassignable: false,
    timedOutPending: false,
    checkpoint: { snapshot: baseline, sharedWithBaseline: true },
    userPaths: new Set(),
    agentPaths: new Set(),
    trackingSince: baseline.startedAt,
    hadUnassignedSince: false,
    staleCheckpointDirs: [],
    ...overrides
  }
}
```
- `makeAgentChangesRecord` の本体を次にする:
```ts
  const recordSerial = overrides.recordSerial ?? 1
  const baseline = overrides.baseline ?? makeBaselineSnapshot()
  return {
    baseline,
    runs,
    nextNumber: overrides.nextNumber ?? runs.length + 1,
    recordSerial,
    protection: overrides.protection ?? {
      refName: protectionRefName(FAKE_PROTECTION_INSTANCE_ID, recordSerial),
      value: null,
      swept: false
    },
    undo: overrides.undo ?? null,
    attribution: overrides.attribution ?? makeTrackingAttribution(baseline)
  }
```
- ファイルの末尾に足す:
```ts
/** registry の依存 attribution の偽物(追跡の合図と通し番号)。値を書き換えても registry には知らせない(知らせるのはテスト) */
export interface FakeAttributionSource
  extends Pick<AgentToolActivity, 'activityOf' | 'toolStartSeqOf'> {
  signal: AgentToolActivitySignal
  seq: number
  set(next: Partial<AgentToolActivitySignal>): void
}

// 既定は paused・合図なし・通し番号 0
export function createFakeAttributionSource(
  initial: Partial<AgentToolActivitySignal> = {}
): FakeAttributionSource {
  const source: FakeAttributionSource = {
    signal: { phase: 'paused', lost: null, unassignable: false, ...initial },
    seq: 0,
    set: (next) => {
      source.signal = { ...source.signal, ...next }
    },
    activityOf: () => source.signal,
    toolStartSeqOf: () => source.seq
  }
  return source
}
```

`src/main/__tests__/helpers/agentBaselineFixtures.test.ts`:
- import に `makeTrackingAttribution` を足す
- `'既定は makeBaselineSnapshot() の始点で、次の番号は実行の数 + 1'` と `'始点と次の番号を上書きする'` の `toEqual({ ... })` の `undo: null` の後に、それぞれ `attribution: makeTrackingAttribution(makeBaselineSnapshot())`・`attribution: makeTrackingAttribution(baseline)` を足す

`src/main/__tests__/agentChangesRecord.test.ts`:
- import に `makeTrackingAttribution` を足す（`./helpers/agentBaselineFixtures` から）
- `describe('createAgentChangesRecord', ...)` のテストを次にする:
```ts
  it('実行なし・番号 1・保護はまだ作っていない状態で、渡された区別の初期値を持って作る', () => {
    const attribution = makeTrackingAttribution(baseline)
    expect(
      createAgentChangesRecord(
        baseline,
        3,
        'refs/prompt-ide/agent-changes/1-00000000/3',
        attribution
      )
    ).toEqual({
      baseline,
      runs: [],
      nextNumber: 1,
      recordSerial: 3,
      protection: {
        refName: 'refs/prompt-ide/agent-changes/1-00000000/3',
        value: null,
        swept: false
      },
      undo: null,
      attribution
    })
  })
```
- `describe('agentChangesRecordTempDirs', ...)` の最後に足す:
```ts
  it('判定の区切り(始点と共有でないもの)と、消せなかった前の判定の区切り(削除待ち)も返す', () => {
    const record = makeAgentChangesRecord([], {
      baseline,
      attribution: makeTrackingAttribution(baseline, {
        checkpoint: {
          snapshot: makeBaselineSnapshot({ tempDir: '/tmp/cp' }),
          sharedWithBaseline: false
        },
        staleCheckpointDirs: ['/tmp/stale']
      })
    })
    expect(agentChangesRecordTempDirs(record)).toEqual([baseline.tempDir, '/tmp/cp', '/tmp/stale'])
  })
```

`src/main/__tests__/agentBaselineRegistry.attribution.test.ts`（新規）:
```ts
import { describe, expect, it, vi } from 'vitest'
import { AgentBaselineRegistry } from '../agentBaselineRegistry'
import type { AgentBaselineRegistryDeps } from '../agentBaselineRegistry'
import type { BaselineSnapshotResult } from '../agentBaselineSnapshot'
import type { AgentChangesRecord } from '../agentChangesRecord'
import type { AgentToolActivitySignal } from '../agentToolActivity'
import {
  createFakeAttributionSource,
  makeBaselineSnapshot,
  makeFakeProtectionDeps
} from './helpers/agentBaselineFixtures'
import type { FakeAttributionSource } from './helpers/agentBaselineFixtures'

// 記録の利用者の変更との区別(設計書「利用者の変更の判定」)を、偽の takeSnapshot(完了を外から解決する)・偽の差分・偽の追跡で試す。
// 実 git の結合は agentChangesAttribution.integration.test.ts

const FOLDER = '/repo'

interface SnapshotCall {
  baseIndexPath: string | undefined
  isCanceled: () => boolean
  resolve: (result: BaselineSnapshotResult) => void
}

interface Harness {
  registry: AgentBaselineRegistry
  source: FakeAttributionSource
  /** takeSnapshot の呼び出し(呼ばれた順。0 番目は累積の始点) */
  calls: SnapshotCall[]
  collectBetween: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['collectBetween']>>
  removeDir: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['removeDir']>>
  removeDirSync: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['removeDirSync']>>
  executeUndo: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['executeUndo']>>
  devLog: ReturnType<typeof vi.fn<(line: string) => void>>
}

function setup(initial: Partial<AgentToolActivitySignal> = { phase: 'idle' }): Harness {
  const calls: SnapshotCall[] = []
  const takeSnapshot = vi.fn<AgentBaselineRegistryDeps['takeSnapshot']>(
    (_folderPath, options) =>
      new Promise<BaselineSnapshotResult>((resolve) => {
        calls.push({ baseIndexPath: options.baseIndexPath, isCanceled: options.isCanceled, resolve })
      })
  )
  const collectBetween = vi.fn<AgentBaselineRegistryDeps['collectBetween']>(async () => [])
  const removeDir = vi.fn<AgentBaselineRegistryDeps['removeDir']>(async () => undefined)
  const removeDirSync = vi.fn<AgentBaselineRegistryDeps['removeDirSync']>()
  const executeUndo = vi.fn<AgentBaselineRegistryDeps['executeUndo']>(async () => ({
    kind: 'done',
    restoredPaths: [],
    trashedPaths: []
  }))
  const devLog = vi.fn<(line: string) => void>()
  const source = createFakeAttributionSource(initial)
  const registry = new AgentBaselineRegistry({
    takeSnapshot,
    collectBetween,
    removeDir,
    removeDirSync,
    now: () => 500,
    protection: makeFakeProtectionDeps(),
    executeUndo,
    attribution: source,
    attributionDevLog: devLog
  })
  return { registry, source, calls, collectBetween, removeDir, removeDirSync, executeUndo, devLog }
}

/** 区切り n(n = 0 は累積の始点。tempDir は /tmp/cp-<n>、indexPath は /tmp/cp-<n>/index、startedAt は 100 + n) */
const checkpointResult = (n: number): BaselineSnapshotResult => ({
  kind: 'recorded',
  snapshot: makeBaselineSnapshot({
    folderPath: FOLDER,
    tempDir: `/tmp/cp-${n}`,
    tree: `tree-${n}`,
    startedAt: 100 + n
  })
})

/** index 番目の takeSnapshot の呼び出しが来るまで待つ */
async function snapshotCall(h: Harness, index: number): Promise<SnapshotCall> {
  await vi.waitFor(() => expect(h.calls.length).toBeGreaterThan(index))
  return h.calls[index]
}

/** 記録を始め(累積の始点は cp-0)、記録を返す。始点の後に同期が並ばない合図で使う */
async function startRecord(h: Harness): Promise<AgentChangesRecord> {
  const begun = h.registry.begin(1, FOLDER, 'manual')
  ;(await snapshotCall(h, 0)).resolve(checkpointResult(0))
  await begun
  const record = await h.registry.withRecord(1, FOLDER, async (r) => r)
  if (record === null) throw new Error('記録が無い')
  return record
}

describe('記録の区別の始め方(begin)', () => {
  it('ツールが動いていない(idle)ときに始めると、累積の始点を判定の区切りにした tracking で始め、区別は始点の時刻から', async () => {
    const h = setup({ phase: 'idle' })
    const record = await startRecord(h)
    expect(record.attribution).toEqual({
      kind: 'tracking',
      phase: 'idle',
      periodUnassignable: false,
      timedOutPending: false,
      checkpoint: { snapshot: record.baseline, sharedWithBaseline: true },
      userPaths: new Set(),
      agentPaths: new Set(),
      trackingSince: 100,
      hadUnassignedSince: false,
      staleCheckpointDirs: []
    })
    expect(h.calls).toHaveLength(1)
  })

  it('paused で始めると trackingSince は null', async () => {
    const h = setup({ phase: 'paused' })
    const record = await startRecord(h)
    expect(record.attribution).toMatchObject({ kind: 'tracking', phase: 'paused', trackingSince: null })
  })

  it('区別をやめる合図があれば lost で始める(lostAt は始点の時刻)', async () => {
    const h = setup({ phase: 'agent', lost: 'receiver-unavailable' })
    const record = await startRecord(h)
    expect(record.attribution).toMatchObject({
      kind: 'lost',
      reason: 'receiver-unavailable',
      lostAt: 100
    })
  })

  it('取り終えた時点で合図の unassignable が立っていれば、最初の区間に印を立てる(trackingSince は null)', async () => {
    const h = setup({ phase: 'idle', unassignable: true })
    const record = await startRecord(h)
    expect(record.attribution).toMatchObject({
      kind: 'tracking',
      periodUnassignable: true,
      trackingSince: null
    })
  })

  it('開発版のログに開始の行を出す', async () => {
    const h = setup({ phase: 'idle' })
    await startRecord(h)
    expect(h.devLog).toHaveBeenCalledWith(
      '[agent-attribution] owner=1 event=開始 phase=-→idle user=0 agent=0 unassignable=なし reason=-'
    )
  })
})
```

`src/main/__tests__/ipcHandlers.test.ts`:
- `const mockToolActivity = vi.hoisted(...)` を次にする:
```ts
const mockToolActivity = vi.hoisted(() => ({
  reportWorking: vi.fn(),
  reportWorkingEnded: vi.fn(),
  activityOf: vi.fn(() => ({ phase: 'paused', lost: null, unassignable: false })),
  toolStartSeqOf: vi.fn(() => 0)
}))
```
- import に `import type { AgentBaselineRegistryDeps } from '../agentBaselineRegistry'` と `import { collectAgentChangeEntriesBetween } from '../agentChangesQuery'` を足す
- `'エージェントの変更の記録の寿命と IPC に、…'` の後に足す:
```ts
  it('記録の registry に、追跡(区別の合図と通し番号)・区切りの差分・開発版の区別のログ(app.isPackaged でないとき)を渡す', () => {
    registerIpcHandlers(mockIpcMain)
    const registry = mockSetupAgentBaselineLifecycle.mock.calls[0][1] as AgentBaselineRegistry
    // 依存は private のため、組み立ての確認に限って型を外して読む
    const deps = (registry as unknown as { deps: AgentBaselineRegistryDeps }).deps
    expect(deps.attribution).toBe(mockToolActivity)
    expect(deps.collectBetween).toBe(collectAgentChangeEntriesBetween)
    expect(typeof deps.attributionDevLog).toBe('function')
  })
```

`src/main/__tests__/agentBaselineRegistry.test.ts`:
- import に `createFakeAttributionSource` を足す（`./helpers/agentBaselineFixtures` から）
- `setup` の `new AgentBaselineRegistry({ ... })` に足す（`executeUndo,` の後）:
```ts
    // 区別をやめた記録で始め、区別の同期・吸収の区切りを取らない(区別は agentBaselineRegistry.attribution.test.ts で見る)
    collectBetween: vi.fn<AgentBaselineRegistryDeps['collectBetween']>(async () => []),
    attribution: createFakeAttributionSource({ lost: 'receiver-unavailable' }),
    attributionDevLog: null,
```

`src/main/__tests__/handlers/agentChangesHandlers.test.ts`:
- import に `createFakeAttributionSource` を足す
- `beforeEach` の `new AgentBaselineRegistry({ ... })` の `executeUndo: ...` の後に足す:
```ts
    // 区別をやめた記録で始め、区別の区切りを取らない(区別は registry のテストで見る)
    collectBetween: async () => [],
    attribution: createFakeAttributionSource({ lost: 'receiver-unavailable' }),
    attributionDevLog: null
```

`src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`:
- import に `collectAgentChangeEntriesBetween`（`../../agentChangesQuery`）・`createFakeAttributionSource`・`type FakeAttributionSource`（`../helpers/agentBaselineFixtures`）を足す
- `beforeEach` の registry と `rebuildRegistry` の registry の組み立てを、次の関数に寄せる（`let registry` などの宣言の後に置く）:
```ts
// registry の依存。区別は既定で lost(区別の区切りを取らない)。区別を試す describe は attribution を渡す
function makeRegistry(
  protection: Partial<AgentBaselineProtectionDeps> = {},
  attribution: FakeAttributionSource = createFakeAttributionSource({ lost: 'receiver-unavailable' })
): AgentBaselineRegistry {
  return new AgentBaselineRegistry({
    takeSnapshot: (folderPath, options) =>
      takeBaselineSnapshot(folderPath, { ...options, tempRoot }),
    collectBetween: (start, end) => collectAgentChangeEntriesBetween(start, end),
    removeDir: removeBaselineDir,
    removeDirSync: removeBaselineDirSync,
    now: Date.now,
    protection: {
      instanceId: INSTANCE_ID,
      noHooksDir,
      git: protectionRefGit,
      isProcessAlive: isProcessAliveOnThisMachine,
      ...protection
    },
    executeUndo: (folderPath, undo) =>
      executeAgentChangesUndo({ folderPath, undo, trash: trash.trash }),
    attribution,
    attributionDevLog: null
  })
}
```
  `beforeEach` の `registry = new AgentBaselineRegistry({ ... })` を `registry = makeRegistry()` にし、`rebuildRegistry` を次にする:
```ts
// 古い registry を閉じ、依存を差し替えた新しい registry で handler を登録し直す
function rebuildRegistry(
  protection: Partial<AgentBaselineProtectionDeps> = {},
  attribution?: FakeAttributionSource
): void {
  registry.close()
  handles.clear()
  registry = makeRegistry(protection, attribution)
  registerAgentChangesHandlers(ipcMain as never, {
    registry,
    folderAccess,
    trash: trash.trash,
    undoCapture: { tempRoot, maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES }
  })
}
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/ipcHandlers.test.ts`
Expected: FAIL（記録に `attribution` が無い・registry が依存を受けない）。`npm run typecheck` も落ちる

- [ ] **Step 3: 実装する**

`src/main/agentChangesRecord.ts`:
- import に足す:
```ts
import { attributionTempDirs } from './agentChangesAttribution'
import type { AgentChangesAttribution } from './agentChangesAttribution'
```
- 先頭の説明の「直前の戻す操作の取り消しの控え(0 か 1 つ)を持つ。」の後に「利用者の変更との区別(attribution)も持つ。」を足す
- `AgentChangesRecord` の `undo` の後に足す:
```ts
  /** 利用者の変更との区別(registry の begin・同期・吸収だけが書き換える。設計書「記録に持つもの」) */
  attribution: AgentChangesAttribution
```
- `agentChangesRecordTempDirs` の説明を `記録を捨てるときに消す一時ディレクトリ(累積の始点・実行が持つもの・取り消しの控え・判定の区切りと削除待ち)` にし、配列の最後に `...attributionTempDirs(record.attribution)` を足す
- `createAgentChangesRecord` を次にする:
```ts
/** 累積の始点を取ったときの記録(実行なし・保護はまだ作っていない)。区別の初期値は registry が始点の前後の合図で決めて渡す */
export function createAgentChangesRecord(
  baseline: BaselineSnapshot,
  recordSerial: number,
  refName: string,
  attribution: AgentChangesAttribution
): AgentChangesRecord {
  return {
    baseline,
    runs: [],
    nextNumber: 1,
    recordSerial,
    protection: { refName, value: null, swept: false },
    undo: null,
    attribution
  }
}
```

`src/main/agentBaselineRegistry.ts`:
- import に足す:
```ts
import type { AgentChangeEntry } from '@shared/types'
import { attributionLogLine, initialAttribution } from './agentChangesAttribution'
import type { AttributionLogEvent } from './agentChangesAttribution'
import type { AgentToolActivity, AgentToolPhase } from './agentToolActivity'
```
  （`@shared/types` の既存の `import type { ... }` に `AgentChangeEntry` を足してもよい）
- 先頭の説明の最後に足す:
```ts
// - 区別: 記録ごとに利用者の変更とエージェントの変更を区別する(設計書「利用者の変更の判定」)。begin で始め、追跡の合図の変化で
//   列に同期を並べ、判定の区切りの差分を段階に割り当てる(手順は agentChangesAttributionSync.ts。Task 4b・5)
```
- `AgentBaselineRegistryDeps` の `executeUndo` の後に足す:
```ts
  /** 2 つの区切りの間の変更(agentChangesQuery の collectAgentChangeEntriesBetween)。判定の区切りの差分に使う */
  collectBetween: (start: BaselineSnapshot, end: BaselineSnapshot) => Promise<AgentChangeEntry[]>
  /** ウィンドウの段階の合図とツールの開始の通し番号(agentToolActivity の追跡。必須。L-060) */
  attribution: Pick<AgentToolActivity, 'activityOf' | 'toolStartSeqOf'>
  /** 開発版の区別のログ(1 行ずつ)。null なら出さない(ipcHandlers.ts が !app.isPackaged のときだけ console.log を渡す) */
  attributionDevLog: ((line: string) => void) | null
```
- `begin` の `const request = (async (): Promise<AgentChangesState> => {` の直後に足す:
```ts
      // 始点を取り始める直前の通し番号と合図(設計書「記録に持つもの」。始点を取っている間のツールの開始・往復を拾う。L-103)
      const seqBefore = this.deps.attribution.toolStartSeqOf(ownerId)
      const signalBefore = this.deps.attribution.activityOf(ownerId)
```
- 同じ `request` の `if (previous !== undefined) await this.removeDirs(agentChangesRecordTempDirs(previous))` の後を次にする（区別の初期値を決めてから記録を置くまで await を挟まない）:
```ts
      // 記録を作る時点の合図で区別の初期値を決める(ここから records に置くまで await を挟まない)
      const { attribution } = initialAttribution({
        baseline: result.snapshot,
        seqBefore,
        seqAfter: this.deps.attribution.toolStartSeqOf(ownerId),
        signalBefore,
        signalAfter: this.deps.attribution.activityOf(ownerId)
      })
      // 始点を取り終えたときに実行 1 を足すかは、始点の取得を始めた依頼の trigger で決める(pending には持たせない)
      const recordSerial = this.nextRecordSerial++
      const record = createAgentChangesRecord(
        result.snapshot,
        recordSerial,
        protectionRefName(this.deps.protection.instanceId, recordSerial),
        attribution
      )
      if (trigger === 'send') this.appendRun(ownerId, record, { kind: 'baseline' })
      this.records.set(ownerId, record)
      this.recordOwners.set(record, ownerId)
      this.logAttribution(ownerId, '開始', null, record)
```
  （その後の保護の同期と `return this.recordingState(record)` は今のまま）
- `recordingState` の前に足す:
```ts
  // 開発版の区別のログ(パス・内容は出さない。L-017)
  private logAttribution(
    ownerId: number,
    event: AttributionLogEvent,
    phaseBefore: AgentToolPhase | null,
    record: AgentChangesRecord
  ): void {
    this.deps.attributionDevLog?.(attributionLogLine(ownerId, event, phaseBefore, record.attribution))
  }
```

`src/main/ipcHandlers.ts`:
- import に `import { collectAgentChangeEntriesBetween } from './agentChangesQuery'` を足す
- `new AgentBaselineRegistry({ ... })` の `executeUndo: ...` の後に足す（registry は runtime の後に作るため、`agentHooks.tracker` をそのまま渡せる）:
```ts
    collectBetween: collectAgentChangeEntriesBetween,
    // 区別の合図と通し番号は hooks の追跡から読む(生成の順は hooks の runtime → registry のまま)
    attribution: agentHooks.tracker,
    attributionDevLog: app.isPackaged ? null : (line) => console.log(line)
```

- [ ] **Step 4: 通す**

Run: `npx vitest run src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/agentChangesScope.test.ts src/main/__tests__/agentChangesScopedQuery.test.ts`
Expected: PASS
Run: `npm test`
Expected: PASS（時間切れで落ちたファイルは単体で流し直す）
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/main/agentChangesRecord.ts src/main/agentBaselineRegistry.ts src/main/ipcHandlers.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/ipcHandlers.test.ts && npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 5: 変異で確かめる**

1. `agentChangesRecordTempDirs` の `...attributionTempDirs(record.attribution)` を消し、「判定の区切り(始点と共有でないもの)と…も返す」が落ちることを確かめて戻す
2. `ipcHandlers.ts` の `attribution: agentHooks.tracker` を `attribution: { activityOf: () => ({ phase: 'paused', lost: null, unassignable: false }), toolStartSeqOf: () => 0 }` にし、「記録の registry に、追跡…を渡す」が落ちることを確かめて戻す

- [ ] **Step 6: コミット（利用者の指示があるときだけ）**

```bash
git add src/main/agentChangesRecord.ts src/main/agentBaselineRegistry.ts src/main/ipcHandlers.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/ipcHandlers.test.ts
git commit -m "feat: エージェントの変更の記録に、利用者の変更との区別の初期値を持たせる"
```

---

### Task 4b: registry の同期・待ち・打ち切りの印（`agentChangesAttributionSync`・`notifyAttributionSignal`・`syncAttribution`・`waitForAgentPhase`・`markPeriodUnassignable`）

> **気をつける知見:** L-002（区切り・差分の失敗を `lost` にする。待てなかった区間を割り当てない）・L-003・L-004・L-428（前の区切りは結果の後に、自分が作ったものだけ消す。消せなければ削除待ち）・L-037（`await` のたびに世代と記録を確かめる）・L-040（番が来た時点の段階で読む・手順 8 の段階で決める）・L-052（何もしない同期を回し続けない）・L-053（`notifyAttributionSignal` は投げない）・L-101・L-434（同期の Promise を共有する）・L-103・L-152（`hadUnassignedSince`）・L-167・L-178・L-185・L-435・L-440

このタスクの終わりでも、`ipcHandlers.ts` の runtime のつなぎ先は段階 A のまま何もしない（つなぐのは Task 5）。

**Files:**
- Create: `src/main/agentChangesAttributionSync.ts`
- Modify: `src/main/agentBaselineRegistry.ts`（`waitingSyncs`・`runningSyncs`・`notifyAttributionSignal`・`markPeriodUnassignable`・`syncAttribution`・`waitForAgentPhase`・`runAttributionSync`・`attributionContextOf`・`loseAfterError`・`logOutcome`・`removeAttributionDir`・`begin` の `syncNow`）
- Test: `src/main/__tests__/agentBaselineRegistry.attribution.test.ts`（足す）・`src/main/__tests__/agentChangesAttribution.integration.test.ts`（新規。実 git）

**Interfaces:**
- Consumes: Task 3 の `TrackingAttribution`・`AgentChangesCheckpoint`・`AgentChangesAttributionLostReason`、Task 4a の `record.attribution`・依存 `collectBetween`・`attribution`・`attributionDevLog`・`logAttribution`
- Produces:
```ts
// src/main/agentChangesAttributionSync.ts
export type AttributionSyncResult = 'synced' | 'skipped'
export type AttributionStepOutcome =
  | { kind: 'skipped' }
  | { kind: 'lost'; phaseBefore: AgentToolPhase }
  | { kind: 'synced'; phaseBefore: AgentToolPhase; requeue: boolean }
export interface AttributionSyncContext {
  record: AgentChangesRecord
  signal: () => AgentToolActivitySignal
  takeSnapshot: (baseIndexPath: string) => Promise<BaselineSnapshotResult>
  collectBetween: (start: BaselineSnapshot, end: BaselineSnapshot) => Promise<AgentChangeEntry[]>
  isStale: () => boolean
  discardSnapshot: (snapshot: BaselineSnapshot) => Promise<void>
  removeDir: (dir: string) => Promise<void>
  now: () => number
}
export async function markAttributionLost(
  record: AgentChangesRecord,
  reason: AgentChangesAttributionLostReason,
  deps: { now: () => number; removeDir: (dir: string) => Promise<void> }
): Promise<void>
export async function syncAttributionStep(ctx: AttributionSyncContext): Promise<AttributionStepOutcome>

// src/main/agentBaselineRegistry.ts(公開のメソッド)
notifyAttributionSignal(ownerId: number): void                         // 同期。投げない
markPeriodUnassignable(ownerId: number): void                          // 同期。列の外で印を立てる
syncAttribution(ownerId: number): Promise<AttributionSyncResult>        // reject しない
waitForAgentPhase(ownerId: number, signal: AbortSignal): Promise<void>  // async。reject しない
```

- [ ] **Step 1: registry の失敗するテストを書く（偽の git）**

`src/main/__tests__/agentBaselineRegistry.attribution.test.ts`:
- import を次にする（Task 4a の import に `AgentChangeEntry` を足す）:
```ts
import { describe, expect, it, vi } from 'vitest'
import type { AgentChangeEntry } from '@shared/types'
import { AgentBaselineRegistry } from '../agentBaselineRegistry'
import type { AgentBaselineRegistryDeps } from '../agentBaselineRegistry'
import type { BaselineSnapshotResult } from '../agentBaselineSnapshot'
import type { AgentChangesRecord } from '../agentChangesRecord'
import type { AgentToolActivitySignal } from '../agentToolActivity'
import {
  createFakeAttributionSource,
  makeBaselineSnapshot,
  makeFakeProtectionDeps
} from './helpers/agentBaselineFixtures'
import type { FakeAttributionSource } from './helpers/agentBaselineFixtures'
```
- `startRecord` の後に補助を足す:
```ts
const entriesOf = (...paths: string[]): AgentChangeEntry[] =>
  paths.map((path) => ({ path, status: 'M', isDirectory: false, notRecorded: false }))

/** 列の今の後ろまで進める(それまでに並んだ同期を走らせ終える) */
async function flush(h: Harness): Promise<void> {
  await h.registry.withRecord(1, FOLDER, async () => undefined)
}

/** 追跡の合図を変え、変わったときだけ(追跡の publish と同じく)notifyAttributionSignal を呼ぶ */
function change(h: Harness, next: Partial<AgentToolActivitySignal>): void {
  const before = h.source.signal
  h.source.set(next)
  const after = h.source.signal
  if (
    before.phase !== after.phase ||
    before.lost !== after.lost ||
    before.unassignable !== after.unassignable
  ) {
    h.registry.notifyAttributionSignal(1)
  }
}

/** PreToolUse(受け口と同じく、通し番号を進めて段階を通知してから待つ) */
function toolStarts(h: Harness, controller: AbortController = new AbortController()): Promise<void> {
  h.source.seq += 1
  change(h, { phase: 'agent' })
  return h.registry.waitForAgentPhase(1, controller.signal)
}

/** 受け口の 5 秒の打ち切り(signal を中止し、onToolStartTimedOut〈markPeriodUnassignable〉を呼ぶ) */
function timeOut(h: Harness, controller: AbortController): void {
  controller.abort()
  h.registry.markPeriodUnassignable(1)
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** 列を塞ぐ(戻す操作・一覧が先に並んでいる状態)。返す関数で列を開け、塞いでいたタスクの終わりを待つ */
function blockQueue(h: Harness): () => Promise<void> {
  const gate = deferred<void>()
  const blocked = h.registry.withRecord(1, FOLDER, () => gate.promise)
  return async () => {
    gate.resolve()
    await blocked
  }
}

/** 解決したかの印(結果は最後に元の Promise を await して受ける。L-178) */
function track(promise: Promise<unknown>): { done: () => boolean } {
  let done = false
  void promise.then(
    () => {
      done = true
    },
    () => {
      done = true
    }
  )
  return { done: () => done }
}

/** 今たまっている microtask・I/O を 1 回分進める(「まだ解決していない」の確認だけに使う) */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
```
- ファイルの末尾に足す:
```ts
describe('区別の同期(syncAttribution・notifyAttributionSignal)', () => {
  it('段階が同じで印が無ければ区切りを取らない(git を呼ばない)', async () => {
    const h = setup()
    await startRecord(h)
    h.registry.notifyAttributionSignal(1)
    await flush(h)
    expect(h.calls).toHaveLength(1)
    expect(h.collectBetween).not.toHaveBeenCalled()
  })

  it('idle → agent: 前の区切りを写しの元に区切りを取り、閉じた区間の差分を利用者の集合に入れて段階を agent にする(始点と共有の前の区切りは消さない)', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('c.txt'))
    change(h, { phase: 'agent' })
    const call = await snapshotCall(h, 1)
    expect(call.baseIndexPath).toBe('/tmp/cp-0/index')
    call.resolve(checkpointResult(1))
    await flush(h)
    expect(h.collectBetween).toHaveBeenCalledWith(
      record.baseline,
      expect.objectContaining({ tempDir: '/tmp/cp-1' })
    )
    expect(record.attribution).toMatchObject({
      kind: 'tracking',
      phase: 'agent',
      userPaths: new Set(['c.txt']),
      agentPaths: new Set(),
      periodUnassignable: false,
      checkpoint: { snapshot: { tempDir: '/tmp/cp-1' }, sharedWithBaseline: false }
    })
    expect(h.removeDir).not.toHaveBeenCalled()
    expect(h.devLog).toHaveBeenCalledWith(
      '[agent-attribution] owner=1 event=同期 phase=idle→agent user=1 agent=0 unassignable=なし reason=-'
    )
  })

  it('agent → idle: 差分をエージェントの集合に入れ、前の区切りは新しい区切りに置き換えた後に消す(L-003)', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { phase: 'agent' })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    const checkpointAtRemoval: string[] = []
    h.removeDir.mockImplementation(async () => {
      if (record.attribution.kind === 'tracking') {
        checkpointAtRemoval.push(record.attribution.checkpoint.snapshot.tempDir)
      }
    })
    h.collectBetween.mockResolvedValueOnce(entriesOf('b.txt'))
    change(h, { phase: 'idle' })
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(),
      agentPaths: new Set(['b.txt'])
    })
    expect(h.removeDir).toHaveBeenCalledExactlyOnceWith('/tmp/cp-1')
    expect(checkpointAtRemoval).toEqual(['/tmp/cp-2'])
  })

  it('paused の区間の差分はどちらにも入れず、区別を始めた後なら hadUnassignedSince を立てる', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('x.txt'))
    change(h, { phase: 'paused' })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    h.collectBetween.mockResolvedValueOnce(entriesOf('y.txt'))
    await flush(h)
    change(h, { phase: 'idle' })
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(['x.txt']),
      agentPaths: new Set(),
      hadUnassignedSince: true
    })
  })

  it('新しい段階は区切りを取り終えた時点(手順 8)の段階で決める(区切りの最中に終わったツールを反映する)', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { phase: 'agent' })
    const call = await snapshotCall(h, 1)
    change(h, { phase: 'idle' })
    call.resolve(checkpointResult(1))
    await flush(h)
    await flush(h)
    expect(record.attribution).toMatchObject({ phase: 'idle' })
    // 後ろに並んだ同期は段階が同じで印も無いため、区切りを取らない
    expect(h.calls).toHaveLength(2)
  })

  it('前の区切りを消せなければ削除待ちに入れ、clear で消す(L-428)', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { phase: 'agent' })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    h.removeDir.mockRejectedValueOnce(new Error('EBUSY'))
    change(h, { phase: 'idle' })
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    expect(record.attribution).toMatchObject({ staleCheckpointDirs: ['/tmp/cp-1'] })
    h.removeDir.mockClear()
    await h.registry.clear(1)
    expect(h.removeDir.mock.calls.map(([dir]) => dir)).toEqual(
      expect.arrayContaining(['/tmp/cp-0', '/tmp/cp-2', '/tmp/cp-1'])
    )
  })

  it('close で判定の区切りと削除待ちを同期で消す', async () => {
    const h = setup()
    await startRecord(h)
    change(h, { phase: 'agent' })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    h.removeDir.mockRejectedValueOnce(new Error('EBUSY'))
    change(h, { phase: 'idle' })
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    h.registry.close()
    expect(h.removeDirSync.mock.calls.map(([dir]) => dir)).toEqual(
      expect.arrayContaining(['/tmp/cp-0', '/tmp/cp-2', '/tmp/cp-1'])
    )
  })

  it('区切りを取れなければ(unavailable)区別をやめ(lost・checkpoint-failed)、同期は reject しない', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.source.set({ phase: 'agent' })
    const synced = h.registry.syncAttribution(1)
    ;(await snapshotCall(h, 1)).resolve({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'timeout' }
    })
    await expect(synced).resolves.toBe('skipped')
    expect(record.attribution).toMatchObject({
      kind: 'lost',
      reason: 'checkpoint-failed',
      lostAt: 500
    })
    expect(h.devLog).toHaveBeenCalledWith(
      '[agent-attribution] owner=1 event=lost phase=idle→- user=0 agent=0 unassignable=なし reason=checkpoint-failed'
    )
  })

  it('差分を求められなければ、取れた区切りを消して区別をやめる(空の差分として扱わない。L-002)', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.collectBetween.mockRejectedValueOnce(new Error('fatal: bad object'))
    h.source.set({ phase: 'agent' })
    const synced = h.registry.syncAttribution(1)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await expect(synced).resolves.toBe('skipped')
    expect(h.removeDir).toHaveBeenCalledWith('/tmp/cp-1')
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'checkpoint-failed' })
  })

  it('区別をやめる合図があれば区切りを取らずに lost にし、その後の合図では何もしない', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { lost: 'hooks-not-confirmed' })
    await flush(h)
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'hooks-not-confirmed' })
    change(h, { lost: null, phase: 'agent' })
    await flush(h)
    expect(h.calls).toHaveLength(1)
  })

  it('区別をやめるとき、始点と共有でない判定の区切りを消し、消せなければ削除待ちに入れる', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { phase: 'agent' })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    h.removeDir.mockRejectedValueOnce(new Error('EBUSY'))
    change(h, { lost: 'hooks-not-confirmed' })
    await flush(h)
    expect(record.attribution).toMatchObject({
      kind: 'lost',
      staleCheckpointDirs: ['/tmp/cp-1']
    })
    h.removeDir.mockClear()
    await h.registry.clear(1)
    expect(h.removeDir).toHaveBeenCalledWith('/tmp/cp-1')
  })

  it('区切りの途中で記録を捨てたら(clear)、取れた区切りを消して記録を変えない', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { phase: 'agent' })
    const call = await snapshotCall(h, 1)
    const cleared = h.registry.clear(1)
    expect(call.isCanceled()).toBe(true)
    call.resolve(checkpointResult(1))
    await cleared
    expect(h.removeDir).toHaveBeenCalledWith('/tmp/cp-1')
    expect(record.attribution).toMatchObject({
      kind: 'tracking',
      phase: 'idle',
      checkpoint: { sharedWithBaseline: true }
    })
  })

  it('区切りを取っている最中に close すると、取れた区切りを同期で消して記録を変えない(L-435)', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.source.set({ phase: 'agent' })
    const synced = h.registry.syncAttribution(1)
    const call = await snapshotCall(h, 1)
    h.registry.close()
    call.resolve(checkpointResult(1))
    await expect(synced).resolves.toBe('skipped')
    expect(h.removeDirSync).toHaveBeenCalledWith('/tmp/cp-1')
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      checkpoint: { sharedWithBaseline: true }
    })
  })

  it('差分を求めている最中(手順 7)に close すると、取れた区切りを同期で消して記録を変えない(世代を進めない close を見落とさない)', async () => {
    const h = setup()
    const record = await startRecord(h)
    const gate = deferred<AgentChangeEntry[]>()
    h.collectBetween.mockImplementationOnce(() => gate.promise)
    h.source.set({ phase: 'agent' })
    const synced = h.registry.syncAttribution(1)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await vi.waitFor(() => expect(h.collectBetween).toHaveBeenCalledOnce())
    h.registry.close()
    gate.resolve(entriesOf('c.txt'))
    await expect(synced).resolves.toBe('skipped')
    expect(h.removeDirSync).toHaveBeenCalledWith('/tmp/cp-1')
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(),
      checkpoint: { sharedWithBaseline: true }
    })
  })

  it('close の後の notifyAttributionSignal・markPeriodUnassignable は何もしない(投げない)', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.registry.close()
    h.source.set({ phase: 'agent', unassignable: true })
    expect(() => h.registry.notifyAttributionSignal(1)).not.toThrow()
    expect(() => h.registry.markPeriodUnassignable(1)).not.toThrow()
    await settle()
    expect(record.attribution).toMatchObject({ periodUnassignable: false, timedOutPending: false })
    expect(h.calls).toHaveLength(1)
  })

  it('同期の依頼は、待っている同期があれば同じ Promise を返し(L-101・L-434)、走り始めた後の依頼は新しく並べる', async () => {
    const h = setup()
    await startRecord(h)
    const open = blockQueue(h)
    h.source.set({ phase: 'agent' })
    const first = h.registry.syncAttribution(1)
    expect(h.registry.syncAttribution(1)).toBe(first)
    await open()
    const call = await snapshotCall(h, 1)
    const third = h.registry.syncAttribution(1)
    expect(third).not.toBe(first)
    call.resolve(checkpointResult(1))
    await expect(first).resolves.toBe('synced')
    await expect(third).resolves.toBe('skipped')
  })

  it('idle の間の利用者の編集 → 打ち切りで印 → 同期が閉じた区間を割り当てず、手順 8 が agent なら、新しい区間に印は無いが hadUnassignedSince が立つ', async () => {
    const h = setup()
    const record = await startRecord(h)
    const open = blockQueue(h)
    const controller = new AbortController()
    const waited = toolStarts(h, controller)
    timeOut(h, controller)
    await waited
    h.collectBetween.mockResolvedValueOnce(entriesOf('user.txt'))
    await open()
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'agent',
      userPaths: new Set(),
      agentPaths: new Set(),
      periodUnassignable: false,
      timedOutPending: false,
      hadUnassignedSince: true
    })
    expect(h.calls).toHaveLength(2)
  })
})

describe('ツールの開始の待ち(waitForAgentPhase)', () => {
  it('記録の段階が agent で同期が無ければ、区切りを取らずにすぐ解決する', async () => {
    const h = setup()
    await startRecord(h)
    const first = toolStarts(h)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await first
    h.source.seq += 1
    await h.registry.waitForAgentPhase(1, new AbortController().signal)
    expect(h.calls).toHaveLength(2)
  })

  it('1 つ目の区切りの最中に 2 つ目の PreToolUse が届いても、2 つ目も区切りの完了まで解決しない', async () => {
    const h = setup()
    const record = await startRecord(h)
    const first = toolStarts(h)
    const call = await snapshotCall(h, 1)
    // 2 つ目のツール(段階は agent のままなので、追跡は通知しない)
    h.source.seq += 1
    const second = h.registry.waitForAgentPhase(1, new AbortController().signal)
    const firstState = track(first)
    const secondState = track(second)
    await settle()
    expect(firstState.done()).toBe(false)
    expect(secondState.done()).toBe(false)
    call.resolve(checkpointResult(1))
    await first
    await second
    expect(record.attribution).toMatchObject({ phase: 'agent' })
    expect(h.calls).toHaveLength(2)
  })

  it('古い記録のときに並んだ同期が待っている間に記録を作り直しても(clear → begin)、新しい記録の待ちは新しい記録の区切りを取ってから解決する', async () => {
    const h = setup()
    await startRecord(h)
    const open = blockQueue(h)
    h.source.set({ phase: 'agent' })
    const old = h.registry.syncAttribution(1)
    const cleared = h.registry.clear(1)
    const begun = h.registry.begin(1, FOLDER, 'manual')
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(10))
    await begun
    const waited = h.registry.waitForAgentPhase(1, new AbortController().signal)
    const waitedState = track(waited)
    await open()
    // 古い記録のときに並んだ同期も、走り始めた時点の記録(新しい記録)で区切りを取る
    const call = await snapshotCall(h, 2)
    expect(call.baseIndexPath).toBe('/tmp/cp-10/index')
    await settle()
    expect(waitedState.done()).toBe(false)
    call.resolve(checkpointResult(11))
    await waited
    await cleared
    await expect(old).resolves.toBe('synced')
  })

  it.each<['idle' | 'paused']>([['idle'], ['paused']])(
    '待ちの間にセッションが外れて段階が %s になると、タイマーを進めなくても待ちが解決する(何もしない同期を回し続けない。L-052)',
    async (next) => {
      const h = setup()
      await startRecord(h)
      const waited = toolStarts(h)
      const call = await snapshotCall(h, 1)
      change(h, { phase: next })
      call.resolve(checkpointResult(1))
      await expect(waited).resolves.toBeUndefined()
    }
  )

  it('待った同期が区切りを取らずに終わった(取り消し)ら、条件を満たさなくてもそれ以上待たない', async () => {
    const h = setup()
    const record = await startRecord(h)
    const waited = toolStarts(h)
    ;(await snapshotCall(h, 1)).resolve({ kind: 'canceled' })
    await expect(waited).resolves.toBeUndefined()
    await flush(h)
    expect(h.calls).toHaveLength(2)
    expect(record.attribution).toMatchObject({ phase: 'idle' })
  })

  it('signal の中止で待ちをやめて解決する(reject しない)', async () => {
    const h = setup()
    await startRecord(h)
    const open = blockQueue(h)
    const controller = new AbortController()
    const waited = toolStarts(h, controller)
    controller.abort()
    await expect(waited).resolves.toBeUndefined()
    await open()
  })

  it('同期の手順 8 の後(前の区切りを消している間)に PreToolUse が届くと、走っている同期が idle で終わっても解決せず、後ろの同期が agent にしてから解決する(ツールの書き込みは利用者の集合に入らない)', async () => {
    const h = setup()
    const record = await startRecord(h)
    const first = toolStarts(h)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await first
    const removal = deferred<void>()
    h.removeDir.mockImplementationOnce(() => removal.promise)
    h.collectBetween.mockResolvedValueOnce(entriesOf('a.txt'))
    change(h, { phase: 'idle' })
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await vi.waitFor(() => expect(h.removeDir).toHaveBeenCalledWith('/tmp/cp-1'))
    const second = toolStarts(h)
    const secondState = track(second)
    removal.resolve()
    const call = await snapshotCall(h, 3)
    await settle()
    expect(secondState.done()).toBe(false)
    call.resolve(checkpointResult(3))
    await second
    expect(record.attribution).toMatchObject({ phase: 'agent' })
    h.collectBetween.mockResolvedValueOnce(entriesOf('b.txt'))
    change(h, { phase: 'idle' })
    ;(await snapshotCall(h, 4)).resolve(checkpointResult(4))
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(),
      agentPaths: new Set(['a.txt', 'b.txt'])
    })
  })

  it('打ち切り → ツールが終わる(猶予が過ぎる)→ 同期: idle → agent → idle が idle にまとまっても、ツールの書き込みは利用者の集合に入らない', async () => {
    const h = setup()
    const record = await startRecord(h)
    const open = blockQueue(h)
    const controller = new AbortController()
    const waited = toolStarts(h, controller)
    timeOut(h, controller)
    await waited
    // ツールが書いて終わり、猶予が過ぎた
    change(h, { phase: 'idle' })
    h.collectBetween.mockResolvedValueOnce(entriesOf('tool.txt'))
    await open()
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    // 打ち切りの後の段階が idle なので、同期がもう 1 回並ぶ
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(),
      agentPaths: new Set(),
      periodUnassignable: false,
      timedOutPending: false,
      hadUnassignedSince: true
    })
    expect(h.calls).toHaveLength(3)
  })

  it('区切りの途中で打ち切りがあり、終わりの段階が idle なら、次の区間にも印を残して同期をもう 1 回だけ並べる', async () => {
    const h = setup()
    const record = await startRecord(h)
    const first = toolStarts(h)
    const call = await snapshotCall(h, 1)
    const controller = new AbortController()
    h.source.seq += 1
    const second = h.registry.waitForAgentPhase(1, controller.signal)
    timeOut(h, controller)
    await second
    change(h, { phase: 'idle' })
    h.collectBetween.mockResolvedValueOnce(entriesOf('x.txt'))
    call.resolve(checkpointResult(1))
    await first
    const again = await snapshotCall(h, 2)
    expect(again.baseIndexPath).toBe('/tmp/cp-1/index')
    again.resolve(checkpointResult(2))
    await flush(h)
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      periodUnassignable: false,
      userPaths: new Set()
    })
    expect(h.calls).toHaveLength(3)
  })

  it('差分を求めている最中(手順 7)に打ち切りがあり、ツールが終わって手順 8 が idle なら、次の区間に印を残して同期を 1 回だけ並べる', async () => {
    const h = setup()
    const record = await startRecord(h)
    const gate = deferred<AgentChangeEntry[]>()
    h.collectBetween.mockImplementationOnce(() => gate.promise)
    h.collectBetween.mockResolvedValueOnce(entriesOf('tool.txt'))
    const first = toolStarts(h)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await vi.waitFor(() => expect(h.collectBetween).toHaveBeenCalledOnce())
    const controller = new AbortController()
    h.source.seq += 1
    const second = h.registry.waitForAgentPhase(1, controller.signal)
    timeOut(h, controller)
    await second
    change(h, { phase: 'idle' })
    gate.resolve(entriesOf('user.txt'))
    await first
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(['user.txt']),
      agentPaths: new Set(),
      periodUnassignable: false
    })
    expect(h.calls).toHaveLength(3)
  })

  it('同期が始まる前の打ち切り(同期は列で待っている)の後、区切りの最中にツールが書いて終わり手順 8 が idle なら、次の区間に印を残して同期を 1 回だけ並べ、その次の同期で印が下りる', async () => {
    const h = setup()
    const record = await startRecord(h)
    const open = blockQueue(h)
    const controller = new AbortController()
    const waited = toolStarts(h, controller)
    timeOut(h, controller)
    await waited
    await open()
    const call = await snapshotCall(h, 1)
    // 区切りの最中にツールが書いて終わり、猶予が過ぎた
    change(h, { phase: 'idle' })
    h.collectBetween.mockResolvedValueOnce(entriesOf('before.txt'))
    h.collectBetween.mockResolvedValueOnce(entriesOf('tool.txt'))
    call.resolve(checkpointResult(1))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(),
      agentPaths: new Set(),
      periodUnassignable: false,
      timedOutPending: false
    })
    expect(h.calls).toHaveLength(3)
  })

  it('合図の unassignable が立ち続けても区切りを取り続けず、その間の PreToolUse は打ち切られずに解決する。合図が下りた後の同期から割り当てる', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('held-1.txt'))
    change(h, { unassignable: true })
    // 列の外で同期的に印が立つ
    expect(record.attribution).toMatchObject({ periodUnassignable: true })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    await flush(h)
    expect(h.calls).toHaveLength(2)
    h.collectBetween.mockResolvedValueOnce(entriesOf('held-2.txt'))
    const waited = toolStarts(h)
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await expect(waited).resolves.toBeUndefined()
    await flush(h)
    await flush(h)
    expect(h.calls).toHaveLength(3)
    h.collectBetween.mockResolvedValueOnce(entriesOf('held-3.txt'))
    change(h, { unassignable: false })
    ;(await snapshotCall(h, 3)).resolve(checkpointResult(3))
    await flush(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('agent.txt'))
    change(h, { phase: 'idle' })
    ;(await snapshotCall(h, 4)).resolve(checkpointResult(4))
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(),
      agentPaths: new Set(['agent.txt']),
      periodUnassignable: false
    })
  })
})

describe('始点の後の同期(begin の syncNow)', () => {
  it('始点を取っている間にツールが始まったら(通し番号が変わった)、同期を 1 回並べてその区間を割り当てず、次の区間から区別する', async () => {
    const h = setup({ phase: 'idle' })
    const begun = h.registry.begin(1, FOLDER, 'manual')
    const base = await snapshotCall(h, 0)
    h.source.seq += 1
    base.resolve(checkpointResult(0))
    await begun
    const call = await snapshotCall(h, 1)
    expect(call.baseIndexPath).toBe('/tmp/cp-0/index')
    h.collectBetween.mockResolvedValueOnce(entriesOf('q.txt'))
    call.resolve(checkpointResult(1))
    const record = await h.registry.withRecord(1, FOLDER, async (r) => r)
    expect(record?.attribution).toMatchObject({
      kind: 'tracking',
      phase: 'idle',
      periodUnassignable: false,
      userPaths: new Set(),
      trackingSince: 500,
      hadUnassignedSince: false
    })
  })

  it('agent(pending を含む)で始めると、最初の区間に印を立てて同期を 1 回並べる', async () => {
    const h = setup({ phase: 'agent' })
    const begun = h.registry.begin(1, FOLDER, 'manual')
    ;(await snapshotCall(h, 0)).resolve(checkpointResult(0))
    await begun
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    const record = await h.registry.withRecord(1, FOLDER, async (r) => r)
    expect(record?.attribution).toMatchObject({
      phase: 'agent',
      periodUnassignable: false,
      trackingSince: 500
    })
  })

  it('始点を取っている間に合図の unassignable が下りたら(保留が解けた)、同期を 1 回並べる', async () => {
    const h = setup({ phase: 'idle', unassignable: true })
    const begun = h.registry.begin(1, FOLDER, 'manual')
    const base = await snapshotCall(h, 0)
    h.source.set({ unassignable: false })
    base.resolve(checkpointResult(0))
    await begun
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    const record = await h.registry.withRecord(1, FOLDER, async (r) => r)
    expect(record?.attribution).toMatchObject({ periodUnassignable: false, trackingSince: 500 })
  })

  it('取り終えた時点で合図の unassignable が立っていれば、同期を並べない(合図が下りたときの同期に任せる)', async () => {
    const h = setup({ phase: 'idle', unassignable: true })
    await startRecord(h)
    await flush(h)
    expect(h.calls).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineRegistry.attribution.test.ts`
Expected: FAIL（`notifyAttributionSignal`・`syncAttribution`・`waitForAgentPhase`・`markPeriodUnassignable` が無い。Task 4a の「記録の区別の始め方」のテストは通る）

- [ ] **Step 3: 同期の手順を実装する（`agentChangesAttributionSync.ts`）**

同期の手順は registry の列の中で呼ぶ部品のため、テストは Step 1 のとおり registry を通して書いてある。`src/main/agentChangesAttributionSync.ts`:
```ts
import type { AgentChangeEntry, AgentChangesAttributionLostReason } from '@shared/types'
import type { BaselineSnapshot, BaselineSnapshotResult } from './agentBaselineSnapshot'
import type { AgentChangesCheckpoint, TrackingAttribution } from './agentChangesAttribution'
import type { AgentChangesRecord } from './agentChangesRecord'
import type { AgentToolActivitySignal, AgentToolPhase } from './agentToolActivity'

// 記録の区別の同期と吸収の手順(設計書「同期」「アプリの戻す操作・取り消しの吸収」「やめる」)。registry が所有者の列の中でだけ呼ぶ
// (列の外から呼ばない)。判定の区切り(takeBaselineSnapshot。写しの元は直前の判定の区切り)を取り、直前の区切りとの差分(tree どうし)を
// 閉じた区間の段階に割り当て、前の区切りを結果の後に消す(L-003・L-004)。区切り・差分の失敗は区別をやめる(lost。L-002)

/** registry の同期の結果。synced: 区切りを取った、skipped: それ以外(手順 1〜3 で終わった・取り消した・失敗して lost にした) */
export type AttributionSyncResult = 'synced' | 'skipped'

/** 1 回の手順の結果(ログ・並べ直しに使う) */
export type AttributionStepOutcome =
  | { kind: 'skipped' }
  | { kind: 'lost'; phaseBefore: AgentToolPhase }
  | { kind: 'synced'; phaseBefore: AgentToolPhase; requeue: boolean }

/** 手順が使う依存(registry が記録・所有者ごとに作る) */
export interface AttributionSyncContext {
  record: AgentChangesRecord
  /** 今の追跡の合図(呼ぶたびに読み直す。L-040) */
  signal: () => AgentToolActivitySignal
  /** 判定の区切りを取る(写しの元は直前の判定の区切りのインデックス。isCanceled は isStale と同じ) */
  takeSnapshot: (baseIndexPath: string) => Promise<BaselineSnapshotResult>
  collectBetween: (start: BaselineSnapshot, end: BaselineSnapshot) => Promise<AgentChangeEntry[]>
  /** registry の close・世代の変化・記録の置き換え(手順 11。L-037) */
  isStale: () => boolean
  /** 取れたが使わない区切りを消す(close の後は同期で消す。L-435) */
  discardSnapshot: (snapshot: BaselineSnapshot) => Promise<void>
  /** 前の判定の区切りを消す(失敗は投げる。呼び出し側が削除待ちに入れる) */
  removeDir: (dir: string) => Promise<void>
  now: () => number
}

const SKIPPED: AttributionStepOutcome = { kind: 'skipped' }

/**
 * 区別をやめる(設計書「やめる」)。集合と印は残し、判定の区切りは始点と共有でなければ消す(消せなければ削除待ち)。
 * 所有者の列の中でだけ呼ぶ。記録の区別を置き換えてから await する(途中で読まれても lost に見える)
 */
export async function markAttributionLost(
  record: AgentChangesRecord,
  reason: AgentChangesAttributionLostReason,
  { now, removeDir }: { now: () => number; removeDir: (dir: string) => Promise<void> }
): Promise<void> {
  const attribution = record.attribution
  if (attribution.kind !== 'tracking') return
  const { checkpoint, userPaths, agentPaths, trackingSince, hadUnassignedSince, staleCheckpointDirs } =
    attribution
  record.attribution = {
    kind: 'lost',
    reason,
    lostAt: now(),
    userPaths,
    agentPaths,
    trackingSince,
    hadUnassignedSince,
    staleCheckpointDirs
  }
  if (checkpoint.sharedWithBaseline) return
  // 本番の removeBaselineDir は失敗を握るため、次の catch は依存の差し替えに備えた守り(既存の removeDirs と同じ作り)
  try {
    await removeDir(checkpoint.snapshot.tempDir)
  } catch {
    staleCheckpointDirs.push(checkpoint.snapshot.tempDir)
  }
}

/** 判定の区切りを取る(手順 5)。取り消し・世代の変化・記録の置き換えは canceled(取れたものは消してある) */
async function takeCheckpoint(
  ctx: AttributionSyncContext,
  base: AgentChangesCheckpoint
): Promise<BaselineSnapshot | 'canceled' | 'unavailable'> {
  const result = await ctx.takeSnapshot(base.snapshot.indexPath)
  if (result.kind === 'canceled') return 'canceled'
  if (ctx.isStale()) {
    if (result.kind === 'recorded') await ctx.discardSnapshot(result.snapshot)
    return 'canceled'
  }
  return result.kind === 'recorded' ? result.snapshot : 'unavailable'
}

/** 差分のパス(手順 7)。失敗は null(呼び出し側が lost にする。空の集合として扱わない。L-002) */
async function collectPaths(
  ctx: AttributionSyncContext,
  start: BaselineSnapshot,
  end: BaselineSnapshot
): Promise<string[] | null> {
  try {
    return (await ctx.collectBetween(start, end)).map((entry) => entry.path)
  } catch {
    return null
  }
}

/** 閉じた区間の差分を割り当てる(手順 7)。印があれば割り当てず、区別を始めていれば hadUnassignedSince を立てる(L-152) */
function assignClosedPeriod(
  attribution: TrackingAttribution,
  paths: string[],
  phase: AgentToolPhase,
  unassignable: boolean
): void {
  if (unassignable) {
    if (attribution.trackingSince !== null) attribution.hadUnassignedSince = true
    return
  }
  if (phase === 'idle') for (const path of paths) attribution.userPaths.add(path)
  else if (phase === 'agent') for (const path of paths) attribution.agentPaths.add(path)
}

/** 新しい区間の始まり(手順 9 の後半)。割り当てる区間なら区別を始め、割り当てない区間なら hadUnassignedSince を立てる */
function openPeriod(attribution: TrackingAttribution, now: number): void {
  const assignable = !attribution.periodUnassignable && attribution.phase !== 'paused'
  if (assignable) {
    if (attribution.trackingSince === null) attribution.trackingSince = now
  } else if (attribution.trackingSince !== null) {
    attribution.hadUnassignedSince = true
  }
}

/**
 * 前の判定の区切りを消す(手順 10)。始点と共有なら消さない。消せなければ削除待ちに入れる(L-428)。
 * 本番の removeBaselineDir は失敗を握るため削除待ちに入る経路は本番では起きないが、依存の差し替えに備えた既存の作り
 * (registry の removeDirs の .catch)に合わせた守り
 */
async function removeCheckpoint(
  ctx: AttributionSyncContext,
  previous: AgentChangesCheckpoint,
  attribution: TrackingAttribution
): Promise<void> {
  if (previous.sharedWithBaseline) return
  try {
    await ctx.removeDir(previous.snapshot.tempDir)
  } catch {
    attribution.staleCheckpointDirs.push(previous.snapshot.tempDir)
  }
}

/**
 * 同期の 1 回(設計書「同期」の手順 2〜11。手順 1〈記録が無い・close〉は registry が見る)。段階は呼ばれた時点の追跡の値で読み、
 * 新しい段階は区切りを取り終えて差分を割り当てた時点(手順 8)の値で決める(L-040)
 */
export async function syncAttributionStep(
  ctx: AttributionSyncContext
): Promise<AttributionStepOutcome> {
  const { record } = ctx
  const attribution = record.attribution
  if (attribution.kind !== 'tracking') return SKIPPED
  const phaseBefore = attribution.phase
  // 2. 区別をやめる合図。無ければ、合図の unassignable で今の区間に印を立てる
  const signalAtStart = ctx.signal()
  if (signalAtStart.lost !== null) {
    await markAttributionLost(record, signalAtStart.lost, ctx)
    return { kind: 'lost', phaseBefore }
  }
  if (signalAtStart.unassignable) attribution.periodUnassignable = true
  // 3. 段階が同じで印も無ければ何もしない(git を呼ばない)
  if (signalAtStart.phase === attribution.phase && !attribution.periodUnassignable) return SKIPPED
  // 4. 印を控えて下ろす(この後の打ち切りは markPeriodUnassignable がまた立てる)
  const unassignableBefore = attribution.periodUnassignable
  const timeoutBefore = attribution.timedOutPending
  attribution.periodUnassignable = false
  attribution.timedOutPending = false
  // 5. 区切り S
  const previous = attribution.checkpoint
  const next = await takeCheckpoint(ctx, previous)
  if (next === 'canceled') return SKIPPED
  if (next === 'unavailable') {
    await markAttributionLost(record, 'checkpoint-failed', ctx)
    return { kind: 'lost', phaseBefore }
  }
  // 6. 区切りを取り終えるまでに立った印
  const timedOutDuringSnapshot = attribution.periodUnassignable
  // 7. 閉じた区間(前の区切り → S)の差分を割り当てる
  const paths = await collectPaths(ctx, previous.snapshot, next)
  if (ctx.isStale()) {
    await ctx.discardSnapshot(next)
    return SKIPPED
  }
  if (paths === null) {
    await ctx.discardSnapshot(next)
    await markAttributionLost(record, 'checkpoint-failed', ctx)
    return { kind: 'lost', phaseBefore }
  }
  assignClosedPeriod(attribution, paths, phaseBefore, unassignableBefore || timedOutDuringSnapshot)
  // 8. この時点のあるべき段階(区切りを取っている間に始まった・終わったツールを反映する)
  const signalNow = ctx.signal()
  // 9. 同期の開始の前と手順 8 までの打ち切りを片付け、新しい区間を始める(L-103・L-434)
  const timedOut = timeoutBefore || attribution.timedOutPending
  attribution.timedOutPending = false
  attribution.checkpoint = { snapshot: next, sharedWithBaseline: false }
  attribution.phase = signalNow.phase
  const requeue = timedOut && signalNow.phase !== 'agent'
  attribution.periodUnassignable = requeue || signalNow.unassignable || signalAtStart.unassignable
  openPeriod(attribution, ctx.now())
  // 10. 前の区切りを消す(結果の後。L-003)
  await removeCheckpoint(ctx, previous, attribution)
  return { kind: 'synced', phaseBefore, requeue }
}
```

- [ ] **Step 4: registry に同期・待ち・印を実装する**

`src/main/agentBaselineRegistry.ts`:
- import に足す:
```ts
import { markAttributionLost, syncAttributionStep } from './agentChangesAttributionSync'
import type {
  AttributionStepOutcome,
  AttributionSyncContext,
  AttributionSyncResult
} from './agentChangesAttributionSync'
```
  （判定の区切りの差分は依存 `collectBetween` を通して求め、`agentChangesQuery` を直接 import しない）
- クラスの前（`export class AgentBaselineRegistry` の前）に足す:
```ts
/** signal の中止で解決する(reject しない) */
function whenAborted(signal: AbortSignal): Promise<'aborted'> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve('aborted')
      return
    }
    signal.addEventListener('abort', () => resolve('aborted'), { once: true })
  })
}
```
- フィールドの `private closed = false` の前に足す:
```ts
  // 区別の同期(設計書「同期」)。待っている(まだ走り始めていない)同期と、並べた時点の記録(L-101・L-434)
  private readonly waitingSyncs = new Map<
    number,
    { record: AgentChangesRecord; promise: Promise<AttributionSyncResult> }
  >()
  // 走っている同期(waitForAgentPhase の「並んでいる・走っている同期が無い」の判定に使う)
  private readonly runningSyncs = new Map<number, Promise<AttributionSyncResult>>()
```
- `begin` の `const { attribution } = initialAttribution({` を `const { attribution, syncNow } = initialAttribution({` にし、`this.logAttribution(ownerId, '開始', null, record)` の後に足す:
```ts
      // 始点を取っている間にツールが動いた・合図が下りたなら、最初の区間を片付ける同期を 1 回並べる
      if (syncNow) {
        void this.syncAttribution(ownerId).catch((err: unknown) =>
          console.warn('[agent-attribution] 同期に失敗しました:', err)
        )
      }
```
- `getState` の後に足す:
```ts
  /**
   * 追跡の合図が変わったとき(設計書「registry へのつなぎ方」)。追跡の publish の中から同期的に呼ばれるため投げない(L-053)。
   * 記録が無い・区別していない・終了中なら何もしない。合図の unassignable が立っていれば列の外で同期的に今の区間に印を立て、
   * 同期を 1 回並べる(段階は同期の番が来た時点の追跡の値で読む。L-040)
   */
  notifyAttributionSignal(ownerId: number): void {
    try {
      const record = this.records.get(ownerId)
      if (this.closed || record === undefined || record.attribution.kind !== 'tracking') return
      if (this.deps.attribution.activityOf(ownerId).unassignable) {
        record.attribution.periodUnassignable = true
      }
      void this.syncAttribution(ownerId).catch((err: unknown) =>
        console.warn('[agent-attribution] 同期に失敗しました:', err)
      )
    } catch (err) {
      console.warn('[agent-attribution] 段階の通知の受け取りに失敗しました:', err)
    }
  }

  /**
   * PreToolUse の待ちの打ち切り(失敗を含む。設計書「PreToolUse の待ち」)。今の区間に「割り当てられない」の印を立てる
   * (列の外で同期的に)。記録が無い・区別していない・終了中なら何もしない
   */
  markPeriodUnassignable(ownerId: number): void {
    const record = this.records.get(ownerId)
    if (this.closed || record === undefined || record.attribution.kind !== 'tracking') return
    record.attribution.periodUnassignable = true
    record.attribution.timedOutPending = true
  }

  /**
   * 区別の同期を所有者の列に並べる(設計書「同期」)。同じ所有者の列で待っている(まだ走り始めていない)同期があり、それを並べた時点の
   * 記録が今の記録と同じなら、その Promise を返す(L-101・L-434)。比べる世代と記録はタスクが走り始めた時点で読む。reject しない
   */
  syncAttribution(ownerId: number): Promise<AttributionSyncResult> {
    const record = this.records.get(ownerId)
    if (this.closed || record === undefined || record.attribution.kind !== 'tracking') {
      return Promise.resolve('skipped')
    }
    const waiting = this.waitingSyncs.get(ownerId)
    // 記録の照合は守りの重ね: 同期は走り始めた時点で記録を読むため、照合を外しても今の振る舞いに差は出ない(落ちるテストも無い)。
    // 走り始める前に記録が置き換わった依頼を、新しい記録の依頼として数えないために残す
    if (waiting !== undefined && waiting.record === record) return waiting.promise
    const promise: Promise<AttributionSyncResult> = this.queue.enqueue(ownerId, async () => {
      if (this.waitingSyncs.get(ownerId)?.promise === promise) this.waitingSyncs.delete(ownerId)
      this.runningSyncs.set(ownerId, promise)
      try {
        return await this.runAttributionSync(ownerId)
      } finally {
        if (this.runningSyncs.get(ownerId) === promise) this.runningSyncs.delete(ownerId)
      }
    })
    this.waitingSyncs.set(ownerId, { record, promise })
    return promise
  }

  /**
   * PreToolUse の待ち(設計書「PreToolUse の待ち」。受け口の onToolStart につなぐ)。記録の段階が agent で、並んでいる・走っている同期が
   * 無くなるまで、そのとき並んでいる最新の同期を待つ。待った同期が区切りを取らずに終わった(skipped)ら、それ以上待たない(何もしない同期を
   * 回し続けて main のイベントループを止めない。L-052)。signal の中止で解決する(reject しない。5 秒の上限は受け口が数える)
   */
  async waitForAgentPhase(ownerId: number, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const record = this.records.get(ownerId)
      // 1. 記録が無い・区別していない・終了中
      if (this.closed || record === undefined || record.attribution.kind !== 'tracking') return
      // 2. あるべき段階が agent でない(待ちの最中にタブを閉じたなど、覆うべきツールが無くなった)
      if (this.deps.attribution.activityOf(ownerId).phase !== 'agent') return
      const waiting = this.waitingSyncs.get(ownerId)
      // 3. 記録の段階が agent で、並んでいる・走っている同期が無い
      if (
        record.attribution.phase === 'agent' &&
        waiting === undefined &&
        !this.runningSyncs.has(ownerId)
      )
        return
      // 4. 走っている同期より後に並んだもの(この記録の待っている同期)があればそれ、無ければ新しく並べる
      const target =
        waiting !== undefined && waiting.record === record
          ? waiting.promise
          : this.syncAttribution(ownerId)
      const result = await Promise.race([target, whenAborted(signal)])
      if (result !== 'synced') return
    }
  }
```
- `recordingState` の前（`logAttribution` の前）に足す:
```ts
  // 同期の 1 回(列の中)。記録・世代はこの時点で読む(並べた時点ではない。L-040)。失敗は lost にして reject しない
  private async runAttributionSync(ownerId: number): Promise<AttributionSyncResult> {
    const record = this.records.get(ownerId)
    if (this.closed || record === undefined || record.attribution.kind !== 'tracking') {
      return 'skipped'
    }
    const ctx = this.attributionContextOf(ownerId, record)
    let outcome: AttributionStepOutcome
    try {
      outcome = await syncAttributionStep(ctx)
    } catch (err) {
      console.warn('[agent-attribution] 同期に失敗しました:', err)
      outcome = await this.loseAfterError(ctx)
    }
    this.logOutcome(ownerId, '同期', outcome, record)
    // 打ち切られたツールが区切りの後も書いた可能性がある(打ち切り 1 回につき高々 1 回。設計書「同期」9)
    if (outcome.kind === 'synced' && outcome.requeue) {
      void this.syncAttribution(ownerId).catch((err: unknown) =>
        console.warn('[agent-attribution] 同期に失敗しました:', err)
      )
    }
    return outcome.kind === 'synced' ? 'synced' : 'skipped'
  }

  // 同期・吸収の依存。stale は registry の close・世代の変化・記録の置き換え(close は世代を進めないため記録も見る。設計書「同期」11)
  private attributionContextOf(ownerId: number, record: AgentChangesRecord): AttributionSyncContext {
    const generation = this.generationOf(ownerId)
    const isStale = (): boolean =>
      this.closed || this.generationOf(ownerId) !== generation || this.records.get(ownerId) !== record
    return {
      record,
      signal: () => this.deps.attribution.activityOf(ownerId),
      takeSnapshot: (baseIndexPath) =>
        this.deps.takeSnapshot(record.baseline.folderPath, {
          isCanceled: isStale,
          now: this.deps.now,
          baseIndexPath
        }),
      collectBetween: (start, end) => this.deps.collectBetween(start, end),
      isStale,
      discardSnapshot: (snapshot) => this.discardSnapshot(snapshot),
      removeDir: (dir) => this.removeAttributionDir(dir),
      now: this.deps.now
    }
  }

  // 予期しない例外の後は、記録が今の記録のままなら区別をやめる(失敗を「変化なし」にしない。L-002)
  private async loseAfterError(ctx: AttributionSyncContext): Promise<AttributionStepOutcome> {
    const attribution = ctx.record.attribution
    if (ctx.isStale() || attribution.kind !== 'tracking') return { kind: 'skipped' }
    const phaseBefore = attribution.phase
    await markAttributionLost(ctx.record, 'checkpoint-failed', ctx).catch(() => undefined)
    return { kind: 'lost', phaseBefore }
  }

  // 同期・吸収の結果のログ(何もしなかったときは出さない)
  private logOutcome(
    ownerId: number,
    event: '同期' | '吸収',
    outcome: AttributionStepOutcome,
    record: AgentChangesRecord
  ): void {
    if (outcome.kind === 'skipped') return
    this.logAttribution(ownerId, outcome.kind === 'lost' ? 'lost' : event, outcome.phaseBefore, record)
  }

  // 前の判定の区切りを消す(終了中は待てないので同期で消す)。失敗は投げる(呼び出し側が削除待ちに入れる)。
  // 本番の removeBaselineDir・removeBaselineDirSync は失敗を握るため、削除待ちは依存の差し替えに備えた守り(テストは失敗する偽物で通す)
  private async removeAttributionDir(dir: string): Promise<void> {
    if (this.closed) {
      this.deps.removeDirSync(dir)
      return
    }
    await this.deps.removeDir(dir)
  }
```
- `import type { AgentToolActivity, AgentToolPhase } from './agentToolActivity'` はそのまま使う

- [ ] **Step 5: 実 git の結合テストを書く**

`src/main/__tests__/agentChangesAttribution.integration.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AgentBaselineRegistry } from '../agentBaselineRegistry'
import {
  removeBaselineDir,
  removeBaselineDirSync,
  takeBaselineSnapshot
} from '../agentBaselineSnapshot'
import { collectAgentChangeEntriesBetween } from '../agentChangesQuery'
import type { AgentChangesRecord } from '../agentChangesRecord'
import type { AgentToolActivitySignal } from '../agentToolActivity'
import { commitAll, runGit } from './helpers/realGitRepo'
import {
  createAgentBaselineRepo,
  createFakeAttributionSource,
  disposeAgentBaselineRepo,
  makeFakeProtectionDeps,
  userRepoState
} from './helpers/agentBaselineFixtures'
import type { AgentBaselineRepo, FakeAttributionSource } from './helpers/agentBaselineFixtures'

// 記録の区別を実 git(takeBaselineSnapshot・collectAgentChangeEntriesBetween)で通す(設計書「テスト方針」段階 B の実 git の結合)。
// 追跡は偽物(合図を書き換えて notifyAttributionSignal を呼ぶ)。claude は起動しない

describe('記録の利用者の変更との区別(実 git)', () => {
  let dirs: AgentBaselineRepo
  let source: FakeAttributionSource
  let registry: AgentBaselineRegistry

  beforeEach(() => {
    dirs = createAgentBaselineRepo('agent-attribution-int-')
    writeFileSync(join(dirs.repo, 'a.txt'), 'a\n')
    writeFileSync(join(dirs.repo, 'b.txt'), 'b\n')
    commitAll(dirs.repo, 'init')
    source = createFakeAttributionSource({ phase: 'idle' })
    registry = new AgentBaselineRegistry({
      takeSnapshot: (folderPath, options) =>
        takeBaselineSnapshot(folderPath, { ...options, tempRoot: dirs.tempRoot }),
      collectBetween: (start, end) => collectAgentChangeEntriesBetween(start, end),
      removeDir: removeBaselineDir,
      removeDirSync: removeBaselineDirSync,
      now: Date.now,
      protection: makeFakeProtectionDeps(),
      executeUndo: async () => {
        throw new Error('このファイルのテストは取り消しを使わない')
      },
      attribution: source,
      attributionDevLog: null
    })
  })

  afterEach(() => {
    registry.close()
    disposeAgentBaselineRepo(dirs)
  })

  const change = (next: Partial<AgentToolActivitySignal>): void => {
    source.set(next)
    registry.notifyAttributionSignal(1)
  }
  /** 並んでいる同期を走らせ終えてから記録を受ける */
  const recordNow = async (): Promise<AgentChangesRecord> => {
    const record = await registry.withRecord(1, dirs.repo, async (r) => r)
    if (record === null) throw new Error('記録が無い')
    return record
  }
  /** 受け口と同じく、段階を agent にしてから区切りを待つ */
  const toolStarts = async (): Promise<void> => {
    source.seq += 1
    change({ phase: 'agent' })
    await registry.waitForAgentPhase(1, new AbortController().signal)
  }

  it('idle の間の利用者の変更は利用者の集合に、agent の間のエージェントの変更はエージェントの集合に入る(パスは git の表記)', async () => {
    await registry.begin(1, dirs.repo, 'manual')
    writeFileSync(join(dirs.repo, 'a.txt'), 'user\n')
    await toolStarts()
    writeFileSync(join(dirs.repo, 'b.txt'), 'agent\n')
    mkdirSync(join(dirs.repo, 'new'))
    writeFileSync(join(dirs.repo, 'new', 'c.txt'), 'c\n')
    change({ phase: 'idle' })
    const record = await recordNow()
    expect(record.attribution).toMatchObject({
      kind: 'tracking',
      phase: 'idle',
      userPaths: new Set(['a.txt']),
      agentPaths: new Set(['b.txt', 'new/c.txt'])
    })
  })

  it('判定の区切りの object が gc で消えたら、次の同期で区別をやめる(lost・checkpoint-failed。それまでの印は残る)', async () => {
    await registry.begin(1, dirs.repo, 'manual')
    writeFileSync(join(dirs.repo, 'a.txt'), 'user\n')
    await toolStarts()
    writeFileSync(join(dirs.repo, 'a.txt'), 'agent\n')
    // 判定の区切りは保護の ref で守らない(設計書「判定の区切りの持ち方」)
    runGit(dirs.repo, 'gc', '-q', '--prune=now')
    change({ phase: 'idle' })
    const record = await recordNow()
    expect(record.attribution).toMatchObject({
      kind: 'lost',
      reason: 'checkpoint-failed',
      userPaths: new Set(['a.txt'])
    })
  })

  it('判定の区切りを取っても、利用者の .git/index・HEAD・refs・stash は変わらない', async () => {
    const before = userRepoState(dirs.repo)
    await registry.begin(1, dirs.repo, 'manual')
    writeFileSync(join(dirs.repo, 'a.txt'), 'user\n')
    await toolStarts()
    writeFileSync(join(dirs.repo, 'b.txt'), 'agent\n')
    change({ phase: 'idle' })
    await recordNow()
    expect(userRepoState(dirs.repo)).toEqual(before)
  })
})
```

- [ ] **Step 6: 通す**

Run: `npx vitest run src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentChangesAttribution.integration.test.ts src/main/__tests__/agentBaselineRegistry.test.ts`
Expected: PASS
Run: `npm test`
Expected: PASS（時間切れで落ちたファイルは単体で流し直す。実 git の結合は負荷で遅くなりやすい）
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/main/agentChangesAttributionSync.ts src/main/agentBaselineRegistry.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentChangesAttribution.integration.test.ts && npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 7: 変異で確かめる**

`npx vitest run src/main/__tests__/agentBaselineRegistry.attribution.test.ts` を、次を 1 つずつ入れて走らせ、括弧のテストが落ちることを確かめてから元に戻す:
1. `syncAttributionStep` の `assignClosedPeriod(attribution, paths, phaseBefore, unassignableBefore || timedOutDuringSnapshot)` の第 4 引数を `false` にする（「idle の間の利用者の編集 → 打ち切りで印 → …hadUnassignedSince が立つ」）
2. 手順 9 の `const timedOut = timeoutBefore || attribution.timedOutPending` を `const timedOut = timeoutBefore || timedOutDuringSnapshot` にする（「差分を求めている最中(手順 7)に打ち切りがあり…」）
3. 同じ行を `const timedOut = attribution.periodUnassignable` にする（「同期が始まる前の打ち切り…その次の同期で印が下りる」）
4. `const requeue = timedOut && signalNow.phase !== 'agent'` を、手順 9 で求めた `periodUnassignable` を並べ直しの条件にする形（`attribution.periodUnassignable = (timedOut && signalNow.phase !== 'agent') || signalNow.unassignable || signalAtStart.unassignable` とし、`requeue` を `attribution.periodUnassignable` にする）に変える（「合図の unassignable が立ち続けても区切りを取り続けず…」が落ちる。同期が自分を並べ直して区切りを取り続け、偽の区切りが解決されないまま列が進まず、テストの打ち切り〈5 秒〉で落ちる）
5. `waitForAgentPhase` の手順 4 を「走っている同期があればそれを待ち、待った後は条件を確かめ直さずに解決する」形（`const target = this.runningSyncs.get(ownerId) ?? (waiting !== undefined && waiting.record === record ? waiting.promise : this.syncAttribution(ownerId))` とし、`await Promise.race(...)` の後を `return` にする）に変える（「同期の手順 8 の後…後ろの同期が agent にしてから解決する」が、走っている同期の終わりで解決して落ちる）
6. `waitForAgentPhase` の手順 2 の行を消し、`if (result !== 'synced') return` を消す（「待ちの間にセッションが外れて…」が終わらなくなる。何もしない同期が microtask の中で回り続け、イベントループが進まないため、vitest のテストの打ち切りも効かないことがある。`npx vitest run src/main/__tests__/agentBaselineRegistry.attribution.test.ts -t 'セッションが外れて'` で走らせ、30 秒たっても終わらなければ Ctrl+C で止めて「落ちた」とみなし、変異を戻す）
7. `syncAttributionStep` の手順 7 の `if (ctx.isStale()) { ... }` を消す（「差分を求めている最中(手順 7)に close すると…」）
8. 同期の記録と世代を、並べた時点で読む形にする（`syncAttribution` の中で `const ctx = this.attributionContextOf(ownerId, record)` を作ってタスクに渡し、`runAttributionSync` はそれを使う）（「古い記録のときに並んだ同期が…」が、区切りの写しの元が古い記録の区切り `/tmp/cp-0/index` になって落ちる）。なお、合流の記録の照合（`waiting.record === record`）だけを外しても、同期が走り始めた時点で記録を読むため、このテストは落ちない（2 つの守りの片方が残る）。照合は守りの重ねで振る舞いに差は出ないが、走り始める前に記録が置き換わった依頼を新しい記録の依頼として数えないために残す（その旨は `syncAttribution` の照合の行のコメントに書いてある）

- [ ] **Step 8: コミット（利用者の指示があるときだけ）**

```bash
git add src/main/agentChangesAttributionSync.ts src/main/agentBaselineRegistry.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentChangesAttribution.integration.test.ts
git commit -m "feat: 判定の区切りの差分で、記録の中で利用者の変更とエージェントの変更を区別する"
```

---

### Task 5: 吸収とつなぎ込み（`withAttributionAbsorbed`・戻す 3 つと取り消しの吸収・`ipcHandlers` の 3 つのつなぎ先）

> **気をつける知見:** L-002（吸収の区切りの失敗を `lost` にし、戻す操作は止めない）・L-053・L-060（handler の `Pick` に `withAttributionAbsorbed`・runtime のつなぎ先を registry のメソッドにし、組み立てを確かめる）・L-152（吸収の前の区間を印のために割り当てなかったときの `hadUnassignedSince`）・L-435（S2 の最中の `close`）・L-440

**Files:**
- Modify: `src/main/agentChangesAttributionSync.ts`（`absorbBeforeTask`・`absorbAfterTask`）
- Modify: `src/main/agentBaselineRegistry.ts`（`withAttributionAbsorbed`・`runAbsorbStep`・`undoLastRevert`）
- Modify: `src/main/handlers/agentChangesHandlers.ts`（依存の `Pick` に `withAttributionAbsorbed`・戻す 3 つを包む）
- Modify: `src/main/ipcHandlers.ts`（runtime の 3 つのつなぎ先・説明）
- Modify: `src/main/agentHooksRuntime.ts`・`src/main/agentHookReceiver.ts`・`src/main/agentToolActivity.ts`（「段階 A は何もしない」の説明だけ）
- Test: `src/main/__tests__/agentBaselineRegistry.attribution.test.ts`（足す）・`src/main/__tests__/handlers/agentChangesHandlers.test.ts`・`src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`・`src/main/__tests__/ipcHandlers.test.ts`

**Interfaces:**
- Consumes: Task 4b の `AttributionSyncContext`・`AttributionStepOutcome`・`markAttributionLost`・registry の `attributionContextOf`・`loseAfterError`・`logOutcome`・`notifyAttributionSignal`・`waitForAgentPhase`・`markPeriodUnassignable`
- Produces:
```ts
// src/main/agentChangesAttributionSync.ts
/** 吸収の (1): 区切り S1 を取り、前の区切りからの差分を今の段階に割り当てる(印は下ろさない) */
export async function absorbBeforeTask(ctx: AttributionSyncContext): Promise<AttributionStepOutcome>
/** 吸収の (3): 区切り S2 を取り直して置き換え、その差分はどちらの集合にも入れない */
export async function absorbAfterTask(ctx: AttributionSyncContext): Promise<AttributionStepOutcome>

// src/main/agentBaselineRegistry.ts
/** 列の中で呼ぶ(自分では列に並ばない)。task が投げたら S2 を取ってから同じ例外を投げ直す */
withAttributionAbsorbed<T>(
  ownerId: number,
  record: AgentChangesRecord,
  task: () => Promise<T>,
  changed: (result: T) => boolean
): Promise<T>

// src/main/handlers/agentChangesHandlers.ts
registry: Pick<AgentBaselineRegistry, 'begin' | 'getState' | 'withRecord' | 'clear' | 'commitRevertUndo' | 'undoLastRevert' | 'withAttributionAbsorbed'>
```

- [ ] **Step 1: 吸収の失敗するテストを書く（偽の git）**

`src/main/__tests__/agentBaselineRegistry.attribution.test.ts`:
- import に足す:
```ts
import type { AgentChangesUndoCapture } from '../agentChangesUndoModel'
```
- ファイルの末尾に足す:
```ts
describe('戻す操作・取り消しの吸収(withAttributionAbsorbed)', () => {
  /** 列の中で吸収を行う(handler と同じ)。task の結果の applied で作業ツリーを変えたかを決める */
  function absorb(
    h: Harness,
    task: () => Promise<{ applied: number }>
  ): Promise<{ applied: number } | null> {
    return h.registry.withRecord(1, FOLDER, (record) =>
      h.registry.withAttributionAbsorbed(1, record, task, (result) => result.applied > 0)
    )
  }

  it('作業ツリーを変えたら S1・S2 を取り、S1 までの差分は今の段階に割り当て、S1 から S2 の差分はどちらにも入れない(段階は変えない)', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('u.txt'))
    const task = vi.fn(async () => ({ applied: 1 }))
    const absorbed = absorb(h, task)
    const s1 = await snapshotCall(h, 1)
    expect(s1.baseIndexPath).toBe('/tmp/cp-0/index')
    s1.resolve(checkpointResult(1))
    const s2 = await snapshotCall(h, 2)
    expect(task).toHaveBeenCalledOnce()
    expect(s2.baseIndexPath).toBe('/tmp/cp-1/index')
    s2.resolve(checkpointResult(2))
    await expect(absorbed).resolves.toEqual({ applied: 1 })
    expect(h.collectBetween).toHaveBeenCalledOnce()
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(['u.txt']),
      agentPaths: new Set(),
      checkpoint: { snapshot: { tempDir: '/tmp/cp-2' }, sharedWithBaseline: false }
    })
    expect(h.removeDir).toHaveBeenCalledExactlyOnceWith('/tmp/cp-1')
    expect(h.devLog).toHaveBeenCalledWith(
      '[agent-attribution] owner=1 event=吸収 phase=idle→idle user=1 agent=0 unassignable=なし reason=-'
    )
  })

  it('作業ツリーを変えなかったら(changed が偽)S2 を取らない', async () => {
    const h = setup()
    const record = await startRecord(h)
    const absorbed = absorb(h, async () => ({ applied: 0 }))
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await expect(absorbed).resolves.toEqual({ applied: 0 })
    await flush(h)
    expect(h.calls).toHaveLength(2)
    expect(record.attribution).toMatchObject({ checkpoint: { snapshot: { tempDir: '/tmp/cp-1' } } })
  })

  it('task が投げたら(1 件書き換えてから失敗した)S2 を取ってから同じ例外を投げ直し、書き換えた分は利用者の集合に入らない', async () => {
    const h = setup()
    const record = await startRecord(h)
    // S1 から始まる差分には、書き換えた undone.txt が出る(S2 を取らなければ、次の同期で利用者の変更に入る)
    h.collectBetween.mockImplementation(async (start) =>
      start.tempDir === '/tmp/cp-1' ? entriesOf('undone.txt') : []
    )
    const absorbed = absorb(h, async () => {
      throw new Error('途中で失敗しました')
    })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await expect(absorbed).rejects.toThrow('途中で失敗しました')
    change(h, { phase: 'agent' })
    ;(await snapshotCall(h, 3)).resolve(checkpointResult(3))
    await flush(h)
    expect(record.attribution).toMatchObject({ phase: 'agent', userPaths: new Set() })
  })

  it('(1) の区切りに失敗しても task は行い、区別をやめる(lost・checkpoint-failed)。S2 は取らない', async () => {
    const h = setup()
    const record = await startRecord(h)
    const task = vi.fn(async () => ({ applied: 1 }))
    const absorbed = absorb(h, task)
    ;(await snapshotCall(h, 1)).resolve({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'timeout' }
    })
    await expect(absorbed).resolves.toEqual({ applied: 1 })
    expect(task).toHaveBeenCalledOnce()
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'checkpoint-failed' })
    expect(h.calls).toHaveLength(2)
  })

  it('保留中(合図の unassignable)の吸収の後も、今の区間の印が残る', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { unassignable: true })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('held.txt'))
    const absorbed = absorb(h, async () => ({ applied: 1 }))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    ;(await snapshotCall(h, 3)).resolve(checkpointResult(3))
    await absorbed
    expect(record.attribution).toMatchObject({ periodUnassignable: true, userPaths: new Set() })
  })

  it('(1) の差分を求めている最中の打ち切りの印は、吸収の後も残る(続く同期が片付ける)', async () => {
    const h = setup()
    const record = await startRecord(h)
    const gate = deferred<AgentChangeEntry[]>()
    h.collectBetween.mockImplementationOnce(() => gate.promise)
    const absorbed = absorb(h, async () => ({ applied: 1 }))
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await vi.waitFor(() => expect(h.collectBetween).toHaveBeenCalledOnce())
    h.registry.markPeriodUnassignable(1)
    gate.resolve(entriesOf('u.txt'))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await absorbed
    expect(record.attribution).toMatchObject({
      periodUnassignable: true,
      timedOutPending: true,
      userPaths: new Set()
    })
  })

  it('吸収の前の打ち切りの印(戻す操作の後ろで打ち切られた)は吸収の後も残り、timedOutPending も残って続く同期が片付ける', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.registry.markPeriodUnassignable(1)
    const absorbed = absorb(h, async () => ({ applied: 1 }))
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await absorbed
    expect(record.attribution).toMatchObject({
      periodUnassignable: true,
      timedOutPending: true,
      hadUnassignedSince: true
    })
    // 続く同期: 打ち切りの後の段階が idle なので印を残してもう 1 回並べ、その次で下ろす
    h.registry.notifyAttributionSignal(1)
    ;(await snapshotCall(h, 3)).resolve(checkpointResult(3))
    ;(await snapshotCall(h, 4)).resolve(checkpointResult(4))
    await flush(h)
    await flush(h)
    expect(record.attribution).toMatchObject({ periodUnassignable: false, timedOutPending: false })
  })

  it('S2 を取っている最中の close で、取れた区切りを同期で消し、記録を変えない(L-435)', async () => {
    const h = setup()
    const record = await startRecord(h)
    const absorbed = absorb(h, async () => ({ applied: 1 }))
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    const s2 = await snapshotCall(h, 2)
    h.registry.close()
    s2.resolve(checkpointResult(2))
    await expect(absorbed).resolves.toEqual({ applied: 1 })
    expect(h.removeDirSync).toHaveBeenCalledWith('/tmp/cp-2')
    expect(record.attribution).toMatchObject({ checkpoint: { snapshot: { tempDir: '/tmp/cp-1' } } })
  })

  it('区別していない記録(lost)では区切りを取らずに task だけを行う', async () => {
    const h = setup({ phase: 'idle', lost: 'receiver-unavailable' })
    await startRecord(h)
    await expect(absorb(h, async () => ({ applied: 1 }))).resolves.toEqual({ applied: 1 })
    expect(h.calls).toHaveLength(1)
  })
})

describe('戻した操作の取り消しの吸収(undoLastRevert)', () => {
  const capture: Extract<AgentChangesUndoCapture, { kind: 'saved' }> = {
    kind: 'saved',
    dir: '/tmp/undo-1',
    items: [
      {
        path: 'a.txt',
        before: { kind: 'file', savedName: '0', mode: 0o644 },
        after: { kind: 'file', size: 4, sha256: 'a'.repeat(64), mode: 0o644 }
      }
    ]
  }
  /** 戻す操作の控えを記録に持たせる(undoId 1) */
  async function withUndo(h: Harness): Promise<void> {
    await h.registry.withRecord(1, FOLDER, (record) =>
      h.registry.commitRevertUndo(1, record, { operation: 'file', capture, applied: 1 })
    )
  }

  it('書き戻したら S1・S2 を取る(取り消しで戻った内容を利用者の変更にしない)', async () => {
    const h = setup()
    const record = await startRecord(h)
    await withUndo(h)
    h.executeUndo.mockResolvedValueOnce({ kind: 'done', restoredPaths: ['a.txt'], trashedPaths: [] })
    const undone = h.registry.undoLastRevert(1, FOLDER, 1)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await expect(undone).resolves.toMatchObject({ status: 'done', restoredPaths: ['a.txt'] })
    expect(record.attribution).toMatchObject({ checkpoint: { snapshot: { tempDir: '/tmp/cp-2' } } })
  })

  it('取り消しが途中で失敗して投げても、S2 を取ってから投げ直す', async () => {
    const h = setup()
    await startRecord(h)
    await withUndo(h)
    h.executeUndo.mockResolvedValueOnce({
      kind: 'failed',
      message: '取り消しに失敗しました: a.txt',
      keepUndo: false
    })
    const undone = h.registry.undoLastRevert(1, FOLDER, 1)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await expect(undone).rejects.toThrow('取り消しに失敗しました: a.txt')
  })

  it('控えの undoId が違えば、区切りを取らずに投げる(作業ツリーを変えない例外は吸収の外)', async () => {
    const h = setup()
    await startRecord(h)
    await withUndo(h)
    await expect(h.registry.undoLastRevert(1, FOLDER, 99)).rejects.toThrow(
      '取り消せる操作が変わりました'
    )
    expect(h.calls).toHaveLength(1)
  })
})
```

- [ ] **Step 2: handler・組み立て・実 git の失敗するテストを書く**

`src/main/__tests__/handlers/agentChangesHandlers.test.ts` の末尾に足す（`invoke(channel, event, ...args)`・`makeEvent`・`ALL`・`registry` はこのファイルの既存のもの。戻す関数はこのファイルで偽物に差し替えてあるため、作業ツリーは変わらない。パッチ `'patch'` は既存の `revertHunk` のテストで通っている値）:
```ts
describe('戻す操作の吸収(withAttributionAbsorbed)', () => {
  it.each<[string, unknown[]]>([
    ['agentChanges:revertFile', ['a.txt', ALL]],
    ['agentChanges:revertHunk', ['a.txt', 'patch', ALL]],
    ['agentChanges:revertAll', [[{ path: 'a.txt', status: 'M' }], ALL]]
  ])('%s は戻す関数の呼び出しを吸収で包み、適用した件数で作業ツリーを変えたかを決める(控えの記録は吸収の外)', async (channel, args) => {
    await invoke('agentChanges:begin', makeEvent(), 'manual')
    const absorbed = vi.spyOn(registry, 'withAttributionAbsorbed')
    await invoke(channel, makeEvent(), ...args)
    expect(absorbed).toHaveBeenCalledOnce()
    const [ownerId, record, task, changed] = absorbed.mock.calls[0]
    expect(ownerId).toBe(1)
    expect(record).toBeDefined()
    expect(typeof task).toBe('function')
    expect(changed({ applied: 1, capture: { kind: 'unavailable', reason: 'too-large' } })).toBe(true)
    expect(changed({ applied: 0, capture: { kind: 'unavailable', reason: 'too-large' } })).toBe(false)
  })
})
```
（`withAttributionAbsorbed` は総称のメソッドのため、`mock.calls` の `changed` の引数は `unknown` に推論され、`{ applied, capture }` をそのまま渡せる）

`src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts` の末尾に足す:
```ts
describe('戻す操作の吸収(実 git)', () => {
  it('エージェントの変更を行の ↶ で戻した後に、エージェントが同じファイルを書き直しても、利用者の集合に入らない(吸収を外すとこのテストが落ちる)', async () => {
    write('a.txt', 'base\n')
    commitAll(repo, 'base')
    const source = createFakeAttributionSource({ phase: 'idle' })
    rebuildRegistry({}, source)
    const change = (phase: 'idle' | 'agent'): void => {
      source.set({ phase })
      registry.notifyAttributionSignal(1)
    }
    await invoke('agentChanges:begin', 'manual')
    change('agent')
    await registry.waitForAgentPhase(1, new AbortController().signal)
    write('a.txt', 'agent\n')
    change('idle')
    await invoke('agentChanges:list', ALL)
    await invoke('agentChanges:revertFile', 'a.txt', ALL)
    expect(readRepoFile(repo, 'a.txt')).toBe('base\n')
    change('agent')
    await registry.waitForAgentPhase(1, new AbortController().signal)
    write('a.txt', 'agent again\n')
    change('idle')
    const attribution = await registry.withRecord(1, repo, async (record) => record.attribution)
    expect(attribution).toMatchObject({
      kind: 'tracking',
      userPaths: new Set(),
      agentPaths: new Set(['a.txt'])
    })
  })
})
```

`src/main/__tests__/ipcHandlers.test.ts`:
- `'claude の hooks の実物を 1 つ組み立て、段階 A のつなぎ先(何もしない・すぐ解決する)と開発版のログ(app.isPackaged でないとき)を渡す'` を次の 2 つに置き換える:
```ts
  it('claude の hooks のつなぎ先を、記録の registry の notifyAttributionSignal・waitForAgentPhase・markPeriodUnassignable にする(生成の順は hooks の runtime → registry のまま)', async () => {
    const notify = vi.spyOn(AgentBaselineRegistry.prototype, 'notifyAttributionSignal')
    const wait = vi.spyOn(AgentBaselineRegistry.prototype, 'waitForAgentPhase')
    const mark = vi.spyOn(AgentBaselineRegistry.prototype, 'markPeriodUnassignable')
    try {
      registerIpcHandlers(mockIpcMain)
      expect(mockCreateAgentHooksRuntime).toHaveBeenCalledOnce()
      const registry = mockSetupAgentBaselineLifecycle.mock.calls[0][1]
      const options = (mockCreateAgentHooksRuntime.mock.calls[0] as unknown[])[0] as {
        onPhaseChange: (ownerId: number) => void
        onToolStart: (ownerId: number, signal: AbortSignal) => Promise<void>
        onToolStartTimedOut: (ownerId: number) => void
        devLog: ((line: string) => void) | null
      }
      options.onPhaseChange(3)
      expect(notify).toHaveBeenCalledExactlyOnceWith(3)
      expect(notify.mock.contexts[0]).toBe(registry)
      const controller = new AbortController()
      await expect(options.onToolStart(3, controller.signal)).resolves.toBeUndefined()
      expect(wait).toHaveBeenCalledExactlyOnceWith(3, controller.signal)
      expect(wait.mock.contexts[0]).toBe(registry)
      options.onToolStartTimedOut(3)
      expect(mark).toHaveBeenCalledExactlyOnceWith(3)
      expect(mark.mock.contexts[0]).toBe(registry)
      expect(typeof options.devLog).toBe('function')
    } finally {
      notify.mockRestore()
      wait.mockRestore()
      mark.mockRestore()
    }
  })

  it('段階の通知・打ち切りのつなぎ先は、記録が無いときも registry の close の後も投げない', () => {
    registerIpcHandlers(mockIpcMain)
    const registry = mockSetupAgentBaselineLifecycle.mock.calls[0][1] as AgentBaselineRegistry
    const options = (mockCreateAgentHooksRuntime.mock.calls[0] as unknown[])[0] as {
      onPhaseChange: (ownerId: number) => void
      onToolStartTimedOut: (ownerId: number) => void
    }
    expect(() => options.onPhaseChange(1)).not.toThrow()
    expect(() => options.onToolStartTimedOut(1)).not.toThrow()
    registry.close()
    expect(() => options.onPhaseChange(1)).not.toThrow()
    expect(() => options.onToolStartTimedOut(1)).not.toThrow()
  })
```

- [ ] **Step 3: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/ipcHandlers.test.ts`
Expected: FAIL（`withAttributionAbsorbed` が無い・戻す操作が吸収で包まれていない・runtime のつなぎ先が何もしない）

- [ ] **Step 4: 吸収の手順を実装する**

`src/main/agentChangesAttributionSync.ts` の末尾に足す:
```ts
/**
 * 吸収の (1)(設計書「アプリの戻す操作・取り消しの吸収」)。区切り S1 を取り、前の区切りからの差分を今の段階に割り当てる
 * (印があれば割り当てない)。印は下ろさない(吸収の前に立った打ち切りの印も、差分を求めている最中の印も残す)。
 * timedOutPending も下ろさない(続く同期が手順 4・9 で片付ける)。段階は変えない
 */
export async function absorbBeforeTask(
  ctx: AttributionSyncContext
): Promise<AttributionStepOutcome> {
  const { record } = ctx
  const attribution = record.attribution
  if (attribution.kind !== 'tracking') return SKIPPED
  const phase = attribution.phase
  const previous = attribution.checkpoint
  const next = await takeCheckpoint(ctx, previous)
  if (next === 'canceled') return SKIPPED
  if (next === 'unavailable') {
    await markAttributionLost(record, 'checkpoint-failed', ctx)
    return { kind: 'lost', phaseBefore: phase }
  }
  const paths = await collectPaths(ctx, previous.snapshot, next)
  if (ctx.isStale()) {
    await ctx.discardSnapshot(next)
    return SKIPPED
  }
  if (paths === null) {
    await ctx.discardSnapshot(next)
    await markAttributionLost(record, 'checkpoint-failed', ctx)
    return { kind: 'lost', phaseBefore: phase }
  }
  assignClosedPeriod(attribution, paths, phase, attribution.periodUnassignable)
  if (ctx.signal().unassignable) attribution.periodUnassignable = true
  attribution.checkpoint = { snapshot: next, sharedWithBaseline: false }
  openPeriod(attribution, ctx.now())
  await removeCheckpoint(ctx, previous, attribution)
  return { kind: 'synced', phaseBefore: phase, requeue: false }
}

/**
 * 吸収の (3)。区切り S2 を取り直して判定の区切りを置き換え(S1 を消す)、その差分(アプリの操作)はどちらの集合にも入れない。
 * 印は合図の unassignable を足すだけで上書きしない((1) の後に列の外で立った印を残す)
 */
export async function absorbAfterTask(
  ctx: AttributionSyncContext
): Promise<AttributionStepOutcome> {
  const { record } = ctx
  const attribution = record.attribution
  if (attribution.kind !== 'tracking' || ctx.isStale()) return SKIPPED
  const phase = attribution.phase
  const previous = attribution.checkpoint
  const next = await takeCheckpoint(ctx, previous)
  if (next === 'canceled') return SKIPPED
  if (next === 'unavailable') {
    await markAttributionLost(record, 'checkpoint-failed', ctx)
    return { kind: 'lost', phaseBefore: phase }
  }
  if (ctx.signal().unassignable) attribution.periodUnassignable = true
  attribution.checkpoint = { snapshot: next, sharedWithBaseline: false }
  await removeCheckpoint(ctx, previous, attribution)
  return { kind: 'synced', phaseBefore: phase, requeue: false }
}
```

- [ ] **Step 5: registry・handler・組み立てを実装する**

`src/main/agentBaselineRegistry.ts`:
- `agentChangesAttributionSync` の import を次にする:
```ts
import {
  absorbAfterTask,
  absorbBeforeTask,
  markAttributionLost,
  syncAttributionStep
} from './agentChangesAttributionSync'
```
- `waitForAgentPhase` の後に足す:
```ts
  /**
   * 戻す操作・取り消しの吸収(設計書「アプリの戻す操作・取り消しの吸収」)。列の中で呼ぶ(自分では列に並ばない。同期と同じ列の中で直列になる)。
   * 区別している記録なら、(1) 区切り S1 を取って前の区間を割り当て、(2) task を行い、(3) 作業ツリーを変えた(changed)か task が投げたら
   * 区切り S2 を取り直して、アプリの操作の差分をどちらの集合にも入れない。区切りの失敗は lost にして task を止めない(区別はおまけ)
   */
  async withAttributionAbsorbed<T>(
    ownerId: number,
    record: AgentChangesRecord,
    task: () => Promise<T>,
    changed: (result: T) => boolean
  ): Promise<T> {
    const ctx = this.attributionContextOf(ownerId, record)
    this.logOutcome(ownerId, '吸収', await this.runAbsorbStep(ctx, absorbBeforeTask), record)
    let result: T
    try {
      result = await task()
    } catch (err) {
      // 変えたかが分からない(途中まで書き換えて投げうる)ため、必ず S2 を取ってから投げ直す
      this.logOutcome(ownerId, '吸収', await this.runAbsorbStep(ctx, absorbAfterTask), record)
      throw err
    }
    if (changed(result)) {
      this.logOutcome(ownerId, '吸収', await this.runAbsorbStep(ctx, absorbAfterTask), record)
    }
    return result
  }
```
- `undoLastRevert` を次にする（`undoId` の照合〈作業ツリーを変えない例外〉は吸収の外。`executeUndo` から結果を作るまでを包む）:
```ts
  undoLastRevert(
    ownerId: number,
    folderPath: string,
    undoId: number
  ): Promise<AgentChangesUndoResult | null> {
    return this.withRecord(ownerId, folderPath, async (record) => {
      const undo = record.undo
      if (undo === null || undo.undoId !== undoId) throw new Error(AGENT_UNDO_STALE_MESSAGE)
      return this.withAttributionAbsorbed(
        ownerId,
        record,
        async () => {
          const execution = await this.deps.executeUndo(record.baseline.folderPath, undo)
          // 作業ツリーを変えずに止まり、結果が控えを残すとしたなら、もう一度取り消せるよう控えを残す
          if ((execution.kind === 'rejected' || execution.kind === 'failed') && execution.keepUndo) {
            throw new Error(execution.message)
          }
          if (record.undo === undo) record.undo = null
          await this.removeUndoDir(undo.dir)
          if (execution.kind === 'rejected' || execution.kind === 'failed') {
            throw new Error(execution.message)
          }
          return toAgentChangesUndoResult(execution)
        },
        (result) => result.restoredPaths.length > 0 || result.trashedPaths.length > 0
      )
    })
  }
```
- `runAttributionSync` の後に足す:
```ts
  // 吸収の 1 段。予期しない例外は lost にして投げない(戻す操作・取り消しを止めない。L-002)
  private async runAbsorbStep(
    ctx: AttributionSyncContext,
    step: (ctx: AttributionSyncContext) => Promise<AttributionStepOutcome>
  ): Promise<AttributionStepOutcome> {
    try {
      return await step(ctx)
    } catch (err) {
      console.warn('[agent-attribution] 吸収に失敗しました:', err)
      return this.loseAfterError(ctx)
    }
  }
```

`src/main/handlers/agentChangesHandlers.ts`:
- `AgentChangesHandlerDeps.registry` の `Pick` に `| 'withAttributionAbsorbed'` を足す
- 先頭の説明の最後に「戻す 3 つは registry の withAttributionAbsorbed で包み、アプリの操作を利用者の変更に数えない(設計書「アプリの戻す操作・取り消しの吸収」)。控えの記録(commitRevert)は吸収の外」を足す
- `agentChanges:revertFile` のタスクを次にする:
```ts
        async (record, relativePath, _scope, ownerId) =>
          commitRevert(
            ownerId,
            record,
            'file',
            await registry.withAttributionAbsorbed(
              ownerId,
              record,
              () => revertAgentChange(revertContextOf(record), relativePath),
              (outcome) => outcome.applied > 0
            )
          )
```
- `agentChanges:revertHunk` のタスクを次にする:
```ts
        async (record, relativePath, parsedPatch, ownerId) =>
          commitRevert(
            ownerId,
            record,
            'hunk',
            await registry.withAttributionAbsorbed(
              ownerId,
              record,
              () => revertAgentChangeHunk(revertContextOf(record), relativePath, parsedPatch),
              (outcome) => outcome.applied > 0
            )
          )
```
- `agentChanges:revertAll` のタスクの `const { applied, capture, ...result } = await revertAllAgentChanges(revertContextOf(record), entries)` を次にする:
```ts
        const { applied, capture, ...result } = await registry.withAttributionAbsorbed(
          ownerId,
          record,
          () => revertAllAgentChanges(revertContextOf(record), entries),
          (outcome) => outcome.applied > 0
        )
```

`src/main/ipcHandlers.ts`:
- `createAgentHooksRuntime({ ... })` の前のコメントと引数を次にする（生成の順は変えない。runtime は生成の中で 3 つを呼ばず、最初に呼ぶのは組み立てが終わった後の IPC〈起動の activate・hooks の知らせ〉なので、矢印関数の中で後に作る registry を参照してよい）:
```ts
  // claude の hooks(ツールの区間の追跡・127.0.0.1 の受け口・起動ごとの準備)。実物の依存の組み立ては agentHooksRuntime.ts。
  // 追跡の合図の変化・PreToolUse の待ち・待ちの打ち切りを記録の registry につなぐ(設計書「registry へのつなぎ方」)。runtime は生成の中で
  // これらを呼ばず、最初に呼ぶのは組み立てが終わった後の IPC(起動の activate・hooks の知らせ)なので、後で作る registry を参照してよい
  const agentHooks = createAgentHooksRuntime({
    onPhaseChange: (ownerId) => agentBaselineRegistry.notifyAttributionSignal(ownerId),
    onToolStart: (ownerId, signal) => agentBaselineRegistry.waitForAgentPhase(ownerId, signal),
    onToolStartTimedOut: (ownerId) => agentBaselineRegistry.markPeriodUnassignable(ownerId),
    devLog: app.isPackaged ? null : (line) => console.log(line)
  })
```

説明だけの直し（コードは変えない）:
- `src/main/agentHooksRuntime.ts` の `AgentHooksRuntimeOptions` の 3 つの説明を「追跡の合図が変わったとき(記録の registry の notifyAttributionSignal)」「受け口の PreToolUse の待ち(registry の waitForAgentPhase)」「受け口の待ちの打ち切り(registry の markPeriodUnassignable)」に直す
- `src/main/agentHookReceiver.ts` の `AgentHookReceiverDeps` の `onToolStart`・`onToolStartTimedOut` の説明の「段階 A はすぐ解決する。段階 B で waitForAgentPhase につなぐ」「段階 A は何もしない。段階 B で markPeriodUnassignable につなぐ」を「記録の registry の waitForAgentPhase につなぐ。同期の throw・reject は待ちの失敗として打ち切りと同じに扱う」「記録の registry の markPeriodUnassignable につなぐ。待ちの失敗でも呼ぶ。close の後は呼ばない」に直す
- `src/main/agentToolActivity.ts` の `AgentToolActivityDeps.onPhaseChange` の説明と先頭の説明の「段階 A は何もしない。段階 B で syncAttribution につなぐ」を「記録の registry の notifyAttributionSignal につなぐ。例外は publish が握る」に直す

- [ ] **Step 6: 通す**

Run: `npx vitest run src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/agentChangesAttribution.integration.test.ts`
Expected: PASS
Run: `npm test`
Expected: PASS（時間切れで落ちたファイルは単体で流し直す）
Run: `npm run typecheck`
Expected: PASS（`agentChangesHandlers.ts` の依存の `Pick` に `withAttributionAbsorbed` が要る）
Run: `npx eslint --fix src/main/agentChangesAttributionSync.ts src/main/agentBaselineRegistry.ts src/main/handlers/agentChangesHandlers.ts src/main/ipcHandlers.ts src/main/agentHooksRuntime.ts src/main/agentHookReceiver.ts src/main/agentToolActivity.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/ipcHandlers.test.ts && npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 7: 変異で確かめる**

1. `withAttributionAbsorbed` の `catch` の中の S2（`this.logOutcome(... absorbAfterTask ...)` の行）を消し、「task が投げたら…S2 を取ってから同じ例外を投げ直し」が落ちることを確かめて戻す
2. `absorbAfterTask` の `if (ctx.signal().unassignable) attribution.periodUnassignable = true` を `attribution.periodUnassignable = ctx.signal().unassignable` にし、「(1) の差分を求めている最中の打ち切りの印は、吸収の後も残る」が落ちることを確かめて戻す
3. `absorbBeforeTask` の同じ行を `attribution.periodUnassignable = ctx.signal().unassignable` にし、「吸収の前の打ち切りの印…吸収の後も残り」が落ちることを確かめて戻す
4. `agentChangesHandlers.ts` の `agentChanges:revertFile` の吸収を外して `await revertAgentChange(revertContextOf(record), relativePath)` に戻し、`npx vitest run src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts -t '吸収'` の「…利用者の集合に入らない(吸収を外すとこのテストが落ちる)」と、`agentChangesHandlers.test.ts` の「agentChanges:revertFile は…」が落ちることを確かめて戻す
5. `ipcHandlers.ts` の `onToolStartTimedOut` を `() => undefined` に戻し、「claude の hooks のつなぎ先を…」が落ちることを確かめて戻す

- [ ] **Step 8: コミット（利用者の指示があるときだけ）**

```bash
git add src/main/agentChangesAttributionSync.ts src/main/agentBaselineRegistry.ts src/main/handlers/agentChangesHandlers.ts src/main/ipcHandlers.ts src/main/agentHooksRuntime.ts src/main/agentHookReceiver.ts src/main/agentToolActivity.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/ipcHandlers.test.ts
git commit -m "feat: アプリの戻す操作・取り消しを区別から吸収し、hooks の追跡と受け口を記録の registry につなぐ"
```

---

### Task 6: ROADMAP の進捗の更新と全体の検証（テスト仕様書への追記と Artifact の再公開）

> **気をつける知見:** L-059（モックで確かめられない届き方〈`PostToolBatch`・中断の後の保留〉を実機テスト仕様書で確かめる）

**Files:**
- Modify: `docs/manual-test-spec.md`（「### 利用者の変更との区別」の前提の 1 行目の直し・前提の 3 行目の追加、AGC-090〜094・AGC-102 の直し、AGC-104 の後に AGC-105〜109 を追加。**ID は変えない・振り直さない**）
- Modify: `ROADMAP.md`（「エージェントの変更の確認の拡張」の段階 A の既知の制約の hooks の数・段階 B-1 の実装済みの行・残りの行。**prettier にかけない**）
- 生成（git 管理外）: `.superpowers/manual-test-spec.html`

**Interfaces:**
- Consumes: Task 1a〜5 の実装（ログの文字列は Global Constraints の「ログの文言」と一字一句同じ。追跡の行は `src/main/agentToolActivity.ts` の `writeLog`、registry の行は `src/main/agentChangesAttribution.ts` の `attributionLogLine`、保留の行は `agentToolActivity.ts` の `warn` の文言）
- Produces: 実機テスト仕様書の AGC-105〜AGC-109 と、直した AGC-090〜094・AGC-102（コントローラーが Artifact を再公開する）

- [ ] **Step 1: 実機テスト仕様書の既存の項目を直す（ID は変えない）**

`docs/manual-test-spec.md` の「### 利用者の変更との区別」:
1. 1 つ目の `> 前提:` の行の末尾の `` `[agent-hooks] owner=<ウィンドウ> session=<先頭 8 桁> event=<イベント> tool=<ツール> id=<あり|なし|-> agent=<あり|なし|-> hooks=<状態> phase=<前>→<後>` の形。 `` を次に置き換える:
```markdown
`[agent-hooks] owner=<ウィンドウ> session=<先頭 8 桁> event=<イベント> tool=<ツール> id=<あり|なし|-> agent=<あり|なし|-> hooks=<状態> phase=<前>→<後> unassignable=<あり|なし>` の形（段階 B-1 から行の末尾に `unassignable=` が付く。以下の項目の期待結果の行はその前までの部分一致）。
```
2. 2 つ目の `> 前提:` の行の後に、次の行を足す:
```markdown
> 前提: 段階 B-1 の項目（AGC-105〜）は、`[agent-hooks]` の行に加えて `[agent-attribution]` の行（記録の区別。開発版でだけ出る）を見る。1 行は `[agent-attribution] owner=<ウィンドウ> event=<開始|同期|吸収|lost> phase=<前>→<後> user=<利用者の変更のパスの数> agent=<エージェントの変更のパスの数> unassignable=<あり|なし> reason=<理由か ->` の形。段階 B-1 でも、一覧・印・確認の文言は変わらない（区別を記録の中で持つだけ）。
```
3. AGC-090 の行の `アプリが渡した `http` の hooks 8 つ（`UserPromptSubmit`・`PreToolUse`・`PostToolUse`・`PostToolUseFailure`・`SubagentStop`・`Stop`・`StopFailure`・`SessionEnd`）が出る` を次に置き換える:
```markdown
アプリが渡した `http` の hooks 9 つ（`UserPromptSubmit`・`PreToolUse`・`PostToolUse`・`PostToolUseFailure`・`PostToolBatch`・`SubagentStop`・`Stop`・`StopFailure`・`SessionEnd`）が出る
```
4. AGC-091 の行の `、`event=PostToolUse tool=Edit id=あり agent=なし hooks=confirmed phase=agent→agent` の行が出て、その約 2 秒後に `session=- event=猶予の終わり … phase=agent→idle` の行が出る` を次に置き換える:
```markdown
、`event=PostToolUse tool=Edit id=あり agent=なし hooks=confirmed phase=agent→agent` の行が出た後も段階は `agent` のままで、`event=PostToolBatch tool=- id=- agent=- hooks=confirmed phase=agent→agent` の行が出てから約 2 秒後に `session=- event=猶予の終わり … phase=agent→idle` の行が出る
```
5. AGC-092 の行を次に置き換える（ID はそのまま）:
```markdown
- [ ] **AGC-092** `sleep 20 を実行して` を送り（`event=PreToolUse tool=Bash` の行が出る）、実行中に Esc で中断する → 端末に `event=PostToolUseFailure`・`event=Stop` の行は出ない（出たら記録する）。段階は `agent` のまま。そのまま次の指示を送らずに 40 秒待つ → 画面の活動が作業の終わりになってから約 30 秒後に `[agent-hooks] ターンの終わりの知らせが届かないため、次の知らせまで割り当てを保留します` と `event=終わりの待ちの終わり … unassignable=あり` の行が出る（`hooks=unconfirmed` にはならない）。次の指示（`こんにちは`）を送ると `[agent-hooks] 知らせが届いたため、保留を解きます` の行が出て、作業が終わると `event=Stop … phase=agent→agent` の行が出て、その約 2 秒後に `event=猶予の終わり … phase=agent→idle unassignable=なし` の行が出る
```
6. AGC-093 の行の末尾（`まで `agent` のまま` の後）に、次を足す:
```markdown
。拒否して作業が終わった後、次の指示を送らずに 40 秒待ち、`[agent-hooks] ターンの終わりの知らせが届かないため、次の知らせまで割り当てを保留します` の行が出るかを記録する（出たら、次の指示で `[agent-hooks] 知らせが届いたため、保留を解きます` の行が出る）
```
7. AGC-094 の行の `、`sleep` が終わって `event=PostToolUse tool=Bash` の行が出てから約 2 秒後に `event=猶予の終わり … phase=agent→idle` の行が出る` を次に置き換える:
```markdown
、`sleep` が終わって `event=PostToolUse tool=Bash` の行と `event=PostToolBatch` の行が出てから約 2 秒後に `event=猶予の終わり … phase=agent→idle` の行が出る
```
8. AGC-102 の行の `、同じツールの名前の `event=PostToolUse … id=あり` の行が出て、約 2 秒後に `event=猶予の終わり … phase=agent→idle` の行が出る` を次に置き換える:
```markdown
、同じツールの名前の `event=PostToolUse … id=あり` の行と `event=PostToolBatch` の行が出て、`event=PostToolBatch` の約 2 秒後に `event=猶予の終わり … phase=agent→idle` の行が出る
```
9. 直した後、`grep -n '猶予の終わり' docs/manual-test-spec.md` で、`PostToolUse` の約 2 秒後に `猶予の終わり` を期待している項目が残っていないことを確かめる（残っていれば、上と同じく `event=PostToolBatch` の約 2 秒後に直す。ID は変えない）。AGC-101（一覧・確認の文言が変わらない）は B-1 ではそのまま成り立つため変えない

- [ ] **Step 2: 実機テスト仕様書に B-1 の項目を足す**

`docs/manual-test-spec.md` の AGC-104 の行の直後（同じ節の最後）に、次をそのまま足す（1 行 1 項目。今の AGC の最大は AGC-104 なので AGC-105 から振る）:
```markdown
- [ ] **AGC-105** `claude` で `こんにちは` を送って確かめた状態（`hooks=confirmed`）にしてから `いまから記録する` を押し、エージェントが止まっている間に端末で `echo user >> c.txt` を実行してから `a.txt の最後に agent という行を足して` を送る → `いまから記録する` を押したときに `[agent-attribution] … event=開始 phase=-→idle user=0 agent=0 unassignable=なし reason=-` の行が出る。`event=PreToolUse` の行の後、`a.txt` が変わる前に `[agent-attribution] … event=同期 phase=idle→agent user=1 agent=0` の行が出て、作業の後（`event=PostToolBatch` の約 2 秒後の `event=猶予の終わり`）に `[agent-attribution] … event=同期 phase=agent→idle user=1 agent=1` の行が出る。ツールの開始が目に見えて遅れない。エージェントの変更のセクションの一覧・確認の文言は B-1 の前と変わらない（AGC-001・AGC-002 を行う）
- [ ] **AGC-106** 一時的に `.claude/settings.local.json` に `PostToolUse`（matcher `Edit`）の `command` の hook `sleep 3; echo fmt >> e.txt` を置いてから `claude` を起動し、`いまから記録する` を押してから `a.txt の最後に agent3 という行を足して` を送る → 端末に `event=PostToolUse` の行が出た後も段階は `agent` のままで、約 3 秒後に `event=PostToolBatch` の行、その約 2 秒後に `phase=agent→idle` の行が出る。その `[agent-attribution] … event=同期 phase=agent→idle` の行の `agent=` の件数に `e.txt` が入っている（`a.txt` と合わせて 2 以上）。確かめたら hook を消す
- [ ] **AGC-107** `claude` で `こんにちは` を送って確かめた状態にしてから `いまから記録する` を押し、利用者の設定（`~/.claude/settings.json`）に `"disableAllHooks": true` を書き足して `a.txt を読んで要約して` を送り、作業が終わってから 30 秒以上待つ → 端末に `[agent-hooks] ターンの終わりの知らせが届かないため、次の知らせまで割り当てを保留します` と `event=終わりの待ちの終わり … unassignable=あり` の行、続けて `[agent-attribution] … unassignable=あり` の行が出る。`hooks=unconfirmed` の行と `[agent-attribution] … event=lost` の行は出ない（設定の書き足しが効かず hooks が届き続けた場合は、その旨を記録する）。確かめたら設定を戻す
- [ ] **AGC-108** `claude` を起動した直後（`こんにちは` も送らずに）`いまから記録する` を押し、最初のプロンプトとして `sleep 20 を実行して` を送り、実行中に Esc で中断して 40 秒待つ（起動の直後の最初のターンでも待ちが張られることを見る）→ `[agent-hooks] ターンの終わりの知らせが届かないため、次の知らせまで割り当てを保留します` と `unassignable=あり` の行が出る。続けて `こんにちは` を送る → `[agent-hooks] 知らせが届いたため、保留を解きます` の行と、`[agent-attribution] … event=同期 … unassignable=なし` の行が出る
- [ ] **AGC-109** `a.txt を読んで要約して` を送り、作業が終わった後に 40 秒待つ → `次の知らせまで割り当てを保留します` の行が出ない（`Stop` が届いている）。許可を求めるツール（`rm b.txt を実行して` など）の確認を 40 秒出したままにする → その間に `次の知らせまで割り当てを保留します` の行が出ない（利用者の操作待ちは待ちの対象にしない）。`No` を選んで作業が終わった後に 40 秒待ち、`次の知らせまで割り当てを保留します` の行が出るかを記録する
```

- [ ] **Step 3: HTML を再生成し、仕様書の検査を通す**

Run: `node scripts/build-manual-test-spec.mjs`
Expected: `.superpowers/manual-test-spec.html (N 領域 / M 項目)` が出る（項目の数が直す前より 5 増えている）
Run: `npx vitest run scripts`
Expected: PASS（ID の一意性・接頭辞ごとの連番の昇順・書式）

Artifact（<manual-test-spec-artifact-url>）の再公開は、このタスクの実装者ではなく**コントローラーが** `.superpowers/manual-test-spec.html` を同じファイルパスで公開して行う（実装者は HTML の生成までで止め、報告に「再公開が必要」と書く）。

- [ ] **Step 4: ROADMAP を更新する（prettier にかけない）**

`ROADMAP.md` の「エージェントの変更の確認の拡張」の項目（`- [ ] エージェントの変更の確認の拡張:` の行）:
1. 「既知の制約（段階 A。…）:」の下の `` `claude` の `/hooks` にアプリの hooks（8 つ）が出る `` を `` `claude` の `/hooks` にアプリの hooks（8 つ。段階 B-1 から `PostToolBatch` を加えて 9 つ）が出る `` に直す
2. 「既知の制約（段階 A。…）:」の箇条の最後の行（`Windows・Linux では確かめていない…` の行）の後、`- 残り:` の行の前に、次の行を足す（`<実装の日>` は `date +%Y-%m-%d` の出力に置き換える。字下げは「実装済み（2026-10-13。段階 A。…」の行と同じ 6 つの空白）:
```markdown
      - 実装済み（<実装の日>。段階 B-1。設計書 `docs/superpowers/specs/2026-10-13-agent-changes-user-edit-distinction-design.md`）: PostToolBatch・hooks が届かなくなったときの保留・写しによる判定（内部で持つだけで画面は変わらない。ID があって `agent_id` の無いツールの区間を `PostToolBatch` まで開いたままにし、作業の終わりから 30 秒 `Stop` が届かなければ次の知らせまで割り当てを保留する。記録の中で、エージェントのツールが動いていない間に変わったパスを判定の区切りの差分で利用者の変更として持ち、アプリの戻す操作・取り消しは吸収する。開発版のログ `[agent-attribution]` で見る。B-1 から利用者に見える挙動として、記録がある間はエージェントのツールの開始が判定の区切りを取り終えるまで待たされ〈約 0.3 秒、上限 5 秒〉、行の `↶`・ハンク・`すべて戻す`・取り消しのたびに区切りを 2 回取る〈約 0.6 秒〉）
```
3. `- 残り: `claude` の hooks で利用者の編集と区別する（段階 B: 写しによる判定・印・すべて戻すの対象から外す）、Git 管理外のフォルダでの記録` を次に置き換える:
```markdown
      - 残り: `claude` の hooks で利用者の編集と区別する（段階 B-2: 行の印・すべて戻すの対象から外す）、Git 管理外のフォルダでの記録
```
4. 項目の本体（`- [ ] エージェントの変更の確認の拡張:`）は完了にしない（`[ ]` のまま）

- [ ] **Step 5: 全体の検証**

Run: `npm test`
Expected: PASS（すべてのテスト。時間切れで落ちたファイルは `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書く）
Run: `npm run typecheck`
Expected: PASS
Run: `git diff --name-only -- '*.ts' '*.tsx' && git ls-files --others --exclude-standard -- '*.ts' '*.tsx'` で、このプランで変更・作成した TypeScript のファイルを列挙し、`npx eslint --max-warnings 0 <列挙したファイル>`
Expected: エラー・警告なし
Run: `git diff --stat -- src/renderer/src/components src/renderer/src/lib/agentChangesMessages.ts src/renderer/src/lib/agentChangesAvailability.ts src/renderer/src/lib/agentChangesView.ts src/main/agentChangesScopedQuery.ts src/main/agentChangesRevert.ts`
Expected: 何も出ない（B-1 は一覧・確認の文言・画面を変えない）
Run: `git status --short`
Expected: このプランで変えたファイルと、設計書・プランの未追跡・変更のファイルだけが出る（`.superpowers/` は git 管理外）

- [ ] **Step 6: コミット（利用者の指示があるときだけ）**

```bash
git add docs/manual-test-spec.md ROADMAP.md
git commit -m "docs: 段階 B-1 の進捗と、実機テスト仕様書の AGC-105〜109・既存の項目の直しを追加する"
```
