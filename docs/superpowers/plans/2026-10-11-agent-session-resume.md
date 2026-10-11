# エージェントのセッションの再開と履歴への記録 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エージェント CLI 方式で、main が起動ごとに `claude` のセッション ID（UUID）を振って `--session-id` / `--resume` で起動し、ターミナルのタブの `前回の続きから`・実行の履歴の `このセッションで再開` で会話を続けられるようにする。あわせて、送れたプロンプトを履歴に `送信済み` として記録し、同じ全文を今のエージェントへ送り直せるようにする。

**Architecture:** main は、起動の依頼の列挙型 `AgentLaunchRequest`（`new` / `resume`）を検証し（parser）、starter が許可のフォルダの記録（新規 `agentSessionRecordStore`、`userData/agent-sessions.json`）との照合・全ウィンドウで共有する ID の予約（新規 `claudeSessionReservations`）・引数の組み立て（`buildAgentLaunchArgs`）を spawn の直前の同期の区間で行い、起動が確定したら記録の先頭に書く。starter は pty の `sessionId` → `claudeSessionId` の Map を持ち、`already-running`・作り直しの後の合わせ込み（`getState`）・「前回」の取得（`getLastSession`）に ID を返す。registry は型の付け替えだけ。renderer は、タブの状態に `claudeSessionId` を持ち（`useAgentSessions`）、「前回」を取り直す `useAgentLastSession`、押せない理由の純粋な関数 `agentResumeAvailability`、送信の時点で送り先を控える `describeSession` と `onSent(sent)`、履歴の記録（`usePromptRunner`）、エントリごとの押せる条件 `getHistoryActions`・`onResume`（`useAgentWorkspace`）を足す。

**Tech Stack:** Electron（main・preload）, React 19, TypeScript, node-pty（注入）, Vitest, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-11-agent-session-resume-design.md`（承認済み。実装の前に必ず読む）

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
> - `createAgentSessionStarter` は関数ではなく `AgentSessionStarterService`（`start`・`claudeSessionIdOf`・`lastSessionOf`）を返す。「前回」の取得の正規化と許可のフォルダとの照合は、許可のフォルダ・`canonicalize`・記録をすでに持つ starter の `lastSessionOf` に置き、handler は委ねるだけにする。handler の依存は従来の `startSession` に加えて `claudeSessionIdOf`・`getLastSession` を別々に受け取る（既存のテストの `register({ startSession })` を変えないため）。
> - 予約の解除は、spawn の例外の `catch` と、作ったセッションの `exited` の解決の 2 か所だけにする。`AgentSession.stop` は止まりきると `finish` で `exited` を解決するため、「spawn した後の取り消しの停止の完了」「起動が確定したセッションの終了・停止」はどちらも `exited` の解決で表せる（registry の `create` が `failed` を返す経路は予約の前に返るため、外すものが無い）。
> - registry の `snapshot` は registry 専用の `AgentRegistrySnapshotEntry`（`{ slotId, sessionId }`）を返す（型の付け替えだけ。共有の `AgentSessionSnapshotEntry` に `claudeSessionId` を必須で足すため）。
> - preload の関数名は `getLastAgentSession(folderPath)`、IPC のチャンネルは `agentTerminal:getLastSession`、戻り値の共有の型は `AgentLastSession`（`{ claudeSessionId: string }`）。
> - 記録のファイルの形は `{ "version": 1, "folders": [{ "key": "<フォルダのキー>", "ids": ["<新しい順の UUID>", …] }, …] }`（`folders` は最後に記録した順）。読み込みが終わる前に `record` された分は、読み込んだ記録の前に置いて合わせる。ファイルへの書き込みは読み込みの完了を待ってから行う（読み込む前の空の記録でファイルを上書きしない）。
> - renderer のタブの `claudeSessionId` は `AgentTabSessionFields`（タブごとの状態）に持ち、同期で判定するための写しを `useAgentSessions` の ref にも持つ。設計書の `findTabByClaudeSessionId` は、表示の判定に使う純粋な関数 `findActiveAgentTabByClaudeSessionId`（`agentSessionTabState.ts`）として置く。
> - `resumeInNewTab(claudeSessionId)` は同期で `string | null`（足したタブの slotId。足さなかったら null）を返し、起動はその中で始める（完了を待たない）。`useAgentWorkspace` の `onResume` は、返った slotId を `useAgentTabActivation`（パネルを開く・選ぶ・描画の後にそのタブのターミナルへフォーカス）に渡す。
> - `useAgentLastSession` の取り直しの契機「タブの起動の成功」は、動いているタブの `claudeSessionId` を並べたキー（`refreshKey`）の変化で表す（起動に成功すると新しい ID がキーに入る）。同じフォルダの取り直しの間は前の結果を出し続け、フォルダが変わったときだけ `取得中` にする（起動のたびに理由がちらつかないように）。
> - `前回の続きから` の押せる条件と処理は `AgentTerminalPanelState.resumeLast`（`{ disabledReason, onResume(slotId) }`）として `useAgentWorkspace` で組み立てる。`onResume` は押した時点の理由を求め直し、理由があれば何もしない（L-058）。加えて `useAgentSessions.start` は、ほかのタブで動いている ID の `resume` を何もせずに返す。
> - `getHistoryActions(entry)` の戻り値は `HistoryEntryActions`（`{ rerun: { disabled, reason }; resume: { disabled, reason } | null }`。`resume` は従来のエントリでは null で、ボタンを出さない）。型は `src/renderer/src/types.ts` に置く。
> - sender の戻り値の型 `AgentPromptSendResult`（`sent` に `sentTo` を足したもの）は `lib/agentPromptSend.ts` に置く（`lib/agentSendCallbacks.ts` が読むため。lib から hooks を import しない）。`AgentSendOptions` は今の置き場（`lib/agentPromptRequest.ts`）のまま `onSent` の型だけ変える。
> - 文言の置き場: `前回の続きから`・`このセッションで再開` の押せない理由と起動の失敗の文言は `lib/agentSessionMessages.ts`、エージェントのエントリの `再実行` の理由は `lib/agentSendMessages.ts`。一覧と詳細のツールの欄の `エージェント（claude 2）` は `lib/historyFormatters.ts` の `getHistoryToolLabel(entry)`。詳細のメタ情報のタブ名は、この欄で出す。
> - 実行の履歴の一覧のプレビューは、エージェントのエントリ（結果を記録しない）では送った全文の先頭を出す（空のプレビューにしない）。
> - 設計書は「`session-in-use` のうち別のウィンドウのセッションは画面から通れるので項目にする」としているが、このアプリは 1 ウィンドウで（`src/main/index.ts` は新しいウィンドウを開かず、macOS の Dock から開き直すのは閉じた後だけ）、同じウィンドウの同じ ID は renderer が押せなくするため、画面から確実には通せない。実機テスト仕様書の項目にはせず、starter の単体テスト（別の所有者・止まりきる前・取り消しの途中）で確かめる。リロードの直後に押して当たった場合だけ記録してもらう（AGT-206）。
> - Task 3 で共有の起動の型（`launch`・`claudeSessionId` を必須）を変えてから、Task 5 で renderer を合わせるまでの間は `npm run typecheck:web` が落ちる（`useAgentSessions.ts` とそのテストなど）。Task 3・4 の検証は `npm run typecheck:node` と変更したテストで行い、Task 5 以降は `npm run typecheck`（両方）を通す。`describeAgentStartError` の 2 つの文言も Task 5 で足す。

## Global Constraints

- コメント・文言は日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。クライアントのコンポーネントには `'use client'`
- 名前の区別: main の pty のセッションの id は従来どおり `sessionId`。`claude` の会話の ID は、型・IPC・状態・変数のどこでも `claudeSessionId` と呼ぶ
- セッション ID の形式: 小文字の UUID v4 の厳密な形式 `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`（共有の `CLAUDE_SESSION_ID_PATTERN`・`isClaudeSessionId`）。新しい ID は main の `crypto.randomUUID()`
- 起動の引数の並び（main だけが決める。L-019）: 新規 `['--session-id', <UUID>]`、再開 `['--resume', <UUID>]`。`resolveAgentLaunch` の `args`（`[]`）の後ろに足す。`--continue`・`--fork-session`・`--dangerously-skip-permissions` は付けない。環境変数 `CLAUDE_CODE_SESSION_ID` を取り除く扱いは変えない
- 起動の依頼: `AgentStartRequest.launch: AgentLaunchRequest`（`{ kind: 'new' }` / `{ kind: 'resume'; claudeSessionId: string }`）は必須。`launch` が無い・`kind` が未知・余分なキー・`claudeSessionId` が文字列でない・形式に当たらない（大文字・v4 以外・`-` 始まりを含む）は parser で例外（既定の `new` に流さない。L-034・L-044）
- 起動の結果: `started`・`already-running` は `sessionId` と `claudeSessionId`（必須）を返す。`already-running` は動いているセッションの ID（依頼の `launch` は使わない）。エラーの種類に `unknown-session`・`session-in-use` を足す
- 記録: `userData/agent-sessions.json`。フォルダのキーは許可のフォルダ（main の正規化した実パス）で、Windows（`platform === 'win32'`）では小文字にそろえる。フォルダごとに新しい順・重複なし・最大 **200** 件（`AGENT_SESSION_RECORDS_PER_FOLDER`。renderer の `HISTORY_CAP` と同じ値）、フォルダは最大 **50**（`AGENT_SESSION_RECORD_FOLDERS_MAX`。古いフォルダから捨てる）。読み込みの失敗・不正な中身は空として扱い、不正な要素だけを捨てる。書き込みは直列（L-040）で、失敗はログだけ（起動の結果を変えない。L-001）
- 起動の失敗の文言: `unknown-session` → `このセッションは再開できません（アプリの起動の記録にありません）`、`session-in-use` → `このセッションはほかのタブかウィンドウで動いています`
- `前回の続きから`: ボタンの文字 `前回の続きから`、`aria-label="前回の続きから（このフォルダで最後に起動した claude のセッションを再開）"`。押せない理由は `起動` の理由（フォルダ無し・方式の切り替えの途中）を優先し、その後に `前回のセッションを確かめています` → `このフォルダで前回起動したセッションの記録がありません` → `前回のセッションは claude 2 で動いています`（`claude 2` は動いているタブの名前）。理由は `起動` の理由と同じ `agent-terminal-panel__reason` の 1 か所に見える文字で出し、ボタンの `aria-describedby` で参照する（L-057）。`disabled` 属性で押せなくし、処理の側でも同じ条件で何もしない（L-058）
- 履歴の表示: 状態 `送信済み`（`getStatusLabel('sent')`。成功・エラーと区別する中立の色）、ツールの欄 `エージェント（claude 2）`、詳細のメタ情報 `セッション: <UUID>`、送った全文の領域 `role="region"`・`aria-label="送った内容"`・`tabIndex={0}`（等幅・枠の中でスクロール）。操作の文字は `再実行`・`このセッションで再開`・`削除`
- `このセッションで再開` の押せない理由（上から順に最初の 1 つ）: `設定を読み込んでいます`（`RUN_DISABLED_LOADING_MODE`）→ `エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）` → `記録したフォルダ（<folderPath>）を開いているときだけ再開できます`（`isSamePath` で比べる）→ 既存の `startDisabledReason` → `このセッションは claude 2 で動いています` → 既存の `addDisabledReason`（`+` と同じ。上限 4）
- エージェントのエントリの `再実行` の押せない理由: エージェント CLI 方式は一覧の `実行` と同じ（`getPromptRunAvailability` に選択中のタブ）、従来の方式は `エージェント CLI 方式で記録した履歴は、エージェント CLI 方式でだけ再実行できます`。従来のエントリは今のまま（エージェント CLI 方式では `RERUN_DISABLED_AGENT_MODE`）
- 履歴の記録: エージェント CLI 方式の送信が `sent` のときだけ（確認のキャンセル・閉じた・失敗・例外では記録しない。L-001）。中身は `promptId`・`promptTitle`・`promptContent`（`sendToAgent` へ渡した全文。参照を含む）・`fileContent: null`・`toolId: 'claude'`・`status: 'sent'`・`resultText: null`・`errorMessage: null`・`executedAt`（送れた時刻）・`agent: { claudeSessionId, tabLabel, folderPath }`（送信の手順を始める時点〈`beginSending` の直前〉に `describeSession()` で控えた値。L-037）。`agent` があるときかつそのときだけ `status === 'sent'`。古い形式（`agent` 無し）は `agent: null` で読み、形の不正な `agent` は従来のエントリに読み替えずに捨てる（L-044）。`isValidHistoryEntry` と `sanitizeHistoryEntry` の両方を直す（L-015）
- 配線の漏れを型とテストで検出する（L-060）: `launch`・`claudeSessionId`・`HistoryEntry.agent`・`HistoryPanel` / `HistoryDetail` / `Sidebar` の新しい props（`getHistoryActions`・`onResume`）・`AgentTerminalPanelState.resumeLast` は省略できない形にする。`Sidebar` の今の `promptRun?.isRerunDisabled ?? isExecuting` の補いは消す。本物の hook どうしを通す結合テストを書く
- `react-hooks/set-state-in-effect`（eslint-plugin-react-hooks 7）: effect の本体で setState を直接呼ぶと lint が落ちる。値の変化の後始末は既存の `useOnChange` を使い、非同期の取得は Promise の解決の中で setState する
- テストのタイマーは後始末で必ず解除する（CLAUDE.md）。`act(...).then(...)` で書かない。`console.error`・`console.warn` の spy は `afterEach` で戻す。テストの補助関数にも戻り値の型を書く（`@typescript-eslint/explicit-function-return-type`）。テストで使う UUID は小文字の v4（例: `11111111-1111-4111-8111-111111111111`）
- 気をつける知見（dev-flow-kit の review-lessons.md）: **L-001**（記録は `sent` のときだけ・記録の書き込みの失敗で起動の成功を偽らない）、**L-015**（`agent` が保存で黙って消えない）、**L-018**（検証を通った ID をそのまま引数にする）、**L-019**（renderer は列挙型だけを渡し、コマンドと引数は main。再開の ID は main の記録と照合）、**L-034**（UUID の厳密な形式で `-` 始まりを断つ）、**L-037**（送り先の ID は送信の手順を始める時点で控える・「前回」の結果を依頼とフォルダに結び付ける）、**L-040**（古い取得結果を捨てる・記録の書き込みを直列にする）、**L-044**（`launch` 無し・未知の `kind`・不正な `agent` を既定に流さない）、**L-048**（`このセッションで再開` は `+`、`再実行` は一覧の `実行` の既存の動作に合わせる）、**L-053**（`onSent` の中の参照の後始末と履歴の記録は段ごとに別の `try`）、**L-057**（押せない理由を見える文字で出し `aria-describedby` で結ぶ。2 つのボタンの理由は別の段落・別の id）、**L-058**（`disabled` 属性と処理の側の同じ条件）、**L-059**（実物の `claude` の `--session-id`・`--resume` の挙動は実機テスト仕様書で記録する）、**L-060**（必須の props と結合テスト）、**L-061**（セッション ID を持つ `claude` を起動する入口〈`起動`・`+`・`前回の続きから`・`このセッションで再開`〉と、ID を renderer へ渡す入口〈`already-running`・作り直しの後の合わせ込み〉を列挙し、二重の起動の拒否を main の 1 か所〈判定と同時の同期の予約〉に置く）、**L-297**（実機テスト仕様書の項目が設計書の「エラーと境界の扱い」の画面から通れる行と 1 対 1 で対応し、手順が確かめたい経路を通る）
- **コミットしない。** 各タスクの最後は検証だけ（`npx vitest run <変更したテスト>`、タスクに書いた typecheck、変更した TypeScript のファイルへの `npx eslint --fix` → `npx eslint --max-warnings 0`）

---

### Task 1: 履歴の型と検証（`HistoryEntry.agent`・`'sent'`・`historyUtils`）

**Files:**
- Modify: `src/shared/types/agentTerminal.ts`（`CLAUDE_SESSION_ID_PATTERN`・`isClaudeSessionId` を足す。起動の型は Task 3 で変える）
- Modify: `src/shared/types.ts`（値の再 export に `CLAUDE_SESSION_ID_PATTERN`・`isClaudeSessionId`）
- Modify: `src/shared/types/history.ts`（`HistoryStatus` に `'sent'`、`AgentHistoryInfo`、`HistoryEntry.agent`）
- Modify: `src/main/historyUtils.ts`（`isValidHistoryEntry`・`sanitizeHistoryEntry`）
- Modify: `src/renderer/src/types.ts`（`AgentHistoryInfo` の再 export）
- Modify: `src/renderer/src/hooks/usePromptExecution.ts`（`ExecutionOutcome.agent: null`）
- Modify: `src/renderer/src/lib/historyFormatters.ts`（`getStatusLabel('sent')`）
- Test: `src/shared/__tests__/agentTerminal.test.ts`、`src/main/__tests__/historyUtils.test.ts`、`src/main/__tests__/handlers/historyHandlers.test.ts`、`src/renderer/src/lib/__tests__/historyFormatters.test.ts`、`src/renderer/src/hooks/__tests__/usePromptExecution.test.ts`
- Test（`agent: null` を足すだけ）: `src/main/__tests__/historyStore.test.ts`、`src/renderer/src/lib/__tests__/historyEntryFactory.test.ts`、`src/renderer/src/lib/__tests__/historyApi.test.ts`、`src/renderer/src/hooks/__tests__/useHistory.test.ts`、`src/renderer/src/hooks/__tests__/useHistoryPersistence.test.ts`、`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`、`src/renderer/src/hooks/__tests__/useSelectedHistoryEntry.test.ts`、`src/renderer/src/components/history/__tests__/HistoryItem.test.tsx`、`src/renderer/src/components/history/__tests__/HistoryDetail.test.tsx`、`src/renderer/src/components/history/__tests__/HistoryPanel.test.tsx`

**Interfaces:**
- Produces:
```ts
// src/shared/types/agentTerminal.ts
/** claude の会話の ID の形式(小文字の UUID v4 の厳密な形式)。`-` 始まりの値がオプションとして解釈される経路を断つ(L-034) */
export const CLAUDE_SESSION_ID_PATTERN: RegExp
export function isClaudeSessionId(value: unknown): value is string
// src/shared/types/history.ts
export type HistoryStatus = 'success' | 'error' | 'sent'
export interface AgentHistoryInfo {
  claudeSessionId: string
  tabLabel: string
  folderPath: string
}
export type HistoryEntry = { /* 既存のフィールド */ agent: AgentHistoryInfo | null }
// src/renderer/src/hooks/usePromptExecution.ts
export interface ExecutionOutcome extends ExecutionContext { /* 既存 */ agent: null }
// src/renderer/src/lib/historyFormatters.ts
export function getStatusLabel(status: HistoryStatus): string // 'sent' → '送信済み'
```

- [ ] **Step 1: 既存のテストの履歴の値に `agent: null` を足す**

`executedAt` が最後のプロパティ（末尾にカンマが無い行）になっている `HistoryEntry` の値の後ろに `agent: null` を足す:
```bash
perl -0pi -e 's/\n(\s*)executedAt: ([^\n,]+)\n/\n$1executedAt: $2,\n$1agent: null\n/g' \
  src/main/__tests__/handlers/historyHandlers.test.ts \
  src/main/__tests__/historyStore.test.ts \
  src/main/__tests__/historyUtils.test.ts \
  src/renderer/src/lib/__tests__/historyEntryFactory.test.ts \
  src/renderer/src/lib/__tests__/historyApi.test.ts \
  src/renderer/src/hooks/__tests__/useHistory.test.ts \
  src/renderer/src/hooks/__tests__/useHistoryPersistence.test.ts \
  src/renderer/src/hooks/__tests__/usePromptRunner.test.ts \
  src/renderer/src/hooks/__tests__/useSelectedHistoryEntry.test.ts \
  src/renderer/src/components/history/__tests__/HistoryItem.test.tsx \
  src/renderer/src/components/history/__tests__/HistoryDetail.test.tsx \
  src/renderer/src/components/history/__tests__/HistoryPanel.test.tsx
git diff --stat
```
Expected: 上の 12 ファイルが変わる（`git diff` で、足した行が履歴の値の中だけにあることを目で確かめる）。

- [ ] **Step 2: 失敗するテストを書く**

`src/shared/__tests__/agentTerminal.test.ts` の import に `CLAUDE_SESSION_ID_PATTERN`・`isClaudeSessionId` を足し、末尾に足す:
```ts
describe('isClaudeSessionId', () => {
  it.each([
    '11111111-1111-4111-8111-111111111111',
    'abcdef01-2345-4678-9abc-def012345678',
    '00000000-0000-4000-b000-000000000000'
  ])('小文字の UUID v4 は通す: %s', (value) => {
    expect(isClaudeSessionId(value)).toBe(true)
    expect(CLAUDE_SESSION_ID_PATTERN.test(value)).toBe(true)
  })

  it.each([
    ['大文字', 'ABCDEF01-2345-4678-9ABC-DEF012345678'],
    ['v4 以外(版の桁が 1)', '11111111-1111-1111-8111-111111111111'],
    ['異形(variant の桁が c)', '11111111-1111-4111-c111-111111111111'],
    ['- 始まり(オプションとして解釈される)', '--dangerously-skip-permissions'],
    ['- 始まりの UUID の形', '-1111111-1111-4111-8111-111111111111'],
    ['前後の空白', ' 11111111-1111-4111-8111-111111111111'],
    ['末尾の改行', '11111111-1111-4111-8111-111111111111\n'],
    ['空', ''],
    ['文字列以外', 1],
    ['null', null]
  ])('%s は通さない', (_label, value) => {
    expect(isClaudeSessionId(value)).toBe(false)
  })
})
```

`src/main/__tests__/historyUtils.test.ts` の `validEntry` の次に足し、末尾に `describe` を足す:
```ts
const agentEntry: HistoryEntry = {
  ...validEntry,
  id: 'h-agent',
  toolId: 'claude',
  status: 'sent',
  resultText: null,
  agent: {
    claudeSessionId: '11111111-1111-4111-8111-111111111111',
    tabLabel: 'claude 2',
    folderPath: '/work'
  }
}
// agent の無い古い形式の値(保存済みの古い history.json の要素)
const withoutAgent = (entry: HistoryEntry): Record<string, unknown> => {
  const legacy: Record<string, unknown> = { ...entry }
  delete legacy.agent
  return legacy
}
```
```ts
describe('isValidHistoryEntry: エージェントのエントリ(agent・sent)', () => {
  it('agent の無い古い形式は有効(sanitize で agent: null になる)', () => {
    const legacy = withoutAgent(validEntry)
    expect(isValidHistoryEntry(legacy)).toBe(true)
    expect(sanitizeHistoryEntry(legacy as HistoryEntry).agent).toBeNull()
  })

  it('正しい形のエージェントのエントリは有効', () => {
    expect(isValidHistoryEntry(agentEntry)).toBe(true)
  })

  it('agent があるのに status が sent でなければ不正(従来のエントリへ読み替えない。L-044)', () => {
    expect(isValidHistoryEntry({ ...agentEntry, status: 'success' })).toBe(false)
    expect(isValidHistoryEntry({ ...agentEntry, status: 'error' })).toBe(false)
  })

  it('status が sent なのに agent が無い・null なら不正', () => {
    expect(isValidHistoryEntry({ ...validEntry, status: 'sent' })).toBe(false)
    expect(isValidHistoryEntry({ ...withoutAgent(validEntry), status: 'sent' })).toBe(false)
  })

  it.each([
    ['オブジェクトでない', 'x'],
    ['配列', []],
    ['claudeSessionId が UUID の形式でない', { claudeSessionId: 'abc', tabLabel: 'claude 1', folderPath: '/w' }],
    [
      'claudeSessionId が - 始まり',
      { claudeSessionId: '--resume', tabLabel: 'claude 1', folderPath: '/w' }
    ],
    [
      'tabLabel が空',
      { claudeSessionId: '11111111-1111-4111-8111-111111111111', tabLabel: '', folderPath: '/w' }
    ],
    [
      'folderPath が空',
      { claudeSessionId: '11111111-1111-4111-8111-111111111111', tabLabel: 'claude 1', folderPath: '' }
    ],
    [
      'tabLabel が文字列でない',
      { claudeSessionId: '11111111-1111-4111-8111-111111111111', tabLabel: 1, folderPath: '/w' }
    ]
  ])('agent が %s なら不正', (_label, agent) => {
    expect(isValidHistoryEntry({ ...agentEntry, agent })).toBe(false)
  })
})

describe('sanitizeHistoryEntry: agent', () => {
  it('agent を残し、agent の中の余分なキーを落とす(保存で黙って消えない。L-015)', () => {
    const withExtra = {
      ...agentEntry,
      agent: { ...agentEntry.agent, extra: 'x' }
    } as HistoryEntry
    expect(sanitizeHistoryEntry(withExtra)).toEqual(agentEntry)
    expect(sanitizeHistoryEntry(withExtra).agent).not.toHaveProperty('extra')
  })

  it('agent: null を保持する', () => {
    expect(sanitizeHistoryEntry(validEntry).agent).toBeNull()
  })
})
```

`src/main/__tests__/handlers/historyHandlers.test.ts` の `describe('history:save', …)` の中に足す（`sampleEntry` の次に、下の `agentEntry` と `withoutAgent` を置く）:
```ts
    it('エージェントのエントリは agent を残したまま saveHistory に渡す(L-015)', async () => {
      await getRegisteredHandler('history:save')(makeEvent(), [agentEntry, sampleEntry])
      expect(mockSaveHistory).toHaveBeenCalledWith([agentEntry, sampleEntry])
    })

    it('agent の無い古い形式は agent: null にして saveHistory に渡す', async () => {
      await getRegisteredHandler('history:save')(makeEvent(), [withoutAgent(sampleEntry)])
      expect(mockSaveHistory).toHaveBeenCalledWith([sampleEntry])
    })
```
```ts
const agentEntry: HistoryEntry = {
  ...sampleEntry,
  id: 'h-agent',
  toolId: 'claude',
  status: 'sent',
  resultText: null,
  agent: {
    claudeSessionId: '11111111-1111-4111-8111-111111111111',
    tabLabel: 'claude 2',
    folderPath: '/work'
  }
}
// agent の無い古い形式の値(保存済みの古い history.json の要素)
const withoutAgent = (entry: HistoryEntry): Record<string, unknown> => {
  const legacy: Record<string, unknown> = { ...entry }
  delete legacy.agent
  return legacy
}
```

`src/renderer/src/lib/__tests__/historyFormatters.test.ts` の `describe('getStatusLabel', …)` に足す:
```ts
  it('sent のとき「送信済み」を返す(結果を知らないので成功と出さない)', () => {
    expect(getStatusLabel('sent')).toBe('送信済み')
  })
```

`src/renderer/src/hooks/__tests__/usePromptExecution.test.ts` の「成功時、…」のテスト（`expect.objectContaining({ promptId: 'p1', … errorMessage: null })`）の `errorMessage: null` の次に `agent: null` を足し、「失敗時、…」のテストの `expect.objectContaining({ status: 'error', … })` にも `agent: null` を足す（従来の方式のエントリは `agent: null` を明示する。L-060）。

- [ ] **Step 3: テストが失敗することを確かめる**

Run: `npx vitest run src/shared/__tests__/agentTerminal.test.ts src/main/__tests__/historyUtils.test.ts src/main/__tests__/handlers/historyHandlers.test.ts src/renderer/src/lib/__tests__/historyFormatters.test.ts src/renderer/src/hooks/__tests__/usePromptExecution.test.ts`
Expected: FAIL（`isClaudeSessionId` が無い、`status: 'sent'` が不正、`agent` が sanitize で落ちる、`送信済み` が `エラー`、`agent: null` が outcome に無い）

- [ ] **Step 4: 実装する**

`src/shared/types/agentTerminal.ts` の `AGENT_SLOT_ID_PATTERN` の次に足す:
```ts
/** claude の会話の ID の形式(小文字の UUID v4 の厳密な形式)。main は新しい ID を crypto.randomUUID() で作り、再開の依頼の ID も
 *  この形式で検証する(`-` 始まりの値が claude のオプションとして解釈される経路を断つ。L-034) */
export const CLAUDE_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** claude の会話の ID の形式に当たる文字列か */
export function isClaudeSessionId(value: unknown): value is string {
  return typeof value === 'string' && CLAUDE_SESSION_ID_PATTERN.test(value)
}
```
`src/shared/types.ts` の `./types/agentTerminal` の値の再 export の `AGENT_SLOT_ID_PATTERN,` の次に `CLAUDE_SESSION_ID_PATTERN,`、`isAgentExitReason` の次に `, isClaudeSessionId` を足す。

`src/shared/types/history.ts` を次にする:
```ts
import type { PromptToolId } from './cli'

/** 成功・エラーは従来の方式の実行の結果。sent はエージェント CLI 方式で送れたこと(結果は知らない。agent があるときかつそのときだけ) */
export type HistoryStatus = 'success' | 'error' | 'sent'

/** エージェント CLI 方式で送ったときの送り先(送信の手順を始める時点に控えたタブの状態とフォルダ)。送信の onSent・describeSession も同じ型 */
export interface AgentHistoryInfo {
  /** 送り先のタブで動いていた claude の会話の ID(UUID) */
  claudeSessionId: string
  /** 送り先のタブの名前(claude 2 など) */
  tabLabel: string
  /** 送ったときに開いていたフォルダ(renderer の文字列) */
  folderPath: string
}

export type HistoryEntry = {
  id: string
  promptId: string | null
  promptTitle: string
  promptContent: string
  fileContent: string | null
  toolId: PromptToolId
  status: HistoryStatus
  resultText: string | null
  errorMessage: string | null
  executedAt: number
  /** エージェント CLI 方式で送ったエントリの送り先。従来の方式のエントリは null(省略させない。L-060) */
  agent: AgentHistoryInfo | null
}
```

`src/main/historyUtils.ts` を次にする:
```ts
import type { AgentHistoryInfo, HistoryEntry, HistoryStatus, PromptToolId } from '@shared/types'
import { EXECUTION_TOOLS, isClaudeSessionId } from '@shared/types'

const TOOL_IDS = EXECUTION_TOOLS.map((tool) => tool.id) as readonly string[]

function isPromptToolId(value: unknown): value is PromptToolId {
  return typeof value === 'string' && TOOL_IDS.includes(value)
}

function isHistoryStatus(value: unknown): value is HistoryStatus {
  return value === 'success' || value === 'error' || value === 'sent'
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value !== ''

function isAgentHistoryInfo(value: unknown): value is AgentHistoryInfo {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const a = value as Record<string, unknown>
  return (
    isClaudeSessionId(a.claudeSessionId) && isNonEmptyString(a.tabLabel) && isNonEmptyString(a.folderPath)
  )
}

// agent は古い形式(undefined)・null・正しい形のオブジェクトだけを受け付け、agent があるときかつそのときだけ status は sent。
// 形の不正な agent を従来のエントリへ読み替えない(従来の方式で非対話の claude に再実行させる経路へ流れるため。L-044)
function hasConsistentAgent(h: Record<string, unknown>): boolean {
  if (h.agent === undefined || h.agent === null) return h.status !== 'sent'
  return isAgentHistoryInfo(h.agent) && h.status === 'sent'
}

export function isValidHistoryEntry(item: unknown): item is HistoryEntry {
  if (typeof item !== 'object' || item === null) return false
  const h = item as Record<string, unknown>
  return (
    typeof h.id === 'string' &&
    (h.promptId === null || typeof h.promptId === 'string') &&
    typeof h.promptTitle === 'string' &&
    typeof h.promptContent === 'string' &&
    (h.fileContent === null || typeof h.fileContent === 'string') &&
    isPromptToolId(h.toolId) &&
    isHistoryStatus(h.status) &&
    (h.resultText === null || typeof h.resultText === 'string') &&
    (h.errorMessage === null || typeof h.errorMessage === 'string') &&
    typeof h.executedAt === 'number' &&
    Number.isFinite(h.executedAt) &&
    hasConsistentAgent(h)
  )
}

// 保存(history:save)も同じ関数を通るため、agent をここで取り出し直さないと保存のたびに黙って消える(L-015)。
// 古い形式(agent 無し)は null にし、agent の中も 3 つのフィールドだけに作り直す
export function sanitizeHistoryEntry(item: HistoryEntry): HistoryEntry {
  const {
    id,
    promptId,
    promptTitle,
    promptContent,
    fileContent,
    toolId,
    status,
    resultText,
    errorMessage,
    executedAt,
    agent
  } = item
  return {
    id,
    promptId,
    promptTitle,
    promptContent,
    fileContent,
    toolId,
    status,
    resultText,
    errorMessage,
    executedAt,
    agent:
      agent === undefined || agent === null
        ? null
        : { claudeSessionId: agent.claudeSessionId, tabLabel: agent.tabLabel, folderPath: agent.folderPath }
  }
}
```

`src/renderer/src/types.ts` の `export type { … } from '@shared/types'` の `HistoryStatus` の次に `AgentHistoryInfo` を足す。

`src/renderer/src/hooks/usePromptExecution.ts`: `ExecutionOutcome` の `executedAt: number` の次に足す:
```ts
  /** 従来の方式の実行はエージェントへ送ったエントリではない(履歴の HistoryEntry.agent を省略させない。L-060) */
  agent: null
```
`buildOutcome` を次にする:
```ts
  return {
    ...context,
    promptContent,
    fileContent,
    toolId,
    executedAt: Date.now(),
    agent: null,
    ...result
  }
```

`src/renderer/src/lib/historyFormatters.ts` の `getStatusLabel` を次にする:
```ts
export function getStatusLabel(status: HistoryStatus): string {
  switch (status) {
    case 'success':
      return '成功'
    case 'error':
      return 'エラー'
    case 'sent':
      // エージェント CLI 方式は結果を知らないので、成功と出さない
      return '送信済み'
  }
}
```

- [ ] **Step 5: テストが通ることを確かめる**

Run: `npx vitest run src/shared/__tests__/agentTerminal.test.ts src/main/__tests__/historyUtils.test.ts src/main/__tests__/handlers/historyHandlers.test.ts src/main/__tests__/historyStore.test.ts src/renderer/src/lib/__tests__/historyFormatters.test.ts src/renderer/src/lib/__tests__/historyEntryFactory.test.ts src/renderer/src/lib/__tests__/historyApi.test.ts src/renderer/src/hooks/__tests__/usePromptExecution.test.ts src/renderer/src/hooks/__tests__/useHistory.test.ts src/renderer/src/hooks/__tests__/useHistoryPersistence.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/hooks/__tests__/useSelectedHistoryEntry.test.ts src/renderer/src/components/history`
Expected: PASS

- [ ] **Step 6: 検証**

Run: `npm run typecheck`
Expected: エラーなし（`agent` を足し忘れた履歴の値があれば、ここで型のエラーになる。足して直す）
Run: 変更した `.ts`・`.tsx` へ `npx eslint --fix <files>` → `npx eslint --max-warnings 0 <files>`
Expected: エラー・警告なし

---

### Task 2: ID の予約の集合と起動の記録のストア（`claudeSessionReservations`・`agentSessionRecordStore`）

**Files:**
- Create: `src/main/claudeSessionReservations.ts`
- Create: `src/main/agentSessionRecordStore.ts`
- Test: `src/main/__tests__/claudeSessionReservations.test.ts`（新規）、`src/main/__tests__/agentSessionRecordStore.test.ts`（新規）

**Interfaces:**
- Consumes: `isClaudeSessionId(value: unknown): value is string`（Task 1）、`WriteQueue`（`src/main/writeQueue.ts`）、`isEnoentError`（`src/main/fsErrors.ts`）
- Produces:
```ts
// src/main/claudeSessionReservations.ts
export interface ClaudeSessionReservations {
  /** 予約できたら解除の関数(2 回目以降は何もしない)、すでに予約されていれば null。判定と予約は同期で 1 度に行う */
  tryReserve(claudeSessionId: string): (() => void) | null
  has(claudeSessionId: string): boolean
}
export function createClaudeSessionReservations(): ClaudeSessionReservations

// src/main/agentSessionRecordStore.ts
export const AGENT_SESSION_RECORDS_FILE_NAME = 'agent-sessions.json'
export const AGENT_SESSION_RECORDS_PER_FOLDER = 200
export const AGENT_SESSION_RECORD_FOLDERS_MAX = 50
export function toAgentFolderKey(canonicalPath: string, platform: NodeJS.Platform): string
export interface AgentSessionRecordIo {
  read(): Promise<string> // 無ければ ENOENT の例外
  write(content: string): Promise<void>
}
export interface AgentSessionRecordStore {
  whenLoaded(): Promise<void> // 読み込みの完了(失敗しても解決する)
  has(folderKey: string, claudeSessionId: string): boolean // 同期でメモリを引く
  last(folderKey: string): string | null // 同期でメモリを引く。先頭(前回)
  record(folderKey: string, claudeSessionId: string): void // メモリを同期で更新し、書き込みは待たない
}
export function createAgentSessionRecordStore(io: AgentSessionRecordIo): AgentSessionRecordStore
export function agentSessionRecordFileIo(userDataDir: string): AgentSessionRecordIo
```

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/claudeSessionReservations.test.ts`（新規）:
```ts
import { describe, it, expect } from 'vitest'
import { createClaudeSessionReservations } from '../claudeSessionReservations'

const ID = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-9222-222222222222'

describe('createClaudeSessionReservations', () => {
  it('予約できたら解除の関数を返し、同じ ID の 2 回目は null(別の ID は予約できる)', () => {
    const reservations = createClaudeSessionReservations()
    const release = reservations.tryReserve(ID)
    expect(release).toEqual(expect.any(Function))
    expect(reservations.has(ID)).toBe(true)
    expect(reservations.tryReserve(ID)).toBeNull()
    expect(reservations.tryReserve(OTHER)).toEqual(expect.any(Function))
  })

  it('解除すると同じ ID をもう一度予約できる', () => {
    const reservations = createClaudeSessionReservations()
    reservations.tryReserve(ID)?.()
    expect(reservations.has(ID)).toBe(false)
    expect(reservations.tryReserve(ID)).toEqual(expect.any(Function))
  })

  it('解除の関数を 2 回呼んでも、その後に別の起動が取り直した予約は外さない', () => {
    const reservations = createClaudeSessionReservations()
    const first = reservations.tryReserve(ID)
    first?.()
    const second = reservations.tryReserve(ID)
    expect(second).not.toBeNull()
    first?.()
    expect(reservations.has(ID)).toBe(true)
  })
})
```

`src/main/__tests__/agentSessionRecordStore.test.ts`（新規）:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_SESSION_RECORDS_FILE_NAME,
  AGENT_SESSION_RECORDS_PER_FOLDER,
  AGENT_SESSION_RECORD_FOLDERS_MAX,
  agentSessionRecordFileIo,
  createAgentSessionRecordStore,
  toAgentFolderKey
} from '../agentSessionRecordStore'
import type { AgentSessionRecordIo } from '../agentSessionRecordStore'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-9222-222222222222'
const C = '33333333-3333-4333-a333-333333333333'

