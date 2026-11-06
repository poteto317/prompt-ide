# エージェントの許可の確認に帯のボタンで答える 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 選択中のタブのエージェント CLI(`claude`・`copilot`)が許可待ちのとき、ターミナルパネルの帯に問いの 1 行目と `許可`・`拒否` を出し、押すとその選択肢の番号キー 1 バイトを pty へ送る。

**Architecture:** renderer の純関数が画面から許可の確認(本文・問い・選択肢・カーソル・番号キーが効くか)を CLI ごとの規則で読み取り、描画用の hook(`useAgentPermissionPrompt`)が許可待ちの間だけ読み取りを控える。押した処理(`useAgentPermissionAnswer`)は描画と同じ純関数で可否を求め直し、押した時点の画面を読み直して描画の読み取りと完全一致で照合してから、専用の IPC `agentTerminal:answerPermission` に `sessionId` と番号(数)だけを渡す。main は 1〜9 の整数であることを確かめ、固定の表の 1 バイトを書く。連打の対策(1,000ms の待ち・送った後の読み直し待ち・ref の再入防止・ダブルクリックとリピートの無視)と中断との排他は、`useAgentWorkspace` が中断と答えの hook より先に作る `useAgentPermissionAnswerCooldown` で持つ。

**Tech Stack:** Electron + React 19 + TypeScript、Vitest + Testing Library、node-pty、素の CSS(`main.css`)

**設計書:** `docs/superpowers/specs/2026-11-06-agent-permission-answer-design.md`(各タスクの前に該当の節を読む。文言はすべて設計書の表と一字一句同じにする)

## Global Constraints

- **コミットしない。** このプランの各タスクに「Commit」の手順は無い(プロジェクトの CLAUDE.md の規則。コミットは後の工程でまとめて行う)。`git add -A` は使わない
- 型だけの import は `import type`。関数には戻り値の型を書く(`explicit-function-return-type`。テストの補助関数を含む)
- テストの名前(`it` の文字列)は日本語で「条件 → 期待する結果」
- `act(...).then(...)` の形で書かない。hook の非同期の結果は `await act(async () => { ... })` の中で待つ
- 偽のタイマーを使うテストは `afterEach` で `vi.clearAllTimers()` と `vi.useRealTimers()` を呼ぶ(タイマーリークの防止。CLAUDE.md)
- テストの実行は `NODE_ENV=test` を付ける(シェルの `NODE_ENV=production` で大量に落ちるため)
- 各タスクの終わりに、そのタスクで変えたファイルへ `npx eslint <パス...> --max-warnings 0` と `npm run typecheck` を通す。整形の崩れは `npx prettier --write <パス>` で直す
- 送るキーは数字の 1 バイト(`'1'`〜`'9'`)だけ。矢印キー・`Enter`・`\x1b` で始まる列は送らない(L-594)
- renderer から main へ渡すのは `sessionId` と番号(数)だけ。main は表を引く鍵にだけ使う(L-019)
- 押せない状態は `disabled` にせず `aria-disabled="true"`(L-157)
- `AGENT_PERMISSION_OPTION_NUMBER_MAX = 9`・`AGENT_PERMISSION_ANSWER_COOLDOWN_MS = 1_000`・読み上げの消える時間 3,000ms・読み直しの待ち `AGENT_ACTIVITY_SETTLE_MS`(150ms)
- 知見の ID(`$DEV_FLOW_KIT/lessons/review-lessons.md`): L-019, L-036, L-040, L-041, L-058, L-061, L-093, L-101, L-157, L-408, L-594, L-653(各タスクの「気をつける点」で該当するものを挙げる。該当のタスクの前に本文を読む)

### 設計書からの細部の変更(実装の都合。設計の意図は変えない)

- `AGENT_PERMISSION_PROMPT_READERS` は `lib/agentPermissionPrompt.ts` ではなく新しい `lib/agentPermissionPromptReaders.ts` に置く。`claudePermissionPrompt.ts` が `findAgentPermissionOption`(`agentPermissionPrompt.ts`)を使うため、表を同じファイルに置くと import が循環する。既存の `agentScreenClassifiers.ts`(判定の表)と同じ置き方
- `findAgentPermissionOption` の第 1 引数は `Pick<AgentPermissionPrompt, 'options'>`(読み取りの途中の選択肢でも使うため)。形の確かめは `isWellFormedAgentPermissionOptions` として `agentPermissionPrompt.ts` に置き、両方の CLI の読み取りが使う
- 帯のボタン 1 つ分(隠した理由の `span`・`aria-*`・ダブルクリックとリピートの無視)は `components/agent/AgentPermissionAnswerButton.tsx` に分ける(`許可`・`拒否` で同じ作りを 2 回書かないため)
- `useAgentPermissionPrompt` は、読み直し待ちのタブを**選び直した**描画では待たずにすぐ読む(設計書「選択中でないタブの読み直し待ちは、そのタブを選んだ描画の useLayoutEffect で読む」)。同じタブのまま読み直し待ちになった描画だけ、次の出力の通知の 150ms 後か 1,000ms 後の早い方まで待つ
- ボタンの名前(`aria-label`)の番号は、描画の読み取りから `findAgentPermissionOption` で引く(押せない理由があるときも名前が変わらないように)。送る番号は押した時点の判定の結果だけを使う(設計書の段階 (g) のとおり)

## ファイルの構成

| ファイル | 役割 |
| --- | --- |
| `src/shared/agentPermissionAnswer.ts`(新規) | `AGENT_PERMISSION_OPTION_NUMBER_MAX`・`AgentPermissionOptionNumber`・`isAgentPermissionOptionNumber` |
| `src/shared/types/agentTerminal.ts` | `AgentPermissionAnswerResult` |
| `src/shared/agentCliKinds.ts` | `AgentCliCapabilities.permissionAnswer`(両方 true) |
| `src/main/agentSession.ts` | `AGENT_PERMISSION_ANSWER_KEYS`・`AgentSession.answerPermission` |
| `src/main/agentSessionRegistry.ts` | `answerPermission` |
| `src/main/handlers/agentTerminalPayloadParser.ts` | `parseAgentPermissionOptionNumber` |
| `src/main/handlers/agentTerminalHandlers.ts` | `agentTerminal:answerPermission`・deps の `Pick` |
| `src/preload/api.ts`・`src/preload/index.d.ts` | `answerAgentPermission` |
| `src/renderer/src/lib/agentTerminalApi.ts` | `answerAgentPermission` |
| `src/renderer/src/lib/claudeScreenActivity.ts` | `locateClaudePermissionPrompt` の切り出しと規則の export(判定は変えない) |
| `src/renderer/src/lib/copilotScreenActivity.ts` | `locateCopilotPermissionQuestion` の切り出しと規則の export(判定は変えない) |
| `src/renderer/src/lib/agentPermissionPrompt.ts`(新規) | 型・`findAgentPermissionOption`・`isSameAgentPermissionPrompt`・`isWellFormedAgentPermissionOptions` |
| `src/renderer/src/lib/claudePermissionPrompt.ts`(新規) | `claude` の読み取り |
| `src/renderer/src/lib/copilotPermissionPrompt.ts`(新規) | `copilot` の読み取り |
| `src/renderer/src/lib/agentPermissionPromptReaders.ts`(新規) | `AGENT_PERMISSION_PROMPT_READERS` |
| `src/renderer/src/lib/agentPermissionAnswerMessages.ts`(新規) | 名前・理由・読み上げ・失敗の文言と種類ごとの表 |
| `src/renderer/src/lib/agentPermissionAnswer.ts`(新規) | `AGENT_PERMISSION_ANSWER_COOLDOWN_MS`・`getAgentPermissionAnswerAvailability`・`checkAgentPermissionAnswerAtPress` |
| `src/renderer/src/lib/agentCliMessages.ts` | 能力の名前の表に `permissionAnswer` |
| `src/renderer/src/lib/agentInterrupt.ts`・`agentInterruptMessages.ts` | `isAnsweringPermission` と理由 |
| `src/renderer/src/hooks/useAgentPermissionAnswerCooldown.ts`(新規) | タブごとの送っている途中・1,000ms・読み直し待ち |
| `src/renderer/src/hooks/useAgentPermissionPrompt.ts`(新規) | 描画に使う読み取り |
| `src/renderer/src/hooks/useAgentSessions.ts` | `answerPermission`・`AgentPermissionAnswerOutcome` |
| `src/renderer/src/hooks/useAgentPermissionAnswer.ts`(新規) | 押した処理・読み上げ・判定の入力の写像・パネルの状態 |
| `src/renderer/src/hooks/useAgentInterrupt.ts` | `isAnsweringPermission`・`isAnsweringPermissionNow`(必須) |
| `src/renderer/src/hooks/useAgentWorkspace.ts` | `AgentTerminalPanelState.permissionAnswer`(必須)の組み立てと中断との受け渡し |
| `src/renderer/src/hooks/useAgentPermissionAnswerFocus.ts`(新規) | ボタンが消えたときのフォーカスの移し先 |
| `src/renderer/src/components/agent/AgentPermissionAnswerButton.tsx`(新規) | 帯の `許可`・`拒否` のボタン 1 つ分 |
| `src/renderer/src/components/agent/AgentTerminalPanel.tsx` | 問い・2 つのボタン・読み上げの要素・`onFocus` の合成 |
| `src/renderer/src/assets/main.css` | 問いの省略の規則 |
| `src/renderer/src/__tests__/setup.ts` | `window.api.answerAgentPermission` の既定のスタブ |
| `src/renderer/src/__tests__/agentCliCapabilityOverrides.ts` | `unsupportedKinds` で `permissionAnswer` も偽にする |
| `src/renderer/src/__tests__/makeAgentSessionsState.ts`・`makeAgentTerminalPanelState.ts` | 偽物に新しい欄 |
| `ROADMAP.md`・`README.md`・`docs/developer-guide.md`・`docs/manual-test-spec.md` | 文書の更新 |

---

### Task 1: 画面から許可の確認を読み取る純関数(renderer)

**Files:**
- Create: `src/shared/agentPermissionAnswer.ts`
- Create: `src/renderer/src/lib/agentPermissionPrompt.ts`
- Create: `src/renderer/src/lib/claudePermissionPrompt.ts`
- Create: `src/renderer/src/lib/copilotPermissionPrompt.ts`
- Create: `src/renderer/src/lib/agentPermissionPromptReaders.ts`
- Modify: `src/renderer/src/lib/claudeScreenActivity.ts`(`isPermissionPrompt` の中身を `locateClaudePermissionPrompt` に移す。規則の定数と `indentOf` に `export` を付ける)
- Modify: `src/renderer/src/lib/copilotScreenActivity.ts`(`hasPermissionQuestion` の中身を `locateCopilotPermissionQuestion` に移す。`FRAME_PREFIX`・`DIALOG_TOP` に `export` を付ける)
- Test: `src/shared/__tests__/agentPermissionAnswer.test.ts`
- Test: `src/renderer/src/lib/__tests__/claudePermissionPrompt.test.ts`
- Test: `src/renderer/src/lib/__tests__/copilotPermissionPrompt.test.ts`
- Test: `src/renderer/src/lib/__tests__/agentPermissionPrompt.test.ts`
- 変えずに通ること: `src/renderer/src/lib/__tests__/claudeScreenActivity.test.ts`・`copilotScreenActivity.test.ts`

**Interfaces:**
- Produces(shared):
  - `const AGENT_PERMISSION_OPTION_NUMBER_MAX = 9`
  - `type AgentPermissionOptionNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9`
  - `function isAgentPermissionOptionNumber(value: unknown): value is AgentPermissionOptionNumber`
- Produces(`lib/agentPermissionPrompt.ts`):
  - `interface AgentPermissionOption { number: number; text: string }`
  - `interface AgentPermissionPrompt { body: readonly string[]; question: readonly string[]; options: readonly AgentPermissionOption[]; cursorNumber: number; numberKeysAccepted: boolean }`
  - `type AgentPermissionPromptReader = (lines: readonly ViewportLine[]) => AgentPermissionPrompt | null`
  - `type AgentPermissionChoice = 'allow' | 'deny'`
  - `function findAgentPermissionOption(prompt: Pick<AgentPermissionPrompt, 'options'>, choice: AgentPermissionChoice): AgentPermissionOption | null`
  - `function isSameAgentPermissionPrompt(a: AgentPermissionPrompt, b: AgentPermissionPrompt): boolean`
  - `function isWellFormedAgentPermissionOptions(options: readonly AgentPermissionOption[], cursorNumbers: readonly number[]): boolean`
- Produces(読み取り):
  - `readClaudePermissionPrompt: AgentPermissionPromptReader`(`lib/claudePermissionPrompt.ts`)
  - `readCopilotPermissionPrompt: AgentPermissionPromptReader`(`lib/copilotPermissionPrompt.ts`)
  - `const AGENT_PERMISSION_PROMPT_READERS: Record<AgentCliKind, AgentPermissionPromptReader>`(`lib/agentPermissionPromptReaders.ts`)
- Produces(位置の特定):
  - `interface ClaudePermissionPromptLocation { cursorRow: number; numberColumn: number; questionFirst: number; questionLast: number }`
  - `function locateClaudePermissionPrompt(texts: readonly string[]): ClaudePermissionPromptLocation | null`
  - `interface CopilotPermissionQuestionLocation { hintRow: number; questionRow: number }`
  - `function locateCopilotPermissionQuestion(texts: readonly string[]): CopilotPermissionQuestionLocation | null`

**気をつける点:**
- L-041: 番号の意味は画面の状態(カーソルが入力欄の選択肢にあるか・`Tab to amend` の有無)で変わる。`numberKeysAccepted` を CLI ごとの規則で決め、`claude` の規則で `copilot` の画面を読まない(表で引く)。読み取りと活動の判定が台帳の全画面で一致することをテストで固定する
- L-036: 照合は本文の行・問いの行・選択肢の `{ 番号, 文言 }` の並びの完全一致。件数では比べない。`cursorNumber`・`numberKeysAccepted` は照合に入れない
- 既存の判定(`classifyClaudeScreen`・`classifyCopilotScreen`)の結果は変えない。`claudeScreenActivity.test.ts`・`copilotScreenActivity.test.ts` は手を入れずに通ること

- [ ] **Step 1: 失敗するテストを書く(shared の番号の型)**

```ts
// src/shared/__tests__/agentPermissionAnswer.test.ts
import { describe, it, expect } from 'vitest'
import {
  AGENT_PERMISSION_OPTION_NUMBER_MAX,
  isAgentPermissionOptionNumber
} from '../agentPermissionAnswer'

describe('isAgentPermissionOptionNumber', () => {
  it('上限は 9(copilot は 10 以上の選択肢で 1 桁目の後に待つため。設計書「調べて分かったこと」)', () => {
    expect(AGENT_PERMISSION_OPTION_NUMBER_MAX).toBe(9)
  })

  it.each([1, 2, 5, 9])('%d は番号', (value) => {
    expect(isAgentPermissionOptionNumber(value)).toBe(true)
  })

  it.each([0, 10, 1.5, -1, NaN, Infinity, -Infinity, '1', null, undefined, {}, [1], true])(
    '%o は番号でない',
    (value) => {
      expect(isAgentPermissionOptionNumber(value)).toBe(false)
    }
  )
})
```

- [ ] **Step 2: 失敗するテストを書く(claude の読み取り)**

```ts
// src/renderer/src/lib/__tests__/claudePermissionPrompt.test.ts
import { describe, it, expect } from 'vitest'
import { readClaudePermissionPrompt } from '../claudePermissionPrompt'
import { classifyClaudeScreen, locateClaudePermissionPrompt } from '../claudeScreenActivity'
import { findAgentPermissionOption } from '../agentPermissionPrompt'
import type { AgentPermissionPrompt } from '../agentPermissionPrompt'
import { lineText } from '../agentViewport'
import type { ViewportLine } from '../agentViewport'
import { agentScreen, makeLine } from './fixtures/agentScreens'

const linesOf = (rows: readonly string[]): ViewportLine[] => rows.map((row) => makeLine(row))

interface HandScreenOptions {
  question?: readonly string[]
  hint?: string
}

/**
 * 手書きの claude の許可の画面。1 行目の全幅の罫線より下が許可の画面(入力欄の罫線の組にならないよう罫線は 1 本だけ)。
 * 既定は記録の画面と同じく案内が ` Esc to cancel · Tab to amend`
 */
function claudePrompt(
  options: readonly string[],
  { question = [' Do you want to proceed?'], hint = ' Esc to cancel · Tab to amend' }: HandScreenOptions = {}
): ViewportLine[] {
  return linesOf(['─'.repeat(60), ' Bash command', ' sleep 3', '', ...question, ...options, '', hint])
}

const read = (lines: readonly ViewportLine[]): AgentPermissionPrompt => {
  // 手書きの画面が許可待ちの画面であることを先に確かめる(読み取りは判定が permission のときだけ値を返す)
  expect(classifyClaudeScreen(lines)).toBe('permission')
  const prompt = readClaudePermissionPrompt(lines)
  expect(prompt).not.toBeNull()
  return prompt as AgentPermissionPrompt
}

describe('locateClaudePermissionPrompt', () => {
  it('記録の permission の画面で、カーソルの行・番号の桁・問いの範囲を返す', () => {
    const texts = agentScreen('permission').lines.map(lineText)
    expect(locateClaudePermissionPrompt(texts)).toEqual({
      cursorRow: 18,
      numberColumn: 3,
      questionFirst: 17,
      questionLast: 17
    })
  })

  it('入力待ちの画面では null', () => {
    expect(locateClaudePermissionPrompt(agentScreen('empty').lines.map(lineText))).toBeNull()
  })
})

describe('readClaudePermissionPrompt: 記録の画面(台帳での読み取りの期待)', () => {
  it.each(['permission', 'permissionAfterClear'] as const)(
    '%s: 本文・問い・4 つの選択肢・カーソル 1・番号キーが効く・許可 1・拒否 4',
    (name) => {
      const prompt = read(agentScreen(name).lines)
      expect(prompt.body).toEqual([
        'Bash command',
        'Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
        'fake',
        'echo hi > out.txt'
      ])
      expect(prompt.question).toEqual(['Do you want to proceed?'])
      expect(prompt.options.map((option) => option.number)).toEqual([1, 2, 3, 4])
      expect(prompt.options[0].text).toBe('Yes')
      // 2 番は 2 行に折り返した文言を、字下げを除いて半角空白 1 つでつなぐ
      expect(prompt.options[1].text).toMatch(/^Yes, and always allow access to \S+ \S+ from this project$/)
      expect(prompt.options[2].text).toBe(
        'Yes, and switch to auto mode · auto mode handles these prompts for you'
      )
      expect(prompt.options[3].text).toBe('No')
      expect(prompt.cursorNumber).toBe(1)
      expect(prompt.numberKeysAccepted).toBe(true)
      expect(findAgentPermissionOption(prompt, 'allow')?.number).toBe(1)
      expect(findAgentPermissionOption(prompt, 'deny')?.number).toBe(4)
    }
  )

  it('許可待ちでない画面(入力待ち・作業中・確認待ち)は null', () => {
    expect(readClaudePermissionPrompt(agentScreen('empty').lines)).toBeNull()
    expect(readClaudePermissionPrompt(agentScreen('working').lines)).toBeNull()
    expect(readClaudePermissionPrompt(agentScreen('trust').lines)).toBeNull()
  })
})

describe('readClaudePermissionPrompt: 手書きの画面', () => {
  it('問いが 2 行に折り返しても、問いの行を 2 つ読む', () => {
    const prompt = read(
      claudePrompt([' ❯ 1. Yes', '   2. No'], {
        question: [' Do you want to make this edit to', ' a-very-long-file-name-for-wrapping.md?']
      })
    )
    expect(prompt.question).toEqual([
      'Do you want to make this edit to',
      'a-very-long-file-name-for-wrapping.md?'
    ])
    expect(prompt.body).toEqual(['Bash command', 'sleep 3'])
  })

  it('カーソルが 2 番(Yes・No 以外)で Tab to amend が無い → 番号キーが効かない', () => {
    const prompt = read(
      claudePrompt(['   1. Yes', " ❯ 2. Yes, and don't ask again for: sleep", '   3. No'], {
        hint: ' Esc to cancel'
      })
    )
    expect(prompt.cursorNumber).toBe(2)
    expect(prompt.numberKeysAccepted).toBe(false)
  })

  it('カーソルが 2 番(Yes・No 以外)なら、Tab to amend があっても番号キーが効かない', () => {
    const prompt = read(
      claudePrompt(['   1. Yes', " ❯ 2. Yes, and don't ask again for: sleep", '   3. No'])
    )
    expect(prompt.numberKeysAccepted).toBe(false)
  })

  it('カーソルが 1 番でも Tab to amend が無い(入力の形・読み上げのモード) → 番号キーが効かない', () => {
    const prompt = read(claudePrompt([' ❯ 1. Yes', '   2. No'], { hint: ' Esc to cancel' }))
    expect(prompt.cursorNumber).toBe(1)
    expect(prompt.numberKeysAccepted).toBe(false)
  })

  it('カーソルが No にあって Tab to amend がある → 番号キーが効く', () => {
    const prompt = read(claudePrompt(['   1. Yes', ' ❯ 2. No']))
    expect(prompt.cursorNumber).toBe(2)
    expect(prompt.numberKeysAccepted).toBe(true)
  })

  it('選択肢が 10 ある → null(1 桁の番号で即決しない)', () => {
    const options = Array.from({ length: 10 }, (_, index) =>
      index === 0 ? ' ❯ 1. Yes' : `   ${index + 1}. Option ${index + 1}`
    )
    expect(readClaudePermissionPrompt(claudePrompt(options))).toBeNull()
  })

  it('番号が欠ける(1・3) → null', () => {
    expect(readClaudePermissionPrompt(claudePrompt([' ❯ 1. Yes', '   3. No']))).toBeNull()
  })

  it('カーソルの行が 2 つ → null', () => {
    expect(readClaudePermissionPrompt(claudePrompt([' ❯ 1. Yes', ' ❯ 2. No']))).toBeNull()
  })

  it('Yes が 2 つ → 許可の選択肢は null、拒否は 3 番', () => {
    const prompt = read(claudePrompt([' ❯ 1. Yes', '   2. Yes', '   3. No']))
    expect(findAgentPermissionOption(prompt, 'allow')).toBeNull()
    expect(findAgentPermissionOption(prompt, 'deny')?.number).toBe(3)
  })

  it('No が無い → 拒否の選択肢は null', () => {
    const prompt = read(claudePrompt([' ❯ 1. Yes', "   2. Yes, and don't ask again for: sleep"]))
    expect(findAgentPermissionOption(prompt, 'deny')).toBeNull()
  })

  it('Nothing で始まる選択肢は拒否にしない', () => {
    const prompt = read(claudePrompt([' ❯ 1. Yes', '   2. Nothing to do']))
    expect(findAgentPermissionOption(prompt, 'deny')).toBeNull()
  })
})
```

- [ ] **Step 3: 失敗するテストを書く(copilot の読み取り)**

```ts
// src/renderer/src/lib/__tests__/copilotPermissionPrompt.test.ts
import { describe, it, expect } from 'vitest'
import { readCopilotPermissionPrompt } from '../copilotPermissionPrompt'
import { classifyCopilotScreen, locateCopilotPermissionQuestion } from '../copilotScreenActivity'
import { copilotScreenTexts } from '../copilotInputBox'
import { findAgentPermissionOption } from '../agentPermissionPrompt'
import type { AgentPermissionPrompt } from '../agentPermissionPrompt'
import type { ViewportLine } from '../agentViewport'
import { makeLine } from './fixtures/agentScreens'
import { copilotScreen } from './fixtures/copilotScreens'

const NO_OPTION = 'No, and tell Copilot what to do differently (Esc to stop)'

/** 手書きの copilot の許可の画面(外枠の中に本文・問い・選択肢・案内)。右の枠は省く(読み取りは行末の枠と空白を除く) */
function copilotPrompt(
  optionRows: readonly string[],
  questionRows: readonly string[] = ['Do you want to run this command?']
): ViewportLine[] {
  return [
    '╭────────────────────────────────────────╮',
    '│ Run a command',
    '│ sleep 3',
    '│',
    ...questionRows.map((row) => `│ ${row}`),
    '│',
    ...optionRows.map((row) => `│ ${row}`),
    '│',
    '│ ↑/↓ to navigate · enter to select · esc to cancel',
    '╰────────────────────────────────────────╯'
  ].map((row) => makeLine(row))
}

const read = (lines: readonly ViewportLine[]): AgentPermissionPrompt => {
  expect(classifyCopilotScreen(lines)).toBe('permission')
  const prompt = readCopilotPermissionPrompt(lines)
  expect(prompt).not.toBeNull()
  return prompt as AgentPermissionPrompt
}

describe('locateCopilotPermissionQuestion', () => {
  it('記録の permission の画面で、案内の行と問いの行を返す', () => {
    expect(locateCopilotPermissionQuestion(copilotScreenTexts(copilotScreen('permission').lines))).toEqual(
      { hintRow: 28, questionRow: 23 }
    )
  })

  it('入力待ちの画面では null', () => {
    expect(locateCopilotPermissionQuestion(copilotScreenTexts(copilotScreen('idle').lines))).toBeNull()
  })
})

describe('readCopilotPermissionPrompt: 記録の画面(台帳での読み取りの期待)', () => {
  it.each([
    ['permission', 1, true],
    ['permissionDown', 2, false]
  ] as const)('%s: 本文 2 行・2 つの選択肢・カーソル %d・番号キー %s・許可 1・拒否 2', (name, cursor, keys) => {
    const prompt = read(copilotScreen(name).lines)
    expect(prompt.body).toEqual(['Write a file', 'echo hi > out.txt'])
    expect(prompt.question).toEqual(['Do you want to run this command?'])
    expect(prompt.options).toEqual([
      { number: 1, text: 'Yes' },
      { number: 2, text: NO_OPTION }
    ])
    expect(prompt.cursorNumber).toBe(cursor)
    expect(prompt.numberKeysAccepted).toBe(keys)
    expect(findAgentPermissionOption(prompt, 'allow')?.number).toBe(1)
    expect(findAgentPermissionOption(prompt, 'deny')?.number).toBe(2)
  })

  it('permission3: 本文 Wait a bit・sleep 8、3 つの選択肢、許可 1・拒否 3', () => {
    const prompt = read(copilotScreen('permission3').lines)
    expect(prompt.body).toEqual(['Wait a bit', 'sleep 8'])
    expect(prompt.options.map((option) => option.number)).toEqual([1, 2, 3])
    expect(prompt.options[1].text).toMatch(/^Yes, and don't ask again for `sleep` in this directory/)
    expect(prompt.options[2].text).toBe(NO_OPTION)
    expect(prompt.cursorNumber).toBe(1)
    expect(prompt.numberKeysAccepted).toBe(true)
    expect(findAgentPermissionOption(prompt, 'allow')?.number).toBe(1)
    expect(findAgentPermissionOption(prompt, 'deny')?.number).toBe(3)
  })

  it.each([
    ['srPermission', 1, true],
    ['srPermissionDown', 2, false]
  ] as const)(
    '%s(読み上げのモード): 本文は内側のコマンドの枠の中だけ・カーソル %d・番号キー %s',
    (name, cursor, keys) => {
      const prompt = read(copilotScreen(name).lines)
      expect(prompt.body).toEqual(['echo hi > out.txt'])
      expect(prompt.question).toEqual(['Do you want to run this command?'])
      expect(prompt.options).toEqual([
        { number: 1, text: 'Yes' },
        { number: 2, text: NO_OPTION }
      ])
      expect(prompt.cursorNumber).toBe(cursor)
      expect(prompt.numberKeysAccepted).toBe(keys)
    }
  )

  it('許可待ちでない画面(入力待ち・作業中・フォルダの信頼の確認)は null', () => {
    expect(readCopilotPermissionPrompt(copilotScreen('idle').lines)).toBeNull()
    expect(readCopilotPermissionPrompt(copilotScreen('working250').lines)).toBeNull()
    expect(readCopilotPermissionPrompt(copilotScreen('trust').lines)).toBeNull()
  })
})

describe('readCopilotPermissionPrompt: 手書きの画面', () => {
  it('選択肢の折り返しの行は、直前の選択肢の文言に半角空白 1 つでつなぐ', () => {
    const prompt = read(
      copilotPrompt(['❯ 1. Yes', '  2. No, and tell Copilot what to do', '     differently (Esc to stop)'])
    )
    expect(prompt.options).toEqual([
      { number: 1, text: 'Yes' },
      { number: 2, text: NO_OPTION }
    ])
    expect(prompt.body).toEqual(['Run a command', 'sleep 3'])
  })

  it('最初の選択肢の行より前の、選択肢でない行は問いの折り返し', () => {
    const prompt = read(
      copilotPrompt(['❯ 1. Yes', `  2. ${NO_OPTION}`], ['Do you want to run this', 'long command?'])
    )
    expect(prompt.question).toEqual(['Do you want to run this', 'long command?'])
  })

  it('入力欄に文を入れた最後の選択肢(文言が No で始まらない) → 拒否は null・番号キーが効かない', () => {
    const prompt = read(copilotPrompt(['  1. Yes', '❯ 2. Do nothing and stop']))
    expect(prompt.cursorNumber).toBe(2)
    expect(prompt.numberKeysAccepted).toBe(false)
    expect(findAgentPermissionOption(prompt, 'deny')).toBeNull()
  })

  it('カーソルの行が無い → null', () => {
    expect(readCopilotPermissionPrompt(copilotPrompt(['  1. Yes', `  2. ${NO_OPTION}`]))).toBeNull()
  })
})
```

- [ ] **Step 4: 失敗するテストを書く(型・照合・表・全画面の一致)**

```ts
// src/renderer/src/lib/__tests__/agentPermissionPrompt.test.ts
import { describe, it, expect } from 'vitest'
import {
  findAgentPermissionOption,
  isSameAgentPermissionPrompt,
  isWellFormedAgentPermissionOptions
} from '../agentPermissionPrompt'
import type { AgentPermissionPrompt } from '../agentPermissionPrompt'
import { AGENT_PERMISSION_PROMPT_READERS } from '../agentPermissionPromptReaders'
import { readClaudePermissionPrompt } from '../claudePermissionPrompt'
import { readCopilotPermissionPrompt } from '../copilotPermissionPrompt'
import { classifyClaudeScreen } from '../claudeScreenActivity'
import { classifyCopilotScreen } from '../copilotScreenActivity'
import { agentScreen } from './fixtures/agentScreens'
import type { AgentScreenName } from './fixtures/agentScreens'
import { copilotScreen } from './fixtures/copilotScreens'
import type { CopilotScreenName } from './fixtures/copilotScreens'
import agentData from './fixtures/agentScreens.json'
import copilotData from './fixtures/copilotScreens.json'

const BASE: AgentPermissionPrompt = {
  body: ['Bash command', 'sleep 3'],
  question: ['Do you want to proceed?'],
  options: [
    { number: 1, text: 'Yes' },
    { number: 2, text: 'No' }
  ],
  cursorNumber: 1,
  numberKeysAccepted: true
}

describe('findAgentPermissionOption', () => {
  it('allow は文言がちょうど Yes の選択肢', () => {
    expect(findAgentPermissionOption(BASE, 'allow')).toEqual({ number: 1, text: 'Yes' })
  })

  it.each(['No', 'No, and tell Copilot what to do differently (Esc to stop)'])(
    'deny は No そのものか No, で始まる選択肢: %s',
    (text) => {
      const prompt = { options: [{ number: 1, text: 'Yes' }, { number: 2, text }] }
      expect(findAgentPermissionOption(prompt, 'deny')).toEqual({ number: 2, text })
    }
  )

  it.each(['Yes, and always allow access', 'Yes, and switch to auto mode', 'yes'])(
    '「今後は確かめない」系・大文字小文字の違う %s は allow にしない',
    (text) => {
      expect(findAgentPermissionOption({ options: [{ number: 1, text }] }, 'allow')).toBeNull()
    }
  )

  it.each(['Not now', 'Nothing', 'Nope', 'no'])('%s は deny にしない', (text) => {
    expect(findAgentPermissionOption({ options: [{ number: 1, text }] }, 'deny')).toBeNull()
  })

  it('当たる選択肢が 2 つ以上なら null', () => {
    const prompt = {
      options: [
        { number: 1, text: 'No' },
        { number: 2, text: 'No, thanks' }
      ]
    }
    expect(findAgentPermissionOption(prompt, 'deny')).toBeNull()
  })
})

describe('isSameAgentPermissionPrompt', () => {
  it('claude の permission と permissionAfterClear は同じ', () => {
    const a = readClaudePermissionPrompt(agentScreen('permission').lines)
    const b = readClaudePermissionPrompt(agentScreen('permissionAfterClear').lines)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(isSameAgentPermissionPrompt(a as AgentPermissionPrompt, b as AgentPermissionPrompt)).toBe(true)
  })

  it('カーソルだけが違う copilot の permission と permissionDown は同じ(カーソル・番号キーは比べない)', () => {
    const a = readCopilotPermissionPrompt(copilotScreen('permission').lines)
    const b = readCopilotPermissionPrompt(copilotScreen('permissionDown').lines)
    expect(isSameAgentPermissionPrompt(a as AgentPermissionPrompt, b as AgentPermissionPrompt)).toBe(true)
  })

  it.each<[string, Partial<AgentPermissionPrompt>]>([
    ['本文の 1 行(コマンド)', { body: ['Bash command', 'rm -rf build'] }],
    ['本文の行の数', { body: ['Bash command'] }],
    ['問い', { question: ['Do you want to make this edit?'] }],
    ['選択肢の文言', { options: [{ number: 1, text: 'Yes' }, { number: 2, text: 'No, wait' }] }],
    ['選択肢の番号', { options: [{ number: 1, text: 'Yes' }, { number: 3, text: 'No' }] }],
    // 件数が同じで文言が入れ替わる(L-036)
    ['文言の入れ替わり', { options: [{ number: 1, text: 'No' }, { number: 2, text: 'Yes' }] }],
    ['選択肢の数', { options: [{ number: 1, text: 'Yes' }] }]
  ])('%s が違えば違う', (_name, change) => {
    expect(isSameAgentPermissionPrompt(BASE, { ...BASE, ...change })).toBe(false)
  })

  it('cursorNumber・numberKeysAccepted だけが違えば同じ', () => {
    expect(
      isSameAgentPermissionPrompt(BASE, { ...BASE, cursorNumber: 2, numberKeysAccepted: false })
    ).toBe(true)
  })
})

describe('isWellFormedAgentPermissionOptions', () => {
  const options = (...numbers: number[]): { number: number; text: string }[] =>
    numbers.map((number) => ({ number, text: `o${number}` }))

  it('1 から欠けずに並び、9 以下で、カーソルが 1 つなら真', () => {
    expect(isWellFormedAgentPermissionOptions(options(1, 2, 3), [2])).toBe(true)
    expect(isWellFormedAgentPermissionOptions(options(1, 2, 3, 4, 5, 6, 7, 8, 9), [1])).toBe(true)
  })

  it.each<[string, number[], number[]]>([
    ['選択肢が無い', [], []],
    ['1 から始まらない', [2, 3], [2]],
    ['欠ける', [1, 3], [1]],
    ['10 以上', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1]],
    ['カーソルが無い', [1, 2], []],
    ['カーソルが 2 つ', [1, 2], [1, 2]]
  ])('%s → 偽', (_name, numbers, cursors) => {
    expect(isWellFormedAgentPermissionOptions(options(...numbers), cursors)).toBe(false)
  })
})

describe('AGENT_PERMISSION_PROMPT_READERS', () => {
  it('種類ごとの読み取りを引く', () => {
    expect(AGENT_PERMISSION_PROMPT_READERS.claude).toBe(readClaudePermissionPrompt)
    expect(AGENT_PERMISSION_PROMPT_READERS.copilot).toBe(readCopilotPermissionPrompt)
  })

  // 判定と読み取りがずれないこと(L-041)。台帳に画面が増えても、この 2 つは自動で全画面を見る
  it.each(Object.keys(agentData.screens) as AgentScreenName[])(
    'claude の %s: 読み取りが null でないことと、判定が permission であることが一致する',
    (name) => {
      const { lines } = agentScreen(name)
      expect(AGENT_PERMISSION_PROMPT_READERS.claude(lines) !== null).toBe(
        classifyClaudeScreen(lines) === 'permission'
      )
    }
  )

  it.each(Object.keys(copilotData.screens) as CopilotScreenName[])(
    'copilot の %s: 読み取りが null でないことと、判定が permission であることが一致する',
    (name) => {
      const { lines } = copilotScreen(name)
      expect(AGENT_PERMISSION_PROMPT_READERS.copilot(lines) !== null).toBe(
        classifyCopilotScreen(lines) === 'permission'
      )
    }
  )
})
```

