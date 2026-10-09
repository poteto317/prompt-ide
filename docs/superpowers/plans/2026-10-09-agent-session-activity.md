# エージェントのセッションの状態表示 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 動いている `claude` の活動（作業中・入力待ち・許可待ち・確認待ち）を画面から判定し、タブ・パネルの帯・ステータスバーに表示する。

**Architecture:** 画面の末尾を読む関数と、記録済みの画面の特徴で活動を決める純粋な関数（`agentActivity.ts`）を作る。controller に「出力を反映し終えた」通知を足し、新しい `useAgentActivity` がタブごとにデバウンスして判定する。`useAgentWorkspace` で活動をパネルとステータスバーへ渡す。

**Tech Stack:** Electron, React 19, TypeScript, xterm.js, Vitest, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-09-agent-session-activity-design.md`（実装の前に必ず読む）

> **注（PR poteto317/prompt-ide#49 のレビュー対応で追記）:** このプランは実装を始めた時点の計画で、コード例はその時点の名前・型のままにしている。その後の SRP リファクタリングとローカルレビューで、次のように変わった。現在の名前・型と判定の規則は設計書と実装を正とする。
> - controller の通知の口 `onRender` は `onOutputWritten` に改名した（xterm の `onRender`〈画面の再描画〉と意味が違うため）。
> - `pickAttentionTab` は `pickWaitingTab` に改名し、選択中のタブを優先する引数を足した。閉じる途中のタブは数えず選ばない。
> - `useAgentActivity` のタブの入力から `sessionId` を外した（区切りは `status` で取る）。`classify` の引数は `readonly ViewportLine[]` にした。
> - `StatusBar` の props `agent` は省略できない `agent: AgentStatusBarState | null` にし、型は `useAgentStatusBar.ts` に置いた。
> - 判定の上限の待ち `AGENT_ACTIVITY_MAX_WAIT_MS`（500ms）を足した。

## Global Constraints

- コメント・文言は日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`
- 活動の型: `type AgentActivity = 'working' | 'idle' | 'permission' | 'confirm' | 'unknown'`
- 文言: `working` → `作業中`、`idle` → `入力待ち`、`permission` → `許可待ち`、`confirm` → `確認待ち`、`unknown` → `実行中`
- 判定の順序と規則は設計書の「状態」の表のとおり（permission → confirm → working → idle → unknown）。スピナーの文字は `·✢✳✶✻✽*` で 1 桁目だけを見る
- デバウンスは 150ms（定数 `AGENT_ACTIVITY_SETTLE_MS = 150`）。`setTimeout` を使い、`requestAnimationFrame` は使わない
- ステータスバーのまとめの並び: 許可待ち → 確認待ち → 作業中 → 入力待ち → 実行中（不明）。0 件の活動は出さない。区切りは ` · `。例「エージェント: 許可待ち 1 · 作業中 2」
- ステータスバーを押したときの選択の優先: 許可待ち → 確認待ち → 入力待ち
- テストのタイマーは後始末で必ず解除する（CLAUDE.md）。`act(...).then(...)` で書かない
- 成否・非同期の結果は対象（slotId・sessionId）に結び付け、閉じたタブ・古いセッションに古い結果を付けない（lessons L-037・L-040）
- 消える要素にフォーカスを残さない。クリックできる要素は 32px 以上
- **コミットしない。** 各タスクの最後は検証だけ（`npx vitest run <変更したテスト>`、`npm run typecheck`、変更したファイルへの `npx eslint --max-warnings 0`）

---

### Task 1: 画面の末尾の読み取りと活動の判定（純粋な関数）

**Files:**
- Modify: `src/renderer/src/lib/agentViewport.ts`（`ViewportBufferLike` に `baseY` を足し、`readScreenLines` を追加）
- Create: `src/renderer/src/lib/agentActivity.ts`
- Modify: `src/renderer/src/lib/agentSessionMessages.ts`（`describeAgentActivity`）
- Test: `src/renderer/src/lib/__tests__/agentViewport.test.ts`、`src/renderer/src/lib/__tests__/agentActivity.test.ts`（新規）、`agentSessionMessages.test.ts`

**Interfaces（Produces）:**
```ts
// agentViewport.ts
export interface ViewportBufferLike { readonly viewportY: number; readonly baseY: number; getLine(y: number): BufferLineLike | undefined }
/** 画面の末尾(claude が描いている現在の画面。baseY から rows 行)を読む。利用者のスクロールに左右されない */
export function readScreenLines(buffer: ViewportBufferLike, rows: number): ViewportLine[]
// agentActivity.ts
export type AgentActivity = 'working' | 'idle' | 'permission' | 'confirm' | 'unknown'
export function classifyAgentScreen(lines: readonly ViewportLine[]): AgentActivity
// agentSessionMessages.ts
export function describeAgentActivity(activity: AgentActivity): string
```