/** n 番目の UUID(テスト用。小文字の v4) */
const idOf = (n: number): string => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve: (value: T) => void = () => undefined
  let reject: (err: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const enoent = (): NodeJS.ErrnoException => Object.assign(new Error('no file'), { code: 'ENOENT' })

interface FakeIo extends AgentSessionRecordIo {
  writes: string[]
}

function makeIo(content: string | Error | Promise<string> = enoent()): FakeIo {
  const io: FakeIo = {
    writes: [],
    read: vi.fn(async () => {
      if (content instanceof Error) throw content
      return content
    }),
    write: vi.fn(async (data: string) => {
      io.writes.push(data)
    })
  }
  return io
}

const fileOf = (folders: { key: unknown; ids: unknown }[]): string =>
  JSON.stringify({ version: 1, folders })

let consoleErrorSpy: MockInstance<typeof console.error> | null = null
let tempDir: string | null = null

afterEach(async () => {
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = null
  if (tempDir !== null) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('toAgentFolderKey', () => {
  it('Windows では小文字にそろえ、ほかはそのまま', () => {
    expect(toAgentFolderKey('C:\\Work\\Proj', 'win32')).toBe('c:\\work\\proj')
    expect(toAgentFolderKey('/Users/Me/Proj', 'darwin')).toBe('/Users/Me/Proj')
    expect(toAgentFolderKey('/home/Me/Proj', 'linux')).toBe('/home/Me/Proj')
  })
})

describe('createAgentSessionRecordStore: 読み込み', () => {
  it('作った時点で読み込みを始め、whenLoaded の後に has・last が同期で記録を引く', async () => {
    const io = makeIo(fileOf([{ key: '/w', ids: [B, A] }]))
    const store = createAgentSessionRecordStore(io)
    expect(io.read).toHaveBeenCalledOnce()
    await store.whenLoaded()
    expect(store.last('/w')).toBe(B)
    expect(store.has('/w', A)).toBe(true)
    expect(store.has('/w', C)).toBe(false)
    expect(store.has('/other', A)).toBe(false)
    expect(store.last('/other')).toBeNull()
  })

  it('読み込みの完了の前は記録が見えず、whenLoaded は読み込みの完了まで待つ', async () => {
    const read = deferred<string>()
    const io = makeIo(read.promise)
    const store = createAgentSessionRecordStore(io)
    let loaded = false
    void store.whenLoaded().then(() => {
      loaded = true
    })
    await Promise.resolve()
    expect(loaded).toBe(false)
    expect(store.has('/w', A)).toBe(false)
    read.resolve(fileOf([{ key: '/w', ids: [A] }]))
    await store.whenLoaded()
    expect(loaded).toBe(true)
    expect(store.has('/w', A)).toBe(true)
  })

  it('ファイルが無ければ空(ログは出さない)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const store = createAgentSessionRecordStore(makeIo(enoent()))
    await store.whenLoaded()
    expect(store.last('/w')).toBeNull()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['読み込みの失敗(ENOENT 以外)', new Error('EACCES')],
    ['JSON として壊れている', '{'],
    ['オブジェクトでない', '[]'],
    ['folders が配列でない', JSON.stringify({ version: 1, folders: {} })]
  ])('%s は空として扱い、ログに残す(whenLoaded は拒否しない)', async (_label, content) => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const store = createAgentSessionRecordStore(makeIo(content))
    await expect(store.whenLoaded()).resolves.toBeUndefined()
    expect(store.last('/w')).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('不正な要素だけを捨てる(キーの無いフォルダ・UUID でない ID・重複の ID・重複のフォルダ・ID が空のフォルダ)', async () => {
    const store = createAgentSessionRecordStore(
      makeIo(
        fileOf([
          { key: '', ids: [A] },
          { key: 1, ids: [A] },
          { key: '/w', ids: [A, 'abc', '--resume', A.toUpperCase(), A, B, 3] },
          { key: '/w', ids: [C] },
          { key: '/empty', ids: ['x'] },
          { key: '/bad', ids: 'x' }
        ])
      )
    )
    await store.whenLoaded()
    expect(store.last('/w')).toBe(A)
    expect(store.has('/w', B)).toBe(true)
    expect(store.has('/w', C)).toBe(false)
    expect(store.last('/empty')).toBeNull()
    expect(store.last('/bad')).toBeNull()
  })

  it('読み込んだ記録も上限(フォルダごと 200 件・フォルダ 50)に切りそろえる', async () => {
    const ids = Array.from({ length: AGENT_SESSION_RECORDS_PER_FOLDER + 5 }, (_, i) => idOf(i + 1))
    const folders = Array.from({ length: AGENT_SESSION_RECORD_FOLDERS_MAX + 3 }, (_, i) => ({
      key: `/f${i}`,
      ids: i === 0 ? ids : [idOf(1)]
    }))
    const store = createAgentSessionRecordStore(makeIo(fileOf(folders)))
    await store.whenLoaded()
    expect(store.has('/f0', idOf(AGENT_SESSION_RECORDS_PER_FOLDER))).toBe(true)
    expect(store.has('/f0', idOf(AGENT_SESSION_RECORDS_PER_FOLDER + 1))).toBe(false)
    expect(store.last(`/f${AGENT_SESSION_RECORD_FOLDERS_MAX - 1}`)).toBe(idOf(1))
    expect(store.last(`/f${AGENT_SESSION_RECORD_FOLDERS_MAX}`)).toBeNull()
  })
})

describe('createAgentSessionRecordStore: 記録', () => {
  it('record はメモリを同期で更新し(書き込みの完了を待たない)、先頭へ移して重複させない', async () => {
    const store = createAgentSessionRecordStore(makeIo(fileOf([{ key: '/w', ids: [A, B] }])))
    await store.whenLoaded()
    store.record('/w', C)
    expect(store.last('/w')).toBe(C)
    store.record('/w', B)
    expect(store.last('/w')).toBe(B)
    await store.whenLoaded()
    // 先頭へ移しても、ほかの ID は残る
    expect(store.has('/w', A)).toBe(true)
    expect(store.has('/w', C)).toBe(true)
  })

  it('書き込むファイルは新しい順で、同じ ID を 1 回だけ持つ', async () => {
    const io = makeIo(fileOf([{ key: '/w', ids: [A, B] }]))
    const store = createAgentSessionRecordStore(io)
    await store.whenLoaded()
    store.record('/w', B)
    await vi.waitFor(() => expect(io.writes).toHaveLength(1))
    expect(JSON.parse(io.writes[0])).toEqual({ version: 1, folders: [{ key: '/w', ids: [B, A] }] })
  })

  it('フォルダごとに 200 件まで(古い ID から捨てる)', async () => {
    const store = createAgentSessionRecordStore(makeIo())
    await store.whenLoaded()
    for (let i = 1; i <= AGENT_SESSION_RECORDS_PER_FOLDER + 1; i += 1) store.record('/w', idOf(i))
    expect(store.last('/w')).toBe(idOf(AGENT_SESSION_RECORDS_PER_FOLDER + 1))
    expect(store.has('/w', idOf(2))).toBe(true)
    expect(store.has('/w', idOf(1))).toBe(false)
  })

  it('フォルダは 50 まで(最後に記録したのが古いフォルダから捨てる)', async () => {
    const store = createAgentSessionRecordStore(makeIo())
    await store.whenLoaded()
    for (let i = 0; i < AGENT_SESSION_RECORD_FOLDERS_MAX; i += 1) store.record(`/f${i}`, A)
    // /f0 を記録し直すと最新になり、次に足したフォルダで捨てられるのは /f1
    store.record('/f0', B)
    store.record('/new', C)
    expect(store.last('/f0')).toBe(B)
    expect(store.last('/f1')).toBeNull()
    expect(store.last('/new')).toBe(C)
  })

  it('書き込みは直列(前の書き込みの完了を待ってから次を書く。L-040)', async () => {
    const first = deferred<void>()
    const io = makeIo()
    const order: string[] = []
    io.write = vi.fn(async (data: string) => {
      order.push(`start:${JSON.parse(data).folders[0].ids[0]}`)
      if (order.length === 1) await first.promise
      order.push('end')
    })
    const store = createAgentSessionRecordStore(io)
    await store.whenLoaded()
    store.record('/w', A)
    store.record('/w', B)
    await vi.waitFor(() => expect(order).toEqual([`start:${B}`]))
    first.resolve()
    await vi.waitFor(() => expect(order).toEqual([`start:${B}`, 'end', `start:${B}`, 'end']))
  })

  it('書き込みの失敗はログに残すだけで、メモリの記録と次の書き込みは続く(L-001)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const io = makeIo()
    io.write = vi
      .fn<AgentSessionRecordIo['write']>()
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValue(undefined)
    const store = createAgentSessionRecordStore(io)
    await store.whenLoaded()
    expect(() => store.record('/w', A)).not.toThrow()
    store.record('/w', B)
    await vi.waitFor(() => expect(io.write).toHaveBeenCalledTimes(2))
    expect(store.last('/w')).toBe(B)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[agentSessionRecordStore] 起動の記録を書き込めませんでした:',
      expect.any(Error)
    )
  })

  it('読み込みの完了の前に記録したものは、読み込んだ記録の前に置き、書き込みは読み込みの完了を待つ', async () => {
    const read = deferred<string>()
    const io = makeIo(read.promise)
    const store = createAgentSessionRecordStore(io)
    store.record('/w', C)
    expect(store.last('/w')).toBe(C)
    await Promise.resolve()
    expect(io.write).not.toHaveBeenCalled()
    read.resolve(fileOf([{ key: '/w', ids: [A, C] }, { key: '/x', ids: [B] }]))
    await store.whenLoaded()
    expect(store.last('/w')).toBe(C)
    expect(store.has('/w', A)).toBe(true)
    expect(store.last('/x')).toBe(B)
    await vi.waitFor(() => expect(io.writes).toHaveLength(1))
    expect(JSON.parse(io.writes[0]).folders).toEqual([
      { key: '/w', ids: [C, A] },
      { key: '/x', ids: [B] }
    ])
  })
})

describe('agentSessionRecordFileIo', () => {
  it('userData/agent-sessions.json を読み書きし、無いディレクトリは作る', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-sessions-'))
    const dir = join(tempDir, 'nested')
    const io = agentSessionRecordFileIo(dir)
    await expect(io.read()).rejects.toMatchObject({ code: 'ENOENT' })
    await io.write('{"version":1,"folders":[]}')
    expect(await readFile(join(dir, AGENT_SESSION_RECORDS_FILE_NAME), 'utf-8')).toBe(
      '{"version":1,"folders":[]}'
    )
    await expect(io.read()).resolves.toBe('{"version":1,"folders":[]}')
  })
})
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npx vitest run src/main/__tests__/claudeSessionReservations.test.ts src/main/__tests__/agentSessionRecordStore.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

`src/main/claudeSessionReservations.ts`（新規）:
```ts
// 全ウィンドウで共有する claude の会話の ID の予約(設計書「同じ ID の二重の起動」)。同じ会話を 2 つの claude が同時に書くと
// 会話のファイルが壊れうるため、starter が spawn の直前に同期で予約し、予約済みの ID の再開を session-in-use で拒む。
// main に 1 つ作って starter に注入する。Electron に依存しない

export interface ClaudeSessionReservations {
  /** 予約できたら解除の関数(2 回目以降は何もしない)、すでに予約されていれば null。判定と予約は同期で 1 度に行う */
  tryReserve(claudeSessionId: string): (() => void) | null
  /** 予約されているか */
  has(claudeSessionId: string): boolean
}

export function createClaudeSessionReservations(): ClaudeSessionReservations {
  const reserved = new Set<string>()
  return {
    tryReserve(claudeSessionId) {
      if (reserved.has(claudeSessionId)) return null
      reserved.add(claudeSessionId)
      let released = false
      return () => {
        // 2 回目の呼び出しで、外した後に別の起動が取り直した同じ ID の予約を外さない
        if (released) return
        released = true
        reserved.delete(claudeSessionId)
      }
    },
    has: (claudeSessionId) => reserved.has(claudeSessionId)
  }
}
```

`src/main/agentSessionRecordStore.ts`（新規）:
```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isClaudeSessionId } from '@shared/types'
import { isEnoentError } from './fsErrors'
import { WriteQueue } from './writeQueue'

// フォルダごとの claude のセッションの起動の記録(設計書「記録の置き場」「記録の中身」)。main が振った ID の一覧を新しい順に持ち、
// 先頭が「前回」。再開の ID が main の振ったものかを照合する相手で、main だけが書く(renderer が丸ごと保存する履歴は信頼しない)。
// 記録はメモリに持ち、has・last は同期で引く(starter の resume の照合は await を挟まない区間にあるため)。読み込みは作った時点で
// 一度だけ始め、使う側は whenLoaded を待ってから同期の区間に入る。ファイルの形は { version: 1, folders: [{ key, ids }] }

export const AGENT_SESSION_RECORDS_FILE_NAME = 'agent-sessions.json'
/** フォルダごとの記録の上限(renderer の履歴の上限 HISTORY_CAP と同じ。履歴に残っているセッションは通常は再開できる) */
export const AGENT_SESSION_RECORDS_PER_FOLDER = 200
/** 記録を持つフォルダの数の上限(最後に記録したのが古いフォルダから捨てる) */
export const AGENT_SESSION_RECORD_FOLDERS_MAX = 50

/** 記録のフォルダのキー(許可のフォルダの正規化した実パス)。Windows のパスは大文字小文字を区別しないため小文字にそろえる */
export function toAgentFolderKey(canonicalPath: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath
}

export interface AgentSessionRecordIo {
  /** 記録のファイルを読む。無ければ ENOENT の例外 */
  read(): Promise<string>
  write(content: string): Promise<void>
}

export interface AgentSessionRecordStore {
  /** 読み込みの完了(失敗しても解決する)。has・last・record の同期の区間に入る前に待つ */
  whenLoaded(): Promise<void>
  has(folderKey: string, claudeSessionId: string): boolean
  /** フォルダの記録の先頭(前回)。無ければ null */
  last(folderKey: string): string | null
  /** ID を先頭として記録する。メモリを同期で更新してから、ファイルへの書き込みを直列に始める(完了は待たない) */
  record(folderKey: string, claudeSessionId: string): void
}

interface FolderRecord {
  key: string
  ids: string[]
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** ファイルの中身を記録にする。不正な要素(キーの無いフォルダ・UUID でない ID・重複)だけを捨て、上限に切りそろえる */
function parseRecords(raw: string): FolderRecord[] {
  const parsed: unknown = JSON.parse(raw)
  if (!isPlainObject(parsed) || !Array.isArray(parsed.folders)) {
    throw new Error('記録のファイルの形が不正です')
  }
  const folders: FolderRecord[] = []
  for (const item of parsed.folders) {
    if (folders.length >= AGENT_SESSION_RECORD_FOLDERS_MAX) break
    if (!isPlainObject(item) || typeof item.key !== 'string' || item.key === '') continue
    if (!Array.isArray(item.ids)) continue
    const key = item.key
    if (folders.some((folder) => folder.key === key)) continue
    const ids = [...new Set(item.ids.filter(isClaudeSessionId))].slice(
      0,
      AGENT_SESSION_RECORDS_PER_FOLDER
    )
    if (ids.length > 0) folders.push({ key, ids })
  }
  return folders
}

/** 読み込みの前に記録した分(current)を前に、読み込んだ記録(loaded)を後ろに合わせる */
function mergeRecords(current: FolderRecord[], loaded: FolderRecord[]): FolderRecord[] {
  const merged = current.map((folder) => {
    const older = loaded.find((l) => l.key === folder.key)?.ids ?? []
    return {
      key: folder.key,
      ids: [...new Set([...folder.ids, ...older])].slice(0, AGENT_SESSION_RECORDS_PER_FOLDER)
    }
  })
  const rest = loaded.filter((l) => !current.some((folder) => folder.key === l.key))
  return [...merged, ...rest].slice(0, AGENT_SESSION_RECORD_FOLDERS_MAX)
}

export function createAgentSessionRecordStore(io: AgentSessionRecordIo): AgentSessionRecordStore {
  // 最後に記録した順(先頭が最新のフォルダ)
  let folders: FolderRecord[] = []
  const queue = new WriteQueue()

  const loaded: Promise<void> = (async () => {
    try {
      folders = mergeRecords(folders, parseRecords(await io.read()))
    } catch (err) {
      // 記録は再開の補助なので、読めなければ空として続ける(前回の続きから は押せず、履歴からの再開は unknown-session)
      if (!isEnoentError(err)) {
        console.error('[agentSessionRecordStore] 起動の記録を読み込めませんでした:', err)
      }
    }
  })()

  const find = (folderKey: string): FolderRecord | undefined =>
    folders.find((folder) => folder.key === folderKey)

  return {
    whenLoaded: () => loaded,
    has: (folderKey, claudeSessionId) => find(folderKey)?.ids.includes(claudeSessionId) ?? false,
    last: (folderKey) => find(folderKey)?.ids[0] ?? null,
    record(folderKey, claudeSessionId) {
      const ids = [
        claudeSessionId,
        ...(find(folderKey)?.ids.filter((id) => id !== claudeSessionId) ?? [])
      ].slice(0, AGENT_SESSION_RECORDS_PER_FOLDER)
      folders = [
        { key: folderKey, ids },
        ...folders.filter((folder) => folder.key !== folderKey)
      ].slice(0, AGENT_SESSION_RECORD_FOLDERS_MAX)
      // 書き込みは直列にし(L-040)、読み込む前の空の記録でファイルを上書きしないよう読み込みの完了を待つ。書く中身は書く時点のメモリ。
      // 失敗はログだけ(起動は成功しているため。次の 前回の続きから が古い記録を使うことがある。L-001)
      queue
        .enqueue(async () => {
          await loaded
          await io.write(JSON.stringify({ version: 1, folders }))
        })
        .catch((err: unknown) => {
          console.error('[agentSessionRecordStore] 起動の記録を書き込めませんでした:', err)
        })
    }
  }
}

/** userData の agent-sessions.json を読み書きする(ディレクトリが無ければ作る) */
export function agentSessionRecordFileIo(userDataDir: string): AgentSessionRecordIo {
  const filePath = join(userDataDir, AGENT_SESSION_RECORDS_FILE_NAME)
  return {
    read: () => readFile(filePath, 'utf-8'),
    write: async (content) => {
      await mkdir(userDataDir, { recursive: true })
      await writeFile(filePath, content, 'utf-8')
    }
  }
}
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/main/__tests__/claudeSessionReservations.test.ts src/main/__tests__/agentSessionRecordStore.test.ts`
Expected: PASS（「書き込みは直列」のテストは、2 回とも書く時点のメモリ〈先頭が B〉を書く）

- [ ] **Step 5: 検証**

Run: `npm run typecheck`
Expected: エラーなし
Run: 変更した `.ts` へ `npx eslint --fix <files>` → `npx eslint --max-warnings 0 <files>`
Expected: エラー・警告なし

---

### Task 3: 起動の IPC の拡張（共有の型・parser・`buildAgentLaunchArgs`・registry の型・starter・main の組み立て）

**Files:**
- Modify: `src/shared/types/agentTerminal.ts`（`AgentLaunchRequest`・`AgentStartRequest.launch`・`AgentStartResult` の `claudeSessionId`・エラーの種類）
- Modify: `src/main/handlers/agentTerminalPayloadParser.ts`（`parseAgentFolderPath`・`parseAgentLaunchRequest`・`parseAgentStartRequest` の `launch`）
- Modify: `src/main/agentCommand.ts`（`buildAgentLaunchArgs`・方針のコメント）
- Modify: `src/main/agentSessionRegistry.ts`（`AgentRegistryStartResult` への型の付け替えだけ）
- Modify: `src/main/agentSessionStarter.ts`（`AgentSessionStarterService`・ID の生成・記録の照合・予約・記録の書き込み・pty の id → claude の ID の Map）
- Modify: `src/main/ipcHandlers.ts`（記録のストア・予約の集合・starter の組み立て）
- Test: `src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts`、`src/main/__tests__/agentCommand.test.ts`、`src/main/__tests__/agentSessionStarter.test.ts`、`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`、`src/main/__tests__/ipcHandlers.test.ts`、`src/preload/__tests__/api.test.ts`、`src/shared/__tests__/agentTerminal.test.ts`

> この Task から Task 5 までは `npm run typecheck:web` が落ちる（renderer の `useAgentSessions.ts` とそのテストが `launch`・`claudeSessionId` を持たないため。Task 5 で通す）。この Task の検証は `npm run typecheck:node`。

**Interfaces:**
- Consumes: `isClaudeSessionId`（Task 1）、`createClaudeSessionReservations`・`ClaudeSessionReservations`・`createAgentSessionRecordStore`・`AgentSessionRecordStore`・`AgentSessionRecordIo`・`agentSessionRecordFileIo`・`toAgentFolderKey`（Task 2）
- Produces:
```ts
// src/shared/types/agentTerminal.ts
export type AgentTerminalErrorKind = /* 既存 */ | 'unknown-session' | 'session-in-use'
export type AgentLaunchRequest = { kind: 'new' } | { kind: 'resume'; claudeSessionId: string }
export interface AgentStartRequest { slotId: string; folderPath: string; cols: number; rows: number; launch: AgentLaunchRequest }
export type AgentStartResult =
  | { kind: 'started' | 'already-running'; sessionId: string; claudeSessionId: string }
  | { kind: 'error'; error: AgentTerminalErrorKind; detail?: string; shellPathUnavailable?: boolean }
// src/main/handlers/agentTerminalPayloadParser.ts
export function parseAgentFolderPath(value: unknown): string
export function parseAgentLaunchRequest(value: unknown): AgentLaunchRequest
// src/main/agentCommand.ts
export function buildAgentLaunchArgs(launch: AgentLaunchRequest, claudeSessionId: string): string[]
// src/main/agentSessionRegistry.ts
export type AgentRegistryStartResult =
  | { kind: 'started' | 'already-running'; sessionId: string }
  | Extract<AgentStartResult, { kind: 'error' }>
// AgentSessionRegistry.start(ownerId, slotId, create): Promise<AgentRegistryStartResult>
// src/main/agentSessionStarter.ts
export interface AgentSessionStarterDeps {
  /* 既存の folderAccess・registry・resolveLaunch・spawnPty・stopTree・createSessionId・canonicalize?・isDirectory? */
  records: Pick<AgentSessionRecordStore, 'whenLoaded' | 'has' | 'last' | 'record'>
  reservations: Pick<ClaudeSessionReservations, 'tryReserve'>
  createClaudeSessionId?: () => string // 既定は crypto.randomUUID
  platform?: NodeJS.Platform // フォルダのキー(既定は process.platform)
}
export type AgentSessionStarter = (ownerId: number, request: AgentStartRequest, sink: AgentSessionSink) => Promise<AgentStartResult>
export interface AgentSessionStarterService {
  start: AgentSessionStarter
  /** pty の sessionId → claudeSessionId。作ったセッションの exited の解決で消す。無ければ undefined */
  claudeSessionIdOf(sessionId: string): string | undefined
}
export function createAgentSessionStarter(deps: AgentSessionStarterDeps): AgentSessionStarterService
```

- [ ] **Step 1: 既存のテストを新しい依頼・結果の形に直す**

`src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts`（行番号で範囲を決めるので、import を足す前に先に perl を実行する）:
- `describe('parseAgentStartRequest', …)` の中（今の 11〜62 行目）の依頼のリテラルに `launch: NEW` を足す: `perl -pi -e 's/(rows: (?:\d+|\x2724\x27)) \}/$1, launch: NEW }/g if $. >= 11 && $. <= 62' src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts`（`parseAgentResize` の期待〈84 行目〉は変えない）。最初のテストの期待の `rows: 24` の次に `launch: { kind: 'new' }` を足し、テスト名を `slotId・folderPath・cols・rows・launch を返す` にする。
- その後、import の `parseAgentStartRequest` の前後に `parseAgentFolderPath`・`parseAgentLaunchRequest` を足し、import の後に足す:
```ts
const NEW = { kind: 'new' } as const
const ID = '11111111-1111-4111-8111-111111111111'
```

`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`:
- 依頼のリテラルに `launch` を足す: `perl -pi -e 's/rows: 20 \}/rows: 20, launch: NEW }/g' src/main/__tests__/handlers/agentTerminalHandlers.test.ts`（32 か所。starter へ渡した依頼の期待〈`toHaveBeenCalledExactlyOnceWith(7, {…})`〉も検証を通った依頼として `launch` を含む）
- 起動の結果の期待に ID を足す: `perl -0pi -e "s/(kind: '(?:started|already-running)',\n(\s*)sessionId: 'sid-1')\n/\$1,\n\$2claudeSessionId: CLAUDE_ID\n/g" src/main/__tests__/handlers/agentTerminalHandlers.test.ts`（3 か所）
- import に足す:
```ts
import { createAgentSessionRecordStore } from '../../agentSessionRecordStore'
import type { AgentSessionRecordIo } from '../../agentSessionRecordStore'
import { createClaudeSessionReservations } from '../../claudeSessionReservations'
```
- `type Listener = …` の前に足す:
```ts
const NEW = { kind: 'new' } as const
const CLAUDE_ID = '11111111-1111-4111-8111-111111111111'
// 記録のファイルが無い(空の記録)
const EMPTY_RECORD_IO: AgentSessionRecordIo = {
  read: async () => {
    throw Object.assign(new Error('none'), { code: 'ENOENT' })
  },
  write: async () => undefined
}
```
- `register` の `startSession: createAgentSessionStarter({ … })` を次にする:
```ts
    startSession: createAgentSessionStarter({
      folderAccess,
      registry,
      resolveLaunch,
      spawnPty,
      stopTree,
      createSessionId: () => 'sid-1',
      records: createAgentSessionRecordStore(EMPTY_RECORD_IO),
      reservations: createClaudeSessionReservations(),
      createClaudeSessionId: () => CLAUDE_ID,
      platform: 'linux'
    }).start,
```
- 最初のテストの `spawnPty` の期待の引数 `[]` を `['--session-id', CLAUDE_ID]` にする。
- `describe('agentTerminal:start(受け口: …)')` の `STARTED` を `{ kind: 'started', sessionId: 'sid-x', claudeSessionId: CLAUDE_ID }` にする。同じ describe の「不正な入力・サブフレームからの依頼は starter を呼ばずに投げる」に、`launch` が無い依頼を足す:
```ts
    await expect(
      start(makeEvent(), { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20 })
    ).rejects.toThrow()
```

`src/preload/__tests__/api.test.ts` の `startAgentSession は agentTerminal:start に依頼を渡す` の 2 つのリテラル（呼び出しと期待）の `rows: 24` の次に `, launch: { kind: 'new' }` を足す。

`src/shared/__tests__/agentTerminal.test.ts` の `['起動の成功', …]`・`['起動済み', …]` の結果に `claudeSessionId: '11111111-1111-4111-8111-111111111111'` を足す。

`src/main/__tests__/agentCommand.test.ts` の `resolveAgentLaunch` の最初のテスト名を `…探し、引数は空で返す(セッションの指定は starter が足す)` にする（期待の `args: []` は変えない）。

`src/main/__tests__/agentSessionStarter.test.ts`:
- import を足す・直す:
```ts
import type { AgentSessionData, AgentSessionExit, AgentStartRequest } from '@shared/types'
import { createAgentSessionStarter } from '../agentSessionStarter'
import type {
  AgentSessionSink,
  AgentSessionStarter,
  AgentSessionStarterDeps,
  AgentSessionStarterService
} from '../agentSessionStarter'
import { createAgentSessionRecordStore } from '../agentSessionRecordStore'
import type { AgentSessionRecordStore } from '../agentSessionRecordStore'
import { createClaudeSessionReservations } from '../claudeSessionReservations'
import type { ClaudeSessionReservations } from '../claudeSessionReservations'
import type { MockInstance } from 'vitest'
```
（`vitest` の import に `afterEach` を足す）
- `REQUEST` に `launch: { kind: 'new' }` を足す。その次に足す:
```ts
// 新しく振る claude のセッション ID(呼ぶたびに次の値)
const NEW_IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
]
```
- `let isDirectory …` の次に足す:
```ts
let records: AgentSessionRecordStore
let reservations: ClaudeSessionReservations
let claudeIdCount: number
let consoleErrorSpy: MockInstance<typeof console.error> | null = null
```
- `makeStarter` を次の 2 つにする:
```ts
function makeStarterService(
  overrides: Partial<AgentSessionStarterDeps> = {}
): AgentSessionStarterService {
  return createAgentSessionStarter({
    folderAccess,
    registry,
    resolveLaunch,
    spawnPty,
    stopTree,
    createSessionId: () => 'sid-1',
    records,
    reservations,
    createClaudeSessionId: () => NEW_IDS[claudeIdCount++],
    platform: 'linux',
    canonicalize,
    isDirectory,
    ...overrides
  })
}

function makeStarter(overrides: Partial<AgentSessionStarterDeps> = {}): AgentSessionStarter {
  return makeStarterService(overrides).start
}
```
- `beforeEach` の末尾に足し、`afterEach` を足す:
```ts
  records = createAgentSessionRecordStore({
    read: async () => {
      throw Object.assign(new Error('none'), { code: 'ENOENT' })
    },
    write: async () => undefined
  })
  reservations = createClaudeSessionReservations()
  claudeIdCount = 0
  consoleErrorSpy = null
```
```ts
afterEach(() => {
  consoleErrorSpy?.mockRestore()
})
```
- 起動の結果の期待に ID を足す: `perl -0pi -e "s/\{ kind: 'started', sessionId: 'sid-1' \}/{ kind: 'started', sessionId: 'sid-1', claudeSessionId: NEW_IDS[0] }/g; s/(kind: 'started',\n(\s*)sessionId: 'sid-1')\n/\$1,\n\$2claudeSessionId: NEW_IDS[0]\n/g" src/main/__tests__/agentSessionStarter.test.ts`（4 か所）
- 最初のテストの `spawnPty` の期待の引数 `['--x']` を `['--x', '--session-id', NEW_IDS[0]]` にする。

- [ ] **Step 2: 失敗するテストを書く**

`src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts` に足す:
```ts
describe('parseAgentLaunchRequest', () => {
  it('new と、小文字の UUID v4 の resume を返す(余分なものを持たない新しいオブジェクト)', () => {
    expect(parseAgentLaunchRequest({ kind: 'new' })).toEqual({ kind: 'new' })
    expect(parseAgentLaunchRequest({ kind: 'resume', claudeSessionId: ID })).toEqual({
      kind: 'resume',
      claudeSessionId: ID
    })
  })

  it.each([
    ['無い(undefined)', undefined],
    ['null', null],
    ['文字列', 'new'],
    ['配列', [{ kind: 'new' }]],
    ['kind が無い', {}],
    ['未知の kind', { kind: 'continue' }],
    ['new に余分なキー', { kind: 'new', claudeSessionId: ID }],
    ['resume に余分なキー', { kind: 'resume', claudeSessionId: ID, fork: true }],
    ['resume の ID が無い', { kind: 'resume' }],
    ['resume の ID が文字列でない', { kind: 'resume', claudeSessionId: 1 }],
    ['resume の ID が大文字', { kind: 'resume', claudeSessionId: ID.toUpperCase() }],
    ['resume の ID が v4 以外', { kind: 'resume', claudeSessionId: '11111111-1111-1111-8111-111111111111' }],
    ['resume の ID が - 始まり', { kind: 'resume', claudeSessionId: '--dangerously-skip-permissions' }]
  ])('%s なら投げる(既定の new に流さない。L-034・L-044)', (_label, value) => {
    expect(() => parseAgentLaunchRequest(value)).toThrow()
  })
})

describe('parseAgentStartRequest: launch', () => {
  it('検証を通った launch を返す', () => {
    expect(
      parseAgentStartRequest({
        slotId: 'slot-1',
        folderPath: '/p',
        cols: 80,
        rows: 24,
        launch: { kind: 'resume', claudeSessionId: ID }
      }).launch
    ).toEqual({ kind: 'resume', claudeSessionId: ID })
  })

  it('launch が無い・不正なら投げる', () => {
    expect(() =>
      parseAgentStartRequest({ slotId: 'slot-1', folderPath: '/p', cols: 80, rows: 24 })
    ).toThrow()
    expect(() =>
      parseAgentStartRequest({
        slotId: 'slot-1',
        folderPath: '/p',
        cols: 80,
        rows: 24,
        launch: { kind: 'resume', claudeSessionId: 'x' }
      })
    ).toThrow()
  })
})

describe('parseAgentFolderPath', () => {
  it('空でない文字列を返し、空・文字列以外・上限を超える長さは投げる', () => {
    expect(parseAgentFolderPath('/p')).toBe('/p')
    expect(() => parseAgentFolderPath('')).toThrow()
    expect(() => parseAgentFolderPath(1)).toThrow()
    expect(() => parseAgentFolderPath('/' + 'a'.repeat(IPC_PATH_MAX_LENGTH))).toThrow()
  })
})
```

