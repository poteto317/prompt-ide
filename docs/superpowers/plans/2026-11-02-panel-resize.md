# サイドバーとターミナルのパネルの大きさの変更 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** サイドバーの幅とターミナルのパネルの高さを、境界のドラッグと矢印キーで変え、次の起動でも保つ。

**Architecture:** 値と範囲は `src/shared/panelLayout.ts` に置き、`settings.json` の `panelLayout` へ保存する。`usePanelLayout` が状態と保存を持ち、汎用の `PanelResizer` が操作を受ける。

**Tech Stack:** React 19、TypeScript、Electron、vitest、Testing Library

設計書: `docs/superpowers/specs/2026-11-02-panel-resize-design.md`

気をつける知見: L-526(連続操作の無駄な更新)、L-527(ポインタの所有者)、L-018、L-203(コメントの同期)、L-653

## Global Constraints

- 返答・コメントは日本語。`git commit`・`git push` はしない
- テストは `NODE_ENV=test` を付ける。全体の実行は `NODE_ENV=test npx vitest run --testTimeout=30000`
- 型のみの import は `import type`。クライアントコンポーネントには `'use client'`
- 既定値: 幅 240px、高さ 45%。範囲: 幅 160〜600px、高さ 15〜85%
- 境界の `z-index` は 12(Monaco のスクロールバーの 11 より手前)
- 実機テスト仕様書の既存の ID は変えない

---

### Task 1: 値の定義と保存の経路

**Files:**
- Create: `src/shared/panelLayout.ts`
- Create: `src/shared/__tests__/panelLayout.test.ts`(`src/shared` のテストの置き場所が別なら既存に合わせる)
- Create: `src/main/panelLayoutStore.ts`
- Create: `src/main/__tests__/panelLayoutStore.test.ts`
- Modify: `src/main/settingsFileStore.ts`、`src/main/handlers/settingsHandlers.ts`、`src/preload/api.ts`、`src/preload/index.d.ts`、`src/renderer/src/lib/settingsApi.ts`、`src/renderer/src/__tests__/setup.ts`
- Test: `src/main/__tests__/handlers/settingsHandlers.test.ts`、`src/preload/__tests__/api.test.ts`、`src/renderer/src/lib/__tests__/settingsApi.test.ts`

**Interfaces:**
- Produces: `PanelLayout`、`DEFAULT_PANEL_LAYOUT`、`SIDEBAR_WIDTH_MIN`・`SIDEBAR_WIDTH_MAX`・`TERMINAL_HEIGHT_PERCENT_MIN`・`TERMINAL_HEIGHT_PERCENT_MAX`、`isPanelLayout(value: unknown): value is PanelLayout`、`clampNumber(value, min, max)`、`window.api.getPanelLayout()`・`setPanelLayout(layout)`、`settingsApi` の `getPanelLayout`・`setPanelLayout`

- [ ] **Step 1: 失敗するテストを書く**

`panelLayout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_PANEL_LAYOUT, clampNumber, isPanelLayout } from '../panelLayout'

describe('isPanelLayout', () => {
  it('既定値と範囲の両端を受け付ける', () => {
    expect(isPanelLayout(DEFAULT_PANEL_LAYOUT)).toBe(true)
    expect(isPanelLayout({ sidebarWidth: 160, terminalHeightPercent: 15 })).toBe(true)
    expect(isPanelLayout({ sidebarWidth: 600, terminalHeightPercent: 85 })).toBe(true)
  })

  it.each([
    [null],
    ['240'],
    [{ sidebarWidth: 159, terminalHeightPercent: 45 }],
    [{ sidebarWidth: 601, terminalHeightPercent: 45 }],
    [{ sidebarWidth: 240, terminalHeightPercent: 14 }],
    [{ sidebarWidth: 240, terminalHeightPercent: 86 }],
    [{ sidebarWidth: Number.NaN, terminalHeightPercent: 45 }],
    [{ sidebarWidth: 240 }]
  ])('%j は受け付けない', (value) => {
    expect(isPanelLayout(value)).toBe(false)
  })
})

describe('clampNumber', () => {
  it('範囲へ丸める', () => {
    expect(clampNumber(5, 10, 20)).toBe(10)
    expect(clampNumber(25, 10, 20)).toBe(20)
    expect(clampNumber(15, 10, 20)).toBe(15)
  })
})
```