- [ ] **Step 5: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/shared/__tests__/agentPermissionAnswer.test.ts src/renderer/src/lib/__tests__/claudePermissionPrompt.test.ts src/renderer/src/lib/__tests__/copilotPermissionPrompt.test.ts src/renderer/src/lib/__tests__/agentPermissionPrompt.test.ts`
Expected: FAIL(`../agentPermissionAnswer`・`../claudePermissionPrompt` などが無い。`locateClaudePermissionPrompt` が export されていない)

- [ ] **Step 6: shared の番号の型を実装する**

```ts
// src/shared/agentPermissionAnswer.ts
// 許可の確認への帯からの答え(設計書 2026-11-06「IPC」)の、選択肢の番号の型と検証。main の受け口(1〜9 の整数であることの確かめ)と
// renderer の読み取り(10 以上の選択肢の画面は読み取らない)が同じ上限を使う

/** 選択肢の番号の上限。copilot は 10 以上の選択肢では 1 桁目の後に複数桁の番号を 500ms 待つため、即決するのは 9 まで */
export const AGENT_PERMISSION_OPTION_NUMBER_MAX = 9

export type AgentPermissionOptionNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/** 1〜AGENT_PERMISSION_OPTION_NUMBER_MAX の整数か(小数・NaN・Infinity・文字列の数字は偽。L-019) */
export function isAgentPermissionOptionNumber(value: unknown): value is AgentPermissionOptionNumber {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= AGENT_PERMISSION_OPTION_NUMBER_MAX
  )
}
```

- [ ] **Step 7: claude の位置の特定を切り出す(`claudeScreenActivity.ts`)**

1. 定数の宣言に `export` を付ける: `PERMISSION_CURSOR_OPTION`・`NUMBERED_LINE`・`RULE_LINE`(値は変えない)。`indentOf` も `export const indentOf = ...` にする
2. `isPermissionPrompt` を次のように置き換える(中の規則・順は変えない。`some` を `for` に直し、当たった位置を返す)

```ts
/** 許可の確認の画面の位置(カーソルのある選択肢の行・番号の桁・問いの段落の最初と最後の行) */
export interface ClaudePermissionPromptLocation {
  cursorRow: number
  /** 番号の桁(カーソルの行の `\s+❯\s*` の長さ。ほかの選択肢の行の字下げと同じ) */
  numberColumn: number
  questionFirst: number
  questionLast: number
}

/**
 * 許可の確認の並び: カーソルのある番号付きの選択肢の行から上へ、空行・番号付きの選択肢の行(番号がカーソルの行と同じ桁から始まる行。問いの折り返しの `2.md?` を除くため。
 * ローカルレビュー第 14 周)とその折り返しの行(番号の桁より深く字下げされた行)を飛ばした先の段落が問い。段落は、最初に当たった空でない行から上へ、番号の桁と同じかそれより浅い字下げの
 * 空でない行(罫線の行を除く)が続く間で、問いが画面の幅を超えると claude が 1 行目と同じ字下げで折り返すため(ローカルレビュー
 * 第 12 周)。段落の先頭の行が `Do you want to ` で始まり、最後の行(選択肢の直上)が `?` で終わるときだけ許可待ちとする。
 * 問いの行と選択肢の行を画面全体から別々に探すと、履歴に残る `❯ 1. …` のプロンプトや応答の継続行の `  Do you want to …` で
 * 許可待ちと誤るため(ローカルレビュー第 11 周)。判定(isPermissionPrompt)と読み取り(claudePermissionPrompt.ts)が同じ位置を使う
 * (設計書 2026-11-06「選択肢の読み取り」)。上から最初に当たったカーソルの行の位置を返す
 */
export function locateClaudePermissionPrompt(
  texts: readonly string[]
): ClaudePermissionPromptLocation | null {
  for (let y = 0; y < texts.length; y++) {
    const cursor = PERMISSION_CURSOR_OPTION.exec(texts[y])
    if (cursor === null) continue
    const numberColumn = cursor[1].length
    const inParagraph = (line: string): boolean =>
      line.trim() !== '' && !RULE_LINE.test(line) && indentOf(line) <= numberColumn
    let last = y - 1
    while (
      last >= 0 &&
      (texts[last].trim() === '' ||
        (NUMBERED_LINE.test(texts[last]) && indentOf(texts[last]) === numberColumn) ||
        indentOf(texts[last]) > numberColumn)
    ) {
      last--
    }
    if (last < 0 || !inParagraph(texts[last])) continue
    let first = last
    while (first > 0 && inParagraph(texts[first - 1])) first--
    if (PERMISSION_QUESTION.test(texts[first]) && texts[last].trimEnd().endsWith('?')) {
      return { cursorRow: y, numberColumn, questionFirst: first, questionLast: last }
    }
  }
  return null
}

function isPermissionPrompt(texts: readonly string[]): boolean {
  return locateClaudePermissionPrompt(texts) !== null
}
```

`RULE_LINE` の宣言は `locateClaudePermissionPrompt` より前にある(今の位置のまま)。

- [ ] **Step 8: copilot の位置の特定を切り出す(`copilotScreenActivity.ts`)**

1. `FRAME_PREFIX`・`DIALOG_TOP` の宣言に `export` を付ける(値は変えない)
2. `hasPermissionQuestion` を次のように置き換える

```ts
/** 許可の確認の画面の位置(選択の案内の行と、許可の問いの行) */
export interface CopilotPermissionQuestionLocation {
  hintRow: number
  questionRow: number
}

/**
 * 選択の案内の行から上へ、外枠の上端(行頭の ╭)に当たるまでの間に、枠の縦線と空白を除くと許可の問いで始まる行を探す。
 * 判定(hasPermissionQuestion)と読み取り(copilotPermissionPrompt.ts)が同じ位置を使う(設計書 2026-11-06「選択肢の読み取り」)。
 * 上から最初に当たった案内の行の位置を返す
 */
export function locateCopilotPermissionQuestion(
  texts: readonly string[]
): CopilotPermissionQuestionLocation | null {
  for (let y = 0; y < texts.length; y++) {
    if (!SELECTION_HINT.test(texts[y])) continue
    for (let above = y - 1; above >= 0; above--) {
      if (DIALOG_TOP.test(texts[above])) break
      if (PERMISSION_QUESTION.test(texts[above].replace(FRAME_PREFIX, ''))) {
        return { hintRow: y, questionRow: above }
      }
    }
  }
  return null
}

function hasPermissionQuestion(texts: readonly string[]): boolean {
  return locateCopilotPermissionQuestion(texts) !== null
}
```

- [ ] **Step 9: 型・照合・形の確かめを実装する(`agentPermissionPrompt.ts`)**

```ts
// src/renderer/src/lib/agentPermissionPrompt.ts
import { AGENT_PERMISSION_OPTION_NUMBER_MAX } from '@shared/agentPermissionAnswer'
import type { ViewportLine } from './agentViewport'

// 画面から読み取った許可の確認の型と、CLI に依らない規則(帯の 許可・拒否 に使う選択肢・描画と押した時点の照合・形の確かめ)。
// 設計書 2026-11-06「選択肢の読み取り」。CLI ごとの読み取りは claudePermissionPrompt.ts・copilotPermissionPrompt.ts、
// 種類ごとの表は agentPermissionPromptReaders.ts(このファイルに置くと読み取りの import と循環するため)

export interface AgentPermissionOption {
  /** 画面の番号(1〜AGENT_PERMISSION_OPTION_NUMBER_MAX) */
  number: number
  /** 番号の後の文言。折り返しの行は字下げを除いて半角空白 1 つでつなぐ(照合と Yes・No の判定にだけ使う) */
  text: string
}

export interface AgentPermissionPrompt {
  /** 問いの上の、許可の画面の中の行(コマンドなど。枠と前後の空白を除き、空の行は除く)。照合にだけ使う */
  body: readonly string[]
  /** 問いの行(前後の空白を除く)。帯に出すのは 1 行目 */
  question: readonly string[]
  /** 番号の順(1 から欠けずに並ぶ) */
  options: readonly AgentPermissionOption[]
  /** カーソルのある選択肢の番号 */
  cursorNumber: number
  /** 今の画面で、番号キーが選択肢の選択として効くか(CLI ごとの規則。L-041) */
  numberKeysAccepted: boolean
}

/** 画面の行から許可の確認を読み取る。許可待ちの画面でない・形が崩れているなら null。例外は投げない */
export type AgentPermissionPromptReader = (
  lines: readonly ViewportLine[]
) => AgentPermissionPrompt | null

export type AgentPermissionChoice = 'allow' | 'deny'

/**
 * 帯のボタンに使う選択肢の規則。allow は文言がちょうど `Yes`(「今後は確かめない」系の `Yes, and …` を許可にしない)、
 * deny は `No` そのものか `No,` で始まる(`Not now`・`Nothing` に当てない)
 */
const CHOICE_RULES: Record<AgentPermissionChoice, (text: string) => boolean> = {
  allow: (text) => text === 'Yes',
  deny: (text) => /^No(?:,|$)/.test(text)
}

/** 規則に当たる選択肢がちょうど 1 つのときだけ返す。無い・複数なら null */
export function findAgentPermissionOption(
  prompt: Pick<AgentPermissionPrompt, 'options'>,
  choice: AgentPermissionChoice
): AgentPermissionOption | null {
  const matched = prompt.options.filter((option) => CHOICE_RULES[choice](option.text))
  return matched.length === 1 ? matched[0] : null
}

const sameLines = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((line, index) => line === b[index])

/**
 * 本文・問い・選択肢の {番号, 文言} の並びの完全一致(件数ではなく中身で比べる。L-036)。cursorNumber・numberKeysAccepted は
 * 比べない(押した時点の値で別に確かめる)
 */
export function isSameAgentPermissionPrompt(
  a: AgentPermissionPrompt,
  b: AgentPermissionPrompt
): boolean {
  return (
    sameLines(a.body, b.body) &&
    sameLines(a.question, b.question) &&
    a.options.length === b.options.length &&
    a.options.every(
      (option, index) =>
        option.number === b.options[index].number && option.text === b.options[index].text
    )
  )
}

/** 形の確かめ: 番号が 1 から欠けずに並び、上限以下で、カーソルの行がちょうど 1 つ */
export function isWellFormedAgentPermissionOptions(
  options: readonly AgentPermissionOption[],
  cursorNumbers: readonly number[]
): boolean {
  return (
    options.length > 0 &&
    options.length <= AGENT_PERMISSION_OPTION_NUMBER_MAX &&
    options.every((option, index) => option.number === index + 1) &&
    cursorNumbers.length === 1
  )
}
```

- [ ] **Step 10: claude の読み取りを実装する(`claudePermissionPrompt.ts`)**

```ts
// src/renderer/src/lib/claudePermissionPrompt.ts
import type { AgentPermissionOption, AgentPermissionPrompt } from './agentPermissionPrompt'
import {
  findAgentPermissionOption,
  isWellFormedAgentPermissionOptions
} from './agentPermissionPrompt'
import type { ViewportLine } from './agentViewport'
import { lineText } from './agentViewport'
import {
  NUMBERED_LINE,
  PERMISSION_CURSOR_OPTION,
  RULE_LINE,
  classifyClaudeScreen,
  indentOf,
  locateClaudePermissionPrompt
} from './claudeScreenActivity'

// claude の許可の確認の読み取り(設計書 2026-11-06「claude」)。claude 2.1.288 の画面で記録した(agentScreens.json)。
// 位置の特定は判定と同じ locateClaudePermissionPrompt(規則の定数は claudeScreenActivity.ts の 1 か所)。判定が permission の画面だけ読む
// (入力欄のある画面を許可待ちとしない規則も判定に任せる)。例外は投げない

/** 選択肢の行の番号と文言(カーソルの印は飛ばす) */
const OPTION_TEXT = /^\s*(?:❯\s*)?(\d+)\.\s*(.*)$/
/**
 * 本文の上の端: 許可の画面の上の全幅の罫線(字下げの無い、─ だけの行。texts は末尾の空白を除いた値なので trim せずに当てる)。
 * 字下げした ─ だけの行(heredoc の Markdown の区切りなど)と ╌ の区切りは本文の中の行
 */
const FULL_WIDTH_RULE = /^─+$/
/** 番号キーが選択肢の選択として効く画面の案内(カーソルが Yes・No にあり、まだ入力の形でないときだけ出る) */
const AMEND_HINT = 'Tab to amend'

interface OptionDraft {
  number: number
  parts: string[]
}

/** questionFirst から上へ、最初の全幅の罫線の直後から問いの手前まで(罫線が無ければ画面の先頭から)。空の行と罫線だけの行は除く */
function readBody(texts: readonly string[], questionFirst: number): string[] {
  let start = 0
  for (let y = questionFirst - 1; y >= 0; y--) {
    if (FULL_WIDTH_RULE.test(texts[y])) {
      start = y + 1
      break
    }
  }
  return texts
    .slice(start, questionFirst)
    .filter((text) => text.trim() !== '' && !RULE_LINE.test(text))
    .map((text) => text.trim())
}

export function readClaudePermissionPrompt(
  lines: readonly ViewportLine[]
): AgentPermissionPrompt | null {
  if (classifyClaudeScreen(lines) !== 'permission') return null
  // アプリの画面の行は列の数まで空白で埋まるので末尾の空白を除く(字下げは残す)
  const texts = lines.map((line) => lineText(line).trimEnd())
  const located = locateClaudePermissionPrompt(texts)
  if (located === null) return null
  const { numberColumn, questionFirst, questionLast } = located
  const drafts: OptionDraft[] = []
  const cursorNumbers: number[] = []
  let y = questionLast + 1
  // 問いと最初の選択肢の間の空行は飛ばす
  while (y < texts.length && texts[y] === '') y++
  for (; y < texts.length; y++) {
    const text = texts[y]
    // 選択肢が始まった後の空行で終える
    if (text === '') break
    const cursor = PERMISSION_CURSOR_OPTION.exec(text)
    const isCursor = cursor !== null && cursor[1].length === numberColumn
    if (isCursor || (NUMBERED_LINE.test(text) && indentOf(text) === numberColumn)) {
      const match = OPTION_TEXT.exec(text)
      if (match === null) return null
      const number = Number(match[1])
      drafts.push({ number, parts: [match[2].trim()] })
      if (isCursor) cursorNumbers.push(number)
      continue
    }
    // 番号の桁より深い字下げの行は、直前の選択肢の折り返し(台帳の permission の 2 番)
    const last = drafts[drafts.length - 1]
    if (last !== undefined && indentOf(text) > numberColumn) {
      last.parts.push(text.trim())
      continue
    }
    break
  }
  const options: AgentPermissionOption[] = drafts.map(({ number, parts }) => ({
    number,
    text: parts.join(' ')
  }))
  if (!isWellFormedAgentPermissionOptions(options, cursorNumbers)) return null
  const cursorNumber = cursorNumbers[0]
  // 選択肢の後の最初の空でない行が案内の行
  const hint = texts.slice(y).find((text) => text.trim() !== '') ?? ''
  const cursorOnAnswer = (['allow', 'deny'] as const).some(
    (choice) => findAgentPermissionOption({ options }, choice)?.number === cursorNumber
  )
  return {
    body: readBody(texts, questionFirst),
    question: texts.slice(questionFirst, questionLast + 1).map((text) => text.trim()),
    options,
    cursorNumber,
    numberKeysAccepted: hint.includes(AMEND_HINT) && cursorOnAnswer
  }
}
```

- [ ] **Step 11: copilot の読み取りを実装する(`copilotPermissionPrompt.ts`)**

```ts
// src/renderer/src/lib/copilotPermissionPrompt.ts
import type { AgentPermissionOption, AgentPermissionPrompt } from './agentPermissionPrompt'
import { isWellFormedAgentPermissionOptions } from './agentPermissionPrompt'
import type { ViewportLine } from './agentViewport'
import { copilotScreenTexts } from './copilotInputBox'
import {
  DIALOG_TOP,
  FRAME_PREFIX,
  classifyCopilotScreen,
  locateCopilotPermissionQuestion
} from './copilotScreenActivity'

// copilot の許可の確認の読み取り(設計書 2026-11-06「copilot」)。GitHub Copilot CLI 1.0.87 の画面で記録した(copilotScreens.json)。
// 位置の特定は判定と同じ locateCopilotPermissionQuestion。判定が permission の画面だけ読む。各行は行頭の枠と空白(FRAME_PREFIX)と
// 行末の枠と空白(FRAME_SUFFIX)を除いてから見る。claude の規則とは共有しない(L-041)。例外は投げない

/** 行末の枠の縦線と空白 */
const FRAME_SUFFIX = /[\s│┃]+$/
/** 選択肢の行。印(`❯ ` か、読み上げのモードの `Current selection: `)のある行がカーソルの行 */
const OPTION_LINE = /^(?:(❯|Current selection:) )?(\d+)\. (.*)$/
/** 枠の文字と空白だけの行(外枠の中の区切りの ───・内側のコマンドの枠の角の行)。本文から除く */
const FRAME_ONLY = /^[─━│┃╭╮╰╯\s]*$/

const stripFrame = (text: string): string => text.replace(FRAME_PREFIX, '').replace(FRAME_SUFFIX, '')

interface OptionDraft {
  number: number
  parts: string[]
}

/** questionRow から上へ、行頭が ╭ の行の直後から問いの手前まで(無ければ画面の先頭から)。枠だけの行と空の行は除く */
function readBody(texts: readonly string[], questionRow: number): string[] {
  let start = 0
  for (let y = questionRow - 1; y >= 0; y--) {
    if (DIALOG_TOP.test(texts[y])) {
      start = y + 1
      break
    }
  }
  return texts
    .slice(start, questionRow)
    .map(stripFrame)
    .filter((text) => !FRAME_ONLY.test(text))
}

export function readCopilotPermissionPrompt(
  lines: readonly ViewportLine[]
): AgentPermissionPrompt | null {
  if (classifyCopilotScreen(lines) !== 'permission') return null
  const texts = copilotScreenTexts(lines)
  const located = locateCopilotPermissionQuestion(texts)
  if (located === null) return null
  const { hintRow, questionRow } = located
  const question = [stripFrame(texts[questionRow])]
  const drafts: OptionDraft[] = []
  const cursorNumbers: number[] = []
  for (let y = questionRow + 1; y < hintRow; y++) {
    const text = stripFrame(texts[y])
    if (text === '') continue
    const match = OPTION_LINE.exec(text)
    if (match !== null) {
      const number = Number(match[2])
      drafts.push({ number, parts: [match[3].trim()] })
      if (match[1] !== undefined) cursorNumbers.push(number)
      continue
    }
    // 選択肢の行の間の当たらない行は直前の選択肢の折り返し、最初の選択肢の行より前なら問いの折り返し
    const last = drafts[drafts.length - 1]
    if (last === undefined) question.push(text)
    else last.parts.push(text)
  }
  const options: AgentPermissionOption[] = drafts.map(({ number, parts }) => ({
    number,
    text: parts.join(' ')
  }))
  if (!isWellFormedAgentPermissionOptions(options, cursorNumbers)) return null
  const cursorNumber = cursorNumbers[0]
  return {
    body: readBody(texts, questionRow),
    question,
    options,
    cursorNumber,
    // 最後の選択肢は「代わりにしてほしいこと」の入力欄になる選択肢。カーソルがそこにある間は数字が入力欄へ文字として入る
    numberKeysAccepted: cursorNumber !== options[options.length - 1].number
  }
}
```

- [ ] **Step 12: 種類ごとの表を実装する(`agentPermissionPromptReaders.ts`)**

```ts
// src/renderer/src/lib/agentPermissionPromptReaders.ts
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentPermissionPromptReader } from './agentPermissionPrompt'
import { readClaudePermissionPrompt } from './claudePermissionPrompt'
import { readCopilotPermissionPrompt } from './copilotPermissionPrompt'

// CLI の種類ごとの許可の確認の読み取りの表(設計書 2026-11-06「型と表」)。判定の表(agentScreenClassifiers.ts)と同じく、呼ぶ側は
// タブの種類で引く。claude の規則で copilot の画面を読まない(L-041)

/** 種類を足したときの決め忘れを型エラーにする */
export const AGENT_PERMISSION_PROMPT_READERS: Record<AgentCliKind, AgentPermissionPromptReader> = {
  claude: readClaudePermissionPrompt,
  copilot: readCopilotPermissionPrompt
}
```

- [ ] **Step 13: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/shared/__tests__/agentPermissionAnswer.test.ts src/renderer/src/lib/__tests__/claudePermissionPrompt.test.ts src/renderer/src/lib/__tests__/copilotPermissionPrompt.test.ts src/renderer/src/lib/__tests__/agentPermissionPrompt.test.ts src/renderer/src/lib/__tests__/claudeScreenActivity.test.ts src/renderer/src/lib/__tests__/copilotScreenActivity.test.ts src/renderer/src/lib/__tests__/agentScreenClassifiers.test.ts`
Expected: PASS(既存の判定のテストも手を入れずに通る)

続けて: `npm run typecheck` と `npx eslint src/shared/agentPermissionAnswer.ts src/shared/__tests__/agentPermissionAnswer.test.ts src/renderer/src/lib/agentPermissionPrompt.ts src/renderer/src/lib/claudePermissionPrompt.ts src/renderer/src/lib/copilotPermissionPrompt.ts src/renderer/src/lib/agentPermissionPromptReaders.ts src/renderer/src/lib/claudeScreenActivity.ts src/renderer/src/lib/copilotScreenActivity.ts src/renderer/src/lib/__tests__/claudePermissionPrompt.test.ts src/renderer/src/lib/__tests__/copilotPermissionPrompt.test.ts src/renderer/src/lib/__tests__/agentPermissionPrompt.test.ts --max-warnings 0`

---

### Task 2: IPC `agentTerminal:answerPermission`(shared・main・preload・renderer の API の包み)

**Files:**
- Modify: `src/shared/types/agentTerminal.ts`(`AgentInterruptFollowUpResult` の後に `AgentPermissionAnswerResult`)
- Modify: `src/main/agentSession.ts`(`AGENT_PERMISSION_ANSWER_KEYS`・`AgentSessionPermissionAnswerResult`・`answerPermission`)
- Modify: `src/main/agentSessionRegistry.ts`(`interruptFollowUp` の後に `answerPermission`)
- Modify: `src/main/handlers/agentTerminalPayloadParser.ts`(`parseAgentSessionId` の後に `parseAgentPermissionOptionNumber`)
- Modify: `src/main/handlers/agentTerminalHandlers.ts`(`agentTerminal:interruptFollowUp` の後に受け口。deps の `Pick` に `'answerPermission'`)
- Modify: `src/preload/api.ts`・`src/preload/index.d.ts`(`interruptAgentSessionFollowUp` の後に `answerAgentPermission`)
- Modify: `src/renderer/src/lib/agentTerminalApi.ts`(`interruptAgentSessionFollowUp` の後に `answerAgentPermission`)
- Modify: `src/renderer/src/__tests__/setup.ts`(`interruptAgentSessionFollowUp` の既定のスタブの後に `answerAgentPermission: () => Promise.resolve({ kind: 'sent' })`)
- Test: `src/main/__tests__/agentSession.test.ts`・`src/main/__tests__/agentSessionRegistry.test.ts`・`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`・`src/main/__tests__/agentSession.integration.test.ts`・`src/preload/__tests__/api.test.ts`

**Interfaces:**
- Consumes: `AgentPermissionOptionNumber`・`isAgentPermissionOptionNumber`(Task 1。`@shared/agentPermissionAnswer`)
- Produces:
  - `type AgentPermissionAnswerResult = { kind: 'sent' } | { kind: 'no-session' } | { kind: 'write-failed' }`(`@shared/types` から import できる)
  - `const AGENT_PERMISSION_ANSWER_KEYS: Record<AgentPermissionOptionNumber, string>`(`src/main/agentSession.ts`)
  - `type AgentSessionPermissionAnswerResult = 'sent' | 'not-alive' | 'write-failed'`
  - `AgentSession.answerPermission(optionNumber: AgentPermissionOptionNumber): AgentSessionPermissionAnswerResult`
  - `AgentSessionRegistry.answerPermission(ownerId: number, sessionId: string, optionNumber: AgentPermissionOptionNumber): AgentPermissionAnswerResult`
  - `function parseAgentPermissionOptionNumber(value: unknown): AgentPermissionOptionNumber`(不正なら投げる)
  - preload・`window.api`: `answerAgentPermission(sessionId: string, optionNumber: number): Promise<AgentPermissionAnswerResult>`
  - renderer: `agentTerminalApi.answerAgentPermission(sessionId: string, optionNumber: number): Promise<AgentPermissionAnswerResult>`

**気をつける点:**
- L-019: renderer の値は表を引く鍵にだけ使う。書くのは表の固定の 1 バイト。`writeAgentSession`(任意の文字列)には流さない。送信元のフレームを確かめ、所有者は `event.sender.id`
- L-594: 数字の 1 バイトだけ。`\x1b` で始まる列・`Enter` を足さない(書いたバイトを `toEqual([['1']])` で固定する)

- [ ] **Step 1: 失敗するテストを書く(AgentSession)**

`src/main/__tests__/agentSession.test.ts` の import に `AGENT_PERMISSION_ANSWER_KEYS` を足し、`describe('AgentSession.interrupt', ...)` の後に足す:

```ts
describe('AgentSession.answerPermission', () => {
  const makeSession = (
    pty = makeFakePty(),
    stopTree = vi.fn<StopTree>()
  ): { session: AgentSession; pty: ReturnType<typeof makeFakePty> } => ({
    session: new AgentSession({
      ...CLAUDE_INTERRUPT,
      id: 's1',
      pty,
      callbacks: makeCallbacks(),
      stopTree
    }),
    pty
  })

  it('表は 1〜9 の番号から同じ数字の 1 文字を引く', () => {
    expect(AGENT_PERMISSION_ANSWER_KEYS).toEqual({
      1: '1',
      2: '2',
      3: '3',
      4: '4',
      5: '5',
      6: '6',
      7: '7',
      8: '8',
      9: '9'
    })
  })

  it.each([
    [1, '1'],
    [4, '4']
  ] as const)('answerPermission(%d) は pty へ %s の 1 バイトだけを書き、sent を返す', (number, key) => {
    const { session, pty } = makeSession()
    expect(session.answerPermission(number)).toBe('sent')
    expect(pty.write.mock.calls).toEqual([[key]])
  })

  it('終了の後は書かずに not-alive を返す', () => {
    const { session, pty } = makeSession()
    pty.emitExit(0)
    expect(session.answerPermission(1)).toBe('not-alive')
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('stop の後(終了の前)は書かずに not-alive を返す', () => {
    const { session, pty } = makeSession(
      makeFakePty(),
      vi.fn<StopTree>(() => new Promise<void>(() => undefined))
    )
    void session.stop('stopped')
    expect(session.answerPermission(1)).toBe('not-alive')
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('pty.write が投げたら write-failed を返し、例外を投げない', () => {
    const { session, pty } = makeSession()
    pty.write.mockImplementationOnce(() => {
      throw new Error('EIO')
    })
    expect(session.answerPermission(1)).toBe('write-failed')
  })
})
```

- [ ] **Step 2: 失敗するテストを書く(registry)**

`src/main/__tests__/agentSessionRegistry.test.ts` の `describe('AgentSessionRegistry.interruptFollowUp', ...)` の後に足す(`makeSession`・`makeSlowStoppingSession`・`created` はこのファイルの既存の補助):

```ts
describe('AgentSessionRegistry.answerPermission', () => {
  it('所有者の枠の現在のセッションだけに番号の 1 バイトを書き、sent を返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty } = makeSession('s1')
    await registry.start(1, 'a', created(session))
    expect(registry.answerPermission(1, 's1', 4)).toEqual({ kind: 'sent' })
    expect(pty.write.mock.calls).toEqual([['4']])
  })

  it('別の所有者・知らない sessionId には書かず no-session を返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty } = makeSession('s1')
    await registry.start(1, 'a', created(session))
    expect(registry.answerPermission(2, 's1', 1)).toEqual({ kind: 'no-session' })
    expect(registry.answerPermission(1, 'other', 1)).toEqual({ kind: 'no-session' })
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('起動し直した後の古い sessionId には書かず no-session を返す', async () => {
    const registry = new AgentSessionRegistry()
    const first = makeSession('s1')
    await registry.start(1, 'a', created(first.session))
    first.pty.emitExit(0)
    await first.session.exited
    const second = makeSession('s2')
    await registry.start(1, 'a', created(second.session))
    expect(registry.answerPermission(1, 's1', 1)).toEqual({ kind: 'no-session' })
    expect(first.pty.write).not.toHaveBeenCalled()
    expect(second.pty.write).not.toHaveBeenCalled()
  })

  it('停止中のセッション(stop の後、止まりきる前)には書かず no-session を返す', async () => {
    const registry = new AgentSessionRegistry()
    const slow = makeSlowStoppingSession('old')
    await registry.start(1, 'a', created(slow.session))
    const stopping = registry.stop(1, 'stopped', 'old')
    expect(registry.answerPermission(1, 'old', 1)).toEqual({ kind: 'no-session' })
    expect(slow.pty.write).not.toHaveBeenCalled()
    slow.release()
    await stopping
  })

  it('終了した直後(枠から外れる前)のセッションには書かず no-session を返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty } = makeSession('s1')
    await registry.start(1, 'a', created(session))
    pty.emitExit(0)
    expect(registry.answerPermission(1, 's1', 1)).toEqual({ kind: 'no-session' })
    expect(pty.write).not.toHaveBeenCalled()
    await session.exited
  })

  it('pty への書き込みが投げたら write-failed を返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty } = makeSession('s1')
    await registry.start(1, 'a', created(session))
    pty.write.mockImplementationOnce(() => {
      throw new Error('EIO')
    })
    expect(registry.answerPermission(1, 's1', 1)).toEqual({ kind: 'write-failed' })
  })
})
```

- [ ] **Step 3: 失敗するテストを書く(受け口)**

`src/main/__tests__/handlers/agentTerminalHandlers.test.ts` の既存の偽の registry のリテラル(`interruptFollowUp: vi.fn()`・`interruptFollowUp: registryFollowUp` を持つ 3 か所。`grep -n 'interruptFollowUp:' src/main/__tests__/handlers/agentTerminalHandlers.test.ts` で探す)に `answerPermission: vi.fn()` を足す(deps の `Pick` が増えるため)。
`describe('agentTerminal:interruptFollowUp', ...)` の後に足す:

