# エージェントの変更の利用者の編集との区別（段階 B-2: B-1 の最終レビューの修正・IPC の型・一覧の author とすべて戻すの絞り込み・renderer の文言と画面） 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** B-1 で main の記録の中に持った「利用者の変更」「エージェントの変更」の区別を、累積の一覧の行の印（`利用者の変更`・`利用者の変更を含む`）・`すべて戻す` の対象からの除外・確認の文言・区別の状態の 1 行として画面に出す。あわせて B-1 の最終レビューで送った 2 つの修正（同期の手順 4〜9 の窓の合図・吸収の (1) の始めの合図）と `authorsOf` の整理を、印を出す前に入れる。

**Architecture:** main は、`agentChangesAttribution.ts` の `TrackingAttribution` に `signalUnassignablePending` を足し、`agentChangesAttributionSync.ts` の同期の手順 4・9 と吸収の (1) の始めの合図の確認（`checkSignalBeforePeriod`）で窓を塞ぐ。一覧の行の `author` は、累積の範囲の解決のときだけ registry の `attributeEntries`（今の区間のパス `currentPeriodPaths` を求めて `authorsOf` で付ける。列の中で呼び、自分では並ばない）で付け、`すべて戻す` は吸収の中で同じ `attributeEntries` を呼んで、shared の `isAgentRevertAllTarget` で対象に絞ってから確認の一覧と照合する。IPC の結果（`AgentChangeEntry.author`・`AgentChangesState`・`AgentChangesListResult` の `attribution`）は shared の型で必須にし、renderer は写しに `attribution` を持って、`agentChangesMessages.ts` の文言・`agentChangesAvailability.ts` の押せない理由・`useAgentChangesRevert.ts` の対象の絞り込み・`AgentChangesFileItem`・`AgentChangesSection` の印と 1 行に使う。

**Tech Stack:** Electron（main・preload）, React 19, TypeScript, simple-git（既存の `collectAgentChangeEntries`・`collectAgentChangeEntriesBetween`）, Vitest（偽の `takeSnapshot`・偽の差分・実 git）, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-13-agent-changes-user-edit-distinction-design.md`（承認済み。実装の前に必ず読む）。このプランは「実装の分割」の **段階 B-2 のタスク 1〜6 だけ**。読む節: 「決めたこと（利用者の確認済み）」の B-2 の 2 行・「決めたこと（推奨案で決めた事項）」の「割り当てない間のエージェントの変更」と「一覧への載せ方」、「利用者の変更の判定」の「記録に持つもの」「同期」「やめる」「行の `author`」「`すべて戻す`」「アプリの戻す操作・取り消しの吸収」「確認の文言」、「registry へのつなぎ方」の `notifyAttributionSignal`、「記録・実行ごとの記録・取り消し・自動の取り直しとの関係」、「IPC と型」、「renderer（段階 B）」、「新しい状態と既存の入口」の B-2 の行、「エラー処理」の B-2 の行、「テスト方針」の段階 B-2、「実機テスト仕様書の方針」の B-2、「既知の制約」、「構成」の B-2、「実装の分割」の B-2 と「B-1 の最終レビューで B-2 に送ったこと」、「反映した知見」の段階 B-2 の分。段階 B-1 のプラン `docs/superpowers/plans/2026-10-14-agent-changes-user-edit-distinction-stage-b1.md` は書き方と B-1 の部品の経緯の参考（B-1 のプランの名前のうち `markPeriodUnassignable`・`loseAfterError` は実装で `markToolStartTimedOut`・`runAttributionStep` + `loseAfterUnexpectedError` になっている。このプランの名前は main の今のコードに合わせた）。

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
> - 設計書のタスク 1〜6 はそのまま Task 1〜6 にする（分けない）。Task 2・Task 3 は型に追随する既存のテストの直しが多いが、型の変更と呼び出し元・テストの補助を同じタスクで直す（各タスクの終わりで `npm test`・`npm run typecheck` が通る）。
> - 吸収の (1) の始めの合図の確認を、設計書のタスク 3 の記述（「吸収の (1) の始めの確認を関数 `checkSignalBeforePeriod(ctx)` に切り出し、両方が使う」）より前倒しして、**Task 1 で `agentChangesAttributionSync.ts` の非公開の関数 `checkSignalBeforePeriod(ctx, attribution): Promise<'lost' | 'marked' | 'clear'>` として作る**（Task 3 の `currentPeriodPaths` はそれを使うだけ。引数に `TrackingAttribution` を足したのは、呼び出し側が絞り込んだ区別を渡して型の判定を重ねないため）。
> - `currentPeriodPaths` は、設計書の手順に加えて、**始めに `ctx.isStale()` なら何もせず `null`** を返す（古くなった記録の段階・印を書き換えない。設計書の「`null` は…記録が古くなった」の扱いを始めにも当てる）。
> - registry の `attributeEntries` の予期しない例外のログの文言は、設計書に文言が無いため **`[agent-attribution] 一覧の区別に失敗しました:`**（`attributionWarn` の第 1 引数。第 2 引数に例外）にする。`lost` にした結果は、同期・吸収と同じく開発版のログに `event=lost` の 1 行で出す。
> - 「判定の区切りの tree を `git gc --prune=now` で消した後の一覧」の実 git の結合テストは、**gc の後の同期（段階の変化）で `lost` になった記録の一覧**として書く。今の区間の比較（`collectAgentChangeEntries`。`git diff` と `ls-files`）は blob を読まずに作業ツリーのハッシュと index の sha を比べるため、gc だけでは比較が失敗しないことがある（区切りを取る `write-tree` は object が無いと失敗する。B-1 の結合テストと同じ経路）。一覧の比較そのものの失敗は、偽の `collectCurrent` の単体テスト（Task 3）で固定する。
> - `AgentChangesFileItem` の振る舞いのテストのファイルは今は無い（`AgentChangesFileItem.styles.test.tsx` だけ）ため、**`src/renderer/src/components/source-control/__tests__/AgentChangesFileItem.test.tsx` を新しく作る**。
> - renderer のテストの補助に **`makeAgentChangesTrackingSummary`・`makeAgentChangesLostSummary`**、main のテストの補助に **`attributionOffSummary(startedAt)`**（`makeAttributionOffDeps` の記録〈`lost`・`receiver-unavailable`〉の要約）を足し、`kind: 'recording'` の期待値の直しに使う（設計書は補助の名前を決めていない）。
> - renderer の写し・状態・一覧の結果の工場の `attribution` の既定は **`{ kind: 'tracking', since: null, hadUnassignedSince: false }`（区別していない記録）** にする（既存のテストの確認の文言・印が変わらない）。
> - 実機テスト仕様書の「上の前提で救えない項目」は、計画の時点で `grep` に当たる項目（AGC-001・007・044・047・048・063）を読み、端末の編集が印なし・`すべて戻す` で戻ることを期待している項目は無いと確かめた。Task 6 では AGC-044 の期待結果に印の旨を 1 文足すだけにする（ほかは直さない。手順は Task 6 に書いた）。
> - L-413 の本文の新しい形（見える要素は `aria-hidden`、参照先は同じ文字の `hidden` の要素）は、設計書が「見える要素に置いて `aria-describedby` で結ぶ（隠した要素を参照しない）」と決め、既存の押せない理由（`reasonId` の見える `<p>`）も同じ形のため、このプランでは設計書の形に従う（除く旨の 1 行は見える `<p>` に `id` を振り、`すべて戻す` から参照する）。

## Global Constraints

- コメント・文言・ログは日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。クライアントのコンポーネントには `'use client'`（`AgentChangesFileItem.tsx`・`AgentChangesSection.tsx` は既に付いている）。`any` を使わない
- **コミットは利用者の明示の指示があるときだけ行う**（CLAUDE.md）。各タスクの最後の「コミット」の Step は、指示があったときにだけ実行する。そのときは `git add <このタスクで変えたファイルを列挙>`（**`git add -A` は使わない**）で、メッセージは日本語の Conventional Commit、本文の最後に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **実物の `claude` は起動しない。** 実機の確認はユーザーがまとめて行う（Task 6 で実機テスト仕様書に追記する）。プランに実機の手順は書かない
- 各タスクの終わりで次が通る状態を保つ: `npm test`（全テスト）・`npm run typecheck`・変更・作成した TypeScript のファイルへの `npx eslint --fix <ファイル>` → `npx eslint --max-warnings 0 <ファイル>`（各タスクの「通す」の Step の `<同じファイル>` は、直前の `npx eslint --fix` に渡したファイルの並びと同じものを渡す）。**このマシンは負荷が高く、`npm test` の全体でテストが時間切れ（`Test timed out`・`waitFor` の打ち切り）で落ちることがある。** 落ちたら、落ちたファイルを `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書いて先へ進む。単体でも落ちれば本当の失敗として直す
- 型（`src/shared/types/agentChanges.ts`。B-1 で定義済みの 3 つは変えない）:
  - `AgentChangeAuthor = 'agent' | 'user' | 'mixed'`（B-1 で定義済み）
  - `AgentChangesAttributionLostReason = 'hooks-not-confirmed' | 'receiver-unavailable' | 'claude-version-unsupported' | 'checkpoint-failed'`（B-1 で定義済み）
  - `AgentChangesAttributionSummary = { kind: 'tracking'; since: number | null; hadUnassignedSince: boolean } | { kind: 'lost'; reason: AgentChangesAttributionLostReason; lostAt: number; hadMarks: boolean; since: number | null; hadUnassignedSince: boolean }`（B-1 で定義済み）
  - B-2 で足す（Task 2。どれも必須。L-060）: `AgentChangeEntry.author: AgentChangeAuthor | null`、`AgentChangesState` の `recording` の `attribution: AgentChangesAttributionSummary`、`AgentChangesListResult` の `recording`・`scope-unavailable` の `attribution: AgentChangesAttributionSummary`、`isAgentRevertAllTarget(entry: Pick<AgentChangeEntry, 'author'>): boolean`（`author` が `user`・`mixed` でない。`src/shared/types.ts` の値の再公開の並びにも足す）
- main の依存・関数の名前（後のタスクはこの名前と型で使う）:
  - `TrackingAttribution.signalUnassignablePending: boolean`（Task 1。`initialAttribution` で false。立てるのは `notifyAttributionSignal` だけ）
  - `currentPeriodTracking(attribution: AgentChangesAttribution): TrackingAttribution | null`（Task 1。`needsCurrentPeriod` を置き換える）
  - `nextPeriodStart({ timedOut, signalAtStart, signalNow, signalMarkedDuringSync })`（Task 1。`signalMarkedDuringSync: boolean` を足す）
  - `AttributionSyncContext.collectCurrent: (snapshot: BaselineSnapshot) => Promise<AgentChangeEntry[]>`（Task 3）
  - `currentPeriodPaths(ctx: AttributionSyncContext, entries: readonly AgentChangeEntry[]): Promise<string[] | 'lost' | null>`（Task 3）
  - `AgentBaselineRegistryDeps.collectCurrent: (snapshot: BaselineSnapshot) => Promise<AgentChangeEntry[]>`（Task 3。必須。`ipcHandlers.ts` が `collectAgentChangeEntries` を渡す）
  - `AgentBaselineRegistry.attributeEntries(ownerId: number, record: AgentChangesRecord, entries: AgentChangeEntry[]): Promise<AgentChangeEntry[]>`（Task 3。列の中で呼ぶ。自分では列に並ばない。投げない）
  - `listAgentChangesInScope(record, scope, attributeEntries: (entries: AgentChangeEntry[]) => Promise<AgentChangeEntry[]>)`（Task 3。3 つ目の引数は必須）
  - `AgentRevertContext.attributeEntries: (entries: AgentChangeEntry[]) => Promise<AgentChangeEntry[]>`（Task 3。必須）
- renderer の文言（`src/renderer/src/lib/agentChangesMessages.ts`。一字一句この形。実機テスト仕様書もこの文字列で書く。`HH:MM` はどれも `formatAgentChangesStartedAt` で作る）:
  - 行の印: `AGENT_CHANGES_USER_MARK = '利用者の変更'`・`AGENT_CHANGES_MIXED_MARK = '利用者の変更を含む'`
  - 除く旨: `formatAgentChangesExcludedNote(count)` → `すべて戻すは、利用者の変更（${count} 件）を除いて戻します`
  - 対象 0 件の理由: `AGENT_CHANGES_ONLY_USER_REASON = '利用者の変更だけのため、すべて戻すの対象がありません。ファイルごとに戻してください'`
  - 理由の文言 `AGENT_CHANGES_ATTRIBUTION_LOST_REASONS: Record<AgentChangesAttributionLostReason, string>`: `hooks-not-confirmed` → `claude の hooks から知らせが届きません`、`receiver-unavailable` → `hooks の知らせの受け口を用意できませんでした`、`claude-version-unsupported` → `claude の版が古いか、版を確かめられませんでした`、`checkpoint-failed` → `作業ツリーの記録に失敗しました`
  - 区別の状態の 1 行 `describeAgentChangesAttribution(attribution, startedAt): string | null`: `lost`・`hadMarks` が偽 → `利用者の変更を区別できません（<理由>）。すべてエージェントの変更として表示します`、`lost`・`hadMarks` が真 → `<lostAt の HH:MM> から利用者の変更を区別できなくなりました（<理由>）。それ以降の変更には印を付けません`、`tracking`・`since` が null → null、`tracking`・`since > startedAt` → `利用者の変更の区別は <since の HH:MM> からです（それより前の変更には印を付けません）`、`tracking`・`hadUnassignedSince` → `アプリの中で claude が動いていなかった間などの変更には、印を付けていません`、`tracking`・その 2 つが両方 → 2 つを `。` でつないで 1 行、`tracking`・`since === startedAt`（`since <= startedAt`）で `hadUnassignedSince` が偽 → null
  - 区別しているか `isAgentChangesAttributionDistinguishing(summary)`: `tracking` なら `since !== null`、`lost` なら `hadMarks`
  - `すべて戻す` の確認の順 1〜5（`？` の直後から取り消せる旨の文の前まで。区切りの空白・改行は入れずにつなぐ）: 順 1 区別していない → `記録を始めた後にあなたが編集した内容も戻ります。`（2〜4 は出さない）。順 1 区別している → `AGENT_REVERT_ALL_DISTINGUISHING_NOTE = 'エージェントのツールが動いている間（終わってから 2 秒・許可の確認を待つ間を含む）と、claude を起動してから最初のプロンプトを送るまで・中断（Esc）の後にあなたが編集した内容は、エージェントの変更として戻ります。'`。順 2 区別している・`since > startedAt` → `<since の HH:MM> より前のあなたの編集も戻ります。`。順 3 区別している・`hadUnassignedSince` → `アプリの中で claude が動いていなかった間などのあなたの編集も戻ります。`。順 4 区別している・`lost` → `区別をやめた後（<lostAt の HH:MM> から）のあなたの編集も戻ります。`。順 5 `excludedCount > 0`（区別していなくても出す）→ `利用者の変更 ${excludedCount} 件（印の付いた行）は戻しません。行の ↶ で個別に戻せます。`
  - 行の `↶` の確認の追記（`author` が `user`・`mixed` のとき、今の文言の後に改行 2 つで、アプリで保存した旨などの前）: `このファイル（フォルダ）には、エージェントのツールが動いていない間の変更（利用者の変更）が含まれます。`
  - 変えない文言: `記録を始めた後にあなたが編集した内容も戻ります。`（行の `↶` の状態ごとの文と、区別していない記録の `すべて戻す`）、ハンクの確認、`あなたの保存を含む`（`AGENT_CHANGES_SAVED_MARK`）と確認の追記、押せない理由の評価の順、取り消しの帯
- main のログ: registry の `attributeEntries` の予期しない例外は `attributionWarn('[agent-attribution] 一覧の区別に失敗しました:', err)`（`console` を直接呼ばない。L-450）。区別をやめたときの開発版のログは既存の `[agent-attribution] owner=<id> event=lost phase=<前か ->→- user=<件数> agent=<件数> unassignable=なし reason=<理由>` の形
- 画面: CSS は変えない（区別の状態の 1 行・除く旨の 1 行は既存の `agent-changes__note`、印は既存の `agent-changes__mark`）。区別の状態の 1 行・除く旨の 1 行は `aria-live` にしない（L-153・L-166）。新しいボタン・フォーカスの移動は足さない（L-408 の対象の操作を足さない）
- テストの規約: 偽のタイマーを使うテストは `afterEach` で `vi.useRealTimers()` まで戻す（このプランのテストは偽のタイマーを使わない）。`act(...).then(...)` で書かない。`console.*` の spy は `afterEach`（か `finally`）で戻す。テストの補助関数にも戻り値の型を書く（`@typescript-eslint/explicit-function-return-type`）。実 git・一時ディレクトリは使う `describe` の中だけで用意する（L-440）。待ちは状態（Promise の解決・記録の値・呼び出しの数）で待ち、固定時間で待たない（L-185。「まだ解決していない」ことの確認だけは `setImmediate` 1 回分を待つ）。結果は `await` で受け、`void promise.then(...)` で観測しない（L-178）。区切りの最中の出来事は、偽の `takeSnapshot` の完了を外から解決できる形（`agentBaselineRegistry.attribution.test.ts` の `snapshotCall`）にして順序を作る（L-167）
- 「変異で確かめる」の Step は、書いた実装の一部を一時的に戻して該当のテストが落ちることを確かめ、必ず元に戻す（戻したことを `git diff` で確かめる）

### 気をつける知見（dev-flow-kit の `lessons/review-lessons.md`。設計書の「反映した知見」の段階 B-2 の分）

- **L-002**（「無い」「失敗」を「空」として扱わない）: 今の区間の比較の失敗・`attributeEntries` の予期しない例外を「今の区間なし」として黙らせず、記録を `lost` にしてから集合だけで `author` を付ける（Task 3）。吸収の (1) で合図の `lost` を見落とさない（Task 1）
- **L-006**（「一覧に無い」ことを根拠に否定で分類しない）: 割り当てない間の変更をエージェントの集合に「無い」ことを根拠に `user` と言い切らない。`user` の行の確認の文も「動いていない間の変更が含まれます」にし、`mixed` と同じ文にする（Task 4）。割り当てない間のパスの集合は持たない
- **L-036**（確認した対象と実行する対象を中身で照合する）: `すべて戻す` の除く規則を shared の 1 つの関数 `isAgentRevertAllTarget` にし、確認の一覧（renderer。Task 4）と実行時の照合（main。Task 3）を同じ定義から作る
- **L-040**（古い結果が新しい状態を上書きしない）: 吸収の (1) は、記録の古い段階ではなく呼ばれた時点の合図で段階の違いを見て、閉じた区間を割り当てない（Task 1）。今の区間の比較も同じ部品で合図を確かめる（Task 3）
- **L-057**（条件付きの拒否を見える文字で伝える）: 除く旨・対象 0 件の理由・区別の状態の 1 行を見える文字で出す（Task 4・5）
- **L-058**（見た目だけ無効化したボタン）: 除く規則を renderer の `expected` だけでなく main の照合でも行い、対象 0 件の古い依頼でも何も変えない（Task 3）。renderer の `revertAll` も対象 0 件では確認を出さない（Task 4）
- **L-060**（必須の依存にする）: registry の依存 `collectCurrent`、`listAgentChangesInScope` の `attributeEntries`、`AgentRevertContext.attributeEntries`（Task 3）、確認の関数の `author`・`attribution`・`startedAt`・`excludedCount`、`agentRevertAllDisabledReason` の `hasOnlyUserChanges`（Task 4）、IPC の型の `author`・`attribution`（Task 2）を必須にする。行の印は `entry.author` から決め、渡し忘れの起きる props を足さない（Task 5）。組み立てのテストで同一性（`toBe`）を確かめる（Task 3）
- **L-061**（新しい状態の入口を列挙する）: 入口の表の `list`（累積）だけが `author` を付け、`getDiff` と実行の範囲は影響しない（Task 3）
- **L-063**（一括操作を 1 つの流れにする）: `すべて戻す` を「実行時の一覧 → 上限の検査 → `author` → 絞り込み → 照合 → 全件の検査 → 適用」の 1 つの流れにする（Task 3）
- **L-103・L-434**（往復を値の比較で取りこぼさない）: 同期の手順 4〜9 の窓の中で立ってすぐ下りた合図を、手順 2・8 の合図の値ではなく出来事の印 `signalUnassignablePending` で拾う（Task 1）
- **L-152**（確認の文言が副作用の差を伝える）: 区別している記録の `すべて戻す` の確認で、戻る利用者の編集（ツールの実行中・猶予・許可の確認の待ち・`claude` の起動から最初のプロンプトまで・中断の後・区別の前・割り当てない間・区別をやめた後）と戻さない件数を伝える（順 1〜5。Task 4）。要約の `hadUnassignedSince` に今の区間の印を足し、確認の順 3 と区別の状態の 1 行が出ない窓を塞ぐ（Task 2）
- **L-413**（理由の要素の `aria-describedby`）: 除く旨は見える要素に置き、`すべて戻す` の `aria-describedby` で押せない理由と並べて結ぶ（Task 5。設計書の形に従う。上の「調整した細部」）
- **L-423**（静かな取り直しの写しの比較）: 写しの構造の比較（`isSameAgentChangesView`）に `author`・`attribution` が入ることをテストで固定する（Task 2）
- **L-424**（区別の失敗を一覧の失敗にしない）: 今の区間の比較の失敗・予期しない例外でも一覧は返す（`listError` にしない。Task 3）
- **L-446**（何もしないタスクを待ち直し続けない）: `attributeEntries` は待ち・同期の並べ直しをしない（Task 3）
- **L-448**（状態が移るときの付随するフラグ）: `signalUnassignablePending` は同期の手順 4 で決め直し（下ろし）、手順 9 で使ってから下ろす。手順 4 の前の印は `unassignableBefore` に入る（Task 1）
- **L-449**（包みの中で走ることを順の配列で固定する）: `すべて戻す` の `attributeEntries` が吸収の中（S1 の後・適用の前）で呼ばれることを、呼ばれた順の配列で固定する（Task 3）
- **L-450**（注入した層は console を直接呼ばない）: `attributeEntries` の予期しない例外のログは注入した `attributionWarn` で出す（Task 3）
- 上の段階 A・段階 B の分の知見（設計書の「反映した知見」）は B-2 にもそのまま効く。L-178・L-185・L-167・L-440 はテストの規約のとおり（全タスク）

### ファイルの構成（作る・変えるもの）

| ファイル | 責務 | タスク |
| --- | --- | --- |
| `src/main/agentChangesAttribution.ts` | `TrackingAttribution.signalUnassignablePending`・`initialAttribution` の初期値・`currentPeriodTracking`（`needsCurrentPeriod` の置き換え）・`authorsOf` の重ねた判定を外す（1）、`summarizeAttribution` の `hadUnassignedSince` に今の区間の印（2） | 1・2 |
| `src/main/agentChangesAttributionSync.ts` | `nextPeriodStart` の `signalMarkedDuringSync`・同期の手順 4 と 9・`checkSignalBeforePeriod`・`absorbBeforeTask` の始めの合図（1）、`AttributionSyncContext.collectCurrent`・`currentPeriodPaths`（3） | 1・3 |
| `src/main/agentBaselineRegistry.ts` | `notifyAttributionSignal` の `signalUnassignablePending`（1）、`recordingState` の `attribution`（2）、依存 `collectCurrent`・`attributeEntries`（3） | 1・2・3 |
| `src/shared/types/agentChanges.ts`・`src/shared/types.ts` | `AgentChangeEntry.author`・`AgentChangesState`・`AgentChangesListResult` の `attribution`・`isAgentRevertAllTarget`（と値の再公開）・型の説明の「B-2 で…」の直し | 2 |
| `src/main/agentChangesQuery.ts` | 一覧の関数の行に `author: null` | 2 |
| `src/main/agentChangesScopedQuery.ts` | 結果の `attribution`（2）、3 つ目の引数 `attributeEntries` と要約の順（3） | 2・3 |
| `src/main/agentChangesRevert.ts` | `AgentRevertContext.attributeEntries` と `revertAllAgentChanges` の絞り込み | 3 |
| `src/main/handlers/agentChangesHandlers.ts` | 依存の `Pick` に `attributeEntries`・`agentChanges:list` の `attributeEntries`・`revertContextOf(ownerId, record)` | 3 |
| `src/main/ipcHandlers.ts` | registry に `collectCurrent: collectAgentChangeEntries` | 3 |
| `src/main/__tests__/helpers/agentBaselineFixtures.ts` | `makeTrackingAttribution` の `signalUnassignablePending`（1）、`attributionOffSummary`（2）、`AttributionRegistryDeps`・`makeAttributionOffDeps` の `collectCurrent`（3） | 1・2・3 |
| `src/renderer/src/types.ts` | 写し `AgentChangesView` の `recording` の `attribution` | 2 |
| `src/renderer/src/lib/agentChangesView.ts` | `planRecordingState`・`planListResult` が `attribution` を写す | 2 |
| `src/renderer/src/__tests__/makeAgentChangesState.ts` | 行の `author: null`・写し・状態・一覧の結果の `attribution`・`makeAgentChangesTrackingSummary`・`makeAgentChangesLostSummary`（2）、`makeAgentChangesRevertState` の `revertAllExcludedCount`（4） | 2・4 |
| `src/renderer/src/lib/agentChangesMessages.ts` | 「確認の文言」の定数・関数 | 4 |
| `src/renderer/src/lib/agentChangesAvailability.ts` | `agentRevertAllDisabledReason` の `hasOnlyUserChanges` | 4 |
| `src/renderer/src/hooks/useAgentChangesRevert.ts` | 対象の絞り込み・確認への引数・`revertAllExcludedCount` | 4 |
| `src/renderer/src/components/source-control/AgentChangesFileItem.tsx` | 行の印 | 5 |
| `src/renderer/src/components/source-control/AgentChangesSection.tsx` | 区別の状態の 1 行・除く旨の 1 行・`aria-describedby`・`shownReason` の上のコメント | 5 |
| `docs/manual-test-spec.md`・`ROADMAP.md`・`docs/superpowers/specs/2026-10-06-agent-changes-review-design.md`・設計書の「既知の制約」 | 実機テスト仕様書（AGC-112〜129 と既存の項目の変更）・ROADMAP の新しい節と項目の直し・2026-10-06 の設計書への注記 | 6 |

---

### Task 1: B-1 の最終レビューの修正と `authorsOf` の整理（main の内部。`signalUnassignablePending`・吸収の (1) の始めの合図・`currentPeriodTracking`）

> **気をつける知見:** L-103・L-434（窓の中で立ってすぐ下りた合図を出来事の印で拾う）・L-448（印は手順 4 で決め直し、手順 9 で使ってから下ろす）・L-040・L-002（吸収の (1) は呼ばれた時点の合図を見る。合図の `lost` を見落とさない）・L-167（区切りの最中の出来事は偽の `takeSnapshot` の完了を外から解決して作る）

画面・IPC は変わらない（`AgentChangeEntry`・`AgentChangesState`・`AgentChangesListResult` は Task 2 まで変えない）。