`panelLayoutStore.test.ts` は `promptListModeStore` のテストと同じモックの形で書く。読み込みは 保存が無い → 既定値、不正 → 既定値、正しい値 → その値。保存は 正しい値 → `writeSettingsFile({ panelLayout })`、不正 → 書かずに `パネルの大きさが不正です` で投げる。余分なキーを持つ値は、読み込みの戻り値にも保存にも余分なキーが残らないことを確かめる。

`settingsHandlers.test.ts`・`api.test.ts`・`settingsApi.test.ts` に `getPromptListMode`・`setPromptListMode` と同じ形の検査を足す。

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/shared src/main/__tests__/panelLayoutStore.test.ts`
Expected: FAIL(ファイルが無い)

- [ ] **Step 3: 実装する**

`src/shared/panelLayout.ts`:

```ts
// サイドバーの幅(px)とターミナルのパネルの高さ(エディタの領域に対する %)。main の保存と renderer の表示で同じ範囲を使う
export interface PanelLayout {
  sidebarWidth: number
  terminalHeightPercent: number
}

export const SIDEBAR_WIDTH_MIN = 160
export const SIDEBAR_WIDTH_MAX = 600
export const TERMINAL_HEIGHT_PERCENT_MIN = 15
export const TERMINAL_HEIGHT_PERCENT_MAX = 85

export const DEFAULT_PANEL_LAYOUT: PanelLayout = { sidebarWidth: 240, terminalHeightPercent: 45 }

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const isInRange = (value: unknown, min: number, max: number): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

export function isPanelLayout(value: unknown): value is PanelLayout {
  if (typeof value !== 'object' || value === null) return false
  const { sidebarWidth, terminalHeightPercent } = value as Record<string, unknown>
  return (
    isInRange(sidebarWidth, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX) &&
    isInRange(terminalHeightPercent, TERMINAL_HEIGHT_PERCENT_MIN, TERMINAL_HEIGHT_PERCENT_MAX)
  )
}
```

`src/main/panelLayoutStore.ts`:

```ts
import type { PanelLayout } from '@shared/panelLayout'
import { DEFAULT_PANEL_LAYOUT, isPanelLayout } from '@shared/panelLayout'
import { readSettingsFile, writeSettingsFile } from './settingsFileStore'

// サイドバーの幅とターミナルの高さの読み書き(userData/settings.json の panelLayout。ほかの設定と同じファイルにマージで書く)

/** 保存の拒否の文言(値を入れない。L-017) */
const PANEL_LAYOUT_INVALID_ERROR = 'パネルの大きさが不正です'

/** 保存された大きさ。無い・不正なら既定 */
export async function getPanelLayout(): Promise<PanelLayout> {
  const data = await readSettingsFile()
  if (!isPanelLayout(data.panelLayout)) return { ...DEFAULT_PANEL_LAYOUT }
  const { sidebarWidth, terminalHeightPercent } = data.panelLayout
  return { sidebarWidth, terminalHeightPercent }
}

