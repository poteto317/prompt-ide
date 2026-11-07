# 許可待ち・確認待ちの `claude` へのプロンプトの送信を断る 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エージェント CLI 方式で、送り先の `claude` が許可待ち・確認待ちの間は、プロンプトの `実行`・履歴の `再実行`・送信前の確認の `送信` を押せなくする。押した後も送信の手順の各段で画面の末尾を読み直して止め、`Enter`・貼り付けが選択の画面に届いて既定の選択肢で答えないようにする。

**Architecture:** 押せる条件の純関数 `getPromptRunAvailability` が、どの種類でも「利用者の操作を待っている活動」（既存の `isAgentActivityWaitingForUser`）で断る。`claude` の送信の手順 `sendClaudePrompt` は、最初と各書き込みの直前の読み取りで画面の末尾（`readScreen`）を `classifyClaudeScreen` で判定し、`screen-permission`・`screen-confirm` で止める。送信の手順の表の `claude` の `discardHeldInputOn` に、その 2 つの失敗を足す。新しい型・文言・UI の部品は足さない。

**Tech Stack:** Electron + React 19 + TypeScript、Vitest + Testing Library

**設計書:** `docs/superpowers/specs/2026-11-07-agent-send-block-on-permission-design.md`（各タスクの前に該当の節を読む。文言は既存の `agentSendBlockedByActivityReason` の文と一字一句同じ）

## Global Constraints

- 返答・コメント・テストの名前（`it` の文字列）・ドキュメントは日本語。テストの名前は「条件 → 期待する結果」
- 型だけの import は `import type`。関数には戻り値の型を書く（テストの補助関数を含む）
- **コミットはユーザーの明示的な指示があるときだけ行う**（CLAUDE.md）。このプランの手順にはコミットを入れない。指示があったら、タスクごとに 1 コミット（日本語の Conventional Commits）にする。`git add -A` は使わない（`git add -u` か、変えたファイルを名指しする）
- テストの実行は `NODE_ENV=test` を付ける（シェルの `NODE_ENV=production` で大量に落ちるため）
- `act(...).then(...)` の形で書かない。hook の非同期の結果は `await act(async () => { ... })` の中で待つ
- 各タスクの終わりに、そのタスクで変えたファイルへ `npx eslint <パス...> --max-warnings 0` と `npm run typecheck` を通す。整形の崩れは `npx prettier --write <パス>` で直す
- TDD: 失敗するテストを先に書き、落ちることを確かめてから実装する。実装を戻すとそのテストが落ちることを確かめる（`git stash push <実装ファイル>` → テスト → `git stash pop`）
- `claude` の作業中（`working`）・判定できない（`unknown`）の送信の挙動は変えない。`copilot` の挙動は変えない（押せる条件の結果・手順・溜めた入力の扱い）
- 断る活動は `isAgentActivityWaitingForUser`（`permission`・`confirm`）だけ。新しい集まり・表の欄を作らない
- 気をつける知見の ID（`$DEV_FLOW_KIT/lessons/review-lessons.md`）: L-001, L-018, L-048, L-058, L-059, L-060, L-061, L-593, L-594, L-597

## ファイルの構成

| ファイル | 役割（この機能での変更） |
| --- | --- |
| `src/renderer/src/lib/promptRunAvailability.ts` | 押せる条件に許可待ち・確認待ちの分岐を足す（Task 1） |
| `src/renderer/src/lib/__tests__/promptRunAvailability.test.ts` | 押せる条件の表（Task 1） |
| `src/renderer/src/hooks/useAgentWorkspace.ts` | `sendGateOf` のコメントだけ（Task 1） |
| `src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` | 3 つの入口の配線（Task 1） |
| `src/renderer/src/lib/claudePromptSend.ts` | 各段の画面の末尾の確かめ（Task 2） |
| `src/renderer/src/lib/agentPromptSend.ts` | `AgentSendTarget` の JSDoc（Task 2） |
| `src/renderer/src/lib/__tests__/claudePromptSend.test.ts` | 偽の送り先の `readScreen` と各段のテスト（Task 2） |
| `src/renderer/src/lib/agentPromptSendSpecs.ts` | `claude` の `discardHeldInputOn` と JSDoc（Task 3） |
| `src/renderer/src/lib/__tests__/agentPromptSendSpecs.test.ts` | 表の期待（Task 3） |
| `src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts` | hook から手順・溜めた入力への配線（Task 3） |
| `ROADMAP.md`・`README.md`・`docs/manual-test-spec.md` | 文書と実機テスト仕様書（Task 4） |

`docs/developer-guide.md` は変えない（設計書「ROADMAP・ドキュメントの更新の方針」）。

---

### Task 1: 押せる条件で許可待ち・確認待ちを断る

**Files:**
- Modify: `src/renderer/src/lib/promptRunAvailability.ts`
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`（`sendGateOf` のコメントだけ）
- Test: `src/renderer/src/lib/__tests__/promptRunAvailability.test.ts`
- Test: `src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`

**Interfaces:**
- Consumes: `isAgentActivityWaitingForUser(activity: AgentActivity): activity is AgentActivityWaitingForUser`（`lib/agentActivity.ts`。既存）、`agentSendBlockedByActivityReason(activity: Exclude<AgentActivity, 'idle'>, commandName: string): string`（`lib/agentSendMessages.ts`。既存）
- Produces: `getPromptRunAvailability` の新しい規則（どの種類でも `permission`・`confirm` で `{ disabled: true, reason: agentSendBlockedByActivityReason(activity, commandName) }`）。シグネチャは変えない

**気をつける点:** L-058（押せない理由と送った後の失敗を同じ文に）、L-061（3 つの入口が同じ関数を通ることをテストで固定）、L-060（`sendGateOf` の受け渡しを変異で確かめる）、L-048（`copilot` と `claude` の作業中の結果を変えない）

- [ ] **Step 1: 押せる条件の失敗するテストを書く**

`src/renderer/src/lib/__tests__/promptRunAvailability.test.ts` の `describe('押せる条件の活動と中断の流れ(requiresIdle の種類だけが見る)', …)` の名前を `'押せる条件の活動と中断の流れ(許可待ち・確認待ちはどの種類でも、作業中・不明・中断の流れは requiresIdle の種類だけが見る)'` に直す。その中の次のテストを消す。

```ts
  it.each(['working', 'permission', 'confirm', 'unknown', 'idle'] as const)(
    'claude は活動(%s)と中断の流れに関わらず、今と同じく押せる',
    …
  )
