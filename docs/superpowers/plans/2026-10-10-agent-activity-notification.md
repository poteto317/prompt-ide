# エージェントの完了・許可待ちの通知 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ウィンドウが背面のときに `claude` が許可待ち・確認待ちになった／作業を終えたことを OS の通知・Dock のバッジ（Windows・Linux はタスクバーの点滅）で知らせ、通知を押すとそのタブのターミナルへ戻れるようにし、状態の変化を常設の `aria-live` で読み上げる。

**Architecture:** 文言の表とタブの名前は main と renderer が共有する `src/shared/` に置く。renderer はタブごとの「最後の確かな活動」の変化から出来事を決める純粋な関数（`agentNotificationEvents.ts`）を使い、`useAgentNotifications` が読み上げの文言・通知の依頼・バッジの数を main へ送る。main は通知の記録を持つ `createAgentNotificationCenter`（Electron の `Notification`・`app.dock`・`BrowserWindow` は依存として注入）と、ウィンドウの寿命の後始末（`agentNotificationLifecycle.ts`）、入力を検証する IPC の受け口を持つ。タブへ移る処理は `useAgentStatusBar` から `useAgentTabActivation` に切り出し、ステータスバーと通知の両方で使う。

**Tech Stack:** Electron（`Notification`・`app.dock.setBadge`・`BrowserWindow.flashFrame`）, React 19, TypeScript, Vitest, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-10-agent-activity-notification-design.md`（実装の前に必ず読む）

> **計画の時点で設計書から調整した細部（設計書もこれに合わせて直した。実装の前に読む）:**
> - `AgentNotificationKind` は main（入力の検証）と renderer の両方が使うため、定義を `src/shared/types/agentNotification.ts` に置き、`src/renderer/src/lib/agentNotificationEvents.ts` は型を再 export する（設計書は lib に置くと書いている）。
> - リロードの検知は `did-start-navigation` ではなく、既存の `onMainFrameDocumentReplaced`（`src/main/mainFrameDocumentReplaced.ts`）を使う。同じファイルの注記のとおり、Electron 39 の `did-start-navigation` は `will-navigate` で止めた遷移（ファイルのドロップなど）でも届き、ページが残ったまま通知を閉じてしまうため。
> - ウィンドウが閉じたときは、通知を閉じるのに加えて Dock のバッジも 0 に戻す（renderer のアンマウントの後始末は、ウィンドウを閉じると届かないことがあり、macOS ではアプリが残るため古いバッジが残る。1 ウィンドウの前提の範囲の後始末）。
> - 読み上げの領域の class は `sr-only` ではなく `agent-announcer`（このリポジトリには `sr-only` が無く、既存の常設の `aria-live` は BEM の class に隠す規則を当てている〈`main.css` の `.external-change-banner__live, .agent-diff__live`〉）。
> - `useAgentNotifications` の入力の `number` のため、`AgentSessionTabView` に `number: number` を足す（今は `label` しか持たない）。
> - 同じ描画で複数のタブの出来事が起きたときは、読み上げの文言を `。` でつなぐ（片方を落とさない）。


> **注（実装の後のローカルレビューで変わったこと。コード例は実装を始めた時点のまま残している。今の振る舞いは設計書と実装を正とする）:**
> - `AgentNotificationHandle.onClose` を廃止し、通知の close の知らせでは記録から外さないようにした（Windows ではトーストのタイムアウトでも close が届き、外すとアクションセンターに通知が積み上がるため。記録から外す契機は設計書「main」の節）。
> - フォーカスがある・通知に対応していないときの `show` も、同じタブの前の通知を閉じ、残る通知が無ければ点滅を止める。
> - `agentNotification:dismiss` を追加した（閉じたタブ・待っている状態の終わり〈`finishedWaiting`〉・通知を出さない出来事・従来の方式への切り替え）。
> - `useAgentNotifications` に `isAgentMode` を足し、従来の方式では知らせず、バッジを 0 にし、押してもタブへ移らない。
> - 設定の節は `role="group"` と `aria-labelledby` で節の名前をチェックボックスに結び付け、説明にタスクバーの点滅を足した。

## Global Constraints

- コメント・文言は日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`
- 出来事の型: `type AgentNotificationKind = 'permission' | 'confirm' | 'done'`（定数 `AGENT_NOTIFICATION_KINDS`）
- 文言（`claude 2` は `formatAgentTabLabel(2)`）:
  - `permission`: 題 `claude 2: 許可待ち`、本文 `ツールの実行の許可を待っています`、読み上げ `claude 2 が許可待ちになりました`
  - `confirm`: 題 `claude 2: 確認待ち`、本文 `選択を待っています`、読み上げ `claude 2 が確認待ちになりました`
  - `done`: 題 `claude 2: 作業が終わりました`、本文 `次の指示を待っています`、読み上げ `claude 2 の作業が終わりました`
- 出来事の規則: 最後の確かな活動（`unknown` を除いた直近の活動）→ 新しい活動。`permission` 以外 → `permission`、`confirm` 以外 → `confirm`、`working` → `idle` だけを知らせる。`unknown` は最後の確かな活動を変えない。起動の直後（最後の確かな活動が無い）の `idle` は知らせず、`confirm` は知らせる
- 知らせない: `running` でないタブ（記録を忘れる）、閉じる途中のタブ（`isClosing`）、最後の確かな活動と同じ活動
- IPC のチャンネル: `agentNotification:show`（`{ slotId, tabNumber, kind }`、invoke）、`agentNotification:setBadge`（`{ count }`、invoke）、`agentNotification:activated`（main → renderer、`{ slotId }`）、`settings:getAgentNotificationsEnabled`・`settings:setAgentNotificationsEnabled`
- 入力の検証: `slotId` は `AGENT_SLOT_ID_PATTERN`、`tabNumber` は 1〜`AGENT_MAX_SESSIONS_PER_WINDOW` の整数、`kind` は 3 つのどれか、`count` は 0〜`AGENT_MAX_SESSIONS_PER_WINDOW` の整数。違えば例外。`agentNotification:*` はメインフレームからの依頼だけを受ける（`isMainFrameSender`）
- 設定: 既定はオン（`DEFAULT_AGENT_NOTIFICATIONS_ENABLED = true`）。`settings.json` の `agentNotificationsEnabled`。オフなら OS の通知もバッジも出さない（読み上げは続ける）
- 設定画面の文言: 見出し `エージェントの通知`、チェックボックス `ウィンドウが背面のとき、許可待ち・確認待ち・作業の完了を通知する`、説明 `Dock のバッジ（macOS）も、この設定でまとめてオン・オフします。通知が出ないときは、OS の通知の設定も確かめてください`
- `AppUserModelId` は `electron-builder.yml` の `appId`（`com.electron.app`）と同じ値
- テストのタイマーは後始末で必ず解除する（CLAUDE.md）。`act(...).then(...)` で書かない。`console.warn`・`console.error` の spy は `afterEach` で戻す
- 気をつける知見（dev-flow-kit の review-lessons.md）: **L-019**（通知の文字列は main の固定の表から作る。renderer の文字列を通知に出さない）、**L-023**（`tabNumber` と `slotId` の食い違いは通知の題にしか影響しない範囲に限る）、**L-053**（前の通知の `close` などの途中の例外で後続〈新しい通知・送信・後始末〉を止めない）、**L-059**（`Notification`・`app.dock` はモックするので、実物の表示は実機テスト仕様書で確かめる）、**L-399**（活動の判定のデバウンス〈`AGENT_ACTIVITY_SETTLE_MS`・`AGENT_ACTIVITY_MAX_WAIT_MS`〉は既存のまま使い、変えない）、**L-393**（閉じる途中のタブをバッジの数に数えない）、**L-156**（見える文字と読み上げの一致。チェックボックスの名前は見えているラベルそのもの）
- **コミットしない。** 各タスクの最後は検証だけ（`npx vitest run <変更したテスト>`、`npm run typecheck`、変更した TypeScript のファイルへの `npx eslint --max-warnings 0`）
- `react-hooks/set-state-in-effect`（eslint-plugin-react-hooks 7）: effect の本体で setState を直接呼ぶと lint が落ちる。外部（IPC）への送信と組みで state を変える effect では、既存（`useAgentActivity` の `commit`、`useGitStashes`）と同じく effect 内のローカル関数から呼ぶ

---

### Task 1: 共有の文言の表・タブの名前と、出来事の決定（純粋な関数）

**Files:**
- Create: `src/shared/agentTabLabel.ts`
- Create: `src/shared/types/agentNotification.ts`
- Modify: `src/shared/types.ts`（`export type *` と値の export を足す）
- Create: `src/shared/agentNotificationText.ts`
- Modify: `src/renderer/src/lib/agentSessionMessages.ts`（`formatAgentTabLabel` を共有から再 export する）
- Create: `src/renderer/src/lib/agentNotificationEvents.ts`
- Test: `src/shared/__tests__/agentTabLabel.test.ts`（新規）、`src/shared/__tests__/agentNotification.test.ts`（新規）、`src/shared/__tests__/agentNotificationText.test.ts`（新規）、`src/renderer/src/lib/__tests__/agentNotificationEvents.test.ts`（新規）、既存の `src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`（変えずに通ること）

**Interfaces:**
- Consumes: `AgentActivity`（`src/renderer/src/lib/agentActivity.ts`）
- Produces:
```ts
// src/shared/agentTabLabel.ts
export function formatAgentTabLabel(number: number): string // 'claude 2'
// src/shared/types/agentNotification.ts(@shared/types から export)
export const AGENT_NOTIFICATION_KINDS: readonly ['permission', 'confirm', 'done']
export type AgentNotificationKind = 'permission' | 'confirm' | 'done'
export function isAgentNotificationKind(value: unknown): value is AgentNotificationKind
export interface AgentNotificationShowRequest { slotId: string; tabNumber: number; kind: AgentNotificationKind }
export interface AgentNotificationBadgeRequest { count: number }
export interface AgentNotificationActivated { slotId: string }
// src/shared/agentNotificationText.ts
export interface AgentNotificationText { title: string; body: string; announcement: string }
export function agentNotificationText(kind: AgentNotificationKind, tabNumber: number): AgentNotificationText
// src/renderer/src/lib/agentNotificationEvents.ts
export type { AgentNotificationKind }
export interface AgentNotificationDecision { kind: AgentNotificationKind | null; settled: AgentActivity | null }
export function nextAgentNotification(lastSettled: AgentActivity | null, next: AgentActivity): AgentNotificationDecision
```

- [ ] **Step 1: 失敗するテストを書く**

`src/shared/__tests__/agentTabLabel.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { formatAgentTabLabel } from '../agentTabLabel'

describe('formatAgentTabLabel', () => {
  it('タブの番号から claude N を作る', () => {
    expect(formatAgentTabLabel(1)).toBe('claude 1')
    expect(formatAgentTabLabel(4)).toBe('claude 4')
  })
})
```

`src/shared/__tests__/agentNotification.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { AGENT_NOTIFICATION_KINDS, isAgentNotificationKind } from '@shared/types'

describe('isAgentNotificationKind', () => {
  it.each(AGENT_NOTIFICATION_KINDS)('%s は出来事', (kind) => {
    expect(isAgentNotificationKind(kind)).toBe(true)
  })
  it.each(['working', 'idle', '', null, 1, undefined])('%s は出来事でない', (value) => {
    expect(isAgentNotificationKind(value)).toBe(false)
  })
  it('出来事は 3 つ', () => {
    expect(AGENT_NOTIFICATION_KINDS).toEqual(['permission', 'confirm', 'done'])
  })
})
```

`src/shared/__tests__/agentNotificationText.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { agentNotificationText } from '../agentNotificationText'

describe('agentNotificationText', () => {
  it.each([
    [
      'permission',
      {
        title: 'claude 2: 許可待ち',
        body: 'ツールの実行の許可を待っています',
        announcement: 'claude 2 が許可待ちになりました'
      }
    ],
    [
      'confirm',
      {
        title: 'claude 2: 確認待ち',
        body: '選択を待っています',
        announcement: 'claude 2 が確認待ちになりました'
      }
    ],
    [
      'done',
      {
        title: 'claude 2: 作業が終わりました',
        body: '次の指示を待っています',
        announcement: 'claude 2 の作業が終わりました'
      }
    ]
  ] as const)('%s の題・本文・読み上げ', (kind, expected) => {
    expect(agentNotificationText(kind, 2)).toEqual(expected)
  })
})
```

`src/renderer/src/lib/__tests__/agentNotificationEvents.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { AgentActivity } from '../agentActivity'
import type { AgentNotificationKind } from '../agentNotificationEvents'
import { nextAgentNotification } from '../agentNotificationEvents'

/** 起動の直後(記録なし)から活動を順に流し、知らせた出来事を並べる */
function replay(activities: readonly AgentActivity[]): AgentNotificationKind[] {
  let settled: AgentActivity | null = null
  const kinds: AgentNotificationKind[] = []
  for (const activity of activities) {
    const decision = nextAgentNotification(settled, activity)
    settled = decision.settled
    if (decision.kind !== null) kinds.push(decision.kind)
  }
  return kinds
}

describe('nextAgentNotification', () => {
  it.each<[AgentActivity | null, AgentActivity, AgentNotificationKind | null, AgentActivity | null]>([
    // 許可待ち: permission 以外 → permission
    ['working', 'permission', 'permission', 'permission'],
    ['idle', 'permission', 'permission', 'permission'],
    ['confirm', 'permission', 'permission', 'permission'],
    // 確認待ち: confirm 以外 → confirm
    ['working', 'confirm', 'confirm', 'confirm'],
    ['permission', 'confirm', 'confirm', 'confirm'],
    // 作業の完了: working → idle だけ
    ['working', 'idle', 'done', 'idle'],
    ['permission', 'idle', null, 'idle'],
    ['confirm', 'idle', null, 'idle'],
    // 同じ活動が続く間は 1 回だけ
    ['permission', 'permission', null, 'permission'],
    ['confirm', 'confirm', null, 'confirm'],
    ['idle', 'idle', null, 'idle'],
    // 作業中になっただけでは知らせない
    ['idle', 'working', null, 'working'],
    // unknown は最後の確かな活動を変えない
    ['working', 'unknown', null, 'working'],
    [null, 'unknown', null, null],
    // 起動の直後: idle は知らせず、confirm・permission は知らせる
    [null, 'idle', null, 'idle'],
    [null, 'confirm', 'confirm', 'confirm'],
    [null, 'permission', 'permission', 'permission'],
    [null, 'working', null, 'working']
  ])('%s → %s は %s(次に覚えるのは %s)', (lastSettled, next, kind, settled) => {
    expect(nextAgentNotification(lastSettled, next)).toEqual({ kind, settled })
  })

  it('unknown を挟んだ working → unknown → permission は許可待ちとして知らせる', () => {
    expect(replay(['working', 'unknown', 'permission'])).toEqual(['permission'])
  })

  it('working → unknown → idle は作業の完了として知らせる', () => {
    expect(replay(['working', 'unknown', 'idle'])).toEqual(['done'])
  })

  it('permission → unknown → permission は 1 回だけ知らせる', () => {
    expect(replay(['permission', 'unknown', 'permission'])).toEqual(['permission'])
  })

  it('permission → working → permission は 2 回目も知らせる', () => {
    expect(replay(['permission', 'working', 'permission'])).toEqual(['permission', 'permission'])
  })

  it('起動の直後の idle は知らせず、その後の作業の完了は知らせる', () => {
    expect(replay(['idle', 'working', 'idle'])).toEqual(['done'])
  })
})
```

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `npx vitest run src/shared/__tests__/agentTabLabel.test.ts src/shared/__tests__/agentNotification.test.ts src/shared/__tests__/agentNotificationText.test.ts src/renderer/src/lib/__tests__/agentNotificationEvents.test.ts`
Expected: FAIL（モジュール・export が無い）

- [ ] **Step 3: 実装する**

`src/shared/agentTabLabel.ts`:
```ts
// エージェントのタブの名前。renderer のタブの表示と、main の OS の通知の題で同じ文言を使う(文言を二重に持たない)

/** タブのラベル(番号の振り方は renderer の agentSessionTabs の AgentSessionTab.number) */
export function formatAgentTabLabel(number: number): string {
  return `claude ${number}`
}
```

`src/shared/types/agentNotification.ts`:
```ts
// エージェントの完了・許可待ちの通知の IPC の型。main・preload・renderer が共有する

/** 知らせる出来事(許可待ち・確認待ち・作業の完了) */
export const AGENT_NOTIFICATION_KINDS = ['permission', 'confirm', 'done'] as const
export type AgentNotificationKind = (typeof AGENT_NOTIFICATION_KINDS)[number]

export function isAgentNotificationKind(value: unknown): value is AgentNotificationKind {
  return typeof value === 'string' && (AGENT_NOTIFICATION_KINDS as readonly string[]).includes(value)
}

/** agentNotification:show の入力。題・本文は main が固定の表から作る(renderer の文字列を通知に出さない) */
export interface AgentNotificationShowRequest {
  slotId: string
  /** タブの番号(題の claude N にだけ使う) */
  tabNumber: number
  kind: AgentNotificationKind
}

/** agentNotification:setBadge の入力(利用者の操作を待っているタブの数) */
export interface AgentNotificationBadgeRequest {
  count: number
}

/** agentNotification:activated(通知を押した)で main から届く */
export interface AgentNotificationActivated {
  slotId: string
}
```

`src/shared/types.ts` に足す（`export type * from './types/agentChanges'` の次の行と、値の export の末尾）:
```ts
export type * from './types/agentNotification'
```
```ts
export { AGENT_NOTIFICATION_KINDS, isAgentNotificationKind } from './types/agentNotification'
```

`src/shared/agentNotificationText.ts`:
```ts
import type { AgentNotificationKind } from './types/agentNotification'
import { formatAgentTabLabel } from './agentTabLabel'

// 通知の文言の表(設計書「知らせる出来事」)。OS の通知の題・本文は main がここから作り、renderer は読み上げだけを使う

export interface AgentNotificationText {
  /** OS の通知の題 */
  title: string
  /** OS の通知の本文 */
  body: string
  /** アプリ内の aria-live の読み上げ */
  announcement: string
}

/** 出来事ごとの文言。出来事を増やしたときに足し忘れを型エラーにするため Record で持つ */
const TEXTS: Record<AgentNotificationKind, (label: string) => AgentNotificationText> = {
  permission: (label) => ({
    title: `${label}: 許可待ち`,
    body: 'ツールの実行の許可を待っています',
    announcement: `${label} が許可待ちになりました`
  }),
  confirm: (label) => ({
    title: `${label}: 確認待ち`,
    body: '選択を待っています',
    announcement: `${label} が確認待ちになりました`
  }),
  done: (label) => ({
    title: `${label}: 作業が終わりました`,
    body: '次の指示を待っています',
    announcement: `${label} の作業が終わりました`
  })
}

export function agentNotificationText(
  kind: AgentNotificationKind,
  tabNumber: number
): AgentNotificationText {
  return TEXTS[kind](formatAgentTabLabel(tabNumber))
}
```