`src/main/__tests__/agentCommand.test.ts` の import に `buildAgentLaunchArgs` を足し、末尾に足す:
```ts
describe('buildAgentLaunchArgs', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  it('new は --session-id、resume は --resume に、渡した ID をそのまま続ける', () => {
    expect(buildAgentLaunchArgs({ kind: 'new' }, ID)).toEqual(['--session-id', ID])
    expect(buildAgentLaunchArgs({ kind: 'resume', claudeSessionId: ID }, ID)).toEqual([
      '--resume',
      ID
    ])
  })
})
```

`src/main/__tests__/agentSessionStarter.test.ts` の末尾に足す:
```ts
describe('createAgentSessionStarter(claude のセッション ID・記録・予約)', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  const OTHER = '22222222-2222-4222-9222-222222222222'
  const RESUME: AgentStartRequest = { ...REQUEST, launch: { kind: 'resume', claudeSessionId: ID } }
  let ptys: FakePty[]
  let sessionCount: number
  const nextSessionId = (): string => `sid-${++sessionCount}`
  const service = (overrides: Partial<AgentSessionStarterDeps> = {}): AgentSessionStarterService =>
    makeStarterService({ createSessionId: nextSessionId, ...overrides })
  // 止める手順(子孫の停止)を、gate を開くまで止まりきらないようにする
  const holdNextStop = (): { open: () => void } => {
    const gate = deferred<void>()
    stopTree.mockImplementationOnce(async (target, exited) => {
      await gate.promise
      ;(target as FakePty).emitExit(0, 15)
      await exited
    })
    return { open: () => gate.resolve() }
  }

  beforeEach(async () => {
    ptys = []
    sessionCount = 0
    spawnPty.mockImplementation(() => {
      const created = makeFakePty()
      ptys.push(created)
      return created
    })
    await records.whenLoaded()
  })

  it('new は ID を振って --session-id で起動し、started に返す。返した時点で記録の先頭になっている', async () => {
    const { start, claudeSessionIdOf } = service()
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      claudeSessionId: NEW_IDS[0]
    })
    expect(spawnPty).toHaveBeenCalledWith(
      '/bin/claude',
      ['--x', '--session-id', NEW_IDS[0]],
      expect.any(Object)
    )
    expect(records.last('/work')).toBe(NEW_IDS[0])
    expect(records.has('/work', NEW_IDS[0])).toBe(true)
    expect(claudeSessionIdOf('sid-1')).toBe(NEW_IDS[0])
  })

  it('resume は記録にある ID を検証を通った値のまま --resume で起動し(L-018)、記録の先頭へ移す', async () => {
    records.record('/work', ID)
    records.record('/work', OTHER)
    const { start } = service()
    await expect(start(1, RESUME, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      claudeSessionId: ID
    })
    expect(spawnPty).toHaveBeenCalledWith('/bin/claude', ['--x', '--resume', ID], expect.any(Object))
    expect(records.last('/work')).toBe(ID)
    // 新しい ID は振らない
    expect(claudeIdCount).toBe(0)
  })

  it.each([
    ['記録が無い', (): void => undefined],
    ['ほかのフォルダの記録にだけある', (): void => records.record('/other', ID)]
  ])('resume で %s ID は unknown-session(spawn も予約もしない。L-019)', async (_label, seed) => {
    seed()
    const { start } = service()
    await expect(start(1, RESUME, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'unknown-session'
    })
    expect(spawnPty).not.toHaveBeenCalled()
    expect(reservations.tryReserve(ID)).not.toBeNull()
  })

  it('記録の読み込みが終わるまで照合を待つ(読み込みの前の空の記録で unknown-session にしない)', async () => {
    const read = deferred<string>()
    records = createAgentSessionRecordStore({ read: () => read.promise, write: async () => undefined })
    const { start } = service()
    const result = start(1, RESUME, makeSink())
    await vi.waitFor(() => expect(resolveLaunch).toHaveBeenCalledOnce())
    expect(spawnPty).not.toHaveBeenCalled()
    read.resolve(JSON.stringify({ version: 1, folders: [{ key: '/work', ids: [ID] }] }))
    await expect(result).resolves.toMatchObject({ kind: 'started', claudeSessionId: ID })
  })

  it('already-running は動いているセッションの ID を返し、依頼の ID は使わない(新しく振らない)', async () => {
    records.record('/work', OTHER)
    const { start } = service()
    await start(1, REQUEST, makeSink())
    await expect(
      start(1, { ...REQUEST, launch: { kind: 'resume', claudeSessionId: OTHER } }, makeSink())
    ).resolves.toEqual({ kind: 'already-running', sessionId: 'sid-1', claudeSessionId: NEW_IDS[0] })
    expect(spawnPty).toHaveBeenCalledOnce()
    expect(claudeIdCount).toBe(1)
  })

  it('already-running の pty の id が Map に無ければ、推測の ID を返さず例外にしてログを残す', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { start } = service({
      registry: {
        generationOf: (ownerId, slotId) => registry.generationOf(ownerId, slotId),
        hold: (ownerId, slotId) => registry.hold(ownerId, slotId),
        start: async () => ({ kind: 'already-running', sessionId: 'ghost' })
      }
    })
    await expect(start(1, REQUEST, makeSink())).rejects.toThrow()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('セッションの exited で Map から消え(registry が枠から外す購読より先)、予約も外れ、次の依頼は新しく起動する', async () => {
    const observed: (string | undefined)[] = []
    let svc: AgentSessionStarterService | null = null
    // registry と同じく、create の後(starter がセッションを返した後)に exited を購読する
    svc = service({
      registry: {
        generationOf: (ownerId, slotId) => registry.generationOf(ownerId, slotId),
        hold: (ownerId, slotId) => registry.hold(ownerId, slotId),
        start: (ownerId, slotId, create) =>
          registry.start(ownerId, slotId, async () => {
            const creation = await create()
            if (creation.kind === 'created') {
              const { session } = creation
              void session.exited.then(() => observed.push(svc?.claudeSessionIdOf(session.id)))
            }
            return creation
          })
      }
    })
    await svc.start(1, REQUEST, makeSink())
    expect(svc.claudeSessionIdOf('sid-1')).toBe(NEW_IDS[0])
    ptys[0].emitExit(0)
    await vi.waitFor(() => expect(observed).toEqual([undefined]))
    expect(svc.claudeSessionIdOf('sid-1')).toBeUndefined()
    expect(reservations.tryReserve(NEW_IDS[0])).not.toBeNull()
    await vi.waitFor(() => expect(registry.snapshot(1)).toEqual([]))
    await expect(svc.start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-2',
      claudeSessionId: NEW_IDS[1]
    })
  })

  it('同じ ID の 2 つの再開が並んでも 1 つだけ通り、ほかは session-in-use', async () => {
    records.record('/work', ID)
    const { start } = service()
    const results = await Promise.all([
      start(1, { ...RESUME, slotId: 'slot-a' }, makeSink()),
      start(1, { ...RESUME, slotId: 'slot-b' }, makeSink())
    ])
    expect(results.map((r) => (r.kind === 'error' ? r.error : r.kind)).sort()).toEqual([
      'session-in-use',
      'started'
    ])
    expect(spawnPty).toHaveBeenCalledOnce()
  })

  it('同じ ID が動いている間は、別の枠・別の所有者(ウィンドウ)からの再開を session-in-use で拒む', async () => {
    records.record('/work', ID)
    folderAccess.set(2, '/work')
    const { start } = service()
    await start(1, RESUME, makeSink())
    await expect(start(1, { ...RESUME, slotId: 'slot-2' }, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'session-in-use'
    })
    // 別の所有者の starter(同じ予約の集合を共有する)
    await expect(service().start(2, RESUME, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'session-in-use'
    })
    expect(spawnPty).toHaveBeenCalledOnce()
  })

  it('止める操作で止まりきる前は予約が残り(session-in-use)、止まりきると再開できる', async () => {
    records.record('/work', ID)
    const stop = holdNextStop()
    const { start } = service()
    await start(1, RESUME, makeSink())
    const stopping = registry.stop(1, 'stopped', 'sid-1')
    await expect(start(1, { ...RESUME, slotId: 'slot-2' }, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'session-in-use'
    })
    stop.open()
    await stopping
    await expect(start(1, { ...RESUME, slotId: 'slot-3' }, makeSink())).resolves.toMatchObject({
      kind: 'started',
      claudeSessionId: ID
    })
  })

  it('spawn した後に取り消した起動は、取り消しの停止が終わるまで予約が残り、記録しない', async () => {
    records.record('/work', ID)
    records.record('/work', OTHER)
    const stop = holdNextStop()
    spawnPty.mockImplementationOnce(() => {
      // spawn の直後(registry が世代を比べる前)にリロードが届いた
      void registry.stopOwner(1, 'stopped')
      const created = makeFakePty()
      ptys.push(created)
      return created
    })
    const { start } = service()
    const canceled = start(1, RESUME, makeSink())
    await vi.waitFor(() => expect(stopTree).toHaveBeenCalledOnce())
    await expect(start(1, { ...RESUME, slotId: 'slot-2' }, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'session-in-use'
    })
    stop.open()
    await expect(canceled).resolves.toEqual(CANCELED)
    expect(records.last('/work')).toBe(OTHER)
    await expect(start(1, { ...RESUME, slotId: 'slot-3' }, makeSink())).resolves.toMatchObject({
      kind: 'started',
      claudeSessionId: ID
    })
  })

  it('spawn が投げたら予約をすぐ外し、記録しない', async () => {
    records.record('/work', ID)
    records.record('/work', OTHER)
    spawnPty.mockImplementationOnce(() => {
      throw new Error('posix_spawnp failed.')
    })
    const { start } = service()
    await expect(start(1, RESUME, makeSink())).resolves.toMatchObject({ error: 'spawn-failed' })
    expect(records.last('/work')).toBe(OTHER)
    await expect(start(1, RESUME, makeSink())).resolves.toMatchObject({
      kind: 'started',
      claudeSessionId: ID
    })
  })

  it('起動が確定したら、記録の失敗でも started を返す(ログだけ。L-001)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { start } = service({
      records: {
        whenLoaded: () => records.whenLoaded(),
        has: (key, id) => records.has(key, id),
        last: (key) => records.last(key),
        record: vi.fn(() => {
          throw new Error('disk full')
        })
      }
    })
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      claudeSessionId: NEW_IDS[0]
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[agentSessionStarter] 起動の記録に失敗しました:',
      expect.any(Error)
    )
  })

  it('Windows のフォルダのキーは小文字で照合・記録する', async () => {
    folderAccess.set(1, 'C:\\Work')
    canonicalize.mockImplementation(async (path: string) => path)
    records.record('c:\\work', ID)
    const { start } = service({ platform: 'win32' })
    await expect(
      start(1, { ...RESUME, folderPath: 'C:\\Work' }, makeSink())
    ).resolves.toMatchObject({ kind: 'started', claudeSessionId: ID })
    expect(records.last('c:\\work')).toBe(ID)
  })
})
```

- [ ] **Step 3: テストが失敗することを確かめる**

Run: `npx vitest run src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts src/main/__tests__/agentCommand.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts`
Expected: FAIL（`parseAgentLaunchRequest`・`buildAgentLaunchArgs` が無い、結果に `claudeSessionId` が無い、starter が関数を返す）

- [ ] **Step 4: 共有の型・parser・引数を実装する**

`src/shared/types/agentTerminal.ts`:
- `AgentTerminalErrorKind` の `| 'too-many-sessions'` の次に足す:
```ts
  /** 再開の ID が許可のフォルダの起動の記録に無い(main が振った ID でない・ほかのフォルダの ID・古くなって記録から落ちた) */
  | 'unknown-session'
  /** 同じ ID の claude がほかのタブかウィンドウで起動中・実行中・止まりきる前 */
  | 'session-in-use'
```
- `AgentStartRequest` の前に足し、`AgentStartRequest` の `rows: number` の次に `launch` を足す:
```ts
/** 起動の指定。renderer は列挙型だけを渡し、コマンドと引数の並び(--session-id / --resume)は main が決める(L-019) */
export type AgentLaunchRequest = { kind: 'new' } | { kind: 'resume'; claudeSessionId: string }
```
```ts
  /** 新しく起動するか、起動の記録にある claude のセッションを再開するか(省略できない。既定の new に流さない。L-044) */
  launch: AgentLaunchRequest
```
- `AgentStartResult` の成功の型を次にする:
```ts
  | {
      kind: 'started' | 'already-running'
      sessionId: string
      /** そのセッションの claude の会話の ID。already-running は動いているセッションの ID(依頼の launch は使わない) */
      claudeSessionId: string
    }
```

`src/main/handlers/agentTerminalPayloadParser.ts`:
- import を次にする（`AgentLaunchRequest` の型と `isClaudeSessionId` を足す）:
```ts
import type { AgentLaunchRequest, AgentStartRequest } from '@shared/types'
import {
  AGENT_SLOT_ID_MAX_LENGTH,
  AGENT_SLOT_ID_PATTERN,
  AGENT_TERMINAL_MAX_COLS,
  AGENT_TERMINAL_MAX_ROWS,
  AGENT_TERMINAL_MIN_COLS,
  AGENT_TERMINAL_MIN_ROWS,
  AGENT_WRITE_MAX_LENGTH,
  isClaudeSessionId
} from '@shared/types'
```
- `parseAgentStartRequest` の前に足し、`parseAgentStartRequest` を次にする:
```ts
/** renderer が表示しているフォルダ(許可のフォルダとの一致の確認だけに使う)。起動・「前回」の取得で共有する */
export function parseAgentFolderPath(value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error('folderPath は空でない文字列である必要があります')
  }
  if (value.length > IPC_PATH_MAX_LENGTH) {
    throw new Error(`folderPath は ${IPC_PATH_MAX_LENGTH} 文字以下である必要があります`)
  }
  return value
}

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key))

/**
 * 起動の指定(新しく起動・記録した ID で再開)。無い・未知の kind・余分なキー・ID が小文字の UUID v4 でないものは投げる
 * (既定の new に流さない。L-044。`-` 始まりの値が claude のオプションとして解釈される経路を断つ。L-034)
 */
export function parseAgentLaunchRequest(value: unknown): AgentLaunchRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('launch はオブジェクトである必要があります')
  }
  const launch = value as Record<string, unknown>
  if (launch.kind === 'new') {
    if (!hasOnlyKeys(launch, ['kind'])) throw new Error('launch に余分なキーがあります')
    return { kind: 'new' }
  }
  if (launch.kind === 'resume') {
    if (!hasOnlyKeys(launch, ['kind', 'claudeSessionId'])) {
      throw new Error('launch に余分なキーがあります')
    }
    if (!isClaudeSessionId(launch.claudeSessionId)) {
      throw new Error('claudeSessionId は小文字の UUID v4 である必要があります')
    }
    return { kind: 'resume', claudeSessionId: launch.claudeSessionId }
  }
  throw new Error('launch.kind は new か resume である必要があります')
}

export function parseAgentStartRequest(payload: unknown): AgentStartRequest {
  assertPlainObject(payload)
  const { cols, rows } = payload
  const slotId = parseAgentSlotId(payload.slotId)
  const folderPath = parseAgentFolderPath(payload.folderPath)
  if (!isIntegerInRange(cols, AGENT_TERMINAL_MIN_COLS, AGENT_TERMINAL_MAX_COLS)) {
    throw new Error(
      `cols は ${AGENT_TERMINAL_MIN_COLS}〜${AGENT_TERMINAL_MAX_COLS} の整数である必要があります`
    )
  }
  if (!isIntegerInRange(rows, AGENT_TERMINAL_MIN_ROWS, AGENT_TERMINAL_MAX_ROWS)) {
    throw new Error(
      `rows は ${AGENT_TERMINAL_MIN_ROWS}〜${AGENT_TERMINAL_MAX_ROWS} の整数である必要があります`
    )
  }
  const launch = parseAgentLaunchRequest(payload.launch)
  return { slotId, folderPath, cols, rows, launch }
}
```
- 冒頭のコメントの次の行に足す: `// 起動の指定(launch)の claudeSessionId は形式を検証した値だけを starter へ渡し、starter はそのまま引数に使う(L-018)`

`src/main/agentCommand.ts`:
- import に `import type { AgentLaunchRequest } from '@shared/types'` を足す。
- `AGENT_COMMAND_NAME` のコメントを `/** 起動するコマンドの名前。引数は main が決めたセッションの指定(--session-id / --resume と UUID)だけ。--dangerously-skip-permissions などは付けない */` にする。
- `AgentLaunchPlan.args` のコメントを `/** 引数(空。セッションの指定は starter が buildAgentLaunchArgs で後ろに足す) */` にする。
- `resolveAgentLaunch` の前に足す:
```ts
/**
 * claude のセッションの指定の引数(設計書「起動の流れ」3)。新しく起動するときは main が振った ID を --session-id で、
 * 再開は記録と照合した ID を --resume で渡す。claudeSessionId は検証を通った値をそのまま使い、別の場所で読み直さない(L-018)
 */
export function buildAgentLaunchArgs(launch: AgentLaunchRequest, claudeSessionId: string): string[] {
  return launch.kind === 'resume' ? ['--resume', claudeSessionId] : ['--session-id', claudeSessionId]
}
```

`src/main/agentSessionRegistry.ts`:
- `AgentSessionCreation` の次に足す:
```ts
/**
 * registry の起動の結果。registry は pty の sessionId しか知らないため、成功は sessionId だけを返す(claude の会話の ID は
 * starter が足して共有の AgentStartResult にする)。エラーは共有の型と同じ
 */
export type AgentRegistryStartResult =
  | { kind: 'started' | 'already-running'; sessionId: string }
  | Extract<AgentStartResult, { kind: 'error' }>
```
- `pending?: { generation: string; run: Promise<AgentStartResult> }`・`start` の戻り値・`startHeld` の戻り値・`const run = (async (): Promise<AgentStartResult> => {` の 4 か所の `AgentStartResult` を `AgentRegistryStartResult` にする（処理は変えない）。

- [ ] **Step 5: starter を実装する**

`src/main/agentSessionStarter.ts` を次にする（既存の `canonicalOrSelf`・`isDirectoryOnDisk` はそのまま）:
```ts
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import type {
  AgentSessionData,
  AgentSessionExit,
  AgentStartRequest,
  AgentStartResult
} from '@shared/types'
import { agentStartCanceled } from '@shared/types'
import type { FolderAccessManager } from './folderAccessManager'
import type {
  AgentRegistryStartResult,
  AgentSessionCreation,
  AgentSessionRegistry
} from './agentSessionRegistry'
import { startAgentSession } from './agentSession'
import type { AgentSession, PtySpawn, StopTree } from './agentSession'
import { buildAgentLaunchArgs } from './agentCommand'
import type { AgentLaunchResolution } from './agentCommand'
import { toAgentFolderKey } from './agentSessionRecordStore'
import type { AgentSessionRecordStore } from './agentSessionRecordStore'
import type { ClaudeSessionReservations } from './claudeSessionReservations'

// エージェントのセッションの起動の規則と pty の配線(設計書「IPC」「停止の契機」、セッションの再開の設計書「起動の流れ」)。
// Electron に依存しない。IPC の受け口(送信元・ペイロードの検証、送信先の webContents への送信)は handlers/agentTerminalHandlers.ts。
// 起動のコマンド・作業ディレクトリ・環境変数・claude のセッションの指定は main で決め、依頼の folderPath は許可のフォルダとの
// 一致の確認にだけ使う。claude の会話の ID は、新しく起動するたびに振り(--session-id)、再開は許可のフォルダの記録にある ID だけを
// 受け付ける(--resume)。同じ ID の二重の起動は、全ウィンドウで共有する予約で spawn の直前に同期で拒む

/** 起動したセッションの出力の送り先(所有者の webContents。破棄済みかを確かめられる) */
export interface AgentSessionSink {
  /** 送り先が無くなった(破棄済み)か。起動の直前に確かめ直す */
  isGone(): boolean
  onData(payload: AgentSessionData): void
  onExit(payload: AgentSessionExit): void
}

export interface AgentSessionStarterDeps {
  folderAccess: Pick<FolderAccessManager, 'get'>
  registry: Pick<AgentSessionRegistry, 'generationOf' | 'hold' | 'start'>
  /** 起動のコマンドと環境変数を決める(agentCommand.resolveAgentLaunch に実物の依存を渡したもの) */
  resolveLaunch: () => Promise<AgentLaunchResolution>
  spawnPty: PtySpawn
  stopTree: StopTree
  /** pty のセッションの id */
  createSessionId: () => string
  /** フォルダごとの claude のセッションの起動の記録(再開の照合・起動が確定したときの記録・「前回」) */
  records: Pick<AgentSessionRecordStore, 'whenLoaded' | 'has' | 'last' | 'record'>
  /** 全ウィンドウで共有する claude のセッション ID の予約 */
  reservations: Pick<ClaudeSessionReservations, 'tryReserve'>
  /** 新しい claude のセッション ID(既定は crypto.randomUUID) */
  createClaudeSessionId?: () => string
  /** 記録のフォルダのキーの作り方を決める(既定は process.platform) */
  platform?: NodeJS.Platform
  /** 依頼のフォルダの正規化(既定は realpath。失敗したらそのまま) */
  canonicalize?: (path: string) => Promise<string>
  /** 作業ディレクトリがディレクトリとして存在するか(既定は stat) */
  isDirectory?: (path: string) => Promise<boolean>
}

export type AgentSessionStarter = (
  ownerId: number,
  request: AgentStartRequest,
  sink: AgentSessionSink
) => Promise<AgentStartResult>

export interface AgentSessionStarterService {
  start: AgentSessionStarter
  /**
   * pty の sessionId → claude の会話の ID。作ったセッションの exited の解決で消す(消す購読はセッションを registry へ返す前に
   * 付けるため、registry が枠からセッションを外すより先に消える)。無ければ undefined
   */
  claudeSessionIdOf(sessionId: string): string | undefined
}

async function canonicalOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

async function isDirectoryOnDisk(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export function createAgentSessionStarter({
  folderAccess,
  registry,
  resolveLaunch,
  spawnPty,
  stopTree,
  createSessionId,
  records,
  reservations,
  createClaudeSessionId = randomUUID,
  platform = process.platform,
  canonicalize = canonicalOrSelf,
  isDirectory = isDirectoryOnDisk
}: AgentSessionStarterDeps): AgentSessionStarterService {
  // pty の sessionId → claude の会話の ID(already-running・作り直しの後の合わせ込みで返す)
  const claudeSessionIds = new Map<string, string>()

  const start: AgentSessionStarter = async (ownerId, request, sink) => {
    // 枠の停止の世代は最初の await より前に控える(await の間に届いた停止を、起動の直前に見分けるため)。比べ終わるまで
    // 枠を消さないよう hold する(await の間に枠が空になって消えると、世代が 0 に戻って控えた世代と比べられなくなる)
    const requestedGeneration = registry.generationOf(ownerId, request.slotId)
    const release = registry.hold(ownerId, request.slotId)
    try {
      return await startHeld(ownerId, request, sink, requestedGeneration)
    } finally {
      release()
    }
  }

  async function startHeld(
    ownerId: number,
    request: AgentStartRequest,
    sink: AgentSessionSink,
    requestedGeneration: string
  ): Promise<AgentStartResult> {
    const allowedFolder = folderAccess.get(ownerId)
    if (allowedFolder === undefined) return { kind: 'error', error: 'no-folder' }
    if ((await canonicalize(request.folderPath)) !== allowedFolder) {
      return { kind: 'error', error: 'folder-mismatch' }
    }
    const folderKey = toAgentFolderKey(allowedFolder, platform)
    // この依頼の create で作ったセッションの claude の会話の ID(registry が started を返したときに記録して返す)
    const created: { claudeSessionId: string | null } = { claudeSessionId: null }
    const result = await registry.start(
      ownerId,
      request.slotId,
      async (): Promise<AgentSessionCreation> => {
        // 作業ディレクトリは renderer の文字列ではなく許可のフォルダ(main の値)
        if (!(await isDirectory(allowedFolder))) {
          return {
            kind: 'failed',
            result: { kind: 'error', error: 'folder-missing', detail: allowedFolder }
          }
        }
        // node-pty は存在しないコマンドでも例外を投げず終了コード 1 になるため、起動の前に探す(確認の結果 4)
        const launch = await resolveLaunch()
        if (launch.kind === 'not-found') {
          return {
            kind: 'failed',
            result: {
              kind: 'error',
              error: 'command-not-found',
              shellPathUnavailable: launch.shellPathUnavailable
            }
          }
        }
        // 再開の照合は下の同期の区間で行うため、記録の読み込みの完了をここで待つ(読み込みが間に合わない経路を作らない)
        await records.whenLoaded()
        // registry.start の前の await(realpath)の間に届いた停止(リロード・破棄・フォルダの切り替え)は、registry.start が
        // 控える世代に含まれてしまい registry では取り消せない。入口で控えた世代・破棄・許可のフォルダを起動の直前に
        // 確かめ直し、所有者のいない・リロード前の・切り替え前のフォルダのセッションを作らない
        if (
          registry.generationOf(ownerId, request.slotId) !== requestedGeneration ||
          sink.isGone() ||
          folderAccess.get(ownerId) !== allowedFolder
        ) {
          return { kind: 'failed', result: agentStartCanceled() }
        }
        // ここから spawn までは await を挟まない(記録の照合・予約の判定と予約の間に、別の起動が割り込まないように)
        const claudeSessionId =
          request.launch.kind === 'resume' ? request.launch.claudeSessionId : createClaudeSessionId()
        // 再開は、このフォルダで main が振った ID だけを受け付ける(renderer が乗っ取られても、ほかのプロジェクトの会話や
        // 任意の ID を再開させない。L-019)
        if (request.launch.kind === 'resume' && !records.has(folderKey, claudeSessionId)) {
          return { kind: 'failed', result: { kind: 'error', error: 'unknown-session' } }
        }
        // 新しい ID も予約する(UUID の衝突は起きない前提だが、外す経路を 1 つにそろえるため)
        const releaseReservation = reservations.tryReserve(claudeSessionId)
        if (releaseReservation === null) {
          return { kind: 'failed', result: { kind: 'error', error: 'session-in-use' } }
        }
        const sessionId = createSessionId()
        let session: AgentSession
        try {
          session = startAgentSession({
            id: sessionId,
            spawn: spawnPty,
            file: launch.plan.file,
            // 検証を通った ID をそのまま引数にする(L-018)
            args: [...launch.plan.args, ...buildAgentLaunchArgs(request.launch, claudeSessionId)],
            env: launch.plan.env,
            cwd: allowedFolder,
            cols: request.cols,
            rows: request.rows,
            stopTree,
            callbacks: {
              onData: (data) => sink.onData({ sessionId, data }),
              onExit: (exit) => sink.onExit({ sessionId, ...exit })
            }
          })
        } catch (err) {
          releaseReservation()
          const detail = err instanceof Error ? err.message : String(err)
          return { kind: 'failed', result: { kind: 'error', error: 'spawn-failed', detail } }
        }
        // 予約と Map は exited の解決で外す。registry が取り消した起動の停止の完了・終了・止める操作の完了は、どれも exited の
        // 解決になる(AgentSession.stop は止まりきると exited を解決する)。止める操作の間(stoppingSessions)は予約が残る。
        // registry へ返す前に購読するので、registry が枠からセッションを外すより先に Map から消える
        claudeSessionIds.set(sessionId, claudeSessionId)
        void session.exited.then(() => {
          claudeSessionIds.delete(sessionId)
          releaseReservation()
        })
        created.claudeSessionId = claudeSessionId
        return { kind: 'created', session }
      }
    )
    return finishStart(result, folderKey, created.claudeSessionId)
  }

  /** registry の結果に claude の会話の ID を足す。起動が確定した(started)ときだけ記録する */
  function finishStart(
    result: AgentRegistryStartResult,
    folderKey: string,
    createdClaudeSessionId: string | null
  ): AgentStartResult {
    if (result.kind === 'error') return result
    if (result.kind === 'started') {
      // registry の started は、この依頼の create が作り、取り消さずに枠に置いたセッションだけ
      if (createdClaudeSessionId === null) {
        throw new Error('起動したセッションの claude のセッション ID がありません')
      }
      // 起動は成功しているため、記録の失敗はログだけにする(次の 前回の続きから が古い記録を使うことがある。L-001)
      try {
        records.record(folderKey, createdClaudeSessionId)
      } catch (err) {
        console.error('[agentSessionStarter] 起動の記録に失敗しました:', err)
      }
      return { kind: 'started', sessionId: result.sessionId, claudeSessionId: createdClaudeSessionId }
    }
    // already-running(StrictMode の二重の依頼など)は、動いているセッションの ID を返す(依頼の launch は使わない)
    const claudeSessionId = claudeSessionIds.get(result.sessionId)
    if (claudeSessionId === undefined) {
      console.error(
        '[agentSessionStarter] 動いているセッションの claude のセッション ID が見つかりません:',
        result.sessionId
      )
      throw new Error('動いているセッションの claude のセッション ID が見つかりません')
    }
    return { kind: 'already-running', sessionId: result.sessionId, claudeSessionId }
  }

  return {
    start,
    claudeSessionIdOf: (sessionId) => claudeSessionIds.get(sessionId)
  }
}
```

- [ ] **Step 6: main の組み立てを直す**

`src/main/ipcHandlers.ts`:
- import に足す:
```ts
import { agentSessionRecordFileIo, createAgentSessionRecordStore } from './agentSessionRecordStore'
import { createClaudeSessionReservations } from './claudeSessionReservations'
```
- `const startAgentSession = createAgentSessionStarter({ … })` と `registerAgentTerminalHandlers(…)` を次にする:
```ts
  // claude のセッションの起動の記録(userData/agent-sessions.json)。読み込みはここで一度だけ始める
  const agentSessionRecords = createAgentSessionRecordStore(
    agentSessionRecordFileIo(app.getPath('userData'))
  )
  const agentStarter = createAgentSessionStarter({
    folderAccess,
    registry: agentRegistry,
    resolveLaunch: resolveAgentLaunchFromSystem,
    spawnPty: spawnAgentPty,
    stopTree: stopAgentPtyTree,
    createSessionId: randomUUID,
    records: agentSessionRecords,
    // 全ウィンドウで共有する(別のウィンドウで同じ会話を同時に開かせない)
    reservations: createClaudeSessionReservations(),
    createClaudeSessionId: randomUUID
  })
  registerAgentTerminalHandlers(ipcMain, {
    registry: agentRegistry,
    startSession: agentStarter.start
  })
```

`src/main/__tests__/ipcHandlers.test.ts`:
- `mockCreateAgentSessionStarter` を次にし、記録のストアのモックを足す:
```ts
const mockClaudeSessionIdOf = vi.hoisted(() => vi.fn())
const mockCreateAgentSessionStarter = vi.hoisted(() =>
  vi.fn(() => ({ start: mockStartAgentSession, claudeSessionIdOf: mockClaudeSessionIdOf }))
)
const mockAgentSessionRecords = vi.hoisted(() => ({ marker: 'records' }))
const mockAgentSessionRecordIo = vi.hoisted(() => ({ marker: 'record-io' }))
const mockCreateAgentSessionRecordStore = vi.hoisted(() => vi.fn(() => mockAgentSessionRecords))
const mockAgentSessionRecordFileIo = vi.hoisted(() => vi.fn(() => mockAgentSessionRecordIo))
vi.mock('../agentSessionRecordStore', () => ({
  createAgentSessionRecordStore: mockCreateAgentSessionRecordStore,
  agentSessionRecordFileIo: mockAgentSessionRecordFileIo
}))
```
- `vi.mock('electron', …)` の `app: {}` を `app: { getPath: vi.fn(() => '/mock/userData') }` にする。
- 「エージェントの起動の規則(starter)を、…」のテストの末尾に足す:
```ts
    // 起動の記録は userData の agent-sessions.json(読み込みは組み立ての時点で一度だけ始める)
    expect(mockAgentSessionRecordFileIo).toHaveBeenCalledExactlyOnceWith('/mock/userData')
    expect(mockCreateAgentSessionRecordStore).toHaveBeenCalledExactlyOnceWith(
      mockAgentSessionRecordIo
    )
    expect(starterDeps.records).toBe(mockAgentSessionRecords)
    // 予約の集合は 1 つ(同じ ID の 2 回目は null)
    const reservations = starterDeps.reservations as {
      tryReserve: (id: string) => (() => void) | null
    }
    expect(reservations.tryReserve('11111111-1111-4111-8111-111111111111')).not.toBeNull()
    expect(reservations.tryReserve('11111111-1111-4111-8111-111111111111')).toBeNull()
    // claude のセッション ID は呼ぶたびに別の小文字の UUID v4
    const createClaudeSessionId = starterDeps.createClaudeSessionId as () => string
    const claudeId = createClaudeSessionId()
    expect(isClaudeSessionId(claudeId)).toBe(true)
    expect(createClaudeSessionId()).not.toBe(claudeId)
```
（import に `import { isClaudeSessionId } from '@shared/types'` を足す。受け口へ渡す依存の期待〈`deps toEqual({ registry, startSession: mockStartAgentSession })`〉は変えない）

- [ ] **Step 7: テストが通ることを確かめる**

Run: `npx vitest run src/main src/preload src/shared`
Expected: PASS

- [ ] **Step 8: 検証**

Run: `npm run typecheck:node`
Expected: エラーなし。このタスクの検証は `typecheck:node` で行い、web は Task 5 で通す（`npm run typecheck:web` は Task 5 まで落ちる）
Run: 変更した `.ts` へ `npx eslint --fix <files>` → `npx eslint --max-warnings 0 <files>`
Expected: エラー・警告なし

---

### Task 4: 「前回」の取得の IPC と作り直しの後の合わせ込みの `claudeSessionId`（handlers・preload・renderer の API）

**Files:**
- Modify: `src/shared/types/agentTerminal.ts`（`AgentLastSession`・`AgentSessionSnapshotEntry.claudeSessionId`）
- Modify: `src/main/agentSessionRegistry.ts`（`snapshot` を `AgentRegistrySnapshotEntry[]` へ型の付け替えだけ）
- Modify: `src/main/agentSessionStarter.ts`（`AgentSessionStarterService.lastSessionOf`）
- Modify: `src/main/handlers/agentTerminalHandlers.ts`（`agentTerminal:getLastSession`・`getState` の ID の付け足し・依存）
- Modify: `src/main/ipcHandlers.ts`（`claudeSessionIdOf`・`getLastSession` を渡す）
- Modify: `src/preload/api.ts`・`src/preload/index.d.ts`（`getLastAgentSession`）
- Modify: `src/renderer/src/lib/agentTerminalApi.ts`（`getLastAgentSession`）
- Modify: `src/renderer/src/__tests__/setup.ts`（`window.api.getLastAgentSession` の既定）
- Test: `src/main/__tests__/agentSessionStarter.test.ts`、`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`、`src/main/__tests__/ipcHandlers.test.ts`、`src/preload/__tests__/api.test.ts`、`src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`