```

代わりに、同じ位置へ次を足す。

```ts
  it.each(['working', 'unknown', 'idle'] as const)(
    'claude は活動が %s なら、中断の流れに関わらず今と同じく押せる',
    (activity) => {
      for (const isInterrupting of [false, true]) {
        expect(
          getPromptRunAvailability({ ...copilotIdle, cliKind: 'claude', activity, isInterrupting })
        ).toEqual({ disabled: false, reason: null })
      }
    }
  )

  it.each(['permission', 'confirm'] as const)(
    'claude の活動が %s なら、中断の流れに関わらず押せず、活動の理由を出す',
    (activity) => {
      for (const isInterrupting of [false, true]) {
        expect(
          getPromptRunAvailability({ ...copilotIdle, cliKind: 'claude', activity, isInterrupting })
        ).toEqual({
          disabled: true,
          reason: agentSendBlockedByActivityReason(activity, 'claude')
        })
      }
    }
  )

  it('claude の閉じる途中・動いていない・送信中の理由は、許可待ちの理由より先', () => {
    const waiting = { ...copilotIdle, cliKind: 'claude' as const, activity: 'permission' as const }
    expect(getPromptRunAvailability({ ...waiting, isSessionClosing: true }).reason).toBe(
      RUN_DISABLED_CLOSING
    )
    expect(getPromptRunAvailability({ ...waiting, isSessionRunning: false }).reason).toBe(
      RUN_DISABLED_NO_SESSION
    )
    expect(getPromptRunAvailability({ ...waiting, isSending: true }).reason).toBe(
      RUN_DISABLED_SENDING
    )
  })

  it('claude の履歴の再実行も同じ(記録したフォルダの理由が先)', () => {
    const entry = {
      ...copilotIdle,
      cliKind: 'claude' as const,
      recordedFolderPath: '/repo',
      folderPath: '/repo'
    }
    expect(getHistoryRerunAvailability({ ...entry, activity: 'permission' })).toEqual({
      disabled: true,
      reason: agentSendBlockedByActivityReason('permission', 'claude')
    })
    expect(
      getHistoryRerunAvailability({ ...entry, folderPath: '/other', activity: 'permission' })
    ).toEqual({ disabled: true, reason: rerunDisabledAgentEntryFolderMismatch('/repo') })
    expect(getHistoryRerunAvailability({ ...entry, activity: 'working' })).toEqual({
      disabled: false,
      reason: null
    })
  })
```

同じ `describe` の末尾の `'%s の活動と中断の流れを見るかは、送信の手順の表の requiresIdle で決まる'` の後に、種類 × 活動の表のテストを足す。

```ts
  it.each(AGENT_CLI_KINDS)(
    '%s は、利用者の操作を待っている活動ではいつも押せず、作業中・不明では requiresIdle のときだけ押せない',
    (cliKind) => {
      const { requiresIdle } = AGENT_PROMPT_SEND_SPECS[cliKind]
      const expected: Record<AgentActivity, boolean> = {
        idle: false,
        permission: true,
        confirm: true,
        working: requiresIdle,
        unknown: requiresIdle
      }
      for (const activity of Object.keys(expected) as AgentActivity[]) {
        expect(getPromptRunAvailability({ ...copilotIdle, cliKind, activity }).disabled).toBe(
          expected[activity]
        )
      }
    }
  )
```

ファイルの先頭の import に `import type { AgentActivity } from '../agentActivity'` を足す（既にあれば足さない）。`RUN_DISABLED_CLOSING`・`RUN_DISABLED_NO_SESSION`・`RUN_DISABLED_SENDING`・`agentSendBlockedByActivityReason`・`rerunDisabledAgentEntryFolderMismatch` は既存の import にある。

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/promptRunAvailability.test.ts`
Expected: FAIL（`claude の活動が %s なら、中断の流れに関わらず押せず…`〈permission・confirm〉・`claude の履歴の再実行も同じ`・表のテストの `claude` が落ちる。`claude の閉じる途中・動いていない・送信中の理由は…` は今の実装でも通る〈理由の順の固定〉。`claude は活動が %s なら…押せる` と `copilot` の既存のテストは通る）

- [ ] **Step 3: 押せる条件を実装する**

`src/renderer/src/lib/promptRunAvailability.ts` の import を次にする（`import type { AgentActivity } from './agentActivity'` の行を置き換える）。

```ts
import type { AgentActivity } from './agentActivity'
import { isAgentActivityWaitingForUser } from './agentActivity'
```

`getPromptRunAvailability` の `if (params.isSending) …` の後の `if (AGENT_PROMPT_SEND_SPECS[params.cliKind].requiresIdle) { … }` の塊を、次に置き換える。

```ts
  const { requiresIdle } = AGENT_PROMPT_SEND_SPECS[params.cliKind]
  // 中断の 2 回目を待つ間に貼り付けると、2 回目の Esc が貼った本文を消しうる(L-594)。requiresIdle の種類だけが見る
  if (requiresIdle && params.isInterrupting) {
    return { disabled: true, reason: RUN_DISABLED_INTERRUPTING }
  }
  // 許可待ち・確認待ち(利用者の操作を待っている活動)の画面へ送ると、送信の手順の Enter・貼り付けが選択の画面に届いて既定の
  // 選択肢で答えうる。どの種類でも送らない(claude の送信の手順も各段で同じ判定で止める。claudePromptSend.ts。L-058)
  if (isAgentActivityWaitingForUser(params.activity)) {
    return {
      disabled: true,
      reason: agentSendBlockedByActivityReason(params.activity, commandName)
    }
  }
  // 作業中の Enter は送信待ちになり、作業が終わると勝手に送られる(requiresIdle の種類は作業中・判定できない間も送らない)
  if (requiresIdle && params.activity !== 'idle') {
    return {
      disabled: true,
      reason: agentSendBlockedByActivityReason(params.activity, commandName)
    }
  }
```

コメントを直す:
- ファイルの先頭のコメントの「送り先の種類が入力待ちを求めるか(requiresIdle)は送信の手順の表 agentPromptSendSpecs.ts から引く」の後に「許可待ち・確認待ちは種類に依らず押せない(設計書 2026-11-07)」を足す。
- `AgentRunConditions` の `activity` の JSDoc の「requiresIdle の種類だけが見る」を「許可待ち・確認待ちはどの種類でも見る。作業中・判定できないは requiresIdle の種類だけが見る」に直す。
- `getPromptRunAvailability` の JSDoc の「(設計書 2026-10-22「押せる条件」。claude は活動を見ない)」を「(設計書 2026-10-22「押せる条件」)。許可待ち・確認待ちは、どの種類でも押せない(設計書 2026-11-07。claude の作業中は今までどおり押せる)」に直す。

`src/renderer/src/hooks/useAgentWorkspace.ts` の `sendGateOf` の直前のコメントの「requiresIdle の種類(copilot)だけが見る」を「許可待ち・確認待ちはどの種類でも、作業中・判定できない・中断の流れは requiresIdle の種類(copilot)だけが見る」に直す（コードは変えない）。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/promptRunAvailability.test.ts src/renderer/src/lib/__tests__/promptRunState.test.ts src/renderer/src/lib/__tests__/promptRunButton.test.ts`
Expected: PASS（`copilot` の既存のテストは変えずに通る）

- [ ] **Step 5: 3 つの入口の配線のテストを書く**

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` の `describe('送信の押せる条件の活動と中断の流れ(copilot は入力待ちで中断の流れの外だけ。L-058)', …)` の中、`'claude のタブは作業中でも実行・再実行を押せる(今のまま)'` の後に足す。このテストは `useAgentActivity` と `useAgentPromptSender` をモックしているので、画面からの判定は動かない（画面 → 活動の経路は `useAgentActivity` の既存のテストの範囲）。活動はモックの戻り値で与える。