`src/renderer/src/lib/agentSessionMessages.ts`: 93〜96 行の `formatAgentTabLabel` の定義を消し、同じ場所に次を置く（呼び出し元の import は変えない）:
```ts
/** タブのラベル。main の OS の通知の題でも使うため共有に置き、ここから再 export する */
export { formatAgentTabLabel } from '@shared/agentTabLabel'
```

`src/renderer/src/lib/agentNotificationEvents.ts`:
```ts
import type { AgentNotificationKind } from '@shared/types'
import type { AgentActivity } from './agentActivity'

// タブの活動の変化から、知らせる出来事を決める純粋な関数(設計書「知らせる出来事」)。判定そのもの(agentActivity)は変えない

export type { AgentNotificationKind }

export interface AgentNotificationDecision {
  /** 知らせる出来事。知らせなければ null */
  kind: AgentNotificationKind | null
  /** 次に覚える最後の確かな活動(next が unknown なら lastSettled のまま) */
  settled: AgentActivity | null
}

/**
 * 最後の確かな活動(unknown を除いた直近の活動。起動の直後は null)と新しい活動から出来事を決める。
 * unknown は判定できなかっただけなので覚え直さない(working → unknown → permission も working → permission と同じ)。
 * 起動の直後の idle は知らせず、confirm(フォルダの信頼の確認など)・permission は利用者の操作が要るので知らせる
 */
export function nextAgentNotification(
  lastSettled: AgentActivity | null,
  next: AgentActivity
): AgentNotificationDecision {
  if (next === 'unknown') return { kind: null, settled: lastSettled }
  if (next === lastSettled) return { kind: null, settled: next }
  if (next === 'permission' || next === 'confirm') return { kind: next, settled: next }
  if (next === 'idle' && lastSettled === 'working') return { kind: 'done', settled: next }
  return { kind: null, settled: next }
}
```

- [ ] **Step 4: テストを通す・型チェック・lint**

Run: `npx vitest run src/shared src/renderer/src/lib/__tests__/agentNotificationEvents.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`
Expected: PASS
Run: `npm run typecheck`
Run: `npx eslint --max-warnings 0 src/shared/agentTabLabel.ts src/shared/agentNotificationText.ts src/shared/types/agentNotification.ts src/shared/types.ts src/renderer/src/lib/agentSessionMessages.ts src/renderer/src/lib/agentNotificationEvents.ts src/shared/__tests__/agentTabLabel.test.ts src/shared/__tests__/agentNotification.test.ts src/shared/__tests__/agentNotificationText.test.ts src/renderer/src/lib/__tests__/agentNotificationEvents.test.ts`
Expected: エラー・警告なし

---

### Task 2: main の通知・バッジ・点滅・後始末と IPC・preload・AppUserModelId

**Files:**
- Modify: `src/main/handlers/payloadValidators.ts`（`isIntegerInRange` を移して export）
- Modify: `src/main/handlers/agentTerminalPayloadParser.ts`（`isIntegerInRange` を import に変え、`parseAgentSlotId` を export して `parseAgentStartRequest` から使う。文言は変えない）
- Create: `src/main/handlers/agentNotificationPayloadParser.ts`
- Create: `src/main/agentNotifications.ts`（通知の記録・前面化・点滅・バッジ）
- Create: `src/main/agentNotificationLifecycle.ts`（ウィンドウのフォーカス・閉じる・リロードの後始末）
- Create: `src/main/handlers/agentNotificationHandlers.ts`
- Modify: `src/main/ipcHandlers.ts`（Electron の実物を注入して組み立てる）
- Create: `src/main/appIdentity.ts`、Modify: `src/main/index.ts`
- Modify: `src/preload/api.ts`・`src/preload/index.d.ts`、`src/renderer/src/__tests__/setup.ts`（`window.api` の既定の偽物）
- Test: `src/main/__tests__/handlers/payloadValidators.test.ts`、`src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts`（変えずに通る）、`src/main/__tests__/handlers/agentNotificationPayloadParser.test.ts`（新規）、`src/main/__tests__/agentNotifications.test.ts`（新規）、`src/main/__tests__/agentNotificationLifecycle.test.ts`（新規）、`src/main/__tests__/handlers/agentNotificationHandlers.test.ts`（新規）、`src/main/__tests__/ipcHandlers.test.ts`、`src/main/__tests__/appIdentity.test.ts`（新規）、`src/preload/__tests__/api.test.ts`

**Interfaces:**
- Consumes: Task 1 の `AgentNotificationShowRequest`・`AgentNotificationBadgeRequest`・`AgentNotificationActivated`・`isAgentNotificationKind`・`agentNotificationText`
- Produces:
```ts
// payloadValidators.ts
export function isIntegerInRange(value: unknown, min: number, max: number): value is number
// agentTerminalPayloadParser.ts
export function parseAgentSlotId(value: unknown): string
// agentNotificationPayloadParser.ts
export function parseAgentNotificationShowRequest(payload: unknown): AgentNotificationShowRequest
export function parseAgentNotificationBadgeRequest(payload: unknown): AgentNotificationBadgeRequest
// agentNotifications.ts
export interface AgentNotificationHandle { show(): void; close(): void; onClick(listener: () => void): void; onClose(listener: () => void): void }
export interface AgentNotificationWindow {
  isDestroyed(): boolean; isFocused(): boolean; isMinimized(): boolean
  restore(): void; show(): void; focus(): void; flashFrame(flag: boolean): void
  readonly webContents: Pick<WebContents, 'isDestroyed' | 'send'>
}
export interface AgentNotificationCenterDeps {
  platform: NodeJS.Platform
  isSupported: () => boolean
  createNotification: (options: { title: string; body: string }) => AgentNotificationHandle
  setDockBadge: (text: string) => void
}
export interface AgentNotificationCenter {
  show(window: AgentNotificationWindow, request: AgentNotificationShowRequest): void
  setBadge(count: number): void
  handleWindowFocus(window: AgentNotificationWindow): void
  clearWindow(window: AgentNotificationWindow): void
}
export function createAgentNotificationCenter(deps: AgentNotificationCenterDeps): AgentNotificationCenter
// agentNotificationLifecycle.ts
export function setupAgentNotificationLifecycle(app: App, center: Pick<AgentNotificationCenter, 'handleWindowFocus' | 'clearWindow' | 'setBadge'>): void
// agentNotificationHandlers.ts
export interface AgentNotificationHandlerDeps {
  center: Pick<AgentNotificationCenter, 'show' | 'setBadge'>
  windowOf: (sender: WebContents) => AgentNotificationWindow | null
}
export function registerAgentNotificationHandlers(ipcMain: IpcMain, deps: AgentNotificationHandlerDeps): void
// appIdentity.ts
export const APP_USER_MODEL_ID = 'com.electron.app'
// preload(window.api)
showAgentNotification(request: AgentNotificationShowRequest): Promise<void>
setAgentNotificationBadge(count: number): Promise<void>
onAgentNotificationActivated(listener: (payload: AgentNotificationActivated) => void): () => void
```

- [ ] **Step 1: 失敗するテストを書く（入力の検証）**

`src/main/__tests__/handlers/payloadValidators.test.ts` に足す（import に `isIntegerInRange` を足す）:
```ts
describe('isIntegerInRange', () => {
  it.each([
    [0, true],
    [4, true],
    [2, true],
    [-1, false],
    [5, false],
    [1.5, false],
    ['1', false],
    [Number.NaN, false],
    [null, false]
  ])('%s は 0〜4 の整数か: %s', (value, expected) => {
    expect(isIntegerInRange(value, 0, 4)).toBe(expected)
  })
})
```

`src/main/__tests__/handlers/agentNotificationPayloadParser.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { AGENT_MAX_SESSIONS_PER_WINDOW } from '@shared/types'
import {
  parseAgentNotificationBadgeRequest,
  parseAgentNotificationShowRequest
} from '../../handlers/agentNotificationPayloadParser'

const valid = { slotId: 'slot-1', tabNumber: 2, kind: 'permission' }

describe('parseAgentNotificationShowRequest', () => {
  it('検証を通った値だけを返す(余分なフィールドは捨てる)', () => {
    expect(parseAgentNotificationShowRequest({ ...valid, title: 'x' })).toEqual(valid)
  })
  it.each(['permission', 'confirm', 'done'])('kind %s を受ける', (kind) => {
    expect(parseAgentNotificationShowRequest({ ...valid, kind }).kind).toBe(kind)
  })
  it.each([1, AGENT_MAX_SESSIONS_PER_WINDOW])('tabNumber %s を受ける', (tabNumber) => {
    expect(parseAgentNotificationShowRequest({ ...valid, tabNumber }).tabNumber).toBe(tabNumber)
  })
  it.each([
    ['オブジェクトでない', null, '引数はオブジェクトである必要があります'],
    ['slotId が形式に合わない', { ...valid, slotId: 'a b' }, 'slotId は英数字とハイフン'],
    ['slotId が文字列でない', { ...valid, slotId: 1 }, 'slotId は英数字とハイフン'],
    ['tabNumber が 0', { ...valid, tabNumber: 0 }, 'tabNumber は 1〜'],
    ['tabNumber が上限を超える', { ...valid, tabNumber: AGENT_MAX_SESSIONS_PER_WINDOW + 1 }, 'tabNumber は 1〜'],
    ['tabNumber が整数でない', { ...valid, tabNumber: 1.5 }, 'tabNumber は 1〜'],
    ['tabNumber が文字列', { ...valid, tabNumber: '1' }, 'tabNumber は 1〜'],
    ['kind が 3 つのどれでもない', { ...valid, kind: 'working' }, 'kind は'],
    ['kind が無い', { slotId: 'slot-1', tabNumber: 1 }, 'kind は']
  ])('%s なら投げる', (_label, payload, message) => {
    expect(() => parseAgentNotificationShowRequest(payload)).toThrow(message)
  })
})

describe('parseAgentNotificationBadgeRequest', () => {
  it.each([0, 1, AGENT_MAX_SESSIONS_PER_WINDOW])('count %s を受ける', (count) => {
    expect(parseAgentNotificationBadgeRequest({ count })).toEqual({ count })
  })
  it.each([
    ['オブジェクトでない', 3],
    ['負の数', { count: -1 }],
    ['上限を超える', { count: AGENT_MAX_SESSIONS_PER_WINDOW + 1 }],
    ['整数でない', { count: 0.5 }],
    ['文字列', { count: '1' }]
  ])('%s なら投げる', (_label, payload) => {
    expect(() => parseAgentNotificationBadgeRequest(payload)).toThrow()
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/handlers/payloadValidators.test.ts src/main/__tests__/handlers/agentNotificationPayloadParser.test.ts`
Expected: FAIL（`isIntegerInRange`・パーサーが無い）

- [ ] **Step 3: 入力の検証を実装する**

`src/main/handlers/payloadValidators.ts` の末尾に足す:
```ts
/** 範囲の内の整数か(NaN・小数・文字列は false) */
export function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}
```

`src/main/handlers/agentTerminalPayloadParser.ts`: ファイル内の `function isIntegerInRange(...)` を消し、import を `import { assertPlainObject, IPC_PATH_MAX_LENGTH, isIntegerInRange } from './payloadValidators'` にする。`isSessionId` の下に次を足し、`parseAgentStartRequest` の slotId の検証（`if (typeof slotId !== 'string' || ...) throw ...`）をこれの呼び出しに置き換え、戻り値の `slotId` に結果を使う（文言は同じ）:
```ts
/** renderer が発行するタブ(枠)の id。通知の受け口(agentNotificationPayloadParser)も同じ規則で検証する */
export function parseAgentSlotId(value: unknown): string {
  if (typeof value !== 'string' || !AGENT_SLOT_ID_PATTERN.test(value)) {
    throw new Error(
      `slotId は英数字とハイフンの 1〜${AGENT_SLOT_ID_MAX_LENGTH} 文字である必要があります`
    )
  }
  return value
}
```
```ts
export function parseAgentStartRequest(payload: unknown): AgentStartRequest {
  assertPlainObject(payload)
  const { folderPath, cols, rows } = payload
  const slotId = parseAgentSlotId(payload.slotId)
  // (folderPath・cols・rows の検証は今のまま)
  return { slotId, folderPath, cols, rows }
}
```

`src/main/handlers/agentNotificationPayloadParser.ts`:
```ts
import type { AgentNotificationBadgeRequest, AgentNotificationShowRequest } from '@shared/types'
import { AGENT_MAX_SESSIONS_PER_WINDOW, AGENT_NOTIFICATION_KINDS, isAgentNotificationKind } from '@shared/types'
import { assertPlainObject, isIntegerInRange } from './payloadValidators'
import { parseAgentSlotId } from './agentTerminalPayloadParser'

// agentNotification:* の入力の検証(設計書「main」)。どちらも invoke なので例外で拒否する。
// tabNumber は通知の題(claude N)にしか使わず、slotId との食い違いは押したときに届く先(slotId)を変えない(L-023)

export function parseAgentNotificationShowRequest(payload: unknown): AgentNotificationShowRequest {
  assertPlainObject(payload)
  const { tabNumber, kind } = payload
  const slotId = parseAgentSlotId(payload.slotId)
  if (!isIntegerInRange(tabNumber, 1, AGENT_MAX_SESSIONS_PER_WINDOW)) {
    throw new Error(`tabNumber は 1〜${AGENT_MAX_SESSIONS_PER_WINDOW} の整数である必要があります`)
  }
  if (!isAgentNotificationKind(kind)) {
    throw new Error(`kind は ${AGENT_NOTIFICATION_KINDS.join('・')} のどれかである必要があります`)
  }
  return { slotId, tabNumber, kind }
}

export function parseAgentNotificationBadgeRequest(payload: unknown): AgentNotificationBadgeRequest {
  assertPlainObject(payload)
  const { count } = payload
  if (!isIntegerInRange(count, 0, AGENT_MAX_SESSIONS_PER_WINDOW)) {
    throw new Error(`count は 0〜${AGENT_MAX_SESSIONS_PER_WINDOW} の整数である必要があります`)
  }
  return { count }
}
```

- [ ] **Step 4: 入力の検証のテストを通す**

Run: `npx vitest run src/main/__tests__/handlers/payloadValidators.test.ts src/main/__tests__/handlers/agentNotificationPayloadParser.test.ts src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts`
Expected: PASS

- [ ] **Step 5: 失敗するテストを書く（通知の記録・後始末・受け口）**

