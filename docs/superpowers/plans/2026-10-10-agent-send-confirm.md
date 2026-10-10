# エージェントへの送信前の確認 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エージェント CLI 方式でプロンプトの `実行` を押したとき、送る前に「送信前の確認」のダイアログで、変数を差し込んだ後の全文・送り先のタブ・文字数・送れない理由を確かめてから `送信` できるようにする（設定でオン・オフ、既定はオン）。

**Architecture:** 設定は通知の設定と同じ形（`settings.json` の `agentSendConfirmEnabled`・IPC・`settingsApi`・hook・設定画面の節）で足し、真偽値の設定の hook は `useBooleanSetting` に共通化する。確認の状態（開いている依頼・控えた送り先・送信・キャンセル）は新しい `useAgentSendConfirm` が持ち、`useAgentWorkspace.sendToAgent` が設定に応じて「確認を開く／すぐ送る」を選ぶ。閉じる契機（方式・フォルダ・タブ）と送り先の今の状態の理由は `useAgentWorkspace` が求め、ダイアログ（`AgentSendConfirmDialog`）は表示・フォーカス・送れない理由（`normalizeAgentPrompt`）を受け持つ。`App` がダイアログを描画する。

**Tech Stack:** React 19, TypeScript, Electron（IPC）, Vitest, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-10-agent-send-confirm-design.md`（承認済み。実装の前に必ず読む）

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
> - 送れない理由が「長すぎる」「先頭が `!`」のときも、正規化した後の全文と文字数を出すため、`normalizeAgentPrompt` の前半（改行の統一と制御文字の除去）を `cleanAgentPromptText`（`src/shared/agentPasteText.ts`）に切り出し、`normalizeAgentPrompt` はそれを使う（振る舞いは変えない。`normalizeAgentPrompt` の `rejected` は本文を返さないため）。ダイアログの表示の値は renderer の純粋な関数 `buildAgentSendPreview`（`src/renderer/src/lib/agentSendPreview.ts`。`cleanAgentPromptText` と `normalizeAgentPrompt` を直接呼び、`AGENT_SEND_FAILURE_MESSAGES` から文言を引く）にまとめる。`sendAgentPrompt` は変えない。
> - 真偽値の設定の hook の本体（読み込み・楽観的な反映・最後に保存できた値への巻き戻し・続けて変えたときの扱い〈L-406〉）を `useBooleanSetting` に切り出し、`useAgentNotificationSetting` と新しい `useAgentSendConfirmSetting` はそれを使う薄い hook にする（L-406 の処理を 2 か所に複製しない。`useAgentNotificationSetting` の既存のテストは変えずに通す）。
> - 閉じたときの戻り先（開いた時点の `document.activeElement`）は、ダイアログの本体の描画の時点（`useState` の初期化）で控える。マウントの後（effect・autoFocus）では、すでに `送信` へフォーカスが移っているため。
> - 開いた時点で `送信` を押せない（送れない理由がある）ときは、フォーカスを `キャンセル` に置く。開いている間に `送信` を押せなくなった（送り先のセッションが終わった など）とき、フォーカスが `送信` か body にあれば `キャンセル` へ移す（`Esc` がダイアログに届かなくなるのを防ぐ）。
> - 送れない理由が本文と送り先の両方にあるときは、本文の理由を先に 1 つだけ出す（本文の理由はキャンセルして直すしかないため）。
> - `AgentWorkspaceState.sendToAgent` の戻り値の型は今の `ReturnType<AgentPromptSenderState['send']>`（`Promise<AgentSendOutcome | undefined>`）のまま。確認を開いたときは `undefined` で resolve する。引数に `promptId: string | null` を足す。
> - 設定の節の props（`SettingsPanel`・`Sidebar` の `agentSendConfirm`）とダイアログの props（`AgentSendConfirmDialog` の `state`）は省略できない形にする（L-060。既存の `agentNotification` は省略できる形のまま変えない）。

## Global Constraints

- コメント・文言は日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。クライアントのコンポーネントには `'use client'`
- 設定: 既定はオン（`DEFAULT_AGENT_SEND_CONFIRM_ENABLED = true`、`src/shared/types/settings.ts`）。`settings.json` のキーは `agentSendConfirmEnabled`。読み込み中（`null`）もオンとみなして確認を開く。オンなら変数の有無に関わらず毎回確認する
- IPC のチャンネル: `settings:getAgentSendConfirmEnabled`・`settings:setAgentSendConfirmEnabled`（`boolean` 以外は例外 `送信前の確認の設定が不正です: <値>`）
- 保存の失敗の文言の接頭辞: `送信前の確認の設定を保存できませんでした: `
- 設定画面の文言: 節の名前 `送信前の確認`、チェックボックス `エージェントへ送る前に、送る内容を確認する`、説明 `変数を差し込んだ後の全文と送り先のタブを確かめてから送ります`。節の名前とチェックボックスは `role="group"`・`aria-labelledby` で結び付ける
- ダイアログの文言: 見出し（ダイアログの名前）`送信前の確認`、送り先 `送り先: claude 2`（`formatAgentTabLabel`。開いた時点の名前で固定）、文字数 `1,234 文字`（正規化した後の `length` を 3 桁区切り）、本文の領域の名前 `送る内容`、ボタン `送信`・`キャンセル`
- 送れない理由の文言は既存のものだけを使う: 本文は `AGENT_SEND_FAILURE_MESSAGES[reason]`（`empty`・`too-long`・`leading-bang`）、送り先は `getPromptRunAvailability` の `reason`（`RUN_DISABLED_NO_SESSION`・`RUN_DISABLED_CLOSING`・`RUN_DISABLED_SENDING`）
- 対象はエージェント CLI 方式だけ（従来の方式は今のまま。`usePromptRunner` は従来の方式で `sendToAgent` を呼ばない）。確認の画面では本文を編集できない
- 閉じる契機: `送信`（控えた送り先へ送り、送り先のタブのターミナルへフォーカス）、`キャンセル`・`Esc`（IME の変換中は除く）・背景（`useOverlayDismiss`）は送らずに閉じ、開いた時点の要素（DOM にあり disabled でなければ）→ 同じプロンプトの一覧の `実行`（`data-prompt-run={prompt.id}`）→ 何もしない、の順で戻す。従来の方式への切り替え・フォルダの切り替え・送り先のタブを閉じたときは送らずに閉じる。送り先のセッションが終わった（タブは残る）・閉じる途中・送信中は閉じずに理由を出して `送信` を押せなくする。開いている間に設定をオフにしても閉じない。確認がすでに開いていれば新しい依頼は無視する
- テストのタイマーは後始末で必ず解除する（CLAUDE.md）。`act(...).then(...)` で書かない。`console.warn`・`console.error` の spy は `afterEach` で戻す
- `react-hooks/set-state-in-effect`（eslint-plugin-react-hooks 7）: effect の本体で setState を直接呼ぶと lint が落ちる。閉じる契機は既存の `useOnChange`（effect の中で渡した関数を呼ぶ）を使う
- 気をつける知見（dev-flow-kit の review-lessons.md）: **L-406**（楽観的な更新の巻き戻しの競合。最後に保存できた値へ戻し、後から別の変更が始まっていればその結果に任せる）、**L-156**（見える文字を含むアクセシブルな名前。チェックボックス・ボタンの名前は見えている文字そのもの）、**L-053**（途中の例外で後続が止まらない。`confirm` の送信が投げても・拒否しても閉じてフォーカスを移す）、**L-405**（開いた UI を元の状態が終わる契機〈方式・フォルダ・タブ〉で閉じる）、**L-060**（配線の漏れを検出するテスト。設定の節とダイアログの props を省略できない形にし、`App` の配線をテストする）、**L-297**（実機テスト仕様書の項目が確かめたい経路を通ること。設計書「エラーと境界の扱い」の各行と項目を 1 対 1 で対応させる）
- **コミットしない。** 各タスクの最後は検証だけ（`npx vitest run <変更したテスト>`、`npm run typecheck`、変更した TypeScript のファイルへの `npx eslint --max-warnings 0`）

---

### Task 1: 送信前の確認の設定の保存・IPC・preload・settingsApi

**Files:**
- Modify: `src/shared/types/settings.ts`・`src/shared/types.ts`（`DEFAULT_AGENT_SEND_CONFIRM_ENABLED`）
- Modify: `src/main/settingsFileStore.ts`（`agentSendConfirmEnabled?: boolean`）
- Create: `src/main/agentSendConfirmSettingStore.ts`
- Modify: `src/main/handlers/settingsHandlers.ts`
- Modify: `src/preload/api.ts`・`src/preload/index.d.ts`・`src/renderer/src/__tests__/setup.ts`
- Modify: `src/renderer/src/lib/settingsApi.ts`
- Test: `src/main/__tests__/agentSendConfirmSettingStore.test.ts`（新規）、`src/main/__tests__/handlers/settingsHandlers.test.ts`、`src/preload/__tests__/api.test.ts`、`src/renderer/src/lib/__tests__/settingsApi.test.ts`

**Interfaces:**
- Produces:
```ts
// src/shared/types/settings.ts（src/shared/types.ts から値として再 export）
export const DEFAULT_AGENT_SEND_CONFIRM_ENABLED = true
// src/main/agentSendConfirmSettingStore.ts
export async function getAgentSendConfirmEnabled(): Promise<boolean>
export async function setAgentSendConfirmEnabled(enabled: unknown): Promise<void>
// preload（window.api）と src/renderer/src/lib/settingsApi.ts
getAgentSendConfirmEnabled(): Promise<boolean>
setAgentSendConfirmEnabled(enabled: boolean): Promise<void>
```

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/agentSendConfirmSettingStore.test.ts`（新規）:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadSettingsFile = vi.hoisted(() => vi.fn())
const mockWriteSettingsFile = vi.hoisted(() => vi.fn())
vi.mock('../settingsFileStore', () => ({
  readSettingsFile: mockReadSettingsFile,
  writeSettingsFile: mockWriteSettingsFile
}))

import {
  getAgentSendConfirmEnabled,
  setAgentSendConfirmEnabled
} from '../agentSendConfirmSettingStore'

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteSettingsFile.mockResolvedValue(undefined)
})

describe('getAgentSendConfirmEnabled', () => {
  it.each([
    ['保存された true', { agentSendConfirmEnabled: true }, true],
    ['保存された false', { agentSendConfirmEnabled: false }, false],
    ['値が無い', {}, true],
    ['文字列', { agentSendConfirmEnabled: 'false' }, true],
    ['数', { agentSendConfirmEnabled: 0 }, true]
  ])('%s → %s', async (_label, data, expected) => {
    mockReadSettingsFile.mockResolvedValueOnce(data)
    await expect(getAgentSendConfirmEnabled()).resolves.toBe(expected)
  })
})