```ts
describe('agentTerminal:answerPermission', () => {
  async function started(): Promise<ReturnType<typeof makeEvent>> {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    return event
  }
  const answer = (event: ReturnType<typeof makeEvent>, ...args: unknown[]): unknown =>
    handles.get('agentTerminal:answerPermission')?.(event, ...args)
  const fakeRegistry = (
    answerPermission: AgentTerminalHandlerDeps['registry']['answerPermission']
  ): AgentTerminalHandlerDeps['registry'] => ({
    write: vi.fn(),
    resize: vi.fn(),
    stop: vi.fn(async () => undefined),
    snapshot: vi.fn(() => []),
    interrupt: vi.fn(),
    interruptFollowUp: vi.fn(),
    answerPermission
  })

  it('今のセッションへ番号の 1 バイトだけを書いて sent を返す。余分な引数を渡しても書くバイト列は変わらない(L-019)', async () => {
    const event = await started()
    expect(answer(event, 'sid-1', 1, '\r', '\x1b')).toEqual({ kind: 'sent' })
    expect(pty.write.mock.calls).toEqual([['1']])
  })

  it('別の sessionId・別のウィンドウからは書かず no-session を返す', async () => {
    const event = await started()
    expect(answer(event, 'stale', 1)).toEqual({ kind: 'no-session' })
    expect(answer(makeEvent(2), 'sid-1', 1)).toEqual({ kind: 'no-session' })
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('サブフレームからの依頼・空や文字列でない sessionId は投げて registry を呼ばない', () => {
    const registryAnswer = vi.fn<AgentSessionRegistry['answerPermission']>()
    register({ registry: fakeRegistry(registryAnswer) })
    expect(() => answer(makeEvent(1, false), 'sid-1', 1)).toThrow()
    expect(() => answer(makeEvent(), '', 1)).toThrow()
    expect(() => answer(makeEvent(), 1, 1)).toThrow()
    expect(registryAnswer).not.toHaveBeenCalled()
  })

  it.each([0, 10, 1.5, -1, NaN, Infinity, '1', null, undefined])(
    '番号 %o は投げて registry を呼ばない',
    (optionNumber) => {
      const registryAnswer = vi.fn<AgentSessionRegistry['answerPermission']>()
      register({ registry: fakeRegistry(registryAnswer) })
      expect(() => answer(makeEvent(), 'sid-1', optionNumber)).toThrow()
      expect(registryAnswer).not.toHaveBeenCalled()
    }
  )

  it.each([1, 9])('番号 %d は registry.answerPermission に送信元の id・sessionId・番号だけを渡し、結果をそのまま返す', (optionNumber) => {
    const registryAnswer = vi.fn<AgentSessionRegistry['answerPermission']>(() => ({
      kind: 'write-failed'
    }))
    register({ registry: fakeRegistry(registryAnswer) })
    expect(answer(makeEvent(7), 'sid-x', optionNumber, 'extra')).toEqual({ kind: 'write-failed' })
    expect(registryAnswer).toHaveBeenCalledExactlyOnceWith(7, 'sid-x', optionNumber)
  })
})
```

- [ ] **Step 4: 失敗するテストを書く(実物の pty)**

`src/main/__tests__/agentSession.integration.test.ts` の `describe.skipIf(process.platform === 'win32')(...)` の中、`interrupt は固定の 1 バイト…` のテストの後に足す:

```ts
  it('answerPermission(1) は数字の 1 バイト(31)だけを子の標準入力へ届ける(raw モードの子が受け取ったバイトを 16 進で書き出す)', async () => {
    const out = join(dir, 'received-hex')
    const ready = join(dir, 'ready')
    const script = join(dir, 'raw-hex.js')
    writeFileSync(
      script,
      [
        "const fs = require('node:fs')",
        'process.stdin.setRawMode(true)',
        `process.stdin.on('data', (chunk) => fs.appendFileSync(${JSON.stringify(out)}, chunk.toString('hex')))`,
        `fs.writeFileSync(${JSON.stringify(ready)}, 'ready')`
      ].join('\n')
    )
    const session = start(`exec '${process.execPath}' '${script}'`)
    await waitForFile(ready, timers)
    expect(session.answerPermission(1)).toBe('sent')
    expect(await waitForFile(out, timers)).toBe('31')
    // 続けて余分なバイト(Enter・Esc など)が届かないことを、少し待ってから確かめる
    await timers.delay(300)
    expect(readFileSync(out, 'utf8')).toBe('31')
  }, 15_000)
```

- [ ] **Step 5: 失敗するテストを書く(preload)**

`src/preload/__tests__/api.test.ts` の invoke の引数の `it.each` の表(`'interruptAgentSessionFollowUp は agentTerminal:interruptFollowUp に sessionId だけを渡す'` の行の後)に足す:

```ts
    [
      'answerAgentPermission は agentTerminal:answerPermission に sessionId と番号だけを渡す',
      () => api.answerAgentPermission('id', 1),
      ['agentTerminal:answerPermission', 'id', 1]
    ],
```

`describe('interruptAgentSessionFollowUp の戻り値', ...)` の後に足す:

```ts
describe('answerAgentPermission の戻り値', () => {
  it('agentTerminal:answerPermission の結果をそのまま返す', async () => {
    const result = { kind: 'no-session' }
    mockInvoke.mockResolvedValue(result)
    await expect(api.answerAgentPermission('id', 1)).resolves.toBe(result)
  })
})
```

- [ ] **Step 6: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/agentSession.test.ts src/main/__tests__/agentSessionRegistry.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/agentSession.integration.test.ts src/preload/__tests__/api.test.ts`
Expected: FAIL(`answerPermission`・`AGENT_PERMISSION_ANSWER_KEYS`・`answerAgentPermission` が無い)

- [ ] **Step 7: shared の結果の型を実装する**

`src/shared/types/agentTerminal.ts` の `AgentInterruptFollowUpResult` の後に足す:

```ts
/** 許可の確認への答え(agentTerminal:answerPermission)の結果。main は番号の 1 バイトを書けたかだけを返す(答えた結果は画面の判定で分かる) */
export type AgentPermissionAnswerResult =
  | { kind: 'sent' }
  | { kind: 'no-session' }
  | { kind: 'write-failed' }
```

- [ ] **Step 8: AgentSession を実装する**

`src/main/agentSession.ts` の import に足す:

```ts
import type { AgentPermissionOptionNumber } from '@shared/agentPermissionAnswer'
```

`AGENT_INTERRUPT_SEQUENCE` の後に足す:

```ts
/**
 * 許可の確認の選択肢の番号キー(ターミナルで数字を 1 回押すのと同じ。設計書 2026-11-06「main」)。renderer の値は表を引く鍵にだけ使い、
 * 書くのは表の固定の 1 バイト(L-019)。矢印と Enter は送らない(L-594)
 */
export const AGENT_PERMISSION_ANSWER_KEYS: Record<AgentPermissionOptionNumber, string> = {
  1: '1',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9'
}
```

`AgentSessionInterruptFollowUpResult` の後に足す:

```ts
/** 許可の確認への答えの結果 */
export type AgentSessionPermissionAnswerResult = 'sent' | 'not-alive' | 'write-failed'
```

クラスの `interruptFollowUp()` の後に足す:

```ts
  /**
   * 許可の確認に答える(選択肢の番号キーを 1 回)。終了の後・停止の途中(stop の後、終了の前)は書かない。pty.write の例外は握って
   * write-failed(受け口から投げない)。CLI の反応は待たない(pty.write は同期で返る。L-052)。main は画面を読まないので、送る番号が
   * Yes・No の選択肢かは renderer の読み取りで確かめる
   */
  answerPermission(optionNumber: AgentPermissionOptionNumber): AgentSessionPermissionAnswerResult {
    if (!this.alive || this.stopping !== null) return 'not-alive'
    try {
      this.pty.write(AGENT_PERMISSION_ANSWER_KEYS[optionNumber])
      return 'sent'
    } catch {
      return 'write-failed'
    }
  }
```

- [ ] **Step 9: registry を実装する**

`src/main/agentSessionRegistry.ts` の `@shared/types` の import に `AgentPermissionAnswerResult` を足し、`import type { AgentPermissionOptionNumber } from '@shared/agentPermissionAnswer'` を足す。`interruptFollowUp` の後に足す:

```ts
  /**
   * 許可の確認への答え。照合は write・interrupt と同じ(所有者の枠の現在のセッションとの一致。停止中・別のウィンドウ・起動し直す前の
   * 古い sessionId は no-session。L-037)。セッションの not-alive は no-session に写す
   */
  answerPermission(
    ownerId: number,
    sessionId: string,
    optionNumber: AgentPermissionOptionNumber
  ): AgentPermissionAnswerResult {
    const session = this.findBySessionId(ownerId, sessionId)?.session
    if (session === undefined) return { kind: 'no-session' }
    const result = session.answerPermission(optionNumber)
    return { kind: result === 'not-alive' ? 'no-session' : result }
  }
```

- [ ] **Step 10: 引数の検証と受け口を実装する**

`src/main/handlers/agentTerminalPayloadParser.ts` の import に足す:

```ts
import {
  AGENT_PERMISSION_OPTION_NUMBER_MAX,
  isAgentPermissionOptionNumber
} from '@shared/agentPermissionAnswer'
import type { AgentPermissionOptionNumber } from '@shared/agentPermissionAnswer'
```

`parseAgentSessionId` の後に足す:

```ts
/** 許可の確認の選択肢の番号(1〜9 の整数)。invoke の拒否にするため、不正なら投げる(L-019) */
export function parseAgentPermissionOptionNumber(value: unknown): AgentPermissionOptionNumber {
  if (!isAgentPermissionOptionNumber(value)) {
    throw new Error(
      `optionNumber は 1〜${AGENT_PERMISSION_OPTION_NUMBER_MAX} の整数である必要があります`
    )
  }
  return value
}
```

`src/main/handlers/agentTerminalHandlers.ts`:

1. `@shared/types` の import に `AgentPermissionAnswerResult` を足し、パーサーの import に `parseAgentPermissionOptionNumber` を足す
2. `AgentTerminalHandlerDeps.registry` の `Pick` を `'write' | 'resize' | 'stop' | 'snapshot' | 'interrupt' | 'interruptFollowUp' | 'answerPermission'` にし、コメントを「書き込み・リサイズ・停止・中断(1 回目と 2 回目)・許可の確認への答え・状態の取得の相手」にする
3. `agentTerminal:interruptFollowUp` の受け口の後に足す:

```ts
  // 許可の確認への答え(設計書 2026-11-06「IPC」)。renderer からは sessionId と選択肢の番号(数)だけを受け取り、main が 1〜9 の整数で
  // あることを確かめて、固定の表から 1 バイトを書く(L-019)。書けたか・セッションが無かったかを返すため invoke にする(L-001)
  ipcMain.handle(
    'agentTerminal:answerPermission',
    (
      event: IpcMainInvokeEvent,
      sessionId: unknown,
      optionNumber: unknown
    ): AgentPermissionAnswerResult => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      return registry.answerPermission(
        event.sender.id,
        parseAgentSessionId(sessionId),
        parseAgentPermissionOptionNumber(optionNumber)
      )
    }
  )
```

- [ ] **Step 11: preload と renderer の API の包みを実装する**

`src/preload/api.ts`: `@shared/types` の import に `AgentPermissionAnswerResult` を足し、`interruptAgentSessionFollowUp` の後に足す:

```ts
  // 許可の確認への答え。引数は sessionId と選択肢の番号だけで、書くバイトは main が表から決める。書けたかを返すため invoke
  answerAgentPermission: (
    sessionId: string,
    optionNumber: number
  ): Promise<AgentPermissionAnswerResult> =>
    ipcRenderer.invoke('agentTerminal:answerPermission', sessionId, optionNumber),
```

`src/preload/index.d.ts`: import に `AgentPermissionAnswerResult` を足し、`interruptAgentSessionFollowUp(...)` の行の後に足す:

```ts
      answerAgentPermission(sessionId: string, optionNumber: number): Promise<AgentPermissionAnswerResult>
```

`src/renderer/src/lib/agentTerminalApi.ts`: import に `AgentPermissionAnswerResult` を足し、`interruptAgentSessionFollowUp` の後に足す:

```ts
/** 許可の確認に答える(ターミナルで選択肢の番号キーを押すのと同じ)。書くバイトは main が番号から決める */
export function answerAgentPermission(
  sessionId: string,
  optionNumber: number
): Promise<AgentPermissionAnswerResult> {
  return window.api.answerAgentPermission(sessionId, optionNumber)
}
```

`src/renderer/src/__tests__/setup.ts` の `interruptAgentSessionFollowUp: () => Promise.resolve({ kind: 'not-pending' }),` の次の行に足す:

```ts
    answerAgentPermission: () => Promise.resolve({ kind: 'sent' }),
```

- [ ] **Step 12: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/agentSession.test.ts src/main/__tests__/agentSessionRegistry.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/agentSession.integration.test.ts src/preload/__tests__/api.test.ts`
Expected: PASS

続けて: `npm run typecheck` と `npx eslint src/shared/types/agentTerminal.ts src/main/agentSession.ts src/main/agentSessionRegistry.ts src/main/handlers/agentTerminalPayloadParser.ts src/main/handlers/agentTerminalHandlers.ts src/preload/api.ts src/preload/index.d.ts src/renderer/src/lib/agentTerminalApi.ts src/renderer/src/__tests__/setup.ts src/main/__tests__/agentSession.test.ts src/main/__tests__/agentSessionRegistry.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/agentSession.integration.test.ts src/preload/__tests__/api.test.ts --max-warnings 0`

---

### Task 3: 能力の表・押せるかの判定・文言(renderer の純関数)

**Files:**
- Modify: `src/shared/agentCliKinds.ts`(`AgentCliCapabilities.permissionAnswer`。`interrupt` の次。両方 true)
- Modify: `src/renderer/src/lib/agentCliMessages.ts`(`AGENT_CLI_CAPABILITY_NAMES` に `permissionAnswer`。`interrupt` の次)
- Modify: `src/renderer/src/__tests__/agentCliCapabilityOverrides.ts`(`unsupportedKinds` で `permissionAnswer` も偽にする)
- Create: `src/renderer/src/lib/agentPermissionAnswerMessages.ts`
- Create: `src/renderer/src/lib/agentPermissionAnswer.ts`
- Test: `src/shared/__tests__/agentCliKinds.test.ts`・`src/renderer/src/lib/__tests__/agentCliMessages.test.ts`(既存を直す)
- Test: `src/renderer/src/lib/__tests__/agentPermissionAnswerMessages.test.ts`・`src/renderer/src/lib/__tests__/agentPermissionAnswer.test.ts`(新規)

**Interfaces:**
- Consumes: `AgentPermissionPrompt`・`AgentPermissionOption`・`AgentPermissionChoice`・`findAgentPermissionOption`・`isSameAgentPermissionPrompt`(Task 1)、`AGENT_PERMISSION_PROMPT_READERS`(Task 1)、`AgentPermissionAnswerResult`(Task 2)
- Produces(`lib/agentPermissionAnswerMessages.ts`):
  - `const AGENT_PERMISSION_ALLOW_LABEL = '許可'`・`const AGENT_PERMISSION_DENY_LABEL = '拒否'`
  - `function agentPermissionAnswerLabel(choice: AgentPermissionChoice): string`
  - `function agentPermissionAnswerAriaLabel(choice: AgentPermissionChoice, tabLabel: string, questionFirstLine: string | null, optionNumber: number | null): string`
  - `function agentPermissionAnswerNotRunningReason(commandName: string): string`
  - `function agentPermissionAnswerUnsupportedReason(commandName: string): string`
  - `function agentPermissionAnswerNotPermissionReason(commandName: string): string`
  - `const AGENT_PERMISSION_ANSWER_DISABLED_CLOSING`・`AGENT_PERMISSION_ANSWER_DISABLED_SENDING`・`AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM`・`AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING`・`AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN`・`AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE`(string)
  - `const AGENT_PERMISSION_ANSWER_TEXTS: Record<AgentCliKind, { numberKeysRejected: string; denyFollowUp: string | null }>`
  - `function agentPermissionAnswerNumberKeysRejectedReason(kind: AgentCliKind): string`
  - `function agentPermissionAnswerOptionMissingReason(choice: AgentPermissionChoice): string`
  - `function agentPermissionAnswerNoLongerPermissionReason(commandName: string): string`
  - `const AGENT_PERMISSION_ANSWER_PROMPT_CHANGED: string`
  - `function agentPermissionAnswerSentNotice(label: string, kind: AgentCliKind, choice: AgentPermissionChoice, optionNumber: number): string`
  - `const AGENT_PERMISSION_ANSWER_ERROR_PREFIX = '許可の答えを送れませんでした: '`
  - `type AgentPermissionAnswerFailureKind = Exclude<AgentPermissionAnswerResult['kind'], 'sent'>`
  - `function agentPermissionAnswerFailureError(kind: AgentPermissionAnswerFailureKind, commandName: string): string`
  - `function agentPermissionAnswerError(message: string): string`
- Produces(`lib/agentPermissionAnswer.ts`):
  - `const AGENT_PERMISSION_ANSWER_COOLDOWN_MS = 1_000`
  - `interface AgentPermissionAnswerAvailabilityInput { status: AgentSessionStatus; cliKind: AgentCliKind; isClosing: boolean; activity: AgentActivity; isSending: boolean; isSendConfirmOpen: boolean; isInterrupting: boolean; isAnswering: boolean; prompt: AgentPermissionPrompt | null }`
  - `interface AgentPermissionAnswerAvailability { visible: boolean; reason: string | null; option: AgentPermissionOption | null }`
  - `function getAgentPermissionAnswerAvailability(input: AgentPermissionAnswerAvailabilityInput, choice: AgentPermissionChoice): AgentPermissionAnswerAvailability`
  - `type AgentPermissionAnswerPressCheck = { kind: 'send'; optionNumber: number } | { kind: 'blocked'; reason: string } | { kind: 'unreadable'; error: unknown }`
  - `function checkAgentPermissionAnswerAtPress(input: AgentPermissionAnswerAvailabilityInput, choice: AgentPermissionChoice, readScreen: () => readonly ViewportLine[]): AgentPermissionAnswerPressCheck`
- Produces(能力): `AgentCliCapabilities.permissionAnswer: boolean`

**気をつける点:**
- L-058: 描画と押した処理で同じ `getAgentPermissionAnswerAvailability` を使う(押した処理は段階 (a) としてこれを呼ぶ)
- L-036・L-041: 押した時点の読み直しは「判定が permission か → 読み取れるか → 番号キーが効くか → 照合 → 選択肢があるか」の順。番号キーを照合より先に見る(設計書の段階 (d)・(e))
- L-594: 送る番号は押した時点の読み取りの選択肢の番号だけ(段階 (g))
- 文言は設計書「押せない理由の文言」「読み上げ」「エラー処理」の表と一字一句同じ(テストで全文を固定する)

- [ ] **Step 1: 既存のテストを新しい能力に合わせて直す(失敗させる)**

`src/shared/__tests__/agentCliKinds.test.ts`:

1. `CAPABILITY_KEYS` に `'permissionAnswer'` を `'interrupt'` の次に足し、上のコメントを「能力の項目(設計書「能力の項目」の 5 つと、2026-11-06 の permissionAnswer)」にする
2. `'claude・copilot の能力はすべて真…'` の期待の `interrupt: true,` の次に `permissionAnswer: true,` を足す。名前を `'claude・copilot の能力はすべて真(段階 3a で sessionResume、段階 3b で changeAttribution、2026-11-06 で permissionAnswer も真にした)'` にする
3. `'%s の能力の項目は 5 つ'` を `'%s の能力の項目は 6 つ'` にする
4. `interrupt が真なら screenActivity も真` のテストの後に足す:

```ts
  // 帯の 許可・拒否 を出す条件は画面の判定の permission なので、答えだけ真で判定が偽の種類は作れない
  it.each(AGENT_CLI_KINDS)('%s: permissionAnswer が真なら screenActivity も真', (kind) => {
    const capabilities = agentCliCapabilities(kind)
    expect(!capabilities.permissionAnswer || capabilities.screenActivity).toBe(true)
  })
```

`src/renderer/src/lib/__tests__/agentCliMessages.test.ts`:

1. `'能力の名前の表は 5 つの能力を網羅する…'` の期待の `interrupt: '中断',` の次に `permissionAnswer: '許可の確認への答え（帯の 許可・拒否）',` を足し、名前を `'能力の名前の表は 6 つの能力を網羅する(並びは能力の表と同じ)'` にする
2. `'使えない機能の注記: 画面の判定と中断が無い種類…'` の期待の文字列を `'copilot では次の機能を使えません（ターミナルで直接操作します）: 作業中・入力待ちの表示と通知、中断、許可の確認への答え（帯の 許可・拒否）'` にし、名前を `'使えない機能の注記: 画面の判定・中断・許可の確認への答えが無い種類(能力の表を差し替えた copilot)は、その 3 つの名前を並べる'` にする

- [ ] **Step 2: 失敗するテストを書く(文言)**

```ts
// src/renderer/src/lib/__tests__/agentPermissionAnswerMessages.test.ts
import { describe, it, expect } from 'vitest'
import {
  AGENT_PERMISSION_ALLOW_LABEL,
  AGENT_PERMISSION_ANSWER_DISABLED_CLOSING,
  AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN,
  AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING,
  AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM,
  AGENT_PERMISSION_ANSWER_DISABLED_SENDING,
  AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE,
  AGENT_PERMISSION_ANSWER_ERROR_PREFIX,
  AGENT_PERMISSION_ANSWER_PROMPT_CHANGED,
  AGENT_PERMISSION_ANSWER_TEXTS,
  AGENT_PERMISSION_DENY_LABEL,
  agentPermissionAnswerAriaLabel,
  agentPermissionAnswerError,
  agentPermissionAnswerFailureError,
  agentPermissionAnswerLabel,
  agentPermissionAnswerNoLongerPermissionReason,
  agentPermissionAnswerNotPermissionReason,
  agentPermissionAnswerNotRunningReason,
  agentPermissionAnswerNumberKeysRejectedReason,
  agentPermissionAnswerOptionMissingReason,
  agentPermissionAnswerSentNotice,
  agentPermissionAnswerUnsupportedReason
} from '../agentPermissionAnswerMessages'

describe('帯の 許可・拒否 の文言(設計書 2026-11-06「画面」)', () => {
  it('見える文字', () => {
    expect(AGENT_PERMISSION_ALLOW_LABEL).toBe('許可')
    expect(AGENT_PERMISSION_DENY_LABEL).toBe('拒否')
    expect(agentPermissionAnswerLabel('allow')).toBe('許可')
    expect(agentPermissionAnswerLabel('deny')).toBe('拒否')
  })

  it('名前: 選択肢を読み取れたときは、問いの 1 行目と番号を入れる(見える文字で始める)', () => {
    expect(agentPermissionAnswerAriaLabel('allow', 'claude 1', 'Do you want to proceed?', 1)).toBe(
      '許可（claude 1 の「Do you want to proceed?」に 1 番の Yes で答える）'
    )
    expect(agentPermissionAnswerAriaLabel('deny', 'claude 1', 'Do you want to proceed?', 4)).toBe(
      '拒否（claude 1 の「Do you want to proceed?」に 4 番の No で答える）'
    )
    expect(
      agentPermissionAnswerAriaLabel('deny', 'copilot 1', 'Do you want to run this command?', 2)
    ).toBe('拒否（copilot 1 の「Do you want to run this command?」に 2 番の No で答える）')
  })

  it.each<[string | null, number | null]>([
    [null, null],
    ['Do you want to proceed?', null],
    [null, 1]
  ])('名前: 問い %o・番号 %o のどちらかが無いときは、許可の確認に Yes・No で答える', (question, number) => {
    expect(agentPermissionAnswerAriaLabel('allow', 'claude 1', question, number)).toBe(
      '許可（claude 1 の許可の確認に Yes で答える）'
    )
    expect(agentPermissionAnswerAriaLabel('deny', 'claude 1', question, number)).toBe(
      '拒否（claude 1 の許可の確認に No で答える）'
    )
  })

  it('押せない理由(帯に出さない 3 つ)', () => {
    expect(agentPermissionAnswerNotRunningReason('claude')).toBe('claude が動いていないため答えられません')
    expect(agentPermissionAnswerUnsupportedReason('claude')).toBe(
      'claude では許可のボタンを使えません（ターミナルで答えてください）'
    )
    expect(agentPermissionAnswerNotPermissionReason('claude')).toBe('claude は許可待ちではありません')
  })

  it('押せない理由(帯に出すもの)', () => {
    expect(AGENT_PERMISSION_ANSWER_DISABLED_CLOSING).toBe('閉じる途中のタブでは答えられません')
    expect(AGENT_PERMISSION_ANSWER_DISABLED_SENDING).toBe('プロンプトを送信している間は答えられません')
    expect(AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM).toBe(
      '送信前の確認を開いている間は答えられません'
    )
    expect(AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING).toBe(
      '中断を送った直後は答えられません（少し待つと押せます）'
    )
    expect(AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN).toBe(
      '答えを押した直後です（少し待つと押せます）'
    )
    expect(AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE).toBe(
      '画面の選択肢を読み取れませんでした（ターミナルで答えてください）'
    )
    expect(agentPermissionAnswerNumberKeysRejectedReason('claude')).toBe(
      'カーソルが Yes・No 以外にあるか、答えの文の入力欄が開いているため押せません（ターミナルで答えてください）'
    )
    expect(agentPermissionAnswerNumberKeysRejectedReason('copilot')).toBe(
      'copilot は、代わりにしてほしいことの入力を待っています（ターミナルで入力して Enter を押してください。何も入れずに Esc を押すと操作ごと取り消します）'
    )
    expect(agentPermissionAnswerOptionMissingReason('allow')).toBe(
      '画面に「Yes」の選択肢が見つかりません（ターミナルで答えてください）'
    )
    expect(agentPermissionAnswerOptionMissingReason('deny')).toBe(
      '画面に「No」の選択肢が見つかりません（ターミナルで答えてください）'
    )
  })

  it('押した時点の読み直しだけで出る理由', () => {
    expect(agentPermissionAnswerNoLongerPermissionReason('claude')).toBe(
      'claude は許可待ちではなくなりました。画面を確かめてください'
    )
    expect(AGENT_PERMISSION_ANSWER_PROMPT_CHANGED).toBe(
      '許可の確認の内容が変わりました。帯の表示を確かめてからもう一度押してください'
    )
  })

  it('読み上げ: 許可・claude の拒否・copilot の拒否(copilot だけ案内が付く)', () => {
    expect(agentPermissionAnswerSentNotice('claude 1', 'claude', 'allow', 1)).toBe(
      'claude 1 に許可（1 番の Yes）を送りました'
    )
    expect(agentPermissionAnswerSentNotice('copilot 1', 'copilot', 'allow', 1)).toBe(
      'copilot 1 に許可（1 番の Yes）を送りました'
    )
    expect(agentPermissionAnswerSentNotice('claude 1', 'claude', 'deny', 4)).toBe(
      'claude 1 に拒否（4 番の No）を送りました'
    )
    expect(agentPermissionAnswerSentNotice('copilot 1', 'copilot', 'deny', 2)).toBe(
      'copilot 1 で拒否（2 番）を選びました。ターミナルで、代わりにしてほしいことを入力して Enter を押してください'
    )
    expect(AGENT_PERMISSION_ANSWER_TEXTS.claude.denyFollowUp).toBeNull()
  })

  it('送れなかったときの文言', () => {
    expect(AGENT_PERMISSION_ANSWER_ERROR_PREFIX).toBe('許可の答えを送れませんでした: ')
    expect(agentPermissionAnswerFailureError('no-session', 'claude')).toBe(
      '許可の答えを送れませんでした: claude が終了したか、起動し直しました'
    )
    expect(agentPermissionAnswerFailureError('write-failed', 'claude')).toBe(
      '許可の答えを送れませんでした: ターミナルへの書き込みに失敗しました'
    )
    expect(agentPermissionAnswerError('ipc down')).toBe('許可の答えを送れませんでした: ipc down')
  })
})
```

- [ ] **Step 3: 失敗するテストを書く(押せるかの判定と押した時点の判定)**