```ts
    it.each(['permission', 'confirm'] as const)(
      '選択中の claude のタブが %s なら、実行・再実行・送信前の確認の理由が活動の理由になる',
      async (activity) => {
        const reason = agentSendBlockedByActivityReason(activity, 'claude')
        setMode('agent-cli')
        mockUseAgentSessions.mockReturnValue(runningTabOf('claude'))
        mockUseAgentActivity.mockReturnValue(activityOf(activity))
        const { result } = renderWorkspace({ folderPath: '/p' })
        expect(result.current.promptRun).toMatchObject({
          isRunDisabled: true,
          runDisabledReason: reason
        })
        expect(result.current.getHistoryActions(agentEntry).rerun).toEqual({
          disabled: true,
          reason
        })
        await act(async () => {
          await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
        })
        expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(reason)
        expect(result.current.agentSendConfirmDialog.pending?.cliKind).toBe('claude')
      }
    )

    it('送信前の確認を開いた後に claude が許可待ちになると、確認の理由が許可待ちの理由になり、入力待ちに戻ると消える', async () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(runningTabOf('claude'))
      mockUseAgentActivity.mockReturnValue(activityOf('idle'))
      const { result, rerender } = renderWorkspace({ folderPath: '/p' })
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
      })
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBeNull()
      mockUseAgentActivity.mockReturnValue(activityOf('permission'))
      rerender()
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(
        agentSendBlockedByActivityReason('permission', 'claude')
      )
      mockUseAgentActivity.mockReturnValue(activityOf('idle'))
      rerender()
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBeNull()
    })

    it('claude のタブが入力待ち・不明なら、実行・再実行を押せる(今のまま)', () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(runningTabOf('claude'))
      for (const activity of ['idle', 'unknown'] as const) {
        mockUseAgentActivity.mockReturnValue(activityOf(activity))
        const { result, unmount } = renderWorkspace({ folderPath: '/p' })
        expect(result.current.promptRun.isRunDisabled).toBe(false)
        expect(result.current.getHistoryActions(agentEntry).rerun.disabled).toBe(false)
        unmount()
      }
    })
```

（送信前の確認の設定は、このファイルの既定のモックでオン〈確認を開く〉。既存の `copilot` の `'選択中の copilot のタブが作業中なら…'` のテストと同じ前提。違っていたら、そのテストと同じ準備をする。）

- [ ] **Step 6: 配線のテストを走らせ、変異で落ちることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: PASS

変異: `useAgentWorkspace.ts` の `sendGateOf` の `activity: activities.get(slotId) ?? 'unknown'` を一時的に `activity: 'idle' as AgentActivity` に替えて同じコマンドを走らせ、Step 5 のテストが落ちることを確かめてから戻す（`git diff src/renderer/src/hooks/useAgentWorkspace.ts` にコメント以外の差分が無いこと）。`git stash push src/renderer/src/lib/promptRunAvailability.ts` で実装を戻すと Step 1・Step 5 のテストが落ちることも確かめ、`git stash pop` で戻す。

- [ ] **Step 7: lint と型を通す**

Run: `npx eslint src/renderer/src/lib/promptRunAvailability.ts src/renderer/src/lib/__tests__/promptRunAvailability.test.ts src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 2: `claude` の送信の手順の各段で画面の末尾を確かめる

**Files:**
- Modify: `src/renderer/src/lib/claudePromptSend.ts`
- Modify: `src/renderer/src/lib/agentPromptSend.ts`（`AgentSendTarget` の JSDoc だけ）
- Test: `src/renderer/src/lib/__tests__/claudePromptSend.test.ts`

**Interfaces:**
- Consumes: `classifyClaudeScreen(lines: readonly ViewportLine[]): AgentActivity`（`lib/claudeScreenActivity.ts`）、`isAgentActivityWaitingForUser`（`lib/agentActivity.ts`）、`AgentSendScreenFailure`（`lib/agentPromptSend.ts`。`` `screen-${Exclude<AgentActivity, 'idle'>}` ``）、`AgentSendTarget.readScreen(): ViewportLine[]`（既存。今まで `claude` の手順は読んでいなかった）
- Produces: `sendClaudePrompt(target, rawText, clock): Promise<AgentSendOutcome>` が、画面の末尾が許可待ち・確認待ちなら `{ kind: 'failed', reason: 'screen-permission' | 'screen-confirm' }` を返す（Task 3 の表と hook が使う）。シグネチャは変えない。新しい export は無い（`blockedByScreen` はファイルの中だけ）

**気をつける点:** L-018（入力欄は表示中の行、活動は画面の末尾。食い違う経路 b をテストで固定）、L-594（書く直前の読み取りで止める）、L-001（止めた理由を結果で返す）、L-059（描画の遅れは再現できない。テストの名前で主張しない）

- [ ] **Step 1: 偽の送り先に `readScreen` を足す（期待は変えない）**

`src/renderer/src/lib/__tests__/claudePromptSend.test.ts` の `FakeClaude` と `makeFakeClaude` を次のように直す。

`FakeClaude` に足す:

```ts
  /** 画面の末尾(readScreen)を表示中の行と別の画面にするとき。null なら表示中の行と同じ画面 */
  screen: ViewportLine[] | null
  /** readScreen を読んだ回数(reads には記録しない) */
  screenReads: number
  /** 'noBox' は入力欄の無い行だけの画面(上へスクロールした表示・描き直しの途中の形。判定は unknown) */
  mode: 'prompt' | 'shell' | 'dialog' | 'noBox'
```

（今の `mode: 'prompt' | 'shell' | 'dialog'` の行を置き換える。）

`makeFakeClaude` の options に足す:

```ts
    /** readScreen を読むたびに(画面を返す前に)呼ぶ。screenReads はこの呼び出しの前に数える */
    onReadScreen?: (fake: FakeClaude) => void
```

今の `readViewport` の中身のうち、画面を組み立てる部分を内部の関数 `render` に切り出し、`readViewport` と `readScreen` で共有する。`readScreen` は `reads` に記録せず、テストが差し替えうる `fake.readViewport` も経由しない。

```ts
  const render = (): ViewportLine[] => {
    if (fake.mode === 'dialog') return agentScreen('trust').lines
    if (fake.mode === 'noBox') return [makeLine('history'), makeLine('1'), makeLine('2')]
    if (ghostActive()) {
      const suggestion = options.ghostSuggestion ?? ''
      const line = makeLine(
        `❯\xa0${fake.input}${suggestion} `,
        [[3, 3 + suggestion.length]],
        [[2, 3]]
      )
      return [makeLine('history'), border, line, border, makeLine('  status')]
    }
    const symbol = fake.mode === 'shell' ? '!' : '❯'
    const [first, ...rest] = fake.input.split('\n')
    const cursorAt = 2 + (rest.length === 0 ? first.length : 0)
    const lines = [
      makeLine(`${symbol}\xa0${first} `, [], rest.length === 0 ? [[cursorAt, cursorAt + 1]] : [])
    ]
    for (const line of rest) lines.push(makeLine(`  ${line}`))
    return [makeLine('history'), border, ...lines, border, makeLine('  status')]
  }