describe('setAgentSendConfirmEnabled', () => {
  it('真偽値をマージで書き込む', async () => {
    await setAgentSendConfirmEnabled(false)
    expect(mockWriteSettingsFile).toHaveBeenCalledWith({ agentSendConfirmEnabled: false })
  })

  it.each(['true', 1, null, undefined])('真偽値でない値(%s)は書き込まずに投げる', async (value) => {
    await expect(setAgentSendConfirmEnabled(value)).rejects.toThrow('送信前の確認の設定が不正です')
    expect(mockWriteSettingsFile).not.toHaveBeenCalled()
  })
})
```

`src/main/__tests__/handlers/settingsHandlers.test.ts`: 既存の `vi.mock('../../agentNotificationSettingStore', ...)` の後に足す:
```ts
const mockGetAgentSendConfirmEnabled = vi.hoisted(() => vi.fn())
const mockSetAgentSendConfirmEnabled = vi.hoisted(() => vi.fn())
vi.mock('../../agentSendConfirmSettingStore', () => ({
  getAgentSendConfirmEnabled: mockGetAgentSendConfirmEnabled,
  setAgentSendConfirmEnabled: mockSetAgentSendConfirmEnabled
}))
```
`describe('registerSettingsHandlers'` の中（`settings:setAgentNotificationsEnabled は store の拒否をそのまま返す` の後）に足す:
```ts
  it('settings:getAgentSendConfirmEnabled は保存された設定を返す', async () => {
    mockGetAgentSendConfirmEnabled.mockResolvedValueOnce(false)
    await expect(
      getRegisteredHandler('settings:getAgentSendConfirmEnabled')(makeEvent(1))
    ).resolves.toBe(false)
  })

  it('settings:setAgentSendConfirmEnabled は受け取った値をそのまま store へ渡す(検証は store が行う)', async () => {
    mockSetAgentSendConfirmEnabled.mockResolvedValueOnce(undefined)
    await getRegisteredHandler('settings:setAgentSendConfirmEnabled')(makeEvent(1), true)
    expect(mockSetAgentSendConfirmEnabled).toHaveBeenCalledWith(true)
  })

  it('settings:setAgentSendConfirmEnabled は store の拒否をそのまま返す', async () => {
    mockSetAgentSendConfirmEnabled.mockRejectedValueOnce(
      new Error('送信前の確認の設定が不正です: x')
    )
    await expect(
      getRegisteredHandler('settings:setAgentSendConfirmEnabled')(makeEvent(1), 'x')
    ).rejects.toThrow('送信前の確認の設定が不正です')
  })
```

`src/preload/__tests__/api.test.ts` の invoke の `it.each` の、`setAgentNotificationsEnabled は settings:setAgentNotificationsEnabled に値を渡す` の行の後に足す:
```ts
    [
      'getAgentSendConfirmEnabled は settings:getAgentSendConfirmEnabled を呼ぶ',
      () => api.getAgentSendConfirmEnabled(),
      ['settings:getAgentSendConfirmEnabled']
    ],
    [
      'setAgentSendConfirmEnabled は settings:setAgentSendConfirmEnabled に値を渡す',
      () => api.setAgentSendConfirmEnabled(false),
      ['settings:setAgentSendConfirmEnabled', false]
    ],
```

`src/renderer/src/lib/__tests__/settingsApi.test.ts`: import に `getAgentSendConfirmEnabled`・`setAgentSendConfirmEnabled` を足し、`mockApi` に `getAgentSendConfirmEnabled: vi.fn()`・`setAgentSendConfirmEnabled: vi.fn()` を足して、末尾に足す:
```ts
describe('getAgentSendConfirmEnabled / setAgentSendConfirmEnabled', () => {
  it('window.api の同名の関数へ委ねる', async () => {
    mockApi.getAgentSendConfirmEnabled.mockResolvedValue(false)
    mockApi.setAgentSendConfirmEnabled.mockResolvedValue(undefined)
    await expect(getAgentSendConfirmEnabled()).resolves.toBe(false)
    await setAgentSendConfirmEnabled(true)
    expect(mockApi.setAgentSendConfirmEnabled).toHaveBeenCalledWith(true)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentSendConfirmSettingStore.test.ts src/main/__tests__/handlers/settingsHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/settingsApi.test.ts`
Expected: FAIL（モジュール・関数が無い）

- [ ] **Step 3: 実装する**

`src/shared/types/settings.ts` の末尾に足す:
```ts
/** エージェントへの送信前の確認(送る前に全文と送り先を確かめるダイアログ)の既定。オン */
export const DEFAULT_AGENT_SEND_CONFIRM_ENABLED = true
```
`src/shared/types.ts` の `from './types/settings'` の値の export の `DEFAULT_AGENT_NOTIFICATIONS_ENABLED,` の次に `DEFAULT_AGENT_SEND_CONFIRM_ENABLED,` を足す。

`src/main/settingsFileStore.ts` の `SettingsFile` の `agentNotificationsEnabled?: boolean` の次に足す:
```ts
  /** エージェントへの送信前の確認のオン・オフ(agentSendConfirmSettingStore が検証する) */
  agentSendConfirmEnabled?: boolean
```

`src/main/agentSendConfirmSettingStore.ts`（新規）:
```ts
import { DEFAULT_AGENT_SEND_CONFIRM_ENABLED } from '@shared/types'
import { readSettingsFile, writeSettingsFile } from './settingsFileStore'

// エージェントへの送信前の確認のオン・オフの読み書き(userData/settings.json の agentSendConfirmEnabled。ほかの設定と同じファイルに
// マージで書く。agentNotificationSettingStore と同じ形)

/** 保存された設定。無い・真偽値でなければ既定(オン) */
export async function getAgentSendConfirmEnabled(): Promise<boolean> {
  const data = await readSettingsFile()
  return typeof data.agentSendConfirmEnabled === 'boolean'
    ? data.agentSendConfirmEnabled
    : DEFAULT_AGENT_SEND_CONFIRM_ENABLED
}

/** 検証してから保存する。真偽値でなければ投げる */
export async function setAgentSendConfirmEnabled(enabled: unknown): Promise<void> {
  if (typeof enabled !== 'boolean') {
    throw new Error(`送信前の確認の設定が不正です: ${String(enabled)}`)
  }
  await writeSettingsFile({ agentSendConfirmEnabled: enabled })
}
```

`src/main/handlers/settingsHandlers.ts`: import を足す:
```ts
import {
  getAgentSendConfirmEnabled,
  setAgentSendConfirmEnabled
} from '../agentSendConfirmSettingStore'
```
`registerSettingsHandlers` の末尾（`settings:setAgentNotificationsEnabled` の後）に足す:
```ts
  ipcMain.handle('settings:getAgentSendConfirmEnabled', async () => getAgentSendConfirmEnabled())

  ipcMain.handle(
    'settings:setAgentSendConfirmEnabled',
    async (_event: IpcMainInvokeEvent, enabled: unknown): Promise<void> =>
      setAgentSendConfirmEnabled(enabled)
  )
```

`src/preload/api.ts` の `setAgentNotificationsEnabled: ...` の次に足す:
```ts
  getAgentSendConfirmEnabled: (): Promise<boolean> =>
    ipcRenderer.invoke('settings:getAgentSendConfirmEnabled'),
  setAgentSendConfirmEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('settings:setAgentSendConfirmEnabled', enabled),
```
`src/preload/index.d.ts` の `setAgentNotificationsEnabled(enabled: boolean): Promise<void>` の次に足す:
```ts
      getAgentSendConfirmEnabled(): Promise<boolean>
      setAgentSendConfirmEnabled(enabled: boolean): Promise<void>
```
`src/renderer/src/__tests__/setup.ts` の `setAgentNotificationsEnabled: () => Promise.resolve(),` の次に足す:
```ts
    getAgentSendConfirmEnabled: () => Promise.resolve(true),
    setAgentSendConfirmEnabled: () => Promise.resolve(),
```
`src/renderer/src/lib/settingsApi.ts` の末尾に足す:
```ts
export function getAgentSendConfirmEnabled(): Promise<boolean> {
  return window.api.getAgentSendConfirmEnabled()
}

export function setAgentSendConfirmEnabled(enabled: boolean): Promise<void> {
  return window.api.setAgentSendConfirmEnabled(enabled)
}
```

- [ ] **Step 4: テストを通す・型チェック・lint**

Run: `npx vitest run src/main/__tests__/agentSendConfirmSettingStore.test.ts src/main/__tests__/handlers/settingsHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/settingsApi.test.ts`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: 下の eslint に渡すのと同じファイルへ `npx eslint --fix <files>`（prettier の 100 桁の折り返しなど、自動で直せるものを先に直す）
Run: `npx eslint --max-warnings 0 src/shared/types/settings.ts src/shared/types.ts src/main/settingsFileStore.ts src/main/agentSendConfirmSettingStore.ts src/main/handlers/settingsHandlers.ts src/preload/api.ts src/preload/index.d.ts src/renderer/src/__tests__/setup.ts src/renderer/src/lib/settingsApi.ts src/main/__tests__/agentSendConfirmSettingStore.test.ts src/main/__tests__/handlers/settingsHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/settingsApi.test.ts`
Expected: エラー・警告なし

---

### Task 2: 設定の hook（`useBooleanSetting` への共通化）・設定画面の節と配線

**Files:**
- Create: `src/renderer/src/hooks/useBooleanSetting.ts`
- Modify: `src/renderer/src/hooks/useAgentNotificationSetting.ts`（`useBooleanSetting` を使う薄い hook にする。公開する名前・振る舞いは変えない）
- Create: `src/renderer/src/hooks/useAgentSendConfirmSetting.ts`
- Modify: `src/renderer/src/types.ts`（`AgentSendConfirmPanelState`）
- Create: `src/renderer/src/components/settings/AgentSendConfirmSection.tsx`
- Modify: `src/renderer/src/components/settings/SettingsPanel.tsx`・`src/renderer/src/components/Sidebar.tsx`・`src/renderer/src/App.tsx`
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`・`src/renderer/src/hooks/useAppState.ts`
- Modify: `src/renderer/src/__tests__/makeAgentWorkspaceState.ts`
- Modify: `src/renderer/src/assets/main.css`
- Test: `src/renderer/src/hooks/__tests__/useAgentNotificationSetting.test.ts`（変えずに通ること）、`src/renderer/src/hooks/__tests__/useAgentSendConfirmSetting.test.ts`（新規）、`src/renderer/src/components/settings/__tests__/AgentSendConfirmSection.test.tsx`（新規）、`src/renderer/src/components/settings/__tests__/SettingsPanel.test.tsx`、`src/renderer/src/components/__tests__/Sidebar.test.tsx`（`defaultProps` に足すだけ）、`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`、`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`、`src/renderer/src/components/__tests__/App.agentCli.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `settingsApi.getAgentSendConfirmEnabled` / `setAgentSendConfirmEnabled`、`DEFAULT_AGENT_SEND_CONFIRM_ENABLED`
- Produces:
```ts
// src/renderer/src/hooks/useBooleanSetting.ts
export interface BooleanSettingState {
  /** 読み込みが終わるまでは null */
  enabled: boolean | null
  /** 保存の失敗の文言。次の保存で消える */
  saveError: string | null
  /** すぐ保存する。失敗したら最後に保存できた値に戻し、false を返す */
  changeEnabled: (next: boolean) => Promise<boolean>
}
export interface UseBooleanSettingOptions {
  load: () => Promise<boolean>
  save: (enabled: boolean) => Promise<void>
  defaultValue: boolean
  saveErrorPrefix: string
  logLabel: string
}
export function useBooleanSetting(options: UseBooleanSettingOptions): BooleanSettingState
// src/renderer/src/hooks/useAgentNotificationSetting.ts（名前は今のまま）
export const AGENT_NOTIFICATION_SETTING_SAVE_ERROR_PREFIX = '通知の設定を保存できませんでした: '
export type AgentNotificationSettingState = BooleanSettingState
export function useAgentNotificationSetting(): AgentNotificationSettingState
// src/renderer/src/hooks/useAgentSendConfirmSetting.ts
export const AGENT_SEND_CONFIRM_SETTING_SAVE_ERROR_PREFIX = '送信前の確認の設定を保存できませんでした: '
export type AgentSendConfirmSettingState = BooleanSettingState
export function useAgentSendConfirmSetting(): AgentSendConfirmSettingState
// src/renderer/src/types.ts
export interface AgentSendConfirmPanelState {
  enabled: boolean | null
  saveError: string | null
  onChange: (enabled: boolean) => void
}
// AgentWorkspaceState に追加（AppState にもそのまま出る）
agentSendConfirmPanel: AgentSendConfirmPanelState
// SettingsPanel・Sidebar の Props に追加（省略できない）
agentSendConfirm: AgentSendConfirmPanelState
```
（`useAgentWorkspace` の中の `const sendConfirmSetting = useAgentSendConfirmSetting()` は、Task 5 で `sendToAgent` の確認の要否にも使う。）

- [ ] **Step 1: 失敗するテストを書く（hook）**

`src/renderer/src/hooks/__tests__/useAgentSendConfirmSetting.test.ts`（新規。共通の本体は `useAgentNotificationSetting.test.ts` が細かく確かめているので、ここは配線〈読み書きの関数・既定値・接頭辞〉と L-406 の 1 例）:
```ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

vi.mock('../../lib/settingsApi')

import * as settingsApi from '../../lib/settingsApi'
import {
  AGENT_SEND_CONFIRM_SETTING_SAVE_ERROR_PREFIX,
  useAgentSendConfirmSetting
} from '../useAgentSendConfirmSetting'

const mockGet = vi.mocked(settingsApi.getAgentSendConfirmEnabled)
const mockSet = vi.mocked(settingsApi.setAgentSendConfirmEnabled)
let consoleSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  vi.resetAllMocks()
  consoleSpy = null
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

const deferred = (): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } => {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useAgentSendConfirmSetting', () => {
  it('読み込みが終わるまでは null、終わったら保存された設定', async () => {
    mockGet.mockResolvedValueOnce(false)
    const { result } = renderHook(() => useAgentSendConfirmSetting())
    expect(result.current.enabled).toBeNull()
    await waitFor(() => expect(result.current.enabled).toBe(false))
  })

  it('読み込みに失敗したら既定(オン)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockRejectedValueOnce(new Error('broken'))
    const { result } = renderHook(() => useAgentSendConfirmSetting())
    await waitFor(() => expect(result.current.enabled).toBe(true))
  })

  it('変えたらすぐ反映して setAgentSendConfirmEnabled で保存する', async () => {
    mockGet.mockResolvedValueOnce(true)
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAgentSendConfirmSetting())
    await waitFor(() => expect(result.current.enabled).toBe(true))
    await act(async () => {
      await expect(result.current.changeEnabled(false)).resolves.toBe(true)
    })
    expect(mockSet).toHaveBeenCalledWith(false)
    expect(result.current.enabled).toBe(false)
    expect(result.current.saveError).toBeNull()
  })

  it('保存に失敗したら保存前の値に戻し、送信前の確認の接頭辞で理由を出す', async () => {
    mockGet.mockResolvedValueOnce(true)
    mockSet.mockRejectedValueOnce(new Error('EACCES'))
    const { result } = renderHook(() => useAgentSendConfirmSetting())
    await waitFor(() => expect(result.current.enabled).toBe(true))
    await act(async () => {
      await expect(result.current.changeEnabled(false)).resolves.toBe(false)
    })
    expect(result.current.enabled).toBe(true)
    expect(result.current.saveError).toBe('送信前の確認の設定を保存できませんでした: EACCES')
  })

  it('続けて変えて、先が失敗・後が成功なら、後の値のまま失敗の文言を出さない(L-406)', async () => {
    const a = deferred()
    const b = deferred()
    mockGet.mockResolvedValueOnce(true)
    mockSet.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const { result } = renderHook(() => useAgentSendConfirmSetting())
    await waitFor(() => expect(result.current.enabled).toBe(true))
    let pa!: Promise<boolean>
    let pb!: Promise<boolean>
    act(() => {
      pa = result.current.changeEnabled(false)
    })
    act(() => {
      pb = result.current.changeEnabled(true)
    })
    await act(async () => {
      a.reject(new Error('A'))
      await pa
    })
    await act(async () => {
      b.resolve()
      await pb
    })
    expect(result.current.enabled).toBe(true)
    expect(result.current.saveError).toBeNull()
  })

  it('保存の失敗の接頭辞', () => {
    expect(AGENT_SEND_CONFIRM_SETTING_SAVE_ERROR_PREFIX).toBe(
      '送信前の確認の設定を保存できませんでした: '
    )
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentSendConfirmSetting.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: hook を実装する（共通化）**

`src/renderer/src/hooks/useBooleanSetting.ts`（新規。今の `useAgentNotificationSetting` の本体を移す。使われていなかった `enabledRef` は移さない）:
```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { toError } from '../lib/errorUtils'

// 設定画面の真偽値の設定(エージェントの通知・送信前の確認)の読み込みと保存。useExecutionMode と同じ形で、変更は楽観的に反映して
// 保存し、失敗したら最後に保存できた値へ戻す。続けて変えたときは、後の変更の結果に任せる(L-406)

export interface BooleanSettingState {
  /** 読み込みが終わるまでは null */
  enabled: boolean | null
  /** 保存の失敗の文言。次の保存で消える */
  saveError: string | null
  /** すぐ保存する。失敗したら最後に保存できた値に戻し、false を返す */
  changeEnabled: (next: boolean) => Promise<boolean>
}

export interface UseBooleanSettingOptions {
  /** 保存された値を読む(settingsApi の関数。描画をまたいで同じ参照を渡す) */
  load: () => Promise<boolean>
  /** 保存する(settingsApi の関数。描画をまたいで同じ参照を渡す) */
  save: (enabled: boolean) => Promise<void>
  /** 読み込みに失敗したときの値 */
  defaultValue: boolean
  /** 保存の失敗の文言の接頭辞。後ろに理由を付ける */
  saveErrorPrefix: string
  /** 読み込みの失敗を記録するときの見出し */
  logLabel: string
}

export function useBooleanSetting({
  load,
  save,
  defaultValue,
  saveErrorPrefix,
  logLabel
}: UseBooleanSettingOptions): BooleanSettingState {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  // 最後に保存できた(または読み込んだ)値。失敗したときはここへ戻す
  const savedRef = useRef<boolean | null>(null)
  // 変更の通し番号。後から別の変更が始まっていたら、失敗しても戻さずその結果に任せる
  const changeSeqRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    // 設定ファイルの JSON が壊れていると main は例外を投げる。画面が起動できなくならないよう、既定で続ける
    load()
      .then((loaded) => {
        if (cancelled) return
        savedRef.current = loaded
        setEnabled(loaded)
      })
      .catch((err) => {
        console.error(logLabel, err)
        if (cancelled) return
        savedRef.current = defaultValue
        setEnabled(defaultValue)
      })
    return () => {
      cancelled = true
    }
  }, [load, defaultValue, logLabel])

  const changeEnabled = useCallback(
    async (next: boolean): Promise<boolean> => {
      const seq = ++changeSeqRef.current
      setEnabled(next)
      setSaveError(null)
      try {
        await save(next)
        savedRef.current = next
        return true
      } catch (err) {
        // 後から別の変更が始まっていれば、値も失敗の文言もその結果に任せる
        if (seq === changeSeqRef.current) {
          setEnabled(savedRef.current)
          setSaveError(`${saveErrorPrefix}${toError(err).message}`)
        }
        return false
      }
    },
    [save, saveErrorPrefix]
  )

  return { enabled, saveError, changeEnabled }
}
```

`src/renderer/src/hooks/useAgentNotificationSetting.ts` を次に置き換える（公開する名前は今のまま）:
```ts
import { DEFAULT_AGENT_NOTIFICATIONS_ENABLED } from '@shared/types'
import * as settingsApi from '../lib/settingsApi'
import { useBooleanSetting } from './useBooleanSetting'
import type { BooleanSettingState } from './useBooleanSetting'

// エージェントの通知のオン・オフ(通知の設計書「設定」)。読み込み・保存・失敗の戻しは useBooleanSetting

/** 通知の設定の保存の失敗の文言の接頭辞。後ろに理由を付ける */
export const AGENT_NOTIFICATION_SETTING_SAVE_ERROR_PREFIX = '通知の設定を保存できませんでした: '

/** enabled は読み込みが終わるまでは null(通知もバッジも出さない) */
export type AgentNotificationSettingState = BooleanSettingState

export function useAgentNotificationSetting(): AgentNotificationSettingState {
  return useBooleanSetting({
    load: settingsApi.getAgentNotificationsEnabled,
    save: settingsApi.setAgentNotificationsEnabled,
    defaultValue: DEFAULT_AGENT_NOTIFICATIONS_ENABLED,
    saveErrorPrefix: AGENT_NOTIFICATION_SETTING_SAVE_ERROR_PREFIX,
    logLabel: '[useAgentNotificationSetting] getAgentNotificationsEnabled failed:'
  })
}
```

`src/renderer/src/hooks/useAgentSendConfirmSetting.ts`（新規）:
```ts
import { DEFAULT_AGENT_SEND_CONFIRM_ENABLED } from '@shared/types'
import * as settingsApi from '../lib/settingsApi'
import { useBooleanSetting } from './useBooleanSetting'
import type { BooleanSettingState } from './useBooleanSetting'

// エージェントへの送信前の確認のオン・オフ(設計書「設定」)。読み込み・保存・失敗の戻しは useBooleanSetting

/** 送信前の確認の設定の保存の失敗の文言の接頭辞。後ろに理由を付ける */
export const AGENT_SEND_CONFIRM_SETTING_SAVE_ERROR_PREFIX = '送信前の確認の設定を保存できませんでした: '

/** enabled は読み込みが終わるまでは null(呼び出し側は既定のオンとみなして確認を開く) */
export type AgentSendConfirmSettingState = BooleanSettingState

export function useAgentSendConfirmSetting(): AgentSendConfirmSettingState {
  return useBooleanSetting({
    load: settingsApi.getAgentSendConfirmEnabled,
    save: settingsApi.setAgentSendConfirmEnabled,
    defaultValue: DEFAULT_AGENT_SEND_CONFIRM_ENABLED,
    saveErrorPrefix: AGENT_SEND_CONFIRM_SETTING_SAVE_ERROR_PREFIX,
    logLabel: '[useAgentSendConfirmSetting] getAgentSendConfirmEnabled failed:'
  })
}
```

- [ ] **Step 4: hook のテストを通す（通知の設定の既存のテストも変えずに通る）**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentSendConfirmSetting.test.ts src/renderer/src/hooks/__tests__/useAgentNotificationSetting.test.ts`
Expected: PASS

- [ ] **Step 5: 失敗するテストを書く（設定画面の節・配線）**

`src/renderer/src/components/settings/__tests__/AgentSendConfirmSection.test.tsx`（新規）:
```tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import AgentSendConfirmSection from '../AgentSendConfirmSection'

const OPTION = 'エージェントへ送る前に、送る内容を確認する'
const NOTE = '変数を差し込んだ後の全文と送り先のタブを確かめてから送ります'

describe('AgentSendConfirmSection', () => {
  it('節の名前と、見えているラベルを名前にしたチェックボックスを出し、説明を参照する', () => {
    render(<AgentSendConfirmSection enabled saveError={null} onChange={vi.fn()} />)
    expect(screen.getByText('送信前の確認')).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox', { name: OPTION })
    expect(checkbox).toBeChecked()
    expect(checkbox).toHaveAccessibleDescription(NOTE)
  })

  it('節の名前をグループの名前に結び付け、チェックボックスはそのグループの中にある', () => {
    render(<AgentSendConfirmSection enabled saveError={null} onChange={vi.fn()} />)
    const group = screen.getByRole('group', { name: '送信前の確認' })
    expect(within(group).getByRole('checkbox', { name: OPTION })).toBeInTheDocument()
  })

  it('オフなら外れていて、押すと onChange(true)', async () => {
    const onChange = vi.fn()
    render(<AgentSendConfirmSection enabled={false} saveError={null} onChange={onChange} />)
    const checkbox = screen.getByRole('checkbox', { name: OPTION })
    expect(checkbox).not.toBeChecked()
    await userEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('オンで押すと onChange(false)', async () => {
    const onChange = vi.fn()
    render(<AgentSendConfirmSection enabled saveError={null} onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: OPTION }))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('読み込み中は押せず、読み込み中と出す', () => {
    render(<AgentSendConfirmSection enabled={null} saveError={null} onChange={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: OPTION })).toBeDisabled()
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('保存の失敗を role="alert" で出す', () => {
    render(
      <AgentSendConfirmSection
        enabled
        saveError="送信前の確認の設定を保存できませんでした: x"
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      '送信前の確認の設定を保存できませんでした: x'
    )
  })

  it('選択肢はタッチで押せる 32px 以上の高さ', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
    document.head.appendChild(style)
    try {
      render(<AgentSendConfirmSection enabled saveError={null} onChange={vi.fn()} />)
      const label = screen.getByRole('checkbox', { name: OPTION }).closest('label')!
      expect(getComputedStyle(label).minHeight).toBe('32px')
    } finally {
      style.remove()
    }
  })
})
```

`src/renderer/src/components/settings/__tests__/SettingsPanel.test.tsx`: `defaultProps` の `onSaveModelSettings: ...` の次に足す（省略できない props のため、既存のすべてのテストに渡る）:
```ts
  agentSendConfirm: { enabled: true, saveError: null, onChange: vi.fn() }
```
（直前の行の末尾に `,` を足す。）`describe('SettingsPanel'` の中に足す:
```tsx
  it('送信前の確認の節を出し、変更を agentSendConfirm.onChange へ渡す', async () => {
    const onChange = vi.fn()
    render(
      <SettingsPanel
        {...defaultProps}
        agentSendConfirm={{ enabled: true, saveError: null, onChange }}
      />
    )
    expect(screen.getByRole('group', { name: '送信前の確認' })).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'エージェントへ送る前に、送る内容を確認する' })
    )
    expect(onChange).toHaveBeenCalledWith(false)
  })
```

`src/renderer/src/components/__tests__/Sidebar.test.tsx`: `defaultProps` の末尾の項目の次に足す（省略できない props のため）。直前の行の末尾に `,` が無ければ足し、追加する行の末尾には `,` を付けない:
```ts
  agentSendConfirm: { enabled: true, saveError: null, onChange: vi.fn() }
```

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`: 既存の `vi.mock('../useAgentNotificationSetting', ...)` の次に足す:
```ts
const mockUseAgentSendConfirmSetting = vi.hoisted(() => vi.fn())
vi.mock('../useAgentSendConfirmSetting', () => ({
  useAgentSendConfirmSetting: mockUseAgentSendConfirmSetting
}))
```
`makeSender` の定義の後に足す:
```ts
// 送信前の確認の設定(既定は本物と同じくオン)
const setSendConfirmEnabled = (
  enabled: boolean | null,
  changeEnabled = vi.fn<(next: boolean) => Promise<boolean>>(async () => true),
  saveError: string | null = null
): typeof changeEnabled => {
  mockUseAgentSendConfirmSetting.mockReturnValue({ enabled, saveError, changeEnabled })
  return changeEnabled
}
```
`beforeEach` の `mockUseAgentNotificationSetting.mockReturnValue(...)` の次に `setSendConfirmEnabled(true)` を足す。`describe('通知の設定(agentNotificationPanel)'` の後に足す:
```ts
  describe('送信前の確認の設定(agentSendConfirmPanel)', () => {
    it('設定の値と保存の失敗を渡し、変更を changeEnabled へ渡す', () => {
      const changeEnabled = setSendConfirmEnabled(
        false,
        undefined,
        '送信前の確認の設定を保存できませんでした: x'
      )
      const { result } = renderWorkspace()
      expect(result.current.agentSendConfirmPanel.enabled).toBe(false)
      expect(result.current.agentSendConfirmPanel.saveError).toBe(
        '送信前の確認の設定を保存できませんでした: x'
      )
      act(() => result.current.agentSendConfirmPanel.onChange(true))
      expect(changeEnabled).toHaveBeenCalledWith(true)
    })
  })
```

`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`: 「通知の設定の項目を、useAgentWorkspace の戻り値のまま公開する」の次に足す:
```ts
    it('送信前の確認の設定の項目を、useAgentWorkspace の戻り値のまま公開する', () => {
      const workspace = makeAgentWorkspaceState({
        agentSendConfirmPanel: {
          enabled: false,
          saveError: '送信前の確認の設定を保存できませんでした: x',
          onChange: vi.fn()
        }
      })
      mockUseAgentWorkspace.mockReturnValue(workspace)
      const { result } = renderHook(() => useAppState())
      expect(result.current.agentSendConfirmPanel).toBe(workspace.agentSendConfirmPanel)
    })
```

`src/renderer/src/components/__tests__/App.agentCli.test.tsx`: 「設定にエージェントの通知を出し、既定でオンになっている」の次に足す（App → Sidebar → SettingsPanel の配線を本物の hook で確かめる。L-060）:
```tsx
  it('設定に送信前の確認を出し、既定でオンになっている', async () => {
    render(<App />)
    await userEvent.click(panelButton('settings'))
    const checkbox = await screen.findByRole('checkbox', {
      name: 'エージェントへ送る前に、送る内容を確認する'
    })
    await waitFor(() => expect(checkbox).toBeChecked())
  })
```

- [ ] **Step 6: 落ちることを確かめる**

Run: `npx vitest run src/renderer/src/components/settings src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/App.agentCli.test.tsx`
Expected: FAIL（節のコンポーネントが無い・`agentSendConfirmPanel` が無い）

- [ ] **Step 7: 設定画面の節と配線を実装する**

`src/renderer/src/types.ts` の `AgentNotificationPanelState` の次に足す:
```ts
// エージェントへの送信前の確認の設定(useAgentWorkspace が組み立て、Sidebar → SettingsPanel へ渡す)
export interface AgentSendConfirmPanelState {
  /** 読み込み中は null(押せない) */
  enabled: boolean | null
  saveError: string | null
  onChange: (enabled: boolean) => void
}
```

`src/renderer/src/components/settings/AgentSendConfirmSection.tsx`（新規）:
```tsx
'use client'
import { useId } from 'react'

interface Props {
  /** 読み込み中は null(押せない) */
  enabled: boolean | null
  saveError: string | null
  onChange: (enabled: boolean) => void
}

// 設定パネルの「送信前の確認」(設計書「設定」)。押すとすぐ保存する。チェックボックスの名前は見えているラベルそのもの(L-156)。
// 節の名前はグループの名前に結び付け、Tab でチェックボックスへ移ったときにも読まれるようにする(AgentNotificationSection と同じ形)
export default function AgentSendConfirmSection({
  enabled,
  saveError,
  onChange
}: Props): React.JSX.Element {
  const labelId = useId()
  const noteId = useId()
  return (
    <div className="settings-panel__section">
      <p className="settings-panel__label" id={labelId}>
        送信前の確認
      </p>
      <div role="group" aria-labelledby={labelId}>
        <label className="agent-send-confirm-section__option">
          <input
            type="checkbox"
            checked={enabled === true}
            // 読み込み前に押すと、後から届く読み込みで上書きされるため押せなくする
            disabled={enabled === null}
            aria-describedby={noteId}
            onChange={(event) => onChange(event.target.checked)}
          />
          エージェントへ送る前に、送る内容を確認する
        </label>
      </div>
      <p className="settings-panel__note" id={noteId}>
        変数を差し込んだ後の全文と送り先のタブを確かめてから送ります
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

`src/renderer/src/components/settings/SettingsPanel.tsx`:
- 型の import を `import type { AgentNotificationPanelState, AgentSendConfirmPanelState, ExecutionModePanelState } from '../../types'` にし、`import AgentSendConfirmSection from './AgentSendConfirmSection'` を足す。
- Props の `agentNotification?: AgentNotificationPanelState` の次に足す:
```ts
  /** エージェントへの送信前の確認の設定(省略できない。配線の漏れを型で検出する。L-060) */
  agentSendConfirm: AgentSendConfirmPanelState
```
- 引数に `agentSendConfirm` を足し、`agentNotification` の節の直後に置く:
```tsx
      <AgentSendConfirmSection
        enabled={agentSendConfirm.enabled}
        saveError={agentSendConfirm.saveError}
        onChange={agentSendConfirm.onChange}
      />
```

`src/renderer/src/components/Sidebar.tsx`:
- 型の import（`AgentNotificationPanelState` を import している箇所）に `AgentSendConfirmPanelState` を足す。
- Props の `agentNotification?: AgentNotificationPanelState` の次に足す:
```ts
  /** エージェントへの送信前の確認の設定(省略できない。L-060) */
  agentSendConfirm: AgentSendConfirmPanelState
```
- 引数の `agentNotification` の次に `agentSendConfirm` を足し、`<SettingsPanel ... agentNotification={agentNotification}` の次に `agentSendConfirm={agentSendConfirm}` を渡す。

`src/renderer/src/hooks/useAgentWorkspace.ts`:
- `../types` からの型の import に `AgentSendConfirmPanelState` を足し、`import { useAgentSendConfirmSetting } from './useAgentSendConfirmSetting'` を足す。
- `AgentWorkspaceState` の `agentNotificationPanel` の次に足す:
```ts
  /** 設定パネルの送信前の確認の項目 */
  agentSendConfirmPanel: AgentSendConfirmPanelState
```
- `const notificationSetting = useAgentNotificationSetting()` の次に `const sendConfirmSetting = useAgentSendConfirmSetting()` を足す。
- 戻り値の `agentNotificationPanel: { ... },` の次に足す:
```ts
    agentSendConfirmPanel: {
      enabled: sendConfirmSetting.enabled,
      saveError: sendConfirmSetting.saveError,
      // changeEnabled は失敗を false で返し、拒否しない(失敗は saveError に出る)
      onChange: (enabled) => {
        void sendConfirmSetting.changeEnabled(enabled)
      }
    },
```

`src/renderer/src/hooks/useAppState.ts` の戻り値の `agentNotificationPanel: agentWorkspace.agentNotificationPanel,` の次に足す:
```ts
    agentSendConfirmPanel: agentWorkspace.agentSendConfirmPanel,
```

`src/renderer/src/__tests__/makeAgentWorkspaceState.ts` の戻り値の `agentNotificationPanel: { ... },` の次に足す（既定は「読み込み済み・オン」）:
```ts
    agentSendConfirmPanel: {
      enabled: true,
      saveError: null,
      onChange: vi.fn<AgentWorkspaceState['agentSendConfirmPanel']['onChange']>()
    },
```

`src/renderer/src/App.tsx`: `useAppState()` の分割代入の `agentNotificationPanel,` の次に `agentSendConfirmPanel,` を足し、`<Sidebar ... agentNotification={agentNotificationPanel}` の次に `agentSendConfirm={agentSendConfirmPanel}` を渡す。

`src/renderer/src/assets/main.css`: 既存の `.agent-notification-section__option {` の規則のセレクタを、送信前の確認のチェックボックスにも当てる（同じ見た目。タッチで押せる 32px 以上）:
```css
.agent-notification-section__option,
.agent-send-confirm-section__option {
```
（規則の本体〈`display: flex` … `min-height: 32px` …〉は変えない。直前のコメントは「設定のチェックボックス(タッチで押せる 32px 以上)」に直す。）

- [ ] **Step 8: テストを通す・型チェック・lint**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentSendConfirmSetting.test.ts src/renderer/src/hooks/__tests__/useAgentNotificationSetting.test.ts src/renderer/src/components/settings src/renderer/src/components/__tests__ src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし（`SettingsPanel`・`Sidebar` の `agentSendConfirm` を渡し忘れた箇所があれば型エラーになる）
Run: 下の eslint に渡すのと同じファイルへ `npx eslint --fix <files>`（prettier の 100 桁の折り返しなど、自動で直せるものを先に直す）
Run: `npx eslint --max-warnings 0` に、このタスクで作成・変更した `.ts`・`.tsx` をすべて渡す（`src/renderer/src/hooks/useBooleanSetting.ts`・`useAgentNotificationSetting.ts`・`useAgentSendConfirmSetting.ts`・`useAgentWorkspace.ts`・`useAppState.ts`、`src/renderer/src/types.ts`、`src/renderer/src/components/settings/AgentSendConfirmSection.tsx`・`SettingsPanel.tsx`、`src/renderer/src/components/Sidebar.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/__tests__/makeAgentWorkspaceState.ts` と、このタスクで変更したテスト）
Expected: エラー・警告なし

---

### Task 3: 表示の値（送れない理由の判定）と確認の状態（`useAgentSendConfirm`）

**Files:**
- Modify: `src/shared/agentPasteText.ts`（`cleanAgentPromptText` を切り出し、`normalizeAgentPrompt` はそれを使う）
- Create: `src/renderer/src/lib/agentSendPreview.ts`
- Create: `src/renderer/src/hooks/useAgentSendConfirm.ts`
- Test: `src/shared/__tests__/agentPasteText.test.ts`（既存のテストは変えずに通り、`cleanAgentPromptText` のテストを足す）、`src/renderer/src/lib/__tests__/agentSendPreview.test.ts`（新規）、`src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`（新規）

**Interfaces:**
- Consumes: 既存の `normalizeAgentPrompt`・`AGENT_PROMPT_MAX_LENGTH`（`@shared/agentPasteText`）、`AGENT_SEND_FAILURE_MESSAGES`（`src/renderer/src/lib/agentSendMessages.ts`）、`AgentSendTarget`（`src/renderer/src/hooks/useAgentPromptSender.ts`。`{ slotId: string; controller: AgentTerminalController }`）、`useLatestRef`
- Produces:
```ts
// src/shared/agentPasteText.ts
/** \r\n・\r を \n にそろえ、制御文字(改行・タブ以外)を取り除く。拒否の判定はしない */
export function cleanAgentPromptText(raw: string): string
// src/renderer/src/lib/agentSendPreview.ts
export interface AgentSendPreview {
  /** 正規化した後の本文(改行の統一・制御文字の除去。送れないときも) */
  text: string
  /** 正規化した後の長さ(上限の判定と同じ基準) */
  length: number
  /** 送れない理由の文言(空・長すぎる・先頭が「!」)。送れるなら null */
  rejection: string | null
}
export function buildAgentSendPreview(raw: string): AgentSendPreview
// src/renderer/src/hooks/useAgentSendConfirm.ts
export interface PendingAgentSend {
  /** 送る全文(正規化の前。送るときに sendAgentPrompt が正規化する) */
  text: string
  /** 開いた時点の選択中のタブ(送り先) */
  target: AgentSendTarget
  /** 開いた時点の送り先のタブの名前(表示はこれで固定) */
  label: string
  /** 開いた元のプロンプトの id(キャンセルで閉じたときのフォーカスの戻り先を探す) */
  promptId: string | null
}
export interface UseAgentSendConfirmOptions {
  selected: AgentSendTarget & { label: string }
  send: (text: string, target: AgentSendTarget) => Promise<unknown>
  onConfirmed: (slotId: string) => void
}
export interface AgentSendConfirmState {
  pending: PendingAgentSend | null
  /** 確認を開く(すでに開いていれば無視)。描画をまたいで同じ参照 */
  request: (text: string, promptId: string | null) => void
  /** 閉じて、控えた送り先へ送り、onConfirmed(送り先の slotId) を呼ぶ */
  confirm: () => void
  /** 送らずに閉じる */
  cancel: () => void
}
export function useAgentSendConfirm(options: UseAgentSendConfirmOptions): AgentSendConfirmState
```

- [ ] **Step 1: 失敗するテストを書く**

`src/shared/__tests__/agentPasteText.test.ts`: import に `cleanAgentPromptText` を足し、末尾に足す:
```ts
describe('cleanAgentPromptText', () => {
  it('改行を \\n にそろえ、改行・タブ以外の制御文字を除く(拒否の判定はしない)', () => {
    expect(cleanAgentPromptText('!a\r\nb\rc\td\x1b[201~\x7f')).toBe('!a\nb\nc\td[201~')
  })

  it('normalizeAgentPrompt が ok のときの text と同じ', () => {
    const raw = 'line1\r\nline2\x07'
    expect(normalizeAgentPrompt(raw)).toEqual({ kind: 'ok', text: cleanAgentPromptText(raw) })
  })
})
```

`src/renderer/src/lib/__tests__/agentSendPreview.test.ts`（新規）:
```ts
import { describe, it, expect } from 'vitest'
import { AGENT_PROMPT_MAX_LENGTH } from '@shared/agentPasteText'
import { AGENT_SEND_FAILURE_MESSAGES } from '../agentSendMessages'
import { buildAgentSendPreview } from '../agentSendPreview'

describe('buildAgentSendPreview', () => {
  it('正規化した後の本文と長さを返し、送れる(理由は null)', () => {
    expect(buildAgentSendPreview('a\r\nb\x1b')).toEqual({ text: 'a\nb', length: 3, rejection: null })
  })

  it.each([
    ['空', '', 'empty'],
    ['空白と改行だけ', '  \n\t', 'empty'],
    ['先頭が「!」', '!ls', 'leading-bang'],
    ['制御文字を除くと先頭が「!」', '\x1b!rm', 'leading-bang']
  ] as const)('%s なら、既存の文言を理由にする', (_label, raw, reason) => {
    expect(buildAgentSendPreview(raw).rejection).toBe(AGENT_SEND_FAILURE_MESSAGES[reason])
  })

  it('先頭が「!」でも、正規化した後の本文と長さを返す', () => {
    const preview = buildAgentSendPreview('!ls\r\n')
    expect(preview.text).toBe('!ls\n')
    expect(preview.length).toBe(4)
  })

  it('正規化した後の長さが上限ちょうどなら送れる(\\r\\n は 1 文字に数える)', () => {
    const preview = buildAgentSendPreview('a'.repeat(AGENT_PROMPT_MAX_LENGTH - 1) + '\r\n')
    expect(preview.length).toBe(AGENT_PROMPT_MAX_LENGTH)
    expect(preview.rejection).toBeNull()
  })

  it('正規化した後の長さが上限を超えたら長すぎる(長さも返す)', () => {
    const preview = buildAgentSendPreview('a'.repeat(AGENT_PROMPT_MAX_LENGTH) + '\r\n')
    expect(preview.length).toBe(AGENT_PROMPT_MAX_LENGTH + 1)
    expect(preview.rejection).toBe(AGENT_SEND_FAILURE_MESSAGES['too-long'])
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`（新規）:
```ts
import { renderHook, act } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock, MockInstance } from 'vitest'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import { useAgentSendConfirm } from '../useAgentSendConfirm'
import type { AgentSendConfirmState, UseAgentSendConfirmOptions } from '../useAgentSendConfirm'

const tab1 = { slotId: 'slot-1', label: 'claude 1', controller: makeFakeController() }
const tab2 = { slotId: 'slot-2', label: 'claude 2', controller: makeFakeController() }

let consoleErrorSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  consoleErrorSpy = null
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
})

const renderConfirm = (
  overrides: Partial<UseAgentSendConfirmOptions> = {}
): RenderHookResult<AgentSendConfirmState, UseAgentSendConfirmOptions> & {
  send: Mock<UseAgentSendConfirmOptions['send']>
  onConfirmed: Mock<UseAgentSendConfirmOptions['onConfirmed']>
} => {
  const send = vi.fn<UseAgentSendConfirmOptions['send']>(async () => undefined)
  const onConfirmed = vi.fn<UseAgentSendConfirmOptions['onConfirmed']>()
  const hook = renderHook((props: UseAgentSendConfirmOptions) => useAgentSendConfirm(props), {
    initialProps: { selected: tab1, send, onConfirmed, ...overrides }
  })
  return { ...hook, send, onConfirmed }
}

describe('useAgentSendConfirm', () => {
  it('request で開き、開いた時点の選択中のタブ・名前・プロンプトの id を控える。まだ送らない', () => {
    const { result, send } = renderConfirm()
    expect(result.current.pending).toBeNull()
    act(() => result.current.request('hello', 'p1'))
    expect(result.current.pending).toEqual({
      text: 'hello',
      target: { slotId: 'slot-1', controller: tab1.controller },
      label: 'claude 1',
      promptId: 'p1'
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('開いている間の request は無視する(二重に開かない。同じ描画の中で 2 回呼んでも)', () => {
    const { result } = renderConfirm()
    act(() => {
      result.current.request('first', 'p1')
      result.current.request('second', 'p2')
    })
    act(() => result.current.request('third', null))
    expect(result.current.pending?.text).toBe('first')
    expect(result.current.pending?.promptId).toBe('p1')
  })

  it('confirm で閉じ、控えた送り先へ送り、onConfirmed に送り先の slotId を渡す(開いた後にタブを切り替えても送り先は変わらない)', () => {
    const { result, rerender, send, onConfirmed } = renderConfirm()
    act(() => result.current.request('hello', 'p1'))
    rerender({ selected: tab2, send, onConfirmed })
    act(() => result.current.confirm())
    expect(result.current.pending).toBeNull()
    expect(send).toHaveBeenCalledExactlyOnceWith('hello', {
      slotId: 'slot-1',
      controller: tab1.controller
    })
    expect(onConfirmed).toHaveBeenCalledExactlyOnceWith('slot-1')
  })

  it('cancel で閉じ、送らない', () => {
    const { result, send, onConfirmed } = renderConfirm()
    act(() => result.current.request('hello', 'p1'))
    act(() => result.current.cancel())
    expect(result.current.pending).toBeNull()
    expect(send).not.toHaveBeenCalled()
    expect(onConfirmed).not.toHaveBeenCalled()
  })

  it('閉じているときの confirm は何もしない', () => {
    const { result, send, onConfirmed } = renderConfirm()
    act(() => result.current.confirm())
    expect(send).not.toHaveBeenCalled()
    expect(onConfirmed).not.toHaveBeenCalled()
  })

  it('閉じた後は、また開ける', () => {
    const { result } = renderConfirm()
    act(() => result.current.request('first', 'p1'))
    act(() => result.current.cancel())
    act(() => result.current.request('second', 'p2'))
    expect(result.current.pending?.text).toBe('second')
  })

  it('send が拒否しても閉じて onConfirmed を呼び、理由を記録して呼び出し元へ投げない(L-053)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const send = vi.fn<UseAgentSendConfirmOptions['send']>(async () => {
      throw new Error('broken')
    })
    const { result, onConfirmed } = renderConfirm({ send })
    act(() => result.current.request('hello', null))
    await act(async () => {
      result.current.confirm()
      // 拒否の記録(catch)はマイクロタスクで走る
      await Promise.resolve()
    })
    expect(result.current.pending).toBeNull()
    expect(onConfirmed).toHaveBeenCalledExactlyOnceWith('slot-1')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[useAgentSendConfirm] send failed:',
      expect.any(Error)
    )
  })

  // sendToAgent(usePromptRunner の useCallback の依存)が描画ごとに変わらないように
  it('request は描画をまたいで同じ参照(選択中のタブが変わっても)', () => {
    const { result, rerender, send, onConfirmed } = renderConfirm()
    const first = result.current.request
    rerender({ selected: tab2, send, onConfirmed })
    expect(result.current.request).toBe(first)
  })

  it('選択中のタブを切り替えた後に開くと、その時点のタブを控える', () => {
    const { result, rerender, send, onConfirmed } = renderConfirm()
    rerender({ selected: tab2, send, onConfirmed })
    act(() => result.current.request('hello', 'p1'))
    expect(result.current.pending?.target.slotId).toBe('slot-2')
    expect(result.current.pending?.label).toBe('claude 2')
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/shared/__tests__/agentPasteText.test.ts src/renderer/src/lib/__tests__/agentSendPreview.test.ts src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`
Expected: FAIL（`cleanAgentPromptText`・`buildAgentSendPreview`・`useAgentSendConfirm` が無い）

- [ ] **Step 3: 実装する**

`src/shared/agentPasteText.ts` の `normalizeAgentPrompt` の直前に足し、`normalizeAgentPrompt` の 1 行目をこれの呼び出しに置き換える:
```ts
/**
 * 本文の改行を \n にそろえ(\r\n・\r)、制御文字を取り除く。拒否の判定はしない(送信前の確認の画面は、送れない本文も
 * 正規化した後の全文と文字数を出すため、normalizeAgentPrompt と同じ正規化をここから使う)
 */
export function cleanAgentPromptText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '')
}
```
```ts
export function normalizeAgentPrompt(raw: string): NormalizedAgentPrompt {
  const text = cleanAgentPromptText(raw)
  if (text.trim() === '') return { kind: 'rejected', reason: 'empty' }
  if (text.length > AGENT_PROMPT_MAX_LENGTH) return { kind: 'rejected', reason: 'too-long' }
  if (text.startsWith('!')) return { kind: 'rejected', reason: 'leading-bang' }
  return { kind: 'ok', text }
}
```
（`normalizeAgentPrompt` の JSDoc は今のまま。）

`src/renderer/src/lib/agentSendPreview.ts`（新規）:
```ts
import { cleanAgentPromptText, normalizeAgentPrompt } from '@shared/agentPasteText'
import { AGENT_SEND_FAILURE_MESSAGES } from './agentSendMessages'

// 送信前の確認のダイアログに出す値(設計書「ダイアログ」)。本文と文字数は送るときと同じ正規化の後の値。送れない理由は送る前の
// 検査(normalizeAgentPrompt)の結果から、送った後の失敗と同じ文言を引く(sendAgentPrompt は変えない)

export interface AgentSendPreview {
  /** 正規化した後の本文(改行の統一・制御文字の除去。送れないときも) */
  text: string
  /** 正規化した後の長さ(上限の判定と同じ基準) */
  length: number
  /** 送れない理由の文言(空・長すぎる・先頭が「!」)。送れるなら null */
  rejection: string | null
}

export function buildAgentSendPreview(raw: string): AgentSendPreview {
  const text = cleanAgentPromptText(raw)
  const normalized = normalizeAgentPrompt(raw)
  return {
    text,
    length: text.length,
    rejection: normalized.kind === 'rejected' ? AGENT_SEND_FAILURE_MESSAGES[normalized.reason] : null
  }
}
```

`src/renderer/src/hooks/useAgentSendConfirm.ts`（新規）:
```ts
import { useCallback, useRef, useState } from 'react'
import type { AgentSendTarget } from './useAgentPromptSender'
import { useLatestRef } from './useLatestRef'

// エージェントへの送信前の確認の状態(設計書「送信前の確認の状態」)。開いている依頼(送る全文・開いた時点の送り先のタブと名前・
// 開いた元のプロンプト)を持ち、送信で控えた送り先へ送る。確認を開くか・すぐ送るかの判断と、閉じる契機(方式・フォルダ・タブ)は
// 呼び出し側(useAgentWorkspace)が持つ

export interface PendingAgentSend {
  /** 送る全文(正規化の前。送るときに sendAgentPrompt が正規化する) */
  text: string
  /** 開いた時点の選択中のタブ(送り先) */
  target: AgentSendTarget
  /** 開いた時点の送り先のタブの名前(表示はこれで固定) */
  label: string
  /** 開いた元のプロンプトの id(キャンセルで閉じたときのフォーカスの戻り先を探す) */
  promptId: string | null
}

export interface UseAgentSendConfirmOptions {
  /** 選択中のタブ(request の時点の値を送り先として控える) */
  selected: AgentSendTarget & { label: string }
  /** 控えた送り先へ送る(useAgentPromptSender.send) */
  send: (text: string, target: AgentSendTarget) => Promise<unknown>
  /** 送信で閉じた後に呼ぶ(送り先のタブへ移り、そのターミナルへフォーカスを移す) */
  onConfirmed: (slotId: string) => void
}

export interface AgentSendConfirmState {
  pending: PendingAgentSend | null
  /** 確認を開く(すでに開いていれば無視)。描画をまたいで同じ参照 */
  request: (text: string, promptId: string | null) => void
  /** 閉じて、控えた送り先へ送り、onConfirmed(送り先の slotId) を呼ぶ */
  confirm: () => void
  /** 送らずに閉じる */
  cancel: () => void
}

export function useAgentSendConfirm({
  selected,
  send,
  onConfirmed
}: UseAgentSendConfirmOptions): AgentSendConfirmState {
  const [pending, setPending] = useState<PendingAgentSend | null>(null)
  // 同じ描画の中の 2 回目の request・confirm を止めるため、state とは別に同期的に持つ
  const pendingRef = useRef<PendingAgentSend | null>(null)
  // request を描画をまたいで同じ参照にするため、選択中のタブは ref から読む
  const selectedRef = useLatestRef(selected)

  const request = useCallback(
    (text: string, promptId: string | null): void => {
      if (pendingRef.current !== null) return
      const { slotId, controller, label } = selectedRef.current
      const next: PendingAgentSend = { text, target: { slotId, controller }, label, promptId }
      pendingRef.current = next
      setPending(next)
    },
    [selectedRef]
  )

  const cancel = useCallback((): void => {
    pendingRef.current = null
    setPending(null)
  }, [])

  const confirm = useCallback((): void => {
    const current = pendingRef.current
    if (current === null) return
    pendingRef.current = null
    setPending(null)
    // send は拒否しない約束だが、投げても・拒否しても、送り先へ移る処理は止めない(L-053)
    try {
      send(current.text, current.target).catch((err: unknown) => {
        console.error('[useAgentSendConfirm] send failed:', err)
      })
    } finally {
      onConfirmed(current.target.slotId)
    }
  }, [send, onConfirmed])

  return { pending, request, confirm, cancel }
}
```

- [ ] **Step 4: テストを通す・型チェック・lint**

Run: `npx vitest run src/shared/__tests__/agentPasteText.test.ts src/renderer/src/lib/__tests__/agentSendPreview.test.ts src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts src/renderer/src/lib/__tests__/agentPromptSend.test.ts`
Expected: PASS（`agentPromptSend.test.ts` は変えずに通る。`agentPromptSend.test.ts` が無ければ `src/renderer/src/lib/__tests__` を丸ごと渡す）
Run: `npm run typecheck`
Expected: エラーなし
Run: 下の eslint に渡すのと同じファイルへ `npx eslint --fix <files>`（prettier の 100 桁の折り返しなど、自動で直せるものを先に直す）
Run: `npx eslint --max-warnings 0 src/shared/agentPasteText.ts src/renderer/src/lib/agentSendPreview.ts src/renderer/src/hooks/useAgentSendConfirm.ts src/shared/__tests__/agentPasteText.test.ts src/renderer/src/lib/__tests__/agentSendPreview.test.ts src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`
Expected: エラー・警告なし

---

### Task 4: 確認のダイアログのコンポーネントと戻り先の目印

**Files:**
- Modify: `src/renderer/src/types.ts`（`AgentSendConfirmPending`・`AgentSendConfirmDialogState`）
- Create: `src/renderer/src/components/agent/AgentSendConfirmDialog.tsx`
- Modify: `src/renderer/src/components/prompts/PromptItemView.tsx`（実行ボタンに `data-prompt-run={prompt.id}`）
- Modify: `src/renderer/src/assets/main.css`
- Test: `src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx`（新規）、`src/renderer/src/components/prompts/__tests__/PromptItemView.test.tsx`

**Interfaces:**
- Consumes: Task 3 の `buildAgentSendPreview(raw): { text; length; rejection }`、既存の `useDialogFocusTrap(containerRef, isOpen)`・`useOverlayDismiss(onDismiss)`
- Produces:
```ts
// src/renderer/src/types.ts
export interface AgentSendConfirmPending {
  /** 送る全文(正規化の前) */
  text: string
  /** 送り先のタブ */
  slotId: string
  /** 送り先のタブの名前(開いた時点で固定) */
  label: string
  /** 開いた元のプロンプトの id */
  promptId: string | null
}
export interface AgentSendConfirmDialogState {
  /** 開いている確認。閉じていれば null */
  pending: AgentSendConfirmPending | null
  /** 送り先のタブが今は送れない理由(終了した・閉じる途中・送信中)。送れるなら null */
  targetBlockedReason: string | null
  onConfirm: () => void
  onCancel: () => void
}
// src/renderer/src/components/agent/AgentSendConfirmDialog.tsx
export default function AgentSendConfirmDialog(props: { state: AgentSendConfirmDialogState }): React.JSX.Element | null
// PromptItemView の実行ボタン: data-prompt-run={prompt.id}
```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/prompts/__tests__/PromptItemView.test.tsx` の `describe('PromptItemView'` の中に足す:
```tsx
  it('実行ボタンに、送信前の確認を閉じたときの戻り先の目印(data-prompt-run=プロンプトの id)を付ける', () => {
    render(<PromptItemView {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'プロンプトを実行' })).toHaveAttribute(
      'data-prompt-run',
      'p1'
    )
  })
```

`src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx`（新規）:
```tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { AgentSendConfirmDialogState, AgentSendConfirmPending } from '../../../types'
import {
  AGENT_SEND_FAILURE_MESSAGES,
  RUN_DISABLED_CLOSING,
  RUN_DISABLED_NO_SESSION,
  RUN_DISABLED_SENDING
} from '../../../lib/agentSendMessages'
import AgentSendConfirmDialog from '../AgentSendConfirmDialog'

const makePending = (overrides: Partial<AgentSendConfirmPending> = {}): AgentSendConfirmPending => ({
  text: 'このフォルダのファイルを一覧して',
  slotId: 'slot-2',
  label: 'claude 2',
  promptId: 'p1',
  ...overrides
})

const makeState = (
  overrides: Partial<AgentSendConfirmDialogState> = {}
): AgentSendConfirmDialogState => ({
  pending: makePending(),
  targetBlockedReason: null,
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  ...overrides
})

const getDialog = (): HTMLElement => screen.getByRole('dialog', { name: '送信前の確認' })
const submitButton = (): HTMLElement => screen.getByRole('button', { name: '送信' })
const cancelButton = (): HTMLElement => screen.getByRole('button', { name: 'キャンセル' })

// 開いた元の要素・一覧の実行ボタン(data-prompt-run)とダイアログを並べる。開くのは state を閉じた状態から開いた状態へ変えたとき
interface HarnessProps {
  state: AgentSendConfirmDialogState
  showOpener?: boolean
  openerDisabled?: boolean
  showRunButton?: boolean
}
function Harness({
  state,
  showOpener = true,
  openerDisabled = false,
  showRunButton = true
}: HarnessProps): React.JSX.Element {
  return (
    <>
      {showOpener && (
        <button type="button" disabled={openerDisabled}>
          開いた元
        </button>
      )}
      {showRunButton && (
        <button type="button" data-prompt-run="p1">
          一覧の実行
        </button>
      )}
      <button type="button" data-prompt-run="p2">
        ほかのプロンプトの実行
      </button>
      <AgentSendConfirmDialog state={state} />
    </>
  )
}

describe('AgentSendConfirmDialog', () => {
  describe('表示', () => {
    it('閉じていれば何も描画しない', () => {
      render(<AgentSendConfirmDialog state={makeState({ pending: null })} />)
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('見出しを名前にしたモーダルのダイアログに、送り先・本文・文字数を出す', () => {
      render(<AgentSendConfirmDialog state={makeState()} />)
      const dialog = getDialog()
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(within(dialog).getByText('送り先: claude 2')).toBeInTheDocument()
      expect(within(dialog).getByRole('region', { name: '送る内容' })).toHaveTextContent(
        'このフォルダのファイルを一覧して'
      )
      expect(within(dialog).getByText('16 文字')).toBeInTheDocument()
    })

    it('本文は正規化した後の文字列を、改行を保って出し、文字数も正規化した後の長さ', () => {
      render(
        <AgentSendConfirmDialog state={makeState({ pending: makePending({ text: 'line1\r\nline2\x07' }) })} />
      )
      expect(screen.getByRole('region', { name: '送る内容' }).textContent).toBe('line1\nline2')
      expect(screen.getByText('11 文字')).toBeInTheDocument()
    })

    it('文字数は 3 桁ごとに区切る', () => {
      render(
        <AgentSendConfirmDialog
          state={makeState({ pending: makePending({ text: 'a'.repeat(1234) }) })}
        />
      )
      expect(screen.getByText('1,234 文字')).toBeInTheDocument()
    })

    it('本文の領域はキーボードでもスクロールできるよう Tab で止まる', () => {
      render(<AgentSendConfirmDialog state={makeState()} />)
      expect(screen.getByRole('region', { name: '送る内容' })).toHaveAttribute('tabindex', '0')
    })

    it('送れるなら理由を出さず、送信を押せる', () => {
      render(<AgentSendConfirmDialog state={makeState()} />)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(submitButton()).toBeEnabled()
    })
  })

  describe('送れない理由', () => {
    it.each([
      ['先頭が「!」', '!ls', AGENT_SEND_FAILURE_MESSAGES['leading-bang']],
      ['空白だけ', '  \n', AGENT_SEND_FAILURE_MESSAGES.empty],
      ['長すぎる', 'a'.repeat(200_001), AGENT_SEND_FAILURE_MESSAGES['too-long']]
    ])('本文が %s なら理由を role="alert" で出し、送信を押せず、理由を送信の説明にする', (_label, text, message) => {
      render(<AgentSendConfirmDialog state={makeState({ pending: makePending({ text }) })} />)
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      expect(submitButton()).toBeDisabled()
      expect(submitButton()).toHaveAccessibleDescription(message)
    })

    it('長すぎるときも文字数を出す', () => {
      render(
        <AgentSendConfirmDialog
          state={makeState({ pending: makePending({ text: 'a'.repeat(200_001) }) })}
        />
      )
      expect(screen.getByText('200,001 文字')).toBeInTheDocument()
    })

    it.each([
      ['終了した', RUN_DISABLED_NO_SESSION],
      ['閉じる途中', RUN_DISABLED_CLOSING],
      ['送信中', RUN_DISABLED_SENDING]
    ])('送り先が %s なら、その理由を出して送信を押せない', (_label, reason) => {
      render(<AgentSendConfirmDialog state={makeState({ targetBlockedReason: reason })} />)
      expect(screen.getByRole('alert')).toHaveTextContent(reason)
      expect(submitButton()).toBeDisabled()
      expect(submitButton()).toHaveAccessibleDescription(reason)
    })

    it('本文と送り先の両方に理由があれば、本文の理由を 1 つだけ出す', () => {
      render(
        <AgentSendConfirmDialog
          state={makeState({
            pending: makePending({ text: '!ls' }),
            targetBlockedReason: RUN_DISABLED_NO_SESSION
          })}
        />
      )
      expect(screen.getAllByRole('alert')).toHaveLength(1)
      expect(screen.getByRole('alert')).toHaveTextContent(AGENT_SEND_FAILURE_MESSAGES['leading-bang'])
    })
  })

  describe('操作', () => {
    it('送信を押すと onConfirm', async () => {
      const state = makeState()
      render(<AgentSendConfirmDialog state={state} />)
      await userEvent.click(submitButton())
      expect(state.onConfirm).toHaveBeenCalledOnce()
      expect(state.onCancel).not.toHaveBeenCalled()
    })

    it('キャンセル・Esc・背景のクリックで onCancel(送らない)', async () => {
      const state = makeState()
      render(<AgentSendConfirmDialog state={state} />)
      await userEvent.click(cancelButton())
      await userEvent.keyboard('{Escape}')
      await userEvent.click(document.querySelector('.agent-send-confirm__overlay')!)
      expect(state.onCancel).toHaveBeenCalledTimes(3)
      expect(state.onConfirm).not.toHaveBeenCalled()
    })

    it('ダイアログの中のクリックでは閉じない', async () => {
      const state = makeState()
      render(<AgentSendConfirmDialog state={state} />)
      await userEvent.click(screen.getByRole('region', { name: '送る内容' }))
      await userEvent.click(screen.getByText('送り先: claude 2'))
      expect(state.onCancel).not.toHaveBeenCalled()
    })
  })

  describe('フォーカス', () => {
    it('開いたら送信にフォーカスを置く', () => {
      render(<AgentSendConfirmDialog state={makeState()} />)
      expect(submitButton()).toHaveFocus()
    })

    it('開いた時点で送信を押せなければ、キャンセルにフォーカスを置く', () => {
      render(<AgentSendConfirmDialog state={makeState({ pending: makePending({ text: '!ls' }) })} />)
      expect(cancelButton()).toHaveFocus()
    })

    it('開いている間に送信を押せなくなったら、送信にあったフォーカスをキャンセルへ移す', () => {
      const { rerender } = render(<AgentSendConfirmDialog state={makeState()} />)
      expect(submitButton()).toHaveFocus()
      rerender(
        <AgentSendConfirmDialog state={makeState({ targetBlockedReason: RUN_DISABLED_NO_SESSION })} />
      )
      expect(cancelButton()).toHaveFocus()
    })

    it('Tab・Shift+Tab は本文・送信・キャンセルの間を回り、背後へ出ない', async () => {
      render(<Harness state={makeState()} />)
      const body = screen.getByRole('region', { name: '送る内容' })
      expect(submitButton()).toHaveFocus()
      await userEvent.tab()
      expect(cancelButton()).toHaveFocus()
      await userEvent.tab()
      expect(body).toHaveFocus()
      await userEvent.tab()
      expect(submitButton()).toHaveFocus()
      await userEvent.tab({ shift: true })
      expect(body).toHaveFocus()
      await userEvent.tab({ shift: true })
      expect(cancelButton()).toHaveFocus()
    })

    it('キャンセルで閉じたら、開いた時点の要素へ戻す', async () => {
      const closed = makeState({ pending: null })
      const { rerender } = render(<Harness state={closed} />)
      const opener = screen.getByRole('button', { name: '開いた元' })
      opener.focus()
      const open = makeState()
      rerender(<Harness state={open} />)
      expect(submitButton()).toHaveFocus()
      await userEvent.click(cancelButton())
      expect(open.onCancel).toHaveBeenCalledOnce()
      expect(opener).toHaveFocus()
    })

    it('Esc で閉じたときも、開いた時点の要素へ戻す', async () => {
      const { rerender } = render(<Harness state={makeState({ pending: null })} />)
      const opener = screen.getByRole('button', { name: '開いた元' })
      opener.focus()
      rerender(<Harness state={makeState()} />)
      await userEvent.keyboard('{Escape}')
      expect(opener).toHaveFocus()
    })

    it('開いた時点の要素が外れていたら(変数のフォームの実行から開いた)、同じプロンプトの一覧の実行へ戻す', async () => {
      const { rerender } = render(<Harness state={makeState({ pending: null })} />)
      screen.getByRole('button', { name: '開いた元' }).focus()
      // 変数のフォームは確認を開くのと同じ描画で閉じる
      rerender(<Harness state={makeState()} showOpener={false} />)
      await userEvent.click(cancelButton())
      expect(screen.getByRole('button', { name: '一覧の実行' })).toHaveFocus()
    })

    it('開いた時点の要素が disabled になっていたら、同じプロンプトの一覧の実行へ戻す', async () => {
      const { rerender } = render(<Harness state={makeState({ pending: null })} />)
      screen.getByRole('button', { name: '開いた元' }).focus()
      rerender(<Harness state={makeState()} />)
      rerender(<Harness state={makeState()} openerDisabled />)
      await userEvent.click(cancelButton())
      expect(screen.getByRole('button', { name: '一覧の実行' })).toHaveFocus()
    })

    it('戻り先がどちらも無ければフォーカスを動かさず、閉じる依頼だけを出す', async () => {
      const { rerender } = render(<Harness state={makeState({ pending: null })} />)
      screen.getByRole('button', { name: '開いた元' }).focus()
      const open = makeState()
      rerender(<Harness state={open} showOpener={false} showRunButton={false} />)
      await userEvent.click(cancelButton())
      expect(open.onCancel).toHaveBeenCalledOnce()
      expect(screen.getByRole('button', { name: 'ほかのプロンプトの実行' })).not.toHaveFocus()
    })

    it('送信で閉じるときは、開いた時点の要素へ戻さない(送り先のターミナルへ移すのは呼び出し側)', async () => {
      const { rerender } = render(<Harness state={makeState({ pending: null })} />)
      const opener = screen.getByRole('button', { name: '開いた元' })
      opener.focus()
      rerender(<Harness state={makeState()} />)
      await userEvent.click(submitButton())
      expect(opener).not.toHaveFocus()
    })
  })

  it('送信・キャンセルはタッチで押せる 32px 以上の高さ', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
    document.head.appendChild(style)
    try {
      render(<AgentSendConfirmDialog state={makeState()} />)
      expect(getComputedStyle(submitButton()).minHeight).toBe('32px')
      expect(getComputedStyle(cancelButton()).minHeight).toBe('32px')
    } finally {
      style.remove()
    }
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx src/renderer/src/components/prompts/__tests__/PromptItemView.test.tsx`
Expected: FAIL（コンポーネントが無い・`data-prompt-run` が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/types.ts` の `AgentSendConfirmPanelState`（Task 2）の次に足す:
```ts
// 送信前の確認のダイアログで開いている依頼(useAgentWorkspace が useAgentSendConfirm の pending から組み立てる)
export interface AgentSendConfirmPending {
  /** 送る全文(正規化の前。ダイアログが正規化して表示する) */
  text: string
  /** 送り先のタブ */
  slotId: string
  /** 送り先のタブの名前(開いた時点で固定) */
  label: string
  /** 開いた元のプロンプトの id(キャンセルで閉じたときのフォーカスの戻り先) */
  promptId: string | null
}

// 送信前の確認のダイアログの状態と操作(useAgentWorkspace が組み立て、App が描画する。省略できない形で渡す。L-060)
export interface AgentSendConfirmDialogState {
  /** 開いている確認。閉じていれば null */
  pending: AgentSendConfirmPending | null
  /** 送り先のタブが今は送れない理由(終了した・閉じる途中・送信中)。送れるなら null */
  targetBlockedReason: string | null
  /** 控えた送り先へ送って閉じ、送り先のタブのターミナルへフォーカスを移す */
  onConfirm: () => void
  /** 送らずに閉じる */
  onCancel: () => void
}
```

`src/renderer/src/components/prompts/PromptItemView.tsx` の実行ボタン（`className="prompt-item__run"`）に足す:
```tsx
          // 送信前の確認をキャンセルで閉じたときの戻り先の目印(変数のフォームから開いた場合、フォームは閉じているため)
          data-prompt-run={prompt.id}
```

`src/renderer/src/components/agent/AgentSendConfirmDialog.tsx`（新規）:
```tsx
'use client'
import { useEffect, useId, useRef, useState } from 'react'
import type { AgentSendConfirmDialogState, AgentSendConfirmPending } from '../../types'
import { buildAgentSendPreview } from '../../lib/agentSendPreview'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss'

interface Props {
  state: AgentSendConfirmDialogState
}

const LENGTH_FORMAT = new Intl.NumberFormat('ja-JP')

// キャンセルで閉じたときのフォーカスの戻り先。開いた時点の要素が DOM に残っていて押せればそこ、無ければ(変数のフォームの
// 実行から開いた場合、フォームは閉じている)同じプロンプトの一覧の「実行」(data-prompt-run)。どちらも無ければ null
function findReturnFocusTarget(opener: Element | null, promptId: string | null): HTMLElement | null {
  if (
    opener instanceof HTMLElement &&
    opener !== document.body &&
    opener.isConnected &&
    !opener.matches(':disabled')
  ) {
    return opener
  }
  if (promptId === null) return null
  const run = Array.from(document.querySelectorAll<HTMLElement>('[data-prompt-run]')).find(
    (element) => element.dataset.promptRun === promptId
  )
  return run !== undefined && !run.matches(':disabled') ? run : null
}

// 送信前の確認(設計書「ダイアログ」)。開閉は useAgentSendConfirm の pending が持つので、開いている間だけ本体をマウントする
export default function AgentSendConfirmDialog({ state }: Props): React.JSX.Element | null {
  if (state.pending === null) return null
  return (
    <AgentSendConfirmDialogBody
      pending={state.pending}
      targetBlockedReason={state.targetBlockedReason}
      onConfirm={state.onConfirm}
      onCancel={state.onCancel}
    />
  )
}

interface BodyProps {
  pending: AgentSendConfirmPending
  targetBlockedReason: string | null
  onConfirm: () => void
  onCancel: () => void
}

function AgentSendConfirmDialogBody({
  pending,
  targetBlockedReason,
  onConfirm,
  onCancel
}: BodyProps): React.JSX.Element {
  // 開いた時点のフォーカス(キャンセルで閉じたときの戻り先)。マウントの後では送信へ移っているため、描画の時点で控える。
  // 変数のフォームから開いた場合、ここで控えるフォームの実行ボタンはこの描画のコミットで外れる(戻すときに一覧の実行を探す)
  const [opener] = useState(() => document.activeElement)
  const dialogRef = useRef<HTMLDivElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const reasonId = useId()

  const preview = buildAgentSendPreview(pending.text)
  // 本文の理由はキャンセルして直すしかないため先に出す。1 つだけ出す
  const reason = preview.rejection ?? targetBlockedReason
  const isSubmitDisabled = reason !== null

  const handleCancel = (): void => {
    findReturnFocusTarget(opener, pending.promptId)?.focus()
    onCancel()
  }
  const handleConfirm = (): void => {
    if (!isSubmitDisabled) onConfirm()
  }

  // 背景で押して離したときだけ閉じる(中と背景をまたぐドラッグでは閉じない。useOverlayDismiss)
  const overlayHandlers = useOverlayDismiss(handleCancel)
  // モーダルとして、Tab / Shift+Tab をダイアログの中(本文・送信・キャンセル)で回す(開いている間だけマウントする)
  useDialogFocusTrap(dialogRef, true)

  // 開いたら送信へ。送れない(押せない)ときはキャンセルへ。開いたときだけ
  useEffect(() => {
    const submit = submitRef.current
    if (submit !== null && !submit.disabled) submit.focus()
    else cancelRef.current?.focus()
  }, [])

  // 開いている間に送信を押せなくなった(送り先のセッションが終わった など)とき、フォーカスが送信に残る・body に落ちると
  // Esc がダイアログに届かないため、キャンセルへ移す
  useEffect(() => {
    if (!isSubmitDisabled) return
    const active = document.activeElement
    if (active === submitRef.current || active === document.body) cancelRef.current?.focus()
  }, [isSubmitDisabled])

  return (
    <div className="agent-send-confirm__overlay" role="presentation" {...overlayHandlers}>
      <div
        ref={dialogRef}
        className="agent-send-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // ダイアログの中の文字・余白をクリックしたときも、フォーカスが body に落ちず Esc が届くようにする(Tab の順には入らない)
        tabIndex={-1}
        onKeyDown={(e) => {
          // IME の変換を取り消す Esc では閉じない
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            handleCancel()
          }
        }}
      >
        <p id={titleId} className="agent-send-confirm__title">
          送信前の確認
        </p>
        <p className="agent-send-confirm__target">送り先: {pending.label}</p>
        {/* 読むだけ。長い本文は枠の中でスクロールし、Tab で止まってキーボードでもスクロールできる */}
        <pre className="agent-send-confirm__body" role="region" aria-label="送る内容" tabIndex={0}>
          {preview.text}
        </pre>
        <p className="agent-send-confirm__count">{LENGTH_FORMAT.format(preview.length)} 文字</p>
        {reason !== null && (
          <p id={reasonId} className="agent-send-confirm__reason" role="alert">
            {reason}
          </p>
        )}
        <div className="agent-send-confirm__actions">
          <button
            ref={submitRef}
            type="button"
            className="agent-send-confirm__submit"
            disabled={isSubmitDisabled}
            aria-describedby={reason !== null ? reasonId : undefined}
            onClick={handleConfirm}
          >
            送信
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="agent-send-confirm__cancel"
            onClick={handleCancel}
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}
```

`src/renderer/src/assets/main.css` の `.quick-open__empty { ... }` の規則の次に足す:
```css
/* エージェントへの送信前の確認(QuickOpenDialog・NameInputDialog と同じ系統の色。動きは付けないので prefers-reduced-motion の
   対応は要らない。ボタンはタッチで押せる 32px 以上) */
.agent-send-confirm__overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.4);
}

.agent-send-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 640px;
  max-width: 100%;
  max-height: 100%;
  box-sizing: border-box;
  padding: 16px;
  background: #252526;
  border: 1px solid #454545;
  border-radius: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
}

.agent-send-confirm:focus {
  outline: none;
}

.agent-send-confirm__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #cccccc;
}

.agent-send-confirm__target,
.agent-send-confirm__count {
  margin: 0;
  font-size: 12px;
  color: #a0a0a0;
}

.agent-send-confirm__body {
  flex: 1 1 auto;
  min-height: 64px;
  max-height: 50vh;
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

.agent-send-confirm__body:focus-visible {
  outline: 1px solid #007acc;
  outline-offset: -1px;
}

.agent-send-confirm__reason {
  margin: 0;
  font-size: 12px;
  color: #f48771;
  overflow-wrap: anywhere;
}

.agent-send-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.agent-send-confirm__submit,
.agent-send-confirm__cancel {
  min-height: 32px;
  min-width: 64px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}

.agent-send-confirm__submit {
  background: #0e639c;
  color: #ffffff;
  border: none;
}

.agent-send-confirm__submit:hover:not(:disabled) {
  background: #1177bb;
}

.agent-send-confirm__submit:disabled {
  opacity: 0.5;
  cursor: default;
}

.agent-send-confirm__cancel {
  background: none;
  color: #cccccc;
  border: 1px solid #555555;
}

.agent-send-confirm__cancel:hover {
  border-color: #888888;
}

.agent-send-confirm__submit:focus-visible,
.agent-send-confirm__cancel:focus-visible {
  outline: 1px solid #007acc;
  outline-offset: 2px;
}
```

- [ ] **Step 4: テストを通す・型チェック・lint**

Run: `npx vitest run src/renderer/src/components/agent src/renderer/src/components/prompts`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: 下の eslint に渡すのと同じファイルへ `npx eslint --fix <files>`（prettier の 100 桁の折り返しなど、自動で直せるものを先に直す）
Run: `npx eslint --max-warnings 0 src/renderer/src/types.ts src/renderer/src/components/agent/AgentSendConfirmDialog.tsx src/renderer/src/components/prompts/PromptItemView.tsx src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx src/renderer/src/components/prompts/__tests__/PromptItemView.test.tsx`
Expected: エラー・警告なし（`react-hooks` の規則が `useState(() => document.activeElement)` を指摘したら、指摘の文言を確かめて直す。ただし「描画の時点〈マウントの effect・autoFocus より前〉で控える」ことは変えない。変えると、キャンセルの戻り先が `送信` になる）

---

### Task 5: 送信の流れへの差し込み（useAgentWorkspace・usePromptRunner・useAppState・App）

**Files:**
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`
- Modify: `src/renderer/src/hooks/usePromptRunner.ts`
- Modify: `src/renderer/src/hooks/useAppState.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/__tests__/makeAgentWorkspaceState.ts`
- Test: `src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`、`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`、`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`、`src/renderer/src/components/__tests__/App.agentSendConfirm.test.tsx`（新規）

**Interfaces:**
- Consumes: Task 2 の `useAgentSendConfirmSetting()`（`enabled: boolean | null`）、Task 3 の `useAgentSendConfirm({ selected, send, onConfirmed })` → `{ pending: PendingAgentSend | null; request; confirm; cancel }`、Task 4 の `AgentSendConfirmDialogState`・`AgentSendConfirmDialog`、既存の `useOnChange(value, onChange)`・`getPromptRunAvailability(params)`・`useAgentTabActivation` の戻り値（`activateAgentTab(slotId)`）
- Produces:
```ts
// AgentWorkspaceState の変更
/** プロンプトを送る(usePromptRunner に渡す)。送信前の確認の設定がオン(読み込み中も)なら送らずに確認を開き、undefined で resolve する。
 *  オフなら押した時点の選択中のタブへすぐ送る。promptId は確認をキャンセルで閉じたときのフォーカスの戻り先を探すのに使う */
sendToAgent: (text: string, promptId: string | null) => ReturnType<AgentPromptSenderState['send']>
/** 送信前の確認のダイアログ(App が描画する) */
agentSendConfirmDialog: AgentSendConfirmDialogState
// usePromptRunner の Deps の変更
sendToAgent: (text: string, promptId: string) => Promise<unknown>
```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`: 「エージェント CLI 方式では本文だけをエージェントへ送り、従来の実行と履歴の記録をしない」の期待値を直す（プロンプトの id も渡す）:
```ts
    // ファイル内容を添付しない(C2)・履歴に記録しない(C11)。プロンプトの id は確認の戻り先を探すため
    expect(sendToAgent).toHaveBeenCalledExactlyOnceWith('送る本文', 'p1')
```

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`:
- import に `RUN_DISABLED_NO_SESSION` を足す（`'../../lib/agentSendMessages'` から。`RUN_DISABLED_CLOSING, RUN_DISABLED_SENDING` と並べる）。
- 既存の「sendToAgent は押した時点の選択中のタブを送り先にする。…」のテストの先頭に `setSendConfirmEnabled(false)` を足し（確認なしの経路のテスト）、`result.current.sendToAgent('hello')` を `result.current.sendToAgent('hello', null)` に直す。
- `describe('エージェントへの送信'` の後に足す:
```ts
  describe('送信前の確認', () => {
    // 選択中のタブ 2 が running(送り先)。タブ 1 も running
    const twoRunningTabs = (
      tab2Overrides: Partial<AgentSessionTabView> = {}
    ): { tab1: AgentSessionTabView; tab2: AgentSessionTabView } => ({
      tab1: makeAgentSessionTabView({ status: 'running' }),
      tab2: makeAgentSessionTabView({
        slotId: 'slot-2',
        number: 2,
        label: 'claude 2',
        status: 'running',
        ...tab2Overrides
      })
    })

    const setTabs = (
      tabs: AgentSessionTabView[],
      selectedSlotId: string,
      selectTab = vi.fn<(slotId: string) => void>()
    ): void => {
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ tabs, selected: { slotId: selectedSlotId }, selectTab })
      )
    }

    const openConfirm = async (result: Rendered['result']): Promise<void> => {
      await act(async () => {
        await result.current.sendToAgent('hello', 'p1')
      })
    }

    it('設定がオンなら送らずに確認を開き、押した時点の選択中のタブを送り先として控える', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      const { tab1, tab2 } = twoRunningTabs()
      setTabs([tab1, tab2], 'slot-2')
      const { result } = renderWorkspace()
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      await openConfirm(result)
      expect(sender.send).not.toHaveBeenCalled()
      expect(result.current.agentSendConfirmDialog.pending).toEqual({
        text: 'hello',
        slotId: 'slot-2',
        label: 'claude 2',
        promptId: 'p1'
      })
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBeNull()
    })

    it('設定の読み込み中(null)も確認を開く(既定がオンのため)', async () => {
      setMode('agent-cli')
      setSendConfirmEnabled(null)
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ selected: { status: 'running' } }))
      const { result } = renderWorkspace()
      await openConfirm(result)
      expect(sender.send).not.toHaveBeenCalled()
      expect(result.current.agentSendConfirmDialog.pending).not.toBeNull()
    })

    it('設定がオフ(読み込み後)なら確認を開かず、押した時点の選択中のタブへすぐ送る', async () => {
      setMode('agent-cli')
      setSendConfirmEnabled(false)
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      const { tab1, tab2 } = twoRunningTabs()
      setTabs([tab1, tab2], 'slot-2')
      const { result } = renderWorkspace()
      await openConfirm(result)
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      expect(sender.send).toHaveBeenCalledExactlyOnceWith('hello', {
        slotId: 'slot-2',
        controller: tab2.controller
      })
    })

    it('確認の送信で、控えた送り先へ送って閉じ、パネルを開いてそのタブのターミナルへフォーカスを移す', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      const { tab1, tab2 } = twoRunningTabs()
      const selectTab = vi.fn<(slotId: string) => void>()
      setTabs([tab1, tab2], 'slot-2', selectTab)
      const { result } = renderWorkspace()
      act(() => result.current.agentTerminal.layout.toggleOpen())
      await openConfirm(result)
      act(() => result.current.agentSendConfirmDialog.onConfirm())
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      expect(sender.send).toHaveBeenCalledExactlyOnceWith('hello', {
        slotId: 'slot-2',
        controller: tab2.controller
      })
      expect(result.current.agentTerminal.layout.isOpen).toBe(true)
      expect(selectTab).toHaveBeenCalledWith('slot-2')
      expect(tab2.controller.focus).toHaveBeenCalledTimes(1)
      expect(tab1.controller.focus).not.toHaveBeenCalled()
    })

    it('確認のキャンセルで閉じ、送らない', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ selected: { status: 'running' } }))
      const { result } = renderWorkspace()
      await openConfirm(result)
      act(() => result.current.agentSendConfirmDialog.onCancel())
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      expect(sender.send).not.toHaveBeenCalled()
    })

    it('確認を開いている間の 2 回目の送信の依頼は無視する', async () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ selected: { status: 'running' } }))
      const { result } = renderWorkspace()
      await openConfirm(result)
      await act(async () => {
        await result.current.sendToAgent('second', 'p2')
      })
      expect(result.current.agentSendConfirmDialog.pending?.text).toBe('hello')
    })

    it('開いている間に従来の方式へ切り替わったら閉じる(送らない。L-405)', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ selected: { status: 'running' } }))
      const { result, rerender } = renderWorkspace()
      await openConfirm(result)
      setMode('legacy')
      rerender()
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      expect(sender.send).not.toHaveBeenCalled()
    })

    it('開いている間にフォルダが変わったら閉じる(送らない。L-405)', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ selected: { status: 'running' } }))
      const { result, rerender } = renderHook(
        ({ folderPath }: { folderPath: string | null }) =>
          useAgentWorkspace({ folderPath, isExecuting: false }),
        { initialProps: { folderPath: '/a' as string | null } }
      )
      await openConfirm(result)
      rerender({ folderPath: '/b' })
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      expect(sender.send).not.toHaveBeenCalled()
    })

    it('開いている間に送り先のタブが閉じたら閉じる(送らない。L-405)', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      const { tab1, tab2 } = twoRunningTabs()
      setTabs([tab1, tab2], 'slot-2')
      const { result, rerender } = renderWorkspace()
      await openConfirm(result)
      setTabs([tab1], 'slot-1')
      rerender()
      expect(result.current.agentSendConfirmDialog.pending).toBeNull()
      expect(sender.send).not.toHaveBeenCalled()
    })

    it('開いている間にほかのタブが閉じても閉じない', async () => {
      setMode('agent-cli')
      const { tab1, tab2 } = twoRunningTabs()
      setTabs([tab1, tab2], 'slot-2')
      const { result, rerender } = renderWorkspace()
      await openConfirm(result)
      setTabs([tab2], 'slot-2')
      rerender()
      expect(result.current.agentSendConfirmDialog.pending?.slotId).toBe('slot-2')
    })

    it.each([
      ['セッションが終わった(タブは残る)', { status: 'exited' as const }, RUN_DISABLED_NO_SESSION],
      ['閉じる途中', { isClosing: true }, RUN_DISABLED_CLOSING]
    ])('開いている間に送り先の状態が変わっても(%s)、閉じずに理由を出す', async (_label, tab2Overrides, reason) => {
      setMode('agent-cli')
      const { tab1, tab2 } = twoRunningTabs()
      setTabs([tab1, tab2], 'slot-2')
      const { result, rerender } = renderWorkspace()
      await openConfirm(result)
      const changed = twoRunningTabs(tab2Overrides)
      setTabs([tab1, changed.tab2], 'slot-2')
      rerender()
      expect(result.current.agentSendConfirmDialog.pending?.slotId).toBe('slot-2')
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(reason)
    })

    it('送信中(全体で 1 つ)なら理由を出す', async () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ selected: { status: 'running' } }))
      const { result, rerender } = renderWorkspace()
      await openConfirm(result)
      mockUseAgentPromptSender.mockReturnValue(makeSender({ isSending: true, sendingSlotId: 'slot-9' }))
      rerender()
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(RUN_DISABLED_SENDING)
    })

    it('理由は控えた送り先のタブの状態から求める(開いた後に未起動のタブを選んでも理由は出ない)', async () => {
      setMode('agent-cli')
      const tab1 = makeAgentSessionTabView({ status: 'none' })
      const { tab2 } = twoRunningTabs()
      setTabs([tab1, tab2], 'slot-2')
      const { result, rerender } = renderWorkspace()
      await openConfirm(result)
      setTabs([tab1, tab2], 'slot-1')
      rerender()
      expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBeNull()
      expect(result.current.agentSendConfirmDialog.pending?.label).toBe('claude 2')
    })

    it('開いている間に設定をオフにしても閉じない(次の実行から確認しない)', async () => {
      setMode('agent-cli')
      mockUseAgentSessions.mockReturnValue(makeAgentSessionsState({ selected: { status: 'running' } }))
      const { result, rerender } = renderWorkspace()
      await openConfirm(result)
      setSendConfirmEnabled(false)
      rerender()
      expect(result.current.agentSendConfirmDialog.pending).not.toBeNull()
    })
  })
```

`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`: 「送信前の確認の設定の項目を、useAgentWorkspace の戻り値のまま公開する」（Task 2）の次に足す:
```ts
    it('送信前の確認のダイアログを、useAgentWorkspace の戻り値のまま公開する', () => {
      const workspace = makeAgentWorkspaceState({
        agentSendConfirmDialog: {
          pending: { text: '本文', slotId: 'slot-1', label: 'claude 1', promptId: 'p1' },
          targetBlockedReason: null,
          onConfirm: vi.fn(),
          onCancel: vi.fn()
        }
      })
      mockUseAgentWorkspace.mockReturnValue(workspace)
      const { result } = renderHook(() => useAppState())
      expect(result.current.agentSendConfirmDialog).toBe(workspace.agentSendConfirmDialog)
    })
```

`src/renderer/src/components/__tests__/App.agentSendConfirm.test.tsx`（新規。App → useAppState → ダイアログの配線を、useAgentWorkspace の型付きの偽物で確かめる。L-060）:
```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAgentWorkspaceState } from '../../__tests__/makeAgentWorkspaceState'

const mockUseAgentWorkspace = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useAgentWorkspace', () => ({ useAgentWorkspace: mockUseAgentWorkspace }))

import App from '../../App'

describe('App: 送信前の確認の配線', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api.loadPrompts = vi.fn().mockResolvedValue([])
    window.api.onExternalFileChange = vi.fn(() => () => {})
    mockUseAgentWorkspace.mockReturnValue(makeAgentWorkspaceState())
  })

  it('確認が閉じていればダイアログを出さない', () => {
    render(<App />)
    expect(screen.queryByRole('dialog', { name: '送信前の確認' })).toBeNull()
  })

  it('開いている確認をダイアログに描画し、送信・キャンセルを useAgentWorkspace の操作へ渡す', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    mockUseAgentWorkspace.mockReturnValue(
      makeAgentWorkspaceState({
        agentSendConfirmDialog: {
          pending: { text: '本文', slotId: 'slot-1', label: 'claude 1', promptId: 'p1' },
          targetBlockedReason: null,
          onConfirm,
          onCancel
        }
      })
    )
    render(<App />)
    const dialog = await screen.findByRole('dialog', { name: '送信前の確認' })
    expect(within(dialog).getByText('送り先: claude 1')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: '送信' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    await userEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('送り先の今の状態の理由をダイアログへ渡す', async () => {
    mockUseAgentWorkspace.mockReturnValue(
      makeAgentWorkspaceState({
        agentSendConfirmDialog: {
          pending: { text: '本文', slotId: 'slot-1', label: 'claude 1', promptId: 'p1' },
          targetBlockedReason: 'エージェントが起動していません（ターミナルの「起動」を押してください）',
          onConfirm: vi.fn(),
          onCancel: vi.fn()
        }
      })
    )
    render(<App />)
    const dialog = await screen.findByRole('dialog', { name: '送信前の確認' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('エージェントが起動していません')
    expect(within(dialog).getByRole('button', { name: '送信' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/App.agentSendConfirm.test.tsx`
Expected: FAIL（`agentSendConfirmDialog` が無い・`sendToAgent` に id が渡らない）

- [ ] **Step 3: 実装する**

`src/renderer/src/hooks/usePromptRunner.ts`:
- `Deps` の `sendToAgent` を直す:
```ts
  /** エージェント CLI 方式の送信(useAgentWorkspace.sendToAgent。送信前の確認の設定がオンなら、送る前に確認を開く)。プロンプトの
   *  id は、確認をキャンセルで閉じたときのフォーカスの戻り先を探すのに使う。ファイル内容は添付しない(C2) */
  sendToAgent: (text: string, promptId: string) => Promise<unknown>
```
- `runPrompt` の `await sendToAgent(content)` を `await sendToAgent(content, prompt.id)` にする（流れは変えない）。

`src/renderer/src/hooks/useAgentWorkspace.ts` を次に置き換える（Task 2 の `agentSendConfirmPanel` を含む。ほかの部分は今のまま。`sendToAgent` は `useAgentTabActivation` の後へ移す）:
```ts
import { useCallback, useRef, useState } from 'react'
import type { PromptExecutionMode } from '@shared/types'
import type {
  AgentNotificationPanelState,
  AgentSendConfirmDialogState,
  AgentSendConfirmPanelState,
  ExecutionModePanelState,
  PromptRunPanelState
} from '../types'
import { useAgentNotificationSetting } from './useAgentNotificationSetting'
import { useAgentSendConfirmSetting } from './useAgentSendConfirmSetting'
import { useAgentSendConfirm } from './useAgentSendConfirm'
import { useExecutionMode } from './useExecutionMode'
import { useAgentSessions } from './useAgentSessions'
import type { AgentSessionsState } from './useAgentSessions'
import { useAgentActivity } from './useAgentActivity'
import { useAgentStatusBar } from './useAgentStatusBar'
import { useAgentTabActivation } from './useAgentTabActivation'
import { useAgentNotifications } from './useAgentNotifications'
import type { AgentStatusBarState } from './useAgentStatusBar'
import { useAgentPromptSender } from './useAgentPromptSender'
import type { AgentPromptSenderState } from './useAgentPromptSender'
import { useAgentTerminalPanel } from './useAgentTerminalPanel'
import type { AgentTerminalPanelLayout } from './useAgentTerminalPanel'
import { useOnChange } from './useOnChange'
import type { AgentActivity } from '../lib/agentActivity'
import { getAgentSessionTabs } from '../lib/xtermFactory'
import { buildPromptRunPanelState } from '../lib/promptRunState'
import { getPromptRunAvailability } from '../lib/agentSendMessages'
import {
  AGENT_START_DISABLED_SWITCHING_MODE,
  AGENT_STOP_ON_MODE_CHANGE_CONFIRM,
  EXECUTION_MODE_LOCKED_WHILE_EXECUTING
} from '../lib/agentSessionMessages'

// 実行方式とエージェント(ターミナル・セッション・活動・ステータスバーのまとめ・送信前の確認・送信)の組み立て。useAppState から使う。
// 実行方式の切り替えの手順(再入防止・確認・停止を待ってから保存)と、フォルダの切り替えの前のエージェントの停止の確認を持つ

// ターミナルのパネルへ渡す状態(useAgentWorkspace が組み立て、EditorPanel → AgentTerminalPanel へ渡す)
export interface AgentTerminalPanelState {
  sessions: AgentSessionsState
  layout: AgentTerminalPanelLayout
  /** 送信中のタブ(× を押せない)。送信中でなければ null */
  sendingSlotId: string | null
  /** タブごとの claude の活動(画面から判定。running でないタブ・未判定は 'unknown') */
  activities: ReadonlyMap<string, AgentActivity>
}

export interface UseAgentWorkspaceOptions {
  /** 開いているフォルダ(エージェントの作業フォルダ) */
  folderPath: string | null
  /** 従来の方式で実行しているか */
  isExecuting: boolean
  /** 確認のダイアログ(既定は window.confirm。テストで差し替える) */
  onConfirm?: (message: string) => boolean
  /** プロンプトをエージェントへ送る前に待つ準備(useAgentChangesRecording の beginAndRefresh。エージェントの変更の記録を始め、一覧を取り直す) */
  beforeAgentSend?: () => Promise<void>
}

export interface AgentWorkspaceState {
  /** 設定パネルの実行方式の項目。mode は読み込み中は null。isLocked は読み込み中・エージェントの起動中・切り替えの途中・
   *  従来の方式の実行中。lockedReason は従来の方式の実行中だけ。onSelect は従来の方式へ切り替えるとき、実行中の
   *  エージェントがあれば確認してから止める */
  executionModePanel: ExecutionModePanelState
  /** 設定パネルのエージェントの通知の項目 */
  agentNotificationPanel: AgentNotificationPanelState
  /** 設定パネルの送信前の確認の項目 */
  agentSendConfirmPanel: AgentSendConfirmPanelState
  /** フォルダの切り替えの前に、実行中(起動中を含む)のエージェントを終了してよいかを確かめる。無ければ確認せずに true */
  confirmStopAgent: (message: string) => boolean
  /** 実行ボタン・再実行の押せる条件と送信の結果 */
  promptRun: PromptRunPanelState
  /** エディタの領域の下部のパネル */
  bottomPanel: 'output' | 'agent-terminal' | 'none'
  agentTerminal: AgentTerminalPanelState
  /** ステータスバーのエージェントのまとめ。エージェント CLI 方式でなければ null */
  statusBarAgent: AgentStatusBarState | null
  /** エージェントの状態の変化の読み上げの文言(App がステータスバーの隣の常設の aria-live の領域に出す) */
  agentAnnouncement: string
  /** 送信前の確認のダイアログ(App が描画する) */
  agentSendConfirmDialog: AgentSendConfirmDialogState
  /** プロンプトを送る(usePromptRunner に渡す)。送信前の確認の設定がオン(読み込み中も)なら送らずに確認を開き、undefined で
   *  resolve する。オフなら押した時点の選択中のタブへすぐ送る。promptId は確認をキャンセルで閉じたときのフォーカスの戻り先を探すのに使う */
  sendToAgent: (text: string, promptId: string | null) => ReturnType<AgentPromptSenderState['send']>
}

export function useAgentWorkspace({
  folderPath,
  isExecuting,
  onConfirm = confirm,
  beforeAgentSend
}: UseAgentWorkspaceOptions): AgentWorkspaceState {
  const executionMode = useExecutionMode()
  const notificationSetting = useAgentNotificationSetting()
  const sendConfirmSetting = useAgentSendConfirmSetting()
  // タブの一覧と xterm の controller を持つ、文書ごとに 1 つの置き場(StrictMode・パネルの開閉で作り直さない)
  const [agentTabs] = useState(getAgentSessionTabs)
  const agentLayout = useAgentTerminalPanel()
  // 切り替えの途中(エージェントの停止を待つ間)は、もう一度選んでも確認・停止・保存を重ねない。ref は同じ描画の中の
  // 2 回目の呼び出しを止め、state は選択肢と、起動・+ を押せなくする
  const switchingModeRef = useRef(false)
  const [isSwitchingMode, setIsSwitchingMode] = useState(false)
  const agentSessions = useAgentSessions({
    folderPath,
    tabs: agentTabs,
    enabled: executionMode.mode === 'agent-cli',
    // 停止を待つ間に別のタブで起動すると、そのセッションは止める対象に入らず、従来の方式でパネルが隠れた後も動き続けるため
    startBlockedReason: isSwitchingMode ? AGENT_START_DISABLED_SWITCHING_MODE : null,
    onConfirm
  })
  // タブの一覧は useAgentSessions がタブの状態の変わったときだけ作り直すため、そのまま渡す
  // (useAgentActivity はタブの配列が変わったときだけ区切りを見直す)
  const activities = useAgentActivity({ tabs: agentSessions.tabs })
  const agentSender = useAgentPromptSender({
    onSettled: agentLayout.open,
    beforeSend: beforeAgentSend
  })
  const isAgentMode = executionMode.mode === 'agent-cli'
  // タブへ移る(パネルを開く・選ぶ・描画の後のフォーカス)。ステータスバーのまとめ・通知を押したとき・送信前の確認の送信で使う
  const activateAgentTab = useAgentTabActivation({
    selected: agentSessions.selected,
    selectTab: agentSessions.selectTab,
    openPanel: agentLayout.open
  })
  // 送信前の確認(設計書「流れ」)。送り先は確認を開いた時点の選択中のタブ。送信で閉じたら、そのタブのターミナルへフォーカスを
  // 移す(送信中は実行ボタンが disabled になり、開く前の要素へは戻せないため。送信中のキー入力は sender が保留する)
  const sendConfirm = useAgentSendConfirm({
    selected: agentSessions.selected,
    send: agentSender.send,
    onConfirmed: activateAgentTab
  })
  // 送り先は押した時点の選択中のタブ。送信の途中でタブを切り替えても変えない(sender が target を控える)
  // usePromptRunner の useCallback の依存に入るため、選択中のタブ・send・確認の要否が変わらなければ同じ参照を返す
  const { slotId: selectedSlotId, controller: selectedController } = agentSessions.selected
  const sendAgentPrompt = agentSender.send
  const requestSendConfirm = sendConfirm.request
  // 設定がオンなら(読み込み中も。既定がオンのため)、すぐには送らず確認を開く
  const isSendConfirmRequired = sendConfirmSetting.enabled !== false
  const sendToAgent = useCallback(
    async (text: string, promptId: string | null): ReturnType<AgentPromptSenderState['send']> => {
      if (isSendConfirmRequired) {
        requestSendConfirm(text, promptId)
        return undefined
      }
      return sendAgentPrompt(text, { slotId: selectedSlotId, controller: selectedController })
    },
    [isSendConfirmRequired, requestSendConfirm, sendAgentPrompt, selectedSlotId, selectedController]
  )
  // 確認を開いている間に、元の状態が終わったら閉じる(送らない。L-405): 従来の方式への切り替え・フォルダの切り替え・送り先の
  // タブを閉じた。送り先のセッションが終わっただけ(タブは残る)なら閉じず、下の理由で送信を押せなくする。設定をオフにしても閉じない
  const cancelSendConfirm = sendConfirm.cancel
  useOnChange(isAgentMode, () => {
    if (!isAgentMode) cancelSendConfirm()
  })
  useOnChange(folderPath, cancelSendConfirm)
  const pendingSend = sendConfirm.pending
  const pendingTab =
    pendingSend === null
      ? undefined
      : agentSessions.tabs.find((tab) => tab.slotId === pendingSend.target.slotId)
  const isPendingTabClosed = pendingSend !== null && pendingTab === undefined
  useOnChange(isPendingTabClosed, () => {
    if (isPendingTabClosed) cancelSendConfirm()
  })
  // 送り先のタブが今は送れない理由。控えた slotId のタブの今の状態と、全体で 1 つの送信中から、実行ボタンと同じ規則で求める
  const targetBlockedReason =
    pendingTab === undefined
      ? null
      : getPromptRunAvailability({
          mode: executionMode.mode,
          isExecuting,
          isSessionRunning: pendingTab.status === 'running',
          isSessionClosing: pendingTab.isClosing,
          isSending: agentSender.isSending
        }).reason
  const statusBarAgent = useAgentStatusBar({
    enabled: isAgentMode,
    tabs: agentSessions.tabs,
    selectedSlotId: agentSessions.selected.slotId,
    activities,
    openPanel: agentLayout.open,
    activateTab: activateAgentTab
  })
  // 完了・許可待ちの知らせ(読み上げ・OS の通知・バッジ)。通知を押したときはステータスバーと同じくタブへ移る。
  // ステータスバーと同じく、エージェント CLI 方式でなければ知らせない
  const agentAnnouncement = useAgentNotifications({
    tabs: agentSessions.tabs,
    activities,
    enabled: notificationSetting.enabled,
    isAgentMode,
    activateTab: activateAgentTab
  })
  const isAnyAgentSessionActive = agentSessions.isAnyActive
  const isAnyAgentStarting = agentSessions.isAnyStarting
  // 実行ボタンの押せる条件は選択中のタブ(送り先)の状態で決まる
  const promptRun = buildPromptRunPanelState({
    mode: executionMode.mode,
    isExecuting,
    sessionStatus: agentSessions.selected.status,
    isSessionClosing: agentSessions.selected.isClosing,
    isSending: agentSender.isSending,
    sendError: agentSender.error,
    sendNotice: agentSender.notice
  })
  // フォルダの切り替え・従来の方式への切り替えの前に、実行中のエージェントを終了してよいかを確かめる
  const confirmStopAgent = (message: string): boolean =>
    !isAnyAgentSessionActive || onConfirm(message)
  const selectExecutionMode = async (next: PromptExecutionMode): Promise<void> => {
    if (switchingModeRef.current) return
    // 従来の方式の実行中に切り替えると、出力パネルが消えてキャンセルできないまま実行が続くため切り替えない
    if (next === executionMode.mode || isAnyAgentStarting || isExecuting) return
    switchingModeRef.current = true
    setIsSwitchingMode(true)
    try {
      if (next === 'legacy' && isAnyAgentSessionActive) {
        if (!onConfirm(AGENT_STOP_ON_MODE_CHANGE_CONFIRM)) return
        // stopAll は main の停止(プロセスの終了の待ちまで)が終わってから解決し、失敗しても reject しない(失敗はそのタブに
        // 出す)。保存(=セッションを持たない方式への切り替え)はすべてのタブが止まってからにする。止められなかったタブが
        // あれば方式を変えない(パネルが隠れて、動き続けるセッションを止められなくなるため)。止めている間に起動したタブが
        // 残っていても false になり、方式を変えない
        if (!(await agentSessions.stopAll())) return
      }
      await executionMode.changeMode(next)
    } finally {
      switchingModeRef.current = false
      setIsSwitchingMode(false)
    }
  }
  return {
    executionModePanel: {
      mode: executionMode.mode,
      saveError: executionMode.saveError,
      isLocked: executionMode.mode === null || isAnyAgentStarting || isSwitchingMode || isExecuting,
      lockedReason: isExecuting ? EXECUTION_MODE_LOCKED_WHILE_EXECUTING : null,
      // 選択肢のクリックは完了を待たない。changeMode は失敗を false で返し、stopAll は reject しないので本来は
      // 投げないが、投げたら記録して握る(ロックは finally で戻している)
      onSelect: (mode) => {
        selectExecutionMode(mode).catch((err: unknown) => {
          console.error('[useAgentWorkspace] selectExecutionMode failed:', err)
        })
      }
    },
    agentNotificationPanel: {
      enabled: notificationSetting.enabled,
      saveError: notificationSetting.saveError,
      // changeEnabled は失敗を false で返し、拒否しない(失敗は saveError に出る)
      onChange: (enabled) => {
        void notificationSetting.changeEnabled(enabled)
      }
    },
    agentSendConfirmPanel: {
      enabled: sendConfirmSetting.enabled,
      saveError: sendConfirmSetting.saveError,
      // changeEnabled は失敗を false で返し、拒否しない(失敗は saveError に出る)
      onChange: (enabled) => {
        void sendConfirmSetting.changeEnabled(enabled)
      }
    },
    confirmStopAgent,
    promptRun,
    bottomPanel: executionMode.mode === null ? 'none' : isAgentMode ? 'agent-terminal' : 'output',
    agentTerminal: {
      sessions: agentSessions,
      layout: agentLayout,
      sendingSlotId: agentSender.sendingSlotId,
      activities
    },
    statusBarAgent,
    agentAnnouncement,
    agentSendConfirmDialog: {
      pending:
        pendingSend === null
          ? null
          : {
              text: pendingSend.text,
              slotId: pendingSend.target.slotId,
              label: pendingSend.label,
              promptId: pendingSend.promptId
            },
      targetBlockedReason,
      onConfirm: sendConfirm.confirm,
      onCancel: sendConfirm.cancel
    },
    sendToAgent
  }
}
```

`src/renderer/src/hooks/useAppState.ts` の戻り値の `agentSendConfirmPanel: agentWorkspace.agentSendConfirmPanel,`（Task 2）の次に足す:
```ts
    agentSendConfirmDialog: agentWorkspace.agentSendConfirmDialog,
```
（`usePromptRunner` には今のまま `sendToAgent: agentWorkspace.sendToAgent` を渡す。`AppState` は `Omit<AgentWorkspaceState, 'confirmStopAgent' | 'sendToAgent'>` を含むので、渡し忘れは型エラーになる。）

`src/renderer/src/__tests__/makeAgentWorkspaceState.ts` の戻り値の `agentAnnouncement: '',` の次に足す（既定は「閉じている」）:
```ts
    agentSendConfirmDialog: {
      pending: null,
      targetBlockedReason: null,
      onConfirm: vi.fn<AgentWorkspaceState['agentSendConfirmDialog']['onConfirm']>(),
      onCancel: vi.fn<AgentWorkspaceState['agentSendConfirmDialog']['onCancel']>()
    },
```

`src/renderer/src/App.tsx`:
- `import AgentSendConfirmDialog from './components/agent/AgentSendConfirmDialog'` を足す。
- `useAppState()` の分割代入の `agentSendConfirmPanel,`（Task 2）の次に `agentSendConfirmDialog,` を足す。
- `<QuickOpenDialog controller={quickOpen} />` の次に足す:
```tsx
      <AgentSendConfirmDialog state={agentSendConfirmDialog} />
```

- [ ] **Step 4: テストを通す・型チェック・lint**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__ src/renderer/src/components/agent src/renderer/src/components/prompts`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: 下の eslint に渡すのと同じファイルへ `npx eslint --fix <files>`（prettier の 100 桁の折り返しなど、自動で直せるものを先に直す）
Run: `npx eslint --max-warnings 0 src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/hooks/usePromptRunner.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/App.tsx src/renderer/src/__tests__/makeAgentWorkspaceState.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/App.agentSendConfirm.test.tsx`
Expected: エラー・警告なし

---

### Task 6: ROADMAP・実機テスト仕様書の更新と全体の検証

**Files:** `ROADMAP.md`、`docs/manual-test-spec.md`、`.superpowers/manual-test-spec.html`（生成。git 管理外）

- [ ] **Step 1: ROADMAP**
  - 「今後実装した方がよい機能（未実装）」→「エージェント実行の支援（MVP の次）」の `- [ ] 送信前の確認 / プレビュー（変数を差し込んだ後のプロンプトを確かめてから送る）` を消す。
  - 「実装済み機能」の `### エージェントの完了・許可待ちの通知` の節（既知の制約の箇条書きまで）の後、`---` の前に次の節を足す:
```markdown
### エージェントへの送信前の確認

設計書: `docs/superpowers/specs/2026-10-10-agent-send-confirm-design.md`（2026-10-10）。

- [x] エージェント CLI 方式でプロンプトの `実行`（変数のフォームの `実行` を含む）を押すと、送る前に「送信前の確認」のダイアログを開く（従来の方式は今のまま）
- [x] 変数を差し込んだ後の全文（送るときと同じ正規化の後。改行を保ち、長い本文は枠の中でスクロール）・送り先のタブ（開いた時点のタブ。名前も固定）・文字数を出し、`送信` で控えた送り先へ送る。送った後は送り先のタブのターミナルへフォーカスを移す
- [x] 送れない理由（空・長すぎる・先頭が `!`）と、送り先のタブが今は送れない理由（終了した・閉じる途中・送信中）をダイアログで先に出し、`送信` を押せなくする
- [x] `キャンセル`・`Esc`・背景のクリックで送らずに閉じ、開く前の要素（変数のフォームから開いたときは、同じプロンプトの一覧の `実行`）へフォーカスを戻す。従来の方式への切り替え・フォルダの切り替え・送り先のタブを閉じたときも閉じる
- [x] 設定画面の「送信前の確認」（既定はオン。オフで確認せずにすぐ送る）

既知の制約（設計書の「既知の制約」と同じ）:
- 変数のフォームから開いた確認をキャンセルすると、入力した変数の値は残らない（もう一度 `実行` から入力する）
- 確認の画面では本文を直せない（キャンセルしてプロンプト〈または変数〉を直す）
```

- [ ] **Step 2: 実機テスト仕様書**
  - 最大の番号を確かめる: `grep -o 'AGT-[0-9]*' docs/manual-test-spec.md | sort -t- -k2 -n | tail -1`（計画の時点では `AGT-150`。違えばその次から振る）。
  - `grep -n '^## \|^### ' docs/manual-test-spec.md` で、`### 完了・許可待ちの通知` が `## エージェント CLI のアプリ内ターミナル` の領域の最後の `###` であることを確かめる（後ろに別の `###` が増えていれば、その領域の最後の `###` の後に足す）。
  - `## エージェント CLI のアプリ内ターミナル` の領域の最後の `### 完了・許可待ちの通知` の項目の後（`## エージェントの変更の確認` の前）に、次の節を足す（書式は `- [ ] **<ID>** <手順> → <期待結果>`、1 行 1 項目。番号は上の確認に合わせて振り直す）。設計書「エラーと境界の扱い」の各行との対応（L-297。画面から通れる行だけを項目にする）: 送り先のセッションが終わった → AGT-160、送信の後の失敗 → AGT-167、二重送信 → AGT-154・AGT-078。方式・フォルダの切り替え・送り先のタブを閉じた・設定をオフにした、の 4 経路は、ダイアログを開いている間は背景のクリックで閉じるため画面から通れないので、項目にせず `useAgentWorkspace` の単体テスト（Task 5）で確かめる:
```markdown
### 送信前の確認

> 前提: Claude Code（`claude`）がインストールされログイン済みで、テスト用のフォルダを開き、ターミナルのパネルで `claude 1` を起動している（設定の実行方式はエージェント CLI、設定の「送信前の確認」はオン〈既定〉）。プロンプトは「プロンプト」パネルに `挨拶`（内容 `このフォルダのファイルを一覧して`）と `説明`（内容 `{{name}} さんに {{topic}} について説明して`）を登録しておく。
> 前提: 実装の自動テストでは、実物の `claude` も Electron の画面も使っていない。以下はすべて実機で未確認。期待と違ったら、その画面（ダイアログ・ターミナル・プロンプトパネルの文言）を記録する。

- [ ] **AGT-151** `挨拶` の `実行` を押す → 見出し `送信前の確認` のダイアログが開き、`送り先: claude 1`・本文 `このフォルダのファイルを一覧して`・`16 文字` が出て、`送信` にフォーカスがある。ターミナルの `claude` の入力欄にはまだ何も入っていない
- [ ] **AGT-152** AGT-151 のダイアログで `送信` を押す → ダイアログが閉じ、本文が `claude 1` に送られて作業が始まり、プロンプトパネルに `エージェントに送信しました` が出る。フォーカスは `claude 1` のターミナルにあり、続けて打った文字がそのまま `claude` の入力欄に入る
- [ ] **AGT-153** `説明` の `実行` を押し、変数のフォームで `name` に `山田`、`topic` に `Git` を入れて `実行` を押す → ダイアログの本文が `山田 さんに Git について説明して`（差し込んだ後）になっている。`キャンセル` を押すと何も送られず、変数のフォームは閉じたまま（入力した値は残らない）で、フォーカスは `説明` の一覧の `実行` ボタンにある
- [ ] **AGT-154** `挨拶` の `実行` でダイアログを開き、`キャンセル`・`Esc`・ダイアログの外の暗い部分のクリック、をそれぞれ試す → どれでもダイアログが閉じ、ターミナルに何も入らず、フォーカスは押した `実行` ボタンに戻る。ダイアログの中の本文をドラッグで選択してダイアログの外で離したとき、外で押して中で離したときは閉じない。閉じた後にもう一度 `実行` を押すと、ダイアログが 1 つだけ開く
- [ ] **AGT-155** ダイアログを開いて `Tab`・`Shift+Tab` を押し続ける → フォーカスは本文・`送信`・`キャンセル` の間を回り、背後のプロンプトの一覧・ターミナル・アクティビティバーへ出ない。本文にフォーカスがあるとき、上下の矢印キーで長い本文をスクロールできる
- [ ] **AGT-156** VoiceOver を有効にして `挨拶` の `実行` でダイアログを開き、`Tab` で移る → ダイアログの名前 `送信前の確認` と `送信` ボタンが読まれ、本文に移ると `送る内容` が読まれる
- [ ] **AGT-157** 100 行以上・1,000 文字以上のプロンプトの `実行` を押す → 本文は枠の中でスクロールでき、改行が保たれ、ダイアログが画面からはみ出さない（ウィンドウを小さくしても `送信`・`キャンセル` が見える）。文字数は `1,234 文字` のように 3 桁ごとの区切りで出る
- [ ] **AGT-158** 先頭が `!` のプロンプト（例: `!ls`）の `実行` を押す → ダイアログに `先頭が「!」のプロンプトは、エージェントのシェルのコマンドとして実行されるため送信できません（先頭に空白を入れると送れます）` が出て、`送信` が押せず（薄く表示）、フォーカスは `キャンセル` にある。VoiceOver で `送信` に移ると理由が読まれる
- [ ] **AGT-159** 内容が 200,001 文字のプロンプト（`python3 -c "print('a'*200001, end='')" | pbcopy` で作った文字列を内容に貼る）の `実行` を押す → ダイアログに `プロンプトが長すぎます` と `200,001 文字` が出て `送信` が押せない。内容を 200,000 文字ちょうどにした場合は理由が出ず `送信` が押せる（押さずに `キャンセル` する）
- [ ] **AGT-160** `挨拶` の `実行` でダイアログを開いたまま、別の端末で `lsof -a -d cwd -c claude` を実行し、作業ディレクトリがテスト用のフォルダの `claude` の pid（領域の前提で控えたほかの `claude` の pid ではないもの）を確かめて `kill <pid>` する → ダイアログは閉じず、`エージェントが起動していません（ターミナルの「起動」を押してください）` が出て `送信` が押せなくなり、フォーカスは `キャンセル` に移る。`キャンセル`（または `Esc`）で閉じる
- [ ] **AGT-161** ダイアログを開いたまま、背後の設定のアイコン・ターミナルのタブの `×`・「フォルダを変更」のある辺りをクリックする → ダイアログが閉じるだけで（キャンセルと同じ。何も送られない）、クリックした先の操作は起きない
- [ ] **AGT-162** `+` でタブ `claude 2` を起動して選んだ状態で、`挨拶` の `実行` を押す → `送り先: claude 2` が出る。`送信` を押すと本文が `claude 2` にだけ入り（`claude 1` には入らない）、フォーカスは `claude 2` のターミナルにある
- [ ] **AGT-163** 設定を開き、`送信前の確認` の節を見て、チェックボックスにキーボード（Tab）で移り VoiceOver で聞く → 節の名前 `送信前の確認`、チェックボックス `エージェントへ送る前に、送る内容を確認する`（既定でオン）と説明 `変数を差し込んだ後の全文と送り先のタブを確かめてから送ります` が読める。チェックボックスの行はタッチで押せる高さがある
- [ ] **AGT-164** 設定の `エージェントへ送る前に、送る内容を確認する` を外してから `挨拶` の `実行` を押す → ダイアログは出ず、すぐに `claude 1` へ送られる（`エージェントに送信しました`）。アプリを終了して起動し直しても外した設定が残る。チェックを戻すと、次の `実行` からまたダイアログが開く
- [ ] **AGT-165** 設定で実行方式を「従来の方式」にしてから `挨拶` の `実行` を押す → ダイアログは出ず、従来どおり出力パネルで実行される
- [ ] **AGT-166** OS（またはアプリ）をダークテーマにして、ダイアログ（送れる状態と、AGT-158 の送れない状態）を見る → 見出し・送り先・本文・文字数・赤系の理由・`送信`・薄く表示された押せない `送信`・`キャンセル` が読める。macOS の「視差効果を減らす」をオンにしても、開閉の動きの違いは無い。`送信`・`キャンセル` はタッチで押せる大きさがある
- [ ] **AGT-167** `claude 1` で `/model` の選択の画面を出してから `挨拶` の `実行` を押し、ダイアログで `送信` を押す → ダイアログが閉じ、プロンプトパネルの上部に `エージェントの入力欄が見つかりません。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください` が出る（送った後の失敗はダイアログではなくプロンプトパネルに出る）。画面の選択肢は変わらない
```
  - `## エージェント CLI のアプリ内ターミナル` の領域の先頭の前提（`> 前提:` の行が並ぶ箇所）の最後に、次の行を足す:
```markdown
> 前提: 設定の「送信前の確認」がオン（既定）のときは、プロンプトの `実行` の後に「送信前の確認」のダイアログが開く。`### 送信前の確認` 以外の項目の「プロンプトの `実行` を押す」は、ダイアログで `送信` を押すまでを指す（設定でオフにしてから行ってもよい。送り先はダイアログを開いた時点のタブ）。
```
  - 既存の項目のうち、確認が入ることで手順・期待結果が変わるものを直す（ID は変えない）:
    - `AGT-016` を次にする: `- [ ] **AGT-016** 先頭が `!` のプロンプト（例: `!ls`）の `実行` を押す → 何も送られず、`先頭が「!」のプロンプトは、エージェントのシェルのコマンドとして実行されるため送信できません（先頭に空白を入れると送れます）` が表示される（設定の「送信前の確認」がオンなら確認のダイアログに出て `送信` が押せない〈AGT-158〉。オフならプロンプトパネルの上部に出る）`
    - `AGT-078` の手順の `` `実行` を押した直後（`エージェントに送信しています` の間）にタブを切り替える `` を `` `実行` を押し、確認のダイアログで `送信` を押した直後（`エージェントに送信しています` の間）にタブを切り替える `` にする（期待結果は今のまま）。
    - `AGT-082` の手順の `` タブ 2 を選んで `実行` を押し、 `` を `` タブ 2 を選んで `実行` を押して確認のダイアログで `送信` を押し、 `` にする（期待結果は今のまま）。
  - ほかの領域の前提で、エージェント CLI 方式の `実行` に触れているものに、確認のダイアログを足す（ID は変えない）:
    - `## プロンプト管理` → `### キーワード検索・フィルタ` の前提（`PRM-033 の 実行 は、…エージェント CLI 方式ならターミナルで 起動 してから押す…`）の文末の `）。` の前に `。送信前の確認のダイアログが開いたら `送信` を押す` を足す。
    - `## エージェントの変更の確認` の 1 行目の前提（`エージェントへの指示は「プロンプト」パネルの 実行 で送る（指示の例は各項目）。`）の文末に `送信前の確認のダイアログが開いたら `送信` を押す。` を足す。
  - 既存の `BASE-007`（設定のセクションの数）を、今の画面に合わせて直す（ID は変えない）: `` - [ ] **BASE-007** `設定` アイコンをクリックする → サイドバーの見出しが `設定` に変わり `プロンプトの実行方式`・`エージェントの通知`・`送信前の確認`・`Anthropic API キー`・`モデル` の 5 つのセクションが表示される ``
  - `grep -n 'の `実行`\|`実行` を押' docs/manual-test-spec.md` で、上で直した以外にエージェント CLI 方式で `実行` を押した直後の状態（送信中の表示・送り先のタブ）を確かめる項目が残っていないかを見る。あれば、手順を「確認のダイアログで `送信` を押した直後」に直す（ID は変えない。前提の行で足りるものは直さない）。

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
Run: 下の eslint に渡すのと同じファイルへ `npx eslint --fix <files>`（prettier の 100 桁の折り返しなど、自動で直せるものを先に直す）
Run: `npx eslint --max-warnings 0` に、このプランで作成・変更した TypeScript のファイルをすべて渡す（`git status --porcelain` の `.ts`・`.tsx` の一覧から作る）
Expected: エラー・警告なし
