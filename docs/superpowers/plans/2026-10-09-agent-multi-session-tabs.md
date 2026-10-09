# エージェントの複数セッション / タブ 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1 つのウィンドウで `claude` のセッションを最大 4 つまで並行して動かし、下部パネルの帯のタブで切り替え、プロンプトの `実行` を選択中のタブへ送れるようにする。

**Architecture:** main のセッションのレジストリを「所有者（webContents）→ 枠（renderer が発行する `slotId`）→ セッション」の 2 段にし、上限 4 を main でも強制する。renderer は xterm の controller をタブごとに作り、タブの一覧と選択を React の外の「タブの置き場」（文書ごとに 1 つ）で持つ。タブごとのセッションの状態は `useAgentSessions` が持ち、送信・実行方式の切り替え・フォルダの切り替え・変更の確認の配線を全タブに広げる。

**Tech Stack:** Electron, React 19, TypeScript, xterm.js, node-pty, Vitest, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-09-agent-multi-session-tabs-design.md`（実装の前に必ず読む）

## Global Constraints

- すべてのコメント・文言は日本語。既存のコメントの密度と書き方（「〜する」体、設計書の節の参照）に合わせる
- 型だけの import は `import type` を使う
- クライアントコンポーネントには `'use client'` を書く。`aria-label` を適切に付ける。React の `key` に表示文言を使わず `slotId` を使う
- 上限の値は `AGENT_MAX_SESSIONS_PER_WINDOW = 4`（`@shared/types`）。main と renderer はこの定数だけを使う
- `slotId` の形式は `^[A-Za-z0-9-]{1,64}$`（main のパーサーで検証する。renderer は `crypto.randomUUID()` で作る）
- 新しいエラーの種類は `too-many-sessions`、文言は `同時に動かせるエージェントは 4 つまでです`（数字は定数から組み立てる）
- タブの文言は `claude N`（N はそのとき使われていない最小の番号、1〜4）
- タブを閉じる確認の文言は `<タブの文言> のエージェントを終了してタブを閉じますか？`
- タブの状態の短い文言: `none`→`未起動`、`starting`→`起動中`、`running`→`実行中`、`exited`→`終了`
- 成否のある操作は成否を返し、呼び出し元は成功時だけ後続（タブの削除など）を行う（lessons L-001）
- 非同期の結果は `sessionId` / `slotId` で対象に結び付け、閉じたタブ・古いセッションに古い結果を付けない（lessons L-037・L-040）
- 消える要素にフォーカスを残さない（閉じたタブ → 隣のタブへフォーカス）
- **コミットしない。** 各タスクの最後は検証だけを行う（`git commit` はユーザーの指示があるまで禁止。CLAUDE.md）
- 各タスクの検証コマンド: `npx vitest run <変更したテスト>`、`npm run typecheck`、`npx eslint <変更したファイル>`。最終タスクで `npm test` 全体

## ファイル構成

| ファイル | 責務 | 変更 |
| --- | --- | --- |
| `src/shared/types/agentTerminal.ts` | IPC の型・上限 | `slotId`・`too-many-sessions`・`AGENT_MAX_SESSIONS_PER_WINDOW`・`AgentSessionSnapshotEntry` |
| `src/main/agentSessionRegistry.ts` | 所有者 → 枠 → セッション | 2 段化・上限・`stopOwner`・`snapshot` の一覧 |
| `src/main/agentSessionStarter.ts` | 起動の規則 | 世代を枠の単位で控える |
| `src/main/agentSessionLifecycle.ts` | 停止の契機 | `stopOwner` を使う |
| `src/main/handlers/agentTerminalPayloadParser.ts` | 入力の検証 | `slotId` の検証 |
| `src/main/handlers/agentTerminalHandlers.ts` | IPC の受け口 | `getState` の一覧 |
| `src/preload/api.ts`・`src/preload/index.d.ts` | preload の API | `getAgentSessions` |
| `src/renderer/src/lib/agentTerminalApi.ts` | renderer の IPC 窓口 | `getAgentSessions` |
| `src/renderer/src/lib/agentSessionMessages.ts` | 文言 | `too-many-sessions`・タブの文言・状態・確認 |
| `src/renderer/src/lib/agentTerminalController.ts` | xterm 1 つ分の部品 | `dispose`、`onExit` の撤去 |
| `src/renderer/src/lib/xtermFactory.ts` | 実物の xterm で部品を作る | タブごとの生成・タブの置き場のシングルトン |
| `src/renderer/src/lib/agentSessionTabs.ts`（新規） | タブの一覧と選択（React の外） | 新規 |
| `src/renderer/src/hooks/useAgentSessions.ts`（新規。`useAgentSession.ts` を置き換え） | タブごとのセッションの状態 | 新規 |
| `src/renderer/src/hooks/useAgentPromptSender.ts` | 送信 | 送り先を送信の時点で受け取る・`sendingSlotId` |
| `src/renderer/src/hooks/useAgentWorkspace.ts` | 組み立て | 全タブへの広げ |
| `src/renderer/src/hooks/useAppState.ts` | 全体の組み立て | 変更の確認の配線 |
| `src/renderer/src/components/agent/AgentTerminalPanel.tsx` | 下部パネル | タブ列 |
| `src/renderer/src/components/agent/AgentSessionTabList.tsx`（新規） | タブ列 | 新規 |

---

### Task 1: main のレジストリの 2 段化と上限・後始末

**Files:**
- Modify: `src/shared/types/agentTerminal.ts`
- Modify: `src/main/agentSessionRegistry.ts`
- Modify: `src/main/agentSessionStarter.ts`
- Modify: `src/main/agentSessionLifecycle.ts`
- Modify: `src/main/handlers/agentTerminalHandlers.ts`（`registry.snapshot` の型の追随だけ。IPC の変更は Task 2）
- Test: `src/main/__tests__/agentSessionRegistry.test.ts`、`src/main/__tests__/agentSessionStarter.test.ts`、`src/main/__tests__/agentSessionLifecycle.test.ts`

**Interfaces:**
- Produces（shared）:
  ```ts
  /** 1 ウィンドウで同時に動かせるセッションの数(main の起動の拒否と renderer のタブの数の上限) */
  export const AGENT_MAX_SESSIONS_PER_WINDOW = 4
  /** renderer が発行するタブ(枠)の id の形式 */
  export const AGENT_SLOT_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/
  export type AgentTerminalErrorKind = ... | 'too-many-sessions'
  export interface AgentStartRequest { slotId: string; folderPath: string; cols: number; rows: number }
  export interface AgentSessionSnapshotEntry { slotId: string; sessionId: string }
  // AgentSessionSnapshot(1 つか null)は削除し、getState は AgentSessionSnapshotEntry[] を返す
  ```
- Produces（main）:
  ```ts
  class AgentSessionRegistry {
    generationOf(ownerId: number, slotId: string): string   // `${所有者の世代}/${枠の世代}`
    start(ownerId: number, slotId: string, create: () => Promise<AgentSessionCreation>): Promise<AgentStartResult>
    write(ownerId: number, sessionId: string, data: string): void
    resize(ownerId: number, sessionId: string, cols: number, rows: number): void
    stop(ownerId: number, reason: AgentExitReason, sessionId: string): Promise<void>  // その枠だけ
    stopOwner(ownerId: number, reason: AgentExitReason): Promise<void>               // 所有者の全枠
    close(): void
    stopAll(reason: AgentExitReason): Promise<void>
    snapshot(ownerId: number): AgentSessionSnapshotEntry[]
    hasAny(): boolean
  }
  ```

**手順:**

- [ ] **Step 1: shared の型を変える**

  `src/shared/types/agentTerminal.ts` に上の定数・型を足し、`AgentStartRequest` に `slotId` を足し、`AgentSessionSnapshot` を `AgentSessionSnapshotEntry` に置き換える。`AgentTerminalErrorKind` に `'too-many-sessions'` を足す。

- [ ] **Step 2: レジストリの失敗するテストを書く**

  既存の `agentSessionRegistry.test.ts` の呼び出しを、すべて枠つき（`start(1, 'a', create)`、`stop(1, 'stopped', id)`、所有者全体の停止は `stopOwner(1, 'stopped')`、`generationOf(1, 'a')`）に書き換える（既存のテストの意味は変えない。所有者全体の停止で書かれていたものは `stopOwner`、終了ボタンの停止で書かれていたものは `stop` にする）。次のテストを足す。

  ```ts
  describe('枠(タブ)ごとのセッション', () => {
    it('同じ所有者でも、枠が違えば別のセッションを起動する', async () => {
      const registry = new AgentSessionRegistry()
      const a = makeSession('s-a')
      const b = makeSession('s-b')
      await expect(registry.start(1, 'a', created(a.session))).resolves.toEqual({ kind: 'started', sessionId: 's-a' })
      await expect(registry.start(1, 'b', created(b.session))).resolves.toEqual({ kind: 'started', sessionId: 's-b' })
      expect(registry.snapshot(1)).toEqual([
        { slotId: 'a', sessionId: 's-a' },
        { slotId: 'b', sessionId: 's-b' }
      ])
    })

    it('同じ枠への 2 回目の依頼は already-running にまとめる(StrictMode)', async () => {
      const registry = new AgentSessionRegistry()
      const a = makeSession('s-a')
      const create = created(a.session)
      const [first, second] = await Promise.all([
        registry.start(1, 'a', create),
        registry.start(1, 'a', create)
      ])
      expect(first).toEqual({ kind: 'started', sessionId: 's-a' })
      expect(second).toEqual({ kind: 'already-running', sessionId: 's-a' })
      expect(create).toHaveBeenCalledTimes(1)
    })

    it(`所有者ごとに ${AGENT_MAX_SESSIONS_PER_WINDOW} つまで。超えると too-many-sessions を返し、create を呼ばない`, async () => {
      const registry = new AgentSessionRegistry()
      for (let i = 0; i < AGENT_MAX_SESSIONS_PER_WINDOW; i++) {
        await registry.start(1, `slot-${i}`, created(makeSession(`s-${i}`).session))
      }
      const create = created(makeSession('s-over').session)
      await expect(registry.start(1, 'slot-over', create)).resolves.toEqual({ kind: 'error', error: 'too-many-sessions' })
      expect(create).not.toHaveBeenCalled()
      // ほかの所有者は数えない
      await expect(registry.start(2, 'slot-0', created(makeSession('s-other').session))).resolves.toMatchObject({ kind: 'started' })
    })

    it('起動中の依頼も上限に数える', async () => {
      const registry = new AgentSessionRegistry()
      const gates: Array<() => void> = []
      const starts = Array.from({ length: AGENT_MAX_SESSIONS_PER_WINDOW }, (_, i) =>
        registry.start(1, `slot-${i}`, () => new Promise<AgentSessionCreation>((resolve) => {
          gates.push(() => resolve({ kind: 'created', session: makeSession(`s-${i}`).session }))
        }))
      )
      await flush()
      await expect(registry.start(1, 'slot-over', created(makeSession('x').session))).resolves.toEqual({ kind: 'error', error: 'too-many-sessions' })
      gates.forEach((release) => release())
      await Promise.all(starts)
    })

    it('止めた後は、上限の枠が空いてまた起動できる', async () => {
      const registry = new AgentSessionRegistry()
      for (let i = 0; i < AGENT_MAX_SESSIONS_PER_WINDOW; i++) {
        await registry.start(1, `slot-${i}`, created(makeSession(`s-${i}`).session))
      }
      await registry.stop(1, 'stopped', 's-0')
      await expect(registry.start(1, 'slot-new', created(makeSession('s-new').session))).resolves.toMatchObject({ kind: 'started' })
    })

    it('枠の停止は、その枠のセッションだけを止め、ほかの枠の起動中の依頼を取り消さない', async () => {
      const registry = new AgentSessionRegistry()
      const a = makeSession('s-a')
      await registry.start(1, 'a', created(a.session))
      let releaseB: () => void = () => undefined
      const b = makeSession('s-b')
      const startB = registry.start(1, 'b', () => new Promise<AgentSessionCreation>((resolve) => {
        releaseB = () => resolve({ kind: 'created', session: b.session })
      }))
      await flush()
      await registry.stop(1, 'stopped', 's-a')
      releaseB()
      await expect(startB).resolves.toEqual({ kind: 'started', sessionId: 's-b' })
      expect(a.stopTree).toHaveBeenCalledTimes(1)
      expect(registry.snapshot(1)).toEqual([{ slotId: 'b', sessionId: 's-b' }])
    })

    it('stopOwner は所有者のすべての枠を止め、起動中の依頼も取り消す', async () => {
      const registry = new AgentSessionRegistry()
      const a = makeSession('s-a')
      await registry.start(1, 'a', created(a.session))
      let releaseB: () => void = () => undefined
      const b = makeSession('s-b')
      const startB = registry.start(1, 'b', () => new Promise<AgentSessionCreation>((resolve) => {
        releaseB = () => resolve({ kind: 'created', session: b.session })
      }))
      await flush()
      const stopping = registry.stopOwner(1, 'folder-changed')
      releaseB()
      await stopping
      await expect(startB).resolves.toMatchObject({ kind: 'error', detail: AGENT_START_CANCELED_DETAIL })
      expect(a.stopTree).toHaveBeenCalledTimes(1)
      expect(b.stopTree).toHaveBeenCalledTimes(1)
      expect(registry.snapshot(1)).toEqual([])
    })

    it('枠の世代は、その枠の停止と所有者全体の停止の両方で変わる', async () => {
      const registry = new AgentSessionRegistry()
      const a = makeSession('s-a')
      await registry.start(1, 'a', created(a.session))
      const before = registry.generationOf(1, 'a')
      const otherBefore = registry.generationOf(1, 'b')
      await registry.stop(1, 'stopped', 's-a')
      expect(registry.generationOf(1, 'a')).not.toBe(before)
      expect(registry.generationOf(1, 'b')).toBe(otherBefore)
      await registry.stopOwner(1, 'stopped')
      expect(registry.generationOf(1, 'b')).not.toBe(otherBefore)
    })

    it('write・resize・stop は sessionId で枠を探し、ほかの所有者のセッションには届かない', async () => {
      const registry = new AgentSessionRegistry()
      const a = makeSession('s-a')
      await registry.start(1, 'a', created(a.session))
      registry.write(2, 's-a', 'x')
      await registry.stop(2, 'stopped', 's-a')
      expect(a.pty.write).not.toHaveBeenCalled()
      expect(a.stopTree).not.toHaveBeenCalled()
      registry.write(1, 's-a', 'y')
      expect(a.pty.write).toHaveBeenCalledWith('y')
    })
  })
  ```

  `FakePty` の `write` の名前が違う場合は、`./helpers/fakePty` を読んで合わせる。

- [ ] **Step 3: テストが落ちることを確かめる**

  Run: `npx vitest run src/main/__tests__/agentSessionRegistry.test.ts`
  Expected: FAIL（`start` の引数・`stopOwner`・`snapshot` の形が違う）

- [ ] **Step 4: レジストリを実装する**

  状態を次の形にする。既存の 1 所有者分の手順（`start` の for ループ・`trackStopping`・起動の結果の世代の確認）は、枠の単位でそのまま移す。

  ```ts
  // 1 つの枠(タブ)の状態。枠の世代は消さない(消して 0 に戻ると、停止の前に控えた古い世代と一致してしまう)
  interface SlotState {
    session?: AgentSession
    pending?: { generation: string; run: Promise<AgentStartResult> }
    stopping?: Promise<void>
    generation: number
  }
  interface OwnerState {
    generation: number
    slots: Map<string, SlotState>
  }
  private readonly owners = new Map<number, OwnerState>()
  ```

  - `generationOf(ownerId, slotId)` は `${owner.generation}/${slot.generation}`（無ければ 0）を返す。所有者・枠の状態が無ければ作らずに 0 として数える
  - `start`: for ループの各分岐は従来どおり（`closed` → 取り消し、生きているセッション → already-running、停止中 → 待って世代を比べる、同じ世代の起動中 → まとめる、古い世代の起動中 → 待つ）。ループを抜けた直後、**await を挟まずに**上限を確かめてから `pending` を置く:
    ```ts
    if (this.countActive(owner) >= AGENT_MAX_SESSIONS_PER_WINDOW) {
      return { kind: 'error', error: 'too-many-sessions' }
    }
    ```
    `countActive` は、生きているセッションか起動中の依頼を持つ枠の数
  - `write`・`resize`・`stop(ownerId, reason, sessionId)`: 所有者の枠から `session?.id === sessionId` の枠を探す。見つからなければ何もしない。`stop` は見つかった枠の世代だけを +1 し、セッションを `stopping` へ移して完了を待つ
  - `stopOwner(ownerId, reason)`: 所有者の世代を +1 し、すべての枠のセッションを `stopping` へ移し、すべての枠の `stopping` と `pending` の完了を待つ
  - `stopAll`: すべての所有者に `stopOwner`
  - `snapshot(ownerId)`: 生きているセッションを持つ枠を、枠を作った順（Map の挿入順）に `{ slotId, sessionId }` で返す
  - `hasAny`: すべての所有者・枠のどれかに、生きているセッション・起動中・停止中があるか
  - ファイルの先頭のコメントを「webContents の id → 枠(renderer のタブ)→ エージェントのセッション(1 ウィンドウに `AGENT_MAX_SESSIONS_PER_WINDOW` まで)」に直す

- [ ] **Step 5: starter と lifecycle を追随させる**

  - `agentSessionStarter.ts`: 入口の `registry.generationOf(ownerId)` を `registry.generationOf(ownerId, request.slotId)` に、`registry.start(ownerId, ...)` を `registry.start(ownerId, request.slotId, ...)` に、起動の直前の世代の確認も枠つきにする。starter のテストの `request` に `slotId: 'slot-1'` を足し、「起動の途中で同じ枠が止まると取り消す」「別の枠の停止では取り消さない」のテストを足す
  - `agentSessionLifecycle.ts`: `registry.stop(ownerId, reason)` を `registry.stopOwner(ownerId, reason)` にする。lifecycle のテストの偽のレジストリも `stopOwner` に合わせる
  - `agentTerminalHandlers.ts`: `getState` の戻り値の型を `AgentSessionSnapshotEntry[]` にする（中身は `registry.snapshot` のまま）。`agentTerminal:stop` は `registry.stop(event.sender.id, 'stopped', parseAgentSessionId(sessionId))` のまま（第 3 引数が必須になっただけ）

- [ ] **Step 6: テストを通す**

  Run: `npx vitest run src/main/__tests__/agentSessionRegistry.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/agentSessionLifecycle.test.ts src/main/__tests__/agentTerminalHandlers.test.ts`
  Expected: PASS（handlers のテストで snapshot の形を見ている箇所は、一覧の形に直す）

- [ ] **Step 7: 型チェックと lint**

  Run: `npm run typecheck:node && npx eslint src/main/agentSessionRegistry.ts src/main/agentSessionStarter.ts src/main/agentSessionLifecycle.ts src/main/handlers/agentTerminalHandlers.ts src/shared/types/agentTerminal.ts`
  Expected: エラーなし（web 側の型エラーは Task 2 で直す。`typecheck:web` はここでは見ない）

---

### Task 2: IPC の境界（`slotId` の検証・一覧の取得）と renderer の窓口・文言

**Files:**
- Modify: `src/main/handlers/agentTerminalPayloadParser.ts`
- Modify: `src/preload/api.ts`、`src/preload/index.d.ts`
- Modify: `src/renderer/src/lib/agentTerminalApi.ts`
- Modify: `src/renderer/src/lib/agentSessionMessages.ts`
- Modify: `src/renderer/src/hooks/useAgentSession.ts`（Task 4 で置き換えるまでの最小の追随）
- Test: `src/main/__tests__/agentTerminalPayloadParser.test.ts`（無ければ handlers のテストの中の該当の describe）、`src/main/__tests__/agentTerminalHandlers.test.ts`、`src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`、`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`、`src/renderer/src/hooks/__tests__/useAgentSession.test.ts`

**Interfaces:**
- Consumes: Task 1 の shared の型
- Produces:
  ```ts
  // preload / agentTerminalApi.ts
  getAgentSessions(): Promise<AgentSessionSnapshotEntry[]>   // getAgentSession を置き換える
  // agentSessionMessages.ts
  export const AGENT_TOO_MANY_SESSIONS = `同時に動かせるエージェントは ${AGENT_MAX_SESSIONS_PER_WINDOW} つまでです`
  export function describeAgentTabStatus(status: AgentSessionStatus): string  // 未起動・起動中・実行中・終了
  export function formatAgentTabLabel(number: number): string                  // `claude ${number}`
  export function agentCloseTabConfirm(label: string): string                  // `${label} のエージェントを終了してタブを閉じますか？`
  export const AGENT_ADD_TAB_DISABLED_LIMIT = AGENT_TOO_MANY_SESSIONS
  ```

**手順:**

- [ ] **Step 1: 失敗するテストを書く**

  - パーサー: `parseAgentStartRequest({ slotId: 'abc-1', folderPath: '/x', cols: 80, rows: 24 })` が `slotId` を含めて返す。`slotId` が無い・空・65 文字・`'a/b'`・`'a b'`・数値のときは `slotId` を含む文言で例外を投げる
  - handlers: `agentTerminal:getState` が `registry.snapshot` の一覧をそのまま返す。`agentTerminal:start` が `slotId` を starter の `request` に渡す
  - `agentTerminalApi`: `getAgentSessions()` が `window.api.getAgentSessions()` を返す
  - 文言: `describeAgentStartError({ kind: 'error', error: 'too-many-sessions' })` が `同時に動かせるエージェントは 4 つまでです`。`describeAgentTabStatus` の 4 つ、`formatAgentTabLabel(2)` が `claude 2`、`agentCloseTabConfirm('claude 2')` が `claude 2 のエージェントを終了してタブを閉じますか？`
  - `useAgentSession`: 起動の依頼に `slotId` を含める（`UseAgentSessionOptions` に `slotId: string` を足す）。マウント時の同期で、一覧の中に自分の `slotId` があればそれに合わせ、無ければ合わせない

- [ ] **Step 2: テストが落ちることを確かめる**

  Run: `npx vitest run src/main/__tests__/agentTerminalHandlers.test.ts src/renderer/src/lib/__tests__/agentTerminalApi.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/hooks/__tests__/useAgentSession.test.ts`
  Expected: FAIL

- [ ] **Step 3: 実装する**

  - パーサー:
    ```ts
    const { slotId, folderPath, cols, rows } = payload
    if (typeof slotId !== 'string' || !AGENT_SLOT_ID_PATTERN.test(slotId)) {
      throw new Error('slotId は 1〜64 文字の英数字とハイフンである必要があります')
    }
    ...
    return { slotId, folderPath, cols, rows }
    ```
  - preload: `getAgentSession` を `getAgentSessions: (): Promise<AgentSessionSnapshotEntry[]> => ipcRenderer.invoke('agentTerminal:getState')` に置き換え、`index.d.ts` も合わせる
  - `agentTerminalApi.ts`: `getAgentSession` を `getAgentSessions` に置き換える
  - `agentSessionMessages.ts`: `describeAgentStartError` の switch に `case 'too-many-sessions': return AGENT_TOO_MANY_SESSIONS` を足し、上の関数・定数を足す
  - `useAgentSession.ts`: オプションに `slotId` を足し、`startAgentSession({ slotId, folderPath, cols, rows })`。マウント時の同期は `getAgentSessions()` の中から `entry.slotId === slotId` を探す。`useAgentWorkspace.ts` は仮に `slotId: 'slot-1'` の定数を渡す（Task 5 でタブの置き場に替える）

- [ ] **Step 4: テストを通す**

  Run: Step 2 と同じ
  Expected: PASS

- [ ] **Step 5: 型チェックと lint**

  Run: `npm run typecheck && npx eslint <変更したファイル>`
  Expected: エラーなし

---

### Task 3: controller の `dispose` とタブごとの生成

**Files:**
- Modify: `src/renderer/src/lib/agentTerminalController.ts`
- Modify: `src/renderer/src/lib/xtermFactory.ts`
- Modify: `src/renderer/src/hooks/useAgentSession.ts`（`controller.onExit` をやめ、`agentTerminalApi.onAgentExit` を直接購読する）
- Test: `src/renderer/src/lib/__tests__/agentTerminalController.test.ts`、`src/renderer/src/hooks/__tests__/useAgentSession.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface TerminalLike { ...; dispose(): void }
  interface AgentTerminalController {
    ...（onExit を削除）
    /** IPC の購読を外し、xterm を破棄する。以後の呼び出しは何もしない(閉じたタブ) */
    dispose(): void
  }
  // xtermFactory.ts
  export function createXtermAgentTerminalController(): AgentTerminalController  // 呼ぶたびに新しい xterm
  // getAgentTerminalController は削除(Task 5 でタブの置き場のシングルトンに替える。それまでは useAgentWorkspace が
  // useState(createXtermAgentTerminalController) で 1 つ作る)
  ```

**手順:**

- [ ] **Step 1: 失敗するテストを書く**

  `agentTerminalController.test.ts` に足す（偽の terminal に `dispose: vi.fn()`、偽の api の `onAgentData` が返す解除関数を `vi.fn()` で控える）:

  ```ts
  describe('dispose', () => {
    it('出力の購読を外し、xterm を破棄する', () => {
      const { controller, terminal, unsubscribeData } = setup()
      controller.dispose()
      expect(unsubscribeData).toHaveBeenCalledTimes(1)
      expect(terminal.dispose).toHaveBeenCalledTimes(1)
    })

    it('破棄の後は書き込み・リサイズ・取り付けをしない', () => {
      const { controller, api, terminal } = setup()
      controller.setSession('s-1')
      controller.dispose()
      controller.writeToSession('x')
      controller.fit()
      controller.attach(document.createElement('div'))
      expect(api.writeAgentSession).not.toHaveBeenCalled()
      expect(api.resizeAgentSession).not.toHaveBeenCalled()
      expect(terminal.open).not.toHaveBeenCalled()
    })

    it('2 回呼んでも 1 回だけ破棄する', () => {
      const { controller, terminal } = setup()
      controller.dispose()
      controller.dispose()
      expect(terminal.dispose).toHaveBeenCalledTimes(1)
    })

    it('取り付けていた要素から host を外す', () => {
      const { controller } = setup()
      const container = document.createElement('div')
      controller.attach(container)
      controller.dispose()
      expect(container.childElementCount).toBe(0)
    })
  })
  ```

  `setup` は既存のテストのヘルパーに合わせる（無い項目は足す）。`onExit` を使っている既存のテストは削除する。`useAgentSession.test.ts` は、終了を `controller.onExit` ではなく偽の `window.api.onAgentExit` の listener から流すように直す。

- [ ] **Step 2: テストが落ちることを確かめる**

  Run: `npx vitest run src/renderer/src/lib/__tests__/agentTerminalController.test.ts src/renderer/src/hooks/__tests__/useAgentSession.test.ts`
  Expected: FAIL

- [ ] **Step 3: 実装する**

  - controller: `api.onAgentData(...)` の戻り値を `unsubscribeData` に控える。`api.onAgentExit` の購読・`exitListeners`・`onExit` を削除する（終了の購読は hook が直接持つ。複数の controller がそれぞれ購読すると重複して届くため）。`AgentTerminalApiLike` から `onAgentExit` を外す。`disposed` フラグを持ち、`dispose` で `unsubscribeData()`・host の取り外し・`terminal.dispose()`・`sessionId = null`。`attach`・`fit`・`writeToSession`・`endSending`・`terminal.onData` の listener は `disposed` なら何もしない
  - xtermFactory: シングルトンの `instance` を削除し、`createXtermAgentTerminalController()` にする（中身は従来の生成のまま）。ファイルの先頭のコメントを「タブごとに 1 つ」に直す
  - `useAgentSession.ts`: `controller.onExit(...)` の effect を `agentTerminalApi.onAgentExit(...)` に替える（解除は戻り値）
  - `useAgentWorkspace.ts`: `useState(getAgentTerminalController)` を `useState(createXtermAgentTerminalController)` にする（Task 5 で置き場に替える）

- [ ] **Step 4: テストを通す**

  Run: `npx vitest run src/renderer/src/lib/__tests__/agentTerminalController.test.ts src/renderer/src/hooks/__tests__`
  Expected: PASS

- [ ] **Step 5: 型チェックと lint**

  Run: `npm run typecheck && npx eslint src/renderer/src/lib/agentTerminalController.ts src/renderer/src/lib/xtermFactory.ts src/renderer/src/hooks/useAgentSession.ts src/renderer/src/hooks/useAgentWorkspace.ts`
  Expected: エラーなし

---

### Task 4: タブの置き場（`agentSessionTabs.ts`）

**Files:**
- Create: `src/renderer/src/lib/agentSessionTabs.ts`
- Modify: `src/renderer/src/lib/xtermFactory.ts`（文書ごとのシングルトン `getAgentSessionTabs`）
- Test: `src/renderer/src/lib/__tests__/agentSessionTabs.test.ts`

**Interfaces:**
- Consumes: Task 3 の `AgentTerminalController`（`dispose`）、Task 2 の `formatAgentTabLabel`
- Produces:
  ```ts
  export interface AgentSessionTab {
    slotId: string
    /** タブの番号(1〜上限)。文言は formatAgentTabLabel(number) */
    number: number
    controller: AgentTerminalController
  }
  export interface AgentSessionTabsSnapshot {
    tabs: readonly AgentSessionTab[]
    selectedSlotId: string
  }
  export interface AgentSessionTabs {
    /** useSyncExternalStore 用。変化が無ければ同じオブジェクトを返す */
    getSnapshot(): AgentSessionTabsSnapshot
    subscribe(listener: () => void): () => void
    /** 上限未満ならタブを作って選択し、作ったタブを返す。上限なら null */
    add(): AgentSessionTab | null
    /** main の一覧に合わせるとき用。同じ slotId のタブがあればそれを、無ければ上限の範囲で作って返す(選択は変えない) */
    ensure(slotId: string): AgentSessionTab | null
    /** controller を dispose してタブを消し、選択中なら左隣(無ければ右隣)を選ぶ。最後の 1 つは消さず false を返す */
    remove(slotId: string): boolean
    select(slotId: string): void
  }
  export interface AgentSessionTabsDeps {
    createController: () => AgentTerminalController
    createSlotId: () => string
    max: number
  }
  export function createAgentSessionTabs(deps: AgentSessionTabsDeps): AgentSessionTabs
  // xtermFactory.ts
  export function getAgentSessionTabs(): AgentSessionTabs  // 文書ごとに 1 つ(crypto.randomUUID・createXtermAgentTerminalController・AGENT_MAX_SESSIONS_PER_WINDOW)
  ```

**手順:**

- [ ] **Step 1: 失敗するテストを書く**

  ```ts
  import { describe, it, expect, vi } from 'vitest'
  import { createAgentSessionTabs } from '../agentSessionTabs'
  import type { AgentTerminalController } from '../agentTerminalController'

  const fakeController = (): AgentTerminalController =>
    ({ dispose: vi.fn() }) as unknown as AgentTerminalController

  function setup(max = 4) {
    let next = 0
    const tabs = createAgentSessionTabs({
      createController: vi.fn(fakeController),
      createSlotId: () => `slot-${++next}`,
      max
    })
    return { tabs }
  }

  describe('createAgentSessionTabs', () => {
    it('初期状態はタブ 1 つ(番号 1)で、それを選択している', () => {
      const { tabs } = setup()
      const snapshot = tabs.getSnapshot()
      expect(snapshot.tabs.map((tab) => [tab.slotId, tab.number])).toEqual([['slot-1', 1]])
      expect(snapshot.selectedSlotId).toBe('slot-1')
    })

    it('add はタブを作って選択し、上限で null を返す', () => {
      const { tabs } = setup(2)
      const added = tabs.add()
      expect(added?.number).toBe(2)
      expect(tabs.getSnapshot().selectedSlotId).toBe(added?.slotId)
      expect(tabs.add()).toBeNull()
      expect(tabs.getSnapshot().tabs).toHaveLength(2)
    })

    it('番号は使われていない最小の番号を使う', () => {
      const { tabs } = setup()
      tabs.add() // 2
      const third = tabs.add() // 3
      tabs.remove('slot-2')
      expect(tabs.add()?.number).toBe(2)
      expect(third?.number).toBe(3)
    })

    it('remove は controller を dispose し、選択中なら左隣を選ぶ', () => {
      const { tabs } = setup()
      tabs.add() // slot-2
      const third = tabs.add()! // slot-3(選択中)
      expect(tabs.remove('slot-3')).toBe(true)
      expect(third.controller.dispose).toHaveBeenCalledTimes(1)
      expect(tabs.getSnapshot().selectedSlotId).toBe('slot-2')
    })

    it('先頭の選択中のタブを消すと右隣を選ぶ', () => {
      const { tabs } = setup()
      tabs.add() // slot-2
      tabs.select('slot-1')
      tabs.remove('slot-1')
      expect(tabs.getSnapshot().selectedSlotId).toBe('slot-2')
    })

    it('選択していないタブを消しても選択は変えない', () => {
      const { tabs } = setup()
      tabs.add() // slot-2(選択中)
      tabs.remove('slot-1')
      expect(tabs.getSnapshot().selectedSlotId).toBe('slot-2')
    })

    it('最後の 1 つは消さず false を返す', () => {
      const { tabs } = setup()
      const [only] = tabs.getSnapshot().tabs
      expect(tabs.remove('slot-1')).toBe(false)
      expect(only.controller.dispose).not.toHaveBeenCalled()
    })

    it('ensure は既存のタブを返し、無ければ上限の範囲で作る(選択は変えない)', () => {
      const { tabs } = setup(2)
      expect(tabs.ensure('slot-1')?.slotId).toBe('slot-1')
      expect(tabs.ensure('restored')?.slotId).toBe('restored')
      expect(tabs.getSnapshot().selectedSlotId).toBe('slot-1')
      expect(tabs.ensure('another')).toBeNull()
    })

    it('変化のたびに購読者へ知らせ、変化が無ければ同じ snapshot を返す', () => {
      const { tabs } = setup()
      const listener = vi.fn()
      const unsubscribe = tabs.subscribe(listener)
      const before = tabs.getSnapshot()
      expect(tabs.getSnapshot()).toBe(before)
      tabs.add()
      expect(listener).toHaveBeenCalledTimes(1)
      expect(tabs.getSnapshot()).not.toBe(before)
      tabs.select(tabs.getSnapshot().selectedSlotId) // 同じタブの選択は変化ではない
      expect(listener).toHaveBeenCalledTimes(1)
      unsubscribe()
      tabs.add()
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('存在しないタブの select・remove は何もしない', () => {
      const { tabs } = setup()
      const before = tabs.getSnapshot()
      tabs.select('missing')
      expect(tabs.remove('missing')).toBe(false)
      expect(tabs.getSnapshot()).toBe(before)
    })
  })
  ```

- [ ] **Step 2: テストが落ちることを確かめる**

  Run: `npx vitest run src/renderer/src/lib/__tests__/agentSessionTabs.test.ts`
  Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

  ```ts
  import type { AgentTerminalController } from './agentTerminalController'

  // エージェントのセッションのタブの一覧と選択(設計書「タブの置き場」)。React の外で文書ごとに 1 つ持ち、StrictMode の
  // 二重マウントで xterm を作り直さない。useSyncExternalStore で読む

  // （Interfaces の型をここに書く）

  export function createAgentSessionTabs({
    createController,
    createSlotId,
    max
  }: AgentSessionTabsDeps): AgentSessionTabs {
    const listeners = new Set<() => void>()
    const makeTab = (slotId: string, number: number): AgentSessionTab => ({
      slotId,
      number,
      controller: createController()
    })
    const first = makeTab(createSlotId(), 1)
    let snapshot: AgentSessionTabsSnapshot = { tabs: [first], selectedSlotId: first.slotId }

    const update = (next: AgentSessionTabsSnapshot): void => {
      snapshot = next
      for (const listener of [...listeners]) listener()
    }
    const smallestFreeNumber = (): number => {
      const used = new Set(snapshot.tabs.map((tab) => tab.number))
      let number = 1
      while (used.has(number)) number++
      return number
    }
    const append = (slotId: string): AgentSessionTab | null => {
      if (snapshot.tabs.length >= max) return null
      const tab = makeTab(slotId, smallestFreeNumber())
      return tab
    }

    return {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      add() {
        const tab = append(createSlotId())
        if (tab === null) return null
        update({ tabs: [...snapshot.tabs, tab], selectedSlotId: tab.slotId })
        return tab
      },
      ensure(slotId) {
        const existing = snapshot.tabs.find((tab) => tab.slotId === slotId)
        if (existing !== undefined) return existing
        const tab = append(slotId)
        if (tab === null) return null
        update({ ...snapshot, tabs: [...snapshot.tabs, tab] })
        return tab
      },
      remove(slotId) {
        const index = snapshot.tabs.findIndex((tab) => tab.slotId === slotId)
        if (index === -1 || snapshot.tabs.length <= 1) return false
        const removed = snapshot.tabs[index]
        const tabs = snapshot.tabs.filter((tab) => tab.slotId !== slotId)
        const selectedSlotId =
          snapshot.selectedSlotId === slotId
            ? (tabs[index - 1] ?? tabs[index]).slotId
            : snapshot.selectedSlotId
        update({ tabs, selectedSlotId })
        removed.controller.dispose()
        return true
      },
      select(slotId) {
        if (slotId === snapshot.selectedSlotId) return
        if (!snapshot.tabs.some((tab) => tab.slotId === slotId)) return
        update({ ...snapshot, selectedSlotId: slotId })
      }
    }
  }
  ```

  xtermFactory.ts に足す:

  ```ts
  let tabs: AgentSessionTabs | null = null

  /** エージェントのセッションのタブの置き場(文書ごとに 1 つ) */
  export function getAgentSessionTabs(): AgentSessionTabs {
    if (tabs !== null) return tabs
    tabs = createAgentSessionTabs({
      createController: createXtermAgentTerminalController,
      createSlotId: () => crypto.randomUUID(),
      max: AGENT_MAX_SESSIONS_PER_WINDOW
    })
    return tabs
  }
  ```

- [ ] **Step 4: テストを通す**

  Run: `npx vitest run src/renderer/src/lib/__tests__/agentSessionTabs.test.ts`
  Expected: PASS

- [ ] **Step 5: 型チェックと lint**

  Run: `npm run typecheck:web && npx eslint src/renderer/src/lib/agentSessionTabs.ts src/renderer/src/lib/xtermFactory.ts`
  Expected: エラーなし

---

### Task 5: タブごとのセッションの状態（`useAgentSessions`）と組み立て・送信・変更の確認の配線

**Files:**
- Create: `src/renderer/src/hooks/useAgentSessions.ts`
- Delete: `src/renderer/src/hooks/useAgentSession.ts`（テスト `useAgentSession.test.ts` は `useAgentSessions.test.ts` に移して広げる）
- Modify: `src/renderer/src/hooks/useAgentPromptSender.ts`
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`
- Modify: `src/renderer/src/hooks/useAppState.ts`（:503-504 の `agentSessionExit`・`agentRunning`）
- Modify: `src/renderer/src/components/agent/AgentTerminalPanel.tsx`（新しい状態の形への最小の追随。選択中のタブだけを出す。タブ列は Task 6）
- Test: `src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`（新規）、`useAgentPromptSender.test.ts`、`useAgentWorkspace.test.ts`、`useAppState.agent.test.ts`、`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`

**Interfaces:**
- Consumes: Task 4 の `AgentSessionTabs`、Task 2 の文言・`getAgentSessions`、Task 3 の controller
- Produces:
  ```ts
  // useAgentSessions.ts
  export interface AgentSessionExitView { exitCode: number | null; reason: AgentExitReason }
  export interface AgentSessionTabView {
    slotId: string
    label: string                 // formatAgentTabLabel(number)
    status: AgentSessionStatus
    sessionId: string | null
    exit: AgentSessionExitView | null
    error: string | null          // 起動・停止の失敗(role="alert")。次の起動で消える
    controller: AgentTerminalController
  }
  export interface AgentLastExit extends AgentSessionExitView { sessionId: string }
  export interface AgentSessionsState {
    tabs: AgentSessionTabView[]
    selected: AgentSessionTabView
    /** 起動を押せない理由(フォルダ無し)。押せるなら null */
    startDisabledReason: string | null
    /** + を押せない理由(フォルダ無し・上限)。押せるなら null */
    addDisabledReason: string | null
    start: (slotId: string) => Promise<void>
    /** 確認なしで止める。止め終わってから解決し、失敗したら false(エラーはそのタブに出す) */
    stop: (slotId: string) => Promise<boolean>
    /** タブを作って選択し、起動する */
    addTab: () => Promise<void>
    /** 動いていれば確認して止め、止まったらタブを消す。取りやめ・停止の失敗・最後の 1 つなら消さない */
    closeTab: (slotId: string) => Promise<void>
    selectTab: (slotId: string) => void
    /** すべてのタブを止める(実行方式の切り替え)。すべて止まったら true */
    stopAll: () => Promise<boolean>
    isAnyActive: boolean          // starting か running のタブがある
    isAnyRunning: boolean         // running のタブがある
    lastExit: AgentLastExit | null  // いずれかのタブの最後の終了(終了のたびに新しいオブジェクト)
  }
  export interface UseAgentSessionsOptions {
    folderPath: string | null
    tabs: AgentSessionTabs
    enabled: boolean
    onConfirm?: (message: string) => boolean   // 既定は confirm(参照の安定のため直接渡す)
    now?: () => number
  }
  export function useAgentSessions(options: UseAgentSessionsOptions): AgentSessionsState

  // useAgentPromptSender.ts
  export interface AgentSendTarget { slotId: string; controller: AgentTerminalController }
  interface UseAgentPromptSenderOptions { onSettled; beforeSend?; clock? }  // controller を外す
  interface AgentPromptSenderState { isSending; error; notice; sendingSlotId: string | null;
    send: (text: string, target: AgentSendTarget) => Promise<AgentSendOutcome | undefined> }

  // useAgentWorkspace.ts
  export interface AgentTerminalPanelState {
    sessions: AgentSessionsState
    layout: AgentTerminalPanelLayout
    /** 送信中のタブ(× を押せない) */
    sendingSlotId: string | null
  }
  // AgentWorkspaceState の sendToAgent は (text: string) => Promise<AgentSendOutcome | undefined> のまま
  // (押した時点の選択中のタブを target にして sender.send を呼ぶ)
  ```

**手順:**

- [ ] **Step 1: `useAgentSessions` の失敗するテストを書く**

  `useAgentSession.test.ts` を `useAgentSessions.test.ts` へ移し、既存のケースを「タブ 1 つの場合」として `start(selected.slotId)` などに書き換える（起動・already-running・起動の失敗・取り消し・起動の直後の終了・起動の結果より先に届いた終了・停止の失敗・アンマウント後・マウント時の同期）。タブの置き場は偽の controller の `createAgentSessionTabs` を使う（Task 4 のテストと同じ偽物）。次のケースを足す。

  - 2 つのタブでそれぞれ起動すると、起動の依頼にそれぞれの `slotId` が入り、各タブの `sessionId`・`status` が独立している
  - タブ 2 のセッションの終了（`onAgentExit` の listener に `{ sessionId: 's-2', ... }`）は、タブ 2 だけを `exited` にし、タブ 1 は `running` のまま。`lastExit` が `{ sessionId: 's-2', ... }` になる
  - `addTab()` はタブを作って選択し、そのタブで起動の依頼を出す。フォルダが null のときは何もしない。上限のときは何もしない（`addDisabledReason` が `AGENT_TOO_MANY_SESSIONS`）
  - `closeTab`: 動いていない（`none`・`exited`）タブは確認なしで消す。動いているタブは `onConfirm` に `agentCloseTabConfirm('claude 2')` を渡し、false なら消さず止めない。true なら `stopAgentSession('s-2')` を待ってから消す。停止が reject したらタブを残し、そのタブの `error` に `AGENT_STOP_ERROR_PREFIX` の文言を出す。最後の 1 つは消さない
  - `closeTab` を起動中のタブに使うと、起動の結果を待ってから（`sessionId` が決まってから）止めて消す。起動の結果が取り消しなら止めずに消す
  - `stopAll` は動いているすべてのタブの `stopAgentSession` を呼び、すべて成功で true、1 つでも失敗で false
  - マウント時の同期: `getAgentSessions` が `[{ slotId: <タブ 1 の slotId>, sessionId: 's-1' }, { slotId: 'restored', sessionId: 's-9' }]` を返すと、タブ 1 が `running`、`restored` のタブが作られて `running` になる
  - 閉じたタブのセッションの終了が遅れて届いても、どのタブの状態も変えない（`lastExit` は変える。一覧の取り直しは害が無い）
  - `isAnyActive`・`isAnyRunning` の組み合わせ（starting だけ → active は true・running は false）

- [ ] **Step 2: テストが落ちることを確かめる**

  Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`
  Expected: FAIL（モジュールが無い）

- [ ] **Step 3: `useAgentSessions` を実装する**

  - `useSyncExternalStore(tabs.subscribe, tabs.getSnapshot)` でタブの一覧と選択を読む
  - タブごとの状態は `useState<ReadonlyMap<string, TabSessionFields>>`（`status`・`sessionId`・`exit`・`error`）。無いタブは `{ status: 'none', sessionId: null, exit: null, error: null }` として扱う。更新は `setStates((prev) => new Map(prev).set(slotId, { ...current(prev, slotId), ...patch }))` のヘルパー `patchTab(slotId, patch)` で行う
  - ref: `sessionIdBySlot: Map<string, string>`（`sessionId` → タブの逆引きにも使う）、`startingBySlot: Map<string, Promise<AgentStartResult | null>>`（起動中の依頼。closeTab が待つ）、`startedAt: Map<string, number>`、`exitsWhileStarting: Map<string, AgentSessionExit>`（`sessionId` をキー。起動中のタブがあるときだけ溜める）、`mountedRef`
  - `start(slotId)`: 従来の `useAgentSession.start` の手順をそのタブの controller（`tabs.getSnapshot().tabs` から探す）で行う。依頼は `startAgentSession({ slotId, folderPath, cols, rows })`。`too-many-sessions` は `describeAgentStartError` でそのタブの `error` に出して `none` に戻す
  - 終了: `useEffect(() => agentTerminalApi.onAgentExit((event) => { ... }), [...])`。`sessionIdBySlot` から `event.sessionId` を持つタブを探し、あれば従来の `applyExit` をそのタブで行う。無く、起動中のタブがあれば `exitsWhileStarting` に溜める。どちらでも `setLastExit({ sessionId, exitCode, reason })`
  - `stop(slotId)`: `sessionIdBySlot.get(slotId)` が無ければ true。`stopAgentSession(id)` が reject したらタブの `error` を出して false、成功で true
  - `closeTab(slotId)`: タブが 1 つなら何もしない。起動中なら `startingBySlot.get(slotId)` を待つ。動いていれば `onConfirm(agentCloseTabConfirm(label))` → false なら終わる → `await stop(slotId)` が false なら終わる。最後に状態の Map と ref からそのタブを消し、`tabs.remove(slotId)`
  - `addTab()`: `addDisabledReason !== null` なら何もしない。`const tab = tabs.add()`、null なら何もしない。`await start(tab.slotId)`
  - `stopAll()`: `sessionIdBySlot` の全タブに `stop` を並行して呼び、`every(Boolean)`
  - マウント時の同期: `enabled` のとき `getAgentSessions()` の各項目に `tabs.ensure(entry.slotId)` → 起動中・同期済みでなければ `adoptSession(slotId, entry.sessionId)` と `running`
  - `addDisabledReason`: フォルダ無し → `AGENT_START_DISABLED_NO_FOLDER`、`tabs.length >= AGENT_MAX_SESSIONS_PER_WINDOW` → `AGENT_TOO_MANY_SESSIONS`

- [ ] **Step 4: `useAgentSessions` のテストを通す**

  Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`
  Expected: PASS

- [ ] **Step 5: 送信・組み立て・配線の失敗するテストを書く**

  - `useAgentPromptSender.test.ts`: `send(text, { slotId: 'a', controller: controllerA })` は `controllerA` だけに書き、`sendingSlotId` が送信中は `'a'`、終わると null。送信中に別の `target` で `send` しても何もしない（undefined）
  - `useAgentWorkspace.test.ts`:
    - `promptRun.isRunDisabled` は選択中のタブの状態で決まる（タブ 1 が running でタブ 2 を選ぶと押せない）
    - `sendToAgent` は押した時点の選択中のタブの controller へ送る。送信中にタブを切り替えても、送り先は変わらない
    - `confirmStopAgent` は、どれかのタブが動いていれば確認する
    - 従来の方式への切り替えは、どれかのタブが動いていれば確認し、`stopAll` を待ってから保存する
  - `useAppState.agent.test.ts`: タブ 2 のセッションの終了で、エージェントの変更の一覧を取り直す（記録があるとき）。`agentRunning` は、どれかのタブが running なら true
  - `AgentTerminalPanel.test.tsx`: 既存のテストを `state.sessions.selected` を使う形に直す（帯の `起動`・`終了`・状態・エラーは選択中のタブのもの）

- [ ] **Step 6: テストが落ちることを確かめる**

  Run: `npx vitest run src/renderer/src/hooks/__tests__ src/renderer/src/components/agent/__tests__`
  Expected: FAIL

- [ ] **Step 7: 送信・組み立て・配線を実装する**

  - `useAgentPromptSender`: オプションから `controller` を外し、`send(text, target)` で受け取る。`sendingSlotId` の state を持ち、送信の開始で `target.slotId`、finally で null。手順の中の `controller` はすべて `target.controller`
  - `useAgentWorkspace`:
    ```ts
    const [agentTabs] = useState(getAgentSessionTabs)
    const agentSessions = useAgentSessions({ folderPath, tabs: agentTabs, enabled: executionMode.mode === 'agent-cli', onConfirm })
    const agentSender = useAgentPromptSender({ onSettled: agentLayout.open, beforeSend: beforeAgentSend })
    const sendToAgent = (text: string) => {
      const { slotId, controller } = agentSessions.selected
      return agentSender.send(text, { slotId, controller })
    }
    ```
    `promptRun` の `sessionStatus` は `agentSessions.selected.status`。`isAgentSessionActive` は `agentSessions.isAnyActive`。`selectExecutionMode` の `agentSession.status === 'starting'` は「どれかのタブが starting」に、`await agentSession.stop()` は `await agentSessions.stopAll()` にする。`agentTerminal: { sessions: agentSessions, layout: agentLayout, sendingSlotId: agentSender.sendingSlotId }`
  - `useAppState.ts`: `agentSessionExit: agentWorkspace.agentTerminal.sessions.lastExit`、`agentRunning: agentWorkspace.agentTerminal.sessions.isAnyRunning`。`useAgentChangesWiring` の `agentSessionExit` の型を `AgentLastExit | null` に合わせる（effect の依存はオブジェクトの同一性のままでよい）
  - `AgentTerminalPanel.tsx`: `const { sessions, layout } = state; const session = sessions.selected`。`起動` は `sessions.start(session.slotId)`、`終了` は `sessions.stop(session.slotId)`、`AgentTerminalView` の `controller` は `session.controller`。`startDisabledReason` は `sessions.startDisabledReason`

- [ ] **Step 8: テストを通す**

  Run: `npx vitest run src/renderer`
  Expected: PASS

- [ ] **Step 9: 型チェックと lint**

  Run: `npm run typecheck && npx eslint <変更したファイル>`
  Expected: エラーなし

---

### Task 6: パネルのタブ列の UI

**Files:**
- Create: `src/renderer/src/components/agent/AgentSessionTabList.tsx`
- Modify: `src/renderer/src/components/agent/AgentTerminalPanel.tsx`
- Modify: パネルのスタイルのファイル（`AgentTerminalPanel.styles.test.tsx` が見ている CSS。`grep -rn "agent-terminal-panel__header" src/renderer/src --include=*.css` で探す）
- Test: `src/renderer/src/components/agent/__tests__/AgentSessionTabList.test.tsx`（新規）、`AgentTerminalPanel.test.tsx`、`AgentTerminalPanel.styles.test.tsx`

**Interfaces:**
- Consumes: Task 5 の `AgentTerminalPanelState`・`AgentSessionsState`・`AgentSessionTabView`、Task 2 の `describeAgentTabStatus`
- Produces:
  ```tsx
  interface AgentSessionTabListProps {
    tabs: AgentSessionTabView[]
    selectedSlotId: string
    /** ターミナルの本体の id(aria-controls) */
    panelId: string
    sendingSlotId: string | null
    addDisabledReason: string | null
    onSelect: (slotId: string) => void
    onClose: (slotId: string) => void
    onAdd: () => void
  }
  export default function AgentSessionTabList(props: AgentSessionTabListProps): React.JSX.Element
  ```

**手順:**

- [ ] **Step 1: 失敗するテストを書く**

  `AgentSessionTabList.test.tsx`:

  - `role="tablist"`（名前 `エージェントのセッション`）の中に、タブごとに `role="tab"`。選択中だけ `aria-selected="true"` と `tabIndex=0`、ほかは `tabIndex=-1`。各タブの `aria-controls` が `panelId`
  - タブの名前（アクセシブルな名前）が `claude 2（実行中）` のように状態を含む。状態の印は `aria-hidden`
  - タブのクリックで `onSelect(slotId)`
  - 矢印キー: 選択中のタブで `ArrowRight` → 次のタブの `onSelect` とフォーカス移動、末尾では先頭へ回る。`ArrowLeft` は逆。`Home`・`End` は先頭・末尾
  - `×`（名前 `claude 2 を閉じる`）はタブが 2 つ以上のときだけ出る。クリックで `onClose(slotId)`。`sendingSlotId` のタブの `×` は disabled
  - `+`（名前 `新しいセッション`）のクリックで `onAdd`。`addDisabledReason` があれば disabled で、`title` と `aria-describedby` の要素に理由が出る
  - React の key の警告が出ない（`console.error` を spy して呼ばれないこと）

  `AgentTerminalPanel.test.tsx` に足す:

  - 帯にタブ列が出て、`+` で `sessions.addTab` を呼ぶ
  - 選択中のタブを `×` で閉じて、閉じた後に選択中になったタブへフォーカスが移る（`sessions.closeTab` を、呼ばれたら状態を書き換える偽物にして確かめる）
  - タブを切り替えると、`AgentTerminalView` に渡す `controller` が選択中のタブのものに変わる（偽の controller の `attach` が呼ばれる）

- [ ] **Step 2: テストが落ちることを確かめる**

  Run: `npx vitest run src/renderer/src/components/agent/__tests__`
  Expected: FAIL

- [ ] **Step 3: 実装する**

  ```tsx
  'use client'
  import { useId, useRef } from 'react'
  import type { AgentSessionTabView } from '../../hooks/useAgentSessions'
  import { describeAgentTabStatus } from '../../lib/agentSessionMessages'

  // ターミナルのパネルの帯のセッションのタブ列(設計書「画面」)。WAI-ARIA の tabs のパターン(選択とフォーカスを一緒に移す)。
  // 閉じるボタンはタブの中に入れず(操作できる要素の入れ子を避ける)、タブの隣に置く

  export default function AgentSessionTabList({ ... }: AgentSessionTabListProps): React.JSX.Element {
    const addReasonId = useId()
    const tabRefs = useRef(new Map<string, HTMLButtonElement>())
    const moveTo = (slotId: string): void => {
      onSelect(slotId)
      tabRefs.current.get(slotId)?.focus()
    }
    const handleKeyDown = (event: React.KeyboardEvent, index: number): void => {
      const last = tabs.length - 1
      const target =
        event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
        : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0
        : event.key === 'End' ? last
        : null
      if (target === null) return
      event.preventDefault()
      moveTo(tabs[target].slotId)
    }
    return (
      <div className="agent-session-tabs">
        <div role="tablist" aria-label="エージェントのセッション" className="agent-session-tabs__list">
          {tabs.map((tab, index) => {
            const selected = tab.slotId === selectedSlotId
            const statusText = describeAgentTabStatus(tab.status)
            return (
              <span key={tab.slotId} role="presentation" className="agent-session-tabs__item">
                <button
                  ref={(element) => {
                    if (element === null) tabRefs.current.delete(tab.slotId)
                    else tabRefs.current.set(tab.slotId, element)
                  }}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId}
                  aria-label={`${tab.label}（${statusText}）`}
                  tabIndex={selected ? 0 : -1}
                  className={['agent-session-tabs__tab', selected ? 'agent-session-tabs__tab--selected' : ''].filter((name) => name !== '').join(' ')}
                  onClick={() => onSelect(tab.slotId)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                >
                  <span aria-hidden="true" className={`agent-session-tabs__dot agent-session-tabs__dot--${tab.status}`} />
                  {tab.label}
                </button>
                {tabs.length > 1 && (
                  <button
                    type="button"
                    className="agent-session-tabs__close"
                    aria-label={`${tab.label} を閉じる`}
                    disabled={tab.slotId === sendingSlotId}
                    onClick={() => onClose(tab.slotId)}
                  >
                    ×
                  </button>
                )}
              </span>
            )
          })}
        </div>
        <button
          type="button"
          className="agent-session-tabs__add"
          aria-label="新しいセッション"
          disabled={addDisabledReason !== null}
          title={addDisabledReason ?? undefined}
          aria-describedby={addDisabledReason !== null ? addReasonId : undefined}
          onClick={onAdd}
        >
          +
        </button>
        {addDisabledReason !== null && (
          <span id={addReasonId} className="agent-session-tabs__reason" hidden>
            {addDisabledReason}
          </span>
        )}
      </div>
    )
  }
  ```

  `hidden` の要素は `aria-describedby` から参照しても読み上げに使われる（describedby は hidden の要素も参照できる）。テストでは `toHaveAccessibleDescription` で確かめる。

  `AgentTerminalPanel.tsx`:
  - 帯の `▾ エージェント` のボタンと `F6` のヒントの後に `<AgentSessionTabList ... panelId={bodyId} />` を置く
  - `onClose`: 閉じる前に、閉じるタブが選択中なら、ターミナルにフォーカスがあれば帯の開閉のボタンへ一時的に移す（消える要素にフォーカスを残さない）。`await sessions.closeTab(slotId)` の後、選択中のタブ（再描画の後の `tabs.getSnapshot()` に相当する値は props で届くため、`useEffect` で「閉じる操作の後に選択中のタブへフォーカスを移す」依頼のフラグを立てて処理する）へフォーカスを移す
  - `onAdd`: `void sessions.addTab()`、`onSelect`: `sessions.selectTab`
  - CSS: 帯の中でタブ列が横に並び、はみ出したら横スクロール（`overflow-x: auto`）。選択中のタブの下線、状態の印の色（running は緑、starting は黄、exited・none は灰）。既存の帯の色の変数・ダークテーマに合わせる。`AgentTerminalPanel.styles.test.tsx` の書き方に合わせて、タブ列のスタイルが読み込まれることのテストを足す

- [ ] **Step 4: テストを通す**

  Run: `npx vitest run src/renderer/src/components/agent/__tests__`
  Expected: PASS

- [ ] **Step 5: 型チェックと lint**

  Run: `npm run typecheck && npx eslint src/renderer/src/components/agent/AgentSessionTabList.tsx src/renderer/src/components/agent/AgentTerminalPanel.tsx`
  Expected: エラーなし

---

### Task 7: ROADMAP・既知の制約・実機テスト仕様書の更新と全体の検証

**Files:**
- Modify: `ROADMAP.md`
- Modify: `docs/manual-test-spec.md`
- Generate: `.superpowers/manual-test-spec.html`（`node scripts/build-manual-test-spec.mjs`）
- Modify: `docs/superpowers/specs/2026-10-04-agent-terminal-mvp-design.md`（「1 ウィンドウに 1 セッション」の記述に、今回の設計書で広げたことの注記を 1 行足す）

**手順:**

- [ ] **Step 1: ROADMAP を更新する**

  - 「今後実装した方がよい機能」の `- [ ] 複数セッション / タブ（...）` を削除し、「実装済み機能」に新しい節「### エージェントの複数セッション / タブ」を「エージェントが変更したファイルの確認（MVP の次）」の後に足す。項目は設計書の範囲（タブ列・上限 4・選択中のタブへの送信・閉じる確認・後始末・変更の記録との関係）。既知の制約は設計書の「既知の制約」の 4 項目を写す
  - 「エージェント CLI のアプリ内ターミナル実行（MVP）」の「1 ウィンドウに 1 セッション」の記述に「（複数セッションは下の節で対応）」を足す
  - 「統合ターミナルの拡張」の「複数セッション / タブ」の記述は、エージェントのセッションのタブは実装済みであることが分かるように直す

- [ ] **Step 2: 実機テスト仕様書に追記する**

  `docs/manual-test-spec.md` の「## エージェント CLI のアプリ内ターミナル」の末尾に `### 複数セッション / タブ` を足す。ID は `AGT-072` から連番（既存の最大は `AGT-071`。実行の直前に `grep -o 'AGT-[0-9]*' docs/manual-test-spec.md | sort -t- -k2 -n | tail -1` で確かめる）。書式は `- [ ] **AGT-072** <手順> → <期待結果>`。少なくとも次を入れる:

  - 前提: `> 前提: Git 管理のフォルダを開き、実行方式はエージェント CLI 方式`
  - 起動の直後はタブが 1 つ（`claude 1`）で、`起動` で動く
  - `+` で `claude 2` ができて選択され、起動する。タブの印と読み上げの名前に状態が出る
  - 4 つ作ると `+` が押せず、理由が出る
  - タブを切り替えると、それぞれのターミナルの表示（スクロールバック）が保たれている
  - 裏のタブのエージェントの出力が、切り替えた後に表示されている
  - 選択中のタブへ `実行` で送られ、ほかのタブには入らない。送信中にタブを切り替えても、押した時点のタブへ送られる
  - 選択中のタブが未起動のとき、`実行` が押せず理由が出る
  - 動いているタブの `×` で確認が出る。キャンセルで残り、OK で止まって消える。消えた後に隣のタブが選択され、フォーカスがそのタブにある
  - 送信中のタブの `×` は押せない
  - 最後の 1 つのタブには `×` が無い
  - タブを閉じた後に `+` で作ったタブが空いた番号になる
  - 左右の矢印・Home・End でタブを移れる（スクリーンリーダーで選択状態が読まれる）
  - フォルダの切り替えで、動いているタブがあれば確認が出て、OK で全タブが止まる
  - 従来の方式への切り替えで、全タブが止まる
  - リロードで全セッションが止まり、タブが 1 つに戻る
  - アプリの終了で、全タブの `claude`（子孫のプロセスを含む）が残らない（`ps` で確かめる）
  - 2 つのタブで別々に `実行` すると、ソース管理の「エージェントの変更」に両方の変更が合算で出る。どちらかのタブのセッションの終了で一覧が取り直される
  - ダークテーマでタブ列が読める

- [ ] **Step 3: HTML を再生成して検査を通す**

  Run: `node scripts/build-manual-test-spec.mjs && npx vitest run scripts`
  Expected: PASS（ID の一意性・連番・書式）

- [ ] **Step 4: Artifact を再公開する**

  `.superpowers/manual-test-spec.html` を Artifact ツールで同じファイルパスから再公開する（URL: <manual-test-spec-artifact-url>）。

- [ ] **Step 5: 全体の検証**

  Run: `npm test && npm run typecheck && npm run lint`
  Expected: すべて PASS・エラーなし

- [ ] **Step 6: Electron での起動の確認**

  `npm run dev` で起動し、タブの追加・切り替え・閉じる・`実行` の送り先を一通り確かめる。確認が終わったら Electron 本体と dev サーバーを停止する（`pgrep -fl prompt-ide` で対象を確かめてから止める）。
