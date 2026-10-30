# プロンプト一覧の編集モード / 表示モード 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development で実行する（実行方式は利用者に確認しない。CLAUDE.md の規則）。タスクごとに新しいサブエージェントで実装し、タスクごとにレビューを挟み、最後にブランチ全体をレビューする。手順は `- [ ]` で管理する。

**Goal:** プロンプトのパネルの最上部に「編集モード / 表示モード」のトグルを置き、表示モードでは各項目の `編集`・`削除` を描かないことで誤タップを防ぐ。モードは設定として保存し、再起動しても保つ（既定は編集モード）。

**Architecture:** 設計書は `docs/superpowers/specs/2026-10-30-prompt-list-mode-design.md`。設定は実行方式（`promptExecutionMode`）と同じ経路で足す（shared の型 → main の `promptListModeStore` → IPC → preload → renderer の `settingsApi` → `useSavedSetting` を使う `usePromptListMode`）。状態は `useAppState` → `App` → `Sidebar` → `PromptsPanel` へ必須の props で渡し、`PromptsPanel` が `PromptListModeToggle` を先頭に置き、`mode === 'edit'` のときだけ `canEdit` を `PromptItem` → `PromptItemView` へ渡す。

**Tech Stack:** Electron、React、TypeScript、Vitest、Testing Library（`@testing-library/react`・`user-event`）、素の CSS（`src/renderer/src/assets/main.css`。Tailwind は使っていない）

> **実装後の変更（最終レビューの指摘で足した。2026-10-30）:** 連打で保存が両方失敗すると画面と保存のモードが食い違う問題（L-406）のため、`PromptListModePanelState` に必須の `isSaving: boolean` を足した。`usePromptListMode` は保存の途中の `onChange` を無視し（`useRef` の同期のガードと `isSaving`）、`PromptListModeToggle` は `isSaving` の間 `aria-disabled="true"` でクリックを無視する（`disabled` にはしない。L-157）。以降の Task の本文は足す前のもので、実装と設計書（`isSaving` を含む）が正。実機テスト仕様書の項目（Task 4 Step 2 の PRM-087〜099 の本文）と RUN-005 の前提も初版で、`docs/manual-test-spec.md` の最終版（PRM-087〜100・前提の件数・モードの遷移・後片付け）が正。トグルの `onKeyDown`（Enter・Space のリピートの抑止）はレビューで足した。`README.md`・`docs/developer-guide.md`（3.5 節）・`src/renderer/src/hooks/useSavedSetting.ts`（ヘッダーコメント）・`docs/superpowers/specs/…-design.md` も、レビューで足した説明・コメントの同期として変更した。「ファイルの構成」の表と Task 4 Step 5 の `git status --short` の期待は初版で、これらのファイルと、後から足したテスト・ひな形の変更も含めて正とする。

## Global Constraints

- すべての文章（コメント・テスト名・コミットメッセージ以外の説明・報告）は日本語で書く。コードブロック・技術固有名詞・ライブラリ名は英語のままでよい。
- **`git commit`・`git push` をしない。** コミットは後の工程（`/commit-ja`）で行う。どの Step にもコミットは入れない。
- `git add -A` を使わない（無関係な未追跡ファイル〈`.worktrees/` など〉を巻き込む）。ステージが必要になっても `git add -u` か、パスを明示した `git add <パス>` にする。
- `git stash`・`git checkout`・`git restore`・`git reset` を使わない（同じ作業ツリーに未コミットの作業がある）。「修正を戻すとテストが落ちる」ことの確認は、Step に書いた**一時的な書き換え**で行い、確認したら書き換えを元に戻す。
- `npx prettier --write` は、その Step で明示したファイルだけにかける。`npm run format` は使わない。**`ROADMAP.md` には prettier をかけない**（`--write` も `--check` も）。
- 型としてのみ使う import は必ず `import type` にする（例: `import type { PromptListMode } from '@shared/types'`）。値と型を同じモジュールから読むときは、既存の書き方どおり `import type { … }` と `import { … }` の 2 行に分ける。
- 関数には戻り値の型を書く（`@typescript-eslint/explicit-function-return-type`）。コメントは周りの密度・文体に合わせて日本語で書く。
- クライアントコンポーネント（新しい `PromptListModeToggle.tsx`）の先頭に `'use client'` を書く（既存の prompts の部品と同じ）。
- ダークモード: このアプリは常に暗色で、見た目は `main.css` の素の CSS（Tailwind の `dark:` は無い）。新しいクラスの色は、既存のダークの値（`#3c3c3c`・`#555555`・`#cccccc`・`#4a4a4a`・`#007acc`・`#f48771`・`#2d2d2d`）だけを使う。
- アクセシビリティ: トグルは `aria-label="編集モード"`（固定）と `aria-pressed` で状態を伝える。見える文言は現在の状態（`編集モード: オン` / `編集モード: オフ`）。保存の失敗の文言は常設の `aria-live="polite"` の段落に出す（`role="status"` は使わない。既存テストの前提を崩すため）。
- React の `key` に表示文言を使わない（今回の変更でリストは増やさないが、触る箇所でも守る）。
- テストで `setTimeout`・`setInterval` を使うモックを書くときは ID を控えて `afterEach` で止める。`act(...).then(...)` の形で書かない（失敗が unhandled rejection として握り潰される）。
- テストの一時ディレクトリの再帰削除は `removeTempPath`・`removeTempPathSync`（`src/shared/__tests__/helpers/tempDirGuard.ts`）を通す（今回のテストは一時ディレクトリを使わない。使うことになったら必ずこれを通す）。
- 既存のテストの期待値を変えない。既存のテストのひな形（props のモック・`setup.ts` のスタブ）には、新しい必須の props・API を**足すだけ**にする。
- 新しい props（`Sidebar`・`PromptsPanel` の `promptListMode`、`PromptItem`・`PromptItemView` の `canEdit`）は必須にし、省略可能にしない・既定値を付けない（L-060）。
- 保存の失敗の文言に例外の中身を出さない。接頭辞は `モードの設定を保存できませんでした: `（方向に依らない固定の文言）、後ろは `SETTINGS_FILE_ERROR_REASON`（L-017）。
- 各タスクの終わりで `npm run typecheck` と `npm test` が通ること（最終タスク以外も）。変更したファイルには `npx eslint <パス> --max-warnings 0` と `npx prettier --check <パス>` をかける。
- 実機（Electron）の確認手順はプランに書かない。実機の確認項目は Task 4 で `docs/manual-test-spec.md` に追記し、ID（PRM-087〜）で参照する。

---

## ファイルの構成

| ファイル                                                                                                     | 役割                                                                                  | タスク |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------ |
| `src/shared/types/settings.ts`（変更）                                                                       | `PROMPT_LIST_MODES`・`PromptListMode`・`DEFAULT_PROMPT_LIST_MODE`・`isPromptListMode` | 1      |
| `src/shared/types.ts`（変更）                                                                                | 上の値の再エクスポート                                                                | 1      |
| `src/shared/__tests__/promptListMode.test.ts`（新規）                                                        | 型ガード・既定値・再エクスポートのテスト                                              | 1      |
| `src/main/settingsFileStore.ts`（変更）                                                                      | `SettingsFile` に `promptListMode?: string`                                           | 1      |
| `src/main/promptListModeStore.ts`（新規）                                                                    | `getPromptListMode` / `setPromptListMode`                                             | 1      |
| `src/main/__tests__/promptListModeStore.test.ts`（新規）                                                     | store のテスト                                                                        | 1      |
| `src/main/handlers/settingsHandlers.ts`（変更）                                                              | `settings:getPromptListMode` / `settings:setPromptListMode`                           | 1      |
| `src/main/__tests__/handlers/settingsHandlers.test.ts`（変更）                                               | handler のテスト                                                                      | 1      |
| `src/preload/api.ts`・`src/preload/index.d.ts`（変更）                                                       | `getPromptListMode` / `setPromptListMode`                                             | 1      |
| `src/preload/__tests__/api.test.ts`（変更）                                                                  | チャンネル名と引数のテスト                                                            | 1      |
| `src/renderer/src/lib/settingsApi.ts`（変更）・`lib/__tests__/settingsApi.test.ts`（変更）                   | renderer の薄いラッパーとテスト                                                       | 1      |
| `src/renderer/src/__tests__/setup.ts`（変更）                                                                | `window.api` のスタブに get / set                                                     | 1      |
| `src/renderer/src/types.ts`（変更）                                                                          | `PromptListModePanelState`                                                            | 2      |
| `src/renderer/src/hooks/usePromptListMode.ts`（新規）・`hooks/__tests__/usePromptListMode.test.ts`（新規）   | hook とテスト                                                                         | 2      |
| `src/renderer/src/__tests__/makePromptListModePanelState.ts`（新規）                                         | テスト用の状態のひな形（1 か所から作る）                                              | 2      |
| `src/renderer/src/hooks/useAppState.ts`（変更）・`hooks/__tests__/useAppState.test.ts`（変更）               | 結線と素通しのテスト                                                                  | 2      |
| `src/renderer/src/App.tsx`・`components/Sidebar.tsx`（変更）                                                 | props の受け渡し                                                                      | 2      |
| `src/renderer/src/components/prompts/PromptsPanel.tsx`（変更）                                               | Task 2 で props を受け取り、Task 3 で使う                                             | 2・3   |
| `components/__tests__/Sidebar.test.tsx`・`components/prompts/__tests__/PromptsPanel.test.tsx`（変更）        | Task 2 でひな形に props を足し、Task 3 でテストを足す                                 | 2・3   |
| `src/renderer/src/components/prompts/PromptListModeToggle.tsx`（新規）                                       | トグルの行                                                                            | 3      |
| `components/prompts/__tests__/PromptListModeToggle.test.tsx`・`PromptListModeToggle.styles.test.tsx`（新規） | 部品とスタイルのテスト                                                                | 3      |
| `src/renderer/src/assets/main.css`（変更）                                                                   | `prompts-panel__mode`・`prompts-panel__mode-toggle`・`prompts-panel__mode-error`      | 3      |
| `components/prompts/PromptItem.tsx`・`PromptItemView.tsx`（変更）とテスト（変更）                            | `canEdit`                                                                             | 3      |
| `components/__tests__/App.promptListMode.test.tsx`（新規）                                                   | App から一覧までの配線のテスト                                                        | 3      |
| `ROADMAP.md`・`docs/manual-test-spec.md`（変更）                                                             | 実装済み機能と実機テスト仕様書                                                        | 4      |

---

### Task 1: 設定の下回り（shared・main・IPC・preload・settingsApi・setup のスタブ）

**Files:**

- Modify: `src/shared/types/settings.ts`（`isPromptExecutionMode` の後）
- Modify: `src/shared/types.ts`（`./types/settings` からの値の再エクスポート）
- Create: `src/shared/__tests__/promptListMode.test.ts`
- Modify: `src/main/settingsFileStore.ts`（`SettingsFile`）
- Create: `src/main/promptListModeStore.ts`
- Create: `src/main/__tests__/promptListModeStore.test.ts`
- Modify: `src/main/handlers/settingsHandlers.ts`
- Modify: `src/main/__tests__/handlers/settingsHandlers.test.ts`
- Modify: `src/preload/api.ts`、`src/preload/index.d.ts`
- Modify: `src/preload/__tests__/api.test.ts`
- Modify: `src/renderer/src/lib/settingsApi.ts`、`src/renderer/src/lib/__tests__/settingsApi.test.ts`
- Modify: `src/renderer/src/__tests__/setup.ts`

**Interfaces:**

- Consumes: `isOneOf`（`src/shared/typeGuards.ts`）、`readSettingsFile` / `writeSettingsFile`（`src/main/settingsFileStore.ts`）
- Produces:
  - `export const PROMPT_LIST_MODES = ['edit', 'view'] as const`
  - `export type PromptListMode = (typeof PROMPT_LIST_MODES)[number]`
  - `export const DEFAULT_PROMPT_LIST_MODE: PromptListMode = 'edit'`
  - `export function isPromptListMode(value: unknown): value is PromptListMode`
  - main: `getPromptListMode(): Promise<PromptListMode>`、`setPromptListMode(mode: unknown): Promise<void>`（不正な値は `new Error('プロンプト一覧のモードが不正です')` を投げる）
  - IPC: `settings:getPromptListMode`（引数なし）、`settings:setPromptListMode`（引数 `mode`）
  - preload / `window.api`: `getPromptListMode(): Promise<PromptListMode>`、`setPromptListMode(mode: PromptListMode): Promise<void>`
  - renderer: `settingsApi.getPromptListMode(): Promise<PromptListMode>`、`settingsApi.setPromptListMode(mode: PromptListMode): Promise<void>`
  - `setup.ts` の既定のスタブ: `getPromptListMode` は `'edit'` を返す