`src/main/__tests__/agentNotifications.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createAgentNotificationCenter } from '../agentNotifications'
import type { AgentNotificationHandle, AgentNotificationWindow } from '../agentNotifications'

// Electron の Notification・app.dock・BrowserWindow は偽物(実物の表示は実機テスト仕様書で確かめる。L-059)

interface FakeNotification extends AgentNotificationHandle {
  options: { title: string; body: string }
  show: Mock<() => void>
  close: Mock<() => void>
  /** 利用者が押した */
  click: () => void
}

type FakeWindow = { [K in keyof Omit<AgentNotificationWindow, 'webContents'>]: Mock } & {
  webContents: { isDestroyed: Mock<() => boolean>; send: Mock }
}

function makeWindow(state: { focused?: boolean; minimized?: boolean; destroyed?: boolean } = {}): FakeWindow {
  return {
    isDestroyed: vi.fn(() => state.destroyed ?? false),
    isFocused: vi.fn(() => state.focused ?? false),
    isMinimized: vi.fn(() => state.minimized ?? false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    flashFrame: vi.fn(),
    webContents: { isDestroyed: vi.fn(() => false), send: vi.fn() }
  }
}

function setup(options: { platform?: NodeJS.Platform; supported?: boolean } = {}) {
  const created: FakeNotification[] = []
  const setDockBadge = vi.fn<(text: string) => void>()
  const center = createAgentNotificationCenter({
    platform: options.platform ?? 'darwin',
    isSupported: () => options.supported ?? true,
    createNotification: (notificationOptions) => {
      const clickListeners: (() => void)[] = []
      const closeListeners: (() => void)[] = []
      const notification: FakeNotification = {
        options: notificationOptions,
        show: vi.fn(),
        // 実物と同じく、閉じると close が届く
        close: vi.fn(() => closeListeners.forEach((listener) => listener())),
        onClick: (listener) => clickListeners.push(listener),
        onClose: (listener) => closeListeners.push(listener),
        click: () => clickListeners.forEach((listener) => listener())
      }
      created.push(notification)
      return notification
    },
    setDockBadge
  })
  return { center, created, setDockBadge }
}

const request = { slotId: 'slot-1', tabNumber: 2, kind: 'permission' } as const

describe('createAgentNotificationCenter', () => {
  describe('show', () => {
    it('フォーカスが無ければ、固定の表から作った題・本文で通知を出す', () => {
      const { center, created } = setup()
      center.show(makeWindow(), request)
      expect(created).toHaveLength(1)
      expect(created[0].options).toEqual({
        title: 'claude 2: 許可待ち',
        body: 'ツールの実行の許可を待っています'
      })
      expect(created[0].show).toHaveBeenCalledOnce()
    })

    it.each([
      ['ウィンドウにフォーカスがある', { focused: true }, true],
      ['ウィンドウが破棄済み', { destroyed: true }, true],
      ['通知に対応していない', {}, false]
    ])('%s なら出さない', (_label, state, supported) => {
      const { center, created } = setup({ supported })
      center.show(makeWindow(state), request)
      expect(created).toHaveLength(0)
    })

    it('同じウィンドウ・同じタブの前の通知を閉じてから出す(タブごとに最新の 1 件)', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      center.show(window, { ...request, kind: 'done' })
      expect(created[0].close).toHaveBeenCalledOnce()
      expect(created[1].show).toHaveBeenCalledOnce()
      expect(created[1].close).not.toHaveBeenCalled()
    })

    it('別のタブ・別のウィンドウの通知は閉じない', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      center.show(window, { ...request, slotId: 'slot-2' })
      center.show(makeWindow(), request)
      expect(created[0].close).not.toHaveBeenCalled()
      expect(created[1].close).not.toHaveBeenCalled()
    })

    it('前の通知の close が投げても、新しい通知を出す(L-053)', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      created[0].close.mockImplementation(() => {
        throw new Error('already closed')
      })
      expect(() => center.show(window, request)).not.toThrow()
      expect(created[1].show).toHaveBeenCalledOnce()
    })

    it.each(['win32', 'linux'] as const)('%s では通知と同時にタスクバーのボタンを点滅させる', (platform) => {
      const { center } = setup({ platform })
      const window = makeWindow()
      center.show(window, request)
      expect(window.flashFrame).toHaveBeenCalledWith(true)
    })

    it('macOS では点滅させない(Dock のバッジで知らせる)', () => {
      const { center } = setup({ platform: 'darwin' })
      const window = makeWindow()
      center.show(window, request)
      expect(window.flashFrame).not.toHaveBeenCalled()
    })
  })

  describe('通知を押したとき', () => {
    it('最小化を戻して前面にし、そのウィンドウへ activated を送る', () => {
      const { center, created } = setup()
      const window = makeWindow({ minimized: true })
      center.show(window, request)
      created[0].click()
      expect(window.restore).toHaveBeenCalledOnce()
      expect(window.show).toHaveBeenCalledOnce()
      expect(window.focus).toHaveBeenCalledOnce()
      expect(window.webContents.send).toHaveBeenCalledWith('agentNotification:activated', {
        slotId: 'slot-1'
      })
    })

    it('最小化していなければ restore しない', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      created[0].click()
      expect(window.restore).not.toHaveBeenCalled()
      expect(window.focus).toHaveBeenCalledOnce()
    })

    it('ウィンドウが破棄済みなら前面にも送りもしない', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      window.isDestroyed.mockReturnValue(true)
      created[0].click()
      expect(window.focus).not.toHaveBeenCalled()
      expect(window.webContents.send).not.toHaveBeenCalled()
    })

    it('前面化が投げても、例外を外へ出さずに activated を送る(L-053)', () => {
      const { center, created } = setup()
      const window = makeWindow()
      window.focus.mockImplementation(() => {
        throw new Error('focus failed')
      })
      center.show(window, request)
      expect(() => created[0].click()).not.toThrow()
      expect(window.webContents.send).toHaveBeenCalledWith('agentNotification:activated', {
        slotId: 'slot-1'
      })
    })

    it('押した通知は記録から消え、ウィンドウの後始末で閉じ直さない', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      created[0].click()
      center.clearWindow(window)
      expect(created[0].close).not.toHaveBeenCalled()
    })
  })

  describe('handleWindowFocus', () => {
    it.each(['win32', 'linux'] as const)('%s ではフォーカスで点滅を止める', (platform) => {
      const { center } = setup({ platform })
      const window = makeWindow()
      center.handleWindowFocus(window)
      expect(window.flashFrame).toHaveBeenCalledWith(false)
    })

    it('macOS では何もしない', () => {
      const { center } = setup({ platform: 'darwin' })
      const window = makeWindow()
      center.handleWindowFocus(window)
      expect(window.flashFrame).not.toHaveBeenCalled()
    })
  })

  describe('clearWindow', () => {
    it('そのウィンドウの残っている通知だけを閉じる', () => {
      const { center, created } = setup()
      const window = makeWindow()
      const other = makeWindow()
      center.show(window, request)
      center.show(window, { ...request, slotId: 'slot-2' })
      center.show(other, request)
      center.clearWindow(window)
      expect(created[0].close).toHaveBeenCalledOnce()
      expect(created[1].close).toHaveBeenCalledOnce()
      expect(created[2].close).not.toHaveBeenCalled()
    })

    it('利用者が閉じた通知は記録から消え、後始末で閉じ直さない', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      created[0].close()
      created[0].close.mockClear()
      center.clearWindow(window)
      expect(created[0].close).not.toHaveBeenCalled()
    })

    it('close が投げても残りの通知を閉じる(L-053)', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      center.show(window, { ...request, slotId: 'slot-2' })
      created[0].close.mockImplementation(() => {
        throw new Error('x')
      })
      expect(() => center.clearWindow(window)).not.toThrow()
      expect(created[1].close).toHaveBeenCalledOnce()
    })
  })

  describe('setBadge', () => {
    it('macOS では Dock のバッジに数を出し、0 なら消す', () => {
      const { center, setDockBadge } = setup({ platform: 'darwin' })
      center.setBadge(3)
      center.setBadge(0)
      expect(setDockBadge.mock.calls).toEqual([['3'], ['']])
    })

    it.each(['win32', 'linux'] as const)('%s では何もしない', (platform) => {
      const { center, setDockBadge } = setup({ platform })
      center.setBadge(2)
      expect(setDockBadge).not.toHaveBeenCalled()
    })
  })
})
```

`src/main/__tests__/agentNotificationLifecycle.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { setupAgentNotificationLifecycle } from '../agentNotificationLifecycle'

function setup() {
  const app = new EventEmitter()
  const center = { handleWindowFocus: vi.fn(), clearWindow: vi.fn(), setBadge: vi.fn() }
  setupAgentNotificationLifecycle(app as unknown as App, center)
  const webContents = new EventEmitter()
  const window = Object.assign(new EventEmitter(), { webContents })
  app.emit('browser-window-created', {}, window)
  return { center, window, webContents }
}

describe('setupAgentNotificationLifecycle', () => {
  it('ウィンドウがフォーカスを得たら点滅を止める', () => {
    const { center, window } = setup()
    window.emit('focus')
    expect(center.handleWindowFocus).toHaveBeenCalledWith(window)
  })

  it('ウィンドウが閉じたら残っている通知を閉じ、バッジを 0 に戻す(1 ウィンドウの前提)', () => {
    const { center, window } = setup()
    window.emit('closed')
    expect(center.clearWindow).toHaveBeenCalledWith(window)
    expect(center.setBadge).toHaveBeenCalledWith(0)
  })

  it('リロード(メインフレームの文書の入れ替わり)で残っている通知を閉じる', () => {
    const { center, window, webContents } = setup()
    webContents.emit('did-navigate')
    expect(center.clearWindow).toHaveBeenCalledWith(window)
    expect(center.setBadge).not.toHaveBeenCalled()
  })

  it('読み込みに失敗してエラーの画面に入れ替わったときも閉じる。ERR_ABORTED(-3)では閉じない', () => {
    const { center, webContents } = setup()
    webContents.emit('did-fail-load', {}, -3, '', 'file:///x', true)
    expect(center.clearWindow).not.toHaveBeenCalled()
    webContents.emit('did-fail-load', {}, -6, '', 'file:///x', true)
    expect(center.clearWindow).toHaveBeenCalledOnce()
  })

  it('will-navigate で止めた遷移(did-start-navigation だけが届く)では閉じない', () => {
    const { center, webContents } = setup()
    webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(center.clearWindow).not.toHaveBeenCalled()
  })
})
```

`src/main/__tests__/handlers/agentNotificationHandlers.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerAgentNotificationHandlers } from '../../handlers/agentNotificationHandlers'

type Listener = (...args: unknown[]) => unknown
const handles = new Map<string, Listener>()
const ipcMain = { handle: vi.fn((channel: string, listener: Listener) => handles.set(channel, listener)) }

const center = { show: vi.fn(), setBadge: vi.fn() }
const window = { marker: 'window' }
const windowOf = vi.fn((): unknown => window)

const makeEvent = (main = true) => ({ sender: { id: 1 }, senderFrame: { parent: main ? null : {} } })
const invoke = (channel: string, event: unknown, payload: unknown): Promise<unknown> =>
  Promise.resolve(handles.get(channel)?.(event, payload))

beforeEach(() => {
  vi.clearAllMocks()
  handles.clear()
  windowOf.mockImplementation(() => window)
  registerAgentNotificationHandlers(ipcMain as never, { center, windowOf: windowOf as never })
})

describe('agentNotification:show', () => {
  const payload = { slotId: 'slot-1', tabNumber: 1, kind: 'done' }

  it('送信元のウィンドウと検証した依頼を center へ渡す', async () => {
    const event = makeEvent()
    await invoke('agentNotification:show', event, payload)
    expect(windowOf).toHaveBeenCalledWith(event.sender)
    expect(center.show).toHaveBeenCalledWith(window, payload)
  })

  it('メインフレーム以外からの依頼は拒否する', async () => {
    await expect(invoke('agentNotification:show', makeEvent(false), payload)).rejects.toThrow(
      'メインフレーム以外からの依頼は受け付けません'
    )
    expect(center.show).not.toHaveBeenCalled()
  })

  it('入力が不正なら拒否する', async () => {
    await expect(
      invoke('agentNotification:show', makeEvent(), { ...payload, kind: 'working' })
    ).rejects.toThrow('kind は')
    expect(center.show).not.toHaveBeenCalled()
  })

  it('送信元のウィンドウが無ければ何もしない', async () => {
    windowOf.mockImplementation(() => null)
    await expect(invoke('agentNotification:show', makeEvent(), payload)).resolves.toBeUndefined()
    expect(center.show).not.toHaveBeenCalled()
  })
})

describe('agentNotification:setBadge', () => {
  it('検証した数を center へ渡す', async () => {
    await invoke('agentNotification:setBadge', makeEvent(), { count: 2 })
    expect(center.setBadge).toHaveBeenCalledWith(2)
  })

  it('メインフレーム以外・不正な数は拒否する', async () => {
    await expect(invoke('agentNotification:setBadge', makeEvent(false), { count: 1 })).rejects.toThrow(
      'メインフレーム以外からの依頼は受け付けません'
    )
    await expect(invoke('agentNotification:setBadge', makeEvent(), { count: -1 })).rejects.toThrow(
      'count は'
    )
    expect(center.setBadge).not.toHaveBeenCalled()
  })
})
```

`src/main/__tests__/appIdentity.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { APP_USER_MODEL_ID } from '../appIdentity'

describe('APP_USER_MODEL_ID', () => {
  it('electron-builder.yml の appId と同じ(Windows のトースト通知はショートカットの AppUserModelID と一致しないと出ない)', () => {
    const builder = readFileSync(resolve(__dirname, '../../../electron-builder.yml'), 'utf-8')
    const appId = /^appId:\s*(\S+)\s*$/m.exec(builder)?.[1]
    expect(appId).toBe(APP_USER_MODEL_ID)
  })
})
```

`src/main/__tests__/ipcHandlers.test.ts` に足す（`vi.mock('electron', ...)` は `BrowserWindow`・`Notification` を足して置き換える）:
```ts
const mockCreateAgentNotificationCenter = vi.hoisted(() => vi.fn((_deps: unknown) => ({ marker: 'center' })))
const mockSetupAgentNotificationLifecycle = vi.hoisted(() => vi.fn())
const mockRegisterAgentNotificationHandlers = vi.hoisted(() => vi.fn())
const mockFromWebContents = vi.hoisted(() => vi.fn())
vi.mock('../agentNotifications', () => ({
  createAgentNotificationCenter: mockCreateAgentNotificationCenter
}))
vi.mock('../agentNotificationLifecycle', () => ({
  setupAgentNotificationLifecycle: mockSetupAgentNotificationLifecycle
}))
vi.mock('../handlers/agentNotificationHandlers', () => ({
  registerAgentNotificationHandlers: mockRegisterAgentNotificationHandlers
}))
vi.mock('electron', () => ({
  app: {},
  shell: { openExternal: vi.fn() },
  BrowserWindow: { fromWebContents: mockFromWebContents },
  Notification: vi.fn()
}))
```
```ts
  it('通知の center を寿命の後始末と IPC の受け口に渡し、送信元のウィンドウは BrowserWindow.fromWebContents で引く', () => {
    registerIpcHandlers(mockIpcMain)
    const center = mockCreateAgentNotificationCenter.mock.results[0].value
    expect(mockSetupAgentNotificationLifecycle).toHaveBeenCalledWith(expect.any(Object), center)
    const [ipcMain, deps] = mockRegisterAgentNotificationHandlers.mock.calls[0]
    expect(ipcMain).toBe(mockIpcMain)
    expect(deps.center).toBe(center)
    const sender = { id: 7 }
    mockFromWebContents.mockReturnValueOnce({ marker: 'window' })
    expect(deps.windowOf(sender)).toEqual({ marker: 'window' })
    expect(mockFromWebContents).toHaveBeenCalledWith(sender)
    expect(mockCreateAgentNotificationCenter.mock.calls[0][0]).toMatchObject({
      platform: process.platform
    })
  })
```

`src/preload/__tests__/api.test.ts`: `describe('エージェントのターミナル・外部変更・実行方式・リンクの API'` の invoke の `it.each` に足す:
```ts
    [
      'showAgentNotification は agentNotification:show に依頼を渡す',
      () => api.showAgentNotification({ slotId: 's-1', tabNumber: 1, kind: 'done' }),
      ['agentNotification:show', { slotId: 's-1', tabNumber: 1, kind: 'done' }]
    ],
    [
      'setAgentNotificationBadge は agentNotification:setBadge に数を包んで渡す',
      () => api.setAgentNotificationBadge(2),
      ['agentNotification:setBadge', { count: 2 }]
    ],
```
購読の `describe.each` に足す:
```ts
  [
    'onAgentNotificationActivated',
    'agentNotification:activated',
    (l: (p: unknown) => void) => api.onAgentNotificationActivated(l),
    { slotId: 'slot-1' },
    [null, { slotId: 1 }, { slotId: 'a b' }, {}]
  ],
```

- [ ] **Step 6: 落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentNotifications.test.ts src/main/__tests__/agentNotificationLifecycle.test.ts src/main/__tests__/handlers/agentNotificationHandlers.test.ts src/main/__tests__/appIdentity.test.ts src/main/__tests__/ipcHandlers.test.ts src/preload/__tests__/api.test.ts`
Expected: FAIL（モジュール・API が無い）

- [ ] **Step 7: main を実装する**

`src/main/agentNotifications.ts`:
```ts
import type { WebContents } from 'electron'
import type { AgentNotificationShowRequest } from '@shared/types'
import { agentNotificationText } from '@shared/agentNotificationText'
import { sendSafely } from './safeWebContentsSend'

// エージェントの完了・許可待ちの OS の通知(設計書「main」)。ウィンドウ・タブごとに最新の 1 件だけを保持し(押されるまで
// 参照を持ち、GC で click が失われないように)、押したらウィンドウを前面にして renderer へ知らせる。Windows・Linux は通知と
// 同時にタスクバーのボタンを点滅させ、macOS は Dock のバッジで待っているタブの数を出す。Electron の実物は ipcHandlers.ts で注入する

/** OS の通知 1 件(Electron の Notification を包んだもの) */
export interface AgentNotificationHandle {
  show(): void
  close(): void
  onClick(listener: () => void): void
  /** 閉じられた(利用者・close の呼び出し) */
  onClose(listener: () => void): void
}

/** 通知を出すウィンドウ(BrowserWindow の使う部分) */
export interface AgentNotificationWindow {
  isDestroyed(): boolean
  isFocused(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  flashFrame(flag: boolean): void
  readonly webContents: Pick<WebContents, 'isDestroyed' | 'send'>
}

export interface AgentNotificationCenterDeps {
  platform: NodeJS.Platform
  /** Notification.isSupported() */
  isSupported: () => boolean
  createNotification: (options: { title: string; body: string }) => AgentNotificationHandle
  /** app.dock.setBadge(macOS だけ呼ぶ) */
  setDockBadge: (text: string) => void
}

export interface AgentNotificationCenter {
  /** ウィンドウにフォーカスが無ければ通知を出す。同じウィンドウ・同じタブの前の通知は閉じる */
  show(window: AgentNotificationWindow, request: AgentNotificationShowRequest): void
  /** 待っているタブの数(macOS の Dock のバッジ。ほかの OS では何もしない) */
  setBadge(count: number): void
  /** ウィンドウがフォーカスを得た(点滅を止める) */
  handleWindowFocus(window: AgentNotificationWindow): void
  /** ウィンドウが閉じた・リロードした(残っている通知を閉じる。押されても届く先が無いため) */
  clearWindow(window: AgentNotificationWindow): void
}

/** 閉じる途中の例外で後続(新しい通知・残りの通知の後始末)を止めない(L-053) */
const closeQuietly = (handle: AgentNotificationHandle): void => {
  try {
    handle.close()
  } catch {
    // 既に閉じた通知などは捨てる
  }
}

export function createAgentNotificationCenter({
  platform,
  isSupported,
  createNotification,
  setDockBadge
}: AgentNotificationCenterDeps): AgentNotificationCenter {
  const flashes = platform !== 'darwin'
  const byWindow = new Map<AgentNotificationWindow, Map<string, AgentNotificationHandle>>()

  /** 記録がその通知のままなら消す(新しい通知に入れ替わった後の、前の通知の close では消さない) */
  const forget = (
    window: AgentNotificationWindow,
    slotId: string,
    handle: AgentNotificationHandle
  ): void => {
    const slots = byWindow.get(window)
    if (slots === undefined || slots.get(slotId) !== handle) return
    slots.delete(slotId)
    if (slots.size === 0) byWindow.delete(window)
  }

  const activate = (window: AgentNotificationWindow, slotId: string): void => {
    if (window.isDestroyed()) return
    try {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    } catch {
      // 前面化できなくても、タブへ移る知らせは送る(通知の click の listener から投げると main の未処理例外になる。L-053)
    }
    sendSafely(window.webContents, 'agentNotification:activated', { slotId })
  }

  return {
    show(window, { slotId, tabNumber, kind }) {
      if (window.isDestroyed() || window.isFocused()) return
      if (!isSupported()) return
      // 題・本文は固定の表から作る(renderer の文字列を通知に出さない。L-019)
      const { title, body } = agentNotificationText(kind, tabNumber)
      const slots = byWindow.get(window) ?? new Map<string, AgentNotificationHandle>()
      byWindow.set(window, slots)
      const previous = slots.get(slotId)
      slots.delete(slotId)
      if (previous !== undefined) closeQuietly(previous)
      const handle = createNotification({ title, body })
      slots.set(slotId, handle)
      handle.onClick(() => {
        forget(window, slotId, handle)
        activate(window, slotId)
      })
      handle.onClose(() => forget(window, slotId, handle))
      handle.show()
      if (flashes) window.flashFrame(true)
    },
    setBadge(count) {
      if (platform !== 'darwin') return
      setDockBadge(count > 0 ? String(count) : '')
    },
    handleWindowFocus(window) {
      if (!flashes || window.isDestroyed()) return
      window.flashFrame(false)
    },
    clearWindow(window) {
      const slots = byWindow.get(window)
      byWindow.delete(window)
      if (slots === undefined) return
      for (const handle of slots.values()) closeQuietly(handle)
    }
  }
}
```

`src/main/agentNotificationLifecycle.ts`:
```ts
import type { App } from 'electron'
import type { AgentNotificationCenter } from './agentNotifications'
import { onMainFrameDocumentReplaced } from './mainFrameDocumentReplaced'

// 通知の後始末の契機(設計書「main」)。フォーカスで点滅を止め、ウィンドウを閉じた・リロードした(メインフレームの文書が実際に
// 入れ替わった。will-navigate で止めた遷移では閉じない。判定は mainFrameDocumentReplaced.ts)ときに残っている通知を閉じる。
// 閉じたときはバッジも 0 に戻す(renderer のアンマウントの後始末が届かないことがあり、macOS ではアプリが残るため。1 ウィンドウの前提)

export function setupAgentNotificationLifecycle(
  app: App,
  center: Pick<AgentNotificationCenter, 'handleWindowFocus' | 'clearWindow' | 'setBadge'>
): void {
  app.on('browser-window-created', (_event, window) => {
    window.on('focus', () => center.handleWindowFocus(window))
    window.on('closed', () => {
      center.clearWindow(window)
      center.setBadge(0)
    })
    onMainFrameDocumentReplaced(window.webContents, () => center.clearWindow(window))
  })
}
```

`src/main/handlers/agentNotificationHandlers.ts`:
```ts
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import type { AgentNotificationCenter, AgentNotificationWindow } from '../agentNotifications'
import { isMainFrameSender } from './ipcSenderGuard'
import {
  parseAgentNotificationBadgeRequest,
  parseAgentNotificationShowRequest
} from './agentNotificationPayloadParser'

// エージェントの通知の IPC の受け口(設計書「main」)。renderer からは slotId・タブの番号・出来事・待っている数だけを受け取り、
// 通知の文字列・出すかどうか(フォーカスの有無)は main が決める

export interface AgentNotificationHandlerDeps {
  center: Pick<AgentNotificationCenter, 'show' | 'setBadge'>
  /** 送信元の webContents のウィンドウ(BrowserWindow.fromWebContents)。無ければ null */
  windowOf: (sender: WebContents) => AgentNotificationWindow | null
}

const NOT_MAIN_FRAME = 'メインフレーム以外からの依頼は受け付けません'

export function registerAgentNotificationHandlers(
  ipcMain: IpcMain,
  { center, windowOf }: AgentNotificationHandlerDeps
): void {
  ipcMain.handle(
    'agentNotification:show',
    async (event: IpcMainInvokeEvent, payload: unknown): Promise<void> => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      const request = parseAgentNotificationShowRequest(payload)
      const window = windowOf(event.sender)
      if (window === null) return
      center.show(window, request)
    }
  )