```ts
// src/renderer/src/lib/__tests__/agentPermissionAnswer.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  AGENT_PERMISSION_ANSWER_COOLDOWN_MS,
  checkAgentPermissionAnswerAtPress,
  getAgentPermissionAnswerAvailability
} from '../agentPermissionAnswer'
import type { AgentPermissionAnswerAvailabilityInput } from '../agentPermissionAnswer'
import type { AgentPermissionChoice, AgentPermissionPrompt } from '../agentPermissionPrompt'
import { AGENT_PERMISSION_PROMPT_READERS } from '../agentPermissionPromptReaders'
import type { AgentActivity } from '../agentActivity'
import type { AgentSessionStatus } from '../agentSessionTabState'
import type { ViewportLine } from '../agentViewport'
import { agentScreen, makeLine } from './fixtures/agentScreens'
import { copilotScreen } from './fixtures/copilotScreens'
import {
  AGENT_PERMISSION_ANSWER_DISABLED_CLOSING,
  AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN,
  AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING,
  AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM,
  AGENT_PERMISSION_ANSWER_DISABLED_SENDING,
  AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE,
  AGENT_PERMISSION_ANSWER_PROMPT_CHANGED,
  agentPermissionAnswerNoLongerPermissionReason,
  agentPermissionAnswerNotPermissionReason,
  agentPermissionAnswerNotRunningReason,
  agentPermissionAnswerNumberKeysRejectedReason,
  agentPermissionAnswerOptionMissingReason,
  agentPermissionAnswerUnsupportedReason
} from '../agentPermissionAnswerMessages'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

// 能力が無い種類の理由を確かめるため、能力の表を種類ごとに差し替える
const capabilityOverrides = vi.hoisted(
  (): AgentCliCapabilityOverrides => ({
    unsupportedKinds: new Set<AgentCliKind>(),
    promptSendUnsupportedKinds: new Set<AgentCliKind>(),
    sessionResumeUnsupportedKinds: new Set<AgentCliKind>(),
    changeAttributionUnsupportedKinds: new Set<AgentCliKind>()
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

afterEach(() => {
  capabilityOverrides.unsupportedKinds.clear()
})

const readPrompt = (kind: AgentCliKind, lines: readonly ViewportLine[]): AgentPermissionPrompt => {
  const prompt = AGENT_PERMISSION_PROMPT_READERS[kind](lines)
  if (prompt === null) throw new Error('許可の確認を読み取れない画面です')
  return prompt
}
const withRow = (lines: readonly ViewportLine[], y: number, text: string): ViewportLine[] =>
  lines.map((line, index) => (index === y ? makeLine(text) : line))

const CLAUDE_SCREEN = agentScreen('permission').lines
const CLAUDE_PROMPT = readPrompt('claude', CLAUDE_SCREEN)
const COPILOT_SCREEN = copilotScreen('permission').lines
const COPILOT_PROMPT = readPrompt('copilot', COPILOT_SCREEN)

const READY: AgentPermissionAnswerAvailabilityInput = {
  status: 'running',
  cliKind: 'claude',
  isClosing: false,
  activity: 'permission',
  isSending: false,
  isSendConfirmOpen: false,
  isInterrupting: false,
  isAnswering: false,
  prompt: CLAUDE_PROMPT
}

const STATUSES: readonly AgentSessionStatus[] = ['none', 'starting', 'running', 'exited']
const ACTIVITIES: readonly AgentActivity[] = ['working', 'idle', 'permission', 'confirm', 'unknown']
// 設計書「押せない理由の文言」の表の順(閉じる途中 → 送信中 → 確認の表示中 → 中断の流れ → 答えた直後)
const FLAGS = ['isClosing', 'isSending', 'isSendConfirmOpen', 'isInterrupting', 'isAnswering'] as const
type Flag = (typeof FLAGS)[number]
const FLAG_REASONS: Record<Flag, string> = {
  isClosing: AGENT_PERMISSION_ANSWER_DISABLED_CLOSING,
  isSending: AGENT_PERMISSION_ANSWER_DISABLED_SENDING,
  isSendConfirmOpen: AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM,
  isInterrupting: AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING,
  isAnswering: AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN
}

describe('AGENT_PERMISSION_ANSWER_COOLDOWN_MS', () => {
  it('押してから押せない間は 1,000ms(中断と同じ)', () => {
    expect(AGENT_PERMISSION_ANSWER_COOLDOWN_MS).toBe(1_000)
  })
})

describe('getAgentPermissionAnswerAvailability', () => {
  it('許可待ちで読み取れ、どの理由にも当たらなければ押せる。option は許可 1・拒否 4', () => {
    expect(getAgentPermissionAnswerAvailability(READY, 'allow')).toEqual({
      visible: true,
      reason: null,
      option: { number: 1, text: 'Yes' }
    })
    expect(getAgentPermissionAnswerAvailability(READY, 'deny')).toEqual({
      visible: true,
      reason: null,
      option: { number: 4, text: 'No' }
    })
  })

  // 状態(4)× 活動(5): running で permission のときだけ出す
  it.each(STATUSES.flatMap((status) => ACTIVITIES.map((activity) => [status, activity] as const)))(
    '%s・%s: running・permission のときだけ出し、出さないときは帯に出さない理由を持つ',
    (status, activity) => {
      const result = getAgentPermissionAnswerAvailability({ ...READY, status, activity }, 'allow')
      if (status !== 'running') {
        expect(result).toEqual({
          visible: false,
          reason: agentPermissionAnswerNotRunningReason('claude'),
          option: null
        })
        return
      }
      if (activity !== 'permission') {
        expect(result).toEqual({
          visible: false,
          reason: agentPermissionAnswerNotPermissionReason('claude'),
          option: null
        })
        return
      }
      expect(result.visible).toBe(true)
      expect(result.reason).toBeNull()
    }
  )

  it('能力が無い種類は出さず、能力が無い理由を持つ(動いていない の次・許可待ちでない より前)', () => {
    capabilityOverrides.unsupportedKinds.add('claude')
    expect(getAgentPermissionAnswerAvailability({ ...READY, activity: 'idle' }, 'allow')).toEqual({
      visible: false,
      reason: agentPermissionAnswerUnsupportedReason('claude'),
      option: null
    })
  })

  // 閉じる途中・送信中・確認の表示中・中断の流れ・答えた直後(32 の組)。最初に当たった理由
  it.each(
    Array.from({ length: 2 ** FLAGS.length }, (_, bits) => ({
      flags: FLAGS.filter((_flag, index) => (bits & (1 << index)) !== 0)
    }))
  )('当たる理由 $flags の順', ({ flags }: { flags: Flag[] }) => {
    const input: AgentPermissionAnswerAvailabilityInput = { ...READY }
    for (const flag of flags) input[flag] = true
    const expected = FLAGS.find((flag) => flags.includes(flag))
    const result = getAgentPermissionAnswerAvailability(input, 'allow')
    expect(result.visible).toBe(true)
    expect(result.reason).toBe(expected === undefined ? null : FLAG_REASONS[expected])
    expect(result.option === null).toBe(expected !== undefined)
  })

  it('答えた直後(読み直し待ちで prompt が null)は「読み取れない」ではなく「答えを押した直後です」', () => {
    expect(
      getAgentPermissionAnswerAvailability({ ...READY, isAnswering: true, prompt: null }, 'allow')
        .reason
    ).toBe(AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN)
  })

  it('読み取れない → 番号キーが効かない → その選択肢が無い の順', () => {
    expect(getAgentPermissionAnswerAvailability({ ...READY, prompt: null }, 'allow').reason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE
    )
    const rejected = { ...CLAUDE_PROMPT, numberKeysAccepted: false, options: [] }
    expect(getAgentPermissionAnswerAvailability({ ...READY, prompt: rejected }, 'allow').reason).toBe(
      agentPermissionAnswerNumberKeysRejectedReason('claude')
    )
    const noYes = { ...CLAUDE_PROMPT, options: [{ number: 1, text: 'No' }] }
    expect(getAgentPermissionAnswerAvailability({ ...READY, prompt: noYes }, 'allow').reason).toBe(
      agentPermissionAnswerOptionMissingReason('allow')
    )
    expect(getAgentPermissionAnswerAvailability({ ...READY, prompt: noYes }, 'deny').reason).toBeNull()
  })

  it('copilot の permissionDown(カーソルが最後の選択肢)は、copilot の番号キーの理由', () => {
    const prompt = readPrompt('copilot', copilotScreen('permissionDown').lines)
    expect(
      getAgentPermissionAnswerAvailability({ ...READY, cliKind: 'copilot', prompt }, 'allow').reason
    ).toBe(agentPermissionAnswerNumberKeysRejectedReason('copilot'))
  })
})

describe('checkAgentPermissionAnswerAtPress', () => {
  const readerOf = (lines: readonly ViewportLine[]): ReturnType<typeof vi.fn<() => readonly ViewportLine[]>> =>
    vi.fn<() => readonly ViewportLine[]>(() => lines)

  it.each<[AgentPermissionChoice, number]>([
    ['allow', 1],
    ['deny', 4]
  ])('押せて、押した時点の画面が描画と同じなら send(%s は %d 番)。画面は 1 回だけ読む', (choice, number) => {
    const readScreen = readerOf(CLAUDE_SCREEN)
    expect(checkAgentPermissionAnswerAtPress(READY, choice, readScreen)).toEqual({
      kind: 'send',
      optionNumber: number
    })
    expect(readScreen).toHaveBeenCalledOnce()
  })

  it('copilot の拒否は 2 番', () => {
    expect(
      checkAgentPermissionAnswerAtPress(
        { ...READY, cliKind: 'copilot', prompt: COPILOT_PROMPT },
        'deny',
        readerOf(COPILOT_SCREEN)
      )
    ).toEqual({ kind: 'send', optionNumber: 2 })
  })

  it.each<[string, Partial<AgentPermissionAnswerAvailabilityInput>, string]>([
    ['送信中', { isSending: true }, AGENT_PERMISSION_ANSWER_DISABLED_SENDING],
    ['確認の表示中', { isSendConfirmOpen: true }, AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM],
    ['中断の流れの間', { isInterrupting: true }, AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING],
    ['答えた直後', { isAnswering: true }, AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN],
    ['許可待ちでない', { activity: 'working' }, agentPermissionAnswerNotPermissionReason('claude')]
  ])('段階 (a) %s で止まれば、画面を読まずに blocked', (_name, change, reason) => {
    const readScreen = readerOf(CLAUDE_SCREEN)
    expect(checkAgentPermissionAnswerAtPress({ ...READY, ...change }, 'allow', readScreen)).toEqual({
      kind: 'blocked',
      reason
    })
    expect(readScreen).not.toHaveBeenCalled()
  })

  it('段階 (b): 押した時点の画面が許可待ちでなければ blocked(許可待ちではなくなりました)', () => {
    expect(
      checkAgentPermissionAnswerAtPress(READY, 'allow', readerOf(agentScreen('empty').lines))
    ).toEqual({ kind: 'blocked', reason: agentPermissionAnswerNoLongerPermissionReason('claude') })
  })

  it('段階 (b): readScreen が投げたら unreadable', () => {
    const error = new Error('disposed')
    expect(
      checkAgentPermissionAnswerAtPress(READY, 'allow', () => {
        throw error
      })
    ).toEqual({ kind: 'unreadable', error })
  })

  it('段階 (d): 描画は permission、押した時点は permissionDown(copilot)なら番号キーの理由', () => {
    expect(
      checkAgentPermissionAnswerAtPress(
        { ...READY, cliKind: 'copilot', prompt: COPILOT_PROMPT },
        'allow',
        readerOf(copilotScreen('permissionDown').lines)
      )
    ).toEqual({ kind: 'blocked', reason: agentPermissionAnswerNumberKeysRejectedReason('copilot') })
  })

  it('段階 (d) は (e) より先: claude で Tab を押して Yes を入力の形にした画面(文言が変わり Tab to amend が消える)は番号キーの理由', () => {
    const amended = withRow(withRow(CLAUDE_SCREEN, 18, ' ❯ 1. Yes, '), 24, ' Esc to cancel')
    expect(checkAgentPermissionAnswerAtPress(READY, 'allow', readerOf(amended))).toEqual({
      kind: 'blocked',
      reason: agentPermissionAnswerNumberKeysRejectedReason('claude')
    })
  })

  it('段階 (e): 本文(コマンド)だけを変えた画面は、内容が変わった', () => {
    const changed = withRow(CLAUDE_SCREEN, 15, ' rm -rf build')
    expect(checkAgentPermissionAnswerAtPress(READY, 'allow', readerOf(changed))).toEqual({
      kind: 'blocked',
      reason: AGENT_PERMISSION_ANSWER_PROMPT_CHANGED
    })
  })

  it('段階 (c): 押した時点の画面の形が崩れていれば(カーソルの行が 2 つ)読み取れない', () => {
    const broken = withRow(CLAUDE_SCREEN, 22, ' ❯ 4. No')
    expect(checkAgentPermissionAnswerAtPress(READY, 'allow', readerOf(broken))).toEqual({
      kind: 'blocked',
      reason: AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE
    })
  })
})
```

- [ ] **Step 4: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/shared/__tests__/agentCliKinds.test.ts src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/lib/__tests__/agentPermissionAnswerMessages.test.ts src/renderer/src/lib/__tests__/agentPermissionAnswer.test.ts`
Expected: FAIL(`permissionAnswer` が能力に無い・新しいファイルが無い)

- [ ] **Step 5: 能力の表と名前の表を実装する**

`src/shared/agentCliKinds.ts` の `AgentCliCapabilities` の `interrupt` の次に足す:

```ts
  /** 帯の 許可・拒否(許可の確認に選択肢の番号キーを送る。設計書 2026-11-06)。出す条件が screenActivity の permission なので、
   *  true なら screenActivity も true。main では能力で拒否しない(中断と同じ) */
  permissionAnswer: boolean
```

`AGENT_CLI_PROFILES` の `claude`・`copilot` の `capabilities` の `interrupt: true,` の次に `permissionAnswer: true,` を足す。

`src/renderer/src/lib/agentCliMessages.ts` の `AGENT_CLI_CAPABILITY_NAMES` の `interrupt: '中断',` の次に足す:

```ts
  permissionAnswer: '許可の確認への答え（帯の 許可・拒否）',
```

`src/renderer/src/__tests__/agentCliCapabilityOverrides.ts`:

1. `unsupportedKinds` の説明を「画面の判定(screenActivity)・中断(interrupt)・許可の確認への答え(permissionAnswer)を偽にする種類」にする
2. `overrideAgentCliCapabilities` の `if (overrides.unsupportedKinds.has(kind)) { ... }` の中に `capabilities.permissionAnswer = false` を足し、関数の説明に「(不変条件「interrupt・permissionAnswer が真なら screenActivity も真」を保つため、1 つ目は 3 つとも偽にする)」と書く

- [ ] **Step 6: 文言を実装する(`agentPermissionAnswerMessages.ts`)**

```ts
// src/renderer/src/lib/agentPermissionAnswerMessages.ts
import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentPermissionAnswerResult } from '@shared/types'
import type { AgentPermissionChoice } from './agentPermissionPrompt'

// 帯の 許可・拒否 の文言(ボタンの名前・押せない理由・読み上げ・送れなかったときの文言。設計書 2026-11-06「画面」「エラー処理」)。
// CLI で違う部分(番号キーが効かないときの理由・拒否の後の案内)は種類ごとの表で引き、CLI の名前は AGENT_CLI_PROFILES のコマンド名から
// 作る(直書きしない)。押せるかの判定(どの理由を選ぶかの順)は agentPermissionAnswer.ts に置く

interface AgentPermissionAnswerTexts {
  /** 番号キーが選択肢の選択として効かない画面の理由 */
  numberKeysRejected: string
  /** 拒否を送れた後の読み上げに足す案内(拒否が即決せず入力欄を開く種類だけ。即決する種類は null) */
  denyFollowUp: string | null
}

/** CLI ごとの文言。種類を足したときの決め忘れを型エラーにする */
export const AGENT_PERMISSION_ANSWER_TEXTS: Record<AgentCliKind, AgentPermissionAnswerTexts> = {
  claude: {
    numberKeysRejected:
      'カーソルが Yes・No 以外にあるか、答えの文の入力欄が開いているため押せません（ターミナルで答えてください）',
    denyFollowUp: null
  },
  copilot: {
    numberKeysRejected: `${AGENT_CLI_PROFILES.copilot.commandName} は、代わりにしてほしいことの入力を待っています（ターミナルで入力して Enter を押してください。何も入れずに Esc を押すと操作ごと取り消します）`,
    denyFollowUp: 'ターミナルで、代わりにしてほしいことを入力して Enter を押してください'
  }
}

/** 選択肢ごとの見える文字と、名前・理由に出す選択肢の語 */
const CHOICE_TEXTS: Record<AgentPermissionChoice, { label: string; optionWord: string }> = {
  allow: { label: '許可', optionWord: 'Yes' },
  deny: { label: '拒否', optionWord: 'No' }
}

export const AGENT_PERMISSION_ALLOW_LABEL = CHOICE_TEXTS.allow.label
export const AGENT_PERMISSION_DENY_LABEL = CHOICE_TEXTS.deny.label

export function agentPermissionAnswerLabel(choice: AgentPermissionChoice): string {
  return CHOICE_TEXTS[choice].label
}

/**
 * ボタンの aria-label。見える文字で始める(パターン 76)。tabLabel は formatAgentTabLabel。問いの 1 行目と番号のどちらかが無いとき
 * (読み取れない・その選択肢が無い)は「許可の確認に Yes で答える」
 */
export function agentPermissionAnswerAriaLabel(
  choice: AgentPermissionChoice,
  tabLabel: string,
  questionFirstLine: string | null,
  optionNumber: number | null
): string {
  const { label, optionWord } = CHOICE_TEXTS[choice]
  if (questionFirstLine === null || optionNumber === null) {
    return `${label}（${tabLabel} の許可の確認に ${optionWord} で答える）`
  }
  return `${label}（${tabLabel} の「${questionFirstLine}」に ${optionNumber} 番の ${optionWord} で答える）`
}

/** セッションが動いていない(帯には出さないが、押した処理の判定でも同じ純関数を使うため理由を持つ) */
export function agentPermissionAnswerNotRunningReason(commandName: string): string {
  return `${commandName} が動いていないため答えられません`
}
/** 能力の表の permissionAnswer が false の種類(帯には出さない) */
export function agentPermissionAnswerUnsupportedReason(commandName: string): string {
  return `${commandName} では許可のボタンを使えません（ターミナルで答えてください）`
}
/** 活動が permission でない(帯には出さない) */
export function agentPermissionAnswerNotPermissionReason(commandName: string): string {
  return `${commandName} は許可待ちではありません`
}
export const AGENT_PERMISSION_ANSWER_DISABLED_CLOSING = '閉じる途中のタブでは答えられません'
export const AGENT_PERMISSION_ANSWER_DISABLED_SENDING = 'プロンプトを送信している間は答えられません'
export const AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM =
  '送信前の確認を開いている間は答えられません'
export const AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING =
  '中断を送った直後は答えられません（少し待つと押せます）'
/** 送っている途中・押してから 1,000ms 以内・送った後の画面を読み直す前 */
export const AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN =
  '答えを押した直後です（少し待つと押せます）'
export const AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE =
  '画面の選択肢を読み取れませんでした（ターミナルで答えてください）'
export function agentPermissionAnswerNumberKeysRejectedReason(kind: AgentCliKind): string {
  return AGENT_PERMISSION_ANSWER_TEXTS[kind].numberKeysRejected
}
export function agentPermissionAnswerOptionMissingReason(choice: AgentPermissionChoice): string {
  return `画面に「${CHOICE_TEXTS[choice].optionWord}」の選択肢が見つかりません（ターミナルで答えてください）`
}
/** 押した時点の読み直しで許可待ちでなかった */
export function agentPermissionAnswerNoLongerPermissionReason(commandName: string): string {
  return `${commandName} は許可待ちではなくなりました。画面を確かめてください`
}
/** 押した時点の読み直しで、本文・問い・選択肢が描画のものと違った */
export const AGENT_PERMISSION_ANSWER_PROMPT_CHANGED =
  '許可の確認の内容が変わりました。帯の表示を確かめてからもう一度押してください'

/** 送れたときの読み上げ(label は押した時点のタブの名前、optionNumber は送った番号) */
export function agentPermissionAnswerSentNotice(
  label: string,
  kind: AgentCliKind,
  choice: AgentPermissionChoice,
  optionNumber: number
): string {
  const { label: choiceLabel, optionWord } = CHOICE_TEXTS[choice]
  const followUp = AGENT_PERMISSION_ANSWER_TEXTS[kind].denyFollowUp
  if (choice === 'deny' && followUp !== null) {
    return `${label} で${choiceLabel}（${optionNumber} 番）を選びました。${followUp}`
  }
  return `${label} に${choiceLabel}（${optionNumber} 番の ${optionWord}）を送りました`
}

/** 送れなかったときの文言の接頭辞(AGENT_INTERRUPT_ERROR_PREFIX と同じ形)。送れたときは、この接頭辞で始まる error だけを消す */
export const AGENT_PERMISSION_ANSWER_ERROR_PREFIX = '許可の答えを送れませんでした: '
/** main が返した失敗(IPC の結果の型の sent 以外から作り、種類を写し直さない) */
export type AgentPermissionAnswerFailureKind = Exclude<AgentPermissionAnswerResult['kind'], 'sent'>
export function agentPermissionAnswerFailureError(
  kind: AgentPermissionAnswerFailureKind,
  commandName: string
): string {
  switch (kind) {
    case 'no-session':
      return `${AGENT_PERMISSION_ANSWER_ERROR_PREFIX}${commandName} が終了したか、起動し直しました`
    case 'write-failed':
      return `${AGENT_PERMISSION_ANSWER_ERROR_PREFIX}ターミナルへの書き込みに失敗しました`
  }
}
/** invoke の拒否・window.api の同期の例外 */
export function agentPermissionAnswerError(message: string): string {
  return `${AGENT_PERMISSION_ANSWER_ERROR_PREFIX}${message}`
}
```

- [ ] **Step 7: 押せるかの判定を実装する(`agentPermissionAnswer.ts`)**

```ts
// src/renderer/src/lib/agentPermissionAnswer.ts
import { AGENT_CLI_PROFILES, agentCliCapabilities } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentActivity } from './agentActivity'
import type { AgentSessionStatus } from './agentSessionTabState'
import type { ViewportLine } from './agentViewport'
import { classifyAgentScreenFor } from './agentScreenClassifiers'
import type {
  AgentPermissionChoice,
  AgentPermissionOption,
  AgentPermissionPrompt
} from './agentPermissionPrompt'
import { findAgentPermissionOption, isSameAgentPermissionPrompt } from './agentPermissionPrompt'
import { AGENT_PERMISSION_PROMPT_READERS } from './agentPermissionPromptReaders'
import {
  AGENT_PERMISSION_ANSWER_DISABLED_CLOSING,
  AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN,
  AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING,
  AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM,
  AGENT_PERMISSION_ANSWER_DISABLED_SENDING,
  AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE,
  AGENT_PERMISSION_ANSWER_PROMPT_CHANGED,
  agentPermissionAnswerNoLongerPermissionReason,
  agentPermissionAnswerNotPermissionReason,
  agentPermissionAnswerNotRunningReason,
  agentPermissionAnswerNumberKeysRejectedReason,
  agentPermissionAnswerOptionMissingReason,
  agentPermissionAnswerUnsupportedReason
} from './agentPermissionAnswerMessages'

// 帯の 許可・拒否 を押せるかの判定(設計書 2026-11-06「押せるかの判定」)。描画(useAgentPermissionAnswer の disabledReason)と、押した処理の
// 先頭の判定(checkAgentPermissionAnswerAtPress の段階 (a)。L-058)で同じ関数を使う。押した時点の画面の読み直し(段階 (b)〜(f))もここで決める

/**
 * 押してから、そのタブの 許可・拒否 を押せない間。claude は許可した直後に同じ問い・選択肢・本文の許可の確認を続けて出すことがあり、
 * 照合では区別できないため、2 回目のタップが読んでいない確認に答えるのを防ぐ。値は中断と同じ(L-408)
 */
export const AGENT_PERMISSION_ANSWER_COOLDOWN_MS = 1_000

export interface AgentPermissionAnswerAvailabilityInput {
  status: AgentSessionStatus
  cliKind: AgentCliKind
  isClosing: boolean
  activity: AgentActivity
  isSending: boolean
  isSendConfirmOpen: boolean
  /** 対象のタブが中断の流れの間(useAgentInterrupt の isInterruptPending / isInterrupting) */
  isInterrupting: boolean
  /**
   * 対象のタブが、答えを送っている途中か、押してから 1,000ms 以内か、送った後の画面の読み直し待ち(タブごと。3 つの和。
   * useAgentPermissionAnswerCooldown の isPending / isPendingNow)。読み直し待ちを含めるので、読み直す前に prompt が null でも
   * 「読み取れない」ではなく「答えを押した直後です」の理由になる
   */
  isAnswering: boolean
  /** 描画に使った読み取り(useAgentPermissionPrompt の prompt) */
  prompt: AgentPermissionPrompt | null
}

export interface AgentPermissionAnswerAvailability {
  /** 帯に出すか(running・能力あり・permission) */
  visible: boolean
  /** 押せない理由。押せるなら null */
  reason: string | null
  /** 押せるときに送る選択肢(押せないときは null) */
  option: AgentPermissionOption | null
}

const commandNameOf = (kind: AgentCliKind): string => AGENT_CLI_PROFILES[kind].commandName

/** 帯に出さない理由(動いていない → 能力が無い → 許可待ちでない) */
function hiddenReasonOf(input: AgentPermissionAnswerAvailabilityInput): string | null {
  // starting の間は活動が unknown なので許可待ちにならない。running だけで出す
  if (input.status !== 'running') return agentPermissionAnswerNotRunningReason(commandNameOf(input.cliKind))
  if (!agentCliCapabilities(input.cliKind).permissionAnswer) {
    return agentPermissionAnswerUnsupportedReason(commandNameOf(input.cliKind))
  }
  if (input.activity !== 'permission') {
    return agentPermissionAnswerNotPermissionReason(commandNameOf(input.cliKind))
  }
  return null
}

/** 帯に出したうえで押せない理由のうち、画面の読み取りに依らないもの(閉じる途中 → 送信中 → 確認の表示中 → 中断の流れ → 答えた直後) */
function flagReasonOf(input: AgentPermissionAnswerAvailabilityInput): string | null {
  if (input.isClosing) return AGENT_PERMISSION_ANSWER_DISABLED_CLOSING
  if (input.isSending) return AGENT_PERMISSION_ANSWER_DISABLED_SENDING
  if (input.isSendConfirmOpen) return AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM
  if (input.isInterrupting) return AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING
  if (input.isAnswering) return AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN
  return null
}

type PromptJudgement = { reason: string; option: null } | { reason: null; option: AgentPermissionOption }

/** 読み取りに依る理由(読み取れない → 番号キーが効かない → その選択肢が無い)。どれにも当たらなければ送る選択肢 */
function judgePrompt(
  prompt: AgentPermissionPrompt | null,
  cliKind: AgentCliKind,
  choice: AgentPermissionChoice
): PromptJudgement {
  if (prompt === null) return { reason: AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE, option: null }
  if (!prompt.numberKeysAccepted) {
    return { reason: agentPermissionAnswerNumberKeysRejectedReason(cliKind), option: null }
  }
  const option = findAgentPermissionOption(prompt, choice)
  if (option === null) return { reason: agentPermissionAnswerOptionMissingReason(choice), option: null }
  return { reason: null, option }
}

export function getAgentPermissionAnswerAvailability(
  input: AgentPermissionAnswerAvailabilityInput,
  choice: AgentPermissionChoice
): AgentPermissionAnswerAvailability {
  const hidden = hiddenReasonOf(input)
  if (hidden !== null) return { visible: false, reason: hidden, option: null }
  const flagReason = flagReasonOf(input)
  if (flagReason !== null) return { visible: true, reason: flagReason, option: null }
  return { visible: true, ...judgePrompt(input.prompt, input.cliKind, choice) }
}

/** 押した時点の判定の結果(useAgentPermissionAnswer の手順 2) */
export type AgentPermissionAnswerPressCheck =
  /** optionNumber は押した時点の読み取りの選択肢の番号(送る値はこれだけ。L-594) */
  | { kind: 'send'; optionNumber: number }
  /** 押せない(理由を読み上げる) */
  | { kind: 'blocked'; reason: string }
  /** 画面を読めない(送らず、読み上げもしない。呼び出し側が console に記録する) */
  | { kind: 'unreadable'; error: unknown }

/**
 * 押した時点の値で送ってよいかを決める(設計書「押した時点の判定のやり直し」の段階 (a)〜(g))。
 * (a) 描画と同じ規則の可否(画面は読まない) → (b) 画面を 1 回だけ読み、許可待ちか → (c) 同じ行を読み取れるか → (d) 番号キーが効くか →
 * (e) 描画の読み取りと完全一致か(L-036) → (f) その選択肢があるか → (g) 送る。(d) を (e) より先に見るのは、入力欄が開いた画面は
 * 選択肢の文言も変わりうるが、利用者に役立つのは入力欄のほうの理由のため
 */
export function checkAgentPermissionAnswerAtPress(
  input: AgentPermissionAnswerAvailabilityInput,
  choice: AgentPermissionChoice,
  readScreen: () => readonly ViewportLine[]
): AgentPermissionAnswerPressCheck {
  const { reason } = getAgentPermissionAnswerAvailability(input, choice)
  if (reason !== null) return { kind: 'blocked', reason }
  let lines: readonly ViewportLine[]
  try {
    lines = readScreen()
  } catch (error) {
    return { kind: 'unreadable', error }
  }
  if (classifyAgentScreenFor(input.cliKind, lines) !== 'permission') {
    return {
      kind: 'blocked',
      reason: agentPermissionAnswerNoLongerPermissionReason(commandNameOf(input.cliKind))
    }
  }
  const pressed = AGENT_PERMISSION_PROMPT_READERS[input.cliKind](lines)
  if (pressed === null) return { kind: 'blocked', reason: AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE }
  if (!pressed.numberKeysAccepted) {
    return { kind: 'blocked', reason: agentPermissionAnswerNumberKeysRejectedReason(input.cliKind) }
  }
  // (a) を通ったので input.prompt は null でない(型のために確かめる)
  if (input.prompt === null || !isSameAgentPermissionPrompt(input.prompt, pressed)) {
    return { kind: 'blocked', reason: AGENT_PERMISSION_ANSWER_PROMPT_CHANGED }
  }
  const option = findAgentPermissionOption(pressed, choice)
  if (option === null) return { kind: 'blocked', reason: agentPermissionAnswerOptionMissingReason(choice) }
  return { kind: 'send', optionNumber: option.number }
}
```

- [ ] **Step 8: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/shared/__tests__/agentCliKinds.test.ts src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/lib/__tests__/agentPermissionAnswerMessages.test.ts src/renderer/src/lib/__tests__/agentPermissionAnswer.test.ts`
Expected: PASS

能力の表を変えたので、能力を使う既存のテストもまとめて流す: `NODE_ENV=test npx vitest run src/renderer/src/lib src/shared`
Expected: PASS

続けて: `npm run typecheck` と `npx eslint src/shared/agentCliKinds.ts src/renderer/src/lib/agentCliMessages.ts src/renderer/src/__tests__/agentCliCapabilityOverrides.ts src/renderer/src/lib/agentPermissionAnswerMessages.ts src/renderer/src/lib/agentPermissionAnswer.ts src/shared/__tests__/agentCliKinds.test.ts src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/lib/__tests__/agentPermissionAnswerMessages.test.ts src/renderer/src/lib/__tests__/agentPermissionAnswer.test.ts --max-warnings 0`

---

### Task 4: 答えの待ちと、描画に使う読み取りの hook

**Files:**
- Create: `src/renderer/src/hooks/useAgentPermissionAnswerCooldown.ts`
- Create: `src/renderer/src/hooks/useAgentPermissionPrompt.ts`
- Test: `src/renderer/src/hooks/__tests__/useAgentPermissionAnswerCooldown.test.ts`
- Test: `src/renderer/src/hooks/__tests__/useAgentPermissionPrompt.test.ts`

**Interfaces:**
- Consumes: `AGENT_PERMISSION_ANSWER_COOLDOWN_MS`(Task 3)、`AgentPermissionPrompt`・`isSameAgentPermissionPrompt`(Task 1)、`AGENT_PERMISSION_PROMPT_READERS`(Task 1)、`AgentCliCapabilities.permissionAnswer`(Task 3)、既存の `AGENT_ACTIVITY_SETTLE_MS`(`hooks/useAgentActivity.ts`)・`classifyAgentScreenFor`
- Produces(`hooks/useAgentPermissionAnswerCooldown.ts`):
  ```ts
  export interface AgentPermissionAnswerCooldown {
    isPending: (slotId: string) => boolean      // 描画用(state)。送っている途中・1,000ms・読み直し待ちの和
    isPendingNow: (slotId: string) => boolean   // 押した時点用(ref。参照は安定)
    isInFlight: (slotId: string) => boolean     // 押した時点用(ref。参照は安定)
    isAwaitingReread: (slotId: string) => boolean // 描画用(state)
    begin: (slotId: string) => void             // 参照は安定
    finish: (slotId: string) => void            // 参照は安定
    markReread: (slotId: string) => void        // 参照は安定
  }
  export function useAgentPermissionAnswerCooldown(): AgentPermissionAnswerCooldown
  ```
- Produces(`hooks/useAgentPermissionPrompt.ts`):
  ```ts
  export type AgentPermissionPromptTab = Pick<AgentSessionTabView, 'slotId' | 'status' | 'cliKind'> & {
    controller: Pick<AgentTerminalController, 'onOutputWritten' | 'readScreen'>
  }
  export interface UseAgentPermissionPromptOptions {
    selected: AgentPermissionPromptTab
    activity: AgentActivity
    isAwaitingReread: (slotId: string) => boolean
    onReread: (slotId: string) => void
  }
  export interface AgentPermissionPromptState { prompt: AgentPermissionPrompt | null }
  export function useAgentPermissionPrompt(options: UseAgentPermissionPromptOptions): AgentPermissionPromptState
  ```

**気をつける点:**
- L-101・L-653: 送っている途中は ref の `Set<slotId>` で持ち、state は描画用。`begin` の直後に同じ同期の処理の中で `isInFlight` が真になること
- L-408: 読み直し待ちの間は前の読み取りで押させない(`prompt: null`)。読み直しの控えの更新と `onReread` を同じコールバックで呼び、待ちが外れた描画で `prompt` が null のまま見えないこと
- タイマー・購読はアンマウントで消す(L-052)。テストは偽のタイマーで、`afterEach` で戻す
- effect の本体に `setState` を直に書かない。effect の中で定義したローカル関数(`commit`)を通す(`useAgentActivity.ts` の `commit` と同じ)。`eslint-plugin-react-hooks` の `react-hooks/set-state-in-effect` に当たったら、`useAgentActivity.ts` と同じ形(ローカル関数を通している)であることを確かめたうえで、その 1 行に理由付きの `// eslint-disable-next-line react-hooks/set-state-in-effect -- 描画の前に読む(設計書 2026-11-06「描画に使う読み取り」)` を付ける

- [ ] **Step 1: 失敗するテストを書く(待ち)**

```ts
// src/renderer/src/hooks/__tests__/useAgentPermissionAnswerCooldown.test.ts
import { act, renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAgentPermissionAnswerCooldown } from '../useAgentPermissionAnswerCooldown'
import { AGENT_PERMISSION_ANSWER_COOLDOWN_MS } from '../../lib/agentPermissionAnswer'

// 待ちの長さの値(1,000ms)は agentPermissionAnswer.test.ts で固定し、ここでは定数を基準に境界を確かめる

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('useAgentPermissionAnswerCooldown', () => {
  it('始める前は、どのタブも待っていない', () => {
    const { result } = renderHook(() => useAgentPermissionAnswerCooldown())
    expect(result.current.isPending('slot-1')).toBe(false)
    expect(result.current.isPendingNow('slot-1')).toBe(false)
    expect(result.current.isInFlight('slot-1')).toBe(false)
    expect(result.current.isAwaitingReread('slot-1')).toBe(false)
  })

  it('begin で送っている途中・1,000ms・読み直し待ちが同時に始まる(ref は同期で、state は次の描画で)', () => {
    const { result } = renderHook(() => useAgentPermissionAnswerCooldown())
    act(() => {
      result.current.begin('slot-1')
      // 同じ同期の処理の中で読める(同期の再入の防止。L-101・L-653)
      expect(result.current.isInFlight('slot-1')).toBe(true)
      expect(result.current.isPendingNow('slot-1')).toBe(true)
    })
    expect(result.current.isPending('slot-1')).toBe(true)
    expect(result.current.isAwaitingReread('slot-1')).toBe(true)
    expect(result.current.isPending('slot-2')).toBe(false)
    expect(result.current.isAwaitingReread('slot-2')).toBe(false)
  })

  it('finish は送っている途中だけを解く(1,000ms と読み直し待ちは残る)', () => {
    const { result } = renderHook(() => useAgentPermissionAnswerCooldown())
    act(() => result.current.begin('slot-1'))
    act(() => result.current.finish('slot-1'))
    expect(result.current.isInFlight('slot-1')).toBe(false)
    expect(result.current.isAwaitingReread('slot-1')).toBe(true)
    expect(result.current.isPending('slot-1')).toBe(true)
    expect(result.current.isPendingNow('slot-1')).toBe(true)
  })

  it('markReread の前は、1,000ms を過ぎても待ちのまま', () => {
    const { result } = renderHook(() => useAgentPermissionAnswerCooldown())
    act(() => result.current.begin('slot-1'))
    act(() => result.current.finish('slot-1'))
    act(() => {
      vi.advanceTimersByTime(AGENT_PERMISSION_ANSWER_COOLDOWN_MS * 3)
    })
    expect(result.current.isPending('slot-1')).toBe(true)
    expect(result.current.isPendingNow('slot-1')).toBe(true)
    act(() => result.current.markReread('slot-1'))
    expect(result.current.isPending('slot-1')).toBe(false)
    expect(result.current.isPendingNow('slot-1')).toBe(false)
  })

  it('1,000ms の前に markReread しても、1,000ms までは待ち(999ms は待ち・1,000ms で明ける)', () => {
    const { result } = renderHook(() => useAgentPermissionAnswerCooldown())
    act(() => result.current.begin('slot-1'))
    act(() => result.current.finish('slot-1'))
    act(() => result.current.markReread('slot-1'))
    expect(result.current.isAwaitingReread('slot-1')).toBe(false)
    act(() => {
      vi.advanceTimersByTime(AGENT_PERMISSION_ANSWER_COOLDOWN_MS - 1)
    })
    expect(result.current.isPending('slot-1')).toBe(true)
    expect(result.current.isPendingNow('slot-1')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.isPending('slot-1')).toBe(false)
    expect(result.current.isPendingNow('slot-1')).toBe(false)
  })

  it('待ちでないタブの markReread は何もしない(描画を増やさない)', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useAgentPermissionAnswerCooldown()
    })
    const before = renders
    act(() => result.current.markReread('slot-1'))
    expect(renders).toBe(before)
  })

  it('待ちはタブごと(slot-1 の待ちの間も slot-2 は待っていない)', () => {
    const { result } = renderHook(() => useAgentPermissionAnswerCooldown())
    act(() => result.current.begin('slot-1'))
    expect(result.current.isPendingNow('slot-2')).toBe(false)
    act(() => result.current.begin('slot-2'))
    act(() => result.current.markReread('slot-2'))
    act(() => result.current.finish('slot-2'))
    act(() => {
      vi.advanceTimersByTime(AGENT_PERMISSION_ANSWER_COOLDOWN_MS)
    })
    expect(result.current.isPending('slot-2')).toBe(false)
    expect(result.current.isPending('slot-1')).toBe(true)
  })

  it('begin・finish・markReread・isPendingNow・isInFlight の参照は描画をまたいで同じ', () => {
    const { result } = renderHook(() => useAgentPermissionAnswerCooldown())
    const first = result.current
    act(() => result.current.begin('slot-1'))
    expect(result.current.begin).toBe(first.begin)
    expect(result.current.finish).toBe(first.finish)
    expect(result.current.markReread).toBe(first.markReread)
    expect(result.current.isPendingNow).toBe(first.isPendingNow)
    expect(result.current.isInFlight).toBe(first.isInFlight)
  })

  it('アンマウントでタイマーを残さない', () => {
    const { result, unmount } = renderHook(() => useAgentPermissionAnswerCooldown())
    act(() => result.current.begin('slot-1'))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
```