/** 検証してから保存する。不正な値は書かずに投げる */
export async function setPanelLayout(layout: unknown): Promise<void> {
  if (!isPanelLayout(layout)) throw new Error(PANEL_LAYOUT_INVALID_ERROR)
  // 検証した 2 項目だけを保存する(余分なキーを書かない。L-018)
  const { sidebarWidth, terminalHeightPercent } = layout
  await writeSettingsFile({ panelLayout: { sidebarWidth, terminalHeightPercent } })
}
```

`settingsFileStore.ts` の `SettingsFile` に `panelLayout?: unknown`(`promptListMode` の項目と同じ形に合わせる)を足す。`settingsHandlers.ts` に `settings:getPanelLayout`・`settings:setPanelLayout`、`api.ts`・`index.d.ts` に `getPanelLayout(): Promise<PanelLayout>`・`setPanelLayout(layout: PanelLayout): Promise<void>`、`settingsApi.ts` に同名の関数、`setup.ts` に `getPanelLayout: () => Promise.resolve({ sidebarWidth: 240, terminalHeightPercent: 45 })`・`setPanelLayout: () => Promise.resolve()` を足す。いずれも `PromptListMode` の行の隣に同じ形で書く。

- [ ] **Step 4: 検証する**

Run: `NODE_ENV=test npx vitest run src/shared src/main src/preload src/renderer/src/lib/__tests__/settingsApi.test.ts --testTimeout=30000 && npm run typecheck`
Expected: PASS

### Task 2: `usePanelLayout`

**Files:**
- Create: `src/renderer/src/hooks/usePanelLayout.ts`
- Test: `src/renderer/src/hooks/__tests__/usePanelLayout.test.ts`

**Interfaces:**
- Consumes: Task 1 の `settingsApi`・`panelLayout`
- Produces: `usePanelLayout(): { layout: PanelLayout; changeSidebarWidth(value: number): void; changeTerminalHeightPercent(value: number): void; commit(): void }`

- [ ] **Step 1: 失敗するテストを書く**

`settingsApi` を `vi.mock` し、次を確かめる:

```ts
it('読み込んだ値を反映する')
// getPanelLayout が { sidebarWidth: 300, terminalHeightPercent: 60 } → layout が同じ値
it('範囲の外の値は丸める')
// changeSidebarWidth(9999) → 600、changeTerminalHeightPercent(1) → 15
it('読み込みの前に変えた項目だけ今の値を残す')
// 未解決の Promise で読み込みを止め、changeSidebarWidth(320)、解決で { sidebarWidth: 300, terminalHeightPercent: 60 } → { 320, 60 }
it('読み込みに失敗しても既定値のまま続ける')
// reject → console.error、layout は既定値
it('丸めた後の値が同じなら描画し直さない')
// 描画の回数を数える: changeSidebarWidth(9999) を 2 回 → 2 回目で増えない
it('同じ tick の commit は新しい値を保存する')
// act の中で changeSidebarWidth(320); commit() → setPanelLayout が { sidebarWidth: 320, ... } で 1 回
it('保存に失敗しても投げない')
// setPanelLayout の reject → console.error
```

上の 7 件をすべて書く。`console.error` は `vi.spyOn` で握る。

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/usePanelLayout.test.ts`
Expected: FAIL(ファイルが無い)

- [ ] **Step 3: 実装する**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PanelLayout } from '@shared/panelLayout'
import {
  DEFAULT_PANEL_LAYOUT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  TERMINAL_HEIGHT_PERCENT_MAX,
  TERMINAL_HEIGHT_PERCENT_MIN,
  clampNumber
} from '@shared/panelLayout'
import { getPanelLayout, setPanelLayout } from '../lib/settingsApi'

export interface PanelLayoutState {
  layout: PanelLayout
  changeSidebarWidth: (value: number) => void
  changeTerminalHeightPercent: (value: number) => void
  /** 今の値を保存する。ドラッグの終わりとキー操作で呼ぶ */
  commit: () => void
}