**Interfaces:**
- Consumes: `AgentSessionStarterService`・`createAgentSessionStarter`（Task 3）、`parseAgentFolderPath`（Task 3）、`toAgentFolderKey`（Task 2）
- Produces:
```ts
// src/shared/types/agentTerminal.ts
export interface AgentLastSession { claudeSessionId: string }
export interface AgentSessionSnapshotEntry { slotId: string; sessionId: string; claudeSessionId: string }
// src/main/agentSessionRegistry.ts
export interface AgentRegistrySnapshotEntry { slotId: string; sessionId: string }
// AgentSessionRegistry.snapshot(ownerId): AgentRegistrySnapshotEntry[]
// src/main/agentSessionStarter.ts
export interface AgentSessionStarterService {
  start: AgentSessionStarter
  claudeSessionIdOf(sessionId: string): string | undefined
  /** folderPath を正規化して許可のフォルダと一致するときだけ、記録の先頭を返す。一致しない・記録が無ければ null */
  lastSessionOf(ownerId: number, folderPath: string): Promise<AgentLastSession | null>
}
// src/main/handlers/agentTerminalHandlers.ts
export interface AgentTerminalHandlerDeps {
  registry: Pick<AgentSessionRegistry, 'write' | 'resize' | 'stop' | 'snapshot'>
  startSession: AgentSessionStarter
  claudeSessionIdOf: AgentSessionStarterService['claudeSessionIdOf']
  getLastSession: AgentSessionStarterService['lastSessionOf']
  platform?: NodeJS.Platform
}
// preload(window.api)・src/renderer/src/lib/agentTerminalApi.ts
getLastAgentSession(folderPath: string): Promise<AgentLastSession | null>
```

- [ ] **Step 1: 既存のテストを直す**

`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`:
- import に `import type { AgentSessionRecordStore } from '../../agentSessionRecordStore'` を足し、`let resolveLaunch …` の次に `let records: AgentSessionRecordStore` を足す。`beforeEach` の末尾に `records = createAgentSessionRecordStore(EMPTY_RECORD_IO)` を足す。
- `register` を次にする（同じ starter の 3 つの口を渡す）:
```ts
function register(overrides: Partial<AgentTerminalHandlerDeps> = {}): void {
  const starter = createAgentSessionStarter({
    folderAccess,
    registry,
    resolveLaunch,
    spawnPty,
    stopTree,
    createSessionId: () => 'sid-1',
    records,
    reservations: createClaudeSessionReservations(),
    createClaudeSessionId: () => CLAUDE_ID,
    platform: 'linux'
  })
  registerAgentTerminalHandlers(ipcMain as never, {
    registry,
    startSession: starter.start,
    claudeSessionIdOf: starter.claudeSessionIdOf,
    getLastSession: starter.lastSessionOf,
    platform: 'linux',
    ...overrides
  })
}
```
- `getState` の期待に ID を足す: `perl -pi -e "s/\{ slotId: 'slot-1', sessionId: 'sid-1' \}/{ slotId: 'slot-1', sessionId: 'sid-1', claudeSessionId: CLAUDE_ID }/g" src/main/__tests__/handlers/agentTerminalHandlers.test.ts`（4 か所）

`src/main/__tests__/ipcHandlers.test.ts`:
- `mockCreateAgentSessionStarter` の戻り値に `lastSessionOf: mockLastSessionOf` を足す（`const mockLastSessionOf = vi.hoisted(() => vi.fn())` をその前に置く）。
- 「エージェントのセッションの寿命と IPC に、…」のテストの受け口の依存の期待を次にする:
```ts
    // IPC の受け口には registry と、組み立てた starter の起動・ID の引き当て・「前回」の取得だけを渡す
    expect(deps).toEqual({
      registry,
      startSession: mockStartAgentSession,
      claudeSessionIdOf: mockClaudeSessionIdOf,
      getLastSession: mockLastSessionOf
    })
    expect(deps.registry).toBe(registry)
    expect(deps.startSession).toBe(mockStartAgentSession)
    expect(deps.claudeSessionIdOf).toBe(mockClaudeSessionIdOf)
    expect(deps.getLastSession).toBe(mockLastSessionOf)
```

`src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`: `mockApi` に `getLastAgentSession: vi.fn()` を足す。最初のテストの `startAgentSession` の呼び出しと期待に `launch: { kind: 'new' }` を足し、`agentTerminalApi.getLastAgentSession('/p')` を呼んで `expect(mockApi.getLastAgentSession).toHaveBeenCalledWith('/p')` を足す。

- [ ] **Step 2: 失敗するテストを書く**

`src/main/__tests__/agentSessionStarter.test.ts` の末尾に足す:
```ts
describe('createAgentSessionStarter: lastSessionOf(前回)', () => {
  const ID = '11111111-1111-4111-8111-111111111111'

  it('依頼のフォルダの正規化が許可のフォルダと一致するときだけ、記録の先頭を返す', async () => {
    await records.whenLoaded()
    records.record('/work', ID)
    const { lastSessionOf } = makeStarterService()
    await expect(lastSessionOf(1, '/work/.')).resolves.toEqual({ claudeSessionId: ID })
    await expect(lastSessionOf(1, '/other')).resolves.toBeNull()
    await expect(lastSessionOf(2, '/work')).resolves.toBeNull()
  })

  it('記録が無ければ null', async () => {
    await expect(makeStarterService().lastSessionOf(1, '/work')).resolves.toBeNull()
  })

  it('記録の読み込みの完了を待ってから先頭を返す', async () => {
    const read = deferred<string>()
    records = createAgentSessionRecordStore({ read: () => read.promise, write: async () => undefined })
    const result = makeStarterService().lastSessionOf(1, '/work')
    read.resolve(JSON.stringify({ version: 1, folders: [{ key: '/work', ids: [ID] }] }))
    await expect(result).resolves.toEqual({ claudeSessionId: ID })
  })

  it('正規化を待つ間に許可のフォルダが切り替わったら null(切り替え前のフォルダの記録を返さない)', async () => {
    await records.whenLoaded()
    records.record('/work', ID)
    const pending = deferred<string>()
    canonicalize.mockReturnValueOnce(pending.promise)
    const result = makeStarterService().lastSessionOf(1, '/work')
    folderAccess.set(1, '/other')
    pending.resolve('/work')
    await expect(result).resolves.toBeNull()
  })
})
```

`src/main/__tests__/handlers/agentTerminalHandlers.test.ts` の末尾に足す:
```ts
describe('agentTerminal:getLastSession', () => {
  const getLast = (event: ReturnType<typeof makeEvent>, folderPath: unknown): Promise<unknown> =>
    handles.get('agentTerminal:getLastSession')?.(event, folderPath) as Promise<unknown>

  it('許可のフォルダ(realpath が一致)のときだけ記録の先頭を返す', async () => {
    register()
    folderAccess.set(1, '/work')
    await records.whenLoaded()
    records.record('/work', CLAUDE_ID)
    await expect(getLast(makeEvent(), '/work/.')).resolves.toEqual({ claudeSessionId: CLAUDE_ID })
    await expect(getLast(makeEvent(), '/other')).resolves.toBeNull()
    // 別のウィンドウ(許可のフォルダが無い)
    await expect(getLast(makeEvent(2), '/work')).resolves.toBeNull()
  })

  it('記録が無ければ null', async () => {
    register()
    folderAccess.set(1, '/work')
    await expect(getLast(makeEvent(), '/work')).resolves.toBeNull()
  })

  it('不正な folderPath・サブフレームからの依頼は投げる', async () => {
    register()
    folderAccess.set(1, '/work')
    await expect(getLast(makeEvent(), '')).rejects.toThrow()
    await expect(getLast(makeEvent(), 1)).rejects.toThrow()
    await expect(getLast(makeEvent(1, false), '/work')).rejects.toThrow()
  })
})

describe('agentTerminal:getState(claude のセッション ID)', () => {
  let consoleWarnSpy: MockInstance<typeof console.warn> | null = null

  afterEach(() => {
    consoleWarnSpy?.mockRestore()
    consoleWarnSpy = null
  })

  it('starter の Map に無いセッションは、例外にせず一覧から外してログを残す(合わせ込みの全体を止めない)', async () => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    register({ claudeSessionIdOf: () => undefined })
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    expect(handles.get('agentTerminal:getState')?.(event)).toEqual([])
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[agentTerminal:getState] claude のセッション ID が見つからないセッションを一覧から外します:',
      'sid-1'
    )
  })
})
```
（`vitest` の import に `afterEach` と `import type { MockInstance } from 'vitest'` を足す）

`src/preload/__tests__/api.test.ts` の `it.each` の表の `getAgentSessions …` の次に足す:
```ts
    [
      'getLastAgentSession は agentTerminal:getLastSession にフォルダを渡す',
      () => api.getLastAgentSession('/p'),
      ['agentTerminal:getLastSession', '/p']
    ],
```

- [ ] **Step 3: テストが失敗することを確かめる**

Run: `npx vitest run src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`
Expected: FAIL（`lastSessionOf`・`agentTerminal:getLastSession`・`getLastAgentSession` が無い、`getState` に ID が無い）

- [ ] **Step 4: 実装する**

`src/shared/types/agentTerminal.ts`:
- `AgentSessionSnapshotEntry` を次にし、その次に `AgentLastSession` を足す:
```ts
/** 生きているセッションと、それを持つ枠(getAgentSessions の戻り値の要素) */
export interface AgentSessionSnapshotEntry {
  slotId: string
  sessionId: string
  /** そのセッションの claude の会話の ID(作り直しの後の合わせ込みで、タブの claudeSessionId を合わせる) */
  claudeSessionId: string
}

/** このフォルダで最後に起動が確定した claude のセッション(「前回の続きから」の再開の相手) */
export interface AgentLastSession {
  claudeSessionId: string
}
```

`src/main/agentSessionRegistry.ts`:
- import の型から `AgentSessionSnapshotEntry` を外す。`AgentRegistryStartResult` の次に足す:
```ts
/** registry の snapshot の要素(pty の sessionId だけ。claude の会話の ID は IPC の受け口が starter から足す) */
export interface AgentRegistrySnapshotEntry {
  slotId: string
  sessionId: string
}
```
- `snapshot(ownerId: number): AgentSessionSnapshotEntry[]` と `const entries: AgentSessionSnapshotEntry[] = []` の型を `AgentRegistrySnapshotEntry` にする（処理は変えない）。

`src/main/agentSessionStarter.ts`:
- import の型に `AgentLastSession` を足す。
- `AgentSessionStarterService` に足す:
```ts
  /**
   * 「前回」の取得(agentTerminal:getLastSession)。folderPath を正規化して許可のフォルダと一致するときだけ、記録の先頭を返す。
   * 一致しない・記録が無ければ null
   */
  lastSessionOf(ownerId: number, folderPath: string): Promise<AgentLastSession | null>
```
- `return { start, claudeSessionIdOf: … }` の前に足し、戻り値に `lastSessionOf` を足す:
```ts
  async function lastSessionOf(ownerId: number, folderPath: string): Promise<AgentLastSession | null> {
    const allowedFolder = folderAccess.get(ownerId)
    if (allowedFolder === undefined) return null
    if ((await canonicalize(folderPath)) !== allowedFolder) return null
    await records.whenLoaded()
    // await の間にフォルダが切り替わっていたら、切り替え前のフォルダの記録を返さない
    if (folderAccess.get(ownerId) !== allowedFolder) return null
    const claudeSessionId = records.last(toAgentFolderKey(allowedFolder, platform))
    return claudeSessionId === null ? null : { claudeSessionId }
  }
```
```ts
  return {
    start,
    claudeSessionIdOf: (sessionId) => claudeSessionIds.get(sessionId),
    lastSessionOf
  }
```

`src/main/handlers/agentTerminalHandlers.ts`:
- import を次にする:
```ts
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import type { AgentLastSession, AgentSessionSnapshotEntry, AgentStartResult } from '@shared/types'
import type { AgentSessionRegistry } from '../agentSessionRegistry'
import type { AgentSessionStarter, AgentSessionStarterService } from '../agentSessionStarter'
import { isDestroyedSafely, sendSafely } from '../safeWebContentsSend'
import { isMainFrameSender } from './ipcSenderGuard'
import {
  parseAgentFolderPath,
  parseAgentResize,
  parseAgentSessionId,
  parseAgentStartRequest,
  parseAgentWrite
} from './agentTerminalPayloadParser'
```
- 冒頭のコメントの 2 行目を `// renderer からは slotId(タブ)・folderPath(許可との一致の確認だけ)・桁数・行数・起動の指定(新規・再開の列挙型)・書き込む文字列・sessionId だけを受け取る` にする。
- `AgentTerminalHandlerDeps` の `startSession` の次に足す:
```ts
  /** pty の sessionId → claude の会話の ID(starter の Map)。作り直しの後の合わせ込み(getState)で足す */
  claudeSessionIdOf: AgentSessionStarterService['claudeSessionIdOf']
  /** 「前回」の取得(starter の lastSessionOf。許可のフォルダとの照合は starter が行う) */
  getLastSession: AgentSessionStarterService['lastSessionOf']
```
- 関数の引数の分割に `claudeSessionIdOf, getLastSession` を足す。
- `agentTerminal:getState` の本体を次にし、その次に `agentTerminal:getLastSession` を足す:
```ts
  ipcMain.handle(
    'agentTerminal:getState',
    (event: IpcMainInvokeEvent): AgentSessionSnapshotEntry[] => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      return registry.snapshot(event.sender.id).flatMap((entry): AgentSessionSnapshotEntry[] => {
        const claudeSessionId = claudeSessionIdOf(entry.sessionId)
        if (claudeSessionId === undefined) {
          // exited の途中の瞬間(starter の Map から消えた後、registry が枠から外す前)に当たりうる。合わせ込みの全体を止めない
          console.warn(
            '[agentTerminal:getState] claude のセッション ID が見つからないセッションを一覧から外します:',
            entry.sessionId
          )
          return []
        }
        return [{ slotId: entry.slotId, sessionId: entry.sessionId, claudeSessionId }]
      })
    }
  )

  ipcMain.handle(
    'agentTerminal:getLastSession',
    async (event: IpcMainInvokeEvent, folderPath: unknown): Promise<AgentLastSession | null> => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      return getLastSession(event.sender.id, parseAgentFolderPath(folderPath))
    }
  )
```

`src/main/ipcHandlers.ts` の `registerAgentTerminalHandlers` の依存を次にする:
```ts
  registerAgentTerminalHandlers(ipcMain, {
    registry: agentRegistry,
    startSession: agentStarter.start,
    claudeSessionIdOf: agentStarter.claudeSessionIdOf,
    getLastSession: agentStarter.lastSessionOf
  })
```
（`// 起動の規則(…)は agentSessionStarter.ts。IPC の受け口は …` のコメントを `registry(書き込み・リサイズ・停止・状態の取得)と、組み立てた starter の起動・ID の引き当て・「前回」の取得だけを受け取る` に直す）

`src/preload/api.ts`: import の型に `AgentLastSession` を足し、`getAgentSessions` の次に足す:
```ts
  // このフォルダで最後に起動が確定した claude のセッション(前回の続きから)。照合は main が許可のフォルダで行う
  getLastAgentSession: (folderPath: string): Promise<AgentLastSession | null> =>
    ipcRenderer.invoke('agentTerminal:getLastSession', folderPath),
```
`src/preload/index.d.ts`: import の型に `AgentLastSession` を足し、`getAgentSessions(): Promise<AgentSessionSnapshotEntry[]>` の次に `getLastAgentSession(folderPath: string): Promise<AgentLastSession | null>` を足す。

`src/renderer/src/lib/agentTerminalApi.ts`: import の型に `AgentLastSession` を足し、`getAgentSessions` の次に足す:
```ts
export function getLastAgentSession(folderPath: string): Promise<AgentLastSession | null> {
  return window.api.getLastAgentSession(folderPath)
}
```
`src/renderer/src/__tests__/setup.ts` の `getAgentSessions: () => Promise.resolve([]),` の次に `getLastAgentSession: () => Promise.resolve(null),` を足す。

- [ ] **Step 5: テストが通ることを確かめる**

Run: `npx vitest run src/main src/preload src/shared src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`
Expected: PASS

- [ ] **Step 6: 検証**

Run: `npm run typecheck:node`
Expected: エラーなし。このタスクの検証は `typecheck:node` で行い、web は Task 5 で通す。`src/preload/index.d.ts`（`getLastAgentSession` の宣言）は web の型検査でしか見られないため、`src/preload/api.ts` と名前・引数・戻り値の型が一致していることを目で確かめる
Run: 変更した `.ts` へ `npx eslint --fix <files>` → `npx eslint --max-warnings 0 <files>`
Expected: エラー・警告なし

---

### Task 5: renderer のタブの状態（`start(slotId, launch)`・タブの `claudeSessionId`・`resumeInNewTab`・起動の失敗の文言）

**Files:**
- Modify: `src/renderer/src/lib/agentSessionTabState.ts`（`AgentTabSessionFields.claudeSessionId`・`findActiveAgentTabByClaudeSessionId`）
- Modify: `src/renderer/src/lib/agentSessionMessages.ts`（`describeAgentStartError` の `unknown-session`・`session-in-use`）
- Modify: `src/renderer/src/hooks/useAgentSessions.ts`
- Modify: `src/renderer/src/components/agent/AgentTerminalPanel.tsx`（`起動` は `{ kind: 'new' }`）
- Modify: `src/renderer/src/__tests__/makeAgentSessionsState.ts`（`claudeSessionId: null`・`resumeInNewTab`）
- Test: `src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`、`src/renderer/src/lib/__tests__/agentSessionTabState.test.ts`、`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`、`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`

**Interfaces:**
- Consumes: `AgentLaunchRequest`・`AgentStartResult`（`claudeSessionId`）・`AgentSessionSnapshotEntry`（`claudeSessionId`）（Task 3・4）
- Produces:
```ts
// src/renderer/src/lib/agentSessionTabState.ts
export interface AgentTabSessionFields {
  status: AgentSessionStatus
  exit: AgentSessionExitView | null
  error: string | null
  /** 起動中(resume は依頼した ID、new は結果が届いてから)・実行中のセッションの claude の会話の ID。それ以外は null */
  claudeSessionId: string | null
}
export function findActiveAgentTabByClaudeSessionId<
  T extends { status: AgentSessionStatus; claudeSessionId: string | null }
>(tabs: readonly T[], claudeSessionId: string): T | undefined
// src/renderer/src/lib/agentSessionMessages.ts
export const AGENT_UNKNOWN_SESSION = 'このセッションは再開できません（アプリの起動の記録にありません）'
export const AGENT_SESSION_IN_USE = 'このセッションはほかのタブかウィンドウで動いています'
// src/renderer/src/hooks/useAgentSessions.ts
export interface AgentSessionTabView { /* 既存 */ claudeSessionId: string | null }
export interface AgentSessionsState {
  /* 既存 */
  start: (slotId: string, launch: AgentLaunchRequest) => Promise<void>
  /** 新しいタブを足して選択し、そのタブで再開する。足したタブの slotId(足さなかったら null)。起動の完了は待たない */
  resumeInNewTab: (claudeSessionId: string) => string | null
}
```

- [ ] **Step 1: 既存のテストを新しい形に直す**

`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`:
- 結果・一覧の値に ID を足す: `perl -pi -e "s/((?:kind: '(?:started|already-running)'|slotId: '[\w-]+'), sessionId: '[\w-]+') \}/\$1, claudeSessionId: CSID }/g" src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`
- `start` の呼び出しに起動の指定を足す: `perl -pi -e "s/\.start\(('slot-\d+'|result\.current\.selected\.slotId)\)/.start(\$1, NEW)/g" src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`
- import の `@shared/types` の型に `AgentLaunchRequest` を足し、`const mockStart = …` の前に足す:
```ts
const CSID = '11111111-1111-4111-8111-111111111111'
const CSID2 = '22222222-2222-4222-9222-222222222222'
const NEW: AgentLaunchRequest = { kind: 'new' }
const resumeOf = (claudeSessionId: string): AgentLaunchRequest => ({ kind: 'resume', claudeSessionId })
```
- `mockStart).toHaveBeenCalledWith({ slotId: 'slot-1', folderPath: '/work', cols: 80, rows: 24 })`（118 行目付近）と、同じ形の 271 行目付近の期待に `launch: NEW` を足す。
- `npx vitest run src/renderer/src/hooks/__tests__/useAgentSessions.test.ts` の前に、`grep -n "kind: 'started'\|already-running\|sessionId: 's" src/renderer/src/hooks/__tests__/useAgentSessions.test.ts` で、複数行に分かれた結果のリテラル（perl で拾えないもの）が無いかを確かめ、あれば同じく `claudeSessionId: CSID` を足す。

`src/renderer/src/lib/__tests__/agentSessionTabState.test.ts` の `const fields = { status: 'running' as const, exit: null, error: null }` に `claudeSessionId: null` を足す。

`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx` の `起動を押すと選択中のタブの start を呼ぶ` の期待を `toHaveBeenCalledExactlyOnceWith('slot-2', { kind: 'new' })` にし、テスト名を `起動を押すと選択中のタブを新しいセッション(new)で start する` にする。

`src/renderer/src/components/__tests__/App.agentReferences.test.tsx` の `window.api.startAgentSession = vi.fn().mockResolvedValue({ kind: 'started', sessionId: 's1' })` を `{ kind: 'started', sessionId: 's1', claudeSessionId: '11111111-1111-4111-8111-111111111111' }` にする（`vi.fn()` は型で検出されないが、renderer がタブの `claudeSessionId` を結果から読むため）。ほかにも `grep -rn "kind: 'started'\|kind: 'already-running'" src/renderer/src` で、`startAgentSession` を `started`・`already-running` で返しているモック（`useAgentSessions.test.ts` 以外。計画の時点では上の 1 か所だけ）を洗い、あれば同じく正しい形の UUID の `claudeSessionId` を足す。

`src/renderer/src/__tests__/makeAgentSessionsState.ts`: `makeAgentSessionTabView` の既定の `error: null,` の次に `claudeSessionId: null,`、`makeAgentSessionsState` の `addTab` の次に `resumeInNewTab: vi.fn<AgentSessionsState['resumeInNewTab']>(() => null),` を足す。

- [ ] **Step 2: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentSessionTabState.test.ts` の import に `findActiveAgentTabByClaudeSessionId` を足し、末尾に足す:
```ts
describe('findActiveAgentTabByClaudeSessionId', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  const tab = (
    slotId: string,
    status: 'none' | 'starting' | 'running' | 'exited',
    claudeSessionId: string | null
  ): { slotId: string; status: typeof status; claudeSessionId: string | null } => ({
    slotId,
    status,
    claudeSessionId
  })

  it('同じ ID の起動中・実行中のタブを返す', () => {
    expect(findActiveAgentTabByClaudeSessionId([tab('a', 'running', ID)], ID)?.slotId).toBe('a')
    expect(findActiveAgentTabByClaudeSessionId([tab('b', 'starting', ID)], ID)?.slotId).toBe('b')
  })

  it('動いていない・ID が違う・ID が無いタブは返さない', () => {
    expect(
      findActiveAgentTabByClaudeSessionId(
        [tab('a', 'exited', ID), tab('b', 'none', ID), tab('c', 'running', null)],
        ID
      )
    ).toBeUndefined()
    expect(
      findActiveAgentTabByClaudeSessionId(
        [tab('a', 'running', '22222222-2222-4222-9222-222222222222')],
        ID
      )
    ).toBeUndefined()
  })
})
```

`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts` の末尾に足す:
```ts
describe('再開の失敗の文言', () => {
  it.each([
    ['unknown-session' as const, 'このセッションは再開できません（アプリの起動の記録にありません）'],
    ['session-in-use' as const, 'このセッションはほかのタブかウィンドウで動いています']
  ])('%s', (error, message) => {
    expect(describeAgentStartError({ kind: 'error', error })).toBe(message)
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts` の末尾に足す:
```ts
describe('useAgentSessions — claude のセッション ID', () => {
  it('start は起動の指定(launch)をそのまま main へ渡す', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1', claudeSessionId: CSID })
    const { result } = render()
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID))
    })
    expect(mockStart).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ slotId: 'slot-1', launch: resumeOf(CSID) })
    )
  })

  it('new は結果が届いてから、resume は起動中から、タブに claudeSessionId を持つ', async () => {
    let resolveStart: (value: AgentStartResult) => void = () => undefined
    mockStart.mockImplementationOnce(() => new Promise((r) => (resolveStart = r)))
    const { result } = render()
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.start('slot-1', NEW)
    })
    expect(result.current.selected).toMatchObject({ status: 'starting', claudeSessionId: null })
    await act(async () => {
      resolveStart({ kind: 'started', sessionId: 's1', claudeSessionId: CSID })
      await first
    })
    expect(result.current.selected).toMatchObject({ status: 'running', claudeSessionId: CSID })
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' }))
    mockStart.mockImplementationOnce(() => new Promise((r) => (resolveStart = r)))
    act(() => {
      first = result.current.start('slot-1', resumeOf(CSID))
    })
    expect(result.current.selected).toMatchObject({ status: 'starting', claudeSessionId: CSID })
    await act(async () => {
      resolveStart({ kind: 'started', sessionId: 's2', claudeSessionId: CSID })
      await first
    })
    expect(result.current.selected.claudeSessionId).toBe(CSID)
  })

  it('resume に already-running が返り、ID が依頼と違えば結果の ID で上書きする(そのタブで動いているのは結果のセッション)', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'already-running', sessionId: 's7', claudeSessionId: CSID2 })
    const { result } = render()
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID))
    })
    expect(result.current.selected).toMatchObject({ status: 'running', claudeSessionId: CSID2 })
  })

  it.each([
    ['終了', 'exit'],
    ['起動の失敗', 'error'],
    ['起動の取り消し', 'canceled'],
    ['起動の依頼の例外', 'throw']
  ])('%s で claudeSessionId を null に戻す', async (_label, kind) => {
    if (kind === 'exit')
      mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1', claudeSessionId: CSID })
    else if (kind === 'error')
      mockStart.mockResolvedValueOnce({ kind: 'error', error: 'unknown-session' })
    else if (kind === 'canceled')
      mockStart.mockResolvedValueOnce({
        kind: 'error',
        error: 'spawn-failed',
        detail: AGENT_START_CANCELED_DETAIL
      })
    else mockStart.mockRejectedValueOnce(new Error('ipc down'))
    const { result } = render()
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID))
    })
    if (kind === 'exit')
      act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' }))
    expect(result.current.selected.claudeSessionId).toBeNull()
  })

  it('unknown-session・session-in-use は、そのタブのエラーとして文言を出す', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'error', error: 'session-in-use' })
    const { result } = render()
    await act(async () => {
      await result.current.start('slot-1', resumeOf(CSID))
    })
    expect(result.current.selected).toMatchObject({
      status: 'none',
      error: 'このセッションはほかのタブかウィンドウで動いています'
    })
  })

  it('ほかのタブで同じ ID が起動中・実行中なら、resume は何もしない(処理の側の守り。L-058)', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1', claudeSessionId: CSID })
    const { result } = render()
    await act(async () => {
      await result.current.start('slot-1', NEW)
    })
    let slot2 = ''
    act(() => {
      slot2 = tabs.add()!.slotId
    })
    mockStart.mockClear()
    await act(async () => {
      await result.current.start(slot2, resumeOf(CSID))
    })
    expect(mockStart).not.toHaveBeenCalled()
    expect(tabOf(result.current, slot2).status).toBe('none')
  })

  it('resumeInNewTab はタブを足して選択し、そのタブで resume を始めて slotId を返す(完了は待たない)', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1', claudeSessionId: CSID })
    const { result } = render()
    let slotId: string | null = null
    act(() => {
      slotId = result.current.resumeInNewTab(CSID)
    })
    expect(slotId).toBe('slot-2')
    expect(result.current.selected.slotId).toBe('slot-2')
    expect(mockStart).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ slotId: 'slot-2', launch: resumeOf(CSID) })
    )
    await waitFor(() =>
      expect(tabOf(result.current, 'slot-2')).toMatchObject({ status: 'running', claudeSessionId: CSID })
    )
  })

  it.each([
    ['タブが上限', { folderPath: '/work' }, true],
    ['起動を受け付けない間', { startBlockedReason: '実行方式を切り替えています' }, false],
    ['フォルダが無い', { folderPath: null }, false]
  ])('resumeInNewTab は %s なら何もせず null を返す', (_label, options, fill) => {
    const { result } = render(options)
    if (fill) {
      act(() => {
        while (tabs.add() !== null) {
          // 上限まで足す
        }
      })
    }
    const before = tabs.getSnapshot().tabs.length
    let slotId: string | null = 'x'
    act(() => {
      slotId = result.current.resumeInNewTab(CSID)
    })
    expect(slotId).toBeNull()
    expect(tabs.getSnapshot().tabs).toHaveLength(before)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('resumeInNewTab は同じ ID のタブが起動中・実行中なら何もせず null を返す', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1', claudeSessionId: CSID })
    const { result } = render()
    await act(async () => {
      await result.current.start('slot-1', NEW)
    })
    let slotId: string | null = 'x'
    act(() => {
      slotId = result.current.resumeInNewTab(CSID)
    })
    expect(slotId).toBeNull()
    expect(tabs.getSnapshot().tabs).toHaveLength(1)
  })

  it('作り直しの後の合わせ込みで、タブの claudeSessionId も合わせる', async () => {
    mockGetState.mockResolvedValueOnce([{ slotId: 'slot-1', sessionId: 's-1', claudeSessionId: CSID2 }])
    const { result } = render()
    await waitFor(() =>
      expect(result.current.selected).toMatchObject({ status: 'running', claudeSessionId: CSID2 })
    )
  })
})
```

- [ ] **Step 3: テストが失敗することを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/lib/__tests__/agentSessionTabState.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`
Expected: FAIL（`launch` が渡らない、`claudeSessionId`・`resumeInNewTab`・`findActiveAgentTabByClaudeSessionId` が無い、文言が無い）

- [ ] **Step 4: 実装する**

`src/renderer/src/lib/agentSessionTabState.ts`:
- `AgentTabSessionFields` のコメントを `/** タブごとの起動・停止・終了の状態(slotId をキーにして持つ)。pty の sessionId は持たない(useAgentSessions の ref と controller が持つ) */` にし、`error: string | null` の次に足す:
```ts
  /** 起動中(resume は依頼した ID、new は結果が届いてから)・実行中のセッションの claude の会話の ID。終了・起動の失敗・取り消しで
   *  null に戻す(送信の時点の送り先の控えと、同じ ID が動いているかの判定に使う。終了した後の ID はどこにも使わない) */
  claudeSessionId: string | null
```
- `INITIAL_AGENT_TAB_SESSION_FIELDS` に `claudeSessionId: null` を足す。
- `isAnyAgentSessionStarting` の次に足す:
```ts
/** claudeSessionId のセッションが起動中・実行中のタブ(前回の続きから・このセッションで再開 の押せない理由)。無ければ undefined */
export function findActiveAgentTabByClaudeSessionId<
  T extends { status: AgentSessionStatus; claudeSessionId: string | null }
>(tabs: readonly T[], claudeSessionId: string): T | undefined {
  return tabs.find(
    (tab) => tab.claudeSessionId === claudeSessionId && isActiveAgentSessionStatus(tab.status)
  )
}
```

`src/renderer/src/lib/agentSessionMessages.ts`:
- `AGENT_ADD_TAB_DISABLED_LIMIT` の次に足す:
```ts
/** 再開の ID が main の起動の記録に無い(main が unknown-session で拒んだ) */
export const AGENT_UNKNOWN_SESSION = 'このセッションは再開できません（アプリの起動の記録にありません）'
/** 同じ ID の claude がほかのタブかウィンドウで動いている(main が session-in-use で拒んだ) */
export const AGENT_SESSION_IN_USE = 'このセッションはほかのタブかウィンドウで動いています'
```
- `describeAgentStartError` の `case 'too-many-sessions':` の次に足す:
```ts
    case 'unknown-session':
      return AGENT_UNKNOWN_SESSION
    case 'session-in-use':
      return AGENT_SESSION_IN_USE
```

`src/renderer/src/hooks/useAgentSessions.ts`:
- import を直す: `import type { AgentLaunchRequest, AgentSessionExit } from '@shared/types'`。
- `AgentSessionTabView` の `error: string | null` の次に足す:
```ts
  /** 起動中・実行中のセッションの claude の会話の ID(AgentTabSessionFields.claudeSessionId)。それ以外は null */
  claudeSessionId: string | null
```
- `AgentSessionsState` の `start` を次にし、`addTab` の次に `resumeInNewTab` を足す:
```ts
  /** 起動する。launch は新しく起動するか、記録した claude のセッションを再開するか(省略できない)。ほかのタブで同じ ID が
   *  起動中・実行中の resume は何もしない(拒否の正は main) */
  start: (slotId: string, launch: AgentLaunchRequest) => Promise<void>
```
```ts
  /** 新しいタブを足して選択し、そのタブで claudeSessionId を再開する(+ と同じ検査の後。同じ ID のタブが起動中・実行中なら
   *  何もしない)。足したタブの slotId、足さなかったら null。起動の完了は待たない(失敗は足したタブのエラーとして出す) */
  resumeInNewTab: (claudeSessionId: string) => string | null
```
- `const sessionIdBySlotRef = …` の次に足す:
```ts
  // 起動中・実行中のタブの claude の会話の ID(タブ → ID)。同じ ID の再開を同期で止める判定に使う(描画は states の claudeSessionId)。
  // states の claudeSessionId と同じ値を、setTabClaudeSessionId でまとめて更新する
  const claudeSessionIdBySlotRef = useRef(new Map<string, string>())
```
- `forgetTab` の `startedAtRef.current.delete(slotId)` の次に `claudeSessionIdBySlotRef.current.delete(slotId)` を足す。
- `adoptSession` の次に足す:
```ts
  // タブの claude の会話の ID を、同期の判定用の ref と描画用の状態の両方に置く
  const setTabClaudeSessionId = useCallback(
    (slotId: string, claudeSessionId: string | null): void => {
      if (claudeSessionId === null) claudeSessionIdBySlotRef.current.delete(slotId)
      else claudeSessionIdBySlotRef.current.set(slotId, claudeSessionId)
      patchTab(slotId, { claudeSessionId })
    },
    [patchTab]
  )

  // except 以外のタブで、claudeSessionId のセッションが起動中・実行中か
  const isClaudeSessionIdActiveElsewhere = useCallback(
    (claudeSessionId: string, except: string | null): boolean => {
      for (const [slotId, id] of claudeSessionIdBySlotRef.current) {
        if (id === claudeSessionId && slotId !== except) return true
      }
      return false
    },
    []
  )
```
- `applyExit` の `adoptSession(slotId, null)` の次に `setTabClaudeSessionId(slotId, null)` を足し、依存の配列に `setTabClaudeSessionId` を足す。
- `failStart` の `adoptSession(slotId, null)` の次に `setTabClaudeSessionId(slotId, null)` を足し、依存の配列に足す。
- 合わせ込みの effect の `adoptSession(tab.slotId, entry.sessionId)` の次に `setTabClaudeSessionId(tab.slotId, entry.claudeSessionId)` を足し、依存の配列に足す（`patchTab(tab.slotId, { status: 'running' })` はそのまま）。
- `start` を次にする:
```ts
  const start = useCallback(
    async (slotId: string, launch: AgentLaunchRequest): Promise<void> => {
      // フォルダ無し・起動を受け付けない間(実行方式の切り替えの途中。切り替えた後に見えないセッションが残るため)
      if (folderPath === null || startDisabledReason !== null) return
      if (hasSessionOrStarting(slotId)) return
      // 閉じる途中のタブで起動すると、直後の削除で controller が捨てられ、main に持ち主のいないセッションが残る
      if (closingRef.current.has(slotId)) return
      // ほかのタブで同じ ID が起動中・実行中なら再開しない(入口のボタンは押せないが、処理の側でも同じ条件で守る。L-058)
      if (
        launch.kind === 'resume' &&
        isClaudeSessionIdActiveElsewhere(launch.claudeSessionId, slotId)
      )
        return
      const tab = findTab(slotId)
      if (tab === undefined) return
      const { controller } = tab
      // 起動の依頼より前に「起動中」を記録する(依頼の最中に届いた終了を溜めるため)
      const endStarting = beginStarting(slotId)
      patchTab(slotId, { status: 'starting', error: null, exit: null })
      // resume は依頼した ID を起動中から持つ(同じ ID の二重の起動を renderer でも押せなくする)。new は結果が届いてから
      setTabClaudeSessionId(slotId, launch.kind === 'resume' ? launch.claudeSessionId : null)
      try {
        // 呼び順は controller の約束どおり: prepareForStart → fit → 起動の依頼 → setSession
        controller.prepareForStart()
        const { cols, rows } = controller.fit()
        const result = await agentTerminalApi.startAgentSession({
          slotId,
          folderPath,
          cols,
          rows,
          launch
        })
        if (result.kind === 'error') {
          // 起動の途中の停止(フォルダ・実行方式の切り替え)は利用者の操作の結果なので、エラーとして出さない。
          // too-many-sessions(renderer の数え方とずれたとき)・unknown-session・session-in-use もこのタブのエラーとして出す
          failStart(slotId, isAgentStartCanceled(result) ? null : describeAgentStartError(result))
          return
        }
        // started・already-running(StrictMode の二重の依頼など)はどちらも、そのセッションに合わせる。already-running の ID は
        // 動いているセッションのもので、resume で依頼した ID と違えば結果の値で上書きする
        startedAtRef.current.set(slotId, now())
        adoptSession(slotId, result.sessionId)
        setTabClaudeSessionId(slotId, result.claudeSessionId)
        patchTab(slotId, { status: 'running' })
        const earlyExit = exitsWhileStartingRef.current.get(result.sessionId)
        if (earlyExit !== undefined) applyExit(slotId, earlyExit)
      } catch (err) {
        failStart(slotId, `${AGENT_START_ERROR_PREFIX}${toError(err).message}`)
      } finally {
        endStarting()
      }
    },
    [
      folderPath,
      startDisabledReason,
      hasSessionOrStarting,
      isClaudeSessionIdActiveElsewhere,
      findTab,
      beginStarting,
      patchTab,
      setTabClaudeSessionId,
      failStart,
      adoptSession,
      applyExit,
      now
    ]
  )
```
- `addTab` の `await start(tab.slotId)` を `await start(tab.slotId, { kind: 'new' })` にし、`addTab` の次に足す:
```ts
  const resumeInNewTab = useCallback(
    (claudeSessionId: string): string | null => {
      // + と同じ検査(フォルダ無し・起動を受け付けない間・上限)。押してから条件が変わったら何もしない
      if (addDisabledReason !== null) return null
      if (isClaudeSessionIdActiveElsewhere(claudeSessionId, null)) return null
      const tab = tabs.add()
      if (tab === null) return null
      // start は拒否しない(失敗は足したタブのエラーとして出す)
      void start(tab.slotId, { kind: 'resume', claudeSessionId })
      return tab.slotId
    },
    [addDisabledReason, isClaudeSessionIdActiveElsewhere, tabs, start]
  )
```
- 戻り値の `addTab,` の次に `resumeInNewTab,` を足す。