```

`fake` の初期値に `screen: null, screenReads: 0` を足し、`readScreen`・`readViewport` を次にする（`render` は `fake` を参照するので、`fake` の宣言の後でも前でもよいが、呼ばれるのは `fake` ができた後）。

```ts
    readScreen: (): ViewportLine[] => {
      fake.screenReads += 1
      options.onReadScreen?.(fake)
      return fake.screen ?? render()
    },
    readViewport: (): ViewportLine[] => {
      if (options.clock !== undefined)
        fake.reads.push({
          at: options.clock.now(),
          empty: fake.mode === 'prompt' && fake.input === ''
        })
      return render()
    },
```

ファイルの先頭のコメント（偽の送り先の説明）に「readScreen は表示中の行と同じ画面を返す(screen を上書きしたときだけ別の画面)。reads には記録しない」を足す。

- [ ] **Step 2: 既存のテストのうち 2 件の期待を直し、input-not-found のテストを足す**

`mode: 'dialog'` は末尾も `trust`（判定は `confirm`）になるので、次の 2 件の期待を `screen-confirm` に直し、名前も直す（書き込みの期待はそのまま）。

```ts
  it('確認待ちの画面なら(フォルダの信頼)何も送らず screen-confirm', async () => {
    const fake = makeFakeClaude({ mode: 'dialog' })
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'screen-confirm'
    })
    expect(fake.writes).toEqual([])
  })

  it('消している途中で確認待ちの画面になったら止めて screen-confirm', async () => {
    const fake = makeFakeClaude({
      input: 'abcdefgh',
      clearPerChunk: 2,
      onWrite: (f) => {
        f.mode = 'dialog'
      }
    })
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'screen-confirm'
    })
    expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK])
  })
```

その直後に、`input-not-found` を確かめるテストを足す。

```ts
  it('入力欄も確認も無い画面(判定は unknown)なら何も送らず input-not-found', async () => {
    const fake = makeFakeClaude({ mode: 'noBox' })
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'input-not-found'
    })
    expect(fake.writes).toEqual([])
  })

  it('画面の末尾は入力待ちでも、表示中の行に入力欄が無ければ(上へスクロール)何も送らず input-not-found', async () => {
    const fake = makeFakeClaude({ mode: 'noBox' })
    fake.screen = agentScreen('empty').lines
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'input-not-found'
    })
    expect(fake.writes).toEqual([])
  })

  it('消している途中で入力欄も確認も無い画面になったら止めて input-not-found', async () => {
    const fake = makeFakeClaude({
      input: 'abcdefgh',
      clearPerChunk: 2,
      onWrite: (f) => {
        f.mode = 'noBox'
      }
    })
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'input-not-found'
    })
    expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK])
  })

  it('消している途中で表示中の行から入力欄が消えても、末尾が入力待ちなら止めて input-not-found', async () => {
    const fake = makeFakeClaude({
      input: 'abcdefgh',
      clearPerChunk: 2,
      onWrite: (f) => {
        f.mode = 'noBox'
        f.screen = agentScreen('empty').lines
      }
    })
    await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'input-not-found'
    })
    expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK])
  })
```

- [ ] **Step 3: 許可待ち・確認待ちの各段のテストを書く**

同じファイルの `describe('sendClaudePrompt', …)` の末尾に `describe('画面の末尾が許可待ち・確認待ちなら止める(設計書 2026-11-07)', …)` を足す。

```ts
  describe('画面の末尾が許可待ち・確認待ちなら止める(設計書 2026-11-07)', () => {
    it.each([
      ['permission', 'screen-permission'],
      ['permissionAfterClear', 'screen-permission'],
      ['trust', 'screen-confirm'],
      ['fullscreen', 'screen-confirm']
    ] as const)('最初から %s の画面なら何も書かず %s', async (name, reason) => {
      const fake = makeFakeClaude()
      fake.screen = agentScreen(name).lines
      await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
        kind: 'failed',
        reason
      })
      expect(fake.writes).toEqual([])
    })

    it('bracketed paste が無効でも、許可待ちの理由を先に返す', async () => {
      const fake = makeFakeClaude()
      fake.bracketed = false
      fake.screen = agentScreen('permission').lines
      await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
        kind: 'failed',
        reason: 'screen-permission'
      })
    })

    it('表示中の行は空の入力欄でも、末尾が許可待ち(上へスクロールしている)なら何も書かない', async () => {
      const fake = makeFakeClaude()
      fake.screen = agentScreen('permission').lines
      await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
        kind: 'failed',
        reason: 'screen-permission'
      })
      expect(fake.writes).toEqual([])
      expect(fake.submitted).toEqual([])
    })

    it('消去を 1 回書いた後に許可待ちになったら、消去の 1 件だけで止める', async () => {
      const fake = makeFakeClaude({
        input: 'abcdefgh',
        clearPerChunk: 2,
        onWrite: (f) => {
          f.screen = agentScreen('permission').lines
        }
      })
      await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
        kind: 'failed',
        reason: 'screen-permission'
      })
      expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK])
    })

    it('空の確認の 2 回目(貼り付けの直前)で許可待ちになったら、貼り付けを書かずに止める', async () => {
      // readScreen は 1 回目が手順の最初、2 回目が空の確認の 1 回目、3 回目が空の確認の 2 回目
      const fake = makeFakeClaude({
        onReadScreen: (f) => {
          if (f.screenReads === 3) f.screen = agentScreen('permission').lines
        }
      })
      await expect(sendClaudePrompt(fake, 'p', makeClock())).resolves.toEqual({
        kind: 'failed',
        reason: 'screen-permission'
      })
      expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK])
    })

    it('貼り付けを書いた後に許可待ちになったら、時間切れを待たずに止めて Enter を書かない', async () => {
      const clock = makeClock()
      const fake = makeFakeClaude({
        clock,
        onWrite: (f, data) => {
          if (data.startsWith('\x1b[200~')) f.screen = agentScreen('permission').lines
        }
      })
      await expect(sendClaudePrompt(fake, 'hello', clock)).resolves.toEqual({
        kind: 'failed',
        reason: 'screen-permission'
      })
      expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\x1b[201~'])
      expect(fake.submitted).toEqual([])
      expect(clock.elapsed() - fake.writeTimes[1]).toBe(AGENT_ECHO_POLL_MS)
    })

    it.each(['working', 'queuedEmpty', 'tallTyped'] as const)(
      '画面の末尾が %s(作業中・判定できない)なら、今までどおり送る',
      async (name) => {
        const fake = makeFakeClaude()
        fake.screen = agentScreen(name).lines
        await expect(sendClaudePrompt(fake, 'hello', makeClock())).resolves.toEqual({
          kind: 'sent',
          clearedDraft: false
        })
        expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\x1b[201~', '\r'])
      }
    )
  })