**Files:**
- Modify: `src/main/agentChangesAttribution.ts`（`TrackingAttribution`・`initialAttribution`・`needsCurrentPeriod` → `currentPeriodTracking`・`authorsOf`）
- Modify: `src/main/agentChangesAttributionSync.ts`（`nextPeriodStart`・`syncAttributionStep` の手順 4 と 9・`checkSignalBeforePeriod`〈新規・非公開〉・`absorbBeforeTask`）
- Modify: `src/main/agentBaselineRegistry.ts`（`notifyAttributionSignal`）
- Modify: `src/main/__tests__/helpers/agentBaselineFixtures.ts`（`makeTrackingAttribution` の既定値）
- Test: `src/main/__tests__/agentChangesAttribution.test.ts`・`src/main/__tests__/agentChangesAttributionSync.test.ts`・`src/main/__tests__/agentBaselineRegistry.attribution.test.ts`

**Interfaces:**
- Consumes: B-1 の `AttributionSyncContext`（`record`・`signal`・`takeSnapshot`・`collectBetween`・`isStale`・`discardSnapshot`・`removeDir`・`now`）・`markAttributionLost(record, reason, { now, removeDir })`・`AgentToolActivitySignal`（`phase`・`lost`・`unassignable`）
- Produces:
```ts
// src/main/agentChangesAttribution.ts
export interface TrackingAttribution extends AttributionMarks {
  kind: 'tracking'
  phase: AgentToolPhase
  periodUnassignable: boolean
  timedOutPending: boolean
  /** 合図の unassignable を見て、まだ同期の手順 9 で片付けていない印(立てるのは notifyAttributionSignal だけ) */
  signalUnassignablePending: boolean
  checkpoint: AgentChangesCheckpoint
}
export function currentPeriodTracking(attribution: AgentChangesAttribution): TrackingAttribution | null

// src/main/agentChangesAttributionSync.ts
export function nextPeriodStart(input: {
  timedOut: boolean
  signalAtStart: AgentToolActivitySignal
  signalNow: AgentToolActivitySignal
  signalMarkedDuringSync: boolean
}): NextPeriodStart
// 非公開(Task 3 の currentPeriodPaths も使う)
async function checkSignalBeforePeriod(
  ctx: AttributionSyncContext,
  attribution: TrackingAttribution
): Promise<'lost' | 'marked' | 'clear'>
```

- [ ] **Step 1: 失敗するテストを書く（純粋な関数とテストの補助）**

`src/main/__tests__/helpers/agentBaselineFixtures.ts` の `makeTrackingAttribution` の戻り値の `timedOutPending: false,` の次の行に足す:
```ts
    signalUnassignablePending: false,
```

`src/main/__tests__/agentChangesAttribution.test.ts`:
- import の `needsCurrentPeriod` を `currentPeriodTracking` に置き換える
- `describe('initialAttribution(記録の始め方)', ...)` の最後に足す:
```ts
  it('合図の印(signalUnassignablePending)は、どの始め方でも false で始める', () => {
    const cases = [
      start(signal('idle'), signal('idle')),
      start(signal('agent'), signal('agent', { unassignable: true })),
      start(signal('idle', { unassignable: true }), signal('idle'))
    ]
    for (const { attribution } of cases) {
      expect(attribution).toMatchObject({ kind: 'tracking', signalUnassignablePending: false })
    }
  })
```
- `it('今の区間に印があれば割り当てない(呼び出し側も比べない)', ...)` の `expect(needsCurrentPeriod(attribution)).toBe(false)` を `expect(currentPeriodTracking(attribution)).toBeNull()` に置き換える
- `it('lost で集合があれば、今の区間を除いて集合だけで決める', ...)` の `expect(needsCurrentPeriod(attribution)).toBe(false)` を `expect(currentPeriodTracking(attribution)).toBeNull()` に置き換える
- `it('今の区間を比べなかった・失敗した(null)ときは集合だけで決める', ...)` を次に置き換える:
```ts
  it('今の区間を比べなかった・失敗した(null)ときは集合だけで決める', () => {
    const attribution = tracking()
    // 印の無い tracking は、絞り込んだ区別そのものを返す(型の述語にせず、偽の側を LostAttribution に絞り込まない)
    expect(currentPeriodTracking(attribution)).toBe(attribution)
    expect(authorsOf([entry('u.txt')], attribution, null)).toEqual(['agent'])
  })
```

`src/main/__tests__/agentChangesAttributionSync.test.ts`:
1. `/** 区別している記録の区別(...) */ function trackingOf(...)` と `const signalOf = (...)` の 2 つの定義を、今の位置から `contextOf` の定義の直後（`describe('markAttributionLost', ...)` の前）へ移す（`describe.each` の引数で `signalOf` を使うため。中身は変えない）
2. `describe.each([...] as const)('%s の区切り・差分の失敗', (_name, step) => {` を次にし、その `describe` の中のすべての `contextOf(record, { ... })`・`contextOf(record)` に `signal: assignSignal` を渡す（`contextOf(record)` は `contextOf(record, { signal: assignSignal })` にする）:
```ts
// 吸収の (1) は記録の段階(idle)と合図の段階が違うと閉じた区間を割り当てないため、合図の段階を記録と同じ idle にする。
// 同期は段階が同じだと手順 3 で終わるため、合図を agent にする
describe.each([
  ['syncAttributionStep', syncAttributionStep, signalOf('agent')],
  ['absorbBeforeTask', absorbBeforeTask, signalOf('idle')]
] as const)('%s の区切り・差分の失敗', (_name, step, assignSignal) => {
```
3. `describe('syncAttributionStep の区間の規則(手順 2〜9)', ...)` の最後に足す:
```ts
  it('手順 4 の後に立った合図の印(signalUnassignablePending)は、手順 2・8 の合図が下りていても新しい区間の印にして手順 9 で下ろす(並べ直さない)', async () => {
    const record = recordWithCheckpoint()
    const attribution = trackingOf(record)
    // 手順 2 は agent(ツールが始まった)、手順 8 は idle(区切りの最中にツールが終わり、合図も立って下りた)
    const signals = [signalOf('agent'), signalOf('idle')]
    const ctx = contextOf(record, {
      signal: () => signals.shift() ?? signalOf('idle'),
      duringSnapshot: () => {
        // 合図の unassignable を見た notifyAttributionSignal と同じ書き換え
        attribution.periodUnassignable = true
        attribution.signalUnassignablePending = true
      }
    })
    expect(await syncAttributionStep(ctx)).toEqual({
      kind: 'synced',
      phaseBefore: 'idle',
      requeue: false
    })
    expect(attribution).toMatchObject({
      phase: 'idle',
      periodUnassignable: true,
      signalUnassignablePending: false,
      userPaths: new Set(),
      hadUnassignedSince: true
    })
  })

  it('手順 4 より前に立っていた signalUnassignablePending は手順 4 で下ろし(閉じた区間の印に入る)、新しい区間の印にしない', async () => {
    const record = recordWithCheckpoint()
    const attribution = trackingOf(record)
    attribution.periodUnassignable = true
    attribution.signalUnassignablePending = true
    const ctx = contextOf(record, { signal: signalOf('agent') })
    await syncAttributionStep(ctx)
    expect(attribution).toMatchObject({
      phase: 'agent',
      periodUnassignable: false,
      signalUnassignablePending: false,
      userPaths: new Set()
    })
  })
```
4. `describe('absorbBeforeTask の区間の規則', ...)` の 1 つ目のテスト（`印のある区間の差分は割り当てず…`）の `contextOf(record, { signal: signalOf('agent') })` を `contextOf(record, { signal: signalOf('idle') })` にする（印のある区間だけを試す）。2 つ目のテスト（`合図の unassignable は差分の後に今の区間の印として足す…`）を消し、その位置に次を足す:
```ts
  it('合図が lost なら、区切りを取らずに合図の理由で lost にする(前の区切りは消す)', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, { signal: signalOf('idle', { lost: 'hooks-not-confirmed' }) })
    expect(await absorbBeforeTask(ctx)).toEqual({ kind: 'lost', phaseBefore: 'idle' })
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'hooks-not-confirmed' })
    expect(ctx.takeSnapshot).not.toHaveBeenCalled()
    expect(ctx.removed).toEqual(['/tmp/cp-1'])
  })

  it.each<[string, AgentToolActivitySignal]>([
    ['合図の段階が記録の段階と違う', signalOf('agent')],
    ['合図の unassignable が立っている', signalOf('idle', { unassignable: true })]
  ])(
    '%s なら、区切りを取る前に印を立てて閉じた区間を割り当てず、印を次の区間にも残す(段階は変えない)',
    async (_label, signal) => {
      const record = recordWithCheckpoint()
      const ctx = contextOf(record, { signal })
      expect(await absorbBeforeTask(ctx)).toEqual({
        kind: 'synced',
        phaseBefore: 'idle',
        requeue: false
      })
      expect(trackingOf(record)).toMatchObject({
        phase: 'idle',
        periodUnassignable: true,
        userPaths: new Set(),
        agentPaths: new Set(),
        hadUnassignedSince: true,
        checkpoint: { snapshot: nextSnapshot, sharedWithBaseline: false }
      })
    }
  )
```
5. `describe('nextPeriodStart(手順 9 の規則)', ...)` の既存の 4 つのテストのすべての `nextPeriodStart({ ... })` の呼び出しに `signalMarkedDuringSync: false` を足し、最後に足す:
```ts
  it('手順 4 の後に立った合図の印(signalMarkedDuringSync)は、手順 2・8 の合図が下りていても印にする(並べ直さない)', () => {
    expect(
      nextPeriodStart({
        timedOut: false,
        signalAtStart: sig('agent'),
        signalNow: sig('idle'),
        signalMarkedDuringSync: true
      })
    ).toEqual({ phase: 'idle', periodUnassignable: true, requeue: false })
  })
```

- [ ] **Step 2: 失敗するテストを書く（registry を通した窓・吸収）**

`src/main/__tests__/agentBaselineRegistry.attribution.test.ts`:
1. `describe('記録の区別の始め方(begin)', ...)` の 1 つ目のテストの `toEqual({ ... })` の `timedOutPending: false,` の次の行に `signalUnassignablePending: false,` を足す
2. `describe('区別の同期(syncAttribution・notifyAttributionSignal)', ...)` の最後に足す:
```ts
  it('合図の unassignable を見た notifyAttributionSignal は、列の外で同期的に今の区間の印と signalUnassignablePending を立てる', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { unassignable: true })
    expect(record.attribution).toMatchObject({
      periodUnassignable: true,
      signalUnassignablePending: true
    })
  })

  it('手順 5〜7 の最中に合図の unassignable が立って下りても(手順 2・8 では下りている)、手順 8 が idle なら次の区間に印が残り、その間の利用者の編集は利用者の集合に入らず、下りたときに並んだ同期で印が下りる。区切りはその 1 回の分しか増えない', async () => {
    const h = setup()
    const record = await startRecord(h)
    // 窓の中の利用者の編集は、同期の区切り(cp-1)からの差分に出る
    h.collectBetween.mockImplementation(async (start) =>
      start.tempDir === '/tmp/cp-1' ? entriesOf('window.txt') : []
    )
    // 手順 2 は agent(ツールが始まった)
    change(h, { phase: 'agent' })
    const s1 = await snapshotCall(h, 1)
    // 区切りを取っている最中に合図が立って下り、ツールも終わる(下りた・idle の通知の同期は、立ったときの同期に合流する)
    change(h, { unassignable: true })
    change(h, { unassignable: false })
    change(h, { phase: 'idle' })
    s1.resolve(checkpointResult(1))
    // 立ったときに並んだ同期が、印のある区間として片付ける
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    await flush(h)
    await settle()
    expect(h.calls).toHaveLength(3)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      periodUnassignable: false,
      signalUnassignablePending: false,
      userPaths: new Set(),
      agentPaths: new Set(),
      hadUnassignedSince: true
    })
  })

  it('手順 4 より前に立った合図の印は、その同期の次の区間には残さない(次の区間の利用者の編集は利用者の集合に入る)', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.collectBetween.mockImplementation(async (start) =>
      start.tempDir === '/tmp/cp-1' ? entriesOf('user.txt') : entriesOf('held.txt')
    )
    // 列で待っている同期に、下りた通知が合流する(同期が走り始める前に立って下りた)
    change(h, { unassignable: true })
    change(h, { unassignable: false })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    expect(record.attribution).toMatchObject({
      periodUnassignable: false,
      signalUnassignablePending: false,
      userPaths: new Set()
    })
    change(h, { phase: 'agent' })
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    expect(record.attribution).toMatchObject({ phase: 'agent', userPaths: new Set(['user.txt']) })
  })
```
3. `describe('戻す操作・取り消しの吸収(withAttributionAbsorbed)', ...)` の最後（`区別していない記録(lost)では…` の後）に足す:
```ts
  it('合図が lost の間の戻す操作は、区切りを取らずに記録を lost(合図の理由)にし、task は行う', async () => {
    const h = setup()
    const record = await startRecord(h)
    // 列が戻す操作で埋まっていて、合図の変化の同期がまだ走っていない(合図だけを書き換え、通知しない)
    h.source.set({ lost: 'hooks-not-confirmed' })
    const task = vi.fn(async () => ({ applied: 1 }))
    await expect(absorb(h, task)).resolves.toEqual({ applied: 1 })
    expect(task).toHaveBeenCalledOnce()
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'hooks-not-confirmed' })
    expect(h.calls).toHaveLength(1)
    expect(h.devLog).toHaveBeenLastCalledWith(
      '[agent-attribution] owner=1 event=lost phase=idle→- user=0 agent=0 unassignable=なし reason=hooks-not-confirmed'
    )
  })

  it('列が戻す操作で埋まっている間に段階が idle → agent に変わると、(1) は閉じた区間を割り当てず、印が (3) の後も残り、続く同期が片付けてツールの書き込みを利用者の集合に入れない', async () => {
    const h = setup()
    const record = await startRecord(h)
    const open = blockQueue(h)
    // 前の区切り(cp-0)からの差分に、利用者の編集とツールの書き込みが混ざっている
    h.collectBetween.mockImplementation(async (start) =>
      start.tempDir === '/tmp/cp-0' ? entriesOf('user.txt', 'tool.txt') : []
    )
    const absorbed = absorb(h, async () => ({ applied: 1 }))
    // 吸収の後ろに段階の変化の同期が並ぶ(hooks の効かない claude が書き始めた場合など)
    change(h, { phase: 'agent' })
    await open()
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await expect(absorbed).resolves.toEqual({ applied: 1 })
    // (1)・(3) の両方の吸収のログに印が残っている(続く同期は手順 4 で印を控えて下ろすため、記録の値ではなくログで見る。
    // (1) の 1 行だけで満たす形にすると、(3) が印を下ろす退行を見落とす。L-168)
    const absorbLines = h.devLog.mock.calls
      .map(([line]) => line)
      .filter((line) => line.includes('event=吸収'))
    expect(absorbLines).toEqual([
      '[agent-attribution] owner=1 event=吸収 phase=idle→idle user=0 agent=0 unassignable=あり reason=-',
      '[agent-attribution] owner=1 event=吸収 phase=idle→idle user=0 agent=0 unassignable=あり reason=-'
    ])
    ;(await snapshotCall(h, 3)).resolve(checkpointResult(3))
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'agent',
      periodUnassignable: false,
      userPaths: new Set(),
      agentPaths: new Set(),
      hadUnassignedSince: true
    })
  })
```

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentChangesAttribution.test.ts src/main/__tests__/agentChangesAttributionSync.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts`
Expected: FAIL（`currentPeriodTracking` が無い・`signalMarkedDuringSync` を受けない・`signalUnassignablePending` が無い・吸収の (1) が合図を見ない。窓のテストは `snapshotCall(h, 2)` の `waitFor` の打ち切りで落ちる）。`npm run typecheck` も `signalUnassignablePending`・`currentPeriodTracking`・`signalMarkedDuringSync` で落ちる

- [ ] **Step 4: 実装する**

`src/main/agentChangesAttribution.ts`:
- `TrackingAttribution` の `timedOutPending` の後に足す:
```ts
  /**
   * 合図の unassignable を見て、まだ同期の手順 9 で片付けていない印(立てるのは notifyAttributionSignal だけ。同期の手順 4 で下ろし、
   * 手順 9 で periodUnassignable に OR してから下ろす。手順 4〜9 の窓の中で立ってすぐ下りた合図を拾う。L-103・L-434・L-448)。
   * lost にするときは捨てる(LostAttribution に持たない)
   */
  signalUnassignablePending: boolean
```
- `initialAttribution` の `tracking` の戻り値の `timedOutPending: false,` の次の行に `signalUnassignablePending: false,` を足す
- `needsCurrentPeriod` を消し、同じ位置に次を置く:
```ts
/**
 * 今の区間(最後の判定の区切り → 作業ツリー)を比べて割り当てる区別(tracking で印が無いときはその区別、それ以外は null)。
 * 型の述語にしない(偽の側に印のある tracking も含まれるのに LostAttribution へ絞り込まれるため)
 */
export function currentPeriodTracking(
  attribution: AgentChangesAttribution
): TrackingAttribution | null {
  return attribution.kind === 'tracking' && !attribution.periodUnassignable ? attribution : null
}
```
- `authorsOf` の説明の `currentPaths は今の区間のパス(needsCurrentPeriod が偽・比べなかった・失敗したら null)` を `currentPaths は今の区間のパス(currentPeriodTracking が null・比べなかった・失敗したら null)` に直し、今の区間を足す部分を次に置き換える:
```ts
  const current = currentPaths === null ? null : currentPeriodTracking(attribution)
  if (current !== null && currentPaths !== null) {
    if (current.phase === 'idle') user.push(...currentPaths)
    else if (current.phase === 'agent') agent.push(...currentPaths)
  }
```

`src/main/agentChangesAttributionSync.ts`:
- `nextPeriodStart` の説明と関数を次に置き換える:
```ts
/**
 * 手順 9 の規則。新しい区間の段階は手順 8 の合図の値。同期の開始の前・手順 8 までに打ち切りがあり(timedOut)、手順 8 の段階が
 * agent でなければ並べ直し、その区間にも印を立てる。手順 2・8 の合図の unassignable と、手順 4 の後に notifyAttributionSignal が
 * 立てた印(signalMarkedDuringSync。立ってすぐ下りた合図)も印にする。合図が理由の印では並べ直さない(L-103・L-434)
 */
export function nextPeriodStart({
  timedOut,
  signalAtStart,
  signalNow,
  signalMarkedDuringSync
}: {
  timedOut: boolean
  signalAtStart: AgentToolActivitySignal
  signalNow: AgentToolActivitySignal
  signalMarkedDuringSync: boolean
}): NextPeriodStart {
  const requeue = timedOut && signalNow.phase !== 'agent'
  return {
    phase: signalNow.phase,
    periodUnassignable:
      requeue || signalNow.unassignable || signalAtStart.unassignable || signalMarkedDuringSync,
    requeue
  }
}
```
- `syncAttributionStep` の手順 4 を次にする:
```ts
  // 4. 印を控えて下ろす(この後の打ち切りは markToolStartTimedOut が、合図の印は notifyAttributionSignal がまた立てる。
  //    手順 4 より前に立った合図の印は unassignableBefore に入る。L-448)
  const unassignableBefore = attribution.periodUnassignable
  const timeoutBefore = attribution.timedOutPending
  attribution.periodUnassignable = false
  attribution.timedOutPending = false
  attribution.signalUnassignablePending = false
```
- `syncAttributionStep` の手順 9 の `nextPeriodStart({ timedOut, signalAtStart, signalNow })` の呼び出しを次にする:
```ts
  const { phase, periodUnassignable, requeue } = nextPeriodStart({
    timedOut,
    signalAtStart,
    signalNow,
    signalMarkedDuringSync: attribution.signalUnassignablePending
  })
  attribution.signalUnassignablePending = false
```
- `removeCheckpoint` の定義の後（`syncAttributionStep` の前）に足す:
```ts
/**
 * 吸収の (1)・今の区間の比較の始めの合図の確認(設計書「アプリの戻す操作・取り消しの吸収」「行の author」1。L-040)。記録の古い段階で
 * 区間を割り当てないため、呼ばれた時点の合図を読む。合図が lost なら記録を lost(合図の理由)にして 'lost'、合図の unassignable が
 * 立っている・合図の段階が記録の段階と違う(列が埋まっている間に段階が変わり、その変化の同期がまだ走っていない)なら今の区間に印を
 * 立てて 'marked'(印は続く同期が手順 3 で見て片付ける。並べ直しは増えない)、どちらでもなければ 'clear'
 */
async function checkSignalBeforePeriod(
  ctx: AttributionSyncContext,
  attribution: TrackingAttribution
): Promise<'lost' | 'marked' | 'clear'> {
  const signal = ctx.signal()
  if (signal.lost !== null) {
    await markAttributionLost(ctx.record, signal.lost, ctx)
    return 'lost'
  }
  if (signal.unassignable || signal.phase !== attribution.phase) {
    attribution.periodUnassignable = true
    return 'marked'
  }
  return 'clear'
}
```
- `absorbBeforeTask` の説明に「始めに合図を読み、lost なら区切りを取らずに lost にし、段階の違い・合図の unassignable なら閉じた区間を割り当てない印を立てる(checkSignalBeforePeriod)」を足し、`const phase = attribution.phase` の次の行に足す:
```ts
  if ((await checkSignalBeforePeriod(ctx, attribution)) === 'lost') {
    return { kind: 'lost', phaseBefore: phase }
  }
```

`src/main/agentBaselineRegistry.ts` の `notifyAttributionSignal`:
- 説明の「合図の unassignable が立っていれば列の外で同期的に今の区間に印を立て、」を「合図の unassignable が立っていれば列の外で同期的に今の区間の印と、同期の手順 9 で拾う印(signalUnassignablePending。手順 4〜9 の窓の中で立ってすぐ下りた合図を拾う)を立て、」に直す
- 中身を次にする:
```ts
      if (this.deps.attributionSource.activityOf(ownerId).unassignable) {
        record.attribution.periodUnassignable = true
        record.attribution.signalUnassignablePending = true
      }
```

- [ ] **Step 5: 通す**

Run: `npx vitest run src/main/__tests__/agentChangesAttribution.test.ts src/main/__tests__/agentChangesAttributionSync.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentChangesAttribution.integration.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentChangesRecord.test.ts`
Expected: PASS
Run: `npm test`
Expected: PASS（時間切れで落ちたファイルは単体で流し直す）
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/main/agentChangesAttribution.ts src/main/agentChangesAttributionSync.ts src/main/agentBaselineRegistry.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/agentChangesAttribution.test.ts src/main/__tests__/agentChangesAttributionSync.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts && npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 6: 変異で確かめる**

1. `nextPeriodStart` の `|| signalMarkedDuringSync` を外し、`npx vitest run src/main/__tests__/agentChangesAttributionSync.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts` で「手順 4 の後に立った合図の印(signalMarkedDuringSync)は…」「手順 4 の後に立った合図の印(signalUnassignablePending)は…」「手順 5〜7 の最中に合図の unassignable が立って下りても…」が落ちることを確かめて戻す
2. `syncAttributionStep` の手順 4 の `attribution.signalUnassignablePending = false` を消し、「手順 4 より前に立っていた signalUnassignablePending は手順 4 で下ろし…」「手順 4 より前に立った合図の印は、その同期の次の区間には残さない…」が落ちることを確かめて戻す
3. `notifyAttributionSignal` の `record.attribution.signalUnassignablePending = true` を消し、「合図の unassignable を見た notifyAttributionSignal は…」「手順 5〜7 の最中に合図の unassignable が立って下りても…」が落ちることを確かめて戻す
4. `absorbBeforeTask` の `checkSignalBeforePeriod` の呼び出し（追加した 3 行）を消し、「合図が lost なら、区切りを取らずに…」「%s なら、区切りを取る前に印を立てて…」「合図が lost の間の戻す操作は…」「列が戻す操作で埋まっている間に段階が idle → agent に変わると…」が落ちることを確かめて戻す
5. `absorbAfterTask` の `if (ctx.signal().unassignable) attribution.periodUnassignable = true` の次の行に `attribution.periodUnassignable = false` を入れ、「列が戻す操作で埋まっている間に段階が idle → agent に変わると…」が落ちる（(3) の吸収のログが `unassignable=なし` になる）ことを確かめて戻す
6. 戻したことを `git diff src/main/agentChangesAttributionSync.ts src/main/agentBaselineRegistry.ts` で確かめる

- [ ] **Step 7: コミット（利用者の指示があるときだけ）**

```bash
git add src/main/agentChangesAttribution.ts src/main/agentChangesAttributionSync.ts src/main/agentBaselineRegistry.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/agentChangesAttribution.test.ts src/main/__tests__/agentChangesAttributionSync.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts
git commit -m "fix: 同期の窓の中で立ってすぐ下りた合図と、吸収の始めの合図の lost・段階のずれを区別の印に反映する"
```

---

### Task 2: IPC の型と結果の要約（`author`・`attribution`・`isAgentRevertAllTarget`・写しの反映・テストの補助）

> **気をつける知見:** L-060（IPC の型の `author`・`attribution` を必須にする）・L-152（要約の `hadUnassignedSince` に今の区間の印を足す）・L-423（写しの構造の比較に `author`・`attribution` が入る）・L-036（除く規則を shared の 1 つの関数にする）

行の `author` はこのタスクの終わりではまだすべて `null` で、画面・確認の文言は変わらない。型を必須にするため、型に追随する main・renderer・テストの補助・既存のテストの期待値をこのタスクで直す。

**Files:**
- Modify: `src/shared/types/agentChanges.ts`（`AgentChangeEntry.author`・`AgentChangesState`・`AgentChangesListResult` の `attribution`・`isAgentRevertAllTarget`・`AgentChangeAuthor`・`AgentChangesAttributionSummary` の説明）
- Modify: `src/shared/types.ts`（値の再公開に `isAgentRevertAllTarget`）
- Modify: `src/main/agentChangesQuery.ts`（行を作る 9 か所に `author: null`）
- Modify: `src/main/agentChangesAttribution.ts`（`summarizeAttribution`）
- Modify: `src/main/agentBaselineRegistry.ts`（`recordingState`）
- Modify: `src/main/agentChangesScopedQuery.ts`（`common` の `attribution`）
- Modify: `src/renderer/src/types.ts`（`AgentChangesView` の `recording` の `attribution`）
- Modify: `src/renderer/src/lib/agentChangesView.ts`（`planRecordingState`・`planListResult`）
- Modify: `src/main/__tests__/helpers/agentBaselineFixtures.ts`（`attributionOffSummary`）
- Modify: `src/renderer/src/__tests__/makeAgentChangesState.ts`（`makeAgentChangeEntry`・写し・状態・一覧の結果の工場の `attribution`・`makeAgentChangesTrackingSummary`・`makeAgentChangesLostSummary`）
- Test: `src/shared/__tests__/agentChanges.test.ts`・`src/main/__tests__/agentChangesAttribution.test.ts`・`src/main/__tests__/agentChangesScopedQuery.test.ts`・`src/main/__tests__/agentBaselineRegistry.test.ts`・`src/main/__tests__/agentBaselineRegistry.attribution.test.ts`・`src/main/__tests__/handlers/agentChangesHandlers.test.ts`・`src/main/__tests__/agentChangesQuery.integration.test.ts`・`src/main/__tests__/agentChangesRuns.integration.test.ts`・`src/main/__tests__/agentChangesRevert.integration.test.ts`・`src/main/__tests__/agentChangesAttributionSync.test.ts`・`src/main/__tests__/helpers/agentBaselineFixtures.test.ts`・`src/renderer/src/lib/__tests__/agentChangesView.test.ts`・`src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts`・`src/renderer/src/hooks/__tests__/useAgentChanges.test.ts`・`src/renderer/src/lib/__tests__/agentChangesApi.test.ts`（ほかに `npm test`・`npm run typecheck` で落ちたもの）

**Interfaces:**
- Consumes: B-1 の型 `AgentChangeAuthor`・`AgentChangesAttributionSummary`、`summarizeAttribution(attribution): AgentChangesAttributionSummary`、Task 1 の `TrackingAttribution`
- Produces:
```ts
// src/shared/types/agentChanges.ts
export interface AgentChangeEntry {
  path: string
  status: AgentChangeStatus
  isDirectory: boolean
  notRecorded: boolean
  author: AgentChangeAuthor | null
}
// AgentChangesState の recording・AgentChangesListResult の recording と scope-unavailable に:
//   attribution: AgentChangesAttributionSummary
export function isAgentRevertAllTarget(entry: Pick<AgentChangeEntry, 'author'>): boolean