- [ ] **Step 1: 失敗するテストを書く**
  - `readScreenLines`: `viewportY = 0`・`baseY = 10`・`rows = 3` の偽のバッファで、10〜12 行目を読む（`readViewportLines` は 0〜2 行目のまま）。既存の偽のバッファに `baseY` を足す。
  - `classifyAgentScreen`（`src/renderer/src/lib/__tests__/fixtures/agentScreens.ts` の `agentScreen(name)` の `lines` を使う）:
    - `idle`: `empty`・`narrowEmpty`・`single`・`singleCurMid`・`multiTyped`・`long`・`pasted40`・`mixed`・`shellEmpty`・`shellText`・`slash`・`echoShort`・`echoLeadingNewline`・`echoLongLine`・`echoIndented`・`echoJapanese`・`tallTyped`
    - `working`: `working`・`workingDraft`・`queuedEmpty`・`streamingDraft`・`streamingAfterClear`・`toolrunDraft`・`toolrunAfterClear`
    - `permission`: `permission`・`permissionAfterClear`
    - `confirm`: `trust`・`fullscreen`
    - `unknown`: 空の画面（すべて空白の行）、ヘッダーだけの画面（`makeLine` で手書き）
    - 字下げのある `  · 箇条書き…` だけの画面は `working` にならない（`unknown`）
    - 記録済みの全画面がいずれかの期待に含まれていること（台帳に画面が増えたらテストが落ちる）を `Object.keys` で確かめる
  - 実際の各画面の期待が上と違う場合は、画面の中身を確かめ、設計書の規則に照らして期待を決める（規則を変える必要があれば NEEDS_CONTEXT で止まる）。
  - `describeAgentActivity` の 5 つの文言。
- [ ] **Step 2: テストが落ちることを確かめる**（`npx vitest run src/renderer/src/lib/__tests__/agentViewport.test.ts src/renderer/src/lib/__tests__/agentActivity.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`）
- [ ] **Step 3: 実装する**
  - `classifyAgentScreen`: 各行の文字列は `lineText`。`findInputBox(lines)` を使う。
    - `permission`: 入力欄が無く、`/^\s*Do you want to /` の行と、`/^\s*❯\s*\d+\./` の行がある
    - `confirm`: 入力欄が無く、`/^\s*❯ \S/` の行か `Enter to confirm` を含む行がある
    - `working`: `/^[·✢✳✶✻✽*] \S/` の行がある、または `esc to interrupt` を含む行がある
    - `idle`: 入力欄がある
    - それ以外 `unknown`
  - 例外を投げない。
- [ ] **Step 4: テストを通す・型チェック・lint**

---

### Task 2: controller の描画の通知と画面の末尾の読み取り

**Files:**
- Modify: `src/renderer/src/lib/agentTerminalController.ts`
- Modify: `src/renderer/src/__tests__/makeFakeAgentTerminal.ts`（偽の terminal・controller に合わせる）
- Test: `src/renderer/src/lib/__tests__/agentTerminalController.test.ts`

**Interfaces:**
- Consumes: Task 1 の `readScreenLines`
- Produces:
```ts
interface TerminalLike { write(data: string, callback?: () => void): void; ... }  // xterm の write(data, callback)
interface AgentTerminalController {
  /** 出力を xterm が画面に反映し終えたら呼ぶ(活動の判定のきっかけ)。dispose の後は呼ばない。解除の関数を返す */
  onRender(listener: () => void): () => void
  /** 画面の末尾(claude の現在の画面)を読む。利用者のスクロールに左右されない */
  readScreen(): ViewportLine[]
}
```

- [ ] **Step 1: 失敗するテストを書く**: セッションの出力を書くと、write のコールバックで `onRender` の listener が呼ばれる（コールバックを呼ぶまでは呼ばれない）。保留の出力を `setSession` で書き出したときも呼ばれる。解除した listener は呼ばれない。`dispose` の後のコールバックでは呼ばれない。`readScreen` は `baseY` から読む。
- [ ] **Step 2: 落ちることを確かめる**
- [ ] **Step 3: 実装する**（`terminal.write(data, notifyRender)`。listener は Set。`dispose` で Set を空にする）。偽物の terminal の `write` はコールバックを控え、テストから呼べるようにする（既存のテストが同期で書き込みを確かめている箇所は壊さない）。
- [ ] **Step 4: 通す・型チェック（`src/renderer/src/lib/xtermFactory.ts` の実物の xterm の `write(data, callback)` と型が合うこと）・lint**

