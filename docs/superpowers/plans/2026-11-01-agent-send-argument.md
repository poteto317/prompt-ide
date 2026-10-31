# 送信前の確認の引数欄 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 送信前の確認のダイアログに `引数` の欄を置き、本文の直後へ付けて送り、実際に送った全文を履歴へ残す。

**Architecture:** 全文の組み立てを `composeText(argument)` の 1 つに集める。`useAgentSendConfirm` が関数を保持し、ダイアログの表示と送信が同じ関数を使う。送った全文は `onSent` の第 3 引数で `usePromptRunner` へ返して記録する。

**Tech Stack:** React、TypeScript、vitest、Testing Library、Electron

設計書: `docs/superpowers/specs/2026-11-01-agent-send-argument-design.md`

実装後の補足: Task 2 の入力欄は、リファクタリングで `components/agent/AgentSendArgumentField.tsx` へ分けた(下のコード片の `argumentId` と `<input>` はこの部品の中にある)。AGT-294・295 の文面はレビューで直した。現行の文面は `docs/manual-test-spec.md` を見る。

気をつける知見: L-408(キーリピート)、L-474(IME の Enter)、L-653(多重送信)、L-018(検証と実行の値の食い違い)、L-655(文の意味)

## Global Constraints

- 返答・コメントは日本語。`git commit`・`git push` はしない(各タスクにコミットの手順は無い)
- テストは `NODE_ENV=test` を付ける。全体の実行は `NODE_ENV=test npx vitest run --testTimeout=30000`
- 型のみの import は `import type`
- 引数が空のときは本文を 1 文字も変えない
- 確認を経由しない送信の内容は変えない
- 文言: ラベルは `引数（任意）`、aria は `<label>` で結びつける
- 実機テスト仕様書の ID は変えない

---

### Task 1: 全文の組み立てと履歴の記録

**Files:**
- Create: `src/renderer/src/lib/agentPromptArgument.ts`
- Create: `src/renderer/src/lib/__tests__/agentPromptArgument.test.ts`
- Modify: `src/renderer/src/lib/agentPromptRequest.ts`
- Modify: `src/renderer/src/lib/agentSendCallbacks.ts`
- Modify: `src/renderer/src/hooks/useAgentSendConfirm.ts`
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`
- Modify: `src/renderer/src/hooks/usePromptRunner.ts`
- Modify: `src/renderer/src/types.ts`
- Modify: `src/renderer/src/components/agent/AgentSendConfirmDialog.tsx`(型に合わせる最小の変更)
- Test: `src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`、`useAgentWorkspace.test.ts`、`usePromptRunner` のテスト、`lib/__tests__/agentPromptRequest.test.ts`、`lib/__tests__/agentSendCallbacks.test.ts`、`components/agent/__tests__/AgentSendConfirmDialog.test.tsx`

**Interfaces:**
- Produces:
  - `appendAgentPromptArgument(text: string, argument: string): string`
  - `AgentSendOptions.composeText?: (argument: string) => string`
  - `AgentSentHandler = (sentTo: AgentHistoryInfo | null, cliKind: AgentCliKind, sentText: string) => void`
  - `notifyAgentSent(outcome, onSent, sentText: string): void`
  - `PendingAgentSend` と `AgentSendConfirmPending`: `text` を外し、`composeText: (argument: string) => string` を必須で持つ
  - `AgentSendConfirmState.confirm: (argument: string) => void`、`AgentSendConfirmDialogState.onConfirm: (argument: string) => void`

- [ ] **Step 1: 失敗するテストを書く**

`agentPromptArgument.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { appendAgentPromptArgument } from '../agentPromptArgument'