  ipcMain.handle(
    'agentNotification:setBadge',
    async (event: IpcMainInvokeEvent, payload: unknown): Promise<void> => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      // ウィンドウが 1 つの前提で、最後に送られた値を出す(複数ウィンドウの合算はしない。既知の制約)
      center.setBadge(parseAgentNotificationBadgeRequest(payload).count)
    }
  )
}
```

`src/main/ipcHandlers.ts`: import を `import { app, shell, BrowserWindow, Notification } from 'electron'` にし、次の import を足す:
```ts
import { createAgentNotificationCenter } from './agentNotifications'
import { setupAgentNotificationLifecycle } from './agentNotificationLifecycle'
import { registerAgentNotificationHandlers } from './handlers/agentNotificationHandlers'
```
`registerAgentTerminalHandlers(...)` の呼び出しの直後に足す:
```ts
  // エージェントの完了・許可待ちの通知。Electron の Notification・Dock・BrowserWindow をここで注入する
  const agentNotificationCenter = createAgentNotificationCenter({
    platform: process.platform,
    isSupported: () => Notification.isSupported(),
    createNotification: (options) => {
      // 包んだ関数が Notification を参照し続け、center の記録が押されるまで包みを持つ(GC で click が失われないように)
      const notification = new Notification(options)
      return {
        show: () => notification.show(),
        close: () => notification.close(),
        onClick: (listener) => {
          notification.on('click', () => listener())
        },
        onClose: (listener) => {
          notification.on('close', () => listener())
        }
      }
    },
    setDockBadge: (text) => app.dock?.setBadge(text)
  })
  setupAgentNotificationLifecycle(app, agentNotificationCenter)
  registerAgentNotificationHandlers(ipcMain, {
    center: agentNotificationCenter,
    windowOf: (sender) => BrowserWindow.fromWebContents(sender)
  })
```

`src/main/appIdentity.ts`:
```ts
/**
 * Windows の AppUserModelID。electron-builder.yml の appId と同じ値にする(Windows のトースト通知は、ショートカットの
 * AppUserModelID と一致しないと表示されない・押しても届かないことがある)。一致は appIdentity.test.ts で確かめる
 */
export const APP_USER_MODEL_ID = 'com.electron.app'
```

`src/main/index.ts`: `import { APP_USER_MODEL_ID } from './appIdentity'` を足し、`electronApp.setAppUserModelId('com.electron')` を次に置き換える:
```ts
  // Windows の通知の送り元。electron-builder.yml の appId と同じ値(appIdentity.ts)
  electronApp.setAppUserModelId(APP_USER_MODEL_ID)
```

- [ ] **Step 8: preload と既定の偽物を実装する**

`src/preload/api.ts`: 型の import に `AgentNotificationActivated`・`AgentNotificationShowRequest` を足し、値の import を `import { AGENT_SLOT_ID_PATTERN, isAgentExitReason } from '@shared/types'` にする。`setAgentTerminalFocused` の次に足す:
```ts
  // エージェントの完了・許可待ちの通知。題・本文・出すかどうかは main が決める
  showAgentNotification: (request: AgentNotificationShowRequest): Promise<void> =>
    ipcRenderer.invoke('agentNotification:show', request),
  setAgentNotificationBadge: (count: number): Promise<void> =>
    ipcRenderer.invoke('agentNotification:setBadge', { count }),
  onAgentNotificationActivated: (
    listener: (payload: AgentNotificationActivated) => void
  ): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (typeof payload !== 'object' || payload === null) return
      const { slotId } = payload as Record<string, unknown>
      if (typeof slotId !== 'string' || !AGENT_SLOT_ID_PATTERN.test(slotId)) return
      listener({ slotId })
    }
    ipcRenderer.on('agentNotification:activated', wrapped)
    return () => {
      ipcRenderer.removeListener('agentNotification:activated', wrapped)
    }
  },
```

`src/preload/index.d.ts`: 型の import に `AgentNotificationActivated`・`AgentNotificationShowRequest` を足し、`setAgentTerminalFocused(focused: boolean): void` の次に足す:
```ts
      showAgentNotification(request: AgentNotificationShowRequest): Promise<void>
      setAgentNotificationBadge(count: number): Promise<void>
      onAgentNotificationActivated(listener: (payload: AgentNotificationActivated) => void): () => void
```

`src/renderer/src/__tests__/setup.ts`: `setAgentTerminalFocused: () => {},` の次に足す:
```ts
    // エージェントの通知。既定は何もしない(個別のテストで差し替える)
    showAgentNotification: () => Promise.resolve(),
    setAgentNotificationBadge: () => Promise.resolve(),
    onAgentNotificationActivated: () => () => {},
```

- [ ] **Step 9: テストを通す・型チェック・lint**

Run: `npx vitest run src/main src/preload`
Expected: PASS
Run: `npm run typecheck`
Run: `npx eslint --max-warnings 0 src/main/handlers/payloadValidators.ts src/main/handlers/agentTerminalPayloadParser.ts src/main/handlers/agentNotificationPayloadParser.ts src/main/agentNotifications.ts src/main/agentNotificationLifecycle.ts src/main/handlers/agentNotificationHandlers.ts src/main/ipcHandlers.ts src/main/appIdentity.ts src/main/index.ts src/preload/api.ts src/preload/index.d.ts src/renderer/src/__tests__/setup.ts src/main/__tests__/agentNotifications.test.ts src/main/__tests__/agentNotificationLifecycle.test.ts src/main/__tests__/handlers/agentNotificationHandlers.test.ts src/main/__tests__/handlers/agentNotificationPayloadParser.test.ts src/main/__tests__/handlers/payloadValidators.test.ts src/main/__tests__/appIdentity.test.ts src/main/__tests__/ipcHandlers.test.ts src/preload/__tests__/api.test.ts`
Expected: エラー・警告なし（`app.dock?.` の optional chain が型で不要と言われたら、`app.dock` の型〈Electron 39 の `Dock | undefined` か〉を確かめ、型に合わせる）

---

### Task 3: 通知の設定（保存・IPC・hook・設定画面）

**Files:**
- Modify: `src/shared/types/settings.ts`・`src/shared/types.ts`（`DEFAULT_AGENT_NOTIFICATIONS_ENABLED`）
- Modify: `src/main/settingsFileStore.ts`（`agentNotificationsEnabled?: boolean`）
- Create: `src/main/agentNotificationSettingStore.ts`
- Modify: `src/main/handlers/settingsHandlers.ts`
- Modify: `src/preload/api.ts`・`src/preload/index.d.ts`・`src/renderer/src/__tests__/setup.ts`
- Modify: `src/renderer/src/lib/settingsApi.ts`
- Create: `src/renderer/src/hooks/useAgentNotificationSetting.ts`
- Modify: `src/renderer/src/types.ts`（`AgentNotificationPanelState`）
- Create: `src/renderer/src/components/settings/AgentNotificationSection.tsx`
- Modify: `src/renderer/src/components/settings/SettingsPanel.tsx`・`src/renderer/src/components/Sidebar.tsx`・`src/renderer/src/App.tsx`
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`・`src/renderer/src/hooks/useAppState.ts`
- Modify: `src/renderer/src/__tests__/makeAgentWorkspaceState.ts`（型付きの偽物に `agentNotificationPanel` の既定値）
- Modify: `src/renderer/src/assets/main.css`
- Test: `src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`、`src/main/__tests__/agentNotificationSettingStore.test.ts`（新規）、`src/main/__tests__/handlers/settingsHandlers.test.ts`、`src/preload/__tests__/api.test.ts`、`src/renderer/src/lib/__tests__/settingsApi.test.ts`、`src/renderer/src/hooks/__tests__/useAgentNotificationSetting.test.ts`（新規）、`src/renderer/src/components/settings/__tests__/AgentNotificationSection.test.tsx`（新規）、`src/renderer/src/components/settings/__tests__/SettingsPanel.test.tsx`、`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`、`src/renderer/src/components/__tests__/App.agentCli.test.tsx`

**Interfaces:**
- Produces:
```ts
// src/shared/types/settings.ts
export const DEFAULT_AGENT_NOTIFICATIONS_ENABLED = true
// src/main/agentNotificationSettingStore.ts
export async function getAgentNotificationsEnabled(): Promise<boolean>
export async function setAgentNotificationsEnabled(enabled: unknown): Promise<void>
// preload / settingsApi
getAgentNotificationsEnabled(): Promise<boolean>
setAgentNotificationsEnabled(enabled: boolean): Promise<void>
// useAgentNotificationSetting.ts
export const AGENT_NOTIFICATION_SETTING_SAVE_ERROR_PREFIX = '通知の設定を保存できませんでした: '
export interface AgentNotificationSettingState {
  /** 読み込みが終わるまでは null */
  enabled: boolean | null
  saveError: string | null
  /** すぐ保存する。失敗したら保存前の値に戻し、false を返す */
  changeEnabled: (next: boolean) => Promise<boolean>
}
export function useAgentNotificationSetting(): AgentNotificationSettingState
// src/renderer/src/types.ts
export interface AgentNotificationPanelState { enabled: boolean | null; saveError: string | null; onChange: (enabled: boolean) => void }
// AgentWorkspaceState に追加
agentNotificationPanel: AgentNotificationPanelState
```
（`AgentWorkspaceState` には `agentNotificationPanel` だけを足す。`useAgentWorkspace` の中の `const notificationSetting = useAgentNotificationSetting()` は、Task 5 で `useAgentNotifications` の `enabled` にも渡す。）

- [ ] **Step 1: 失敗するテストを書く（main・preload・API）**

`src/main/__tests__/agentNotificationSettingStore.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadSettingsFile = vi.hoisted(() => vi.fn())
const mockWriteSettingsFile = vi.hoisted(() => vi.fn())
vi.mock('../settingsFileStore', () => ({
  readSettingsFile: mockReadSettingsFile,
  writeSettingsFile: mockWriteSettingsFile
}))

import {
  getAgentNotificationsEnabled,
  setAgentNotificationsEnabled
} from '../agentNotificationSettingStore'

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteSettingsFile.mockResolvedValue(undefined)
})

describe('getAgentNotificationsEnabled', () => {
  it.each([
    ['保存された true', { agentNotificationsEnabled: true }, true],
    ['保存された false', { agentNotificationsEnabled: false }, false],
    ['値が無い', {}, true],
    ['文字列', { agentNotificationsEnabled: 'false' }, true],
    ['数', { agentNotificationsEnabled: 0 }, true]
  ])('%s → %s', async (_label, data, expected) => {
    mockReadSettingsFile.mockResolvedValueOnce(data)
    await expect(getAgentNotificationsEnabled()).resolves.toBe(expected)
  })
})

describe('setAgentNotificationsEnabled', () => {
  it('真偽値をマージで書き込む', async () => {
    await setAgentNotificationsEnabled(false)
    expect(mockWriteSettingsFile).toHaveBeenCalledWith({ agentNotificationsEnabled: false })
  })
  it.each(['true', 1, null, undefined])('真偽値でない値(%s)は書き込まずに投げる', async (value) => {
    await expect(setAgentNotificationsEnabled(value)).rejects.toThrow('通知の設定が不正です')
    expect(mockWriteSettingsFile).not.toHaveBeenCalled()
  })
})
```

`src/main/__tests__/handlers/settingsHandlers.test.ts`: 既存の `vi.mock('../../executionModeStore', ...)` の後に足す:
```ts
const mockGetAgentNotificationsEnabled = vi.hoisted(() => vi.fn())
const mockSetAgentNotificationsEnabled = vi.hoisted(() => vi.fn())
vi.mock('../../agentNotificationSettingStore', () => ({
  getAgentNotificationsEnabled: mockGetAgentNotificationsEnabled,
  setAgentNotificationsEnabled: mockSetAgentNotificationsEnabled
}))
```
`describe('registerSettingsHandlers'` に足す:
```ts
  it('settings:getAgentNotificationsEnabled は保存された設定を返す', async () => {
    mockGetAgentNotificationsEnabled.mockResolvedValueOnce(false)
    await expect(
      getRegisteredHandler('settings:getAgentNotificationsEnabled')(makeEvent(1))
    ).resolves.toBe(false)
  })

  it('settings:setAgentNotificationsEnabled は受け取った値をそのまま store へ渡す(検証は store が行う)', async () => {
    mockSetAgentNotificationsEnabled.mockResolvedValueOnce(undefined)
    await getRegisteredHandler('settings:setAgentNotificationsEnabled')(makeEvent(1), true)
    expect(mockSetAgentNotificationsEnabled).toHaveBeenCalledWith(true)
  })

  it('settings:setAgentNotificationsEnabled は store の拒否をそのまま返す', async () => {
    mockSetAgentNotificationsEnabled.mockRejectedValueOnce(new Error('通知の設定が不正です: x'))
    await expect(
      getRegisteredHandler('settings:setAgentNotificationsEnabled')(makeEvent(1), 'x')
    ).rejects.toThrow('通知の設定が不正です')
  })
```

`src/preload/__tests__/api.test.ts` の invoke の `it.each` に足す:
```ts
    [
      'getAgentNotificationsEnabled は settings:getAgentNotificationsEnabled を呼ぶ',
      () => api.getAgentNotificationsEnabled(),
      ['settings:getAgentNotificationsEnabled']
    ],
    [
      'setAgentNotificationsEnabled は settings:setAgentNotificationsEnabled に値を渡す',
      () => api.setAgentNotificationsEnabled(false),
      ['settings:setAgentNotificationsEnabled', false]
    ],
```

`src/renderer/src/lib/__tests__/settingsApi.test.ts`: `mockApi` に `getAgentNotificationsEnabled: vi.fn()`・`setAgentNotificationsEnabled: vi.fn()` を足し、import に 2 つの関数を足して:
```ts
describe('getAgentNotificationsEnabled / setAgentNotificationsEnabled', () => {
  it('window.api の同名の関数へ委ねる', async () => {
    mockApi.getAgentNotificationsEnabled.mockResolvedValue(false)
    mockApi.setAgentNotificationsEnabled.mockResolvedValue(undefined)
    await expect(getAgentNotificationsEnabled()).resolves.toBe(false)
    await setAgentNotificationsEnabled(true)
    expect(mockApi.setAgentNotificationsEnabled).toHaveBeenCalledWith(true)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentNotificationSettingStore.test.ts src/main/__tests__/handlers/settingsHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/settingsApi.test.ts`
Expected: FAIL

- [ ] **Step 3: main・preload・API を実装する**

`src/shared/types/settings.ts` の末尾に足す:
```ts
/** エージェントの完了・許可待ちの通知(OS の通知と Dock のバッジ)の既定。オン */
export const DEFAULT_AGENT_NOTIFICATIONS_ENABLED = true
```
`src/shared/types.ts` の settings の値の export に `DEFAULT_AGENT_NOTIFICATIONS_ENABLED` を足す。

`src/main/settingsFileStore.ts` の `SettingsFile` に足す:
```ts
  /** エージェントの通知のオン・オフ(agentNotificationSettingStore が検証する) */
  agentNotificationsEnabled?: boolean
```

`src/main/agentNotificationSettingStore.ts`:
```ts
import { DEFAULT_AGENT_NOTIFICATIONS_ENABLED } from '@shared/types'
import { readSettingsFile, writeSettingsFile } from './settingsFileStore'

// エージェントの通知のオン・オフの読み書き(userData/settings.json の agentNotificationsEnabled。ほかの設定と同じファイルにマージで書く)

/** 保存された設定。無い・真偽値でなければ既定(オン) */
export async function getAgentNotificationsEnabled(): Promise<boolean> {
  const data = await readSettingsFile()
  return typeof data.agentNotificationsEnabled === 'boolean'
    ? data.agentNotificationsEnabled
    : DEFAULT_AGENT_NOTIFICATIONS_ENABLED
}

/** 検証してから保存する。真偽値でなければ投げる */
export async function setAgentNotificationsEnabled(enabled: unknown): Promise<void> {
  if (typeof enabled !== 'boolean') {
    throw new Error(`通知の設定が不正です: ${String(enabled)}`)
  }
  await writeSettingsFile({ agentNotificationsEnabled: enabled })
}
```

`src/main/handlers/settingsHandlers.ts`: `import { getAgentNotificationsEnabled, setAgentNotificationsEnabled } from '../agentNotificationSettingStore'` を足し、関数の末尾に足す:
```ts
  ipcMain.handle('settings:getAgentNotificationsEnabled', async () => getAgentNotificationsEnabled())

  ipcMain.handle(
    'settings:setAgentNotificationsEnabled',
    async (_event: IpcMainInvokeEvent, enabled: unknown): Promise<void> =>
      setAgentNotificationsEnabled(enabled)
  )
```