- [ ] **Step 1: shared の失敗するテストを書く**

`src/shared/__tests__/promptListMode.test.ts` を作る。

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_PROMPT_LIST_MODE, PROMPT_LIST_MODES, isPromptListMode } from '../types/settings'
import * as sharedTypes from '../types'

describe('isPromptListMode', () => {
  it.each([
    ['edit', true],
    ['view', true],
    ['', false],
    ['Edit', false],
    ['legacy', false],
    [null, false],
    [undefined, false],
    [1, false]
  ])('%s → %s', (value, expected) => {
    expect(isPromptListMode(value)).toBe(expected)
  })

  it('選べるモードは編集と表示の 2 つ', () => {
    expect(PROMPT_LIST_MODES).toEqual(['edit', 'view'])
  })

  it('既定は編集モード(今の見た目と挙動を変えない)', () => {
    expect(DEFAULT_PROMPT_LIST_MODE).toBe('edit')
  })

  it('@shared/types から同じものを再エクスポートする', () => {
    expect(sharedTypes.PROMPT_LIST_MODES).toBe(PROMPT_LIST_MODES)
    expect(sharedTypes.DEFAULT_PROMPT_LIST_MODE).toBe(DEFAULT_PROMPT_LIST_MODE)
    expect(sharedTypes.isPromptListMode).toBe(isPromptListMode)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/shared/__tests__/promptListMode.test.ts`
Expected: FAIL（`isPromptListMode` などが export されていない）

- [ ] **Step 3: shared の型・既定・型ガードと再エクスポートを書く**

`src/shared/types/settings.ts` の `isPromptExecutionMode` の関数の直後（`/** エージェントの完了・許可待ちの通知…` の行の前）に足す。

```ts
/** プロンプト一覧のモード。edit: 各項目に `編集`・`削除` を出す。view: 出さない(誤タップの防止) */
export const PROMPT_LIST_MODES = ['edit', 'view'] as const
export type PromptListMode = (typeof PROMPT_LIST_MODES)[number]
/** 保存が無い初回の既定。編集モード(今の見た目と挙動を変えない) */
export const DEFAULT_PROMPT_LIST_MODE: PromptListMode = 'edit'

export function isPromptListMode(value: unknown): value is PromptListMode {
  return isOneOf(PROMPT_LIST_MODES, value)
}
```

`src/shared/types.ts` の `./types/settings` からの値の export を次に置き換える（型の `PromptListMode` は既存の `export type * from './types/settings'` で出る）。

```ts
export {
  AVAILABLE_MODELS,
  DEFAULT_MODEL_SETTINGS,
  PROMPT_EXECUTION_MODES,
  DEFAULT_PROMPT_EXECUTION_MODE,
  PROMPT_LIST_MODES,
  DEFAULT_PROMPT_LIST_MODE,
  DEFAULT_AGENT_NOTIFICATIONS_ENABLED,
  DEFAULT_AGENT_SEND_CONFIRM_ENABLED,
  isPromptExecutionMode,
  isPromptListMode
} from './types/settings'
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/shared/__tests__/promptListMode.test.ts`
Expected: PASS（11 件）

- [ ] **Step 5: main の store の失敗するテストを書く**

`src/main/__tests__/promptListModeStore.test.ts` を作る（`executionModeStore.test.ts` と同じひな形。拒否の文言の完全一致は `agentCliKindStore.test.ts` と同じ書き方）。

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadSettingsFile = vi.hoisted(() => vi.fn())
const mockWriteSettingsFile = vi.hoisted(() => vi.fn())
vi.mock('../settingsFileStore', () => ({
  readSettingsFile: mockReadSettingsFile,
  writeSettingsFile: mockWriteSettingsFile
}))

import { getPromptListMode, setPromptListMode } from '../promptListModeStore'

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteSettingsFile.mockResolvedValue(undefined)
})

describe('getPromptListMode', () => {
  it.each([
    ['保存された edit', { promptListMode: 'edit' }, 'edit'],
    ['保存された view', { promptListMode: 'view' }, 'view'],
    ['値が無い', {}, 'edit'],
    ['不正な値', { promptListMode: 'hidden' }, 'edit'],
    ['文字列でない値', { promptListMode: 1 }, 'edit']
  ])('%s → %s', async (_label, data, expected) => {
    mockReadSettingsFile.mockResolvedValueOnce(data)
    await expect(getPromptListMode()).resolves.toBe(expected)
  })

  it('設定ファイルを読めない失敗はそのまま返す(renderer が記録して既定で続ける)', async () => {
    const err = new Error('broken')
    mockReadSettingsFile.mockRejectedValueOnce(err)
    await expect(getPromptListMode()).rejects.toBe(err)
  })
})

describe('setPromptListMode', () => {
  it.each(['edit', 'view'])('%s を検証してマージで書き込む', async (mode) => {
    await setPromptListMode(mode)
    expect(mockWriteSettingsFile).toHaveBeenCalledExactlyOnceWith({ promptListMode: mode })
  })

  it.each(['hidden', '', 'Edit', null, 1, undefined])(
    '不正な値(%o)は書き込まずに投げ、値を文言に入れない(L-017)',
    async (mode) => {
      await expect(setPromptListMode(mode)).rejects.toThrow(
        new Error('プロンプト一覧のモードが不正です')
      )
      expect(mockWriteSettingsFile).not.toHaveBeenCalled()
    }
  )
})
```

- [ ] **Step 6: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/promptListModeStore.test.ts`
Expected: FAIL（`../promptListModeStore` が無い）

- [ ] **Step 7: `SettingsFile` と store を書く**

`src/main/settingsFileStore.ts` の `SettingsFile` の `promptExecutionMode?: string` の直後に足す。

```ts
  /** プロンプト一覧のモード(promptListModeStore が検証する) */
  promptListMode?: string
```

`src/main/promptListModeStore.ts` を作る。

```ts
import type { PromptListMode } from '@shared/types'
import { DEFAULT_PROMPT_LIST_MODE, isPromptListMode } from '@shared/types'
import { readSettingsFile, writeSettingsFile } from './settingsFileStore'

// プロンプト一覧の編集モード / 表示モードの読み書き(userData/settings.json の promptListMode。executionModeStore と同じ形で、
// ほかの設定と同じファイルにマージで書く)

/** 保存の拒否の文言(値を入れない。L-017) */
const PROMPT_LIST_MODE_INVALID_ERROR = 'プロンプト一覧のモードが不正です'

/** 保存されたモード。無い・不正なら既定(edit) */
export async function getPromptListMode(): Promise<PromptListMode> {
  const data = await readSettingsFile()
  return isPromptListMode(data.promptListMode) ? data.promptListMode : DEFAULT_PROMPT_LIST_MODE
}

/** 検証してから保存する。不正な値は書かずに投げる */
export async function setPromptListMode(mode: unknown): Promise<void> {
  if (!isPromptListMode(mode)) throw new Error(PROMPT_LIST_MODE_INVALID_ERROR)
  await writeSettingsFile({ promptListMode: mode })
}
```

- [ ] **Step 8: 通ることを確かめる**

Run: `npx vitest run src/main/__tests__/promptListModeStore.test.ts`
Expected: PASS（14 件）

- [ ] **Step 9: handler の失敗するテストを書く**

`src/main/__tests__/handlers/settingsHandlers.test.ts` の `vi.mock('../../executionModeStore', …)` のブロックの直後に足す。

```ts
const mockGetPromptListMode = vi.hoisted(() => vi.fn())
const mockSetPromptListMode = vi.hoisted(() => vi.fn())
vi.mock('../../promptListModeStore', () => ({
  getPromptListMode: mockGetPromptListMode,
  setPromptListMode: mockSetPromptListMode
}))
```

ファイルの末尾（`describe('実行方式', …)` の後）に足す。

```ts
describe('プロンプト一覧のモード', () => {
  it('settings:getPromptListMode は保存されたモードを返す', async () => {
    mockGetPromptListMode.mockResolvedValueOnce('view')
    await expect(getRegisteredHandler('settings:getPromptListMode')(makeEvent(1))).resolves.toBe(
      'view'
    )
    expect(mockGetPromptListMode).toHaveBeenCalledOnce()
  })

  it('settings:setPromptListMode は受け取った値をそのまま store へ渡す(検証は store が行う)', async () => {
    mockSetPromptListMode.mockResolvedValueOnce(undefined)
    await getRegisteredHandler('settings:setPromptListMode')(makeEvent(1), 'hidden')
    expect(mockSetPromptListMode).toHaveBeenCalledExactlyOnceWith('hidden')
  })

  it('settings:setPromptListMode は store の拒否をそのまま返す', async () => {
    mockSetPromptListMode.mockRejectedValueOnce(new Error('プロンプト一覧のモードが不正です'))
    await expect(
      getRegisteredHandler('settings:setPromptListMode')(makeEvent(1), 'hidden')
    ).rejects.toThrow('プロンプト一覧のモードが不正です')
  })
})
```

- [ ] **Step 10: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/handlers/settingsHandlers.test.ts`
Expected: FAIL（`handler not found: settings:getPromptListMode` など 3 件）

- [ ] **Step 11: handler を書く**

`src/main/handlers/settingsHandlers.ts` の import に足す（`executionModeStore` の import の直後）。

```ts
import { getPromptListMode, setPromptListMode } from '../promptListModeStore'
```

`settings:setPromptExecutionMode` の `ipcMain.handle(…)` の直後に足す。

```ts
// プロンプト一覧の編集モード / 表示モード。検証は store が行う
ipcMain.handle('settings:getPromptListMode', async () => getPromptListMode())

ipcMain.handle(
  'settings:setPromptListMode',
  async (_event: IpcMainInvokeEvent, mode: unknown): Promise<void> => setPromptListMode(mode)
)
```

- [ ] **Step 12: 通ることを確かめる**

Run: `npx vitest run src/main/__tests__/handlers/settingsHandlers.test.ts src/main/__tests__/handlers/settingsHandlers.apiKeyStatus.test.ts src/main/__tests__/ipcHandlers.test.ts`
Expected: PASS（`settingsHandlers.apiKeyStatus.test.ts` は本物の store を通すので、新しい import が読み込みで壊れないことの確認も兼ねる）

- [ ] **Step 13: preload と settingsApi の失敗するテストを書く**

`src/preload/__tests__/api.test.ts` の `describe('エージェントのターミナル・外部変更・実行方式・リンクの API', …)` の表で、次の要素の直後に 2 件足す。

置き換え前（この要素の直後に足す）:

```ts
    [
      'setPromptExecutionMode は settings:setPromptExecutionMode に方式を渡す',
      () => api.setPromptExecutionMode('legacy'),
      ['settings:setPromptExecutionMode', 'legacy']
    ],
```

足す要素:

```ts
    [
      'getPromptListMode は settings:getPromptListMode を呼ぶ',
      () => api.getPromptListMode(),
      ['settings:getPromptListMode']
    ],
    [
      'setPromptListMode は settings:setPromptListMode にモードを渡す',
      () => api.setPromptListMode('view'),
      ['settings:setPromptListMode', 'view']
    ],
```

`src/renderer/src/lib/__tests__/settingsApi.test.ts` の先頭の import を次に置き換える。

```ts
import {
  getAgentCliKind,
  getAgentNotificationsEnabled,
  getAgentSendConfirmEnabled,
  getModelSettings,
  getPromptExecutionMode,
  getPromptListMode,
  setAgentCliKind,
  setAgentNotificationsEnabled,
  setAgentSendConfirmEnabled,
  setModelSettings,
  setPromptExecutionMode,
  setPromptListMode
} from '../settingsApi'
```

同じファイルの `describe('実行方式', …)` の直後に足す。

```ts
describe('プロンプト一覧のモード', () => {
  it('getPromptListMode・setPromptListMode は window.api に委譲する', async () => {
    const api = {
      getPromptListMode: vi.fn().mockResolvedValue('view'),
      setPromptListMode: vi.fn().mockResolvedValue(undefined)
    }
    vi.stubGlobal('api', api)
    await expect(getPromptListMode()).resolves.toBe('view')
    await setPromptListMode('edit')
    expect(api.setPromptListMode).toHaveBeenCalledExactlyOnceWith('edit')
  })
})
```

- [ ] **Step 14: 失敗を確かめる**

Run: `npx vitest run src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/settingsApi.test.ts`
Expected: FAIL（`api.getPromptListMode is not a function`、`getPromptListMode` が export されていない）

- [ ] **Step 15: preload の api・型宣言、settingsApi、setup のスタブを書く**

`src/preload/api.ts` の `import type { … } from '@shared/types'` の `PromptExecutionMode,` の直後に `PromptListMode,` を足し、`setPromptExecutionMode` の定義の直後に足す。

```ts
  getPromptListMode: (): Promise<PromptListMode> =>
    ipcRenderer.invoke('settings:getPromptListMode'),
  setPromptListMode: (mode: PromptListMode): Promise<void> =>
    ipcRenderer.invoke('settings:setPromptListMode', mode),
```

`src/preload/index.d.ts` の `import type { … }` の `PromptExecutionMode,` の直後に `PromptListMode,` を足し、`setPromptExecutionMode(mode: PromptExecutionMode): Promise<void>` の行の直後に足す。

```ts
      getPromptListMode(): Promise<PromptListMode>
      setPromptListMode(mode: PromptListMode): Promise<void>
```

`src/renderer/src/lib/settingsApi.ts` の先頭の import を次に置き換え、`setPromptExecutionMode` の関数の直後に 2 つの関数を足す。

```ts
import type {
  AgentCliKind,
  AgentCliKindSetting,
  ModelSettings,
  PromptExecutionMode,
  PromptListMode
} from '@shared/types'
```

```ts
export function getPromptListMode(): Promise<PromptListMode> {
  return window.api.getPromptListMode()
}

export function setPromptListMode(mode: PromptListMode): Promise<void> {
  return window.api.setPromptListMode(mode)
}
```

`src/renderer/src/__tests__/setup.ts` の `setPromptExecutionMode: () => Promise.resolve(),` の行の直後に足す。

```ts
    // 一覧のモードの既定は編集モード(既存のテストは `編集`・`削除` が出る前提)。表示モードのテストは個別に差し替える
    getPromptListMode: () => Promise.resolve('edit'),
    setPromptListMode: () => Promise.resolve(),
```

- [ ] **Step 16: 通ることを確かめる**

Run: `npx vitest run src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/settingsApi.test.ts`
Expected: PASS

- [ ] **Step 17: 整形とタスク全体の検証**

Run:

```bash
npx prettier --write src/shared/types/settings.ts src/shared/types.ts src/shared/__tests__/promptListMode.test.ts src/main/settingsFileStore.ts src/main/promptListModeStore.ts src/main/__tests__/promptListModeStore.test.ts src/main/handlers/settingsHandlers.ts src/main/__tests__/handlers/settingsHandlers.test.ts src/preload/api.ts src/preload/index.d.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/settingsApi.ts src/renderer/src/lib/__tests__/settingsApi.test.ts src/renderer/src/__tests__/setup.ts
npx eslint src/shared/types/settings.ts src/shared/types.ts src/shared/__tests__/promptListMode.test.ts src/main/settingsFileStore.ts src/main/promptListModeStore.ts src/main/__tests__/promptListModeStore.test.ts src/main/handlers/settingsHandlers.ts src/main/__tests__/handlers/settingsHandlers.test.ts src/preload/api.ts src/preload/index.d.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/settingsApi.ts src/renderer/src/lib/__tests__/settingsApi.test.ts src/renderer/src/__tests__/setup.ts --max-warnings 0
npm run typecheck
npm test
```

Expected: eslint は警告・エラーなし、typecheck は成功、`npm test` は全件 PASS。

---

### Task 2: hook `usePromptListMode` と、useAppState → App → Sidebar → PromptsPanel の結線

**Files:**

- Modify: `src/renderer/src/types.ts`（import と `ExecutionModePanelState` の直後）
- Create: `src/renderer/src/hooks/usePromptListMode.ts`
- Create: `src/renderer/src/hooks/__tests__/usePromptListMode.test.ts`
- Create: `src/renderer/src/__tests__/makePromptListModePanelState.ts`
- Modify: `src/renderer/src/hooks/useAppState.ts`
- Modify: `src/renderer/src/hooks/__tests__/useAppState.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/components/prompts/PromptsPanel.tsx`（Props の型だけ）
- Modify: `src/renderer/src/components/__tests__/Sidebar.test.tsx`（ひな形）
- Modify: `src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx`（ひな形）

**Interfaces:**

- Consumes: Task 1 の `PromptListMode`・`DEFAULT_PROMPT_LIST_MODE`（`@shared/types`）、`settingsApi.getPromptListMode` / `settingsApi.setPromptListMode`、`useSavedSetting`（`src/renderer/src/hooks/useSavedSetting.ts`）、`SETTINGS_FILE_ERROR_REASON`（`src/renderer/src/lib/settingsMessages.ts`）
- Produces:
  - `src/renderer/src/types.ts`: `export interface PromptListModePanelState { mode: PromptListMode | null; saveError: string | null; onChange: (mode: PromptListMode) => void }`
  - `src/renderer/src/hooks/usePromptListMode.ts`: `export const PROMPT_LIST_MODE_SAVE_ERROR_PREFIX = 'モードの設定を保存できませんでした: '`、`export function usePromptListMode(): PromptListModePanelState`
  - `src/renderer/src/__tests__/makePromptListModePanelState.ts`: `export function makePromptListModePanelState(overrides?: Partial<PromptListModePanelState>): PromptListModePanelState`（既定は `mode: 'edit'`・`saveError: null`・`onChange: vi.fn()`）
  - `useAppState()` の戻り値に `promptListMode: PromptListModePanelState`
  - `Sidebar` の必須の props `promptListMode: PromptListModePanelState`
  - `PromptsPanel` の必須の props `promptListMode: PromptListModePanelState`（Task 2 では受け取るだけで、分割代入しない＝未使用の変数を作らない。Task 3 で使う）

**気をつける知見:**

- L-060: `Sidebar`・`PromptsPanel` の `promptListMode` は必須にする（`?` を付けない・既定値を付けない）。テストのひな形（`Sidebar.test.tsx`・`PromptsPanel.test.tsx` の `defaultProps`）に足し忘れると typecheck が落ちることが狙い。
- L-017: 保存の失敗の文言は `${PROMPT_LIST_MODE_SAVE_ERROR_PREFIX}${SETTINGS_FILE_ERROR_REASON}` だけ（例外の中身・パスを出さない）。例外は `console.error` に記録する（`useSavedSetting` が行う）。

- [ ] **Step 1: renderer の型と、テスト用のひな形を書く**

`src/renderer/src/types.ts` の先頭の `import type { … } from '@shared/types'` の `PromptExecutionMode` を `PromptExecutionMode,` にし、その後ろに `PromptListMode` を足す（最後の要素なのでカンマなし）。

`ExecutionModePanelState` の閉じ括弧の直後（`  onSelect: (mode: PromptExecutionMode) => void\n}` の後）に足す。

```ts
// プロンプト一覧の編集モード / 表示モード(usePromptListMode が組み立て、useAppState → App → Sidebar → PromptsPanel へ渡す)
export interface PromptListModePanelState {
  /** 読み込みが終わるまでは null(トグルを押せず、`編集`・`削除` を出さない) */
  mode: PromptListMode | null
  /** 保存の失敗の文言(固定。トグルの下に出す)。次の保存で消える */
  saveError: string | null
  /** 選んですぐ保存する。失敗したら直前の値に戻し、saveError に出す(部品は完了を待たない) */
  onChange: (mode: PromptListMode) => void
}
```

`src/renderer/src/__tests__/makePromptListModePanelState.ts` を作る。

```ts
import { vi } from 'vitest'
import type { PromptListModePanelState } from '../types'

// 一覧の編集モード / 表示モードの状態の型付きの偽物(1 か所から作る)。既定は「読み込み済みの編集モード・保存の失敗なし」

export function makePromptListModePanelState(
  overrides: Partial<PromptListModePanelState> = {}
): PromptListModePanelState {
  return {
    mode: 'edit',
    saveError: null,
    onChange: vi.fn<PromptListModePanelState['onChange']>(),
    ...overrides
  }
}
```

- [ ] **Step 2: hook の失敗するテストを書く**

`src/renderer/src/hooks/__tests__/usePromptListMode.test.ts` を作る（`useExecutionMode.test.ts` と同じ観点）。

```ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import type { PromptListMode } from '@shared/types'

vi.mock('../../lib/settingsApi')

import * as settingsApi from '../../lib/settingsApi'
import { SETTINGS_FILE_ERROR_REASON } from '../../lib/settingsMessages'
import { PROMPT_LIST_MODE_SAVE_ERROR_PREFIX, usePromptListMode } from '../usePromptListMode'

const mockGet = vi.mocked(settingsApi.getPromptListMode)
const mockSet = vi.mocked(settingsApi.setPromptListMode)
let consoleSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  vi.resetAllMocks()
  consoleSpy = null
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

describe('usePromptListMode', () => {
  it('読み込みが終わるまでは null、終わったら保存されたモード', async () => {
    mockGet.mockResolvedValueOnce('view')
    const { result } = renderHook(() => usePromptListMode())
    expect(result.current.mode).toBeNull()
    await waitFor(() => expect(result.current.mode).toBe('view'))
    expect(result.current.saveError).toBeNull()
  })

  it('読み込みに失敗したら既定(編集モード)で続け、見出しと例外の 2 引数で記録する', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const err = new Error('broken')
    mockGet.mockRejectedValueOnce(err)
    const { result } = renderHook(() => usePromptListMode())
    await waitFor(() => expect(result.current.mode).toBe('edit'))
    expect(consoleSpy).toHaveBeenCalledExactlyOnceWith(
      '[usePromptListMode] getPromptListMode failed:',
      err
    )
  })

  it('onChange は保存の完了を待たずに切り替える(楽観的)', async () => {
    mockGet.mockResolvedValueOnce('edit')
    // 保存が終わらない間も、画面は新しいモードになっている
    mockSet.mockReturnValueOnce(new Promise<void>(() => undefined))
    const { result } = renderHook(() => usePromptListMode())
    await waitFor(() => expect(result.current.mode).toBe('edit'))
    await act(async () => {
      result.current.onChange('view')
    })
    expect(result.current.mode).toBe('view')
    expect(mockSet).toHaveBeenCalledExactlyOnceWith('view')
  })

  it('保存に成功したらそのモードのままで、失敗の文言は出さない', async () => {
    mockGet.mockResolvedValueOnce('edit')
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => usePromptListMode())
    await waitFor(() => expect(result.current.mode).toBe('edit'))
    await act(async () => {
      result.current.onChange('view')
    })
    await waitFor(() => expect(mockSet).toHaveBeenCalledExactlyOnceWith('view'))
    expect(result.current.mode).toBe('view')
    expect(result.current.saveError).toBeNull()
  })

  it('保存に失敗したら直前のモードへ戻し、固定の文言を出して例外は記録だけする(L-017)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // main の設定ファイルの読み書きの例外には settings.json のパスや中身の断片が入りうる
    const err = new Error(
      "Error invoking remote method 'settings:setPromptListMode': Error: EACCES: permission denied, open '/Users/someone/Library/Application Support/prompt-ide/settings.json'"
    )
    mockGet.mockResolvedValueOnce('edit')
    mockSet.mockRejectedValueOnce(err)
    const { result } = renderHook(() => usePromptListMode())
    await waitFor(() => expect(result.current.mode).toBe('edit'))
    await act(async () => {
      result.current.onChange('view')
    })
    await waitFor(() =>
      expect(result.current.saveError).toBe(
        `モードの設定を保存できませんでした: ${SETTINGS_FILE_ERROR_REASON}`
      )
    )
    expect(result.current.mode).toBe('edit')
    expect(result.current.saveError).not.toContain('/Users/someone')
    expect(consoleSpy).toHaveBeenCalledWith('[usePromptListMode] setPromptListMode failed:', err)
  })

  it('保存の失敗の後、次の保存に成功したら失敗の文言を消す', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockResolvedValueOnce('view')
    mockSet.mockRejectedValueOnce(new Error('broken')).mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => usePromptListMode())
    await waitFor(() => expect(result.current.mode).toBe('view'))
    await act(async () => {
      result.current.onChange('edit')
    })
    await waitFor(() => expect(result.current.saveError).not.toBeNull())
    expect(result.current.mode).toBe('view')
    await act(async () => {
      result.current.onChange('edit')
    })
    await waitFor(() => expect(result.current.saveError).toBeNull())
    expect(result.current.mode).toBe('edit')
  })

  it('onChange は値を返さない(部品は保存の完了を待たない)', async () => {
    mockGet.mockResolvedValueOnce('edit')
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => usePromptListMode())
    await waitFor(() => expect(result.current.mode).toBe('edit'))
    let returned: unknown = 'not-called'
    await act(async () => {
      returned = result.current.onChange('view')
    })
    expect(returned).toBeUndefined()
  })

  it('onChange の参照は描画をまたいで変わらない', async () => {
    mockGet.mockResolvedValueOnce('edit')
    const { result, rerender } = renderHook(() => usePromptListMode())
    await waitFor(() => expect(result.current.mode).toBe('edit'))
    const first: (mode: PromptListMode) => void = result.current.onChange
    rerender()
    expect(result.current.onChange).toBe(first)
  })

  it('保存の失敗の接頭辞は、方向に依らない固定の文言(モードの名前を入れない)', () => {
    expect(PROMPT_LIST_MODE_SAVE_ERROR_PREFIX).toBe('モードの設定を保存できませんでした: ')
  })
})
```

- [ ] **Step 3: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/usePromptListMode.test.ts`
Expected: FAIL（`../usePromptListMode` が無い）

- [ ] **Step 4: hook を書く**

`src/renderer/src/hooks/usePromptListMode.ts` を作る。

```ts
import { useCallback } from 'react'
import type { PromptListMode } from '@shared/types'
import { DEFAULT_PROMPT_LIST_MODE } from '@shared/types'
import type { PromptListModePanelState } from '../types'
import * as settingsApi from '../lib/settingsApi'
import { useSavedSetting } from './useSavedSetting'

/** 一覧のモードの保存の失敗の文言の接頭辞。後ろに固定の理由(SETTINGS_FILE_ERROR_REASON)を付ける。
 *  表示モードへの切り替えにも編集モードへ戻すのにも使うので、モードの名前を入れない */
export const PROMPT_LIST_MODE_SAVE_ERROR_PREFIX = 'モードの設定を保存できませんでした: '

const readLoadedMode = (loaded: PromptListMode): PromptListMode => loaded
const noop = (): void => undefined

export function usePromptListMode(): PromptListModePanelState {
  const { value, saveError, change } = useSavedSetting({
    load: settingsApi.getPromptListMode,
    readValue: readLoadedMode,
    save: settingsApi.setPromptListMode,
    defaultValue: DEFAULT_PROMPT_LIST_MODE,
    saveErrorPrefix: PROMPT_LIST_MODE_SAVE_ERROR_PREFIX,
    // 設定ファイルの JSON が壊れていると main は例外を投げる。一覧を出せなくならないよう、既定(編集モード)で続ける
    loadLogLabel: '[usePromptListMode] getPromptListMode failed:',
    saveLogLabel: '[usePromptListMode] setPromptListMode failed:',
    onLoaded: noop,
    onLoadFailed: noop,
    onSaved: noop
  })
  // change は保存の失敗を false で返し、拒否しない(失敗は saveError に出る)。トグルは完了を待たないので結果は捨てる
  const onChange = useCallback(
    (mode: PromptListMode): void => {
      void change(mode)
    },
    [change]
  )
  return { mode: value, saveError, onChange }
}
```

- [ ] **Step 5: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/usePromptListMode.test.ts`
Expected: PASS（9 件）

- [ ] **Step 6: useAppState の素通しの失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAppState.test.ts` の import 群（`import { makeCloneRepositoryPanelState } …` の行の直後）に足す。

```ts
import { makePromptListModePanelState } from '../../__tests__/makePromptListModePanelState'
```

`vi.mock('../useAgentWorkspace', () => ({ useAgentWorkspace: mockUseAgentWorkspace }))` の行の直前に足す。

```ts
// 一覧のモードの読み書きは usePromptListMode.test.ts で確かめる。ここでは戻り値をそのまま返すこと(素通し)だけを見る
const mockUsePromptListMode = vi.hoisted(() =>
  vi.fn<typeof import('../usePromptListMode').usePromptListMode>()
)
vi.mock('../usePromptListMode', () => ({ usePromptListMode: mockUsePromptListMode }))
```

`beforeEach` の `mockUseAgentWorkspace.mockReturnValue(makeAgentWorkspaceState())` の行の直後に足す。

```ts
mockUsePromptListMode.mockReturnValue(makePromptListModePanelState())
```

`describe('useAppState', …)` の `it('usePrompts を呼び出す', …)` の直後に足す。

```ts
it('usePromptListMode の戻り値を promptListMode としてそのまま返す', () => {
  const state = makePromptListModePanelState({ mode: 'view', saveError: '失敗' })
  mockUsePromptListMode.mockReturnValue(state)
  const { result } = renderHook(() => useAppState())
  expect(mockUsePromptListMode).toHaveBeenCalled()
  expect(result.current.promptListMode).toBe(state)
})
```

- [ ] **Step 7: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAppState.test.ts -t "usePromptListMode"`
Expected: FAIL（`mockUsePromptListMode` が呼ばれていない・`result.current.promptListMode` が `undefined`）

- [ ] **Step 8: useAppState を結線する**

`src/renderer/src/hooks/useAppState.ts`:

1. `import { usePrompts } from './usePrompts'` の行の直後に `import { usePromptListMode } from './usePromptListMode'` を足す。
2. `import type { AgentReferencesPanelState, … } from '../types'` の並びに `PromptListModePanelState,` を足す（`MergeStatePanelState,` の直後）。
3. `AppState` の型の次の箇所を置き換える。

置き換え前:

```ts
  /** エクスプローラから参照を足したとき・すでに足してあったときの読み上げの文言(App が常設の aria-live の領域に出す) */
  agentReferenceAnnouncement: string
} & AgentChangesWiring &
```

置き換え後:

```ts
  /** エクスプローラから参照を足したとき・すでに足してあったときの読み上げの文言(App が常設の aria-live の領域に出す) */
  agentReferenceAnnouncement: string
  /** プロンプト一覧の編集モード / 表示モード(usePromptListMode)。Sidebar → PromptsPanel へ渡す */
  promptListMode: PromptListModePanelState
} & AgentChangesWiring &
```

4. `const prompts = usePrompts()` の行の直後に足す。

```ts
const promptListMode = usePromptListMode()
```

5. 戻り値の次の箇所を置き換える。

置き換え前:

```ts
    agentReferenceAnnouncement: toAnnouncementText(references.announcement),
    ...agentChangesWiring
```

置き換え後:

```ts
    agentReferenceAnnouncement: toAnnouncementText(references.announcement),
    promptListMode,
    ...agentChangesWiring
```

- [ ] **Step 9: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`
Expected: PASS（`useAppState.agent.test.ts` は `usePromptListMode` を差し替えず、`setup.ts` のスタブで動く）

- [ ] **Step 10: 修正を戻すと落ちることを確かめる**

`src/renderer/src/hooks/useAppState.ts` の戻り値の `promptListMode,` の行を一時的に消して実行する。

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAppState.test.ts -t "usePromptListMode"`
Expected: FAIL（`promptListMode` が `undefined`）。確かめたら `promptListMode,` の行を元に戻し、もう一度実行して PASS を確かめる。

- [ ] **Step 11: PromptsPanel・Sidebar・App に props を通す**

`src/renderer/src/components/prompts/PromptsPanel.tsx`:

- `import type { AgentReferencesPanelState, AgentSendFeedback, PromptToolId, Prompt } from '../../types'` を次に置き換える。

```ts
import type {
  AgentReferencesPanelState,
  AgentSendFeedback,
  PromptListModePanelState,
  PromptToolId,
  Prompt
} from '../../types'
```

- `interface Props` の `agentReferences: AgentReferencesPanelState | null` の行の直後に足す（分割代入には**まだ足さない**。Task 3 で使う）。

```ts
/** 一覧の編集モード / 表示モード(先頭のトグルの行と、`編集`・`削除` の出し分け)。省略できない(L-060) */
promptListMode: PromptListModePanelState
```

`src/renderer/src/components/Sidebar.tsx`:

- `import type { … } from '../types'` の `AgentReferencesPanelState` を `AgentReferencesPanelState,` にし、その後ろに `PromptListModePanelState` を足す。
- `interface Props` の `agentReferences: AgentReferencesPanelState | null` の行の直後に足す。

```ts
/** プロンプト一覧の編集モード / 表示モード(プロンプトパネルのトグルの行と、`編集`・`削除` の出し分け)。省略できない(L-060) */
promptListMode: PromptListModePanelState
```

- 分割代入の末尾 `  agentCliKind,\n  agentReferences\n}: Props)` を `  agentCliKind,\n  agentReferences,\n  promptListMode\n}: Props)` にする。
- `<PromptsPanel … />` の `agentReferences={agentReferences}` の行の直後に `promptListMode={promptListMode}` を足す。

`src/renderer/src/App.tsx`:

- `useAppState()` の分割代入の `agentReferenceAnnouncement,` の行の直後に `promptListMode,` を足す。
- `<Sidebar … />` の `onImportPrompts={importPrompts}` の行の直後に `promptListMode={promptListMode}` を足す。

- [ ] **Step 12: テストのひな形に props を足す**

`src/renderer/src/components/__tests__/Sidebar.test.tsx`:

- import 群（`import { makeAgentReferencesPanelState } …` の行の直後）に足す。

```ts
import { makePromptListModePanelState } from '../../__tests__/makePromptListModePanelState'
```

- `defaultProps` の最後の `agentReferences: null as AgentReferencesPanelState | null` を `agentReferences: null as AgentReferencesPanelState | null,` にし、その次の行に `promptListMode: makePromptListModePanelState()` を足す。

`src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx`:

- import 群（`import { makeAgentReferencesPanelState } …` の行の直後）に足す。

```ts
import { makePromptListModePanelState } from '../../../__tests__/makePromptListModePanelState'
```

- `defaultProps` の最後の `agentReferences: null as AgentReferencesPanelState | null` を `agentReferences: null as AgentReferencesPanelState | null,` にし、その次の行に `promptListMode: makePromptListModePanelState()` を足す。

- [ ] **Step 13: 型の結線を確かめる（L-060）**

Run: `npm run typecheck`
Expected: 成功。

続けて、必須にしたことの確認として、`src/renderer/src/components/__tests__/Sidebar.test.tsx` の `defaultProps` の `promptListMode: makePromptListModePanelState()` の行を一時的に消して `npm run typecheck` を実行する。
Expected: FAIL（`Property 'promptListMode' is missing` の型エラー）。確かめたら行を元に戻す。

- [ ] **Step 14: 整形とタスク全体の検証**

Run:

```bash
npx prettier --write src/renderer/src/types.ts src/renderer/src/hooks/usePromptListMode.ts src/renderer/src/hooks/__tests__/usePromptListMode.test.ts src/renderer/src/__tests__/makePromptListModePanelState.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/App.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/prompts/PromptsPanel.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx
npx eslint src/renderer/src/types.ts src/renderer/src/hooks/usePromptListMode.ts src/renderer/src/hooks/__tests__/usePromptListMode.test.ts src/renderer/src/__tests__/makePromptListModePanelState.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/App.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/prompts/PromptsPanel.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx --max-warnings 0
npm run typecheck
npm test
```

Expected: eslint は警告・エラーなし、typecheck は成功、`npm test` は全件 PASS（この時点では画面の見た目は変わらない）。

---

### Task 3: UI（トグルの部品・CSS・PromptsPanel への配置・PromptItem / PromptItemView の `canEdit`）

**Files:**

- Create: `src/renderer/src/components/prompts/PromptListModeToggle.tsx`
- Create: `src/renderer/src/components/prompts/__tests__/PromptListModeToggle.test.tsx`
- Create: `src/renderer/src/components/prompts/__tests__/PromptListModeToggle.styles.test.tsx`
- Modify: `src/renderer/src/assets/main.css`（`.prompts-panel__toolbar-button:disabled` の後）
- Modify: `src/renderer/src/components/prompts/PromptItemView.tsx`
- Modify: `src/renderer/src/components/prompts/__tests__/PromptItemView.test.tsx`
- Modify: `src/renderer/src/components/prompts/PromptItem.tsx`
- Modify: `src/renderer/src/components/prompts/__tests__/PromptItem.test.tsx`
- Modify: `src/renderer/src/components/prompts/PromptsPanel.tsx`
- Modify: `src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx`
- Modify: `src/renderer/src/components/__tests__/Sidebar.test.tsx`
- Create: `src/renderer/src/components/__tests__/App.promptListMode.test.tsx`

**Interfaces:**

- Consumes: Task 2 の `PromptListModePanelState`（`src/renderer/src/types.ts`）、`makePromptListModePanelState`（`src/renderer/src/__tests__/makePromptListModePanelState.ts`）、`PromptsPanel` の props `promptListMode`、Task 1 の `window.api.getPromptListMode` / `setPromptListMode`
- Produces:
  - `export default function PromptListModeToggle({ state }: { state: PromptListModePanelState }): React.JSX.Element`
  - `PromptItem` の必須の props `canEdit: boolean`、`PromptItemView` の必須の props `canEdit: boolean`
  - CSS クラス: `.prompts-panel__mode`（行）、`.prompts-panel__mode-toggle`（ボタン）、`.prompts-panel__mode-error`（保存の失敗の文言）

**気をつける知見:**

- L-475: トグルは条件で隠さない（0 件・検索で 0 件・読み込み中でも出す）。`PromptItem` は `canEdit` が `false` の間、`isEditing` を残さない（描画の最中に `if (!canEdit && isEditing) setIsEditing(false)` で戻す。`isEditing` を残したまま隠すと、編集モードへ戻したときに初期値のフォームが突然開く）。
- L-511・L-154・L-497: 見える文言は現在の状態（`編集モード: オン` / `編集モード: オフ`）。`aria-label` は `編集モード` で固定。状態は `aria-pressed` で伝える。
- L-153: 保存の失敗の文言の `aria-live="polite"` の段落（`role="status"` にはしない。パネルは `Sidebar` で常にマウントされ、空の `status` が常に DOM にあると、`status` が 1 つだけ・0 個を前提にした既存テストの `PromptsPanel.test.tsx`・`Sidebar.test.tsx` が壊れる）は常設にし、中身だけを出し入れする（`saveError` が `null` のときも空の段落を DOM に置く）。
- L-060: `canEdit` は必須の props（省略できると、渡し忘れで表示モードでも `編集`・`削除` が出る不具合を型が見逃す）。

- [ ] **Step 1: トグルの部品とスタイルの失敗するテストを書く**

`src/renderer/src/components/prompts/__tests__/PromptListModeToggle.test.tsx` を作る。

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { makePromptListModePanelState } from '../../../__tests__/makePromptListModePanelState'
import PromptListModeToggle from '../PromptListModeToggle'

const toggle = (): HTMLElement => screen.getByRole('button', { name: '編集モード' })

describe('PromptListModeToggle', () => {
  it('編集モードでは文言が「編集モード: オン」で aria-pressed=true(文言は現在の状態。L-511)', () => {
    render(<PromptListModeToggle state={makePromptListModePanelState({ mode: 'edit' })} />)
    expect(toggle()).toHaveTextContent('編集モード: オン')
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(toggle()).toBeEnabled()
    expect(toggle()).toHaveAttribute('type', 'button')
  })

  it('表示モードでは文言が「編集モード: オフ」で aria-pressed=false(ラベルは固定。L-154・L-497)', () => {
    render(<PromptListModeToggle state={makePromptListModePanelState({ mode: 'view' })} />)
    expect(toggle()).toHaveTextContent('編集モード: オフ')
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(toggle()).toHaveAttribute('aria-label', '編集モード')
  })

  it('読み込み中(mode が null)は押せず、文言は「編集モード: オフ」で aria-pressed=false', async () => {
    const onChange = vi.fn()
    render(<PromptListModeToggle state={makePromptListModePanelState({ mode: null, onChange })} />)
    expect(toggle()).toBeDisabled()
    expect(toggle()).toHaveTextContent('編集モード: オフ')
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('編集モードで押すと onChange に表示モードを渡す', async () => {
    const onChange = vi.fn()
    render(
      <PromptListModeToggle state={makePromptListModePanelState({ mode: 'edit', onChange })} />
    )
    await userEvent.click(toggle())
    expect(onChange).toHaveBeenCalledExactlyOnceWith('view')
  })

  it('表示モードで押すと onChange に編集モードを渡す', async () => {
    const onChange = vi.fn()
    render(
      <PromptListModeToggle state={makePromptListModePanelState({ mode: 'view', onChange })} />
    )
    await userEvent.click(toggle())
    expect(onChange).toHaveBeenCalledExactlyOnceWith('edit')
  })

  it('保存の失敗の文言を aria-live の段落に出す', () => {
    const { container } = render(
      <PromptListModeToggle
        state={makePromptListModePanelState({
          saveError: 'モードの設定を保存できませんでした: 理由'
        })}
      />
    )
    const message = container.querySelector('.prompts-panel__mode-error')
    expect(message).toHaveAttribute('aria-live', 'polite')
    expect(message).toHaveTextContent('モードの設定を保存できませんでした: 理由')
    // 既存のテストが前提にする「画面の status は送信やマージの通知だけ」を崩さない
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('失敗が無くても aria-live の段落は空で置いておき、文言が出ても同じ要素を使う(常設。L-153)', () => {
    const { container, rerender } = render(
      <PromptListModeToggle state={makePromptListModePanelState({ saveError: null })} />
    )
    const status = container.querySelector('.prompts-panel__mode-error')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toBeEmptyDOMElement()
    rerender(
      <PromptListModeToggle
        state={makePromptListModePanelState({
          saveError: 'モードの設定を保存できませんでした: 理由'
        })}
      />
    )
    expect(container.querySelector('.prompts-panel__mode-error')).toBe(status)
    expect(status).toHaveTextContent('モードの設定を保存できませんでした: 理由')
  })
})
```

`src/renderer/src/components/prompts/__tests__/PromptListModeToggle.styles.test.tsx` を作る（`ExecutionModeSection.styles.test.tsx`・`RemoteSetupBanner.styles.test.tsx` と同じ流儀で、実際の `main.css` を読み込み、jsdom の `getComputedStyle` で確かめる）。

```tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { makePromptListModePanelState } from '../../../__tests__/makePromptListModePanelState'
import PromptListModeToggle from '../PromptListModeToggle'
import PromptsToolbar from '../PromptsToolbar'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。トグルは誤タップの防止が目的なので
// 32px 四方以上にし、見た目はインポート / エクスポートのボタン(.prompts-panel__toolbar-button)と同じ値にする(あちらは変えない)
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

// jsdom は :hover を計算しないため、:hover を含む規則のセレクタから :hover を外し、要素に当たるかで「ホバーしたら当たるか」を見る
const hoverBackgroundRulesFor = (element: HTMLElement): string[] =>
  Array.from(styleElement.sheet?.cssRules ?? [])
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
    .filter((rule) => rule.style.getPropertyValue('background') !== '')
    .flatMap((rule) => rule.selectorText.split(/,\s*/))
    .filter((selector) => selector.includes(':hover'))
    .filter((selector) => element.matches(selector.replace(/:hover/g, '')))

/** インポート / エクスポートのボタンと揃える見た目のプロパティ(jsdom が値を計算できるもの) */
const SHARED_LOOK_PROPERTIES = [
  'backgroundColor',
  'color',
  'fontSize',
  'cursor',
  'borderTopStyle',
  'borderTopWidth',
  'borderTopColor',
  'paddingTop'
] as const

describe('一覧のモードのトグルのスタイル(main.css)', () => {
  it('トグルのボタンは 32px 四方以上の枠付きボタンになる', () => {
    render(<PromptListModeToggle state={makePromptListModePanelState()} />)
    const style = getComputedStyle(screen.getByRole('button', { name: '編集モード' }))
    expect(style.minWidth).toBe('32px')
    expect(style.minHeight).toBe('32px')
    expect(style.borderTopStyle).toBe('solid')
    expect(style.cursor).toBe('pointer')
  })

  it('見た目はインポート / エクスポートのボタンと同じ値', () => {
    render(
      <>
        <PromptListModeToggle state={makePromptListModePanelState()} />
        <PromptsToolbar onImport={vi.fn()} onExport={vi.fn()} isExportDisabled={false} />
      </>
    )
    const toggleStyle = getComputedStyle(screen.getByRole('button', { name: '編集モード' }))
    const toolbarStyle = getComputedStyle(
      screen.getByRole('button', { name: 'プロンプトをインポート' })
    )
    for (const property of SHARED_LOOK_PROPERTIES) {
      // 比べる値が空(計算されていない)だと、どちらも空で一致してしまうので、先に空でないことを確かめる
      expect(toolbarStyle[property], property).not.toBe('')
      expect(toggleStyle[property], property).toBe(toolbarStyle[property])
    }
  })

  it('読み込み中(disabled)は半透明で、押せないカーソルになり、ホバーの色の規則が当たらない', () => {
    render(<PromptListModeToggle state={makePromptListModePanelState({ mode: null })} />)
    const button = screen.getByRole('button', { name: '編集モード' })
    const style = getComputedStyle(button)
    expect(style.opacity).toBe('0.5')
    expect(style.cursor).toBe('not-allowed')
    expect(hoverBackgroundRulesFor(button)).toEqual([])
  })

  it('押せるときは、ホバーの色の規則が当たる(上の判定が空振りしていないことの確認)', () => {
    render(<PromptListModeToggle state={makePromptListModePanelState()} />)
    expect(
      hoverBackgroundRulesFor(screen.getByRole('button', { name: '編集モード' })).length
    ).toBeGreaterThan(0)
  })

  it('トグルの行はほかの行と同じく縮まず、下に区切りの線を持つ', () => {
    render(<PromptListModeToggle state={makePromptListModePanelState()} />)
    const row = screen.getByRole('button', { name: '編集モード' }).parentElement as HTMLElement
    const style = getComputedStyle(row)
    expect(style.flexShrink).toBe('0')
    expect(style.borderBottomStyle).toBe('solid')
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/components/prompts/__tests__/PromptListModeToggle.test.tsx src/renderer/src/components/prompts/__tests__/PromptListModeToggle.styles.test.tsx`
Expected: FAIL（`../PromptListModeToggle` が無い）

- [ ] **Step 3: トグルの部品と CSS を書く**

`src/renderer/src/components/prompts/PromptListModeToggle.tsx` を作る。

```tsx
'use client'
import type { PromptListModePanelState } from '../../types'

interface Props {
  state: PromptListModePanelState
}

// プロンプト一覧の編集モード / 表示モードのトグルの行(パネルの最上部)。0 件・検索中・読み込み中でも常に出す
// (隠すとモードを戻せなくなる。L-475)。ラベルは固定で、状態は aria-pressed で伝え、見える文言は現在の状態にする
// (L-154・L-497・L-511)。読み込み中(mode が null)は押せず、`編集`・`削除` も出ないので「オフ」と表示する
export default function PromptListModeToggle({ state }: Props): React.JSX.Element {
  const { mode, saveError, onChange } = state
  const isEditMode = mode === 'edit'
  return (
    <div className="prompts-panel__mode">
      <button
        type="button"
        className="prompts-panel__mode-toggle"
        aria-label="編集モード"
        aria-pressed={isEditMode}
        disabled={mode === null}
        onClick={() => onChange(isEditMode ? 'view' : 'edit')}
      >
        {isEditMode ? '編集モード: オン' : '編集モード: オフ'}
      </button>
      {/* 保存の失敗の文言の領域は常設にし、中身だけを出し入れする(文言の出し入れで読み上げが欠けないように。L-153) */}
      <p className="prompts-panel__mode-error" aria-live="polite">
        {saveError ?? ''}
      </p>
    </div>
  )
}
```

`src/renderer/src/assets/main.css` の次の箇所に足す（`.prompts-panel__toolbar-button` の規則は変えない）。

置き換え前:

```css
.prompts-panel__toolbar-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.prompts-panel__search {
```

置き換え後:

```css
.prompts-panel__toolbar-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* プロンプト一覧の編集モード / 表示モードのトグルの行(パネルの最上部。インポート / エクスポートの行の上) */
.prompts-panel__mode {
  display: flex;
  flex-direction: column;
  padding: 6px 8px;
  border-bottom: 1px solid #2d2d2d;
  flex-shrink: 0;
}

/* 誤タップの防止が目的なので 32px 四方以上にする。見た目は .prompts-panel__toolbar-button と同じ値(あちらは変えない) */
.prompts-panel__mode-toggle {
  min-width: 32px;
  min-height: 32px;
  background: #3c3c3c;
  border: 1px solid #555555;
  border-radius: 3px;
  color: #cccccc;
  font-size: 12px;
  padding: 4px 8px;
  cursor: pointer;
  outline: none;
}

.prompts-panel__mode-toggle:hover:not(:disabled) {
  background: #4a4a4a;
}

.prompts-panel__mode-toggle:focus {
  border-color: #007acc;
}

.prompts-panel__mode-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 保存の失敗の文言。空の段落も DOM に残す(常設の aria-live の領域。L-153)ので、空のときは余白を消す */
.prompts-panel__mode-error {
  margin: 0;
  padding-top: 2px;
  color: #f48771;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.prompts-panel__mode-error:empty {
  padding: 0;
}

.prompts-panel__search {
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/components/prompts/__tests__/PromptListModeToggle.test.tsx src/renderer/src/components/prompts/__tests__/PromptListModeToggle.styles.test.tsx`
Expected: PASS（12 件）

- [ ] **Step 5: PromptItemView の失敗するテストを書く**

`src/renderer/src/components/prompts/__tests__/PromptItemView.test.tsx` の `defaultProps` の `isRunDisabled: false,` の行の直後に `canEdit: true,` を足す。

`describe('PromptItemView', …)` の中の `describe('タグ表示', …)` の直前に足す。

```tsx
describe('canEdit(一覧の編集モード / 表示モード)', () => {
  it('canEdit=true のとき 編集・削除 のボタンを出す', () => {
    render(<PromptItemView {...defaultProps} canEdit />)
    expect(screen.getByRole('button', { name: 'プロンプトを編集' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'プロンプトを削除' })).toBeInTheDocument()
  })

  it('canEdit=false のとき 編集・削除 のボタンを DOM に出さない(disabled にもしない)', () => {
    const { container } = render(<PromptItemView {...defaultProps} canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'プロンプトを編集' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'プロンプトを削除' })).not.toBeInTheDocument()
    expect(container.querySelector('.prompt-item__edit-btn')).toBeNull()
    expect(container.querySelector('.prompt-item__delete')).toBeNull()
  })

  it('canEdit=false でも 実行・ピン留め・並び替えのハンドルは出す', () => {
    render(<PromptItemView {...defaultProps} canEdit={false} isSortable />)
    expect(screen.getByRole('button', { name: 'プロンプトを実行' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'ピン留め' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '並び替え' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/components/prompts/__tests__/PromptItemView.test.tsx`
Expected: FAIL（`canEdit=false のとき 編集・削除 のボタンを DOM に出さない` が、ボタンが在るため落ちる）

- [ ] **Step 7: PromptItemView を書く**

`src/renderer/src/components/prompts/PromptItemView.tsx`:

- `interface Props` の `isRunDisabled: boolean` の行の直後に足す。

```ts
/** `編集`・`削除` を出すか(一覧の編集モードのときだけ true。false なら DOM に出さない)。省略できない(L-060) */
canEdit: boolean
```

- 分割代入の `isRunDisabled,` の行の直後に `canEdit,` を足す。
- `編集` と `削除` の 2 つのボタンを次に置き換える（`実行` のボタンは変えない）。

置き換え前:

```tsx
        <button
          type="button"
          className="prompt-item__edit-btn"
          aria-label="プロンプトを編集"
          onClick={onEditStart}
        >
          編集
        </button>
        <button
          type="button"
          className="prompt-item__delete"
          aria-label="プロンプトを削除"
          onClick={onDelete}
        >
          削除
        </button>
```

置き換え後:

```tsx
{
  /* 表示モード(と読み込み中)では出さない(押せないのではなく描かない。誤タップの防止) */
}
{
  canEdit && (
    <>
      <button
        type="button"
        className="prompt-item__edit-btn"
        aria-label="プロンプトを編集"
        onClick={onEditStart}
      >
        編集
      </button>
      <button
        type="button"
        className="prompt-item__delete"
        aria-label="プロンプトを削除"
        onClick={onDelete}
      >
        削除
      </button>
    </>
  )
}
```

- [ ] **Step 8: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/components/prompts/__tests__/PromptItemView.test.tsx`
Expected: PASS（この時点では `PromptItem` がまだ `canEdit` を渡さないので、`PromptItem.test.tsx`・`PromptsPanel.test.tsx` の `編集`・`削除` を押す既存のテストは落ちる。Step 12・17 で直るので、ここでは `PromptItemView.test.tsx` だけを走らせる）

- [ ] **Step 9: 修正を戻すと落ちることを確かめる**

`PromptItemView.tsx` の `{canEdit && (` を一時的に `{(true || canEdit) && (` に書き換えて実行する。

Run: `npx vitest run src/renderer/src/components/prompts/__tests__/PromptItemView.test.tsx -t "canEdit=false"`
Expected: FAIL（`編集`・`削除` が DOM に在る）。確かめたら `{canEdit && (` に戻し、もう一度実行して PASS を確かめる。

- [ ] **Step 10: PromptItem の失敗するテストを書く**

`src/renderer/src/components/prompts/__tests__/PromptItem.test.tsx`:

- `defaultProps` の `prompt: basePrompt,` の行の直後に `canEdit: true,` を足す。
- `describe('PromptItem', …)` の中の `describe('ドラッグハンドル', …)` の直前に足す。

```tsx
describe('canEdit(一覧の編集モード / 表示モード)', () => {
  it('canEdit=false のとき 編集・削除 を出さず、実行 は出す', () => {
    render(<PromptItem {...defaultProps} canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'プロンプトを編集' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'プロンプトを削除' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'プロンプトを実行' })).toBeInTheDocument()
  })

  it('編集中に canEdit が false になるとフォームを閉じ、onEdit は呼ばない', async () => {
    const onEdit = vi.fn()
    const { rerender } = render(<PromptItem {...defaultProps} onEdit={onEdit} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'タイトルを編集' }), '追記')
    rerender(<PromptItem {...defaultProps} onEdit={onEdit} canEdit={false} />)
    expect(screen.queryByRole('textbox', { name: 'タイトルを編集' })).not.toBeInTheDocument()
    expect(screen.getByText('テストタイトル')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'プロンプトを実行' })).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('閉じた後に canEdit を true に戻してもフォームは開かず、開き直すと入力は破棄されている(L-475)', async () => {
    const { rerender } = render(<PromptItem {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
    const titleInput = screen.getByRole('textbox', { name: 'タイトルを編集' })
    await userEvent.clear(titleInput)
    await userEvent.type(titleInput, '破棄される変更')
    rerender(<PromptItem {...defaultProps} canEdit={false} />)
    rerender(<PromptItem {...defaultProps} canEdit />)
    expect(screen.queryByRole('textbox', { name: 'タイトルを編集' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
    expect(screen.getByRole('textbox', { name: 'タイトルを編集' })).toHaveValue('テストタイトル')
  })

  it('変数の入力フォームは canEdit が false になっても閉じない', async () => {
    const { rerender } = render(
      <PromptItem {...defaultProps} prompt={{ ...basePrompt, content: '{{name}} さんへ' }} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを実行' }))
    expect(screen.getByRole('textbox', { name: '変数 name の値' })).toBeInTheDocument()
    rerender(
      <PromptItem
        {...defaultProps}
        prompt={{ ...basePrompt, content: '{{name}} さんへ' }}
        canEdit={false}
      />
    )
    expect(screen.getByRole('textbox', { name: '変数 name の値' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 11: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/components/prompts/__tests__/PromptItem.test.tsx`
Expected: FAIL（`PromptItem` が `canEdit` を `PromptItemView` へ渡さず `undefined` になるため、`削除ボタンが存在する` など `編集`・`削除` を使う既存のテストが落ち、`編集中に canEdit が false になると…` も編集ボタンが無いため落ちる。`canEdit=false のとき 編集・削除 を出さず…` は、この時点では偶然通る〈Step 14 の書き換えで、閉じる処理を外すと落ちることを別に確かめる〉）

- [ ] **Step 12: PromptItem を書く**

`src/renderer/src/components/prompts/PromptItem.tsx`:

- `interface Props` の `prompt: Prompt` の行の直後に足す。

```ts
/** `編集`・`削除` を出すか(一覧の編集モードのときだけ true)。false になったら編集中のフォームを閉じる。省略できない(L-060) */
canEdit: boolean
```

- 分割代入の `prompt,` の行の直後に `canEdit,` を足す。
- `const [isFillingVariables, setIsFillingVariables] = useState(false)` の行の直後に足す。

```ts
// 表示モード(canEdit が false)になったら、編集中のフォームを閉じて入力を破棄する(確認は出さない)。isEditing を残したまま
// 隠すと、編集モードへ戻したときに初期値のフォームが突然開く隠れた状態になる(L-475)。描画の最中に戻すので、閉じる前の
// フォームは画面に出ない。変数の入力フォーム(isFillingVariables)は実行の操作なので閉じない
if (!canEdit && isEditing) setIsEditing(false)
```

- `<PromptItemView … />` の `isSortable={isSortable}` の行の直後に `canEdit={canEdit}` を足す。

- [ ] **Step 13: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/components/prompts/__tests__/PromptItem.test.tsx`
Expected: PASS

- [ ] **Step 14: 修正を戻すと落ちることを確かめる**

`PromptItem.tsx` の `if (!canEdit && isEditing) setIsEditing(false)` の行を一時的に消して実行する。

Run: `npx vitest run src/renderer/src/components/prompts/__tests__/PromptItem.test.tsx -t "canEdit"`
Expected: FAIL（`編集中に canEdit が false になるとフォームを閉じ…` と `閉じた後に canEdit を true に戻しても…` の 2 件）。確かめたら行を元に戻し、もう一度実行して PASS を確かめる。

- [ ] **Step 15: PromptsPanel の失敗するテストを書く**

`src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx`:

- 先頭の import に足す（`import type { AgentReferencesPanelState, Prompt } from '../../../types'` の行の直後）。

```ts
import type { PromptListMode } from '@shared/types'
```

- ファイルの末尾に足す。

```tsx
describe('PromptsPanel: 一覧の編集モード / 表示モード', () => {
  it('トグルをパネルの先頭(インポート / エクスポートの行より前)に出す', () => {
    const { container } = render(<PromptsPanel {...defaultProps} />)
    const toggle = screen.getByRole('button', { name: '編集モード' })
    expect(container.querySelector('.prompts-panel')?.firstElementChild).toContainElement(toggle)
    expect(
      toggle.compareDocumentPosition(
        screen.getByRole('button', { name: 'プロンプトをインポート' })
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('編集モードでは 編集・削除 を出す', () => {
    render(
      <PromptsPanel
        {...defaultProps}
        prompts={[samplePrompt]}
        promptListMode={makePromptListModePanelState({ mode: 'edit' })}
      />
    )
    expect(screen.getByRole('button', { name: 'プロンプトを編集' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'プロンプトを削除' })).toBeInTheDocument()
  })

  it.each<[PromptListMode | null]>([['view'], [null]])(
    'mode が %s のときは 編集・削除 を出さず、実行・ピン留めは出す(canEdit の渡し忘れを落とす)',
    (mode) => {
      render(
        <PromptsPanel
          {...defaultProps}
          prompts={[samplePrompt, anotherPrompt]}
          promptListMode={makePromptListModePanelState({ mode })}
        />
      )
      expect(screen.queryByRole('button', { name: 'プロンプトを編集' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'プロンプトを削除' })).not.toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'プロンプトを実行' })).toHaveLength(2)
      expect(screen.getAllByRole('button', { name: 'ピン留め' })).toHaveLength(2)
    }
  )

  it('表示モードでも 追加・インポート・エクスポート・並び替えのハンドルは使える', async () => {
    const onAdd = vi.fn()
    const onImport = vi.fn()
    const onExport = vi.fn()
    render(
      <PromptsPanel
        {...defaultProps}
        prompts={[samplePrompt]}
        onAdd={onAdd}
        onImport={onImport}
        onExport={onExport}
        promptListMode={makePromptListModePanelState({ mode: 'view' })}
      />
    )
    expect(screen.getByRole('button', { name: '並び替え' })).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'タイトル' }), '新しいタイトル')
    await userEvent.type(screen.getByRole('textbox', { name: 'プロンプト内容' }), '新しい内容')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(onAdd).toHaveBeenCalledExactlyOnceWith('新しいタイトル', '新しい内容')
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトをインポート' }))
    expect(onImport).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトをエクスポート' }))
    expect(onExport).toHaveBeenCalledOnce()
  })

  it('プロンプトが 0 件でもトグルを出し、押せる(L-475)', () => {
    render(
      <PromptsPanel
        {...defaultProps}
        prompts={[]}
        promptListMode={makePromptListModePanelState({ mode: 'view' })}
      />
    )
    expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '編集モード' })).toBeEnabled()
  })

  it('検索で 0 件になってもトグルを出し、押せる(L-475)', async () => {
    render(
      <PromptsPanel
        {...defaultProps}
        prompts={[samplePrompt]}
        promptListMode={makePromptListModePanelState({ mode: 'view' })}
      />
    )
    await userEvent.type(screen.getByRole('searchbox', { name: 'プロンプトを検索' }), 'zzzz')
    expect(screen.getByText('条件に一致するプロンプトはありません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '編集モード' })).toBeEnabled()
  })

  it('トグルを押すと onChange に逆のモードを渡し、保存の失敗の文言を出す', async () => {
    const onChange = vi.fn()
    render(
      <PromptsPanel
        {...defaultProps}
        promptListMode={makePromptListModePanelState({
          mode: 'edit',
          saveError: 'モードの設定を保存できませんでした: 理由',
          onChange
        })}
      />
    )
    expect(screen.getByText('モードの設定を保存できませんでした: 理由')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '編集モード' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('view')
  })

  it('編集フォームを開いたまま表示モードへ切り替えるとフォームを閉じる', async () => {
    const { rerender } = render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
    expect(screen.getByRole('textbox', { name: 'タイトルを編集' })).toBeInTheDocument()
    rerender(
      <PromptsPanel
        {...defaultProps}
        prompts={[samplePrompt]}
        promptListMode={makePromptListModePanelState({ mode: 'view' })}
      />
    )
    expect(screen.queryByRole('textbox', { name: 'タイトルを編集' })).not.toBeInTheDocument()
    expect(screen.getByText('テストタイトル')).toBeInTheDocument()
  })
})
```

- [ ] **Step 16: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx`
Expected: FAIL（トグルが無いので `編集モード` のボタンを探すテストが落ちる。また `PromptsPanel` がまだ `canEdit` を `PromptItem` へ渡さず `undefined` になるため、`削除ボタンクリックで onDelete が呼ばれる`・`編集モードでは 編集・削除 を出す` など `編集`・`削除` を使うテストも落ちる。`mode が view / null のときは…` は、この時点では偶然通る〈Step 19 の書き換えで、`canEdit` の渡し方を壊すと落ちることを別に確かめる〉）

- [ ] **Step 17: PromptsPanel を書く**

`src/renderer/src/components/prompts/PromptsPanel.tsx`:

- `import AgentReferenceChips from './AgentReferenceChips'` の行の直後に `import PromptListModeToggle from './PromptListModeToggle'` を足す。
- 分割代入の末尾 `  runAriaLabel,\n  agentReferences\n}: Props)` を `  runAriaLabel,\n  agentReferences,\n  promptListMode\n}: Props)` にする。
- `const isSortable = !isFiltered` の行の直後に足す。

```ts
// 表示モードと読み込み中(null)では `編集`・`削除` を出さない(読み込み中に出すと、保存が表示モードのとき一瞬だけ削除を押せてしまう)
const canEdit = promptListMode.mode === 'edit'
```

- JSX の先頭を次に置き換える。

置き換え前:

```tsx
    <div className="prompts-panel">
      <PromptsToolbar
```

置き換え後:

```tsx
    <div className="prompts-panel">
      {/* 一覧の編集モード / 表示モード。0 件・検索中でも常に出す(隠すとモードを戻せなくなる。L-475) */}
      <PromptListModeToggle state={promptListMode} />
      <PromptsToolbar
```

- `<PromptItem … />` の `isSortable={isSortable}` の行の直後に `canEdit={canEdit}` を足す。

- [ ] **Step 18: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx`
Expected: PASS（既存のテストも含めて全件。既存のテストは `defaultProps` の `mode: 'edit'` で `編集`・`削除` が出る）

- [ ] **Step 19: 修正を戻すと落ちることを確かめる**

`PromptsPanel.tsx` の `<PromptItem … />` の `canEdit={canEdit}` を一時的に `canEdit={true}` に書き換えて実行する。

Run: `npx vitest run src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx -t "mode が"`
Expected: FAIL（`view`・`null` の 2 件で `編集`・`削除` が出る）。確かめたら `canEdit={canEdit}` に戻し、もう一度実行して PASS を確かめる。

- [ ] **Step 20: Sidebar と App の素通しのテストを書く**

`src/renderer/src/components/__tests__/Sidebar.test.tsx` のファイルの末尾に足す。

```tsx
describe('Sidebar: 一覧の編集モード / 表示モードの受け渡し', () => {
  it('promptListMode をプロンプトパネルのトグルと一覧へ渡す(渡し忘れ・取り違えを確かめる。L-060)', async () => {
    const onChange = vi.fn()
    render(
      <Sidebar
        activePanel="prompts"
        {...defaultProps}
        prompts={[{ id: 'p1', title: 'プロンプト1', content: '内容1', createdAt: 1000000 }]}
        promptListMode={makePromptListModePanelState({
          mode: 'view',
          saveError: 'モードの設定を保存できませんでした: 理由',
          onChange
        })}
      />
    )
    const toggle = screen.getByRole('button', { name: '編集モード' })
    expect(toggle).toHaveTextContent('編集モード: オフ')
    expect(screen.queryByRole('button', { name: 'プロンプトを編集' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'プロンプトを削除' })).not.toBeInTheDocument()
    expect(screen.getByText('モードの設定を保存できませんでした: 理由')).toBeInTheDocument()
    await userEvent.click(toggle)
    expect(onChange).toHaveBeenCalledExactlyOnceWith('edit')
  })
})
```

`src/renderer/src/components/__tests__/App.promptListMode.test.tsx` を作る（`App.agentSendConfirm.test.tsx` と同じひな形。`usePromptListMode` は差し替えず、`window.api` から hook・`useAppState`・`App`・`Sidebar`・`PromptsPanel` までを通す）。

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAgentWorkspaceState } from '../../__tests__/makeAgentWorkspaceState'
import { activityBarPanels } from '../../config/activityBarPanels'

const mockUseAgentWorkspace = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useAgentWorkspace', () => ({ useAgentWorkspace: mockUseAgentWorkspace }))

import App from '../../App'

const openPromptsPanel = async (): Promise<void> => {
  const config = activityBarPanels.find((p) => p.panel === 'prompts')
  if (config === undefined) throw new Error('panel config not found: prompts')
  await userEvent.click(screen.getByTitle(config.title))
}

describe('App: 一覧の編集モード / 表示モードの配線', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api.loadPrompts = vi
      .fn()
      .mockResolvedValue([
        { id: 'p1', title: 'テストタイトル', content: 'テスト内容', createdAt: 1000000 }
      ])
    window.api.onExternalFileChange = vi.fn(() => () => {})
    window.api.getPromptListMode = vi.fn().mockResolvedValue('view')
    window.api.setPromptListMode = vi.fn().mockResolvedValue(undefined)
    mockUseAgentWorkspace.mockReturnValue(makeAgentWorkspaceState())
  })

  it('保存されたモードをプロンプトパネルまで届け、トグルの切り替えを保存する', async () => {
    render(<App />)
    await openPromptsPanel()
    await screen.findByText('テストタイトル')
    const toggle = screen.getByRole('button', { name: '編集モード' })
    // 読み込みが終わるまでは押せない。終わったら保存されていた表示モード
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toHaveTextContent('編集モード: オフ')
    expect(screen.queryByRole('button', { name: 'プロンプトを編集' })).not.toBeInTheDocument()

    await userEvent.click(toggle)

    expect(window.api.setPromptListMode).toHaveBeenCalledExactlyOnceWith('edit')
    expect(await screen.findByRole('button', { name: 'プロンプトを編集' })).toBeInTheDocument()
    expect(toggle).toHaveTextContent('編集モード: オン')
  })
})
```

- [ ] **Step 21: 通ることと、結線を戻すと落ちることを確かめる**

Run: `npx vitest run src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/App.promptListMode.test.tsx`
Expected: PASS

続けて、`src/renderer/src/App.tsx` の `<Sidebar … />` の `promptListMode={promptListMode}` の行を一時的に消して実行する。

Run: `npx vitest run src/renderer/src/components/__tests__/App.promptListMode.test.tsx`
Expected: FAIL（`PromptsPanel` が `promptListMode` を受け取れず、描画で落ちる）。確かめたら行を元に戻し、もう一度実行して PASS を確かめる。

- [ ] **Step 22: 整形とタスク全体の検証**

Run:

```bash
npx prettier --write src/renderer/src/components/prompts/PromptListModeToggle.tsx src/renderer/src/components/prompts/__tests__/PromptListModeToggle.test.tsx src/renderer/src/components/prompts/__tests__/PromptListModeToggle.styles.test.tsx src/renderer/src/assets/main.css src/renderer/src/components/prompts/PromptItemView.tsx src/renderer/src/components/prompts/__tests__/PromptItemView.test.tsx src/renderer/src/components/prompts/PromptItem.tsx src/renderer/src/components/prompts/__tests__/PromptItem.test.tsx src/renderer/src/components/prompts/PromptsPanel.tsx src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/App.promptListMode.test.tsx
npx eslint src/renderer/src/components/prompts/PromptListModeToggle.tsx src/renderer/src/components/prompts/__tests__/PromptListModeToggle.test.tsx src/renderer/src/components/prompts/__tests__/PromptListModeToggle.styles.test.tsx src/renderer/src/components/prompts/PromptItemView.tsx src/renderer/src/components/prompts/__tests__/PromptItemView.test.tsx src/renderer/src/components/prompts/PromptItem.tsx src/renderer/src/components/prompts/__tests__/PromptItem.test.tsx src/renderer/src/components/prompts/PromptsPanel.tsx src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/App.promptListMode.test.tsx --max-warnings 0
npm run typecheck
npm test
```

Expected: eslint は警告・エラーなし（`PromptItem.tsx` の描画の最中の `setIsEditing(false)` は条件付きなので `react-hooks` の規則に当たらない想定。当たったら、規則の名前と文言を報告して止まる。`useEffect` に置き換えない〈閉じる前のフォームが 1 回描かれる〉）、typecheck は成功、`npm test` は全件 PASS。

---

### Task 4（最終）: ROADMAP・実機テスト仕様書の更新と Artifact の再公開、全体の検証

**Files:**

- Modify: `ROADMAP.md`（「### プロンプト管理（プロンプト実行の準備）」と「### タッチ操作対応」の前書き）
- Modify: `docs/manual-test-spec.md`（「## プロンプト管理」の先頭の前提と、領域の最後の節）
- 生成: `.superpowers/manual-test-spec.html`（git 管理外。`node scripts/build-manual-test-spec.mjs` が書く）

**Interfaces:**

- Consumes: Task 3 までの画面（トグルの文言 `編集モード: オン` / `編集モード: オフ`、表示モードで `編集`・`削除` を出さない、編集中の切り替えでフォームを閉じる）
- Produces: 実機テスト仕様書の ID `PRM-087`〜`PRM-099`

- [ ] **Step 1: ROADMAP.md を更新する（prettier はかけない）**

「### プロンプト管理（プロンプト実行の準備）」の最後の項目の直後に 1 行足す。

置き換え前:

```markdown
- [x] お気に入り / ピン留め

### Claude API 連携（プロンプト実行。テキスト生成型の旧方式）
```

置き換え後:

```markdown
- [x] お気に入り / ピン留め
- [x] プロンプト一覧の編集モード / 表示モード（誤タップの防止。表示モードでは `編集`・`削除` を出さない。モードは設定として保存し、既定は編集モード）

### Claude API 連携（プロンプト実行。テキスト生成型の旧方式）
```

未実装の候補に、この機能と同じ項目は無い（「タップ領域の最適化」は別の機能）。「### タッチ操作対応」の前書きの現状の説明だけを直す。

置き換え前:

```markdown
「タッチ操作だけでも完結できる」というコンセプトのもう一方の柱。現状はドラッグ＆ドロップの
並び替え（プロンプト一覧・エディタタブ）が実装されている程度で、タッチ操作そのものを
主眼にした機能はほとんど手つかず。
```

置き換え後:

```markdown
「タッチ操作だけでも完結できる」というコンセプトのもう一方の柱。現状はドラッグ＆ドロップの
並び替え（プロンプト一覧・エディタタブ）と、プロンプト一覧の誤タップを防ぐ編集モード / 表示モードが
実装されている程度で、タッチ操作そのものを主眼にした機能はほとんど手つかず。
```

- [ ] **Step 2: 実機テスト仕様書に追記する**

`docs/manual-test-spec.md` の「## プロンプト管理」の見出しの直後に、領域の前提を足す。

置き換え前:

```markdown
## プロンプト管理

### プロンプトの追加
```

置き換え後:

```markdown
## プロンプト管理

> 前提: 一覧は編集モード（既定）にしておく。表示モードのままだと、編集・削除の項目を手順どおりに実行できない（切り替えは PRM-087 以降）

### プロンプトの追加
```

「### プロンプト管理の見た目(ダークテーマ)」の節の `PRM-086` の行の後（「## プロンプトの実行と実行履歴」の前）に、節を足す。

置き換え前:

```markdown
- [ ] **PRM-086** プロンプトパネル(一覧・追加フォーム・編集表示・変数入力フォーム・タグチップ)を見る(アプリは常に暗色) → ダークテーマの見た目として、文字と背景のコントラストが十分で、入力欄・ボタン・タグチップの境界が識別できる

## プロンプトの実行と実行履歴
```

置き換え後:

```markdown
- [ ] **PRM-086** プロンプトパネル(一覧・追加フォーム・編集表示・変数入力フォーム・タグチップ)を見る(アプリは常に暗色) → ダークテーマの見た目として、文字と背景のコントラストが十分で、入力欄・ボタン・タグチップの境界が識別できる

### プロンプト一覧の編集モード / 表示モード

> 前提: プロンプトパネルを開き、プロンプトを 2 件以上用意しておく。トグルはパネルの最上部（`インポート` / `エクスポート` の行の上）にある。
> 前提: PRM-091 の `実行` は、設定の「プロンプトの実行方式」を「従来の方式」にするか、エージェント CLI 方式ならターミナルで `起動` してから押す（送信前の確認のダイアログが開いたら `送信` を押す）。

- [ ] **PRM-087** モードを一度も切り替えていない状態（初回）でプロンプトパネルを開く → 最上部のトグルに `編集モード: オン` と表示され、各項目に `実行`・`編集`・`削除` が今までどおり並ぶ
- [ ] **PRM-088** トグルを押す → 表示が `編集モード: オフ` に変わり、各項目から `編集` と `削除` が消える（押せないのではなく表示されない）。`実行` とピン留め（☆ / ★）は残る
- [ ] **PRM-089** 表示モードのまま、ある項目のピン留めを押し、並び替えハンドル（⠿）で未ピンの項目の順番を入れ替える → ピン留めも並び替えも今までどおりできる
- [ ] **PRM-090** 表示モードのまま、追加フォームでプロンプトを追加し、`エクスポート` で書き出してから、その JSON を `インポート` する → 追加・エクスポート・インポートが今までどおりでき、増えた項目にも `編集`・`削除` は表示されない
- [ ] **PRM-091** 表示モードのまま、変数を含まないプロンプトの `実行` を押す → 今までどおり実行できる（変数を含むプロンプトでは変数の入力フォームが開く）
- [ ] **PRM-092** 表示モードのままアプリを終了し、`npm run dev` で再起動してプロンプトパネルを開く → トグルは `編集モード: オフ` のままで、`編集`・`削除` は表示されない
- [ ] **PRM-093** 表示モードのまま、アクティビティバーの `プロンプト` を押してサイドバーを閉じ、もう一度押して開く → トグルは `編集モード: オフ` のままで、`編集`・`削除` は表示されない
- [ ] **PRM-094** トグルを押して編集モードに戻し、ある項目の `編集` を押してタイトルを書き換え、保存しないままトグルを押す → 確認は出ずに編集フォームが閉じ、項目は元のタイトルのまま表示される
- [ ] **PRM-095** PRM-094 の後にトグルを押して編集モードに戻す → 編集フォームは開いておらず、その項目の `編集` を押すと元のタイトルが入ったフォームが開く（書き換えた入力は戻らない）
- [ ] **PRM-096** 表示モードで、検索欄にどれにも一致しない語（例: `zzzz`）を入れる → `条件に一致するプロンプトはありません` と出ても、トグルは最上部に表示され、押せる
- [ ] **PRM-097** `エクスポート` で一覧を控えてから、編集モードですべてのプロンプトを削除して 0 件にし、トグルを見る → `プロンプトがありません` と出ても、トグルは表示され、押せる（確認後は控えた JSON を `インポート` して戻す）
- [ ] **PRM-098** サイドバーの幅（約 240px）のまま、トグルの行と、その下のインポート / エクスポートの行を見る → `編集モード: オフ` / `編集モード: オン` の文言は潰れたりはみ出したりせず、トグルは高さ約 32px 以上の押しやすい大きさで、行の並びは崩れない
- [ ] **PRM-099** 最後にトグルを押して編集モードに戻す → `編集モード: オン` と表示され、各項目に `編集`・`削除` が再び表示される（以降の項目のために編集モードに戻しておく）

## プロンプトの実行と実行履歴
```

- [ ] **Step 3: 仕様書の検査と HTML の再生成**

Run:

```bash
npx vitest run scripts
node scripts/build-manual-test-spec.mjs
npx prettier --check docs/manual-test-spec.md
```

Expected: `npx vitest run scripts` は PASS（ID の一意性・接頭辞ごとの連番が文書の出現順に昇順・書式）。ビルドは成功し、`.superpowers/manual-test-spec.html` を書く。prettier は `docs/manual-test-spec.md` を整形済みと判定する（崩れていたら `npx prettier --write docs/manual-test-spec.md` だけをかけてから再実行する。ROADMAP.md にはかけない）。

- [ ] **Step 4: Artifact を再公開する**

Artifact ツールで次の順に行う。

1. `action: "read"`、`url: "<manual-test-spec-artifact-url>"` で読む（この会話でまだ公開していないため、読まずに publish すると拒否される）。
2. `action: "publish"`、`file_path`: 作業ツリーの `.superpowers/manual-test-spec.html`（絶対パス）、`url: "<manual-test-spec-artifact-url>"` で公開する（`icon` は渡さない）。

Expected: 同じ URL が更新され、「プロンプト管理」に「プロンプト一覧の編集モード / 表示モード」の節（PRM-087〜PRM-099）が出る。

- [ ] **Step 5: 全体の検証**

Run:

```bash
npm test
npm run typecheck
npx eslint src/shared/types/settings.ts src/shared/types.ts src/shared/__tests__/promptListMode.test.ts src/main/settingsFileStore.ts src/main/promptListModeStore.ts src/main/__tests__/promptListModeStore.test.ts src/main/handlers/settingsHandlers.ts src/main/__tests__/handlers/settingsHandlers.test.ts src/preload/api.ts src/preload/index.d.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/settingsApi.ts src/renderer/src/lib/__tests__/settingsApi.test.ts src/renderer/src/__tests__/setup.ts src/renderer/src/types.ts src/renderer/src/hooks/usePromptListMode.ts src/renderer/src/hooks/__tests__/usePromptListMode.test.ts src/renderer/src/__tests__/makePromptListModePanelState.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/App.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/App.promptListMode.test.tsx src/renderer/src/components/prompts/PromptListModeToggle.tsx src/renderer/src/components/prompts/__tests__/PromptListModeToggle.test.tsx src/renderer/src/components/prompts/__tests__/PromptListModeToggle.styles.test.tsx src/renderer/src/components/prompts/PromptItemView.tsx src/renderer/src/components/prompts/__tests__/PromptItemView.test.tsx src/renderer/src/components/prompts/PromptItem.tsx src/renderer/src/components/prompts/__tests__/PromptItem.test.tsx src/renderer/src/components/prompts/PromptsPanel.tsx src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx --max-warnings 0
npx prettier --check src/shared/types/settings.ts src/shared/types.ts src/shared/__tests__/promptListMode.test.ts src/main/settingsFileStore.ts src/main/promptListModeStore.ts src/main/__tests__/promptListModeStore.test.ts src/main/handlers/settingsHandlers.ts src/main/__tests__/handlers/settingsHandlers.test.ts src/preload/api.ts src/preload/index.d.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/settingsApi.ts src/renderer/src/lib/__tests__/settingsApi.test.ts src/renderer/src/__tests__/setup.ts src/renderer/src/types.ts src/renderer/src/hooks/usePromptListMode.ts src/renderer/src/hooks/__tests__/usePromptListMode.test.ts src/renderer/src/__tests__/makePromptListModePanelState.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/App.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/App.promptListMode.test.tsx src/renderer/src/components/prompts/PromptListModeToggle.tsx src/renderer/src/components/prompts/__tests__/PromptListModeToggle.test.tsx src/renderer/src/components/prompts/__tests__/PromptListModeToggle.styles.test.tsx src/renderer/src/components/prompts/PromptItemView.tsx src/renderer/src/components/prompts/__tests__/PromptItemView.test.tsx src/renderer/src/components/prompts/PromptItem.tsx src/renderer/src/components/prompts/__tests__/PromptItem.test.tsx src/renderer/src/components/prompts/PromptsPanel.tsx src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx src/renderer/src/assets/main.css docs/manual-test-spec.md
git status --short
```

Expected: `npm test` は全件 PASS、typecheck は成功、eslint は警告・エラーなし、prettier は全ファイル整形済み。`git status --short` に、このプランの「ファイルの構成」の表にあるファイル（と `docs/superpowers/plans/2026-10-30-prompt-list-mode.md`）以外の変更が出ない（`.superpowers/` は git 管理外。`.worktrees/` と設計書の未追跡は元から在る）。コミットはしない。

---

## Self-Review

**1. 設計書の要件への対応**

| 設計書の要件                                                                                                                                 | タスク                            |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| shared の `PROMPT_LIST_MODES`・`PromptListMode`・`DEFAULT_PROMPT_LIST_MODE`（`'edit'`）・`isPromptListMode`（`isOneOf`）と再エクスポート     | 1（Step 1〜4）                    |
| main の `promptListModeStore`（無い・不正は既定、不正な値は値を入れない固定文言で拒否）、`SettingsFile.promptListMode?: string`              | 1（Step 5〜8）                    |
| IPC `settings:getPromptListMode` / `settings:setPromptListMode`（set は検証せず store へ）                                                   | 1（Step 9〜12）                   |
| preload の api・型宣言、renderer の `settingsApi`                                                                                            | 1（Step 13〜16）                  |
| `setup.ts` の `window.api` のスタブ                                                                                                          | 1（Step 15）                      |
| `usePromptListMode`（`useSavedSetting`、接頭辞 `モードの設定を保存できませんでした: `、`onChange` は `void` で捨てる薄い包み）               | 2（Step 2〜5）                    |
| `PromptListModePanelState`（`types.ts`）                                                                                                     | 2（Step 1）                       |
| `useAppState` → `App` → `Sidebar` → `PromptsPanel` の結線（`Sidebar`・`PromptsPanel` で必須。L-060）                                         | 2（Step 6〜13）                   |
| 読み込みの失敗は既定で続ける・保存の失敗は直前へ戻して固定文言（L-017）                                                                      | 2（Step 2 のテスト）              |
| `PromptListModeToggle`（1 つのボタン、`aria-pressed`、`aria-label="編集モード"` 固定、文言は現在の状態、`null` は disabled で `オフ`）       | 3（Step 1〜4）                    |
| `prompts-panel__mode-toggle`（min 32px、見た目は toolbar-button と同じ値、toolbar-button は変えない）                                        | 3（Step 1・3）                    |
| 保存の失敗は常設の `aria-live="polite"` の段落（L-153）                                                                                      | 3（Step 1・3）                    |
| トグルは 0 件・検索中でも常に出す（L-475）                                                                                                   | 3（Step 15〜18）                  |
| `PromptsPanel` は `mode === 'edit'` のときだけ `canEdit = true`（`null`・`'view'` は `false`）                                               | 3（Step 15〜19）                  |
| `PromptItem`・`PromptItemView` の `canEdit` は必須、`PromptItemView` は `false` で `編集`・`削除` を描かない（`実行`・ピン・ハンドルは残す） | 3（Step 5〜9）                    |
| `PromptItem` は `canEdit` が `false` で描画の最中に `isEditing` を戻す。変数の入力フォームは変えない                                         | 3（Step 10〜14）                  |
| 追加・インポート / エクスポート・並び替え・ピン留めは両方のモードで使える                                                                    | 3（Step 15 のテスト）             |
| 結線のテスト（`Sidebar`・`App`・`useAppState` の素通し）                                                                                     | 2（Step 6〜10）、3（Step 20〜21） |
| スタイルの検査（32px 四方以上で枠付き）                                                                                                      | 3（Step 1 の styles テスト）      |
| 実機テスト仕様書（領域の前提、`PRM-087` から、領域の最後の節、7 つの観点）                                                                   | 4（Step 2）                       |
| ROADMAP の更新、HTML の再生成、Artifact の再公開、`npx vitest run scripts`                                                                   | 4（Step 1〜4）                    |

**2. プレースホルダーの確認:** 「TBD」「後で」「適切に」「Task N と同じ」の類いは無い。コードの Step にはすべてコードを載せた。

**3. 型・名前の一致:** `PromptListMode`・`PROMPT_LIST_MODES`・`DEFAULT_PROMPT_LIST_MODE`・`isPromptListMode`・`getPromptListMode`・`setPromptListMode`・`PromptListModePanelState`（`mode` / `saveError` / `onChange`）・`usePromptListMode`・`PROMPT_LIST_MODE_SAVE_ERROR_PREFIX`・`makePromptListModePanelState`・`promptListMode`（props と `useAppState` の戻り値）・`PromptListModeToggle`（props は `state`）・`canEdit`・CSS の `prompts-panel__mode` / `prompts-panel__mode-toggle` / `prompts-panel__mode-error` は、全タスクで同じ綴り。拒否の文言 `プロンプト一覧のモードが不正です` は store・store のテスト・handler のテストで一致。