describe('appendAgentPromptArgument', () => {
  it('引数が空なら本文を 1 文字も変えない', () => {
    expect(appendAgentPromptArgument('/review \n', '')).toBe('/review \n')
    expect(appendAgentPromptArgument('/review \n', '   ')).toBe('/review \n')
  })

  it('本文の直後へ半角空白 1 つで繋ぐ', () => {
    expect(appendAgentPromptArgument('/review', '123')).toBe('/review 123')
  })

  it('本文の末尾の空白・改行と、引数の前後の空白を除く', () => {
    expect(appendAgentPromptArgument('/review \n\n', '  123  ')).toBe('/review 123')
  })

  it('本文が空なら引数だけになる', () => {
    expect(appendAgentPromptArgument('', '123')).toBe('123')
    expect(appendAgentPromptArgument(' \n', '123')).toBe('123')
  })
})
```

`agentPromptRequest.test.ts` に追加する(既存の `prepared` の作り方に合わせる。`references` は 1 件):

```ts
it('composeText は引数を参照の一覧より前に入れ、空なら text と同じ全文を返す', () => {
  const request = buildAgentPromptRequest('/review', 'p1', prepared, vi.fn())
  expect(request.options.composeText?.('')).toBe(request.text)
  expect(request.options.composeText?.('123')).toBe(
    appendAgentReferences('/review 123', prepared.references)
  )
})
```

`agentSendCallbacks.test.ts` の検査を第 3 引数込みに直し、次を足す:

```ts
it('送った全文を第 3 引数で渡す', () => {
  const onSent = vi.fn()
  notifyAgentSent(
    { kind: 'sent', sentTo: null, cliKind: 'claude', clearedDraft: false },
    onSent,
    '/review 123'
  )
  expect(onSent).toHaveBeenCalledWith(null, 'claude', '/review 123')
})
```

`useAgentSendConfirm.test.ts` に追加する:

```ts
it('confirm(argument) は request の本文へ引数を付けて送り、送った全文を onSent へ渡す', async () => {
  const onSent = vi.fn()
  const { result, send } = setup()
  act(() => result.current.request('/review', { promptId: 'p1', unsavedPaths: [], onSent }))
  await act(async () => result.current.confirm('123'))
  expect(send).toHaveBeenCalledWith('/review 123', expect.anything())
  expect(onSent).toHaveBeenCalledWith(null, 'claude', '/review 123')
})

it('options の composeText があればそれで全文を作る', async () => {
  const composeText = vi.fn((argument: string) => `body ${argument}\n\nrefs`)
  const { result, send } = setup()
  act(() => result.current.request('body', { promptId: 'p1', unsavedPaths: [], composeText }))
  await act(async () => result.current.confirm('1'))
  expect(send).toHaveBeenCalledWith('body 1\n\nrefs', expect.anything())
})
```

`setup` はファイルの既存の準備 `renderConfirm` に置き換える。`usePromptRunner` のテストに、`sendToAgent` の options の `onSent` を `(sentTo, cliKind, '/review 123')` で呼ぶと履歴に `/review 123` が記録されることを、一覧の実行と `再実行` の 2 件で足す。

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/agentPromptArgument.test.ts src/renderer/src/lib/__tests__/agentPromptRequest.test.ts src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`
Expected: FAIL(`appendAgentPromptArgument` が無い ほか)

- [ ] **Step 3: 実装する**

`agentPromptArgument.ts`:

```ts
// 送信前の確認で渡す引数を本文へ付ける。`/review` と `123` から `/review 123` を作る。引数が空なら本文を変えない
export function appendAgentPromptArgument(text: string, argument: string): string {
  const value = argument.trim()
  if (value === '') return text
  const body = text.trimEnd()
  return body === '' ? value : `${body} ${value}`
}
```

`agentPromptRequest.ts`:

```ts
export type AgentSentHandler = (
  sentTo: AgentHistoryInfo | null,
  cliKind: AgentCliKind,
  sentText: string
) => void
```

`AgentSendOptions` に足す:

```ts
  /** 引数から送る全文を作る。無ければ本文の末尾へ付ける(履歴の再実行)。すぐ送る経路では使わない */
  composeText?: (argument: string) => string
```