// サイドバーの幅とターミナルの高さの状態と保存。読み込みが終わる前に変えた項目は上書きしない。保存の失敗は記録だけにする
// (大きさの操作は続けられる)
export function usePanelLayout(): PanelLayoutState {
  const [layout, setLayout] = useState<PanelLayout>(DEFAULT_PANEL_LAYOUT)
  // 同じ tick の change と commit で新しい値を保存するため、change の中で同期に更新する
  const layoutRef = useRef(layout)
  const changedRef = useRef<Set<keyof PanelLayout>>(new Set())

  const change = useCallback((key: keyof PanelLayout, value: number): void => {
    changedRef.current.add(key)
    if (layoutRef.current[key] === value) return
    const next = { ...layoutRef.current, [key]: value }
    layoutRef.current = next
    setLayout(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async (): Promise<void> => {
      try {
        const saved = await getPanelLayout()
        if (cancelled) return
        const next = { ...saved }
        for (const key of changedRef.current) next[key] = layoutRef.current[key]
        layoutRef.current = next
        setLayout(next)
      } catch (err) {
        console.error('[usePanelLayout] load failed:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const changeSidebarWidth = useCallback(
    (value: number) =>
      change('sidebarWidth', clampNumber(value, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX)),
    [change]
  )
  const changeTerminalHeightPercent = useCallback(
    (value: number) =>
      change(
        'terminalHeightPercent',
        clampNumber(value, TERMINAL_HEIGHT_PERCENT_MIN, TERMINAL_HEIGHT_PERCENT_MAX)
      ),
    [change]
  )
  const commit = useCallback((): void => {
    void setPanelLayout(layoutRef.current).catch((err: unknown) => {
      console.error('[usePanelLayout] save failed:', err)
    })
  }, [])

  return { layout, changeSidebarWidth, changeTerminalHeightPercent, commit }
}
```

- [ ] **Step 4: 検証する**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/usePanelLayout.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 実装を戻すと落ちることを確かめる**

`for (const key of changedRef.current)` の行、`if (layoutRef.current[key] === value) return`、`layoutRef.current = next` を 1 つずつ外して該当のテストが落ちることを確かめ、元へ戻す。

### Task 3: `PanelResizer`

**Files:**
- Create: `src/renderer/src/components/PanelResizer.tsx`
- Modify: `src/renderer/src/assets/main.css`
- Test: `src/renderer/src/components/__tests__/PanelResizer.test.tsx`、`src/renderer/src/components/__tests__/PanelResizer.styles.test.tsx`

**Interfaces:**
- Produces: `PanelResizer` の既定のエクスポート。props は `orientation: 'vertical' | 'horizontal'`、`label`、`value`、`min`、`max`、`step`、`valueFromPointer(clientX, clientY): number`、`onChange(value)`、`onCommit()`

- [ ] **Step 1: 失敗するテストを書く**

jsdom の `setPointerCapture` は無いので `beforeEach` で `Element.prototype.setPointerCapture = vi.fn()`・`hasPointerCapture = vi.fn(() => false)`・`releasePointerCapture = vi.fn()` を置き、`afterEach` で消す。

```tsx
const setup = (overrides = {}) => {
  const onChange = vi.fn()
  const onCommit = vi.fn()
  render(
    <PanelResizer
      orientation="vertical"
      label="サイドバーの幅"
      value={240}
      min={160}
      max={600}
      step={16}
      valueFromPointer={(x) => x}
      onChange={onChange}
      onCommit={onCommit}
      {...overrides}
    />
  )
  return { onChange, onCommit, handle: screen.getByRole('separator', { name: 'サイドバーの幅' }) }
}

it('separator として値と向きを持つ', () => {
  const { handle } = setup()
  expect(handle).toHaveAttribute('aria-orientation', 'vertical')
  expect(handle).toHaveAttribute('aria-valuenow', '240')
  expect(handle).toHaveAttribute('aria-valuemin', '160')
  expect(handle).toHaveAttribute('aria-valuemax', '600')
  expect(handle).toHaveAttribute('tabindex', '0')
})

it('ドラッグで値を伝え、離したら 1 回保存する', () => {
  const { handle, onChange, onCommit } = setup()
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 240 })
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 })
  expect(onChange).toHaveBeenLastCalledWith(300)
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 300 })
  expect(onCommit).toHaveBeenCalledOnce()
})

it('主ボタン以外では始めない', () => {
  const { handle, onChange } = setup()
  fireEvent.pointerDown(handle, { pointerId: 1, button: 2, clientX: 240 })
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 })
  expect(onChange).not.toHaveBeenCalled()
})

it('値が開始時と同じなら保存しない', () => {
  const { handle, onCommit } = setup()
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 240 })
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 240 })
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 240 })
  expect(onCommit).not.toHaveBeenCalled()
})

it('2 本目のポインタは無視する', () => {
  const { handle, onChange, onCommit } = setup()
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 240 })
  fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientX: 500 })
  fireEvent.pointerMove(handle, { pointerId: 2, clientX: 500 })
  fireEvent.pointerUp(handle, { pointerId: 2, clientX: 500 })
  expect(onChange).not.toHaveBeenCalled()
  expect(onCommit).not.toHaveBeenCalled()
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 })
  expect(onChange).toHaveBeenCalledExactlyOnceWith(300)
})

it('pointercancel でも終える', () => {
  const { handle, onChange, onCommit } = setup()
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 240 })
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 })
  fireEvent.pointerCancel(handle, { pointerId: 1 })
  expect(onCommit).toHaveBeenCalledOnce()
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 })
  expect(onChange).toHaveBeenCalledOnce()
})

it('lostpointercapture でも終える(ID の違うものは無視する)', () => {
  const { handle, onChange, onCommit } = setup()
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 240 })
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 })
  fireEvent.lostPointerCapture(handle, { pointerId: 2 })
  expect(onCommit).not.toHaveBeenCalled()
  fireEvent.lostPointerCapture(handle, { pointerId: 1 })
  expect(onCommit).toHaveBeenCalledOnce()
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 })
  expect(onChange).toHaveBeenCalledOnce()
})