- [ ] **Step 2: 失敗するテストを書く(描画に使う読み取り)**

```ts
// src/renderer/src/hooks/__tests__/useAgentPermissionPrompt.test.ts
import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { useAgentPermissionPrompt } from '../useAgentPermissionPrompt'
import type { AgentPermissionPromptState, AgentPermissionPromptTab } from '../useAgentPermissionPrompt'
import { useAgentPermissionAnswerCooldown } from '../useAgentPermissionAnswerCooldown'
import type { AgentPermissionAnswerCooldown } from '../useAgentPermissionAnswerCooldown'
import { AGENT_ACTIVITY_SETTLE_MS } from '../useAgentActivity'
import { AGENT_PERMISSION_ANSWER_COOLDOWN_MS } from '../../lib/agentPermissionAnswer'
import type { AgentPermissionPrompt } from '../../lib/agentPermissionPrompt'
import type { AgentActivity } from '../../lib/agentActivity'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'
import { agentScreen } from '../../lib/__tests__/fixtures/agentScreens'
import { copilotScreen } from '../../lib/__tests__/fixtures/copilotScreens'

interface Props {
  selected: AgentPermissionPromptTab
  activity: AgentActivity
}
interface Rendered {
  cooldown: AgentPermissionAnswerCooldown
  state: AgentPermissionPromptState
}
interface RenderLog {
  awaiting: boolean
  prompt: AgentPermissionPrompt | null
}

let controller1: FakeController
let controller2: FakeController
let consoleErrorSpy: MockInstance<typeof console.error> | null = null

const tabOf = (
  slotId: string,
  controller: FakeController,
  overrides: Partial<AgentPermissionPromptTab> = {}
): AgentPermissionPromptTab => ({ slotId, status: 'running', cliKind: 'claude', controller, ...overrides })

// 本物の待ち(useAgentPermissionAnswerCooldown)と組にして使う(useAgentWorkspace と同じ渡し方)。描画ごとの値を控える
function render(initial: Partial<Props> = {}): RenderHookResult<Rendered, Props> & { log: RenderLog[] } {
  const log: RenderLog[] = []
  const rendered = renderHook(
    (p: Props) => {
      const cooldown = useAgentPermissionAnswerCooldown()
      const state = useAgentPermissionPrompt({
        ...p,
        isAwaitingReread: cooldown.isAwaitingReread,
        onReread: cooldown.markReread
      })
      log.push({ awaiting: cooldown.isAwaitingReread(p.selected.slotId), prompt: state.prompt })
      return { cooldown, state }
    },
    { initialProps: { selected: tabOf('slot-1', controller1), activity: 'permission', ...initial } }
  )
  return { ...rendered, log }
}

const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  controller1 = makeFakeController()
  controller1.screen = agentScreen('permission').lines
  controller2 = makeFakeController()
  controller2.screen = agentScreen('permission').lines
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = null
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('useAgentPermissionPrompt', () => {
  it('許可待ちになった描画で、通知を待たずに画面を読む', () => {
    const { result } = render()
    expect(result.current.state.prompt?.question).toEqual(['Do you want to proceed?'])
    expect(result.current.state.prompt?.cursorNumber).toBe(1)
  })

  // controller1 は beforeEach で作るので、表には値ではなく作り方を置く
  it.each<[string, () => Partial<Props>]>([
    ['許可待ちでない', () => ({ activity: 'working' })],
    ['running でない', () => ({ selected: tabOf('slot-1', controller1, { status: 'starting' }) })]
  ])('%s 間は null で、購読もタイマーも持たない', (_name, propsOf) => {
    const { result } = render(propsOf())
    expect(result.current.state.prompt).toBeNull()
    expect(controller1.outputWrittenListeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('出力の通知の 150ms 後に読み直す(149ms では読まない)', () => {
    controller1.screen = copilotScreen('permission').lines
    const { result } = render({ selected: tabOf('slot-1', controller1, { cliKind: 'copilot' }) })
    expect(result.current.state.prompt?.cursorNumber).toBe(1)
    controller1.screen = copilotScreen('permissionDown').lines
    act(() => controller1.emitOutputWritten())
    advance(AGENT_ACTIVITY_SETTLE_MS - 1)
    expect(result.current.state.prompt?.cursorNumber).toBe(1)
    advance(1)
    expect(result.current.state.prompt?.cursorNumber).toBe(2)
    expect(result.current.state.prompt?.numberKeysAccepted).toBe(false)
  })

  it('読み直した値が前と同じなら state を変えない(描画を増やさない)', () => {
    const { log } = render()
    const before = log.length
    act(() => controller1.emitOutputWritten())
    advance(AGENT_ACTIVITY_SETTLE_MS)
    expect(log.length).toBe(before)
  })

  it('許可待ちでなくなると null を返し、購読を外す', () => {
    const { result, rerender } = render()
    expect(controller1.outputWrittenListeners.size).toBe(1)
    rerender({ selected: tabOf('slot-1', controller1), activity: 'working' })
    expect(result.current.state.prompt).toBeNull()
    expect(controller1.outputWrittenListeners.size).toBe(0)
  })

  it('タブを切り替えると、切り替えた先のタブの画面を読む', () => {
    controller2.screen = agentScreen('permissionAfterClear').lines
    const readSpy = vi.spyOn(controller2, 'readScreen')
    const { result, rerender } = render()
    rerender({ selected: tabOf('slot-2', controller2), activity: 'permission' })
    expect(readSpy).toHaveBeenCalled()
    expect(result.current.state.prompt).not.toBeNull()
    expect(controller1.outputWrittenListeners.size).toBe(0)
    expect(controller2.outputWrittenListeners.size).toBe(1)
  })

  it('読み直し待ちになった描画で null を返し、次の出力の通知の 150ms 後に読み直す。読み取りの更新と読み直し待ちの解除は同じ描画に入る', () => {
    const { result, log } = render()
    act(() => result.current.cooldown.begin('slot-1'))
    expect(result.current.state.prompt).toBeNull()
    const startedAt = log.length
    act(() => controller1.emitOutputWritten())
    advance(AGENT_ACTIVITY_SETTLE_MS - 1)
    expect(result.current.cooldown.isAwaitingReread('slot-1')).toBe(true)
    advance(1)
    expect(result.current.cooldown.isAwaitingReread('slot-1')).toBe(false)
    expect(result.current.state.prompt).not.toBeNull()
    // 待ちが外れた描画で prompt が null のまま見えない(「画面の選択肢を読み取れませんでした」が一瞬出ない)
    expect(log.slice(startedAt).filter((entry) => !entry.awaiting && entry.prompt === null)).toEqual([])
  })

  it('読み直し待ちの間に出力が無くても、AGENT_PERMISSION_ANSWER_COOLDOWN_MS 後に読み直す(999ms は待ち)', () => {
    const { result } = render()
    act(() => result.current.cooldown.begin('slot-1'))
    advance(AGENT_PERMISSION_ANSWER_COOLDOWN_MS - 1)
    expect(result.current.cooldown.isAwaitingReread('slot-1')).toBe(true)
    expect(result.current.state.prompt).toBeNull()
    advance(1)
    expect(result.current.cooldown.isAwaitingReread('slot-1')).toBe(false)
    expect(result.current.state.prompt).not.toBeNull()
  })

  it('読み直し待ちで許可待ちでなくなったら(作業中)、すぐ読み直し待ちを外す', () => {
    const { result, rerender } = render()
    act(() => result.current.cooldown.begin('slot-1'))
    rerender({ selected: tabOf('slot-1', controller1), activity: 'working' })
    expect(result.current.cooldown.isAwaitingReread('slot-1')).toBe(false)
  })

  it('選択中でないタブの読み直し待ちは残り、そのタブを選んだ描画で読んで外れる', () => {
    const { result, rerender } = render()
    act(() => result.current.cooldown.begin('slot-2'))
    advance(AGENT_PERMISSION_ANSWER_COOLDOWN_MS * 2)
    expect(result.current.cooldown.isAwaitingReread('slot-2')).toBe(true)
    rerender({ selected: tabOf('slot-2', controller2), activity: 'permission' })
    expect(result.current.cooldown.isAwaitingReread('slot-2')).toBe(false)
    expect(result.current.state.prompt).not.toBeNull()
  })

  it('readScreen が投げたら null を控えて console に記録する', () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(controller1, 'readScreen').mockImplementation(() => {
      throw new Error('disposed')
    })
    const { result } = render()
    expect(result.current.state.prompt).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('アンマウントで購読とタイマーを残さない', () => {
    const { unmount } = render()
    act(() => controller1.emitOutputWritten())
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(controller1.outputWrittenListeners.size).toBe(0)
  })
})
```

- [ ] **Step 3: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useAgentPermissionAnswerCooldown.test.ts src/renderer/src/hooks/__tests__/useAgentPermissionPrompt.test.ts`
Expected: FAIL(hook のファイルが無い)

- [ ] **Step 4: 待ちを実装する(`useAgentPermissionAnswerCooldown.ts`)**

```ts
// src/renderer/src/hooks/useAgentPermissionAnswerCooldown.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { AGENT_PERMISSION_ANSWER_COOLDOWN_MS } from '../lib/agentPermissionAnswer'

// 帯の 許可・拒否 の、タブごとの「送っている途中」「押してから AGENT_PERMISSION_ANSWER_COOLDOWN_MS の待ち」「送った後の画面の読み直し待ち」の
// 控え(設計書 2026-11-06「押したときの処理」)。useAgentWorkspace が中断の hook と答えの hook より先に作り、両方へ渡す(中断も答えた直後は
// 押せない)。押した処理が読む最新の値(ref)と、描画が読む値(state)を両方持つ。作りは useAgentInterruptCooldown と同じで、
// restartCooldown は持たない。待ちのタイマーはアンマウントですべて消す(L-052)

export interface AgentPermissionAnswerCooldown {
  /** 描画用(state): 送っている途中・1,000ms・読み直し待ちのどれか。答えと中断の押せない理由に使う */
  isPending: (slotId: string) => boolean
  /** 押した時点用(ref。参照は安定): isPending と同じ間 */
  isPendingNow: (slotId: string) => boolean
  /** 押した時点用(ref。参照は安定): 送っている途中(同期の再入の防止。L-101・L-653) */
  isInFlight: (slotId: string) => boolean
  /** 描画用(state): 送った後の画面の読み直し待ち(useAgentPermissionPrompt が見る) */
  isAwaitingReread: (slotId: string) => boolean
  /** 送り始める: 3 つを同時に始める(1,000ms のタイマーは数え直す) */
  begin: (slotId: string) => void
  /** 結果が届いた(例外を含む): 送っている途中だけを解く */
  finish: (slotId: string) => void
  /** 送った後の画面を読み直した(または読む必要が無くなった): 読み直し待ちを解く。待ちでなければ何もしない */
  markReread: (slotId: string) => void
}

const withSlot = (
  set: ReadonlySet<string>,
  slotId: string,
  present: boolean
): ReadonlySet<string> => {
  if (set.has(slotId) === present) return set
  const next = new Set(set)
  if (present) next.add(slotId)
  else next.delete(slotId)
  return next
}