// src/renderer/src/types.ts の AgentChangesView の recording に:
//   attribution: AgentChangesAttributionSummary

// src/main/__tests__/helpers/agentBaselineFixtures.ts
export function attributionOffSummary(startedAt: number): AgentChangesAttributionSummary

// src/renderer/src/__tests__/makeAgentChangesState.ts
export function makeAgentChangesTrackingSummary(
  overrides?: Partial<Omit<Extract<AgentChangesAttributionSummary, { kind: 'tracking' }>, 'kind'>>
): AgentChangesAttributionSummary
export function makeAgentChangesLostSummary(
  overrides?: Partial<Omit<Extract<AgentChangesAttributionSummary, { kind: 'lost' }>, 'kind'>>
): AgentChangesAttributionSummary
// makeAgentChangeEntry の既定に author: null。makeAgentChangesRecordingState・makeAgentChangesRecordingView・
// makeAgentChangesScopeUnavailableView・makeAgentChangesListResult・makeAgentChangesScopeUnavailableListResult の
// overrides に attribution?: AgentChangesAttributionSummary(既定は makeAgentChangesTrackingSummary())
```

- [ ] **Step 1: 失敗するテストを書く（新しい挙動）**

`src/shared/__tests__/agentChanges.test.ts`:
- `from '../types'` の import に `isAgentRevertAllTarget` を足す（`../types` から再公開されることも同時に確かめる）
- 末尾に足す:
```ts
describe('isAgentRevertAllTarget(すべて戻すの対象)', () => {
  it.each([
    ['agent', true],
    [null, true],
    ['user', false],
    ['mixed', false]
  ] as const)('author が %s なら %s', (author, expected) => {
    expect(isAgentRevertAllTarget({ author })).toBe(expected)
  })
})
```

`src/main/__tests__/agentChangesAttribution.test.ts` の `describe('summarizeAttribution(要約)', ...)` の最後に足す:
```ts
  it('tracking の hadUnassignedSince は、区別を始めた後で今の区間に印があるときも真(区間を閉じる同期がまだ走っていない窓。L-152)', () => {
    expect(summarizeAttribution(tracking({ periodUnassignable: true }))).toEqual({
      kind: 'tracking',
      since: 100,
      hadUnassignedSince: true
    })
    // 区別を始める前(trackingSince が null)の印では立てない(区別していない記録のまま)
    expect(
      summarizeAttribution(tracking({ periodUnassignable: true, trackingSince: null }))
    ).toEqual({ kind: 'tracking', since: null, hadUnassignedSince: false })
  })
```

`src/main/__tests__/agentChangesScopedQuery.test.ts`:
- import に `import { summarizeAttribution } from '../agentChangesAttribution'` を足す
- `list` の行に `author: null` を足す（`{ path: 'a.txt', status: 'M', isDirectory: false, notRecorded: false, author: null }`）
- `describe('listAgentChangesInScope', ...)` の最後に足す:
```ts
  it('recording・scope-unavailable の結果に記録の区別の要約を入れる', async () => {
    const recording = await listAgentChangesInScope(record, { kind: 'all' })
    expect(recording).toMatchObject({ attribution: summarizeAttribution(record.attribution) })
    const unavailable = await listAgentChangesInScope(record, { kind: 'run', runId: 99 })
    expect(unavailable).toMatchObject({ attribution: summarizeAttribution(record.attribution) })
  })
```

`src/main/__tests__/helpers/agentBaselineFixtures.ts`:
- import に `import type { AgentChangesAttributionSummary } from '@shared/types'` を足す
- `makeAttributionOffDeps` の後に足す:
```ts
// makeAttributionOffDeps の registry が返す記録の区別の要約(区別をやめた記録〈receiver-unavailable〉。lostAt は始点の時刻、集合なし)。
// 区別を試さないテストの recording の状態・一覧の結果の期待値に使う
export function attributionOffSummary(startedAt: number): AgentChangesAttributionSummary {
  return {
    kind: 'lost',
    reason: 'receiver-unavailable',
    lostAt: startedAt,
    hadMarks: false,
    since: null,
    hadUnassignedSince: false
  }
}
```

`src/main/__tests__/agentBaselineRegistry.attribution.test.ts`:
- import に `import { summarizeAttribution } from '../agentChangesAttribution'` を足し、`entriesOf` の行に `author: null` を足す（`({ path, status: 'M', isDirectory: false, notRecorded: false, author: null })`）
- `describe('記録の区別の始め方(begin)', ...)` の最後に足す:
```ts
  it('begin・getState の記録中の状態に、記録の区別の要約を入れる', async () => {
    const h = setup({ phase: 'idle' })
    const begun = h.registry.begin(1, FOLDER, 'manual')
    ;(await snapshotCall(h, 0)).resolve(checkpointResult(0))
    const state = await begun
    const record = await h.registry.withRecord(1, FOLDER, async (r) => r)
    if (record === null) throw new Error('記録が無い')
    expect(state).toMatchObject({
      kind: 'recording',
      attribution: { kind: 'tracking', since: 100, hadUnassignedSince: false }
    })
    expect(h.registry.getState(1, FOLDER)).toMatchObject({
      attribution: summarizeAttribution(record.attribution)
    })
  })
```

`src/renderer/src/__tests__/makeAgentChangesState.ts`:
- import の `@shared/types` の型に `AgentChangesAttributionSummary` を足す
- `makeAgentChangeEntry` の前に足す:
```ts
/** 記録の区別の要約(tracking)。既定は区別をまだ始めていない(since null)・割り当てなかった間なし(区別していない記録と同じ文言になる) */
export function makeAgentChangesTrackingSummary(
  overrides: Partial<Omit<Extract<AgentChangesAttributionSummary, { kind: 'tracking' }>, 'kind'>> = {}
): AgentChangesAttributionSummary {
  return { kind: 'tracking', since: null, hadUnassignedSince: false, ...overrides }
}

/** 記録の区別の要約(lost)。既定は checkpoint-failed・lostAt 100・集合なし(区別していない)・since null */
export function makeAgentChangesLostSummary(
  overrides: Partial<Omit<Extract<AgentChangesAttributionSummary, { kind: 'lost' }>, 'kind'>> = {}
): AgentChangesAttributionSummary {
  return {
    kind: 'lost',
    reason: 'checkpoint-failed',
    lostAt: 100,
    hadMarks: false,
    since: null,
    hadUnassignedSince: false,
    ...overrides
  }
}
```
- `makeAgentChangeEntry` の説明を `一覧の行。既定は status 'M'・ファイル・記録済み・区別なし(author null)` にし、戻り値を `{ path, status: 'M', isDirectory: false, notRecorded: false, author: null, ...overrides }` にする
- `makeAgentChangesRecordingState`・`makeAgentChangesScopeUnavailableView`・`makeAgentChangesScopeUnavailableListResult` の `overrides` の型に `attribution?: AgentChangesAttributionSummary` を、`makeAgentChangesRecordingView` の `overrides` の型にも同じものを足し、分割代入に `attribution = makeAgentChangesTrackingSummary()` を足して戻り値に `attribution` を入れる（`makeAgentChangesRecordingView` は `undo` の後、ほかは `undo` の後）。`makeAgentChangesListResult` は分割代入に `attribution = makeAgentChangesTrackingSummary()` を足し、戻り値の `undo,` の次に `attribution,` を入れる（`overrides` の型は `Omit<…, 'kind' | 'entries'>` の `Partial` なので `attribution` を既に受ける）。各関数の説明の既定の並びに「区別の要約は区別していない tracking」を足す

`src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts`:
- import に `makeAgentChangesTrackingSummary`・`makeAgentChangesLostSummary` を足す
- `makeAgentChangeEntry` の 2 つのテストの期待値に `author: null` を足し、`makeAgentChangesRecordingView`・`makeAgentChangesRecordingState`・`makeAgentChangesScopeUnavailableView`・`makeAgentChangesListResult`・`makeAgentChangesScopeUnavailableListResult` の `toEqual` の期待値に `attribution: { kind: 'tracking', since: null, hadUnassignedSince: false }` を足す
- 末尾に足す:
```ts
describe('記録の区別の要約', () => {
  it('tracking の既定は区別をまだ始めていない。指定した項目だけを上書きする', () => {
    expect(makeAgentChangesTrackingSummary()).toEqual({
      kind: 'tracking',
      since: null,
      hadUnassignedSince: false
    })
    expect(makeAgentChangesTrackingSummary({ since: 5 })).toMatchObject({ since: 5 })
  })

  it('lost の既定は checkpoint-failed・lostAt 100・集合なし', () => {
    expect(makeAgentChangesLostSummary()).toEqual({
      kind: 'lost',
      reason: 'checkpoint-failed',
      lostAt: 100,
      hadMarks: false,
      since: null,
      hadUnassignedSince: false
    })
  })

  it('写し・状態・一覧の結果の工場は区別の要約を上書きできる', () => {
    const attribution = makeAgentChangesLostSummary({ hadMarks: true })
    expect(makeAgentChangesRecordingView([], { attribution })).toMatchObject({ attribution })
    expect(makeAgentChangesRecordingState({ attribution })).toMatchObject({ attribution })
    expect(makeAgentChangesListResult([], { attribution })).toMatchObject({ attribution })
  })
})
```

`src/renderer/src/lib/__tests__/agentChangesView.test.ts`:
- import に `makeAgentChangesLostSummary` を足す
- `describe('isSameAgentChangesView', ...)` の最後に足す:
```ts
  it('行の author・記録の区別の要約が違えば違う(静かな取り直しで印・区別の状態の 1 行の変化を見落とさない。L-423)', () => {
    expect(
      isSameAgentChangesView(view(), view([makeAgentChangeEntry('a.txt', { author: 'user' })]))
    ).toBe(false)
    expect(
      isSameAgentChangesView(
        view(),
        view(undefined, { attribution: makeAgentChangesLostSummary() })
      )
    ).toBe(false)
  })
```
- 末尾に足す:
```ts
describe('記録の区別の要約の写し', () => {
  const attribution = makeAgentChangesLostSummary({ hadMarks: true })

  it('記録中の状態の attribution を写しへ写す(同じ記録で一覧を残すときも、要約は新しい状態のものにする)', () => {
    const previous = makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
    const plan = planRecordingState(previous, makeAgentChangesRecordingState({ attribution }), {
      kind: 'all'
    })
    expect(plan.view.list).not.toBeNull()
    expect(plan.view.attribution).toBe(attribution)
  })

  it('一覧の結果(取れた一覧・範囲の一覧を出せない・実行が消えていた)の attribution を写しへ写す', () => {
    const listed = planListResult(makeAgentChangesListResult([], { attribution }), {
      kind: 'none'
    })
    expect(listed.kind === 'listed' ? listed.view.attribution : undefined).toBe(attribution)
    const unavailable = planListResult(
      makeAgentChangesScopeUnavailableListResult({ kind: 'run', runId: 1 }, 'end-not-recorded', {
        attribution
      }),
      { kind: 'none' }
    )
    expect(unavailable.kind === 'scope-unavailable' ? unavailable.view.attribution : undefined).toBe(
      attribution
    )
    const missing = planListResult(
      makeAgentChangesScopeUnavailableListResult({ kind: 'run', runId: 1 }, 'run-missing', {
        attribution
      }),
      { kind: 'none' }
    )
    expect(missing.kind === 'run-missing' ? missing.view.attribution : undefined).toBe(attribution)
  })
})
```

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `npx vitest run src/shared/__tests__/agentChanges.test.ts src/main/__tests__/agentChangesAttribution.test.ts src/main/__tests__/agentChangesScopedQuery.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/renderer/src/lib/__tests__/agentChangesView.test.ts src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts`
Expected: FAIL（`isAgentRevertAllTarget` が無い・`summarizeAttribution` が今の区間の印を見ない・結果に `attribution` が無い・写しが `attribution` を持たない）

- [ ] **Step 3: 型と main・renderer を実装する**

`src/shared/types/agentChanges.ts`:
- `AgentChangeEntry` の最後（`notRecorded` の後）に足す:
```ts
  /**
   * 行の区別(累積の一覧で main の registry が付ける。設計書「行の author」)。null は区別していない(実行の範囲の一覧・区別を始める前の記録・
   * hooks の無い記録・notRecorded の行)。main の一覧の関数はすべての行を null で作る
   */
  author: AgentChangeAuthor | null
```
- `AgentChangeAuthor` の説明を `/** 一覧の行の区別。user: 利用者の変更、mixed: 利用者の変更を含む(両方が変えた)、agent: エージェントの変更 */` に直す
- `AgentChangesAttributionSummary` の説明を `/** 記録の区別の要約(AgentChangesState・AgentChangesListResult に載せる)。since は区別を始めた時刻、hadMarks は集合が空でないか */` に直す
- `AgentChangesState` の `recording` の型の `undo: AgentChangesUndoSummary | null` の次に足し、その上の説明の末尾に「attribution は記録の区別の要約」を足す:
```ts
      attribution: AgentChangesAttributionSummary
```
- `AgentChangesListResult` の `recording`・`scope-unavailable` の型の `undo: AgentChangesUndoSummary | null` の次に、同じく `attribution: AgentChangesAttributionSummary` を足し、説明の「実行の一覧・取り消しの控えの要約(無ければ null)と、一覧を取った範囲を添える」を「実行の一覧・取り消しの控えの要約(無ければ null)・記録の区別の要約と、一覧を取った範囲を添える」に直す
- `AgentChangeAuthor` の定義の後に足す:
```ts
/**
 * すべて戻すの対象か(利用者の変更・利用者の変更を含む行は戻さない)。確認の一覧(renderer の useAgentChangesRevert)と実行時の照合
 * (main の revertAllAgentChanges)が同じ定義を使う(L-036)
 */
export function isAgentRevertAllTarget(entry: Pick<AgentChangeEntry, 'author'>): boolean {
  return entry.author !== 'user' && entry.author !== 'mixed'
}
```

`src/shared/types.ts` の `from './types/agentChanges'` の値の再公開の並びに `isAgentRevertAllTarget,` を足す（`isAgentChangeStatus,` の次）。

`src/main/agentChangesQuery.ts`: 行を作る 9 か所（`collectAgentChangeEntries` の `tracked.map`・`others` の 3 つの `entries.push`・除外の `D` の `entries.push`、`excludedChangesBetween` の `result.push`、`skippedRepoChangesBetween` の `result.push`、`collectAgentChangeEntriesBetween` の 2 つの `add`）のオブジェクトの最後に `author: null` を足す（`grep -n 'notRecorded' src/main/agentChangesQuery.ts` で拾える、行を作る 9 か所。計画の時点の行番号は 162・170〈短縮形 `notRecorded }`〉・180・186・193・238・256・292・294 行。実装の前に今のコードで行番号を確かめる。124・126 行〈読み書き〉・コメントの行は対象外）。`collectAgentChangeEntries` の説明の末尾に「行の author はすべて null(区別は累積の一覧で registry が付ける)」を足す。

`src/main/agentChangesAttribution.ts` の `summarizeAttribution`:
- 説明を `/** IPC に載せる要約。tracking の hadUnassignedSince は、区別を始めた後で今の区間に印があるときも真にする(区間を閉じる同期がまだ走っていない窓で、確認の文言と区別の状態の 1 行が出なくなるのを塞ぐ。L-152) */` にする
- `tracking` の `hadUnassignedSince: attribution.hadUnassignedSince` を次にする:
```ts
      hadUnassignedSince:
        attribution.hadUnassignedSince ||
        (attribution.periodUnassignable && attribution.trackingSince !== null)
```

`src/main/agentBaselineRegistry.ts`:
- `import { attributionLogLine, initialAttribution } from './agentChangesAttribution'` に `summarizeAttribution` を足す
- `recordingState` の戻り値の `undo: summarizeAgentChangesUndo(record.undo)` の次に `attribution: summarizeAttribution(record.attribution)` を足す（その前の行の末尾に `,`）

`src/main/agentChangesScopedQuery.ts`:
- `import { summarizeAttribution } from './agentChangesAttribution'` を足す
- `common` の `undo: summarizeAgentChangesUndo(record.undo),` の次に `attribution: summarizeAttribution(record.attribution),` を足す（Task 3 で `attributeEntries` の後に求める形に直す）

`src/renderer/src/types.ts`:
- `@shared/types` の import の型に `AgentChangesAttributionSummary` を足す
- `AgentChangesView` の `recording` の型の `undo: AgentChangesUndoSummary | null` の次に `attribution: AgentChangesAttributionSummary` を足し、その上の説明の末尾に「attribution は main の記録の区別の要約」を足す

`src/renderer/src/lib/agentChangesView.ts`:
- `planRecordingState` の `view` の `undo: state.undo` の次に `attribution: state.attribution` を足す
- `planListResult` の `base` の `undo: result.undo` の次に `attribution: result.attribution` を足す
- `planListResult` の最後の分割代入に `attribution` を足し（`const { startedAt, runs, undo, attribution, scope, entries, totalCount, truncated, headChanged } = result`）、`view` の `undo` の次に `attribution` を足す
- 先頭の説明の「main の応答(状態・一覧)を記録の写し(AgentChangesView)へどう反映するかの規則」の後に「(記録の区別の要約 attribution も写す)」を足す

- [ ] **Step 4: 型に追随する既存のテストを直す**

まず `npm run typecheck` を流し、型の誤りが出たテストを直す。次に `npm test` を流し、`toEqual` の期待値が `author`・`attribution` の分だけ違って落ちたテストを直す。直し方は次の規則に限る（期待値の意味は変えない）:

- 行（`AgentChangeEntry`）のオブジェクトの書き下し・行を作る補助には `author: null` を足す。対象（計画の時点の `grep -rn 'notRecorded' src --include=*.test.ts` から）: `src/main/__tests__/agentChangesQuery.integration.test.ts` の `entry`（`({ path, status, isDirectory: false, notRecorded: false, author: null, ...extra })`）、`src/main/__tests__/agentChangesRuns.integration.test.ts` の `entry`（同じ）、`src/main/__tests__/agentChangesRevert.integration.test.ts` の行の書き下し（`.env`・`.gitignore`・`node_modules/`・`local.db`・`big.bin`・`moved.bin`・`build/cache/`・`build/new.txt` の `toEqual`、`.env` の `toContainEqual`、`new.txt` の `toEqual`）、`src/main/__tests__/agentChangesAttribution.test.ts` の `entry`、`src/main/__tests__/agentChangesAttributionSync.test.ts` の `entry`、`src/main/__tests__/handlers/agentChangesHandlers.test.ts` の `listAgentChanges` の `mockResolvedValue` と `agentChanges:list` の期待値の行、`src/renderer/src/hooks/__tests__/useAgentChanges.test.ts` の行の書き下し（80 行目付近）。`src/main/__tests__/discardBatch.test.ts` の `actual`（型を付けていない照合の入力）は変えない
- main の `kind: 'recording'`（と `kind: 'scope-unavailable'`）の状態・一覧の結果の `toEqual` の期待値には、区別を試さない registry（`makeAttributionOffDeps`）なら `attribution: attributionOffSummary(<その期待値の startedAt>)` を足す（import に `attributionOffSummary` を足す）。対象: `src/main/__tests__/agentBaselineRegistry.test.ts`（`grep -n "kind: 'recording'" src/main/__tests__/agentBaselineRegistry.test.ts` に当たる期待値。`const expected = { ... }` の形のものも同じ）、`src/main/__tests__/handlers/agentChangesHandlers.test.ts`（`begin`・`getState`・`list` の `toEqual`。`startedAt` は 42）
- renderer の写し・状態の `toEqual` の期待値には `attribution: makeAgentChangesTrackingSummary()`（写しの元が既定の工場のとき）を足す（import に `makeAgentChangesTrackingSummary` を足す）。対象: `src/renderer/src/hooks/__tests__/useAgentChanges.test.ts` の `result.current.view` の `toEqual`（8 か所）、`src/renderer/src/lib/__tests__/agentChangesApi.test.ts` の `beginAgentChanges` の `toEqual`、`src/renderer/src/lib/__tests__/agentChangesView.test.ts` の `plan.view`・`planListResult` の `toEqual`（4 か所）。`toMatchObject` の期待値は直さない
- `src/main/__tests__/helpers/agentBaselineFixtures.test.ts` の末尾に、`attributionOffSummary` のテストを足す:
```ts
describe('attributionOffSummary', () => {
  it('makeAttributionOffDeps の registry の記録の区別の要約(receiver-unavailable・lostAt は始点の時刻・集合なし)', () => {
    expect(attributionOffSummary(42)).toEqual({
      kind: 'lost',
      reason: 'receiver-unavailable',
      lostAt: 42,
      hadMarks: false,
      since: null,
      hadUnassignedSince: false
    })
  })
})
```
（import に `attributionOffSummary` を足す）

- [ ] **Step 5: 通す**

Run: `npx vitest run src/shared/__tests__/agentChanges.test.ts src/main/__tests__/agentChangesAttribution.test.ts src/main/__tests__/agentChangesScopedQuery.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/renderer/src/lib/__tests__/agentChangesView.test.ts src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts src/renderer/src/hooks/__tests__/useAgentChanges.test.ts`
Expected: PASS
Run: `npm test`
Expected: PASS（時間切れで落ちたファイルは単体で流し直す。`author`・`attribution` の分の期待値の違いで落ちたものは Step 4 の規則で直す）
Run: `npm run typecheck`
Expected: PASS
Run: `git diff --name-only -- '*.ts' '*.tsx'` で変えた TypeScript のファイルを列挙し、`npx eslint --fix <列挙したファイル> && npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし
Run: `git diff --stat -- src/renderer/src/components src/renderer/src/lib/agentChangesMessages.ts src/renderer/src/lib/agentChangesAvailability.ts src/renderer/src/hooks/useAgentChangesRevert.ts`
Expected: 何も出ない（画面・文言・戻す操作はこのタスクでは変えない）

- [ ] **Step 6: 変異で確かめる**

1. `summarizeAttribution` の `|| (attribution.periodUnassignable && attribution.trackingSince !== null)` を外し、`npx vitest run src/main/__tests__/agentChangesAttribution.test.ts` の「tracking の hadUnassignedSince は、区別を始めた後で今の区間に印があるときも真…」が落ちることを確かめて戻す
2. `planRecordingState` の `attribution: state.attribution` を `attribution: sameRecording?.attribution ?? state.attribution` にし、`npx vitest run src/renderer/src/lib/__tests__/agentChangesView.test.ts` の「記録中の状態の attribution を写しへ写す(同じ記録で一覧を残すときも…)」が落ちることを確かめて戻す
3. `isAgentRevertAllTarget` の `&& entry.author !== 'mixed'` を外し、「author が mixed なら false」が落ちることを確かめて戻す
4. 戻したことを `git diff` で確かめる

- [ ] **Step 7: コミット（利用者の指示があるときだけ）**

`git diff --name-only` と `git status --short` で、このタスクで変えたファイルだけを確かめてから:
```bash
git add src/shared/types/agentChanges.ts src/shared/types.ts src/main/agentChangesQuery.ts src/main/agentChangesAttribution.ts src/main/agentBaselineRegistry.ts src/main/agentChangesScopedQuery.ts src/renderer/src/types.ts src/renderer/src/lib/agentChangesView.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/renderer/src/__tests__/makeAgentChangesState.ts <Step 4 で直したテストのファイル>
git commit -m "feat: 一覧の行の author と記録の区別の要約を IPC の結果と写しに載せる"
```

---

### Task 3: 一覧の `author` と `すべて戻す` の絞り込み（main。`collectCurrent`・`currentPeriodPaths`・`attributeEntries`・`listAgentChangesInScope`・`revertAllAgentChanges`・handler・配線）

> **気をつける知見:** L-002・L-424（今の区間の比較の失敗・予期しない例外を「今の区間なし」として黙らせず `lost` にし、一覧は失敗にしない）・L-040（今の区間も合図を確かめてから割り当てる）・L-036・L-058・L-063（除く規則を shared の関数で行い、照合と同じ流れの中で絞る）・L-060（`collectCurrent`・`attributeEntries` を必須にし、組み立てを同一性で確かめる）・L-061（`list` の累積だけが `author` を付ける）・L-446（`attributeEntries` は待たない・並べ直さない）・L-449（`すべて戻す` の `attributeEntries` が吸収の中で呼ばれる順を配列で固定する）・L-450（予期しない例外のログは `attributionWarn`）・L-440（実 git は使う `describe` の中だけ）

この時点で一覧の行に `author` が載るが、renderer は印・文言をまだ変えない。`すべて戻す` は renderer が全行を `expected` に送るため、`user`・`mixed` の行があると main の照合で中止される（Task 4 で直す。Task 3 と 4 は同じ PR に入る）。

**Files:**
- Modify: `src/main/agentChangesAttributionSync.ts`（`AttributionSyncContext.collectCurrent`・`currentPeriodPaths`）
- Modify: `src/main/agentBaselineRegistry.ts`（依存 `collectCurrent`・`attributionContextOf`・`attributeEntries`）
- Modify: `src/main/agentChangesScopedQuery.ts`（3 つ目の引数 `attributeEntries`・要約の順）
- Modify: `src/main/agentChangesRevert.ts`（`AgentRevertContext.attributeEntries`・`revertAllAgentChanges` の絞り込み）
- Modify: `src/main/handlers/agentChangesHandlers.ts`（`Pick` の `attributeEntries`・`agentChanges:list`・`revertContextOf(ownerId, record)`）
- Modify: `src/main/ipcHandlers.ts`（`collectCurrent: collectAgentChangeEntries`）
- Modify: `src/main/__tests__/helpers/agentBaselineFixtures.ts`（`AttributionRegistryDeps`・`makeAttributionOffDeps` の `collectCurrent`）
- Test: `src/main/__tests__/agentChangesAttributionSync.test.ts`・`src/main/__tests__/agentBaselineRegistry.attribution.test.ts`・`src/main/__tests__/agentChangesScopedQuery.test.ts`・`src/main/__tests__/agentChangesRevert.integration.test.ts`・`src/main/__tests__/agentChangesRevert.toctou.integration.test.ts`・`src/main/__tests__/agentChangesUndo.integration.test.ts`・`src/main/__tests__/handlers/agentChangesHandlers.test.ts`・`src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`・`src/main/__tests__/agentChangesAttribution.integration.test.ts`・`src/main/__tests__/ipcHandlers.test.ts`・`src/main/__tests__/helpers/agentBaselineFixtures.test.ts`