`buildAgentPromptRequest`:

```ts
  // 引数は参照の一覧より前に入れる(`/review 123` の形を崩さない)。写しの一覧を閉じ込める
  const references = [...prepared.references]
  const composeText = (argument: string): string =>
    appendAgentReferences(appendAgentPromptArgument(content, argument), references)
  return {
    text: composeText(''),
    options: {
      promptId,
      unsavedPaths: [...prepared.unsavedPaths],
      onSent,
      composeText
    }
  }
```

`agentSendCallbacks.ts`:

```ts
export function notifyAgentSent(
  outcome: AgentPromptSendResult | undefined,
  onSent: AgentSentHandler | undefined,
  sentText: string
): void {
  if (outcome?.kind !== 'sent' || onSent === undefined) return
  try {
    onSent(outcome.sentTo, outcome.cliKind, sentText)
```

先頭のコメントの説明に「送った全文」を足す。

`useAgentSendConfirm.ts`:

```ts
export interface PendingAgentSend extends Omit<AgentSendOptions, 'composeText'> {
  /** 引数から送る全文(正規化の前)を作る。全文の出どころはこの関数だけ */
  composeText: (argument: string) => string
```

`text` の項目を外す。`request`:

```ts
const next: PendingAgentSend = {
  ...options,
  composeText:
    options.composeText ?? ((argument) => appendAgentPromptArgument(text, argument)),
  target: { slotId, controller, describeSession, cliKind },
  label,
  opener: document.activeElement
}
```

`confirm`:

```ts
const confirm = useCallback(
  (argument: string): void => {
    const current = pendingRef.current
    if (current === null) return
    pendingRef.current = null
    setPending(null)
    const { composeText, target, promptId, opener, onSent } = current
    const text = composeText(argument)
    void (async (): Promise<void> => {
      let outcome: AgentPromptSendResult | undefined
      try {
        outcome = await send(text, target)
      } catch (err) {
        console.error('[useAgentSendConfirm] send failed:', err)
      } finally {
        notifyAgentSent(outcome, onSent, text)
        onSendSettledRef.current({ slotId: target.slotId, promptId, opener, outcome })
      }
    })()
  },
  [send, onSendSettledRef]
)
```

`composeText` は純粋な関数なので `try` の外で作る。上のコード片に無い既存のコメント(`request` の送り先の控えの理由〈L-058〉、`confirm` の `send` と `onSent` の L-053 の理由)は消さずに残す。`AgentSendConfirmState.confirm` の型を `(argument: string) => void` にする。

`useAgentWorkspace.ts`: `notifyAgentSent(outcome, options.onSent, text)`。ダイアログへの写しは `text: pendingSend.text` を `composeText: pendingSend.composeText` に変える。

`types.ts`: `AgentSendConfirmPending` の `text` を外して次を足し、`onConfirm` を変える。

```ts
  /** 引数から送る全文(正規化の前)を作る。ダイアログが正規化して表示する */
  composeText: (argument: string) => string
```

```ts
  onConfirm: (argument: string) => void
```

`usePromptRunner.ts`: 一覧の実行は `(sentTo, cliKind, sentText) => { ...; recordAgentSent(context, sentText, sentTo, cliKind) }`、`再実行` は `onSent: (sentTo, cliKind, sentText) => recordAgentSent(context, sentText, sentTo, cliKind)`。

`AgentSendConfirmDialog.tsx` はこのタスクでは型を通す最小の変更にする: `const { composeText, cliKind } = pending` と分割して `useMemo(() => buildAgentSendPreview(composeText(''), cliKind), [composeText, cliKind])`、`onConfirm('')`。`pending` は描画ごとに新しいオブジェクトになるため、依存に `pending` を入れない(20 万字の本文を描画のたびに正規化しない)。