`src/renderer/src/components/agent/AgentTerminalPanel.tsx` の `起動` の `onClick` を `onClick={() => void sessions.start(session.slotId, { kind: 'new' })}` にする。

- [ ] **Step 5: テストが通ることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/lib/__tests__/agentSessionTabState.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/components/agent`
Expected: PASS

- [ ] **Step 6: 検証**

Run: `npm run typecheck`
Expected: エラーなし（ここから web も通る。残る型のエラーは `launch`・`claudeSessionId` を足し忘れたテストの値なので、足して直す）
Run: `npx vitest run src/renderer`
Expected: PASS
Run: 変更した `.ts`・`.tsx` へ `npx eslint --fix <files>` → `npx eslint --max-warnings 0 <files>`
Expected: エラー・警告なし

---

### Task 6: ターミナルのタブの `前回の続きから`（`agentResumeAvailability`・`useAgentLastSession`・パネル）

**Files:**
- Create: `src/renderer/src/lib/agentResumeAvailability.ts`
- Create: `src/renderer/src/hooks/useAgentLastSession.ts`
- Modify: `src/renderer/src/lib/agentSessionMessages.ts`（`前回の続きから` の文言）
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`（`AgentTerminalPanelState.resumeLast`）
- Modify: `src/renderer/src/components/agent/AgentTerminalPanel.tsx`（ボタンと理由）
- Modify: `src/renderer/src/__tests__/makeAgentWorkspaceState.ts`（`agentTerminal.resumeLast`）
- Test: `src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts`（新規）、`src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts`（新規）、`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`、`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`、`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx`、`src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx`

**Interfaces:**
- Consumes: `getLastAgentSession(folderPath): Promise<AgentLastSession | null>`（Task 4）、`findActiveAgentTabByClaudeSessionId`・`AgentSessionTabView.claudeSessionId`・`AgentSessionsState.start(slotId, launch)`（Task 5）、`useOnChange`・`useLatestRef`（既存）
- Produces:
```ts
// src/renderer/src/lib/agentResumeAvailability.ts
export type AgentLastSessionLookup =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'found'; claudeSessionId: string }
export interface AgentResumeTab {
  label: string
  status: AgentSessionStatus
  claudeSessionId: string | null
}
export function getResumeLastDisabledReason(input: {
  startDisabledReason: string | null
  lastSession: AgentLastSessionLookup
  tabs: readonly AgentResumeTab[]
}): string | null
// src/renderer/src/lib/agentSessionMessages.ts
export const AGENT_RESUME_LAST_LABEL = '前回の続きから'
export const AGENT_RESUME_LAST_ARIA_LABEL = '前回の続きから（このフォルダで最後に起動した claude のセッションを再開）'
export const AGENT_RESUME_LAST_LOADING = '前回のセッションを確かめています'
export const AGENT_RESUME_LAST_NO_RECORD = 'このフォルダで前回起動したセッションの記録がありません'
export function agentResumeLastInUse(label: string): string // `前回のセッションは ${label} で動いています`
// src/renderer/src/hooks/useAgentLastSession.ts
export interface UseAgentLastSessionOptions { folderPath: string | null; enabled: boolean; refreshKey: string }
export function useAgentLastSession(options: UseAgentLastSessionOptions): AgentLastSessionLookup
// src/renderer/src/hooks/useAgentWorkspace.ts
export interface AgentResumeLastState {
  /** 押せない理由(起動の理由を優先)。押せるなら null */
  disabledReason: string | null
  /** 押した時点の理由を求め直し、押せるときだけ slotId のタブで前回の ID を再開する(L-058) */
  onResume: (slotId: string) => void
}
export interface AgentTerminalPanelState { /* 既存 */ resumeLast: AgentResumeLastState }
```

- [ ] **Step 1: 既存のテストの状態の値に `resumeLast` を足す**

`AgentTerminalPanelState` を組み立てている次の 3 か所に `resumeLast: { disabledReason: null, onResume: vi.fn() },` を足す（`activities: new Map(),` の次）:
- `src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx` の `renderPanel` の `state` と、`renderPanel` を通さずに `state={{ sessions, layout: makeLayout(), sendingSlotId: null, activities: new Map() }}` と直書きしている箇所（245〜410 行目付近。`rerender` の中を含む）のすべて。`grep -n "activities: new Map()" src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx` で出る全箇所（計画の時点で 9 か所）に `resumeLast` を足し、足した後に同じ grep の各行の近くに `resumeLast` があることを確かめる
- `src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx` の `renderNoFolder` と `renderTabs` の `state`（`renderNoFolder` は `resumeLast: { disabledReason: AGENT_START_DISABLED_NO_FOLDER, onResume: vi.fn() }` にする。フォルダが無いときは起動の理由がそのまま 前回の続きから の理由になるため）
- `src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx` の `makeAgentTerminal`
- `src/renderer/src/__tests__/makeAgentWorkspaceState.ts` の `agentTerminal` に `resumeLast: { disabledReason: null, onResume: vi.fn() },` を足す。

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` に `useAgentLastSession` のモックを足す（ほかのモックと同じ並び）:
```ts
const mockUseAgentLastSession = vi.hoisted(() =>
  vi.fn<(options: unknown) => AgentLastSessionLookup>(() => ({ kind: 'none' }))
)
vi.mock('../useAgentLastSession', () => ({ useAgentLastSession: mockUseAgentLastSession }))
```
（`import type { AgentLastSessionLookup } from '../../lib/agentResumeAvailability'` を足し、`beforeEach` に `mockUseAgentLastSession.mockReturnValue({ kind: 'none' })` を足す）

- [ ] **Step 2: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts`（新規）:
```ts
import { describe, it, expect } from 'vitest'
import { getResumeLastDisabledReason } from '../agentResumeAvailability'
import type { AgentResumeTab } from '../agentResumeAvailability'

const ID = '11111111-1111-4111-8111-111111111111'
const tab = (overrides: Partial<AgentResumeTab> = {}): AgentResumeTab => ({
  label: 'claude 1',
  status: 'none',
  claudeSessionId: null,
  ...overrides
})

describe('getResumeLastDisabledReason(前回の続きから)', () => {
  it('起動の理由(フォルダ無し・方式の切り替えの途中)を最優先にする', () => {
    expect(
      getResumeLastDisabledReason({
        startDisabledReason: 'フォルダを開いてください',
        lastSession: { kind: 'found', claudeSessionId: ID },
        tabs: [tab()]
      })
    ).toBe('フォルダを開いてください')
  })

  it('取得中・記録が無いの理由', () => {
    expect(
      getResumeLastDisabledReason({ startDisabledReason: null, lastSession: { kind: 'loading' }, tabs: [] })
    ).toBe('前回のセッションを確かめています')
    expect(
      getResumeLastDisabledReason({ startDisabledReason: null, lastSession: { kind: 'none' }, tabs: [] })
    ).toBe('このフォルダで前回起動したセッションの記録がありません')
  })

  it.each(['starting', 'running'] as const)(
    '同じ ID のタブが %s なら、そのタブの名前を出す',
    (status) => {
      expect(
        getResumeLastDisabledReason({
          startDisabledReason: null,
          lastSession: { kind: 'found', claudeSessionId: ID },
          tabs: [tab(), tab({ label: 'claude 2', status, claudeSessionId: ID })]
        })
      ).toBe('前回のセッションは claude 2 で動いています')
    }
  )

  it('記録があり、同じ ID のタブが動いていなければ押せる(null)', () => {
    expect(
      getResumeLastDisabledReason({
        startDisabledReason: null,
        lastSession: { kind: 'found', claudeSessionId: ID },
        tabs: [tab({ status: 'exited', claudeSessionId: null })]
      })
    ).toBeNull()
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts`（新規）:
```ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import type { AgentLastSession } from '@shared/types'

vi.mock('../../lib/agentTerminalApi')

import * as agentTerminalApi from '../../lib/agentTerminalApi'
import { useAgentLastSession } from '../useAgentLastSession'
import type { UseAgentLastSessionOptions } from '../useAgentLastSession'

const mockGetLast = vi.mocked(agentTerminalApi.getLastAgentSession)
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-9222-222222222222'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

let consoleErrorSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  vi.resetAllMocks()
  consoleErrorSpy = null
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
})

const renderLast = (
  initial: UseAgentLastSessionOptions
): ReturnType<typeof renderHook<ReturnType<typeof useAgentLastSession>, UseAgentLastSessionOptions>> =>
  renderHook((props: UseAgentLastSessionOptions) => useAgentLastSession(props), {
    initialProps: initial
  })

describe('useAgentLastSession', () => {
  it('無効(従来の方式)・フォルダ無しは取りに行かず、記録なし', () => {
    expect(renderLast({ folderPath: '/w', enabled: false, refreshKey: '' }).result.current).toEqual({
      kind: 'none'
    })
    expect(renderLast({ folderPath: null, enabled: true, refreshKey: '' }).result.current).toEqual({
      kind: 'none'
    })
    expect(mockGetLast).not.toHaveBeenCalled()
  })

  it('取得中の後、記録の先頭を返す。記録が無ければ none', async () => {
    mockGetLast.mockResolvedValueOnce({ claudeSessionId: A })
    const { result } = renderLast({ folderPath: '/w', enabled: true, refreshKey: '' })
    expect(result.current).toEqual({ kind: 'loading' })
    expect(mockGetLast).toHaveBeenCalledExactlyOnceWith('/w')
    await waitFor(() => expect(result.current).toEqual({ kind: 'found', claudeSessionId: A }))
    mockGetLast.mockResolvedValueOnce(null)
    const other = renderLast({ folderPath: '/x', enabled: true, refreshKey: '' })
    await waitFor(() => expect(other.result.current).toEqual({ kind: 'none' }))
  })

  it('取得の失敗は記録なしとして扱い、ログに残す', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGetLast.mockRejectedValueOnce(new Error('ipc down'))
    const { result } = renderLast({ folderPath: '/w', enabled: true, refreshKey: '' })
    await waitFor(() => expect(result.current).toEqual({ kind: 'none' }))
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('フォルダが変わったら取得中に戻して取り直し、依頼の後にフォルダが変わった結果は捨てる(L-037)', async () => {
    const first = deferred<AgentLastSession | null>()
    const second = deferred<AgentLastSession | null>()
    mockGetLast.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result, rerender } = renderLast({ folderPath: '/w', enabled: true, refreshKey: '' })
    rerender({ folderPath: '/x', enabled: true, refreshKey: '' })
    expect(mockGetLast).toHaveBeenLastCalledWith('/x')
    await act(async () => {
      first.resolve({ claudeSessionId: A })
      await Promise.resolve()
    })
    expect(result.current).toEqual({ kind: 'loading' })
    await act(async () => {
      second.resolve({ claudeSessionId: B })
      await Promise.resolve()
    })
    expect(result.current).toEqual({ kind: 'found', claudeSessionId: B })
  })

  it('ほかのフォルダから戻ったときは、前に取った結果を出さず取り直す', async () => {
    mockGetLast.mockResolvedValueOnce({ claudeSessionId: A })
    const { result, rerender } = renderLast({ folderPath: '/w', enabled: true, refreshKey: '' })
    await waitFor(() => expect(result.current).toEqual({ kind: 'found', claudeSessionId: A }))
    const back = deferred<AgentLastSession | null>()
    mockGetLast.mockReturnValueOnce(new Promise(() => undefined)).mockReturnValueOnce(back.promise)
    rerender({ folderPath: '/x', enabled: true, refreshKey: '' })
    rerender({ folderPath: '/w', enabled: true, refreshKey: '' })
    expect(result.current).toEqual({ kind: 'loading' })
    await act(async () => {
      back.resolve({ claudeSessionId: B })
      await Promise.resolve()
    })
    expect(result.current).toEqual({ kind: 'found', claudeSessionId: B })
  })

  it('取り直しの契機(起動の成功)で取り直し、取り直す間は前の結果を出し続ける。古い依頼の結果は捨てる(L-040)', async () => {
    mockGetLast.mockResolvedValueOnce({ claudeSessionId: A })
    const { result, rerender } = renderLast({ folderPath: '/w', enabled: true, refreshKey: '' })
    await waitFor(() => expect(result.current).toEqual({ kind: 'found', claudeSessionId: A }))
    const older = deferred<AgentLastSession | null>()
    const newer = deferred<AgentLastSession | null>()
    mockGetLast.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    rerender({ folderPath: '/w', enabled: true, refreshKey: A })
    rerender({ folderPath: '/w', enabled: true, refreshKey: `${A},${B}` })
    expect(mockGetLast).toHaveBeenCalledTimes(3)
    expect(result.current).toEqual({ kind: 'found', claudeSessionId: A })
    await act(async () => {
      newer.resolve({ claudeSessionId: B })
      await Promise.resolve()
    })
    expect(result.current).toEqual({ kind: 'found', claudeSessionId: B })
    await act(async () => {
      older.resolve({ claudeSessionId: A })
      await Promise.resolve()
    })
    expect(result.current).toEqual({ kind: 'found', claudeSessionId: B })
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` の `describe('useAgentWorkspace', …)` の中に足す:
```ts
  describe('前回の続きから(agentTerminal.resumeLast)', () => {
    const ID = '11111111-1111-4111-8111-111111111111'

    it('useAgentLastSession に開いているフォルダ・エージェント CLI 方式か・動いているタブの ID を並べた取り直しの契機を渡す', () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({
          tabs: [
            makeAgentSessionTabView({ status: 'running', claudeSessionId: ID }),
            makeAgentSessionTabView({ slotId: 'slot-2', label: 'claude 2', status: 'starting', claudeSessionId: 'x' })
          ]
        })
      )
      renderWorkspace({ folderPath: '/p' })
      expect(mockUseAgentLastSession).toHaveBeenLastCalledWith({
        folderPath: '/p',
        enabled: true,
        refreshKey: ID
      })
    })

    it.each<[string, AgentLastSessionLookup, string | null]>([
      ['取得中', { kind: 'loading' }, '前回のセッションを確かめています'],
      ['記録なし', { kind: 'none' }, 'このフォルダで前回起動したセッションの記録がありません'],
      ['記録あり', { kind: 'found', claudeSessionId: ID }, null]
    ])('%s の理由', (_label, lookup, reason) => {
      setMode('agent-cli')
      mockUseAgentLastSession.mockReturnValue(lookup)
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.agentTerminal.resumeLast.disabledReason).toBe(reason)
    })

    it('起動の理由を優先し、同じ ID のタブが動いていればその名前を出す', () => {
      setMode('agent-cli')
      mockUseAgentLastSession.mockReturnValue({ kind: 'found', claudeSessionId: ID })
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ startDisabledReason: '実行方式を切り替えています' }))
      expect(renderWorkspace({ folderPath: '/p' }).result.current.agentTerminal.resumeLast.disabledReason).toBe(
        '実行方式を切り替えています'
      )
      const tabs = otherTabIs('running').tabs.map((t) =>
        t.slotId === 'slot-2' ? { ...t, claudeSessionId: ID } : t
      )
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ tabs, selected: tabs[0] }))
      expect(renderWorkspace({ folderPath: '/p' }).result.current.agentTerminal.resumeLast.disabledReason).toBe(
        '前回のセッションは claude 2 で動いています'
      )
    })

    it('押せるときは、そのタブで前回の ID を resume で起動する', () => {
      setMode('agent-cli')
      mockUseAgentLastSession.mockReturnValue({ kind: 'found', claudeSessionId: ID })
      const sessions = makeAgentSessionsState()
      mockUseAgentSessions.mockReturnValue(sessions)
      const { result } = renderWorkspace({ folderPath: '/p' })
      act(() => result.current.agentTerminal.resumeLast.onResume('slot-1'))
      expect(sessions.start).toHaveBeenCalledExactlyOnceWith('slot-1', {
        kind: 'resume',
        claudeSessionId: ID
      })
    })

    it('押せない理由があるときは、onResume を呼ばれても起動しない(L-058)', () => {
      setMode('agent-cli')
      mockUseAgentLastSession.mockReturnValue({ kind: 'none' })
      const sessions = makeAgentSessionsState()
      mockUseAgentSessions.mockReturnValue(sessions)
      const { result } = renderWorkspace({ folderPath: '/p' })
      act(() => result.current.agentTerminal.resumeLast.onResume('slot-1'))
      expect(sessions.start).not.toHaveBeenCalled()
    })
  })
```

`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx` に足す:
```ts
describe('AgentTerminalPanel: 前回の続きから', () => {
  const RESUME_LABEL = '前回の続きから（このフォルダで最後に起動した claude のセッションを再開）'

  it('動いていないタブで 起動 の隣に出し、押すと選択中のタブで onResume を呼ぶ', async () => {
    const state = renderPanel({ sessions: makeSessions({ slotId: 'slot-2', status: 'exited' }) })
    const button = screen.getByRole('button', { name: RESUME_LABEL })
    expect(button).toHaveTextContent('前回の続きから')
    await userEvent.click(button)
    expect(state.resumeLast.onResume).toHaveBeenCalledExactlyOnceWith('slot-2')
  })

  it.each(['starting', 'running'] as const)('%s のタブでは出さない', (status) => {
    renderPanel({ sessions: makeSessions({ status }) })
    expect(screen.queryByRole('button', { name: RESUME_LABEL })).toBeNull()
  })

  it('押せない理由を帯の理由の領域に見える文字で 1 か所だけ出し、disabled と aria-describedby で結ぶ(L-057・L-058)', async () => {
    const state = renderPanel({
      resumeLast: {
        disabledReason: 'このフォルダで前回起動したセッションの記録がありません',
        onResume: vi.fn()
      }
    })
    const button = screen.getByRole('button', { name: RESUME_LABEL })
    expect(button).toBeDisabled()
    const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '')
    expect(reason).toHaveTextContent('このフォルダで前回起動したセッションの記録がありません')
    expect(reason).toHaveClass('agent-terminal-panel__reason')
    expect(screen.getAllByText('このフォルダで前回起動したセッションの記録がありません')).toHaveLength(1)
    // 起動は押せる(起動の説明には結ばない)
    expect(screen.getByRole('button', { name: /^起動/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^起動/ })).not.toHaveAttribute('aria-describedby')
    await userEvent.click(button)
    expect(state.resumeLast.onResume).not.toHaveBeenCalled()
  })

  it('起動の理由があるときは、同じ理由の領域を両方のボタンから参照する(理由の文字は 1 か所)', () => {
    renderPanel({
      sessions: makeSessions({}, { startDisabledReason: 'フォルダを開いてください' }),
      resumeLast: { disabledReason: 'フォルダを開いてください', onResume: vi.fn() }
    })
    const start = screen.getByRole('button', { name: /^起動/ })
    const resume = screen.getByRole('button', { name: RESUME_LABEL })
    expect(resume.getAttribute('aria-describedby')).toBe(start.getAttribute('aria-describedby'))
    expect(screen.getAllByText('フォルダを開いてください')).toHaveLength(1)
  })

  it('閉じる途中のタブでは押せない', () => {
    renderPanel({ sessions: makeSessions({ isClosing: true }) })
    expect(screen.getByRole('button', { name: RESUME_LABEL })).toBeDisabled()
  })
})
```

`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx` の「開閉・起動・変更を確認・最大化のボタンは縮まず、折り返さない」の `buttons` に `screen.getByRole('button', { name: /^前回の続きから/ }),` を足し、テスト名を `開閉・起動・前回の続きから・変更を確認・最大化のボタンは縮まず、折り返さない` にする。

- [ ] **Step 3: テストが失敗することを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/components/agent`
Expected: FAIL（モジュール・`resumeLast`・ボタンが無い）

- [ ] **Step 4: 実装する**

`src/renderer/src/lib/agentSessionMessages.ts` の `AGENT_SESSION_IN_USE` の次に足す:
```ts
/** ターミナルのタブの「前回の続きから」(このフォルダで最後に起動が確定した claude のセッションを再開する) */
export const AGENT_RESUME_LAST_LABEL = '前回の続きから'
/** 可視の文言「前回の続きから」で始める(パターン 76) */
export const AGENT_RESUME_LAST_ARIA_LABEL =
  '前回の続きから（このフォルダで最後に起動した claude のセッションを再開）'
export const AGENT_RESUME_LAST_LOADING = '前回のセッションを確かめています'
export const AGENT_RESUME_LAST_NO_RECORD = 'このフォルダで前回起動したセッションの記録がありません'
/** 前回のセッションがほかのタブで起動中・実行中のとき(label はそのタブの名前) */
export function agentResumeLastInUse(label: string): string {
  return `前回のセッションは ${label} で動いています`
}
```

`src/renderer/src/lib/agentResumeAvailability.ts`（新規）:
```ts
import type { AgentSessionStatus } from './agentSessionTabState'
import { findActiveAgentTabByClaudeSessionId } from './agentSessionTabState'
import {
  AGENT_RESUME_LAST_LOADING,
  AGENT_RESUME_LAST_NO_RECORD,
  agentResumeLastInUse
} from './agentSessionMessages'

// claude のセッションの再開の入口(ターミナルのタブの「前回の続きから」・実行の履歴の「このセッションで再開」)の押せない理由
// (設計書「前回の続きから」「このセッションで再開 の押せない理由」)。React に依存しない純粋な関数で、組み立ては useAgentWorkspace。
// 同じ ID のタブの判定は renderer の表示のためで、拒否の正は main(別のウィンドウのセッションは renderer から見えない)

/** 「前回」の取得の結果(useAgentLastSession) */
export type AgentLastSessionLookup =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'found'; claudeSessionId: string }

/** 押せない理由の判定に使うタブの値(AgentSessionTabView の一部) */
export interface AgentResumeTab {
  label: string
  status: AgentSessionStatus
  claudeSessionId: string | null
}

/**
 * 「前回の続きから」の押せない理由。起動の理由(フォルダ無し・方式の切り替えの途中)を優先し、その後に取得中・記録なし・
 * 同じ ID のタブが起動中か実行中。押せるなら null
 */
export function getResumeLastDisabledReason({
  startDisabledReason,
  lastSession,
  tabs
}: {
  startDisabledReason: string | null
  lastSession: AgentLastSessionLookup
  tabs: readonly AgentResumeTab[]
}): string | null {
  if (startDisabledReason !== null) return startDisabledReason
  if (lastSession.kind === 'loading') return AGENT_RESUME_LAST_LOADING
  if (lastSession.kind === 'none') return AGENT_RESUME_LAST_NO_RECORD
  const running = findActiveAgentTabByClaudeSessionId(tabs, lastSession.claudeSessionId)
  return running === undefined ? null : agentResumeLastInUse(running.label)
}
```

`src/renderer/src/hooks/useAgentLastSession.ts`（新規）:
```ts
import { useEffect, useRef, useState } from 'react'
import * as agentTerminalApi from '../lib/agentTerminalApi'
import type { AgentLastSessionLookup } from '../lib/agentResumeAvailability'
import { useOnChange } from './useOnChange'

// このフォルダで最後に起動が確定した claude のセッション(「前回の続きから」の相手)の取得と取り直し(設計書「前回の続きから」)。
// 照合は main(許可のフォルダの記録の先頭)。フォルダが変わったとき・取り直しの契機(タブの起動の成功)が変わったときに取り直し、
// 最新の依頼でない結果・依頼の後にフォルダが変わった結果は捨てる(L-037・L-040)

export interface UseAgentLastSessionOptions {
  folderPath: string | null
  /** エージェント CLI 方式のときだけ取りに行く */
  enabled: boolean
  /** 取り直しの契機。動いているタブの claude の会話の ID を並べたもの(起動に成功すると新しい ID が入って変わる) */
  refreshKey: string
}

const NONE: AgentLastSessionLookup = { kind: 'none' }
const LOADING: AgentLastSessionLookup = { kind: 'loading' }

interface ResolvedLastSession {
  /** 取りに行ったフォルダ */
  folderPath: string
  lookup: AgentLastSessionLookup
}

export function useAgentLastSession({
  folderPath,
  enabled,
  refreshKey
}: UseAgentLastSessionOptions): AgentLastSessionLookup {
  const [resolved, setResolved] = useState<ResolvedLastSession | null>(null)
  // 依頼の連番(最新の依頼でない結果を捨てる)
  const requestIdRef = useRef(0)
  // フォルダ・方式が変わったら、前に取った結果を捨てる(ほかのフォルダから戻ったときに古い結果を出さない)
  const clearResolved = (): void => setResolved(null)
  useOnChange(folderPath, clearResolved)
  useOnChange(enabled, clearResolved)

  useEffect(() => {
    if (!enabled || folderPath === null) return
    const requestId = ++requestIdRef.current
    let cancelled = false
    void agentTerminalApi
      .getLastAgentSession(folderPath)
      .then(
        (last): AgentLastSessionLookup =>
          last === null ? NONE : { kind: 'found', claudeSessionId: last.claudeSessionId }
      )
      .catch((err: unknown): AgentLastSessionLookup => {
        // 取得の失敗は記録なしとして扱う(前回の続きから は押せない)
        console.error('[useAgentLastSession] getLastAgentSession failed:', err)
        return NONE
      })
      .then((lookup) => {
        // 依頼の後にフォルダ・契機が変わった(effect の後始末)・より新しい依頼がある結果は捨てる
        if (cancelled || requestId !== requestIdRef.current) return
        setResolved({ folderPath, lookup })
      })
    return () => {
      cancelled = true
    }
    // refreshKey は取り直しの契機としてだけ使う
  }, [enabled, folderPath, refreshKey])

  if (!enabled || folderPath === null) return NONE
  // 同じフォルダの取り直しの間は前の結果を出し続ける(起動のたびに理由がちらつかないように)。フォルダが変わったら、そのフォルダの
  // 結果が届くまで取得中
  return resolved !== null && resolved.folderPath === folderPath ? resolved.lookup : LOADING
}
```
（`react-hooks/exhaustive-deps` が `refreshKey` を「不要な依存」と警告する場合は、effect の中で `void refreshKey` と参照してから使うのではなく、その行の直前に `// eslint-disable-next-line react-hooks/exhaustive-deps` を置き、理由のコメントを残す）

`src/renderer/src/hooks/useAgentWorkspace.ts`:
- import に足す:
```ts
import type { AgentLaunchRequest } from '@shared/types'
import { useAgentLastSession } from './useAgentLastSession'
import { useLatestRef } from './useLatestRef'
import { getResumeLastDisabledReason } from '../lib/agentResumeAvailability'
```
（`AgentLaunchRequest` は `@shared/types` の既存の `import type` に足す）
- `AgentTerminalPanelState` の前に足し、`AgentTerminalPanelState` の `activities` の次に `resumeLast` を足す:
```ts
/** ターミナルのタブの「前回の続きから」(useAgentWorkspace が組み立て、AgentTerminalPanel へ渡す) */
export interface AgentResumeLastState {
  /** 押せない理由(起動の理由を優先)。押せるなら null */
  disabledReason: string | null
  /** 押した時点の理由を求め直し、押せるときだけ slotId のタブで前回の ID を再開する(L-058) */
  onResume: (slotId: string) => void
}
```
```ts
  /** 「前回の続きから」の押せない理由と操作 */
  resumeLast: AgentResumeLastState
```
- `const isAgentMode = executionMode.mode === 'agent-cli'` の次に足す:
```ts
  // 「前回」(このフォルダで最後に起動が確定したセッション)。動いているタブの ID が変わったら(起動に成功したら)取り直す
  const runningClaudeSessionKey = agentSessions.tabs
    .flatMap((tab) =>
      tab.status === 'running' && tab.claudeSessionId !== null ? [tab.claudeSessionId] : []
    )
    .join(',')
  const lastSession = useAgentLastSession({
    folderPath,
    enabled: isAgentMode,
    refreshKey: runningClaudeSessionKey
  })
  const resumeLastReason = getResumeLastDisabledReason({
    startDisabledReason: agentSessions.startDisabledReason,
    lastSession,
    tabs: agentSessions.tabs
  })
  // 押した時点の理由と「前回」で判断する(描画をまたいで同じ参照の関数にするため ref から読む)
  const resumeLastRef = useLatestRef({ reason: resumeLastReason, lastSession })
  const startAgentSession = agentSessions.start
  const resumeLast = useCallback(
    (slotId: string): void => {
      const { reason, lastSession: current } = resumeLastRef.current
      if (reason !== null || current.kind !== 'found') return
      const launch: AgentLaunchRequest = { kind: 'resume', claudeSessionId: current.claudeSessionId }
      void startAgentSession(slotId, launch)
    },
    [resumeLastRef, startAgentSession]
  )
```
- 戻り値の `agentTerminal` の `activities` の次に足す:
```ts
      resumeLast: { disabledReason: resumeLastReason, onResume: resumeLast }
```

`src/renderer/src/components/agent/AgentTerminalPanel.tsx`:
- import に `import { AGENT_RESUME_LAST_ARIA_LABEL, AGENT_RESUME_LAST_LABEL, describeAgentStatus } from '../../lib/agentSessionMessages'` を足す（既存の `describeAgentStatus` の import をまとめる）。
- `const { sessions, layout, sendingSlotId, activities } = state` を `const { sessions, layout, sendingSlotId, activities, resumeLast } = state` にし、`const startDisabled = …` の次に足す:
```ts
  // 帯の理由は 1 か所(L-057)。起動の理由を優先し、無ければ 前回の続きから の理由を出す。どちらのボタンも同じ領域を参照する
  const visibleReason = startDisabledReason ?? resumeLast.disabledReason
  const resumeDisabled = resumeLast.disabledReason !== null || session.isClosing
```
- `{startDisabledReason !== null && !isActive && ( <span id={reasonId} … > )}` を次にする:
```tsx
          {visibleReason !== null && !isActive && (
            <span id={reasonId} className="agent-terminal-panel__reason" title={visibleReason}>
              {visibleReason}
            </span>
          )}
```
- `起動` のボタンの直後（`)}` の前、`isActive ? (…) : (…)` の `:` 側）を、`起動` と `前回の続きから` の 2 つのボタンの Fragment にする:
```tsx
          ) : (
            <>
              <button
                type="button"
                className="agent-terminal-panel__button"
                aria-label="起動（開いているフォルダで claude を起動）"
                disabled={startDisabled}
                aria-describedby={startDisabledReason !== null ? reasonId : undefined}
                title={startDisabledReason ?? undefined}
                onClick={() => void sessions.start(session.slotId, { kind: 'new' })}
              >
                起動
              </button>
              <button
                type="button"
                className="agent-terminal-panel__button"
                aria-label={AGENT_RESUME_LAST_ARIA_LABEL}
                disabled={resumeDisabled}
                aria-describedby={resumeLast.disabledReason !== null ? reasonId : undefined}
                title={resumeLast.disabledReason ?? undefined}
                onClick={() => resumeLast.onResume(session.slotId)}
              >
                {AGENT_RESUME_LAST_LABEL}
              </button>
            </>
          )}
```

- [ ] **Step 5: テストが通ることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/components/agent src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx`
Expected: PASS

- [ ] **Step 6: 検証**

Run: `npm run typecheck`
Expected: エラーなし
Run: `npx vitest run src/renderer`
Expected: PASS
Run: 変更した `.ts`・`.tsx` へ `npx eslint --fix <files>` → `npx eslint --max-warnings 0 <files>`
Expected: エラー・警告なし（`useAgentLastSession.ts` の effect の本体では setState を直接呼ばない。`react-hooks/set-state-in-effect`）

---

### Task 7: 送信の配線と履歴への記録（`describeSession`・`sentTo`・`onSent(sent)`・`usePromptRunner`）

**Files:**
- Modify: `src/renderer/src/lib/agentPromptSend.ts`（`AgentPromptSendResult`）
- Modify: `src/renderer/src/hooks/useAgentPromptSender.ts`（`AgentSendTarget.describeSession`・`send` の戻り値の `sentTo`）
- Modify: `src/renderer/src/lib/agentSendCallbacks.ts`（`onSent(outcome.sentTo)`）
- Modify: `src/renderer/src/lib/agentPromptRequest.ts`（`AgentSendOptions.onSent` の型・`buildAgentPromptRequest` の引数）
- Modify: `src/renderer/src/hooks/useAgentSendConfirm.ts`（送り先に `describeSession` を写す・型）
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`（`describeSession` の組み立て・選択中のタブの送り先）
- Modify: `src/renderer/src/hooks/usePromptRunner.ts`（送れたときの記録・C11 のコメント）
- Test: `src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`、`src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts`、`src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`、`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`、`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`