```

（`AGENT_ECHO_POLL_MS` は既存の import にある。`agentScreen` の名前は `fixtures/agentScreens.json` の `screens` の鍵。）

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/claudePromptSend.test.ts`
Expected: FAIL（Step 2 の `screen-confirm` の 2 件は `input-not-found` を、Step 3 の許可待ち・確認待ちのテストは `sent`〈書き込みは消去・貼り付け・`\r` の 3 件〉を受け取って落ちる。`input-not-found` の 4 件と作業中の 3 件は通る）

- [ ] **Step 5: 手順に画面の末尾の確かめを足す**

`src/renderer/src/lib/claudePromptSend.ts` の import に足す。

```ts
import { isAgentActivityWaitingForUser } from './agentActivity'
import type { AgentSendScreenFailure } from './agentPromptSend'
import { classifyClaudeScreen } from './claudeScreenActivity'
```

（`AgentSendScreenFailure` は既存の `import type { AgentSendClock, AgentSendFailure, AgentSendOutcome, AgentSendTarget } from './agentPromptSend'` に並べてよい。）

定数の後、`clearInput` の前に足す。

```ts
/**
 * 画面の末尾(readScreen。活動の判定〈useAgentActivity〉と同じ読み方・同じ判定)が利用者の操作を待っている活動(許可待ち・確認待ち)なら
 * screen-*。表示中の行(readViewport)は利用者のスクロールで末尾とずれ、前の描画の入力欄を読みうるので、こちらは末尾を読む(設計書 2026-11-07)
 */
function blockedByScreen(target: AgentSendTarget): AgentSendScreenFailure | null {
  const activity = classifyClaudeScreen(target.readScreen())
  return isAgentActivityWaitingForUser(activity) ? `screen-${activity}` : null
}
```

`clearInput` の `for (;;) {` の直後（`const box = findInputBox(target.readViewport())` の前）に足す。`first` の前には足さない（手順の最初の確かめと同じ同期の区間で、結果がいつも同じになるため。設計書「各段の守り」）。

```ts
    // 許可待ち・確認待ちの画面へ消去・貼り付けを送らない(空が 2 回続いて貼り付けへ進む直前の読み取りも、ここを通る)
    const blocked = blockedByScreen(target)
    if (blocked !== null) return { kind: 'failed', reason: blocked }
```

`sendClaudePrompt` の `if (normalized.kind === 'rejected') …` の後、`if (!target.isBracketedPasteEnabled()) …` の前に足す。

```ts
  // 許可待ち・確認待ちの画面へは何も書かない(bracketed paste の確認より先に見る。答えてからもう一度実行する方が直し方がはっきりしている)。
  // 消去の最初の書き込みの前の確かめも兼ねる(同じ同期の区間)
  const blockedAtStart = blockedByScreen(target)
  if (blockedAtStart !== null) return { kind: 'failed', reason: blockedAtStart }
```

本文が現れたかの確認の `for (;;) {` の中、`await clock.sleep(AGENT_ECHO_POLL_MS)` の直後（`const box = …` の前）に足す。

```ts
    // 許可待ち・確認待ちに変わったら、時間切れを待たずに止める(Enter を既定の選択肢への答えにしない)
    const blocked = blockedByScreen(target)
    if (blocked !== null) return { kind: 'failed', reason: blocked }
```

コメントを直す:
- ファイルの先頭のコメントの「各段で確かめられなければ、その時点で止めてそれ以上送らない(Enter は送らない)。」の後に「最初と、消去・貼り付け・Enter を書く直前の読み取りでは、画面の末尾の活動も確かめ、許可待ち・確認待ちなら screen-* で止める(設計書 2026-11-07)。」を足す。
- `sendClaudePrompt` の JSDoc の「正規化 → bracketed paste の確認 → …」を「正規化 → 画面の末尾が許可待ち・確認待ちでないかの確認 → bracketed paste の確認 → …」に直し、末尾に「消去・貼り付け・Enter の直前の読み取りでも、許可待ち・確認待ちなら screen-* で止める」を足す。

`src/renderer/src/lib/agentPromptSend.ts` の `AgentSendTarget` の JSDoc を直す:
- `readViewport` の `/** 表示中の行(claude の手順が読む) */` を `/** 表示中の行(claude の手順が入力欄を探すのに読む) */` に。
- `readScreen` の `/** 画面の末尾の行(copilot の手順が読む。段階 2a の判定と同じ読み方。代替画面なので見え方は readViewport と同じ) */` を `/** 画面の末尾の行(copilot の手順と、claude の手順の画面の活動の確かめが読む。活動の判定と同じ読み方。copilot は代替画面なので見え方は readViewport と同じ) */` に。

- [ ] **Step 6: テストが通ることを確かめ、変異で落ちることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/claudePromptSend.test.ts`
Expected: PASS（既存のテストを含めてすべて）

変異: `blockedByScreen` の 3 か所の呼び出し（手順の最初・`clearInput` の繰り返し・本文が現れたかの確認）を 1 か所ずつ一時的に消して同じコマンドを走らせ、それぞれ次のテストが落ちることを確かめてから戻す。
- 手順の最初: `'最初から %s の画面なら何も書かず %s'`（消去を 1 件書いてから繰り返しで止まるため、書き込みの期待が落ちる）・`'bracketed paste が無効でも、許可待ちの理由を先に返す'`
- `clearInput` の繰り返し: `'消去を 1 回書いた後に許可待ちになったら…'`・`'空の確認の 2 回目(貼り付けの直前)で…'`
- 本文が現れたかの確認: `'貼り付けを書いた後に許可待ちになったら…'`

- [ ] **Step 7: 関連するテスト・lint・型を通す**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`
Expected: PASS（hook の偽の controller の `screen` は既定で `[]`〈判定は unknown〉なので、既存の hook のテストは変わらない）

Run: `npx eslint src/renderer/src/lib/claudePromptSend.ts src/renderer/src/lib/agentPromptSend.ts src/renderer/src/lib/__tests__/claudePromptSend.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 3: 許可待ち・確認待ちで止めたときに溜めた入力を捨てる

**Files:**
- Modify: `src/renderer/src/lib/agentPromptSendSpecs.ts`
- Test: `src/renderer/src/lib/__tests__/agentPromptSendSpecs.test.ts`
- Test: `src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`

**Interfaces:**
- Consumes: Task 2 の `sendClaudePrompt` が返す `screen-permission`・`screen-confirm`。`useAgentPromptSender` の既存の処理（`spec.discardHeldInputOn.has(outcome.reason)` → `controller.endSending({ discard })` → 戻り値が 1 以上なら `AGENT_SEND_HELD_INPUT_DISCARDED_SUFFIX` を添える）。hook のコードは変えない
- Produces: `AGENT_PROMPT_SEND_SPECS.claude.discardHeldInputOn` が `new Set(['screen-permission', 'screen-confirm'])`

**気をつける点:** L-594（溜めた打鍵を選択の画面へ遅れて流さない）、L-060（hook から手順・表への配線を偽の controller で固定）、L-597（添え書きで捨てたことを伝える）

- [ ] **Step 1: 表と hook の失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentPromptSendSpecs.test.ts` の `claude` のテストを次に置き換える。