コメントを実際の動作に合わせる: `agentPromptRequest.ts` の `AgentSentHandler` と `onSent` の説明(第 3 引数は送った全文)、`useAgentSendConfirm.ts` の先頭の「送る全文」、`usePromptRunner.ts` の `再実行` の「同じ全文を送り」「記録した全文をそのまま送る」(引数が付くことがある)。

- [ ] **Step 4: 既存のテストを直す**

`text` の除去と `confirm(argument)`・第 3 引数に合わせて次を直す。検査の意味は変えない。`pending?.text` の検査は `pending?.composeText('')`、`confirm()` は `confirm('')`、`makePending({ text: 'x' })` は `composeText: () => 'x'` にする。

- `hooks/__tests__/useAgentSendConfirm.test.ts`: 76 行の `toEqual` は `composeText: expect.any(Function)` を足す。324 行の 2 引数の検査
- `hooks/__tests__/useAgentWorkspace.test.ts`: `pending` の `toEqual`(856 行ほか)、`onConfirm()`、`onSent` の 2 引数の検査
- `hooks/__tests__/usePromptRunner.test.ts`: 196・271 行の `toHaveBeenCalledExactlyOnceWith` は options に `composeText: expect.any(Function)` を足す。`onSent(x, 'claude')` の呼び出しは第 3 引数を足す
- `hooks/__tests__/useAppState.agent.test.ts:930`: fixture の `text`
- `lib/__tests__/agentPromptRequest.test.ts:16`: `options` の `toEqual`
- `lib/__tests__/agentSendCallbacks.test.ts`: 既存の `notifyAgentSent` の呼び出し
- `components/__tests__/App.agentSendConfirm.test.tsx`: 38・65 行の `text: '本文'`
- `components/agent/__tests__/AgentSendConfirmDialog.test.tsx`: `makePending`。既定は現在の本文のまま `composeText: () => <本文>` にする

- [ ] **Step 5: 検証する**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib src/renderer/src/hooks src/renderer/src/components/agent src/renderer/src/components/__tests__ --testTimeout=30000 && npm run typecheck`
Expected: PASS

- [ ] **Step 6: 実装を戻すと落ちることを確かめる**

`buildAgentPromptRequest` の組み立てを `appendAgentPromptArgument(appendAgentReferences(content, references), argument)` に、`usePromptRunner` の `sentText` を `request.text`・`entry.promptContent` に一時的に戻し、該当のテストが落ちることを確かめて元へ戻す。

### Task 2: ダイアログの引数欄

**Files:**
- Modify: `src/renderer/src/components/agent/AgentSendConfirmDialog.tsx`
- Modify: `src/renderer/src/assets/main.css`
- Test: `src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx`、`AgentSendConfirmDialog.styles.test.tsx`(無ければ作る。`CollapsibleSection.styles.test.tsx` の `main.css` の読み込みと同じ形)

**Interfaces:**
- Consumes: Task 1 の `pending.composeText(argument)`、`onConfirm(argument)`
- Produces: 入力欄 `role="textbox"`、名前 `引数（任意）`、クラス `agent-send-confirm__argument`

- [ ] **Step 1: 失敗するテストを書く**

`AgentSendConfirmDialog.test.tsx` に足す。`makePending` の既定は変えず、この節の準備を足す:

```tsx
const argumentInput = (): HTMLElement => screen.getByRole('textbox', { name: '引数（任意）' })
const renderDialog = (overrides: Partial<AgentSendConfirmDialogState> = {}) =>
  render(
    <AgentSendConfirmDialog
      state={makeState({
        pending: makePending({
          composeText: (argument) => appendAgentPromptArgument('/review', argument)
        }),
        ...overrides
      })}
    />
  )

it('開いたら引数欄にフォーカスがある', () => {
  renderDialog()
  expect(argumentInput()).toHaveFocus()
})

it('送れない理由があるときは開いたフォーカスがキャンセルへ行く', () => {
  renderDialog({ pending: makePending({ composeText: () => '' }) })
  expect(cancelButton()).toHaveFocus()
})