it('範囲の端の矢印キーは何もしない', () => {
  const { handle, onChange, onCommit } = setup({ value: 600 })
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(onChange).not.toHaveBeenCalled()
  expect(onCommit).not.toHaveBeenCalled()
})

it('mousedown の既定の動作を止める(フォーカスと選択を動かさない)', () => {
  const { handle } = setup()
  expect(fireEvent.mouseDown(handle)).toBe(false)
})

it.each([
  ['vertical', 'ArrowRight', 256],
  ['vertical', 'ArrowLeft', 224],
  ['horizontal', 'ArrowUp', 256],
  ['horizontal', 'ArrowDown', 224]
])('%s の %s で step ずつ変えて保存する', (orientation, key, expected) => {
  const { handle, onChange, onCommit } = setup({ orientation })
  expect(fireEvent.keyDown(handle, { key })).toBe(false)
  expect(onChange).toHaveBeenCalledExactlyOnceWith(expected)
  expect(onCommit).toHaveBeenCalledOnce()
})

it('向きと違う矢印キーは何もしない', () => {
  const { handle, onChange } = setup()
  fireEvent.keyDown(handle, { key: 'ArrowUp' })
  expect(onChange).not.toHaveBeenCalled()
})
```

スタイルのテストは `CollapsibleSection.styles.test.tsx` と同じ形で `main.css` を読み、`.panel-resizer--vertical` の `cursor: col-resize`、`.panel-resizer--horizontal` の `cursor: row-resize`・`margin-top: -6px`、`.panel-resizer` の `touch-action: none`・`user-select: none`・`z-index: 12`、`.sidebar` の `min-width: 160px`・`max-width: calc(100vw - 400px)` を検査する。`touch-action`・`user-select` は `getPropertyValue` で読む。

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/components/__tests__/PanelResizer`
Expected: FAIL

- [ ] **Step 3: 実装する**

```tsx
'use client'
import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { clampNumber } from '@shared/panelLayout'

interface Props {
  orientation: 'vertical' | 'horizontal'
  label: string
  value: number
  min: number
  max: number
  step: number
  /** ポインタの位置から値を求める */
  valueFromPointer: (clientX: number, clientY: number) => number
  onChange: (value: number) => void
  onCommit: () => void
}

interface Drag {
  pointerId: number
  startValue: number
  lastValue: number
}

// 隣り合う領域の大きさを変える境界。ドラッグと矢印キーで操作する。値の丸めは呼び出し側が持つ
export default function PanelResizer({
  orientation,
  label,
  value,
  min,
  max,
  step,
  valueFromPointer,
  onChange,
  onCommit
}: Props): React.JSX.Element {
  const dragRef = useRef<Drag | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const finish = (pointerId: number): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== pointerId) return
    dragRef.current = null
    setIsDragging(false)
    if (drag.lastValue !== drag.startValue) onCommit()
  }

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || dragRef.current !== null) return
    dragRef.current = { pointerId: e.pointerId, startValue: value, lastValue: value }
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== e.pointerId) return
    const next = valueFromPointer(e.clientX, e.clientY)
    drag.lastValue = next
    onChange(next)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const [increase, decrease] =
      orientation === 'vertical' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowUp', 'ArrowDown']
    if (e.key !== increase && e.key !== decrease) return
    e.preventDefault()
    const next = clampNumber(value + (e.key === increase ? step : -step), min, max)
    // 範囲の端で押し続けても設定を書き直さない(L-526)
    if (next === value) return
    onChange(next)
    onCommit()
  }

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={[
        'panel-resizer',
        `panel-resizer--${orientation}`,
        isDragging ? 'panel-resizer--dragging' : ''
      ]
        .filter((name) => name !== '')
        .join(' ')}
      // ポインタではフォーカスと文字の選択を動かさない(ターミナルや Monaco の入力先を保つ)
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finish(e.pointerId)}
      onPointerCancel={(e) => finish(e.pointerId)}
      onLostPointerCapture={(e) => finish(e.pointerId)}
      onKeyDown={handleKeyDown}
    />
  )
}
```

`drag.lastValue` は丸める前の値でよい。丸めた結果が開始の値と同じでも保存は 1 回だけで害が無い。

`main.css`(`.sidebar` の近く):