**Interfaces:**
- Consumes: `AgentHistoryInfo`・`HistoryEntry.agent`・`'sent'`（Task 1）、`AgentSessionTabView.claudeSessionId`（Task 5）、`useLatestRef`（既存）
- Produces:
```ts
// src/renderer/src/lib/agentPromptSend.ts
export type AgentPromptSendResult =
  | (Extract<AgentSendOutcome, { kind: 'sent' }> & { sentTo: AgentHistoryInfo | null })
  | Extract<AgentSendOutcome, { kind: 'failed' }>
// src/renderer/src/hooks/useAgentPromptSender.ts
export interface AgentSendTarget {
  slotId: string
  controller: AgentTerminalController
  /** 送り先のタブの今の claude の会話の ID・名前・フォルダ。送信の手順を始める時点(beginSending の直前)に呼んで控える */
  describeSession: () => AgentHistoryInfo | null
}
// AgentPromptSenderState.send: (text: string, target: AgentSendTarget) => Promise<AgentPromptSendResult | undefined>
// src/renderer/src/lib/agentSendCallbacks.ts
export function notifyAgentSent(
  outcome: AgentPromptSendResult | undefined,
  onSent: ((sent: AgentHistoryInfo | null) => void) | undefined
): void
// src/renderer/src/lib/agentPromptRequest.ts
export interface AgentSendOptions {
  promptId: string | null
  unsavedPaths: readonly string[]
  /** 送れた(結果が sent)ときだけ、送信の手順を始める時点に控えた送り先(控えられなかったら null)を渡して呼ぶ */
  onSent?: (sent: AgentHistoryInfo | null) => void
}
export function buildAgentPromptRequest(
  content: string,
  promptId: string,
  prepared: PreparedAgentReferences,
  onSent: (sent: AgentHistoryInfo | null) => void
): AgentPromptRequest
// src/renderer/src/hooks/useAgentSendConfirm.ts
// AgentSendSettled.outcome: AgentPromptSendResult | undefined
// UseAgentSendConfirmOptions.send: (text: string, target: AgentSendTarget) => Promise<AgentPromptSendResult | undefined>
// src/renderer/src/hooks/usePromptRunner.ts(履歴に足す値)
// { promptId, promptTitle, promptContent: <送った全文>, fileContent: null, toolId: 'claude', status: 'sent',
//   resultText: null, errorMessage: null, executedAt: Date.now(), agent: <sent> }
```

- [ ] **Step 1: 既存のテストを新しい形に直す**

`src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`:
- 送り先のリテラルに `describeSession` を足す: `perl -pi -e "s/\{ slotId: '(\w)', controller(: [^}]+?)? \}/{ slotId: '\$1', controller\$2, describeSession: noSession }/g" src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`（16 か所）
- import に `import type { AgentHistoryInfo } from '@shared/types'` と `import type { AgentPromptSendResult } from '../../lib/agentPromptSend'` を足し（既存の `AgentSendClock` の import にまとめる）、`const clock …` の前に足す:
```ts
// 送り先の claude のセッションを控えない(送信の手順だけを確かめるテスト用)
const noSession = (): AgentHistoryInfo | null => null
```
- 送れたときの結果の期待（`toEqual({ kind: 'sent', clearedDraft: … })` など）があれば `sentTo: null` を足す（`grep -n "kind: 'sent'" src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts` で探す）。

`src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts`: `perl -pi -e "s/\{ kind: 'sent', clearedDraft: false \}/{ kind: 'sent', clearedDraft: false, sentTo: null }/g" src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts`。最初のテストの期待を `expect(onSent).toHaveBeenCalledExactlyOnceWith(null)` にする。

`src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`:
- import の `import type { AgentSendOutcome } from '../../lib/agentPromptSend'` を `import type { AgentPromptSendResult } from '../../lib/agentPromptSend'` にし、`perl -pi -e 's/\bAgentSendOutcome\b/AgentPromptSendResult/g' src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`。`const SENT` を `{ kind: 'sent', clearedDraft: false, sentTo: null }` にする。
- `tab1`・`tab2` に送り先の控えを足す:
```ts
const tab1 = {
  slotId: 'slot-1',
  label: 'claude 1',
  controller: makeFakeController(),
  describeSession: vi.fn((): AgentHistoryInfo | null => SENT_TO_1)
}
const tab2 = {
  slotId: 'slot-2',
  label: 'claude 2',
  controller: makeFakeController(),
  describeSession: vi.fn((): AgentHistoryInfo | null => null)
}
```
（その前に `import type { AgentHistoryInfo } from '@shared/types'` と、次の定数を置く）
```ts
const SENT_TO_1: AgentHistoryInfo = {
  claudeSessionId: '11111111-1111-4111-8111-111111111111',
  tabLabel: 'claude 1',
  folderPath: '/work'
}
```
- 送り先の期待に `describeSession` を足す: `perl -0pi -e "s/\{ slotId: '(slot-\d)', controller: (tab\d)\.controller \}/{ slotId: '\$1', controller: \$2.controller, describeSession: \$2.describeSession }/g; s/(slotId: 'slot-\d',\n(\s*)controller: (tab\d)\.controller)\n/\$1,\n\$2describeSession: \$3.describeSession\n/g" src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`:
- `perl -pi -e 's/\bAgentSendOutcome\b/AgentPromptSendResult/g' src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`（import は `import type { AgentPromptSendResult } from '../../lib/agentPromptSend'` になる）
- 送れた結果に `sentTo` を足す: `perl -0pi -e "s/kind: 'sent', clearedDraft: false \}/kind: 'sent', clearedDraft: false, sentTo: null }/g; s/(kind: 'sent',\n(\s*)clearedDraft: (?:true|false))\n/\$1,\n\$2sentTo: null\n/g" src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
- sender へ渡す送り先の期待に `describeSession` を足す: `perl -0pi -e "s/(slotId: 'slot-\d',\n(\s*)controller: tab\d\.controller)\n/\$1,\n\$2describeSession: expect.any(Function)\n/g" src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
- 「設定がオフなら、すぐ送って送れた(sent)ときだけ onSent を呼ぶ」の期待を `expect(onSent).toHaveBeenCalledExactlyOnceWith(null)` にする（結果の `sentTo` が null のため）。

`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`:
- 「エージェント CLI 方式では本文だけをエージェントへ送り、従来の実行と履歴の記録をしない」のテスト名を `エージェント CLI 方式では本文だけをエージェントへ送り、従来の実行をしない。送っただけでは履歴に記録しない(送れたときの onSent でだけ記録する)` にし、コメントの `履歴に記録しない(C11)` を `送れたときの onSent で記録する` にする。
- 「…押した時点の参照を本文の末尾に足し、…」のテストの `sendToAgent.mock.calls[0][1].onSent?.()` を `sendToAgent.mock.calls[0][1].onSent?.(SENT_TO)` にし、ファイルの先頭の定数に足す:
```ts
const SENT_TO: AgentHistoryInfo = {
  claudeSessionId: '11111111-1111-4111-8111-111111111111',
  tabLabel: 'claude 2',
  folderPath: '/repo'
}
```
（import に `import type { AgentHistoryInfo } from '@shared/types'` を足す）

- [ ] **Step 2: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts` の末尾に足す:
```ts
describe('useAgentPromptSender: 送り先の控え(sentTo)', () => {
  const SENT_TO: AgentHistoryInfo = {
    claudeSessionId: '11111111-1111-4111-8111-111111111111',
    tabLabel: 'claude 1',
    folderPath: '/work'
  }

  it('送信の手順を始める時点(準備の後・beginSending の直前)に describeSession で控え、sent の結果に載せる(L-037)', async () => {
    const controller = controllerWithEmptyInput()
    const order: string[] = []
    controller.beginSending.mockImplementation(() => void order.push('begin'))
    const describeSession = vi.fn(() => {
      order.push('describe')
      return SENT_TO
    })
    const beforeSend = vi.fn(async () => {
      order.push('before')
    })
    const { result } = renderHook(() =>
      useAgentPromptSender({ onSettled: vi.fn(), beforeSend, clock })
    )
    let outcome: AgentPromptSendResult | undefined = undefined
    await act(async () => {
      outcome = await result.current.send('hello', { slotId: 'a', controller, describeSession })
    })
    expect(order).toEqual(['before', 'describe', 'begin'])
    expect(describeSession).toHaveBeenCalledOnce()
    expect(outcome).toEqual({ kind: 'sent', clearedDraft: false, sentTo: SENT_TO })
  })

  it('送れなかったときは結果に sentTo を載せない', async () => {
    const controller = makeFakeController()
    const { result } = renderHook(() => useAgentPromptSender({ onSettled: vi.fn(), clock }))
    let outcome: AgentPromptSendResult | undefined = undefined
    await act(async () => {
      outcome = await result.current.send('hello', {
        slotId: 'a',
        controller,
        describeSession: () => SENT_TO
      })
    })
    expect(outcome).toEqual({ kind: 'failed', reason: 'input-not-found' })
  })

  it('describeSession が投げても送り、sentTo は null にしてログに残す', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const controller = controllerWithEmptyInput()
      const { result } = renderHook(() => useAgentPromptSender({ onSettled: vi.fn(), clock }))
      let outcome: AgentPromptSendResult | undefined = undefined
      await act(async () => {
        outcome = await result.current.send('hello', {
          slotId: 'a',
          controller,
          describeSession: () => {
            throw new Error('broken')
          }
        })
      })
      expect(outcome).toEqual({ kind: 'sent', clearedDraft: false, sentTo: null })
      expect(consoleErrorSpy).toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})
```

`src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts` に足す:
```ts
  it('送れたときは、結果の sentTo(控えた送り先)を onSent に渡す', () => {
    const onSent = vi.fn()
    const sentTo = {
      claudeSessionId: '11111111-1111-4111-8111-111111111111',
      tabLabel: 'claude 1',
      folderPath: '/work'
    }
    notifyAgentSent({ kind: 'sent', clearedDraft: false, sentTo }, onSent)
    expect(onSent).toHaveBeenCalledExactlyOnceWith(sentTo)
  })
```

`src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts` に足す:
```ts
describe('useAgentSendConfirm: 送り先の控え(describeSession)', () => {
  it('request の時点の選択中のタブの describeSession を送り先に写し、確認から送るときもその関数のまま送る(写し忘れると確認を経由した送信だけ記録が抜ける)', async () => {
    const send = vi.fn<UseAgentSendConfirmOptions['send']>(async () => ({
      kind: 'sent',
      clearedDraft: false,
      sentTo: SENT_TO_1
    }))
    const onSent = vi.fn()
    const { result, rerender, onSendSettled } = renderConfirm({ send })
    act(() => result.current.request('hello', { ...opts('p1'), onSent }))
    expect(result.current.pending?.target.describeSession).toBe(tab1.describeSession)
    rerender({ selected: tab2, send, onSendSettled })
    act(() => result.current.confirm())
    await waitFor(() => expect(onSendSettled).toHaveBeenCalledOnce())
    expect(send.mock.calls[0][1].describeSession).toBe(tab1.describeSession)
    expect(onSent).toHaveBeenCalledExactlyOnceWith(SENT_TO_1)
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` の `describe('useAgentWorkspace', …)` の中に足す:
```ts
  describe('送り先の控え(describeSession)', () => {
    const ID = '11111111-1111-4111-8111-111111111111'

    it('送り先の describeSession は、呼んだ時点のタブの claude の会話の ID・名前・開いているフォルダを返す', async () => {
      setMode('agent-cli')
      setSendConfirmEnabled(false)
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      const tab = makeAgentSessionTabView({ status: 'running', claudeSessionId: ID })
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ tabs: [tab], selected: tab }))
      const { result, rerender } = renderWorkspace({ folderPath: '/p' })
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
      })
      const describeSession = sender.send.mock.calls[0][1].describeSession
      expect(describeSession()).toEqual({ claudeSessionId: ID, tabLabel: 'claude 1', folderPath: '/p' })
      // タブが起動し直した後に呼ぶと、その時点の ID を返す(控えるのは sender が送信の手順を始める時点)
      const restarted = { ...tab, claudeSessionId: '22222222-2222-4222-9222-222222222222' }
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ tabs: [restarted], selected: restarted })
      )
      rerender()
      expect(describeSession()?.claudeSessionId).toBe('22222222-2222-4222-9222-222222222222')
    })

    it('タブに claude の会話の ID が無い・タブが閉じられたら null', async () => {
      setMode('agent-cli')
      setSendConfirmEnabled(false)
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      const tab = makeAgentSessionTabView({ status: 'running', claudeSessionId: null })
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ tabs: [tab], selected: tab }))
      const { result, rerender } = renderWorkspace({ folderPath: '/p' })
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
      })
      const describeSession = sender.send.mock.calls[0][1].describeSession
      expect(describeSession()).toBeNull()
      const other = makeAgentSessionTabView({ slotId: 'slot-9', status: 'running', claudeSessionId: ID })
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ tabs: [other], selected: other }))
      rerender()
      expect(describeSession()).toBeNull()
    })

    it('確認を経由した送信でも、送り先に describeSession を付ける', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      const tab = makeAgentSessionTabView({ status: 'running', claudeSessionId: ID })
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ tabs: [tab], selected: tab }))
      const { result } = renderWorkspace({ folderPath: '/p' })
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
      })
      act(() => result.current.agentSendConfirmDialog.onConfirm())
      await waitFor(() => expect(sender.send).toHaveBeenCalledOnce())
      expect(sender.send.mock.calls[0][1].describeSession()).toEqual({
        claudeSessionId: ID,
        tabLabel: 'claude 1',
        folderPath: '/p'
      })
    })
  })
```

`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts` の末尾に足す:
```ts
describe('usePromptRunner: 送れたときの履歴への記録', () => {
  type AddHistoryEntry = (entry: Omit<HistoryEntry, 'id'>) => void
  // runPrompt で送り、sendToAgent に渡した onSent を返す
  const runAndTakeOnSent = async ({
    addHistoryEntry = vi.fn<AddHistoryEntry>(),
    agentReferences = makeAgentReferencesState({
      prepare: vi.fn(() => ({
        references: [{ path: 'src/app.ts', lineRange: null }],
        unsavedPaths: [],
        addedPaths: []
      }))
    })
  }: {
    addHistoryEntry?: Mock<AddHistoryEntry>
    agentReferences?: AgentReferencesState
  } = {}): Promise<{
    onSent: NonNullable<AgentSendOptions['onSent']>
    addHistoryEntry: Mock<AddHistoryEntry>
    agentReferences: AgentReferencesState
  }> => {
    const sendToAgent = vi.fn<(text: string, options: AgentSendOptions) => Promise<unknown>>(
      async () => undefined
    )
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        executePrompt: vi.fn(),
        addHistoryEntry,
        executionMode: 'agent-cli',
        sendToAgent,
        agentReferences
      })
    )
    await result.current.runPrompt('送る本文', 'claude', prompt)
    const onSent = sendToAgent.mock.calls[0][1].onSent
    if (onSent === undefined) throw new Error('onSent がありません')
    return { onSent, addHistoryEntry, agentReferences }
  }

  let consoleErrorSpy: MockInstance<typeof console.error> | null = null
  afterEach(() => {
    consoleErrorSpy?.mockRestore()
    consoleErrorSpy = null
  })

  it('送れたら(onSent)、送った全文(参照を含む)と控えた送り先を status: sent で記録する', async () => {
    const { onSent, addHistoryEntry } = await runAndTakeOnSent()
    expect(addHistoryEntry).not.toHaveBeenCalled()
    onSent(SENT_TO)
    expect(addHistoryEntry).toHaveBeenCalledExactlyOnceWith({
      promptId: 'p1',
      promptTitle: 'プロンプトタイトル',
      promptContent: '送る本文\n\n参照:\n- @src/app.ts',
      fileContent: null,
      toolId: 'claude',
      status: 'sent',
      resultText: null,
      errorMessage: null,
      executedAt: expect.any(Number),
      agent: SENT_TO
    })
  })

  it('送り先を控えられなかった(null)ときは、参照の後始末だけ行い、記録を省いてログに残す', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { onSent, addHistoryEntry, agentReferences } = await runAndTakeOnSent()
    onSent(null)
    expect(agentReferences.markSent).toHaveBeenCalledOnce()
    expect(addHistoryEntry).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('参照の後始末が投げても記録し、記録が投げても参照の後始末は済んでいる(段ごとに別の try。L-053)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const first = await runAndTakeOnSent({
      agentReferences: makeAgentReferencesState({
        markSent: vi.fn(() => {
          throw new Error('markSent broken')
        })
      })
    })
    expect(() => first.onSent(SENT_TO)).not.toThrow()
    expect(first.addHistoryEntry).toHaveBeenCalledOnce()

    const addHistoryEntry = vi.fn<AddHistoryEntry>(() => {
      throw new Error('addHistoryEntry broken')
    })
    const agentReferences = makeAgentReferencesState()
    const second = await runAndTakeOnSent({ addHistoryEntry, agentReferences })
    expect(() => second.onSent(SENT_TO)).not.toThrow()
    expect(agentReferences.markSent).toHaveBeenCalledOnce()
  })
})
```
（`vitest` の import に `afterEach` を、`import type { Mock, MockInstance } from 'vitest'` と `import type { AgentReferencesState } from '../useAgentReferences'` を足す）

- [ ] **Step 3: テストが失敗することを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`
Expected: FAIL（`sentTo`・`describeSession` が無い、`onSent` に送り先が渡らない、履歴に記録しない）

- [ ] **Step 4: 実装する**

`src/renderer/src/lib/agentPromptSend.ts`: import に `import type { AgentHistoryInfo } from '@shared/types'` を足し、`AgentSendOutcome` の次に足す:
```ts
/**
 * 送信の手順を含めた送信(useAgentPromptSender.send)の結果。送れたときは、送信の手順を始める時点に控えた送り先(履歴の
 * HistoryEntry.agent と同じ形。控えられなかったら null)を足す。純粋な sendAgentPrompt の AgentSendOutcome は変えない
 */
export type AgentPromptSendResult =
  | (Extract<AgentSendOutcome, { kind: 'sent' }> & { sentTo: AgentHistoryInfo | null })
  | Extract<AgentSendOutcome, { kind: 'failed' }>
```

`src/renderer/src/hooks/useAgentPromptSender.ts`:
- import を直す: `import type { AgentHistoryInfo } from '@shared/types'` を足し、`import type { AgentSendClock, AgentSendOutcome } from '../lib/agentPromptSend'` を `import type { AgentPromptSendResult, AgentSendClock } from '../lib/agentPromptSend'` にする。
- `AgentPromptSenderState.send` の型を `send: (text: string, target: AgentSendTarget) => Promise<AgentPromptSendResult | undefined>` にし、コメントに `送れたときは、送信の手順を始める時点に控えた送り先(sentTo)を結果に載せる` を足す。
- `AgentSendTarget` に足す:
```ts
  /**
   * 送り先のタブの今の claude の会話の ID・名前・フォルダ(履歴の HistoryEntry.agent と同じ形)。送信の手順を始める時点
   * (beginSending の直前)に呼んで控える(送信の後で読むと、その間にタブが起動し直した・閉じた・フォルダが変わったときに、
   * 届いた先と違う ID を記録するため。L-037)
   */
  describeSession: () => AgentHistoryInfo | null
```
- `send` の型注釈の `Promise<AgentSendOutcome | undefined>` を `Promise<AgentPromptSendResult | undefined>` にし、`// 送信の手順の間は利用者のキー入力を溜める…` の直前に足す:
```ts
      // 送り先は送信の手順を始める時点で控える(準備〈変更の記録〉の後。L-037)。控えられなくても送る(記録だけが抜ける)
      let sentTo: AgentHistoryInfo | null = null
      try {
        sentTo = target.describeSession()
      } catch (err) {
        console.error('[useAgentPromptSender] describeSession failed:', err)
      }
```
- `onSettled()` と `return outcome` を次にする（try の中の成功の分岐）:
```ts
        onSettled()
        return outcome.kind === 'sent' ? { ...outcome, sentTo } : outcome
```

`src/renderer/src/lib/agentSendCallbacks.ts` を次にする:
```ts
import type { AgentHistoryInfo } from '@shared/types'
import type { AgentPromptSendResult } from './agentPromptSend'

// 送れた(sent)ときの知らせ(AgentSendOptions.onSent)を呼ぶ。確認から送ったとき(useAgentSendConfirm)とすぐ送ったとき
// (useAgentWorkspace)で共有する。知らせには送信の手順を始める時点に控えた送り先(sentTo。null を含む)を渡す。
// 知らせが投げても、呼び出し元の後続(フォーカスの移動・結果の返却)は止めない(L-053)
export function notifyAgentSent(
  outcome: AgentPromptSendResult | undefined,
  onSent: ((sent: AgentHistoryInfo | null) => void) | undefined
): void {
  if (outcome?.kind !== 'sent' || onSent === undefined) return
  try {
    onSent(outcome.sentTo)
  } catch (err) {
    console.error('[notifyAgentSent] onSent failed:', err)
  }
}
```

`src/renderer/src/lib/agentPromptRequest.ts`:
- import に `import type { AgentHistoryInfo } from '@shared/types'` を足す。
- `AgentSendOptions.onSent` を次にする:
```ts
  /** 送れた(結果が sent)ときだけ、送信の手順を始める時点に控えた送り先(控えられなかったら null)を渡して呼ぶ。確認のキャンセル・
   *  閉じた(フォルダの切り替えなど)・送信の失敗では呼ばない */
  onSent?: (sent: AgentHistoryInfo | null) => void
```
- `buildAgentPromptRequest` の引数 `onSent: () => void` を `onSent: (sent: AgentHistoryInfo | null) => void` にする。

`src/renderer/src/hooks/useAgentSendConfirm.ts`:
- import の `import type { AgentSendOutcome } from '../lib/agentPromptSend'` を `import type { AgentPromptSendResult } from '../lib/agentPromptSend'` にし、ファイルの中の `AgentSendOutcome` を `AgentPromptSendResult` にする（`AgentSendSettled.outcome`・`UseAgentSendConfirmOptions.send`・`confirm` の `let outcome`）。
- `request` の中を次にする:
```ts
      const { slotId, controller, describeSession, label } = selectedRef.current
      // 送り先は開いた時点のタブ。送り先の控え(describeSession)も写す(写し忘れると確認を経由した送信だけ履歴の記録が抜ける)
      const next: PendingAgentSend = {
        ...options,
        text,
        target: { slotId, controller, describeSession },
        label
      }
```

`src/renderer/src/hooks/useAgentWorkspace.ts`:
- import に足す: `useMemo`（`react`）、`AgentHistoryInfo`（`@shared/types` の型）。`useLatestRef` は Task 6 で足してある。
- `const sendConfirm = useAgentSendConfirm({ selected: agentSessions.selected, … })` の前に足し、`selected` を `selectedTarget` にする:
```ts
  // 送り先の claude のセッションを控える関数(設計書「履歴への記録」)。slotId のタブの今の状態と開いているフォルダを ref から引き、
  // sender が送信の手順を始める時点(beginSending の直前)に呼ぶ(L-037)。タブの状態(useAgentSessions)は送信の手段を知らないままにする
  const describeSourceRef = useLatestRef({ tabs: agentSessions.tabs, folderPath })
  const describeSessionOf = useCallback(
    (slotId: string) => (): AgentHistoryInfo | null => {
      const { tabs, folderPath: currentFolder } = describeSourceRef.current
      const tab = tabs.find((t) => t.slotId === slotId)
      if (tab === undefined || tab.claudeSessionId === null || currentFolder === null) return null
      return { claudeSessionId: tab.claudeSessionId, tabLabel: tab.label, folderPath: currentFolder }
    },
    [describeSourceRef]
  )
  // 選択中のタブを送り先にするところ(すぐ送るときの target と、確認へ渡す selected)。選択中のタブが変わらなければ同じ参照
  const {
    slotId: selectedSlotId,
    controller: selectedController,
    label: selectedLabel
  } = agentSessions.selected
  const selectedTarget = useMemo(
    () => ({
      slotId: selectedSlotId,
      controller: selectedController,
      label: selectedLabel,
      describeSession: describeSessionOf(selectedSlotId)
    }),
    [selectedSlotId, selectedController, selectedLabel, describeSessionOf]
  )
```
```ts
  const sendConfirm = useAgentSendConfirm({
    selected: selectedTarget,
    send: agentSender.send,
    onSendSettled: handleSendSettled
  })
```
- 既存の `const { slotId: selectedSlotId, controller: selectedController } = agentSessions.selected` の行を消し（上へ移したため）、`sendToAgent` の中の送り先を次にし、依存の配列の `selectedController` の次に `selectedTarget` を足す:
```ts
      const outcome = await sendAgentPrompt(text, {
        slotId: selectedTarget.slotId,
        controller: selectedTarget.controller,
        describeSession: selectedTarget.describeSession
      })
```
（`selectedSlotId`・`selectedController` を依存の配列から外し、`selectedTarget` だけにする）

`src/renderer/src/hooks/usePromptRunner.ts`:
- import に足す: `import type { AgentHistoryInfo } from '@shared/types'`。
- `Deps.addHistoryEntry` のコメントとして `/** 履歴に足す(従来の方式は実行の結果、エージェント CLI 方式は送れたとき) */` を付ける。
- `run` の次に足す:
```ts
  // エージェント CLI 方式で送れたときの記録(結果の文章は記録しない)。送り先(sent)は送信の手順を始める時点に控えた値。
  // 控えられなかった(null。ありえない想定)ときは記録を省いてログに残す。記録が投げても呼び出し元(参照の後始末)を止めない
  const recordAgentSent = useCallback(
    (context: ExecutionContext, text: string, sent: AgentHistoryInfo | null): void => {
      if (sent === null) {
        console.error('[usePromptRunner] 送り先のセッションが分からないため、履歴に記録しません')
        return
      }
      try {
        addHistoryEntry({
          ...context,
          promptContent: text,
          fileContent: null,
          toolId: 'claude',
          status: 'sent',
          resultText: null,
          errorMessage: null,
          executedAt: Date.now(),
          agent: sent
        })
      } catch (err) {
        console.error('[usePromptRunner] addHistoryEntry failed:', err)
      }
    },
    [addHistoryEntry]
  )
```
- `runPrompt` の上のコメントを `// エージェント CLI 方式は起動中のセッションへ送り、送れたときに記録する(結果の文章は記録しない)。従来の方式は従来どおり` にし、エージェント CLI 方式の分岐を次にする:
```ts
      if (executionMode === 'agent-cli') {
        // 変数を差し込んだ後の本文の末尾へ、押した時点の参照を足す(送信前の確認には足した後の全文が出る)。エクスプローラから
        // 足したファイルは、送れたときだけ、この写しの分を外す(確認のキャンセル・送信の失敗では外さない。L-407)
        const prepared = prepareAgentReferences()
        const context: ExecutionContext = { promptId: prompt.id, promptTitle: prompt.title }
        const request = buildAgentPromptRequest(content, prompt.id, prepared, (sent) => {
          // 参照の後始末と履歴の記録は段ごとに別の try で包み、片方が投げてももう片方を止めない(L-053)
          try {
            markAgentReferencesSent(prepared)
          } catch (err) {
            console.error('[usePromptRunner] markSent failed:', err)
          }
          recordAgentSent(context, request.text, sent)
        })
        await sendToAgent(request.text, request.options)
        return
      }
```
- `runPrompt` の依存の配列に `recordAgentSent` を足す。

- [ ] **Step 5: テストが通ることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts src/renderer/src/lib/__tests__/agentPromptRequest.test.ts src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`
Expected: PASS

- [ ] **Step 6: 検証**

Run: `npm run typecheck`
Expected: エラーなし
Run: `npx vitest run src/renderer`
Expected: PASS
Run: 変更した `.ts` へ `npx eslint --fix <files>` → `npx eslint --max-warnings 0 <files>`
Expected: エラー・警告なし

---

### Task 8: 履歴のエントリごとの押せる条件と処理（`getHistoryActions`・`onResume`・エージェントのエントリの `再実行`）

**Files:**
- Modify: `src/renderer/src/types.ts`（`HistoryActionAvailability`・`HistoryEntryActions`）
- Modify: `src/renderer/src/lib/agentSendMessages.ts`（`RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE`・`getHistoryRerunAvailability`）
- Modify: `src/renderer/src/lib/agentSessionMessages.ts`（`このセッションで再開` の文言）
- Modify: `src/renderer/src/lib/agentResumeAvailability.ts`（`getResumeEntryDisabledReason`）
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`（`AgentWorkspaceState.getHistoryActions`・`onResume`）
- Modify: `src/renderer/src/hooks/usePromptRunner.ts`（`rerunHistoryEntry` のエージェントのエントリ・処理の側の守り）
- Modify: `src/renderer/src/hooks/useAppState.ts`（`getHistoryActions`・`onResume` をそのまま返す）
- Modify: `src/renderer/src/__tests__/makeAgentWorkspaceState.ts`
- Test: `src/renderer/src/lib/__tests__/agentSendMessages.test.ts`、`src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts`、`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`、`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`、`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`

**Interfaces:**
- Consumes: `AgentHistoryInfo`・`HistoryEntry.agent`（Task 1）、`AgentSessionsState.resumeInNewTab`・`findActiveAgentTabByClaudeSessionId`（Task 5）、`AgentResumeTab`（Task 6）、`recordAgentSent`（Task 7 の `usePromptRunner` の内部の関数）、`activateAgentTab`（`useAgentWorkspace` の既存の `useAgentTabActivation` の戻り値）、`isSamePath`（`lib/pathUtils.ts`）
- Produces:
```ts
// src/renderer/src/types.ts
export interface HistoryActionAvailability { disabled: boolean; reason: string | null }
export interface HistoryEntryActions {
  rerun: HistoryActionAvailability
  /** このセッションで再開。従来のエントリ(agent が null)は null(ボタンを出さない) */
  resume: HistoryActionAvailability | null
}
// src/renderer/src/lib/agentSendMessages.ts
export const RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE =
  'エージェント CLI 方式で記録した履歴は、エージェント CLI 方式でだけ再実行できます'
export function getHistoryRerunAvailability(params: {
  isAgentEntry: boolean
  mode: PromptExecutionMode | null
  isExecuting: boolean
  isSessionRunning: boolean
  isSessionClosing: boolean
  isSending: boolean
}): PromptRunAvailability
// src/renderer/src/lib/agentSessionMessages.ts
export const AGENT_RESUME_ENTRY_LABEL = 'このセッションで再開'
export const AGENT_RESUME_ENTRY_LEGACY_MODE = 'エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）'
export function agentResumeEntryFolderMismatch(folderPath: string): string // `記録したフォルダ（${folderPath}）を開いているときだけ再開できます`
export function agentResumeEntryInUse(label: string): string // `このセッションは ${label} で動いています`
// src/renderer/src/lib/agentResumeAvailability.ts
export function getResumeEntryDisabledReason(input: {
  mode: PromptExecutionMode | null
  folderPath: string | null
  recorded: AgentHistoryInfo
  startDisabledReason: string | null
  addDisabledReason: string | null
  tabs: readonly AgentResumeTab[]
}): string | null
// src/renderer/src/hooks/useAgentWorkspace.ts(AgentWorkspaceState。useAppState もそのまま返す)
getHistoryActions: (entry: HistoryEntry) => HistoryEntryActions
onResume: (entry: HistoryEntry) => void
```

- [ ] **Step 1: 既存のテストを直す**

`src/renderer/src/__tests__/makeAgentWorkspaceState.ts` の `sendToAgent` の次に足す:
```ts
    getHistoryActions: vi.fn<AgentWorkspaceState['getHistoryActions']>(() => ({
      rerun: { disabled: false, reason: null },
      resume: null
    })),
    onResume: vi.fn<AgentWorkspaceState['onResume']>(),
```

`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts` の「エージェント CLI 方式では履歴の再実行をしない」のテスト名を `エージェント CLI 方式では従来のエントリ(agent が null)を再実行しない(処理の側の守り。L-058)` にする（`historyEntry` は Task 1 で `agent: null`）。