**Interfaces:**
- Consumes: Task 1 の `currentPeriodTracking`・`checkSignalBeforePeriod`（非公開）、Task 2 の `AgentChangeEntry.author`・`isAgentRevertAllTarget`・`summarizeAttribution`、B-1 の `authorsOf(entries, attribution, currentPaths)`・`markAttributionLost`・`loseAfterUnexpectedError(ctx)`・registry の `attributionContextOf`（非公開）・`logAttribution`（非公開）
- Produces:
```ts
// src/main/agentChangesAttributionSync.ts
export interface AttributionSyncContext {
  // (既存の項目に加えて)
  /** 判定の区切り → 作業ツリーの行(agentChangesQuery の collectAgentChangeEntries。打ち切らない)。今の区間の比較に使う */
  collectCurrent: (snapshot: BaselineSnapshot) => Promise<AgentChangeEntry[]>
}
export async function currentPeriodPaths(
  ctx: AttributionSyncContext,
  entries: readonly AgentChangeEntry[]
): Promise<string[] | 'lost' | null>

// src/main/agentBaselineRegistry.ts
export interface AgentBaselineRegistryDeps {
  // (既存の項目に加えて)
  collectCurrent: (snapshot: BaselineSnapshot) => Promise<AgentChangeEntry[]>
}
// AgentBaselineRegistry
attributeEntries(ownerId: number, record: AgentChangesRecord, entries: AgentChangeEntry[]): Promise<AgentChangeEntry[]>

// src/main/agentChangesScopedQuery.ts
export async function listAgentChangesInScope(
  record: AgentChangesRecord,
  scope: AgentChangesScope,
  attributeEntries: (entries: AgentChangeEntry[]) => Promise<AgentChangeEntry[]>
): Promise<AgentChangesListResult>

// src/main/agentChangesRevert.ts
export interface AgentRevertContext {
  snapshot: BaselineSnapshot
  trash: (absolutePath: string) => Promise<void>
  gitOptions?: BaselineGitOptions
  undoCapture: AgentChangesUndoCaptureOptions
  attributeEntries: (entries: AgentChangeEntry[]) => Promise<AgentChangeEntry[]>
}

// src/main/__tests__/helpers/agentBaselineFixtures.ts
export type AttributionRegistryDeps = Pick<
  AgentBaselineRegistryDeps,
  'collectBetween' | 'collectCurrent' | 'attributionSource' | 'attributionDevLog' | 'attributionWarn'
>
```

- [ ] **Step 1: 失敗するテストを書く（`currentPeriodPaths`）**

`src/main/__tests__/agentChangesAttributionSync.test.ts`:
- import の `../agentChangesAttributionSync` に `currentPeriodPaths` を足す
- `ContextOptions` に `/** 今の区間の比較(collectCurrent)の結果 */ current?: () => Promise<AgentChangeEntry[]>` を足し、`contextOf` の分割代入に `current = async () => []` を、戻り値の `collectBetween: vi.fn(collect),` の次に `collectCurrent: vi.fn(current),` を足す
- 末尾に足す:
```ts
describe('currentPeriodPaths(今の区間のパス)', () => {
  /** 始点を判定の区切りにしたまま(共有)の、段階 idle の記録 */
  const sharedRecord = (): AgentChangesRecord => makeAgentChangesRecord([], { baseline })

  it('区切りが始点と共有なら、渡された累積の行のパスを返す(collectCurrent を呼ばない)', async () => {
    const record = sharedRecord()
    const ctx = contextOf(record, { signal: signalOf('idle') })
    expect(await currentPeriodPaths(ctx, [entry('a.txt'), entry('new/')])).toEqual([
      'a.txt',
      'new/'
    ])
    expect(ctx.collectCurrent).not.toHaveBeenCalled()
  })

  it('区切りが始点と共有でなければ、その区切りから作業ツリーまでの行(collectCurrent)のパスを返す', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, {
      signal: signalOf('idle'),
      current: async () => [entry('c.txt')]
    })
    expect(await currentPeriodPaths(ctx, [entry('a.txt')])).toEqual(['c.txt'])
    expect(ctx.collectCurrent).toHaveBeenCalledExactlyOnceWith(checkpoint)
  })

  it('合図が lost なら、比べずに合図の理由で lost にして lost を返す', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, { signal: signalOf('idle', { lost: 'hooks-not-confirmed' }) })
    expect(await currentPeriodPaths(ctx, [entry('a.txt')])).toBe('lost')
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'hooks-not-confirmed' })
    expect(ctx.collectCurrent).not.toHaveBeenCalled()
  })

  it.each<[string, AgentToolActivitySignal]>([
    ['合図の段階が記録の段階と違う', signalOf('agent')],
    ['合図の unassignable が立っている', signalOf('idle', { unassignable: true })]
  ])(
    '%s なら、今の区間に印を立てて比べない(記録の古い段階で割り当てない。L-040)',
    async (_label, signal) => {
      const record = sharedRecord()
      const ctx = contextOf(record, { signal })
      expect(await currentPeriodPaths(ctx, [entry('a.txt')])).toBeNull()
      expect(trackingOf(record).periodUnassignable).toBe(true)
      expect(ctx.collectCurrent).not.toHaveBeenCalled()
    }
  )

  it('今の区間に印がある・区別をやめた記録なら比べない', async () => {
    const marked = recordWithCheckpoint()
    trackingOf(marked).periodUnassignable = true
    const markedCtx = contextOf(marked, { signal: signalOf('idle') })
    expect(await currentPeriodPaths(markedCtx, [entry('a.txt')])).toBeNull()
    expect(markedCtx.collectCurrent).not.toHaveBeenCalled()
    const lostRecord = recordWithCheckpoint()
    await markAttributionLost(lostRecord, 'checkpoint-failed', {
      now: () => 300,
      removeDir: async () => undefined
    })
    expect(
      await currentPeriodPaths(contextOf(lostRecord, { signal: signalOf('idle') }), [])
    ).toBeNull()
  })

  it('比較に失敗したら、区別をやめて(lost・checkpoint-failed)lost を返す(空の今の区間にしない。L-002)', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, {
      signal: signalOf('idle'),
      current: async () => {
        throw new Error('記録が見つかりません')
      }
    })
    expect(await currentPeriodPaths(ctx, [entry('a.txt')])).toBe('lost')
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'checkpoint-failed' })
    expect(ctx.removed).toEqual(['/tmp/cp-1'])
  })

  it('比べている間に記録が古くなったら、失敗しても区別をやめずに null を返す', async () => {
    const record = recordWithCheckpoint()
    let stale = false
    const ctx = contextOf(record, {
      signal: signalOf('idle'),
      stale: () => stale,
      current: async () => {
        stale = true
        throw new Error('記録が見つかりません')
      }
    })
    expect(await currentPeriodPaths(ctx, [entry('a.txt')])).toBeNull()
    expect(record.attribution.kind).toBe('tracking')
  })

  it('始めから古い記録なら、合図を読まずに null を返す(記録の印を変えない)', async () => {
    const record = sharedRecord()
    const ctx = contextOf(record, {
      signal: signalOf('agent', { unassignable: true }),
      stale: () => true
    })
    expect(await currentPeriodPaths(ctx, [entry('a.txt')])).toBeNull()
    expect(trackingOf(record).periodUnassignable).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（registry の `attributeEntries`）**

`src/main/__tests__/agentBaselineRegistry.attribution.test.ts`:
- import の `@shared/types` を `import type { AgentChangeAuthor, AgentChangeEntry } from '@shared/types'` にする
- `Harness` に `collectCurrent: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['collectCurrent']>>` を足し、`setup` で `const collectCurrent = vi.fn<AgentBaselineRegistryDeps['collectCurrent']>(async () => [])` を作って registry の依存（`collectBetween,` の次）と戻り値に入れる
- `entriesOf` の後に足す:
```ts
/** 列の中で一覧の行に author を付ける(handler の agentChanges:list と同じ)。行の author の並びを返す */
async function authorsOfList(
  h: Harness,
  entries: AgentChangeEntry[]
): Promise<(AgentChangeAuthor | null)[]> {
  const result = await h.registry.withRecord(1, FOLDER, (record) =>
    h.registry.attributeEntries(1, record, entries)
  )
  if (result === null) throw new Error('記録が無い')
  return result.map((entry) => entry.author)
}
```
- `describe('戻した操作の取り消しの吸収(undoLastRevert)', ...)` の後（ファイルの末尾）に足す:
```ts
describe('一覧の行の author(attributeEntries)', () => {
  it('区別をまだ始めていない記録(paused で始めた)は、すべて null', async () => {
    const h = setup({ phase: 'paused' })
    await startRecord(h)
    expect(await authorsOfList(h, entriesOf('a.txt'))).toEqual([null])
  })

  it('idle の今の区間(区切りが始点と共有)の行は user。比較は渡した行で行い、collectCurrent を呼ばない', async () => {
    const h = setup()
    await startRecord(h)
    expect(await authorsOfList(h, entriesOf('u.txt', 'v.txt'))).toEqual(['user', 'user'])
    expect(h.collectCurrent).not.toHaveBeenCalled()
  })

  it('agent の今の区間の行は agent、閉じた区間で利用者の集合に入ったパスも今の区間にあれば mixed(区切りからの行は collectCurrent で求める)', async () => {
    const h = setup()
    await startRecord(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('m.txt'))
    const waited = toolStarts(h)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await waited
    h.collectCurrent.mockResolvedValueOnce(entriesOf('m.txt', 't.txt'))
    expect(await authorsOfList(h, entriesOf('m.txt', 't.txt', 'x.txt'))).toEqual([
      'mixed',
      'agent',
      'agent'
    ])
    expect(h.collectCurrent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tempDir: '/tmp/cp-1' })
    )
  })

  it('今の区間の比較に失敗したら、区別をやめて(lost・checkpoint-failed)集合だけで付け、開発版のログに lost を出す(一覧は失敗にしない。L-002・L-424)', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('m.txt'))
    const waited = toolStarts(h)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await waited
    h.collectCurrent.mockRejectedValueOnce(new Error('記録が見つかりません'))
    expect(await authorsOfList(h, entriesOf('m.txt', 't.txt'))).toEqual(['user', 'agent'])
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'checkpoint-failed' })
    expect(h.devLog).toHaveBeenLastCalledWith(
      '[agent-attribution] owner=1 event=lost phase=agent→- user=1 agent=0 unassignable=なし reason=checkpoint-failed'
    )
    expect(h.warn).not.toHaveBeenCalled()
  })

  it('手順の予期しない例外は、注入した失敗のログに出して区別をやめ、今の区間なしで付ける(投げない。L-450)', async () => {
    const h = setup()
    const record = await startRecord(h)
    const err = new Error('予期しない失敗')
    h.source.activityOf = () => {
      throw err
    }
    expect(await authorsOfList(h, entriesOf('a.txt'))).toEqual([null])
    expect(h.warn).toHaveBeenCalledExactlyOnceWith(
      '[agent-attribution] 一覧の区別に失敗しました:',
      err
    )
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'checkpoint-failed' })
    expect(h.devLog).toHaveBeenLastCalledWith(
      '[agent-attribution] owner=1 event=lost phase=idle→- user=0 agent=0 unassignable=なし reason=checkpoint-failed'
    )
  })

  it('段階の変化の同期より先に一覧が列で走ると、今の区間に印を立てて割り当てない(利用者の変更と誤らない。待たない)', async () => {
    const h = setup()
    const record = await startRecord(h)
    // 段階は agent に変わったが、通知(同期)はまだ届いていない
    h.source.set({ phase: 'agent' })
    expect(await authorsOfList(h, entriesOf('u.txt'))).toEqual(['agent'])
    expect(record.attribution).toMatchObject({ phase: 'idle', periodUnassignable: true })
    expect(h.calls).toHaveLength(1)
  })

  it('渡した配列と行を変えず、author を入れた新しい配列を返す', async () => {
    const h = setup()
    await startRecord(h)
    const input = entriesOf('u.txt')
    const result = await h.registry.withRecord(1, FOLDER, (record) =>
      h.registry.attributeEntries(1, record, input)
    )
    expect(result).not.toBe(input)
    expect(result?.[0]).toEqual({ ...input[0], author: 'user' })
    expect(input[0].author).toBeNull()
  })
})
```

`src/main/__tests__/helpers/agentBaselineFixtures.test.ts` の `describe('makeAttributionOffDeps', ...)` のテストの `await expect(deps.collectBetween(snapshot, snapshot)).resolves.toEqual([])` の次の行に足す:
```ts
    await expect(deps.collectCurrent(snapshot)).resolves.toEqual([])
```

- [ ] **Step 3: 失敗するテストを書く（範囲の一覧・すべて戻す）**

`src/main/__tests__/agentChangesScopedQuery.test.ts`:
- import に `import type { AgentChangeEntry } from '@shared/types'` を足す（既存の `import type { AgentChangesList } from '@shared/types'` とまとめる）
- `list` の定義の後に足す:
```ts
// 行を変えずに返す attributeEntries(区別を試さないテストで使う)
const keepEntries = vi.fn<(entries: AgentChangeEntry[]) => Promise<AgentChangeEntry[]>>(
  async (entries) => entries
)
```
- 既存のすべての `listAgentChangesInScope(<記録>, <範囲>)` の呼び出しに 3 つ目の引数 `keepEntries` を足す
- `describe('listAgentChangesInScope', ...)` の最後に足す:
```ts
  it('累積だけ一覧の行を attributeEntries に通し、その結果の行を返す(件数・打ち切り・HEAD はそのまま)', async () => {
    const authored: AgentChangeEntry[] = [{ ...list.entries[0], author: 'user' }]
    const attributeEntries = vi.fn(async () => authored)
    const result = await listAgentChangesInScope(record, { kind: 'all' }, attributeEntries)
    expect(attributeEntries).toHaveBeenCalledExactlyOnceWith(list.entries)
    expect(result).toMatchObject({ kind: 'recording', entries: authored, totalCount: 1 })
  })

  it.each([
    ['最後の実行', 3],
    ['途中の実行', 1]
  ])('実行の範囲(%s)は attributeEntries を呼ばず、行の author は null のまま', async (_label, runId) => {
    const attributeEntries = vi.fn(async (entries: AgentChangeEntry[]) => entries)
    const result = await listAgentChangesInScope(record, { kind: 'run', runId }, attributeEntries)
    expect(attributeEntries).not.toHaveBeenCalled()
    expect(result.kind === 'recording' && result.entries.map((entry) => entry.author)).toEqual([
      null
    ])
  })

  it('一覧の今の区間の比較で記録が lost になったら、同じ結果の要約も lost(要約は attributeEntries の後に求める)', async () => {
    const fresh = makeAgentChangesRecord([], { baseline })
    const attributeEntries = vi.fn(async (entries: AgentChangeEntry[]) => {
      // markAttributionLost と同じ置き換え
      fresh.attribution = {
        kind: 'lost',
        reason: 'checkpoint-failed',
        lostAt: 300,
        userPaths: new Set(),
        agentPaths: new Set(),
        trackingSince: 100,
        hadUnassignedSince: false,
        staleCheckpointDirs: []
      }
      return entries
    })
    const result = await listAgentChangesInScope(fresh, { kind: 'all' }, attributeEntries)
    expect(result).toMatchObject({
      attribution: { kind: 'lost', reason: 'checkpoint-failed', lostAt: 300 }
    })
  })
```

`src/main/__tests__/agentChangesRevert.integration.test.ts`:
- import の `vitest` に `vi` を足し、`import type { AgentChangeAuthor, AgentChangeEntry } from '@shared/types'` を足す
- `record` の戻り値に `attributeEntries: async (entries) => entries` を足す（区別を試さないテストは行を変えない）
- ファイルの末尾に足す:
```ts
describe('revertAllAgentChanges の利用者の変更の除外(実 git・偽の attributeEntries)', () => {
  const authors: Record<string, AgentChangeAuthor> = {
    'a.txt': 'user',
    'b.txt': 'agent',
    'c.txt': 'mixed'
  }
  const attributeByPath = vi.fn(async (entries: AgentChangeEntry[]) =>
    entries.map((entry) => ({ ...entry, author: authors[entry.path] ?? null }))
  )
  // a.txt は利用者の変更、b.txt はエージェントの変更、c.txt は両方、new.txt は区別していない行
  const setup = async (): Promise<AgentRevertContext> => {
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    write('c.txt', 'c\n')
    commitAll(repo, 'init')
    const context = { ...(await record()), attributeEntries: attributeByPath }
    write('a.txt', 'a\nuser\n')
    write('b.txt', 'b\nagent\n')
    write('c.txt', 'c\nboth\n')
    write('new.txt', 'n\n')
    return context
  }

  beforeEach(() => attributeByPath.mockClear())

  it('user・mixed の行を戻さず、agent・null の行だけを戻す(除く規則を外すとこのテストが落ちる)', async () => {
    const context = await setup()
    await expect(
      revertAllAgentChanges(context, [
        { path: 'b.txt', status: 'M' },
        { path: 'new.txt', status: 'A' }
      ])
    ).resolves.toMatchObject({ status: 'done', applied: 2 })
    expect(read('a.txt')).toBe('a\nuser\n')
    expect(read('c.txt')).toBe('c\nboth\n')
    expect(read('b.txt')).toBe('b\n')
    expect(trashed).toEqual([join(repo, 'new.txt')])
  })

  it('確認の一覧に user の行を含めると、何も変えずに中止する', async () => {
    const context = await setup()
    await expect(
      revertAllAgentChanges(context, [
        { path: 'a.txt', status: 'M' },
        { path: 'b.txt', status: 'M' },
        { path: 'new.txt', status: 'A' }
      ])
    ).rejects.toThrow(AGENT_REVERT_ALL_MISMATCH_MESSAGE)
    expect(read('b.txt')).toBe('b\nagent\n')
    expect(trashed).toEqual([])
  })

  it('件数の上限は除く前の件数で検査し、上限を超えたら author を求めない', async () => {
    write('many/keep.txt', 'k\n')
    commitAll(repo, 'init')
    const context = { ...(await record()), attributeEntries: attributeByPath }
    for (let i = 0; i < 501; i++) write(`many/${i}.txt`, '')
    await expect(revertAllAgentChanges(context, [])).rejects.toThrow(
      AGENT_REVERT_ALL_TOO_MANY_MESSAGE
    )
    expect(attributeByPath).not.toHaveBeenCalled()
  })

  it('対象が 0 件(すべて利用者の変更)で確認の一覧も空なら、何も変えずに applied 0 で終わる(古い写しからの依頼でも変えない。L-058)', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const context: AgentRevertContext = {
      ...(await record()),
      attributeEntries: async (entries) => entries.map((entry) => ({ ...entry, author: 'user' }))
    }
    write('a.txt', 'a\nuser\n')
    await expect(revertAllAgentChanges(context, [])).resolves.toMatchObject({
      status: 'done',
      applied: 0
    })
    expect(read('a.txt')).toBe('a\nuser\n')
    expect(trashed).toEqual([])
  })
})
```

`src/main/__tests__/agentChangesRevert.toctou.integration.test.ts` と `src/main/__tests__/agentChangesUndo.integration.test.ts` の `record` の戻り値にも `attributeEntries: async (entries) => entries` を足す（型が必須になるため。振る舞いは変えない）。

- [ ] **Step 4: 失敗するテストを書く（handler・配線・実 git の結合）**

`src/main/__tests__/handlers/agentChangesHandlers.test.ts`:
- `revertAgentChange`・`revertAgentChangeHunk`・`revertAllAgentChanges` の `toHaveBeenCalledWith` の 1 つ目の引数 `{ snapshot: snapshotFor(folder), trash, undoCapture: UNDO_CAPTURE }`（3 か所）を `{ snapshot: snapshotFor(folder), trash, undoCapture: UNDO_CAPTURE, attributeEntries: expect.any(Function) }` にする
- `describe('範囲と実行', ...)` の `it('list は範囲を解決し、…', ...)` の後に足す:
```ts
  it('list は累積の範囲でだけ、同じ所有者・記録で registry の attributeEntries に一覧の行を通し、その結果の行を返す', async () => {
    const run2 = runSnapshot(2)
    await twoRuns(recordedResult(run2))
    const row = {
      path: 'a.txt',
      status: 'M' as const,
      isDirectory: false,
      notRecorded: false,
      author: null
    }
    vi.mocked(listAgentChanges).mockResolvedValue({ ...emptyList, entries: [row], totalCount: 1 })
    const attribute = vi.spyOn(registry, 'attributeEntries')
    await expect(invoke('agentChanges:list', makeEvent(), ALL)).resolves.toMatchObject({
      entries: [row]
    })
    expect(attribute).toHaveBeenCalledOnce()
    const [ownerId, record, entries] = attribute.mock.calls[0]
    expect(ownerId).toBe(1)
    expect(record.baseline).toEqual(snapshotFor(folder))
    expect(entries).toEqual([row])
    // 最後の実行(作業ツリーとの比較)では付けない
    await invoke('agentChanges:list', makeEvent(), runScope(2))
    expect(attribute).toHaveBeenCalledOnce()
  })
```
- `describe('戻す操作の吸収(withAttributionAbsorbed)', ...)` の最後に足す:
```ts
  it('revertAll は、registry の attributeEntries を戻す関数の中(吸収の task の中・適用の前)で呼ぶ(吸収の外で先に呼ぶ形に崩れると落ちる。L-449)', async () => {
    await invoke('agentChanges:begin', makeEvent(), 'manual')
    const order: string[] = []
    const absorb = registry.withAttributionAbsorbed.bind(registry)
    vi.spyOn(registry, 'withAttributionAbsorbed').mockImplementation(
      async (...absorbArgs: Parameters<typeof absorb>) => {
        order.push('吸収の始まり')
        const result = await absorb(...absorbArgs)
        order.push('吸収の終わり')
        return result
      }
    )
    const attribute = registry.attributeEntries.bind(registry)
    vi.spyOn(registry, 'attributeEntries').mockImplementation(async (...attributeArgs) => {
      order.push('author')
      return attribute(...attributeArgs)
    })
    vi.mocked(revertAllAgentChanges).mockImplementationOnce(async (context) => {
      order.push('戻す関数の始まり')
      await context.attributeEntries([])
      order.push('適用')
      return { status: 'done', applied: 1, capture: { kind: 'unavailable', reason: 'too-large' } }
    })
    await invoke('agentChanges:revertAll', makeEvent(), [], ALL)
    expect(order).toEqual(['吸収の始まり', '戻す関数の始まり', 'author', '適用', '吸収の終わり'])
  })
```

`src/main/__tests__/ipcHandlers.test.ts`:
- `import { collectAgentChangeEntriesBetween } from '../agentChangesQuery'` を `import { collectAgentChangeEntries, collectAgentChangeEntriesBetween } from '../agentChangesQuery'` にする
- `it('記録の registry に、追跡(区別の合図と通し番号)・区切りの差分・…', ...)` の題を `記録の registry に、追跡(区別の合図と通し番号)・区切りの差分・今の区間の比較・開発版の区別のログ(app.isPackaged でないとき)・失敗のログ(console.warn)を渡す` にし、`expect(deps.collectBetween).toBe(collectAgentChangeEntriesBetween)` の次の行に足す:
```ts
    expect(deps.collectCurrent).toBe(collectAgentChangeEntries)
```

`src/main/__tests__/agentChangesAttribution.integration.test.ts`:
- `import { collectAgentChangeEntriesBetween } from '../agentChangesQuery'` を `import { collectAgentChangeEntries, collectAgentChangeEntriesBetween } from '../agentChangesQuery'` にし、registry の依存の `collectBetween` の次に `collectCurrent: (snapshot) => collectAgentChangeEntries(snapshot),` を足す（型が必須になるため。振る舞いは変えない）

`src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`:
- `import { collectAgentChangeEntriesBetween } from '../../agentChangesQuery'` を `import { collectAgentChangeEntries, collectAgentChangeEntriesBetween } from '../../agentChangesQuery'` にし、`import { AGENT_REVERT_ALL_MISMATCH_MESSAGE } from '../../agentChangesRevert'` を足す
- `makeRegistry` の依存の `collectBetween` の次に `collectCurrent: (snapshot) => collectAgentChangeEntries(snapshot),` を足す
- ファイルの末尾に足す:
```ts
describe('記録の区別と一覧の author・すべて戻す(実 git)', () => {
  let source: FakeAttributionSource
  const change = (phase: 'idle' | 'agent'): void => {
    source.set({ phase })
    registry.notifyAttributionSignal(1)
  }
  // 並んでいる同期を走らせ終える(列の後ろに何もしないタスクを並べて待つ)
  const settled = async (): Promise<void> => {
    await registry.withRecord(1, repo, async () => undefined)
  }
  // 受け口と同じく、通し番号を進めて段階を agent にしてから区切りを待つ
  const toolStarts = async (): Promise<void> => {
    source.seq += 1
    change('agent')
    await registry.waitForAgentPhase(1, new AbortController().signal)
  }
  const authorsByPath = async (): Promise<Record<string, string | null>> => {
    const result = (await invoke('agentChanges:list', ALL)) as {
      entries: { path: string; author: string | null }[]
    }
    return Object.fromEntries(result.entries.map((entry) => [entry.path, entry.author]))
  }
  // idle の間に利用者が a.txt、agent の間にエージェントが b.txt・c.txt を変え、idle に戻った後(今の区間)に利用者が c.txt・d.txt を変える
  const userAndAgentChanges = async (): Promise<void> => {
    write('a.txt', 'user\n')
    await toolStarts()
    write('b.txt', 'agent\n')
    write('c.txt', 'agent\n')
    change('idle')
    await settled()
    write('c.txt', 'agent\nuser\n')
    write('d.txt', 'user\n')
  }

  beforeEach(async () => {
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    write('c.txt', 'c\n')
    commitAll(repo, 'init')
    source = createFakeAttributionSource({ phase: 'idle' })
    rebuildRegistry({}, source)
    await invoke('agentChanges:begin', 'manual')
  })

  it('idle の間の利用者の変更は user、agent の間のエージェントの変更は agent、両方は mixed。同期の前の今の区間の利用者の編集も user', async () => {
    await userAndAgentChanges()
    expect(await authorsByPath()).toEqual({
      'a.txt': 'user',
      'b.txt': 'agent',
      'c.txt': 'mixed',
      'd.txt': 'user'
    })
  })

  it('すべて戻すは user・mixed の行を戻さず agent の行だけを戻す。確認の一覧に user の行を含めると中止して何も変えない(除く規則を外すとこのテストが落ちる)', async () => {
    await userAndAgentChanges()
    await expect(
      invoke(
        'agentChanges:revertAll',
        [
          { path: 'a.txt', status: 'M' },
          { path: 'b.txt', status: 'M' }
        ],
        ALL
      )
    ).rejects.toThrow(AGENT_REVERT_ALL_MISMATCH_MESSAGE)
    expect(readRepoFile(repo, 'b.txt')).toBe('agent\n')
    await expect(
      invoke('agentChanges:revertAll', [{ path: 'b.txt', status: 'M' }], ALL)
    ).resolves.toMatchObject({ status: 'done', revertedCount: 1 })
    expect(readRepoFile(repo, 'a.txt')).toBe('user\n')
    expect(readRepoFile(repo, 'b.txt')).toBe('b\n')
    expect(readRepoFile(repo, 'c.txt')).toBe('agent\nuser\n')
    expect(readRepoFile(repo, 'd.txt')).toBe('user\n')
  })

  it('行の ↶ で戻した後にエージェントが同じファイルを書き直しても、一覧で mixed にならない(戻す操作は利用者の変更に数えない)', async () => {
    await toolStarts()
    write('a.txt', 'agent\n')
    change('idle')
    await settled()
    await invoke('agentChanges:revertFile', 'a.txt', ALL)
    expect(readRepoFile(repo, 'a.txt')).toBe('a\n')
    await toolStarts()
    write('a.txt', 'agent again\n')
    change('idle')
    await settled()
    expect(await authorsByPath()).toEqual({ 'a.txt': 'agent' })
  })

  it('判定の区切りの object が gc で消えて区別をやめた記録も、一覧は出て要約は lost(それまでの印は残る)', async () => {
    write('a.txt', 'user\n')
    await toolStarts()
    write('b.txt', 'agent\n')
    // 判定の区切りは保護の ref で守らない。次の区切り(写しの元は gc で消えた区切り)を取れずに区別をやめる
    runGit(repo, 'gc', '-q', '--prune=now')
    change('idle')
    await settled()
    const result = (await invoke('agentChanges:list', ALL)) as {
      kind: string
      attribution: unknown
      entries: { path: string; author: string | null }[]
    }
    expect(result).toMatchObject({
      kind: 'recording',
      attribution: { kind: 'lost', reason: 'checkpoint-failed', hadMarks: true }
    })
    expect(Object.fromEntries(result.entries.map((entry) => [entry.path, entry.author]))).toEqual({
      'a.txt': 'user',
      'b.txt': 'agent'
    })
  })
})
```

- [ ] **Step 5: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentChangesAttributionSync.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentChangesScopedQuery.test.ts src/main/__tests__/agentChangesRevert.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/ipcHandlers.test.ts`
Expected: FAIL（`currentPeriodPaths`・`attributeEntries`・`collectCurrent` が無い・`listAgentChangesInScope` が 3 つ目の引数を使わない・`revertAllAgentChanges` が絞り込まない）。`npm run typecheck` も `collectCurrent`・`attributeEntries` で落ちる