```css
/* 隣り合う領域の大きさを変える境界。レイアウトの幅を取らない。z-index は Monaco のスクロールバー(11)より手前にする値 */
.panel-resizer {
  position: relative;
  z-index: 12;
  flex-shrink: 0;
  background: transparent;
  touch-action: none;
  user-select: none;
}

.panel-resizer--vertical {
  width: 6px;
  margin: 0 -3px;
  cursor: col-resize;
}

.panel-resizer--horizontal {
  height: 6px;
  margin-top: -6px;
  cursor: row-resize;
}

.panel-resizer:hover,
.panel-resizer:focus-visible,
.panel-resizer--dragging {
  background: #007acc;
  outline: none;
}

@media (pointer: coarse) {
  .panel-resizer--vertical {
    width: 16px;
    margin: 0 -8px;
  }

  .panel-resizer--horizontal {
    height: 16px;
    margin-top: -16px;
  }
}
```

`.sidebar` に `min-width: 160px; max-width: calc(100vw - 400px);` を足す。`width: 240px` は既定値として残す。

- [ ] **Step 4: 検証する**

Run: `NODE_ENV=test npx vitest run src/renderer/src/components/__tests__/PanelResizer && npm run typecheck && npx eslint src/renderer/src/components/PanelResizer.tsx && npx prettier --check src/renderer/src/components/PanelResizer.tsx src/renderer/src/assets/main.css`
Expected: PASS

- [ ] **Step 5: 実装を戻すと落ちることを確かめる**

`drag.pointerId !== e.pointerId` の検査、`e.button !== 0`、`drag.lastValue !== drag.startValue`、`onMouseDown`、`onLostPointerCapture`、`next === value` を 1 つずつ外して該当のテストが落ちることを確かめ、元へ戻す。

### Task 4: 画面への配線

**Files:**
- Modify: `src/renderer/src/App.tsx`、`src/renderer/src/components/Sidebar.tsx`、`src/renderer/src/components/EditorPanel.tsx`、`src/renderer/src/components/agent/AgentTerminalPanel.tsx`、`src/renderer/src/assets/main.css`
- Test: `src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`、`src/renderer/src/components/__tests__/App.panelResize.test.tsx`(新規。既存の `App.*.test.tsx` の準備の形に合わせる)

**Interfaces:**
- Consumes: Task 2 の `usePanelLayout`、Task 3 の `PanelResizer`
- Produces: `Sidebar` の props `width?: number`。`AgentTerminalPanel`・`EditorPanel` の props `terminalSize?: AgentTerminalSize`。`AgentTerminalPanel.tsx` が `export interface AgentTerminalSize { heightPercent: number; onChange: (value: number) => void; onCommit: () => void }`

- [ ] **Step 1: 失敗するテストを書く**

`AgentTerminalPanel.test.tsx` の `renderPanel` は `state` だけを渡すので、`size` を渡す別の描画をこのテストの中で書く:

```tsx
const size = { heightPercent: 60, onChange: vi.fn(), onCommit: vi.fn() }
const renderSized = (layout = makeAgentTerminalPanelLayout()): void => {
  const state = makeAgentTerminalPanelState({ sessions: makeSessions(), layout })
  render(<AgentTerminalPanel state={state} terminalSize={size} />)
}

it('開いている間だけ高さの境界を出し、高さを section へ渡す', () => {
  renderSized()
  expect(screen.getByRole('separator', { name: 'ターミナルの高さ' })).toHaveAttribute(
    'aria-valuenow',
    '60'
  )
  expect(screen.getByRole('region', { name: 'エージェント' }).style.getPropertyValue('--agent-terminal-height')).toBe('60%')
})

it.each([
  ['閉じている', { isOpen: false }],
  ['最大化', { isMaximized: true }]
])('%s 間は境界を出さない', (_label, overrides) => {
  renderSized(makeAgentTerminalPanelLayout(overrides))
  expect(screen.queryByRole('separator')).not.toBeInTheDocument()
})

it('ポインタの位置をエディタの領域に対する % へ変える', () => {
  renderSized()
  const section = screen.getByRole('region', { name: 'エージェント' })
  vi.spyOn(section.parentElement as HTMLElement, 'getBoundingClientRect').mockReturnValue({
    top: 100, bottom: 500, height: 400, left: 0, right: 0, width: 0, x: 0, y: 100, toJSON: () => ({})
  })
  const handle = screen.getByRole('separator')
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 300 })
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 200 })
  expect(size.onChange).toHaveBeenLastCalledWith(75)
})

it('エディタの領域の高さが 0 なら今の値のまま', () => {
  renderSized()
  const section = screen.getByRole('region', { name: 'エージェント' })
  vi.spyOn(section.parentElement as HTMLElement, 'getBoundingClientRect').mockReturnValue({
    top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({})
  })
  const handle = screen.getByRole('separator')
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 0 })
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 200 })
  expect(size.onChange).toHaveBeenLastCalledWith(60)
})
```