`src/preload/api.ts` の `setPromptExecutionMode` の次に足す:
```ts
  getAgentNotificationsEnabled: (): Promise<boolean> =>
    ipcRenderer.invoke('settings:getAgentNotificationsEnabled'),
  setAgentNotificationsEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('settings:setAgentNotificationsEnabled', enabled),
```
`src/preload/index.d.ts` の `setPromptExecutionMode(mode: PromptExecutionMode): Promise<void>` の次に足す:
```ts
      getAgentNotificationsEnabled(): Promise<boolean>
      setAgentNotificationsEnabled(enabled: boolean): Promise<void>
```
`src/renderer/src/__tests__/setup.ts` の `setPromptExecutionMode: () => Promise.resolve(),` の次に足す:
```ts
    getAgentNotificationsEnabled: () => Promise.resolve(true),
    setAgentNotificationsEnabled: () => Promise.resolve(),
```
`src/renderer/src/lib/settingsApi.ts` の末尾に足す:
```ts
export function getAgentNotificationsEnabled(): Promise<boolean> {
  return window.api.getAgentNotificationsEnabled()
}

export function setAgentNotificationsEnabled(enabled: boolean): Promise<void> {
  return window.api.setAgentNotificationsEnabled(enabled)
}
```

- [ ] **Step 4: main・preload・API のテストを通す**

Run: `npx vitest run src/main/__tests__/agentNotificationSettingStore.test.ts src/main/__tests__/handlers/settingsHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/settingsApi.test.ts`
Expected: PASS

- [ ] **Step 5: 失敗するテストを書く（hook・設定画面・配線）**

`src/renderer/src/hooks/__tests__/useAgentNotificationSetting.test.ts`:
```ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

vi.mock('../../lib/settingsApi')

import * as settingsApi from '../../lib/settingsApi'
import {
  AGENT_NOTIFICATION_SETTING_SAVE_ERROR_PREFIX,
  useAgentNotificationSetting
} from '../useAgentNotificationSetting'

const mockGet = vi.mocked(settingsApi.getAgentNotificationsEnabled)
const mockSet = vi.mocked(settingsApi.setAgentNotificationsEnabled)
let consoleSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  vi.resetAllMocks()
  consoleSpy = null
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

describe('useAgentNotificationSetting', () => {
  it('読み込みが終わるまでは null、終わったら保存された設定', async () => {
    mockGet.mockResolvedValueOnce(false)
    const { result } = renderHook(() => useAgentNotificationSetting())
    expect(result.current.enabled).toBeNull()
    await waitFor(() => expect(result.current.enabled).toBe(false))
  })

  it('読み込みに失敗したら既定(オン)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockRejectedValueOnce(new Error('broken'))
    const { result } = renderHook(() => useAgentNotificationSetting())
    await waitFor(() => expect(result.current.enabled).toBe(true))
  })

  it('変えたらすぐ反映して保存する', async () => {
    mockGet.mockResolvedValueOnce(true)
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAgentNotificationSetting())
    await waitFor(() => expect(result.current.enabled).toBe(true))
    await act(async () => {
      await expect(result.current.changeEnabled(false)).resolves.toBe(true)
    })
    expect(mockSet).toHaveBeenCalledWith(false)
    expect(result.current.enabled).toBe(false)
    expect(result.current.saveError).toBeNull()
  })

  it('保存に失敗したら保存前の値に戻し、理由を出す', async () => {
    mockGet.mockResolvedValueOnce(true)
    mockSet.mockRejectedValueOnce(new Error('EACCES'))
    const { result } = renderHook(() => useAgentNotificationSetting())
    await waitFor(() => expect(result.current.enabled).toBe(true))
    await act(async () => {
      await expect(result.current.changeEnabled(false)).resolves.toBe(false)
    })
    expect(result.current.enabled).toBe(true)
    expect(result.current.saveError).toBe('通知の設定を保存できませんでした: EACCES')
  })

  it('保存の失敗の接頭辞', () => {
    expect(AGENT_NOTIFICATION_SETTING_SAVE_ERROR_PREFIX).toBe('通知の設定を保存できませんでした: ')
  })
})
```

`src/renderer/src/components/settings/__tests__/AgentNotificationSection.test.tsx`:
```tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import AgentNotificationSection from '../AgentNotificationSection'

const OPTION = 'ウィンドウが背面のとき、許可待ち・確認待ち・作業の完了を通知する'
const NOTE =
  'Dock のバッジ（macOS）も、この設定でまとめてオン・オフします。通知が出ないときは、OS の通知の設定も確かめてください'

describe('AgentNotificationSection', () => {
  it('見出しと、見えているラベルを名前にしたチェックボックスを出し、説明を参照する', () => {
    render(<AgentNotificationSection enabled saveError={null} onChange={vi.fn()} />)
    expect(screen.getByText('エージェントの通知')).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox', { name: OPTION })
    expect(checkbox).toBeChecked()
    expect(checkbox).toHaveAccessibleDescription(NOTE)
  })

  it('オフなら外れていて、押すと onChange(true)', async () => {
    const onChange = vi.fn()
    render(<AgentNotificationSection enabled={false} saveError={null} onChange={onChange} />)
    const checkbox = screen.getByRole('checkbox', { name: OPTION })
    expect(checkbox).not.toBeChecked()
    await userEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('オンで押すと onChange(false)', async () => {
    const onChange = vi.fn()
    render(<AgentNotificationSection enabled saveError={null} onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: OPTION }))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('読み込み中は押せず、読み込み中と出す', () => {
    render(<AgentNotificationSection enabled={null} saveError={null} onChange={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: OPTION })).toBeDisabled()
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('保存の失敗を role="alert" で出す', () => {
    render(
      <AgentNotificationSection
        enabled
        saveError="通知の設定を保存できませんでした: x"
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('通知の設定を保存できませんでした: x')
  })

  it('選択肢はタッチで押せる 32px 以上の高さ', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
    document.head.appendChild(style)
    try {
      render(<AgentNotificationSection enabled saveError={null} onChange={vi.fn()} />)
      const label = screen.getByRole('checkbox', { name: OPTION }).closest('label')!
      expect(getComputedStyle(label).minHeight).toBe('32px')
    } finally {
      style.remove()
    }
  })
})
```

`src/renderer/src/components/settings/__tests__/SettingsPanel.test.tsx` に足す:
```tsx
  it('agentNotification を渡すとエージェントの通知の節を出し、変更を onChange へ渡す', async () => {
    const onChange = vi.fn()
    render(
      <SettingsPanel
        {...defaultProps}
        agentNotification={{ enabled: true, saveError: null, onChange }}
      />
    )
    await userEvent.click(
      screen.getByRole('checkbox', {
        name: 'ウィンドウが背面のとき、許可待ち・確認待ち・作業の完了を通知する'
      })
    )
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('agentNotification を省略すると節を出さない', () => {
    render(<SettingsPanel {...defaultProps} />)
    expect(screen.queryByText('エージェントの通知')).toBeNull()
  })
```

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`: 既存の hoisted の mock の並びに足す:
```ts
const mockUseAgentNotificationSetting = vi.hoisted(() => vi.fn())
vi.mock('../useAgentNotificationSetting', () => ({
  useAgentNotificationSetting: mockUseAgentNotificationSetting
}))
```
`beforeEach` に足す:
```ts
  mockUseAgentNotificationSetting.mockReturnValue({
    enabled: true,
    saveError: null,
    changeEnabled: vi.fn<(next: boolean) => Promise<boolean>>(async () => true)
  })
```
`describe('useAgentWorkspace'` の中に足す:
```ts
  describe('通知の設定(agentNotificationPanel)', () => {
    it('設定の値と保存の失敗を渡し、変更を changeEnabled へ渡す', () => {
      const changeEnabled = vi.fn<(next: boolean) => Promise<boolean>>(async () => true)
      mockUseAgentNotificationSetting.mockReturnValue({
        enabled: false,
        saveError: '通知の設定を保存できませんでした: x',
        changeEnabled
      })
      const { result } = renderWorkspace()
      expect(result.current.agentNotificationPanel.enabled).toBe(false)
      expect(result.current.agentNotificationPanel.saveError).toBe(
        '通知の設定を保存できませんでした: x'
      )
      act(() => result.current.agentNotificationPanel.onChange(true))
      expect(changeEnabled).toHaveBeenCalledWith(true)
    })
  })
```

`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`: 「実行方式の項目・実行ボタンの状態・下部のパネル・ターミナルを、useAgentWorkspace の戻り値のまま公開する」（667 行付近）の次に、同じ形で足す:
```ts
    it('通知の設定の項目を、useAgentWorkspace の戻り値のまま公開する', () => {
      const workspace = makeAgentWorkspaceState({
        agentNotificationPanel: {
          enabled: false,
          saveError: '通知の設定を保存できませんでした: x',
          onChange: vi.fn()
        }
      })
      mockUseAgentWorkspace.mockReturnValue(workspace)
      const { result } = renderHook(() => useAppState())
      expect(result.current.agentNotificationPanel).toBe(workspace.agentNotificationPanel)
    })
```

`src/renderer/src/components/__tests__/App.agentCli.test.tsx` に足す:
```tsx
  it('設定にエージェントの通知を出し、既定でオンになっている', async () => {
    render(<App />)
    await userEvent.click(panelButton('settings'))
    const checkbox = await screen.findByRole('checkbox', {
      name: 'ウィンドウが背面のとき、許可待ち・確認待ち・作業の完了を通知する'
    })
    await waitFor(() => expect(checkbox).toBeChecked())
  })
```

- [ ] **Step 6: 落ちることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentNotificationSetting.test.ts src/renderer/src/components/settings src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/App.agentCli.test.tsx`
Expected: FAIL

- [ ] **Step 7: hook・設定画面・配線を実装する**

`src/renderer/src/hooks/useAgentNotificationSetting.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_AGENT_NOTIFICATIONS_ENABLED } from '@shared/types'
import * as settingsApi from '../lib/settingsApi'
import { toError } from '../lib/errorUtils'

// エージェントの通知のオン・オフ(設計書「設定」)。useExecutionMode と同じ形で、変更は楽観的に反映して保存し、失敗したら戻す

/** 通知の設定の保存の失敗の文言の接頭辞。後ろに理由を付ける */
export const AGENT_NOTIFICATION_SETTING_SAVE_ERROR_PREFIX = '通知の設定を保存できませんでした: '

export interface AgentNotificationSettingState {
  /** 読み込みが終わるまでは null(通知もバッジも出さない) */
  enabled: boolean | null
  /** 保存の失敗の文言。次の保存で消える */
  saveError: string | null
  /** すぐ保存する。失敗したら保存前の値に戻し、false を返す */
  changeEnabled: (next: boolean) => Promise<boolean>
}

export function useAgentNotificationSetting(): AgentNotificationSettingState {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const enabledRef = useRef<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    // 設定ファイルの JSON が壊れていると main は例外を投げる。画面が起動できなくならないよう、既定(オン)で続ける
    settingsApi
      .getAgentNotificationsEnabled()
      .then((loaded) => {
        if (cancelled) return
        enabledRef.current = loaded
        setEnabled(loaded)
      })
      .catch((err) => {
        console.error('[useAgentNotificationSetting] getAgentNotificationsEnabled failed:', err)
        if (cancelled) return
        enabledRef.current = DEFAULT_AGENT_NOTIFICATIONS_ENABLED
        setEnabled(DEFAULT_AGENT_NOTIFICATIONS_ENABLED)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const changeEnabled = useCallback(async (next: boolean): Promise<boolean> => {
    const previous = enabledRef.current
    enabledRef.current = next
    setEnabled(next)
    setSaveError(null)
    try {
      await settingsApi.setAgentNotificationsEnabled(next)
      return true
    } catch (err) {
      enabledRef.current = previous
      setEnabled(previous)
      setSaveError(`${AGENT_NOTIFICATION_SETTING_SAVE_ERROR_PREFIX}${toError(err).message}`)
      return false
    }
  }, [])

  return { enabled, saveError, changeEnabled }
}
```

`src/renderer/src/types.ts` の `ExecutionModePanelState` の次に足す:
```ts
// エージェントの通知の設定(useAgentWorkspace が組み立て、Sidebar → SettingsPanel へ渡す)
export interface AgentNotificationPanelState {
  /** 読み込み中は null(押せない) */
  enabled: boolean | null
  saveError: string | null
  onChange: (enabled: boolean) => void
}
```

`src/renderer/src/components/settings/AgentNotificationSection.tsx`:
```tsx
'use client'
import { useId } from 'react'

interface Props {
  /** 読み込み中は null(押せない) */
  enabled: boolean | null
  saveError: string | null
  onChange: (enabled: boolean) => void
}

// 設定パネルの「エージェントの通知」(設計書「設定」)。押すとすぐ保存する。チェックボックスの名前は見えているラベルそのもの(L-156)
export default function AgentNotificationSection({
  enabled,
  saveError,
  onChange
}: Props): React.JSX.Element {
  const noteId = useId()
  return (
    <div className="settings-panel__section">
      <p className="settings-panel__label">エージェントの通知</p>
      <label className="agent-notification-section__option">
        <input
          type="checkbox"
          checked={enabled === true}
          // 読み込み前に押すと、後から届く読み込みで上書きされるため押せなくする
          disabled={enabled === null}
          aria-describedby={noteId}
          onChange={(event) => onChange(event.target.checked)}
        />
        ウィンドウが背面のとき、許可待ち・確認待ち・作業の完了を通知する
      </label>
      <p className="settings-panel__note" id={noteId}>
        {
          'Dock のバッジ（macOS）も、この設定でまとめてオン・オフします。通知が出ないときは、OS の通知の設定も確かめてください'
        }
      </p>
      {enabled === null && <p className="settings-panel__status">読み込み中...</p>}
      {saveError !== null && (
        <p className="settings-panel__error" role="alert">
          {saveError}
        </p>
      )}
    </div>
  )
}
```

`src/renderer/src/components/settings/SettingsPanel.tsx`: `import type { AgentNotificationPanelState, ExecutionModePanelState } from '../../types'` にし、`import AgentNotificationSection from './AgentNotificationSection'` を足す。Props に足す:
```ts
  /** エージェントの通知の設定(省略時は出さない) */
  agentNotification?: AgentNotificationPanelState
```
引数に `agentNotification` を足し、`ExecutionModeSection` の節の直後に置く:
```tsx
      {agentNotification !== undefined && (
        <AgentNotificationSection
          enabled={agentNotification.enabled}
          saveError={agentNotification.saveError}
          onChange={agentNotification.onChange}
        />
      )}
```

`src/renderer/src/components/Sidebar.tsx`: 型の import に `AgentNotificationPanelState` を足し、Props の `executionMode?: ExecutionModePanelState` の次に足す:
```ts
  /** エージェントの通知の設定。省略時は設定パネルに出さない */
  agentNotification?: AgentNotificationPanelState
```
引数に `agentNotification` を足し、`<SettingsPanel ... executionMode={executionMode}` の次に `agentNotification={agentNotification}` を渡す。

`src/renderer/src/hooks/useAgentWorkspace.ts`:
- import に `AgentNotificationPanelState` を（`../types` から）、`import { useAgentNotificationSetting } from './useAgentNotificationSetting'` を足す。
- `AgentWorkspaceState` に足す:
```ts
  /** 設定パネルのエージェントの通知の項目 */
  agentNotificationPanel: AgentNotificationPanelState
```
- `const executionMode = useExecutionMode()` の次に `const notificationSetting = useAgentNotificationSetting()` を足す。
- 戻り値の `executionModePanel` の次に足す:
```ts
    agentNotificationPanel: {
      enabled: notificationSetting.enabled,
      saveError: notificationSetting.saveError,
      // changeEnabled は失敗を false で返し、拒否しない(失敗は saveError に出る)
      onChange: (enabled) => {
        void notificationSetting.changeEnabled(enabled)
      }
    },
```

`src/renderer/src/hooks/useAppState.ts` の戻り値の `executionModePanel: agentWorkspace.executionModePanel,` の次に足す:
```ts
    agentNotificationPanel: agentWorkspace.agentNotificationPanel,
```

`src/renderer/src/__tests__/makeAgentWorkspaceState.ts` の戻り値の `executionModePanel: { ... },` の次に足す（既定は「読み込み済み・オン」）:
```ts
    agentNotificationPanel: {
      enabled: true,
      saveError: null,
      onChange: vi.fn<AgentWorkspaceState['agentNotificationPanel']['onChange']>()
    },
```

`src/renderer/src/App.tsx`: `useAppState()` の分割代入の `executionModePanel,` の次に `agentNotificationPanel,` を足し、`<Sidebar ... executionMode={executionModePanel}` の次に `agentNotification={agentNotificationPanel}` を渡す。

`src/renderer/src/assets/main.css` の `.settings-panel__note { ... }` の次に足す:
```css
/* エージェントの通知のチェックボックス(タッチで押せる 32px 以上) */
.agent-notification-section__option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  font-size: 13px;
  color: #cccccc;
  cursor: pointer;
}
```

- [ ] **Step 8: テストを通す・型チェック・lint**

Run: `npx vitest run src/main/__tests__/agentNotificationSettingStore.test.ts src/main/__tests__/handlers/settingsHandlers.test.ts src/preload src/renderer/src/lib/__tests__/settingsApi.test.ts src/renderer/src/hooks/__tests__/useAgentNotificationSetting.test.ts src/renderer/src/components/settings src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__`
Expected: PASS
Run: `npm run typecheck`
Run: `npx eslint --max-warnings 0` に、このタスクで作成・変更した `.ts`・`.tsx` をすべて渡す
Expected: エラー・警告なし

---

### Task 4: タブへ移る処理の切り出し（`useAgentTabActivation`）

**Files:**
- Create: `src/renderer/src/hooks/useAgentTabActivation.ts`
- Modify: `src/renderer/src/hooks/useAgentStatusBar.ts`（フォーカスの予約を取り除き、`activateTab` を受け取る）
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`（`useAgentTabActivation` を組み、`useAgentStatusBar` に渡す）
- Test: `src/renderer/src/hooks/__tests__/useAgentTabActivation.test.ts`（新規。`useAgentStatusBar.test.ts` のフォーカスのテストを移す）、`src/renderer/src/hooks/__tests__/useAgentStatusBar.test.ts`、`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`（既存のステータスバーのテストが変えずに通ること）

**Interfaces:**
- Produces:
```ts
// useAgentTabActivation.ts
export interface UseAgentTabActivationOptions {
  /** 選択中のタブ(フォーカスを移す前に、選択が依頼のタブのままかを slotId で見て controller へ移す) */
  selected: { slotId: string; controller: Pick<AgentTerminalController, 'focus'> }
  selectTab: (slotId: string) => void
  /** パネルを開く(最大化は変えない) */
  openPanel: () => void
}
/** パネルを開き、タブを選び、描画の後にそのタブのターミナルへフォーカスを移す関数。openPanel・selectTab が同じなら同じ参照 */
export function useAgentTabActivation(options: UseAgentTabActivationOptions): (slotId: string) => void
// useAgentStatusBar.ts(変更後の入力。戻り値の AgentStatusBarState は変えない)
export interface UseAgentStatusBarOptions {
  enabled: boolean
  tabs: readonly SummaryTab[]
  /** 選択中のタブの slotId(押したときに同じ活動なら選択中のタブを選ぶ) */
  selectedSlotId: string
  activities: ReadonlyMap<string, AgentActivity>
  /** パネルを開く(当たるタブが無いとき) */
  openPanel: () => void
  /** タブへ移る(useAgentTabActivation) */
  activateTab: (slotId: string) => void
}
```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAgentTabActivation.test.ts`（`useAgentStatusBar.test.ts` の「押すと…フォーカスを移す」系のテストを、タブを指定する形にして移す）:
```ts
import { useState } from 'react'
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { AgentSessionTabView } from '../useAgentSessions'
import { useAgentTabActivation } from '../useAgentTabActivation'
import { makeAgentSessionTabView } from '../../__tests__/makeAgentSessionsState'

interface Setup {
  tabs: AgentSessionTabView[]
  openPanel: ReturnType<typeof vi.fn<() => void>>
  selectTab: ReturnType<typeof vi.fn<(slotId: string) => void>>
  result: { readonly current: (slotId: string) => void }
  /** 利用者がほかの操作でタブを選び直した(次の描画から反映) */
  reselect: (slotId: string) => void
  /** 最後の描画で選択中だったタブの slotId */
  renderedSelectedSlotId: () => string
  rerender: () => void
}

// 選択中のタブは本物(useAgentSessions)と同じく state に持ち、selectTab は次の描画から反映する
const setup = (): Setup => {
  const tabs = [1, 2, 3].map((n) =>
    makeAgentSessionTabView({ slotId: `slot-${n}`, label: `claude ${n}`, status: 'running' })
  )
  const openPanel = vi.fn<() => void>()
  let setSelectedSlotId: (slotId: string) => void = () => undefined
  const selectTab = vi.fn((slotId: string) => setSelectedSlotId(slotId))
  let renderedSelectedSlotId = ''
  const { result, rerender } = renderHook(() => {
    const [selectedSlotId, setSelected] = useState('slot-1')
    setSelectedSlotId = setSelected
    renderedSelectedSlotId = selectedSlotId
    return useAgentTabActivation({
      selected: tabs.find((tab) => tab.slotId === selectedSlotId)!,
      selectTab,
      openPanel
    })
  })
  return {
    tabs,
    openPanel,
    selectTab,
    result,
    reselect: (slotId) => setSelectedSlotId(slotId),
    renderedSelectedSlotId: () => renderedSelectedSlotId,
    rerender: () => rerender()
  }
}

describe('useAgentTabActivation', () => {
  it('パネルを開き、指定したタブを選び、選択が描画された後にそのタブのターミナルへフォーカスを移す', () => {
    const { tabs, openPanel, selectTab, result, renderedSelectedSlotId } = setup()
    const selectedAtFocus: string[] = []
    vi.mocked(tabs[2].controller.focus).mockImplementation(() => {
      selectedAtFocus.push(renderedSelectedSlotId())
    })
    act(() => result.current('slot-3'))
    expect(selectedAtFocus).toEqual(['slot-3'])
    expect(openPanel).toHaveBeenCalledTimes(1)
    expect(selectTab).toHaveBeenCalledWith('slot-3')
    expect(tabs[0].controller.focus).not.toHaveBeenCalled()
  })

  it('指定したタブが既に選択中でも(選択の描画が起きなくても)、呼んだ後の描画でフォーカスを移す', () => {
    const { tabs, result } = setup()
    act(() => result.current('slot-1'))
    expect(tabs[0].controller.focus).toHaveBeenCalledTimes(1)
  })

  it('フォーカスは 1 回だけで、後の描画で繰り返さない', () => {
    const { tabs, result, rerender } = setup()
    act(() => result.current('slot-3'))
    act(() => rerender())
    act(() => rerender())
    expect(tabs[2].controller.focus).toHaveBeenCalledTimes(1)
  })

  it('描画までに選択が別のタブへ移っていたら、フォーカスを移さない', () => {
    const { tabs, result, reselect } = setup()
    act(() => {
      result.current('slot-3')
      reselect('slot-2')
    })
    for (const tab of tabs) expect(tab.controller.focus).not.toHaveBeenCalled()
  })

  it('openPanel・selectTab が変わらなければ同じ参照を返す', () => {
    const { result, rerender } = setup()
    const first = result.current
    act(() => rerender())
    expect(result.current).toBe(first)
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentStatusBar.test.ts` を、`activateTab` を受け取る形に書き換える（フォーカスの描画の確認は上へ移したので消す）:
```ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { AgentActivity } from '../../lib/agentActivity'
import type { AgentSessionTabView } from '../useAgentSessions'
import { useAgentStatusBar } from '../useAgentStatusBar'
import type { UseAgentStatusBarOptions } from '../useAgentStatusBar'
import { makeAgentSessionTabView } from '../../__tests__/makeAgentSessionsState'

// タブ 1・2・3 はすべて running。既定の活動はタブ 1 が作業中・タブ 2 が入力待ち・タブ 3 が許可待ち
const makeTabs = (): AgentSessionTabView[] =>
  [1, 2, 3].map((n) =>
    makeAgentSessionTabView({ slotId: `slot-${n}`, label: `claude ${n}`, status: 'running' })
  )

const DEFAULT_ACTIVITIES: [string, AgentActivity][] = [
  ['slot-1', 'working'],
  ['slot-2', 'idle'],
  ['slot-3', 'permission']
]

const setup = (
  overrides: { enabled?: boolean; activities?: [string, AgentActivity][]; selectedSlotId?: string } = {}
) => {
  const openPanel = vi.fn<() => void>()
  const activateTab = vi.fn<(slotId: string) => void>()
  const options: UseAgentStatusBarOptions = {
    enabled: overrides.enabled ?? true,
    tabs: makeTabs(),
    selectedSlotId: overrides.selectedSlotId ?? 'slot-1',
    activities: new Map(overrides.activities ?? DEFAULT_ACTIVITIES),
    openPanel,
    activateTab
  }
  const { result } = renderHook(() => useAgentStatusBar(options))
  return { result, openPanel, activateTab }
}

describe('useAgentStatusBar', () => {
  it('無効(エージェント CLI 方式でない)なら null', () => {
    expect(setup({ enabled: false }).result.current).toBeNull()
  })

  it('running のタブの活動のまとめと強調の要否を返す', () => {
    const { result } = setup()
    expect(result.current!.items).toEqual([
      { activity: 'permission', count: 1 },
      { activity: 'working', count: 1 },
      { activity: 'idle', count: 1 }
    ])
    expect(result.current!.needsAttention).toBe(true)
  })

  it('操作が必要な活動が無ければ強調しない', () => {
    const { result } = setup({
      activities: [
        ['slot-1', 'working'],
        ['slot-2', 'idle']
      ]
    })
    expect(result.current!.needsAttention).toBe(false)
  })

  it('押すと許可待ちのタブへ移る(パネルを開くのは activateTab)', () => {
    const { result, openPanel, activateTab } = setup()
    act(() => result.current!.onActivate())
    expect(activateTab).toHaveBeenCalledExactlyOnceWith('slot-3')
    expect(openPanel).not.toHaveBeenCalled()
  })

  it('選択中のタブが、ほかのタブと同じ優先の活動なら、選択中のタブへ移る', () => {
    const { result, activateTab } = setup({
      selectedSlotId: 'slot-3',
      activities: [
        ['slot-1', 'idle'],
        ['slot-2', 'working'],
        ['slot-3', 'idle']
      ]
    })
    act(() => result.current!.onActivate())
    expect(activateTab).toHaveBeenCalledExactlyOnceWith('slot-3')
  })

  it('当たるタブが無ければパネルを開くだけで、タブへは移らない', () => {
    const { result, openPanel, activateTab } = setup({
      activities: [
        ['slot-1', 'working'],
        ['slot-2', 'working']
      ]
    })
    act(() => result.current!.onActivate())
    expect(openPanel).toHaveBeenCalledTimes(1)
    expect(activateTab).not.toHaveBeenCalled()
  })
})
```
（`toHaveBeenCalledExactlyOnceWith` が今の Vitest に無ければ、`toHaveBeenCalledTimes(1)` と `toHaveBeenCalledWith` の 2 つに分ける。）

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentTabActivation.test.ts src/renderer/src/hooks/__tests__/useAgentStatusBar.test.ts`
Expected: FAIL（`useAgentTabActivation` が無い。`useAgentStatusBar` が `activateTab` を呼ばない）

- [ ] **Step 3: 実装する**

`src/renderer/src/hooks/useAgentTabActivation.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentTerminalController } from '../lib/agentTerminalController'