```ts
  it('claude は作業中も送り(requiresIdle: false)、今の手順(sendClaudePrompt)。溜めた入力は許可待ち・確認待ちで止めたときだけ捨てる', () => {
    expect(AGENT_PROMPT_SEND_SPECS.claude).toEqual({
      requiresIdle: false,
      send: sendClaudePrompt,
      discardHeldInputOn: new Set(['screen-permission', 'screen-confirm'])
    })
  })
```

`src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts` の import の `import { makeLine } from '../../lib/__tests__/fixtures/agentScreens'` を `import { agentScreen, makeLine } from '../../lib/__tests__/fixtures/agentScreens'` にし、`describe('useAgentPromptSender', …)` の中、`'失敗の理由の文言を出し、パネルを開く。送らなかったときも入力の保留を解く'` の後に足す。

```ts
  it('claude の画面の末尾が許可待ちなら何も書かず、許可待ちの理由を出してパネルを開く', async () => {
    const controller = controllerWithEmptyInput()
    controller.screen = agentScreen('permission').lines
    const onSettled = vi.fn()
    const { result } = renderHook(() =>
      useAgentPromptSender({ isInterrupting: notInterrupting, onSettled, clock })
    )
    let outcome: AgentPromptSendResult | undefined
    await act(async () => {
      outcome = await result.current.send('hello', {
        slotId: 'a',
        controller,
        describeSession: noSession,
        cliKind: 'claude'
      })
    })
    expect(outcome).toEqual({ kind: 'failed', reason: 'screen-permission' })
    expect(controller.writes).toEqual([])
    expect(result.current.error).toBe(agentSendBlockedByActivityReason('permission', 'claude'))
    expect(onSettled).toHaveBeenCalledOnce()
    // 溜めた入力は無い(beginSending と同じ同期の区間で断る)ので、捨てても添え書きは付かない
    expect(controller.endSending).toHaveBeenCalledExactlyOnceWith({ discard: true })
  })

  it('claude へ貼り付けた後に許可待ちになったら Enter を書かず、溜めた入力を捨てて添え書きを付ける', async () => {
    // 表示中の行は空の入力欄から始め、貼り付けを書いた時点で(本文が入力欄に現れる前に)画面の末尾を許可の確認に替える
    const controller = makeFakeController()
    const border = makeLine('─'.repeat(40))
    controller.viewport = [border, makeLine('❯\xa0 ', [], [[2, 3]]), border]
    const write = controller.writeToSession
    controller.writeToSession = (data) => {
      write(data)
      if (data.startsWith('\x1b[200~')) controller.screen = agentScreen('permission').lines
    }
    // 捨てた入力の数が 0 だと添え書きが付かず、配線を確かめられない
    controller.endSending.mockImplementation((options) => (options?.discard === true ? 2 : 0))
    const { result } = renderHook(() =>
      useAgentPromptSender({ isInterrupting: notInterrupting, onSettled: vi.fn(), clock })
    )
    await act(async () => {
      await result.current.send('hello', {
        slotId: 'a',
        controller,
        describeSession: noSession,
        cliKind: 'claude'
      })
    })
    expect(controller.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, buildAgentPasteBytes('hello')])
    expect(controller.endSending).toHaveBeenCalledExactlyOnceWith({ discard: true })
    expect(result.current.error).toBe(
      `${agentSendBlockedByActivityReason('permission', 'claude')}${AGENT_SEND_HELD_INPUT_DISCARDED_SUFFIX}`
    )
  })

  it('claude のほかの失敗(not-echoed)では、今までどおり溜めた入力を流す', async () => {
    // 貼り付けても本文が現れず、画面の末尾も許可の確認にならない(screen は [] で判定は unknown)
    const controller = makeFakeController()
    const border = makeLine('─'.repeat(40))
    controller.viewport = [border, makeLine('❯\xa0 ', [], [[2, 3]]), border]
    controller.endSending.mockImplementation((options) => (options?.discard === true ? 2 : 0))
    const { result } = renderHook(() =>
      useAgentPromptSender({ isInterrupting: notInterrupting, onSettled: vi.fn(), clock })
    )
    await act(async () => {
      await result.current.send('hello', {
        slotId: 'a',
        controller,
        describeSession: noSession,
        cliKind: 'claude'
      })
    })
    expect(controller.endSending).toHaveBeenCalledExactlyOnceWith({ discard: false })
    expect(result.current.error).toBe(agentSendFailureMessage('not-echoed', 'claude'))
  })
```

（`buildAgentPasteBytes`・`AGENT_CLEAR_INPUT_CHUNK`・`AGENT_SEND_HELD_INPUT_DISCARDED_SUFFIX`・`agentSendBlockedByActivityReason`・`agentSendFailureMessage`・`AgentPromptSendResult` は既存の import にある。偽の `endSending` のモックの引数の型は `AgentTerminalController['endSending']` の `options?: { discard: boolean }`。）

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/agentPromptSendSpecs.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`
Expected: FAIL（表のテストと、`discard: true` を期待する 2 件が `discard: false` で落ちる。`not-echoed` の 1 件は通る）

- [ ] **Step 3: 表を直す**

`src/renderer/src/lib/agentPromptSendSpecs.ts` の `claude` の行を次にする。

```ts
  claude: {
    requiresIdle: false,
    send: sendClaudePrompt,
    discardHeldInputOn: new Set(['screen-permission', 'screen-confirm'])
  },
```

JSDoc を直す:
- `requiresIdle` の JSDoc を次にする: 「入力待ちを求めるか。true の種類(copilot)は、作業中・判定できない間と中断の流れの間も押せない(作業中の Enter が勝手に送られる送信待ちになり、中断が Esc 2 回のため)。false の種類(claude)は作業中の Enter を送信待ちに積むので作業中も押せる。利用者の操作を待っている活動(許可待ち・確認待ち)は、この値に依らずどの種類でも押せない(設計書 2026-11-07)。押せる条件は promptRunAvailability.ts、押した時点の中断の守りは useAgentPromptSender が引く」
- `discardHeldInputOn` の JSDoc の「claude は空(今のまま流す。同じ経路が残ることは ROADMAP の既知の制約)」を「claude は許可待ち・確認待ちで止めたとき(screen-permission・screen-confirm)だけ捨てる(溜めた打鍵が選択の画面への答えにならないように。設計書 2026-11-07)。ほかの失敗は今のまま流す(同じ経路が残ることは ROADMAP の既知の制約)」に直す。

- [ ] **Step 4: テストが通ることを確かめ、戻すと落ちることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/agentPromptSendSpecs.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`
Expected: PASS

`git stash push src/renderer/src/lib/agentPromptSendSpecs.ts` → 同じコマンドで Step 1 の表のテストと `discard: true` の 2 件が落ちることを確かめる → `git stash pop`。

- [ ] **Step 5: lint と型を通す**