- [ ] **Step 6: 実装する**

`src/main/agentChangesAttributionSync.ts`:
- `import type { AgentChangesCheckpoint, TrackingAttribution } from './agentChangesAttribution'` の隣に `import { currentPeriodTracking } from './agentChangesAttribution'` を足す
- `AttributionSyncContext` の `collectBetween` の次に足す:
```ts
  /** 判定の区切り → 作業ツリーの行(agentChangesQuery の collectAgentChangeEntries。打ち切らない)。今の区間の比較に使う */
  collectCurrent: (snapshot: BaselineSnapshot) => Promise<AgentChangeEntry[]>
```
- ファイルの末尾に足す:
```ts
/**
 * 今の区間(最後の判定の区切り → 作業ツリー)のパス(設計書「行の author」1)。始めから古い記録・区別していない記録は何もせず null。
 * 始めに合図を確かめ(吸収の (1) と同じ部品)、lost なら記録を lost(合図の理由)にして 'lost'、段階の違い・合図の unassignable なら
 * 今の区間に印を立てて null(記録の古い段階で割り当てない。L-040)。印のある区間も null。区切りが始点と共有なら渡された累積の行
 * (打ち切った後の行でよい。行どうしの照合では各行が自分自身に一致する)のパス、そうでなければ collectCurrent の行のパス。
 * 比較の失敗は、記録が今の記録のままなら lost(checkpoint-failed)にして 'lost'(一覧は失敗にしない。L-002・L-424)、
 * 古くなっていれば記録を変えずに null。待ち・同期の並べ直しはしない(L-446)
 */
export async function currentPeriodPaths(
  ctx: AttributionSyncContext,
  entries: readonly AgentChangeEntry[]
): Promise<string[] | 'lost' | null> {
  const attribution = ctx.record.attribution
  if (attribution.kind !== 'tracking' || ctx.isStale()) return null
  const check = await checkSignalBeforePeriod(ctx, attribution)
  if (check === 'lost') return 'lost'
  const tracking = currentPeriodTracking(attribution)
  if (check === 'marked' || tracking === null) return null
  const { checkpoint } = tracking
  if (checkpoint.sharedWithBaseline) return entries.map((entry) => entry.path)
  let current: AgentChangeEntry[]
  try {
    current = await ctx.collectCurrent(checkpoint.snapshot)
  } catch {
    if (ctx.isStale()) return null
    await markAttributionLost(ctx.record, 'checkpoint-failed', ctx)
    return 'lost'
  }
  return ctx.isStale() ? null : current.map((entry) => entry.path)
}
```

`src/main/agentBaselineRegistry.ts`:
- `import { attributionLogLine, initialAttribution, summarizeAttribution } from './agentChangesAttribution'` に `authorsOf` を足し、`./agentChangesAttributionSync` の値の import に `currentPeriodPaths` を足す
- 先頭の説明の「区別:」の段落の末尾に「累積の一覧・すべて戻すの行の author は attributeEntries(列の中で呼ぶ)が今の区間を比べて付ける」を足す
- `AgentBaselineRegistryDeps` の `collectBetween` の次に足す:
```ts
  /** 判定の区切り → 作業ツリーの行(agentChangesQuery の collectAgentChangeEntries。必須。L-060)。一覧の今の区間の比較に使う */
  collectCurrent: (snapshot: BaselineSnapshot) => Promise<AgentChangeEntry[]>
```
- `withAttributionAbsorbed` の後に足す:
```ts
  /**
   * 一覧の行に author を付ける(設計書「行の author」。累積の一覧と、すべて戻すの吸収の中の実行時の一覧)。列の中で呼ぶ(自分では列に
   * 並ばない。withAttributionAbsorbed と同じ)。今の区間のパスを求め(currentPeriodPaths)、集合と合わせて authorsOf で付けた新しい配列を
   * 返す(渡された配列・行は変えない)。比較で lost にしたら開発版のログに出す。手順の予期しない例外は注入したログに出し、lost にしてから
   * 今の区間なしで付ける(投げない。一覧を失敗にしない。L-002・L-424・L-450)。待ち・同期の並べ直しはしない(L-446)
   */
  async attributeEntries(
    ownerId: number,
    record: AgentChangesRecord,
    entries: AgentChangeEntry[]
  ): Promise<AgentChangeEntry[]> {
    const ctx = this.attributionContextOf(ownerId, record)
    const phaseBefore = record.attribution.kind === 'tracking' ? record.attribution.phase : null
    let currentPaths: string[] | null = null
    try {
      const paths = await currentPeriodPaths(ctx, entries)
      if (paths === 'lost') this.logAttribution(ownerId, 'lost', phaseBefore, record)
      else currentPaths = paths
    } catch (err) {
      this.deps.attributionWarn('[agent-attribution] 一覧の区別に失敗しました:', err)
      const outcome = await loseAfterUnexpectedError(ctx)
      if (outcome.kind === 'lost') this.logAttribution(ownerId, 'lost', outcome.phaseBefore, record)
    }
    const authors = authorsOf(entries, record.attribution, currentPaths)
    return entries.map((entry, index) => ({ ...entry, author: authors[index] ?? null }))
  }
```
- `attributionContextOf` の戻り値の `collectBetween: this.deps.collectBetween,` の次に `collectCurrent: this.deps.collectCurrent,` を足す

`src/main/agentChangesScopedQuery.ts`:
- import の `@shared/types` を `import type { AgentChangeEntry, AgentChangesListResult, AgentChangesScope } from '@shared/types'` にする
- 先頭の説明の末尾に「累積の一覧の行だけ attributeEntries(registry の行の author)に通し、結果の区別の要約はその後に求める(今の区間の比較で lost になった記録の要約を同じ結果で返す)」を足す
- `listAgentChangesInScope` を次に置き換える:
```ts
/**
 * 範囲の一覧。選べない範囲(写しが古い)は一覧を作らず理由を返す。累積の行だけ attributeEntries で author を付ける(実行の範囲は
 * 一覧の関数が作った author: null のまま)。区別の要約は attributeEntries の後に求める
 */
export async function listAgentChangesInScope(
  record: AgentChangesRecord,
  scope: AgentChangesScope,
  attributeEntries: (entries: AgentChangeEntry[]) => Promise<AgentChangeEntry[]>
): Promise<AgentChangesListResult> {
  const common = (): Omit<Extract<AgentChangesListResult, { kind: 'scope-unavailable' }>, 'kind' | 'reason'> => ({
    startedAt: record.baseline.startedAt,
    runs: summarizeAgentChangesRuns(record),
    undo: summarizeAgentChangesUndo(record.undo),
    attribution: summarizeAttribution(record.attribution),
    scope
  })
  const resolved = resolveAgentChangesScope(record, scope)
  switch (resolved.kind) {
    case 'unavailable':
      return { kind: 'scope-unavailable', ...common(), reason: resolved.reason }
    case 'between': {
      const list = await listAgentChangesBetween(resolved.start, resolved.end)
      return { kind: 'recording', ...common(), ...list }
    }
    case 'toWorktree': {
      const list = await listAgentChanges(resolved.snapshot)
      return { kind: 'recording', ...common(), ...list }
    }
    case 'cumulative': {
      const list = await listAgentChanges(resolved.snapshot)
      const entries = await attributeEntries(list.entries)
      return { kind: 'recording', ...common(), ...list, entries }
    }
  }
}
```
（`npx eslint --fix` で `common` の型の行の折り返しが直る）

`src/main/agentChangesRevert.ts`:
- `import { AGENT_CHANGES_LIST_LIMIT, toAgentChangeRelativePath } from '@shared/types'` に `isAgentRevertAllTarget` を足す
- `AgentRevertContext` の `undoCapture` の次に足す:
```ts
  /**
   * 一覧の行に author を付ける(registry の attributeEntries を handler が所有者と記録で包んだもの。必須。L-060)。すべて戻すの対象の
   * 絞り込みにだけ使い、行の ↶・ハンクは使わない(利用者の変更も個別に戻せる)
   */
  attributeEntries: (entries: AgentChangeEntry[]) => Promise<AgentChangeEntry[]>
```
- `revertAllAgentChanges` の説明を次にする:
```ts
/**
 * すべて戻す(L-063 の 1 つの流れ)。実行時の一覧 → 件数の上限の検査(除く前の件数。打ち切った一覧では使えない) → author を付ける →
 * 利用者の変更・利用者の変更を含む行を除く(isAgentRevertAllTarget。確認の一覧と同じ定義。L-036・L-058) → 確認のときに見せた一覧
 * (expected)と完全一致で照合し、違えば何も変えない(パターン 62) → 全件を先に調べ、1 件でも戻せなければ何もしない → 控えと適用。
 * 途中で失敗したら、1 件以上済んでいれば partial(パターン 52)。対象が 0 件で確認の一覧も空なら何も変えずに applied: 0
 */
```
- `revertAllAgentChanges` の本体の先頭の 3 行（`const entries = …`・上限の検査・`assertSameEntries(entries, …)`）と `assessRevertAllTargets(gits, entries)` を次にする:
```ts
  const entries = await collectAgentChangeEntries(context.snapshot, context.gitOptions)
  if (entries.length > AGENT_CHANGES_LIST_LIMIT) throw new Error(AGENT_REVERT_ALL_TOO_MANY_MESSAGE)
  const targetEntries = (await context.attributeEntries(entries)).filter(isAgentRevertAllTarget)
  assertSameEntries(targetEntries, expected, AGENT_REVERT_ALL_MISMATCH_MESSAGE)
  const gits = gitsFor(context)
  const targets = await assessRevertAllTargets(gits, targetEntries)
```

`src/main/handlers/agentChangesHandlers.ts`:
- `AgentChangesHandlerDeps.registry` の `Pick` に `| 'attributeEntries'` を足す
- 先頭の説明の末尾に「累積の一覧とすべて戻すの実行時の一覧の行の author は registry の attributeEntries で付ける(すべて戻すは吸収の中で呼ぶ)」を足す
- `revertContextOf` を次にする:
```ts
  // 戻す関数の文脈。attributeEntries はすべて戻すの対象の絞り込みに使う(行の ↶・ハンクは使わない)。戻す関数は吸収の task の中で
  // 呼ぶため、author は吸収の (1) の区切り(S1)からの今の区間で付く(L-449)
  const revertContextOf = (ownerId: number, record: AgentChangesRecord): AgentRevertContext => ({
    snapshot: record.baseline,
    trash,
    undoCapture,
    attributeEntries: (entries) => registry.attributeEntries(ownerId, record, entries)
  })
```
- `revertContextOf(record)` の 3 か所（`agentChanges:revertFile`・`agentChanges:revertHunk`・`agentChanges:revertAll`）を `revertContextOf(ownerId, record)` にする
- `agentChanges:list` の `withRecord` のタスクを次にする:
```ts
      const result = await registry.withRecord(ownerId, folder, (record) =>
        listAgentChangesInScope(record, parsedScope, (entries) =>
          registry.attributeEntries(ownerId, record, entries)
        )
      )
```

`src/main/ipcHandlers.ts`:
- `import { collectAgentChangeEntriesBetween } from './agentChangesQuery'` を `import { collectAgentChangeEntries, collectAgentChangeEntriesBetween } from './agentChangesQuery'` にする
- registry の依存の `collectBetween: collectAgentChangeEntriesBetween,` の次に `collectCurrent: collectAgentChangeEntries,` を足す

`src/main/__tests__/helpers/agentBaselineFixtures.ts`:
- `AttributionRegistryDeps` の `Pick` の並びに `'collectCurrent'` を足し（`'collectBetween' | 'collectCurrent' | 'attributionSource' | 'attributionDevLog' | 'attributionWarn'`）、説明を「registry の区別の依存(区切りの差分・今の区間の比較・追跡・開発版のログ・失敗のログ)」にする
- `makeAttributionOffDeps` の戻り値の `collectBetween` の次に `collectCurrent: vi.fn<AgentBaselineRegistryDeps['collectCurrent']>(async () => []),` を足す

- [ ] **Step 7: 通す**

Run: `npx vitest run src/main/__tests__/agentChangesAttributionSync.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/agentChangesScopedQuery.test.ts src/main/__tests__/agentChangesRevert.integration.test.ts src/main/__tests__/agentChangesRevert.toctou.integration.test.ts src/main/__tests__/agentChangesUndo.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/agentChangesAttribution.integration.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts`
Expected: PASS
Run: `npm test`
Expected: PASS（時間切れで落ちたファイルは単体で流し直す）
Run: `npm run typecheck`
Expected: PASS（`agentChangesHandlers.ts` の依存の `Pick` に `attributeEntries`、`AgentRevertContext` を作るすべての場所に `attributeEntries`、registry を作るすべての場所に `collectCurrent` が要る）
Run: `npx eslint --fix src/main/agentChangesAttributionSync.ts src/main/agentBaselineRegistry.ts src/main/agentChangesScopedQuery.ts src/main/agentChangesRevert.ts src/main/handlers/agentChangesHandlers.ts src/main/ipcHandlers.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentChangesAttributionSync.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentChangesScopedQuery.test.ts src/main/__tests__/agentChangesRevert.integration.test.ts src/main/__tests__/agentChangesRevert.toctou.integration.test.ts src/main/__tests__/agentChangesUndo.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/agentChangesAttribution.integration.test.ts src/main/__tests__/ipcHandlers.test.ts && npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 8: 変異で確かめる**

1. `currentPeriodPaths` の `checkSignalBeforePeriod` の呼び出しと 2 行（`const check = …`・`if (check === 'lost') return 'lost'`）を消し、`if (check === 'marked' || tracking === null)` を `if (tracking === null)` にして、「合図が lost なら、比べずに…」「%s なら、今の区間に印を立てて比べない…」「段階の変化の同期より先に一覧が列で走ると…」が落ちることを確かめて戻す
2. `currentPeriodPaths` の `catch` の中を `return null` だけにし、「比較に失敗したら、区別をやめて…lost を返す」「今の区間の比較に失敗したら、区別をやめて…集合だけで付け…」が落ちることを確かめて戻す
3. `attributeEntries` の `catch` の `this.deps.attributionWarn(...)` を `console.warn('[agent-attribution] 一覧の区別に失敗しました:', err)` にし、「手順の予期しない例外は、注入した失敗のログに出して…」が落ちることを確かめて戻す
4. `listAgentChangesInScope` の `common` を関数でなく、`resolveAgentChangesScope` の前に求めたオブジェクト（`const common = { …, attribution: summarizeAttribution(record.attribution), scope }` と各 `...common`）に戻し、「一覧の今の区間の比較で記録が lost になったら、同じ結果の要約も lost…」が落ちることを確かめて戻す
5. `revertAllAgentChanges` の `.filter(isAgentRevertAllTarget)` を外し、`npx vitest run src/main/__tests__/agentChangesRevert.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts` の「user・mixed の行を戻さず、agent・null の行だけを戻す…」「すべて戻すは user・mixed の行を戻さず agent の行だけを戻す…」が落ちることを確かめて戻す
6. `agentChanges:revertAll` のタスクで、`withAttributionAbsorbed` の前に `const authored = await registry.attributeEntries(ownerId, record, [])` を置き、戻す関数に渡す文脈を `{ ...revertContextOf(ownerId, record), attributeEntries: async () => authored }` にして、「revertAll は、registry の attributeEntries を戻す関数の中…」が落ちることを確かめて戻す
7. `ipcHandlers.ts` の `collectCurrent: collectAgentChangeEntries` を `collectCurrent: async () => []` にし、「記録の registry に、…今の区間の比較…を渡す」が落ちることを確かめて戻す
8. 戻したことを `git diff` で確かめる

- [ ] **Step 9: コミット（利用者の指示があるときだけ）**

```bash
git add src/main/agentChangesAttributionSync.ts src/main/agentBaselineRegistry.ts src/main/agentChangesScopedQuery.ts src/main/agentChangesRevert.ts src/main/handlers/agentChangesHandlers.ts src/main/ipcHandlers.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentChangesAttributionSync.test.ts src/main/__tests__/agentBaselineRegistry.attribution.test.ts src/main/__tests__/agentChangesScopedQuery.test.ts src/main/__tests__/agentChangesRevert.integration.test.ts src/main/__tests__/agentChangesRevert.toctou.integration.test.ts src/main/__tests__/agentChangesUndo.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/agentChangesAttribution.integration.test.ts src/main/__tests__/ipcHandlers.test.ts
git commit -m "feat: 累積の一覧の行に利用者の変更の区別を付け、すべて戻すの対象から利用者の変更を除く"
```

---

### Task 4: renderer の文言・可否・戻す操作（`agentChangesMessages`・`agentChangesAvailability`・`useAgentChangesRevert`）

> **気をつける知見:** L-152（区別している記録の `すべて戻す` の確認で、戻る利用者の編集と戻さない件数を順 1〜5 で伝える。文言は完全一致で固定する）・L-006（`user` の行の確認の文も「動いていない間の変更が含まれます」にし、`mixed` と同じ文にする）・L-036・L-058（対象は `isAgentRevertAllTarget` で絞り、対象 0 件では押せず確認も出さない）・L-057（対象 0 件の理由を見える文字で出す）・L-060（確認の関数の `author`・`attribution`・`startedAt`・`excludedCount`、`hasOnlyUserChanges` を必須にする）

文言の関数の引数を変えるため、呼び出し元の `useAgentChangesRevert` と、テストの補助の `makeAgentChangesRevertState`（戻り値に `revertAllExcludedCount` を足す）を同じタスクで直す。

**Files:**
- Modify: `src/renderer/src/lib/agentChangesMessages.ts`（「確認の文言」の定数・関数）
- Modify: `src/renderer/src/lib/agentChangesAvailability.ts`（`agentRevertAllDisabledReason` の `hasOnlyUserChanges`）
- Modify: `src/renderer/src/hooks/useAgentChangesRevert.ts`（対象の絞り込み・確認への引数・`revertAllExcludedCount`）
- Modify: `src/renderer/src/__tests__/makeAgentChangesState.ts`（`makeAgentChangesRevertState` の `revertAllExcludedCount: 0`）
- Test: `src/renderer/src/lib/__tests__/agentChangesMessages.test.ts`・`src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts`・`src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts`・`src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts`

**Interfaces:**
- Consumes: Task 2 の `AgentChangeEntry.author`・`AgentChangesAttributionSummary`・写しの `attribution`・`isAgentRevertAllTarget`・`makeAgentChangesTrackingSummary`・`makeAgentChangesLostSummary`、既存の `formatAgentChangesStartedAt(startedAt): string`
- Produces:
```ts
// src/renderer/src/lib/agentChangesMessages.ts
export const AGENT_CHANGES_USER_MARK = '利用者の変更'
export const AGENT_CHANGES_MIXED_MARK = '利用者の変更を含む'
export const AGENT_CHANGES_ONLY_USER_REASON: string
export const AGENT_CHANGES_ATTRIBUTION_LOST_REASONS: Record<AgentChangesAttributionLostReason, string>
export const AGENT_REVERT_ALL_DISTINGUISHING_NOTE: string
export function formatAgentChangesExcludedNote(count: number): string
export function isAgentChangesAttributionDistinguishing(summary: AgentChangesAttributionSummary): boolean
export function describeAgentChangesAttribution(
  attribution: AgentChangesAttributionSummary,
  startedAt: number
): string | null
export function buildAgentRevertFileConfirmMessage(
  input: { path: string; status: AgentChangeStatus; isDirectory: boolean; author: AgentChangeAuthor | null } & RevertAppendix
): string
export function buildAgentRevertAllConfirmMessage(input: {
  count: number
  trashCount: number
  hasDirectory: boolean
  savedInApp: boolean
  agentRunning: boolean
  attribution: AgentChangesAttributionSummary
  startedAt: number
  excludedCount: number
}): string

// src/renderer/src/lib/agentChangesAvailability.ts
export function agentRevertAllDisabledReason(
  availability: AgentRevertAvailability & {
    truncated: boolean
    hasNotRecorded: boolean
    hasOnlyUserChanges: boolean
  }
): string | null