// エージェントのタブへ移る(通知の設計書「タブへ移る」)。パネルを開き、タブを選び、描画の後にそのタブのターミナルへフォーカスを
// 移す。ステータスバーのまとめ(useAgentStatusBar)と、OS の通知を押したとき(useAgentNotifications)が同じ関数を使う

export interface UseAgentTabActivationOptions {
  /** 選択中のタブ(フォーカスを移す前に、選択が依頼のタブのままかを slotId で見て controller へ移す) */
  selected: { slotId: string; controller: Pick<AgentTerminalController, 'focus'> }
  selectTab: (slotId: string) => void
  /** パネルを開く(最大化は変えない) */
  openPanel: () => void
}

export function useAgentTabActivation({
  selected,
  selectTab,
  openPanel
}: UseAgentTabActivationOptions): (slotId: string) => void {
  // フォーカスを移すタブ。選択とパネルの開きが描画され、そのタブの xterm が取り付けられてから(子の effect の後)移す。
  // 依頼のたびに数を進めて描画させ(パネルが開いていて選択も変わらないときも)、effect は 1 回だけ移す
  const focusRequestRef = useRef<string | null>(null)
  const [focusRequestCount, setFocusRequestCount] = useState(0)
  const selectedSlotId = selected.slotId
  const selectedController = selected.controller
  useEffect(() => {
    const slotId = focusRequestRef.current
    if (slotId === null) return
    focusRequestRef.current = null
    // 描画までの間にタブが閉じられた・選択が変わったなら移さない
    if (selectedSlotId !== slotId) return
    selectedController.focus()
  }, [focusRequestCount, selectedSlotId, selectedController])

  return useCallback(
    (slotId: string): void => {
      openPanel()
      selectTab(slotId)
      focusRequestRef.current = slotId
      setFocusRequestCount((count) => count + 1)
    },
    [openPanel, selectTab]
  )
}
```

`src/renderer/src/hooks/useAgentStatusBar.ts` を次にする（`AgentStatusBarState` とその文書のコメントは変えない）:
```ts
import { useMemo } from 'react'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentActivitySummaryItem, SummaryTab } from '../lib/agentActivitySummary'
import {
  needsAgentAttention,
  pickWaitingTab,
  summarizeAgentActivities
} from '../lib/agentActivitySummary'

// ステータスバーのエージェントのまとめ(設計書「表示」のステータスバー)。まとめの組み立てと、押したときに移るタブの選択を受け持つ。
// 数え方・選ぶタブの優先・文言は agentActivitySummary に、タブへ移る(パネルを開く・選ぶ・フォーカス)処理は useAgentTabActivation に任せる

// (AgentStatusBarState の定義は今のまま)

export interface UseAgentStatusBarOptions {
  /** エージェント CLI 方式か(でなければ null を返す) */
  enabled: boolean
  tabs: readonly SummaryTab[]
  /** 選択中のタブの slotId(押したときに同じ活動なら選択中のタブを選ぶ) */
  selectedSlotId: string
  activities: ReadonlyMap<string, AgentActivity>
  /** パネルを開く(最大化は変えない)。当たるタブが無いときに使う */
  openPanel: () => void
  /** パネルを開き、タブを選び、描画の後にそのターミナルへフォーカスを移す(useAgentTabActivation) */
  activateTab: (slotId: string) => void
}

export function useAgentStatusBar({
  enabled,
  tabs,
  selectedSlotId,
  activities,
  openPanel,
  activateTab
}: UseAgentStatusBarOptions): AgentStatusBarState | null {
  return useMemo((): AgentStatusBarState | null => {
    if (!enabled) return null
    const items = summarizeAgentActivities(tabs, activities)
    return {
      items,
      needsAttention: needsAgentAttention(items),
      // 利用者を待っているタブへ移る。当たるタブが無ければパネルを開くだけ
      onActivate: () => {
        const slotId = pickWaitingTab(tabs, activities, selectedSlotId)
        if (slotId === null) {
          openPanel()
          return
        }
        activateTab(slotId)
      }
    }
  }, [enabled, tabs, activities, selectedSlotId, openPanel, activateTab])
}
```

`src/renderer/src/hooks/useAgentWorkspace.ts`: `import { useAgentTabActivation } from './useAgentTabActivation'` を足し、`useAgentStatusBar` の呼び出しを次に置き換える:
```ts
  // タブへ移る(パネルを開く・選ぶ・描画の後のフォーカス)。ステータスバーのまとめと、通知を押したときに使う
  const activateAgentTab = useAgentTabActivation({
    selected: agentSessions.selected,
    selectTab: agentSessions.selectTab,
    openPanel: agentLayout.open
  })
  const statusBarAgent = useAgentStatusBar({
    enabled: isAgentMode,
    tabs: agentSessions.tabs,
    selectedSlotId: agentSessions.selected.slotId,
    activities,
    openPanel: agentLayout.open,
    activateTab: activateAgentTab
  })
```

- [ ] **Step 4: テストを通す・型チェック・lint**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentTabActivation.test.ts src/renderer/src/hooks/__tests__/useAgentStatusBar.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/components/__tests__/StatusBar.test.tsx`
Expected: PASS（`useAgentWorkspace.test.ts` の「ステータスバーのまとめ」の既存のテストを変えずに通ること。ステータスバーの挙動は変えない）
Run: `npm run typecheck`
Run: `npx eslint --max-warnings 0 src/renderer/src/hooks/useAgentTabActivation.ts src/renderer/src/hooks/useAgentStatusBar.ts src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/hooks/__tests__/useAgentTabActivation.test.ts src/renderer/src/hooks/__tests__/useAgentStatusBar.test.ts`
Expected: エラー・警告なし

---

### Task 5: 活動の変化の監視（`useAgentNotifications`）と配線・読み上げの領域

**Files:**
- Create: `src/renderer/src/lib/agentNotificationApi.ts`
- Create: `src/renderer/src/hooks/useAgentNotifications.ts`
- Modify: `src/renderer/src/hooks/useAgentSessions.ts`（`AgentSessionTabView.number`）
- Modify: `src/renderer/src/__tests__/makeAgentSessionsState.ts`（既定の `number: 1`）
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`（`useAgentNotifications` を組み、`agentAnnouncement` を返す）
- Modify: `src/renderer/src/hooks/useAppState.ts`
- Modify: `src/renderer/src/__tests__/makeAgentWorkspaceState.ts`（`agentAnnouncement: ''` の既定値）
- Create: `src/renderer/src/components/agent/AgentAnnouncer.tsx`
- Modify: `src/renderer/src/App.tsx`（ステータスバーの隣に常設の読み上げの領域）
- Modify: `src/renderer/src/assets/main.css`（`.agent-announcer` を隠す規則に足す）
- Test: `src/renderer/src/lib/__tests__/agentNotificationApi.test.ts`（新規）、`src/renderer/src/hooks/__tests__/useAgentNotifications.test.ts`（新規）、`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`、`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`、`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`、`src/renderer/src/components/agent/__tests__/AgentAnnouncer.test.tsx`（新規）、`src/renderer/src/components/__tests__/App.agentCli.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `nextAgentNotification`・`agentNotificationText`・`AgentNotificationShowRequest`・`AgentNotificationActivated`、Task 2 の preload（`showAgentNotification`・`setAgentNotificationBadge`・`onAgentNotificationActivated`）、Task 3 の `useAgentNotificationSetting`（`useAgentWorkspace` の `notificationSetting`）、Task 4 の `activateAgentTab`
- Produces:
```ts
// agentNotificationApi.ts
export function showAgentNotification(request: AgentNotificationShowRequest): Promise<void>
export function setAgentNotificationBadge(count: number): Promise<void>
export function onAgentNotificationActivated(listener: (payload: AgentNotificationActivated) => void): () => void
// useAgentNotifications.ts
export interface AgentNotificationTab { slotId: string; number: number; status: AgentSessionStatus; isClosing: boolean }
export interface UseAgentNotificationsOptions {
  tabs: readonly AgentNotificationTab[]
  activities: ReadonlyMap<string, AgentActivity>
  /** 通知の設定。読み込み中は null(通知もバッジも出さない。読み上げはする) */
  enabled: boolean | null
  /** 通知を押したときにタブへ移る(useAgentTabActivation) */
  activateTab: (slotId: string) => void
}
/** 読み上げの文言(常設の aria-live の領域に渡す)。まだ出来事が無ければ '' */
export function useAgentNotifications(options: UseAgentNotificationsOptions): string
// AgentSessionTabView に追加
number: number
// AgentWorkspaceState に追加
/** エージェントの状態の変化の読み上げの文言(App が常設の aria-live の領域に出す) */
agentAnnouncement: string
// AgentAnnouncer.tsx
export default function AgentAnnouncer(props: { message: string }): React.JSX.Element
```

- [ ] **Step 1: 失敗するテストを書く（API・hook）**