it('入力に合わせて本文と文字数を更新する', async () => {
  renderDialog()
  await userEvent.type(argumentInput(), '123')
  expect(screen.getByRole('region', { name: '送る内容' })).toHaveTextContent('/review 123')
  expect(screen.getByText('11 文字')).toBeInTheDocument()
})

it('引数で送れない理由が解消すれば送信を押せる', async () => {
  const pending = makePending({
    composeText: (argument) => appendAgentPromptArgument('', argument)
  })
  renderDialog({ pending })
  expect(submitButton()).toBeDisabled()
  await userEvent.type(argumentInput(), 'x')
  expect(submitButton()).toBeEnabled()
})

it('送信は入力した引数を渡す', async () => {
  const onConfirm = vi.fn()
  renderDialog({ onConfirm })
  await userEvent.type(argumentInput(), '123')
  await userEvent.click(submitButton())
  expect(onConfirm).toHaveBeenCalledWith('123')
})

it('引数欄の Enter は送信と同じ', () => {
  const onConfirm = vi.fn()
  renderDialog({ onConfirm })
  fireEvent.change(argumentInput(), { target: { value: '123' } })
  fireEvent.keyDown(argumentInput(), { key: 'Enter' })
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith('123')
})

it.each([
  ['isComposing', { key: 'Enter', isComposing: true }],
  ['keyCode 229', { key: 'Enter', keyCode: 229 }],
  ['キーリピート', { key: 'Enter', repeat: true }]
])('%s の Enter では送らない', (_label, init) => {
  const onConfirm = vi.fn()
  renderDialog({ onConfirm })
  fireEvent.keyDown(argumentInput(), init)
  expect(onConfirm).not.toHaveBeenCalled()
})

it('送れない理由があるときの Enter では送らない', () => {
  const onConfirm = vi.fn()
  renderDialog({ onConfirm, targetBlockedReason: '送信中です' })
  fireEvent.keyDown(argumentInput(), { key: 'Enter' })
  expect(onConfirm).not.toHaveBeenCalled()
})

it('変換の取り消しの Esc では閉じない', () => {
  const onCancel = vi.fn()
  renderDialog({ onCancel })
  fireEvent.keyDown(argumentInput(), { key: 'Escape', isComposing: true })
  expect(onCancel).not.toHaveBeenCalled()
})

it('開いている間に送信を押せなくなっても、引数欄のフォーカスは移さない', () => {
  const state = makeState({ pending: makePending() })
  const { rerender } = render(<AgentSendConfirmDialog state={state} />)
  expect(argumentInput()).toHaveFocus()
  rerender(
    <AgentSendConfirmDialog state={{ ...state, targetBlockedReason: '送信中です' }} />
  )
  expect(argumentInput()).toHaveFocus()
})