// src/renderer/src/hooks/useAgentChangesRevert.ts の AgentChangesRevertState に:
//   /** すべて戻すから除く行(利用者の変更・利用者の変更を含む)の件数(累積の一覧が無い・打ち切った・実行の範囲なら 0) */
//   revertAllExcludedCount: number
```

- [ ] **Step 1: 失敗するテストを書く（文言）**

`src/renderer/src/lib/__tests__/agentChangesMessages.test.ts`:
- `../agentChangesMessages` の import に `AGENT_CHANGES_ATTRIBUTION_LOST_REASONS`・`AGENT_CHANGES_MIXED_MARK`・`AGENT_CHANGES_ONLY_USER_REASON`・`AGENT_CHANGES_USER_MARK`・`AGENT_REVERT_ALL_DISTINGUISHING_NOTE`・`describeAgentChangesAttribution`・`formatAgentChangesExcludedNote`・`isAgentChangesAttributionDistinguishing` を足し、`../../__tests__/makeAgentChangesState` の import に `makeAgentChangesLostSummary`・`makeAgentChangesTrackingSummary` を足す
- 既存の `buildAgentRevertFileConfirmMessage` の呼び出しに `author: null` を渡す: `describe('確認の文言', ...)` の `const plain = { … }` と、`戻す確認の文言は…` のテストの `const none = { … }` の定義に `author: null` を足し（`plain`・`none` を広げて渡すハンクの呼び出しにも余分な項目が渡るが、広げた項目は余分な項目の検査に当たらない）、`追記は…` のテストのように直接書いた呼び出しのオブジェクトには `author: null` を足す
- 既存の `buildAgentRevertAllConfirmMessage({ ... })` の呼び出しに、区別していない記録の引数を足す: `describe('確認の文言', ...)` の `it('すべて', ...)` の 2 つの呼び出しには `attribution: makeAgentChangesTrackingSummary(), startedAt: at(10, 0), excludedCount: 0` を足し、`戻す確認の文言は…` のテストの `const all = { count: 2, trashCount: 1, savedInApp: false, agentRunning: false }` を `const all = { count: 2, trashCount: 1, savedInApp: false, agentRunning: false, attribution: makeAgentChangesTrackingSummary(), startedAt: at(10, 0), excludedCount: 0 }` にする（期待値の文言は変えない）
- 末尾に足す:
```ts
describe('利用者の変更との区別の文言(B-2)', () => {
  const startedAt = at(10, 0)
  // すべて戻すの確認の、順 1〜5 の部分の前後(取り消せる旨とステージの行)
  const allConfirm = (note: string): string =>
    `エージェントの変更 2 件を実行前の状態に戻しますか？${note}戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。\nステージ（index）・コミット・ブランチは戻しません。`
  const buildAll = (
    attribution: Parameters<typeof buildAgentRevertAllConfirmMessage>[0]['attribution'],
    excludedCount = 0
  ): string =>
    buildAgentRevertAllConfirmMessage({
      count: 2,
      trashCount: 0,
      hasDirectory: false,
      savedInApp: false,
      agentRunning: false,
      attribution,
      startedAt,
      excludedCount
    })

  it('行の印・除く旨・対象 0 件の理由', () => {
    expect(AGENT_CHANGES_USER_MARK).toBe('利用者の変更')
    expect(AGENT_CHANGES_MIXED_MARK).toBe('利用者の変更を含む')
    expect(formatAgentChangesExcludedNote(3)).toBe(
      'すべて戻すは、利用者の変更（3 件）を除いて戻します'
    )
    expect(AGENT_CHANGES_ONLY_USER_REASON).toBe(
      '利用者の変更だけのため、すべて戻すの対象がありません。ファイルごとに戻してください'
    )
  })

  it('区別をやめた理由の文言は 4 つの理由を網羅する', () => {
    expect(AGENT_CHANGES_ATTRIBUTION_LOST_REASONS).toEqual({
      'hooks-not-confirmed': 'claude の hooks から知らせが届きません',
      'receiver-unavailable': 'hooks の知らせの受け口を用意できませんでした',
      'claude-version-unsupported': 'claude の版が古いか、版を確かめられませんでした',
      'checkpoint-failed': '作業ツリーの記録に失敗しました'
    })
  })

  it('区別しているか: tracking は区別を始めた後、lost は印が残っているとき', () => {
    expect(isAgentChangesAttributionDistinguishing(makeAgentChangesTrackingSummary())).toBe(false)
    expect(
      isAgentChangesAttributionDistinguishing(makeAgentChangesTrackingSummary({ since: startedAt }))
    ).toBe(true)
    expect(isAgentChangesAttributionDistinguishing(makeAgentChangesLostSummary())).toBe(false)
    expect(
      isAgentChangesAttributionDistinguishing(makeAgentChangesLostSummary({ hadMarks: true }))
    ).toBe(true)
  })

  it.each<[string, Parameters<typeof describeAgentChangesAttribution>[0], string | null]>([
    [
      'lost・印なし',
      makeAgentChangesLostSummary({ reason: 'hooks-not-confirmed' }),
      '利用者の変更を区別できません（claude の hooks から知らせが届きません）。すべてエージェントの変更として表示します'
    ],
    [
      'lost・印あり',
      makeAgentChangesLostSummary({
        reason: 'checkpoint-failed',
        lostAt: at(11, 30),
        hadMarks: true
      }),
      '11:30 から利用者の変更を区別できなくなりました（作業ツリーの記録に失敗しました）。それ以降の変更には印を付けません'
    ],
    ['tracking・区別をまだ始めていない', makeAgentChangesTrackingSummary(), null],
    [
      'tracking・区別を始めたのが記録の開始より後',
      makeAgentChangesTrackingSummary({ since: at(10, 5) }),
      '利用者の変更の区別は 10:05 からです（それより前の変更には印を付けません）'
    ],
    [
      'tracking・印を付けていない間があった',
      makeAgentChangesTrackingSummary({ since: startedAt, hadUnassignedSince: true }),
      'アプリの中で claude が動いていなかった間などの変更には、印を付けていません'
    ],
    [
      'tracking・上の 2 つが両方',
      makeAgentChangesTrackingSummary({ since: at(10, 5), hadUnassignedSince: true }),
      '利用者の変更の区別は 10:05 からです（それより前の変更には印を付けません）。アプリの中で claude が動いていなかった間などの変更には、印を付けていません'
    ],
    [
      'tracking・記録の開始から区別していて、印を付けていない間も無い',
      makeAgentChangesTrackingSummary({ since: startedAt }),
      null
    ]
  ])('区別の状態の 1 行: %s', (_label, attribution, expected) => {
    expect(describeAgentChangesAttribution(attribution, startedAt)).toBe(expected)
  })

  it.each<[string, Parameters<typeof buildAll>[0], number, string]>([
    [
      '区別していない(tracking・区別をまだ始めていない)',
      makeAgentChangesTrackingSummary(),
      0,
      '記録を始めた後にあなたが編集した内容も戻ります。'
    ],
    [
      '区別していない(lost・印なし)',
      makeAgentChangesLostSummary({ lostAt: at(11, 30) }),
      0,
      '記録を始めた後にあなたが編集した内容も戻ります。'
    ],
    [
      '区別していない要約で除く行がある(一覧が古いまま記録だけが lost になった。順 1 は今のまま、順 5 は出す)',
      makeAgentChangesTrackingSummary(),
      1,
      '記録を始めた後にあなたが編集した内容も戻ります。利用者の変更 1 件（印の付いた行）は戻しません。行の ↶ で個別に戻せます。'
    ],
    [
      '区別している(記録の開始から・印を付けていない間なし)',
      makeAgentChangesTrackingSummary({ since: startedAt }),
      0,
      AGENT_REVERT_ALL_DISTINGUISHING_NOTE
    ],
    [
      '区別している・区別を始めたのが記録の開始より後',
      makeAgentChangesTrackingSummary({ since: at(10, 5) }),
      0,
      `${AGENT_REVERT_ALL_DISTINGUISHING_NOTE}10:05 より前のあなたの編集も戻ります。`
    ],
    [
      '区別している・印を付けていない間があった',
      makeAgentChangesTrackingSummary({ since: startedAt, hadUnassignedSince: true }),
      0,
      `${AGENT_REVERT_ALL_DISTINGUISHING_NOTE}アプリの中で claude が動いていなかった間などのあなたの編集も戻ります。`
    ],
    [
      '区別している・lost で印がある・除く行がある',
      makeAgentChangesLostSummary({ since: startedAt, lostAt: at(11, 30), hadMarks: true }),
      2,
      `${AGENT_REVERT_ALL_DISTINGUISHING_NOTE}区別をやめた後（11:30 から）のあなたの編集も戻ります。利用者の変更 2 件（印の付いた行）は戻しません。行の ↶ で個別に戻せます。`
    ],
    [
      '順 1〜5 がすべて出る',
      makeAgentChangesLostSummary({
        since: at(10, 5),
        hadUnassignedSince: true,
        lostAt: at(11, 30),
        hadMarks: true
      }),
      1,
      `${AGENT_REVERT_ALL_DISTINGUISHING_NOTE}10:05 より前のあなたの編集も戻ります。アプリの中で claude が動いていなかった間などのあなたの編集も戻ります。区別をやめた後（11:30 から）のあなたの編集も戻ります。利用者の変更 1 件（印の付いた行）は戻しません。行の ↶ で個別に戻せます。`
    ]
  ])('すべて戻すの確認: %s', (_label, attribution, excludedCount, note) => {
    expect(buildAll(attribution, excludedCount)).toBe(allConfirm(note))
  })

  it('区別しているときの順 1 の文は、エージェントの変更になる利用者の編集をすべて言う', () => {
    expect(AGENT_REVERT_ALL_DISTINGUISHING_NOTE).toBe(
      'エージェントのツールが動いている間（終わってから 2 秒・許可の確認を待つ間を含む）と、claude を起動してから最初のプロンプトを送るまで・中断（Esc）の後にあなたが編集した内容は、エージェントの変更として戻ります。'
    )
  })

  it.each(['user', 'mixed'] as const)(
    '行の ↶ の確認は、author が %s なら今の文言の後(アプリで保存した旨などの前)に利用者の変更の旨を足す(user も言い切らず同じ文。L-006)',
    (author) => {
      expect(
        buildAgentRevertFileConfirmMessage({
          path: 'a.txt',
          status: 'M',
          isDirectory: false,
          author,
          savedInApp: true,
          hasUnsavedEdits: false,
          agentRunning: false
        }).split('\n\n')
      ).toEqual([
        'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。',
        'このファイル（フォルダ）には、エージェントのツールが動いていない間の変更（利用者の変更）が含まれます。',
        'このファイルは、記録を始めた後にアプリで保存されています。'
      ])
    }
  )

  it.each(['agent', null] as const)('行の ↶ の確認は、author が %s なら何も足さない', (author) => {
    expect(
      buildAgentRevertFileConfirmMessage({
        path: 'a.txt',
        status: 'M',
        isDirectory: false,
        author,
        savedInApp: false,
        hasUnsavedEdits: false,
        agentRunning: false
      })
    ).toBe(
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。'
    )
  })
})
```
（ハンクの確認 `buildAgentRevertHunkConfirmMessage` は引数も文言も変えない。既存の `ハンク` のテストがそのまま通ることで固定する）

- [ ] **Step 2: 失敗するテストを書く（押せない理由）**

`src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts`:
- `../agentChangesMessages` の import に `AGENT_CHANGES_ONLY_USER_REASON` を足す
- `combinations` の `flags.flatMap((hasNotRecorded) =>` の内側に `hasOnlyUserChanges` の次元を足す（`flags.flatMap((hasOnlyUserChanges) => flags.map((isRunScope) => ({ …, hasOnlyUserChanges, isRunScope })))` の形にし、返すオブジェクトに `hasOnlyUserChanges` を入れる）
- `it.each(combinations)('%o', ...)` の `agentRevertAllDisabledReason(availability) !== null` の期待値を `blocked || availability.truncated || availability.hasNotRecorded || availability.hasOnlyUserChanges` にする
- `it.each(combinations)('文言は優先順位の規則どおり: %o', ...)` の `allOrder` の最後に `[availability.hasOnlyUserChanges, AGENT_CHANGES_ONLY_USER_REASON]` を足す
- ほかの `agentRevertAllDisabledReason({ ... })` の呼び出し（`truncated`・`hasNotRecorded` を渡しているもの。`grep -n 'agentRevertAllDisabledReason({' src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts`）に `hasOnlyUserChanges: false` を足す
- `describe('戻すボタンを押せる条件(…)', ...)` の最後に足す:
```ts
  it('行がすべて利用者の変更(user・mixed)なら、すべて戻すを押せない。今の理由(ファイル単位・打ち切り・記録していない行)を先に出す', () => {
    const allUser = { ...none, truncated: false, hasNotRecorded: false, hasOnlyUserChanges: true }
    expect(agentRevertAllDisabledReason(allUser)).toBe(AGENT_CHANGES_ONLY_USER_REASON)
    expect(agentRevertAllDisabledReason({ ...allUser, truncated: true })).toBe(
      AGENT_CHANGES_TRUNCATED_REASON
    )
    expect(agentRevertAllDisabledReason({ ...allUser, hasNotRecorded: true })).toBe(
      AGENT_CHANGES_NOT_RECORDED_REASON
    )
    expect(agentRevertAllDisabledReason({ ...allUser, isGitBusy: true })).toBe(
      AGENT_CHANGES_BUSY_GIT
    )
    // ファイル単位の戻す操作は押せる(利用者の変更も行の ↶ で戻せる)
    expect(agentRevertDisabledReason(allUser)).toBeNull()
  })
```

- [ ] **Step 3: 失敗するテストを書く（戻す操作の hook）**

`src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts`:
- `../../lib/agentChangesMessages` の import に `AGENT_CHANGES_ONLY_USER_REASON`・`AGENT_REVERT_ALL_DISTINGUISHING_NOTE` を足し、`../../__tests__/makeAgentChangesState` の import に `makeAgentChangesTrackingSummary` を足す
- ファイルの末尾に足す:
```ts
describe('useAgentChangesRevert — 利用者の変更の区別(B-2)', () => {
  // 記録の開始(1)から区別している記録
  const distinguishing = makeAgentChangesTrackingSummary({ since: 1 })
  // a.txt: エージェントの変更、u.txt: 利用者の変更(追加。アプリで保存)、m/: 両方(追加されたフォルダ)、n.txt: 区別していない行(追加)
  const entries = [
    makeAgentChangeEntry('a.txt', { author: 'agent' }),
    makeAgentChangeEntry('m/', { status: 'A', isDirectory: true, author: 'mixed' }),
    makeAgentChangeEntry('n.txt', { status: 'A', author: null }),
    makeAgentChangeEntry('u.txt', { status: 'A', author: 'user' })
  ]
  const optionsWith = (
    rows: AgentChangeEntry[],
    viewOverrides: Parameters<typeof makeAgentChangesRecordingView>[1] = {}
  ): RevertTestOptions =>
    makeOptions({
      changes: makeAgentChangesController({
        view: makeAgentChangesRecordingView(rows, {
          startedAt: 1,
          attribution: distinguishing,
          ...viewOverrides
        })
      })
    })

  it('すべて戻すは、利用者の変更・利用者の変更を含む行を除いた対象だけで、確認の件数・ゴミ箱の件数・フォルダの有無・保存の有無・expected・読み上げの件数を求める', async () => {
    const options = optionsWith(entries)
    options.changes.savedPaths = new Set(['/repo/u.txt'])
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertAll()
    })
    const message = vi.mocked(options.onConfirm!).mock.calls[0][0]
    expect(message).toContain('エージェントの変更 2 件を実行前の状態に戻しますか？')
    expect(message).toContain('うち 1 件の新しいファイル・フォルダはゴミ箱へ移動します。')
    expect(message).not.toContain('フォルダをゴミ箱へ移すため')
    expect(message).not.toContain('記録を始めた後にアプリで保存したファイルを含みます')
    expect(agentChangesApi.revertAllAgentChanges).toHaveBeenCalledWith(
      [
        { path: 'a.txt', status: 'M' },
        { path: 'n.txt', status: 'A' }
      ],
      ALL_SCOPE
    )
    expect(options.changes.announce).toHaveBeenCalledWith(
      '2 件を実行前の状態に戻しました。「戻した操作を取り消す」で取り消せます'
    )
  })

  it('すべて戻すの確認に、写しの区別の要約・記録の開始の時刻・除く件数を渡す', async () => {
    const options = optionsWith(entries)
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertAll()
    })
    const message = vi.mocked(options.onConfirm!).mock.calls[0][0]
    expect(message).toContain(
      `？${AGENT_REVERT_ALL_DISTINGUISHING_NOTE}利用者の変更 2 件（印の付いた行）は戻しません。行の ↶ で個別に戻せます。戻した直後なら`
    )
    expect(message).not.toContain('記録を始めた後にあなたが編集した内容も戻ります。')
  })

  it('除く件数(revertAllExcludedCount)を返す。打ち切った一覧・実行の範囲の一覧では 0', () => {
    expect(
      renderHook(() => useRevertWithRunner(optionsWith(entries))).result.current
        .revertAllExcludedCount
    ).toBe(2)
    expect(
      renderHook(() => useRevertWithRunner(optionsWith(entries, { truncated: true }))).result
        .current.revertAllExcludedCount
    ).toBe(0)
    expect(
      renderHook(() =>
        useRevertWithRunner(optionsWith(entries, { scope: { kind: 'run', runId: 1 } }))
      ).result.current.revertAllExcludedCount
    ).toBe(0)
  })

  it('行がすべて利用者の変更なら、すべて戻すは押せず(理由を返す)、確認も出さない。行の ↶ は押せる', async () => {
    const options = optionsWith([
      makeAgentChangeEntry('u.txt', { author: 'user' }),
      makeAgentChangeEntry('m.txt', { author: 'mixed' })
    ])
    const { result } = renderHook(() => useRevertWithRunner(options))
    expect(result.current.revertAllDisabledReason).toBe(AGENT_CHANGES_ONLY_USER_REASON)
    expect(result.current.revertDisabledReason).toBeNull()
    await act(async () => {
      await result.current.revertAll()
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(agentChangesApi.revertAllAgentChanges).not.toHaveBeenCalled()
  })

  it.each<[AgentChangeEntry['author'], boolean]>([
    ['user', true],
    ['mixed', true],
    ['agent', false],
    [null, false]
  ])('行の ↶ の確認は、author が %s なら利用者の変更の旨を足すか: %s', async (author, expected) => {
    const options = optionsWith(entries)
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertFile(makeAgentChangeEntry('a.txt', { author }))
    })
    const message = vi.mocked(options.onConfirm!).mock.calls[0][0]
    expect(
      message.includes(
        'このファイル（フォルダ）には、エージェントのツールが動いていない間の変更（利用者の変更）が含まれます。'
      )
    ).toBe(expected)
  })
})
```

`src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts` の `describe('makeAgentChangesRevertState', ...)` の 1 つ目のテストの `toMatchObject({ ... })` に `revertAllExcludedCount: 0` を足す。

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts`
Expected: FAIL（新しい定数・関数が無い・確認の関数が区別を見ない・`hasOnlyUserChanges` が無い・hook が対象を絞らない・`revertAllExcludedCount` が無い）

- [ ] **Step 5: 実装する（文言）**

`src/renderer/src/lib/agentChangesMessages.ts`:
- import の型に `AgentChangeAuthor`・`AgentChangesAttributionLostReason`・`AgentChangesAttributionSummary` を足す
- 先頭の説明の「(設計書「A の詳細」「確認ダイアログの文言」)」を「(設計書「A の詳細」「確認ダイアログの文言」と、2026-10-13 の設計書の利用者の変更との区別の「確認の文言」)」にする
- `AGENT_CHANGES_LOADING` の定義の後に足す:
```ts
/** 行の印(累積の一覧で、エージェントのツールが動いていない間に変わった行・両方が変えた行) */
export const AGENT_CHANGES_USER_MARK = '利用者の変更'
export const AGENT_CHANGES_MIXED_MARK = '利用者の変更を含む'

/** すべて戻すの上の除く旨(除く行が 1 件以上のとき) */
export function formatAgentChangesExcludedNote(count: number): string {
  return `すべて戻すは、利用者の変更（${count} 件）を除いて戻します`
}

/** 区別をやめた理由の文言(理由の型ごとに分ける。L-439) */
export const AGENT_CHANGES_ATTRIBUTION_LOST_REASONS: Record<
  AgentChangesAttributionLostReason,
  string
> = {
  'hooks-not-confirmed': 'claude の hooks から知らせが届きません',
  'receiver-unavailable': 'hooks の知らせの受け口を用意できませんでした',
  'claude-version-unsupported': 'claude の版が古いか、版を確かめられませんでした',
  'checkpoint-failed': '作業ツリーの記録に失敗しました'
}

/**
 * 区別している記録か(main の authorsOf の「区別していない記録」の逆。tracking なら区別を始めた後、lost なら印が残っている)。
 * 区別していない記録の確認の文言は今までどおり
 */
export function isAgentChangesAttributionDistinguishing(
  summary: AgentChangesAttributionSummary
): boolean {
  return summary.kind === 'tracking' ? summary.since !== null : summary.hadMarks
}

/**
 * 累積の一覧の上の区別の状態の 1 行(出さないなら null)。区別をやめた理由、区別を始めたのが記録の開始より後であること、
 * 印を付けていない間があったことを見える文字で伝える(L-057)
 */
export function describeAgentChangesAttribution(
  attribution: AgentChangesAttributionSummary,
  startedAt: number
): string | null {
  if (attribution.kind === 'lost') {
    const reason = AGENT_CHANGES_ATTRIBUTION_LOST_REASONS[attribution.reason]
    return attribution.hadMarks
      ? `${formatAgentChangesStartedAt(attribution.lostAt)} から利用者の変更を区別できなくなりました（${reason}）。それ以降の変更には印を付けません`
      : `利用者の変更を区別できません（${reason}）。すべてエージェントの変更として表示します`
  }
  if (attribution.since === null) return null
  const parts = [
    attribution.since > startedAt
      ? `利用者の変更の区別は ${formatAgentChangesStartedAt(attribution.since)} からです（それより前の変更には印を付けません）`
      : null,
    attribution.hadUnassignedSince
      ? 'アプリの中で claude が動いていなかった間などの変更には、印を付けていません'
      : null
  ].filter((text): text is string => text !== null)
  return parts.length === 0 ? null : parts.join('。')
}
```
- `AGENT_CHANGES_NOT_RECORDED_REASON` の定義の後に足す:
```ts
/** すべて戻すの対象が 0 件(行がすべて利用者の変更・利用者の変更を含む)の理由 */
export const AGENT_CHANGES_ONLY_USER_REASON =
  '利用者の変更だけのため、すべて戻すの対象がありません。ファイルごとに戻してください'
```
- `buildAgentRevertFileConfirmMessage` の前に足す:
```ts
/**
 * 区別している記録のすべて戻すの確認の順 1(エージェントの変更として戻る利用者の編集〈ツールの実行中・猶予・許可の確認の待ち・
 * claude の起動から最初のプロンプトまで・中断の後〉をすべて言う。L-152)
 */
export const AGENT_REVERT_ALL_DISTINGUISHING_NOTE =
  'エージェントのツールが動いている間（終わってから 2 秒・許可の確認を待つ間を含む）と、claude を起動してから最初のプロンプトを送るまで・中断（Esc）の後にあなたが編集した内容は、エージェントの変更として戻ります。'

/** 利用者の変更の行(user・mixed)を行の ↶ で戻す確認の追記(user も言い切らず mixed と同じ文。L-006) */
const AGENT_REVERT_FILE_USER_NOTE =
  'このファイル（フォルダ）には、エージェントのツールが動いていない間の変更（利用者の変更）が含まれます。'

/** すべて戻すの確認の、記録を始めた後の利用者の編集の部分(順 1〜5。区切りの空白・改行は入れずにつなぐ) */
function revertAllUserEditsNote(
  attribution: AgentChangesAttributionSummary,
  startedAt: number,
  excludedCount: number
): string {
  const parts: string[] = []
  if (!isAgentChangesAttributionDistinguishing(attribution)) {
    parts.push('記録を始めた後にあなたが編集した内容も戻ります。')
  } else {
    parts.push(AGENT_REVERT_ALL_DISTINGUISHING_NOTE)
    if (attribution.since !== null && attribution.since > startedAt) {
      parts.push(`${formatAgentChangesStartedAt(attribution.since)} より前のあなたの編集も戻ります。`)
    }
    if (attribution.hadUnassignedSince) {
      parts.push('アプリの中で claude が動いていなかった間などのあなたの編集も戻ります。')
    }
    if (attribution.kind === 'lost') {
      parts.push(
        `区別をやめた後（${formatAgentChangesStartedAt(attribution.lostAt)} から）のあなたの編集も戻ります。`
      )
    }
  }
  // 区別していない要約でも出す(一覧が古いまま記録だけが lost になった組み合わせで、除く行を伝えずに件数だけが減ることを防ぐ)
  if (excludedCount > 0) {
    parts.push(
      `利用者の変更 ${excludedCount} 件（印の付いた行）は戻しません。行の ↶ で個別に戻せます。`
    )
  }
  return parts.join('')
}
```
- `buildAgentRevertFileConfirmMessage` を次にする:
```ts
/** ファイル単位で戻す確認の文言。利用者の変更の行(user・mixed)は、今の文言の後(アプリで保存した旨などの前)にその旨を足す */
export function buildAgentRevertFileConfirmMessage({
  path,
  status,
  isDirectory,
  author,
  ...appendix
}: {
  path: string
  status: AgentChangeStatus
  isDirectory: boolean
  /** 行の区別(写しの entry.author。必須。L-060) */
  author: AgentChangeAuthor | null
} & RevertAppendix): string {
  const base =
    status !== 'A'
      ? `${path} を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。${AGENT_REVERT_UNDOABLE_NOTE}`
      : isDirectory
        ? `${path} をゴミ箱へ移動しますか？フォルダとその中身（.gitignore の対象を含む）がすべて移動します。${AGENT_REVERT_DIRECTORY_NOT_UNDOABLE_NOTE}`
        : `${path} をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）${AGENT_REVERT_UNDOABLE_NOTE}`
  const userNote =
    author === 'user' || author === 'mixed' ? `\n\n${AGENT_REVERT_FILE_USER_NOTE}` : ''
  return base + userNote + appendices(appendix)
}
```
- `buildAgentRevertAllConfirmMessage` を次にする:
```ts
/**
 * すべて戻す確認の文言。count・trashCount・hasDirectory・savedInApp は対象(除く行を除いた行)で求める。記録を始めた後の利用者の編集の
 * 部分は区別の状態で変える(順 1〜5)。未保存の編集の破棄は confirmDiscardAnyDirty が別に確かめる
 */
export function buildAgentRevertAllConfirmMessage({
  count,
  trashCount,
  hasDirectory,
  savedInApp,
  agentRunning,
  attribution,
  startedAt,
  excludedCount
}: {
  count: number
  /** そのうちゴミ箱へ移す(追加された)ファイル・フォルダの数 */
  trashCount: number
  /** 追加されたフォルダの行を含むか(取り消せない旨を出す) */
  hasDirectory: boolean
  savedInApp: boolean
  agentRunning: boolean
  /** 写しの記録の区別の要約(必須。L-060) */
  attribution: AgentChangesAttributionSummary
  /** 記録を始めた時刻(区別を始めたのが後かを比べる) */
  startedAt: number
  /** 除く行(利用者の変更・利用者の変更を含む)の件数 */
  excludedCount: number
}): string {
  const trash =
    trashCount > 0 ? `\nうち ${trashCount} 件の新しいファイル・フォルダはゴミ箱へ移動します。` : ''
  const saved = savedInApp ? '\n\n記録を始めた後にアプリで保存したファイルを含みます。' : ''
  const running = agentRunning
    ? '\n\nエージェントが動いている間は、戻した後に同じファイルが書き換えられることがあります。'
    : ''
  return (
    `エージェントの変更 ${count} 件を実行前の状態に戻しますか？${revertAllUserEditsNote(attribution, startedAt, excludedCount)}${hasDirectory ? AGENT_REVERT_DIRECTORY_NOT_UNDOABLE_NOTE : AGENT_REVERT_UNDOABLE_NOTE}` +
    trash +
    '\nステージ（index）・コミット・ブランチは戻しません。' +
    saved +
    running
  )
}
```

- [ ] **Step 6: 実装する（押せない理由・hook・テストの補助）**

`src/renderer/src/lib/agentChangesAvailability.ts`:
- `./agentChangesMessages` の import に `AGENT_CHANGES_ONLY_USER_REASON` を足す
- `agentRevertAllDisabledReason` を次にする:
```ts
/** 「すべて戻す」を押せない理由。打ち切った一覧では使えない(確認で見せていない行を照合に含められない)。
 *  記録していない行(notRecorded)を含む一覧でも使えない(main が全件を先に調べ、戻せない行があれば必ず全体を中止するため)。
 *  行がすべて利用者の変更(user・mixed)なら対象が無い(今の理由を優先する。L-057) */
export function agentRevertAllDisabledReason(
  availability: AgentRevertAvailability & {
    truncated: boolean
    hasNotRecorded: boolean
    /** 行が 1 件以上あり、すべてが利用者の変更・利用者の変更を含む(必須。L-060) */
    hasOnlyUserChanges: boolean
  }
): string | null {
  return (
    agentRevertDisabledReason(availability) ??
    (availability.truncated ? AGENT_CHANGES_TRUNCATED_REASON : null) ??
    (availability.hasNotRecorded ? AGENT_CHANGES_NOT_RECORDED_REASON : null) ??
    (availability.hasOnlyUserChanges ? AGENT_CHANGES_ONLY_USER_REASON : null)
  )
}
```

`src/renderer/src/hooks/useAgentChangesRevert.ts`:
- import の `@shared/types` に値の `import { isAgentRevertAllTarget } from '@shared/types'` を足す
- 先頭の説明の末尾に「すべて戻すの対象は、利用者の変更・利用者の変更を含む行を除いたもの(isAgentRevertAllTarget。main の照合と同じ定義。L-036)」を足す
- `AgentChangesRevertState` の `revertAllDisabledReason` の次に足す:
```ts
  /** すべて戻すから除く行(利用者の変更・利用者の変更を含む)の件数。累積の一覧が無い・打ち切った一覧(すべて戻すは使えず、残りの行の
   *  author も分からない)・実行の範囲の一覧なら 0(セクションの除く旨の 1 行に使う) */
  revertAllExcludedCount: number
```
- `const list = getListedAgentChanges(changes.view)` の次の行に足す:
```ts
  // 写しの記録(区別の要約と開始の時刻を確認に渡す)
  const recording = changes.view.kind === 'recording' ? changes.view : null
  // すべて戻すの対象と除く件数(確認の一覧と main の照合が同じ定義を使う。L-036)
  const targets = list?.entries.filter(isAgentRevertAllTarget) ?? []
  const excludedCount = list === null ? 0 : list.entries.length - targets.length
```
- `agentRevertAllDisabledReason({ ... })` の引数の `hasNotRecorded` の次に足す:
```ts
    hasOnlyUserChanges: list !== null && list.entries.length > 0 && targets.length === 0
```
- `revertFile` の `buildAgentRevertFileConfirmMessage({ ... })` の `isDirectory: entry.isDirectory,` の次に `author: entry.author,` を足す
- `revertAll` の先頭からの部分（`if (list === null || …) return` から `const expected = …` まで）を次にする:
```ts
  const revertAll = async (): Promise<void> => {
    if (list === null || list.scope.kind !== 'all' || targets.length === 0) return
    if (runner.isRunning() || revertAllDisabledReason !== null || recording === null) return
    const startedAt = startedAtNow()
    if (startedAt === null) return
    // 確認の件数・ゴミ箱の件数・フォルダの有無・保存の有無は対象だけで求める(除いた行の保存は確認で言わない)
    const message = buildAgentRevertAllConfirmMessage({
      count: targets.length,
      trashCount: targets.filter((entry) => entry.status === 'A').length,
      hasDirectory: targets.some((entry) => entry.isDirectory),
      // セクションの行の印と同じ判定(フォルダの行は配下の保存を含む)
      savedInApp: targets.some((entry) =>
        isEntrySavedInApp(folderPath, changes.savedPaths, entry.path)
      ),
      agentRunning,
      attribution: recording.attribution,
      startedAt: recording.startedAt,
      excludedCount
    })
    if (!onConfirm(message)) return
    // 未保存の編集の破棄は、既存の「すべて取り消す」と同じく別の確認で承諾させる
    if (!confirmDiscardAnyDirty()) return
    // 確認で見せた対象(パスと状態の文字)を main へ渡す。main は同じ定義で除いた実行時の一覧と完全一致で照合し、違えば中止する
    const expected = targets.map(({ path, status }) => ({ path, status }))
```
（その後の `runner.run` と結果の扱いは変えない。読み上げの件数 `expected.length` は対象の件数になる）
- 戻り値の `revertAllDisabledReason,` の次に足す:
```ts
    revertAllExcludedCount:
      list === null || list.scope.kind !== 'all' || list.truncated ? 0 : excludedCount,
```

`src/renderer/src/__tests__/makeAgentChangesState.ts` の `makeAgentChangesRevertState` の戻り値の `revertAllDisabledReason: null,` の次に `revertAllExcludedCount: 0,` を足し、説明を「既定は押せる・実行していない・失敗なし・除く行なし」にする。