`setPointerCapture` の準備は Task 3 と同じ。`beforeEach` で `size` のモックを `mockClear` する。

`App.panelResize.test.tsx` で次を確かめる: 既定で `サイドバーの幅` の separator が出て `aria-valuenow` が `240`。保存値 `{ sidebarWidth: 320, ... }` でサイドバーの `style.width` が `320px`。矢印キーの `ArrowRight` で 256 になり `window.api.setPanelLayout` が呼ばれる。アクティビティバーの同じパネルを押してサイドバーを閉じると separator が消える。`makeAgentWorkspaceState({ bottomPanel: 'agent-terminal' })` と保存値 `terminalHeightPercent: 60` で描画すると、`ターミナルの高さ` の separator の `aria-valuenow` が `60` になる(`App`→`EditorPanel`→`AgentTerminalPanel` の配線)。準備は `App.promptListMode.test.tsx` の形に合わせる。

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/components/__tests__/App.panelResize.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

`AgentTerminalPanel.tsx`:

```tsx
export interface AgentTerminalSize {
  /** エディタの領域に対する高さ(%) */
  heightPercent: number
  onChange: (value: number) => void
  onCommit: () => void
}
```

`Props` に `terminalSize?: AgentTerminalSize` を足す。コンポーネントの中:

```tsx
// flex-basis の % の基準はエディタの領域(section の親)
const heightFromPointer = (_clientX: number, clientY: number): number => {
  const area = sectionRef.current?.parentElement?.getBoundingClientRect()
  if (terminalSize === undefined) return 0
  if (area === undefined || area.height === 0) return terminalSize.heightPercent
  return ((area.bottom - clientY) / area.height) * 100
}
```

`<section>` に `style={terminalSize === undefined ? undefined : ({ '--agent-terminal-height': `${terminalSize.heightPercent}%` } as React.CSSProperties)}` を足し、先頭の子に置く:

```tsx
{terminalSize !== undefined && layout.isOpen && !layout.isMaximized && (
  <PanelResizer
    orientation="horizontal"
    label="ターミナルの高さ"
    value={Math.round(terminalSize.heightPercent)}
    min={TERMINAL_HEIGHT_PERCENT_MIN}
    max={TERMINAL_HEIGHT_PERCENT_MAX}
    step={2}
    valueFromPointer={heightFromPointer}
    onChange={terminalSize.onChange}
    onCommit={terminalSize.onCommit}
  />
)}
```

`value` の丸めで矢印キーの基準が四捨五入の値になるのは許容する。

`EditorPanel.tsx`: `terminalSize?: AgentTerminalSize` を受けて `AgentTerminalPanel` へ渡す。

`Sidebar.tsx`: `width?: number` を受け、`<div className="sidebar" style={width === undefined ? undefined : { width }}>`。

`App.tsx`:

```tsx
const panelLayout = usePanelLayout()
const ideMainRef = useRef<HTMLDivElement>(null)
```

`<div ref={ideMainRef} className="ide-main">`、`Sidebar` に `width={panelLayout.layout.sidebarWidth}`、`Sidebar` の直後に:

```tsx
{sidebarOpen && (
  <PanelResizer
    orientation="vertical"
    label="サイドバーの幅"
    value={panelLayout.layout.sidebarWidth}
    min={SIDEBAR_WIDTH_MIN}
    max={SIDEBAR_WIDTH_MAX}
    step={16}
    valueFromPointer={(clientX) =>
      clientX - (ideMainRef.current?.getBoundingClientRect().left ?? 0)
    }
    onChange={panelLayout.changeSidebarWidth}
    onCommit={panelLayout.commit}
  />
)}
```

`EditorPanel` に `terminalSize={{ heightPercent: panelLayout.layout.terminalHeightPercent, onChange: panelLayout.changeTerminalHeightPercent, onCommit: panelLayout.commit }}`。