it('Space のキーリピートは引数欄に入らない', () => {
  renderDialog()
  const notPrevented = fireEvent.keyDown(argumentInput(), { key: ' ', repeat: true })
  expect(notPrevented).toBe(false)
})
```

`submitButton`・`cancelButton`・`makeState`・`makePending` はファイルの既存の準備を使う。

スタイルのテスト:

```tsx
it('引数欄は本文の枠と同じ背景・枠・文字色・文字サイズ', () => {
  const body = document.createElement('pre')
  body.className = 'agent-send-confirm__body'
  const input = document.createElement('input')
  input.className = 'agent-send-confirm__argument'
  document.body.append(body, input)
  const a = getComputedStyle(body)
  const b = getComputedStyle(input)
  for (const prop of ['backgroundColor', 'borderTopColor', 'color', 'fontSize'] as const) {
    expect(b[prop]).toBe(a[prop])
  }
  body.remove()
  input.remove()
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog`
Expected: FAIL(`引数（任意）` の textbox が無い)

- [ ] **Step 3: 実装する**

`AgentSendConfirmDialogBody`:

```tsx
const [argument, setArgument] = useState('')
const argumentRef = useRef<HTMLInputElement>(null)
const argumentId = useId()
```

プレビューは引数で作り直す。

```tsx
const { composeText, cliKind } = pending
const preview = useMemo(
  () => buildAgentSendPreview(composeText(argument), cliKind),
  [composeText, cliKind, argument]
)
```

`handleConfirm` は `if (!isSubmitDisabled) onConfirm(argument)`。開いたときの effect:

```tsx
// 開いたら引数欄へ。送れない(押せない)ときはキャンセルへ。開いたときだけ
useEffect(() => {
  const submit = submitRef.current
  if (submit !== null && !submit.disabled) argumentRef.current?.focus()
  else cancelRef.current?.focus()
}, [])
```

`onKeyDownCapture` の条件を広げる:

```tsx
if (
  e.repeat &&
  isActivationKey(e.key) &&
  (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement)
) {
  e.preventDefault()
}
```

文字数の段落の後に置く:

```tsx
<div className="agent-send-confirm__argument-field">
  <label htmlFor={argumentId} className="agent-send-confirm__argument-label">
    引数（任意）
  </label>
  <input
    ref={argumentRef}
    id={argumentId}
    type="text"
    className="agent-send-confirm__argument"
    value={argument}
    autoComplete="off"
    spellCheck={false}
    onChange={(e) => setArgument(e.target.value)}
    onKeyDown={(e) => {
      // IME の変換の確定とキーリピートでは送らない
      if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229 || e.repeat) return
      e.preventDefault()
      handleConfirm()
    }}
  />
</div>
```

コメントを直す: 「マウントの後では送信へ移っている」は「マウントの後では引数欄へ移っている」、「本文の理由はキャンセルして直すしかないため先に出す」は「本文の理由を先に出す。1 つだけ出す」、説明の読み上げのコメントは「開いたときのフォーカスは引数欄(送れない理由があるとキャンセル)」、フォーカストラップのコメントは「本文・引数欄・送信・キャンセル」、Enter のコメントは「開いた直後の引数欄・送信」。

`main.css`(`.agent-send-confirm__body` の規則の近く):

```css
.agent-send-confirm__argument-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-send-confirm__argument-label {
  color: #a0a0a0;
  font-size: 13px;
}

.agent-send-confirm__argument {
  box-sizing: border-box;
  width: 100%;
  min-height: 32px;
  padding: 4px 8px;
  background: #1e1e1e;
  border: 1px solid #3c3c3c;
  border-radius: 2px;
  color: #d4d4d4;
  font-family: Menlo, Monaco, 'Courier New', monospace;
  font-size: 13px;
}

.agent-send-confirm__argument:focus-visible {
  outline: 1px solid #007acc;
  outline-offset: -1px;
}
```

- [ ] **Step 4: 既存のテストを直す**

`submitButton()).toHaveFocus()` の検査のうち、開いた直後を確かめるものを `argumentInput()` へ直す。ただし「開いている間に送信を押せなくなったら、送信にあったフォーカスをキャンセルへ移す」(415 行)は、冒頭で `submitButton().focus()` を呼んで送信にあった場合の動作を保つ。Tab の順の検査は 本文 → 引数欄 → 送信 → キャンセル にする。テストのコメント(81・87 行の「開いたときのフォーカスは送信」)も直す。

- [ ] **Step 5: 検証する**

Run: `NODE_ENV=test npx vitest run src/renderer/src/components/agent && npm run typecheck && npx eslint src/renderer/src/components/agent/AgentSendConfirmDialog.tsx && npx prettier --check src/renderer/src/components/agent/AgentSendConfirmDialog.tsx src/renderer/src/assets/main.css`
Expected: PASS

- [ ] **Step 6: 実装を戻すと落ちることを確かめる**

`e.repeat` の除外、`isComposing` の除外、`keyCode === 229` の除外、`HTMLInputElement` の条件を 1 つずつ外し、該当のテストが落ちることを確かめて元へ戻す。

### Task 3: ドキュメントと全体の検証

**Files:**
- Modify: `docs/manual-test-spec.md`
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: Task 1・2 の動作

- [ ] **Step 1: 実機テスト仕様書の既存の項目を直す(ID は変えない)**

- AGT-151: `送信` にフォーカスがある → `引数（任意）` の欄にフォーカスがある
- AGT-155: フォーカスは本文・`引数（任意）` の欄・`送信`・`キャンセル` の間を回る
- AGT-156: 開くと `引数（任意）` の欄が読まれ、`Tab` で `送信`・`キャンセル`・本文の順に移る形へ直す
- AGT-160・AGT-171: フォーカスは `引数（任意）` の欄に残る
- AGT-169: `引数（任意）` の欄にフォーカスがある

- [ ] **Step 2: 新しい項目を追記する**

`### 送信前の確認` の AGT の最後の項目の後ではなく、接頭辞の連番が昇順になるよう、AGT の最後の項目(AGT-289)の後に `### 送信前の確認の引数` を置く。