Run: `npx eslint src/renderer/src/lib/agentPromptSendSpecs.ts src/renderer/src/lib/__tests__/agentPromptSendSpecs.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 4: ROADMAP・README の更新、実機テスト仕様書への追記と既存の項目の直し、全体の検証

**Files:**
- Modify: `ROADMAP.md`
- Modify: `README.md`
- Modify: `docs/manual-test-spec.md`
- 生成: `.superpowers/manual-test-spec.html`（`node scripts/build-manual-test-spec.mjs`）

**Interfaces:**
- Consumes: Task 1〜3 の挙動と、`lib/agentSendMessages.ts` の `AGENT_SEND_BLOCKED_BY_ACTIVITY` の文（`claude が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）`・`claude が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）`）

**気をつける点:**
- 仕様書の文言は、実装の文言（`lib/agentSendMessages.ts`）と一字一句照らし合わせてから書く。既存の項目の ID は変えない
- 実機での確認の手順はこのタスクに書かない（利用者が仕様書の ID でまとめて確かめる）
- 過去の状態は過去形で書く（CLAUDE.md「ドキュメントの同期管理」）

- [ ] **Step 1: ROADMAP を更新する**

1. 「危険な操作の承認フロー」の `- 実装済み（2026-11-06。…）` の行の「残り:」の列挙から `・許可待ちの画面での \`claude\` へのプロンプトの送信を断る（今は \`実行\` を押せ、送信の \`Enter\` が既定の選択肢で答えうる。以前からの挙動）` を消す（列挙の最後は `自動の承認` になる）。その行の次に、同じ字下げで足す:

```markdown
      - 実装済み（2026-11-07。設計書 `docs/superpowers/specs/2026-11-07-agent-send-block-on-permission-design.md`）: 許可待ち・確認待ちの `claude` へのプロンプトの送信を断る（それまでは `実行` を押せ、送信の `Enter` が既定の選択肢で答えうった）。実装済み機能の「エージェントの許可の確認への帯からの答え」を参照
```

2. 「実装済み機能」の `### エージェントの許可の確認への帯からの答え` の箇条書き（`- [x] 専用の IPC …` の行）の後に足す:

```markdown
- [x] 許可待ち・確認待ちの間は、`claude` へもプロンプトを送らない（2026-11-07。設計書 `docs/superpowers/specs/2026-11-07-agent-send-block-on-permission-design.md`）。プロンプトの `実行`・履歴の `再実行`・送信前の確認の `送信` を押せず、`claude が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）`（確認待ちは `確認待ちのため`）を出す。押した後も、送信の手順の最初と消去・貼り付け・`Enter` を書く直前に画面の末尾を読み直し、許可待ち・確認待ちなら止める（`Enter` を送らない）。そこで止めたときは、送信の間に溜めたキー入力を送らずに捨てる。`claude` の作業中の送信（送信待ちに積む）は変えていない。それまでは `claude` では活動を見ず、許可待ちの間も押せた
```

同じ節の「既知の制約（設計書の「既知の制約」と同じ）:」の箇条書きの最後に足す:

```markdown
- 許可待ち・確認待ちの送信の守りは、画面に映った時点のもので、`claude` が許可の確認を出してから画面に映るまでの間（数 ms〜数十 ms）に書いたキーは、許可の確認に届きうる（作業中の `claude` へ送るときだけ）
- ターミナルで答えて入力欄が戻った後も、最大 150ms（出力が続けば最大 500ms）は `実行` などを押せない（活動の判定の待ち）
```

3. 「copilot へのプロンプトの送信（段階 2b）」の節の、溜めた入力の行（`- [x] 送信の手順の間に利用者がターミナルで打ったキー入力は溜めて…`）の末尾の `` `claude` は変えていない（下の MVP の既知の制約） `` を次に替える:

```markdown
`claude` は、当時は変えていなかった。2026-11-07（設計書 `docs/superpowers/specs/2026-11-07-agent-send-block-on-permission-design.md`）から、`claude` は許可待ち・確認待ちで止めたときだけ溜めた入力を捨てる。ほかの失敗では今のまま流す（下の MVP の既知の制約）
```

4. 「MVP: エージェント CLI のアプリ内ターミナル実行」の既知の制約の `  - \`claude\` では、貼り付けの後に本文が入力欄に入ったかを確かめられなかった失敗…` の行の末尾の `` `claude` の挙動は変えていない `` を次に替える:

```markdown
`claude` の挙動は、当時は変えていなかった。2026-11-07（設計書 `docs/superpowers/specs/2026-11-07-agent-send-block-on-permission-design.md`）から、`claude` は許可待ち・確認待ちで止めたときだけ溜めた入力を捨てる。ほかの失敗（この行の失敗を含む）では今のまま流す
```

- [ ] **Step 2: README を更新する**

`README.md` の機能の一覧の「エージェント CLI の実行（既定の実行方式）」の項の 3 行目 `完了・許可待ちの通知、中断、許可の確認への帯の 許可・拒否 での答え、セッションの再開に対応しています。` の後ろに、同じ行で `許可待ち・確認待ちの間は、プロンプトを送信しません（答えてから送ります）。` を足す。`docs/developer-guide.md` は変えない。

- [ ] **Step 3: 実機テスト仕様書の既存の項目を直す（ID は変えない）**

`docs/manual-test-spec.md` の次の項目を、ID を変えずに直す。

- **AGT-017** を次にする:

```markdown
- [ ] **AGT-017** 信頼していない新しいフォルダを開いて `起動` し、信頼の確認の画面が出ている間にプロンプトの `実行` にマウスを載せてから押す → `実行` は薄い色で、`claude が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）` が出る。押しても選択肢は確定されない（`claude` は終了しない）
```

- **AGT-018** を次にする:

```markdown
- [ ] **AGT-018** `claude` で `/model` の選択の画面を開いた状態でプロンプトの `実行` にマウスを載せてから押す → `実行` は薄い色で、`claude が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）` が出る。押しても画面の選択肢は変わらない。確認待ちと判定されず `エージェントの入力欄が見つかりません…` が出たら、そのことを記録する
```

- **AGT-019** を次にする:

```markdown
- [ ] **AGT-019** エージェントがツールの許可の確認（`Do you want to proceed?`）を出している間にプロンプトの `実行` にマウスを載せてから押す → `実行` は薄い色で、`claude が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）` が出る。押しても選択肢は確定されない
```

- **AGT-042** を次にする:

```markdown
- [ ] **AGT-042** ログインの方法の選択の画面（未ログインの環境、または `/login` を開いた状態）でプロンプトの `実行` にマウスを載せてから押す → `実行` は薄い色で、`claude が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）` が出る。押しても何も送られない（選択肢が確定されずブラウザが開かない）。確認待ちと判定されず `エージェントの入力欄が見つかりません…` が出たら、そのことを記録する
```

- **AGT-043** を次にする:

```markdown
- [ ] **AGT-043** 起動の直後に `Try the new fullscreen renderer?` などの案内の画面が出たら、その間にプロンプトの `実行` にマウスを載せてから押す → `実行` は薄い色で、`claude が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）` が出る。押しても選択肢は確定されない（`Yes, try it` が選ばれない）（案内が出なければ確認できなかったと記録する）
```