- [ ] **Step 2: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentSendMessages.test.ts` の import に `RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE`・`getHistoryRerunAvailability` を足し、末尾に足す:
```ts
describe('getHistoryRerunAvailability(履歴のエントリごとの 再実行)', () => {
  const base = {
    isExecuting: false,
    isSessionRunning: true,
    isSessionClosing: false,
    isSending: false
  }

  it('従来のエントリは今のまま(エージェント CLI 方式では押せない)', () => {
    expect(getHistoryRerunAvailability({ ...base, isAgentEntry: false, mode: 'agent-cli' })).toEqual({
      disabled: true,
      reason: RERUN_DISABLED_AGENT_MODE
    })
    expect(
      getHistoryRerunAvailability({ ...base, isAgentEntry: false, mode: 'legacy', isExecuting: true })
    ).toEqual({ disabled: true, reason: null })
  })

  it('エージェントのエントリは、従来の方式では押せず、読み込み中は読み込みの理由', () => {
    expect(getHistoryRerunAvailability({ ...base, isAgentEntry: true, mode: 'legacy' })).toEqual({
      disabled: true,
      reason: RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE
    })
    expect(RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE).toBe(
      'エージェント CLI 方式で記録した履歴は、エージェント CLI 方式でだけ再実行できます'
    )
    expect(getHistoryRerunAvailability({ ...base, isAgentEntry: true, mode: null })).toEqual({
      disabled: true,
      reason: RUN_DISABLED_LOADING_MODE
    })
  })

  it('エージェントのエントリは、エージェント CLI 方式では一覧の 実行 と同じ条件(L-048)', () => {
    const agent = { ...base, isAgentEntry: true, mode: 'agent-cli' as const }
    expect(getHistoryRerunAvailability(agent)).toEqual({ disabled: false, reason: null })
    expect(getHistoryRerunAvailability({ ...agent, isSessionRunning: false })).toEqual({
      disabled: true,
      reason: RUN_DISABLED_NO_SESSION
    })
    expect(getHistoryRerunAvailability({ ...agent, isSessionClosing: true })).toEqual({
      disabled: true,
      reason: RUN_DISABLED_CLOSING
    })
    expect(getHistoryRerunAvailability({ ...agent, isSending: true })).toEqual({
      disabled: true,
      reason: RUN_DISABLED_SENDING
    })
  })
})
```

`src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts` の import に `getResumeEntryDisabledReason` を足し、末尾に足す:
```ts
describe('getResumeEntryDisabledReason(このセッションで再開)', () => {
  const recorded = { claudeSessionId: ID, tabLabel: 'claude 1', folderPath: '/work' }
  const ok = {
    mode: 'agent-cli' as const,
    folderPath: '/work',
    recorded,
    startDisabledReason: null,
    addDisabledReason: null,
    tabs: [tab()]
  }

  it('押せるなら null', () => {
    expect(getResumeEntryDisabledReason(ok)).toBeNull()
  })

  it('上から順に最初に当たった理由を 1 つ出す', () => {
    const all = {
      ...ok,
      folderPath: '/other',
      startDisabledReason: '実行方式を切り替えています',
      addDisabledReason: 'タブは 4 つまでです（使わないタブを閉じると追加できます）',
      tabs: [tab({ label: 'claude 2', status: 'running' as const, claudeSessionId: ID })]
    }
    expect(getResumeEntryDisabledReason({ ...all, mode: null })).toBe('設定を読み込んでいます')
    expect(getResumeEntryDisabledReason({ ...all, mode: 'legacy' })).toBe(
      'エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）'
    )
    expect(getResumeEntryDisabledReason(all)).toBe(
      '記録したフォルダ（/work）を開いているときだけ再開できます'
    )
    expect(getResumeEntryDisabledReason({ ...all, folderPath: '/work' })).toBe(
      '実行方式を切り替えています'
    )
    expect(
      getResumeEntryDisabledReason({ ...all, folderPath: '/work', startDisabledReason: null })
    ).toBe('このセッションは claude 2 で動いています')
    expect(
      getResumeEntryDisabledReason({
        ...all,
        folderPath: '/work',
        startDisabledReason: null,
        tabs: [tab()]
      })
    ).toBe('タブは 4 つまでです（使わないタブを閉じると追加できます）')
  })

  it('フォルダを開いていなければ、記録したフォルダの理由', () => {
    expect(getResumeEntryDisabledReason({ ...ok, folderPath: null })).toBe(
      '記録したフォルダ（/work）を開いているときだけ再開できます'
    )
  })

  it('フォルダの比較は isSamePath(末尾の区切り・Windows の大文字小文字を無視する)', () => {
    expect(getResumeEntryDisabledReason({ ...ok, folderPath: '/work/' })).toBeNull()
    expect(
      getResumeEntryDisabledReason({
        ...ok,
        folderPath: 'c:\\work',
        recorded: { ...recorded, folderPath: 'C:\\Work' }
      })
    ).toBeNull()
  })
})
```

`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts` の末尾に足す:
```ts
describe('usePromptRunner: エージェントのエントリの再実行', () => {
  const agentEntry: HistoryEntry = {
    ...historyEntry,
    id: 'h-agent',
    promptContent: '送った全文\n\n参照:\n- @src/app.ts',
    fileContent: null,
    status: 'sent',
    resultText: null,
    agent: SENT_TO
  }

  it('エージェント CLI 方式では今の送り先へ同じ全文を送り(参照は足し直さない)、送れたら新しいエントリとして記録する', async () => {
    const addHistoryEntry = vi.fn()
    const agentReferences = makeAgentReferencesState()
    const sendToAgent = vi.fn<(text: string, options: AgentSendOptions) => Promise<unknown>>(
      async () => undefined
    )
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        executePrompt: vi.fn(),
        addHistoryEntry,
        executionMode: 'agent-cli',
        sendToAgent,
        agentReferences
      })
    )
    await result.current.rerunHistoryEntry(agentEntry)
    expect(agentReferences.prepare).not.toHaveBeenCalled()
    expect(sendToAgent).toHaveBeenCalledExactlyOnceWith('送った全文\n\n参照:\n- @src/app.ts', {
      promptId: 'p2',
      unsavedPaths: [],
      onSent: expect.any(Function)
    })
    expect(addHistoryEntry).not.toHaveBeenCalled()
    const resent = { ...SENT_TO, claudeSessionId: '22222222-2222-4222-9222-222222222222', tabLabel: 'claude 1' }
    sendToAgent.mock.calls[0][1].onSent?.(resent)
    expect(addHistoryEntry).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        promptId: 'p2',
        promptTitle: '履歴タイトル',
        promptContent: '送った全文\n\n参照:\n- @src/app.ts',
        status: 'sent',
        agent: resent
      })
    )
    expect(agentReferences.markSent).not.toHaveBeenCalled()
  })

  it('従来の方式ではエージェントのエントリを再実行しない(処理の側の守り。L-058)', async () => {
    const executePrompt = vi.fn()
    const sendToAgent = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        executePrompt,
        addHistoryEntry: vi.fn(),
        executionMode: 'legacy',
        sendToAgent,
        agentReferences: makeAgentReferencesState()
      })
    )
    await result.current.rerunHistoryEntry(agentEntry)
    expect(executePrompt).not.toHaveBeenCalled()
    expect(sendToAgent).not.toHaveBeenCalled()
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` の `describe('useAgentWorkspace', …)` の中に足す（import に `import type { HistoryEntry } from '../../types'` と、`RERUN_DISABLED_AGENT_MODE`・`RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE`（`../../lib/agentSendMessages`）を足す）:
```ts
  describe('履歴のエントリごとの操作(getHistoryActions・onResume)', () => {
    const ID = '11111111-1111-4111-8111-111111111111'
    const legacyEntry: HistoryEntry = {
      id: 'h1',
      promptId: 'p1',
      promptTitle: '要約',
      promptContent: '本文',
      fileContent: null,
      toolId: 'claude',
      status: 'success',
      resultText: '結果',
      errorMessage: null,
      executedAt: 1000,
      agent: null
    }
    const agentEntry: HistoryEntry = {
      ...legacyEntry,
      id: 'h2',
      status: 'sent',
      resultText: null,
      agent: { claudeSessionId: ID, tabLabel: 'claude 1', folderPath: '/p' }
    }

    it('従来のエントリは、再実行は今のまま・このセッションで再開は出さない(null)', () => {
      setMode('agent-cli')
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.getHistoryActions(legacyEntry)).toEqual({
        rerun: { disabled: true, reason: RERUN_DISABLED_AGENT_MODE },
        resume: null
      })
    })

    it('従来の方式では、エージェントのエントリの再実行・再開とも押せない理由を出す', () => {
      setMode('legacy')
      const { result } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.getHistoryActions(agentEntry)).toEqual({
        rerun: { disabled: true, reason: RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE },
        resume: {
          disabled: true,
          reason: 'エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）'
        }
      })
    })

    it('エージェント CLI 方式では、再実行は選択中のタブの状態で、再開はフォルダ・動いているタブ・タブの上限で決まる', () => {
      setMode('agent-cli')
      const running = makeAgentSessionTabView({ status: 'running', claudeSessionId: ID })
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ tabs: [running], selected: running })
      )
      const { result, rerender } = renderWorkspace({ folderPath: '/p' })
      expect(result.current.getHistoryActions(agentEntry)).toEqual({
        rerun: { disabled: false, reason: null },
        resume: { disabled: true, reason: 'このセッションは claude 1 で動いています' }
      })
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({
          addDisabledReason: 'タブは 4 つまでです（使わないタブを閉じると追加できます）'
        })
      )
      rerender()
      expect(result.current.getHistoryActions(agentEntry).resume).toEqual({
        disabled: true,
        reason: 'タブは 4 つまでです（使わないタブを閉じると追加できます）'
      })
      expect(result.current.getHistoryActions(agentEntry).rerun).toEqual({
        disabled: true,
        reason: RUN_DISABLED_NO_SESSION
      })
    })

    it('記録したフォルダと違うフォルダを開いていれば、再開できない', () => {
      setMode('agent-cli')
      const { result } = renderWorkspace({ folderPath: '/other' })
      expect(result.current.getHistoryActions(agentEntry).resume).toEqual({
        disabled: true,
        reason: '記録したフォルダ（/p）を開いているときだけ再開できます'
      })
    })

    it('onResume は新しいタブで再開し、パネルを開いてそのタブを選ぶ(+ と同じ。L-048)', () => {
      setMode('agent-cli')
      const selectTab = vi.fn<(slotId: string) => void>()
      const sessions = makeAgentSessionsState({
        selectTab,
        resumeInNewTab: vi.fn<AgentSessionsState['resumeInNewTab']>(() => 'slot-2')
      })
      mockUseAgentSessions.mockReturnValue(sessions)
      const { result } = renderWorkspace({ folderPath: '/p' })
      // useAgentTerminalPanel の初期は開いている(isOpen: true)。閉じてから、onResume で開き直すことを確かめる
      expect(result.current.agentTerminal.layout.isOpen).toBe(true)
      act(() => result.current.agentTerminal.layout.toggleOpen())
      expect(result.current.agentTerminal.layout.isOpen).toBe(false)
      act(() => result.current.onResume(agentEntry))
      expect(sessions.resumeInNewTab).toHaveBeenCalledExactlyOnceWith(ID)
      expect(selectTab).toHaveBeenCalledWith('slot-2')
      expect(result.current.agentTerminal.layout.isOpen).toBe(true)
    })

    it('onResume は押せない理由があるとき・従来のエントリでは何もしない(L-058)', () => {
      setMode('agent-cli')
      const sessions = makeAgentSessionsState()
      mockUseAgentSessions.mockReturnValue(sessions)
      const { result } = renderWorkspace({ folderPath: '/other' })
      act(() => result.current.onResume(agentEntry))
      act(() => result.current.onResume(legacyEntry))
      expect(sessions.resumeInNewTab).not.toHaveBeenCalled()
    })
  })
```
（`import type { AgentSessionsState } from '../useAgentSessions'` を足す。`AgentSessionTabView` の import の隣）

`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts` の「…useAgentWorkspace の戻り値のまま公開する」のテスト（`expect(result.current.promptRun).toBe(workspace.promptRun)` のあるもの）に足す:
```ts
      expect(result.current.getHistoryActions).toBe(workspace.getHistoryActions)
      expect(result.current.onResume).toBe(workspace.onResume)
```

- [ ] **Step 3: テストが失敗することを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`
Expected: FAIL（関数・フィールドが無い、エージェントのエントリを再実行しない）

- [ ] **Step 4: 実装する**

`src/renderer/src/types.ts` の `PromptRunPanelState` の次に足す:
```ts
/** 履歴の操作の押せる条件(押せない理由は詳細に見える文字で出し、ボタンの aria-describedby で結ぶ) */
export interface HistoryActionAvailability {
  disabled: boolean
  reason: string | null
}

/** 履歴のエントリごとの操作の押せる条件(useAgentWorkspace の getHistoryActions。Sidebar → HistoryPanel → HistoryDetail) */
export interface HistoryEntryActions {
  rerun: HistoryActionAvailability
  /** このセッションで再開。従来のエントリ(agent が null)は null(ボタンを出さない) */
  resume: HistoryActionAvailability | null
}
```

`src/renderer/src/lib/agentSendMessages.ts`:
- `RERUN_DISABLED_AGENT_MODE` の次に足す:
```ts
/** エージェント CLI 方式で記録した履歴(agent のあるエントリ)を、従来の方式で再実行しようとしたとき */
export const RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE =
  'エージェント CLI 方式で記録した履歴は、エージェント CLI 方式でだけ再実行できます'
```
- 末尾に足す:
```ts
/**
 * 履歴のエントリごとの 再実行 を押せるか(セッションの再開の設計書「エージェントのエントリの 再実行 の押せない理由」)。
 * 従来のエントリは getRerunAvailability のまま。エージェントのエントリは、エージェント CLI 方式では一覧の 実行 と同じ条件
 * (選択中のタブへ送るため。L-048)、従来の方式では押せない
 */
export function getHistoryRerunAvailability(params: {
  isAgentEntry: boolean
  mode: PromptExecutionMode | null
  isExecuting: boolean
  isSessionRunning: boolean
  isSessionClosing: boolean
  isSending: boolean
}): PromptRunAvailability {
  if (!params.isAgentEntry) {
    return getRerunAvailability({ mode: params.mode, isExecuting: params.isExecuting })
  }
  if (params.mode === null) return { disabled: true, reason: RUN_DISABLED_LOADING_MODE }
  if (params.mode === 'legacy') {
    return { disabled: true, reason: RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE }
  }
  return getPromptRunAvailability(params)
}
```

`src/renderer/src/lib/agentSessionMessages.ts` の `agentResumeLastInUse` の次に足す:
```ts
/** 実行の履歴の詳細の「このセッションで再開」(新しいタブを開いて、エントリの claude のセッションを再開する) */
export const AGENT_RESUME_ENTRY_LABEL = 'このセッションで再開'
export const AGENT_RESUME_ENTRY_LEGACY_MODE =
  'エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）'
/** 開いているフォルダが記録したフォルダと違う・フォルダを開いていない */
export function agentResumeEntryFolderMismatch(folderPath: string): string {
  return `記録したフォルダ（${folderPath}）を開いているときだけ再開できます`
}
/** エントリのセッションがほかのタブで起動中・実行中(label はそのタブの名前) */
export function agentResumeEntryInUse(label: string): string {
  return `このセッションは ${label} で動いています`
}
```

`src/renderer/src/lib/agentResumeAvailability.ts`:
- import に足す:
```ts
import type { AgentHistoryInfo, PromptExecutionMode } from '@shared/types'
import { isSamePath } from './pathUtils'
import { RUN_DISABLED_LOADING_MODE } from './agentSendMessages'
```
（`./agentSessionMessages` の import に `AGENT_RESUME_ENTRY_LEGACY_MODE`・`agentResumeEntryFolderMismatch`・`agentResumeEntryInUse` を足す）
- 末尾に足す:
```ts
/**
 * 「このセッションで再開」の押せない理由(上から順に、最初に当たったものを 1 つ)。実行方式の読み込み中 → 従来の方式 →
 * 記録したフォルダを開いていない(isSamePath。Windows は大文字小文字を区別しない) → 起動を受け付けない間 → 同じ ID のタブが
 * 起動中・実行中 → タブが上限(+ と同じ。L-048)。押せるなら null
 */
export function getResumeEntryDisabledReason({
  mode,
  folderPath,
  recorded,
  startDisabledReason,
  addDisabledReason,
  tabs
}: {
  mode: PromptExecutionMode | null
  folderPath: string | null
  recorded: AgentHistoryInfo
  startDisabledReason: string | null
  addDisabledReason: string | null
  tabs: readonly AgentResumeTab[]
}): string | null {
  if (mode === null) return RUN_DISABLED_LOADING_MODE
  if (mode === 'legacy') return AGENT_RESUME_ENTRY_LEGACY_MODE
  if (folderPath === null || !isSamePath(folderPath, recorded.folderPath)) {
    return agentResumeEntryFolderMismatch(recorded.folderPath)
  }
  if (startDisabledReason !== null) return startDisabledReason
  const running = findActiveAgentTabByClaudeSessionId(tabs, recorded.claudeSessionId)
  if (running !== undefined) return agentResumeEntryInUse(running.label)
  return addDisabledReason
}
```

`src/renderer/src/hooks/useAgentWorkspace.ts`:
- import に足す: `HistoryEntry`・`HistoryEntryActions`（`../types` の型）、`getHistoryRerunAvailability`（`../lib/agentSendMessages`）、`getResumeEntryDisabledReason`（`../lib/agentResumeAvailability`）。
- `AgentWorkspaceState` の `sendToAgent` の次に足す:
```ts
  /** 履歴のエントリごとの 再実行・このセッションで再開 の押せる条件と理由(Sidebar → HistoryPanel → HistoryDetail)。エントリによって
   *  押せる条件が変わるため、全体で 1 つの値にしない */
  getHistoryActions: (entry: HistoryEntry) => HistoryEntryActions
  /** 履歴の このセッションで再開。押した時点の理由を求め直し、押せるときだけ新しいタブで再開して、パネルを開き、そのタブの
   *  ターミナルへ移る(+ と同じ。L-048・L-058) */
  onResume: (entry: HistoryEntry) => void
```
- `const promptRun = buildPromptRunPanelState({ … })` の次に足す:
```ts
  // 履歴のエントリの このセッションで再開 の押せない理由(タブ・フォルダ・方式・起動の理由がここに集まっているため、ここで求める)
  const resumeEntryReasonOf = (recorded: AgentHistoryInfo): string | null =>
    getResumeEntryDisabledReason({
      mode: executionMode.mode,
      folderPath,
      recorded,
      startDisabledReason: agentSessions.startDisabledReason,
      addDisabledReason: agentSessions.addDisabledReason,
      tabs: agentSessions.tabs
    })
  const getHistoryActions = (entry: HistoryEntry): HistoryEntryActions => {
    // 再実行の送り先は選択中のタブ(一覧の 実行 と同じ)
    const rerun = getHistoryRerunAvailability({
      isAgentEntry: entry.agent !== null,
      mode: executionMode.mode,
      isExecuting,
      isSessionRunning: agentSessions.selected.status === 'running',
      isSessionClosing: agentSessions.selected.isClosing,
      isSending: agentSender.isSending
    })
    if (entry.agent === null) return { rerun, resume: null }
    const reason = resumeEntryReasonOf(entry.agent)
    return { rerun, resume: { disabled: reason !== null, reason } }
  }
  const onResume = (entry: HistoryEntry): void => {
    if (entry.agent === null) return
    // 押した時点の条件で求め直し、押せないときは何もしない(ボタンは押せないが、処理の側でも同じ条件で守る。L-058)
    if (resumeEntryReasonOf(entry.agent) !== null) return
    const slotId = agentSessions.resumeInNewTab(entry.agent.claudeSessionId)
    // タブを足せなかった(押してから条件が変わった)ら何もしない。起動の失敗は足したタブのエラーとして出る
    if (slotId !== null) activateAgentTab(slotId)
  }
```
- 戻り値の `sendToAgent` の次に `getHistoryActions,`・`onResume` を足す。

`src/renderer/src/hooks/usePromptRunner.ts` の `rerunHistoryEntry` を次にする:
```ts
  // 履歴からの再実行。従来のエントリは「実行時のファイル内容スナップショット」をそのまま再現する（現在開いているファイルではなく
  // entry.fileContent を使う）。エージェントのエントリは、今の選択中のタブへ同じ全文を送り(参照は全文に含まれているので足し直さない)、
  // 送れたら新しいエントリとして記録する。方式とエントリの種類が合わないものは何もしない(ボタンは押せないが、処理の側でも
  // 同じ条件で守る。L-058)
  const rerunHistoryEntry = useCallback(
    async (entry: HistoryEntry): Promise<void> => {
      const context: ExecutionContext = { promptId: entry.promptId, promptTitle: entry.promptTitle }
      if (executionMode === 'agent-cli') {
        if (entry.agent === null) return
        await sendToAgent(entry.promptContent, {
          promptId: entry.promptId,
          unsavedPaths: [],
          onSent: (sent) => recordAgentSent(context, entry.promptContent, sent)
        })
        return
      }
      if (executionMode !== 'legacy') return
      if (entry.agent !== null) return
      await run(entry.promptContent, entry.fileContent, entry.toolId, context)
    },
    [run, executionMode, sendToAgent, recordAgentSent]
  )
```

`src/renderer/src/hooks/useAppState.ts` の戻り値の `agentAnnouncement: agentWorkspace.agentAnnouncement,` の次に足す:
```ts
    getHistoryActions: agentWorkspace.getHistoryActions,
    onResume: agentWorkspace.onResume,
```

- [ ] **Step 5: テストが通ることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/hooks/__tests__/useAppState.test.ts`
Expected: PASS

- [ ] **Step 6: 検証**

Run: `npm run typecheck`
Expected: エラーなし
Run: 変更した `.ts` へ `npx eslint --fix <files>` → `npx eslint --max-warnings 0 <files>`
Expected: エラー・警告なし

---

### Task 9: 履歴の表示と配線（`送信済み`・`エージェント（claude 2）`・詳細のセッション ID と送った全文・2 つのボタンの理由・結合テスト）

**Files:**
- Modify: `src/renderer/src/lib/historyFormatters.ts`（`getHistoryToolLabel`）
- Modify: `src/renderer/src/components/history/HistoryItem.tsx`
- Modify: `src/renderer/src/components/history/HistoryDetail.tsx`
- Modify: `src/renderer/src/components/history/HistoryPanel.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`（`getHistoryActions`・`onResumeHistoryEntry` を必須の props に。補いを消す）
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/types.ts`・`src/renderer/src/lib/promptRunState.ts`（`PromptRunPanelState` から `isRerunDisabled`・`rerunDisabledReason` を消す）
- Modify: `src/renderer/src/__tests__/makeAgentWorkspaceState.ts`（`promptRun` の 2 つを消す）
- Modify: `src/renderer/src/assets/main.css`
- Test: `src/renderer/src/lib/__tests__/historyFormatters.test.ts`、`src/renderer/src/components/history/__tests__/HistoryItem.test.tsx`、`src/renderer/src/components/history/__tests__/HistoryDetail.test.tsx`、`src/renderer/src/components/history/__tests__/HistoryPanel.test.tsx`、`src/renderer/src/components/__tests__/Sidebar.test.tsx`、`src/renderer/src/lib/__tests__/promptRunState.test.ts`、`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`、`src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx`（新規。結合テスト）

**Interfaces:**
- Consumes: `HistoryEntryActions`・`HistoryActionAvailability`（Task 8）、`AgentWorkspaceState.getHistoryActions`・`onResume`（Task 8。`useAppState` から同じ名前で出る）、`AGENT_RESUME_ENTRY_LABEL`（Task 8）、`getStatusLabel('sent')`（Task 1）
- Produces:
```ts
// src/renderer/src/lib/historyFormatters.ts
export function getHistoryToolLabel(entry: Pick<HistoryEntry, 'toolId' | 'agent'>): string // agent があれば `エージェント（${tabLabel}）`
// src/renderer/src/components/history/HistoryDetail.tsx の Props
interface Props {
  entry: HistoryEntry
  actions: HistoryEntryActions
  onRerun: (entry: HistoryEntry) => void
  onResume: (entry: HistoryEntry) => void
  onDelete: (id: string) => void
}
// src/renderer/src/components/history/HistoryPanel.tsx の Props(isRerunDisabled・rerunDisabledReason は消す)
interface Props {
  history: HistoryEntry[]
  onDelete: (id: string) => void
  onClear: () => void
  onRerun: (entry: HistoryEntry) => void
  getHistoryActions: (entry: HistoryEntry) => HistoryEntryActions
  onResume: (entry: HistoryEntry) => void
}
// src/renderer/src/components/Sidebar.tsx の Props に足す(必須)
getHistoryActions: (entry: HistoryEntry) => HistoryEntryActions
onResumeHistoryEntry: (entry: HistoryEntry) => void
// src/renderer/src/types.ts の PromptRunPanelState から isRerunDisabled・rerunDisabledReason を消す
```

- [ ] **Step 1: 既存のテストを新しい props の形に直す**

`src/renderer/src/components/history/__tests__/HistoryDetail.test.tsx`:
- `defaultProps` を次にする:
```ts
const enabledActions: HistoryEntryActions = {
  rerun: { disabled: false, reason: null },
  resume: null
}

const defaultProps = {
  entry: successEntry,
  actions: enabledActions,
  onRerun: vi.fn(),
  onResume: vi.fn(),
  onDelete: vi.fn()
}
```
（import に `import type { HistoryEntryActions } from '../../../types'` を足す）
- `isRerunDisabled のとき再実行ボタンが無効化される` を次にする:
```ts
  it('再実行を押せないとき再実行ボタンが無効化される', () => {
    render(
      <HistoryDetail
        {...defaultProps}
        actions={{ rerun: { disabled: true, reason: null }, resume: null }}
      />
    )
    expect(screen.getByRole('button', { name: '再実行' })).toBeDisabled()
  })
```
- `describe('HistoryDetail: 再実行を押せない理由', …)` の 2 つのテストの `isRerunDisabled`・`rerunDisabledReason="…"` を、それぞれ `actions={{ rerun: { disabled: true, reason: 'エージェント CLI 方式では再実行できません（設定で従来の方式に切り替えると使えます）' }, resume: null }}`・`actions={{ rerun: { disabled: true, reason: null }, resume: null }}` にする。

`src/renderer/src/components/history/__tests__/HistoryPanel.test.tsx` の `handlers` を次にする:
```ts
const handlers = {
  onDelete: vi.fn(),
  onClear: vi.fn(),
  onRerun: vi.fn(),
  onResume: vi.fn(),
  getHistoryActions: vi.fn(
    (): HistoryEntryActions => ({ rerun: { disabled: false, reason: null }, resume: null })
  )
}
```
（import に `HistoryEntryActions` の型を足す）

`src/renderer/src/components/__tests__/Sidebar.test.tsx`:
- `defaultProps` の `onRerunHistoryEntry: vi.fn(),` の次に足す:
```ts
  getHistoryActions: vi.fn(
    (): HistoryEntryActions => ({ rerun: { disabled: false, reason: null }, resume: null })
  ),
  onResumeHistoryEntry: vi.fn(),
```
（import の `../../types` の型に `HistoryEntry`・`HistoryEntryActions` を足す）
- `describe('Sidebar: プロンプトの実行の状態の受け渡し')` の `promptRun` から `isRerunDisabled: true,` と `rerunDisabledReason: …,`（2 行）を消す。

`src/renderer/src/lib/__tests__/promptRunState.test.ts`:
- 再実行の期待の行を消す: `perl -ni -e 'print unless /^\s*(isRerunDisabled|rerunDisabledReason): [^\n]*$/' src/renderer/src/lib/__tests__/promptRunState.test.ts`
- 「無効と理由の不変条件」の `pairs` の `[state.isRerunDisabled, state.rerunDisabledReason]` の行と、使わなくなる定数 `RERUN_AGENT` を消す。テスト名の `実行も再実行も` を `実行を` にする（`perl -pi -e 's/実行も再実行も/実行を/g' …`）。再実行の押せる条件は `agentSendMessages.test.ts` の `getRerunAvailability`・`getHistoryRerunAvailability` で確かめる。

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` の「従来の方式では、実行中(%s)を実行ボタン・再実行の状態に渡す」のテスト名を `従来の方式では、実行中(%s)を実行ボタンの状態に渡す` にし、`expect(result.current.promptRun.isRerunDisabled).toBe(isExecuting)` の行を消す（エントリごとの再実行は Task 8 の `getHistoryActions` のテスト）。

`src/renderer/src/__tests__/makeAgentWorkspaceState.ts` の `promptRun` から `isRerunDisabled: false,`・`rerunDisabledReason: null` を消す（`runAriaLabel: 'プロンプトを実行'` を最後の行にする）。

- [ ] **Step 2: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/historyFormatters.test.ts` の import に `getHistoryToolLabel` を足し、末尾に足す:
```ts
describe('getHistoryToolLabel', () => {
  it('エージェントのエントリはタブ名付きの「エージェント（claude 2）」、従来のエントリはツール名', () => {
    expect(
      getHistoryToolLabel({
        toolId: 'claude',
        agent: {
          claudeSessionId: '11111111-1111-4111-8111-111111111111',
          tabLabel: 'claude 2',
          folderPath: '/w'
        }
      })
    ).toBe('エージェント（claude 2）')
    expect(getHistoryToolLabel({ toolId: 'claude', agent: null })).toBe(getToolLabel('claude'))
  })
})
```

`src/renderer/src/components/history/__tests__/HistoryItem.test.tsx` に足す:
```ts
describe('HistoryItem: エージェントのエントリ', () => {
  const agentEntry: HistoryEntry = {
    ...successEntry,
    id: 'h-agent',
    promptContent: '送った全文',
    status: 'sent',
    resultText: null,
    agent: {
      claudeSessionId: '11111111-1111-4111-8111-111111111111',
      tabLabel: 'claude 2',
      folderPath: '/w'
    }
  }

  it('ツールの欄に エージェント（claude 2）、状態に 送信済み(中立の色の印)、プレビューに送った全文を出す', () => {
    const { container } = render(
      <HistoryItem entry={agentEntry} isSelected={false} onSelect={vi.fn()} />
    )
    expect(screen.getByText('エージェント（claude 2）')).toBeInTheDocument()
    expect(screen.getByText('送信済み')).toBeInTheDocument()
    expect(container.querySelector('.history-item__status--sent')).not.toBeNull()
    expect(screen.getByText('送った全文')).toBeInTheDocument()
  })
})
```

`src/renderer/src/components/history/__tests__/HistoryDetail.test.tsx` に足す:
```ts
describe('HistoryDetail: エージェントのエントリ', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  const agentEntry: HistoryEntry = {
    ...successEntry,
    id: 'h-agent',
    toolId: 'claude',
    promptContent: '送った全文\n\n参照:\n- @src/app.ts',
    status: 'sent',
    resultText: null,
    agent: { claudeSessionId: ID, tabLabel: 'claude 2', folderPath: '/w' }
  }
  const actions = (
    rerun: HistoryEntryActions['rerun'],
    resume: HistoryEntryActions['resume']
  ): HistoryEntryActions => ({ rerun, resume })

  it('メタ情報にタブ名(ツールの欄)とセッション ID を、本文に送った全文を読むだけの領域で出す', () => {
    render(
      <HistoryDetail
        {...defaultProps}
        entry={agentEntry}
        actions={actions({ disabled: false, reason: null }, { disabled: false, reason: null })}
      />
    )
    expect(screen.getByText('エージェント（claude 2）')).toBeInTheDocument()
    expect(screen.getByText(`セッション: ${ID}`)).toBeInTheDocument()
    const sent = screen.getByRole('region', { name: '送った内容' })
    expect(sent.textContent).toBe('送った全文\n\n参照:\n- @src/app.ts')
    expect(sent).toHaveAttribute('tabindex', '0')
  })

  it('このセッションで再開 を押すと onResume にエントリを渡す', async () => {
    const onResume = vi.fn()
    render(
      <HistoryDetail
        {...defaultProps}
        entry={agentEntry}
        onResume={onResume}
        actions={actions({ disabled: false, reason: null }, { disabled: false, reason: null })}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'このセッションで再開' }))
    expect(onResume).toHaveBeenCalledExactlyOnceWith(agentEntry)
  })

  it('2 つのボタンの押せない理由を、別の段落・別の id で見える文字にして結ぶ(L-057)', async () => {
    const onResume = vi.fn()
    render(
      <HistoryDetail
        {...defaultProps}
        entry={agentEntry}
        onResume={onResume}
        actions={actions(
          { disabled: true, reason: 'エージェントが起動していません（ターミナルの「起動」を押してください）' },
          { disabled: true, reason: 'このセッションは claude 2 で動いています' }
        )}
      />
    )
    const rerun = screen.getByRole('button', { name: '再実行' })
    const resume = screen.getByRole('button', { name: 'このセッションで再開' })
    expect(rerun).toBeDisabled()
    expect(resume).toBeDisabled()
    const rerunReason = rerun.getAttribute('aria-describedby')
    const resumeReason = resume.getAttribute('aria-describedby')
    expect(rerunReason).not.toBe(resumeReason)
    expect(document.getElementById(rerunReason ?? '')).toHaveTextContent(
      'エージェントが起動していません'
    )
    expect(document.getElementById(resumeReason ?? '')).toHaveTextContent(
      'このセッションは claude 2 で動いています'
    )
    await userEvent.click(resume)
    expect(onResume).not.toHaveBeenCalled()
  })

  it('従来のエントリ(resume が null)には このセッションで再開 を出さない', () => {
    render(<HistoryDetail {...defaultProps} />)
    expect(screen.queryByRole('button', { name: 'このセッションで再開' })).toBeNull()
    expect(screen.queryByText(/^セッション: /)).toBeNull()
  })
})
```

`src/renderer/src/components/history/__tests__/HistoryPanel.test.tsx` に足す:
```ts
describe('HistoryPanel: エントリごとの操作', () => {
  it('選んだエントリの getHistoryActions の結果で詳細のボタンを出し、このセッションで再開 を onResume へ渡す', async () => {
    const agentEntry: HistoryEntry = {
      ...entry1,
      status: 'sent',
      resultText: null,
      agent: {
        claudeSessionId: '11111111-1111-4111-8111-111111111111',
        tabLabel: 'claude 1',
        folderPath: '/w'
      }
    }
    const getHistoryActions = vi.fn(
      (entry: HistoryEntry): HistoryEntryActions => ({
        rerun: { disabled: false, reason: null },
        resume: entry.agent === null ? null : { disabled: false, reason: null }
      })
    )
    const onResume = vi.fn()
    render(
      <HistoryPanel
        history={[agentEntry]}
        {...handlers}
        getHistoryActions={getHistoryActions}
        onResume={onResume}
      />
    )
    await userEvent.click(screen.getByRole('radio'))
    expect(getHistoryActions).toHaveBeenCalledWith(agentEntry)
    await userEvent.click(screen.getByRole('button', { name: 'このセッションで再開' }))
    expect(onResume).toHaveBeenCalledExactlyOnceWith(agentEntry)
  })
})
```
（`userEvent` の import が無ければ `import userEvent from '@testing-library/user-event'` を足す。`entry1` はこのファイルの既存の値）

`src/renderer/src/components/__tests__/Sidebar.test.tsx` に足す:
```ts
describe('Sidebar: 履歴のエントリごとの操作の受け渡し', () => {
  it('getHistoryActions と onResumeHistoryEntry を履歴のパネルへ渡す(取り違え・渡し忘れを確かめる。L-060)', async () => {
    const entry: HistoryEntry = {
      id: 'h1',
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
        folderPath: '/w'
      }
    }
    const onResumeHistoryEntry = vi.fn()
    const onRerunHistoryEntry = vi.fn()
    render(
      <Sidebar
        {...defaultProps}
        activePanel="history"
        history={[entry]}
        onRerunHistoryEntry={onRerunHistoryEntry}
        onResumeHistoryEntry={onResumeHistoryEntry}
        getHistoryActions={() => ({
          rerun: { disabled: true, reason: '再実行の理由' },
          resume: { disabled: false, reason: null }
        })}
      />
    )
    await userEvent.click(screen.getByRole('radio'))
    expect(screen.getByText('再実行の理由')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'このセッションで再開' }))
    expect(onResumeHistoryEntry).toHaveBeenCalledExactlyOnceWith(entry)
    expect(onRerunHistoryEntry).not.toHaveBeenCalled()
  })
})
```