```markdown
### 送信前の確認の引数

> 前提: `### 送信前の確認` と同じ。プロンプトは `レビュー`(内容 `/review`)を追加しておく。

- [ ] **AGT-290** `レビュー` の `実行` を押し、`引数（任意）` の欄に `123` を入れる → 本文が `/review 123` に、文字数が `11 文字` に変わる
- [ ] **AGT-291** AGT-290 の状態で `Enter` を押す → ダイアログが閉じ、`/review 123` が `claude 1` へ送られる。実行履歴の新しい項目の内容が `/review 123` になる
- [ ] **AGT-292** `レビュー` の `実行` を押し、日本語の入力で欄に文字を打ち、変換の確定の `Enter` を押す → 確定だけが行われ、ダイアログは閉じない(確かめた後 `キャンセル` で閉じる)
- [ ] **AGT-293** エクスプローラーのファイルを参照に足してから `レビュー` の `実行` を押し、引数に `123` を入れる → 本文の 1 行目が `/review 123` で、参照の一覧はその後に出る(確かめた後 `キャンセル` で閉じる)
- [ ] **AGT-294** 履歴の詳細の `再実行` で開いたダイアログを見る → `引数（任意）` の欄は空で、入れると本文の末尾へ付く
- [ ] **AGT-295** 引数を入れて `キャンセル` を押し、もう一度 `実行` を押す → 欄は空に戻る
```

- [ ] **Step 3: ROADMAP を更新する**

`ROADMAP.md` の `既知の制約` の `- 確認の画面では本文を直せない(キャンセルしてプロンプト〈または変数〉を直す)` の上の実装済みの一覧へ足す:

```markdown
- [x] 送信前の確認に `引数（任意）` の欄を置き、本文の直後へ半角空白で繋いで送る（参照の一覧より前。空なら本文を変えない。全文と文字数は入力に合わせて更新し、履歴には引数を含む全文を残す。開いたときのフォーカスは引数欄で、`Enter` で送信する）
```

既知の制約へ足す:

```markdown
- 引数は 1 行で、キャンセルすると残らない。`再実行` の引数は全文の末尾へ付く（参照の一覧を含む履歴では一覧の後ろ）。確認がオフのときは渡せない
```

`既知の制約` の `- 確認の画面では本文を直せない` は `- 確認の画面では本文を直せない（引数を足すことだけができる）` に直す。

- [ ] **Step 4: 仕様書の検査と全体の検証**

Run: `node scripts/build-manual-test-spec.mjs && NODE_ENV=test npx vitest run scripts && NODE_ENV=test npx vitest run --testTimeout=30000 && npm run typecheck`
Expected: PASS

Artifact の再公開は CLAUDE.md の手順に従い `.superpowers/manual-test-spec.html` で試みる。公開版の読み込みが必要で完了できなければ、完了報告に残す。