AGT-167・AGT-186・AGT-202・AGT-212・AGC-045 は、`/model` の選択の画面の代わりに、次の手順（以下「スクロールの手順」）で送信を失敗させる。「スクロールの手順」の文はそれぞれの項目の中に書き下す（仕様書は項目ごとに読まれるため、別の項目を参照しない）:

> `claude 1` に `1 から 100 までの数を 1 行に 1 つずつ書き出して` を送り、答えが終わって `入力待ち` になるのを待つ。ターミナルの上でマウスのホイールを上へ回し、表示中の行に数の行だけが見える所（入力欄と罫線が画面に無い所）まで上げ、そのままにする

- **AGT-167**: 先頭の「`claude 1` で `/model` の選択の画面を出してから」を「スクロールの手順」の文（「…そのままにしてから」）に替える。期待結果の末尾の「続けて `Enter`・数字キーを押しても画面の選択肢は変わらない（もう一度ダイアログが開き、プロンプトパネルの失敗の文言は消える。`キャンセル` で閉じる）」を「続けて `Enter` を押すと、`claude 1` の入力欄には何も入らず、もう一度ダイアログが開き、プロンプトパネルの失敗の文言は消える（`キャンセル` で閉じる）。送れてしまった（`エージェントに送信しました` が出た）ときは、そのことと、そのときのターミナルの表示を記録する。確かめたらターミナルを末尾までスクロールして戻す」に替える。
- **AGT-186**: 「`claude 1` で `/model` の選択の画面を出してから」を「スクロールの手順」の文に替える。後始末の「ターミナルの `claude 1` をクリックしてから `Esc` で `claude` の選択の画面を閉じ、」を「ターミナルを末尾までスクロールして戻し、」に替える。期待結果の後に「送れてしまったときは、そのことと、そのときのターミナルの表示を記録する」を足す。
- **AGT-202**: 「`claude 1` で `/model` の選択の画面を出したまま」を「スクロールの手順」の文（「…そのままにして」）に替える。後始末の「ターミナルの `claude 1` をクリックしてから `Esc` で選択の画面を閉じる」を「ターミナルを末尾までスクロールして戻す」に替える。期待結果の後に「送れてしまったときは、そのことと、そのときのターミナルの表示を記録する」を足す。
- **AGT-212**: 「`/model` の選択の画面を出しておき、」を「スクロールの手順」の文（「…そのままにしておき、」）に替える。期待結果の「（画面の選択肢は変わらない。`キャンセル` で閉じると、フォーカスは同じ `再実行` に戻る）」を「（`claude 1` の入力欄には何も入らない。`キャンセル` で閉じると、フォーカスは同じ `再実行` に戻る）」に替える。後始末の「`Esc` で `/model` の画面を閉じる」を「ターミナルを末尾までスクロールして戻す」に替える。期待結果の後に「送れてしまったときは、そのことと、そのときのターミナルの表示を記録する」を足す。
- **AGC-045**: 手順の順を「設定の確認 → `claude 1` に `1 から 100 までの数を 1 行に 1 つずつ書き出して` を送って `入力待ち` を待つ → `表示` の項目の数を数える → `実行` → `キャンセル` → ターミナルの上でホイールを上へ回して数の行だけが見える所まで上げたまま `実行` → `送信`」に組み直す。期待結果はそのまま。後始末の「`claude` の画面をクリックして `Esc` で選択の画面を閉じる」を「ターミナルを末尾までスクロールして戻す」に替える。期待結果の後に「送れてしまったときは、そのことと、そのときのターミナルの表示を記録する」を足す。

- [ ] **Step 4: 実機テスト仕様書に新しい項目を足す**

最大の ID を確かめる: `grep -o 'AGT-[0-9]*' docs/manual-test-spec.md | sort -t- -k2 -n | tail -1`（このプランを書いた時点では `AGT-313`。違えばその次から振り、下の ID をずらす）。

`## エージェント CLI のアプリ内ターミナル` の末尾（`### ターミナルを上へスクロールしているときの許可` の最後の項目の後、`## エージェントの変更の確認` の前）に足す。

```markdown
### 許可待ち・確認待ちの間の送信

> 前提: エージェント CLI 方式で、テスト用のフォルダを開いて `claude 1` を起動し、`入力待ち` にしてある。設定の `送信前の確認` はオン（既定）。`claude` の許可の確認は、ターミナルの入力欄に `Bash で sleep 3 を実行して` を入力して `Enter` で送って出す。許可の確認が出ずに実行された（設定で許可済み）ときは、そのことを記録して、その項目を飛ばす。

- [ ] **AGT-314** `claude` の許可の確認を出し、帯が `許可待ち` になったら、プロンプトの `挨拶` の `実行` にマウスを載せてから押す → `実行` は薄い色で、`claude が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）` が出る。押しても送信前の確認は開かず、許可の確認の選択肢は変わらない（`sleep 3` は実行されない）。続けて帯の `拒否` を押して入力待ちに戻すと、`実行` が押せる色に戻る
- [ ] **AGT-315** 「実行履歴」にエージェントの項目がある状態で、`claude` の許可の確認を出し、履歴の詳細の `再実行` にマウスを載せてから押す → `再実行` は薄い色で、AGT-314 と同じ文言が出る。押しても何も送られず、許可の確認は残る。確かめた後、帯の `拒否` で答える
- [ ] **AGT-316** ターミナルの入力欄に `まず 5 秒考えてから、Bash で sleep 3 を実行して` を入力して `Enter` で送り、帯が `作業中` の間にプロンプトの `挨拶` の `実行` を押して送信前の確認を開き、そのまま許可の確認が出るまで待つ → 確認を開いた時点では `送信` が押せ、許可の確認が出ると `送信` が薄い色になり、確認の中に AGT-314 と同じ文言が出る。`送信` を押しても何も送られない。`キャンセル` で閉じてから帯の `拒否` で答える。許可の確認が出る前に作業が終わったときは、そのことを記録する
- [ ] **AGT-317** `claude` の許可の確認を出し、帯の `許可` で答えて帯が `作業中` になったら、すぐにプロンプトの `挨拶` の `実行` を押し、確認で `送信` を押す → 作業中の間は送れ、作業は中断されず、本文は送信待ちに入る（`Press up to edit queued messages`。AGT-010 と同じ）
```

- [ ] **Step 5: HTML を作り直し、仕様書の検査を通す**

Run: `node scripts/build-manual-test-spec.mjs`
Expected: `.superpowers/manual-test-spec.html` が作り直される（エラー無し）

Run: `NODE_ENV=test npx vitest run scripts`
Expected: PASS（ID の一意性・接頭辞ごとの連番が昇順・書式）

- [ ] **Step 6: 全体の検証**

Run: `NODE_ENV=test npm test`
Expected: PASS

Run: `npm run typecheck`
Expected: エラー無し

Run: `npx eslint . --max-warnings 0`
Expected: エラー・警告無し

Run: `npm run build`
Expected: 成功

設計書の「既知の制約」と ROADMAP の既知の制約に食い違いがあれば、ROADMAP を設計書に合わせる。