- [ ] **Step 7: 通す**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`
Expected: PASS
Run: `npm test`
Expected: PASS（時間切れで落ちたファイルは単体で流し直す）
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/renderer/src/lib/agentChangesMessages.ts src/renderer/src/lib/agentChangesAvailability.ts src/renderer/src/hooks/useAgentChangesRevert.ts src/renderer/src/__tests__/makeAgentChangesState.ts src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts && npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし

- [ ] **Step 8: 変異で確かめる**

1. `revertAllUserEditsNote` の `if (excludedCount > 0)` を `else` の中（区別しているときだけ）へ移し、「区別していない要約で除く行がある…」が落ちることを確かめて戻す
2. `buildAgentRevertFileConfirmMessage` の `author === 'user' || author === 'mixed'` を `author === 'mixed'` にし、「行の ↶ の確認は、author が user なら…」が落ちることを確かめて戻す
3. `useAgentChangesRevert` の `const targets = list?.entries.filter(isAgentRevertAllTarget) ?? []` を `const targets = list?.entries ?? []` にし、「すべて戻すは、利用者の変更・利用者の変更を含む行を除いた対象だけで…」「行がすべて利用者の変更なら…」が落ちることを確かめて戻す
4. `agentRevertAllDisabledReason` の `hasOnlyUserChanges` の行を消し、「行がすべて利用者の変更(user・mixed)なら、すべて戻すを押せない…」と `文言は優先順位の規則どおり` が落ちることを確かめて戻す
5. `revertAllExcludedCount` の `|| list.truncated` を外し、「除く件数(revertAllExcludedCount)を返す。打ち切った一覧…では 0」が落ちることを確かめて戻す
6. 戻したことを `git diff` で確かめる

- [ ] **Step 9: コミット（利用者の指示があるときだけ）**

```bash
git add src/renderer/src/lib/agentChangesMessages.ts src/renderer/src/lib/agentChangesAvailability.ts src/renderer/src/hooks/useAgentChangesRevert.ts src/renderer/src/__tests__/makeAgentChangesState.ts src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts
git commit -m "feat: すべて戻すの対象から利用者の変更を除き、確認の文言を区別の状態で変える"
```

---

### Task 5: 画面（`AgentChangesFileItem` の印・`AgentChangesSection` の区別の状態の 1 行と除く旨の 1 行・`aria-describedby`）

> **気をつける知見:** L-057（印・除く旨・区別の状態を見える文字で出す）・L-413（除く旨は見える要素に置き、`すべて戻す` の `aria-describedby` で押せない理由と並べて結ぶ。設計書の形）・L-060（行の印は `entry.author` から決め、props を足さない）・L-153・L-166（区別の状態の 1 行・除く旨の 1 行は `aria-live` にしない）・L-408（新しいボタン・フォーカスの移動を足さない）

**Files:**
- Modify: `src/renderer/src/components/source-control/AgentChangesFileItem.tsx`（行の印）
- Modify: `src/renderer/src/components/source-control/AgentChangesSection.tsx`（区別の状態の 1 行・除く旨の 1 行・`すべて戻す` の `aria-describedby`・`shownReason` の上のコメント）
- Create: `src/renderer/src/components/source-control/__tests__/AgentChangesFileItem.test.tsx`
- Test: `src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`

**Interfaces:**
- Consumes: Task 2 の写しの `attribution`・`AgentChangeEntry.author`・`makeAgentChangesTrackingSummary`・`makeAgentChangesLostSummary`、Task 4 の `AGENT_CHANGES_USER_MARK`・`AGENT_CHANGES_MIXED_MARK`・`AGENT_CHANGES_ONLY_USER_REASON`・`formatAgentChangesExcludedNote(count)`・`describeAgentChangesAttribution(attribution, startedAt)`・`AgentChangesRevertState.revertAllExcludedCount`
- Produces: 画面だけ（公開の型・props は変えない）

- [ ] **Step 1: 失敗するテストを書く（行の印）**

`src/renderer/src/components/source-control/__tests__/AgentChangesFileItem.test.tsx` を作る:
```tsx
import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { AgentChangeEntry } from '@shared/types'
import AgentChangesFileItem from '../AgentChangesFileItem'
import { makeAgentChangeEntry } from '../../../__tests__/makeAgentChangesState'

// 「エージェントの変更」の 1 行の印(利用者の変更との区別。設計書「renderer(段階 B)」)。行の並び・戻すボタンの配線は AgentChangesSection.test

function renderItem(entry: AgentChangeEntry, savedInApp = false): HTMLElement {
  render(
    <ul>
      <AgentChangesFileItem
        entry={entry}
        savedInApp={savedInApp}
        disabledReason={null}
        disabledReasonId="reason"
        onOpenDiff={vi.fn()}
        onRevert={vi.fn()}
      />
    </ul>
  )
  return screen.getByRole('listitem')
}