export function useAgentPermissionAnswerCooldown(): AgentPermissionAnswerCooldown {
  // 押した時点用の控え(state は次の描画まで変わらないため ref)。集合はタブごと
  const inFlightRef = useRef(new Set<string>())
  const awaitingRef = useRef(new Set<string>())
  // 1,000ms の待ちのタイマー(タブごと)。押した処理は、これで 1,000ms 以内かを読む
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // 描画用
  const [inFlightSlots, setInFlightSlots] = useState<ReadonlySet<string>>(() => new Set())
  const [coolingSlots, setCoolingSlots] = useState<ReadonlySet<string>>(() => new Set())
  const [awaitingSlots, setAwaitingSlots] = useState<ReadonlySet<string>>(() => new Set())
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    const timers = timersRef.current
    return () => {
      mountedRef.current = false
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const isPending = (slotId: string): boolean =>
    inFlightSlots.has(slotId) || coolingSlots.has(slotId) || awaitingSlots.has(slotId)

  const isAwaitingReread = (slotId: string): boolean => awaitingSlots.has(slotId)

  const isInFlight = useCallback((slotId: string): boolean => inFlightRef.current.has(slotId), [])

  // isPending の ref 版。描画用と同じ 3 つの和を同じファイルで決め、片方だけ変えて食い違わないようにする
  const isPendingNow = useCallback(
    (slotId: string): boolean =>
      inFlightRef.current.has(slotId) ||
      timersRef.current.has(slotId) ||
      awaitingRef.current.has(slotId),
    []
  )

  const begin = useCallback((slotId: string): void => {
    inFlightRef.current.add(slotId)
    awaitingRef.current.add(slotId)
    const timers = timersRef.current
    const previous = timers.get(slotId)
    if (previous !== undefined) clearTimeout(previous)
    timers.set(
      slotId,
      setTimeout(() => {
        timers.delete(slotId)
        if (mountedRef.current) setCoolingSlots((prev) => withSlot(prev, slotId, false))
      }, AGENT_PERMISSION_ANSWER_COOLDOWN_MS)
    )
    setInFlightSlots((prev) => withSlot(prev, slotId, true))
    setCoolingSlots((prev) => withSlot(prev, slotId, true))
    setAwaitingSlots((prev) => withSlot(prev, slotId, true))
  }, [])

  const finish = useCallback((slotId: string): void => {
    inFlightRef.current.delete(slotId)
    if (mountedRef.current) setInFlightSlots((prev) => withSlot(prev, slotId, false))
  }, [])

  const markReread = useCallback((slotId: string): void => {
    // 待ちでないタブは何もしない(描画を増やさない)
    if (!awaitingRef.current.delete(slotId)) return
    if (mountedRef.current) setAwaitingSlots((prev) => withSlot(prev, slotId, false))
  }, [])

  return { isPending, isPendingNow, isInFlight, isAwaitingReread, begin, finish, markReread }
}
```

- [ ] **Step 5: 描画に使う読み取りを実装する(`useAgentPermissionPrompt.ts`)**

```ts
// src/renderer/src/hooks/useAgentPermissionPrompt.ts
import { useLayoutEffect, useRef, useState } from 'react'
import { agentCliCapabilities } from '@shared/agentCliKinds'
import type { AgentActivity } from '../lib/agentActivity'
import { classifyAgentScreenFor } from '../lib/agentScreenClassifiers'
import type { AgentPermissionPrompt } from '../lib/agentPermissionPrompt'
import { isSameAgentPermissionPrompt } from '../lib/agentPermissionPrompt'
import { AGENT_PERMISSION_PROMPT_READERS } from '../lib/agentPermissionPromptReaders'
import { AGENT_PERMISSION_ANSWER_COOLDOWN_MS } from '../lib/agentPermissionAnswer'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import type { AgentSessionTabView } from './useAgentSessions'
import { AGENT_ACTIVITY_SETTLE_MS } from './useAgentActivity'

// 帯の 許可・拒否 の描画に使う、選択中のタブの許可の確認の読み取り(設計書 2026-11-06「描画に使う読み取り」)。選択中のタブが running で、
// 能力の permissionAnswer が true で、活動が permission の間だけ働く(それ以外は購読もタイマーも持たない)。useAgentActivity は変えない。
// 判定と読み取りは同じ行から行う(L-041)。答えを送ったタブは「読み直し待ち」の間 null を返し(前の読み取りで押させない。L-408)、
// 読み直しの控えの更新と onReread を同じコールバックで呼ぶ(React が 1 回の描画にまとめる)

/** 読み取りに使う選択中のタブの値(AgentSessionTabView の一部) */
export type AgentPermissionPromptTab = Pick<AgentSessionTabView, 'slotId' | 'status' | 'cliKind'> & {
  controller: Pick<AgentTerminalController, 'onOutputWritten' | 'readScreen'>
}

export interface UseAgentPermissionPromptOptions {
  /** 選択中のタブ */
  selected: AgentPermissionPromptTab
  /** 選択中のタブの活動(描画に使った値。未記録は unknown) */
  activity: AgentActivity
  /** 描画用: そのタブが「送った後の画面の読み直し待ち」か(useAgentPermissionAnswerCooldown の isAwaitingReread。state) */
  isAwaitingReread: (slotId: string) => boolean
  /** 読み直し待ちのタブを読み直した(または読む必要が無くなった)ことを知らせる(useAgentPermissionAnswerCooldown の markReread。参照は安定) */
  onReread: (slotId: string) => void
}

export interface AgentPermissionPromptState {
  /** 選択中のタブの、最後に読み取った許可の確認。許可待ちでない・読み取れない・読み直し待ちなら null */
  prompt: AgentPermissionPrompt | null
}

interface PromptEntry {
  slotId: string
  prompt: AgentPermissionPrompt | null
}

/** 照合の項目・カーソル・番号キーがすべて同じか(同じなら state を変えない) */
const isSamePromptState = (
  a: AgentPermissionPrompt | null,
  b: AgentPermissionPrompt | null
): boolean => {
  if (a === null || b === null) return a === b
  return (
    isSameAgentPermissionPrompt(a, b) &&
    a.cursorNumber === b.cursorNumber &&
    a.numberKeysAccepted === b.numberKeysAccepted
  )
}

export function useAgentPermissionPrompt({
  selected,
  activity,
  isAwaitingReread,
  onReread
}: UseAgentPermissionPromptOptions): AgentPermissionPromptState {
  const { slotId, status, cliKind, controller } = selected
  const [entry, setEntry] = useState<PromptEntry | null>(null)
  // 控え(前の値と比べて、変わったときだけ setEntry する)
  const entryRef = useRef<PromptEntry | null>(null)
  // 前の effect のタブ。読み直し待ちのタブを選び直した描画では待たずにすぐ読む
  const effectSlotRef = useRef<string | null>(null)
  const active =
    status === 'running' && agentCliCapabilities(cliKind).permissionAnswer && activity === 'permission'
  const awaiting = isAwaitingReread(slotId)

  // 描画の前に反映する(読み取る前の一瞬に「読み取れない」の理由が出ないように)
  useLayoutEffect(() => {
    const switched = effectSlotRef.current !== slotId
    effectSlotRef.current = slotId
    if (!active) {
      // 許可して作業中になったタブ・running でなくなったタブで、中断の理由が読み直し待ちのまま残らないように
      if (awaiting) onReread(slotId)
      return
    }
    const commit = (prompt: AgentPermissionPrompt | null): void => {
      const previous = entryRef.current
      if (previous === null || previous.slotId !== slotId || !isSamePromptState(previous.prompt, prompt)) {
        const next: PromptEntry = { slotId, prompt }
        entryRef.current = next
        setEntry(next)
      }
      // 控えの更新と同じコールバックで読み直し待ちを外す(待ちが外れた描画には必ず新しい読み取りが入っている)
      if (awaiting) onReread(slotId)
    }
    const read = (): void => {
      let prompt: AgentPermissionPrompt | null = null
      try {
        const lines = controller.readScreen()
        // 判定と読み取りを同じ行で行う
        if (classifyAgentScreenFor(cliKind, lines) === 'permission') {
          prompt = AGENT_PERMISSION_PROMPT_READERS[cliKind](lines)
        }
      } catch (error) {
        console.error('[useAgentPermissionPrompt] 画面を読めませんでした:', error)
      }
      commit(prompt)
    }
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    // 同じタブのまま読み直し待ちになった描画: CLI が数字を受け取って描き直すのを待つ(次の通知の 150ms 後か 1,000ms 後の早い方)
    const waitForRedraw = awaiting && !switched
    const rereadTimer = waitForRedraw ? setTimeout(read, AGENT_PERMISSION_ANSWER_COOLDOWN_MS) : null
    if (!waitForRedraw) read()
    const unsubscribe = controller.onOutputWritten(() => {
      if (settleTimer !== null) clearTimeout(settleTimer)
      settleTimer = setTimeout(read, AGENT_ACTIVITY_SETTLE_MS)
    })
    return () => {
      unsubscribe()
      if (settleTimer !== null) clearTimeout(settleTimer)
      if (rereadTimer !== null) clearTimeout(rereadTimer)
    }
  }, [active, awaiting, slotId, cliKind, controller, onReread])

  // 読み直し待ちの間は、state を変えずに null を返す(effect で null を入れない)
  const prompt = active && !awaiting && entry !== null && entry.slotId === slotId ? entry.prompt : null
  return { prompt }
}
```

- [ ] **Step 6: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useAgentPermissionAnswerCooldown.test.ts src/renderer/src/hooks/__tests__/useAgentPermissionPrompt.test.ts`
Expected: PASS

続けて: `npm run typecheck` と `npx eslint src/renderer/src/hooks/useAgentPermissionAnswerCooldown.ts src/renderer/src/hooks/useAgentPermissionPrompt.ts src/renderer/src/hooks/__tests__/useAgentPermissionAnswerCooldown.test.ts src/renderer/src/hooks/__tests__/useAgentPermissionPrompt.test.ts --max-warnings 0`

---

### Task 5: `useAgentSessions.answerPermission` と押した処理の hook

**Files:**
- Modify: `src/renderer/src/hooks/useAgentSessions.ts`(`AgentPermissionAnswerOutcome`・`AgentSessionsState.answerPermission`(必須)・実装。`clearInterruptError` を接頭辞で消す関数に一般化)
- Modify: `src/renderer/src/__tests__/makeAgentSessionsState.ts`(既定の `answerPermission`)
- Create: `src/renderer/src/hooks/useAgentPermissionAnswer.ts`
- Test: `src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`(追記)
- Test: `src/renderer/src/hooks/__tests__/useAgentPermissionAnswer.test.ts`(新規)

**Interfaces:**
- Consumes: `agentTerminalApi.answerAgentPermission`(Task 2)、`AgentPermissionAnswerResult`(Task 2)、文言(Task 3)、`getAgentPermissionAnswerAvailability`・`checkAgentPermissionAnswerAtPress`・`AgentPermissionAnswerAvailabilityInput`(Task 3)、`AgentPermissionAnswerCooldown`(Task 4)、`AgentPermissionPrompt`・`AgentPermissionChoice`・`findAgentPermissionOption`(Task 1)、既存の `invokeForCurrentSession`(`lib/agentInterruptInvocation.ts`)・`useTransientNotice`・`useLatestRef`
- Produces(`hooks/useAgentSessions.ts`):
  - `type AgentPermissionAnswerOutcome = AgentPermissionAnswerResult | { kind: 'skipped' } | { kind: 'stale' } | { kind: 'error'; message: string }`
  - `AgentSessionsState.answerPermission: (slotId: string, optionNumber: number) => Promise<AgentPermissionAnswerOutcome>`(拒否しない)
- Produces(`hooks/useAgentPermissionAnswer.ts`):
  ```ts
  export const AGENT_PERMISSION_ANSWER_NOTICE_MS = 3_000
  export interface AgentPermissionAnswerButtonState { disabledReason: string | null; ariaLabel: string }
  export interface AgentPermissionAnswerPanelState {
    visible: boolean
    question: { firstLine: string; full: string } | null
    allow: AgentPermissionAnswerButtonState
    deny: AgentPermissionAnswerButtonState
    notice: Announcement | null
    onAnswer: (choice: AgentPermissionChoice) => void
  }
  export type AgentPermissionAnswerTab = Pick<AgentSessionTabView, 'slotId' | 'label' | 'status' | 'isClosing' | 'cliKind'> & {
    controller: Pick<AgentTerminalController, 'readScreen'>
  }
  export interface UseAgentPermissionAnswerOptions {
    selected: AgentPermissionAnswerTab
    activities: ReadonlyMap<string, AgentActivity>
    prompt: AgentPermissionPrompt | null
    isSending: boolean
    isSendConfirmOpen: boolean
    isInterruptPending: (slotId: string) => boolean   // 描画用(state)
    isInterrupting: (slotId: string) => boolean       // 押した時点用(ref)
    cooldown: Pick<AgentPermissionAnswerCooldown, 'isPending' | 'isPendingNow' | 'isInFlight' | 'begin' | 'finish'>
    answerPermission: (slotId: string, optionNumber: number) => Promise<AgentPermissionAnswerOutcome>
  }
  export type AgentPermissionAnswerSources = Pick<UseAgentPermissionAnswerOptions, 'selected' | 'activities' | 'prompt' | 'isSending' | 'isSendConfirmOpen'>
  export function toAgentPermissionAnswerAvailabilityInput(sources: AgentPermissionAnswerSources, flags: { isInterrupting: boolean; isAnswering: boolean }): AgentPermissionAnswerAvailabilityInput
  export function useAgentPermissionAnswer(options: UseAgentPermissionAnswerOptions): AgentPermissionAnswerPanelState
  ```

**気をつける点:**
- L-093: `answerPermission` は最初の `await` より前に `sessionId` を控え、結果が届いた後に今の `sessionId` と比べる
- L-040: 結果が届いた時点で `sessionId` が違えば `stale`(古いセッションの結果を今のタブに出さない)
- L-101・L-653: 同期の再入の防止は `cooldown.isInFlight`(ref)。state では止めない。`finally` で `finish`
- L-058: 描画と押した処理は同じ写像 `toAgentPermissionAnswerAvailabilityInput` と同じ純関数。押した処理は `checkAgentPermissionAnswerAtPress` を丸ごと 1 回呼ぶ(hook の側で可否を別に求めない)
- 送れたときだけ読み上げる(L-001)。`stale`・`skipped` は何も出さない。失敗は `useAgentSessions` がタブの `error` に出す

- [ ] **Step 1: 失敗するテストを書く(useAgentSessions)**

`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`:

1. `import type { … } from '../useAgentSessions'` に `AgentPermissionAnswerOutcome` を足し、`@shared/types` の型の import に `AgentPermissionAnswerResult` を足す
2. `const mockInterrupt = vi.mocked(agentTerminalApi.interruptAgentSession)` の次に足す: `const mockAnswer = vi.mocked(agentTerminalApi.answerAgentPermission)`
3. `describe('useAgentSessions — 中断の 2 回目(interruptFollowUp)', ...)` の後に足す:

```ts
describe('useAgentSessions — 許可の確認への答え(answerPermission)', () => {
  function deferredResult(): {
    promise: Promise<AgentPermissionAnswerResult>
    resolve: (value: AgentPermissionAnswerResult) => void
  } {
    let resolve: (value: AgentPermissionAnswerResult) => void = () => undefined
    const promise = new Promise<AgentPermissionAnswerResult>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  const answerNow = async (
    result: Rendered['result'],
    slotId = 'slot-1',
    optionNumber = 1
  ): Promise<AgentPermissionAnswerOutcome | undefined> => {
    let outcome: AgentPermissionAnswerOutcome | undefined
    await act(async () => {
      outcome = await result.current.answerPermission(slotId, optionNumber)
    })
    return outcome
  }

  const startS1 = async (result: Rendered['result']): Promise<void> => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'claude',
      cliSessionId: CSID
    })
    await startSelected(result)
  }

  it('セッションが無ければ IPC を呼ばず skipped', async () => {
    const { result } = render()
    expect(await answerNow(result)).toEqual({ kind: 'skipped' })
    expect(mockAnswer).not.toHaveBeenCalled()
  })

  it('そのタブの sessionId と番号だけを渡し、sent を返す', async () => {
    const { result } = render()
    await startS1(result)
    mockAnswer.mockResolvedValueOnce({ kind: 'sent' })
    expect(await answerNow(result, 'slot-1', 4)).toEqual({ kind: 'sent' })
    expect(mockAnswer).toHaveBeenCalledExactlyOnceWith('s1', 4)
    expect(result.current.selected.error).toBeNull()
  })

  it.each<[AgentPermissionAnswerResult, string]>([
    [{ kind: 'no-session' }, '許可の答えを送れませんでした: claude が終了したか、起動し直しました'],
    [{ kind: 'write-failed' }, '許可の答えを送れませんでした: ターミナルへの書き込みに失敗しました']
  ])('%o はそのタブの error に出して、そのまま返す', async (ipcResult, message) => {
    const { result } = render()
    await startS1(result)
    mockAnswer.mockResolvedValueOnce(ipcResult)
    expect(await answerNow(result)).toEqual(ipcResult)
    expect(result.current.selected.error).toBe(message)
  })

  it('invoke の拒否は、接頭辞に例外の message を付けて error に出し、error を返す', async () => {
    const { result } = render()
    await startS1(result)
    mockAnswer.mockRejectedValueOnce(new Error('ipc down'))
    expect(await answerNow(result)).toEqual({ kind: 'error', message: 'ipc down' })
    expect(result.current.selected.error).toBe('許可の答えを送れませんでした: ipc down')
  })

  it('window.api の呼び出しが同期で投げても、拒否と同じに扱う(L-055)', async () => {
    const { result } = render()
    await startS1(result)
    mockAnswer.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(await answerNow(result)).toEqual({ kind: 'error', message: 'boom' })
    expect(result.current.selected.error).toBe('許可の答えを送れませんでした: boom')
  })

  it('結果を待つ間に終了して起動し直したら stale で、新しいセッションのタブに何も出さない(L-040・L-093)', async () => {
    const { result } = render()
    await startS1(result)
    const pending = deferredResult()
    mockAnswer.mockReturnValueOnce(pending.promise)
    let outcome: Promise<AgentPermissionAnswerOutcome> | undefined
    act(() => {
      outcome = result.current.answerPermission('slot-1', 1)
    })
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' }))
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's2',
      cliKind: 'claude',
      cliSessionId: CSID
    })
    await startSelected(result)
    let settled: AgentPermissionAnswerOutcome | undefined
    await act(async () => {
      pending.resolve({ kind: 'no-session' })
      settled = await outcome
    })
    expect(settled).toEqual({ kind: 'stale' })
    expect(result.current.selected.status).toBe('running')
    expect(result.current.selected.error).toBeNull()
  })

  it('結果を待つ間にタブを閉じたら stale で、どのタブにも何も出さない', async () => {
    const { result } = render({ onConfirm: () => true })
    await runTwoTabs(result)
    const pending = deferredResult()
    mockAnswer.mockReturnValueOnce(pending.promise)
    let outcome: Promise<AgentPermissionAnswerOutcome> | undefined
    act(() => {
      outcome = result.current.answerPermission('slot-2', 1)
    })
    await act(async () => {
      await result.current.closeTab('slot-2')
    })
    let settled: AgentPermissionAnswerOutcome | undefined
    await act(async () => {
      pending.resolve({ kind: 'write-failed' })
      settled = await outcome
    })
    expect(settled).toEqual({ kind: 'stale' })
    expect(result.current.tabs.map((tab) => [tab.slotId, tab.error])).toEqual([['slot-1', null]])
  })

  it('結果は押したタブの error に出す(結果が届いた時点で別のタブを選んでいても)', async () => {
    const { result } = render()
    await runTwoTabs(result)
    expect(result.current.selected.slotId).toBe('slot-2')
    mockAnswer.mockResolvedValueOnce({ kind: 'write-failed' })
    await answerNow(result, 'slot-1')
    expect(mockAnswer).toHaveBeenCalledExactlyOnceWith('s-1', 1)
    expect(tabOf(result.current, 'slot-1').error).toBe(
      '許可の答えを送れませんでした: ターミナルへの書き込みに失敗しました'
    )
    expect(result.current.selected.error).toBeNull()
  })

  it('送れたら、そのタブの答えの失敗の文言だけを消し、中断・終了の失敗の文言は消さない', async () => {
    const { result } = render()
    await startS1(result)
    mockAnswer.mockResolvedValueOnce({ kind: 'write-failed' })
    await answerNow(result)
    mockAnswer.mockResolvedValueOnce({ kind: 'sent' })
    await answerNow(result)
    expect(result.current.selected.error).toBeNull()
    // 中断の失敗の文言は消さない
    mockInterrupt.mockResolvedValueOnce({ kind: 'write-failed' })
    await act(async () => {
      await result.current.interrupt('slot-1')
    })
    mockAnswer.mockResolvedValueOnce({ kind: 'sent' })
    await answerNow(result)
    expect(result.current.selected.error).toBe(
      '中断を送れませんでした: ターミナルへの書き込みに失敗しました'
    )
    // 終了の失敗の文言も消さない
    mockStop.mockRejectedValueOnce(new Error('x'))
    await act(async () => {
      await result.current.stop('slot-1')
    })
    mockAnswer.mockResolvedValueOnce({ kind: 'sent' })
    await answerNow(result)
    expect(result.current.selected.error).toBe('エージェントを終了できませんでした: x')
  })

  it('中断を送れたときは、答えの失敗の文言を消さない(中断の失敗の文言だけを消す)', async () => {
    const { result } = render()
    await startS1(result)
    mockAnswer.mockResolvedValueOnce({ kind: 'write-failed' })
    await answerNow(result)
    mockInterrupt.mockResolvedValueOnce({ kind: 'sent', followUp: null })
    await act(async () => {
      await result.current.interrupt('slot-1')
    })
    expect(result.current.selected.error).toBe(
      '許可の答えを送れませんでした: ターミナルへの書き込みに失敗しました'
    )
  })

  it('copilot のタブの no-session の文言は copilot の名前', async () => {
    const { result } = render()
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'copilot',
      cliSessionId: null
    })
    await startSelected(result)
    mockAnswer.mockResolvedValueOnce({ kind: 'no-session' })
    await answerNow(result)
    expect(result.current.selected.error).toBe(
      '許可の答えを送れませんでした: copilot が終了したか、起動し直しました'
    )
  })
})
```

- [ ] **Step 2: 失敗するテストを書く(押した処理の hook)**

```ts
// src/renderer/src/hooks/__tests__/useAgentPermissionAnswer.test.ts
import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import {
  toAgentPermissionAnswerAvailabilityInput,
  useAgentPermissionAnswer
} from '../useAgentPermissionAnswer'
import type {
  AgentPermissionAnswerPanelState,
  UseAgentPermissionAnswerOptions
} from '../useAgentPermissionAnswer'
import { useAgentPermissionAnswerCooldown } from '../useAgentPermissionAnswerCooldown'
import type { AgentPermissionAnswerCooldown } from '../useAgentPermissionAnswerCooldown'
import type { AgentPermissionAnswerOutcome, AgentSessionTabView } from '../useAgentSessions'
import type { AgentActivity } from '../../lib/agentActivity'
import type { AgentPermissionChoice, AgentPermissionPrompt } from '../../lib/agentPermissionPrompt'
import { AGENT_PERMISSION_PROMPT_READERS } from '../../lib/agentPermissionPromptReaders'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { ViewportLine } from '../../lib/agentViewport'
import { makeAgentSessionTabView } from '../../__tests__/makeAgentSessionsState'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'
import { agentScreen, makeLine } from '../../lib/__tests__/fixtures/agentScreens'
import { copilotScreen } from '../../lib/__tests__/fixtures/copilotScreens'
import {
  AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN,
  AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING,
  AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM,
  AGENT_PERMISSION_ANSWER_DISABLED_SENDING,
  AGENT_PERMISSION_ANSWER_PROMPT_CHANGED,
  agentPermissionAnswerNoLongerPermissionReason,
  agentPermissionAnswerNumberKeysRejectedReason,
  agentPermissionAnswerSentNotice
} from '../../lib/agentPermissionAnswerMessages'

type Props = Omit<UseAgentPermissionAnswerOptions, 'cooldown' | 'answerPermission'>
interface Rendered {
  cooldown: AgentPermissionAnswerCooldown
  answer: AgentPermissionAnswerPanelState
}

let answerPermission: ReturnType<typeof vi.fn<UseAgentPermissionAnswerOptions['answerPermission']>>
let consoleErrorSpy: MockInstance<typeof console.error> | null = null

const readPrompt = (kind: AgentCliKind, lines: readonly ViewportLine[]): AgentPermissionPrompt => {
  const prompt = AGENT_PERMISSION_PROMPT_READERS[kind](lines)
  if (prompt === null) throw new Error('許可の確認を読み取れない画面です')
  return prompt
}

// 実行中で許可待ちのタブ。readScreen は記録した画面を返す
function permissionTab(slotId: string, number: number, cliKind: AgentCliKind = 'claude'): AgentSessionTabView {
  const controller = makeFakeController()
  controller.screen = (cliKind === 'claude' ? agentScreen('permission') : copilotScreen('permission')).lines
  return makeAgentSessionTabView({ slotId, number, cliKind, status: 'running', controller })
}
const screenOf = (tab: AgentSessionTabView): FakeController => tab.controller as FakeController
const permissionOf = (...slotIds: string[]): ReadonlyMap<string, AgentActivity> =>
  new Map(slotIds.map((slotId): [string, AgentActivity] => [slotId, 'permission']))
const propsFor = (tab: AgentSessionTabView, overrides: Partial<Props> = {}): Props => ({
  selected: tab,
  activities: permissionOf(tab.slotId),
  prompt: readPrompt(tab.cliKind, screenOf(tab).screen),
  isSending: false,
  isSendConfirmOpen: false,
  isInterruptPending: () => false,
  isInterrupting: () => false,
  ...overrides
})

function render(initial: Props): RenderHookResult<Rendered, Props> {
  return renderHook(
    (p: Props) => {
      const cooldown = useAgentPermissionAnswerCooldown()
      return { cooldown, answer: useAgentPermissionAnswer({ ...p, cooldown, answerPermission }) }
    },
    { initialProps: initial }
  )
}

const press = async (
  result: RenderHookResult<Rendered, Props>['result'],
  choice: AgentPermissionChoice
): Promise<void> => {
  await act(async () => {
    result.current.answer.onAnswer(choice)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  answerPermission = vi.fn<UseAgentPermissionAnswerOptions['answerPermission']>(async () => ({
    kind: 'sent'
  }))
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = null
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('useAgentPermissionAnswer: 描画の状態', () => {
  it('許可待ちで読み取れたら出し、問いの 1 行目と全文・名前を入れる', () => {
    const tab = permissionTab('slot-1', 1)
    const { result } = render(propsFor(tab))
    const { answer } = result.current
    expect(answer.visible).toBe(true)
    expect(answer.question).toEqual({
      firstLine: 'Do you want to proceed?',
      full: 'Do you want to proceed?'
    })
    expect(answer.allow).toEqual({
      disabledReason: null,
      ariaLabel: '許可（claude 1 の「Do you want to proceed?」に 1 番の Yes で答える）'
    })
    expect(answer.deny).toEqual({
      disabledReason: null,
      ariaLabel: '拒否（claude 1 の「Do you want to proceed?」に 4 番の No で答える）'
    })
  })

  it('読み取りが無い(prompt が null)ときは問いを出さず、名前は「許可の確認に Yes で答える」', () => {
    const { result } = render(propsFor(permissionTab('slot-1', 1), { prompt: null }))
    expect(result.current.answer.question).toBeNull()
    expect(result.current.answer.allow.ariaLabel).toBe('許可（claude 1 の許可の確認に Yes で答える）')
    expect(result.current.answer.deny.ariaLabel).toBe('拒否（claude 1 の許可の確認に No で答える）')
  })

  it('許可待ちでなければ出さない', () => {
    const tab = permissionTab('slot-1', 1)
    const { result } = render(propsFor(tab, { activities: new Map([[tab.slotId, 'working']]) }))
    expect(result.current.answer.visible).toBe(false)
  })

  it('中断の流れの間(描画用の state)は、中断の理由を両方のボタンに出す', () => {
    const { result } = render(propsFor(permissionTab('slot-1', 1), { isInterruptPending: () => true }))
    expect(result.current.answer.allow.disabledReason).toBe(AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING)
    expect(result.current.answer.deny.disabledReason).toBe(AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING)
  })
})

describe('useAgentPermissionAnswer: 押したとき', () => {
  it('許可は選択中のタブと 1 番で IPC を呼び、送れたら読み上げ、待ちを始める', async () => {
    const tab = permissionTab('slot-1', 1)
    const { result } = render(propsFor(tab))
    await press(result, 'allow')
    expect(answerPermission).toHaveBeenCalledExactlyOnceWith('slot-1', 1)
    expect(result.current.answer.notice?.text).toBe(
      agentPermissionAnswerSentNotice('claude 1', 'claude', 'allow', 1)
    )
    expect(result.current.cooldown.isPending('slot-1')).toBe(true)
    expect(result.current.cooldown.isAwaitingReread('slot-1')).toBe(true)
    expect(result.current.answer.allow.disabledReason).toBe(AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN)
  })

  it('claude の拒否は 4 番', async () => {
    const { result } = render(propsFor(permissionTab('slot-1', 1)))
    await press(result, 'deny')
    expect(answerPermission).toHaveBeenCalledExactlyOnceWith('slot-1', 4)
  })

  it('copilot の拒否は 2 番で、読み上げにターミナルでの入力の案内が付く', async () => {
    const { result } = render(propsFor(permissionTab('slot-1', 1, 'copilot')))
    await press(result, 'deny')
    expect(answerPermission).toHaveBeenCalledExactlyOnceWith('slot-1', 2)
    expect(result.current.answer.notice?.text).toBe(
      'copilot 1 で拒否（2 番）を選びました。ターミナルで、代わりにしてほしいことを入力して Enter を押してください'
    )
  })

  it('結果を待つ間の同じタブの 2 回目は IPC を呼ばず、何も読み上げない(同期の再入の防止。L-101・L-653)', async () => {
    answerPermission.mockReturnValue(new Promise<AgentPermissionAnswerOutcome>(() => undefined))
    const { result } = render(propsFor(permissionTab('slot-1', 1)))
    act(() => {
      result.current.answer.onAnswer('allow')
      result.current.answer.onAnswer('deny')
    })
    expect(answerPermission).toHaveBeenCalledOnce()
    expect(result.current.answer.notice).toBeNull()
  })

  it('待ちはタブごと(slot-1 の結果を待つ間も、選び直した slot-2 には答えられる)', async () => {
    answerPermission.mockReturnValueOnce(new Promise<AgentPermissionAnswerOutcome>(() => undefined))
    const tab1 = permissionTab('slot-1', 1)
    const tab2 = permissionTab('slot-2', 2)
    const { result, rerender } = render(propsFor(tab1))
    await press(result, 'allow')
    rerender(propsFor(tab2))
    await press(result, 'allow')
    expect(answerPermission.mock.calls).toEqual([
      ['slot-1', 1],
      ['slot-2', 1]
    ])
  })

  it('送った直後(1,000ms 以内)にもう一度押すと、IPC を呼ばず答えた直後の理由を読み上げる', async () => {
    const { result } = render(propsFor(permissionTab('slot-1', 1)))
    await press(result, 'allow')
    await press(result, 'allow')
    expect(answerPermission).toHaveBeenCalledOnce()
    expect(result.current.answer.notice?.text).toBe(AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN)
  })

  it.each<[string, Partial<Props>, string]>([
    ['送信中', { isSending: true }, AGENT_PERMISSION_ANSWER_DISABLED_SENDING],
    ['送信前の確認の表示中', { isSendConfirmOpen: true }, AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM],
    // 描画の値(isInterruptPending)は偽でも、押した時点の値(ref)で止める
    ['中断の流れの間(押した時点の ref)', { isInterrupting: () => true }, AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING]
  ])('段階 (a) %s: IPC を呼ばず、画面を読まず、理由を読み上げる', async (_name, overrides, reason) => {
    const tab = permissionTab('slot-1', 1)
    const readSpy = vi.spyOn(screenOf(tab), 'readScreen')
    const { result } = render(propsFor(tab, overrides))
    await press(result, 'allow')
    expect(answerPermission).not.toHaveBeenCalled()
    expect(readSpy).not.toHaveBeenCalled()
    expect(result.current.answer.notice?.text).toBe(reason)
  })

  it.each<[string, (tab: AgentSessionTabView) => void, AgentCliKind, string]>([
    [
      '押した時点は入力待ちの画面',
      (tab) => {
        screenOf(tab).screen = agentScreen('empty').lines
      },
      'claude',
      agentPermissionAnswerNoLongerPermissionReason('claude')
    ],
    [
      '本文(コマンド)だけを変えた画面',
      (tab) => {
        screenOf(tab).screen = screenOf(tab).screen.map((line, y) =>
          y === 15 ? makeLine(' rm -rf build') : line
        )
      },
      'claude',
      AGENT_PERMISSION_ANSWER_PROMPT_CHANGED
    ],
    [
      'copilot の permissionDown(カーソルが最後の選択肢)',
      (tab) => {
        screenOf(tab).screen = copilotScreen('permissionDown').lines
      },
      'copilot',
      agentPermissionAnswerNumberKeysRejectedReason('copilot')
    ]
  ])('段階 (b)〜(f) %s: 描画は permission でも IPC を呼ばず理由を読み上げる', async (_name, change, kind, reason) => {
    const tab = permissionTab('slot-1', 1, kind)
    const { result } = render(propsFor(tab))
    change(tab)
    await press(result, 'allow')
    expect(answerPermission).not.toHaveBeenCalled()
    expect(result.current.answer.notice?.text).toBe(reason)
  })

  it('押した時点の readScreen が投げたら、IPC を呼ばず読み上げず console に記録する', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const tab = permissionTab('slot-1', 1)
    const { result } = render(propsFor(tab))
    vi.spyOn(screenOf(tab), 'readScreen').mockImplementation(() => {
      throw new Error('disposed')
    })
    await press(result, 'allow')
    expect(answerPermission).not.toHaveBeenCalled()
    expect(result.current.answer.notice).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it.each<AgentPermissionAnswerOutcome>([
    { kind: 'no-session' },
    { kind: 'write-failed' },
    { kind: 'stale' },
    { kind: 'skipped' },
    { kind: 'error', message: 'x' }
  ])('結果が %o なら読み上げない(失敗の表示は useAgentSessions の役目)', async (outcome) => {
    answerPermission.mockResolvedValueOnce(outcome)
    const { result } = render(propsFor(permissionTab('slot-1', 1)))
    await press(result, 'allow')
    expect(result.current.answer.notice).toBeNull()
  })

  it('IPC の呼び出しが拒否しても、送っている途中を解く(finally。L-053)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    answerPermission.mockRejectedValueOnce(new Error('boom'))
    const { result } = render(propsFor(permissionTab('slot-1', 1)))
    await press(result, 'allow')
    expect(result.current.cooldown.isInFlight('slot-1')).toBe(false)
  })

  it('同じ文言の読み上げが続いても id を進める', async () => {
    const { result } = render(propsFor(permissionTab('slot-1', 1)))
    await press(result, 'allow')
    const first = result.current.answer.notice?.id ?? 0
    await press(result, 'allow')
    await press(result, 'allow')
    expect(result.current.answer.notice?.text).toBe(AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN)
    expect(result.current.answer.notice?.id).toBeGreaterThan(first + 1)
  })
})

describe('toAgentPermissionAnswerAvailabilityInput', () => {
  it('選択中のタブの状態・活動・読み取りと、送信中・確認の表示中・中断の流れ・答えた直後の値をそのまま写す', () => {
    const tab = { ...permissionTab('slot-1', 1), isClosing: true }
    const prompt = readPrompt('claude', agentScreen('permission').lines)
    expect(
      toAgentPermissionAnswerAvailabilityInput(
        {
          selected: tab,
          activities: permissionOf('slot-1'),
          prompt,
          isSending: true,
          isSendConfirmOpen: true
        },
        { isInterrupting: true, isAnswering: false }
      )
    ).toEqual({
      status: 'running',
      cliKind: 'claude',
      isClosing: true,
      activity: 'permission',
      isSending: true,
      isSendConfirmOpen: true,
      isInterrupting: true,
      isAnswering: false,
      prompt
    })
  })

  it('活動が未記録のタブは unknown', () => {
    const input = toAgentPermissionAnswerAvailabilityInput(
      {
        selected: permissionTab('slot-1', 1),
        activities: permissionOf('slot-2'),
        prompt: null,
        isSending: false,
        isSendConfirmOpen: false
      },
      { isInterrupting: false, isAnswering: false }
    )
    expect(input.activity).toBe('unknown')
  })
})
```

- [ ] **Step 3: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentPermissionAnswer.test.ts`
Expected: FAIL(`answerPermission` が無い・`useAgentPermissionAnswer` が無い)

- [ ] **Step 4: useAgentSessions を実装する**

`src/renderer/src/hooks/useAgentSessions.ts`:

1. `@shared/types` の型の import に `AgentPermissionAnswerResult` を足す。文言の import を足す:

```ts
import {
  AGENT_PERMISSION_ANSWER_ERROR_PREFIX,
  agentPermissionAnswerError,
  agentPermissionAnswerFailureError
} from '../lib/agentPermissionAnswerMessages'
```

2. `AgentInterruptFollowUpOutcome` の後に足す:

```ts
/** 許可の確認への答えの結果(main の結果をそのまま返し、renderer の側の skipped・stale・error を足す)。送れたかだけを扱う(L-001) */
export type AgentPermissionAnswerOutcome =
  | AgentPermissionAnswerResult
  /** そのタブにセッションが無い(IPC を呼ばない) */
  | { kind: 'skipped' }
  /** 結果が届いた時点で、そのタブの sessionId が送った値と違う(起動し直した・終了した・閉じた)。何も出さない */
  | { kind: 'stale' }
  /** invoke の拒否・同期の例外 */
  | { kind: 'error'; message: string }
```

3. `AgentSessionsState` の `interruptFollowUp` の後に足す:

```ts
  /** そのタブの CLI の許可の確認に、選択肢の番号キーを送る(書くバイトは main が番号から決める)。そのタブにセッションが無ければ IPC を
   *  呼ばず skipped。押した時点の sessionId を控え、結果が届いた時点で同じときだけ結果を出す(違えば stale。L-040・L-093)。送れなかったら
   *  そのタブの error に出し、送れたらそのタブの答えの失敗の文言だけを消す。拒否しない */
  answerPermission: (slotId: string, optionNumber: number) => Promise<AgentPermissionAnswerOutcome>
```

4. `clearInterruptError` を、接頭辞で消す関数に置き換える(中断の 2 か所の呼び出しも直す):

```ts
  // 送れたときに、そのタブの error が prefix で始まる文言(その操作の失敗の文言)なら消す(終了の失敗などほかの文言は消さない)
  const clearErrorWithPrefix = useCallback(
    (slotId: string, prefix: string): void => {
      if (!mountedRef.current) return
      if (findTab(slotId) === undefined) return
      setStates((prev) => {
        const fields = agentTabSessionFieldsOf(prev, slotId)
        if (fields.error?.startsWith(prefix) !== true) return prev
        return new Map(prev).set(slotId, { ...fields, error: null })
      })
    },
    [findTab]
  )
```

`interrupt`・`interruptFollowUp` の中の `clearInterruptError(slotId)` を `clearErrorWithPrefix(slotId, AGENT_INTERRUPT_ERROR_PREFIX)` にし、依存の配列の `clearInterruptError` を `clearErrorWithPrefix` にする。

5. `interruptFollowUp` の後に足す:

```ts
  const answerPermission = useCallback(
    async (slotId: string, optionNumber: number): Promise<AgentPermissionAnswerOutcome> => {
      // 最初の await より前に、押した時点のセッションを控える(L-093)
      const id = sessionIdBySlotRef.current.get(slotId)
      if (id === undefined) return { kind: 'skipped' }
      const invoked = await invokeForCurrentSession(
        () => agentTerminalApi.answerAgentPermission(id, optionNumber),
        () => sessionIdBySlotRef.current.get(slotId) === id
      )
      if (invoked.kind === 'stale') return invoked
      if (invoked.kind === 'error') {
        patchTab(slotId, { error: agentPermissionAnswerError(invoked.message) })
        return invoked
      }
      const { result } = invoked
      if (result.kind === 'sent') {
        clearErrorWithPrefix(slotId, AGENT_PERMISSION_ANSWER_ERROR_PREFIX)
        return result
      }
      patchTab(slotId, { error: agentPermissionAnswerFailureError(result.kind, commandNameOf(slotId)) })
      return result
    },
    [patchTab, clearErrorWithPrefix, commandNameOf]
  )
```

6. 戻り値の `interruptFollowUp,` の次に `answerPermission,` を足す

`src/renderer/src/__tests__/makeAgentSessionsState.ts` の `addTab:` の前に足す（`interruptFollowUp` は複数行の式なので、その途中に入れない）:

```ts
    answerPermission: vi.fn<AgentSessionsState['answerPermission']>(async () => ({ kind: 'sent' })),
```

- [ ] **Step 5: 押した処理の hook を実装する(`useAgentPermissionAnswer.ts`)**

```ts
// src/renderer/src/hooks/useAgentPermissionAnswer.ts
import { useCallback, useEffect, useRef } from 'react'
import type { Announcement } from '../types'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import {
  checkAgentPermissionAnswerAtPress,
  getAgentPermissionAnswerAvailability
} from '../lib/agentPermissionAnswer'
import type {
  AgentPermissionAnswerAvailability,
  AgentPermissionAnswerAvailabilityInput
} from '../lib/agentPermissionAnswer'
import { findAgentPermissionOption } from '../lib/agentPermissionPrompt'
import type { AgentPermissionChoice, AgentPermissionPrompt } from '../lib/agentPermissionPrompt'
import {
  agentPermissionAnswerAriaLabel,
  agentPermissionAnswerSentNotice
} from '../lib/agentPermissionAnswerMessages'
import type { AgentPermissionAnswerCooldown } from './useAgentPermissionAnswerCooldown'
import type { AgentPermissionAnswerOutcome, AgentSessionTabView } from './useAgentSessions'
import { useLatestRef } from './useLatestRef'
import { useTransientNotice } from './useTransientNotice'

// 帯の 許可・拒否 の押した処理と読み上げ(設計書 2026-11-06「押したときの処理」)。useAgentWorkspace が選択中のタブ・活動・描画の読み取り・
// 送信中・確認の表示中・中断の流れ・待ちの控えを渡し、結果を AgentTerminalPanelState.permissionAnswer に載せる。判定の入力は描画と押した処理で
// 同じ写像(toAgentPermissionAnswerAvailabilityInput)で組み立てる(L-058)。
// 連打の対策は組で働く(L-408): 押してから 1,000ms と、送った後の画面を読み直すまでは押せない(useAgentPermissionAnswerCooldown・
// useAgentPermissionPrompt)・同期の再入の防止(cooldown.isInFlight。このファイル)・ダブルクリックの 2 回目とキーリピートの無視
// (AgentPermissionAnswerButton)・押した後もフォーカスを押したボタンに残す(aria-disabled)・ボタンが消えたら開閉のボタンへ移す
// (useAgentPermissionAnswerFocus)。どれかを外すと、押し続けた Enter が次の許可の確認に答える、または移った先の 中断・終了 を押す

/** 読み上げ(送れたとき・押せない状態で押したとき)を出しておく時間 */
export const AGENT_PERMISSION_ANSWER_NOTICE_MS = 3_000

export interface AgentPermissionAnswerButtonState {
  /** 押せない理由。押せるなら null */
  disabledReason: string | null
  ariaLabel: string
}

export interface AgentPermissionAnswerPanelState {
  /** 出すか(選択中のタブが running・能力あり・許可待ち) */
  visible: boolean
  /** 問いの 1 行目と全文(読み取れないなら null) */
  question: { firstLine: string; full: string } | null
  allow: AgentPermissionAnswerButtonState
  deny: AgentPermissionAnswerButtonState
  /** 送れたとき・押せない状態で押したときの読み上げ(3,000ms で null) */
  notice: Announcement | null
  /** 押したとき。押せないときは何もしない(理由を読み上げる) */
  onAnswer: (choice: AgentPermissionChoice) => void
}

/** 答えに使う選択中のタブの値(AgentSessionTabView の一部) */
export type AgentPermissionAnswerTab = Pick<
  AgentSessionTabView,
  'slotId' | 'label' | 'status' | 'isClosing' | 'cliKind'
> & {
  controller: Pick<AgentTerminalController, 'readScreen'>
}

export interface UseAgentPermissionAnswerOptions {
  /** 選択中のタブ(押した処理は押した時点の値を使う) */
  selected: AgentPermissionAnswerTab
  /** タブごとの活動(useAgentActivity の結果。描画に使った値) */
  activities: ReadonlyMap<string, AgentActivity>
  /** 描画に使った読み取り(useAgentPermissionPrompt の prompt) */
  prompt: AgentPermissionPrompt | null
  /** プロンプトを送信している間(useAgentPromptSender の isSending) */
  isSending: boolean
  /** 送信前の確認のダイアログを開いている間 */
  isSendConfirmOpen: boolean
  /** 描画用: そのタブが中断の流れの間(useAgentInterrupt の isInterruptPending。state) */
  isInterruptPending: (slotId: string) => boolean
  /** 押した時点用: そのタブが中断の流れの間(useAgentInterrupt の isInterrupting。ref) */
  isInterrupting: (slotId: string) => boolean
  /** 答えの待ち(useAgentWorkspace が先に作った useAgentPermissionAnswerCooldown) */
  cooldown: Pick<
    AgentPermissionAnswerCooldown,
    'isPending' | 'isPendingNow' | 'isInFlight' | 'begin' | 'finish'
  >
  /** そのタブのセッションへ答えを送る(useAgentSessions の answerPermission。拒否しない) */
  answerPermission: (slotId: string, optionNumber: number) => Promise<AgentPermissionAnswerOutcome>
}

/** 押せるかの判定の入力の元になる値(描画の値、または押した時点の最新の値) */
export type AgentPermissionAnswerSources = Pick<
  UseAgentPermissionAnswerOptions,
  'selected' | 'activities' | 'prompt' | 'isSending' | 'isSendConfirmOpen'
>

/**
 * 判定の入力を組み立てる(描画と押した処理で同じ写像。L-058)。活動が未記録のタブは unknown。中断の流れと答えた直後は呼び出し側が渡す
 * (描画は state の isInterruptPending・cooldown.isPending、押した処理は ref の isInterrupting・cooldown.isPendingNow)
 */
export function toAgentPermissionAnswerAvailabilityInput(
  { selected, activities, prompt, isSending, isSendConfirmOpen }: AgentPermissionAnswerSources,
  { isInterrupting, isAnswering }: { isInterrupting: boolean; isAnswering: boolean }
): AgentPermissionAnswerAvailabilityInput {
  return {
    status: selected.status,
    cliKind: selected.cliKind,
    isClosing: selected.isClosing,
    activity: activities.get(selected.slotId) ?? 'unknown',
    isSending,
    isSendConfirmOpen,
    isInterrupting,
    isAnswering,
    prompt
  }
}

export function useAgentPermissionAnswer(
  options: UseAgentPermissionAnswerOptions
): AgentPermissionAnswerPanelState {
  const { selected, prompt, isInterruptPending, cooldown } = options
  const { notice, announce } = useTransientNotice(AGENT_PERMISSION_ANSWER_NOTICE_MS)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const renderInput = toAgentPermissionAnswerAvailabilityInput(options, {
    isInterrupting: isInterruptPending(selected.slotId),
    isAnswering: cooldown.isPending(selected.slotId)
  })
  const allow = getAgentPermissionAnswerAvailability(renderInput, 'allow')
  const deny = getAgentPermissionAnswerAvailability(renderInput, 'deny')
  const latestRef = useLatestRef(options)

  const onAnswer = useCallback(
    (choice: AgentPermissionChoice): void => {
      const current = latestRef.current
      // 押した時点のタブ(結果が届くまでに別のタブを選んでも、このタブへ送ってこのタブで読み上げる)
      const tab = current.selected
      const { slotId, label, cliKind } = tab
      const { cooldown: currentCooldown } = current
      // 1. 同期の再入の防止(同じタブの結果を待つ間)。何も出さない(L-101・L-653)
      if (currentCooldown.isInFlight(slotId)) return
      // 2. 最新の値で可否を求め直し、押した時点の画面を読み直して照合する(段階 (a)〜(f))。押せなければ理由を読み上げる(L-057)
      const check = checkAgentPermissionAnswerAtPress(
        toAgentPermissionAnswerAvailabilityInput(current, {
          isInterrupting: current.isInterrupting(slotId),
          isAnswering: currentCooldown.isPendingNow(slotId)
        }),
        choice,
        () => tab.controller.readScreen()
      )
      if (check.kind === 'unreadable') {
        console.error('[useAgentPermissionAnswer] 画面を読めないため、答えを送りません:', check.error)
        return
      }
      if (check.kind === 'blocked') {
        announce(check.reason)
        return
      }
      // 3. 送っている途中・1,000ms の待ち・読み直し待ちを同時に始める
      currentCooldown.begin(slotId)
      const { optionNumber } = check
      void (async () => {
        try {
          // 4・5. 送る番号は押した時点の判定の結果だけ(L-594)。送れたときだけ読み上げる(L-001)
          const outcome = await current.answerPermission(slotId, optionNumber)
          if (outcome.kind === 'sent' && mountedRef.current) {
            announce(agentPermissionAnswerSentNotice(label, cliKind, choice, optionNumber))
          }
        } catch (err) {
          console.error('[useAgentPermissionAnswer] 答えの送信に失敗しました:', err)
        } finally {
          // 6. 送っている途中だけを解く(例外でも固まらない。L-053)。1,000ms と読み直し待ちは別に外れる
          currentCooldown.finish(slotId)
        }
      })()
    },
    [latestRef, announce]
  )

  const buttonOf = (
    choice: AgentPermissionChoice,
    availability: AgentPermissionAnswerAvailability
  ): AgentPermissionAnswerButtonState => ({
    disabledReason: availability.reason,
    // 名前の番号は描画の読み取りから引く(押せない理由があるときも名前を変えない)。送る番号には使わない
    ariaLabel: agentPermissionAnswerAriaLabel(
      choice,
      selected.label,
      prompt === null ? null : prompt.question[0],
      prompt === null ? null : (findAgentPermissionOption(prompt, choice)?.number ?? null)
    )
  })

  return {
    visible: allow.visible,
    question: prompt === null ? null : { firstLine: prompt.question[0], full: prompt.question.join(' ') },
    allow: buttonOf('allow', allow),
    deny: buttonOf('deny', deny),
    notice,
    onAnswer
  }
}
```

- [ ] **Step 6: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentPermissionAnswer.test.ts`
Expected: PASS

続けて: `npm run typecheck` と `npx eslint src/renderer/src/hooks/useAgentSessions.ts src/renderer/src/hooks/useAgentPermissionAnswer.ts src/renderer/src/__tests__/makeAgentSessionsState.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentPermissionAnswer.test.ts --max-warnings 0`

---

### Task 6: 中断との排他と `useAgentWorkspace` の配線

**Files:**
- Modify: `src/renderer/src/lib/agentInterruptMessages.ts`(`AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION`)
- Modify: `src/renderer/src/lib/agentInterrupt.ts`(`AgentInterruptAvailabilityInput.isAnsweringPermission`・`blockedReasonOf`)
- Modify: `src/renderer/src/hooks/useAgentInterrupt.ts`(`UseAgentInterruptOptions` に必須の 2 つ・`toAgentInterruptAvailabilityInput` の第 3 引数)
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`(組み立ての順・`AgentTerminalPanelState.permissionAnswer`(必須))
- Modify: `src/renderer/src/__tests__/makeAgentTerminalPanelState.ts`(`makeAgentPermissionAnswerPanelState` と既定の `permissionAnswer`)
- Test: `src/renderer/src/lib/__tests__/agentInterrupt.test.ts`・`src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts`・`src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`

**Interfaces:**
- Consumes: `useAgentPermissionAnswerCooldown`・`AgentPermissionAnswerCooldown`(Task 4)、`useAgentPermissionPrompt`(Task 4)、`useAgentPermissionAnswer`・`AgentPermissionAnswerPanelState`(Task 5)、`AgentSessionsState.answerPermission`(Task 5)、文言(Task 3)
- Produces:
  - `const AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION = '許可の答えを押した直後は中断できません（少し待つと押せます）'`
  - `AgentInterruptAvailabilityInput.isAnsweringPermission: boolean`
  - `UseAgentInterruptOptions.isAnsweringPermission: (slotId: string) => boolean`(描画用・state)・`isAnsweringPermissionNow: (slotId: string) => boolean`(押した時点用・ref)
  - `function toAgentInterruptAvailabilityInput(sources: AgentInterruptSources, isInterrupting: boolean, isAnsweringPermission: boolean): AgentInterruptAvailabilityInput`
  - `AgentTerminalPanelState.permissionAnswer: AgentPermissionAnswerPanelState`
  - `function makeAgentPermissionAnswerPanelState(overrides?: Partial<AgentPermissionAnswerPanelState>): AgentPermissionAnswerPanelState`(テスト用。既定は出さない)

**気をつける点:**
- L-061: 新しい状態(答えを送っている途中・1,000ms・読み直す前)で、帯の `中断` を止める(設計書「新しい状態と既存の入口」の表)。送信・ターミナルの打鍵・終了は変えない
- L-058: 中断の描画は state(`answerCooldown.isPending`)、押した処理は ref(`answerCooldown.isPendingNow`)。同じ描画の値が届くよう、`useAgentPermissionAnswerCooldown` を中断と答えの両方の hook より先に作る(ref の写しを足さない)
- L-060: 新しい欄は必須にし、配線を 1 つずつ外す変異でどれかのテストが落ちることを確かめる(Step 7)

- [ ] **Step 1: 失敗するテストを書く(中断の理由)**

`src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts` に足す(既存の import に `AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION` を足す):

```ts
it('許可の答えを送った直後の理由', () => {
  expect(AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION).toBe(
    '許可の答えを押した直後は中断できません（少し待つと押せます）'
  )
})
```

`src/renderer/src/lib/__tests__/agentInterrupt.test.ts`:

1. import に `AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION` を足す
2. `FLAGS` を `['isClosing', 'isSending', 'isSendConfirmOpen', 'isInterrupting', 'isAnsweringPermission'] as const` にし、上のコメントを「(閉じる途中 → 送信中 → 確認の表示中 → 送っている途中・1,000ms 以内 → 許可の答えを送った直後)」にする
3. `FLAG_REASONS` に `isAnsweringPermission: AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION` を足す
4. `RUNNING_WORKING` に `isAnsweringPermission: false` を足す
5. このファイルの、ほかの `AgentInterruptAvailabilityInput` のリテラル(`'理由の順: 起動中は…'` などの中)すべてに `isAnsweringPermission: false` を足す(`npm run typecheck` が場所を示す)
6. 組の数のコメント「閉じる途中・送信中・確認の表示中・待ち(16)」を「閉じる途中・送信中・確認の表示中・待ち・答えた直後(32)」にする
7. 次を足す:

```ts
  it('許可の答えを送った直後は、中断の流れの理由の後・活動(許可待ち)の理由の前', () => {
    expect(
      getAgentInterruptAvailability({
        ...RUNNING_WORKING,
        activity: 'permission',
        isAnsweringPermission: true
      }).reason
    ).toBe(AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION)
    expect(
      getAgentInterruptAvailability({
        ...RUNNING_WORKING,
        isInterrupting: true,
        isAnsweringPermission: true
      }).reason
    ).toBe(AGENT_INTERRUPT_DISABLED_COOLDOWN)
  })

  it('checkAgentInterruptAtPress: 許可の答えを送った直後なら、作業中の画面でも画面を読まずに止める', () => {
    const readScreen = vi.fn(() => agentScreen('working').lines)
    expect(
      checkAgentInterruptAtPress({ ...RUNNING_WORKING, isAnsweringPermission: true }, readScreen)
    ).toEqual({ kind: 'blocked', reason: AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION })
    expect(readScreen).not.toHaveBeenCalled()
  })
```

`src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts`:

1. `render` の `initialProps` に `isAnsweringPermission: () => false, isAnsweringPermissionNow: () => false,` を足す(`Props` は `UseAgentInterruptOptions` から 3 つを除いたものなので、2 つは必須になる)
2. `describe('toAgentInterruptAvailabilityInput', ...)` の 3 つの呼び出しに第 3 引数を足す: 1 つ目は `true`(期待の値に `isAnsweringPermission: true` を足す)、2・3 つ目は `false`。1 つ目の名前を `'選択中のタブの状態・活動と、送信中・確認の表示中・待ち・答えた直後の値をそのまま写す'` にする
3. import に `AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION` を足し、次を足す(`press`・`render`・`tab1`・`interrupt` はこのファイルの既存の補助):

```ts
describe('useAgentInterrupt: 許可の答えとの排他(設計書 2026-11-06「中断の押せる条件の追加」)', () => {
  it('描画: isAnsweringPermission が真のタブは、答えた直後の理由になる', () => {
    const { result } = render({ isAnsweringPermission: (slotId) => slotId === tab1.slotId })
    expect(result.current.disabledReason).toBe(AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION)
  })

  it('押した時点: 描画の値が偽でも、isAnsweringPermissionNow が真なら送らず理由を読み上げる', async () => {
    const { result } = render({ isAnsweringPermissionNow: () => true })
    expect(result.current.disabledReason).toBeNull()
    await press(result)
    expect(interrupt).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe(AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION)
  })
})
```

(`useAgentInterrupt.test.ts` は先頭の `beforeEach` で偽のタイマーを使い、`press(result)` で押す。この describe はファイルの末尾に足し、同じ `beforeEach`・`afterEach` の中で動かす)

- [ ] **Step 2: 失敗するテストを書く(配線)**

`src/renderer/src/__tests__/makeAgentTerminalPanelState.ts` に足す(テストが使う前に必要なので、ここで足す):

```ts
import type { AgentPermissionAnswerPanelState } from '../hooks/useAgentPermissionAnswer'

/** 帯の 許可・拒否 の状態の型付きの偽物。既定は「出さない」(許可待ちでないとき) */
export function makeAgentPermissionAnswerPanelState(
  overrides: Partial<AgentPermissionAnswerPanelState> = {}
): AgentPermissionAnswerPanelState {
  return {
    visible: false,
    question: null,
    allow: { disabledReason: null, ariaLabel: '許可（claude 1 の許可の確認に Yes で答える）' },
    deny: { disabledReason: null, ariaLabel: '拒否（claude 1 の許可の確認に No で答える）' },
    notice: null,
    onAnswer: vi.fn(),
    ...overrides
  }
}
```

`makeAgentTerminalPanelState` の既定の値の `interrupt: makeAgentInterruptPanelState(),` の次に `permissionAnswer: makeAgentPermissionAnswerPanelState(),` を足す。

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`:

1. import に足す:

```ts
import { AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION } from '../../lib/agentInterruptMessages'
import {
  AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN,
  AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING,
  AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM,
  AGENT_PERMISSION_ANSWER_DISABLED_SENDING,
  agentPermissionAnswerSentNotice
} from '../../lib/agentPermissionAnswerMessages'
```

(`AGENT_INTERRUPT_DISABLED_*` の既存の import の並びがあれば、そこへ `AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION` を足す)

2. `describe('中断の配線(agentTerminal.interrupt。…)', ...)` の後に足す(`renderWorkspace`・`setMode`・`makeSender`・`Rendered`・`mockUseAgentSessions`・`mockUseAgentActivity`・`mockUseAgentPromptSender`・`getAgentSessionTabs`・`agentScreen`・`FakeController` はこのファイルの既存のもの):

```ts
  describe('許可の確認への答えの配線(agentTerminal.permissionAnswer。本物の useAgentSessions・答えの hook。L-060)', () => {
    const CLAUDE_ID = '11111111-1111-4111-8111-111111111111'
    let startSpy: MockInstance<typeof window.api.startAgentSession> | null = null
    let answerSpy: MockInstance<typeof window.api.answerAgentPermission> | null = null
    let interruptSpy: MockInstance<typeof window.api.interruptAgentSession> | null = null
    let slotId: string
    let screenController: FakeController | null = null
    let originalScreen: FakeController['screen'] | null = null

    beforeEach(async () => {
      const actual =
        await vi.importActual<typeof import('../useAgentSessions')>('../useAgentSessions')
      mockUseAgentSessions.mockImplementation(actual.useAgentSessions)
      setMode('agent-cli')
      startSpy = vi.spyOn(window.api, 'startAgentSession').mockResolvedValue({
        kind: 'started',
        sessionId: 'sid-wire',
        cliKind: 'claude',
        cliSessionId: CLAUDE_ID
      })
      answerSpy = vi.spyOn(window.api, 'answerAgentPermission').mockResolvedValue({ kind: 'sent' })
      interruptSpy = vi
        .spyOn(window.api, 'interruptAgentSession')
        .mockResolvedValue({ kind: 'sent', followUp: null })
      // 共有の偽のタブの置き場の選択中のタブを、記録した claude の許可の確認の画面にする
      const snapshot = getAgentSessionTabs().getSnapshot()
      slotId = snapshot.selectedSlotId
      const controller = snapshot.tabs.find((tab) => tab.slotId === slotId)
        ?.controller as FakeController
      screenController = controller
      originalScreen = controller.screen
      controller.screen = agentScreen('permission').lines
      mockUseAgentActivity.mockReturnValue(new Map([[slotId, 'permission']]))
    })

    afterEach(() => {
      if (screenController !== null && originalScreen !== null) {
        screenController.screen = originalScreen
      }
      screenController = null
      originalScreen = null
      startSpy?.mockRestore()
      answerSpy?.mockRestore()
      interruptSpy?.mockRestore()
    })

    const renderStarted = async (): Promise<Rendered> => {
      const rendered = renderWorkspace({ folderPath: '/p' })
      await act(async () => {
        await rendered.result.current.agentTerminal.sessions.start(slotId, { kind: 'new' })
      })
      return rendered
    }

    it('許可待ちの選択中のタブで onAnswer(allow) を呼ぶと、window.api.answerAgentPermission をそのタブの sessionId と 1 で呼び、読み上げる', async () => {
      const { result } = await renderStarted()
      const { permissionAnswer } = result.current.agentTerminal
      expect(permissionAnswer.visible).toBe(true)
      expect(permissionAnswer.question?.firstLine).toBe('Do you want to proceed?')
      expect(permissionAnswer.allow.disabledReason).toBeNull()
      await act(async () => {
        result.current.agentTerminal.permissionAnswer.onAnswer('allow')
      })
      expect(answerSpy).toHaveBeenCalledExactlyOnceWith('sid-wire', 1)
      const label = result.current.agentTerminal.sessions.selected.label
      expect(result.current.agentTerminal.permissionAnswer.notice?.text).toBe(
        agentPermissionAnswerSentNotice(label, 'claude', 'allow', 1)
      )
    })

    it('送信中は理由を出し、押しても呼ばない', async () => {
      const { result, rerender } = await renderStarted()
      mockUseAgentPromptSender.mockReturnValue(makeSender({ isSending: true, sendingSlotId: slotId }))
      rerender()
      expect(result.current.agentTerminal.permissionAnswer.allow.disabledReason).toBe(
        AGENT_PERMISSION_ANSWER_DISABLED_SENDING
      )
      await act(async () => {
        result.current.agentTerminal.permissionAnswer.onAnswer('allow')
      })
      expect(answerSpy).not.toHaveBeenCalled()
    })

    it('送信前の確認の表示中は理由を出し、押しても呼ばない', async () => {
      const { result } = await renderStarted()
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
      })
      expect(result.current.agentSendConfirmDialog.pending).not.toBeNull()
      expect(result.current.agentTerminal.permissionAnswer.allow.disabledReason).toBe(
        AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM
      )
      await act(async () => {
        result.current.agentTerminal.permissionAnswer.onAnswer('allow')
      })
      expect(answerSpy).not.toHaveBeenCalled()
    })

    it('中断の流れの間は理由を出し、押しても呼ばない', async () => {
      // 作業中の画面で中断を押してから、許可の確認が出た画面に変わる
      if (screenController !== null) screenController.screen = agentScreen('working').lines
      mockUseAgentActivity.mockReturnValue(new Map([[slotId, 'working']]))
      const { result, rerender } = await renderStarted()
      await act(async () => {
        result.current.agentTerminal.interrupt.onInterrupt()
      })
      expect(interruptSpy).toHaveBeenCalledOnce()
      if (screenController !== null) screenController.screen = agentScreen('permission').lines
      mockUseAgentActivity.mockReturnValue(new Map([[slotId, 'permission']]))
      rerender()
      expect(result.current.agentTerminal.permissionAnswer.allow.disabledReason).toBe(
        AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING
      )
      await act(async () => {
        result.current.agentTerminal.permissionAnswer.onAnswer('allow')
      })
      expect(answerSpy).not.toHaveBeenCalled()
    })

    it('答えた直後は 中断 に答えた直後の理由が出て、作業中の画面に変わっても押した時点の判定で送らない', async () => {
      const { result, rerender } = await renderStarted()
      await act(async () => {
        result.current.agentTerminal.permissionAnswer.onAnswer('allow')
      })
      expect(result.current.agentTerminal.interrupt.disabledReason).toBe(
        AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION
      )
      // 許可して作業中になった(1,000ms の待ちの間)
      if (screenController !== null) screenController.screen = agentScreen('working').lines
      mockUseAgentActivity.mockReturnValue(new Map([[slotId, 'working']]))
      rerender()
      expect(result.current.agentTerminal.interrupt.disabledReason).toBe(
        AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION
      )
      await act(async () => {
        result.current.agentTerminal.interrupt.onInterrupt()
      })
      expect(interruptSpy).not.toHaveBeenCalled()
      expect(result.current.agentTerminal.interrupt.notice?.text).toBe(
        AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION
      )
    })

    it('答えた直後は画面が変わらなくても答えた直後の理由で、1,000ms 後に読み直して押せる状態に戻る', async () => {
      const { result } = await renderStarted()
      await act(async () => {
        result.current.agentTerminal.permissionAnswer.onAnswer('allow')
      })
      expect(result.current.agentTerminal.permissionAnswer.allow.disabledReason).toBe(
        AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN
      )
      await waitFor(
        () => {
          expect(result.current.agentTerminal.permissionAnswer.allow.disabledReason).toBeNull()
        },
        { timeout: 3_000 }
      )
      expect(result.current.agentTerminal.interrupt.disabledReason).not.toBe(
        AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION
      )
    })
  })
```

3. 既存の `'パネル(agentTerminal.interrupt)には中断の UI の値だけを渡す…'` の後(同じ describe の中)に足す:

```ts
    it('パネル(agentTerminal.permissionAnswer)には答えの UI の値だけを渡す', () => {
      setMode('agent-cli')
      const { result } = renderWorkspace()
      expect(Object.keys(result.current.agentTerminal.permissionAnswer).sort()).toEqual([
        'allow',
        'deny',
        'notice',
        'onAnswer',
        'question',
        'visible'
      ])
    })
```


- [ ] **Step 3: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/agentInterrupt.test.ts src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: FAIL(`AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION`・`permissionAnswer` が無い)

- [ ] **Step 4: 中断の理由を実装する**

`src/renderer/src/lib/agentInterruptMessages.ts` の `AGENT_INTERRUPT_DISABLED_COOLDOWN` の後に足す:

```ts
/** 許可の答えを送っている途中・押してから 1,000ms 以内・送った後の画面を読み直す前(設計書 2026-11-06「中断の押せる条件の追加」) */
export const AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION =
  '許可の答えを押した直後は中断できません（少し待つと押せます）'
```

`src/renderer/src/lib/agentInterrupt.ts`:

1. import に `AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION` を足す
2. `AgentInterruptAvailabilityInput` の `isInterrupting` の後に足す:

```ts
  /**
   * 対象のタブが、許可の答えを送っている途中か、押してから 1,000ms 以内か、送った後の画面の読み直し待ち(useAgentPermissionAnswerCooldown の
   * isPending / isPendingNow)。答えた直後は、CLI が数字を受け取って描き直すまでの画面と許可して作業中になった画面のどちらも読みうるうえ、
   * 続けて許可の確認が出ると Esc は拒否・取り消しになるため
   */
  isAnsweringPermission: boolean
```

3. `blockedReasonOf` の `if (input.isInterrupting) return AGENT_INTERRUPT_DISABLED_COOLDOWN` の次に足し、関数の説明の順に「→ 許可の答えを送った直後」を足す:

```ts
  if (input.isAnsweringPermission) return AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION
```

- [ ] **Step 5: useAgentInterrupt を直す**

`src/renderer/src/hooks/useAgentInterrupt.ts`:

1. `UseAgentInterruptOptions` の `isTabOpen` の後に足す:

```ts
  /** 描画用: そのタブが許可の答えを送った直後か(useAgentPermissionAnswerCooldown の isPending。state)。省略できない(L-060) */
  isAnsweringPermission: (slotId: string) => boolean
  /** 押した時点用: isAnsweringPermission と同じ間(useAgentPermissionAnswerCooldown の isPendingNow。ref)。省略できない */
  isAnsweringPermissionNow: (slotId: string) => boolean
```

2. `toAgentInterruptAvailabilityInput` に第 3 引数を足す:

```ts
export function toAgentInterruptAvailabilityInput(
  { selected, activities, isSending, isSendConfirmOpen }: AgentInterruptSources,
  isInterrupting: boolean,
  isAnsweringPermission: boolean
): AgentInterruptAvailabilityInput {
  return {
    status: selected.status,
    cliKind: selected.cliKind,
    isClosing: selected.isClosing,
    activity: activities.get(selected.slotId) ?? 'unknown',
    isSending,
    isSendConfirmOpen,
    isInterrupting,
    isAnsweringPermission
  }
}
```

説明の「isInterrupting は呼び出し側が渡す(…)」を「isInterrupting・isAnsweringPermission は呼び出し側が渡す(描画は state の isPending・isAnsweringPermission、押した処理は ref の isCoolingDown・isAnsweringPermissionNow)」にする。

3. `useAgentInterrupt` の引数の分割に `isAnsweringPermission, isAnsweringPermissionNow` を足す。描画の判定を次にする:

```ts
  const availability = getAgentInterruptAvailability(
    toAgentInterruptAvailabilityInput(
      { selected, activities, isSending, isSendConfirmOpen },
      cooldown.isPending(selected.slotId),
      isAnsweringPermission(selected.slotId)
    )
  )
```

4. `useLatestRef({ … })` に `isAnsweringPermissionNow` を足し、`onInterrupt` の中の判定を次にする:

```ts
    const check = checkAgentInterruptAtPress(
      toAgentInterruptAvailabilityInput(
        current,
        isCoolingDown(slotId),
        current.isAnsweringPermissionNow(slotId)
      ),
      () => tab.controller.readScreen()
    )
```

- [ ] **Step 6: useAgentWorkspace を配線する**

`src/renderer/src/hooks/useAgentWorkspace.ts`:

1. import に足す:

```ts
import { useAgentPermissionAnswerCooldown } from './useAgentPermissionAnswerCooldown'
import { useAgentPermissionPrompt } from './useAgentPermissionPrompt'
import { useAgentPermissionAnswer } from './useAgentPermissionAnswer'
import type { AgentPermissionAnswerPanelState } from './useAgentPermissionAnswer'
```

2. `AgentTerminalPanelState` の `interrupt` の後に足す:

```ts
  /** 帯の 許可・拒否(選択中のタブが許可待ちのときだけ。問いの 1 行目・押せない理由・読み上げ・押したとき。設計書 2026-11-06) */
  permissionAnswer: AgentPermissionAnswerPanelState
```

3. `const agentInterrupt = useAgentInterrupt({` の直前に足す:

```ts
  // 許可の確認への答えの待ち(設計書 2026-11-06「useAgentWorkspace での組み立ての順」)。答えた直後は 中断 も押せないので、中断の hook と
  // 答えの hook の両方より先に作り、描画は state の関数、押した処理は ref の関数を渡す(同じ描画の値が届く。ref の写しを足さない)
  const answerCooldown = useAgentPermissionAnswerCooldown()
```

4. `useAgentInterrupt({ … })` の引数の `isTabOpen: …` の後に足す:

```ts
    isAnsweringPermission: answerCooldown.isPending,
    isAnsweringPermissionNow: answerCooldown.isPendingNow
```

5. `useAgentInterrupt` の呼び出しの後(`sendGateOf` の前)に足す:

```ts
  // 帯の 許可・拒否(設計書 2026-11-06)。描画に使う読み取りは選択中のタブが許可待ちの間だけ。送り先は押した時点の選択中のタブ。
  // 押せないのは送信中・送信前の確認の表示中・中断の流れの間(中断の hook の値をそのまま使う)・答えた直後
  const permissionPrompt = useAgentPermissionPrompt({
    selected: agentSessions.selected,
    activity: activities.get(agentSessions.selected.slotId) ?? 'unknown',
    isAwaitingReread: answerCooldown.isAwaitingReread,
    onReread: answerCooldown.markReread
  })
  const permissionAnswer = useAgentPermissionAnswer({
    selected: agentSessions.selected,
    activities,
    prompt: permissionPrompt.prompt,
    isSending: agentSender.isSending,
    isSendConfirmOpen: sendConfirm.pending !== null,
    isInterruptPending: agentInterrupt.isInterruptPending,
    isInterrupting: agentInterrupt.isInterrupting,
    cooldown: answerCooldown,
    answerPermission: agentSessions.answerPermission
  })
```

6. 戻り値の `agentTerminal` の `interrupt: { … },` の後に `permissionAnswer,` を足す

- [ ] **Step 7: 通ることと、配線の変異で落ちることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/agentInterrupt.test.ts src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: PASS

続けて、`useAgentWorkspace.ts` の次の箇所を **1 つずつ** 書き換えて `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` を流し、**どれでも少なくとも 1 つのテストが落ちる**ことを確かめてから元に戻す(L-060)。落ちない変異があれば、それを捕まえるテストを足す:

| 変異 | 落ちるはずのテスト |
| --- | --- |
| `prompt: permissionPrompt.prompt` → `prompt: null` | `onAnswer(allow) を呼ぶと … 1 で呼び` |
| `isSending: agentSender.isSending` → `isSending: false`(答えの hook の側) | `送信中は理由を出し` |
| `isSendConfirmOpen: sendConfirm.pending !== null` → `false`(答えの hook の側) | `送信前の確認の表示中は理由を出し` |
| `isInterruptPending: agentInterrupt.isInterruptPending` → `() => false` かつ `isInterrupting: agentInterrupt.isInterrupting` → `() => false` | `中断の流れの間は理由を出し` |
| `answerPermission: agentSessions.answerPermission` → `async () => ({ kind: 'skipped' })` | `onAnswer(allow) を呼ぶと …`(IPC が呼ばれない) |
| `isAwaitingReread: answerCooldown.isAwaitingReread` → `() => false` | `1,000ms 後に読み直して押せる状態に戻る`(読み直し待ちが外れない) |
| `onReread: answerCooldown.markReread` → `() => undefined` | `1,000ms 後に読み直して押せる状態に戻る` |
| `isAnsweringPermission: answerCooldown.isPending` → `() => false` | `答えた直後は 中断 に答えた直後の理由が出て` |
| `isAnsweringPermissionNow: answerCooldown.isPendingNow` → `() => false` | `答えた直後は 中断 に … 押した時点の判定で送らない` |

`isInterruptPending` と `isInterrupting` を片方ずつ外す変異は、描画の理由(state)か押した処理(ref)の片方だけが残るので、`中断の流れの間は理由を出し` の 2 つの期待(理由・呼ばない)のどちらかで落ちることを確かめる。

続けて: `npm run typecheck` と `npx eslint src/renderer/src/lib/agentInterrupt.ts src/renderer/src/lib/agentInterruptMessages.ts src/renderer/src/hooks/useAgentInterrupt.ts src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/__tests__/makeAgentTerminalPanelState.ts src/renderer/src/lib/__tests__/agentInterrupt.test.ts src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts --max-warnings 0`

ここまでで `AgentTerminalPanelState` に必須の欄が増えたので、renderer 全体も流す: `NODE_ENV=test npx vitest run src/renderer`
Expected: PASS(落ちたら、`AgentTerminalPanelState`・`AgentSessionsState` を手で組み立てているテストに新しい欄を足す)

---

### Task 7: 帯の表示・フォーカス・CSS(renderer)

**Files:**
- Create: `src/renderer/src/hooks/useAgentPermissionAnswerFocus.ts`
- Create: `src/renderer/src/components/agent/AgentPermissionAnswerButton.tsx`
- Modify: `src/renderer/src/components/agent/AgentTerminalPanel.tsx`
- Modify: `src/renderer/src/assets/main.css`(`.agent-terminal-panel__status` の規則の後に問いの規則)
- Test: `src/renderer/src/hooks/__tests__/useAgentPermissionAnswerFocus.test.tsx`(新規)
- Test: `src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`・`AgentTerminalPanel.styles.test.tsx`(追記)

**Interfaces:**
- Consumes: `AgentTerminalPanelState.permissionAnswer`・`makeAgentPermissionAnswerPanelState`(Task 6)、`AgentPermissionAnswerButtonState`(Task 5)、`agentPermissionAnswerLabel`(Task 3)
- Produces:
  - `interface AgentPermissionAnswerFocusTargets { allowRef: RefObject<HTMLButtonElement | null>; denyRef: RefObject<HTMLButtonElement | null>; toggleRef: RefObject<HTMLButtonElement | null> }`
  - `function useAgentPermissionAnswerFocus(visible: boolean, targets: AgentPermissionAnswerFocusTargets): (event: FocusEvent<HTMLElement>) => void`
  - `AgentPermissionAnswerButton`(default export。props `{ label: string; state: AgentPermissionAnswerButtonState; onPress: () => void; ref?: Ref<HTMLButtonElement> }`)

**気をつける点:**
- L-157: `disabled` ではなく `aria-disabled="true"`。押した後もフォーカスは押したボタンに残る
- L-408: `click` の `event.detail > 1` を捨て、`Enter`・`Space` の `event.repeat` の `keydown` を `preventDefault` する。ボタンが消えたら開閉のボタン(`エージェント`)へ移し、`中断`・`終了`・ターミナルへは移さない。組で働くことをコメントに書く
- 読み上げの要素(`p.agent-terminal-panel__live`)は中断のものと分けて、もう 1 つ常に描く(パターン 87)
- CSS は素の `main.css`(Tailwind 不使用。ダークの色固定)。ボタンは既存の `.agent-terminal-panel__button` と `[aria-disabled='true']` の規則をそのまま使う

- [ ] **Step 1: 失敗するテストを書く(フォーカスの hook)**

```tsx
// src/renderer/src/hooks/__tests__/useAgentPermissionAnswerFocus.test.tsx
import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, it, expect } from 'vitest'
import { useAgentPermissionAnswerFocus } from '../useAgentPermissionAnswerFocus'

// 実際の DOM のフォーカスを見るため、renderHook ではなく小さな部品で使う
function Harness({ visible }: { visible: boolean }): React.JSX.Element {
  const allowRef = useRef<HTMLButtonElement>(null)
  const denyRef = useRef<HTMLButtonElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const onFocus = useAgentPermissionAnswerFocus(visible, { allowRef, denyRef, toggleRef })
  return (
    <>
      <section onFocus={onFocus} aria-label="パネル">
        <button ref={toggleRef} type="button">
          開閉
        </button>
        {visible && (
          <>
            <button ref={allowRef} type="button">
              許可
            </button>
            <button ref={denyRef} type="button">
              拒否
            </button>
          </>
        )}
        <button type="button">中断</button>
        <button type="button">終了</button>
      </section>
      <input aria-label="外の入力欄" />
    </>
  )
}

const button = (name: string): HTMLElement => screen.getByRole('button', { name })

describe('useAgentPermissionAnswerFocus', () => {
  it.each(['許可', '拒否'])('%s にフォーカスがあるまま消えたら、body に落ちたフォーカスを開閉のボタンへ移す(中断・終了へは移さない)', (name) => {
    const { rerender } = render(<Harness visible />)
    act(() => button(name).focus())
    rerender(<Harness visible={false} />)
    expect(button('開閉')).toHaveFocus()
    expect(button('中断')).not.toHaveFocus()
    expect(button('終了')).not.toHaveFocus()
  })

  it('blur・focusout が出た後に消えても移す(onBlur で控えを消さない)', () => {
    const { rerender } = render(<Harness visible />)
    const allow = button('許可')
    act(() => allow.focus())
    act(() => {
      allow.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }))
      allow.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
      window.dispatchEvent(new FocusEvent('blur'))
    })
    rerender(<Harness visible={false} />)
    expect(button('開閉')).toHaveFocus()
  })

  it('パネルの外へフォーカスを移していれば奪わない', () => {
    const { rerender } = render(<Harness visible />)
    act(() => button('許可').focus())
    act(() => screen.getByRole('textbox', { name: '外の入力欄' }).focus())
    rerender(<Harness visible={false} />)
    expect(screen.getByRole('textbox', { name: '外の入力欄' })).toHaveFocus()
  })

  it('パネルの中で最後にフォーカスを受けたのが 許可・拒否 でなければ移さない', () => {
    const { rerender } = render(<Harness visible />)
    act(() => button('許可').focus())
    act(() => button('中断').focus())
    act(() => (document.activeElement as HTMLElement).blur())
    rerender(<Harness visible={false} />)
    expect(document.activeElement).toBe(document.body)
  })

  it('控えを残さない: 一度消えて移した後、もう一度出て消えても、フォーカスを受けていなければ移さない', () => {
    const { rerender } = render(<Harness visible />)
    act(() => button('許可').focus())
    rerender(<Harness visible={false} />)
    expect(button('開閉')).toHaveFocus()
    act(() => (document.activeElement as HTMLElement).blur())
    rerender(<Harness visible />)
    rerender(<Harness visible={false} />)
    expect(document.activeElement).toBe(document.body)
  })
})
```

- [ ] **Step 2: 失敗するテストを書く(帯)**

`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`:

1. `makeAgentTerminalPanelState.ts` の import に `makeAgentPermissionAnswerPanelState` を足し、`import type { AgentPermissionAnswerPanelState } from '../../../hooks/useAgentPermissionAnswer'` を足す
2. `describe('AgentTerminalPanel: 中断', ...)` の後に足す:

```tsx
describe('AgentTerminalPanel: 許可の確認への答え', () => {
  const ALLOW = /^許可/
  const DENY = /^拒否/
  const ALLOW_NAME = '許可（claude 1 の「Do you want to proceed?」に 1 番の Yes で答える）'
  const DENY_NAME = '拒否（claude 1 の「Do you want to proceed?」に 4 番の No で答える）'
  const COOLDOWN = '答えを押した直後です（少し待つと押せます）'
  const NO_YES = '画面に「Yes」の選択肢が見つかりません（ターミナルで答えてください）'
  const FULL_QUESTION = 'Do you want to make this edit to a-very-long-file-name.md?'

  const answerState = (
    overrides: Partial<AgentPermissionAnswerPanelState> = {}
  ): AgentPermissionAnswerPanelState =>
    makeAgentPermissionAnswerPanelState({
      visible: true,
      question: { firstLine: 'Do you want to proceed?', full: 'Do you want to proceed?' },
      allow: { disabledReason: null, ariaLabel: ALLOW_NAME },
      deny: { disabledReason: null, ariaLabel: DENY_NAME },
      ...overrides
    })
  const permissionState = (
    permissionAnswer: Partial<AgentPermissionAnswerPanelState> = {}
  ): AgentTerminalPanelState =>
    makeAgentTerminalPanelState({
      sessions: makeSessions({ status: 'running' }),
      interrupt: makeAgentInterruptPanelState({ visible: true, disabledReason: '許可待ちのため中断できません（Esc は許可の拒否になります。ターミナルで答えてください）' }),
      permissionAnswer: answerState(permissionAnswer)
    })
  const allowButton = (): HTMLElement => screen.getByRole('button', { name: ALLOW })
  const denyButton = (): HTMLElement => screen.getByRole('button', { name: DENY })

  it('許可待ちでないときは、問いも 2 つのボタンも描かない', () => {
    const { container } = render(
      <AgentTerminalPanel
        state={makeAgentTerminalPanelState({
          sessions: makeSessions({ status: 'running' }),
          interrupt: makeAgentInterruptPanelState({ visible: true })
        })}
      />
    )
    expect(screen.queryByRole('button', { name: ALLOW })).toBeNull()
    expect(screen.queryByRole('button', { name: DENY })).toBeNull()
    expect(container.querySelector('.agent-terminal-panel__permission-question')).toBeNull()
  })

  it('許可待ちでは 許可・拒否 を 中断 の直前に並べ、名前は見える文字で始まる', () => {
    render(<AgentTerminalPanel state={permissionState()} />)
    expect(allowButton()).toHaveTextContent('許可')
    expect(denyButton()).toHaveTextContent('拒否')
    expect(allowButton()).toHaveAccessibleName(ALLOW_NAME)
    expect(denyButton()).toHaveAccessibleName(DENY_NAME)
    const buttons = screen.getAllByRole('button')
    const index = buttons.indexOf(allowButton())
    expect(buttons[index + 1]).toBe(denyButton())
    expect(buttons[index + 2]).toBe(screen.getByRole('button', { name: /^中断/ }))
  })

  it('問いは 1 行目を見える文字に、全文を title に入れ、読み上げの順番には出さない(aria-hidden)', () => {
    const { container } = render(
      <AgentTerminalPanel
        state={permissionState({
          question: { firstLine: 'Do you want to make this edit to', full: FULL_QUESTION }
        })}
      />
    )
    const question = container.querySelector('.agent-terminal-panel__permission-question')
    expect(question).toHaveTextContent('Do you want to make this edit to')
    expect(question).toHaveAttribute('title', FULL_QUESTION)
    expect(question).toHaveAttribute('aria-hidden', 'true')
    // 問いは 許可 の直前
    expect(question?.nextElementSibling).toBe(allowButton())
  })

  it('問いを読み取れないときは、問いを描かずにボタンだけ出す', () => {
    const { container } = render(<AgentTerminalPanel state={permissionState({ question: null })} />)
    expect(container.querySelector('.agent-terminal-panel__permission-question')).toBeNull()
    expect(allowButton()).toBeInTheDocument()
  })

  it('押せるときは aria-disabled・説明・title を付けない', () => {
    render(<AgentTerminalPanel state={permissionState()} />)
    for (const button of [allowButton(), denyButton()]) {
      expect(button).not.toHaveAttribute('aria-disabled')
      expect(button).not.toHaveAttribute('aria-describedby')
      expect(button).not.toHaveAttribute('title')
      expect(button).toBeEnabled()
    }
  })

  it('押せないときは aria-disabled(disabled ではない)で、ボタンごとの理由を説明(隠した span)と title に出す', () => {
    render(
      <AgentTerminalPanel
        state={permissionState({
          allow: { disabledReason: NO_YES, ariaLabel: ALLOW_NAME },
          deny: { disabledReason: null, ariaLabel: DENY_NAME }
        })}
      />
    )
    const allow = allowButton()
    expect(allow).toHaveAttribute('aria-disabled', 'true')
    expect(allow).not.toHaveAttribute('disabled')
    expect(allow).toHaveAccessibleDescription(NO_YES)
    expect(allow).toHaveAttribute('title', NO_YES)
    const description = document.getElementById(allow.getAttribute('aria-describedby') ?? '')
    expect(description).not.toBeVisible()
    expect(denyButton()).not.toHaveAttribute('aria-disabled')
  })

  it('2 つのボタンの説明は別々の要素を参照する(理由がボタンで違いうるため)', () => {
    render(
      <AgentTerminalPanel
        state={permissionState({
          allow: { disabledReason: NO_YES, ariaLabel: ALLOW_NAME },
          deny: { disabledReason: COOLDOWN, ariaLabel: DENY_NAME }
        })}
      />
    )
    expect(allowButton().getAttribute('aria-describedby')).not.toBe(
      denyButton().getAttribute('aria-describedby')
    )
    expect(denyButton()).toHaveAccessibleDescription(COOLDOWN)
  })

  it.each([
    ['押せるとき', null],
    ['押せないとき', COOLDOWN]
  ] as const)(
    '%s の click で onAnswer に選択肢を渡す(送らないことと理由の読み上げは hook の役目。L-058)',
    async (_name, disabledReason) => {
      const state = permissionState({
        allow: { disabledReason, ariaLabel: ALLOW_NAME },
        deny: { disabledReason, ariaLabel: DENY_NAME }
      })
      render(<AgentTerminalPanel state={state} />)
      await userEvent.click(allowButton())
      await userEvent.click(denyButton())
      expect(vi.mocked(state.permissionAnswer.onAnswer).mock.calls).toEqual([['allow'], ['deny']])
    }
  )

  it('キーボードのクリック(detail: 0)では onAnswer を呼び、ダブルクリックの 2 回目(detail: 2)では呼ばない', () => {
    const state = permissionState()
    render(<AgentTerminalPanel state={state} />)
    fireEvent.click(allowButton(), { detail: 0 })
    fireEvent.click(allowButton(), { detail: 1 })
    fireEvent.click(allowButton(), { detail: 2 })
    expect(state.permissionAnswer.onAnswer).toHaveBeenCalledTimes(2)
  })

  it('Enter・Space のキーリピートの keydown は既定の動作を止め、単発の Enter・Space は止めない(L-408)', () => {
    render(<AgentTerminalPanel state={permissionState()} />)
    for (const button of [allowButton(), denyButton()]) {
      expect(fireEvent.keyDown(button, { key: 'Enter', repeat: true })).toBe(false)
      expect(fireEvent.keyDown(button, { key: ' ', repeat: true })).toBe(false)
      expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true)
      expect(fireEvent.keyDown(button, { key: ' ' })).toBe(true)
    }
  })

  it('読み上げの要素(role="status")は中断のものと別に常に 2 つあり、答えの notice の文言を入れる', () => {
    const { container, rerender } = render(<AgentTerminalPanel state={makeAgentTerminalPanelState()} />)
    const lives = container.querySelectorAll('.agent-terminal-panel__live')
    expect(lives).toHaveLength(2)
    for (const live of lives) expect(live).toHaveAttribute('role', 'status')
    rerender(
      <AgentTerminalPanel
        state={permissionState({ notice: { text: 'claude 1 に許可（1 番の Yes）を送りました', id: 1 } })}
      />
    )
    const texts = [...container.querySelectorAll('.agent-terminal-panel__live')].map(
      (live) => live.textContent
    )
    expect(texts).toContain('claude 1 に許可（1 番の Yes）を送りました')
    expect(container.querySelectorAll('.agent-terminal-panel__live')[0]).toBe(lives[0])
    expect(container.querySelectorAll('.agent-terminal-panel__live')[1]).toBe(lives[1])
  })

  it('押せない状態に変わっても、フォーカスは押したボタンに残る(aria-disabled のため body に落ちない。L-157)', () => {
    const { rerender } = render(<AgentTerminalPanel state={permissionState()} />)
    allowButton().focus()
    rerender(
      <AgentTerminalPanel
        state={permissionState({ allow: { disabledReason: COOLDOWN, ariaLabel: ALLOW_NAME } })}
      />
    )
    expect(allowButton()).toHaveFocus()
  })

  // 移すかの判定の細部は useAgentPermissionAnswerFocus のテストで確かめる。ここでは帯の配線(section の onFocus・移し先)だけ
  it.each([ALLOW, DENY])(
    '%s にフォーカスがある状態で許可待ちが終わると、開閉のボタン(エージェント)へ移り、中断・終了へは移らない',
    (name) => {
      const { rerender } = render(<AgentTerminalPanel state={permissionState()} />)
      screen.getByRole('button', { name }).focus()
      rerender(
        <AgentTerminalPanel
          state={makeAgentTerminalPanelState({
            sessions: makeSessions({ status: 'running' }),
            interrupt: makeAgentInterruptPanelState({ visible: true }),
            permissionAnswer: makeAgentPermissionAnswerPanelState({ visible: false })
          })}
        />
      )
      expect(screen.getByRole('button', { name: /エージェント/ })).toHaveFocus()
      expect(screen.getByRole('button', { name: /^中断/ })).not.toHaveFocus()
      expect(screen.getByRole('button', { name: /^終了/ })).not.toHaveFocus()
    }
  )

  it('中断 のフォーカスの控えも、答えのボタンと同じ section の onFocus で働き続ける', () => {
    const { rerender } = render(<AgentTerminalPanel state={permissionState()} />)
    screen.getByRole('button', { name: /^中断/ }).focus()
    rerender(
      <AgentTerminalPanel
        state={makeAgentTerminalPanelState({
          sessions: makeSessions({ status: 'exited', exit: { exitCode: 0, reason: 'exited' } }),
          interrupt: makeAgentInterruptPanelState({ visible: false })
        })}
      />
    )
    expect(screen.getByRole('button', { name: /^起動/ })).toHaveFocus()
  })
})
```

`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx`:

1. `makeAgentTerminalPanelState.ts` の import に `makeAgentInterruptPanelState`(既にあれば不要)と `makeAgentPermissionAnswerPanelState` を足す
2. 最後の `describe` の中に足す:

```tsx
  it('許可の確認の問いは 1 行で省略して縮み(最大 24em)、状態の文言と同じ色', () => {
    const { container } = render(
      <AgentTerminalPanel
        state={makeAgentTerminalPanelState({
          sessions: makeAgentSessionsState({ selected: { status: 'running' } }),
          interrupt: makeAgentInterruptPanelState({ visible: true }),
          permissionAnswer: makeAgentPermissionAnswerPanelState({
            visible: true,
            question: { firstLine: 'Do you want to proceed?', full: 'Do you want to proceed?' }
          })
        })}
      />
    )
    const question = styleOf(container, '.agent-terminal-panel__permission-question')
    expect(question.whiteSpace).toBe('nowrap')
    expect(question.overflow).toBe('hidden')
    expect(question.textOverflow).toBe('ellipsis')
    expect(question.minWidth).toBe('0px')
    expect(question.maxWidth).toBe('24em')
    expect(question.flexGrow).toBe('0')
    expect(question.flexShrink).toBe('1')
    expect(question.color).toBe(styleOf(container, '.agent-terminal-panel__status').color)
    // ボタンは共通の規則で縮まない
    const allow = screen.getByRole('button', { name: /^許可/ })
    expect(getComputedStyle(allow).whiteSpace).toBe('nowrap')
  })
```


- [ ] **Step 3: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useAgentPermissionAnswerFocus.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx`
Expected: FAIL(フォーカスの hook が無い・帯に 許可・拒否 が無い・CSS の規則が無い)

- [ ] **Step 4: フォーカスの hook を実装する**

```ts
// src/renderer/src/hooks/useAgentPermissionAnswerFocus.ts
import { useLayoutEffect, useRef } from 'react'
import type { FocusEvent, RefObject } from 'react'

// 帯の 許可・拒否 が消えたときのフォーカスの移し先(AgentTerminalPanel が使う。設計書 2026-11-06「フォーカス」)。答えて許可待ちが終わると
// 2 つのボタンは消える。パネルの中で最後にフォーカスを受けたのが 許可・拒否 で、移す時点のフォーカスが body(または null)なら、帯にいつもあり
// disabled にならない開閉のボタン(エージェント)へ移す。中断(許可した後は作業中になり、続けて押した Enter で許可した作業を止める)・
// 終了(会話を失う)・ターミナル(続けて押した Enter・数字が CLI の入力になる)へは移さない(L-408)。作りは useAgentInterruptFocus と同じ

export interface AgentPermissionAnswerFocusTargets {
  allowRef: RefObject<HTMLButtonElement | null>
  denyRef: RefObject<HTMLButtonElement | null>
  /** 帯の開閉のボタン(移し先) */
  toggleRef: RefObject<HTMLButtonElement | null>
}

/** 戻り値はパネル(section)の onFocus に渡す(focusin で泡立つ。パネルの中で最後にフォーカスを受けた要素が 許可・拒否 かを控える) */
export function useAgentPermissionAnswerFocus(
  visible: boolean,
  { allowRef, denyRef, toggleRef }: AgentPermissionAnswerFocusTargets
): (event: FocusEvent<HTMLElement>) => void {
  // onFocus だけで控える。onBlur では消さない(ウィンドウが非アクティブになったときや、Chromium が要素を DOM から外すときにも blur が出るため)
  const lastFocusedWasAnswerRef = useRef(false)
  const wasVisibleRef = useRef(visible)

  useLayoutEffect(() => {
    const wasVisible = wasVisibleRef.current
    wasVisibleRef.current = visible
    if (!wasVisible || visible) return
    const shouldMove = lastFocusedWasAnswerRef.current
    // 移した・移さないに関わらず控えを戻す(古い控えを次の回に残さない)
    lastFocusedWasAnswerRef.current = false
    if (!shouldMove) return
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    toggleRef.current?.focus()
  }, [visible, toggleRef])

  return (event) => {
    lastFocusedWasAnswerRef.current =
      event.target === allowRef.current || event.target === denyRef.current
  }
}
```

- [ ] **Step 5: ボタン 1 つ分の部品を実装する**

```tsx
// src/renderer/src/components/agent/AgentPermissionAnswerButton.tsx
'use client'
import { useId } from 'react'
import type { Ref } from 'react'
import type { AgentPermissionAnswerButtonState } from '../../hooks/useAgentPermissionAnswer'

interface Props {
  /** 見える文字(許可・拒否) */
  label: string
  state: AgentPermissionAnswerButtonState
  onPress: () => void
  ref?: Ref<HTMLButtonElement>
}

// 帯の 許可・拒否 のボタン 1 つ分(設計書 2026-11-06「画面」)。中断 と同じ作り: 押せない理由は見える文字にしない(隠した span の
// aria-describedby と title だけ。理由がボタンで違いうるので、説明の要素はボタンごと)。
// disabled ではなく aria-disabled: 答えて押せなくなっても、フォーカスを body に落とさない(L-157)。押せない状態で押したときは hook が
// 理由を読み上げて送らない。1,000ms の待ち・読み直し待ち・同期の再入の防止(useAgentPermissionAnswer)と、ダブルクリック・キーリピートの
// 無視(ここ)と、ボタンが消えたときの移し先(useAgentPermissionAnswerFocus)は組で働く(L-408)
export default function AgentPermissionAnswerButton({
  label,
  state,
  onPress,
  ref
}: Props): React.JSX.Element {
  const reasonId = useId()
  const { disabledReason, ariaLabel } = state
  return (
    <>
      {disabledReason !== null && (
        <span id={reasonId} hidden>
          {disabledReason}
        </span>
      )}
      <button
        ref={ref}
        type="button"
        className="agent-terminal-panel__button"
        aria-label={ariaLabel}
        aria-disabled={disabledReason !== null ? true : undefined}
        aria-describedby={disabledReason !== null ? reasonId : undefined}
        title={disabledReason ?? undefined}
        onClick={(event) => {
          // ダブルクリック・ダブルタップの 2 回目は捨てる(キーボードのクリックは detail が 0 で影響しない)
          if (event.detail > 1) return
          onPress()
        }}
        onKeyDown={(event) => {
          // 押し続けた Enter・Space のリピートで、続けて出た許可の確認に答えない(単発の打鍵は止めない)
          if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault()
        }}
      >
        {label}
      </button>
    </>
  )
}
```

- [ ] **Step 6: 帯に組み込む(`AgentTerminalPanel.tsx`)**

1. import に足す:

```tsx
import { useAgentPermissionAnswerFocus } from '../../hooks/useAgentPermissionAnswerFocus'
import { agentPermissionAnswerLabel } from '../../lib/agentPermissionAnswerMessages'
import AgentPermissionAnswerButton from './AgentPermissionAnswerButton'
```

2. `const { sessions, layout, sendingSlotId, activities, resumeLast, interrupt, appCliKind } = state` に `permissionAnswer` を足す
3. `const handlePanelFocus = useAgentInterruptFocus(…)` を次に置き換える:

```tsx
  // セッションが終わって 中断 が消えたときのフォーカスの移し先(主ボタン、押せなければ開閉のボタン)
  const handleInterruptFocus = useAgentInterruptFocus(interrupt.visible, {
    interruptRef,
    primaryButtonRef,
    toggleRef
  })
  // 許可待ちが終わって 許可・拒否 が消えたときのフォーカスの移し先(開閉のボタン。中断・終了・ターミナルへは移さない)
  const allowRef = useRef<HTMLButtonElement>(null)
  const denyRef = useRef<HTMLButtonElement>(null)
  const handlePermissionAnswerFocus = useAgentPermissionAnswerFocus(permissionAnswer.visible, {
    allowRef,
    denyRef,
    toggleRef
  })
  // section の onFocus は 1 つなので、両方の控えを更新する
  const handlePanelFocus = (event: React.FocusEvent<HTMLElement>): void => {
    handleInterruptFocus(event)
    handlePermissionAnswerFocus(event)
  }
```

4. `{interrupt.visible && (` の直前(起動の理由の `{visibleReason !== null && !isActive && (…)}` の後)に足す:

```tsx
          {permissionAnswer.visible && (
            <>
              {/* 問いの 1 行目。全文は title。問いはボタンの名前に入れているので、読み上げの順番には出さない */}
              {permissionAnswer.question !== null && (
                <span
                  className="agent-terminal-panel__permission-question"
                  title={permissionAnswer.question.full}
                  aria-hidden="true"
                >
                  {permissionAnswer.question.firstLine}
                </span>
              )}
              <AgentPermissionAnswerButton
                ref={allowRef}
                label={agentPermissionAnswerLabel('allow')}
                state={permissionAnswer.allow}
                onPress={() => permissionAnswer.onAnswer('allow')}
              />
              <AgentPermissionAnswerButton
                ref={denyRef}
                label={agentPermissionAnswerLabel('deny')}
                state={permissionAnswer.deny}
                onPress={() => permissionAnswer.onAnswer('deny')}
              />
            </>
          )}
```

5. 末尾の中断の読み上げの `<p className="agent-terminal-panel__live" role="status">…</p>` の後に足す:

```tsx
      {/* 許可・拒否 の読み上げ(送れたとき・押せない状態で押したとき)。中断の読み上げと同じ要素で上書きし合わないよう分ける。常に描く(パターン 87) */}
      <p className="agent-terminal-panel__live" role="status">
        {toAnnouncementText(permissionAnswer.notice)}
      </p>
```

6. ファイルの先頭のコメント「見出しの帯(開閉・セッションのタブ・状態・中断・起動/終了・変更を確認・最大化)」を「見出しの帯(開閉・セッションのタブ・状態・許可の確認の問いと 許可・拒否・中断・起動/終了・変更を確認・最大化)」にする

- [ ] **Step 7: CSS を足す(`main.css`)**

`.agent-terminal-panel__status { … }` の規則の後に足す:

```css
/* 許可の確認の問いの 1 行目(帯の 許可・拒否 の直前。設計書 2026-11-06「狭い幅」)。狭い幅では状態の文言・タブ列と同じく先に縮み、
   末尾を省略する(全文は title)。色は状態の文言と同じ */
.agent-terminal-panel__permission-question {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 24em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #969696;
  font-size: 13px;
}
```

帯の 中断 の `[aria-disabled='true']` の規則の上のコメント「帯の 中断 の押せない状態」を「帯の 中断・許可・拒否 の押せない状態」にする。

- [ ] **Step 8: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useAgentPermissionAnswerFocus.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx src/renderer/src/components/agent/__tests__/EditorPanel.agentTerminal.test.tsx`
Expected: PASS

続けて: `npm run typecheck` と `npx eslint src/renderer/src/hooks/useAgentPermissionAnswerFocus.ts src/renderer/src/components/agent/AgentPermissionAnswerButton.tsx src/renderer/src/components/agent/AgentTerminalPanel.tsx src/renderer/src/hooks/__tests__/useAgentPermissionAnswerFocus.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx --max-warnings 0`

---

### Task 8: ROADMAP・文書の更新、テスト仕様書への追記と Artifact の再公開、全体の検証

**Files:**
- Modify: `ROADMAP.md`
- Modify: `README.md`(機能の一覧の「エージェント CLI の実行」の項)
- Modify: `docs/developer-guide.md`(3.4 の CLI ごとの表の列挙)
- Modify: `docs/manual-test-spec.md`
- Modify(食い違いがあれば): `docs/superpowers/specs/2026-11-06-agent-permission-answer-design.md` の「既知の制約」
- 生成: `.superpowers/manual-test-spec.html`(`node scripts/build-manual-test-spec.mjs`)

**Interfaces:**
- Consumes: Task 1〜7 の実装の文言(`lib/agentPermissionAnswerMessages.ts`・`lib/agentInterruptMessages.ts`)

**気をつける点:**
- 実機テスト仕様書の文言は、実装の文言(上の 2 つのファイル)と一字一句照らし合わせてから追記する(L-354)。既存の項目の ID と文言は変えない(AGT-219・AGT-246 の `中断` が許可待ちで押せないことは変わらない)。一度振った ID は変えない・再利用しない
- 実機での確認の手順はこのタスクに書かない(利用者が仕様書の ID でまとめて確かめる)

- [ ] **Step 1: ROADMAP を更新する**

1. 「今後実装した方がよい機能（未実装）」の「AI エージェント / 自律実行」の `- [ ] 危険な操作の承認フロー` を `- [x] 危険な操作の承認フロー` にし、次の行に書き添える(既存の項目の「実装済み(日付。設計書 …)」の書き方に合わせる):

```markdown
      - 実装済み（2026-11-06。設計書 `docs/superpowers/specs/2026-11-06-agent-permission-answer-design.md`）: エージェント CLI の許可の確認に、ターミナルパネルの帯の `許可`・`拒否` で答える（承認そのものは CLI が担う）。実装済み機能の「エージェントの許可の確認への帯からの答え」を参照。残り: 「今後は確かめない」系の選択肢・拒否の理由の入力・裏のタブへの答え・自動の承認
```

2. 「実装済み機能」の `### エージェントの実行の中断` の箇条書きの「連打の対策: …」の行の次に足す:

```markdown
- [x] 帯の `許可`・`拒否` で許可の確認に答えた直後（送っている途中・押してから 1,000ms・送った後の画面を読み直すまで）は、そのタブの `中断` を押せない（理由は `許可の答えを押した直後は中断できません（少し待つと押せます）`。2026-11-06）
```

3. 「実装済み機能」の `### エージェント向けの指示ファイルの編集支援` の節の後、`---` と `## MVP: エージェント CLI のアプリ内ターミナル実行` の前に、同じ形の節を足す:

```markdown
### エージェントの許可の確認への帯からの答え

設計書: `docs/superpowers/specs/2026-11-06-agent-permission-answer-design.md`（2026-11-06）。

- [x] エージェント CLI 方式で、選択中のタブの `claude`・`copilot` が許可を求めている間（活動の判定が `許可待ち`）だけ、ターミナルパネルの帯の `中断` の直前に問いの 1 行目（例: `Do you want to proceed?`。長ければ省略し、全文はマウスの `title`）と `許可`・`拒否` を出す
- [x] `許可` は文言がちょうど `Yes` の選択肢（1 回だけの許可）、`拒否` は `No` そのものか `No,` で始まる選択肢。押すと、ターミナルでその選択肢の番号キーを 1 回押したのと同じ 1 バイト（`1`〜`9`）を送る。矢印キーと `Enter` は送らない。「今後は確かめない」系の選択肢（`Yes, and …`・`Yes, and don't ask again …`）は帯に出さず、ターミナルで選ぶ
- [x] 確認のダイアログは挟まない。押した時点で画面を読み直し、許可待ちのままで、本文（コマンドなど）・問い・選択肢の番号と文言が描画したときと完全に同じで、番号キーが選択として効く画面のときだけ送る
- [x] 押せないとき（閉じる途中・送信中・送信前の確認の表示中・中断を送った直後・答えを送った直後・画面を読み取れない・番号キーが効かない〈`claude` はカーソルが `Yes`・`No` 以外にあるか `Tab` で答えの文の入力欄を開いたとき、`copilot` はカーソルが最後の選択肢〈代わりにしてほしいことの入力欄〉にあるとき〉・その選択肢が無い）は薄い色（`aria-disabled`）で、理由をマウスの `title` と読み上げの説明に出し、押すと理由を読み上げる
- [x] 送れたら `claude N に許可（1 番の Yes）を送りました` などを読み上げる。`copilot` の `拒否` は即決せず「代わりにしてほしいこと」の入力欄を開くので、`copilot N で拒否（2 番）を選びました。ターミナルで、代わりにしてほしいことを入力して Enter を押してください` と読み上げる。送れなかったら帯の下に `許可の答えを送れませんでした: …` を出す
- [x] 連打の対策: 押してから 1,000ms と、送った後の画面を読み直すまでは、そのタブの `許可`・`拒否` を押せない・同じタブの結果を待つ間の 2 回目を止める・ダブルクリックの 2 回目とキーリピートを無視する・押した後もフォーカスを押したボタンに残す。許可待ちが終わってボタンが消えたら、フォーカスを開閉のボタン（`エージェント`）へ移す（`中断`・`終了`・ターミナルへは移さない）
- [x] 専用の IPC `agentTerminal:answerPermission`（renderer からは `sessionId` と選択肢の番号だけを渡し、main が 1〜9 の整数であることを確かめて固定の表から 1 バイトを書く。そのウィンドウの今のセッションと一致するときだけ書く）

既知の制約（設計書の「既知の制約」と同じ）:

- 番号キーの効き方は `claude` 2.1.288・`copilot` 1.0.87 の実装を読んで確かめたもので、アプリの xterm.js と pty で番号キーを送った画面は記録していない（実機の AGT-298・299・302・303 で確かめる）。CLI の版で選択の部品が変わると、番号キーが即決しない・別の選択肢になる・入力欄に文字として入ることがありうる
- 読み取りの規則は記録した画面（`claude` 2.1.288・`copilot` 1.0.87）に合わせている。版で問い・選択肢・案内（`Tab to amend`）の形が変わると、読み取れない・番号キーが効かないと見なして押せなくなる（送る側には倒れない）。`copilot` 1.0.105 の `Something else, and tell Copilot …` の許可の画面では `拒否` を押せない
- `claude` は、カーソルが `Yes`・`No` 以外にあるとき（ターミナルで矢印を押した後）と、`Tab` で答えの文の入力の形にしたときは押せない。読み上げのモードの `claude`（`Tab to amend` を出さない）でも押せない
- `copilot` の `拒否` は即決せず、「代わりにしてほしいこと」の入力欄を開く。答えを終えるにはターミナルで文を入れて `Enter`（または何も入れずに `Esc` で操作ごと取り消し）を押す。帯から拒否の理由は入力できない
- 押した時点で画面を読み直して照合するが、画面は CLI の出力が反映された時点のもので、読み直してから CLI が数字を受け取るまでの間（通常は数十 ms 以内）に許可の確認が別のものに変わると、数字はその新しい画面に届く。新しい画面が許可の確認なら、同じ番号の選択肢が選ばれうる（1 番は `Yes`）
- 問い・選択肢・本文が前と同じ許可の確認が続く（同じコマンドの 2 回目など）と、照合では区別できない。答えた直後の 1,000ms と、送った後の画面を読み直すまで押せないことで、2 回目のタップが届くのを防ぐ
- 帯に出すのは問いの 1 行目だけで、`claude` の `Do you want to proceed?` のように、何を許可するか（コマンド）は帯からは分からない。中身はターミナルで見る
- 答えるのは選択中のタブだけ。裏のタブの許可の確認には、そのタブを選んでから答える
- 押せない理由は見える文字として出さない（`title` と `aria-describedby`、押したときの読み上げだけ。`中断` と同じ）
- ターミナルで利用者が直接押した番号キーには、連打の対策も読み直しも効かない（今までどおり）
```

- [ ] **Step 2: README と開発者ガイドを更新する**

`README.md` の機能の一覧の「エージェント CLI の実行（既定の実行方式）」の項の `完了・許可待ちの通知、中断、セッションの再開に対応しています。` を `完了・許可待ちの通知、中断、許可の確認への帯の 許可・拒否 での答え、セッションの再開に対応しています。` にする。

`docs/developer-guide.md` の 3.4 の「CLI の種類ごとの違いは表(…)に」の括弧の中の `src/shared/agentInstructionFiles.ts`〈指示ファイルの一覧と雛形〉の後に `・renderer/src/lib/agentPermissionPromptReaders.ts`〈許可の確認の読み取り〉・`renderer/src/lib/agentPermissionAnswerMessages.ts` の `AGENT_PERMISSION_ANSWER_TEXTS`〈許可の確認への答えの文言〉を足す。

- [ ] **Step 3: 実機テスト仕様書に追記する**

追記の前に最大の ID を確かめる: `grep -o 'AGT-[0-9]*' docs/manual-test-spec.md | sort -t- -k2 -n | tail -1`(このプランを書いた時点では `AGT-296`。違えばその次から振り、下の ID をずらす)。

`docs/manual-test-spec.md` の `## エージェント CLI のアプリ内ターミナル` の末尾(`### 送信前の確認の引数` の最後の項目 `AGT-296` の後、`## エージェントの変更の確認` の前)に足す。文言は、`lib/agentPermissionAnswerMessages.ts` の実装の文言と照らし合わせ、違えば実装の文言に合わせる:

```markdown
### 許可の確認への帯からの答え

> 前提: エージェント CLI 方式で、テスト用のフォルダを開いて `claude 1` を起動している。`claude` の許可の確認は、ターミナルの入力欄に `Bash で sleep 3 を実行して` を入力して `Enter` で送って出す（`sleep` はファイルを変えない）。許可の確認が出ずに実行された（設定で許可済み）ときは、そのことを記録して、許可で答える項目を飛ばす。ファイルを書き換える操作には `許可` を使わない。「今後は確かめない」系の選択肢は選ばない。保存される設定（使う CLI・VoiceOver）を変えたら戻す。
> 前提: `copilot` の項目（AGT-302〜304）は、`### copilot の画面の判定と中断` の前提（使う CLI の切り替え・ほかの prompt-ide を動かさない・フォルダの信頼の確認の答え方）と同じで、最後の項目の後に設定の `使うエージェント CLI` を `Claude Code（claude）` に戻す。`copilot` の許可の確認は、入力欄に `Run the shell command sleep 3.` を入力して `Enter` で送って出す。

- [ ] **AGT-297** `claude` の許可の確認を出し、帯を見る → 帯が `許可待ち` で、その右に `Do you want to proceed?` と `許可`・`拒否` が並び、`中断` は薄い色のまま。問いの文字にマウスを載せると全文が出る。入力待ちに戻ると問いと 2 つのボタンは消える
- [ ] **AGT-298** `claude` の許可の確認を出し、帯の `許可` をタップ（またはクリック）する → 確認のダイアログは出ず、`sleep 3` が実行されて帯が `作業中` になり、問いと 2 つのボタンが消える。ターミナルの選択肢は 1 番の `Yes` が選ばれている（`Yes, and …` は選ばれない）。作業が終わると `入力待ち` に戻る
- [ ] **AGT-299** `このフォルダに permission-test.txt を作って` を送り、許可の確認が出たら帯の `拒否` を押す → `No` が選ばれ、ファイルは作られず、帯が `入力待ち` に戻って問いと 2 つのボタンが消える。許可の確認が出ずにファイルが作られた（設定で許可済み）ときは、そのことを記録し、テスト用のフォルダの中の `permission-test.txt` を消してから次へ進む
- [ ] **AGT-300** VoiceOver を有効にして `claude` の許可の確認を出し、ターミナルの中をクリックしてから `F6` で抜けて（フォーカスが開閉のボタン `エージェント` に移る）、`Tab` を押してフォーカスリングを見ながら `許可` へ移し、`Enter` を押す → `許可（claude 1 の「Do you want to proceed?」に 1 番の Yes で答える）` と読まれ、押すと `claude 1 に許可（1 番の Yes）を送りました` が読み上げられる。ボタンが消えた後、フォーカスリングは `エージェント` にある（`中断`・`終了`・ターミナルには無い）。確かめた後、VoiceOver を切る
- [ ] **AGT-301** `claude` の許可の確認を出し、ターミナルの中をクリックして `↓` を 1 回押し、カーソルを 2 番に動かしてから（`Enter` は押さない）帯の `許可` にマウスを載せて押す → `許可` は薄い色で、`カーソルが Yes・No 以外にあるか、答えの文の入力欄が開いているため押せません（ターミナルで答えてください）` が出て、押しても選択肢は変わらない。続けてターミナルで `↑` を押してカーソルを 1 番に戻すと、`許可` が押せる色に戻る。続けてターミナルで `Tab` を押して `Yes` を入力の形にすると、また押せなくなる。確かめた後、ターミナルで `Esc` を押して答えずに閉じる（拒否として扱われ、`sleep` は実行されない）
- [ ] **AGT-302** `copilot 1` を起動して許可の確認を出し、帯を見てから `許可` を押す → 帯に `Do you want to run this command?` と `許可`・`拒否` が出る。押すと `1. Yes` が選ばれて `sleep 3` が実行され、帯が `作業中` になってボタンが消える（`Yes, and don't ask again …` は選ばれない）
- [ ] **AGT-303** VoiceOver を有効にして `copilot` の許可の確認を出し、帯の `拒否` を押す → 選択肢の `2. No, and tell Copilot what to do differently` の行が入力欄に変わり、`copilot 1 で拒否（2 番）を選びました。ターミナルで、代わりにしてほしいことを入力して Enter を押してください` が読み上げられる。帯は `許可待ち` のままで、`許可`・`拒否` は薄い色になり、マウスを載せると `copilot は、代わりにしてほしいことの入力を待っています（…）` が出る。もう一度 `許可`・`拒否` を押しても、入力欄に数字は入らない。続けてターミナルの中をクリックして `Do nothing and stop.` と入力して `Enter` を押す → `copilot` が答えを受け取り、許可の確認が閉じて帯のボタンが消える。確かめた後、VoiceOver を切る
- [ ] **AGT-304** `copilot` の許可の確認を出し、帯の `許可` をすばやくダブルクリックする（別の回に、`Tab` で `許可` へ移して `Enter` を 2 秒押し続ける） → どちらの回も `sleep 3` が 1 回だけ実行され、続けて別の許可の確認が出ても答えられていない（出たら `拒否` を押してから、ターミナルで `Esc` を押して取り消す）。確かめた後、設定の `使うエージェント CLI` を `Claude Code（claude）` に戻す
- [ ] **AGT-305** サイドバーを開いたまま、ウィンドウの幅を AGT-225 と同じく 670px 程度まで狭めて、`claude` の許可の確認の帯を見る → 帯は 1 行（高さ 32px）のまま、`エージェント`・`許可`・`拒否`・`中断`・`終了`・`最大化` のボタンは文字も枠も切れずに見える。記録があれば `変更を確認` のボタンは枠が切れずに見え、文字は末尾が `…` で省略されうる（AGT-225 と同じ）。記録がある状態でも `最大化` が切れないことを確かめ、切れたらどのボタンが切れたかを記録する。問いの文字・タブ列・`許可待ち` は狭まって途中で省略されうる。確かめた後、ターミナルで `Esc` を押して答えずに閉じる
- [ ] **AGT-306** `+` で `claude 2` を起動し、`claude 1` で許可の確認を出してから `claude 2`（入力待ち）を選ぶ → `claude 2` の帯には問いもボタンも出ない。`claude 1` を選び直すと出て、`拒否` を押すと `claude 1` だけが答え、`claude 2` の画面は変わらない。確かめた後、`claude 2` を `×` で閉じる
```

- [ ] **Step 4: 仕様書の HTML を再生成し、検査を通す**

Run: `node scripts/build-manual-test-spec.mjs && NODE_ENV=test npx vitest run scripts`
Expected: PASS(ID の一意性・接頭辞ごとの連番が昇順・書式)

その後、Artifact(<manual-test-spec-artifact-url>)を同じファイルパス `.superpowers/manual-test-spec.html` で再公開する(実装のサブエージェントではなく、親のセッションが Artifact のツールで行う)。

- [ ] **Step 5: 設計書の「既知の制約」を実装と照らし合わせる**

設計書の「既知の制約」の各項目が、実装(特に `useAgentPermissionPrompt` の読み直しの待ち方・`AgentPermissionAnswerButton`・文言)と食い違っていないかを読み、違えば設計書を直す。このプランの「設計書からの細部の変更」の 5 つ(表のファイル・`findAgentPermissionOption` の引数・ボタンの部品・選び直したタブの即時の読み直し・名前の番号の引き方)を、設計書の該当の節(「型と表」「構成」「描画に使う読み取り」「画面」)に反映する。

- [ ] **Step 6: 全体を検証する**

Run(順に。`NODE_ENV` は test にする):
- `NODE_ENV=test npm test`
- `npm run typecheck`
- `npx eslint . --max-warnings 0`
- `npm run build`

Expected: すべて成功。時間切れで落ちたテストは単独で流し直して再現するか確かめる(開発者ガイド 6)