`src/renderer/src/lib/__tests__/agentNotificationApi.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as agentNotificationApi from '../agentNotificationApi'

const mockApi = {
  showAgentNotification: vi.fn(),
  setAgentNotificationBadge: vi.fn(),
  onAgentNotificationActivated: vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

describe('agentNotificationApi', () => {
  it('各関数は window.api の同名の関数へ引数をそのまま渡す', () => {
    const unsubscribe = vi.fn()
    mockApi.onAgentNotificationActivated.mockReturnValue(unsubscribe)
    const listener = vi.fn()
    agentNotificationApi.showAgentNotification({ slotId: 's-1', tabNumber: 1, kind: 'done' })
    agentNotificationApi.setAgentNotificationBadge(2)
    expect(agentNotificationApi.onAgentNotificationActivated(listener)).toBe(unsubscribe)
    expect(mockApi.showAgentNotification).toHaveBeenCalledWith({
      slotId: 's-1',
      tabNumber: 1,
      kind: 'done'
    })
    expect(mockApi.setAgentNotificationBadge).toHaveBeenCalledWith(2)
    expect(mockApi.onAgentNotificationActivated).toHaveBeenCalledWith(listener)
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentNotifications.test.ts`:
```ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import type { AgentActivity } from '../../lib/agentActivity'

vi.mock('../../lib/agentNotificationApi')

import * as agentNotificationApi from '../../lib/agentNotificationApi'
import { useAgentNotifications } from '../useAgentNotifications'
import type { AgentNotificationTab, UseAgentNotificationsOptions } from '../useAgentNotifications'

const mockShow = vi.mocked(agentNotificationApi.showAgentNotification)
const mockSetBadge = vi.mocked(agentNotificationApi.setAgentNotificationBadge)
const mockOnActivated = vi.mocked(agentNotificationApi.onAgentNotificationActivated)
const unsubscribe = vi.fn()
let activated: (payload: { slotId: string }) => void = () => undefined
let warnSpy: MockInstance<typeof console.warn>

beforeEach(() => {
  vi.resetAllMocks()
  mockShow.mockResolvedValue(undefined)
  mockSetBadge.mockResolvedValue(undefined)
  activated = () => undefined
  mockOnActivated.mockImplementation((listener) => {
    activated = listener
    return unsubscribe
  })
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warnSpy.mockRestore()
})

const tab = (n: number, overrides: Partial<AgentNotificationTab> = {}): AgentNotificationTab => ({
  slotId: `slot-${n}`,
  number: n,
  status: 'running',
  isClosing: false,
  ...overrides
})
const acts = (...entries: [string, AgentActivity][]): ReadonlyMap<string, AgentActivity> =>
  new Map(entries)

/** 初期の props で描画し、update で一部を差し替えて描画し直す */
function setup(initial: Partial<UseAgentNotificationsOptions> = {}) {
  const activateTab = vi.fn<(slotId: string) => void>()
  let props: UseAgentNotificationsOptions = {
    tabs: [tab(1)],
    activities: acts(['slot-1', 'unknown']),
    enabled: true,
    activateTab,
    ...initial
  }
  const hook = renderHook((p: UseAgentNotificationsOptions) => useAgentNotifications(p), {
    initialProps: props
  })
  const update = (next: Partial<UseAgentNotificationsOptions>): void => {
    props = { ...props, ...next }
    hook.rerender(props)
  }
  return { ...hook, activateTab, update }
}

describe('useAgentNotifications', () => {
  describe('出来事', () => {
    it('working → idle で作業の完了を読み上げ、通知を送る', () => {
      const { result, update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ activities: acts(['slot-1', 'idle']) })
      expect(result.current).toBe('claude 1 の作業が終わりました')
      expect(mockShow).toHaveBeenCalledExactlyOnceWith({ slotId: 'slot-1', tabNumber: 1, kind: 'done' })
    })

    it('unknown を挟んでも許可待ちを 1 回だけ知らせる', () => {
      const { result, update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ activities: acts(['slot-1', 'unknown']) })
      update({ activities: acts(['slot-1', 'permission']) })
      update({ activities: acts(['slot-1', 'unknown']) })
      update({ activities: acts(['slot-1', 'permission']) })
      expect(result.current).toBe('claude 1 が許可待ちになりました')
      expect(mockShow.mock.calls).toEqual([[{ slotId: 'slot-1', tabNumber: 1, kind: 'permission' }]])
    })

    it('起動の直後の idle は知らせず、confirm は知らせる', () => {
      const { result, update } = setup({ tabs: [tab(1, { status: 'starting' })] })
      update({ tabs: [tab(1)], activities: acts(['slot-1', 'idle']) })
      expect(result.current).toBe('')
      expect(mockShow).not.toHaveBeenCalled()
      update({ tabs: [tab(2)], activities: acts(['slot-2', 'confirm']) })
      expect(result.current).toBe('claude 2 が確認待ちになりました')
      expect(mockShow).toHaveBeenCalledWith({ slotId: 'slot-2', tabNumber: 2, kind: 'confirm' })
    })

    it.each([false, null])('設定が %s なら通知を送らないが、読み上げはする', (enabled) => {
      const { result, update } = setup({ enabled, activities: acts(['slot-1', 'working']) })
      update({ activities: acts(['slot-1', 'permission']) })
      expect(result.current).toBe('claude 1 が許可待ちになりました')
      expect(mockShow).not.toHaveBeenCalled()
    })

    it('閉じる途中のタブは読み上げも通知もしない', () => {
      const { result, update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ tabs: [tab(1, { isClosing: true })], activities: acts(['slot-1', 'permission']) })
      expect(result.current).toBe('')
      expect(mockShow).not.toHaveBeenCalled()
    })

    it('running でないタブは知らせず、記録を忘れる(再起動の直後の idle を完了としない)', () => {
      const { update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ tabs: [tab(1, { status: 'exited' })], activities: acts(['slot-1', 'unknown']) })
      update({ tabs: [tab(1)], activities: acts(['slot-1', 'idle']) })
      expect(mockShow).not.toHaveBeenCalled()
    })

    it('unknown のまま終了して再起動しても(活動の Map が同じ参照でも)完了を出さない', () => {
      const unknown = acts(['slot-1', 'unknown'])
      const { update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ activities: unknown })
      // 活動の Map は同じ参照のまま、タブの一覧だけが変わる
      update({ tabs: [tab(1, { status: 'exited' })] })
      update({ tabs: [tab(1, { status: 'starting' })] })
      update({ tabs: [tab(1)] })
      update({ activities: acts(['slot-1', 'idle']) })
      expect(mockShow).not.toHaveBeenCalled()
    })

    it('消えたタブの記録を忘れる', () => {
      const { update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ tabs: [tab(2)], activities: acts(['slot-2', 'unknown']) })
      update({ tabs: [tab(1), tab(2)], activities: acts(['slot-1', 'idle'], ['slot-2', 'unknown']) })
      expect(mockShow).not.toHaveBeenCalled()
    })

    it('同じ描画で複数のタブに出来事があれば、読み上げをつなぎ、通知をタブごとに送る', () => {
      const { result, update } = setup({
        tabs: [tab(1), tab(2)],
        activities: acts(['slot-1', 'working'], ['slot-2', 'working'])
      })
      update({ activities: acts(['slot-1', 'permission'], ['slot-2', 'idle']) })
      expect(result.current).toBe('claude 1 が許可待ちになりました。claude 2 の作業が終わりました')
      expect(mockShow).toHaveBeenCalledTimes(2)
    })
  })

  describe('バッジ', () => {
    it('マウントの直後は 0 でも必ず送る', () => {
      setup()
      expect(mockSetBadge.mock.calls).toEqual([[0]])
    })

    it('最後の確かな活動が許可待ち・確認待ちのタブを数え、一時的な unknown では揺れない', () => {
      const { update } = setup({
        tabs: [tab(1), tab(2), tab(3)],
        activities: acts(['slot-1', 'working'], ['slot-2', 'working'], ['slot-3', 'working'])
      })
      update({ activities: acts(['slot-1', 'permission'], ['slot-2', 'confirm'], ['slot-3', 'idle']) })
      update({ activities: acts(['slot-1', 'unknown'], ['slot-2', 'confirm'], ['slot-3', 'idle']) })
      update({ activities: acts(['slot-1', 'working'], ['slot-2', 'confirm'], ['slot-3', 'idle']) })
      expect(mockSetBadge.mock.calls).toEqual([[0], [2], [1]])
    })

    it('閉じる途中・running でないタブは数えない(L-393)', () => {
      const { update } = setup({
        tabs: [tab(1), tab(2)],
        activities: acts(['slot-1', 'permission'], ['slot-2', 'permission'])
      })
      update({ tabs: [tab(1, { isClosing: true }), tab(2, { status: 'exited' })] })
      expect(mockSetBadge.mock.calls).toEqual([[2], [0]])
    })

    it('設定がオフ・読み込み中なら 0 を送る', () => {
      const { update } = setup({ enabled: null, activities: acts(['slot-1', 'permission']) })
      update({ enabled: true })
      update({ enabled: false })
      expect(mockSetBadge.mock.calls).toEqual([[0], [1], [0]])
    })

    it('アンマウントで 0 を送る', () => {
      const { unmount } = setup({ activities: acts(['slot-1', 'permission']) })
      unmount()
      expect(mockSetBadge.mock.calls).toEqual([[1], [0]])
    })
  })

  describe('通知を押したとき', () => {
    it('今あるタブなら activateTab を呼ぶ', () => {
      const { activateTab } = setup()
      act(() => activated({ slotId: 'slot-1' }))
      expect(activateTab).toHaveBeenCalledExactlyOnceWith('slot-1')
    })

    it('閉じたタブなら何もしない', () => {
      const { activateTab, update } = setup({ tabs: [tab(1), tab(2)] })
      update({ tabs: [tab(1)] })
      act(() => activated({ slotId: 'slot-2' }))
      expect(activateTab).not.toHaveBeenCalled()
    })

    it('アンマウントで購読を外す', () => {
      const { unmount } = setup()
      unmount()
      expect(unsubscribe).toHaveBeenCalledOnce()
    })
  })

  describe('IPC の失敗', () => {
    it('通知・バッジの送信が拒否されても、読み上げは続け、console.warn に出す', async () => {
      mockShow.mockRejectedValue(new Error('show failed'))
      mockSetBadge.mockRejectedValue(new Error('badge failed'))
      const { result, update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ activities: acts(['slot-1', 'permission']) })
      await act(async () => {
        await Promise.resolve()
      })
      expect(result.current).toBe('claude 1 が許可待ちになりました')
      expect(warnSpy).toHaveBeenCalledWith(
        '[useAgentNotifications] showAgentNotification failed:',
        expect.any(Error)
      )
      expect(warnSpy).toHaveBeenCalledWith(
        '[useAgentNotifications] setAgentNotificationBadge failed:',
        expect.any(Error)
      )
    })

    it('送信が同期で投げても、ほかのタブの出来事を止めない(L-053)', () => {
      mockShow.mockImplementation(() => {
        throw new Error('sync')
      })
      const { result, update } = setup({
        tabs: [tab(1), tab(2)],
        activities: acts(['slot-1', 'working'], ['slot-2', 'working'])
      })
      update({ activities: acts(['slot-1', 'permission'], ['slot-2', 'permission']) })
      expect(mockShow).toHaveBeenCalledTimes(2)
      expect(result.current).toBe('claude 1 が許可待ちになりました。claude 2 が許可待ちになりました')
    })
  })
})
```
（`toHaveBeenCalledExactlyOnceWith` が今の Vitest に無ければ、`toHaveBeenCalledTimes(1)` と `toHaveBeenCalledWith` に分ける。）

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentNotificationApi.test.ts src/renderer/src/hooks/__tests__/useAgentNotifications.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: API と hook を実装する**

`src/renderer/src/lib/agentNotificationApi.ts`:
```ts
import type { AgentNotificationActivated, AgentNotificationShowRequest } from '@shared/types'

// エージェントの通知の IPC の窓口(window.api)。renderer の部品は window.api を直接触らずここを使う

export function showAgentNotification(request: AgentNotificationShowRequest): Promise<void> {
  return window.api.showAgentNotification(request)
}

export function setAgentNotificationBadge(count: number): Promise<void> {
  return window.api.setAgentNotificationBadge(count)
}

export function onAgentNotificationActivated(
  listener: (payload: AgentNotificationActivated) => void
): () => void {
  return window.api.onAgentNotificationActivated(listener)
}
```

`src/renderer/src/hooks/useAgentNotifications.ts`:
```ts
import { useEffect, useRef, useState } from 'react'
import type { AgentNotificationShowRequest } from '@shared/types'
import { agentNotificationText } from '@shared/agentNotificationText'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentSessionStatus } from '../lib/agentSessionTabState'
import { nextAgentNotification } from '../lib/agentNotificationEvents'
import * as agentNotificationApi from '../lib/agentNotificationApi'
import { useLatestRef } from './useLatestRef'

// エージェントの完了・許可待ちの知らせ(設計書「活動の変化の監視」)。タブごとの最後の確かな活動の変化から出来事を決め、
// 読み上げの文言を返し、設定がオンなら OS の通知を main へ頼む(フォーカスの有無は main が判断する)。待っているタブの数を
// バッジとして送り、通知を押した知らせを受けてタブへ移る。活動の判定とそのデバウンスは useAgentActivity のまま使う(L-399)

export interface AgentNotificationTab {
  slotId: string
  /** タブの番号(題・読み上げの claude N) */
  number: number
  status: AgentSessionStatus
  /** 閉じる途中(知らせず、バッジに数えない) */
  isClosing: boolean
}

export interface UseAgentNotificationsOptions {
  tabs: readonly AgentNotificationTab[]
  activities: ReadonlyMap<string, AgentActivity>
  /** 通知の設定。読み込み中は null(通知もバッジも出さない。読み上げはする) */
  enabled: boolean | null
  /** 通知を押したときにタブへ移る(useAgentTabActivation) */
  activateTab: (slotId: string) => void
}

/** バッジに数える活動(利用者の操作を待っている) */
const WAITING_FOR_USER: ReadonlySet<AgentActivity> = new Set(['permission', 'confirm'])

/** IPC の失敗(拒否・同期の例外)を握りつぶして記録する。通知が出せなくても活動の表示・読み上げは止めない(L-053) */
function callQuietly(label: string, call: () => Promise<void>): void {
  try {
    call().catch((err: unknown) => console.warn(`[useAgentNotifications] ${label} failed:`, err))
  } catch (err) {
    console.warn(`[useAgentNotifications] ${label} failed:`, err)
  }
}

/** 読み上げの文言(常設の aria-live の領域に渡す)。まだ出来事が無ければ '' */
export function useAgentNotifications({
  tabs,
  activities,
  enabled,
  activateTab
}: UseAgentNotificationsOptions): string {
  const [announcement, setAnnouncement] = useState('')
  // タブごとの最後の確かな活動(unknown を除いた直近の活動)
  const settledRef = useRef(new Map<string, AgentActivity>())
  // 前回送ったバッジの数。未送信は null(マウントの直後は 0 でも送り、リロードの前のバッジを上書きする)
  const lastBadgeRef = useRef<number | null>(null)
  const enabledRef = useLatestRef(enabled)
  const tabsRef = useLatestRef(tabs)
  const activateTabRef = useLatestRef(activateTab)

  // 出来事の決定。活動の Map は内容が同じなら同じ参照のまま(running でないタブは unknown)なので、unknown のまま終了・
  // 再起動したタブは活動の Map だけでは変化が見えない。タブの一覧(status・isClosing)の変化でも必ず見直し、消えたタブ・
  // running でないタブの記録を消す(消し忘れると、再起動の直後の idle を working → idle の完了と誤って知らせる)
  useEffect(() => {
    // set-state-in-effect の対策で、setState は effect 内のローカル関数から呼ぶ(useAgentActivity の commit と同じ)
    const announce = (message: string): void => {
      setAnnouncement(message)
    }
    const settled = settledRef.current
    const present = new Set(tabs.map((tab) => tab.slotId))
    for (const slotId of [...settled.keys()]) {
      if (!present.has(slotId)) settled.delete(slotId)
    }
    const messages: string[] = []
    for (const tab of tabs) {
      if (tab.status !== 'running') {
        settled.delete(tab.slotId)
        continue
      }
      const decision = nextAgentNotification(
        settled.get(tab.slotId) ?? null,
        activities.get(tab.slotId) ?? 'unknown'
      )
      if (decision.settled === null) settled.delete(tab.slotId)
      else settled.set(tab.slotId, decision.settled)
      // 閉じる途中のタブは記録だけ進めて知らせない(停止に失敗して戻ったときに、古い記録で誤って知らせない)
      if (decision.kind === null || tab.isClosing) continue
      messages.push(agentNotificationText(decision.kind, tab.number).announcement)
      if (enabledRef.current === true) {
        const request: AgentNotificationShowRequest = {
          slotId: tab.slotId,
          tabNumber: tab.number,
          kind: decision.kind
        }
        callQuietly('showAgentNotification', () =>
          agentNotificationApi.showAgentNotification(request)
        )
      }
    }
    if (messages.length > 0) announce(messages.join('。'))
  }, [tabs, activities, enabledRef])

  // バッジ。今の活動ではなく最後の確かな活動で数える(判定の一時的な unknown で数が揺れないように)。上の effect の後に走る
  useEffect(() => {
    const settled = settledRef.current
    const count = tabs.filter(
      (tab) =>
        tab.status === 'running' &&
        !tab.isClosing &&
        WAITING_FOR_USER.has(settled.get(tab.slotId) ?? 'unknown')
    ).length
    const next = enabled === true ? count : 0
    if (lastBadgeRef.current === next) return
    lastBadgeRef.current = next
    callQuietly('setAgentNotificationBadge', () =>
      agentNotificationApi.setAgentNotificationBadge(next)
    )
  }, [tabs, activities, enabled])

  // アンマウントでバッジを消す(StrictMode の取り付け直しでは、次の取り付けで未送信として送り直す)
  useEffect(
    () => () => {
      lastBadgeRef.current = null
      callQuietly('setAgentNotificationBadge', () =>
        agentNotificationApi.setAgentNotificationBadge(0)
      )
    },
    []
  )

  // 通知を押した知らせ。今のタブの一覧にあればそのタブへ移り、無ければ(閉じたタブ)何もしない
  useEffect(
    () =>
      agentNotificationApi.onAgentNotificationActivated(({ slotId }) => {
        if (!tabsRef.current.some((tab) => tab.slotId === slotId)) return
        activateTabRef.current(slotId)
      }),
    [tabsRef, activateTabRef]
  )

  return announcement
}
```
（バッジの effect の依存に `activities` を入れるのは、活動だけが変わって最後の確かな活動が変わった描画でも数え直すため。`react-hooks/exhaustive-deps` が不要な依存と指摘した場合は、`useEffect` の直前に `// eslint-disable-next-line react-hooks/exhaustive-deps -- 最後の確かな活動(ref)は活動の変化で変わる` を置く。）

- [ ] **Step 4: API と hook のテストを通す**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentNotificationApi.test.ts src/renderer/src/hooks/__tests__/useAgentNotifications.test.ts`
Expected: PASS

- [ ] **Step 5: 失敗するテストを書く（タブの番号・配線・読み上げの領域）**

`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`: 「一覧の slotId のタブに合わせ、…」のテストの `toMatchObject` に `number: 2` を足す:
```ts
      expect(tabOf(result.current, 'restored')).toMatchObject({
        status: 'running',
        label: 'claude 2',
        number: 2
      })
```

`src/renderer/src/components/agent/__tests__/AgentAnnouncer.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AgentAnnouncer from '../AgentAnnouncer'