describe('AgentChangesFileItem の利用者の変更の印', () => {
  it.each([
    ['user', '利用者の変更'],
    ['mixed', '利用者の変更を含む']
  ] as const)('author が %s なら「%s」の印を出す', (author, mark) => {
    const row = renderItem(makeAgentChangeEntry('a.txt', { author }))
    expect(within(row).getByText(mark)).toHaveClass('agent-changes__mark')
  })

  it.each(['agent', null] as const)('author が %s なら印を出さない', (author) => {
    const row = renderItem(makeAgentChangeEntry('a.txt', { author }))
    expect(within(row).queryByText(/利用者の変更/)).toBeNull()
  })

  it('「あなたの保存を含む」の印と両方出し、利用者の変更の印を前に置く', () => {
    const row = renderItem(makeAgentChangeEntry('a.txt', { author: 'user' }), true)
    expect(
      within(row)
        .getAllByText(/^(利用者の変更|あなたの保存を含む)$/)
        .map((mark) => mark.textContent)
    ).toEqual(['利用者の変更', 'あなたの保存を含む'])
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（セクション）**

`src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`:
- `../../../lib/agentChangesMessages` の import に `AGENT_CHANGES_ONLY_USER_REASON`・`formatAgentChangesExcludedNote` を足し、`../../../__tests__/makeAgentChangesState` の import に `makeAgentChangesLostSummary`・`makeAgentChangesTrackingSummary` を足し、`@shared/types` の型の import に `AgentChangesAttributionSummary` を足す
- `recordingView` の `extra` の型に `attribution?: AgentChangesAttributionSummary` を足す（`extra: { truncated?: boolean; totalCount?: number; headChanged?: boolean; attribution?: AgentChangesAttributionSummary } = {}`。本体は `{ startedAt, ...extra }` のままで渡る）
- ファイルの末尾に足す:
```tsx
describe('AgentChangesSection の利用者の変更との区別(B-2)', () => {
  const at = (hours: number, minutes: number): number =>
    new Date(2026, 9, 7, hours, minutes).getTime()
  // 記録の開始(10:42)より後の 10:50 から区別し、印を付けていない間もあった
  const lateAndUnassigned = makeAgentChangesTrackingSummary({
    since: at(10, 50),
    hadUnassignedSince: true
  })
  const lateAndUnassignedText =
    '利用者の変更の区別は 10:50 からです（それより前の変更には印を付けません）。アプリの中で claude が動いていなかった間などの変更には、印を付けていません'
  const excludedNote = formatAgentChangesExcludedNote(1)

  it('累積の一覧の上に区別の状態の 1 行を出す(読み上げの要素にしない)', () => {
    renderSection(recordingView([makeAgentChangeEntry('a.txt')], { attribution: lateAndUnassigned }))
    const note = within(section()).getByText(lateAndUnassignedText)
    expect(note).toHaveClass('agent-changes__note')
    expect(note).not.toHaveAttribute('aria-live')
  })

  it('区別の状態の 1 行は、範囲の選択の直後・直前に戻した操作の帯の前に置く', () => {
    const runs = [makeAgentChangesRun({ runId: 1, number: 1, startedAt })]
    renderSection(
      makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], {
        startedAt,
        runs,
        undo: makeAgentChangesUndoSummary(),
        attribution: lateAndUnassigned
      })
    )
    const select = within(section()).getByRole('combobox', { name: '表示' })
    const note = within(section()).getByText(lateAndUnassignedText)
    const band = within(section()).getByText(/^直前に戻した操作: /)
    expect(select.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(note.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('区別をやめた記録は理由を 1 行で出す', () => {
    renderSection(
      recordingView([makeAgentChangeEntry('a.txt')], {
        attribution: makeAgentChangesLostSummary({ reason: 'hooks-not-confirmed' })
      })
    )
    expect(
      within(section()).getByText(
        '利用者の変更を区別できません（claude の hooks から知らせが届きません）。すべてエージェントの変更として表示します'
      )
    ).toBeInTheDocument()
  })

  it('区別していない記録では、区別の状態の 1 行を出さない', () => {
    renderSection(recordingView([makeAgentChangeEntry('a.txt')]))
    expect(within(section()).queryByText(/利用者の変更/)).toBeNull()
  })

  it('実行の範囲の一覧では、区別の状態の 1 行を出さない(印は main が null にした行のため出ない)', () => {
    const RUN_1: AgentChangesScope = { kind: 'run', runId: 1 }
    renderSection(
      makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], {
        startedAt,
        runs: [makeAgentChangesRun({ runId: 1, number: 1, startedAt })],
        scope: RUN_1,
        attribution: lateAndUnassigned
      }),
      {},
      { scope: RUN_1 }
    )
    expect(within(section()).queryByText(lateAndUnassignedText)).toBeNull()
  })

  it('除く行があれば、ほか N 件の後・ボタンの並びの前に除く旨を出し、すべて戻すの aria-describedby で結ぶ', () => {
    renderSection(
      recordingView([
        makeAgentChangeEntry('a.txt', { author: 'agent' }),
        makeAgentChangeEntry('u.txt', { author: 'user' })
      ]),
      { revert: makeAgentChangesRevertState({ revertAllExcludedCount: 1 }) }
    )
    const note = within(section()).getByText(excludedNote)
    expect(note).toHaveClass('agent-changes__note')
    const revertAll = within(section()).getByRole('button', { name: 'すべて戻す' })
    expect(revertAll).toBeEnabled()
    expect(revertAll).toHaveAccessibleDescription(excludedNote)
    expect(note.compareDocumentPosition(revertAll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      within(section()).getByRole('list').compareDocumentPosition(note) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('押せない理由と除く旨が両方あるときは、すべて戻すの aria-describedby に 2 つの id を並べる(対象 0 件)', () => {
    renderSection(recordingView([makeAgentChangeEntry('u.txt', { author: 'user' })]), {
      revert: makeAgentChangesRevertState({
        revertAllDisabledReason: AGENT_CHANGES_ONLY_USER_REASON,
        revertAllExcludedCount: 1
      })
    })
    const revertAll = within(section()).getByRole('button', { name: 'すべて戻す' })
    expect(revertAll).toBeDisabled()
    expect(revertAll.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2)
    expect(revertAll).toHaveAccessibleDescription(`${AGENT_CHANGES_ONLY_USER_REASON} ${excludedNote}`)
    // 行の ↶ は押せる(押せない理由は すべて戻す だけのもの)
    expect(within(section()).getByRole('button', { name: 'u.txt を実行前の状態に戻す' })).toBeEnabled()
  })

  it('除く行が無く押せない理由も無ければ、すべて戻すに aria-describedby を付けない', () => {
    renderSection(recordingView([makeAgentChangeEntry('a.txt', { author: 'agent' })]))
    expect(within(section()).getByRole('button', { name: 'すべて戻す' })).not.toHaveAttribute(
      'aria-describedby'
    )
    expect(within(section()).queryByText(/を除いて戻します$/)).toBeNull()
  })

  it('行の印は一覧の行の author から出す(累積の一覧)', () => {
    renderSection(
      recordingView([
        makeAgentChangeEntry('a.txt', { author: 'agent' }),
        makeAgentChangeEntry('m.txt', { author: 'mixed' }),
        makeAgentChangeEntry('u.txt', { author: 'user' })
      ])
    )
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).queryByText(/利用者の変更/)).toBeNull()
    expect(within(rows[1]).getByText('利用者の変更を含む')).toBeInTheDocument()
    expect(within(rows[2]).getByText('利用者の変更')).toBeInTheDocument()
  })
})
```
- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/AgentChangesFileItem.test.tsx src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`
Expected: FAIL（印・区別の状態の 1 行・除く旨の 1 行・`aria-describedby` が無い）

- [ ] **Step 4: 実装する**

`src/renderer/src/components/source-control/AgentChangesFileItem.tsx`:
- `../../lib/agentChangesMessages` の import に `AGENT_CHANGES_MIXED_MARK`・`AGENT_CHANGES_USER_MARK` を足す
- 先頭のコメントを `// 「エージェントの変更」の 1 行(状態の文字・diff を開くパス・印・戻すボタン)。押せる条件の判定は useAgentChangesRevert。` と `// 利用者の変更の印は行の author から決める(実行の範囲の行は main が null にするため出ない。props を足さない。L-060)` の 2 行にする
- `const revertLabel = …` の次に足す:
```tsx
  const authorMark =
    entry.author === 'user'
      ? AGENT_CHANGES_USER_MARK
      : entry.author === 'mixed'
        ? AGENT_CHANGES_MIXED_MARK
        : null
```
- `{savedInApp && <span className="agent-changes__mark">{AGENT_CHANGES_SAVED_MARK}</span>}` の前の行に足す:
```tsx
      {authorMark !== null && <span className="agent-changes__mark">{authorMark}</span>}
```

`src/renderer/src/components/source-control/AgentChangesSection.tsx`:
- `../../lib/agentChangesMessages` の import に `describeAgentChangesAttribution`・`formatAgentChangesExcludedNote` を足す
- `const undoReasonId = useId()` の次に `const excludedNoteId = useId()` を足す
- `shownReason` の上のコメントを次にする:
```tsx
  // 押せない理由は 1 か所に出す。「すべて戻す」の理由は「ファイル単位の理由(実行の範囲を含む)」「打ち切り」「記録していないファイルを含む」
  // (notRecorded)「利用者の変更だけで対象が無い」のいずれか。行の戻すボタンがこの要素を参照できるのは、agentRevertAllDisabledReason が
  // ファイル単位の理由を先に評価する(行が押せないときは必ず同じ文言になる)という評価の順序に依存している
```
- `const isWriting = revert.runningOperation !== null` の前に足す:
```tsx
  // 区別の状態の 1 行(累積の範囲で、表示中の一覧が実行の範囲でないときだけ。出さないなら null)。読み上げない(aria-live にしない)
  const attributionNote =
    recording !== null && changes.scope.kind === 'all' && !isRunList
      ? describeAgentChangesAttribution(recording.attribution, recording.startedAt)
      : null
  // すべて戻すから除く行の旨(行があり、累積の一覧で、除く件数が 1 以上のとき)。すべて戻すの aria-describedby で結ぶ(L-413)
  const excludedNote =
    hasEntries && !isRunList && revert.revertAllExcludedCount > 0
      ? formatAgentChangesExcludedNote(revert.revertAllExcludedCount)
      : null
  // すべて戻すが結ぶ要素(押せない理由と除く旨のうちあるもの。どちらも無ければ付けない)
  const revertAllDescribedBy =
    [revert.revertAllDisabledReason !== null ? reasonId : null, excludedNote !== null ? excludedNoteId : null]
      .filter((id): id is string => id !== null)
      .join(' ') || undefined
```
- `AgentChangesScopeSelect` の `)}` の後（`{recording.undo !== null && (` の前）に足す:
```tsx
              {attributionNote !== null && (
                <p className="agent-changes__note">{attributionNote}</p>
              )}
```
- `formatAgentChangesMore` の `<p>` の `)}` の後（`<div className="agent-changes__actions">` の前）に足す:
```tsx
              {excludedNote !== null && (
                <p id={excludedNoteId} className="agent-changes__note">
                  {excludedNote}
                </p>
              )}
```
- `すべて戻す` のボタンの `aria-describedby={ revert.revertAllDisabledReason !== null ? reasonId : undefined }` を `aria-describedby={revertAllDescribedBy}` にする

（`npx eslint --fix` で `revertAllDescribedBy` の配列の行の折り返しが直る。CSS は変えない）

- [ ] **Step 5: 通す**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/AgentChangesFileItem.test.tsx src/renderer/src/components/source-control/__tests__/AgentChangesFileItem.styles.test.tsx src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`
Expected: PASS
Run: `npm test`
Expected: PASS（時間切れで落ちたファイルは単体で流し直す）
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/renderer/src/components/source-control/AgentChangesFileItem.tsx src/renderer/src/components/source-control/AgentChangesSection.tsx src/renderer/src/components/source-control/__tests__/AgentChangesFileItem.test.tsx src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx && npx eslint --max-warnings 0 <同じファイル>`
Expected: エラー・警告なし
Run: `git diff --stat -- src/renderer/src/assets`
Expected: 何も出ない（CSS は変えない）

- [ ] **Step 6: 変異で確かめる**

1. `AgentChangesFileItem` の `authorMark` の `<span>` を `savedInApp` の印の後へ移し、「「あなたの保存を含む」の印と両方出し、利用者の変更の印を前に置く」が落ちることを確かめて戻す
2. `AgentChangesSection` の `attributionNote` の条件から `changes.scope.kind === 'all' && !isRunList` を外し、「実行の範囲の一覧では、区別の状態の 1 行を出さない…」が落ちることを確かめて戻す
3. `revertAllDescribedBy` の配列から除く旨の id を外し（`[revert.revertAllDisabledReason !== null ? reasonId : null]` だけにし）、「除く行があれば…すべて戻すの aria-describedby で結ぶ」「押せない理由と除く旨が両方あるときは…2 つの id を並べる」が落ちることを確かめて戻す
4. 戻したことを `git diff` で確かめる

- [ ] **Step 7: コミット（利用者の指示があるときだけ）**

```bash
git add src/renderer/src/components/source-control/AgentChangesFileItem.tsx src/renderer/src/components/source-control/AgentChangesSection.tsx src/renderer/src/components/source-control/__tests__/AgentChangesFileItem.test.tsx src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx
git commit -m "feat: エージェントの変更の一覧に利用者の変更の印と区別の状態・すべて戻すから除く旨を出す"
```

---

### Task 6: ROADMAP の更新・既知の制約の整理・テスト仕様書と全体の検証（テスト仕様書への追記と Artifact の再公開）

> **気をつける知見:** L-059（モックで確かめられない届き方〈印・確認の文言・VoiceOver の読み上げ〉を実機テスト仕様書で確かめる）・L-152（既知の制約に、戻る利用者の編集の範囲を書く）

**Files:**
- Modify: `docs/manual-test-spec.md`（「## エージェントの変更の確認」の前提に 1 行、「### 利用者の変更との区別」の B-1 の前提の直しと B-2 の前提の追加、AGC-101 の削除、AGC-105 の最後の文の削除、AGC-044 の期待結果に 1 文、AGC-111 の後に AGC-112〜129 を追加。**ID は変えない・振り直さない**）
- Modify: `ROADMAP.md`（実装済み機能「エージェントが変更したファイルの確認」の既知の制約の 1 行、新しい節「エージェントの変更の利用者の編集との区別（`claude` の hooks）」、「エージェントの変更の確認の拡張」の項目の直し。**prettier にかけない**）
- Modify: `docs/superpowers/specs/2026-10-06-agent-changes-review-design.md`（注記だけ。本文は書き換えない）
- Modify: `docs/superpowers/specs/2026-10-13-agent-changes-user-edit-distinction-design.md`（「既知の制約」を実装と照らし合わせて食い違いだけを直す）
- 生成（git 管理外）: `.superpowers/manual-test-spec.html`

**Interfaces:**
- Consumes: Task 1〜5 の実装（文言は Global Constraints の「renderer の文言」と一字一句同じ。正は `src/renderer/src/lib/agentChangesMessages.ts`）
- Produces: 実機テスト仕様書の AGC-112〜AGC-129 と直した項目（コントローラーが Artifact を再公開する）

- [ ] **Step 1: 設計書の「既知の制約」を実装と照らし合わせる**

`sed -n '/^## 既知の制約/,/^## 未確認事項/p' docs/superpowers/specs/2026-10-13-agent-changes-user-edit-distinction-design.md` で読み、次を実装（Task 1〜5 のコード）と照らし合わせる。食い違いがあれば設計書の行を実装に合わせて直す（無ければ変えない）:
1. 「利用者の変更とするのは…」の行のエージェントの変更になる利用者の編集の並び（ツールの実行中・許可の確認を待つ間・ツールの終わりから 2 秒・`pending`・中断の後）が、`AGENT_REVERT_ALL_DISTINGUISHING_NOTE` の文と同じ範囲を言っているか
2. 「一覧の取り直し（`attributeEntries`）が、段階の変化の同期より先に列で走ると…」の行が、`currentPeriodPaths` の `checkSignalBeforePeriod`（段階の違いで印を立てて割り当てない）と、要約の `hadUnassignedSince`（`summarizeAttribution` が今の区間の印を見る）のとおりか
3. 「`利用者の変更` の印が付いたファイルを、その後の割り当てない間…」の行が、吸収の (1) の段階のずれで印を立てた区間（Task 1）を含んでいるか
4. 同期の手順 5〜7 の窓の行が無いこと（設計の時点で消した。`signalUnassignablePending` で塞いだ）を `grep -n '手順 5〜7' docs/superpowers/specs/2026-10-13-agent-changes-user-edit-distinction-design.md` で確かめ、「既知の制約」の節の中に当たらないこと

- [ ] **Step 2: 実機テスト仕様書の既存の項目を直す（ID は変えない）**

`docs/manual-test-spec.md`:
1. 「## エージェントの変更の確認」の冒頭の前提の 3 行目（`> 前提: 実装の自動テストでは、実物の `claude` も Electron の画面も使っていない。以下はすべて実機で未確認。期待と違ったら、その画面と `git status --porcelain` の出力を記録する。`）の次の行に足す:
```markdown
> 前提: 段階 B-2 から、確かめた状態（プロンプトを 1 回送った後）の claude が止まっている間に端末・エディタで変えたファイルは「利用者の変更」の印が付き、すべて戻すの対象から外れる。「利用者の変更との区別」より前の項目で、記録の後に端末でファイルを変える手順（エージェントの変更の代わりに端末で変えるもの）は、ターミナルパネルの claude のタブをすべて閉じてから記録を始めて行う（claude のタブが無い間に始めた記録は区別しないため、期待結果はこれまでのまま）。実行で送る手順を含む項目は claude を起動して行う。
```
2. 「### 利用者の変更との区別」の 3 つ目の前提の最後の文 `段階 B-1 でも、一覧・印・確認の文言は変わらない（区別を記録の中で持つだけ）。` を `段階 B-1 の時点では、一覧・印・確認の文言は変わらなかった（区別を記録の中で持つだけ）。段階 B-2 から印と文言が変わる（AGC-112〜）。` に置き換え、その前提の行の次の行に足す:
```markdown
> 前提: 利用者の変更との区別の B-2 の項目（AGC-112〜）は、項目ごとに、claude で「こんにちは」を送って確かめた状態にしてから、確認を終える → いまから記録する で新しい記録を始めて行う（項目に別の始め方が書いてあればそれに従う）。前の項目の記録を続けて使わない（前の項目でエージェントや利用者が変えたファイルが集合に残り、印が変わるため）。区別の文言を書いた期待結果は、`すべて戻す` の確認ではその文を「含む」形で書く（記録の経緯で区別の状態の文が加わりうる）。
```
3. AGC-101 の行（`- [ ] **AGC-101** `npm run dev` で起動し直してから、…この機能の前と変わらない`）を消す（欠番にする。B-2 の項目で置き換える。ほかの ID は振り直さない）
4. AGC-105 の行の最後の文 `エージェントの変更のセクションの一覧・確認の文言は B-1 の前と変わらない（AGC-001・AGC-002 を行う）` を消す（直前の `。` で行を終える。ほかの期待結果はそのまま）
5. AGC-044 の行の末尾（`前の実行に含まれる）` の後）に、次を足す:
```markdown
。`claude` で確かめた状態のときは、`c.txt` に `利用者の変更` の印が付く（`claude` が止まっている間の端末の編集のため。段階 B-2 から）
```
6. 前提で救えない項目が無いことを確かめる: `sed -n '/^## エージェントの変更の確認/,/^### 利用者の変更との区別/p' docs/manual-test-spec.md | grep -E '端末.*(echo|printf|mv |rm |>|seq|head -c|mkdir)' | grep -E '`実行`|「実行」' | grep -o '\*\*AGC-[0-9]*\*\*'` が `AGC-001`・`AGC-007`・`AGC-044`・`AGC-047`・`AGC-048`・`AGC-063` だけを出し、どれも端末の編集を印なし・`すべて戻す` で戻ると期待していないこと（AGC-001 は記録の前の編集、AGC-007・047・048・063 は記録の失敗の手順、AGC-044 は上の 5 で直した）を読んで確かめる。ほかの項目が出たら、その項目の期待結果に `利用者の変更` の印と `すべて戻す` から外れることを書き足すか、端末の編集をエージェントへの指示に置き換える（ID は変えない）
7. `grep -n 'あなたが編集した内容も戻ります' docs/manual-test-spec.md` が行の `↶` の確認の AGC-012 だけに当たることを確かめる（AGC-012 は変えない。`a.txt` はエージェントの変更なので追記は足されない）。`すべて戻す` の確認の文言を書いた項目が当たったら、区別している記録で行う項目だけ区別しているときの文言を含む形に直す

- [ ] **Step 3: 実機テスト仕様書に B-2 の項目を足す**

`docs/manual-test-spec.md` の AGC-111 の行の直後（同じ節の最後）に、次をそのまま足す（1 行 1 項目。今の AGC の最大は AGC-111 なので AGC-112 から振る）:
```markdown
- [ ] **AGC-112** 端末で（記録しているフォルダの直下で）`echo user >> c.txt` を実行し、`a.txt の最後に agent という行を足して` を `実行` で送り、作業の後に `更新` を押す → `M a.txt` は印なし、`M c.txt` に `利用者の変更` の印が出る。`すべて戻す` の上に `すべて戻すは、利用者の変更（1 件）を除いて戻します` が出る（VoiceOver で `すべて戻す` を選ぶと読まれる）。続けて、エージェントに `c.txt の最後に agent2 という行を足して` を送り、作業の後に `更新` → `M c.txt` の印が `利用者の変更を含む` になる。`すべて戻す` を押す → 確認に、対象の件数（`エージェントの変更 1 件`）と `エージェントのツールが動いている間（終わってから 2 秒・許可の確認を待つ間を含む）と、claude を起動してから最初のプロンプトを送るまで・中断（Esc）の後にあなたが編集した内容は、エージェントの変更として戻ります。` と `利用者の変更 1 件（印の付いた行）は戻しません。行の ↶ で個別に戻せます。` が含まれる。OK で `a.txt` だけが戻り、`c.txt` は変わらず一覧に残る。続けて `c.txt` の `↶` を押す → 確認に `このファイル（フォルダ）には、エージェントのツールが動いていない間の変更（利用者の変更）が含まれます。` が出る。OK で `c.txt` が記録の時点に戻る
- [ ] **AGC-113** 端末で `echo user >> d.txt` を実行し、`a.txt の最後に agent という行を足して` を送り、作業の後に `更新` を押して `a.txt` の `↶` で戻す → 一覧は `A d.txt`（`利用者の変更`）だけになり、`すべて戻す` は押せず、一覧の上（押せない理由の位置）に `利用者の変更だけのため、すべて戻すの対象がありません。ファイルごとに戻してください` が出て、一覧の下（`ほか N 件` の後・`すべて戻す` などのボタンの並びの上）に `すべて戻すは、利用者の変更（1 件）を除いて戻します` が出る（VoiceOver で `すべて戻す` を選ぶと、この 2 つが読まれる）
- [ ] **AGC-114** エージェントに `npm init -y を実行して` を送り（`Bash`）、作業の後に `更新` → `A package.json` は印なし（シェルの変更はエージェントに数える）。確かめたら端末で `rm package.json` を実行する
- [ ] **AGC-115** エージェントに `sleep 20 を実行して` を送り、実行中に端末で `echo during >> b.txt` を実行し、終わった後に `更新` → `M b.txt` は印なし（ツールの実行中の利用者の編集はエージェントに数える）
- [ ] **AGC-116** 消してよいファイルを端末の `echo tmp > tmp.txt` で作ってから記録を始め、`rm tmp.txt を実行して` を送り、許可の確認が出ている間に端末で `echo wait >> b.txt` を実行してから許可し、終わった後に `更新` → `M b.txt` は印なし（許可を待つ間はツールの区間に含まれる）
- [ ] **AGC-117** エージェントに `sleep 20 を実行して` を送り、実行中に Esc で中断し、すぐ端末で `echo after >> b.txt` を実行して `更新` → `M b.txt` は印なし（中断では `Stop` が届かず、次のターンの `Stop` まで区間が開いたまま）。中断から 30 秒以内に次の指示（`こんにちは`）を送り、作業が終わった後に端末で `echo after2 >> f.txt` を実行して `更新` → `A f.txt` に `利用者の変更` が出る（次の作業の始まりでターンの終わりの待ちが取り消される）
- [ ] **AGC-118** テスト用リポジトリ（記録しているフォルダ）の直下の `.claude/settings.local.json` に `{"hooks":{"PostToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"(sleep 1; echo x >> b.txt) > /dev/null 2>&1 &"}]}]}}` を置いて（既にそのファイルがあれば中身を控えてから置き換える。AGC-106 と同じ置き方）から `claude` を起動し、`こんにちは` を送って確かめた状態にしてから `確認を終える` → `いまから記録する` で記録を始め、`a.txt の最後に agent4 という行を足して` を送り、作業の後に `更新` → `M b.txt` は印なし（hook は書き込みを背景に回してすぐ終わるため、`PostToolBatch` は書き込みの前に届き、`b.txt` への書き込みは `PostToolBatch` の約 1 秒後〈2 秒の猶予の中〉に起きる。猶予が無ければ `利用者の変更` の印が付く）。開発版のログで `event=PostToolBatch` の行の後に `猶予の終わり … phase=agent→idle` の行が出ることも見る。確かめたら `.claude/settings.local.json` を消す（控えた中身があれば戻す）
- [ ] **AGC-119** `確認を終える` を押し、ターミナルパネルで新しい `claude` のタブを起動して、何も送らずに `いまから記録する` を押し（この項目は確かめた状態にせずに始める）、端末で `echo pre >> b.txt` を実行してから `こんにちは` を送って `更新` → `M b.txt` は印なし（最初の知らせの前の `pending` の間はエージェントの区間として数える）。区別の状態の 1 行に `利用者の変更の区別は HH:MM からです（それより前の変更には印を付けません）` が出る（始点を取っている間の区間は割り当てないため、区別は記録の開始の直後の時刻から）
- [ ] **AGC-120** `a.txt の最後に agent という行を足して` を送り、作業の後に `更新` を押して `a.txt` の `↶` で戻した後、エージェントに同じ変更をやり直させて `更新` → `M a.txt` は印なし（戻す操作は利用者の変更に数えない）
- [ ] **AGC-121** エージェントに `a.txt の最後に rewind という行を足して` を送り、作業の後に `claude` の `/rewind` でその変更を戻してから `更新` → 戻ったファイルの行が残っていれば `利用者の変更` の印が付く（`/rewind` はツールを使わないため。既知の制約）。出方を記録する
- [ ] **AGC-122** 2 つ目のタブで `claude` を起動し（`こんにちは` を送って確かめた状態にする）、1 つ目のタブに `sleep 20 を実行して` を送り、その実行中に、2 つ目のタブは止めたまま端末で（記録しているフォルダの直下で）`echo x >> b.txt` を実行し、終わった後に `更新` → `M b.txt` は印なし（どれかのタブのツールが動いていればエージェントの区間）
- [ ] **AGC-123** 記録を始めた後、すべてのエージェントのタブを閉じてから端末で `echo closed >> b.txt` を実行して `更新` → `M b.txt` に印が付かず、区別の状態の 1 行 `アプリの中で claude が動いていなかった間などの変更には、印を付けていません` が出る。`すべて戻す` の確認に `アプリの中で claude が動いていなかった間などのあなたの編集も戻ります。` が含まれる
- [ ] **AGC-124** `確認を終える` を押し、利用者の設定（`~/.claude/settings.json`）に `"disableAllHooks": true` を書いてから `claude` を起動し、`いまから記録する` を押してから `a.txt を読んで要約して` を送り、作業中になってから 15 秒以上待って `更新` → セクションに `HH:MM から利用者の変更を区別できなくなりました（claude の hooks から知らせが届きません）。それ以降の変更には印を付けません` か `利用者の変更を区別できません（claude の hooks から知らせが届きません）。すべてエージェントの変更として表示します` が出て、印は付かない。確かめたら設定を戻す
- [ ] **AGC-125** `a.txt の最後に agent という行を足して` を `実行` で送り、作業の後に端末で `echo user >> c.txt` を実行して `更新` を押してから、`表示` で `実行 1` を選ぶ → 印・区別の状態の 1 行・除く旨の 1 行が出ない（`すべて（累積）` に戻すと `M c.txt` に `利用者の変更` の印が出る）
- [ ] **AGC-126** 一時的に `.claude/settings.local.json` に `PostToolUse`（matcher `Edit`）の `command` の hook `sleep 3; echo fmt >> e.txt` を置いてから `claude` を起動し（`こんにちは` を送って確かめた状態にしてから記録を始める）、`a.txt の最後に agent3 という行を足して` を送り、作業の後に `更新` → `A e.txt` は印なし（利用者の hook の 3 秒の書き込みも `PostToolBatch` までエージェントの区間）。確かめたら hook と `e.txt` を消す
- [ ] **AGC-127** `sleep 20 を実行して` を送り、実行中に Esc で中断して、次の指示を送らずに 40 秒待ってから端末で `echo held >> b.txt` を実行して `更新` → `M b.txt` は印なしで、区別の状態の 1 行 `アプリの中で claude が動いていなかった間などの変更には、印を付けていません` が出る（区別をやめた旨の 1 行は出ない）。続けて `こんにちは` を送り、作業が終わった後に端末で `echo resumed >> f.txt` を実行して `更新` → `A f.txt` に `利用者の変更` が出る（次の知らせで保留が解けた）
- [ ] **AGC-128** エージェントが止まっている間にアプリのエディタで `b.txt` を編集して保存し、`更新` を押す → `M b.txt` に `利用者の変更` と `あなたの保存を含む` の 2 つの印が出る。`すべて戻す` は押せない（対象 0 件）。続けて `a.txt の最後に agent という行を足して` を送り、作業の後に `更新` して `すべて戻す` を押す → 確認に `記録を始めた後にアプリで保存したファイルを含みます。` が出ない（`b.txt` は対象から外れる）
- [ ] **AGC-129** ターミナルパネルの `claude` のタブをすべて閉じてから `確認を終える` を押し、`いまから記録する` を押して端末で `echo none >> b.txt` を実行して `更新` → `M b.txt` は印なしで、区別の状態の 1 行は出ない。`すべて戻す` の確認は `記録を始めた後にあなたが編集した内容も戻ります。` のまま（`claude` のタブが無い間に始めた記録は区別しない）
```

- [ ] **Step 4: HTML を再生成し、仕様書の検査を通す**

Run: `node scripts/build-manual-test-spec.mjs`
Expected: `.superpowers/manual-test-spec.html (N 領域 / M 項目)` が出る（項目の数が直す前より 17 増えている。18 件の追加と AGC-101 の削除）
Run: `npx vitest run scripts`
Expected: PASS（ID の一意性・接頭辞ごとの連番の昇順〈欠番は許容〉・書式）

Artifact（<manual-test-spec-artifact-url>）の再公開は、このタスクの実装者ではなく**コントローラーが** `.superpowers/manual-test-spec.html` を同じファイルパスで公開して行う（実装者は HTML の生成までで止め、報告に「再公開が必要」と書く）。

- [ ] **Step 5: ROADMAP を更新する（prettier にかけない）**

`<実装の日>` は `date +%Y-%m-%d` の出力に置き換える。

1. 実装済み機能「### エージェントが変更したファイルの確認（MVP の次）」の既知の制約の `- 実行中の利用者の編集は、エージェントの変更と区別できない。アプリで保存したパスだけは印を付けるが、アプリの外での編集は分からない` を次に置き換える:
```markdown
- アプリの中で起動した claude のツールが動いている間（終わってから 2 秒を含む）の利用者の編集は、エージェントの変更と区別できない（<実装の日> から、それ以外の間の編集は「利用者の変更」の印が付き、すべて戻すから外れる。「エージェントの変更の利用者の編集との区別（claude の hooks）」を参照）
```
2. 「### エージェントの変更の戻した操作の取り消しと記録の gc からの保護」の節の最後の既知の制約の行（`- 戻す操作は、作業ツリーを変える前に控えを取るため、…`）の後、`---`（`## MVP: エージェント CLI のアプリ内ターミナル実行` の前の区切り）の前に、空行を 1 つ置いて新しい節を足す:
```markdown
### エージェントの変更の利用者の編集との区別（`claude` の hooks）

設計書: `docs/superpowers/specs/2026-10-13-agent-changes-user-edit-distinction-design.md`（2026-10-13〜<実装の日>。段階 A・B-1・B-2）。

- [x] アプリが起動する `claude` に `--settings` で `http` の hooks を渡し、main の `127.0.0.1` の受け口で受けて、ウィンドウごとにエージェントのファイルを書くツール・シェルが動いているかを追跡する（`claude` の版が 2.1.101 より古い・確かめられないときは hooks を渡さない）
- [x] ID があって `agent_id` の無いツールの区間を `PostToolBatch` まで開いたままにし、作業の終わりから 30 秒 `Stop` が届かなければ次の知らせまで割り当てを保留する
- [x] 記録の中で、エージェントのツールが動いていない間に変わったパスを判定の区切りの差分で利用者の変更として持ち、アプリの戻す操作・取り消しは吸収する
- [x] 累積の一覧の行に `利用者の変更`・`利用者の変更を含む` の印を出し、`すべて戻す` の対象から外す（除く行があれば `すべて戻す` の上に `すべて戻すは、利用者の変更（M 件）を除いて戻します` を出し、確認の件数と文言を区別の状態で変える。すべてが印の付いた行なら押せない）
- [x] 累積の一覧の上に区別の状態（区別を始めた時刻・区別できない理由・印を付けていない間があったこと）を 1 行出し、行の `↶` の確認に、利用者の変更の行ではその旨の 1 文を足す

段階ごとの実装:
- 実装済み（2026-10-13。段階 A）: hooks の受け取りとツールの区間の追跡（画面は変わらない。アプリが起動する `claude` に `--settings` で `http` の hooks を渡し、main の `127.0.0.1` の受け口で受け、ウィンドウごとにエージェントのファイルを書くツール・シェルが動いているかを追跡して開発版のログに出す。`claude` の版が 2.1.101 より古い・確かめられないときは hooks を渡さない）
- 実装済み（2026-10-14。段階 B-1）: PostToolBatch・hooks が届かなくなったときの保留・写しによる判定（内部で持つだけで画面は変わらない。ID があって `agent_id` の無いツールの区間を `PostToolBatch` まで開いたままにし、作業の終わりから 30 秒 `Stop` が届かなければ次の知らせまで割り当てを保留する。記録の中で、エージェントのツールが動いていない間に変わったパスを判定の区切りの差分で利用者の変更として持ち、アプリの戻す操作・取り消しは吸収する。開発版のログ `[agent-attribution]` で見る。B-1 から利用者に見える挙動として、区別している記録がある間、ツールが動いていない状態からエージェントのツールを始めるときは、判定の区切りを取り終えるまで待たされ〈約 0.3 秒、上限 5 秒〉、区別している記録がある間、行の `↶`・ハンク・`すべて戻す`・取り消しのたびに区切りを取る〈作業ツリーを変えたとき・操作が失敗したときは 2 回で約 0.6 秒、投げずに 1 件も変えずに終わったときは 1 回〉）
- 実装済み（<実装の日>。段階 B-2）: 行の印（利用者の変更・利用者の変更を含む）・すべて戻すの対象から外す・区別の状態の表示

既知の制約（設計書の「既知の制約」と同じ）:
（ここに、Step 1 で照らし合わせた後の設計書の「## 既知の制約（ROADMAP・実機テスト仕様書に反映する）」の `- ` で始まる箇条を、下の手順のコマンドの出力のとおり順を変えずに置く）
```
   - 「段階ごとの実装」の B-1 の行は、項目の下の `      - 実装済み（2026-10-14。段階 B-1。設計書 …）: PostToolBatch・…` の行の `）: ` より後の本文と同じ（計画の時点の本文を上に写した。実装の時点で ROADMAP の本文が変わっていたら、ROADMAP の本文に合わせる）
   - 「既知の制約」は、`sed -n '/^## 既知の制約（ROADMAP/,/^## 未確認事項/p' docs/superpowers/specs/2026-10-13-agent-changes-user-edit-distinction-design.md` の出力のうち `- ` で始まる行だけを、順を変えずにそのまま写す（段階 A の既知の制約〈`--settings` が見える・`claude --version`・版・偽の知らせ・異常終了・Windows・Linux〉は設計書の箇条に含まれているため、項目の下の段階 A の既知の制約の 6 行は別に写さない）
3. 「## 今後実装した方がよい機能（未実装）」の「- [ ] エージェントの変更の確認の拡張:」の項目の下の、`      - 実装済み（2026-10-13。段階 A。…` の行から `      - 残り: …` の行まで（段階 A の実装済みの行・`      - 既知の制約（段階 A。…）:` とその下の 6 行・段階 B-1 の実装済みの行・残りの行）を次の 2 行に置き換える（2026-10-12・2026-10-13 の 2 行はそのまま残す。字下げは 6 つの空白）:
```markdown
      - 実装済み（<実装の日>。段階 B-2。設計書 `docs/superpowers/specs/2026-10-13-agent-changes-user-edit-distinction-design.md`）: 行の印（利用者の変更・利用者の変更を含む）・すべて戻すの対象から外す・区別の状態の表示。段階 A・B-1 を含め、実装済み機能の「エージェントの変更の利用者の編集との区別（`claude` の hooks）」を参照
      - 残り: Git 管理外のフォルダでの記録
```
4. 項目の本体（`- [ ] エージェントの変更の確認の拡張:`）は完了にしない（`[ ]` のまま。残りに「Git 管理外のフォルダでの記録」があるため）

- [ ] **Step 6: 2026-10-06 の設計書へ注記する（本文は書き換えない）**

`docs/superpowers/specs/2026-10-06-agent-changes-review-design.md` の次の 5 か所に、`<実装の日>` を `date +%Y-%m-%d` の出力に置き換えて注記を足す（どれも空行で前後と区切った 1 行の引用）:
1. 「### 選択肢の比較」の箇条の最後の行（`- (e) は将来の候補（「この機能の後の候補」）。…別に判断する`）の後:
```markdown
> <実装の日> に変更: 2026-10-13-agent-changes-user-edit-distinction-design.md で、アプリが起動する claude に --settings で http の hooks を渡し、エージェントのツールが動いていない間に変わったファイルを「利用者の変更」として区別するようにした（(e) の「エージェントが書いたパスを受け取る」形ではなく、ツールの区間と作業ツリーの区切りの差分で区別する）。累積の一覧の印と、すべて戻すの対象から外すことを足した。この表と行は当時の判断。
```
2. 「### 状況ごとの扱い」の表の直後:
```markdown
> <実装の日> に変更: 「実行中の利用者の編集」は、アプリの中で起動した claude のツールが動いていない間の編集なら「利用者の変更」の印が付き、すべて戻すから外れる（2026-10-13-agent-changes-user-edit-distinction-design.md）。ツールが動いている間（終わってから 2 秒を含む）の編集は今も区別できない。`あなたの保存を含む` の印は残す。
```
3. 「### 利用者自身の編集を誤って破棄しない確認」の箇条の直後:
```markdown
> <実装の日> に変更: 区別している記録では、すべて戻すの確認の文言が区別の状態で変わる（`記録を始めた後にあなたが編集した内容も戻ります。` の代わりに、ツールの実行中などの編集がエージェントの変更として戻る旨と、戻さない利用者の変更の件数を出す）。区別していない記録と、行の ↶ の確認の今の文言は変えず、行の ↶ では利用者の変更の行にその旨の 1 文を足す。`あなたの保存を含む` の印と追記は残す（2026-10-13-agent-changes-user-edit-distinction-design.md の「確認の文言」）。
```
4. 「### 確認ダイアログの文言」の既存の `> 2026-10-13 に変更: …` の行の直後:
```markdown
> <実装の日> に変更: すべて戻すの確認の `記録を始めた後にあなたが編集した内容も戻ります。` は、区別している記録では区別の状態の文に変わる（2026-10-13-agent-changes-user-edit-distinction-design.md の「確認の文言」）。行の ↶ の確認は今の文言のまま、利用者の変更の行（`利用者の変更`・`利用者の変更を含む`）にはその旨の 1 文を足す。ハンクの確認と `あなたの保存を含む` は変えない。
```
5. 「## 既知の制約（…）」の箇条の最後の行の後（`## 未確認事項` の前）と、「## この機能の後の候補」の箇条の最後の行の後（`## 実装の分割案` の前）に、それぞれ:
```markdown
> <実装の日> に変更: 「実行中の利用者の編集は、エージェントの変更と区別できない」の行と、候補の「`claude` の hooks（`--settings`）で…利用者の編集と区別する」の行は、2026-10-13-agent-changes-user-edit-distinction-design.md で実装した（アプリの中で起動した claude のツールが動いている間〈終わってから 2 秒を含む〉の編集は今も区別できない）。
```

- [ ] **Step 7: 全体の検証**

Run: `npm test`
Expected: PASS（すべてのテスト。時間切れで落ちたファイルは `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書く）
Run: `npm run typecheck`
Expected: PASS
Run: `git diff --name-only -- '*.ts' '*.tsx' && git ls-files --others --exclude-standard -- '*.ts' '*.tsx'` で、このプランで変更・作成した TypeScript のファイルを列挙し、`npx eslint --max-warnings 0 <列挙したファイル>`
Expected: エラー・警告なし
Run: `npx vitest run scripts`
Expected: PASS
Run: `git status --short`
Expected: このプランで変えたファイルと、設計書・プランの未追跡・変更のファイルだけが出る（`.superpowers/` は git 管理外）

- [ ] **Step 8: コミット（利用者の指示があるときだけ）**

```bash
git add docs/manual-test-spec.md ROADMAP.md docs/superpowers/specs/2026-10-06-agent-changes-review-design.md docs/superpowers/specs/2026-10-13-agent-changes-user-edit-distinction-design.md
git commit -m "docs: 段階 B-2 の完了を ROADMAP に移し、実機テスト仕様書の AGC-112〜129 と既存の項目の直しを追加する"
```

---

## Self-Review（計画の作成者が設計書と照らし合わせた結果）

**1. 設計書の要件と対応するタスク:**

| 設計書の要件（B-2） | タスク |
| --- | --- |
| `signalUnassignablePending`（`initialAttribution` で false・`notifyAttributionSignal` で立てる・同期の手順 4 で下ろし手順 9 で OR してから下ろす・`nextPeriodStart` の `signalMarkedDuringSync`・`lost` で捨てる） | 1 |
| 吸収の (1) の始めの合図（`lost` なら `markAttributionLost`・段階の違いか `unassignable` なら印）、`checkSignalBeforePeriod` の切り出し | 1（設計書のタスク 3 から前倒し） |
| `needsCurrentPeriod` → `currentPeriodTracking`、`authorsOf` の重ねた判定を外す（振る舞いは変えない） | 1 |
| `AgentChangeEntry.author`・`AgentChangesState`・`AgentChangesListResult` の `attribution`（必須）・`isAgentRevertAllTarget`・型の説明の直し | 2 |
| main の一覧の関数の `author: null`・`recordingState` と一覧の `attribution`・`summarizeAttribution` の今の区間の印 | 2 |
| renderer の写し（`types.ts`・`planRecordingState`・`planListResult`）・`isSameAgentChangesView` のテスト・テストの補助の `author: null`・`attribution` | 2 |
| `collectCurrent`（registry と `AttributionSyncContext`）・`currentPeriodPaths`・`attributeEntries`（`attributionWarn`・`loseAfterUnexpectedError`・`event=lost`・待たない） | 3 |
| `listAgentChangesInScope` の 3 つ目の引数と要約の順・`AgentRevertContext.attributeEntries`・`revertAllAgentChanges` の流れ（上限 → `author` → 絞り込み → 照合 → 全件の検査 → 適用。0 件で `applied: 0`） | 3 |
| handler（`Pick`・`agentChanges:list`・`revertContextOf(ownerId, record)`）・L-449 の順のテスト・配線（`collectCurrent` の同一性）・実 git の結合 | 3 |
| 「確認の文言」の定数・関数（行の印・除く旨・対象 0 件の理由・理由の 4 つ・区別の状態の 1 行・`isAgentChangesAttributionDistinguishing`・`すべて戻す` の順 1〜5・行の `↶` の追記・ハンクは変えない） | 4 |
| `agentRevertAllDisabledReason` の `hasOnlyUserChanges`（今の理由を優先）・`useAgentChangesRevert` の対象・確認の引数・`revertAllExcludedCount`・`makeAgentChangesRevertState` | 4 |
| `AgentChangesFileItem` の印（`あなたの保存を含む` の前）・`AgentChangesSection` の区別の状態の 1 行（範囲の選択の直後・帯の前・累積だけ）・除く旨の 1 行（`ほか N 件` の後・ボタンの並びの前）・`aria-describedby`・`shownReason` の上のコメント・CSS を変えない | 5 |
| ROADMAP（新しい節・項目の 2 行・「エージェントが変更したファイルの確認」の既知の制約の 1 行）・2026-10-06 の設計書への注記・設計書の「既知の制約」の照合・実機テスト仕様書（前提の 2 行・AGC-101 の削除・AGC-105 の直し・前提で救えない項目の確かめ・AGC-112〜129）・HTML の再生成と `npx vitest run scripts`・全体の検証 | 6 |
| 「テスト方針」段階 B-2 の各項目（タスク 1〜5） | 各タスクの Step 1〜3 と「変異で確かめる」 |

抜けは見つからなかった。「新しい状態と既存の入口」の `getDiff`（影響しない）と実行の範囲（`author: null`）は、Task 3 の `listAgentChangesInScope` の実行の範囲のテストと、`getAgentChangeDiffInScope` を変えないことで満たす。「エラー処理」の B-2 の 4 行は、Task 1（吸収の (1) の始めの合図 2 行）・Task 3（`attributeEntries` の予期しない例外・対象 0 件の main の照合）・Task 4（対象 0 件の renderer の理由）で満たす。

**2. 書きかけの検索:** `TBD`・`TODO`・「同じように」・説明だけのコードの Step を探した。ROADMAP の新しい節の B-1 の行は、計画の時点の ROADMAP の本文を写した。既知の制約は Step 1 で実装と照らし合わせた後の設計書の箇条を写す（写し元と取り出すコマンドを Step 5 に書いた）。Task 2 Step 4 の既存のテストの直しは、規則と対象のファイル・行の目印を書いた（型と `toEqual` の違いで落ちたものだけを、その規則で直す）。

**3. 名前と型の一貫性:** `signalUnassignablePending`・`currentPeriodTracking`・`checkSignalBeforePeriod(ctx, attribution)`・`nextPeriodStart({ …, signalMarkedDuringSync })`・`collectCurrent`・`currentPeriodPaths(ctx, entries)`・`attributeEntries(ownerId, record, entries)`・`listAgentChangesInScope(record, scope, attributeEntries)`・`AgentRevertContext.attributeEntries`・`isAgentRevertAllTarget`・`attributionOffSummary`・`makeAgentChangesTrackingSummary`・`makeAgentChangesLostSummary`・`revertAllExcludedCount`・`hasOnlyUserChanges`・`AGENT_REVERT_ALL_DISTINGUISHING_NOTE` などを、Global Constraints・各タスクの Interfaces・実装・テストで同じ名前と型にした。main の既存の名前は今のコード（`markToolStartTimedOut`・`runAttributionStep`・`loseAfterUnexpectedError`・`attributionContextOf`・`logAttribution`・`snapshotCall`・`checkpointResult`・`blockQueue`・`makeAttributionOffDeps`）に合わせた。

**作成中に直した点:**
- Task 1: 吸収の (1) が記録の段階と合図の段階の違いで割り当てなくなるため、既存の `describe.each('%s の区切り・差分の失敗')` の吸収の側（記録は `idle`・既定の合図は `agent`）が「差分を閉じた区間の段階(idle)に割り当て…」で落ちることに気づき、`describe.each` の組に合図（同期は `agent`・吸収は `idle`）を足して渡す形にした。`signalOf` を `describe.each` の引数で使うため、定義を前へ移す手順を足した。設計書の決定と食い違う既存のテスト（「合図の unassignable は差分の後に今の区間の印として足す…`userPaths` に a.txt」）は消して新しいテストに置き換える手順にした
- Task 1: 窓のテストで「(3) の後も印が残る」を記録の値で見ると、続く同期が手順 4 で印を下ろす時点と競合するため、吸収の開発版のログ（`unassignable=あり`）で見る形にした
- Task 2: `planRecordingState` の写しのテストは、前の写しが `none` だと「前の写しの要約を使う」変異で落ちないため、同じ記録の写しを前に置く形にし、変異の手順を 1 つの文に直した
- Task 3: gc の後の一覧の結合テストは、今の区間の比較（`git diff`・`ls-files`）が blob を読まないことがあるため、gc の後の同期で `lost` になる経路にした（「調整した細部」に理由を書いた）。`AgentRevertContext` を作る既存のテスト（`agentChangesRevert.toctou.integration.test.ts`・`agentChangesUndo.integration.test.ts`）と、registry を作る既存の結合テスト（`agentChangesAttribution.integration.test.ts`・`agentChangesHandlers.integration.test.ts`）が型で落ちるため、同じタスクで依存を足す手順を入れた。handler のテストの戻す関数の文脈の `toHaveBeenCalledWith`（3 か所）を `attributeEntries: expect.any(Function)` を含む形に直す手順を入れた
- Task 5: 1 つのテストの中で 2 回描画していた形（`document.body.innerHTML` で消す）をやめ、区別していない記録と実行の範囲の 2 つのテストに分けた
- Task 6: ROADMAP の新しい節の B-1 の行を、写す指示ではなく計画の時点の本文にした。前提で救えない項目は計画の時点で `grep` して読み、AGC-044 に印の旨を 1 文足すだけと決めた（手順 6 で実装の時点にも確かめる）