---

### Task 3: タブごとの活動の判定（`useAgentActivity`）

**Files:**
- Create: `src/renderer/src/hooks/useAgentActivity.ts`
- Test: `src/renderer/src/hooks/__tests__/useAgentActivity.test.ts`（新規）

**Interfaces:**
- Consumes: Task 1 の `classifyAgentScreen`・`AgentActivity`、Task 2 の `onRender`・`readScreen`
- Produces:
```ts
export const AGENT_ACTIVITY_SETTLE_MS = 150
export interface AgentActivityTab { slotId: string; status: AgentSessionStatus; sessionId?: string | null; controller: AgentTerminalController }
export interface UseAgentActivityOptions { tabs: readonly AgentActivityTab[]; classify?: (lines: ViewportLine[]) => AgentActivity }
/** タブごとの活動。running でないタブ・まだ判定していないタブは 'unknown' */
export function useAgentActivity(options: UseAgentActivityOptions): ReadonlyMap<string, AgentActivity>
```
（セッションが変わったことを知る手段として、`AgentSessionTabView` に `sessionId` が無ければ、`status` の変化〈`running` へ入る・`running` から出る〉で区切る。どちらで区切るかを実装者が決め、報告に書く。）

- [ ] **Step 1: 失敗するテストを書く**（偽の controller: `onRender` の listener を控えてテストから呼べる、`readScreen` の戻り値をテストで決められる。`vi.useFakeTimers()`、`afterEach` で `vi.useRealTimers()`）
  - `running` のタブで通知 → 150ms 後に判定し、その結果を返す。149ms では判定しない。
  - 150ms 以内の連続の通知はまとめて 1 回だけ判定する（最後の通知から 150ms）。
  - `running` でないタブは通知が来ても `unknown`。`running` から外れたら `unknown` に戻り、待っている判定を取り消す。
  - 起動し直したら（`running` に入り直したら）前の活動は使わず `unknown` から。
  - タブが消えたら購読を外し（偽物の解除が呼ばれる）、待っているタイマーも取り消す。
  - アンマウントで購読とタイマーを外す。
  - 判定の結果が前と同じなら再描画しない（戻り値の Map が同じ参照）。
- [ ] **Step 2: 落ちることを確かめる**
- [ ] **Step 3: 実装する**（購読はタブの `slotId`・`controller` が変わったときだけ張り直す。タイマーはタブごとに ref で持つ）
- [ ] **Step 4: 通す・型チェック・lint**

---

### Task 4: タブ・帯への反映

**Files:**
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`（`useAgentActivity` を組み、`AgentTerminalPanelState` に `activities: ReadonlyMap<string, AgentActivity>` を足す）
- Modify: `src/renderer/src/components/agent/AgentSessionTabList.tsx`（印の class・読み上げの名前）
- Modify: `src/renderer/src/components/agent/AgentTerminalPanel.tsx`（帯の文言）
- Modify: `src/renderer/src/lib/agentSessionMessages.ts`（必要なら、状態と活動から文言を決める関数）
- Modify: `src/renderer/src/assets/main.css`（印の色・点滅〈`prefers-reduced-motion: reduce` では点滅しない〉）
- Modify: テストのヘルパー（`makeAgentWorkspaceState`・`makeAgentSessionsState` など）
- Test: `AgentSessionTabList.test.tsx`、`AgentTerminalPanel.test.tsx`、`AgentTerminalPanel.styles.test.tsx`、`useAgentWorkspace.test.ts`

**Interfaces:**
- Consumes: Task 3 の `useAgentActivity`
- Produces: `AgentTerminalPanelState.activities`。タブ列の props に `activity`（タブごと）を渡す形は実装者が決める（`AgentSessionTabList` の props は必要なものだけにする）。

- [ ] **Step 1: 失敗するテストを書く**
  - タブ列: `running` のタブの読み上げの名前が `claude 2（許可待ち）` のように活動の文言になる。活動が `unknown` なら `（実行中）`。`running` 以外は従来どおり。印の class に活動（例: `agent-session-tabs__dot--permission`）が付く。
  - 帯: 選択中のタブが `running` のとき、状態の文言が活動の文言になる（`unknown` は従来の文言）。
  - スタイル: 活動ごとの印の規則が読み込まれる（既存の styles テストの書き方に合わせる）。
  - `useAgentWorkspace`: `agentTerminal.activities` が `useAgentActivity` の結果になる。
- [ ] **Step 2: 落ちることを確かめる**
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通す・型チェック・lint**

---

### Task 5: ステータスバーのまとめ

**Files:**
- Modify: `src/renderer/src/components/StatusBar.tsx`（props を受ける）
- Create: `src/renderer/src/lib/agentActivitySummary.ts`（まとめの純粋な関数）
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`・`src/renderer/src/hooks/useAppState.ts`・`src/renderer/src/App.tsx`（状態を渡す）
- Modify: `src/renderer/src/assets/main.css`
- Test: `src/renderer/src/lib/__tests__/agentActivitySummary.test.ts`（新規）、`src/renderer/src/components/__tests__/StatusBar.test.tsx`（新規か既存）、`useAgentWorkspace.test.ts`