`src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx`（新規。本物の hook どうしを通す結合テスト。L-060）:
```tsx
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentSessionExit, Prompt } from '@shared/types'
import type { Panel } from '../../types'

// jsdom では xterm を開けない(matchMedia・canvas が無い)ため、文書ごとのタブの置き場の controller を偽物にする
vi.mock('../../lib/xtermFactory', async () => {
  const { makeFakeAgentSessionTabs } = await import('../../__tests__/makeFakeAgentSessionTabs')
  const tabs = makeFakeAgentSessionTabs()
  return { getAgentSessionTabs: () => tabs }
})

import App from '../../App'
import { getAgentSessionTabs } from '../../lib/xtermFactory'
import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'
import { makeLine } from '../../lib/__tests__/fixtures/agentScreens'
import { PROMPT_RUN_ARIA_LABEL_AGENT } from '../../lib/agentSendMessages'
import { activityBarPanels } from '../../config/activityBarPanels'

// App → useAppState(useAgentWorkspace・usePromptRunner・useHistory)→ Sidebar(PromptsPanel・HistoryPanel)を本物のまま通し、
// 「実行 → 確認から送れたら履歴にエージェントのエントリ → 詳細の このセッションで再開 で resume の起動の依頼」を確かめる。
// getHistoryActions・onResume の取り違え・渡し忘れ(L-060)と、確認を経由した送信の記録の抜けをここで落とす

const ID = '11111111-1111-4111-8111-111111111111'
const prompt: Prompt = { id: 'p1', title: '要約', content: '要約して', createdAt: 1000000 }

const panelButton = (panel: Panel): HTMLElement => {
  const config = activityBarPanels.find((p) => p.panel === panel)
  if (config === undefined) throw new Error(`panel config not found: ${panel}`)
  return screen.getByTitle(config.title)
}

// 偽のタブの controller を、空の入力欄の claude の画面にし、貼り付けを書き込むと本文の 1 行目が入力欄に出るようにする
// (App.agentReferences.test.tsx と同じ流儀)。タブの置き場はファイルで共有しているため、afterEach で戻す
let restoreControllerState: (() => void) | null = null
const prepareClaudeScreen = (): FakeController => {
  const { tabs, selectedSlotId } = getAgentSessionTabs().getSnapshot()
  const tab = tabs.find((t) => t.slotId === selectedSlotId)
  if (tab === undefined) throw new Error('selected tab not found')
  const controller = tab.controller as FakeController
  const { writeToSession, viewport, sessionId, writes } = controller
  restoreControllerState = () => {
    controller.writeToSession = writeToSession
    controller.viewport = viewport
    controller.sessionId = sessionId
    controller.writes = writes
  }
  const border = makeLine('─'.repeat(40))
  controller.viewport = [border, makeLine('❯\xa0 ', [], [[2, 3]]), border]
  controller.writes = []
  controller.writeToSession = (data) => {
    controller.writes.push(data)
    if (data.startsWith('\x1b[200~'))
      controller.viewport = [border, makeLine(`❯\xa0${data.slice(6).split('\n')[0]}`), border]
  }
  return controller
}

let emitExit: (exit: AgentSessionExit) => void = () => undefined

describe('App: セッションの再開と履歴の配線', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreControllerState = null
    window.api.getAgentSendConfirmEnabled = vi.fn().mockResolvedValue(true)
    window.api.getPromptExecutionMode = vi.fn().mockResolvedValue('agent-cli')
    window.api.loadPrompts = vi.fn().mockResolvedValue([prompt])
    window.api.loadHistory = vi.fn().mockResolvedValue([])
    window.api.saveHistory = vi.fn().mockResolvedValue(undefined)
    window.api.openFolder = vi.fn().mockResolvedValue('/project')
    window.api.readDirectory = vi
      .fn()
      .mockResolvedValue([{ name: 'a.ts', path: '/project/a.ts', type: 'file' }])
    window.api.onExternalFileChange = vi.fn(() => () => {})
    window.api.getLastAgentSession = vi.fn().mockResolvedValue(null)
    window.api.startAgentSession = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'started', sessionId: 's1', claudeSessionId: ID })
      .mockResolvedValue({ kind: 'started', sessionId: 's2', claudeSessionId: ID })
    window.api.onAgentExit = vi.fn((listener: (exit: AgentSessionExit) => void) => {
      emitExit = listener
      return () => {}
    })
  })

  afterEach(() => {
    restoreControllerState?.()
    restoreControllerState = null
  })

  it('確認から送れたら履歴に 送信済み のエージェントのエントリを足し、詳細の このセッションで再開 で新しいタブから resume を依頼する', async () => {
    render(<App />)
    await screen.findByRole('region', { name: 'エージェント' })
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await screen.findByRole('tree')
    await userEvent.click(
      screen.getByRole('button', { name: '起動（開いているフォルダで claude を起動）' })
    )
    expect(window.api.startAgentSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ launch: { kind: 'new' } })
    )
    // 実行 → 送信前の確認 → 送信(確認を経由した送信でも送り先の ID を控えて記録する)
    await userEvent.click(panelButton('prompts'))
    const runButton = await screen.findByRole('button', { name: PROMPT_RUN_ARIA_LABEL_AGENT })
    await waitFor(() => expect(runButton).toBeEnabled())
    await userEvent.click(runButton)
    const dialog = await screen.findByRole('dialog', { name: '送信前の確認' })
    const controller = prepareClaudeScreen()
    await userEvent.click(within(dialog).getByRole('button', { name: '送信' }))
    await waitFor(() => expect(controller.writes).toContain('\r'))
    await waitFor(() =>
      expect(window.api.saveHistory).toHaveBeenLastCalledWith([
        expect.objectContaining({
          promptTitle: '要約',
          promptContent: '要約して',
          status: 'sent',
          agent: { claudeSessionId: ID, tabLabel: 'claude 1', folderPath: '/project' }
        })
      ])
    )
    // 履歴の一覧と詳細
    await userEvent.click(panelButton('history'))
    const item = screen.getByRole('radio', { name: /要約/ })
    expect(within(item).getByText('送信済み')).toBeInTheDocument()
    expect(within(item).getByText('エージェント（claude 1）')).toBeInTheDocument()
    await userEvent.click(item)
    expect(screen.getByText(`セッション: ${ID}`)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '送った内容' }).textContent).toBe('要約して')
    // 同じ ID が claude 1 で動いている間は押せない(理由を見える文字で結ぶ)
    const resume = screen.getByRole('button', { name: 'このセッションで再開' })
    expect(resume).toBeDisabled()
    expect(document.getElementById(resume.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      'このセッションは claude 1 で動いています'
    )
    // claude 1 が終了したら押せる。押すと新しいタブ(claude 2)を足して、そのタブで resume を依頼する
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' }))
    await waitFor(() => expect(resume).toBeEnabled())
    await userEvent.click(resume)
    await waitFor(() =>
      expect(window.api.startAgentSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ launch: { kind: 'resume', claudeSessionId: ID } })
      )
    )
    expect(await screen.findByRole('tab', { name: /claude 2/, selected: true })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: テストが失敗することを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/historyFormatters.test.ts src/renderer/src/components/history src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx`
Expected: FAIL（`getHistoryToolLabel`・新しい props・表示が無い）

- [ ] **Step 4: 実装する**

`src/renderer/src/lib/historyFormatters.ts`:
- import を `import type { HistoryEntry, HistoryStatus, PromptToolId } from '@shared/types'` にし、`getToolLabel` の次に足す:
```ts
/** 履歴の一覧・詳細のツールの欄。エージェントのエントリは送ったタブの名前を添える(toolId は 'claude' のまま変えないため) */
export function getHistoryToolLabel(entry: Pick<HistoryEntry, 'toolId' | 'agent'>): string {
  return entry.agent !== null ? `エージェント（${entry.agent.tabLabel}）` : getToolLabel(entry.toolId)
}
```

`src/renderer/src/components/history/HistoryItem.tsx`:
- import の `getToolLabel` を `getHistoryToolLabel` にし、本体の最初の 3 行を次にする:
```tsx
  const toolLabel = getHistoryToolLabel(entry)
  const statusLabel = getStatusLabel(entry.status)
  // エージェントのエントリは結果を記録しないため、送った全文の先頭を見せる
  const preview = truncatePreview(
    entry.status === 'sent' ? entry.promptContent : (entry.resultText ?? entry.errorMessage ?? '')
  )
```

`src/renderer/src/components/history/HistoryDetail.tsx` を次にする:
```tsx
'use client'
import { useId } from 'react'
import type { HistoryEntry, HistoryEntryActions } from '../../types'
import MarkdownRenderer from '../output/MarkdownRenderer'
import { getHistoryToolLabel, formatExecutedAt } from '../../lib/historyFormatters'
import { AGENT_RESUME_ENTRY_LABEL } from '../../lib/agentSessionMessages'

interface Props {
  entry: HistoryEntry
  /** 再実行・このセッションで再開 の押せる条件と理由(useAgentWorkspace の getHistoryActions。省略できない。L-060) */
  actions: HistoryEntryActions
  onRerun: (entry: HistoryEntry) => void
  /** このセッションで再開(agent のあるエントリだけ。省略できない。L-060) */
  onResume: (entry: HistoryEntry) => void
  onDelete: (id: string) => void
}

export default function HistoryDetail({
  entry,
  actions,
  onRerun,
  onResume,
  onDelete
}: Props): React.JSX.Element {
  const toolLabel = getHistoryToolLabel(entry)
  // 2 つのボタンの理由は別の段落・別の id にする(L-057)
  const rerunReasonId = useId()
  const resumeReasonId = useId()
  const { rerun, resume } = actions
  const showRerunReason = rerun.disabled && rerun.reason !== null
  const showResumeReason = resume !== null && resume.disabled && resume.reason !== null

  return (
    <div className="history-detail">
      <div className="history-detail__header">
        <h3 className="history-detail__title">{entry.promptTitle}</h3>
        <div className="history-detail__meta">
          <span className="history-detail__tool">{toolLabel}</span>
          <span className="history-detail__time">{formatExecutedAt(entry.executedAt)}</span>
          {entry.agent !== null && (
            // 選んでコピーできる文字として出す(claude --resume で手動で開くときなど)
            <span className="history-detail__session">セッション: {entry.agent.claudeSessionId}</span>
          )}
        </div>
      </div>
      <div className="history-detail__actions">
        <button
          type="button"
          className="history-detail__rerun"
          onClick={() => onRerun(entry)}
          disabled={rerun.disabled}
          aria-describedby={showRerunReason ? rerunReasonId : undefined}
        >
          再実行
        </button>
        {resume !== null && (
          <button
            type="button"
            className="history-detail__resume"
            onClick={() => onResume(entry)}
            disabled={resume.disabled}
            aria-describedby={showResumeReason ? resumeReasonId : undefined}
          >
            {AGENT_RESUME_ENTRY_LABEL}
          </button>
        )}
        <button
          type="button"
          className="history-detail__delete"
          onClick={() => onDelete(entry.id)}
          aria-label="この履歴を削除"
        >
          削除
        </button>
      </div>
      {showRerunReason && (
        <p id={rerunReasonId} className="history-detail__rerun-reason">
          {rerun.reason}
        </p>
      )}
      {showResumeReason && (
        <p id={resumeReasonId} className="history-detail__resume-reason">
          {resume.reason}
        </p>
      )}
      <div className="history-detail__content">
        {entry.status === 'sent' && (
          // 結果の代わりに送った全文を読むだけで出す。長い本文は枠の中でスクロールし、Tab で止まってキーボードでもスクロールできる
          <pre className="history-detail__sent" role="region" aria-label="送った内容" tabIndex={0}>
            {entry.promptContent}
          </pre>
        )}
        {entry.status === 'success' && entry.resultText !== null && (
          <MarkdownRenderer content={entry.resultText} />
        )}
        {entry.status === 'error' && entry.errorMessage !== null && (
          <p className="history-detail__error">{entry.errorMessage}</p>
        )}
      </div>
    </div>
  )
}
```

`src/renderer/src/components/history/HistoryPanel.tsx`:
- import を `import type { HistoryEntry, HistoryEntryActions } from '../../types'` にする。
- `Props` の `isRerunDisabled`・`rerunDisabledReason` を消して足す:
```ts
  /** エントリごとの 再実行・このセッションで再開 の押せる条件(省略できない。L-060) */
  getHistoryActions: (entry: HistoryEntry) => HistoryEntryActions
  /** このセッションで再開(省略できない。L-060) */
  onResume: (entry: HistoryEntry) => void
```
- 引数の分割の `isRerunDisabled = false, rerunDisabledReason = null` を `getHistoryActions, onResume` にし、`HistoryDetail` を次にする:
```tsx
              <HistoryDetail
                entry={selectedEntry}
                actions={getHistoryActions(selectedEntry)}
                onRerun={onRerun}
                onResume={onResume}
                onDelete={handleDelete}
              />
```

`src/renderer/src/components/Sidebar.tsx`:
- import の `../types` の型に `HistoryEntryActions` を足す。
- `Props` の `onRerunHistoryEntry` の次に足す:
```ts
  /** 履歴のエントリごとの 再実行・このセッションで再開 の押せる条件(useAgentWorkspace の getHistoryActions。省略できない。L-060) */
  getHistoryActions: (entry: HistoryEntry) => HistoryEntryActions
  /** 履歴の このセッションで再開(useAgentWorkspace の onResume。省略できない。L-060) */
  onResumeHistoryEntry: (entry: HistoryEntry) => void
```
- `promptRun?: PromptRunPanelState` のコメントを `/** 実行ボタンの押せる条件と送信の結果。省略時は isExecuting で押せなくする(従来どおり) */` にする。
- 引数の分割の `onRerunHistoryEntry,` の次に `getHistoryActions,`・`onResumeHistoryEntry,` を足し、`HistoryPanel` を次にする:
```tsx
        <HistoryPanel
          history={history}
          onDelete={onDeleteHistoryEntry}
          onClear={onClearHistory}
          onRerun={onRerunHistoryEntry}
          getHistoryActions={getHistoryActions}
          onResume={onResumeHistoryEntry}
        />
```

`src/renderer/src/App.tsx`: `useAppState()` の分割に `getHistoryActions,`・`onResume,` を足し（`rerunHistoryEntry,` の次）、`Sidebar` の `onRerunHistoryEntry={rerunHistoryEntry}` の次に足す:
```tsx
              getHistoryActions={getHistoryActions}
              onResumeHistoryEntry={onResume}
```

`src/renderer/src/types.ts` の `PromptRunPanelState` から `isRerunDisabled: boolean` と `rerunDisabledReason: string | null` を消し、上のコメントの `Sidebar → PromptsPanel・HistoryPanel へ渡す` を `Sidebar → PromptsPanel へ渡す。履歴の再実行はエントリごとに HistoryEntryActions` にする。

`src/renderer/src/lib/promptRunState.ts`: import から `getRerunAvailability` を外し、`const rerun = getRerunAvailability(…)` と戻り値の `isRerunDisabled`・`rerunDisabledReason` を消す。冒頭のコメントの `実行ボタン・再実行の押せる条件` を `実行ボタンの押せる条件` にする。

`src/renderer/src/assets/main.css` の `.history-detail__rerun-reason { … }` の次に足す:
```css
.history-detail__resume-reason {
  margin: 4px 0;
  color: #969696;
  font-size: 12px;
}

/* エージェント CLI 方式で送ったエントリの状態。結果を知らないので、成功・エラーと区別する中立の色にする */
.history-item__status--sent {
  color: #969696;
}

/* 選んでコピーできる(claude --resume で手動で開くときなど) */
.history-detail__session {
  font-family: Menlo, Monaco, 'Courier New', monospace;
  user-select: text;
  overflow-wrap: anywhere;
}

/* 送った全文(読むだけ)。長い本文は枠の中でスクロールする */
.history-detail__sent {
  max-height: 40vh;
  overflow: auto;
  margin: 0;
  padding: 8px;
  background: #1e1e1e;
  border: 1px solid #3c3c3c;
  border-radius: 2px;
  color: #d4d4d4;
  font-family: Menlo, Monaco, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.history-detail__sent:focus-visible {
  outline: 1px solid #007acc;
  outline-offset: -1px;
}
```

- [ ] **Step 5: テストが通ることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/historyFormatters.test.ts src/renderer/src/lib/__tests__/promptRunState.test.ts src/renderer/src/components/history src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: PASS

- [ ] **Step 6: 配線の取り違えで結合テストが落ちることを確かめる（L-060）**

`src/renderer/src/components/Sidebar.tsx` の `onResume={onResumeHistoryEntry}` を一時的に `onResume={onRerunHistoryEntry}` にして `npx vitest run src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx` を走らせ、FAIL（resume の起動の依頼が届かない・`onResumeHistoryEntry` が呼ばれない）を確かめてから元に戻す。同じく `src/renderer/src/hooks/useAgentPromptSender.ts` の送り先の控え（`sentTo = target.describeSession()`）を一時的に消して、結合テストが FAIL（履歴に `agent` が記録されない）することを確かめてから戻す。

- [ ] **Step 7: 検証**

Run: `npm run typecheck`
Expected: エラーなし
Run: `npx vitest run src/renderer`
Expected: PASS
Run: 変更した `.ts`・`.tsx` へ `npx eslint --fix <files>` → `npx eslint --max-warnings 0 <files>`
Expected: エラー・警告なし

---

### Task 10: ROADMAP・実機テスト仕様書の更新と全体の検証

**Files:** `ROADMAP.md`、`docs/manual-test-spec.md`、`.superpowers/manual-test-spec.html`（生成。git 管理外）

- [ ] **Step 1: ROADMAP**
  - 「今後実装した方がよい機能（未実装）」→「エージェント実行の支援（MVP の次）」の `- [ ] セッションの再開（`claude --continue` / `--resume`）・履歴へのセッション記録` を消す。
  - 「実装済み機能」の `### エージェントへ送るプロンプトへの参照の添付` の節（既知の制約の箇条書きまで）の後、`---` の前に次の節を足す:
```markdown
### エージェントのセッションの再開と履歴への記録

設計書: `docs/superpowers/specs/2026-10-11-agent-session-resume-design.md`（2026-10-11）。

- [x] エージェント CLI 方式で `claude` を起動するたびに、main がセッションの ID（UUID）を振って `claude --session-id <ID>` で起動し、フォルダごとに起動の記録（`userData/agent-sessions.json`。フォルダごとに新しい順に 200 件・フォルダは 50 まで）に残す
- [x] ターミナルのタブの `起動` の隣に `前回の続きから` を置き、このフォルダで最後に起動したセッションを `claude --resume <ID>` で再開する（記録が無い・取得中・同じセッションがほかのタブで動いている間は、理由を帯に出して押せない）
- [x] エージェント CLI 方式で送れたプロンプトを、実行の履歴に `送信済み`（ツールの欄は `エージェント（claude 2）`）として記録する（送った全文〈参照を含む〉・セッションの ID・タブ名・時刻・フォルダ。結果の文章は記録しない。確認のキャンセル・送信の失敗では記録しない）
- [x] 履歴の詳細にセッションの ID と送った全文を出し、`このセッションで再開`（新しいタブで再開。記録したフォルダを開いているとき・同じセッションが動いていないとき・タブが上限でないときだけ）と、エージェントのエントリの `再実行`（今の選択中のタブへ同じ全文を送る。送信前の確認に従う）を置く
- [x] 再開の ID は main が小文字の UUID v4 の形式と、そのフォルダの起動の記録で照合し（記録に無ければ `このセッションは再開できません（アプリの起動の記録にありません）`）、同じ ID の二重の起動を全ウィンドウで共有する予約で拒む（`このセッションはほかのタブかウィンドウで動いています`）

既知の制約（設計書の「既知の制約」と同じ）:
- `--resume <ID>` で再開しても同じ ID のまま続く前提にしている。`claude` の版によって再開で新しい ID になる場合、履歴と記録には再開の前の ID が残る
- 何も送らずに終えたセッションは、`claude` が会話を保存せず、再開できないことがある
- 起動しただけで閉じると、そのセッションが「前回」になり、続けたかったセッションが「前回」から押し出される（履歴からは再開できる）
- アプリの外（別の端末）で同じセッションを `claude --resume` で開いているのは検知できない
- 履歴のエントリの再開はアプリが振った ID だけ。フォルダごとに 200 件を超えて古くなった ID は、履歴に残っていても再開できない
- 記録したフォルダと今のフォルダの比較は renderer のパスの文字列で行う（シンボリックリンク越しに同じフォルダを開くと、押せない理由が出ることがある。main の照合は実パス）
- 新しい形式の履歴（`status: 'sent'`）を古い版のアプリで読むと、そのエントリは捨てられる
- 履歴のエントリを消しても、main の起動の記録は消えない（記録を消す操作は無い）
```
  - 実機の結果（Step 2 の AGT-196・AGT-197・AGT-209）で設計書の前提と違う挙動が分かったら、ここの既知の制約に追記する（項目を足すのはユーザーの実機確認の後でよい。このタスクでは上の内容だけを書く）。

- [ ] **Step 2: 実機テスト仕様書**
  - 最大の番号を確かめる: `grep -o 'AGT-[0-9]*' docs/manual-test-spec.md | sort -t- -k2 -n | tail -1`（計画の時点では `AGT-193`。違えばその次から振り、下の項目の中の相互参照〈`AGT-195` など〉も合わせて直す）。
  - `grep -n '^## \|^### ' docs/manual-test-spec.md` で、`### 参照を添える` が `## エージェント CLI のアプリ内ターミナル` の領域の最後の `###` であることを確かめる（後ろに別の `###` が増えていれば、その領域の最後の `###` の後に足す）。
  - `### 参照を添える` の最後の項目（`AGT-193`）の後、`## エージェントの変更の確認` の前に、次の節を足す（書式は `- [ ] **<ID>** <手順> → <期待結果>`、1 行 1 項目。上から順に実行でき、各項目の後始末が次の項目の前提を壊さないように並べてある）。
  - 設計書「エラーと境界の扱い」との対応（L-297）:
    - `起動`（新規）・`+`（常に新しい ID・記録の先頭）→ AGT-195・AGT-196・AGT-198
    - `前回の続きから`（記録の先頭で再開・同じ ID が動いていれば押せない）→ AGT-194・AGT-197・AGT-198
    - `このセッションで再開`（動いていれば押せない・記録に無ければ `unknown-session`）→ AGT-199・AGT-207。タブの上限 → AGT-200
    - リロード・フォルダや方式の切り替え・アプリの終了（止める・記録は残る）→ AGT-206・AGT-204・AGT-203・AGT-205
    - 起動の失敗の文言 `unknown-session` → AGT-207。`session-in-use` は画面から通れない（下の注を参照）ため、starter の単体テスト（Task 3）で確かめる
    - `claude` が再開に失敗する・何も送らずに終えたセッション → AGT-209（実物の挙動を記録する。L-059）
    - 記録のファイルの読み込みの失敗・不正な中身（空として扱う）→ AGT-207。書き込みの失敗は記録のストアの単体テスト（Task 2）
    - 履歴のエントリを消しても記録は残る → AGT-208。フォルダを開き直した・ほかのフォルダから戻った → AGT-204
    - 送れたときだけ記録する（キャンセル・失敗では記録しない）→ AGT-202。送信前の確認をオフにしてすぐ送った経路の記録 → AGT-210（確認を経由した経路は AGT-195・AGT-201）。エージェントのエントリの `再実行` → AGT-201・AGT-203
    - `already-running`・作り直しの後の合わせ込み・止まりきる前の予約・spawn した後の取り消し・別のウィンドウの `session-in-use` は、画面から確実に通せない（このアプリは 1 ウィンドウで〈`src/main/index.ts` は新しいウィンドウを開かない〉、同じウィンドウの同じ ID は renderer が押せなくする。止まりきる前・取り消しの途中は数秒より短い）ため項目にせず、Task 3〜5 の単体テストで確かめる
    - 履歴の保存の失敗・履歴の上限（200）は既存のとおり（項目にしない）
```markdown
### セッションの再開と履歴

> 前提: Claude Code（`claude`）がインストールされログイン済みで、空のテスト用のフォルダを 2 つ作っておく（例: `A=$(mktemp -d); B=$(mktemp -d); echo a > "$A/a.txt"; echo b > "$B/b.txt"; echo "$A $B"`）。アプリでフォルダ A を開き（`claude` のタブは 1 つで未起動）、設定の実行方式はエージェント CLI、設定の「送信前の確認」はオン（既定）。プロンプトは「プロンプト」パネルに `覚える`（内容 `「りんご」という単語を覚えておいて。返事は「了解」だけ`）を登録しておく。セッションの ID の確かめ方: `claude` で `/status` を実行して表示される Session ID（出ない版ではその旨を記録する）と、別の端末で `ls -t ~/.claude/projects/*$(basename "$A")*/ | head -3` を実行したときの一番新しい `<UUID>.jsonl` の名前（フォルダ A に当たる project のディレクトリだけを見る）。
> 前提: 実装の自動テストでは、実物の `claude` も Electron の画面も使っていない。以下はすべて実機で未確認。期待と違ったら、その画面（ターミナルの帯・タブ・実行履歴の一覧と詳細・`claude` の画面）と `claude --version` を記録する。
> 前提: 起動の記録は `app.getPath('userData')` 配下の `agent-sessions.json`（macOS の `npm run dev` では通常 `~/Library/Application Support/prompt-ide/agent-sessions.json`）。

- [ ] **AGT-194** フォルダ A を開いた直後（一度も `起動` していない）に、ターミナルの帯を見て、VoiceOver を有効にして `前回の続きから` に `Tab` で移る → `起動` の隣に `前回の続きから` が出ていて押せず、帯の理由の欄に `このフォルダで前回起動したセッションの記録がありません` が 1 か所だけ文字で出ている（マウスを載せると同じ文言がツールチップで出る）。VoiceOver では `前回の続きから（このフォルダで最後に起動した claude のセッションを再開）` の後に説明として同じ理由が読まれる
- [ ] **AGT-195** `起動` で `claude 1` を起動し、`覚える` の `実行` → 確認の `送信` を押して `claude` が `了解` と返すのを待ってから、「実行履歴」を開いて一番上の項目を見て、それを選ぶ → 一覧の項目にタイトル `覚える`・状態 `送信済み`（成功・エラーと違う灰色）・ツールの欄 `エージェント（claude 1）`・送った本文の先頭が出る。詳細の見出しの下に `セッション: <UUID>` が出て、その UUID をマウスで選んでコピーできる。本文の欄は結果ではなく `送った内容`（送った全文）で、`Tab` で止まる。この UUID を S1 として控える
- [ ] **AGT-196** `claude 1` で `/status` を実行し（確かめたら `Esc` で閉じる）、別の端末で `ls -t ~/.claude/projects/*$(basename "$A")*/ | head -3` を実行する（フォルダ A に当たる project のディレクトリだけを見る）→ `/status` の Session ID と一番新しい `.jsonl` の名前が、AGT-195 の S1 と同じ（`--session-id` で振った ID が使われている）。違えば、表示された ID と `claude --version` を記録する
- [ ] **AGT-197** 帯の `終了` で `claude 1` を止め、`前回の続きから` を押してから、`claude 1` に `さっき覚えた単語は？` と打って Enter を押し、続けて `/status` を実行する（確かめたら `Esc` で閉じる）→ 止めた後は `前回の続きから` が押せて理由が出ない。押すと `claude 1` が起動し、前の会話が続いていて `りんご` と答える。`/status` の Session ID が S1 のままか（再開で新しい ID にならないか）を記録する（新しい ID になる場合は既知の制約。履歴と記録には S1 が残る）
- [ ] **AGT-198** `claude 1` を動かしたまま `+` で `claude 2` を起動し、`claude 2` の入力欄に直接 `「みかん」という単語を覚えておいて。返事は「了解」だけ` と打って送る。`claude 1` のタブを選んで `終了` で止め、帯を見る。続けて `claude 2` のタブで `終了` を押し、`claude 1` のタブに戻って `前回の続きから` を押し、`さっき覚えた単語は？` と打って送る → `claude 1` を止めた直後は、`前回の続きから` が押せず、帯の理由の欄に `前回のセッションは claude 2 で動いています` が出る（「前回」はそのタブで前に動いていたセッションではなく、このフォルダで最後に起動したセッション）。`claude 2` を止めると押せるようになり、押すと `claude 1` で `claude 2` の会話が続いて `みかん` と答える（確かめたら `claude 2` のタブを `×` で閉じる）
- [ ] **AGT-199** 「実行履歴」で AGT-195 の `覚える`（セッションが S1）の項目を選び、`このセッションで再開` を押してから、開いたタブの `claude` に `さっき覚えた単語は？` と打って送る。続けて「実行履歴」で同じ項目をもう一度選ぶ → 押すと新しいタブ（`claude 2` など。以下 claude N）が足されて選ばれ、ターミナルのパネルが開き、フォーカスがそのタブのターミナルに移ってそのまま打てる。`claude` は S1 の会話の続きで `りんご` と答える。もう一度選ぶと `このセッションで再開` は押せず、ボタンの下に `このセッションは claude N で動いています` が出る（`再実行` は押せる）
- [ ] **AGT-200** claude N のタブで `終了` を押してから、`+` を 2 回押してタブを 4 つにし、「実行履歴」で AGT-195 の項目を選ぶ → `このセッションで再開` が押せず、ボタンの下に `タブは 4 つまでです（使わないタブを閉じると追加できます）` が出る（`+` が押せないときと同じ文言）。確かめたら、足した 2 つのタブ（終了の確認が出たら OK）と claude N のタブを `×` で閉じ、`claude 1` だけにする
- [ ] **AGT-201** 「実行履歴」で AGT-195 の項目を選んで `再実行` を押し、確認のダイアログで `送信` を押す。その後、一覧の一番上の項目を選ぶ。続けて帯の `終了` で `claude 1` を止め、同じ項目を選び直す → 確認のダイアログの本文が `「りんご」という単語を覚えておいて。返事は「了解」だけ`、送り先が `claude 1` で、送ると `claude 1` が `了解` と返す。一覧の一番上に新しい `覚える` の項目（`送信済み`・`エージェント（claude 1）`）が足され、その `セッション:` は S1 と違う（AGT-198 で `claude 1` が再開した、`claude 2` で起動したセッションの ID）。`claude 1` を止めた後は `再実行` が押せず、ボタンの下に `エージェントが起動していません（ターミナルの「起動」を押してください）` が出る（`このセッションで再開` は押せて、その理由の行は出ない）。確かめたら `起動`（`前回の続きから` ではない。AGT-200 で足したタブのセッションが「前回」になっているため）で `claude 1` を新しく起動する
- [ ] **AGT-202** 「実行履歴」の項目の数を数えてから、`覚える` の `実行` を押して確認のダイアログで `キャンセル` を押す。続けて `claude 1` で `/model` の選択の画面を出したまま `覚える` の `実行` → `送信` を押す → どちらも実行履歴の項目の数は変わらない（キャンセル・送信の失敗〈`エージェントの入力欄が見つかりません…`〉では記録しない）。確かめたらターミナルの `claude 1` をクリックしてから `Esc` で選択の画面を閉じる
- [ ] **AGT-203** 帯の `終了` で `claude 1` を止め、設定の実行方式を「従来の方式」にしてから、「実行履歴」で AGT-201 で足した `覚える` の項目を選び、VoiceOver を有効にして `再実行` と `このセッションで再開` にそれぞれ `Tab` で移る → `再実行` は押せず `エージェント CLI 方式で記録した履歴は、エージェント CLI 方式でだけ再実行できます`、`このセッションで再開` は押せず `エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）` が、ボタンの下の別々の行に出る。VoiceOver ではそれぞれのボタンで自分の理由だけが読まれる。確かめたら実行方式を「エージェント CLI」に戻し、`起動` で `claude 1` を起動して、入力欄に直接 `「ぶどう」という単語を覚えておいて。返事は「了解」だけ` と打って送る
- [ ] **AGT-204** 「フォルダを変更」でフォルダ B を開き（実行中のエージェントを終了する確認が出たら OK を押す。B では `起動` しない）、帯と「実行履歴」の AGT-201 の項目を見る。続けて「フォルダを変更」でフォルダ A に戻り、帯の `前回の続きから` を押して `さっき覚えた単語は？` と打って送る → B では `前回の続きから` が押せず `このフォルダで前回起動したセッションの記録がありません` が出て、履歴の項目の `このセッションで再開` は押せず `記録したフォルダ（<A のパス>）を開いているときだけ再開できます` が出る。A に戻ると（取り直しの間は `前回のセッションを確かめています` が出ることがある）`前回の続きから` が押せ、押すと AGT-203 の後始末で起動したセッションが続いて `ぶどう` と答える
- [ ] **AGT-205** `claude 1` を動かしたままアプリを `Cmd+Q` で終了し、`npm run dev` で起動し直してフォルダ A を開き、`前回の続きから` を押して `さっき覚えた単語は？` と打って送る。「実行履歴」も開く → 起動し直しても `前回の続きから` が押せ、押すと同じ会話が続いて `ぶどう` と答える。実行履歴の `覚える` の項目は `送信済み` のまま残っている
- [ ] **AGT-206** `claude 1` を動かしたまま、メニューの「表示」→「再読み込み」（`Cmd+R`）で画面を読み込み直し、`前回の続きから` を押して `さっき覚えた単語は？` と打って送る → 読み込み直した後の `claude 1` は未起動で、`前回の続きから` が押せ、押すと同じ会話が続いて `ぶどう` と答える（読み込み直した直後に押して `このセッションはほかのタブかウィンドウで動いています` が出たら、その旨を記録してから数秒待って押し直す）
- [ ] **AGT-207** アプリを `Cmd+Q` で終了し、記録のファイル（`agent-sessions.json`）を削除してから起動し直してフォルダ A を開き、帯を見る。「実行履歴」で AGT-201 の `覚える` の項目を選んで `このセッションで再開` を押し、確かめたらエラーの出たタブを `×` で閉じる。続けてアプリを終了し、記録のファイルを中身が `{` だけのファイルにして起動し直し、フォルダ A を開いて帯を見る → 削除の後は `前回の続きから` が押せず `このフォルダで前回起動したセッションの記録がありません` が出る。`このセッションで再開` は押せて、足されたタブに `このセッションは再開できません（アプリの起動の記録にありません）` が赤字で出て、そのタブは未起動のまま（`claude` は起動しない。このタブは手順のとおり 2 回目の再起動の前に閉じる）。中身が壊れたファイルでもアプリは普通に起動し、帯は削除のときと同じになる。確かめたら `起動` で `claude 1` を起動しておく
- [ ] **AGT-208** `覚える` の `実行` → `送信` で送って `了解` を待ち、帯の `終了` で `claude 1` を止める。「実行履歴」で、いま足された一番上の項目を選んで `削除` を押し、ターミナルの `前回の続きから` を押して `さっき覚えた単語は？` と打って送る → 履歴の項目を消しても `前回の続きから` は押せ、押すと同じ会話が続いて `りんご` と答える（履歴のエントリを消しても起動の記録は残る）
- [ ] **AGT-209** 帯の `終了` で `claude 1` を止め、`起動` で新しく起動して何も打たずにすぐ `終了` を押し、`前回の続きから` を押す → `claude` が空の会話として起動するか、会話が見つからずに終了するか（終了した場合は `claude` が出した文言と、帯の状態・タブの赤字〈`起動の直後に終了しました…` など〉）を、`claude --version` とあわせて記録する（既知の制約: 何も送らずに終えたセッションは再開できないことがあり、起動しただけで閉じたセッションが「前回」になって、AGT-208 のセッションは「前回」から押し出される）。確かめたら `起動` で `claude 1` を起動しておく
- [ ] **AGT-210** 設定の「送信前の確認」をオフにしてから `覚える` の `実行` を押し、`了解` を待ってから「実行履歴」の一番上の項目を選ぶ → 確認のダイアログは出ずにすぐ送られ、一番上に新しい `覚える` の項目（`送信済み`・`エージェント（claude 1）`）が足され、詳細の `セッション:` に AGT-209 の後始末で起動した `claude 1` のセッションの ID（`/status` の Session ID と同じ）が出る（確かめたら設定の「送信前の確認」をオンに戻す）
```
  - 既存の項目のうち、この機能で期待結果が変わるものを直す（ID は変えない）:
    - `AGT-021` を次にする: `- [ ] **AGT-021** 従来の方式で記録した実行履歴の項目（ツールの欄が `Claude CLI` などで、`エージェント（claude N）` ではないもの）を選んで詳細を見る → `再実行` が押せず、`エージェント CLI 方式では再実行できません（設定で従来の方式に切り替えると使えます）` が表示される。`このセッションで再開` は出ない`
  - `grep -n '起動（開いているフォルダ\|帯の\|実行履歴\|履歴に' docs/manual-test-spec.md` で、帯のボタンの並び（`起動` の隣に `前回の続きから` が増える）・エージェント CLI 方式で履歴に記録されないことを期待結果にしているほかの項目が無いかを見る。あれば、期待結果を今の挙動に直す（ID は変えない）。

- [ ] **Step 3: HTML の再生成と仕様書の検査**

Run: `node scripts/build-manual-test-spec.mjs && npx vitest run scripts`
Expected: `.superpowers/manual-test-spec.html` が更新され、scripts のテスト（ID の一意性・接頭辞ごとの連番の昇順・書式）が PASS

- [ ] **Step 4: Artifact の再公開（コントローラーが行う）**

実装のサブエージェントは行わない。コントローラー（このプランを実行している親のセッション）が、Artifact ツールで `.superpowers/manual-test-spec.html`（同じファイルパス）を既存の Artifact（<manual-test-spec-artifact-url>）へ再公開する（`url` にこの URL を渡す。この会話でまだ読んでいなければ、先に `action: "read"` で読んでから公開する）。公開の結果の URL が同じであることを確かめる。

- [ ] **Step 5: 全体の検証**

Run: `npx vitest run`
Expected: すべて PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: 下の eslint に渡すのと同じファイルへ `npx eslint --fix <files>`（prettier の 100 桁の折り返しなど、自動で直せるものを先に直す）
Run: `npx eslint --max-warnings 0` に、このプランで作成・変更した TypeScript のファイルをすべて渡す（`git status --porcelain` の `.ts`・`.tsx` の一覧から作る）
Expected: エラー・警告なし