`main.css`: `.agent-terminal-panel--open` を `flex: 0 0 var(--agent-terminal-height, 45%);` にし、上のコメントを「既定はエディタの領域の 45%(最小 160px)。境界のドラッグで変えられる」に直す。履歴の `+N` のコメント(3855 行付近)の「固定幅のサイドバー」を「既定の幅のサイドバー」に直し、「既定より狭い幅では切れることがある」を足す。

- [ ] **Step 4: 検証する**

Run: `NODE_ENV=test npx vitest run src/renderer/src/components --testTimeout=30000 && npm run typecheck && npx prettier --check src/renderer/src/App.tsx src/renderer/src/assets/main.css`
Expected: PASS

### Task 5: ドキュメントと全体の検証

**Files:**
- Modify: `docs/manual-test-spec.md`、`ROADMAP.md`、`docs/developer-guide.md`(設定の保存の一覧があれば)

- [ ] **Step 1: 既存の項目を直す(ID は変えない)**

- BASE-016: 狭いウィンドウではサイドバーが縮み、エディタの領域に約 352px を残す形へ直す
- APL-027 の後半(600px 以下): サイドバーが縮むので、手順の幅と見える結果を直す
- AGT-046: Tab の順に `ターミナルの高さ` の境界が入る形へ直す
- BASE-008・PRM-098・GIT-136: 「約 240px」は既定の幅のときと明記する

- [ ] **Step 2: 新しい項目を追記する**

`### 文字サイズと開閉の矢印` の次(BASE の最後)に追記する。連番は BASE の最大の次から振る。

```markdown
### パネルの大きさの変更

> 前提: エージェント CLI 方式で、ターミナルのパネルを開いておく。

- [ ] **BASE-043** サイドバーの右端にカーソルを載せてドラッグする → カーソルが左右の矢印に変わり、境界が青くなり、サイドバーの幅が追従する。160px より狭く、600px より広くならない
- [ ] **BASE-044** ターミナルのパネルの上端をドラッグする → カーソルが上下の矢印に変わり、パネルの高さが追従して、ターミナルの行数も合わせ直される。エディタの領域の 15% より低く、85% より高くならない
- [ ] **BASE-045** 大きさを変えてアプリを起動し直す → サイドバーの幅とターミナルの高さが保たれている
- [ ] **BASE-046** ターミナルに入力できる状態で境界をドラッグする → ドラッグの後もターミナルへそのまま入力でき、ページの文字は選択されない
- [ ] **BASE-047** ドラッグ中にカーソルをターミナルやエディタの上へ動かす → ドラッグが途切れない
- [ ] **BASE-048** 横に長い行があるファイルを開き、エディタにカーソルを載せたままパネルの上端を押してドラッグする → 横のスクロールバーではなく境界が動く
- [ ] **BASE-049** `Tab` で `サイドバーの幅` の境界へ移り、`→` `←` を押す。`ターミナルの高さ` の境界で `↑` `↓` を押す → 境界が青く示され、押すたびに大きさが変わる。VoiceOver では名前と値が読まれる
- [ ] **BASE-050** サイドバーを閉じる、ターミナルのパネルを閉じる、最大化する → それぞれ該当の境界が消え、開くと同じ大きさで戻る
- [ ] **BASE-051** サイドバーを 600px にしてウィンドウを狭める → エディタの領域が約 352px 残るようにサイドバーが縮む
```

- [ ] **Step 3: ROADMAP を更新する**

`- [ ] リサイズ可能・配置変更可能なパネル、レイアウトプリセット` は完了にせず、直下に書き添える:

```markdown
      （サイドバーの幅とターミナルのパネルの高さのドラッグ・矢印キーでの変更と保存は実装済み。設計書 `docs/superpowers/specs/2026-11-02-panel-resize-design.md`。残りは出力パネルの高さ、配置の変更、レイアウトのプリセット、既定の大きさへ戻す操作。既定より狭い幅では履歴の `+N` が切れることがある。保存の失敗は画面に出さない。起動の直後は読み込みが終わるまで既定の大きさで描く）
```

- [ ] **Step 4: 全体を検証する**

Run: `node scripts/build-manual-test-spec.mjs && NODE_ENV=test npx vitest run scripts && NODE_ENV=test npx vitest run --testTimeout=30000 && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Artifact の再公開**

`.superpowers/manual-test-spec.html` を <manual-test-spec-artifact-url> へ同じファイルパスで再公開する。実装担当ではなく制御役が行う。公開版の全行の読み込みが必要で完了できなければ、完了報告に残す。