describe('AgentAnnouncer', () => {
  it('polite・atomic の常設の領域に文言を出し、同じ要素の文言を入れ替える', () => {
    const { rerender } = render(<AgentAnnouncer message="claude 1 が許可待ちになりました" />)
    const region = screen.getByText('claude 1 が許可待ちになりました')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveAttribute('aria-atomic', 'true')
    rerender(<AgentAnnouncer message="claude 1 の作業が終わりました" />)
    expect(screen.getByText('claude 1 の作業が終わりました')).toBe(region)
  })

  it('文言が空でも領域は残す(後から入れた文言を読み上げるため)', () => {
    const { container } = render(<AgentAnnouncer message="" />)
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull()
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`: hoisted の mock に足す:
```ts
const mockUseAgentNotifications = vi.hoisted(() => vi.fn((_options: unknown) => ''))
vi.mock('../useAgentNotifications', () => ({ useAgentNotifications: mockUseAgentNotifications }))
```
`beforeEach` に `mockUseAgentNotifications.mockReturnValue('')` を足し、`describe('useAgentWorkspace'` の中に足す:
```ts
  describe('通知(useAgentNotifications)', () => {
    it('タブ・活動・通知の設定を渡し、読み上げの文言を返す', () => {
      const sessions = otherTabIs('running')
      mockUseAgentSessions.mockReturnValue(sessions)
      const activities = new Map([['slot-2', 'permission']])
      mockUseAgentActivity.mockReturnValue(activities)
      mockUseAgentNotificationSetting.mockReturnValue({
        enabled: false,
        saveError: null,
        changeEnabled: vi.fn(async () => true)
      })
      mockUseAgentNotifications.mockReturnValue('claude 2 が許可待ちになりました')
      const { result } = renderWorkspace()
      const options = mockUseAgentNotifications.mock.calls.at(-1)![0] as {
        tabs: unknown
        activities: unknown
        enabled: unknown
      }
      expect(options.tabs).toBe(sessions.tabs)
      expect(options.activities).toBe(activities)
      expect(options.enabled).toBe(false)
      expect(result.current.agentAnnouncement).toBe('claude 2 が許可待ちになりました')
    })

    it('通知を押したときの activateTab は、パネルを開いてタブを選び、描画の後にそのターミナルへフォーカスを移す', () => {
      setMode('agent-cli')
      const tabs = [1, 2].map((n) =>
        makeAgentSessionTabView({ slotId: `slot-${n}`, label: `claude ${n}`, number: n, status: 'running' })
      )
      const selectTab = vi.fn((slotId: string) => {
        mockUseAgentSessions.mockReturnValue(
          makeAgentSessionsState({ tabs, selected: { slotId }, selectTab })
        )
      })
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ tabs, selected: { slotId: 'slot-1' }, selectTab })
      )
      const { result } = renderWorkspace()
      act(() => result.current.agentTerminal.layout.toggleOpen())
      const { activateTab } = mockUseAgentNotifications.mock.calls.at(-1)![0] as {
        activateTab: (slotId: string) => void
      }
      act(() => activateTab('slot-2'))
      expect(result.current.agentTerminal.layout.isOpen).toBe(true)
      expect(selectTab).toHaveBeenCalledWith('slot-2')
      expect(tabs[1].controller.focus).toHaveBeenCalledTimes(1)
      expect(tabs[0].controller.focus).not.toHaveBeenCalled()
    })
  })
```
（`renderWorkspace`・`setMode`・`otherTabIs` は同じファイルの既存のヘルパー。名前が違えば今のヘルパーに合わせる。）

`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`: Task 3 で足した「通知の設定の項目を…」の次に、同じ形で足す:
```ts
    it('読み上げの文言を、useAgentWorkspace の戻り値のまま公開する', () => {
      mockUseAgentWorkspace.mockReturnValue(
        makeAgentWorkspaceState({ agentAnnouncement: 'claude 1 が許可待ちになりました' })
      )
      const { result } = renderHook(() => useAppState())
      expect(result.current.agentAnnouncement).toBe('claude 1 が許可待ちになりました')
    })
```

`src/renderer/src/components/__tests__/App.agentCli.test.tsx` に足す:
```tsx
  it('エージェントの状態の変化の読み上げの領域を、パネルの外(ステータスバーの隣)に常設する', async () => {
    const { container } = render(<App />)
    await screen.findByRole('region', { name: 'エージェント' })
    const region = container.querySelector('.agent-announcer')
    expect(region).not.toBeNull()
    expect(region).toHaveAttribute('aria-live', 'polite')
    // パネル(region「エージェント」)の中ではない
    expect(screen.getByRole('region', { name: 'エージェント' }).contains(region)).toBe(false)
  })
```

- [ ] **Step 6: 落ちることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/components/agent/__tests__/AgentAnnouncer.test.tsx src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/App.agentCli.test.tsx`
Expected: FAIL

- [ ] **Step 7: 配線と読み上げの領域を実装する**

`src/renderer/src/hooks/useAgentSessions.ts`: `AgentSessionTabView` に足す（`label` の前）:
```ts
  /** タブの番号(agentSessionTabs の AgentSessionTab.number。通知の題・読み上げに使う) */
  number: number
```
`tabViews` の組み立てに `number: tab.number,` を足す（`label: formatAgentTabLabel(tab.number),` の前）。

`src/renderer/src/__tests__/makeAgentSessionsState.ts` の `makeAgentSessionTabView` の既定に `number: 1,` を足す（`label` の前）。

`src/renderer/src/hooks/useAgentWorkspace.ts`:
- `import { useAgentNotifications } from './useAgentNotifications'` を足す。
- `AgentWorkspaceState` に足す:
```ts
  /** エージェントの状態の変化の読み上げの文言(App がステータスバーの隣の常設の aria-live の領域に出す) */
  agentAnnouncement: string
```
- `useAgentStatusBar` の呼び出しの次に足す:
```ts
  // 完了・許可待ちの知らせ(読み上げ・OS の通知・バッジ)。通知を押したときはステータスバーと同じくタブへ移る
  const agentAnnouncement = useAgentNotifications({
    tabs: agentSessions.tabs,
    activities,
    enabled: notificationSetting.enabled,
    activateTab: activateAgentTab
  })
```
- 戻り値の `statusBarAgent,` の次に `agentAnnouncement,` を足す。

`src/renderer/src/hooks/useAppState.ts` の戻り値の `statusBarAgent: agentWorkspace.statusBarAgent,` の次に足す:
```ts
    agentAnnouncement: agentWorkspace.agentAnnouncement,
```

`src/renderer/src/__tests__/makeAgentWorkspaceState.ts` の戻り値の `statusBarAgent: null,` の次に足す:
```ts
    agentAnnouncement: '',
```

`src/renderer/src/components/agent/AgentAnnouncer.tsx`:
```tsx
'use client'

interface Props {
  /** 読み上げの文言(まだ無ければ '') */
  message: string
}

// エージェントの状態の変化の読み上げ(通知の設計書「読み上げの領域」)。パネルの開閉に関わらず App が常に描画し、同じ要素の
// 文言を入れ替える(既存の常設の aria-live と同じ。パターン 87)。同じタブの同じ出来事が続くと文言が変わらず、読み上げが省かれうる(既知の制約)
export default function AgentAnnouncer({ message }: Props): React.JSX.Element {
  return (
    <p className="agent-announcer" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  )
}
```

`src/renderer/src/App.tsx`: `import AgentAnnouncer from './components/agent/AgentAnnouncer'` を足し、`useAppState()` の分割代入の `statusBarAgent,` の次に `agentAnnouncement,` を足し、`<StatusBar agent={statusBarAgent} />` の次に置く:
```tsx
      <AgentAnnouncer message={agentAnnouncement} />
```

`src/renderer/src/assets/main.css` の `.external-change-banner__live,` と `.agent-diff__live {` の規則のセレクタに `.agent-announcer` を足す:
```css
.external-change-banner__live,
.agent-diff__live,
.agent-announcer {
```

- [ ] **Step 8: テストを通す・型チェック・lint**

Run: `npx vitest run src/renderer`
Expected: PASS
Run: `npm run typecheck`
Run: `npx eslint --max-warnings 0 src/renderer/src/lib/agentNotificationApi.ts src/renderer/src/hooks/useAgentNotifications.ts src/renderer/src/hooks/useAgentSessions.ts src/renderer/src/__tests__/makeAgentSessionsState.ts src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/components/agent/AgentAnnouncer.tsx src/renderer/src/App.tsx src/renderer/src/lib/__tests__/agentNotificationApi.test.ts src/renderer/src/hooks/__tests__/useAgentNotifications.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/components/agent/__tests__/AgentAnnouncer.test.tsx src/renderer/src/components/__tests__/App.agentCli.test.tsx`
Expected: エラー・警告なし

---

### Task 6: ROADMAP・実機テスト仕様書の更新と全体の検証

**Files:** `ROADMAP.md`、`docs/manual-test-spec.md`、`.superpowers/manual-test-spec.html`（生成。git 管理外）

- [ ] **Step 1: ROADMAP**
  - 「エージェント実行の支援（MVP の次）」の `- [ ] 完了・許可待ちの通知（ウィンドウが背面でも気づける）` を消す。
  - 「実装済み機能」の `### エージェントのセッションの状態表示` の節の後に `### エージェントの完了・許可待ちの通知` を足す。設計書（`docs/superpowers/specs/2026-10-10-agent-activity-notification-design.md`、2026-10-10）を書き、次を `- [x]` で並べる: きっかけ（許可待ち・確認待ち・作業の完了。最後の確かな活動の変化で決め、起動の直後の入力待ちは知らせない）／ウィンドウにフォーカスが無いときだけ OS の通知（タブごとに最新の 1 件）、macOS は Dock のバッジ（許可待ち・確認待ちのタブの数）、Windows・Linux はタスクバーのボタンの点滅（フォーカスで止まる）／通知を押すとウィンドウを前面にし、パネルを開いてそのタブを選び、ターミナルへフォーカスを移す／状態の変化をステータスバーの隣の常設の `aria-live` で読み上げる（前面でも。設定に関わらず）／設定画面の「エージェントの通知」（既定はオン。オフで OS の通知とバッジを止める）／ウィンドウを閉じる・リロードで残っている通知を閉じる／`AppUserModelId` を `appId`（`com.electron.app`）に合わせた。
  - その下に「既知の制約」として設計書の「既知の制約」の 6 項目と、「ウィンドウを閉じたときにバッジを 0 に戻す（1 ウィンドウの前提）」を書く。
  - `### エージェントのセッションの状態表示` の既知の制約の最後の行「状態の変化の読み上げ（`aria-live`）と通知は含めない（次の項目「完了・許可待ちの通知」）」を、過去の状態と区別して「状態表示の時点（2026-10-09）では、状態の変化の読み上げ（`aria-live`）と通知を含めなかった。完了・許可待ちの通知（2026-10-10。上の「エージェントの完了・許可待ちの通知」）で対応した」に直す。

- [ ] **Step 2: 実機テスト仕様書**
  - 最大の番号を確かめる: `grep -o 'AGT-[0-9]*' docs/manual-test-spec.md | sort -t- -k2 -n | tail -1`（計画の時点では `AGT-123`。違えばその次から振る）。
  - `grep -n '^## \|^### ' docs/manual-test-spec.md` で、`### セッションの状態表示` が `## エージェント CLI のアプリ内ターミナル` の領域の最後の `###` であることを確かめる（後ろに別の `###` が増えていれば、その領域の最後の `###` の後に足す）。
  - `## エージェント CLI のアプリ内ターミナル` の最後の `### セッションの状態表示` の後に、次の節を足す（書式は `- [ ] **<ID>** <手順> → <期待結果>`、1 行 1 項目。番号は計画の時点の想定で、Step 2 の確認に合わせて振り直す）:
```markdown
### 完了・許可待ちの通知

> 前提: Claude Code（`claude`）がインストールされログイン済みで、テスト用のフォルダを開いている（設定の実行方式はエージェント CLI、設定の「エージェントの通知」はオン）。OS の通知の設定で prompt-ide（開発中は Electron）の通知を許可しておく。「背面」は、ほかのアプリ（Finder など）をクリックして prompt-ide のウィンドウからフォーカスを外した状態。

- [ ] **AGT-124** `claude` にファイルの作成を頼み、すぐ背面にして、ツールの許可の確認が出るまで待つ → OS の通知が 1 件出る（題 `claude 1: 許可待ち`、本文 `ツールの実行の許可を待っています`）。macOS では Dock のアイコンにバッジ `1` が出る
- [ ] **AGT-125** `claude` に短い作業（例: ファイルの一覧を答えさせる）を頼み、すぐ背面にして、作業が終わるまで待つ → OS の通知 `claude 1: 作業が終わりました`（本文 `次の指示を待っています`）が出る。バッジは出ない（作業の完了は数えない）
- [ ] **AGT-126** `/model` を入力して選択の画面を出し、背面にする前と後で見る（背面にしてから `/model` を送るのでもよい）→ 背面で選択の画面になったとき `claude 1: 確認待ち`（本文 `選択を待っています`）の通知が出て、バッジ `1` が出る
- [ ] **AGT-127** ウィンドウを前面のまま（フォーカスがある状態で）、VoiceOver を有効にして許可の確認・作業の完了を起こす → OS の通知は出ない。VoiceOver が `claude 1 が許可待ちになりました`・`claude 1 の作業が終わりました` を読み上げる。バッジは前面でも許可待ちの間 `1` が出る
- [ ] **AGT-128** タブを 2 つ起動し、パネルを閉じて `claude 1` を選択した状態で、`claude 2` を許可待ちにして背面にし、出た通知を押す → prompt-ide のウィンドウが前面に来て、パネルが開き、`claude 2` のタブが選ばれ、そのターミナルにフォーカスがある（キー入力がそのまま `claude 2` に入る）
- [ ] **AGT-129** ウィンドウを最小化（macOS は Dock にしまう）してから、許可待ちの通知を出して押す → ウィンドウが元の大きさに戻って前面に来て、AGT-128 と同じくそのタブのターミナルにフォーカスがある
- [ ] **AGT-130** 背面で `claude 1` を許可待ちにして通知を出し、通知を押さずに前面へ戻って許可し、すぐ背面にして `claude 1` を再び許可待ちにする。別の回に、背面で `claude 1` と `claude 2` を続けて許可待ちにする → 同じタブの通知は最新の 1 件だけが通知センターに残り（前の通知は消える）、別々のタブの通知はタブごとに 1 件ずつ残る
- [ ] **AGT-131** 2 つのタブを許可待ち・確認待ちにして、1 つずつ許可・選択して作業に戻す → macOS の Dock のバッジが `2` → `1` → 消える、と待っているタブの数に合わせて変わる。判定の一時的な揺れでバッジが点滅したり数が飛んだりしない
- [ ] **AGT-132** 設定を開き、`エージェントの通知` の節を見て、チェックボックスにキーボード（Tab）で移り VoiceOver で聞く → 見出し `エージェントの通知`、チェックボックス `ウィンドウが背面のとき、許可待ち・確認待ち・作業の完了を通知する`（既定でオン）と説明が読める。チェックボックスの行はタッチで押せる高さがある
- [ ] **AGT-133** 許可待ちでバッジが出ている状態で、設定のチェックボックスを外し、背面で許可待ち・作業の完了を起こす → バッジがすぐ消え、背面でも OS の通知が出ない。前面では読み上げは続く。チェックを戻すとバッジと通知が戻る。アプリを終了して起動し直しても外した設定が残る
- [ ] **AGT-134** 通知が通知センターに残っている状態で、開発中の起動でリロード（`Cmd+R`）する → 残っていた prompt-ide の通知が通知センターから消え、バッジはリロードの後の状態（タブが 1 つに戻るので消える）に上書きされる
- [ ] **AGT-135** 通知が残りバッジが出ている状態で、macOS でウィンドウを閉じる（アプリは終了しない）→ 残っていた通知が消え、Dock のバッジも消える
- [ ] **AGT-136** `claude` を起動した直後（入力欄が空の入力待ち）、信頼していない新しいフォルダでの起動（フォルダの信頼の確認）、`終了` で止めたとき、タブを閉じる確認の後に止まるまでの間を、それぞれ背面で見る → 起動の直後の入力待ち・終了・閉じる途中では通知が出ない。フォルダの信頼の確認では `確認待ち` の通知が出る
- [ ] **AGT-137** OS の通知の設定で prompt-ide（開発中は Electron）の通知を切ってから、背面で許可待ちを起こす → 通知は出ないが、アプリはエラーにならず、タブの印・ステータスバー・読み上げは従来どおり変わる
- [ ] **AGT-138** 【要 Windows または Linux】背面で許可待ちを起こす → 通知が出て、タスクバーの prompt-ide のボタンが点滅する。ウィンドウを前面にすると点滅が止まる。Dock のバッジに当たる表示は出ない
- [ ] **AGT-139** 【要 Windows】パッケージ版（`npm run build:win` の成果物をインストール）で、背面で許可待ちを起こして通知を押す → 通知の送り元が prompt-ide と表示され、押すと AGT-128 と同じくそのタブへ戻る
```
  - 既存の `BASE-007`（設定のセクションの数）を、今の画面に合わせて直す（ID は変えない）: `` `設定` アイコンをクリックする → サイドバーの見出しが `設定` に変わり `プロンプトの実行方式`・`エージェントの通知`・`Anthropic API キー`・`モデル` の 4 つのセクションが表示される ``
  - 既存の項目で、ステータスバー・設定画面の見た目の記述が今回の変更で食い違うものが無いかを `grep -n '設定' docs/manual-test-spec.md` で確かめ、あれば手順・期待結果を直す（ID は変えない）。

- [ ] **Step 3: HTML の再生成と仕様書の検査**

Run: `node scripts/build-manual-test-spec.mjs && npx vitest run scripts`
Expected: `.superpowers/manual-test-spec.html` が更新され、scripts のテスト（ID の一意性・接頭辞ごとの連番の昇順・書式）が PASS

- [ ] **Step 4: Artifact の再公開**

Artifact ツールで、`.superpowers/manual-test-spec.html`（同じファイルパス）を既存の Artifact（<manual-test-spec-artifact-url>）へ再公開する（`url` にこの URL を渡す。この会話でまだ読んでいなければ、先に `action: "read"` で読んでから公開する）。公開の結果の URL が同じであることを確かめる。

- [ ] **Step 5: 全体の検証**

Run: `npx vitest run`
Expected: すべて PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: `npx eslint --max-warnings 0` に、このプランで作成・変更した TypeScript のファイルをすべて渡す（`git status --porcelain` の `.ts`・`.tsx` の一覧から作る）
Expected: エラー・警告なし