**Interfaces:**
```ts
// agentActivitySummary.ts
export interface AgentActivitySummaryItem { activity: AgentActivity; count: number }
/** running のタブの活動を数え、許可待ち → 確認待ち → 作業中 → 入力待ち → 実行中 の順に、0 件を除いて並べる。running のタブが無ければ空 */
export function summarizeAgentActivities(tabs: readonly { slotId: string; status: AgentSessionStatus }[], activities: ReadonlyMap<string, AgentActivity>): AgentActivitySummaryItem[]
/** 押したときに選ぶタブ(許可待ち → 確認待ち → 入力待ち の順で最初に当たる running のタブ)。無ければ null */
export function pickAttentionTab(...): string | null
export function formatAgentActivitySummary(items): string        // 「エージェント: 許可待ち 1 · 作業中 2」
export function describeAgentActivitySummary(items): string      // aria-label: 「エージェント: 許可待ち 1 · 作業中 2（押すとターミナルを開きます）」
// StatusBar の props
interface StatusBarProps { agent?: { items: AgentActivitySummaryItem[]; needsAttention: boolean; onActivate: () => void } | null }
```

- [ ] **Step 1: 失敗するテストを書く**
  - まとめ: 並び・0 件を出さない・`running` 以外を数えない・`running` が無ければ空・文言と aria-label。
  - 選ぶタブ: 優先の順・同じ活動が複数なら並びの先頭・当たらなければ null。
  - StatusBar: `agent` が null か items が空なら何も出さない。出すときはボタンで、文言と aria-label・`needsAttention` の class。押すと `onActivate`。高さ 32px 以上（スタイルのテスト）。
  - `useAgentWorkspace`（または組み立ての場所）: エージェント CLI 方式でないときは `null`。`onActivate` はパネルを開き（最大化は変えない）、`pickAttentionTab` のタブを選択し、描画の後にそのタブのターミナルへフォーカスを移す（選ぶタブが無ければパネルを開くだけ）。
- [ ] **Step 2: 落ちることを確かめる**
- [ ] **Step 3: 実装する**（ステータスバーの既存の固定の表示は変えない。まとめは左側、ブランチの表示の後ろに置く）
- [ ] **Step 4: 通す・型チェック・lint**

---

### Task 6: ROADMAP・実機テスト仕様書の更新と全体の検証

**Files:** `ROADMAP.md`、`docs/manual-test-spec.md`、`.superpowers/manual-test-spec.html`（生成）

- [ ] **Step 1: ROADMAP**: 「セッションの状態表示 …」を「今後」から外し、「実装済み機能」のエージェントの節（複数セッション / タブの後）に、判定の方式・表示先・既知の制約（設計書の「既知の制約」）を書く。MVP の既知の制約「状態はアプリから分からない」などの記述があれば、今回の範囲で変わったことを注記する。
- [ ] **Step 2: 実機テスト仕様書**: 「## エージェント CLI のアプリ内ターミナル」に `### セッションの状態表示` を足し、ID は AGT の最大の次から（`grep -o 'AGT-[0-9]*' docs/manual-test-spec.md | sort -t- -k2 -n | tail -1` で確かめる）。少なくとも: 入力待ち・作業中（書きかけがあっても作業中）・許可待ち（ツールの許可の確認）・確認待ち（`/model` の選択・信頼の確認）・終了のそれぞれでタブの印と読み上げの名前・帯の文言が変わる／スクロールで戻していても判定が変わらない／裏のタブの状態も変わる／ステータスバーのまとめと、押したときに許可待ちのタブが選ばれターミナルにフォーカスが移る／従来の方式では出ない／`prefers-reduced-motion` で点滅しない／ダークテーマで読める。
- [ ] **Step 3**: `node scripts/build-manual-test-spec.mjs && npx vitest run scripts`
- [ ] **Step 4: 全体の検証**: `npx vitest run src scripts`、`npm run typecheck`、変更した TypeScript のファイルへの `npx eslint --max-warnings 0`
